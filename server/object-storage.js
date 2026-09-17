import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";

class LocalObjectStorage {
  constructor(root) { this.root = resolve(root); mkdirSync(this.root, { recursive: true }); }
  pathFor(key) {
    const clean = normalize(String(key || "")).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    const path = resolve(this.root, clean);
    if (path !== this.root && !path.startsWith(`${this.root}/`) && !path.startsWith(`${this.root}\\`)) throw new Error("Недопустимый ключ объекта");
    return path;
  }
  async put(key, buffer, contentType) { const path = this.pathFor(key); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, buffer); return { key, contentType, size: buffer.length, driver: "local" }; }
  async get(key) { const path = this.pathFor(key); return existsSync(path) ? readFileSync(path) : null; }
  async stat(key) { const path = this.pathFor(key); return existsSync(path) ? statSync(path) : null; }
  async delete(key) { const path = this.pathFor(key); if (existsSync(path)) unlinkSync(path); }
  stream(key) { return createReadStream(this.pathFor(key)); }
  async health() { return { driver: "local", ok: true, root: this.root }; }
}

class S3ObjectStorage {
  constructor(options) { Object.assign(this, options); this.client = null; }
  async init() {
    const { S3Client } = await import("@aws-sdk/client-s3");
    this.commands = await import("@aws-sdk/client-s3");
    this.client = new S3Client({
      region: this.region,
      endpoint: this.endpoint || undefined,
      forcePathStyle: this.forcePathStyle,
      credentials: this.accessKeyId ? { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey } : undefined,
    });
    try { await this.client.send(new this.commands.HeadBucketCommand({ Bucket: this.bucket })); }
    catch {
      if (process.env.S3_CREATE_BUCKET !== "false") await this.client.send(new this.commands.CreateBucketCommand({ Bucket: this.bucket }));
    }
    return this;
  }
  async put(key, buffer, contentType) {
    await this.client.send(new this.commands.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }));
    return { key, contentType, size: buffer.length, driver: "s3" };
  }
  async get(key) {
    const result = await this.client.send(new this.commands.GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks = [];
    for await (const chunk of result.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  async delete(key) { await this.client.send(new this.commands.DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
  async health() {
    try { const started = Date.now(); await this.client.send(new this.commands.HeadBucketCommand({ Bucket: this.bucket })); return { driver: "s3", ok: true, latencyMs: Date.now() - started, bucket: this.bucket }; }
    catch (error) { return { driver: "s3", ok: false, error: error.message }; }
  }
}

export async function createObjectStorage(localRoot) {
  if (!process.env.S3_BUCKET) return new LocalObjectStorage(localRoot);
  try {
    return await new S3ObjectStorage({
      bucket: process.env.S3_BUCKET,
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    }).init();
  } catch (error) {
    if (process.env.REQUIRE_S3 === "true") throw error;
    console.warn(`S3/MinIO недоступен, включено локальное хранилище: ${error.message}`);
    return new LocalObjectStorage(localRoot);
  }
}
