'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { forgetLogin, lastLogin, rememberLogin } from '@/lib/quickLogin';
import type { Me } from '@/lib/types';
import { Button, Input } from '@/components/ui';
import { cx } from '@/lib/format';

type Mode = 'password' | 'pin';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [mode, setMode] = useState<Mode>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  // Username remembered on this device: the PIN screen then asks for the PIN only.
  const [known, setKnown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const last = lastLogin();
    if (!last) return;
    setUsername(last.username);
    setKnown(last.username);
    if (last.hasPin) setMode('pin');
  }, []);

  const done = (me: Me) => {
    rememberLogin(me.username, me.hasPin);
    router.replace(!me.onboarded ? '/onboarding' : next && next.startsWith('/') && !next.startsWith('//') ? next : '/chats');
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'pin') done(await api.post<Me>('/auth/pin-login', { username, pin }));
      else done(await api.post<Me>('/auth/login', { username, password }));
    } catch (err) {
      setError(errorText(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  function notMe() {
    forgetLogin();
    setKnown(null);
    setUsername('');
    setPin('');
    setMode('password');
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h1 className="text-xl font-semibold">Welcome back</h1>
      <div className="flex rounded-xl bg-panel-2 p-1 text-sm" role="tablist" aria-label="Log in with">
        {(['password', 'pin'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setError(null); }}
            className={cx('flex-1 rounded-lg py-1.5', mode === m && 'bg-hover font-medium')}
          >
            {m === 'password' ? 'Password' : 'PIN'}
          </button>
        ))}
      </div>
      {mode === 'pin' && known ? (
        <p className="text-sm">
          Logging in as <b>{known}</b> ·{' '}
          <button type="button" className="text-accent hover:underline" onClick={notMe}>not you?</button>
        </p>
      ) : (
        <Input
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      )}
      {mode === 'password' ? (
        <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      ) : (
        <Input
          label="PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus={Boolean(known)}
          placeholder="4–6 digits"
          className="text-center text-xl tracking-[0.6em]"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          hint="No PIN yet? Log in with your password once, then set one in Settings."
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={busy} disabled={mode === 'pin' && pin.length < 4}>
        Log in
      </Button>
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
