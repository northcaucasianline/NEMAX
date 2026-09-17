import { useMemo, useState } from "react";

function CreateChatModal({ users, currentUser, onCreate, onJoin, onClose }) {
  const [mode, setMode] = useState("group");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState([]);
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [inviteCode, setInviteCode] = useState("");
  const candidates = useMemo(() => users.filter((u) => u.id !== currentUser.id && !u.isAi && !u.isBot), [users, currentUser.id]);

  function toggleUser(id) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function submitCreate(e) {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({
      type: mode,
      title: title.trim(),
      description: description.trim(),
      memberIds: selected,
      requiresApproval,
    });
  }

  function submitJoin(e) {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    onJoin(inviteCode.trim());
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Новый чат</h3>
          <button className="icon-btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="segmented tabs-pad">
          <button className={mode === "group" ? "active" : ""} onClick={() => setMode("group")}>Группа</button>
          <button className={mode === "channel" ? "active" : ""} onClick={() => setMode("channel")}>Канал</button>
          <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>По инвайту</button>
        </div>

        {mode === "join" ? (
          <form className="modal-form" onSubmit={submitJoin}>
            <label>Ссылка или код приглашения</label>
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Например: AbC123..." />
            <p className="form-hint">Если у сообщества включены заявки, администратор должен будет одобрить вступление.</p>
            <button className="btn-main" type="submit">Присоединиться</button>
          </form>
        ) : (
          <form className="modal-form" onSubmit={submitCreate}>
            <label>{mode === "channel" ? "Название канала" : "Название группы"}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Введите название" />
            <label>Описание</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="О чём это сообщество" />
            <label className="switch-row compact-switch">
              <span><strong>Заявки на вступление</strong><small>Новые участники ждут одобрения администратора</small></span>
              <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
            </label>
            <div className="member-picker-title">Добавить участников</div>
            <div className="member-picker">
              {candidates.map((person) => (
                <label key={person.id} className={`member-pick ${selected.includes(person.id) ? "selected" : ""}`}>
                  <input type="checkbox" checked={selected.includes(person.id)} onChange={() => toggleUser(person.id)} />
                  <span className="chat-avatar xs" style={{ background: person.avatarColor }}>{person.username[0]}</span>
                  <span>{person.username}</span>
                </label>
              ))}
            </div>
            <button className="btn-main" type="submit">Создать</button>
          </form>
        )}
      </div>
    </div>
  );
}

export default CreateChatModal;
