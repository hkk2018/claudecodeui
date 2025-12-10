// Service Worker for Claude Code UI PWA
// Update version to force cache refresh - increment this on each deployment
const CACHE_VERSION = 'v2-' + Date.now();
const CACHE_NAME = 'claude-ui-' + CACHE_VERSION;

// Critical assets that need to be cached for offline use
const urlsToCache = [
  '/manifest.json'
];

// Install event - cache critical assets and skip waiting for immediate activation
self.addEventListener('install', event => {
  console.log('[SW] Installing new service worker version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching critical assets');
        return cache.addAll(urlsToCache);
      })
  );
  // Force new service worker to activate immediately
  self.skipWaiting();
});

// Fetch event - Network First strategy for all requests
self.addEventListener('fetch', event => {
  event.respondWith(
    // Try network first
    fetch(event.request)
      .then(response => {
        // Clone the response before caching
        const responseToCache = response.clone();

        // Cache the new response (excluding non-GET requests)
        if (event.request.method === 'GET') {
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
        }

        return response;
      })
      .catch(() => {
        // If network fails, try cache as fallback
        return caches.match(event.request)
          .then(response => {
            if (response) {
              console.log('[SW] Serving from cache (offline):', event.request.url);
              return response;
            }
            // If not in cache either, return a basic error response
            return new Response('Offline and not cached', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});

// Activate event - clean up old caches and take control immediately
self.addEventListener('activate', event => {
  console.log('[SW] Activating new service worker:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith('claude-ui-')) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});