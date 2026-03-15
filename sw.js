const CACHE = 'radarbg-v2';
const STATIC = ['/', '/index.html', '/app.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never cache live API calls
  if (['waze.com','corsproxy.io','allorigins.win','openchargemap.io','nominatim.openstreetmap.org','router.project-osrm.org','overpass-api.de'].some(h=>url.hostname.includes(h))) return;
  // Always network-first for cameras.json (updated daily)
  if (url.pathname.endsWith('cameras.json')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached => {
    if (cached) return cached;
    return fetch(e.request).then(res => {
      if (!res || res.status !== 200 || res.type === 'opaque') return res;
      caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => cached);
  }));
});
