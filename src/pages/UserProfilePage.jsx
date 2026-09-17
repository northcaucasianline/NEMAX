import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import { absoluteMediaUrl, api } from "../shared/lib/api";
import Avatar from "../shared/ui/Avatar";
import AudioPlayer from "../shared/media/AudioPlayer";
import VideoPlayer from "../shared/media/VideoPlayer";

function SharedItem({ msg }) {
  const content = absoluteMediaUrl(msg.content);
  if (msg.type === "voice") return <AudioPlayer src={content} title="Голосовое сообщение" duration={msg.duration} voice compact className="profile-audio" />;
  if (msg.type === "video") return <VideoPlayer src={content} title={msg.name || "Видео"} compact className="profile-media-player" />;
  if (msg.type === "file" && msg.mimeType?.startsWith("image/")) return <a href={content} target="_blank" rel="noreferrer"><img src={content} alt={msg.name} className="profile-media" /></a>;
  if (msg.type === "file" && msg.mimeType?.startsWith("video/")) return <VideoPlayer src={content} title={msg.name || "Видео"} compact className="profile-media-player" />;
  if (msg.type === "file" && msg.mimeType?.startsWith("audio/")) return <AudioPlayer src={content} title={msg.name || "Аудиозапись"} subtitle="Общие материалы" compact className="profile-audio" />;
  return <a href={content} download={msg.name} className="profile-file">📎 {msg.name || "Файл"}</a>;
}

function UserProfilePage() {
  const { id } = useParams();
  const { user, users } = useAuth();
  const navigate = useNavigate();
  const [mediaTab, setMediaTab] = useState("media");
  const [privateChat, setPrivateChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const profile = users.find((item) => item.id === id);

  useEffect(() => {
    let active = true;
    async function loadShared() {
      try {
        const result = await api("/chats");
        const chat = (result.chats || []).find((item) => item.type === "private" && item.participants?.includes(user.id) && item.participants?.includes(id));
        if (!active) return;
        setPrivateChat(chat || null);
        if (chat) {
          const data = await api(`/chats/${chat.id}/messages`);
          if (active) setMessages(data.messages || []);
        }
      } catch {}
    }
    loadShared();
    return () => { active = false; };
  }, [id, user.id]);

  const shared = useMemo(() => {
    if (!privateChat) return [];
    return messages.filter((msg) => !msg.hiddenFor?.includes(user.id) && ["voice", "video", "file"].includes(msg.type));
  }, [messages, privateChat, user.id]);

  const filtered = shared.filter((msg) => {
    if (mediaTab === "audio") return msg.type === "voice" || (msg.type === "file" && msg.mimeType?.startsWith("audio/"));
    if (mediaTab === "files") return msg.type === "file" && !msg.mimeType?.startsWith("image/") && !msg.mimeType?.startsWith("video/") && !msg.mimeType?.startsWith("audio/");
    return msg.type === "video" || (msg.type === "file" && (msg.mimeType?.startsWith("image/") || msg.mimeType?.startsWith("video/")));
  });

  if (!profile) return <div className="profile-page"><p>Пользователь не найден</p></div>;
  if (profile.id === user.id) { navigate("/settings"); return null; }

  const statusLabels = { single: "В активном поиске", complicated: "Все сложно", married: "Женат/Замужем" };
  const genderLabels = { male: "Мужской", female: "Женский" };

  async function startChat() {
    try {
      const result = await api("/chats/private", { method: "POST", body: { userId: profile.id } });
      localStorage.setItem("openChatId", result.chat.id);
      navigate("/");
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div className="profile-page profile-page-wide">
      <div className="profile-card wide profile-card-full">
        <Avatar src={profile.avatar} kind={profile.avatarKind} mimeType={profile.avatarMimeType} color={profile.avatarColor} letter={profile.username?.[0]} online={profile.status === "online"} statusEmoji={profile.statusEmoji} name={profile.username} size="xlarge" className="profile-smart-avatar" />
        <h2>{profile.username}{profile.isAi ? "" : `, ${profile.age}`}</h2>
        <p className="profile-city">{profile.isAi ? "ИИ-аккаунт НЕМАКС" : `ID ${profile.userId}${profile.publicUsername ? ` · @${profile.publicUsername}` : ""}`}</p>{!profile.isAi && <p className="profile-city">📍 {profile.city}</p>}{profile.statusText && <p className="profile-user-status">{profile.statusEmoji || "💬"} {profile.statusText}</p>}
        <div className="profile-badges">{profile.isAi ? <><span className="badge ai-profile-badge">✦ ИИ</span><span className="badge">виртуальный собеседник</span></> : <><span className="badge">{genderLabels[profile.gender]}</span><span className="badge">{statusLabels[profile.relationshipStatus]}</span></>}</div>
        <p className="profile-bio">{profile.bio}</p>
        {profile.isAi && <div className="ai-profile-notice"><strong>Это не реальный человек.</strong><span>Ответы создаёт подключённая языковая модель по устойчивому серверному промпту. Не отправляйте конфиденциальные данные.</span></div>}
        <button className="action-btn" onClick={startChat}>{profile.isAi ? "✦ Открыть ИИ-чат" : "💬 Написать сообщение"}</button>

        <section className="shared-profile-section">
          <div className="shared-title"><h3>Общие материалы</h3><span>{shared.length}</span></div>
          <div className="segmented profile-media-tabs">
            <button className={mediaTab === "media" ? "active" : ""} onClick={() => setMediaTab("media")}>Медиа</button>
            <button className={mediaTab === "audio" ? "active" : ""} onClick={() => setMediaTab("audio")}>Аудио</button>
            <button className={mediaTab === "files" ? "active" : ""} onClick={() => setMediaTab("files")}>Файлы</button>
          </div>
          <div className="profile-media-grid">
            {filtered.length === 0 && <p className="muted-empty">В этой категории пока ничего нет</p>}
            {filtered.map((msg) => <SharedItem key={msg.id} msg={msg} />)}
          </div>
        </section>
        <Link to="/search" className="back-link">← Назад к поиску</Link>
      </div>
    </div>
  );
}

export default UserProfilePage;
