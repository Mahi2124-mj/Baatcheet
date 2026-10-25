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

/**
 * Shows a notification from this tab while it is in the background (the server's push may also arrive;
 * the same tag makes them one notification). Works without push being set up.
 */
export async function localNotify(n: { title: string; body: string; link: string; tag: string; call?: boolean; callId?: string }) {
  if (!pushSupported() || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(n.title, {
      body: n.body,
      tag: n.tag,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { link: n.link, call: Boolean(n.call), callId: n.callId ?? null, tag: n.tag, title: n.title, body: n.body },
      requireInteraction: Boolean(n.call),
      // Ring-like buzz for calls, a short one for messages.
      vibrate: n.call ? [800, 400, 800, 400, 800] : [150],
      // Same buttons as the push version (sw.js): tap = answer.
      actions: n.call ? [{ action: 'mute', title: 'Mute' }, { action: 'decline', title: 'Decline' }] : [],
    } as NotificationOptions);
  } catch {
    // No service worker yet: the in-app toast still shows when the app is opened.
  }
}

/** Removes a notification (e.g. the ringing call notification once the call was answered or ended). */
export async function closeNotification(tag: string) {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    (await reg?.getNotifications({ tag }))?.forEach((n) => n.close());
  } catch {
    // Nothing to close.
  }
}

export async function disablePush() {
  rememberOff(true);
  const sub = await currentPush();
  if (!sub) return;
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
