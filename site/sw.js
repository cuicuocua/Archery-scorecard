// Service worker for the Arcieri Senesi Scorecard PWA.
//
// The whole app is one self-contained index.html (see site/build.js) — no
// separate JS/CSS files, so there's exactly one thing worth caching: the
// document itself. Strategy is network-first with a cache fallback: an
// online scorer always gets whatever was just deployed (this app updates
// often — a stale cached copy silently winning would be worse than no
// offline support at all), and an offline one gets the last copy that did
// load instead of a blank "no internet" page.
//
// Deliberately never touches cross-origin requests (Supabase's REST/Auth
// API) — those need to succeed or fail on their own so the app's existing
// localStorage outbox (see ArcheryScorecard.jsx) is the thing handling
// offline writes, not this service worker.
//
// CACHE_NAME gets a fresh value baked in by build.js on every deploy, so
// `activate` always purges the previous version's cached shell rather than
// serving it forever.
const CACHE_NAME = '__CACHE_VERSION__';
const SHELL_URL = './';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.add(SHELL_URL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy));
        return res;
      })
      .catch(() => caches.match(SHELL_URL))
  );
});
