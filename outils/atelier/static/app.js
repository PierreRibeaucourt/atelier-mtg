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

// préférences d'affichage gardées d'une visite à l'autre (si le navigateur le permet)
const PREF = {
  get(k, def) { try { return localStorage.getItem("pref-" + k) || def; } catch (_) { return def; } },
  set(k, v) { try { localStorage.setItem("pref-" + k, v); } catch (_) {} },
};

async function api(chemin, opts = {}) {
  const init = { ...opts, headers: { "Content-Type": "application/json" } };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const r = await fetch(chemin, init);
  const type = r.headers.get("content-type") || "";
  const data = type.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.erreur) || data || r.statusText);
  return data;
}

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

function texteMana(ligne) {
  return esc(ligne)
    .replace(/\(([^)]*)\)/g, '<i class="rappel">($1)</i>')                 // texte de rappel en italique
    .replace(/\{([^}]+)\}/g, (_, s) => `<img class="sym-t" src="https://svgs.scryfall.io/card-symbols/${enc(s.replace("/", ""))}.svg" alt="{${esc(s)}}">`);
}

function ficheSurvol(c) {
  const f = c.info || {};
  const nom = f.fr || c.nom;
  const texte = f.fr_texte || f.texte || "";
  const cher = (f.prix || 0) > 5;
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

document.addEventListener("mouseover", (ev) => {
  const el = ev.target.closest("[data-image]");
  const ap = $("#apercu");
  if (!el || !el.dataset.image) { ap.hidden = true; survol = null; }
  else if (el !== survol || ap.hidden) {
    survol = el;
    $("img", ap).src = el.dataset.image;
    majLegende();
    ap.hidden = false;
  }
  const b = ev.target.closest("[data-bulle]");
  const bu = $("#bulle");
  if (!b || !b.dataset.bulle) bu.hidden = true;
  else { bu.textContent = b.dataset.bulle; bu.hidden = false; }
});
document.addEventListener("mousemove", (ev) => {
  const ap = $("#apercu");
  if (!ap.hidden) {
    const x = ev.clientX + 24 + 244 > innerWidth ? ev.clientX - 268 : ev.clientX + 24;
    ap.style.left = x + "px";
    ap.style.top = Math.max(8, Math.min(ev.clientY - 40, innerHeight - 390)) + "px";
  }
  const bu = $("#bulle");
  if (!bu.hidden) {
    const w = bu.offsetWidth, h = bu.offsetHeight;
    bu.style.left = Math.max(8, Math.min(ev.clientX + 14, innerWidth - w - 8)) + "px";
    bu.style.top = (ev.clientY + 18 + h > innerHeight ? Math.max(8, ev.clientY - h - 12) : ev.clientY + 18) + "px";
  }
});

// ------------------------------------------------------------------ menu contextuel et modale
function ouvrirMenu(bouton, items, ev = null) {
  cacherApercu();                               // sinon l'image survolée recouvre le menu
  const m = $("#menu");
  m.innerHTML = "";
  for (const [libelle, action, classe] of items) {
    const b = document.createElement("button");
    b.textContent = libelle;
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
async function route() {
  fermerMenu();
  if (!$("#modale").hidden) fermerModale();
  cacherApercu();
  const [chemin, qs] = location.hash.replace(/^#\/?/, "").split(/\?(.*)/s);
  const parts = chemin.split("/");
  $("#lien-recherche").classList.toggle("actif", parts[0] === "recherche");
  try {
    if (parts[0] === "recherche") await vueRecherche(new URLSearchParams(qs || ""));
    else if (parts[0] === "deck" && parts[1]) await vueDeck(decodeURIComponent(parts[1]), parts[2] || "liste", parts[3] ? decodeURIComponent(parts[3]) : null);
    else await vueAccueil();
  } catch (e) {
    vue.innerHTML = `<p class="erreur">${esc(e.message || e)}</p>`;
  }
}
window.addEventListener("hashchange", route);

const identiteHtml = (ident) => ident == null ? "" : (ident.length ? ident.map(symbole).join("") : symbole("C"));

// decks ouverts récemment (gardés dans ce navigateur) : en tête du sélecteur et du tri « récents »
const RECENTS = {
  lire() { try { return JSON.parse(localStorage.getItem("decks-recents") || "{}"); } catch (_) { return {}; } },
  noter(id) { try { const r = RECENTS.lire(); r[id] = Date.now(); localStorage.setItem("decks-recents", JSON.stringify(r)); } catch (_) {} },
};
const recence = (d) => Math.max(RECENTS.lire()[d.id] || 0, (d.modifie || 0) * 1000);

async function listeDecks() {
  if (!etat.decks.length) etat.decks = await api("/api/decks");
  return etat.decks;
}

// ------------------------------------------------------------------ « Aller à un deck » (barre du haut, Ctrl+K)
(function selecteurDecks() {
  const champ = $("#aller"), liste = $("#aller-liste");
  let items = [], actif = 0;
  const fermer = () => { liste.hidden = true; champ.value = ""; };
  const marque = () => $$(".aller-item", liste).forEach((el, i) => el.classList.toggle("choisi", i === actif));
  const rendre = async () => {
    const ds = await listeDecks();
    const q = sansAccent(champ.value.trim());
    const score = (d) => !q ? 0 : sansAccent(d.titre).startsWith(q) ? 0 : sansAccent(d.titre).includes(q) ? 1 : 2;
    items = ds.filter((d) => !q || sansAccent(`${d.titre} ${d.commandant || ""}`).includes(q))
      .sort((a, b) => score(a) - score(b) || recence(b) - recence(a) || a.titre.localeCompare(b.titre)).slice(0, 10);
    actif = 0;
    liste.innerHTML = (items.length ? items.map((d, i) => `
        <a href="#/deck/${enc(d.id)}" class="aller-item ${i === actif ? "choisi" : ""}" role="option" data-i="${i}">
          <span class="identite">${identiteHtml(d.identite)}</span>
          <span class="aller-nom">${esc(d.titre)}</span>
          <span class="aller-cmd">${esc(d.commandant || "")}</span>
        </a>`).join("") : `<div class="aller-vide muet petit">Aucun deck ne correspond.</div>`)
      + `<div class="aller-pied petit"><a href="#/">Tous les decks (${ds.length})</a><span class="muet">↑↓ puis Entrée</span></div>`;
    liste.hidden = false;
  };
  champ.addEventListener("focus", rendre);
  champ.addEventListener("input", rendre);
  champ.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (items.length) { actif = (actif + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; marque(); }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (items[actif]) { location.hash = `#/deck/${enc(items[actif].id)}`; fermer(); champ.blur(); }
    } else if (ev.key === "Escape") { fermer(); champ.blur(); }
  });
  liste.addEventListener("mousemove", (ev) => {
    const a = ev.target.closest(".aller-item");
    if (a && +a.dataset.i !== actif) { actif = +a.dataset.i; marque(); }
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
      <div><h1>Mes decks</h1>
        <p class="muet petit" style="margin:0">${ds.length} deck${ds.length > 1 ? "s" : ""} · prix Cardmarket du jour (Scryfall) · Game Changers selon la liste officielle</p></div>
      <button class="btn btn-accent" id="btn-nouveau">+ Nouveau deck</button>
    </div>
    <div class="barre-outils">
      <input class="champ filtre" id="d-filtre" type="search" placeholder="Chercher un deck, un commandant ou une carte…" value="${esc(etat.filtreDecks || "")}" aria-label="Chercher un deck">
      <span class="outil"><span class="petit muet">Couleurs</span>
        <span class="choix-couleurs">${["W", "U", "B", "R", "G", "C"].map((x) => `<button type="button" class="couleur ${etat.couleurs.includes(x) ? "actif" : ""}"
          data-couleur="${x}" aria-pressed="${etat.couleurs.includes(x)}" title="${x === "C" ? "Decks incolores" : `Decks qui jouent le ${NOMS_COULEURS[x]}`}">${symbole(x)}</button>`).join("")}</span></span>
      <label class="outil petit muet">Trier par
        <select class="champ champ-petit" id="d-tri">${[["recent", "récents"], ["nom", "nom"], ["prix", "prix"], ["gc", "Game Changers"]].map(([v, l]) =>
          `<option value="${v}" ${PREF.get("tri-decks", "recent") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${segments("vue-decks", [["grille", "Grille"], ["liste", "Liste"]], "grille")}
    </div>
    <div id="d-resultats"></div>
    ${corbeille.length ? `
      <details class="panneau"><summary>Decks supprimés (${corbeille.length})</summary>
        <table class="tableau" style="margin-top:.6rem"><tbody>
          ${corbeille.map((c, i) => `<tr><td><strong>${esc(c.nom.replace(/^Deck /, ""))}</strong> <span class="muet petit">supprimé le ${esc(c.date)}</span></td>
            <td class="num"><button class="btn btn-petit" data-recup="${i}">Récupérer</button></td></tr>`).join("")}
        </tbody></table>
        <p class="muet petit">Ils sont rangés dans le dossier « Corbeille Atelier » du dossier MTG. Pour les effacer pour de bon, supprime-les là.</p>
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
    if (tr && !ev.target.closest("a")) location.hash = `#/deck/${enc(tr.dataset.deck)}`;
  });
  $$("[data-recup]").forEach((b) => b.addEventListener("click", async () => {
    try {
      const r = await api("/api/corbeille/recuperer", { method: "POST", body: { fichier: corbeille[+b.dataset.recup].fichier } });
      toast("Deck récupéré.");
      location.hash = `#/deck/${enc(r.id)}`;
    } catch (e) { erreur(e); }
  }));
}

function chiffresDeck(d) {
  const complet = d.total === 100;
  const al = Object.entries(d.alertes || {});
  return `
    <span class="badge ${complet ? "badge-ok" : "badge-alerte"}">${d.total} / 100 cartes</span>
    ${d.maybe ? `<span class="badge">${d.maybe} en Maybeboard</span>` : ""}
    <span class="badge">${euros(d.prix_total)}</span>
    <span class="badge ${d.gc.length ? "badge-gc" : ""}" title="${esc(d.gc.join(", "))}">${d.gc.length} Game Changer${d.gc.length > 1 ? "s" : ""}</span>
    ${!d.commandant ? `<span class="badge badge-alerte">pas de commandant</span>` : ""}
    ${al.length ? `<span class="badge badge-alerte" title="${esc(al.map(([n, a]) => `${n} : ${a.join(", ")}`).join("\n"))}">${al.length} carte${al.length > 1 ? "s" : ""} hors règles</span>` : ""}`;
}

function contientHtml(noms) {
  return noms && noms.length ? `<div class="contient petit">contient ${noms.map((n) => `<strong>${esc(n)}</strong>`).join(", ")}</div>` : "";
}

function carteDeck(d, noms) {
  return `
    <a class="carte-deck" href="#/deck/${enc(d.id)}">
      ${d.art ? `<img class="art" src="${esc(d.art)}" alt="" loading="lazy">` : `<div class="art"></div>`}
      <div class="corps">
        <div class="titre">${esc(d.titre)} <span class="identite">${identiteHtml(d.identite)}</span></div>
        <div class="muet petit">${esc(d.commandant || "pas encore de commandant")}</div>
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
    return !q || sansAccent(`${d.titre} ${d.commandant || ""}`).includes(q) || cartes[d.id];
  }).sort(TRIS_DECKS[PREF.get("tri-decks", "recent")] || TRIS_DECKS.recent);
  if (!etat.decks.length) { zone.innerHTML = `<p class="muet">Aucun deck pour l'instant : crée le premier avec « Nouveau deck ».</p>`; return; }
  if (!ds.length) { zone.innerHTML = `<p class="muet">Aucun deck ne correspond.</p>`; return; }
  const filtre = q || coul.length;
  const entete = filtre ? `<p class="muet petit">${ds.length} deck${ds.length > 1 ? "s" : ""} sur ${etat.decks.length}</p>` : "";
  const noms = (d) => sansAccent(`${d.titre} ${d.commandant || ""}`).includes(q) ? null : cartes[d.id];
  if (PREF.get("vue-decks", "grille") === "liste") {
    zone.innerHTML = entete + `<table class="tableau tableau-decks">
      <thead><tr><th>Deck</th><th>Couleurs</th><th class="num">Cartes</th><th class="num">Prix</th><th class="num">Game Changers</th><th class="num">Modifié</th></tr></thead>
      <tbody>${ds.map((d) => `<tr data-deck="${esc(d.id)}">
        <td><a href="#/deck/${enc(d.id)}"><strong>${esc(d.titre)}</strong></a><div class="muet petit">${esc(d.commandant || "pas encore de commandant")}</div>${contientHtml(noms(d))}</td>
        <td><span class="identite">${identiteHtml(d.identite)}</span></td>
        <td class="num ${d.total === 100 ? "" : "alerte-texte"}">${d.total}${d.maybe ? `<div class="muet petit">+${d.maybe} maybe</div>` : ""}</td>
        <td class="num">${euros(d.prix_total)}</td>
        <td class="num">${d.gc.length || ""}</td>
        <td class="num muet">${dateCourte(d.modifie)}</td></tr>`).join("")}</tbody></table>`;
  } else {
    zone.innerHTML = entete + `<div class="grille-decks">${ds.map((d) => carteDeck(d, noms(d))).join("")}</div>`;
  }
}

function modaleNouveauDeck() {
  let cmd = null, rech = null;
  ouvrirModale(`
    <h2>Nouveau deck</h2>
    <label class="bloc">Nom du deck<input class="champ" id="nd-nom" maxlength="60" placeholder="ex. Atraxa Proliférer"></label>
    <div class="bloc"><div>Commandant <span class="muet petit">(facultatif : tu pourras le choisir plus tard)</span></div>
      <div id="nd-cmd"></div><div id="nd-rech"></div></div>
    <details class="bloc"><summary>Coller une liste existante (facultatif)</summary>
      <textarea class="champ" id="nd-liste" rows="8" placeholder="1x Sol Ring [Ramp]&#10;1 Arcane Signet&#10;10 Mountain&#10;…"></textarea>
      <p class="muet petit">Export Archidekt (avec les tags entre crochets), Moxfield ou MTG Arena : une carte par ligne, la quantité devant.
        Les noms anglais sont corrigés automatiquement (majuscules, petites fautes).</p>
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
    rech = rechercheCarte($("#nd-rech", b), { deck: () => null, placeholder: "Chercher le commandant (français ou anglais)…",
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
  RECENTS.noter(id);
  vue.innerHTML = `
    <nav class="fil" aria-label="Fil d'Ariane"><a href="#/">Mes decks</a><span aria-hidden="true">›</span><span aria-current="page">${esc(d.titre)}</span></nav>
    <div class="entete-deck">
      <div class="bandeau" style="background-image:url('${esc(d.art)}')"></div>
      <div class="infos">
        <div>
          <h1>${esc(d.titre)}</h1>
          <div class="muet"><span data-image="${esc(d.image_cmd)}">${esc(d.commandant || "pas encore de commandant")}</span>
            ${d.identite ? `<span class="identite" title="Identité de couleur du commandant">${d.identite.length ? d.identite.map(symbole).join("") : symbole("C")}</span>` : ""}</div>
          <div class="chiffres" style="margin-top:.5rem">${chiffresDeck(d)}</div>
        </div>
        <div class="actions">
          <button class="btn btn-accent" id="btn-ajouter">Ajouter des cartes</button>
          <a class="btn" href="#/recherche?deck=${enc(id)}" title="Moteur de recherche (comme celui de Magic-Ville), lié à ce deck">Chercher des cartes</a>
          <button class="btn" id="btn-export">Copier pour Archidekt</button>
          <button class="btn ouvre-menu" id="btn-deck-menu" aria-label="Autres actions sur le deck" title="Autres actions">⋯</button>
        </div>
      </div>
    </div>
    ${d.note ? `<p class="note">${esc(d.note)}</p>` : ""}
    <nav class="onglets">${ONGLETS.map(([k, l]) => `<a href="#/deck/${enc(id)}/${k}" class="${k === onglet ? "actif" : ""}">${l}</a>`).join("")}</nav>
    <section id="contenu"></section>`;
  $("#btn-ajouter").onclick = () => modaleAjout();
  $("#btn-export").onclick = copierArchidekt;
  $("#btn-deck-menu").onclick = (ev) => ouvrirMenu(ev.currentTarget, [
    ["Copier pour Archidekt", copierArchidekt],
    ["Supprimer ce deck…", () => supprimerDeck(d), "btn-danger"],
  ]);
  const contenu = $("#contenu");
  if (onglet === "stats") return ongletStats(contenu, d);
  if (onglet === "bracket") return ongletBracket(contenu, d);
  if (onglet === "combos") return ongletCombos(contenu, d, extra);
  if (onglet === "simulation") return ongletSimulation(contenu, d, extra);
  if (onglet === "versions" || onglet === "historique") return ongletVersions(contenu, d);
  ongletListe(contenu, d);
}

async function copierArchidekt() {
  try {
    const txt = await api("/api/decks/" + enc(etat.deck.id) + "/export");
    await navigator.clipboard.writeText(txt);
    toast("Liste copiée : colle-la dans Archidekt (Import).");
  } catch (e) { erreur(e); }
}

async function supprimerDeck(d) {
  if (!confirm(`Supprimer le deck « ${d.titre} » ?\n\nSon dossier part dans « Corbeille Atelier » (dans le dossier MTG) : tu pourras le récupérer depuis l'accueil.`)) return;
  try {
    await api(`/api/decks/${enc(d.id)}/supprimer`, { method: "POST" });
    etat.deck = null;
    etat.decks = [];
    location.hash = "#/";
    toast(`Deck « ${d.titre} » supprimé : récupérable depuis l'accueil.`, 4000);
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
  "en double": "Une seule copie par carte en Commander (sauf les terrains de base et les cartes qui le permettent)",
  "interdite": "Carte bannie en Commander",
  "non légale": "Carte non légale en Commander (carte Un-, Alchimie…)",
};
const ORDRE_TYPES = ["Créatures", "Planeswalkers", "Batailles", "Éphémères", "Rituels", "Artefacts", "Enchantements", "Terrains", "Autres"];
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
  const h = sansAccent([c.nom, c.info.fr, c.info.type, typeCarte(c.info.type), ...c.tags].join(" | "));
  return sansAccent(q).split(/\s+/).every((m) => h.includes(m));
}

function grouper(cartes, rangement) {
  const g = new Map();
  const ajoute = (cle, c) => { if (!g.has(cle)) g.set(cle, []); g.get(cle).push(c); };
  for (const c of cartes) {
    if (c.cat === "Commander") ajoute("Commandant", c);
    else if (c.cat === "Maybeboard") ajoute("Maybeboard", c);
    else ajoute(rangement === "tags" ? c.cat : typeCarte(c.info.type), c);
  }
  const rang = (k) => k === "Commandant" ? -1 : k === "Maybeboard" ? 999
    : rangement === "tags" ? (k === "Sans catégorie" ? 998 : 0) : ORDRE_TYPES.indexOf(k);
  return [...g.keys()].sort((a, b) => rang(a) - rang(b)).map((k) => ({ cat: k, cartes: g.get(k) }));
}

function legendeCarte(c) {
  const f = c.info || {};
  return `${f.fr && f.fr !== c.nom ? f.fr + " — " : ""}${f.prix == null ? "prix inconnu" : euros(f.prix)}${f.prix_edition ? ` (${f.prix_edition})` : ""}${f.gc ? " · Game Changer" : ""}`;
}

function segments(pref, valeurs, def) {
  const v = PREF.get(pref, def);
  return `<div class="segments" role="group">${valeurs.map(([k, l]) =>
    `<button type="button" data-pref="${pref}" data-val="${k}" class="${k === v ? "actif" : ""}" aria-pressed="${k === v}">${l}</button>`).join("")}</div>`;
}

function ongletListe(el, d) {
  const al = Object.entries(d.alertes || {});
  el.innerHTML = `
    ${d.erreur_sim ? `<p class="erreur petit">Le simulateur n'a pas pu lire ce deck : ${esc(d.erreur_sim.non_lu[0])}</p>` : ""}
    ${!d.commandant && d.cartes.length ? `<p class="note">Pas encore de commandant : ouvre le menu ⋯ d'une carte légendaire et choisis « Définir comme commandant ».</p>` : ""}
    ${al.length ? `<p class="note"><strong>${al.length} carte${al.length > 1 ? "s" : ""} hors des règles du Commander :</strong>
      ${al.map(([n, a]) => `${esc(n)} (${a.map(esc).join(", ")})`).join(" · ")}</p>` : ""}
    ${!d.cartes.length ? `<div class="panneau vide"><p>Ce deck est vide.</p><button class="btn btn-accent" id="vide-ajouter">Ajouter des cartes</button></div>` : `
    <div class="barre-outils">
      ${segments("affichage", [["liste", "Liste"], ["visuel", "Visuel"]], "liste")}
      <span class="outil"><span class="petit muet">Ranger par</span>${segments("rangement", [["type", "type"], ["tags", "tags"]], "type")}</span>
      <label class="outil petit muet">Trier par
        <select class="champ champ-petit" id="tri">${[["cout", "coût"], ["nom", "nom"], ["prix", "prix"]].map(([v, l]) =>
          `<option value="${v}" ${PREF.get("tri", "cout") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <input class="champ filtre" id="filtre" type="search" placeholder="Filtrer : nom, type, tag…" value="${esc(etat.filtre)}" aria-label="Filtrer les cartes">
    </div>
    <div id="groupes"></div>
    <h2>Statistiques</h2>
    <div id="resume-stats">${resumeStats(d)}</div>
    <p><a href="#/deck/${enc(d.id)}/stats">Toutes les statistiques →</a></p>`}`;
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
    rendre();
  }));
  $("#tri", el).onchange = (ev) => { PREF.set("tri", ev.target.value); rendre(); };
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
  const visuel = PREF.get("affichage", "liste") === "visuel";
  const rangement = PREF.get("rangement", "type");
  const tri = TRIS[PREF.get("tri", "cout")] || TRIS.cout;
  const groupes = grouper(d.cartes.filter((c) => correspond(c, etat.filtre)), rangement);
  if (!groupes.length) { etat.ordre = []; zone.innerHTML = `<p class="muet">Aucune carte ne correspond à « ${esc(etat.filtre)} ».</p>`; return; }
  groupes.forEach((g) => g.cartes.sort(tri));
  etat.ordre = groupes.flatMap((g) => g.cartes.map((c) => c.index));     // pour « carte précédente / suivante » dans la fiche
  zone.innerHTML = groupes.map((g) => {
    const n = g.cartes.reduce((s, c) => s + c.n, 0);
    const prix = g.cartes.reduce((s, c) => s + (c.info.prix || 0) * c.n, 0);
    const titre = g.cat === "Maybeboard" ? "Maybeboard (hors deck)" : g.cat;
    return `<div class="groupe">
      <div class="groupe-titre"><span class="nb-groupe">${n}</span> ${esc(titre)} <span class="muet petit">${euros(prix)}</span></div>
      ${visuel ? `<div class="etale ${g.cartes.some((c) => c.n > 1) ? "avec-piles" : ""}">${g.cartes.map(carteVisuelle).join("")}</div>`
        : g.cartes.map((c) => ligneCarte(c, rangement)).join("")}
    </div>`;
  }).join("");
}

function badgesAlerte(c) {
  return (c.alertes || []).map((a) => `<span class="badge badge-alerte" title="${esc(TITRE_ALERTE[a] || "")}">${esc(a)}</span>`).join("");
}

function ligneCarte(c, rangement) {
  const f = c.info || {};
  const tags = c.tags.filter((t) => t !== "Maybeboard" && t !== "Commander" && !(rangement === "tags" && t === c.cat));
  const sim = c.sim && LIBELLE_SIM[c.sim.classe];
  const cher = (f.prix || 0) > 5;
  return `<div class="ligne ligne-carte" data-carte="${c.index}">
    <span class="qte">${c.n > 1 ? c.n + "×" : ""}</span>
    <span class="nom"><span class="en" data-image="${esc(f.image)}" data-legende="${esc(legendeCarte(c))}" ${cher ? 'data-cher="1"' : ""}>${esc(c.nom)}</span>${f.fr && f.fr !== c.nom ? `<span class="fr">${esc(f.fr)}</span>` : ""}
      ${tags.map((t) => `<button type="button" class="tag" data-tag="#${esc(t)}" title="Voir toutes les cartes « ${esc(t)} »">${esc(t)}</button>`).join("")}</span>
    ${mana(f.cout)}
    <span class="badges">
      ${badgesAlerte(c)}
      ${f.gc ? `<span class="badge badge-gc" title="Game Changer : compte dans le bracket (3 maximum en bracket 3)">Game Changer</span>` : ""}
      ${cher ? `<span class="badge badge-cher" title="Au-dessus de ton budget de 5 € par carte">&gt; 5 €</span>` : ""}
      ${sim ? `<span class="badge badge-sim" title="${esc(sim[1] + (c.sim.non_lu.length ? " :\n• " + c.sim.non_lu.join("\n• ") : ""))}">${sim[0]}</span>` : ""}
    </span>
    ${f.prix_lien ? `<a class="prix ${cher ? "cher" : ""}" href="${esc(f.prix_lien)}" target="_blank" rel="noopener" title="${esc(f.prix_edition ? `Le moins cher : ${f.prix_edition}. ` : "")}Voir sur Cardmarket">${euros(f.prix)}</a>` : `<span class="prix muet">${euros(f.prix)}</span>`}
    <button class="btn-menu" aria-label="Fiche et actions : ${esc(c.nom)}" title="Fiche et actions">⋯</button>
  </div>`;
}

// vue « étalée » façon Magic-Ville : les images, empilées quand il y a plusieurs exemplaires
function imageCarte(f, cls, style = "") {
  const src = f.petite || f.image;
  if (!src) return `<span class="${cls} sans-image" ${style}>${esc(f.nom || "?")}</span>`;
  const srcset = f.petite && f.image ? `srcset="${esc(f.petite)} 146w, ${esc(f.image)} 488w" sizes="170px"` : "";
  return `<img class="${cls}" ${style} src="${esc(src)}" ${srcset} alt="" loading="lazy">`;
}

function carteVisuelle(c) {
  const f = c.info || {};
  const nb = Math.min(c.n, 4);
  const cher = (f.prix || 0) > 5;
  const couches = [];
  for (let k = nb - 1; k >= 1; k--) couches.push(imageCarte(f, "couche", `style="--k:${k}"`));
  const marques = [
    f.gc ? `<span class="marque marque-gc" title="Game Changer">GC</span>` : "",
    ...(c.alertes || []).map((a) => `<span class="marque marque-alerte" title="${esc(TITRE_ALERTE[a] || "")}">${esc(a)}</span>`),
  ].join("");
  return `<div class="carte-v">
    <button type="button" class="pile" data-carte="${c.index}" data-survol="${c.index}" aria-label="${esc(c.nom)} : fiche et actions">${couches.join("")}${imageCarte(f, "recto")}${marques ? `<span class="marques">${marques}</span>` : ""}</button>
    <div class="legende-v" title="${esc(c.nom + (f.fr && f.fr !== c.nom ? " — " + f.fr : ""))}">
      ${c.n > 1 ? `<span class="qte-v">${c.n}</span>` : ""}<span class="nom-v">${esc(nomAffiche(c))}</span>
      <span class="prix-v ${cher ? "cher" : ""}">${euros(f.prix)}</span>
    </div>
  </div>`;
}

// fiche d'une carte (clic gauche sur une carte, en liste ou en visuel) : grande image, texte, prix, tags et actions
function ouvrirCarte(c) {
  if (!c) return;
  const d = etat.deck;
  const f = c.info || {};
  const ordre = etat.ordre || [];
  const pos = ordre.indexOf(c.index);
  const maybe = c.tags.includes("Maybeboard");
  const cmd = c.cat === "Commander";
  const legendaire = /Legendary|Background/.test(f.type || "") || /can be your commander/i.test(f.texte || "");
  const sim = c.sim && LIBELLE_SIM[c.sim.classe];
  const cher = (f.prix || 0) > 5;
  const tags = c.tags.filter((t) => t !== "Maybeboard" && t !== "Commander");
  ouvrirModale(`
    <div class="fiche-carte">
      <div class="fc-image">${f.image ? `<img src="${esc(f.image)}" alt="${esc(c.nom)}">` : `<div class="sans-image">${esc(c.nom)}</div>`}${lienVersion(c.version)}</div>
      <div class="fc-infos">
        <div class="fc-tete">
          <div><h2>${esc(c.nom)} ${mana(f.cout)}</h2>${f.fr && f.fr !== c.nom ? `<div class="muet">${esc(f.fr)}</div>` : ""}</div>
          <button class="btn btn-discret" id="fc-fermer" aria-label="Fermer">✕</button>
        </div>
        <div class="petit muet">${esc(f.fr_type || f.type || "")}${f.pt ? " · " + esc(f.pt) : ""}${cmd ? " · commandant" : maybe ? " · Maybeboard (hors deck)" : ""}</div>
        <div class="chiffres">
          ${f.prix_lien ? `<a class="badge ${cher ? "badge-cher" : ""}" href="${esc(f.prix_lien)}" target="_blank" rel="noopener" title="Voir sur Cardmarket">${euros(f.prix)}${f.prix_edition ? ` · ${esc(f.prix_edition)}` : ""} · Cardmarket ↗</a>`
            : `<span class="badge">${euros(f.prix)}</span>`}
          <a class="badge" href="${esc(f.gatherer || lienGatherer(c.nom))}" target="_blank" rel="noopener" title="La carte sur Gatherer, le site officiel de Wizards">Gatherer ↗</a>
          ${f.gc ? `<span class="badge badge-gc">Game Changer</span>` : ""}
          ${badgesAlerte(c)}
          ${sim ? `<span class="badge badge-sim" title="${esc(sim[1] + (c.sim.non_lu.length ? " :\n• " + c.sim.non_lu.join("\n• ") : ""))}">${sim[0]}</span>` : ""}
        </div>
        ${f.fr_texte || f.texte ? `<div class="texte fs-texte">${(f.fr_texte || f.texte).split("\n").map((l) => l.trim() === "//" ? "<hr>" : l.trim() ? `<p>${texteMana(l)}</p>` : "").join("")}</div>` : ""}
        ${f.fr_texte && f.texte ? `<details class="petit"><summary>Texte anglais (Oracle)</summary><div class="fs-texte" style="margin-top:.4rem">${f.texte.split("\n").map((l) => l.trim() === "//" ? "<hr>" : `<p>${texteMana(l)}</p>`).join("")}</div></details>` : ""}
        ${cmd ? "" : `
          <div class="fc-ligne"><span class="petit muet">Tags</span>
            ${tags.length ? tags.map((t, i) => `<span class="puce ${i === 0 ? "puce-1" : ""}">${i === 0 ? "★ " : ""}${esc(t)}</span>`).join("") : `<span class="muet petit">aucun</span>`}
            <button class="btn btn-petit" data-act="tags">Modifier</button></div>
          <div class="fc-ligne"><label class="petit muet" for="fc-n">Exemplaires</label>
            <input class="champ champ-petit" type="number" id="fc-n" min="1" max="99" value="${c.n}" style="width:4.5rem"></div>`}
        <div class="fc-actions">
          <button class="btn" data-act="remplacer">Remplacer… (même place)</button>
          <a class="btn" href="#/deck/${enc(d.id)}/combos/${enc(c.nom)}">Combos avec cette carte</a>
          ${cmd ? "" : `<button class="btn" data-act="maybe">${maybe ? "Remettre dans le deck" : "Passer en Maybeboard"}</button>`}
          ${cmd ? `<button class="btn" data-act="cmd">Ne plus en faire le commandant</button>`
            : !maybe && legendaire ? `<button class="btn" data-act="cmd">Définir comme commandant</button>` : ""}
          <button class="btn btn-danger" data-act="retirer">Retirer du deck</button>
        </div>
        ${pos >= 0 && ordre.length > 1 ? `
          <div class="fc-nav">
            <button class="btn btn-petit" data-act="prec" ${pos === 0 ? "disabled" : ""}>← Précédente</button>
            <span class="muet petit">${pos + 1} / ${ordre.length} · flèches du clavier</span>
            <button class="btn btn-petit" data-act="suiv" ${pos === ordre.length - 1 ? "disabled" : ""}>Suivante →</button>
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
      if (act === "remplacer") return modaleRemplacer(c);
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

async function modifier(op, c, extra = {}, message = "Enregistré. L'ancienne version est dans l'historique.") {
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
    <p class="muet petit">Les tags servent à ranger (« Ranger par tags »), à filtrer et à compter (onglet Statistiques). Ils partent aussi dans Archidekt.
      Le premier (★) range la carte : clique sur un autre tag pour le mettre en premier.</p>
    <div id="tags-carte" class="puces"></div>
    <div class="form-ligne">
      <input class="champ" id="tag-nouveau" list="liste-cat" placeholder="Nouveau tag (ex. Ramp, Draw, Removal…) puis Entrée" style="flex:1;min-width:200px">
      ${optionsCategories()}
      <button class="btn" id="tag-ajout">Ajouter</button>
    </div>
    <div class="petit muet" style="margin-top:.9rem">Tags déjà utilisés dans tes decks :</div>
    <div id="tags-dispo" class="puces"></div>
    <div class="boutons"><button class="btn" id="annuler">Annuler</button><button class="btn btn-accent" id="ok">Enregistrer</button></div>`, (b) => {
    const rendre = () => {
      $("#tags-carte", b).innerHTML = tags.length ? tags.map((t, i) => `<span class="puce ${i === 0 ? "puce-1" : ""}">
          <button type="button" class="puce-nom" data-premier="${i}" title="${i === 0 ? "Range la carte" : "Mettre en premier"}">${i === 0 ? "★ " : ""}${esc(t)}</button>
          <button type="button" data-ote="${i}" aria-label="Retirer ${esc(t)}">✕</button></span>`).join("")
        : `<span class="muet petit">Aucun tag : la carte est rangée « Sans catégorie » quand tu ranges par tags.</span>`;
      const dispo = tous.filter((t) => !tags.includes(t));
      $("#tags-dispo", b).innerHTML = dispo.map((t) => `<button type="button" class="puce puce-dispo" data-ajout="${esc(t)}">+ ${esc(t)}</button>`).join("")
        || `<span class="muet petit">aucun autre</span>`;
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
    <button type="button" class="lien-discret" data-act="version">Changer la version (visuel)</button>
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
      ${retour ? `<button type="button" class="btn btn-petit" data-retour>← Retour à la fiche</button>` : ""}
    </div>
    <p class="muet petit">${liste.length} impression${liste.length > 1 ? "s" : ""} avec image. Celle que tu choisis s'affiche partout dans l'Atelier et part dans l'export Archidekt.
      Le prix du deck reste celui de l'édition la moins chère.${nb("fr") ? " Archidekt ne note pas la langue : il montrera la même édition en anglais." : ""}</p>
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
function rechercheCarte(zone, { surChoix, deck = () => etat.deck, placeholder = "Nom en français ou en anglais…" }) {
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
    const cher = (x.prix || 0) > 5;
    return `<button type="button" class="res-carte ${i === actif ? "choisi" : ""}" data-i="${i}" role="option"
        data-image="${esc(x.image)}" data-legende="${esc(legende(x))}" ${cher ? 'data-cher="1"' : ""}>
      <span class="res-nom">${nomHtml(x)}</span>
      <span class="res-badges">${x.gc ? `<span class="badge badge-gc">Game Changer</span>` : ""}${x.legal === "banned" ? `<span class="badge badge-alerte">interdite</span>` : ""}${hors ? `<span class="badge badge-alerte">hors couleurs</span>` : ""}${deja ? `<span class="badge">déjà dans le deck</span>` : ""}</span>
      ${mana(x.cout)}
      <span class="prix ${cher ? "cher" : ""}">${prixHtml(x)}</span>
    </button>`;
  };
  const majPrix = (p) => {
    $$(".res-carte", res).forEach((el) => {
      const x = liste[+el.dataset.i];
      const q = p[x.nom];
      if (!q) return;
      x.prix = q.prix;
      x.prixFait = true;
      x.fr = x.fr || q.fr;
      const cher = (x.prix || 0) > 5;
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
  res.addEventListener("click", (ev) => { const b = ev.target.closest(".res-carte"); if (b) choisir(+b.dataset.i); });
  return { champ, vider() { numero++; champ.value = ""; liste = []; res.innerHTML = ""; champ.focus(); } };
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
          <span class="badge ${f.trop_cher ? "badge-cher" : "badge-ok"}">${euros(f.prix)}${f.prix_edition ? ` · ${esc(f.prix_edition)}` : ""}${f.trop_cher ? " · au-dessus de 5 €" : ""}</span>
          ${f.gc ? `<span class="badge badge-gc">Game Changer</span>` : ""}
          ${f.legal === "banned" ? `<span class="badge badge-alerte">interdite en Commander</span>` : ""}
          ${hors ? `<span class="badge badge-alerte">hors des couleurs du commandant</span>` : ""}
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
    <p class="muet petit">Tape un nom, choisis avec les flèches et Entrée (ou un clic), puis Entrée pour ajouter. La fenêtre reste ouverte pour la carte suivante.</p>
    <div id="rech"></div>
    <div id="fiche"></div>
    <div id="ajout-form" hidden>
      <div class="form-ligne">
        <label for="cat-ajout" class="petit">Tags</label>
        <input class="champ" style="flex:1;min-width:180px" id="cat-ajout" list="liste-cat" placeholder="facultatif : Ramp, Draw, Removal… (séparés par des virgules)" value="${esc(etat.dernierTags || "")}">
        ${optionsCategories()}
        <label class="petit">Quantité <input class="champ" type="number" id="qte-ajout" min="1" max="99" value="1" style="width:4.5rem"></label>
        <label class="petit"><input type="checkbox" id="maybe" ${etat.dernierMaybe ? "checked" : ""}> en Maybeboard (à tester)</label>
      </div>
    </div>
    <div id="journal" class="journal petit"></div>
    <div class="boutons"><button class="btn" id="fermer">Fermer</button><button class="btn btn-accent" id="ok" disabled>Ajouter au deck</button></div>`, (b) => {
    let choix = null;
    const rech = rechercheCarte($("#rech", b), {
      surChoix: async (x) => {
        choix = null;
        $("#ok", b).disabled = true;
        try {
          choix = await chargerFiche($("#fiche", b), x.nom, { surVersion: (g) => { choix = g; } });
          $("#ajout-form", b).hidden = false;
          $("#ok", b).disabled = false;
          $("#ok", b).textContent = `Ajouter ${choix.nom}`;
          $("#ok", b).focus();
        } catch (e) { $("#fiche", b).innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
      },
    });
    $("#fermer", b).onclick = fermerModale;
    $("#ok", b).onclick = async () => {
      if (!choix) return;
      const tags = $("#cat-ajout", b).value.split(",").map((t) => t.trim()).filter(Boolean);
      etat.dernierTags = $("#cat-ajout", b).value;
      etat.dernierMaybe = $("#maybe", b).checked;
      if (etat.dernierMaybe) tags.unshift("Maybeboard");
      const n = Math.max(1, +$("#qte-ajout", b).value || 1);
      $("#ok", b).disabled = true;
      const res = await modifier("ajouter", null, { nom: choix.nom, tags, n, edition: editionVersion(choix.version) }, "");
      if (!res) { $("#ok", b).disabled = false; return; }
      $("#journal", b).insertAdjacentHTML("afterbegin",
        `<div>✓ ${n > 1 ? n + "× " : ""}${esc(choix.nom)} ajoutée${etat.dernierMaybe ? " au Maybeboard" : ""} · le deck a ${res.total} cartes</div>`);
      choix = null;
      $("#fiche", b).innerHTML = "";
      $("#ajout-form", b).hidden = true;
      $("#qte-ajout", b).value = 1;
      $("#ok", b).textContent = "Ajouter au deck";
      rech.vider();
    };
  });
}

function modaleRemplacer(c) {
  ouvrirModale(`
    <h2>Remplacer ${esc(c.nom)}</h2>
    <p class="muet petit">La nouvelle carte prend la même place dans la liste et garde ses tags (les simulations restent comparables).</p>
    <div id="rech"></div>
    <div id="fiche"></div>
    <div class="boutons"><button class="btn" id="annuler">Annuler</button><button class="btn btn-accent" id="ok" disabled>Remplacer</button></div>`, (b) => {
    let choix = null;
    rechercheCarte($("#rech", b), {
      surChoix: async (x) => {
        choix = null;
        $("#ok", b).disabled = true;
        try {
          choix = await chargerFiche($("#fiche", b), x.nom, { surVersion: (g) => { choix = g; } });
          $("#ok", b).disabled = false;
          $("#ok", b).textContent = `Remplacer par ${choix.nom}`;
          $("#ok", b).focus();
        } catch (e) { $("#fiche", b).innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
      },
    });
    $("#annuler", b).onclick = fermerModale;
    $("#ok", b).onclick = () => { if (!choix) return; fermerModale(); modifier("remplacer", c, { nom: choix.nom, edition: editionVersion(choix.version) }); };
  });
}

// ------------------------------------------------------------------ statistiques (sous la liste et onglet Statistiques)
const COULEURS = [["W", "Blanc"], ["U", "Bleu"], ["B", "Noir"], ["R", "Rouge"], ["G", "Vert"]];
const nbCartes = (l) => l.reduce((s, c) => s + c.n, 0);
const estTerrain = (c) => typeCarte(c.info.type) === "Terrains";
const REPERES = [[/^(ramp|acc[eé]l[eé]ration)$/i, "≈ 10"], [/^(draw|card draw|pioche)$/i, "≈ 10"],
  [/^(removal|d[eé]gagement|anti-?cr[eé]atures?)$/i, "5 à 10"], [/^(board ?wipes?|wipes?|rase-?boards?)$/i, "≈ 5"],
  [/^(lands?|terrains?)$/i, "37-38"]];
const repere = (t) => (REPERES.find(([r]) => r.test(t.trim())) || [])[1] || "";

function nomsBulle(titre, cartes) {
  const noms = cartes.map((c) => (c.n > 1 ? c.n + "× " : "") + c.nom);
  return titre + (noms.length ? "\n" + noms.slice(0, 30).join("\n") + (noms.length > 30 ? `\n… et ${noms.length - 30} autres` : "") : "");
}

function calculStats(d) {
  const jeu = d.cartes.filter((c) => c.cat !== "Maybeboard");
  const bib = jeu.filter((c) => c.cat !== "Commander");            // les 99 : ce qu'on pioche
  const sorts = bib.filter((c) => !estTerrain(c));
  const terrains = bib.filter(estTerrain);
  const types = ORDRE_TYPES.map((t) => [t, bib.filter((c) => typeCarte(c.info.type) === t)]).filter(([, l]) => l.length);
  const courbe = Array.from({ length: 8 }, (_, k) => sorts.filter((c) => Math.min(7, Math.floor(c.info.mv || 0)) === k));
  const pips = (c, x) => ((c.info.cout || "").match(/\{[^}]+\}/g) || []).filter((s) => s.includes(x)).length;
  const couleurs = COULEURS.map(([x, nom]) => ({
    x, nom,
    cartes: sorts.filter((c) => pips(c, x) > 0),
    symboles: sorts.reduce((s, c) => s + pips(c, x) * c.n, 0),
    sources: terrains.filter((c) => (c.info.produit || []).includes(x)),
    autres: sorts.filter((c) => (c.info.produit || []).includes(x)),
  }));
  const incolores = sorts.filter((c) => !COULEURS.some(([x]) => pips(c, x) > 0));
  const n = nbCartes(sorts);
  const mvMoy = n ? sorts.reduce((s, c) => s + (c.info.mv || 0) * c.n, 0) / n : 0;
  return { jeu, bib, sorts, terrains, types, courbe, couleurs, incolores, mvMoy };
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

function hbarres(rows) {
  const max = Math.max(1, ...rows.map((r) => r.valeur));
  return `<div class="hbarres">${rows.map((r) => `
    <div class="hb" tabindex="0" data-bulle="${esc(r.bulle)}">
      <span class="hb-lib">${r.label}</span>
      <span class="hb-piste"><span class="hb-barre" style="width:${(r.valeur / max) * 100}%"></span></span>
      <span class="hb-val">${r.valeur}</span>
      <span class="hb-rep">${r.repere ? "repère " + esc(r.repere) : ""}</span>
    </div>`).join("")}</div>`;
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
  if (!S.bib.length) return `<p class="muet">Ajoute des cartes pour voir les statistiques.</p>`;
  return `<div class="grille-3">
    <div class="panneau"><h3>Cartes par type</h3>${colonnes(S.types.map(([t, l]) => ({ label: esc(ABREV[t]), valeur: nbCartes(l), bulle: nomsBulle(`${t} : ${nbCartes(l)}`, l) })))}</div>
    <div class="panneau"><h3>Cartes par couleur</h3>${grapheCouleurs(S)}</div>
    <div class="panneau"><h3>Courbe de mana</h3>${grapheCourbe(S)}<div class="muet petit" style="margin-top:.4rem">coût moyen ${virgule(S.mvMoy, 2)}, sans les terrains</div></div>
  </div>`;
}

function comb(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
const hyper = (N, K, n, k) => (comb(K, k) * comb(N - K, n - k)) / comb(N, n);

function tuile(lib, val, sous = "") {
  return `<div class="tuile"><div class="lib">${lib}</div><div class="val">${val}</div>${sous ? `<div class="sous">${sous}</div>` : ""}</div>`;
}

function ongletStats(el, d) {
  const S = calculStats(d);
  if (!S.bib.length) { el.innerHTML = `<p class="muet">Ajoute des cartes pour voir les statistiques.</p>`; return; }
  const N = nbCartes(S.bib), K = nbCartes(S.terrains);
  const p24 = N >= 7 ? [2, 3, 4].reduce((s, k) => s + hyper(N, K, 7, k), 0) : null;
  const tags = {};
  for (const c of S.jeu) for (const t of c.tags) if (t !== "Commander" && t !== "Maybeboard") (tags[t] ||= []).push(c);
  const lignesTags = Object.entries(tags).sort((a, b) => nbCartes(b[1]) - nbCartes(a[1]))
    .map(([t, l]) => ({ label: esc(t), valeur: nbCartes(l), bulle: nomsBulle(`${t} : ${nbCartes(l)}`, l), repere: repere(t) }));
  // couleurs du commandant (sinon celles que demandent les cartes) : Command Tower « produit » les 5, ça ne compte pas
  const coul = S.couleurs.filter((c) => d.identite ? d.identite.includes(c.x) : c.cartes.length);
  const colorees = S.sorts.filter((c) => coul.some((k) => k.cartes.includes(c)));
  const totC = nbCartes(colorees) || 1;         // part des sorts colorés qui demandent la couleur
  const totS = K || 1;                          // part des terrains qui la produisent
  const sansCouleur = S.terrains.filter((c) => !COULEURS.some(([x]) => (c.info.produit || []).includes(x)));
  const chers = S.jeu.filter((c) => c.info.prix).sort((a, b) => b.info.prix - a.info.prix).slice(0, 10);
  el.innerHTML = `
    <p class="muet petit">Calculées sur les ${N} cartes de la bibliothèque (sans le commandant ni le Maybeboard). Survole un graphique pour voir les cartes.</p>
    <div class="tuiles">
      ${tuile("Cartes", `${d.total} / 100`, `${N - K} sorts · ${K} terrains`)}
      ${tuile("Terrains", K, "repère : 37-38, avec ~10 ramp")}
      ${tuile("Coût moyen", virgule(S.mvMoy, 2), "des sorts, sans les terrains")}
      ${p24 == null ? "" : tuile("Main de départ", pct(p24, 0), "de chances d'avoir 2 à 4 terrains en 7 cartes")}
      ${tuile("Prix", euros(d.prix_total), "prix Cardmarket du jour")}
      ${tuile("Game Changers", d.gc.length, d.gc.length ? esc(d.gc.join(", ")) : "aucun")}
    </div>
    <div class="grille-deux">
      <div class="panneau"><h3>Courbe de mana</h3>${grapheCourbe(S, 170)}
        <div class="muet petit" style="margin-top:.4rem">Sorts de la bibliothèque, sans les terrains</div></div>
      <div class="panneau"><h3>Cartes par couleur</h3>${grapheCouleurs(S, 170)}
        <div class="muet petit" style="margin-top:.4rem">Sorts qui ont ce symbole dans leur coût (une carte bicolore compte dans les deux)</div></div>
    </div>
    <div class="grille-deux">
      <div class="panneau"><h3>Cartes par type</h3>${hbarres(S.types.map(([t, l]) => ({ label: esc(t), valeur: nbCartes(l), bulle: nomsBulle(`${t} : ${nbCartes(l)}`, l) })))}</div>
      <div class="panneau"><h3>Tags</h3>${lignesTags.length ? hbarres(lignesTags) +
        `<p class="muet petit">Repères du gabarit Magic-Casual : ~10 ramp, ~10 pioche, 5 à 10 removal, ~5 rase-boards, 37-38 terrains.</p>`
        : `<p class="muet petit">Aucun tag. Ajoute-en depuis le menu ⋯ d'une carte (« Tags… »).</p>`}</div>
    </div>
    <div class="panneau">
      <h3 style="margin-top:0">Base de mana</h3>
      <table class="tableau petit">
        <thead><tr><th>Couleur</th><th class="num">Cartes qui la demandent</th><th class="num">Symboles dans les coûts</th>
          <th class="num">Terrains qui la produisent</th><th class="num">Autres sources</th><th>Équilibre</th></tr></thead>
        <tbody>${coul.map((c) => {
          const pc = nbCartes(c.cartes) / totC, ps = nbCartes(c.sources) / totS;
          const eq = coul.length < 2 ? `<span class="muet">—</span>`
            : ps < pc * 0.8 ? `<span class="badge badge-alerte">peu de terrains</span>`
            : ps > pc * 1.5 + 0.05 ? `<span class="badge">beaucoup de terrains</span>` : `<span class="badge badge-ok">équilibré</span>`;
          return `<tr><td>${symbole(c.x)} ${c.nom}</td>
            <td class="num" data-bulle="${esc(nomsBulle(`${c.nom} : ${nbCartes(c.cartes)} cartes`, c.cartes))}">${nbCartes(c.cartes)} · ${pct(pc, 0)}</td>
            <td class="num">${c.symboles}</td>
            <td class="num" data-bulle="${esc(nomsBulle(`Terrains qui produisent du ${c.nom.toLowerCase()} : ${nbCartes(c.sources)}`, c.sources))}">${nbCartes(c.sources)} · ${pct(ps, 0)}</td>
            <td class="num" data-bulle="${esc(nomsBulle(`Autres sources (cailloux, créatures) : ${nbCartes(c.autres)}`, c.autres))}">${nbCartes(c.autres)}</td>
            <td>${eq}</td></tr>`;
        }).join("")}</tbody>
      </table>
      <p class="muet petit">Repère (Magic-Casual) : la part de terrains qui produisent une couleur doit suivre la part de cartes qui la demandent.
        Les pourcentages se lisent séparément : un terrain bicolore compte pour ses deux couleurs, une carte bicolore aussi.
        ${sansCouleur.length ? `<span data-bulle="${esc(nomsBulle("Terrains sans mana de couleur", sansCouleur))}" class="souligne">${nbCartes(sansCouleur)} terrain${nbCartes(sansCouleur) > 1 ? "s" : ""}</span> ne produisent pas de mana de couleur eux-mêmes (ceux qui vont chercher un terrain, utilitaires) : ils ne comptent pas ici.` : ""}</p>
    </div>
    <div class="panneau">
      <h3 style="margin-top:0">Main de départ</h3>
      <div class="form-ligne" style="margin-top:0">
        <button class="btn btn-accent" id="m-tirer">Nouvelle main</button>
        <button class="btn" id="m-mull">Mulligan</button>
        <button class="btn" id="m-piocher">Piocher une carte</button>
        <span class="muet petit" id="m-info"></span>
      </div>
      <div class="etale etale-main" id="m-cartes"></div>
    </div>
    <div class="panneau">
      <h3 style="margin-top:0">Les plus chères</h3>
      ${chers.map((c) => `<div class="ligne ligne-3">
        <span class="nom"><span class="en" data-image="${esc(c.info.image)}" data-legende="${esc(legendeCarte(c))}">${esc(c.nom)}</span>${c.info.fr && c.info.fr !== c.nom ? `<span class="fr">${esc(c.info.fr)}</span>` : ""}</span>
        ${mana(c.info.cout)}
        ${c.info.prix_lien ? `<a class="prix ${c.info.prix > 5 ? "cher" : ""}" href="${esc(c.info.prix_lien)}" target="_blank" rel="noopener">${euros(c.info.prix)}</a>` : `<span class="prix">${euros(c.info.prix)}</span>`}
      </div>`).join("")}
    </div>`;
  montageMain(el, S);
}

// tirage d'une main de départ, comme les testeurs d'Archidekt ou de Moxfield
function montageMain(el, S) {
  const bib = [];
  for (const c of S.bib) for (let k = 0; k < c.n; k++) bib.push(c);
  let pile = [], main = [], mull = 0;
  const rendre = () => {
    const t = main.filter(estTerrain).length;
    const conseil = mull === 0 ? "" : mull === 1 ? " · mulligan 1 : le premier est gratuit en multijoueur, tu gardes les 7"
      : ` · mulligan ${mull} : garde 7 cartes et remets-en ${mull - 1} sous ta bibliothèque`;
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
  if (!v.plus.length && !v.moins.length) return `<span class="muet">mêmes cartes que la liste actuelle</span>`;
  return (v.plus.length ? `<div><span class="muet">elle a en plus :</span> ${v.plus.map(esc).join(", ")}</div>` : "") +
    (v.moins.length ? `<div><span class="muet">elle n'a pas :</span> ${v.moins.map(esc).join(", ")}</div>` : "");
}

function ligneVersion(v, i) {
  const [lib, cls] = TYPE_VERSION[v.type];
  return `<tr>
    <td><strong>${esc(v.nom)}</strong> <span class="badge ${cls}">${lib}</span><br>
      <span class="muet petit">${esc(new Date(v.date * 1000).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }))} · ${v.total} cartes</span>
      ${v.note ? `<div class="petit">${esc(v.note)}</div>` : ""}</td>
    <td class="petit">${diffCourt(v)}</td>
    <td class="num">
      <button class="btn btn-petit" data-act="comparer" data-i="${i}">Comparer</button>
      <button class="btn btn-petit" data-act="simuler" data-i="${i}">Simuler</button>
      <button class="btn btn-petit" data-act="restaurer" data-i="${i}">Restaurer</button>
      ${v.type === "nommee" ? `<button class="btn btn-petit btn-danger" data-act="supprimer" data-i="${i}">Supprimer</button>` : ""}
    </td></tr>`;
}

async function ongletVersions(el, d) {
  el.innerHTML = `<p class="chargement">Chargement des versions…</p>`;
  const vs = await api(`/api/decks/${enc(d.id)}/versions`);
  const nommees = vs.filter((v) => v.type !== "auto");
  const auto = vs.filter((v) => v.type === "auto");
  const defautB = (nommees[0] || auto[0] || {}).fichier ?? "";
  el.innerHTML = `
    <div class="form-ligne" style="justify-content:space-between">
      <p class="muet" style="margin:0">Une version est une copie de la liste que tu gardes sous un nom, pour y revenir ou la comparer.
        Chaque modification garde aussi la liste précédente dans l'historique automatique.</p>
      <button class="btn btn-accent" id="btn-version">Enregistrer la liste actuelle comme version…</button>
    </div>

    <div class="panneau">
      <h3 style="margin-top:0">Comparer deux versions</h3>
      <div class="form-ligne">
        <select class="champ" style="flex:1;min-width:200px" id="cmp-a">${optionsVersions(vs, "")}</select>
        <span class="muet">et</span>
        <select class="champ" style="flex:1;min-width:200px" id="cmp-b">${optionsVersions(vs, defautB)}</select>
        <button class="btn" id="btn-cmp">Comparer</button>
      </div>
      <div id="cmp-res"></div>
    </div>

    <h2>Tes versions et anciennes listes</h2>
    ${nommees.length ? `<table class="tableau"><thead><tr><th>Version</th><th>Différences avec la liste actuelle</th><th></th></tr></thead>
      <tbody>${nommees.map((v) => ligneVersion(v, vs.indexOf(v))).join("")}</tbody></table>`
      : `<p class="muet">Aucune version enregistrée pour l'instant.</p>`}

    <details ${nommees.length ? "" : "open"}><summary>Historique automatique (${auto.length} ancienne${auto.length > 1 ? "s" : ""} liste${auto.length > 1 ? "s" : ""})</summary>
      ${auto.length ? `<table class="tableau" style="margin-top:.5rem"><thead><tr><th>Avant la modification</th><th>Différences avec la liste actuelle</th><th></th></tr></thead>
        <tbody>${auto.map((v) => ligneVersion(v, vs.indexOf(v))).join("")}</tbody></table>` : `<p class="muet">Vide : chaque modification y gardera la liste précédente.</p>`}
    </details>`;

  $("#btn-version").onclick = () => ouvrirModale(`
    <h2>Enregistrer une version</h2>
    <p class="muet petit">Une copie de la liste actuelle, sous un nom que tu choisis.</p>
    <label>Nom<input class="champ" id="v-nom" placeholder="ex. Avant le tournoi, Version Champion de la voie…"></label>
    <label style="display:block;margin-top:.6rem">Note (facultatif)<textarea class="champ" id="v-note" rows="3" placeholder="Ce qui change, pourquoi…"></textarea></label>
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
      if (!confirm(`Remplacer la liste actuelle par « ${v.nom} » ? La liste actuelle sera gardée dans l'historique.`)) return;
      try {
        await api(`/api/decks/${enc(d.id)}/restaurer`, { method: "POST", body: { fichier: v.fichier } });
        toast("Version restaurée.");
        location.hash = `#/deck/${enc(d.id)}/liste`;
      } catch (e) { erreur(e); }
    } else if (b.dataset.act === "supprimer") {
      if (!confirm(`Supprimer la version « ${v.nom} » ? Ça ne touche pas à la liste actuelle.`)) return;
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
        ${mana(f.cout)}<span class="prix ${(f.prix || 0) > 5 ? "cher" : ""}">${euros(f.prix)}</span></div>`;
    };
    const colonne = (v, cartes) => `<div>
      <h3>Seulement dans « ${esc(v.nom)} » <span class="muet">(${cartes.length})</span></h3>
      ${cartes.length ? cartes.map(carte).join("") : `<p class="muet">rien</p>`}</div>`;
    zone.innerHTML = `
      <table class="tableau petit" style="margin-top:.8rem">
        <thead><tr><th></th><th>${esc(c.a.nom)}</th><th>${esc(c.b.nom)}</th></tr></thead>
        <tbody>
          <tr><td>Cartes</td><td>${c.a.total}</td><td>${c.b.total}</td></tr>
          <tr><td>Prix (Cardmarket du jour)</td><td>${euros(c.a.prix)}</td><td>${euros(c.b.prix)}</td></tr>
          <tr><td>Game Changers</td><td>${c.a.gc.map(esc).join(", ") || "aucun"}</td><td>${c.b.gc.map(esc).join(", ") || "aucun"}</td></tr>
          <tr><td>Cartes en commun</td><td colspan="2">${c.communes}</td></tr>
        </tbody>
      </table>
      ${!c.seulement_a.length && !c.seulement_b.length ? `<p class="muet">Ces deux versions ont exactement les mêmes cartes.</p>` :
        `<div class="grille-2">${colonne(c.a, c.seulement_a)}${colonne(c.b, c.seulement_b)}</div>
         <div class="boutons"><button class="btn btn-accent" id="cmp-sim">Simuler « ${esc(c.a.nom)} » contre « ${esc(c.b.nom)} »</button></div>`}`;
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
  return noms.length ? noms.map((n) => `<span class="badge">${esc(n)}</span>`).join(" ") : `<span class="muet">aucune</span>`;
}

function blocCombo(c, presque) {
  return `<div class="panneau" style="margin-top:.6rem">
    <div><strong>${c.cartes.map((n) => presque && c.manque.includes(n) ? `<span style="color:var(--accent)">${esc(n)} (manque)</span>` : esc(n)).join(" + ")}</strong>
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
  el.innerHTML = `<p class="chargement">Analyse du bracket (Commander Spellbook peut prendre quelques secondes)…</p>`;
  const b = await api(`/api/decks/${enc(d.id)}/bracket${force ? "?force=1" : ""}`);
  const sb = b.spellbook;
  const dansDeck = new Set(b.gc);
  el.innerHTML = `
    <div class="grille-2">
      <div class="panneau">
        <div class="muet petit">Estimation selon les règles officielles</div>
        <div class="gros-chiffre">${b.estime ? "Bracket " + b.estime : "Deck illégal"}</div>
        <ul class="petit">${b.raisons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      </div>
      <div class="panneau">
        <div class="muet petit">Estimation de Commander Spellbook</div>
        ${sb ? `<div class="gros-chiffre">${sb.bracket ? "Bracket " + sb.bracket : esc(sb.libelle)}</div>
          <div class="petit muet">catégorie « ${esc(sb.libelle)} » · calculée le ${new Date(sb.date * 1000).toLocaleDateString("fr-FR")}</div>`
          : `<p class="erreur petit">Commander Spellbook ne répond pas : ${esc(b.spellbook_erreur || "")}</p>`}
        <button class="btn btn-petit" id="btn-recalc" style="margin-top:.6rem">Recalculer</button>
      </div>
    </div>

    <h2>Game Changers du deck</h2>
    <p>${listeCartes(b.gc)}</p>
    <details><summary>Liste officielle complète (${b.gc_liste.length} cartes${b.gc_maj ? `, mise à jour le ${new Date(b.gc_maj * 1000).toLocaleDateString("fr-FR")}` : ""})</summary>
      <p>${b.gc_liste.map((n) => `<span class="badge ${dansDeck.has(n) ? "badge-gc" : ""}">${esc(n)}</span>`).join(" ")}</p>
    </details>

    <h2>Combos dans le deck</h2>
    ${sb && sb.combos.length ? sb.combos.map((c) => blocCombo(c, false)).join("") : `<p class="muet">Aucune combo connue de Commander Spellbook.</p>`}

    <div class="grille-2" style="margin-top:1rem">
      <div><h3>Tuteurs</h3><p>${listeCartes(b.tuteurs)}</p></div>
      <div><h3>Tours supplémentaires</h3><p>${listeCartes(b.tours)}</p></div>
      <div><h3>Destruction massive de terrains</h3><p>${listeCartes(b.mld)}</p></div>
    </div>

    <p class="petit"><a href="#/deck/${enc(d.id)}/combos">Toutes les combos (MTGPics, Spellbook, Claude) : onglet Combos →</a></p>

    <h2>Rappel des règles</h2>
    <table class="tableau petit">
      <thead><tr><th>Bracket</th><th>Esprit</th><th>Game Changers</th><th>Combo infinie à 2 cartes</th><th>Tours supplémentaires</th><th>Destruction massive de terrains</th></tr></thead>
      <tbody>${REGLES_BRACKETS.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
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
    ${(f.prix || 0) > 5 ? 'data-cher="1"' : ""}>${esc(f.fr || f.nom)}</button>`;
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
        : ` <button type="button" class="btn btn-petit" data-maybe="${esc(manque[0].nom)}">+ Maybeboard</button>`) : "";
      etatCarte = `Pas dans le deck : ${manque.map((f) => `${esc(f.fr || f.nom)} <span class="${(f.prix || 0) > 5 ? "cher" : "muet"}">${euros(f.prix)}</span>`).join(" · ")}${maybe}`;
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
        ${etapes.length ? `<ol class="etapes petit">${etapes.map((l) => `<li>${esc(l)}</li>`).join("")}</ol><p class="petit muet">Étapes en anglais (Commander Spellbook).</p>` : ""}
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
    <p class="muet petit" style="margin-top:.8rem">Clique sur une carte pour voir toutes ses combos.</p>
    <div id="cb-mtgpics" class="petit ligne-outil"></div>
    <div id="cb-claude" class="petit ligne-outil"></div>`;
  rendreMtgpics($("#cb-mtgpics", zone), d, r.mtgpics, () => vueCombosDeck(zone, d));
  rendreClaude($("#cb-claude", zone), d, r.synergies, () => vueCombosDeck(zone, d));
}

// Combos MTGPics : lues carte par carte (une requête toutes les 1,5 s), gardées 30 jours
function rendreMtgpics(zone, d, st, apres) {
  if (!st) return;
  if (st.actif) {
    zone.innerHTML = `<span class="pulse">●</span> MTGPics : ${st.fait} carte${st.fait > 1 ? "s" : ""} sur ${st.total}… (tu peux changer de page)`;
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
    ? `Combos MTGPics : ${st.connues} carte${st.connues > 1 ? "s" : ""} du deck sur ${st.cartes} regardée${st.connues > 1 ? "s" : ""}.
       <button class="btn btn-petit" id="btn-mtgpics">Chercher pour ${reste === st.cartes ? "toutes les cartes" : `les ${reste} autres`} (≈ ${minutes} min)</button>`
    : `Combos MTGPics : les ${st.cartes} cartes du deck ont été regardées (moins de 30 jours).`;
  if (st.erreur) zone.insertAdjacentHTML("beforeend", ` <span class="erreur">${esc(st.erreur)}</span>`);
  const b = $("#btn-mtgpics", zone);
  if (b) b.onclick = async () => {
    try { rendreMtgpics(zone, d, await api(`/api/decks/${enc(d.id)}/mtgpics`, { method: "POST", body: {} }), apres); }
    catch (e) { erreur(e); }
  };
}

function rendreClaude(zone, d, st, apres) {
  if (st.actif) {
    zone.innerHTML = `<span class="pulse">●</span> Claude cherche les synergies du deck… (1 à 3 minutes, tu peux changer de page)`;
    (async () => {
      while (zone.isConnected) {
        await attendre(3000);
        const s = await api(`/api/decks/${enc(d.id)}/synergies`).catch(() => null);
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
    ${r ? `Synergies de Claude du ${new Date(r.date * 1000).toLocaleDateString("fr-FR")}${st.a_jour ? "" : " (la liste a changé depuis)"}.`
        : "Claude peut ajouter les synergies du deck en lisant chaque carte (1 à 3 minutes, compte dans ta limite Claude)."}
    <button class="btn btn-petit" id="btn-claude">${r ? "Relancer" : "Chercher les synergies avec Claude"}</button>`;
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
    <div id="cb-liste">${carte ? "" : `<p class="muet">Choisis une carte pour voir les cartes qui combotent avec elle.</p>`}</div></div>`;
  const champ = $("#cb-carte", zone), coul = $("#cb-couleurs", zone), liste = $("#cb-liste", zone), src = $("#cb-src", zone);
  let courante = carte;

  const afficher = async (force = false) => {
    if (!courante) return;
    const nom = courante;
    src.innerHTML = "";
    liste.innerHTML = `<p class="chargement">Combos de ${esc(affiche(nom))}… (MTGPics : quelques secondes la première fois)</p>`;
    let r;
    try { r = await api(`/api/decks/${enc(d.id)}/combos/carte?nom=${enc(nom)}&couleurs=${coul.checked ? 1 : 0}${force ? "&force=1" : ""}`); }
    catch (e) { liste.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; return; }
    if (nom !== courante) return;
    const m = r.mtgpics;
    src.innerHTML = m ? `<span class="muet">MTGPics : ${m.ref === null ? "carte introuvable"
        : `${m.total} combo${m.total > 1 ? "s" : ""}${m.lues < m.pages ? ` (les ${m.lues * 20} plus fortes)` : ""}, lue${m.total > 1 ? "s" : ""} le ${new Date(m.date * 1000).toLocaleDateString("fr-FR")}`}.</span>
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
    <div class="segments" role="group" style="margin-bottom:1rem">
      <button type="button" data-vue="deck">Le deck</button>
      <button type="button" data-vue="carte">Une carte</button>
    </div>
    <div id="cb-vue"></div>`;
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
      b.outerHTML = `<span class="badge badge-ok">✓ ajoutée au Maybeboard</span>`;
      toast("Ajoutée au Maybeboard. L'ancienne liste est dans l'historique.");
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
  if (c.corps?.length) parts.push(`${c.corps.length} créature${c.corps.length > 1 ? "s" : ""} jouée${c.corps.length > 1 ? "s" : ""} comme simple corps (${c.corps.map(esc).join(", ")})`);
  if (c.sans_effet?.length) parts.push(`${c.sans_effet.length} sort${c.sans_effet.length > 1 ? "s" : ""} sans effet (${c.sans_effet.map(esc).join(", ")})`);
  if (c.partiel?.length) parts.push(`${c.partiel.length} carte${c.partiel.length > 1 ? "s" : ""} lue${c.partiel.length > 1 ? "s" : ""} en partie (${c.partiel.map(esc).join(", ")})`);
  return parts.length ? `<p class="note petit"><strong>« ${esc(v.nom)} » :</strong> le simulateur ne comprend pas tout. ${parts.join(" ; ")}.
    Ces cartes sont sous-estimées dans les résultats.</p>` : "";
}

function afficheRapport(zone, r) {
  const A = r.versions.A, B = r.versions.B;
  const lignes = r.tables.map((t) => {
    const x = r.resultats[t];
    return `<tr>
      <td><strong>${esc(t === "Mixte" ? "Mixte (3 archétypes au hasard)" : t)}</strong></td>
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
      <p class="muet petit">${r.n} parties par table et par liste · 4 joueurs · au plus 15 tours · façon de jouer « ${esc(reg.pilote || "vite")} »
        ${reg.premier?.length ? ` · en premier : ${reg.premier.map(esc).join(", ")}` : ""}${reg.garder?.length ? ` · gardées pour la salve : ${reg.garder.map(esc).join(", ")}` : ""}
        · calcul en ${r.duree} s</p>
      <p><strong>A</strong> = ${esc(A.nom)}${B ? ` · <strong>B</strong> = ${esc(B.nom)}` : ""}</p>
      ${couvertureHtml(A)}${B ? couvertureHtml(B) : ""}
      <table class="tableau">
        <thead><tr><th>Table</th><th class="num">Victoires A</th>${B ? `<th class="num">Victoires B</th><th class="num">Écart A − B</th>` : ""}
          <th class="num">Fin moyenne</th><th class="num">Tes PV au tour 8</th><th class="num">Commandant au tour 5</th></tr></thead>
        <tbody>${lignes}</tbody>
      </table>
      <p class="muet petit">Repère : un deck moyen gagne 25 % à 4 joueurs. ${B ? "Un écart compte seulement s'il est en couleur (la marge ne contient pas 0). " : ""}
        Les pourcentages seuls varient d'environ ±1,5 point : compare plutôt des versions entre elles.</p>
      ${details}
      <div class="boutons"><button class="btn" id="rap-claude">Demander à Claude d'expliquer ce rapport</button></div>
    </div>`;
  $("#rap-claude", zone).onclick = () => ouvrirChat(`Explique-moi le rapport de simulation ${r.deck}/simulations/${zone.dataset.fichier || ""} (${A.nom}${B ? " contre " + B.nom : ""}) : qu'est-ce qui ressort, et que me conseilles-tu ?`);
}

function puces(liste, nom) {
  return `<div class="puces">${liste.map((n, i) => `<span class="puce">${esc(n)}<button data-ote="${nom}" data-i="${i}" aria-label="Retirer">✕</button></span>`).join("") || `<span class="muet petit">aucune</span>`}</div>`;
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
    <div class="panneau">
      <div class="grille-2">
        <label>Liste à tester (A)<select class="champ" id="s-a">${optionsVersions(o.versions, choixA)}</select></label>
        <label>Comparer avec (B)<select class="champ" id="s-b">${optionsVersions(o.versions, choixB, true, true)}</select></label>
      </div>
      <fieldset><legend>Tables d'adversaires (3 adversaires du même archétype, ou Mixte)</legend>
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
            <div><div class="petit"><strong>Cartes à poser en premier</strong> (avant tout le reste, dès qu'on peut les payer)</div>
              <div id="p-premier">${puces(R.premier, "premier")}</div>
              <select class="champ" id="add-premier" style="margin-top:.3rem"><option value="">+ ajouter une carte…</option>${cartesDeck.map((n) => `<option>${esc(n)}</option>`).join("")}</select></div>
            <div><div class="petit"><strong>Cartes à garder pour une salve</strong> (même en jouant « tout de suite »)</div>
              <div id="p-garder">${puces(R.garder, "garder")}</div>
              <select class="champ" id="add-garder" style="margin-top:.3rem"><option value="">+ ajouter une carte…</option>${cartesDeck.map((n) => `<option>${esc(n)}</option>`).join("")}</select></div>
          </div>
          <div class="form-ligne"><button class="btn btn-petit" id="r-sauver">Enregistrer comme réglages du deck</button>
            <button class="btn btn-petit" id="r-defaut">Revenir aux réglages par défaut</button>
            <span class="muet petit">Pour une consigne en français (« pose les cartes qui font piocher avant de défausser »), passe par la Discussion.</span></div>
        </details>
      </fieldset>
      <div class="boutons"><button class="btn btn-accent" id="s-lancer">Lancer la simulation</button></div>
      <div id="s-prog"></div>
    </div>
    <div id="s-rapport"></div>
    <h2>Rapports enregistrés</h2>
    ${rapports.length ? `<table class="tableau"><thead><tr><th>Date</th><th>Listes</th><th class="num">Victoires (${"table résumée"})</th><th class="num">Écart</th><th></th></tr></thead><tbody>
      ${rapports.map((r, i) => `<tr><td class="petit">${esc(new Date(r.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }))}<br><span class="muet">${r.n} parties · ${r.tables.length} table${r.tables.length > 1 ? "s" : ""} · ${esc(r.pilote)}</span></td>
        <td class="petit">A : ${esc(r.versions.A)}${r.versions.B ? `<br>B : ${esc(r.versions.B)}` : ""}</td>
        <td class="num">${esc(r.table_resume)} : ${pct(r.victoire_a)}${r.victoire_b != null ? ` / ${pct(r.victoire_b)}` : ""}</td>
        <td class="num">${ecartHtml(r.ecart)}</td>
        <td class="num"><button class="btn btn-petit" data-rap="${i}">Ouvrir</button></td></tr>`).join("")}
    </tbody></table>` : `<p class="muet">Aucun rapport pour l'instant.</p>`}`;

  const duree = () => {
    const n = +$("#s-n", el).value, nt = $$("[name=table]:checked", el).length, nv = $("#s-b", el).value === "__aucune__" ? 1 : 2;
    const s = Math.ceil((n * nt * nv * 0.012) / o.coeurs) + 2;
    $("#s-duree", el).textContent = `${n * nt * nv} parties, environ ${s < 90 ? s + " s" : Math.round(s / 60) + " min"} sur ${o.coeurs} cœurs`;
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
    try { await api(`/api/decks/${enc(d.id)}/reglages`, { method: "POST", body: lireReglages() }); toast("Réglages enregistrés pour ce deck."); }
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
        <button class="btn btn-petit" id="s-stop">Arrêter</button></div>`;
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
const RCH_DEFAUTS = { fr: "1", en: "1", cm: "1", tm: "1", mvx: "1", fx: "1", ex: "1", img: "1", format: "commander", ordre: "couleur" };
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
const RCH_GC = [["", "Game Changers : indifférent"], ["sans", "Sans Game Changer"], ["seul", "Game Changers seulement"]];
const RCH_RARETE_NOM = { c: "commune", u: "inhabituelle", r: "rare", m: "mythique", s: "spéciale", b: "bonus" };
const rch = { crit: null, deck: null, res: null, editions: null, fonctions: null, ouvert: true, numero: 0, journal: {} };

const lettresWUBRG = (s, permis = "WUBRG") => [...permis].filter((k) => (s || "").includes(k)).join("");

function critDepuis(params) {
  const c = { ...RCH_DEFAUTS };
  for (const [k, v] of params) c[k] = v;
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

function rchNombres(titre, cle, x, c) {
  return `<section class="fen fen-nombres"><h3 class="fen-titre">${titre}</h3>
    <div class="rch-nombres">
      <label>Égal à ${rchChamp(cle, c, 'inputmode="decimal" size="3"')}</label>
      <label>Max ${rchChamp(cle + "max", c, 'inputmode="decimal" size="3"')}</label>
      <label>Min ${rchChamp(cle + "min", c, 'inputmode="decimal" size="3"')}</label>
    </div>
    <div class="rch-cases">${rchCase(x, cle === "mv" ? "X inclus" : "* inclus", c)}${cle === "mv" ? rchCase("pair", "pair", c) + rchCase("impair", "impair", c) : ""}</div>
  </section>`;
}

function formulaireRecherche(c) {
  const d = rch.deck;
  const fonctions = [["", "Fonction : toutes"], ...(rch.fonctions || []).map((f) => [f.cle, f.nom])];
  return `<form id="moteur" class="moteur" autocomplete="off">
    <div class="mt-nom">
      <input class="champ" name="nom" type="search" value="${esc(c.nom || "")}" placeholder="Titre : nom de la carte, en français ou en anglais…" aria-label="Titre de la carte">
      <button class="btn btn-accent" type="submit">Rechercher</button>
      <button class="btn" type="button" data-act="raz" title="Remettre toutes les fenêtres à zéro">Tout effacer</button>
    </div>
    <div class="fenetres">
      <section class="fen fen-manas"><h3 class="fen-titre">Manas</h3>
        <div class="rch-rangee"><span>Doivent faire partie du coût</span>${rchSymboles("doit", c.doit)}</div>
        <div class="rch-rangee"><span>Peuvent faire partie du coût</span>${rchSymboles("peut", c.peut)}</div>
        <div class="rch-rangee"><span>Peuvent être multiples</span>${rchSymboles("mult", c.mult)}</div>
        <label class="rch-ligne-champ">Ou saisissez un coût ${rchChamp("cout", c, 'placeholder="2BR, U?, 1**" size="9" title="Chiffres = mana générique ; ? = un mana générique quelconque ; * = un mana coloré quelconque ; l\'hybride compte pour ses deux couleurs. Prioritaire sur les trois rangées."')}</label>
        ${rchSelect("spe", RCH_SPE, c)}
      </section>
      <section class="fen fen-couleurs"><h3 class="fen-titre">Couleurs</h3>
        ${rchSymboles("coul", c.coul, "WUBRGC")}
        <div class="rch-cases">${rchRadio("cm", "1", "Au moins une", c)}${rchRadio("cm", "2", "Toutes", c)}</div>
        <div class="rch-cases">${rchCase("seules", "Uniquement celle(s) choisie(s)", c)}${rchCase("id", "Id. couleur", c)}</div>
        ${d && d.identite ? `<button type="button" class="lien-discret" data-act="identite" title="Cartes jouables dans ce deck : couleurs du commandant et incolores">Couleurs de ${esc(d.titre)} ${identiteHtml(d.identite)}</button>` : ""}
      </section>
      <section class="fen fen-types"><h3 class="fen-titre">Types</h3>
        <div class="rch-types">${RCH_TYPES.map(([k, l]) => `<label class="rch-case"><input type="checkbox" name="types" value="${k}" ${(c.types || "").split(",").includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div>
        <div class="rch-cases">${rchRadio("tm", "1", "Au moins un", c)}${rchRadio("tm", "2", "Tous", c)}</div>
        ${rchSelect("spt", RCH_SPT, c)}
      </section>
      <section class="fen fen-texte"><h3 class="fen-titre">Recherche texte</h3>
        <div class="rch-cases">${rchCase("fr", "français", c)}${rchCase("en", "anglais", c)}</div>
        <label class="rch-bloc">Type <input class="champ champ-petit" name="type" value="${esc(c.type || "")}" placeholder="gobelin, légendaire, equipment…"></label>
        <div class="rch-bloc"><span class="rch-texte-tete">Texte ${rchCase("vanilla", "sans texte", c)}</span>
          <textarea class="champ" name="texte" rows="2" placeholder="défaussez, &quot;chaque adversaire&quot;, !additio…">${esc(c.texte || "")}</textarea></div>
        <p class="petit muet rch-aide">Tous les mots doivent y être, dans n'importe quel ordre. « "…" » : expression exacte ; « !mot » : sans ce mot.</p>
      </section>
      <section class="fen fen-options"><h3 class="fen-titre">Options</h3>
        <div class="rch-cases rch-colonne">${rchCase("img", "Affichage graphique", c)}${rchCase("versions", "Toutes les versions", c)}${rchCase("fun", "Cartes fantaisie (Un-sets)", c)}</div>
      </section>
      ${rchNombres("Valeur de mana", "mv", "mvx", c)}
      ${rchNombres("Force", "f", "fx", c)}
      ${rchNombres("Endurance", "e", "ex", c)}
      <section class="fen fen-format"><h3 class="fen-titre">Format</h3>${rchBascules("format", RCH_FORMATS, c.format || "", true)}</section>
      <section class="fen fen-rarete"><h3 class="fen-titre">Rareté</h3>${rchBascules("rar", RCH_RARETES, c.rar || "")}</section>
      <section class="fen fen-atelier"><h3 class="fen-titre">En plus de Magic-Ville</h3>
        <div class="rch-nombres">
          <label>Prix max ${rchChamp("prixmax", c, 'inputmode="decimal" size="4"')} €</label>
          <label>Prix min ${rchChamp("prixmin", c, 'inputmode="decimal" size="4"')} €</label>
          <button type="button" class="btn btn-petit" data-act="budget" title="Ton budget habituel">≤ 5 €</button>
        </div>
        ${rchSelect("fn", fonctions, c)}
        ${rchSelect("gc", RCH_GC, c)}
        ${d ? rchCase("horsdeck", `Pas déjà dans ${esc(d.titre)}`, c) : ""}
        <p class="petit muet rch-aide">Fonctions : classement Scryfall Tagger (removal, ramp, pioche…). Prix : le moins cher, toutes éditions.</p>
      </section>
      <section class="fen fen-editions"><h3 class="fen-titre">Éditions</h3>
        <div class="eds-tete">
          <input class="champ champ-petit" type="search" id="eds-filtre" placeholder="Chercher une édition (nom ou code)…" aria-label="Chercher une édition">
          ${rchCase("neuves", "Nouvelles cartes uniquement", c)}
        </div>
        <div id="eds-choisies" class="puces"></div>
        <div id="eds-groupes" class="eds-groupes"><p class="muet petit">Éditions…</p></div>
      </section>
    </div>
    <div class="mt-pied"><button class="btn btn-accent" type="submit">Rechercher</button></div>
  </form>`;
}

// ---- lire le formulaire
function lireFormulaire(form) {
  const c = {};
  const val = (n) => (form.elements[n] ? form.elements[n].value.trim() : "");
  for (const n of ["nom", "type", "texte", "cout", "mv", "mvmax", "mvmin", "f", "fmax", "fmin", "e", "emax", "emin", "prixmax", "prixmin", "spe", "spt", "fn", "gc"]) c[n] = val(n);
  for (const n of ["fr", "en", "vanilla", "seules", "id", "mvx", "pair", "impair", "fx", "ex", "img", "versions", "fun", "neuves", "horsdeck"]) {
    const el = form.elements[n];
    c[n] = el && el.checked ? "1" : "";
  }
  c.cm = (form.querySelector('input[name="cm"]:checked') || {}).value || "1";
  c.tm = (form.querySelector('input[name="tm"]:checked') || {}).value || "1";
  c.types = $$('input[name="types"]:checked', form).map((x) => x.value).join(",");
  for (const g of $$(".rch-symboles, .rch-bascules", form)) {
    const on = $$(".actif", g).map((b) => b.dataset.k);
    c[g.dataset.groupe] = g.dataset.unique ? (on[0] || "") : on.join("");
  }
  c.eds = [...(rch.eds || [])].join(",");
  return c;
}

// les trois rangées de la fenêtre Manas, comme sur Magic-Ville : « Doivent » et « Peuvent » s'excluent,
// et « Multiples » suit la rangée qu'on coche (on peut ensuite le décocher : un seul symbole de cette couleur)
function basculeMana(form, rangee, k) {
  const ligne = (r) => $(`.rch-symboles[data-groupe="${r}"] [data-k="${k}"]`, form);
  const on = (r) => ligne(r).classList.contains("actif");
  const flip = (r) => { const b = ligne(r); const v = !b.classList.contains("actif"); b.classList.toggle("actif", v); b.setAttribute("aria-pressed", v); };
  if (rangee === "doit" || rangee === "peut") {
    const autre = rangee === "doit" ? "peut" : "doit";
    if (on(autre)) flip(autre);
    if (on(rangee) === on("mult")) flip("mult");
    flip(rangee);
  } else {
    if (!on("doit") && !on("peut") && !on("mult")) flip("peut");
    flip("mult");
  }
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
  else {
    if (c.doit) r.push(`Coût avec ${[...c.doit].join(" ")}`);
    if (c.peut) r.push(`Coût parmi ${[...lettresWUBRG((c.doit || "") + c.peut)].join(" ")}`);
  }
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
  if (c.fn) r.push("Fonction : " + (((rch.fonctions || []).find((f) => f.cle === c.fn) || {}).nom || c.fn));
  if (c.gc) r.push((RCH_GC.find((g) => g[0] === c.gc) || ["", c.gc])[1]);
  if (c.horsdeck === "1") r.push("pas déjà dans le deck");
  if (c.versions === "1") r.push("toutes les versions");
  if (c.fun === "1") r.push("cartes fantaisie");
  return r;
}

// ---- la page
async function vueRecherche(params) {
  // la page sans critère (lien du haut, bouton d'un deck) : on reprend la dernière recherche
  const deckDemande = params.get("deck");
  if ([...params.keys()].every((k) => k === "deck")) {
    const derniere = PREF.get(cleDerniere(deckDemande || ""), "");
    if (derniere) {
      history.replaceState(null, "", "#/recherche?" + derniere);
      params = new URLSearchParams(derniere);
    }
  }
  const neuve = [...params.keys()].every((k) => k === "deck");
  scrollTo(0, 0);
  const c = critDepuis(params);
  if (!params.has("deck")) c.deck = PREF.get("rch-deck", "");
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
  if (deckDemande) PREF.set("rch-deck", c.deck);
  if (neuve && rch.deck && rch.deck.identite) Object.assign(c, critIdentite(rch.deck));    // nouvelle recherche pour un deck : ses couleurs
  rch.crit = c;
  rch.eds = new Set((c.eds || "").split(",").filter(Boolean));
  rch.ouvert = c.r !== "1" || rch.ouvrir === true;
  rch.ouvrir = false;
  vue.innerHTML = `
    <nav class="fil" aria-label="Fil d'Ariane"><a href="#/">Mes decks</a><span aria-hidden="true">›</span>${rch.deck ? `<a href="#/deck/${enc(rch.deck.id)}">${esc(rch.deck.titre)}</a><span aria-hidden="true">›</span>` : ""}<span aria-current="page">Recherche de cartes</span></nav>
    <div class="titre-page rch-titre">
      <h1>Recherche de cartes</h1>
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
    PREF.set("rch-deck", id);
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

function critIdentite(d) {
  return { coul: lettresWUBRG(d.identite.join(""), "WUBRG") + "C", cm: "1", seules: "1", id: "1", format: "commander" };
}

function majInfosDeck() {
  const z = $("#rch-deck-info");
  if (!z) return;
  const d = rch.deck;
  const j = d ? (rch.journal[d.id] || []) : [];
  z.innerHTML = d ? `${identiteHtml(d.identite)} ${d.total} carte${d.total > 1 ? "s" : ""}${d.maybe ? ` · ${d.maybe} en Maybeboard` : ""} · <a href="#/deck/${enc(d.id)}">ouvrir le deck</a>
      ${j.length ? `<span class="rch-journal" title="${esc(j.join(", "))}">· ajoutées ici : ${esc(j.slice(0, 4).join(", "))}${j.length > 4 ? ` et ${j.length - 4} autres` : ""}</span>` : ""}`
    : "Choisis un deck pour ajouter les cartes trouvées et voir celles qu'il contient déjà.";
}

function rendreFormulaire() {
  const z = $("#rch-form");
  const c = rch.crit;
  if (!rch.ouvert) {
    const r = resumeCrit(c);
    z.innerHTML = `<div class="moteur-resume panneau">
      <div class="puces">${r.length ? r.map((t) => `<span class="puce puce-crit">${esc(t)}</span>`).join("") : `<span class="muet petit">Toutes les cartes</span>`}</div>
      <div class="moteur-resume-actions">
        <button class="btn btn-petit" data-act="modifier">Modifier la recherche</button>
        <button class="btn btn-petit btn-discret" data-act="nouvelle">Nouvelle recherche</button>
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
    const s = ev.target.closest(".rch-sym, .rch-bascule");
    if (s) {
      const g = s.closest("[data-groupe]");
      if (["doit", "peut", "mult"].includes(g.dataset.groupe)) return basculeMana(form, g.dataset.groupe, s.dataset.k);
      const v = !s.classList.contains("actif");
      if (g.dataset.unique) $$(".actif", g).forEach((b) => { b.classList.remove("actif"); b.setAttribute("aria-pressed", "false"); });
      s.classList.toggle("actif", v);
      s.setAttribute("aria-pressed", v);
      return;
    }
    const a = ev.target.closest("[data-act]");
    if (!a) return;
    if (a.dataset.act === "raz") return nouvelleRecherche();
    if (a.dataset.act === "budget") { form.elements.prixmax.value = "5"; form.elements.prixmax.focus(); return; }
    if (a.dataset.act === "identite" && rch.deck) {
      const id = critIdentite(rch.deck);
      $$('.rch-symboles[data-groupe="coul"] .rch-sym', form).forEach((b) => { const on = id.coul.includes(b.dataset.k); b.classList.toggle("actif", on); b.setAttribute("aria-pressed", on); });
      form.querySelector('input[name="cm"][value="1"]').checked = true;
      form.elements.seules.checked = true;
      form.elements.id.checked = true;
      const f = $('.rch-bascules[data-groupe="format"]', form);
      $$(".rch-bascule", f).forEach((b) => { const on = b.dataset.k === "commander"; b.classList.toggle("actif", on); b.setAttribute("aria-pressed", on); });
      toast(`Couleurs de ${rch.deck.titre} : cartes jouables dans ce deck.`);
    }
  });
  rendreEditions();
}

function nouvelleRecherche() {
  const c = { ...RCH_DEFAUTS, deck: rch.crit.deck || "", img: rch.crit.img, vue: rch.crit.vue || "", ordre: rch.crit.ordre, sens: rch.crit.sens || "" };
  if (rch.deck && rch.deck.identite) Object.assign(c, critIdentite(rch.deck));
  rch.crit = c;
  rch.eds = new Set();
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

// la dernière recherche : celle du lien du haut, et celle de chaque deck (bouton « Chercher des cartes » du deck)
function memoriser() {
  const qs = critVersHash(rch.crit);
  PREF.set(cleDerniere(""), qs);
  if (rch.crit.deck) PREF.set(cleDerniere(rch.crit.deck), qs);
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
      <p class="muet petit">La première fois, l'Atelier télécharge toutes les cartes depuis Scryfall et leurs textes en français (quelques minutes). Ensuite la recherche est instantanée, et la base se met à jour toute seule chaque semaine.</p>
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
  const lignes = c.versions === "1" && r.lignes !== r.total ? ` · ${sepMilliers(r.lignes)} versions` : "";
  z.innerHTML = `
    <div class="rch-entete">
      <div class="rch-compte"><strong>${sepMilliers(r.total)} carte${r.total > 1 ? "s" : ""} trouvée${r.total > 1 ? "s" : ""}</strong>${lignes}</div>
      ${paginationRch(r)}
      <div class="rch-outils">
        <div class="segments" role="group" aria-label="Affichage">${[["liste", "Liste"], ["images", "Images"]].map(([k, l]) =>
          `<button type="button" data-vue="${k}" class="${(k === "images") === vueImages ? "actif" : ""}" aria-pressed="${(k === "images") === vueImages}">${l}</button>`).join("")}</div>
        <label class="petit muet">Trier par <select class="champ champ-petit" id="rch-tri">${RCH_TRIS.map(([k, l]) => `<option value="${k}" ${c.ordre === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <button class="btn btn-petit" id="rch-sens" title="Inverser l'ordre">${sens === "desc" ? "↓ décroissant" : "↑ croissant"}</button>
      </div>
    </div>
    ${r.total ? `<div class="rch-liste ${vueImages ? "etale" : ""} ${c.img === "1" ? "avec-images" : ""}">${r.cartes.map((x, i) => (vueImages ? carteImageRch(x, i) : ligneRch(x, i))).join("")}</div>`
      : `<div class="panneau vide"><p>Aucune carte ne correspond.</p><p class="muet petit">Élargis un critère : couleurs, format, prix, fonction…</p></div>`}
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
    return `<span class="pulse">Mise à jour de la base : ${esc(e.etape || "en cours")}${pc}</span> · la recherche reste utilisable`;
  }
  return `Base Scryfall du ${heureCourte(b.date)} · ${sepMilliers(b.nb)} cartes
    ${b.verifie ? ` · nouveautés vérifiées le ${heureCourte(b.verifie)}` : ""}
    <span class="rch-base-aide" data-bulle="L'Atelier vérifie toutes les 6 heures si Scryfall a de nouvelles cartes (nouvelle extension, spoilers) et refait alors la base. Il la refait aussi chaque semaine pour les prix.">ⓘ</span>
    · <button type="button" class="lien-discret" data-act="maj-base">Mettre à jour maintenant</button>
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
      toast(b.construction.erreur ? "Mise à jour incomplète : " + b.construction.erreur : `Base à jour : ${sepMilliers(b.nb)} cartes.`, 4000);
      if (rch.crit && rch.crit.r === "1") lancerRecherche();
      return;
    }
  }
}

const prixRch = (x) => (x.prix == null ? "—" : euros(x.prix) + (x.foil ? " (foil)" : ""));
const lienCardmarket = (nom) => `https://www.cardmarket.com/fr/Magic/Products/Search?searchString=${enc(ic_cle(nom))}`;
const ic_cle = (nom) => nom.split(" // ")[0];
const horsCouleurs = (x) => !!(rch.deck && rch.deck.identite && x.couleurs.some((k) => !rch.deck.identite.includes(k)));

function etatDeckRch(x) {
  if (!rch.deck) return "";
  if (x.dans === "deck" || x.dans === "commandant") return `<span class="badge badge-ok">✓ ${x.dans === "commandant" ? "commandant" : "dans le deck"}</span>`;
  return `${x.dans === "maybe" ? `<span class="badge">Maybeboard</span>` : ""}
    <button type="button" class="btn btn-petit" data-act="ajouter" title="Ajouter à ${esc(rch.deck.titre)}">+ Deck</button>
    ${x.dans === "maybe" ? "" : `<button type="button" class="btn btn-petit btn-discret" data-act="maybe" title="Ajouter au Maybeboard de ${esc(rch.deck.titre)}">+ Maybe</button>`}`;
}

function badgesRch(x) {
  return [
    x.gc ? `<span class="badge badge-gc" title="Game Changer : compte dans le bracket">Game Changer</span>` : "",
    x.legal ? "" : `<span class="badge badge-alerte" title="Pas légale en Commander">non légale en Commander</span>`,
    horsCouleurs(x) ? `<span class="badge badge-alerte" title="Hors de l'identité de couleur de ${esc(rch.deck.titre)}">hors couleurs</span>` : "",
  ].join("");
}

function texteCarteRch(x) {
  const fr = rch.crit.fr !== "" && x.texte_fr;
  const t = fr ? x.texte_fr : x.texte;
  return (t || "").split("\n").map((l) => l.trim() === "//" ? "<hr>" : l.trim() ? `<p>${texteMana(l)}</p>` : "").join("");
}

// l'édition n'apparaît que dans « Toutes les versions » (une ligne par impression) : c'est ce qui distingue les lignes
function editionRch(x) {
  const e = x.edition;
  if (!e || rch.crit.versions !== "1") return "";
  return `<span class="rch-ed" title="${esc(`${e.nom} · ${e.set.toUpperCase()} ${e.num} · ${RCH_RARETE_NOM[e.rarete] || e.rarete}`)}">
    ${e.icone ? `<span class="ed-icone rarete-${esc(e.rarete)}" style="--ic:url('${esc(e.icone)}')" aria-hidden="true"></span>` : ""}<span class="rch-ed-nom">${esc(e.nom)}</span>
    <span class="muet">${esc(e.annee)}</span>
  </span>`;
}

function ligneRch(x, i) {
  const cher = (x.prix || 0) > 5;
  const typeAff = rch.crit.fr !== "" && x.type_fr ? x.type_fr : x.type;
  return `<article class="rch-carte" data-i="${i}">
    ${rch.crit.img === "1" ? `<button type="button" class="rch-vignette" data-act="ouvrir" data-image="${esc(x.image)}" data-legende="${esc(`${x.fr || x.nom} — ${prixRch(x)}`)}" ${cher ? 'data-cher="1"' : ""} aria-label="Fiche de ${esc(x.nom)}">
      ${x.petite ? `<img src="${esc(x.petite)}" alt="" loading="lazy">` : `<span class="sans-image">${esc(x.nom)}</span>`}</button>` : ""}
    <div class="rch-corps">
      <div class="rch-haut">
        <div class="rch-noms"><button type="button" class="rch-nom" data-act="ouvrir">${esc(x.nom)}</button>${x.fr && x.fr !== x.nom ? `<span class="rch-vf">${esc(x.fr)}</span>` : ""}</div>
        ${mana(x.cout)}
      </div>
      <div class="rch-type">${esc(typeAff)}${x.pt ? ` <span class="rch-pt">${esc(x.pt)}</span>` : ""}</div>
      ${x.texte || x.texte_fr ? `<div class="rch-texte fs-texte">${texteCarteRch(x)}</div>` : ""}
      <div class="rch-pied">
        ${editionRch(x)}
        <a class="prix ${cher ? "cher" : ""}" href="${esc(lienCardmarket(x.nom))}" target="_blank" rel="noopener" title="Le moins cher, toutes éditions (prix Cardmarket du jour). Ouvrir Cardmarket">${prixRch(x)}</a>
        <span class="rch-badges">${badgesRch(x)}</span>
        <span class="rch-actions">${etatDeckRch(x)}</span>
      </div>
    </div>
  </article>`;
}

function carteImageRch(x, i) {
  const cher = (x.prix || 0) > 5;
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
async function ajouterRecherche(x, { maybe = false, tags = [], n = 1, edition = null } = {}) {
  const d = rch.deck;
  if (!d) { toast("Choisis d'abord un deck, en haut de la page."); $("#rch-deck").focus(); return null; }
  try {
    let res;
    if (!maybe && x.dans === "maybe") {                    // déjà au Maybeboard : la carte passe dans le deck
      const plein = await api("/api/decks/" + enc(d.id));
      const c = plein.cartes.find((y) => y.cat === "Maybeboard" && ic_cle(y.nom).toLowerCase() === ic_cle(x.nom).toLowerCase());
      res = c ? await api(`/api/decks/${enc(d.id)}/modifier`, { method: "POST", body: { op: "maybeboard", index: c.index, nom_actuel: c.nom } }) : null;
    }
    if (!res) {
      const ed = edition || (rch.crit.versions === "1" && x.edition ? { set: x.edition.set, num: x.edition.num, lang: "en", nom_edition: x.edition.nom } : null);
      res = await api(`/api/decks/${enc(d.id)}/modifier`, { method: "POST", body: { op: "ajouter", nom: x.nom, tags: maybe ? ["Maybeboard", ...tags] : tags, n, edition: ed } });
    }
    if (!maybe || x.dans !== "deck") x.dans = maybe ? (x.dans || "maybe") : "deck";
    Object.assign(rch.deck, { total: res.total, maybe: res.maybe, modifie: res.modifie });
    const nomJ = x.fr || x.nom, j = (rch.journal[d.id] = (rch.journal[d.id] || []).filter((t) => t !== nomJ + " (Maybeboard)"));
    j.unshift(nomJ + (maybe ? " (Maybeboard)" : ""));
    etat.decks = [];
    majInfosDeck();
    remplacerResultat(x);
    toast(`✓ ${x.fr || x.nom} : ${maybe ? "Maybeboard de" : "ajoutée à"} ${d.titre} · ${res.total} carte${res.total > 1 ? "s" : ""}`);
    return res;
  } catch (e) { erreur(e); return null; }
}

function remplacerResultat(x) {
  const i = rch.res.cartes.indexOf(x);
  const el = $(`#rch-resultats [data-i="${i}"]`);
  if (!el) return;
  const t = document.createElement("div");
  t.innerHTML = rch.crit.vue === "images" ? carteImageRch(x, i) : ligneRch(x, i);
  el.replaceWith(t.firstElementChild);
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
    return `<div class="rf-ajout rf-deja"><span class="ok">✓ ${x.dans === "commandant" ? "Commandant de" : "Déjà dans"} ${esc(d.titre)}</span>
      <a href="#/deck/${enc(d.id)}">Ouvrir le deck</a></div>`;
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
      ${promotion ? `<span class="petit muet rf-aide">La carte quitte le Maybeboard et garde ses tags.</span>` : `
        <input class="champ champ-petit" id="rf-tags" list="rf-cats" placeholder="Tags (facultatif) : Ramp, Draw…" aria-label="Tags, séparés par des virgules">
        <datalist id="rf-cats">${(d.categories || []).map((t) => `<option value="${esc(t)}">`).join("")}</datalist>`}
      ${multi && !promotion ? `<label class="petit muet rf-n">Exemplaires <input class="champ champ-petit" type="number" id="rf-n" min="1" max="99" value="1"></label>` : ""}
      <button class="btn btn-accent" data-act="ajouter">${libelleAjout(x, dest)}</button>
    </div>
  </div>`;
}

function libelleAjout(x, dest) {
  if (x.dans === "maybe") return "Passer dans le deck";
  if (dest === "maybe") return "Ajouter au Maybeboard";
  return x.dans === "deck" ? "Ajouter un exemplaire" : "Ajouter au deck";
}

// ---- fiche d'une carte trouvée : grande image, textes, prix du jour, versions, ajout au deck
function ficheRecherche(i) {
  const liste = rch.res.cartes;
  const x = liste[i];
  if (!x) return;
  const d = rch.deck;
  const v = x.versionChoisie || null;
  const image = (v && v.image) || x.image;
  const cher = (x.prix || 0) > 5;
  const texte = (t) => (t || "").split("\n").map((l) => l.trim() === "//" ? "<hr>" : l.trim() ? `<p>${texteMana(l)}</p>` : "").join("");
  ouvrirModale(`
    <div class="fiche-carte">
      <div class="fc-image">${image ? `<img src="${esc(image)}" alt="${esc(x.nom)}">` : `<div class="sans-image">${esc(x.nom)}</div>`}
        <div class="fc-version">
          ${v ? `<span class="petit muet">${esc(v.edition)}${v.annee ? " · " + esc(v.annee) : ""}${v.lang === "fr" ? " · en français" : ""}</span>` : x.edition ? `<span class="petit muet">${esc(x.edition.nom)} · ${esc(x.edition.annee)}</span>` : ""}
          <button type="button" class="lien-discret" data-act="version">${x.versions > 1 ? `Les ${x.versions} versions (visuel)` : "Changer la version (visuel)"}</button>
        </div></div>
      <div class="fc-infos">
        <div class="fc-tete">
          <div><h2>${esc(x.fr || x.nom)} ${mana(x.cout)}</h2>${x.fr && x.fr !== x.nom ? `<div class="muet">${esc(x.nom)}</div>` : ""}</div>
          <button class="btn btn-discret" data-act="fermer" aria-label="Fermer">✕</button>
        </div>
        <div class="petit muet">${esc(x.type_fr || x.type)}${x.pt ? " · " + esc(x.pt) : ""}</div>
        <div class="chiffres" id="rf-prix">
          <span class="badge ${cher ? "badge-cher" : ""}" id="rf-prix-badge" title="Le moins cher, toutes éditions (prix Cardmarket du jour)">${prixRch(x)}</span>
          ${badgesRch(x)}
          ${x.dans === "maybe" ? `<span class="badge">au Maybeboard</span>` : ""}
        </div>
        ${x.texte_fr || x.texte ? `<div class="texte fs-texte">${texte(x.texte_fr || x.texte)}</div>` : ""}
        ${x.texte_fr && x.texte ? `<details class="petit"><summary>Texte anglais (Oracle)</summary><div class="fs-texte" style="margin-top:.4rem">${texte(x.texte)}</div></details>` : ""}
        ${d ? blocAjoutRch(x, d) : `<p class="note petit">Choisis un deck en haut de la page (« Pour le deck ») pour ajouter cette carte.</p>`}
        <div class="fc-liens">
          <a href="${esc(lienCardmarket(x.nom))}" id="rf-cardmarket" target="_blank" rel="noopener">Cardmarket ↗</a>
          <a href="${esc(lienGatherer(x.nom))}" id="rf-gatherer" target="_blank" rel="noopener" title="La carte sur Gatherer, le site officiel de Wizards">Gatherer ↗</a>
          ${d ? `<a href="#/deck/${enc(d.id)}/combos/${enc(x.nom)}">Combos avec cette carte →</a>` : ""}
        </div>
        ${liste.length > 1 ? `
          <div class="fc-nav">
            <button class="btn btn-petit" data-act="prec" ${i === 0 ? "disabled" : ""}>← Précédente</button>
            <span class="muet petit">${i + 1} / ${liste.length} sur cette page · flèches du clavier</span>
            <button class="btn btn-petit" data-act="suiv" ${i === liste.length - 1 ? "disabled" : ""}>Suivante →</button>
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
        $('[data-act="ajouter"]', b).textContent = libelleAjout(x, dest);
        return;
      }
      const a = ev.target.closest("[data-act]");
      if (!a || a.disabled || a.tagName === "A") return;
      const act = a.dataset.act;
      if (act === "fermer") return fermerModale();
      if (act === "prec" || act === "suiv") return ficheRecherche(i + (act === "suiv" ? 1 : -1));
      if (act === "version") return versionsRecherche(i);
      if (act === "ajouter") {
        const champ = $("#rf-tags", b);
        const tags = champ ? champ.value.split(",").map((t) => t.trim()).filter(Boolean) : [];
        a.disabled = true;
        const res = await ajouterRecherche(x, { maybe: dest === "maybe" && x.dans !== "maybe", tags, n: Math.max(1, +($("#rf-n", b) || {}).value || 1),
          edition: x.versionChoisie ? editionVersion(x.versionChoisie) : null });
        if (res) ficheRecherche(i); else a.disabled = false;
      }
    });
    $("#rf-tags", b)?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $('[data-act="ajouter"]', b).click(); } });
  }, { focus: false, large: true });
  // prix du jour (le plus bas, avec son édition) et lien Gatherer de la carte
  api("/api/carte?nom=" + enc(x.nom)).then((f) => {
    if (!$("#modale .fiche-carte") || rch.res.cartes[i] !== x) return;
    if (f.gatherer) $("#rf-gatherer").href = f.gatherer;
    if (f.prix_lien) $("#rf-cardmarket").href = f.prix_lien;
    if (f.prix == null) return;
    x.prix = f.prix;
    const el = $("#rf-prix-badge");
    el.textContent = `${euros(f.prix)}${f.prix_edition ? " · " + f.prix_edition : ""}`;
    el.classList.toggle("badge-cher", f.prix > 5);
  }).catch(() => {});
}

// « N versions » : la grille des impressions ; la version choisie sert à l'ajout (visuel de la carte dans le deck)
function versionsRecherche(i) {
  const x = rch.res.cartes[i];
  ouvrirModale(`<div id="choix-v"></div>`, (b) => {
    choixVersion($("#choix-v", b), {
      nom: x.nom, titre: x.fr || x.nom, actuelle: x.versionChoisie || null, retour: () => ficheRecherche(i),
      surChoix: (p) => { x.versionChoisie = p || null; ficheRecherche(i); },
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
          toast("Deck mis à jour : il a changé dans un autre onglet.");
        } else toast("Le deck a changé dans un autre onglet : recharge la page pour le voir ici.", 4500);
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
      : e.gc_maj ? `Game Changers : ${e.gc_nb} · liste du ${new Date(e.gc_maj * 1000).toLocaleDateString("fr-FR")}` : "";
    $("#btn-rafraichir").disabled = !!m.tache;
  } catch (_) { $("#etat-maj").textContent = "Atelier arrêté ?"; }
  setTimeout(suivreMaj, 3000);
}
$("#btn-rafraichir").addEventListener("click", async () => {
  await api("/api/rafraichir", { method: "POST" });
  toast("Mise à jour des prix et des Game Changers lancée.");
});

// ------------------------------------------------------------------ discussion avec Claude
// Une discussion par deck (son historique et son propre contexte Claude), plus une discussion générale sur « Mes decks ».
// Le panneau suit la page : changer de deck change de discussion. Les réponses tournent sur le serveur (tâche de fond) :
// fermer le panneau, changer de deck ou recharger la page ne les perd pas, et plusieurs decks peuvent attendre une réponse.
const chat = { ouvert: false, charge: false, cle: null, suivi: false, bulle: null, nbOutils: 0 };
const ETAT_CHAT = "Chaque message compte dans ta limite d'utilisation Claude.";
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (location.hash.startsWith("#/recherche")) return rch.deck ? rch.deck.id : "";
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  return parts[0] === "deck" && parts[1] ? decodeURIComponent(parts[1]) : "";
}
const nomDiscussion = (cle) => (cle ? cle.replace(/^Deck /, "") : "générale");
const qDeck = (cle) => "?deck=" + enc(cle || "");

function ajouteMessage(role, texte) {
  const fil = $("#chat-fil");
  const div = document.createElement("div");
  div.className = "msg msg-" + role;
  div.innerHTML = role === "claude" ? texteRiche(texte) : esc(texte);
  fil.appendChild(div);
  fil.scrollTop = fil.scrollHeight;
  return div;
}

function ajouteOutil(texte, avant = null) {
  const o = document.createElement("div");
  o.className = "msg msg-outil";
  o.textContent = "· " + texte;
  if (avant) avant.before(o); else $("#chat-fil").appendChild(o);
}

function boutonEnvoyer(enCours) {
  const b = $("#chat-envoyer");
  if (!b) return;
  b.textContent = enCours ? "Arrêter" : "Envoyer";
  b.classList.toggle("btn-accent", !enCours);
  if (!enCours) $("#chat-etat").textContent = ETAT_CHAT;
}

async function afficheHistorique() {
  const cle = chat.cle;
  const h = await api("/api/discussion" + qDeck(cle));
  if (cle !== chat.cle) return h;                 // on a changé de deck entre-temps
  $("#chat-titre").textContent = cle ? `Discussion · ${nomDiscussion(cle)}` : "Discussion générale";
  const fil = $("#chat-fil");
  fil.innerHTML = "";
  if (!h.disponible) ajouteMessage("outil", "Claude Code est introuvable sur ce PC : la discussion ne marchera pas (installe l'extension Claude Code de VS Code).");
  for (const m of h.messages) {
    if (m.role === "moi") { ajouteMessage("moi", m.texte); continue; }
    for (const o of m.outils || []) ajouteOutil(o);
    if (m.texte) ajouteMessage("claude", m.texte);
  }
  if (!h.messages.length) ajouteMessage("outil", cle
    ? `Discussion propre au deck ${nomDiscussion(cle)} : Claude garde ce contexte d'un message à l'autre. Demande une analyse, des cartes, une consigne de jeu pour le simulateur…`
    : "Discussion générale, hors d'un deck précis. Chaque deck a aussi sa propre discussion, sur sa page.");
  chat.bulle = null;
  boutonEnvoyer(h.en_cours.actif);
  if (h.en_cours.actif) { afficheEnCours(h.en_cours); suivreChat(); }
  return h;
}

// la page a changé : le panneau passe à la discussion du deck affiché
async function changerDiscussion() {
  const cle = cleCourante();
  if (cle === chat.cle) return;
  chat.cle = cle;
  if (chat.charge) { try { await afficheHistorique(); } catch (e) { ajouteMessage("outil", "Erreur : " + (e.message || e)); } }
}

async function montageChat() {
  const a = $("#chat");
  a.innerHTML = `
    <div class="chat-tete">
      <strong id="chat-titre">Discussion</strong>
      <div>
        <select id="chat-modele" class="btn btn-petit" title="Modèle utilisé pour les prochains messages : Sonnet est plus rapide, Haiku encore plus (pour les questions simples)">
          <option value="">Modèle habituel</option><option value="sonnet">Sonnet</option><option value="haiku">Haiku</option>
        </select>
        <button class="btn btn-petit btn-discret" id="chat-nouvelle" title="Effacer cette discussion et repartir de zéro">Nouvelle</button>
        <button class="btn btn-petit btn-discret" id="chat-fermer" aria-label="Fermer">✕</button>
      </div>
    </div>
    <div class="chat-fil" id="chat-fil" aria-live="polite"></div>
    <div class="chat-saisie">
      <div class="raccourcis">
        <button class="btn btn-petit" data-r="Que penses-tu de ce que je regarde ? Qu'est-ce qui ressort ?">Avis sur la page</button>
        <button class="btn btn-petit" data-r="Le simulateur joue certaines cartes de ce deck sans leurs effets (badges « sim »). Apprends-lui à les jouer, puis vérifie que les résultats des autres decks ne changent pas.">Modéliser les cartes mal comprises</button>
        <button class="btn btn-petit" data-r="Règle la façon de jouer de ce deck dans le simulateur : ">Consigne de jeu…</button>
      </div>
      <textarea id="chat-saisie" placeholder="Ton message… (Ctrl+Entrée pour envoyer)"></textarea>
      <div class="form-ligne" style="margin:0;justify-content:space-between">
        <span class="muet petit" id="chat-etat">${ETAT_CHAT}</span>
        <button class="btn btn-accent" id="chat-envoyer">Envoyer</button>
      </div>
    </div>`;
  try { $("#chat-modele").value = localStorage.getItem("chat-modele") || ""; } catch (_) {}
  $("#chat-modele").onchange = (ev) => { try { localStorage.setItem("chat-modele", ev.target.value); } catch (_) {} };
  $("#chat-fermer").onclick = () => basculeChat(false);
  $("#chat-nouvelle").onclick = async () => {
    if (!confirm(`Effacer la discussion ${nomDiscussion(chat.cle)} et repartir de zéro ? Claude oubliera ce qui s'y est dit (pas ta mémoire générale).`)) return;
    try {
      await api("/api/discussion/nouvelle", { method: "POST", body: { deck: chat.cle } });
      await afficheHistorique();
    } catch (e) { erreur(e); }
  };
  $$("[data-r]", a).forEach((b) => b.addEventListener("click", () => { const t = $("#chat-saisie"); t.value = b.dataset.r; t.focus(); }));
  $("#chat-envoyer").onclick = () => ($("#chat-envoyer").textContent === "Arrêter" ? arreterChat() : envoyerChat());
  $("#chat-saisie").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) envoyerChat(); });
  chat.cle = cleCourante();
  chat.charge = true;
  await afficheHistorique();
}

// réponse en cours dans la discussion affichée : outils utilisés au fur et à mesure, puis le texte
function afficheEnCours(s) {
  if (!chat.charge) return;
  const fil = $("#chat-fil");
  const enBas = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 60;
  if (!chat.bulle || !chat.bulle.isConnected) {
    chat.bulle = ajouteMessage("claude", "");
    chat.nbOutils = 0;
  }
  while (chat.nbOutils < s.outils.length) ajouteOutil(s.outils[chat.nbOutils++], chat.bulle);
  chat.bulle.innerHTML = s.texte ? texteRiche(s.texte) : `<span class="muet">Claude réfléchit…</span>`;
  $("#chat-etat").textContent = s.outils.length && !s.texte ? "Claude travaille : " + s.outils[s.outils.length - 1] : "Claude écrit…";
  boutonEnvoyer(true);
  if (enBas) fil.scrollTop = fil.scrollHeight;
}

function boutonDiscussion(actives) {
  const b = $("#btn-chat");
  b.classList.toggle("travaille", actives.length > 0);
  b.textContent = !actives.length ? "Discussion"
    : actives.length > 1 ? `Claude répond (${actives.length})…` : `Claude répond${actives[0] ? " · " + nomDiscussion(actives[0]) : ""}…`;
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
    toast(`Claude a répondu dans la discussion ${nomDiscussion(cle)}.`, 5000);
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
      try { s = await api("/api/discussion/en-cours" + qDeck(chat.cle ?? cleCourante())); echecs = 0; }
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
}

async function ouvrirChat(texte) {
  await basculeChat(true);
  const t = $("#chat-saisie");
  t.value = texte || "";
  t.focus();
}

async function envoyerChat() {
  const t = $("#chat-saisie");
  const message = t.value.trim();
  if (!message || $("#chat-envoyer").textContent === "Arrêter") return;
  try {
    const s = await api("/api/discussion", { method: "POST", body: { message, page: pageCourante(), modele: $("#chat-modele").value, deck: chat.cle } });
    t.value = "";
    ajouteMessage("moi", message);
    chat.bulle = null;
    afficheEnCours(s);
    suivreChat();
  } catch (e) {
    ajouteMessage("outil", "Erreur : " + (e.message || e));
  }
}

async function arreterChat() {
  if (!confirm("Arrêter la réponse de Claude ? Ce qu'il a déjà écrit est gardé.")) return;
  try { await api("/api/discussion/arreter", { method: "POST", body: { deck: chat.cle } }); } catch (e) { erreur(e); }
}

$("#btn-chat").addEventListener("click", () => basculeChat());
window.addEventListener("hashchange", changerDiscussion);
try { if (localStorage.getItem("chat-ouvert")) basculeChat(true); } catch (_) {}
api("/api/discussion/en-cours").then((s) => { if (s.actives.length) suivreChat(); }).catch(() => {});   // une réponse tournait déjà

route();
suivreMaj();
