import http from "node:http";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, createReadStream, unlinkSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMessageCrypto } from "./message-crypto.js";
import { createStateStore } from "./state-store.js";
import { createRedisService } from "./redis-service.js";
import { createObjectStorage } from "./object-storage.js";
import { createPushService } from "./push-service.js";
import { createPlatformApi, runBackgroundJobs } from "./platform-api.js";
import { createAdminApi, isSystemAdmin, normalizeSystemSettings } from "./admin-api.js";
import { createSessionRecord, sha256, verifyTotp } from "./security.js";
import {
  REALTIME_INTERNAL_URL,
  CODE_RUNNER_INTERNAL_URL,
  CODE_RUNNER_SOCKET,
  GAME_SERVER_INTERNAL_URL,
  AI_SERVER_INTERNAL_URL,
  getInternalJson,
  hasValidInternalSecret,
  postInternalJson,
  warnForDefaultInternalSecret,
} from "./internal-service.js";
import { AI_PERSONA_PUBLIC } from "./ai-personas.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DATA_DIR = join(ROOT, "server", "data");
const UPLOAD_DIR = join(ROOT, "server", "uploads");
const UPLOAD_TEMP_DIR = join(ROOT, "server", "tmp", "uploads");
const DB_FILE = join(DATA_DIR, "db.json");
const DIST_DIR = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 30 * 1024 * 1024);
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "";
const REALTIME_OUTBOX_FILE = join(DATA_DIR, "realtime-outbox.json");

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });
mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });

const MESSAGE_KEYS_FILE = join(DATA_DIR, "message-keys.json");
const messageKeysExistedAtStartup = existsSync(MESSAGE_KEYS_FILE);
const messageCrypto = createMessageCrypto(DATA_DIR, { autoRotate: false });
const MESSAGE_PAYLOAD_FIELDS = [
  "text", "content", "name", "mimeType", "size", "duration", "forwardedFrom", "fileEncryption",
  "caption", "replyToId", "mentions", "poll", "location", "contact", "albumId", "sticker", "gif",
  "clientCiphertext", "clientIv", "ephemeralPublicKey", "recipientEnvelopes", "senderDeviceId", "formatting", "linkPreview",
  "topicId", "expiresAt", "botId", "signature",
];

const DEFAULT_SETTINGS = {
  messageNotifications: true,
  groupNotifications: true,
  channelNotifications: true,
  sound: true,
  notificationPreview: true,
  lastSeen: "everyone",
  profilePhoto: "everyone",
  allowInvites: "everyone",
  readReceipts: true,
  theme: "dark",
  fontSize: "medium",
  compactMode: false,
  animations: true,
  autoDownloadMedia: true,
  autoPlayVideo: true,
  saveData: false,
};

function freshDb() {
  return {
    users: [], sessions: [], chats: [], messages: [], drafts: [], folders: [], pushSubscriptions: [],
    devices: [], scheduledMessages: [], stories: [], calls: [], bots: [], botUpdates: [], miniApps: [],
    businessProfiles: [], quickReplies: [], adminLogs: [], boards: [], boardPosts: [], gameProjects: [], gameScores: [], codeProjects: [], codeRuns: [], aiConversations: [],
    invites: [], topics: [], auditLogs: [], stickerPacks: [], customEmoji: [], reports: [], uploadSessions: [],
    linkPreviews: [], systemSettings: {
      siteName: "НЕМАКС", announcement: "", registrationEnabled: true, maintenanceMode: false,
      maintenanceMessage: "Проводятся технические работы", maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024), updatedAt: Date.now(),
    },
    meta: { sequence: 0, nextUserId: 1000, createdAt: Date.now() },
  };
}

const stateStore = await createStateStore({ file: DB_FILE, defaults: freshDb });
const redis = await createRedisService();
const objectStorage = await createObjectStorage(UPLOAD_DIR);
const pushService = await createPushService();
let db = await stateStore.load();
for (const [key, value] of Object.entries(freshDb())) {
  if (db[key] === undefined) db[key] = value;
}

if (!messageKeysExistedAtStartup && db.messages.some((item) => item.encryptedPayload)) {
  try { unlinkSync(MESSAGE_KEYS_FILE); } catch {}
  throw new Error("Файл server/data/message-keys.json отсутствует, но база содержит зашифрованные сообщения. Восстановите файл ключей из резервной копии.");
}

for (const removedCollection of ["subscriptions", "gifts", "payments", "ads"]) delete db[removedCollection];

let writeQueue = Promise.resolve();
function persist() {
  const snapshot = JSON.parse(JSON.stringify(db));
  writeQueue = writeQueue.then(() => stateStore.save(snapshot));
  return writeQueue;
}

function sealMessage(message) {
  const stored = { ...message };
  const payload = {};
  for (const field of MESSAGE_PAYLOAD_FIELDS) {
    if (stored[field] !== undefined) payload[field] = stored[field];
    delete stored[field];
  }
  delete stored.encrypted;
  delete stored.encryptionAlgorithm;
  delete stored.encryptionKeyId;
  delete stored.encryptedPayload;
  stored.encryptedPayload = messageCrypto.encryptJson(payload, `message:${stored.id}`);
  return stored;
}

function openMessage(message) {
  if (!message) return null;
  if (!message.encryptedPayload) return { ...message };
  const payload = messageCrypto.decryptJson(message.encryptedPayload, `message:${message.id}`);
  return { ...message, ...payload };
}

function publicMessage(message) {
  const opened = openMessage(message);
  if (!opened) return null;
  const envelope = opened.encryptedPayload;
  delete opened.encryptedPayload;
  delete opened.fileEncryption;
  return {
    ...opened,
    encrypted: Boolean(envelope),
    encryptionAlgorithm: envelope?.algorithm || null,
  };
}

function replaceStoredMessage(messageId, openedMessage) {
  const index = db.messages.findIndex((item) => item.id === messageId);
  if (index < 0) return null;
  db.messages[index] = sealMessage(openedMessage);
  return db.messages[index];
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(String(password), salt, 64).toString("hex") };
}

function verifyPassword(password, user) {
  try {
    const actual = Buffer.from(scryptSync(String(password), user.passwordSalt, 64).toString("hex"), "hex");
    const expected = Buffer.from(user.passwordHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, passwordSalt, totpSecret, pendingTotpSecret, recoveryCodes, ...safe } = user;
  if (safe.statusExpiresAt && safe.statusExpiresAt <= Date.now()) {
    safe.statusText = "";
    safe.statusEmoji = "";
    safe.statusExpiresAt = 0;
  }
  return safe;
}

function directoryUser(user) {
  const safe = publicUser(user);
  if (!safe) return null;
  const { email, settings, blockedUsers, login, ...directory } = safe;
  return directory;
}

function makeInviteCode() {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
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
      if (total > MAX_BODY) {
        reject(Object.assign(new Error("Слишком большой запрос"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolveBody({});
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Некорректный JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function tokenFromRequest(req, url) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return url.searchParams.get("token") || "";
}

function findSession(token) {
  const hash = sha256(token || "");
  const session = db.sessions.find((item) => (item.tokenHash === hash || item.token === token) && !item.revokedAt);
  if (!session) return null;
  if (session.accessExpiresAt && session.accessExpiresAt <= Date.now()) return null;
  return session;
}

function sessionUser(token) {
  const session = findSession(token);
  if (!session) return null;
  return db.users.find((item) => item.id === session.userId) || null;
}

function requireUser(req, res, url) {
  const token = tokenFromRequest(req, url);
  const session = findSession(token);
  const user = session ? db.users.find((item) => item.id === session.userId) : null;
  if (!user) {
    fail(res, 401, "Требуется авторизация или обновление access-токена");
    return null;
  }
  session.lastUsedAt = Date.now();
  return { user, token, session };
}

function isAdmin(chat, userId) {
  return chat?.ownerId === userId || chat?.admins?.includes(userId);
}

function isMember(chat, userId) {
  return Boolean(chat?.participants?.includes(userId));
}

function canPost(chat, userId) {
  if (!isMember(chat, userId)) return false;
  return chat.type !== "channel" || isAdmin(chat, userId);
}

function chatForUser(chat, userId) {
  if (!chat) return null;
  const pendingRequests = isAdmin(chat, userId) ? (chat.pendingRequests || []) : [];
  const readSequence = Number(chat.readState?.[userId]?.sequence || 0);
  const unreadCount = db.messages.filter((message) => message.chatId === chat.id && message.senderId !== userId && Number(message.sequence || 0) > readSequence && !(message.hiddenFor || []).includes(userId)).length;
  return { ...chat, pendingRequests, unreadCount, myRole: chat.ownerId === userId ? "owner" : (chat.roles?.[userId] || (chat.admins?.includes(userId) ? "admin" : "member")) };
}

function extractDataUrl(dataUrl, fallbackMime = "application/octet-stream") {
  const value = String(dataUrl || "");
  if (!value.startsWith("data:")) return null;
  const marker = ";base64,";
  const splitAt = value.indexOf(marker);
  if (splitAt < 5) return null;
  const header = value.slice(5, splitAt);
  const mimeType = (header.split(";")[0] || fallbackMime).trim();
  try { return { mimeType, buffer: Buffer.from(value.slice(splitAt + marker.length), "base64") }; }
  catch { return null; }
}

const mimeToExt = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
  "video/webm": ".webm", "video/mp4": ".mp4", "audio/webm": ".webm", "audio/mp4": ".m4a", "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg", "application/pdf": ".pdf", "text/plain": ".txt",
};

function saveDataFile(dataUrl, originalName, requestedMime) {
  const parsed = extractDataUrl(dataUrl, requestedMime);
  if (!parsed) return { content: dataUrl, mimeType: requestedMime, size: 0 };
  const originalExt = extname(originalName || "").replace(/[^.a-zA-Z0-9]/g, "").slice(0, 10);
  const extension = originalExt || mimeToExt[parsed.mimeType] || ".bin";
  const fileName = `${Date.now()}-${randomUUID()}${extension}`;
  writeFileSync(join(UPLOAD_DIR, fileName), parsed.buffer);
  return {
    content: `/uploads/${fileName}`,
    mimeType: parsed.mimeType,
    size: parsed.buffer.length,
  };
}

function encryptedMediaName(content) {
  if (!String(content || "").startsWith("/api/media/")) return null;
  return normalize(String(content).replace(/^\/api\/media\//, "")).replace(/^\.\.(\/|\\)/, "");
}

function saveEncryptedMessageBuffer(buffer, mimeType, originalName) {
  const originalExt = extname(originalName || "").replace(/[^.a-zA-Z0-9]/g, "").slice(0, 10);
  const extension = originalExt || mimeToExt[mimeType] || ".bin";
  const fileName = `${Date.now()}-${randomUUID()}${extension}.menc`;
  const { ciphertext, envelope } = messageCrypto.encryptBuffer(buffer, `file:${fileName}`);
  writeFileSync(join(UPLOAD_DIR, fileName), ciphertext);
  return {
    content: `/api/media/${fileName}`,
    mimeType,
    size: buffer.length,
    fileEncryption: envelope,
  };
}

function saveEncryptedMessageFile(dataUrl, originalName, requestedMime) {
  const parsed = extractDataUrl(dataUrl, requestedMime);
  if (!parsed) return { content: dataUrl, mimeType: requestedMime, size: 0 };
  return saveEncryptedMessageBuffer(parsed.buffer, parsed.mimeType, originalName);
}

function readDecryptedMessageFile(openedMessage) {
  const fileName = encryptedMediaName(openedMessage?.content);
  if (!fileName || !openedMessage?.fileEncryption) return null;
  const path = join(UPLOAD_DIR, fileName);
  if (!path.startsWith(UPLOAD_DIR) || !existsSync(path) || !statSync(path).isFile()) return null;
  const ciphertext = readFileSync(path);
  return messageCrypto.decryptBuffer(ciphertext, openedMessage.fileEncryption, `file:${fileName}`);
}

function cloneEncryptedMessageFile(openedMessage) {
  const plain = readDecryptedMessageFile(openedMessage);
  if (!plain) return null;
  return saveEncryptedMessageBuffer(plain, openedMessage.mimeType || "application/octet-stream", openedMessage.name || "file.bin");
}

function deleteUploadedFile(content) {
  const raw = String(content || "");
  const fileName = raw.startsWith("/uploads/")
    ? normalize(raw.replace(/^\/uploads\//, "")).replace(/^\.\.(\/|\\)/, "")
    : encryptedMediaName(raw);
  if (!fileName) return;
  const path = join(UPLOAD_DIR, fileName);
  try {
    if (path.startsWith(UPLOAD_DIR) && existsSync(path)) unlinkSync(path);
  } catch {}
}

function createSystemMessage(chatId, senderId, text) {
  const now = Date.now();
  const message = sealMessage({
    id: randomUUID(), chatId, senderId, type: "system", text,
    timestamp: now, edited: false, likes: [], hiddenFor: [],
  });
  db.messages.push(message);
  const chat = db.chats.find((item) => item.id === chatId);
  if (chat) chat.updatedAt = now;
  return message;
}

function migrateLegacyMessages() {
  let changed = false;
  const migratedPlainFiles = new Set();
  db.messages = db.messages.map((stored) => {
    if (stored.encryptedPayload) {
      const opened = openMessage(stored);
      const removedFields = ["paid", "price", "currency", "unlockedBy", "paymentId"];
      const hadRemovedFields = removedFields.some((field) => opened[field] !== undefined);
      for (const field of removedFields) delete opened[field];
      if (hadRemovedFields) { changed = true; return sealMessage(opened); }
      return stored;
    }
    const opened = { ...stored };
    for (const field of ["paid", "price", "currency", "unlockedBy", "paymentId"]) delete opened[field];

    if (opened.type !== "text" && String(opened.content || "").startsWith("/uploads/")) {
      const fileName = normalize(String(opened.content).replace(/^\/uploads\//, "")).replace(/^\.\.(\/|\\)/, "");
      const path = join(UPLOAD_DIR, fileName);
      if (path.startsWith(UPLOAD_DIR) && existsSync(path) && statSync(path).isFile()) {
        const encryptedFile = saveEncryptedMessageBuffer(
          readFileSync(path),
          opened.mimeType || "application/octet-stream",
          opened.name || fileName,
        );
        opened.content = encryptedFile.content;
        opened.fileEncryption = encryptedFile.fileEncryption;
        opened.size = encryptedFile.size;
        migratedPlainFiles.add(path);
      }
    }

    changed = true;
    return sealMessage(opened);
  });

  const avatarFiles = new Set(
    db.users
      .map((item) => item.avatar)
      .filter((value) => String(value || "").startsWith("/uploads/"))
      .map((value) => join(UPLOAD_DIR, normalize(value.replace(/^\/uploads\//, "")))),
  );
  for (const path of migratedPlainFiles) {
    if (!avatarFiles.has(path)) {
      try { unlinkSync(path); } catch {}
    }
  }

  if (changed) persist();
}

migrateLegacyMessages();

function ensureDemoUsers() {
  const now = Date.now();
  const demos = [
    { id: "demo-alisa", username: "Алиса", email: "alisa@demo.com", password: "demo", age: 22, gender: "female", relationshipStatus: "single", city: "Москва", bio: "Люблю котиков, кофе и вечерние прогулки", avatarColor: "#e17076" },
    { id: "demo-boris", username: "Борис", email: "boris@demo.com", password: "demo", age: 28, gender: "male", relationshipStatus: "single", city: "СПб", bio: "Senior разработчик, ищу свою половинку", avatarColor: "#7bc862" },
  ];
  let changed = false;
  for (const demo of demos) {
    if (db.users.some((item) => item.email === demo.email)) continue;
    const credentials = hashPassword(demo.password);
    db.users.push({
      id: demo.id, userId: allocateUserId(), username: demo.username, publicUsername: "", login: demo.email.split("@")[0].toLowerCase(), email: demo.email.toLowerCase(),
      passwordHash: credentials.hash, passwordSalt: credentials.salt,
      age: demo.age, gender: demo.gender, relationshipStatus: demo.relationshipStatus,
      city: demo.city, bio: demo.bio, status: "offline", lastSeen: now,
      avatarColor: demo.avatarColor, avatar: null, settings: { ...DEFAULT_SETTINGS },
      blockedUsers: [], createdAt: now, role: "user", isSystemAdmin: false,
    });
    changed = true;
  }
  if (changed) persist();
}
db.meta ||= { sequence: 0, nextUserId: 1000, createdAt: Date.now() };
db.meta.nextUserId = Math.max(Number(db.meta.nextUserId || 1000), ...db.users.map((item) => Number(item.userId || 0) + 1), 1000);
normalizeSystemSettings(db);
function allocateUserId() {
  const value = Number(db.meta.nextUserId || 1000);
  db.meta.nextUserId = value + 1;
  return value;
}
for (const existingUser of db.users) {
  existingUser.login ||= String(existingUser.email || existingUser.username || existingUser.id).split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32);
  existingUser.userId ||= allocateUserId();
  existingUser.publicUsername ||= "";
  existingUser.role ||= existingUser.isSystemAdmin ? "admin" : "user";
  existingUser.isSystemAdmin = existingUser.role === "admin";
  existingUser.twoFactorEnabled ||= false;
  existingUser.statusText ||= ""; existingUser.statusEmoji ||= ""; existingUser.statusExpiresAt ||= 0;
  existingUser.avatarKind ||= existingUser.avatarMimeType?.startsWith("video/") ? "video" : "image";
}

function ensureBootstrapAdmin() {
  const login = String(process.env.BOOTSTRAP_ADMIN_LOGIN || "admin").trim().toLowerCase();
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "Admin123!ChangeMe");
  const displayName = String(process.env.BOOTSTRAP_ADMIN_NAME || "Главный администратор").trim() || "Главный администратор";
  const publicUsername = String(process.env.BOOTSTRAP_ADMIN_USERNAME || "admin").trim().replace(/^@/, "").toLowerCase();
  let admin = db.users.find((item) => item.login === login);
  if (!admin) {
    const credentials = hashPassword(password);
    admin = {
      id: randomUUID(), userId: allocateUserId(), username: displayName, publicUsername, login,
      passwordHash: credentials.hash, passwordSalt: credentials.salt,
      age: 18, gender: "", relationshipStatus: "single", city: "", bio: "Системный администратор",
      avatar: null, avatarColor: "#d64f87", status: "offline", lastSeen: Date.now(),
      settings: { ...DEFAULT_SETTINGS }, blockedUsers: [], createdAt: Date.now(), twoFactorEnabled: false,
      role: "admin", isSystemAdmin: true, mustChangePassword: !process.env.BOOTSTRAP_ADMIN_PASSWORD || password === "Admin123!ChangeMe",
    };
    db.users.push(admin);
    console.warn(`Создан системный администратор: login=${login}. Пароль задаётся через BOOTSTRAP_ADMIN_PASSWORD.`);
  } else {
    admin.role = "admin";
    admin.isSystemAdmin = true;
    admin.userId ||= allocateUserId();
    admin.publicUsername ||= publicUsername;
  }
  return admin;
}
ensureBootstrapAdmin();
function ensureDefaultBoards() {
  if (db.boards.length) return;
  const createdAt = Date.now();
  const defaults = [
    ["Все города", "Общее", "Общая доска объявлений"],
    ["Все города", "Работа", "Вакансии, подработка и поиск исполнителей"],
    ["Все города", "Техника", "Продажа, обмен и помощь с техникой"],
    ["Все города", "Хобби", "Сообщества и объявления по интересам"],
  ];
  for (const [city, interest, description] of defaults) db.boards.push({ id: randomUUID(), title: `${interest} · ${city}`, city, interest, description, createdBy: db.users.find((item) => item.isSystemAdmin)?.id || null, moderators: [], createdAt, updatedAt: createdAt, rules: "Не публикуйте незаконные товары, спам и чужие персональные данные.", color: "#7c5cff" });
}
ensureDefaultBoards();

function ensureAiCompanionUsers() {
  for (const persona of AI_PERSONA_PUBLIC) {
    let aiUser = db.users.find((item) => item.id === persona.accountId || item.aiPersonaId === persona.id);
    if (!aiUser) {
      const credentials = hashPassword(randomBytes(32).toString("hex"));
      aiUser = {
        id: persona.accountId, userId: allocateUserId(), username: persona.name, publicUsername: persona.publicUsername,
        login: `__nemax_ai_${persona.id}`, passwordHash: credentials.hash, passwordSalt: credentials.salt,
        age: 21, gender: persona.gender, relationshipStatus: "not_applicable", city: "НЕМАКС", bio: persona.bio,
        avatar: persona.avatar || null, avatarColor: persona.avatarColor, status: "online", lastSeen: Date.now(),
        settings: { ...DEFAULT_SETTINGS }, blockedUsers: [], createdAt: Date.now(), role: "user", isSystemAdmin: false,
        isAi: true, aiPersonaId: persona.id, loginDisabled: true, statusText: persona.statusText, statusEmoji: persona.statusEmoji,
        statusExpiresAt: 0, avatarKind: "image", avatarMimeType: "",
      };
      db.users.push(aiUser);
    } else {
      aiUser.username = persona.name; aiUser.publicUsername = persona.publicUsername; aiUser.avatarColor = persona.avatarColor;
      aiUser.avatar = persona.avatar || aiUser.avatar || null; aiUser.bio = persona.bio; aiUser.gender = persona.gender;
      aiUser.status = "online"; aiUser.statusText = persona.statusText; aiUser.statusEmoji = persona.statusEmoji;
      aiUser.isAi = true; aiUser.aiPersonaId = persona.id; aiUser.loginDisabled = true; aiUser.userId ||= allocateUserId();
    }
  }
}

function ensureSystemChatsForUser(user) {
  if (!user || user.isAi || user.isBot) return;
  let saved = db.chats.find((chat) => chat.isSavedMessages && chat.participants?.length === 1 && chat.participants[0] === user.id);
  if (!saved) {
    const now = Date.now();
    saved = {
      id: randomUUID(), type: "private", participants: [user.id], title: "Избранное",
      description: "Личное облачное хранилище сообщений и файлов", isSavedMessages: true, systemChat: true,
      avatarColor: "#7c5cff", updatedAt: now, mutedBy: [], pinnedMessageId: null, pendingRequests: [], admins: [],
      roles: {}, readState: {}, archivedBy: [], autoDeleteSeconds: 0, sequence: ++db.meta.sequence,
    };
    db.chats.push(saved);
    db.messages.push(sealMessage({
      id: randomUUID(), chatId: saved.id, senderId: user.id, type: "system",
      text: "Избранное — ваш личный чат. Здесь можно хранить заметки, сообщения, ссылки и файлы.",
      timestamp: now, edited: false, likes: [], reactions: {}, hiddenFor: [], deliveredTo: {}, viewedBy: {}, sequence: ++db.meta.sequence,
    }));
  }
  for (const persona of AI_PERSONA_PUBLIC) {
    const aiUser = db.users.find((item) => item.aiPersonaId === persona.id);
    if (!aiUser) continue;
    const existing = db.chats.find((item) => item.isAiChat && item.aiPersonaId === persona.id && item.participants?.includes(user.id));
    if (existing) continue;
    const now = Date.now();
    const chat = {
      id: randomUUID(), type: "private", participants: [user.id, aiUser.id], title: persona.name,
      isAiChat: true, aiPersonaId: persona.id, systemChat: true, avatarColor: persona.avatarColor, updatedAt: now,
      mutedBy: [], pinnedMessageId: null, pendingRequests: [], admins: [], roles: {}, readState: {}, archivedBy: [],
      autoDeleteSeconds: 0, sequence: ++db.meta.sequence,
    };
    db.chats.push(chat);
    db.messages.push(sealMessage({
      id: randomUUID(), chatId: chat.id, senderId: aiUser.id, type: "text", text: persona.greeting,
      timestamp: now, edited: false, likes: [], reactions: {}, hiddenFor: [], deliveredTo: {}, viewedBy: {},
      aiGenerated: true, aiProvider: "system", sequence: ++db.meta.sequence,
    }));
  }
}

ensureAiCompanionUsers();
for (const existingUser of db.users.filter((item) => !item.isAi)) ensureSystemChatsForUser(existingUser);

for (const session of db.sessions) {
  if (session.token && !session.tokenHash) { session.tokenHash = sha256(session.token); session.id ||= session.token.slice(0, 12); }
  session.accessExpiresAt ||= Date.now() + 15 * 60 * 1000;
  session.refreshExpiresAt ||= Date.now() + 30 * 24 * 60 * 60 * 1000;
}
for (const chat of db.chats) {
  chat.roles ||= chat.ownerId ? { [chat.ownerId]: "owner" } : {};
  for (const adminId of chat.admins || []) if (adminId !== chat.ownerId) chat.roles[adminId] ||= "admin";
  chat.readState ||= {}; chat.archivedBy ||= []; chat.restrictions ||= {}; chat.bans ||= {}; chat.sequence ||= ++db.meta.sequence;
}
for (const message of db.messages) message.sequence ||= ++db.meta.sequence;
await persist();

if (process.env.SEED_DEMO_USERS === "true") ensureDemoUsers();

function seedPrivateChatsFor(user) {
  const demoUsers = db.users.filter((item) => item.id === "demo-alisa" || item.id === "demo-boris");
  for (const [index, demo] of demoUsers.entries()) {
    const exists = db.chats.some((chat) => chat.type === "private" && chat.participants.includes(user.id) && chat.participants.includes(demo.id));
    if (exists) continue;
    const chat = {
      id: randomUUID(), type: "private", participants: [user.id, demo.id], title: demo.username,
      avatarColor: demo.avatarColor, updatedAt: Date.now() - index * 1000,
      mutedBy: [], pinnedMessageId: null, pendingRequests: [], admins: [],
    };
    db.chats.push(chat);
    if (demo.id === "demo-alisa") {
      db.messages.push(sealMessage({
        id: randomUUID(), chatId: chat.id, senderId: demo.id, type: "text",
        text: "Привет! Рад знакомству 👋", timestamp: Date.now(), edited: false,
        likes: [], hiddenFor: [],
      }));
    }
  }
}

const realtimeOutbox = (() => {
  try { return existsSync(REALTIME_OUTBOX_FILE) ? JSON.parse(readFileSync(REALTIME_OUTBOX_FILE, "utf8")) : []; }
  catch { return []; }
})();
function persistRealtimeOutbox() {
  try { writeFileSync(REALTIME_OUTBOX_FILE, JSON.stringify(realtimeOutbox, null, 2), "utf8"); } catch (error) { console.warn("Outbox:", error.message); }
}
let realtimeFlushRunning = false;
let realtimeRetryTimer = null;

function enqueueRealtimeEvent(event) {
  realtimeOutbox.push({ eventId: randomUUID(), ...event, queuedAt: Date.now(), attempts: 0 });
  persistRealtimeOutbox();
  redis.xadd("messenger:events", realtimeOutbox.at(-1)).catch(() => {});
  if (realtimeOutbox.length > 1000) {
    realtimeOutbox.splice(0, realtimeOutbox.length - 1000);
    console.warn("Очередь realtime переполнена: старые события удалены");
  }
  flushRealtimeOutbox();
}

async function flushRealtimeOutbox() {
  if (realtimeFlushRunning || !realtimeOutbox.length) return;
  realtimeFlushRunning = true;
  clearTimeout(realtimeRetryTimer);
  try {
    while (realtimeOutbox.length) {
      const event = realtimeOutbox[0];
      try {
        await postInternalJson(REALTIME_INTERNAL_URL, "/internal/events", event, { timeoutMs: 2500 });
        realtimeOutbox.shift();
        persistRealtimeOutbox();
      } catch (error) {
        event.attempts += 1;
        if (event.attempts === 1 || event.attempts % 10 === 0) {
          console.warn(`Realtime временно недоступен, событие сохранено в очереди: ${error.message}`);
        }
        realtimeRetryTimer = setTimeout(flushRealtimeOutbox, Math.min(1000 * event.attempts, 10_000));
        realtimeRetryTimer.unref?.();
        break;
      }
    }
  } finally {
    realtimeFlushRunning = false;
  }
}


function disconnectRealtimeSessions(sessionIds) {
  const cleanSessionIds = [...new Set((sessionIds || []).filter(Boolean))];
  if (!cleanSessionIds.length) return;
  postInternalJson(REALTIME_INTERNAL_URL, "/internal/disconnect-sessions", { sessionIds: cleanSessionIds }, { timeoutMs: 2500 })
    .catch((error) => console.warn(`Не удалось немедленно закрыть realtime-сессию: ${error.message}`));
}

function broadcastUsers(userIds, payload) {
  enqueueRealtimeEvent({ scope: "users", userIds: [...new Set((userIds || []).filter(Boolean))], payload, queueOffline: true });
}

function broadcastChat(chat, payload) {
  broadcastUsers(chat?.participants || [], payload);
  if (payload?.type === "message.created") {
    const senderId = payload.message?.senderId;
    for (const recipientId of (chat?.participants || []).filter((id) => id !== senderId && !chat.mutedBy?.includes(id))) {
      const recipient = db.users.find((item) => item.id === recipientId);
      const enabled = ["group", "room"].includes(chat.type) ? recipient?.settings?.groupNotifications !== false : chat.type === "channel" ? recipient?.settings?.channelNotifications !== false : recipient?.settings?.messageNotifications !== false;
      if (!enabled) continue;
      const subscriptions = db.pushSubscriptions?.filter((item) => item.userId === recipientId) || [];
      const preview = recipient?.settings?.notificationPreview === false || payload.message?.type === "e2e" ? "Новое сообщение" : (payload.message?.text || payload.message?.name || "Новое вложение");
      pushService.sendMany(subscriptions, { title: chat.title || "Новое сообщение", body: preview, data: { url: `/?chat=${chat.id}` } }).catch(() => {});
    }
  }
}

function broadcastAll(payload) {
  enqueueRealtimeEvent({ scope: "all", payload, queueOffline: false });
}

function isPublicWebhookUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (["localhost", "0.0.0.0", "::1"].includes(host)) return false;
    if (/^(10|127|169\.254|192\.168)\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch { return false; }
}

function dispatchBotUpdates(chat, openedMessage) {
  if (openedMessage?.type === "e2e") return;
  db.meta.botUpdateId ||= 0;
  for (const bot of db.bots || []) {
    if (!bot.enabled || bot.botUserId === openedMessage.senderId || !chat.participants.includes(bot.botUserId)) continue;
    const update = {
      id: randomUUID(), updateId: ++db.meta.botUpdateId, botId: bot.id, createdAt: Date.now(),
      type: "message", payload: { message: publicMessage(sealMessage({ ...openedMessage })), chat: { id: chat.id, type: chat.type, title: chat.title || null } },
    };
    db.botUpdates.push(update);
    if (bot.webhookUrl && process.env.ENABLE_BOT_WEBHOOKS === "true" && isPublicWebhookUrl(bot.webhookUrl)) {
      fetch(bot.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ update_id: update.updateId, ...update.payload }), signal: AbortSignal.timeout(5000) })
        .then((response) => { if (response.ok) { update.deliveredAt = Date.now(); persist().catch(() => {}); } })
        .catch(() => {});
    }
  }
  if (db.botUpdates.length > 50_000) db.botUpdates.splice(0, db.botUpdates.length - 50_000);
}

function syncChat(chat, reason) {
  broadcastChat(chat, { type: "sync", reason, chatId: chat?.id, at: Date.now() });
}

const aiReplyQueues = new Map();
function queueAiReply(chat, humanMessage) {
  if (!chat?.isAiChat || !chat.aiPersonaId || humanMessage?.type !== "text") return;
  const aiUser = db.users.find((item) => item.isAi && item.aiPersonaId === chat.aiPersonaId);
  const humanUser = db.users.find((item) => !item.isAi && chat.participants.includes(item.id));
  if (!aiUser || !humanUser || humanMessage.senderId !== humanUser.id) return;
  const previous = aiReplyQueues.get(chat.id) || Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    broadcastUsers([humanUser.id], { type: "typing", chatId: chat.id, userId: aiUser.id, state: "typing", expiresAt: Date.now() + 60_000 });
    const history = db.messages.filter((stored) => stored.chatId === chat.id)
      .map((stored) => { try { return openMessage(stored); } catch { return null; } })
      .filter((message) => message && message.type === "text" && String(message.text || "").trim())
      .slice(-40).map((message) => ({ senderId: message.senderId, content: String(message.text).slice(0, 6000), timestamp: message.timestamp }));
    let generated;
    try {
      generated = await postInternalJson(AI_SERVER_INTERNAL_URL, "/internal/generate", {
        personaId: chat.aiPersonaId, chatId: chat.id,
        user: { id: humanUser.id, username: humanUser.username, city: humanUser.city || "" },
        history, latestMessage: humanMessage.text,
      }, { timeoutMs: Number(process.env.AI_REPLY_TIMEOUT_MS || 55_000) });
    } catch (error) {
      const safeReason = String(error.message || "неизвестная ошибка").replace(/pza_[A-Za-z0-9_-]+/g, "[скрытый ключ]").slice(0, 500);
      generated = { text: `ИИ-сервис не смог ответить. Причина: ${safeReason}. Проверьте AI_PROVIDER, AI_API_BASE_URL, AI_MODEL, баланс и API-ключ, затем повторите сообщение.`, provider: "unavailable", error: safeReason };
    }
    const text = String(generated.text || "").trim().slice(0, 24_000);
    if (!text) return;
    const now = Date.now();
    const openedReply = {
      id: randomUUID(), chatId: chat.id, senderId: aiUser.id, type: "text", text, timestamp: now,
      edited: false, likes: [], reactions: {}, hiddenFor: [], deliveredTo: {}, viewedBy: {}, clientMessageId: randomUUID(),
      sequence: ++db.meta.sequence, aiGenerated: true, aiProvider: generated.provider || "unknown", aiModel: generated.model || "",
    };
    const storedReply = sealMessage(openedReply); db.messages.push(storedReply); chat.updatedAt = now; chat.sequence = ++db.meta.sequence;
    db.aiConversations ||= [];
    let conversation = db.aiConversations.find((item) => item.chatId === chat.id);
    if (!conversation) { conversation = { chatId: chat.id, personaId: chat.aiPersonaId, userId: humanUser.id, createdAt: now, messageCount: 0 }; db.aiConversations.push(conversation); }
    conversation.messageCount = Number(conversation.messageCount || 0) + 2; conversation.lastReplyAt = now;
    conversation.lastProvider = generated.provider || "unknown"; conversation.updatedAt = now;
    await persist();
    broadcastUsers([humanUser.id], { type: "typing", chatId: chat.id, userId: aiUser.id, state: "idle", expiresAt: Date.now() });
    broadcastChat(chat, { type: "message.created", chatId: chat.id, message: publicMessage(storedReply), at: Date.now() });
  }).finally(() => { if (aiReplyQueues.get(chat.id) === job) aiReplyQueues.delete(chat.id); });
  aiReplyQueues.set(chat.id, job);
}

async function internalHandler(req, res, url) {
  if (!hasValidInternalSecret(req)) return fail(res, 401, "Неверный внутренний секрет");

  if (url.pathname === "/internal/realtime/auth" && req.method === "POST") {
    const body = await parseBody(req);
    const token = String(body.token || "");
    const session = findSession(token);
    const user = session ? db.users.find((item) => item.id === session.userId) : null;
    if (!user) return fail(res, 401, "Сессия недействительна");
    return sendJson(res, 200, { user: publicUser(user), sessionId: session.id || session.token?.slice(0, 12) });
  }

  if (url.pathname === "/internal/presence" && req.method === "POST") {
    const body = await parseBody(req);
    const user = db.users.find((item) => item.id === body.userId);
    if (!user) return fail(res, 404, "Пользователь не найден");
    user.status = body.status === "online" ? "online" : "offline";
    user.lastSeen = Number(body.lastSeen || Date.now());
    await persist();
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (url.pathname === "/internal/realtime/authorize-event" && req.method === "POST") {
    const body = await parseBody(req);
    const actor = db.users.find((item) => item.id === body.userId);
    const event = body.event || {};
    if (!actor) return fail(res, 401, "Пользователь не найден");
    if (["typing", "recording"].includes(event.type)) {
      const chat = db.chats.find((item) => item.id === event.chatId);
      if (!chat || !isMember(chat, actor.id)) return fail(res, 403, "Нет доступа к чату");
      return sendJson(res, 200, { userIds: chat.participants });
    }
    if (String(event.type || "").startsWith("call.")) {
      const call = db.calls?.find((item) => item.id === event.callId && item.participantIds.includes(actor.id));
      if (!call) return fail(res, 403, "Нет доступа к звонку");
      if (event.targetUserId && !call.participantIds.includes(event.targetUserId)) return fail(res, 403, "Получатель не участвует в звонке");
      return sendJson(res, 200, { userIds: event.targetUserId ? [event.targetUserId] : call.participantIds });
    }
    return fail(res, 400, "Недопустимое realtime-событие");
  }

  if (url.pathname === "/internal/security/rotate-if-due" && req.method === "POST") {
    await parseBody(req);
    const result = messageCrypto.rotateIfDue();
    const status = messageCrypto.status();
    return sendJson(res, 200, {
      rotated: result.rotated,
      keyId: result.key.id,
      keyCreatedAt: result.key.createdAt,
      nextRotationAt: status.nextRotationAt,
    });
  }

  if (url.pathname === "/internal/jobs/run" && req.method === "POST") {
    await parseBody(req);
    const result = await runBackgroundJobs(platformContext);
    return sendJson(res, 200, { ok: true, ...(result || {}), at: Date.now() });
  }

  if (url.pathname === "/internal/health" && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      service: "core-api",
      realtimeOutbox: realtimeOutbox.length,
      encryption: messageCrypto.status(),
      at: Date.now(),
    });
  }

  return fail(res, 404, "Внутренний маршрут не найден");
}

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowedOrigins = String(PUBLIC_ORIGIN || "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowOrigin = allowedOrigins.length ? (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]) : (origin || "*");
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self)");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' ws: wss: https:; frame-src 'self' https:; object-src 'none'; base-uri 'self'");
  if (req.socket.encrypted || req.headers["x-forwarded-proto"] === "https") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function sendDecryptedMedia(req, res, user, pathname) {
  const fileName = normalize(pathname.replace(/^\/api\/media\//, "")).replace(/^\.\.(\/|\\)/, "");
  if (!fileName) return false;
  const contentPath = `/api/media/${fileName}`;

  let openedMessage = null;
  for (const stored of db.messages) {
    let opened;
    try { opened = openMessage(stored); } catch { continue; }
    if (opened.content === contentPath) {
      openedMessage = opened;
      break;
    }
  }
  if (!openedMessage) return false;

  const chat = db.chats.find((item) => item.id === openedMessage.chatId);
  if (!chat || !isMember(chat, user.id) || (openedMessage.hiddenFor || []).includes(user.id)) return false;

  const plain = readDecryptedMessageFile(openedMessage);
  if (!plain) return false;

  const mimeType = openedMessage.mimeType || "application/octet-stream";
  const safeName = String(openedMessage.name || "file").replace(/[\r\n"\/\\]/g, "_");
  const range = req.headers.range;
  const commonHeaders = {
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${mimeType.startsWith("image/") || mimeType.startsWith("audio/") || mimeType.startsWith("video/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safeName)}`,
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range));
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), plain.length - 1) : plain.length - 1;
      if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && start < plain.length) {
        const chunk = plain.subarray(start, end + 1);
        res.writeHead(206, {
          ...commonHeaders,
          "Content-Length": chunk.length,
          "Content-Range": `bytes ${start}-${end}/${plain.length}`,
        });
        if (req.method === "HEAD") return res.end();
        return res.end(chunk);
      }
    }
    res.writeHead(416, { "Content-Range": `bytes */${plain.length}` });
    return res.end();
  }

  res.writeHead(200, { ...commonHeaders, "Content-Length": plain.length });
  if (req.method === "HEAD") return res.end();
  res.end(plain);
  return true;
}

async function sendObjectMedia(req, res, user, pathname) {
  const key = decodeURIComponent(pathname.replace(/^\/api\/objects\//, ""));
  if (!key || key.includes("..")) return false;
  let openedMessage = null;
  for (const stored of db.messages) {
    let opened; try { opened = openMessage(stored); } catch { continue; }
    if (opened.content === `/api/objects/${encodeURIComponent(key)}` || opened.content === `/api/objects/${key}`) { openedMessage = opened; break; }
  }
  let source = openedMessage;
  if (!source) {
    for (const post of db.boardPosts || []) {
      const media = (post.media || []).find((item) => item.content === `/api/objects/${encodeURIComponent(key)}` || item.content === `/api/objects/${key}`);
      if (media && post.status !== "deleted") { source = media; break; }
    }
  }
  if (!source) return false;
  if (openedMessage) {
    const chat = db.chats.find((item) => item.id === openedMessage.chatId);
    if (!chat || !isMember(chat, user.id) || (openedMessage.hiddenFor || []).includes(user.id)) return false;
  }
  const ciphertext = await objectStorage.get(key); if (!ciphertext) return false;
  const plain = messageCrypto.decryptBuffer(ciphertext, source.fileEncryption, `object:${key.split("/").pop().replace(/\.menc$/, "")}`);
  const mimeType = source.mimeType || "application/octet-stream";
  const safeName = String(source.name || "file").replace(/[\r\n"\/\\]/g, "_");
  res.writeHead(200, { "Content-Type": mimeType, "Content-Length": plain.length, "Cache-Control": "private, no-store", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(safeName)}` });
  if (req.method === "HEAD") return res.end(); res.end(plain); return true;
}

function serveFile(req, res, pathname) {
  if (pathname.startsWith("/uploads/")) {
    const rel = normalize(pathname.slice("/uploads/".length)).replace(/^\.\.(\/|\\)/, "");
    if (rel.endsWith(".menc")) { res.writeHead(404); res.end(); return true; }
    const file = join(UPLOAD_DIR, rel);
    if (!file.startsWith(UPLOAD_DIR) || !existsSync(file) || !statSync(file).isFile()) return false;
    const ext = extname(file).toLowerCase();
    const contentTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".pdf": "application/pdf", ".txt": "text/plain" };
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream", "Content-Length": statSync(file).size, "Cache-Control": "public, max-age=31536000, immutable" });
    createReadStream(file).pipe(res);
    return true;
  }
  if (!existsSync(DIST_DIR)) return false;
  let rel = pathname === "/" ? "index.html" : pathname.slice(1);
  let file = join(DIST_DIR, normalize(rel));
  if (!file.startsWith(DIST_DIR)) return false;
  if (!existsSync(file) || !statSync(file).isFile()) file = join(DIST_DIR, "index.html");
  const ext = extname(file).toLowerCase();
  const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
  res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream", "Content-Length": statSync(file).size });
  createReadStream(file).pipe(res);
  return true;
}

const platformContext = {
  getDb: () => db, persist, sendJson, fail, parseBody, publicMessage, openMessage, sealMessage, replaceStoredMessage,
  isMember, broadcastUsers, broadcastChat, syncChat, redis, pushService, objectStorage,
  uploadTempDir: UPLOAD_TEMP_DIR,
  encryptBuffer: (buffer, aad) => messageCrypto.encryptBuffer(buffer, aad),
  iceServers: [
    { urls: (process.env.STUN_URLS || "stun:stun.l.google.com:19302").split(",") },
    ...(process.env.TURN_URL ? [{ urls: process.env.TURN_URL.split(","), username: process.env.TURN_USERNAME || "", credential: process.env.TURN_CREDENTIAL || "" }] : []),
  ],
};
const platformApi = createPlatformApi(platformContext);
const adminApi = createAdminApi({
  getDb: () => db, persist, sendJson, fail, parseBody, publicMessage, publicUser,
  hashPassword, broadcastAll, disconnectRealtimeSessions, allocateUserId, defaultUserSettings: DEFAULT_SETTINGS, ensureSystemChatsForUser,
  getInfrastructureHealth: async () => ({
    database: await stateStore.health(), redis: await redis.health(), objectStorage: await objectStorage.health(), push: await pushService.health(),
    encryption: messageCrypto.status(), realtimeOutbox: realtimeOutbox.length,
  }),
});

async function apiHandler(req, res, url) {
  const path = url.pathname;
  const method = req.method || "GET";

  if (path === "/metrics" && method === "GET") {
    const body = [
      "# TYPE messenger_core_users gauge", `messenger_core_users ${db.users.length}`,
      "# TYPE messenger_core_chats gauge", `messenger_core_chats ${db.chats.length}`,
      "# TYPE messenger_core_messages gauge", `messenger_core_messages ${db.messages.length}`,
      "# TYPE messenger_core_realtime_outbox gauge", `messenger_core_realtime_outbox ${realtimeOutbox.length}`,
      "# TYPE nemax_code_projects gauge", `nemax_code_projects ${(db.codeProjects || []).filter((item) => !item.deletedAt).length}`,
      "# TYPE nemax_code_runs gauge", `nemax_code_runs ${(db.codeRuns || []).length}`,
    ].join("\n") + "\n";
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4", "Content-Length": Buffer.byteLength(body) }); return res.end(body);
  }

  if (path === "/api/health" && method === "GET") {
    let realtime = { ok: false, error: "Realtime service недоступен" };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const response = await fetch(`${REALTIME_INTERNAL_URL}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      realtime = await response.json();
    } catch {}
    let codeRunner = { ok: false, enabled: false, error: "Code Runner недоступен" };
    try {
      const payload = await getInternalJson(CODE_RUNNER_INTERNAL_URL, "/health", { timeoutMs: 1200, socketPath: CODE_RUNNER_SOCKET });
      codeRunner = { ok: true, ...payload };
    } catch {}
    let gameServer = { ok: false, error: "Game Server недоступен" };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const response = await fetch(`${GAME_SERVER_INTERNAL_URL}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      gameServer = await response.json();
    } catch {}
    let aiServer = { ok: false, error: "AI Server недоступен" };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const response = await fetch(`${AI_SERVER_INTERNAL_URL}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      aiServer = await response.json();
    } catch {}
    return sendJson(res, 200, {
      ok: true,
      time: Date.now(),
      services: {
        core: { ok: true, service: "core-api", realtimeOutbox: realtimeOutbox.length },
        realtime,
        codeRunner,
        gameServer,
        aiServer,
      },
      messageEncryption: messageCrypto.status(),
      infrastructure: {
        database: await stateStore.health(),
        redis: await redis.health(),
        objectStorage: await objectStorage.health(),
        push: await pushService.health(),
      },
    });
  }

  if (path === "/api/config/public" && method === "GET") {
    const settings = normalizeSystemSettings(db);
    return sendJson(res, 200, {
      siteName: settings.siteName,
      announcement: settings.announcement,
      registrationEnabled: settings.registrationEnabled,
      maintenanceMode: settings.maintenanceMode,
      maintenanceMessage: settings.maintenanceMessage,
    });
  }

  if (path.startsWith("/api/bot/") && (method === "GET" || method === "POST")) {
    const handled = await platformApi(req, res, url, null);
    if (handled !== false) return;
  }

  if (path === "/api/auth/refresh" && method === "POST") {
    const handled = await platformApi(req, res, url, null);
    if (handled !== false) return;
  }

  if (path === "/api/auth/register" && method === "POST") {
    const systemSettings = normalizeSystemSettings(db);
    if (!systemSettings.registrationEnabled) return fail(res, 403, "Регистрация временно отключена администратором");
    const body = await parseBody(req);
    const login = String(body.login || "").trim().toLowerCase();
    const username = String(body.username || body.displayName || "").trim();
    const publicUsername = String(body.publicUsername || "").trim().replace(/^@/, "").toLowerCase();
    const password = String(body.password || "");
    if (!/^[a-z0-9_]{3,32}$/.test(login) || !username || password.length < 8) return fail(res, 400, "Логин: 3–32 символа a-z/0-9/_. Имя обязательно. Пароль: минимум 8 символов");
    if (publicUsername && !/^[a-z0-9_]{5,32}$/.test(publicUsername)) return fail(res, 400, "Юзернейм: 5–32 символа a-z, 0-9 или _");
    if (db.users.some((item) => item.login === login)) return fail(res, 409, "Такой логин уже существует");
    if (publicUsername && db.users.some((item) => item.publicUsername === publicUsername)) return fail(res, 409, "Такой юзернейм уже занят");
    const credentials = hashPassword(password);
    const storedAvatar = body.avatar ? saveDataFile(body.avatar, body.avatarName || "avatar", body.avatarMimeType || "image/png") : null;
    const avatarData = storedAvatar?.content || null;
    const user = {
      id: randomUUID(), userId: allocateUserId(), username, publicUsername, login, passwordHash: credentials.hash, passwordSalt: credentials.salt,
      age: Number(body.age || 18), gender: body.gender || "", relationshipStatus: body.relationshipStatus || "single",
      city: String(body.city || ""), bio: String(body.bio || ""), avatar: avatarData,
      avatarColor: `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`, status: "offline", lastSeen: Date.now(),
      settings: { ...DEFAULT_SETTINGS }, blockedUsers: [], createdAt: Date.now(), twoFactorEnabled: false,
      statusText: "", statusEmoji: "", statusExpiresAt: 0,
      avatarMimeType: storedAvatar?.mimeType || "", avatarKind: storedAvatar?.mimeType?.startsWith("video/") ? "video" : "image",
      role: "user", isSystemAdmin: false, mustChangePassword: false,
    };
    db.users.push(user);
    ensureSystemChatsForUser(user);
    if (process.env.SEED_DEMO_USERS === "true") seedPrivateChatsFor(user);
    const created = createSessionRecord(user.id, req);
    db.sessions.push(created.record);
    await persist();
    broadcastAll({ type: "users.updated", at: Date.now() });
    return sendJson(res, 201, { token: created.accessToken, refreshToken: created.refreshToken, expiresAt: created.record.accessExpiresAt, user: publicUser(user) });
  }

  if (path === "/api/auth/login" && method === "POST") {
    const body = await parseBody(req);
    const login = String(body.login || body.email || "").trim().toLowerCase();
    const rateKey = `login:${req.socket.remoteAddress || "unknown"}:${login}`;
    const attempts = await redis.incr(rateKey, 15 * 60);
    if (attempts > 12) return fail(res, 429, "Слишком много попыток. Повторите позже");
    const user = db.users.find((item) => item.login === login || item.email?.toLowerCase() === login || item.username?.toLowerCase() === login);
    if (!user || !verifyPassword(body.password, user)) return fail(res, 401, "Неверный логин или пароль");
    if (user.loginDisabled || user.isAi) return fail(res, 403, "Этот системный аккаунт недоступен для входа");
    if (user.bannedAt) return fail(res, 403, `Аккаунт заблокирован: ${user.banReason || "обратитесь к администратору"}`);
    if (user.twoFactorEnabled && !verifyTotp(user.totpSecret, body.totp)) return fail(res, 401, "Требуется корректный код двухэтапной проверки", { twoFactorRequired: true });
    await redis.del(rateKey);
    const created = createSessionRecord(user.id, req);
    user.lastSeen = Date.now();
    db.sessions.push(created.record);
    await persist();
    return sendJson(res, 200, { token: created.accessToken, refreshToken: created.refreshToken, expiresAt: created.record.accessExpiresAt, user: publicUser(user) });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const auth = requireUser(req, res, url); if (!auth) return;
    db.sessions = db.sessions.filter((item) => item !== auth.session);
    auth.user.lastSeen = Date.now();
    await persist();
    disconnectRealtimeSessions([auth.session.id]);
    return sendJson(res, 200, { ok: true });
  }

  const auth = requireUser(req, res, url);
  if (!auth) return;
  const { user } = auth;
  if (user.bannedAt) return fail(res, 403, `Аккаунт заблокирован: ${user.banReason || "обратитесь к администратору"}`);
  const systemSettings = normalizeSystemSettings(db);
  if (systemSettings.maintenanceMode && !isSystemAdmin(user) && !["/api/auth/me", "/api/auth/logout"].includes(path)) {
    return fail(res, 503, systemSettings.maintenanceMessage || "Проводятся технические работы");
  }

  const adminHandled = await adminApi(req, res, url, auth);
  if (adminHandled !== false) return;

  if (path === "/api/news" && method === "GET") {
    const before = Number(url.searchParams.get("before") || Number.MAX_SAFE_INTEGER);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 30)));
    const channelIds = new Set(db.chats.filter((chat) => chat.type === "channel" && isMember(chat, user.id)).map((chat) => chat.id));
    const all = db.messages
      .filter((message) => channelIds.has(message.chatId) && Number(message.timestamp || 0) < before && !(message.hiddenFor || []).includes(user.id))
      .map(publicMessage)
      .filter((message) => message.type !== "system")
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    const posts = all.slice(0, limit).map((message) => {
      const channel = db.chats.find((chat) => chat.id === message.chatId);
      return {
        ...message,
        channel: { id: channel.id, title: channel.title, username: channel.username || "", avatar: channel.avatar || null, avatarColor: channel.avatarColor, subscribers: channel.participants?.length || 0 },
        views: Object.keys(message.viewedBy || {}).length,
      };
    });
    return sendJson(res, 200, { posts, hasMore: all.length > posts.length, nextBefore: posts.at(-1)?.timestamp || null });
  }

  const platformHandled = await platformApi(req, res, url, auth);
  if (platformHandled !== false) return;

  if (path.startsWith("/api/objects/") && (method === "GET" || method === "HEAD")) {
    if (!(await sendObjectMedia(req, res, user, path))) return fail(res, 404, "Файл не найден");
    return;
  }

  if (path.startsWith("/api/media/") && (method === "GET" || method === "HEAD")) {
    if (!sendDecryptedMedia(req, res, user, path)) return fail(res, 404, "Файл не найден");
    return;
  }

  if (path === "/api/security/encryption" && method === "GET") {
    return sendJson(res, 200, { messageEncryption: messageCrypto.status() });
  }

  if (path === "/api/auth/me" && method === "GET") return sendJson(res, 200, { user: publicUser(user) });

  if (path === "/api/auth/sessions" && method === "GET") {
    const sessions = db.sessions.filter((item) => item.userId === user.id).map((item) => ({
      id: item.id || item.token?.slice(0, 12), createdAt: item.createdAt, lastUsedAt: item.lastUsedAt, userAgent: item.userAgent || "Неизвестное устройство",
      ip: item.ip || "", current: item === auth.session, expiresAt: item.refreshExpiresAt,
    }));
    return sendJson(res, 200, { sessions });
  }

  if (path === "/api/auth/sessions/others" && method === "DELETE") {
    const removedSessionIds = db.sessions.filter((item) => item.userId === user.id && item !== auth.session).map((item) => item.id);
    db.sessions = db.sessions.filter((item) => item.userId !== user.id || item === auth.session);
    await persist();
    disconnectRealtimeSessions(removedSessionIds);
    return sendJson(res, 200, { ok: true });
  }

  if (path === "/api/users" && method === "GET") {
    return sendJson(res, 200, { users: db.users.map(directoryUser) });
  }

  if (path === "/api/users/me" && method === "PATCH") {
    const body = await parseBody(req);
    const allowed = ["username", "age", "gender", "relationshipStatus", "city", "bio", "settings", "statusText", "statusEmoji", "statusExpiresAt"];
    for (const key of allowed) if (body[key] !== undefined) user[key] = body[key];
    user.statusText = String(user.statusText || "").trim().slice(0, 120);
    user.statusEmoji = String(user.statusEmoji || "").trim().slice(0, 12);
    user.statusExpiresAt = Math.max(0, Number(user.statusExpiresAt || 0));
    if (body.publicUsername !== undefined) {
      const publicUsername = String(body.publicUsername || "").trim().replace(/^@/, "").toLowerCase();
      if (publicUsername && !/^[a-z0-9_]{5,32}$/.test(publicUsername)) return fail(res, 400, "Юзернейм: 5–32 символа a-z, 0-9 или _");
      if (publicUsername && db.users.some((item) => item.id !== user.id && item.publicUsername === publicUsername)) return fail(res, 409, "Юзернейм уже занят");
      user.publicUsername = publicUsername;
    }
    if (body.avatar) {
      const storedAvatar = saveDataFile(body.avatar, body.avatarName || "avatar", body.avatarMimeType || "image/png");
      user.avatar = storedAvatar.content;
      user.avatarMimeType = storedAvatar.mimeType;
      user.avatarKind = storedAvatar.mimeType?.startsWith("video/") ? "video" : "image";
    }
    if (body.password) {
      if (String(body.password).length < 8) return fail(res, 400, "Пароль должен быть не короче 8 символов");
      const credentials = hashPassword(body.password);
      user.passwordHash = credentials.hash; user.passwordSalt = credentials.salt;
      user.mustChangePassword = false;
    }
    user.lastSeen = Date.now();
    await persist();
    broadcastAll({ type: "users.updated", at: Date.now() });
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (path === "/api/chats" && method === "GET") {
    const chats = db.chats.filter((chat) => isMember(chat, user.id)).map((chat) => chatForUser(chat, user.id));
    return sendJson(res, 200, { chats });
  }

  if (path === "/api/chats/private" && method === "POST") {
    const body = await parseBody(req);
    const targetId = String(body.userId || "");
    const target = db.users.find((item) => item.id === targetId);
    if (!target || target.id === user.id) return fail(res, 400, "Пользователь не найден");
    let chat = db.chats.find((item) => item.type === "private" && item.participants.includes(user.id) && item.participants.includes(target.id));
    if (!chat) {
      chat = { id: randomUUID(), type: "private", participants: [user.id, target.id], title: target.username, avatarColor: target.avatarColor, updatedAt: Date.now(), mutedBy: [], pinnedMessageId: null, pendingRequests: [], admins: [], roles: {}, readState: {}, archivedBy: [], autoDeleteSeconds: 0, sequence: ++db.meta.sequence };
      db.chats.push(chat);
      await persist();
      syncChat(chat, "chat.created");
    }
    return sendJson(res, 200, { chat: chatForUser(chat, user.id) });
  }

  if (path === "/api/chats" && method === "POST") {
    const body = await parseBody(req);
    if (!["group", "channel"].includes(body.type)) return fail(res, 400, "Некорректный тип чата");
    const title = String(body.title || "").trim();
    if (!title) return fail(res, 400, "Введите название");
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds.filter((id) => db.users.some((item) => item.id === id && !item.isAi && !item.isBot)) : [];
    const now = Date.now();
    const chat = {
      id: randomUUID(), type: body.type, title, description: String(body.description || ""),
      participants: [...new Set([user.id, ...memberIds])], ownerId: user.id, admins: [user.id],
      avatarColor: body.type === "channel" ? "#5d4bdb" : "#d64f87", avatar: null, updatedAt: now,
      mutedBy: [], pinnedMessageId: null, inviteCode: makeInviteCode(), requiresApproval: Boolean(body.requiresApproval), pendingRequests: [],
      username: String(body.username || "").replace(/^@/, "").toLowerCase(), roles: { [user.id]: "owner" }, rolePermissions: {},
      readState: {}, archivedBy: [], autoDeleteSeconds: 0, slowModeSeconds: 0, restrictions: {}, bans: {}, signatures: Boolean(body.signatures),
      sequence: ++db.meta.sequence,
    };
    db.chats.push(chat);
    createSystemMessage(chat.id, user.id, body.type === "channel" ? "Канал создан" : "Группа создана");
    await persist();
    syncChat(chat, "chat.created");
    return sendJson(res, 201, { chat: chatForUser(chat, user.id) });
  }

  if (path === "/api/chats/join" && method === "POST") {
    const body = await parseBody(req);
    const raw = String(body.invite || "").trim();
    const code = raw.includes("invite=") ? raw.split("invite=").pop().split("&")[0] : raw.split("/").filter(Boolean).pop();
    const advancedInvite = db.invites?.find((item) => item.code === code && !item.revokedAt && (!item.expiresAt || item.expiresAt > Date.now()) && (!item.memberLimit || item.joinedUserIds.length < item.memberLimit));
    const chat = db.chats.find((item) => (item.inviteCode === code || item.id === advancedInvite?.chatId || item.username === raw.replace(/^@/, "").toLowerCase()) && item.type !== "private");
    if (!chat) return fail(res, 404, "Инвайт не найден");
    if (isMember(chat, user.id)) return sendJson(res, 200, { status: "joined", chat: chatForUser(chat, user.id) });
    if (chat.pendingRequests?.some((request) => request.userId === user.id)) return sendJson(res, 200, { status: "pending" });
    const approvalRequired = advancedInvite ? advancedInvite.requiresApproval : chat.requiresApproval;
    if (approvalRequired) {
      chat.pendingRequests.push({ userId: user.id, requestedAt: Date.now() });
      await persist();
      broadcastUsers([chat.ownerId, ...(chat.admins || [])], { type: "sync", reason: "join.requested", chatId: chat.id, at: Date.now() });
      return sendJson(res, 202, { status: "pending" });
    }
    chat.participants.push(user.id); chat.updatedAt = Date.now();
    if (advancedInvite) advancedInvite.joinedUserIds = [...new Set([...(advancedInvite.joinedUserIds || []), user.id])];
    createSystemMessage(chat.id, user.id, `${user.username} присоединился(ась)`);
    await persist();
    syncChat(chat, "member.joined");
    return sendJson(res, 200, { status: "joined", chat: chatForUser(chat, user.id) });
  }

  const chatMessagesMatch = path.match(/^\/api\/chats\/([^/]+)\/messages$/);
  if (chatMessagesMatch && method === "GET") {
    const chat = db.chats.find((item) => item.id === chatMessagesMatch[1]);
    if (!chat || !isMember(chat, user.id)) return fail(res, 404, "Чат не найден");
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    let messages = db.messages
      .filter((msg) => msg.chatId === chat.id && !(msg.hiddenFor || []).includes(user.id))
      .map(publicMessage);
    if (q) messages = messages.filter((msg) => `${msg.text || ""} ${msg.name || ""}`.toLowerCase().includes(q));
    messages.sort((a, b) => a.timestamp - b.timestamp);
    const before = Number(url.searchParams.get("before") || Number.MAX_SAFE_INTEGER);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));
    const filtered = messages.filter((message) => message.timestamp < before);
    const page = filtered.slice(-limit);
    return sendJson(res, 200, { messages: page, hasMore: filtered.length > page.length, nextBefore: page[0]?.timestamp || null, readState: chat.readState || {} });
  }

  if (chatMessagesMatch && method === "POST") {
    const chat = db.chats.find((item) => item.id === chatMessagesMatch[1]);
    if (!chat || !canPost(chat, user.id)) return fail(res, 403, "Отправка сообщений недоступна");
    const body = await parseBody(req);
    if (!["text", "voice", "video", "file", "image", "audio", "location", "contact", "sticker", "gif", "album", "e2e"].includes(body.type)) return fail(res, 400, "Некорректный тип сообщения");
    if (body.clientMessageId) {
      const duplicate = db.messages.find((item) => item.chatId === chat.id && item.senderId === user.id && item.clientMessageId === body.clientMessageId);
      if (duplicate) return sendJson(res, 200, { message: publicMessage(duplicate), duplicate: true });
    }
    const restriction = chat.restrictions?.[user.id];
    if (restriction && (!restriction.until || restriction.until > Date.now()) && !(restriction.permissions || []).includes("post")) return fail(res, 403, "Отправка ограничена модератором");
    if (chat.slowModeSeconds && !isAdmin(chat, user.id)) {
      const last = db.messages.filter((m) => m.chatId === chat.id && m.senderId === user.id).sort((a,b) => b.timestamp-a.timestamp)[0];
      if (last && Date.now() - last.timestamp < chat.slowModeSeconds * 1000) return fail(res, 429, "Включён медленный режим");
    }
    const now = Date.now();
    const sendRate = await redis.incr(`send:${user.id}:${chat.id}:${Math.floor(now / 60000)}`, 62);
    if (sendRate > Number(process.env.MESSAGE_RATE_LIMIT_PER_MINUTE || 90)) return fail(res, 429, "Слишком много сообщений");
    if (chat.isAiChat && body.type === "text") {
      const aiRate = await redis.incr(`ai-send:${user.id}:${Math.floor(now / 60000)}`, 62);
      if (aiRate > Number(process.env.AI_MESSAGES_PER_MINUTE || 12)) return fail(res, 429, "Слишком много запросов к ИИ. Подождите немного");
    }
    let content = body.content;
    let mimeType = body.mimeType;
    let size = Number(body.size || 0);
    let fileEncryption = body.fileEncryption;
    if (body.type !== "text" && String(content || "").startsWith("data:")) {
      const storedFile = saveEncryptedMessageFile(
        content,
        body.name || `${body.type}.webm`,
        mimeType || (body.type === "voice" ? "audio/webm" : "video/webm"),
      );
      content = storedFile.content;
      mimeType = storedFile.mimeType;
      size = storedFile.size;
      fileEncryption = storedFile.fileEncryption;
    }
    const openedMessage = {
      id: randomUUID(), chatId: chat.id, senderId: user.id, type: body.type,
      text: body.type === "text" ? String(body.content || "").trim() : undefined,
      content: body.type !== "text" ? content : undefined,
      name: body.name, mimeType, size, duration: Number(body.duration || 0), fileEncryption,
      caption: body.caption, replyToId: body.replyToId || null, mentions: body.mentions || [], formatting: body.formatting || [],
      linkPreview: body.linkPreview || null, location: body.location || null, contact: body.contact || null, albumId: body.albumId || null,
      sticker: body.sticker || null, gif: body.gif || null, topicId: body.topicId || null,
      clientCiphertext: body.clientCiphertext, clientIv: body.clientIv, ephemeralPublicKey: body.ephemeralPublicKey, recipientEnvelopes: body.recipientEnvelopes, senderDeviceId: body.senderDeviceId,
      timestamp: now, edited: false, likes: [], reactions: {}, hiddenFor: [], deliveredTo: {}, viewedBy: {},
      clientMessageId: body.clientMessageId || randomUUID(), expiresAt: body.expiresAt || (chat.autoDeleteSeconds ? now + chat.autoDeleteSeconds * 1000 : 0),
      sequence: ++db.meta.sequence, signature: chat.signatures ? user.username : undefined,
    };
    if (openedMessage.type === "text" && !openedMessage.text) return fail(res, 400, "Пустое сообщение");
    const storedMessage = sealMessage(openedMessage);
    db.messages.push(storedMessage);
    chat.updatedAt = now;
    dispatchBotUpdates(chat, openedMessage);
    await persist();
    const responseMessage = publicMessage(storedMessage);
    broadcastChat(chat, { type: "message.created", chatId: chat.id, message: responseMessage, at: Date.now() });
    queueAiReply(chat, openedMessage);
    return sendJson(res, 201, { message: responseMessage, aiReplyQueued: Boolean(chat.isAiChat && openedMessage.type === "text") });
  }

  const chatPatchMatch = path.match(/^\/api\/chats\/([^/]+)$/);
  if (chatPatchMatch && method === "PATCH") {
    const chat = db.chats.find((item) => item.id === chatPatchMatch[1]);
    if (!chat || !isMember(chat, user.id)) return fail(res, 404, "Чат не найден");
    if (!isAdmin(chat, user.id)) return fail(res, 403, "Недостаточно прав");
    const body = await parseBody(req);
    for (const key of ["title", "description", "requiresApproval", "username", "slowModeSeconds", "signatures", "rolePermissions"]) if (body[key] !== undefined) chat[key] = body[key];
    chat.sequence = ++db.meta.sequence;
    chat.updatedAt = Date.now();
    await persist(); syncChat(chat, "chat.updated");
    return sendJson(res, 200, { chat: chatForUser(chat, user.id) });
  }

  const muteMatch = path.match(/^\/api\/chats\/([^/]+)\/mute$/);
  if (muteMatch && method === "POST") {
    const chat = db.chats.find((item) => item.id === muteMatch[1]);
    if (!chat || !isMember(chat, user.id)) return fail(res, 404, "Чат не найден");
    chat.mutedBy ||= [];
    chat.mutedBy = chat.mutedBy.includes(user.id) ? chat.mutedBy.filter((id) => id !== user.id) : [...chat.mutedBy, user.id];
    await persist();
    return sendJson(res, 200, { muted: chat.mutedBy.includes(user.id), chat: chatForUser(chat, user.id) });
  }

  const pinMatch = path.match(/^\/api\/chats\/([^/]+)\/pin$/);
  if (pinMatch && method === "POST") {
    const chat = db.chats.find((item) => item.id === pinMatch[1]);
    if (!chat || !isMember(chat, user.id)) return fail(res, 404, "Чат не найден");
    const body = await parseBody(req);
    const message = db.messages.find((item) => item.id === body.messageId && item.chatId === chat.id);
    if (!message) return fail(res, 404, "Сообщение не найдено");
    chat.pinnedMessageId = chat.pinnedMessageId === message.id ? null : message.id;
    chat.updatedAt = Date.now();
    await persist(); syncChat(chat, "message.pinned");
    return sendJson(res, 200, { chat: chatForUser(chat, user.id) });
  }

  const leaveMatch = path.match(/^\/api\/chats\/([^/]+)\/leave$/);
  if (leaveMatch && method === "POST") {
    const chat = db.chats.find((item) => item.id === leaveMatch[1]);
    if (!chat || !isMember(chat, user.id) || chat.type === "private") return fail(res, 400, "Нельзя выйти из этого чата");
    if (chat.ownerId === user.id) return fail(res, 400, "Владелец должен сначала передать права");
    chat.participants = chat.participants.filter((id) => id !== user.id);
    chat.admins = (chat.admins || []).filter((id) => id !== user.id);
    createSystemMessage(chat.id, user.id, `${user.username} вышел(ла)`);
    await persist(); syncChat(chat, "member.left");
    return sendJson(res, 200, { ok: true });
  }

  const requestMatch = path.match(/^\/api\/chats\/([^/]+)\/requests\/([^/]+)\/(approve|reject)$/);
  if (requestMatch && method === "POST") {
    const [, chatId, targetUserId, action] = requestMatch;
    const chat = db.chats.find((item) => item.id === chatId);
    if (!chat || !isAdmin(chat, user.id)) return fail(res, 403, "Недостаточно прав");
    const request = chat.pendingRequests?.find((item) => item.userId === targetUserId);
    if (!request) return fail(res, 404, "Заявка не найдена");
    chat.pendingRequests = chat.pendingRequests.filter((item) => item.userId !== targetUserId);
    if (action === "approve") {
      chat.participants = [...new Set([...chat.participants, targetUserId])];
      const target = db.users.find((item) => item.id === targetUserId);
      createSystemMessage(chat.id, user.id, `${target?.username || "Пользователь"} принят(а)`);
    }
    chat.updatedAt = Date.now();
    await persist();
    broadcastUsers([...chat.participants, targetUserId], { type: "sync", reason: `request.${action}`, chatId, at: Date.now() });
    return sendJson(res, 200, { chat: chatForUser(chat, user.id) });
  }

  const messageMatch = path.match(/^\/api\/messages\/([^/]+)$/);
  if (messageMatch && method === "PATCH") {
    const storedMessage = db.messages.find((item) => item.id === messageMatch[1]);
    const chat = db.chats.find((item) => item.id === storedMessage?.chatId);
    if (!storedMessage || !chat || !isMember(chat, user.id)) return fail(res, 404, "Сообщение не найдено");
    const openedMessage = openMessage(storedMessage);
    if (openedMessage.senderId !== user.id || openedMessage.type !== "text") return fail(res, 403, "Редактирование недоступно");
    const body = await parseBody(req);
    const text = String(body.text || "").trim();
    if (!text) return fail(res, 400, "Сообщение не может быть пустым");
    openedMessage.text = text;
    openedMessage.edited = true;
    openedMessage.editedAt = Date.now();
    openedMessage.sequence = ++db.meta.sequence;
    const updatedMessage = replaceStoredMessage(storedMessage.id, openedMessage);
    await persist(); syncChat(chat, "message.edited");
    return sendJson(res, 200, { message: publicMessage(updatedMessage) });
  }

  if (messageMatch && method === "DELETE") {
    const storedMessage = db.messages.find((item) => item.id === messageMatch[1]);
    const chat = db.chats.find((item) => item.id === storedMessage?.chatId);
    if (!storedMessage || !chat || !isMember(chat, user.id)) return fail(res, 404, "Сообщение не найдено");
    const openedMessage = openMessage(storedMessage);
    const scope = url.searchParams.get("scope") || "me";
    if (scope === "everyone") {
      if (storedMessage.senderId !== user.id && !isAdmin(chat, user.id)) return fail(res, 403, "Недостаточно прав");
      deleteUploadedFile(openedMessage.content);
      db.messages = db.messages.filter((item) => item.id !== storedMessage.id);
      if (chat.pinnedMessageId === storedMessage.id) chat.pinnedMessageId = null;
      await persist(); syncChat(chat, "message.deleted");
      return sendJson(res, 200, { ok: true });
    }
    storedMessage.hiddenFor ||= [];
    storedMessage.hiddenFor = [...new Set([...storedMessage.hiddenFor, user.id])];
    await persist();
    return sendJson(res, 200, { ok: true });
  }

  const likeMatch = path.match(/^\/api\/messages\/([^/]+)\/like$/);
  if (likeMatch && method === "POST") {
    const storedMessage = db.messages.find((item) => item.id === likeMatch[1]);
    const chat = db.chats.find((item) => item.id === storedMessage?.chatId);
    if (!storedMessage || !chat || !isMember(chat, user.id)) return fail(res, 404, "Сообщение не найдено");
    storedMessage.likes ||= [];
    storedMessage.likes = storedMessage.likes.includes(user.id)
      ? storedMessage.likes.filter((id) => id !== user.id)
      : [...storedMessage.likes, user.id];
    storedMessage.sequence = ++db.meta.sequence;
    await persist(); syncChat(chat, "message.liked");
    return sendJson(res, 200, { message: publicMessage(storedMessage) });
  }

  const forwardMatch = path.match(/^\/api\/messages\/([^/]+)\/forward$/);
  if (forwardMatch && method === "POST") {
    const sourceStored = db.messages.find((item) => item.id === forwardMatch[1]);
    const sourceChat = db.chats.find((item) => item.id === sourceStored?.chatId);
    if (!sourceStored || !sourceChat || !isMember(sourceChat, user.id)) return fail(res, 404, "Сообщение не найдено");
    const body = await parseBody(req);
    const target = db.chats.find((item) => item.id === body.targetChatId);
    if (!target || !canPost(target, user.id)) return fail(res, 403, "Пересылка в этот чат недоступна");

    const source = openMessage(sourceStored);
    const author = db.users.find((item) => item.id === source.senderId);
    const forwarded = {
      ...source, id: randomUUID(), chatId: target.id, senderId: user.id, timestamp: Date.now(), edited: false,
      likes: [], reactions: {}, hiddenFor: [], forwardedFrom: source.forwardedFrom || author?.username || "Пользователь",
      sequence: ++db.meta.sequence, clientMessageId: randomUUID(),
    };
    delete forwarded.encryptedPayload;

    if (source.fileEncryption && encryptedMediaName(source.content)) {
      const clonedFile = cloneEncryptedMessageFile(source);
      if (!clonedFile) return fail(res, 500, "Не удалось скопировать зашифрованное вложение");
      forwarded.content = clonedFile.content;
      forwarded.mimeType = clonedFile.mimeType;
      forwarded.size = clonedFile.size;
      forwarded.fileEncryption = clonedFile.fileEncryption;
    }

    const forwardedStored = sealMessage(forwarded);
    db.messages.push(forwardedStored);
    target.updatedAt = forwarded.timestamp;
    dispatchBotUpdates(target, forwarded);
    await persist();
    const responseMessage = publicMessage(forwardedStored);
    broadcastChat(target, { type: "message.created", reason: "message.forwarded", chatId: target.id, message: responseMessage, at: Date.now() });
    queueAiReply(target, forwarded);
    return sendJson(res, 201, { message: responseMessage, aiReplyQueued: Boolean(target.isAiChat && forwarded.type === "text") });
  }

  return fail(res, 404, "Маршрут не найден");
}

async function allowRequest(req, res, url) {
  if (url.pathname === "/api/health" || url.pathname === "/metrics" || url.pathname.startsWith("/internal/")) return true;
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const windowSeconds = 60;
  const limit = url.pathname.startsWith("/api/auth/") ? 60 : url.pathname.includes("/messages") ? 180 : 600;
  const count = await redis.incr(`rate:${ip}:${Math.floor(Date.now() / 60000)}:${url.pathname.split("/").slice(0,4).join("/")}`, windowSeconds + 2);
  res.setHeader("X-RateLimit-Limit", String(limit)); res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - count)));
  if (count > limit) { fail(res, 429, "Слишком много запросов"); return false; }
  return true;
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  res.setHeader("X-Request-Id", req.headers["x-request-id"] || randomUUID());
  try {
    if (!(await allowRequest(req, res, url))) return;
    if (url.pathname.startsWith("/internal/")) return await internalHandler(req, res, url);
    if (url.pathname.startsWith("/api/")) return await apiHandler(req, res, url);
    if (serveFile(req, res, url.pathname)) return;
    fail(res, 404, "Файл не найден");
  } catch (error) {
    if (!res.headersSent) fail(res, error.status || 500, error.message || "Внутренняя ошибка сервера");
    else res.end();
    console.error(error);
  }
});

warnForDefaultInternalSecret("Core API");
server.listen(PORT, HOST, () => {
  console.log(`Core API запущен: http://${HOST}:${PORT}`);
  console.log(`Realtime service: ${REALTIME_INTERNAL_URL}`);
  console.log(`База: ${DB_FILE}`);
});

let shuttingDown = false;
async function gracefulInfrastructureShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  messageCrypto.close();
  try { await persist(); } catch {}
  await Promise.allSettled([stateStore.close(), redis.close()]);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref?.();
}
process.once("SIGTERM", gracefulInfrastructureShutdown);
process.once("SIGINT", gracefulInfrastructureShutdown);
