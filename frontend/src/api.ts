import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "spike_token";

const isWeb = Platform.OS === "web";

export async function saveToken(token: string) {
  if (isWeb) {
    try {
      window.localStorage.setItem(KEY, token);
    } catch {}
    return;
  }
  await SecureStore.setItemAsync(KEY, token);
}

export async function getToken(): Promise<string | null> {
  if (isWeb) {
    try {
      return window.localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }
  return await SecureStore.getItemAsync(KEY);
}

export async function clearToken() {
  if (isWeb) {
    try {
      window.localStorage.removeItem(KEY);
    } catch {}
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

let inMemoryToken: string | null = null;
export function setInMemoryToken(t: string | null) {
  inMemoryToken = t;
}

export async function api<T = any>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isForm ? {} : { "Content-Type": "application/json" }),
    ...((opts.headers as Record<string, string>) || {}),
  };
  const token = inMemoryToken ?? (await getToken());
  if (opts.auth !== false && token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}/api${path}`, { ...opts, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err: any = new Error(data?.detail || data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}
