import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const childEnv = {
  ...process.env,
  INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET || randomBytes(32).toString("hex"),
  // В учебном локальном режиме Code Runner включается автоматически.
  CODE_RUNNER_ENABLED: "true",
};

const viteCli = resolve("node_modules/vite/bin/vite.js");
const nodeService = (file) => spawn(process.execPath, ["--watch", file], { stdio: "inherit", env: childEnv });

const processes = [
  nodeService("server/index.js"),
  nodeService("server/realtime.js"),
  nodeService("server/code-runner.js"),
  nodeService("server/game-server.js"),
  nodeService("server/ai-server.js"),
  // Запускаем Vite напрямую через Node, без shell:true. Это убирает DEP0190 на Windows.
  spawn(process.execPath, [viteCli, "--force"], { stdio: "inherit", env: childEnv }),
];

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of processes) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 250).unref?.();
}

for (const child of processes) {
  child.on("exit", (code) => { if (!closing && code) shutdown(code); });
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
