import { useEffect, useRef, useState } from "react";
import { IconPause, IconPlay } from "../ui/icons";
import { formatMediaTime, useMediaPlayer } from "./MediaPlayerContext";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const VOLUME_KEY = "nemax:video-volume";

function progressKey(src) {
  let hash = 0;
  for (const char of String(src || "")) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return `nemax:video-progress:${Math.abs(hash)}`;
}

export default function VideoPlayer({
  src,
  poster = "",
  title = "Видео",
  className = "",
  compact = false,
  downloadable = true,
  autoPlay = false,
  loop = false,
}) {
  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const instanceIdRef = useRef(globalThis.crypto?.randomUUID?.() || `video-${Math.random().toString(36).slice(2)}`);
  const hideTimerRef = useRef(null);
  const globalAudio = useMediaPlayer();
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(() => Math.max(0, Math.min(1, Number(localStorage.getItem(VOLUME_KEY)) || 0.85)));
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [error, setError] = useState("");
  const progress = duration ? currentTime / duration : 0;

  useEffect(() => {
    const pauseOtherMedia = (event) => {
      if (event.type === "nemax:audio-play" || event.detail !== instanceIdRef.current) videoRef.current?.pause();
    };
    window.addEventListener("nemax:video-play", pauseOtherMedia);
    window.addEventListener("nemax:audio-play", pauseOtherMedia);
    return () => {
      clearTimeout(hideTimerRef.current);
      window.removeEventListener("nemax:video-play", pauseOtherMedia);
      window.removeEventListener("nemax:audio-play", pauseOtherMedia);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
  }, [rate]);

  function showControls(keep = false) {
    clearTimeout(hideTimerRef.current);
    setControlsVisible(true);
    if (!keep && playing) hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2400);
  }

  async function toggle() {
    const video = videoRef.current;
    if (!video) return;
    setError("");
    if (video.paused) {
      globalAudio.pause();
      try { await video.play(); }
      catch { setError("Не удалось воспроизвести видео"); }
    } else video.pause();
    showControls();
  }

  function updateProgress() {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime || 0);
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    if (video.buffered?.length && video.duration) setBuffered(Math.min(1, video.buffered.end(video.buffered.length - 1) / video.duration));
    if (video.duration > 20 && video.currentTime > 3 && video.currentTime < video.duration - 5) localStorage.setItem(progressKey(src), String(video.currentTime));
  }

  function loaded() {
    const video = videoRef.current;
    if (!video) return;
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    const saved = Number(localStorage.getItem(progressKey(src)) || 0);
    if (saved > 3 && saved < video.duration - 5) video.currentTime = saved;
    if (autoPlay) video.play().catch(() => {});
  }

  function seek(event) {
    const video = videoRef.current;
    if (!video?.duration) return;
    video.currentTime = video.duration * Number(event.target.value) / 1000;
    updateProgress();
  }

  function skip(seconds) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + seconds));
    updateProgress();
    showControls();
  }

  async function fullscreen() {
    const shell = shellRef.current;
    if (!shell) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (shell.requestFullscreen) await shell.requestFullscreen();
      else if (videoRef.current?.webkitEnterFullscreen) videoRef.current.webkitEnterFullscreen();
    } catch { setError("Полноэкранный режим недоступен"); }
  }

  async function pictureInPicture() {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled && video.requestPictureInPicture) await video.requestPictureInPicture();
      else setError("Picture-in-Picture не поддерживается");
    } catch { setError("Не удалось открыть Picture-in-Picture"); }
  }

  function onKeyDown(event) {
    if (["INPUT", "BUTTON"].includes(event.target.tagName)) return;
    if (event.code === "Space" || event.key.toLowerCase() === "k") { event.preventDefault(); toggle(); }
    else if (event.key === "ArrowLeft") skip(-10);
    else if (event.key === "ArrowRight") skip(10);
    else if (event.key.toLowerCase() === "m") setMuted((value) => !value);
    else if (event.key.toLowerCase() === "f") fullscreen();
    else if (event.key.toLowerCase() === "p") pictureInPicture();
  }

  function doubleClick(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    skip(event.clientX < rect.left + rect.width / 2 ? -10 : 10);
  }

  return <div
    ref={shellRef}
    className={`nemax-video-player ${compact ? "is-compact" : ""} ${controlsVisible ? "show-controls" : ""} ${className}`}
    tabIndex="0"
    onKeyDown={onKeyDown}
    onMouseMove={() => showControls()}
    onMouseLeave={() => playing && setControlsVisible(false)}
    onFocus={() => showControls(true)}
  >
    <video
      ref={videoRef}
      src={src}
      poster={poster || undefined}
      playsInline
      preload="metadata"
      loop={loop}
      onClick={toggle}
      onDoubleClick={doubleClick}
      onLoadedMetadata={loaded}
      onTimeUpdate={updateProgress}
      onProgress={updateProgress}
      onPlay={() => { setPlaying(true); globalAudio.pause(); window.dispatchEvent(new CustomEvent("nemax:video-play", { detail: instanceIdRef.current })); showControls(); }}
      onPause={() => { setPlaying(false); showControls(true); }}
      onEnded={() => { setPlaying(false); setCurrentTime(0); localStorage.removeItem(progressKey(src)); showControls(true); }}
      onError={() => setError("Видео недоступно или имеет неподдерживаемый формат")}
    />
    {!playing && <button type="button" className="video-center-play" onClick={toggle} aria-label="Воспроизвести видео"><IconPlay size={compact ? 20 : 28} /></button>}
    <div className="video-top-gradient" />
    <div className="video-title">{title}</div>
    <div className="video-controls" onClick={(event) => event.stopPropagation()}>
      <input className="media-range video-seek" type="range" min="0" max="1000" value={Math.round(progress * 1000)} onChange={seek} aria-label="Перемотка видео" style={{ "--media-progress": `${progress * 100}%`, "--media-buffered": `${buffered * 100}%` }} />
      <div className="video-controls-row">
        <button type="button" className="video-control-button" onClick={toggle} aria-label={playing ? "Пауза" : "Воспроизвести"}>{playing ? <IconPause size={16} /> : <IconPlay size={16} />}</button>
        <button type="button" className="video-control-button skip-button" onClick={() => skip(-10)} title="Назад на 10 секунд">↶10</button>
        <button type="button" className="video-control-button skip-button" onClick={() => skip(10)} title="Вперёд на 10 секунд">10↷</button>
        <span className="video-time">{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span>
        <div className="video-volume-control"><button type="button" className="video-control-button" onClick={() => setMuted((value) => !value)} title={muted ? "Включить звук" : "Выключить звук"}>{muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}</button><input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={(event) => { setVolume(Number(event.target.value)); setMuted(false); }} aria-label="Громкость" /></div>
        <div className="video-speed-menu"><button type="button" className="video-control-button video-speed-button" onClick={() => setSpeedOpen((value) => !value)}>{rate}×</button>{speedOpen && <div className="video-speed-popover">{SPEEDS.map((value) => <button type="button" className={rate === value ? "active" : ""} key={value} onClick={() => { setRate(value); setSpeedOpen(false); }}>{value}×</button>)}</div>}</div>
        {downloadable && <a className="video-control-button" href={src} download title="Скачать" aria-label="Скачать">↓</a>}
        <button type="button" className="video-control-button pip-button" onClick={pictureInPicture} title="Картинка в картинке">▣</button>
        <button type="button" className="video-control-button" onClick={fullscreen} title="На весь экран">⛶</button>
      </div>
    </div>
    {error && <div className="video-error">{error}</div>}
  </div>;
}
