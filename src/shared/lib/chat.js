export function getChatTitle(chat, currentUserId, users = []) {
  if (!chat) return "";
  if (chat.isSavedMessages) return "Избранное";
  if (chat.type !== "private") return chat.title || (chat.type === "channel" ? "Канал" : chat.type === "room" ? "Чат-комната" : "Группа");
  const companionId = chat.participants?.find((id) => id !== currentUserId);
  return users.find((u) => u.id === companionId)?.username || chat.title || "Диалог";
}

export function getChatAvatar(chat, currentUserId, users = []) {
  if (!chat) return { color: "#7c5cff", image: null, kind: "image", mimeType: "", letter: "?", statusEmoji: "", online: false };
  if (chat.isSavedMessages) return { color: "linear-gradient(135deg, #7c5cff, #56d6ff)", image: null, kind: "image", mimeType: "", letter: "★", statusEmoji: "", online: false };
  if (chat.type !== "private") {
    return { color: chat.avatarColor || "#7c5cff", image: chat.avatar || null, kind: chat.avatarKind || "image", mimeType: chat.avatarMimeType || "", letter: (chat.title || "?")[0], statusEmoji: chat.statusEmoji || "", online: false };
  }
  const companionId = chat.participants?.find((id) => id !== currentUserId);
  const companion = users.find((u) => u.id === companionId);
  return {
    color: companion?.avatarColor || chat.avatarColor || "#7c5cff",
    image: companion?.avatar || null,
    kind: companion?.avatarKind || "image",
    mimeType: companion?.avatarMimeType || "",
    statusEmoji: companion?.statusEmoji || "",
    online: companion?.status === "online",
    letter: (companion?.username || chat.title || "?")[0],
  };
}

export function messagePreview(msg) {
  if (!msg) return "Нет сообщений";
  if (msg.deleted) return "Сообщение удалено";
  if (msg.type === "text" || msg.type === "system") return msg.text || "Сообщение";
  if (msg.type === "voice") return "🎤 Голосовое сообщение";
  if (msg.type === "video") return "🎥 Видеосообщение";
  if (msg.type === "file") {
    if (msg.mimeType?.startsWith("image/")) return "🖼 Фото";
    if (msg.mimeType?.startsWith("video/")) return "🎬 Видео";
    if (msg.mimeType?.startsWith("audio/")) return "🎵 Аудио";
    return `📎 ${msg.name || "Файл"}`;
  }
  return "Сообщение";
}

export function makeInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function isChatAdmin(chat, userId) {
  return chat?.ownerId === userId || chat?.admins?.includes(userId);
}

export function canPostToChat(chat, userId) {
  if (!chat) return false;
  if (chat.type !== "channel") return chat.participants?.includes(userId);
  return isChatAdmin(chat, userId);
}
