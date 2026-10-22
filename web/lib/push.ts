'use client';
import { api } from './api';

function b64ToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// Remembers that push was switched off in Settings on this device, so it isn't turned back on by itself.
const OFF_KEY = 'bc:push-off';
function rememberOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, '1');
    else localStorage.removeItem(OFF_KEY);
  } catch {
    // Storage blocked (private mode): nothing to remember.
  }
}
function switchedOff() {
  try {
    return localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
}

export async function currentPush() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Asks permission, subscribes this browser and tells the server. */
export async function enablePush() {
  if (!pushSupported()) throw new Error('This browser doesn’t support push notifications. On iPhone, add the site to your Home Screen first.');
  const { enabled, key } = await api.get<{ enabled: boolean; key: string | null }>('/push/public-key');
  if (!enabled || !key) throw new Error('Push notifications are not set up on this server');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked in your browser settings');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
  await api.post('/push/subscribe', sub.toJSON());
  rememberOff(false);
}

/**
 * Keeps push on for this device without asking again: once notifications are allowed it subscribes
 * (or re-sends the existing subscription), unless push was switched off in Settings here.
 */
export async function resumePush() {
  if (!pushSupported() || Notification.permission !== 'granted' || switchedOff()) return;
  await enablePush();
}

export async function disablePush() {
  rememberOff(true);
  const sub = await currentPush();
  if (!sub) return;
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
