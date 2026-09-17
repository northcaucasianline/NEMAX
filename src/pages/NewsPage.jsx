import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { absoluteMediaUrl, api } from "../shared/lib/api";
import useAuth from "../hooks/useAuth";
import AudioPlayer from "../shared/media/AudioPlayer";
import VideoPlayer from "../shared/media/VideoPlayer";

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString([], { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
}

function PostMedia({ post }) {
  const content = absoluteMediaUrl(post.content);
  if (["image", "file", "album"].includes(post.type) && post.mimeType?.startsWith("image/")) return <img className="news-media" src={content} alt={post.name || "Публикация"} />;
  if (post.type === "video" || (post.type === "file" && post.mimeType?.startsWith("video/"))) return <VideoPlayer className="news-video-player" src={content} title={post.name || post.channel?.title || "Видео"} />;
  if (["audio", "voice"].includes(post.type) || (post.type === "file" && post.mimeType?.startsWith("audio/"))) return <AudioPlayer className="news-audio" src={content} title={post.name || (post.type === "voice" ? "Голосовое сообщение" : "Аудиозапись")} subtitle={post.channel?.title || "Новости"} duration={post.duration} voice={post.type === "voice"} />;
  if (post.type === "file") return <a className="news-file" href={content} download={post.name}>📎 {post.name || "Скачать файл"}</a>;
  if (post.type === "poll") return <div className="news-poll"><strong>{post.poll?.question}</strong>{(post.poll?.options || []).map((option) => <div key={option.id}>{option.text} — {option.voters?.length || 0}</div>)}</div>;
  if (post.type === "location") return <a className="news-file" href={`https://www.openstreetmap.org/?mlat=${post.location?.lat}&mlon=${post.location?.lon}`} target="_blank" rel="noreferrer">📍 {post.location?.label || "Открыть геолокацию"}</a>;
  return null;
}

function NewsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async ({ append = false, before = null } = {}) => {
    setLoading(true);
    try {
      const query = before ? `?before=${encodeURIComponent(before)}&limit=30` : "?limit=30";
      const result = await api(`/news${query}`);
      setPosts((current) => append ? [...current, ...(result.posts || [])] : (result.posts || []));
      setNextBefore(result.nextBefore || null);
      setHasMore(Boolean(result.hasMore));
      for (const post of result.posts || []) api(`/messages/${post.id}/view`, { method: "POST", body: {} }).catch(() => {});
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function react(postId, emoji) {
    try {
      await api(`/messages/${postId}/reactions`, { method: "POST", body: { emoji } });
      await load();
    } catch (error) { alert(error.message); }
  }

  function openChannel(channelId) {
    localStorage.setItem("openChatId", channelId);
    navigate("/");
  }

  return <div className="news-page">
    <div className="news-page-head">
      <div><h1>Новости</h1><p>Единая лента публикаций из всех пабликов, на которые вы подписаны.</p></div>
      <button onClick={() => load()} disabled={loading}>Обновить</button>
    </div>
    {!loading && posts.length === 0 && <div className="news-empty"><h2>Лента пока пуста</h2><p>Вступите хотя бы в один новостной паблик или дождитесь новой публикации.</p></div>}
    <div className="news-feed">
      {posts.map((post) => {
        const reactions = post.reactions || {};
        return <article className="news-card" key={post.id}>
          <header className="news-card-head" onClick={() => openChannel(post.channel.id)}>
            <div className="news-channel-avatar" style={{ background: post.channel.avatar ? `url(${absoluteMediaUrl(post.channel.avatar)}) center/cover` : post.channel.avatarColor }}>{!post.channel.avatar && post.channel.title?.[0]}</div>
            <div><strong>{post.channel.title}</strong><span>{post.channel.username ? `@${post.channel.username} · ` : ""}{post.channel.subscribers} подписчиков</span></div>
            <time>{formatDate(post.timestamp)}</time>
          </header>
          <div className="news-card-body">
            {post.text && <p>{post.text}</p>}
            <PostMedia post={post} />
            {post.caption && <p>{post.caption}</p>}
          </div>
          <footer className="news-card-foot">
            <div className="news-reactions">
              {["👍", "❤️", "🔥", "👏"].map((emoji) => <button key={emoji} className={(reactions[emoji] || []).includes(user.id) ? "active" : ""} onClick={() => react(post.id, emoji)}>{emoji}{reactions[emoji]?.length ? ` ${reactions[emoji].length}` : ""}</button>)}
            </div>
            <span>👁 {post.views || 0}</span>
            <button className="news-open" onClick={() => openChannel(post.channel.id)}>Открыть паблик</button>
          </footer>
        </article>;
      })}
    </div>
    {hasMore && <button className="news-load-more" disabled={loading} onClick={() => load({ append: true, before: nextBefore })}>{loading ? "Загрузка…" : "Показать более старые"}</button>}
  </div>;
}

export default NewsPage;
