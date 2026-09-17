import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, absoluteMediaUrl, connectSocket, sendSocketEvent } from "../shared/lib/api";
import { ensureE2EDevice, encryptSecretText } from "../shared/lib/e2e";
import { getChatTitle } from "../shared/lib/chat";
import useAuth from "../hooks/useAuth";
import ChatList from "../features/chat-list/ChatList";
import ChatWindow from "../features/chat-window/ChatWindow";
import CreateChatModal from "../features/create-chat-modal/CreateChatModal";
import CallOverlay from "../features/call-overlay/CallOverlay";

function normalizeMessage(msg) {
  return { ...msg, content: msg.content ? absoluteMediaUrl(msg.content) : msg.content, likes: msg.likes || [], reactions: msg.reactions || {}, hiddenFor: msg.hiddenFor || [] };
}

function MessengerPage() {
  const { user, users, refreshUsers } = useAuth();
  const [chats, setChats] = useState([]); const [messages, setMessages] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState(() => localStorage.getItem("openChatId") || null);
  const [showCreate, setShowCreate] = useState(false); const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("chatSidebarCollapsed") === "true");
  const [draftText, setDraftText] = useState(""); const [typing, setTyping] = useState({}); const [activeCall, setActiveCall] = useState(null);
  const refreshTimer = useRef(null); const draftTimer = useRef(null); const inviteHandled = useRef(false); const chatsRef = useRef([]);

  const loadData = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const result = await api("/chats"); const nextChats = result.chats || [];
      const groups = await Promise.all(nextChats.map(async (chat) => { try { return (await api(`/chats/${chat.id}/messages?limit=100`)).messages || []; } catch { return []; } }));
      setChats(nextChats); setMessages(groups.flat().map(normalizeMessage));
      if (selectedChatId && !nextChats.some((chat) => chat.id === selectedChatId)) setSelectedChatId(null);
    } catch (error) { if (!quiet) alert(error.message); }
    finally { if (!quiet) setLoading(false); }
  }, [selectedChatId]);

  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(() => { loadData({ quiet: true }).catch(() => {}); refreshUsers().catch(() => {}); }, 120);
  }, [loadData, refreshUsers]);

  useEffect(() => { ensureE2EDevice(user.id).catch(() => {}); loadData(); return () => clearTimeout(refreshTimer.current); }, []);
  useEffect(() => { chatsRef.current = chats; }, [chats]);

  useEffect(() => connectSocket((event) => {
    if (["sync", "users.updated", "presence", "message.read", "message.delivered", "draft.updated"].includes(event.type)) scheduleRefresh();
    if (event.type === "typing") {
      setTyping((state) => ({ ...state, [event.chatId]: event.state === "idle" ? null : { userId: event.userId, expiresAt: event.expiresAt } }));
      setTimeout(() => setTyping((state) => state[event.chatId]?.expiresAt <= Date.now() ? { ...state, [event.chatId]: null } : state), 5200);
    }
    if (event.type === "message.created" && event.message) {
      const normalized = normalizeMessage(event.message);
      setMessages((all) => all.some((m) => m.id === normalized.id) ? all : [...all, normalized]);
      if (event.message.senderId !== user.id) api(`/messages/${event.message.id}/delivered`, { method: "POST", body: {} }).catch(() => {});
      const chat = chatsRef.current.find((item) => item.id === event.chatId); const settings = user.settings || {};
      const allowed = chat?.type === "group" ? settings.groupNotifications !== false : chat?.type === "channel" ? settings.channelNotifications !== false : settings.messageNotifications !== false;
      if (chat && allowed && !chat.mutedBy?.includes(user.id) && document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
        const sender = users.find((item) => item.id === event.message.senderId); const body = settings.notificationPreview === false || event.message.type === "e2e" ? "Новое сообщение" : (event.message.text || event.message.name || "Новое вложение");
        new Notification(getChatTitle(chat, user.id, users), { body: sender ? `${sender.username}: ${body}` : body });
      }
    }
    if (event.type === "call.incoming" && event.call?.participantIds.includes(user.id)) setActiveCall({ ...event.call, incoming: true });
  }), [scheduleRefresh, user, users]);

  useEffect(() => { if (selectedChatId) localStorage.setItem("openChatId", selectedChatId); else localStorage.removeItem("openChatId"); }, [selectedChatId]);
  useEffect(() => { localStorage.setItem("chatSidebarCollapsed", String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => {
    if (!selectedChatId) { setDraftText(""); return; }
    api(`/drafts/${selectedChatId}`).then(({ draft }) => setDraftText(draft?.text || "")).catch(() => {});
  }, [selectedChatId]);

  const visibleChats = useMemo(() => chats.filter((chat) => chat.participants?.includes(user.id)), [chats, user.id]);
  const selectedChat = chats.find((chat) => chat.id === selectedChatId && chat.participants?.includes(user.id)) || null;
  const chatMessages = selectedChat ? messages.filter((msg) => msg.chatId === selectedChat.id && !msg.hiddenFor?.includes(user.id)).sort((a, b) => a.timestamp - b.timestamp) : [];

  useEffect(() => {
    const last = chatMessages.at(-1); if (!selectedChatId || !last || document.visibilityState !== "visible") return;
    api(`/chats/${selectedChatId}/read`, { method: "POST", body: { messageId: last.id } }).catch(() => {});
  }, [selectedChatId, chatMessages.at(-1)?.id]);

  const runAndRefresh = useCallback(async (task) => { try { const result = await task(); await loadData({ quiet: true }); return result; } catch (error) { alert(error.message); throw error; } }, [loadData]);

  const sendMessage = useCallback(async (payload) => {
    if (!selectedChatId || !selectedChat) return;
    if (payload.type === "poll-create") return runAndRefresh(() => api(`/chats/${selectedChatId}/polls`, { method: "POST", body: { question: payload.question, options: payload.options } }));
    if (payload.type === "schedule") return runAndRefresh(() => api(`/chats/${selectedChatId}/schedule`, { method: "POST", body: { sendAt: payload.sendAt, payload: payload.payload } }));
    let outgoing = { ...payload, clientMessageId: crypto.randomUUID() };
    if (selectedChat.secretMode && payload.type === "text") {
      const peerId = selectedChat.participants.find((id) => id !== user.id); outgoing = { ...(await encryptSecretText(user.id, peerId, payload.content)), replyToId: payload.replyToId, clientMessageId: outgoing.clientMessageId };
    }
    await runAndRefresh(() => api(`/chats/${selectedChatId}/messages`, { method: "POST", body: outgoing }));
    setDraftText(""); api(`/drafts/${selectedChatId}`, { method: "DELETE" }).catch(() => {});
  }, [selectedChatId, selectedChat, user.id, runAndRefresh]);

  const saveDraft = useCallback((value) => {
    setDraftText(value); if (!selectedChatId) return; clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => api(`/drafts/${selectedChatId}`, { method: "PUT", body: { text: value } }).catch(() => {}), 500);
  }, [selectedChatId]);
  const sendTyping = useCallback((state) => { if (selectedChatId) sendSocketEvent({ type: "typing", chatId: selectedChatId, state }); }, [selectedChatId]);

  const deleteMessage = useCallback((msgId, scope = "me") => runAndRefresh(() => api(`/messages/${msgId}?scope=${encodeURIComponent(scope)}`, { method: "DELETE" })), [runAndRefresh]);
  const editMessage = useCallback((msgId, newText) => runAndRefresh(() => api(`/messages/${msgId}`, { method: "PATCH", body: { text: newText } })), [runAndRefresh]);
  const toggleLike = useCallback((msgId) => runAndRefresh(() => api(`/messages/${msgId}/like`, { method: "POST" })), [runAndRefresh]);
  const react = useCallback((msgId, emoji) => runAndRefresh(() => api(`/messages/${msgId}/reactions`, { method: "POST", body: { emoji } })), [runAndRefresh]);
  const vote = useCallback((msgId, optionIds) => runAndRefresh(() => api(`/polls/${msgId}/vote`, { method: "POST", body: { optionIds } })), [runAndRefresh]);
  const togglePin = useCallback((chatId, msgId) => runAndRefresh(() => api(`/chats/${chatId}/pin`, { method: "POST", body: { messageId: msgId } })), [runAndRefresh]);
  const forwardMessage = useCallback((msg, targetChatId) => runAndRefresh(() => api(`/messages/${msg.id}/forward`, { method: "POST", body: { targetChatId } })), [runAndRefresh]);

  async function startCall(type) {
    if (!selectedChat || selectedChat.type !== "private" || selectedChat.isAiChat || selectedChat.isSavedMessages) return; const peerId = selectedChat.participants.find((id) => id !== user.id);
    try { const { call, iceServers } = await api("/calls", { method: "POST", body: { participantIds: [peerId], type } }); setActiveCall({ ...call, iceServers, incoming: false }); } catch (error) { alert(error.message); }
  }
  async function toggleSecret() { if (!selectedChat || selectedChat.isAiChat || selectedChat.isSavedMessages) return; await runAndRefresh(() => api(`/chats/${selectedChat.id}/secret`, { method: "POST", body: { enabled: !selectedChat.secretEnabledBy?.includes(user.id) } })); }

  async function createChat(data) { const result = await runAndRefresh(() => api("/chats", { method: "POST", body: data })); setSelectedChatId(result.chat.id); setShowCreate(false); }
  async function joinByInvite(rawCode) { try { const result = await api("/chats/join", { method: "POST", body: { invite: rawCode } }); await loadData({ quiet: true }); if (result.status === "pending") alert("Заявка отправлена"); if (result.chat?.id) setSelectedChatId(result.chat.id); setShowCreate(false); } catch (error) { alert(error.message); } }
  async function updateChat(chatId, patch) { await runAndRefresh(() => api(`/chats/${chatId}`, { method: "PATCH", body: patch })); }
  async function toggleMute(chatId) { await runAndRefresh(() => api(`/chats/${chatId}/mute`, { method: "POST" })); }
  async function approveRequest(chatId, userId) { await runAndRefresh(() => api(`/chats/${chatId}/requests/${userId}/approve`, { method: "POST" })); }
  async function rejectRequest(chatId, userId) { await runAndRefresh(() => api(`/chats/${chatId}/requests/${userId}/reject`, { method: "POST" })); }
  async function leaveChat(chatId) { await runAndRefresh(() => api(`/chats/${chatId}/leave`, { method: "POST" })); setSelectedChatId(null); }

  useEffect(() => { if (inviteHandled.current || loading) return; inviteHandled.current = true; const params = new URLSearchParams(window.location.search); const invite = params.get("invite"); if (invite) { window.history.replaceState({}, "", window.location.pathname); joinByInvite(invite); } }, [loading]);

  return <div className={`messenger ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
    <ChatList chats={visibleChats} messages={messages} selectedId={selectedChatId} onSelect={setSelectedChatId} currentUser={user} users={users} onOpenCreate={() => setShowCreate(true)} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} />
    {loading ? <div className="chat-window empty"><p>Загрузка чатов с сервера…</p></div> : <ChatWindow chat={selectedChat} chats={visibleChats} messages={chatMessages} currentUser={user} users={users} onSend={sendMessage} onDelete={deleteMessage} onEdit={editMessage} onLike={toggleLike} onReact={react} onVote={vote} onPin={togglePin} onForward={forwardMessage} onTyping={sendTyping} draftText={draftText} onDraftChange={saveDraft} onStartCall={startCall} onToggleSecret={toggleSecret} onToggleMute={() => selectedChat && toggleMute(selectedChat.id)} onUpdateChat={(patch) => selectedChat && updateChat(selectedChat.id, patch)} onApproveRequest={(id) => selectedChat && approveRequest(selectedChat.id, id)} onRejectRequest={(id) => selectedChat && rejectRequest(selectedChat.id, id)} onLeave={() => selectedChat && leaveChat(selectedChat.id)} onBack={() => setSelectedChatId(null)} typingState={selectedChat ? typing[selectedChat.id] : null} />}
    {showCreate && <CreateChatModal users={users} currentUser={user} onCreate={createChat} onJoin={joinByInvite} onClose={() => setShowCreate(false)} />}
    {activeCall && <CallOverlay call={activeCall} currentUser={user} users={users} incoming={activeCall.incoming} onClose={() => setActiveCall(null)} />}
  </div>;
}
export default MessengerPage;
