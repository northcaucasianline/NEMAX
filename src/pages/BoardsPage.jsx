import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { absoluteMediaUrl, api, uploadLargeFile } from "../shared/lib/api";
import useAuth from "../hooks/useAuth";
import Avatar from "../shared/ui/Avatar";
import CityPicker from "../shared/ui/CityPicker";
import CustomSelect from "../shared/ui/CustomSelect";
import TagInput from "../shared/ui/TagInput";
import VideoPlayer from "../shared/media/VideoPlayer";

const CATEGORIES = [
  { value: "", label: "Все", icon: "✦", description: "Вся лента" },
  { value: "Общее", label: "Общее", icon: "◈", description: "Разное" },
  { value: "Куплю", label: "Куплю", icon: "⌕", description: "Ищу товар" },
  { value: "Продам", label: "Продам", icon: "↗", description: "Предложения" },
  { value: "Услуги", label: "Услуги", icon: "⚙", description: "Помощь и сервис" },
  { value: "Работа", label: "Работа", icon: "▣", description: "Вакансии" },
  { value: "События", label: "События", icon: "◇", description: "Афиша" },
  { value: "Ищу людей", label: "Ищу людей", icon: "◎", description: "Команда и общение" },
  { value: "Отдам бесплатно", label: "Отдам", icon: "♡", description: "Бесплатно" },
];

function formatDate(value) {
  return new Date(value).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function BoardMedia({ item }) {
  const url = absoluteMediaUrl(item.content);
  if (item.mimeType?.startsWith("image/")) return <img src={url} alt={item.name || "Фото объявления"} />;
  if (item.mimeType?.startsWith("video/")) return <VideoPlayer src={url} title={item.name || "Видео объявления"} compact className="board-video-player" />;
  return <a href={url} download={item.name}>📎 {item.name || "Файл"}</a>;
}

function BoardCategoryGrid({ value, onChange }) {
  return <div className="board-category-grid" aria-label="Тип объявления">
    {CATEGORIES.map((item) => <button type="button" key={item.value || "all"} className={value === item.value ? "active" : ""} onClick={() => onChange(item.value)}>
      <span className="category-icon">{item.icon}</span>
      <span><strong>{item.label}</strong><small>{item.description}</small></span>
    </button>)}
  </div>;
}

function BoardsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [boards, setBoards] = useState([]);
  const [interests, setInterests] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState(() => location.state?.boardId || localStorage.getItem("openBoardId") || "");
  const [posts, setPosts] = useState([]);
  const [city, setCity] = useState("");
  const [interest, setInterest] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [boardForm, setBoardForm] = useState({ city: user.city || "", tags: [], title: "", description: "" });
  const [postForm, setPostForm] = useState({ title: "", text: "", category: "Общее", tags: [], contacts: "", media: [] });
  const [uploading, setUploading] = useState(0);

  const selectedBoard = useMemo(() => boards.find((item) => item.id === selectedBoardId) || null, [boards, selectedBoardId]);
  const interestOptions = useMemo(() => [{ value: "", label: "Все интересы", icon: "✦" }, ...interests.map((item) => ({ value: item, label: `#${item}`, icon: "#" }))], [interests]);
  const categoryOptions = useMemo(() => CATEGORIES.filter((item) => item.value), []);

  const loadBoards = useCallback(async () => {
    const params = new URLSearchParams();
    if (city) params.set("city", city);
    if (interest) params.set("tag", interest);
    if (query) params.set("q", query);
    const result = await api(`/boards?${params.toString()}`);
    setBoards(result.boards || []);
    setInterests(result.interests || []);
    setSelectedBoardId((current) => current && result.boards?.some((item) => item.id === current) ? current : result.boards?.[0]?.id || "");
  }, [city, interest, query]);

  const loadPosts = useCallback(async () => {
    if (!selectedBoardId) { setPosts([]); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (query) params.set("q", query);
      const result = await api(`/boards/${selectedBoardId}/posts?${params.toString()}`);
      setPosts(result.posts || []);
    } catch (error) { alert(error.message); }
    finally { setLoading(false); }
  }, [selectedBoardId, category, query]);

  useEffect(() => { const timer = setTimeout(() => loadBoards().catch((error) => alert(error.message)), 250); return () => clearTimeout(timer); }, [loadBoards]);
  useEffect(() => { if (selectedBoardId) { localStorage.setItem("openBoardId", selectedBoardId); window.history.replaceState({}, document.title); } }, [selectedBoardId]);
  useEffect(() => { loadPosts(); }, [loadPosts]);

  async function createBoard(event) {
    event.preventDefault();
    if (!boardForm.city || !boardForm.tags.length) return alert("Выберите город и добавьте хотя бы один интерес");
    try {
      const result = await api("/boards", { method: "POST", body: { ...boardForm, interest: boardForm.tags[0] } });
      setShowCreateBoard(false);
      setBoardForm({ city: user.city || "", tags: [], title: "", description: "" });
      await loadBoards();
      setSelectedBoardId(result.board.id);
    } catch (error) { alert(error.message); }
  }

  async function addMedia(event) {
    const files = [...event.target.files].slice(0, 8 - postForm.media.length); event.target.value = "";
    for (const file of files) {
      try {
        setUploading(1);
        const uploaded = await uploadLargeFile(file, setUploading);
        setPostForm((current) => ({ ...current, media: [...current.media, uploaded].slice(0, 8) }));
      } catch (error) { alert(error.message); }
    }
    setUploading(0);
  }

  async function createPost(event) {
    event.preventDefault();
    if (!selectedBoardId) return;
    try {
      await api(`/boards/${selectedBoardId}/posts`, { method: "POST", body: postForm });
      setShowCreatePost(false);
      setPostForm({ title: "", text: "", category: "Общее", tags: [], contacts: "", media: [] });
      await loadPosts();
    } catch (error) { alert(error.message); }
  }

  async function toggleFavorite(postId) {
    try { await api(`/board-posts/${postId}/favorite`, { method: "POST", body: {} }); await loadPosts(); }
    catch (error) { alert(error.message); }
  }

  async function comment(postId) {
    const value = prompt("Комментарий к объявлению");
    if (!value?.trim()) return;
    try { await api(`/board-posts/${postId}/comments`, { method: "POST", body: { text: value } }); await loadPosts(); }
    catch (error) { alert(error.message); }
  }

  async function removePost(postId) {
    if (!confirm("Удалить объявление?")) return;
    try { await api(`/board-posts/${postId}`, { method: "DELETE" }); await loadPosts(); }
    catch (error) { alert(error.message); }
  }

  return <div className="boards-page nemax-surface-page">
    <aside className="boards-sidebar">
      <div className="boards-title"><div><span className="section-eyebrow">НЕМАКС · локально</span><h1>Доски</h1><p>Сообщества и объявления по городам и интересам</p></div><button className="round-gradient-button" onClick={() => setShowCreateBoard(true)} aria-label="Создать доску">＋</button></div>
      <div className="board-search-input"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск досок и объявлений" /></div>
      <CityPicker value={city} onChange={setCity} placeholder="Все города мира" compact />
      <CustomSelect value={interest} onChange={setInterest} options={interestOptions} placeholder="Все интересы" icon="#" />
      <div className="boards-filter-summary">{city || interest ? <><span>{city || "Любой город"}</span><span>{interest ? `#${interest}` : "Все темы"}</span></> : <span>Показаны все доступные доски</span>}</div>
      <div className="boards-list">{boards.map((board) => <button key={board.id} className={selectedBoardId === board.id ? "active" : ""} onClick={() => setSelectedBoardId(board.id)}>
        <span className="board-list-mark" style={{ "--board-color": board.color || "#7c5cff" }}>{board.tags?.[0]?.[0] || board.interest?.[0] || "#"}</span>
        <div><strong>{board.title}</strong><small>{board.city} · {board.postsCount} объявлений</small><div className="mini-tags">{(board.tags || [board.interest]).filter(Boolean).slice(0, 3).map((tag) => <i key={tag}>#{tag}</i>)}</div></div>
      </button>)}</div>
    </aside>

    <main className="boards-main">
      {selectedBoard ? <>
        <header className="board-head"><div><span className="board-kicker">⌖ {selectedBoard.city}</span><h2>{selectedBoard.title}</h2><p>{selectedBoard.description}</p><div className="board-head-tags">{(selectedBoard.tags || [selectedBoard.interest]).filter(Boolean).map((tag) => <span key={tag}>#{tag}</span>)}</div></div><button className="btn-main board-create-post" onClick={() => setShowCreatePost(true)}>＋ Подать объявление</button></header>
        <BoardCategoryGrid value={category} onChange={setCategory} />
        {loading && <p className="board-empty">Загрузка…</p>}
        {!loading && posts.length === 0 && <div className="board-empty"><h3>Объявлений пока нет</h3><p>Опубликуйте первое объявление на этой доске.</p></div>}
        <div className="board-posts">{posts.map((post) => <article className="board-post-card" key={post.id}>
          <div className="board-post-author"><Link to={`/profile/${post.author?.id}`}><Avatar src={post.author?.avatar} kind={post.author?.avatarKind} color={post.author?.avatarColor} letter={post.author?.username?.[0]} online={post.author?.status === "online"} statusEmoji={post.author?.statusEmoji} size="small" /></Link><div><Link to={`/profile/${post.author?.id}`}><strong>{post.author?.username || "Пользователь"}</strong></Link><small>ID {post.author?.userId} · {formatDate(post.createdAt)}</small></div><span className="board-category">{CATEGORIES.find((item) => item.value === post.category)?.icon || "◈"} {post.category}</span></div>
          <h3>{post.title}</h3><p className="board-post-text">{post.text}</p>
          {post.media?.length > 0 && <div className="board-post-media">{post.media.map((item, index) => <BoardMedia key={`${item.content}-${index}`} item={item} />)}</div>}
          {post.tags?.length > 0 && <div className="board-tags">{post.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
          {post.contacts && <div className="board-contacts">Контакты: {post.contacts}</div>}
          <footer><button className={post.favorites?.includes(user.id) ? "active" : ""} onClick={() => toggleFavorite(post.id)}>★ {post.favorites?.length || 0}</button><button onClick={() => comment(post.id)}>💬 {post.comments?.length || 0}</button><span>👁 {post.views || 0}</span>{post.authorId === user.id && <button className="danger-link" onClick={() => removePost(post.id)}>Удалить</button>}</footer>
          {post.comments?.length > 0 && <details className="board-comments"><summary>Комментарии</summary>{post.comments.map((item) => <div key={item.id}><span>{formatDate(item.createdAt)}</span><p>{item.text}</p></div>)}</details>}
        </article>)}</div>
      </> : <div className="board-empty"><h2>Выберите доску</h2><p>Или создайте доску для своего города и интереса.</p></div>}
    </main>

    {showCreateBoard && <div className="modal-overlay" onClick={() => setShowCreateBoard(false)}><form className="board-modal" onSubmit={createBoard} onClick={(event) => event.stopPropagation()}><div className="modal-title-row"><div><span className="section-eyebrow">Новая площадка</span><h2>Создать доску</h2></div><button type="button" className="modal-close" onClick={() => setShowCreateBoard(false)}>×</button></div><label>Город<CityPicker value={boardForm.city} onChange={(next) => setBoardForm({ ...boardForm, city: next })} placeholder="Найдите город в справочнике" required /></label><label>Интересы и темы<TagInput value={boardForm.tags} onChange={(tags) => setBoardForm({ ...boardForm, tags })} suggestions={interests} placeholder="Например: игры, работа, техника" /></label><label>Название<input placeholder="Сформируется автоматически, если оставить пустым" value={boardForm.title} onChange={(event) => setBoardForm({ ...boardForm, title: event.target.value })} /></label><label>Описание<textarea rows={4} placeholder="Для кого эта доска и что здесь публикуют" value={boardForm.description} onChange={(event) => setBoardForm({ ...boardForm, description: event.target.value })} /></label><div className="modal-actions"><button type="button" onClick={() => setShowCreateBoard(false)}>Отмена</button><button className="btn-main">Создать доску</button></div></form></div>}
    {showCreatePost && <div className="modal-overlay" onClick={() => setShowCreatePost(false)}><form className="board-modal wide" onSubmit={createPost} onClick={(event) => event.stopPropagation()}><div className="modal-title-row"><div><span className="section-eyebrow">{selectedBoard?.title}</span><h2>Подать объявление</h2></div><button type="button" className="modal-close" onClick={() => setShowCreatePost(false)}>×</button></div><label>Заголовок<input required placeholder="Коротко и понятно" value={postForm.title} onChange={(event) => setPostForm({ ...postForm, title: event.target.value })} /></label><label>Тип объявления<CustomSelect value={postForm.category} onChange={(next) => setPostForm({ ...postForm, category: next })} options={categoryOptions} /></label><label>Описание<textarea required rows={7} placeholder="Расскажите подробности" value={postForm.text} onChange={(event) => setPostForm({ ...postForm, text: event.target.value })} /></label><label>Дополнительные теги<TagInput value={postForm.tags} onChange={(tags) => setPostForm({ ...postForm, tags })} suggestions={[...interests, ...(selectedBoard?.tags || [])]} /></label><label>Контакты<input placeholder="Личные сообщения, телефон или другой способ связи" value={postForm.contacts} onChange={(event) => setPostForm({ ...postForm, contacts: event.target.value })} /></label><label className="board-file-label">＋ Добавить фото или видео<input type="file" accept="image/*,video/*" multiple onChange={addMedia} /></label>{uploading > 0 && <progress value={uploading} max="100" />}{postForm.media.length > 0 && <div className="board-upload-preview">{postForm.media.map((item, index) => <span key={index}>{item.name}<button type="button" onClick={() => setPostForm((current) => ({ ...current, media: current.media.filter((_, itemIndex) => itemIndex !== index) }))}>✕</button></span>)}</div>}<div className="modal-actions"><button type="button" onClick={() => setShowCreatePost(false)}>Отмена</button><button className="btn-main">Опубликовать</button></div></form></div>}
  </div>;
}

export default BoardsPage;
