'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { Button, Input } from '@/components/ui';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) return setError('Passwords don’t match');
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-xl font-semibold">Password changed</h1>
        <p className="text-sm text-muted">You were logged out everywhere. Log in with your new password.</p>
        <Link href="/login" className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink">Log in</Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters with letters and numbers" />
      <Input label="Repeat it" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" className="w-full" loading={busy} disabled={!token}>Save password</Button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
