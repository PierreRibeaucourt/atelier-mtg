// Partager un deck depuis l'appli : la page publique du deck, comme partage.py sur le PC. L'appli prépare les données de
// la page (capturer : les réponses de son API, sans classeur ni achats) et son image d'aperçu ; le serveur des comptes
// (outils/serveur/pages.py) l'écrit à https://atelier-mtg.com/decks/<pseudo>/<deck>/. Au premier partage, on choisit
// son pseudo. Le lien instantané (voir/), lui, ne publie rien.
// PARTAGE_TELEPHONE(o) : o.api (l'API de l'appli), o.serveur(chemin, méthode, corps) (le serveur des comptes),
// o.page(id) → la page du deck faite ici ({api, comparer}), o.lire / o.ecrire (IndexedDB), o.scryfall(url, corps),
// o.reglages() → {budget, sans_ub_illustrations}.
"use strict";
const PARTAGE_TELEPHONE = (o) => {
  const ACCUEIL_ATELIER = "https://atelier-mtg.com/fr/";
  const ATELIER = "https://github.com/PierreRibeaucourt/atelier-mtg";
  const VERSION = "2.5.1";               // version.py, écrite par telephone_site.py
  const ETAT = "@partages";                            // {pseudo, lu, decks: {deck: {url, slug, date, visibilite}}} : les pages du compte
  const COULEURS = { "": "incolore", W: "mono-blanc", U: "mono-bleu", B: "mono-noir", R: "mono-rouge", G: "mono-vert",
    WU: "Azorius", UB: "Dimir", BR: "Rakdos", RG: "Gruul", WG: "Selesnya", WB: "Orzhov", UR: "Izzet", BG: "Golgari", WR: "Boros",
    UG: "Simic", WUB: "Esper", UBR: "Grixis", BRG: "Jund", WRG: "Naya", WUG: "Bant", WBG: "Abzan", WUR: "Jeskai", UBG: "Sultai",
    WBR: "Mardu", URG: "Temur", WUBRG: "5 couleurs" };
  const enc = new TextEncoder(), dec = new TextDecoder();

  // ------------------------------------------------------------------ outils
  const nomCouleurs = (id) => {
    if (id == null) return "";
    const k = [..."WUBRG"].filter((c) => id.includes(c)).join("");
    return COULEURS[k] ?? `${k.length} couleurs`;
  };
  const liste = (m) => (m.length === 1 ? m[0] : m.length ? m.slice(0, -1).join(", ") + " et " + m[m.length - 1] : "");
  const euros = (x) => (Number(x) || 0).toFixed(2).replace(".", ",") + " €";
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const octets = (x) => (typeof x === "string" ? enc.encode(x) : x);
  const sha1 = async (x) => hex(await crypto.subtle.digest("SHA-1", octets(x)));
  const version = async (x) => (await sha1(x)).slice(0, 10);                          // partage._version
  function base64(b) {
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // ------------------------------------------------------------------ l'image d'aperçu (image_partage.py)
  const L = 1200, H = 630, ACCENT = "rgb(249,115,22)", BORD = "rgb(154,52,18)";
  const PIPS = { W: "rgb(248,246,216)", U: "rgb(14,104,171)", B: "rgb(60,52,48)", R: "rgb(211,32,42)", G: "rgb(0,115,62)", C: "rgb(190,186,182)" };
  const police = (gras, t) => `${gras ? 700 : 400} ${t}px "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`;
  function toile() {
    const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(L, H) : Object.assign(document.createElement("canvas"), { width: L, height: H });
    return [c, c.getContext("2d")];
  }
  const charge = (url) => new Promise((ok) => {
    if (!url) return ok(null);
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => ok(i);
    i.onerror = () => ok(null);                        // pas de réseau : l'image se fait sans
    i.src = url;
  });
  function couvrir(ctx, im, x, y, l, h) {               // ImageOps.fit : remplir le cadre sans déformer
    const r = Math.max(l / im.width, h / im.height), w = im.width * r, hh = im.height * r;
    ctx.drawImage(im, x + (l - w) / 2, y + (h - hh) / 2, w, hh);
  }
  function arrondi(ctx, x, y, l, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + l, y, x + l, y + h, r); ctx.arcTo(x + l, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + l, y, r); ctx.closePath();
  }
  // une carte aux coins arrondis et son ombre, centrée sur (cx, cy), tournée de angle degrés (sens de PIL : antihoraire)
  function carte(ctx, im, hauteur, cx, cy, angle = 0) {
    const larg = Math.round(hauteur * 488 / 680);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-angle * Math.PI / 180);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.67)"; ctx.shadowBlur = 32; ctx.shadowOffsetY = 12;
    arrondi(ctx, -larg / 2, -hauteur / 2, larg, hauteur, 20);
    ctx.fillStyle = "#000"; ctx.fill();
    ctx.restore();
    arrondi(ctx, -larg / 2, -hauteur / 2, larg, hauteur, Math.round(larg * 0.0475));
    ctx.clip();
    couvrir(ctx, im, -larg / 2, -hauteur / 2, larg, hauteur);
    ctx.restore();
    return larg;
  }
  const tailleTournee = (l, h, a) => { const r = Math.abs(a) * Math.PI / 180; return [l * Math.cos(r) + h * Math.sin(r), l * Math.sin(r) + h * Math.cos(r)]; };
  function chaudron(ctx, x, y, t) {                    // le favicon (static/index.html), 32 unités
    const k = t / 32;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.fillStyle = ACCENT;
    for (const [cx, cy, r] of [[11.5, 7, 2.8], [18.5, 3.6, 2], [19.8, 9.6, 1.6]]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill(); }
    ctx.strokeStyle = BORD; ctx.lineWidth = 2.4;
    for (const [x0, x1] of [[8, 6.6], [24, 25.4]]) { ctx.beginPath(); ctx.moveTo(x0, 27.5); ctx.lineTo(x1, 30.6); ctx.stroke(); }
    ctx.fillStyle = "rgb(194,65,12)"; ctx.beginPath(); ctx.ellipse(16, 20.7, 12.5, 7.8, 0, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = BORD; arrondi(ctx, 2, 11.5, 28, 5.2, 2.6); ctx.fill();
    ctx.strokeStyle = "rgb(253,186,116)"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(16, 19.5, 8, 5, 0, Math.PI / 2, Math.PI); ctx.stroke();
    ctx.restore();
  }
  function marque(ctx, pastille = false) {             // « Atelier MTG » et le chaudron, en bas à droite
    ctx.font = police(true, 26);
    const t = "Atelier MTG", w = ctx.measureText(t).width, x = L - 48 - w, y = H - 58;
    if (pastille) { ctx.fillStyle = "rgba(18,16,14,0.88)"; arrondi(ctx, x - 60, y - 12, L - 30 - (x - 60), 58, 29); ctx.fill(); }
    ctx.fillStyle = "rgb(236,232,226)"; ctx.fillText(t, x, y);
    chaudron(ctx, Math.round(x - 44), y - 2, 34);
  }
  function ajuste(ctx, t, gras, taille, largeur, mini = 30) {
    ctx.font = police(gras, taille);
    while (taille > mini && ctx.measureText(t).width > largeur) { taille -= 2; ctx.font = police(gras, taille); }
    return taille;
  }
  async function jpeg(c) {
    const b = c.convertToBlob ? await c.convertToBlob({ type: "image/jpeg", quality: 0.84 })
      : await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.84));
    return new Uint8Array(await b.arrayBuffer());
  }
  async function imageDeck(titre, surTitre, commandants, images, art, identite, lignes, auteur) {
    const [c, ctx] = toile();
    ctx.textBaseline = "top";
    const fond = await charge(art);
    ctx.fillStyle = "rgb(26,24,22)"; ctx.fillRect(0, 0, L, H);
    if (fond) { ctx.save(); ctx.filter = "blur(3px)"; couvrir(ctx, fond, 0, 0, L, H); ctx.restore(); }
    const voile = ctx.createLinearGradient(0, 0, L, 0);
    voile.addColorStop(0, "rgba(18,16,14,0.96)"); voile.addColorStop(1, "rgba(18,16,14,0.59)");
    ctx.fillStyle = voile; ctx.fillRect(0, 0, L, H);
    const cartes = (await Promise.all(images.slice(0, 2).map(charge))).filter(Boolean);
    let xTexte = 80;
    if (cartes.length === 1) {
      const larg = carte(ctx, cartes[0], 520, 30 + 40 + Math.round(520 * 488 / 680) / 2, H / 2);
      xTexte = 30 + larg + 80;
    } else if (cartes.length) {
      const larg = Math.round(470 * 488 / 680), [wa, ha] = tailleTournee(larg + 80, 470 + 80, 5);
      carte(ctx, cartes[0], 470, 20 + wa / 2, (H - ha) / 2 - 6 + ha / 2, 5);
      carte(ctx, cartes[1], 470, 190 + wa / 2, (H - ha) / 2 + 6 + ha / 2, -5);
      xTexte = 190 + wa - 10;
    }
    const larg = L - xTexte - 60;
    let y = 92;
    ctx.font = police(true, 26); ctx.fillStyle = ACCENT; ctx.fillText(surTitre.toUpperCase(), xTexte, y);
    y += 44;
    let t = ajuste(ctx, titre, true, 76, larg);
    ctx.fillStyle = "#fff"; ctx.fillText(titre, xTexte, y);
    y += t + 26;
    for (const n of commandants.slice(0, 2)) {
      t = ajuste(ctx, n, false, 34, larg, 22);
      ctx.fillStyle = "rgb(225,220,212)"; ctx.fillText(n, xTexte, y);
      y += t + 10;
    }
    y += 12;
    [...(identite && identite.length ? identite : ["C"])].sort((a, b) => "WUBRGC".indexOf(a) - "WUBRGC".indexOf(b)).forEach((k, i) => {
      ctx.beginPath(); ctx.arc(xTexte + i * 44 + 17, y + 17, 17, 0, 2 * Math.PI);
      ctx.fillStyle = PIPS[k] || PIPS.C; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    });
    y += 64;
    ctx.font = police(false, 30); ctx.fillStyle = "rgb(236,232,226)";
    for (const l of lignes) { ctx.fillText(l, xTexte, y); y += 44; }
    if (auteur) { ajuste(ctx, "par " + auteur, false, 28, larg, 20); ctx.fillStyle = "rgb(190,184,175)"; ctx.fillText("par " + auteur, xTexte, y + 6); }
    marque(ctx);
    return jpeg(c);
  }
  // ------------------------------------------------------------------ les données d'un deck (partage.capturer)
  async function jetons(noms) {                        // jouer.jetons : les jetons et donjons que créent ces cartes
    const cache = (await o.lire("@jetons")) || { cartes: {}, jetons: {} };
    const cle = (n) => String(n).split(/ \/{1,2} /)[0], aCreer = (p) => p.component === "token"
      || (p.component === "combo_piece" && String(p.type_line || "").startsWith("Dungeon"));
    const collection = async (ids) => {
      const r = [];
      for (let i = 0; i < ids.length; i += 75) r.push(...((await o.scryfall("https://api.scryfall.com/cards/collection", { identifiers: ids.slice(i, i + 75) })) || {}).data || []);
      return r;
    };
    const manquants = noms.filter((n) => !(n in cache.cartes));
    if (manquants.length) {
      const trouvees = new Map((await collection(manquants.map((n) => ({ name: cle(n) })))).map((c) => [cle(c.name).toLowerCase(), c]));
      for (const n of manquants) cache.cartes[n] = ((trouvees.get(cle(n).toLowerCase()) || {}).all_parts || []).filter(aCreer).map((p) => p.id);
    }
    const aCharger = [...new Set(noms.flatMap((n) => cache.cartes[n] || []))].filter((i) => !(i in cache.jetons));
    if (aCharger.length) {
      for (const c of await collection(aCharger.map((id) => ({ id })))) {
        const u = c.image_uris || ((c.card_faces || [{}])[0].image_uris) || {};
        cache.jetons[c.id] = { nom: c.name || "", type: c.type_line || "", texte: c.oracle_text || "", image: u.normal || "",
          pt: c.power != null ? `${c.power}/${c.toughness}` : "" };
      }
      for (const i of aCharger) if (!cache.jetons[i]) cache.jetons[i] = {};
    }
    if (manquants.length || aCharger.length) await o.ecrire("@jetons", cache);
    const uniques = new Map();
    for (const n of noms) for (const i of cache.cartes[n] || []) {
      const j = cache.jetons[i] || {};
      if (!j.nom || j.nom === "Copy") continue;
      const k = JSON.stringify([j.nom, j.type, j.pt, j.texte]);
      if (!uniques.has(k)) uniques.set(k, { ...j, cartes: [] });
      if (!uniques.get(k).cartes.includes(n)) uniques.get(k).cartes.push(n);
    }
    return [...uniques.values()].sort((a, b) => (a.nom < b.nom ? -1 : a.nom > b.nom ? 1 : a.pt < b.pt ? -1 : a.pt > b.pt ? 1 : 0));
  }
  async function capturer(deck) {
    const p = await o.page(deck);
    if (!p) throw new Error("Ce deck n'est pas encore prêt : réessaie dans un instant.");
    const R = `/api/decks/${deck}`, api = {};
    for (const [k, v] of Object.entries(p.api)) if (k !== `${R}/achats`) api[k] = v;          // ce qu'on possède reste ici
    const sg = api[`${R}/suggestions`];
    if (sg) api[`${R}/suggestions`] = { ecartees: [], cartes: sg.cartes.filter((x) => x.groupes.some((g) => g !== "classeur"))
      .map((x) => ({ ...x, groupes: x.groupes.filter((g) => g !== "classeur"), classeur: 0 })) };
    // relié au PC, la page préparée par le PC a déjà ses simulations, ses jetons, ses aperçus : gardés tels quels.
    // Sans PC, pas de simulation : l'onglet dit « Aucun test » ; ses versions servent à comparer
    if (!api[`${R}/simulation/options`]) api[`${R}/simulation/options`] = { tables: [], reglages: {}, defaut: {},
      versions: api[`${R}/versions`] || [], coeurs: 1, couverture: null, affine: false, test_n: 1000 };
    if (!api[`${R}/simulations`]) api[`${R}/simulations`] = [];
    const d = api[R], cleJetons = `/api/jouer/jetons?deck=${deck}`;
    if (!api[cleJetons]) api[cleJetons] = { jetons: await jetons(d.cartes.filter((c) => c.cat !== "Maybeboard").map((c) => c.nom)).catch(() => []) };
    const f = api["/api/recherche/fonctions"] || await o.api("/api/recherche/fonctions").catch(() => null);
    if (f) api["/api/recherche/fonctions"] = f;
    // cartes citées : aperçu au survol des noms qu'on peut croiser dans la page
    const fr = new Map(), dans = new Set(d.cartes.map((c) => c.nom));
    for (const c of d.cartes) fr.set(c.nom, c.info.fr || "");
    for (const [n, x] of Object.entries((p.comparer || {}).infos || {})) if (!fr.has(n)) fr.set(n, x.fr || "");
    for (const x of ((api[`${R}/suggestions`] || {}).cartes || [])) if (!fr.has(x.nom)) fr.set(x.nom, x.fr || "");
    const cites = new Set([...fr.keys(), ...((api[`${R}/combos`] || {}).combos || []).flatMap((c) => c.cartes),
      ...((api[`${R}/bracket`] || {}).gc_liste || []), ...((api[`${R}/suggestions`] || {}).cartes || []).flatMap((x) => (x.combos || []).flatMap((c) => c.cartes))]);
    const avant = api["/api/noms-cartes"] || {};
    api["/api/noms-cartes"] = { noms: [...cites].sort().map((n) => (fr.get(n) && fr.get(n) !== n ? [n, fr.get(n)] : [n])), communs: avant.communs || [] };
    for (const n of [...cites].filter((x) => !dans.has(x) && !api[`/api/apercu-carte?nom=${x}`]).sort()) {
      const a = await o.api(`/api/apercu-carte?nom=${encodeURIComponent(n)}`).catch(() => null);
      if (a) api[`/api/apercu-carte?nom=${n}`] = a;
    }
    return { deck, date: Date.now() / 1000, api, comparer: p.comparer };
  }

  // ------------------------------------------------------------------ partager, retirer (outils/serveur/pages.py)
  // les pages du compte, relues au plus toutes les cinq minutes (le PC a pu en publier ou en retirer)
  async function lesPages(frais = false) {
    let e = await o.lire(ETAT);
    if (frais || !e || Date.now() - (e.lu || 0) > 300000) {
      try {
        const r = await o.serveur("/partages");
        e = { pseudo: r.pseudo, lu: Date.now(), decks: Object.fromEntries((r.partages || []).map((x) => [x.deck,
          { url: x.url, slug: x.slug, date: x.date, visibilite: x.visibilite || "public" }])) };
        await o.ecrire(ETAT, e);
      } catch (_) { /* pas de réseau : ce qu'on sait */ }
    }
    return e || { decks: {} };
  }
  async function etat(deck) {
    const x = ((await lesPages()).decks || {})[deck];
    return x ? { url: x.url, date: x.date, visibilite: x.visibilite } : {};
  }
  // publie (ou met à jour) les pages de ces decks ; pseudo : un compte sans pseudo (sinon 409) ; voulu(deck) :
  // {visibilite, slug} (l'adresse que le deck a déjà dans l'appli : telephone.js › slugs)
  async function partager(decks, pseudo = null, voulu = () => ({})) {
    let e = await lesPages();
    for (const deck of decks) {
      const donnees = await capturer(deck), d = donnees.api[`/api/decks/${deck}`], b = donnees.api[`/api/decks/${deck}/bracket`] || {};
      const cmds = d.commandants || [], couleurs = nomCouleurs(d.identite), nbGc = (d.gc || []).length;
      const chiffres = [`${d.total} cartes · ${euros(d.prix_total)}`,
        [b.estime ? `Bracket ${b.estime}` : "", `${nbGc} Game Changer${nbGc > 1 ? "s" : ""}`].filter(Boolean).join(" · ")];
      const cmdCartes = d.cartes.filter((c) => c.cat === "Commander" && c.info.image);
      let jpg = null;
      try {
        jpg = await imageDeck(d.titre, "Deck Commander" + (couleurs ? ` · ${couleurs}` : ""), cmds, cmdCartes.map((c) => c.info.image),
          d.art || (cmdCartes[0] && cmdCartes[0].info.art) || "", d.identite, chiffres, pseudo || e.pseudo || "");
      } catch (_) { /* sans image */ }
      const r = await o.serveur("/partages", "POST", { deck, donnees: { ...donnees, version: VERSION }, image: jpg ? base64(jpg) : null,
        budget: o.reglages().budget, pseudo: pseudo || null, ...voulu(deck) });
      e = { ...e, pseudo: r.pseudo, decks: { ...(e.decks || {}), [deck]: { url: r.url, slug: r.slug, date: r.date, visibilite: r.visibilite || "public" } } };
      await o.ecrire(ETAT, e);
    }
    return decks.length === 1 ? etat(decks[0]) : {};
  }
  async function retirer(deck) {
    await o.serveur("/partages/retirer", "POST", { deck });
    const e = await lesPages();
    delete (e.decks || {})[deck];
    await o.ecrire(ETAT, e);
    return {};
  }
  // le deck a changé de nom : sa page garde son adresse (le lien déjà envoyé marche toujours), republiée ensuite
  async function renommer(ancien, nouveau) {
    const e = await lesPages();
    if (!(e.decks || {})[ancien]) return {};
    await o.serveur("/partages/renommer", "POST", { ancien, nouveau });
    e.decks[nouveau] = e.decks[ancien];
    delete e.decks[ancien];
    await o.ecrire(ETAT, e);
    return {};
  }
  async function partages() { return (await lesPages()).decks || {}; }
  const compteConnu = async () => true;
  return { etat, partager, retirer, renommer, partages, compteConnu, capturer, jetons };   // capturer : aussi pour voir/ ; jetons : les proxies
};
