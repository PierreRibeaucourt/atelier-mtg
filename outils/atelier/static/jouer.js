// Jouer tout seul : le playtester de l'Atelier (page /jouer?deck=…), à part du reste de l'interface.
// Tout est manuel, comme sur Archidekt : on déplace les cartes, on les engage, on pioche ; rien n'applique les règles.
// L'état de la partie est un simple objet (E). Chaque action en garde une copie (Annuler, Rétablir) et écrit une ligne
// au journal. La partie en cours reste dans le navigateur : recharger la page la reprend.
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const DECK = new URLSearchParams(location.search).get("deck") || "";
const CLE = "partie-" + DECK;
const ZONES = ["bibliotheque", "main", "champ", "cimetiere", "exil", "commandement"];
const NOM_ZONE = { bibliotheque: "Bibliothèque", main: "Main", champ: "Champ de bataille", cimetiere: "Cimetière", exil: "Exil", commandement: "Commandement" };
const DEPUIS = { bibliotheque: "de la bibliothèque", cimetiere: "du cimetière", exil: "de l'exil", commandement: "de la zone de commandement" };
const MANA = [["W", "Blanc"], ["U", "Bleu"], ["B", "Noir"], ["R", "Rouge"], ["G", "Vert"], ["C", "Incolore"]];
const RATIO = 88 / 63;                                    // hauteur / largeur d'une carte
const ICO = {
  retour: '<svg class="ico" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  points: '<svg class="ico" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/></svg>',
  annuler: '<svg class="ico" viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  retablir: '<svg class="ico" viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  fermer: '<svg class="ico" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

let deck = null;            // la liste du deck, telle que l'Atelier la donne (/api/decks/…)
let parIndex = new Map();   // index d'une carte du deck -> sa fiche
let jetons = null;          // jetons que créent les cartes du deck (null : pas encore arrivés)
let signature = "";         // la liste jouée : une partie gardée ne reprend que si le deck n'a pas changé
let E = null;               // état de la partie
let passe = [], futur = []; // annuler / rétablir
let survol = null;          // carte sous la souris (raccourcis clavier)
let g = null;               // carte en train d'être glissée
const T = { c: 96, m: 130, p: 86 };   // largeur des cartes : champ de bataille, main, piles

try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (_) {}

// ------------------------------------------------------------------ données
async function api(url) {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erreur || r.statusText);
  return d;
}

const enJeu = (c) => c.cat !== "Maybeboard";

async function demarrer() {
  if (!DECK) throw new Error("Aucun deck choisi.");
  deck = await api("/api/decks/" + encodeURIComponent(DECK));
  parIndex = new Map(deck.cartes.map((c) => [c.index, c]));
  signature = deck.cartes.filter(enJeu).map((c) => `${c.n} ${c.nom}`).join("|");
  document.title = `Jouer · ${deck.titre} — Atelier MTG`;
  tailles();
  montageHaut();
  E = reprendre() || nouvelEtat();
  sauver();
  dessiner();
  api("/api/jouer/jetons?deck=" + encodeURIComponent(DECK))
    .then((r) => { jetons = r.jetons; }).catch(() => { jetons = []; });
}

function nouvelEtat() {
  const e = { tour: 1, vie: 40, mana: Object.fromEntries(MANA.map(([x]) => [x, 0])), mulligans: 0, revele: false, n: 0, zmax: 0,
    cartes: {}, zones: Object.fromEntries(ZONES.map((z) => [z, []])), journal: ["Nouvelle partie"] };
  for (const c of deck.cartes.filter(enJeu))
    for (let k = 0; k < (c.n || 1); k++) {
      const id = "c" + ++e.n;
      e.cartes[id] = { id, ref: c.index };
      e.zones[c.cat === "Commander" ? "commandement" : "bibliotheque"].push(id);
    }
  melanger(e.zones.bibliotheque);
  e.zones.main = e.zones.bibliotheque.splice(0, 7);
  return e;
}

function melanger(t) {
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [t[i], t[j]] = [t[j], t[i]];
  }
  return t;
}

function sauver() { try { localStorage.setItem(CLE, JSON.stringify({ signature, E })); } catch (_) {} }
function reprendre() {
  try {
    const s = JSON.parse(localStorage.getItem(CLE) || "null");
    return s && s.signature === signature && s.E && s.E.zones ? s.E : null;
  } catch (_) { return null; }
}

// ------------------------------------------------------------------ ce qu'on sait d'une carte en jeu
const fiche = (c) => c.jeton || (parIndex.get(c.ref) || {}).info || {};
function nomDe(c) {
  if (c.jeton) return c.jeton.nom;
  const d = parIndex.get(c.ref) || {};
  return (d.info && d.info.fr) || d.nom || "?";
}
const nomAnglais = (c) => (c.jeton ? c.jeton.nom : (parIndex.get(c.ref) || {}).nom || "");
const verso = (c) => (!c.jeton && fiche(c).dos) || null;
const imageDe = (c) => (c.retournee && verso(c) ? verso(c).image : fiche(c).image) || "";
const typeDe = (c) => (c.retournee && verso(c) ? verso(c).type : fiche(c).type) || "";
const estJeton = (c) => !!(c.jeton || c.copie);

// force/endurance en jeu, quand des marqueurs ou un modificateur la changent
function ptActuel(c) {
  const faces = String(fiche(c).pt || "").split(" // ");
  // verso : sa propre force/endurance ; un verso qui n'est pas une créature (une saga…) n'en a pas
  const face = c.retournee && verso(c) ? faces[1] || (/Creature/.test(verso(c).type) ? faces[0] : "") : faces[0];
  const m = /^(\*|[+-]?\d+)\/(\*|[+-]?\d+)/.exec(face || "");
  const plus = ((c.cpt || {})["+1/+1"] || 0) - ((c.cpt || {})["-1/-1"] || 0);
  const mod = c.mod || [0, 0];
  if (!plus && !mod[0] && !mod[1]) return null;
  const [f, e] = m ? [m[1], m[2]].map((v) => (v === "*" ? 0 : +v)) : [0, 0];
  return `${f + plus + mod[0]}/${e + plus + mod[1]}`;
}

function zoneDe(id) {
  for (const z of ZONES) if (E.zones[z].includes(id)) return z;
  return null;
}

// ------------------------------------------------------------------ actions (toutes passent par faire : annuler, journal)
function faire(texte, fn, fusion) {
  passe.push(JSON.stringify(E));
  if (passe.length > 300) passe.shift();
  futur = [];
  fn();
  if (texte) {
    const ligne = `T${E.tour} · ${texte}`;
    const j = E.journal;
    if (fusion && j.length && j[j.length - 1].startsWith(`T${E.tour} · ${fusion}`)) j[j.length - 1] = ligne;
    else j.push(ligne);
    if (j.length > 600) j.splice(0, j.length - 600);
  }
  sauver();
  dessiner();
}

function annuler() {
  if (!passe.length) return;
  futur.push(JSON.stringify(E));
  E = JSON.parse(passe.pop());
  sauver();
  dessiner();
}

function retablir() {
  if (!futur.length) return;
  passe.push(JSON.stringify(E));
  E = JSON.parse(futur.pop());
  sauver();
  dessiner();
}

function retirer(id) {
  const z = zoneDe(id);
  if (z) E.zones[z].splice(E.zones[z].indexOf(id), 1);
  return z;
}

// déplace une carte (à l'intérieur de faire) ; un jeton qui quitte le champ de bataille disparaît
function deplacer(id, vers, o = {}) {
  const c = E.cartes[id];
  if (!c) return;
  const de = retirer(id);
  if (estJeton(c) && vers !== "champ") { delete E.cartes[id]; return; }
  if (de !== vers) Object.assign(c, { engagee: false, cpt: {}, mod: [0, 0], retournee: false, cachee: !!o.cachee });
  if (vers === "bibliotheque") {
    if (o.dessous) E.zones.bibliotheque.push(id);
    else { E.zones.bibliotheque.unshift(id); E.revele = false; }
  } else if (vers === "main" && o.index != null) E.zones.main.splice(o.index, 0, id);
  else if (vers === "champ") {
    Object.assign(c, o.pos || placeLibre(c), { z: ++E.zmax });
    E.zones.champ.push(id);
  } else E.zones[vers].push(id);
}

function texteDeplacement(c, de, vers, o = {}) {
  const nom = c.cachee || o.cachee ? "une carte face cachée" : nomDe(c);
  if (de === "main" && vers === "cimetiere") return `Défausse ${nom}`;
  if (de === "main" && vers === "champ") return `Joue ${nom}`;
  if (de === "commandement" && vers === "champ") return `Lance ${nom}`;
  if (de === "bibliotheque" && vers === "main") return `Prend ${nom} dans la bibliothèque`;
  const verbe = { champ: "Met en jeu", main: "Reprend en main", cimetiere: "Met au cimetière", exil: "Exile", commandement: "Renvoie dans la zone de commandement",
    bibliotheque: o.dessous ? "Met sous la bibliothèque" : "Met sur la bibliothèque" }[vers];
  return `${verbe} ${nom}${DEPUIS[de] && vers !== "bibliotheque" ? " " + DEPUIS[de] : ""}`;
}

function bouger(id, vers, o = {}) {
  const c = E.cartes[id];
  if (!c) return;
  const de = zoneDe(id);
  if (estJeton(c) && vers !== "champ") return faire(`Retire le jeton ${nomDe(c)}`, () => deplacer(id, vers, o));
  faire(texteDeplacement(c, de, vers, o), () => deplacer(id, vers, o));
}

// une place libre sur le champ de bataille : les terrains en bas, le reste en haut
function placeLibre(c) {
  const ch = $("#champ"), W = ch.clientWidth || 1200, H = ch.clientHeight || 600, l = T.c, h = Math.round(l * RATIO), m = 8;
  const boites = E.zones.champ.map((id) => boite(E.cartes[id]));
  const ys = [];
  for (let y = m; y + h <= H - m; y += h + m * 2) ys.push(y);
  if (!ys.length) ys.push(m);
  if (/\bLand\b/.test(typeDe(c))) ys.reverse();
  const x0 = m + Math.ceil((h - l) / 2);                 // de quoi l'engager sans qu'elle déborde à gauche
  for (const y of ys)
    for (let x = x0; x + l <= W - m; x += l + m) {
      const b = { x, y, w: l, h };
      if (!boites.some((o) => chevauche(b, o))) return { x, y };
    }
  const k = E.zones.champ.length % 12;
  return { x: m + k * 18, y: m + k * 18 };
}

function boite(c) {
  const l = T.c, h = Math.round(l * RATIO);
  return c.engagee ? { x: c.x + (l - h) / 2, y: c.y + (h - l) / 2, w: h, h: l } : { x: c.x, y: c.y, w: l, h };
}
const chevauche = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function piocher(n = 1) {
  const lib = E.zones.bibliotheque;
  if (!lib.length) return toast("La bibliothèque est vide.");
  const k = Math.min(n, lib.length);
  faire(k > 1 ? `Pioche ${k} cartes` : "Pioche une carte", () => { E.zones.main.push(...lib.splice(0, k)); E.revele = false; });
}

function melangerBibliotheque() {
  faire("Mélange la bibliothèque", () => { melanger(E.zones.bibliotheque); E.revele = false; });
}

function tourSuivant() {
  faire(null, () => {
    E.tour++;
    E.zones.champ.forEach((id) => { E.cartes[id].engagee = false; });
    const lib = E.zones.bibliotheque;
    if (lib.length) E.zones.main.push(lib.shift());
    E.revele = false;
    E.journal.push(`Tour ${E.tour}`);
  });
}

function toutEngager(oui) {
  faire(oui ? "Engage tout" : "Dégage tout", () => E.zones.champ.forEach((id) => { E.cartes[id].engagee = oui; }));
}

function mulligan() {
  faire(null, () => {
    E.zones.bibliotheque.push(...E.zones.main.splice(0));
    melanger(E.zones.bibliotheque);
    E.zones.main = E.zones.bibliotheque.splice(0, 7);
    E.mulligans++;
    E.revele = false;
    E.journal.push(`T${E.tour} · Mulligan n° ${E.mulligans}`);
  });
}

function nouvellePartie() {
  passe.push(JSON.stringify(E));
  futur = [];
  E = nouvelEtat();
  sauver();
  dessiner();
}

function engager(id) {
  const c = E.cartes[id];
  faire(`${c.engagee ? "Dégage" : "Engage"} ${nomDe(c)}`, () => { c.engagee = !c.engagee; });
}

function retourner(id) {
  const c = E.cartes[id];
  if (!verso(c)) return toast("Cette carte n'a pas de verso.");
  faire(`Retourne ${nomDe(c)}`, () => { c.retournee = !c.retournee; });
}

function faceCachee(id) {
  const c = E.cartes[id];
  faire(c.cachee ? `Retourne face visible ${nomDe(c)}` : `Met ${nomDe(c)} face cachée`, () => { c.cachee = !c.cachee; });
}

function marqueur(id, nom, delta) {
  const c = E.cartes[id];
  faire(`${nomDe(c)} : ${delta > 0 ? "+" : "−"}1 marqueur ${nom}`, () => {
    c.cpt = c.cpt || {};
    const v = (c.cpt[nom] || 0) + delta;
    if (v > 0) c.cpt[nom] = v;
    else delete c.cpt[nom];
  });
}

// « - » : enlève un marqueur +1/+1 s'il y en a, sinon pose un -1/-1
function moinsUn(id) {
  const c = E.cartes[id];
  if ((c.cpt || {})["+1/+1"]) marqueur(id, "+1/+1", -1);
  else marqueur(id, "-1/-1", 1);
}

async function autreMarqueur(id) {
  const nom = await demander("Nom du marqueur", "charge", "text");
  if (nom) marqueur(id, nom.trim(), 1);
}

async function modifierPT(id) {
  const c = E.cartes[id];
  const actuel = c.mod || [0, 0];
  const v = await demander("Modifier la force et l'endurance", `${actuel[0] >= 0 ? "+" : ""}${actuel[0]}/${actuel[1] >= 0 ? "+" : ""}${actuel[1]}`, "text");
  if (v == null) return;
  const m = /^\s*([+-]?\d+)\s*\/\s*([+-]?\d+)\s*$/.exec(v);
  if (!m) return toast("Écris par exemple +2/+0.");
  faire(`${nomDe(c)} : ${m[1]}/${m[2]}`, () => { c.mod = [+m[1], +m[2]]; });
}

function copieJeton(id) {
  const c = E.cartes[id];
  faire(`Crée une copie en jeton de ${nomDe(c)}`, () => {
    const n = "c" + ++E.n;
    E.cartes[n] = { id: n, ref: c.ref, copie: true, ...(c.jeton ? { jeton: { ...c.jeton } } : {}) };
    const pos = zoneDe(id) === "champ" ? { x: c.x + 16, y: c.y + 16 } : null;
    deplacer(n, "champ", pos ? { pos } : {});
  });
}

function creerJetons(def, n) {
  faire(`Crée ${n > 1 ? n + " jetons" : "un jeton"} ${def.nom}${def.pt ? " " + def.pt : ""}`, () => {
    for (let k = 0; k < n; k++) {
      const id = "c" + ++E.n;
      E.cartes[id] = { id, jeton: { nom: def.nom, type: def.type || "Token", pt: def.pt || "", image: def.image || "", texte: def.texte || "" } };
      deplacer(id, "champ");
    }
  });
}

function supprimer(id) {
  const c = E.cartes[id];
  faire(`Retire ${nomDe(c)} de la partie`, () => { retirer(id); delete E.cartes[id]; });
}

function defausserHasard() {
  const m = E.zones.main;
  if (!m.length) return;
  bouger(m[Math.floor(Math.random() * m.length)], "cimetiere");
}

function toutDeplacer(de, vers, o = {}) {
  const ids = [...E.zones[de]];
  if (!ids.length) return;
  faire(`${NOM_ZONE[de]} → ${vers === "bibliotheque" ? "bibliothèque" : NOM_ZONE[vers].toLowerCase()} (${ids.length} cartes)`, () => {
    ids.forEach((id) => deplacer(id, vers, { dessous: true }));
    if (o.melanger) melanger(E.zones.bibliotheque);
  });
}

async function piocherX() {
  const n = await demander("Piocher combien de cartes ?", 2);
  if (n) piocher(n);
}

async function meuler() {
  const lib = E.zones.bibliotheque;
  if (!lib.length) return toast("La bibliothèque est vide.");
  const n = await demander("Meuler combien de cartes ?", 1);
  if (!n) return;
  const ids = lib.slice(0, n);
  faire(`Meule ${ids.length} : ${ids.map((id) => nomDe(E.cartes[id])).join(", ")}`, () => { ids.forEach((id) => deplacer(id, "cimetiere")); E.revele = false; });
}

function reveler() {
  if (!E.zones.bibliotheque.length) return;
  faire(E.revele ? "Cache le dessus de la bibliothèque" : `Révèle le dessus : ${nomDe(E.cartes[E.zones.bibliotheque[0]])}`, () => { E.revele = !E.revele; });
}

// ------------------------------------------------------------------ affichage
function tailles() {
  const w = innerWidth, h = innerHeight;
  T.c = Math.round(Math.max(74, Math.min(140, w * 0.075, h * 0.12)));
  T.m = Math.round(Math.max(84, Math.min(150, w * 0.085, h * 0.16)));
  T.p = Math.round(Math.max(64, Math.min(104, w * 0.06, h * 0.11)));
  const s = document.documentElement.style;
  s.setProperty("--lc", T.c + "px");
  s.setProperty("--lm", T.m + "px");
  s.setProperty("--lp", T.p + "px");
}

function montageHaut() {
  const pm = (c, lib) => `<div class="compteur" data-c="${c}"><span class="lib">${lib}</span><button type="button" class="btn-pm" data-pm="-1" aria-label="${lib} −1">−</button><b></b><button type="button" class="btn-pm" data-pm="1" aria-label="${lib} +1">+</button></div>`;
  $("#haut").innerHTML = `
    <a class="retour" href="/#/deck/${encodeURIComponent(DECK)}/liste" title="${esc(deck.titre)}">${ICO.retour}${esc(deck.titre)}</a>
    ${pm("tour", "Tour")}${pm("vie", "Vie")}
    <div class="mana">${MANA.map(([x, lib]) => `<button type="button" data-mana="${x}" title="${lib}"><img src="https://svgs.scryfall.io/card-symbols/${x}.svg" alt="${lib}"><b></b></button>`).join("")}
      <button type="button" class="btn btn-petit btn-discret" id="b-vider">Vider</button></div>
    <div class="espace"></div>
    <button type="button" class="btn btn-accent" id="b-tour">Tour suivant</button>
    <button type="button" class="btn" id="b-mulligan">Mulligan</button>
    <button type="button" class="btn" id="b-jetons">Jetons</button>
    <button type="button" class="btn btn-icone" id="b-annuler" title="Annuler" aria-label="Annuler">${ICO.annuler}</button>
    <button type="button" class="btn btn-icone" id="b-retablir" title="Rétablir" aria-label="Rétablir">${ICO.retablir}</button>
    <button type="button" class="btn" id="b-journal">Journal</button>
    <button type="button" class="btn" id="b-nouvelle">Nouvelle partie</button>
    <button type="button" class="btn btn-icone" id="b-aide" title="Raccourcis clavier" aria-label="Raccourcis clavier">?</button>`;
  $$(".compteur").forEach((el) => $$("[data-pm]", el).forEach((b) => {
    b.onclick = (ev) => {
      const k = el.dataset.c, d = +b.dataset.pm * (ev.shiftKey ? 5 : 1);
      if (k === "tour") faire(null, () => { E.tour = Math.max(1, E.tour + d); });
      else faire(`Vie ${E.vie + d}`, () => { E.vie += d; }, "Vie ");
    };
  }));
  $$("[data-mana]").forEach((b) => {
    const x = b.dataset.mana;
    b.onclick = () => faire(null, () => { E.mana[x]++; });
    b.oncontextmenu = (ev) => { ev.preventDefault(); ev.stopPropagation(); if (E.mana[x]) faire(null, () => { E.mana[x]--; }); };
  });
  $("#b-vider").onclick = () => faire(null, () => { MANA.forEach(([x]) => { E.mana[x] = 0; }); });
  $("#b-tour").onclick = tourSuivant;
  $("#b-mulligan").onclick = mulligan;
  $("#b-jetons").onclick = fenetreJetons;
  $("#b-annuler").onclick = annuler;
  $("#b-retablir").onclick = retablir;
  $("#b-journal").onclick = () => basculeJournal();
  $("#b-nouvelle").onclick = nouvellePartie;
  $("#b-aide").onclick = aide;
  $$("[data-menu]").forEach((b) => { b.innerHTML = ICO.points; });
}

function htmlCarte(c, ou, attr = "data-id", style = "") {
  const img = c.cachee ? "" : imageDe(c);
  const cls = ["carte", ou === "champ" && c.engagee ? "engagee" : "", c.cachee ? "dos-carte" : img ? "" : "sans-image"].filter(Boolean).join(" ");
  const pos = ou === "champ" ? `left:${Math.round(c.x)}px;top:${Math.round(c.y)}px;z-index:${c.z || 1};` : "";
  const corps = c.cachee ? "" : img ? `<img src="${esc(img)}" alt="${esc(nomDe(c))}" draggable="false">`
    : `<div class="txt"><b>${esc(nomDe(c))}</b><span>${esc(typeDe(c))}</span>${c.jeton && c.jeton.pt ? `<strong class="pt-txt">${esc(c.jeton.pt)}</strong>` : ""}</div>`;
  let extra = estJeton(c) ? `<span class="badge jeton-tag">Jeton</span>` : "";
  if (ou === "champ") {
    const autres = Object.entries(c.cpt || {}).filter(([k]) => k !== "+1/+1" && k !== "-1/-1").map(([k, v]) => `<span class="badge">${esc(k)} ${v}</span>`);
    const pt = ptActuel(c);
    if (autres.length || pt) extra += `<div class="badges">${autres.join("")}${pt ? `<span class="badge pt">${pt}</span>` : ""}</div>`;
  }
  return `<div class="${cls}" ${attr}="${c.id}" style="${pos}${style}">${corps}${extra}</div>`;
}

// la main en éventail, resserrée quand elle ne tient plus en largeur
function eventail(i, n) {
  const W = $("#main").clientWidth - 40, l = T.m;
  const chev = n > 1 && n * l > W ? Math.min(l * 0.82, (n * l - W) / (n - 1)) : -6;
  const d = i - (n - 1) / 2, a = Math.max(-10, Math.min(10, d * Math.min(2.5, 20 / n)));
  return `${i ? `margin-left:${-chev}px;` : ""}transform:rotate(${a.toFixed(1)}deg) translateY(${(Math.abs(a) * 0.6).toFixed(1)}px);`;
}

function dessiner() {
  $('[data-c="tour"] b').textContent = E.tour;
  $('[data-c="vie"] b').textContent = E.vie;
  MANA.forEach(([x]) => {
    const b = $(`[data-mana="${x}"]`);
    $("b", b).textContent = E.mana[x];
    b.classList.toggle("zero", !E.mana[x]);
  });
  $("#b-annuler").disabled = !passe.length;
  $("#b-retablir").disabled = !futur.length;

  const ch = $("#champ"), W = ch.clientWidth, H = ch.clientHeight, l = T.c, h = Math.round(l * RATIO);
  ch.innerHTML = E.zones.champ.map((id) => E.cartes[id]).sort((a, b) => (a.z || 0) - (b.z || 0)).map((c) => {
    if (W && H) {                                        // la carte reste entière dans le champ, même engagée ou fenêtre rétrécie
      const dx = c.engagee ? (h - l) / 2 : 0, dy = c.engagee ? (l - h) / 2 : 0;
      c.x = Math.max(dx, Math.min(W - l - dx, c.x));
      c.y = Math.max(-dy, Math.min(H - h + dy, c.y));
    }
    return htmlCarte(c, "champ");
  }).join("");

  const m = E.zones.main;
  $("#titre-main").textContent = `Main (${m.length})${E.mulligans ? ` · mulligan ${E.mulligans}` : ""}`;
  $("#main").innerHTML = m.map((id, i) => htmlCarte(E.cartes[id], "main", "data-id", eventail(i, m.length))).join("");

  for (const z of ["bibliotheque", "cimetiere", "exil", "commandement"]) {
    const ids = E.zones[z], n = ids.length;
    let contenu = `<div class="emplacement"></div>`;
    if (n && z === "bibliotheque") contenu = E.revele ? htmlCarte(E.cartes[ids[0]], "pile", "data-voir") : `<div class="carte dos-carte"></div>`;
    else if (n && z === "commandement") contenu = `<div class="cmds">${ids.map((id) => htmlCarte(E.cartes[id], "pile")).join("")}</div>`;
    else if (n) contenu = htmlCarte(E.cartes[ids[n - 1]], "pile", "data-voir");
    $("#p-" + z).innerHTML = `<div class="titre-pile">${NOM_ZONE[z]}</div><div class="pile-corps">${contenu}
      ${z === "commandement" ? "" : `<span class="compte ${n ? "" : "zero"}">${n}</span>`}
      <button type="button" class="btn-menu pile-menu" data-menu="${z}" aria-label="Actions : ${NOM_ZONE[z]}">${ICO.points}</button></div>`;
  }
  if (!$("#journal").hidden) peindreJournal();
}

// ------------------------------------------------------------------ menus
function ouvrirMenu(x, y, items) {
  const m = $("#menu");
  const actions = items.filter(Array.isArray);
  m.innerHTML = items.map((it) => (it === null ? `<hr class="menu-sep">`
    : typeof it === "string" ? `<div class="menu-titre">${esc(it)}</div>`
      : `<button type="button" ${it[3] ? "disabled" : ""}><span>${esc(it[0])}</span>${it[1] ? `<kbd>${esc(it[1])}</kbd>` : ""}</button>`)).join("");
  $$("button", m).forEach((b, i) => { b.onclick = () => { fermerMenu(); actions[i][2](); }; });
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + "px";
  m.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + "px";
}
function fermerMenu() { $("#menu").hidden = true; }

const DESTINATIONS = [["champ", "Champ de bataille", "B"], ["main", "Main", "H"], ["cimetiere", "Cimetière", "G"], ["exil", "Exil", "E"],
  ["commandement", "Zone de commandement", "Z"], ["bibliotheque", "Dessus de la bibliothèque", "Y"], ["bibliotheque", "Dessous de la bibliothèque", "L", { dessous: true }]];

function menuCarte(id, x, y) {
  const c = E.cartes[id], z = zoneDe(id);
  const items = [nomDe(c)];
  if (z === "champ") {
    items.push([c.engagee ? "Dégager" : "Engager", "T", () => engager(id)]);
    if (verso(c)) items.push([c.retournee ? "Remettre au recto" : "Retourner", "F", () => retourner(id)]);
    items.push([c.cachee ? "Face visible" : "Face cachée", "M", () => faceCachee(id)], null,
      ["Marqueur +1/+1", "+", () => marqueur(id, "+1/+1", 1)], ["Marqueur −1/−1", "−", () => moinsUn(id)]);
    for (const k of Object.keys(c.cpt || {}).filter((k) => k !== "+1/+1" && k !== "-1/-1"))
      items.push([`+1 ${k}`, "", () => marqueur(id, k, 1)], [`−1 ${k}`, "", () => marqueur(id, k, -1)]);
    items.push(["Autre marqueur…", "", () => autreMarqueur(id)], ["Force / endurance…", "", () => modifierPT(id)], null,
      ["Copie en jeton", "C", () => copieJeton(id)]);
  } else if (z === "main") {
    items.push(["Jouer", "B", () => bouger(id, "champ")], ["Jouer face cachée", "", () => bouger(id, "champ", { cachee: true })]);
  } else if (z === "commandement") items.push(["Lancer", "B", () => bouger(id, "champ")]);
  items.push(null, "Déplacer vers");
  for (const [v, lib, k, o] of DESTINATIONS) if (v !== z || v === "bibliotheque") items.push([lib, k, () => bouger(id, v, o || {})]);
  items.push(null, ["Voir la carte", "O", () => voirCarte(id)], ["Retirer de la partie", "Suppr", () => supprimer(id)]);
  ouvrirMenu(x, y, items);
}

function menuPile(z, x, y) {
  const ids = E.zones[z], vide = !ids.length;
  if (z === "bibliotheque") {
    const haut = ids[0];
    return ouvrirMenu(x, y, ["Bibliothèque",
      ["Piocher", "D", () => piocher(1), vide], ["Piocher X…", "", piocherX, vide], ["Mélanger", "Ctrl+S", melangerBibliotheque, vide],
      ["Chercher…", "Ctrl+F", chercher, vide], null,
      ["Regarder le dessus…", "", () => regarder(false), vide], ["Regarder le dessous…", "", () => regarder(true), vide],
      ["Meuler X…", "", meuler, vide], [E.revele ? "Cacher le dessus" : "Révéler le dessus", "", reveler, vide], null,
      ["Jouer le dessus", "", () => bouger(haut, "champ"), vide], ["Exiler le dessus", "", () => bouger(haut, "exil"), vide]]);
  }
  if (z === "commandement") return ouvrirMenu(x, y, ["Zone de commandement", ["Voir", "", () => voirZone(z), vide]]);
  const autres = ["main", "cimetiere", "exil"].filter((v) => v !== z);
  ouvrirMenu(x, y, [NOM_ZONE[z], ["Voir", "", () => voirZone(z), vide], null, "Tout déplacer vers",
    ...autres.map((v) => [NOM_ZONE[v], "", () => toutDeplacer(z, v), vide]),
    ["Bibliothèque, puis mélanger", "", () => toutDeplacer(z, "bibliotheque", { melanger: true }), vide]]);
}

function menuMain(x, y) {
  const vide = !E.zones.main.length;
  ouvrirMenu(x, y, ["Main", ["Défausser au hasard", "", defausserHasard, vide], ["Tout défausser", "", () => toutDeplacer("main", "cimetiere"), vide],
    ["Remettre dans la bibliothèque et mélanger", "", () => toutDeplacer("main", "bibliotheque", { melanger: true }), vide], null,
    ["Mulligan", "", mulligan]]);
}

function menuChamp(x, y) {
  ouvrirMenu(x, y, ["Champ de bataille", ["Dégager tout", "U", () => toutEngager(false)], ["Engager tout", "", () => toutEngager(true)],
    ["Tour suivant", "N", tourSuivant], null, ["Jetons…", "", fenetreJetons], null, ["Annuler", "Ctrl+Z", annuler, !passe.length]]);
}

// ------------------------------------------------------------------ fenêtres
let apresFermeture = null;
function ouvrirModale(html, large) {
  const m = $("#modale");
  m.innerHTML = `<div class="modale-boite ${large ? "large" : ""}" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  return m.firstElementChild;
}
function fermerModale() {
  const m = $("#modale");
  if (m.hidden) return;
  m.hidden = true;
  m.innerHTML = "";
  const f = apresFermeture;
  apresFermeture = null;
  if (f) f();
}

// petite question : un nombre ou un texte (null si on annule)
function demander(titre, defaut, type = "number") {
  return new Promise((ok) => {
    const b = ouvrirModale(`<h2>${esc(titre)}</h2><form><input class="champ-saisie" type="${type}" ${type === "number" ? 'min="0" max="99"' : ""} value="${esc(defaut)}">
      <div class="pied"><button type="button" class="btn" data-non>Annuler</button><button class="btn btn-accent">OK</button></div></form>`);
    const inp = $("input", b);
    inp.focus();
    inp.select();
    apresFermeture = () => ok(null);
    $("form", b).onsubmit = (ev) => {
      ev.preventDefault();
      const v = inp.value;
      apresFermeture = null;
      fermerModale();
      ok(type === "number" ? Math.max(0, parseInt(v, 10) || 0) : v);
    };
    $("[data-non]", b).onclick = fermerModale;
  });
}

function tuile(c, attr, dessous = "") {
  return `<div class="tuile">${htmlCarte(c, "tuile", attr)}<div class="nom" title="${esc(nomDe(c))}">${esc(nomDe(c))}</div>${dessous}</div>`;
}

// regarder les X cartes du dessus (ou du dessous) et dire où va chacune : c'est aussi le regard (scry) et la surveillance
async function regarder(dessous) {
  const lib = E.zones.bibliotheque;
  if (!lib.length) return toast("La bibliothèque est vide.");
  const x = await demander(dessous ? "Regarder combien de cartes du dessous ?" : "Regarder combien de cartes du dessus ?", 1);
  if (!x) return;
  const k = Math.min(x, lib.length);
  const choix = (dessous ? lib.slice(-k) : lib.slice(0, k)).map((id) => ({ id, ou: dessous ? "dessous" : "dessus" }));
  const OU = [["dessus", "Dessus"], ["dessous", "Dessous"], ["cimetiere", "Cimetière"], ["exil", "Exil"], ["main", "Main"], ["champ", "Champ de bataille"]];
  const peindre = () => {
    const b = ouvrirModale(`<h2>${k} carte${k > 1 ? "s" : ""} du ${dessous ? "dessous" : "dessus"}</h2>
      <div class="grille-cartes">${choix.map((ch, i) => tuile(E.cartes[ch.id], "data-mid", `<div class="outils">
        <button type="button" class="btn btn-petit btn-icone" data-gauche="${i}" ${i ? "" : "disabled"} aria-label="Plus haut">‹</button>
        <select data-ou="${i}">${OU.map(([v, lib]) => `<option value="${v}" ${v === ch.ou ? "selected" : ""}>${lib}</option>`).join("")}</select>
        <button type="button" class="btn btn-petit btn-icone" data-droite="${i}" ${i < choix.length - 1 ? "" : "disabled"} aria-label="Plus bas">›</button></div>`)).join("")}</div>
      <div class="pied"><button type="button" class="btn" data-non>Annuler</button><button type="button" class="btn btn-accent" data-oui>Valider</button></div>`, true);
    $$("[data-ou]", b).forEach((s) => { s.onchange = () => { choix[+s.dataset.ou].ou = s.value; }; });
    $$("[data-gauche]", b).forEach((x) => { x.onclick = () => { const i = +x.dataset.gauche; [choix[i - 1], choix[i]] = [choix[i], choix[i - 1]]; peindre(); }; });
    $$("[data-droite]", b).forEach((x) => { x.onclick = () => { const i = +x.dataset.droite; [choix[i + 1], choix[i]] = [choix[i], choix[i + 1]]; peindre(); }; });
    $("[data-non]", b).onclick = fermerModale;
    $("[data-oui]", b).onclick = () => {
      fermerModale();
      const compte = {};
      choix.forEach((ch) => { compte[ch.ou] = (compte[ch.ou] || 0) + 1; });
      const resume = OU.filter(([v]) => compte[v]).map(([v, lib]) => `${compte[v]} ${lib.toLowerCase()}`).join(", ");
      faire(`Regarde ${k} carte${k > 1 ? "s" : ""} du ${dessous ? "dessous" : "dessus"} : ${resume}`, () => {
        choix.forEach((ch) => retirer(ch.id));
        E.zones.bibliotheque.unshift(...choix.filter((ch) => ch.ou === "dessus").map((ch) => ch.id));
        E.zones.bibliotheque.push(...choix.filter((ch) => ch.ou === "dessous").map((ch) => ch.id));
        choix.filter((ch) => ch.ou !== "dessus" && ch.ou !== "dessous").forEach((ch) => deplacer(ch.id, ch.ou));
        E.revele = false;
      });
    };
  };
  peindre();
}

// chercher une carte dans la bibliothèque
function chercher() {
  if (!E.zones.bibliotheque.length) return toast("La bibliothèque est vide.");
  const b = ouvrirModale(`<h2>Chercher dans la bibliothèque</h2>
    <input class="champ-saisie" type="search" placeholder="Nom de la carte" id="filtre-bib" autocomplete="off">
    <div class="grille-cartes" id="grille-bib" style="margin-top:.8rem"></div>
    <div class="pied"><button type="button" class="btn" data-non>Fermer</button><button type="button" class="btn btn-accent" data-melanger>Mélanger et fermer</button></div>`, true);
  const peindre = () => {
    const f = norm($("#filtre-bib").value);
    const ids = E.zones.bibliotheque.filter((id) => !f || norm(nomDe(E.cartes[id]) + " " + nomAnglais(E.cartes[id])).includes(f))
      .sort((a, b) => nomDe(E.cartes[a]).localeCompare(nomDe(E.cartes[b]), "fr"));
    $("#grille-bib").innerHTML = ids.map((id) => tuile(E.cartes[id], "data-mid")).join("") || `<p class="muet">Aucune carte.</p>`;
    $$("#grille-bib [data-mid]").forEach((el) => {
      el.onclick = (ev) => menuDestination(el.dataset.mid, ev.clientX, ev.clientY, "bibliotheque", peindre);
    });
  };
  $("#filtre-bib").oninput = peindre;
  $("[data-non]", b).onclick = fermerModale;
  $("[data-melanger]", b).onclick = () => { fermerModale(); melangerBibliotheque(); };
  peindre();
  $("#filtre-bib").focus();
}

// où envoyer une carte choisie dans une fenêtre (bibliothèque, cimetière, exil)
function menuDestination(id, x, y, depuis, apres) {
  const c = E.cartes[id];
  ouvrirMenu(x, y, [nomDe(c), ...DESTINATIONS.filter(([v]) => v !== depuis || v === "bibliotheque")
    .map(([v, lib, , o]) => [lib, "", () => { bouger(id, v, o || {}); if (E.zones[depuis].length) apres(); else fermerModale(); }])]);
}

function voirZone(z) {
  if (!E.zones[z].length) return;
  const b = ouvrirModale(`<h2>${NOM_ZONE[z]}</h2><div class="grille-cartes" id="grille-zone"></div>
    <div class="pied"><button type="button" class="btn" data-non>Fermer</button></div>`, true);
  const peindre = () => {
    const ids = [...E.zones[z]].reverse();             // la plus récente d'abord
    $("#grille-zone").innerHTML = ids.map((id) => tuile(E.cartes[id], "data-mid")).join("");
    $$("#grille-zone [data-mid]").forEach((el) => {
      el.onclick = (ev) => menuDestination(el.dataset.mid, ev.clientX, ev.clientY, z, peindre);
    });
  };
  $("[data-non]", b).onclick = fermerModale;
  peindre();
}

function voirCarte(id) {
  const c = E.cartes[id], f = fiche(c), d = verso(c);
  const img = imageDe(c);
  const texte = c.jeton ? c.jeton.texte : (f.fr_texte || f.texte || "");
  const b = ouvrirModale(`<div class="fiche">${img ? `<img src="${esc(img)}" alt="">` : ""}${d && !c.retournee ? `<img src="${esc(d.image)}" alt="">` : ""}
    <div class="texte"><h2>${esc(nomDe(c))}</h2><p class="muet">${esc(c.jeton ? c.jeton.type : (f.fr_type || f.type || ""))}${f.pt && !c.jeton ? " · " + esc(f.pt) : ""}</p>${esc(texte)}</div></div>
    <div class="pied"><button type="button" class="btn" data-non>Fermer</button></div>`, true);
  $("[data-non]", b).onclick = fermerModale;
}

function fenetreJetons() {
  const liste = jetons == null ? `<p class="muet">Chargement des jetons…</p>`
    : jetons.length ? `<div class="grille-cartes">${jetons.map((j, i) => `<div class="tuile"><div class="carte" data-jeton="${i}"><img src="${esc(j.image)}" alt="${esc(j.nom)}" draggable="false"></div>
        <div class="nom" title="${esc(j.cartes.join(", "))}">${esc(j.nom)}${j.pt ? " " + esc(j.pt) : ""}</div><div class="nom muet petit">${esc(j.cartes.join(", "))}</div></div>`).join("")}</div>`
      : `<p class="muet">Aucun jeton trouvé pour ce deck.</p>`;
  const b = ouvrirModale(`<h2>Jetons</h2>
    <div class="ligne-champs" style="margin-bottom:.8rem"><label>Combien<input class="champ-saisie" type="number" min="1" max="50" value="1" id="nb-jetons" style="width:6rem"></label></div>
    ${liste}
    <h3>Jeton personnalisé</h3>
    <form class="ligne-champs" id="jeton-perso">
      <label>Nom<input class="champ-saisie" name="nom" value="Soldat" required></label>
      <label>Force/endurance<input class="champ-saisie" name="pt" value="1/1" style="width:7rem"></label>
      <label>Type<input class="champ-saisie" name="type" value="Créature"></label>
      <button class="btn btn-accent">Créer</button>
    </form>
    <div class="pied"><button type="button" class="btn" data-non>Fermer</button></div>`, true);
  const nb = () => Math.max(1, Math.min(50, parseInt($("#nb-jetons").value, 10) || 1));
  $$("[data-jeton]", b).forEach((el) => { el.onclick = () => { const n = nb(); fermerModale(); creerJetons(jetons[+el.dataset.jeton], n); }; });
  $("#jeton-perso").onsubmit = (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target), n = nb();
    fermerModale();
    creerJetons({ nom: f.get("nom").trim() || "Jeton", pt: f.get("pt").trim(), type: f.get("type").trim() }, n);
  };
  $("[data-non]", b).onclick = fermerModale;
}

const RACCOURCIS = [
  ["Tour suivant (dégager, piocher)", "N"], ["Dégager tout", "U"], ["Piocher", "D"], ["Jouer la carte n de la main", "1 … 9"],
  ["Mélanger la bibliothèque", "Ctrl+S"], ["Chercher dans la bibliothèque", "Ctrl+F"], ["Annuler", "Ctrl+Z"], ["Rétablir", "Ctrl+Maj+Z"],
  ["Nouvelle partie", "Ctrl+G"], ["Raccourcis", "?"],
  ["Carte survolée : engager / dégager", "T"], ["… vers le champ de bataille", "B"], ["… dans la main", "H"], ["… au cimetière", "G"],
  ["… en exil", "E"], ["… en zone de commandement", "Z"], ["… sur la bibliothèque", "Y"], ["… sous la bibliothèque", "L"],
  ["… retourner (carte double)", "F"], ["… face cachée", "M"], ["… marqueur +1/+1", "+"], ["… marqueur −1/−1", "−"],
  ["… copie en jeton", "C"], ["… voir la carte", "O"], ["… retirer de la partie", "Suppr"],
  ["Clic sur une carte : engager, jouer", "clic"], ["Menu d'une carte ou d'une pile", "clic droit"], ["Vie ±5", "Maj+clic"],
];

function aide() {
  const b = ouvrirModale(`<h2>Raccourcis</h2><div class="aide">${RACCOURCIS.map(([l, k]) => `<div><span>${esc(l)}</span><kbd>${esc(k)}</kbd></div>`).join("")}</div>
    <div class="pied"><button type="button" class="btn" data-non>Fermer</button></div>`, true);
  $("[data-non]", b).onclick = fermerModale;
}

function basculeJournal(ouvrir) {
  const j = $("#journal");
  j.hidden = !(ouvrir ?? j.hidden);
  j.style.top = $("#haut").offsetHeight + "px";       // sous la barre du haut, qui reste utilisable
  if (!j.hidden) peindreJournal();
}
function peindreJournal() {
  const j = $("#journal");
  j.innerHTML = `<header>Journal<button type="button" class="btn-menu" id="fermer-journal" aria-label="Fermer">${ICO.fermer}</button></header>
    <ol>${E.journal.map((l) => `<li class="${/^Tour \d/.test(l) ? "tour" : ""}">${esc(l)}</li>`).join("")}</ol>`;
  $("#fermer-journal").onclick = () => basculeJournal(false);
  const ol = $("ol", j);
  ol.scrollTop = ol.scrollHeight;
}

let minuteurToast = null;
function toast(texte) {
  const t = $("#toast");
  t.textContent = texte;
  t.hidden = false;
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => { t.hidden = true; }, 2600);
}

// ------------------------------------------------------------------ aperçu au survol
let apercuEl = null, minuteurApercu = null;
function cacherApercu() { clearTimeout(minuteurApercu); $("#apercu").hidden = true; }
function montrerApercu(el, c) {
  const img = imageDe(c);
  if (!img || !el.isConnected) return;
  const a = $("#apercu");
  $("img", a).src = img;
  a.hidden = false;
  const r = el.getBoundingClientRect(), w = a.offsetWidth, h = w * RATIO;
  const x = r.right + 12 + w < innerWidth ? r.right + 12 : Math.max(6, r.left - 12 - w);
  a.style.left = x + "px";
  a.style.top = Math.max(6, Math.min(innerHeight - h - 6, r.top + r.height / 2 - h / 2)) + "px";
}

// ------------------------------------------------------------------ souris : clic, glisser-déposer, clic droit
function clic(s) {
  if (s.pile === "bibliotheque") return piocher(1);
  if (s.pile === "cimetiere" || s.pile === "exil") return voirZone(s.pile);
  if (!s.id || !E.cartes[s.id]) return;
  const z = zoneDe(s.id);
  if (z === "champ") engager(s.id);
  else if (z === "main" || z === "commandement") bouger(s.id, "champ");
}

const zoneSous = (x, y) => (document.elementFromPoint(x, y) || document.body).closest("[data-zone]");

// rang dans la main où poser une carte lâchée à l'abscisse x
function rangMain(x, sauf) {
  return $$("#main [data-id]").filter((el) => el.dataset.id !== sauf).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2 < x;
  }).length;
}

document.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0 || !E || ev.target.closest("#menu, #modale, #haut, #journal, .btn-menu")) return;
  fermerMenu();
  const el = ev.target.closest("[data-id]") || ev.target.closest(".pile[data-zone]");
  if (!el) return;
  let id = el.dataset.id || null, pile = null;
  if (!id) {
    pile = el.dataset.zone;
    const ids = E.zones[pile];
    id = pile === "bibliotheque" ? ids[0] : pile === "commandement" ? null : ids[ids.length - 1];
  }
  g = { el, id, pile, x0: ev.clientX, y0: ev.clientY, bouge: false };
});

document.addEventListener("pointermove", (ev) => {
  if (g) {
    if (!g.bouge) {
      if (!g.id || Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < 6) return;
      g.bouge = true;
      cacherApercu();
      const source = g.pile ? $(".carte", g.el) || g.el : g.el;
      const r = source.getBoundingClientRect();
      g.dx = Math.max(0, Math.min(1, (g.x0 - r.left) / r.width));
      g.dy = Math.max(0, Math.min(1, (g.y0 - r.top) / r.height));
      const c = E.cartes[g.id];
      const f = $("#fantome");
      f.innerHTML = g.pile === "bibliotheque" && !E.revele ? `<div class="carte dos-carte"></div>` : htmlCarte(c, "fantome", "data-fantome");
      $(".carte", f).style.setProperty("--l", (zoneDe(g.id) === "champ" ? T.c : r.width) + "px");     // carte engagée : sa largeur à plat
      f.hidden = false;
      if (!g.pile) g.el.classList.add("souleve");
    }
    const f = $("#fantome"), w = f.firstElementChild.offsetWidth, h = f.firstElementChild.offsetHeight;
    f.style.left = ev.clientX - g.dx * w + "px";
    f.style.top = ev.clientY - g.dy * h + "px";
    const cible = zoneSous(ev.clientX, ev.clientY);
    $$(".cible").forEach((x) => { if (x !== cible) x.classList.remove("cible"); });
    if (cible) cible.classList.add("cible");
    return;
  }
  // survol : aperçu de la carte et cible des raccourcis
  const el = ev.target.closest ? ev.target.closest("[data-id], [data-mid], [data-voir]") : null;
  survol = el && el.dataset.id ? el.dataset.id : null;
  if (el === apercuEl) return;
  apercuEl = el;
  cacherApercu();
  const id = el && (el.dataset.id || el.dataset.mid || el.dataset.voir);
  if (id && E && E.cartes[id] && !el.classList.contains("dos-carte")) minuteurApercu = setTimeout(() => montrerApercu(el, E.cartes[id]), 380);
});

document.addEventListener("pointerup", (ev) => {
  if (!g) return;
  const s = g;
  g = null;
  $$(".cible").forEach((x) => x.classList.remove("cible"));
  $("#fantome").hidden = true;
  s.el.classList.remove("souleve");
  if (!s.bouge) return clic(s);
  const cible = zoneSous(ev.clientX, ev.clientY);
  if (!cible || !E.cartes[s.id]) return;
  const vers = cible.dataset.zone, id = s.id, c = E.cartes[id], de = zoneDe(id);
  if (vers === "champ") {
    const r = $("#champ").getBoundingClientRect(), l = T.c, h = Math.round(l * RATIO);
    const x = Math.max(0, Math.min(r.width - l, ev.clientX - r.left - s.dx * l));
    const y = Math.max(0, Math.min(r.height - h, ev.clientY - r.top - s.dy * h));
    if (de === "champ") faire(null, () => { Object.assign(c, { x, y, z: ++E.zmax }); });
    else bouger(id, "champ", { pos: { x, y } });
  } else if (vers === "main") {
    const index = rangMain(ev.clientX, id);
    if (de === "main") faire(null, () => { const m = E.zones.main; m.splice(m.indexOf(id), 1); m.splice(index, 0, id); });
    else bouger(id, "main", { index });
  } else if (vers !== de || vers === "bibliotheque") bouger(id, vers, {});
});

addEventListener("blur", () => {
  if (!g) return;
  if (g.el) g.el.classList.remove("souleve");
  g = null;
  $("#fantome").hidden = true;
  $$(".cible").forEach((x) => x.classList.remove("cible"));
});

document.addEventListener("contextmenu", (ev) => {
  if (!E || ev.target.closest("#modale, #haut, #journal, input")) return;
  ev.preventDefault();
  cacherApercu();
  const el = ev.target.closest("[data-id]");
  if (el) return menuCarte(el.dataset.id, ev.clientX, ev.clientY);
  const p = ev.target.closest(".pile[data-zone]");
  if (p) return menuPile(p.dataset.zone, ev.clientX, ev.clientY);
  if (ev.target.closest("#zone-main")) return menuMain(ev.clientX, ev.clientY);
  if (ev.target.closest("#champ")) return menuChamp(ev.clientX, ev.clientY);
});

document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-menu]");
  if (b) {
    ev.stopPropagation();
    const r = b.getBoundingClientRect();
    if (b.dataset.menu === "main") menuMain(r.left, r.bottom + 4);
    else menuPile(b.dataset.menu, r.left, r.bottom + 4);
    return;
  }
  if (!ev.target.closest("#menu")) fermerMenu();
});

$("#modale").addEventListener("pointerdown", (ev) => { if (ev.target.id === "modale") fermerModale(); });

// ------------------------------------------------------------------ clavier
document.addEventListener("keydown", (ev) => {
  if (!E) return;
  if (ev.key === "Escape") { fermerMenu(); fermerModale(); basculeJournal(false); return; }
  if (ev.target.closest("input, select, textarea") || !$("#modale").hidden) return;
  const k = ev.key.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey;
  const go = (f) => { ev.preventDefault(); fermerMenu(); f(); };
  if (ctrl) {
    if (k === "z") return go(ev.shiftKey ? retablir : annuler);
    if (k === "s") return go(melangerBibliotheque);
    if (k === "f") return go(chercher);
    if (k === "g") return go(nouvellePartie);
    return;
  }
  if (ev.altKey) return;
  const id = survol && E.cartes[survol] ? survol : null;
  if (id) {
    const actions = { t: () => (zoneDe(id) === "champ" ? engager(id) : null), b: () => bouger(id, "champ"), h: () => bouger(id, "main"),
      g: () => bouger(id, "cimetiere"), e: () => bouger(id, "exil"), z: () => bouger(id, "commandement"), y: () => bouger(id, "bibliotheque"),
      l: () => bouger(id, "bibliotheque", { dessous: true }), f: () => retourner(id), m: () => faceCachee(id), c: () => copieJeton(id),
      o: () => voirCarte(id), "+": () => marqueur(id, "+1/+1", 1), "-": () => moinsUn(id), delete: () => supprimer(id) };
    if (actions[k] && !(k === "b" && zoneDe(id) === "champ")) return go(actions[k]);
  }
  if (k === "n") return go(tourSuivant);
  if (k === "u") return go(() => toutEngager(false));
  if (k === "d") return go(() => piocher(1));
  if (ev.key === "?") return go(aide);
  if (/^[1-9]$/.test(k) && E.zones.main[+k - 1]) return go(() => bouger(E.zones.main[+k - 1], "champ"));
});

addEventListener("resize", () => { if (!E) return; cacherApercu(); apercuEl = null; tailles(); dessiner(); });

demarrer().catch((e) => {
  document.body.innerHTML = `<p class="erreur">Impossible de lancer la partie : ${esc(e.message || e)}</p>`;
});
