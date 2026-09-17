import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getChatAvatar, getChatTitle, messagePreview } from "../../shared/lib/chat";
import Avatar from "../../shared/ui/Avatar";

function getLastMessage(chatId, messages, currentUserId) {
  return messages.filter((m) => m.chatId === chatId && !m.hiddenFor?.includes(currentUserId)).sort((a, b) => b.timestamp - a.timestamp)[0];
}

function formatTime(ts) {
  if (!ts) return "";
  const date = new Date(ts);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function ChatList({ chats, messages, selectedId, onSelect, currentUser, users, onOpenCreate, collapsed = false, onToggleCollapsed }) {
  const [query, setQuery] = useState("");
  const [archive, setArchive] = useState(false);
  const sorted = useMemo(() => [...chats]
    .filter((chat) => Boolean(chat.archivedBy?.includes(currentUser.id)) === archive)
    .filter((chat) => getChatTitle(chat, currentUser.id, users).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      const priority = (chat) => chat.isSavedMessages ? 3 : chat.isAiChat ? 2 : 1;
      return priority(b) - priority(a) || Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    }), [chats, currentUser.id, messages, query, users, archive]);

  return (
    <aside className={`chat-list ${collapsed ? "collapsed" : ""}`}>
      <div className="chat-list-header">
        <div className="chat-list-title-row">
          {!collapsed && <h2>{archive ? "Архив" : "Чаты"}</h2>}
          {!collapsed && <button className="archive-toggle" onClick={() => setArchive((v) => !v)}>{archive ? "← Все" : "Архив"}</button>}
          <button className="sidebar-collapse-btn" onClick={onToggleCollapsed} title={collapsed ? "Развернуть список" : "Свернуть до иконок"}>{collapsed ? "»" : "«"}</button>
          <button className="new-chat-btn" onClick={onOpenCreate} title="Новый чат">＋</button>
        </div>
        {!collapsed && <input className="chat-list-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск чатов" />}
      </div>
      <div className="chat-list-items">
        {sorted.length === 0 && !collapsed && <p className="chat-list-empty">Чатов не найдено</p>}
        {sorted.map((chat) => {
          const last = getLastMessage(chat.id, messages, currentUser.id);
          const title = getChatTitle(chat, currentUser.id, users);
          const avatar = getChatAvatar(chat, currentUser.id, users);
          const companionId = chat.type === "private" ? chat.participants.find((p) => p !== currentUser.id) : null;
          const muted = chat.mutedBy?.includes(currentUser.id);
          const pending = chat.pendingRequests?.length || 0;
          return (
            <div key={chat.id} className={`chat-item ${selectedId === chat.id ? "active" : ""}`} onClick={() => onSelect(chat.id)} title={collapsed ? `${title}: ${messagePreview(last)}` : undefined}>
              <Avatar src={avatar.image} kind={avatar.kind} mimeType={avatar.mimeType} color={avatar.color} letter={avatar.letter} statusEmoji={avatar.statusEmoji} online={avatar.online} name={title} size="chat" />
              {!collapsed && <div className="chat-info">
                <div className="chat-row">
                  {companionId ? <Link to={`/profile/${companionId}`} className="chat-name" onClick={(e) => e.stopPropagation()}>{title}</Link> : <span className="chat-name">{title}</span>}
                  <span className="chat-name-badges">{chat.isAiChat && <small className="ai-mini-badge">ИИ</small>}{chat.isSavedMessages && <small className="saved-mini-badge">личное</small>}</span>
                  {last && <span className="chat-time">{formatTime(last.timestamp)}</span>}
                </div>
                <div className="chat-preview-row">
                  <span className="chat-preview">{chat.isSavedMessages ? "★ " : chat.isAiChat ? "✦ " : chat.type === "channel" ? "📣 " : chat.type === "room" ? "◉ " : chat.type === "group" ? "👥 " : ""}{messagePreview(last)}</span>
                  {muted && <span title="Уведомления выключены">🔕</span>}
                  {chat.unreadCount > 0 && <span className="unread-badge">{chat.unreadCount}</span>}
                  {pending > 0 && <span className="pending-badge" title="Заявки на вступление">{pending}</span>}
                </div>
              </div>}
              {collapsed && chat.unreadCount > 0 && <span className="collapsed-unread">{chat.unreadCount > 9 ? "9+" : chat.unreadCount}</span>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default ChatList;
