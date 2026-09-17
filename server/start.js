import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const childEnv = {
  ...process.env,
  INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET || randomBytes(32).toString("hex"),
  CODE_RUNNER_ENABLED: process.env.CODE_RUNNER_ENABLED || "true",
};

const children = [
  spawn(process.execPath, ["server/index.js"], { stdio: "inherit", env: childEnv }),
  spawn(process.execPath, ["server/realtime.js"], { stdio: "inherit", env: childEnv }),
  spawn(process.execPath, ["server/code-runner.js"], { stdio: "inherit", env: childEnv }),
  spawn(process.execPath, ["server/game-server.js"], { stdio: "inherit", env: childEnv }),
  spawn(process.execPath, ["server/ai-server.js"], { stdio: "inherit", env: childEnv }),
];

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 400).unref?.();
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!closing && (code || signal)) {
      console.error(`Один из backend-сервисов завершился (${signal || code}). Останавливаю остальные сервисы.`);
      shutdown(code || 1);
    }
  });
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
