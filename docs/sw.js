// Service worker of Adventure Lab Ops (installable app). Only the app shell is cached (cache-first); the Apps Script API is NEVER cached.
// IMPORTANT: bump CACHE on EVERY change under docs/ (index.html, manifest, icons). A new CACHE string makes sw.js differ → the phone installs it,
// downloads the fresh shell, deletes old caches, and the page reloads once.
const CACHE = 'al-ops-v27';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-512-maskable.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  // anything that is not a same-origin GET (the Apps Script web app is another origin and POST) goes straight to the network, untouched
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  const nav = r.mode === 'navigate';
  e.respondWith(caches.open(CACHE).then(c => c.match(nav ? './index.html' : r, { ignoreSearch: nav }).then(hit => hit || fetch(r))));
});
