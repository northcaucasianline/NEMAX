import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../shared/lib/api";
import useAuth from "../hooks/useAuth";
import CustomSelect from "../shared/ui/CustomSelect";

const TABS = {
  overview: "Обзор",
  users: "Пользователи",
  chats: "Чаты, паблики и комнаты",
  boards: "Доски объявлений",
  messages: "Сообщения",
  reports: "Жалобы",
  system: "Система",
};

const SEVERITY_OPTIONS = [
  { value: "info", label: "Информация", icon: "i" },
  { value: "warning", label: "Предупреждение", icon: "!" },
  { value: "critical", label: "Критическое", icon: "⚠" },
];

function date(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function StatCard({ label, value, hint }) {
  return <div className="admin-stat"><span>{label}</span><strong>{value ?? 0}</strong>{hint && <small>{hint}</small>}</div>;
}

function ServiceBadge({ name, value }) {
  const ok = value?.ok !== false;
  return <div className={`admin-service ${ok ? "ok" : "bad"}`}><span>{name}</span><b>{ok ? "Работает" : "Ошибка"}</b><small>{value?.driver || value?.service || value?.error || ""}</small></div>;
}

function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [chats, setChats] = useState([]);
  const [boards, setBoards] = useState({ boards: [], posts: [] });
  const [messages, setMessages] = useState([]);
  const [reports, setReports] = useState([]);
  const [system, setSystem] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [broadcast, setBroadcast] = useState({ message: "", severity: "info" });

  const loadOverview = useCallback(async () => {
    const result = await api("/admin/overview");
    setOverview(result);
    setSystem(result.settings);
  }, []);
  const loadUsers = useCallback(async (q = "") => setUsers((await api(`/admin/users?limit=300&q=${encodeURIComponent(q)}`)).users || []), []);
  const loadChats = useCallback(async (q = "") => setChats((await api(`/admin/chats?q=${encodeURIComponent(q)}`)).chats || []), []);
  const loadBoards = useCallback(async (q = "") => setBoards(await api(`/admin/boards?q=${encodeURIComponent(q)}`)), []);
  const loadMessages = useCallback(async (q = "") => setMessages((await api(`/admin/messages?limit=300&q=${encodeURIComponent(q)}`)).messages || []), []);
  const loadReports = useCallback(async () => setReports((await api("/admin/reports")).reports || []), []);

  const loadTab = useCallback(async (current = tab) => {
    setLoading(true);
    try {
      if (current === "overview") await loadOverview();
      if (current === "users") await loadUsers(query);
      if (current === "chats") await loadChats(query);
      if (current === "boards") await loadBoards(query);
      if (current === "messages") await loadMessages(query);
      if (current === "reports") await loadReports();
      if (current === "system") {
        const result = await api("/admin/system-settings");
        setSystem(result.settings);
      }
    } catch (error) { alert(error.message); }
    finally { setLoading(false); }
  }, [tab, query, loadOverview, loadUsers, loadChats, loadBoards, loadMessages, loadReports]);

  useEffect(() => { loadTab(tab); }, [tab]);

  async function createUser() {
    const login = prompt("Логин нового аккаунта (a-z, 0-9, _):");
    if (!login) return;
    const username = prompt("Отображаемое имя:");
    if (!username) return;
    const password = prompt("Стартовый пароль (минимум 8 символов):");
    if (!password) return;
    const publicUsername = prompt("Публичный юзернейм без @ (необязательно):", "");
    if (publicUsername === null) return;
    const role = confirm("Сделать аккаунт системным администратором?") ? "admin" : "user";
    try {
      await api("/admin/users", { method: "POST", body: { login, username, password, publicUsername, role, mustChangePassword: true } });
      await Promise.all([loadUsers(query), loadOverview()]);
      alert("Аккаунт создан. При первом входе пользователь увидит требование сменить пароль.");
    } catch (error) { alert(error.message); }
  }

  async function createManagedChat() {
    const channel = confirm("Создать новостной паблик? Нажмите «Отмена», чтобы создать группу.");
    const title = prompt(channel ? "Название паблика:" : "Название группы:");
    if (!title) return;
    const description = prompt("Описание:", "");
    if (description === null) return;
    const username = channel ? prompt("Публичный username без @ (необязательно):", "") : "";
    if (channel && username === null) return;
    try {
      await api("/admin/chats", { method: "POST", body: { type: channel ? "channel" : "group", title, description, username } });
      await Promise.all([loadChats(query), loadOverview()]);
    } catch (error) { alert(error.message); }
  }

  async function updateUser(target, patch) {
    try {
      await api(`/admin/users/${target.id}`, { method: "PATCH", body: patch });
      await Promise.all([loadUsers(query), loadOverview()]);
    } catch (error) { alert(error.message); }
  }

  async function resetPassword(target) {
    const password = prompt(`Новый пароль для ${target.username} (минимум 8 символов):`);
    if (!password) return;
    try {
      await api(`/admin/users/${target.id}/password`, { method: "POST", body: { password, mustChangePassword: true } });
      alert("Пароль изменён. Все сеансы пользователя завершены.");
      await loadUsers(query);
    } catch (error) { alert(error.message); }
  }

  async function revokeSessions(target) {
    if (!confirm(`Завершить все сеансы пользователя ${target.username}?`)) return;
    try { await api(`/admin/users/${target.id}/sessions`, { method: "DELETE" }); await loadUsers(query); }
    catch (error) { alert(error.message); }
  }

  async function deleteUser(target) {
    if (!confirm(`Удалить пользователя ${target.username} и его сообщения? Это действие необратимо.`)) return;
    try { await api(`/admin/users/${target.id}`, { method: "DELETE" }); await Promise.all([loadUsers(query), loadOverview()]); }
    catch (error) { alert(error.message); }
  }

  async function editUser(target) {
    const username = prompt("Отображаемое имя:", target.username);
    if (username === null) return;
    const publicUsername = prompt("Публичный юзернейм без @ (можно оставить пустым):", target.publicUsername || "");
    if (publicUsername === null) return;
    await updateUser(target, { username, publicUsername });
  }

  async function editChat(chat) {
    const title = prompt("Название:", chat.title || "");
    if (title === null) return;
    const description = prompt("Описание:", chat.description || "");
    if (description === null) return;
    try { await api(`/admin/chats/${chat.id}`, { method: "PATCH", body: { title, description } }); await loadChats(query); }
    catch (error) { alert(error.message); }
  }

  async function deleteChat(chat) {
    if (!confirm(`Удалить ${chat.type === "channel" ? "паблик" : "чат"} «${chat.title || chat.id}» вместе со всеми сообщениями?`)) return;
    try { await api(`/admin/chats/${chat.id}`, { method: "DELETE" }); await Promise.all([loadChats(query), loadOverview()]); }
    catch (error) { alert(error.message); }
  }


  async function deleteBoard(board) {
    if (!confirm(`Удалить доску «${board.title}» и все её объявления?`)) return;
    try { await api(`/admin/boards/${board.id}`, { method: "DELETE" }); await Promise.all([loadBoards(query), loadOverview()]); }
    catch (error) { alert(error.message); }
  }

  async function deleteBoardPost(post) {
    if (!confirm(`Удалить объявление «${post.title}»?`)) return;
    try { await api(`/admin/board-posts/${post.id}`, { method: "DELETE" }); await Promise.all([loadBoards(query), loadOverview()]); }
    catch (error) { alert(error.message); }
  }

  async function deleteMessage(message) {
    if (!confirm("Удалить сообщение у всех участников?")) return;
    try { await api(`/admin/messages/${message.id}`, { method: "DELETE" }); await Promise.all([loadMessages(query), loadOverview()]); }
    catch (error) { alert(error.message); }
  }

  async function updateReport(report, status) {
    const adminNote = prompt("Комментарий администратора:", report.adminNote || "") ?? report.adminNote;
    try { await api(`/admin/reports/${report.id}`, { method: "PATCH", body: { status, adminNote } }); await loadReports(); }
    catch (error) { alert(error.message); }
  }

  async function saveSystem() {
    try {
      const result = await api("/admin/system-settings", { method: "PUT", body: system });
      setSystem(result.settings);
      alert("Системные настройки сохранены");
    } catch (error) { alert(error.message); }
  }

  async function sendBroadcast() {
    if (!broadcast.message.trim()) return;
    try {
      await api("/admin/broadcast", { method: "POST", body: broadcast });
      setBroadcast({ ...broadcast, message: "" });
      alert("Уведомление отправлено подключённым пользователям");
    } catch (error) { alert(error.message); }
  }

  const filteredAudit = useMemo(() => overview?.latestAudit || [], [overview]);

  return <div className="admin-page">
    <aside className="admin-sidebar">
      <div className="admin-brand"><span>🛡️</span><div><strong>Панель администратора</strong><small>{user.username} · ID {user.userId}</small></div></div>
      {Object.entries(TABS).map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setQuery(""); }}>{label}</button>)}
    </aside>

    <main className="admin-content">
      <header className="admin-head"><div><h1>{TABS[tab]}</h1><p>Системное управление приложением и backend-инфраструктурой.</p></div><button onClick={() => loadTab(tab)} disabled={loading}>{loading ? "Загрузка…" : "Обновить"}</button></header>

      {tab === "overview" && overview && <>
        <section className="admin-stats-grid">
          <StatCard label="Пользователи" value={overview.stats.users} hint={`${overview.stats.onlineUsers} онлайн`} />
          <StatCard label="Системные админы" value={overview.stats.admins} />
          <StatCard label="Заблокировано" value={overview.stats.bannedUsers} />
          <StatCard label="Активные сеансы" value={overview.stats.activeSessions} />
          <StatCard label="Все чаты" value={overview.stats.chats} hint={`${overview.stats.groups} групп · ${overview.stats.channels} пабликов`} />
          <StatCard label="Сообщения" value={overview.stats.messages} />
          <StatCard label="Доски" value={overview.stats.boards} hint={`${overview.stats.boardPosts} объявлений`} />
          <StatCard label="Открытые жалобы" value={overview.stats.reportsOpen} />
          <StatCard label="Запланировано" value={overview.stats.scheduledMessages} />
        </section>
        <section className="admin-panel"><h2>Сервисы</h2><div className="admin-services">
          <ServiceBadge name="База данных" value={overview.infrastructure.database} />
          <ServiceBadge name="Redis" value={overview.infrastructure.redis} />
          <ServiceBadge name="S3 / MinIO" value={overview.infrastructure.objectStorage} />
          <ServiceBadge name="Web Push" value={overview.infrastructure.push} />
          <ServiceBadge name="Шифрование" value={{ ok: true, driver: overview.infrastructure.encryption?.algorithm }} />
          <ServiceBadge name="Realtime outbox" value={{ ok: true, driver: `${overview.infrastructure.realtimeOutbox} событий` }} />
        </div></section>
        <section className="admin-panel"><h2>Последние действия</h2><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Время</th><th>Действие</th><th>Объект</th><th>Администратор</th></tr></thead><tbody>{filteredAudit.map((event) => <tr key={event.id}><td>{date(event.createdAt)}</td><td>{event.action}</td><td>{event.targetType}: {event.targetId}</td><td>{event.actorId}</td></tr>)}</tbody></table></div></section>
      </>}

      {["users", "chats", "boards", "messages"].includes(tab) && <div className="admin-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "users" ? "ID, логин, имя или юзернейм" : tab === "chats" ? "Название, username или UUID" : tab === "boards" ? "Доска, город, интерес или объявление" : "Текст сообщения или имя файла"} onKeyDown={(event) => event.key === "Enter" && loadTab(tab)} /><button onClick={() => loadTab(tab)}>Найти</button>{tab === "users" && <button className="admin-create" onClick={createUser}>+ Аккаунт</button>}{tab === "chats" && <button className="admin-create" onClick={createManagedChat}>+ Группа / паблик</button>}</div>}

      {tab === "users" && <section className="admin-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>ID</th><th>Пользователь</th><th>Логин</th><th>Роль</th><th>Статус</th><th>Данные</th><th>Действия</th></tr></thead><tbody>{users.map((target) => <tr key={target.id} className={target.bannedAt ? "row-banned" : ""}><td><strong>{target.userId}</strong><small className="admin-uuid">{target.id}</small></td><td><b>{target.username}</b><small>{target.publicUsername ? `@${target.publicUsername}` : "без юзернейма"}</small></td><td>{target.login}</td><td><button className={target.role === "admin" ? "role-admin" : "role-user"} disabled={target.id === user.id} onClick={() => updateUser(target, { role: target.role === "admin" ? "user" : "admin" })}>{target.role === "admin" ? "Админ" : "Пользователь"}</button></td><td>{target.bannedAt ? <span className="status-bad">Заблокирован</span> : <span className={target.status === "online" ? "status-good" : "status-muted"}>{target.status || "offline"}</span>}</td><td><small>{target.chatCount} чатов<br />{target.messageCount} сообщений<br />{target.sessionCount} сеансов</small></td><td><div className="admin-actions"><button onClick={() => editUser(target)}>Изменить</button><button onClick={() => resetPassword(target)}>Пароль</button><button onClick={() => revokeSessions(target)}>Сеансы</button><button className={target.bannedAt ? "success" : "warning"} disabled={target.id === user.id} onClick={() => updateUser(target, { banned: !target.bannedAt, banReason: "Заблокирован через админ-панель" })}>{target.bannedAt ? "Разбан" : "Бан"}</button><button className="danger" disabled={target.id === user.id} onClick={() => deleteUser(target)}>Удалить</button></div></td></tr>)}</tbody></table></div></section>}

      {tab === "chats" && <section className="admin-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Тип</th><th>Название</th><th>Владелец</th><th>Участники</th><th>Сообщения</th><th>Обновлён</th><th>Действия</th></tr></thead><tbody>{chats.map((chat) => <tr key={chat.id}><td>{chat.type === "channel" ? "Паблик" : chat.type === "group" ? "Группа" : "Личный"}</td><td><b>{chat.title || "Личный диалог"}</b><small>{chat.username ? `@${chat.username}` : chat.id}</small></td><td>{chat.owner?.username || "—"}</td><td>{chat.participants?.length || 0}</td><td>{chat.messageCount}</td><td>{date(chat.updatedAt)}</td><td><div className="admin-actions"><button onClick={() => editChat(chat)}>Изменить</button><button className="danger" onClick={() => deleteChat(chat)}>Удалить</button></div></td></tr>)}</tbody></table></div></section>}


      {tab === "boards" && <>
        <section className="admin-panel"><h2>Доски</h2><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Город</th><th>Название</th><th>Интерес</th><th>Автор</th><th>Объявления</th><th>Создана</th><th></th></tr></thead><tbody>{(boards.boards || []).map((board) => <tr key={board.id}><td>{board.city}</td><td><b>{board.title}</b><small>{board.id}</small></td><td>{board.interest}</td><td>{board.creator?.username || board.createdBy}</td><td>{board.postCount || 0}</td><td>{date(board.createdAt)}</td><td><button className="danger" onClick={() => deleteBoard(board)}>Удалить</button></td></tr>)}</tbody></table></div></section>
        <section className="admin-panel"><h2>Объявления</h2><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Время</th><th>Автор</th><th>Доска</th><th>Категория</th><th>Объявление</th><th></th></tr></thead><tbody>{(boards.posts || []).map((post) => <tr key={post.id}><td>{date(post.createdAt)}</td><td>{post.author?.username || post.authorId}</td><td>{post.board?.title || post.boardId}</td><td>{post.category}</td><td className="admin-message-text"><b>{post.title}</b><small>{post.text}</small></td><td><button className="danger" onClick={() => deleteBoardPost(post)}>Удалить</button></td></tr>)}</tbody></table></div></section>
      </>}

      {tab === "messages" && <section className="admin-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Время</th><th>Отправитель</th><th>Чат</th><th>Тип</th><th>Содержимое</th><th></th></tr></thead><tbody>{messages.map((message) => <tr key={message.id}><td>{date(message.timestamp)}</td><td>{message.sender?.username || message.senderId}<small>ID {message.sender?.userId || "—"}</small></td><td>{message.chat?.title || message.chatId}<small>{message.chat?.type}</small></td><td>{message.type}</td><td className="admin-message-text">{message.text || message.caption || message.name || "Зашифрованное/медиа сообщение"}</td><td><button className="danger" onClick={() => deleteMessage(message)}>Удалить</button></td></tr>)}</tbody></table></div></section>}

      {tab === "reports" && <section className="admin-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Время</th><th>От кого</th><th>Объект</th><th>Причина</th><th>Статус</th><th>Действия</th></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td>{date(report.createdAt)}</td><td>{report.reporter?.username || report.reporterId}</td><td>{report.targetType || "user"}: {report.targetUser?.username || report.targetUserId || report.targetId}</td><td>{report.reason || report.text || "—"}</td><td>{report.status || "open"}</td><td><div className="admin-actions"><button onClick={() => updateReport(report, "reviewing")}>В работу</button><button className="success" onClick={() => updateReport(report, "resolved")}>Решено</button><button onClick={() => updateReport(report, "rejected")}>Отклонить</button></div></td></tr>)}</tbody></table></div></section>}

      {tab === "system" && system && <div className="admin-system-grid">
        <section className="admin-panel admin-form"><h2>Настройки приложения</h2><label>Название приложения<input value={system.siteName || ""} onChange={(event) => setSystem({ ...system, siteName: event.target.value })} /></label><label>Общее объявление<textarea rows={3} value={system.announcement || ""} onChange={(event) => setSystem({ ...system, announcement: event.target.value })} /></label><label className="admin-check"><input type="checkbox" checked={system.registrationEnabled !== false} onChange={(event) => setSystem({ ...system, registrationEnabled: event.target.checked })} /> Разрешить регистрацию новых аккаунтов</label><label className="admin-check"><input type="checkbox" checked={Boolean(system.maintenanceMode)} onChange={(event) => setSystem({ ...system, maintenanceMode: event.target.checked })} /> Режим технического обслуживания</label><label>Текст технических работ<textarea rows={2} value={system.maintenanceMessage || ""} onChange={(event) => setSystem({ ...system, maintenanceMessage: event.target.value })} /></label><label>Максимальный файл, байт<input type="number" value={system.maxUploadBytes || 0} onChange={(event) => setSystem({ ...system, maxUploadBytes: Number(event.target.value) })} /></label><button className="admin-primary" onClick={saveSystem}>Сохранить настройки</button></section>
        <section className="admin-panel admin-form"><h2>Системное уведомление</h2><label>Важность<CustomSelect value={broadcast.severity} onChange={(value) => setBroadcast({ ...broadcast, severity: value })} options={SEVERITY_OPTIONS} /></label><label>Сообщение<textarea rows={6} value={broadcast.message} onChange={(event) => setBroadcast({ ...broadcast, message: event.target.value })} placeholder="Текст увидят все подключённые пользователи" /></label><button className="admin-primary" onClick={sendBroadcast}>Отправить всем</button><p className="admin-hint">Изменения системных настроек и рассылки фиксируются в журнале аудита.</p></section>
      </div>}
    </main>
  </div>;
}

export default AdminPage;
