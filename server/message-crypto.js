import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const MESSAGE_KEY_ROTATION_MS = 5 * 60 * 1000;
export const MESSAGE_CIPHER = "aes-256-gcm";
export const MESSAGE_ENCRYPTION_VERSION = 1;

const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_FILE_NAME = "message-keys.json";

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(temp, path);
  } catch (error) {
    if (!existsSync(path)) throw error;
    unlinkSync(path);
    renameSync(temp, path);
  }
  try { chmodSync(path, 0o600); } catch {}
}

function isValidKeyRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (typeof record.id !== "string" || !record.id) return false;
  if (!Number.isFinite(record.createdAt)) return false;
  try {
    return Buffer.from(record.key, "base64").length === KEY_BYTES;
  } catch {
    return false;
  }
}

export function createMessageCrypto(dataDirectory, { autoRotate = true } = {}) {
  const keyFile = join(dataDirectory, KEY_FILE_NAME);
  let rotationTimer = null;
  let ring;

  function loadRing() {
    if (!existsSync(keyFile)) {
      return { version: 1, rotationMs: MESSAGE_KEY_ROTATION_MS, keys: [] };
    }

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(keyFile, "utf8"));
    } catch (error) {
      throw new Error(`Файл ключей сообщений повреждён: ${error.message}`);
    }

    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.keys) || !parsed.keys.every(isValidKeyRecord)) {
      throw new Error("Файл ключей сообщений имеет неподдерживаемый формат");
    }

    return {
      version: 1,
      rotationMs: MESSAGE_KEY_ROTATION_MS,
      keys: parsed.keys.sort((a, b) => a.createdAt - b.createdAt),
    };
  }

  function persistRing() {
    atomicWriteJson(keyFile, ring);
  }

  function generateKey(createdAt = Date.now()) {
    const record = {
      id: randomUUID(),
      createdAt,
      key: randomBytes(KEY_BYTES).toString("base64"),
    };
    ring.keys.push(record);
    persistRing();
    return record;
  }

  function currentKey() {
    return ring.keys.at(-1) || null;
  }

  function rotateNow() {
    const key = generateKey(Date.now());
    if (autoRotate) scheduleRotation();
    return key;
  }

  function rotateIfDue() {
    const current = currentKey();
    if (!current || Date.now() - current.createdAt >= MESSAGE_KEY_ROTATION_MS) {
      return { rotated: true, key: rotateNow() };
    }
    return { rotated: false, key: current };
  }

  function ensureCurrentKey() {
    const current = currentKey();
    if (!current) return rotateNow();
    if (Date.now() - current.createdAt >= MESSAGE_KEY_ROTATION_MS) return rotateNow();
    return current;
  }

  function scheduleRotation() {
    if (rotationTimer) clearTimeout(rotationTimer);
    const current = currentKey();
    const delay = current
      ? Math.max(250, current.createdAt + MESSAGE_KEY_ROTATION_MS - Date.now())
      : 250;
    rotationTimer = setTimeout(() => {
      try { rotateNow(); } catch (error) { console.error("Не удалось сменить ключ сообщений:", error); }
    }, delay);
    rotationTimer.unref?.();
  }

  function keyById(keyId) {
    const record = ring.keys.find((item) => item.id === keyId);
    if (!record) throw new Error(`Ключ шифрования ${keyId} не найден`);
    return Buffer.from(record.key, "base64");
  }

  function aadFor(purpose, keyId) {
    return Buffer.from(`messenger:${MESSAGE_ENCRYPTION_VERSION}:${purpose}:${keyId}`, "utf8");
  }

  function encryptBuffer(plainBuffer, purpose = "message") {
    const keyRecord = ensureCurrentKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(MESSAGE_CIPHER, Buffer.from(keyRecord.key, "base64"), iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(aadFor(purpose, keyRecord.id));
    const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext,
      envelope: {
        version: MESSAGE_ENCRYPTION_VERSION,
        algorithm: MESSAGE_CIPHER,
        keyId: keyRecord.id,
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
      },
    };
  }

  function decryptBuffer(ciphertext, envelope, purpose = "message") {
    if (!envelope || envelope.version !== MESSAGE_ENCRYPTION_VERSION || envelope.algorithm !== MESSAGE_CIPHER) {
      throw new Error("Неподдерживаемый формат шифрования сообщения");
    }
    const iv = Buffer.from(envelope.iv || "", "base64");
    const tag = Buffer.from(envelope.tag || "", "base64");
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) {
      throw new Error("Некорректные параметры зашифрованного сообщения");
    }
    const decipher = createDecipheriv(MESSAGE_CIPHER, keyById(envelope.keyId), iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(aadFor(purpose, envelope.keyId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  function encryptJson(value, purpose = "message") {
    const { ciphertext, envelope } = encryptBuffer(Buffer.from(JSON.stringify(value), "utf8"), purpose);
    return { ...envelope, ciphertext: ciphertext.toString("base64") };
  }

  function decryptJson(envelope, purpose = "message") {
    const ciphertext = Buffer.from(envelope?.ciphertext || "", "base64");
    const plain = decryptBuffer(ciphertext, envelope, purpose);
    return JSON.parse(plain.toString("utf8"));
  }

  function status() {
    const current = ensureCurrentKey();
    return {
      enabled: true,
      algorithm: MESSAGE_CIPHER,
      keyRotationMs: MESSAGE_KEY_ROTATION_MS,
      keyRotationMinutes: MESSAGE_KEY_ROTATION_MS / 60000,
      currentKeyCreatedAt: current.createdAt,
      nextRotationAt: current.createdAt + MESSAGE_KEY_ROTATION_MS,
      retainedKeyCount: ring.keys.length,
    };
  }

  ring = loadRing();
  ensureCurrentKey();
  if (autoRotate) scheduleRotation();

  return {
    keyFile,
    encryptBuffer,
    decryptBuffer,
    encryptJson,
    decryptJson,
    rotateNow,
    rotateIfDue,
    status,
    close() {
      if (rotationTimer) clearTimeout(rotationTimer);
    },
  };
}
