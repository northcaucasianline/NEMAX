import { useCallback, useEffect, useState } from "react";
import AuthContext from "./AuthContext";
import { api, connectSocket, gameApi, getToken, setTokens } from "../shared/lib/api";
import { applySettings, DEFAULT_SETTINGS, getSettings } from "../shared/lib/settings";

async function claimDailyGameBonus() {
  try {
    const result = await gameApi("/wallet");
    if (Number(result.dailyAwarded || 0) > 0) {
      localStorage.setItem("nemaxDailyBonusNotice", JSON.stringify({ amount: result.dailyAwarded, day: result.wallet?.lastDailyBonusDay || "" }));
      window.dispatchEvent(new CustomEvent("game:daily-bonus", { detail: result }));
    }
  } catch {
    // Игровой сервер не должен блокировать вход в мессенджер.
  }
}

function AuthProvider({ children }) {
  const [users, setUsers] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUsers = useCallback(async () => {
    if (!getToken()) return [];
    const result = await api("/users");
    setUsers(result.users || []);
    return result.users || [];
  }, []);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      if (!getToken()) {
        applySettings(DEFAULT_SETTINGS);
        if (active) setLoading(false);
        return;
      }
      try {
        const result = await api("/auth/me");
        if (!active) return;
        setUser(result.user);
        applySettings(getSettings(result.user));
        await refreshUsers();
        claimDailyGameBonus();
      } catch {
        setTokens("", "");
        if (active) {
          setUser(null);
          setUsers([]);
          applySettings(DEFAULT_SETTINGS);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    bootstrap();
    return () => { active = false; };
  }, [refreshUsers]);

  useEffect(() => {
    if (!user || !getToken()) return undefined;
    return connectSocket((event) => {
      if (event.type === "presence" && event.user) {
        setUsers((all) => all.map((item) => item.id === event.user.id ? { ...item, ...event.user } : item));
      }
      if (event.type === "users.updated") refreshUsers().catch(() => {});
      if (event.type === "admin.broadcast") window.dispatchEvent(new CustomEvent("admin:broadcast", { detail: event }));
      if (event.type === "system.config.updated") window.dispatchEvent(new CustomEvent("system:config", { detail: event.config || {} }));
    });
  }, [user, refreshUsers]);

  async function register(userData) {
    const result = await api("/auth/register", { method: "POST", body: userData });
    setTokens(result.token, result.refreshToken, result.expiresAt);
    setUser(result.user);
    applySettings(getSettings(result.user));
    await refreshUsers();
    claimDailyGameBonus();
    return result.user;
  }

  async function login(login, password, totp = "") {
    const result = await api("/auth/login", { method: "POST", body: { login, password, totp } });
    setTokens(result.token, result.refreshToken, result.expiresAt);
    setUser(result.user);
    applySettings(getSettings(result.user));
    await refreshUsers();
    claimDailyGameBonus();
    return result.user;
  }

  async function logout() {
    try { if (getToken()) await api("/auth/logout", { method: "POST" }); } catch {}
    setTokens("", "");
    setUser(null);
    setUsers([]);
    applySettings(DEFAULT_SETTINGS);
  }

  async function updateProfile(updated) {
    const result = await api("/users/me", { method: "PATCH", body: updated });
    setUser(result.user);
    applySettings(getSettings(result.user));
    setUsers((all) => all.map((item) => item.id === result.user.id ? result.user : item));
    return result.user;
  }

  async function updateSettings(nextSettings) {
    return updateProfile({ settings: { ...getSettings(user), ...nextSettings } });
  }

  return (
    <AuthContext.Provider value={{ user, users, loading, login, logout, register, updateProfile, updateSettings, refreshUsers }}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;
