'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Eraser, Info, MoreVertical, Palette, Phone, Search, Video, X } from 'lucide-react';
import { api, ApiError, errorText } from '@/lib/api';
import { calls } from '@/lib/calls';
import { cx, dayLabel, lastSeen, newClientId } from '@/lib/format';
import { refreshConversation, setActiveConversation } from '@/lib/realtime';
import { useMe } from '@/lib/session';
import { emitAck, getSocket } from '@/lib/socket';
import { addPending, clearThread, failPending, getState, hideMessage, patchConversation, upsertMessages, useStore } from '@/lib/store';
import { bubbleColor, useChatTheme } from '@/lib/chatTheme';
import { messageAlert } from '@/lib/sounds';
import type { Message } from '@/lib/types';
import { Avatar, Empty, ErrorBox, IconButton, Modal, Skeleton, Spinner, useConfirm, useToast } from '../ui';
import { ChatThemePicker } from './ChatThemePicker';
import { Composer, type Outgoing } from './Composer';
import { InfoPanel } from './InfoPanel';
import { MessageBubble, type Tick } from './MessageBubble';
import { ReportDialog } from './ReportDialog';

const EMPTY: never[] = [];

export function ChatView({ id }: { id: string }) {
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const conv = useStore((s) => s.conversations[id]);
  const loadedList = useStore((s) => s.conversationsLoaded);
  const thread = useStore((s) => s.threads[id]);
  const typing = useStore((s) => s.typing[id]);
  const presence = useStore((s) => s.presence);
  // "last seen 3 min ago" has to move on by itself.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const connected = useStore((s) => s.connected);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [info, setInfo] = useState(false);
  const [report, setReport] = useState<Message | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const chatTheme = useChatTheme(id);
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<Message[] | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [groupCall, setGroupCall] = useState<{ id: string; type: 'AUDIO' | 'VIDEO' } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const topSentinel = useRef<HTMLDivElement>(null);
  const prevHeight = useRef<number | null>(null);

  const messages = thread?.messages ?? EMPTY;
  const pending = thread?.pending ?? EMPTY;

  // ----- loading -----
  const loadLatest = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get<{ messages: Message[]; nextCursor: string | null }>(`/conversations/${id}/messages?limit=40`);
      upsertMessages(id, r.messages, { nextCursor: r.nextCursor, older: false });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'This chat doesn’t exist or you’re not a member.' : errorText(e));
    }
  }, [id]);

  useEffect(() => {
    setActiveConversation(id);
    if (!getState().conversations[id]) void refreshConversation(id);
    void loadLatest();
    return () => setActiveConversation(null);
  }, [id, loadLatest]);

  useEffect(() => {
    if (!conv?.type || conv.type !== 'GROUP') return;
    api.get<{ id: string; type: 'AUDIO' | 'VIDEO' } | null>(`/calls/active/${id}`).then(setGroupCall, () => {});
  }, [id, conv?.type, conv?.lastMessage?.id]);

  const loadOlder = useCallback(async () => {
    const t = getState().threads[id];
    if (!t?.nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    prevHeight.current = scroller.current?.scrollHeight ?? null;
    try {
      const r = await api.get<{ messages: Message[]; nextCursor: string | null }>(`/conversations/${id}/messages?limit=40&before=${t.nextCursor}`);
      upsertMessages(id, r.messages, { nextCursor: r.nextCursor, older: true });
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setLoadingOlder(false);
    }
  }, [id, loadingOlder, toast]);

  // Infinite scroll upwards.
  useEffect(() => {
    const el = topSentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && void loadOlder(), { root: scroller.current, rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadOlder, thread?.loaded]);

  // Keep the view anchored: older pages keep position; new messages stick to the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending, atBottom]);

  // New message in the open chat, like WhatsApp / Telegram: a soft pop, and when you've scrolled up a
  // "N new messages" button instead of jumping.
  const [newCount, setNewCount] = useState(0);
  const lastId = useRef<string | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    const prev = lastId.current;
    lastId.current = last?.id ?? null;
    if (!last || !prev || prev === last.id) return;
    const idx = messages.findIndex((m) => m.id === prev);
    if (idx === -1) return; // cleared or reloaded, not new arrivals
    const fresh = messages.slice(idx + 1).filter((m) => m.senderId && m.senderId !== me.id && m.kind !== 'SYSTEM');
    if (!fresh.length) return;
    if (!conv?.muted && document.visibilityState === 'visible' && !['connecting', 'connected', 'reconnecting', 'outgoing'].includes(calls.getState().phase)) messageAlert('chat');
    if (!atBottom) setNewCount((n) => n + fresh.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
  useEffect(() => {
    if (atBottom) setNewCount(0);
  }, [atBottom]);

  // Read receipts for the newest message from someone else, while the tab is visible.
  const lastOther = useMemo(() => [...messages].reverse().find((m) => m.senderId && m.senderId !== me.id), [messages, me.id]);
  useEffect(() => {
    if (!lastOther || !conv) return;
    const send = () => {
      if (document.visibilityState !== 'visible') return;
      getSocket().emit('message:read', { conversationId: id, messageId: lastOther.id });
      if (getState().conversations[id]?.unread) patchConversation(id, { unread: 0 });
    };
    send();
    document.addEventListener('visibilitychange', send);
    return () => document.removeEventListener('visibilitychange', send);
  }, [lastOther, id, conv]);

  // ----- actions -----
  const send = useCallback(
    async (out: Outgoing, clientId = newClientId(), reply = replyTo) => {
      const temp: Message = {
        id: `pending-${clientId}`,
        conversationId: id,
        senderId: me.id,
        clientId,
        body: out.body ?? null,
        kind: 'TEXT',
        replyTo: reply ? { id: reply.id, body: reply.body, senderId: reply.senderId } : null,
        attachments: (out.attachments ?? []).map((a) => ({ id: a.key, kind: 'document', name: a.name, size: a.size, mime: a.mime, url: '#' })),
        reactions: [],
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
      };
      addPending(temp);
      setReplyTo(null);
      setAtBottom(true);
      try {
        const m = await emitAck<Message>('message:send', { conversationId: id, clientId, body: out.body, replyToId: reply?.id, attachments: out.attachments });
        upsertMessages(id, [m]);
      } catch (e) {
        failPending(id, clientId, true);
        toast(errorText(e), 'error');
      }
    },
    [id, me.id, replyTo, toast],
  );

  const retry = useCallback(
    (m: Message) => {
      failPending(id, m.clientId!, false);
      const reply = m.replyTo ? (getState().threads[id]?.messages.find((x) => x.id === m.replyTo!.id) ?? null) : null;
      void send({ body: m.body ?? undefined, attachments: m.attachments.map((a) => ({ key: a.id, name: a.name, size: a.size, mime: a.mime })) }, m.clientId!, reply);
    },
    [id, send],
  );

  const saveEdit = useCallback(
    async (m: Message, body: string) => {
      setEditing(null);
      try {
        upsertMessages(id, [await api.patch<Message>(`/messages/${m.id}`, { body })]);
      } catch (e) {
        toast(errorText(e), 'error');
      }
    },
    [id, toast],
  );

  async function clearChat() {
    if (!(await confirm({ title: 'Clear this chat?', text: 'Every message and file in this chat is deleted for good, for everyone in it. This can’t be undone.', confirm: 'Clear chat', danger: true }))) return;
    try {
      await api.post(`/conversations/${id}/clear`);
      clearThread(id);
      toast('Chat cleared', 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  // Delete = deleted for good: gone from the database and from everyone's chat.
  const hide = useCallback(
    async (m: Message) => {
      if (!(await confirm({ title: 'Delete this message?', text: 'It is deleted for everyone in this chat, with its files. This can’t be undone.', confirm: 'Delete', danger: true }))) return;
      try {
        await api.post(`/messages/${m.id}/hide`);
        hideMessage(id, m.id);
      } catch (e) {
        toast(errorText(e), 'error');
      }
    },
    [id, toast, confirm],
  );

  const del = useCallback(
    async (m: Message) => {
      if (!(await confirm({ title: 'Delete for everyone?', text: 'The message and its files will be removed for all members.', confirm: 'Delete', danger: true }))) return;
      try {
        await api.delete(`/messages/${m.id}`);
        hideMessage(id, m.id);
      } catch (e) {
        toast(errorText(e), 'error');
      }
    },
    [id, toast, confirm],
  );

  const react = useCallback(
    async (m: Message, emoji: string | null) => {
      try {
        upsertMessages(id, [emoji ? await api.post<Message>(`/messages/${m.id}/reactions`, { emoji }) : await api.delete<Message>(`/messages/${m.id}/reactions`)]);
      } catch (e) {
        toast(errorText(e), 'error');
      }
    },
    [id, toast],
  );

  const jump = useCallback((mid: string) => {
    const el = document.getElementById(`m-${mid}`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlight(mid);
      setTimeout(() => setHighlight(null), 1500);
    }
  }, []);

  useEffect(() => {
    if (!searchOpen || searchQ.trim().length < 2) return setSearchHits(null);
    const t = setTimeout(() => {
      api.get<Message[]>(`/messages/search?q=${encodeURIComponent(searchQ.trim())}&conversationId=${id}`).then(setSearchHits, () => setSearchHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ, searchOpen, id]);

  async function startCall(type: 'AUDIO' | 'VIDEO') {
    if (!conv) return;
    try {
      if (groupCall) await calls.joinGroup(groupCall.id, id, groupCall.type, conv.name);
      else await calls.start(id, type, conv.name, conv.type === 'DIRECT' ? (conv.members.find((m) => m.id !== me.id) ?? null) : null, conv.type === 'GROUP');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  // ----- render -----
  if (error) return <ErrorBox text={error} retry={() => void loadLatest()} />;
  if (!conv && loadedList && thread?.loaded === false) return <Empty title="Chat not found" />;

  const other = conv?.type === 'DIRECT' ? conv.members.find((m) => m.id !== me.id) : undefined;
  const nameOf = (uid: string | null) => (uid === me.id ? 'You' : (conv?.members.find((m) => m.id === uid)?.displayName ?? 'Former member'));
  const typers = Object.keys(typing ?? {}).filter((u) => u !== me.id);
  const pres = other ? presence[other.id] : undefined;
  const status = typers.length
    ? conv?.type === 'GROUP'
      ? `${nameOf(typers[0]).split(' ')[0]} is typing…`
      : 'typing…'
    : conv?.type === 'GROUP'
      ? `${conv.members.length} members`
      : lastSeen(pres?.online ?? other?.online, pres?.lastSeenAt ?? other?.lastSeenAt);

  const tickFor = (m: Message & { failed?: boolean }): Tick | undefined => {
    if (m.senderId !== me.id) return undefined;
    if (m.id.startsWith('pending-')) return m.failed ? 'failed' : 'pending';
    const others = Object.entries(conv?.receipts ?? {}).filter(([uid]) => uid !== me.id);
    if (!others.length) return 'sent';
    if (others.every(([, r]) => r.readAt && r.readAt >= m.createdAt)) return 'read';
    if (others.every(([, r]) => r.deliveredAt && r.deliveredAt >= m.createdAt)) return 'delivered';
    return 'sent';
  };

  const all = [...messages, ...pending];
  const isAdmin = conv?.type === 'GROUP' && conv.myRole !== 'MEMBER';
  const blockedNote = conv?.left ? 'You are no longer a member of this group.' : !me.emailVerified ? 'Verify your e-mail to send messages.' : null;

  return (
    <div className="flex h-full">
      <div className="relative flex h-full min-w-0 flex-1 flex-col">
        <header className="safe-t relative z-20 flex items-center gap-1 ios-bar border-b border-line/60 px-1 py-2 sm:gap-2 sm:px-4">
          <IconButton label="Back to chats" className="md:hidden" onClick={() => router.push('/chats')}>
            <ArrowLeft className="size-5" />
          </IconButton>
          {conv ? (
            <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => setInfo(true)} aria-label="Chat info">
              <span className="shrink-0">
                <Avatar name={conv.name} url={conv.avatarUrl} size={38} online={pres?.online} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{conv.name}</span>
                <span className={cx('block truncate text-xs', typers.length ? 'text-accent' : 'text-muted')}>{connected ? status : 'Connecting…'}</span>
              </span>
            </button>
          ) : (
            <div className="flex flex-1 items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
          )}
          {conv && !conv.left && (
            <>
              <IconButton label={groupCall ? 'Join voice call' : 'Voice call'} onClick={() => startCall('AUDIO')}>
                <Phone className="size-5" />
              </IconButton>
              <IconButton label={groupCall ? 'Join video call' : 'Video call'} onClick={() => startCall('VIDEO')}>
                <Video className="size-5" />
              </IconButton>
            </>
          )}
          {conv && (
            <div className="relative">
              <IconButton label="More" onClick={() => setMoreOpen((v) => !v)} active={moreOpen}>
                <MoreVertical className="size-5" />
              </IconButton>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} aria-hidden />
                  <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-line bg-panel p-1 shadow-2xl">
                    {[
                      { label: 'Chat info', icon: Info, run: () => setInfo(true) },
                      { label: 'Search', icon: Search, run: () => setSearchOpen(true) },
                      { label: 'Chat theme', icon: Palette, run: () => setThemeOpen(true) },
                      { label: 'Clear chat', icon: Eraser, run: () => void clearChat(), danger: true },
                    ].map((x) => (
                      <button
                        key={x.label}
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false);
                          x.run();
                        }}
                        className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-hover', x.danger && 'text-danger')}
                      >
                        <x.icon className="size-4" />
                        {x.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </header>
        {groupCall && (
          <button onClick={() => startCall(groupCall.type)} className="bg-ok/15 px-4 py-2 text-sm font-medium text-ok">
            A group {groupCall.type === 'VIDEO' ? 'video' : 'voice'} call is running — tap to join
          </button>
        )}
        {searchOpen && (
          <div className="border-b border-line bg-panel px-4 py-2">
            <div className="flex items-center gap-2">
              <input autoFocus value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search messages in this chat" aria-label="Search messages" className="h-9 flex-1 rounded-lg bg-panel-2 px-3 text-sm outline-none" />
              <IconButton label="Close search" onClick={() => { setSearchOpen(false); setSearchQ(''); }}>
                <X className="size-4" />
              </IconButton>
            </div>
            {searchHits && (
              <ul className="mt-2 max-h-48 overflow-y-auto text-sm">
                {searchHits.length === 0 && <li className="py-2 text-muted">No messages found</li>}
                {searchHits.map((h) => (
                  <li key={h.id}>
                    <button className="w-full truncate rounded-lg px-2 py-1.5 text-left hover:bg-hover" onClick={() => jump(h.id)}>
                      <span className="text-muted">{nameOf(h.senderId)}: </span>
                      {h.body}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div
          ref={scroller}
          className={cx('scroll-thin relative min-h-0 flex-1 overflow-y-auto py-3', `wp-${chatTheme.wallpaper}`)}
          style={{ '--bubble-me': bubbleColor(chatTheme.bubble) } as React.CSSProperties}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
          }}
          role="log"
          aria-live="polite"
          aria-label="Messages"
        >
          <div ref={topSentinel} />
          {loadingOlder && <div className="flex justify-center py-2"><Spinner /></div>}
          {!thread?.loaded && (
            <div className="space-y-3 px-6">
              {[40, 64, 52, 30, 70].map((w, i) => (
                <div key={i} className={cx('flex', i % 2 ? 'justify-end' : '')}>
                  <div style={{ width: `${w}%` }}>
                    <Skeleton className="h-10 rounded-2xl" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {thread?.loaded && !thread.nextCursor && all.length === 0 && (
            <Empty title="No messages yet" text={other ? `Say hi to ${other.displayName.split(' ')[0]} 👋` : 'Start the conversation.'} />
          )}
          {all.map((m, i) => {
            const prev = all[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const mine = m.senderId === me.id;
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-panel px-3 py-1 text-xs text-muted shadow">{dayLabel(m.createdAt)}</span>
                  </div>
                )}
                <MessageBubble
                  m={m}
                  mine={mine}
                  myId={me.id}
                  senderName={nameOf(m.senderId)}
                  showSender={conv?.type === 'GROUP' && (!prev || prev.senderId !== m.senderId || newDay || prev.kind !== 'TEXT')}
                  tick={tickFor(m)}
                  replyName={m.replyTo ? nameOf(m.replyTo.senderId) : undefined}
                  canDelete={mine || isAdmin}
                  highlight={highlight === m.id}
                  onReply={setReplyTo}
                  onEdit={setEditing}
                  onDelete={del}
                  onHide={hide}
                  onReact={react}
                  onReport={setReport}
                  onRetry={retry}
                  onJump={jump}
                />
              </div>
            );
          })}
        </div>
        {!atBottom && (
          <button
            aria-label={newCount ? `${newCount} new ${newCount === 1 ? 'message' : 'messages'}, scroll to newest` : 'Scroll to newest'}
            onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })}
            className={cx(
              'absolute bottom-24 right-4 z-10 flex h-10 items-center justify-center gap-1.5 rounded-full border border-line bg-panel shadow-lg',
              newCount ? 'px-3.5 text-sm font-semibold text-accent' : 'w-10',
            )}
          >
            {newCount > 0 && <span>{newCount > 99 ? '99+' : newCount} new</span>}
            <ArrowDown className="size-5" />
          </button>
        )}
        <Composer
          conversationId={id}
          disabled={blockedNote}
          replyTo={replyTo}
          replyName={replyTo ? nameOf(replyTo.senderId) : undefined}
          editing={editing}
          onCancel={() => {
            setReplyTo(null);
            setEditing(null);
          }}
          onSend={(o) => void send(o)}
          onSaveEdit={saveEdit}
        />
      </div>
      {info && conv && <InfoPanel conv={conv} onClose={() => setInfo(false)} onReportUser={() => setReport({ id: '', senderId: other?.id ?? null } as Message)} />}
      <ReportDialog target={report} conversationId={id} onClose={() => setReport(null)} />
      <Modal open={themeOpen} onClose={() => setThemeOpen(false)} title="Chat theme">
        <ChatThemePicker conversationId={id} />
      </Modal>
    </div>
  );
}
