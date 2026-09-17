import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import MessageBubble from "../message-bubble/MessageBubble";
import MessageInput from "../message-input/MessageInput";
import ForwardModal from "../forward-modal/ForwardModal";
import ChatInfoPanel from "../chat-info/ChatInfoPanel";
import { IconPin } from "../../shared/ui/icons";
import Avatar from "../../shared/ui/Avatar";
import { canPostToChat, getChatAvatar, getChatTitle, isChatAdmin, messagePreview } from "../../shared/lib/chat";

function ChatWindow({
  chat, chats, messages, currentUser, users, onSend, onDelete, onEdit, onLike, onPin, onForward,
  onToggleMute, onUpdateChat, onApproveRequest, onRejectRequest, onLeave, onBack,
  onReact, onVote, onTyping, onDraftChange, draftText, onStartCall, onToggleSecret, typingState,
}) {
  const [forwarding, setForwarding] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const refs = useRef({});

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return messages.filter((msg) => `${msg.text || ""} ${msg.name || ""}`.toLowerCase().includes(q));
  }, [messages, search]);

  if (!chat) return <div className="chat-window empty"><p>Выберите чат, чтобы начать переписку</p></div>;

  const title = getChatTitle(chat, currentUser.id, users);
  const avatar = getChatAvatar(chat, currentUser.id, users);
  const isAiChat = Boolean(chat.isAiChat);
  const isSavedMessages = Boolean(chat.isSavedMessages);
  const companionId = chat.type === "private" ? chat.participants.find((id) => id !== currentUser.id) : null;
  const companion = companionId ? users.find((item) => item.id === companionId) : null;
  const pinnedMsg = chat.pinnedMessageId ? messages.find((msg) => msg.id === chat.pinnedMessageId) : null;
  const muted = chat.mutedBy?.includes(currentUser.id);
  const canSend = canPostToChat(chat, currentUser.id);
  const admin = isChatAdmin(chat, currentUser.id);

  function revealMessage(msgId) {
    const el = refs.current[msgId];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(msgId);
    setTimeout(() => setHighlightId(null), 1200);
  }

  function stepMatch(direction) {
    if (!matches.length) return;
    const next = (matchIndex + direction + matches.length) % matches.length;
    setMatchIndex(next);
    revealMessage(matches[next].id);
  }

  function handleSearchChange(value) {
    setSearch(value);
    setMatchIndex(0);
    const q = value.trim().toLowerCase();
    const first = messages.find((msg) => `${msg.text || ""} ${msg.name || ""}`.toLowerCase().includes(q));
    if (q && first) setTimeout(() => revealMessage(first.id), 0);
  }

  return (
    <div className={`chat-window ${chat ? "open" : ""}`}>
      <div className="chat-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <Avatar src={avatar.image} kind={avatar.kind} mimeType={avatar.mimeType} color={avatar.color} letter={avatar.letter} statusEmoji={avatar.statusEmoji} online={avatar.online} name={title} size="chat" />
        <div className="chat-header-info">
          <div className="chat-header-title-line">{companionId ? <Link to={`/profile/${companionId}`} className="chat-header-name">{title}</Link> : <h3>{title}</h3>}{isAiChat && <span className="ai-account-badge">ИИ</span>}{isSavedMessages && <span className="saved-account-badge">★ личное</span>}</div>
          <span className="status">{typingState ? "печатает…" : isSavedMessages ? "сообщения самому себе" : isAiChat ? `${companion?.statusEmoji || "✦"} ${companion?.statusText || "ИИ-собеседник НЕМАКС"}` : chat.type === "channel" ? `${chat.participants.length} подписчиков` : chat.type === "room" ? `${chat.participants.length} в комнате${chat.city ? ` · ${chat.city}` : ""}` : chat.type === "group" ? `${chat.participants.length} участников` : companion?.statusText ? `${companion.statusEmoji || ""} ${companion.statusText}`.trim() : companion?.status === "online" ? "в сети" : "был(а) недавно"}</span>
          <span className="encryption-status" title={isAiChat ? "Текст расшифровывается Core API и передаётся отдельному AI Server для генерации ответа" : chat.secretMode ? "Сервер получает только шифротекст" : "Серверное AES-256-GCM, ключ меняется каждые 5 минут"}>{isAiChat ? "✦ ИИ обрабатывает текст · не отправляйте секреты" : chat.secretMode ? "🔐 E2E между устройствами" : "🔒 AES‑256‑GCM · ключ 5 мин"}</span>
        </div>
        <div className="chat-header-actions">
          {chat.type === "private" && !isAiChat && !isSavedMessages && <button onClick={() => onStartCall?.("audio")} title="Аудиозвонок">📞</button>}
          {chat.type === "private" && !isAiChat && !isSavedMessages && <button onClick={() => onStartCall?.("video")} title="Видеозвонок">🎥</button>}
          <button onClick={() => setSearchOpen((v) => !v)} title="Поиск по чату">⌕</button>
          <button onClick={onToggleMute} title={muted ? "Включить уведомления" : "Выключить уведомления"}>{muted ? "🔕" : "🔔"}</button>
          <button onClick={() => setInfoOpen(true)} title="Информация">⋮</button>
        </div>
      </div>

      {isAiChat && <div className="ai-chat-disclaimer"><strong>Это ИИ, а не человек.</strong><span>Ответы могут содержать ошибки. Не отправляйте пароли, документы, банковские данные и другие секреты.</span></div>}
      {isSavedMessages && <div className="saved-chat-hint"><strong>★ Избранное</strong><span>Личные заметки и файлы синхронизируются между вашими устройствами.</span></div>}

      {searchOpen && (
        <div className="chat-search-bar">
          <input autoFocus placeholder="Поиск сообщений и файлов" value={search} onChange={(e) => handleSearchChange(e.target.value)} />
          <span>{matches.length ? `${matchIndex + 1}/${matches.length}` : "0"}</span>
          <button onClick={() => stepMatch(-1)}>↑</button><button onClick={() => stepMatch(1)}>↓</button>
          <button onClick={() => { setSearchOpen(false); setSearch(""); }}>✕</button>
        </div>
      )}

      {pinnedMsg && (
        <div className="pinned-bar" onClick={() => revealMessage(pinnedMsg.id)}>
          <IconPin size={14} filled />
          <div className="pinned-text"><span className="pinned-label">Закреплено</span><span className="pinned-preview">{messagePreview(pinnedMsg)}</span></div>
          <button className="icon-btn-sm" onClick={(e) => { e.stopPropagation(); onPin(chat.id, pinnedMsg.id); }} title="Открепить">✕</button>
        </div>
      )}

      <div className="messages-area">
        {messages.length === 0 && <p className="chat-empty-note">Сообщений пока нет</p>}
        {messages.map((msg) => {
          const sender = users.find((person) => person.id === msg.senderId);
          return (
            <div key={msg.id} ref={(el) => { refs.current[msg.id] = el; }} className={highlightId === msg.id ? "msg-highlight" : ""}>
              <MessageBubble
                msg={msg} isMine={msg.senderId === currentUser.id} currentUserId={currentUser.id}
                senderName={sender?.username} showSender={chat.type !== "private" && msg.type !== "system"}
                isPinned={chat.pinnedMessageId === msg.id} canDeleteForEveryone={msg.senderId === currentUser.id || admin}
                replyMessage={msg.replyToId ? messages.find((item) => item.id === msg.replyToId) : null}
                onDelete={onDelete} onEdit={onEdit} onLike={onLike} onPin={() => onPin(chat.id, msg.id)} onForward={() => setForwarding(msg)}
                onReply={setReplyTo} onReact={onReact} onVote={onVote}
              />
            </div>
          );
        })}
      </div>

      <MessageInput onSend={onSend} onTyping={onTyping} draftText={draftText} onDraftChange={onDraftChange} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} disabled={!canSend} disabledText={chat.type === "channel" ? "Публиковать могут только администраторы" : "Отправка недоступна"} />

      {forwarding && <ForwardModal chats={chats.filter((item) => item.id !== chat.id && canPostToChat(item, currentUser.id))} msg={forwarding} onSelect={(targetId) => { onForward(forwarding, targetId); setForwarding(null); }} onClose={() => setForwarding(null)} />}
      {infoOpen && <ChatInfoPanel chat={chat} messages={messages} users={users} currentUser={currentUser} onClose={() => setInfoOpen(false)} onToggleMute={onToggleMute} onUpdateChat={onUpdateChat} onApproveRequest={onApproveRequest} onRejectRequest={onRejectRequest} onLeave={onLeave} onToggleSecret={onToggleSecret} />}
    </div>
  );
}

export default ChatWindow;
