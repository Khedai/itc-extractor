// Khusela ITC Extractor — offline-capable service worker.
//
// Two strategies, and the difference is deliberate:
//   • the shell (the document a visitor lands on, the manifest and js/config.js) is
//     network-first. Cache-first served whatever was captured when this worker first
//     installed, so a deploy could stay invisible on a device that had visited
//     before — the Signature section was live and served by the site, yet a browser
//     holding an older copy reloaded it every time and never showed it. The cached
//     copy is now only the offline fallback.
//   • everything else (vendor libraries, modules, icons) is cache-first: those files
//     change rarely and are large, and serving them from the cache is what makes the
//     app work offline.
// js/email.js, js/app.js and js/signature.js are cache-first, so a device that has
// visited before keeps the copy it captured until this name changes: the version
// below moves with every change to any of them, or a deploy that reworks how an
// application is emailed or signed would simply not reach the browsers that used
// the old build.
const CACHE = 'khusela-itc-v32';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/config.js',
  './js/itcParser.js',
  './js/extractor.js',
  './js/pdfGenerator.js',
  './js/email.js',
  './js/tracker.js',
  './js/signature.js',
  './js/app.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/html2canvas.min.js',
  './vendor/jspdf.umd.min.js',
  './icons/icon-192.png?v=2',
  './icons/icon-512.png?v=2',
  './logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The document, the manifest, and the configuration the signature buttons read.
function isShell(url) {
  return url.pathname === '/'
    || url.pathname.endsWith('/index.html')
    || url.pathname.endsWith('/manifest.webmanifest')
    || url.pathname.endsWith('/js/config.js');
}

// The network decides what the shell is, so a deploy shows up on the next visit;
// the cache answers when the network cannot, and the cached document is the last
// resort for a navigation (a deep link has no cached entry of its own).
async function networkFirst(cache, request) {
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    const hit = await cache.match(request);
    if (hit) return hit;
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
    throw e;
  }
}

// Files that rarely change are answered from the cache straight away; the first
// visit (and activation, which fills the cache) is what puts them there.
async function cacheFirst(cache, request) {
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Only a good reply is worth keeping — a 404 must not become that file's answer.
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  const shell = event.request.mode === 'navigate' || isShell(url);
  event.respondWith(caches.open(CACHE).then((cache) => (shell
    ? networkFirst(cache, event.request)
    : cacheFirst(cache, event.request))));
});
