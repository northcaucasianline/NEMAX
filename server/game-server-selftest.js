import assert from "node:assert/strict";
import {
  applyChessAction,
  applyCheckersAction,
  createChessState,
  createCheckersState,
} from "./board-games.js";
import {
  applyPokerAction,
  createTournamentInstance,
  createCashGame,
  ensureWallet,
  evaluateSeven,
  joinTournament,
  joinCashGame,
  publicPokerGame,
  tickPokerGames,
  tournamentCatalog,
  cashCatalog,
} from "./poker-engine.js";

function chessMove(state, color, from, to, promotion) {
  applyChessAction(state, color, { kind: "move", from: { row: from[0], col: from[1] }, to: { row: to[0], col: to[1] }, promotion });
}

// Castling.
const castle = createChessState();
castle.status = "playing";
chessMove(castle, "w", [6, 4], [4, 4]);
chessMove(castle, "b", [1, 0], [2, 0]);
chessMove(castle, "w", [7, 6], [5, 5]);
chessMove(castle, "b", [2, 0], [3, 0]);
chessMove(castle, "w", [7, 5], [6, 4]);
chessMove(castle, "b", [1, 1], [2, 1]);
chessMove(castle, "w", [7, 4], [7, 6]);
assert.equal(castle.board[7][6], "wK");
assert.equal(castle.board[7][5], "wR");
assert.equal(castle.castling.wK, false);

// En passant.
const passant = createChessState();
passant.status = "playing";
chessMove(passant, "w", [6, 4], [4, 4]);
chessMove(passant, "b", [1, 0], [2, 0]);
chessMove(passant, "w", [4, 4], [3, 4]);
chessMove(passant, "b", [1, 3], [3, 3]);
chessMove(passant, "w", [3, 4], [2, 3]);
assert.equal(passant.board[2][3], "wP");
assert.equal(passant.board[3][3], null);
assert.equal(passant.lastMove.enPassant, true);

// Promotion choice.
const promotion = createChessState();
promotion.status = "playing";
promotion.board = Array.from({ length: 8 }, () => Array(8).fill(null));
promotion.board[7][4] = "wK";
promotion.board[0][4] = "bK";
promotion.board[1][0] = "wP";
promotion.turn = "w";
chessMove(promotion, "w", [1, 0], [0, 0], "N");
assert.equal(promotion.board[0][0], "wN");

// Russian flying king capture and backward man capture.
const kingCheckers = createCheckersState();
kingCheckers.status = "playing";
kingCheckers.board = Array.from({ length: 8 }, () => Array(8).fill(null));
kingCheckers.board[5][0] = "W";
kingCheckers.board[3][2] = "b";
applyCheckersAction(kingCheckers, "w", { from: { row: 5, col: 0 }, to: { row: 1, col: 4 } });
assert.equal(kingCheckers.board[1][4], "W");
assert.equal(kingCheckers.board[3][2], null);

const backward = createCheckersState();
backward.status = "playing";
backward.board = Array.from({ length: 8 }, () => Array(8).fill(null));
backward.board[3][2] = "w";
backward.board[4][3] = "b";
applyCheckersAction(backward, "w", { from: { row: 3, col: 2 }, to: { row: 5, col: 4 } });
assert.equal(backward.board[5][4], "w");
assert.equal(backward.board[4][3], null);

// Poker wallet, fixed catalogs and a real server-authoritative tournament hand.
const db = { wallets: [], pokerGames: [] };
const users = [1, 2, 3].map((index) => ({ id: `u${index}`, publicId: 1000 + index, displayName: `Игрок ${index}`, username: `player${index}` }));
assert.equal(ensureWallet(db, users[0].id).wallet.balance, 5000);
assert.equal(ensureWallet(db, users[0].id).dailyAwarded, 0);
const tournament = createTournamentInstance({ capacity: 3, speed: "turbo", buyIn: 100 });
db.pokerGames.push(tournament);
for (const user of users) joinTournament(db, tournament, user);
assert.equal(tournament.status, "running");
assert.equal(tournament.players.length, 3);
assert.equal(ensureWallet(db, users[0].id).wallet.balance, 4900);
tickPokerGames(db, Date.now() + 5000);
assert.ok(tournament.tables[0].hand, "Первая раздача должна стартовать");
let guard = 0;
while (tournament.tables[0].hand && guard < 10) {
  guard += 1;
  const actor = tournament.tables[0].hand.actorUserId;
  applyPokerAction(tournament, actor, { kind: "fold" });
}
assert.ok(tournament.tables[0].lastHand?.winners?.length === 1);
assert.equal(tournamentCatalog(db, users[0].id).length, 5 * 2 * 6);
assert.equal(cashCatalog(db, users[0].id).length, 6);


// Multi-table tournament: 16 players must be split into two tables of at most 8.
const multiDb = { wallets: [], pokerGames: [] };
const multiUsers = Array.from({ length: 16 }, (_, index) => ({
  id: `m${index + 1}`, publicId: 2001 + index, displayName: `Мульти ${index + 1}`, username: `multi${index + 1}`,
}));
const multiTournament = createTournamentInstance({ capacity: 16, speed: "normal", buyIn: 50 });
multiDb.pokerGames.push(multiTournament);
for (const user of multiUsers) joinTournament(multiDb, multiTournament, user);
assert.equal(multiTournament.status, "running");
assert.equal(multiTournament.tables.length, 2);
assert.ok(multiTournament.tables.every((table) => table.playerIds.length <= 8));
tickPokerGames(multiDb, Date.now() + 5000);
assert.ok(multiTournament.tables.every((table) => table.hand), "На обоих турнирных столах должны стартовать раздачи");
const multiPublic = publicPokerGame(multiTournament, multiUsers[0].id);
const myTable = multiPublic.myTable;
assert.ok(myTable?.hand?.hands?.[multiUsers[0].id]?.every((card) => !card.hidden));
const opponentId = Object.keys(myTable.hand.hands).find((id) => id !== multiUsers[0].id);
assert.ok(myTable.hand.hands[opponentId].every((card) => card.hidden), "Карты соперника должны быть скрыты");


// Maximum configured tournament size: 100 players must create 13 tables.
const hundredDb = { wallets: [], pokerGames: [] };
const hundred = createTournamentInstance({ capacity: 100, speed: "turbo", buyIn: 50 });
hundredDb.pokerGames.push(hundred);
for (let index = 1; index <= 100; index += 1) {
  joinTournament(hundredDb, hundred, { id: `h${index}`, publicId: 4000 + index, displayName: `Сотня ${index}`, username: `hundred${index}` });
}
assert.equal(hundred.status, "running");
assert.equal(hundred.tables.length, 13);
assert.ok(hundred.tables.every((table) => table.playerIds.length >= 2 && table.playerIds.length <= 8));

// Cash table: exact 50/100 blinds, buy-in range and hidden cards.
const cashDb = { wallets: [], pokerGames: [] };
const cashUsers = [1, 2].map((index) => ({ id: `c${index}`, publicId: 3000 + index, displayName: `Кэш ${index}`, username: `cash${index}` }));
const cash = createCashGame({ blinds: { smallBlind: 50, bigBlind: 100 } });
cashDb.pokerGames.push(cash);
joinCashGame(cashDb, cash, cashUsers[0], 2000);
joinCashGame(cashDb, cash, cashUsers[1], 2000);
assert.equal(ensureWallet(cashDb, cashUsers[0].id).wallet.balance, 3000);
tickPokerGames(cashDb, Date.now() + 5000);
assert.ok(cash.tables[0].hand, "Кэш-раздача должна стартовать");
const cashPublic = publicPokerGame(cash, cashUsers[0].id);
assert.deepEqual(cashPublic.blinds, { smallBlind: 50, bigBlind: 100 });
assert.ok(cashPublic.tables[0].hand.hands[cashUsers[1].id].every((card) => card.hidden));

const royal = evaluateSeven([
  { rank: 14, suit: "s" }, { rank: 13, suit: "s" }, { rank: 12, suit: "s" },
  { rank: 11, suit: "s" }, { rank: 10, suit: "s" }, { rank: 2, suit: "h" }, { rank: 3, suit: "d" },
]);
assert.equal(royal.name, "Роял-флеш");

console.log("Game Server self-test: OK");
console.log("- chess castling/en-passant/promotion: OK");
console.log("- Russian checkers flying kings/backward capture: OK");
console.log("- daily 5,000 play chips and 60 tournament presets: OK");
console.log("- 3/16/100-player tournaments, hidden cards and cash 50/100: OK");
console.log("- tournament hand and poker evaluator: OK");
