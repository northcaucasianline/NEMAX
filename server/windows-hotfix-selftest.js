import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeWriteJsonFile } from "./file-write-safe.js";
import { createBoardTable, applyBoardTableAction } from "./board-games.js";
import { chooseChessBotMove, stockfishStatus } from "./stockfish-service.js";

const dir = mkdtempSync(join(tmpdir(), "nemax-hotfix-"));
try {
  const file = join(dir, "db.json");
  safeWriteJsonFile(file, JSON.stringify({ version: 1 }));
  safeWriteJsonFile(file, JSON.stringify({ version: 2 }));
  if (JSON.parse(readFileSync(file, "utf8")).version !== 2) throw new Error("Безопасная запись JSON не прошла проверку");

  const host = { id: "selftest-user", publicId: 1000, username: "Selftest", displayName: "Selftest", avatar: "" };
  const table = createBoardTable({ type: "chess", title: "Bot test", host, botLevel: 5 });
  applyBoardTableAction(table, host.id, { kind: "move", from: { row: 6, col: 4 }, to: { row: 4, col: 4 } });
  const bot = await chooseChessBotMove(table.state, 5);
  applyBoardTableAction(table, table.bot.userId, bot.action);
  console.log(`Windows hotfix self-test: OK; chess engine=${bot.engine}; binary=${stockfishStatus().binary || "fallback"}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
