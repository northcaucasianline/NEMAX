import { api } from "./api";

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

function storageKey(userId) { return `e2e-device:${userId}`; }

export async function ensureE2EDevice(userId, name = navigator.userAgent) {
  const current = JSON.parse(localStorage.getItem(storageKey(userId)) || "null");
  if (current?.privateKey && current?.publicKey && current?.id) return current;
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const device = {
    id: crypto.randomUUID(),
    privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
    publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
    name,
  };
  localStorage.setItem(storageKey(userId), JSON.stringify(device));
  await api("/devices", { method: "POST", body: { id: device.id, name, identityKey: JSON.stringify(device.publicKey), oneTimePrekeys: [] } });
  return device;
}

async function deriveWrapKey(privateKey, publicJwk) {
  const publicKey = await crypto.subtle.importKey("jwk", publicJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  return crypto.subtle.deriveKey({ name: "ECDH", public: publicKey }, privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecretText(currentUserId, peerUserId, plaintext) {
  const own = await ensureE2EDevice(currentUserId);
  const ownPrivate = await crypto.subtle.importKey("jwk", own.privateKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
  const [peerResult, ownResult] = await Promise.all([api(`/users/${peerUserId}/devices/public`), api(`/users/${currentUserId}/devices/public`)]);
  const devices = [...(peerResult.devices || []), ...(ownResult.devices || [])];
  if (!devices.length) throw new Error("У собеседника нет зарегистрированного E2E-устройства");

  const contentKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const rawContentKey = await crypto.subtle.exportKey("raw", contentKey);
  const contentIv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: contentIv }, contentKey, enc.encode(plaintext));
  const envelopes = {};

  for (const device of devices) {
    const targetPublic = JSON.parse(device.identityKey);
    const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
    const wrapKey = await deriveWrapKey(ephemeral.privateKey, targetPublic);
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv }, wrapKey, rawContentKey);
    envelopes[device.id] = {
      ephemeralPublicKey: await crypto.subtle.exportKey("jwk", ephemeral.publicKey),
      iv: b64(wrapIv),
      wrappedKey: b64(wrapped),
    };
  }

  return { type: "e2e", clientCiphertext: b64(ciphertext), clientIv: b64(contentIv), recipientEnvelopes: envelopes, senderDeviceId: own.id };
}

export async function decryptSecretMessage(currentUserId, message) {
  const own = await ensureE2EDevice(currentUserId);
  const envelope = message.recipientEnvelopes?.[own.id];
  if (!envelope) return "🔒 Сообщение зашифровано для другого устройства";
  const privateKey = await crypto.subtle.importKey("jwk", own.privateKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
  const wrapKey = await deriveWrapKey(privateKey, envelope.ephemeralPublicKey);
  const rawContentKey = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(envelope.iv) }, wrapKey, unb64(envelope.wrappedKey));
  const contentKey = await crypto.subtle.importKey("raw", rawContentKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(message.clientIv) }, contentKey, unb64(message.clientCiphertext));
  return dec.decode(plaintext);
}

export async function fingerprintForUser(userId) {
  const { devices } = await api(`/users/${userId}/devices/public`);
  const digest = await crypto.subtle.digest("SHA-256", enc.encode((devices || []).map((d) => d.identityKey).join("|")));
  return [...new Uint8Array(digest)].slice(0, 12).map((n) => n.toString(16).padStart(2, "0")).join("").match(/.{1,4}/g).join(" ");
}
