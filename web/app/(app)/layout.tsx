'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { backgroundEnabled, watchBackground } from '@/lib/background';
import { localNotify, resumePush } from '@/lib/push';
import { calls } from '@/lib/calls';
import { bindRealtime, loadConversations, setNotificationHandlers } from '@/lib/realtime';
import { SessionCtx } from '@/lib/session';
import { closeSocket, getSocket } from '@/lib/socket';
import { resetStore, setState } from '@/lib/store';
import type { Me } from '@/lib/types';
import { useToast } from '@/components/ui';
import { AppNav } from '@/components/AppNav';
import { CallLayer } from '@/components/call/CallLayer';
import { Logo } from '@/components/Logo';
import { PinLock } from '@/components/PinLock';
import { isUnlocked } from '@/lib/quickLogin';

/** In a call with "do not disturb" on: no message / notification toasts or phone notifications over it. */
const inCall = () => {
  const s = calls.getState();
  return s.dnd && !['idle', 'ended'].includes(s.phase);
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  // PIN asked once per tab (see PinLock); null until the account is loaded.
  const [unlocked, setUnlocked] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setMe(await api.get<Me>('/auth/me'));
  }, []);

  useEffect(() => {
    api.get<Me>('/auth/me').then(
      (m) => {
        setUnlocked(!m.hasPin || isUnlocked(m.id));
        setMe(m);
      },
      () => router.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`),
    );
    const out = () => {
      closeSocket();
      resetStore();
      router.replace('/login');
    };
    window.addEventListener('bc:unauthorized', out);
    return () => window.removeEventListener('bc:unauthorized', out);
  }, [router]);

  useEffect(() => {
    if (!me || !unlocked) return;
    if (!me.onboarded && path !== '/onboarding') router.replace('/onboarding');
  }, [me, path, router, unlocked]);

  useEffect(() => {
    // Nothing (messages, calls, notifications) starts until the PIN was entered in this tab.
    if (!me || !unlocked) return;
    getSocket();
    bindRealtime(me.id);
    setNotificationHandlers(
      (n) => {
        if (inCall()) return;
        if (document.visibilityState !== 'visible') return void localNotify({ title: n.title, body: n.body, link: n.link ?? '/notifications', tag: n.type });
        toast(`${n.title}: ${n.body}`, 'info', n.link ? { label: 'Open', run: () => router.push(n.link!) } : undefined);
      },
      (conversationId, title, body) => {
        // App in the background (screen off, other app): a phone notification instead of an in-app toast.
        if (inCall()) return;
        if (document.visibilityState !== 'visible') return void localNotify({ title, body: body.slice(0, 120), link: `/chats/${conversationId}`, tag: `conv-${conversationId}` });
        toast(`${title}: ${body.slice(0, 80)}`, 'info', { label: 'Open', run: () => router.push(`/chats/${conversationId}`) });
      },
    );
    void loadConversations().catch(() => {});
    api.get<{ unread: number }>('/notifications').then((r) => setState(() => ({ unreadNotifications: r.unread })), () => {});
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    // Calls and messages also reach this device when no Baatcheet tab is open (unless
    // "Run in background" is off here).
    if (backgroundEnabled()) void resumePush().catch(() => {});
    const unwatch = watchBackground();
    return unwatch;
    // The id only changes on a different login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, unlocked]);

  if (!me) {
    return (
      <div className="app-h flex items-center justify-center">
        <div className="animate-pulse">
          <Logo />
        </div>
      </div>
    );
  }

  if (!unlocked) return <PinLock me={me} onUnlock={() => setUnlocked(true)} onLoggedOut={() => router.replace('/login')} />;

  const inChat = /^\/chats\/[^/]+/.test(path);
  return (
    <SessionCtx.Provider value={{ me, setMe, refresh }}>
      <div className="app-h flex flex-col overflow-hidden md:flex-row">
        {!me.emailVerified && (
          <div className="order-first bg-accent-soft px-4 py-2 text-center text-xs md:hidden">
            Verify your e-mail to send messages and make calls. <a className="font-semibold text-accent" href="/verify-email">Resend link</a>
          </div>
        )}
        <AppNav hiddenOnMobile={inChat} />
        <main className="relative min-h-0 min-w-0 flex-1">
          {!me.emailVerified && (
            <div className="hidden bg-accent-soft px-4 py-2 text-center text-sm md:block">
              Verify your e-mail to send messages and make calls. <a className="font-semibold text-accent" href="/verify-email">Resend link</a>
            </div>
          )}
          {children}
        </main>
      </div>
      <CallLayer />
    </SessionCtx.Provider>
  );
}
