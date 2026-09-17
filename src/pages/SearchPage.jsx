import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { absoluteMediaUrl, api } from "../shared/lib/api";
import useAuth from "../hooks/useAuth";
import Avatar from "../shared/ui/Avatar";
import CustomSelect from "../shared/ui/CustomSelect";

const TABS = [
  ["all", "Всё"], ["people", "Люди"], ["groups", "Сообщества"], ["apps", "Приложения"], ["media", "Медиа"], ["messages", "Сообщения"], ["boards", "Доски"],
];

const MEDIA_TYPES = [
  { value: "", label: "Все типы", icon: "✦" },
  { value: "image", label: "Изображения", icon: "▧" },
  { value: "video", label: "Видео", icon: "▶" },
  { value: "audio", label: "Аудио", icon: "♫" },
  { value: "voice", label: "Голосовые", icon: "◉" },
  { value: "file", label: "Файлы", icon: "▤" },
  { value: "sticker", label: "Стикеры", icon: "☺" },
];

function SearchPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState({ users: [], chats: [], codeProjects: [], media: [], messages: [], boards: [], boardPosts: [] });

  const runSearch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (type) params.set("type", type);
      setResult(await api(`/search/global?${params.toString()}`));
    } catch (error) { alert(error.message); }
    finally { setLoading(false); }
  }, [query, type]);

  useEffect(() => { const timer = setTimeout(runSearch, 280); return () => clearTimeout(timer); }, [runSearch]);

  async function openOrJoin(chat) {
    if (!chat.joined) {
      try {
        const response = await api(`/chats/${chat.id}/join-public`, { method: "POST", body: {} });
        if (response.pending) return alert("Заявка на вступление отправлена");
      } catch (error) { return alert(error.message); }
    }
    localStorage.setItem("openChatId", chat.id);
    navigate("/");
  }

  const counts = useMemo(() => ({
    all: (result.users?.length || 0) + (result.chats?.length || 0) + (result.media?.length || 0) + (result.messages?.length || 0) + (result.boards?.length || 0) + (result.boardPosts?.length || 0) + (result.codeProjects?.length || 0),
    people: result.users?.length || 0, groups: result.chats?.length || 0, apps: result.codeProjects?.length || 0, media: result.media?.length || 0, messages: result.messages?.length || 0, boards: (result.boards?.length || 0) + (result.boardPosts?.length || 0),
  }), [result]);

  const show = (name) => tab === "all" || tab === name;

  return <div className="global-search-page">
    <header className="global-search-head">
      <div><h1>Глобальный поиск</h1><p>Люди, сообщества, приложения, сообщения, файлы и объявления — в одном месте.</p></div>
      <div className="global-search-box"><span>⌕</span><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя, ID, @username, группа, приложение, файл, объявление…" />{query && <button onClick={() => setQuery("")}>✕</button>}</div>
      <div className="global-search-tabs">{TABS.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}<small>{counts[key]}</small></button>)}</div>
      {tab === "media" && <div className="search-media-select"><CustomSelect value={type} onChange={setType} options={MEDIA_TYPES} /></div>}
    </header>

    {loading && <div className="global-search-loading">Поиск…</div>}
    {!loading && counts.all === 0 && <div className="global-search-empty"><h2>Ничего не найдено</h2><p>Попробуйте другой запрос или уберите фильтры.</p></div>}

    <div className="global-search-results">
      {show("people") && result.users?.length > 0 && <section className="search-result-section"><h2>Люди <span>{result.users.length}</span></h2><div className="people-result-grid">{result.users.map((person) => <Link to={`/profile/${person.id}`} className="person-result-card" key={person.id}><Avatar src={person.avatar} kind={person.avatarKind} mimeType={person.avatarMimeType} color={person.avatarColor} letter={person.username?.[0]} online={person.status === "online"} statusEmoji={person.statusEmoji} name={person.username} size="large" /><div><strong>{person.username} {person.isAi && <small className="ai-account-badge">ИИ</small>}</strong><span>{person.isAi ? "ИИ-аккаунт НЕМАКС" : `ID ${person.userId}${person.publicUsername ? ` · @${person.publicUsername}` : ""}`}</span><small>{person.statusText ? `${person.statusEmoji || ""} ${person.statusText}` : person.city || "Город не указан"}</small></div></Link>)}</div></section>}

      {show("groups") && result.chats?.length > 0 && <section className="search-result-section"><h2>Сообщества, комнаты и паблики <span>{result.chats.length}</span></h2><div className="group-result-list">{result.chats.map((chat) => <article key={chat.id}><Avatar src={chat.avatar} kind={chat.avatarKind} mimeType={chat.avatarMimeType} color={chat.avatarColor} letter={chat.title?.[0]} name={chat.title} size="medium" /><div><strong>{chat.type === "channel" ? "📣" : chat.type === "room" ? "◉" : "👥"} {chat.title}</strong><span>{chat.username ? `@${chat.username} · ` : ""}{chat.participantCount} участников</span><p>{chat.description || "Без описания"}</p></div><button onClick={() => openOrJoin(chat)}>{chat.joined ? "Открыть" : chat.requiresApproval ? "Подать заявку" : "Вступить"}</button></article>)}</div></section>}

      {show("apps") && result.codeProjects?.length > 0 && <section className="search-result-section"><h2>Приложения и исходный код <span>{result.codeProjects.length}</span></h2><div className="code-search-grid">{result.codeProjects.map((project) => <Link key={project.id} to="/games?section=code" onClick={() => localStorage.setItem("openCodeProjectId", project.id)} className="code-search-card" style={{ "--code-accent": project.accentColor || "#56d6ff" }}><span>{project.coverEmoji || (project.language === "python" ? "🐍" : project.language === "java" ? "☕" : "JS")}</span><div><strong>{project.title}</strong><small>{project.language} · {project.appType} · {project.files?.length || 0} файлов</small><p>{project.description || "Проект из НЕМАКС Code Studio"}</p></div></Link>)}</div></section>}

      {show("media") && result.media?.length > 0 && <section className="search-result-section"><h2>Медиа и файлы <span>{result.media.length}</span></h2><div className="global-media-grid">{result.media.map((item) => { const url = absoluteMediaUrl(item.content || item.gif?.url || item.sticker?.content); return <button key={item.id} onClick={() => { localStorage.setItem("openChatId", item.chatId); navigate("/"); }} title={item.name || item.text || item.type}>{item.mimeType?.startsWith("image/") || ["image", "gif"].includes(item.type) ? <img src={url} alt="" /> : item.mimeType?.startsWith("video/") || item.type === "video" ? <video src={url} muted preload="metadata" /> : item.type === "sticker" ? <span className="media-sticker">{item.sticker?.emoji || "🙂"}</span> : <span className="media-file-icon">{item.type === "voice" || item.mimeType?.startsWith("audio/") ? "🎵" : "📎"}</span>}<small>{item.chat?.title || "Чат"}</small></button>; })}</div></section>}

      {show("messages") && result.messages?.length > 0 && <section className="search-result-section"><h2>Сообщения <span>{result.messages.length}</span></h2><div className="message-result-list">{result.messages.map((message) => <button key={message.id} onClick={() => { localStorage.setItem("openChatId", message.chatId); navigate("/"); }}><span>{new Date(message.timestamp).toLocaleString()}</span><strong>{message.text || message.name || message.caption || `Сообщение: ${message.type}`}</strong></button>)}</div></section>}

      {show("boards") && (result.boards?.length > 0 || result.boardPosts?.length > 0) && <section className="search-result-section"><h2>Доски и объявления <span>{(result.boards?.length || 0) + (result.boardPosts?.length || 0)}</span></h2><div className="board-search-results">{result.boards?.map((board) => <Link key={board.id} to="/boards" state={{ boardId: board.id }} onClick={() => localStorage.setItem("openBoardId", board.id)} className="board-search-card"><span style={{ background: board.color || "#7c5cff" }}>{board.interest?.[0]}</span><div><strong>{board.title}</strong><small>{board.city} · {board.interest}</small><p>{board.description}</p></div></Link>)}{result.boardPosts?.map((post) => <Link key={post.id} to="/boards" state={{ boardId: post.boardId }} onClick={() => localStorage.setItem("openBoardId", post.boardId)} className="board-search-card post"><Avatar src={post.author?.avatar} kind={post.author?.avatarKind} color={post.author?.avatarColor} letter={post.author?.username?.[0]} size="small" /><div><strong>{post.title}</strong><small>{post.city} · {post.interest} · {post.category}</small><p>{post.text}</p></div></Link>)}</div></section>}
    </div>
  </div>;
}

export default SearchPage;
