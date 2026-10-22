'use client';
import { createContext, useContext } from 'react';
import type { Me } from './types';

export const SessionCtx = createContext<{ me: Me; setMe: (m: Me) => void; refresh: () => Promise<void> } | null>(null);

export function useSession() {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('useSession outside the app');
  return s;
}
export const useMe = () => useSession().me;
