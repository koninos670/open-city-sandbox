/* Service worker so the game can be installed on a phone or a PC.
   It is deliberately network-first: every request goes to the network when the
   device is online, so a new build shows up immediately and no one is ever stuck
   on a cached old version. The cache is only there for offline play. */
const CACHE = 'open-city-v8';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './lib/three.min.js',
  './src/util.js', './src/models.js', './src/fx.js', './src/audio.js', './src/world.js',
  './src/entities.js', './src/player.js', './src/police.js', './src/hud.js',
  './src/phone.js', './src/home.js', './src/touch.js', './src/heists.js', './src/game.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      const copy = fresh.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return fresh;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
