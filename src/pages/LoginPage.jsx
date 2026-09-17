import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import useAuth from "../hooks/useAuth";

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loginValue, setLoginValue] = useState("");
  const [totp, setTotp] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!loginValue || !password) { setError("ЗАПОЛНИТЕ ВСЕ ПОЛЯ"); return; }
    try {
      await login(loginValue, password, totp);
      navigate("/");
    } catch (err) {
      setError((err.message || "НЕ УДАЛОСЬ ВОЙТИ").toUpperCase());
    }
  }

  return (
    <main className="auth-root">
      <div className="auth-box">
        <div className="auth-brand">
          <img src="/nemax-logo-mark.png" alt="Логотип НЕМАКС" className="auth-brand-mark" />
          <div className="auth-brand-copy">
            <span className="auth-brand-kicker">NEMAX</span>
            <h1>Вход</h1>
            <p>Мессенджер, комнаты, доски, игры и AI-чаты в одном приложении.</p>
          </div>
        </div>
        <div className="auth-line" />
        {error && <div className="auth-err">{error}</div>}
        <form onSubmit={handleSubmit} className="auth-form">
          <input className="field full" placeholder="ЛОГИН" value={loginValue} onChange={(e) => setLoginValue(e.target.value.toLowerCase())} autoComplete="username" />
          <input className="field full" type="password" placeholder="ПАРОЛЬ" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <input className="field full" inputMode="numeric" placeholder="КОД 2FA (ЕСЛИ ВКЛЮЧЁН)" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          <button type="submit" className="btn-main">ВОЙТИ</button>
        </form>
        <div className="auth-foot">
          <Link to="/register">НЕТ АККАУНТА? СОЗДАТЬ</Link>
        </div>
      </div>
    </main>
  );
}

export default LoginPage;
