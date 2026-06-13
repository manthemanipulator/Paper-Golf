const CACHE_NAME = 'golf-companion-v2026.6.3';
const urlsToCache = [
    './',
    './index.html'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.open(CACHE_NAME).then(cache => {
            return cache.match(event.request).then(cachedResponse => {
                const fetchedResponse = fetch(event.request).then(networkResponse => {
                    // Update the cache with the newest version
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
                // Return cached version if it exists, otherwise use network
                return cachedResponse || fetchedResponse;
            });
        })
    );
});
