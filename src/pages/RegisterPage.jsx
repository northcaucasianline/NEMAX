import { useState, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import CityPicker from "../shared/ui/CityPicker";
import CustomSelect from "../shared/ui/CustomSelect";

const GENDERS = [
  { value: "male", label: "Мужской" },
  { value: "female", label: "Женский" }
];

const STATUSES = [
  { value: "single", label: "В поиске" },
  { value: "complicated", label: "Всё сложно" },
  { value: "married", label: "Женат / замужем" }
];

function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [form, setForm] = useState({
    username: "", publicUsername: "", login: "", password: "", confirmPassword: "",
    age: "", gender: "", relationshipStatus: "", city: "", bio: ""
  });
  const [avatar, setAvatar] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [error, setError] = useState("");

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
    if (error) setError("");
  }

  function handleAvatar(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setError("Для аватара выберите изображение, GIF или короткое видео");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Аватар должен быть не больше 12 МБ");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => { setAvatar(reader.result); setAvatarFile(file); };
    reader.readAsDataURL(file);
  }

  function validate() {
    if (!form.username.trim()) return "Введите имя";
    if (!form.age || +form.age < 18 || +form.age > 99) return "Возраст должен быть от 18 до 99";
    if (!form.gender) return "Выберите пол";
    if (!form.relationshipStatus) return "Выберите статус отношений";
    if (!form.city.trim()) return "Укажите город";
    if (!/^[a-z0-9_]{3,32}$/.test(form.login)) return "Логин: 3–32 символа a-z, 0-9 или _";
    if (!form.password || form.password.length < 8) return "Пароль минимум 8 символов";
    if (form.password !== form.confirmPassword) return "Пароли не совпадают";
    if (!form.bio.trim()) return "Напишите пару слов о себе";
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    try {
      const { confirmPassword, ...data } = form;
      await register({ ...data, avatar, avatarName: avatarFile?.name || "", avatarMimeType: avatarFile?.type || "" });
      navigate("/");
    } catch (submitError) { setError(submitError.message); }
  }

  return (
    <main className="auth-root">
      <div className="auth-box wide">
        <div className="auth-brand auth-brand-register">
          <img src="/nemax-logo-mark.png" alt="Логотип НЕМАКС" className="auth-brand-mark" />
          <div className="auth-brand-copy">
            <span className="auth-brand-kicker">NEMAX</span>
            <h1>Регистрация</h1>
            <p>Создайте аккаунт в НЕМАКС и получите доступ к чатам, новостям, играм, комнатам и доскам объявлений.</p>
          </div>
        </div>
        <div className="auth-line" />

        <div className="avatar-box" onClick={() => fileRef.current.click()}>
          <div className="avatar-img register-avatar-preview">
            {avatar && avatarFile?.type?.startsWith("video/") ? <video src={avatar} autoPlay muted loop playsInline /> : avatar ? <img src={avatar} alt="Предпросмотр аватара" /> : <span className="avatar-placeholder">Фото</span>}
          </div>
          <div className="avatar-label">{avatar ? "Сменить аватар" : "Загрузить аватар"}</div>
          <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm" onChange={handleAvatar} hidden />
        </div>

        {error && <div className="auth-err">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-section-title">Основное</div>
          <div className="field-row">
            <div className="field-group">
              <label className="field-label">Имя</label>
              <input className="field" name="username" placeholder="Как вас называть" value={form.username} onChange={handleChange} />
            </div>
            <div className="field-group narrow">
              <label className="field-label">Возраст</label>
              <input className="field" name="age" type="number" placeholder="18+" value={form.age} onChange={handleChange} min="18" max="99" />
            </div>
          </div>

          <div className="field-row">
            <div className="field-group">
              <label className="field-label">Пол</label>
              <CustomSelect value={form.gender} onChange={(value) => setForm({ ...form, gender: value })} options={[{ value: "", label: "Выбрать", icon: "○" }, ...GENDERS.map((item) => ({ ...item, icon: item.value === "male" ? "♂" : "♀" }))]} placeholder="Выбрать" className="field-custom-select" />
            </div>
            <div className="field-group">
              <label className="field-label">Статус</label>
              <CustomSelect value={form.relationshipStatus} onChange={(value) => setForm({ ...form, relationshipStatus: value })} options={[{ value: "", label: "Выбрать", icon: "○" }, ...STATUSES.map((item) => ({ ...item, icon: item.value === "single" ? "⌕" : item.value === "complicated" ? "≈" : "♡" }))]} placeholder="Выбрать" className="field-custom-select" />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">Город</label>
            <CityPicker value={form.city} onChange={(value) => setForm({ ...form, city: value })} placeholder="Выберите город из справочника" required />
          </div>

          <div className="form-section-title">Вход и адрес профиля</div>
          <div className="field-row">
            <div className="field-group">
              <label className="field-label">Логин для входа</label>
              <input className="field" name="login" placeholder="my_login" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} autoComplete="username" />
            </div>
            <div className="field-group">
              <label className="field-label">Юзернейм (необязательно)</label>
              <input className="field" name="publicUsername" placeholder="public_name" value={form.publicUsername} onChange={(e) => setForm({ ...form, publicUsername: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
            </div>
          </div>

          <div className="field-row">
            <div className="field-group">
              <label className="field-label">Пароль</label>
              <input className="field" name="password" type="password" placeholder="Минимум 8 символов" value={form.password} onChange={handleChange} />
            </div>
            <div className="field-group">
              <label className="field-label">Повтор пароля</label>
              <input className="field" name="confirmPassword" type="password" placeholder="Повторите пароль" value={form.confirmPassword} onChange={handleChange} />
            </div>
          </div>

          <div className="form-section-title">О себе</div>
          <div className="field-group">
            <textarea className="field full area" name="bio" placeholder="Пару слов о себе..." rows={3} value={form.bio} onChange={handleChange} />
          </div>

          <button type="submit" className="btn-main">Создать аккаунт</button>
        </form>

        <div className="auth-foot">
          <Link to="/login">Уже есть аккаунт? Войти</Link>
        </div>
      </div>
    </main>
  );
}

export default RegisterPage;
