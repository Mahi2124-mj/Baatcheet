import type { Metadata } from 'next';

// The start screen looks like a plain picture, so its tab / app-switcher title says nothing about chat.
export const metadata: Metadata = { title: 'Photo' };

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return children;
}
