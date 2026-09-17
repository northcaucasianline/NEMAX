import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { generateTotpSecret, sha256, verifyTotp } from "./security.js";
import { CODE_RUNNER_INTERNAL_URL, CODE_RUNNER_SOCKET, getInternalJson, postInternalJson } from "./internal-service.js";

const now = () => Date.now();
const unique = (items) => [...new Set((items || []).filter(Boolean))];
const text = (value, max = 10_000) => String(value ?? "").trim().slice(0, max);
const id = () => randomUUID();

function ensureCollections(db) {
  const names = [
    "drafts", "folders", "pushSubscriptions", "devices", "scheduledMessages", "stories", "calls",
    "bots", "botUpdates", "miniApps", "businessProfiles", "quickReplies", "boards", "boardPosts",
    "adminLogs", "invites", "topics", "auditLogs", "stickerPacks", "customEmoji",
    "blockedIps", "reports", "refreshFamilies", "uploadSessions", "linkPreviews", "gameProjects", "gameScores", "codeProjects", "codeRuns",
  ];
  for (const name of names) if (!Array.isArray(db[name])) db[name] = [];
  db.meta ||= { sequence: 0, createdAt: now() };
  db.meta.sequence ||= 0;
}

function nextSequence(db) {
  ensureCollections(db);
  db.meta.sequence += 1;
  return db.meta.sequence;
}

function recordAudit(db, actorId, action, targetType, targetId, details = {}) {
  db.auditLogs.push({ id: id(), actorId, action, targetType, targetId, details, createdAt: now() });
  if (db.auditLogs.length > 50_000) db.auditLogs.splice(0, db.auditLogs.length - 50_000);
}

function recordAdmin(db, chatId, actorId, action, targetUserId, details = {}) {
  db.adminLogs.push({ id: id(), chatId, actorId, action, targetUserId, details, createdAt: now() });
}

function roleFor(chat, userId) {
  if (chat.ownerId === userId) return "owner";
  const role = chat.roles?.[userId];
  if (role) return role;
  if (chat.admins?.includes(userId)) return "admin";
  return chat.participants?.includes(userId) ? "member" : "none";
}

const ROLE_RANK = { none: 0, restricted: 1, member: 2, moderator: 3, admin: 4, owner: 5 };
function canModerate(chat, actorId, targetId) {
  return ROLE_RANK[roleFor(chat, actorId)] >= 3 && ROLE_RANK[roleFor(chat, actorId)] > ROLE_RANK[roleFor(chat, targetId)];
}
function hasPermission(chat, userId, permission) {
  const role = roleFor(chat, userId);
  if (role === "owner") return true;
  const defaults = {
    admin: ["post", "delete", "pin", "invite", "manage_members", "manage_chat", "manage_topics", "view_stats"],
    moderator: ["delete", "pin", "invite", "manage_members", "manage_topics"],
    member: ["post", "invite"],
    restricted: [],
  };
  const custom = chat.rolePermissions?.[role];
  return (custom || defaults[role] || []).includes(permission);
}

function parseRoute(path, pattern) {
  const match = path.match(pattern);
  return match || null;
}


function normalizeGameConfig(type, input) {
  const source = input && typeof input === "object" ? input : {};
  if (type === "novel") {
    const rawScenes = Array.isArray(source.scenes) ? source.scenes.slice(0, 120) : [];
    const usedIds = new Set();
    const scenes = rawScenes.map((scene, index) => {
      let sceneId = text(scene?.id, 80) || `scene-${index + 1}`;
      while (usedIds.has(sceneId)) sceneId = `${sceneId}-${index + 1}`;
      usedIds.add(sceneId);
      return {
        id: sceneId,
        title: text(scene?.title, 100) || `Сцена ${index + 1}`,
        speaker: text(scene?.speaker, 80) || "Рассказчик",
        text: text(scene?.text, 8000),
        characterEmoji: text(scene?.characterEmoji, 16) || "🎭",
        background: text(scene?.background, 1500) || "#171333",
        choices: Array.isArray(scene?.choices) ? scene.choices.slice(0, 12).map((choice) => ({
          text: text(choice?.text, 240) || "Продолжить",
          nextSceneId: text(choice?.nextSceneId, 80),
          scoreDelta: Math.max(-1000, Math.min(1000, Number(choice?.scoreDelta || 0))),
        })) : [],
      };
    });
    if (!scenes.length) scenes.push({ id: "scene-1", title: "Начало", speaker: "Рассказчик", text: "Новая история начинается здесь…", characterEmoji: "🌙", background: "#171333", choices: [] });
    const validIds = new Set(scenes.map((scene) => scene.id));
    for (const scene of scenes) for (const choice of scene.choices) if (!validIds.has(choice.nextSceneId)) choice.nextSceneId = "";
    return { startSceneId: validIds.has(source.startSceneId) ? source.startSceneId : scenes[0].id, endingText: text(source.endingText, 160) || "Конец истории", scenes };
  }
  if (type === "quiz") {
    const questions = (Array.isArray(source.questions) ? source.questions : []).slice(0, 100).map((question) => ({
      text: text(question?.text, 1000),
      options: (Array.isArray(question?.options) ? question.options : []).slice(0, 8).map((option) => text(option, 300)),
      correctIndex: Math.max(0, Math.min(7, Number(question?.correctIndex || 0))),
    }));
    return { ...source, questions: questions.length ? questions : [{ text: "", options: ["", "", "", ""], correctIndex: 0 }] };
  }
  if (type === "clicker") return { duration: Math.max(5, Math.min(120, Number(source.duration || 15))), target: Math.max(1, Math.min(100000, Number(source.target || 50))), buttonLabel: text(source.buttonLabel, 40) || "Жми!" };
  if (type === "reaction") return { rounds: Math.max(1, Math.min(20, Number(source.rounds || 5))) };
  return {};
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash, passwordSalt, totpSecret, recoveryCodes, ...publicPart } = user;
  if (publicPart.statusExpiresAt && publicPart.statusExpiresAt <= now()) {
    publicPart.statusText = "";
    publicPart.statusEmoji = "";
    publicPart.statusExpiresAt = 0;
  }
  return publicPart;
}


function publicBoardPost(post, db) {
  const author = db.users.find((item) => item.id === post.authorId);
  const board = db.boards.find((item) => item.id === post.boardId);
  return {
    ...post,
    author: author ? { id: author.id, userId: author.userId, username: author.username, publicUsername: author.publicUsername || "", avatar: author.avatar || null, avatarKind: author.avatarKind || "image", avatarMimeType: author.avatarMimeType || "", avatarColor: author.avatarColor, status: author.status, statusText: author.statusText || "", statusEmoji: author.statusEmoji || "" } : null,
    board: board ? { id: board.id, title: board.title, city: board.city, interest: board.interest, tags: board.tags || [board.interest].filter(Boolean), description: board.description || "" } : null,
  };
}

function normalizeCodeFiles(files, language) {
  const allowed = language === "python" ? [".py", ".txt", ".json"] : language === "java" ? [".java", ".txt", ".json"] : [".js", ".mjs", ".html", ".css", ".json", ".txt"];
  let total = 0;
  const result = (Array.isArray(files) ? files : []).slice(0, 24).map((file, index) => {
    const path = String(file?.path || `file-${index + 1}.txt`).replaceAll("\\", "/").replace(/^\/+/, "").slice(0, 180);
    if (!path || path.startsWith("..") || path.includes("/../") || path.includes("\0")) throw Object.assign(new Error("Недопустимый путь файла"), { status: 400 });
    const lower = path.toLowerCase();
    if (!allowed.some((extension) => lower.endsWith(extension))) throw Object.assign(new Error(`Недопустимое расширение: ${path}`), { status: 400 });
    const content = String(file?.content ?? "").slice(0, 160_000);
    total += Buffer.byteLength(content);
    return { id: text(file?.id, 100) || id(), path, content };
  });
  if (!result.length) throw Object.assign(new Error("Добавьте хотя бы один файл"), { status: 400 });
  if (total > 240_000) throw Object.assign(new Error("Проект больше 240 КБ"), { status: 413 });
  return result;
}

function publicCodeProject(project, db) {
  return {
    ...project,
    owner: safeUser(db.users.find((item) => item.id === project.ownerId)),
    runs: db.codeRuns.filter((run) => run.projectId === project.id).length,
  };
}

function messageText(message) {
  return `${message.text || ""} ${message.name || ""} ${message.caption || ""}`.trim();
}

function mentionsFrom(value) {
  return [...String(value || "").matchAll(/(^|\s)@([a-zA-Z0-9_]{3,32})\b/g)].map((m) => m[2].toLowerCase());
}

function isPrivateHost(hostname) {
  if (["localhost", "0.0.0.0", "::1"].includes(hostname)) return true;
  const ip = isIP(hostname) ? hostname : "";
  return ip.startsWith("10.") || ip.startsWith("127.") || ip.startsWith("169.254.") || ip.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

async function linkPreview(urlString) {
  const url = new URL(urlString);
  if (!["http:", "https:"].includes(url.protocol) || isPrivateHost(url.hostname)) throw Object.assign(new Error("Недопустимая ссылка"), { status: 400 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "User-Agent": "NEMAXPreview/1.0" } });
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html")) return { url: response.url, title: url.hostname, description: type };
    const html = (await response.text()).slice(0, 300_000);
    const pick = (regex) => html.match(regex)?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
    return {
      url: response.url,
      title: pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || pick(/<title[^>]*>([\s\S]*?)<\/title>/i) || url.hostname,
      description: pick(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)/i).slice(0, 500),
      image: pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i),
      siteName: pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) || url.hostname,
    };
  } finally { clearTimeout(timer); }
}

export function createPlatformApi(context) {
  const {
    getDb, persist, sendJson, fail, parseBody, publicMessage, openMessage, sealMessage,
    isMember, broadcastUsers, broadcastChat, syncChat, redis, pushService, objectStorage,
    uploadTempDir, encryptBuffer,
  } = context;
  mkdirSync(uploadTempDir, { recursive: true });

  return async function platformApi(req, res, url, auth) {
    const db = getDb(); ensureCollections(db);
    const path = url.pathname; const method = req.method || "GET";
    const user = auth?.user;

    if (path === "/api/auth/refresh" && method === "POST") {
      const body = await parseBody(req);
      const refreshHash = sha256(body.refreshToken || "");
      const session = db.sessions.find((s) => s.refreshHash === refreshHash && !s.revokedAt && s.refreshExpiresAt > now());
      if (!session) return fail(res, 401, "Refresh-токен недействителен");
      const accessToken = randomBytes(32).toString("base64url");
      const refreshToken = randomBytes(48).toString("base64url");
      session.tokenHash = sha256(accessToken);
      session.refreshHash = sha256(refreshToken);
      session.accessExpiresAt = now() + Number(process.env.ACCESS_TOKEN_TTL_MS || 15 * 60 * 1000);
      session.refreshExpiresAt = now() + Number(process.env.REFRESH_TOKEN_TTL_MS || 30 * 24 * 60 * 60 * 1000);
      session.lastUsedAt = now();
      await persist();
      return sendJson(res, 200, { token: accessToken, refreshToken, expiresAt: session.accessExpiresAt });
    }

    const botUpdatesMatch = parseRoute(path, /^\/api\/bot\/([^/]+)\/getUpdates$/);
    if (botUpdatesMatch && (method === "GET" || method === "POST")) {
      const bot = db.bots.find((b) => b.tokenHash === sha256(decodeURIComponent(botUpdatesMatch[1])) && b.enabled);
      if (!bot) return fail(res, 401, "Токен бота недействителен");
      const body = method === "POST" ? await parseBody(req) : {};
      const offset = Number(body.offset ?? url.searchParams.get("offset") ?? 0);
      const limit = Math.min(100, Math.max(1, Number(body.limit ?? url.searchParams.get("limit") ?? 100)));
      if (offset > 0) db.botUpdates = db.botUpdates.filter((item) => item.botId !== bot.id || item.updateId >= offset);
      const updates = db.botUpdates.filter((item) => item.botId === bot.id && item.updateId >= offset).sort((a, b) => a.updateId - b.updateId).slice(0, limit);
      await persist();
      return sendJson(res, 200, { ok: true, result: updates.map((item) => ({ update_id: item.updateId, ...item.payload })) });
    }

    const botApiMatch = parseRoute(path, /^\/api\/bot\/([^/]+)\/sendMessage$/);
    if (botApiMatch && method === "POST") {
      const bot = db.bots.find((b) => b.tokenHash === sha256(decodeURIComponent(botApiMatch[1])) && b.enabled);
      if (!bot) return fail(res, 401, "Токен бота недействителен");
      const body = await parseBody(req); const chat = db.chats.find((c) => c.id === body.chatId && c.participants.includes(bot.botUserId));
      if (!chat) return fail(res, 403, "Бот не добавлен в чат");
      const opened = { id: id(), chatId: chat.id, senderId: bot.botUserId, botId: bot.id, type: "text", text: text(body.text, 4096), replyToId: body.replyToId || null, timestamp: now(), edited: false, hiddenFor: [], reactions: {}, sequence: nextSequence(db) };
      if (!opened.text) return fail(res, 400, "Пустое сообщение");
      const stored = sealMessage(opened); db.messages.push(stored); chat.updatedAt = now(); await persist(); broadcastChat(chat, { type: "message.created", chatId: chat.id, message: publicMessage(stored), at: now() });
      return sendJson(res, 201, { ok: true, result: publicMessage(stored) });
    }

    if (!user) return false;

    if (path === "/api/uploads/init" && method === "POST") {
      const body = await parseBody(req);
      const size = Number(body.size || 0);
      const maxUploadBytes = Number(db.systemSettings?.maxUploadBytes || process.env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024);
      if (!size || size > maxUploadBytes) return fail(res, 400, `Некорректный размер файла. Лимит: ${maxUploadBytes} байт`);
      const dangerous = /\.(exe|dll|bat|cmd|ps1|scr|com|msi|jar)$/i.test(String(body.name || ""));
      if (dangerous) return fail(res, 415, "Исполняемые файлы запрещены");
      const upload = { id: id(), userId: user.id, name: text(body.name, 255) || "file.bin", mimeType: text(body.mimeType, 120) || "application/octet-stream", size, received: 0, nextPart: 0, status: "uploading", createdAt: now(), expiresAt: now() + 24 * 3600 * 1000 };
      upload.tempPath = join(uploadTempDir, `${upload.id}.part`);
      db.uploadSessions.push(upload); await persist(); return sendJson(res, 201, { upload: { ...upload, tempPath: undefined }, chunkSize: Number(process.env.UPLOAD_CHUNK_BYTES || 2 * 1024 * 1024) });
    }
    const uploadChunk = parseRoute(path, /^\/api\/uploads\/([^/]+)\/chunk$/);
    if (uploadChunk && method === "POST") {
      const upload = db.uploadSessions.find((u) => u.id === uploadChunk[1] && u.userId === user.id && u.status === "uploading");
      if (!upload || upload.expiresAt <= now()) return fail(res, 404, "Сессия загрузки не найдена");
      const body = await parseBody(req); const part = Number(body.part); if (part !== upload.nextPart) return fail(res, 409, "Неверный номер части", { expectedPart: upload.nextPart });
      const buffer = Buffer.from(String(body.data || ""), "base64"); if (!buffer.length || buffer.length > Number(process.env.UPLOAD_CHUNK_BYTES || 2 * 1024 * 1024) * 1.1) return fail(res, 413, "Некорректная часть файла");
      appendFileSync(upload.tempPath, buffer); upload.received += buffer.length; upload.nextPart += 1; upload.updatedAt = now();
      if (upload.received > upload.size) { try { unlinkSync(upload.tempPath); } catch {} upload.status = "failed"; await persist(); return fail(res, 400, "Получено больше данных, чем заявлено"); }
      await persist(); return sendJson(res, 202, { received: upload.received, nextPart: upload.nextPart, complete: upload.received === upload.size });
    }
    const uploadStatus = parseRoute(path, /^\/api\/uploads\/([^/]+)$/);
    if (uploadStatus && method === "GET") {
      const upload = db.uploadSessions.find((u) => u.id === uploadStatus[1] && u.userId === user.id); if (!upload) return fail(res, 404, "Загрузка не найдена");
      return sendJson(res, 200, { upload: { ...upload, tempPath: undefined } });
    }
    const uploadComplete = parseRoute(path, /^\/api\/uploads\/([^/]+)\/complete$/);
    if (uploadComplete && method === "POST") {
      const upload = db.uploadSessions.find((u) => u.id === uploadComplete[1] && u.userId === user.id && u.status === "uploading");
      if (!upload || !existsSync(upload.tempPath) || statSync(upload.tempPath).size !== upload.size) return fail(res, 409, "Файл загружен не полностью");
      const plain = readFileSync(upload.tempPath); const encrypted = encryptBuffer(plain, `object:${upload.id}`); const key = `${new Date().toISOString().slice(0, 10)}/${upload.id}.menc`;
      await objectStorage.put(key, encrypted.ciphertext, "application/octet-stream"); unlinkSync(upload.tempPath); upload.status = "completed"; upload.objectKey = key; upload.fileEncryption = encrypted.envelope; upload.completedAt = now(); await persist();
      return sendJson(res, 200, { content: `/api/objects/${encodeURIComponent(key)}`, name: upload.name, mimeType: upload.mimeType, size: upload.size, fileEncryption: upload.fileEncryption });
    }

    if (path === "/api/sync" && method === "GET") {
      const cursor = Number(url.searchParams.get("cursor") || 0);
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || 250)));
      const chatIds = new Set(db.chats.filter((chat) => isMember(chat, user.id)).map((chat) => chat.id));
      const events = [];
      for (const chat of db.chats) if (chatIds.has(chat.id) && Number(chat.sequence || 0) > cursor) events.push({ sequence: chat.sequence, type: "chat", data: chat });
      for (const stored of db.messages) if (chatIds.has(stored.chatId) && Number(stored.sequence || 0) > cursor) events.push({ sequence: stored.sequence, type: "message", data: publicMessage(stored) });
      events.sort((a, b) => a.sequence - b.sequence);
      const slice = events.slice(0, limit);
      return sendJson(res, 200, { cursor: slice.at(-1)?.sequence || cursor, latest: db.meta.sequence, hasMore: events.length > limit, events: slice });
    }

    const readMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/read$/);
    if (readMatch && method === "POST") {
      const chat = db.chats.find((c) => c.id === readMatch[1]);
      if (!chat || !isMember(chat, user.id)) return fail(res, 404, "Чат не найден");
      const body = await parseBody(req);
      chat.readState ||= {};
      const lastMessage = body.messageId ? db.messages.find((m) => m.id === body.messageId && m.chatId === chat.id) : db.messages.filter((m) => m.chatId === chat.id).sort((a, b) => b.timestamp - a.timestamp)[0];
      const readAt = now();
      const readSequence = Number(lastMessage?.sequence || chat.sequence || 0);
      chat.readState[user.id] = { messageId: lastMessage?.id || null, readAt, sequence: readSequence };
      for (const stored of db.messages) {
        if (stored.chatId !== chat.id || stored.senderId === user.id || Number(stored.sequence || 0) > readSequence) continue;
        stored.deliveredTo ||= {};
        stored.viewedBy ||= {};
        stored.deliveredTo[user.id] ||= readAt;
        stored.viewedBy[user.id] ||= readAt;
      }
      chat.sequence = nextSequence(db);
      await persist();
      broadcastUsers(chat.participants.filter((uid) => uid !== user.id), { type: "message.read", chatId: chat.id, userId: user.id, ...chat.readState[user.id], at: readAt });
      return sendJson(res, 200, { readState: chat.readState[user.id] });
    }

    const deliveredMatch = parseRoute(path, /^\/api\/messages\/([^/]+)\/delivered$/);
    if (deliveredMatch && method === "POST") {
      const stored = db.messages.find((m) => m.id === deliveredMatch[1]);
      const chat = db.chats.find((c) => c.id === stored?.chatId);
      if (!stored || !chat || !isMember(chat, user.id)) return fail(res, 404, "Сообщение не найдено");
      stored.deliveredTo ||= {};
      stored.deliveredTo[user.id] = now();
      stored.sequence = nextSequence(db);
      await persist();
      broadcastUsers([stored.senderId], { type: "message.delivered", chatId: chat.id, messageId: stored.id, userId: user.id, deliveredAt: stored.deliveredTo[user.id] });
      return sendJson(res, 200, { ok: true });
    }

    const typingMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/typing$/);
    if (typingMatch && method === "POST") {
      const chat = db.chats.find((c) => c.id === typingMatch[1]);
      if (!chat || !isMember(chat, user.id)) return fail(res, 404, "Чат не найден");
      const body = await parseBody(req);
      broadcastUsers(chat.participants.filter((uid) => uid !== user.id), { type: "typing", chatId: chat.id, userId: user.id, state: text(body.state, 20) || "typing", expiresAt: now() + 5000 });
      return sendJson(res, 202, { ok: true });
    }

    const draftMatch = parseRoute(path, /^\/api\/drafts\/([^/]+)$/);
    if (draftMatch && method === "GET") {
      const draft = db.drafts.find((d) => d.userId === user.id && d.chatId === draftMatch[1]);
      return sendJson(res, 200, { draft: draft || null });
    }
    if (draftMatch && (method === "PUT" || method === "DELETE")) {
      const chat = db.chats.find((c) => c.id === draftMatch[1]);
      if (!chat || !isMember(chat, user.id)) return fail(res, 404, "Чат не найден");
      db.drafts = db.drafts.filter((d) => !(d.userId === user.id && d.chatId === chat.id));
      if (method === "PUT") {
        const body = await parseBody(req);
        db.drafts.push({ id: id(), userId: user.id, chatId: chat.id, text: String(body.text || "").slice(0, 20_000), replyToId: body.replyToId || null, updatedAt: now() });
      }
      await persist();
      broadcastUsers([user.id], { type: "draft.updated", chatId: chat.id, at: now() });
      return sendJson(res, 200, { ok: true });
    }

    const blockUserMatch = parseRoute(path, /^\/api\/users\/([^/]+)\/block$/);
    if (blockUserMatch && method === "POST") {
      if (blockUserMatch[1] === user.id) return fail(res, 400, "Нельзя заблокировать себя");
      user.blockedUsers ||= []; user.blockedUsers = user.blockedUsers.includes(blockUserMatch[1]) ? user.blockedUsers.filter((uid) => uid !== blockUserMatch[1]) : [...user.blockedUsers, blockUserMatch[1]];
      await persist(); return sendJson(res, 200, { blocked: user.blockedUsers.includes(blockUserMatch[1]) });
    }
    if (path === "/api/account" && method === "DELETE") {
      const body = await parseBody(req); if (text(body.confirm, 50) !== user.login) return fail(res, 400, "Для удаления укажите свой логин в confirm");
      db.users = db.users.filter((u) => u.id !== user.id); db.sessions = db.sessions.filter((session) => session.userId !== user.id);
      for (const chat of db.chats) { chat.participants = chat.participants.filter((uid) => uid !== user.id); chat.admins = (chat.admins || []).filter((uid) => uid !== user.id); }
      recordAudit(db, user.id, "account.deleted", "user", user.id); await persist(); return sendJson(res, 200, { ok: true });
    }

    if (path === "/api/folders" && method === "GET") return sendJson(res, 200, { folders: db.folders.filter((f) => f.userId === user.id) });
    if (path === "/api/folders" && method === "POST") {
      const body = await parseBody(req);
      const folder = { id: id(), userId: user.id, title: text(body.title, 60) || "Папка", includeTypes: body.includeTypes || [], includeChatIds: unique(body.includeChatIds), excludeChatIds: unique(body.excludeChatIds), order: Number(body.order || 0), createdAt: now() };
      db.folders.push(folder); await persist(); return sendJson(res, 201, { folder });
    }
    const folderMatch = parseRoute(path, /^\/api\/folders\/([^/]+)$/);
    if (folderMatch && ["PATCH", "DELETE"].includes(method)) {
      const folder = db.folders.find((f) => f.id === folderMatch[1] && f.userId === user.id);
      if (!folder) return fail(res, 404, "Папка не найдена");
      if (method === "DELETE") db.folders = db.folders.filter((f) => f.id !== folder.id);
      else Object.assign(folder, await parseBody(req), { id: folder.id, userId: user.id });
      await persist(); return sendJson(res, 200, { folder: method === "DELETE" ? null : folder });
    }

    const publicJoinMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/join-public$/);
    if (publicJoinMatch && method === "POST") {
      const chat = db.chats.find((item) => item.id === publicJoinMatch[1] && ["group", "channel", "room"].includes(item.type));
      if (!chat) return fail(res, 404, "Группа, паблик или комната не найдены");
      if (chat.participants.includes(user.id)) return sendJson(res, 200, { chat, joined: true });
      if (chat.requiresApproval) {
        chat.pendingRequests ||= [];
        if (!chat.pendingRequests.some((item) => item.userId === user.id)) chat.pendingRequests.push({ userId: user.id, createdAt: now(), source: "global-search" });
        await persist(); return sendJson(res, 202, { pending: true });
      }
      chat.participants.push(user.id); chat.roles ||= {}; chat.roles[user.id] = "member"; chat.updatedAt = now(); chat.sequence = nextSequence(db); await persist(); syncChat(chat, "member.joined");
      return sendJson(res, 200, { chat, joined: true });
    }

    const archiveMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/archive$/);
    if (archiveMatch && method === "POST") {
      const chat = db.chats.find((c) => c.id === archiveMatch[1]);
      if (!chat || !isMember(chat, user.id)) return fail(res, 404, "Чат не найден");
      chat.archivedBy ||= [];
      chat.archivedBy = chat.archivedBy.includes(user.id) ? chat.archivedBy.filter((uid) => uid !== user.id) : [...chat.archivedBy, user.id];
      await persist(); return sendJson(res, 200, { archived: chat.archivedBy.includes(user.id) });
    }

    if (path === "/api/search/global" && method === "GET") {
      const q = text(url.searchParams.get("q"), 200).toLowerCase();
      const senderId = url.searchParams.get("senderId"); const type = url.searchParams.get("type");
      const from = Number(url.searchParams.get("from") || 0); const to = Number(url.searchParams.get("to") || Number.MAX_SAFE_INTEGER);
      const memberChats = db.chats.filter((c) => isMember(c, user.id));
      const memberChatIds = new Set(memberChats.map((c) => c.id));
      const publicChats = db.chats.filter((c) => ["group", "channel", "room"].includes(c.type));
      const users = db.users
        .filter((u) => u.id !== user.id && (!q || `${u.username} ${u.publicUsername || ""} ${u.userId || ""} ${u.bio || ""} ${u.city || ""} ${u.statusText || ""}`.toLowerCase().includes(q)))
        .slice(0, 80).map(safeUser);
      const chats = [...new Map([...memberChats, ...publicChats].map((chat) => [chat.id, chat])).values()]
        .filter((chat) => !q || `${chat.title || ""} ${chat.username || ""} ${chat.description || ""} ${chat.city || ""} ${(chat.tags || []).join(" ")}`.toLowerCase().includes(q))
        .slice(0, 80)
        .map((chat) => ({ ...chat, joined: isMember(chat, user.id), participantCount: chat.participants?.length || 0 }));
      const allMessages = db.messages.filter((m) => memberChatIds.has(m.chatId) && m.timestamp >= from && m.timestamp <= to)
        .map(publicMessage).filter((m) => (!q || messageText(m).toLowerCase().includes(q)) && (!senderId || m.senderId === senderId));
      const messages = allMessages.filter((m) => !type || m.type === type).slice(-500).reverse();
      const mediaTypes = new Set(["image", "video", "file", "audio", "voice", "album", "gif", "sticker"]);
      const media = allMessages.filter((m) => mediaTypes.has(m.type) && (!type || m.type === type)).slice(-300).reverse().map((m) => {
        const chat = db.chats.find((item) => item.id === m.chatId);
        return { ...m, chat: chat ? { id: chat.id, title: chat.title, type: chat.type } : null };
      });
      const boards = db.boards.filter((board) => !q || `${board.title} ${board.city} ${board.interest} ${(board.tags || []).join(" ")} ${board.description || ""}`.toLowerCase().includes(q)).slice(0, 80);
      const boardPosts = db.boardPosts.filter((post) => post.status !== "deleted" && (!q || `${post.title} ${post.text} ${post.city} ${post.interest} ${post.tags?.join(" ") || ""}`.toLowerCase().includes(q))).sort((a,b) => b.createdAt-a.createdAt).slice(0, 100).map((post) => publicBoardPost(post, db));
      const codeProjects = db.codeProjects.filter((project) => project.published && !project.deletedAt && (!q || `${project.title} ${project.description || ""} ${(project.tags || []).join(" ")} ${project.language}`.toLowerCase().includes(q))).slice(0, 80).map((project) => publicCodeProject(project, db));
      return sendJson(res, 200, { users, chats, messages, media, boards, boardPosts, codeProjects });
    }


    if (path === "/api/rooms" && method === "GET") {
      const q = text(url.searchParams.get("q"), 200).toLowerCase();
      const city = text(url.searchParams.get("city"), 180).toLowerCase();
      const tag = text(url.searchParams.get("tag"), 60).toLowerCase();
      const mode = text(url.searchParams.get("mode"), 20);
      const rooms = db.chats.filter((chat) => chat.type === "room" && !chat.deletedAt)
        .filter((chat) => !city || String(chat.city || "").toLowerCase() === city)
        .filter((chat) => !tag || (chat.tags || []).some((item) => item.toLowerCase() === tag))
        .filter((chat) => !mode || chat.roomMode === mode)
        .filter((chat) => !q || `${chat.title} ${chat.description || ""} ${chat.city || ""} ${(chat.tags || []).join(" ")}`.toLowerCase().includes(q))
        .sort((a,b) => Number(b.activeAt || b.updatedAt || 0) - Number(a.activeAt || a.updatedAt || 0))
        .slice(0, 200)
        .map((chat) => ({ ...chat, joined: isMember(chat, user.id), participantCount: chat.participants?.length || 0, full: (chat.participants?.length || 0) >= Number(chat.capacity || 200) }));
      const cities = [...new Set(db.chats.filter((chat) => chat.type === "room").map((chat) => chat.city).filter(Boolean))].sort();
      const tags = [...new Set(db.chats.filter((chat) => chat.type === "room").flatMap((chat) => chat.tags || []))].sort((a,b) => a.localeCompare(b, "ru"));
      return sendJson(res, 200, { rooms, cities, tags });
    }

    if (path === "/api/rooms" && method === "POST") {
      const body = await parseBody(req);
      const title = text(body.title, 100);
      const city = text(body.city, 180);
      const tags = unique((body.tags || []).map((item) => text(item, 36))).slice(0, 10);
      const roomMode = ["text", "voice", "game"].includes(body.roomMode) ? body.roomMode : "text";
      if (!title || !city || !tags.length) return fail(res, 400, "Название, город и хотя бы один тег обязательны");
      const capacity = Math.min(5000, Math.max(2, Number(body.capacity || 100)));
      const room = {
        id: id(), type: "room", title, description: text(body.description, 1200), city, tags, roomMode,
        capacity, gameId: body.gameId || null, public: body.public !== false, participants: [user.id], ownerId: user.id,
        admins: [user.id], roles: { [user.id]: "owner" }, rolePermissions: {}, avatarColor: text(body.color, 32) || "#36d1a2",
        avatar: null, updatedAt: now(), activeAt: now(), mutedBy: [], pinnedMessageId: null, inviteCode: randomBytes(8).toString("base64url"),
        requiresApproval: Boolean(body.requiresApproval), pendingRequests: [], readState: {}, archivedBy: [], autoDeleteSeconds: 0,
        slowModeSeconds: Math.max(0, Number(body.slowModeSeconds || 0)), restrictions: {}, bans: {}, sequence: nextSequence(db),
      };
      db.chats.push(room); recordAudit(db, user.id, "room.create", "chat", room.id, { city, tags, roomMode }); await persist(); syncChat(room, "room.created");
      return sendJson(res, 201, { room });
    }

    const roomAction = parseRoute(path, /^\/api\/rooms\/([^/]+)\/(join|leave)$/);
    if (roomAction && method === "POST") {
      const [, roomId, action] = roomAction;
      const room = db.chats.find((chat) => chat.id === roomId && chat.type === "room" && !chat.deletedAt);
      if (!room) return fail(res, 404, "Комната не найдена");
      if (action === "leave") {
        if (room.ownerId === user.id) return fail(res, 400, "Владелец должен передать комнату или удалить её");
        room.participants = room.participants.filter((uid) => uid !== user.id); delete room.roles?.[user.id]; room.updatedAt = now(); room.sequence = nextSequence(db); await persist(); syncChat(room, "room.left");
        return sendJson(res, 200, { left: true });
      }
      if (isMember(room, user.id)) return sendJson(res, 200, { joined: true, room });
      if ((room.participants?.length || 0) >= Number(room.capacity || 100)) return fail(res, 409, "Комната заполнена");
      if (room.requiresApproval) {
        room.pendingRequests ||= [];
        if (!room.pendingRequests.some((item) => item.userId === user.id)) room.pendingRequests.push({ userId: user.id, requestedAt: now(), source: "rooms" });
        await persist(); return sendJson(res, 202, { pending: true });
      }
      room.participants.push(user.id); room.roles ||= {}; room.roles[user.id] = "member"; room.activeAt = now(); room.updatedAt = now(); room.sequence = nextSequence(db); await persist(); syncChat(room, "room.joined");
      return sendJson(res, 200, { joined: true, room });
    }

    const roomMatch = parseRoute(path, /^\/api\/rooms\/([^/]+)$/);
    if (roomMatch && method === "PATCH") {
      const room = db.chats.find((chat) => chat.id === roomMatch[1] && chat.type === "room" && !chat.deletedAt);
      if (!room || ![room.ownerId, ...(room.admins || [])].includes(user.id)) return fail(res, 403, "Недостаточно прав");
      const body = await parseBody(req);
      if (body.title !== undefined) room.title = text(body.title, 100) || room.title;
      if (body.description !== undefined) room.description = text(body.description, 1200);
      if (body.city !== undefined) room.city = text(body.city, 180) || room.city;
      if (Array.isArray(body.tags)) room.tags = unique(body.tags.map((item) => text(item, 36))).slice(0, 10);
      if (["text", "voice", "game"].includes(body.roomMode)) room.roomMode = body.roomMode;
      if (body.capacity !== undefined) room.capacity = Math.min(5000, Math.max(room.participants.length, Number(body.capacity || room.capacity)));
      room.updatedAt = now(); room.sequence = nextSequence(db); await persist(); syncChat(room, "room.updated");
      return sendJson(res, 200, { room });
    }
    if (roomMatch && method === "DELETE") {
      const room = db.chats.find((chat) => chat.id === roomMatch[1] && chat.type === "room" && !chat.deletedAt);
      if (!room || (room.ownerId !== user.id && !user.isSystemAdmin)) return fail(res, 403, "Удалить комнату может владелец или администратор");
      room.deletedAt = now(); room.participants = []; db.messages = db.messages.filter((message) => message.chatId !== room.id); recordAudit(db, user.id, "room.delete", "chat", room.id); await persist();
      return sendJson(res, 200, { ok: true });
    }

    if (path === "/api/code/status" && method === "GET") {
      try {
        const runner = await getInternalJson(CODE_RUNNER_INTERNAL_URL, "/health", { timeoutMs: 1800, socketPath: CODE_RUNNER_SOCKET });
        return sendJson(res, 200, { runner: { reachable: true, ...runner }, browserJavaScript: true });
      } catch (error) {
        return sendJson(res, 200, { runner: { reachable: false, enabled: false, error: error.message }, browserJavaScript: true });
      }
    }

    if (path === "/api/code/projects" && method === "GET") {
      const q = text(url.searchParams.get("q"), 120).toLowerCase();
      const language = text(url.searchParams.get("language"), 24);
      const mine = url.searchParams.get("mine") === "1";
      const projects = db.codeProjects
        .filter((project) => !project.deletedAt && (project.published || project.ownerId === user.id))
        .filter((project) => !mine || project.ownerId === user.id)
        .filter((project) => !language || project.language === language)
        .filter((project) => !q || `${project.title} ${project.description || ""} ${(project.tags || []).join(" ")} ${project.language} ${project.appType}`.toLowerCase().includes(q))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .slice(0, 200)
        .map((project) => publicCodeProject(project, db));
      return sendJson(res, 200, { projects });
    }

    if (path === "/api/code/projects" && method === "POST") {
      const body = await parseBody(req);
      const language = ["javascript", "python", "java"].includes(body.language) ? body.language : "javascript";
      const files = normalizeCodeFiles(body.files, language);
      const entryFile = text(body.entryFile, 180) || files[0].path;
      if (!files.some((file) => file.path === entryFile)) return fail(res, 400, "Стартовый файл отсутствует");
      const title = text(body.title, 100);
      if (!title) return fail(res, 400, "Введите название приложения");
      const project = {
        id: id(), ownerId: user.id, title, description: text(body.description, 1200), language,
        appType: ["console", "web", "game"].includes(body.appType) ? body.appType : "console",
        coverEmoji: text(body.coverEmoji, 12) || "⌘", accentColor: text(body.accentColor, 32) || "#56d6ff",
        tags: unique((body.tags || []).map((item) => text(item, 36))).slice(0, 10),
        files, entryFile, published: Boolean(body.published), createdAt: now(), updatedAt: now(), lastRunAt: 0,
      };
      db.codeProjects.push(project); recordAudit(db, user.id, "code-project.create", "code-project", project.id, { language, appType: project.appType });
      await persist(); return sendJson(res, 201, { project: publicCodeProject(project, db) });
    }

    if (path === "/api/code/run" && method === "POST") {
      const body = await parseBody(req);
      const recentRuns = db.codeRuns.filter((run) => run.userId === user.id && run.createdAt > now() - 60_000).length;
      if (recentRuns >= 20) return fail(res, 429, "Не более 20 запусков кода в минуту");
      let source = body;
      let project = null;
      if (body.projectId) {
        project = db.codeProjects.find((item) => item.id === body.projectId && !item.deletedAt);
        if (!project || (!project.published && project.ownerId !== user.id)) return fail(res, 404, "Проект не найден");
        if (project.ownerId !== user.id && body.files) return fail(res, 403, "Нельзя изменять чужой проект при запуске");
        source = project.ownerId === user.id && Array.isArray(body.files) ? { ...project, ...body } : { ...project, stdin: body.stdin };
      }
      const language = ["javascript", "python", "java"].includes(source.language) ? source.language : "javascript";
      const files = normalizeCodeFiles(source.files, language);
      const entryFile = text(source.entryFile, 180) || files[0].path;
      try {
        const result = await postInternalJson(CODE_RUNNER_INTERNAL_URL, "/internal/run", { language, files, entryFile, stdin: text(body.stdin, 20_000) }, { timeoutMs: 12_000, socketPath: CODE_RUNNER_SOCKET });
        const run = { id: id(), projectId: project?.id || null, userId: user.id, language, exitCode: result.exitCode, timedOut: Boolean(result.timedOut), durationMs: Number(result.durationMs || 0), outputBytes: Buffer.byteLength(`${result.stdout || ""}${result.stderr || ""}`), createdAt: now() };
        db.codeRuns.push(run); if (db.codeRuns.length > 20_000) db.codeRuns.splice(0, db.codeRuns.length - 20_000);
        if (project) project.lastRunAt = now();
        await persist(); return sendJson(res, 200, { result, run });
      } catch (error) {
        return fail(res, 503, `Среда исполнения недоступна: ${error.message}`);
      }
    }

    const codeAction = parseRoute(path, /^\/api\/code\/projects\/([^/]+)\/(publish|runs)$/);
    if (codeAction) {
      const [, projectId, action] = codeAction;
      const project = db.codeProjects.find((item) => item.id === projectId && !item.deletedAt);
      if (!project || project.ownerId !== user.id) return fail(res, 404, "Проект не найден");
      if (action === "publish" && method === "POST") {
        project.published = !project.published; project.updatedAt = now(); recordAudit(db, user.id, project.published ? "code-project.publish" : "code-project.unpublish", "code-project", project.id); await persist();
        return sendJson(res, 200, { project: publicCodeProject(project, db) });
      }
      if (action === "runs" && method === "GET") return sendJson(res, 200, { runs: db.codeRuns.filter((run) => run.projectId === project.id).slice(-50).reverse() });
    }

    const codeProjectMatch = parseRoute(path, /^\/api\/code\/projects\/([^/]+)$/);
    if (codeProjectMatch && method === "GET") {
      const project = db.codeProjects.find((item) => item.id === codeProjectMatch[1] && !item.deletedAt);
      if (!project || (!project.published && project.ownerId !== user.id)) return fail(res, 404, "Проект не найден");
      return sendJson(res, 200, { project: publicCodeProject(project, db) });
    }
    if (codeProjectMatch && method === "PATCH") {
      const project = db.codeProjects.find((item) => item.id === codeProjectMatch[1] && !item.deletedAt);
      if (!project || project.ownerId !== user.id) return fail(res, 403, "Редактировать проект может только автор");
      const body = await parseBody(req);
      const language = ["javascript", "python", "java"].includes(body.language) ? body.language : project.language;
      if (body.title !== undefined) project.title = text(body.title, 100) || project.title;
      if (body.description !== undefined) project.description = text(body.description, 1200);
      if (body.language !== undefined) project.language = language;
      if (body.appType !== undefined && ["console", "web", "game"].includes(body.appType)) project.appType = body.appType;
      if (body.coverEmoji !== undefined) project.coverEmoji = text(body.coverEmoji, 12) || project.coverEmoji;
      if (body.accentColor !== undefined) project.accentColor = text(body.accentColor, 32) || project.accentColor;
      if (Array.isArray(body.tags)) project.tags = unique(body.tags.map((item) => text(item, 36))).slice(0, 10);
      if (Array.isArray(body.files)) project.files = normalizeCodeFiles(body.files, language);
      if (body.entryFile !== undefined) project.entryFile = text(body.entryFile, 180);
      if (!project.files.some((file) => file.path === project.entryFile)) project.entryFile = project.files[0].path;
      project.updatedAt = now(); await persist(); return sendJson(res, 200, { project: publicCodeProject(project, db) });
    }
    if (codeProjectMatch && method === "DELETE") {
      const project = db.codeProjects.find((item) => item.id === codeProjectMatch[1] && !item.deletedAt);
      if (!project || (project.ownerId !== user.id && !user.isSystemAdmin)) return fail(res, 403, "Удалить проект может автор или администратор");
      project.deletedAt = now(); recordAudit(db, user.id, "code-project.delete", "code-project", project.id); await persist(); return sendJson(res, 200, { ok: true });
    }


    if ((path.startsWith("/api/arcade/") || path.startsWith("/api/game-tables")) && ["GET", "POST", "DELETE"].includes(method)) {
      return fail(res, 410, "Игровые маршруты перенесены на отдельный Game Server по адресу /game-api");
    }

    if (path === "/api/games" && method === "GET") {
      const q = text(url.searchParams.get("q"), 120).toLowerCase();
      const tag = text(url.searchParams.get("tag"), 40).toLowerCase();
      const mine = url.searchParams.get("mine") === "1";
      const games = db.gameProjects.filter((game) => !game.deletedAt && (game.published || game.ownerId === user.id))
        .filter((game) => !mine || game.ownerId === user.id)
        .filter((game) => !tag || (game.tags || []).some((item) => item.toLowerCase() === tag))
        .filter((game) => !q || `${game.title} ${game.description || ""} ${(game.tags || []).join(" ")}`.toLowerCase().includes(q))
        .sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .map((game) => ({ ...game, owner: safeUser(db.users.find((item) => item.id === game.ownerId)), plays: db.gameScores.filter((score) => score.gameId === game.id).length, bestScore: Math.max(0, ...db.gameScores.filter((score) => score.gameId === game.id).map((score) => Number(score.score || 0))) }));
      const tags = [...new Set(db.gameProjects.flatMap((game) => game.tags || []))].sort((a,b) => a.localeCompare(b, "ru"));
      return sendJson(res, 200, { games, tags });
    }

    if (path === "/api/games" && method === "POST") {
      const body = await parseBody(req);
      const type = ["quiz", "clicker", "reaction", "novel"].includes(body.type) ? body.type : "quiz";
      const title = text(body.title, 100);
      if (!title) return fail(res, 400, "Введите название игры");
      const game = { id: id(), ownerId: user.id, title, description: text(body.description, 1000), type, coverEmoji: text(body.coverEmoji, 12) || "🎮", accentColor: text(body.accentColor, 32) || "#7c5cff", tags: unique((body.tags || []).map((item) => text(item, 36))).slice(0, 8), config: normalizeGameConfig(type, body.config), published: Boolean(body.published), createdAt: now(), updatedAt: now() };
      db.gameProjects.push(game); recordAudit(db, user.id, "game.create", "game", game.id); await persist();
      return sendJson(res, 201, { game });
    }

    const gameAction = parseRoute(path, /^\/api\/games\/([^/]+)\/(publish|score|leaderboard)$/);
    if (gameAction) {
      const [, gameId, action] = gameAction;
      const game = db.gameProjects.find((item) => item.id === gameId && !item.deletedAt);
      if (!game || (!game.published && game.ownerId !== user.id)) return fail(res, 404, "Игра не найдена");
      if (action === "leaderboard" && method === "GET") {
        const best = new Map();
        for (const score of db.gameScores.filter((item) => item.gameId === game.id)) if (!best.has(score.userId) || best.get(score.userId).score < score.score) best.set(score.userId, score);
        const leaderboard = [...best.values()].sort((a,b) => b.score-a.score || a.durationMs-b.durationMs).slice(0, 50).map((score, index) => ({ ...score, place: index+1, user: safeUser(db.users.find((item) => item.id === score.userId)) }));
        return sendJson(res, 200, { leaderboard });
      }
      if (action === "publish" && method === "POST") {
        if (game.ownerId !== user.id) return fail(res, 403, "Опубликовать игру может только автор");
        game.published = !game.published; game.updatedAt = now(); await persist(); return sendJson(res, 200, { game });
      }
      if (action === "score" && method === "POST") {
        const body = await parseBody(req); const scoreValue = Math.max(0, Math.min(1_000_000_000, Number(body.score || 0)));
        const score = { id: id(), gameId: game.id, userId: user.id, score: scoreValue, durationMs: Math.max(0, Number(body.durationMs || 0)), meta: body.meta || {}, createdAt: now() };
        db.gameScores.push(score); if (db.gameScores.length > 100_000) db.gameScores.splice(0, db.gameScores.length - 100_000); await persist();
        return sendJson(res, 201, { score });
      }
    }

    const gameMatch = parseRoute(path, /^\/api\/games\/([^/]+)$/);
    if (gameMatch && method === "PATCH") {
      const game = db.gameProjects.find((item) => item.id === gameMatch[1] && !item.deletedAt);
      if (!game || game.ownerId !== user.id) return fail(res, 403, "Редактировать игру может только автор");
      const body = await parseBody(req);
      if (body.title !== undefined) game.title = text(body.title, 100) || game.title;
      if (body.description !== undefined) game.description = text(body.description, 1000);
      if (["quiz", "clicker", "reaction", "novel"].includes(body.type)) game.type = body.type;
      if (body.coverEmoji !== undefined) game.coverEmoji = text(body.coverEmoji, 12) || game.coverEmoji;
      if (body.accentColor !== undefined) game.accentColor = text(body.accentColor, 32) || game.accentColor;
      if (Array.isArray(body.tags)) game.tags = unique(body.tags.map((item) => text(item, 36))).slice(0, 8);
      if (body.config !== undefined || body.type !== undefined) game.config = normalizeGameConfig(game.type, body.config !== undefined ? body.config : game.config);
      game.updatedAt = now(); await persist(); return sendJson(res, 200, { game });
    }
    if (gameMatch && method === "DELETE") {
      const game = db.gameProjects.find((item) => item.id === gameMatch[1] && !item.deletedAt);
      if (!game || (game.ownerId !== user.id && !user.isSystemAdmin)) return fail(res, 403, "Удалить игру может автор или администратор");
      game.deletedAt = now(); await persist(); return sendJson(res, 200, { ok: true });
    }

    if (path === "/api/boards" && method === "GET") {
      const city = text(url.searchParams.get("city"), 180).toLowerCase();
      const tag = text(url.searchParams.get("tag") || url.searchParams.get("interest"), 120).toLowerCase();
      const q = text(url.searchParams.get("q"), 200).toLowerCase();
      for (const board of db.boards) {
        board.tags = unique(board.tags?.length ? board.tags : [board.interest]);
        board.interest ||= board.tags[0] || "Общее";
      }
      const boards = db.boards.filter((board) => (!city || board.city.toLowerCase() === city) && (!tag || board.tags.some((item) => item.toLowerCase() === tag)) && (!q || `${board.title} ${board.city} ${board.interest} ${board.tags.join(" ")} ${board.description || ""}`.toLowerCase().includes(q))).map((board) => ({ ...board, postsCount: db.boardPosts.filter((post) => post.boardId === board.id && post.status !== "deleted").length }));
      const cities = [...new Set(db.boards.map((board) => board.city).filter(Boolean))].sort();
      const interests = [...new Set(db.boards.flatMap((board) => board.tags || [board.interest]).filter(Boolean))].sort((a,b) => a.localeCompare(b, "ru"));
      return sendJson(res, 200, { boards, cities, interests });
    }

    if (path === "/api/boards" && method === "POST") {
      const body = await parseBody(req);
      const city = text(body.city, 180);
      const tags = unique((body.tags || [body.interest]).map((item) => text(item, 36))).slice(0, 8);
      const interest = tags[0] || text(body.interest, 120);
      if (!city || !interest) return fail(res, 400, "Выберите город и добавьте хотя бы один интерес");
      const duplicate = db.boards.find((board) => board.city.toLowerCase() === city.toLowerCase() && (board.tags || [board.interest]).some((item) => item.toLowerCase() === interest.toLowerCase()));
      if (duplicate) return sendJson(res, 200, { board: duplicate, duplicate: true });
      const board = { id: id(), title: text(body.title, 140) || `${interest} · ${city.split(",")[0]}`, city, interest, tags, description: text(body.description, 1000), createdBy: user.id, moderators: [user.id], createdAt: now(), updatedAt: now(), rules: text(body.rules, 1500), color: text(body.color, 32) || "#7c5cff" };
      db.boards.push(board); recordAudit(db, user.id, "board.create", "board", board.id, { city, interest }); await persist();
      return sendJson(res, 201, { board });
    }

    const boardPostsMatch = parseRoute(path, /^\/api\/boards\/([^/]+)\/posts$/);
    if (boardPostsMatch && method === "GET") {
      const board = db.boards.find((item) => item.id === boardPostsMatch[1]); if (!board) return fail(res, 404, "Доска не найдена");
      const before = Number(url.searchParams.get("before") || Number.MAX_SAFE_INTEGER); const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 40)));
      const category = text(url.searchParams.get("category"), 80); const q = text(url.searchParams.get("q"), 200).toLowerCase();
      const all = db.boardPosts.filter((post) => post.boardId === board.id && post.status !== "deleted" && post.createdAt < before && (!category || post.category === category) && (!q || `${post.title} ${post.text} ${post.tags?.join(" ") || ""}`.toLowerCase().includes(q))).sort((a,b) => b.createdAt-a.createdAt);
      const posts = all.slice(0, limit).map((post) => publicBoardPost(post, db));
      return sendJson(res, 200, { board, posts, hasMore: all.length > posts.length, nextBefore: posts.at(-1)?.createdAt || null });
    }
    if (boardPostsMatch && method === "POST") {
      const board = db.boards.find((item) => item.id === boardPostsMatch[1]); if (!board) return fail(res, 404, "Доска не найдена");
      const body = await parseBody(req); const title = text(body.title, 160); const postText = text(body.text, 8000);
      if (!title || !postText) return fail(res, 400, "Заголовок и текст обязательны");
      const post = { id: id(), boardId: board.id, authorId: user.id, title, text: postText, city: board.city, interest: board.interest, category: text(body.category, 80) || "Общее", tags: (body.tags || []).map((tag) => text(tag, 40)).filter(Boolean).slice(0, 12), contacts: text(body.contacts, 500), media: (body.media || []).slice(0, 8), comments: [], favorites: [], status: "active", createdAt: now(), updatedAt: now(), expiresAt: Number(body.expiresAt || 0), views: 0 };
      db.boardPosts.push(post); board.updatedAt = now(); recordAudit(db, user.id, "board.post.create", "boardPost", post.id, { boardId: board.id }); await persist();
      return sendJson(res, 201, { post: publicBoardPost(post, db) });
    }

    const boardPostMatch = parseRoute(path, /^\/api\/board-posts\/([^/]+)$/);
    if (boardPostMatch && method === "GET") {
      const post = db.boardPosts.find((item) => item.id === boardPostMatch[1] && item.status !== "deleted"); if (!post) return fail(res, 404, "Объявление не найдено");
      post.views = Number(post.views || 0) + 1; await persist(); return sendJson(res, 200, { post: publicBoardPost(post, db) });
    }
    if (boardPostMatch && method === "PATCH") {
      const post = db.boardPosts.find((item) => item.id === boardPostMatch[1]); if (!post) return fail(res, 404, "Объявление не найдено");
      const board = db.boards.find((item) => item.id === post.boardId); const canEdit = post.authorId === user.id || board?.moderators?.includes(user.id); if (!canEdit) return fail(res, 403, "Недостаточно прав");
      const body = await parseBody(req); for (const key of ["title", "text", "category", "contacts", "status", "expiresAt"]) if (body[key] !== undefined) post[key] = key === "expiresAt" ? Number(body[key] || 0) : text(body[key], key === "text" ? 8000 : 500);
      if (Array.isArray(body.tags)) post.tags = body.tags.map((tag) => text(tag, 40)).filter(Boolean).slice(0, 12); if (Array.isArray(body.media)) post.media = body.media.slice(0, 8); post.updatedAt = now(); await persist(); return sendJson(res, 200, { post: publicBoardPost(post, db) });
    }
    if (boardPostMatch && method === "DELETE") {
      const post = db.boardPosts.find((item) => item.id === boardPostMatch[1]); if (!post) return fail(res, 404, "Объявление не найдено");
      const board = db.boards.find((item) => item.id === post.boardId); const canDelete = post.authorId === user.id || board?.moderators?.includes(user.id) || user.isSystemAdmin; if (!canDelete) return fail(res, 403, "Недостаточно прав");
      post.status = "deleted"; post.deletedAt = now(); await persist(); return sendJson(res, 200, { ok: true });
    }

    const boardCommentMatch = parseRoute(path, /^\/api\/board-posts\/([^/]+)\/comments$/);
    if (boardCommentMatch && method === "POST") {
      const post = db.boardPosts.find((item) => item.id === boardCommentMatch[1] && item.status !== "deleted"); if (!post) return fail(res, 404, "Объявление не найдено");
      const body = await parseBody(req); const value = text(body.text, 2000); if (!value) return fail(res, 400, "Комментарий пуст");
      const comment = { id: id(), authorId: user.id, text: value, createdAt: now() }; post.comments ||= []; post.comments.push(comment); post.updatedAt = now(); await persist(); return sendJson(res, 201, { post: publicBoardPost(post, db), comment });
    }

    const boardFavoriteMatch = parseRoute(path, /^\/api\/board-posts\/([^/]+)\/favorite$/);
    if (boardFavoriteMatch && method === "POST") {
      const post = db.boardPosts.find((item) => item.id === boardFavoriteMatch[1] && item.status !== "deleted"); if (!post) return fail(res, 404, "Объявление не найдено");
      post.favorites ||= []; post.favorites = post.favorites.includes(user.id) ? post.favorites.filter((uid) => uid !== user.id) : [...post.favorites, user.id]; await persist(); return sendJson(res, 200, { favorite: post.favorites.includes(user.id), count: post.favorites.length });
    }

    const exportMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/export$/);
    if (exportMatch && method === "GET") {
      const chat = db.chats.find((c) => c.id === exportMatch[1]);
      if (!chat || !isMember(chat, user.id)) return fail(res, 404, "Чат не найден");
      const messages = db.messages.filter((m) => m.chatId === chat.id).map(publicMessage);
      return sendJson(res, 200, { exportedAt: now(), chat, users: db.users.filter((u) => chat.participants.includes(u.id)).map(safeUser), messages });
    }

    const reactionsMatch = parseRoute(path, /^\/api\/messages\/([^/]+)\/reactions$/);
    if (reactionsMatch && method === "POST") {
      const stored = db.messages.find((m) => m.id === reactionsMatch[1]);
      const chat = db.chats.find((c) => c.id === stored?.chatId);
      if (!stored || !chat || !isMember(chat, user.id)) return fail(res, 404, "Сообщение не найдено");
      const body = await parseBody(req); const emoji = text(body.emoji, 16) || "👍";
      stored.reactions ||= {};
      const current = new Set(stored.reactions[emoji] || []);
      current.has(user.id) ? current.delete(user.id) : current.add(user.id);
      stored.reactions[emoji] = [...current];
      if (!stored.reactions[emoji].length) delete stored.reactions[emoji];
      stored.sequence = nextSequence(db); await persist(); syncChat(chat, "message.reaction");
      return sendJson(res, 200, { message: publicMessage(stored) });
    }

    const scheduleMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/schedule$/);
    if (scheduleMatch && method === "POST") {
      const chat = db.chats.find((c) => c.id === scheduleMatch[1]);
      if (!chat || !isMember(chat, user.id)) return fail(res, 404, "Чат не найден");
      const body = await parseBody(req); const sendAt = Number(body.sendAt || 0);
      if (sendAt < now() + 5000) return fail(res, 400, "Время отправки должно быть в будущем");
      const item = { id: id(), userId: user.id, chatId: chat.id, payload: body.payload || {}, sendAt, status: "scheduled", createdAt: now() };
      db.scheduledMessages.push(item); await persist(); return sendJson(res, 201, { scheduledMessage: item });
    }

    const autoDeleteMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/auto-delete$/);
    if (autoDeleteMatch && method === "POST") {
      const chat = db.chats.find((c) => c.id === autoDeleteMatch[1]);
      if (!chat || !isMember(chat, user.id)) return fail(res, 404, "Чат не найден");
      const body = await parseBody(req); chat.autoDeleteSeconds = Math.max(0, Math.min(Number(body.seconds || 0), 31_536_000));
      chat.sequence = nextSequence(db); await persist(); syncChat(chat, "chat.auto-delete");
      return sendJson(res, 200, { autoDeleteSeconds: chat.autoDeleteSeconds });
    }

    const pollMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/polls$/);
    if (pollMatch && method === "POST") {
      const chat = db.chats.find((c) => c.id === pollMatch[1]);
      if (!chat || !isMember(chat, user.id)) return fail(res, 404, "Чат не найден");
      const body = await parseBody(req); const options = (body.options || []).map((option) => ({ id: id(), text: text(option, 120), voters: [] })).filter((o) => o.text);
      if (!text(body.question, 300) || options.length < 2 || options.length > 10) return fail(res, 400, "Нужно от 2 до 10 вариантов");
      const opened = { id: id(), chatId: chat.id, senderId: user.id, type: "poll", poll: { question: text(body.question, 300), options, multiple: Boolean(body.multiple), anonymous: body.anonymous !== false, closed: false }, timestamp: now(), edited: false, hiddenFor: [], reactions: {}, sequence: nextSequence(db) };
      const stored = sealMessage(opened); db.messages.push(stored); chat.updatedAt = now(); await persist(); broadcastChat(chat, { type: "message.created", chatId: chat.id, message: publicMessage(stored), at: now() });
      return sendJson(res, 201, { message: publicMessage(stored) });
    }

    const voteMatch = parseRoute(path, /^\/api\/polls\/([^/]+)\/vote$/);
    if (voteMatch && method === "POST") {
      const stored = db.messages.find((m) => m.id === voteMatch[1]); const chat = db.chats.find((c) => c.id === stored?.chatId);
      if (!stored || !chat || !isMember(chat, user.id)) return fail(res, 404, "Опрос не найден");
      const opened = openMessage(stored); if (opened.type !== "poll" || opened.poll?.closed) return fail(res, 400, "Опрос закрыт");
      const body = await parseBody(req); const optionIds = unique(body.optionIds);
      for (const option of opened.poll.options) option.voters = (option.voters || []).filter((uid) => uid !== user.id);
      for (const option of opened.poll.options) if (optionIds.includes(option.id) && (opened.poll.multiple || optionIds[0] === option.id)) option.voters.push(user.id);
      opened.sequence = nextSequence(db); const updated = context.replaceStoredMessage(stored.id, opened); await persist(); syncChat(chat, "poll.voted");
      return sendJson(res, 200, { message: publicMessage(updated) });
    }

    if (path === "/api/link-preview" && method === "POST") {
      const body = await parseBody(req); const urlValue = text(body.url, 2048);
      const cached = db.linkPreviews.find((p) => p.url === urlValue && now() - p.createdAt < 86_400_000);
      if (cached) return sendJson(res, 200, { preview: cached });
      const preview = { id: id(), ...(await linkPreview(urlValue)), createdAt: now() };
      db.linkPreviews.push(preview); await persist(); return sendJson(res, 200, { preview });
    }

    const topicCollection = parseRoute(path, /^\/api\/chats\/([^/]+)\/topics$/);
    if (topicCollection && method === "GET") return sendJson(res, 200, { topics: db.topics.filter((t) => t.chatId === topicCollection[1] && !t.deletedAt) });
    if (topicCollection && method === "POST") {
      const chat = db.chats.find((c) => c.id === topicCollection[1]); if (!chat || !hasPermission(chat, user.id, "manage_topics")) return fail(res, 403, "Недостаточно прав");
      const body = await parseBody(req); const topic = { id: id(), chatId: chat.id, title: text(body.title, 120), icon: text(body.icon, 16), createdBy: user.id, createdAt: now(), closed: false };
      db.topics.push(topic); recordAdmin(db, chat.id, user.id, "topic.created", null, { topicId: topic.id }); await persist(); return sendJson(res, 201, { topic });
    }

    const memberRoleMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/members\/([^/]+)\/role$/);
    if (memberRoleMatch && method === "POST") {
      const [, chatId, targetId] = memberRoleMatch; const chat = db.chats.find((c) => c.id === chatId);
      if (!chat || !canModerate(chat, user.id, targetId)) return fail(res, 403, "Недостаточно прав");
      const body = await parseBody(req); const role = ["admin", "moderator", "member", "restricted"].includes(body.role) ? body.role : "member";
      chat.roles ||= {}; chat.roles[targetId] = role; chat.admins = unique(Object.entries(chat.roles).filter(([, r]) => r === "admin").map(([uid]) => uid).concat(chat.ownerId));
      recordAdmin(db, chat.id, user.id, "member.role", targetId, { role }); chat.sequence = nextSequence(db); await persist(); syncChat(chat, "member.role"); return sendJson(res, 200, { role });
    }

    const restrictMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/members\/([^/]+)\/(ban|restrict|unban)$/);
    if (restrictMatch && method === "POST") {
      const [, chatId, targetId, action] = restrictMatch; const chat = db.chats.find((c) => c.id === chatId);
      if (!chat || !canModerate(chat, user.id, targetId)) return fail(res, 403, "Недостаточно прав");
      const body = await parseBody(req); chat.bans ||= {}; chat.restrictions ||= {};
      if (action === "ban") { chat.bans[targetId] = { until: Number(body.until || 0), reason: text(body.reason, 300), by: user.id }; chat.participants = chat.participants.filter((uid) => uid !== targetId); }
      if (action === "restrict") chat.restrictions[targetId] = { until: Number(body.until || 0), permissions: body.permissions || [], reason: text(body.reason, 300), by: user.id };
      if (action === "unban") { delete chat.bans[targetId]; delete chat.restrictions[targetId]; }
      recordAdmin(db, chat.id, user.id, `member.${action}`, targetId, body); chat.sequence = nextSequence(db); await persist(); syncChat(chat, `member.${action}`); return sendJson(res, 200, { ok: true });
    }

    const transferMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/transfer-owner$/);
    if (transferMatch && method === "POST") {
      const chat = db.chats.find((c) => c.id === transferMatch[1]); if (!chat || chat.ownerId !== user.id) return fail(res, 403, "Только владелец может передать чат");
      const body = await parseBody(req); if (!chat.participants.includes(body.userId)) return fail(res, 400, "Пользователь не состоит в чате");
      chat.ownerId = body.userId; chat.roles ||= {}; chat.roles[user.id] = "admin"; chat.roles[body.userId] = "owner"; recordAdmin(db, chat.id, user.id, "owner.transferred", body.userId); chat.sequence = nextSequence(db); await persist(); syncChat(chat, "owner.transferred"); return sendJson(res, 200, { chat });
    }

    const adminLogMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/admin-log$/);
    if (adminLogMatch && method === "GET") {
      const chat = db.chats.find((c) => c.id === adminLogMatch[1]); if (!chat || !hasPermission(chat, user.id, "manage_chat")) return fail(res, 403, "Недостаточно прав");
      return sendJson(res, 200, { events: db.adminLogs.filter((e) => e.chatId === chat.id).slice(-1000).reverse() });
    }

    const inviteCollection = parseRoute(path, /^\/api\/chats\/([^/]+)\/invites$/);
    if (inviteCollection && method === "GET") {
      const chat = db.chats.find((c) => c.id === inviteCollection[1]); if (!chat || !hasPermission(chat, user.id, "invite")) return fail(res, 403, "Недостаточно прав");
      return sendJson(res, 200, { invites: db.invites.filter((i) => i.chatId === chat.id && !i.revokedAt) });
    }
    if (inviteCollection && method === "POST") {
      const chat = db.chats.find((c) => c.id === inviteCollection[1]); if (!chat || !hasPermission(chat, user.id, "invite")) return fail(res, 403, "Недостаточно прав");
      const body = await parseBody(req); const invite = { id: id(), chatId: chat.id, code: randomBytes(12).toString("base64url"), createdBy: user.id, createdAt: now(), expiresAt: Number(body.expiresAt || 0), memberLimit: Math.max(0, Number(body.memberLimit || 0)), requiresApproval: Boolean(body.requiresApproval), joinedUserIds: [], revokedAt: null };
      db.invites.push(invite); await persist(); return sendJson(res, 201, { invite });
    }

    const statsMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/stats$/);
    if (statsMatch && method === "GET") {
      const chat = db.chats.find((c) => c.id === statsMatch[1]); if (!chat || !hasPermission(chat, user.id, "view_stats")) return fail(res, 403, "Недостаточно прав");
      const messages = db.messages.filter((m) => m.chatId === chat.id).map(publicMessage);
      const byDay = {}; for (const m of messages) { const day = new Date(m.timestamp).toISOString().slice(0, 10); byDay[day] = (byDay[day] || 0) + 1; }
      return sendJson(res, 200, { members: chat.participants.length, messages: messages.length, views: messages.reduce((sum, m) => sum + Object.keys(m.viewedBy || {}).length, 0), byDay });
    }

    const viewMatch = parseRoute(path, /^\/api\/messages\/([^/]+)\/view$/);
    if (viewMatch && method === "POST") {
      const stored = db.messages.find((m) => m.id === viewMatch[1]); const chat = db.chats.find((c) => c.id === stored?.chatId);
      if (!stored || !chat || !isMember(chat, user.id)) return fail(res, 404, "Сообщение не найдено");
      stored.viewedBy ||= {}; stored.viewedBy[user.id] ||= now(); await persist(); return sendJson(res, 200, { views: Object.keys(stored.viewedBy).length });
    }

    if (path === "/api/devices" && method === "GET") return sendJson(res, 200, { devices: db.devices.filter((d) => d.userId === user.id).map(({ oneTimePrekeys, ...d }) => ({ ...d, oneTimePrekeyCount: oneTimePrekeys?.length || 0 })) });
    if (path === "/api/devices" && method === "POST") {
      const body = await parseBody(req); const device = { id: body.id || id(), userId: user.id, name: text(body.name, 100) || "Устройство", identityKey: text(body.identityKey, 5000), signedPrekey: body.signedPrekey || null, oneTimePrekeys: (body.oneTimePrekeys || []).slice(0, 100), createdAt: now(), lastSeen: now() };
      db.devices = db.devices.filter((d) => !(d.id === device.id && d.userId === user.id)); db.devices.push(device); await persist(); return sendJson(res, 201, { device: { ...device, oneTimePrekeys: undefined } });
    }
    const prekeyMatch = parseRoute(path, /^\/api\/users\/([^/]+)\/prekey$/);
    if (prekeyMatch && method === "GET") {
      const device = db.devices.find((d) => d.userId === prekeyMatch[1] && d.identityKey); if (!device) return fail(res, 404, "Ключ устройства не найден");
      const oneTimePrekey = device.oneTimePrekeys?.shift() || null; await persist(); return sendJson(res, 200, { deviceId: device.id, identityKey: device.identityKey, signedPrekey: device.signedPrekey, oneTimePrekey });
    }

    const publicDevicesMatch = parseRoute(path, /^\/api\/users\/([^/]+)\/devices\/public$/);
    if (publicDevicesMatch && method === "GET") {
      const devices = db.devices.filter((d) => d.userId === publicDevicesMatch[1] && d.identityKey).map((d) => ({ id: d.id, name: d.name, identityKey: d.identityKey, signedPrekey: d.signedPrekey }));
      return sendJson(res, 200, { devices });
    }
    const secretMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/secret$/);
    if (secretMatch && method === "POST") {
      const chat = db.chats.find((c) => c.id === secretMatch[1] && c.type === "private" && isMember(c, user.id));
      if (!chat) return fail(res, 404, "Личный чат не найден");
      if (chat.isAiChat || chat.isSavedMessages) return fail(res, 400, "Секретный режим недоступен для системного чата");
      const body = await parseBody(req); chat.secretEnabledBy ||= [];
      chat.secretEnabledBy = body.enabled === false ? chat.secretEnabledBy.filter((uid) => uid !== user.id) : unique([...chat.secretEnabledBy, user.id]);
      chat.secretMode = chat.participants.every((uid) => chat.secretEnabledBy.includes(uid)); chat.sequence = nextSequence(db); await persist(); syncChat(chat, "chat.secret-mode");
      return sendJson(res, 200, { secretMode: chat.secretMode, enabledByMe: chat.secretEnabledBy.includes(user.id), waitingForPeer: !chat.secretMode });
    }

    if (path === "/api/security/2fa/setup" && method === "POST") {
      const secret = generateTotpSecret(); user.pendingTotpSecret = secret; await persist();
      return sendJson(res, 200, { secret, otpauth: `otpauth://totp/NEMAX:${encodeURIComponent(user.username)}?secret=${Buffer.from(secret, "hex").toString("base64").replace(/=+$/, "")}&issuer=NEMAX` });
    }
    if (path === "/api/security/2fa/enable" && method === "POST") {
      const body = await parseBody(req); if (!verifyTotp(user.pendingTotpSecret, body.code)) return fail(res, 400, "Неверный одноразовый код");
      user.totpSecret = user.pendingTotpSecret; delete user.pendingTotpSecret; user.twoFactorEnabled = true; user.recoveryCodes = Array.from({ length: 8 }, () => randomBytes(5).toString("hex")); await persist(); return sendJson(res, 200, { recoveryCodes: user.recoveryCodes });
    }
    if (path === "/api/security/2fa/disable" && method === "POST") {
      const body = await parseBody(req); if (!verifyTotp(user.totpSecret, body.code)) return fail(res, 400, "Неверный код");
      delete user.totpSecret; delete user.recoveryCodes; user.twoFactorEnabled = false; await persist(); return sendJson(res, 200, { ok: true });
    }

    if (path === "/api/push/public-key" && method === "GET") return sendJson(res, 200, { publicKey: process.env.VAPID_PUBLIC_KEY || "" });
    if (path === "/api/push/subscriptions" && method === "POST") {
      const body = await parseBody(req); const endpointHash = sha256(body.endpoint || body.subscription?.endpoint || "");
      db.pushSubscriptions = db.pushSubscriptions.filter((p) => !(p.userId === user.id && p.endpointHash === endpointHash));
      db.pushSubscriptions.push({ id: id(), userId: user.id, endpointHash, subscription: body.subscription || body, deviceName: text(body.deviceName, 100), createdAt: now() }); await persist(); return sendJson(res, 201, { ok: true });
    }
    if (path === "/api/push/test" && method === "POST") {
      const subscriptions = db.pushSubscriptions.filter((p) => p.userId === user.id); const result = await pushService?.sendMany(subscriptions, { title: "Тестовое уведомление", body: "Push настроен", data: { url: "/messenger" } });
      return sendJson(res, 200, { result: result || { sent: 0, unavailable: true } });
    }

    if (path === "/api/stories" && method === "GET") {
      const visibleIds = new Set([user.id, ...db.chats.filter((c) => isMember(c, user.id)).flatMap((c) => c.participants)]);
      return sendJson(res, 200, { stories: db.stories.filter((s) => visibleIds.has(s.userId) && s.expiresAt > now() && !s.deletedAt) });
    }
    if (path === "/api/stories" && method === "POST") {
      const body = await parseBody(req); const story = { id: id(), userId: user.id, type: body.type || "text", content: body.content, caption: text(body.caption, 500), privacy: body.privacy || "contacts", createdAt: now(), expiresAt: now() + Math.min(Number(body.durationMs || 86_400_000), 172_800_000), views: {} };
      db.stories.push(story); await persist(); broadcastUsers(db.users.map((u) => u.id), { type: "story.created", storyId: story.id, userId: user.id }); return sendJson(res, 201, { story });
    }
    const storyView = parseRoute(path, /^\/api\/stories\/([^/]+)\/view$/);
    if (storyView && method === "POST") { const story = db.stories.find((s) => s.id === storyView[1] && !s.deletedAt); if (!story) return fail(res, 404, "История не найдена"); story.views[user.id] ||= now(); await persist(); return sendJson(res, 200, { views: Object.keys(story.views).length }); }

    if (path === "/api/calls" && method === "POST") {
      const body = await parseBody(req); const participantIds = unique([user.id, ...(body.participantIds || [])]);
      if (participantIds.length < 2) return fail(res, 400, "Нужен хотя бы один собеседник");
      if (participantIds.some((uid) => db.users.find((candidate) => candidate.id === uid)?.isAi)) return fail(res, 400, "Звонки AI-аккаунтам недоступны");
      const call = { id: id(), createdBy: user.id, participantIds, type: body.type === "video" ? "video" : "audio", group: participantIds.length > 2, status: "ringing", createdAt: now(), startedAt: null, endedAt: null };
      db.calls.push(call); await persist(); broadcastUsers(participantIds.filter((uid) => uid !== user.id), { type: "call.incoming", call, at: now() }); return sendJson(res, 201, { call, iceServers: context.iceServers });
    }
    const callAction = parseRoute(path, /^\/api\/calls\/([^/]+)\/(accept|decline|end)$/);
    if (callAction && method === "POST") {
      const [, callId, action] = callAction; const call = db.calls.find((c) => c.id === callId && c.participantIds.includes(user.id)); if (!call) return fail(res, 404, "Звонок не найден");
      if (action === "accept") { call.status = "active"; call.startedAt ||= now(); }
      else { call.status = action === "decline" ? "declined" : "ended"; call.endedAt = now(); }
      await persist(); broadcastUsers(call.participantIds, { type: `call.${action}`, callId: call.id, userId: user.id, at: now() }); return sendJson(res, 200, { call });
    }

    const liveMatch = parseRoute(path, /^\/api\/chats\/([^/]+)\/live$/);
    if (liveMatch && method === "POST") {
      const chat = db.chats.find((c) => c.id === liveMatch[1]); if (!chat || !hasPermission(chat, user.id, "manage_chat")) return fail(res, 403, "Недостаточно прав");
      const call = { id: id(), chatId: chat.id, createdBy: user.id, participantIds: [...chat.participants], type: "video", group: true, live: true, status: "active", createdAt: now(), startedAt: now(), endedAt: null };
      db.calls.push(call); chat.activeLiveId = call.id; await persist(); broadcastUsers(chat.participants, { type: "live.started", call, at: now() }); return sendJson(res, 201, { call, iceServers: context.iceServers });
    }

    if (path === "/api/bots" && method === "GET") return sendJson(res, 200, { bots: db.bots.filter((b) => b.ownerId === user.id).map(({ tokenHash, ...b }) => b) });
    if (path === "/api/bots" && method === "POST") {
      const body = await parseBody(req); const tokenValue = `${Math.floor(Math.random() * 1e9)}:${randomBytes(24).toString("base64url")}`;
      const bot = { id: id(), ownerId: user.id, username: text(body.username, 32).replace(/^@/, ""), name: text(body.name, 100), tokenHash: sha256(tokenValue), webhookUrl: "", allowedUpdates: [], createdAt: now(), enabled: true };
      if (!/^[a-zA-Z0-9_]{5,32}$/.test(bot.username)) return fail(res, 400, "Username бота: 5–32 символа");
      if (db.bots.some((b) => b.username.toLowerCase() === bot.username.toLowerCase())) return fail(res, 409, "Username занят");
      const botUser = { id: id(), username: bot.name || bot.username, login: `bot_${bot.username.toLowerCase()}`, isBot: true, botId: bot.id, avatarColor: "#4f8cff", status: "online", lastSeen: now(), settings: {}, blockedUsers: [], createdAt: now() };
      bot.botUserId = botUser.id; db.users.push(botUser); db.bots.push(bot); await persist(); return sendJson(res, 201, { bot: { ...bot, tokenHash: undefined }, token: tokenValue });
    }
    const webhookMatch = parseRoute(path, /^\/api\/bots\/([^/]+)\/webhook$/);
    if (webhookMatch && method === "POST") {
      const bot = db.bots.find((b) => b.id === webhookMatch[1] && b.ownerId === user.id); if (!bot) return fail(res, 404, "Бот не найден");
      const body = await parseBody(req); bot.webhookUrl = text(body.url, 2048); bot.allowedUpdates = body.allowedUpdates || []; await persist(); return sendJson(res, 200, { ok: true });
    }

    if (path === "/api/mini-apps" && method === "GET") return sendJson(res, 200, { apps: db.miniApps.filter((app) => app.ownerId === user.id || app.published) });
    if (path === "/api/mini-apps" && method === "POST") {
      const body = await parseBody(req); const app = { id: id(), ownerId: user.id, name: text(body.name, 100), url: text(body.url, 2048), botId: body.botId || null, permissions: body.permissions || [], published: Boolean(body.published), createdAt: now() };
      db.miniApps.push(app); await persist(); return sendJson(res, 201, { app });
    }

    if (path === "/api/stickers" && method === "GET") return sendJson(res, 200, { packs: db.stickerPacks.filter((p) => p.ownerId === user.id || p.public), emoji: db.customEmoji.filter((e) => e.ownerId === user.id || e.public) });
    if (path === "/api/stickers" && method === "POST") {
      const body = await parseBody(req);
      const title = text(body.title, 100);
      const items = (body.items || []).slice(0, 30).map((item) => ({
        id: text(item.id, 100) || id(), name: text(item.name, 160), emoji: text(item.emoji, 16),
        mimeType: ["image/png", "image/webp", "image/gif"].includes(item.mimeType) ? item.mimeType : "image/webp",
        content: String(item.content || "").slice(0, 3_000_000),
      })).filter((item) => item.content.startsWith("data:image/png;base64,") || item.content.startsWith("data:image/webp;base64,") || item.content.startsWith("data:image/gif;base64,") || item.content.startsWith("/api/objects/"));
      if (!title || !items.length) return fail(res, 400, "Укажите название и добавьте PNG, WebP или GIF"), true;
      const pack = { id: id(), ownerId: user.id, title, shortName: text(body.shortName, 40), items, public: Boolean(body.public), createdAt: now() };
      db.stickerPacks.push(pack); await persist(); return sendJson(res, 201, { pack });
    }
    if (path === "/api/custom-emoji" && method === "POST") {
      const body = await parseBody(req); const emoji = { id: id(), ownerId: user.id, name: text(body.name, 40), content: body.content, public: Boolean(body.public), createdAt: now() };
      db.customEmoji.push(emoji); await persist(); return sendJson(res, 201, { emoji });
    }

    if (path === "/api/business/profile" && method === "GET") return sendJson(res, 200, { profile: db.businessProfiles.find((p) => p.userId === user.id) || null, quickReplies: db.quickReplies.filter((q) => q.userId === user.id) });
    if (path === "/api/business/profile" && method === "PUT") {
      const body = await parseBody(req); let profile = db.businessProfiles.find((p) => p.userId === user.id);
      if (!profile) { profile = { id: id(), userId: user.id, createdAt: now() }; db.businessProfiles.push(profile); }
      Object.assign(profile, { address: text(body.address, 300), hours: body.hours || {}, greeting: text(body.greeting, 1000), awayMessage: text(body.awayMessage, 1000), location: body.location || null, updatedAt: now() }); await persist(); return sendJson(res, 200, { profile });
    }
    if (path === "/api/business/quick-replies" && method === "POST") {
      const body = await parseBody(req); const reply = { id: id(), userId: user.id, shortcut: text(body.shortcut, 40), text: text(body.text, 4000), createdAt: now() }; db.quickReplies.push(reply); await persist(); return sendJson(res, 201, { reply });
    }

    if (path === "/api/reports" && method === "POST") {
      const body = await parseBody(req); const report = { id: id(), reporterId: user.id, targetType: body.targetType, targetId: body.targetId, reason: text(body.reason, 500), status: "new", createdAt: now() }; db.reports.push(report); await persist(); return sendJson(res, 201, { report });
    }

    return false;
  };
}

export async function runBackgroundJobs(context) {
  const { getDb, persist, openMessage, publicMessage, sealMessage, broadcastChat } = context;
  const db = getDb(); ensureCollections(db); let changed = false; const current = now();

  for (const scheduled of db.scheduledMessages.filter((s) => s.status === "scheduled" && s.sendAt <= current)) {
    const chat = db.chats.find((c) => c.id === scheduled.chatId && c.participants.includes(scheduled.userId));
    if (!chat) { scheduled.status = "failed"; continue; }
    const payload = scheduled.payload || {}; const message = { id: id(), chatId: chat.id, senderId: scheduled.userId, type: payload.type || "text", text: payload.text || payload.content || "", content: payload.type === "text" ? undefined : payload.content, name: payload.name, mimeType: payload.mimeType, timestamp: current, scheduledAt: scheduled.sendAt, hiddenFor: [], reactions: {}, sequence: nextSequence(db) };
    const stored = sealMessage(message); db.messages.push(stored); chat.updatedAt = current; scheduled.status = "sent"; scheduled.messageId = message.id; broadcastChat(chat, { type: "message.created", chatId: chat.id, message: publicMessage(stored), scheduled: true, at: current }); changed = true;
  }

  const expiredIds = new Set();
  for (const stored of db.messages) {
    let opened; try { opened = openMessage(stored); } catch { continue; }
    const chat = db.chats.find((c) => c.id === stored.chatId);
    const expiresAt = opened.expiresAt || (chat?.autoDeleteSeconds ? opened.timestamp + chat.autoDeleteSeconds * 1000 : 0);
    if (expiresAt && expiresAt <= current) expiredIds.add(stored.id);
  }
  if (expiredIds.size) { db.messages = db.messages.filter((m) => !expiredIds.has(m.id)); changed = true; }
  const oldStories = db.stories.length; db.stories = db.stories.filter((s) => !s.deletedAt && s.expiresAt > current); if (db.stories.length !== oldStories) changed = true;
  if (changed) await persist();
  return { changed, scheduledSent: db.scheduledMessages.filter((s) => s.status === "sent").length, expiredMessages: expiredIds.size };
}
