'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, errorText } from '@/lib/api';
import { Button, Input } from '@/components/ui';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  if (sent)
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-xl font-semibold">Check your e-mail</h1>
        <p className="text-sm text-muted">If an account exists for {email}, a reset link is on its way. It works for one hour.</p>
        <Link href="/login" className="text-sm text-accent">Back to login</Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <Input label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" className="w-full" loading={busy}>Send reset link</Button>
      <p className="text-center text-sm"><Link href="/login" className="text-muted hover:text-text">Back to login</Link></p>
    </form>
  );
}
