// BodyArcade service worker (v20261007).
// Pages and scripts: network first, so a new build reaches every player on the next
// load. Images, fonts, the 3D library and the pose model: cached after first use.
const VERSION = '20261007';
const CACHE = 'ba-' + VERSION;
const STATIC = /\.(png|jpg|jpeg|webp|avif|svg|woff2|ico|mp4|webm)$/i;
const LIB = /\/vendor\/|cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision|storage\.googleapis\.com\/mediapipe-models\//;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;

  // Third-party libraries and the pose model: cache first (versioned by the cache name).
  if (LIB.test(req.url)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && (res.type === 'basic' || res.type === 'cors')) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (!same) return;

  // Static media: stale-while-revalidate.
  if (STATIC.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || Response.error();
    }));
    return;
  }

  // Everything else (HTML, JS, CSS, JSON): network first, cache fallback for offline.
  e.respondWith(fetch(req).then(res => {
    if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
    return res;
  }).catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('/') : Response.error())));
});
