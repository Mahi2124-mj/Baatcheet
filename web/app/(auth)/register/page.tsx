'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { rememberLogin } from '@/lib/quickLogin';
import { api, errorText } from '@/lib/api';
import { Button, Input } from '@/components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const [f, setF] = useState({ username: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const userOk = /^[a-z0-9_.]{3,24}$/.test(f.username.toLowerCase());
  const passOk = f.password.length >= 8 && /[a-zA-Z]/.test(f.password) && /\d/.test(f.password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userOk || !passOk) return setError('Please fix the highlighted fields');
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ verificationEmailSent: boolean; emailVerified: boolean }>('/auth/register', { ...f, username: f.username.toLowerCase() });
      rememberLogin(f.username.toLowerCase(), false);
      router.replace(r.emailVerified ? '/onboarding' : r.verificationEmailSent ? '/verify-email?sent=1' : '/verify-email?sent=0');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <Input
        label="Username"
        autoComplete="username"
        required
        value={f.username}
        onChange={set('username')}
        error={f.username && !userOk ? '3–24 letters, numbers, _ or .' : null}
        hint="People find you by this name. You log in with it too."
      />
      <Input
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        value={f.password}
        onChange={set('password')}
        error={f.password && !passOk ? 'At least 8 characters with letters and numbers' : null}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={busy}>
        Sign up
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
