import { randomInt, randomUUID } from "node:crypto";

const now = () => Date.now();
const clone = (value) => JSON.parse(JSON.stringify(value));
const unique = (items) => [...new Set(items)];

export const DAILY_CHIP_BONUS = 5000;
export const TOURNAMENT_SIZES = [3, 8, 16, 50, 100];
export const TOURNAMENT_BUY_INS = [50, 100, 500, 1000, 5000, 10000];
export const TOURNAMENT_SPEEDS = ["normal", "turbo"];
export const CASH_BLINDS = [
  { smallBlind: 50, bigBlind: 100 },
  { smallBlind: 100, bigBlind: 200 },
  { smallBlind: 250, bigBlind: 500 },
  { smallBlind: 500, bigBlind: 1000 },
  { smallBlind: 1000, bigBlind: 2000 },
  { smallBlind: 2500, bigBlind: 5000 },
];

const SUITS = ["s", "h", "d", "c"];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function utcDay(timestamp = now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function ensureWallet(db, userId) {
  db.wallets ||= [];
  let wallet = db.wallets.find((item) => item.userId === userId);
  if (!wallet) {
    wallet = { userId, balance: 0, lastDailyBonusDay: "", lifetimeWon: 0, lifetimeSpent: 0, createdAt: now(), updatedAt: now() };
    db.wallets.push(wallet);
  }
  const today = utcDay();
  let dailyAwarded = 0;
  if (wallet.lastDailyBonusDay !== today) {
    wallet.balance += DAILY_CHIP_BONUS;
    wallet.lastDailyBonusDay = today;
    wallet.updatedAt = now();
    dailyAwarded = DAILY_CHIP_BONUS;
  }
  return { wallet, dailyAwarded };
}

export function publicWallet(wallet) {
  return {
    balance: Math.max(0, Math.floor(Number(wallet.balance || 0))),
    lastDailyBonusDay: wallet.lastDailyBonusDay || "",
    dailyBonus: DAILY_CHIP_BONUS,
    lifetimeWon: Math.max(0, Math.floor(Number(wallet.lifetimeWon || 0))),
    lifetimeSpent: Math.max(0, Math.floor(Number(wallet.lifetimeSpent || 0))),
  };
}

function makeDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function combinations(items, count) {
  const result = [];
  const walk = (start, chosen) => {
    if (chosen.length === count) { result.push(chosen); return; }
    for (let index = start; index <= items.length - (count - chosen.length); index += 1) walk(index + 1, [...chosen, items[index]]);
  };
  walk(0, []);
  return result;
}

function evaluateFive(cards) {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const uniqueRanks = [...new Set(ranks)];
  if (uniqueRanks[0] === 14) uniqueRanks.push(1);
  let straightHigh = 0;
  for (let index = 0; index <= uniqueRanks.length - 5; index += 1) {
    if (uniqueRanks[index] - uniqueRanks[index + 4] === 4) { straightHigh = uniqueRanks[index]; break; }
  }
  if (flush && straightHigh) return { score: [8, straightHigh], name: straightHigh === 14 ? "Роял-флеш" : "Стрит-флеш" };
  if (groups[0][1] === 4) return { score: [7, groups[0][0], groups[1][0]], name: "Каре" };
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) return { score: [6, groups[0][0], groups[1][0]], name: "Фулл-хаус" };
  if (flush) return { score: [5, ...ranks], name: "Флеш" };
  if (straightHigh) return { score: [4, straightHigh], name: "Стрит" };
  if (groups[0][1] === 3) return { score: [3, groups[0][0], ...groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)], name: "Тройка" };
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return { score: [2, ...pairs, groups.find((group) => group[1] === 1)?.[0] || 0], name: "Две пары" };
  }
  if (groups[0][1] === 2) return { score: [1, groups[0][0], ...groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)], name: "Пара" };
  return { score: [0, ...ranks], name: "Старшая карта" };
}

function compareScores(left, right) {
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const difference = Number(left[index] || 0) - Number(right[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

export function evaluateSeven(cards) {
  let best = null;
  for (const hand of combinations(cards, 5)) {
    const current = evaluateFive(hand);
    if (!best || compareScores(current.score, best.score) > 0) best = { ...current, cards: hand };
  }
  return best;
}

function nextSeatPlayer(table, fromSeat, predicate = () => true) {
  const sorted = table.playerIds
    .map((userId) => table.gamePlayersById[userId])
    .filter(Boolean)
    .sort((a, b) => a.seat - b.seat);
  if (!sorted.length) return null;
  for (let step = 1; step <= table.maxSeats; step += 1) {
    const seat = (fromSeat + step) % table.maxSeats;
    const player = sorted.find((item) => item.seat === seat && predicate(item));
    if (player) return player;
  }
  return null;
}

function orderedPlayersFrom(table, fromSeat, predicate = () => true) {
  const result = [];
  let cursor = fromSeat;
  const seen = new Set();
  while (seen.size < table.maxSeats) {
    const player = nextSeatPlayer(table, cursor, (item) => predicate(item) && !seen.has(item.seat));
    if (!player) break;
    result.push(player);
    seen.add(player.seat);
    cursor = player.seat;
  }
  return result;
}

function eligibleForHand(player) {
  return player && player.status === "active" && !player.sitOut && Number(player.stack || 0) > 0;
}

function activeInHand(hand, userId) {
  return Boolean(hand.hands[userId]) && !hand.folded.includes(userId);
}

function canAct(hand, player) {
  return activeInHand(hand, player.userId) && !hand.allIn.includes(player.userId) && Number(player.stack || 0) > 0;
}

function amountToCall(hand, userId) {
  return Math.max(0, Number(hand.currentBet || 0) - Number(hand.streetBets[userId] || 0));
}

function commitChips(hand, player, amount) {
  const paid = Math.max(0, Math.min(Number(player.stack || 0), Math.floor(Number(amount || 0))));
  player.stack -= paid;
  hand.streetBets[player.userId] = Number(hand.streetBets[player.userId] || 0) + paid;
  hand.totalBets[player.userId] = Number(hand.totalBets[player.userId] || 0) + paid;
  if (player.stack === 0 && !hand.allIn.includes(player.userId)) hand.allIn.push(player.userId);
  return paid;
}

function sanitizePending(hand, table) {
  hand.pending = unique((hand.pending || []).filter((userId) => {
    const player = table.gamePlayersById[userId];
    return player && canAct(hand, player);
  }));
}

function chooseActor(table, hand, afterSeat) {
  sanitizePending(hand, table);
  if (!hand.pending.length) return null;
  const player = nextSeatPlayer(table, afterSeat, (item) => hand.pending.includes(item.userId) && canAct(hand, item));
  return player || table.gamePlayersById[hand.pending[0]] || null;
}

function setActor(table, hand, afterSeat) {
  const player = chooseActor(table, hand, afterSeat);
  hand.actorUserId = player?.userId || null;
  hand.actionDeadline = player ? now() + Number(table.actionTimeMs || 30_000) : 0;
}

function createHand(table, game, blinds) {
  const participants = table.playerIds.map((id) => game.players.find((item) => item.userId === id)).filter(eligibleForHand);
  if (participants.length < 2) return null;
  table.gamePlayersById = Object.fromEntries(game.players.map((item) => [item.userId, item]));
  const previousDealerSeat = Number.isInteger(table.dealerSeat) ? table.dealerSeat : participants[participants.length - 1].seat;
  const dealer = nextSeatPlayer(table, previousDealerSeat, eligibleForHand);
  table.dealerSeat = dealer.seat;
  const headsUp = participants.length === 2;
  const smallBlindPlayer = headsUp ? dealer : nextSeatPlayer(table, dealer.seat, eligibleForHand);
  const bigBlindPlayer = nextSeatPlayer(table, smallBlindPlayer.seat, eligibleForHand);
  const deck = shuffle(makeDeck());
  const hands = {};
  for (const player of participants) hands[player.userId] = [deck.pop(), deck.pop()];
  const hand = {
    id: randomUUID(), number: Number(table.handNumber || 0) + 1, status: "playing", street: "preflop",
    deck, community: [], hands, folded: [], allIn: [], streetBets: {}, totalBets: {},
    currentBet: 0, minRaise: blinds.bigBlind, pending: participants.map((item) => item.userId), actorUserId: null,
    dealerUserId: dealer.userId, smallBlindUserId: smallBlindPlayer.userId, bigBlindUserId: bigBlindPlayer.userId,
    smallBlind: blinds.smallBlind, bigBlind: blinds.bigBlind, actionDeadline: 0,
    actions: [], pots: [], results: [], winners: [], createdAt: now(), completedAt: null,
  };
  for (const player of participants) {
    hand.streetBets[player.userId] = 0;
    hand.totalBets[player.userId] = 0;
  }
  commitChips(hand, smallBlindPlayer, blinds.smallBlind);
  commitChips(hand, bigBlindPlayer, blinds.bigBlind);
  hand.currentBet = Math.max(hand.streetBets[smallBlindPlayer.userId], hand.streetBets[bigBlindPlayer.userId]);
  table.handNumber = hand.number;
  const firstActor = headsUp ? dealer : nextSeatPlayer(table, bigBlindPlayer.seat, (item) => canAct(hand, item));
  hand.actorUserId = firstActor?.userId || null;
  hand.actionDeadline = firstActor ? now() + Number(table.actionTimeMs || 30_000) : 0;
  return hand;
}

function remainingContenders(hand) {
  return Object.keys(hand.hands).filter((userId) => !hand.folded.includes(userId));
}

function buildPots(hand) {
  const levels = [...new Set(Object.values(hand.totalBets).map(Number).filter((value) => value > 0))].sort((a, b) => a - b);
  const pots = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = Object.entries(hand.totalBets).filter(([, amount]) => Number(amount) >= level).map(([userId]) => userId);
    const amount = (level - previous) * contributors.length;
    if (amount > 0) pots.push({ amount, eligible: contributors.filter((userId) => !hand.folded.includes(userId)), winners: [] });
    previous = level;
  }
  return pots;
}

function awardSingleRemaining(game, table, hand) {
  const winnerId = remainingContenders(hand)[0];
  const amount = Object.values(hand.totalBets).reduce((sum, value) => sum + Number(value || 0), 0);
  const winner = game.players.find((item) => item.userId === winnerId);
  if (winner) winner.stack += amount;
  hand.pots = [{ amount, eligible: [winnerId], winners: [winnerId] }];
  hand.winners = [winnerId];
  hand.results = winner ? [{ userId: winnerId, handName: "Победа без вскрытия", won: amount }] : [];
  finishHand(game, table, hand);
}

function finishShowdown(game, table, hand) {
  while (hand.community.length < 5) hand.community.push(hand.deck.pop());
  const evaluations = {};
  for (const userId of remainingContenders(hand)) evaluations[userId] = evaluateSeven([...hand.hands[userId], ...hand.community]);
  const pots = buildPots(hand);
  const wonByUser = {};
  for (const pot of pots) {
    const eligible = pot.eligible.filter((userId) => evaluations[userId]);
    if (!eligible.length) continue;
    let best = evaluations[eligible[0]].score;
    for (const userId of eligible.slice(1)) if (compareScores(evaluations[userId].score, best) > 0) best = evaluations[userId].score;
    const winners = eligible.filter((userId) => compareScores(evaluations[userId].score, best) === 0);
    pot.winners = winners;
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    const ordered = orderedPlayersFrom(table, table.dealerSeat, (player) => winners.includes(player.userId));
    for (const player of ordered) {
      const bonus = remainder > 0 ? 1 : 0;
      remainder -= bonus;
      player.stack += share + bonus;
      wonByUser[player.userId] = Number(wonByUser[player.userId] || 0) + share + bonus;
    }
  }
  hand.pots = pots;
  hand.winners = Object.keys(wonByUser);
  hand.results = remainingContenders(hand).map((userId) => ({ userId, handName: evaluations[userId]?.name || "", score: evaluations[userId]?.score || [], won: Number(wonByUser[userId] || 0) }));
  finishHand(game, table, hand);
}

function finishHand(game, table, hand) {
  hand.status = "finished";
  hand.street = "showdown";
  hand.actorUserId = null;
  hand.pending = [];
  hand.actionDeadline = 0;
  hand.completedAt = now();
  table.lastHand = clone(hand);
  table.hand = null;
  table.nextHandAt = now() + 3000;
  for (const player of game.players) {
    if (game.mode === "tournament" && player.status === "active" && Number(player.stack || 0) <= 0) player.pendingBust = true;
    if (player.leaveAfterHand) player.pendingLeave = true;
  }
}

function nextStreet(game, table, hand) {
  const contenders = remainingContenders(hand);
  if (contenders.length <= 1) return awardSingleRemaining(game, table, hand);
  const actionable = contenders.filter((userId) => {
    const player = game.players.find((item) => item.userId === userId);
    return player && Number(player.stack || 0) > 0 && !hand.allIn.includes(userId);
  });
  if (hand.street === "river" || actionable.length <= 1) return finishShowdown(game, table, hand);
  if (hand.street === "preflop") { hand.community.push(hand.deck.pop(), hand.deck.pop(), hand.deck.pop()); hand.street = "flop"; }
  else if (hand.street === "flop") { hand.community.push(hand.deck.pop()); hand.street = "turn"; }
  else if (hand.street === "turn") { hand.community.push(hand.deck.pop()); hand.street = "river"; }
  hand.streetBets = Object.fromEntries(Object.keys(hand.hands).map((userId) => [userId, 0]));
  hand.currentBet = 0;
  hand.minRaise = hand.bigBlind;
  hand.pending = actionable;
  const first = nextSeatPlayer(table, table.dealerSeat, (player) => hand.pending.includes(player.userId) && canAct(hand, player));
  hand.actorUserId = first?.userId || null;
  hand.actionDeadline = first ? now() + Number(table.actionTimeMs || 30_000) : 0;
  if (!first) finishShowdown(game, table, hand);
}

function completeAction(game, table, hand, actingPlayer, { raised = false } = {}) {
  if (raised) {
    hand.pending = Object.keys(hand.hands).filter((userId) => userId !== actingPlayer.userId && canAct(hand, game.players.find((item) => item.userId === userId)));
  } else hand.pending = hand.pending.filter((userId) => userId !== actingPlayer.userId);
  sanitizePending(hand, table);
  const contenders = remainingContenders(hand);
  if (contenders.length <= 1) return awardSingleRemaining(game, table, hand);
  if (!hand.pending.length) return nextStreet(game, table, hand);
  setActor(table, hand, actingPlayer.seat);
}

export function applyPokerAction(game, userId, action) {
  if (!game || game.status !== "running") throw new Error("Игра сейчас не идёт");
  const player = game.players.find((item) => item.userId === userId && item.status === "active");
  if (!player) throw new Error("Вы не участвуете в этой игре");
  const table = game.tables.find((item) => item.id === player.tableId);
  const hand = table?.hand;
  if (!hand || hand.status !== "playing") throw new Error("Новая раздача ещё не началась");
  if (hand.actorUserId !== userId) throw new Error("Сейчас ход другого игрока");
  const kind = String(action.kind || "");
  const toCall = amountToCall(hand, userId);
  let raised = false;
  let amount = 0;

  if (kind === "fold") {
    if (!hand.folded.includes(userId)) hand.folded.push(userId);
  } else if (kind === "check") {
    if (toCall !== 0) throw new Error("Нельзя сделать чек: нужно уравнять ставку");
  } else if (kind === "call") {
    amount = commitChips(hand, player, toCall);
  } else if (kind === "bet") {
    if (hand.currentBet !== 0) throw new Error("Ставка уже сделана — используйте рейз");
    const requested = Math.floor(Number(action.amount || 0));
    if (requested < hand.bigBlind && requested < player.stack) throw new Error(`Минимальная ставка — ${hand.bigBlind}`);
    amount = commitChips(hand, player, requested);
    hand.currentBet = hand.streetBets[userId];
    hand.minRaise = Math.max(hand.bigBlind, hand.currentBet);
    raised = true;
  } else if (kind === "raise") {
    if (hand.currentBet <= 0) throw new Error("Сначала сделайте ставку");
    const target = Math.floor(Number(action.amount || 0));
    const maxTarget = Number(hand.streetBets[userId] || 0) + Number(player.stack || 0);
    if (target <= hand.currentBet) throw new Error("Рейз должен быть выше текущей ставки");
    const raiseSize = target - hand.currentBet;
    if (raiseSize < hand.minRaise && target < maxTarget) throw new Error(`Минимальный рейз до ${hand.currentBet + hand.minRaise}`);
    amount = commitChips(hand, player, target - Number(hand.streetBets[userId] || 0));
    const actualTarget = Number(hand.streetBets[userId] || 0);
    const actualRaise = actualTarget - hand.currentBet;
    if (actualTarget > hand.currentBet) {
      if (actualRaise >= hand.minRaise) hand.minRaise = actualRaise;
      hand.currentBet = actualTarget;
      raised = true;
    }
  } else if (kind === "allin") {
    const before = Number(hand.streetBets[userId] || 0);
    amount = commitChips(hand, player, player.stack);
    const actualTarget = Number(hand.streetBets[userId] || 0);
    if (actualTarget > hand.currentBet) {
      const actualRaise = actualTarget - hand.currentBet;
      if (actualRaise >= hand.minRaise) hand.minRaise = actualRaise;
      hand.currentBet = actualTarget;
      raised = true;
    }
    if (actualTarget === before) throw new Error("У игрока нет фишек для действия");
  } else throw new Error("Неизвестное действие за покерным столом");

  hand.actions.push({ userId, kind, amount, street: hand.street, at: now() });
  game.updatedAt = now();
  completeAction(game, table, hand, player, { raised });
  return game;
}

function createPokerTable(game, playerIds, index) {
  const maxSeats = 8;
  const table = {
    id: `${game.id}-table-${index + 1}`, index, maxSeats, playerIds: [], dealerSeat: randomInt(maxSeats),
    handNumber: 0, hand: null, lastHand: null, nextHandAt: now() + 1000,
    actionTimeMs: game.speed === "turbo" ? 15_000 : 30_000,
    gamePlayersById: {},
  };
  const seats = [...Array(maxSeats).keys()];
  for (let cursor = 0; cursor < playerIds.length; cursor += 1) {
    const player = game.players.find((item) => item.userId === playerIds[cursor]);
    const seat = seats[cursor];
    player.tableId = table.id;
    player.seat = seat;
    table.playerIds.push(player.userId);
  }
  table.gamePlayersById = Object.fromEntries(game.players.map((item) => [item.userId, item]));
  return table;
}

function blindSchedule(speed) {
  const levels = [
    [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [400, 800],
    [600, 1200], [800, 1600], [1000, 2000], [1500, 3000], [2000, 4000], [3000, 6000], [5000, 10000],
  ];
  return levels.map(([smallBlind, bigBlind], index) => ({ level: index + 1, smallBlind, bigBlind, durationMs: speed === "turbo" ? 120_000 : 300_000 }));
}

function currentTournamentBlinds(game, timestamp = now()) {
  const schedule = game.blindSchedule;
  let elapsed = Math.max(0, timestamp - game.startedAt);
  let index = 0;
  while (index < schedule.length - 1 && elapsed >= schedule[index].durationMs) {
    elapsed -= schedule[index].durationMs;
    index += 1;
  }
  game.blindLevel = index;
  game.nextBlindAt = timestamp + Math.max(1000, schedule[index].durationMs - elapsed);
  return schedule[index];
}

function tournamentPrizeWeights(capacity) {
  const paid = Math.max(2, Math.min(capacity, Math.ceil(capacity * 0.15)));
  const raw = Array.from({ length: paid }, (_, index) => Math.pow(0.78, index));
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total);
}

function distributeTournamentPrizes(db, game) {
  const ranking = [...game.players].sort((a, b) => {
    if (a.finishPlace && b.finishPlace) return a.finishPlace - b.finishPlace;
    if (a.status === "active" && b.status !== "active") return -1;
    if (b.status === "active" && a.status !== "active") return 1;
    return Number(b.stack || 0) - Number(a.stack || 0);
  });
  const weights = tournamentPrizeWeights(game.capacity);
  const pool = game.capacity * game.buyIn;
  let distributed = 0;
  const prizes = [];
  for (let index = 0; index < weights.length; index += 1) {
    const player = ranking[index];
    if (!player) break;
    const amount = index === weights.length - 1 ? pool - distributed : Math.floor(pool * weights[index]);
    distributed += amount;
    const wallet = ensureWallet(db, player.userId).wallet;
    wallet.balance += amount;
    wallet.lifetimeWon += amount;
    wallet.updatedAt = now();
    player.payout = amount;
    prizes.push({ place: index + 1, userId: player.userId, amount });
  }
  game.prizes = prizes;
  game.prizePool = pool;
}

function finishTournamentIfNeeded(db, game) {
  const active = game.players.filter((item) => item.status === "active" && Number(item.stack || 0) > 0);
  if (active.length > 1) return false;
  if (active.length === 1) {
    active[0].finishPlace = 1;
    active[0].status = "winner";
  }
  game.status = "finished";
  game.finishedAt = now();
  game.winnerId = active[0]?.userId || null;
  distributeTournamentPrizes(db, game);
  return true;
}

function processBusts(game) {
  const activeBefore = game.players.filter((item) => item.status === "active").length;
  const busted = game.players.filter((item) => item.pendingBust && item.status === "active");
  busted.sort((a, b) => Number(a.stack || 0) - Number(b.stack || 0) || Number(a.seat || 0) - Number(b.seat || 0));
  let place = activeBefore;
  for (const player of busted) {
    player.pendingBust = false;
    player.status = "busted";
    player.finishPlace = place;
    place -= 1;
    const table = game.tables.find((item) => item.id === player.tableId);
    if (table) table.playerIds = table.playerIds.filter((id) => id !== player.userId);
  }
}

function rebalanceTournament(game) {
  const active = game.players.filter((item) => item.status === "active" && Number(item.stack || 0) > 0);
  const tableCount = Math.max(1, Math.ceil(active.length / 8));
  const previousDealers = new Map(game.tables.map((table) => [table.index, table.dealerSeat]));
  game.tables = Array.from({ length: tableCount }, (_, index) => ({
    id: `${game.id}-table-${index + 1}`, index, maxSeats: 8, playerIds: [], dealerSeat: previousDealers.get(index) ?? randomInt(8),
    handNumber: game.tables.find((table) => table.index === index)?.handNumber || 0,
    hand: null, lastHand: game.tables.find((table) => table.index === index)?.lastHand || null,
    nextHandAt: now() + 1000, actionTimeMs: game.speed === "turbo" ? 15_000 : 30_000, gamePlayersById: {},
  }));
  active.sort((a, b) => Number(b.stack || 0) - Number(a.stack || 0));
  active.forEach((player, index) => {
    const table = game.tables[index % tableCount];
    const used = new Set(table.playerIds.map((id) => game.players.find((item) => item.userId === id)?.seat));
    const seat = [...Array(8).keys()].find((value) => !used.has(value));
    player.tableId = table.id;
    player.seat = seat;
    table.playerIds.push(player.userId);
  });
  for (const table of game.tables) table.gamePlayersById = Object.fromEntries(game.players.map((item) => [item.userId, item]));
}

function processCashLeaves(db, game) {
  for (const player of game.players.filter((item) => item.pendingLeave)) {
    const wallet = ensureWallet(db, player.userId).wallet;
    wallet.balance += Math.max(0, Math.floor(Number(player.stack || 0)));
    wallet.updatedAt = now();
    player.stack = 0;
    player.status = "left";
    player.pendingLeave = false;
    const table = game.tables.find((item) => item.id === player.tableId);
    if (table) table.playerIds = table.playerIds.filter((id) => id !== player.userId);
  }
}

function startAvailableHands(game, timestamp = now()) {
  const blinds = game.mode === "tournament" ? currentTournamentBlinds(game) : game.blinds;
  for (const table of game.tables) {
    table.gamePlayersById = Object.fromEntries(game.players.map((item) => [item.userId, item]));
    if (table.hand || timestamp < Number(table.nextHandAt || 0)) continue;
    const eligible = table.playerIds.map((id) => game.players.find((item) => item.userId === id)).filter(eligibleForHand);
    if (eligible.length < 2) continue;
    table.hand = createHand(table, game, blinds);
  }
}

export function createTournamentInstance({ capacity, speed, buyIn }) {
  if (!TOURNAMENT_SIZES.includes(Number(capacity))) throw new Error("Недоступный размер турнира");
  if (!TOURNAMENT_SPEEDS.includes(speed)) throw new Error("Недоступная скорость турнира");
  if (!TOURNAMENT_BUY_INS.includes(Number(buyIn))) throw new Error("Недоступный бай-ин");
  const id = randomUUID();
  return {
    id, mode: "tournament", title: `${speed === "turbo" ? "Турбо" : "Обычный"} турнир · ${capacity} игроков · ${buyIn} фишек`,
    capacity: Number(capacity), speed, buyIn: Number(buyIn), status: "waiting", players: [], tables: [],
    blindSchedule: blindSchedule(speed), blindLevel: 0, nextBlindAt: null, prizePool: Number(capacity) * Number(buyIn), prizes: [],
    createdAt: now(), updatedAt: now(), startedAt: null, finishedAt: null, winnerId: null,
  };
}

export function joinTournament(db, game, user) {
  if (game.mode !== "tournament" || game.status !== "waiting") throw new Error("Регистрация в турнир закрыта");
  if (game.players.some((item) => item.userId === user.id)) return game;
  if (game.players.length >= game.capacity) throw new Error("Турнир уже заполнен");
  const wallet = ensureWallet(db, user.id).wallet;
  if (wallet.balance < game.buyIn) throw new Error(`Недостаточно условных фишек. Нужно ${game.buyIn}`);
  wallet.balance -= game.buyIn;
  wallet.lifetimeSpent += game.buyIn;
  wallet.updatedAt = now();
  game.players.push({ userId: user.id, user, stack: 10_000, status: "waiting", tableId: null, seat: null, joinedAt: now(), finishPlace: null, payout: 0 });
  game.updatedAt = now();
  if (game.players.length === game.capacity) startTournament(game);
  return game;
}

export function leaveTournamentBeforeStart(db, game, userId) {
  if (game.mode !== "tournament" || game.status !== "waiting") throw new Error("После старта покинуть турнир с возвратом бай-ина нельзя");
  const index = game.players.findIndex((item) => item.userId === userId);
  if (index < 0) return game;
  game.players.splice(index, 1);
  const wallet = ensureWallet(db, userId).wallet;
  wallet.balance += game.buyIn;
  wallet.lifetimeSpent = Math.max(0, wallet.lifetimeSpent - game.buyIn);
  wallet.updatedAt = now();
  game.updatedAt = now();
  return game;
}

function startTournament(game) {
  game.status = "running";
  game.startedAt = now();
  game.updatedAt = now();
  for (const player of game.players) { player.status = "active"; player.stack = 10_000; }
  const tableCount = Math.ceil(game.players.length / 8);
  game.tables = [];
  for (let index = 0; index < tableCount; index += 1) {
    const ids = game.players.filter((_, playerIndex) => playerIndex % tableCount === index).map((item) => item.userId);
    game.tables.push(createPokerTable(game, ids, index));
  }
  currentTournamentBlinds(game);
}

export function createCashGame({ blinds }) {
  const smallBlind = Number(blinds?.smallBlind);
  const bigBlind = Number(blinds?.bigBlind);
  if (!CASH_BLINDS.some((item) => item.smallBlind === smallBlind && item.bigBlind === bigBlind)) throw new Error("Недоступные блайнды");
  const id = randomUUID();
  const game = {
    id, mode: "cash", title: `Кэш ${smallBlind}/${bigBlind}`, capacity: 8, speed: "normal", status: "running",
    blinds: { smallBlind, bigBlind }, players: [], tables: [], createdAt: now(), updatedAt: now(), startedAt: now(), finishedAt: null,
  };
  game.tables = [createPokerTable(game, [], 0)];
  return game;
}

export function joinCashGame(db, game, user, requestedBuyIn) {
  if (game.mode !== "cash" || game.status !== "running") throw new Error("Кэш-стол недоступен");
  const existing = game.players.find((item) => item.userId === user.id && item.status !== "left");
  if (existing) return game;
  const table = game.tables[0];
  if (table.playerIds.length >= 8) throw new Error("За столом нет свободного места");
  const minimum = game.blinds.bigBlind * 20;
  const maximum = game.blinds.bigBlind * 100;
  const buyIn = Math.floor(Number(requestedBuyIn || minimum));
  if (buyIn < minimum || buyIn > maximum) throw new Error(`Бай-ин для этого стола: от ${minimum} до ${maximum}`);
  const wallet = ensureWallet(db, user.id).wallet;
  if (wallet.balance < buyIn) throw new Error("Недостаточно условных фишек");
  wallet.balance -= buyIn;
  wallet.lifetimeSpent += buyIn;
  wallet.updatedAt = now();
  const usedSeats = new Set(game.players.filter((item) => item.status !== "left").map((item) => item.seat));
  const seat = [...Array(8).keys()].find((value) => !usedSeats.has(value));
  const player = { userId: user.id, user, stack: buyIn, status: "active", sitOut: false, tableId: table.id, seat, joinedAt: now(), leaveAfterHand: false };
  game.players.push(player);
  table.playerIds.push(user.id);
  table.gamePlayersById = Object.fromEntries(game.players.map((item) => [item.userId, item]));
  table.nextHandAt = Math.min(Number(table.nextHandAt || Infinity), now() + 1000);
  game.updatedAt = now();
  return game;
}

export function requestCashLeave(db, game, userId) {
  if (game.mode !== "cash") throw new Error("Это не кэш-стол");
  const player = game.players.find((item) => item.userId === userId && item.status === "active");
  if (!player) return game;
  const table = game.tables.find((item) => item.id === player.tableId);
  if (table?.hand && table.hand.hands[userId] && table.hand.status === "playing") {
    player.leaveAfterHand = true;
    if (!table.hand.folded.includes(userId)) table.hand.folded.push(userId);
    table.hand.pending = table.hand.pending.filter((id) => id !== userId);
    const contenders = remainingContenders(table.hand);
    if (contenders.length <= 1) awardSingleRemaining(game, table, table.hand);
    else if (!table.hand.pending.length) nextStreet(game, table, table.hand);
  } else {
    player.pendingLeave = true;
    processCashLeaves(db, game);
  }
  game.updatedAt = now();
  return game;
}

export function cashRebuy(db, game, userId, amount) {
  if (game.mode !== "cash") throw new Error("Это не кэш-стол");
  const player = game.players.find((item) => item.userId === userId && item.status === "active");
  if (!player) throw new Error("Вы не сидите за столом");
  const table = game.tables.find((item) => item.id === player.tableId);
  if (table?.hand?.status === "playing") throw new Error("Докупить фишки можно между раздачами");
  const maximum = game.blinds.bigBlind * 100;
  const add = Math.floor(Number(amount || 0));
  if (add <= 0 || player.stack + add > maximum) throw new Error(`Максимальный стек — ${maximum}`);
  const wallet = ensureWallet(db, userId).wallet;
  if (wallet.balance < add) throw new Error("Недостаточно условных фишек");
  wallet.balance -= add;
  wallet.lifetimeSpent += add;
  player.stack += add;
  wallet.updatedAt = now();
  game.updatedAt = now();
  return game;
}

export function tickPokerGames(db, timestamp = now()) {
  const changedGameIds = [];
  for (const game of db.pokerGames || []) {
    if (game.status !== "running") continue;
    let changed = false;
    for (const table of game.tables) {
      table.gamePlayersById = Object.fromEntries(game.players.map((item) => [item.userId, item]));
      const hand = table.hand;
      if (hand?.status === "playing" && hand.actorUserId && timestamp >= Number(hand.actionDeadline || 0)) {
        const player = game.players.find((item) => item.userId === hand.actorUserId);
        if (player) {
          const toCall = amountToCall(hand, player.userId);
          try { applyPokerAction(game, player.userId, { kind: toCall === 0 ? "check" : "fold", automated: true }); } catch {}
          changed = true;
        }
      }
    }

    const allTablesIdle = game.tables.every((table) => !table.hand);
    if (allTablesIdle) {
      if (game.mode === "tournament") {
        const completionToken = game.tables.map((table) => table.lastHand?.id || "initial").join("|");
        if (completionToken !== game.lastProcessedCompletionToken) {
          processBusts(game);
          if (finishTournamentIfNeeded(db, game)) { changed = true; }
          else {
            rebalanceTournament(game);
            game.lastProcessedCompletionToken = game.tables.map((table) => table.lastHand?.id || "initial").join("|");
            changed = true;
          }
        }
        if (game.status === "running") {
          currentTournamentBlinds(game, timestamp);
          const before = game.tables.filter((table) => table.hand).length;
          startAvailableHands(game, timestamp);
          if (game.tables.filter((table) => table.hand).length !== before) changed = true;
        }
      } else {
        const leavingBefore = game.players.filter((player) => player.pendingLeave).length;
        processCashLeaves(db, game);
        const handsBefore = game.tables.filter((table) => table.hand).length;
        startAvailableHands(game, timestamp);
        if (leavingBefore || game.tables.filter((table) => table.hand).length !== handsBefore) changed = true;
      }
    }
    if (changed) {
      game.updatedAt = timestamp;
      changedGameIds.push(game.id);
    }
  }
  return changedGameIds;
}

function hideCards(cards) {
  return Array.isArray(cards) ? cards.map(() => ({ hidden: true })) : [];
}

function publicHand(hand, viewerId, game) {
  if (!hand) return null;
  const result = clone(hand);
  delete result.deck;
  const showdown = hand.status === "finished" || hand.street === "showdown";
  result.hands = Object.fromEntries(Object.entries(hand.hands || {}).map(([userId, cards]) => {
    const show = userId === viewerId || (showdown && !hand.folded.includes(userId));
    return [userId, show ? cards : hideCards(cards)];
  }));
  result.toCall = viewerId ? amountToCall(hand, viewerId) : 0;
  const viewer = game.players.find((item) => item.userId === viewerId);
  result.minimumRaiseTo = hand.currentBet > 0 ? hand.currentBet + hand.minRaise : hand.bigBlind;
  result.maximumRaiseTo = viewer ? Number(hand.streetBets[viewerId] || 0) + Number(viewer.stack || 0) : 0;
  return result;
}

export function publicPokerGame(game, viewerId) {
  const result = clone(game);
  const viewer = game.players.find((item) => item.userId === viewerId && item.status !== "left") || null;
  result.isParticipant = Boolean(viewer);
  result.myPlayer = viewer ? clone(viewer) : null;
  result.playerCount = game.players.filter((player) => player.status !== "left").length;
  result.activeCount = game.players.filter((player) => player.status === "active" || player.status === "winner").length;
  result.tables = game.tables.map((table) => {
    const publicTable = { ...clone(table), hand: publicHand(table.hand, viewerId, game), lastHand: publicHand(table.lastHand, viewerId, game), gamePlayersById: undefined };
    delete publicTable.gamePlayersById;
    if (game.mode === "tournament" && viewer && viewer.tableId !== table.id) {
      publicTable.hand = table.hand ? { id: table.hand.id, status: table.hand.status, street: table.hand.street, community: table.hand.community, actorUserId: table.hand.actorUserId, pot: Object.values(table.hand.totalBets || {}).reduce((sum, amount) => sum + Number(amount || 0), 0) } : null;
    }
    return publicTable;
  });
  result.myTable = viewer ? result.tables.find((table) => table.id === viewer.tableId) || null : null;
  return result;
}

export function summarizePokerGame(game) {
  return {
    id: game.id, mode: game.mode, title: game.title, status: game.status, capacity: game.capacity,
    speed: game.speed, buyIn: game.buyIn || null, blinds: game.blinds || null,
    playerCount: game.players.filter((item) => item.status !== "left").length,
    activeCount: game.players.filter((item) => item.status === "active" || item.status === "winner").length,
    prizePool: game.prizePool || null, blindLevel: game.blindLevel || 0, nextBlindAt: game.nextBlindAt || null,
    createdAt: game.createdAt, updatedAt: game.updatedAt, startedAt: game.startedAt, finishedAt: game.finishedAt,
    players: game.players.slice(0, 12).map((item) => ({ userId: item.userId, user: item.user, stack: item.stack, status: item.status, finishPlace: item.finishPlace })),
  };
}

export function findOrCreateWaitingTournament(db, preset) {
  db.pokerGames ||= [];
  let game = db.pokerGames.find((item) => item.mode === "tournament" && item.status === "waiting" && item.capacity === Number(preset.capacity) && item.speed === preset.speed && item.buyIn === Number(preset.buyIn));
  if (!game) {
    game = createTournamentInstance(preset);
    db.pokerGames.push(game);
  }
  return game;
}

export function findOrCreateCashGame(db, blinds) {
  db.pokerGames ||= [];
  let game = db.pokerGames.find((item) => item.mode === "cash" && item.status === "running" && item.blinds?.smallBlind === Number(blinds.smallBlind) && item.blinds?.bigBlind === Number(blinds.bigBlind) && item.players.filter((player) => player.status === "active").length < 8);
  if (!game) {
    game = createCashGame({ blinds });
    db.pokerGames.push(game);
  }
  return game;
}

export function tournamentCatalog(db, userId) {
  return TOURNAMENT_SIZES.flatMap((capacity) => TOURNAMENT_SPEEDS.flatMap((speed) => TOURNAMENT_BUY_INS.map((buyIn) => {
    const waiting = (db.pokerGames || []).find((item) => item.mode === "tournament" && item.status === "waiting" && item.capacity === capacity && item.speed === speed && item.buyIn === buyIn);
    return {
      key: `${capacity}-${speed}-${buyIn}`, capacity, speed, buyIn, prizePool: capacity * buyIn,
      registered: waiting?.players.length || 0, tournamentId: waiting?.id || null,
      joined: Boolean(waiting?.players.some((player) => player.userId === userId)),
    };
  })));
}

export function cashCatalog(db, userId) {
  return CASH_BLINDS.map((blinds) => {
    const tables = (db.pokerGames || []).filter((item) => item.mode === "cash" && item.status === "running" && item.blinds?.smallBlind === blinds.smallBlind && item.blinds?.bigBlind === blinds.bigBlind);
    return {
      key: `${blinds.smallBlind}-${blinds.bigBlind}`, ...blinds,
      minBuyIn: blinds.bigBlind * 20, maxBuyIn: blinds.bigBlind * 100,
      activeTables: tables.length, seatedPlayers: tables.reduce((sum, table) => sum + table.players.filter((player) => player.status === "active").length, 0),
      myGameId: tables.find((table) => table.players.some((player) => player.userId === userId && player.status === "active"))?.id || null,
    };
  });
}
