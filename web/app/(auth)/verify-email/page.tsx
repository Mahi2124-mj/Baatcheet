'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { Button, Spinner } from '@/components/ui';

function Verify() {
  const params = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<'idle' | 'working' | 'ok' | 'error'>(token ? 'working' : 'idle');
  const [msg, setMsg] = useState('');
  const [resent, setResent] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api.post('/auth/verify-email', { token }).then(
      () => setStatus('ok'),
      (e) => {
        setStatus('error');
        setMsg(errorText(e));
      },
    );
  }, [token]);

  async function resend() {
    try {
      await api.post('/auth/resend-verification');
      setResent(true);
    } catch (e) {
      setMsg(errorText(e));
    }
  }

  if (status === 'working') return <div className="flex justify-center py-8"><Spinner /></div>;
  if (status === 'ok')
    return (
      <div className="space-y-4 text-center">
        <MailCheck className="mx-auto size-10 text-ok" />
        <h1 className="text-xl font-semibold">E-mail verified</h1>
        <Link href="/onboarding" className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink">
          Continue
        </Link>
      </div>
    );
  return (
    <div className="space-y-4 text-center">
      <MailCheck className="mx-auto size-10 text-accent" />
      <h1 className="text-xl font-semibold">{status === 'error' ? 'Link not valid' : 'Check your inbox'}</h1>
      <p className="text-sm text-muted">
        {status === 'error'
          ? msg
          : params.get('sent') === '0'
            ? 'Your account is ready, but we couldn’t send the confirmation e-mail just now. Try sending it again in a few minutes.'
            : 'We sent you a link to confirm your e-mail. Open it to start chatting and calling.'}
      </p>
      {resent ? <p className="text-sm text-ok">Sent again.</p> : <Button variant="secondary" onClick={resend}>Send the link again</Button>}
      {status !== 'error' && msg && <p className="text-sm text-danger">{msg}</p>}
      <p className="text-sm">
        <Link href="/onboarding" className="text-muted hover:text-text">
          Do it later
        </Link>
      </p>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
