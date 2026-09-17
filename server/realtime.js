import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createRedisService } from "./redis-service.js";
import {
  CORE_INTERNAL_URL,
  hasValidInternalSecret,
  postInternalJson,
  warnForDefaultInternalSecret,
} from "./internal-service.js";

const PORT = Number(process.env.REALTIME_PORT || 3002);
const HOST = process.env.REALTIME_HOST || process.env.HOST || "0.0.0.0";
const MAX_INTERNAL_BODY = 2 * 1024 * 1024;
const OFFLINE_QUEUE_LIMIT = Number(process.env.OFFLINE_EVENT_QUEUE_LIMIT || 500);
const OFFLINE_EVENT_TTL_MS = Number(process.env.OFFLINE_EVENT_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const HEARTBEAT_MS = Number(process.env.REALTIME_HEARTBEAT_MS || 25_000);
const KEY_ROTATION_RETRY_MS = Number(process.env.KEY_ROTATION_RETRY_MS || 5_000);
const BACKGROUND_JOB_INTERVAL_MS = Number(process.env.BACKGROUND_JOB_INTERVAL_MS || 1_000);
const redis = await createRedisService();

const socketsByUser = new Map();
const metrics = { eventsReceived: 0, eventsDelivered: 0, eventsQueued: 0, wsConnectedTotal: 0, wsMessagesReceived: 0 };

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(body);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (chunk) => { size += chunk.length; if (size > MAX_INTERNAL_BODY) { reject(Object.assign(new Error("Слишком большой запрос"), { status: 413 })); req.destroy(); } else chunks.push(chunk); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(Object.assign(new Error("Некорректный JSON"), { status: 400 })); } });
    req.on("error", reject);
  });
}

function encodeWsFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  if (data.length < 126) return Buffer.concat([Buffer.from([0x80 | opcode, data.length]), data]);
  if (data.length < 65536) { const header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(data.length, 2); return Buffer.concat([header, data]); }
  const header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2); return Buffer.concat([header, data]);
}

function decodeWsFrames(buffer) {
  const frames = []; let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]; const second = buffer[offset + 1]; const opcode = first & 0x0f; const masked = Boolean(second & 0x80);
    let length = second & 0x7f; let cursor = offset + 2;
    if (length === 126) { if (cursor + 2 > buffer.length) break; length = buffer.readUInt16BE(cursor); cursor += 2; }
    else if (length === 127) { if (cursor + 8 > buffer.length) break; const big = buffer.readBigUInt64BE(cursor); if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame слишком большой"); length = Number(big); cursor += 8; }
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null; if (masked) cursor += 4;
    if (cursor + length > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    frames.push({ opcode, payload }); offset = cursor + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function sendWs(socket, payload) {
  if (!socket || socket.destroyed) return false;
  try { socket.write(encodeWsFrame(JSON.stringify(payload))); return true; } catch { return false; }
}

async function queueOfflineEvent(userId, payload) {
  metrics.eventsQueued += 1;
  await redis.queuePush(`realtime:offline:${userId}`, { id: randomUUID(), payload, queuedAt: Date.now() }, OFFLINE_QUEUE_LIMIT, Math.ceil(OFFLINE_EVENT_TTL_MS / 1000));
}

async function deliverToUsers(userIds, payload, { queueOffline = true } = {}) {
  let deliveredSockets = 0; let queuedUsers = 0;
  for (const userId of new Set((userIds || []).filter(Boolean))) {
    const sockets = socketsByUser.get(userId);
    if (sockets?.size) {
      for (const socket of sockets) if (sendWs(socket, payload)) { deliveredSockets += 1; metrics.eventsDelivered += 1; }
    } else if (queueOffline) { await queueOfflineEvent(userId, payload); queuedUsers += 1; }
  }
  return { deliveredSockets, queuedUsers };
}

function broadcastAll(payload) {
  let deliveredSockets = 0;
  for (const sockets of socketsByUser.values()) for (const socket of sockets) if (sendWs(socket, payload)) { deliveredSockets += 1; metrics.eventsDelivered += 1; }
  return { deliveredSockets, queuedUsers: 0 };
}

async function flushOfflineEvents(userId, socket) {
  const queue = await redis.queueDrain(`realtime:offline:${userId}`); let sent = 0;
  for (const item of queue) if (Date.now() - item.queuedAt <= OFFLINE_EVENT_TTL_MS && sendWs(socket, { ...item.payload, eventId: item.id, replayed: true, queuedAt: item.queuedAt })) sent += 1;
  return sent;
}

async function reportPresence(userId, status) {
  try {
    const { user } = await postInternalJson(CORE_INTERNAL_URL, "/internal/presence", { userId, status, lastSeen: Date.now() });
    if (user) broadcastAll({ type: "presence", user, at: Date.now() });
  } catch (error) { console.error(`[Realtime] Presence: ${error.message}`); }
}

async function handleClientEvent(socket, event) {
  if (!event || typeof event !== "object") return;
  metrics.wsMessagesReceived += 1;
  const allowed = new Set(["typing", "recording", "call.offer", "call.answer", "call.ice", "call.hangup", "event.ack"]);
  if (!allowed.has(event.type)) return sendWs(socket, { type: "error", error: "Недопустимое realtime-событие" });
  if (event.type === "event.ack") { await redis.set(`realtime:ack:${socket.userId}`, event.eventId || "", 7 * 24 * 3600); return; }
  try {
    const authorized = await postInternalJson(CORE_INTERNAL_URL, "/internal/realtime/authorize-event", { userId: socket.userId, event });
    const targetIds = authorized.userIds || [];
    await deliverToUsers(targetIds.filter((uid) => uid !== socket.userId), { ...event, userId: socket.userId, at: Date.now() }, { queueOffline: event.type.startsWith("call.") });
  } catch (error) { sendWs(socket, { type: "error", error: error.message }); }
}

function handleWsData(socket, chunk) {
  socket.wsBuffer = Buffer.concat([socket.wsBuffer || Buffer.alloc(0), chunk]);
  let decoded;
  try { decoded = decodeWsFrames(socket.wsBuffer); } catch { socket.destroy(); return; }
  socket.wsBuffer = decoded.rest;
  for (const frame of decoded.frames) {
    if (frame.opcode === 0x8) { socket.end(encodeWsFrame(Buffer.alloc(0), 0x8)); continue; }
    if (frame.opcode === 0x9) { socket.write(encodeWsFrame(frame.payload, 0xA)); socket.isAlive = true; continue; }
    if (frame.opcode === 0xA) { socket.isAlive = true; continue; }
    if (frame.opcode === 0x1) { try { handleClientEvent(socket, JSON.parse(frame.payload.toString("utf8"))); } catch { sendWs(socket, { type: "error", error: "Некорректный JSON" }); } }
  }
}

async function handleUpgrade(req, socket) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/ws") return socket.destroy();
    const token = url.searchParams.get("token") || ""; if (!token) return socket.destroy();
    const authResult = await postInternalJson(CORE_INTERNAL_URL, "/internal/realtime/auth", { token }); const user = authResult.user;
    if (!user?.id) return socket.destroy();
    const key = req.headers["sec-websocket-key"]; if (!key) return socket.destroy();
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "\r\n"].join("\r\n"));
    socket.userId = user.id; socket.sessionId = authResult.sessionId; socket.isAlive = true; socket.wsBuffer = Buffer.alloc(0); metrics.wsConnectedTotal += 1;
    const wasOffline = !socketsByUser.get(user.id)?.size; if (!socketsByUser.has(user.id)) socketsByUser.set(user.id, new Set()); socketsByUser.get(user.id).add(socket);
    const replayed = await flushOfflineEvents(user.id, socket); sendWs(socket, { type: "connected", userId: user.id, sessionId: socket.sessionId, replayedEvents: replayed, at: Date.now() });
    if (wasOffline) reportPresence(user.id, "online");
    socket.on("data", (data) => handleWsData(socket, data));
    socket.on("close", () => { const sockets = socketsByUser.get(user.id); sockets?.delete(socket); if (!sockets?.size) { socketsByUser.delete(user.id); reportPresence(user.id, "offline"); } });
    socket.on("error", () => socket.destroy());
  } catch (error) { console.warn(`[Realtime] WebSocket отклонён: ${error.message}`); socket.destroy(); }
}

function prometheusMetrics() {
  return [
    "# TYPE messenger_realtime_connected_users gauge", `messenger_realtime_connected_users ${socketsByUser.size}`,
    "# TYPE messenger_realtime_connected_sockets gauge", `messenger_realtime_connected_sockets ${[...socketsByUser.values()].reduce((s, set) => s + set.size, 0)}`,
    "# TYPE messenger_realtime_events_received counter", `messenger_realtime_events_received ${metrics.eventsReceived}`,
    "# TYPE messenger_realtime_events_delivered counter", `messenger_realtime_events_delivered ${metrics.eventsDelivered}`,
    "# TYPE messenger_realtime_events_queued counter", `messenger_realtime_events_queued ${metrics.eventsQueued}`,
  ].join("\n") + "\n";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true, service: "realtime-worker", connectedUsers: socketsByUser.size, connectedSockets: [...socketsByUser.values()].reduce((s, set) => s + set.size, 0), redis: await redis.health(), coreUrl: CORE_INTERNAL_URL, metrics, at: Date.now() });
  if (req.method === "GET" && url.pathname === "/metrics") { const body = prometheusMetrics(); res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4", "Content-Length": Buffer.byteLength(body) }); return res.end(body); }
  if (url.pathname.startsWith("/internal/") && !hasValidInternalSecret(req)) return sendJson(res, 401, { error: "Неверный внутренний секрет" });
  try {
    if (req.method === "POST" && url.pathname === "/internal/events") {
      const body = await parseJsonBody(req); if (!body.payload || typeof body.payload !== "object") return sendJson(res, 400, { error: "Отсутствует payload" }); metrics.eventsReceived += 1;
      const event = { eventId: body.eventId || randomUUID(), ...body.payload };
      const result = body.scope === "all" ? broadcastAll(event) : await deliverToUsers(body.userIds || [], event, { queueOffline: body.queueOffline !== false });
      return sendJson(res, 202, { ok: true, ...result });
    }
    if (req.method === "POST" && url.pathname === "/internal/disconnect-sessions") {
      const body = await parseJsonBody(req); const sessionIds = new Set((body.sessionIds || []).map(String).filter(Boolean)); let closed = 0;
      for (const sockets of socketsByUser.values()) for (const socket of sockets) if (sessionIds.has(socket.sessionId)) { closed += 1; socket.destroy(); }
      return sendJson(res, 200, { ok: true, closed });
    }
    return sendJson(res, 404, { error: "Маршрут не найден" });
  } catch (error) { console.error(error); return sendJson(res, error.status || 500, { error: error.message || "Ошибка realtime-сервера" }); }
});

server.on("upgrade", (req, socket) => handleUpgrade(req, socket));
const heartbeat = setInterval(() => { for (const sockets of socketsByUser.values()) for (const socket of sockets) { if (socket.isAlive === false) socket.destroy(); else { socket.isAlive = false; try { socket.write(encodeWsFrame(Buffer.alloc(0), 0x9)); } catch { socket.destroy(); } } } }, HEARTBEAT_MS); heartbeat.unref?.();

let keyRotationTimer;
function scheduleKeyRotationCheck(delayMs = 250) {
  clearTimeout(keyRotationTimer); keyRotationTimer = setTimeout(async () => {
    try { const result = await postInternalJson(CORE_INTERNAL_URL, "/internal/security/rotate-if-due", { source: "realtime-worker", checkedAt: Date.now() }); if (result.rotated) broadcastAll({ type: "security.key-rotated", nextRotationAt: result.nextRotationAt, at: Date.now() }); scheduleKeyRotationCheck(Math.max(250, Number(result.nextRotationAt || 0) - Date.now())); }
    catch (error) { console.error(`[Worker] Ротация ключа: ${error.message}`); scheduleKeyRotationCheck(KEY_ROTATION_RETRY_MS); }
  }, delayMs); keyRotationTimer.unref?.();
}
scheduleKeyRotationCheck();
const backgroundJobsTimer = setInterval(() => {
  postInternalJson(CORE_INTERNAL_URL, "/internal/jobs/run", { source: "realtime-worker", checkedAt: Date.now() })
    .catch((error) => console.error(`[Worker] Фоновые задачи: ${error.message}`));
}, BACKGROUND_JOB_INTERVAL_MS);
backgroundJobsTimer.unref?.();
warnForDefaultInternalSecret("Realtime");
server.listen(PORT, HOST, () => { console.log(`Realtime/Worker: http://${HOST}:${PORT}`); console.log(`WebSocket: ws://${HOST}:${PORT}/ws`); });

async function shutdown() { clearInterval(heartbeat); clearInterval(backgroundJobsTimer); clearTimeout(keyRotationTimer); for (const sockets of socketsByUser.values()) for (const socket of sockets) socket.destroy(); await redis.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 3000).unref?.(); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
