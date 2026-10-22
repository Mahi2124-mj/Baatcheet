'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Phone, PhoneMissed, Trash2, Video } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { calls } from '@/lib/calls';
import { cx, duration, timeShort } from '@/lib/format';
import { useMe } from '@/lib/session';
import { getState } from '@/lib/store';
import type { CallRecord } from '@/lib/types';
import { Avatar, Button, Empty, ErrorBox, IconButton, Skeleton, useConfirm, useToast } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';

type Row = CallRecord & { missed: boolean; outgoing: boolean };

export default function CallsPage() {
  const me = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<Row[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [missedOnly, setMissedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before?: string) => {
      setError(null);
      try {
        const r = await api.get<{ items: Row[]; nextCursor: string | null }>(`/calls?${new URLSearchParams({ ...(before ? { before } : {}), ...(missedOnly ? { missed: '1' } : {}) })}`);
        setItems((x) => (before ? [...(x ?? []), ...r.items] : r.items));
        setCursor(r.nextCursor);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [missedOnly],
  );
  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  async function remove(c: Row) {
    // Optimistic: the row goes at once and comes back if the server refuses.
    setItems((x) => x?.filter((y) => y.id !== c.id) ?? x);
    try {
      await api.delete(`/calls/${c.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
      void load();
    }
  }

  async function clearAll() {
    const ok = await confirm({
      title: missedOnly ? 'Clear missed calls?' : 'Clear call history?',
      text: 'They are removed from your list only; the other people still see them.',
      confirm: 'Clear',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/calls${missedOnly ? '?missed=1' : ''}`);
      setItems([]);
      setCursor(null);
      toast('Call history cleared', 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  async function callBack(c: Row, type: Row['type'] = c.type) {
    const conv = getState().conversations[c.conversationId];
    const other = c.participants.find((p) => p.id !== me.id) ?? null;
    try {
      await calls.start(c.conversationId, type, conv?.name ?? other?.displayName ?? 'Call', conv?.type === 'GROUP' ? null : other, conv?.type === 'GROUP');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Calls">
        <div className="flex rounded-xl bg-panel-2 p-1 text-sm" role="tablist">
          {['All', 'Missed'].map((t) => (
            <button key={t} role="tab" aria-selected={(t === 'Missed') === missedOnly} onClick={() => setMissedOnly(t === 'Missed')} className={cx('rounded-lg px-3 py-1', (t === 'Missed') === missedOnly && 'bg-hover font-medium')}>
              {t}
            </button>
          ))}
        </div>
        {Boolean(items?.length) && (
          <IconButton label={missedOnly ? 'Clear missed calls' : 'Clear call history'} onClick={clearAll}>
            <Trash2 className="size-5" />
          </IconButton>
        )}
      </PageHeader>
      {error && <ErrorBox text={error} retry={() => void load()} />}
      <ul className="mx-auto max-w-2xl p-2">
        {items === null && !error && Array.from({ length: 5 }).map((_, i) => <li key={i} className="p-3"><Skeleton className="h-12" /></li>)}
        {items?.length === 0 && <Empty icon={<Phone className="size-6" />} title={missedOnly ? 'No missed calls' : 'No calls yet'} text="Start a voice or video call from any chat." />}
        {items?.map((c) => {
          const other = c.participants.filter((p) => p.id !== me.id);
          const name = getState().conversations[c.conversationId]?.name ?? other.map((p) => p.displayName).join(', ');
          const secs = c.answeredAt && c.endedAt ? Math.round((new Date(c.endedAt).getTime() - new Date(c.answeredAt).getTime()) / 1000) : 0;
          return (
            <li key={c.id} className="flex items-center gap-3 rounded-xl p-3 hover:bg-panel-2">
              <Avatar name={name} url={other.length === 1 ? other[0].avatarUrl : null} size={44} />
              <div className="min-w-0 flex-1">
                <p className={cx('truncate font-medium', c.missed && 'text-danger')}>{name}</p>
                <p className="flex items-center gap-1 text-xs text-muted">
                  {c.missed ? <PhoneMissed className="size-3.5 text-danger" /> : c.outgoing ? <ArrowUpRight className="size-3.5 text-ok" /> : <ArrowDownLeft className="size-3.5 text-ok" />}
                  {c.type === 'VIDEO' ? 'Video' : 'Voice'} · {timeShort(c.startedAt)}
                  {secs > 0 && ` · ${duration(secs)}`}
                  {c.status === 'REJECTED' && ' · declined'}
                  {c.status === 'BUSY' && ' · busy'}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <IconButton label={`Voice call ${name}`} onClick={() => callBack(c, 'AUDIO')}>
                  <Phone className="size-5" />
                </IconButton>
                <IconButton label={`Video call ${name}`} onClick={() => callBack(c, 'VIDEO')}>
                  <Video className="size-5" />
                </IconButton>
                <IconButton label="Delete from call history" onClick={() => void remove(c)}>
                  <Trash2 className="size-5 text-muted" />
                </IconButton>
              </div>
            </li>
          );
        })}
        {cursor && (
          <li className="flex justify-center p-3">
            <Button variant="secondary" onClick={() => load(cursor)}>Load more</Button>
          </li>
        )}
      </ul>
    </div>
  );
}
