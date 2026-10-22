'use client';
// Start screen: just a picture; holding it for 5 seconds opens the app (see HoldToOpen).
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { HoldToOpen } from '@/components/HoldToOpen';

export default function Start() {
  const router = useRouter();
  useEffect(() => router.prefetch('/chats'), [router]);
  return (
    <main className="min-h-dvh">
      <div className="h-dvh">
        <HoldToOpen onOpen={() => router.replace('/chats')} />
      </div>
    </main>
  );
}
