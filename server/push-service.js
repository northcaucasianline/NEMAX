class NoopPushService {
  async sendMany() { return { sent: 0, failed: 0, unavailable: true }; }
  async health() { return { driver: "disabled", ok: true }; }
}

class WebPushService {
  constructor(webpush) { this.webpush = webpush; }
  async sendMany(subscriptions, payload) {
    let sent = 0; let failed = 0;
    await Promise.all((subscriptions || []).map(async (item) => {
      try { await this.webpush.sendNotification(item.subscription, JSON.stringify(payload), { TTL: 60, urgency: "high" }); sent += 1; }
      catch { failed += 1; }
    }));
    return { sent, failed, unavailable: false };
  }
  async health() { return { driver: "web-push", ok: true }; }
}

export async function createPushService() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return new NoopPushService();
  try {
    const module = await import("web-push"); const webpush = module.default || module;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.local", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    return new WebPushService(webpush);
  } catch (error) {
    console.warn(`Web Push отключён: ${error.message}`); return new NoopPushService();
  }
}
