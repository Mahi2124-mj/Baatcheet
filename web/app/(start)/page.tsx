'use client';
// Start screen: a phone launch advertisement. Holding the phone's camera ring for 5 seconds opens the app.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LaunchAd } from '@/components/LaunchAd';

export default function Start() {
  const router = useRouter();
  useEffect(() => router.prefetch('/chats'), [router]);
  return <LaunchAd onOpen={() => router.replace('/chats')} />;
}
