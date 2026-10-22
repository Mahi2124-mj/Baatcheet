'use client';
import { usePathname } from 'next/navigation';
import { cx } from '@/lib/format';
import { ConversationList } from '@/components/chat/ConversationList';

export default function ChatsLayout({ children }: { children: React.ReactNode }) {
  const inChat = usePathname() !== '/chats';
  return (
    <div className="flex h-full">
      <aside className={cx('h-full w-full shrink-0 border-r border-line bg-panel md:w-[340px] lg:w-[380px]', inChat && 'hidden md:block')}>
        <ConversationList />
      </aside>
      <section className={cx('h-full min-w-0 flex-1', !inChat && 'hidden md:block')}>{children}</section>
    </div>
  );
}
