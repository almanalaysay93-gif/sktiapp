/* ===================================================================
   Service worker — app shell cache.
   The point of this app is that it works with the radio off, so every
   file it needs is cached on first visit and served cache-first after.
   Bump CACHE on every release or patients keep the old shell.
   =================================================================== */

const CACHE = 'sktidvo-v4';

const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/store.js',
  './js/i18n.js',
  './js/calendar.js',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/logo.png',
  './assets/skti-building.jpg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // cache:'reload' bypasses the browser's own HTTP cache — c.add()
      // alone can hand a version bump a stale file straight out of that
      // cache, silently undoing the bump. addAll rejects the whole batch
      // if one file 404s (assets/logo.png is optional), so cache each
      // file independently.
      .then(c => Promise.all(SHELL.map(url =>
        fetch(url, { cache: 'reload' }).then(res => res.ok && c.put(url, res)).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Google Fonts are a nicety. Cache them opportunistically; never block on them.
  const sameOrigin = url.origin === location.origin;

  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req)
        .then(res => {
          if (res.ok && (sameOrigin || res.type === 'cors' || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => {
          // Offline navigation falls back to the shell.
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    })
  );
});
