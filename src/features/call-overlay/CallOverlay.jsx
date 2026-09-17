import { useEffect, useRef, useState } from "react";
import { api, connectSocket, sendSocketEvent } from "../../shared/lib/api";

function CallOverlay({ call, currentUser, users, incoming = false, onClose }) {
  const [status, setStatus] = useState(incoming ? "Входящий звонок" : "Соединение…");
  const [accepted, setAccepted] = useState(!incoming);
  const localVideo = useRef(null); const remoteVideo = useRef(null); const peer = useRef(null); const stream = useRef(null);
  const remoteId = call.participantIds.find((id) => id !== currentUser.id); const remoteUser = users.find((u) => u.id === remoteId);

  async function prepare(initiator) {
    if (peer.current) return;
    stream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.type === "video" });
    if (localVideo.current) localVideo.current.srcObject = stream.current;
    const configuration = { iceServers: call.iceServers || [{ urls: ["stun:stun.l.google.com:19302"] }] };
    const pc = new RTCPeerConnection(configuration); peer.current = pc;
    stream.current.getTracks().forEach((track) => pc.addTrack(track, stream.current));
    pc.ontrack = (event) => { if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0]; };
    pc.onicecandidate = (event) => { if (event.candidate) sendSocketEvent({ type: "call.ice", callId: call.id, targetUserId: remoteId, candidate: event.candidate }); };
    pc.onconnectionstatechange = () => setStatus(pc.connectionState === "connected" ? "На связи" : pc.connectionState);
    if (initiator) { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); sendSocketEvent({ type: "call.offer", callId: call.id, targetUserId: remoteId, sdp: offer }); }
  }

  useEffect(() => {
    const disconnect = connectSocket(async (event) => {
      if (event.callId !== call.id) return;
      if (event.type === "call.accept" && !incoming) { setAccepted(true); setStatus("Соединение…"); await prepare(true); }
      if (event.type === "call.offer") { await prepare(false); await peer.current.setRemoteDescription(event.sdp); const answer = await peer.current.createAnswer(); await peer.current.setLocalDescription(answer); sendSocketEvent({ type: "call.answer", callId: call.id, targetUserId: event.userId, sdp: answer }); setStatus("На связи"); }
      if (event.type === "call.answer") { await peer.current?.setRemoteDescription(event.sdp); setStatus("На связи"); }
      if (event.type === "call.ice" && event.candidate) await peer.current?.addIceCandidate(event.candidate);
      if (["call.hangup", "call.end", "call.decline"].includes(event.type)) close(false);
    });
    return () => disconnect();
  }, [accepted]);

  async function accept() { await api(`/calls/${call.id}/accept`, { method: "POST", body: {} }); setAccepted(true); setStatus("Соединение…"); await prepare(false); }
  async function close(notify = true) { if (notify) { sendSocketEvent({ type: "call.hangup", callId: call.id, targetUserId: remoteId }); try { await api(`/calls/${call.id}/end`, { method: "POST", body: {} }); } catch {} } peer.current?.close(); stream.current?.getTracks().forEach((t) => t.stop()); onClose(); }

  return <div className="call-overlay"><div className="call-card"><h2>{remoteUser?.username || "Собеседник"}</h2><p>{status}</p><div className="call-videos"><video ref={remoteVideo} autoPlay playsInline /><video ref={localVideo} autoPlay muted playsInline /></div><div className="call-controls">{incoming && !accepted && <button className="btn-main" onClick={accept}>Принять</button>}<button className="danger-outline" onClick={() => close(true)}>Завершить</button></div></div></div>;
}
export default CallOverlay;
