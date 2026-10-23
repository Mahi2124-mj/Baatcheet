'use client';
// Asked each time the app is opened in a new tab on a device that is logged in and has a PIN.
import { useState } from 'react';
import { api, ApiError, errorText } from '@/lib/api';
import { clearUnlocked, markUnlocked } from '@/lib/quickLogin';
import type { Me } from '@/lib/types';
import { Avatar, Button, Input } from '@/components/ui';

export function PinLock({ me, onUnlock, onLoggedOut }: { me: Me; onUnlock: () => void; onLoggedOut: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/pin/verify', { pin });
      markUnlocked(me.id);
      onUnlock();
    } catch (err) {
      setPin('');
      // Five wrong PINs: the server logged this device out.
      if (err instanceof ApiError && err.code === 'pin_locked') {
        clearUnlocked();
        onLoggedOut();
        return;
      }
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function usePassword() {
    await api.post('/auth/logout').catch(() => {});
    clearUnlocked();
    onLoggedOut();
  }

  return (
    <div className="app-h flex items-center justify-center bg-bg p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-5 text-center" noValidate>
        <div className="flex justify-center">
          <Avatar name={me.displayName} url={me.avatarUrl} size={72} />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Enter PIN</h1>
          <p className="mt-1 text-sm text-muted">{me.displayName}</p>
        </div>
        <Input
          aria-label="PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          placeholder="••••"
          className="text-center text-2xl tracking-[0.6em]"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={busy} disabled={pin.length < 4}>
          Unlock
        </Button>
        <button type="button" className="text-sm text-accent" onClick={usePassword}>
          Use password instead
        </button>
      </form>
    </div>
  );
}
