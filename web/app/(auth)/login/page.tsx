'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api, errorText } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Button, Input } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Logging in with the personal code is the default; e-mail + password stays as a fallback.
  const [codeMode, setCodeMode] = useState(true);
  const [code, setCode] = useState('');

  const done = (me: Me) => router.replace(!me.onboarded ? '/onboarding' : next && next.startsWith('/') && !next.startsWith('//') ? next : '/chats');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (codeMode) done(await api.post<Me>('/auth/code-login', { code }));
      else done(await api.post<Me>('/auth/login', { email, password }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h1 className="text-xl font-semibold">Welcome back</h1>
      {codeMode ? (
        <Input
          label="Login code"
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="font-mono tracking-widest"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          hint="Find your code in Settings → Login code on a device where you're logged in."
        />
      ) : (
        <>
          <Input label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="text-right text-sm">
            <Link href="/forgot-password" className="text-accent hover:underline">
              Forgot password?
            </Link>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={busy}>
        Log in
      </Button>
      <button type="button" className="w-full text-center text-sm text-muted hover:text-text" onClick={() => { setCodeMode(!codeMode); setError(null); }}>
        {codeMode ? 'Use e-mail and password instead' : 'Log in with code'}
      </button>
      <p className="text-center text-sm text-muted">
        New here?{' '}
        <Link href="/register" className="text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
