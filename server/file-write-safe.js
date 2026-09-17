import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

const RETRYABLE = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]);
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms) {
  Atomics.wait(sleepBuffer, 0, 0, ms);
}

/**
 * Safely replace a JSON file on Windows and Unix.
 * Antivirus/indexers can briefly lock the destination and make rename() return EPERM.
 * We retry atomic rename first, then fall back to writing the destination directly.
 */
export function safeWriteJsonFile(file, snapshot) {
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, snapshot, "utf8");
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      renameSync(tmp, file);
      return;
    } catch (error) {
      lastError = error;
      if (!RETRYABLE.has(error?.code)) break;
      sleepSync(20 + attempt * 35);
    }
  }

  // Windows fallback: overwrite the target in-place. This is less atomic, but avoids
  // a permanently broken application when another program briefly keeps db.json open.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      writeFileSync(file, snapshot, "utf8");
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
      return;
    } catch (error) {
      lastError = error;
      if (!RETRYABLE.has(error?.code)) break;
      sleepSync(35 + attempt * 50);
    }
  }

  try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
  throw lastError || new Error(`Не удалось сохранить ${file}`);
}
