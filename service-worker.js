const CACHE = 'piecewise-v4';
const SHELL = ['./', './piecewise.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// App shell: cache-first so it still opens offline.
// CDN libraries (Tailwind, pdf.js, fonts, Tesseract.js and its worker/lang data): cache-first too,
// since each URL is versioned, once fetched once they're good offline forever until the version pin changes.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        // Cross-origin no-cors requests (the CDN <script> tags) come back as opaque
        // responses: status 0, ok:false, but still perfectly cacheable and replayable.
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
