'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, ChevronRight, Eraser, LogOut, Monitor, Moon, Smartphone, Sun } from 'lucide-react';
import { api, errorText, uploadFile } from '@/lib/api';
import { currentPush, disablePush, enablePush, pushSupported } from '@/lib/push';
import { backgroundEnabled, setBackground, subscribeBackground } from '@/lib/background';
import { useSession } from '@/lib/session';
import { closeSocket } from '@/lib/socket';
import { clearAllThreads, resetStore } from '@/lib/store';
import { ChatThemePicker } from '@/components/chat/ChatThemePicker';
import { cx, timeShort } from '@/lib/format';
import type { Me } from '@/lib/types';
import { Avatar, Button, Card, Input, Modal, Switch, useConfirm, useToast } from '@/components/ui';
import { PinSettings } from '@/components/PinSettings';
import { clearUnlocked, forgetLogin } from '@/lib/quickLogin';
import { PageHeader } from '@/components/PageHeader';

interface Sess {
  id: string;
  userAgent: string | null;
  ip: string | null;
  lastUsedAt: string;
  current: boolean;
}

function device(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

export default function SettingsPage() {
  const { me, setMe } = useSession();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [profile, setProfile] = useState({ displayName: me.displayName, username: me.username, bio: me.bio ?? '' });
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState<'system' | 'dark' | 'light'>('system');
  const [sessions, setSessions] = useState<Sess[]>([]);
  const background = useSyncExternalStore(subscribeBackground, backgroundEnabled, () => true);
  // What this phone really has, not just the switch: subscribed / not yet / blocked / unsupported.
  const [pushState, setPushState] = useState<'unknown' | 'on' | 'off' | 'blocked' | 'unsupported'>('unknown');
  const checkPush = async () => {
    if (!pushSupported()) return setPushState('unsupported');
    if (Notification.permission === 'denied') return setPushState('blocked');
    setPushState((await currentPush().catch(() => null)) ? 'on' : 'off');
  };
  const [pw, setPw] = useState<{ current: string; password: string } | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === 'light' || t === 'dark' ? t : 'system');
    api.get<Sess[]>('/auth/sessions').then(setSessions, () => {});
    void checkPush();
  }, []);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'ok');
      return true;
    } catch (e) {
      toast(errorText(e), 'error');
      return false;
    }
  };

  function applyTheme(t: 'system' | 'dark' | 'light') {
    setTheme(t);
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      if (t === 'system') localStorage.removeItem('bc-theme');
      else localStorage.setItem('bc-theme', t);
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  }

  async function logout() {
    await disablePush().catch(() => {});
    await api.post('/auth/logout').catch(() => {});
    clearUnlocked();
    closeSocket();
    resetStore();
    router.replace('/login');
  }

  const setPref = (k: keyof Me['settings']) => (v: boolean) => run(async () => setMe(await api.patch<Me>('/users/me/settings', { [k]: v })));

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Settings" />
      <div className="mx-auto max-w-2xl space-y-4 p-4 pb-16">
        <Card title="Profile">
          <div className="flex items-center gap-4 py-2">
            <button className="relative" onClick={() => file.current?.click()} aria-label="Change profile picture">
              <Avatar name={me.displayName} url={me.avatarUrl} size={72} />
              <span className="absolute bottom-0 right-0 flex size-7 items-center justify-center rounded-full bg-accent text-accent-ink"><Camera className="size-3.5" /></span>
            </button>
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void run(async () => setMe(await api.patch<Me>('/users/me', { avatarKey: (await uploadFile(f, 'avatar')).key })), 'Picture updated');
              }}
            />
            <div className="min-w-0">
              <p className="font-semibold">{me.displayName}</p>
              <p className="text-sm text-muted">{me.email ?? `@${me.username}`}</p>
              {me.avatarUrl && <button className="text-xs text-danger" onClick={() => run(async () => setMe(await api.patch<Me>('/users/me', { avatarKey: null })))}>Remove picture</button>}
            </div>
          </div>
          <div className="mt-2 space-y-3">
            <Input label="Name" value={profile.displayName} maxLength={60} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} />
            <Input label="Username" value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value.toLowerCase() })} hint="3–24 letters, numbers, _ or ." />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">About</span>
              <textarea value={profile.bio} maxLength={300} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} className="h-20 w-full resize-none rounded-xl border border-line bg-panel-2 p-3 text-sm outline-none focus:border-accent" />
            </label>
            <Button
              loading={saving}
              onClick={async () => {
                setSaving(true);
                await run(async () => setMe(await api.patch<Me>('/users/me', profile)), 'Profile saved');
                setSaving(false);
              }}
            >
              Save profile
            </Button>
          </div>
        </Card>

        <Card title="Appearance">
          <div className="flex gap-2 py-2">
            {([['system', Smartphone, 'Automatic'], ['light', Sun, 'Light'], ['dark', Moon, 'Dark']] as const).map(([t, Icon, label]) => (
              <button key={t} onClick={() => applyTheme(t)} aria-pressed={theme === t} className={cx('flex flex-1 items-center justify-center gap-2 rounded-xl border py-3 text-sm', theme === t ? 'border-accent bg-accent-soft text-accent' : 'border-line')}>
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
        </Card>

        <Card title="Chat theme">
          <ChatThemePicker />
          <p className="pb-2 text-xs text-muted">For all chats on this phone. A chat can have its own theme: open it → ⋮ → Chat theme.</p>
        </Card>

        <Card title="Chats">
          <div className="py-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={async () => {
                if (!(await confirm({ title: 'Clear all chats?', text: 'Every message in every chat disappears for you. Other people keep theirs. Chats stay in your list.', confirm: 'Clear all', danger: true }))) return;
                await run(async () => {
                  await api.post('/conversations/clear-all');
                  clearAllThreads();
                }, 'All chats cleared');
              }}
            >
              <Eraser className="size-4" /> Clear all chats
            </Button>
          </div>
        </Card>

        <Card title="Notifications">
          <Switch label="Messages" checked={me.settings.notifyMessages} onChange={setPref('notifyMessages')} />
          <Switch label="Calls" description="Incoming and missed calls" checked={me.settings.notifyCalls} onChange={setPref('notifyCalls')} />
          <Switch label="Groups" description="When someone adds you to a group" checked={me.settings.notifyGroups} onChange={setPref('notifyGroups')} />
          <Switch
            label="Run in background"
            description={
              background
                ? `Calls and messages reach this phone while the app is in the background${pushSupported() ? ' or closed' : ''}.`
                : 'Nothing arrives until you open the app; you’ll see everything you missed when you do.'
            }
            checked={background}
            onChange={(v) => run(async () => { await setBackground(v); await checkPush(); }, v ? 'Running in background' : 'Background off')}
          />
          {background && pushState !== 'on' && pushState !== 'unknown' && (
            <div className="mt-1 rounded-xl bg-accent-soft p-3 text-sm">
              <p>
                {pushState === 'blocked'
                  ? 'Notifications are blocked for this site. Allow them in the browser’s site settings (lock icon → Notifications), then come back.'
                  : pushState === 'unsupported'
                    ? 'This browser can’t show notifications when the app is closed.'
                    : 'Notifications are not on for this phone yet, so nothing arrives while the app is closed.'}
              </p>
              {pushState === 'off' && (
                <Button size="sm" className="mt-2" onClick={() => run(async () => { await enablePush(); await checkPush(); }, 'Notifications on')}>
                  Turn on notifications
                </Button>
              )}
            </div>
          )}
          <p className="pt-2 text-xs text-muted">
            {pushSupported()
              ? 'With the app closed or the phone asleep, calls arrive as a notification that opens the chat. Keep the app open to answer instantly.'
              : 'This browser can’t notify a closed app. On iPhone, add Lottery Pao to the Home Screen first.'}
          </p>
        </Card>

        <Link href="/settings/privacy" className="flex items-center justify-between rounded-2xl border border-line bg-panel p-5">
          <span>
            <span className="block font-medium">Privacy & security</span>
            <span className="block text-sm text-muted">Last seen, who can message you, blocked people</span>
          </span>
          <ChevronRight className="size-5 text-muted" />
        </Link>

        <Card title="Quick-login PIN">
          <PinSettings />
        </Card>

        <Card title="Account">
          <div className="space-y-3 py-2 text-sm">
            {me.email && (
              <p>
                E-mail: {me.email}{' '}
                {me.emailVerified ? <span className="text-ok">· verified</span> : <button className="text-accent" onClick={() => run(() => api.post('/auth/resend-verification'), 'Verification e-mail sent')}>· verify now</button>}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPw({ current: '', password: '' })}>Change password</Button>
              <Button variant="secondary" size="sm" onClick={logout}><LogOut className="size-4" /> Log out</Button>
            </div>
          </div>
        </Card>

        <Card title="Devices">
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <Monitor className="size-5 text-muted" />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium">{device(s.userAgent)} {s.current && <span className="text-ok">· this device</span>}</span>
                  <span className="block text-xs text-muted">Active {timeShort(s.lastUsedAt)}{s.ip ? ` · ${s.ip}` : ''}</span>
                </span>
                {!s.current && <Button variant="ghost" size="sm" onClick={() => run(async () => { await api.delete(`/auth/sessions/${s.id}`); setSessions((x) => x.filter((y) => y.id !== s.id)); }, 'Logged out')}>Log out</Button>}
              </li>
            ))}
          </ul>
          {sessions.length > 1 && (
            <Button variant="secondary" size="sm" onClick={() => run(async () => { await api.post('/auth/sessions/revoke-others'); setSessions((x) => x.filter((y) => y.current)); }, 'Other devices logged out')}>
              Log out all other devices
            </Button>
          )}
        </Card>

        <Card title="Danger zone">
          <p className="mb-3 text-sm text-muted">Deleting your account removes your profile, contacts, files and sign-ins. Messages you sent stay in other people’s chats as “deleted”.</p>
          <Button variant="danger" onClick={() => setDel('')}>Delete my account</Button>
        </Card>

        <p className="text-center text-sm"><Link href="/help" className="text-muted hover:text-text">Help & support</Link></p>
      </div>

      <Modal open={pw !== null} onClose={() => setPw(null)} title="Change password">
        <div className="space-y-3">
          <Input label="Current password" type="password" autoComplete="current-password" value={pw?.current ?? ''} onChange={(e) => setPw({ ...pw!, current: e.target.value })} />
          <Input label="New password" type="password" autoComplete="new-password" value={pw?.password ?? ''} onChange={(e) => setPw({ ...pw!, password: e.target.value })} hint="At least 8 characters with letters and numbers. Other devices get logged out." />
          <Button className="w-full" onClick={async () => (await run(() => api.post('/auth/change-password', pw), 'Password changed')) && setPw(null)}>Save</Button>
        </div>
      </Modal>
      <Modal open={del !== null} onClose={() => setDel(null)} title="Delete account">
        <p className="mb-3 text-sm text-muted">This can’t be undone. Enter your password to confirm.</p>
        <Input label="Password" type="password" value={del ?? ''} onChange={(e) => setDel(e.target.value)} />
        <Button
          variant="danger"
          className="mt-4 w-full"
          onClick={async () => {
            if (!(await confirm({ title: 'Really delete your account?', confirm: 'Delete forever', danger: true }))) return;
            if (await run(() => api.post('/auth/delete-account', { password: del }))) {
              forgetLogin();
              closeSocket();
              resetStore();
              router.replace('/');
            }
          }}
        >
          Delete forever
        </Button>
      </Modal>
    </div>
  );
}
