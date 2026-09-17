import http from "node:http";
import { timingSafeEqual } from "node:crypto";

export const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || "development-only-change-this-secret";
export const CORE_INTERNAL_URL = (process.env.CORE_INTERNAL_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
export const REALTIME_INTERNAL_URL = (process.env.REALTIME_INTERNAL_URL || "http://127.0.0.1:3002").replace(/\/$/, "");
export const CODE_RUNNER_INTERNAL_URL = (process.env.CODE_RUNNER_INTERNAL_URL || "http://127.0.0.1:3003").replace(/\/$/, "");
export const GAME_SERVER_INTERNAL_URL = (process.env.GAME_SERVER_INTERNAL_URL || "http://127.0.0.1:3004").replace(/\/$/, "");
export const AI_SERVER_INTERNAL_URL = (process.env.AI_SERVER_INTERNAL_URL || "http://127.0.0.1:3005").replace(/\/$/, "");
export const CODE_RUNNER_SOCKET = process.env.CODE_RUNNER_SOCKET || "";

export function warnForDefaultInternalSecret(serviceName) {
  if (INTERNAL_SERVICE_SECRET === "development-only-change-this-secret") {
    console.warn(`[${serviceName}] ВНИМАНИЕ: используется тестовый INTERNAL_SERVICE_SECRET. Задайте свой секрет в production.`);
  }
}

export function hasValidInternalSecret(req) {
  const supplied = String(req.headers["x-internal-service-secret"] || "");
  const expected = INTERNAL_SERVICE_SECRET;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function requestSocketJson(socketPath, path, payload, { method = "POST", timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? "" : JSON.stringify(payload || {});
    const request = http.request({
      socketPath,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-Internal-Service-Secret": INTERNAL_SERVICE_SECRET,
      },
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        let result = {};
        try { result = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; } catch {}
        if ((response.statusCode || 500) >= 400) reject(new Error(result.error || `Внутренний сервис вернул ${response.statusCode}`));
        else resolve(result);
      });
    });
    request.on("timeout", () => request.destroy(new Error("Тайм-аут внутреннего сервиса")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

export async function requestInternalJson(baseUrl, path, payload, { method = "POST", timeoutMs = 3000, socketPath = "" } = {}) {
  if (socketPath) return requestSocketJson(socketPath, path, payload, { method, timeoutMs });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const body = payload === undefined ? undefined : JSON.stringify(payload || {});
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Secret": INTERNAL_SERVICE_SECRET,
      },
      body,
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Внутренний сервис вернул ${response.status}`);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export function postInternalJson(baseUrl, path, payload, { timeoutMs = 3000, socketPath = "" } = {}) {
  return requestInternalJson(baseUrl, path, payload, { method: "POST", timeoutMs, socketPath });
}

export function getInternalJson(baseUrl, path, { timeoutMs = 3000, socketPath = "" } = {}) {
  return requestInternalJson(baseUrl, path, undefined, { method: "GET", timeoutMs, socketPath });
}
