import { useState, useRef, useEffect, useCallback } from "react";
import { IconMic, IconCamera, IconPaperclip, IconSend, IconFlipCamera, IconClose } from "../../shared/ui/icons";
import { api, uploadLargeFile } from "../../shared/lib/api";

function pad(n) { return n.toString().padStart(2, "0"); }
function fmt(sec) { return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`; }
const MAX_LOCAL_MEDIA = 15 * 1024 * 1024;
const MAX_UPLOAD_MEDIA = 2 * 1024 * 1024 * 1024;
const DEFAULT_STICKERS = ["😀", "😂", "😍", "😎", "🥳", "🤝", "👍", "❤️", "🔥", "👏", "🤔", "😭", "😡", "🚀", "✨", "🎉", "💯", "👀"];

function pickRecorderMime(candidates) {
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((type) => {
    try { return MediaRecorder.isTypeSupported(type); } catch { return false; }
  }) || "";
}

function mediaExtension(mimeType, kind) {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("mp4")) return "mp4";
  if (value.includes("ogg")) return "ogg";
  if (value.includes("mpeg")) return "mp3";
  return kind === "video" ? "webm" : "webm";
}

function MessageInput({ onSend, onTyping, draftText = "", onDraftChange, replyTo, onCancelReply, disabled = false, disabledText = "Отправка недоступна" }) {
  const [text, setText] = useState(draftText || "");
  const [uploadProgress, setUploadProgress] = useState(0);
  const typingTimer = useRef(null);
  const [recording, setRecording] = useState(null);
  const [recTime, setRecTime] = useState(0);
  const [attached, setAttached] = useState(null);
  const [facing, setFacing] = useState("user");
  const [canFlip, setCanFlip] = useState(true);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickerPacks, setStickerPacks] = useState([]);
  const discardRef = useRef(false);
  const startedAtRef = useRef(0);

  const mediaRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => { setText(draftText || ""); }, [draftText]);
  useEffect(() => { api("/stickers").then((result) => setStickerPacks(result.packs || [])).catch(() => {}); }, []);
  useEffect(() => { const timer = setTimeout(() => onDraftChange?.(text), 350); return () => clearTimeout(timer); }, [text]);
  function changeText(value) {
    setText(value); onTyping?.("typing"); clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => onTyping?.("idle"), 1500);
  }

  useEffect(() => {
    if (recording) timerRef.current = setInterval(() => setRecTime((t) => t + 1), 1000);
    else { clearInterval(timerRef.current); setRecTime(0); }
    return () => clearInterval(timerRef.current);
  }, [recording]);

  const drawWave = useCallback(() => {
    const c = canvasRef.current, a = analyserRef.current;
    if (!c || !a) return;
    const ctx = c.getContext("2d");
    const buf = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(buf);
    ctx.clearRect(0, 0, c.width, c.height);
    const barCount = 42;
    const step = Math.floor(buf.length / barCount) || 1;
    const w = c.width / barCount;
    for (let i = 0; i < barCount; i++) {
      const v = buf[i * step] / 255;
      const h = Math.max(3, v * c.height);
      const grad = ctx.createLinearGradient(0, c.height - h, 0, c.height);
      grad.addColorStop(0, "#ccff00");
      grad.addColorStop(1, "#9b3dff");
      ctx.fillStyle = grad;
      const bw = w * 0.55;
      const x = i * w + (w - bw) / 2;
      const r = bw / 2;
      ctx.beginPath();
      ctx.roundRect(x, c.height - h, bw, h, r);
      ctx.fill();
    }
    animRef.current = requestAnimationFrame(drawWave);
  }, []);

  async function startVoice() {
    try {
      discardRef.current = false;
      startedAtRef.current = Date.now();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const actx = new AudioContext();
      audioCtxRef.current = actx;
      const src = actx.createMediaStreamSource(stream);
      const anl = actx.createAnalyser();
      anl.fftSize = 256;
      src.connect(anl);
      analyserRef.current = anl;

      const mimeType = pickRecorderMime(["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"]);
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => {
        if (discardRef.current) { discardRef.current = false; stream.getTracks().forEach((t) => t.stop()); if (actx.state !== "closed") actx.close(); cancelAnimationFrame(animRef.current); return; }
        const actualMime = rec.mimeType || mimeType || chunksRef.current.find((item) => item.type)?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: actualMime });
        if (blob.size > MAX_LOCAL_MEDIA) { alert("Запись слишком большая (максимум 15 МБ)"); stream.getTracks().forEach((t) => t.stop()); if (actx.state !== "closed") actx.close(); return; }
        const r = new FileReader();
        r.onloadend = () => onSend({ type: "voice", content: r.result, mimeType: actualMime, name: `voice-${Date.now()}.${mediaExtension(actualMime, "audio")}`, duration: Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)) });
        r.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
        if (actx.state !== "closed") actx.close();
        cancelAnimationFrame(animRef.current);
      };
      rec.start();
      setRecording("voice");
      setTimeout(drawWave, 100);
    } catch {
      alert("Нет доступа к микрофону");
    }
  }

  async function startVideo(desiredFacing = facing) {
    try {
      discardRef.current = false;
      startedAtRef.current = Date.now();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: desiredFacing },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      const mimeType = pickRecorderMime(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]);
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => {
        if (discardRef.current) { discardRef.current = false; stream.getTracks().forEach((t) => t.stop()); if (videoRef.current) videoRef.current.srcObject = null; return; }
        const actualMime = rec.mimeType || mimeType || chunksRef.current.find((item) => item.type)?.type || "video/webm";
        const blob = new Blob(chunksRef.current, { type: actualMime });
        if (blob.size > MAX_LOCAL_MEDIA) { alert("Видео слишком большое (максимум 15 МБ)"); stream.getTracks().forEach((t) => t.stop()); if (videoRef.current) videoRef.current.srcObject = null; return; }
        const r = new FileReader();
        r.onloadend = () => onSend({ type: "video", content: r.result, mimeType: actualMime, name: `video-${Date.now()}.${mediaExtension(actualMime, "video")}`, duration: Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)) });
        r.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
      };
      rec.start();
      setRecording("video");
    } catch {
      alert("Нет доступа к камере");
    }
  }

  async function flipCamera() {
    const nextFacing = facing === "user" ? "environment" : "user";
    const stream = streamRef.current;
    if (!stream) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextFacing } });
      const newTrack = newStream.getVideoTracks()[0];
      const oldTrack = stream.getVideoTracks()[0];
      if (oldTrack) { stream.removeTrack(oldTrack); oldTrack.stop(); }
      stream.addTrack(newTrack);
      if (videoRef.current) videoRef.current.srcObject = stream;
      setFacing(nextFacing);
    } catch {
      setCanFlip(false);
    }
  }

  function stop(send) {
    discardRef.current = !send;
    if (!send && streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop();
    cancelAnimationFrame(animRef.current);
    setRecording(null);
  }

  async function handleFile(e) {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (f.size > MAX_UPLOAD_MEDIA) { alert("Максимум 2 ГБ на один файл"); return; }
    try {
      if (f.size > MAX_LOCAL_MEDIA) {
        setUploadProgress(1);
        const uploaded = await uploadLargeFile(f, setUploadProgress);
        setAttached({ name: uploaded.name, mimeType: uploaded.mimeType, size: uploaded.size, content: uploaded.content, fileEncryption: uploaded.fileEncryption });
        setUploadProgress(0);
        return;
      }
      const r = new FileReader();
      r.onloadend = () => setAttached({ name: f.name, mimeType: f.type, size: f.size, content: r.result });
      r.readAsDataURL(f);
    } catch (error) { setUploadProgress(0); alert(error.message); }
  }

  function sendLocation() {
    if (!navigator.geolocation) return alert("Геолокация недоступна");
    navigator.geolocation.getCurrentPosition((position) => onSend({ type: "location", location: { lat: position.coords.latitude, lon: position.coords.longitude, label: "Моя геопозиция" }, replyToId: replyTo?.id }), () => alert("Не удалось получить геопозицию"));
  }

  function sendContact() {
    const name = prompt("Имя контакта"); if (!name) return; const value = prompt("Телефон, логин или ссылка"); if (!value) return;
    onSend({ type: "contact", contact: { name, value }, replyToId: replyTo?.id });
  }

  function createPoll() {
    const question = prompt("Вопрос опроса"); if (!question) return; const raw = prompt("Варианты через точку с запятой"); const options = raw?.split(";").map((v) => v.trim()).filter(Boolean);
    if (!options || options.length < 2) return alert("Нужно минимум два варианта"); onSend({ type: "poll-create", question, options });
  }

  function scheduleText() {
    if (!text.trim()) return; const value = prompt("Дата и время отправки, например 2026-08-03 12:30"); if (!value) return; const sendAt = new Date(value).getTime();
    if (!Number.isFinite(sendAt)) return alert("Некорректная дата"); onSend({ type: "schedule", sendAt, payload: { type: "text", content: text.trim(), replyToId: replyTo?.id } }); setText(""); onCancelReply?.();
  }


  function sendSticker(sticker) {
    onSend({ type: "sticker", sticker: typeof sticker === "string" ? { emoji: sticker } : sticker, content: typeof sticker === "string" ? undefined : sticker.content, mimeType: typeof sticker === "string" ? undefined : sticker.mimeType, name: typeof sticker === "string" ? undefined : sticker.name, replyToId: replyTo?.id });
    setStickerOpen(false); onCancelReply?.();
  }

  function submit(e) {
    e.preventDefault();
    if (attached) { onSend({ type: "file", ...attached, replyToId: replyTo?.id }); setAttached(null); setText(""); onCancelReply?.(); return; }
    if (!text.trim()) return;
    onSend({ type: "text", content: text.trim(), replyToId: replyTo?.id });
    setText(""); onCancelReply?.();
  }

  if (disabled) return <div className="input-disabled">{disabledText}</div>;

  return (
    <div className="input-root">
      {recording === "voice" && (
        <div className="rec-box">
          <span className="rec-dot" />
          <canvas ref={canvasRef} width={280} height={40} className="rec-canvas" />
          <span className="rec-time">{fmt(recTime)}</span>
          <button className="btn-small danger" onClick={() => stop(false)}><IconClose size={13} /></button>
          <button className="btn-small primary" onClick={() => stop(true)}><IconSend size={14} /></button>
        </div>
      )}

      {recording === "video" && (
        <div className="rec-box video">
          <div className="vid-preview">
            <video ref={videoRef} autoPlay muted playsInline className="vid-self" style={{ transform: facing === "user" ? "scaleX(-1)" : "none" }} />
            <div className="vid-badge"><span className="rec-dot" /> {fmt(recTime)}</div>
            {canFlip && (
              <button type="button" className="vid-flip-btn" onClick={flipCamera} title="Сменить камеру">
                <IconFlipCamera size={17} />
              </button>
            )}
          </div>
          <div className="rec-box-controls">
            <button className="btn-small danger" onClick={() => stop(false)}><IconClose size={13} /> Отмена</button>
            <button className="btn-small primary" onClick={() => stop(true)}><IconSend size={14} /> Отправить</button>
          </div>
        </div>
      )}

      {!recording && (
        <>
          {replyTo && <div className="reply-compose"><span><b>Ответ</b> {replyTo.text || replyTo.name || "Вложение"}</span><button onClick={onCancelReply}>✕</button></div>}
          {uploadProgress > 0 && <div className="upload-progress"><span style={{ width: `${uploadProgress}%` }} /><b>{uploadProgress}%</b></div>}
          {attached && (
            <div className="attach-box">
              {attached.mimeType.startsWith("image/") ? <img src={attached.content} alt="" /> : <span className="attach-fallback">ФАЙЛ</span>}
              <span className="attach-name">{attached.name}</span>
              <button className="icon-btn-sm" onClick={() => setAttached(null)}><IconClose size={13} /></button>
            </div>
          )}
          {stickerOpen && <div className="sticker-picker">
            <div className="sticker-picker-head"><strong>Стикеры</strong><button onClick={() => setStickerOpen(false)}>✕</button></div>
            <div className="sticker-grid default">{DEFAULT_STICKERS.map((emoji) => <button key={emoji} onClick={() => sendSticker(emoji)}>{emoji}</button>)}</div>
            {stickerPacks.map((pack) => <section key={pack.id}><h4>{pack.title}</h4><div className="sticker-grid">{(pack.items || []).map((item, index) => <button key={item.id || `${pack.id}-${index}`} onClick={() => sendSticker(item)}><img src={item.content} alt={item.name || "Стикер"} /></button>)}</div></section>)}
          </div>}
          <div className="input-line">
            <button type="button" className="icon-btn-round" onClick={() => fileRef.current.click()} title="Прикрепить файл">
              <IconPaperclip size={19} />
            </button><button type="button" className="icon-btn-round" onClick={sendLocation} title="Геопозиция">📍</button>
            <button type="button" className="icon-btn-round" onClick={sendContact} title="Контакт">👤</button>
            <button type="button" className="icon-btn-round" onClick={createPoll} title="Опрос">📊</button>
            <input ref={fileRef} type="file" hidden onChange={handleFile} />
            <button type="button" className={`icon-btn-round ${stickerOpen ? "active" : ""}`} onClick={() => setStickerOpen((value) => !value)} title="Стикеры">🙂</button>
            <textarea placeholder="Сообщение..." value={text} onChange={(e) => changeText(e.target.value)} rows={1} />
            <button type="button" className="icon-btn-round" onClick={startVoice} title="Голосовое сообщение">
              <IconMic size={19} />
            </button>
            <button type="button" className="icon-btn-round" onClick={() => startVideo()} title="Видеосообщение">
              <IconCamera size={19} />
            </button>
            <button type="button" className="icon-btn-round" onClick={scheduleText} title="Запланировать">🕒</button>
            <button className="btn-send-round" onClick={submit} disabled={!text.trim() && !attached} title="Отправить">
              <IconSend size={17} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default MessageInput;
