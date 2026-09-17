import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import { absoluteMediaUrl, api, registerPushSubscription } from "../shared/lib/api";
import { applySettings, getSettings } from "../shared/lib/settings";
import Avatar from "../shared/ui/Avatar";
import CityPicker from "../shared/ui/CityPicker";
import CustomSelect from "../shared/ui/CustomSelect";

const sectionNames = { profile: "Профиль", security: "Безопасность", notifications: "Уведомления", privacy: "Конфиденциальность", appearance: "Оформление", stickers: "Стикеры", business: "Для бизнеса", platform: "Боты и приложения", data: "Данные и память" };

const PRIVACY_OPTIONS = [
  { value: "everyone", label: "Все", icon: "◎", description: "Доступно всем пользователям" },
  { value: "contacts", label: "Только контакты", icon: "◉", description: "Люди, с которыми вы общались" },
  { value: "nobody", label: "Никто", icon: "⊘", description: "Скрыть от всех" },
];
const BUBBLE_OPTIONS = [
  { value: "gradient", label: "Градиент", icon: "◈" },
  { value: "solid", label: "Однотонный", icon: "■" },
  { value: "outline", label: "Контурный", icon: "□" },
];
const WALLPAPER_OPTIONS = [
  { value: "aurora", label: "Аврора", icon: "✦" },
  { value: "grid", label: "Сетка", icon: "▦" },
  { value: "dots", label: "Точки", icon: "⠿" },
  { value: "plain", label: "Однотонный", icon: "■" },
];
const FONT_OPTIONS = [
  { value: "small", label: "Мелкий", icon: "A" },
  { value: "medium", label: "Обычный", icon: "A" },
  { value: "large", label: "Крупный", icon: "A" },
];

function Toggle({ label, description = "", checked, onChange }) {
  return <label className="switch-row"><span><strong>{label}</strong>{description && <small>{description}</small>}</span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /></label>;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
}

function SettingsPage() {
  const { user, updateProfile, updateSettings, logout } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState("profile");
  const [form, setForm] = useState({ username: user.username || "", publicUsername: user.publicUsername || "", age: user.age || "", gender: user.gender || "male", relationshipStatus: user.relationshipStatus || "single", city: user.city || "", bio: user.bio || "", statusText: user.statusText || "", statusEmoji: user.statusEmoji || "", statusExpiresAt: user.statusExpiresAt || 0 });
  const [avatar, setAvatar] = useState(user.avatar ? absoluteMediaUrl(user.avatar) : null);
  const [avatarMeta, setAvatarMeta] = useState({ changed: false, name: "", mimeType: user.avatarMimeType || "image/png", kind: user.avatarKind || "image" });
  const [settings, setSettings] = useState(() => getSettings(user));
  const [newPassword, setNewPassword] = useState("");
  const [sessions, setSessions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [totpSetup, setTotpSetup] = useState(null); const [totpCode, setTotpCode] = useState("");
  const [bots, setBots] = useState([]); const [botForm, setBotForm] = useState({ username: "", name: "" });
  const [business, setBusiness] = useState({ address: "", greeting: "", awayMessage: "" });
  const [stickerPacks, setStickerPacks] = useState([]);
  const [stickerTitle, setStickerTitle] = useState("");
  const [stickerItems, setStickerItems] = useState([]);

  useEffect(() => {
    api("/auth/sessions").then((result) => setSessions(result.sessions || [])).catch(() => {});
    api("/bots").then((result) => setBots(result.bots || [])).catch(() => {});
    api("/business/profile").then((result) => result.profile && setBusiness(result.profile)).catch(() => {});
    api("/stickers").then((result) => setStickerPacks(result.packs || [])).catch(() => {});
  }, []);

  function changeSetting(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    applySettings(next);
  }

  async function handleAvatar(event) {
    const file = event.target.files[0]; event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return alert("Поддерживаются изображения, GIF и короткие видео");
    if (file.size > 12 * 1024 * 1024) return alert("Аватар должен быть меньше 12 МБ");
    const data = await fileToDataUrl(file);
    setAvatar(data);
    setAvatarMeta({ changed: true, name: file.name, mimeType: file.type, kind: file.type.startsWith("video/") ? "video" : "image" });
  }

  async function saveProfile(event) {
    event.preventDefault(); setSaving(true);
    try {
      await updateProfile({ ...form, statusExpiresAt: Number(form.statusExpiresAt || 0), ...(avatarMeta.changed ? { avatar, avatarName: avatarMeta.name, avatarMimeType: avatarMeta.mimeType } : {}), ...(newPassword.length >= 8 ? { password: newPassword } : {}) });
      alert("Профиль обновлён на сервере"); setNewPassword(""); setAvatarMeta((current) => ({ ...current, changed: false }));
    } catch (error) { alert(error.message); }
    finally { setSaving(false); }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const notificationsEnabled = settings.messageNotifications || settings.groupNotifications || settings.channelNotifications;
      if (notificationsEnabled && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
      await updateSettings(settings); alert("Настройки сохранены на сервере");
    } catch (error) { alert(error.message); }
    finally { setSaving(false); }
  }

  async function closeOtherSessions() {
    if (!confirm("Завершить все остальные сеансы?")) return;
    try { await api("/auth/sessions/others", { method: "DELETE" }); setSessions((await api("/auth/sessions")).sessions || []); alert("Остальные сеансы завершены"); }
    catch (error) { alert(error.message); }
  }

  async function setup2fa() { try { setTotpSetup(await api("/security/2fa/setup", { method: "POST", body: {} })); } catch (error) { alert(error.message); } }
  async function enable2fa() { try { const result = await api("/security/2fa/enable", { method: "POST", body: { code: totpCode } }); alert(`2FA включена. Резервные коды: ${result.recoveryCodes.join(", ")}`); setTotpSetup(null); setTotpCode(""); } catch (error) { alert(error.message); } }
  async function enablePush() { try { const result = await registerPushSubscription(); alert(result.unavailable ? "Задайте VAPID-ключи на сервере" : "Push-уведомления подключены"); } catch (error) { alert(error.message); } }
  async function saveBusiness() { try { const result = await api("/business/profile", { method: "PUT", body: business }); setBusiness(result.profile); alert("Бизнес-профиль сохранён"); } catch (error) { alert(error.message); } }
  async function createBot() { try { const result = await api("/bots", { method: "POST", body: botForm }); setBots((all) => [...all, result.bot]); setBotForm({ username: "", name: "" }); window.prompt("Скопируйте токен — позже он не показывается", result.token); } catch (error) { alert(error.message); } }

  async function addStickerFiles(event) {
    const files = [...event.target.files].slice(0, 12 - stickerItems.length); event.target.value = "";
    for (const file of files) {
      if (!["image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 2 * 1024 * 1024) { alert(`${file.name}: нужен PNG/WebP/GIF до 2 МБ`); continue; }
      const content = await fileToDataUrl(file);
      setStickerItems((items) => [...items, { id: crypto.randomUUID(), name: file.name, content, mimeType: file.type, emoji: "✨" }].slice(0, 12));
    }
  }

  async function createStickerPack() {
    if (!stickerTitle.trim() || !stickerItems.length) return alert("Укажите название и добавьте хотя бы один стикер");
    try {
      const result = await api("/stickers", { method: "POST", body: { title: stickerTitle, shortName: `${user.userId}_${Date.now()}`, items: stickerItems, public: false } });
      setStickerPacks((packs) => [...packs, result.pack]); setStickerTitle(""); setStickerItems([]); alert("Стикерпак создан");
    } catch (error) { alert(error.message); }
  }

  async function doLogout() { await logout(); navigate("/login"); }

  return <div className="settings-page telegram-settings-page"><div className="settings-shell">
    <aside className="settings-sidebar">
      <div className="settings-user-mini"><Avatar src={avatar} kind={avatarMeta.kind} mimeType={avatarMeta.mimeType} color={user.avatarColor} letter={user.username?.[0]} online statusEmoji={form.statusEmoji} size="chat" /><div><strong>{user.username}</strong><small>ID {user.userId} · login: {user.login}</small></div></div>
      {Object.entries(sectionNames).map(([key, label]) => <button key={key} className={section === key ? "active" : ""} onClick={() => setSection(key)}>{label}</button>)}
      <button className="settings-logout-link" onClick={doLogout}>Выйти</button>
    </aside>

    <section className="settings-content">
      <div className="settings-content-head"><h1>{sectionNames[section]}</h1>{!["profile", "stickers", "business", "platform"].includes(section) && <button className="save-small" onClick={saveSettings} disabled={saving}>Сохранить</button>}</div>

      {section === "profile" && <form onSubmit={saveProfile} className="settings-section-form">
        <div className="avatar-upload large"><label className="avatar-preview smart-avatar-upload"><Avatar src={avatar} kind={avatarMeta.kind} mimeType={avatarMeta.mimeType} color={user.avatarColor} letter={user.username?.[0]} online statusEmoji={form.statusEmoji} size="xlarge" /><input type="file" accept="image/*,video/mp4,video/webm" onChange={handleAvatar} hidden /></label><span className="avatar-label">Фото, GIF или короткое видео</span></div>
        <div className="settings-group"><h3>Основное</h3><div className="profile-id-box"><span>Ваш ID</span><strong>{user.userId}</strong><small>{user.id}</small></div><div className="form-row"><input placeholder="Отображаемое имя" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /><input placeholder="Юзернейм (необязательно)" value={form.publicUsername} onChange={(e) => setForm({ ...form, publicUsername: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} /></div><p className="form-hint">Юзернейм виден как @{form.publicUsername || "не задан"}. Логин для входа не публикуется.</p><div className="form-row settings-city-row"><input type="number" placeholder="Возраст" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} /><CityPicker value={form.city} onChange={(value) => setForm({ ...form, city: value })} placeholder="Выберите город" /></div><div className="form-row"><CustomSelect value={form.gender} onChange={(value) => setForm({ ...form, gender: value })} options={[{ value: "male", label: "Мужской", icon: "♂" }, { value: "female", label: "Женский", icon: "♀" }, { value: "", label: "Не указывать", icon: "○" }]} /><CustomSelect value={form.relationshipStatus} onChange={(value) => setForm({ ...form, relationshipStatus: value })} options={[{ value: "single", label: "В активном поиске", icon: "⌕" }, { value: "complicated", label: "Всё сложно", icon: "≈" }, { value: "married", label: "В отношениях", icon: "♡" }]} /></div><textarea rows={4} placeholder="О себе" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></div>
        <div className="settings-group"><h3>Статус</h3><div className="form-row"><input className="status-emoji-input" placeholder="🙂" value={form.statusEmoji} onChange={(e) => setForm({ ...form, statusEmoji: e.target.value.slice(0, 12) })} /><input placeholder="Например: работаю, в дороге, отвечу вечером" value={form.statusText} onChange={(e) => setForm({ ...form, statusText: e.target.value.slice(0, 120) })} /></div><label>Сбросить статус<input type="datetime-local" onChange={(e) => setForm({ ...form, statusExpiresAt: e.target.value ? new Date(e.target.value).getTime() : 0 })} /></label></div>
        <div className="settings-group"><h3>Безопасность</h3><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Новый пароль (минимум 8 символов)" /><p className="form-hint">Пароль хешируется через scrypt и не хранится открыто.</p></div>
        <button className="btn-main" type="submit" disabled={saving}>{saving ? "Сохранение…" : "Сохранить профиль"}</button>
      </form>}

      {section === "security" && <div className="settings-groups"><div className="settings-group"><h3>Вход по логину и паролю</h3><p className="form-hint">Email и телефон не требуются. Access-токен ограничен по времени, refresh-токен ротируется.</p><button className="save-small" onClick={setup2fa}>Настроить необязательную 2FA</button>{totpSetup && <div className="security-setup"><code>{totpSetup.secret}</code><input value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-значный код" /><button onClick={enable2fa}>Подтвердить</button></div>}</div><div className="settings-group"><h3>Push и устройства</h3><button className="save-small" onClick={enablePush}>Подключить системные push</button>{sessions.map((session) => <div className="session-row" key={session.id}><span>{session.current ? "Это устройство" : session.userAgent}</span><b>{session.current ? "активно" : new Date(session.lastUsedAt || session.createdAt).toLocaleString()}</b></div>)}<button className="danger-outline" onClick={closeOtherSessions}>Завершить другие сеансы</button></div></div>}

      {section === "notifications" && <div className="settings-groups"><div className="settings-group"><h3>Уведомления</h3><Toggle label="Личные сообщения" checked={settings.messageNotifications} onChange={(v) => changeSetting("messageNotifications", v)} /><Toggle label="Группы" checked={settings.groupNotifications} onChange={(v) => changeSetting("groupNotifications", v)} /><Toggle label="Паблики" checked={settings.channelNotifications} onChange={(v) => changeSetting("channelNotifications", v)} /><Toggle label="Звук" checked={settings.sound} onChange={(v) => changeSetting("sound", v)} /><Toggle label="Предпросмотр текста" description="Показывать текст в уведомлении" checked={settings.notificationPreview} onChange={(v) => changeSetting("notificationPreview", v)} /></div></div>}

      {section === "privacy" && <div className="settings-groups"><div className="settings-group"><h3>Конфиденциальность</h3><label>Кто видит активность<CustomSelect value={settings.lastSeen} onChange={(value) => changeSetting("lastSeen", value)} options={PRIVACY_OPTIONS} /></label><label>Кто видит аватар<CustomSelect value={settings.profilePhoto} onChange={(value) => changeSetting("profilePhoto", value)} options={PRIVACY_OPTIONS} /></label><label>Кто может приглашать<CustomSelect value={settings.allowInvites} onChange={(value) => changeSetting("allowInvites", value)} options={PRIVACY_OPTIONS} /></label><Toggle label="Отчёты о прочтении" checked={settings.readReceipts} onChange={(v) => changeSetting("readReceipts", v)} /></div></div>}

      {section === "appearance" && <div className="settings-groups"><div className="settings-group"><h3>Тема и цвета</h3><div className="theme-picker"><button className={settings.theme === "dark" ? "active" : ""} onClick={() => changeSetting("theme", "dark")}>🌙 Тёмная</button><button className={settings.theme === "light" ? "active" : ""} onClick={() => changeSetting("theme", "light")}>☀️ Светлая</button></div><div className="color-settings"><label>Основной цвет<input type="color" value={settings.accentColor} onChange={(e) => changeSetting("accentColor", e.target.value)} /></label><label>Цвет своих сообщений<input type="color" value={settings.accentSecondary} onChange={(e) => changeSetting("accentSecondary", e.target.value)} /></label></div><label>Стиль пузырей<CustomSelect value={settings.bubbleStyle} onChange={(value) => changeSetting("bubbleStyle", value)} options={BUBBLE_OPTIONS} /></label><label>Фон чата<CustomSelect value={settings.chatWallpaper} onChange={(value) => changeSetting("chatWallpaper", value)} options={WALLPAPER_OPTIONS} /></label><label>Размер текста<CustomSelect value={settings.fontSize} onChange={(value) => changeSetting("fontSize", value)} options={FONT_OPTIONS} /></label><Toggle label="Компактный режим" checked={settings.compactMode} onChange={(v) => changeSetting("compactMode", v)} /><Toggle label="Список чатов по умолчанию только иконками" checked={settings.sidebarDefaultCollapsed} onChange={(v) => changeSetting("sidebarDefaultCollapsed", v)} /><Toggle label="Стеклянные эффекты" checked={settings.glassEffects} onChange={(v) => changeSetting("glassEffects", v)} /><Toggle label="Анимации" checked={settings.animations} onChange={(v) => changeSetting("animations", v)} /></div></div>}

      {section === "stickers" && <div className="settings-groups"><div className="settings-group"><h3>Мои стикерпаки</h3>{stickerPacks.length === 0 && <p className="form-hint">Создайте первый набор из PNG, WebP или GIF.</p>}<div className="sticker-pack-list">{stickerPacks.map((pack) => <div key={pack.id}><strong>{pack.title}</strong><span>{pack.items?.length || 0} стикеров</span></div>)}</div></div><div className="settings-group"><h3>Новый стикерпак</h3><input value={stickerTitle} onChange={(e) => setStickerTitle(e.target.value)} placeholder="Название набора" /><label className="board-file-label">Добавить стикеры<input type="file" accept="image/png,image/webp,image/gif" multiple onChange={addStickerFiles} /></label><div className="sticker-upload-grid">{stickerItems.map((item, index) => <button key={item.id} onClick={() => setStickerItems((items) => items.filter((_, i) => i !== index))} title="Удалить"><img src={item.content} alt="" /></button>)}</div><button className="btn-main" onClick={createStickerPack}>Создать набор</button></div></div>}

      {section === "business" && <div className="settings-groups"><div className="settings-group"><h3>Бизнес-профиль</h3><input placeholder="Адрес" value={business.address || ""} onChange={(e) => setBusiness({ ...business, address: e.target.value })} /><textarea placeholder="Приветственное сообщение" value={business.greeting || ""} onChange={(e) => setBusiness({ ...business, greeting: e.target.value })} /><textarea placeholder="Сообщение вне рабочего времени" value={business.awayMessage || ""} onChange={(e) => setBusiness({ ...business, awayMessage: e.target.value })} /><button className="btn-main" onClick={saveBusiness}>Сохранить</button></div></div>}

      {section === "platform" && <div className="settings-groups"><div className="settings-group"><h3>Создать бота</h3><input placeholder="Имя бота" value={botForm.name} onChange={(e) => setBotForm({ ...botForm, name: e.target.value })} /><input placeholder="username_bot" value={botForm.username} onChange={(e) => setBotForm({ ...botForm, username: e.target.value })} /><button className="btn-main" onClick={createBot}>Создать и получить токен</button></div><div className="settings-group"><h3>Мои боты</h3>{bots.map((bot) => <div className="session-row" key={bot.id}><span>{bot.name || bot.username}</span><b>@{bot.username}</b></div>)}<p className="form-hint">Bot API и Mini Apps остаются бесплатными функциями проекта.</p></div></div>}

      {section === "data" && <div className="settings-groups"><div className="settings-group"><h3>Автозагрузка медиа</h3><Toggle label="Автоматически загружать медиа" checked={settings.autoDownloadMedia} onChange={(v) => changeSetting("autoDownloadMedia", v)} /><Toggle label="Автовоспроизведение видео" checked={settings.autoPlayVideo} onChange={(v) => changeSetting("autoPlayVideo", v)} /><Toggle label="Экономия трафика" checked={settings.saveData} onChange={(v) => changeSetting("saveData", v)} /></div><div className="settings-group"><h3>Хранилище</h3><p className="storage-note">Production использует PostgreSQL, Redis Streams и S3/MinIO. В приложении нет платных тарифов или платных ограничений: все доступные функции работают одинаково для всех пользователей.</p></div></div>}
    </section>
  </div></div>;
}

export default SettingsPage;
