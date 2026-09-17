import http from "node:http";
import { chmodSync, chownSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { hasValidInternalSecret, warnForDefaultInternalSecret } from "./internal-service.js";

const PORT = Number(process.env.CODE_RUNNER_PORT || 3003);
const HOST = process.env.CODE_RUNNER_HOST || "127.0.0.1";
const SOCKET_PATH = process.env.CODE_RUNNER_SOCKET || "";
const ENABLED = process.env.CODE_RUNNER_ENABLED === "true";
const MAX_SOURCE_BYTES = Number(process.env.CODE_RUNNER_MAX_SOURCE_BYTES || 240_000);
const MAX_OUTPUT_BYTES = Number(process.env.CODE_RUNNER_MAX_OUTPUT_BYTES || 96_000);
const MAX_FILES = Number(process.env.CODE_RUNNER_MAX_FILES || 24);
const TIMEOUT_MS = Number(process.env.CODE_RUNNER_TIMEOUT_MS || 6_000);
const USE_PRLIMIT = process.platform === "linux" && process.env.CODE_RUNNER_USE_PRLIMIT !== "false";
const DISABLE_NETWORK = process.platform === "linux" && process.env.CODE_RUNNER_DISABLE_NETWORK !== "false";
const CHILD_UID = Number(process.env.CODE_RUNNER_CHILD_UID || 0);
const CHILD_GID = Number(process.env.CODE_RUNNER_CHILD_GID || CHILD_UID || 0);
const SOCKET_GID = Number(process.env.CODE_RUNNER_SOCKET_GID || 0);

if (!SOCKET_PATH) warnForDefaultInternalSecret("code-runner");

function runtimeCandidate(command, prefixArgs = []) {
  if (!command) return null;
  try {
    const result = spawnSync(command, [...prefixArgs, "--version"], { encoding: "utf8", windowsHide: true, timeout: 3500 });
    if (!result.error && result.status === 0) return { command, prefixArgs, version: String(result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] };
  } catch {}
  return null;
}

function detectRuntimes() {
  const pythonCandidates = [];
  if (process.env.PYTHON_BIN) pythonCandidates.push([process.env.PYTHON_BIN, []]);
  if (process.platform === "win32") pythonCandidates.push(["py", ["-3"]], ["python", []], ["python3", []]);
  else pythonCandidates.push(["python3", []], ["python", []]);

  const javaHome = String(process.env.JAVA_HOME || "").trim();
  const javaExecutable = process.platform === "win32" ? "java.exe" : "java";
  const javacExecutable = process.platform === "win32" ? "javac.exe" : "javac";
  const javaCandidates = [];
  const javacCandidates = [];
  if (process.env.JAVA_BIN) javaCandidates.push([process.env.JAVA_BIN, []]);
  if (process.env.JAVAC_BIN) javacCandidates.push([process.env.JAVAC_BIN, []]);
  if (javaHome) {
    javaCandidates.push([join(javaHome, "bin", javaExecutable), []]);
    javacCandidates.push([join(javaHome, "bin", javacExecutable), []]);
  }
  javaCandidates.push(["java", []]);
  javacCandidates.push(["javac", []]);

  return {
    python: pythonCandidates.map(([command, args]) => runtimeCandidate(command, args)).find(Boolean) || null,
    java: javaCandidates.map(([command, args]) => runtimeCandidate(command, args)).find(Boolean) || null,
    javac: javacCandidates.map(([command, args]) => runtimeCandidate(command, args)).find(Boolean) || null,
  };
}

const RUNTIMES = detectRuntimes();

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_SOURCE_BYTES * 2) {
        reject(Object.assign(new Error("Запрос слишком большой"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(Object.assign(new Error("Некорректный JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function safeRelativePath(value) {
  const cleaned = normalize(String(value || "").replaceAll("\\", "/")).replace(/^([/\\])+/, "");
  if (!cleaned || cleaned.startsWith("..") || cleaned.includes("/../") || cleaned.includes("\0")) return null;
  return cleaned.slice(0, 180);
}

function validateFiles(files, language) {
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) throw Object.assign(new Error(`Нужно от 1 до ${MAX_FILES} файлов`), { status: 400 });
  let total = 0;
  const allowed = language === "python" ? new Set([".py", ".txt", ".json"]) : language === "java" ? new Set([".java", ".txt", ".json"]) : new Set([".js", ".mjs", ".html", ".css", ".json", ".txt"]);
  const normalized = files.map((file) => {
    const path = safeRelativePath(file.path);
    const content = String(file.content ?? "");
    if (!path) throw Object.assign(new Error("Недопустимый путь файла"), { status: 400 });
    if (!allowed.has(extname(path).toLowerCase())) throw Object.assign(new Error(`Недопустимое расширение файла: ${path}`), { status: 400 });
    total += Buffer.byteLength(content);
    return { path, content };
  });
  if (total > MAX_SOURCE_BYTES) throw Object.assign(new Error(`Исходный код больше ${MAX_SOURCE_BYTES} байт`), { status: 413 });
  return normalized;
}

function limitedCommand(command, args, cwd) {
  let wrapped = { command, args };
  if (USE_PRLIMIT) wrapped = {
    command: "prlimit",
    args: ["--as=2147483648", "--cpu=8", "--nproc=48", "--nofile=96", "--fsize=8388608", "--", wrapped.command, ...wrapped.args],
  };
  if (DISABLE_NETWORK) wrapped = { command: "unshare", args: ["-Urn", "--", wrapped.command, ...wrapped.args] };
  return wrapped;
}

function prepareProjectPermissions(root) {
  if (!CHILD_UID || process.platform === "win32") return;
  const visit = (path) => {
    const stat = lstatSync(path);
    chownSync(path, 0, CHILD_GID);
    chmodSync(path, stat.isDirectory() ? 0o770 : 0o660);
    if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name));
  };
  visit(root);
}

function execute(command, args, { cwd, stdin = "", timeoutMs = TIMEOUT_MS, env = {} } = {}) {
  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    const limited = limitedCommand(command, args, cwd);
    const child = spawn(limited.command, limited.args, {
      cwd,
      env: { PATH: process.env.PATH || "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", HOME: cwd, TMPDIR: cwd, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      ...(CHILD_UID && process.platform !== "win32" ? { uid: CHILD_UID, gid: CHILD_GID } : {}),
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let truncated = false;
    let spawnError = null;
    const append = (kind, chunk) => {
      if (truncated) return;
      const text = chunk.toString("utf8");
      const remaining = MAX_OUTPUT_BYTES - outputBytes;
      if (remaining <= 0) { truncated = true; child.kill("SIGKILL"); return; }
      const slice = Buffer.from(text).subarray(0, remaining).toString("utf8");
      outputBytes += Buffer.byteLength(slice);
      if (kind === "stdout") stdout += slice; else stderr += slice;
      if (Buffer.byteLength(text) > remaining) { truncated = true; child.kill("SIGKILL"); }
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => { spawnError = error; stderr += `${error.message}\n`; });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    timer.unref?.();
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveRun({ stdout, stderr, exitCode: Number.isInteger(code) ? code : -1, signal: signal || null, timedOut, truncated, durationMs: Date.now() - startedAt, spawnError: spawnError?.code || null });
    });
    if (stdin) child.stdin.write(String(stdin).slice(0, 20_000));
    child.stdin.end();
  });
}

function javaMainClass(entryFile, content) {
  const packageName = content.match(/^\s*package\s+([a-zA-Z_][\w.]*)\s*;/m)?.[1];
  const className = content.match(/public\s+(?:final\s+)?class\s+([A-Za-z_$][\w$]*)/)?.[1] || basename(entryFile, ".java");
  return packageName ? `${packageName}.${className}` : className;
}

async function runProject(body) {
  const language = ["javascript", "python", "java"].includes(body.language) ? body.language : "javascript";
  const files = validateFiles(body.files, language);
  const entryFile = safeRelativePath(body.entryFile) || files[0].path;
  const entry = files.find((file) => file.path === entryFile);
  if (!entry) throw Object.assign(new Error("Стартовый файл не найден"), { status: 400 });

  const projectDir = mkdtempSync(join(tmpdir(), "nemax-code-"));
  try {
    for (const file of files) {
      const fullPath = resolve(projectDir, file.path);
      if (!fullPath.startsWith(resolve(projectDir))) throw Object.assign(new Error("Недопустимый путь"), { status: 400 });
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, file.content, "utf8");
    }

    prepareProjectPermissions(projectDir);

    if (language === "javascript") {
      const nodeArgs = ["--max-old-space-size=128", "--permission", `--allow-fs-read=${projectDir}`, `--allow-fs-write=${projectDir}`, entryFile];
      return { language, ...(await execute(process.execPath, nodeArgs, { cwd: projectDir, stdin: body.stdin })) };
    }
    if (language === "python") {
      if (!RUNTIMES.python) throw Object.assign(new Error("Python не найден. Установите Python 3 и включите опцию Add Python to PATH либо задайте PYTHON_BIN в .env."), { status: 503 });
      return { language, runtime: RUNTIMES.python.version, ...(await execute(RUNTIMES.python.command, [...RUNTIMES.python.prefixArgs, "-I", "-S", entryFile], { cwd: projectDir, stdin: body.stdin, env: { PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" } })) };
    }

    if (!RUNTIMES.java || !RUNTIMES.javac) throw Object.assign(new Error("JDK не найден. Установите JDK 17+ (нужны java и javac) либо задайте JAVA_HOME/JAVA_BIN/JAVAC_BIN в .env."), { status: 503 });
    const javaFiles = files.filter((file) => file.path.endsWith(".java")).map((file) => file.path);
    const outputDir = join(projectDir, ".classes");
    mkdirSync(outputDir, { recursive: true });
    if (CHILD_UID && process.platform !== "win32") { chownSync(outputDir, CHILD_UID, CHILD_GID); chmodSync(outputDir, 0o700); }
    const compile = await execute(RUNTIMES.javac.command, [...RUNTIMES.javac.prefixArgs, "-J-Xms16m", "-J-Xmx128m", "-J-XX:MaxMetaspaceSize=96m", "-J-XX:CompressedClassSpaceSize=32m", "-J-XX:ReservedCodeCacheSize=48m", "-encoding", "UTF-8", "-d", outputDir, ...javaFiles], { cwd: projectDir, timeoutMs: TIMEOUT_MS });
    if (compile.exitCode !== 0 || compile.timedOut) return { language, stage: "compile", ...compile };
    const mainClass = javaMainClass(entryFile, entry.content);
    const run = await execute(RUNTIMES.java.command, [...RUNTIMES.java.prefixArgs, "-Xms16m", "-Xmx128m", "-XX:MaxMetaspaceSize=96m", "-XX:CompressedClassSpaceSize=32m", "-XX:ReservedCodeCacheSize=48m", "-cp", outputDir, mainClass], { cwd: projectDir, stdin: body.stdin, timeoutMs: TIMEOUT_MS });
    return { language, stage: "run", compileOutput: compile.stderr || compile.stdout, ...run };
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/health") return sendJson(res, 200, { ok: true, enabled: ENABLED, languages: ["javascript", "python", "java"], runtimes: { node: process.version, python: RUNTIMES.python?.version || null, java: RUNTIMES.java?.version || null, javac: RUNTIMES.javac?.version || null }, timeoutMs: TIMEOUT_MS, networkDisabled: DISABLE_NETWORK || Boolean(SOCKET_PATH), childUid: CHILD_UID || null, transport: SOCKET_PATH ? "unix" : "tcp" });
  if (url.pathname !== "/internal/run" || req.method !== "POST") return sendJson(res, 404, { error: "Маршрут не найден" });
  if (!SOCKET_PATH && !hasValidInternalSecret(req)) return sendJson(res, 403, { error: "Недействительный внутренний секрет" });
  if (!ENABLED) return sendJson(res, 503, { error: "Сервис запуска кода выключен. Установите CODE_RUNNER_ENABLED=true или используйте Docker Compose." });
  try {
    const body = await readJson(req);
    const result = await runProject(body);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || "Ошибка запуска кода" });
  }
});

if (SOCKET_PATH) {
  mkdirSync(dirname(SOCKET_PATH), { recursive: true });
  if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);
  server.listen(SOCKET_PATH, () => {
    try { if (SOCKET_GID) chownSync(SOCKET_PATH, 0, SOCKET_GID); chmodSync(SOCKET_PATH, 0o660); } catch {}
    console.log(`NEMAX Code Runner: unix://${SOCKET_PATH} (${ENABLED ? "enabled" : "disabled"})`);
  });
} else {
  server.listen(PORT, HOST, () => {
    console.log(`NEMAX Code Runner: http://${HOST}:${PORT} (${ENABLED ? "enabled" : "disabled"})`);
    console.log(`[Code Runner] Python: ${RUNTIMES.python?.version || "не найден"}; Java: ${RUNTIMES.java?.version || "не найдена"}; javac: ${RUNTIMES.javac?.version || "не найден"}`);
  });
}

function shutdown() {
  server.close(() => { if (SOCKET_PATH && existsSync(SOCKET_PATH)) try { unlinkSync(SOCKET_PATH); } catch {} process.exit(0); });
  setTimeout(() => process.exit(0), 1000).unref?.();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
