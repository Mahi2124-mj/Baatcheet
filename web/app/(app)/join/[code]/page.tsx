'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { putConversations } from '@/lib/store';
import type { ConversationSummary } from '@/lib/types';
import { Button, ErrorBox, Spinner } from '@/components/ui';

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<{ name: string; members: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<{ name: string; members: number }>(`/invites/${code}`).then(setInfo, (e) => setError(errorText(e)));
  }, [code]);
  if (error) return <ErrorBox text={error} />;
  if (!info) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 text-center">
        <Users className="mx-auto size-10 text-accent" />
        <h1 className="mt-3 text-xl font-semibold">{info.name}</h1>
        <p className="text-sm text-muted">{info.members} members</p>
        <Button
          className="mt-6 w-full"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const c = await api.post<ConversationSummary>(`/invites/${code}/join`);
              putConversations([c]);
              router.replace(`/chats/${c.id}`);
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          Join group
        </Button>
      </div>
    </div>
  );
}
