// Le moteur de l'Atelier, refait pour le téléphone : lire et écrire une liste (decks.py), la modifier (decks.modifier),
// bâtir la page d'un deck (app.py › resume_deck), le classeur (classeur.py). Le téléphone modifie ainsi ses decks sans
// attendre le PC ; le PC, quand il reçoit les fichiers, recalcule le reste (suggestions, combos, bracket).
// Les fichiers écrits ici doivent être ceux qu'écrirait le PC, à l'octet près : ils passent par la même sauvegarde.
window.MOTEUR = (() => {
  // ------------------------------------------------------------------ une liste (decks.py)
  const LIGNE = /^(?:SB:\s*)?(\d+)x?\s+(.+?)\s*(?:\[([^\]]*)\])?\s*$/;
  const ETIQUETTE = /\s*(\^[^^]*\^)\s*$/;
  const EDITION = /\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([\p{L}\p{N}_★-]+))?(?:\s+\*([A-Z]+)\*)?$/u;
  const SECTION = /^(?:\/\/\s*)?(commanders?|commandants?|deck|main|mainboard|main deck|sideboard|maybeboard|considering|companions?|compagnons?)\s*(?:\(\d+\))?\s*:?$/i;
  const BASES = new Set(["Mountain", "Swamp", "Island", "Plains", "Forest", "Wastes"]);
  const PLUSIEURS = /deck can have (?:any number|up to \w+) of cards named/i;
  const somme = (l) => l.reduce((s, e) => s + e.n, 0);

  function lireLignes(lignes) {
    const entrees = [];
    let cmdComment = null, section = null;
    const reserve = [];
    let dernierBloc = [];
    for (const ligne of lignes) {
      let l = ligne.trim();
      if (!l) {
        if (entrees.length) dernierBloc = [];
        continue;
      }
      const s = l.match(SECTION);
      if (s) {
        const mot = s[1].toLowerCase();
        section = mot.startsWith("command") ? "Commander" : ["sideboard", "maybeboard", "considering"].includes(mot) ? "Maybeboard" : null;
        continue;
      }
      if (l.startsWith("//") || l.startsWith("#")) {
        const m = l.match(/commandant\s*:\s*(.+)$/i);
        if (m) cmdComment = m[1].trim();
        section = null;
        continue;
      }
      let etiquette = null;
      const et = l.match(ETIQUETTE);
      if (et) {
        etiquette = et[1];
        l = l.slice(0, et.index);
      }
      const m = l.match(LIGNE);
      if (!m) { section = null; continue; }
      const tags = (m[3] || "").split(",").map((t) => t.replace(/\{[^}]*\}/g, "").trim()).filter(Boolean);
      if (l.toUpperCase().startsWith("SB:") && !tags.includes("Commander")) tags.unshift("Commander");
      if (section && !tags.includes(section)) tags.unshift(section);
      let nom = m[2].trim(), edition = null;
      const ed = nom.match(EDITION);
      if (ed) {
        nom = nom.slice(0, ed.index).trim();
        edition = { set: ed[1].toLowerCase(), num: ed[2] || "", fini: ed[3] || "" };
      }
      const e = { n: parseInt(m[1], 10), nom, tags, etiquette, edition };
      entrees.push(e);
      if (section === "Maybeboard") reserve.push(e);
      dernierBloc.push(e);
    }
    const aCmd = () => entrees.some((e) => e.tags.includes("Commander"));
    if (reserve.length && !cmdComment && !aCmd() && somme(reserve) <= 2) {
      for (const e of reserve) e.tags = ["Commander", ...e.tags.filter((t) => t !== "Maybeboard")];
    }
    if (!cmdComment && !aCmd() && dernierBloc.length && dernierBloc.length < entrees.length && somme(dernierBloc) <= 2
        && somme(entrees) >= 50 && !dernierBloc.some((e) => e.tags.includes("Maybeboard"))) {
      for (const e of dernierBloc) e.tags.unshift("Commander");
    }
    if (cmdComment && !aCmd()) for (const e of entrees) if (e.nom === cmdComment) e.tags.unshift("Commander");
    return entrees;
  }
  const lire = (texte) => lireLignes(String(texte || "").split(/\r?\n/));

  const categorie = (e) => (e.tags.includes("Commander") ? "Commander" : e.tags.includes("Maybeboard") ? "Maybeboard" : e.tags[0] || "Sans catégorie");
  const ordonner = (entrees) => {
    const cmd = entrees.filter((e) => categorie(e) === "Commander"), maybe = entrees.filter((e) => categorie(e) === "Maybeboard");
    return [...cmd, ...entrees.filter((e) => !cmd.includes(e) && !maybe.includes(e)), ...maybe];
  };
  const texteEdition = (ed) => (!ed || !ed.set ? "" : ` (${ed.set})` + (ed.num ? ` ${ed.num}` : "") + (ed.fini ? ` *${ed.fini}*` : ""));
  function texte(entrees) {
    const lignes = [];
    let prec = null;
    for (const e of ordonner(entrees)) {
      const cat = categorie(e);
      if (prec !== null && cat !== prec) lignes.push("");
      const tags = e.tags.length ? ` [${e.tags.join(",")}]` : "";
      lignes.push(`${e.n}x ${e.nom}${texteEdition(e.edition)}${tags}` + (e.etiquette ? ` ${e.etiquette}` : ""));
      prec = cat;
    }
    return lignes.join("\n") + "\n";
  }

  // ------------------------------------------------------------------ modifier une liste (decks.modifier)
  // la carte visée : à sa place si rien n'a bougé, sinon par son nom (la liste a pu changer sur le PC entre-temps)
  function trouver(entrees, d) {
    const i = d.index;
    if (i != null && entrees[i] && entrees[i].nom === (d.nom_actuel ?? entrees[i].nom)) return i;
    if (d.nom_actuel) {
      const j = entrees.findIndex((x) => x.nom === d.nom_actuel && (categorie(x) === "Maybeboard") === !!d.etait_maybe);
      if (j >= 0) return j;
      const k = entrees.findIndex((x) => x.nom === d.nom_actuel);
      if (k >= 0) return k;
    }
    throw new Error("La carte n'est plus dans le deck.");
  }
  const versEdition = (ed) => {
    const s = String((ed && ed.set) || "").trim().toLowerCase(), num = String((ed && ed.num) || "").trim();
    return s && num ? { set: s, num, fini: "" } : null;
  };
  const placer = (entrees, e) => {
    const cat = categorie(e);
    let pos = -1;
    entrees.forEach((x, k) => { if (categorie(x) === cat) pos = k; });
    if (pos < 0) entrees.forEach((x, k) => { if (categorie(x) !== "Maybeboard") pos = k; });
    if (pos < 0) pos = entrees.length - 1;
    entrees.splice(pos + 1, 0, e);
  };
  function modifier(entrees, op, d) {
    let e = null, i = null, raison = "";
    if (op !== "ajouter") { i = trouver(entrees, d); e = entrees[i]; }
    if (op === "ajouter") {
      const nouvelle = { n: parseInt(d.n || 1, 10), nom: d.nom, tags: (d.tags || []).filter(Boolean), etiquette: null, edition: versEdition(d.edition) };
      const cat = categorie(nouvelle);
      const meme = entrees.find((x) => x.nom === d.nom && (categorie(x) === "Maybeboard") === (cat === "Maybeboard"));
      if (meme) {
        meme.n += nouvelle.n;
        raison = `+ ${d.nom} (×${meme.n})`;
      } else {
        placer(entrees, nouvelle);
        raison = `+ ${d.nom}` + (cat === "Maybeboard" ? " (Maybeboard)" : "");
      }
    } else if (op === "retirer") {
      entrees.splice(i, 1);
      raison = `− ${e.nom}`;
    } else if (op === "commandant") {
      if (e.tags.includes("Commander")) {
        e.tags = e.tags.filter((t) => t !== "Commander");
        raison = `${e.nom} n'est plus commandant`;
      } else {
        e.tags = ["Commander", ...e.tags.filter((t) => t !== "Maybeboard")];
        e.n = 1;
        raison = `${e.nom} devient commandant`;
      }
    } else if (op === "maybeboard") {
      if (e.tags.includes("Maybeboard")) {
        e.tags = e.tags.filter((t) => t !== "Maybeboard");
        entrees.splice(i, 1);
        placer(entrees, e);
        raison = `${e.nom} : Maybeboard → deck`;
      } else {
        e.tags = ["Maybeboard", ...e.tags.filter((t) => t !== "Commander")];
        raison = `${e.nom} : deck → Maybeboard`;
      }
    } else if (op === "categorie") {
      const avant = [...e.tags], garde = avant.filter((t) => t === "Commander" || t === "Maybeboard");
      e.tags = [...garde, ...(d.tags || []).filter((t) => t && !garde.includes(t))];
      raison = `${e.nom} : ${avant.join(",")} → ${e.tags.join(",")}`;
    } else if (op === "quantite") {
      e.n = Math.max(1, parseInt(d.n, 10) || 1);
      raison = `${e.nom} × ${e.n}`;
    } else {
      throw new Error("Sur le PC seulement, pour l'instant.");
    }
    return raison;
  }

  // ------------------------------------------------------------------ fiche d'une carte Scryfall (infos_cartes._fiche)
  function lienCardmarket(url) {
    if (!url) return "";
    try {
      const u = new URL(url), garde = new URLSearchParams();
      for (const k of ["idProduct", "searchString"]) if (u.searchParams.has(k)) garde.set(k, u.searchParams.get(k));
      return `${u.protocol}//${u.host}${u.pathname.replace("/en/", "/fr/")}${garde.toString() ? "?" + garde : ""}`;
    } catch (_) { return ""; }
  }
  function fiche(c, fr) {
    const faces = c.card_faces || [c];
    const img = c.image_uris || faces[0].image_uris || {};
    const pt = faces.map((f) => (f.power != null ? `${f.power}/${f.toughness ?? ""}` : f.loyalty != null ? `loyauté ${f.loyalty}` : "")).filter(Boolean);
    const dos = faces.length > 1 && faces[1].image_uris
      ? { nom: faces[1].name || "", type: faces[1].type_line || "", image: faces[1].image_uris.normal || "", petite: faces[1].image_uris.small || "" } : null;
    const f = {
      nom: c.name, cout: faces[0].mana_cost || c.mana_cost || "", mv: c.cmc || 0, type: faces[0].type_line || c.type_line || "",
      texte: c.card_faces ? faces.map((x) => x.oracle_text || "").join("\n//\n") : c.oracle_text || "",
      couleurs: c.color_identity || [], image: img.normal || "", petite: img.small || "", art: img.art_crop || "",
      gc: !!c.game_changer, prix: c.prices && c.prices.eur ? parseFloat(c.prices.eur) : null,
      prix_lien: lienCardmarket((c.purchase_uris || {}).cardmarket), prix_date: null, fr: null,
      legal: (c.legalities || {}).commander || "", produit: c.produced_mana || [], pt: pt.join(" // "),
      gatherer: (c.related_uris || {}).gatherer || "", dos, assemble: null,
    };
    if (fr) Object.assign(f, { fr: fr.printed_name || null, fr_type: fr.printed_type_line || null,
      fr_texte: fr.card_faces ? fr.card_faces.map((x) => x.printed_text || "").join("\n//\n") : fr.printed_text || null });
    return f;
  }

  // ------------------------------------------------------------------ la page d'un deck (app.py › resume_deck)
  function alertes(entrees, I) {
    const cmds = entrees.filter((e) => categorie(e) === "Commander").map((e) => e.nom);
    const ident = cmds.length && cmds.every((c) => I[c]) ? new Set(cmds.flatMap((c) => I[c].couleurs || [])) : null;
    const copies = {};
    for (const e of entrees) if (categorie(e) !== "Maybeboard") copies[e.nom] = (copies[e.nom] || 0) + e.n;
    const res = {};
    for (const c of cmds) {
      const a = [];
      if (cmds.length > 2) a.push("trop de commandants");
      if (I[c] && I[c].peut_commander === false) a.push("ne peut pas être commandant");
      if (a.length) res[c] = a;
    }
    for (const e of entrees) {
      const f = I[e.nom] || {}, cat = categorie(e);
      const a = cat === "Commander" ? [...(res[e.nom] || [])] : [];
      if (f.legal === "banned") a.push("interdite");
      else if (f.legal === "not_legal" && cat !== "Commander") a.push("non légale");
      if (ident && (f.couleurs || []).length && !f.couleurs.every((x) => ident.has(x))) a.push("hors couleurs");
      if (cat !== "Maybeboard" && (copies[e.nom] || 0) > 1 && !BASES.has(e.nom) && !(f.type || "").startsWith("Basic") && !PLUSIEURS.test(f.texte || "")) a.push("en double");
      if (a.length) res[e.nom] = a;
    }
    return { res, ident: ident ? [...ident].sort() : null };
  }

  // prec : la page d'avant (fiches, fonctions, visuels des cartes déjà là) ; infos : les fiches des nouvelles cartes
  function page(id, entrees, prec, infos, budget) {
    const avant = new Map(((prec && prec.cartes) || []).map((c) => [c.nom, c]));
    const I = {};
    for (const e of entrees) I[e.nom] = (avant.get(e.nom) || {}).info || infos[e.nom] || null;
    const jeu = entrees.filter((e) => categorie(e) !== "Maybeboard");
    const cmd = entrees.filter((e) => categorie(e) === "Commander");
    const { res: al, ident } = alertes(entrees, I);
    const horsMaybe = new Set(jeu.map((e) => e.nom));
    const prixTotal = jeu.reduce((s, e) => s + ((I[e.nom] || {}).prix || 0) * e.n, 0);
    const fCmd = cmd.length ? I[cmd[0].nom] || {} : {};
    const cartes = entrees.map((e, i) => {
      const p = avant.get(e.nom) || {};
      return { index: i, n: e.n, nom: e.nom, tags: [...e.tags], cat: categorie(e), info: I[e.nom] || {}, fonctions: p.fonctions || [],
        fonctions_detail: p.fonctions_detail || [], alertes: al[e.nom] || [], version: p.version || null,
        image_ed: p.image_ed || null, versions: p.versions || 0 };
    });
    const categories = [...new Set([...((prec && prec.categories) || []), ...entrees.flatMap((e) => e.tags)])]
      .filter((t) => t !== "Commander" && t !== "Maybeboard");
    return {
      bracket: prec ? prec.bracket : null, bracket_raisons: prec ? prec.bracket_raisons : [], id, titre: id.replace(/^Deck /, ""),
      note: prec ? prec.note || "" : "", commandant: cmd.length ? cmd[0].nom : null, total: somme(jeu),
      maybe: somme(entrees.filter((e) => categorie(e) === "Maybeboard")), prix_total: Math.round(prixTotal * 100) / 100,
      commandants: cmd.map((e) => e.nom), gc: jeu.filter((e) => (I[e.nom] || {}).gc).map((e) => e.nom),
      trop_cher: budget ? entrees.filter((e) => ((I[e.nom] || {}).prix || 0) > budget).map((e) => e.nom) : [],
      art: fCmd.art || (prec ? prec.art : "") || "", image_cmd: fCmd.image || (prec ? prec.image_cmd : "") || "",
      identite: ident, alertes: Object.fromEntries(Object.entries(al).filter(([n]) => horsMaybe.has(n))),
      modifie: Date.now() / 1000, cartes, categories,
    };
  }
  // le résumé pour l'accueil : la page sans ses cartes
  const resume = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== "cartes" && k !== "categories"));

  // ------------------------------------------------------------------ classeur (classeur.py)
  function lireClasseur(t) {
    const lignes = String(t || "").split(/\r?\n/);
    if (lignes.length && lignes[lignes.length - 1] === "") lignes.pop();
    const notes = [];
    for (const l of lignes) { if (!l.startsWith("#")) break; notes.push(l); }
    const cartes = new Map();
    for (const e of lireLignes(lignes.filter((l) => !l.trimStart().startsWith("#") && !l.trimStart().startsWith("//")))) {
      cartes.set(e.nom, (cartes.get(e.nom) || 0) + e.n);
    }
    return { notes, cartes };
  }
  function ecrireClasseur({ notes, cartes }) {
    const lignes = [...cartes].filter(([, n]) => n > 0).sort(([a], [b]) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; })
      .map(([nom, n]) => `${n} ${nom}`);
    return [...notes, ...(notes.length ? [""] : []), ...lignes].join("\n") + "\n";
  }

  return { lire, lireLignes, texte, categorie, modifier, fiche, page, resume, lireClasseur, ecrireClasseur, BASES };
})();
