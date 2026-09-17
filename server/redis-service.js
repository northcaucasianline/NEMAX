import { randomUUID } from "node:crypto";

class MemoryRedisService {
  constructor() {
    this.values = new Map();
    this.streams = new Map();
  }
  async init() { return this; }
  async get(key) {
    const item = this.values.get(key);
    if (!item) return null;
    if (item.expiresAt && item.expiresAt <= Date.now()) { this.values.delete(key); return null; }
    return item.value;
  }
  async set(key, value, ttlSeconds = 0) {
    this.values.set(key, { value: String(value), expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
  }
  async del(key) { this.values.delete(key); }
  async incr(key, ttlSeconds = 0) {
    const value = Number(await this.get(key) || 0) + 1;
    await this.set(key, value, ttlSeconds);
    return value;
  }
  async xadd(stream, payload) {
    const list = this.streams.get(stream) || [];
    const id = `${Date.now()}-${randomUUID()}`;
    list.push({ id, payload });
    if (list.length > 50_000) list.splice(0, list.length - 50_000);
    this.streams.set(stream, list);
    return id;
  }
  async xrange(stream, afterId = "0-0", count = 100) {
    const list = this.streams.get(stream) || [];
    if (afterId === "0-0") return list.slice(-count);
    const index = list.findIndex((item) => item.id === afterId);
    return list.slice(index + 1, index + 1 + count);
  }
  async queuePush(key, payload, limit = 100, ttlSeconds = 900) {
    const raw = await this.get(key);
    const list = raw ? JSON.parse(raw) : [];
    list.push(payload);
    await this.set(key, JSON.stringify(list.slice(-limit)), ttlSeconds);
    return list.length;
  }
  async queueDrain(key) {
    const raw = await this.get(key);
    await this.del(key);
    return raw ? JSON.parse(raw) : [];
  }
  async health() { return { driver: "memory", ok: true }; }
  async close() {}
}

class RedisService {
  constructor(url) {
    this.url = url;
    this.client = null;
    this.connected = false;
    this.lastRuntimeError = "";
  }

  async init() {
    const { createClient } = await import("redis");
    this.client = createClient({
      url: this.url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1200),
        reconnectStrategy: () => false,
      },
    });

    this.client.on("error", (error) => {
      // Ошибку первоначального подключения обработает createRedisService().
      // Здесь выводятся только новые ошибки уже работавшего соединения — один раз.
      if (!this.connected || error.message === this.lastRuntimeError) return;
      this.lastRuntimeError = error.message;
      console.warn(`Redis runtime error: ${error.message}`);
    });

    try {
      await this.client.connect();
      this.connected = true;
      return this;
    } catch (error) {
      this.connected = false;
      try { this.client.destroy(); } catch {}
      this.client = null;
      throw error;
    }
  }

  async get(key) { return this.client.get(key); }
  async set(key, value, ttlSeconds = 0) {
    if (ttlSeconds) return this.client.set(key, String(value), { EX: ttlSeconds });
    return this.client.set(key, String(value));
  }
  async del(key) { return this.client.del(key); }
  async incr(key, ttlSeconds = 0) {
    const result = await this.client.multi().incr(key).expire(key, ttlSeconds || 60, "NX").exec();
    return Number(result?.[0] || 0);
  }
  async xadd(stream, payload) {
    return this.client.xAdd(stream, "*", { data: JSON.stringify(payload) }, { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: 50_000 } });
  }
  async xrange(stream, afterId = "0-0", count = 100) {
    const rows = await this.client.xRange(stream, afterId === "0-0" ? "-" : `(${afterId}`, "+", { COUNT: count });
    return rows.map((row) => ({ id: row.id, payload: JSON.parse(row.message.data) }));
  }
  async queuePush(key, payload, limit = 100, ttlSeconds = 900) {
    const value = JSON.stringify(payload);
    await this.client.multi().rPush(key, value).lTrim(key, -limit, -1).expire(key, ttlSeconds).exec();
  }
  async queueDrain(key) {
    const script = `local v=redis.call('LRANGE',KEYS[1],0,-1); redis.call('DEL',KEYS[1]); return v`;
    const rows = await this.client.eval(script, { keys: [key], arguments: [] });
    return (rows || []).map((row) => JSON.parse(row));
  }
  async health() {
    try {
      const started = Date.now();
      await this.client.ping();
      return { driver: "redis", ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return { driver: "redis", ok: false, error: error.message };
    }
  }
  async close() {
    if (!this.client) return;
    try {
      if (this.client.isOpen) await this.client.quit();
      else this.client.destroy();
    } catch {
      try { this.client.destroy(); } catch {}
    }
  }
}

export async function createRedisService() {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return new MemoryRedisService().init();

  try {
    return await new RedisService(url).init();
  } catch (error) {
    if (process.env.REQUIRE_REDIS === "true") throw error;
    console.warn(`Redis недоступен — включён тихий memory fallback (${error.message}).`);
    return new MemoryRedisService().init();
  }
}
