import { useEffect } from "react";
import { IconPause, IconPlay } from "../ui/icons";
import { formatMediaTime, useMediaPlayer } from "./MediaPlayerContext";

const SPEEDS = [1, 1.25, 1.5, 2];

export default function GlobalMiniPlayer() {
  const player = useMediaPlayer();
  useEffect(() => {
    document.body.classList.toggle("has-global-mini-player", Boolean(player.track));
    return () => document.body.classList.remove("has-global-mini-player");
  }, [player.track]);
  if (!player.track) return null;
  const progress = player.duration ? player.currentTime / player.duration : 0;
  const nextSpeed = () => {
    const index = SPEEDS.indexOf(player.rate);
    player.setRate(SPEEDS[(index + 1 + SPEEDS.length) % SPEEDS.length]);
  };
  return <aside className="global-mini-player" aria-label="Мини-плеер">
    <button className="mini-play-button" type="button" onClick={player.toggle} aria-label={player.playing ? "Пауза" : "Воспроизвести"}>{player.playing ? <IconPause size={16} /> : <IconPlay size={16} />}</button>
    <div className="mini-track-info">
      <div className="mini-track-title"><strong>{player.track.title || "Аудио"}</strong><span>{player.track.subtitle || "НЕМАКС"}</span></div>
      <input className="media-range" type="range" min="0" max="1000" value={Math.round(progress * 1000)} onChange={(event) => player.seek(player.duration * Number(event.target.value) / 1000)} style={{ "--media-progress": `${progress * 100}%`, "--media-buffered": `${player.buffered * 100}%` }} aria-label="Перемотка" />
    </div>
    <span className="mini-time">{formatMediaTime(player.currentTime)} / {formatMediaTime(player.duration)}</span>
    <button className="mini-action" type="button" onClick={nextSpeed}>{player.rate}×</button>
    <button className="mini-action" type="button" onClick={() => player.setMuted(!player.muted)}>{player.muted ? "🔇" : "🔊"}</button>
    <input className="mini-volume" type="range" min="0" max="1" step="0.01" value={player.muted ? 0 : player.volume} onChange={(event) => { player.setVolume(event.target.value); player.setMuted(false); }} aria-label="Громкость" />
    <button className="mini-close" type="button" onClick={player.stop} aria-label="Закрыть плеер">✕</button>
  </aside>;
}
