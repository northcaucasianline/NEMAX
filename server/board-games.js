import { randomUUID } from "node:crypto";
const now = () => Date.now();
const clone = (value) => JSON.parse(JSON.stringify(value));
const inBounds = (row, col) => Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < 8 && col >= 0 && col < 8;
const opposite = (color) => color === "w" ? "b" : "w";

function emptyBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill(null));
}

export function createChessBoard() {
  const board = emptyBoard();
  board[0] = ["bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR"];
  board[1] = Array(8).fill("bP");
  board[6] = Array(8).fill("wP");
  board[7] = ["wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"];
  return board;
}

function pathClear(board, from, to) {
  const rowStep = Math.sign(to.row - from.row);
  const colStep = Math.sign(to.col - from.col);
  let row = from.row + rowStep;
  let col = from.col + colStep;
  while (row !== to.row || col !== to.col) {
    if (board[row][col]) return false;
    row += rowStep;
    col += colStep;
  }
  return true;
}

function findKing(board, color) {
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) if (board[row][col] === `${color}K`) return { row, col };
  }
  return null;
}

function rawPieceAttacks(board, from, to, color) {
  if (!inBounds(from.row, from.col) || !inBounds(to.row, to.col)) return false;
  const piece = board[from.row][from.col];
  if (!piece || piece[0] !== color) return false;
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const absR = Math.abs(dr);
  const absC = Math.abs(dc);
  switch (piece[1]) {
    case "P": return dr === (color === "w" ? -1 : 1) && absC === 1;
    case "N": return (absR === 2 && absC === 1) || (absR === 1 && absC === 2);
    case "B": return absR === absC && pathClear(board, from, to);
    case "R": return (dr === 0 || dc === 0) && pathClear(board, from, to);
    case "Q": return (dr === 0 || dc === 0 || absR === absC) && pathClear(board, from, to);
    case "K": return Math.max(absR, absC) === 1;
    default: return false;
  }
}

function squareAttacked(board, square, byColor) {
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (board[row][col]?.[0] === byColor && rawPieceAttacks(board, { row, col }, square, byColor)) return true;
    }
  }
  return false;
}

function castleInfo(state, from, to, color) {
  const homeRow = color === "w" ? 7 : 0;
  if (from.row !== homeRow || from.col !== 4 || to.row !== homeRow || ![2, 6].includes(to.col)) return null;
  if (state.board[from.row][from.col] !== `${color}K`) return null;
  const side = to.col === 6 ? "K" : "Q";
  const rightKey = `${color}${side}`;
  if (!state.castling?.[rightKey]) return null;
  const rookCol = side === "K" ? 7 : 0;
  const rookTargetCol = side === "K" ? 5 : 3;
  if (state.board[homeRow][rookCol] !== `${color}R`) return null;
  const clearCols = side === "K" ? [5, 6] : [1, 2, 3];
  if (clearCols.some((col) => state.board[homeRow][col])) return null;
  if (squareAttacked(state.board, { row: homeRow, col: 4 }, opposite(color))) return null;
  const passCols = side === "K" ? [5, 6] : [3, 2];
  if (passCols.some((col) => squareAttacked(state.board, { row: homeRow, col }, opposite(color)))) return null;
  return { side, rookFrom: { row: homeRow, col: rookCol }, rookTo: { row: homeRow, col: rookTargetCol } };
}

function pseudoChessMove(state, from, to, color, promotion = "Q") {
  const board = state.board;
  if (!inBounds(from.row, from.col) || !inBounds(to.row, to.col) || (from.row === to.row && from.col === to.col)) return null;
  const piece = board[from.row][from.col];
  const target = board[to.row][to.col];
  if (!piece || piece[0] !== color || target?.[0] === color || target?.[1] === "K") return null;
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const absR = Math.abs(dr);
  const absC = Math.abs(dc);
  const type = piece[1];
  if (type === "K" && absR === 0 && absC === 2) {
    const castle = castleInfo(state, from, to, color);
    return castle ? { piece, target, castle, promotion: null, enPassantCapture: null } : null;
  }
  if (type === "P") {
    const direction = color === "w" ? -1 : 1;
    const startRow = color === "w" ? 6 : 1;
    let enPassantCapture = null;
    if (dc === 0 && dr === direction && !target) {
      // normal single step
    } else if (dc === 0 && from.row === startRow && dr === direction * 2 && !target && !board[from.row + direction][from.col]) {
      // double step
    } else if (absC === 1 && dr === direction && target?.[0] === opposite(color)) {
      // normal capture
    } else if (absC === 1 && dr === direction && !target && state.enPassant?.row === to.row && state.enPassant?.col === to.col) {
      const captured = { row: from.row, col: to.col };
      if (board[captured.row]?.[captured.col] !== `${opposite(color)}P`) return null;
      enPassantCapture = captured;
    } else return null;
    const promotes = to.row === 0 || to.row === 7;
    const normalizedPromotion = ["Q", "R", "B", "N"].includes(String(promotion || "Q").toUpperCase()) ? String(promotion || "Q").toUpperCase() : "Q";
    return { piece, target, castle: null, promotion: promotes ? normalizedPromotion : null, enPassantCapture };
  }
  if (type === "N" && !((absR === 2 && absC === 1) || (absR === 1 && absC === 2))) return null;
  if (type === "B" && !(absR === absC && pathClear(board, from, to))) return null;
  if (type === "R" && !((dr === 0 || dc === 0) && pathClear(board, from, to))) return null;
  if (type === "Q" && !((dr === 0 || dc === 0 || absR === absC) && pathClear(board, from, to))) return null;
  if (type === "K" && Math.max(absR, absC) !== 1) return null;
  return { piece, target, castle: null, promotion: null, enPassantCapture: null };
}

function applyChessMoveToState(state, from, to, info, color, { record = true } = {}) {
  const board = state.board;
  const moving = info.piece;
  const captured = info.enPassantCapture ? board[info.enPassantCapture.row][info.enPassantCapture.col] : board[to.row][to.col];
  board[to.row][to.col] = info.promotion ? `${color}${info.promotion}` : moving;
  board[from.row][from.col] = null;
  if (info.enPassantCapture) board[info.enPassantCapture.row][info.enPassantCapture.col] = null;
  if (info.castle) {
    board[info.castle.rookTo.row][info.castle.rookTo.col] = board[info.castle.rookFrom.row][info.castle.rookFrom.col];
    board[info.castle.rookFrom.row][info.castle.rookFrom.col] = null;
  }

  if (moving[1] === "K") {
    state.castling[`${color}K`] = false;
    state.castling[`${color}Q`] = false;
  }
  if (moving[1] === "R") {
    if (from.row === 7 && from.col === 0) state.castling.wQ = false;
    if (from.row === 7 && from.col === 7) state.castling.wK = false;
    if (from.row === 0 && from.col === 0) state.castling.bQ = false;
    if (from.row === 0 && from.col === 7) state.castling.bK = false;
  }
  if (captured?.[1] === "R") {
    if (to.row === 7 && to.col === 0) state.castling.wQ = false;
    if (to.row === 7 && to.col === 7) state.castling.wK = false;
    if (to.row === 0 && to.col === 0) state.castling.bQ = false;
    if (to.row === 0 && to.col === 7) state.castling.bK = false;
  }

  state.enPassant = null;
  if (moving[1] === "P" && Math.abs(to.row - from.row) === 2) state.enPassant = { row: (from.row + to.row) / 2, col: from.col };
  state.halfmoveClock = moving[1] === "P" || captured ? 0 : Number(state.halfmoveClock || 0) + 1;
  if (color === "b") state.fullmoveNumber = Number(state.fullmoveNumber || 1) + 1;
  if (record) {
    const move = {
      from, to, piece: moving, captured: captured || null,
      castle: info.castle?.side || null,
      enPassant: Boolean(info.enPassantCapture),
      promotion: info.promotion || null,
      at: now(),
    };
    state.lastMove = move;
    state.history.push(move);
  }
}

function legalChessMove(state, from, to, color, promotion = "Q") {
  const info = pseudoChessMove(state, from, to, color, promotion);
  if (!info) return null;
  const next = clone(state);
  applyChessMoveToState(next, from, to, info, color, { record: false });
  const king = findKing(next.board, color);
  if (!king || squareAttacked(next.board, king, opposite(color))) return null;
  return info;
}

function hasAnyChessMove(state, color) {
  for (let fromRow = 0; fromRow < 8; fromRow += 1) {
    for (let fromCol = 0; fromCol < 8; fromCol += 1) {
      if (state.board[fromRow][fromCol]?.[0] !== color) continue;
      for (let toRow = 0; toRow < 8; toRow += 1) {
        for (let toCol = 0; toCol < 8; toCol += 1) {
          if (legalChessMove(state, { row: fromRow, col: fromCol }, { row: toRow, col: toCol }, color)) return true;
        }
      }
    }
  }
  return false;
}

function chessPositionKey(state) {
  return `${state.board.flat().map((piece) => piece || "--").join("")}|${state.turn}|${Object.entries(state.castling).filter(([, value]) => value).map(([key]) => key).sort().join("")}|${state.enPassant ? `${state.enPassant.row},${state.enPassant.col}` : "-"}`;
}

function insufficientMaterial(board) {
  const pieces = [];
  for (let row = 0; row < 8; row += 1) for (let col = 0; col < 8; col += 1) if (board[row][col]) pieces.push({ piece: board[row][col], row, col });
  const nonKings = pieces.filter((item) => item.piece[1] !== "K");
  if (!nonKings.length) return true;
  if (nonKings.length === 1 && ["B", "N"].includes(nonKings[0].piece[1])) return true;
  if (nonKings.every((item) => item.piece[1] === "B")) {
    const colors = new Set(nonKings.map((item) => (item.row + item.col) % 2));
    return colors.size === 1;
  }
  return false;
}

export function createChessState() {
  const state = {
    status: "waiting", board: createChessBoard(), turn: "w", history: [], moveNumber: 1,
    check: false, winnerColor: null, draw: false, drawReason: null,
    castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null,
    halfmoveClock: 0, fullmoveNumber: 1, positionCounts: {}, lastMove: null,
  };
  const key = chessPositionKey(state);
  state.positionCounts[key] = 1;
  return state;
}

export function applyChessAction(state, playerColor, action) {
  if (state.status !== "playing") throw new Error("Партия ещё не началась или уже завершена");
  if (state.turn !== playerColor) throw new Error("Сейчас ход соперника");
  const from = { row: Number(action.from?.row), col: Number(action.from?.col) };
  const to = { row: Number(action.to?.row), col: Number(action.to?.col) };
  const promotion = String(action.promotion || "Q").toUpperCase();
  const info = legalChessMove(state, from, to, playerColor, promotion);
  if (!info) throw new Error("Недопустимый ход");
  applyChessMoveToState(state, from, to, info, playerColor);
  state.turn = opposite(playerColor);
  state.moveNumber = Number(state.moveNumber || 1) + 1;
  const enemyKing = findKing(state.board, state.turn);
  state.check = Boolean(enemyKing && squareAttacked(state.board, enemyKing, playerColor));
  const positionKey = chessPositionKey(state);
  state.positionCounts[positionKey] = Number(state.positionCounts[positionKey] || 0) + 1;

  if (!hasAnyChessMove(state, state.turn)) {
    state.status = "finished";
    if (state.check) state.winnerColor = playerColor;
    else { state.draw = true; state.drawReason = "Пат"; }
  } else if (state.halfmoveClock >= 100) {
    state.status = "finished"; state.draw = true; state.drawReason = "Правило 50 ходов";
  } else if (state.positionCounts[positionKey] >= 3) {
    state.status = "finished"; state.draw = true; state.drawReason = "Троекратное повторение позиции";
  } else if (insufficientMaterial(state.board)) {
    state.status = "finished"; state.draw = true; state.drawReason = "Недостаточно материала для мата";
  }
  return state;
}


export function listLegalChessMoves(state, color = state.turn) {
  const moves = [];
  for (let fromRow = 0; fromRow < 8; fromRow += 1) {
    for (let fromCol = 0; fromCol < 8; fromCol += 1) {
      const piece = state.board[fromRow][fromCol];
      if (piece?.[0] !== color) continue;
      for (let toRow = 0; toRow < 8; toRow += 1) {
        for (let toCol = 0; toCol < 8; toCol += 1) {
          const promotions = piece[1] === "P" && (toRow === 0 || toRow === 7) ? ["Q", "R", "B", "N"] : ["Q"];
          for (const promotion of promotions) {
            if (legalChessMove(state, { row: fromRow, col: fromCol }, { row: toRow, col: toCol }, color, promotion)) {
              moves.push({ kind: "move", from: { row: fromRow, col: fromCol }, to: { row: toRow, col: toCol }, promotion });
            }
          }
        }
      }
    }
  }
  return moves;
}

export function chessStateToFen(state) {
  const pieceMap = { wP: "P", wN: "N", wB: "B", wR: "R", wQ: "Q", wK: "K", bP: "p", bN: "n", bB: "b", bR: "r", bQ: "q", bK: "k" };
  const board = state.board.map((row) => {
    let result = "";
    let empty = 0;
    for (const piece of row) {
      if (!piece) { empty += 1; continue; }
      if (empty) { result += String(empty); empty = 0; }
      result += pieceMap[piece] || "";
    }
    if (empty) result += String(empty);
    return result;
  }).join("/");
  const castling = [state.castling?.wK && "K", state.castling?.wQ && "Q", state.castling?.bK && "k", state.castling?.bQ && "q"].filter(Boolean).join("") || "-";
  const enPassant = state.enPassant ? `${String.fromCharCode(97 + state.enPassant.col)}${8 - state.enPassant.row}` : "-";
  return `${board} ${state.turn || "w"} ${castling} ${enPassant} ${Number(state.halfmoveClock || 0)} ${Number(state.fullmoveNumber || 1)}`;
}

export function createCheckersBoard() {
  const board = emptyBoard();
  for (let row = 0; row < 3; row += 1) for (let col = 0; col < 8; col += 1) if ((row + col) % 2 === 1) board[row][col] = "b";
  for (let row = 5; row < 8; row += 1) for (let col = 0; col < 8; col += 1) if ((row + col) % 2 === 1) board[row][col] = "w";
  return board;
}

const checkerColor = (piece) => String(piece || "").toLowerCase() || null;
const checkerIsKing = (piece) => Boolean(piece && piece === piece.toUpperCase());

function manCapturesFrom(board, row, col) {
  const piece = board[row]?.[col];
  if (!piece) return [];
  const color = checkerColor(piece);
  const results = [];
  for (const dr of [-1, 1]) for (const dc of [-1, 1]) {
    const victim = { row: row + dr, col: col + dc };
    const to = { row: row + dr * 2, col: col + dc * 2 };
    if (!inBounds(to.row, to.col) || board[to.row][to.col]) continue;
    const victimPiece = board[victim.row]?.[victim.col];
    if (victimPiece && checkerColor(victimPiece) !== color) results.push({ from: { row, col }, to, captured: victim });
  }
  return results;
}

function kingCapturesFrom(board, row, col) {
  const piece = board[row]?.[col];
  if (!piece) return [];
  const color = checkerColor(piece);
  const results = [];
  for (const dr of [-1, 1]) for (const dc of [-1, 1]) {
    let cursorRow = row + dr;
    let cursorCol = col + dc;
    let victim = null;
    while (inBounds(cursorRow, cursorCol)) {
      const current = board[cursorRow][cursorCol];
      if (!victim) {
        if (!current) {
          cursorRow += dr; cursorCol += dc; continue;
        }
        if (checkerColor(current) === color) break;
        victim = { row: cursorRow, col: cursorCol };
        cursorRow += dr; cursorCol += dc;
        continue;
      }
      if (current) break;
      results.push({ from: { row, col }, to: { row: cursorRow, col: cursorCol }, captured: victim });
      cursorRow += dr; cursorCol += dc;
    }
  }
  return results;
}

function checkerCapturesFrom(board, row, col) {
  const piece = board[row]?.[col];
  if (!piece) return [];
  return checkerIsKing(piece) ? kingCapturesFrom(board, row, col) : manCapturesFrom(board, row, col);
}

function allCheckerCaptures(board, color) {
  const results = [];
  for (let row = 0; row < 8; row += 1) for (let col = 0; col < 8; col += 1) {
    if (checkerColor(board[row][col]) === color) results.push(...checkerCapturesFrom(board, row, col));
  }
  return results;
}

function normalCheckerMovesFrom(board, row, col) {
  const piece = board[row]?.[col];
  if (!piece) return [];
  const color = checkerColor(piece);
  const results = [];
  if (checkerIsKing(piece)) {
    for (const dr of [-1, 1]) for (const dc of [-1, 1]) {
      let toRow = row + dr; let toCol = col + dc;
      while (inBounds(toRow, toCol) && !board[toRow][toCol]) {
        results.push({ from: { row, col }, to: { row: toRow, col: toCol }, captured: null });
        toRow += dr; toCol += dc;
      }
    }
  } else {
    const dr = color === "w" ? -1 : 1;
    for (const dc of [-1, 1]) if (inBounds(row + dr, col + dc) && !board[row + dr][col + dc]) results.push({ from: { row, col }, to: { row: row + dr, col: col + dc }, captured: null });
  }
  return results;
}

function hasAnyCheckerMove(board, color) {
  if (allCheckerCaptures(board, color).length) return true;
  for (let row = 0; row < 8; row += 1) for (let col = 0; col < 8; col += 1) {
    if (checkerColor(board[row][col]) === color && normalCheckerMovesFrom(board, row, col).length) return true;
  }
  return false;
}

export function createCheckersState() {
  return {
    status: "waiting", board: createCheckersBoard(), turn: "w", history: [], forcedPiece: null,
    winnerColor: null, draw: false, drawReason: null, quietKingMoves: 0, lastMove: null,
  };
}

export function applyCheckersAction(state, playerColor, action) {
  if (state.status !== "playing") throw new Error("Партия ещё не началась или уже завершена");
  if (state.turn !== playerColor) throw new Error("Сейчас ход соперника");
  const from = { row: Number(action.from?.row), col: Number(action.from?.col) };
  const to = { row: Number(action.to?.row), col: Number(action.to?.col) };
  if (!inBounds(from.row, from.col) || !inBounds(to.row, to.col)) throw new Error("Клетка вне доски");
  if (state.forcedPiece && (state.forcedPiece.row !== from.row || state.forcedPiece.col !== from.col)) throw new Error("Нужно продолжить взятие этой же шашкой");
  const piece = state.board[from.row][from.col];
  if (checkerColor(piece) !== playerColor || state.board[to.row][to.col]) throw new Error("Недопустимый ход");

  const captures = allCheckerCaptures(state.board, playerColor);
  const allowed = captures.length ? checkerCapturesFrom(state.board, from.row, from.col) : normalCheckerMovesFrom(state.board, from.row, from.col);
  const move = allowed.find((item) => item.to.row === to.row && item.to.col === to.col);
  if (!move) throw new Error(captures.length ? "Взятие обязательно" : "Недопустимый ход шашки");

  state.board[to.row][to.col] = piece;
  state.board[from.row][from.col] = null;
  if (move.captured) state.board[move.captured.row][move.captured.col] = null;
  if (piece === "w" && to.row === 0) state.board[to.row][to.col] = "W";
  if (piece === "b" && to.row === 7) state.board[to.row][to.col] = "B";

  state.lastMove = { from, to, captured: move.captured || null, promoted: state.board[to.row][to.col] !== piece, at: now() };
  state.history.push(state.lastMove);
  if (move.captured || !checkerIsKing(piece)) state.quietKingMoves = 0;
  else state.quietKingMoves = Number(state.quietKingMoves || 0) + 1;

  const further = move.captured ? checkerCapturesFrom(state.board, to.row, to.col) : [];
  if (further.length) state.forcedPiece = to;
  else {
    state.forcedPiece = null;
    state.turn = opposite(playerColor);
    if (!hasAnyCheckerMove(state.board, state.turn)) {
      state.status = "finished";
      state.winnerColor = playerColor;
    } else if (state.quietKingMoves >= 30) {
      state.status = "finished";
      state.draw = true;
      state.drawReason = "30 ходов дамками без взятия";
    }
  }
  return state;
}

export function createBoardTable({ type, title, host, botLevel = null }) {
  if (!["chess", "checkers"].includes(type)) throw new Error("Неизвестная настольная игра");
  const table = {
    id: randomUUID(), type, title: String(title || "").trim().slice(0, 80) || (type === "chess" ? "Шахматный стол" : "Стол для шашек"),
    hostId: host.id, maxPlayers: 2,
    players: [{ userId: host.id, user: host, seat: 0, color: "w", joinedAt: now() }],
    spectators: [], createdAt: now(), updatedAt: now(), deletedAt: null,
    state: type === "chess" ? createChessState() : createCheckersState(),
    bot: null,
  };
  const level = Number(botLevel);
  if (type === "chess" && Number.isInteger(level) && level >= 3 && level <= 7) {
    const botId = `stockfish-level-${level}`;
    const botUser = { id: botId, username: `stockfish_${level}`, displayName: `Stockfish ${level}`, avatar: "", avatarColor: "#6d56d8", status: "online", statusEmoji: "♟", isBot: true };
    table.players.push({ userId: botId, user: botUser, seat: 1, color: "b", joinedAt: now(), isBot: true });
    table.bot = { userId: botId, level, color: "b", engine: "stockfish", thinking: false };
    table.state.status = "playing";
  }
  return table;
}

export function joinBoardTable(table, user) {
  if (table.bot) throw new Error("Это партия против шахматного бота");
  if (table.players.some((player) => player.userId === user.id)) return table;
  if (table.players.length >= 2) throw new Error("За столом нет свободного места");
  if (table.state.status === "playing") throw new Error("Партия уже началась");
  table.players.push({ userId: user.id, user, seat: 1, color: "b", joinedAt: now() });
  table.state.status = "playing";
  table.updatedAt = now();
  return table;
}

export function leaveBoardTable(table, userId) {
  const player = table.players.find((item) => item.userId === userId);
  if (!player) return table;
  table.players = table.players.filter((item) => item.userId !== userId);
  if (table.state.status === "playing") {
    table.state.status = "finished";
    table.state.winnerColor = opposite(player.color);
  }
  if (table.hostId === userId) table.hostId = table.players[0]?.userId || null;
  table.updatedAt = now();
  return table;
}

export function applyBoardTableAction(table, userId, action) {
  const player = table.players.find((item) => item.userId === userId);
  if (!player) throw new Error("Вы не участвуете в этой партии");
  if (action.kind === "restart") {
    if (table.hostId !== userId) throw new Error("Новую партию запускает создатель стола");
    table.state = table.type === "chess" ? createChessState() : createCheckersState();
    table.state.status = table.players.length === 2 ? "playing" : "waiting";
  } else if (table.type === "chess") applyChessAction(table.state, player.color, action);
  else applyCheckersAction(table.state, player.color, action);
  table.updatedAt = now();
  return table;
}

export function publicBoardTable(table, userId) {
  return {
    ...clone(table),
    isParticipant: table.players.some((player) => player.userId === userId),
    myPlayer: clone(table.players.find((player) => player.userId === userId) || null),
  };
}

export function summarizeBoardTable(table) {
  return {
    id: table.id, type: table.type, title: table.title, hostId: table.hostId, maxPlayers: 2,
    playerCount: table.players.length, status: table.state.status, updatedAt: table.updatedAt, createdAt: table.createdAt, bot: clone(table.bot || null),
    players: clone(table.players),
  };
}
