// Service worker: only shows Web Push notifications and focuses the app when one is tapped.
// It does not cache pages, so the app always talks to the live server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Lottery Pao', body: event.data && event.data.text() }; }
  event.waitUntil((async () => {
    // Don't notify when a tab is open and visible: the page shows it itself.
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (tabs.some((c) => c.visibilityState === 'visible')) return;
    await self.registration.showNotification(data.title || 'Lottery Pao', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon.svg',
      data: { link: data.link || '/chats' },
      renotify: Boolean(data.tag),
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/chats';
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of tabs) {
      if ('focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(link); return; }
    }
    await self.clients.openWindow(link);
  })());
});
