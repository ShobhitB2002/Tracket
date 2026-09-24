// Tracket service worker: shows push notifications (desktop, Android, and the
// iPhone/iPad Home Screen app). No offline caching.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const opts = {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/', autoId: d.autoId || null },
    requireInteraction: !!d.requireInteraction,
  };
  // Chrome/Android/Edge show buttons; Safari ignores them (open Tracket to deny there)
  if (d.autoId) opts.actions = [{ action: 'deny', title: 'Deny' }];
  e.waitUntil(self.registration.showNotification(d.title || 'Tracket', opts));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { url, autoId } = e.notification.data || {};
  if (e.action === 'deny' && autoId) {
    e.waitUntil(fetch('/api/auto', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: autoId, op: 'deny' }) }).catch(() => {}));
    return;
  }
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (open) return open.focus();
    return self.clients.openWindow(url || '/');
  })());
});
