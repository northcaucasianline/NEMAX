import { absoluteMediaUrl } from "../lib/api";

function isVideoAvatar(src, kind, mimeType) {
  return kind === "video" || String(mimeType || "").startsWith("video/") || /\.(mp4|webm|mov)(?:\?|$)/i.test(String(src || ""));
}

function Avatar({
  src,
  kind = "image",
  mimeType = "",
  color = "#7c5cff",
  letter = "?",
  name = "",
  size = "medium",
  online = false,
  statusEmoji = "",
  className = "",
  animated = true,
}) {
  const url = absoluteMediaUrl(src);
  const video = url && isVideoAvatar(url, kind, mimeType);
  return (
    <span className={`smart-avatar avatar-${size} ${online ? "is-online" : ""} ${className}`.trim()} style={{ backgroundColor: color }} title={name}>
      {video ? <video src={url} autoPlay={animated} loop muted playsInline preload="metadata" /> : url ? <img src={url} alt={name || "Аватар"} loading="lazy" /> : <span className="smart-avatar-letter">{String(letter || "?").slice(0, 1).toUpperCase()}</span>}
      {online && <i className="avatar-online-dot" aria-label="В сети" />}
      {statusEmoji && <b className="avatar-status-emoji">{statusEmoji}</b>}
    </span>
  );
}

export default Avatar;
