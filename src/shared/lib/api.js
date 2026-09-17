const API_BASE = import.meta.env.VITE_API_URL || "/api";
const GAME_API_BASE = import.meta.env.VITE_GAME_API_URL || "/game-api";
const DEFAULT_WS_PROTOCOL = window.location.protocol === "https:" ? "wss" : "ws";
const DEFAULT_REALTIME_PORT = import.meta.env.VITE_REALTIME_PORT || "3002";
const WS_BASE = import.meta.env.VITE_WS_URL || `${DEFAULT_WS_PROTOCOL}://${window.location.hostname}:${DEFAULT_REALTIME_PORT}/ws`;
const sockets = new Set();
let refreshPromise = null;

export function getToken() { return localStorage.getItem("authToken") || ""; }
export function getRefreshToken() { return localStorage.getItem("refreshToken") || ""; }
export function setTokens(token, refreshToken = null, expiresAt = null) {
  if (token) localStorage.setItem("authToken", token); else localStorage.removeItem("authToken");
  if (refreshToken !== null) refreshToken ? localStorage.setItem("refreshToken", refreshToken) : localStorage.removeItem("refreshToken");
  if (expiresAt) localStorage.setItem("authExpiresAt", String(expiresAt));
}
export function setToken(token) { setTokens(token, token ? undefined : ""); }

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error("Сессия завершена");
  refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }),
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Не удалось обновить сессию");
    setTokens(payload.token, payload.refreshToken, payload.expiresAt);
    return payload.token;
  }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function api(path, options = {}, retry = true) {
  const token = getToken();
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body });
  if (response.status === 401 && retry && !path.startsWith("/auth/login") && !path.startsWith("/auth/register") && !path.startsWith("/auth/refresh")) {
    try { await refreshAccessToken(); return api(path, options, false); }
    catch { setTokens("", ""); window.dispatchEvent(new Event("auth:expired")); }
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `Ошибка сервера ${response.status}`), { status: response.status, details: payload.details });
  return payload;
}


export async function gameApi(path, options = {}, retry = true) {
  const token = getToken();
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${GAME_API_BASE}${path}`, { ...options, headers, body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body });
  if (response.status === 401 && retry) {
    try { await refreshAccessToken(); return gameApi(path, options, false); }
    catch { setTokens("", ""); window.dispatchEvent(new Event("auth:expired")); }
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `Ошибка игрового сервера ${response.status}`), { status: response.status, details: payload.details });
  return payload;
}

export function connectSocket(onEvent, onState) {
  let socket; let retryTimer; let stopped = false; let delay = 1000;
  const open = () => {
    const token = getToken(); if (!token || stopped) return;
    onState?.("connecting"); socket = new WebSocket(`${WS_BASE}${WS_BASE.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`); sockets.add(socket);
    socket.onopen = () => { delay = 1000; onState?.("connected"); };
    socket.onmessage = (event) => { try { const payload = JSON.parse(event.data); onEvent?.(payload); if (payload.eventId) socket.send(JSON.stringify({ type: "event.ack", eventId: payload.eventId })); } catch {} };
    socket.onerror = () => socket.close();
    socket.onclose = async () => {
      sockets.delete(socket); onState?.("disconnected");
      if (!stopped) { try { await refreshAccessToken(); } catch {} retryTimer = setTimeout(open, delay); delay = Math.min(delay * 1.7, 10000); }
    };
  };
  open();
  return () => { stopped = true; clearTimeout(retryTimer); sockets.delete(socket); socket?.close(); };
}

export function sendSocketEvent(event) {
  let sent = 0;
  for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(event)); sent += 1; }
  return sent;
}

export async function uploadLargeFile(file, onProgress) {
  const init = await api("/uploads/init", { method: "POST", body: { name: file.name, mimeType: file.type || "application/octet-stream", size: file.size } });
  const chunkSize = init.chunkSize || 2 * 1024 * 1024; let part = 0; let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
    const bytes = new Uint8Array(await chunk.arrayBuffer());
    let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await api(`/uploads/${init.upload.id}/chunk`, { method: "POST", body: { part, data: btoa(binary) } });
    offset += chunk.size; part += 1; onProgress?.(Math.round((offset / file.size) * 100));
  }
  return api(`/uploads/${init.upload.id}/complete`, { method: "POST", body: {} });
}

export async function registerPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return { unavailable: true };
  const { publicKey } = await api("/push/public-key"); if (!publicKey) return { unavailable: true };
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)) });
  await api("/push/subscriptions", { method: "POST", body: { subscription, deviceName: navigator.userAgent } });
  return { ok: true };
}

export function absoluteMediaUrl(value) {
  if (!value || value.startsWith("data:") || value.startsWith("blob:") || /^https?:\/\//.test(value)) return value;
  const base = (import.meta.env.VITE_MEDIA_URL || window.location.origin).replace(/\/$/, ""); const path = `${value.startsWith("/") ? "" : "/"}${value}`; const url = `${base}${path}`;
  if (path.startsWith("/api/media/") || path.startsWith("/api/objects/")) { const token = getToken(); return token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url; }
  return url;
}
