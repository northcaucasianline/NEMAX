import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyChessAction, chessStateToFen, listLegalChessMoves } from "./board-games.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ELO_BY_LEVEL = { 3: 1100, 4: 1250, 5: 1400, 6: 1550, 7: 1700 };
const TIME_BY_LEVEL = { 3: 180, 4: 260, 5: 360, 6: 520, 7: 750 };
const PIECE_VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

function candidateCommands() {
  const exe = process.platform === "win32" ? "stockfish.exe" : "stockfish";
  return [
    process.env.STOCKFISH_BIN,
    join(ROOT, "server", "bin", exe),
    exe,
    "stockfish",
  ].filter(Boolean);
}

function detectBinary() {
  for (const command of candidateCommands()) {
    if ((command.includes("/") || command.includes("\\")) && !existsSync(command)) continue;
    try {
      const result = spawnSync(command, [], { input: "uci\nquit\n", encoding: "utf8", windowsHide: true, timeout: 2500 });
      const output = String(result.stdout || result.stderr || "").trim();
      if (!result.error && (result.status === 0 || /stockfish/i.test(output))) return { command, version: output.split(/\r?\n/)[0] || "Stockfish" };
    } catch {}
  }
  return null;
}

const BINARY = detectBinary();

function algebraicToAction(move) {
  const value = String(move || "").trim().toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(value)) return null;
  const col = (char) => char.charCodeAt(0) - 97;
  const row = (char) => 8 - Number(char);
  return {
    kind: "move",
    from: { row: row(value[1]), col: col(value[0]) },
    to: { row: row(value[3]), col: col(value[2]) },
    promotion: value[4] ? value[4].toUpperCase() : "Q",
  };
}

function requestStockfish(state, level) {
  return new Promise((resolveMove, reject) => {
    const child = spawn(BINARY.command, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let buffer = "";
    let settled = false;
    const finish = (error, action) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdin.write("quit\n"); } catch {}
      setTimeout(() => child.kill(), 100).unref?.();
      if (error) reject(error); else resolveMove(action);
    };
    const timer = setTimeout(() => finish(new Error("Stockfish не ответил вовремя")), Math.max(2500, TIME_BY_LEVEL[level] + 1800));
    timer.unref?.();
    child.on("error", (error) => finish(error));
    child.stderr.on("data", () => {});
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const match = /^bestmove\s+(\S+)/.exec(line.trim());
        if (match) {
          const action = algebraicToAction(match[1]);
          if (!action) finish(new Error("Stockfish вернул некорректный ход"));
          else finish(null, action);
          return;
        }
      }
    });
    const elo = ELO_BY_LEVEL[level] || 1400;
    child.stdin.write("uci\n");
    child.stdin.write("setoption name Threads value 1\n");
    child.stdin.write("setoption name Hash value 32\n");
    child.stdin.write(`setoption name Skill Level value ${level}\n`);
    child.stdin.write("setoption name UCI_LimitStrength value true\n");
    child.stdin.write(`setoption name UCI_Elo value ${elo}\n`);
    child.stdin.write("isready\n");
    child.stdin.write(`position fen ${chessStateToFen(state)}\n`);
    child.stdin.write(`go movetime ${TIME_BY_LEVEL[level] || 360}\n`);
  });
}

function materialScore(state, perspective) {
  let score = 0;
  for (const piece of state.board.flat()) {
    if (!piece) continue;
    const value = PIECE_VALUE[piece[1]] || 0;
    score += piece[0] === perspective ? value : -value;
  }
  if (state.status === "finished") {
    if (state.winnerColor === perspective) score += 100000;
    else if (state.winnerColor) score -= 100000;
  }
  return score;
}

function fallbackSearch(state, perspective, depth, alpha = -Infinity, beta = Infinity) {
  if (depth <= 0 || state.status === "finished") return materialScore(state, perspective);
  const moves = listLegalChessMoves(state, state.turn);
  if (!moves.length) return materialScore(state, perspective);
  const maximizing = state.turn === perspective;
  let best = maximizing ? -Infinity : Infinity;
  for (const action of moves) {
    const next = structuredClone(state);
    try { applyChessAction(next, state.turn, action); } catch { continue; }
    const score = fallbackSearch(next, perspective, depth - 1, alpha, beta);
    if (maximizing) { best = Math.max(best, score); alpha = Math.max(alpha, best); }
    else { best = Math.min(best, score); beta = Math.min(beta, best); }
    if (beta <= alpha) break;
  }
  return best;
}

function fallbackMove(state, level) {
  const moves = listLegalChessMoves(state, state.turn);
  if (!moves.length) throw new Error("У бота нет допустимых ходов");
  const depth = level >= 7 ? 3 : level >= 5 ? 2 : 1;
  const perspective = state.turn;
  const rated = moves.map((action) => {
    const next = structuredClone(state);
    applyChessAction(next, perspective, action);
    return { action, score: fallbackSearch(next, perspective, depth - 1) + Math.random() * Math.max(1, 8 - level) * 20 };
  }).sort((a, b) => b.score - a.score);
  const pool = rated.slice(0, Math.max(1, 8 - level));
  return pool[Math.floor(Math.random() * pool.length)].action;
}

export function stockfishStatus() {
  return { available: Boolean(BINARY), binary: BINARY?.command || null, version: BINARY?.version || null, fallback: !BINARY };
}

export async function chooseChessBotMove(state, level = 5) {
  const normalized = Math.max(3, Math.min(7, Math.round(Number(level) || 5)));
  if (BINARY) {
    try { return { action: await requestStockfish(state, normalized), engine: "stockfish", level: normalized, version: BINARY.version }; }
    catch (error) { console.warn(`[Stockfish] ${error.message}; включён встроенный резервный бот`); }
  }
  return { action: fallbackMove(state, normalized), engine: "nemax-fallback", level: normalized, version: "minimax" };
}
