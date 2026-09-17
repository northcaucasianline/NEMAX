import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { safeWriteJsonFile } from "./file-write-safe.js";
import { dirname } from "node:path";

const clone = (value) => JSON.parse(JSON.stringify(value));

class FileGameStateStore {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.queue = Promise.resolve();
    mkdirSync(dirname(file), { recursive: true });
  }

  async load() {
    if (!existsSync(this.file)) return clone(this.defaults());
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      return { ...clone(this.defaults()), ...parsed };
    } catch (error) {
      throw new Error(`Игровая база ${this.file} повреждена: ${error.message}`);
    }
  }

  async save(state) {
    const snapshot = JSON.stringify(state, null, 2);
    this.queue = this.queue
      .catch((error) => { console.error(`[FileGameStateStore] Предыдущая запись не удалась: ${error.message}`); })
      .then(() => safeWriteJsonFile(this.file, snapshot));
    return this.queue;
  }

  async health() {
    return { driver: "file", ok: true, file: this.file };
  }

  async close() {}
}

class PostgresGameStateStore {
  constructor(connectionString, defaults) {
    this.connectionString = connectionString;
    this.defaults = defaults;
    this.pool = null;
    this.version = 0;
  }

  async init() {
    const { Pool } = await import("pg");
    this.pool = new Pool({ connectionString: this.connectionString, max: Number(process.env.GAME_POSTGRES_POOL_SIZE || 8) });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS game_server_state (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        version BIGINT NOT NULL DEFAULT 0,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.pool.query(
      "INSERT INTO game_server_state (id, version, payload) VALUES (1, 0, $1::jsonb) ON CONFLICT (id) DO NOTHING",
      [JSON.stringify(this.defaults())],
    );
    return this;
  }

  async load() {
    if (!this.pool) await this.init();
    const result = await this.pool.query("SELECT version, payload FROM game_server_state WHERE id = 1");
    this.version = Number(result.rows[0]?.version || 0);
    return { ...clone(this.defaults()), ...(result.rows[0]?.payload || {}) };
  }

  async save(state) {
    if (!this.pool) await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(88442212)");
      const result = await client.query(
        "UPDATE game_server_state SET version = version + 1, payload = $1::jsonb, updated_at = NOW() WHERE id = 1 RETURNING version",
        [JSON.stringify(state)],
      );
      this.version = Number(result.rows[0].version);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async health() {
    try {
      const startedAt = Date.now();
      await this.pool.query("SELECT 1");
      return { driver: "postgres", ok: true, latencyMs: Date.now() - startedAt, version: this.version };
    } catch (error) {
      return { driver: "postgres", ok: false, error: error.message };
    }
  }

  async close() {
    await this.pool?.end();
  }
}

export async function createGameStateStore({ file, defaults }) {
  const connectionString = (process.env.GAME_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  if (!connectionString) return new FileGameStateStore(file, defaults);
  try {
    return await new PostgresGameStateStore(connectionString, defaults).init();
  } catch (error) {
    if (process.env.REQUIRE_GAME_POSTGRES === "true") throw error;
    console.warn(`PostgreSQL игрового сервера недоступен, включён файловый fallback: ${error.message}`);
    return new FileGameStateStore(file, defaults);
  }
}
