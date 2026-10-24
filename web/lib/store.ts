'use client';
// App state shared by all screens: conversations, loaded messages, typing, presence.
// Socket events and API results are merged here; the database stays the source of truth.
import { useSyncExternalStore } from 'react';
import type { ConversationSummary, Message } from './types';

export interface Thread {
  messages: Message[];
  nextCursor: string | null;
  loaded: boolean;
  /** Messages being sent (not yet confirmed by the server). */
  pending: (Message & { failed?: boolean })[];
}

interface State {
  conversations: Record<string, ConversationSummary & { left?: boolean }>;
  conversationsLoaded: boolean;
  threads: Record<string, Thread>;
  typing: Record<string, Record<string, number>>;
  presence: Record<string, { online: boolean; lastSeenAt: string | null }>;
  unreadNotifications: number;
  connected: boolean;
}

let state: State = {
  conversations: {},
  conversationsLoaded: false,
  threads: {},
  typing: {},
  presence: {},
  unreadNotifications: 0,
  connected: false,
};
const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(fn: (s: State) => Partial<State>) {
  state = { ...state, ...fn(state) };
  listeners.forEach((l) => l());
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
    () => select(state),
  );
}

export function resetStore() {
  setState(() => ({ conversations: {}, conversationsLoaded: false, threads: {}, typing: {}, presence: {}, unreadNotifications: 0 }));
}

// ----- conversations -----

export function putConversations(list: ConversationSummary[], replace = false) {
  setState((s) => {
    const conversations = replace ? {} : { ...s.conversations };
    for (const c of list) conversations[c.id] = c;
    const presence = { ...s.presence };
    for (const c of list)
      for (const m of c.members) {
        if (m.online !== undefined) presence[m.id] = { online: Boolean(m.online), lastSeenAt: m.lastSeenAt ?? null };
        // They hid their last seen since: forget what we knew.
        else delete presence[m.id];
      }
    return { conversations, conversationsLoaded: true, presence };
  });
}

export function removeConversation(id: string) {
  setState((s) => {
    const conversations = { ...s.conversations };
    delete conversations[id];
    return { conversations };
  });
}

export function patchConversation(id: string, patch: Partial<ConversationSummary>) {
  setState((s) => (s.conversations[id] ? { conversations: { ...s.conversations, [id]: { ...s.conversations[id], ...patch } } } : {}));
}

// ----- messages -----

const emptyThread = (): Thread => ({ messages: [], nextCursor: null, loaded: false, pending: [] });

function sortMessages(list: Message[]) {
  return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Messages removed with "Delete for me" in this tab, so a later update (reaction, edit) can't bring them back. */
const hiddenIds = new Set<string>();

/** "Clear chat": empties the thread and the chat list preview (for this user only). */
export function clearThread(conversationId: string) {
  setState((s) => {
    const conv = s.conversations[conversationId];
    return {
      threads: { ...s.threads, [conversationId]: { ...emptyThread(), loaded: true } },
      ...(conv ? { conversations: { ...s.conversations, [conversationId]: { ...conv, lastMessage: null, unread: 0 } } } : {}),
    };
  });
}

/** "Clear all chats". */
export function clearAllThreads() {
  setState((s) => ({
    threads: Object.fromEntries(Object.keys(s.threads).map((id) => [id, { ...emptyThread(), loaded: true }])),
    conversations: Object.fromEntries(Object.entries(s.conversations).map(([id, c]) => [id, { ...c, lastMessage: null, unread: 0 }])),
  }));
}

/** "Delete for me": takes a message out of the thread. */
export function hideMessage(conversationId: string, messageId: string) {
  hiddenIds.add(messageId);
  setState((s) => {
    const t = s.threads[conversationId];
    if (!t) return {};
    return { threads: { ...s.threads, [conversationId]: { ...t, messages: t.messages.filter((m) => m.id !== messageId) } } };
  });
}

/** Adds or replaces messages by id; drops matching pending copies (same clientId). */
export function upsertMessages(conversationId: string, incoming: Message[], page?: { nextCursor: string | null; older: boolean }) {
  setState((s) => {
    const t = s.threads[conversationId] ?? emptyThread();
    const byId = new Map(t.messages.map((m) => [m.id, m]));
    for (const m of incoming) if (!hiddenIds.has(m.id)) byId.set(m.id, m);
    const clientIds = new Set(incoming.map((m) => m.clientId).filter(Boolean));
    const thread: Thread = {
      messages: sortMessages([...byId.values()]),
      nextCursor: page ? (page.older || !t.loaded ? page.nextCursor : t.nextCursor) : t.nextCursor,
      loaded: page ? true : t.loaded,
      pending: t.pending.filter((p) => !clientIds.has(p.clientId)),
    };
    return { threads: { ...s.threads, [conversationId]: thread } };
  });
}

export function addPending(m: Message) {
  setState((s) => {
    const t = s.threads[m.conversationId] ?? emptyThread();
    return { threads: { ...s.threads, [m.conversationId]: { ...t, pending: [...t.pending.filter((p) => p.clientId !== m.clientId), m] } } };
  });
}

export function failPending(conversationId: string, clientId: string, failed: boolean) {
  setState((s) => {
    const t = s.threads[conversationId];
    if (!t) return {};
    return { threads: { ...s.threads, [conversationId]: { ...t, pending: t.pending.map((p) => (p.clientId === clientId ? { ...p, failed } : p)) } } };
  });
}

export function dropPending(conversationId: string, clientId: string) {
  setState((s) => {
    const t = s.threads[conversationId];
    if (!t) return {};
    return { threads: { ...s.threads, [conversationId]: { ...t, pending: t.pending.filter((p) => p.clientId !== clientId) } } };
  });
}

/** A new message arrived: put it in the thread and move the chat to the top. */
export function messageArrived(m: Message, myId: string, viewing: boolean) {
  if (state.threads[m.conversationId]?.loaded) upsertMessages(m.conversationId, [m]);
  const c = state.conversations[m.conversationId];
  if (c) {
    const mine = m.senderId === myId;
    patchConversation(m.conversationId, {
      lastMessage: m,
      updatedAt: m.createdAt,
      unread: mine || viewing ? (mine ? 0 : c.unread) : c.unread + (m.kind === 'SYSTEM' ? 0 : 1),
    });
  }
}

export function messageUpdated(m: Message) {
  if (state.threads[m.conversationId]?.messages.some((x) => x.id === m.id)) upsertMessages(m.conversationId, [m]);
  const c = state.conversations[m.conversationId];
  if (c?.lastMessage?.id === m.id) patchConversation(m.conversationId, { lastMessage: m });
}

export function setTyping(conversationId: string, userId: string, typing: boolean) {
  setState((s) => {
    const conv = { ...(s.typing[conversationId] ?? {}) };
    if (typing) conv[userId] = Date.now();
    else delete conv[userId];
    return { typing: { ...s.typing, [conversationId]: conv } };
  });
}

export function setPresence(userId: string, online: boolean, lastSeenAt: string | null) {
  setState((s) => ({ presence: { ...s.presence, [userId]: { online, lastSeenAt } } }));
}

export function setReceipt(conversationId: string, userId: string, r: { deliveredAt?: string; readAt?: string }) {
  const c = state.conversations[conversationId];
  if (!c) return;
  const old = c.receipts[userId] ?? { deliveredAt: null, readAt: null };
  patchConversation(conversationId, {
    receipts: {
      ...c.receipts,
      [userId]: {
        deliveredAt: r.deliveredAt && (!old.deliveredAt || r.deliveredAt > old.deliveredAt) ? r.deliveredAt : old.deliveredAt,
        readAt: r.readAt && (!old.readAt || r.readAt > old.readAt) ? r.readAt : old.readAt,
      },
    },
  });
}
