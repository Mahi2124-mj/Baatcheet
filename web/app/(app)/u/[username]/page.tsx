'use client';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Flag, MessageCircle, Phone, ShieldBan, UserMinus, UserPlus, Video } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { calls } from '@/lib/calls';
import { lastSeen } from '@/lib/format';
import { putConversations } from '@/lib/store';
import type { ConversationSummary, PublicUser } from '@/lib/types';
import { Avatar, Button, ErrorBox, Skeleton, useConfirm, useToast } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { ReportDialog } from '@/components/chat/ReportDialog';

interface Profile {
  user: PublicUser;
  self: boolean;
  contact: boolean;
  outgoingRequest: string | null;
  incomingRequest: string | null;
  blocked: boolean;
}

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState(false);

  const load = useCallback(() => api.get<Profile>(`/users/by-name/${encodeURIComponent(username)}`).then(setP, (e) => setError(errorText(e))), [username]);
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
  async function openChat(call?: 'AUDIO' | 'VIDEO') {
    if (!p) return;
    try {
      const c = await api.post<ConversationSummary>('/conversations/direct', { userId: p.user.id });
      putConversations([c]);
      if (call) await calls.start(c.id, call, p.user.displayName, p.user, false);
      else router.push(`/chats/${c.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  if (error) return <ErrorBox text={error} />;
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Profile" />
      <div className="mx-auto max-w-md p-6 text-center">
        {!p ? (
          <Skeleton className="mx-auto h-48 w-full" />
        ) : (
          <>
            <Avatar name={p.user.displayName} url={p.user.avatarUrl} size={120} className="mx-auto" />
            <h2 className="mt-4 text-2xl font-bold">{p.user.displayName}</h2>
            <p className="text-muted">@{p.user.username}</p>
            {!p.self && <p className="mt-1 text-sm text-muted">{lastSeen(p.user.online, p.user.lastSeenAt)}</p>}
            {p.user.bio && <p className="mt-4 whitespace-pre-wrap text-sm">{p.user.bio}</p>}
            {p.self ? (
              <Button className="mt-6" variant="secondary" onClick={() => router.push('/settings')}>Edit profile</Button>
            ) : p.blocked ? (
              <Button className="mt-6" variant="secondary" onClick={() => act(() => api.delete(`/users/${p.user.id}/block`), 'Unblocked')}>Unblock</Button>
            ) : (
              <>
                <div className="mt-6 flex justify-center gap-3">
                  <Button onClick={() => openChat()}><MessageCircle className="size-4" /> Message</Button>
                  <Button variant="secondary" aria-label="Voice call" onClick={() => openChat('AUDIO')}><Phone className="size-4" /></Button>
                  <Button variant="secondary" aria-label="Video call" onClick={() => openChat('VIDEO')}><Video className="size-4" /></Button>
                </div>
                <div className="mt-6 space-y-2 text-left">
                  {p.contact ? (
                    <Button variant="ghost" className="w-full justify-start" onClick={async () => (await confirm({ title: 'Remove from contacts?', confirm: 'Remove', danger: true })) && act(() => api.delete(`/contacts/${p.user.id}`), 'Removed')}>
                      <UserMinus className="size-4" /> Remove contact
                    </Button>
                  ) : p.incomingRequest ? (
                    <Button className="w-full" onClick={() => act(() => api.post(`/contacts/requests/${p.incomingRequest}/accept`), 'Contact added')}>Accept contact request</Button>
                  ) : p.outgoingRequest ? (
                    <Button variant="ghost" className="w-full justify-start" onClick={() => act(() => api.delete(`/contacts/requests/${p.outgoingRequest}`))}>Request sent · Cancel</Button>
                  ) : (
                    <Button variant="ghost" className="w-full justify-start" onClick={() => act(() => api.post('/contacts/requests', { userId: p.user.id }), 'Request sent')}>
                      <UserPlus className="size-4" /> Add to contacts
                    </Button>
                  )}
                  <Button variant="ghost" className="w-full justify-start text-danger" onClick={async () => (await confirm({ title: `Block ${p.user.displayName}?`, text: 'They can’t message or call you, or see your status.', confirm: 'Block', danger: true })) && act(() => api.post(`/users/${p.user.id}/block`), 'Blocked')}>
                    <ShieldBan className="size-4" /> Block
                  </Button>
                  <Button variant="ghost" className="w-full justify-start text-danger" onClick={() => setReport(true)}>
                    <Flag className="size-4" /> Report
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <ReportDialog target={report && p ? { id: '', senderId: p.user.id } : null} onClose={() => setReport(false)} />
    </div>
  );
}
