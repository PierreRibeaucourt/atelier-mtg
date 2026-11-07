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
// page partagée : à qui sont ces decks (reglages.json « nom », sinon le compte GitHub qui publie)
const MES_DECKS = PARTAGE && PARTAGE.auteur ? `Decks de ${PARTAGE.auteur}` : "Mes decks";
let versionAtelier = (PARTAGE && PARTAGE.version) || "";       // version.py ; dans l'Atelier, lue par verifierVersion()
// budget par carte (reglages.json, 5 € par défaut, 0 = pas d'alerte) : les cartes plus chères sont signalées
const REGLAGES = (PARTAGE && PARTAGE.reglages) || window.REGLAGES || {};
const BUDGET = REGLAGES.budget === undefined ? 5 : REGLAGES.budget > 0 ? REGLAGES.budget : Infinity;
const BUDGET_TXT = String(BUDGET).replace(".", ",") + " €";

// préférences d'affichage gardées d'une visite à l'autre (si le navigateur le permet)
const PREF = {
  get(k, def) { try { return localStorage.getItem("pref-" + k) || def; } catch (_) { return def; } },
  set(k, v) { try { localStorage.setItem("pref-" + k, v); } catch (_) {} },
};

async function api(chemin, opts = {}) {
  if (PARTAGE) return apiPartage(chemin, opts);
  const init = { ...opts, headers: { "Content-Type": "application/json" } };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const r = await fetch(chemin, init);
  const type = r.headers.get("content-type") || "";
  const data = type.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.erreur) || data || r.statusText);
  return data;
}

// même clé que partage.py : chemin décodé, paramètres triés
function apiPartage(chemin, opts) {
  if ((opts.method || "GET") !== "GET") throw new Error("Page en lecture seule.");
  const u = new URL(chemin, "http://atelier");
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

// comparaison de deux versions, comme /api/decks/…/comparer, à partir des listes figées
function comparerPartage(fa, fb) {
  const { listes, infos } = PARTAGE.comparer, A = listes[fa], B = listes[fb];
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
};
if (PARTAGE) $(".logo").href = PARTAGE.accueil === true ? "#/" : PARTAGE.accueil;
const ico = (nom) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nom] || ""}</svg>`;
$$("[data-ico]").forEach((el) => el.insertAdjacentHTML("afterbegin", ico(el.dataset.ico)));
// page partagée : à qui est la page, et l'Atelier à télécharger pour faire pareil avec ses decks ;
// en bas, la licence, le code source et la page « C'est quoi, l'Atelier MTG ? », une seule pour le site : a-propos/
const TITRE_PARTAGE = document.title;
const A_PROPOS = !PARTAGE ? "#/a-propos" : PARTAGE.page === "a-propos" ? "./"
  : (PARTAGE.accueil && PARTAGE.accueil !== true ? PARTAGE.accueil : "") + "a-propos/";
if (PARTAGE) {
  const depot = PARTAGE.atelier ? esc(PARTAGE.atelier) : "";
  $(".barre").insertAdjacentHTML("afterend", `<div class="bandeau-partage">
    <p>Page ${PARTAGE.auteur ? `de <strong>${esc(PARTAGE.auteur)}</strong>, ` : ""}partagée avec <a href="${A_PROPOS}">l'Atelier MTG</a>. Pour gérer, tester et partager vos propres decks Commander, l'Atelier est gratuit.</p>
    ${depot ? `<a class="btn btn-accent btn-petit" href="${depot}" target="_blank" rel="noopener">${ico("telecharger")}Télécharger l'Atelier MTG</a>` : ""}
  </div>`);
  $(".cadre").insertAdjacentHTML("afterend", `<footer class="pied-partage">
    <nav><a href="${A_PROPOS}">C'est quoi, l'Atelier MTG ?</a>${depot ? `<a href="${depot}" target="_blank" rel="noopener">Code source sur GitHub</a>
      <a href="${depot}/blob/main/LICENSE" target="_blank" rel="noopener">Licence MIT</a>` : ""}</nav>
    <p>Magic: The Gathering est une marque de Wizards of the Coast. L'Atelier MTG n'est ni affilié à Wizards of the Coast ni approuvé par elle.
      Données des cartes : Scryfall.</p>
  </footer>`);
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

document.addEventListener("mouseover", (ev) => {
  const el = ev.target.closest("[data-survol], [data-survol-r]");
  const fs = $("#fiche-survol");
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
  const y = ev.clientY + 18 + h > innerHeight - 8 ? Math.max(8, ev.clientY - h - 12) : ev.clientY + 18;
  fs.style.left = Math.max(8, x) + "px";
  fs.style.top = y + "px";
});

const souris = { x: 0, y: 0 };

function placerApercu() {
  const ap = $("#apercu");
  ap.style.left = (souris.x + 24 + 244 > innerWidth ? souris.x - 268 : souris.x + 24) + "px";
  ap.style.top = Math.max(8, Math.min(souris.y - 40, innerHeight - 390)) + "px";
}

function montrerApercu(el) {
  const ap = $("#apercu");
  survol = el;
  $("img", ap).src = el.dataset.image;
  majLegende();
  placerApercu();
  ap.hidden = false;
}

document.addEventListener("mouseover", (ev) => {
  const el = ev.target.closest("[data-image], [data-apercu]");
  const ap = $("#apercu");
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
document.addEventListener("mousemove", (ev) => {
  souris.x = ev.clientX;
  souris.y = ev.clientY;
  const ap = $("#apercu");
  if (!ap.hidden) placerApercu();
  const bu = $("#bulle");
  if (!bu.hidden) {
    const w = bu.offsetWidth, h = bu.offsetHeight;
    bu.style.left = Math.max(8, Math.min(ev.clientX + 14, innerWidth - w - 8)) + "px";
    bu.style.top = (ev.clientY + 18 + h > innerHeight ? Math.max(8, ev.clientY - h - 12) : ev.clientY + 18) + "px";
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
const SANS_CITE = "script, style, textarea, input, select, option, code, pre, svg, h1, h2, .fil, .nc, [data-apercu], [data-image], "
  + "[data-survol], [data-survol-r], .fs-texte, .texte, .fc-tete, .fiche, .moteur, #apercu, #bulle, #fiche-survol, #toast, #menu, [contenteditable]";

function apercuCite(el) {
  const nom = el.dataset.apercu;
  const remplir = (f) => {
    if (!f || !f.image) { el.dataset.image = ""; return; }
    const autre = sansAccent(el.textContent.trim()) === sansAccent(f.fr) ? f.nom : f.fr || f.nom;     // l'autre langue
    el.dataset.image = f.image;
    el.dataset.legende = `${autre} — ${prixRch(f)}`;
    if ((f.prix || 0) > BUDGET) el.dataset.cher = "1";
  };
  const c = etat.deck && etat.deck.cartes.find((x) => x.nom === nom);        // carte du deck : la version choisie
  if (c && c.info && c.info.image) { remplir({ nom: c.nom, fr: c.info.fr, image: c.info.image, prix: c.info.prix }); return Promise.resolve(); }
  if (!APERCUS.has(nom)) APERCUS.set(nom, api(`/api/apercu-carte?nom=${enc(nom)}`).catch(() => null));
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
  if (!r || !r.noms.length) { if (!PARTAGE) setTimeout(chargerCites, 10000); return; }      // base de cartes en cours de chargement
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
  const w = m.offsetWidth, hh = m.offsetHeight;
  let x, y;
  if (ev && ev.clientX) {                       // clic sur une image : le menu s'ouvre sous la souris
    x = ev.clientX; y = ev.clientY;
    m.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
    m.style.top = (y + hh + 8 > innerHeight ? Math.max(8, y - hh - 4) : y + 4) + "px";
  } else {
    const r = bouton.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
    m.style.top = (r.bottom + hh + 8 > innerHeight ? r.top - hh - 4 : r.bottom + 4) + "px";
  }
}
function fermerMenu() { $("#menu").hidden = true; }
document.addEventListener("click", (ev) => { if (!ev.target.closest("#menu, .btn-menu, .ouvre-menu")) fermerMenu(); });

function ouvrirModale(html, monte, { focus = true, large = false } = {}) {
  cacherApercu();
  fermerMenu();
  const m = $("#modale");
  m.innerHTML = `<div class="modale-boite ${large ? "large" : ""}" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;
  m.hidden = false;
  m.onclick = (ev) => { if (ev.target === m) fermerModale(); };
  if (monte) monte($(".modale-boite", m));
  const champ = focus && $("input, textarea", m);
  if (champ) champ.focus();
  else $(".modale-boite", m).focus({ preventScroll: true });
}
function fermerModale() { $("#modale").hidden = true; $("#modale").innerHTML = ""; cacherApercu(); }
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
    t = ["Recherche", p.get("nom") && `« ${p.get("nom")} »`, (p.get("deck") || "").replace(/^Deck /, "")].filter(Boolean).join(" · ");
  }
  document.title = t + " — Atelier MTG";
}

async function route() {
  fermerMenu();
  if (!$("#modale").hidden) fermerModale();
  cacherApercu();
  majTitre();
  const [chemin, qs] = location.hash.replace(/^#\/?/, "").split(/\?(.*)/s);
  const parts = chemin.split("/");
  $("#lien-recherche").classList.toggle("actif", parts[0] === "recherche");
  vue.classList.toggle("vue-large", parts[0] === "recherche");
  try {
    if (PARTAGE && parts[0] === "a-propos" && PARTAGE.page !== "a-propos") location.replace(A_PROPOS);   // ancienne adresse
    else if (parts[0] === "a-propos" || (PARTAGE && PARTAGE.page === "a-propos" && !parts[0])) vueAPropos();
    else if (PARTAGE && parts[0] === "recherche") vueRechercheVitrine();
    else if (PARTAGE && PARTAGE.deck) await vueDeck(PARTAGE.deck, (parts[0] === "deck" && parts[2]) || "liste");
    else if (PARTAGE && parts[0] === "deck" && parts[1]) location.replace(lienDeck(decodeURIComponent(parts[1])));
    else if (parts[0] === "recherche") await vueRecherche(new URLSearchParams(qs || ""));
    else if (parts[0] === "deck" && parts[1]) await vueDeck(decodeURIComponent(parts[1]), parts[2] || "liste", parts[3] ? decodeURIComponent(parts[3]) : null);
    else await vueAccueil();
  } catch (e) {
    vue.innerHTML = `<p class="erreur">${esc(e.message || e)}</p>`;
  }
  majTitre();                                      // l'adresse a pu être complétée (dernière recherche reprise)
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
    return "#/recherche?" + new URLSearchParams({ nom: q, r: "1", ...(d ? { deck: d.id } : {}) });
  };
  const rendre = async () => {
    const k = ++numero;
    const brut = champ.value.trim(), q = sansAccent(brut);
    const deck = deckDeLaPage();
    const [ds, cartes] = await Promise.all([listeDecks(),
      q.length >= 2 ? api("/api/recherche/noms?q=" + enc(brut) + (deck ? "&deck=" + enc(deck.id) : "")).catch(() => []) : Promise.resolve([])]);
    // rien trouvé : la base de cartes est peut-être encore en construction (premier lancement)
    const enConstruction = q.length >= 2 && !cartes.length
      && !((await api("/api/recherche/base").catch(() => null)) || { prete: true }).prete;
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
        : enConstruction ? `<div class="aller-vide petit">La base de cartes se construit : la recherche marchera quand elle sera prête.
            <a href="${esc(tous(brut))}">Voir l'avancement →</a></div>`
        : `<div class="aller-vide muet petit">Aucune carte.</div>`) : "")
      + (decksTrouves.length ? (q.length >= 2 ? `<div class="aller-section">Decks</div>` : "") + items.slice(nc).map((it, j) => ligneDeck(it, nc + j)).join("") : "")
      + (q.length >= 2 && !enConstruction ? `<div class="aller-pied petit"><a href="${esc(tous(brut))}">Toutes les cartes « ${esc(brut)} » →</a></div>` : "");
    liste.hidden = !liste.innerHTML;
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
  vue.innerHTML = `
    <div class="titre-page">
      <h1>${esc(MES_DECKS)}</h1>
      <button class="btn btn-accent ecrit" id="btn-nouveau">${ico("plus")}Nouveau deck</button>
    </div>
    <div class="barre-outils">
      <input class="champ filtre" id="d-filtre" type="search" placeholder="Chercher un deck, un commandant ou une carte…" value="${esc(etat.filtreDecks || "")}" aria-label="Chercher un deck">
      <span class="outil"><span class="petit muet">Couleurs</span>
        <span class="choix-couleurs">${["W", "U", "B", "R", "G", "C"].map((x) => `<button type="button" class="couleur ${etat.couleurs.includes(x) ? "actif" : ""}"
          data-couleur="${x}" aria-pressed="${etat.couleurs.includes(x)}" title="${x === "C" ? "Decks incolores" : `Decks qui jouent le ${NOMS_COULEURS[x]}`}">${symbole(x)}</button>`).join("")}</span></span>
      <label class="outil petit muet">Trier par
        <select class="champ champ-petit" id="d-tri">${[["recent", "récents"], ["nom", "nom"], ["prix", "prix"], ["gc", "Game Changers"]].map(([v, l]) =>
          `<option value="${v}" ${PREF.get("tri-decks", "recent") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${segments("vue-decks", [["grille", "Grille", "grille"], ["liste", "Liste", "liste"]], "grille")}
    </div>
    <div id="d-resultats"></div>
    ${corbeille.length ? `
      <details class="panneau"><summary>Decks supprimés (${corbeille.length})</summary>
        <table class="tableau" style="margin-top:.6rem"><tbody>
          ${corbeille.map((c, i) => `<tr><td><strong>${esc(c.nom.replace(/^Deck /, ""))}</strong> <span class="muet petit">supprimé le ${esc(c.date)}</span></td>
            <td class="num"><button class="btn btn-petit" data-recup="${i}">${ico("annuler")}Récupérer</button></td></tr>`).join("")}
        </tbody></table>
      </details>` : ""}`;
  $("#btn-nouveau").onclick = modaleNouveauDeck;
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
  $$("[data-recup]").forEach((b) => b.addEventListener("click", async () => {
    try {
      const r = await api("/api/corbeille/recuperer", { method: "POST", body: { fichier: corbeille[+b.dataset.recup].fichier } });
      toast("Deck récupéré.");
      location.hash = `#/deck/${enc(r.id)}`;
    } catch (e) { erreur(e); }
  }));
}

// accueil : sans le Maybeboard ; en-tête d'un deck : avec
function chiffresDeck(d, accueil = false) {
  const complet = d.total === 100;
  const al = Object.entries(d.alertes || {});
  return `
    <span class="badge ${complet ? "badge-ok" : "badge-alerte"}">${d.total} / 100 cartes</span>
    ${d.maybe && !accueil ? `<span class="badge">${d.maybe} en Maybeboard</span>` : ""}
    <span class="badge">${euros(d.prix_total)}</span>
    ${d.bracket ? `<span class="badge badge-bracket" title="${esc((d.bracket_raisons || []).join("\n"))}">${ico("bracket")}Bracket ${d.bracket}</span>` : ""}
    <span class="badge ${d.gc.length ? "badge-gc" : ""}" title="${esc(d.gc.join(", "))}">${d.gc.length} Game Changer${d.gc.length > 1 ? "s" : ""}</span>
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
        <div class="chiffres">${chiffresDeck(d, true)}</div>
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
    <div class="boutons"><button class="btn" id="annuler">Annuler</button><button class="btn btn-accent" id="ok">Créer le deck</button></div>`, (b) => {
    const montreCmd = () => {
      $("#nd-cmd", b).innerHTML = cmd ? `
        <div class="cmd-choisi">
          <img src="${esc(cmd.image)}" alt="" data-image="${esc(cmd.image)}">
          <div><strong>${esc(cmd.nom)}</strong> ${mana(cmd.cout)}${cmd.fr ? `<div class="muet petit">${esc(cmd.fr)}</div>` : ""}
            <div class="muet petit">${esc(cmd.type || "")}</div></div>
          <button class="btn btn-petit" id="nd-autre">Changer</button>
        </div>` : "";
      $("#nd-rech", b).hidden = !!cmd;
      if (cmd) $("#nd-autre", b).onclick = () => { cmd = null; montreCmd(); rech.vider(); };
    };
    rech = rechercheCarte($("#nd-rech", b), { deck: () => null,
      surChoix: (x) => { cmd = x; montreCmd(); } });
    $("#annuler", b).onclick = fermerModale;
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

// ------------------------------------------------------------------ page d'un deck
const ONGLETS = [["liste", "Liste"], ["stats", "Statistiques"], ["combos", "Combos"], ["versions", "Versions"], ["bracket", "Bracket"], ["simulation", "Simulation"]];

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
          <a class="btn" href="${PARTAGE ? "jouer/" : `/jouer?deck=${enc(id)}`}" target="_blank" rel="noopener">${ico("lancer")}Jouer</a>
          <a class="btn ecrit" href="#/recherche?deck=${enc(id)}">${ico("chercher")}Chercher des cartes</a>
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
  $$(".cmd-entete").forEach((x) => { x.onclick = () => ouvrirCarte(d.cartes[+x.dataset.carte]); });
  $("#btn-deck-menu").onclick = (ev) => ouvrirMenu(ev.currentTarget, [
    ...(PARTAGE ? [] : [["Partager le deck…", () => modalePartage(d), "", "partager"], null]),
    "Copier la liste pour",
    ...EXPORTS.map(([fmt, lib]) => [lib, () => copierListe(fmt, lib), "", "copier"]),
    ...(PARTAGE ? [] : [null, ["Supprimer ce deck…", () => supprimerDeck(d), "btn-danger", "corbeille"]]),
  ]);
  const contenu = $("#contenu");
  if (onglet === "stats") return ongletStats(contenu, d);
  if (onglet === "bracket") return ongletBracket(contenu, d);
  if (onglet === "combos") return ongletCombos(contenu, d, extra);
  if (onglet === "simulation") return ongletSimulation(contenu, d, extra);
  if (onglet === "versions" || onglet === "historique") return ongletVersions(contenu, d);
  ongletListe(contenu, d);
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

// page du deck publiée sur GitHub Pages (partage.py) : lien, mise à jour, retrait
function modalePartage(d) {
  ouvrirModale(`<div class="fc-tete"><h2>Partager ${esc(d.titre)}</h2>
      <button class="btn btn-discret btn-icone" id="pt-fermer" aria-label="Fermer">${ico("fermer")}</button></div>
    <div id="pt-zone"><p class="chargement">Chargement…</p></div>`, async (b) => {
    $("#pt-fermer", b).onclick = fermerModale;
    const zone = $("#pt-zone", b);
    const rendre = (s) => {
      zone.innerHTML = `
        <div class="form-ligne">
          <input class="champ" id="pt-url" readonly value="${esc(s.url)}" style="flex:1;min-width:240px" aria-label="Lien de la page">
          <button class="btn btn-accent" id="pt-copier">${ico("copier")}Copier le lien</button>
          <a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener">${ico("ouvrir")}Ouvrir</a>
        </div>
        <p class="muet petit">Mise à jour le ${esc(new Date(s.date * 1000).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }))}</p>
        ${s.erreur ? `<p class="erreur petit">${esc(s.erreur)}</p>` : ""}
        <div class="boutons">
          <button class="btn btn-danger" id="pt-retirer">${ico("corbeille")}Ne plus partager</button>
          <button class="btn" id="pt-maj">${ico("rafraichir")}Mettre à jour</button>
        </div>`;
      $("#pt-url", zone).onclick = (ev) => ev.target.select();
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
      try { rendre(await api(`/api/decks/${enc(d.id)}/partage`, { method: "POST" })); toast("Publié : en ligne d'ici une minute.", 4000); }
      catch (e) { zone.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
    };
    const s = await api(`/api/decks/${enc(d.id)}/partage`).catch(() => ({}));
    if (s.url) rendre(s); else publier();
  }, { focus: false });
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
const LIBELLE_SIM = {
  corps: ["sim : simple corps", "Le simulateur joue cette créature sans ses effets"],
  sans_effet: ["sim : sans effet", "Le simulateur ne comprend pas ce sort : il ne fait rien en simulation"],
  partiel: ["sim : lue en partie", "Le simulateur ne comprend qu'une partie de la carte"],
};
const TITRE_ALERTE = {
  "hors couleurs": "Une de ses couleurs n'est pas dans l'identité de ton commandant : interdite dans ce deck",
  "ne peut pas être commandant": "Seules les créatures légendaires (et quelques planeswalkers, véhicules ou vaisseaux qui le disent) peuvent être commandant",
  "partenaires incompatibles": "Deux commandants seulement s'ils vont ensemble : Partner (ou Partner with l'autre), Friends forever, Historique (Choose a Background), compagnon du Docteur",
  "trop de commandants": "Un commandant, ou deux s'ils sont partenaires",
  "en double": "Une seule copie par carte en Commander (sauf les terrains de base et les cartes qui le permettent)",
  "interdite": "Carte bannie en Commander",
  "non légale": "Carte non légale en Commander (carte Un-, Alchimie…)",
};
const AFFICHAGE = PARTAGE ? "visuel" : "liste";          // affichage par défaut d'un deck : les images sur une page partagée
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

function segments(pref, valeurs, def) {
  const v = PREF.get(pref, def);
  return `<div class="segments" role="group">${valeurs.map(([k, l, i]) =>
    `<button type="button" data-pref="${pref}" data-val="${k}" class="${k === v ? "actif" : ""}" aria-pressed="${k === v}">${i ? ico(i) : ""}${l}</button>`).join("")}</div>`;
}

function ongletListe(el, d) {
  el.innerHTML = `
    ${d.erreur_sim ? `<p class="erreur petit">Le simulateur n'a pas pu lire ce deck : ${esc(d.erreur_sim.non_lu[0])}</p>` : ""}
    ${!d.cartes.length ? `<div class="panneau vide"><p>Ce deck est vide.</p><button class="btn btn-accent ecrit" id="vide-ajouter">${ico("plus")}Ajouter des cartes</button></div>` : `
    <div class="barre-outils">
      ${segments("affichage", [["liste", "Liste", "liste"], ["visuel", "Visuel", "cartes"]], AFFICHAGE)}
      <label class="outil petit muet" id="outil-taille" ${PREF.get("affichage", AFFICHAGE) === "visuel" ? "" : "hidden"}>Taille
        <input type="range" id="taille" min="80" max="220" step="5" value="${tailleCartes()}" aria-label="Taille des cartes"></label>
      <label class="outil petit muet">Ranger par
        <select class="champ champ-petit" id="rangement">${[["type", "type"], ["tags", "tags"], ["fonction", "fonction"]].map(([v, l]) =>
          `<option value="${v}" ${PREF.get("rangement", "type") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="outil petit muet">Trier par
        <select class="champ champ-petit" id="tri">${[["cout", "coût"], ["nom", "nom"], ["prix", "prix"]].map(([v, l]) =>
          `<option value="${v}" ${PREF.get("tri", "cout") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <input class="champ filtre" id="filtre" type="search" placeholder="Filtrer…" value="${esc(etat.filtre)}" aria-label="Filtrer les cartes">
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
  const sim = c.sim && LIBELLE_SIM[c.sim.classe];
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
      ${sim ? `<span class="badge badge-sim" title="${esc(sim[1] + (c.sim.non_lu.length ? " :\n• " + c.sim.non_lu.join("\n• ") : ""))}">${sim[0]}</span>` : ""}
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
  const sim = c.sim && LIBELLE_SIM[c.sim.classe];
  const cher = (f.prix || 0) > BUDGET;
  const tags = c.tags.filter((t) => t !== "Maybeboard" && t !== "Commander");
  ouvrirModale(`
    <div class="fiche-carte">
      <div class="fc-image">${f.image ? `<img src="${esc(f.image)}" alt="${esc(c.nom)}" data-recto="${esc(f.image)}" data-verso="${esc((f.dos && f.dos.image) || "")}">` : `<div class="sans-image">${esc(c.nom)}</div>`}
        ${boutonVerso(f.dos)}${lienVersion(c.version)}</div>
      <div class="fc-infos">
        <div class="fc-tete">
          <div><h2>${esc(c.nom)} ${mana(f.cout)}</h2>${f.fr && f.fr !== c.nom ? `<div class="muet">${esc(f.fr)}</div>` : ""}</div>
          <button class="btn btn-discret btn-icone" id="fc-fermer" aria-label="Fermer">${ico("fermer")}</button>
        </div>
        <div class="petit muet">${esc(f.fr_type || f.type || "")}${f.pt ? " · " + esc(f.pt) : ""}${cmd ? " · commandant" : maybe ? " · Maybeboard" : ""}</div>
        <div class="chiffres">
          <span class="badge ${cher ? "badge-cher" : ""}" title="Le moins cher, toutes éditions (prix Cardmarket du jour)">${euros(f.prix)}${f.prix_edition ? ` · ${esc(f.prix_edition)}` : ""}</span>
          ${f.gc ? `<span class="badge badge-gc">Game Changer</span>` : ""}
          ${badgesAlerte(c)}
          ${sim ? `<span class="badge badge-sim" title="${esc(sim[1] + (c.sim.non_lu.length ? " :\n• " + c.sim.non_lu.join("\n• ") : ""))}">${sim[0]}</span>` : ""}
        </div>
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
        <div class="fc-bloc-actions ecrit" role="group" aria-label="Actions sur la carte">
          <div class="fc-actions">
            ${cmd ? "" : `<button class="btn btn-petit" data-act="maybe">${maybe ? ico("annuler") + "Remettre dans le deck" : ico("maybe") + "Passer en Maybeboard"}</button>`}
            ${cmd ? `<button class="btn btn-petit" data-act="cmd">${ico("couronne")}Ne plus en faire le commandant</button>`
              : !maybe && legendaire && (d.commandants || []).length < 2 && (!second || f.partenaire !== false) ? `<button class="btn btn-petit" data-act="cmd">${ico("couronne")}${second ? "Ajouter comme second commandant" : "Définir comme commandant"}</button>` : ""}
            <button class="btn btn-petit btn-danger fc-retirer" data-act="retirer">${ico("corbeille")}Retirer du deck</button>
          </div>
        </div>
        <div class="fc-liens">
          ${PARTAGE ? `<a href="https://commanderspellbook.com/search/?q=${enc(`card:"${ic_cle(c.nom)}"`)}" target="_blank" rel="noopener">${ico("combos")}Combos avec cette carte ↗</a>`
            : `<a href="#/deck/${enc(d.id)}/combos/${enc(c.nom)}">${ico("combos")}Combos avec cette carte</a>`}
          <a href="${esc(f.prix_lien || lienCardmarket(c.nom))}" target="_blank" rel="noopener">${ico("panier")}Cardmarket ↗</a>
          <a href="${esc(f.gatherer || lienGatherer(c.nom))}" target="_blank" rel="noopener">${ico("livre")}Gatherer ↗</a>
        </div>
        ${pos >= 0 && ordre.length > 1 ? `
          <div class="fc-nav">
            <button class="btn btn-petit" data-act="prec" ${pos === 0 ? "disabled" : ""}>${ico("precedent")}Précédente</button>
            <span class="muet petit">${pos + 1} / ${ordre.length}</span>
            <button class="btn btn-petit" data-act="suiv" ${pos === ordre.length - 1 ? "disabled" : ""}>Suivante${ico("suivant")}</button>
          </div>` : ""}
      </div>
    </div>`, (b) => {
    const retrouver = (nd) => nd && nd.cartes.find((x) => x.nom === c.nom);
    $("#fc-fermer", b).onclick = fermerModale;
    b.addEventListener("click", async (ev) => {
      const x = ev.target.closest("[data-act]");
      if (!x || x.disabled) return;
      const act = x.dataset.act;
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
    await vueDeck(d.id, "liste", null, d);
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
    <h2>Tags de ${esc(c.nom)}</h2>
    <div id="tags-carte" class="puces"></div>
    <div class="form-ligne">
      <input class="champ" id="tag-nouveau" list="liste-cat" placeholder="Nouveau tag" style="flex:1;min-width:200px">
      ${optionsCategories()}
      <button class="btn" id="tag-ajout">Ajouter</button>
    </div>
    <div class="petit muet" style="margin-top:.9rem">Déjà utilisés</div>
    <div id="tags-dispo" class="puces"></div>
    <div class="boutons"><button class="btn" id="annuler">Annuler</button><button class="btn btn-accent" id="ok">Enregistrer</button></div>`, (b) => {
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
    $("#annuler", b).onclick = () => (retourFiche ? ouvrirCarte(c) : fermerModale());
    $("#ok", b).onclick = async () => {
      champ.value.split(",").forEach(ajoute);
      fermerModale();
      const nd = await modifier("categorie", c, { tags });
      if (retourFiche && nd) ouvrirCarte(nd.cartes.find((x) => x.nom === c.nom));
    };
  });
}

// ------------------------------------------------------------------ choisir la version (le visuel) d'une carte
// Impressions anglaises et françaises ; le choix s'écrit « (ima) 205 » dans la liste, comme dans les exports Archidekt.
const memeVersion = (a, b) => !!a && !!b && a.set === b.set && a.num === b.num && (a.lang || "en") === (b.lang || "en");
const editionVersion = (p) => p ? { set: p.set, num: p.num, lang: p.lang, nom_edition: p.edition } : null;

function lienVersion(v) {
  return `<div class="fc-version">
    ${v ? `<span class="petit muet">${esc(v.edition)}${v.annee ? " · " + esc(v.annee) : ""}${v.lang === "fr" ? " · en français" : ""}</span>` : ""}
    <button type="button" class="lien-discret ecrit" data-act="version">Changer la version</button>
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
function rechercheCarte(zone, { surChoix, surAjout = null, deck = () => etat.deck, placeholder = "Nom de la carte…" }) {
  zone.innerHTML = `<input class="champ" type="search" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="Chercher une carte">
    <div class="resultats" role="listbox"></div>`;
  const champ = $("input", zone), res = $(".resultats", zone);
  let minuteur, numero = 0, liste = [], actif = -1;

  const legende = (x) => `${x.fr && x.fr !== x.nom ? x.fr + " — " : ""}${x.prix === undefined || (x.prix == null && !x.prixFait) ? "prix en cours…" : x.prix == null ? "prix inconnu" : euros(x.prix)}${x.gc ? " · Game Changer" : ""}`;
  const nomHtml = (x) => `<span class="en">${esc(x.nom)}</span>${x.fr && x.fr !== x.nom ? ` <span class="muet">· ${esc(x.fr)}</span>` : ""}
    <span class="res-type">${esc(x.type || "")}</span>`;
  const prixHtml = (x) => x.prix != null ? euros(x.prix) : `<span class="muet">${x.prixFait ? "—" : "…"}</span>`;
  const ligne = (x, i) => {
    const d = deck();
    const deja = d && d.cartes.some((c) => c.nom === x.nom);
    const hors = d && d.identite && (x.couleurs || []).some((k) => !d.identite.includes(k));
    const cher = (x.prix || 0) > BUDGET;
    const plus = !surAjout ? "" : deja && !/Basic/.test(x.type || "") ? `<span class="res-plus"></span>`
      : `<button type="button" class="res-plus" data-plus="${i}" title="Ajouter au deck" aria-label="Ajouter ${esc(x.nom)} au deck">${ico("plus")}</button>`;
    return `<div class="res-ligne"><button type="button" class="res-carte ${i === actif ? "choisi" : ""}" data-i="${i}" role="option"
        data-image="${esc(x.image)}" data-legende="${esc(legende(x))}" ${cher ? 'data-cher="1"' : ""}>
      <span class="res-nom">${nomHtml(x)}</span>
      <span class="res-badges">${x.gc ? `<span class="badge badge-gc">Game Changer</span>` : ""}${x.legal === "banned" ? `<span class="badge badge-alerte">interdite</span>` : ""}${hors ? `<span class="badge badge-alerte">hors couleurs</span>` : ""}${deja ? `<span class="badge">déjà dans le deck</span>` : ""}</span>
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
  const chercher = async (q) => {
    const k = ++numero;
    if (q.trim().length < 2) { liste = []; res.innerHTML = ""; return; }
    res.innerHTML = `<span class="muet petit">Recherche…</span>`;
    try {
      const r = await api("/api/chercher?q=" + enc(q));
      if (k !== numero) return;
      liste = r;
      actif = r.length ? 0 : -1;
      res.innerHTML = r.length ? r.map(ligne).join("") : `<span class="muet petit">Aucune carte trouvée.</span>`;
      for (const x of r) if (x.prix != null) x.prixFait = true;
      const manque = r.filter((x) => x.prix == null || !x.fr).map((x) => x.nom);
      if (manque.length) {
        const p = await api("/api/prix", { method: "POST", body: { noms: manque } });
        if (k === numero) majPrix(p);
      }
    } catch (e) { if (k === numero) res.innerHTML = `<span class="erreur">${esc(e.message)}</span>`; }
  };
  const marque = () => $$(".res-carte", res).forEach((el, j) => el.classList.toggle("choisi", j === actif));
  const choisir = (i) => { if (!liste[i]) return; actif = i; marque(); surChoix(liste[i]); };

  champ.addEventListener("input", () => { clearTimeout(minuteur); minuteur = setTimeout(() => chercher(champ.value), 300); });
  champ.addEventListener("keydown", (ev) => {
    if (!liste.length) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      actif = (actif + (ev.key === "ArrowDown" ? 1 : -1) + liste.length) % liste.length;
      marque();
      $$(".res-carte", res)[actif]?.scrollIntoView({ block: "nearest" });
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      choisir(Math.max(0, actif));
    }
  });
  const vider = () => { numero++; clearTimeout(minuteur); champ.value = ""; liste = []; actif = -1; res.innerHTML = ""; champ.focus(); };
  res.addEventListener("click", async (ev) => {
    const p = ev.target.closest("button.res-plus");
    if (p) {
      p.disabled = true;
      if (await surAjout(liste[+p.dataset.plus])) vider();         // carte ajoutée : le champ est prêt pour la suivante
      else { p.disabled = false; champ.focus(); }
      return;
    }
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
  zone.innerHTML = `
    <div class="fiche">
      <div class="fiche-image"><img src="${esc(f.image)}" alt="${esc(f.nom)}">${surVersion ? lienVersion(f.version) : ""}</div>
      <div>
        <h3 style="margin-top:0">${esc(f.nom)} ${mana(f.cout)}</h3>
        ${f.fr ? `<div class="muet">${esc(f.fr)}</div>` : ""}
        <div class="chiffres" style="margin:.5rem 0">
          <span class="badge ${f.trop_cher ? "badge-cher" : "badge-ok"}">${euros(f.prix)}${f.prix_edition ? ` · ${esc(f.prix_edition)}` : ""}</span>
          ${f.gc ? `<span class="badge badge-gc">Game Changer</span>` : ""}
          ${f.legal === "banned" ? `<span class="badge badge-alerte">interdite</span>` : ""}
          ${hors ? `<span class="badge badge-alerte">hors couleurs</span>` : ""}
          ${deja ? `<span class="badge badge-alerte">déjà dans ce deck</span>` : ""}
          ${f.prix_lien ? `<a class="badge" href="${esc(f.prix_lien)}" target="_blank" rel="noopener">Cardmarket ↗</a>` : ""}
        </div>
        <div class="petit muet">${esc(f.type)}</div>
        <div class="texte">${esc(f.texte)}</div>
      </div>
    </div>`;
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
        <label class="petit"><input type="checkbox" id="maybe" ${etat.dernierMaybe ? "checked" : ""}> Maybeboard</label>
      </div>
    </div>
    <div id="journal" class="journal petit"></div>
    <div class="boutons"><button class="btn" id="fermer">Fermer</button><button class="btn btn-accent" id="ok" disabled>${ico("plus")}<span>Ajouter au deck</span></button></div>`, (b) => {
    let choix = null;
    const ajouter = async (nom, edition) => {
      const tags = $("#cat-ajout", b).value.split(",").map((t) => t.trim()).filter(Boolean);
      etat.dernierTags = $("#cat-ajout", b).value;
      etat.dernierMaybe = $("#maybe", b).checked;
      if (etat.dernierMaybe) tags.unshift("Maybeboard");
      const n = Math.max(1, +$("#qte-ajout", b).value || 1);
      const res = await modifier("ajouter", null, { nom, tags, n, edition }, "");
      if (res) $("#journal", b).insertAdjacentHTML("afterbegin",
        `<div>✓ ${n > 1 ? n + "× " : ""}${esc(nom)}${etat.dernierMaybe ? " (Maybeboard)" : ""} · ${res.total} cartes</div>`);
      return res;
    };
    const rech = rechercheCarte($("#rech", b), {
      surAjout: async (x) => {
        const res = await ajouter(x.nom, null);
        if (res) {
          $("#qte-ajout", b).value = 1;
          if (choix && choix.nom === x.nom) {                 // la fiche affichée était celle de cette carte
            choix = null;
            $("#fiche", b).innerHTML = "";
            $("#ok", b).disabled = true;
            $("#ok span", b).textContent = "Ajouter au deck";
          }
        }
        return res;
      },
      surChoix: async (x) => {
        choix = null;
        $("#ok", b).disabled = true;
        try {
          choix = await chargerFiche($("#fiche", b), x.nom, { surVersion: (g) => { choix = g; } });
          $("#ok", b).disabled = false;
          $("#ok span", b).textContent = `Ajouter ${choix.nom}`;
          $("#ok", b).focus();
        } catch (e) { $("#fiche", b).innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
      },
    });
    $("#fermer", b).onclick = fermerModale;
    $("#ok", b).onclick = async () => {
      if (!choix) return;
      $("#ok", b).disabled = true;
      if (!await ajouter(choix.nom, editionVersion(choix.version))) { $("#ok", b).disabled = false; return; }
      choix = null;
      $("#fiche", b).innerHTML = "";
      $("#qte-ajout", b).value = 1;
      $("#ok span", b).textContent = "Ajouter au deck";
      rech.vider();
    };
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
}

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

function diffCourt(v) {
  if (!v.plus.length && !v.moins.length) return `<span class="muet">identique</span>`;
  return (v.plus.length ? `<div><span class="ok">+</span> ${v.plus.map((n) => nc(n)).join(", ")}</div>` : "") +
    (v.moins.length ? `<div><span class="alerte-texte">−</span> ${v.moins.map((n) => nc(n)).join(", ")}</div>` : "");
}

function ligneVersion(v, i) {
  const [lib, cls] = TYPE_VERSION[v.type];
  return `<tr>
    <td><strong>${esc(v.nom)}</strong>${v.type === "ancienne" ? ` <span class="badge ${cls}">${lib}</span>` : ""}<br>
      <span class="muet petit">${v.type === "auto" ? "" : esc(new Date(v.date * 1000).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })) + " · "}${v.total} cartes</span>
      ${v.note ? `<div class="petit">${esc(v.note)}</div>` : ""}</td>
    <td class="petit">${diffCourt(v)}</td>
    <td class="num">
      <button class="btn btn-petit" data-act="comparer" data-i="${i}">${ico("comparer")}Comparer</button>
      <button class="btn btn-petit ecrit" data-act="simuler" data-i="${i}">${ico("simulation")}Simuler</button>
      <button class="btn btn-petit ecrit" data-act="restaurer" data-i="${i}">${ico("annuler")}Restaurer</button>
      ${v.type === "nommee" ? `<button class="btn btn-petit btn-danger ecrit" data-act="supprimer" data-i="${i}">${ico("corbeille")}Supprimer</button>` : ""}
    </td></tr>`;
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

    <div class="panneau">
      <h3 style="margin-top:0">Comparer deux versions</h3>
      <div class="form-ligne">
        <select class="champ" style="flex:1;min-width:200px" id="cmp-a">${optionsVersions(vs, "")}</select>
        <span class="muet">et</span>
        <select class="champ" style="flex:1;min-width:200px" id="cmp-b">${optionsVersions(vs, defautB)}</select>
        <button class="btn" id="btn-cmp">${ico("comparer")}Comparer</button>
      </div>
      <div id="cmp-res"></div>
    </div>

    <h2>Versions</h2>
    ${nommees.length ? `<table class="tableau"><thead><tr><th>Version</th><th>Différences</th><th></th></tr></thead>
      <tbody>${nommees.map((v) => ligneVersion(v, vs.indexOf(v))).join("")}</tbody></table>`
      : `<p class="muet">Aucune version.</p>`}

    ${auto.length ? `<details ${nommees.length ? "" : "open"}><summary>Historique (${auto.length})</summary>
      <table class="tableau" style="margin-top:.5rem"><thead><tr><th>Liste</th><th>Différences</th><th></th></tr></thead>
        <tbody>${auto.map((v) => ligneVersion(v, vs.indexOf(v))).join("")}</tbody></table>
    </details>` : ""}`;

  $("#btn-version").onclick = () => ouvrirModale(`
    <h2>Enregistrer une version</h2>
    <label>Nom<input class="champ" id="v-nom"></label>
    <label style="display:block;margin-top:.6rem">Note<textarea class="champ" id="v-note" rows="3"></textarea></label>
    <div class="boutons"><button class="btn" id="annuler">Annuler</button><button class="btn btn-accent" id="ok">Enregistrer</button></div>`, (b) => {
    $("#annuler", b).onclick = fermerModale;
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

  $$("[data-act]", el).forEach((b) => b.addEventListener("click", async () => {
    const v = vs[+b.dataset.i];
    if (b.dataset.act === "comparer") {
      $("#cmp-a", el).value = "";
      $("#cmp-b", el).value = v.fichier;
      afficheComparaison($("#cmp-res", el), d, "", v.fichier);
      $("#cmp-res", el).scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (b.dataset.act === "simuler") {
      etat.simA = "";
      etat.simB = v.fichier;
      location.hash = `#/deck/${enc(d.id)}/simulation`;
    } else if (b.dataset.act === "restaurer") {
      if (!confirm(`Restaurer « ${v.nom} » ?`)) return;
      try {
        await api(`/api/decks/${enc(d.id)}/restaurer`, { method: "POST", body: { fichier: v.fichier } });
        toast("Version restaurée.");
        location.hash = `#/deck/${enc(d.id)}/liste`;
      } catch (e) { erreur(e); }
    } else if (b.dataset.act === "supprimer") {
      if (!confirm(`Supprimer la version « ${v.nom} » ?`)) return;
      try {
        await api(`/api/decks/${enc(d.id)}/versions/supprimer`, { method: "POST", body: { fichier: v.fichier } });
        ongletVersions(el, d);
      } catch (e) { erreur(e); }
    }
  }));
}

async function afficheComparaison(zone, d, fa, fb) {
  zone.innerHTML = `<p class="chargement">Comparaison…</p>`;
  try {
    const c = await api(`/api/decks/${enc(d.id)}/comparer?a=${enc(fa)}&b=${enc(fb)}`);
    const carte = (n) => {
      const f = c.infos[n] || {};
      return `<div class="ligne" style="grid-template-columns:minmax(0,1fr) auto 4.6rem">
        <span class="nom" data-image="${esc(f.image)}"><span class="en">${esc(n)}</span>${f.fr && f.fr !== n ? `<span class="fr">${esc(f.fr)}</span>` : ""}
          ${f.gc ? `<span class="badge badge-gc">Game Changer</span>` : ""}</span>
        ${mana(f.cout)}<span class="prix ${(f.prix || 0) > BUDGET ? "cher" : ""}">${euros(f.prix)}</span></div>`;
    };
    const colonne = (v, cartes) => `<div>
      <h3>Seulement dans « ${esc(v.nom)} » <span class="muet">(${cartes.length})</span></h3>
      ${cartes.length ? cartes.map(carte).join("") : `<p class="muet">rien</p>`}</div>`;
    zone.innerHTML = `
      <table class="tableau petit" style="margin-top:.8rem">
        <thead><tr><th></th><th>${esc(c.a.nom)}</th><th>${esc(c.b.nom)}</th></tr></thead>
        <tbody>
          <tr><td>Cartes</td><td>${c.a.total}</td><td>${c.b.total}</td></tr>
          <tr><td>Prix</td><td>${euros(c.a.prix)}</td><td>${euros(c.b.prix)}</td></tr>
          <tr><td>Game Changers</td><td>${c.a.gc.map((n) => nc(n)).join(", ") || "aucun"}</td><td>${c.b.gc.map((n) => nc(n)).join(", ") || "aucun"}</td></tr>
          <tr><td>Cartes en commun</td><td colspan="2">${c.communes}</td></tr>
        </tbody>
      </table>
      ${!c.seulement_a.length && !c.seulement_b.length ? `<p class="muet">Mêmes cartes.</p>` :
        `<div class="grille-2">${colonne(c.a, c.seulement_a)}${colonne(c.b, c.seulement_b)}</div>
         <div class="boutons ecrit"><button class="btn btn-accent" id="cmp-sim">${ico("simulation")}Simuler « ${esc(c.a.nom)} » contre « ${esc(c.b.nom)} »</button></div>`}`;
    const b = $("#cmp-sim", zone);
    if (b) b.onclick = () => { etat.simA = fa; etat.simB = fb; location.hash = `#/deck/${enc(d.id)}/simulation`; };
  } catch (e) { zone.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
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
    <details><summary>Comment ça marche</summary>
      ${c.prerequis ? `<p class="petit"><strong>Il faut :</strong> ${esc(c.prerequis)}</p>` : ""}
      ${c.prerequis2 ? `<p class="petit">${esc(c.prerequis2)}</p>` : ""}
      ${c.mana ? `<p class="petit"><strong>Mana :</strong> ${esc(c.mana)}</p>` : ""}
      <p class="petit" style="white-space:pre-wrap">${esc(c.description)}</p>
      ${c.lien ? `<a class="petit" href="${esc(c.lien)}" target="_blank" rel="noopener">Voir sur Commander Spellbook ↗</a>` : ""}
    </details>
  </div>`;
}

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
  return `<div class="combo">
    <div class="combo-ligne">
      <div class="combo-cartes">${fiches.map(nomCombo).join(`<span class="plus">+</span>`)}${(c.autres || []).map((t) =>
        `<span class="plus">+</span><span class="cc-autre" title="N'importe quelle carte de ce genre">${esc(t)}</span>`).join("")}</div>
      <div class="combo-source">${SOURCES[c.source]}${info ? ` · ${info}` : ""}</div>
      <div><span class="classe classe-${esc(c.classe)}">${esc(c.classe_lib)}</span></div>
    </div>
    ${etatCarte ? `<div class="combo-manque petit">${etatCarte}</div>` : ""}
    ${details ? `<details class="combo-details"><summary>${esc(c.titre || (c.resultats || []).join(" · ") || "Comment ça marche")}</summary>
        ${c.explication ? `<p class="petit">${esc(c.explication)}</p>` : ""}
        ${c.prerequis ? `<p class="petit"><strong>Il faut :</strong> ${esc(c.prerequis)}</p>` : ""}
        ${etapes.length ? `<ol class="etapes petit">${etapes.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>` : ""}
        ${lien}</details>` : lien ? `<div class="combo-lien">${lien}</div>` : ""}
  </div>`;
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
    <div id="cb-mtgpics" class="petit ligne-outil"></div>
    <div id="cb-claude" class="petit ligne-outil"></div>`;
  rendreMtgpics($("#cb-mtgpics", zone), d, r.mtgpics, () => vueCombosDeck(zone, d));
  rendreClaude($("#cb-claude", zone), d, r.synergies, () => vueCombosDeck(zone, d));
}

// Combos MTGPics : lues carte par carte (une requête toutes les 1,5 s), gardées 30 jours
function rendreMtgpics(zone, d, st, apres) {
  if (!st) return;
  if (st.actif) {
    zone.innerHTML = `<span class="pulse">●</span> MTGPics : ${st.fait} / ${st.total}…`;
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
  zone.innerHTML = reste
    ? `MTGPics : ${st.connues} / ${st.cartes} cartes lues
       <button class="btn btn-petit" id="btn-mtgpics">Lire ${reste === st.cartes ? "tout" : `les ${reste} autres`} (≈ ${minutes} min)</button>`
    : "";
  if (st.erreur) zone.insertAdjacentHTML("beforeend", ` <span class="erreur">${esc(st.erreur)}</span>`);
  const b = $("#btn-mtgpics", zone);
  if (b) b.onclick = async () => {
    try { rendreMtgpics(zone, d, await api(`/api/decks/${enc(d.id)}/mtgpics`, { method: "POST", body: {} }), apres); }
    catch (e) { erreur(e); }
  };
}

function rendreClaude(zone, d, st, apres) {
  if (st.actif) {
    const duree = (debut) => { const m = debut ? Math.floor((Date.now() / 1000 - debut) / 60) : 0; return m >= 1 ? ` · ${m} min` : ""; };
    zone.innerHTML = `<span class="pulse">●</span> Claude cherche les synergies…<span class="muet" data-duree>${duree(st.debut)}</span>`;
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
  zone.innerHTML = `${st.erreur ? `<span class="erreur">${esc(st.erreur)}</span> ` : ""}
    ${r ? `Synergies Claude du ${new Date(r.date * 1000).toLocaleDateString("fr-FR")}${st.a_jour ? "" : " · la liste a changé"}` : ""}
    <button class="btn btn-petit" id="btn-claude">${ico("discussion")}${r ? "Relancer" : "Chercher les synergies avec Claude"}</button>`;
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
    <div class="segments ecrit" role="group" style="margin-bottom:1rem">
      <button type="button" data-vue="deck">${ico("liste")}Le deck</button>
      <button type="button" data-vue="carte">${ico("cartes")}Une carte</button>
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

function couvertureHtml(v) {
  const c = v.couverture || {};
  const parts = [];
  if (c.corps?.length) parts.push(`${c.corps.length} créature${c.corps.length > 1 ? "s" : ""} jouée${c.corps.length > 1 ? "s" : ""} comme simple corps (${c.corps.map((n) => nc(n)).join(", ")})`);
  if (c.sans_effet?.length) parts.push(`${c.sans_effet.length} sort${c.sans_effet.length > 1 ? "s" : ""} sans effet (${c.sans_effet.map((n) => nc(n)).join(", ")})`);
  if (c.partiel?.length) parts.push(`${c.partiel.length} carte${c.partiel.length > 1 ? "s" : ""} lue${c.partiel.length > 1 ? "s" : ""} en partie (${c.partiel.map((n) => nc(n)).join(", ")})`);
  return parts.length ? `<p class="note petit"><strong>${esc(v.nom)} :</strong> ${parts.join(" ; ")}.</p>` : "";
}

function afficheRapport(zone, r) {
  const A = r.versions.A, B = r.versions.B;
  const lignes = r.tables.map((t) => {
    const x = r.resultats[t];
    return `<tr>
      <td><strong>${esc(t)}</strong></td>
      <td class="num">${pct(x.A.victoire)}</td>
      ${B ? `<td class="num">${pct(x.B.victoire)}</td><td class="num">${ecartHtml(x.ecart)}</td>` : ""}
      <td class="num">T${(x.A.tour_fin ?? 0).toFixed(1).replace(".", ",")}</td>
      <td class="num">${x.A.pv8 == null ? "—" : Math.round(x.A.pv8)}</td>
      <td class="num">${pct(x.A.cmd5, 0)}</td>
    </tr>`;
  }).join("");
  const details = r.tables.map((t) => {
    const x = r.resultats[t];
    const bloc = (cle, v) => {
      const s = x[cle];
      return `<div><h3>${esc(v.nom)}</h3>
        <p class="petit"><strong>Défaites :</strong> ${listeChiffres(s.causes, LIB_SOURCE, (v) => pct(v, 0))}
          · pas finies au tour 15 : ${pct(s.pas_finie, 0)}</p>
        <p class="petit"><strong>Tes dégâts par partie :</strong> ${listeChiffres(Object.fromEntries(Object.entries(s.degats).filter(([k]) => !k.endsWith("_adv"))), LIB_SOURCE, (v) => v.toFixed(1).replace(".", ","))}</p>
        <p class="petit"><strong>Adversaires éliminés par partie :</strong> ${listeChiffres(s.elim, LIB_SOURCE, (v) => v.toFixed(2).replace(".", ","))}</p>
        <p class="petit"><strong>Tes PV perdus par partie :</strong> ${listeChiffres(s.pertes, LIB_SOURCE, (v) => v.toFixed(1).replace(".", ","))}</p>
        <p class="petit"><strong>Par partie :</strong> ${listeChiffres(s.stat, LIB_STAT, (v) => v.toFixed(2).replace(".", ","))}</p>
        <p class="petit"><strong>Commandant lancé :</strong> au tour 4 ${pct(s.cmd4, 0)}, au tour 5 ${pct(s.cmd5, 0)}
          · créatures par adversaire au tour 6 : ${s.crea6 == null ? "—" : s.crea6.toFixed(1).replace(".", ",")}, au tour 8 : ${s.crea8 == null ? "—" : s.crea8.toFixed(1).replace(".", ",")}</p></div>`;
    };
    return `<details><summary>Détails : ${esc(t)}</summary><div class="grille-2">${bloc("A", A)}${B ? bloc("B", B) : ""}</div></details>`;
  }).join("");
  const reg = r.reglages || {};
  zone.innerHTML = `
    <div class="panneau">
      <h2 style="margin-top:0">Rapport du ${esc(new Date(r.date).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }))}</h2>
      <p class="muet petit">${r.n} parties · ${esc(reg.pilote || "vite")}${reg.premier?.length ? ` · en premier : ${reg.premier.map((n) => nc(n)).join(", ")}` : ""}${reg.garder?.length ? ` · gardées pour la salve : ${reg.garder.map((n) => nc(n)).join(", ")}` : ""}</p>
      <p><strong>A</strong> = ${esc(A.nom)}${B ? ` · <strong>B</strong> = ${esc(B.nom)}` : ""}</p>
      ${couvertureHtml(A)}${B ? couvertureHtml(B) : ""}
      <table class="tableau">
        <thead><tr><th>Table</th><th class="num">Victoires A</th>${B ? `<th class="num">Victoires B</th><th class="num">Écart A − B</th>` : ""}
          <th class="num">Fin moyenne</th><th class="num">Tes PV au tour 8</th><th class="num">Commandant au tour 5</th></tr></thead>
        <tbody>${lignes}</tbody>
      </table>
      ${details}
      <div class="boutons ecrit"><button class="btn" id="rap-claude">${ico("discussion")}Expliquer avec Claude</button></div>
    </div>`;
  $("#rap-claude", zone).onclick = () => ouvrirChat(`Explique-moi le rapport de simulation ${r.deck}/simulations/${zone.dataset.fichier || ""} (${A.nom}${B ? " contre " + B.nom : ""}) : qu'est-ce qui ressort, et que me conseilles-tu ?`);
}

function puces(liste, nom) {
  return `<div class="puces">${liste.map((n, i) => `<span class="puce">${nc(n)}<button data-ote="${nom}" data-i="${i}" aria-label="Retirer">✕</button></span>`).join("") || `<span class="muet petit">aucune</span>`}</div>`;
}

async function ongletSimulation(conteneur, d, rapportInitial = null) {
  conteneur.innerHTML = "";
  const el = document.createElement("div");          // zone neuve : pas d'écouteurs en double quand on réaffiche
  conteneur.appendChild(el);
  el.innerHTML = `<p class="chargement">Chargement…</p>`;
  const [o, rapports] = await Promise.all([api(`/api/decks/${enc(d.id)}/simulation/options`), api(`/api/decks/${enc(d.id)}/simulations`)]);
  const R = { ...o.reglages, premier: [...(o.reglages.premier || [])], garder: [...(o.reglages.garder || [])] };
  const choixA = etat.simA ?? "", choixB = etat.simB ?? "__aucune__";
  etat.simA = etat.simB = undefined;
  const cartesDeck = [...new Set(d.cartes.filter((c) => c.cat !== "Maybeboard" && c.cat !== "Commander" && !(c.info.type || "").includes("Land")).map((c) => c.nom))].sort();
  const greven = (d.commandant || "").startsWith("Greven");
  el.innerHTML = `
    <div class="panneau ecrit">
      <div class="grille-2">
        <label>Liste à tester (A)<select class="champ" id="s-a">${optionsVersions(o.versions, choixA)}</select></label>
        <label>Comparer avec (B)<select class="champ" id="s-b">${optionsVersions(o.versions, choixB, true, true)}</select></label>
      </div>
      <fieldset><legend>Tables</legend>
        <div class="cases">${o.tables.map((t) => `<label><input type="checkbox" name="table" value="${esc(t)}" checked> ${esc(t)}</label>`).join("")}</div>
        <div class="form-ligne"><button class="btn btn-petit" id="t-toutes">Toutes</button><button class="btn btn-petit" id="t-mixte">Mixte seule</button></div>
      </fieldset>
      <div class="form-ligne">
        <label>Parties par table
          <select class="champ" id="s-n" style="width:auto">${[200, 500, 1000, 2000, 4000].map((n) => `<option ${n === 2000 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <span class="muet petit" id="s-duree"></span>
      </div>
      <fieldset><legend>Façon de jouer</legend>
        <div class="cases">
          <label><input type="radio" name="pilote" value="vite" ${R.pilote !== "salve" ? "checked" : ""}> tout lancer dès que possible</label>
          <label><input type="radio" name="pilote" value="salve" ${R.pilote === "salve" ? "checked" : ""}> garder ses créatures pour une salve</label>
        </div>
        <details><summary>Réglages avancés</summary>
          <div class="grille-2" style="margin-top:.5rem">
            <label class="petit">Salve : moteur en jeu et au moins <input class="champ" type="number" min="1" max="10" id="r-salve_nb" value="${R.salve_nb}" style="width:4.5rem"> créatures lançables</label>
            <label class="petit">On arrête d'attendre sous <input class="champ" type="number" min="1" max="40" id="r-salve_pv" value="${R.salve_pv}" style="width:4.5rem"> PV</label>
            <label class="petit">… ou au-delà de <input class="champ" type="number" min="1" max="15" id="r-salve_main" value="${R.salve_main}" style="width:4.5rem"> cartes en main</label>
            ${greven ? `<label class="petit">Greven (jeu en salve) : remonter à <input class="champ" type="number" min="1" max="15" id="r-greven_main" value="${R.greven_main}" style="width:4.5rem"> cartes,
              sans passer sous <input class="champ" type="number" min="1" max="40" id="r-greven_pv" value="${R.greven_pv}" style="width:4.5rem"> PV</label>` : ""}
          </div>
          <div class="grille-2" style="margin-top:.6rem">
            <div><div class="petit"><strong>Cartes à poser en premier</strong></div>
              <div id="p-premier">${puces(R.premier, "premier")}</div>
              <select class="champ" id="add-premier" style="margin-top:.3rem"><option value="">+ ajouter une carte…</option>${cartesDeck.map((n) => `<option>${esc(n)}</option>`).join("")}</select></div>
            <div><div class="petit"><strong>Cartes à garder pour une salve</strong></div>
              <div id="p-garder">${puces(R.garder, "garder")}</div>
              <select class="champ" id="add-garder" style="margin-top:.3rem"><option value="">+ ajouter une carte…</option>${cartesDeck.map((n) => `<option>${esc(n)}</option>`).join("")}</select></div>
          </div>
          <div class="form-ligne"><button class="btn btn-petit" id="r-sauver">Enregistrer comme réglages du deck</button>
            <button class="btn btn-petit" id="r-defaut">Revenir aux réglages par défaut</button></div>
        </details>
      </fieldset>
      <div class="boutons"><button class="btn btn-accent" id="s-lancer">${ico("lancer")}Lancer la simulation</button></div>
      <div id="s-prog"></div>
    </div>
    <div id="s-rapport"></div>
    <h2>Rapports enregistrés</h2>
    ${rapports.length ? `<table class="tableau"><thead><tr><th>Date</th><th>Listes</th><th class="num">Victoires</th><th class="num">Écart</th><th></th></tr></thead><tbody>
      ${rapports.map((r, i) => `<tr><td class="petit">${esc(new Date(r.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }))}<br><span class="muet">${r.n} parties · ${r.tables.length} table${r.tables.length > 1 ? "s" : ""} · ${esc(r.pilote)}</span></td>
        <td class="petit">A : ${esc(r.versions.A)}${r.versions.B ? `<br>B : ${esc(r.versions.B)}` : ""}</td>
        <td class="num">${esc(r.table_resume)} : ${pct(r.victoire_a)}${r.victoire_b != null ? ` / ${pct(r.victoire_b)}` : ""}</td>
        <td class="num">${ecartHtml(r.ecart)}</td>
        <td class="num"><button class="btn btn-petit" data-rap="${i}">Ouvrir</button></td></tr>`).join("")}
    </tbody></table>` : `<p class="muet">Aucun rapport.</p>`}`;

  const duree = () => {
    const n = +$("#s-n", el).value, nt = $$("[name=table]:checked", el).length, nv = $("#s-b", el).value === "__aucune__" ? 1 : 2;
    const s = Math.ceil((n * nt * nv * 0.012) / o.coeurs) + 2;
    $("#s-duree", el).textContent = `≈ ${s < 90 ? s + " s" : Math.round(s / 60) + " min"}`;
  };
  el.addEventListener("change", duree);
  duree();
  $("#t-toutes", el).onclick = () => { $$("[name=table]", el).forEach((c) => (c.checked = true)); duree(); };
  $("#t-mixte", el).onclick = () => { $$("[name=table]", el).forEach((c) => (c.checked = c.value === "Mixte")); duree(); };

  const majPuces = () => {
    $("#p-premier", el).innerHTML = puces(R.premier, "premier");
    $("#p-garder", el).innerHTML = puces(R.garder, "garder");
  };
  for (const nom of ["premier", "garder"]) {
    $("#add-" + nom, el).onchange = (ev) => {
      if (ev.target.value && !R[nom].includes(ev.target.value)) R[nom].push(ev.target.value);
      ev.target.value = "";
      majPuces();
    };
  }
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ote]");
    if (b) { R[b.dataset.ote].splice(+b.dataset.i, 1); majPuces(); }
  });
  const lireReglages = () => {
    const r = { ...R, pilote: $("[name=pilote]:checked", el).value };
    for (const k of ["salve_nb", "salve_pv", "salve_main", "greven_main", "greven_pv"]) {
      const c = $("#r-" + k, el);
      if (c) r[k] = +c.value;
    }
    return r;
  };
  $("#r-sauver", el).onclick = async () => {
    try { await api(`/api/decks/${enc(d.id)}/reglages`, { method: "POST", body: lireReglages() }); toast("Réglages enregistrés."); }
    catch (e) { erreur(e); }
  };
  $("#r-defaut", el).onclick = async () => {
    await api(`/api/decks/${enc(d.id)}/reglages`, { method: "POST", body: o.defaut });
    ongletSimulation(conteneur, d);
  };

  $$("[data-rap]", el).forEach((b) => b.addEventListener("click", async () => {
    const f = rapports[+b.dataset.rap].fichier;
    const z = $("#s-rapport", el);
    z.dataset.fichier = f;
    afficheRapport(z, await api(`/api/decks/${enc(d.id)}/simulations/${enc(f)}`));
    z.scrollIntoView({ behavior: "smooth" });
  }));

  if (rapportInitial) {
    const z = $("#s-rapport", el);
    z.dataset.fichier = rapportInitial;
    try { afficheRapport(z, await api(`/api/decks/${enc(d.id)}/simulations/${enc(rapportInitial)}`)); }
    catch (e) { z.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
  }

  $("#s-lancer", el).onclick = async () => {
    const tables = $$("[name=table]:checked", el).map((c) => c.value);
    if (!tables.length) return toast("Choisis au moins une table.");
    const b = $("#s-b", el).value;
    const corps = { a: $("#s-a", el).value, b: b === "__aucune__" ? null : b, tables, n: +$("#s-n", el).value, reglages: lireReglages() };
    if (corps.b !== null && corps.b === corps.a) return toast("Choisis deux listes différentes pour comparer.");
    try {
      const job = await api(`/api/decks/${enc(d.id)}/simulations`, { method: "POST", body: corps });
      suivreSimulation(el, d, job.id);
    } catch (e) { erreur(e); }
  };
}

async function suivreSimulation(el, d, id) {
  const prog = $("#s-prog", el);
  $("#s-lancer", el).disabled = true;
  const tour = async () => {
    let j;
    try { j = await api("/api/jobs/" + id); } catch (e) { prog.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; $("#s-lancer", el).disabled = false; return; }
    if (j.statut === "en_cours") {
      prog.innerHTML = `<div class="barre-prog"><div style="width:${(100 * j.fait / j.total).toFixed(1)}%"></div></div>
        <div class="form-ligne" style="justify-content:space-between;margin:0"><span class="petit muet">${j.fait} / ${j.total} parties${j.reste != null ? ` · encore ${j.reste < 90 ? j.reste + " s" : Math.round(j.reste / 60) + " min"}` : ""}</span>
        <button class="btn btn-petit" id="s-stop">${ico("arreter")}Arrêter</button></div>`;
      $("#s-stop", prog).onclick = () => api(`/api/jobs/${id}/annuler`, { method: "POST" });
      return setTimeout(tour, 700);
    }
    $("#s-lancer", el).disabled = false;
    if (j.statut === "erreur") { prog.innerHTML = `<p class="erreur">${esc(j.erreur)}</p>`; return; }
    if (j.statut === "annule") { prog.innerHTML = `<p class="muet">Simulation arrêtée.</p>`; return; }
    prog.innerHTML = "";
    const z = $("#s-rapport", el);
    z.dataset.fichier = j.rapport;
    afficheRapport(z, await api(`/api/decks/${enc(d.id)}/simulations/${enc(j.rapport)}`));
    z.scrollIntoView({ behavior: "smooth" });
    toast("Simulation terminée.");
  };
  tour();
}


// ------------------------------------------------------------------ recherche de cartes (moteur façon Magic-Ville)
// Mêmes fenêtres et mêmes règles que le moteur de Magic-Ville ; la recherche se fait sur la base locale (recherche.py).
// Les critères vivent dans l'adresse (#/recherche?…) : précédent / suivant du navigateur, favoris, plusieurs onglets.
const RCH_DEFAUTS = { fr: "1", en: "1", cm: "1", tm: "1", mvx: "1", fx: "1", ex: "1", format: "commander", ordre: "couleur" };
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
  for (const k of ["doit", "peut", "mult", "img", "versions", "fun"]) delete c[k];      // critères retirés du formulaire (anciennes adresses)
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

const cleDerniere = (deck) => "rch-derniere" + (deck ? ":" + deck : "");

// ---- fenêtres du formulaire
function rchSymboles(groupe, valeur, lettres = "WUBRG") {
  return `<div class="rch-symboles" data-groupe="${groupe}" role="group">${[...lettres].map((k) => {
    const on = (valeur || "").includes(k);
    return `<button type="button" class="rch-sym ${on ? "actif" : ""}" data-k="${k}" aria-pressed="${on}" title="${esc(NOMS_COULEURS[k] || k)}">${symbole(k)}</button>`;
  }).join("")}</div>`;
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
    </div>
    <div class="form-ligne" style="justify-content:flex-end;margin:1rem 0 0"><button type="button" class="btn" data-act="fermer">Fermer</button></div>`,
  (b) => {
    $$("[data-exemple]", b).forEach((x) => {
      x.onclick = () => { form.elements.texte.value = x.dataset.exemple; fermerModale(); form.elements.texte.focus(); };
    });
    $('[data-act="fermer"]', b).onclick = fermerModale;
  }, { focus: false, large: true });
}

// la disposition du moteur de Magic-Ville, simplifiée : Couleurs (coût compris) | Types | Recherche texte,
// puis Valeur de mana, Force, Endurance, Rechercher, Format, Rareté ; en dessous, ce que l'Atelier ajoute, puis les éditions
function formulaireRecherche(c) {
  const d = rch.deck;
  return `<form id="moteur" class="moteur" autocomplete="off">
    <div class="mt-rang mt-haut">
      <section class="fen fen-couleurs"><h3 class="fen-titre">Couleurs</h3>
        ${rchSymboles("coul", c.coul, "WUBRGC")}
        <div class="rch-cases rch-centre">${rchRadio("cm", "1", "Au moins une", c)}${rchRadio("cm", "2", "Toutes", c)}${rchCase("seules", "Uniquement celle(s) choisie(s)", c)}</div>
        <div class="rch-cases rch-entre">${rchCase("id", "Id. couleur", c)}${d && d.identite ? `<button type="button" class="lien-discret" data-act="identite" title="Couleurs du commandant et incolores">Couleurs de ${esc(d.titre)} ${identiteHtml(d.identite)}</button>` : ""}</div>
        <div class="rch-cases rch-entre rch-cout">
          <label class="rch-ligne-champ">Coût ${rchChamp("cout", c, 'placeholder="2BR, U?, 1**" size="9" title="Chiffres = mana générique ; ? = un mana générique quelconque ; * = un mana coloré quelconque ; l\'hybride compte pour ses deux couleurs"')}</label>
          ${rchCase("un", "Un seul symbole par couleur", c)}
        </div>
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
    <div class="mt-pied"><button class="btn btn-accent" type="submit">${ico("chercher")}Rechercher</button></div>
  </form>`;
}

// ---- lire le formulaire
function lireFormulaire(form) {
  const c = {};
  const val = (n) => (form.elements[n] ? form.elements[n].value.trim() : "");
  for (const n of ["nom", "type", "texte", "cout", "mv", "mvmax", "mvmin", "f", "fmax", "fmin", "e", "emax", "emin", "prixmax", "prixmin", "spe", "spt", "gc", "cmd"]) c[n] = val(n);
  c.fn = (rch.fns || []).join(",");
  for (const n of ["fr", "en", "vanilla", "seules", "id", "un", "mvx", "pair", "impair", "fx", "ex", "neuves", "horsdeck"]) {
    const el = form.elements[n];
    c[n] = el && el.checked ? "1" : "";
  }
  c.cm = (form.querySelector('input[name="cm"]:checked') || {}).value || "1";
  c.tm = (form.querySelector('input[name="tm"]:checked') || {}).value || "1";
  c.types = $$('input[name="types"]:checked', form).map((x) => x.value).join(",");
  for (const g of $$(".rch-symboles[data-groupe], .rch-bascules[data-groupe]", form)) {
    const on = $$(".actif", g).map((b) => b.dataset.k);
    c[g.dataset.groupe] = g.dataset.unique ? (on[0] || "") : on.join("");
  }
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
  if (c.cout) r.push(`Coût : ${c.cout}`);
  if (c.un === "1") r.push("Un seul symbole par couleur");
  if (c.coul) r.push(`Couleurs ${[...c.coul].join(" ")}${c.id === "1" ? " (identité)" : ""}${c.seules === "1" ? ", uniquement" : ""}${c.cm === "2" ? ", toutes" : ""}`);
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
  // la page sans critère : le formulaire, avec les critères de la dernière recherche du même genre. Lien du haut : la
  // dernière recherche sans deck ; bouton « Chercher des cartes » d'un deck : la dernière recherche pour ce deck
  const deckDemande = params.get("deck") || "";
  if ([...params.keys()].every((k) => k === "deck")) {
    let derniere = new URLSearchParams(PREF.get(cleDerniere(deckDemande), ""));
    if ((derniere.get("deck") || "") !== deckDemande) derniere = new URLSearchParams();   // mémorisée pour un autre deck
    derniere.delete("r");                          // le formulaire, prérempli, sans relancer la recherche
    derniere.delete("page");
    if ([...derniere.keys()].length) {
      history.replaceState(null, "", "#/recherche?" + derniere);
      params = derniere;
    }
  }
  const neuve = [...params.keys()].every((k) => k === "deck");
  scrollTo(0, 0);
  const c = critDepuis(params);
  c.deck = c.deck || "";                           // pas de deck dans l'adresse : recherche sans deck
  etat.deck = null;
  let [ds, fonctions] = await Promise.all([listeDecks(), rch.fonctions ? rch.fonctions : api("/api/recherche/fonctions").catch(() => [])]);
  rch.fonctions = fonctions;
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
      <nav class="fil" aria-label="Fil d'Ariane"><a href="#/">Mes decks</a><span aria-hidden="true">›</span>${rch.deck ? `<a href="#/deck/${enc(rch.deck.id)}">${esc(rch.deck.titre)}</a><span aria-hidden="true">›</span>` : ""}<span aria-current="page">Recherche de cartes</span></nav>
      <div class="rch-deck">
        <label class="petit muet" for="rch-deck">Pour le deck</label>
        <select class="champ champ-petit" id="rch-deck">
          <option value="">— aucun —</option>
          ${[...ds].sort((a, b) => recence(b) - recence(a) || a.titre.localeCompare(b.titre)).map((d) =>
            `<option value="${esc(d.id)}" ${d.id === c.deck ? "selected" : ""}>${esc(d.titre)}</option>`).join("")}
        </select>
        <span id="rch-deck-info" class="petit muet"></span>
      </div>
    </div>
    <div id="rch-form"></div>
    <div id="rch-resultats"></div>`;
  majInfosDeck();
  $("#rch-deck").onchange = async (ev) => {
    const id = ev.target.value;
    if (id) choisirDiscussion(id);                 // chercher pour un autre deck : sa discussion suit
    const nc = { ...rch.crit, deck: id };
    if (!id) delete nc.horsdeck;
    const form = $("#moteur");
    if (form && rch.ouvert) Object.assign(nc, lireFormulaire(form), { deck: id, r: rch.crit.r, ordre: rch.crit.ordre, sens: rch.crit.sens, vue: rch.crit.vue });
    rch.ouvrir = rch.ouvert;
    location.hash = "#/recherche?" + critVersHash(nc);
  };
  rendreFormulaire();
  if (c.r === "1") await lancerRecherche();
}

// page partagée : la recherche et la discussion en vitrine, grisées, avec le lien pour installer l'Atelier chez soi
function invitation(titre, texte) {
  return `<div class="vitrine-invite panneau">
    <h2>${esc(titre)}</h2>
    <p>${esc(texte)}</p>
    ${PARTAGE.atelier ? `<a class="btn btn-accent" href="${esc(PARTAGE.atelier)}" target="_blank" rel="noopener">${ico("telecharger")}Télécharger l'Atelier MTG</a>` : ""}
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
      <nav class="fil" aria-label="Fil d'Ariane"><a href="${esc(PARTAGE.accueil === true ? "#/" : PARTAGE.accueil)}">${esc(MES_DECKS)}</a><span aria-hidden="true">›</span>${PARTAGE.deck ? `<a href="#/">${esc(PARTAGE.deck.replace(/^Deck /, ""))}</a><span aria-hidden="true">›</span>` : ""}<span aria-current="page">Recherche de cartes</span></nav>
    </div>
    <div class="vitrine">
      <div class="vitrine-fond" inert aria-hidden="true">${formulaireRecherche(rch.crit)}</div>
      ${invitation("Recherche de cartes", "Disponible dans l'Atelier MTG, à installer gratuitement sur son ordinateur.")}
    </div>`;
}

// « C'est quoi, l'Atelier MTG ? » : la page qui présente l'outil aux visiteurs d'une page partagée (bandeau et pied de page).
// L'histoire est celle de l'auteur de l'Atelier, pas forcément celle de la personne qui partage ses decks.
const AUTEUR_ATELIER = "PierreRibeaucourt";
const DEPOT_ATELIER = "https://github.com/PierreRibeaucourt/atelier-mtg";
// les captures de la page : sur le site de decks de l'auteur, pas dans le dépôt de code (on y voit des cartes et une discussion)
const CAPTURES_ATELIER = "https://pierreribeaucourt.github.io/decks/a-propos/";
const MODULES_ATELIER = [
  ["decks", "Vos decks, à votre façon", "Créez, importez et éditez vos decks comme partout, avec une vue personnalisable : liste ou visuel, taille des cartes, rangement par type, par tag ou par fonction."],
  ["versions", "Versions et historique", "Chaque modification est gardée. Enregistrez des versions, comparez deux listes, revenez en arrière."],
  ["statistiques", "Statistiques et base de mana", "Courbe de mana, types, fonctions des cartes et surtout la répartition des sources de couleur : elle compte les terrains et les cartes de ramp, et dit si chaque couleur est confortable."],
  ["combos", "Combos", "Les combos du deck sont repérées automatiquement, en croisant plusieurs sources : MTGPics (la base de Magic-Ville) et Commander Spellbook."],
  ["bracket", "Bracket", "Le bracket est estimé automatiquement selon les règles officielles : Game Changers, combos infinies à deux cartes, tuteurs… et comparé à l'estimation de Commander Spellbook."],
  ["discussion", "Discussion avec Claude", "Facultative, à droite de l'écran : Claude connaît vos decks et aide à catégoriser les cartes, faire un cut, chercher des idées ou vérifier une interaction."],
  ["jouer", "Table de jeu", "Jouez vos decks en solo pour tester les mains de départ et les premiers tours : pioche, mulligan, jetons, marqueurs, planeswalkers, tout au clic ou au glisser."],
  ["recherche", "Recherche avancée", "Une recherche multicritère comme celle de Magic-Ville, avec en plus un filtre de prix Cardmarket et une catégorisation automatique des cartes : ramp, pioche, tuteur, removal…"],
];

function vueAPropos() {
  scrollTo(0, 0);
  etat.deck = null;
  const depot = esc((PARTAGE && PARTAGE.atelier) || DEPOT_ATELIER);
  const retour = `<a href="${PARTAGE && PARTAGE.page ? esc(PARTAGE.accueil) : "#/"}">${esc(MES_DECKS)}</a><span aria-hidden="true">›</span>`;
  const capture = (f, alt) => `<img src="${PARTAGE ? CAPTURES_ATELIER : "/a-propos/"}${f}.webp" data-f="${f}" alt="${esc(alt)}"`;
  const consigne = `Installe et lance l'Atelier MTG depuis ${(PARTAGE && PARTAGE.atelier || DEPOT_ATELIER).replace("https://", "")}`;
  const fonction = (titre, texte) => `<div class="ap-carte"><h3>${titre}</h3><p>${texte}</p></div>`;
  vue.innerHTML = `
    <article class="a-propos">
      <nav class="fil" aria-label="Fil d'Ariane">${retour}<span aria-current="page">L'Atelier MTG</span></nav>
      <h1>L'Atelier MTG</h1>
      ${versionAtelier ? `<p class="ap-signature">Version ${esc(versionAtelier)}</p>` : ""}
      <p class="chapeau">Le gestionnaire de decks Commander local, sans compte et taillé pour le deckbuilding assisté.</p>
      <p>L'Atelier est une application locale, qui s'ouvre dans votre navigateur, pensée pour concevoir, tester et faire évoluer
        des decks Magic: The Gathering en Commander. Pas de publicité, aucun compte en ligne, pas de données hébergées sur un
        serveur distant : tout s'exécute directement sur votre ordinateur.</p>
      <figure class="ap-une">${capture("atelier", "L'Atelier MTG : vos decks Commander, de la liste à la table")}></figure>

      <h2>Ce qui fait la différence</h2>
      ${MODULES_ATELIER.map(([f, titre, texte]) => `<section class="ap-module">
        <h3>${esc(titre)}</h3><p>${esc(texte)}</p>
        <figure>${capture(f, titre)} loading="lazy"></figure>
      </section>`).join("")}

      <h2>Et aussi</h2>
      <div class="ap-grille">
        ${fonction("Import en un collage", "Une liste copiée depuis Moxfield, Archidekt ou MTG Arena devient un deck, rangé par catégories.")}
        ${fonction("Prix et budget", "Prix Cardmarket du jour pour chaque carte et chaque deck, avec une alerte au-delà de votre budget par carte.")}
        ${fonction("Simulations", "Un simulateur multijoueur joue des centaines de parties pour mesurer la régularité d'un deck et comparer deux versions.")}
        ${fonction("Partage simplifié", "Publication en un clic d'une page de présentation légère, comme celle-ci, à partager avec votre groupe de jeu.")}
      </div>

      <h2>Philosophie : local, ouvert et transparent</h2>
      <ul class="ap-principes">
        <li><strong>Open source et gratuit.</strong> Le code est publié sous <a href="${depot}/blob/main/LICENSE" target="_blank" rel="noopener">licence MIT</a> :
          accessible, vérifiable et modifiable par tous sur GitHub.</li>
        <li><strong>Données souveraines.</strong> Vos decks restent sur votre disque dur et rien n'est collecté. Seules sortent les
          requêtes nécessaires : données, images et prix des cartes (Scryfall), combos et bracket (Commander Spellbook, MTGPics),
          la discussion avec Claude si vous l'utilisez, et les pages que vous choisissez de partager.</li>
        <li><strong>IA strictement modulaire.</strong> Tri, statistiques, simulations et jeu en solo restent 100 % opérationnels
          sans aucune configuration IA.</li>
      </ul>

      <h2>Installation</h2>
      <p>Le dépôt de code et les instructions détaillées sont sur GitHub, testés et validés sous Windows.</p>
      <p><a class="btn btn-accent" href="${depot}" target="_blank" rel="noopener">${ico("telecharger")}Télécharger l'Atelier MTG</a>
        <a class="ap-depot" href="${depot}" target="_blank" rel="noopener">${depot.replace("https://", "")}</a></p>
      <h3>Démarrage rapide, avec un assistant IA</h3>
      <p>Si vous utilisez un agent de développement (Claude Code, Cursor, Copilot…), collez simplement cette consigne :</p>
      <div class="ap-consigne"><code>${esc(consigne)}</code>
        <button type="button" class="btn btn-petit btn-discret" id="ap-copier">${ico("copier")}Copier</button></div>

      <h2>Genèse du projet</h2>
      <p class="ap-signature">Par ${esc(AUTEUR_ATELIER)}, créateur de l'Atelier</p>
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
      <p>L'Atelier est né de cette synthèse : une interface locale fluide pour gérer ses cartes, connectable à la demande à un
        assistant IA pour auditer un deck, automatiser le classement ou simuler des parties.</p>
    </article>`;
  $$(".a-propos img[data-f]").forEach((img) => {
    img.onerror = () => {                       // dans l'Atelier : la capture de ce PC, sinon celle du site de l'auteur
      if (!PARTAGE && !img.dataset.enLigne) { img.dataset.enLigne = "1"; img.src = CAPTURES_ATELIER + img.dataset.f + ".webp"; }
      else img.closest("figure").remove();                           // hors ligne, ou capture introuvable : le texte suffit
    };
    if (img.closest(".ap-module")) img.onclick = () => zoomer(img);
  });
  $("#ap-copier").onclick = async () => {
    try { await navigator.clipboard.writeText(consigne); toast("Consigne copiée."); } catch (e) { erreur(e); }
  };
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
  return { coul: lettresWUBRG(d.identite.join(""), "WUBRG") + "C", cm: "1", seules: "1", id: "1", format: "commander" };
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
  form.addEventListener("submit", (ev) => { ev.preventDefault(); soumettre(form); });
  form.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && ev.target.name === "texte") { ev.preventDefault(); soumettre(form); }
  });
  form.addEventListener("click", (ev) => {
    const s = ev.target.closest(".rch-sym, .rch-bascule:not([data-fn])");
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
      $$('.rch-symboles[data-groupe="coul"] .rch-sym', form).forEach((b) => { const on = id.coul.includes(b.dataset.k); b.classList.toggle("actif", on); b.setAttribute("aria-pressed", on); });
      form.querySelector('input[name="cm"][value="1"]').checked = true;
      form.elements.seules.checked = true;
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
  try { r = await api("/api/recherche?" + tout); }
  catch (e) {
    if (k !== rch.numero) return;
    if (/pas encore prête/.test(e.message)) return attendreBase(z);
    z.innerHTML = `<p class="erreur">${esc(e.message)}</p>`;
    return;
  }
  if (k !== rch.numero) return;
  rch.res = r;
  memoriser();
  rendreResultats(z, r);
}

// la dernière recherche : sans deck pour le lien du haut, et celle de chaque deck (bouton « Chercher des cartes » du deck)
function memoriser() {
  PREF.set(cleDerniere(rch.crit.deck || ""), critVersHash(rch.crit));
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
      <h3>La base de cartes se construit</h3>
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
        <label class="petit muet">Trier par <select class="champ champ-petit" id="rch-tri">${RCH_TRIS.map(([k, l]) => `<option value="${k}" ${c.ordre === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <button class="btn btn-petit" id="rch-sens" title="Inverser l'ordre">${sens === "desc" ? "↓" : "↑"}</button>
      </div>
    </div>
    ${r.total ? `<div class="rch-liste ${vueImages ? "etale" : "avec-images"}">${r.cartes.map((x, i) => (vueImages ? carteImageRch(x, i) : ligneRch(x, i))).join("")}</div>`
      : `<div class="panneau vide"><p>Aucune carte.</p></div>`}
    <div class="rch-bas">${paginationRch(r)}</div>
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
    memoriser();
    rendreResultats(z, r);
  }));
  $("#rch-tri", z).onchange = (ev) => { location.hash = "#/recherche?" + critVersHash({ ...rch.crit, ordre: ev.target.value, sens: "", page: "" }); };
  $("#rch-sens", z).onclick = () => {
    const def = RCH_TRI_DESC[rch.crit.ordre] ? "desc" : "asc";
    const nouveau = sens === "desc" ? "asc" : "desc";
    location.hash = "#/recherche?" + critVersHash({ ...rch.crit, sens: nouveau === def ? "" : nouveau, page: "" });
  };
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
  return `Base du ${heureCourte(b.date)} · <button type="button" class="lien-discret" data-act="maj-base">Mettre à jour</button>
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

function ligneRch(x, i) {
  const cher = (x.prix || 0) > BUDGET;
  const typeAff = rch.crit.fr !== "" && x.type_fr ? x.type_fr : x.type;
  return `<article class="rch-carte" data-i="${i}">
    <button type="button" class="rch-vignette" data-act="ouvrir" data-image="${esc(x.image)}" data-legende="${esc(`${x.fr || x.nom} — ${prixRch(x)}`)}" ${cher ? 'data-cher="1"' : ""} aria-label="Fiche de ${esc(x.nom)}">
      ${x.petite ? `<img src="${esc(x.petite)}" alt="" loading="lazy">` : `<span class="sans-image">${esc(x.nom)}</span>`}</button>
    <div class="rch-corps">
      <div class="rch-haut">
        <div class="rch-noms" data-image="${esc(x.image)}" data-legende="${esc(`${x.fr || x.nom} — ${prixRch(x)}`)}" ${cher ? 'data-cher="1"' : ""}><button type="button" class="rch-nom" data-act="ouvrir">${esc(x.nom)}</button>${x.fr && x.fr !== x.nom ? `<span class="rch-vf">${esc(x.fr)}</span>` : ""}</div>
        ${mana(x.cout)}
      </div>
      <div class="rch-type">${esc(typeAff)}${x.pt ? ` <span class="rch-pt">${esc(x.pt)}</span>` : ""}</div>
      ${x.texte || x.texte_fr ? `<div class="rch-texte fs-texte">${texteCarteRch(x)}</div>` : ""}
      <div class="rch-pied">
        <a class="prix ${cher ? "cher" : ""}" href="${esc(lienCardmarket(x.nom))}" target="_blank" rel="noopener" title="Cardmarket">${prixRch(x)}</a>
        <span class="rch-badges">${badgesRch(x)}</span>
        <span class="rch-actions">${etatDeckRch(x)}</span>
      </div>
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
    <div class="rf-ajout-tete">
      <span>${promotion ? `Au Maybeboard de <strong>${esc(d.titre)}</strong>` : `Ajouter à <strong>${esc(d.titre)}</strong>`}</span>
      ${promotion ? "" : `<div class="segments" role="group" aria-label="Où ajouter la carte">${[["deck", "Deck"], ["maybe", "Maybeboard"]].map(([k, l]) =>
        `<button type="button" data-dest="${k}" class="${k === dest ? "actif" : ""}" aria-pressed="${k === dest}">${l}</button>`).join("")}</div>`}
    </div>
    <div class="rf-ajout-ligne">
      ${promotion ? "" : `
        <input class="champ champ-petit" id="rf-tags" list="rf-cats" placeholder="Tags" aria-label="Tags, séparés par des virgules">
        <datalist id="rf-cats">${(d.categories || []).map((t) => `<option value="${esc(t)}">`).join("")}</datalist>`}
      ${multi && !promotion ? `<label class="petit muet rf-n">Exemplaires <input class="champ champ-petit" type="number" id="rf-n" min="1" max="99" value="1"></label>` : ""}
      <button class="btn btn-accent" data-act="ajouter">${libelleAjout(x, dest)}</button>
    </div>
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
          <button type="button" class="lien-discret" data-act="version">${x.versions > 1 ? `${x.versions} versions` : "Changer la version"}</button>
        </div></div>
      <div class="fc-infos">
        <div class="fc-tete">
          <div><h2>${esc(x.fr || x.nom)} ${mana(x.cout)}</h2>${x.fr && x.fr !== x.nom ? `<div class="muet">${esc(x.nom)}</div>` : ""}</div>
          <button class="btn btn-discret btn-icone" data-act="fermer" aria-label="Fermer">${ico("fermer")}</button>
        </div>
        <div class="petit muet">${esc(x.type_fr || x.type)}${x.pt ? " · " + esc(x.pt) : ""}</div>
        <div class="chiffres" id="rf-prix">
          <span class="badge ${cher ? "badge-cher" : ""}" id="rf-prix-badge" title="Le moins cher, toutes éditions (prix Cardmarket du jour)">${prixRch(x)}</span>
          ${badgesRch(x, d)}
        </div>
        <div id="rf-assemble"></div>
        ${x.texte_fr || x.texte ? `<div class="texte fs-texte">${texte(x.texte_fr || x.texte)}</div>` : ""}
        ${x.texte_fr && x.texte ? `<details class="petit"><summary>Texte anglais</summary><div class="fs-texte" style="margin-top:.4rem">${texte(x.texte)}</div></details>` : ""}
        ${d ? blocAjoutRch(x, d) : ""}
        <div class="fc-liens">
          ${d ? `<a href="#/deck/${enc(d.id)}/combos/${enc(x.nom)}">${ico("combos")}Combos avec cette carte</a>` : ""}
          <a href="${esc(lienCardmarket(x.nom))}" id="rf-cardmarket" target="_blank" rel="noopener">${ico("panier")}Cardmarket ↗</a>
          <a href="${esc(lienGatherer(x.nom))}" id="rf-gatherer" target="_blank" rel="noopener">${ico("livre")}Gatherer ↗</a>
        </div>
        ${liste.length > 1 ? `
          <div class="fc-nav">
            <button class="btn btn-petit" data-act="prec" ${i === 0 ? "disabled" : ""}>${ico("precedent")}Précédente</button>
            <span class="muet petit">${i + 1} / ${liste.length}</span>
            <button class="btn btn-petit" data-act="suiv" ${i === liste.length - 1 ? "disabled" : ""}>Suivante${ico("suivant")}</button>
          </div>` : ""}
      </div>
    </div>`, (b) => {
    let dest = x.dans === "maybe" ? "deck" : PREF.get("rf-dest", "deck");
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
        if (res) ficheRecherche(i, ctx); else a.disabled = false;
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
async function suivreMaj() {
  try {
    const e = await api("/api/etat");
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
      <textarea id="chat-saisie" placeholder="Ton message…"></textarea>
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
  b.innerHTML = ico("discussion") + `<span class="txt">${esc(!actives.length ? "Discussion"
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

$("#btn-chat").addEventListener("click", () => basculeChat());
if (!PARTAGE) {
  chat.contexte = deckDeLaPage();
  chat.cle = chat.contexte ?? PREF.get("chat-discussion", "");
  window.addEventListener("hashchange", changerDiscussion);
  document.addEventListener("visibilitychange", retourOnglet);
  window.addEventListener("focus", retourOnglet);
  try { if (localStorage.getItem("chat-ouvert")) basculeChat(true); } catch (_) {}
  api("/api/discussion/en-cours").then((s) => { if (s.actives.length) suivreChat(); }).catch(() => {});   // une réponse tournait déjà
}

route();
if (!PARTAGE) suivreMaj();

// nouvelle version de l'Atelier (mise_a_jour.py) : un bandeau propose de l'installer ; l'Atelier redémarre et la page se recharge
async function verifierVersion() {
  let v;
  try { v = await api("/api/version"); } catch (_) { return; }
  versionAtelier = v.version;
  const d = v.disponible;
  if (!d || $("#bandeau-maj")) return;
  try { if (sessionStorage.getItem("maj-plus-tard") === d.version) return; } catch (_) {}
  $(".barre").insertAdjacentHTML("afterend", `<div class="bandeau-maj" id="bandeau-maj">
    <p><strong>Atelier ${esc(d.version)} disponible</strong>${d.nouveautes ? ` · ${esc(d.nouveautes)}` : ""}</p>
    <div class="maj-actions">
      <button class="btn btn-accent btn-petit" id="maj-installer">${ico("telecharger")}Mettre à jour</button>
      <button class="btn btn-petit btn-discret" id="maj-plus-tard">Plus tard</button>
    </div>
  </div>`);
  const b = $("#bandeau-maj"), actions = $(".maj-actions", b);
  $("#maj-plus-tard").onclick = () => { try { sessionStorage.setItem("maj-plus-tard", d.version); } catch (_) {} b.remove(); };
  $("#maj-installer").onclick = async () => {
    actions.innerHTML = `<span class="chargement">Mise à jour…</span>`;
    try {
      const r = await api("/api/mise-a-jour", { method: "POST", body: {} });
      actions.innerHTML = `<span class="chargement">Redémarrage…</span>`;
      for (let i = 0; i < 90; i++) {
        await attendre(1000);
        try { if ((await api("/api/version")).version === r.version) return location.reload(); } catch (_) {}
      }
      actions.innerHTML = `<span class="erreur petit">L'Atelier ne redémarre pas : relance-le depuis le raccourci du bureau.</span>`;
    } catch (e) {
      actions.innerHTML = `<span class="erreur petit">${esc(e.message || e)}</span>`;
    }
  };
}
if (!PARTAGE) {
  verifierVersion();
  setTimeout(verifierVersion, 30000);                // l'Atelier lit le dépôt quelques secondes après son lancement
  setInterval(verifierVersion, 3 * 3600 * 1000);
}
