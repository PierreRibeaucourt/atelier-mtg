// Atelier MTG — interface (JavaScript simple, sans compilation)
"use strict";

// ------------------------------------------------------------------ outils
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const enc = encodeURIComponent;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sansAccent = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const vue = $("#vue");
const etat = { decks: [], deck: null, filtre: "" };
// page partagée (publiée sur GitHub Pages par partage.py) : les réponses de l'API sont figées dans donnees.js,
// et tout ce qui modifie (classe « ecrit »), la recherche et la discussion sont masqués
const PARTAGE = window.PARTAGE || null;
if (PARTAGE) document.documentElement.classList.add("partage");
// appli du téléphone (static/telephone/telephone.js) : les données viennent de la sauvegarde en ligne, préparées par le
// PC ; la discussion, la simulation et la recherche restent sur le PC
const TELEPHONE = window.TELEPHONE || null;
const PC = !PARTAGE && !TELEPHONE;              // l'Atelier du PC : serveur Python, tâches en fond, mises à jour
const CET_APPAREIL = TELEPHONE ? "ce téléphone" : "ce PC", AUTRE_APPAREIL = "un autre appareil";      // PC ou téléphone
// partager un deck (page sur GitHub Pages) : depuis le PC ou le téléphone (partage.js), relié au PC ou non
const PARTAGEABLE = PC || !!TELEPHONE;
// le PC et le téléphone ont les mêmes droits sur les decks ; ce qui demande la puissance du PC reste visible sur le
// téléphone (data-pc="…") et dit où le faire
const SUR_PC = {
  simulation: "Les simulations tournent sur le PC : lance-les depuis l'Atelier de ton PC. Leurs résultats arrivent ensuite ici.",
  claude: "La discussion avec Claude se fait sur le PC : elle passe par Claude Code, installé sur ton PC.",
  synergies: "La recherche des synergies par Claude se lance sur le PC.",
  mtgpics: "La lecture des combos MTGPics se lance sur le PC.",
  jouer: "La table de jeu s'ouvre sur le PC : elle se joue à la souris.",
  proxies: "L'impression des proxies se fait sur le PC.",
};
function surPC(quoi) {
  ouvrirModale(`<h2>Sur le PC</h2>
    <p>${esc(SUR_PC[quoi] || "Ça se fait sur le PC.")}</p>`);
}
// page partagée : à qui sont ces decks (reglages.json « nom », sinon le compte GitHub qui publie)
// titre_accueil : la page d'accueil de l'Atelier (site_atelier.py), qui n'est le site de decks de personne
const MES_DECKS = PARTAGE && PARTAGE.titre_accueil || (PARTAGE && PARTAGE.auteur ? `Decks de ${PARTAGE.auteur}` : "Mes decks");
let versionAtelier = (PARTAGE && PARTAGE.version) || "";       // version.py ; dans l'Atelier, lue par verifierVersion()
// budget par carte (reglages.json, 5 € par défaut, 0 = pas d'alerte) : les cartes plus chères sont signalées
const REGLAGES = (PARTAGE && PARTAGE.reglages) || window.REGLAGES || {};
let BUDGET, BUDGET_TXT;                            // changés par la page Options sans recharger
function majBudget(b) {
  BUDGET = b == null ? 5 : b > 0 ? b : Infinity;
  BUDGET_TXT = String(BUDGET).replace(".", ",") + " €";
}
majBudget(REGLAGES.budget);

// préférences d'affichage gardées d'une visite à l'autre (si le navigateur le permet)
const PREF = {
  get(k, def) { try { return localStorage.getItem("pref-" + k) || def; } catch (_) { return def; } },
  set(k, v) { try { localStorage.setItem("pref-" + k, v); } catch (_) {} },
};

async function api(chemin, opts = {}) {
  if (PARTAGE) return apiPartage(chemin, opts);
  if (TELEPHONE) return TELEPHONE.api(chemin, opts);
  const init = { ...opts, headers: { "Content-Type": "application/json" } };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const r = await fetch(chemin, init);
  const type = r.headers.get("content-type") || "";
  const data = type.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw Object.assign(new Error((data && data.erreur) || data || r.statusText), { statut: r.status });
  return data;
}

// même clé que partage.py : chemin décodé, paramètres triés
function apiPartage(chemin, opts) {
  const u = new URL(chemin, "http://atelier");
  if (BASE_WEB && BASE_WEB.routes[u.pathname]) return BASE_WEB.routes[u.pathname](u.searchParams, opts.method || "GET");
  if ((opts.method || "GET") !== "GET") throw new Error("Page en lecture seule.");
  const p = [...u.searchParams].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const cle = decodeURIComponent(u.pathname) + (p.length ? "?" + p.map(([k, v]) => `${k}=${v}`).join("&") : "");
  if (u.pathname.endsWith("/comparer") && PARTAGE.comparer) return comparerPartage(u.searchParams.get("a") || "", u.searchParams.get("b") || "");
  if (u.pathname === "/api/recherche-cartes" && PARTAGE.cartes) {          // comme l'Atelier : {deck: 4 noms au plus}
    const q = sansAccent((u.searchParams.get("q") || "").trim()), res = {};
    if (q.length >= 3) for (const [id, l] of Object.entries(PARTAGE.cartes)) {
      const t = l.filter(([en, fr]) => sansAccent(en).includes(q) || sansAccent(fr).includes(q)).map(([en]) => en);
      if (t.length) res[id] = [...t.slice(0, 4), ...(t.length > 4 ? [`et ${t.length - 4} autres`] : [])];
    }
    return res;
  }
  if (!(cle in PARTAGE.api)) throw new Error("Indisponible sur cette page.");
  return structuredClone(PARTAGE.api[cle]);
}

// atelier-mtg.com (site_atelier.py) : la vraie recherche de cartes, celle de l'appli du téléphone (cartes.js, dans un
// Worker), avec la base publiée sur le site de l'appli (base_telephone.py, ≈ 10 Mo), pour recherche/ et le champ du haut.
// Téléchargée au premier geste sur recherche/, ou quand on clique dans le champ du haut de la page d'accueil (pas pour qui
// ne fait que passer), puis gardée par le navigateur tant qu'elle ne change pas.
const BASE_WEB = PARTAGE && PARTAGE.base ? (() => {
  const etat = { prete: false, date: null, nb: 0, construction: { actif: false, etape: "", fait: 0, total: 0, unite: "octets", erreur: "" } };
  let travailleur = null, enCours = null, num = 0;
  const reponses = new Map();
  function message(f, a = [], transfert = []) {
    if (!travailleur) {
      travailleur = new Worker(PARTAGE.moteur);
      travailleur.onmessage = (ev) => {
        const r = reponses.get(ev.data.id);
        if (!r) return;
        reponses.delete(ev.data.id);
        if ("e" in ev.data) r.ko(new Error(ev.data.e)); else r.ok(ev.data.r);
      };
      travailleur.onerror = (ev) => { for (const r of reponses.values()) r.ko(new Error(ev.message || "La base de cartes ne répond pas.")); reponses.clear(); };
    }
    return new Promise((ok, ko) => { const id = ++num; reponses.set(id, { ok, ko }); travailleur.postMessage({ id, f, a }, transfert); });
  }
  const garde = async () => { try { return await caches.open("atelier-base"); } catch (_) { return null; } };
  async function telecharger(idx, cache) {
    const c = etat.construction;
    Object.assign(c, { etape: "Téléchargement de la base de cartes", fait: 0, total: idx.taille });
    const r = await fetch(PARTAGE.base + idx.fichier);
    if (!r.ok) throw new Error(`La base de cartes ne répond pas (${r.status}).`);
    const lecteur = r.body.getReader(), morceaux = [];
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      morceaux.push(value);
      c.fait += value.length;
    }
    const blob = new Blob(morceaux);
    if (cache) {
      for (const k of await cache.keys()) await cache.delete(k).catch(() => {});
      await cache.put(idx.fichier, new Response(blob)).catch(() => {});
    }
    return blob.arrayBuffer();
  }
  // celle gardée par le navigateur si c'est encore la dernière (ou sans réseau), sinon la dernière
  function charger() {
    return enCours || (enCours = (async () => {
      const c = etat.construction;
      Object.assign(c, { actif: true, etape: "Recherche de la base de cartes", fait: 0, total: 0, erreur: "" });
      const cache = await garde(), gardee = cache ? (await cache.keys())[0] : null;
      let idx = null, donnees = null;
      try { idx = await (await fetch(PARTAGE.base + "index.json", { cache: "no-store" })).json(); } catch (e) { if (!gardee) throw e; }
      if (gardee && (!idx || gardee.url.endsWith("/" + idx.fichier))) donnees = await (await cache.match(gardee)).arrayBuffer();
      else donnees = await telecharger(idx, cache);
      Object.assign(c, { etape: "Lecture de la base de cartes", total: 0 });
      const r = await message("charger", [donnees], [donnees]);
      Object.assign(etat, { prete: true, date: r.date, nb: r.nb });
    })().catch((e) => {
      enCours = null;
      etat.construction.erreur = e instanceof TypeError ? "Pas de réseau : la base de cartes n'a pas pu arriver." : e.message;
      throw e;
    }).finally(() => Object.assign(etat.construction, { actif: false, etape: "" })));
  }
  const pret = () => {
    if (etat.prete) return;
    charger().catch(() => {});
    throw Object.assign(new Error("La base de cartes n'est pas encore prête."), { statut: 503 });
  };
  const demander = (f, ...a) => { pret(); return message(f, a); };
  if (location.protocol === "file:") { /* pas pendant le pré-rendu */ }
  else if (PARTAGE.page === "recherche") {
    garde().then((c) => c && c.keys()).then((k) => { if (k && k.length) charger().catch(() => {}); });
    const geste = () => { charger().catch(() => {}); for (const t of ["pointerdown", "keydown"]) removeEventListener(t, geste, true); };
    for (const t of ["pointerdown", "keydown"]) addEventListener(t, geste, true);
  } else document.getElementById("aller").addEventListener("focus", () => charger().catch(() => {}));      // page d'accueil
  return {
    routes: {
      "/api/recherche/base": (_, methode) => {                 // POST : « Relancer » après une erreur
        if (methode === "POST") etat.construction.erreur = "";
        if (!etat.prete && !enCours && !etat.construction.erreur) charger().catch(() => {});
        return structuredClone(etat);
      },
      "/api/recherche": async (q) => ({ ...(await demander("chercher", Object.fromEntries(q), {}, null)), base: structuredClone(etat) }),
      "/api/recherche/editions": () => demander("editions"),
      "/api/recherche/tags": (q) => demander("suggestions", q.get("q") || ""),
      "/api/recherche/noms": (q) => demander("noms", q.get("q") || "", {}, 8),
    },
  };
})() : null;

// comparaison de deux versions, comme /api/decks/…/comparer, à partir des listes figées
function comparerPartage(fa, fb, cmp = PARTAGE.comparer) {
  const { listes, infos } = cmp, A = listes[fa], B = listes[fb];
  if (!A || !B) throw new Error("Version introuvable.");
  const reste = (x, y) => Object.entries(x.cartes).flatMap(([n, k]) => Array(Math.max(0, k - (y.cartes[n] || 0))).fill(n)).sort();
  const sa = reste(A, B), sb = reste(B, A);
  const v = (x, f) => ({ fichier: f, nom: x.nom, total: x.total, prix: x.prix, gc: x.gc });
  return { a: v(A, fa), b: v(B, fb), seulement_a: sa, seulement_b: sb,
    communes: Object.entries(A.cartes).reduce((s, [n, k]) => s + Math.min(k, B.cartes[n] || 0), 0),
    infos: Object.fromEntries([...sa, ...sb].map((n) => [n, infos[n] || {}])) };
}

// lien vers un deck : sa page dans l'Atelier, ou sa page partagée depuis la racine du site
// page d'un deck partagé ; depuis a-propos/, un dossier plus bas que la racine du site
const lienDeck = (id) => (PARTAGE && PARTAGE.liens && PARTAGE.liens[id] ? (PARTAGE.page ? "../" : "") + PARTAGE.liens[id] : `#/deck/${enc(id)}`);

function euros(p) {
  return p == null ? "—" : p.toFixed(2).replace(".", ",") + " €";
}

function pct(x, dec = 1) {
  return x == null || Number.isNaN(x) ? "—" : (x * 100).toFixed(dec).replace(".", ",") + " %";
}

const virgule = (x, d = 1) => x.toFixed(d).replace(".", ",");

function mana(cout) {
  if (!cout) return `<span class="cout"></span>`;
  const syms = cout.match(/\{[^}]+\}/g) || [];
  return `<span class="cout">${syms.map((s) => {
    const c = s.slice(1, -1).replace("/", "");
    return `<img src="https://svgs.scryfall.io/card-symbols/${enc(c)}.svg" alt="${esc(s)}" title="${esc(s)}" loading="lazy">`;
  }).join("")}</span>`;
}

const symbole = (s) => `<img class="sym" src="https://svgs.scryfall.io/card-symbols/${s}.svg" alt="{${s}}" title="{${s}}">`;

// icônes au trait (24 × 24), couleur du texte ; dans le HTML fixe : data-ico="nom"
const POINT = (x, y) => `<circle cx="${x}" cy="${y}" r="1.25" fill="currentColor" stroke="none"/>`;
const ICONES = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  chercher: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  copier: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  plus_de: POINT(5, 12) + POINT(12, 12) + POINT(19, 12),
  liste: '<path d="M9 6h11M9 12h11M9 18h11"/>' + POINT(4.5, 6) + POINT(4.5, 12) + POINT(4.5, 18),
  stats: '<path d="M3 3v18h18"/><path d="M8 17v-4M13 17V8M18 17v-6"/>',
  combos: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  versions: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3 2"/>',
  bracket: '<path d="M12 21s7-3.3 7-9.2V5.6L12 3 5 5.6v6.2C5 17.7 12 21 12 21z"/>',
  simulation: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/>' + POINT(8.5, 8.5) + POINT(12, 12) + POINT(15.5, 15.5),
  rafraichir: '<path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.5"/><path d="M20 3.5v5h-5"/>',
  theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  discussion: '<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
  fermer: '<path d="M18 6 6 18M6 6l12 12"/>',
  maybe: '<path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M5.6 5h12.8L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"/>',
  annuler: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  couronne: '<path d="M3 7.5 7.5 12 12 5l4.5 7L21 7.5 19 19H5z"/>',
  corbeille: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  tag: '<path d="M3 4v7l9.5 9.5a1.5 1.5 0 0 0 2.1 0l5.9-5.9a1.5 1.5 0 0 0 0-2.1L11 3H4a1 1 0 0 0-1 1z"/>' + POINT(7.5, 7.5),
  panier: '<path d="M2.5 3h3l2.6 12.4a1.5 1.5 0 0 0 1.5 1.1h8.3a1.5 1.5 0 0 0 1.4-1.1L21.5 7H6.3"/><circle cx="9.5" cy="20" r="1.2"/><circle cx="17.5" cy="20" r="1.2"/>',
  livre: '<path d="M4 18V5a2 2 0 0 1 2-2h14v14H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14"/>',
  precedent: '<path d="m15 18-6-6 6-6"/>',
  suivant: '<path d="m9 18 6-6-6-6"/>',
  envoyer: '<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  lancer: '<path d="M7 4.5v15l12.5-7.5z"/>',
  arreter: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  enregistrer: '<path d="M6 3.5h12v17l-6-4-6 4z"/>',
  comparer: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  grille: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  cartes: '<rect x="8" y="3" width="12" height="16.5" rx="2"/><path d="M4.5 7v11.5a2.5 2.5 0 0 0 2.5 2.5h8"/>',
  crayon: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  effacer: '<path d="M20 20H9L4 15a2 2 0 0 1 0-2.8L13.2 3a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L11 19"/><path d="m8 9 7 7"/>',
  partager: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 13.3 7.6 4.4M15.8 6.3l-7.6 4.4"/>',
  compacter: '<path d="M4 14h6v6M20 10h-6V4"/><path d="m14 10 7-7M3 21l7-7"/>',
  ouvrir: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  telecharger: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  nuage: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  telephone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  imprimer: '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
  coche: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  moins: '<path d="M5 12h14"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7.5 9.5 3 2.5-3 2.5M13 15h4"/>',
  dossier: '<path d="M3.5 7a2 2 0 0 1 2-2h3.8l2 2.5h7.2a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  options: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
};
if (PARTAGE) $(".logo").href = PARTAGE.accueil === true ? "#/" : PARTAGE.accueil;
const ico = (nom) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nom] || ""}</svg>`;
$$("[data-ico]").forEach((el) => el.insertAdjacentHTML("afterbegin", ico(el.dataset.ico)));
// page partagée : à qui est la page, et l'Atelier à installer pour faire pareil avec ses decks (sauf sur la page
// d'accueil de l'Atelier, dont l'en-tête a déjà son bouton « Installer ») ; en bas, la licence, le code source et
// « C'est quoi, l'Atelier MTG ? » : la page d'accueil de l'Atelier, la même pour tous les sites de decks
const TITRE_PARTAGE = document.title;
const DOMAINE_ATELIER = "https://atelier-mtg.com/";                 // les images de la page d'accueil, à sa racine (a-propos/)
const ACCUEIL_ATELIER = DOMAINE_ATELIER + "fr/";                    // la page d'accueil, en français
const A_PROPOS = !PARTAGE ? "#/a-propos" : PARTAGE.page === "a-propos" ? "./" : PARTAGE.page === "recherche" ? "../" : ACCUEIL_ATELIER;
// pages du site de l'Atelier (site_atelier.py) : la page d'accueil et sa recherche de cartes
const SITE_ATELIER = !!PARTAGE && ["a-propos", "recherche"].includes(PARTAGE.page);
// « Installer l'Atelier MTG » : la section Installation de cette page, pas GitHub (un débutant y attend un fichier à
// télécharger, il y trouve du code)
const INSTALLER = !PARTAGE ? "#/a-propos/installation" : PARTAGE.page === "a-propos" ? "#installation" : A_PROPOS + "#installation";
if (PARTAGE) {
  const depot = PARTAGE.atelier ? esc(PARTAGE.atelier) : "";
  if (PARTAGE.recherche) $("#lien-recherche").href = PARTAGE.recherche;
  if (!SITE_ATELIER) $(".barre").insertAdjacentHTML("afterend", `<div class="bandeau-partage">
    <p>Page ${PARTAGE.auteur ? `de <strong>${esc(PARTAGE.auteur)}</strong>, ` : ""}partagée avec <a href="${A_PROPOS}">l'Atelier MTG</a>. Pour gérer, tester et partager vos propres decks Commander, l'Atelier est gratuit.</p>
    <a class="btn btn-accent btn-petit" href="${INSTALLER}">${ico("telecharger")}Installer l'Atelier MTG</a>
  </div>`);
  $(".cadre").insertAdjacentHTML("afterend", piedPartage(PARTAGE.page === "a-propos" ? "" : A_PROPOS, depot, SITE_ATELIER, PARTAGE.page === "recherche" ? "../" : ""));
}

// pied des pages partagées et de la page d'accueil de l'Atelier (site_atelier.py écrit le même sous ses pages légales) :
// la mention exigée par la Fan Content Policy de Wizards, telle quelle ; mentions légales et confidentialité sur la page
// d'accueil seulement (un site de decks est celui de son auteur)
function piedPartage(aPropos, depot, legal, racine = "") {
  return `<footer class="pied-partage">
    <nav>${aPropos ? `<a href="${aPropos}">C'est quoi, l'Atelier MTG ?</a>` : ""}${depot ? `<a href="${depot}" target="_blank" rel="noopener">Code source sur GitHub</a>
      <a href="${depot}/blob/main/LICENSE" target="_blank" rel="noopener">Licence MIT</a>` : ""}${legal ? `
      <a href="${racine}mentions-legales/">Mentions légales</a><a href="${racine}confidentialite/">Confidentialité</a>` : ""}</nav>
    <p lang="en">L'Atelier MTG is unofficial Fan Content permitted under the <a href="https://company.wizards.com/en/legal/fancontentpolicy" target="_blank" rel="noopener">Fan Content Policy</a>. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.</p>
    <p>Données des cartes : Scryfall.</p>
  </footer>`;
}

// hauteur de la barre du haut : les onglets d'un deck se collent juste dessous
const hauteurBarre = () => document.documentElement.style.setProperty("--haut-barre", $(".barre").offsetHeight + "px");
hauteurBarre();
addEventListener("resize", hauteurBarre);

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.minuteur);
  toast.minuteur = setTimeout(() => (t.hidden = true), ms);
}

function erreur(e) {
  console.error(e);
  toast("Erreur : " + (e.message || e), 5000);
}

// ------------------------------------------------------------------ thème
(function theme() {
  let t = null;
  try { t = localStorage.getItem("theme"); } catch (_) {}
  if (t) document.documentElement.dataset.theme = t;
  $("#btn-theme").addEventListener("click", () => {
    const sombre = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const nouveau = sombre ? "light" : "dark";
    document.documentElement.dataset.theme = nouveau;
    try { localStorage.setItem("theme", nouveau); } catch (_) {}
  });
})();

// ------------------------------------------------------------------ l'appli du téléphone : comme une appli
// En haut : le retour (ou le chaudron), le titre de l'écran, la recherche et « … » pour les actions de l'écran. En bas :
// les trois écrans principaux. Le « + » de l'écran flotte au-dessus. Le thème passe dans les Options.
ICONES.engrenage = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>';
ICONES.reglages = '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>';
const ECRANS_APPLI = [["", "Decks", "cartes"], ["classeur", "Classeur", "livre"], ["recherche", "Recherche", "chercher"], ["options", "Options", "engrenage"]];
if (TELEPHONE) {
  const barre = $(".barre"), champ = $("#aller");
  barre.insertAdjacentHTML("afterbegin", `<a id="app-retour" class="btn btn-discret btn-icone" aria-label="Retour" hidden>${ico("precedent")}</a>`);
  $(".logo", barre).insertAdjacentHTML("afterend", `<div id="app-titre" class="app-titre"></div>`);
  $(".barre-droite", barre).insertAdjacentHTML("beforeend",
    `<button type="button" id="app-chercher" class="btn btn-discret btn-icone" aria-label="Chercher une carte ou un deck">${ico("chercher")}</button>
     <button type="button" id="app-menu" class="btn btn-discret btn-icone ouvre-menu" aria-label="Autres actions" hidden>${ico("plus_de")}</button>`);
  $(".aller", barre).insertAdjacentHTML("afterbegin",
    `<button type="button" id="app-fin-recherche" class="btn btn-discret btn-icone" aria-label="Fermer la recherche">${ico("precedent")}</button>`);
  document.body.insertAdjacentHTML("beforeend", `<nav class="app-onglets" aria-label="Écrans">${ECRANS_APPLI.map(([k, l, i]) =>
    `<a href="#/${k}" data-ecran="${k}">${ico(i)}<span>${l}</span></a>`).join("")}</nav>`);
  // la recherche du haut prend toute la barre, ses résultats tout l'écran
  const finRecherche = () => { document.documentElement.classList.remove("app-recherche"); champ.blur(); };
  $("#app-chercher").onclick = () => { document.documentElement.classList.add("app-recherche"); champ.focus(); };
  $("#app-fin-recherche").onclick = () => { champ.value = ""; $("#aller-liste").hidden = true; finRecherche(); };
  champ.addEventListener("blur", () => { if (!champ.value) document.documentElement.classList.remove("app-recherche"); });
  addEventListener("hashchange", finRecherche);
  $("#app-menu").onclick = (ev) => { if (etat.menuEcran) ouvrirMenu(ev.currentTarget, etat.menuEcran()); };
  hauteurBarre();
}
// après chaque écran : son titre, le retour, ses actions, et l'onglet du bas allumé
function barreAppli(parts, qs) {
  if (!TELEPHONE) return;
  const deck = parts[0] === "deck" && parts[1], rd = parts[0] === "recherche" && new URLSearchParams(qs || "").get("deck");
  let titre = MES_DECKS, retour = null;
  etat.menuEcran = null;
  if (deck) {
    titre = etat.deck ? etat.deck.titre : decodeURIComponent(parts[1]).replace(/^Deck /, "");
    retour = "#/";
    if (etat.deck) etat.menuEcran = () => menuDeck(etat.deck);
  } else if (parts[0] === "recherche") {
    titre = "Recherche avancée";
    if (rd) retour = `#/deck/${enc(rd)}`;
  } else if (parts[0] === "options") titre = "Options";
  else if (parts[0] === "classeur") titre = "Classeur";
  else if (parts[0]) retour = "#/";
  else etat.menuEcran = () => [["Importer des decks…", modaleImportDecks, "", "dossier"], ["Demander à Claude", () => surPC("claude"), "", "discussion"]];
  $("#app-titre").textContent = titre;
  const r = $("#app-retour");
  r.hidden = !retour;
  if (retour) r.href = retour;
  $(".barre .logo").hidden = !!retour;
  $("#app-menu").hidden = !etat.menuEcran;
  const ecran = ["recherche", "options", "classeur"].includes(parts[0]) && !rd ? parts[0] : "";
  $$(".app-onglets a").forEach((a) => a.classList.toggle("actif", a.dataset.ecran === ecran));
}

// ------------------------------------------------------------------ aperçu d'une carte (image + prix) et infobulles au survol
let survol = null;

function majLegende() {
  const l = $("#apercu .legende");
  const t = survol ? survol.dataset.legende || "" : "";
  l.textContent = t;
  l.hidden = !t;
  l.classList.toggle("cher", !!survol && survol.dataset.cher === "1");
}

function cacherApercu() {
  $("#apercu").hidden = true;
  $("#bulle").hidden = true;
  $("#fiche-survol").hidden = true;
  survol = null;
  survolCarte = null;
}

// fiche texte au survol d'une image (vue Visuel), comme sur Magic-Ville : nom, type et texte en français, symboles de mana
let survolCarte = null;

// textes français de Scryfall : symboles collés ou entre parenthèses (« {2BB} », « {(u/p)} », « {(}b/r)} ») → {2}{B}{B}, {U/P}, {B/R}
const SYMBOLE = /^(\d+|[WUBRGCXYZSTQEPHDL½∞]|[WUBRGC2]\/[WUBRGCP](\/P)?|CHAOS|TK|PW|A)$/;
function symbolesTexte(s) {
  const t = s.toUpperCase().replace(/[()]/g, "");
  if (SYMBOLE.test(t)) return [t];
  const m = t.match(/\d+|[WUBRGCXYZS]\/[WUBRGCP](?:\/P)?|[WUBRGCXYZS]/g);
  return m && m.join("") === t ? m : [s];            // forme inconnue : laissée telle quelle
}

function normaliserSymboles(t) {
  return String(t ?? "")
    .replace(/\{\(\}([a-z])\/([a-z])\)\}/gi, "{$1/$2}")
    .replace(/\{([^}]+)\}/g, (_, s) => symbolesTexte(s).map((y) => `{${y}}`).join(""));
}

const urlSymbole = (y) => `https://svgs.scryfall.io/card-symbols/${enc(y === "½" ? "HALF" : y === "∞" ? "INFINITY" : y.replace(/\//g, ""))}.svg`;

function texteMana(ligne) {
  return esc(normaliserSymboles(ligne))
    .replace(/\(([^)]*)\)/g, '<i class="rappel">($1)</i>')                 // texte de rappel en italique
    .replace(/\{([^}]+)\}/g, (_, s) => `<img class="sym-t" src="${urlSymbole(s)}" alt="{${esc(s)}}">`);
}

// partout ailleurs (discussion avec Claude, combos, bulles, modales, rapports…) : chaque texte affiché est relu, et
// « {R}{W} », « {2BB} », « {T} » deviennent des symboles. Une accolade qui n'est pas un symbole reste du texte.
const JETON = /\{\(\}[a-z]\/[a-z]\)\}|\{[^{}\s]{1,9}\}/gi;
const SANS_SYMBOLES = "script, style, textarea, input, select, option, svg, [contenteditable], .brut";     // .brut : {c} à taper tel quel

function remplacerSymboles(n) {
  const t = n.nodeValue;
  let m, k = 0, frag = null;
  JETON.lastIndex = 0;
  while ((m = JETON.exec(t))) {
    const ys = (normaliserSymboles(m[0]).match(/\{[^}]+\}/g) || []).map((x) => x.slice(1, -1));
    if (!ys.length || !ys.every((y) => SYMBOLE.test(y))) continue;
    frag = frag || document.createDocumentFragment();
    frag.append(t.slice(k, m.index));
    for (const y of ys) {
      const img = document.createElement("img");
      img.className = "sym-t";
      img.src = urlSymbole(y);
      img.alt = `{${y}}`;
      frag.append(img);
    }
    k = m.index + m[0].length;
  }
  if (!frag) return;
  frag.append(t.slice(k));
  n.replaceWith(frag);
}

function symbolesDans(racine) {
  if (racine.nodeType === Node.TEXT_NODE) {
    const p = racine.parentElement;
    if (p && racine.nodeValue.includes("{") && !p.closest(SANS_SYMBOLES)) remplacerSymboles(racine);
    return;
  }
  if (racine.nodeType !== Node.ELEMENT_NODE || !racine.isConnected || !racine.textContent.includes("{") || racine.closest(SANS_SYMBOLES)) return;
  const w = document.createTreeWalker(racine, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.nodeType === Node.TEXT_NODE ? (n.nodeValue.includes("{") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
      : n.matches(SANS_SYMBOLES) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP,
  });
  const textes = [];
  while (w.nextNode()) textes.push(w.currentNode);
  textes.forEach(remplacerSymboles);
}

function ficheSurvol(c) {
  const f = c.info || {};
  const nom = f.fr || c.nom;
  const texte = f.fr_texte || f.texte || "";
  const cher = (f.prix || 0) > BUDGET;
  return `
    <div class="fs-tete"><span class="fs-nom">${esc(nom)}</span>${mana(f.cout)}</div>
    ${nom !== c.nom ? `<div class="fs-en">${esc(c.nom)}</div>` : ""}
    <div class="fs-type">${esc(f.fr_type || f.type || "")}${f.pt ? ` <span class="fs-pt">${esc(f.pt)}</span>` : ""}</div>
    ${texte ? `<div class="fs-texte">${texte.split("\n").map((l) => l.trim() === "//" ? "<hr>" : l.trim() ? `<p>${texteMana(l)}</p>` : "").join("")}</div>` : ""}
    <div class="fs-pied">
      <span class="${cher ? "cher" : ""}">${f.prix == null ? "prix inconnu" : euros(f.prix)}</span>${f.prix_edition ? `<span class="muet"> · ${esc(f.prix_edition)}</span>` : ""}
      ${f.gc ? `<span class="badge badge-gc">Game Changer</span>` : ""}${badgesAlerte(c)}
    </div>`;
}

// au doigt, pas d'aperçu « au survol » : le navigateur simule un survol à chaque toucher, et l'aperçu resterait affiché
// par-dessus la page. Un nom de carte cité dans un texte se touche pour voir la carte (plus bas)
let toucheA = 0;
addEventListener("touchstart", () => { toucheA = Date.now(); }, { passive: true, capture: true });
const auDoigt = () => Date.now() - toucheA < 1500;

document.addEventListener("mouseover", (ev) => {
  const el = ev.target.closest("[data-survol], [data-survol-r]");
  const fs = $("#fiche-survol");
  if (auDoigt()) { fs.hidden = true; survolCarte = null; return; }
  const c = !el ? null : el.dataset.survolR != null ? (rch.res && rch.res.cartes[+el.dataset.survolR] ? survolRecherche(rch.res.cartes[+el.dataset.survolR]) : null)
    : etat.deck && etat.deck.cartes[+el.dataset.survol];
  if (!c) { fs.hidden = true; survolCarte = null; return; }
  if (el !== survolCarte || fs.hidden) {
    survolCarte = el;
    fs.innerHTML = ficheSurvol(c);
    fs.hidden = false;
  }
});
document.addEventListener("mousemove", (ev) => {
  const fs = $("#fiche-survol");
  if (fs.hidden) return;
  const w = fs.offsetWidth, h = fs.offsetHeight;
  const x = ev.clientX + 18 + w > innerWidth - 8 ? ev.clientX - w - 18 : ev.clientX + 18;
  const y = ev.clientY + 18 + h > innerHeight - 8 ? ev.clientY - h - 12 : ev.clientY + 18;
  fs.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
  fs.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";        // entière à l'écran, quitte à passer sous la souris
});

const souris = { x: 0, y: 0 };

// l'image à côté de la souris, entière à l'écran (sa taille réelle : légende comprise, plus petite sur un écran bas)
function placerApercu() {
  const ap = $("#apercu"), w = ap.offsetWidth, h = ap.offsetHeight;
  const x = souris.x + 24 + w > innerWidth - 8 ? souris.x - 24 - w : souris.x + 24;
  ap.style.left = Math.max(8, x) + "px";
  ap.style.top = Math.max(8, Math.min(souris.y - 40, innerHeight - h - 8)) + "px";
}

function montrerApercu(el) {
  const ap = $("#apercu");
  survol = el;
  $("img", ap).src = el.dataset.image;
  majLegende();
  ap.hidden = false;
  placerApercu();
}

document.addEventListener("mouseover", (ev) => {
  const el = ev.target.closest("[data-image], [data-apercu]");
  const ap = $("#apercu");
  if (auDoigt()) { ap.hidden = true; survol = null; $("#bulle").hidden = true; return; }
  if (el && el.dataset.image == null) {          // carte citée : son image est cherchée au premier survol
    if (el !== survol) {
      survol = el;
      ap.hidden = true;
      apercuCite(el).then(() => { if (survol === el && el.dataset.image) montrerApercu(el); });
    }
  } else if (!el || !el.dataset.image) { ap.hidden = true; survol = null; }
  else if (el !== survol || ap.hidden) montrerApercu(el);
  const b = ev.target.closest("[data-bulle]");
  const bu = $("#bulle");
  if (!b || !b.dataset.bulle) bu.hidden = true;
  else { bu.textContent = b.dataset.bulle; bu.hidden = false; }
});
// au doigt : toucher un nom de carte cité montre la carte ; le toucher suivant, ailleurs, la cache (survol ci-dessus)
document.addEventListener("click", (ev) => {
  const el = auDoigt() && ev.target.closest(".nc[data-apercu]");
  if (!el || el.closest("a, button")) return;
  souris.x = ev.clientX;
  souris.y = ev.clientY;
  survol = el;
  (el.dataset.image ? Promise.resolve() : apercuCite(el)).then(() => { if (survol === el && el.dataset.image) montrerApercu(el); });
});
document.addEventListener("mousemove", (ev) => {
  souris.x = ev.clientX;
  souris.y = ev.clientY;
  const ap = $("#apercu");
  if (!ap.hidden) placerApercu();
  const bu = $("#bulle");
  if (!bu.hidden) {
    const w = bu.offsetWidth, h = bu.offsetHeight;
    const y = ev.clientY + 18 + h > innerHeight - 8 ? ev.clientY - h - 12 : ev.clientY + 18;
    bu.style.left = Math.max(8, Math.min(ev.clientX + 14, innerWidth - w - 8)) + "px";
    bu.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
  }
});

// ------------------------------------------------------------------ cartes citées : où qu'il soit, le nom d'une carte la montre au survol
// Les noms (anglais et français) viennent de la base de cartes ; chaque texte affiché est relu, et les noms trouvés sont
// entourés d'un <span class="nc" data-apercu="nom anglais">. L'image est demandée au premier survol.
const nc = (nom, texte = nom) => `<span class="nc" data-apercu="${esc(nom)}">${esc(texte)}</span>`;
const CITE = { cles: null, index: null, communs: null, deck: undefined, ctx: null };
const APERCUS = new Map();                         // nom anglais -> promesse de { nom, fr, image, prix, foil }
const minuscules = (s) => s.toLowerCase().replace(/[’‘]/g, "'");
const LETTRE = /[\p{L}\p{N}]/u;
const SANS_CITE = "script, style, textarea, input, select, option, code, pre, svg, h1, h2, summary, .fil, .nc, [data-apercu], [data-image], "
  + "[data-survol], [data-survol-r], .fs-texte, .texte, .fc-tete, .fiche, .moteur, #apercu, #bulle, #fiche-survol, #toast, #menu, [contenteditable], "
  + ".px-carte";                                     // les proxies s'impriment : pas de liens soulignés

function apercuCite(el) {
  const nom = el.dataset.apercu;
  const remplir = (f) => {
    if (f === undefined) return;                     // pas de réponse : on redemandera au prochain survol
    if (!f || !f.image) { el.dataset.image = ""; return; }
    const autre = sansAccent(el.textContent.trim()) === sansAccent(f.fr) ? f.nom : f.fr || f.nom;     // l'autre langue
    el.dataset.image = f.image;
    el.dataset.legende = `${autre} — ${prixRch(f)}`;
    if ((f.prix || 0) > BUDGET) el.dataset.cher = "1";
  };
  const c = etat.deck && etat.deck.cartes.find((x) => x.nom === nom);        // carte du deck : la version choisie
  if (c && c.info && c.info.image) { remplir({ nom: c.nom, fr: c.info.fr, image: c.info.image, prix: c.info.prix }); return Promise.resolve(); }
  if (!APERCUS.has(nom)) APERCUS.set(nom, api(`/api/apercu-carte?nom=${enc(nom)}`).catch(() => { APERCUS.delete(nom); }));
  return APERCUS.get(nom).then(remplir);
}

function indexerNom(cles, index, nom, en) {
  const k = minuscules(nom.trim());
  const m = k.match(/^[\p{L}\p{N}]+/u);
  if (k.length < 3 || !m || cles.has(k)) return;
  cles.set(k, en);
  if (!index.has(m[0])) index.set(m[0], []);
  index.get(m[0]).push(k.length);                  // premier mot -> longueurs des noms qui commencent par lui
}

function trierIndex(index) {
  for (const [k, l] of index) index.set(k, [...new Set(l)].sort((a, b) => b - a));
}

// le deck ouvert : ses cartes sont liées même quand leur nom est un mot courant, et ses légendes par leur nom court (« Kels »)
function contexteCite() {
  const d = etat.deck && etat.deck.id === cleCourante() ? etat.deck : null;
  if (CITE.deck !== d) {
    const cles = new Map(), index = new Map(), courts = new Map();
    for (const c of d ? d.cartes : []) {
      for (const n of [c.nom, c.info && c.info.fr]) {
        if (!n) continue;
        for (const a of [n, ...(n.includes(" // ") ? n.split(" // ") : [])]) {
          indexerNom(cles, index, a, c.nom);
          const court = a.split(", ")[0];
          if (court !== a) courts.set(court, courts.has(court) && courts.get(court) !== c.nom ? null : c.nom);
        }
      }
    }
    for (const [court, en] of courts) if (en && court.length >= 4) indexerNom(cles, index, court, en);
    trierIndex(index);
    CITE.deck = d;
    CITE.ctx = { cles, index };
  }
  return CITE.ctx;
}

// [début, longueur, nom anglais] des cartes citées dans un texte ; entier : le texte de l'élément en gras qui le contient
function citesDans(texte, entier) {
  const bas = minuscules(texte);
  if (bas.length !== texte.length) return [];
  const ctx = contexteCite(), res = [];
  const mots = /[\p{L}\p{N}]+/gu;
  let m;
  while ((m = mots.exec(bas))) {
    const i = m.index, a = ctx.index.get(m[0]), b = CITE.index.get(m[0]);
    for (const L of a && b ? [...a, ...b].sort((x, y) => y - x) : a || b || []) {
      if (i + L > bas.length || LETTRE.test(bas[i + L] || "")) continue;
      const k = bas.substr(i, L), du = ctx.cles.get(k), en = du || CITE.cles.get(k);
      if (!en) continue;
      const vu = texte.substr(i, L);
      if (!/\p{Lu}/u.test(vu)) continue;                                   // « fin vivante » au fil d'une phrase
      if (!du && CITE.communs.has(k) && vu !== entier) continue;           // « Sacrifice », « Flash » : mot courant
      res.push([i, L, en]);
      mots.lastIndex = i + L;
      break;
    }
  }
  return res;
}

function lierNoeud(n) {
  const t = n.nodeValue, p = n.parentElement;
  if (!p || t.length < 3 || !/\p{Lu}/u.test(t)) return;
  const ms = citesDans(t, /^(STRONG|B|EM)$/.test(p.tagName) ? p.textContent.trim() : null);
  if (!ms.length) return;
  const frag = document.createDocumentFragment();
  let k = 0;
  for (const [i, L, en] of ms) {
    if (i > k) frag.append(t.slice(k, i));
    const s = document.createElement("span");
    s.className = "nc";
    s.dataset.apercu = en;
    s.textContent = t.substr(i, L);
    frag.append(s);
    k = i + L;
  }
  if (k < t.length) frag.append(t.slice(k));
  n.replaceWith(frag);
}

function lierCites(racine) {
  if (!CITE.cles || !racine.isConnected) return;
  if (racine.nodeType === Node.TEXT_NODE) {
    if (racine.parentElement && !racine.parentElement.closest(SANS_CITE)) lierNoeud(racine);
    return;
  }
  if (racine.nodeType !== Node.ELEMENT_NODE || racine.closest(SANS_CITE)) return;
  const w = document.createTreeWalker(racine, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT
      : n.matches(SANS_CITE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP,
  });
  const textes = [];
  while (w.nextNode()) textes.push(w.currentNode);
  textes.forEach(lierNoeud);
}

const aLier = new Set();
const observateur = new MutationObserver((ms) => {
  for (const m of ms) {
    if (m.type === "characterData") aLier.add(m.target);
    else m.addedNodes.forEach((n) => aLier.add(n));
  }
  if (aLier.size && !lierCites.prevu) { lierCites.prevu = true; requestAnimationFrame(passeCites); }
});

function passeCites() {
  lierCites.prevu = false;
  const rs = [...aLier];
  aLier.clear();
  rs.forEach((r) => {
    const p = r.parentNode;
    symbolesDans(r);                               // d'abord les symboles de mana, puis les noms de cartes
    const q = r.isConnected ? r : p;               // texte remplacé par ses morceaux : on relit son parent
    if (q && q.isConnected) lierCites(q);
  });
  observateur.takeRecords();                       // les symboles et les noms qu'on vient de poser
}

async function chargerCites() {
  const r = await api("/api/noms-cartes").catch(() => null);
  if (!r || !(r.noms || []).length) { if (!PARTAGE) setTimeout(chargerCites, 3000); return; }      // base de cartes en construction
  const cles = new Map(), index = new Map();
  for (const [en] of r.noms) indexerNom(cles, index, en, en);
  for (const [en, fr] of r.noms) if (fr) indexerNom(cles, index, fr, en);
  for (const n of r.noms) for (const x of n) if (x.includes(" // ")) for (const f of x.split(" // ")) indexerNom(cles, index, f, n[0]);
  trierIndex(index);
  Object.assign(CITE, { cles, index, communs: new Set(r.communs) });
  lierCites(document.body);
  observateur.takeRecords();
}

observateur.observe(document.body, { childList: true, subtree: true, characterData: true });
symbolesDans(document.body);
chargerCites();

// ------------------------------------------------------------------ menu contextuel et modale
function ouvrirMenu(bouton, items, ev = null) {
  cacherApercu();                               // sinon l'image survolée recouvre le menu
  const m = $("#menu");
  m.innerHTML = "";
  for (const item of items) {
    if (!item || typeof item === "string") {
      m.insertAdjacentHTML("beforeend", item ? `<div class="menu-titre">${esc(item)}</div>` : `<hr class="menu-sep">`);
      continue;
    }
    const [libelle, action, classe, icone] = item;
    const b = document.createElement("button");
    b.innerHTML = (icone ? ico(icone) : "") + esc(libelle);
    if (classe) b.className = classe;
    b.addEventListener("click", () => { fermerMenu(); action(); });
    m.appendChild(b);
  }
  m.hidden = false;
  // toujours entier à l'écran : sous le bouton (ou la souris), sinon au-dessus, sinon le plus bas possible, par-dessus le
  // bouton ; plus haut que la fenêtre, il défile
  m.style.maxHeight = "";
  if (m.offsetHeight > innerHeight - 16) m.style.maxHeight = innerHeight - 16 + "px";
  const w = m.offsetWidth, hh = m.offsetHeight;
  const aLaSouris = ev && ev.clientX;            // clic sur une image : le menu s'ouvre à la souris
  const r = aLaSouris ? { right: ev.clientX + w, top: ev.clientY, bottom: ev.clientY } : bouton.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
  m.style.top = (r.bottom + 4 + hh <= innerHeight - 8 ? r.bottom + 4
    : r.top - hh - 4 >= 8 ? r.top - hh - 4 : Math.max(8, innerHeight - hh - 8)) + "px";
}
function fermerMenu() { $("#menu").hidden = true; }
document.addEventListener("click", (ev) => { if (!ev.target.closest("#menu, .btn-menu, .ouvre-menu")) fermerMenu(); });
// la page défile ou la fenêtre change de taille (autre écran) : le menu ne suivrait plus son bouton
addEventListener("resize", fermerMenu);
addEventListener("scroll", fermerMenu);

// au doigt, le bouton « retour » du téléphone ferme la fenêtre ouverte au lieu de quitter la page : chaque fenêtre ajoute
// une étape à l'historique, retirée quand on la ferme autrement (sauf si une autre page s'est ouverte entre-temps)
const RETOUR_FERME = matchMedia("(pointer: coarse)").matches;
// toutes les fenêtres se ferment par la croix en haut à droite (fermer : ce qu'elle fait, quand c'est plus que fermer)
function ouvrirModale(html, monte, { focus = true, large = false, fermer = null } = {}) {
  cacherApercu();
  fermerMenu();
  const m = $("#modale");
  m.innerHTML = `<div class="modale-boite ${large ? "large" : ""}" role="dialog" aria-modal="true" tabindex="-1">
    <button type="button" class="btn btn-discret btn-icone modale-fermer" aria-label="Fermer" title="Fermer">${ico("fermer")}</button>
    <div class="modale-corps">${html}</div></div>`;
  // ce qu'on fait (.modale-pied, ou la dernière rangée de boutons) : en bas de la fenêtre, toujours visible, séparé de ce
  // qu'on lit
  const corps = $(".modale-corps", m), dernier = corps.lastElementChild;
  const pied = $(":scope > .modale-pied", corps) || (dernier && dernier.matches(".boutons") ? dernier : null);
  if (pied) { pied.classList.add("modale-pied"); $(".modale-boite", m).appendChild(pied); }
  m.hidden = false;
  const ferme = () => (fermer ? fermer() : fermerModale());
  $(".modale-fermer", m).onclick = ferme;
  m.onclick = (ev) => { if (ev.target === m) ferme(); };
  if (monte) monte($(".modale-boite", m));
  const champ = focus && $("input, textarea", m);
  if (champ) champ.focus();
  else $(".modale-boite", m).focus({ preventScroll: true });
  if (RETOUR_FERME && !(history.state && history.state.modale)) history.pushState({ modale: true }, "");
}
function fermerModale(parRetour) {
  const ouverte = !$("#modale").hidden;
  $("#modale").hidden = true;
  $("#modale").innerHTML = "";
  cacherApercu();
  if (ouverte && parRetour !== true && history.state && history.state.modale) {
    const url = location.href;                     // après : une autre fenêtre ou une autre page a pu s'ouvrir
    setTimeout(() => { if ($("#modale").hidden && history.state && history.state.modale && location.href === url) history.back(); });
  }
}
// au doigt, sur un écran étroit, la fenêtre monte du bas : on la ferme aussi en la tirant vers le bas (par sa poignée,
// ou n'importe où quand son contenu est tout en haut)
(function tirerPourFermer() {
  const m = $("#modale");
  let depart = null, boite = null, dy = 0;
  m.addEventListener("touchstart", (ev) => {
    depart = null;
    boite = ev.target.closest(".modale-boite");
    if (!boite || ev.touches.length > 1 || !matchMedia("(max-width: 600px)").matches) return;
    const t = ev.touches[0], corps = $(".modale-corps", boite);
    if (t.clientY - boite.getBoundingClientRect().top > 48 && corps && corps.scrollTop > 0) return;
    if (ev.target.closest("input, textarea, select, [type=range]")) return;
    depart = { x: t.clientX, y: t.clientY };
    dy = 0;
  }, { passive: true });
  m.addEventListener("touchmove", (ev) => {
    if (!depart) return;
    const t = ev.touches[0], d = t.clientY - depart.y;
    if (!dy && (d < 8 || Math.abs(t.clientX - depart.x) > d)) { if (d < -4 || Math.abs(t.clientX - depart.x) > 8) depart = null; return; }
    dy = Math.max(0, d);
    boite.style.transition = "none";
    boite.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  m.addEventListener("touchend", () => {
    if (!depart || !boite) return;
    depart = null;
    if (dy > 110) { $(".modale-fermer", boite).click(); return; }
    boite.style.transition = "transform .15s ease-out";
    boite.style.transform = "";
  });
})();
// fiche d'une carte, au doigt : glisser vers la gauche ou la droite passe à la carte suivante ou précédente
(function glisserFiche() {
  const m = $("#modale");
  let x0 = null, y0 = 0;
  m.addEventListener("touchstart", (ev) => {
    x0 = ev.touches.length === 1 && $(".fiche-carte", m) && !ev.target.closest("input, textarea, select, .modale-pied") ? ev.touches[0].clientX : null;
    y0 = ev.touches[0].clientY;
  }, { passive: true });
  m.addEventListener("touchend", (ev) => {
    if (x0 == null) return;
    const t = ev.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) / 2) return;
    const b = $(`.fc-fleche[data-act="${dx < 0 ? "suiv" : "prec"}"]`, m);
    if (b && !b.hidden) b.click();
  });
})();
addEventListener("popstate", () => {
  if (!$("#modale").hidden) fermerModale(true);
  else if (history.state && history.state.modale) history.back();      // l'étape d'une fenêtre déjà fermée : on la passe
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { fermerModale(); fermerMenu(); } });

// ------------------------------------------------------------------ navigation
// titre de l'onglet du navigateur, la page d'abord : « Kels · Statistiques », « Recherche · « dragon » · Kels »
function majTitre() {
  if (PARTAGE) {                                   // page partagée : le titre écrit par partage.py
    document.title = location.hash.startsWith("#/a-propos") ? "L'Atelier MTG" : TITRE_PARTAGE;
    return;
  }
  const [chemin, qs] = location.hash.replace(/^#\/?/, "").split(/\?(.*)/s);
  const parts = chemin.split("/");
  let t = "Mes decks";
  if (parts[0] === "deck" && parts[1]) {
    const o = ONGLETS.find(([k]) => k === (parts[2] || "liste"));
    t = decodeURIComponent(parts[1]).replace(/^Deck /, "") + (o ? " · " + o[1] : "");
  } else if (parts[0] === "recherche") {
    const p = new URLSearchParams(qs || "");
    t = ["Recherche avancée", p.get("nom") && `« ${p.get("nom")} »`, (p.get("deck") || "").replace(/^Deck /, "")].filter(Boolean).join(" · ");
  } else if (parts[0] === "options" || parts[0] === "classeur") {
    t = parts[0] === "options" ? "Options" : "Classeur";
  } else if (parts[0] === "proxies") {
    t = "Proxies · " + (new URLSearchParams(qs || "").get("deck") || "").replace(/^Deck /, "");
  }
  document.title = t + " — Atelier MTG";
}

async function route() {
  fermerMenu();
  if (!$("#modale").hidden) fermerModale();
  cacherApercu();
  if (TELEPHONE) document.documentElement.classList.toggle("appli-prete", !!TELEPHONE.pret);
  if (TELEPHONE && !TELEPHONE.pret) return TELEPHONE.attente(vue);     // téléphone pas encore relié, ou decks en route
  majTitre();
  const [chemin, qs] = location.hash.replace(/^#\/?/, "").split(/\?(.*)/s);
  const parts = chemin.split("/");
  if (PARTAGE && PARTAGE.page === "recherche" && !parts[0]) parts[0] = "recherche";
  const ecran = parts[0] === "deck" ? "deck/" + parts[1] : parts[0];      // un autre écran s'ouvre en haut de page
  if (ecran !== etat.ecran) { etat.ecran = ecran; scrollTo(0, 0); }
  $("#lien-recherche").classList.toggle("actif", parts[0] === "recherche" && !new URLSearchParams(qs || "").get("deck"));   // pour un deck : son bandeau
  $("#lien-options").classList.toggle("actif", parts[0] === "options");
  $("#lien-classeur").classList.toggle("actif", parts[0] === "classeur");
  vue.classList.toggle("vue-large", ["recherche", "options", "classeur", "proxies"].includes(parts[0]));
  vue.classList.remove("vue-pleine");                       // la page « C'est quoi » la remet : son en-tête prend toute la largeur
  document.body.classList.toggle("impression", parts[0] === "proxies");   // à l'impression, rien d'autre que les feuilles
  try {
    if (PARTAGE && parts[0] === "a-propos" && PARTAGE.page !== "a-propos")                              // ancienne adresse
      location.replace(A_PROPOS + (parts[1] === "installation" ? "#installation" : ""));
    else if (parts[0] === "a-propos") vueAPropos(parts[1] === "installation");
    else if (PARTAGE && PARTAGE.page === "a-propos" && (!parts[0] || parts[0] === "installation")) vueAPropos(parts[0] === "installation");
    else if (PARTAGE && parts[0] === "recherche" && PARTAGE.recherche) location.replace(PARTAGE.recherche);   // page d'accueil
    else if (PARTAGE && parts[0] === "recherche" && !BASE_WEB) vueRechercheVitrine();
    else if (PARTAGE && PARTAGE.deck) await vueDeck(PARTAGE.deck, (parts[0] === "deck" && parts[2]) || "liste",
      parts[0] === "deck" && parts[2] === "suggestions" && parts[3] ? parts[3] : null);   // « Trouver d'autres combos »
    else if (PARTAGE && parts[0] === "deck" && parts[1]) location.replace(lienDeck(decodeURIComponent(parts[1])));
    else if (parts[0] === "recherche") await vueRecherche(new URLSearchParams(qs || ""));
    else if (!PARTAGE && parts[0] === "options") await vueOptions();
    else if (!PARTAGE && parts[0] === "classeur") await vueClasseur();
    else if (!PARTAGE && parts[0] === "proxies") await vueProxies(new URLSearchParams(qs || ""));
    else if (parts[0] === "deck" && parts[1]) await vueDeck(decodeURIComponent(parts[1]), parts[2] || "liste", parts[3] ? decodeURIComponent(parts[3]) : null);
    else await vueAccueil();
  } catch (e) {
    vue.innerHTML = `<p class="erreur">${esc(e.message || e)}</p>`;
  }
  majTitre();                                      // la vue a pu compléter l'adresse
  barreAppli(parts, qs);
}
window.addEventListener("hashchange", route);

// « Tymna the Weaver + Thrasios, Triton Hero » : les deux commandants d'un deck à partenaires
const nomsCommandants = (d) => ((d.commandants && d.commandants.length) ? d.commandants : d.commandant ? [d.commandant] : []).join(" + ");
const identiteHtml = (ident) => ident == null ? "" : (ident.length ? ident.map(symbole).join("") : symbole("C"));

// « récent » = liste modifiée récemment (ouvrir un deck sans le modifier ne le fait pas remonter)
const recence = (d) => (d.modifie || 0) * 1000;

async function listeDecks() {
  if (!etat.decks.length) etat.decks = await api("/api/decks");
  return etat.decks;
}

// ------------------------------------------------------------------ champ du haut (Ctrl+K) : une carte, comme sur Magic-Ville, ou un deck
// Le deck de la page (ou celui lié à la recherche) sert à marquer les cartes qu'il contient et à y ajouter la carte choisie.
function deckDeLaPage() {
  if (location.hash.startsWith("#/recherche")) return rch.deck || null;
  if (location.hash.startsWith("#/deck/") && etat.deck) return etat.deck;
  return null;
}

(function champDuHaut() {
  const champ = $("#aller"), liste = $("#aller-liste");
  let items = [], actif = 0, numero = 0, minuteur;
  const fermer = () => { liste.hidden = true; champ.value = ""; liste.innerHTML = ""; items = []; numero++; };
  const marque = () => $$(".aller-item", liste).forEach((el, i) => el.classList.toggle("choisi", i === actif));
  const tous = (q) => {
    const d = deckDeLaPage();
    return ((PARTAGE && PARTAGE.recherche) || "") + "#/recherche?" + new URLSearchParams({ nom: q, r: "1", ...(d ? { deck: d.id } : {}) });
  };
  const rendre = async () => {
    const k = ++numero;
    const brut = champ.value.trim(), q = sansAccent(brut);
    const deck = deckDeLaPage();
    const [ds, cartes] = await Promise.all([listeDecks(),
      q.length >= 2 ? api("/api/recherche/noms?q=" + enc(brut) + (deck ? "&deck=" + enc(deck.id) : "")).catch(() => []) : Promise.resolve([])]);
    // rien trouvé : la base de cartes est peut-être encore en construction (premier lancement), ou en route (site de l'Atelier)
    const base = q.length >= 2 && !cartes.length ? await api("/api/recherche/base").catch(() => null) : null;
    const enConstruction = !!base && !base.prete, cb = (base && base.construction) || {};
    if (k !== numero) return;
    const score = (d) => !q ? 0 : sansAccent(d.titre).startsWith(q) ? 0 : sansAccent(d.titre).includes(q) ? 1 : 2;
    const decksTrouves = ds.filter((d) => !q || sansAccent(`${d.titre} ${nomsCommandants(d)}`).includes(q))
      .sort((a, b) => score(a) - score(b) || recence(b) - recence(a) || a.titre.localeCompare(b.titre)).slice(0, q ? 4 : 10);
    items = [...cartes.map((c, i) => ({ carte: c, i, cartes })), ...decksTrouves.map((d) => ({ deck: d }))];
    actif = 0;
    const ligneCarte = (it, n) => {
      const c = it.carte, cher = (c.prix || 0) > BUDGET;
      return `<button type="button" class="aller-item aller-carte ${n === actif ? "choisi" : ""}" data-n="${n}" role="option"
          data-image="${esc(c.image)}" data-legende="${esc(`${c.fr || c.nom} — ${prixRch(c)}`)}" ${cher ? 'data-cher="1"' : ""}>
        <span class="aller-cout">${mana(c.cout)}</span>
        <span class="aller-nom">${esc(c.fr || c.nom)}${c.fr && c.fr !== c.nom ? ` <span class="aller-vo">${esc(c.nom)}</span>` : ""}</span>
        <span class="aller-cmd">${esc(c.type_fr || c.type)} · <span class="${cher ? "cher" : ""}">${prixRch(c)}</span>${c.dans ? ` · <span class="ok">${c.dans === "maybe" ? "au Maybeboard" : "dans le deck"}</span>` : ""}</span>
      </button>`;
    };
    const ligneDeck = (it, n) => `<a href="#/deck/${enc(it.deck.id)}" class="aller-item ${n === actif ? "choisi" : ""}" role="option" data-n="${n}">
        <span class="identite">${identiteHtml(it.deck.identite)}</span>
        <span class="aller-nom">${esc(it.deck.titre)}</span>
        <span class="aller-cmd">${esc(nomsCommandants(it.deck))}</span>
      </a>`;
    const nc = cartes.length;
    liste.innerHTML = (q.length >= 2 ? `<div class="aller-section">Cartes</div>` + (nc ? items.slice(0, nc).map(ligneCarte).join("")
        : enConstruction && BASE_WEB ? `<div class="aller-vide petit ${cb.erreur ? "erreur" : "pulse"}">${esc(cb.erreur
            || `La base de cartes arrive${cb.total ? ` (${Math.round((100 * cb.fait) / cb.total)} %)` : ""}…`)}</div>`
        : enConstruction ? `<div class="aller-vide petit">La base de cartes ${TELEPHONE ? "arrive" : "se construit"} : la recherche marchera quand elle sera prête.
            <a href="${esc(tous(brut))}">Voir l'avancement →</a></div>`
        : `<div class="aller-vide muet petit">Aucune carte.</div>`) : "")
      + (decksTrouves.length ? (q.length >= 2 ? `<div class="aller-section">Decks</div>` : "") + items.slice(nc).map((it, j) => ligneDeck(it, nc + j)).join("") : "")
      + (q.length >= 2 && !enConstruction ? `<div class="aller-pied petit"><a href="${esc(tous(brut))}">Toutes les cartes « ${esc(brut)} » →</a></div>` : "");
    liste.hidden = !liste.innerHTML;
    if (enConstruction && BASE_WEB && !cb.erreur) setTimeout(() => { if (k === numero && document.activeElement === champ) rendre(); }, 700);
    // plus large que le champ : sur un écran étroit, elle se décale vers la gauche pour ne pas dépasser à droite
    // (largeur de la page, pas innerWidth : sur téléphone, innerWidth grandit avec ce qui dépasse)
    liste.style.left = "";
    if (!liste.hidden) {
      const r = liste.getBoundingClientRect(), larg = document.documentElement.clientWidth;
      if (r.right > larg - 8) liste.style.left = Math.max(8 - r.left, larg - 8 - r.right) + "px";
    }
  };
  const choisir = (it) => {
    if (!it) return;
    if (it.deck) { location.hash = `#/deck/${enc(it.deck.id)}`; fermer(); champ.blur(); return; }
    fermer();
    champ.blur();
    const d = deckDeLaPage();
    ficheRecherche(it.i, { liste: it.cartes, deck: d });
  };
  champ.addEventListener("focus", rendre);
  champ.addEventListener("input", () => { clearTimeout(minuteur); minuteur = setTimeout(rendre, 120); });
  champ.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (items.length) { actif = (actif + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; marque(); }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (items[actif]) choisir(items[actif]);
      else if (champ.value.trim().length >= 2) { location.hash = tous(champ.value.trim()); fermer(); champ.blur(); }
    } else if (ev.key === "Escape") { fermer(); champ.blur(); }
  });
  liste.addEventListener("mousemove", (ev) => {
    const a = ev.target.closest(".aller-item");
    if (a && +a.dataset.n !== actif) { actif = +a.dataset.n; marque(); }
  });
  liste.addEventListener("mousedown", (ev) => { if (ev.target.closest("button.aller-item")) ev.preventDefault(); });
  liste.addEventListener("click", (ev) => {
    const b = ev.target.closest("button.aller-item");
    if (b) choisir(items[+b.dataset.n]);
  });
  document.addEventListener("click", (ev) => {
    if (ev.target.closest(".aller-liste a")) fermer();
    else if (!ev.target.closest(".aller")) liste.hidden = true;
  });
  document.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); champ.focus(); champ.select(); }
  });
})();

// ------------------------------------------------------------------ accueil
const TRIS_DECKS = {
  recent: (a, b) => recence(b) - recence(a) || a.titre.localeCompare(b.titre),
  nom: (a, b) => a.titre.localeCompare(b.titre),
  prix: (a, b) => b.prix_total - a.prix_total,
  gc: (a, b) => b.gc.length - a.gc.length || a.titre.localeCompare(b.titre),
};
const NOMS_COULEURS = { W: "blanc", U: "bleu", B: "noir", R: "rouge", G: "vert", C: "incolore" };

async function vueAccueil() {
  vue.innerHTML = `<p class="chargement">Chargement des decks…</p>`;
  const [ds, corbeille] = await Promise.all([api("/api/decks"), api("/api/corbeille")]);
  etat.decks = ds;
  etat.couleurs ||= [];
  const decksSupprimes = corbeille.length ? `
      <details class="panneau"><summary>Decks supprimés (${corbeille.length})</summary>
        <table class="tableau" style="margin-top:.6rem"><tbody>
          ${corbeille.map((c, i) => `<tr><td><strong>${esc(c.nom.replace(/^Deck /, ""))}</strong> <span class="muet petit">supprimé le ${esc(c.date)}</span></td>
            <td class="num"><button class="btn btn-petit" data-recup="${i}">${ico("annuler")}Récupérer</button></td></tr>`).join("")}
        </tbody></table>
      </details>` : "";
  if (!ds.length && (PC || (TELEPHONE && TELEPHONE.local))) {      // premier lancement, ou nouveau PC : les façons de commencer
    vue.innerHTML = `<div class="titre-page"><h1>${esc(MES_DECKS)}</h1></div>
      <div class="accueil-vide">
        <button type="button" class="av-choix" id="av-creer">${ico("plus")}<strong>Créer mon premier deck</strong>
          <span>À partir de son commandant, ou d'une liste copiée depuis Moxfield, Archidekt ou MTG Arena.</span></button>
        <button type="button" class="av-choix" id="av-recuperer">${ico("nuage")}<strong>Récupérer mes decks</strong>
          <span>Tu les as sauvegardés en ligne depuis ${AUTRE_APPAREIL}.</span></button>
        <button type="button" class="av-choix" id="av-importer">${ico("dossier")}<strong>Importer mes decks</strong>
          <span>Exportés de ManaBox, Moxfield, Archidekt… : un fichier par deck.</span></button>
      </div>${decksSupprimes}`;
    $("#av-creer").onclick = modaleNouveauDeck;
    $("#av-importer").onclick = modaleImportDecks;
    $("#av-recuperer").onclick = () => modaleSauvegarde("recuperer", () => route());
    brancherCorbeille(corbeille);
    return;
  }
  vue.innerHTML = `
    <div class="titre-page">
      <h1>${esc(MES_DECKS)}</h1>
      <span id="etat-sauvegarde"></span>
      <button class="btn btn-accent ecrit" id="btn-nouveau">${ico("plus")}Nouveau deck</button>
    </div>
    <div id="bandeau-sauvegarde"></div>
    <div class="barre-outils repliable ${(etat.couleurs || []).length ? "ouvert" : ""}">
      <input class="champ filtre" id="d-filtre" type="search" placeholder="Chercher un deck, un commandant ou une carte…" value="${esc(etat.filtreDecks || "")}" aria-label="Chercher un deck">
      <span class="outil pli"><span class="petit muet">Couleurs</span>
        <span class="choix-couleurs">${["W", "U", "B", "R", "G", "C"].map((x) => `<button type="button" class="couleur ${etat.couleurs.includes(x) ? "actif" : ""}"
          data-couleur="${x}" aria-pressed="${etat.couleurs.includes(x)}" title="${x === "C" ? "Decks incolores" : `Decks qui jouent le ${NOMS_COULEURS[x]}`}">${symbole(x)}</button>`).join("")}</span></span>
      <label class="outil pli petit muet">Trier par
        <select class="champ champ-petit" id="d-tri">${[["recent", "récents"], ["nom", "nom"], ["prix", "prix"], ["gc", "Game Changers"]].map(([v, l]) =>
          `<option value="${v}" ${PREF.get("tri-decks", "recent") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${segments("vue-decks", [["grille", "Grille", "grille"], ["liste", "Liste", "liste"]], "grille")}
      ${boutonPlis("Couleurs et tri", (etat.couleurs || []).length > 0)}
    </div>
    <div id="d-resultats"></div>
    ${decksSupprimes}`;
  $("#btn-nouveau").onclick = modaleNouveauDeck;
  if (PC || (TELEPHONE && TELEPHONE.local)) etatSauvegarde($("#etat-sauvegarde"), $("#bandeau-sauvegarde"));
  const zone = $("#d-resultats");
  let cartes = {}, numero = 0, minuteur;
  const rendre = () => rendreDecks(zone, cartes);
  const chercheCartes = async () => {           // « dans quel deck j'ai mis Sol Ring ? »
    const k = ++numero;
    const q = (etat.filtreDecks || "").trim();
    cartes = {};
    if (q.length >= 3) {
      try { const r = await api("/api/recherche-cartes?q=" + enc(q)); if (k === numero) cartes = r; } catch (_) {}
    }
    if (k === numero) rendre();
  };
  rendre();
  if ((etat.filtreDecks || "").trim().length >= 3) chercheCartes();
  $("#d-filtre").addEventListener("input", (ev) => {
    etat.filtreDecks = ev.target.value;
    rendre();
    clearTimeout(minuteur);
    minuteur = setTimeout(chercheCartes, 300);
  });
  $$(".couleur").forEach((b) => b.addEventListener("click", () => {
    const x = b.dataset.couleur;
    etat.couleurs = etat.couleurs.includes(x) ? etat.couleurs.filter((y) => y !== x) : [...etat.couleurs, x];
    b.classList.toggle("actif", etat.couleurs.includes(x));
    b.setAttribute("aria-pressed", etat.couleurs.includes(x));
    rendre();
  }));
  $("#d-tri").onchange = (ev) => { PREF.set("tri-decks", ev.target.value); rendre(); };
  $$(".barre-outils .segments button").forEach((b) => b.addEventListener("click", () => {
    PREF.set(b.dataset.pref, b.dataset.val);
    $$(".barre-outils .segments button").forEach((x) => { x.classList.toggle("actif", x === b); x.setAttribute("aria-pressed", x === b); });
    rendre();
  }));
  zone.addEventListener("click", (ev) => {        // une ligne du tableau entière ouvre le deck
    const tr = ev.target.closest("tr[data-deck]");
    if (tr && !ev.target.closest("a")) location.href = lienDeck(tr.dataset.deck);
  });
  brancherCorbeille(corbeille);
}

function brancherCorbeille(corbeille) {
  $$("[data-recup]").forEach((b) => b.addEventListener("click", async () => {
    try {
      const r = await api("/api/corbeille/recuperer", { method: "POST", body: { fichier: corbeille[+b.dataset.recup].fichier } });
      if (r.id) { toast("Deck récupéré."); location.hash = `#/deck/${enc(r.id)}`; }
      else { toast(r.message || "Deck récupéré.", 6000); b.disabled = true; }   // relié : il revient par le PC
    } catch (e) { erreur(e); }
  }));
}

// les chiffres d'un deck (accueil et en-tête du deck) ; le Maybeboard n'y figure pas
function chiffresDeck(d) {
  const complet = d.total === 100;
  const al = Object.entries(d.alertes || {});
  return `
    <span class="badge ${complet ? "badge-ok" : "badge-alerte"}" title="${d.total} cartes sur 100"><span class="chf-l">${d.total} / 100 cartes</span><span class="chf-c">${d.total}/100</span></span>
    <span class="badge">${euros(d.prix_total)}</span>
    ${d.bracket ? `<span class="badge badge-bracket" title="${esc((d.bracket_raisons || []).join("\n"))}">${ico("bracket")}Bracket ${d.bracket}</span>` : ""}
    <span class="badge ${d.gc.length ? "badge-gc" : ""}" title="${d.gc.length} Game Changer${d.gc.length > 1 ? "s" : ""}${d.gc.length ? " : " + esc(d.gc.join(", ")) : ""}"><span class="chf-l">${d.gc.length} Game Changer${d.gc.length > 1 ? "s" : ""}</span><span class="chf-c">${d.gc.length} GC</span></span>
    ${!d.commandant ? `<span class="badge badge-alerte">pas de commandant</span>` : ""}
    ${al.length ? `<span class="badge badge-alerte" title="${esc(al.map(([n, a]) => `${n} : ${a.join(", ")}`).join("\n"))}">${al.length} carte${al.length > 1 ? "s" : ""} hors règles</span>` : ""}`;
}

function contientHtml(noms) {
  return noms && noms.length ? `<div class="contient petit">contient ${noms.map((n) => `<strong>${nc(n)}</strong>`).join(", ")}</div>` : "";
}

function carteDeck(d, noms) {
  return `
    <a class="carte-deck" href="${esc(lienDeck(d.id))}">
      ${d.art ? `<img class="art" src="${esc(d.art)}" alt="" loading="lazy">` : `<div class="art"></div>`}
      <div class="corps">
        <div class="titre">${esc(d.titre)} <span class="identite">${identiteHtml(d.identite)}</span></div>
        <div class="muet petit">${esc(nomsCommandants(d) || "pas encore de commandant")}</div>
        <div class="chiffres">${chiffresDeck(d)}</div>
        ${d.note ? `<div class="petit muet">${esc(d.note)}</div>` : ""}
        ${contientHtml(noms)}
      </div>
    </a>`;
}

function dateCourte(s) {
  return s ? new Date(s * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

// liste des decks filtrée (nom, commandant, carte contenue, couleurs) et triée, en grille ou en tableau
function rendreDecks(zone, cartes) {
  const q = sansAccent((etat.filtreDecks || "").trim());
  const coul = etat.couleurs || [];
  const ds = etat.decks.filter((d) => {
    const ident = d.identite || [];
    if (coul.includes("C") ? ident.length > 0 : !coul.every((x) => ident.includes(x))) return false;
    return !q || sansAccent(`${d.titre} ${nomsCommandants(d)}`).includes(q) || cartes[d.id];
  }).sort(TRIS_DECKS[PREF.get("tri-decks", "recent")] || TRIS_DECKS.recent);
  if (!etat.decks.length) { zone.innerHTML = `<p class="muet">Aucun deck.</p>`; return; }
  if (!ds.length) { zone.innerHTML = `<p class="muet">Aucun deck ne correspond.</p>`; return; }
  const noms = (d) => sansAccent(`${d.titre} ${nomsCommandants(d)}`).includes(q) ? null : cartes[d.id];
  if (PREF.get("vue-decks", "grille") === "liste") {
    zone.innerHTML = `<table class="tableau tableau-decks">
      <thead><tr><th>Deck</th><th>Couleurs</th><th class="num">Cartes</th><th class="num">Prix</th><th class="num">Bracket</th><th class="num">Game Changers</th><th class="num">Modifié</th></tr></thead>
      <tbody>${ds.map((d) => `<tr data-deck="${esc(d.id)}">
        <td><a href="${esc(lienDeck(d.id))}"><strong>${esc(d.titre)}</strong></a><div class="muet petit">${esc(nomsCommandants(d) || "pas encore de commandant")}</div>${contientHtml(noms(d))}</td>
        <td><span class="identite">${identiteHtml(d.identite)}</span></td>
        <td class="num ${d.total === 100 ? "" : "alerte-texte"}">${d.total}</td>
        <td class="num">${euros(d.prix_total)}</td>
        <td class="num" title="${esc((d.bracket_raisons || []).join("\n"))}">${d.bracket || ""}</td>
        <td class="num">${d.gc.length || ""}</td>
        <td class="num muet">${dateCourte(d.modifie)}</td></tr>`).join("")}</tbody></table>`;
  } else {
    zone.innerHTML = `<div class="grille-decks">${ds.map((d) => carteDeck(d, noms(d))).join("")}</div>`;
  }
}

function modaleNouveauDeck() {
  let cmd = null, rech = null;
  ouvrirModale(`
    <h2>Nouveau deck</h2>
    <label class="bloc">Nom du deck<input class="champ" id="nd-nom" maxlength="60"></label>
    <div class="bloc"><div>Commandant</div>
      <div id="nd-cmd"></div><div id="nd-rech"></div></div>
    <details class="bloc"><summary>Coller une liste</summary>
      <textarea class="champ" id="nd-liste" rows="8" placeholder="1x Sol Ring [Ramp]&#10;1 Arcane Signet&#10;10 Mountain&#10;…"></textarea>
    </details>
    <div class="boutons"><button class="btn btn-discret a-gauche" id="nd-importer">${ico("dossier")}Importer des fichiers…</button>
      <button class="btn btn-accent" id="ok">Créer le deck</button></div>`, (b) => {
    $("#nd-importer", b).onclick = modaleImportDecks;
    const montreCmd = () => {
      $("#nd-cmd", b).innerHTML = cmd ? `
        <div class="cmd-choisi">
          <img src="${esc(cmd.image)}" alt="" data-image="${esc(cmd.image)}">
          <div><strong>${esc(cmd.fr || cmd.nom)}</strong> ${mana(cmd.cout)}${cmd.fr && cmd.fr !== cmd.nom ? `<div class="muet petit">${esc(cmd.nom)}</div>` : ""}
            <div class="muet petit">${esc(cmd.type_fr || cmd.type || "")}</div></div>
          <button class="btn btn-petit" id="nd-autre">Changer</button>
        </div>` : "";
      $("#nd-rech", b).hidden = !!cmd;
      if (cmd) $("#nd-autre", b).onclick = () => { cmd = null; montreCmd(); rech.vider(); };
    };
    rech = rechercheCarte($("#nd-rech", b), { deck: () => null,
      surChoix: (x) => { cmd = x; montreCmd(); } });
    $("#ok", b).onclick = async () => {
      const ok = $("#ok", b);
      try {
        ok.disabled = true;
        ok.textContent = "Création…";
        const r = await api("/api/decks", { method: "POST", body: { nom: $("#nd-nom", b).value, commandant: cmd ? cmd.nom : "", liste: $("#nd-liste", b).value } });
        fermerModale();
        etat.decks = await api("/api/decks");
        location.hash = `#/deck/${enc(r.id)}`;
        toast("Deck créé.");
      } catch (e) {
        erreur(e);
        ok.disabled = false;
        ok.textContent = "Créer le deck";
      }
    };
  });
}

// plusieurs decks d'un coup, exportés d'une autre appli (ManaBox, Moxfield, Archidekt…) : un fichier par deck, qui lui
// donne son nom. Déjà montés (coché) : leurs cartes sont notées comme là, dans l'onglet Achats.
function modaleImportDecks() {
  ouvrirModale(`
    <h2>Importer des decks</h2>
    <label class="import-zone"><input type="file" class="fichier-cache" id="im-fichiers" multiple accept=".txt,.csv,text/plain,text/csv">
      ${ico("dossier")}<span id="im-choix">Choisir les fichiers (.txt ou .csv, un par deck)</span></label>
    <label class="petit"><input type="checkbox" id="im-montes" checked> Decks déjà montés</label>
    <div id="im-res"></div>
    <div class="boutons"><button class="btn btn-accent" id="ok" disabled>Importer</button></div>`, (b) => {
    let fichiers = [];
    const ok = $("#ok", b);
    $("#im-fichiers", b).onchange = async (ev) => {
      fichiers = await Promise.all([...ev.target.files].map(async (f) => ({ nom: f.name, texte: await f.text() })));
      $("#im-choix", b).textContent = fichiers.length
        ? `${fichiers.length} fichier${fichiers.length > 1 ? "s" : ""} : ${fichiers.map((f) => f.nom).join(", ")}`
        : "Choisir les fichiers (.txt ou .csv, un par deck)";
      ok.disabled = !fichiers.length;
    };
    ok.onclick = async () => {
      ok.disabled = true;
      ok.textContent = "Import…";
      try {
        const r = await api("/api/decks/importer", { method: "POST", body: { fichiers, montes: $("#im-montes", b).checked } });
        etat.decks = await api("/api/decks");
        const fini = () => {
          fermerModale();
          if (r.decks.length === 1) location.hash = `#/deck/${enc(r.decks[0])}`;
          else if (location.hash.replace(/^#\/?/, "")) location.hash = "#/";
          else route();
        };
        if (!r.echecs.length) {
          fini();
          return toast(`${r.decks.length} deck${r.decks.length > 1 ? "s" : ""} importé${r.decks.length > 1 ? "s" : ""}.`);
        }
        $("#im-res", b).innerHTML = `<p class="petit">${r.decks.length} deck${r.decks.length > 1 ? "s" : ""} importé${r.decks.length > 1 ? "s" : ""}. Pas importés :</p>
          <ul class="petit">${r.echecs.map((x) => `<li>${esc(x.nom)} : ${esc(x.erreur)}</li>`).join("")}</ul>`;
        ok.disabled = false;
        ok.textContent = "OK";
        ok.onclick = fini;
      } catch (e) {
        erreur(e);
        ok.disabled = false;
        ok.textContent = "Importer";
      }
    };
  });
}

// ------------------------------------------------------------------ page d'un deck
const ONGLETS = [["liste", "Liste"], ["suggestions", "Suggestions"],      // en page partagée : figées, sans le classeur
  ["stats", "Statistiques"], ["combos", "Combos"], ["versions", "Versions"], ["bracket", "Bracket"], ["simulation", "Simulation"],
  ...(PARTAGE ? [] : [["achats", "Achats"]])];                    // ce que j'ai et ce qu'il me manque : reste sur ce PC
ICONES.achats = ICONES.panier;

async function vueDeck(id, onglet, extra = null, donnees = null) {
  if (!etat.deck || etat.deck.id !== id) {
    vue.innerHTML = `<p class="chargement">Chargement du deck…</p>`;
    etat.filtre = "";
  }
  const d = donnees || await api("/api/decks/" + enc(id));
  etat.deck = d;
  const cmdsEntete = d.cartes.filter((c) => c.cat === "Commander" && c.info.image);      // deux partenaires : en éventail
  vue.innerHTML = `
    <nav class="fil" aria-label="Fil d'Ariane"><a href="${PARTAGE ? esc(PARTAGE.accueil) : "#/"}">${esc(MES_DECKS)}</a><span aria-hidden="true">›</span><span aria-current="page">${esc(d.titre)}</span></nav>
    <div class="entete-deck ${cmdsEntete.length ? "avec-cmd" : ""} ${cmdsEntete.length > 1 ? "duo" : ""}">
      <div class="bandeau" style="background-image:url('${esc(d.art)}')"></div>
      ${cmdsEntete.length ? `<div class="cmds-entete">${cmdsEntete.map((c) =>
        `<button type="button" class="cmd-entete" data-carte="${c.index}" aria-label="${esc(c.nom)} : fiche et actions"><img src="${esc(c.info.image)}" alt=""></button>`).join("")}</div>` : ""}
      <div class="infos">
        <div>
          <h1>${esc(d.titre)}</h1>
          <div class="muet"><span data-image="${esc(d.image_cmd)}">${esc(nomsCommandants(d) || "pas encore de commandant")}</span>
            ${d.identite ? `<span class="identite">${d.identite.length ? d.identite.map(symbole).join("") : symbole("C")}</span>` : ""}</div>
          <div class="chiffres" style="margin-top:.5rem">${chiffresDeck(d)}</div>
        </div>
        <div class="actions">
          <a class="btn" data-pc="jouer" href="${PARTAGE ? "jouer/" : `/jouer?deck=${enc(id)}`}" target="_blank" rel="noopener">${ico("lancer")}Jouer</a>
          <a class="btn ecrit" href="#/recherche?deck=${enc(id)}">${ico("chercher")}Chercher pour ce deck</a>
          <button class="btn btn-icone ouvre-menu" id="btn-deck-menu" aria-label="Autres actions sur le deck" title="Autres actions">${ico("plus_de")}</button>
        </div>
      </div>
    </div>
    ${d.note ? `<p class="note">${esc(d.note)}</p>` : ""}
    <div class="onglets-deck">
      <nav class="onglets">${ONGLETS.map(([k, l]) => `<a href="#/deck/${enc(id)}/${k}" class="${k === onglet ? "actif" : ""}">${ico(k)}${l}</a>`).join("")}</nav>
      <button class="btn btn-accent ecrit" id="btn-ajouter" title="Ajouter des cartes">${ico("plus")}<span class="txt">Ajouter des cartes</span></button>
    </div>
    <section id="contenu"></section>`;
  $("#btn-ajouter").onclick = () => modaleAjout();
  const actif = $(".onglets a.actif");                // l'onglet ouvert, en vue dans la barre qui défile (téléphone)
  if (actif) { const n = actif.parentElement; n.scrollLeft += actif.getBoundingClientRect().left - n.getBoundingClientRect().left - (n.clientWidth - actif.offsetWidth) / 2; }
  $$(".cmd-entete").forEach((x) => { x.onclick = () => ouvrirCarte(d.cartes[+x.dataset.carte]); });
  $("#btn-deck-menu").onclick = (ev) => ouvrirMenu(ev.currentTarget, menuDeck(d));
  const contenu = $("#contenu");
  if (onglet === "stats") return ongletStats(contenu, d);
  if (onglet === "bracket") return ongletBracket(contenu, d);
  if (onglet === "combos") return ongletCombos(contenu, d, extra);
  if (onglet === "simulation") return ongletSimulation(contenu, d, extra);
  if (onglet === "versions" || onglet === "historique") return ongletVersions(contenu, d);
  if (onglet === "achats" && !PARTAGE) return ongletAchats(contenu, d);
  if (onglet === "suggestions") return ongletSuggestions(contenu, d, extra);
  ongletListe(contenu, d);
}

// les actions sur le deck ; dans l'appli du téléphone, aussi celles des boutons de l'en-tête (la barre du haut les remplace)
function menuDeck(d) {
  const copier = ["Copier la liste pour", ...EXPORTS.map(([fmt, lib]) => [lib, () => copierListe(fmt, lib), "", "copier"]),
    ...(PARTAGE ? [] : [["Cardmarket (à acheter)", () => copierCardmarket(d), "", "panier"]])];
  return [
    ...(TELEPHONE ? [["Chercher pour ce deck", () => { location.hash = `#/recherche?deck=${enc(d.id)}`; }, "", "chercher"],
      ["Jouer", () => surPC("jouer"), "", "lancer"], ["Demander à Claude", () => surPC("claude"), "", "discussion"], null] : []),
    ...(PARTAGEABLE ? [["Partager le deck…", () => modalePartage(d), "", "partager"]] : []),
    ...(PARTAGE ? [] : [["Imprimer les proxies…", () => { if (TELEPHONE) surPC("proxies"); else location.hash = `#/proxies?deck=${enc(d.id)}`; }, "", "imprimer"]]),
    ...(PARTAGEABLE ? [null] : []),
    // sur le téléphone, les formats dans un second menu : le premier tient à l'écran
    ...(TELEPHONE ? [["Copier la liste…", () => setTimeout(() => ouvrirMenu($("#app-menu"), copier)), "", "copier"]] : copier),
    ...(PARTAGE ? [] : [null, ["Renommer…", () => modaleRenommer(d), "", "crayon"], ["Supprimer ce deck…", () => supprimerDeck(d), "btn-danger", "corbeille"]]),
  ];
}

const EXPORTS = [["archidekt", "Archidekt"], ["moxfield", "Moxfield"], ["arena", "MTG Arena"], ["mtgo", "MTGO"],
  ["simple", "Liste simple"], ["fr", "Liste en français"]];

async function copierListe(fmt, lib) {
  try {
    const txt = await api(`/api/decks/${enc(etat.deck.id)}/export?format=${fmt}`);
    await navigator.clipboard.writeText(txt);
    toast(`Liste copiée : ${lib}.`);
  } catch (e) { erreur(e); }
}

// ------------------------------------------------------------------ suggestions : cartes à proposer pour le deck (suggestions.py)
// thème du deck, combos à une carte près, classeur ; présentées comme les résultats de la recherche,
// avec une colonne Intérêt (un clic sur un en-tête trie, un second inverse), en liste ou en images
ICONES.suggestions = '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/>';
// le classeur reste sur ce PC : pas de groupe Classeur dans une page partagée
const GROUPES_SUGG = [["theme", "Thème"], ["combos", "Combos"], ...(PARTAGE ? [] : [["classeur", "Classeur"]]), ["tout", "Tout"]];
const COLONNES_SUGG = [["couleur", "Coul."], ["nom", "Nom VO"], ["nomfr", "Nom VF"], ["type", "Type"], ["ccm", "Coût"], ["note", "Intérêt"], ["prix", "Prix"]];
const TRI_SUGG_DESC = { note: true };                      // sens naturel : les plus intéressantes d'abord
const TRI_SUGG = {
  nom: () => 0,                                            // le nom départage toujours
  nomfr: (a, b) => sansAccent(a.fr || a.nom).localeCompare(sansAccent(b.fr || b.nom)),
  couleur: (a, b) => cmpListes(cleCouleur(a), cleCouleur(b)) || (a.mv || 0) - (b.mv || 0),
  ccm: (a, b) => (a.mv || 0) - (b.mv || 0),
  type: (a, b) => ORDRE_TYPES.indexOf(typeCarte(a.type)) - ORDRE_TYPES.indexOf(typeCarte(b.type)) || (a.mv || 0) - (b.mv || 0),
  note: (a, b) => a.note - b.note,
  prix: (a, b) => (a.prix ?? -1) - (b.prix ?? -1),
};

// l'intérêt de la carte pour le deck, de 1 à 5 traits
const jaugeSugg = (note) => {
  const n = Math.max(1, Math.round(note * 5));
  return `<span class="sg-jauge" role="img" aria-label="Intérêt : ${n} sur 5">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= n ? "plein" : ""}"></i>`).join("")}</span>`;
};

const badgesSugg = (x, d) => badgesRch(x, d);

function actionsSugg(x, images = false) {                  // en images : « Écarter » en icône, pour tenir sous la carte
  if (x.dans === "deck") return `<span class="badge badge-ok">✓ dans le deck</span>`;
  if (PARTAGE) return x.dans === "maybe" ? `<span class="badge">Maybeboard</span>` : "";       // page partagée : à lire seulement
  return `${x.dans === "maybe" ? `<span class="badge">Maybeboard</span>` : ""}
    <button type="button" class="btn btn-petit" data-act="ajouter" title="Ajouter au deck">${ico("plus")}Deck</button>
    ${x.dans === "maybe" ? "" : `<button type="button" class="btn btn-petit btn-discret" data-act="maybe" title="Ajouter au Maybeboard">${ico("maybe")}Maybe</button>`}
    <button type="button" class="btn btn-petit btn-discret ${images ? "btn-icone" : ""}" data-act="ecarter" title="Ne plus proposer" ${images ? 'aria-label="Écarter"' : ""}>${ico("fermer")}${images ? "" : "Écarter"}</button>`;
}

// la seule étiquette d'une suggestion : « Combo avec … » (Commander Spellbook), qui déplie l'explication de la combo
function comboSugg(x) {
  const combos = x.combos || [];
  if (!combos.length) return "";
  const autres = combos[0].cartes.filter((n) => !combos[0].manque.includes(n));
  const titre = `Combo avec ${esc(autres.join(" + "))}${combos.length > 1 ? ` (+${combos.length - 1})` : ""}`;
  if (!combos.some((c) => c.description)) return `<div class="sg-combo"><span class="sg-puce">${titre}</span></div>`;
  return `<details class="sg-combo"><summary class="sg-puce">${titre}</summary>${combos.map((c) => `<div class="sg-combo-bloc">
    <div><strong>${c.cartes.map((n) => nc(n)).join(" + ")}</strong>
      ${c.tag ? `<span class="badge">${esc(c.tag)}${c.bracket ? ` · bracket ${c.bracket}` : ""}</span>` : ""}</div>
    ${c.produit.length ? `<div class="petit muet">${c.produit.map(esc).join(" · ")}</div>` : ""}
    ${detailsCombo(c)}</div>`).join("")}</details>`;
}

function ligneSugg(x, i, d) {
  const cher = (x.prix || 0) > BUDGET;
  const apercu = `data-image="${esc(x.image)}" data-legende="${esc(`${x.fr || x.nom} — ${prixRch(x)}`)}" ${cher ? 'data-cher="1"' : ""}`;
  const texte = (x.texte_fr || x.texte || "").split("\n").map((l) => l.trim() === "//" ? "<hr>" : l.trim() ? `<p>${texteMana(l)}</p>` : "").join("");
  const badges = badgesSugg(x, d);
  return `<article class="rch-carte" data-i="${i}">
    <button type="button" class="rch-vignette" data-act="ouvrir" ${apercu} aria-label="Fiche de ${esc(x.nom)}">
      ${x.petite ? `<img src="${esc(x.petite)}" alt="" loading="lazy">` : `<span class="sans-image">${esc(x.nom)}</span>`}</button>
    <div class="rch-vo"><button type="button" class="rch-nom" data-act="ouvrir" ${apercu}>${esc(x.nom)}</button></div>
    <div class="rch-vf">${x.fr && x.fr !== x.nom ? `<button type="button" class="rch-nom" data-act="ouvrir" ${apercu}>${esc(x.fr)}</button>` : ""}</div>
    <div class="rch-typecourt">${esc(TYPE_COURT[typeCarte(x.type)] || "")}</div>
    <div class="rch-cm">${mana(x.cout)}</div>
    <div class="sg-note">${jaugeSugg(x.note)}</div>
    <div class="rch-prix">
      <a class="prix ${cher ? "cher" : ""}" href="${esc(lienCardmarket(x.nom))}" target="_blank" rel="noopener" title="Cardmarket">${prixRch(x)}</a>
      ${badges ? `<span class="rch-badges">${badges}</span>` : ""}
      <span class="rch-actions">${actionsSugg(x)}</span>
    </div>
    <div class="rch-detail">
      ${comboSugg(x)}
      <div class="rch-type">${esc(x.type_fr || x.type || "")}</div>
      ${texte ? `<div class="rch-texte fs-texte">${texte}</div>` : ""}
      ${x.pt ? `<div class="rch-pt">${esc(x.pt.replace(/loyauté (\S+)/g, "Loy. $1"))}</div>` : ""}
    </div>
  </article>`;
}

function carteImageSugg(x, i) {
  const cher = (x.prix || 0) > BUDGET;
  const marques = [
    x.gc ? `<span class="marque marque-gc" title="Game Changer">GC</span>` : "",
    x.classeur ? `<span class="marque marque-ok">classeur</span>` : "",
    x.dans === "deck" ? `<span class="marque marque-ok">✓ deck</span>` : x.dans === "maybe" ? `<span class="marque marque-maybe">maybe</span>` : "",
  ].join("");
  return `<div class="carte-v rch-carte-v" data-i="${i}">
    <button type="button" class="pile" data-act="ouvrir" aria-label="${esc(x.nom)} : fiche">${imageCarte({ petite: x.petite, image: x.image, nom: x.nom }, "recto")}${marques ? `<span class="marques">${marques}</span>` : ""}</button>
    <div class="legende-v"><span class="nom-v" title="${esc(x.nom + (x.fr && x.fr !== x.nom ? " — " + x.fr : ""))}">${esc(x.fr || x.nom)}</span><span class="prix-v ${cher ? "cher" : ""}">${prixRch(x)}</span></div>
    ${x.dans === "deck" || PARTAGE ? "" : `<div class="rch-actions-v">${actionsSugg(x, true)}</div>`}
  </div>`;
}

// filtres de l'onglet, cumulables entre eux et avec le groupe : texte, type, fonction, coût, prix maximum
const TYPES_SUGG = [["Creature", "Créatures"], ["Planeswalker", "Planeswalkers"], ["Instant", "Éphémères"], ["Sorcery", "Rituels"],
  ["Artifact", "Artefacts"], ["Enchantment", "Enchantements"], ["Battle", "Batailles"]];
const COUTS_SUGG = [["0-1", "0 ou 1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6+", "6 et plus"]];
const FILTRES_SUGG_VIDES = { q: "", type: "", fn: "", mv: "", prix: "" };

function passeFiltresSugg(x, f) {
  if (f.type && !(x.type || "").includes(f.type)) return false;
  if (f.fn && !(x.fonctions || []).includes(f.fn)) return false;
  if (f.mv) {
    const mv = x.mv || 0;
    if (f.mv === "0-1" ? mv > 1 : f.mv === "6+" ? mv < 6 : mv !== +f.mv) return false;
  }
  const pmax = parseFloat(String(f.prix).replace(",", "."));
  if (!Number.isNaN(pmax) && !(x.prix != null && x.prix <= pmax)) return false;
  if (f.q && !sansAccent([x.nom, x.fr, x.type, x.type_fr, x.texte, x.texte_fr].join(" ")).includes(sansAccent(f.q.trim()))) return false;
  return true;
}

const optionsSugg = (vide, liste) => `<option value="">${vide}</option>${liste.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("")}`;

// demande : un groupe à ouvrir (#/deck/<deck>/suggestions/combos, le renvoi de l'onglet Combos)
async function ongletSuggestions(el, d, demande = null) {
  el.innerHTML = `<p class="chargement">Calcul des suggestions…</p>`;
  let r;
  try { r = await api(`/api/decks/${enc(d.id)}/suggestions`); }
  catch (e) { el.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; return; }
  if (!el.isConnected) return;
  let groupe = PREF.get("groupe-sugg", "theme"), page = 1, vus = [];
  if (GROUPES_SUGG.some(([k]) => k === demande)) {
    groupe = demande;
    PREF.set("groupe-sugg", groupe);
    history.replaceState(null, "", `#/deck/${enc(d.id)}/suggestions`);        // recharger la page garde le groupe choisi ensuite
  }
  if (!GROUPES_SUGG.some(([k]) => k === groupe)) groupe = "theme";
  let tri = PREF.get("tri-sugg", "note");
  if (!TRI_SUGG[tri]) tri = "note";
  let sens = PREF.get("sens-sugg", TRI_SUGG_DESC[tri] ? "desc" : "asc");
  let vueImages = PREF.get("vue-sugg", "liste") === "images";
  const filtres = { ...FILTRES_SUGG_VIDES };
  const fonctions = ORDRE_FONCTIONS.filter((f) => r.cartes.some((x) => (x.fonctions || []).includes(f))).map((f) => [f, f]);
  // au-dessus de la liste, deux lignes : les groupes (avec leur nombre de cartes) et Liste | Images, puis les filtres ;
  // les filtres ne se redessinent pas (le champ texte garde la main pendant qu'on tape)
  el.innerHTML = `
    <div class="sg-tete"></div>
    <div class="sg-filtres repliable">
      <input class="champ champ-petit" type="search" data-f="q" placeholder="Filtrer…" aria-label="Filtrer : nom, type, texte">
      ${boutonPlis("Type, fonction, coût et prix")}
      <select class="champ champ-petit pli" data-f="type" aria-label="Type">${optionsSugg("Type", TYPES_SUGG)}</select>
      <select class="champ champ-petit pli" data-f="fn" aria-label="Fonction">${optionsSugg("Fonction", fonctions)}</select>
      <select class="champ champ-petit pli" data-f="mv" aria-label="Valeur de mana">${optionsSugg("Coût", COUTS_SUGG)}</select>
      <label class="sg-prix pli"><input class="champ champ-petit" type="text" inputmode="decimal" data-f="prix" placeholder="Prix max" aria-label="Prix maximum, en euros"> €</label>
      <button type="button" class="lien-discret" data-effacer hidden>Effacer</button>
    </div>
    <div class="sg-res"></div>`;
  const tete = $(".sg-tete", el), zone = $(".sg-res", el), barre = $(".sg-filtres", el);
  const entete = () => `<div class="rch-cols">${COLONNES_SUGG.map(([k, l]) => {
    const actif = tri === k;
    return `<button type="button" class="rch-col ${actif ? "actif" : ""}" data-tri="${k}" aria-pressed="${actif}">${l}${actif ? `<span aria-label="${sens === "desc" ? "décroissant" : "croissant"}">${sens === "desc" ? "↓" : "↑"}</span>` : ""}</button>`;
  }).join("")}</div>`;
  const rendre = () => {
    const filtrees = r.cartes.filter((x) => passeFiltresSugg(x, filtres));
    const nb = (g) => (g === "tout" ? filtrees.length : filtrees.filter((x) => x.groupes.includes(g)).length);
    if (!nb(groupe)) groupe = "tout";
    const dir = sens === "desc" ? -1 : 1;
    vus = filtrees.filter((x) => groupe === "tout" || x.groupes.includes(groupe))
      .sort((a, b) => dir * TRI_SUGG[tri](a, b) || (tri === "nom" ? dir : 1) * a.nom.localeCompare(b.nom));
    const par = parPage(), pages = Math.max(1, Math.ceil(vus.length / par));
    page = Math.min(Math.max(1, page), pages);
    const debut = (page - 1) * par, p = { page, pages };
    tete.innerHTML = `<div class="segments" role="group" aria-label="Suggestions">${GROUPES_SUGG.map(([k, l]) => {
      const n = nb(k);
      return `<button type="button" data-groupe="${k}" class="${k === groupe ? "actif" : ""}" aria-pressed="${k === groupe}" ${n ? "" : "disabled"}>${l} <span class="sg-n">${n}</span></button>`;
    }).join("")}</div>
      <div class="segments" role="group" aria-label="Affichage">${[["liste", "Liste"], ["images", "Images"]].map(([k, l]) =>
        `<button type="button" data-vue="${k}" class="${(k === "images") === vueImages ? "actif" : ""}" aria-pressed="${(k === "images") === vueImages}">${l}</button>`).join("")}</div>`;
    $("[data-effacer]", barre).hidden = Object.entries(filtres).every(([k, v]) => v === FILTRES_SUGG_VIDES[k]);
    zone.innerHTML = `
      ${vus.length ? `<div class="rch-liste ${vueImages ? "etale" : "avec-images cl-table"}">${vueImages ? "" : entete()}${vus.slice(debut, debut + par)
        .map((x, j) => (vueImages ? carteImageSugg(x, debut + j) : ligneSugg(x, debut + j, d))).join("")}</div>`
        : `<div class="panneau vide"><p>Aucune suggestion.</p></div>`}
      ${basDeListe(p, vus.length)}
      ${r.ecartees.length ? `<details class="sg-ecartees"><summary>Écartées (${r.ecartees.length})</summary>
        <ul>${r.ecartees.map((n) => `<li><span class="nc" data-apercu="${esc(n)}">${esc(n)}</span>
          <button type="button" class="lien-discret" data-repropose="${esc(n)}">Reproposer</button></li>`).join("")}</ul></details>` : ""}`;
  };
  barre.addEventListener("input", (ev) => {
    const c = ev.target.closest("[data-f]");
    if (!c) return;
    filtres[c.dataset.f] = c.value;
    page = 1;
    rendre();
  });
  $("[data-effacer]", barre).onclick = () => {
    Object.assign(filtres, FILTRES_SUGG_VIDES);
    $$("[data-f]", barre).forEach((c) => { c.value = ""; });
    page = 1;
    rendre();
  };
  // ajoutée depuis la ligne ou depuis la fiche : la ligne le montre, l'en-tête du deck compte la carte
  const apresAjout = (res) => {
    if (!res) return;
    const ch = $(".entete-deck .chiffres");
    if (ch) ch.innerHTML = chiffresDeck(res);
    if (el.isConnected) rendre();
  };
  el.onclick = async (ev) => {
    const col = ev.target.closest(".rch-col");
    if (col) {                                               // en-tête : trier, ou inverser l'ordre
      if (col.dataset.tri === tri) sens = sens === "desc" ? "asc" : "desc";
      else { tri = col.dataset.tri; sens = TRI_SUGG_DESC[tri] ? "desc" : "asc"; }
      PREF.set("tri-sugg", tri);
      PREF.set("sens-sugg", sens);
      page = 1;
      return rendre();
    }
    const g = ev.target.closest("[data-groupe]");
    if (g) {
      groupe = g.dataset.groupe;
      PREF.set("groupe-sugg", groupe);
      page = 1;
      return rendre();
    }
    const v = ev.target.closest("[data-vue]");
    if (v) {
      vueImages = v.dataset.vue === "images";
      PREF.set("vue-sugg", v.dataset.vue);
      return rendre();
    }
    const pg = ev.target.closest("[data-page]");
    if (pg) {
      const bas = !!pg.closest(".rch-bas");
      page = +pg.dataset.page;
      rendre();
      if (bas) el.scrollIntoView({ block: "start" });
      return;
    }
    const rp = ev.target.closest("[data-repropose]");
    if (rp) {
      rp.disabled = true;
      try {
        await api(`/api/decks/${enc(d.id)}/suggestions/ecarter`, { method: "POST", body: { nom: rp.dataset.repropose, ecarter: false } });
        return ongletSuggestions(el, d);
      } catch (e) { erreur(e); rp.disabled = false; }
      return;
    }
    const a = ev.target.closest("[data-act]");
    if (!a || a.tagName === "A") return;
    const x = vus[+a.closest("[data-i]").dataset.i];
    if (!x) return;
    if (a.dataset.act === "ouvrir") return ficheRecherche(+a.closest("[data-i]").dataset.i, { liste: vus, deck: d, apres: apresAjout });
    a.disabled = true;
    if (a.dataset.act === "ecarter") {
      try {
        r.ecartees = (await api(`/api/decks/${enc(d.id)}/suggestions/ecarter`, { method: "POST", body: { nom: x.nom } })).ecartees;
        r.cartes = r.cartes.filter((y) => y !== x);
        rendre();
      } catch (e) { erreur(e); a.disabled = false; }
      return;
    }
    const res = await ajouterRecherche(x, { maybe: a.dataset.act === "maybe", deck: d });
    if (res) apresAjout(res); else a.disabled = false;
  };
  zone.onchange = (ev) => {
    if (ev.target.matches("[data-par-page]")) { PREF.set("par-page", ev.target.value); page = 1; return rendre(); }
    if (!ev.target.matches(".rch-page")) return;
    page = +ev.target.value || 1;
    rendre();
  };
  rendre();
}

// ------------------------------------------------------------------ cartes que j'ai, cartes à acheter (achats.json : sur ce PC seulement)
const possedeesDeck = (d) => api(`/api/decks/${enc(d.id)}/achats`).then((r) => r.possedees);
const marquerPossedees = (d, changements) =>
  api(`/api/decks/${enc(d.id)}/achats`, { method: "POST", body: { possedees: changements } }).then((r) => r.possedees);

// exemplaires qu'il faut (toutes les lignes de la carte hors Maybeboard ; au Maybeboard, les siennes) et que j'ai
const besoinCarte = (d, c) => d.cartes.filter((x) => x.nom === c.nom && (x.cat === "Maybeboard") === (c.cat === "Maybeboard"))
  .reduce((s, x) => s + x.n, 0);
const jAi = (c, poss, n) => Math.min(n, poss[c.nom] ?? (estBase(c) ? n : 0));      // un terrain de base : je l'ai

// le deck sans le Maybeboard, une ligne par carte : à acheter et déjà là, les plus chères d'abord
function bilanAchats(d, poss) {
  const par = new Map();
  for (const c of d.cartes) if (c.cat !== "Maybeboard" && !par.has(c.nom)) par.set(c.nom, c);
  const acheter = [], ai = [];
  for (const c of par.values()) {
    const total = besoinCarte(d, c), j = jAi(c, poss, total);
    if (j) ai.push({ c, n: j, total });
    if (total > j) acheter.push({ c, n: total - j, total });
  }
  const tri = (a, b) => (b.c.info.prix || 0) - (a.c.info.prix || 0) || a.c.nom.localeCompare(b.c.nom);
  return { acheter: acheter.sort(tri), ai: ai.sort(tri) };
}
const nbAchats = (l) => l.reduce((s, x) => s + x.n, 0);
const coutAchats = (l) => l.reduce((s, x) => s + (x.c.info.prix || 0) * x.n, 0);
const WANTS_CARDMARKET = "https://www.cardmarket.com/fr/Magic/Wants";

// liste de wants Cardmarket (« Ajouter une decklist ») : « 2 Nom anglais », une carte par ligne, seulement ce qui manque
async function copierCardmarket(d) {
  try {
    const { acheter } = bilanAchats(d, await possedeesDeck(d));
    if (!acheter.length) return toast("Rien à acheter.");
    await navigator.clipboard.writeText(acheter.map((x) => `${x.n} ${x.c.nom}`).join("\n") + "\n");
    const n = nbAchats(acheter);
    toast(`Copié pour Cardmarket : ${n} carte${n > 1 ? "s" : ""}.`);
  } catch (e) { erreur(e); }
}

// ------------------------------------------------------------------ proxies à imprimer (menu « … » du deck)
// Comme la « Machine à Proxies » de Magic-Ville : en texte (nom, coût, type, texte, force et endurance, en noir et blanc :
// peu d'encre) ou en images (la version choisie dans le deck, verso compris). 9 cartes par page A4, à la taille réelle,
// bord à bord pour couper d'un trait. Les images ne sont ni recadrées, ni déformées, ni décolorées (règles de Scryfall).
const PROXIES_PAR_PAGE = 9;

// les cartes à imprimer : celles à acheter, tout le deck (sans le Maybeboard), avec ou sans les terrains de base, ou ses
// jetons (un de chaque)
function proxiesDuDeck(d, poss, cartes, bases, jetons = []) {
  if (cartes === "jetons") return jetons.map((j) => ({ c: { nom: j.nom, cat: "", info: { image: j.image, type: j.type, texte: j.texte, pt: j.pt } }, n: 1 }));
  const garde = (c) => bases || !estBase(c);
  const l = cartes === "acheter" ? bilanAchats(d, poss).acheter.filter((x) => garde(x.c))
    : d.cartes.filter((c) => c.cat !== "Maybeboard" && garde(c)).map((c) => ({ c, n: c.n }));
  return l.sort((a, b) => (b.c.cat === "Commander") - (a.c.cat === "Commander") || nomAffiche(a.c).localeCompare(nomAffiche(b.c), "fr"));
}

// une carte en texte : chaque face (« Recto // Verso ») avec son nom, son coût, son type, son texte et sa force
function proxyTexte(c, langue) {
  const i = c.info, fr = langue === "fr";
  const faces = (t) => String(t || "").split(" // ");
  const noms = faces(fr ? i.fr || c.nom : c.nom), types = faces(fr ? i.fr_type || i.type : i.type);
  if (!fr && types.length === 1 && i.dos && i.dos.type) types.push(i.dos.type);      // le type du verso, connu en anglais seulement
  const textes = String((fr ? i.fr_texte || i.texte : i.texte) || "").split(/\n\/\/\n/);
  const couts = faces(i.cout), forces = faces(i.pt);
  const n = Math.max(noms.length, textes.length);
  const face = (k) => `<div class="px-face">
      <div class="px-tete"><span class="px-nom">${esc(noms[k] || "")}</span>${couts[k] ? mana(couts[k]) : ""}</div>
      <div class="px-type">${esc(types[k] || "")}</div>
      <div class="px-regles">${(textes[k] || "").split("\n").filter((l) => l.trim()).map((l) => `<p>${texteMana(l)}</p>`).join("")}</div>
      ${forces[k] ? `<div class="px-force">${esc(forces[k].replace(/^loyauté /, fr ? "Loyauté " : "Loyalty "))}</div>` : ""}
    </div>`;
  return `<div class="px-carte px-texte">${Array.from({ length: n }, (_, k) => face(k)).join("")}</div>`;
}

// une carte en images : celle de la version choisie dans le deck, en grand ; une carte à deux faces donne aussi son verso
// (même impression : l'adresse du verso est celle du recto, « back » au lieu de « front »)
function proxyImages(c) {
  const grande = (u) => String(u || "").replace(/\/(normal|small)\//, "/large/");
  const recto = grande(c.info.image);
  const verso = !c.info.dos ? "" : recto.includes("/front/") ? recto.replace("/front/", "/back/") : grande(c.info.dos.image);
  return [recto, verso].filter(Boolean).map((u) => `<div class="px-carte px-image"><img src="${esc(u)}" alt=""></div>`);
}

// un texte trop long pour sa carte : la police rétrécit jusqu'à ce qu'il tienne (comme les cartes à beaucoup de texte)
function ajusterProxies(el) {
  for (const f of $$(".px-texte", el)) {
    let t = 8.4;
    f.style.setProperty("--px-taille", t + "pt");
    while (f.scrollHeight > f.clientHeight + 1 && t > 5) {
      t -= 0.3;
      f.style.setProperty("--px-taille", t + "pt");
    }
  }
}

async function vueProxies(p) {
  const id = p.get("deck");
  vue.innerHTML = `<p class="chargement">Préparation des proxies…</p>`;
  const [d, poss] = await Promise.all([api(`/api/decks/${enc(id)}`),
    api(`/api/decks/${enc(id)}/achats`).then((r) => r.possedees).catch(() => ({}))]);
  const jetons = await jetonsDuDeck(d);
  const compte = (cartes, bases) => nbAchats(proxiesDuDeck(d, poss, cartes, bases, jetons));
  let cartes = p.get("cartes") === "jetons" && jetons.length ? "jetons" : compte("acheter", PREF.get("proxies-bases", "") === "1") ? "acheter" : "tout";
  const rendre = () => {
    const format = PREF.get("proxies-format", "texte"), langue = PREF.get("proxies-langue", "fr"), bases = PREF.get("proxies-bases", "") === "1";
    const proxies = proxiesDuDeck(d, poss, cartes, bases, jetons).flatMap(({ c, n }) =>
      Array.from({ length: n }, () => (format === "images" ? proxyImages(c) : [proxyTexte(c, langue)])).flat());
    const pages = [];
    for (let i = 0; i < proxies.length; i += PROXIES_PAR_PAGE) pages.push(proxies.slice(i, i + PROXIES_PAR_PAGE));
    vue.innerHTML = `<div class="px-outils">
        <nav class="fil" aria-label="Fil d'Ariane"><a href="#/">Mes decks</a><span aria-hidden="true">›</span><a href="${esc(lienDeck(d.id))}">${esc(d.titre)}</a><span aria-hidden="true">›</span><span aria-current="page">Proxies</span></nav>
        <div class="px-reglages">
          ${segments("proxies-format", [["texte", "Texte", "liste"], ["images", "Images", "cartes"]], "texte")}
          ${format === "texte" ? segments("proxies-langue", [["fr", "Français"], ["en", "Anglais"]], "fr") : ""}
          <select class="champ champ-petit" id="px-cartes" aria-label="Cartes à imprimer">
            <option value="acheter" ${cartes === "acheter" ? "selected" : ""}>Les cartes à acheter (${compte("acheter", bases)})</option>
            <option value="tout" ${cartes === "tout" ? "selected" : ""}>Tout le deck (${compte("tout", bases)})</option>
            ${jetons.length ? `<option value="jetons" ${cartes === "jetons" ? "selected" : ""}>Les jetons (${jetons.length})</option>` : ""}</select>
          ${cartes === "jetons" ? "" : `<label class="petit"><input type="checkbox" id="px-bases" ${bases ? "checked" : ""}> Terrains de base</label>`}
          <span class="px-compte muet petit">${proxies.length} proxie${proxies.length > 1 ? "s" : ""} · ${pages.length} page${pages.length > 1 ? "s" : ""} A4</span>
          <button class="btn btn-accent" id="px-imprimer" ${proxies.length ? "" : "disabled"}>${ico("imprimer")}Imprimer</button>
        </div>
      </div>
      ${pages.length ? `<div class="px-feuilles">${pages.map((pg) => `<section class="px-feuille"><div class="px-grille">${pg.join("")}</div></section>`).join("")}</div>`
        : `<p class="muet">Aucune carte à imprimer.</p>`}`;
    $$("img", vue).forEach((im) => { im.loading = "eager"; });          // toutes chargées avant l'impression
    if (format === "texte") ajusterProxies(vue);
    $$(".px-reglages .segments button", vue).forEach((b) => b.addEventListener("click", () => { PREF.set(b.dataset.pref, b.dataset.val); rendre(); }));
    $("#px-cartes", vue).onchange = (ev) => { cartes = ev.target.value; rendre(); };
    if ($("#px-bases", vue)) $("#px-bases", vue).onchange = (ev) => { PREF.set("proxies-bases", ev.target.checked ? "1" : ""); rendre(); };
    $("#px-imprimer", vue).onclick = async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      await Promise.all($$(".px-feuilles img", vue).map((im) => (im.complete ? null : new Promise((ok) => { im.onload = im.onerror = ok; }))));
      b.disabled = false;
      print();
    };
  };
  rendre();
}

// fiche d'une carte : « Je l'ai » ou « À acheter », un clic pour passer de l'un à l'autre
function boutonAchat(b, d, c, poss) {
  const n = besoinCarte(d, c), j = jAi(c, poss, n);
  b.className = "badge" + (j >= n ? " badge-ok" : "");
  b.innerHTML = j >= n ? ico("coche") + "Je l'ai" : ico("panier") + (j ? `J'en ai ${j} / ${n}` : "À acheter");
  b.setAttribute("aria-pressed", j >= n);
  b.hidden = false;
}

async function basculerAchat(b, d, c) {
  try {
    const n = besoinCarte(d, c), poss = await possedeesDeck(d);
    const nouv = await marquerPossedees(d, { [c.nom]: jAi(c, poss, n) >= n ? 0 : n });
    boutonAchat(b, d, c, nouv);
    if ($("#contenu .achats")) ongletAchats($("#contenu"), d, nouv);
  } catch (e) { erreur(e); }
}

// onglet Achats : ce qu'il reste à acheter (et combien ça coûte), ce que j'ai déjà
async function ongletAchats(el, d, poss = null) {
  if (!poss) {
    el.innerHTML = `<p class="chargement">Chargement…</p>`;
    try { poss = await possedeesDeck(d); } catch (e) { el.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; return; }
  }
  const { acheter, ai } = bilanAchats(d, poss);
  etat.ordre = [...new Set([...acheter, ...ai].map((x) => x.c.index))];
  const ligne = (x, achat) => {
    const c = x.c, f = c.info || {}, cher = (f.prix || 0) > BUDGET, lib = achat ? "Je l'ai" : "À acheter";
    return `<div class="ligne ligne-carte ligne-achat" data-carte="${c.index}">
      <span class="qte">${x.n > 1 ? x.n + "×" : ""}</span>
      <span class="nom"><span class="en" data-image="${esc(f.image)}" data-legende="${esc(legendeCarte(c))}" ${cher ? 'data-cher="1"' : ""}>${esc(c.nom)}</span>${f.fr && f.fr !== c.nom ? `<span class="fr">${esc(f.fr)}</span>` : ""}${achat ? `<span class="ou-hint" data-ou="${esc(c.nom)}" hidden></span>` : ""}</span>
      ${mana(f.cout)}
      ${f.prix_lien ? `<a class="prix ${cher ? "cher" : ""}" href="${esc(f.prix_lien)}" target="_blank" rel="noopener">${euros(f.prix)}</a>` : `<span class="prix muet">${euros(f.prix)}</span>`}
      <button type="button" class="btn-menu" data-bascule="${esc(c.nom)}" data-v="${achat ? x.total : 0}" aria-label="${lib} : ${esc(c.nom)}" title="${lib}">${ico(achat ? "coche" : "panier")}</button>
    </div>`;
  };
  el.innerHTML = `<div class="achats">
    <div class="segments segments-pages" role="tablist">
      <button type="button" role="tab">À acheter <span class="sg-n">${nbAchats(acheter)}</span></button>
      <button type="button" role="tab">J'ai déjà <span class="sg-n">${nbAchats(ai)}</span></button></div>
    <div class="glisse cote-a-cote">
    <section class="groupe glisse-page">
      <h3 class="page-titre">À acheter <span class="muet">(${nbAchats(acheter)})</span></h3>
      <div class="groupe-titre"><span class="achats-cout">${euros(coutAchats(acheter))}</span>
        ${acheter.length ? `<span class="achats-outils">
          <button type="button" class="btn btn-petit" id="ach-copier">${ico("copier")}Copier pour Cardmarket</button>
          <a class="lien-discret" href="${WANTS_CARDMARKET}" target="_blank" rel="noopener">Wants ↗</a>
          <button type="button" class="btn-menu" id="ach-tout" aria-label="Je les ai toutes" title="Je les ai toutes">${ico("coche")}</button></span>` : ""}</div>
      ${acheter.length ? acheter.map((x) => ligne(x, true)).join("") : `<p class="muet petit">Rien à acheter.</p>`}
    </section>
    <section class="groupe glisse-page">
      <h3 class="page-titre">J'ai déjà <span class="muet">(${nbAchats(ai)})</span></h3>
      <div class="groupe-titre"><span class="muet">${euros(coutAchats(ai))}</span></div>
      ${ai.length ? ai.map((x) => ligne(x, false)).join("") : `<p class="muet petit">Aucune.</p>`}
    </section></div>
  </div>`;
  const pages = ongletAchats.pages || (ongletAchats.pages = {});          // la liste ouverte, gardée pour ce deck
  pagesGlissees($(".glisse", el), $$(".segments-pages button", el), pages[d.id] ?? (acheter.length ? 0 : 1));
  $(".glisse", el).addEventListener("page", (ev) => { pages[d.id] = ev.detail; });
  // à acheter, mais déjà là ailleurs : au classeur, ou dans un autre deck (où je l'ai)
  if (acheter.length) api("/api/ou-sont").then((idx) => {
    for (const s of $$("[data-ou]", el)) {
      const x = idx[s.dataset.ou];
      if (!x) continue;
      const bouts = [x.classeur ? `Classeur${x.classeur > 1 ? " : " + x.classeur : ""}` : "",
        ...x.decks.filter(([id, , ai]) => id !== d.id && ai > 0).map(([id, , ai]) => id.replace(/^Deck /, "") + (ai > 1 ? " : " + ai : ""))].filter(Boolean);
      if (!bouts.length) continue;
      s.textContent = "J'en ai : " + bouts.join(", ");
      s.hidden = false;
    }
  }).catch(() => {});
  const marquer = async (changements) => {
    try { ongletAchats(el, d, await marquerPossedees(d, changements)); } catch (e) { erreur(e); }
  };
  el.onclick = (ev) => {
    const b = ev.target.closest("[data-bascule]");
    if (b) return marquer({ [b.dataset.bascule]: +b.dataset.v });
    if (ev.target.closest("#ach-copier")) return copierCardmarket(d);
    if (ev.target.closest("#ach-tout")) return marquer(Object.fromEntries(acheter.map((x) => [x.c.nom, x.total])));
    if (ev.target.closest("a")) return;
    const m = ev.target.closest("[data-carte]");
    if (m) ouvrirCarte(d.cartes[+m.dataset.carte]);
  };
}

// page du deck publiée sur GitHub Pages (partage.py) : lien, mise à jour, retrait ; au doigt, « Partager » ouvre le
// partage du téléphone (messagerie, e-mail…)
const PARTAGE_NATIF = !!navigator.share && matchMedia("(pointer: coarse)").matches;
function modalePartage(d) {
  ouvrirModale(`<h2>Partager ${esc(d.titre)}</h2>
    <div id="pt-zone"><p class="chargement">Chargement…</p></div>`, async (b) => {
    const zone = $("#pt-zone", b);
    const rendre = (s) => {
      zone.innerHTML = `
        <div class="form-ligne">
          <input class="champ" id="pt-url" readonly value="${esc(s.url)}" style="flex:1;min-width:240px" aria-label="Lien de la page">
          ${PARTAGE_NATIF ? `<button class="btn btn-accent" id="pt-envoyer">${ico("partager")}Partager</button>` : ""}
          <button class="btn ${PARTAGE_NATIF ? "" : "btn-accent"}" id="pt-copier">${ico("copier")}Copier le lien</button>
          <a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener">${ico("ouvrir")}Ouvrir</a>
        </div>
        <p class="muet petit">Mise à jour le ${esc(new Date(s.date * 1000).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }))}</p>
        ${s.erreur ? `<p class="erreur petit">${esc(s.erreur)}</p>` : ""}
        <div class="boutons">
          <button class="btn btn-danger" id="pt-retirer">${ico("corbeille")}Ne plus partager</button>
          <button class="btn" id="pt-maj">${ico("rafraichir")}Mettre à jour</button>
        </div>`;
      $("#pt-url", zone).onclick = (ev) => ev.target.select();
      if (PARTAGE_NATIF) $("#pt-envoyer", zone).onclick = () => navigator.share({ title: d.titre, url: s.url }).catch(() => {});
      $("#pt-copier", zone).onclick = async () => {
        try { await navigator.clipboard.writeText(s.url); toast("Lien copié."); } catch (e) { erreur(e); }
      };
      $("#pt-maj", zone).onclick = publier;
      $("#pt-retirer", zone).onclick = async () => {
        if (!confirm(`Retirer la page partagée de « ${d.titre} » ?`)) return;
        zone.innerHTML = `<p class="chargement">Retrait…</p>`;
        try { await api(`/api/decks/${enc(d.id)}/partage/retirer`, { method: "POST" }); fermerModale(); toast("Page retirée."); }
        catch (e) { zone.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
      };
    };
    const publier = async () => {
      zone.innerHTML = `<p class="chargement">Publication…</p>`;
      try { rendre(await api(`/api/decks/${enc(d.id)}/partage`, { method: "POST" })); toast("Publié : en ligne d'ici une minute ou deux.", 4000); }
      catch (e) {
        if (e.statut === 401) introGithub(zone, publier, "partage");
        else zone.innerHTML = `<p class="erreur">${esc(e.message)}</p>`;
      }
    };
    // premier partage : ce qui sera visible de tous, et ce qui ne l'est pas, avant de publier
    const avant = () => {
      zone.innerHTML = `<p>La page de <strong>${esc(d.titre)}</strong> sera publique : toute personne qui a le lien y voit
          la liste, les statistiques, les combos et les tests du deck.</p>
        <p class="muet petit">Pas ton classeur, ni tes achats, ni tes discussions avec Claude. La page se met à jour toute seule quand le deck change.</p>
        <div class="boutons"><button class="btn btn-accent" id="pt-publier">${ico("partager")}Publier la page</button></div>`;
      $("#pt-publier", zone).onclick = publier;
    };
    const s = await api(`/api/decks/${enc(d.id)}/partage`).catch(() => ({}));
    if (s.url) rendre(s); else avant();
  }, { focus: false });
}

// ce qu'est GitHub et à quoi il sert, pour qui n'en a jamais entendu parler : avant toute connexion (sauvegarde,
// récupération, partage, Options). Avec ou sans compte, on arrive à connexionGithub
function introGithub(zone, suite, contexte = "") {
  const pourquoi = {
    sauvegarde: "Pour sauvegarder tes decks, l'Atelier passe par GitHub.",
    recuperer: `Ta sauvegarde est sur GitHub : connecte l'Atelier au compte GitHub de ton autre ${TELEPHONE ? "appareil" : "PC"}.`,
    partage: "Pour publier la page de ton deck, l'Atelier passe par GitHub.",
  }[contexte];
  const connecter = () => connexionGithub(zone, suite);
  zone.innerHTML = `${pourquoi ? `<p class="gh-contexte">${pourquoi}</p>` : ""}
    <div class="gh-presente">
      <p><strong>GitHub</strong> est un service gratuit de Microsoft qui garde des fichiers en ligne.${PARTAGEABLE ? " L'Atelier s'en sert pour deux choses :" : ""}</p>
      <ul class="gh-usages">
        <li>${ico("nuage")}<span><strong>Sauvegarder tes decks</strong> dans un espace privé, que toi seul vois : tu les retrouves si ton ${TELEPHONE ? "téléphone" : "PC"} tombe en panne, ou sur ${AUTRE_APPAREIL}.</span></li>
        ${PARTAGEABLE ? `<li>${ico("partager")}<span><strong>Publier les decks que tu partages</strong>, sur une page à envoyer à ton groupe de jeu.</span></li>` : ""}
      </ul>
    </div>
    <p class="gh-compte">Il faut un compte GitHub : gratuit, avec une adresse e-mail.</p>
    <div class="boutons">
      <a class="btn" id="gh-creer" href="https://github.com/signup" target="_blank" rel="noopener">${ico("ouvrir")}Créer un compte</a>
      <button class="btn btn-accent" id="gh-suite">J'ai un compte : me connecter</button>
    </div>`;
  $("#gh-suite", zone).onclick = connecter;
  $("#gh-creer", zone).addEventListener("click", () => setTimeout(() => {   // le compte se crée dans l'onglet ouvert
    zone.innerHTML = `<p>Crée ton compte sur la page de GitHub qui vient de s'ouvrir, puis reviens ici.</p>
      <p class="muet petit">Ton nom d'utilisateur GitHub apparaîtra dans l'adresse des decks que tu partageras.</p>
      <div class="boutons"><button class="btn btn-accent" id="gh-suite">Mon compte est créé : me connecter</button></div>`;
    $("#gh-suite", zone).onclick = connecter;
  }, 300));
}

// connecté avant la sauvegarde : GitHub n'a ouvert que les dépôts publics, il faut un nouveau code
function autoriserGithub(zone, suite) {
  zone.innerHTML = `<p>La sauvegarde va dans un espace privé de ton compte GitHub. Pour y écrire, l'Atelier a besoin
      d'une autorisation de plus : un nouveau code, comme à ta première connexion.</p>
    <div class="boutons"><button class="btn btn-accent" id="gh-suite">Continuer</button></div>`;
  $("#gh-suite", zone).onclick = () => connexionGithub(zone, suite);
}

// se connecter à GitHub par un code (github.py). Le code s'affiche tout de suite, avec les trois gestes à faire sur
// github.com ; la page suit GitHub et appelle suite(compte) une fois connecté
async function connexionGithub(zone, suite) {
  zone.innerHTML = `<p class="chargement">Demande d'un code à GitHub…</p>`;
  let c;
  try { c = await api("/api/github/connexion", { method: "POST", body: {} }); }
  catch (e) {
    zone.innerHTML = `<p class="erreur">${esc(e.message)}</p>
      <div class="gh-action"><button class="btn btn-accent" id="gh-encore">Réessayer</button></div>`;
    $("#gh-encore", zone).onclick = () => connexionGithub(zone, suite);
    return;
  }
  // l'écran d'autorisation de GitHub parle de « dépôts publics et privés » : dit avant, il n'inquiète pas
  zone.innerHTML = `<ol class="gh-etapes">
      <li><p class="gh-code" aria-label="Code de connexion">${esc(c.code)}</p>
        <a class="btn btn-accent" id="gh-ouvrir" href="${esc(c.url)}" target="_blank" rel="noopener">${ico("copier")}Copier le code et ouvrir GitHub</a></li>
      <li>Sur GitHub, connecte-toi si besoin, colle le code${TELEPHONE ? "" : " (Ctrl+V)"}, puis clique sur «&nbsp;Continue&nbsp;».</li>
      <li>GitHub te montre ce que l'Atelier pourra faire : écrire dans tes dépôts, les dossiers de ton compte. C'est là
        qu'il range ta sauvegarde${PARTAGEABLE ? " et tes pages" : ""}. Clique sur «&nbsp;Authorize Atelier MTG&nbsp;», puis reviens ici.</li>
    </ol>
    <p class="gh-attente" role="status">En attente de GitHub…</p>`;
  $("#gh-ouvrir", zone).onclick = () => { navigator.clipboard.writeText(c.code).catch(() => {}); };
  while (zone.isConnected) {
    await attendre(2000);
    let e;
    try { e = await api("/api/github/connexion"); } catch (_) { continue; }
    if (!zone.isConnected || e.etat === "attente") continue;
    if (e.etat === "ok") { toast(`Connecté à GitHub : ${e.compte}.`); return suite(e.compte); }
    zone.innerHTML = `<p>${esc({ refus: "Connexion refusée sur GitHub.", expire: "Le code a expiré." }[e.etat] || e.erreur || "Connexion impossible.")}</p>
      <div class="gh-action"><button class="btn btn-accent" id="gh-encore">Recommencer</button></div>`;
    $("#gh-encore", zone).onclick = () => connexionGithub(zone, suite);
    return;
  }
}

// retirer l'accès de tous les appareils : « Revoke access » sur la page GitHub de l'appli « Atelier MTG » retire toutes
// ses clés (PC, téléphones, appareil perdu ou volé). La fenêtre suit GitHub : une fois la clé d'ici refusée, elle propose
// de reconnecter cet appareil ; un téléphone relié au PC, lui, est délié (sa clé était celle du PC)
const TOUS_APPAREILS = "Déconnecter tous mes appareils";
function modaleRetirerAcces(appli, intro = "", fin = () => {}) {
  ouvrirModale(`<h2>${TOUS_APPAREILS}</h2>
    <div id="ra-zone">${intro ? `<p>${esc(intro)}</p>` : ""}
      <p><strong>${TELEPHONE ? "Ce téléphone, ton PC" : "Ce PC, ton téléphone"}</strong> et tout appareil perdu ou volé
        perdront l'accès à ta sauvegarde.</p>
      <p>Sur GitHub, clique sur «&nbsp;Revoke access&nbsp;», puis reconnecte les appareils que tu gardes.</p>
      <div class="gh-action"><a class="btn btn-accent" id="ra-ouvrir" href="${esc(appli)}" target="_blank" rel="noopener">Ouvrir GitHub</a></div>
      <p class="gh-attente" role="status" hidden>En attente de GitHub…</p></div>`, (b) => {
    const zone = $("#ra-zone", b), fini = () => { fermerModale(); fin(); };
    let suivi = false;
    $("#ra-ouvrir", b).onclick = async () => {
      $(".gh-attente", zone).hidden = false;
      if (suivi) return;
      suivi = true;
      for (const debut = Date.now(); zone.isConnected && Date.now() - debut < 15 * 60000;) {
        await attendre(3000);
        let v;
        try { v = await api("/api/github/valide"); } catch (_) { continue; }
        if (!zone.isConnected || v.valide) continue;
        const relie = TELEPHONE && !TELEPHONE.local;
        zone.innerHTML = `<p>C'est fait : plus aucun appareil n'a accès à ta sauvegarde, ${CET_APPAREIL} compris.${relie ? " Il est délié." : ""}</p>
          <div class="gh-action"><button class="btn btn-accent" id="ra-suite">${relie ? "OK" : `Reconnecter ${CET_APPAREIL}`}</button></div>`;
        const delie = () => { fermerModale(); location.hash = "#/"; TELEPHONE.delier(); };
        $("#ra-suite", zone).onclick = relie ? delie : () => connexionGithub(zone, fini);
        if (relie) $(".modale-fermer", b).onclick = delie;
        return;
      }
    };
  }, { focus: false, fermer: () => { fermerModale(); fin(); } });
}

// ------------------------------------------------------------------ sauvegarde en ligne (synchro.py)
// une fenêtre, trois portes : sauvegarder (bandeau de l'accueil, Options), récupérer (accueil vide d'un nouveau PC).
// Chacune mène, si besoin, à la présentation de GitHub puis à la connexion ; fin() est appelé une fois tout fini
function modaleSauvegarde(contexte, fin = () => {}) {
  const titre = contexte === "recuperer" ? "Récupérer mes decks" : "Sauvegarder mes decks en ligne";
  ouvrirModale(`<h2>${titre}</h2>
    <div id="sv-zone"><p class="chargement">Chargement…</p></div>`, async (b) => {
    const zone = $("#sv-zone", b);
    const fini = () => { fermerModale(); fin(); };
    const apres = () => (contexte === "recuperer" ? recupererDecks(zone, fini) : activerSauvegarde(zone, fini));
    const g = await api("/api/github").catch(() => ({}));
    if (g.compte && g.prive) apres();
    else if (g.compte) autoriserGithub(zone, apres);
    else introGithub(zone, apres, contexte === "recuperer" ? "recuperer" : "sauvegarde");
  }, { focus: false, fermer: () => { fermerModale(); fin(); } });
}

// un échec : se reconnecter s'il le faut (401 : plus connecté ; 409 : connexion d'avant la sauvegarde), sinon réessayer
function echecSauvegarde(zone, e, refaire, contexte) {
  if (e.statut === 409) return autoriserGithub(zone, refaire);
  if (e.statut === 401) return introGithub(zone, refaire, contexte);
  zone.innerHTML = `<p class="erreur">${esc(e.message)}</p>
    <div class="boutons"><button class="btn btn-accent" id="sv-encore">Réessayer</button></div>`;
  $("#sv-encore", zone).onclick = refaire;
}

async function activerSauvegarde(zone, fin) {
  zone.innerHTML = `<p class="chargement">Sauvegarde de tes decks…</p>`;
  let r;
  try { r = await api("/api/sauvegarde", { method: "POST", body: { action: "activer" } }); }
  catch (e) { return echecSauvegarde(zone, e, () => activerSauvegarde(zone, fin), "sauvegarde"); }
  const n = r.resume.decks || 0;
  zone.innerHTML = `<p class="sv-ok">${ico("nuage")}<span><strong>${n > 1 ? `Tes ${n} decks sont sauvegardés.` : n ? "Ton deck est sauvegardé." : "La sauvegarde est prête."}</strong>
      Ensuite, chaque modification est sauvegardée toute seule.</span></p>
    <p class="muet petit">${TELEPHONE ? "Sur un autre appareil : «&nbsp;Récupérer mes decks&nbsp;» sur la page d'accueil de l'Atelier." : "Sur un autre PC : installe l'Atelier, puis «&nbsp;Récupérer mes decks&nbsp;» sur sa page d'accueil."}</p>
    <div class="boutons">${r.etat.url ? `<a class="btn" href="${esc(r.etat.url)}" target="_blank" rel="noopener">${ico("ouvrir")}Voir sur GitHub</a>` : ""}
      <button class="btn btn-accent" id="sv-fin">OK</button></div>`;
  $("#sv-fin", zone).onclick = fin;
}

async function recupererDecks(zone, fin) {
  zone.innerHTML = `<p class="chargement">Recherche de ta sauvegarde…</p>`;
  let s, g;
  try { [s, g] = await Promise.all([api("/api/sauvegarde/distante"), api("/api/github")]); }
  catch (e) { return echecSauvegarde(zone, e, () => recupererDecks(zone, fin), "recuperer"); }
  if (!s.existe) {
    zone.innerHTML = `<p>Aucune sauvegarde de decks sur le compte GitHub <strong>${esc(g.compte)}</strong>.</p>
      <p class="muet petit">Elle se crée depuis ton autre ${TELEPHONE ? "appareil" : "PC"} : bandeau «&nbsp;Les sauvegarder en ligne&nbsp;» de sa page d'accueil, ou Options.</p>
      <div class="boutons"><button class="btn btn-accent" id="sv-fin">OK</button></div>`;
    $("#sv-fin", zone).onclick = fin;
    return;
  }
  const quand = new Date(s.date).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
  zone.innerHTML = `<p>La sauvegarde du compte <strong>${esc(g.compte)}</strong> contient ${s.decks.length > 1 ? `${s.decks.length} decks` : "1 deck"},
      modifiée le ${esc(quand)} :</p>
    <p class="sv-decks">${s.decks.map((n) => `<strong>${esc(n)}</strong>`).join(" · ")}</p>
    <div class="boutons"><button class="btn btn-accent" id="sv-go">${ico("telecharger")}Récupérer sur ${CET_APPAREIL}</button></div>`;
  $("#sv-go", zone).onclick = async () => {
    zone.innerHTML = `<p class="chargement">Récupération de tes decks…</p>`;
    try {
      const r = await api("/api/sauvegarde/recuperer", { method: "POST", body: {} });
      const n = r.resume.decks_recus ? r.resume.decks_recus.length : 0;
      toast(n > 1 ? `${n} decks récupérés.` : n ? "1 deck récupéré." : "Tes decks sont à jour.");
      etat.decks = [];
      fin();
    } catch (e) { echecSauvegarde(zone, e, () => recupererDecks(zone, fin), "recuperer"); }
  };
}

// accueil : où en est la sauvegarde (un mot discret), ou un bandeau tant que les decks ne sont que sur ce PC
const PLUS_TARD_SAUVEGARDE = 7 * 86400 * 1000;
async function etatSauvegarde(petit, bandeau) {
  const s = await api("/api/sauvegarde").catch(() => null);
  if (!s || !petit.isConnected) return;
  if (s.active) {
    const quand = s.derniere ? `Dernière sauvegarde : ${heureCourte(s.derniere)}` : "";
    petit.innerHTML = `<a class="etat-sauvegarde ${s.erreur ? "en-echec" : ""}" href="#/options" title="${esc(s.erreur || quand)}">${ico("nuage")}${s.erreur ? "Sauvegarde en échec" : "Sauvegardé"}</a>`;
    bandeau.innerHTML = "";
    return;
  }
  let tard = 0;
  try { tard = +localStorage.getItem("pref-sauvegarde-plus-tard") || 0; } catch (_) {}
  if ((s.connecte && s.prive && !s.voulue) || Date.now() - tard < PLUS_TARD_SAUVEGARDE) return;   // coupée exprès, ou « Plus tard »
  bandeau.innerHTML = `<div class="bandeau-sauvegarde">${ico("nuage")}<p>Tes decks ne sont que sur ${CET_APPAREIL} : si tu le changes ou s'il tombe en panne, ils sont perdus.</p>
    <button class="btn btn-accent btn-petit" id="bs-oui">Les sauvegarder en ligne</button>
    <button class="btn btn-discret btn-petit" id="bs-tard">Plus tard</button></div>`;
  $("#bs-oui", bandeau).onclick = () => modaleSauvegarde("sauvegarde", () => etatSauvegarde(petit, bandeau));
  $("#bs-tard", bandeau).onclick = () => { PREF.set("sauvegarde-plus-tard", String(Date.now())); bandeau.innerHTML = ""; };
}

function modaleRenommer(d) {
  ouvrirModale(`
    <h2>Renommer le deck</h2>
    <label class="bloc">Nom du deck<input class="champ" id="rn-nom" maxlength="60" value="${esc(d.titre)}"></label>
    <div class="boutons"><button class="btn btn-accent" id="ok">Renommer</button></div>`, (b) => {
    const champ = $("#rn-nom", b), ok = $("#ok", b);
    const valider = async () => {
      if (ok.disabled) return;
      try {
        ok.disabled = true;
        const r = await api(`/api/decks/${enc(d.id)}/renommer`, { method: "POST", body: { nom: champ.value } });
        fermerModale();
        if (r.id === d.id) return;
        renommerPrefs(d.id, r.id);
        if (chat.cle === d.id) { chat.cle = r.id; PREF.set("chat-discussion", r.id); }
        etat.deck = null;
        etat.decks = await api("/api/decks");
        remplirChoixDiscussion(etat.decks);
        location.hash = `#/deck/${enc(r.id)}${location.hash.split("/")[3] ? "/" + location.hash.split("/")[3] : ""}`;
        toast("Deck renommé.");
      } catch (e) { erreur(e); ok.disabled = false; }
    };
    ok.onclick = valider;
    champ.onkeydown = (ev) => { if (ev.key === "Enter") valider(); };
  });
  $("#rn-nom").select();
}

// ce que le navigateur retient d'un deck (partie de « Jouer ») suit son nouveau nom
function renommerPrefs(ancien, nouveau) {
  try {
    const v = localStorage.getItem("partie-" + ancien);
    if (v === null) return;
    localStorage.removeItem("partie-" + ancien);
    localStorage.setItem("partie-" + nouveau, v);
  } catch (_) {}
}

// les recherches de cartes ne sont plus retenues (version 1.7.5) : celles gardées avant s'effacent
try { for (const k of Object.keys(localStorage)) if (k.startsWith("pref-rch-derniere")) localStorage.removeItem(k); } catch (_) {}

// ------------------------------------------------------------------ options : réglages de ce PC (reglages.json), démarrage, classeur
// Options : trois blocs (les cartes, le partage, le programme)
async function vueOptions() {
  if (TELEPHONE) return optionsTelephone();
  vue.innerHTML = `<nav class="fil" aria-label="Fil d'Ariane"><a href="#/">Mes decks</a><span aria-hidden="true">›</span><span aria-current="page">Options</span></nav>
    <div class="opt-grille" id="opt-general"><p class="chargement">Chargement…</p></div>`;
  optionsGenerales($("#opt-general"), await api("/api/options"));
}

// le classeur : un écran à lui (bouton du haut ; sur le téléphone, onglet du bas)
function vueClasseur() {
  vue.innerHTML = `<nav class="fil" aria-label="Fil d'Ariane"><a href="#/">Mes decks</a><span aria-hidden="true">›</span><span aria-current="page">Classeur</span></nav>
    <section class="panneau options" id="opt-classeur"></section>`;
  return classeurOptions($("#opt-classeur"));
}

// Options › Téléphone (sur le PC) : préparer les decks pour l'appli du téléphone, et la relier par un QR code
async function ligneTelephone(el) {
  let t;
  try { t = await api("/api/telephone"); } catch (e) { el.innerHTML = `<p class="erreur petit">${esc(e.message)}</p>`; return; }
  const action = async (a) => { try { t = await api("/api/telephone", { method: "POST", body: { action: a } }); rendre(); } catch (e) { erreur(e); } };
  const rendre = () => {
    if (!t.possible) {
      el.innerHTML = `<p class="muet">Il faut d'abord la sauvegarde en ligne.</p>`;
      return;
    }
    if (!t.voulu) {
      el.innerHTML = `<button type="button" class="btn btn-accent" id="tel-activer">${ico("telephone")}Installer sur mon téléphone</button>`;
      $("#tel-activer", el).onclick = async () => { await action("activer"); if (t.lien) modaleQrTelephone(t.lien); };
      return;
    }
    el.innerHTML = `<p class="${t.erreur ? "erreur" : "muet"} petit">${t.erreur ? esc(t.erreur)
        : t.en_cours ? "Préparation des decks…" : t.derniere ? `${t.decks} deck${t.decks > 1 ? "s" : ""} prêt${t.decks > 1 ? "s" : ""} pour le téléphone · ${esc(new Date(t.derniere * 1000).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }))}` : "Préparation des decks…"}</p>
      <div class="opt-boutons">
        ${t.lien ? `<button type="button" class="btn btn-petit" id="tel-qr">${ico("telephone")}Relier un téléphone</button>` : ""}
        <button type="button" class="btn btn-petit btn-discret" id="tel-couper">Arrêter</button></div>`;
    if ($("#tel-qr", el)) $("#tel-qr", el).onclick = () => modaleQrTelephone(t.lien);
    // le téléphone garde la clé GitHub de ce PC : retirer l'accès est proposé aussitôt
    $("#tel-couper", el).onclick = async () => {
      if (!confirm("Arrêter l'appli du téléphone ? Elle ne recevra plus tes decks.")) return;
      await action("couper");
      const g = await api("/api/github").catch(() => ({}));
      if (g.compte && g.appli) modaleRetirerAcces(g.appli, "Le téléphone garde sa clé de ta sauvegarde.", () => route());
    };
    if (t.en_cours || (!t.derniere && !t.erreur)) setTimeout(async () => {
      if (!el.isConnected) return;
      try { t = await api("/api/telephone"); rendre(); } catch (_) {}
    }, 3000);
  };
  rendre();
}

// le QR code qui relie un téléphone : l'adresse de l'appli, avec le dépôt et la clé GitHub (qui ne quittent pas l'écran)
async function modaleQrTelephone(lien) {
  if (!window.qrcode) {
    await new Promise((ok, ko) => { const s = document.createElement("script"); s.src = "/static/vendor/qrcode.js"; s.onload = ok; s.onerror = ko; document.head.appendChild(s); })
      .catch(() => null);
  }
  if (!window.qrcode) return erreur(new Error("QR code indisponible : recharge la page."));
  const q = qrcode(0, "M");
  q.addData(lien);
  q.make();
  ouvrirModale(`<h2>Atelier sur ton téléphone</h2>
    <div class="qr-telephone">${q.createSvgTag({ cellSize: 6, margin: 3, scalable: true })}</div>
    <ol class="gh-etapes">
      <li>Scanne ce QR code avec l'appareil photo du téléphone.</li>
      <li>Installe l'appli. Android : «&nbsp;Installer l'application&nbsp;». iPhone : Partager › «&nbsp;Sur l'écran d'accueil&nbsp;», puis ouvre l'appli et scanne à nouveau ce code.</li>
    </ol>
    <p class="muet petit">Ce code ouvre tes decks : ne le montre qu'à tes téléphones.</p>
    <div class="boutons"><button class="btn btn-petit" id="qr-copier">${ico("copier")}Copier le lien</button></div>`, (b) => {
    $("#qr-copier", b).onclick = async () => { try { await navigator.clipboard.writeText(lien); toast("Lien copié."); } catch (e) { erreur(e); } };
  });
}

// téléphone : à quel Atelier il est relié, quand les decks sont arrivés, et le classeur (en lecture)
function optionsTelephone() {
  const a = TELEPHONE.acces();
  vue.innerHTML = `<nav class="fil" aria-label="Fil d'Ariane"><a href="#/">Mes decks</a><span aria-hidden="true">›</span><span aria-current="page">Options</span></nav>
    <section class="panneau options"><div class="opt-titre"><h2>${ico("telephone")}Téléphone</h2></div>
      <div class="opt-lignes">${TELEPHONE.installee && !TELEPHONE.installee() ? `
        <p><button class="btn btn-accent" id="tel-installer-app">${ico("telecharger")}Installer l'appli</button></p>` : ""}${a ? `
        <p>Relié à la sauvegarde <strong>${esc(a.depot)}</strong></p>
        <p class="muet petit" id="tel-attente" hidden></p>
        <div class="form-ligne"><button class="btn" id="tel-maj">${ico("rafraichir")}Synchroniser</button>
          <button class="btn btn-danger" id="tel-delier">Délier ce téléphone</button>
          <button class="btn btn-discret" id="tel-retirer">${TOUS_APPAREILS}</button></div>` : `
        <p id="tel-ou">Tes decks sont gardés sur ce téléphone.</p>
        <div id="opt-github"></div>`}
      </div></section>
    <section class="panneau options opt-bloc" id="opt-cartes"></section>
    <section class="panneau options"><div class="opt-titre"><h2>${ico("theme")}Thème</h2></div>
      <div class="segments" role="group" aria-label="Thème" id="opt-theme">${[["", "Auto"], ["light", "Clair"], ["dark", "Sombre"]].map(([k, l]) => {
        const actif = (document.documentElement.dataset.theme || "") === k;
        return `<button type="button" data-theme="${k}" class="${actif ? "actif" : ""}" aria-pressed="${actif}">${l}</button>`;
      }).join("")}</div></section>`;
  $$("#opt-theme button").forEach((b) => b.addEventListener("click", () => {        // le bouton du thème du PC, ici
    const t = b.dataset.theme;
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    try { if (t) localStorage.setItem("theme", t); else localStorage.removeItem("theme"); } catch (_) {}
    $$("#opt-theme button").forEach((x) => { x.classList.toggle("actif", x === b); x.setAttribute("aria-pressed", x === b); });
  }));
  // sans PC : où sont les decks, et à quoi sert GitHub tant qu'on n'est pas connecté
  const ouSont = (g, s) => {
    const p = $("#tel-ou");
    if (p) p.textContent = s.active ? "Tes decks sont sur ce téléphone et sauvegardés en ligne, sur ton compte GitHub."
      : g.compte ? "Tes decks sont gardés seulement sur ce téléphone."
      : "Tes decks sont gardés seulement sur ce téléphone. Avec un compte GitHub (gratuit), sauvegarde-les en ligne : "
        + "tu les retrouves si tu perds ton téléphone, ou sur ton PC, et tu peux les partager.";
  };
  optionsCartes($("#opt-cartes"));                 // les mêmes réglages sur tous les appareils
  if ($("#tel-installer-app")) $("#tel-installer-app").onclick = () => TELEPHONE.installer();
  if (!a) return ligneGithub($("#opt-github"), {}, ouSont);
  const attente = async () => {
    const n = await TELEPHONE.enAttente();
    const el = $("#tel-attente");
    el.textContent = n ? `${n} modification${n > 1 ? "s" : ""} pas encore envoyée${n > 1 ? "s" : ""}` : "";
    el.hidden = !n;
  };
  attente();
  $("#tel-maj").onclick = async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try { await TELEPHONE.envoyer(); } catch (e) { toast(e.message); }
    await TELEPHONE.synchroniser();
    await attente();
    toast(TELEPHONE.erreur || "À jour.");
    b.disabled = false;
  };
  $("#tel-delier").onclick = () => { if (confirm("Délier ce téléphone ? Ses decks en seront effacés (ils restent sur ton PC).")) TELEPHONE.delier(); };
  $("#tel-retirer").onclick = () => modaleRetirerAcces(TELEPHONE.appliGithub);
}

// sans PC : les réglages des cartes, gardés sur ce téléphone (le bloc « Cartes » des Options du PC, sans la langue)
async function optionsCartes(el) {
  const o = await api("/api/options").catch(() => ({ budget: 5 }));
  const budget = (b) => (b == null ? "" : String(b).replace(".", ","));
  el.innerHTML = `<h2>${ico("cartes")}Cartes</h2><div class="opt-lignes">
      <label class="opt-champ"><span>Budget par carte</span><span class="opt-euros"><input class="champ" name="budget" inputmode="decimal" value="${budget(o.budget)}" placeholder="5">€</span></label>
      ${champVisuel(o)}${basculesUB(o)}</div>`;
  el.onchange = async (ev) => {
    const c = ev.target;
    if (!c.name) return;
    try {
      Object.assign(o, await api("/api/options", { method: "POST", body: { [c.name]: c.type === "checkbox" ? c.checked : c.value } }));
      majBudget(o.budget);
      toast(TELEPHONE && !TELEPHONE.local ? "Enregistré : ton PC l'appliquera à tes decks dans quelques minutes."
        : c.name === "langue_cartes" ? "Enregistré : les images changent dans quelques instants." : "Enregistré.");
    } catch (e) { erreur(e); }
    if (c.type === "checkbox") c.checked = !!o[c.name];
    else c.value = budget(o.budget);
  };
  el.onkeydown = (ev) => { if (ev.key === "Enter" && ev.target.matches("input.champ")) ev.target.blur(); };
}

// les champs des options ; ceux des préférences sont aussi demandés une fois au premier lancement (modalePreferences)
const bascule = (nom, oui, texte) => `<label class="opt-bascule"><span>${texte}</span><input type="checkbox" role="switch" name="${nom}" ${oui ? "checked" : ""}></label>`;
const champFermeture = (o) => `<label class="opt-champ"><span>Quand je ferme la page</span><select class="champ" name="fermeture">
      <option value="garder">L'Atelier reste prêt</option>
      <option value="arreter" ${o.fermeture === "arreter" ? "selected" : ""}>L'Atelier s'arrête</option></select></label>`;
const champVisuel = (o) => `<label class="opt-champ"><span>Image des cartes</span><select class="champ" name="langue_cartes">
      <option value="">L'édition la moins chère</option>
      ${Object.entries(o.langues || {}).map(([k, l]) => `<option value="${k}" ${o.langue_cartes === k ? "selected" : ""}>La moins chère en ${esc(l)}</option>`).join("")}</select></label>`;
// « Universes Beyond » ne dit rien à qui débute : des exemples à la première mention
const basculesUB = (o) => bascule("sans_ub_illustrations", o.sans_ub_illustrations, "Éviter les illustrations Universes Beyond (Marvel, Final Fantasy, Seigneur des anneaux…) quand c'est possible")
  + bascule("sans_ub_suggestions", o.sans_ub_suggestions, "Ne pas suggérer de cartes Universes Beyond");

// premier lancement : pas la question de la page fermée, qu'on ne comprend pas avant d'avoir vu que l'Atelier tourne sur
// le PC (elle reste dans les Options)
function modalePreferences(o) {
  ouvrirModale(`<h2>Préférences</h2><div class="opt-lignes">${champVisuel(o)}${basculesUB(o)}</div>
    <div class="boutons"><button class="btn btn-accent" id="ok">Enregistrer</button></div>`, (b) => {
    const champ = (n) => $(`[name="${n}"]`, b);
    $("#ok", b).onclick = async () => {
      try {
        await api("/api/options", { method: "POST", body: {
          langue_cartes: champ("langue_cartes").value, sans_ub_illustrations: champ("sans_ub_illustrations").checked,
          sans_ub_suggestions: champ("sans_ub_suggestions").checked, preferences: true } });
        fermerModale();
        toast("Enregistré.");
      } catch (e) { erreur(e); }
    };
  }, { focus: false });
}

// chaque champ s'enregistre quand on le quitte (ou Entrée), la case tout de suite
function optionsGenerales(el, o) {
  const budget = (b) => (b == null ? "" : String(b).replace(".", ","));
  const bloc = (icone, titre, lignes) => `<section class="panneau options opt-bloc"><h2>${ico(icone)}${titre}</h2><div class="opt-lignes">${lignes}</div></section>`;
  el.innerHTML = bloc("cartes", "Cartes", `
      <label class="opt-champ"><span>Budget par carte</span><span class="opt-euros"><input class="champ" name="budget" inputmode="decimal" value="${budget(o.budget)}" placeholder="${budget(o.budget_defaut)}">€</span></label>
      ${champVisuel(o)}${basculesUB(o)}`)
    + bloc("nuage", "Sauvegarde et partage", `
      <p class="opt-explication">L'Atelier tourne sur ton PC. Avec un compte GitHub, gratuit, il sauvegarde tes decks
        dans un espace privé et publie ceux que tu partages.</p>
      <div id="opt-github"></div>
      <label class="opt-champ"><span>Nom sur les pages partagées</span><input class="champ" name="nom" maxlength="60" value="${esc(o.nom)}" placeholder="${esc(o.github)}"></label>`)
    + bloc("telephone", "Téléphone", `<div id="opt-telephone"></div>`)
    + bloc("options", "L'Atelier", `
      ${o.demarrage == null ? "" : bascule("demarrage", o.demarrage, "Lancer au démarrage de Windows")}
      ${champFermeture(o)}
      <div class="opt-boutons">
        <button type="button" class="btn btn-petit" id="opt-dossier">${ico("dossier")}Ouvrir le dossier</button>
        <button type="button" class="btn btn-petit" id="opt-arreter">${ico("arreter")}Arrêter l'Atelier</button></div>`);
  el.onchange = async (ev) => {
    const c = ev.target;
    if (!c.name) return;
    try {
      const r = await api("/api/options", { method: "POST", body: { [c.name]: c.type === "checkbox" ? c.checked : c.value } });
      Object.assign(o, r);
      majBudget(r.budget);
      $('[name="nom"]', el).placeholder = r.github || $('[name="nom"]', el).placeholder;
      toast("Enregistré.");
    } catch (e) { erreur(e); }
    if (c.type === "checkbox") c.checked = !!o[c.name];
    else c.value = c.name === "budget" ? budget(o.budget) : o[c.name];       // la valeur gardée (nettoyée, ou l'ancienne)
  };
  el.onkeydown = (ev) => { if (ev.key === "Enter" && ev.target.matches("input.champ")) ev.target.blur(); };
  $("#opt-dossier", el).onclick = () => api("/api/ouvrir-dossier", { method: "POST", body: {} }).catch(erreur);
  // la page se recharge sur « L'Atelier n'est pas lancé » (gardée par le navigateur, voir sw.js), avec de quoi le relancer
  $("#opt-arreter", el).onclick = async () => {
    try {
      await api("/api/arreter", { method: "POST", body: {} });
      setTimeout(() => location.reload(), 1500);
    } catch (e) { erreur(e); }
  };
  ligneGithub($("#opt-github", el), o);
  ligneTelephone($("#opt-telephone", el));
}

// le compte GitHub (connecté par code, github.py ; ou celui du partage avec git, reglages.json) et la sauvegarde en ligne
async function ligneGithub(el, o, apres = null) {
  const [g, s] = await Promise.all([api("/api/github").catch(() => ({})), api("/api/sauvegarde").catch(() => ({}))]);
  const nom = $('[name="nom"]');
  if (nom) nom.placeholder = g.compte || o.github || "";
  const encore = () => ligneGithub(el, o, apres);
  const compte = g.git && !g.compte
    ? `<label class="opt-champ"><span>Compte GitHub des pages</span><input class="champ" name="github" maxlength="39" value="${esc(o.github)}" autocomplete="off" spellcheck="false"></label>`
    : `<div class="opt-champ"><span>Compte GitHub</span><span class="opt-github">${g.compte
      ? `<strong>${esc(g.compte)}</strong><button type="button" class="btn btn-petit btn-discret" id="gh-deconnecter">Se déconnecter</button>
        <button type="button" class="btn btn-petit btn-discret" id="gh-retirer">${TOUS_APPAREILS}</button>`
      : `<button type="button" class="btn btn-accent btn-petit" id="gh-options">Se connecter à GitHub</button>`}</span></div>`;
  // la sauvegarde : son interrupteur et où elle en est ; sans connexion (ou d'avant la sauvegarde), le bouton qui la met en place
  const etatTexte = s.erreur ? `<span class="erreur">${esc(s.erreur)}</span>`
    : s.en_cours ? "Sauvegarde en cours…" : s.derniere ? `À jour · ${esc(heureCourte(s.derniere))}` : "";
  // pas connecté : le seul bouton « Se connecter » suffit, la sauvegarde se met en place avec la connexion
  const sauvegarde = s.active ? `<div>
      <label class="opt-bascule"><span>Sauvegarde en ligne</span><input type="checkbox" role="switch" id="sv-bascule" checked></label>
      <div class="opt-sauvegarde petit muet">${etatTexte}
        <button type="button" class="lien-discret" id="sv-maintenant">Sauvegarder maintenant</button>
        ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Voir sur GitHub ↗</a>` : ""}</div></div>`
    : s.connecte && s.prive ? `<label class="opt-bascule"><span>Sauvegarde en ligne</span><input type="checkbox" role="switch" id="sv-bascule"></label>`
    : s.connecte ? `<div class="opt-champ"><span>Sauvegarde en ligne</span><span><button type="button" class="btn btn-petit" id="sv-activer">${ico("nuage")}Sauvegarder mes decks</button></span></div>`
    : "";
  el.innerHTML = compte + sauvegarde;
  if (apres) apres(g, s);
  const deco = $("#gh-deconnecter", el), co = $("#gh-options", el);
  if (deco) deco.onclick = async () => {
    try { await api("/api/github/deconnexion", { method: "POST", body: {} }); encore(); } catch (e) { erreur(e); }
  };
  if (co) co.onclick = () => modaleSauvegarde("sauvegarde", encore);
  const retirer = $("#gh-retirer", el);
  if (retirer) retirer.onclick = () => modaleRetirerAcces(TELEPHONE ? TELEPHONE.appliGithub : g.appli, "", encore);
  const activer = $("#sv-activer", el);
  if (activer) activer.onclick = () => modaleSauvegarde("sauvegarde", encore);
  const b = $("#sv-bascule", el);
  if (b) b.onchange = async () => {
    try {
      if (b.checked) { toast("Sauvegarde…"); await api("/api/sauvegarde", { method: "POST", body: { action: "activer" } }); toast("Decks sauvegardés."); }
      else await api("/api/sauvegarde", { method: "POST", body: { action: "couper" } });
    } catch (e) { erreur(e); }
    encore();
  };
  const maintenant = $("#sv-maintenant", el);
  if (maintenant) maintenant.onclick = async () => {
    maintenant.disabled = true;
    try { await api("/api/sauvegarde", { method: "POST", body: { action: "maintenant" } }); toast("Decks sauvegardés."); }
    catch (e) { erreur(e); }
    encore();
  };
}

// le classeur, présenté comme les résultats de la recherche : en-têtes Coul. · Nom VO · Nom VF · Type · Coût · Qté · Prix
// (un clic trie, un second inverse), 30 cartes par page, en liste ou en images ; la couleur rangée comme Magic-Ville :
// W, U, B, R, G, bicolores, multicolores, incolores, puis les terrains
const COLONNES_CLASSEUR = [["couleur", "Coul."], ["nom", "Nom VO"], ["nomfr", "Nom VF"], ["type", "Type"], ["ccm", "Coût"], ["n", "Qté"], ["prix", "Prix"]];
const TRI_CLASSEUR_DESC = { prix: true, n: true };          // sens naturel : les plus chères, les plus nombreuses d'abord
// cartes par page des listes (recherche, classeur, suggestions) : un seul réglage, choisi en bas de liste
const PAR_PAGE_CHOIX = [30, 60, 120, 240];                  // 30 : comme Magic-Ville ; mêmes valeurs côté serveur (recherche.py)
const parPage = () => { const n = +PREF.get("par-page", 30); return PAR_PAGE_CHOIX.includes(n) ? n : 30; };
const choixParPage = () => `<label class="petit muet">Par page <select class="champ champ-petit" data-par-page>${PAR_PAGE_CHOIX.map((n) =>
  `<option value="${n}" ${n === parPage() ? "selected" : ""}>${n}</option>`).join("")}</select></label>`;
// le bas d'une liste : la pagination au milieu, « Par page » à droite (dès qu'il y a plus de cartes que le plus petit choix)
const basDeListe = (p, total) => (p.pages > 1 || total > PAR_PAGE_CHOIX[0]
  ? `<div class="rch-bas"><div></div><div>${paginationRch(p)}</div><div class="rch-par">${total > PAR_PAGE_CHOIX[0] ? choixParPage() : ""}</div></div>` : "");
function cleCouleur(f) {
  if (/\bLand\b/.test(f.type || "")) return [8];
  const c = (f.couleurs || []).map((k) => "WUBRG".indexOf(k)).filter((i) => i >= 0).sort();
  return !c.length ? [7] : c.length === 1 ? c : [c.length > 2 ? 6 : 5, ...c];
}
const cmpListes = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? -1) !== (b[i] ?? -1)) return (a[i] ?? -1) - (b[i] ?? -1);
  return 0;
};
const mvCarte = (x) => x.info.mv ?? 0;
const estTerrainInfo = (x) => (/\bLand\b/.test(x.info.type || "") ? 1 : 0);
const TRI_CLASSEUR = {
  nom: () => 0,                                              // le nom départage toujours
  nomfr: (a, b) => sansAccent(a.info.fr || a.nom).localeCompare(sansAccent(b.info.fr || b.nom)),
  couleur: (a, b) => cmpListes(cleCouleur(a.info), cleCouleur(b.info)) || mvCarte(a) - mvCarte(b),
  ccm: (a, b) => estTerrainInfo(a) - estTerrainInfo(b) || mvCarte(a) - mvCarte(b),        // les terrains à la fin
  type: (a, b) => ORDRE_TYPES.indexOf(typeCarte(a.info.type)) - ORDRE_TYPES.indexOf(typeCarte(b.info.type)) || mvCarte(a) - mvCarte(b),
  prix: (a, b) => (a.info.prix ?? -1) - (b.info.prix ?? -1),
  n: (a, b) => a.n - b.n,
};

// une carte du classeur au format des résultats de la recherche : même présentation, même fiche
const carteClasseur = (x) => {
  const f = x.info || {};
  return { nom: x.nom, n: x.n, fr: f.fr, cout: f.cout, type: f.type, type_fr: f.fr_type, pt: f.pt, texte: f.texte, texte_fr: f.fr_texte,
    prix: f.prix, prix_lien: f.prix_lien, image: f.image, petite: f.petite, image_dos: (f.dos && f.dos.image) || "", gc: f.gc,
    legal: !["banned", "not_legal"].includes(f.legal), couleurs: f.couleurs || [] };
};

const qteClasseur = (x) => `<span class="cl-qte">
    <button type="button" class="btn-menu ecrit" data-n="${x.n - 1}" aria-label="Un de moins : ${esc(x.nom)}" title="Un de moins">${ico("moins")}</button>
    <span class="cl-n">${x.n}</span>
    <button type="button" class="btn-menu ecrit" data-n="${x.n + 1}" aria-label="Un de plus : ${esc(x.nom)}" title="Un de plus">${ico("plus")}</button></span>`;

function ligneClasseur(x, i) {
  const cher = (x.prix || 0) > BUDGET;
  const apercu = `data-image="${esc(x.image)}" data-legende="${esc(`${x.fr || x.nom} — ${prixRch(x)}`)}" ${cher ? 'data-cher="1"' : ""}`;
  const texte = (x.texte_fr || x.texte || "").split("\n").map((l) => l.trim() === "//" ? "<hr>" : l.trim() ? `<p>${texteMana(l)}</p>` : "").join("");
  return `<article class="rch-carte" data-i="${i}" data-nom="${esc(x.nom)}">
    <button type="button" class="rch-vignette" data-act="ouvrir" ${apercu} aria-label="Fiche de ${esc(x.nom)}">
      ${x.petite ? `<img src="${esc(x.petite)}" alt="" loading="lazy">` : `<span class="sans-image">${esc(x.nom)}</span>`}</button>
    <div class="rch-vo"><button type="button" class="rch-nom" data-act="ouvrir" ${apercu}>${esc(x.nom)}</button></div>
    <div class="rch-vf">${x.fr && x.fr !== x.nom ? `<button type="button" class="rch-nom" data-act="ouvrir" ${apercu}>${esc(x.fr)}</button>` : ""}</div>
    <div class="rch-typecourt">${esc(TYPE_COURT[typeCarte(x.type)] || "")}</div>
    <div class="rch-cm">${mana(x.cout)}</div>
    ${qteClasseur(x)}
    <div class="rch-prix"><a class="prix ${cher ? "cher" : ""}" href="${esc(x.prix_lien || lienCardmarket(x.nom))}" target="_blank" rel="noopener" title="Cardmarket">${prixRch(x)}</a></div>
    <div class="rch-detail">
      <div class="rch-type">${esc(x.type_fr || x.type || "")}</div>
      ${texte ? `<div class="rch-texte fs-texte">${texte}</div>` : ""}
      ${x.pt ? `<div class="rch-pt">${esc(x.pt.replace(/loyauté (\S+)/g, "Loy. $1"))}</div>` : ""}
    </div>
  </article>`;
}

function carteImageClasseur(x, i) {
  const cher = (x.prix || 0) > BUDGET;
  return `<div class="carte-v rch-carte-v" data-i="${i}" data-nom="${esc(x.nom)}">
    <button type="button" class="pile" data-act="ouvrir" aria-label="${esc(x.nom)} : fiche">${imageCarte({ petite: x.petite, image: x.image, nom: x.nom }, "recto")}</button>
    <div class="legende-v"><span class="nom-v" title="${esc(x.nom + (x.fr && x.fr !== x.nom ? " — " + x.fr : ""))}">${esc(x.fr || x.nom)}</span><span class="prix-v ${cher ? "cher" : ""}">${prixRch(x)}</span></div>
    <div class="rch-actions-v">${qteClasseur(x)}</div>
  </div>`;
}

// le classeur : les cartes qu'on a en dehors des decks (Classeur/classeur.txt, sur ce PC seulement)
async function classeurOptions(el) {
  let cartes = [], vus = [], page = 1;
  let tri = PREF.get("tri-classeur", "nom");
  if (!TRI_CLASSEUR[tri]) tri = "nom";
  let sens = PREF.get("sens-classeur", TRI_CLASSEUR_DESC[tri] ? "desc" : "asc");
  let vueImages = PREF.get("vue-classeur", "liste") === "images";
  el.innerHTML = `<div class="opt-titre"><h2>${ico("livre")}Classeur</h2>
      <label class="btn btn-petit btn-discret ecrit" id="cl-importer">${ico("dossier")}Importer une collection…<input type="file" class="fichier-cache" accept=".csv,.txt,text/csv,text/plain"></label>
      <button type="button" class="btn btn-petit btn-discret" id="cl-copier">${ico("copier")}Copier la liste</button></div>
    <div class="cl-outils"><div id="cl-ajout" class="ecrit"></div><input class="champ" id="cl-filtre" type="search" placeholder="Filtrer…" aria-label="Filtrer le classeur"></div>
    <details class="cl-coller ecrit"><summary>Coller une liste</summary>
      <textarea class="champ" id="cl-liste" rows="6" placeholder="1 Sol Ring&#10;2 Lightning Bolt&#10;…"></textarea>
      <div class="boutons"><button class="btn btn-accent btn-petit" id="cl-ajouter">Ajouter au classeur</button></div></details>
    <details class="cl-coller" id="cl-partagees"><summary>Dans plusieurs decks</summary><div id="cl-partagees-res"></div></details>
    <div id="cl-res"><p class="chargement">Chargement…</p></div>`;
  const res = $("#cl-res", el), filtre = $("#cl-filtre", el);
  const nb = (l) => l.reduce((s, x) => s + x.n, 0);
  const entete = () => `<div class="rch-cols">${COLONNES_CLASSEUR.map(([k, l]) => {
    const actif = tri === k;
    return `<button type="button" class="rch-col ${actif ? "actif" : ""}" data-tri="${k}" aria-pressed="${actif}">${l}${actif ? `<span aria-label="${sens === "desc" ? "décroissant" : "croissant"}">${sens === "desc" ? "↓" : "↑"}</span>` : ""}</button>`;
  }).join("")}</div>`;
  const rendre = () => {
    const q = sansAccent(filtre.value.trim()), dir = sens === "desc" ? -1 : 1;
    vus = cartes.filter((x) => !q || sansAccent(x.nom + " " + (x.info.fr || "")).includes(q))
      .sort((a, b) => dir * TRI_CLASSEUR[tri](a, b) || (tri === "nom" ? dir : 1) * a.nom.localeCompare(b.nom)).map(carteClasseur);
    const par = parPage(), pages = Math.max(1, Math.ceil(vus.length / par));
    page = Math.min(Math.max(1, page), pages);
    const debut = (page - 1) * par, r = { page, pages }, n = nb(vus);
    res.innerHTML = `
      <div class="rch-entete">
        <div class="rch-compte"><strong>${sepMilliers(n)} carte${n > 1 ? "s" : ""}</strong> <span class="muet">· ${euros(vus.reduce((s, x) => s + (x.prix || 0) * x.n, 0))}</span></div>
        ${paginationRch(r)}
        <div class="rch-outils"><div class="segments" role="group" aria-label="Affichage">${[["liste", "Liste"], ["images", "Images"]].map(([k, l]) =>
          `<button type="button" data-vue="${k}" class="${(k === "images") === vueImages ? "actif" : ""}" aria-pressed="${(k === "images") === vueImages}">${l}</button>`).join("")}</div></div>
      </div>
      ${vus.length ? `<div class="rch-liste ${vueImages ? "etale" : "avec-images cl-table"}">${vueImages ? "" : entete()}${vus.slice(debut, debut + par)
        .map((x, j) => (vueImages ? carteImageClasseur : ligneClasseur)(x, debut + j)).join("")}</div>`
        : `<div class="panneau vide"><p>Aucune carte.</p></div>`}
      ${basDeListe(r, vus.length)}`;
  };
  const modifier = async (corps) => {
    const avant = nb(cartes);
    const r = await api("/api/classeur", { method: "POST", body: corps });
    cartes = r.cartes;
    rendre();
    return { n: nb(cartes) - avant, inconnues: r.inconnues };
  };
  res.onclick = async (ev) => {
    const col = ev.target.closest(".rch-col");
    if (col) {                                               // en-tête : trier, ou inverser l'ordre
      if (col.dataset.tri === tri) sens = sens === "desc" ? "asc" : "desc";
      else { tri = col.dataset.tri; sens = TRI_CLASSEUR_DESC[tri] ? "desc" : "asc"; }
      PREF.set("tri-classeur", tri);
      PREF.set("sens-classeur", sens);
      page = 1;
      return rendre();
    }
    const v = ev.target.closest("[data-vue]");
    if (v) {
      vueImages = v.dataset.vue === "images";
      PREF.set("vue-classeur", v.dataset.vue);
      return rendre();
    }
    const p = ev.target.closest("[data-page]");
    if (p) {
      const bas = !!p.closest(".rch-bas");
      page = +p.dataset.page;
      rendre();
      if (bas) res.scrollIntoView({ block: "start" });
      return;
    }
    const b = ev.target.closest("[data-n]");
    if (b) {
      b.disabled = true;
      try { await modifier({ nom: b.closest("[data-nom]").dataset.nom, n: +b.dataset.n }); } catch (e) { erreur(e); b.disabled = false; }
      return;
    }
    const o = ev.target.closest('[data-act="ouvrir"]');
    if (o) ficheRecherche(+o.closest("[data-i]").dataset.i, { liste: vus, deck: null });
  };
  res.onchange = (ev) => {
    if (ev.target.matches("[data-par-page]")) { PREF.set("par-page", ev.target.value); page = 1; return rendre(); }
    if (!ev.target.matches(".rch-page")) return;
    page = +ev.target.value || 1;
    rendre();
  };
  filtre.oninput = () => { page = 1; rendre(); };
  const rech = rechercheCarte($("#cl-ajout", el), { deck: () => null, placeholder: "Ajouter une carte…",
    surChoix: async (x) => {
      try { await modifier({ liste: "1 " + x.nom }); toast(`${x.fr || x.nom} : dans le classeur.`); rech.vider(); } catch (e) { erreur(e); }
    } });
  $("#cl-ajouter", el).onclick = async (ev) => {
    const t = $("#cl-liste", el), b = ev.currentTarget;
    if (!t.value.trim()) return;
    b.disabled = true;
    try {
      const { n, inconnues } = await modifier({ liste: t.value });
      t.value = inconnues.join("\n");                 // les introuvables restent, à corriger
      toast([n && `${n} carte${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""}.`,
        inconnues.length && `Introuvable${inconnues.length > 1 ? "s" : ""} : ${inconnues.join(", ")}`].filter(Boolean).join(" "));
    } catch (e) { erreur(e); }
    b.disabled = false;
  };
  $("#cl-importer input", el).onchange = async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = "";
    if (f) importerCollection(f, cartes.length, (nouv) => { cartes = nouv; page = 1; rendre(); });
  };
  $("#cl-partagees", el).ontoggle = (ev) => { if (ev.target.open) cartesPartagees($("#cl-partagees-res", el)); };
  $("#cl-copier", el).onclick = async () => {
    try {
      await navigator.clipboard.writeText(cartes.map((x) => `${x.n} ${x.nom}`).join("\n") + "\n");
      toast("Liste copiée.");
    } catch (e) { erreur(e); }
  };
  try {
    cartes = (await api("/api/classeur")).cartes;
    rendre();
  } catch (e) { res.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
}

// une collection exportée d'une autre appli (CSV de ManaBox, Moxfield, Archidekt… ou liste) : aperçu, puis ajout au
// classeur, sans les exemplaires déjà notés dans les decks (le classeur, c'est ce qui n'est pas dans un deck)
async function importerCollection(fichier, dejaLa, fin) {
  let texte, a;
  try {
    texte = await fichier.text();
    toast("Lecture de la collection…", 60000);
    a = await api("/api/classeur/importer", { method: "POST", body: { texte, apercu: true } });
    toast("Collection lue.", 1);
  } catch (e) { return erreur(e); }
  if (!a.cartes) return toast("Aucune carte reconnue dans ce fichier.");
  ouvrirModale(`
    <h2>Importer une collection</h2>
    <p><strong>${sepMilliers(a.cartes)} carte${a.cartes > 1 ? "s" : ""}</strong> dans ${esc(fichier.name)}</p>
    ${a.en_decks ? `<label class="petit"><input type="checkbox" id="ic-sans" checked> Sans les ${sepMilliers(a.en_decks)} déjà dans mes decks</label>` : ""}
    ${a.inconnues.length ? `<details class="petit"><summary>${a.inconnues.length} introuvable${a.inconnues.length > 1 ? "s" : ""}</summary>
      <p class="muet">${a.inconnues.map(esc).join(", ")}</p></details>` : ""}
    <div class="boutons">
      ${dejaLa ? `<button class="btn" id="ic-remplacer">Remplacer le classeur</button>` : ""}
      <button class="btn btn-accent" id="ok">Ajouter au classeur</button></div>`, (b) => {
    const importer = async (remplacer, bouton) => {
      $$(".boutons .btn", b).forEach((x) => { x.disabled = true; });
      bouton.textContent = "Import…";
      try {
        const sans = $("#ic-sans", b);
        const r = await api("/api/classeur/importer", { method: "POST", body: { texte, remplacer, sans_decks: !!(sans && sans.checked) } });
        fermerModale();
        fin(r.classeur);
        toast("Collection importée.");
      } catch (e) {
        erreur(e);
        $$(".boutons .btn", b).forEach((x) => { x.disabled = false; });
      }
    };
    $("#ok", b).onclick = (ev) => importer(false, ev.currentTarget);
    if ($("#ic-remplacer", b)) $("#ic-remplacer", b).onclick = (ev) => importer(true, ev.currentTarget);
  });
}

// les cartes jouées dans plusieurs decks : combien j'en ai (classeur et decks) pour combien il en faut
async function cartesPartagees(el) {
  el.innerHTML = `<p class="chargement">Chargement…</p>`;
  try {
    const idx = await api("/api/ou-sont");
    const l = Object.entries(idx).filter(([, x]) => x.decks.length > 1)
      .map(([nom, x]) => ({ nom, fr: x.fr, decks: x.decks, ai: x.classeur + x.decks.reduce((s, y) => s + y[2], 0), faut: x.decks.reduce((s, y) => s + y[1], 0) }))
      .sort((a, b) => b.decks.length - a.decks.length || (a.fr || a.nom).localeCompare(b.fr || b.nom, "fr"));
    el.innerHTML = l.length ? `<div class="cl-partagees">${l.map((x) => `<div class="ligne ligne-partagee">
        <span class="nom"><span class="en">${esc(x.nom)}</span>${x.fr && x.fr !== x.nom ? `<span class="fr">${esc(x.fr)}</span>` : ""}</span>
        <span class="petit muet">${x.decks.map(([id]) => esc(id.replace(/^Deck /, ""))).join(", ")}</span>
        <span class="petit ${x.ai < x.faut ? "manque" : "muet"}" title="J'en ai ${x.ai}, les decks en jouent ${x.faut}">${x.ai} / ${x.faut}</span>
      </div>`).join("")}</div>` : `<p class="muet petit">Aucune.</p>`;
  } catch (e) { el.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
}

async function supprimerDeck(d) {
  if (!confirm(`Supprimer le deck « ${d.titre} » ?`)) return;
  try {
    await api(`/api/decks/${enc(d.id)}/supprimer`, { method: "POST" });
    etat.deck = null;
    etat.decks = [];
    location.hash = "#/";
    toast(`Deck « ${d.titre} » supprimé.`);
  } catch (e) { erreur(e); }
}

// ------------------------------------------------------------------ onglet Liste : rangement, tri, filtre
const TITRE_ALERTE = {
  "hors couleurs": "Une de ses couleurs n'est pas dans l'identité de ton commandant : interdite dans ce deck",
  "ne peut pas être commandant": "Seules les créatures légendaires (et quelques planeswalkers, véhicules ou vaisseaux qui le disent) peuvent être commandant",
  "partenaires incompatibles": "Deux commandants seulement s'ils vont ensemble : Partner (ou Partner with l'autre), Friends forever, Historique (Choose a Background), compagnon du Docteur",
  "trop de commandants": "Un commandant, ou deux s'ils sont partenaires",
  "en double": "Une seule copie par carte en Commander (sauf les terrains de base et les cartes qui le permettent)",
  "interdite": "Carte bannie en Commander",
  "non légale": "Carte non légale en Commander (carte Un-, Alchimie…)",
};
const AFFICHAGE = "visuel";                              // affichage par défaut d'un deck : les images d'abord, partout
const ORDRE_TYPES = ["Créatures", "Planeswalkers", "Batailles", "Éphémères", "Rituels", "Artefacts", "Enchantements", "Terrains", "Autres"];
// fonctions (Scryfall Tagger, familles calculées par recherche.fonctions_cartes) : une carte est rangée sous la première des siennes
const ORDRE_FONCTIONS = ["Ramp", "Pioche", "Tuteurs", "Removal", "Balayages", "Contresorts", "Recursion", "Protection", "Autres", "Terrains"];
const fonctionPrincipale = (c) => (estTerrain(c) ? "Terrains" : (c.fonctions || [])[0] || "Autres");
const ABREV = { "Créatures": "Cré", "Planeswalkers": "PW", "Batailles": "Bat", "Éphémères": "Éph", "Rituels": "Rit", "Artefacts": "Art",
  "Enchantements": "Ench", "Terrains": "Ter", "Autres": "?" };

function typeCarte(t) {
  t = t || "";
  if (/\bLand\b/.test(t)) return "Terrains";
  if (/\bCreature\b/.test(t)) return "Créatures";
  if (/\bPlaneswalker\b/.test(t)) return "Planeswalkers";
  if (/\bBattle\b/.test(t)) return "Batailles";
  if (/\bInstant\b/.test(t)) return "Éphémères";
  if (/\bSorcery\b/.test(t)) return "Rituels";
  if (/\bArtifact\b/.test(t)) return "Artefacts";
  if (/\bEnchantment\b/.test(t)) return "Enchantements";
  return "Autres";
}

const estBase = (c) => /^Basic\b/.test(c.info.type || "");
const nomAffiche = (c) => c.info.fr || c.nom;
const TRIS = {
  cout: (a, b) => (estBase(b) - estBase(a)) || (a.info.mv || 0) - (b.info.mv || 0) || a.nom.localeCompare(b.nom),
  nom: (a, b) => a.nom.localeCompare(b.nom),
  prix: (a, b) => (b.info.prix || 0) - (a.info.prix || 0) || a.nom.localeCompare(b.nom),
};

function correspond(c, q) {
  q = (q || "").trim();
  if (!q) return true;
  if (q.startsWith("#")) {                      // clic sur un tag : ce tag exactement
    const t = sansAccent(q.slice(1));
    return c.tags.some((x) => sansAccent(x) === t);
  }
  const h = sansAccent([c.nom, c.info.fr, c.info.type, typeCarte(c.info.type), ...c.tags, ...(c.fonctions || []), ...(c.fonctions_detail || [])].join(" | "));
  return sansAccent(q).split(/\s+/).every((m) => h.includes(m));
}

function grouper(cartes, rangement) {
  const g = new Map();
  const ajoute = (cle, c) => { if (!g.has(cle)) g.set(cle, []); g.get(cle).push(c); };
  for (const c of cartes) {
    if (c.cat === "Commander") ajoute("Commandant", c);
    else if (c.cat === "Maybeboard") ajoute("Maybeboard", c);
    else ajoute(rangement === "tags" ? c.cat : rangement === "fonction" ? fonctionPrincipale(c) : typeCarte(c.info.type), c);
  }
  const rang = (k) => k === "Commandant" ? -1 : k === "Maybeboard" ? 999
    : rangement === "tags" ? (k === "Sans catégorie" ? 998 : 0)
    : (rangement === "fonction" ? ORDRE_FONCTIONS : ORDRE_TYPES).indexOf(k);
  return [...g.keys()].sort((a, b) => rang(a) - rang(b)).map((k) => ({ cat: k, cartes: g.get(k) }));
}

function legendeCarte(c) {
  const f = c.info || {};
  return `${f.fr && f.fr !== c.nom ? f.fr + " — " : ""}${f.prix == null ? "prix inconnu" : euros(f.prix)}${f.prix_edition ? ` (${f.prix_edition})` : ""}${f.gc ? " · Game Changer" : ""}`;
}

// sur le téléphone, les réglages moins courants d'une barre d'outils (.pli) se replient derrière ce bouton
function boutonPlis(libelle, ouvert = false) {
  return `<button type="button" class="btn btn-icone outils-plus" aria-label="${esc(libelle)}" title="${esc(libelle)}" aria-expanded="${ouvert}">${ico("reglages")}</button>`;
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest(".outils-plus");
  if (b) b.setAttribute("aria-expanded", b.closest(".repliable").classList.toggle("ouvert"));
});

function segments(pref, valeurs, def) {
  const v = PREF.get(pref, def);
  return `<div class="segments" role="group">${valeurs.map(([k, l, i]) =>
    `<button type="button" data-pref="${pref}" data-val="${k}" class="${k === v ? "actif" : ""}" aria-pressed="${k === v}" ${i ? `aria-label="${l}"` : ""}>${i ? ico(i) : ""}<span class="seg-txt">${l}</span></button>`).join("")}</div>`;
}

function ongletListe(el, d) {
  el.innerHTML = `
    ${!d.cartes.length ? `<div class="panneau vide"><p>Ce deck est vide.</p><button class="btn btn-accent ecrit" id="vide-ajouter">${ico("plus")}Ajouter des cartes</button></div>` : `
    <div class="barre-outils repliable">
      ${segments("affichage", [["visuel", "Visuel", "cartes"], ["liste", "Liste", "liste"]], AFFICHAGE)}
      <label class="outil pli petit muet" id="outil-taille" ${PREF.get("affichage", AFFICHAGE) === "visuel" ? "" : "hidden"}>Taille
        <input type="range" id="taille" min="80" max="220" step="5" value="${tailleCartes()}" aria-label="Taille des cartes"></label>
      <label class="outil pli petit muet">Ranger par
        <select class="champ champ-petit" id="rangement">${[["type", "type"], ["tags", "tags"], ["fonction", "fonction"]].map(([v, l]) =>
          `<option value="${v}" ${PREF.get("rangement", "type") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="outil pli petit muet">Trier par
        <select class="champ champ-petit" id="tri">${[["cout", "coût"], ["nom", "nom"], ["prix", "prix"]].map(([v, l]) =>
          `<option value="${v}" ${PREF.get("tri", "cout") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <input class="champ filtre" id="filtre" type="search" placeholder="Filtrer…" value="${esc(etat.filtre)}" aria-label="Filtrer les cartes">
      ${boutonPlis("Rangement et tri")}
    </div>
    <div id="groupes"></div>
    <h2>Statistiques</h2>
    <div id="resume-stats">${resumeStats(d)}</div>`}`;
  if (!d.cartes.length) { $("#vide-ajouter", el).onclick = () => modaleAjout(); return; }

  const zone = $("#groupes", el);
  const rendre = () => rendreGroupes(zone, d);
  rendre();
  $$(".segments button", el).forEach((b) => b.addEventListener("click", () => {
    PREF.set(b.dataset.pref, b.dataset.val);
    $$(`.segments button[data-pref="${b.dataset.pref}"]`, el).forEach((x) => {
      x.classList.toggle("actif", x === b);
      x.setAttribute("aria-pressed", x === b);
    });
    $("#outil-taille", el).hidden = PREF.get("affichage", AFFICHAGE) !== "visuel";
    rendre();
  }));
  // la taille change en direct ; les images sont rechoisies (petite ou grande) au relâcher
  $("#taille", el).oninput = (ev) => {
    $$(".flot", zone).forEach((g) => {
      g.style.setProperty("--l", ev.target.value + "px");
      g.classList.toggle("serre", +ev.target.value < SERRE);
    });
    ajusterTitres(zone);
  };
  $("#taille", el).onchange = (ev) => { PREF.set("taille-cartes", ev.target.value); rendre(); };
  $("#tri", el).onchange = (ev) => { PREF.set("tri", ev.target.value); rendre(); };
  $("#rangement", el).onchange = (ev) => { PREF.set("rangement", ev.target.value); rendre(); };
  $("#filtre", el).oninput = (ev) => { etat.filtre = ev.target.value; rendre(); };
  zone.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-tag]");
    if (t) {
      etat.filtre = t.dataset.tag;
      $("#filtre", el).value = etat.filtre;
      rendre();
      return;
    }
    if (ev.target.closest("a")) return;          // le prix ouvre Cardmarket
    const m = ev.target.closest("[data-carte]");
    if (m) ouvrirCarte(d.cartes[+m.dataset.carte]);
  });
}

function rendreGroupes(zone, d) {
  const visuel = PREF.get("affichage", AFFICHAGE) === "visuel";
  const rangement = PREF.get("rangement", "type");
  const tri = TRIS[PREF.get("tri", "cout")] || TRIS.cout;
  const groupes = grouper(d.cartes.filter((c) => correspond(c, etat.filtre)), rangement);
  if (!groupes.length) { etat.ordre = []; zone.innerHTML = `<p class="muet">Aucune carte ne correspond à « ${esc(etat.filtre)} ».</p>`; return; }
  groupes.forEach((g) => g.cartes.sort(tri));
  etat.ordre = groupes.flatMap((g) => g.cartes.map((c) => c.index));     // pour « carte précédente / suivante » dans la fiche
  const entete = (g, cartes) => {
    const n = cartes.reduce((s, c) => s + c.n, 0);
    const prix = cartes.reduce((s, c) => s + (c.info.prix || 0) * c.n, 0);
    return [`<span class="nb-groupe">${n}</span> ${esc(g.cat)} <span class="muet petit">${euros(prix)}</span>`, `${n} ${g.cat} · ${euros(prix)}`];
  };
  if (visuel) {
    // vue Visuel façon Magic-Ville : les catégories s'enchaînent sans changer de ligne, le titre au-dessus de la première carte ;
    // le Maybeboard à part, sous le deck
    const t = tailleCartes();
    const flot = (gs, cls = "") => !gs.length ? "" : `<div class="flot ${cls} ${t < SERRE ? "serre" : ""}" style="--l:${t}px">${gs.map((g) => {
      // les commandants sont dans l'en-tête du deck (sauf s'ils n'ont pas d'image)
      const cartes = g.cat === "Commandant" ? g.cartes.filter((c) => !c.info.image) : g.cartes;
      if (!cartes.length) return "";
      const [html, titre] = entete(g, cartes);
      const tete = `<span class="flot-titre" style="--n:${cartes.length}" title="${esc(titre)}">${html}</span>`;
      return cartes.map((c, i) => carteVisuelle(c, i ? "" : tete, i === cartes.length - 1, t)).join("");
    }).join("")}</div>`;
    zone.innerHTML = flot(groupes.filter((g) => g.cat !== "Maybeboard"))
      + flot(groupes.filter((g) => g.cat === "Maybeboard"), "flot-maybe");
    ajusterTitres(zone);
    return;
  }
  zone.innerHTML = groupes.map((g) => `<div class="groupe ${g.cat === "Maybeboard" ? "groupe-maybe" : ""}">
      <div class="groupe-titre">${entete(g, g.cartes)[0]}</div>
      ${g.cartes.map((c) => ligneCarte(c, rangement)).join("")}
    </div>`).join("");
}

const SERRE = 130;                       // en dessous, la légende garde le nom et seuls les prix au-dessus du budget
function tailleCartes() {
  const t = +PREF.get("taille-cartes", 115);
  return t >= 80 && t <= 220 ? t : 115;
}

// un titre de catégorie qui commence en fin de ligne s'arrête au bord (avec « … ») au lieu d'être coupé net
function ajusterTitres(zone) {
  $$(".flot", zone).forEach((g) => {
    const droite = g.getBoundingClientRect().right;
    $$(".flot-titre", g).forEach((x) => x.style.setProperty("--reste", Math.max(0, droite - x.getBoundingClientRect().left) + "px"));
  });
}
let ajustement = 0;
addEventListener("resize", () => {
  cancelAnimationFrame(ajustement);
  ajustement = requestAnimationFrame(() => { const z = $("#groupes"); if (z) ajusterTitres(z); });
});

function badgesAlerte(c) {
  return (c.alertes || []).map((a) => `<span class="badge badge-alerte" title="${esc(TITRE_ALERTE[a] || "")}">${esc(a)}</span>`).join("");
}

function ligneCarte(c, rangement) {
  const f = c.info || {};
  const tags = c.tags.filter((t) => t !== "Maybeboard" && t !== "Commander" && !(rangement === "tags" && t === c.cat));
  const cher = (f.prix || 0) > BUDGET;
  return `<div class="ligne ligne-carte" data-carte="${c.index}">
    <span class="qte">${c.n > 1 ? c.n + "×" : ""}</span>
    <span class="nom"><span class="en" data-image="${esc(f.image)}" data-legende="${esc(legendeCarte(c))}" ${cher ? 'data-cher="1"' : ""}>${esc(c.nom)}</span>${f.fr && f.fr !== c.nom ? `<span class="fr" data-image="${esc(f.image)}" data-legende="${esc(legendeCarte(c))}" ${cher ? 'data-cher="1"' : ""}>${esc(f.fr)}</span>` : ""}
      ${tags.map((t) => `<button type="button" class="tag" data-tag="#${esc(t)}" title="Voir toutes les cartes « ${esc(t)} »">${esc(t)}</button>`).join("")}</span>
    ${mana(f.cout)}
    <span class="badges">
      ${badgesAlerte(c)}
      ${f.gc ? `<span class="badge badge-gc" title="Game Changer : compte dans le bracket (3 maximum en bracket 3)">Game Changer</span>` : ""}
      ${cher ? `<span class="badge badge-cher" title="Au-dessus de ton budget de ${BUDGET_TXT} par carte">&gt; ${BUDGET_TXT}</span>` : ""}
    </span>
    ${f.prix_lien ? `<a class="prix ${cher ? "cher" : ""}" href="${esc(f.prix_lien)}" target="_blank" rel="noopener" title="${esc(f.prix_edition ? `Le moins cher : ${f.prix_edition}. ` : "")}Voir sur Cardmarket">${euros(f.prix)}</a>` : `<span class="prix muet">${euros(f.prix)}</span>`}
    <button class="btn-menu" aria-label="Fiche et actions : ${esc(c.nom)}" title="Fiche et actions">${ico("plus_de")}</button>
  </div>`;
}

// vue « étalée » façon Magic-Ville : les images, empilées quand il y a plusieurs exemplaires
function imageCarte(f, cls, style = "", taille = 170) {
  const src = f.petite || f.image;
  if (!src) return `<span class="${cls} sans-image" ${style}>${esc(f.nom || "?")}</span>`;
  const srcset = f.petite && f.image ? `srcset="${esc(f.petite)} 146w, ${esc(f.image)} 488w" sizes="${taille}px"` : "";
  return `<img class="${cls}" ${style} src="${esc(src)}" ${srcset} alt="" loading="lazy">`;
}

// tete : titre de la catégorie (sur sa première carte) ; fin : dernière carte de la catégorie
function carteVisuelle(c, tete = "", fin = false, taille = 170) {
  const f = c.info || {};
  const nb = Math.min(c.n, 4);
  const cher = (f.prix || 0) > BUDGET;
  const t = Math.round(taille * 1.1);
  const couches = [];
  for (let k = nb - 1; k >= 1; k--) couches.push(imageCarte(f, "couche", `style="--k:${k}"`, t));
  const marques = [
    f.gc ? `<span class="marque marque-gc" title="Game Changer">GC</span>` : "",
    ...(c.alertes || []).map((a) => `<span class="marque marque-alerte" title="${esc(TITRE_ALERTE[a] || "")}">${esc(a)}</span>`),
  ].join("");
  return `<div class="carte-v ${tete ? "debut" : ""} ${fin ? "fin" : ""} ${nb > 1 ? "empile" : ""}">${tete}
    <button type="button" class="pile" data-carte="${c.index}" data-survol="${c.index}" aria-label="${esc(c.nom)} : fiche et actions">${couches.join("")}${imageCarte(f, "recto", "", t)}${marques ? `<span class="marques">${marques}</span>` : ""}</button>
    <div class="legende-v" title="${esc(c.nom + (f.fr && f.fr !== c.nom ? " — " + f.fr : ""))}">
      ${c.n > 1 ? `<span class="qte-v">${c.n}</span>` : ""}<span class="nom-v">${esc(nomAffiche(c))}</span>
      <span class="prix-v ${cher ? "cher" : ""}">${euros(f.prix)}</span>
    </div>
  </div>`;
}

// recto-verso : un bouton sous l'image pour retourner la carte (Delver, Valakut Awakening…)
function boutonVerso(dos) {
  if (!dos || !dos.image) return "";
  return `<button type="button" class="lien-discret fc-retourner" data-act="retourner" title="${esc(dos.nom)} · ${esc(dos.type || "")}">${ico("rafraichir")}Voir le verso</button>`;
}

function retournerCarte(boite) {
  const img = $(".fc-image img", boite), b = $('[data-act="retourner"]', boite);
  if (!img || !img.dataset.verso) return;
  const verso = img.src !== img.dataset.verso;
  img.src = verso ? img.dataset.verso : img.dataset.recto;
  b.innerHTML = ico("rafraichir") + (verso ? "Voir le recto" : "Voir le verso");
}

// cartes qui s'assemblent (Bruna + Gisela = Brisela)
function assembleHtml(a) {
  if (!a || !a.resultat) return "";
  return a.est_resultat
    ? `<p class="note petit">Formée par ${a.pieces.map(esc).join(" + ")}.</p>`
    : `<p class="note petit">S'assemble avec <strong>${a.pieces.map(esc).join(" et ")}</strong> → <strong>${esc(a.resultat)}</strong></p>`;
}

document.addEventListener("click", (ev) => {
  const b = ev.target.closest('#modale [data-act="retourner"]');
  if (b) { ev.stopPropagation(); retournerCarte(b.closest(".fiche-carte")); }
}, true);

// fiche d'une carte (clic gauche sur une carte, en liste ou en visuel) : grande image, texte, prix, tags et actions
// où est cette carte : le classeur et les autres decks qui la jouent, pour ne pas racheter une carte qu'on a déjà
// (« à acheter » : ce deck la joue, mais elle n'y est pas encore)
async function ouEst(el, nom, deckId = null) {
  if (PARTAGE || !el) return;
  try {
    const x = (await api("/api/ou-sont?nom=" + enc(nom)))[nom] || { classeur: 0, decks: [] };
    const autres = x.decks.filter(([id]) => id !== deckId);
    const morceaux = [];
    if (x.classeur) morceaux.push(`${ico("livre")}Classeur : ${x.classeur}`);
    if (autres.length) morceaux.push(`${ico("cartes")}${deckId ? "Aussi dans" : "Dans"} ${autres.map(([id, n, ai]) =>
      `<a href="#/deck/${enc(id)}">${esc(id.replace(/^Deck /, ""))}</a>${ai < n ? ` <span class="muet">(à acheter)</span>` : ""}`).join(", ")}`);
    el.innerHTML = morceaux.map((m) => `<span>${m}</span>`).join("");
    el.hidden = !morceaux.length;
  } catch (_) { el.hidden = true; }
}

function ouvrirCarte(c) {
  if (!c) return;
  const d = etat.deck;
  const f = c.info || {};
  const ordre = etat.ordre || [];
  const pos = ordre.indexOf(c.index);
  const maybe = c.tags.includes("Maybeboard");
  const cmd = c.cat === "Commander";
  const legendaire = f.peut_commander != null ? f.peut_commander
    : /Legendary Creature|Background/.test(f.type || "") || /can be your commander/i.test(f.texte || "");
  const second = !cmd && (d.commandants || []).length === 1;              // il y a déjà un commandant : celle-ci serait le second
  const cher = (f.prix || 0) > BUDGET;
  const tags = c.tags.filter((t) => t !== "Maybeboard" && t !== "Commander");
  ouvrirModale(`
    <div class="fiche-carte">
      <div class="fc-image">${f.image ? `<img src="${esc(f.image)}" alt="${esc(c.nom)}" data-recto="${esc(f.image)}" data-verso="${esc((f.dos && f.dos.image) || "")}">` : `<div class="sans-image">${esc(c.nom)}</div>`}
        ${boutonVerso(f.dos)}${lienVersion(c.version || c.image_ed, c.versions)}${flechesFiche(pos, ordre.length)}</div>
      <div class="fc-infos">
        <div class="fc-tete">
          <div><h2>${esc(f.fr || c.nom)} ${mana(f.cout)}</h2>${f.fr && f.fr !== c.nom ? `<div class="muet">${esc(c.nom)}</div>` : ""}</div>
        </div>
        <div class="petit muet">${esc(f.fr_type || f.type || "")}${f.pt ? " · " + esc(f.pt) : ""}${cmd ? " · commandant" : maybe ? " · Maybeboard" : ""}</div>
        <div class="chiffres">
          <span class="badge ${cher ? "badge-cher" : ""}" title="Le moins cher, toutes éditions (prix Cardmarket du jour)">${euros(f.prix)}${f.prix_edition ? ` · ${esc(f.prix_edition)}` : ""}</span>
          ${PARTAGE ? "" : `<button type="button" class="badge" data-act="achat" hidden></button>`}
          ${f.gc ? `<span class="badge badge-gc">Game Changer</span>` : ""}
          ${badgesAlerte(c)}
        </div>
        <div class="ou-est petit" hidden></div>
        ${assembleHtml(f.assemble)}
        ${f.fr_texte || f.texte ? `<div class="texte fs-texte">${(f.fr_texte || f.texte).split("\n").map((l) => l.trim() === "//" ? "<hr>" : l.trim() ? `<p>${texteMana(l)}</p>` : "").join("")}</div>` : ""}
        ${f.fr_texte && f.texte ? `<details class="petit"><summary>Texte anglais</summary><div class="fs-texte" style="margin-top:.4rem">${f.texte.split("\n").map((l) => l.trim() === "//" ? "<hr>" : `<p>${texteMana(l)}</p>`).join("")}</div></details>` : ""}
        ${(c.fonctions_detail || []).length ? `<div class="fc-ligne"><span class="petit muet">Fonctions</span>
          ${c.fonctions_detail.map((x) => `<span class="puce">${esc(x)}</span>`).join("")}</div>` : ""}
        ${cmd ? "" : `
          <div class="fc-ligne"><span class="petit muet">Tags</span>
            ${tags.length ? tags.map((t, i) => `<span class="puce ${i === 0 ? "puce-1" : ""}">${i === 0 ? "★ " : ""}${esc(t)}</span>`).join("") : `<span class="muet petit">aucun</span>`}
            <button class="btn btn-petit ecrit" data-act="tags">${ico("crayon")}Modifier</button></div>
          ${c.n > 1 || plusieursExemplaires({ type: f.type, texte: f.texte }) ? `
          <div class="fc-ligne ecrit"><label class="petit muet" for="fc-n">Exemplaires</label>
            <input class="champ champ-petit" type="number" id="fc-n" min="1" max="99" value="${c.n}" style="width:4.5rem"></div>` : ""}`}
        <div class="fc-liens">
          ${PARTAGE ? `<a href="https://commanderspellbook.com/search/?q=${enc(`card:"${ic_cle(c.nom)}"`)}" target="_blank" rel="noopener">${ico("combos")}Combos avec cette carte ↗</a>`
            : `<a href="#/deck/${enc(d.id)}/combos/${enc(c.nom)}">${ico("combos")}Combos avec cette carte</a>`}
          <a href="${esc(f.prix_lien || lienCardmarket(c.nom))}" target="_blank" rel="noopener">${ico("panier")}Cardmarket ↗</a>
          <a href="${esc(f.gatherer || lienGatherer(c.nom))}" target="_blank" rel="noopener">${ico("livre")}Gatherer ↗</a>
        </div>
      </div>
    </div>
    ${piedFiche(`
      ${cmd ? "" : `<button class="btn btn-petit" data-act="maybe">${maybe ? ico("annuler") + "Remettre dans le deck" : ico("maybe") + "Maybeboard"}</button>`}
      ${cmd ? `<button class="btn btn-petit" data-act="cmd">${ico("couronne")}Plus commandant</button>`
        : !maybe && legendaire && (d.commandants || []).length < 2 && (!second || f.partenaire !== false) ? `<button class="btn btn-petit" data-act="cmd">${ico("couronne")}${second ? "Second commandant" : "Commandant"}</button>` : ""}
      <button class="btn btn-petit btn-danger" data-act="retirer">${ico("corbeille")}Retirer du deck</button>`)}`, (b) => {
    const retrouver = (nd) => nd && nd.cartes.find((x) => x.nom === c.nom);
    const achat = $('[data-act="achat"]', b);
    if (achat) possedeesDeck(d).then((poss) => boutonAchat(achat, d, c, poss)).catch(() => {});
    ouEst($(".ou-est", b), c.nom, d.id);
    b.addEventListener("click", async (ev) => {
      const x = ev.target.closest("[data-act]");
      if (!x || x.disabled) return;
      const act = x.dataset.act;
      if (act === "achat") return basculerAchat(x, d, c);
      if (act === "prec" || act === "suiv") return ouvrirCarte(d.cartes[ordre[pos + (act === "suiv" ? 1 : -1)]]);
      if (act === "tags") return modaleTags(c, true);
      if (act === "version") return modaleVersion(c);
      if (act === "retirer") {
        if (!confirm(`Retirer ${c.nom} du deck ?`)) return;
        fermerModale();
        return modifier("retirer", c);
      }
      const nd = await modifier(act === "maybe" ? "maybeboard" : "commandant", c);
      ouvrirCarte(retrouver(nd));
    });
    const n = $("#fc-n", b);
    if (n) n.addEventListener("change", async () => {
      const v = Math.round(+n.value);
      if (v > 0 && v !== c.n) ouvrirCarte(retrouver(await modifier("quantite", c, { n: v })));
    });
  }, { focus: false, large: true });
}

document.addEventListener("keydown", (ev) => {     // ← → : carte précédente / suivante dans la fiche
  if ((ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") || !$("#modale .fiche-carte") || ev.target.closest?.("input, textarea, select")) return;
  const b = $(`#modale [data-act="${ev.key === "ArrowRight" ? "suiv" : "prec"}"]`);
  if (b && !b.disabled) { ev.preventDefault(); b.click(); }
});

async function modifier(op, c, extra = {}, message = "Enregistré.") {
  try {
    const d = await api(`/api/decks/${enc(etat.deck.id)}/modifier`, { method: "POST", body: { op, index: c ? c.index : undefined, nom_actuel: c ? c.nom : undefined, ...extra } });
    const y = scrollY;
    await vueDeck(d.id, location.hash.split("/")[3] === "achats" ? "achats" : "liste", null, d);
    scrollTo(0, y);
    api("/api/decks").then((x) => { etat.decks = x; }).catch(() => {});
    if (message) toast(message);
    return d;
  } catch (e) { erreur(e); return null; }
}

function optionsCategories() {
  return `<datalist id="liste-cat">${((etat.deck && etat.deck.categories) || []).map((t) => `<option value="${esc(t)}">`).join("")}</datalist>`;
}

function modaleTags(c, retourFiche = false) {
  const tags = c.tags.filter((t) => t !== "Maybeboard" && t !== "Commander");
  const tous = (etat.deck && etat.deck.categories) || [];
  ouvrirModale(`
    <h2>Tags de ${esc(nomAffiche(c))}</h2>
    <div id="tags-carte" class="puces"></div>
    <div class="form-ligne">
      <input class="champ" id="tag-nouveau" list="liste-cat" placeholder="Nouveau tag" style="flex:1;min-width:200px">
      ${optionsCategories()}
      <button class="btn" id="tag-ajout">Ajouter</button>
    </div>
    <div class="petit muet" style="margin-top:.9rem">Déjà utilisés</div>
    <div id="tags-dispo" class="puces"></div>
    <div class="boutons"><button class="btn btn-accent" id="ok">Enregistrer</button></div>`, (b) => {
    const rendre = () => {
      $("#tags-carte", b).innerHTML = tags.length ? tags.map((t, i) => `<span class="puce ${i === 0 ? "puce-1" : ""}">
          <button type="button" class="puce-nom" data-premier="${i}" title="${i === 0 ? "Range la carte" : "Mettre en premier"}">${i === 0 ? "★ " : ""}${esc(t)}</button>
          <button type="button" data-ote="${i}" aria-label="Retirer ${esc(t)}">✕</button></span>`).join("")
        : `<span class="muet petit">Aucun tag.</span>`;
      const dispo = tous.filter((t) => !tags.includes(t));
      $("#tags-dispo", b).innerHTML = dispo.map((t) => `<button type="button" class="puce puce-dispo" data-ajout="${esc(t)}">+ ${esc(t)}</button>`).join("");
    };
    const ajoute = (t) => {
      t = t.trim();
      if (t && !["commander", "maybeboard"].includes(t.toLowerCase()) && !tags.includes(t)) tags.push(t);
      rendre();
    };
    rendre();
    b.addEventListener("click", (ev) => {
      const x = ev.target.closest("[data-premier], [data-ote], [data-ajout]");
      if (!x) return;
      if (x.dataset.premier) tags.unshift(...tags.splice(+x.dataset.premier, 1));
      else if (x.dataset.ote) tags.splice(+x.dataset.ote, 1);
      else return ajoute(x.dataset.ajout);
      rendre();
    });
    const champ = $("#tag-nouveau", b);
    champ.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); champ.value.split(",").forEach(ajoute); champ.value = ""; }
    });
    $("#tag-ajout", b).onclick = () => { champ.value.split(",").forEach(ajoute); champ.value = ""; champ.focus(); };
    $("#ok", b).onclick = async () => {
      champ.value.split(",").forEach(ajoute);
      fermerModale();
      const nd = await modifier("categorie", c, { tags });
      if (retourFiche && nd) ouvrirCarte(nd.cartes.find((x) => x.nom === c.nom));
    };
  }, { fermer: retourFiche ? () => ouvrirCarte(c) : null });
}

// ------------------------------------------------------------------ choisir la version (le visuel) d'une carte
// Impressions anglaises et françaises ; le choix s'écrit « (ima) 205 » dans la liste, comme dans les exports Archidekt.
const memeVersion = (a, b) => !!a && !!b && a.set === b.set && a.num === b.num && (a.lang || "en") === (b.lang || "en");
const editionVersion = (p) => p ? { set: p.set, num: p.num, lang: p.lang, nom_edition: p.edition } : null;

// sous l'image : l'édition de l'image affichée, et le lien vers les autres impressions (comme la fiche de la recherche)
function lienVersion(v, n = 0) {
  return `<div class="fc-version">
    ${v ? `<span class="petit muet">${esc(v.edition)}${v.annee ? " · " + esc(v.annee) : ""}${v.lang === "fr" ? " · en français" : ""}</span>` : ""}
    <button type="button" class="lien-discret ecrit" data-act="version">${n > 1 ? `${n} versions` : "Changer la version"}</button>
  </div>`;
}

function prixVersion(p) {
  if (p.prix != null) return euros(p.prix);
  if (p.prix_foil != null) return euros(p.prix_foil) + " (foil)";
  return "";
}

async function choixVersion(zone, { nom, titre = nom, actuelle = null, surChoix, retour = null }) {
  zone.innerHTML = `<p class="muet">Impressions de ${esc(titre)}…</p>`;
  let liste;
  try { liste = await api("/api/impressions?nom=" + enc(nom)); }
  catch (e) { zone.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; return; }
  let langue = PREF.get("langue-versions", "toutes");
  if (!liste.some((p) => langue === "toutes" || p.lang === langue)) langue = "toutes";
  const nb = (l) => liste.filter((p) => p.lang === l).length;
  const estActuelle = (p) => (actuelle ? memeVersion(p, actuelle) : p.defaut);
  const tuile = (p, i) => {
    const prix = prixVersion(p);
    return `<button type="button" class="version ${estActuelle(p) ? "actuelle" : ""}" data-v="${i}" aria-pressed="${estActuelle(p)}"
        data-image="${esc(p.image)}" data-legende="${esc(`${p.edition} · ${p.annee}${p.lang === "fr" ? " · en français" : ""}${prix ? " · " + prix : ""}`)}">
      ${p.petite ? `<img src="${esc(p.petite)}" alt="" loading="lazy">` : `<span class="sans-image">${esc(p.edition)}</span>`}
      <span class="v-ed">${esc(p.edition)}</span>
      <span class="v-info">${esc(p.annee)} · ${esc(p.set.toUpperCase())} ${esc(p.num)}${p.lang === "fr" ? ` · <b class="v-fr">FR</b>` : ""}</span>
      ${prix ? `<span class="v-info">${prix}</span>` : ""}
      ${estActuelle(p) ? `<span class="v-marque">actuelle</span>` : p.defaut ? `<span class="v-marque v-defaut">par défaut</span>` : ""}
    </button>`;
  };
  zone.innerHTML = `<div class="choix-versions">
    <div class="versions-tete">
      <div class="versions-titre">Changer la version de ${esc(titre)}</div>
      ${retour ? `<button type="button" class="btn btn-petit" data-retour>${ico("precedent")}Retour à la fiche</button>` : ""}
    </div>
    <div class="barre-outils">
      <div class="segments" role="group">${[["toutes", `Toutes (${liste.length})`], ["en", `Anglais (${nb("en")})`], ["fr", `Français (${nb("fr")})`]]
        .map(([k, l]) => `<button type="button" data-langue="${k}" class="${k === langue ? "actif" : ""}" aria-pressed="${k === langue}">${l}</button>`).join("")}</div>
      ${actuelle ? `<button type="button" class="btn btn-petit" data-defaut>Revenir à l'image par défaut</button>` : ""}
    </div>
    <div class="grille-versions"></div>
  </div>`;
  const boite = $(".choix-versions", zone), grille = $(".grille-versions", zone);
  const rendre = () => {
    const vis = liste.map((p, i) => [p, i]).filter(([p]) => langue === "toutes" || p.lang === langue);
    grille.innerHTML = vis.length ? vis.map(([p, i]) => tuile(p, i)).join("")
      : `<p class="muet">${liste.length ? "Aucune impression dans cette langue." : "Scryfall ne donne aucune impression avec image pour cette carte."}</p>`;
  };
  rendre();
  boite.addEventListener("click", (ev) => {
    const x = ev.target.closest("[data-v], [data-langue], [data-defaut], [data-retour]");
    if (!x) return;
    if (x.dataset.langue) {
      langue = x.dataset.langue;
      PREF.set("langue-versions", langue);
      $$("[data-langue]", boite).forEach((b) => { b.classList.toggle("actif", b === x); b.setAttribute("aria-pressed", b === x); });
      return rendre();
    }
    cacherApercu();
    if (x.dataset.retour !== undefined) return retour();
    if (x.dataset.defaut !== undefined) return surChoix(null);
    surChoix(liste[+x.dataset.v]);
  });
}

function modaleVersion(c) {
  ouvrirModale(`<div id="choix-v"></div>`, (b) => {
    choixVersion($("#choix-v", b), {
      nom: c.nom, titre: nomAffiche(c), actuelle: c.version, retour: () => ouvrirCarte(c),
      surChoix: async (p) => {
        if (p ? memeVersion(p, c.version) : !c.version) return ouvrirCarte(c);       // rien ne change
        fermerModale();
        const nd = await modifier("edition", c, { edition: editionVersion(p) }, p ? `Visuel : ${p.edition}${p.lang === "fr" ? " (français)" : ""}.` : "Image par défaut.");
        if (nd) ouvrirCarte(nd.cartes[c.index]);
      },
    });
  }, { focus: false, large: true });
}

// ------------------------------------------------------------------ recherche d'une carte (ajout, remplacement, commandant)
// Liste de résultats avec coût, prix (le plus bas du jour, chargé juste après) et image + prix au survol.
// surAjout : un bouton + sur chaque suggestion ajoute la carte sans ouvrir sa fiche (renvoie vrai si c'est fait)
// (surAjout(x, { maybe }) : un second bouton l'ajoute au Maybeboard ; Entrée ajoute la carte en tête de liste au deck)
function rechercheCarte(zone, { surChoix, surAjout = null, deck = () => etat.deck, placeholder = "Nom de la carte…" }) {
  zone.innerHTML = `<input class="champ" type="search" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="Chercher une carte">
    <div class="resultats" role="listbox"></div>`;
  const champ = $("input", zone), res = $(".resultats", zone);
  let minuteur, numero = 0, liste = [], actif = -1, fait = "", ajoutEnCours = false;
  const ajoutable = (x) => { const d = deck(); return !(d && d.cartes.some((c) => c.nom === x.nom)) || /\bBasic\b/.test(x.type || ""); };

  const legende = (x) => `${x.fr && x.fr !== x.nom ? x.fr + " — " : ""}${x.prix === undefined || (x.prix == null && !x.prixFait) ? "prix en cours…" : x.prix == null ? "prix inconnu" : euros(x.prix)}${x.gc ? " · Game Changer" : ""}`;
  const nomHtml = (x) => `<span class="en">${esc(x.nom)}</span>${x.fr && x.fr !== x.nom ? ` <span class="muet">· ${esc(x.fr)}</span>` : ""}
    <span class="res-type">${esc(x.type || "")}</span>`;
  const prixHtml = (x) => x.prix != null ? euros(x.prix) : `<span class="muet">${x.prixFait ? "—" : "…"}</span>`;
  const ligne = (x, i) => {
    const d = deck();
    const deja = d && d.cartes.some((c) => c.nom === x.nom);
    const hors = d && d.identite && (x.couleurs || []).some((k) => !d.identite.includes(k));
    const cher = (x.prix || 0) > BUDGET;
    const plus = !surAjout ? "" : !ajoutable(x) ? `<span class="res-plus"></span><span class="res-plus"></span>`
      : `<button type="button" class="res-plus" data-plus="${i}" data-dest="maybe" title="Ajouter au Maybeboard" aria-label="Ajouter ${esc(x.nom)} au Maybeboard">${ico("maybe")}</button>
        <button type="button" class="res-plus" data-plus="${i}" title="Ajouter au deck" aria-label="Ajouter ${esc(x.nom)} au deck">${ico("plus")}</button>`;
    const legalite = x.legal === "banned" ? `<span class="badge badge-alerte">interdite</span>` : x.legal === "not_legal" ? `<span class="badge badge-alerte">non légale</span>` : "";
    return `<div class="res-ligne"><button type="button" class="res-carte ${i === actif ? "choisi" : ""}" data-i="${i}" role="option"
        data-image="${esc(x.image)}" data-legende="${esc(legende(x))}" ${cher ? 'data-cher="1"' : ""}>
      <span class="res-nom">${nomHtml(x)}</span>
      <span class="res-badges">${x.gc ? `<span class="badge badge-gc">Game Changer</span>` : ""}${legalite}${hors ? `<span class="badge badge-alerte">hors couleurs</span>` : ""}${deja ? `<span class="badge">déjà dans le deck</span>` : ""}</span>
      ${mana(x.cout)}
      <span class="prix ${cher ? "cher" : ""}">${prixHtml(x)}</span>
    </button>${plus}</div>`;
  };
  const majPrix = (p) => {
    $$(".res-carte", res).forEach((el) => {
      const x = liste[+el.dataset.i];
      const q = p[x.nom];
      if (!q) return;
      x.prix = q.prix;
      x.prixFait = true;
      x.fr = x.fr || q.fr;
      const cher = (x.prix || 0) > BUDGET;
      el.dataset.legende = legende(x);
      if (cher) el.dataset.cher = "1";
      $(".res-nom", el).innerHTML = nomHtml(x);
      const s = $(".prix", el);
      s.className = "prix " + (cher ? "cher" : "");
      s.innerHTML = prixHtml(x);
    });
    if (survol && res.contains(survol)) majLegende();
  };
  // les anciens résultats restent affichés pendant que les nouveaux arrivent ; les prix manquants suivent sans bloquer
  const chercher = async (q) => {
    const k = ++numero;
    if (q.trim().length < 2) { liste = []; fait = q; res.innerHTML = ""; return; }
    if (!liste.length) res.innerHTML = `<span class="muet petit">Recherche…</span>`;
    try {
      const r = await api("/api/chercher?q=" + enc(q));
      if (k !== numero) return;
      liste = r;
      fait = q;
      actif = r.length ? 0 : -1;
      res.innerHTML = r.length ? r.map(ligne).join("") : `<span class="muet petit">Aucune carte trouvée.</span>`;
      for (const x of r) if (x.prix != null) x.prixFait = true;
      const manque = r.filter((x) => x.prix == null || x.fr == null).map((x) => x.nom);
      if (manque.length) api("/api/prix", { method: "POST", body: { noms: manque } }).then((p) => { if (k === numero) majPrix(p); }).catch(() => {});
    } catch (e) { if (k === numero) res.innerHTML = `<span class="erreur">${esc(e.message)}</span>`; }
  };
  const marque = () => $$(".res-carte", res).forEach((el, j) => el.classList.toggle("choisi", j === actif));
  const choisir = (i) => { if (!liste[i]) return; actif = i; marque(); surChoix(liste[i]); };
  const ajouter = async (i, maybe = false, bouton = null) => {
    if (ajoutEnCours || !liste[i]) return;
    ajoutEnCours = true;
    if (bouton) bouton.disabled = true;
    try {
      if (await surAjout(liste[i], { maybe })) vider();             // carte ajoutée : le champ est prêt pour la suivante
      else { if (bouton) bouton.disabled = false; champ.focus(); }
    } finally { ajoutEnCours = false; }
  };

  champ.addEventListener("input", () => { clearTimeout(minuteur); minuteur = setTimeout(() => chercher(champ.value), 120); });
  champ.addEventListener("keydown", async (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      if (champ.value !== fait) { clearTimeout(minuteur); await chercher(champ.value); }      // Entrée tapée avant les résultats
      if (!liste.length) return;
      const i = Math.max(0, actif);
      if (surAjout && ajoutable(liste[i])) ajouter(i); else choisir(i);
    } else if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && liste.length) {
      ev.preventDefault();
      actif = (actif + (ev.key === "ArrowDown" ? 1 : -1) + liste.length) % liste.length;
      marque();
      $$(".res-carte", res)[actif]?.scrollIntoView({ block: "nearest" });
    }
  });
  const vider = () => { numero++; clearTimeout(minuteur); champ.value = ""; fait = ""; liste = []; actif = -1; res.innerHTML = ""; champ.focus(); };
  res.addEventListener("click", async (ev) => {
    const p = ev.target.closest("button.res-plus");
    if (p) return ajouter(+p.dataset.plus, p.dataset.dest === "maybe", p);
    const b = ev.target.closest(".res-carte");
    if (b) choisir(+b.dataset.i);
  });
  return { champ, vider };
}

// surVersion : la fiche propose « Changer la version (visuel) » et rend la fiche de l'impression choisie
async function chargerFiche(zone, nom, { version = null, surVersion = null } = {}) {
  zone.innerHTML = `<p class="muet">Fiche de ${esc(nom)}…</p>`;
  const q = version ? `&set=${enc(version.set)}&num=${enc(version.num)}&lang=${enc(version.lang || "en")}` : "";
  const f = await api("/api/carte?nom=" + enc(nom) + q);
  const d = etat.deck;
  const deja = d && d.cartes.some((c) => c.nom === f.nom);
  const hors = d && d.identite && (f.couleurs || []).some((x) => !d.identite.includes(x));
  // mêmes éléments, dans le même ordre, que les fiches du deck et de la recherche (ouvrirCarte, ficheRecherche)
  const texte = (t) => (t || "").split("\n").map((l) => l.trim() === "//" ? "<hr>" : l.trim() ? `<p>${texteMana(l)}</p>` : "").join("");
  zone.innerHTML = `
    <div class="fiche">
      <div class="fiche-image"><img src="${esc(f.image)}" alt="${esc(f.nom)}">${surVersion ? lienVersion(f.version || f.image_ed, f.versions) : ""}</div>
      <div class="fc-infos">
        <div><h3 style="margin:0">${esc(f.fr || f.nom)} ${mana(f.cout)}</h3>${f.fr && f.fr !== f.nom ? `<div class="muet">${esc(f.nom)}</div>` : ""}</div>
        <div class="petit muet">${esc(f.fr_type || f.type || "")}${f.pt ? " · " + esc(f.pt) : ""}</div>
        <div class="chiffres">
          <span class="badge ${f.trop_cher ? "badge-cher" : ""}" title="Le moins cher, toutes éditions (prix Cardmarket du jour)">${euros(f.prix)}${f.prix_edition ? ` · ${esc(f.prix_edition)}` : ""}</span>
          ${f.gc ? `<span class="badge badge-gc">Game Changer</span>` : ""}
          ${f.legal === "banned" ? `<span class="badge badge-alerte">interdite</span>` : ""}
          ${hors ? `<span class="badge badge-alerte">hors couleurs</span>` : ""}
          ${deja ? `<span class="badge badge-alerte">déjà dans ce deck</span>` : ""}
        </div>
        <div class="ou-est petit" hidden></div>
        ${f.fr_texte || f.texte ? `<div class="texte fs-texte">${texte(f.fr_texte || f.texte)}</div>` : ""}
        ${f.fr_texte && f.texte ? `<details class="petit"><summary>Texte anglais</summary><div class="fs-texte" style="margin-top:.4rem">${texte(f.texte)}</div></details>` : ""}
        <div class="fc-liens">
          <a href="${esc(f.prix_lien || lienCardmarket(f.nom))}" target="_blank" rel="noopener">${ico("panier")}Cardmarket ↗</a>
          <a href="${esc(f.gatherer || lienGatherer(f.nom))}" target="_blank" rel="noopener">${ico("livre")}Gatherer ↗</a>
        </div>
      </div>
    </div>`;
  ouEst($(".ou-est", zone), f.nom, d && d.id);
  const lien = $('[data-act="version"]', zone);
  if (lien) lien.onclick = () => choixVersion(zone, {
    nom: f.nom, titre: f.fr || f.nom, actuelle: f.version,
    retour: () => chargerFiche(zone, nom, { version, surVersion }).catch(erreur),
    surChoix: async (p) => {
      try { surVersion(await chargerFiche(zone, nom, { version: p, surVersion })); }
      catch (e) { zone.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
    },
  });
  return f;
}

function modaleAjout() {
  const d = etat.deck;
  ouvrirModale(`
    <h2>Ajouter des cartes à ${esc(d.titre)}</h2>
    <div id="rech"></div>
    <div id="fiche"></div>
    <div id="ajout-form">
      <div class="form-ligne">
        <label for="cat-ajout" class="petit">Tags</label>
        <input class="champ" style="flex:1;min-width:180px" id="cat-ajout" list="liste-cat" placeholder="Ramp, Draw…" value="${esc(etat.dernierTags || "")}">
        ${optionsCategories()}
        <label class="petit">Quantité <input class="champ" type="number" id="qte-ajout" min="1" max="99" value="1" style="width:4.5rem"></label>
      </div>
    </div>
    <div id="journal" class="journal petit"></div>
    <div class="boutons">
      <button class="btn" id="ok-maybe" disabled>${ico("maybe")}Maybeboard</button>
      <button class="btn btn-accent" id="ok" disabled>${ico("plus")}<span>Ajouter au deck</span></button></div>`, (b) => {
    let choix = null;
    // la fiche affichée : les deux boutons du bas l'ajoutent (au deck ou au Maybeboard) ; sans fiche, ils attendent
    const boutonsFiche = (actifs) => {
      $("#ok", b).disabled = $("#ok-maybe", b).disabled = !actifs;
      $("#ok span", b).textContent = actifs && choix ? `Ajouter ${choix.nom}` : "Ajouter au deck";
    };
    const ajouter = async (nom, edition, maybe = false) => {
      const tags = $("#cat-ajout", b).value.split(",").map((t) => t.trim()).filter(Boolean);
      etat.dernierTags = $("#cat-ajout", b).value;
      if (maybe) tags.unshift("Maybeboard");
      const n = Math.max(1, +$("#qte-ajout", b).value || 1);
      const res = await modifier("ajouter", null, { nom, tags, n, edition }, "");
      if (res) $("#journal", b).insertAdjacentHTML("afterbegin",
        `<div>✓ ${n > 1 ? n + "× " : ""}${esc(nom)}${maybe ? " (Maybeboard)" : ""} · ${res.total} cartes</div>`);
      return res;
    };
    const rech = rechercheCarte($("#rech", b), {
      surAjout: async (x, { maybe = false } = {}) => {
        const res = await ajouter(x.nom, null, maybe);
        if (res) {
          $("#qte-ajout", b).value = 1;
          if (choix && choix.nom === x.nom) {                 // la fiche affichée était celle de cette carte
            choix = null;
            $("#fiche", b).innerHTML = "";
            boutonsFiche(false);
          }
        }
        return res;
      },
      surChoix: async (x) => {
        choix = null;
        boutonsFiche(false);
        try {
          choix = await chargerFiche($("#fiche", b), x.nom, { surVersion: (g) => { choix = g; } });
          boutonsFiche(true);
          $("#ok", b).focus();
        } catch (e) { $("#fiche", b).innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
      },
    });
    const valider = async (maybe) => {
      if (!choix) return;
      boutonsFiche(false);
      if (!await ajouter(choix.nom, editionVersion(choix.version), maybe)) { boutonsFiche(true); return; }
      choix = null;
      $("#fiche", b).innerHTML = "";
      $("#qte-ajout", b).value = 1;
      boutonsFiche(false);
      rech.vider();
    };
    $("#ok", b).onclick = () => valider(false);
    $("#ok-maybe", b).onclick = () => valider(true);
  });
}

// ------------------------------------------------------------------ statistiques (sous la liste et onglet Statistiques)
const COULEURS = [["W", "Blanc"], ["U", "Bleu"], ["B", "Noir"], ["R", "Rouge"], ["G", "Vert"]];
const nbCartes = (l) => l.reduce((s, c) => s + c.n, 0);
const estTerrain = (c) => typeCarte(c.info.type) === "Terrains";
const REPERES = [[/^(ramp|acc[eé]l[eé]ration)$/i, "≈ 10"], [/^(draw|card draw|pioche)$/i, "≈ 10"],
  [/^(removal|d[eé]gagement|anti-?cr[eé]atures?)$/i, "5 à 10"], [/^(board ?wipes?|wipes?|rase-?boards?|balayages?)$/i, "≈ 5"],
  [/^(lands?|terrains?)$/i, "37-38"]];
const repere = (t) => (REPERES.find(([r]) => r.test(t.trim())) || [])[1] || "";

function nomsBulle(titre, cartes) {
  const noms = cartes.map((c) => (c.n > 1 ? c.n + "× " : "") + c.nom);
  return titre + (noms.length ? "\n" + noms.slice(0, 30).join("\n") + (noms.length > 30 ? `\n… et ${noms.length - 30} autres` : "") : "");
}

// symboles de la couleur x dans le coût d'une carte ({W/U} compte pour les deux)
const pipsDe = (c, x) => ((c.info.cout || "").match(/\{[^}]+\}/g) || []).filter((s) => s.includes(x)).length;
const BASIQUES = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };

function calculStats(d) {
  const jeu = d.cartes.filter((c) => c.cat !== "Maybeboard");
  const bib = jeu.filter((c) => c.cat !== "Commander");            // les 99 : ce qu'on pioche
  const sorts = bib.filter((c) => !estTerrain(c));
  const terrains = bib.filter(estTerrain);
  // sorts recto-verso dont le verso est un terrain (Valakut Awakening) : comptés comme sorts, comme Archidekt, mais signalés
  const mdfc = sorts.filter((c) => c.info.dos && /\bLand\b/.test(c.info.dos.type || ""));
  const types = ORDRE_TYPES.map((t) => [t, bib.filter((c) => typeCarte(c.info.type) === t)]).filter(([, l]) => l.length);
  const courbe = Array.from({ length: 8 }, (_, k) => sorts.filter((c) => Math.min(7, Math.floor(c.info.mv || 0)) === k));
  const pips = pipsDe;
  const cmds = jeu.filter((c) => c.cat === "Commander");
  // terrains qui vont chercher un terrain (Évolution sauvage, fetchlands…) : sources des couleurs qu'ils peuvent trouver
  const basiques = Object.keys(BASIQUES).filter((x) => terrains.some((t) => /\bBasic\b/.test(t.info.type || "") && new RegExp(`\\b${BASIQUES[x]}\\b`).test(t.info.type || "")));
  const trouve = (t) => {
    const s = t.info.texte || "";
    if (!/search your library for/i.test(s)) return [];
    const nommes = Object.keys(BASIQUES).filter((x) => new RegExp(`\\b${BASIQUES[x]}\\b`).test(s));
    return nommes.length ? nommes : /basic land/i.test(s) ? basiques : [];
  };
  const couleurs = COULEURS.map(([x, nom]) => ({
    x, nom,
    cartes: sorts.filter((c) => pips(c, x) > 0),
    symboles: sorts.reduce((s, c) => s + pips(c, x) * c.n, 0),
    symbolesCmd: cmds.reduce((s, c) => s + pips(c, x), 0),          // les commandants : on les lance encore et encore
    sources: terrains.filter((c) => (c.info.produit || []).includes(x) || trouve(c).includes(x)),
    autres: sorts.filter((c) => (c.info.produit || []).includes(x)),
  }));
  const incolores = sorts.filter((c) => !COULEURS.some(([x]) => pips(c, x) > 0));
  const n = nbCartes(sorts);
  const mvMoy = n ? sorts.reduce((s, c) => s + (c.info.mv || 0) * c.n, 0) / n : 0;
  return { jeu, bib, sorts, terrains, mdfc, types, courbe, couleurs, incolores, mvMoy };
}

// histogramme en colonnes : une seule série, barres fines arrondies en haut, valeur au-dessus, cartes au survol
function colonnes(items, h = 120) {
  const max = Math.max(1, ...items.map((i) => i.valeur));
  return `<div class="graphe">${items.map((i) => `
    <div class="col" tabindex="0" data-bulle="${esc(i.bulle)}" aria-label="${esc(i.bulle.split("\n")[0])}">
      <div class="zone" style="height:${h}px"><span class="val">${i.valeur}</span><span class="baton" style="height:${Math.round((i.valeur / max) * (h - 20))}px"></span></div>
      <span class="lib">${i.label}</span>
    </div>`).join("")}</div>`;
}

// barres horizontales ; le repère du gabarit (« ≈ 10 », « 5 à 10 ») est un trait ou un intervalle sur la piste, détaillé au survol
function hbarres(rows) {
  const bornes = (r) => (r.repere ? (r.repere.match(/\d+/g) || []).map(Number) : []);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.valeur, ...bornes(r))));
  const pc = (x) => (x / max) * 100;
  return `<div class="hbarres">${rows.map((r) => {
    const b = bornes(r);
    const cible = !b.length ? "" : `<span class="hb-cible ${b.length > 1 ? "hb-intervalle" : ""}" style="left:${pc(b[0])}%;${b.length > 1 ? `width:${pc(b[1] - b[0])}%` : ""}"></span>`;
    const bulle = r.repere ? r.bulle.replace(/^[^\n]*/, (t) => `${t} · repère ${r.repere}`) : r.bulle;
    return `
    <div class="hb" tabindex="0" data-bulle="${esc(bulle)}">
      <span class="hb-lib">${r.label}</span>
      <span class="hb-piste"><span class="hb-barre" style="width:${pc(r.valeur)}%"></span>${cible}</span>
      <span class="hb-val">${r.valeur}</span>
    </div>`;
  }).join("")}</div>`;
}

function grapheCourbe(S, h) {
  return colonnes(S.courbe.map((l, k) => ({ label: k === 7 ? "7+" : String(k), valeur: nbCartes(l),
    bulle: nomsBulle(`Coût ${k === 7 ? "7 ou plus" : k} : ${nbCartes(l)} carte${nbCartes(l) > 1 ? "s" : ""}`, l) })), h);
}

function grapheCouleurs(S, h) {
  const items = S.couleurs.filter((c) => c.cartes.length).map((c) => ({ label: symbole(c.x), valeur: nbCartes(c.cartes),
    bulle: nomsBulle(`${c.nom} : ${nbCartes(c.cartes)} carte${nbCartes(c.cartes) > 1 ? "s" : ""} avec ce symbole dans leur coût`, c.cartes) }));
  items.push({ label: symbole("C"), valeur: nbCartes(S.incolores), bulle: nomsBulle(`Incolores : ${nbCartes(S.incolores)}`, S.incolores) });
  return colonnes(items, h);
}

function resumeStats(d) {
  const S = calculStats(d);
  if (!S.bib.length) return `<p class="muet">Aucune carte.</p>`;
  return `<div class="grille-3">
    <div class="panneau"><h3>Cartes par type</h3>${colonnes(S.types.map(([t, l]) => ({ label: esc(ABREV[t]), valeur: nbCartes(l), bulle: nomsBulle(`${t} : ${nbCartes(l)}`, l) })))}</div>
    <div class="panneau"><h3>Cartes par couleur</h3>${grapheCouleurs(S)}</div>
    <div class="panneau"><h3>Courbe de mana</h3>${grapheCourbe(S)}<div class="muet petit" style="margin-top:.4rem">coût moyen ${virgule(S.mvMoy, 2)}</div></div>
  </div>
  <div class="panneau"><h3>Base de mana</h3>${tableauBaseMana(S, d)}</div>`;
}

function comb(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
const hyper = (N, K, n, k) => (comb(K, k) * comb(N - K, n - k)) / comb(N, n);
// chance d'avoir au moins k succès en tirant n cartes parmi N, dont K succès
const auMoins = (N, K, n, k) => Math.max(0, 1 - Array.from({ length: k }, (_, i) => hyper(N, K, Math.min(n, N), i)).reduce((s, p) => s + p, 0));

// confort d'une couleur, à la manière de Frank Karsten : pour chaque sort qui la demande, la chance d'avoir assez de
// sources de cette couleur au tour où on le lance (sa valeur de mana). En multijoueur, chacun pioche dès son 1er tour :
// au tour N, on a vu 7 + N cartes. Moyenne sur les sorts, le plus dur à part.
function confortCouleur(lanceurs, N, x, sources) {
  let tot = 0, poids = 0, pire = null;
  for (const c of lanceurs) {
    const k = pipsDe(c, x);
    if (!k) continue;
    const p = auMoins(N, sources, 7 + Math.max(1, Math.ceil(c.info.mv || 0)), k);
    tot += p * c.n;
    poids += c.n;
    if (!pire || p < pire.p) pire = { c, p };
  }
  return poids ? { p: tot / poids, pire } : null;
}
// 90 % : l'objectif de Karsten pour lancer un sort à son tour
const NIVEAUX_MANA = [[0.95, "très confortable", "bon"], [0.9, "confortable", "bon"], [0.8, "juste", "juste"], [0, "insuffisant", "alerte"]];
const niveauMana = (p) => NIVEAUX_MANA.find(([s]) => p >= s);

function tuile(lib, val, sous = "") {
  return `<div class="tuile"><div class="lib">${lib}</div><div class="val">${val}</div>${sous ? `<div class="sous">${sous}</div>` : ""}</div>`;
}

// base de mana : un tableau par couleur, avec la jauge de confort (onglet Statistiques et sous la liste)
function tableauBaseMana(S, d) {
  const N = nbCartes(S.bib);
  // couleurs du commandant (sinon celles que demandent les cartes) : Command Tower « produit » les 5, ça ne compte pas
  const coul = S.couleurs.filter((c) => d.identite ? d.identite.includes(c.x) : c.cartes.length);
  // base de mana. Demande : les symboles des sorts et des commandants. Offre : toutes les sources (terrains, cailloux,
  // créatures). La jauge : le confort de chaque couleur (confortCouleur). Seul le manque est un défaut ; quand une couleur
  // manque, la piste : les terrains d'une seule couleur (de base surtout) qu'une autre a en trop d'après ses symboles,
  // sans passer elle-même sous les 90 %.
  const ids = coul.map((k) => k.x);
  const demande = (c) => c.symboles + c.symbolesCmd;
  const totD = coul.reduce((s, c) => s + demande(c), 0) || 1;
  const monoDe = (x) => S.terrains.filter((t) => { const p = (t.info.produit || []).filter((y) => ids.includes(y)); return p.length === 1 && p[0] === x; });
  const totMono = coul.reduce((s, c) => s + nbCartes(monoDe(c.x)), 0);
  const lanceurs = [...S.sorts, ...S.jeu.filter((c) => c.cat === "Commander")];
  const baseMana = coul.map((c) => {
    const pd = demande(c) / totD, src = nbCartes(c.sources) + nbCartes(c.autres), mono = monoDe(c.x);
    const conf = confortCouleur(lanceurs, N, c.x, src);
    let cederait = Math.floor(nbCartes(mono) - totMono * pd + 1e-9);
    while (cederait > 0 && conf && confortCouleur(lanceurs, N, c.x, src - cederait).p < 0.9) cederait--;
    return { c, pd, src, mono, conf, cederait };
  });
  return `<div class="defile"><table class="tableau petit">
        <thead><tr><th>Couleur</th><th class="num">Cartes</th><th class="num">Symboles</th><th class="num">Terrains</th><th class="num">Autres sources</th><th>Confort</th></tr></thead>
        <tbody>${baseMana.map(({ c, pd, src, conf }) => {
          if (!conf) return `<tr><td>${symbole(c.x)} ${c.nom}</td><td class="num">0</td><td class="num">0</td>
            <td class="num">${nbCartes(c.sources)}</td><td class="num">${nbCartes(c.autres)}</td><td class="muet">—</td></tr>`;
          const niv = niveauMana(conf.p), manque = conf.p < 0.9;
          const pistes = manque ? baseMana.filter((m) => m.conf && m.conf.p >= 0.9 && m.cederait >= 1)
            .map((m) => `${m.cederait} terrain${m.cederait > 1 ? "s" : ""} ${m.c.nom.toLowerCase()}${m.cederait > 1 ? "s" : ""} (${[...new Set(m.mono.map(nomAffiche))].join(", ")})`) : [];
          const detail = `${c.nom} : ${Math.floor(conf.p * 100)} % de chances en moyenne d'avoir assez de sources au tour où tu lances le sort`
            + ` (${src} sources sur ${N} cartes)\nLe plus dur : ${nomAffiche(conf.pire.c)} ${conf.pire.c.info.cout || ""}, ${Math.floor(conf.pire.p * 100)} %`
            + (pistes.length ? `\nPiste : remplacer ${pistes.join(" ou ")} par des terrains ${c.nom.toLowerCase()}s` : "");
          const eq = `<span class="jauge"><span class="jauge-piste"><span class="jauge-barre jauge-${niv[2]}" style="width:${Math.max(0.03, Math.min(1, (conf.p - 0.5) / 0.5)) * 100}%"></span>`
            + `<span class="jauge-cible"></span></span><span class="jauge-val">${Math.floor(conf.p * 100)} %</span><span class="badge badge-${niv[2] === "bon" ? "ok" : niv[2]}">${niv[1]}</span></span>`;
          return `<tr><td>${symbole(c.x)} ${c.nom}</td>
            <td class="num" data-bulle="${esc(nomsBulle(`${c.nom} : ${nbCartes(c.cartes)} cartes`, c.cartes))}">${nbCartes(c.cartes)}</td>
            <td class="num" data-bulle="${esc(`${c.symboles} dans les sorts, ${c.symbolesCmd} dans les commandants`)}">${demande(c)} · ${pct(pd, 0)}</td>
            <td class="num" data-bulle="${esc(nomsBulle(`Terrains qui produisent du ${c.nom.toLowerCase()} : ${nbCartes(c.sources)}`, c.sources))}">${nbCartes(c.sources)}</td>
            <td class="num" data-bulle="${esc(nomsBulle(`Autres sources (cailloux, créatures) : ${nbCartes(c.autres)}`, c.autres))}">${nbCartes(c.autres)}</td>
            <td data-bulle="${esc(detail)}">${eq}</td></tr>`;
        }).join("")}</tbody>
      </table></div>`;
}

function ongletStats(el, d) {
  const S = calculStats(d);
  if (!S.bib.length) { el.innerHTML = `<p class="muet">Aucune carte.</p>`; return; }
  const N = nbCartes(S.bib), K = nbCartes(S.terrains);
  const p24 = N >= 7 ? [2, 3, 4].reduce((s, k) => s + hyper(N, K, 7, k), 0) : null;
  const tags = {};
  for (const c of S.jeu) for (const t of c.tags) if (t !== "Commander" && t !== "Maybeboard") (tags[t] ||= []).push(c);
  const lignesTags = Object.entries(tags).sort((a, b) => nbCartes(b[1]) - nbCartes(a[1]))
    .map(([t, l]) => ({ label: esc(t), valeur: nbCartes(l), bulle: nomsBulle(`${t} : ${nbCartes(l)}`, l), repere: repere(t) }));
  // fonctions des sorts des 99 (une carte compte dans chacune des siennes), comparées au gabarit
  const lignesFonctions = ORDRE_FONCTIONS.filter((f) => f !== "Terrains")
    .map((f) => [f, S.sorts.filter((c) => (f === "Autres" ? !(c.fonctions || []).length : (c.fonctions || []).includes(f)))])
    .filter(([, l]) => l.length)
    .map(([f, l]) => ({ label: esc(f), valeur: nbCartes(l), bulle: nomsBulle(`${f} : ${nbCartes(l)}`, l), repere: repere(f) }));
  const chers = S.jeu.filter((c) => c.info.prix).sort((a, b) => b.info.prix - a.info.prix).slice(0, 10);
  el.innerHTML = `
    <div class="tuiles">
      ${tuile("Cartes", `${d.total} / 100`, `${N - K} sorts · ${K} terrains`)}
      ${tuile("Terrains", K, S.mdfc.length ? `+ ${esc(S.mdfc.map(nomAffiche).join(", "))} (verso terrain)` : "")}
      ${tuile("Coût moyen", virgule(S.mvMoy, 2))}
      ${p24 == null ? "" : tuile("Main de départ", pct(p24, 0), "2 à 4 terrains")}
      ${tuile("Prix", euros(d.prix_total))}
      ${tuile("Game Changers", d.gc.length, esc(d.gc.join(", ")))}
    </div>
    <div class="grille-deux">
      <div class="panneau"><h3>Courbe de mana</h3>${grapheCourbe(S, 170)}</div>
      <div class="panneau"><h3>Cartes par couleur</h3>${grapheCouleurs(S, 170)}</div>
    </div>
    <div class="grille-deux">
      <div class="panneau"><h3>Cartes par type</h3>${colonnes(S.types.map(([t, l]) => ({ label: esc(ABREV[t]), valeur: nbCartes(l), bulle: nomsBulle(`${t} : ${nbCartes(l)}`, l) })), 170)}</div>
      <div class="panneau" id="st-roles"></div>
    </div>
    <div class="panneau">
      <h3 style="margin-top:0">Base de mana</h3>
      ${tableauBaseMana(S, d)}
    </div>
    <div class="panneau" id="st-jetons" hidden></div>
    <div class="panneau">
      <h3 style="margin-top:0">Main de départ</h3>
      <div class="form-ligne" style="margin-top:0">
        <button class="btn btn-accent" id="m-tirer">${ico("cartes")}Nouvelle main</button>
        <button class="btn" id="m-mull">${ico("rafraichir")}Mulligan</button>
        <button class="btn" id="m-piocher">${ico("plus")}Piocher une carte</button>
        <span class="muet petit" id="m-info"></span>
      </div>
      <div class="etale etale-main" id="m-cartes"></div>
    </div>
    <div class="panneau">
      <h3 style="margin-top:0">Les plus chères</h3>
      ${chers.map((c) => `<div class="ligne ligne-3">
        <span class="nom"><span class="en" data-image="${esc(c.info.image)}" data-legende="${esc(legendeCarte(c))}">${esc(c.nom)}</span>${c.info.fr && c.info.fr !== c.nom ? `<span class="fr" data-image="${esc(c.info.image)}" data-legende="${esc(legendeCarte(c))}">${esc(c.info.fr)}</span>` : ""}</span>
        ${mana(c.info.cout)}
        ${c.info.prix_lien ? `<a class="prix ${c.info.prix > BUDGET ? "cher" : ""}" href="${esc(c.info.prix_lien)}" target="_blank" rel="noopener">${euros(c.info.prix)}</a>` : `<span class="prix">${euros(c.info.prix)}</span>`}
      </div>`).join("")}
    </div>`;
  // fonctions ou tags : la même question (ce que font les cartes), un seul panneau avec son sélecteur
  const roles = () => {
    const z = $("#st-roles", el), v = PREF.get("stats-roles", "fonctions");
    const lignes = v === "tags" ? lignesTags : lignesFonctions;
    z.innerHTML = `<div class="panneau-tete"><h3>${v === "tags" ? "Tags" : "Fonctions"}</h3>
        ${segments("stats-roles", [["fonctions", "Fonctions"], ["tags", "Tags"]], "fonctions").replace('class="segments"', 'class="segments segments-petits"')}</div>
      ${lignes.length ? hbarres(lignes) : `<p class="muet petit">Aucun tag.</p>`}`;
    $$("[data-pref]", z).forEach((b) => (b.onclick = () => { PREF.set("stats-roles", b.dataset.val); roles(); }));
  };
  roles();
  montageMain(el, S);
  if (!PARTAGE) jetonsDuDeck(d).then((jetons) => {
    const z = $("#st-jetons", el);
    if (!z || !jetons.length) return;
    const fr = (n) => { const c = d.cartes.find((x) => x.nom === n); return c ? nomAffiche(c) : n; };
    z.innerHTML = `<div class="panneau-tete"><h3>Jetons</h3>
        <a class="btn btn-petit" href="#/proxies?deck=${enc(d.id)}&cartes=jetons">${ico("imprimer")}Imprimer</a></div>
      ${jetons.map((j) => `<div class="ligne ligne-jeton">
        <span class="nom"><span class="en" data-image="${esc(j.image)}">${esc(j.nom)}</span>${j.pt ? ` <span class="muet">${esc(j.pt)}</span>` : ""}</span>
        <span class="petit muet">${esc(j.type)}</span>
        <span class="petit muet">${j.cartes.map((n) => esc(fr(n))).join(", ")}</span>
      </div>`).join("")}`;
    z.hidden = false;
  });
}

// les jetons (et donjons) que créent les cartes du deck, d'après Scryfall : à prévoir pour jouer, ou à imprimer
const jetonsDuDeck = (d) => api(`/api/jouer/jetons?deck=${enc(d.id)}`).then((r) => r.jetons || []).catch(() => []);

// tirage d'une main de départ, comme les testeurs d'Archidekt ou de Moxfield
function montageMain(el, S) {
  const bib = [];
  for (const c of S.bib) for (let k = 0; k < c.n; k++) bib.push(c);
  let pile = [], main = [], mull = 0;
  const rendre = () => {
    const t = main.filter(estTerrain).length;
    const conseil = mull === 0 ? "" : mull === 1 ? " · mulligan gratuit" : ` · mulligan ${mull} : ${mull - 1} sous la bibliothèque`;
    $("#m-info", el).textContent = `${main.length} cartes · ${t} terrain${t > 1 ? "s" : ""}${conseil}`;
    $("#m-cartes", el).innerHTML = main.map((c, i) => `<div class="carte-v">
      <div class="pile" data-survol="${c.index}">${imageCarte(c.info, "recto")}</div>
      <div class="legende-v"><span class="nom-v">${i >= 7 ? `<span class="badge">pioche ${i - 6}</span> ` : ""}${esc(nomAffiche(c))}</span></div>
    </div>`).join("");
  };
  const tirer = (m) => {
    mull = m;
    pile = [...bib];
    for (let i = pile.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pile[i], pile[j]] = [pile[j], pile[i]];
    }
    main = pile.splice(0, 7);
    rendre();
  };
  $("#m-tirer", el).onclick = () => tirer(0);
  $("#m-mull", el).onclick = () => tirer(mull + 1);
  $("#m-piocher", el).onclick = () => { if (pile.length) { main.push(pile.shift()); rendre(); } };
  tirer(0);
}

// ------------------------------------------------------------------ onglet Versions
const TYPE_VERSION = { nommee: ["version", "badge-ok"], ancienne: ["ancienne liste", ""], auto: ["historique", ""] };

function optionsVersions(vs, choisi, avecActuelle = true, avecAucune = false) {
  const opts = [];
  if (avecAucune) opts.push(`<option value="__aucune__" ${choisi === "__aucune__" ? "selected" : ""}>pas de comparaison</option>`);
  if (avecActuelle) opts.push(`<option value="" ${choisi === "" ? "selected" : ""}>Liste actuelle</option>`);
  const groupes = [["nommee", "Tes versions"], ["ancienne", "Anciennes listes"], ["auto", "Historique automatique"]];
  for (const [t, l] of groupes) {
    const g = vs.filter((v) => v.type === t);
    if (g.length) opts.push(`<optgroup label="${l}">${g.map((v) => `<option value="${esc(v.fichier)}" ${v.fichier === choisi ? "selected" : ""}>${esc(v.nom)}</option>`).join("")}</optgroup>`);
  }
  return opts.join("");
}

// « 6 Mountain, Sol Ring » : les noms d'une liste, les doubles comptés
function nomsComptes(noms) {
  const n = new Map();
  noms.forEach((x) => n.set(x, (n.get(x) || 0) + 1));
  return [...n].map(([x, k]) => `<li>${k > 1 ? `<span class="muet">${k}</span> ` : ""}${nc(x)}</li>`).join("");
}

// une version : son nom, sa date, sa note ; ce qui la sépare de la liste actuelle, déplié à la demande ; Comparer, et le
// reste dans « … »
function carteVersion(v, i) {
  const [lib, cls] = TYPE_VERSION[v.type];
  const date = v.type === "auto" ? "" : new Date(v.date * 1000).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) + " · ";
  return `<article class="version">
    <div class="version-tete">
      <div class="version-nom"><strong>${esc(v.nom)}</strong>${v.type === "ancienne" ? ` <span class="badge ${cls}">${lib}</span>` : ""}
        <div class="muet petit">${esc(date)}${v.total} cartes</div></div>
      <button class="btn btn-petit" data-act="comparer" data-i="${i}">${ico("comparer")}Comparer</button>
      <button type="button" class="btn-menu ecrit" data-act="menu" data-i="${i}" aria-label="Autres actions sur « ${esc(v.nom)} »">${ico("plus_de")}</button>
    </div>
    ${v.note ? `<p class="version-note petit">${esc(v.note)}</p>` : ""}
    ${v.plus.length || v.moins.length ? `<details class="version-diff petit">
      <summary><span class="ok">+${v.plus.length}</span> <span class="alerte-texte">−${v.moins.length}</span> <span class="muet">par rapport à la liste actuelle</span></summary>
      <div class="version-listes">
        ${v.plus.length ? `<div><div class="ok">En plus</div><ul>${nomsComptes(v.plus)}</ul></div>` : ""}
        ${v.moins.length ? `<div><div class="alerte-texte">En moins</div><ul>${nomsComptes(v.moins)}</ul></div>` : ""}
      </div></details>` : `<p class="muet petit version-diff">Identique à la liste actuelle</p>`}
  </article>`;
}

async function ongletVersions(el, d) {
  el.innerHTML = `<p class="chargement">Chargement des versions…</p>`;
  const vs = await api(`/api/decks/${enc(d.id)}/versions`);
  const nommees = vs.filter((v) => v.type !== "auto");
  const auto = vs.filter((v) => v.type === "auto");
  const defautB = (nommees[0] || auto[0] || {}).fichier ?? "";
  el.innerHTML = `
    <div class="form-ligne ecrit">
      <button class="btn btn-accent" id="btn-version">${ico("enregistrer")}Enregistrer une version…</button>
    </div>

    <div class="panneau cmp">
      <h3 style="margin-top:0">Comparer deux versions</h3>
      <div class="cmp-choix">
        <select class="champ" id="cmp-a" aria-label="Première version">${optionsVersions(vs, "")}</select>
        <select class="champ" id="cmp-b" aria-label="Seconde version">${optionsVersions(vs, defautB)}</select>
        <button class="btn" id="btn-cmp">${ico("comparer")}Comparer</button>
      </div>
      <div id="cmp-res"></div>
    </div>

    <h2>Versions</h2>
    ${nommees.length ? `<div class="versions">${nommees.map((v) => carteVersion(v, vs.indexOf(v))).join("")}</div>`
      : `<p class="muet">Aucune version.</p>`}

    ${auto.length ? `<details class="versions-auto" ${nommees.length ? "" : "open"}><summary>Historique (${auto.length})</summary>
      <div class="versions">${auto.map((v) => carteVersion(v, vs.indexOf(v))).join("")}</div>
    </details>` : ""}`;

  $("#btn-version").onclick = () => ouvrirModale(`
    <h2>Enregistrer une version</h2>
    <label>Nom<input class="champ" id="v-nom"></label>
    <label style="display:block;margin-top:.6rem">Note<textarea class="champ" id="v-note" rows="3"></textarea></label>
    <div class="boutons"><button class="btn btn-accent" id="ok">Enregistrer</button></div>`, (b) => {
    $("#ok", b).onclick = async () => {
      try {
        await api(`/api/decks/${enc(d.id)}/versions`, { method: "POST", body: { nom: $("#v-nom", b).value, note: $("#v-note", b).value } });
        fermerModale();
        toast("Version enregistrée.");
        ongletVersions(el, d);
      } catch (e) { erreur(e); }
    };
  });

  $("#btn-cmp").onclick = () => afficheComparaison($("#cmp-res", el), d, $("#cmp-a", el).value, $("#cmp-b", el).value);

  const agir = async (act, v) => {
    if (act === "comparer") {
      $("#cmp-a", el).value = "";
      $("#cmp-b", el).value = v.fichier;
      await afficheComparaison($("#cmp-res", el), d, "", v.fichier);
      $(".cmp", el).scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (act === "simuler") {
      etat.simA = "";
      etat.simB = v.fichier;
      location.hash = `#/deck/${enc(d.id)}/simulation`;
    } else if (act === "restaurer") {
      if (!confirm(`Restaurer « ${v.nom} » ?`)) return;
      try {
        await api(`/api/decks/${enc(d.id)}/restaurer`, { method: "POST", body: { fichier: v.fichier } });
        toast("Version restaurée.");
        location.hash = `#/deck/${enc(d.id)}/liste`;
      } catch (e) { erreur(e); }
    } else if (act === "supprimer") {
      if (!confirm(`Supprimer la version « ${v.nom} » ?`)) return;
      try {
        await api(`/api/decks/${enc(d.id)}/versions/supprimer`, { method: "POST", body: { fichier: v.fichier } });
        ongletVersions(el, d);
      } catch (e) { erreur(e); }
    }
  };
  $$(".version [data-act]", el).forEach((b) => b.addEventListener("click", () => {
    const v = vs[+b.dataset.i];
    if (b.dataset.act !== "menu") return agir(b.dataset.act, v);
    ouvrirMenu(b, [v.nom,
      [TELEPHONE ? "Simuler…" : "Simuler", () => agir("simuler", v), "", "simulation"],
      ["Restaurer cette version", () => agir("restaurer", v), "", "annuler"],
      ...(v.type === "nommee" ? [null, ["Supprimer la version", () => agir("supprimer", v), "btn-danger", "corbeille"]] : [])]);
  }));
}

// deux versions côte à côte : leurs chiffres, puis ce que chacune a de plus (sur le téléphone, une liste à la fois, en
// glissant de l'une à l'autre)
async function afficheComparaison(zone, d, fa, fb) {
  zone.innerHTML = `<p class="chargement">Comparaison…</p>`;
  try {
    const c = await api(`/api/decks/${enc(d.id)}/comparer?a=${enc(fa)}&b=${enc(fb)}`);
    const comptes = (l) => { const m = new Map(); l.forEach((n) => m.set(n, (m.get(n) || 0) + 1)); return [...m]; };
    const carte = ([n, k]) => {
      const f = c.infos[n] || {};
      return `<div class="ligne cmp-carte">
        <span class="nom" data-image="${esc(f.image)}"><span class="en">${k > 1 ? `<span class="muet">${k}</span> ` : ""}${esc(f.fr || n)}</span>${f.gc ? ` <span class="badge badge-gc">GC</span>` : ""}</span>
        ${mana(f.cout)}<span class="prix ${(f.prix || 0) > BUDGET ? "cher" : ""}">${euros(f.prix)}</span></div>`;
    };
    const tuile = (v) => `<div class="cmp-tuile">
      <div class="cmp-tuile-nom">${esc(v.nom)}</div>
      <div class="chiffres"><span class="badge ${v.total === 100 ? "badge-ok" : "badge-alerte"}">${v.total} cartes</span><span class="badge">${euros(v.prix)}</span>
        <span class="badge ${v.gc.length ? "badge-gc" : ""}" title="${esc(v.gc.join(", "))}">${v.gc.length} GC</span></div></div>`;
    const memes = !c.seulement_a.length && !c.seulement_b.length;
    zone.innerHTML = `
      <div class="cmp-tuiles">${tuile(c.a)}${tuile(c.b)}</div>
      <p class="muet petit cmp-communes">${memes ? "Mêmes cartes." : `${c.communes} cartes en commun.`}</p>
      ${memes ? "" : `
        <p class="petit muet cmp-seulement">Ce que chacune a en plus :</p>
        <div class="segments segments-pages" role="tablist">${[[c.a, c.seulement_a], [c.b, c.seulement_b]].map(([v, l]) =>
          `<button type="button" role="tab"><span class="seg-lib">${esc(v.nom)}</span> <span class="sg-n">${l.length}</span></button>`).join("")}</div>
        <div class="glisse cote-a-cote">
          ${[[c.a, c.seulement_a], [c.b, c.seulement_b]].map(([v, l]) => `<div class="glisse-page">
            <h3 class="page-titre">Seulement dans « ${esc(v.nom)} » <span class="muet">(${l.length})</span></h3>
            ${l.length ? comptes(l).map(carte).join("") : `<p class="muet">Rien.</p>`}</div>`).join("")}
        </div>
        <div class="boutons ecrit"><button class="btn" id="cmp-sim">${ico("simulation")}Simuler les deux</button></div>`}`;
    if (!memes) pagesGlissees($(".glisse", zone), $$(".segments-pages button", zone));
    const b = $("#cmp-sim", zone);
    if (b) b.onclick = () => { etat.simA = fa; etat.simB = fb; location.hash = `#/deck/${enc(d.id)}/simulation`; };
  } catch (e) { zone.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
}

// des pages côte à côte, une à la fois : on passe de l'une à l'autre en glissant (au doigt) ou par leurs onglets.
// .cote-a-cote : sur un grand écran (hors téléphone), toutes visibles côte à côte, sans onglets.
function pagesGlissees(cadre, onglets, depart = 0) {
  const pages = [...cadre.children];
  let n = Math.min(Math.max(0, depart), pages.length - 1);
  const glisse = () => getComputedStyle(cadre).display === "flex";
  const ajuster = () => { cadre.style.height = glisse() ? pages[n].offsetHeight + "px" : ""; };
  const marquer = () => onglets.forEach((o, i) => { o.classList.toggle("actif", i === n); o.setAttribute("aria-selected", i === n); });
  const aller = (i, doux = true) => {
    n = i;
    marquer();
    ajuster();
    if (glisse()) cadre.scrollTo({ left: i * cadre.clientWidth, behavior: doux ? "smooth" : "auto" });
    cadre.dispatchEvent(new CustomEvent("page", { detail: n }));
  };
  onglets.forEach((o, i) => o.addEventListener("click", () => aller(i)));
  let minuteur;
  cadre.addEventListener("scroll", () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      const i = Math.round(cadre.scrollLeft / cadre.clientWidth);
      if (i !== n && pages[i]) aller(i, false);
    }, 90);
  }, { passive: true });
  const ro = new ResizeObserver(() => { if (cadre.isConnected) ajuster(); else ro.disconnect(); });
  pages.forEach((p) => ro.observe(p));
  requestAnimationFrame(() => aller(n, false));
  return { aller };
}

// ------------------------------------------------------------------ onglet Bracket
const REGLES_BRACKETS = [
  ["1 Exhibition", "ultra décontracté, deck à thème", "0", "non", "non", "non"],
  ["2 Core", "niveau d'un précon actuel, parties de 9 tours ou plus", "0", "non", "peu, jamais enchaînés", "non"],
  ["3 Upgraded", "au-dessus d'un précon, chaque carte choisie", "3 au plus", "pas en début de partie", "peu, jamais enchaînés", "non"],
  ["4 Optimized", "le plus fort possible, sans méta de tournoi", "libre", "libre", "libre", "libre"],
  ["5 cEDH", "compétitif", "libre", "libre", "libre", "libre"],
];

function listeCartes(noms) {
  return noms.length ? noms.map((n) => `<span class="badge">${nc(n)}</span>`).join(" ") : `<span class="muet">aucune</span>`;
}

function blocCombo(c, presque) {
  return `<div class="panneau" style="margin-top:.6rem">
    <div><strong>${c.cartes.map((n) => presque && c.manque.includes(n) ? `<span style="color:var(--accent)">${nc(n)} (manque)</span>` : nc(n)).join(" + ")}</strong>
      ${c.tag ? `<span class="badge" title="Bracket de la combo selon Commander Spellbook">${esc(c.tag)}${c.bracket ? ` · bracket ${c.bracket}` : ""}</span>` : ""}</div>
    <div class="petit muet" style="margin-top:.25rem">${c.produit.map(esc).join(" · ")}</div>
    <details><summary>Comment ça marche</summary>${detailsCombo(c)}</details>
  </div>`;
}

// prérequis, mana et étapes d'une combo de Commander Spellbook (en anglais, comme sur le site)
const detailsCombo = (c) => `
  ${c.prerequis ? `<p class="petit"><strong>Il faut :</strong> ${esc(c.prerequis)}</p>` : ""}
  ${c.prerequis2 ? `<p class="petit">${esc(c.prerequis2)}</p>` : ""}
  ${c.mana ? `<p class="petit"><strong>Mana :</strong> ${esc(c.mana)}</p>` : ""}
  <p class="petit" style="white-space:pre-wrap">${esc(c.description)}</p>
  ${c.lien ? `<a class="petit" href="${esc(c.lien)}" target="_blank" rel="noopener">Voir sur Commander Spellbook ↗</a>` : ""}`;

async function ongletBracket(el, d, force = false) {
  el.innerHTML = `<p class="chargement">Analyse du bracket…</p>`;
  const b = await api(`/api/decks/${enc(d.id)}/bracket${force ? "?force=1" : ""}`);
  const sb = b.spellbook;
  const dansDeck = new Set(b.gc);
  el.innerHTML = `
    <div class="grille-2">
      <div class="panneau">
        <div class="muet petit">Règles officielles</div>
        <div class="gros-chiffre">${b.estime ? "Bracket " + b.estime : "Deck illégal"}</div>
        <ul class="petit">${b.raisons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      </div>
      <div class="panneau">
        <div class="muet petit">Commander Spellbook</div>
        ${sb ? `<div class="gros-chiffre">${sb.bracket ? "Bracket " + sb.bracket : esc(sb.libelle)}</div>`
          : `<p class="erreur petit">Commander Spellbook ne répond pas : ${esc(b.spellbook_erreur || "")}</p>`}
        <button class="btn btn-petit ecrit" id="btn-recalc" style="margin-top:.6rem">Recalculer</button>
      </div>
    </div>

    <h2>Game Changers du deck</h2>
    <p>${listeCartes(b.gc)}</p>
    <details><summary>Liste officielle (${b.gc_liste.length})</summary>
      <p>${b.gc_liste.map((n) => `<span class="badge ${dansDeck.has(n) ? "badge-gc" : ""}">${esc(n)}</span>`).join(" ")}</p>
    </details>

    <h2>Combos dans le deck</h2>
    ${sb && sb.combos.length ? sb.combos.map((c) => blocCombo(c, false)).join("") : `<p class="muet">Aucune combo connue de Commander Spellbook.</p>`}

    <div class="grille-2" style="margin-top:1rem">
      <div><h3>Tuteurs</h3><p>${listeCartes(b.tuteurs)}</p></div>
      <div><h3>Tours supplémentaires</h3><p>${listeCartes(b.tours)}</p></div>
      <div><h3>Destruction massive de terrains</h3><p>${listeCartes(b.mld)}</p></div>
    </div>

    <details><summary>Règles des brackets</summary>
    <table class="tableau petit">
      <thead><tr><th>Bracket</th><th>Esprit</th><th>Game Changers</th><th>Combo infinie à 2 cartes</th><th>Tours supplémentaires</th><th>Destruction massive de terrains</th></tr></thead>
      <tbody>${REGLES_BRACKETS.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></details>`;
  $("#btn-recalc").onclick = () => ongletBracket(el, d, true);
}

// ------------------------------------------------------------------ onglet Combos : le deck, ou une carte
// Sources : MTGPics (la base de combos de Magic-Ville, site jumeau sans Cloudflare), Commander Spellbook (base ouverte)
// et Claude (synergies du deck, à la demande).
const sepMilliers = (n) => (n == null ? "—" : Number(n).toLocaleString("fr-FR"));
const SOURCES = { mtgpics: "MTGPics", spellbook: "Spellbook", claude: "Claude" };

function nomCombo(f) {
  const leg = `${f.fr && f.fr !== f.nom ? f.nom + " · " : ""}${f.prix != null ? euros(f.prix) : "prix inconnu"}${f.dans ? " · dans le deck" : ""}`;
  return `<button type="button" class="cc ${f.dans ? "cc-dans" : ""}" data-nom="${esc(f.nom)}" data-image="${esc(f.image)}" data-legende="${esc(leg)}"
    ${(f.prix || 0) > BUDGET ? 'data-cher="1"' : ""}>${esc(f.fr || f.nom)}</button>`;
}

function ligneCombo(c, carte = null) {
  const fiches = carte ? c.fiches.filter((f) => f.nom !== carte) : c.fiches;      // vue carte : seulement les autres cartes
  const info = c.source === "claude" ? "★".repeat(c.force || 1)
    : c.popularite ? (c.source === "mtgpics" ? `Top 8 : ${c.popularite}` : `${sepMilliers(c.popularite)} decks`) : "";
  const manque = carte ? fiches.filter((f) => !f.dans) : [];
  const etapes = c.description ? c.description.split("\n").filter((l) => l.trim()) : [];
  const details = c.explication || etapes.length || (c.resultats || []).length;
  const lien = c.lien ? `<a class="petit" href="${esc(c.lien)}" target="_blank" rel="noopener">Voir sur ${SOURCES[c.source]} ↗</a>` : "";
  let etatCarte = "";
  if (carte) {
    if (!manque.length) etatCarte = `<span class="ok">✓ tout est dans le deck</span>`;
    else {
      const maybe = manque.length === 1 ? ((c.maybe || []).includes(manque[0].nom) ? ` <span class="badge">au Maybeboard</span>`
        : ` <button type="button" class="btn btn-petit ecrit" data-maybe="${esc(manque[0].nom)}">${ico("maybe")}Maybeboard</button>`) : "";
      etatCarte = `Pas dans le deck : ${manque.map((f) => `${nc(f.nom, f.fr || f.nom)} <span class="${(f.prix || 0) > BUDGET ? "cher" : "muet"}">${euros(f.prix)}</span>`).join(" · ")}${maybe}`;
    }
  }
  const images = c.fiches.filter((f) => f.image).slice(0, 4);
  return `<article class="combo">
    <div class="combo-images" aria-hidden="true">${images.map((f) => `<img src="${esc(f.image)}" alt="" loading="lazy">`).join("")}</div>
    <div class="combo-corps">
    <div class="combo-haut"><span class="classe classe-${esc(c.classe)}">${esc(c.classe_lib)}</span>
      <span class="combo-source">${SOURCES[c.source]}${info ? ` · ${info}` : ""}</span></div>
    <div class="combo-cartes">${fiches.map(nomCombo).join(`<span class="plus">+</span>`)}${(c.autres || []).map((t) =>
      `<span class="plus">+</span><span class="cc-autre" title="N'importe quelle carte de ce genre">${esc(t)}</span>`).join("")}</div>
    ${etatCarte ? `<div class="combo-manque petit">${etatCarte}</div>` : ""}
    ${details ? `<details class="combo-details"><summary>${esc(c.titre || (c.resultats || []).join(" · ") || "Comment ça marche")}</summary>
        ${c.explication ? `<p class="petit">${esc(c.explication)}</p>` : ""}
        ${c.prerequis ? `<p class="petit"><strong>Il faut :</strong> ${esc(c.prerequis)}</p>` : ""}
        ${etapes.length ? `<ol class="etapes petit">${etapes.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>` : ""}
        ${lien}</details>` : lien ? `<div class="combo-lien">${lien}</div>` : ""}
    </div>
  </article>`;
}

// ---- vue « le deck » : les combos présentes
async function vueCombosDeck(zone, d) {
  zone.innerHTML = `<p class="chargement">Combos du deck…</p>`;
  let r;
  try { r = await api(`/api/decks/${enc(d.id)}/combos`); }
  catch (e) { zone.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; return; }
  if (!zone.isConnected) return;
  zone.innerHTML = `
    <p><strong>${r.combos.length ? `${r.combos.length} combo${r.combos.length > 1 ? "s" : ""} dans le deck` : "Aucune combo connue dans le deck"}</strong></p>
    ${r.erreur ? `<p class="erreur petit">Commander Spellbook ne répond pas : ${esc(r.erreur)}</p>` : ""}
    ${r.combos.length ? `<div class="combos">${r.combos.map((c) => ligneCombo(c)).join("")}</div>` : ""}
    <div class="cb-sources">
      <div id="cb-mtgpics" class="petit ligne-outil"></div>
      <div id="cb-claude" class="petit ligne-outil"></div>
    </div>`;
  rendreMtgpics($("#cb-mtgpics", zone), d, r.mtgpics, () => vueCombosDeck(zone, d));
  rendreClaude($("#cb-claude", zone), d, r.synergies, () => vueCombosDeck(zone, d));
}

// une source de combos, en bas de l'onglet : son nom et son état, puis son bouton
const ligneSource = (nom, etat, bouton = "") => `<div class="source-texte"><strong>${nom}</strong><span class="muet">${etat}</span></div>${bouton}`;

// Combos MTGPics : lues carte par carte (une requête toutes les 1,5 s), gardées 30 jours
function rendreMtgpics(zone, d, st, apres) {
  if (!st) {                                         // téléphone sans PC : rien de lu ici
    if (TELEPHONE) zone.innerHTML = ligneSource("MTGPics", "Pas encore lues", `<button class="btn btn-petit" data-pc="mtgpics">Lire</button>`);
    return;
  }
  if (st.actif && TELEPHONE) { zone.innerHTML = ligneSource("MTGPics", `<span class="pulse">●</span> lecture en cours sur le PC…`); return; }
  if (st.actif) {
    zone.innerHTML = ligneSource("MTGPics", `<span class="pulse">●</span> ${st.fait} / ${st.total}…`);
    setTimeout(async () => {
      if (!zone.isConnected) return;
      const s = await api(`/api/decks/${enc(d.id)}/mtgpics`).catch(() => null);
      if (!zone.isConnected || !s) return;
      if (s.actif) rendreMtgpics(zone, d, s, apres);
      else apres();
    }, 3000);
    return;
  }
  const reste = st.cartes - st.connues;
  const minutes = Math.max(1, Math.round((reste * 4 * 1.5) / 60));
  const err = st.erreur ? ` · <span class="erreur">${esc(st.erreur)}</span>` : "";
  zone.innerHTML = reste
    ? ligneSource("MTGPics", `${st.connues} / ${st.cartes} cartes lues · ≈ ${minutes} min pour ${reste === st.cartes ? "tout lire" : "le reste"}${err}`,
      `<button class="btn btn-petit" id="btn-mtgpics" ${TELEPHONE ? 'data-pc="mtgpics"' : ""}>Lire ${reste === st.cartes ? "tout" : `les ${reste} autres`}</button>`)
    : ligneSource("MTGPics", `${st.cartes} cartes lues${err}`);
  const b = $("#btn-mtgpics", zone);
  if (b) b.onclick = async () => {
    try { rendreMtgpics(zone, d, await api(`/api/decks/${enc(d.id)}/mtgpics`, { method: "POST", body: {} }), apres); }
    catch (e) { erreur(e); }
  };
}

function rendreClaude(zone, d, st, apres) {
  st = st || {};                                     // téléphone sans PC : jamais lancé ici
  if (st.actif && TELEPHONE) { zone.innerHTML = ligneSource("Claude", `<span class="pulse">●</span> cherche les synergies sur le PC…`); return; }
  if (st.actif) {
    const duree = (debut) => { const m = debut ? Math.floor((Date.now() / 1000 - debut) / 60) : 0; return m >= 1 ? ` · ${m} min` : ""; };
    zone.innerHTML = ligneSource("Claude", `<span class="pulse">●</span> cherche les synergies…<span data-duree>${duree(st.debut)}</span>`);
    (async () => {
      while (zone.isConnected) {
        await attendre(3000);
        const s = await api(`/api/decks/${enc(d.id)}/synergies`).catch(() => null);
        if (s && s.actif && $("[data-duree]", zone)) $("[data-duree]", zone).textContent = duree(s.debut);
        if (s && !s.actif) {
          if (s.erreur) toast("Synergies : " + s.erreur, 6000);
          if (zone.isConnected) apres();
          return;
        }
      }
    })();
    return;
  }
  const r = st.resultat;
  zone.innerHTML = ligneSource("Claude", `${r ? `Synergies du ${new Date(r.date * 1000).toLocaleDateString("fr-FR")}${st.a_jour ? "" : " · la liste a changé"}`
      : "Synergies entre les cartes du deck"}${st.erreur ? ` · <span class="erreur">${esc(st.erreur)}</span>` : ""}`,
    `<button class="btn btn-petit" id="btn-claude" ${TELEPHONE ? 'data-pc="synergies"' : ""}>${ico("discussion")}${r ? "Relancer" : "Chercher"}</button>`);
  $("#btn-claude", zone).onclick = async () => {
    try { rendreClaude(zone, d, await api(`/api/decks/${enc(d.id)}/synergies`, { method: "POST", body: {} }), apres); }
    catch (e) { erreur(e); }
  };
}

// ---- vue « une carte » : les autres cartes qui combotent avec elle
async function vueCombosCarte(zone, d, carte = null) {
  const cartes = d.cartes.filter((c) => c.cat !== "Maybeboard").map((c) => ({ nom: c.nom, aff: c.info.fr || c.nom }))
    .sort((a, b) => a.aff.localeCompare(b.aff, "fr"));
  const affiche = (nom) => (cartes.find((c) => c.nom === nom) || { aff: nom }).aff;
  zone.innerHTML = `<div class="cb-carte">
    <div class="barre-outils">
      <input class="champ" id="cb-carte" list="cb-cartes" placeholder="Choisis une carte du deck…" value="${carte ? esc(affiche(carte)) : ""}" style="flex:1;min-width:220px" autocomplete="off">
      <datalist id="cb-cartes">${cartes.map((c) => `<option value="${esc(c.aff)}">`).join("")}</datalist>
      <label class="petit"><input type="checkbox" id="cb-couleurs" ${PREF.get("combos-couleurs", "1") === "1" ? "checked" : ""}> Dans les couleurs du deck</label>
    </div>
    <div id="cb-src" class="petit"></div>
    <div id="cb-liste"></div></div>`;
  const champ = $("#cb-carte", zone), coul = $("#cb-couleurs", zone), liste = $("#cb-liste", zone), src = $("#cb-src", zone);
  let courante = carte;

  const afficher = async (force = false) => {
    if (!courante) return;
    const nom = courante;
    src.innerHTML = "";
    liste.innerHTML = `<p class="chargement">Combos de ${esc(affiche(nom))}…</p>`;
    let r;
    try { r = await api(`/api/decks/${enc(d.id)}/combos/carte?nom=${enc(nom)}&couleurs=${coul.checked ? 1 : 0}${force ? "&force=1" : ""}`); }
    catch (e) { liste.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; return; }
    if (nom !== courante) return;
    const m = r.mtgpics;
    src.innerHTML = m ? `<span class="muet">MTGPics${m.ref === null ? " : carte introuvable"
        : `${m.lues < m.pages ? ` · les ${m.lues * 20} plus fortes` : ""} · ${new Date(m.date * 1000).toLocaleDateString("fr-FR")}`}</span>
      <button class="btn btn-petit btn-discret" data-actualiser>Actualiser</button>` : "";
    const faisables = r.combos.filter((c) => !c.manque.length).length;
    liste.innerHTML = (r.erreur ? `<p class="erreur petit">${esc(r.erreur)}</p>` : "") + (r.combos.length ? `
      <p class="petit"><strong>${r.combos.length} combo${r.combos.length > 1 ? "s" : ""} avec ${esc(affiche(nom))}</strong>${faisables ? ` · ${faisables} déjà faisable${faisables > 1 ? "s" : ""} avec le deck` : ""}</p>
      <div class="combos">${r.combos.map((c) => ligneCombo(c, nom)).join("")}</div>`
      : `<p class="muet">Aucune combo connue avec ${esc(affiche(nom))}${coul.checked ? " dans les couleurs du deck" : ""}.</p>`);
  };

  const choisir = (nom) => {
    courante = nom;
    history.replaceState(null, "", `#/deck/${enc(d.id)}/combos/${enc(nom)}`);
    champ.value = affiche(nom);
    afficher();
  };
  zone.choisir = choisir;

  champ.addEventListener("change", async () => {
    const v = sansAccent(champ.value.trim());
    if (!v) return;
    let c = cartes.find((x) => sansAccent(x.aff) === v || sansAccent(x.nom) === v);
    if (!c) {                                                    // une carte hors du deck : la recherche habituelle
      const res = await api("/api/chercher?q=" + enc(champ.value.trim())).catch(() => []);
      if (res[0]) c = { nom: res[0].nom };
    }
    if (c) choisir(c.nom); else toast("Carte introuvable.");
  });
  coul.onchange = () => { PREF.set("combos-couleurs", coul.checked ? "1" : "0"); afficher(); };
  src.addEventListener("click", (ev) => { if (ev.target.closest("[data-actualiser]")) afficher(true); });
  if (carte) choisir(carte);
}

async function ongletCombos(el, d, carte = null) {
  el.innerHTML = `
    <div class="cb-tete">
      <div class="segments ecrit" role="group">
        <button type="button" data-vue="deck">${ico("liste")}Le deck</button>
        <button type="button" data-vue="carte">${ico("cartes")}Une carte</button>
      </div>
      <a class="btn btn-accent cb-sugg" href="#/deck/${enc(d.id)}/suggestions/combos">${ico("chercher")}Trouver d'autres combos</a>
    </div>
    <div id="cb-vue"></div>`;
  if (PARTAGE) carte = null;                     // page partagée : les combos du deck seulement
  const zone = $("#cb-vue", el);
  const montrer = (v, nom = null) => {
    $$("[data-vue]", el).forEach((b) => { b.classList.toggle("actif", b.dataset.vue === v); b.setAttribute("aria-pressed", b.dataset.vue === v); });
    zone.choisir = null;
    if (v === "deck") { history.replaceState(null, "", `#/deck/${enc(d.id)}/combos`); vueCombosDeck(zone, d); }
    else vueCombosCarte(zone, d, nom);
  };
  $$("[data-vue]", el).forEach((b) => (b.onclick = () => montrer(b.dataset.vue)));
  el.addEventListener("click", async (ev) => {
    const n = ev.target.closest(".cc[data-nom]");
    if (n) {                                                   // un nom de carte : ses combos
      cacherApercu();
      if (PARTAGE) { const c = d.cartes.find((x) => x.nom === n.dataset.nom); if (c) ouvrirCarte(c); return; }
      if (zone.choisir) zone.choisir(n.dataset.nom); else montrer("carte", n.dataset.nom);
      scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + scrollY - 80) });
      return;
    }
    const b = ev.target.closest("[data-maybe]");
    if (!b) return;
    b.disabled = true;
    try {
      const nd = await api(`/api/decks/${enc(d.id)}/modifier`, { method: "POST", body: { op: "ajouter", nom: b.dataset.maybe, tags: ["Maybeboard"], n: 1 } });
      etat.deck = nd;
      b.outerHTML = `<span class="badge badge-ok">✓ Maybeboard</span>`;
    } catch (e) { erreur(e); b.disabled = false; }
  });
  montrer(carte ? "carte" : "deck", carte);
}
// ------------------------------------------------------------------ onglet Simulation
const LIB_STAT = {
  cmd_mort: "commandant tué", cmd_sauve: "commandant sauvé", star_detruite: "carte clé détruite", rase_subi: "rase-boards subis",
  cimetiere_exile: "cimetière exilé", contre_subi: "sorts contrés", je_contre: "sorts que tu contres", greven_pioche: "cartes piochées par Greven",
  pioche_clamp: "cartes piochées par le Crâne", salves: "salves", defausse_fin: "cartes défaussées en fin de tour",
};
const LIB_SOURCE = {
  combat: "combat", entree: "à l'arrivée des créatures", effet: "effets", fling: "Fling / Thud", commandant: "blessures de commandant",
  brulure: "brûlures", pandemonium: "Pandemonium", greven: "Greven", combo: "combo adverse", aristo: "aristocrates adverses",
  combat_adv: "combats entre adversaires", brulure_adv: "brûlures entre adversaires", rite_adv: "Rite (jetons donnés)",
  pandemonium_adv: "Pandemonium (créatures adverses)", aristo_adv: "aristocrates entre adversaires", drain: "drains", aube: "Dawn of the Dead",
  bitterblossom: "Bitterblossom",
};
const lib = (k, table) => table[k] || k.replace(/_/g, " ");

function ecartHtml(e) {
  if (!e) return "";
  const m = e.m * 100, ic = e.ic * 100;
  const cls = m - ic > 0 ? "signif-plus" : m + ic < 0 ? "signif-moins" : "muet";
  return `<span class="${cls}">${m >= 0 ? "+" : ""}${m.toFixed(1).replace(".", ",")} ± ${ic.toFixed(1).replace(".", ",")} pt</span>`;
}

function listeChiffres(obj, table, format) {
  const e = Object.entries(obj || {}).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  return e.length ? e.map(([k, v]) => `${esc(lib(k, table))} ${format(v)}`).join(" · ") : "—";
}

// « Tester le deck » (sans IA) : un verdict et cinq jauges de régularité (simu.regularite), sans taux de victoire, qui
// n'a de sens que si le simulateur comprend les cartes. « Affiner avec Claude » : il décrit les cartes mal lues dans
// <deck>/simulateur.json (connaissances/simulateur.md) ; ses tests montrent alors aussi les victoires.
const NIVEAU_SIM = { bon: ["solide", "ok"], juste: ["juste", "juste"], alerte: ["faible", "alerte"] };
const VERDICT_SIM = { regulier: ["Deck régulier", "bon"], a_peaufiner: ["Deck à peaufiner", "juste"], irregulier: ["Deck irrégulier", "alerte"] };
const MESURES_SIM = [["terrains4", "4 terrains au tour 4", "%"], ["couleur", "Tours où une couleur manque (2 à 6)", "%"],
  ["mulligans", "Deux mulligans ou plus", "%"], ["vides", "Tours sans rien jouer (2 à 7)", "n"], ["usage", "Mana utilisé (tours 1 à 6)", "%"],
  ["defausse", "Défausse en fin de tour", "%"], ["permanents8", "Permanents au tour 8", "n"], ["creatures8", "Créatures au tour 8", "n"],
  ["morts_moi", "Tes créatures mortes", "n"], ["tues", "Créatures adverses détruites", "n"], ["crea_adv8", "Créatures par adversaire au tour 8", "n"],
  ["commandant", "Commandant à l'heure", "%"], ["cmd_tour", "Tour du commandant", "n"], ["cmd_mort", "Commandant tué", "n"]];
const nbSim = (v) => (v == null ? "—" : v.toFixed(1).replace(".", ",").replace(/,0$/, ""));
const dateSim = (d, style = "long") => new Date(d).toLocaleString("fr-FR", { dateStyle: style, timeStyle: "short" });

function jaugeSim(i) {
  if (!i || !i.niveau) return `<span class="muet">—</span>`;
  const [mot, cls] = NIVEAU_SIM[i.niveau];
  return `<span class="jauge"><span class="jauge-piste"><span class="jauge-barre jauge-${i.niveau}" style="width:${Math.round(i.place * 100)}%"></span>`
    + `<span class="jauge-cible" style="left:70%"></span></span><span class="badge badge-${cls}">${mot}</span></span>`
    + `<span class="sim-valeur">${esc(i.valeur)}</span>`;
}

function verdictSim(reg) {
  const [mot, niv] = VERDICT_SIM[reg.verdict] || ["—", "juste"];
  return `<span class="sim-verdict sim-${niv}">${mot}</span>`;
}

function afficheRapport(zone, r) {
  const t0 = r.tables.includes("Mixte") ? "Mixte" : r.tables[0];
  const L = r.resultats[t0];
  if (!L.A.regularite) return void (zone.innerHTML = "");       // rapport d'avant les jauges (effacés au démarrage)
  const cles = r.versions.B ? ["A", "B"] : ["A"];
  const reg = Object.fromEntries(cles.map((k) => [k, L[k].regularite]));
  const deux = cles.length > 1;
  const titre = deux ? `<h2 class="sim-titre">Comparaison</h2>` : `<h2 class="sim-titre">${verdictSim(reg.A)}</h2>`;
  const entete = deux ? `<span></span>${cles.map((k) => `<span class="sim-version"><strong>${esc(r.versions[k].nom)}</strong>${verdictSim(reg[k])}</span>`).join("")}` : "";
  const lignes = reg.A.indicateurs.map((ind, i) => `<span class="sim-nom">${esc(ind.titre)}</span>`
    + cles.map((k) => `<span class="sim-cellule">${jaugeSim(reg[k].indicateurs[i])}</span>`).join("")).join("");
  const constats = cles.filter((k) => reg[k].constats.length).map((k) => `
      <div class="sim-constats">${deux ? `<h3>${esc(r.versions[k].nom)}</h3>` : ""}
        <ul>${reg[k].constats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>`).join("");
  const victoires = r.affine ? `
      <h3>Victoires</h3>
      <div class="defile"><table class="tableau">
        <thead><tr><th>Adversaires</th>${cles.map((k) => `<th class="num">${deux ? esc(r.versions[k].nom) : "Victoires"}</th>`).join("")}${deux ? `<th class="num">Écart</th>` : ""}</tr></thead>
        <tbody>${r.tables.map((t) => `<tr><td>${esc(t)}</td>${cles.map((k) => `<td class="num">${pct(r.resultats[t][k].victoire)}</td>`).join("")}
          ${deux ? `<td class="num">${ecartHtml(r.resultats[t].ecart)}</td>` : ""}</tr>`).join("")}</tbody>
      </table></div>` : "";
  const mesures = MESURES_SIM.map(([cle, lib, u]) => `<tr><td>${esc(lib)}</td>${cles.map((k) => {
    const v = (reg[k].mesures || {})[cle];
    return `<td class="num">${v == null ? "—" : u === "%" ? pct(v, 0) : nbSim(v)}</td>`;
  }).join("")}</tr>`).join("");
  zone.innerHTML = `
    <div class="panneau sim-resultat">
      <div class="sim-tete">${titre}
        ${r.affine ? `<span class="badge badge-gc">Avec Claude</span>` : ""}
        <span class="muet petit">${esc(dateSim(r.date))} · ${r.n.toLocaleString("fr-FR")} parties</span></div>
      <div class="sim-grille${deux ? " sim-deux" : ""}">${entete}${lignes}</div>
      ${constats ? `<h3>Ce qui cloche</h3>${constats}` : ""}
      ${victoires}
      <details class="sim-details"><summary>Détails</summary>
        <div class="defile"><table class="tableau">
          ${deux ? `<thead><tr><th></th>${cles.map((k) => `<th class="num">${esc(r.versions[k].nom)}</th>`).join("")}</tr></thead>` : ""}
          <tbody>${mesures}</tbody></table></div>
      </details>
      <div class="boutons ecrit"><button class="btn" id="rap-claude">${ico("discussion")}Expliquer avec Claude</button></div>
    </div>`;
  $("#rap-claude", zone).onclick = () => ouvrirChat(`Explique-moi le test du simulateur ${r.deck}/simulations/${zone.dataset.fichier || ""}`
    + ` (python outils/atelier/demander.py rapport) : qu'est-ce qui ressort, et que me conseilles-tu ?`);
}

async function ongletSimulation(conteneur, d, rapportInitial = null) {
  conteneur.innerHTML = "";
  const el = document.createElement("div");          // zone neuve : pas d'écouteurs en double quand on réaffiche
  conteneur.appendChild(el);
  el.innerHTML = `<p class="chargement">Chargement…</p>`;
  const [o, rapports] = await Promise.all([api(`/api/decks/${enc(d.id)}/simulation/options`), api(`/api/decks/${enc(d.id)}/simulations`)]);
  const choixA = etat.simA ?? "", choixB = etat.simB ?? "__aucune__";
  const comparer = etat.simB != null;                  // arrivé de l'onglet Versions : la comparaison est prête
  etat.simA = etat.simB = undefined;
  const cov = o.couverture;
  const partCov = cov && cov.total ? cov.comprises / cov.total : null;
  const nivCov = partCov == null ? null : partCov >= 0.9 ? "bon" : partCov >= 0.7 ? "juste" : "alerte";
  const premier = rapportInitial || rapports.find((r) => r.verdict)?.fichier;   // les rapports d'avant la refonte ne s'ouvrent plus seuls
  el.innerHTML = `
    <div class="panneau sim-lancer ecrit">
      <div class="sim-boutons">
        <button class="btn btn-accent" id="s-lancer" data-pc="simulation">${ico("lancer")}Tester le deck</button>
        <button class="btn" id="s-claude" data-pc="claude">${ico("discussion")}Affiner avec Claude</button>
      </div>
      ${nivCov ? `<div class="sim-couverture"><span>Cartes comprises</span>
        <span class="jauge"><span class="jauge-piste"><span class="jauge-barre jauge-${nivCov}" style="width:${Math.max(3, Math.round(partCov * 100))}%"></span></span>
        <span class="jauge-val">${cov.comprises} / ${cov.total}</span></span>${o.affine ? `<span class="badge badge-gc">Avec Claude</span>` : ""}</div>` : ""}
      <div id="s-prog"></div>
    </div>
    <div id="s-rapport">${PARTAGE && !premier ? `<p class="muet">Aucun test.</p>` : ""}</div>
    <details class="sim-replie ecrit" id="s-comparer" ${comparer ? "open" : ""}><summary>Comparer deux versions</summary>
      <div class="grille-2">
        <label>Version A<select class="champ" id="s-a">${optionsVersions(o.versions, choixA)}</select></label>
        <label>Version B<select class="champ" id="s-b">${optionsVersions(o.versions, choixB === "__aucune__" ? null : choixB)}</select></label>
      </div>
      <div class="boutons"><button class="btn" id="s-comparer-lancer">${ico("comparer")}Comparer</button></div>
    </details>
    ${rapports.some((r) => r.fichier !== premier) ? `
    <details class="sim-replie"><summary>Tests précédents</summary>
      <div class="defile"><table class="tableau"><tbody>
      ${rapports.map((r, i) => `<tr><td class="petit">${esc(dateSim(r.date, "short"))}</td>
        <td class="petit">${esc(r.versions.A)}${r.versions.B ? ` · ${esc(r.versions.B)}` : ""}</td>
        <td>${verdictSim(r)}</td>
        <td class="num"><button class="btn btn-petit" data-rap="${i}">Ouvrir</button></td></tr>`).join("")}
      </tbody></table></div>
    </details>` : ""}`;

  const montrer = async (f) => {
    const z = $("#s-rapport", el);
    z.dataset.fichier = f;
    try { afficheRapport(z, await api(`/api/decks/${enc(d.id)}/simulations/${enc(f)}`)); }
    catch (e) { z.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
  };
  if (premier) await montrer(premier);

  $$("[data-rap]", el).forEach((b) => b.addEventListener("click", async () => {
    await montrer(rapports[+b.dataset.rap].fichier);
    $("#s-rapport", el).scrollIntoView({ behavior: "smooth" });
  }));
  if (PARTAGE) return;

  const lancer = async (corps) => {
    try {
      const job = await api(`/api/decks/${enc(d.id)}/simulations`, { method: "POST", body: corps });
      suivreSimulation(el, d, job.id, (f) => ongletSimulation(conteneur, d, f));
    } catch (e) { erreur(e); }
  };
  $("#s-lancer", el).onclick = () => lancer({ a: "", b: null, tables: ["Mixte"], n: o.test_n || 1000 });
  $("#s-comparer-lancer", el).onclick = () => {
    const a = $("#s-a", el).value, b = $("#s-b", el).value;
    if (a === b) return toast("Choisis deux versions différentes.");
    lancer({ a, b, tables: ["Mixte"], n: o.test_n || 1000 });
  };
  $("#s-claude", el).onclick = async () => {
    await ouvrirChat(`Affine le simulateur pour mon deck ${d.titre} : suis connaissances/simulateur.md (cartes mal lues,`
      + ` simulateur.json, trois essais au plus), puis explique-moi le résultat.`);
    envoyerChat();
  };
}

async function suivreSimulation(el, d, id, fini) {
  const prog = $("#s-prog", el);
  const boutons = $$("#s-lancer, #s-comparer-lancer", el);
  boutons.forEach((b) => (b.disabled = true));
  const tour = async () => {
    let j;
    try { j = await api("/api/jobs/" + id); } catch (e) { prog.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; boutons.forEach((b) => (b.disabled = false)); return; }
    if (j.statut === "en_cours") {
      prog.innerHTML = `<div class="barre-prog"><div style="width:${(100 * j.fait / j.total).toFixed(1)}%"></div></div>
        <div class="form-ligne" style="justify-content:space-between;margin:0"><span class="petit muet">${j.reste != null ? `encore ${j.reste < 90 ? j.reste + " s" : Math.round(j.reste / 60) + " min"}` : ""}</span>
        <button class="btn btn-petit" id="s-stop">${ico("arreter")}Arrêter</button></div>`;
      $("#s-stop", prog).onclick = () => api(`/api/jobs/${id}/annuler`, { method: "POST" });
      return setTimeout(tour, 700);
    }
    boutons.forEach((b) => (b.disabled = false));
    if (j.statut === "erreur") { prog.innerHTML = `<p class="erreur">${esc(j.erreur)}</p>`; return; }
    if (j.statut === "annule") { prog.innerHTML = ""; return; }
    fini(j.rapport);
  };
  tour();
}

// ------------------------------------------------------------------ recherche de cartes (moteur façon Magic-Ville)
// Mêmes fenêtres et mêmes règles que le moteur de Magic-Ville ; la recherche se fait sur la base locale (recherche.py).
// Les critères vivent dans l'adresse (#/recherche?…) : précédent / suivant du navigateur, favoris, plusieurs onglets.
const RCH_DEFAUTS = { fr: "1", en: "1", tm: "1", mvx: "1", fx: "1", ex: "1", format: "commander", ordre: "couleur" };
const RCH_TYPES = [["AR", "Artefact"], ["CR", "Créature"], ["EN", "Enchantement"], ["IN", "Éphémère"],
  ["SO", "Rituel"], ["BAT", "Bataille"], ["PL", "Planeswalker"], ["LA", "Terrain"]];
const RCH_SPE = [["", "Cartes spéciales"], ["colorless", "Symbole de mana incolore"], ["split", "Cartes doubles"], ["flip", "Cartes à inversion"],
  ["dfc", "Cartes recto-verso"], ["adv", "Cartes aventures"], ["hyb", "Coût de mana hybride"], ["phy", "Coût de mana phyrexian"],
  ["time", "Cartes décalées dans le temps"], ["historic", "Cartes « historiques »"], ["X", "Cartes avec X dans le coût de mana"]];
const RCH_SPT = [["", "Types spéciaux"], ["TR", "Clan (tribal)"], ["TK", "Jeton"], ["DUN", "Donjon"], ["PN", "Plan"], ["SC", "Machination"],
  ["CH", "Personnage (Vanguard)"], ["HE", "Héros"], ["CO", "Conspiration"]];
const RCH_FORMATS = [["commander", "Commander multi"], ["duel", "Commander 1 contre 1"], ["modern", "Modern"], ["pioneer", "Pioneer"],
  ["standard", "Standard"], ["vintage", "Vintage"], ["legacy", "Legacy"], ["premodern", "Premodern"], ["pauper", "Pauper"],
  ["historic", "Historic"], ["alchemy", "Alchemy"]];
const RCH_RARETES = [["M", "Mythique"], ["R", "Rare"], ["U", "Inhabituelle"], ["C", "Commune"]];
const RCH_TRIS = [["couleur", "Couleur"], ["nom", "Nom VO"], ["nomfr", "Nom VF"], ["type", "Type"], ["cout", "Coût"], ["prix", "Prix"],
  ["pop", "Popularité"], ["date", "Nouveautés"]];
const RCH_TRI_DESC = { date: true };                 // sens naturel : les plus récentes d'abord
const RCH_TRI_DECK = [["pertinence", "Pertinence"]];   // avec un deck lié : son thème, puis la popularité (suggestions.py)
// fonctions proposées d'un clic ; les autres (4 600 étiquettes de Scryfall Tagger) se cherchent dans le champ
const FN_RAPIDES = ["ramp", "pioche", "tuteur", "spot", "balayage", "contresort", "recursion", "reanimation", "sacrifice", "mort",
  "jetons", "celerite", "burn", "defausse", "wheel", "protection", "blink"];
const RCH_GC = [["", "Game Changers : indifférent"], ["sans", "Sans Game Changer"], ["seul", "Game Changers seulement"]];
const RCH_CMD = [["", "Commandant : indifférent"], ["peut", "Peut être commandant"], ["duo", "Partenaires et Historiques (deux commandants)"]];
const rch = { crit: null, deck: null, res: null, editions: null, fonctions: null, ouvert: true, numero: 0 };

const lettresWUBRG = (s, permis = "WUBRG") => [...permis].filter((k) => (s || "").includes(k)).join("");

function critDepuis(params) {
  const c = { ...RCH_DEFAUTS };
  for (const [k, v] of params) c[k] = v;
  // critères retirés du formulaire (anciennes adresses) ; « seules » est devenu la règle : aucune autre couleur que celles choisies
  for (const k of ["doit", "peut", "mult", "img", "versions", "fun", "cout", "un", "seules"]) delete c[k];
  if (c.cm === "2") c.oblig = lettresWUBRG(c.coul);       // ancienne case « Toutes » : chaque couleur choisie est obligatoire
  delete c.cm;
  return c;
}

function critVersHash(c) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(c)) {
    if (v == null || k.startsWith("_")) continue;
    if ((RCH_DEFAUTS[k] ?? "") !== v) p.set(k, v);
  }
  return p.toString();
}


// ---- fenêtres du formulaire
// couleurs : un clic = « peut » (permise), un second = « doit » (la carte doit l'avoir), un troisième = retirée ;
// l'incolore, deux états. Le mot s'écrit sous le symbole.
const ETAT_COULEUR = { actif: "peut", oblig: "doit" };
const titreCouleur = (k, etat) => (NOMS_COULEURS[k] || k)
  + (etat === "oblig" ? " : doit · cliquer pour retirer" : etat ? ` : peut${k === "C" ? "" : " · cliquer pour doit"}` : "");

function rchSymboles(groupe, valeur, lettres = "WUBRG", oblig = "") {
  return `<div class="rch-symboles" data-groupe="${groupe}" role="group">${[...lettres].map((k) => {
    const etat = (oblig || "").includes(k) && k !== "C" ? "oblig" : (valeur || "").includes(k) ? "actif" : "";
    return `<button type="button" class="rch-sym ${etat === "oblig" ? "actif oblig" : etat}" data-k="${k}" data-etat="${ETAT_COULEUR[etat] || ""}"
      aria-pressed="${!!etat}" title="${esc(titreCouleur(k, etat))}">${symbole(k)}</button>`;
  }).join("")}</div>`;
}

function marquerCouleur(b, etat) {            // etat : "" (retirée), "actif" (peut), "oblig" (doit)
  b.classList.toggle("actif", !!etat);
  b.classList.toggle("oblig", etat === "oblig");
  b.dataset.etat = ETAT_COULEUR[etat] || "";
  b.setAttribute("aria-pressed", !!etat);
  b.title = titreCouleur(b.dataset.k, etat);
}

function rchBascules(groupe, items, valeur, unique = false) {
  return `<div class="rch-bascules" data-groupe="${groupe}" ${unique ? 'data-unique="1"' : ""} role="group">${items.map(([k, l]) => {
    const on = unique ? valeur === k : (valeur || "").includes(k);
    return `<button type="button" class="rch-bascule ${on ? "actif" : ""}" data-k="${k}" aria-pressed="${on}">${esc(l)}</button>`;
  }).join("")}</div>`;
}

const rchCase = (nom, lib, c) => `<label class="rch-case"><input type="checkbox" name="${nom}" ${c[nom] === "1" ? "checked" : ""}> ${lib}</label>`;
const rchRadio = (nom, val, lib, c) => `<label class="rch-case"><input type="radio" name="${nom}" value="${val}" ${c[nom] === val ? "checked" : ""}> ${lib}</label>`;
const rchChamp = (nom, c, attrs = "") => `<input class="champ champ-petit" name="${nom}" value="${esc(c[nom] || "")}" ${attrs}>`;
const rchSelect = (nom, items, c) => `<select class="champ champ-petit" name="${nom}">${items.map(([k, l]) =>
  `<option value="${esc(k)}" ${(c[nom] || "") === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;

// formats en pastilles, rangés comme sur Magic-Ville
const RCH_FORMATS_ABR = { commander: "Multi", duel: "1vs1", modern: "Mod", pioneer: "Pio", standard: "Std", vintage: "Vin", legacy: "Leg",
  premodern: "Prem", pauper: "Pau", historic: "His", alchemy: "Alch" };
const RCH_FORMATS_RANGS = [["modern", "pioneer", "standard"], ["vintage", "legacy", "premodern", "pauper"], ["commander", "duel", "historic", "alchemy"]];

function rchFormats(valeur) {
  const nom = Object.fromEntries(RCH_FORMATS);
  return `<div class="rch-bascules rch-formats" data-groupe="format" data-unique="1" role="group">${RCH_FORMATS_RANGS.map((r) => `<div class="rch-formats-rang">${r.map((k) =>
    `<button type="button" class="rch-bascule rch-format ${valeur === k ? "actif" : ""}" data-k="${k}" aria-pressed="${valeur === k}" title="${esc(nom[k])}">${RCH_FORMATS_ABR[k]}</button>`).join("")}</div>`).join("")}</div>`;
}

// rareté : le symbole à la couleur de la rareté, comme sur Archidekt
const RCH_RARETE_COULEURS = { C: ["#7a7a7a", "#2e2e2e", "#0b0b0b"], U: ["#f1f5f8", "#a9bac4", "#56666f"], R: ["#f8e4a0", "#cfa63a", "#7a5a0c"], M: ["#ffc38a", "#e8641f", "#912707"] };

function iconeRarete(k) {
  const [a, b, z] = RCH_RARETE_COULEURS[k];
  return `<svg viewBox="0 0 24 32" width="30" height="40" aria-hidden="true"><defs><linearGradient id="rar-${k}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${z}"/></linearGradient></defs>
    <rect x="1.5" y="1.5" width="21" height="29" rx="3" fill="url(#rar-${k})" stroke="rgba(0,0,0,.55)"/>
    <rect x="4.5" y="4.5" width="15" height="23" rx="1.5" fill="none" stroke="rgba(255,255,255,.45)"/></svg>`;
}

function rchRaretes(valeur) {
  const nom = Object.fromEntries(RCH_RARETES);
  return `<div class="rch-bascules rch-raretes" data-groupe="rar" role="group">${["C", "U", "R", "M"].map((k) => {
    const on = (valeur || "").includes(k);
    return `<button type="button" class="rch-bascule rch-rar ${on ? "actif" : ""}" data-k="${k}" aria-pressed="${on}" title="${nom[k]}" aria-label="${nom[k]}">${iconeRarete(k)}</button>`;
  }).join("")}</div>`;
}

function rchNombres(titre, cle, x, c) {
  const champ = (n) => rchChamp(n, c, 'inputmode="decimal" size="3"');
  return `<section class="fen fen-nombres"><h3 class="fen-titre">${titre}</h3>
    <div class="rch-nb">
      <label>Égal à ${champ(cle)}</label>
      <label>Max ${champ(cle + "max")}</label>
      <label>Min ${champ(cle + "min")}</label>
    </div>
    <div class="rch-cases rch-centre">${rchCase(x, cle === "mv" ? "X inclus" : "* inclus", c)}${cle === "mv" ? rchCase("pair", "pair", c) + rchCase("impair", "impair", c) : ""}</div>
  </section>`;
}

// pense-bête du champ Texte (bouton « ? ») : la syntaxe de recherche._termes, les symboles, des exemples à cliquer
const PB_SYNTAXE = [
  ["pioch carte", "Tous les mots, dans n'importe quel ordre. Un bout de mot suffit : « pioch » trouve piochez, piocher, pioche."],
  ['"draw a card"', "Cette expression exacte : ces mots, dans cet ordre, espaces et ponctuation compris."],
  ["!additio", "Exclut les cartes qui contiennent ce mot ou ce bout de mot (additional, additionnel…)."],
  ['!"additional cost"', "Exclut les cartes qui contiennent cette expression."],
  ['sacrifice !"additional cost"', "Se combinent : les cartes qui parlent de sacrifier, sauf en coût additionnel."],
];
const PB_SYMBOLES = [
  ["{t}", "{T} engager"], ["{q}", "{Q} dégager"], ["{w} {u} {b} {r} {g}", "{W}{U}{B}{R}{G} blanc, bleu, noir, rouge, vert"],
  ["{c}", "{C} incolore"], ["{1} {2} {3}…", "{2} mana générique"], ["{x}", "{X} X"], ["{w/u}", "{W/U} hybride"], ["{2/w}", "{2/W} hybride à 2"],
  ["{w/p}", "{W/P} phyrexian"], ["{s}", "{S} neige"], ["{e}", "{E} énergie"],
];
const PB_EXEMPLES = [
  ['"add {c}{c}" !"add {c}{c}{c}"', "Ajoute exactement deux manas incolores (Sol Ring, Worn Powerstone)"],
  ['"add {c}{c}"', "Ajoute au moins deux manas incolores (avec Mana Vault, Thran Dynamo)"],
  ['"add {c}{c}{c}"', "Ajoute au moins trois manas incolores"],
  ['"add two mana"', "Ajoute deux manas d'une couleur au choix"],
  ['"add {r}{r}"', "Ajoute deux manas rouges"],
  ['"add {b}{r}"', "Ajoute un noir et un rouge (Rakdos Signet, Rakdos Carnarium)"],
  ['"{t}:" add', "S'engage pour produire du mana (texte anglais)"],
  ['"{t} :" ajoutez', "La même chose en français (espace avant les deux-points)"],
  ['"each opponent"', "Chaque adversaire (en français : \"chaque adversaire\")"],
  ['"enters tapped"', "Arrive engagé"],
  ['"when this creature enters"', "Quand cette créature arrive sur le champ de bataille"],
  ['"pay {e}"', "Paye de l'énergie"],
  ["treasure", "Les Trésors (\"tresor\" en français)"],
];

function penseBeteTexte(form) {
  const ligne = (code, texte, ex) => `<tr><td>${ex ? `<button type="button" class="pb-exemple" data-exemple="${esc(code)}"><code class="brut">${esc(code)}</code></button>`
    : `<code class="brut">${esc(code)}</code>`}</td><td>${esc(texte)}</td></tr>`;
  ouvrirModale(`
    <h2>Recherche texte</h2>
    <div class="pense-bete">
      <table>${PB_SYNTAXE.map(([c, t]) => ligne(c, t)).join("")}</table>
      <h3>Règles</h3>
      <ul>
        <li>Majuscules et accents ne comptent pas ; ’ et ' se valent.</li>
        <li>Les mots à trouver doivent tous être dans le même texte, anglais ou français. Une exclusion vaut pour les deux.</li>
        <li>Cases « français » et « anglais » : chercher dans une seule langue ; aucune cochée, les deux.</li>
        <li>Le texte français n'existe que pour les cartes imprimées en français : en anglais, la recherche est complète.</li>
        <li>Le champ cherche dans le texte de règles, pas dans le coût : pour le coût, c'est le champ Coût, dans Couleurs.</li>
        <li>Pas de joker (* ou %) ni de « ou » : une recherche par variante.</li>
        <li>Titre et Type suivent les mêmes règles.</li>
        <li>« sans texte » : les cartes sans texte de règles. Ctrl+Entrée dans le champ lance la recherche.</li>
      </ul>
      <h3>Symboles</h3>
      <table>${PB_SYMBOLES.map(([c, t]) => ligne(c, t)).join("")}</table>
      <p class="muet petit">Anglais : <code class="brut">{T}: Add {C}{C}.</code> Français : <code class="brut">{T} : Ajoutez {C}{C}.</code></p>
      <h3>Exemples</h3>
      <table>${PB_EXEMPLES.map(([c, t]) => ligne(c, t, true)).join("")}</table>
    </div>`,
  (b) => {
    $$("[data-exemple]", b).forEach((x) => {
      x.onclick = () => { form.elements.texte.value = x.dataset.exemple; fermerModale(); form.elements.texte.focus(); };
    });
  }, { focus: false, large: true });
}

// la disposition du moteur de Magic-Ville, simplifiée : Couleurs (coût compris) | Types | Recherche texte,
// puis Valeur de mana, Force, Endurance, Rechercher, Format, Rareté ; en dessous, ce que l'Atelier ajoute, puis les éditions
function formulaireRecherche(c) {
  const d = rch.deck;
  return `<form id="moteur" class="moteur" autocomplete="off">
    <div class="mt-rang mt-haut">
      <section class="fen fen-couleurs"><h3 class="fen-titre">Couleurs</h3>
        ${rchSymboles("coul", c.coul, "WUBRGC", c.oblig)}
        <div class="rch-cases ${d && d.identite ? "rch-entre" : "rch-centre"}">${rchCase("id", "Identité de couleur", c)}${d && d.identite ? `<button type="button" class="lien-discret" data-act="identite" title="Couleurs du commandant et incolores">Couleurs de ${esc(d.titre)} ${identiteHtml(d.identite)}</button>` : ""}</div>
        ${rchSelect("spe", RCH_SPE, c)}
      </section>
      <section class="fen fen-types"><h3 class="fen-titre">Types</h3>
        <div class="rch-types">${RCH_TYPES.map(([k, l]) => `<label class="rch-case"><input type="checkbox" name="types" value="${k}" ${(c.types || "").split(",").includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div>
        <div class="rch-cases rch-ligne-types">${rchRadio("tm", "1", "Au moins un", c)}${rchRadio("tm", "2", "Tous", c)}${rchSelect("spt", RCH_SPT, c)}</div>
      </section>
      <section class="fen fen-texte"><h3 class="fen-titre">Recherche texte</h3>
        <div class="rch-cases rch-centre">${rchCase("fr", "français", c)}${rchCase("en", "anglais", c)}</div>
        <label class="rch-ligne">Titre <input class="champ champ-petit" name="nom" type="search" value="${esc(c.nom || "")}"></label>
        <label class="rch-ligne">Type <input class="champ champ-petit" name="type" value="${esc(c.type || "")}" placeholder="gobelin, légendaire, equipment…"></label>
        <div class="rch-bloc rch-bloc-texte"><span class="rch-texte-tete"><span>Texte <button type="button" class="aide-q" data-act="aide-texte" aria-label="Pense-bête de la recherche texte">?</button></span> ${rchCase("vanilla", "sans texte", c)}</span>
          <textarea class="champ" name="texte" rows="2" placeholder="défaussez, &quot;chaque adversaire&quot;, !additio…">${esc(c.texte || "")}</textarea></div>
      </section>
    </div>
    <div class="mt-rang mt-milieu">
      ${rchNombres("Valeur de mana", "mv", "mvx", c)}
      ${rchNombres("Force", "f", "fx", c)}
      ${rchNombres("Endurance", "e", "ex", c)}
      <div class="mt-go">
        <button class="rch-go" type="submit">${ico("chercher")}Rechercher</button>
        <button class="lien-discret" type="button" data-act="raz">${ico("effacer")}Tout effacer</button>
      </div>
      <section class="fen fen-format"><h3 class="fen-titre">Format</h3>${rchFormats(c.format || "")}</section>
      <section class="fen fen-rarete"><h3 class="fen-titre">Rareté</h3>${rchRaretes(c.rar || "")}</section>
    </div>
    <div class="mt-rang mt-plus">
      <section class="fen fen-atelier"><h3 class="fen-titre">Prix et Commander</h3>
        <div class="rch-nombres">
          <label>Prix max ${rchChamp("prixmax", c, 'inputmode="decimal" size="4"')} €</label>
          <label>Prix min ${rchChamp("prixmin", c, 'inputmode="decimal" size="4"')} €</label>
          ${BUDGET < Infinity ? `<button type="button" class="btn btn-petit" data-act="budget">≤ ${BUDGET_TXT}</button>` : ""}
        </div>
        ${rchSelect("gc", RCH_GC, c)}
        ${rchSelect("cmd", RCH_CMD, c)}
        ${d ? rchCase("horsdeck", `Pas déjà dans ${esc(d.titre)}`, c) : ""}
      </section>
      <section class="fen fen-fonctions"><h3 class="fen-titre">Fonctions</h3>
        <div id="fn-choisies" class="puces"></div>
        <div class="fn-champ">
          <input class="champ champ-petit" id="fn-q" type="search" autocomplete="off" placeholder="Chercher une fonction…"
            aria-label="Chercher une fonction" role="combobox" aria-expanded="false" aria-controls="fn-liste" aria-autocomplete="list">
          <div id="fn-liste" class="fn-liste" role="listbox" hidden></div>
        </div>
        <div class="rch-bascules fn-rapides">${FN_RAPIDES.map((k) => `<button type="button" class="rch-bascule" data-fn="${k}">${esc(nomFn(k, true))}</button>`).join("")}</div>
      </section>
    </div>
    <section class="fen fen-editions"><h3 class="fen-titre">Éditions</h3>
      <div class="eds-tete">
        <input class="champ champ-petit" type="search" id="eds-filtre" placeholder="Chercher une édition…" aria-label="Chercher une édition">
        ${rchCase("neuves", "Nouvelles cartes uniquement", c)}
      </div>
      <div id="eds-choisies" class="puces"></div>
      <div id="eds-groupes" class="eds-groupes"><p class="muet petit">Éditions…</p></div>
    </section>
    <div class="mt-pied"><button class="lien-discret" type="button" data-act="raz">${ico("effacer")}Tout effacer</button>
      <button class="btn btn-accent" type="submit">${ico("chercher")}Rechercher</button></div>
  </form>`;
}

// ---- lire le formulaire
function lireFormulaire(form) {
  const c = {};
  const val = (n) => (form.elements[n] ? form.elements[n].value.trim() : "");
  for (const n of ["nom", "type", "texte", "mv", "mvmax", "mvmin", "f", "fmax", "fmin", "e", "emax", "emin", "prixmax", "prixmin", "spe", "spt", "gc", "cmd"]) c[n] = val(n);
  c.fn = (rch.fns || []).join(",");
  for (const n of ["fr", "en", "vanilla", "id", "mvx", "pair", "impair", "fx", "ex", "neuves", "horsdeck"]) {
    const el = form.elements[n];
    c[n] = el && el.checked ? "1" : "";
  }
  c.tm = (form.querySelector('input[name="tm"]:checked') || {}).value || "1";
  c.types = $$('input[name="types"]:checked', form).map((x) => x.value).join(",");
  for (const g of $$(".rch-symboles[data-groupe], .rch-bascules[data-groupe]", form)) {
    const on = $$(".actif", g).map((b) => b.dataset.k);
    c[g.dataset.groupe] = g.dataset.unique ? (on[0] || "") : on.join("");
  }
  c.oblig = $$('.rch-symboles[data-groupe="coul"] .oblig', form).map((b) => b.dataset.k).join("");
  c.eds = [...(rch.eds || [])].join(",");
  return c;
}

// ---- résumé des critères (formulaire replié)
function resumeCrit(c) {
  const r = [];
  const nb = (cle, lib) => {
    const p = [];
    if (c[cle]) p.push("= " + c[cle]);
    if (c[cle + "min"]) p.push("≥ " + c[cle + "min"]);
    if (c[cle + "max"]) p.push("≤ " + c[cle + "max"]);
    if (p.length) r.push(`${lib} ${p.join(" et ")}`);
  };
  if (c.nom) r.push(`Titre : ${c.nom}`);
  if (c.type) r.push(`Type : ${c.type}`);
  if (c.texte) r.push(`Texte : ${c.texte}`);
  if (c.vanilla === "1") r.push("Sans texte");
  if (c.coul || c.oblig) {
    const doit = [...(c.oblig || "")], peut = [...(c.coul || "")].filter((k) => !doit.includes(k));
    r.push(`Couleurs${c.id === "1" ? " (identité)" : ""} : ${[doit.length && doit.join(" ") + " doit", peut.length && peut.join(" ") + " peut"]
      .filter(Boolean).join(", ")}`);
  }
  if (c.types) r.push(c.types.split(",").map((k) => (RCH_TYPES.find((t) => t[0] === k) || [k, k])[1]).join(c.tm === "2" ? " et " : " ou "));
  if (c.spt) r.push((RCH_SPT.find((t) => t[0] === c.spt) || ["", c.spt])[1]);
  if (c.spe) r.push((RCH_SPE.find((t) => t[0] === c.spe) || ["", c.spe])[1]);
  nb("mv", "Valeur de mana"); nb("f", "Force"); nb("e", "Endurance");
  if (c.pair === "1") r.push("valeur paire");
  if (c.impair === "1") r.push("valeur impaire");
  if (c.format) r.push((RCH_FORMATS.find((f) => f[0] === c.format) || ["", c.format])[1]);
  if (c.rar) r.push([...c.rar].map((k) => (RCH_RARETES.find((x) => x[0] === k) || [k, k])[1]).join(", "));
  if (c.eds) r.push(`${c.neuves === "1" ? "Nouvelles cartes de " : "Éditions : "}${c.eds.split(",").map((e) => e.toUpperCase()).join(", ")}`);
  if (c.prixmax || c.prixmin) r.push(`Prix ${c.prixmin ? "≥ " + c.prixmin + " € " : ""}${c.prixmax ? "≤ " + c.prixmax + " €" : ""}`.trim());
  if (c.fn) r.push("Fonctions : " + c.fn.split(",").map((k) => nomFn(k, true)).join(" + "));
  if (c.gc) r.push((RCH_GC.find((g) => g[0] === c.gc) || ["", c.gc])[1]);
  if (c.cmd) r.push((RCH_CMD.find((g) => g[0] === c.cmd) || ["", c.cmd])[1]);
  if (c.horsdeck === "1") r.push("pas déjà dans le deck");
  return r;
}

// ---- la page
async function vueRecherche(params) {
  // lien du haut : un formulaire vierge. Bouton « Chercher pour ce deck » : vierge aussi, aux couleurs du deck
  const neuve = [...params.keys()].every((k) => k === "deck");
  scrollTo(0, 0);
  const c = critDepuis(params);
  c.deck = c.deck || "";                           // pas de deck dans l'adresse : recherche sans deck
  etat.deck = null;
  let [ds, fonctions] = await Promise.all([listeDecks(), rch.fonctions ? rch.fonctions : api("/api/recherche/fonctions").catch(() => [])]);
  rch.fonctions = fonctions.length ? fonctions : null;            // vide (base pas prête) : redemandée la prochaine fois
  if (c.deck && !ds.some((d) => d.id === c.deck)) {        // deck créé dans un autre onglet : on relit la liste
    etat.decks = [];
    ds = await listeDecks();
  }
  if (c.deck && !ds.some((d) => d.id === c.deck)) c.deck = "";
  rch.deck = c.deck ? await api(`/api/decks/${enc(c.deck)}/apercu`).catch(() => null) : null;
  if (!rch.deck) c.deck = "";
  if (neuve && rch.deck && rch.deck.identite) Object.assign(c, critIdentite(rch.deck));    // nouvelle recherche pour un deck : ses couleurs
  rch.crit = c;
  rch.eds = new Set((c.eds || "").split(",").filter(Boolean));
  rch.fns = (c.fn || "").split(",").filter(Boolean);
  rch.ouvert = c.r !== "1" || rch.ouvrir === true;
  rch.ouvrir = false;
  vue.innerHTML = `
    <div class="rch-tete">
      <nav class="fil" aria-label="Fil d'Ariane"><a href="${PARTAGE ? esc(PARTAGE.accueil) : "#/"}">${esc(MES_DECKS)}</a><span aria-hidden="true">›</span>${rch.deck ? `<a href="#/deck/${enc(rch.deck.id)}">${esc(rch.deck.titre)}</a><span aria-hidden="true">›</span>` : ""}<span aria-current="page">Recherche avancée</span></nav>
      ${rch.deck || PARTAGE ? "" : `<div class="rch-deck">
        <label class="petit muet" for="rch-deck">Pour le deck</label>
        <select class="champ champ-petit" id="rch-deck">
          <option value="">— aucun —</option>
          ${[...ds].sort((a, b) => recence(b) - recence(a) || a.titre.localeCompare(b.titre)).map((d) =>
            `<option value="${esc(d.id)}">${esc(d.titre)}</option>`).join("")}
        </select>
      </div>`}
    </div>
    ${PARTAGE ? `<h1 class="rch-h1">Recherche avancée de cartes Magic</h1>` : ""}
    ${rch.deck ? `<div class="rch-bandeau ${rch.deck.art ? "" : "sans-art"}"${rch.deck.art ? ` style="background-image:url('${esc(rch.deck.art)}')"` : ""}>
      <span class="rch-bandeau-nom">${esc(rch.deck.titre)}</span>
      <span id="rch-deck-info" class="petit"></span>
      <button type="button" class="btn btn-discret btn-icone" id="rch-sans-deck" aria-label="Chercher sans deck" title="Chercher sans deck">${ico("fermer")}</button>
    </div>` : ""}
    <div id="rch-form"></div>
    <div id="rch-resultats"></div>`;
  majInfosDeck();
  const changerDeck = (id) => {
    if (id) choisirDiscussion(id);                 // chercher pour un autre deck : sa discussion suit
    const nc = { ...rch.crit, deck: id };
    if (!id) delete nc.horsdeck;
    const form = $("#moteur");
    if (form && rch.ouvert) Object.assign(nc, lireFormulaire(form), { deck: id, r: rch.crit.r, ordre: rch.crit.ordre, sens: rch.crit.sens, vue: rch.crit.vue });
    rch.ouvrir = rch.ouvert;
    location.hash = "#/recherche?" + critVersHash(nc);
  };
  if (rch.deck) $("#rch-sans-deck").onclick = () => changerDeck("");
  else if (!PARTAGE) $("#rch-deck").onchange = (ev) => changerDeck(ev.target.value);
  rendreFormulaire();
  if (c.r === "1") await lancerRecherche();
}

// page partagée : la recherche et la discussion en vitrine, grisées, avec le lien pour installer l'Atelier chez soi
function invitation(titre, texte) {
  return `<div class="vitrine-invite panneau">
    <h2>${esc(titre)}</h2>
    <p>${esc(texte)}</p>
    <a class="btn btn-accent" href="${INSTALLER}">${ico("telecharger")}Installer l'Atelier MTG</a>
  </div>`;
}

function vueRechercheVitrine() {
  scrollTo(0, 0);
  etat.deck = null;
  rch.deck = null;
  rch.fonctions = (PARTAGE.api["/api/recherche/fonctions"] || []);
  rch.crit = { ...RCH_DEFAUTS };
  rch.eds = new Set();
  rch.fns = [];
  vue.innerHTML = `
    <div class="rch-tete">
      <nav class="fil" aria-label="Fil d'Ariane"><a href="${esc(PARTAGE.accueil === true ? "#/" : PARTAGE.accueil)}">${esc(MES_DECKS)}</a><span aria-hidden="true">›</span>${PARTAGE.deck ? `<a href="#/">${esc(PARTAGE.deck.replace(/^Deck /, ""))}</a><span aria-hidden="true">›</span>` : ""}<span aria-current="page">Recherche avancée</span></nav>
    </div>
    <div class="vitrine">
      <div class="vitrine-fond" inert aria-hidden="true">${formulaireRecherche(rch.crit)}</div>
      ${invitation("Recherche avancée", "Disponible dans l'Atelier MTG, à installer gratuitement sur son ordinateur.")}
    </div>`;
}

// « C'est quoi, l'Atelier MTG ? » : la page qui présente l'outil aux visiteurs d'une page partagée (bandeau et pied de page).
// L'histoire est celle de l'auteur de l'Atelier, pas forcément celle de la personne qui partage ses decks.
const AUTEUR_ATELIER = "PierreRibeaucourt";
const DEPOT_ATELIER = "https://github.com/PierreRibeaucourt/atelier-mtg";
// les captures de la page : sur le site de decks de l'auteur, pas dans le dépôt de code (on y voit des cartes et une discussion)
// la page d'accueil a sa copie des captures (PARTAGE.captures) ; ailleurs, celle de la page d'accueil
const CAPTURES_ATELIER = (PARTAGE && PARTAGE.captures) || DOMAINE_ATELIER + "a-propos/";
// les decks partagés de l'auteur : à quoi ressemble une page partagée, en vrai
const EXEMPLES_ATELIER = "https://pierreribeaucourt.github.io/decks/";
// l'Atelier sur téléphone (telephone.js), et son adresse en QR code pour qui visite la page depuis un ordinateur
const APPLI_TELEPHONE = "https://atelier-mtg.github.io/";
const QR_APPLI = `<svg class="ap-qr" viewBox="0 0 33 33" role="img" aria-label="QR code de atelier-mtg.github.io"><rect width="33" height="33" fill="#fff"/><path fill="#000" d="M2 2h7v1h-7zM11 2h1v1h-1zM13 2h2v1h-2zM17 2h3v1h-3zM24 2h7v1h-7zM2 3h1v1h-1zM8 3h1v1h-1zM10 3h1v1h-1zM12 3h1v1h-1zM14 3h3v1h-3zM18 3h1v1h-1zM22 3h1v1h-1zM24 3h1v1h-1zM30 3h1v1h-1zM2 4h1v1h-1zM4 4h3v1h-3zM8 4h1v1h-1zM10 4h2v1h-2zM14 4h2v1h-2zM17 4h1v1h-1zM20 4h1v1h-1zM24 4h1v1h-1zM26 4h3v1h-3zM30 4h1v1h-1zM2 5h1v1h-1zM4 5h3v1h-3zM8 5h1v1h-1zM10 5h1v1h-1zM12 5h2v1h-2zM18 5h2v1h-2zM21 5h2v1h-2zM24 5h1v1h-1zM26 5h3v1h-3zM30 5h1v1h-1zM2 6h1v1h-1zM4 6h3v1h-3zM8 6h1v1h-1zM11 6h1v1h-1zM17 6h6v1h-6zM24 6h1v1h-1zM26 6h3v1h-3zM30 6h1v1h-1zM2 7h1v1h-1zM8 7h1v1h-1zM12 7h2v1h-2zM17 7h1v1h-1zM20 7h1v1h-1zM22 7h1v1h-1zM24 7h1v1h-1zM30 7h1v1h-1zM2 8h7v1h-7zM10 8h1v1h-1zM12 8h1v1h-1zM14 8h1v1h-1zM16 8h1v1h-1zM18 8h1v1h-1zM20 8h1v1h-1zM22 8h1v1h-1zM24 8h7v1h-7zM10 9h5v1h-5zM16 9h3v1h-3zM20 9h3v1h-3zM2 10h1v1h-1zM8 10h1v1h-1zM10 10h1v1h-1zM12 10h1v1h-1zM18 10h2v1h-2zM23 10h2v1h-2zM27 10h3v1h-3zM2 11h1v1h-1zM4 11h1v1h-1zM6 11h2v1h-2zM9 11h2v1h-2zM12 11h2v1h-2zM15 11h1v1h-1zM18 11h1v1h-1zM21 11h1v1h-1zM25 11h2v1h-2zM28 11h2v1h-2zM2 12h1v1h-1zM6 12h1v1h-1zM8 12h1v1h-1zM10 12h4v1h-4zM15 12h4v1h-4zM23 12h2v1h-2zM26 12h1v1h-1zM4 13h3v1h-3zM10 13h1v1h-1zM15 13h1v1h-1zM21 13h3v1h-3zM25 13h1v1h-1zM27 13h1v1h-1zM2 14h1v1h-1zM5 14h1v1h-1zM8 14h3v1h-3zM13 14h3v1h-3zM17 14h2v1h-2zM22 14h1v1h-1zM24 14h2v1h-2zM30 14h1v1h-1zM5 15h2v1h-2zM9 15h1v1h-1zM11 15h1v1h-1zM13 15h2v1h-2zM18 15h1v1h-1zM20 15h2v1h-2zM24 15h3v1h-3zM29 15h2v1h-2zM2 16h4v1h-4zM7 16h3v1h-3zM12 16h2v1h-2zM19 16h2v1h-2zM22 16h1v1h-1zM25 16h4v1h-4zM2 17h1v1h-1zM4 17h1v1h-1zM12 17h2v1h-2zM17 17h1v1h-1zM20 17h2v1h-2zM23 17h4v1h-4zM28 17h1v1h-1zM30 17h1v1h-1zM3 18h1v1h-1zM5 18h2v1h-2zM8 18h1v1h-1zM10 18h1v1h-1zM12 18h3v1h-3zM18 18h3v1h-3zM27 18h2v1h-2zM2 19h1v1h-1zM5 19h1v1h-1zM7 19h1v1h-1zM12 19h1v1h-1zM15 19h2v1h-2zM19 19h8v1h-8zM28 19h3v1h-3zM2 20h3v1h-3zM8 20h3v1h-3zM12 20h3v1h-3zM17 20h1v1h-1zM21 20h7v1h-7zM30 20h1v1h-1zM2 21h1v1h-1zM4 21h1v1h-1zM6 21h2v1h-2zM10 21h1v1h-1zM13 21h1v1h-1zM15 21h1v1h-1zM20 21h1v1h-1zM22 21h1v1h-1zM24 21h3v1h-3zM2 22h1v1h-1zM6 22h1v1h-1zM8 22h5v1h-5zM16 22h2v1h-2zM19 22h1v1h-1zM22 22h5v1h-5zM28 22h3v1h-3zM10 23h1v1h-1zM12 23h1v1h-1zM16 23h1v1h-1zM19 23h4v1h-4zM26 23h2v1h-2zM2 24h7v1h-7zM11 24h1v1h-1zM13 24h2v1h-2zM20 24h3v1h-3zM24 24h1v1h-1zM26 24h3v1h-3zM2 25h1v1h-1zM8 25h1v1h-1zM12 25h1v1h-1zM16 25h3v1h-3zM21 25h2v1h-2zM26 25h1v1h-1zM30 25h1v1h-1zM2 26h1v1h-1zM4 26h3v1h-3zM8 26h1v1h-1zM14 26h3v1h-3zM18 26h1v1h-1zM21 26h7v1h-7zM2 27h1v1h-1zM4 27h3v1h-3zM8 27h1v1h-1zM11 27h3v1h-3zM15 27h2v1h-2zM19 27h3v1h-3zM25 27h1v1h-1zM27 27h3v1h-3zM2 28h1v1h-1zM4 28h3v1h-3zM8 28h1v1h-1zM14 28h6v1h-6zM21 28h9v1h-9zM2 29h1v1h-1zM8 29h1v1h-1zM11 29h2v1h-2zM17 29h1v1h-1zM23 29h1v1h-1zM25 29h4v1h-4zM30 29h1v1h-1zM2 30h7v1h-7zM10 30h1v1h-1zM14 30h1v1h-1zM19 30h3v1h-3zM26 30h1v1h-1zM28 30h1v1h-1z"/></svg>`;
// un téléphone ou une tablette (iPadOS se présente comme un Mac, mais tactile)
const SUR_TELEPHONE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
// pour qui n'a pas encore d'assistant IA : Claude Code dans l'application de bureau, sans terminal (guide en français)
const CLAUDE_BUREAU = "https://code.claude.com/docs/fr/desktop-quickstart";
// [capture, titre, texte] ; « Les bases » : ce qu'on attend de tout gestionnaire de decks
const MODULES_BASES = [
  ["appareils", "Vos decks, sans compte ni prise de tête", "Création, import, affichage en liste ou visuel, taille des cartes réglable, tri par type, tag ou fonction : organisez vos cartes exactement comme vous l'entendez. Utilisez l'outil sur ordinateur, sur mobile, ou synchronisez les deux selon vos besoins."],
  ["recherche", "Recherche avancée", "Une recherche multicritère comme celle de Magic-Ville, avec en plus un filtre de prix Cardmarket et une catégorisation automatique des cartes : ramp, pioche, tuteur, removal…"],
  ["jouer", "Table de jeu", "Jouez vos decks en solo pour tester les mains de départ et les premiers tours : pioche, mulligan, jetons, marqueurs, planeswalkers, tout au clic ou au glisser."],
  ["versions", "Versions et historique", "Chaque modification est gardée. Enregistrez des versions, comparez deux listes, revenez en arrière."],
];
// « Ce qui fait la différence » : ce que les autres outils n'ont pas, du plus marquant au moins marquant
const MODULES_ATOUTS = [
  ["simulateur", "Simulateur de parties", "En un clic, simulez 1 000 parties à quatre joueurs pour tester la régularité de votre deck (mana, présence sur table, gestion, sortie du commandant). Comparez deux versions d'une même liste pour mesurer vos changements. Avec Claude, le simulateur apprend les cartes complexes, rejoue et vous détaille ses résultats."],
  ["bracket", "Bracket", "Le bracket est estimé automatiquement selon les règles officielles : Game Changers, combos infinies à deux cartes, tuteurs… et comparé à l'estimation de Commander Spellbook."],
  ["statistiques", "Statistiques et base de mana", "Courbe de mana, types, fonctions des cartes et surtout la répartition des sources de couleur : elle compte les terrains et les cartes de ramp, et dit si chaque couleur est confortable."],
  ["suggestions", "Suggestions de cartes", "Des recommandations ciblées selon votre commandant, vos combos et votre classeur. Triées par pertinence, adaptées à vos couleurs et à votre budget, avec filtres par type, coût et prix."],
  ["budget", "Prix Cardmarket et budget", "Les prix Cardmarket pour vos cartes et vos decks, avec alerte en cas de dépassement de budget. Exportez les cartes manquantes au format liste de souhaits Cardmarket en un clic pour calculer directement votre panier."],
  ["combos", "Combos", "Les combos du deck sont repérées automatiquement, en croisant plusieurs sources : MTGPics (la base de Magic-Ville) et Commander Spellbook."],
  ["discussion", "Discussion avec Claude (optionnel)", "Un copilote optionnel qui a accès à tout votre Atelier (decks, stats, combos, classeur). Il vous aide à faire vos cuts, explorer des synergies ou vérifier des règles complexes. Aucune clé d'API à configurer : il utilise directement votre abonnement Claude payant (Pro ou supérieur)."],
];
// les questions des visiteurs (joueurs experts, débutants, non-informaticiens), repliées ; une réponse en HTML commence par « < »
const FAQ_ATELIER = [
  ["Installation et sécurité", [
    ["Je ne suis pas informaticien : c'est compliqué à installer ?",
      "Non. Sous Windows, téléchargez l'installeur et lancez-le, comme n'importe quel programme : il contient tout ce qu'il faut et crée un raccourci sur le bureau. Ensuite, les mises à jour s'installent en un clic. Sous macOS et Linux, confiez l'installation à un assistant IA qui agit sur votre ordinateur, comme Claude Code : collez-lui la consigne ci-dessus."],
    ["Ça marche sur Mac et Linux ?",
      "<p>En principe oui : c'est le même programme, lancé par <code>atelier.sh</code>. Mais pour l'instant, seul Windows est testé.</p>"],
    ["Est-ce sûr ?",
      "L'Atelier ne s'ouvre que sur votre PC : il n'est pas accessible depuis le réseau. Son installeur n'est pas signé (une signature coûte plusieurs centaines d'euros par an), d'où l'avertissement de Windows au premier lancement ; mais tout son code est public : vous, ou votre assistant IA, pouvez le lire avant de l'installer."],
  ]],
  ["Claude", [
    ["Faut-il payer pour Claude ?",
      "Claude est facultatif : sans lui, tout le reste fonctionne. Pour s'en servir, il faut un abonnement Claude payant (Pro ou plus), car le compte gratuit ne donne pas accès à Claude Code."],
    ["Va-t-il épuiser mon abonnement ?",
      "Il ne travaille que quand vous lui écrivez, ou quand vous cliquez sur un bouton qui l'appelle, comme l'analyse des synergies d'un deck ou « Affiner avec Claude » : rien ne tourne en arrière-plan. Les suggestions, les combos, le bracket, les statistiques, les fonctions des cartes et le test du simulateur ne passent pas par lui. « Compacter » résume une longue discussion pour qu'elle consomme moins."],
  ]],
  ["Vos cartes et vos données", [
    ["Comment entrent mes cartes ?",
      "On colle une liste copiée depuis Moxfield, Archidekt ou MTG Arena. La liste d'un deck préconstruit se trouve sur ces sites. Les cartes rangées hors des decks se collent de la même façon dans le classeur."],
    ["Peut-on créer un deck Magic en ligne, depuis son téléphone ?",
      `<p>Oui : ouvrez <a href="${APPLI_TELEPHONE}">atelier-mtg.github.io</a> sur votre téléphone, puis ajoutez-la à l'écran d'accueil. Elle marche seule, sans PC ni compte, ou reliée à l'Atelier de votre PC par un QR code, et garde vos decks même sans réseau. La simulation, la table de jeu, les proxies et la discussion avec Claude restent sur PC.</p>
      <p>Pour montrer un deck à quelqu'un, « Partager » le publie sur une page <a href="${EXEMPLES_ATELIER}">comme celles-ci</a>, qui se lit sur téléphone et se met à jour toute seule. Il faut un compte GitHub, gratuit : c'est lui qui héberge votre page.</p>`],
    ["Et si mon PC tombe en panne ?",
      "Activez la sauvegarde en ligne, facultative : l'Atelier range une copie de vos decks, de leurs versions et de votre classeur sur votre propre compte GitHub, gratuit, dans un espace privé que vous seul voyez. Chaque modification s'y ajoute toute seule. Sur un autre PC, « Récupérer mes decks » les ramène."],
    ["Puis-je partir avec mes decks ?",
      "Oui. Chaque deck est un dossier sur votre disque, avec sa liste en texte (format Archidekt, tags compris), son historique et ses versions. Le menu « … » copie la liste pour Archidekt, Moxfield, MTG Arena ou MTGO."],
  ]],
  ["Magic", [
    ["Peut-on jouer en ligne contre d'autres joueurs ?",
      "Non, ce n'est pas un jeu vidéo. La table de jeu se joue seul, à la main, pour tester les mains de départ et les premiers tours."],
    ["Comment simuler des parties à quatre ?",
      "En simplifiant. Les trois adversaires sont des archétypes (aggro, contrôle, jetons, combo…). Selon des probabilités, ils posent des créatures, retirent vos menaces, rasent la table ou gagnent sur une combo, mais sans politique. Seul, le simulateur juge la régularité du deck : le mana, les cartes jouées, le board, le commandant. Il comprend une partie des cartes en lisant leur texte, et joue les autres sans leur effet, ou avec une partie seulement : c'est Claude qui lui apprend celles-là. Les taux de victoire ne s'affichent qu'ensuite, quand ils ont un sens."],
    ["Je débute, est-ce pour moi ?",
      `<p>Oui. Les statistiques comparent votre deck à un modèle type, et Claude peut expliquer une règle, une carte ou proposer des ajouts dans votre budget. Les mots de cette page :</p>
      <ul class="ap-lexique">
        <li><dfn>Ramp</dfn> : les cartes qui donnent du mana en plus, pour jouer plus gros plus tôt.</li>
        <li><dfn>Removal</dfn> : les cartes qui détruisent ou exilent une menace adverse.</li>
        <li><dfn>Tuteur</dfn> : une carte qui va chercher une carte précise dans votre bibliothèque.</li>
        <li><dfn>Combo</dfn> : des cartes qui, ensemble, gagnent la partie ou créent un effet infini.</li>
        <li><dfn>Cut</dfn> : les cartes à retirer pour revenir à 100.</li>
        <li><dfn>Bracket</dfn> : le niveau de puissance officiel d'un deck Commander, de 1 à 5, pour jouer à armes égales.</li>
        <li><dfn>Game Changers</dfn> : une liste officielle de cartes très puissantes, qui font monter le bracket.</li>
      </ul>`],
    ["La recherche comprend-elle la syntaxe Scryfall ?",
      "Non. Elle reprend le formulaire de Magic-Ville, où les mêmes critères se cochent : identité de couleur, texte, coût… Elle ajoute le prix et la fonction des cartes."],
    ["Les règles et les combos sont-ils à jour ?",
      "La liste des Game Changers est relue chaque jour, et les nouvelles cartes arrivent toutes seules à chaque extension. Les combos viennent de Commander Spellbook et de MTGPics, entretenues par leurs communautés. Si les règles des brackets changent, une mise à jour de l'Atelier les suit."],
    ["Les prix tiennent-ils compte de l'état, de la langue, du port ?",
      "Non : c'est le prix indicatif de Cardmarket, pour l'édition la moins chère. On n'achète pas dans l'Atelier. En revanche, l'onglet Achats copie les cartes qui vous manquent au format des listes de souhaits de Cardmarket, et c'est Cardmarket qui calcule ensuite le panier."],
  ]],
];

// espaces insécables de la typographie française : « ? » ou « » » jamais seuls en début de ligne
const insecables = (t) => t.replace(/ ([?!:;»])/g, " $1").replace(/« /g, "« ");

// installation : arriver directement à la section Installation (bouton « Installer l'Atelier MTG » d'une autre page)
function vueAPropos(installation = false) {
  scrollTo(0, 0);
  etat.deck = null;
  const depot = esc((PARTAGE && PARTAGE.atelier) || DEPOT_ATELIER);
  const capture = (f, alt) => `<img src="${PARTAGE ? CAPTURES_ATELIER : "/a-propos/"}${f}.webp" data-f="${f}" alt="${esc(alt)}"`;
  const consigne = `Installe et lance l'Atelier MTG depuis ${(PARTAGE && PARTAGE.atelier || DEPOT_ATELIER).replace("https://", "")}`;
  const fonction = (titre, texte) => `<div class="ap-carte"><h3>${titre}</h3><p>${texte}</p></div>`;
  // « appareils » : la même page sur ordinateur, et sur téléphone posé devant
  const modules = (liste) => liste.map(([f, titre, texte]) => `<section class="ap-module">
        <h3>${esc(titre)}</h3><p>${esc(texte)}</p>
        ${f === "recherche" && PARTAGE && PARTAGE.recherche ? `<p><a class="btn" href="${esc(PARTAGE.recherche)}">${ico("chercher")}Essayer la recherche</a></p>` : ""}
        ${f === "appareils" ? `<div class="ap-appareils">
          <figure class="ap-ecran-pc"><span class="ap-fenetre" aria-hidden="true"><i></i><i></i><i></i></span>${capture("appareils-pc", "Un deck dans l'Atelier, sur ordinateur")} loading="lazy"></figure>
          <figure class="ap-ecran-tel">${capture("appareils-tel", "Le même deck dans l'Atelier, sur téléphone")} loading="lazy"></figure>
        </div>` : `<figure>${capture(f, titre)} loading="lazy"></figure>`}
      </section>`).join("");
  // installation : Windows et le téléphone côte à côte (le téléphone d'abord, lu sur un téléphone) ; l'assistant IA et
  // l'installation à la main en dessous, repliés (l'assistant ouvert pour qui lit sur Mac ou Linux)
  const plateforme = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "") + " " + navigator.userAgent;
  const autreOuvert = !SUR_TELEPHONE && /Mac|Linux|X11|CrOS/i.test(plateforme) && !/Windows/i.test(plateforme);
  const installWindows = `<section class="ap-install">
          <div class="ap-install-tete"><svg class="ico ap-logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h8.4v8.4H3zM12.6 3H21v8.4h-8.4zM3 12.6h8.4V21H3zM12.6 12.6H21V21h-8.4z"/></svg><h3>Sur ordinateur</h3></div>
          <p class="ap-install-pour">Windows 10 et 11 · rien d'autre à installer</p>
          <a class="btn ${SUR_TELEPHONE ? "" : "btn-accent "}ap-install-action" href="${depot}/releases/latest/download/Atelier-MTG-Windows.exe">${ico("telecharger")}Télécharger pour Windows</a>
          <ol>
            <li>Double-cliquez sur le fichier, puis sur <b>Installer</b>. Si Windows affiche <b>Windows a protégé votre
              ordinateur</b> : <b>Informations complémentaires</b>, puis <b>Exécuter quand même</b>.</li>
            <li>L'Atelier s'ouvre dans votre navigateur. Pour le rouvrir : raccourci <b>Atelier MTG</b> sur le bureau.</li>
          </ol>
        </section>`;
  const installTel = `<section class="ap-install">
          <div class="ap-install-tete">${ico("telephone")}<h3>Sur téléphone</h3></div>
          <p class="ap-install-pour">Android et iPhone · sans store, sans compte</p>
          ${SUR_TELEPHONE ? `<a class="btn btn-accent ap-install-action" href="${APPLI_TELEPHONE}">${ico("telephone")}Ouvrir l'Atelier MTG</a>`
            : `<div class="ap-qr-ligne"><span class="ap-qr-cadre">${QR_APPLI}</span>
              <p>Scannez ce code avec votre téléphone, ou ouvrez <a href="${APPLI_TELEPHONE}">atelier-mtg.github.io</a>.</p></div>`}
          <ol>
            <li>Ajoutez l'appli à l'écran d'accueil. Android : <b>Installer l'application</b> ; iPhone : <b>Partager</b>, puis
              <b>Sur l'écran d'accueil</b>.</li>
            <li>Touchez <b>Commencer</b>. L'Atelier est déjà sur votre PC ? <b>Relier à mon PC</b>.</li>
          </ol>
        </section>`;
  vue.classList.add("vue-pleine");
  vue.innerHTML = `
    <header class="ap-tete">
      <div class="ap-tete-dedans">
        <div class="ap-scene" aria-hidden="true">
          <figure class="ap-ecran e1">${capture("discussion", "")}></figure>
          <figure class="ap-ecran e2">${capture("statistiques", "")}></figure>
          <figure class="ap-ecran e3">${capture("decks", "")}></figure>
        </div>
        <div class="ap-tete-texte">
          <h1>L'Atelier <span>MTG</span></h1>
          <p class="ap-accroche">Le deck builder Commander assisté,<br>100% local et sans compte.</p>
          <ul class="ap-puces">${["Suggestions", "Base de mana", "Combos", "Bracket", "Simulation", "Table de jeu", "Recherche avancée", "Claude"].map((x) => `<li>${x}</li>`).join("")}</ul>
          <p class="ap-cta">${SUR_TELEPHONE ? `<a class="btn btn-accent" href="${APPLI_TELEPHONE}" id="ap-appli">${ico("telephone")}Ouvrir l'Atelier MTG</a>`
            : `<a class="btn btn-accent" href="${INSTALLER}" id="ap-installer">${ico("telecharger")}Installer l'Atelier MTG</a>`}
            <a class="btn" href="${EXEMPLES_ATELIER}">${ico("partager")}Voir des decks partagés</a></p>
          <p class="ap-mention"><b>Gratuit</b> · open source · PC et téléphone${versionAtelier ? ` · version ${esc(versionAtelier)}` : ""}</p>
        </div>
      </div>
    </header>
    <article class="a-propos">
      <div class="ap-bandeau">
        <p class="ap-promesse">Zéro pub, zéro compte, zéro cloud : l'Atelier tourne <em>uniquement sur vos appareils</em>, PC ou téléphone.</p>
        <p>L'Atelier est un deck builder en français, gratuit et local, qui s'ouvre dans votre navigateur : il est pensé pour
          concevoir, tester et faire évoluer vos decks Magic: The Gathering en Commander.</p>
      </div>

      <h2>Les bases : un constructeur de deck Magic complet</h2>
      ${modules(MODULES_BASES)}

      <h2>Ce qui fait la différence</h2>
      ${modules(MODULES_ATOUTS)}

      <h2>Et aussi</h2>
      <div class="ap-grille">
        ${fonction("Import en un collage", "Une liste copiée depuis Moxfield, Archidekt ou MTG Arena devient un deck, rangé par catégories.")}
        ${fonction("Partage simplifié", `Chaque deck a sa page en ligne, tenue à jour toute seule, à envoyer à votre groupe de jeu : liste, visuel, statistiques, et une table pour le tester. <a href="${EXEMPLES_ATELIER}">Voir des exemples</a>`)}
      </div>

      <h2>Philosophie : local, ouvert et transparent</h2>
      <ul class="ap-principes">
        <li><strong>Open source et gratuit.</strong> Le code est publié sous <a href="${depot}/blob/main/LICENSE" target="_blank" rel="noopener">licence MIT</a> :
          accessible, vérifiable et modifiable par tous sur GitHub.</li>
        <li><strong>Vos decks sont stockés sur vos appareils.</strong> Rien n'est collecté. Seules sortent les
          requêtes nécessaires : données, images et prix des cartes (Scryfall), combos et bracket (Commander Spellbook, MTGPics),
          la discussion avec Claude si vous l'utilisez, la sauvegarde en ligne si vous l'activez, et les pages que vous
          choisissez de partager.</li>
        <li><strong>L'IA est optionnelle.</strong> Tri, statistiques, suggestions, test du simulateur et jeu en solo
          fonctionnent sans aucune configuration IA.</li>
      </ul>

      <h2 id="installation">Installation</h2>
      <p>Ce logiciel de construction de deck Magic s'utilise sur votre ordinateur Windows ou sur votre téléphone. Gratuit,
        sans compte.</p>
      <div class="ap-install-duo">${SUR_TELEPHONE ? installTel + installWindows : installWindows + installTel}</div>
      <p class="ap-autres-titre">Autres façons d'installer</p>
      <p class="ap-autres-texte">Sur Mac, sur Linux, ou pour tout contrôler vous-même.</p>
      <div class="ap-autres">
        <details class="ap-autre"${autreOuvert ? " open" : ""}><summary>${ico("discussion")}<span class="ap-autre-nom"><b>Avec un assistant IA</b>
          <small>Windows, macOS, Linux · il s'occupe de tout</small></span>${ico("plus")}</summary>
          <ol>
            <li>Ouvrez un assistant IA qui agit sur votre ordinateur : Claude Code, Cursor, Copilot… Sinon,
              <a href="${CLAUDE_BUREAU}" target="_blank" rel="noopener">l'application Claude pour ordinateur</a>
              (abonnement Pro ou plus), onglet <b>Code</b>.</li>
            <li>Collez-lui cette consigne :
              <div class="ap-commande"><code>${esc(consigne)}</code><button type="button" data-copier>Copier</button></div></li>
            <li>Répondez à ses trois questions : il installe tout et crée le raccourci sur le bureau.</li>
          </ol>
        </details>
        <details class="ap-autre"><summary>${ico("terminal")}<span class="ap-autre-nom"><b>À la main</b>
          <small>Windows, macOS, Linux · Python et git</small></span>${ico("plus")}</summary>
          <ol>
            <li>Installez <a href="https://www.python.org/downloads/" target="_blank" rel="noopener">Python</a> 3.10 ou plus
              récent, et <a href="https://git-scm.com/downloads" target="_blank" rel="noopener">git</a>.</li>
            <li>Dans un terminal :
              <div class="ap-commande"><code>git clone ${depot}.git "Atelier MTG"
cd "Atelier MTG"
python installer.py</code><button type="button" data-copier>Copier</button></div></li>
            <li>Pour rouvrir l'Atelier : raccourci <b>Atelier MTG</b> sur le bureau, ou <code>./atelier.sh</code> sous macOS et
              Linux.</li>
          </ol>
        </details>
      </div>
      <p class="ap-install-sous">Les nouvelles versions s'annoncent dans l'Atelier et s'installent en un clic ; vos decks sont
        conservés. Code source : <a class="ap-depot" href="${depot}" target="_blank" rel="noopener">${depot.replace("https://", "")}</a></p>

      <h2>Questions fréquentes</h2>
      ${FAQ_ATELIER.map(([groupe, questions]) => `<h3 class="ap-faq-groupe">${groupe}</h3>
        ${questions.map(([q, r]) => `<details class="ap-faq"><summary>${insecables(q)}${ico("plus")}</summary>
          <div class="ap-faq-rep">${insecables(r.startsWith("<") ? r : `<p>${r}</p>`)}</div></details>`).join("")}`).join("")}

      <h2>Genèse du projet</h2>
      <p class="ap-signature">Par ${esc(AUTEUR_ATELIER)}, créateur de l'Atelier</p>
      <figure class="ap-portrait">${capture("auteur", `${AUTEUR_ATELIER}, en partie de Magic`)}></figure>
      <p>À l'origine, mes listes tenaient sur de simples fichiers texte que j'analysais en ligne de commande avec un LLM et
        quelques ressources théoriques (ratios de mana, moteurs de pioche, conditions de victoire).</p>
      <p>Manipuler du code brut a vite montré ses limites. Pour ajuster un <em>cut</em> ou évaluer instantanément l'impact d'une
        modification, il me fallait une vraie interface graphique qui réunisse les points forts des outils de référence :</p>
      <ul class="ap-sources">
        <li><strong>Archidekt</strong> pour la table d'essai et les tests en solitaire ;</li>
        <li><strong>Magic-Ville et Commander Spellbook</strong> pour la recherche multicritère et les combos ;</li>
        <li><strong>Cardmarket</strong> pour les cotations du jour ;</li>
        <li><strong>les règles officielles</strong> pour le contrôle direct des cartes interdites, des brackets et des Game Changers.</li>
      </ul>
      <p>J'ai donc créé l'Atelier pour réunir tout ça : une vraie interface sur PC pour construire vos decks, avec la
        possibilité d'appeler l'IA en renfort si besoin.</p>
    </article>`;
  $$(".ap-tete img[data-f], .a-propos img[data-f]").forEach((img) => {
    img.onerror = () => {                       // dans l'Atelier : la capture de ce PC, sinon celle du site de l'auteur
      if (!PARTAGE && !img.dataset.enLigne) { img.dataset.enLigne = "1"; img.src = CAPTURES_ATELIER + img.dataset.f + ".webp"; }
      else img.closest("figure").remove();                           // hors ligne, ou capture introuvable : le texte suffit
    };
    if (img.closest(".ap-module")) img.onclick = () => zoomer(img);
  });
  $$("[data-copier]", vue).forEach((b) => b.onclick = async () => {
    const code = b.previousElementSibling;
    try {
      await navigator.clipboard.writeText(code.textContent);
      b.textContent = "Copié";
      setTimeout(() => { b.textContent = "Copier"; }, 1800);
    } catch (_) {                                 // presse-papiers refusé : le texte sélectionné, prêt pour Ctrl+C
      const r = document.createRange();
      r.selectNodeContents(code);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    }
  });
  // un saut, pas un défilement animé : les captures qui se chargent en chemin le feraient s'arrêter trop tôt
  const aInstallation = () => $("#installation").scrollIntoView();
  if ($("#ap-installer")) $("#ap-installer").onclick = (ev) => { ev.preventDefault(); aInstallation(); };   // même page : sans la redessiner
  if (installation) aInstallation();
}

// une capture en grand, par-dessus la page ; un clic ou Échap la referme
function zoomer(img) {
  const z = document.createElement("div");
  z.className = "ap-zoom";
  z.innerHTML = `<img src="${esc(img.src)}" alt="${esc(img.alt)}">`;
  const touche = (ev) => { if (ev.key === "Escape") fermer(); };
  const fermer = () => { z.remove(); removeEventListener("keydown", touche); };
  z.onclick = fermer;
  addEventListener("keydown", touche);
  document.body.append(z);
}

function critIdentite(d) {
  return { coul: lettresWUBRG(d.identite.join(""), "WUBRG") + "C", id: "1", format: "commander" };
}

function majInfosDeck() {
  const z = $("#rch-deck-info");
  if (!z) return;
  const d = rch.deck;
  z.innerHTML = d ? `${identiteHtml(d.identite)} ${d.total} / 100` : "";
}

function rendreFormulaire() {
  const z = $("#rch-form");
  const c = rch.crit;
  if (!rch.ouvert) {
    const r = resumeCrit(c);
    z.innerHTML = `<div class="moteur-resume panneau">
      <div class="puces">${r.length ? r.map((t) => `<span class="puce puce-crit">${esc(t)}</span>`).join("") : `<span class="muet petit">Toutes les cartes</span>`}</div>
      <div class="moteur-resume-actions">
        <button class="btn btn-petit" data-act="modifier">${ico("crayon")}Modifier la recherche</button>
        <button class="btn btn-petit btn-discret" data-act="nouvelle">${ico("effacer")}Nouvelle recherche</button>
      </div></div>`;
    $('[data-act="modifier"]', z).onclick = () => { rch.ouvert = true; rendreFormulaire(); $("#moteur [name=nom]").focus(); };
    $('[data-act="nouvelle"]', z).onclick = nouvelleRecherche;
    return;
  }
  z.innerHTML = formulaireRecherche(c);
  const form = $("#moteur", z);
  const go = $(".mt-go .rch-go", form), pied = $(".mt-pied", form);
  if (rch.voitGo) rch.voitGo.disconnect();
  if (go && window.IntersectionObserver) (rch.voitGo = new IntersectionObserver(([x]) => pied.classList.toggle("doublon", x.isIntersecting))).observe(go);
  form.addEventListener("submit", (ev) => { ev.preventDefault(); soumettre(form); });
  form.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && ev.target.name === "texte") { ev.preventDefault(); soumettre(form); }
  });
  form.addEventListener("click", (ev) => {
    const s = ev.target.closest(".rch-sym, .rch-bascule:not([data-fn])");
    if (s && s.closest('[data-groupe="coul"]'))
      return marquerCouleur(s, !s.classList.contains("actif") ? "actif" : s.classList.contains("oblig") || s.dataset.k === "C" ? "" : "oblig");
    if (s) {
      const g = s.closest("[data-groupe]");
      const v = !s.classList.contains("actif");
      if (g.dataset.unique) $$(".actif", g).forEach((b) => { b.classList.remove("actif"); b.setAttribute("aria-pressed", "false"); });
      s.classList.toggle("actif", v);
      s.setAttribute("aria-pressed", v);
      return;
    }
    const a = ev.target.closest("[data-act]");
    if (!a) return;
    if (a.dataset.act === "raz") return nouvelleRecherche();
    if (a.dataset.act === "aide-texte") return penseBeteTexte(form);
    if (a.dataset.act === "budget") { form.elements.prixmax.value = String(BUDGET); form.elements.prixmax.focus(); return; }
    if (a.dataset.act === "identite" && rch.deck) {
      const id = critIdentite(rch.deck);
      $$('.rch-symboles[data-groupe="coul"] .rch-sym', form).forEach((b) => marquerCouleur(b, id.coul.includes(b.dataset.k) ? "actif" : ""));
      form.elements.id.checked = true;
      const f = $('.rch-bascules[data-groupe="format"]', form);
      $$(".rch-bascule", f).forEach((b) => { const on = b.dataset.k === "commander"; b.classList.toggle("actif", on); b.setAttribute("aria-pressed", on); });
    }
  });
  rendreEditions();
  fenetreFonctions(form);
}

function nouvelleRecherche() {
  const c = { ...RCH_DEFAUTS, deck: rch.crit.deck || "", vue: rch.crit.vue || "", ordre: rch.crit.ordre, sens: rch.crit.sens || "" };
  if (rch.deck && rch.deck.identite) Object.assign(c, critIdentite(rch.deck));
  rch.crit = c;
  rch.eds = new Set();
  rch.fns = [];
  rch.ouvert = true;
  rch.res = null;
  history.replaceState(null, "", "#/recherche?" + critVersHash(c));
  rendreFormulaire();
  $("#rch-resultats").innerHTML = "";
  $("#moteur [name=nom]").focus();
}

function soumettre(form) {
  const c = { ...lireFormulaire(form), deck: rch.crit.deck || "", ordre: rch.crit.ordre, sens: rch.crit.sens || "", vue: rch.crit.vue || "", r: "1" };
  if (!rch.deck) delete c.horsdeck;
  location.hash = "#/recherche?" + critVersHash(c);
}

// ---- fenêtre Fonctions : les étiquettes de Scryfall Tagger (fonctions traduites d'abord, puis toutes les autres)
function nomFn(k, court = false) {
  const nom = (rch.fnNoms && rch.fnNoms[k]) || ((rch.fonctions || []).find((f) => f.cle === k) || {}).nom || k.replace(/-/g, " ");
  return court ? nom.split(" (")[0] : nom;
}

function fenetreFonctions(form) {
  const champ = $("#fn-q", form), liste = $("#fn-liste", form);
  if (!champ) return;
  rch.fnNoms = rch.fnNoms || {};
  let items = [], actif = -1, numero = 0, minuteur;
  const rendreChoix = () => {
    $("#fn-choisies", form).innerHTML = rch.fns.map((k) => `<span class="puce puce-1"><span class="puce-nom">${esc(nomFn(k, true))}</span>
      <button type="button" data-fn-ote="${esc(k)}" aria-label="Retirer ${esc(nomFn(k, true))}">✕</button></span>`).join("");
    $$("[data-fn]", form).forEach((b) => { const on = rch.fns.includes(b.dataset.fn); b.classList.toggle("actif", on); b.setAttribute("aria-pressed", on); });
  };
  const fermer = () => { liste.hidden = true; champ.setAttribute("aria-expanded", "false"); actif = -1; };
  const marque = () => $$(".fn-item", liste).forEach((el, i) => el.classList.toggle("choisi", i === actif));
  const ajoute = (it) => {
    rch.fnNoms[it.cle] = it.nom;
    if (!rch.fns.includes(it.cle)) rch.fns.push(it.cle);
    champ.value = "";
    fermer();
    rendreChoix();
  };
  const chercher = async () => {
    const k = ++numero;
    let r;
    try { r = await api("/api/recherche/tags?q=" + enc(champ.value)); } catch (_) { return; }
    if (k !== numero || document.activeElement !== champ) return;
    items = r.filter((it) => !rch.fns.includes(it.cle));
    actif = items.length ? 0 : -1;
    liste.innerHTML = items.length ? items.map((it, i) => `<button type="button" class="fn-item ${i === actif ? "choisi" : ""}" data-i="${i}" role="option">
        <span class="fn-nom">${esc(it.nom)}${it.fr ? "" : ` <span class="muet">(${esc(it.cle)})</span>`}</span>
        <span class="fn-nb">${sepMilliers(it.nb)} carte${it.nb > 1 ? "s" : ""}</span>
        ${it.desc ? `<span class="fn-desc">${esc(it.desc)}</span>` : ""}</button>`).join("")
      : `<div class="fn-vide muet petit">Aucune fonction.</div>`;
    liste.hidden = false;
    champ.setAttribute("aria-expanded", "true");
  };
  champ.addEventListener("focus", chercher);
  champ.addEventListener("input", () => { clearTimeout(minuteur); minuteur = setTimeout(chercher, 150); });
  champ.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (items.length) { actif = (actif + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; marque(); $$(".fn-item", liste)[actif]?.scrollIntoView({ block: "nearest" }); }
    } else if (ev.key === "Enter" && !liste.hidden && items[actif]) {
      ev.preventDefault();
      ajoute(items[actif]);
    } else if (ev.key === "Escape") fermer();
  });
  liste.addEventListener("mousedown", (ev) => ev.preventDefault());          // le champ garde le focus
  liste.addEventListener("click", (ev) => { const b = ev.target.closest(".fn-item"); if (b) ajoute(items[+b.dataset.i]); });
  champ.addEventListener("blur", () => setTimeout(fermer, 100));
  form.addEventListener("click", (ev) => {
    const o = ev.target.closest("[data-fn-ote]");
    if (o) { rch.fns = rch.fns.filter((k) => k !== o.dataset.fnOte); return rendreChoix(); }
    const b = ev.target.closest("[data-fn]");
    if (b) {
      const k = b.dataset.fn;
      rch.fns = rch.fns.includes(k) ? rch.fns.filter((x) => x !== k) : [...rch.fns, k];
      rendreChoix();
    }
  });
  rendreChoix();
}

// ---- fenêtre Éditions : une recherche plutôt que 400 cases à cocher
async function rendreEditions() {
  const z = $("#eds-groupes");
  if (!z) return;
  if (!rch.editions) {
    try { rch.editions = await api("/api/recherche/editions"); }
    catch (e) { z.innerHTML = `<p class="erreur petit">${esc(e.message)}</p>`; return; }
  }
  const tous = new Map(rch.editions.flatMap((g) => g.editions.map((e) => [e.code, e])));
  const choisies = () => {
    $("#eds-choisies").innerHTML = [...rch.eds].map((code) => {
      const e = tous.get(code) || { nom: code.toUpperCase(), code };
      return `<span class="puce puce-1"><span class="puce-nom">${esc(e.nom)} <span class="muet">${esc(code.toUpperCase())}</span></span><button type="button" data-ote="${esc(code)}" aria-label="Retirer ${esc(e.nom)}">✕</button></span>`;
    }).join("");
  };
  const icone = (e) => `<span class="ed-icone" ${e.icone ? `style="--ic:url('${esc(e.icone)}')"` : ""} aria-hidden="true"></span>`;
  const ligne = (e) => `<label class="ed" title="${esc(e.en)} · ${esc(e.code.toUpperCase())} · ${esc(e.date)}">
      <input type="checkbox" value="${esc(e.code)}" ${rch.eds.has(e.code) ? "checked" : ""}>${icone(e)}<span class="ed-nom">${esc(e.nom)}</span><span class="ed-an">${esc((e.date || "").slice(0, 4))}</span></label>`;
  const rendre = () => {
    const q = sansAccent($("#eds-filtre").value.trim());
    const ok = (e) => !q || sansAccent(`${e.nom} ${e.en} ${e.code}`).includes(q);
    z.innerHTML = rch.editions.map((g, i) => {
      const liste = g.editions.filter(ok);
      if (!liste.length) return "";
      const n = g.editions.filter((e) => rch.eds.has(e.code)).length;
      return `<details class="eds-groupe" ${q || (i === 0 && !rch.eds.size) || n ? "open" : ""}>
        <summary>${esc(g.groupe)} <span class="muet petit">${liste.length}${n ? ` · ${n} choisie${n > 1 ? "s" : ""}` : ""}</span></summary>
        <div class="eds-liste">${liste.slice(0, q ? 400 : 1000).map(ligne).join("")}</div></details>`;
    }).join("") || `<p class="muet petit">Aucune édition ne correspond.</p>`;
  };
  choisies();
  rendre();
  $("#eds-filtre").oninput = rendre;
  z.onchange = (ev) => {
    const x = ev.target.closest('input[type="checkbox"]');
    if (!x) return;
    if (x.checked) rch.eds.add(x.value); else rch.eds.delete(x.value);
    choisies();
  };
  $("#eds-choisies").onclick = (ev) => {
    const b = ev.target.closest("[data-ote]");
    if (!b) return;
    rch.eds.delete(b.dataset.ote);
    choisies();
    rendre();
  };
}

// ---- résultats
async function lancerRecherche() {
  const z = $("#rch-resultats");
  const k = ++rch.numero;
  const c = rch.crit;
  z.innerHTML = `<p class="chargement">Recherche…</p>`;
  let r;
  const tout = new URLSearchParams(Object.entries(c).filter(([key, v]) => v != null && !key.startsWith("_")));     // valeurs par défaut comprises
  tout.set("par", parPage());                            // cartes par page : réglage du navigateur, pas dans l'adresse
  try { r = await api("/api/recherche?" + tout); }
  catch (e) {
    if (k !== rch.numero) return;
    if (/pas encore prête/.test(e.message)) return attendreBase(z);
    z.innerHTML = `<p class="erreur">${esc(e.message)}</p>`;
    return;
  }
  if (k !== rch.numero) return;
  rch.res = r;
  rendreResultats(z, r);
}


async function attendreBase(z) {
  const k = rch.numero;
  for (;;) {
    let b;
    try { b = await api("/api/recherche/base"); } catch (_) { b = null; }
    if (k !== rch.numero || !$("#rch-resultats")) return;
    if (b && b.prete) return lancerRecherche();
    const e = (b && b.construction) || {};
    const pc = e.total ? Math.round((100 * e.fait) / e.total) : 0;
    z.innerHTML = `<div class="panneau">
      <h3>La base de cartes ${TELEPHONE || PARTAGE ? "arrive" : "se construit"}</h3>
      <p>${esc(e.etape || (e.erreur ? "Arrêtée" : "En attente…"))}${e.total ? ` · ${pc} %` : ""}</p>
      ${e.total ? `<div class="barre-prog"><div style="width:${pc}%"></div></div>` : ""}
      ${e.erreur ? `<p class="erreur petit">${esc(e.erreur)}</p><button class="btn" id="rch-relancer">Relancer</button>` : ""}
    </div>`;
    const bt = $("#rch-relancer", z);
    if (bt) bt.onclick = () => api("/api/recherche/base", { method: "POST", body: {} }).catch(erreur);
    await attendre(3000);
  }
}

function lienPage(n) { return "#/recherche?" + critVersHash({ ...rch.crit, page: n > 1 ? String(n) : "" }); }

function paginationRch(r) {
  if (r.pages <= 1) return "";
  return `<div class="rch-pages">
    <button type="button" class="btn btn-petit" data-page="${r.page - 1}" ${r.page <= 1 ? "disabled" : ""} aria-label="Page précédente">‹</button>
    <label class="petit">Page <input class="champ champ-petit rch-page" type="number" min="1" max="${r.pages}" value="${r.page}" aria-label="Numéro de page"> / ${r.pages}</label>
    <button type="button" class="btn btn-petit" data-page="${r.page + 1}" ${r.page >= r.pages ? "disabled" : ""} aria-label="Page suivante">›</button>
  </div>`;
}

function rendreResultats(z, r) {
  const c = rch.crit;
  const vueImages = c.vue === "images";
  const sens = c.sens || (RCH_TRI_DESC[c.ordre] ? "desc" : "asc");
  z.innerHTML = `
    <div class="rch-entete">
      <div class="rch-compte"><strong>${sepMilliers(r.total)} carte${r.total > 1 ? "s" : ""} trouvée${r.total > 1 ? "s" : ""}</strong></div>
      ${paginationRch(r)}
      <div class="rch-outils">
        <div class="segments" role="group" aria-label="Affichage">${[["liste", "Liste"], ["images", "Images"]].map(([k, l]) =>
          `<button type="button" data-vue="${k}" class="${(k === "images") === vueImages ? "actif" : ""}" aria-pressed="${(k === "images") === vueImages}">${l}</button>`).join("")}</div>
        <label class="petit muet">Trier par <select class="champ champ-petit" id="rch-tri">${[...RCH_TRIS, ...(rch.deck ? RCH_TRI_DECK : [])].map(([k, l]) => `<option value="${k}" ${c.ordre === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <button class="btn btn-petit" id="rch-sens" title="Inverser l'ordre">${sens === "desc" ? "↓" : "↑"}</button>
      </div>
    </div>
    ${r.total ? `<div class="rch-liste ${vueImages ? "etale" : "avec-images"}">${vueImages ? "" : enteteRch(c, sens)}${r.cartes.map((x, i) => (vueImages ? carteImageRch(x, i) : ligneRch(x, i))).join("")}</div>`
      : `<div class="panneau vide"><p>Aucune carte.</p></div>`}
    ${basDeListe(r, r.lignes)}
    <p class="muet petit rch-base">${baseTexte(r.base)}</p>`;
  if (r.base) {                                          // base refaite depuis : la liste des éditions peut avoir changé
    if (rch.dateBase && r.base.date !== rch.dateBase) rch.editions = null;
    rch.dateBase = r.base.date;
  }
  const pied = $(".rch-base", z);
  pied.addEventListener("click", (ev) => { if (ev.target.closest('[data-act="maj-base"]')) majBase(pied, true); });
  if (r.base && r.base.construction && r.base.construction.actif) majBase(pied, false);
  $$("[data-vue]", z).forEach((b) => b.addEventListener("click", () => {
    rch.crit.vue = b.dataset.vue === "images" ? "images" : "";
    history.replaceState(null, "", "#/recherche?" + critVersHash(rch.crit));
    rendreResultats(z, r);
  }));
  $("#rch-tri", z).onchange = (ev) => { location.hash = "#/recherche?" + critVersHash({ ...rch.crit, ordre: ev.target.value, sens: "", page: "" }); };
  const inverser = () => {
    const def = RCH_TRI_DESC[rch.crit.ordre] ? "desc" : "asc";
    const nouveau = sens === "desc" ? "asc" : "desc";
    location.hash = "#/recherche?" + critVersHash({ ...rch.crit, sens: nouveau === def ? "" : nouveau, page: "" });
  };
  $("#rch-sens", z).onclick = inverser;
  $$(".rch-col", z).forEach((b) => b.addEventListener("click", () => {          // en-têtes de la liste : trier, ou inverser
    if (b.classList.contains("actif")) return inverser();
    location.hash = "#/recherche?" + critVersHash({ ...rch.crit, ordre: b.dataset.tri, sens: "", page: "" });
  }));
  $$("[data-par-page]", z).forEach((s) => s.addEventListener("change", () => {      // la 1re page, avec le nouveau nombre
    PREF.set("par-page", s.value);
    rch.crit.page = "";
    history.replaceState(null, "", "#/recherche?" + critVersHash(rch.crit));
    lancerRecherche();
  }));
  $$(".rch-page", z).forEach((p) => p.addEventListener("change", () => {
    const n = Math.max(1, Math.min(r.pages, Math.round(+p.value) || 1));
    location.hash = lienPage(n);
  }));
  $$("[data-page]", z).forEach((b) => b.addEventListener("click", () => { location.hash = lienPage(+b.dataset.page); }));
  const liste = $(".rch-liste", z);
  if (liste) liste.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-act]");
    if (!a || a.tagName === "A") return;
    const i = +a.closest("[data-i]").dataset.i;
    const x = rch.res.cartes[i];
    if (a.dataset.act === "ouvrir") return ficheRecherche(i);
    if (a.dataset.act === "ajouter" || a.dataset.act === "maybe") return ajouterRecherche(x, { maybe: a.dataset.act === "maybe" });
  });
}

// le pied de page : date de la base, dernière vérification auprès de Scryfall, mise à jour à la demande
const heureCourte = (t) => new Date(t * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function baseTexte(b) {
  if (!b || !b.prete) return "";
  const e = b.construction || {};
  if (e.actif) {
    const pc = e.total ? ` · ${Math.round((100 * e.fait) / e.total)} %` : "";
    return `<span class="pulse">Mise à jour de la base : ${esc(e.etape || "en cours")}${pc}</span>`;
  }
  return `Base du ${heureCourte(b.date)}${PARTAGE ? "" : ` · <button type="button" class="lien-discret" data-act="maj-base">Mettre à jour</button>`}
    ${e.erreur ? `<br><span class="erreur-texte">Dernière mise à jour incomplète : ${esc(e.erreur)}</span>` : ""}`;
}

async function majBase(zone, lancer) {
  if (lancer) {
    try { await api("/api/recherche/base", { method: "POST", body: {} }); } catch (e) { return erreur(e); }
  }
  for (;;) {
    await attendre(2500);
    let b;
    try { b = await api("/api/recherche/base"); } catch (_) { continue; }
    if (!zone.isConnected) return;
    zone.innerHTML = baseTexte(b);
    if (!b.construction.actif) {
      rch.editions = null;
      toast(b.construction.erreur ? "Mise à jour incomplète : " + b.construction.erreur : "Base à jour.", 4000);
      if (rch.crit && rch.crit.r === "1") lancerRecherche();
      return;
    }
  }
}

const prixRch = (x) => (x.prix == null ? "—" : euros(x.prix) + (x.foil ? " (foil)" : ""));
const lienCardmarket = (nom) => `https://www.cardmarket.com/fr/Magic/Products/Search?searchString=${enc(ic_cle(nom))}`;
const ic_cle = (nom) => nom.split(" // ")[0];
const horsCouleurs = (x, d = rch.deck) => !!(d && d.identite && x.couleurs.some((k) => !d.identite.includes(k)));

function etatDeckRch(x) {
  if (!rch.deck) return "";
  if (x.dans === "deck" || x.dans === "commandant") return `<span class="badge badge-ok">✓ ${x.dans === "commandant" ? "commandant" : "dans le deck"}</span>`;
  return `${x.dans === "maybe" ? `<span class="badge">Maybeboard</span>` : ""}
    <button type="button" class="btn btn-petit" data-act="ajouter" title="Ajouter à ${esc(rch.deck.titre)}">${ico("plus")}Deck</button>
    ${x.dans === "maybe" ? "" : `<button type="button" class="btn btn-petit btn-discret" data-act="maybe" title="Ajouter au Maybeboard de ${esc(rch.deck.titre)}">${ico("maybe")}Maybe</button>`}`;
}

function badgesRch(x, d = rch.deck) {
  return [
    x.gc ? `<span class="badge badge-gc" title="Game Changer : compte dans le bracket">Game Changer</span>` : "",
    x.legal ? "" : `<span class="badge badge-alerte" title="Pas légale en Commander">non légale</span>`,
    horsCouleurs(x, d) ? `<span class="badge badge-alerte" title="Hors de l'identité de couleur de ${esc(d.titre)}">hors couleurs</span>` : "",
  ].join("");
}

function texteCarteRch(x) {
  const fr = rch.crit.fr !== "" && x.texte_fr;
  const t = fr ? x.texte_fr : x.texte;
  return (t || "").split("\n").map((l) => l.trim() === "//" ? "<hr>" : l.trim() ? `<p>${texteMana(l)}</p>` : "").join("");
}

// liste façon Magic-Ville : sous les en-têtes Coul. · Nom VO · Nom VF · Type · Coût (un clic trie, un second inverse) et
// Prix (à la place des éditions) ; sous les noms, le type complet, le texte, puis force/endurance ou loyauté à droite
const COLONNES_RCH = [["couleur", "Coul."], ["nom", "Nom VO"], ["nomfr", "Nom VF"], ["type", "Type"], ["cout", "Coût"], ["prix", "Prix"]];
const TYPE_COURT = { "Créatures": "Créature", "Planeswalkers": "Planeswalker", "Batailles": "Bataille", "Éphémères": "Éphémère",
  "Rituels": "Rituel", "Artefacts": "Artefact", "Enchantements": "Enchantement", "Terrains": "Terrain" };

function enteteRch(c, sens) {
  return `<div class="rch-cols">${COLONNES_RCH.map(([k, l]) => {
    const actif = (c.ordre || "couleur") === k;
    return `<button type="button" class="rch-col ${actif ? "actif" : ""}" data-tri="${k}" aria-pressed="${actif}">${l}${actif ? `<span aria-label="${sens === "desc" ? "décroissant" : "croissant"}">${sens === "desc" ? "↓" : "↑"}</span>` : ""}</button>`;
  }).join("")}</div>`;
}

function ligneRch(x, i) {
  const cher = (x.prix || 0) > BUDGET;
  const typeAff = rch.crit.fr !== "" && x.type_fr ? x.type_fr : x.type;
  const apercu = `data-image="${esc(x.image)}" data-legende="${esc(`${x.fr || x.nom} — ${prixRch(x)}`)}" ${cher ? 'data-cher="1"' : ""}`;
  const badges = badgesRch(x);
  return `<article class="rch-carte" data-i="${i}">
    <button type="button" class="rch-vignette" data-act="ouvrir" ${apercu} aria-label="Fiche de ${esc(x.nom)}">
      ${x.petite ? `<img src="${esc(x.petite)}" alt="" loading="lazy">` : `<span class="sans-image">${esc(x.nom)}</span>`}</button>
    <div class="rch-vo"><button type="button" class="rch-nom" data-act="ouvrir" ${apercu}>${esc(x.nom)}</button></div>
    <div class="rch-vf">${x.fr && x.fr !== x.nom ? `<button type="button" class="rch-nom" data-act="ouvrir" ${apercu}>${esc(x.fr)}</button>` : ""}</div>
    <div class="rch-typecourt">${esc(TYPE_COURT[typeCarte(x.type)] || "")}</div>
    <div class="rch-cm">${mana(x.cout)}</div>
    <div class="rch-prix">
      <a class="prix ${cher ? "cher" : ""}" href="${esc(lienCardmarket(x.nom))}" target="_blank" rel="noopener" title="Cardmarket">${prixRch(x)}</a>
      ${badges ? `<span class="rch-badges">${badges}</span>` : ""}
      ${rch.deck ? `<span class="rch-actions">${etatDeckRch(x)}</span>` : ""}
    </div>
    <div class="rch-detail">
      <div class="rch-type">${esc(typeAff)}</div>
      ${x.texte || x.texte_fr ? `<div class="rch-texte fs-texte">${texteCarteRch(x)}</div>` : ""}
      ${x.pt ? `<div class="rch-pt">${esc(x.pt.replace(/loyauté (\S+)/g, "Loy. $1"))}</div>` : ""}
    </div>
  </article>`;
}

function carteImageRch(x, i) {
  const cher = (x.prix || 0) > BUDGET;
  const marques = [
    x.gc ? `<span class="marque marque-gc" title="Game Changer">GC</span>` : "",
    horsCouleurs(x) ? `<span class="marque marque-alerte">hors couleurs</span>` : "",
    x.dans === "deck" || x.dans === "commandant" ? `<span class="marque marque-ok">✓ deck</span>` : x.dans === "maybe" ? `<span class="marque marque-maybe">maybe</span>` : "",
  ].join("");
  return `<div class="carte-v rch-carte-v" data-i="${i}">
    <button type="button" class="pile" data-act="ouvrir" data-survol-r="${i}" aria-label="${esc(x.nom)} : fiche">${imageCarte({ petite: x.petite, image: x.image, nom: x.nom }, "recto")}${marques ? `<span class="marques">${marques}</span>` : ""}</button>
    <div class="legende-v"><span class="nom-v" title="${esc(x.nom + (x.fr && x.fr !== x.nom ? " — " + x.fr : ""))}">${esc(x.fr || x.nom)}</span><span class="prix-v ${cher ? "cher" : ""}">${prixRch(x)}</span></div>
    ${rch.deck && !(x.dans === "deck" || x.dans === "commandant") ? `<div class="rch-actions-v">${etatDeckRch(x)}</div>` : ""}
  </div>`;
}

// la fiche au survol (vue Images) : même présentation que dans un deck
function survolRecherche(x) {
  return { nom: x.nom, alertes: horsCouleurs(x) ? ["hors couleurs"] : [],
    info: { fr: x.fr, cout: x.cout, type: x.type, fr_type: x.type_fr, pt: x.pt, texte: x.texte, fr_texte: x.texte_fr, prix: x.prix, gc: x.gc,
      prix_edition: x.edition ? x.edition.nom : "" } };
}

// ---- ajouter au deck lié
async function ajouterRecherche(x, { maybe = false, tags = [], n = 1, edition = null, deck = rch.deck } = {}) {
  const d = deck;
  if (!d) { toast("Choisis un deck."); $("#rch-deck")?.focus(); return null; }
  try {
    let res;
    if (!maybe && x.dans === "maybe") {                    // déjà au Maybeboard : la carte passe dans le deck
      const plein = await api("/api/decks/" + enc(d.id));
      const c = plein.cartes.find((y) => y.cat === "Maybeboard" && ic_cle(y.nom).toLowerCase() === ic_cle(x.nom).toLowerCase());
      res = c ? await api(`/api/decks/${enc(d.id)}/modifier`, { method: "POST", body: { op: "maybeboard", index: c.index, nom_actuel: c.nom } }) : null;
    }
    if (!res) {
      res = await api(`/api/decks/${enc(d.id)}/modifier`, { method: "POST", body: { op: "ajouter", nom: x.nom, tags: maybe ? ["Maybeboard", ...tags] : tags, n, edition } });
    }
    if (!maybe || x.dans !== "deck") x.dans = maybe ? (x.dans || "maybe") : "deck";
    etat.decks = [];
    if (rch.deck && rch.deck.id === d.id) {                 // la page Recherche : compteur du deck et ligne du résultat
      Object.assign(rch.deck, { total: res.total, maybe: res.maybe, modifie: res.modifie });
      majInfosDeck();
      remplacerResultat(x);
    }
    majDeckOuvert(res);
    toast(`✓ ${x.fr || x.nom} → ${maybe ? "Maybeboard" : d.titre}`);
    return res;
  } catch (e) { erreur(e); return null; }
}

function remplacerResultat(x) {
  if (!rch.res) return;
  const i = rch.res.cartes.findIndex((y) => y === x || y.nom === x.nom);
  const el = $(`#rch-resultats [data-i="${i}"]`);
  if (i < 0 || !el) return;
  rch.res.cartes[i].dans = x.dans;
  const t = document.createElement("div");
  t.innerHTML = rch.crit.vue === "images" ? carteImageRch(rch.res.cartes[i], i) : ligneRch(rch.res.cartes[i], i);
  el.replaceWith(t.firstElementChild);
}

// le deck affiché sous la fiche : on le redessine avec la carte ajoutée (liste et statistiques)
function majDeckOuvert(res) {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  if (parts[0] !== "deck" || decodeURIComponent(parts[1] || "") !== res.id) return;
  const onglet = parts[2] || "liste";
  if (onglet === "liste" || onglet === "stats") {
    const y = scrollY;
    vueDeck(res.id, onglet, null, res).then(() => scrollTo(0, y));
  } else etat.deck = res;
}

// une carte peut-elle être en plusieurs exemplaires dans un deck Commander ? (terrains de base, Relentless Rats…)
const PLUSIEURS_COPIES = /deck can have (?:any number|up to \w+) of cards named/i;
const plusieursExemplaires = (x) => /\bBasic\b/.test(x.type || "") || PLUSIEURS_COPIES.test(x.texte || "");
const lienGatherer = (nom) => `https://gatherer.wizards.com/search?searchTerm=${enc(ic_cle(nom))}`;

// le bloc « Ajouter à … » de la fiche : où (deck ou Maybeboard), tags, et un seul bouton
// le bas de la fiche d'une carte : ce qu'on peut en faire
function piedFiche(actions) {
  return actions.trim() && !PARTAGE ? `<div class="modale-pied fc-pied"><div class="fc-actions ecrit" role="group" aria-label="Actions sur la carte">${actions}</div></div>` : "";
}
// sur les côtés de l'image : les flèches vers la carte précédente et la suivante (au doigt, on peut aussi glisser)
function flechesFiche(pos, n) {
  if (pos < 0 || n < 2) return "";
  const fleche = (sens, cache) => `<button type="button" class="fc-fleche fc-${sens}" data-act="${sens}" ${cache ? "hidden" : ""}
      aria-label="${sens === "prec" ? "Carte précédente" : "Carte suivante"}" title="${pos + 1} / ${n}">${ico(sens === "prec" ? "precedent" : "suivant")}</button>`;
  return fleche("prec", pos === 0) + fleche("suiv", pos === n - 1);
}

function blocAjoutRch(x, d) {
  const dans = x.dans === "deck" || x.dans === "commandant";
  const multi = plusieursExemplaires(x);
  if (dans && !multi) {
    const ici = etat.deck && etat.deck.id === d.id && location.hash.startsWith("#/deck/");
    return `<div class="rf-ajout rf-deja"><span class="ok">✓ ${x.dans === "commandant" ? "Commandant de" : "Déjà dans"} ${esc(d.titre)}</span>
      ${ici ? `<button type="button" class="lien-discret" data-act="fiche-deck">Voir dans le deck</button>` : `<a href="#/deck/${enc(d.id)}">Ouvrir le deck</a>`}</div>`;
  }
  const promotion = x.dans === "maybe";
  const dest = promotion ? "deck" : PREF.get("rf-dest", "deck");
  return `<div class="rf-ajout">
    ${promotion ? `<span class="rf-promo">Au Maybeboard de <strong>${esc(d.titre)}</strong></span>` : `
      <input class="champ" id="rf-tags" list="rf-cats" placeholder="Tags" aria-label="Tags, séparés par des virgules">
      <datalist id="rf-cats">${(d.categories || []).map((t) => `<option value="${esc(t)}">`).join("")}</datalist>`}
    ${multi && !promotion ? `<label class="petit muet rf-n">Exemplaires <input class="champ" type="number" id="rf-n" min="1" max="99" value="1"></label>` : ""}
    ${promotion ? "" : `<div class="segments rf-dest" role="group" aria-label="Où ajouter la carte">${[["deck", d.titre], ["maybe", "Maybeboard"]].map(([k, l]) =>
      `<button type="button" data-dest="${k}" class="${k === dest ? "actif" : ""}" aria-pressed="${k === dest}"><span class="seg-lib">${esc(l)}</span></button>`).join("")}</div>`}
    <button class="btn btn-accent" data-act="ajouter">${libelleAjout(x, dest)}</button>
  </div>`;
}

function libelleAjout(x, dest) {
  if (x.dans === "maybe") return ico("annuler") + "Passer dans le deck";
  return ico("plus") + (x.dans === "deck" && dest !== "maybe" ? "Ajouter un exemplaire" : "Ajouter");
}

// ---- fiche d'une carte trouvée : grande image, textes, prix du jour, versions, ajout au deck
function ficheRecherche(i, ctx = null) {
  const liste = ctx ? ctx.liste : rch.res.cartes;
  const x = liste[i];
  if (!x) return;
  const d = ctx ? ctx.deck : rch.deck;
  const v = x.versionChoisie || null;
  const image = (v && v.image) || x.image;
  const cher = (x.prix || 0) > BUDGET;
  const texte = (t) => (t || "").split("\n").map((l) => l.trim() === "//" ? "<hr>" : l.trim() ? `<p>${texteMana(l)}</p>` : "").join("");
  ouvrirModale(`
    <div class="fiche-carte">
      <div class="fc-image">${image ? `<img src="${esc(image)}" alt="${esc(x.nom)}" data-recto="${esc(image)}" data-verso="${esc(v ? "" : x.image_dos || "")}">` : `<div class="sans-image">${esc(x.nom)}</div>`}
        ${v ? "" : boutonVerso(x.image_dos ? { image: x.image_dos, nom: "", type: "" } : null)}
        <div class="fc-version">
          ${v ? `<span class="petit muet">${esc(v.edition)}${v.annee ? " · " + esc(v.annee) : ""}${v.lang === "fr" ? " · en français" : ""}</span>` : x.edition ? `<span class="petit muet">${esc(x.edition.nom)} · ${esc(x.edition.annee)}</span>` : ""}
          <button type="button" class="lien-discret ecrit" data-act="version">${x.versions > 1 ? `${x.versions} versions` : "Changer la version"}</button>
        </div>${flechesFiche(i, liste.length)}</div>
      <div class="fc-infos">
        <div class="fc-tete">
          <div><h2>${esc(x.fr || x.nom)} ${mana(x.cout)}</h2>${x.fr && x.fr !== x.nom ? `<div class="muet">${esc(x.nom)}</div>` : ""}</div>
        </div>
        <div class="petit muet">${esc(x.type_fr || x.type)}${x.pt ? " · " + esc(x.pt) : ""}</div>
        <div class="chiffres" id="rf-prix">
          <span class="badge ${cher ? "badge-cher" : ""}" id="rf-prix-badge" title="Le moins cher, toutes éditions (prix Cardmarket du jour)">${prixRch(x)}</span>
          ${badgesRch(x, d)}
        </div>
        <div class="ou-est petit" hidden></div>
        <div id="rf-assemble"></div>
        ${x.texte_fr || x.texte ? `<div class="texte fs-texte">${texte(x.texte_fr || x.texte)}</div>` : ""}
        ${x.texte_fr && x.texte ? `<details class="petit"><summary>Texte anglais</summary><div class="fs-texte" style="margin-top:.4rem">${texte(x.texte)}</div></details>` : ""}
        <div class="fc-liens">
          ${d && !PARTAGE ? `<a href="#/deck/${enc(d.id)}/combos/${enc(x.nom)}">${ico("combos")}Combos avec cette carte</a>` : ""}
          <a href="${esc(lienCardmarket(x.nom))}" id="rf-cardmarket" target="_blank" rel="noopener">${ico("panier")}Cardmarket ↗</a>
          <a href="${esc(lienGatherer(x.nom))}" id="rf-gatherer" target="_blank" rel="noopener">${ico("livre")}Gatherer ↗</a>
        </div>
      </div>
    </div>
    ${BASE_WEB ? `<div class="modale-pied fc-pied"><a class="btn btn-accent" href="${INSTALLER}">${ico("plus")}Créer un deck</a></div>`
      : piedFiche(d && !PARTAGE ? blocAjoutRch(x, d) : "")}`, (b) => {
    let dest = x.dans === "maybe" ? "deck" : PREF.get("rf-dest", "deck");
    ouEst($(".ou-est", b), x.nom, d && d.id);
    b.addEventListener("click", async (ev) => {
      const s = ev.target.closest("[data-dest]");
      if (s) {
        dest = s.dataset.dest;
        PREF.set("rf-dest", dest);
        $$("[data-dest]", b).forEach((y) => { y.classList.toggle("actif", y === s); y.setAttribute("aria-pressed", y === s); });
        $('[data-act="ajouter"]', b).innerHTML = libelleAjout(x, dest);
        return;
      }
      const a = ev.target.closest("[data-act]");
      if (!a || a.disabled || a.tagName === "A") return;
      const act = a.dataset.act;
      if (act === "fermer") return fermerModale();
      if (act === "prec" || act === "suiv") return ficheRecherche(i + (act === "suiv" ? 1 : -1), ctx);
      if (act === "version") return versionsRecherche(i, ctx);
      if (act === "fiche-deck") return ouvrirCarte(etat.deck.cartes.find((c) => ic_cle(c.nom).toLowerCase() === ic_cle(x.nom).toLowerCase()));
      if (act === "ajouter") {
        const champ = $("#rf-tags", b);
        const tags = champ ? champ.value.split(",").map((t) => t.trim()).filter(Boolean) : [];
        a.disabled = true;
        const res = await ajouterRecherche(x, { maybe: dest === "maybe" && x.dans !== "maybe", tags, n: Math.max(1, +($("#rf-n", b) || {}).value || 1),
          edition: x.versionChoisie ? editionVersion(x.versionChoisie) : null, deck: d });
        if (res) { ficheRecherche(i, ctx); if (ctx && ctx.apres) ctx.apres(res); } else a.disabled = false;      // apres : la liste d'où vient la fiche
      }
    });
    $("#rf-tags", b)?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $('[data-act="ajouter"]', b).click(); } });
  }, { focus: false, large: true });
  // prix du jour (le plus bas, avec son édition) et lien Gatherer de la carte
  api("/api/carte?nom=" + enc(x.nom)).then((f) => {
    if (!$("#modale .fiche-carte") || liste[i] !== x) return;
    if (f.gatherer) $("#rf-gatherer").href = f.gatherer;
    if (f.assemble) $("#rf-assemble").innerHTML = assembleHtml(f.assemble);
    if (f.prix_lien) $("#rf-cardmarket").href = f.prix_lien;
    if (f.prix == null) return;
    x.prix = f.prix;
    const el = $("#rf-prix-badge");
    el.textContent = `${euros(f.prix)}${f.prix_edition ? " · " + f.prix_edition : ""}`;
    el.classList.toggle("badge-cher", f.prix > BUDGET);
  }).catch(() => {});
}

// « N versions » : la grille des impressions ; la version choisie sert à l'ajout (visuel de la carte dans le deck)
function versionsRecherche(i, ctx = null) {
  const x = (ctx ? ctx.liste : rch.res.cartes)[i];
  ouvrirModale(`<div id="choix-v"></div>`, (b) => {
    choixVersion($("#choix-v", b), {
      nom: x.nom, titre: x.fr || x.nom, actuelle: x.versionChoisie || null, retour: () => ficheRecherche(i, ctx),
      surChoix: (p) => { x.versionChoisie = p || null; ficheRecherche(i, ctx); },
    });
  }, { focus: false, large: true });
}

// ---- un onglet pour le deck, un autre pour la recherche : chaque page se remet à jour quand on y revient
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) return;
  try {
    if (location.hash.startsWith("#/recherche") && rch.deck) {
      const a = await api(`/api/decks/${enc(rch.deck.id)}/apercu`);
      if (a.modifie !== rch.deck.modifie) {
        rch.deck = a;
        majInfosDeck();
        if (rch.crit && rch.crit.r === "1" && $("#modale").hidden) lancerRecherche();
      }
    } else if (location.hash.startsWith("#/deck/") && etat.deck && $("#modale").hidden) {
      const a = await api(`/api/decks/${enc(etat.deck.id)}/apercu`);
      if (a.modifie !== etat.deck.modifie) {
        etat.decks = [];
        const onglet = location.hash.split("/")[3] || "liste";
        if (["liste", "stats", "versions", "historique"].includes(onglet.split("?")[0])) {
          const y = scrollY;
          await route();
          scrollTo(0, y);
        } else toast("Deck modifié dans un autre onglet : recharge la page.", 4500);
      }
    }
  } catch (_) {}
});

// ------------------------------------------------------------------ état de la mise à jour (prix, Game Changers)
// cette page est ouverte : elle le dit à chaque nouvelle, et prévient quand on la ferme (réglage « Arrêter l'Atelier »)
const ID_PAGE = Math.random().toString(36).slice(2, 12);
if (PC) addEventListener("pagehide", () => navigator.sendBeacon("/api/presence/fin", ID_PAGE));

async function suivreMaj() {
  try {
    const e = await api("/api/etat?page=" + ID_PAGE);
    const m = e.maj;
    $("#etat-maj").textContent = m.tache
      ? `Mise à jour ${m.tache}${m.total > 1 ? ` ${m.fait}/${m.total}` : ""}…`
      : "";
    $("#btn-rafraichir").disabled = !!m.tache;
  } catch (_) { $("#etat-maj").textContent = "Atelier arrêté ?"; }
  setTimeout(suivreMaj, 3000);
}
$("#btn-rafraichir").addEventListener("click", async () => {
  $("#btn-rafraichir").disabled = true;
  $("#etat-maj").textContent = "Mise à jour…";
  try { await api("/api/rafraichir", { method: "POST" }); } catch (e) { erreur(e); }
});

// ------------------------------------------------------------------ discussion avec Claude
// Une discussion par deck (son historique et son propre contexte Claude), plus une discussion générale.
// On choisit la discussion dans l'en-tête du panneau, depuis n'importe quelle page ; ouvrir un deck (ou le choisir
// comme cible de la recherche) passe à sa discussion. Ailleurs, la discussion choisie reste celle qui était là.
// Les réponses tournent sur le serveur (tâche de fond) : fermer le panneau, changer de page ou d'onglet, ou recharger
// ne les perd pas, et plusieurs decks peuvent attendre une réponse.
// Une réponse se lit comme dans VS Code : le premier message de Claude, puis le détail de son travail dans l'ordre
// (outils et messages intermédiaires, replié une fois la réponse finie), puis sa réponse finale.
const chat = { ouvert: false, charge: false, cle: "", contexte: null, suivi: false, reponse: null, signature: "",
  detailOuvert: true, actif: false, session: false, colle: true, nbMessages: -1 };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const kTokens = (n) => (n >= 1000 ? Math.round(n / 1000) + " k" : String(n || 0));

function texteRiche(t) {
  // texte simple : on échappe, puis **gras**, `code` et retours à la ligne
  return esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
}

function pageCourante() {
  if (location.hash.startsWith("#/recherche")) {
    const crit = rch.crit ? resumeCrit(rch.crit) : [];
    return `recherche de cartes${rch.deck ? ` pour le deck « ${rch.deck.id} »` : ""}${crit.length ? " ; critères : " + crit.join(", ") : ""}`
      + (rch.res && rch.res.cartes.length ? ` ; résultats affichés : ${rch.res.cartes.slice(0, 30).map((x) => x.nom).join(", ")}` : "");
  }
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "deck" && parts[1]) return `deck « ${decodeURIComponent(parts[1])} », onglet ${parts[2] || "liste"}`;
  return "accueil (liste des decks)";
}

// discussion de la page affichée : le deck ouvert, sinon la discussion générale ("")
function cleCourante() {
  if (PARTAGE) return PARTAGE.deck || "";
  if (location.hash.startsWith("#/recherche")) return rch.deck ? rch.deck.id : "";
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  return parts[0] === "deck" && parts[1] ? decodeURIComponent(parts[1]) : "";
}
const nomDiscussion = (cle) => (cle ? cle.replace(/^Deck /, "") : "générale");
const qDeck = (cle) => "?deck=" + enc(cle || "");

// le deck de la page de deck affichée, sinon null
function deckDeLaPage() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  return parts[0] === "deck" && parts[1] ? decodeURIComponent(parts[1]) : null;
}

function remplirChoixDiscussion(ds) {
  const s = $("#chat-discussion");
  if (!s) return;
  const tri = [...ds].sort((a, b) => recence(b) - recence(a) || a.titre.localeCompare(b.titre));
  s.innerHTML = `<option value="">Générale</option>` + tri.map((d) => `<option value="${esc(d.id)}">${esc(d.titre)}</option>`).join("")
    + (chat.cle && !ds.some((d) => d.id === chat.cle) ? `<option value="${esc(chat.cle)}">${esc(nomDiscussion(chat.cle))}</option>` : "");
  s.value = chat.cle;
}

async function choisirDiscussion(cle) {
  if (cle === chat.cle) return;
  chat.cle = cle;
  PREF.set("chat-discussion", cle);
  if (chat.charge) { try { await afficheHistorique(); } catch (e) { ajouteMessage("outil", "Erreur : " + (e.message || e)); } }
}

// le fil reste collé en bas tant qu'on y est (nouveaux messages, symboles de mana qui se chargent)
function enBas(forcer) {
  const fil = $("#chat-fil");
  if (!fil) return;
  if (forcer) chat.colle = true;
  if (chat.colle) fil.scrollTop = fil.scrollHeight;
}

function ajouteMessage(role, texte) {
  const div = document.createElement("div");
  div.className = "msg msg-" + role;
  div.innerHTML = role === "claude" ? texteRiche(texte) : esc(texte);
  $("#chat-fil").appendChild(div);
  enBas();
  return div;
}

// les réponses d'avant les étapes : leurs outils, puis leur texte
const etapesDe = (m) => m.etapes
  || [...(m.outils || []).map((texte) => ({ type: "outil", texte })), ...(m.texte ? [{ type: "texte", texte: m.texte }] : [])];

// « 3 lectures · 2 commandes · 1 modification · 2 messages »
function resumeEtapes(es) {
  const n = {};
  for (const e of es) {
    const k = e.type === "texte" ? "message" : /^lit /.test(e.texte) ? "lecture" : /^(modifie|écrit) /.test(e.texte) ? "modification"
      : /^lance/.test(e.texte) ? "commande" : /^cherche/.test(e.texte) ? "recherche" : /^consulte/.test(e.texte) ? "page web" : "action";
    n[k] = (n[k] || 0) + 1;
  }
  return ["lecture", "recherche", "page web", "commande", "modification", "action", "message"].filter((k) => n[k])
    .map((k) => `${n[k]} ${(n[k] > 1 ? k.replace(/^(\S+)/, "$1s") : k).replace(" ", " ")}`).join(" · ");
}

// une réponse : le texte avant le premier outil, le détail (du premier au dernier outil), le texte après le dernier outil
function htmlReponse(etapes, actif = false, mode = "") {
  const es = etapes.filter((e) => e.type === "outil" || (e.texte || "").trim());
  const i = es.findIndex((e) => e.type === "outil");
  const j = es.length - 1 - [...es].reverse().findIndex((e) => e.type === "outil");
  const debut = i < 0 ? [] : es.slice(0, i), milieu = i < 0 ? [] : es.slice(i, j + 1), fin = i < 0 ? es : es.slice(j + 1);
  const bulle = (e) => `<div class="msg msg-claude">${texteRiche(e.texte.trim())}</div>`;
  const refus = milieu.filter((e) => e.refus).length;       // outils que Claude Code lui a refusés
  return debut.map(bulle).join("")
    + (milieu.length ? `<details class="etapes"${actif && chat.detailOuvert ? " open" : ""}><summary>${esc(resumeEtapes(milieu))}`
      + `${refus ? ` · <span class="etape-refus">${refus} refusé${refus > 1 ? "s" : ""}</span>` : ""}</summary>`
      + `<div class="etapes-corps">${milieu.map((e) => e.type === "outil"
        ? `<div class="etape-outil${e.refus ? " etape-refus" : ""}">${esc(e.texte)}${e.refus ? " — refusé" : ""}</div>`
        : `<div class="etape-texte">${texteRiche(e.texte.trim())}</div>`).join("")}</div></details>` : "")
    + fin.map(bulle).join("")
    + (actif ? `<div class="msg-attente">${mode === "compact" ? "Compactage…" : "Claude réfléchit…"}</div>` : "");
}

function blocReponse(etapes) {
  const div = document.createElement("div");
  div.className = "reponse";
  div.innerHTML = htmlReponse(etapes);
  return div;
}

function boutonEnvoyer(enCours) {
  chat.actif = enCours;
  const b = $("#chat-envoyer");
  if (!b) return;
  b.innerHTML = enCours ? ico("arreter") + "Arrêter" : ico("envoyer") + "Envoyer";
  b.classList.toggle("btn-accent", !enCours);
  $("#chat-compacter").disabled = enCours || !chat.session;
}

async function afficheHistorique() {
  let ds = await listeDecks().catch(() => null);
  if (ds && chat.cle && !ds.some((d) => d.id === chat.cle)) {     // deck tout juste créé, ou supprimé depuis
    etat.decks = [];
    ds = await listeDecks().catch(() => null);
    if (ds && !ds.some((d) => d.id === chat.cle)) { chat.cle = ""; PREF.set("chat-discussion", ""); }
  }
  const cle = chat.cle;
  const h = await api("/api/discussion" + qDeck(cle));
  if (cle !== chat.cle) return h;                 // on a changé de discussion entre-temps
  remplirChoixDiscussion(ds || etat.decks);
  const fil = $("#chat-fil");
  fil.innerHTML = "";
  chat.reponse = null;
  if (!h.disponible) ajouteMessage("outil", "Claude Code est introuvable sur ce PC : la discussion ne marchera pas (installe l'extension Claude Code de VS Code).");
  for (const m of h.messages) {
    if (m.role === "moi") ajouteMessage("moi", m.texte);
    else if (m.role === "compact") ajouteMessage("compact", `Discussion compactée · ${kTokens(m.avant)} → ${kTokens(m.apres)} tokens`);
    else fil.appendChild(blocReponse(etapesDe(m)));
  }
  chat.session = h.session;
  chat.nbMessages = h.messages.length;
  $("#chat-contexte").textContent = h.contexte ? `· ${kTokens(h.contexte)} tokens` : "";
  boutonEnvoyer(h.en_cours.actif);
  if (h.en_cours.actif) { afficheEnCours(h.en_cours); suivreChat(); }
  enBas(true);
  requestAnimationFrame(() => requestAnimationFrame(() => enBas()));   // après la pose des symboles de mana
  return h;
}

// la page a changé : en arrivant sur un deck, le panneau passe à sa discussion ; ailleurs, il garde celle choisie
async function changerDiscussion() {
  const ctx = deckDeLaPage();
  const arrivee = ctx !== null && ctx !== chat.contexte;
  chat.contexte = ctx;
  if (arrivee && ctx !== chat.cle) await choisirDiscussion(ctx);
  else if (chat.charge) listeDecks().then(remplirChoixDiscussion).catch(() => {});   // un deck a pu être créé ou supprimé
}

// retour sur cet onglet du navigateur : le panneau reprend l'état ouvert ou fermé des autres onglets, la discussion du
// deck affiché, et ce qui a été dit ou lancé depuis un autre onglet. Les réponses en cours ailleurs continuent.
async function retourOnglet() {
  if (document.hidden || retourOnglet.enCours) return;
  retourOnglet.enCours = true;
  try {
    let ouvert = chat.ouvert;
    try { ouvert = !!localStorage.getItem("chat-ouvert"); } catch (_) {}
    chat.contexte = null;
    await changerDiscussion();
    if (ouvert !== chat.ouvert) await basculeChat(ouvert);
    else if (chat.charge) {
      const h = await api("/api/discussion" + qDeck(chat.cle));
      if (h.messages.length !== chat.nbMessages || h.en_cours.actif !== chat.actif) await afficheHistorique();
    }
    const s = await api("/api/discussion/en-cours");
    if (s.actives.length) suivreChat();
  } catch (_) {
  } finally { retourOnglet.enCours = false; }
}

async function montageChat() {
  const a = $("#chat");
  a.innerHTML = `
    <div class="chat-tete">
      <select id="chat-discussion" class="btn btn-petit chat-choix" aria-label="Discussion"></select>
      <div>
        <select id="chat-modele" class="btn btn-petit" title="Modèle">
          <option value="opus">Opus</option><option value="sonnet">Sonnet</option><option value="haiku">Haiku</option>
        </select>
        <button class="btn btn-petit btn-discret" id="chat-nouvelle" title="Effacer cette discussion et repartir de zéro">${ico("crayon")}Nouvelle</button>
        <button class="btn btn-petit btn-discret btn-icone" id="chat-fermer" aria-label="Fermer">${ico("fermer")}</button>
      </div>
    </div>
    <div class="chat-fil" id="chat-fil" aria-live="polite"></div>
    <div class="chat-saisie">
      <textarea id="chat-saisie" placeholder="Écris à Claude…"></textarea>
      <div class="form-ligne" style="margin:0;justify-content:space-between">
        <button class="btn btn-petit btn-discret" id="chat-compacter" title="/compact">${ico("compacter")}Compacter <span class="muet" id="chat-contexte"></span></button>
        <button class="btn btn-accent" id="chat-envoyer">${ico("envoyer")}Envoyer</button>
      </div>
    </div>`;
  if (PARTAGE) {                                   // page partagée : le panneau en vitrine, grisé
    $$(".chat-tete select, #chat-nouvelle, #chat-fil, .chat-saisie", a).forEach((x) => { x.classList.add("vitrine-fond"); x.inert = true; });
    a.insertAdjacentHTML("beforeend", invitation("Discussion avec Claude",
      "Disponible dans l'Atelier MTG, à installer gratuitement sur son ordinateur. Il faut aussi Claude Code (abonnement Claude)."));
    $("#chat-fermer").onclick = () => basculeChat(false);
    chat.charge = true;
    return;
  }
  try { $("#chat-modele").value = localStorage.getItem("chat-modele") || "opus"; } catch (_) { $("#chat-modele").value = "opus"; }
  $("#chat-modele").onchange = (ev) => { try { localStorage.setItem("chat-modele", ev.target.value); } catch (_) {} };
  $("#chat-fermer").onclick = () => basculeChat(false);
  $("#chat-discussion").onchange = (ev) => choisirDiscussion(ev.target.value);
  $("#chat-nouvelle").onclick = async () => {
    if (!confirm(`Effacer la discussion ${nomDiscussion(chat.cle)} ?`)) return;
    try {
      await api("/api/discussion/nouvelle", { method: "POST", body: { deck: chat.cle } });
      await afficheHistorique();
    } catch (e) { erreur(e); }
  };
  $("#chat-envoyer").onclick = () => (chat.actif ? arreterChat() : envoyerChat());
  $("#chat-compacter").onclick = compacterChat;
  $("#chat-saisie").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); envoyerChat(); }
  });
  const fil = $("#chat-fil");
  fil.addEventListener("scroll", () => { chat.colle = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 60; }, { passive: true });
  fil.addEventListener("load", () => enBas(), true);              // une image (symbole de mana) vient d'arriver
  fil.addEventListener("toggle", (ev) => { if (chat.reponse && chat.reponse.contains(ev.target)) chat.detailOuvert = ev.target.open; }, true);
  chat.charge = true;
  await afficheHistorique();
}

// réponse en cours dans la discussion affichée, redessinée à chaque nouveauté
function afficheEnCours(s) {
  if (!chat.charge) return;
  if (!chat.reponse || !chat.reponse.isConnected) {
    chat.reponse = document.createElement("div");
    chat.reponse.className = "reponse";
    chat.signature = "";
    $("#chat-fil").appendChild(chat.reponse);
  }
  const sig = s.mode + JSON.stringify(s.etapes);
  if (sig !== chat.signature) {
    chat.signature = sig;
    chat.reponse.innerHTML = htmlReponse(s.etapes, true, s.mode);
  }
  boutonEnvoyer(true);
  enBas();
}

function boutonDiscussion(actives) {
  const b = $("#btn-chat");
  b.classList.toggle("travaille", actives.length > 0);
  b.innerHTML = ico("discussion") + `<span class="txt">${esc(!actives.length ? "Demander à Claude"
    : actives.length > 1 ? `Claude répond (${actives.length})…` : `Claude répond${actives[0] ? " · " + nomDiscussion(actives[0]) : ""}…`)}</span>`;
}

// une réponse vient de se terminer dans la discussion « cle »
async function reponseFinie(cle) {
  let s = {};
  try { s = await api("/api/discussion/en-cours" + qDeck(cle)); } catch (_) {}
  if (chat.charge && cle === chat.cle) {
    await afficheHistorique();                    // la réponse enregistrée, telle qu'elle restera
    if (s.erreur) ajouteMessage("outil", "Erreur : " + s.erreur);
  }
  if (!chat.ouvert || cle !== chat.cle) {
    $("#btn-chat").classList.add("nouveau");
    toast(s.mode === "compact" ? `Discussion ${nomDiscussion(cle)} compactée.` : `Claude a répondu dans la discussion ${nomDiscussion(cle)}.`, 5000);
  }
  if ((s.outils || []).some((o) => /^(modifie|écrit|lance)/.test(o))) { etat.decks = []; route(); }   // un deck a peut-être changé
}

// suit toutes les réponses en cours (une par discussion au plus), que le panneau soit ouvert ou non
async function suivreChat() {
  if (chat.suivi) return;
  chat.suivi = true;
  let avant = [], echecs = 0;
  try {
    for (;;) {
      let s;
      try { s = await api("/api/discussion/en-cours" + qDeck(chat.cle)); echecs = 0; }
      catch (_) { if (++echecs > 10) break; await attendre(2000); continue; }
      for (const k of avant) if (!s.actives.includes(k)) await reponseFinie(k);
      avant = s.actives;
      boutonDiscussion(s.actives);
      if (s.actif) afficheEnCours(s);
      if (!s.actives.length) break;
      await attendre(600);
    }
  } finally {
    chat.suivi = false;
    boutonDiscussion([]);
  }
}

async function basculeChat(ouvrir) {
  chat.ouvert = ouvrir ?? !chat.ouvert;
  $("#chat").hidden = !chat.ouvert;
  if (chat.ouvert) $("#btn-chat").classList.remove("nouveau");
  try { localStorage.setItem("chat-ouvert", chat.ouvert ? "1" : ""); } catch (_) {}
  if (chat.ouvert && !chat.charge) await montageChat();
  else if (chat.ouvert) enBas(true);
}

async function ouvrirChat(texte) {
  if (TELEPHONE) return surPC("claude");
  const ctx = deckDeLaPage();
  if (ctx !== null) await choisirDiscussion(ctx);      // « Expliquer avec Claude » : la discussion du deck affiché
  await basculeChat(true);
  const t = $("#chat-saisie");
  t.value = texte || "";
  t.focus();
}

async function envoyerChat() {
  const t = $("#chat-saisie");
  const message = t.value.trim();
  if (!message || chat.actif) return;
  try {
    const s = await api("/api/discussion", { method: "POST", body: { message, page: pageCourante(), modele: $("#chat-modele").value, deck: chat.cle } });
    t.value = "";
    ajouteMessage("moi", message);
    chat.reponse = null;
    chat.detailOuvert = true;
    chat.nbMessages++;
    afficheEnCours(s);
    enBas(true);
    suivreChat();
  } catch (e) {
    ajouteMessage("outil", "Erreur : " + (e.message || e));
  }
}

async function compacterChat() {
  if (chat.actif || !chat.session) return;
  try {
    const s = await api("/api/discussion/compacter", { method: "POST", body: { deck: chat.cle, modele: $("#chat-modele").value } });
    chat.reponse = null;
    afficheEnCours(s);
    enBas(true);
    suivreChat();
  } catch (e) {
    ajouteMessage("outil", "Erreur : " + (e.message || e));
  }
}

async function arreterChat() {
  if (!confirm("Arrêter la réponse de Claude ?")) return;
  try { await api("/api/discussion/arreter", { method: "POST", body: { deck: chat.cle } }); } catch (e) { erreur(e); }
}

$("#btn-chat")?.addEventListener("click", () => basculeChat());       // page d'accueil : « Créer un deck » à sa place (site_atelier.py)
// téléphone : un élément « à faire sur le PC » dit où le faire, au lieu d'agir
if (TELEPHONE) document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-pc]");
  if (!el) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  surPC(el.dataset.pc);
}, true);
if (PC) {
  chat.contexte = deckDeLaPage();
  chat.cle = chat.contexte ?? PREF.get("chat-discussion", "");
  window.addEventListener("hashchange", changerDiscussion);
  document.addEventListener("visibilitychange", retourOnglet);
  window.addEventListener("focus", retourOnglet);
  try { if (localStorage.getItem("chat-ouvert")) basculeChat(true); } catch (_) {}
  api("/api/discussion/en-cours").then((s) => { if (s.actives.length) suivreChat(); }).catch(() => {});   // une réponse tournait déjà
}

route();
if (PC) suivreMaj();
// les préférences, demandées une fois : fermeture de la page, visuel par défaut des cartes, Universes Beyond
if (PC) setTimeout(() => api("/api/options").then((o) => { if (!o.preferences && $("#modale").hidden) modalePreferences(o); })
  .catch(() => {}), 800);

// nouvelle version de l'Atelier (mise_a_jour.py) : un bandeau propose de l'installer ; l'Atelier redémarre et la page se recharge
async function verifierVersion() {
  let v;
  try { v = await api("/api/version"); } catch (_) { return; }
  versionAtelier = v.version;
  const d = v.disponible;
  if (!d || $("#bandeau-maj")) return;
  try { if (sessionStorage.getItem("maj-plus-tard") === d.version) return; } catch (_) {}
  // une ligne sous l'en-tête : la version, ses nouveautés (en entier au survol), les deux boutons ; pendant la mise à
  // jour, la barre garde sa hauteur (une roue à la place des boutons, un trait qui défile dessous)
  $(".barre").insertAdjacentHTML("afterend", `<div class="bandeau-maj" id="bandeau-maj" role="status">
    <p class="maj-texte"><strong><span class="maj-large">Nouvelle version</span><span class="maj-etroit">Version</span> ${esc(d.version)}</strong>${d.nouveautes
      ? `<span class="maj-nouveautes" title="${esc(d.nouveautes)}">${esc(d.nouveautes)}</span>` : ""}</p>
    <div class="maj-actions">
      <button class="btn btn-accent btn-petit" id="maj-installer">${ico("telecharger")}Mettre à jour</button>
      <button class="btn btn-petit btn-discret" id="maj-plus-tard" aria-label="Plus tard">${ico("fermer")}<span class="maj-large">Plus tard</span></button>
    </div>
  </div>`);
  const b = $("#bandeau-maj"), actions = $(".maj-actions", b);
  const etape = (t) => { b.classList.add("en-cours"); actions.innerHTML = `<span class="maj-etape">${t}</span>`; };
  const echec = (t) => { b.classList.remove("en-cours"); actions.innerHTML = `<span class="erreur petit">${esc(t)}</span>`; };
  $("#maj-plus-tard").onclick = () => { try { sessionStorage.setItem("maj-plus-tard", d.version); } catch (_) {} b.remove(); };
  $("#maj-installer").onclick = async () => {
    etape("Mise à jour…");
    try {
      const r = await api("/api/mise-a-jour", { method: "POST", body: {} });
      etape("Redémarrage…");
      for (let i = 0; i < 90; i++) {
        await attendre(1000);
        try { if ((await api("/api/version")).version === r.version) return location.reload(); } catch (_) {}
      }
      echec("L'Atelier ne redémarre pas : relance-le depuis le raccourci du bureau.");
    } catch (e) {
      echec(e.message || e);
    }
  };
}
if (PC) {
  verifierVersion();
  setTimeout(verifierVersion, 30000);                // l'Atelier lit le dépôt quelques secondes après son lancement
  setInterval(verifierVersion, 3 * 3600 * 1000);
}
// le navigateur garde la page « L'Atelier n'est pas lancé » (avec de quoi le lancer) pour quand l'adresse ne répond plus (sw.js)
if (PC && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
  caches.open("atelier-eteint").then((c) => c.add("/eteint")).catch(() => {});     // sa version du jour : bouton Lancer ou non
}
