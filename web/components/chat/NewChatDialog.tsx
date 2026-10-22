'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { putConversations } from '@/lib/store';
import type { ConversationSummary, PublicUser } from '@/lib/types';
import { cx } from '@/lib/format';
import { Avatar, Button, Input, Modal, Spinner, useToast } from '../ui';

export function useUserSearch(q: string) {
  const [results, setResults] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (!term) return setResults([]);
    setLoading(true);
    const t = setTimeout(() => {
      api.get<PublicUser[]>(`/users/search?q=${encodeURIComponent(term)}`).then(setResults, () => setResults([])).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return { results, loading };
}

export function NewChatDialog({ mode, onClose }: { mode: 'chat' | 'group' | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [contacts, setContacts] = useState<PublicUser[]>([]);
  const [picked, setPicked] = useState<PublicUser[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const { results, loading } = useUserSearch(q);

  useEffect(() => {
    if (!mode) return;
    setQ('');
    setPicked([]);
    setName('');
    api.get<{ contacts: PublicUser[] }>('/contacts').then((r) => setContacts(r.contacts), () => {});
  }, [mode]);

  const shown = q.trim() ? results : contacts;

  async function open(u: PublicUser) {
    if (mode === 'group') {
      setPicked((p) => (p.some((x) => x.id === u.id) ? p.filter((x) => x.id !== u.id) : [...p, u]));
      return;
    }
    setBusy(true);
    try {
      const c = await api.post<ConversationSummary>('/conversations/direct', { userId: u.id });
      putConversations([c]);
      onClose();
      router.push(`/chats/${c.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createGroup() {
    setBusy(true);
    try {
      const c = await api.post<ConversationSummary & { skipped: string[] }>('/conversations/group', { name, memberIds: picked.map((p) => p.id) });
      putConversations([c]);
      if (c.skipped.length) toast(`${c.skipped.length} people weren’t added — they need you in their contacts. Share an invite link instead.`);
      onClose();
      router.push(`/chats/${c.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(mode)} onClose={onClose} title={mode === 'group' ? 'New group' : 'New chat'}>
      {mode === 'group' && <Input label="Group name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="mb-3" />}
      <label className="mt-3 flex h-10 items-center gap-2 rounded-xl bg-panel-2 px-3">
        <Search className="size-4 text-muted" aria-hidden />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by username or name" aria-label="Search people" className="w-full bg-transparent text-sm outline-none" />
      </label>
      {mode === 'group' && picked.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {picked.map((p) => (
            <button key={p.id} onClick={() => open(p)} className="rounded-full bg-accent-soft px-3 py-1 text-xs text-accent">
              {p.displayName} ✕
            </button>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs font-semibold uppercase text-muted">{q.trim() ? 'People' : 'Your contacts'}</p>
      <ul className="mt-2 max-h-72 overflow-y-auto">
        {loading && <li className="flex justify-center p-4"><Spinner /></li>}
        {!loading && shown.length === 0 && <li className="p-4 text-center text-sm text-muted">{q.trim() ? 'Nobody found' : 'No contacts yet — search by username.'}</li>}
        {shown.map((u) => {
          const on = picked.some((p) => p.id === u.id);
          return (
            <li key={u.id}>
              <button disabled={busy} onClick={() => open(u)} className={cx('flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-hover', on && 'bg-accent-soft')}>
                <Avatar name={u.displayName} url={u.avatarUrl} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{u.displayName}</span>
                  <span className="block truncate text-xs text-muted">@{u.username}</span>
                </span>
                {on && <Check className="size-5 text-accent" />}
              </button>
            </li>
          );
        })}
      </ul>
      {mode === 'group' && (
        <Button className="mt-4 w-full" disabled={!name.trim() || picked.length === 0} loading={busy} onClick={createGroup}>
          Create group ({picked.length + 1})
        </Button>
      )}
    </Modal>
  );
}
