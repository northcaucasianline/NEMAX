import { randomBytes, randomUUID } from "node:crypto";

const now = () => Date.now();
const text = (value, max = 10_000) => String(value ?? "").trim().slice(0, max);
const unique = (items) => [...new Set((items || []).filter(Boolean))];

function route(path, pattern) {
  return path.match(pattern);
}

function isSystemAdmin(user) {
  return user?.role === "admin" || user?.isSystemAdmin === true;
}

function safeUser(user) {
  if (!user) return null;
  const {
    passwordHash, passwordSalt, totpSecret, pendingTotpSecret, recoveryCodes,
    ...safe
  } = user;
  return safe;
}

function recordAudit(db, actorId, action, targetType, targetId, details = {}) {
  db.auditLogs ||= [];
  db.auditLogs.push({ id: randomUUID(), actorId, action, targetType, targetId, details, createdAt: now() });
  if (db.auditLogs.length > 50_000) db.auditLogs.splice(0, db.auditLogs.length - 50_000);
}

function normalizeSystemSettings(db) {
  db.systemSettings ||= {
    siteName: "НЕМАКС",
    announcement: "",
    registrationEnabled: true,
    maintenanceMode: false,
    maintenanceMessage: "Проводятся технические работы",
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024),
    updatedAt: now(),
  };
  return db.systemSettings;
}

function cleanUsername(value) {
  return text(value, 32).replace(/^@/, "").toLowerCase();
}

export function createAdminApi(context) {
  const {
    getDb, persist, sendJson, fail, parseBody, publicMessage, publicUser,
    hashPassword, broadcastAll, disconnectRealtimeSessions, getInfrastructureHealth, allocateUserId, defaultUserSettings, ensureSystemChatsForUser,
  } = context;

  return async function adminApi(req, res, url, auth) {
    const path = url.pathname;
    const method = req.method || "GET";
    if (!path.startsWith("/api/admin/")) return false;
    if (!auth?.user || !isSystemAdmin(auth.user)) {
      fail(res, 403, "Доступ разрешён только системному администратору");
      return true;
    }

    const db = getDb();
    const actor = auth.user;
    const settings = normalizeSystemSettings(db);

    if (path === "/api/admin/overview" && method === "GET") {
      const activeSessions = db.sessions.filter((session) => !session.revokedAt && (!session.refreshExpiresAt || session.refreshExpiresAt > now())).length;
      const onlineUsers = db.users.filter((user) => user.status === "online").length;
      const channelCount = db.chats.filter((chat) => chat.type === "channel").length;
      const groupCount = db.chats.filter((chat) => chat.type === "group").length;
      const privateCount = db.chats.filter((chat) => chat.type === "private").length;
      const reportsOpen = (db.reports || []).filter((report) => !["resolved", "rejected"].includes(report.status)).length;
      const latestAudit = (db.auditLogs || []).slice(-25).reverse();
      const infrastructure = await getInfrastructureHealth();
      sendJson(res, 200, {
        stats: {
          users: db.users.length,
          admins: db.users.filter(isSystemAdmin).length,
          bannedUsers: db.users.filter((user) => user.bannedAt).length,
          onlineUsers,
          activeSessions,
          chats: db.chats.length,
          channels: channelCount,
          groups: groupCount,
          privateChats: privateCount,
          messages: db.messages.length,
          boards: (db.boards || []).length,
          boardPosts: (db.boardPosts || []).filter((item) => item.status !== "deleted").length,
          reportsOpen,
          scheduledMessages: (db.scheduledMessages || []).filter((item) => item.status === "scheduled").length,
          mediaObjects: (db.uploadSessions || []).filter((item) => item.status === "completed").length,
        },
        infrastructure,
        settings,
        latestAudit,
      });
      return true;
    }

    if (path === "/api/admin/users" && method === "POST") {
      const body = await parseBody(req);
      const login = text(body.login, 32).toLowerCase();
      const username = text(body.username, 80);
      const publicUsername = cleanUsername(body.publicUsername);
      const password = String(body.password || "");
      const role = body.role === "admin" ? "admin" : "user";
      if (!/^[a-z0-9_]{3,32}$/.test(login)) return fail(res, 400, "Логин: 3–32 символа a-z, 0-9 или _"), true;
      if (!username) return fail(res, 400, "Введите отображаемое имя"), true;
      if (password.length < 8) return fail(res, 400, "Пароль должен быть не короче 8 символов"), true;
      if (publicUsername && !/^[a-z0-9_]{5,32}$/.test(publicUsername)) return fail(res, 400, "Юзернейм: 5–32 символа a-z, 0-9 или _"), true;
      if (db.users.some((user) => user.login === login)) return fail(res, 409, "Логин уже занят"), true;
      if (publicUsername && db.users.some((user) => user.publicUsername === publicUsername)) return fail(res, 409, "Юзернейм уже занят"), true;
      const credentials = hashPassword(password);
      const created = {
        id: randomUUID(), userId: allocateUserId(), login, username, publicUsername: publicUsername || "",
        passwordHash: credentials.hash, passwordSalt: credentials.salt, role, isSystemAdmin: role === "admin",
        age: Number(body.age || 18), gender: "", relationshipStatus: "single", city: "", bio: "", avatar: null,
        avatarColor: `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`, status: "offline", lastSeen: now(),
        settings: { ...defaultUserSettings }, blockedUsers: [], createdAt: now(), twoFactorEnabled: false, mustChangePassword: body.mustChangePassword !== false,
      };
      db.users.push(created);
      ensureSystemChatsForUser?.(created);
      recordAudit(db, actor.id, "admin.user.created", "user", created.id, { login, userId: created.userId, role });
      await persist();
      broadcastAll({ type: "users.updated", at: now() });
      sendJson(res, 201, { user: safeUser(created) });
      return true;
    }

    if (path === "/api/admin/users" && method === "GET") {
      const query = text(url.searchParams.get("q"), 100).toLowerCase();
      const role = text(url.searchParams.get("role"), 30);
      const status = text(url.searchParams.get("status"), 30);
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));
      const users = db.users
        .filter((user) => !query || `${user.userId} ${user.id} ${user.login} ${user.username} ${user.publicUsername || ""}`.toLowerCase().includes(query))
        .filter((user) => !role || (isSystemAdmin(user) ? "admin" : (user.role || "user")) === role)
        .filter((user) => !status || (status === "banned" ? Boolean(user.bannedAt) : user.status === status))
        .sort((a, b) => Number(a.userId || 0) - Number(b.userId || 0))
        .slice(0, limit)
        .map((user) => ({
          ...safeUser(user),
          sessionCount: db.sessions.filter((session) => session.userId === user.id && !session.revokedAt).length,
          chatCount: db.chats.filter((chat) => chat.participants?.includes(user.id)).length,
          messageCount: db.messages.filter((message) => message.senderId === user.id).length,
        }));
      sendJson(res, 200, { users });
      return true;
    }

    const userMatch = route(path, /^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch && method === "PATCH") {
      const target = db.users.find((user) => user.id === userMatch[1]);
      if (!target) return fail(res, 404, "Пользователь не найден"), true;
      if (target.isAi) return fail(res, 400, "AI-профили управляются файлом server/ai-personas.js"), true;
      const body = await parseBody(req);
      if (body.login !== undefined) {
        const login = text(body.login, 32).toLowerCase();
        if (!/^[a-z0-9_]{3,32}$/.test(login)) return fail(res, 400, "Некорректный логин"), true;
        if (db.users.some((user) => user.id !== target.id && user.login === login)) return fail(res, 409, "Логин уже занят"), true;
        target.login = login;
      }
      if (body.username !== undefined) target.username = text(body.username, 80) || "Пользователь";
      if (body.publicUsername !== undefined) {
        const publicUsername = cleanUsername(body.publicUsername);
        if (publicUsername && !/^[a-z0-9_]{5,32}$/.test(publicUsername)) return fail(res, 400, "Юзернейм: 5–32 символа a-z, 0-9 или _"), true;
        if (publicUsername && db.users.some((user) => user.id !== target.id && user.publicUsername === publicUsername)) return fail(res, 409, "Юзернейм уже занят"), true;
        target.publicUsername = publicUsername || "";
      }
      if (body.role !== undefined) {
        const role = body.role === "admin" ? "admin" : "user";
        if (target.id === actor.id && role !== "admin") return fail(res, 400, "Нельзя снять роль администратора с текущего аккаунта"), true;
        target.role = role;
        target.isSystemAdmin = role === "admin";
      }
      if (body.banned !== undefined) {
        if (target.id === actor.id && body.banned) return fail(res, 400, "Нельзя заблокировать текущий аккаунт"), true;
        if (body.banned) {
          target.bannedAt = now();
          target.banReason = text(body.banReason, 500) || "Заблокирован администратором";
          const sessionIds = db.sessions.filter((session) => session.userId === target.id).map((session) => session.id);
          db.sessions = db.sessions.filter((session) => session.userId !== target.id);
          disconnectRealtimeSessions(sessionIds);
        } else {
          target.bannedAt = null;
          target.banReason = "";
        }
      }
      if (body.mustChangePassword !== undefined) target.mustChangePassword = Boolean(body.mustChangePassword);
      target.updatedAt = now();
      recordAudit(db, actor.id, "admin.user.updated", "user", target.id, { fields: Object.keys(body) });
      await persist();
      broadcastAll({ type: "users.updated", at: now() });
      sendJson(res, 200, { user: safeUser(target) });
      return true;
    }

    if (userMatch && method === "DELETE") {
      const target = db.users.find((user) => user.id === userMatch[1]);
      if (!target) return fail(res, 404, "Пользователь не найден"), true;
      if (target.isAi) return fail(res, 400, "Системный AI-аккаунт нельзя удалить"), true;
      if (target.id === actor.id) return fail(res, 400, "Нельзя удалить текущий аккаунт администратора"), true;
      if (isSystemAdmin(target) && db.users.filter(isSystemAdmin).length <= 1) return fail(res, 400, "Нельзя удалить последнего администратора"), true;
      const sessionIds = db.sessions.filter((session) => session.userId === target.id).map((session) => session.id);
      db.sessions = db.sessions.filter((session) => session.userId !== target.id);
      db.users = db.users.filter((user) => user.id !== target.id);
      const removedChatIds = new Set();
      db.messages = db.messages.filter((message) => message.senderId !== target.id);
      db.chats = db.chats.filter((chat) => {
        chat.participants = (chat.participants || []).filter((id) => id !== target.id);
        chat.admins = (chat.admins || []).filter((id) => id !== target.id);
        if (chat.roles) delete chat.roles[target.id];
        if (chat.ownerId === target.id) {
          const replacement = chat.admins[0] || chat.participants[0];
          if (replacement) {
            chat.ownerId = replacement;
            chat.roles ||= {};
            chat.roles[replacement] = "owner";
            chat.admins = unique([replacement, ...chat.admins]);
          }
        }
        const keep = chat.type === "private" ? chat.participants.length === 2 : chat.participants.length > 0;
        if (!keep) removedChatIds.add(chat.id);
        return keep;
      });
      if (removedChatIds.size) db.messages = db.messages.filter((message) => !removedChatIds.has(message.chatId));
      recordAudit(db, actor.id, "admin.user.deleted", "user", target.id, { login: target.login, userId: target.userId });
      await persist();
      disconnectRealtimeSessions(sessionIds);
      broadcastAll({ type: "sync", reason: "admin.user.deleted", at: now() });
      sendJson(res, 200, { ok: true });
      return true;
    }

    const passwordMatch = route(path, /^\/api\/admin\/users\/([^/]+)\/password$/);
    if (passwordMatch && method === "POST") {
      const target = db.users.find((user) => user.id === passwordMatch[1]);
      if (!target) return fail(res, 404, "Пользователь не найден"), true;
      const body = await parseBody(req);
      const password = String(body.password || "");
      if (password.length < 8) return fail(res, 400, "Пароль должен быть не короче 8 символов"), true;
      const credentials = hashPassword(password);
      target.passwordHash = credentials.hash;
      target.passwordSalt = credentials.salt;
      target.mustChangePassword = body.mustChangePassword !== false;
      const sessionIds = db.sessions.filter((session) => session.userId === target.id).map((session) => session.id);
      db.sessions = db.sessions.filter((session) => session.userId !== target.id);
      recordAudit(db, actor.id, "admin.user.password-reset", "user", target.id);
      await persist();
      disconnectRealtimeSessions(sessionIds);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const sessionsMatch = route(path, /^\/api\/admin\/users\/([^/]+)\/sessions$/);
    if (sessionsMatch && method === "DELETE") {
      const target = db.users.find((user) => user.id === sessionsMatch[1]);
      if (!target) return fail(res, 404, "Пользователь не найден"), true;
      const sessionIds = db.sessions.filter((session) => session.userId === target.id).map((session) => session.id);
      db.sessions = db.sessions.filter((session) => session.userId !== target.id);
      recordAudit(db, actor.id, "admin.user.sessions-revoked", "user", target.id, { count: sessionIds.length });
      await persist();
      disconnectRealtimeSessions(sessionIds);
      sendJson(res, 200, { ok: true, revoked: sessionIds.length });
      return true;
    }

    if (path === "/api/admin/boards" && method === "GET") {
      const query = text(url.searchParams.get("q"), 200).toLowerCase();
      const boards = (db.boards || []).filter((board) => !query || `${board.title || ""} ${board.city || ""} ${board.interest || ""}`.toLowerCase().includes(query)).map((board) => ({
        ...board,
        postCount: (db.boardPosts || []).filter((post) => post.boardId === board.id && post.status !== "deleted").length,
        creator: safeUser(db.users.find((item) => item.id === board.createdBy)),
      }));
      const posts = (db.boardPosts || []).filter((post) => post.status !== "deleted" && (!query || `${post.title || ""} ${post.text || ""} ${post.city || ""} ${post.interest || ""}`.toLowerCase().includes(query))).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 300).map((post) => ({
        ...post,
        author: safeUser(db.users.find((item) => item.id === post.authorId)),
        board: db.boards?.find((item) => item.id === post.boardId) || null,
      }));
      sendJson(res, 200, { boards, posts });
      return true;
    }

    const adminBoardMatch = route(path, /^\/api\/admin\/boards\/([^/]+)$/);
    if (adminBoardMatch && method === "DELETE") {
      const board = (db.boards || []).find((item) => item.id === adminBoardMatch[1]);
      if (!board) return fail(res, 404, "Доска не найдена"), true;
      const deletedPosts = (db.boardPosts || []).filter((item) => item.boardId === board.id).length;
      db.boards = db.boards.filter((item) => item.id !== board.id);
      db.boardPosts = (db.boardPosts || []).filter((item) => item.boardId !== board.id);
      recordAudit(db, actor.id, "admin.board.deleted", "board", board.id, { title: board.title, deletedPosts });
      await persist();
      sendJson(res, 200, { ok: true, deletedPosts });
      return true;
    }

    const adminBoardPostMatch = route(path, /^\/api\/admin\/board-posts\/([^/]+)$/);
    if (adminBoardPostMatch && method === "DELETE") {
      const post = (db.boardPosts || []).find((item) => item.id === adminBoardPostMatch[1]);
      if (!post) return fail(res, 404, "Объявление не найдено"), true;
      post.status = "deleted"; post.deletedAt = now();
      recordAudit(db, actor.id, "admin.board-post.deleted", "boardPost", post.id, { boardId: post.boardId, authorId: post.authorId });
      await persist();
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === "/api/admin/chats" && method === "POST") {
      const body = await parseBody(req);
      const type = body.type === "channel" ? "channel" : "group";
      const title = text(body.title, 120);
      const username = cleanUsername(body.username);
      if (!title) return fail(res, 400, "Введите название"), true;
      if (username && !/^[a-z0-9_]{5,32}$/.test(username)) return fail(res, 400, "Username паблика: 5–32 символа a-z, 0-9 или _"), true;
      if (username && db.chats.some((chat) => chat.username === username)) return fail(res, 409, "Username паблика уже занят"), true;
      const requestedMembers = Array.isArray(body.memberIds) ? body.memberIds : [];
      const memberIds = requestedMembers.filter((id) => db.users.some((user) => user.id === id));
      db.meta ||= { sequence: 0 };
      const created = {
        id: randomUUID(), type, title, description: text(body.description, 2000),
        participants: unique([actor.id, ...memberIds]), ownerId: actor.id, admins: [actor.id],
        avatarColor: type === "channel" ? "#5d4bdb" : "#d64f87", avatar: null, updatedAt: now(),
        mutedBy: [], pinnedMessageId: null, inviteCode: randomBytes(9).toString("base64url").slice(0, 12),
        requiresApproval: Boolean(body.requiresApproval), pendingRequests: [], username: username || "",
        roles: { [actor.id]: "owner" }, rolePermissions: {}, readState: {}, archivedBy: [], autoDeleteSeconds: 0,
        slowModeSeconds: 0, restrictions: {}, bans: {}, signatures: Boolean(body.signatures), sequence: ++db.meta.sequence,
      };
      db.chats.push(created);
      recordAudit(db, actor.id, "admin.chat.created", "chat", created.id, { type, title, username });
      await persist();
      broadcastAll({ type: "sync", reason: "admin.chat.created", chatId: created.id, at: now() });
      sendJson(res, 201, { chat: created });
      return true;
    }

    if (path === "/api/admin/chats" && method === "GET") {
      const query = text(url.searchParams.get("q"), 100).toLowerCase();
      const type = text(url.searchParams.get("type"), 20);
      const chats = db.chats
        .filter((chat) => !type || chat.type === type)
        .filter((chat) => !query || `${chat.id} ${chat.title || ""} ${chat.username || ""}`.toLowerCase().includes(query))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .slice(0, 500)
        .map((chat) => ({
          ...chat,
          messageCount: db.messages.filter((message) => message.chatId === chat.id).length,
          owner: safeUser(db.users.find((user) => user.id === chat.ownerId)),
        }));
      sendJson(res, 200, { chats });
      return true;
    }

    const chatMatch = route(path, /^\/api\/admin\/chats\/([^/]+)$/);
    if (chatMatch && method === "PATCH") {
      const chat = db.chats.find((item) => item.id === chatMatch[1]);
      if (!chat) return fail(res, 404, "Чат не найден"), true;
      const body = await parseBody(req);
      for (const field of ["title", "description", "requiresApproval", "slowModeSeconds", "signatures"]) {
        if (body[field] !== undefined) chat[field] = body[field];
      }
      if (body.username !== undefined) chat.username = cleanUsername(body.username);
      if (body.ownerId && chat.participants?.includes(body.ownerId)) {
        chat.ownerId = body.ownerId;
        chat.roles ||= {};
        chat.roles[body.ownerId] = "owner";
        chat.admins = unique([body.ownerId, ...(chat.admins || [])]);
      }
      chat.updatedAt = now();
      recordAudit(db, actor.id, "admin.chat.updated", "chat", chat.id, { fields: Object.keys(body) });
      await persist();
      broadcastAll({ type: "sync", reason: "admin.chat.updated", chatId: chat.id, at: now() });
      sendJson(res, 200, { chat });
      return true;
    }

    if (chatMatch && method === "DELETE") {
      const chat = db.chats.find((item) => item.id === chatMatch[1]);
      if (!chat) return fail(res, 404, "Чат не найден"), true;
      db.chats = db.chats.filter((item) => item.id !== chat.id);
      const deletedMessages = db.messages.filter((message) => message.chatId === chat.id).length;
      db.messages = db.messages.filter((message) => message.chatId !== chat.id);
      db.invites = (db.invites || []).filter((invite) => invite.chatId !== chat.id);
      db.topics = (db.topics || []).filter((topic) => topic.chatId !== chat.id);
      recordAudit(db, actor.id, "admin.chat.deleted", "chat", chat.id, { deletedMessages, title: chat.title });
      await persist();
      broadcastAll({ type: "sync", reason: "admin.chat.deleted", chatId: chat.id, at: now() });
      sendJson(res, 200, { ok: true, deletedMessages });
      return true;
    }

    if (path === "/api/admin/messages" && method === "GET") {
      const query = text(url.searchParams.get("q"), 200).toLowerCase();
      const chatId = text(url.searchParams.get("chatId"), 100);
      const senderId = text(url.searchParams.get("senderId"), 100);
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));
      const messages = db.messages
        .filter((message) => !chatId || message.chatId === chatId)
        .filter((message) => !senderId || message.senderId === senderId)
        .map(publicMessage)
        .filter((message) => !query || `${message.text || ""} ${message.name || ""} ${message.caption || ""}`.toLowerCase().includes(query))
        .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
        .slice(0, limit)
        .map((message) => ({
          ...message,
          sender: safeUser(db.users.find((user) => user.id === message.senderId)),
          chat: db.chats.find((chat) => chat.id === message.chatId) ? {
            id: message.chatId,
            title: db.chats.find((chat) => chat.id === message.chatId)?.title || "Личный чат",
            type: db.chats.find((chat) => chat.id === message.chatId)?.type,
          } : null,
        }));
      sendJson(res, 200, { messages });
      return true;
    }

    const messageMatch = route(path, /^\/api\/admin\/messages\/([^/]+)$/);
    if (messageMatch && method === "DELETE") {
      const message = db.messages.find((item) => item.id === messageMatch[1]);
      if (!message) return fail(res, 404, "Сообщение не найдено"), true;
      db.messages = db.messages.filter((item) => item.id !== message.id);
      const chat = db.chats.find((item) => item.id === message.chatId);
      if (chat?.pinnedMessageId === message.id) chat.pinnedMessageId = null;
      recordAudit(db, actor.id, "admin.message.deleted", "message", message.id, { chatId: message.chatId, senderId: message.senderId });
      await persist();
      broadcastAll({ type: "sync", reason: "admin.message.deleted", chatId: message.chatId, at: now() });
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === "/api/admin/reports" && method === "GET") {
      const reports = (db.reports || []).slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).map((report) => ({
        ...report,
        reporter: safeUser(db.users.find((user) => user.id === report.reporterId)),
        targetUser: safeUser(db.users.find((user) => user.id === report.targetUserId)),
      }));
      sendJson(res, 200, { reports });
      return true;
    }

    const reportMatch = route(path, /^\/api\/admin\/reports\/([^/]+)$/);
    if (reportMatch && method === "PATCH") {
      const report = (db.reports || []).find((item) => item.id === reportMatch[1]);
      if (!report) return fail(res, 404, "Жалоба не найдена"), true;
      const body = await parseBody(req);
      report.status = ["open", "reviewing", "resolved", "rejected"].includes(body.status) ? body.status : report.status;
      report.adminNote = text(body.adminNote, 1000);
      report.reviewedBy = actor.id;
      report.reviewedAt = now();
      recordAudit(db, actor.id, "admin.report.updated", "report", report.id, { status: report.status });
      await persist();
      sendJson(res, 200, { report });
      return true;
    }

    if (path === "/api/admin/system-settings" && method === "GET") {
      sendJson(res, 200, { settings });
      return true;
    }

    if (path === "/api/admin/system-settings" && method === "PUT") {
      const body = await parseBody(req);
      if (body.siteName !== undefined) settings.siteName = text(body.siteName, 80) || "НЕМАКС";
      if (body.announcement !== undefined) settings.announcement = text(body.announcement, 500);
      if (body.registrationEnabled !== undefined) settings.registrationEnabled = Boolean(body.registrationEnabled);
      if (body.maintenanceMode !== undefined) settings.maintenanceMode = Boolean(body.maintenanceMode);
      if (body.maintenanceMessage !== undefined) settings.maintenanceMessage = text(body.maintenanceMessage, 500) || "Проводятся технические работы";
      if (body.maxUploadBytes !== undefined) settings.maxUploadBytes = Math.max(1024 * 1024, Math.min(10 * 1024 * 1024 * 1024, Number(body.maxUploadBytes)));
      settings.updatedAt = now();
      settings.updatedBy = actor.id;
      recordAudit(db, actor.id, "admin.system-settings.updated", "system", "global", { fields: Object.keys(body) });
      await persist();
      broadcastAll({ type: "system.config.updated", config: settings, at: now() });
      sendJson(res, 200, { settings });
      return true;
    }

    if (path === "/api/admin/broadcast" && method === "POST") {
      const body = await parseBody(req);
      const message = text(body.message, 2000);
      if (!message) return fail(res, 400, "Введите текст уведомления"), true;
      const payload = { type: "admin.broadcast", message, severity: ["info", "warning", "critical"].includes(body.severity) ? body.severity : "info", at: now() };
      recordAudit(db, actor.id, "admin.broadcast.sent", "system", "all-users", { severity: payload.severity, message });
      await persist();
      broadcastAll(payload);
      sendJson(res, 202, { ok: true, payload });
      return true;
    }

    fail(res, 404, "Административный маршрут не найден");
    return true;
  };
}

export { isSystemAdmin, normalizeSystemSettings };
