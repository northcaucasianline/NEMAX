import http from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGameStateStore } from "./game-state-store.js";
import { CORE_INTERNAL_URL, REALTIME_INTERNAL_URL, postInternalJson, warnForDefaultInternalSecret } from "./internal-service.js";
import {
  applyBoardTableAction,
  createBoardTable,
  joinBoardTable,
  leaveBoardTable,
  publicBoardTable,
  summarizeBoardTable,
} from "./board-games.js";
import { chooseChessBotMove, stockfishStatus } from "./stockfish-service.js";
import {
  applyPokerAction,
  cashCatalog,
  cashRebuy,
  ensureWallet,
  findOrCreateCashGame,
  findOrCreateWaitingTournament,
  joinCashGame,
  joinTournament,
  leaveTournamentBeforeStart,
  publicPokerGame,
  publicWallet,
  requestCashLeave,
  summarizePokerGame,
  tickPokerGames,
  tournamentCatalog,
} from "./poker-engine.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DATA_DIR = join(ROOT, "server", "data");
const DB_FILE = join(DATA_DIR, "game-db.json");
const PORT = Number(process.env.GAME_SERVER_PORT || 3004);
const HOST = process.env.GAME_SERVER_HOST || "0.0.0.0";
const MAX_BODY_BYTES = Number(process.env.GAME_MAX_BODY_BYTES || 2 * 1024 * 1024);
const PUBLIC_ORIGINS = new Set(String(process.env.PUBLIC_ORIGIN || "http://localhost:5173,http://localhost").split(",").map((item) => item.trim()).filter(Boolean));
const TICK_MS = Number(process.env.GAME_TICK_MS || 500);
const AUTH_CACHE_MS = Number(process.env.GAME_AUTH_CACHE_MS || 15_000);
mkdirSync(DATA_DIR, { recursive: true });

function defaults() {
  return {
    boardTables: [], pokerGames: [], wallets: [], arcadeScores: [],
    auditLogs: [], meta: { createdAt: Date.now(), version: 1 },
  };
}

const store = await createGameStateStore({ file: DB_FILE, defaults });
let db = await store.load();
for (const [key, value] of Object.entries(defaults())) if (db[key] === undefined) db[key] = value;
let persistQueue = Promise.resolve();
function persist() {
  const snapshot = JSON.parse(JSON.stringify(db));
  persistQueue = persistQueue.then(() => store.save(snapshot));
  return persistQueue;
}

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    publicId: user.userId || user.publicId,
    username: user.publicUsername || "",
    displayName: user.username || user.displayName || user.name || `Игрок ${String(user.userId || user.publicId || user.id || "").slice(-6)}`,
    avatar: user.avatar || "",
    avatarKind: user.avatarKind || "image",
    avatarMimeType: user.avatarMimeType || "",
    avatarColor: user.avatarColor || "",
    status: user.status || "offline",
    statusEmoji: user.statusEmoji || "",
    isSystemAdmin: Boolean(user.isSystemAdmin),
  };
}

function securityHeaders(req, res) {
  const origin = String(req.headers.origin || "");
  if (origin && PUBLIC_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function fail(res, status, message, details) {
  sendJson(res, status, { error: message, ...(details ? { details } : {}) });
}

function parseBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Слишком большой запрос"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolveBody({});
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("Некорректный JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

const authCache = new Map();
async function authenticate(req) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw Object.assign(new Error("Требуется авторизация"), { status: 401 });
  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const result = await postInternalJson(CORE_INTERNAL_URL, "/internal/realtime/auth", { token }, { timeoutMs: 4000 });
  if (!result.user?.id) throw Object.assign(new Error("Сессия недействительна"), { status: 401 });
  const value = { user: safeUser(result.user), sessionId: result.sessionId };
  authCache.set(token, { value, expiresAt: Date.now() + AUTH_CACHE_MS });
  if (authCache.size > 5000) {
    for (const [key, entry] of authCache) if (entry.expiresAt <= Date.now()) authCache.delete(key);
  }
  return value;
}

const requestBuckets = new Map();
function enforceRateLimit(req, userId) {
  const key = `${userId}:${req.socket.remoteAddress || "local"}`;
  const minute = Math.floor(Date.now() / 60_000);
  const current = requestBuckets.get(key);
  if (!current || current.minute !== minute) {
    requestBuckets.set(key, { minute, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > Number(process.env.GAME_RATE_LIMIT_PER_MINUTE || 240)) throw Object.assign(new Error("Слишком много запросов к игровому серверу"), { status: 429 });
}

function audit(userId, action, targetType, targetId, details = {}) {
  db.auditLogs.push({ id: randomUUID(), userId, action, targetType, targetId, details, createdAt: Date.now() });
  if (db.auditLogs.length > 50_000) db.auditLogs.splice(0, db.auditLogs.length - 50_000);
}

async function broadcast(userIds, payload, queueOffline = true) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return;
  try {
    await postInternalJson(REALTIME_INTERNAL_URL, "/internal/events", {
      eventId: randomUUID(), userIds: ids, queueOffline,
      payload: { ...payload, source: "game-server", at: payload.at || Date.now() },
    }, { timeoutMs: 3000 });
  } catch (error) {
    console.warn(`[Game Server] Не удалось отправить realtime-событие: ${error.message}`);
  }
}

function boardParticipants(table) {
  return table.players.filter((player) => !player.isBot && !player.user?.isBot).map((player) => player.userId);
}

async function maybeRunChessBot(table) {
  if (!table?.bot || table.type !== "chess" || table.state.status !== "playing" || table.state.turn !== table.bot.color) return false;
  table.bot.thinking = true;
  table.updatedAt = Date.now();
  await persist();
  await broadcast(boardParticipants(table), { type: "game.board.updated", tableId: table.id, reason: "bot-thinking" });
  try {
    const result = await chooseChessBotMove(table.state, table.bot.level);
    applyBoardTableAction(table, table.bot.userId, result.action);
    table.bot.engine = result.engine;
    table.bot.version = result.version;
    table.bot.lastMoveAt = Date.now();
    table.bot.lastError = null;
  } catch (error) {
    table.bot.lastError = String(error.message || error).slice(0, 300);
    console.error(`[Chess bot] ${table.bot.lastError}`);
  } finally {
    table.bot.thinking = false;
    table.updatedAt = Date.now();
    await persist();
    await broadcast(boardParticipants(table), { type: "game.board.updated", tableId: table.id, reason: "bot-move" });
  }
  return true;
}

function pokerParticipants(game) {
  return game.players.filter((player) => player.status !== "left").map((player) => player.userId);
}

function findPokerGame(gameId) {
  return db.pokerGames.find((item) => item.id === gameId);
}

function publicArcadeLeaderboard(game) {
  const best = new Map();
  for (const entry of db.arcadeScores.filter((item) => item.game === game)) {
    const previous = best.get(entry.userId);
    if (!previous || entry.score > previous.score) best.set(entry.userId, entry);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 50).map((entry, index) => ({ ...entry, place: index + 1 }));
}

async function handleApi(req, res, url, auth) {
  const { user } = auth;
  enforceRateLimit(req, user.id);
  const daily = ensureWallet(db, user.id);
  if (daily.dailyAwarded) {
    audit(user.id, "wallet.daily-bonus", "wallet", user.id, { amount: daily.dailyAwarded });
    await persist();
  }
  const path = url.pathname;
  const method = req.method;

  if (path === "/game-api/wallet" && method === "GET") {
    return sendJson(res, 200, { wallet: publicWallet(daily.wallet), dailyAwarded: daily.dailyAwarded });
  }

  if (path === "/game-api/arcade/leaderboard" && method === "GET") {
    const game = ["snake", "tetris"].includes(url.searchParams.get("game")) ? url.searchParams.get("game") : "snake";
    return sendJson(res, 200, { game, leaderboard: publicArcadeLeaderboard(game) });
  }

  if (path === "/game-api/arcade/score" && method === "POST") {
    const body = await parseBody(req);
    const game = ["snake", "tetris"].includes(body.game) ? body.game : null;
    const score = Math.max(0, Math.min(10_000_000, Math.floor(Number(body.score || 0))));
    if (!game) return fail(res, 400, "Неизвестная аркадная игра");
    const entry = { id: randomUUID(), game, userId: user.id, user, score, meta: body.meta && typeof body.meta === "object" ? body.meta : {}, createdAt: Date.now() };
    db.arcadeScores.push(entry);
    if (db.arcadeScores.length > 100_000) db.arcadeScores.splice(0, db.arcadeScores.length - 100_000);
    await persist();
    return sendJson(res, 201, { entry });
  }

  if (path === "/game-api/boards" && method === "GET") {
    const type = String(url.searchParams.get("type") || "");
    const tables = db.boardTables.filter((table) => !table.deletedAt && (!type || table.type === type)).sort((a, b) => b.updatedAt - a.updatedAt).map(summarizeBoardTable);
    return sendJson(res, 200, { tables, wallet: publicWallet(daily.wallet) });
  }

  if (path === "/game-api/boards" && method === "POST") {
    const body = await parseBody(req);
    const type = ["chess", "checkers"].includes(body.type) ? body.type : null;
    if (!type) return fail(res, 400, "Выберите шахматы или шашки");
    const botLevel = type === "chess" && Number(body.botLevel) >= 3 && Number(body.botLevel) <= 7 ? Number(body.botLevel) : null;
    const table = createBoardTable({ type, title: body.title, host: user, botLevel });
    db.boardTables.push(table);
    audit(user.id, "board-table.create", "board-table", table.id, { type, botLevel: table.bot?.level || null });
    await persist();
    await broadcast(boardParticipants(table), { type: "game.board.updated", tableId: table.id, reason: "created" });
    return sendJson(res, 201, { table: publicBoardTable(table, user.id) });
  }

  const boardMatch = path.match(/^\/game-api\/boards\/([^/]+)$/);
  if (boardMatch && method === "GET") {
    const table = db.boardTables.find((item) => item.id === boardMatch[1] && !item.deletedAt);
    if (!table) return fail(res, 404, "Игровой стол не найден");
    return sendJson(res, 200, { table: publicBoardTable(table, user.id) });
  }
  if (boardMatch && method === "DELETE") {
    const table = db.boardTables.find((item) => item.id === boardMatch[1] && !item.deletedAt);
    if (!table || (table.hostId !== user.id && !user.isSystemAdmin)) return fail(res, 403, "Удалить стол может создатель или администратор");
    table.deletedAt = Date.now();
    await persist();
    await broadcast(boardParticipants(table), { type: "game.board.deleted", tableId: table.id });
    return sendJson(res, 200, { ok: true });
  }

  const boardOperation = path.match(/^\/game-api\/boards\/([^/]+)\/(join|leave|action)$/);
  if (boardOperation && method === "POST") {
    const [, tableId, operation] = boardOperation;
    const table = db.boardTables.find((item) => item.id === tableId && !item.deletedAt);
    if (!table) return fail(res, 404, "Игровой стол не найден");
    try {
      if (operation === "join") joinBoardTable(table, user);
      else if (operation === "leave") leaveBoardTable(table, user.id);
      else {
        applyBoardTableAction(table, user.id, await parseBody(req));
        await maybeRunChessBot(table);
      }
    } catch (error) { return fail(res, 400, error.message); }
    await persist();
    await broadcast(boardParticipants(table), { type: "game.board.updated", tableId: table.id, reason: operation });
    return sendJson(res, 200, { table: publicBoardTable(table, user.id) });
  }

  if (path === "/game-api/poker/catalog" && method === "GET") {
    const myGames = db.pokerGames.filter((game) => game.players.some((player) => player.userId === user.id && player.status !== "left")).sort((a, b) => b.updatedAt - a.updatedAt).map(summarizePokerGame);
    return sendJson(res, 200, {
      wallet: publicWallet(daily.wallet), dailyAwarded: daily.dailyAwarded,
      tournaments: tournamentCatalog(db, user.id), cashTables: cashCatalog(db, user.id), myGames,
      notice: "Все фишки являются условными: их нельзя купить, продать, обменять или вывести.",
    });
  }

  if (path === "/game-api/poker/tournaments/join" && method === "POST") {
    const body = await parseBody(req);
    let game;
    try {
      game = findOrCreateWaitingTournament(db, { capacity: Number(body.capacity), speed: String(body.speed || "normal"), buyIn: Number(body.buyIn) });
      joinTournament(db, game, user);
    } catch (error) { return fail(res, 400, error.message); }
    audit(user.id, "poker.tournament.join", "poker-game", game.id, { capacity: game.capacity, speed: game.speed, buyIn: game.buyIn });
    await persist();
    await broadcast(pokerParticipants(game), { type: "game.poker.updated", gameId: game.id, reason: game.status === "running" ? "tournament-started" : "joined" });
    return sendJson(res, 200, { game: publicPokerGame(game, user.id), wallet: publicWallet(ensureWallet(db, user.id).wallet) });
  }

  if (path === "/game-api/poker/cash/join" && method === "POST") {
    const body = await parseBody(req);
    let game;
    try {
      game = findOrCreateCashGame(db, { smallBlind: Number(body.smallBlind), bigBlind: Number(body.bigBlind) });
      joinCashGame(db, game, user, Number(body.buyIn));
    } catch (error) { return fail(res, 400, error.message); }
    audit(user.id, "poker.cash.join", "poker-game", game.id, { blinds: game.blinds, buyIn: Number(body.buyIn) });
    await persist();
    await broadcast(pokerParticipants(game), { type: "game.poker.updated", gameId: game.id, reason: "joined" });
    return sendJson(res, 200, { game: publicPokerGame(game, user.id), wallet: publicWallet(ensureWallet(db, user.id).wallet) });
  }

  const pokerGameMatch = path.match(/^\/game-api\/poker\/games\/([^/]+)$/);
  if (pokerGameMatch && method === "GET") {
    const game = findPokerGame(pokerGameMatch[1]);
    if (!game) return fail(res, 404, "Игра не найдена");
    return sendJson(res, 200, { game: publicPokerGame(game, user.id), wallet: publicWallet(daily.wallet) });
  }

  const tournamentLeave = path.match(/^\/game-api\/poker\/tournaments\/([^/]+)\/leave$/);
  if (tournamentLeave && method === "POST") {
    const game = findPokerGame(tournamentLeave[1]);
    if (!game) return fail(res, 404, "Турнир не найден");
    try { leaveTournamentBeforeStart(db, game, user.id); } catch (error) { return fail(res, 400, error.message); }
    await persist();
    await broadcast(pokerParticipants(game), { type: "game.poker.updated", gameId: game.id, reason: "left" });
    return sendJson(res, 200, { game: publicPokerGame(game, user.id), wallet: publicWallet(ensureWallet(db, user.id).wallet) });
  }

  const pokerOperation = path.match(/^\/game-api\/poker\/games\/([^/]+)\/(action|leave|rebuy)$/);
  if (pokerOperation && method === "POST") {
    const [, gameId, operation] = pokerOperation;
    const game = findPokerGame(gameId);
    if (!game) return fail(res, 404, "Игра не найдена");
    try {
      const body = await parseBody(req);
      if (operation === "action") applyPokerAction(game, user.id, body);
      else if (operation === "leave") requestCashLeave(db, game, user.id);
      else cashRebuy(db, game, user.id, Number(body.amount));
    } catch (error) { return fail(res, 400, error.message); }
    await persist();
    await broadcast(pokerParticipants(game), { type: "game.poker.updated", gameId: game.id, reason: operation });
    return sendJson(res, 200, { game: publicPokerGame(game, user.id), wallet: publicWallet(ensureWallet(db, user.id).wallet) });
  }

  return fail(res, 404, "Маршрут игрового сервера не найден");
}

const metrics = { requests: 0, errors: 0, ticks: 0, broadcasts: 0 };
const server = http.createServer(async (req, res) => {
  securityHeaders(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true, service: "nemax-game-server", port: PORT, boardTables: db.boardTables.filter((item) => !item.deletedAt).length, pokerGames: db.pokerGames.length, stockfish: stockfishStatus(), storage: await store.health(), at: Date.now() });
  if (req.method === "GET" && url.pathname === "/metrics") {
    const body = [
      "# TYPE nemax_game_requests_total counter", `nemax_game_requests_total ${metrics.requests}`,
      "# TYPE nemax_game_errors_total counter", `nemax_game_errors_total ${metrics.errors}`,
      "# TYPE nemax_game_board_tables gauge", `nemax_game_board_tables ${db.boardTables.filter((item) => !item.deletedAt).length}`,
      "# TYPE nemax_game_poker_games gauge", `nemax_game_poker_games ${db.pokerGames.length}`,
    ].join("\n") + "\n";
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4", "Content-Length": Buffer.byteLength(body) });
    return res.end(body);
  }
  if (!url.pathname.startsWith("/game-api/")) return fail(res, 404, "Маршрут не найден");
  metrics.requests += 1;
  try {
    const auth = await authenticate(req);
    return await handleApi(req, res, url, auth);
  } catch (error) {
    metrics.errors += 1;
    if (error.name === "AbortError") return fail(res, 503, "Core API не отвечает");
    return fail(res, error.status || 500, error.message || "Ошибка игрового сервера");
  }
});

let ticking = false;
const tickTimer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    metrics.ticks += 1;
    const changed = tickPokerGames(db, Date.now());
    if (changed.length) {
      await persist();
      for (const gameId of changed) {
        const game = findPokerGame(gameId);
        if (!game) continue;
        metrics.broadcasts += 1;
        await broadcast(pokerParticipants(game), { type: "game.poker.updated", gameId, reason: "tick" });
      }
    }
  } catch (error) {
    console.error(`[Game Server] tick: ${error.stack || error.message}`);
  } finally {
    ticking = false;
  }
}, TICK_MS);
tickTimer.unref?.();

warnForDefaultInternalSecret("Game Server");
server.listen(PORT, HOST, () => {
  console.log(`NEMAX Game Server: http://${HOST}:${PORT}`);
  console.log(`Game API: http://${HOST}:${PORT}/game-api`);
  const sf = stockfishStatus();
  console.log(`[Chess bot] ${sf.available ? `${sf.version} (${sf.binary})` : "Stockfish binary не найден — включён встроенный резервный бот"}`);
});

async function shutdown() {
  clearInterval(tickTimer);
  try { await persistQueue; await store.close(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref?.();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
