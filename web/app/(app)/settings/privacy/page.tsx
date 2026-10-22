'use client';
import { useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Me, PublicUser } from '@/lib/types';
import { Avatar, Button, Card, Select, Switch, useToast } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';

const VIS = [
  { value: 'EVERYONE' as const, label: 'Everyone' },
  { value: 'CONTACTS' as const, label: 'My contacts' },
  { value: 'NOBODY' as const, label: 'Nobody' },
];

export default function PrivacyPage() {
  const { me, setMe } = useSession();
  const toast = useToast();
  const [blocked, setBlocked] = useState<PublicUser[]>([]);
  useEffect(() => {
    api.get<PublicUser[]>('/users/blocks/list').then(setBlocked, () => {});
  }, []);
  const set = (body: Partial<Me['settings']>) => api.patch<Me>('/users/me/settings', body).then(setMe, (e) => toast(errorText(e), 'error'));
  const s = me.settings;
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Privacy & security" />
      <div className="mx-auto max-w-2xl space-y-4 p-4 pb-16">
        <Card title="Who can see">
          <Select label="Last seen & online" value={s.lastSeenVisibility} options={VIS} onChange={(v) => set({ lastSeenVisibility: v })} />
          <Select label="Profile photo & about" value={s.profileVisibility} options={VIS} onChange={(v) => set({ profileVisibility: v })} />
          <Switch label="Read receipts" description="If off, you won’t send or see read receipts (blue ticks)." checked={s.readReceipts} onChange={(v) => set({ readReceipts: v })} />
        </Card>
        <Card title="Who can contact me">
          <Select
            label="New messages and calls from"
            value={s.allowMessagesFrom}
            options={[{ value: 'EVERYONE', label: 'Everyone' }, { value: 'CONTACTS', label: 'My contacts' }]}
            onChange={(v) => set({ allowMessagesFrom: v })}
          />
          <p className="text-xs text-muted">Only people who have you in their contacts can add you to groups directly.</p>
        </Card>
        <Card title={`Blocked (${blocked.length})`}>
          {blocked.length === 0 && <p className="py-2 text-sm text-muted">Nobody blocked.</p>}
          <ul>
            {blocked.map((u) => (
              <li key={u.id} className="flex items-center gap-3 py-2">
                <Avatar name={u.displayName} url={u.avatarUrl} size={36} />
                <span className="flex-1 text-sm">{u.displayName} <span className="text-muted">@{u.username}</span></span>
                <Button size="sm" variant="secondary" onClick={() => api.delete(`/users/${u.id}/block`).then(() => setBlocked((b) => b.filter((x) => x.id !== u.id)))}>Unblock</Button>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Security">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
            <li>Everything between your browser and our servers is encrypted in transit (HTTPS/TLS, and DTLS-SRTP for calls).</li>
            <li>Messages and files are stored on our servers so you can read them on any device. They are <strong>not end-to-end encrypted</strong>.</li>
            <li>1:1 calls go directly between the two devices when possible, or through our relay server (TURN), which can’t decrypt the media. Group calls go through our media server.</li>
            <li>Administrators can’t read your chats or listen to calls. Reported messages are shared with moderators.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
