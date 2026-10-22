'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { cx, timeShort } from '@/lib/format';
import { setState } from '@/lib/store';
import type { AppNotification } from '@/lib/types';
import { Button, Empty, ErrorBox, Skeleton } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';

export default function NotificationsPage() {
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (before?: string) =>
    api.get<{ items: AppNotification[]; nextCursor: string | null }>(`/notifications${before ? `?before=${before}` : ''}`).then(
      (r) => {
        setItems((x) => (before ? [...(x ?? []), ...r.items] : r.items));
        setCursor(r.nextCursor);
      },
      (e) => setError(errorText(e)),
    );

  useEffect(() => {
    void load().then(() => api.post('/notifications/read', {}).then(() => setState(() => ({ unreadNotifications: 0 })), () => {}));
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Notifications">
        {items && items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => api.delete('/notifications').then(() => setItems([]))}>Clear all</Button>
        )}
      </PageHeader>
      {error && <ErrorBox text={error} />}
      <ul className="mx-auto max-w-2xl p-2">
        {items === null && !error && Array.from({ length: 4 }).map((_, i) => <li key={i} className="p-3"><Skeleton className="h-12" /></li>)}
        {items?.length === 0 && <Empty icon={<Bell className="size-6" />} title="You’re all caught up" text="Missed calls, contact requests and group invites show up here." />}
        {items?.map((n) => {
          const body = (
            <>
              <p className="text-sm font-medium">{n.title}</p>
              <p className="text-sm text-muted">{n.body}</p>
              {n.createdAt && <p className="mt-1 text-xs text-muted">{timeShort(n.createdAt)}</p>}
            </>
          );
          return (
            <li key={n.id} className={cx('rounded-xl p-3', !n.readAt && 'bg-accent-soft')}>
              {n.link ? <Link href={n.link} className="block">{body}</Link> : body}
            </li>
          );
        })}
        {cursor && <li className="p-3 text-center"><Button variant="secondary" onClick={() => load(cursor)}>Load more</Button></li>}
      </ul>
    </div>
  );
}
