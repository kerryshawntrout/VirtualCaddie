const CACHE_NAME = 'caddie-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './script.js',
  './manifest.json'
  './aii.png'
];

// Install: Cache essential app shell files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching App Shell');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate: Clean up old caches if updated
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Serve cached content offline, attempt network for external APIs
self.addEventListener('fetch', (event) => {
  // Let live API requests (wind/elevation/GPS) bypass cache and handle errors in script.js
  if (event.request.url.includes('api.open-elevation.com') || event.request.url.includes('api.open-meteo.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
