// The lightest possible service worker: the network first, always, with a
// cached copy as the offline fallback. Nothing sticks; deploys win.
const CACHE = 'pmt-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}));
      }
      return res;
    }).catch(async () => (await caches.match(e.request)) || Response.error())
  );
});
