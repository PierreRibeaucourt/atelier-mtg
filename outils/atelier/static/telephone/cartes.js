// La base de cartes de l'appli du téléphone et sa recherche : recherche.py refait en JavaScript, dans un Worker (la
// base, ≈ 35 Mo une fois décompressée, ne bloque pas l'écran). La base vient du site de l'appli (base_telephone.py) ;
// telephone.js la télécharge, la garde, et l'envoie ici. Les réponses ont la forme de celles du PC (mêmes pages).
// Messages : {id, f, a: [arguments]} → {id, r} ou {id, e: message d'erreur}.
"use strict";
const FORMAT = 1;                                    // base_telephone.py › FORMAT
const COULEURS = "WUBRG";
const TYPES = { AR: "Artifact", CR: "Creature", EN: "Enchantment", IN: "Instant", SO: "Sorcery", BAT: "Battle", PL: "Planeswalker", LA: "Land" };
const FORMATS = { commander: "commander", duel: "duel", modern: "modern", pioneer: "pioneer", standard: "standard", vintage: "vintage",
  legacy: "legacy", premodern: "premodern", pauper: "pauper", historic: "historic", alchemy: "alchemy" };
const SPECIAUX = new Set(["TR", "TK", "DUN", "PN", "SC", "CH", "HE", "CO"]);
const HORS_JEU = new Set(["TK", "DUN", "PN", "SC", "CH", "HE", "CO", "ME"]);
const RARETES = { M: "m", R: "r", U: "u", C: "c", S: "s" };
const NORMALES = new Set(["expansion", "core", "commander", "masters", "draft_innovation", "starter", "duel_deck", "planechase", "archenemy", "premium_deck"]);
const PAR_PAGE = 30, PAR_PAGE_CHOIX = [30, 60, 120, 240];
const FONCTIONS = [
  ["ramp", "Ramp (accélération)", ["ramp"]], ["mana-rock", "Mana rock (artefact de mana)", ["mana-rock"]],
  ["mana-dork", "Mana dork (créature de mana)", ["mana-dork"]], ["reducteur", "Réduction de coût", ["cost-reducer"]],
  ["pioche", "Pioche", ["draw"]], ["avantage", "Avantage de cartes (pioche, impulsion…)", ["card-advantage"]],
  ["wheel", "Wheel (défausser sa main, repiocher)", ["wheel"]], ["tuteur", "Tuteur (chercher une carte)", ["tutor"]],
  ["removal", "Removal (tous)", ["removal"]], ["spot", "Removal ciblé", ["spot-removal"]],
  ["removal-creature", "Removal de créature", ["removal-creature"]], ["balayage", "Balayage (wrath)", ["sweeper"]],
  ["contresort", "Contresort", ["counterspell"]], ["burn", "Burn (blessures)", ["burn"]],
  ["pinger", "Pinger (1 ou 2 blessures répétées)", ["pinger"]], ["drain", "Drain de vie", ["drain-life"]],
  ["gain", "Gain de vie", ["lifegain"]], ["defausse", "Défausse (adversaires)", ["discard"]],
  ["outlet-defausse", "Se défausser (outlet de défausse)", ["discard-outlet"]], ["sacrifice", "Sacrifice outlet", ["sacrifice-outlet"]],
  ["mort", "Déclencheur de mort", ["death-trigger"]], ["recursion", "Recursion (retour du cimetière)", ["recursion"]],
  ["reanimation", "Réanimation", ["reanimate"]], ["meule", "Meule (mill)", ["mill"]],
  ["haine-cimetiere", "Haine du cimetière", ["hate-graveyard"]], ["jetons", "Jetons (création répétée)", ["repeatable-token-generator"]],
  ["tresors", "Trésors (création répétée)", ["repeatable-treasures"]], ["anthem", "Anthem (+N/+N à l'équipe)", ["anthem"]],
  ["celerite", "Donne la célérité", ["gives-haste"]], ["evasion", "Évasion", ["evasion"]], ["protection", "Protection", ["protection"]],
  ["blink", "Blink (exiler puis renvoyer)", ["flicker"]], ["bounce", "Renvoi en main (bounce)", ["bounce"]],
  ["vol", "Vol de contrôle", ["theft"]], ["copie", "Copie, clone", ["copy"]], ["degagement", "Dégagement (untap)", ["untapper"]],
  ["tours", "Tours supplémentaires", ["extra-turn"]], ["combats", "Combats supplémentaires", ["extra-combat-phase"]],
  ["multiplicateur", "Multiplicateur de blessures", ["damage-multiplier"]], ["brouillard", "Brouillard (fog)", ["fog"]],
  ["pillowfort", "Pillowfort (dissuader d'attaquer)", ["pillowfort"]], ["group-hug", "Group hug", ["group-hug"]],
];
const FAMILLES = [["Balayages", ["balayage"], []], ["Contresorts", ["contresort"], []], ["Removal", ["removal"], []],
  ["Ramp", ["ramp", "mana-rock", "mana-dork", "reducteur", "tresors"], []], ["Tuteurs", ["tuteur"], ["tutor-land"]],
  ["Pioche", ["pioche", "avantage", "wheel"], []], ["Recursion", ["recursion", "reanimation"], []], ["Protection", ["protection"], []]];
const GENERALES = { removal: ["spot", "removal-creature", "balayage"], ramp: ["mana-rock", "mana-dork"], avantage: ["pioche", "wheel"] };
const GROUPES_EDITIONS = [["expansion", "Extensions"], ["core", "Éditions de base"], ["commander", "Commander"],
  ["masters", "Rééditions (Masters)"], ["eternal", "Rééditions (Masters)"], ["draft_innovation", "Draft spécial (Horizons, Jumpstart…)"],
  ["box", "Secret Lair et coffrets"], ["arsenal", "Secret Lair et coffrets"], ["treasure_chest", "Secret Lair et coffrets"],
  ["masterpiece", "Masterpiece"], ["from_the_vault", "From the Vault"], ["spellbook", "Signature Spellbook"],
  ["premium_deck", "Premium Deck Series"], ["duel_deck", "Duel Decks"], ["planechase", "Planechase et Archenemy"],
  ["archenemy", "Planechase et Archenemy"], ["starter", "Starter et Portal"], ["funny", "Fantaisie (Un-sets)"],
  ["promo", "Promos"], ["alchemy", "MTG Arena (numérique)"], ["vanguard", "Vanguard"]];
const BASES_FR = { Mountain: "Montagne", Swamp: "Marais", Island: "Île", Plains: "Plaine", Forest: "Forêt", Wastes: "Désolation" };

let B = null, REGLAGES = { sansUb: false };
const reglages = (r) => { REGLAGES = { ...REGLAGES, ...r }; return true; };

// ------------------------------------------------------------------ outils
// minuscules sans accents ; recopiée à la fin : sinon le navigateur garde des chaînes bien plus grandes (≈ 10 fois)
const norm = (s) => {
  let r = String(s || "").toLowerCase();
  if (/[^\x00-\x7f]/.test(r)) r = r.replace(/[’‘]/g, "'").normalize("NFD").replace(/\p{Mn}/gu, "");
  return (" " + r.replace(/\s+/g, " ")).slice(1);
};
// les mots du type qui comptent pour la recherche, en bits (au lieu d'un ensemble par carte : moins de mémoire)
const MOTS_TYPE = ["Artifact", "Creature", "Enchantment", "Instant", "Sorcery", "Battle", "Planeswalker", "Land", "Legendary", "Saga", "Kindred", "Tribal"];
const TY = Object.fromEntries(MOTS_TYPE.map((m, i) => [m, 1 << i]));
const aType = (x, m) => (x._ty & TY[m]) !== 0;
const VIDE = Object.freeze([]);
const cle = (nom) => String(nom).split(/ \/{1,2} /)[0];
const symboles = (cout) => [...String(cout || "").matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const chiffres = (s) => /^\d+$/.test(s);
const colores = (syms) => {
  const res = [];
  for (const s of syms) {
    const p = s.split("/"), cols = new Set(p.filter((k) => COULEURS.includes(k) && k.length === 1));
    if (cols.size) res.push([cols, p.includes("P") || p.some(chiffres)]);
  }
  return res;
};
const image = (u, taille = "normal") => (u ? `https://cards.scryfall.io/${taille}/front/${u[0]}/${u[1]}/${u}.jpg` : "");
const chemin = (c, taille = "normal") => (c ? `https://cards.scryfall.io/${taille}/${c}` : "");
const numero = (n) => { const m = String(n || "").match(/^\d+/); return m ? parseInt(m[0], 10) : 1e6; };
const nombre = (s) => { if (s == null || String(s).trim() === "") return null; const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) ? v : null; };
const inter = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
// tri à plusieurs clés, comme les tuples de Python
function compare(a, b) {
  if (Array.isArray(a)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = compare(a[i], b[i]); if (c) return c; }
    return a.length - b.length;
  }
  if (typeof a === "boolean") { a = +a; b = +b; }
  return a < b ? -1 : a > b ? 1 : 0;
}
const trier = (l, cleDe, desc) => { const k = l.map((x) => [cleDe(x), x]); k.sort((p, q) => (desc ? -1 : 1) * compare(p[0], q[0])); return k.map((p) => p[1]); };

// ------------------------------------------------------------------ la base
async function charger(donnees) {
  const gz = new Uint8Array(donnees, 0, 2);              // déjà décompressée par le navigateur si le serveur l'a voulu
  const flux = new Blob([donnees]).stream();
  const b = await new Response(gz[0] === 0x1f && gz[1] === 0x8b ? flux.pipeThrough(new DecompressionStream("gzip")) : flux).json();
  if (b.format !== FORMAT) throw new Error(b.format > FORMAT ? "Mets l'appli à jour : ferme-la, puis rouvre-la." : "Base de cartes trop ancienne.");
  preparer(b);
  return { nb: B.cartes.length, date: b.date };
}

// chaque carte refaite avec les mêmes champs dans le même ordre (le navigateur la range alors au plus serré) ; les
// symboles du coût, les éditions et la version de base de chaque édition se calculent pendant la recherche
function preparer(b) {
  const cartes = b.cartes.map((x) => {
    const c = x.c || "", t = x.t || "", pr = x.pr || VIDE;
    let ty = 0;
    for (const m of t.split(" // ").map((f) => f.split("—")[0]).join(" ").match(/[A-Za-z]+/g) || []) ty |= TY[m] || 0;
    return { n: x.n, c, mv: x.mv || 0, t, o: x.o || "", co: x.co || "", ci: x.ci || "", p: x.p ?? null, e: x.e ?? null, l: x.l ?? null,
      pt: x.pt || "", lay: x.lay || "", lg: x.lg || VIDE, gc: !!x.gc, rk: x.rk ?? null, spe: x.spe || "", fr: x.fr || "", tf: x.tf || "",
      of: x.of || "", eur: x.eur ?? null, foil: !!x.foil, s0: x.s0 || "", d0: x.d0 || "", dig: !!x.dig, fun: !!x.fun, ts: !!x.ts,
      im: pr.length ? x.im || 0 : null, imd: x.imd || "", tg: x.tg || VIDE, cm: !!x.cm, pa: !!x.pa, cl: x.cl || "", pm: x.pm || VIDE, pr,
      _n: norm(x.n), _nf: norm(x.fr), _t: norm(t), _tf: norm(x.tf), _o: norm(x.o), _of: norm(x.of), _x: symboles(c).includes("X"), _ty: ty };
  });
  b.cartes = null;
  const slugs = {};
  b.tags.forEach((t, i) => { slugs[t.s] = i; t.e = t.e || []; t.d = t.d || ""; });
  const parTag = new Map();
  cartes.forEach((x, k) => {
    if (!HORS_JEU.has(x.spe) && !x.dig && !x.fun) for (const t of x.tg) { if (!parTag.has(t)) parTag.set(t, []); parTag.get(t).push(k); }
  });
  const parCle = new Map(), parFr = new Map();
  for (const x of cartes) {
    if (x.spe === "ME") continue;
    const k = cleCarte(x);
    if (!parCle.has(k)) parCle.set(k, x);
    if (x._nf) for (const f of [x._nf, x._nf.split(" // ")[0]]) if (!parFr.has(f)) parFr.set(f, x);
  }
  B = { cartes, tags: b.tags, slugs, editions: b.editions, date: b.date, descendants: new Map(), fonctions: {}, parTag, parCle, parFr };
  for (const [k, , liste] of FONCTIONS) B.fonctions[k] = union(liste.map(descendants));
}
const aTag = (x, cibles) => x.tg.some((t) => cibles.has(t));
const cleCarte = (x) => cle(x.n).toLowerCase();
// la version de base de chaque édition (le plus petit numéro) : la rareté qui compte
const basesEditions = (x) => {
  const r = {};
  for (const p of x.pr) if (!r[p[0]] || numero(p[1]) < numero(r[p[0]][1])) r[p[0]] = p;
  return r;
};
const union = (ens) => { const r = new Set(); for (const e of ens) for (const x of e) r.add(x); return r; };

function descendants(slug) {
  if (B.descendants.has(slug)) return B.descendants.get(slug);
  const i = B.slugs[slug], vus = new Set(), pile = i != null ? [i] : [];
  while (pile.length) { const k = pile.pop(); if (!vus.has(k)) { vus.add(k); pile.push(...B.tags[k].e); } }
  B.descendants.set(slug, vus);
  return vus;
}
const prete = () => { if (!B) throw new Error("La base de cartes n'est pas encore prête."); return B; };
const trouver = (nom) => (B ? B.parCle.get(cle(nom).toLowerCase()) || null : null);

// ------------------------------------------------------------------ critères (recherche._filtre)
function termes(q) {
  const incl = [], excl = [];
  for (const m of norm(q).matchAll(/(!?)"([^"]+)"|(\S+)/g)) {
    if (m[2] != null) (m[1] ? excl : incl).push(m[2].trim());
    else if (m[3].startsWith("!")) { if (m[3].length > 1) excl.push(m[3].slice(1)); }
    else incl.push(m[3]);
  }
  return [incl.filter(Boolean), excl.filter(Boolean)];
}
const okTexte = (textes, incl, excl) => {
  if (excl.length && textes.some((h) => excl.some((t) => h.includes(t)))) return false;
  return !incl.length || textes.some((h) => incl.every((t) => h.includes(t)));
};
function motif(s) {
  s = String(s || "").toUpperCase().replace(/ /g, "");
  const toks = s.includes("{") ? [...s.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]) : s.match(/\d+|[WUBRGCXS?*]/g) || [];
  let gen = null;
  const cols = [], autres = new Map();
  for (const t of toks) {
    if (chiffres(t)) gen = (typeof gen === "number" ? gen : 0) + parseInt(t, 10);
    else if (t === "?") gen = "?";
    else if (t === "*") cols.push(null);
    else if ([...COULEURS].some((k) => t.includes(k))) cols.push(new Set([...t].filter((k) => COULEURS.includes(k))));
    else autres.set(t, (autres.get(t) || 0) + 1);
  }
  return { gen, cols, autres };
}
function okMotif(syms, m) {
  const g = syms.filter(chiffres).reduce((s, x) => s + parseInt(x, 10), 0);
  if ((m.gen === null && g) || (typeof m.gen === "number" && g !== m.gen) || (m.gen === "?" && !g)) return false;
  const c = new Map();
  for (const s of syms) if (["C", "X", "Y", "Z", "S"].includes(s)) c.set(s, (c.get(s) || 0) + 1);
  if (c.size !== m.autres.size || [...c].some(([k, v]) => m.autres.get(k) !== v)) return false;
  const carte = syms.filter((s) => [...COULEURS].some((k) => s.includes(k))).map((s) => new Set(s.split("/").filter((k) => COULEURS.includes(k))));
  if (carte.length !== m.cols.length) return false;
  const libres = new Set(carte.keys());
  const place = (i) => {
    if (i === m.cols.length) return true;
    for (const j of [...libres]) {
      if (m.cols[i] === null || inter(m.cols[i], carte[j])) {
        libres.delete(j);
        if (place(i + 1)) return true;
        libres.add(j);
      }
    }
    return false;
  };
  return place(0);
}
function okCouleurs(cc, sel, incolore, toutes, seules, oblig) {
  if (!sel.size && !incolore) return true;
  const sous = (a, b) => [...a].every((x) => b.has(x));
  const ok = toutes ? sous(sel, cc) && (!incolore || !cc.size) : inter(cc, sel) || (incolore && !cc.size);
  return ok && sous(oblig, cc) && (!seules || sous(cc, sel));
}
const comparer = (v, eq, mn, mx) => (eq === null || v === eq) && (mn === null || v >= mn) && (mx === null || v <= mx);
function okPt(val, eq, mn, mx, etoile) {
  if (eq === null && mn === null && mx === null) return true;
  if (val === null) return false;
  if (!/^-?\d+(\.\d+)?$/.test(val)) return etoile;
  return comparer(parseFloat(val), eq, mn, mx);
}
const lettres = (s, permis) => new Set([...String(s || "").toUpperCase()].filter((ch) => permis.includes(ch)));
const okImpression = (pr, eds, rar) => {
  if (eds.size && !eds.has(pr[0])) return false;
  if (rar.size && (!rar.has(pr[2]) || (!eds.size && !NORMALES.has((B.editions[pr[0]] || {}).ty)))) return false;
  return true;
};

function filtre(p) {
  const g = (k) => String(p[k] || "").trim(), oui = (k) => g(k) === "1";
  let fr = oui("fr"), en = oui("en");
  if (!fr && !en) fr = en = true;
  const tests = [];
  const langues = (x, k) => [...(en ? [x["_" + k]] : []), ...(fr && x["_" + k + "f"] ? [x["_" + k + "f"]] : [])];
  for (const [champ, k] of [["nom", "n"], ["type", "t"], ["texte", "o"]]) {
    if (g(champ)) { const [incl, excl] = termes(g(champ)); tests.push((x) => okTexte(langues(x, k), incl, excl)); }
  }
  if (oui("vanilla")) tests.push((x) => !x.o.trim());
  if (g("cout")) { const m = motif(g("cout")); tests.push((x) => x.c.split(" // ").map(symboles).some((s) => okMotif(s, m))); }
  if (oui("un")) tests.push((x) => [...COULEURS].every((k) => colores(symboles(x.c)).filter(([cols]) => cols.has(k)).length <= 1));
  const spe = { colorless: (x) => symboles(x.c).includes("C"), split: (x) => x.lay === "split", flip: (x) => x.lay === "flip",
    dfc: (x) => ["transform", "modal_dfc", "meld"].includes(x.lay), adv: (x) => x.lay === "adventure",
    hyb: (x) => symboles(x.c).some((s) => s.includes("/") && !s.includes("P")), phy: (x) => symboles(x.c).some((s) => s.split("/").includes("P")),
    time: (x) => x.ts, historic: (x) => (x._ty & (TY.Legendary | TY.Artifact | TY.Saga)) !== 0, X: (x) => x._x }[g("spe")];
  if (spe) tests.push(spe);
  // couleurs : chaque couleur choisie « peut » (une au moins) ou « doit » (oblig), aucune autre que celles choisies
  let oblig = lettres(g("oblig"), COULEURS);
  const sel = new Set([...lettres(g("coul"), COULEURS), ...oblig]), incolore = g("coul").toUpperCase().includes("C");
  if (g("cm") === "2") oblig = new Set(sel);
  if (sel.size || incolore) {
    const ident = oui("id");
    tests.push((x) => okCouleurs(new Set(ident ? x.ci : x.co), sel, incolore, false, true, oblig));
  }
  const types = g("types").split(",").filter((t) => TYPES[t]).map((t) => TYPES[t]);
  if (types.length) { const tous = g("tm") === "2"; tests.push((x) => (tous ? types.every((t) => aType(x, t)) : types.some((t) => aType(x, t)))); }
  const spt = g("spt");
  if (spt === "TR") tests.push((x) => aType(x, "Kindred") || aType(x, "Tribal"));
  else if (SPECIAUX.has(spt)) tests.push((x) => x.spe === spt);
  else tests.push((x) => !HORS_JEU.has(x.spe));
  const eq = nombre(g("mv")), mn = nombre(g("mvmin")), mx = nombre(g("mvmax"));
  const pair = oui("pair"), impair = oui("impair"), avecX = oui("mvx");
  if (eq !== null || mn !== null || mx !== null || pair || impair) {
    tests.push((x) => {
      const v = x.mv;
      if (x._x) return avecX && (eq === null || v <= eq) && (mx === null || v <= mx);
      if (!comparer(v, eq, mn, mx)) return false;
      return !((pair && v % 2) || (impair && !(v % 2)));
    });
  }
  for (const [k, champ] of [["p", "f"], ["e", "e"]]) {
    const a = nombre(g(champ)), b = nombre(g(champ + "min")), c = nombre(g(champ + "max"));
    if (a !== null || b !== null || c !== null) { const etoile = oui(champ + "x"); tests.push((x) => okPt(x[k], a, b, c, etoile)); }
  }
  const fmt = FORMATS[g("format")];
  if (fmt) tests.push((x) => x.lg.includes(fmt));
  const eds = new Set(g("eds").toLowerCase().split(",").filter(Boolean));
  const rar = new Set([...g("rar").toUpperCase()].filter((k) => RARETES[k]).map((k) => RARETES[k]));
  if (rar.size) tests.push((x) => Object.values(basesEditions(x)).some((pr) => okImpression(pr, eds, rar)));
  else if (eds.size) {
    tests.push((x) => x.pr.some((q) => eds.has(q[0])));
    if (oui("neuves")) tests.push((x) => eds.has(x.s0));
  }
  const numerique = fmt === "historic" || fmt === "alchemy" || [...eds].some((e) => (B.editions[e] || {}).dig);
  if (!numerique) tests.push((x) => !x.dig);
  if (!oui("fun") && ![...eds].some((e) => (B.editions[e] || {}).ty === "funny")) tests.push((x) => !x.fun);
  const pmax = nombre(g("prixmax")), pmin = nombre(g("prixmin"));
  if (pmax !== null || pmin !== null) tests.push((x) => x.eur !== null && comparer(x.eur, null, pmin, pmax));
  if (g("gc") === "sans") tests.push((x) => !x.gc);
  else if (g("gc") === "seul") tests.push((x) => x.gc);
  if (g("cmd") === "peut") tests.push((x) => x.cm);
  else if (g("cmd") === "duo") tests.push((x) => x.pa);
  for (const fn of g("fn").split(",").filter(Boolean)) {
    const cibles = B.fonctions[fn] || descendants(fn);
    tests.push((x) => aTag(x, cibles));
  }
  return tests;
}

// ------------------------------------------------------------------ résultats (recherche.chercher, _sortie)
function cleCouleur(x) {
  const cc = x.co;
  if (aType(x, "Land") && !cc) return [8, []];
  if (!cc) return [7, []];
  if (cc.length === 1) return [COULEURS.indexOf(cc), []];
  return [5 + (cc.length > 2 ? 1 : 0), [...cc].map((k) => COULEURS.indexOf(k))];
}
const ORDRE_TYPES = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land"];
const rangType = (x) => { if (aType(x, "Land")) return 7; const i = ORDRE_TYPES.findIndex((t) => aType(x, t)); return i < 0 ? 8 : i; };
const TRIS = {
  couleur: (x) => [cleCouleur(x), x.mv, x._n], nom: (x) => x._n, nomfr: (x) => x._nf || x._n, type: (x) => [rangType(x), x._n],
  cout: (x) => [x.mv, x._n], prix: (x) => [x.eur === null, x.eur || 0, x._n], pop: (x) => [x.rk === null, x.rk || 0], date: (x) => [x.d0 || "", x._n],
};

function sortie(x, dans, imp = null) {
  const pr = x.pr;
  let p = imp !== null ? imp : x.im !== null && pr.length ? pr[x.im] : null;
  if (imp === null && p && p[7] && REGLAGES.sansUb) p = pr.find((q) => !q[7] && q[5]) || p;     // Options : éviter les Universes Beyond
  const ed = p ? B.editions[p[0]] || {} : {};
  const texteFr = (x.of || "").replace(/[^\p{L}\p{N}_]/gu, "").length > 3 ? x.of : "";
  return { nom: x.n, fr: x.fr, cout: x.c, mv: x.mv, type: x.t, type_fr: x.tf, texte: x.o, texte_fr: texteFr, pt: x.pt, couleurs: [...x.ci],
    gc: x.gc, prix: imp === null ? x.eur : p[4], foil: x.foil && imp === null, legal: x.lg.includes("commander") ? "legal" : "", rang: x.rk,
    image: p ? image(p[5]) : "", petite: p ? image(p[5], "small") : "",
    image_dos: imp === null && x.imd ? chemin(x.imd) : "", commandant: x.cm, partenaire: x.pa,
    edition: p ? { set: p[0], num: p[1], rarete: p[2], nom: ed.fr || ed.n || p[0].toUpperCase(), annee: p[3].slice(0, 4), icone: ed.ic || "" } : null,
    versions: pr.length, dans: (dans || {})[cleCarte(x)] || null };
}

// dans : les cartes du deck lié {clé: "commandant" | "deck" | "maybe"} ; notes : pertinence pour ce deck {clé: note}
function chercher(p, dans = {}, notes = null) {
  prete();
  const tests = filtre(p);
  if ((p.horsdeck || "") === "1" && Object.keys(dans).length) tests.push((x) => !["deck", "commandant"].includes(dans[cleCarte(x)]));
  let res = B.cartes.filter((x) => tests.every((t) => t(x)));
  const ordre = p.ordre || "couleur", desc = p.sens === "desc";
  if (ordre === "pertinence" && notes) res = trier(res, (x) => [-(notes[cleCarte(x)] || 0), x.rk === null, x.rk || 0], desc);
  else res = trier(res, TRIS[ordre] || TRIS.couleur, desc);
  let lignes;
  if (p.versions === "1") {
    const eds = new Set(String(p.eds || "").toLowerCase().split(",").filter(Boolean));
    const rar = new Set([...String(p.rar || "").toUpperCase()].filter((k) => RARETES[k]).map((k) => RARETES[k]));
    lignes = res.flatMap((x) => x.pr.filter((imp) => okImpression(imp, eds, rar)).map((imp) => [x, imp]));
  } else lignes = res.map((x) => [x, null]);
  let par = Math.trunc(nombre(p.par) || PAR_PAGE);
  if (!PAR_PAGE_CHOIX.includes(par)) par = PAR_PAGE;
  const pages = Math.max(1, Math.ceil(lignes.length / par));
  const page = Math.min(Math.max(1, Math.trunc(nombre(p.page) || 1)), pages);
  return { total: res.length, lignes: lignes.length, page, pages, par_page: par,
    cartes: lignes.slice((page - 1) * par, page * par).map(([x, imp]) => sortie(x, dans, imp)) };
}

function editions() {
  prete();
  const ordre = [...new Set(GROUPES_EDITIONS.map(([, lib]) => lib))], groupe = Object.fromEntries(GROUPES_EDITIONS), par = {};
  for (const lib of ordre) par[lib] = [];
  for (const [code, e] of Object.entries(B.editions)) {
    const lib = groupe[e.ty];
    if (lib && !e.dig) par[lib].push({ code, nom: e.fr || e.n, en: e.n, date: e.d, nb: e.nb, icone: e.ic });
  }
  return ordre.filter((lib) => par[lib].length).map((lib) => ({ groupe: lib, editions: trier(par[lib], (e) => e.date, true) }));
}
const fonctions = () => FONCTIONS.map(([k, lib]) => ({ cle: k, nom: lib }));
const compte = (tags) => { const r = new Set(); for (const t of tags) for (const k of B.parTag.get(t) || []) r.add(k); return r.size; };

function suggestions(q, n = 25) {
  prete();
  const qn = norm(q).trim().replace(/-/g, " "), mots = qn.split(" ").filter(Boolean), res = [], vus = new Set();
  for (const [k, lib, slugs] of FONCTIONS) {
    const h = norm(lib) + " " + slugs.map((s) => s.replace(/-/g, " ")).join(" ");
    if (mots.every((m) => h.includes(m))) res.push({ cle: k, nom: lib, desc: "", fr: true, nb: compte(B.fonctions[k]) });
    slugs.forEach((s) => vus.add(s));
  }
  if (mots.length) {
    const autres = [];
    B.tags.forEach((t, i) => {
      const h = t.s.replace(/-/g, " ");
      if (!vus.has(t.s) && mots.every((m) => h.includes(m))) autres.push([!h.startsWith(qn), h.length, i]);
    });
    autres.sort(compare);
    for (const [, , i] of autres.slice(0, n * 2)) {
      const t = B.tags[i], nb = compte(descendants(t.s));
      if (nb) res.push({ cle: t.s, nom: t.s.replace(/-/g, " "), desc: t.d, fr: false, nb });
    }
  }
  return res.slice(0, n);
}

function eligibilite(nom) { const x = trouver(nom); return x ? { commandant: x.cm, partenaire: x.pa } : null; }

// le champ du haut : nom exact, puis début du nom (ou d'un mot), puis le reste ; à égalité, les plus jouées
function noms(q, dans = {}, n = 8) {
  prete();
  const qn = norm(q).trim();
  if (qn.length < 2) return [];
  const mots = qn.split(/[^\p{L}\p{N}_']+/u).filter(Boolean), trouves = [];
  for (const x of B.cartes) {
    if (HORS_JEU.has(x.spe) || x.dig || x.fun) continue;
    let rang = null;
    for (const h of [x._n, x._nf]) {
      if (!h) continue;
      let r;
      if (h.includes(qn)) {
        const faces = h.split(" // ");
        r = faces.includes(qn) ? 0 : faces.some((f) => f.startsWith(qn)) ? 1 : faces.some((f) => f.split(" ").some((m) => m.startsWith(qn))) ? 2 : 3;
      } else if (mots.length > 1 && mots.every((m) => h.includes(m))) r = 3;
      else continue;
      rang = rang === null ? r : Math.min(rang, r);
    }
    if (rang !== null) trouves.push([[rang, x.rk === null, x.rk || 0, x._n], x]);
  }
  trouves.sort((a, b) => compare(a[0], b[0]));
  return trouves.slice(0, n).map(([, x]) => sortie(x, dans));
}

function fonctionsCartes(liste) {
  prete();
  const court = Object.fromEntries(FONCTIONS.map(([k, lib]) => [k, lib.replace(/\s*\(.*\)$/, "")]));
  if (!B.familles) B.familles = FAMILLES.map(([lib, cles, sauf]) => {
    const sans = union(sauf.map(descendants));
    return [lib, new Set([...union(cles.map((c) => B.fonctions[c]))].filter((t) => !sans.has(t)))];
  });
  const res = {};
  for (const n of liste) {
    const x = trouver(n);
    const fns = FONCTIONS.map(([k]) => k).filter((k) => x && aTag(x, B.fonctions[k]));
    const fam = B.familles.filter(([, tags]) => x && aTag(x, tags)).map(([lib]) => lib);
    res[n] = [fam, fns.filter((c) => !(GENERALES[c] || []).some((p) => fns.includes(p))).map((c) => court[c])];
  }
  return res;
}

function impressionImage(nom, set) {
  const x = trouver(nom);
  if (!x) return null;
  const ed = B.editions[set || ""] || {}, p = x.pr.find((q) => q[0] === set);
  return { edition: ed.fr || ed.n || "", annee: ((p ? p[3] : ed.d) || "").slice(0, 4), versions: x.pr.length };
}

function apercu(nom) {
  const x = trouver(nom);
  if (!x) return null;
  const s = sortie(x, {});
  return { nom: s.nom, fr: s.fr, image: s.image, prix: s.prix, foil: s.foil };
}

// ------------------------------------------------------------------ fiches des cartes d'un deck (infos_cartes._fiche)
function fiche(x) {
  const p = x.im !== null ? x.pr[x.im] : null, faces = x.n.split(" // "), types = x.t.split(" // ");
  const texteFr = (x.of || "").replace(/[^\p{L}\p{N}_]/gu, "").length > 3 ? x.of : "";
  return {
    nom: x.n, cout: x.c.split(" // ")[0], mv: x.mv, type: types[0], texte: x.o, couleurs: [...x.ci],
    image: p ? image(p[5]) : "", petite: p ? image(p[5], "small") : "", art: p ? image(p[5], "art_crop") : "",
    gc: x.gc, prix: x.eur, prix_lien: "", prix_date: null, prix_edition: "", fr: BASES_FR[x.n] || x.fr || "", fr_type: x.tf, fr_texte: texteFr,
    legal: x.cl || (x.lg.includes("commander") ? "legal" : "not_legal"), produit: x.pm, pt: x.pt, gatherer: "",
    dos: x.imd ? { nom: faces[1] || "", type: types[1] || "", image: chemin(x.imd), petite: chemin(x.imd, "small") } : null,
    assemble: null, peut_commander: x.cm, partenaire: x.pa, lay: x.lay,
    imp: p ? { set: p[0], num: p[1], lang: p[6] || "en" } : null,
  };
}
// une impression précise d'une carte (« (ima) 205 » dans la liste) : son image, son édition
function impression(nom, set, num) {
  const x = trouver(nom), p = x && x.pr.find((q) => q[0] === String(set).toLowerCase() && q[1] === String(num));
  if (!p) return null;
  const ed = B.editions[p[0]] || {};
  return { set: p[0], num: p[1], lang: p[6] || "en", nom: x.n, edition: ed.n || p[0].toUpperCase(), annee: p[3].slice(0, 4),
    image: image(p[5]), petite: image(p[5], "small"), art: image(p[5], "art_crop"), prix: p[4], prix_foil: null };
}
const gameChangers = () => B.cartes.filter((x) => x.gc && !x.dig).map((x) => x.n).sort();
// des noms tapés ou collés (anglais, français, majuscules quelconques) : {nom tapé: fiche} ; absents si inconnus
function fiches(liste) {
  prete();
  const res = {};
  for (const n of liste) {
    const x = trouver(n) || B.parFr.get(norm(n).trim());
    if (x) res[n] = fiche(x);
  }
  return res;
}

// ------------------------------------------------------------------ les messages de telephone.js
const F = { charger, reglages, chercher, editions, fonctions, suggestions, eligibilite, noms, fonctionsCartes, impressionImage, apercu, fiches, impression, gameChangers };
self.onmessage = async (ev) => {
  const { id, f, a } = ev.data;
  try { self.postMessage({ id, r: await F[f](...(a || [])) }); }
  catch (e) { self.postMessage({ id, e: String((e && e.message) || e) }); }
};
