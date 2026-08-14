// Bump this on every deploy that changes cached files — it's what forces old
// caches to get cleaned out below instead of lingering around forever.
const CACHE_NAME = 'paper-golf-v2026.8.13';
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

    // Only cache same-origin requests. This cache exists purely as an offline
    // fallback for our own site's files — cross-origin responses (Firebase,
    // reCAPTCHA, Google Analytics, etc.) are frequently "opaque" and were the
    // actual source of the "Response body is already used" console error:
    // cloning certain opaque/disk-cache-served responses can throw. There's
    // also no reason to cache someone else's API responses in the first place.
    if (new URL(event.request.url).origin !== self.location.origin) {
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
                // Clone synchronously, right here, before any async gap — and
                // catch any cache-write failure so it can't surface as an
                // unhandled promise rejection or affect the response we hand
                // back to the page either way.
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME)
                    .then(cache => cache.put(event.request, responseToCache))
                    .catch(err => console.warn('SW cache put failed:', err));
                return networkResponse;
            })
            .catch(() => caches.open(CACHE_NAME).then(cache => cache.match(event.request)))
    );
});
