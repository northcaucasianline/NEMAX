import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMessageCrypto, MESSAGE_KEY_ROTATION_MS } from "./message-crypto.js";

const directory = mkdtempSync(join(tmpdir(), "messenger-crypto-test-"));
const crypto = createMessageCrypto(directory);

try {
  const first = crypto.encryptJson({ text: "сообщение до ротации" }, "message:first");
  const firstPlain = crypto.decryptJson(first, "message:first");
  assert.equal(firstPlain.text, "сообщение до ротации");

  crypto.rotateNow();
  const second = crypto.encryptJson({ text: "сообщение после ротации" }, "message:second");
  assert.notEqual(first.keyId, second.keyId);
  assert.equal(crypto.decryptJson(first, "message:first").text, "сообщение до ротации");
  assert.equal(crypto.decryptJson(second, "message:second").text, "сообщение после ротации");

  const tampered = { ...second, ciphertext: `${second.ciphertext.slice(0, -2)}AA` };
  assert.throws(() => crypto.decryptJson(tampered, "message:second"));

  const status = crypto.status();
  assert.equal(status.algorithm, "aes-256-gcm");
  assert.equal(status.keyRotationMs, MESSAGE_KEY_ROTATION_MS);

  console.log("Encryption self-test passed");
} finally {
  crypto.close();
  rmSync(directory, { recursive: true, force: true });
}
