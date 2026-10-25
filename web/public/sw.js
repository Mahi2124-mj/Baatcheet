// Service worker: shows Web Push notifications (messages, calls) and opens the app when one is tapped.
// It does not cache pages, so the app always talks to the live server.
// Push only reaches this phone while "Run in background" is on (the subscription is removed when it's off).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Incoming calls ringing on this phone: tag → { stop, muted }. */
const ringing = new Map();
const RING_GAP_MS = 4000;

function callOptions(data, { muted }) {
  return {
    body: muted ? `${data.body ? data.body.replace(' · tap to answer', '') : ''} · muted — tap to answer` : data.body || '',
    tag: data.tag,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { link: data.link || '/chats', call: true, callId: data.callId || null, tag: data.tag, body: data.body, title: data.title },
    requireInteraction: true,
    // Each re-show rings the phone's notification sound and buzzes, like a ringtone; muted shows quietly.
    renotify: !muted,
    silent: muted,
    vibrate: muted ? [] : [800, 400, 800, 400, 800],
    // Android shows two buttons; tapping the notification itself answers.
    actions: muted
      ? [{ action: 'answer', title: 'Answer' }, { action: 'decline', title: 'Decline' }]
      : [{ action: 'mute', title: 'Mute' }, { action: 'decline', title: 'Decline' }],
  };
}

async function ring(data) {
  const state = { stop: false, muted: false };
  ringing.set(data.tag, state);
  const until = Date.now() + Math.min(Number(data.ringMs) || 45000, 90000);
  try {
    while (!state.stop && !state.muted && Date.now() < until) {
      await self.registration.showNotification(data.title || 'Incoming call', callOptions(data, state));
      await sleep(RING_GAP_MS);
    }
    // Rang out without an answer: the server sends the "missed call" notification itself.
    if (!state.muted || state.stop) (await self.registration.getNotifications({ tag: data.tag })).forEach((n) => n.close());
  } finally {
    if (ringing.get(data.tag) === state) ringing.delete(data.tag);
  }
}

async function tellPages(msg) {
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  tabs.forEach((c) => c.postMessage(msg));
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Lottery Pao', body: event.data && event.data.text() }; }
  event.waitUntil((async () => {
    // The call was answered, declined or ended: stop ringing here.
    if (data.cancel) {
      const s = ringing.get(data.tag);
      if (s) s.stop = true;
      (await self.registration.getNotifications({ tag: data.tag })).forEach((n) => n.close());
      return;
    }
    // Don't notify when the app is open on screen: it shows the message / rings itself.
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (tabs.some((c) => c.visibilityState === 'visible')) return;
    if (data.call) return ring(data);
    await self.registration.showNotification(data.title || 'Lottery Pao', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { link: data.link || '/chats' },
      renotify: Boolean(data.tag),
      vibrate: [150],
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  const d = event.notification.data || {};
  const link = d.link || '/chats';
  event.waitUntil((async () => {
    if (d.call && event.action === 'mute') {
      // Stop the sound and buzzing; keep the call on screen so it can still be answered.
      const s = ringing.get(d.tag);
      if (s) s.muted = true;
      await tellPages({ type: 'call-mute', callId: d.callId });
      await self.registration.showNotification(d.title || 'Incoming call', callOptions(d, { muted: true }));
      return;
    }
    event.notification.close();
    const s = d.tag && ringing.get(d.tag);
    if (s) s.stop = true;
    if (event.action === 'decline' && d.callId) {
      await tellPages({ type: 'call-mute', callId: d.callId });
      await fetch(`/api/calls/${d.callId}/decline`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      return;
    }
    // Answer button or a tap on the notification: open the app on that chat and answer there.
    const target = d.call ? `${link}${link.includes('?') ? '&' : '?'}answer=1` : link;
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of tabs) {
      if (!('focus' in c)) continue;
      await c.focus();
      // Only pages this worker controls can be navigated; others just come to the front.
      if ('navigate' in c && c.url && new URL(c.url).origin === self.location.origin) await c.navigate(target).catch(() => {});
      return;
    }
    await self.clients.openWindow(target);
  })());
});
