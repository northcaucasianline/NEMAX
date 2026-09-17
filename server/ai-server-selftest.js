import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const port = 39000 + Math.floor(Math.random() * 1000);
const secret = randomBytes(32).toString("hex");
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/ai-server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_SERVER_PORT: String(port),
    AI_SERVER_HOST: "127.0.0.1",
    AI_PROVIDER: "demo",
    AI_MODEL: "selftest",
    INTERNAL_SERVICE_SECRET: secret,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error(`AI Server не запустился.\n${output}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const health = await waitForHealth();
  assert(health.ok === true, "Health check не прошёл");
  assert(health.personas === 5, "Должно быть ровно пять AI-персон");

  const denied = await fetch(`${base}/internal/personas`);
  assert(denied.status === 401, "Внутренний маршрут должен требовать секрет");

  const personasResponse = await fetch(`${base}/internal/personas`, {
    headers: { "X-Internal-Service-Secret": secret },
  });
  const personasPayload = await personasResponse.json();
  assert(personasResponse.ok, "Список персон не получен");
  assert(personasPayload.personas.length === 5, "Некорректное число персон");
  assert(personasPayload.personas.every((item) => !Object.hasOwn(item, "prompt")), "Системные промпты не должны отдаваться наружу");

  const generatedResponse = await fetch(`${base}/internal/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Secret": secret,
    },
    body: JSON.stringify({
      personaId: "max",
      user: { id: "selftest-user", username: "Тест" },
      latestMessage: "Помоги разобраться с ошибкой JavaScript",
      history: [{ senderId: "selftest-user", content: "Помоги разобраться с ошибкой JavaScript" }],
    }),
  });
  const generated = await generatedResponse.json();
  assert(generatedResponse.ok, generated.error || "Генерация не сработала");
  assert(typeof generated.text === "string" && generated.text.length > 10, "Пустой ответ AI Server");
  assert(generated.provider === "demo", "Self-test должен использовать demo provider");

  console.log("AI Server self-test: OK — 5 персон, внутренний секрет и demo-генерация работают");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2000).then(() => child.kill("SIGKILL")),
  ]);
}
