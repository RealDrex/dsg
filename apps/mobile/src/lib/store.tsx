import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getLocales } from 'expo-localization';
import type { AssistantMessageDTO, Lang, ProductSummaryDTO, UserDTO } from '@bestprice/core';
import { api, ApiError } from './api';
import { getPref, setPref } from './storage';
import { tr, type StrKey } from './i18n';

export interface Toast { title: string; sub?: string }

interface ChatState {
  conversationId?: string;
  product?: { id: string; name: string } | null;
  messages: AssistantMessageDTO[];
  typing: boolean;
}

interface AppCtx {
  ready: boolean;
  bootError: boolean;
  retryBoot: () => void;
  user: UserDTO | null;
  lang: Lang;
  rtl: boolean;
  t: (k: StrKey) => string;
  /** pick the ar/en variant of a pair */
  L: (ar: string, en: string) => string;
  onboarded: boolean;
  finishOnboarding: () => void;
  restartOnboarding: () => void;
  updateUser: (patch: Partial<UserDTO>) => Promise<void>;
  setLang: (l: Lang) => void;
  toast: Toast | null;
  showToast: (t: Toast) => void;
  dataVersion: number;
  bump: () => void;
  chat: ChatState;
  setChat: React.Dispatch<React.SetStateAction<ChatState>>;
  /** Opens a chat about a product; `ask` is sent as the first question. */
  startProductChat: (p: Pick<ProductSummaryDTO, 'id' | 'name'>, ask?: string) => Promise<void>;
  newChat: () => void;
  sendChat: (text: string) => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

function deviceLang(): Lang {
  const code = getLocales()[0]?.languageCode ?? 'ar';
  return code === 'en' ? 'en' : 'ar';
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState(false);
  const [user, setUser] = useState<UserDTO | null>(null);
  const [lang, setLangState] = useState<Lang>(deviceLang());
  const [onboarded, setOnboarded] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [chat, setChat] = useState<ChatState>({ messages: [], typing: false });
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [bootTick, setBootTick] = useState(0);

  useEffect(() => {
    const off = api.onUser((u) => { setUser(u); if (u) setLangState(u.lang); });
    return () => { off(); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setBootError(false);
      const [savedLang, ob] = await Promise.all([getPref('bp.lang'), getPref('bp.onboarded')]);
      const l: Lang = savedLang === 'en' || savedLang === 'ar' ? savedLang : deviceLang();
      if (!alive) return;
      setLangState(l);
      setOnboarded(ob === '1');
      try {
        const u = await api.boot({ lang: l });
        if (!alive) return;
        setUser(u);
        setLangState(u.lang);
      } catch {
        if (alive) setBootError(true);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => { alive = false; };
  }, [bootTick]);

  const t = useCallback((k: StrKey) => tr(lang, k), [lang]);
  const L = useCallback((ar: string, en: string) => (lang === 'ar' ? ar : en), [lang]);

  const updateUser = useCallback(async (patch: Partial<UserDTO>) => {
    setUser((u) => (u ? { ...u, ...patch } : u)); // optimistic
    try {
      const u = await api.updateMe(patch);
      setUser(u);
    } catch {
      // keep optimistic local state; it re-syncs on next boot
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    void setPref('bp.lang', l);
    void updateUser({ lang: l });
  }, [updateUser]);

  const showToast = useCallback((x: Toast) => {
    clearTimeout(toastTimer.current);
    setToast(x);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const finishOnboarding = useCallback(() => { setOnboarded(true); void setPref('bp.onboarded', '1'); }, []);
  const restartOnboarding = useCallback(() => setOnboarded(false), []);
  const bump = useCallback(() => setDataVersion((v) => v + 1), []);

  const newChat = useCallback(() => setChat({ messages: [], typing: false, product: null }), []);

  const startProductChat = useCallback(async (p: Pick<ProductSummaryDTO, 'id' | 'name'>, ask?: string) => {
    setChat({ messages: [], typing: true, product: { id: p.id, name: p.name } });
    try {
      const r = await api.startChat([p.id], lang);
      setChat({ conversationId: r.conversationId, messages: r.messages, typing: !!ask, product: { id: p.id, name: p.name } });
      if (!ask) return;
      const now = new Date().toISOString();
      const mine: AssistantMessageDTO = { id: `local-${now}`, role: 'user', text: ask, facts: [], opinion: null, sources: [], recommendations: [], chips: [], mood: 'neutral', createdAt: now };
      setChat((c) => ({ ...c, messages: [...c.messages, mine] }));
      const a = await api.chat({ conversationId: r.conversationId, message: ask, lang });
      setChat((c) => ({ ...c, typing: false, messages: [...c.messages.filter((m) => m.id !== mine.id), ...a.messages] }));
    } catch {
      setChat((c) => ({ ...c, typing: false }));
    }
  }, [lang]);

  const sendChat = useCallback(async (text: string) => {
    const now = new Date().toISOString();
    const pending: AssistantMessageDTO = { id: `local-${now}`, role: 'user', text, facts: [], opinion: null, sources: [], recommendations: [], chips: [], mood: 'neutral', createdAt: now };
    const c0 = chatRef.current;
    const cid = c0.conversationId;
    const productIds = !c0.conversationId && c0.product ? [c0.product.id] : undefined;
    setChat((c) => ({ ...c, messages: [...c.messages, pending], typing: true }));
    try {
      const r = await api.chat({ conversationId: cid, message: text, productIds, lang });
      setChat((c) => ({ ...c, conversationId: r.conversationId, typing: false, messages: [...c.messages.filter((m) => m.id !== pending.id), ...r.messages] }));
      if (r.effects.length) setDataVersion((v) => v + 1);
    } catch (e) {
      const msg = e instanceof ApiError && e.code === 'assistant_daily_limit' ? tr(lang, 'limitReached') : tr(lang, 'offline');
      const err: AssistantMessageDTO = { ...pending, id: `err-${now}`, role: 'assistant', text: msg, mood: 'neutral' };
      setChat((c) => ({ ...c, typing: false, messages: [...c.messages, err] }));
    }
  }, [lang]);

  const value = useMemo<AppCtx>(() => ({
    ready, bootError, retryBoot: () => setBootTick((x) => x + 1), user, lang, rtl: lang === 'ar', t, L, onboarded, finishOnboarding, restartOnboarding,
    updateUser, setLang, toast, showToast, dataVersion, bump, chat, setChat, startProductChat, newChat, sendChat,
  }), [ready, bootError, user, lang, t, L, onboarded, finishOnboarding, restartOnboarding, updateUser, setLang, toast, showToast, dataVersion, bump, chat, startProductChat, newChat, sendChat]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}
