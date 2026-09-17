export const DEFAULT_SETTINGS = {
  theme: "dark",
  fontSize: "medium",
  compactMode: false,
  animations: true,
  accentColor: "#9b3dff",
  accentSecondary: "#ff3fb0",
  bubbleStyle: "gradient",
  chatWallpaper: "aurora",
  glassEffects: true,
  sidebarDefaultCollapsed: false,
  messageNotifications: true,
  groupNotifications: true,
  channelNotifications: true,
  sound: true,
  notificationPreview: true,
  lastSeen: "everyone",
  profilePhoto: "everyone",
  readReceipts: true,
  allowInvites: "everyone",
  autoDownloadMedia: true,
  autoPlayVideo: true,
  saveData: false,
  language: "ru",
};

export function getSettings(user) {
  return { ...DEFAULT_SETTINGS, ...(user?.settings || {}) };
}

function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

export function applySettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const root = document.documentElement;
  root.dataset.theme = merged.theme;
  root.dataset.fontSize = merged.fontSize;
  root.dataset.compact = merged.compactMode ? "true" : "false";
  root.dataset.animations = merged.animations === false ? "false" : "true";
  root.dataset.bubbleStyle = merged.bubbleStyle;
  root.dataset.wallpaper = merged.chatWallpaper;
  root.dataset.glass = merged.glassEffects === false ? "false" : "true";
  root.style.setProperty("--purple", safeColor(merged.accentColor, DEFAULT_SETTINGS.accentColor));
  root.style.setProperty("--pink", safeColor(merged.accentSecondary, DEFAULT_SETTINGS.accentSecondary));
  if (merged.sidebarDefaultCollapsed && localStorage.getItem("chatSidebarCollapsed") === null) localStorage.setItem("chatSidebarCollapsed", "true");
}
