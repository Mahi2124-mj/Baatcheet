import { MessageCircle } from 'lucide-react';
import { Empty } from '@/components/ui';

export default function ChatsHome() {
  return (
    <div className="flex h-full items-center justify-center">
      <Empty icon={<MessageCircle className="size-6" />} title="Pick a chat" text="Choose a conversation on the left, or start a new one." />
    </div>
  );
}
