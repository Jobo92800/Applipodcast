/* Mon parcours by MAbeautyplus — cache minimal.
   Les fichiers audio ne sont volontairement pas mis en cache :
   ils sont diffusés en streaming et peuvent être remplacés à tout moment. */
const CACHE = 'monparcours-v1';
const FICHIERS = ['/', '/index.html', '/manifest.webmanifest', '/assets/img/icone-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/audio/')) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && url.origin === location.origin) {
        const copie = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copie));
      }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});
