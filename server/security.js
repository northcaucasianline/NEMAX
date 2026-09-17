import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256(value) { return createHash("sha256").update(String(value)).digest("hex"); }
export function randomToken(bytes = 32) { return randomBytes(bytes).toString("base64url"); }
export function constantEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
export function createSessionRecord(userId, req) {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(48);
  const now = Date.now();
  return {
    accessToken,
    refreshToken,
    record: {
      id: randomToken(12), userId,
      tokenHash: sha256(accessToken), refreshHash: sha256(refreshToken),
      createdAt: now, lastUsedAt: now,
      accessExpiresAt: now + Number(process.env.ACCESS_TOKEN_TTL_MS || 15 * 60 * 1000),
      refreshExpiresAt: now + Number(process.env.REFRESH_TOKEN_TTL_MS || 30 * 24 * 60 * 60 * 1000),
      userAgent: req.headers["user-agent"] || "Неизвестное устройство",
      ip: req.socket.remoteAddress || "", revokedAt: null,
    },
  };
}
export function verifyTotp(secretHex, code, now = Date.now()) {
  if (!secretHex || !/^\d{6}$/.test(String(code || ""))) return false;
  const key = Buffer.from(secretHex, "hex");
  const counter = Math.floor(now / 30_000);
  for (let drift = -1; drift <= 1; drift++) {
    const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter + drift));
    const digest = createHmac("sha1", key).update(buffer).digest();
    const offset = digest[digest.length - 1] & 0xf;
    const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    if (constantEqual(String(value).padStart(6, "0"), String(code))) return true;
  }
  return false;
}
export function generateTotpSecret() { return randomBytes(20).toString("hex"); }
