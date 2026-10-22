'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, MessageCircle, Phone, Settings, Shield, Users } from 'lucide-react';
import { cx } from '@/lib/format';
import { useMe } from '@/lib/session';
import { useStore } from '@/lib/store';
import { Avatar } from './ui';

export function AppNav({ hiddenOnMobile }: { hiddenOnMobile: boolean }) {
  const path = usePathname();
  const me = useMe();
  const unreadChats = useStore((s) => Object.values(s.conversations).filter((c) => c.unread > 0 && !c.archived && !c.muted).length);
  const unreadNotes = useStore((s) => s.unreadNotifications);
  const connected = useStore((s) => s.connected);
  const items = [
    { href: '/chats', label: 'Chats', icon: MessageCircle, badge: unreadChats },
    { href: '/calls', label: 'Calls', icon: Phone },
    { href: '/contacts', label: 'Contacts', icon: Users },
    { href: '/notifications', label: 'Notifications', icon: Bell, badge: unreadNotes },
    { href: '/settings', label: 'Settings', icon: Settings },
    ...(me.role === 'ADMIN' ? [{ href: '/admin', label: 'Admin', icon: Shield }] : []),
  ];
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <nav
      aria-label="Main"
      className={cx(
        'ios-bar safe-b order-last flex shrink-0 border-t border-line/60 md:order-first md:w-[76px] md:flex-col md:items-center md:border-r md:border-t-0 md:py-4',
        hiddenOnMobile && 'hidden md:flex',
      )}
    >
      <Link href="/chats" className="mb-6 hidden md:block" aria-label="Baatcheet home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="size-10" />
      </Link>
      <div className="flex flex-1 justify-around md:flex-col md:justify-start md:gap-2">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            aria-label={it.label}
            aria-current={active(it.href) ? 'page' : undefined}
            className={cx(
              'relative flex flex-1 flex-col items-center gap-0.5 pb-1 pt-1.5 text-[10px] font-medium md:size-12 md:flex-none md:justify-center md:rounded-2xl md:py-0',
              active(it.href) ? 'text-accent md:bg-accent-soft' : 'text-muted hover:text-text md:hover:bg-hover',
            )}
          >
            <it.icon className="size-6" aria-hidden />
            <span className="md:hidden">{it.label}</span>
            {Boolean(it.badge) && (
              <span className="absolute right-[calc(50%-22px)] top-0.5 min-w-5 rounded-full bg-danger px-1.5 text-center text-[11px] font-semibold leading-5 text-white md:right-0 md:top-0">
                {it.badge! > 99 ? '99+' : it.badge}
              </span>
            )}
          </Link>
        ))}
      </div>
      <Link href={`/u/${me.username}`} className="mt-auto hidden md:block" aria-label="Your profile">
        <span className="relative block">
          <Avatar name={me.displayName} url={me.avatarUrl} size={40} />
          <span className={cx('absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-panel', connected ? 'bg-ok' : 'bg-muted')} title={connected ? 'Connected' : 'Reconnecting…'} />
        </span>
      </Link>
    </nav>
  );
}
