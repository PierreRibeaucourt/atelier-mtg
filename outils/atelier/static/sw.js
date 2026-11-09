// Service worker de l'Atelier : quand l'Atelier n'est pas lancé, l'adresse http://127.0.0.1:5000 montre la page
// « L'Atelier n'est pas lancé » (/eteint, gardée par le navigateur) au lieu de « Ce site est inaccessible ».
// Il ne regarde que le chargement des pages ; tout le reste passe sans lui.
const CACHE = "atelier-eteint";
const PAGE = "/eteint";

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.add(PAGE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => ev.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (ev) => {
  if (ev.request.mode !== "navigate") return;
  ev.respondWith(fetch(ev.request).catch(() => caches.match(PAGE).then((r) => r || Response.error())));
});
