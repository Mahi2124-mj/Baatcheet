'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Search, UserPlus, Users } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { putConversations } from '@/lib/store';
import type { ConversationSummary, PublicUser } from '@/lib/types';
import { lastSeen } from '@/lib/format';
import { Avatar, Button, Empty, ErrorBox, IconButton, Skeleton, Spinner, useToast } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { useUserSearch } from '@/components/chat/NewChatDialog';

interface Req {
  id: string;
  user: PublicUser;
  createdAt: string;
}

export default function ContactsPage() {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<{ contacts: (PublicUser & { nickname: string | null })[]; incoming: Req[]; outgoing: Req[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const { results, loading } = useUserSearch(q);

  const load = useCallback(() => api.get<typeof data>('/contacts').then(setData, (e) => setError(errorText(e))), []);
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'ok');
      await load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  async function chat(u: PublicUser) {
    try {
      const c = await api.post<ConversationSummary>('/conversations/direct', { userId: u.id });
      putConversations([c]);
      router.push(`/chats/${c.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const known = new Set([...(data?.contacts.map((c) => c.id) ?? []), ...(data?.outgoing.map((r) => r.user.id) ?? [])]);

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Contacts" />
      <div className="mx-auto max-w-2xl space-y-6 p-4">
        <label className="flex h-11 items-center gap-2 rounded-xl bg-panel-2 px-3">
          <Search className="size-4 text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find people by username" aria-label="Find people" className="w-full bg-transparent text-sm outline-none" />
        </label>
        {q.trim() && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase text-muted">Search results</h2>
            {loading ? <Spinner /> : results.length === 0 ? <p className="text-sm text-muted">Nobody found.</p> : null}
            <ul>
              {results.map((u) => (
                <li key={u.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-panel-2">
                  <Link href={`/u/${u.username}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={u.displayName} url={u.avatarUrl} size={40} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{u.displayName}</span>
                      <span className="block text-xs text-muted">@{u.username}</span>
                    </span>
                  </Link>
                  {!known.has(u.id) && (
                    <Button size="sm" variant="secondary" onClick={() => act(() => api.post('/contacts/requests', { userId: u.id }), 'Request sent')}>
                      <UserPlus className="size-4" /> Add
                    </Button>
                  )}
                  <IconButton label={`Message ${u.displayName}`} onClick={() => chat(u)}>
                    <MessageCircle className="size-5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        )}
        {error && <ErrorBox text={error} retry={() => void load()} />}
        {data && data.incoming.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase text-muted">Requests</h2>
            <ul className="space-y-1">
              {data.incoming.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-xl bg-panel p-3">
                  <Avatar name={r.user.displayName} url={r.user.avatarUrl} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.user.displayName}</span>
                    <span className="block text-xs text-muted">@{r.user.username}</span>
                  </span>
                  <Button size="sm" onClick={() => act(() => api.post(`/contacts/requests/${r.id}/accept`), 'Contact added')}>Accept</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(() => api.post(`/contacts/requests/${r.id}/decline`))}>Decline</Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase text-muted">Your contacts {data ? `(${data.contacts.length})` : ''}</h2>
          {!data && !error && <Skeleton className="h-40" />}
          {data?.contacts.length === 0 && <Empty icon={<Users className="size-6" />} title="No contacts yet" text="Search for friends by their username above." />}
          <ul>
            {data?.contacts.map((u) => (
              <li key={u.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-panel-2">
                <Link href={`/u/${u.username}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={u.displayName} url={u.avatarUrl} size={44} online={u.online} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{u.nickname ?? u.displayName}</span>
                    <span className="block truncate text-xs text-muted">{lastSeen(u.online, u.lastSeenAt) || `@${u.username}`}</span>
                  </span>
                </Link>
                <IconButton label={`Message ${u.displayName}`} onClick={() => chat(u)}>
                  <MessageCircle className="size-5" />
                </IconButton>
              </li>
            ))}
          </ul>
        </section>
        {data && data.outgoing.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase text-muted">Sent requests</h2>
            <ul>
              {data.outgoing.map((r) => (
                <li key={r.id} className="flex items-center gap-3 p-2 text-sm">
                  <Avatar name={r.user.displayName} url={r.user.avatarUrl} size={32} />
                  <span className="flex-1">{r.user.displayName}</span>
                  <Button size="sm" variant="ghost" onClick={() => act(() => api.delete(`/contacts/requests/${r.id}`))}>Cancel</Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
