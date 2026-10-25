'use client';
// Wires socket events into the store. Called once after login.
import { api } from './api';
import { calls } from './calls';
import { getSocket } from './socket';
import { clearThreadBefore, getState, hideMessage, messageArrived, messageUpdated, putConversations, removeConversation, setPresence, setReceipt, setState, setTyping, upsertMessages } from './store';
import type { AppNotification, ConversationSummary } from './types';

let bound = false;
let activeConversation: string | null = null;
export const setActiveConversation = (id: string | null) => {
  activeConversation = id;
};
export const getActiveConversation = () => activeConversation;

type Notify = (n: AppNotification) => void;
let onNotification: Notify = () => {};
let onMessageToast: (conversationId: string, title: string, body: string) => void = () => {};
export function setNotificationHandlers(n: Notify, m: typeof onMessageToast) {
  onNotification = n;
  onMessageToast = m;
}

export async function refreshConversation(id: string) {
  try {
    putConversations([await api.get<ConversationSummary>(`/conversations/${id}`)]);
  } catch {
    removeConversation(id);
  }
}

export async function loadConversations() {
  putConversations(await api.get<ConversationSummary[]>('/conversations'), true);
}

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function bindRealtime(myId: string) {
  calls.bind(myId);
  if (bound) return;
  bound = true;
  const s = getSocket();
  s.on('connect', () => {
    setState(() => ({ connected: true }));
    // Catch up on anything missed while offline: conversation list + open thread.
    void loadConversations().catch(() => {});
    const open = activeConversation;
    if (open && getState().threads[open]?.loaded) {
      api.get<{ messages: import('./types').Message[] }>(`/conversations/${open}/messages?limit=50`).then((r) => upsertMessages(open, r.messages), () => {});
    }
  });
  s.on('disconnect', () => setState(() => ({ connected: false })));
  s.on('message:new', (m) => {
    const viewing = activeConversation === m.conversationId && document.visibilityState === 'visible';
    if (!getState().conversations[m.conversationId]) void refreshConversation(m.conversationId);
    messageArrived(m, myId, viewing);
    if (m.senderId !== myId) {
      s.emit(viewing ? 'message:read' : 'message:delivered', { conversationId: m.conversationId, messageId: m.id });
      const c = getState().conversations[m.conversationId];
      if (!viewing && !c?.muted && m.kind === 'TEXT') {
        const from = c?.members.find((x) => x.id === m.senderId)?.displayName ?? 'New message';
        onMessageToast(m.conversationId, c?.type === 'GROUP' ? `${from} · ${c.name}` : from, m.body ?? (m.attachments.length ? '📎 Attachment' : ''));
      }
    }
    setTyping(m.conversationId, m.senderId ?? '', false);
  });
  s.on('message:updated', messageUpdated);
  // Deleted for good by someone in the chat: drop it here too.
  s.on('message:removed', ({ conversationId, messageIds }) => {
    messageIds.forEach((mid) => hideMessage(conversationId, mid));
    void refreshConversation(conversationId);
  });
  s.on('chat:cleared', ({ conversationId, before }) => {
    clearThreadBefore(conversationId, before);
    void refreshConversation(conversationId);
  });
  s.on('receipt', (r) => setReceipt(r.conversationId, r.userId, r));
  s.on('typing', ({ conversationId, userId, typing }) => {
    setTyping(conversationId, userId, typing);
    const key = `${conversationId}:${userId}`;
    clearTimeout(typingTimers.get(key));
    if (typing) typingTimers.set(key, setTimeout(() => setTyping(conversationId, userId, false), 6000));
  });
  s.on('presence', ({ userId, online, lastSeenAt }) => setPresence(userId, online, lastSeenAt));
  s.on('conversation:updated', ({ conversationId }) => void refreshConversation(conversationId));
  s.on('conversation:removed', ({ conversationId }) => removeConversation(conversationId));
  s.on('notification', (n) => {
    setState((st) => ({ unreadNotifications: st.unreadNotifications + 1 }));
    onNotification(n);
  });
  s.on('session:revoked', () => window.dispatchEvent(new Event('bc:unauthorized')));
}
