// L'appli du téléphone, gardée par le navigateur : elle s'ouvre sans réseau. Chaque version publiée a son propre cache
// (VERSION, écrit par telephone_site.py) : la nouvelle remplace l'ancienne au lancement suivant.
const VERSION = "__VERSION__";
const FICHIERS = __FICHIERS__;

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys().then((l) => Promise.all(l.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// les fichiers de l'appli : d'abord ceux gardés (ouverture immédiate) ; la page elle-même : le réseau d'abord, pour
// trouver une nouvelle version. Le reste (GitHub, Scryfall, images) passe sans s'arrêter ici.
self.addEventListener("fetch", (ev) => {
  const u = new URL(ev.request.url);
  if (ev.request.method !== "GET" || u.origin !== location.origin) return;
  if (ev.request.mode === "navigate") {
    ev.respondWith(fetch(ev.request).catch(() => caches.match("./", { ignoreSearch: true })));
    return;
  }
  ev.respondWith(caches.match(ev.request).then((r) => r || fetch(ev.request)));
});
