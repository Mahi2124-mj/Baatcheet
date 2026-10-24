'use client';
// Chat look: the colour of your own bubbles and the chat background. One default for all chats plus an
// optional choice per chat, kept on this device (like a phone's wallpaper).
import { useSyncExternalStore } from 'react';

export const BUBBLES = [
  { id: 'blue', name: 'Blue', color: '#007aff' },
  { id: 'green', name: 'Green', color: '#1f9d55' },
  { id: 'purple', name: 'Purple', color: '#8e44c9' },
  { id: 'pink', name: 'Pink', color: '#e0306a' },
  { id: 'orange', name: 'Orange', color: '#d9610b' },
  { id: 'teal', name: 'Teal', color: '#0e8fa6' },
  { id: 'indigo', name: 'Indigo', color: '#5856d6' },
  { id: 'graphite', name: 'Graphite', color: '#48484a' },
] as const;

// Each wallpaper is a CSS class in globals.css with a light and a dark version.
export const WALLPAPERS = [
  { id: 'plain', name: 'Plain' },
  { id: 'soft', name: 'Soft' },
  { id: 'doodle', name: 'Doodle' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'night', name: 'Night' },
] as const;

export type BubbleId = (typeof BUBBLES)[number]['id'];
export type WallpaperId = (typeof WALLPAPERS)[number]['id'];
export interface ChatTheme {
  bubble: BubbleId;
  wallpaper: WallpaperId;
}

const DEFAULT: ChatTheme = { bubble: 'blue', wallpaper: 'plain' };
const KEY = 'bc-chat-theme';
type Saved = { default?: Partial<ChatTheme>; chats?: Record<string, Partial<ChatTheme>> };

const listeners = new Set<() => void>();
let cache: { raw: string | null; saved: Saved } = { raw: null, saved: {} };

function read(): Saved {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: defaults.
  }
  if (raw !== cache.raw) {
    try {
      cache = { raw, saved: raw ? (JSON.parse(raw) as Saved) : {} };
    } catch {
      cache = { raw, saved: {} };
    }
  }
  return cache.saved;
}

function write(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: lasts until reload.
    cache = { raw: JSON.stringify(s), saved: s };
  }
  listeners.forEach((l) => l());
}

const valid = (t: Partial<ChatTheme> | undefined): Partial<ChatTheme> => ({
  ...(t?.bubble && BUBBLES.some((b) => b.id === t.bubble) ? { bubble: t.bubble } : {}),
  ...(t?.wallpaper && WALLPAPERS.some((w) => w.id === t.wallpaper) ? { wallpaper: t.wallpaper } : {}),
});

/** The theme for a chat: its own choice, else the default for all chats. */
export function themeFor(conversationId?: string): ChatTheme {
  const s = read();
  return { ...DEFAULT, ...valid(s.default), ...(conversationId ? valid(s.chats?.[conversationId]) : {}) };
}

export function hasOwnTheme(conversationId: string) {
  return Boolean(read().chats?.[conversationId]);
}

/** Saves the default (no id) or one chat's theme; `null` for a chat goes back to the default. */
export function setTheme(conversationId: string | null, t: Partial<ChatTheme> | null) {
  const s = read();
  if (!conversationId) return write({ ...s, default: { ...valid(s.default), ...valid(t ?? {}) } });
  const chats = { ...(s.chats ?? {}) };
  if (t === null) delete chats[conversationId];
  else chats[conversationId] = { ...valid(chats[conversationId]), ...valid(t) };
  write({ ...s, chats });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === KEY && l();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
};

/** Live theme for a chat (updates when changed in Settings or another tab). */
export function useChatTheme(conversationId?: string): ChatTheme {
  const key = useSyncExternalStore(subscribe, () => JSON.stringify(themeFor(conversationId)), () => JSON.stringify(DEFAULT));
  return JSON.parse(key) as ChatTheme;
}

export const bubbleColor = (id: BubbleId) => BUBBLES.find((b) => b.id === id)?.color ?? BUBBLES[0].color;
