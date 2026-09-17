import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../shared/lib/api";
import CityPicker from "../shared/ui/CityPicker";
import CustomSelect from "../shared/ui/CustomSelect";
import TagInput from "../shared/ui/TagInput";

const ROOM_MODES = [
  { value: "", label: "Все форматы", icon: "✦" },
  { value: "text", label: "Текстовые", icon: "💬", description: "Обычная чат-комната" },
  { value: "voice", label: "Голосовые", icon: "🎙", description: "Комната для общения голосом" },
  { value: "game", label: "Игровые", icon: "🎮", description: "Комната вокруг игры" },
];

const MODE_META = {
  text: { icon: "💬", label: "Текстовая" },
  voice: { icon: "🎙", label: "Голосовая" },
  game: { icon: "🎮", label: "Игровая" },
};

function RoomsPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [tags, setTags] = useState([]);
  const [games, setGames] = useState([]);
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [tag, setTag] = useState("");
  const [mode, setMode] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", city: "", tags: [], roomMode: "text", capacity: 100, requiresApproval: false, gameId: "" });

  const tagOptions = useMemo(() => [{ value: "", label: "Все интересы", icon: "#" }, ...tags.map((item) => ({ value: item, label: `#${item}`, icon: "#" }))], [tags]);
  const gameOptions = useMemo(() => [{ value: "", label: "Без привязанной игры", icon: "—" }, ...games.map((game) => ({ value: game.id, label: `${game.coverEmoji || "🎮"} ${game.title}`, icon: game.coverEmoji || "🎮" }))], [games]);

  const loadRooms = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (city) params.set("city", city);
      if (tag) params.set("tag", tag);
      if (mode) params.set("mode", mode);
      const result = await api(`/rooms?${params}`);
      setRooms(result.rooms || []);
      setTags(result.tags || []);
    } finally { setLoading(false); }
  }, [query, city, tag, mode]);

  useEffect(() => { const timer = setTimeout(() => loadRooms().catch((error) => alert(error.message)), 180); return () => clearTimeout(timer); }, [loadRooms]);
  useEffect(() => { api("/games").then((result) => setGames(result.games || [])).catch(() => {}); }, []);

  async function createRoom(event) {
    event.preventDefault();
    if (!form.city || !form.tags.length) return alert("Выберите город и добавьте хотя бы один тег");
    try {
      const result = await api("/rooms", { method: "POST", body: form });
      setShowCreate(false);
      setForm({ title: "", description: "", city: "", tags: [], roomMode: "text", capacity: 100, requiresApproval: false, gameId: "" });
      await loadRooms();
      localStorage.setItem("openChatId", result.room.id);
      navigate("/");
    } catch (error) { alert(error.message); }
  }

  async function joinRoom(room) {
    if (room.joined) {
      localStorage.setItem("openChatId", room.id);
      navigate("/");
      return;
    }
    try {
      const result = await api(`/rooms/${room.id}/join`, { method: "POST", body: {} });
      if (result.pending) return alert("Заявка отправлена владельцу комнаты");
      localStorage.setItem("openChatId", room.id);
      navigate("/");
    } catch (error) { alert(error.message); }
  }

  return <div className="rooms-page nemax-surface-page">
    <header className="rooms-hero">
      <div><span className="section-eyebrow">НЕМАКС · живое общение</span><h1>Чат-комнаты</h1><p>Находите людей по городу и интересам, создавайте текстовые, голосовые и игровые пространства.</p></div>
      <button className="btn-main" onClick={() => setShowCreate(true)}>＋ Создать комнату</button>
    </header>

    <section className="rooms-toolbar">
      <div className="room-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, описание или интерес" /></div>
      <CityPicker value={city} onChange={setCity} placeholder="Все города мира" compact />
      <CustomSelect value={tag} onChange={setTag} options={tagOptions} />
      <CustomSelect value={mode} onChange={setMode} options={ROOM_MODES} />
    </section>

    {loading && <div className="rooms-state">Загружаем комнаты…</div>}
    {!loading && rooms.length === 0 && <div className="rooms-state"><strong>Комнат пока нет</strong><span>Создайте первую для своего города или интереса.</span></div>}
    <section className="rooms-grid">
      {rooms.map((room) => {
        const meta = MODE_META[room.roomMode] || MODE_META.text;
        const game = games.find((item) => item.id === room.gameId);
        return <article key={room.id} className="room-card" style={{ "--room-accent": room.avatarColor || "#36d1a2" }}>
          <div className="room-card-glow" />
          <header><span className="room-mode-icon">{meta.icon}</span><div><small>{meta.label} комната</small><h2>{room.title}</h2></div><span className={`room-capacity ${room.full ? "full" : ""}`}>{room.participantCount}/{room.capacity}</span></header>
          <p>{room.description || "Описание пока не добавлено."}</p>
          <div className="room-location">⌖ {room.city}</div>
          <div className="room-tags">{(room.tags || []).map((item) => <span key={item}>#{item}</span>)}</div>
          {game && <div className="room-game-link"><span>{game.coverEmoji || "🎮"}</span><div><small>Игра комнаты</small><strong>{game.title}</strong></div></div>}
          <footer><span>{room.requiresApproval ? "Вход по заявке" : room.full ? "Нет свободных мест" : "Можно войти сразу"}</span><button disabled={room.full && !room.joined} onClick={() => joinRoom(room)}>{room.joined ? "Открыть" : room.requiresApproval ? "Подать заявку" : "Войти"} →</button></footer>
        </article>;
      })}
    </section>

    {showCreate && <div className="modal-overlay" onClick={() => setShowCreate(false)}><form className="board-modal wide room-create-modal" onSubmit={createRoom} onClick={(event) => event.stopPropagation()}>
      <div className="modal-title-row"><div><span className="section-eyebrow">Новое пространство</span><h2>Создать чат-комнату</h2></div><button className="modal-close" type="button" onClick={() => setShowCreate(false)}>×</button></div>
      <div className="form-grid-two"><label>Название<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Например: Разработчики Екатеринбурга" /></label><label>Формат<CustomSelect value={form.roomMode} onChange={(value) => setForm({ ...form, roomMode: value, gameId: value === "game" ? form.gameId : "" })} options={ROOM_MODES.filter((item) => item.value)} /></label></div>
      <label>Город<CityPicker value={form.city} onChange={(value) => setForm({ ...form, city: value })} placeholder="Выберите город из справочника" required /></label>
      <label>Интересы<TagInput value={form.tags} onChange={(value) => setForm({ ...form, tags: value })} suggestions={tags} placeholder="Например: разработка, футбол, музыка" max={10} /></label>
      <label>Описание<textarea rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="О чём общаются в комнате" /></label>
      <div className="form-grid-two"><label>Лимит участников<input type="number" min="2" max="5000" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: Number(event.target.value) })} /></label>{form.roomMode === "game" && <label>Игра<CustomSelect value={form.gameId} onChange={(value) => setForm({ ...form, gameId: value })} options={gameOptions} /></label>}</div>
      <label className="check-card"><input type="checkbox" checked={form.requiresApproval} onChange={(event) => setForm({ ...form, requiresApproval: event.target.checked })} /><span><strong>Вступление по заявке</strong><small>Владелец или администратор одобряет новых участников</small></span></label>
      <div className="modal-actions"><button type="button" onClick={() => setShowCreate(false)}>Отмена</button><button className="btn-main">Создать комнату</button></div>
    </form></div>}
  </div>;
}

export default RoomsPage;
