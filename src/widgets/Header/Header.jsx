import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import useAuth from "../../hooks/useAuth";
import { api } from "../../shared/lib/api";
import Avatar from "../../shared/ui/Avatar";

const NAV = [
  ["/", "💬", "Мессенджер"],
  ["/news", "📰", "Новости"],
  ["/boards", "📌", "Доски"],
  ["/rooms", "◉", "Комнаты"],
  ["/games", "🎮", "Игры"],
  ["/search", "⌕", "Поиск"],
  ["/settings", "⚙", "Настройки"],
];

function Header() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const [config, setConfig] = useState({ siteName: "НЕМАКС", announcement: "" });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api("/config/public").then(setConfig).catch(() => {});
    const update = (event) => setConfig((current) => ({ ...current, ...(event.detail || {}) }));
    window.addEventListener("system:config", update);
    return () => window.removeEventListener("system:config", update);
  }, []);
  useEffect(() => setMenuOpen(false), [loc.pathname]);

  if (!user) return null;
  const admin = user.role === "admin" || user.isSystemAdmin;

  return <>
    <header className="app-header">
      <div className="header-container">
        <Link to="/" className="logo" aria-label={config.siteName || "НЕМАКС"}>
          <img src="/nemax-logo-mark.png" alt="" className="logo-mark" />
          <span className="logo-text">{config.siteName || "НЕМАКС"}</span>
        </Link>
        <button className="mobile-menu-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Меню">{menuOpen ? "✕" : "☰"}</button>
        <nav className={`header-nav ${menuOpen ? "open" : ""}`}>
          {NAV.map(([path, icon, label]) => <Link key={path} to={path} className={loc.pathname === path ? "active" : ""}><span>{icon}</span>{label}</Link>)}
          {admin && <Link to="/admin" className={loc.pathname === "/admin" ? "active admin-link" : "admin-link"}><span>🛡</span>Админ</Link>}
          <div className="header-profile-chip"><Avatar src={user.avatar} kind={user.avatarKind} mimeType={user.avatarMimeType} color={user.avatarColor} letter={user.username?.[0]} online statusEmoji={user.statusEmoji} size="tiny" /><span>{user.username}</span></div>
          <button onClick={logout} className="nav-btn">Выйти</button>
        </nav>
      </div>
    </header>
    {config.announcement && <div className="system-announcement">{config.announcement}</div>}
    {user.mustChangePassword && <div className="password-warning">Используется стартовый пароль администратора. Смените его в настройках.</div>}
  </>;
}

export default Header;
