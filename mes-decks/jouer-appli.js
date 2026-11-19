// La table de jeu de l'appli (jouer/?deck=…) : le deck que l'appli vient de préparer dans ce navigateur (telephone.js ›
// preparerJeu, IndexedDB « @jouer »), donné à jouer.js comme à une page partagée (window.PARTAGE), puis jouer.js.
(() => {
  const JOUER = document.currentScript.dataset.jouer, deck = new URLSearchParams(location.search).get("deck") || "";
  const lire = () => new Promise((ok) => {
    const r = indexedDB.open("atelier-telephone", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("fichiers");
    r.onerror = () => ok(null);
    r.onsuccess = () => {
      const q = r.result.transaction("fichiers").objectStore("fichiers").get("@jouer");
      q.onsuccess = () => { ok(q.result || null); r.result.close(); };
      q.onerror = () => ok(null);
    };
  });
  lire().then((d) => {
    if (!d || d.deck !== deck) {
      document.body.innerHTML = `<p style="padding:2rem;font-family:system-ui">Ouvre la table depuis la page du deck.
        <a href="../">Atelier MTG</a></p>`;
      return;
    }
    window.PARTAGE = { deck, api: d.api, retour: `../#/deck/${encodeURIComponent(deck)}/liste` };
    const s = document.createElement("script");
    s.src = JOUER;
    document.body.append(s);
  });
})();
