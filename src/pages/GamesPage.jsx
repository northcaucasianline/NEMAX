import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../shared/lib/api";
import CustomSelect from "../shared/ui/CustomSelect";
import TagInput from "../shared/ui/TagInput";
import CodeStudio from "../features/code-studio/CodeStudio";
import NovelBuilder, { createNovelConfig } from "../features/novel-builder/NovelBuilder";
import NovelPlayer from "../features/novel-player/NovelPlayer";
import ArcadeHub from "../features/arcade/ArcadeHub";
import OnlineGames from "../features/online-games/OnlineGames";

const GAME_TYPES = [
  { value: "quiz", label: "Викторина", icon: "?", description: "Вопросы с вариантами ответа" },
  { value: "clicker", label: "Кликер", icon: "⚡", description: "Наберите максимум за время" },
  { value: "reaction", label: "Реакция", icon: "◎", description: "Проверка скорости реакции" },
  { value: "novel", label: "Игра-новелла", icon: "✦", description: "Сцены, персонажи и развилки сюжета" },
];

function initialGame() {
  return {
    title: "", description: "", type: "quiz", coverEmoji: "🎮", accentColor: "#7c5cff", tags: [], published: false,
    config: {
      questions: [{ text: "", options: ["", "", "", ""], correctIndex: 0 }],
      duration: 15, target: 50, buttonLabel: "Жми!", rounds: 5,
      ...createNovelConfig(),
    },
  };
}

function GamePlayer({ game, onClose, onFinish }) {
  const [phase, setPhase] = useState("ready");
  const [score, setScore] = useState(0);
  const [index, setIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(Number(game.config?.duration || 15));
  const [reactionState, setReactionState] = useState("idle");
  const [reactionStartedAt, setReactionStartedAt] = useState(0);
  const [reactionTimes, setReactionTimes] = useState([]);
  const startRef = useRef(Date.now());
  const timerRef = useRef(null);
  const submittedRef = useRef(false);

  useEffect(() => () => { clearTimeout(timerRef.current); }, []);
  useEffect(() => {
    if (game.type !== "clicker" || phase !== "playing") return undefined;
    const interval = setInterval(() => setTimeLeft((value) => {
      if (value <= 1) { clearInterval(interval); setPhase("done"); return 0; }
      return value - 1;
    }), 1000);
    return () => clearInterval(interval);
  }, [game.type, phase]);

  useEffect(() => {
    if (phase === "done" && !submittedRef.current) {
      submittedRef.current = true;
      onFinish?.(score, Date.now() - startRef.current, { reactionTimes });
    }
  }, [phase, score, reactionTimes, onFinish]);

  function answer(optionIndex) {
    const questions = game.config?.questions || [];
    const current = questions[index];
    const nextScore = score + (Number(current?.correctIndex) === optionIndex ? 100 : 0);
    setScore(nextScore);
    if (index + 1 >= questions.length) setPhase("done"); else setIndex(index + 1);
  }

  function startReactionRound() {
    setReactionState("waiting");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setReactionStartedAt(performance.now()); setReactionState("go"); }, 900 + Math.random() * 2600);
  }

  function hitReaction() {
    if (reactionState === "waiting") { clearTimeout(timerRef.current); setReactionState("early"); return; }
    if (reactionState !== "go") return;
    const elapsed = Math.round(performance.now() - reactionStartedAt);
    const nextTimes = [...reactionTimes, elapsed];
    setReactionTimes(nextTimes);
    setScore((current) => current + Math.max(0, 1000 - elapsed));
    if (nextTimes.length >= Number(game.config?.rounds || 5)) setPhase("done");
    else { setReactionState("result"); setTimeout(startReactionRound, 850); }
  }

  const questions = game.config?.questions || [];
  const currentQuestion = questions[index];
  const typeMeta = GAME_TYPES.find((item) => item.value === game.type);

  if (game.type === "novel") {
    return <div className="modal-overlay game-player-overlay" onClick={onClose}><div className="game-player novel-game-modal" style={{ "--game-accent": game.accentColor || "#7c5cff" }} onClick={(event) => event.stopPropagation()}><header><span>{game.coverEmoji || "📖"}</span><div><small>{typeMeta?.label}</small><h2>{game.title}</h2></div><button onClick={onClose}>×</button></header><NovelPlayer game={game} onFinish={(novelScore, meta) => onFinish?.(novelScore, Date.now() - startRef.current, meta)} /></div></div>;
  }

  return <div className="modal-overlay game-player-overlay" onClick={onClose}><div className="game-player" style={{ "--game-accent": game.accentColor || "#7c5cff" }} onClick={(event) => event.stopPropagation()}>
    <header><span>{game.coverEmoji || "🎮"}</span><div><small>{typeMeta?.label}</small><h2>{game.title}</h2></div><button onClick={onClose}>×</button></header>
    {phase === "ready" && <div className="game-ready"><div className="game-cover-orb">{game.coverEmoji || "🎮"}</div><p>{game.description || "Готовы начать?"}</p><button className="btn-main" onClick={() => { startRef.current = Date.now(); setPhase("playing"); if (game.type === "reaction") setTimeout(startReactionRound, 350); }}>Начать игру</button></div>}
    {phase === "playing" && game.type === "quiz" && <div className="quiz-player"><div className="game-progress"><span>Вопрос {index + 1} из {questions.length}</span><b>{score} очков</b></div><h3>{currentQuestion?.text || "Вопрос без текста"}</h3><div className="quiz-options">{(currentQuestion?.options || []).map((option, optionIndex) => <button key={optionIndex} onClick={() => answer(optionIndex)}><span>{String.fromCharCode(65 + optionIndex)}</span>{option || `Вариант ${optionIndex + 1}`}</button>)}</div></div>}
    {phase === "playing" && game.type === "clicker" && <div className="clicker-player"><div className="clicker-stats"><span><small>Осталось</small><strong>{timeLeft}с</strong></span><span><small>Счёт</small><strong>{score}</strong></span></div><button className="clicker-target" onClick={() => setScore((value) => value + 1)}>{game.config?.buttonLabel || "Жми!"}</button><p>Цель автора: {game.config?.target || 50}</p></div>}
    {phase === "playing" && game.type === "reaction" && <div className={`reaction-player ${reactionState}`} onClick={hitReaction}><div className="reaction-target">{reactionState === "waiting" ? "Ждите…" : reactionState === "go" ? "ЖМИ!" : reactionState === "early" ? "Слишком рано" : reactionState === "result" ? `${reactionTimes.at(-1)} мс` : "Приготовьтесь"}</div><p>Раунд {Math.min(reactionTimes.length + 1, Number(game.config?.rounds || 5))} из {game.config?.rounds || 5}</p>{reactionState === "early" && <button onClick={(event) => { event.stopPropagation(); startReactionRound(); }}>Повторить раунд</button>}</div>}
    {phase === "done" && <div className="game-finish"><div className="game-trophy">✦</div><h3>Игра завершена</h3><strong>{score} очков</strong>{reactionTimes.length > 0 && <p>Средняя реакция: {Math.round(reactionTimes.reduce((sum, item) => sum + item, 0) / reactionTimes.length)} мс</p>}<div><button onClick={onClose}>Закрыть</button><button className="btn-main" onClick={() => { submittedRef.current = false; setScore(0); setIndex(0); setTimeLeft(Number(game.config?.duration || 15)); setReactionTimes([]); setReactionState("idle"); setPhase("ready"); }}>Ещё раз</button></div></div>}
  </div></div>;
}

function GamesPage() {
  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const [games, setGames] = useState([]);
  const [tags, setTags] = useState([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [tab, setTab] = useState(() => ["code", "online", "arcade", "builder", "mine"].includes(requestedSection) ? requestedSection : "catalog");
  const [builder, setBuilder] = useState(initialGame);
  const [editingId, setEditingId] = useState("");
  const [playing, setPlaying] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (tag) params.set("tag", tag);
    if (tab === "mine") params.set("mine", "1");
    const result = await api(`/games?${params}`);
    setGames(result.games || []); setTags(result.tags || []);
  }, [query, tag, tab]);

  useEffect(() => {
    if (!["catalog", "mine"].includes(tab)) return undefined;
    const timer = setTimeout(() => load().catch((error) => alert(error.message)), 160);
    return () => clearTimeout(timer);
  }, [load, tab]);

  const tagOptions = useMemo(() => [{ value: "", label: "Все жанры", icon: "✦" }, ...tags.map((item) => ({ value: item, label: `#${item}`, icon: "#" }))], [tags]);

  function updateQuestion(questionIndex, patch) {
    setBuilder((current) => ({ ...current, config: { ...current.config, questions: current.config.questions.map((question, index) => index === questionIndex ? { ...question, ...patch } : question) } }));
  }

  function changeType(value) {
    setBuilder((current) => ({ ...current, type: value, coverEmoji: value === "novel" && current.coverEmoji === "🎮" ? "📖" : current.coverEmoji, config: value === "novel" && !current.config?.scenes?.length ? { ...current.config, ...createNovelConfig() } : current.config }));
  }

  async function saveGame(event) {
    event.preventDefault();
    try {
      const path = editingId ? `/games/${editingId}` : "/games";
      const result = await api(path, { method: editingId ? "PATCH" : "POST", body: builder });
      setEditingId(result.game.id); setBuilder(result.game); setTab("mine"); await load();
      alert("Игра сохранена");
    } catch (error) { alert(error.message); }
  }

  function editGame(game) {
    const base = initialGame();
    setBuilder({ ...base, ...game, config: { ...base.config, ...(game.config || {}) } });
    setEditingId(game.id); setTab("builder");
  }
  function newGame(type = "quiz") {
    const base = initialGame();
    base.type = type;
    if (type === "novel") { base.coverEmoji = "📖"; base.title = "Новая история"; }
    setBuilder(base); setEditingId(""); setTab("builder");
  }
  async function togglePublish(game) { await api(`/games/${game.id}/publish`, { method: "POST", body: {} }); await load(); }
  async function removeGame(game) { if (!confirm(`Удалить игру «${game.title}»?`)) return; await api(`/games/${game.id}`, { method: "DELETE" }); await load(); }
  async function finishGame(score, durationMs, meta) { if (!playing || playing.id === "preview") return; await api(`/games/${playing.id}/score`, { method: "POST", body: { score, durationMs, meta } }).catch(() => {}); }
  async function openLeaderboard(game) { const result = await api(`/games/${game.id}/leaderboard`); setLeaderboard(result.leaderboard || []); }

  return <div className="games-page nemax-surface-page">
    <header className="games-hero"><div><span className="section-eyebrow">НЕМАКС PLAY</span><h1>Игры, новеллы и приложения</h1><p>Создавайте интерактивные истории, играйте в аркады, открывайте онлайн-столы или пишите собственные приложения в Code Studio.</p></div><div className="games-hero-actions"><button onClick={() => setTab("online")}>♞ Онлайн-столы</button><button onClick={() => setTab("code")}>⌘ Code Studio</button><button className="btn-main" onClick={() => newGame("novel")}>＋ Создать новеллу</button></div></header>
    <nav className="games-tabs"><button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>Каталог</button><button className={tab === "arcade" ? "active" : ""} onClick={() => setTab("arcade")}>Аркада</button><button className={tab === "online" ? "active" : ""} onClick={() => setTab("online")}>Онлайн-столы</button><button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>Мои проекты</button><button className={tab === "builder" ? "active" : ""} onClick={() => setTab("builder")}>Конструктор</button><button className={tab === "code" ? "active code-tab" : "code-tab"} onClick={() => setTab("code")}>⌘ Code Studio</button></nav>

    {["catalog", "mine"].includes(tab) && <><section className="games-toolbar"><div className="room-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск игр и новелл" /></div><CustomSelect value={tag} onChange={setTag} options={tagOptions} /></section><section className="games-grid">{games.map((game) => { const meta = GAME_TYPES.find((item) => item.value === game.type); return <article className="game-card" key={game.id} style={{ "--game-accent": game.accentColor || "#7c5cff" }}><div className="game-card-cover"><span>{game.coverEmoji || "🎮"}</span><i>{meta?.label || game.type}</i></div><div className="game-card-body"><h2>{game.title}</h2><p>{game.description || "Описание не добавлено"}</p><div className="game-card-tags">{(game.tags || []).map((item) => <span key={item}>#{item}</span>)}</div><small>{game.plays || 0} запусков · рекорд {game.bestScore || 0}</small></div><footer><button onClick={() => { setPlaying(game); openLeaderboard(game); }}>Играть</button>{tab === "mine" && <><button onClick={() => editGame(game)}>Изменить</button><button onClick={() => togglePublish(game)}>{game.published ? "Снять" : "Опубликовать"}</button><button className="danger-link" onClick={() => removeGame(game)}>Удалить</button></>}</footer></article>; })}</section>{games.length === 0 && <div className="rooms-state"><strong>Игр пока нет</strong><span>Откройте конструктор и соберите первую.</span></div>}</>}

    {tab === "builder" && <form className={`game-builder ${builder.type === "novel" ? "novel-mode" : ""}`} onSubmit={saveGame}><aside><span className="section-eyebrow">Конструктор без кода</span><h2>{editingId ? "Редактирование" : "Новая игра"}</h2><p>{builder.type === "novel" ? "Соберите сюжет из сцен, диалогов и вариантов выбора, затем опубликуйте историю в каталоге." : "Настройте механику, содержание и внешний вид. Результат можно сразу протестировать."}</p><div className="game-preview-mini" style={{ "--game-accent": builder.accentColor }}><span>{builder.coverEmoji}</span><strong>{builder.title || "Название игры"}</strong><small>{GAME_TYPES.find((item) => item.value === builder.type)?.label}</small></div><button type="button" onClick={() => setPlaying({ ...builder, id: editingId || "preview" })}>Предпросмотр</button></aside><main>
      <div className="form-grid-two"><label>Название<input required value={builder.title} onChange={(event) => setBuilder({ ...builder, title: event.target.value })} /></label><label>Тип игры<CustomSelect value={builder.type} onChange={changeType} options={GAME_TYPES} /></label></div>
      <label>Описание<textarea rows={3} value={builder.description} onChange={(event) => setBuilder({ ...builder, description: event.target.value })} /></label>
      <div className="form-grid-two"><label>Эмодзи обложки<input value={builder.coverEmoji} onChange={(event) => setBuilder({ ...builder, coverEmoji: event.target.value.slice(0, 12) })} /></label><label>Акцентный цвет<input type="color" value={builder.accentColor} onChange={(event) => setBuilder({ ...builder, accentColor: event.target.value })} /></label></div>
      <label>Жанры и теги<TagInput value={builder.tags} onChange={(value) => setBuilder({ ...builder, tags: value })} suggestions={tags} /></label>
      {builder.type === "quiz" && <section className="quiz-builder"><header><div><h3>Вопросы</h3><p>Отметьте правильный вариант кружком.</p></div><button type="button" onClick={() => setBuilder((current) => ({ ...current, config: { ...current.config, questions: [...current.config.questions, { text: "", options: ["", "", "", ""], correctIndex: 0 }] } }))}>＋ Вопрос</button></header>{builder.config.questions.map((question, questionIndex) => <article key={questionIndex}><div className="question-title"><b>{questionIndex + 1}</b><input value={question.text} onChange={(event) => updateQuestion(questionIndex, { text: event.target.value })} placeholder="Текст вопроса" />{builder.config.questions.length > 1 && <button type="button" onClick={() => setBuilder((current) => ({ ...current, config: { ...current.config, questions: current.config.questions.filter((_, index) => index !== questionIndex) } }))}>×</button>}</div><div className="question-options">{question.options.map((option, optionIndex) => <label key={optionIndex}><input type="radio" name={`correct-${questionIndex}`} checked={Number(question.correctIndex) === optionIndex} onChange={() => updateQuestion(questionIndex, { correctIndex: optionIndex })} /><input value={option} onChange={(event) => updateQuestion(questionIndex, { options: question.options.map((item, index) => index === optionIndex ? event.target.value : item) })} placeholder={`Вариант ${optionIndex + 1}`} /></label>)}</div></article>)}</section>}
      {builder.type === "clicker" && <section className="mechanic-settings"><h3>Настройки кликера</h3><div className="form-grid-three"><label>Время, сек<input type="number" min="5" max="120" value={builder.config.duration} onChange={(event) => setBuilder({ ...builder, config: { ...builder.config, duration: Number(event.target.value) } })} /></label><label>Целевой счёт<input type="number" min="1" max="100000" value={builder.config.target} onChange={(event) => setBuilder({ ...builder, config: { ...builder.config, target: Number(event.target.value) } })} /></label><label>Текст кнопки<input value={builder.config.buttonLabel} onChange={(event) => setBuilder({ ...builder, config: { ...builder.config, buttonLabel: event.target.value } })} /></label></div></section>}
      {builder.type === "reaction" && <section className="mechanic-settings"><h3>Настройки реакции</h3><label>Количество раундов<input type="number" min="1" max="20" value={builder.config.rounds} onChange={(event) => setBuilder({ ...builder, config: { ...builder.config, rounds: Number(event.target.value) } })} /></label></section>}
      {builder.type === "novel" && <NovelBuilder value={builder.config} onChange={(config) => setBuilder((current) => ({ ...current, config: { ...current.config, ...config } }))} />}
      <div className="builder-actions"><button type="button" onClick={() => setPlaying({ ...builder, id: editingId || "preview" })}>▶ Тестировать</button><button className="btn-main">Сохранить проект</button></div>
    </main></form>}

    {tab === "arcade" && <ArcadeHub />}
    {tab === "online" && <OnlineGames />}
    {tab === "code" && <CodeStudio />}

    {playing && <GamePlayer game={playing} onClose={() => setPlaying(null)} onFinish={finishGame} />}
    {playing && playing.id !== "preview" && leaderboard.length > 0 && <aside className="leaderboard-float"><h3>Таблица лидеров</h3>{leaderboard.slice(0, 5).map((item) => <div key={item.id}><b>{item.place}</b><span>{item.user?.username || item.user?.displayName || "Игрок"}</span><strong>{item.score}</strong></div>)}</aside>}
  </div>;
}

export default GamesPage;
