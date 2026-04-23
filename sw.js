// Minimal service worker: cache the app shell so the page loads offline.
// Gameplay still requires network for PeerJS signalling.

const CACHE = 'kosci-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './src/app.js',
  './src/game.js',
  './src/net.js',
  './src/fx.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin: cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // Cross-origin (CDN assets): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
