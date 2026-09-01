// Khusela ITC Extractor — offline-capable service worker (cache-first).
const CACHE = 'khusela-itc-v13';
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
  './js/app.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/html2canvas.min.js',
  './vendor/jspdf.umd.min.js',
  './vendor/xlsx.full.min.js',
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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      });
    }),
  );
});
