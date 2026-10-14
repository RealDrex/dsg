import Constants from 'expo-constants';
import type {
  AuthResponse, ChatResponse, HistoryResponse, HomeResponse, NotificationDTO, OffersResponse, ProductDTO, ProductSummaryDTO,
  ScanResponse, SortMode, UserDTO, WatchItemDTO, AssistantMessageDTO, SearchResponse, DiscoverJobDTO,
} from '@bestprice/core';
import { getSecret, setSecret } from './storage';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || 'http://localhost:4000').replace(/\/$/, '');

const REFRESH_KEY = 'bp.refresh';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

type Listener = (user: UserDTO | null) => void;

class Client {
  private access: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private listeners = new Set<Listener>();

  onUser(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(u: UserDTO | null) {
    this.listeners.forEach((l) => l(u));
  }

  private async adopt(a: AuthResponse) {
    this.access = a.accessToken;
    await setSecret(REFRESH_KEY, a.refreshToken);
    this.emit(a.user);
    return a.user;
  }

  /** Restores the session, or starts a guest session so the app works without an account. */
  private booting: Promise<UserDTO> | null = null;
  boot(guestProfile: Partial<UserDTO> = {}): Promise<UserDTO> {
    // single-flight: concurrent callers share one session restore / guest creation
    this.booting ??= (async () => {
      if (await this.tryRefresh()) return this.get<UserDTO>('/v1/me');
      return this.adopt(await this.raw<AuthResponse>('POST', '/v1/auth/guest', guestProfile, false));
    })().finally(() => { this.booting = null; });
    return this.booting;
  }

  private tryRefresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const token = await getSecret(REFRESH_KEY);
        if (!token) return false;
        const r = await this.raw<AuthResponse>('POST', '/v1/auth/refresh', { refreshToken: token }, false);
        await this.adopt(r);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await setSecret(REFRESH_KEY, null);
        else throw e;
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async raw<T>(method: string, path: string, body: unknown, auth: boolean, timeoutMs = 30_000): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(API_URL + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(auth && this.access ? { authorization: `Bearer ${this.access}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (res.status === 204) return undefined as T;
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = (json as { error?: { code?: string; message?: string } }).error;
        throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? res.statusText);
      }
      return json as T;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(0, 'network', 'Network error');
    } finally {
      clearTimeout(timer);
    }
  }

  async request<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    try {
      return await this.raw<T>(method, path, body, true, timeoutMs);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && e.code !== 'invalid_credentials') {
        if (await this.tryRefresh()) return this.raw<T>(method, path, body, true, timeoutMs);
        await this.boot();
        return this.raw<T>(method, path, body, true, timeoutMs);
      }
      throw e;
    }
  }
  get<T>(p: string) { return this.request<T>('GET', p); }
  post<T>(p: string, b?: unknown) { return this.request<T>('POST', p, b ?? {}); }
  patch<T>(p: string, b: unknown) { return this.request<T>('PATCH', p, b); }
  put<T>(p: string, b: unknown) { return this.request<T>('PUT', p, b); }
  del<T>(p: string) { return this.request<T>('DELETE', p); }

  // ---- auth
  async login(email: string, password: string) { return this.adopt(await this.raw<AuthResponse>('POST', '/v1/auth/login', { email, password }, false)); }
  /** Upgrades the current guest account in place (keeps watchlist and chats). */
  async register(email: string, password: string, name?: string) {
    const body = { email, password, name };
    try {
      return this.adopt(await this.raw<AuthResponse>('POST', '/v1/auth/register', body, true));
    } catch (e) {
      // An expired access token must not turn the upgrade into a separate new account.
      if (e instanceof ApiError && e.status === 401 && (await this.tryRefresh())) {
        return this.adopt(await this.raw<AuthResponse>('POST', '/v1/auth/register', body, true));
      }
      throw e;
    }
  }
  async logout() {
    const token = await getSecret(REFRESH_KEY);
    if (token) await this.raw('POST', '/v1/auth/logout', { refreshToken: token }, false).catch(() => {});
    await setSecret(REFRESH_KEY, null);
    this.access = null;
    return this.boot();
  }

  // ---- endpoints
  me = () => this.get<UserDTO>('/v1/me');
  updateMe = (p: Partial<UserDTO>) => this.patch<UserDTO>('/v1/me', p);
  home = () => this.get<HomeResponse>('/v1/home');
  search = (q: string) => this.get<SearchResponse>(`/v1/products/search?q=${encodeURIComponent(q)}`);
  /** Starts a web search (text, barcode or photo); poll the job with discoverJob. */
  discover = (b: { q: string } | { gtin: string } | { image: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }; q?: string }) =>
    this.request<DiscoverJobDTO>('POST', '/v1/products/discover', b, 60_000);
  discoverJob = (jobId: string) => this.get<DiscoverJobDTO>(`/v1/products/discover/${jobId}`);
  /** More sellers, or used listings, for a product. */
  discoverProduct = (id: string, focus: 'all' | 'used') => this.request<DiscoverJobDTO>('POST', `/v1/products/${id}/discover`, { focus });
  product = (id: string) => this.get<ProductDTO>(`/v1/products/${id}`);
  offers = (id: string, sort: SortMode, loc?: { lat: number; lng: number } | null) =>
    this.get<OffersResponse>(`/v1/products/${id}/offers?sort=${sort}${loc ? `&lat=${loc.lat.toFixed(3)}&lng=${loc.lng.toFixed(3)}` : ''}`);
  history = (id: string) => this.get<HistoryResponse>(`/v1/products/${id}/history`);
  scan = (raw: string) => this.post<ScanResponse>('/v1/scan', { raw });
  watches = () => this.get<WatchItemDTO[]>('/v1/watches');
  addWatch = (productId: string, targetMinor: number) => this.post<{ id: string }>('/v1/watches', { productId, targetMinor });
  updateWatch = (id: string, targetMinor: number) => this.patch(`/v1/watches/${id}`, { targetMinor });
  removeWatch = (id: string) => this.del(`/v1/watches/${id}`);
  notifications = () => this.get<NotificationDTO[]>('/v1/notifications');
  readNotifications = (ids: string[]) => this.post('/v1/notifications/read', { ids });
  preferences = () => this.get<{ id: string; text: string }[]>('/v1/me/preferences');
  addPreference = (text: string) => this.post('/v1/me/preferences', { text });
  removePreference = (id: string) => this.del(`/v1/me/preferences/${id}`);
  clearHistory = () => this.del('/v1/me/history');
  exportData = () => this.get<unknown>('/v1/me/export');
  deleteAccount = async () => { await this.del('/v1/me'); await setSecret(REFRESH_KEY, null); this.access = null; };
  setPushToken = (token: string | null) => this.put('/v1/me/push-token', { token });
  purchase = (offerId: string) => this.post<{ savedMinor: number; paidMinor: number }>('/v1/purchases', { offerId });
  startChat = (productIds: string[], lang: string) => this.post<ChatResponse>('/v1/assistant/conversations', { productIds, lang });
  chat = (b: { conversationId?: string; message: string; productIds?: string[]; lang: string }) => this.post<ChatResponse>('/v1/assistant/chat', b);
  conversation = (id: string) => this.get<{ messages: AssistantMessageDTO[] }>(`/v1/assistant/conversations/${id}`);
}

export const api = new Client();
