import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gameApi } from "../../shared/lib/api";

const TETROMINOES = [
  { name: "I", cells: [[1, 1, 1, 1]], className: "cyan" },
  { name: "O", cells: [[1, 1], [1, 1]], className: "yellow" },
  { name: "T", cells: [[0, 1, 0], [1, 1, 1]], className: "purple" },
  { name: "S", cells: [[0, 1, 1], [1, 1, 0]], className: "green" },
  { name: "Z", cells: [[1, 1, 0], [0, 1, 1]], className: "red" },
  { name: "J", cells: [[1, 0, 0], [1, 1, 1]], className: "blue" },
  { name: "L", cells: [[0, 0, 1], [1, 1, 1]], className: "orange" },
];

function randomPiece() {
  const source = TETROMINOES[Math.floor(Math.random() * TETROMINOES.length)];
  return { ...source, cells: source.cells.map((row) => [...row]), x: Math.floor((10 - source.cells[0].length) / 2), y: 0 };
}

function rotateCells(cells) {
  return cells[0].map((_, index) => cells.map((row) => row[index]).reverse());
}

function emptyTetrisBoard() {
  return Array.from({ length: 20 }, () => Array(10).fill(""));
}

function TetrisGame({ onClose, onScore }) {
  const [board, setBoard] = useState(emptyTetrisBoard);
  const [piece, setPiece] = useState(randomPiece);
  const [next, setNext] = useState(randomPiece);
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [running, setRunning] = useState(true);
  const [gameOver, setGameOver] = useState(false);
  const submitted = useRef(false);

  const collision = useCallback((candidate, sourceBoard = board) => candidate.cells.some((row, rowIndex) => row.some((cell, colIndex) => {
    if (!cell) return false;
    const y = candidate.y + rowIndex; const x = candidate.x + colIndex;
    return x < 0 || x >= 10 || y >= 20 || (y >= 0 && Boolean(sourceBoard[y][x]));
  })), [board]);

  const lockPiece = useCallback(() => {
    const merged = board.map((row) => [...row]);
    piece.cells.forEach((row, rowIndex) => row.forEach((cell, colIndex) => {
      if (cell && piece.y + rowIndex >= 0) merged[piece.y + rowIndex][piece.x + colIndex] = piece.className;
    }));
    const remaining = merged.filter((row) => row.some((cell) => !cell));
    const cleared = 20 - remaining.length;
    while (remaining.length < 20) remaining.unshift(Array(10).fill(""));
    setBoard(remaining);
    if (cleared) { setLines((value) => value + cleared); setScore((value) => value + [0, 100, 300, 500, 800][cleared]); }
    const spawned = { ...next, x: Math.floor((10 - next.cells[0].length) / 2), y: 0 };
    setPiece(spawned); setNext(randomPiece());
    if (collision(spawned, remaining)) { setRunning(false); setGameOver(true); }
  }, [board, piece, next, collision]);

  const move = useCallback((dx, dy, rotate = false) => {
    if (!running || gameOver) return;
    const candidate = { ...piece, x: piece.x + dx, y: piece.y + dy, cells: rotate ? rotateCells(piece.cells) : piece.cells };
    if (!collision(candidate)) setPiece(candidate);
    else if (dy > 0 && !rotate) lockPiece();
  }, [piece, collision, lockPiece, running, gameOver]);

  useEffect(() => {
    if (!running || gameOver) return undefined;
    const timer = setInterval(() => move(0, 1), Math.max(130, 650 - Math.floor(lines / 8) * 55));
    return () => clearInterval(timer);
  }, [move, running, gameOver, lines]);

  useEffect(() => {
    const onKey = (event) => {
      if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " "].includes(event.key)) event.preventDefault();
      if (event.key === "ArrowLeft") move(-1, 0);
      if (event.key === "ArrowRight") move(1, 0);
      if (event.key === "ArrowDown") move(0, 1);
      if (event.key === "ArrowUp") move(0, 0, true);
      if (event.key === " ") { let guard = 0; while (guard < 24) { guard += 1; const candidate = { ...piece, y: piece.y + guard }; if (collision(candidate)) { setPiece({ ...piece, y: piece.y + guard - 1 }); setTimeout(lockPiece, 0); break; } } }
      if (event.key.toLowerCase() === "p") setRunning((value) => !value);
    };
    window.addEventListener("keydown", onKey, { passive: false }); return () => window.removeEventListener("keydown", onKey);
  }, [move, piece, collision, lockPiece]);

  useEffect(() => {
    if (gameOver && !submitted.current) { submitted.current = true; onScore?.(score, { lines }); }
  }, [gameOver, score, lines, onScore]);

  const visible = useMemo(() => {
    const result = board.map((row) => [...row]);
    piece.cells.forEach((row, rowIndex) => row.forEach((cell, colIndex) => {
      const y = piece.y + rowIndex; const x = piece.x + colIndex;
      if (cell && y >= 0 && y < 20 && x >= 0 && x < 10) result[y][x] = piece.className;
    }));
    return result;
  }, [board, piece]);

  function restart() {
    setBoard(emptyTetrisBoard()); setPiece(randomPiece()); setNext(randomPiece()); setScore(0); setLines(0); setGameOver(false); setRunning(true); submitted.current = false;
  }

  return <div className="arcade-modal"><header><div><span>▦</span><div><small>НЕМАКС ARCADE</small><h2>Тетрис</h2></div></div><button onClick={onClose}>×</button></header><div className="tetris-layout"><div className="tetris-board">{visible.flatMap((row, rowIndex) => row.map((cell, colIndex) => <i key={`${rowIndex}-${colIndex}`} className={cell || "empty"} />))}{gameOver && <div className="arcade-gameover"><strong>Игра окончена</strong><span>{score} очков</span><button onClick={restart}>Заново</button></div>}{!running && !gameOver && <div className="arcade-gameover"><strong>Пауза</strong><button onClick={() => setRunning(true)}>Продолжить</button></div>}</div><aside><div className="arcade-stats"><span><small>Счёт</small><strong>{score}</strong></span><span><small>Линии</small><strong>{lines}</strong></span></div><div className="next-piece"><small>Следующая фигура</small><div>{next.cells.flatMap((row, rowIndex) => row.map((cell, colIndex) => <i key={`${rowIndex}-${colIndex}`} className={cell ? next.className : "empty"} />))}</div></div><p>← → движение<br />↑ поворот<br />↓ ускорение<br />Space сброс<br />P пауза</p><div className="arcade-controls"><button onClick={() => move(-1, 0)}>←</button><button onClick={() => move(0, 0, true)}>↻</button><button onClick={() => move(1, 0)}>→</button><button onClick={() => move(0, 1)}>↓</button></div></aside></div></div>;
}

function randomFood(snake) {
  let point;
  do point = { x: Math.floor(Math.random() * 20), y: Math.floor(Math.random() * 20) };
  while (snake.some((part) => part.x === point.x && part.y === point.y));
  return point;
}

function SnakeGame({ onClose, onScore }) {
  const [snake, setSnake] = useState([{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }]);
  const [food, setFood] = useState({ x: 14, y: 10 });
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(true);
  const [gameOver, setGameOver] = useState(false);
  const direction = useRef({ x: 1, y: 0 });
  const queuedDirection = useRef({ x: 1, y: 0 });
  const submitted = useRef(false);

  const changeDirection = useCallback((x, y) => {
    if (direction.current.x + x === 0 && direction.current.y + y === 0) return;
    queuedDirection.current = { x, y };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      const map = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
      const target = map[event.key]; if (target) { event.preventDefault(); changeDirection(...target); }
      if (event.key.toLowerCase() === "p") setRunning((value) => !value);
    };
    window.addEventListener("keydown", onKey, { passive: false }); return () => window.removeEventListener("keydown", onKey);
  }, [changeDirection]);

  useEffect(() => {
    if (!running || gameOver) return undefined;
    const timer = setInterval(() => setSnake((current) => {
      direction.current = queuedDirection.current;
      const head = { x: current[0].x + direction.current.x, y: current[0].y + direction.current.y };
      const hit = head.x < 0 || head.x >= 20 || head.y < 0 || head.y >= 20 || current.some((part, index) => index < current.length - 1 && part.x === head.x && part.y === head.y);
      if (hit) { setGameOver(true); setRunning(false); return current; }
      const ate = head.x === food.x && head.y === food.y;
      const next = [head, ...current];
      if (!ate) next.pop(); else { setScore((value) => value + 10); setFood(randomFood(next)); }
      return next;
    }), Math.max(70, 170 - Math.floor(score / 50) * 10));
    return () => clearInterval(timer);
  }, [running, gameOver, food, score]);

  useEffect(() => {
    if (gameOver && !submitted.current) { submitted.current = true; onScore?.(score, { length: snake.length }); }
  }, [gameOver, score, snake.length, onScore]);

  function restart() {
    const initial = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    setSnake(initial); setFood(randomFood(initial)); setScore(0); setGameOver(false); setRunning(true); direction.current = { x: 1, y: 0 }; queuedDirection.current = { x: 1, y: 0 }; submitted.current = false;
  }

  const occupied = new Map(snake.map((part, index) => [`${part.x}-${part.y}`, index]));
  return <div className="arcade-modal"><header><div><span>◉</span><div><small>НЕМАКС ARCADE</small><h2>Змейка</h2></div></div><button onClick={onClose}>×</button></header><div className="snake-layout"><div className="snake-board">{Array.from({ length: 400 }, (_, index) => { const x = index % 20; const y = Math.floor(index / 20); const snakeIndex = occupied.get(`${x}-${y}`); const isFood = food.x === x && food.y === y; return <i key={index} className={snakeIndex === 0 ? "head" : snakeIndex !== undefined ? "body" : isFood ? "food" : ""} />; })}{gameOver && <div className="arcade-gameover"><strong>Столкновение</strong><span>{score} очков</span><button onClick={restart}>Заново</button></div>}{!running && !gameOver && <div className="arcade-gameover"><strong>Пауза</strong><button onClick={() => setRunning(true)}>Продолжить</button></div>}</div><aside><div className="arcade-stats"><span><small>Счёт</small><strong>{score}</strong></span><span><small>Длина</small><strong>{snake.length}</strong></span></div><p>Стрелки или WASD<br />P — пауза</p><div className="snake-controls"><button onClick={() => changeDirection(0, -1)}>↑</button><div><button onClick={() => changeDirection(-1, 0)}>←</button><button onClick={() => changeDirection(0, 1)}>↓</button><button onClick={() => changeDirection(1, 0)}>→</button></div></div></aside></div></div>;
}

const ARCADES = [
  { id: "tetris", title: "Тетрис", icon: "▦", description: "Собирайте линии, ускоряйтесь и ставьте рекорды.", accent: "#24d8ff" },
  { id: "snake", title: "Змейка", icon: "◉", description: "Классическая змейка с управлением для ПК и телефона.", accent: "#68f58d" },
];

export default function ArcadeHub() {
  const [active, setActive] = useState(null);
  const [leaderboards, setLeaderboards] = useState({});

  async function submitScore(game, score, meta) {
    try {
      await gameApi("/arcade/score", { method: "POST", body: { game, score, meta } });
      const result = await gameApi(`/arcade/leaderboard?game=${game}`);
      setLeaderboards((current) => ({ ...current, [game]: result.leaderboard || [] }));
    } catch {}
  }

  async function showLeaderboard(game) {
    try { const result = await gameApi(`/arcade/leaderboard?game=${game}`); setLeaderboards((current) => ({ ...current, [game]: result.leaderboard || [] })); }
    catch (error) { alert(error.message); }
  }

  return <section className="arcade-hub"><header><div><span className="section-eyebrow">Встроенная аркада</span><h2>Игры, которые запускаются сразу</h2><p>Рекорды сохраняются в профиле НЕМАКС и попадают в общую таблицу.</p></div></header><div className="arcade-grid">{ARCADES.map((game) => <article key={game.id} style={{ "--arcade-accent": game.accent }}><div className="arcade-cover"><span>{game.icon}</span></div><div><small>НЕМАКС ARCADE</small><h3>{game.title}</h3><p>{game.description}</p></div><footer><button className="btn-main" onClick={() => setActive(game.id)}>Играть</button><button onClick={() => showLeaderboard(game.id)}>Рекорды</button></footer>{leaderboards[game.id] && <div className="arcade-leaderboard">{leaderboards[game.id].slice(0, 5).map((entry) => <div key={entry.id}><b>{entry.place}</b><span>{entry.user?.username ? `@${entry.user.username}` : entry.user?.displayName || "Игрок"}</span><strong>{entry.score}</strong></div>)}{leaderboards[game.id].length === 0 && <small>Рекордов пока нет</small>}</div>}</article>)}</div>{active && <div className="modal-overlay game-player-overlay" onClick={() => setActive(null)}><div onClick={(event) => event.stopPropagation()}>{active === "tetris" ? <TetrisGame onClose={() => setActive(null)} onScore={(score, meta) => submitScore("tetris", score, meta)} /> : <SnakeGame onClose={() => setActive(null)} onScore={(score, meta) => submitScore("snake", score, meta)} />}</div></div>}</section>;
}
