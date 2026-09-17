const CACHE = "nemax-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/nemax-icon-192.png", "/nemax-icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => caches.match("/"))));
});
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json?.() || {}; } catch {}
  event.waitUntil(self.registration.showNotification(payload.title || "НЕМАКС", { body: payload.body || "Новое сообщение", icon: "/nemax-icon-192.png", badge: "/nemax-icon-192.png", data: payload.data || {} }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if ("focus" in client) { client.navigate?.(url); return client.focus(); }
    }
    return clients.openWindow(url);
  }));
});
