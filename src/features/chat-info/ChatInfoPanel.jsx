import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getChatAvatar, getChatTitle, isChatAdmin, messagePreview } from "../../shared/lib/chat";
import AudioPlayer from "../../shared/media/AudioPlayer";
import VideoPlayer from "../../shared/media/VideoPlayer";

function MediaItem({ msg }) {
  if (msg.type === "voice") return <AudioPlayer src={msg.content} title="Голосовое сообщение" duration={msg.duration} voice compact className="info-audio" />;
  if (msg.type === "video") return <VideoPlayer src={msg.content} title={msg.name || "Видео"} compact className="info-video-player" />;
  if (msg.type === "file" && msg.mimeType?.startsWith("image/")) return <img src={msg.content} alt={msg.name || "media"} className="info-media-img" />;
  if (msg.type === "file" && msg.mimeType?.startsWith("video/")) return <VideoPlayer src={msg.content} title={msg.name || "Видео"} compact className="info-video-player" />;
  if (msg.type === "file" && msg.mimeType?.startsWith("audio/")) return <AudioPlayer src={msg.content} title={msg.name || "Аудиозапись"} compact className="info-audio" />;
  return <a className="info-file" download={msg.name} href={msg.content}>📎 {msg.name || messagePreview(msg)}</a>;
}

function ChatInfoPanel({ chat, messages, users, currentUser, onClose, onToggleMute, onUpdateChat, onApproveRequest, onRejectRequest, onLeave, onToggleSecret }) {
  const [tab, setTab] = useState("info");
  const title = getChatTitle(chat, currentUser.id, users);
  const avatar = getChatAvatar(chat, currentUser.id, users);
  const muted = chat.mutedBy?.includes(currentUser.id);
  const admin = isChatAdmin(chat, currentUser.id);
  const media = useMemo(() => messages.filter((m) => ["voice", "video", "file", "image", "audio", "album"].includes(m.type) && !m.hiddenFor?.includes(currentUser.id)), [messages, currentUser.id]);
  const companionId = chat.type === "private" ? chat.participants.find((id) => id !== currentUser.id) : null;

  async function copyInvite() {
    const value = `${window.location.origin}/?invite=${chat.inviteCode}`;
    try { await navigator.clipboard.writeText(value); alert("Инвайт скопирован"); }
    catch { window.prompt("Скопируйте инвайт", value); }
  }

  return (
    <aside className="chat-info-panel">
      <div className="info-head">
        <h3>Информация</h3>
        <button className="icon-btn-sm" onClick={onClose}>✕</button>
      </div>
      <div className="info-profile">
        <div className="chat-avatar info-avatar" style={{ background: avatar.image ? `url(${avatar.image}) center/cover` : avatar.color }}>{!avatar.image && avatar.letter}</div>
        <h2>{title}</h2>
        <p>{chat.isSavedMessages ? "Личный чат с самим собой" : chat.isAiChat ? "ИИ-собеседник НЕМАКС" : chat.type === "private" ? "Личный диалог" : chat.type === "channel" ? `${chat.participants.length} подписчиков` : chat.type === "room" ? `${chat.participants.length} в комнате${chat.city ? ` · ${chat.city}` : ""}` : `${chat.participants.length} участников`}</p>
      </div>
      <div className="segmented info-tabs">
        <button className={tab === "info" ? "active" : ""} onClick={() => setTab("info")}>Основное</button>
        <button className={tab === "media" ? "active" : ""} onClick={() => setTab("media")}>Медиа {media.length}</button>
      </div>

      {tab === "media" ? (
        <div className="shared-media-grid">
          {media.length === 0 && <p className="muted-empty">Общих файлов пока нет</p>}
          {media.map((msg) => <MediaItem key={msg.id} msg={msg} />)}
        </div>
      ) : (
        <div className="info-scroll">
          <button className="info-action" onClick={onToggleMute}>{muted ? "🔔 Включить уведомления" : "🔕 Выключить уведомления"}</button>
          {companionId && !chat.isSavedMessages && <Link className="info-action" to={`/profile/${companionId}`}>👤 Открыть профиль</Link>}
          {companionId && !chat.isAiChat && !chat.isSavedMessages && <button className="info-action" onClick={onToggleSecret}>{chat.secretMode ? "🔐 Выключить секретный режим" : "🔒 Включить секретный режим"}</button>}
          {companionId && !chat.isAiChat && !chat.isSavedMessages && !chat.secretMode && chat.secretEnabledBy?.includes(currentUser.id) && <p className="form-hint">Ожидается подтверждение собеседника</p>}
          {chat.isAiChat && <div className="info-block ai-info-block"><span>Как работает этот чат</span><p>Персонаж всегда остаётся одним и тем же: его системные инструкции хранятся на AI Server и не меняются командами из переписки. История только этого диалога передаётся модели для ответа. ИИ может ошибаться.</p></div>}
          {chat.isSavedMessages && <div className="info-block"><span>Избранное</span><p>Это приватный self-chat: заметки, сообщения и файлы доступны только вашему аккаунту и синхронизируются между устройствами.</p></div>}
          {chat.description && <div className="info-block"><span>Описание</span><p>{chat.description}</p></div>}

          {chat.type !== "private" && (
            <>
              <div className="info-block">
                <span>Участники</span>
                <div className="member-list">
                  {chat.participants.map((id) => {
                    const person = users.find((u) => u.id === id);
                    if (!person) return null;
                    return <div key={id} className="member-row"><span className="chat-avatar xs" style={{ background: person.avatarColor }}>{person.username[0]}</span><span>{person.username}</span>{isChatAdmin(chat, id) && <b>админ</b>}</div>;
                  })}
                </div>
              </div>
              <div className="info-block">
                <span>Приглашение</span>
                <div className="invite-code"><code>{chat.inviteCode}</code><button onClick={copyInvite}>Копировать</button></div>
                {admin && (
                  <label className="switch-row compact-switch">
                    <span><strong>Заявки на вступление</strong><small>Одобрять новых участников вручную</small></span>
                    <input type="checkbox" checked={Boolean(chat.requiresApproval)} onChange={(e) => onUpdateChat({ requiresApproval: e.target.checked })} />
                  </label>
                )}
              </div>
              {admin && chat.pendingRequests?.length > 0 && (
                <div className="info-block">
                  <span>Заявки ({chat.pendingRequests.length})</span>
                  {chat.pendingRequests.map((request) => {
                    const person = users.find((u) => u.id === request.userId);
                    return (
                      <div className="request-row" key={request.userId}>
                        <span>{person?.username || "Пользователь"}</span>
                        <button onClick={() => onApproveRequest(request.userId)}>✓</button>
                        <button className="danger-text" onClick={() => onRejectRequest(request.userId)}>✕</button>
                      </div>
                    );
                  })}
                </div>
              )}
              {chat.ownerId !== currentUser.id && <button className="info-action danger-info" onClick={onLeave}>Выйти из сообщества</button>}
            </>
          )}
        </div>
      )}
    </aside>
  );
}

export default ChatInfoPanel;
