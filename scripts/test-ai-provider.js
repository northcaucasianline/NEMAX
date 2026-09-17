const base = (process.env.AI_SERVER_INTERNAL_URL || "http://127.0.0.1:3005").replace(/\/$/, "");
const secret = process.env.INTERNAL_SERVICE_SECRET || "development-only-change-this-secret";
const health = await fetch(`${base}/health`).then((r) => r.json());
console.log("AI health:", JSON.stringify(health, null, 2));
const response = await fetch(`${base}/internal/generate`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Internal-Service-Secret": secret },
  body: JSON.stringify({ personaId: "artem", user: { username: "Тест" }, latestMessage: "Привет! Ответь одним коротким предложением.", history: [{ role: "user", content: "Привет! Ответь одним коротким предложением." }] }),
});
const payload = await response.json().catch(() => ({}));
console.log("AI response:", response.status, JSON.stringify(payload, null, 2));
if (!response.ok) process.exitCode = 1;
