import type { Metadata } from 'next';

// The start screen is a product advertisement, so its tab / app-switcher title says nothing about chat.
export const metadata: Metadata = { title: 'Orbit 7 Pro', description: 'Orbit 7 Pro. Light, caught in a ring.' };

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return children;
}
