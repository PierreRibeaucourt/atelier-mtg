// Les pages de l'Atelier faites sur le téléphone, quand il n'y a pas de PC (« Commencer ici ») : les mêmes réponses que
// celles que le PC prépare pour le téléphone (telephone.py, partage.capturer), tirées des fichiers des decks gardés sur
// le téléphone (même rangement que la sauvegarde : « Deck X/archidekt.txt », « Deck X/historique/… ») et de la base de
// cartes. telephone.js les range comme celles du PC : le reste de l'appli ne voit pas la différence.
//
// o : ce que fournit telephone.js : fiches(noms) → {nom: fiche}, fonctions(noms) → {nom: [familles, fonctions]},
// impressionImage(nom, set), version(nom, ed, langue) → impression ou null, gcListe() → noms, suggestions(entrees,
// écartées, combos), spellbook(deck, entrees) → {sb: analyse de Commander Spellbook ou null, a_jour}, budget, categories.
window.PAGES = (() => {
  const FORMATS = ["archidekt", "moxfield", "arena", "mtgo", "simple", "fr"];
  const TUTEUR = /search your library for (?:a|an|up to \w+|two|three) (?![\w ,-]*\b(?:basic|lands?|plains|island|swamp|mountain|forest)\b)[\w ,-]*?cards?/i;
  const cle = (nom) => String(nom).split(/ \/{1,2} /)[0];
  const compter = (noms) => { const c = new Map(); for (const n of noms) c.set(n, (c.get(n) || 0) + 1); return c; };
  const moins = (a, b) => [...a].flatMap(([n, k]) => Array(Math.max(0, k - (b.get(n) || 0))).fill(n)).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const nomsJeu = (entrees) => entrees.filter((e) => MOTEUR.categorie(e) !== "Maybeboard").flatMap((e) => Array(e.n).fill(e.nom));
  const json = (t, defaut) => { try { return t ? JSON.parse(t) : defaut; } catch (_) { return defaut; } };
  const versionCourte = (v) => (v ? { set: v.set, num: v.num, lang: v.lang, edition: v.edition, annee: v.annee } : null);

  // ------------------------------------------------------------------ exports (decks.exporter, app.py › nom_export)
  function nomExport(n, fmt, f) {
    if (fmt === "fr") return (f && f.fr) || n;
    if (n.includes(" // ") && (fmt === "arena" || fmt === "mtgo")) {
      if (f && ["split", "aftermath"].includes(f.lay)) return fmt === "mtgo" ? n.replace(/ \/\/ /g, "/") : n;
      return cle(n);
    }
    return n;
  }
  function exporter(entrees, fmt, fiches) {
    if (fmt === "archidekt") return MOTEUR.texte(entrees);
    const cmd = entrees.filter((e) => MOTEUR.categorie(e) === "Commander");
    const jeu = MOTEUR.ordonner(entrees).filter((e) => !["Commander", "Maybeboard"].includes(MOTEUR.categorie(e)));
    const ligne = (e) => {
      const ed = e.edition || {};
      const imp = fmt === "moxfield" && ed.set ? ` (${ed.set.toUpperCase()}) ${ed.num || ""}`.trimEnd() + (ed.fini === "F" ? " *F*" : "") : "";
      return `${e.n} ${nomExport(e.nom, fmt, fiches[e.nom])}${imp}`;
    };
    let blocs;
    if (fmt === "moxfield" || fmt === "arena") blocs = [...(cmd.length ? [["Commander", ...cmd.map(ligne)]] : []), ["Deck", ...jeu.map(ligne)]];
    else if (fmt === "mtgo") blocs = [jeu.map(ligne), cmd.map(ligne)];
    else blocs = [[...cmd, ...jeu].map(ligne)];
    return blocs.filter((b) => b.length).map((b) => b.join("\n")).join("\n\n") + "\n";
  }

  // ------------------------------------------------------------------ versions (decks.versions, libelle)
  // la date d'un fichier : celle de son nom (2026-11-12_194301.txt), le téléphone ne garde pas celle du fichier
  const dateDe = (nom) => {
    const m = String(nom).match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() / 1000 : 0;
  };
  function libelle(id, rel, meta) {
    if (!rel) return "Liste actuelle";
    const b = rel.split("/").pop();
    if (rel.startsWith("versions/") && meta[b]) return meta[b].nom;
    if (rel.startsWith("historique/")) {
      const m = b.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})\d{2}(?:_\d+)?\.txt$/);
      return m ? `Historique du ${m[1]} ${m[2]}:${m[3]}` : "Historique : " + b.replace(/\.[^.]*$/, "");
    }
    return b.replace(/\.[^.]*$/, "").replace(/_/g, " ");
  }
  function fichiersVersions(id, f) {
    const res = [];
    for (const rel of Object.keys(f)) {
      if (!rel.startsWith(id + "/") || !rel.endsWith(".txt")) continue;
      const r = rel.slice(id.length + 1), p = r.split("/");
      if (p.length === 2 && p[0] === "versions") res.push([r, "nommee"]);
      else if (p.length === 2 && p[0] === "historique") res.push([r, "auto"]);
      else if (p.length === 1 && r.startsWith("liste") && r !== "liste-achat.txt") res.push([r, "ancienne"]);
    }
    return res;
  }
  function versions(id, f, entrees) {
    const actuelle = compter(nomsJeu(entrees));
    const meta = json(f[`${id}/versions/versions.json`], {}), journal = json(f[`${id}/historique/journal.json`], {});
    const res = [];
    for (const [rel, type] of fichiersVersions(id, f)) {
      const v = compter(nomsJeu(MOTEUR.lire(f[`${id}/${rel}`])));
      if (!v.size) continue;
      const b = rel.split("/").pop(), m = type === "nommee" ? meta[b] || {} : {};
      res.push({ fichier: rel, type, nom: libelle(id, rel, meta), note: m.note || journal[b] || "",
        date: type === "nommee" && m.date ? new Date(m.date).getTime() / 1000 : dateDe(b),
        total: [...v.values()].reduce((s, k) => s + k, 0), plus: moins(v, actuelle), moins: moins(actuelle, v) });
    }
    return res.sort((a, b) => b.date - a.date);
  }

  // ------------------------------------------------------------------ Commander Spellbook (bracket.py, combos.py), par le relais
  const TAGS = { R: [4, "Ruthless"], S: [3, "Spicy"], P: [3, "Powerful"], O: [2, "Oddball"], C: [2, "Core"], E: [1, "Exhibition"], B: [null, "carte bannie"] };
  const tagDe = (t) => TAGS[t] || [null, t ?? null];
  const PHRASES = {
    "target opponent loses the game": "Un adversaire ciblé perd la partie", "each opponent loses the game": "Chaque adversaire perd la partie",
    "win the game": "Vous gagnez la partie", "lock": "Verrou",
    "you control one opponent on each of their turns": "Vous contrôlez un adversaire pendant chacun de ses tours",
    "infinitely large creature until end of turn": "Créature infiniment grande jusqu'à la fin du tour", "infinite turns": "Tours supplémentaires à l'infini",
  };
  const NOMS = {
    "damage": "dégâts", "damage to all players": "dégâts à tous les joueurs", "damage to creatures": "dégâts aux créatures",
    "damage to each opponent": "dégâts à chaque adversaire",
    "lifegain": "gain de vie", "lifeloss": "perte de vie", "lifeloss for all players": "perte de vie pour tous les joueurs",
    "lifegain triggers": "déclenchements de gain de vie", "lifeloss triggers": "déclenchements de perte de vie",
    "creature etb": "arrivées de créatures", "creature ltb": "départs de créatures", "etb": "arrivées", "ltb": "départs",
    "death triggers": "déclenchements de mort", "creature sacrifice triggers": "sacrifices de créatures",
    "sacrifice triggers": "sacrifices", "draw triggers": "déclenchements de pioche", "card draw": "pioche",
    "card draw for each opponent": "pioche pour chaque adversaire", "draw triggers for each opponent": "déclenchements de pioche adverses",
    "looting": "pioche-défausse", "self-discard triggers": "défausses", "discard triggers": "défausses",
    "storm count": "compteur de tempête", "blinking of permanents": "clignotements de permanents",
    "mana": "mana", "colored mana": "mana coloré", "colorless mana": "mana incolore", "red mana": "mana rouge",
    "black mana": "mana noir", "blue mana": "mana bleu", "white mana": "mana blanc", "green mana": "mana vert",
    "mana lands you control can produce": "mana de vos terrains", "mana creatures you control can produce": "mana de vos créatures",
    "magecraft triggers": "déclenchements de magecraft", "cast triggers": "déclenchements de lancement",
    "+1/+1 counters on a creature": "marqueurs +1/+1 sur une créature", "creature tokens": "jetons de créature",
    "tokens": "jetons", "mill": "meule", "self-mill": "meule de votre bibliothèque", "untap of creatures": "dégagements de créatures",
    "untap of permanents": "dégagements de permanents", "untap of creatures you control": "dégagements de vos créatures",
    "creature tokens with haste": "jetons de créature avec la célérité", "combat phases": "phases de combat", "landfall triggers": "déclenchements d'atterrissage",
    "attack triggers": "déclenchements d'attaque", "spells cast": "sorts lancés",
  };
  const CLASSES = { victoire: "Victoire", verrou: "Verrou", mana: "Mana infini", pioche: "Pioche", boucle: "Boucle infinie", valeur: "Valeur", menace: "Menace", syn: "Synergie" };
  function enFrancais(feature) {
    const b = feature.trim().toLowerCase();
    if (b in PHRASES) return PHRASES[b];
    const m = b.match(/^(near-)?infinite\s+(.+)$/);
    if (m && m[2] in NOMS) { const n = NOMS[m[2]]; return n[0].toUpperCase() + n.slice(1) + (m[1] ? " presque à l'infini" : " à l'infini"); }
    return feature.trim();
  }
  function classe(produits) {
    const p = produits.map((x) => x.toLowerCase());
    const a = (mots, sauf = []) => p.some((x) => mots.some((m) => x.includes(m)) && !sauf.some((s) => x.includes(s)));
    if (a(["loses the game", "win the game", "poison", "combat phases"]) || a(["damage", "lifeloss", "mill"], ["to creatures", "self-mill"])) return "victoire";
    if (a(["lock", "control one opponent", "infinite turns"])) return "verrou";
    if (a(["mana"], ["magecraft"])) return "mana";
    if (a(["card draw", "looting"])) return "pioche";
    if (a(["infinite"])) return "boucle";
    return "valeur";
  }
  // une combo de Spellbook (bracket._combo)
  function comboSb(c, dans) {
    const noms = (c.uses || []).map((u) => u.card.name), [b, tag] = tagDe(c.bracketTag);
    return { id: c.id || "", cartes: noms, manque: noms.filter((n) => !dans.has(n)),
      autres: (c.requires || []).map((r) => r.template.name + ((r.quantity || 1) > 1 ? ` (×${r.quantity})` : "")),
      produit: (c.produces || []).map((x) => x.feature.name).slice(0, 8), description: c.description || "",
      prerequis: c.easyPrerequisites || "", prerequis2: c.notablePrerequisites || "", mana: c.manaNeeded || "",
      popularite: c.popularity ?? null, identite: c.identity || "", bracket: b, tag, lien: c.id ? `https://commanderspellbook.com/combo/${c.id}/` : "" };
  }
  // au format commun de l'onglet Combos (combos._spellbook)
  const enCommun = (c) => { const k = classe(c.produit); return { ...c, source: "spellbook", classe: k, classe_lib: CLASSES[k], resultats: c.produit.map(enFrancais) }; };
  const jeuDe = (entrees) => entrees.filter((e) => MOTEUR.categorie(e) !== "Maybeboard");
  const dansDe = (noms) => new Set(noms.flatMap((n) => [n, n.split(" // ")[0]]));
  // ce qu'on envoie à Spellbook (bracket._liste)
  function corpsSpellbook(entrees) {
    const jeu = jeuDe(entrees);
    return { main: jeu.filter((e) => MOTEUR.categorie(e) !== "Commander").map((e) => ({ card: e.nom, quantity: e.n })),
      commanders: jeu.filter((e) => MOTEUR.categorie(e) === "Commander").map((e) => ({ card: e.nom, quantity: 1 })) };
  }
  // l'analyse d'une liste (bracket.spellbook) : estimate-bracket et find-my-combos
  function analyse(est, fmc, entrees) {
    const dans = dansDe(jeuDe(entrees).map((e) => e.nom)), [b, libelle] = tagDe(est.bracketTag);
    const drapeau = (f) => (est.cards || []).filter((c) => c[f]).map((c) => c.card.name);
    return { date: Date.now() / 1000, tag: est.bracketTag ?? null, bracket: b, libelle, banned: drapeau("banned"), gameChanger: drapeau("gameChanger"),
      massLandDenial: drapeau("massLandDenial"), extraTurn: drapeau("extraTurn"),
      combos: (fmc.included || []).map((c) => comboSb(c, dans)), presque: (fmc.almostIncluded || []).map((c) => comboSb(c, dans)).slice(0, 80) };
  }
  function sansDoublons(liste) {                       // une même combo (mêmes cartes) : la plus populaire
    const cle = (c) => c.cartes.map((n) => n.split(" // ")[0].toLowerCase()).sort().join("|"), garde = new Map();
    for (const c of [...liste].sort((a, b) => (b.popularite || 0) - (a.popularite || 0))) if (!garde.has(cle(c))) garde.set(cle(c), c);
    const retenues = new Set(garde.values());
    return liste.filter((c) => retenues.has(c));
  }
  function avecFiches(liste, I, dans) {                // combos._fiches
    for (const c of liste) {
      c.fiches = c.cartes.map((n) => { const f = I[n] || {};
        return { nom: n, fr: f.fr || "", image: f.image || "", prix: f.prix ?? null, couleurs: f.couleurs || [], dans: dans.has(n) || dans.has(n.split(" // ")[0]) }; });
    }
    return liste;
  }
  // l'onglet Combos, vue « le deck » (combos.combos_deck), sans MTGPics ni Claude
  function combosDeck(sb, I, dans, erreur) {
    const liste = avecFiches(sansDoublons((sb ? sb.combos : []).map(enCommun)), I, dans);
    liste.sort((a, b) => (b.popularite || 0) - (a.popularite || 0));
    return { combos: liste, synergies: { actif: false, resultat: null, erreur: "", a_jour: false }, erreur, mtgpics: null };
  }
  // vue « une carte » (combos.combos_carte) : resultats de /variants de Spellbook
  function combosCarte(carte, resultats, I, dans, ident, maybe, erreur) {
    let liste = avecFiches(sansDoublons(resultats.map((c) => enCommun(comboSb(c, new Set())))), I, dans);
    if (ident) liste = liste.filter((c) => c.fiches.every((f) => f.couleurs.every((x) => ident.has(x))));
    for (const c of liste) {
      c.manque = c.fiches.filter((f) => !f.dans && f.nom !== carte).map((f) => f.nom);
      c.maybe = c.manque.filter((n) => maybe.has(n));
    }
    liste.sort((a, b) => a.manque.length - b.manque.length || (b.popularite || 0) - (a.popularite || 0));
    return { carte, combos: liste, erreur, mtgpics: null, couleurs: ident ? [...ident].sort().join("") : null };
  }
  // les suggestions « combos » : une carte manque (suggestions._combos)
  function presque(sb) {
    const res = {};
    for (const c of (sb && sb.presque) || []) if (c.manque.length === 1) (res[c.manque[0]] = res[c.manque[0]] || []).push(c);
    return res;
  }

  // ------------------------------------------------------------------ bracket (bracket.bracket) ; sp : {sb, a_jour, erreur}
  function bracket(entrees, fiches, gcListe, sp = {}) {
    const noms = jeuDe(entrees).map((e) => e.nom), sb = sp.sb || null;
    const texte = (n) => (fiches[n] || {}).texte || "";
    const gc = noms.filter((n) => (fiches[n] || {}).gc);
    const tuteurs = noms.filter((n) => TUTEUR.test(texte(n).replace(/\([^)]*\)/g, "")));
    const mld = sb ? sb.massLandDenial : [];
    const tours = [...new Set([...noms.filter((n) => /extra turn/i.test(texte(n))), ...(sb ? sb.extraTurn : [])])].sort();
    const combos2 = (sb ? sb.combos : []).filter((c) => c.cartes.length <= 2);
    let raisons = [], estime;
    if (sb && sb.banned.length) {
      estime = null;
      raisons = [`carte bannie en Commander : ${sb.banned.join(", ")}`];
    } else if (gc.length > 3 || mld.length || tours.length > 2) {
      estime = 4;
      if (gc.length > 3) raisons.push(`${gc.length} Game Changers (3 au plus en bracket 3)`);
      if (mld.length) raisons.push("destruction massive de terrains : " + mld.join(", "));
      if (tours.length > 2) raisons.push(`${tours.length} cartes de tours supplémentaires`);
    } else if (gc.length || combos2.length) {
      estime = 3;
      if (gc.length) raisons.push(`${gc.length} Game Changer${gc.length > 1 ? "s" : ""} : ${gc.join(", ")}`);
      if (combos2.length) raisons.push(`${combos2.length} combo${combos2.length > 1 ? "s" : ""} infinie${combos2.length > 1 ? "s" : ""} à 2 cartes : à ne pas sortir en début de partie`);
    } else {
      estime = 2;
      raisons.push("aucun Game Changer, aucune combo infinie à 2 cartes : bracket 2 (ou 1 si le deck est très décontracté)");
    }
    if (tours.length && estime && estime < 4) raisons.push(`tours supplémentaires : ${tours.join(", ")} (peu, jamais enchaînés)`);
    if (tuteurs.length > 3) raisons.push(`${tuteurs.length} tuteurs : beaucoup pour un bracket 1-2`);
    return { estime, raisons, gc, gc_liste: gcListe, gc_maj: null, tuteurs, tours, mld, spellbook: sb,
      spellbook_erreur: sp.erreur || null, spellbook_a_jour: !!sp.a_jour };
  }

  // ------------------------------------------------------------------ la page d'un deck, et tout ce qu'elle demande
  async function deck(id, f, o) {
    const R = `/api/decks/${id}`, api = {};
    const entrees = MOTEUR.lire(f[`${id}/archidekt.txt`] || "");
    const noms = [...new Set(entrees.map((e) => e.nom))];
    const fiches = await o.fiches(noms), fns = await o.fonctions(noms);
    const langues = json(f[`${id}/visuels.json`], {});
    const vis = {};                                   // les impressions choisies (« (ima) 205 » dans la liste)
    for (const e of entrees) {
      const ed = e.edition;
      if (!ed || !ed.num || vis[e.nom]) continue;
      const v = await o.version(e.nom, ed, langues[`${ed.set}/${ed.num}`] || "en");
      if (v) vis[e.nom] = { version: versionCourte(v), image: v.image, petite: v.petite, art: v.art };
    }
    const cartes = [];
    for (const n of noms) {
      const fi = fiches[n] || { nom: n }, [fam, det] = fns[n] || [[], []];
      const ii = fi.imp ? await o.impressionImage(n, fi.imp.set) : null;
      cartes.push({ nom: n, info: fi, fonctions: fam, fonctions_detail: det, versions: ii ? ii.versions : 0,
        image_ed: ii && ii.edition ? { edition: ii.edition, annee: ii.annee, lang: fi.imp.lang || "en" } : null });
    }
    // Commander Spellbook : sa dernière analyse du deck (o.spellbook), faite par le relais ; l'en-tête montre le bracket
    // seulement une fois le deck analysé, comme sur le PC (app.bracket_resume)
    const sp = o.spellbook ? await o.spellbook(id, entrees) : {};
    const br = bracket(entrees, fiches, await o.gcListe(), sp);
    const page = MOTEUR.page(id, entrees, { cartes, categories: o.categories, bracket: sp.sb ? br.estime : null, bracket_raisons: sp.sb ? br.raisons : [],
      note: json(f[`${id}/deck.json`], {}).note || "", art: "", image_cmd: "" }, {}, o.budget, vis);
    page.modifie = o.modifie;
    api[R] = page;
    for (const fmt of FORMATS) api[`${R}/export?format=${fmt}`] = exporter(entrees, fmt, fiches);
    const vs = versions(id, f, entrees);
    api[`${R}/versions`] = vs;
    api[`${R}/bracket`] = br;
    const nomsCb = [...new Set(((sp.sb && sp.sb.combos) || []).flatMap((c) => c.cartes))];
    const Icb = { ...(await o.fiches(nomsCb.filter((n) => !fiches[n]))), ...fiches };
    api[`${R}/combos`] = combosDeck(sp.sb, Icb, dansDe(jeuDe(entrees).map((e) => e.nom)), null);
    const achats = json(f[`${id}/achats.json`], null);
    api[`${R}/achats`] = { possedees: achats ? achats.possedees || {} : Object.fromEntries([...compter(nomsJeu(entrees))]) };
    api[`${R}/suggestions`] = await o.suggestions(entrees, json(f[`${id}/suggestions.json`], {}).ecartees || [], presque(sp.sb));
    // comparer deux versions dans la page : chaque liste, et les fiches de toutes leurs cartes (partage.capturer)
    const listes = {};
    for (const rel of ["", ...vs.map((v) => v.fichier)]) {
      const c = compter(nomsJeu(rel ? MOTEUR.lire(f[`${id}/${rel}`]) : entrees));
      listes[rel] = { nom: libelle(id, rel, json(f[`${id}/versions/versions.json`], {})), cartes: Object.fromEntries(c) };
    }
    const nomsV = [...new Set(Object.values(listes).flatMap((x) => Object.keys(x.cartes)))].sort();
    const I = { ...(await o.fiches(nomsV.filter((n) => !fiches[n]))), ...fiches };
    for (const x of Object.values(listes)) {
      const c = Object.entries(x.cartes);
      x.total = c.reduce((s, [, k]) => s + k, 0);
      x.prix = Math.round(c.reduce((s, [n, k]) => s + ((I[n] || {}).prix || 0) * k, 0) * 100) / 100;
      x.gc = c.map(([n]) => n).filter((n) => (I[n] || {}).gc).sort();
    }
    const infos = {};
    for (const n of nomsV) { const x = I[n] || {}; infos[n] = { fr: x.fr ?? null, prix: x.prix ?? null, image: x.image || null, cout: x.cout ?? null, type: x.type ?? null, gc: !!x.gc }; }
    api["/api/noms-cartes"] = { noms: nomsV.map((n) => ((I[n] || {}).fr && I[n].fr !== n ? [n, I[n].fr] : [n])), communs: [] };
    return { deck: id, date: Date.now() / 1000, api, comparer: { listes, infos } };
  }

  // ------------------------------------------------------------------ l'accueil, le classeur, où sont mes cartes
  async function index(f, pages, o) {
    const decks = Object.keys(pages).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const classeur = MOTEUR.lireClasseur(f["Classeur/classeur.txt"] || "").cartes;
    const nomsCl = [...classeur.keys()].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
    const I = await o.fiches(nomsCl);
    const ouSont = {};
    for (const n of nomsCl) ouSont[n] = { classeur: classeur.get(n), decks: [] };
    for (const id of decks) {
      const besoin = new Map();
      for (const e of MOTEUR.lire(f[`${id}/archidekt.txt`] || "")) {
        if (MOTEUR.categorie(e) !== "Maybeboard" && !MOTEUR.BASES.has(e.nom)) besoin.set(e.nom, (besoin.get(e.nom) || 0) + e.n);
      }
      const poss = pages[id].api[`/api/decks/${id}/achats`].possedees;
      for (const [n, k] of besoin) (ouSont[n] = ouSont[n] || { classeur: 0, decks: [] }).decks.push([id, k, Math.min(k, parseInt(poss[n], 10) || 0)]);
    }
    const frDe = {};
    for (const id of decks) for (const c of pages[id].api[`/api/decks/${id}`].cartes) frDe[c.nom] = c.info.fr;
    for (const [n, v] of Object.entries(ouSont)) v.fr = (I[n] || {}).fr ?? frDe[n] ?? null;
    return {
      "/api/decks": decks.map((id) => MOTEUR.resume(pages[id].api[`/api/decks/${id}`])),
      "/api/classeur": { cartes: nomsCl.map((n) => ({ nom: n, n: classeur.get(n), info: I[n] || {} })) },
      "/api/ou-sont": ouSont,
    };
  }
  // les tags de tous les decks, les plus utilisés d'abord (decks.categories)
  function categories(f) {
    const vus = new Map();
    for (const rel of Object.keys(f)) {
      if (!/^Deck [^/]+\/archidekt\.txt$/.test(rel)) continue;
      for (const e of MOTEUR.lire(f[rel])) for (const t of e.tags) vus.set(t, (vus.get(t) || 0) + 1);
    }
    return [...vus].sort((a, b) => b[1] - a[1]).map(([t]) => t).filter((t) => t !== "Commander" && t !== "Maybeboard");
  }
  const decksDe = (f) => [...new Set(Object.keys(f).filter((r) => /^Deck [^/]+\/archidekt\.txt$/.test(r)).map((r) => r.split("/")[0]))];

  return { deck, index, categories, decksDe, exporter, versions, bracket, libelle, corpsSpellbook, analyse, combosCarte, dansDe };
})();
