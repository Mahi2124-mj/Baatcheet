'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { api, errorText, uploadFile } from '@/lib/api';
import { enablePush, pushSupported } from '@/lib/push';
import { useSession } from '@/lib/session';
import type { Me } from '@/lib/types';
import { Avatar, Button, Input, useToast } from '@/components/ui';
import { PinFields, pinFormError } from '@/components/PinSettings';
import { rememberLogin } from '@/lib/quickLogin';

export default function Onboarding() {
  const { me, setMe } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const file = useRef<HTMLInputElement>(null);

  async function finish() {
    // The PIN is optional; when one is typed it must be valid before we go on.
    const pinError = pin || repeat ? pinFormError(pin, repeat) : null;
    if (pinError) return toast(pinError, 'error');
    setBusy(true);
    try {
      if (pin) {
        await api.put<Me>('/auth/pin', { pin });
        rememberLogin(me.username, true);
      }
      setMe(await api.patch<Me>('/users/me', { displayName: name, bio, onboarded: true }));
      if ('Notification' in window && Notification.permission === 'default') {
        // Allowing notifications also turns on push, so calls and messages arrive with no tab open.
        await (pushSupported() ? enablePush() : Notification.requestPermission()).catch(() => {});
      }
      router.replace('/chats');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-line bg-panel p-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Set up your profile</h1>
          <p className="text-sm text-muted">This is how people will see you.</p>
        </div>
        <div className="flex justify-center">
          <button className="relative" onClick={() => file.current?.click()} aria-label="Choose a profile picture">
            <Avatar name={name || me.username} url={me.avatarUrl} size={96} />
            <span className="absolute bottom-0 right-0 flex size-8 items-center justify-center rounded-full bg-accent text-accent-ink"><Camera className="size-4" /></span>
          </button>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const up = await uploadFile(f, 'avatar');
                setMe(await api.patch<Me>('/users/me', { avatarKey: up.key }));
              } catch (err) {
                toast(errorText(err), 'error');
              }
            }}
          />
        </div>
        <Input label="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">About (optional)</span>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} className="h-20 w-full resize-none rounded-xl border border-line bg-panel-2 p-3 text-sm outline-none focus:border-accent" />
        </label>
        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-sm font-medium">Quick-login PIN <span className="font-normal text-muted">(optional)</span></p>
          <p className="text-xs text-muted">On any phone, log in with your username and this PIN instead of the password.</p>
          <PinFields pin={pin} repeat={repeat} onPin={setPin} onRepeat={setRepeat} />
        </div>
        <p className="text-xs text-muted">Next, your browser may ask to show notifications — allow it to hear about calls and messages while this tab is in the background.</p>
        <Button className="w-full" loading={busy} disabled={!name.trim()} onClick={finish}>Start chatting</Button>
      </div>
    </div>
  );
}
