import { existsSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = resolve(fileURLToPath(new URL("..", import.meta.url))); const stamp = new Date().toISOString().replace(/[:.]/g, "-"); const target = join(root, "backups", stamp); mkdirSync(target, { recursive: true });
for (const rel of ["server/data", "server/uploads"]) { const source = join(root, rel); if (existsSync(source)) cpSync(source, join(target, rel.replaceAll("/", "-")), { recursive: true }); }
if (process.env.DATABASE_URL) { const result = spawnSync("pg_dump", [process.env.DATABASE_URL, "-Fc", "-f", join(target, "postgres.dump")], { stdio: "inherit" }); if (result.error) writeFileSync(join(target, "POSTGRES_BACKUP_FAILED.txt"), result.error.message); }
console.log(`Резервная копия: ${target}`);
