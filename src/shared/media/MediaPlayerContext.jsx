import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const MediaPlayerContext = createContext(null);
const VOLUME_KEY = "nemax:audio-volume";
const RATE_KEY = "nemax:audio-rate";

function safeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatMediaTime(seconds) {
  const value = Number.isFinite(Number(seconds)) ? Math.max(0, Math.floor(Number(seconds))) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function MediaPlayerProvider({ children }) {
  const audioRef = useRef(null);
  const [track, setTrack] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolumeState] = useState(() => safeNumber(localStorage.getItem(VOLUME_KEY), 0.85));
  const [muted, setMuted] = useState(false);
  const [rate, setRateState] = useState(() => safeNumber(localStorage.getItem(RATE_KEY), 1));
  const [error, setError] = useState("");

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.playbackRate = rate;
    audioRef.current = audio;

    const sync = () => {
      setCurrentTime(audio.currentTime || 0);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      if (audio.buffered?.length && audio.duration) {
        setBuffered(Math.min(1, audio.buffered.end(audio.buffered.length - 1) / audio.duration));
      }
      if ("mediaSession" in navigator && Number.isFinite(audio.duration) && audio.duration > 0) {
        try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) }); } catch { /* optional API */ }
      }
    };
    const onPlay = () => { setPlaying(true); setError(""); window.dispatchEvent(new CustomEvent("nemax:audio-play")); };
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };
    const onError = () => { setPlaying(false); setError("Не удалось воспроизвести аудио"); };

    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("durationchange", sync);
    audio.addEventListener("progress", sync);
    audio.addEventListener("loadedmetadata", sync);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    const pauseForVideo = () => audio.pause();
    window.addEventListener("nemax:video-play", pauseForVideo);

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.removeEventListener("timeupdate", sync);
      audio.removeEventListener("durationchange", sync);
      audio.removeEventListener("progress", sync);
      audio.removeEventListener("loadedmetadata", sync);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      window.removeEventListener("nemax:video-play", pauseForVideo);
      audioRef.current = null;
    };
  }, []); // one global audio element for the whole app

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = Math.max(0, Math.min(1, volume));
    localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = rate;
    localStorage.setItem(RATE_KEY, String(rate));
  }, [rate]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !track) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || "Аудио",
        artist: track.subtitle || "НЕМАКС",
        album: track.album || "НЕМАКС",
        artwork: track.artwork ? [{ src: track.artwork }] : [],
      });
    } catch { /* Media Session is optional */ }
  }, [track]);

  const seek = useCallback((seconds) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || seconds, seconds));
    setCurrentTime(audio.currentTime);
  }, []);

  const playTrack = useCallback(async (nextTrack, startAt = null) => {
    const audio = audioRef.current;
    if (!audio || !nextTrack?.src) return;
    setError("");
    const changed = audio.src !== new URL(nextTrack.src, window.location.href).href;
    if (changed) {
      audio.src = nextTrack.src;
      setTrack(nextTrack);
      setCurrentTime(0);
      setDuration(Number(nextTrack.duration) || 0);
    } else {
      setTrack((current) => ({ ...(current || {}), ...nextTrack }));
    }
    if (Number.isFinite(startAt)) {
      const applyStart = () => { audio.currentTime = Math.max(0, Number(startAt)); };
      if (audio.readyState >= 1) applyStart();
      else audio.addEventListener("loadedmetadata", applyStart, { once: true });
    }
    try {
      await audio.play();
    } catch (playError) {
      setPlaying(false);
      setError(playError?.name === "NotAllowedError" ? "Нажмите ещё раз для воспроизведения" : "Не удалось воспроизвести аудио");
    }
  }, []);

  const pause = useCallback(() => audioRef.current?.pause(), []);
  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    if (audio.paused) audio.play().catch(() => setError("Не удалось воспроизвести аудио"));
    else audio.pause();
  }, [track]);
  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audio.load();
    }
    setTrack(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
    setError("");
  }, []);
  const setVolume = useCallback((value) => setVolumeState(Math.max(0, Math.min(1, Number(value) || 0))), []);
  const setRate = useCallback((value) => setRateState(Math.max(0.5, Math.min(3, Number(value) || 1))), []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return undefined;
    const handlers = {
      play: () => audioRef.current?.play().catch(() => {}),
      pause: () => audioRef.current?.pause(),
      seekbackward: (details) => seek((audioRef.current?.currentTime || 0) - (details.seekOffset || 10)),
      seekforward: (details) => seek((audioRef.current?.currentTime || 0) + (details.seekOffset || 10)),
      seekto: (details) => seek(details.seekTime || 0),
      stop,
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch { /* unsupported action */ }
      }
    };
  }, [seek, stop]);

  const value = useMemo(() => ({
    track, playing, currentTime, duration, buffered, volume, muted, rate, error,
    playTrack, pause, toggle, stop, seek, setVolume, setMuted, setRate,
  }), [track, playing, currentTime, duration, buffered, volume, muted, rate, error, playTrack, pause, toggle, stop, seek, setVolume, setRate]);

  return <MediaPlayerContext.Provider value={value}>{children}</MediaPlayerContext.Provider>;
}

export function useMediaPlayer() {
  const value = useContext(MediaPlayerContext);
  if (!value) throw new Error("useMediaPlayer must be used inside MediaPlayerProvider");
  return value;
}
