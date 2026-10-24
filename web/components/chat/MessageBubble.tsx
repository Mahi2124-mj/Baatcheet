'use client';
import { memo, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCheck, Clock, Copy, EyeOff, FileText, Flag, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { bytes, clock, cx } from '@/lib/format';
import type { Message } from '@/lib/types';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export type Tick = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';

function Ticks({ tick }: { tick: Tick }) {
  if (tick === 'pending') return <Clock className="size-3.5" aria-label="Sending" />;
  if (tick === 'failed') return <AlertCircle className="size-3.5 text-danger" aria-label="Not sent" />;
  if (tick === 'sent') return <Check className="size-3.5" aria-label="Sent" />;
  return <CheckCheck className={cx('size-3.5', tick === 'read' && 'text-sky-400')} aria-label={tick === 'read' ? 'Read' : 'Delivered'} />;
}

function Attachments({ m }: { m: Message }) {
  return (
    <div className="space-y-1.5">
      {m.attachments.map((a) =>
        a.kind === 'image' ? (
          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.name} loading="lazy" className="max-h-80 w-full max-w-xs object-cover" />
          </a>
        ) : a.kind === 'video' ? (
          <video key={a.id} src={a.url} controls preload="metadata" playsInline className="max-h-80 w-full max-w-xs rounded-xl bg-black" />
        ) : a.kind === 'audio' ? (
          <audio key={a.id} src={a.url} controls preload="metadata" className="w-64 max-w-full" />
        ) : (
          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-xl bg-black/15 p-3 hover:bg-black/25">
            <FileText className="size-8 shrink-0 text-accent" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{a.name}</span>
              <span className="block text-xs opacity-70">{bytes(a.size)}</span>
            </span>
          </a>
        ),
      )}
    </div>
  );
}

/**
 * Long-press on touch screens (phones have no right-click / hover): opens the message menu after 450 ms
 * unless the finger moved (scrolling).
 */
function useLongPress(open: () => void) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    if (t.current) clearTimeout(t.current);
    t.current = null;
    start.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      t.current = setTimeout(() => {
        t.current = null;
        navigator.vibrate?.(15);
        open();
      }, 450);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}

/** Swipe a message to the right to reply (touch screens), like WhatsApp. Vertical scrolling is untouched. */
function useSwipeReply(onReply: () => void, enabled: boolean) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; dir?: 'h' | 'v' } | null>(null);
  const last = useRef(0);
  const TRIGGER = 56;
  const move = (v: number) => {
    // Buzz once when the swipe passes the point where letting go replies.
    if (last.current < TRIGGER && v >= TRIGGER) navigator.vibrate?.(10);
    last.current = v;
    setDx(v);
  };
  return {
    dx,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        if (!enabled || e.touches.length !== 1) return;
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      },
      onTouchMove: (e: React.TouchEvent) => {
        const s = start.current;
        if (!s) return;
        const ddx = e.touches[0].clientX - s.x;
        const ddy = e.touches[0].clientY - s.y;
        if (!s.dir) {
          if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
          s.dir = Math.abs(ddx) > Math.abs(ddy) * 1.2 && ddx > 0 ? 'h' : 'v';
        }
        if (s.dir === 'h') move(Math.min(84, Math.max(0, ddx * 0.6)));
      },
      onTouchEnd: () => {
        const s = start.current;
        start.current = null;
        if (s?.dir === 'h' && last.current >= TRIGGER) onReply();
        move(0);
      },
      onTouchCancel: () => {
        start.current = null;
        move(0);
      },
    },
  };
}

interface Props {
  m: Message & { failed?: boolean };
  mine: boolean;
  senderName?: string;
  showSender: boolean;
  tick?: Tick;
  replyName?: string;
  myId: string;
  canDelete: boolean;
  highlight?: boolean;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  /** "Delete for me": hide it from this user's chat only. */
  onHide: (m: Message) => void;
  onReact: (m: Message, emoji: string | null) => void;
  onReport: (m: Message) => void;
  onRetry?: (m: Message) => void;
  onJump: (id: string) => void;
}

function MessageBubbleImpl({ m, mine, senderName, showSender, tick, replyName, myId, canDelete, highlight, onReply, onEdit, onDelete, onHide, onReact, onReport, onRetry, onJump }: Props) {
  const [menu, setMenu] = useState(false);
  const press = useLongPress(() => setMenu(true));
  const swipe = useSwipeReply(() => onReply(m), m.kind !== 'SYSTEM' && m.kind !== 'CALL' && !m.deletedAt && !(tick === 'pending' || tick === 'failed'));
  const deleted = Boolean(m.deletedAt);
  const myReaction = m.reactions.find((r) => r.userIds.includes(myId))?.emoji ?? null;

  if (m.kind === 'SYSTEM' || m.kind === 'CALL') {
    // Call / system lines: long-press (or right-click) → "Delete for me".
    return (
      <div id={`m-${m.id}`} className="relative my-2 flex justify-center">
        <span
          {...press}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(true);
          }}
          className="select-none rounded-full bg-panel-2 px-3 py-1 text-xs text-muted"
          style={{ WebkitTouchCallout: 'none' }}
        >
          {m.body} · {clock(m.createdAt)}
        </span>
        {menu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} aria-hidden />
            <div role="menu" className="absolute top-full z-40 mt-1 w-48 rounded-xl border border-line bg-panel p-1 shadow-2xl">
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onHide(m);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-hover"
              >
                <Trash2 className="size-4" />
                Delete for me
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  const pending = tick === 'pending' || tick === 'failed';
  return (
    <div id={`m-${m.id}`} className={cx('group relative flex px-3 py-0.5 sm:px-6', mine ? 'justify-end' : 'justify-start')} style={{ touchAction: 'pan-y' }} {...swipe.handlers}>
      {swipe.dx > 0 && (
        <span className="absolute left-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-panel-2 text-muted" style={{ opacity: Math.min(1, swipe.dx / 56) }} aria-hidden>
          <Reply className="size-4" />
        </span>
      )}
      <div
        className={cx('relative max-w-[85%] sm:max-w-[70%]', highlight && 'animate-pulse')}
        style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined, transition: swipe.dx ? 'none' : 'transform 0.2s ease-out' }}
      >
        <div
          className={cx('rounded-[20px] px-3.5 py-2 text-[17px] leading-snug', mine ? 'rounded-br-[6px] bg-bubble-me text-bubble-me-ink' : 'rounded-bl-[6px] bg-bubble-them text-bubble-them-ink', deleted && 'italic opacity-70')}
          {...(pending ? {} : press)}
          onContextMenu={(e) => {
            if (pending) return;
            e.preventDefault();
            setMenu(true);
          }}
          style={{ WebkitTouchCallout: 'none' }}
        >
          {showSender && !mine && senderName && <p className="mb-0.5 text-xs font-semibold text-accent">{senderName}</p>}
          {m.replyTo && !deleted && (
            <button onClick={() => onJump(m.replyTo!.id)} className={cx('mb-1.5 block w-full rounded-lg border-l-4 px-2 py-1 text-left text-xs', mine ? 'border-white/70 bg-white/20' : 'border-accent bg-hover/70')}>
              <span className={cx('block font-semibold', mine ? 'text-white' : 'text-accent')}>{replyName ?? 'Message'}</span>
              <span className="line-clamp-2 opacity-80">{m.replyTo.body ?? 'Deleted message'}</span>
            </button>
          )}
          {deleted ? (
            <span>This message was deleted</span>
          ) : (
            <>
              {m.attachments.length > 0 && <Attachments m={m} />}
              {m.body && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body}</p>}
            </>
          )}
          <span className={cx('mt-0.5 flex items-center justify-end gap-1 text-[11px]', mine ? 'text-white/75' : 'text-muted')}>
            {m.editedAt && !deleted && <span>edited</span>}
            <time dateTime={m.createdAt}>{clock(m.createdAt)}</time>
            {mine && tick && <Ticks tick={tick} />}
          </span>
        </div>
        {m.reactions.length > 0 && (
          <div className={cx('-mt-2 flex gap-1', mine ? 'justify-end pr-2' : 'pl-2')}>
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact(m, r.userIds.includes(myId) ? null : r.emoji)}
                className={cx('rounded-full border border-line bg-panel px-1.5 text-xs', r.userIds.includes(myId) && 'border-accent')}
                aria-label={`${r.emoji} ${r.userIds.length}`}
              >
                {r.emoji} {r.userIds.length > 1 ? r.userIds.length : ''}
              </button>
            ))}
          </div>
        )}
        {tick === 'failed' && onRetry && (
          <button onClick={() => onRetry(m)} className="mt-1 block text-right text-xs text-danger">
            Not sent — tap to retry
          </button>
        )}
        {!deleted && !pending && (
          <button
            aria-label="Message options"
            onClick={() => setMenu((v) => !v)}
            className={cx('absolute top-1 hidden size-7 items-center justify-center rounded-full bg-panel text-muted shadow group-hover:flex focus:flex', mine ? '-left-8' : '-right-8')}
          >
            <SmilePlus className="size-4" />
          </button>
        )}
        {menu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} aria-hidden />
            <div role="menu" className={cx('absolute z-40 mt-1 w-52 rounded-xl border border-line bg-panel p-1 shadow-2xl', mine ? 'right-0' : 'left-0')}>
              {!deleted && <div className="flex justify-between px-1 py-1">
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    role="menuitem"
                    aria-label={`React ${e}`}
                    onClick={() => {
                      onReact(m, myReaction === e ? null : e);
                      setMenu(false);
                    }}
                    className={cx('rounded-lg p-1 text-lg hover:bg-hover', myReaction === e && 'bg-accent-soft')}
                  >
                    {e}
                  </button>
                ))}
              </div>}
              {[
                { label: 'Reply', icon: Reply, run: () => onReply(m), show: !deleted },
                { label: 'Copy', icon: Copy, run: () => void navigator.clipboard?.writeText(m.body ?? ''), show: !deleted && Boolean(m.body) },
                { label: 'Edit', icon: Pencil, run: () => onEdit(m), show: !deleted && mine && Boolean(m.body) && Date.now() - new Date(m.createdAt).getTime() < 48 * 3600_000 },
                { label: 'Delete for me', icon: EyeOff, run: () => onHide(m), show: true },
                { label: 'Delete for everyone', icon: Trash2, run: () => onDelete(m), show: !deleted && canDelete },
                { label: 'Report', icon: Flag, run: () => onReport(m), show: !deleted && !mine },
              ]
                .filter((x) => x.show)
                .map((x) => (
                  <button
                    key={x.label}
                    role="menuitem"
                    onClick={() => {
                      x.run();
                      setMenu(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover"
                  >
                    <x.icon className="size-4 text-muted" />
                    {x.label}
                  </button>
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);
