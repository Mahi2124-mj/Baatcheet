'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Archive, BellOff, MessageSquarePlus, Pin, Search, Users } from 'lucide-react';
import { cx, timeShort } from '@/lib/format';
import { useMe } from '@/lib/session';
import { useStore } from '@/lib/store';
import type { ConversationSummary } from '@/lib/types';
import { Avatar, Empty, IconButton, Skeleton } from '../ui';
import { NewChatDialog } from './NewChatDialog';

type Filter = 'all' | 'unread' | 'groups' | 'archived';

export function preview(c: ConversationSummary, myId: string) {
  const m = c.lastMessage;
  if (!m) return c.type === 'GROUP' ? 'Group created' : 'Say hi 👋';
  if (m.deletedAt) return 'This message was deleted';
  const who = m.kind === 'TEXT' && c.type === 'GROUP' ? (m.senderId === myId ? 'You: ' : `${c.members.find((x) => x.id === m.senderId)?.displayName.split(' ')[0] ?? 'Someone'}: `) : m.senderId === myId && m.kind === 'TEXT' ? 'You: ' : '';
  const body = m.body ?? (m.attachments[0] ? `📎 ${m.attachments[0].kind === 'image' ? 'Photo' : m.attachments[0].kind === 'video' ? 'Video' : m.attachments[0].kind === 'audio' ? 'Voice message' : m.attachments[0].name}` : '');
  return who + body;
}

export function ConversationList() {
  const me = useMe();
  const path = usePathname();
  const loaded = useStore((s) => s.conversationsLoaded);
  const all = useStore((s) => s.conversations);
  const typing = useStore((s) => s.typing);
  const presence = useStore((s) => s.presence);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [dialog, setDialog] = useState<'chat' | 'group' | null>(null);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.values(all)
      .filter((c) => (filter === 'archived' ? c.archived : !c.archived))
      .filter((c) => (filter === 'unread' ? c.unread > 0 : filter === 'groups' ? c.type === 'GROUP' : true))
      .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.members.some((m) => m.username.includes(needle)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }, [all, q, filter]);
  const archivedCount = useMemo(() => Object.values(all).filter((c) => c.archived).length, [all]);

  return (
    <div className="flex h-full flex-col">
      <div className="safe-t flex items-center justify-between px-4 pb-2 pt-4">
        <h1 className="text-xl font-bold">Chats</h1>
        <div className="flex">
          <IconButton label="New group" onClick={() => setDialog('group')}>
            <Users className="size-5" />
          </IconButton>
          <IconButton label="New chat" onClick={() => setDialog('chat')}>
            <MessageSquarePlus className="size-5" />
          </IconButton>
        </div>
      </div>
      <div className="px-4">
        <label className="flex h-10 items-center gap-2 rounded-xl bg-panel-2 px-3">
          <Search className="size-4 text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" className="w-full bg-transparent text-sm outline-none placeholder:text-muted" />
        </label>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Filter chats">
          {(['all', 'unread', 'groups', 'archived'] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cx('shrink-0 rounded-full px-3 py-1 text-xs font-medium capitalize', filter === f ? 'bg-accent-soft text-accent' : 'bg-panel-2 text-muted hover:text-text')}
            >
              {f}
              {f === 'archived' && archivedCount ? ` (${archivedCount})` : ''}
            </button>
          ))}
        </div>
      </div>
      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Conversations">
        {!loaded &&
          Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 p-2">
              <Skeleton className="size-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </li>
          ))}
        {loaded && list.length === 0 && (
          <Empty
            icon={<MessageSquarePlus className="size-6" />}
            title={q ? 'No chats found' : filter === 'all' ? 'No chats yet' : `No ${filter} chats`}
            text={filter === 'all' && !q ? 'Find people by username and start talking.' : undefined}
            action={
              filter === 'all' && !q ? (
                <button onClick={() => setDialog('chat')} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
                  Start a chat
                </button>
              ) : undefined
            }
          />
        )}
        {list.map((c) => {
          const other = c.type === 'DIRECT' ? c.members.find((m) => m.id !== me.id) : undefined;
          const typers = Object.keys(typing[c.id] ?? {}).filter((u) => u !== me.id);
          const activeRow = path === `/chats/${c.id}`;
          return (
            <li key={c.id}>
              <Link
                href={`/chats/${c.id}`}
                aria-current={activeRow ? 'page' : undefined}
                className={cx('flex items-center gap-3 rounded-xl p-2.5', activeRow ? 'bg-hover' : 'hover:bg-panel-2')}
              >
                <Avatar name={c.name} url={c.avatarUrl} size={48} online={other ? presence[other.id]?.online : false} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    <span className={cx('shrink-0 text-xs', c.unread ? 'text-accent' : 'text-muted')}>{c.lastMessage ? timeShort(c.lastMessage.createdAt) : ''}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className={cx('truncate text-sm', typers.length ? 'text-accent' : 'text-muted')}>
                      {typers.length ? (c.type === 'GROUP' ? `${c.members.find((m) => m.id === typers[0])?.displayName.split(' ')[0]} is typing…` : 'typing…') : c.left ? 'You are no longer a member' : preview(c, me.id)}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-muted">
                      {c.muted && <BellOff className="size-3.5" aria-label="Muted" />}
                      {c.pinned && <Pin className="size-3.5" aria-label="Pinned" />}
                      {c.archived && <Archive className="size-3.5" aria-label="Archived" />}
                      {c.unread > 0 && (
                        <span className={cx('min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5', c.muted ? 'bg-hover text-text' : 'bg-accent text-accent-ink')} aria-label={`${c.unread} unread`}>
                          {c.unread}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <NewChatDialog mode={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
