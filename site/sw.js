// BodyArcade service worker.
// Pages and scripts: network first, so updates show up immediately; cache is the offline fallback.
// Images and fonts: cache first.
const CACHE = 'bodyarcade-v2';
const PRECACHE = ['/', '/BodyArcade.html', '/game-core.js', '/features.js', '/multiplayer.js', '/assets/ba.css', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(() => null)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const isAsset = /\.(png|jpg|jpeg|webp|svg|woff2|ico)$/.test(url.pathname);
  if (isAsset) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(hit => hit || caches.match('/'))));
});
