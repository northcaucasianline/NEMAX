import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const port = 39000 + Math.floor(Math.random() * 1000);
const secret = randomBytes(24).toString("hex");
const child = spawn(process.execPath, ["server/code-runner.js"], {
  cwd: process.cwd(),
  env: { ...process.env, CODE_RUNNER_ENABLED: "true", CODE_RUNNER_PORT: String(port), CODE_RUNNER_HOST: "127.0.0.1", INTERNAL_SERVICE_SECRET: secret },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });

async function wait() {
  for (let index = 0; index < 50; index += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}/health`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Runner не запустился. ${logs}`);
}

async function run(payload) {
  const response = await fetch(`http://127.0.0.1:${port}/internal/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Service-Secret": secret },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

try {
  await wait();
  const js = await run({ language: "javascript", entryFile: "main.js", files: [{ path: "main.js", content: "console.log(2 + 3)" }] });
  if (js.stdout.trim() !== "5" || js.exitCode !== 0) throw new Error(`JavaScript self-test: ${JSON.stringify(js)}`);
  const python = await run({ language: "python", entryFile: "main.py", files: [{ path: "main.py", content: "print(6 * 7)" }] });
  if (python.stdout.trim() !== "42" || python.exitCode !== 0) throw new Error(`Python self-test: ${JSON.stringify(python)}`);
  const java = await run({ language: "java", entryFile: "Main.java", files: [{ path: "Main.java", content: "public class Main { public static void main(String[] args) { System.out.println(9 * 9); } }" }] });
  if (java.stdout.trim() !== "81" || java.exitCode !== 0) throw new Error(`Java self-test: ${JSON.stringify(java)}`);
  console.log("Code Runner self-test пройден: JavaScript=5, Python=42, Java=81");
} finally {
  child.kill("SIGTERM");
}
