import { sha256, createSessionRecord, generateTotpSecret, verifyTotp } from "./security.js";
import { strict as assert } from "node:assert";
const req = { headers: { "user-agent": "selftest" }, socket: { remoteAddress: "127.0.0.1" } };
const session = createSessionRecord("u1", req); assert.equal(session.record.tokenHash, sha256(session.accessToken)); assert.equal(session.record.refreshHash, sha256(session.refreshToken));
const secret = generateTotpSecret(); assert.equal(secret.length, 40); assert.equal(verifyTotp(secret, "000000"), false);
console.log("Platform self-test: OK");
