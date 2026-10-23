'use client';
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { markUnlocked, pinProblem, rememberLogin } from '@/lib/quickLogin';
import { useSession } from '@/lib/session';
import type { Me } from '@/lib/types';
import { Button, Input, Modal, useConfirm, useToast } from '@/components/ui';

/** PIN field pair (PIN + repeat) used in Settings and onboarding. */
export function PinFields({ pin, repeat, onPin, onRepeat }: { pin: string; repeat: string; onPin: (v: string) => void; onRepeat: (v: string) => void }) {
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Input label="PIN" type="password" inputMode="numeric" autoComplete="new-password" placeholder="4–6 digits" value={pin} onChange={(e) => onPin(digits(e.target.value))} className="tracking-[0.4em]" />
      <Input label="Repeat PIN" type="password" inputMode="numeric" autoComplete="new-password" value={repeat} onChange={(e) => onRepeat(digits(e.target.value))} className="tracking-[0.4em]" />
    </div>
  );
}

export function pinFormError(pin: string, repeat: string) {
  return pinProblem(pin) ?? (pin !== repeat ? 'The two PINs are different' : null);
}

/** Settings card: set, change or remove the quick-login PIN. */
export function PinSettings() {
  const { me, setMe } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    const problem = pinFormError(pin, repeat);
    if (problem) return toast(problem, 'error');
    setBusy(true);
    try {
      const next = await api.put<Me>('/auth/pin', { pin });
      setMe(next);
      rememberLogin(next.username, true);
      markUnlocked(next.id);
      toast(me.hasPin ? 'PIN changed' : 'PIN set — next time just enter it to log in', 'ok');
      setOpen(false);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: 'Remove your PIN?', text: 'You will need your password to log in on a new device.', confirm: 'Remove', danger: true }))) return;
    try {
      const next = await api.delete<Me>('/auth/pin');
      setMe(next);
      rememberLogin(next.username, false);
      toast('PIN removed', 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <div className="space-y-3 py-2 text-sm">
      <p className="flex items-center gap-2">
        <KeyRound className="size-4 text-accent" />
        {me.hasPin ? <span>PIN is on — log in with <b>{me.username}</b> + your PIN.</span> : <span>Set a 4–6 digit PIN to log in quickly, without your password.</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={me.hasPin ? 'secondary' : undefined} onClick={() => { setPin(''); setRepeat(''); setOpen(true); }}>
          {me.hasPin ? 'Change PIN' : 'Set PIN'}
        </Button>
        {me.hasPin && <Button size="sm" variant="ghost" onClick={remove}>Remove PIN</Button>}
      </div>
      <p className="text-xs text-muted">After 5 wrong PINs, PIN login turns off and you log in with your password again.</p>
      <Modal open={open} onClose={() => setOpen(false)} title={me.hasPin ? 'Change PIN' : 'Set a PIN'}>
        <div className="space-y-4">
          <PinFields pin={pin} repeat={repeat} onPin={setPin} onRepeat={setRepeat} />
          <Button className="w-full" loading={busy} onClick={save}>Save PIN</Button>
        </div>
      </Modal>
    </div>
  );
}
