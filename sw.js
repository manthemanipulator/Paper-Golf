const CACHE_NAME = 'golf-companion-v1';
const urlsToCache = [
    './',
    './index.html'
];

// Install the service worker and save the files to cache
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
    );
});

// Intercept network requests and serve from cache if offline
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return the cached version if found, otherwise fetch from network
                return response || fetch(event.request);
            })
    );
});
