// Les pages de l'Atelier faites sur le téléphone, quand il n'y a pas de PC (« Commencer ici ») : les mêmes réponses que
// celles que le PC prépare pour le téléphone (telephone.py, partage.capturer), tirées des fichiers des decks gardés sur
// le téléphone (même rangement que la sauvegarde : « Deck X/archidekt.txt », « Deck X/historique/… ») et de la base de
// cartes. telephone.js les range comme celles du PC : le reste de l'appli ne voit pas la différence.
//
// o : ce que fournit telephone.js : fiches(noms) → {nom: fiche}, fonctions(noms) → {nom: [familles, fonctions]},
// impressionImage(nom, set), version(nom, ed, langue) → impression ou null, gcListe() → noms, budget, categories.
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

  // ------------------------------------------------------------------ bracket (bracket.bracket, sans Commander Spellbook)
  function bracket(entrees, fiches, gcListe) {
    const noms = entrees.filter((e) => MOTEUR.categorie(e) !== "Maybeboard").map((e) => e.nom);
    const texte = (n) => (fiches[n] || {}).texte || "";
    const gc = noms.filter((n) => (fiches[n] || {}).gc);
    const tuteurs = noms.filter((n) => TUTEUR.test(texte(n).replace(/\([^)]*\)/g, "")));
    const tours = [...new Set(noms.filter((n) => /extra turn/i.test(texte(n))))].sort();
    const raisons = [];
    let estime;
    if (gc.length > 3 || tours.length > 2) {
      estime = 4;
      if (gc.length > 3) raisons.push(`${gc.length} Game Changers (3 au plus en bracket 3)`);
      if (tours.length > 2) raisons.push(`${tours.length} cartes de tours supplémentaires`);
    } else if (gc.length) {
      estime = 3;
      raisons.push(`${gc.length} Game Changer${gc.length > 1 ? "s" : ""} : ${gc.join(", ")}`);
    } else {
      estime = 2;
      raisons.push("aucun Game Changer, aucune combo infinie à 2 cartes : bracket 2 (ou 1 si le deck est très décontracté)");
    }
    if (tours.length && estime < 4) raisons.push(`tours supplémentaires : ${tours.join(", ")} (peu, jamais enchaînés)`);
    if (tuteurs.length > 3) raisons.push(`${tuteurs.length} tuteurs : beaucoup pour un bracket 1-2`);
    return { estime, raisons, gc, gc_liste: gcListe, gc_maj: null, tuteurs, tours, mld: [], spellbook: null,
      spellbook_erreur: "Commander Spellbook : pas encore depuis le téléphone.", spellbook_a_jour: false };
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
    const page = MOTEUR.page(id, entrees, { cartes, categories: o.categories, bracket: null, bracket_raisons: [],
      note: json(f[`${id}/deck.json`], {}).note || "", art: "", image_cmd: "" }, {}, o.budget, vis);
    page.modifie = o.modifie;
    api[R] = page;
    for (const fmt of FORMATS) api[`${R}/export?format=${fmt}`] = exporter(entrees, fmt, fiches);
    const vs = versions(id, f, entrees);
    api[`${R}/versions`] = vs;
    api[`${R}/bracket`] = bracket(entrees, fiches, await o.gcListe());
    const achats = json(f[`${id}/achats.json`], null);
    api[`${R}/achats`] = { possedees: achats ? achats.possedees || {} : Object.fromEntries([...compter(nomsJeu(entrees))]) };
    api[`${R}/suggestions`] = { cartes: [], ecartees: json(f[`${id}/suggestions.json`], {}).ecartees || [] };
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

  return { deck, index, categories, decksDe, exporter, versions, bracket, libelle };
})();
