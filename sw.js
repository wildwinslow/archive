/* Service worker — offline shell for the Collection Archive.
   Bump CACHE on every deploy of the shell files. */
const CACHE = 'archive-v5';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
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
  if(req.method !== 'GET') return;

  // Navigations: serve cached shell, refresh in background (stale-while-revalidate).
  if(req.mode === 'navigate'){
    e.respondWith(
      caches.match('./index.html').then(cached => {
        const network = fetch(req)
          .then(resp => {
            if(resp && resp.ok){
              caches.open(CACHE).then(c => c.put('./index.html', resp.clone()));
            }
            return resp;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Everything else in our scope: cache-first, fall back to network, cache successful hits.
  e.respondWith(
    caches.match(req).then(cached => {
      if(cached) return cached;
      return fetch(req).then(resp => {
        if(resp && resp.ok && new URL(req.url).origin === self.location.origin){
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return resp;
      });
    })
  );
});
