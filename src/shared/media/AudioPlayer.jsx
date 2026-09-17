import { useEffect, useMemo, useRef, useState } from "react";
import { IconPause, IconPlay } from "../ui/icons";
import { formatMediaTime, useMediaPlayer } from "./MediaPlayerContext";

const SPEEDS = [1, 1.25, 1.5, 2];

function waveformFor(seed, count = 46) {
  let x = Math.abs(String(seed || "audio").split("").reduce((sum, char) => sum + char.charCodeAt(0), 1));
  return Array.from({ length: count }, () => {
    x = (x * 9301 + 49297) % 233280;
    return 0.2 + (x / 233280) * 0.8;
  });
}

export default function AudioPlayer({
  src,
  title = "Аудиозапись",
  subtitle = "НЕМАКС",
  duration: knownDuration = 0,
  artwork = "",
  voice = false,
  compact = false,
  downloadable = true,
  className = "",
}) {
  const player = useMediaPlayer();
  const [metadataDuration, setMetadataDuration] = useState(Number(knownDuration) || 0);
  const metadataRef = useRef(null);
  const active = Boolean(player.track?.src && src && new URL(player.track.src, window.location.href).href === new URL(src, window.location.href).href);
  const duration = active ? (player.duration || metadataDuration || knownDuration) : (metadataDuration || Number(knownDuration) || 0);
  const currentTime = active ? player.currentTime : 0;
  const progress = duration ? Math.min(1, currentTime / duration) : 0;
  const bars = useMemo(() => waveformFor(src || title, compact ? 34 : 52), [src, title, compact]);

  useEffect(() => setMetadataDuration(Number(knownDuration) || 0), [knownDuration]);

  function buildTrack() {
    return { src, title, subtitle, artwork, duration: metadataDuration || knownDuration || 0, kind: voice ? "voice" : "audio" };
  }

  function toggle() {
    if (!src) return;
    if (active) player.toggle();
    else player.playTrack(buildTrack());
  }

  function seek(event) {
    if (!duration || !src) return;
    const value = Number(event.target.value);
    const target = duration * value / 1000;
    if (!active) player.playTrack(buildTrack(), target);
    else player.seek(target);
  }

  function nextSpeed() {
    const currentIndex = SPEEDS.findIndex((item) => item === player.rate);
    player.setRate(SPEEDS[(currentIndex + 1 + SPEEDS.length) % SPEEDS.length]);
  }

  return <div className={`nemax-audio-player ${voice ? "is-voice" : ""} ${compact ? "is-compact" : ""} ${active ? "is-active" : ""} ${className}`}>
    <audio ref={metadataRef} src={src} preload="metadata" onLoadedMetadata={(event) => setMetadataDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} />
    <button className="media-main-button" type="button" onClick={toggle} aria-label={active && player.playing ? "Пауза" : "Воспроизвести"}>
      {active && player.playing ? <IconPause size={compact ? 14 : 17} /> : <IconPlay size={compact ? 14 : 17} />}
    </button>
    <div className="audio-player-main">
      {!voice && <div className="audio-title-row"><div><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div><span className="audio-time-label">{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span></div>}
      <div className={voice ? "audio-waveform" : "audio-progress-wrap"}>
        {voice && <div className="audio-wave-bars" aria-hidden="true">{bars.map((height, index) => <span key={index} className={index / bars.length <= progress ? "played" : ""} style={{ height: `${height * 100}%` }} />)}</div>}
        <input className="media-range audio-seek" type="range" min="0" max="1000" value={Math.round(progress * 1000)} onChange={seek} aria-label="Перемотка аудио" style={{ "--media-progress": `${progress * 100}%`, "--media-buffered": `${active ? player.buffered * 100 : 0}%` }} />
      </div>
      {voice && <div className="voice-meta-row"><span>{active && currentTime > 0 ? formatMediaTime(currentTime) : formatMediaTime(duration)}</span>{active && player.error && <span className="media-error">{player.error}</span>}</div>}
      {!voice && active && player.error && <span className="media-error">{player.error}</span>}
    </div>
    <div className="audio-player-actions">
      <button type="button" className="media-text-button" onClick={nextSpeed} title="Скорость воспроизведения">{player.rate}×</button>
      {downloadable && <a className="media-icon-button" href={src} download title="Скачать" aria-label="Скачать">↓</a>}
    </div>
  </div>;
}
