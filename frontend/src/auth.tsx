import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, saveToken, getToken, clearToken, setInMemoryToken } from "./api";

export type User = {
  user_id: string;
  email?: string;
  role: "customer" | "handyman" | "admin";
  legal_name?: string;
  avatar?: string;
  zip_code?: string;
  identity_status?: string;
  categories?: string[];
  rating_avg?: number;
  reliability_score?: number;
  completed_jobs?: number;
};

type Ctx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, captchaToken: string) => Promise<void>;
  register: (payload: any) => Promise<void>;
  loginWithSession: (session_id: string, role?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: User }>("/auth/me");
      setUser(r.user);
    } catch {
      setUser(null);
      setInMemoryToken(null);
      await clearToken();
    }
  }, []);

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (t) {
        setInMemoryToken(t);
        await refresh();
      }
      setLoading(false);
    })();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string, captchaToken: string) => {
    const r = await api<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email, password, captcha_token: captchaToken }),
    });
    setInMemoryToken(r.token);
    await saveToken(r.token);
    setUser(r.user);
  }, []);

  const register = useCallback(async (payload: any) => {
    const r = await api<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    });
    setInMemoryToken(r.token);
    await saveToken(r.token);
    setUser(r.user);
  }, []);

  const loginWithSession = useCallback(async (session_id: string, role?: string) => {
    const r = await api<{ session_token: string; user: User }>("/auth/session", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ session_id, role }),
    });
    setInMemoryToken(r.session_token);
    await saveToken(r.session_token);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    setInMemoryToken(null);
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, loginWithSession, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}
