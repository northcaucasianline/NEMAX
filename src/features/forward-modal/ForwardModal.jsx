function preview(chat, msg) {
  if (msg.type === "text") return msg.text;
  if (msg.type === "voice") return "🎤 Голосовое";
  if (msg.type === "video") return "🎥 Видео";
  return "📎 Файл";
}

function ForwardModal({ chats, msg, onSelect, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Переслать сообщение</h3>
          <button className="icon-btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-preview">{preview(null, msg)}</div>
        <div className="modal-list">
          {chats.length === 0 && <p className="modal-empty">Нет доступных чатов</p>}
          {chats.map((chat) => (
            <button key={chat.id} className="modal-chat-item" onClick={() => onSelect(chat.id)}>
              <span className="chat-avatar sm" style={{ background: chat.avatarColor }}>{chat.title[0]}</span>
              <span>{chat.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ForwardModal;
