// Service Worker — CISEB Gestión PWA
const CACHE = 'ciseb-v3';
const BASE  = '/ciseb/';

// Archivos que se cachean al instalar (shell de la app)
const SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'config.js',
  BASE + 'manifest.json',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// Network-first para index.html (siempre la última versión), cache-first para el resto
self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // Peticiones a Firebase, Railway y fuentes externas: siempre red, sin cache
  if (url.includes('firebaseio.com') || url.includes('firebase') ||
      url.includes('railway.app') || url.includes('googleapis.com') ||
      url.includes('gstatic.com') || url.includes('emailjs.com')) {
    return;
  }
  e.respondWith(
    fetch(e.request).then(function(resp) {
      // Actualizar cache con respuesta fresca
      var copy = resp.clone();
      caches.open(CACHE).then(function(c) { c.put(e.request, copy); });
      return resp;
    }).catch(function() {
      // Sin red: servir desde cache
      return caches.match(e.request).then(function(r) { return r || caches.match(BASE + 'index.html'); });
    })
  );
});
