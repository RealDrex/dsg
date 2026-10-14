/**
 * Admin API client. The access token lives in memory only; the refresh
 * token is kept in sessionStorage so a reload of the same tab stays signed
 * in, but closing the tab signs out. Production hosting must send a strict
 * CSP (see docs/SECURITY.md) to protect it.
 */
const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:4000';
const KEY = 'bp.admin.refresh';

let access: string | null = null;
let onLogout: () => void = () => {};
export const setLogoutHandler = (fn: () => void) => { onLogout = fn; };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function raw<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(auth && access ? { authorization: `Bearer ${access}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? res.statusText);
  return json as T;
}

async function refresh(): Promise<boolean> {
  const token = sessionStorage.getItem(KEY);
  if (!token) return false;
  try {
    const r = await raw<{ accessToken: string; refreshToken: string; user: { role: string } }>('POST', '/v1/auth/refresh', { refreshToken: token }, false);
    if (r.user.role !== 'admin') return false;
    access = r.accessToken;
    sessionStorage.setItem(KEY, r.refreshToken);
    return true;
  } catch {
    sessionStorage.removeItem(KEY);
    return false;
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await raw<T>(method, path, body);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && (await refresh())) return raw<T>(method, path, body);
    if (e instanceof ApiError && e.status === 401) onLogout();
    throw e;
  }
}

export async function login(email: string, password: string) {
  const r = await raw<{ accessToken: string; refreshToken: string; user: { role: string; email: string } }>('POST', '/v1/auth/login', { email, password }, false);
  if (r.user.role !== 'admin') throw new ApiError(403, 'forbidden', 'This account is not an administrator');
  access = r.accessToken;
  sessionStorage.setItem(KEY, r.refreshToken);
  return r.user;
}

export async function restore(): Promise<boolean> {
  return refresh();
}

export async function logout() {
  const token = sessionStorage.getItem(KEY);
  if (token) await raw('POST', '/v1/auth/logout', { refreshToken: token }, false).catch(() => {});
  sessionStorage.removeItem(KEY);
  access = null;
}

export const get = <T,>(p: string) => request<T>('GET', p);
export const post = <T,>(p: string, b: unknown = {}) => request<T>('POST', p, b);
export const patch = <T,>(p: string, b: unknown) => request<T>('PATCH', p, b);
export const del = <T,>(p: string) => request<T>('DELETE', p);
