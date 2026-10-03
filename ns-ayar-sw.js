/* Ayar (ns-ayar) — service worker: offline app shell, safe updates, and the share target.
 *
 * Releasing an update: change any app file, then run `node tools/ns-ayar-release.js`.
 * It rewrites NS_AYAR_VERSION below from a hash of NS_AYAR_ASSETS, so browsers see a new
 * service worker, download the new files in the background and show the "update" banner. */
const NS_AYAR_VERSION = '2026.10.03-efe5407a';
const NS_AYAR_CACHE = 'ns-ayar-app-' + NS_AYAR_VERSION;
const NS_AYAR_SHARE_CACHE = 'ns-ayar-share';
const NS_AYAR_ASSETS = [
  'index.html',
  'ns-ayar.webmanifest',
  'css/ns-ayar.css',
  'js/ns-ayar-detect.js',
  'js/ns-ayar-app.js',
  'js/ns-ayar-worker.js',
  'fonts/Pinar-FD-VF.woff2',
  'brand/ns-ayar-logo.png',
  'brand/ns-ayar-logo-dark.png',
  'icons/ns-ayar-favicon.ico',
  'icons/ns-ayar-32.png',
  'icons/ns-ayar-180.png',
  'icons/ns-ayar-192.png',
  'icons/ns-ayar-512.png',
  'icons/ns-ayar-maskable-512.png'
];

self.addEventListener('install', e => {
  // cache: 'reload' bypasses the HTTP cache so a new version never mixes in stale files.
  e.waitUntil(caches.open(NS_AYAR_CACHE).then(c => c.addAll(NS_AYAR_ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  // No skipWaiting() here: the page asks the user first (see "ns-ayar-skip-waiting").
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('ns-ayar-app-') && k !== NS_AYAR_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => { if (e.data === 'ns-ayar-skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Web Share Target: images shared to the installed app from the gallery / other apps.
  if (req.method === 'POST' && url.searchParams.has('ns-ayar-share-target')) {
    e.respondWith((async () => {
      try {
        const form = await req.formData(), cache = await caches.open(NS_AYAR_SHARE_CACHE);
        let n = 0;
        for (const f of form.getAll('images')) {
          if (!(f instanceof File)) continue;
          await cache.put(new Request(`ns-ayar-shared-${Date.now()}-${n++}`), new Response(f, { headers: { 'content-type': f.type, 'x-ns-ayar-name': encodeURIComponent(f.name || '') } }));
        }
      } catch (err) { /* the app opens anyway */ }
      return Response.redirect(new URL('./?ns-ayar-shared=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;

  // Only the app's own files are served from the cache. Everything else in this folder
  // (the admin panel, api/, tests/) always goes straight to the network, untouched.
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  const rel = url.pathname.slice(scope.length);

  // The app page: the cached shell (query strings ignored); network only as a fallback.
  if (req.mode === 'navigate') {
    if (rel !== '' && rel !== 'index.html') return;
    e.respondWith(caches.open(NS_AYAR_CACHE).then(c => c.match('index.html')).then(r => r || fetch(req)));
    return;
  }
  if (!NS_AYAR_ASSETS.includes(rel)) return;
  e.respondWith(caches.open(NS_AYAR_CACHE).then(c => c.match(req, { ignoreSearch: true })).then(r => r || fetch(req)));
});
