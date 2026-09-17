import { useEffect, useState } from "react";
import { IconTrash, IconHeart, IconPin, IconForward } from "../../shared/ui/icons";
import { decryptSecretMessage } from "../../shared/lib/e2e";
import AudioPlayer from "../../shared/media/AudioPlayer";
import VideoPlayer from "../../shared/media/VideoPlayer";

function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function fmtSize(b = 0) { if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`; return `${(b / 1048576).toFixed(1)} MB`; }

function FileBox({ name, mimeType = "", size, content }) {
  if (mimeType.startsWith("image/")) return <a href={content} target="_blank" rel="noreferrer"><img src={content} alt={name} className="msg-img" /></a>;
  if (mimeType.startsWith("video/")) return <VideoPlayer src={content} title={name || "Видео"} compact className="message-video-player" />;
  if (mimeType.startsWith("audio/")) return <AudioPlayer src={content} title={name || "Аудиозапись"} subtitle={fmtSize(size)} compact className="message-audio-player" />;
  return <a href={content} download={name} className="file-box"><span className="file-tag">FILE</span><div><span className="file-n">{name}</span><span className="file-s">{fmtSize(size)}</span></div></a>;
}

function SecretText({ msg, currentUserId }) {
  const [value, setValue] = useState("🔒 Расшифровка…");
  useEffect(() => { let active = true; decryptSecretMessage(currentUserId, msg).then((text) => active && setValue(text)).catch(() => active && setValue("🔒 Не удалось расшифровать")); return () => { active = false; }; }, [msg.id, currentUserId]);
  return <p className="msg-txt secret-text">{value}</p>;
}

function PollBox({ msg, currentUserId, onVote }) {
  const poll = msg.poll || {};
  return <div className="poll-box"><strong>{poll.question}</strong>{(poll.options || []).map((option) => {
    const votes = option.voters?.length || 0; const selected = option.voters?.includes(currentUserId);
    return <button key={option.id} className={selected ? "poll-option selected" : "poll-option"} onClick={() => onVote?.(msg.id, [option.id])}><span>{option.text}</span><b>{votes}</b></button>;
  })}</div>;
}

function Actions({ isMine, isPinned, onLike, onPin, onForward, onEdit, onDelete, onReply, onReact }) {
  return <div className="acts">
    <button onClick={onReply} title="Ответить">↩</button>
    <button onClick={() => onReact?.("👍")} title="Реакция">😊</button>
    <button onClick={onLike} title="Нравится"><IconHeart size={13} /></button>
    <button onClick={onForward} title="Переслать"><IconForward size={13} /></button>
    <button className={isPinned ? "act-active" : ""} onClick={onPin} title="Закрепить"><IconPin size={13} filled={isPinned} /></button>
    {isMine && onEdit && <button onClick={onEdit} title="Редактировать">РЕД</button>}
    <button onClick={onDelete} title="Удалить"><IconTrash size={13} /></button>
  </div>;
}

function MessageBubble({ msg, isMine, currentUserId, senderName, showSender, isPinned, canDeleteForEveryone, replyMessage, onDelete, onEdit, onLike, onPin, onForward, onReply, onReact, onVote }) {
  const [editing, setEditing] = useState(false); const [editText, setEditText] = useState(msg.text || ""); const [deleteOpen, setDeleteOpen] = useState(false);
  const likes = msg.likes || []; const mineLike = likes.includes(currentUserId); const reactions = msg.reactions || {};
  const deliveredCount = Object.keys(msg.deliveredTo || {}).filter((id) => id !== currentUserId).length;
  const readCount = Object.keys(msg.viewedBy || {}).filter((id) => id !== currentUserId).length;
  const deliveryLabel = readCount > 0 ? "Прочитано" : deliveredCount > 0 ? "Доставлено" : "Отправлено";
  const deliveryMarks = readCount > 0 || deliveredCount > 0 ? "✓✓" : "✓";
  if (msg.type === "system") return <div className="system-message">{msg.text}</div>;
  function save() { if (editText.trim()) onEdit(msg.id, editText.trim()); setEditing(false); }
  function body() {
    if (msg.type === "e2e") return <SecretText msg={msg} currentUserId={currentUserId} />;
    if (msg.type === "voice" || msg.type === "audio") return <AudioPlayer src={msg.content} title={msg.type === "voice" ? "Голосовое сообщение" : (msg.name || "Аудиозапись")} subtitle={senderName || "НЕМАКС"} duration={msg.duration} voice={msg.type === "voice"} compact />;
    if (msg.type === "video") return <VideoPlayer src={msg.content} title={msg.name || "Видеосообщение"} compact className="message-video-player" />;
    if (["file", "image", "album"].includes(msg.type)) return <FileBox name={msg.name} mimeType={msg.mimeType} size={msg.size} content={msg.content} />;
    if (msg.type === "poll") return <PollBox msg={msg} currentUserId={currentUserId} onVote={onVote} />;
    if (msg.type === "location") return <a className="location-box" href={`https://www.openstreetmap.org/?mlat=${msg.location?.lat}&mlon=${msg.location?.lon}`} target="_blank" rel="noreferrer">📍 {msg.location?.label || `${msg.location?.lat}, ${msg.location?.lon}`}</a>;
    if (msg.type === "contact") return <div className="contact-box">👤 <strong>{msg.contact?.name}</strong><span>{msg.contact?.value}</span></div>;
    if (msg.type === "sticker") return msg.sticker?.content || msg.content ? <div className="sticker-box image"><img src={msg.sticker?.content || msg.content} alt={msg.sticker?.name || "Стикер"} /></div> : <div className="sticker-box">{msg.sticker?.emoji || "🙂"}</div>;
    if (msg.type === "gif") return <img className="msg-img" src={msg.gif?.url || msg.content} alt="GIF" />;
    return editing ? <div className="edit-row"><input value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus /><button onClick={save}>OK</button><button onClick={() => setEditing(false)}>✕</button></div> : <p className="msg-txt">{msg.text}</p>;
  }
  return <div className={`msg-row ${isMine ? "mine" : "theirs"}`}>
    <div className="bubble-wrap"><div className={`bubble ${msg.type === "voice" ? "voice-bubble" : ""} ${msg.type === "video" ? "vid-bubble" : ""} ${msg.type === "file" ? "file-bubble" : ""}`}>
      {(showSender || msg.aiGenerated) && <div className="message-sender-name">{senderName || "Пользователь"}{msg.aiGenerated && <span className="ai-message-label">ИИ</span>}{msg.signature ? ` · ${msg.signature}` : ""}</div>}
      {msg.forwardedFrom && <div className="fwd-tag">Переслано от {msg.forwardedFrom}</div>}
      {replyMessage && <div className="reply-preview"><b>Ответ</b><span>{replyMessage.text || replyMessage.name || "Вложение"}</span></div>}
      {body()}{msg.caption && <p className="msg-caption">{msg.caption}</p>}<div className="meta"><span>{fmtTime(msg.timestamp)}</span>{msg.edited && <span>изменено</span>}{isMine && <span className={`message-checks ${readCount > 0 ? "read" : deliveredCount > 0 ? "delivered" : "sent"}`} title={deliveryLabel}>{deliveryMarks}</span>}{msg.expiresAt > Date.now() && <span>⏱</span>}</div>
    </div>
      <div className="reaction-row">{Object.entries(reactions).map(([emoji, ids]) => <button key={emoji} className={ids.includes(currentUserId) ? "reaction-pill mine" : "reaction-pill"} onClick={() => onReact?.(emoji)}>{emoji} {ids.length}</button>)}{likes.length > 0 && <button className={`reaction-pill ${mineLike ? "mine" : ""}`} onClick={() => onLike(msg.id)}><IconHeart size={11} filled /> {likes.length}</button>}</div>
    </div>
    <Actions isMine={isMine} isPinned={isPinned} onLike={() => onLike(msg.id)} onPin={onPin} onForward={onForward} onReply={() => onReply?.(msg)} onReact={(emoji) => onReact?.(msg.id, emoji)} onEdit={msg.type === "text" ? () => setEditing(true) : null} onDelete={() => setDeleteOpen(true)} />
    {deleteOpen && <div className="modal-overlay" onClick={() => setDeleteOpen(false)}><div className="delete-dialog" onClick={(e) => e.stopPropagation()}><h3>Удалить сообщение?</h3><button onClick={() => { onDelete(msg.id, "me"); setDeleteOpen(false); }}>Удалить только у меня</button>{canDeleteForEveryone && <button className="danger-choice" onClick={() => { onDelete(msg.id, "everyone"); setDeleteOpen(false); }}>Удалить у всех</button>}<button className="cancel-choice" onClick={() => setDeleteOpen(false)}>Отмена</button></div></div>}
  </div>;
}

export default MessageBubble;
