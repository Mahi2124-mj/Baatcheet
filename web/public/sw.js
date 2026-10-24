// Service worker: shows Web Push notifications (messages, calls) and opens the app when one is tapped.
// It does not cache pages, so the app always talks to the live server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Lottery Pao', body: event.data && event.data.text() }; }
  event.waitUntil((async () => {
    // Don't notify when the app is open on screen: it shows the message / rings itself.
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (tabs.some((c) => c.visibilityState === 'visible')) return;
    const call = Boolean(data.call);
    await self.registration.showNotification(data.title || 'Lottery Pao', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { link: data.link || '/chats', call, callId: data.callId || null },
      renotify: Boolean(data.tag),
      // Calls stay on screen and buzz like a ringing phone until answered or declined.
      requireInteraction: call,
      vibrate: call ? [600, 300, 600, 300, 600, 300, 600, 300, 600] : [150],
      actions: call ? [{ action: 'answer', title: 'Answer' }, { action: 'decline', title: 'Decline' }] : [],
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const link = d.link || '/chats';
  event.waitUntil((async () => {
    if (event.action === 'decline' && d.callId) {
      await fetch(`/api/calls/${d.callId}/decline`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      return;
    }
    // Answer / tap: open the app on that chat; an incoming call rings there and can be accepted.
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of tabs) {
      if (!('focus' in c)) continue;
      await c.focus();
      // Only pages this worker controls can be navigated; others just come to the front.
      if ('navigate' in c && c.url && new URL(c.url).origin === self.location.origin) await c.navigate(link).catch(() => {});
      return;
    }
    await self.clients.openWindow(link);
  })());
});
