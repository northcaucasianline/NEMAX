import { useCallback, useEffect, useMemo, useState } from "react";
import useAuth from "../../hooks/useAuth";
import { connectSocket, gameApi } from "../../shared/lib/api";
import CustomSelect from "../../shared/ui/CustomSelect";
import Avatar from "../../shared/ui/Avatar";

const BOARD_TYPES = [
  { value: "chess", label: "Шахматы", icon: "♞", description: "Рокировка, взятие на проходе, превращение пешки и все виды ничьей" },
  { value: "checkers", label: "Русские шашки", icon: "◉", description: "Летающие дамки, обязательные и серийные взятия" },
];
const TOURNAMENT_SIZES = [3, 8, 16, 50, 100];
const BUY_INS = [50, 100, 500, 1000, 5000, 10000];
const CHESS_PIECES = { wK: "♔", wQ: "♕", wR: "♖", wB: "♗", wN: "♘", wP: "♙", bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟" };
const RANK_LABELS = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const SUIT_LABELS = { s: "♠", h: "♥", d: "♦", c: "♣" };
const STREET_LABELS = { preflop: "Префлоп", flop: "Флоп", turn: "Тёрн", river: "Ривер", showdown: "Вскрытие" };

function formatChips(value) {
  return new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.floor(Number(value || 0))));
}
function avatarProps(user, size = "small") {
  return { src: user?.avatar, kind: user?.avatarKind, mimeType: user?.avatarMimeType, color: user?.avatarColor, letter: user?.username?.[0] || user?.displayName?.[0], online: user?.status === "online", statusEmoji: user?.statusEmoji, name: user?.username || user?.displayName, size };
}
function playerName(player) {
  return player?.user?.username ? `@${player.user.username}` : player?.user?.displayName || `Игрок ${String(player?.userId || "").slice(0, 5)}`;
}
function Countdown({ target, prefix = "" }) {
  const [, rerender] = useState(0);
  useEffect(() => { const timer = setInterval(() => rerender((value) => value + 1), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.ceil((Number(target || 0) - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return <span>{prefix}{minutes}:{String(rest).padStart(2, "0")}</span>;
}
function Card({ card }) {
  if (!card || card.hidden) return <span className="playing-card hidden">N</span>;
  const red = card.suit === "h" || card.suit === "d";
  return <span className={`playing-card ${red ? "red" : ""}`}><b>{RANK_LABELS[card.rank] || card.rank}</b><i>{SUIT_LABELS[card.suit]}</i></span>;
}

function BoardGame({ table, onAction }) {
  const [selected, setSelected] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const state = table.state;
  const mine = table.myPlayer;
  const isChess = table.type === "chess";
  useEffect(() => setSelected(null), [table.updatedAt]);

  function submitMove(from, to, promotionPiece = "Q") {
    onAction({ kind: "move", from, to, promotion: promotionPiece });
    setSelected(null);
    setPromotion(null);
  }
  function click(row, col) {
    if (!mine || state.status !== "playing" || state.turn !== mine.color) return;
    const piece = state.board[row][col];
    const color = isChess ? piece?.[0] : String(piece || "").toLowerCase();
    if (!selected) {
      if (color === mine.color) setSelected({ row, col });
      return;
    }
    if (color === mine.color) { setSelected({ row, col }); return; }
    const moving = state.board[selected.row][selected.col];
    if (isChess && moving?.[1] === "P" && (row === 0 || row === 7)) {
      setPromotion({ from: selected, to: { row, col } });
      return;
    }
    submitMove(selected, { row, col });
  }

  const winner = state.winnerColor ? table.players.find((player) => player.color === state.winnerColor) : null;
  const rows = [...Array(8).keys()];
  const cols = [...Array(8).keys()];
  if (mine?.color === "b") { rows.reverse(); cols.reverse(); }
  return <div className="board-game-layout">
    <div className={`nemax-board ${isChess ? "chess" : "checkers"}`}>
      {rows.flatMap((rowIndex) => cols.map((colIndex) => {
        const piece = state.board[rowIndex][colIndex];
        const selectedCell = selected?.row === rowIndex && selected?.col === colIndex;
        const last = state.lastMove && ((state.lastMove.from.row === rowIndex && state.lastMove.from.col === colIndex) || (state.lastMove.to.row === rowIndex && state.lastMove.to.col === colIndex));
        return <button key={`${rowIndex}-${colIndex}`} className={`${(rowIndex + colIndex) % 2 ? "dark" : "light"} ${selectedCell ? "selected" : ""} ${last ? "last" : ""}`} onClick={() => click(rowIndex, colIndex)}>
          {piece && (isChess
            ? <span className={piece[0] === "w" ? "white-piece" : "black-piece"}>{CHESS_PIECES[piece]}</span>
            : <span className={`checker ${piece.toLowerCase() === "w" ? "white" : "black"} ${piece === piece.toUpperCase() ? "king" : ""}`}>{piece === piece.toUpperCase() ? "✦" : ""}</span>)}
        </button>;
      }))}
      {promotion && <div className="promotion-picker"><strong>Превратить пешку в</strong><div>{["Q", "R", "B", "N"].map((piece) => <button key={piece} onClick={() => submitMove(promotion.from, promotion.to, piece)}>{CHESS_PIECES[`${mine.color}${piece}`]}</button>)}</div><button onClick={() => setPromotion(null)}>Отмена</button></div>}
    </div>
    <aside className="board-game-info">
      <div className="turn-card"><small>Состояние партии</small>{state.status === "waiting" ? <strong>Ожидание соперника</strong> : state.status === "finished" ? <strong>{state.draw ? `Ничья · ${state.drawReason || "по правилам"}` : `Победил ${playerName(winner)}`}</strong> : <strong>{table.bot?.thinking ? `Stockfish ${table.bot.level} думает…` : `Ход: ${state.turn === "w" ? "белые" : "чёрные"}${state.check ? " · шах" : ""}`}</strong>}{table.bot && <span className="bot-engine-label">Уровень {table.bot.level} · {table.bot.engine === "stockfish" ? "Stockfish" : "резервный движок"}</span>}</div>
      <div className="table-players">{table.players.map((player) => <div key={player.userId} className={state.turn === player.color && state.status === "playing" ? "active" : ""}><Avatar {...avatarProps(player.user, "chat")} /><span><strong>{playerName(player)}</strong><small>{player.color === "w" ? "Белые" : "Чёрные"}</small></span>{player.userId === table.hostId && <i>HOST</i>}</div>)}</div>
      {mine && state.status === "finished" && table.hostId === mine.userId && <button className="btn-main" onClick={() => onAction({ kind: "restart" })}>Новая партия</button>}
      <p className="game-rules-note">{isChess ? "Полные правила: рокировка с проверкой атакуемых полей, взятие на проходе, выбор фигуры при превращении, пат, троекратное повторение, 50 ходов и недостаток материала." : "Русские шашки: простые шашки бьют вперёд и назад, дамки летают по всей диагонали, взятие обязательно и серия продолжается той же фигурой."}</p>
    </aside>
  </div>;
}

function BoardTableView({ tableId, onExit }) {
  const [table, setTable] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { const result = await gameApi(`/boards/${tableId}`); setTable(result.table); setLoading(false); }, [tableId]);
  useEffect(() => { load().catch((error) => { alert(error.message); onExit(); }); }, [load, onExit]);
  useEffect(() => connectSocket((event) => { if (event.type === "game.board.updated" && event.tableId === tableId) load().catch(() => {}); if (event.type === "game.board.deleted" && event.tableId === tableId) onExit(); }), [tableId, load, onExit]);
  useEffect(() => { const timer = setInterval(() => load().catch(() => {}), 8000); return () => clearInterval(timer); }, [load]);
  async function operation(path, body = {}) { try { const result = await gameApi(`/boards/${tableId}/${path}`, { method: "POST", body }); setTable(result.table); } catch (error) { alert(error.message); } }
  if (loading || !table) return <div className="rooms-state"><strong>Открываем игровую доску…</strong></div>;
  const type = BOARD_TYPES.find((item) => item.value === table.type);
  return <section className="online-table-view"><header><button onClick={onExit}>← К лобби</button><div><span>{type?.icon}</span><div><small>{type?.label}</small><h2>{table.title}</h2></div></div><div>{!table.isParticipant && !table.bot && table.players.length < 2 && <button className="btn-main" onClick={() => operation("join")}>Занять место</button>}{table.isParticipant && <button onClick={() => operation("leave")}>Покинуть</button>}</div></header><BoardGame table={table} onAction={(action) => operation("action", action)} /></section>;
}

function BoardLobby({ onOpen }) {
  const { user } = useAuth();
  const [tables, setTables] = useState([]);
  const [type, setType] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ type: "chess", title: "", opponent: "human", botLevel: 5 });
  const load = useCallback(async () => { const params = new URLSearchParams(); if (type) params.set("type", type); const result = await gameApi(`/boards?${params}`); setTables(result.tables || []); }, [type]);
  useEffect(() => { load().catch((error) => alert(error.message)); }, [load]);
  useEffect(() => connectSocket((event) => { if (["game.board.updated", "game.board.deleted"].includes(event.type)) load().catch(() => {}); }), [load]);
  async function create(event) { event.preventDefault(); try { const payload = { ...form, botLevel: form.type === "chess" && form.opponent === "bot" ? form.botLevel : null }; const result = await gameApi("/boards", { method: "POST", body: payload }); setShowCreate(false); onOpen(result.table.id); } catch (error) { alert(error.message); } }
  async function join(table) { try { await gameApi(`/boards/${table.id}/join`, { method: "POST", body: {} }); onOpen(table.id); } catch (error) { alert(error.message); } }
  const options = [{ value: "", label: "Все настольные игры", icon: "✦" }, ...BOARD_TYPES];
  return <section className="online-games"><header><div><span className="section-eyebrow">NEMAX BOARD</span><h2>Шахматы и русские шашки</h2><p>Все ходы проверяются отдельным игровым сервером. Клиент не может подменить доску.</p></div><button className="btn-main" onClick={() => setShowCreate(true)}>＋ Создать стол</button></header><div className="online-games-toolbar"><CustomSelect value={type} onChange={setType} options={options} /><span>{tables.length} открытых столов</span></div><div className="game-tables-grid">{tables.map((table) => { const meta = BOARD_TYPES.find((item) => item.value === table.type); const joined = table.players.some((player) => player.userId === user?.id); return <article key={table.id}><div className="table-card-icon">{meta?.icon}</div><div><small>{meta?.label}</small><h3>{table.title}</h3><p>{table.bot ? `Против Stockfish · уровень ${table.bot.level}` : table.status === "playing" ? "Партия идёт" : table.status === "finished" ? "Партия завершена" : "Ожидание соперника"}</p></div><div className="table-card-players">{table.players.map((player) => <Avatar key={player.userId} {...avatarProps(player.user, "small")} />)}<span>{table.playerCount}/2</span></div><footer><button onClick={() => onOpen(table.id)}>Наблюдать</button>{!joined && !table.bot && table.playerCount < 2 && <button className="btn-main" onClick={() => join(table)}>Играть</button>}{joined && <button className="btn-main" onClick={() => onOpen(table.id)}>Вернуться</button>}</footer></article>; })}</div>{!tables.length && <div className="rooms-state"><strong>Открытых столов пока нет</strong><span>Создайте первый стол.</span></div>}{showCreate && <div className="modal-overlay" onClick={() => setShowCreate(false)}><form className="create-table-modal" onSubmit={create} onClick={(event) => event.stopPropagation()}><header><div><small>Новая партия</small><h2>Создать стол</h2></div><button type="button" onClick={() => setShowCreate(false)}>×</button></header><label>Игра<CustomSelect value={form.type} onChange={(value) => setForm({ ...form, type: value, opponent: value === "chess" ? form.opponent : "human" })} options={BOARD_TYPES} /></label>{form.type === "chess" && <><label>Соперник<CustomSelect value={form.opponent} onChange={(value) => setForm({ ...form, opponent: value })} options={[{ value: "human", label: "Другой игрок", icon: "👤", description: "Обычный сетевой стол" }, { value: "bot", label: "Stockfish", icon: "♟", description: "Партия с шахматным движком" }]} /></label>{form.opponent === "bot" && <label>Уровень Stockfish<CustomSelect value={form.botLevel} onChange={(value) => setForm({ ...form, botLevel: Number(value) })} options={[3,4,5,6,7].map((value) => ({ value, label: `Уровень ${value}`, icon: "♞", description: value <= 4 ? "Спокойная игра" : value <= 6 ? "Уверенный соперник" : "Сложный уровень" }))} /></label>}</>}<label>Название<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Например: Партия вечером" /></label><button className="btn-main">Создать</button></form></div>}</section>;
}

function PokerSeat({ player, hand, isMine }) {
  if (!player) return <div className="poker-seat empty"><span>Свободно</span></div>;
  const cards = hand?.hands?.[player.userId] || [];
  const folded = hand?.folded?.includes(player.userId);
  const active = hand?.actorUserId === player.userId;
  const labels = [];
  if (hand?.dealerUserId === player.userId) labels.push("D");
  if (hand?.smallBlindUserId === player.userId) labels.push("SB");
  if (hand?.bigBlindUserId === player.userId) labels.push("BB");
  return <div className={`poker-seat ${active ? "active" : ""} ${folded ? "folded" : ""} ${isMine ? "mine" : ""}`}><div className="seat-user"><Avatar {...avatarProps(player.user, "small")} /><span><strong>{playerName(player)}</strong><small>{formatChips(player.stack)} фишек</small></span>{labels.length > 0 && <i>{labels.join(" · ")}</i>}</div>{cards.length > 0 && <div className="seat-cards">{cards.map((card, index) => <Card key={index} card={card} />)}</div>}{hand && <div className="seat-bet">Ставка: {formatChips(hand.streetBets?.[player.userId])}</div>}</div>;
}

function PokerTable({ game, onAction }) {
  const table = game.myTable || game.tables?.[0];
  const hand = table?.hand || table?.lastHand;
  const liveHand = table?.hand;
  const mine = game.myPlayer;
  const [raiseAmount, setRaiseAmount] = useState(0);
  useEffect(() => { if (liveHand) setRaiseAmount(Math.min(liveHand.maximumRaiseTo || 0, Math.max(liveHand.minimumRaiseTo || 0, liveHand.currentBet ? liveHand.minimumRaiseTo : liveHand.bigBlind))); }, [liveHand?.id, liveHand?.actorUserId, liveHand?.currentBet, liveHand?.minimumRaiseTo, liveHand?.maximumRaiseTo]);
  if (!table) return <div className="rooms-state"><strong>Рассадка формируется…</strong></div>;
  const playersBySeat = new Map(game.players.filter((player) => player.tableId === table.id && player.status !== "left").map((player) => [player.seat, player]));
  const pot = Object.values(hand?.totalBets || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const myTurn = liveHand?.actorUserId === mine?.userId;
  const canRaise = myTurn && Number(liveHand.maximumRaiseTo || 0) > Number(liveHand.currentBet || 0);
  return <div className="poker-game-layout"><div className="holdem-table"><div className="community-cards">{Array.from({ length: 5 }, (_, index) => <Card key={index} card={hand?.community?.[index]} />)}</div><div className="poker-center"><small>{STREET_LABELS[hand?.street] || "Ожидание раздачи"}</small><strong>Банк: {formatChips(pot)}</strong>{liveHand?.actionDeadline > 0 && <Countdown target={liveHand.actionDeadline} prefix="На ход: " />}</div><div className="holdem-seats">{Array.from({ length: 8 }, (_, seat) => <PokerSeat key={seat} player={playersBySeat.get(seat)} hand={hand} isMine={playersBySeat.get(seat)?.userId === mine?.userId} />)}</div></div><div className="poker-action-panel">{mine ? <><div className="my-poker-summary"><span><small>Ваш стек</small><strong>{formatChips(mine.stack)}</strong></span>{liveHand && <span><small>Уравнять</small><strong>{formatChips(liveHand.toCall)}</strong></span>}<span><small>Стол</small><strong>{table.index + 1}</strong></span></div>{myTurn ? <div className="poker-action-buttons"><button onClick={() => onAction({ kind: "fold" })}>Пас</button>{liveHand.toCall === 0 ? <button onClick={() => onAction({ kind: "check" })}>Чек</button> : <button className="btn-main" onClick={() => onAction({ kind: "call" })}>Колл {formatChips(Math.min(liveHand.toCall, mine.stack))}</button>}{canRaise && <div className="poker-raise-control"><input type="number" min={liveHand.currentBet ? liveHand.minimumRaiseTo : liveHand.bigBlind} max={liveHand.maximumRaiseTo} value={raiseAmount} onChange={(event) => setRaiseAmount(Number(event.target.value))} /><button onClick={() => onAction({ kind: liveHand.currentBet ? "raise" : "bet", amount: raiseAmount })}>{liveHand.currentBet ? "Рейз" : "Ставка"}</button></div>}<button className="allin" onClick={() => onAction({ kind: "allin" })}>All-in</button></div> : <div className="poker-wait-turn">{liveHand ? `Ходит ${playerName(game.players.find((player) => player.userId === liveHand.actorUserId))}` : "Следующая раздача начнётся автоматически"}</div>}</> : <div className="poker-wait-turn">Вы наблюдаете за столом</div>}</div>{table.lastHand?.results?.length > 0 && !table.hand && <div className="poker-last-results"><strong>Итог последней раздачи</strong>{table.lastHand.results.map((result) => <span key={result.userId}>{playerName(game.players.find((player) => player.userId === result.userId))}: {result.handName} · выигрыш {formatChips(result.won)}</span>)}</div>}</div>;
}

function PokerGameView({ gameId, onExit, onWallet }) {
  const [game, setGame] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rebuy, setRebuy] = useState(0);
  const load = useCallback(async () => { const result = await gameApi(`/poker/games/${gameId}`); setGame(result.game); setWallet(result.wallet); onWallet?.(result.wallet); setLoading(false); }, [gameId, onWallet]);
  useEffect(() => { load().catch((error) => { alert(error.message); onExit(); }); }, [load, onExit]);
  useEffect(() => connectSocket((event) => { if (event.type === "game.poker.updated" && event.gameId === gameId) load().catch(() => {}); }), [gameId, load]);
  useEffect(() => { const timer = setInterval(() => load().catch(() => {}), 2500); return () => clearInterval(timer); }, [load]);
  async function operation(path, body = {}) { try { const result = await gameApi(`/poker/games/${gameId}/${path}`, { method: "POST", body }); setGame(result.game); if (result.wallet) { setWallet(result.wallet); onWallet?.(result.wallet); } } catch (error) { alert(error.message); } }
  async function leaveTournament() { try { const result = await gameApi(`/poker/tournaments/${gameId}/leave`, { method: "POST", body: {} }); setGame(result.game); setWallet(result.wallet); onWallet?.(result.wallet); onExit(); } catch (error) { alert(error.message); } }
  if (loading || !game) return <div className="rooms-state"><strong>Подключаемся к покерному серверу…</strong></div>;
  const isTournament = game.mode === "tournament";
  const joined = game.isParticipant;
  return <section className="poker-game-view"><header><button onClick={onExit}>← К покерному лобби</button><div><span>♠</span><div><small>{isTournament ? `${game.speed === "turbo" ? "Турбо" : "Обычный"} турнир` : "Кэш-стол"}</small><h2>{game.title}</h2></div></div><div className="wallet-pill"><small>Баланс</small><strong>{formatChips(wallet?.balance)} ◆</strong></div></header><div className="poker-game-meta">{isTournament ? <><span>Участники: <b>{game.playerCount}/{game.capacity}</b></span><span>Бай-ин: <b>{formatChips(game.buyIn)}</b></span><span>Призовой фонд: <b>{formatChips(game.prizePool)}</b></span>{game.status === "running" && <><span>Уровень: <b>{Number(game.blindLevel || 0) + 1}</b></span><Countdown target={game.nextBlindAt} prefix="Новые блайнды через " /></>}</> : <><span>Блайнды: <b>{formatChips(game.blinds.smallBlind)}/{formatChips(game.blinds.bigBlind)}</b></span><span>Игроки: <b>{game.activeCount}/8</b></span></>}</div>{game.status === "waiting" ? <div className="tournament-waiting"><div className="tournament-progress"><i style={{ width: `${(game.playerCount / game.capacity) * 100}%` }} /></div><h3>Регистрация открыта</h3><p>Турнир начнётся автоматически, когда зарегистрируются все {game.capacity} игроков.</p><div className="tournament-entrants">{game.players.map((player) => <div key={player.userId}><Avatar {...avatarProps(player.user, "small")} /><span>{playerName(player)}</span></div>)}</div>{joined && <button onClick={leaveTournament}>Отменить регистрацию и вернуть бай-ин</button>}</div> : <><PokerTable game={game} onAction={(action) => operation("action", action)} />{game.mode === "cash" && joined && <div className="cash-table-tools"><button onClick={() => operation("leave")}>Выйти после раздачи и вернуть стек</button><div><input type="number" value={rebuy} onChange={(event) => setRebuy(Number(event.target.value))} placeholder="Докупить фишки" /><button onClick={() => operation("rebuy", { amount: rebuy })}>Докупить</button></div></div>}{game.mode === "tournament" && game.myPlayer?.status === "busted" && <div className="tournament-result-card"><strong>Вы завершили турнир</strong><span>Место: {game.myPlayer.finishPlace}</span></div>}{game.status === "finished" && <div className="tournament-prizes"><h3>Турнир завершён</h3>{(game.prizes || []).map((prize) => <div key={prize.place}><b>#{prize.place}</b><span>{playerName(game.players.find((player) => player.userId === prize.userId))}</span><strong>{formatChips(prize.amount)} ◆</strong></div>)}</div>}</>}</section>;
}

function PokerLobby({ onOpen, wallet, onWallet }) {
  const [catalog, setCatalog] = useState({ tournaments: [], cashTables: [], myGames: [] });
  const [mode, setMode] = useState("tournaments");
  const [size, setSize] = useState(3);
  const [speed, setSpeed] = useState("normal");
  const [buyIn, setBuyIn] = useState(50);
  const [cashBuyIn, setCashBuyIn] = useState({});
  const load = useCallback(async () => {
    const result = await gameApi("/poker/catalog");
    setCatalog(result);
    onWallet?.(result.wallet);
    let awarded = Number(result.dailyAwarded || 0);
    try {
      const pending = JSON.parse(localStorage.getItem("nemaxDailyBonusNotice") || "null");
      if (!awarded && Number(pending?.amount || 0) > 0) awarded = Number(pending.amount);
      if (awarded) localStorage.removeItem("nemaxDailyBonusNotice");
    } catch {}
    if (awarded) alert(`Ежедневный бонус за вход: +${formatChips(awarded)} условных фишек`);
  }, [onWallet]);
  useEffect(() => { load().catch((error) => alert(error.message)); }, [load]);
  useEffect(() => connectSocket((event) => { if (event.type === "game.poker.updated") load().catch(() => {}); }), [load]);
  const tournaments = catalog.tournaments.filter((item) => item.capacity === Number(size) && item.speed === speed && item.buyIn === Number(buyIn));
  async function joinTournament(preset) { try { const result = await gameApi("/poker/tournaments/join", { method: "POST", body: preset }); onWallet?.(result.wallet); onOpen(result.game.id); } catch (error) { alert(error.message); } }
  async function joinCash(preset) { const amount = Number(cashBuyIn[preset.key] || preset.minBuyIn); try { const result = await gameApi("/poker/cash/join", { method: "POST", body: { smallBlind: preset.smallBlind, bigBlind: preset.bigBlind, buyIn: amount } }); onWallet?.(result.wallet); onOpen(result.game.id); } catch (error) { alert(error.message); } }
  return <section className="poker-lobby"><header><div><span className="section-eyebrow">NEMAX HOLD'EM</span><h2>Техасский холдем на условные фишки</h2><p>Фишки нельзя покупать, продавать или выводить. За первый вход каждого дня сервер начисляет 5 000 фишек.</p></div><div className="wallet-card"><small>Ваш баланс</small><strong>{formatChips(wallet?.balance)} ◆</strong><span>Ежедневно +5 000</span></div></header><nav className="poker-lobby-tabs"><button className={mode === "tournaments" ? "active" : ""} onClick={() => setMode("tournaments")}>Турниры</button><button className={mode === "cash" ? "active" : ""} onClick={() => setMode("cash")}>Кэш-столы</button><button className={mode === "mine" ? "active" : ""} onClick={() => setMode("mine")}>Мои игры</button></nav>{mode === "tournaments" && <><div className="poker-filters"><CustomSelect value={size} onChange={(value) => setSize(Number(value))} options={TOURNAMENT_SIZES.map((value) => ({ value, label: `${value} игроков`, icon: "♟" }))} /><CustomSelect value={speed} onChange={setSpeed} options={[{ value: "normal", label: "Обычный", description: "Уровни блайндов по 5 минут", icon: "◷" }, { value: "turbo", label: "Турбо", description: "Уровни блайндов по 2 минуты", icon: "⚡" }]} /><CustomSelect value={buyIn} onChange={(value) => setBuyIn(Number(value))} options={BUY_INS.map((value) => ({ value, label: `${formatChips(value)} фишек`, icon: "◆" }))} /></div><div className="tournament-cards">{tournaments.map((preset) => <article key={preset.key}><div className="tournament-badge">{preset.speed === "turbo" ? "ТУРБО" : "ОБЫЧНЫЙ"}</div><h3>{preset.capacity}-max Sit & Go</h3><div><span><small>Бай-ин</small><b>{formatChips(preset.buyIn)}</b></span><span><small>Призовой фонд</small><b>{formatChips(preset.prizePool)}</b></span></div><div className="tournament-progress"><i style={{ width: `${(preset.registered / preset.capacity) * 100}%` }} /></div><p>{preset.registered} из {preset.capacity} зарегистрированы</p><button className="btn-main" disabled={wallet?.balance < preset.buyIn} onClick={() => preset.joined && preset.tournamentId ? onOpen(preset.tournamentId) : joinTournament(preset)}>{preset.joined ? "Открыть турнир" : wallet?.balance < preset.buyIn ? "Недостаточно фишек" : "Зарегистрироваться"}</button></article>)}</div></>}{mode === "cash" && <div className="cash-presets">{catalog.cashTables.map((preset) => <article key={preset.key}><div className="cash-blinds"><small>Блайнды</small><strong>{formatChips(preset.smallBlind)}/{formatChips(preset.bigBlind)}</strong></div><p>{preset.seatedPlayers} игроков · {preset.activeTables} столов</p><label>Бай-ин от {formatChips(preset.minBuyIn)} до {formatChips(preset.maxBuyIn)}<input type="number" min={preset.minBuyIn} max={preset.maxBuyIn} value={cashBuyIn[preset.key] || preset.minBuyIn} onChange={(event) => setCashBuyIn((current) => ({ ...current, [preset.key]: Number(event.target.value) }))} /></label><button className="btn-main" onClick={() => preset.myGameId ? onOpen(preset.myGameId) : joinCash(preset)}>{preset.myGameId ? "Вернуться за стол" : "Сесть за стол"}</button></article>)}</div>}{mode === "mine" && <div className="my-poker-games">{catalog.myGames.map((game) => <article key={game.id}><span>{game.mode === "tournament" ? "🏆" : "♠"}</span><div><small>{game.mode === "tournament" ? "Турнир" : "Кэш"}</small><h3>{game.title}</h3><p>{game.status === "waiting" ? "Регистрация" : game.status === "running" ? "Игра идёт" : "Завершено"}</p></div><button className="btn-main" onClick={() => onOpen(game.id)}>Открыть</button></article>)}{!catalog.myGames.length && <div className="rooms-state"><strong>У вас пока нет активных игр</strong></div>}</div>}</section>;
}

export default function OnlineGames() {
  const [section, setSection] = useState("boards");
  const [boardId, setBoardId] = useState("");
  const [pokerId, setPokerId] = useState("");
  const [wallet, setWallet] = useState(null);
  if (boardId) return <BoardTableView tableId={boardId} onExit={() => setBoardId("")} />;
  if (pokerId) return <PokerGameView gameId={pokerId} onExit={() => setPokerId("")} onWallet={setWallet} />;
  return <div className="nemax-online-hub"><div className="online-hub-switch"><button className={section === "boards" ? "active" : ""} onClick={() => setSection("boards")}><span>♞</span><strong>Шахматы и шашки</strong><small>Полные серверные правила</small></button><button className={section === "poker" ? "active" : ""} onClick={() => setSection("poker")}><span>♠</span><strong>Покерные столы</strong><small>Турниры и кэш на условные фишки</small></button></div>{section === "boards" ? <BoardLobby onOpen={setBoardId} /> : <PokerLobby onOpen={setPokerId} wallet={wallet} onWallet={setWallet} />}</div>;
}
