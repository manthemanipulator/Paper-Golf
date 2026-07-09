// Bump this on every deploy that changes cached files — it's what forces old
// caches to get cleaned out below instead of lingering around forever.
const CACHE_NAME = 'paper-golf-v2026.7.0';
const urlsToCache = [
    './',
    './index.html'
];

self.addEventListener('install', event => {
    // Take over immediately instead of waiting for every open tab to close —
    // otherwise a fixed service worker can sit installed-but-inactive while
    // players stay stuck on the broken one until they happen to fully quit
    // the browser.
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('activate', event => {
    // Clear out caches from older deploys so nothing stale can ever be served again.
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    // The Cache API only supports GET requests — POSTs (like the submitScore
    // callable function hitting Cloud Functions) would throw on cache.put().
    // Let anything non-GET (or cross-origin, e.g. Firebase/Firestore calls)
    // just go straight to the network, uncached.
    if (event.request.method !== 'GET') {
        return;
    }

    // Network-first, cache as an offline fallback only. The old cache-first
    // approach meant every deploy needed TWO page loads before players actually
    // saw the new code — the first load served the stale cache and only updated
    // it in the background for next time. That's exactly what just happened with
    // the timezone fix.
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse.clone()));
                return networkResponse;
            })
            .catch(() => caches.open(CACHE_NAME).then(cache => cache.match(event.request)))
    );
});
