// L'Atelier sur téléphone : pas de serveur Python ici. Les données viennent de la sauvegarde en ligne (dépôt GitHub privé
// du compte, branche « telephone »), où l'Atelier du PC dépose les pages de tous les decks (telephone.py). Chargé avant
// app.js, qui passe toutes ses demandes par TELEPHONE.api, comme une page partagée lit ses données figées.
//
// Le téléphone est relié une fois au PC : Options › Téléphone y montre un QR code, qui donne le dépôt et la clé GitHub
// (après « # » dans l'adresse : le navigateur ne l'envoie à aucun serveur). Les fichiers reçus restent sur le téléphone
// (IndexedDB) : l'appli s'ouvre aussitôt, même sans réseau, puis regarde s'il y a du nouveau.
(() => {
  const FORMAT = 1;                                   // telephone.py › FORMAT
  const GH = "https://api.github.com";
  const BRANCHE = "telephone";
  const ACCES = "telephone-acces", COMMIT = "telephone-commit", REGLAGES = "telephone-reglages";
  const DISTANT = 5 * 60 * 1000;                      // coup d'œil au dépôt toutes les cinq minutes, appli ouverte
  document.documentElement.classList.add("telephone");

  const lireLocal = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const ecrireLocal = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} };
  const lireAcces = () => { try { const a = JSON.parse(lireLocal(ACCES) || "null"); return a && a.d && a.c ? a : null; } catch (_) { return null; } };
  let acces = lireAcces();
  // le budget par carte et les réglages de la page, connus avant app.js (qui les lit au chargement)
  try { window.REGLAGES = JSON.parse(lireLocal(REGLAGES) || "{}"); } catch (_) { window.REGLAGES = {}; }

  // ------------------------------------------------------------------ fichiers gardés sur le téléphone
  const BD = (() => {
    let base;
    const ouvrir = () => base || (base = new Promise((ok, ko) => {
      const r = indexedDB.open("atelier-telephone", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("fichiers");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    }));
    const tx = async (mode, f) => {
      const db = await ouvrir();
      return new Promise((ok, ko) => {
        const t = db.transaction("fichiers", mode), r = f(t.objectStore("fichiers"));
        t.oncomplete = () => ok(r && r.result);
        t.onerror = () => ko(t.error);
      });
    };
    return {
      lire: (k) => tx("readonly", (s) => s.get(k)),
      ecrire: (k, v) => tx("readwrite", (s) => s.put(v, k)),
      effacer: (k) => tx("readwrite", (s) => s.delete(k)),
      cles: () => tx("readonly", (s) => s.getAllKeys()),
      vider: () => tx("readwrite", (s) => s.clear()),
    };
  })();
  const memoire = new Map();                          // fichiers déjà lus : chemin → données
  async function fichier(chemin) {
    if (!memoire.has(chemin)) memoire.set(chemin, BD.lire(chemin).then((x) => (x ? x.donnees : null)).catch(() => null));
    return memoire.get(chemin);
  }

  // ------------------------------------------------------------------ la sauvegarde en ligne (API de GitHub)
  async function gh(chemin, brut = false) {
    const r = await fetch(GH + chemin, { cache: "no-store", headers: {
      Authorization: "Bearer " + acces.c, "X-GitHub-Api-Version": "2022-11-28",
      Accept: brut ? "application/vnd.github.raw" : "application/vnd.github+json" } });
    if (r.status === 401) {
      oublier();
      throw Object.assign(new Error("La clé de ton Atelier n'est plus valable : relie à nouveau ce téléphone."), { statut: 401 });
    }
    if (r.status === 404) throw Object.assign(new Error("Tes decks ne sont pas encore prêts : ouvre l'Atelier sur ton PC, Options › Téléphone."), { statut: 404 });
    if (!r.ok) throw Object.assign(new Error(`GitHub ne répond pas (${r.status}).`), { statut: r.status });
    return brut ? r : r.json();
  }

  // reçoit ce qui a changé depuis la dernière fois ; true s'il y avait du nouveau
  let enCours = null;
  function synchroniser() {
    return enCours || (enCours = (async () => {
      const commit = (await gh(`/repos/${acces.d}/git/ref/heads/${BRANCHE}`)).object.sha;
      if (commit === lireLocal(COMMIT)) return false;
      const c = await gh(`/repos/${acces.d}/git/commits/${commit}`);
      const arbre = (await gh(`/repos/${acces.d}/git/trees/${c.tree.sha}?recursive=1`)).tree.filter((x) => x.type === "blob");
      const a_recevoir = [];
      for (const x of arbre) {
        const ici = await BD.lire(x.path).catch(() => null);
        if (!ici || ici.sha !== x.sha) a_recevoir.push(x);
      }
      const recevoir = async (x) => {
        const r = await gh(`/repos/${acces.d}/git/blobs/${x.sha}`, true);
        const donnees = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).json();
        if (x.path === "index.json.gz" && donnees.format !== FORMAT) {
          throw new Error(donnees.format > FORMAT ? "Mets l'appli à jour : ferme-la, puis rouvre-la." : "Mets à jour l'Atelier de ton PC.");
        }
        await BD.ecrire(x.path, { sha: x.sha, donnees });
      };
      for (let i = 0; i < a_recevoir.length; i += 4) await Promise.all(a_recevoir.slice(i, i + 4).map(recevoir));
      const garder = new Set(arbre.map((x) => x.path));
      for (const k of await BD.cles()) if (!garder.has(k) && !String(k).startsWith("@")) await BD.effacer(k);
      memoire.clear();
      fusion = null;
      const index = await fichier("index.json.gz");
      if (index) ecrireLocal(REGLAGES, JSON.stringify(index.reglages || {}));
      ecrireLocal(COMMIT, commit);
      if (index) await nettoyerSurcharges(index).catch(() => {});
      return true;
    })().finally(() => { enCours = null; }));
  }

  // ------------------------------------------------------------------ les demandes de l'interface (app.js › api)
  // même clé que les pages partagées : chemin décodé, paramètres triés
  const cleDe = (u) => {
    const p = [...u.searchParams].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return decodeURIComponent(u.pathname) + (p.length ? "?" + p.map(([k, v]) => `${k}=${v}`).join("&") : "");
  };
  const copie = (x) => (x == null ? x : structuredClone(x));
  const absente = () => Object.assign(new Error("Sur le PC seulement, pour l'instant."), { statut: 404 });

  // les noms des cartes citées de tous les decks, pour l'aperçu au survol partout
  let fusion = null;
  async function nomsCartes(index) {
    if (fusion) return fusion;
    const noms = new Map(), communs = new Set();
    for (const f of Object.values(index.decks || {})) {
      const d = await fichier(f);
      const r = d && d.api["/api/noms-cartes"];
      if (!r) continue;
      for (const n of r.noms) noms.set(n[0], n);
      for (const m of r.communs) communs.add(m);
    }
    for (const x of (index.api["/api/classeur"] || {}).cartes || []) {
      if (!noms.has(x.nom)) noms.set(x.nom, x.info && x.info.fr && x.info.fr !== x.nom ? [x.nom, x.info.fr] : [x.nom]);
    }
    return (fusion = { noms: [...noms.values()], communs: [...communs] });
  }

  async function api(chemin, opts = {}) {
    const u = new URL(chemin, "http://atelier"), k = cleDe(u), p = u.pathname;
    if ((opts.method || "GET") !== "GET") return ecrire(u, opts.body || {});
    const s = (await lesSurcharges())[k];                // modifiée ici, pas encore recalculée par le PC
    if (s) return copie(s.v);
    // ce qui n'a pas de sens ici : rien ne tourne en fond, pas de discussion avec Claude, pas de mise à jour à installer
    if (p === "/api/etat") return { maj: {} };
    if (p === "/api/corbeille") return [];               // les decks supprimés se récupèrent sur le PC
    if (p.startsWith("/api/discussion")) return { actif: false, actives: [], erreur: "", etapes: [], mode: "", outils: [], messages: [] };
    // les cartes : sur Scryfall
    if (p === "/api/chercher") return chercher(u.searchParams.get("q") || "");
    if (p === "/api/carte") return carte(u);
    if (p === "/api/impressions") return impressionsCarte(u.searchParams.get("nom") || "");
    const index = await fichier("index.json.gz");
    if (!index) throw Object.assign(new Error("Tes decks ne sont pas encore arrivés."), { statut: 503 });
    if (p === "/api/version") return { version: index.version, disponible: null };
    if (p === "/api/noms-cartes") return nomsCartes(index);
    if (k in index.api) return copie(index.api[k]);
    if (p === "/api/ou-sont") {
      const nom = u.searchParams.get("nom"), tout = index.api["/api/ou-sont"] || {};
      return { [nom]: copie(tout[nom]) || { classeur: 0, decks: [] } };
    }
    // un deck : sa page, préparée par le PC (sous son ancien nom s'il vient d'être renommé ici)
    const m = p.match(/^\/api\/decks\/([^/]+)/);
    const id = m ? decodeURIComponent(m[1]) : u.searchParams.get("deck"), sur = await lesSurcharges();
    if (id && sur["@supprime/" + id]) throw Object.assign(new Error("Ce deck a été supprimé."), { statut: 404 });
    const ancien = id && !index.decks[id] && sur["@alias/" + id] ? sur["@alias/" + id].v : id;
    if (ancien && index.decks[ancien]) {
      const d = await fichier(index.decks[ancien]);
      if (!d) throw Object.assign(new Error("Ce deck n'est pas encore arrivé."), { statut: 503 });
      const ka = ancien === id ? k : k.split(id).join(ancien);
      if (ka in d.api) return copie(d.api[ka]);
      if (p.endsWith("/comparer") && d.comparer) return comparerPartage(u.searchParams.get("a") || "", u.searchParams.get("b") || "", d.comparer);
      if (p.endsWith("/apercu")) return { modifie: d.api[`/api/decks/${ancien}`] && d.api[`/api/decks/${ancien}`].modifie };
    }
    // un deck créé ici, pas encore passé par le PC
    const cree = id && sur[`/api/decks/${id}`];
    if (cree && p.endsWith("/apercu")) return { modifie: cree.v.modifie };
    // l'aperçu d'une carte citée : dans la page d'un deck qui la cite
    if (p === "/api/apercu-carte") {
      for (const f of Object.values(index.decks)) {
        const d = await fichier(f);
        if (d && k in d.api) return copie(d.api[k]);
      }
    }
    throw absente();
  }

  // ------------------------------------------------------------------ modifier depuis le téléphone
  // Chaque modification est faite ici tout de suite (moteur.js) : la page refaite remplace celle du PC (@surcharges), et
  // l'opération attend d'être envoyée (@attente). L'envoi la rejoue sur la dernière version des fichiers de la sauvegarde
  // (branche des decks) : une modification faite entre-temps sur le PC n'est pas écrasée. Le PC reçoit les fichiers par
  // sa synchronisation, recalcule les pages (suggestions, combos, bracket) et les renvoie ; la page refaite ici s'efface
  // quand celle du PC contient la modification (index.source).
  let surcharges = null;
  async function lesSurcharges() {
    if (!surcharges) surcharges = (await BD.lire("@surcharges").catch(() => null)) || {};
    return surcharges;
  }
  async function surcharger(reponses) {
    const s = await lesSurcharges();
    for (const [k, v] of Object.entries(reponses)) s[k] = { v, c: null, quand: Date.now() };
    await BD.ecrire("@surcharges", s);
  }
  async function nettoyerSurcharges(index) {
    const s = await lesSurcharges(), commits = [...new Set(Object.values(s).map((x) => x.c).filter(Boolean))];
    let change = false;
    for (const c of commits) {
      let inclus = false;
      if (index.source) {
        const r = await gh(`/repos/${acces.d}/compare/${c}...${index.source}`).catch(() => null);
        inclus = !!r && (r.status === "identical" || r.status === "ahead");
      } else inclus = index.date * 1000 > Math.max(...Object.values(s).filter((x) => x.c === c).map((x) => x.quand)) + 600000;
      if (!inclus) continue;
      for (const [k, x] of Object.entries(s)) if (x.c === c) { delete s[k]; change = true; }
    }
    if (change) await BD.ecrire("@surcharges", s);
  }

  async function attente() { return (await BD.lire("@attente").catch(() => null)) || []; }
  let minuterie = null;
  async function enAttente(o) {
    const l = await attente();
    l.push({ ...o, quand: Date.now(), id: Math.random().toString(36).slice(2) });
    await BD.ecrire("@attente", l);
    clearTimeout(minuterie);
    minuterie = setTimeout(() => envoyer().catch(() => {}), 2500);       // une série de modifications part en une fois
  }

  // ------------------------------------------------------------------ les cartes, sur Scryfall (infos_cartes.py)
  // 2 requêtes par seconde au plus, l'une après l'autre ; une réponse déjà reçue n'est pas redemandée. garde : appelée
  // juste avant d'envoyer, elle abandonne une requête devenue inutile (on a tapé la suite du nom).
  const SCRYFALL = "https://api.scryfall.com";
  let fileScryfall = Promise.resolve(), dernierScryfall = 0;
  const deja = new Map();
  function scryfall(url, corps, garde = null) {
    if (!corps && deja.has(url)) return Promise.resolve(copie(deja.get(url)));
    const tour = fileScryfall.then(async () => {
      if (garde) garde();
      const pause = dernierScryfall + 500 - Date.now();
      if (pause > 0) await new Promise((r) => setTimeout(r, pause));
      if (garde) garde();
      dernierScryfall = Date.now();
      const r = await fetch(url, corps ? { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(corps) }
        : { headers: { Accept: "application/json" } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("Scryfall ne répond pas : vérifie la connexion.");
      const j = await r.json();
      if (!corps) { if (deja.size > 300) deja.clear(); deja.set(url, j); }
      return copie(j);
    });
    fileScryfall = tour.catch(() => {});
    return tour;
  }
  const BASES_FR = { Mountain: "Montagne", Swamp: "Marais", Island: "Île", Plains: "Plaine", Forest: "Forêt", Wastes: "Désolation" };
  const cle = (nom) => String(nom).split(/ \/{1,2} /)[0];
  const simple = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const aujourdhui = () => { const t = new Date(); return `${t.getFullYear()}-${date2(t.getMonth() + 1)}-${date2(t.getDate())}`; };
  // les impressions dont le prix ne compte pas (prix.py › prix_fiable), et celles qu'on ne montre pas (_papier)
  const FIABLE = "-set:sum -border:gold -is:oversized -is:digital -st:memorabilia -st:token -st:minigame";
  const papier = (c) => !(c.digital || c.oversized || ["missing", "placeholder"].includes(c.image_status) || ["memorabilia", "token", "minigame"].includes(c.set_type));

  // une recherche pour plusieurs cartes à la fois : (!"A" or !"B" …) + extra, toutes les pages (_recherche_groupee)
  async function rechercheGroupee(noms, extra, params, traite, garde, taille = 20) {
    for (let i = 0; i < noms.length; i += taille) {
      const q = "(" + noms.slice(i, i + taille).map((n) => `!"${cle(n).replace(/"/g, "")}"`).join(" or ") + ") " + extra;
      let r = await scryfall(`${SCRYFALL}/cards/search?${new URLSearchParams({ q, ...params })}`, null, garde);
      while (r) {
        for (const c of r.data || []) traite(c);
        r = r.has_more && r.next_page ? await scryfall(r.next_page, null, garde) : null;
      }
    }
  }

  // la carte anglaise de chaque nom (tapé, collé : « sol ring »), dans son impression la moins chère, qui donne le prix
  // du jour et l'image par défaut, comme sur le PC ; sinon par son nom, puis en devinant les fautes de frappe
  const vues = new Map();                             // nom → carte Scryfall (null : introuvable)
  const prixDe = (c) => {
    const p = c.prices || {}, foil = p.eur == null && p.eur_foil != null;
    return { prix: p.eur != null ? parseFloat(p.eur) : foil ? parseFloat(p.eur_foil) : null, prix_edition: (c.set_name || "") + (foil ? " (foil)" : ""),
      prix_lien: MOTEUR.lienCardmarket((c.purchase_uris || {}).cardmarket) };
  };
  async function cartes(noms, garde = null) {
    const manque = [...new Set(noms)].filter((n) => n && !vues.has(n));
    const parCle = new Map();
    for (const n of manque) parCle.set(cle(n).toLowerCase(), [...(parCle.get(cle(n).toLowerCase()) || []), n]);
    if (manque.length) {
      await rechercheGroupee(manque, FIABLE + " prefer:eur-low", { unique: "cards" }, (c) => {
        for (const n of parCle.get(cle(c.name).toLowerCase()) || []) if (!vues.has(n)) vues.set(n, c);
      }, garde);
    }
    const reste = manque.filter((n) => !vues.has(n));
    for (let i = 0; i < reste.length; i += 75) {
      const bloc = reste.slice(i, i + 75);
      const r = await scryfall(`${SCRYFALL}/cards/collection`, { identifiers: bloc.map((n) => ({ name: cle(n) })) }, garde);
      const trouvees = new Map(((r && r.data) || []).map((c) => [cle(c.name).toLowerCase(), c]));
      for (const n of bloc) {
        const c = trouvees.get(cle(n).toLowerCase()) || await scryfall(`${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(n)}`, null, garde).catch((e) => { if (e.abandon) throw e; return null; });
        vues.set(n, c || null);
      }
    }
    return new Map(noms.map((n) => [n, vues.get(n) || null]));
  }

  // nom, type et texte imprimés sur l'édition française la plus récente qui les a (infos_cartes.noms_francais)
  const fr = new Map();                               // nom anglais → {fr, fr_type, fr_texte} ; fr "" : pas de version française
  async function francais(noms, garde = null) {
    const manque = [...new Set(noms)].filter((n) => n && !fr.has(n) && !BASES_FR[n]);
    if (!manque.length) return;
    const parCle = new Map(manque.map((n) => [cle(n), n])), lus = {};
    await rechercheGroupee(manque, "lang:fr", { unique: "prints", order: "released", dir: "desc", include_extras: "false" }, (c) => {
      const n = parCle.get(cle(c.name));
      if (!n) return;
      const faces = c.card_faces || [];
      let nom = c.printed_name || (faces[0] && faces[0].printed_name ? faces.map((f) => f.printed_name || "").join(" // ") : "");
      if (!nom) return;
      let texte, typ;
      if (faces.length && !c.printed_text) {
        texte = faces.map((f) => f.printed_text || "").join("\n//\n").replace(/^[\n/]+|[\n/]+$/g, "");
        typ = faces[0].printed_type_line || "";
      } else [texte, typ] = [c.printed_text || "", c.printed_type_line || ""];
      const anglais = vues.get(n) ? MOTEUR.fiche(vues.get(n)) : { nom: n, texte: "" };
      if (simple(nom) === simple(n) || simple(nom) === simple(anglais.nom)) nom = "";
      if (simple(texte) === simple(anglais.texte)) texte = "";
      const [n0, t0, x0] = lus[n] || ["", "", ""];
      lus[n] = [n0 || nom, t0 || typ, x0 || texte];
    }, garde, 15);
    for (const n of manque) fr.set(n, lus[n] ? { fr: lus[n][0], fr_type: lus[n][1], fr_texte: lus[n][2] } : { fr: "", fr_type: "", fr_texte: "" });
  }

  // la fiche d'une carte, comme celle du PC (infos_cartes._fiche, prix du jour, noms français)
  function ficheDe(c) {
    const f = MOTEUR.fiche(c);
    Object.assign(f, prixDe(c), { prix_date: aujourdhui() }, fr.get(c.name) || {});
    if (BASES_FR[c.name]) f.fr = BASES_FR[c.name];
    return f;
  }
  // les fiches de cartes tapées ou collées : {nom tapé: fiche (son nom : celui de Scryfall)} ; absente si introuvable
  async function fiches(noms, garde = null) {
    const m = await cartes(noms, garde);
    await francais([...m.values()].filter(Boolean).map((c) => c.name), garde);
    const res = {};
    for (const [n, c] of m) if (c) res[n] = ficheDe(c);
    return res;
  }
  // une carte d'un deck : déjà vue dans un deck ou le classeur, sinon demandée à Scryfall (gardée ici)
  async function ficheCarte(nom) {
    const cache = (await BD.lire("@cartes").catch(() => null)) || {};
    if (cache[nom]) return cache[nom];
    const index = await fichier("index.json.gz");
    const cl = (((index && index.api["/api/classeur"]) || {}).cartes || []).find((x) => x.nom === nom);
    if (cl && cl.info && cl.info.image) return cl.info;
    for (const [id, f] of Object.entries((index && index.decks) || {})) {
      const d = await fichier(f), c = d && ((d.api[`/api/decks/${id}`] || {}).cartes || []).find((x) => x.nom === nom);
      if (c && c.info && c.info.image) return c.info;
    }
    const f = (await fiches([nom]))[nom] || { nom };
    if (f.image) {
      cache[nom] = f;
      await BD.ecrire("@cartes", cache);
    }
    return f;
  }

  // la recherche pour ajouter une carte (infos_cartes.chercher) : chaque nouvelle recherche abandonne la précédente
  let tourRecherche = 0;
  const gardeDe = (tour) => () => { if (tour !== tourRecherche) throw Object.assign(new Error("abandonnée"), { abandon: true }); };
  async function chercher(texte) {
    const garde = gardeDe(++tourRecherche);
    texte = texte.trim();
    if (texte.length < 2) return [];
    let res = [];
    const noms = new Set();
    const ac = await scryfall(`${SCRYFALL}/cards/autocomplete?q=${encodeURIComponent(texte)}`, null, garde);
    for (const n of ((ac && ac.data) || []).slice(0, 12)) {
      const faces = n.split(" // ");
      if ((faces.length > 1 && new Set(faces).size === 1) || noms.has(n)) continue;      // « Sol Ring // Sol Ring » : illustration
      noms.add(n);
      res.push({ nom: n, fr: null });
    }
    const s = await scryfall(`${SCRYFALL}/cards/search?${new URLSearchParams({ q: texte + " lang:fr", unique: "cards" })}`, null, garde);
    for (const c of ((s && s.data) || []).slice(0, 12)) {
      if (noms.has(c.name)) continue;
      noms.add(c.name);
      res.push({ nom: c.name, fr: c.printed_name || null });
    }
    const q = simple(texte);
    const rang = (x) => { const v = [simple(x.nom), simple(cle(x.nom)), simple(x.fr)]; return v.includes(q) ? 0 : v.some((n) => n.startsWith(q)) ? 1 : 2; };
    res = res.map((x, i) => [rang(x), i, x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]).slice(0, 20);
    const m = await cartes(res.map((x) => x.nom), garde);
    return res.filter((x) => m.get(x.nom)).map((x) => {
      const c = m.get(x.nom), f = MOTEUR.fiche(c), p = prixDe(c), t = fr.get(c.name);
      return { nom: c.name, fr: x.fr || (t ? t.fr || "" : BASES_FR[c.name] || null), cout: f.cout, type: f.type, image: f.image, gc: f.gc,
        prix: p.prix, prix_lien: p.prix_lien, legal: f.legal, couleurs: f.couleurs };
    });
  }
  // le prix du jour et le nom français des résultats d'une recherche (infos_cartes.prix_et_noms)
  async function prixEtNoms(noms) {
    const garde = gardeDe(tourRecherche);
    noms = noms.filter(Boolean).slice(0, 25);
    const m = await cartes(noms, garde);
    await francais([...m.values()].filter(Boolean).map((c) => c.name), garde);
    const res = {};
    for (const n of noms) {
      const c = m.get(n), p = c ? prixDe(c) : {};
      res[n] = { prix: p.prix ?? null, prix_lien: p.prix_lien || "", fr: c ? (fr.get(c.name) || {}).fr || BASES_FR[c.name] || null : null };
    }
    return res;
  }

  // les impressions d'une carte, pour choisir son visuel (infos_cartes.impressions_carte)
  const impressionsVues = new Map();                  // « ima/205/fr » → impression
  const impression = (c) => {
    const faces = c.card_faces || [c], img = c.image_uris || faces[0].image_uris || {}, p = c.prices || {};
    return { set: c.set, num: c.collector_number, lang: c.lang || "en", nom: c.name, edition: c.set_name || "", annee: (c.released_at || "").slice(0, 4),
      image: img.normal || "", petite: img.small || "", art: img.art_crop || "",
      prix: p.eur ? parseFloat(p.eur) : null, prix_foil: p.eur_foil ? parseFloat(p.eur_foil) : null };
  };
  const versionCourte = (v) => (v ? { set: v.set, num: v.num, lang: v.lang, edition: v.edition, annee: v.annee } : null);
  async function impressionsCarte(nom) {
    const res = [];
    let r = await scryfall(`${SCRYFALL}/cards/search?${new URLSearchParams({ q: `!"${cle(nom)}" (lang:en or lang:fr) game:paper`, unique: "prints", order: "released", dir: "desc" })}`);
    while (r) {
      for (const c of r.data || []) if (cle(c.name).toLowerCase() === cle(nom).toLowerCase() && papier(c)) res.push(impression(c));
      r = r.has_more && r.next_page ? await scryfall(r.next_page) : null;
    }
    const defaut = ((await ficheCarte(nom).catch(() => ({}))).image || "").split("?")[0];
    for (const p of res) {
      impressionsVues.set(`${p.set}/${p.num}/${p.lang}`, p);
      p.defaut = !!defaut && p.image.split("?")[0] === defaut;
    }
    return res;
  }
  async function uneImpression(set, num, lang = "en") {
    const k = `${String(set).toLowerCase()}/${num}/${lang || "en"}`;
    if (impressionsVues.has(k)) return impressionsVues.get(k);
    const c = await scryfall(`${SCRYFALL}/cards/${encodeURIComponent(String(set).toLowerCase())}/${encodeURIComponent(num)}${lang && lang !== "en" ? "/" + encodeURIComponent(lang) : ""}`);
    if (!c) return null;
    impressionsVues.set(k, impression(c));
    return impressionsVues.get(k);
  }
  // le visuel d'une carte du deck : l'impression choisie, ou l'image par défaut (ed vide)
  async function visuel(nom, ed) {
    if (ed && ed.set && ed.num) {
      const v = await uneImpression(ed.set, ed.num, ed.lang);
      if (v) return { version: versionCourte(v), image: v.image, petite: v.petite, art: v.art };
    }
    const f = (await fiches([nom]).catch(() => ({})))[nom] || {};
    return { version: null, image: f.image || "", petite: f.petite || "", art: f.art || "" };
  }

  // la fiche d'une carte à ajouter (app.py › api_carte) ; set, num, lang : l'impression choisie avant de l'ajouter
  async function carte(u) {
    const nom = u.searchParams.get("nom");
    const f = { ...(await ficheCarte(nom)) };
    const s = u.searchParams.get("set"), num = u.searchParams.get("num");
    const v = s && num ? await uneImpression(s, num, u.searchParams.get("lang") || "en").catch(() => null) : null;
    if (v && v.image) Object.assign(f, { image: v.image, petite: v.petite, art: v.art || f.art });
    return { ...f, version: versionCourte(v), gc: !!f.gc, peut_commander: f.peut_commander ?? null, partenaire: f.partenaire ?? null,
      trop_cher: budget() > 0 && (f.prix || 0) > budget(), image_ed: null, versions: 0 };
  }

  const budget = () => Number((window.REGLAGES || {}).budget) || 0;
  async function ecrire(u, b) {
    const p = u.pathname, m = p.match(/^\/api\/decks\/([^/]+)\/(modifier|achats|suggestions\/ecarter)$/);
    if (p === "/api/prix") return prixEtNoms(b.noms || []);
    if (!(await fichier("index.json.gz"))) throw Object.assign(new Error("Tes decks ne sont pas encore arrivés."), { statut: 503 });
    if (p === "/api/decks") return creerDeck(b);
    const r = p.match(/^\/api\/decks\/([^/]+)\/(renommer|supprimer)$/);
    if (r && r[2] === "renommer") return renommerDeck(decodeURIComponent(r[1]), b.nom);
    if (r) return supprimerDeck(decodeURIComponent(r[1]));
    if (m && m[2] === "modifier") return modifierDeck(decodeURIComponent(m[1]), b);
    if (m && m[2] === "achats") return marquerAchats(decodeURIComponent(m[1]), b.possedees || {});
    if (m) return ecarterSuggestion(decodeURIComponent(m[1]), b.nom, b.ecarter !== false);
    if (p === "/api/classeur" && (b.liste != null || b.nom != null)) return modifierClasseur(b);
    throw Object.assign(new Error("Sur le PC seulement, pour l'instant."), { statut: 405 });
  }

  async function modifierDeck(id, b) {
    const prec = await api(`/api/decks/${id}`);
    const entrees = MOTEUR.lire(await api(`/api/decks/${id}/export?format=archidekt`));
    const d = { ...b };
    delete d.op;
    if (d.nom_actuel != null && prec.cartes[d.index]) d.etait_maybe = prec.cartes[d.index].cat === "Maybeboard";
    const tags = d.tags || [], maybe = !tags.includes("Commander") && tags.includes("Maybeboard");
    const nouvelle = b.op === "ajouter" && !entrees.some((x) => x.nom === d.nom && (MOTEUR.categorie(x) === "Maybeboard") === maybe);
    const raison = MOTEUR.modifier(entrees, b.op, d);
    // le visuel qui change : une autre version de la carte, ou une carte ajoutée dans la version choisie
    const vis = {}, ed = d.edition && d.edition.set ? d.edition : null;
    if (b.op === "edition") vis[d.nom_actuel] = await visuel(d.nom_actuel, ed);
    else if (ed && (nouvelle || b.op === "remplacer")) vis[d.nom] = await visuel(d.nom, ed);
    const infos = {};
    for (const e of entrees) if (!prec.cartes.some((c) => c.nom === e.nom)) infos[e.nom] = await ficheCarte(e.nom);
    const page = MOTEUR.page(id, entrees, prec, infos, budget(), vis);
    const liste = (await api("/api/decks")).map((x) => (x.id === id ? MOTEUR.resume(page) : x));
    await surcharger({ [`/api/decks/${id}`]: page, [`/api/decks/${id}/export?format=archidekt`]: MOTEUR.texte(entrees), "/api/decks": liste });
    await enAttente({ f: "deck", deck: id, op: b.op, d, raison });
    return copie(page);
  }

  // un nouveau deck (decks.creer, app.py › _nouveau_deck) : son dossier part avec le prochain envoi
  const ACHATS_VIDES = JSON.stringify({ possedees: {} }, null, 1);         // nouveau deck : tout est à acheter
  async function creerDeck(b) {
    const id = MOTEUR.dossier(b.nom);
    const decks = await api("/api/decks");
    if (decks.some((x) => x.id.toLowerCase() === id.toLowerCase())) throw new Error(`le deck « ${id} » existe déjà`);
    let entrees = String(b.liste || "").trim() ? MOTEUR.lire(b.liste) : [];
    const cmd = String(b.commandant || "").trim();
    if (cmd) {
      const e = entrees.find((x) => x.nom.toLowerCase() === cmd.toLowerCase());
      if (e) Object.assign(e, { tags: ["Commander", ...e.tags.filter((t) => t !== "Commander" && t !== "Maybeboard")], n: 1 });
      else entrees.unshift({ n: 1, nom: cmd, tags: ["Commander"], etiquette: null, edition: null });
    }
    // noms corrigés (« sol ring » → « Sol Ring », fautes de frappe), même carte sur deux lignes : une seule ligne
    const trouvees = entrees.length ? await fiches([...new Set(entrees.map((e) => e.nom))]) : {};
    const infos = {}, lignes = new Map();
    for (const e of entrees) {
      const f = trouvees[e.nom];
      if (f) { e.nom = f.nom; infos[f.nom] = f; }
    }
    entrees = entrees.filter((e) => {
      const k = e.nom + "|" + (MOTEUR.categorie(e) === "Maybeboard");
      if (!lignes.has(k)) { lignes.set(k, e); return true; }
      lignes.get(k).n += e.n;
      return false;
    });
    const texte = entrees.length ? MOTEUR.texte(entrees) : "";
    const autre = decks[0] ? await api(`/api/decks/${decks[0].id}`).catch(() => null) : null;      // les tags des autres decks
    const page = MOTEUR.page(id, MOTEUR.lire(texte), { cartes: [], categories: (autre && autre.categories) || [], bracket: null,
      bracket_raisons: [], note: "", art: "", image_cmd: "" }, infos, budget());
    const liste = [...decks, MOTEUR.resume(page)].sort(parId);
    delete (await lesSurcharges())["@supprime/" + id];
    await surcharger({ [`/api/decks/${id}`]: page, [`/api/decks/${id}/export?format=archidekt`]: texte,
      [`/api/decks/${id}/achats`]: { possedees: {} }, "/api/decks": liste });
    await enAttente({ f: "creer", deck: id, texte });
    return { id };
  }
  const parId = (x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);          // decks.dossiers() : sorted

  // renommer, supprimer : les pages déjà refaites ici suivent le deck (ou partent avec lui) ; celles du PC restent
  // lisibles sous l'ancien nom (@alias) jusqu'à ce que le PC les refasse
  function retirerPages(s, id) {
    const pages = {}, prefixe = `/api/decks/${id}`;
    for (const k of Object.keys(s)) {
      if (k === prefixe || k.startsWith(prefixe + "/") || k.startsWith(prefixe + "?")) { pages[k.slice(prefixe.length)] = s[k]; delete s[k]; }
    }
    return pages;
  }
  async function renommerDeck(id, nom) {
    const nouveau = MOTEUR.dossier(nom);
    if (nouveau === id) return { id };
    const decks = await api("/api/decks");
    if (nouveau.toLowerCase() !== id.toLowerCase() && decks.some((x) => x.id.toLowerCase() === nouveau.toLowerCase())) {
      throw new Error(`le deck « ${nouveau} » existe déjà`);
    }
    const page = await api(`/api/decks/${id}`), texte = await api(`/api/decks/${id}/export?format=archidekt`);
    const s = await lesSurcharges(), quand = Date.now(), titre = nouveau.replace(/^Deck /, "");
    for (const [k, x] of Object.entries(retirerPages(s, id))) s[`/api/decks/${nouveau}` + k] = x;
    s["@alias/" + nouveau] = { v: (s["@alias/" + id] || {}).v || id, c: null, quand };
    delete s["@alias/" + id];
    delete s["@supprime/" + nouveau];
    s[`/api/decks/${nouveau}`] = { v: { ...page, id: nouveau, titre }, c: null, quand };
    s[`/api/decks/${nouveau}/export?format=archidekt`] = { v: texte, c: null, quand };
    s["/api/decks"] = { v: decks.map((x) => (x.id === id ? { ...x, id: nouveau, titre } : x)).sort(parId), c: null, quand };
    await BD.ecrire("@surcharges", s);
    await enAttente({ f: "renommer", deck: id, vers: nouveau });
    return { id: nouveau };
  }
  async function supprimerDeck(id) {
    const decks = await api("/api/decks");
    const s = await lesSurcharges(), quand = Date.now();
    retirerPages(s, id);
    delete s["@alias/" + id];
    s["@supprime/" + id] = { v: 1, c: null, quand };
    s["/api/decks"] = { v: decks.filter((x) => x.id !== id), c: null, quand };
    await BD.ecrire("@surcharges", s);
    await enAttente({ f: "supprimer", deck: id });
    return { corbeille: null };
  }

  async function marquerAchats(id, changements) {
    const poss = { ...((await api(`/api/decks/${id}/achats`)).possedees || {}) };
    for (const [nom, n] of Object.entries(changements)) poss[String(nom)] = Math.max(0, parseInt(n, 10) || 0);
    await surcharger({ [`/api/decks/${id}/achats`]: { possedees: poss } });
    await enAttente({ f: "achats", deck: id, d: changements });
    return { possedees: poss };
  }

  async function ecarterSuggestion(id, nom, oui) {
    const sg = await api(`/api/decks/${id}/suggestions`).catch(() => null);
    const liste = [...new Set([...((sg && sg.ecartees) || []).filter((n) => n !== nom), ...(oui ? [nom] : [])])].sort();
    if (sg) await surcharger({ [`/api/decks/${id}/suggestions`]: { ...sg, ecartees: liste } });
    await enAttente({ f: "ecarter", deck: id, d: { nom, oui } });
    return { ecartees: liste };
  }

  async function modifierClasseur(b) {
    const cartes = new Map(((await api("/api/classeur")).cartes || []).map((x) => [x.nom, x]));
    const inconnues = [];
    let op;
    if (b.liste != null) {                                  // une liste collée (classeur.lire_liste)
      const lignes = String(b.liste).split(/\r?\n/).filter((l) => l.trim() && !/^\s*(#|\/\/)/.test(l))
        .map((l) => (/^\s*(SB:\s*)?\d/.test(l) ? l : "1 " + l.trim()));
      const lues = new Map();
      for (const e of MOTEUR.lireLignes(lignes)) lues.set(e.nom, (lues.get(e.nom) || 0) + e.n);
      const trouves = await fiches([...lues.keys()]);
      const ajouts = {};
      for (const [lu, n] of lues) {
        const f = trouves[lu];
        if (!f) { inconnues.push(lu); continue; }
        ajouts[f.nom] = (ajouts[f.nom] || 0) + n;
        if (cartes.has(f.nom)) cartes.get(f.nom).n += n;
        else cartes.set(f.nom, { nom: f.nom, n, info: f });
      }
      op = { ajouter: ajouts };
    } else {
      const n = Math.max(0, parseInt(b.n, 10) || 0);
      if (!n) cartes.delete(b.nom);
      else if (cartes.has(b.nom)) cartes.get(b.nom).n = n;
      else cartes.set(b.nom, { nom: b.nom, n, info: await ficheCarte(b.nom) });
      op = { fixer: { [b.nom]: n } };
    }
    const liste = [...cartes.values()].sort((x, y) => (x.nom.toLowerCase() < y.nom.toLowerCase() ? -1 : 1));
    await surcharger({ "/api/classeur": { cartes: liste } });
    await enAttente({ f: "classeur", d: op });
    return { cartes: copie(liste), inconnues };
  }

  // l'envoi : les opérations en attente, rejouées sur les fichiers de la sauvegarde, en un commit
  const date2 = (n) => String(n).padStart(2, "0");
  const horodatage = (t = new Date()) => `${t.getFullYear()}-${date2(t.getMonth() + 1)}-${date2(t.getDate())}_${date2(t.getHours())}${date2(t.getMinutes())}${date2(t.getSeconds())}`;
  const chemin = (rel) => rel.split("/").map(encodeURIComponent).join("/");
  async function ghEcrire(methode, url, corps) {
    const r = await fetch(GH + url, { method: methode, headers: { Authorization: "Bearer " + acces.c, "X-GitHub-Api-Version": "2022-11-28",
      Accept: "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    if (!r.ok) throw Object.assign(new Error(`GitHub refuse l'envoi (${r.status}).`), { statut: r.status });
    return r.json();
  }
  async function contenu(rel, ref) {
    const r = await fetch(`${GH}/repos/${acces.d}/contents/${chemin(rel)}?ref=${ref}`, { cache: "no-store", headers: {
      Authorization: "Bearer " + acces.c, "X-GitHub-Api-Version": "2022-11-28", Accept: "application/vnd.github.raw" } });
    if (r.status === 404) return null;
    if (!r.ok) throw Object.assign(new Error(`GitHub ne répond pas (${r.status}).`), { statut: r.status });
    return r.text();
  }
  let envoi = null;
  function envoyer() {
    return envoi || (envoi = (async () => {
      const ops = await attente();
      if (!ops.length || !acces) return false;
      const index = await fichier("index.json.gz");
      const branche = (index && index.branche) || "main";
      for (let essai = 0; essai < 3; essai++) {
        const tete = (await gh(`/repos/${acces.d}/git/ref/heads/${branche}`)).object.sha;
        const arbre = (await gh(`/repos/${acces.d}/git/commits/${tete}`)).tree.sha;
        const originaux = new Map(), fichiers = new Map();
        // un deck renommé ou supprimé dans cet envoi : tout son dossier part (effaces), et va sous le nouveau nom
        // (origine : nouveau dossier → dossier de la sauvegarde où sont ses fichiers)
        const origine = new Map(), effaces = new Set();
        const lire = async (rel) => {
          if (!originaux.has(rel)) {
            const dossier = rel.split("/")[0], src = origine.has(dossier) ? origine.get(dossier) : effaces.has(dossier) ? null : dossier;
            const t = src ? await contenu(src + rel.slice(dossier.length), tete) : null;
            originaux.set(rel, t);
            fichiers.set(rel, t);
          }
          return fichiers.get(rel);
        };
        const avant = new Map(), raisons = new Map(), nouveaux = [];
        const sous = (rel, dossier) => rel.startsWith(dossier + "/");
        const deplacer = (a, n) => {                        // ce qui est déjà lu ou refait dans cet envoi suit le deck
          for (const m of [originaux, fichiers]) for (const [rel, t] of [...m]) if (sous(rel, a)) { m.delete(rel); if (n) m.set(n + rel.slice(a.length), t); }
          for (const m of [avant, raisons]) if (m.has(a)) { if (n) m.set(n, m.get(a)); m.delete(a); }
        };
        for (const o of ops) {
          if (o.f === "creer") {
            if ((await lire(`${o.deck}/archidekt.txt`)) != null) continue;      // un deck de ce nom vient d'arriver du PC
            fichiers.set(`${o.deck}/archidekt.txt`, o.texte);
            if ((await lire(`${o.deck}/achats.json`)) == null) fichiers.set(`${o.deck}/achats.json`, ACHATS_VIDES);
            nouveaux.push("nouveau deck " + o.deck.replace(/^Deck /, ""));
          } else if (o.f === "renommer" || o.f === "supprimer") {
            const src = origine.has(o.deck) ? origine.get(o.deck) : o.deck;
            origine.delete(o.deck);
            effaces.add(src);
            deplacer(o.deck, o.vers);
            if (o.vers) origine.set(o.vers, src);
            nouveaux.push(o.vers ? `${o.deck.replace(/^Deck /, "")} renommé ${o.vers.replace(/^Deck /, "")}` : `${o.deck.replace(/^Deck /, "")} supprimé`);
          } else if (o.f === "deck" || o.f === "achats" || o.f === "ecarter") {
            const liste = await lire(`${o.deck}/archidekt.txt`);
            if (liste == null) continue;                    // deck supprimé sur le PC entre-temps
            if (o.f === "deck") {
              const e = MOTEUR.lire(liste);
              // une impression française choisie : notée dans visuels.json, comme sur le PC
              const vf = `${o.deck}/visuels.json`, L = o.d.edition && o.d.edition.set ? JSON.parse((await lire(vf)) || "{}") : null;
              const L0 = JSON.stringify(L);
              try { MOTEUR.modifier(e, o.op, o.d, L); } catch (_) { continue; }
              if (L && JSON.stringify(L) !== L0) fichiers.set(vf, JSON.stringify(L, null, 1));
              if (!avant.has(o.deck)) avant.set(o.deck, liste);
              fichiers.set(`${o.deck}/archidekt.txt`, MOTEUR.texte(e));
              raisons.set(o.deck, [...(raisons.get(o.deck) || []), o.raison]);
            } else if (o.f === "achats") {
              const t = await lire(`${o.deck}/achats.json`);
              let poss = t ? JSON.parse(t).possedees || {} : null;
              if (!poss) {                                  // jamais noté : le deck est déjà monté (decks.possedees)
                poss = {};
                for (const e of MOTEUR.lire(liste)) if (MOTEUR.categorie(e) !== "Maybeboard") poss[e.nom] = (poss[e.nom] || 0) + e.n;
              }
              for (const [nom, n] of Object.entries(o.d)) poss[nom] = Math.max(0, parseInt(n, 10) || 0);
              fichiers.set(`${o.deck}/achats.json`, JSON.stringify({ possedees: poss }, null, 1));
            } else {
              const t = await lire(`${o.deck}/suggestions.json`);
              const l = ((t && JSON.parse(t).ecartees) || []).filter((n) => n !== o.d.nom);
              if (o.d.oui) l.push(o.d.nom);
              fichiers.set(`${o.deck}/suggestions.json`, JSON.stringify({ ecartees: l.sort() }, null, 1));
            }
          } else if (o.f === "classeur") {
            const c = MOTEUR.lireClasseur((await lire("Classeur/classeur.txt")) || "");
            for (const [nom, n] of Object.entries(o.d.ajouter || {})) c.cartes.set(nom, (c.cartes.get(nom) || 0) + n);
            for (const [nom, n] of Object.entries(o.d.fixer || {})) { if (n > 0) c.cartes.set(nom, n); else c.cartes.delete(nom); }
            fichiers.set("Classeur/classeur.txt", MOTEUR.ecrireClasseur(c));
          }
        }
        // l'historique du deck, comme sur le PC (decks.instantane) : la liste d'avant, et ce qui a changé
        const quand = horodatage();
        for (const [deck, t] of avant) {
          if (fichiers.get(`${deck}/archidekt.txt`) === t) continue;
          fichiers.set(`${deck}/historique/${quand}.txt`, t);
          const j = JSON.parse((await lire(`${deck}/historique/journal.json`)) || "{}");
          j[`${quand}.txt`] = "Téléphone : " + raisons.get(deck).join(" · ");
          fichiers.set(`${deck}/historique/journal.json`, JSON.stringify(j, null, 1));
        }
        // les dossiers renommés ou supprimés : chaque fichier effacé, ou repris tel quel sous le nouveau nom (sans le télécharger)
        const entrees = new Map();
        if (effaces.size) {
          const tout = await gh(`/repos/${acces.d}/git/trees/${arbre}?recursive=1`);
          if (tout.truncated) throw new Error("La sauvegarde est trop grande pour renommer un deck d'ici : fais-le sur le PC.");
          const blobs = (tout.tree || []).filter((x) => x.type === "blob");
          for (const x of blobs) if (effaces.has(x.path.split("/")[0])) entrees.set(x.path, { path: x.path, mode: x.mode, type: "blob", sha: null });
          for (const [n, a] of origine) {
            for (const x of blobs) if (sous(x.path, a)) entrees.set(n + x.path.slice(a.length), { path: n + x.path.slice(a.length), mode: x.mode, type: "blob", sha: x.sha });
          }
        }
        for (const [rel, t] of fichiers) {
          if (t == null || (t === originaux.get(rel) && !entrees.has(rel))) continue;
          if (t === originaux.get(rel) && entrees.get(rel).sha) continue;                 // déplacé tel quel
          const b = await ghEcrire("POST", `/repos/${acces.d}/git/blobs`, { content: t, encoding: "utf-8" });
          entrees.set(rel, { path: rel, mode: "100644", type: "blob", sha: b.sha });
        }
        let commit = null;
        if (entrees.size) {
          const nouvel = await ghEcrire("POST", `/repos/${acces.d}/git/trees`, { base_tree: arbre, tree: [...entrees.values()] });
          const resume = [...nouveaux, ...[...raisons.values()].flat()].slice(0, 3).join(" · ") || "achats, classeur";
          commit = (await ghEcrire("POST", `/repos/${acces.d}/git/commits`, { message: "Téléphone : " + resume, tree: nouvel.sha, parents: [tete] })).sha;
          try {
            await ghEcrire("PATCH", `/repos/${acces.d}/git/refs/heads/${branche}`, { sha: commit });
          } catch (err) {
            if (err.statut === 422) continue;               // le PC a envoyé entre-temps : on rejoue sur sa version
            throw err;
          }
        }
        // envoyé : ces opérations sont faites ; les pages refaites ici attendent celles du PC qui les contiennent
        const restent = (await attente()).filter((x) => !ops.some((y) => y.id === x.id));
        await BD.ecrire("@attente", restent);
        const s = await lesSurcharges(), fin = Math.max(...ops.map((x) => x.quand));
        for (const x of Object.values(s)) if (!x.c && x.quand <= fin) x.c = commit || "sans";
        for (const [k, x] of Object.entries(s)) if (x.c === "sans") delete s[k];
        await BD.ecrire("@surcharges", s);
        return true;
      }
      throw new Error("La sauvegarde change trop vite : nouvel essai plus tard.");
    })().finally(() => { envoi = null; }));
  }

  // ------------------------------------------------------------------ relier le téléphone au PC
  function appairer(texte) {
    const code = String(texte || "").split("#appairer=")[1];
    if (!code) throw new Error("Ce n'est pas le QR code de l'Atelier.");
    let a;
    try {
      a = JSON.parse(decodeURIComponent(escape(atob(code.trim().replace(/-/g, "+").replace(/_/g, "/")))));
    } catch (_) { throw new Error("Ce n'est pas le QR code de l'Atelier."); }
    if (!a || typeof a.c !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(a.d || "")) throw new Error("Ce n'est pas le QR code de l'Atelier.");
    acces = { d: a.d, c: a.c };
    ecrireLocal(ACCES, JSON.stringify(acces));
    ecrireLocal(COMMIT, null);
    memoire.clear();
    fusion = null;
    return BD.vider().catch(() => {});
  }
  function oublier() {
    acces = null;
    ecrireLocal(ACCES, null);
    ecrireLocal(COMMIT, null);
    memoire.clear();
    fusion = null;
    T.pret = false;
    BD.vider().catch(() => {});
  }

  // lecture du QR code par l'appareil photo : le détecteur du navigateur s'il y en a un (Android), sinon jsQR (iPhone)
  const charger = (src) => new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => ko(new Error("Lecteur de QR code introuvable : vérifie la connexion."));
    document.head.appendChild(s);
  });
  async function scanner(video, trouve) {
    const flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = flux;
    video.hidden = false;
    await video.play();
    let detecteur = null;
    try { if ("BarcodeDetector" in window) detecteur = new BarcodeDetector({ formats: ["qr_code"] }); } catch (_) {}
    if (!detecteur && !window.jsQR) await charger("jsQR.js");
    const toile = document.createElement("canvas"), ctx = toile.getContext("2d", { willReadFrequently: true });
    const arreter = () => { flux.getTracks().forEach((t) => t.stop()); video.hidden = true; };
    const tour = async () => {
      if (!flux.active || !video.isConnected) return arreter();
      let texte = null;
      if (detecteur) {
        texte = ((await detecteur.detect(video).catch(() => []))[0] || {}).rawValue;
      } else if (video.videoWidth) {
        const r = Math.min(1, 720 / video.videoWidth);
        toile.width = Math.round(video.videoWidth * r);
        toile.height = Math.round(video.videoHeight * r);
        ctx.drawImage(video, 0, 0, toile.width, toile.height);
        const img = ctx.getImageData(0, 0, toile.width, toile.height);
        texte = (window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" }) || {}).data;
      }
      if (texte && texte.includes("#appairer=")) { arreter(); return trouve(texte); }
      setTimeout(tour, 150);
    };
    tour();
    return arreter;
  }

  // ------------------------------------------------------------------ l'appli installée sur l'écran d'accueil
  const installee = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const iphone = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let invite = null;                                   // Android : la demande d'installation du navigateur
  addEventListener("beforeinstallprompt", (ev) => { ev.preventDefault(); invite = ev; bandeauInstaller(); });
  addEventListener("appinstalled", () => { const b = document.getElementById("tel-bandeau"); if (b) b.remove(); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  // ouverte dans le navigateur (par le QR code) : un bandeau en bas propose de l'installer, tant qu'elle ne l'est pas.
  // Android : le bouton ouvre la demande du navigateur ; iPhone : la marche à suivre (Safari n'a pas de bouton).
  const PLUS_TARD = "telephone-installer-plus-tard";
  function bandeauInstaller() {
    if (installee() || !acces || !document.body) return;
    if (Date.now() - Number(lireLocal(PLUS_TARD) || 0) < 3 * 86400 * 1000) return;
    let b = document.getElementById("tel-bandeau");
    if (!b) {
      b = document.createElement("div");
      b.id = "tel-bandeau";
      b.className = "tel-bandeau";
      b.setAttribute("role", "region");
      b.setAttribute("aria-label", "Installer l'appli");
      document.body.appendChild(b);
    }
    b.innerHTML = `<div class="tel-bandeau-texte"><strong>Installe l'appli</strong>
        <span>${invite ? "Elle s'ouvrira depuis son icône, même sans réseau."
          : iphone ? "Touche Partager <span class=\"tel-partager\" aria-hidden=\"true\">⬆</span>, puis «&nbsp;Sur l'écran d'accueil&nbsp;». Ouvre-la ensuite depuis son icône et scanne à nouveau le QR code."
          : "Menu du navigateur ⋮, puis «&nbsp;Installer l'application&nbsp;» ou «&nbsp;Ajouter à l'écran d'accueil&nbsp;»."}</span></div>
      <div class="tel-bandeau-boutons">
        ${invite ? `<button class="btn btn-accent btn-petit" id="tel-installer-oui">Installer</button>` : ""}
        <button class="btn btn-discret btn-petit" id="tel-installer-non">Plus tard</button></div>`;
    const oui = b.querySelector("#tel-installer-oui");
    if (oui) oui.onclick = async () => {
      invite.prompt();
      const r = await invite.userChoice.catch(() => ({}));
      invite = null;
      if (r.outcome === "accepted") b.remove(); else bandeauInstaller();
    };
    b.querySelector("#tel-installer-non").onclick = () => { ecrireLocal(PLUS_TARD, String(Date.now())); b.remove(); };
  }

  const e = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // l'écran d'attente : relier le téléphone, ou recevoir les decks la première fois
  function attenteVue(el) {
    if (!acces) {
      el.innerHTML = `<div class="tel-accueil">
        <h1>Atelier MTG</h1>
        <p>Sur ton PC, ouvre l'Atelier : Options › Téléphone. Puis scanne le QR code.</p>
        <button class="btn btn-accent" id="tel-scanner">Scanner le QR code</button>
        <video id="tel-video" playsinline muted hidden></video>
        <details class="tel-coller"><summary>Coller le lien</summary>
          <div class="form-ligne"><input class="champ" id="tel-lien" placeholder="https://atelier-mtg.github.io/#appairer=…" autocomplete="off">
          <button class="btn" id="tel-relier">Relier</button></div></details>
        <p class="erreur" id="tel-erreur" hidden></p>
        ${installee() ? "" : `<p class="muet petit tel-installer">${iphone ? "Pour l'installer : Partager › Sur l'écran d'accueil. Ouvre-la ensuite depuis son icône, et scanne le QR code."
          : `<button class="btn btn-discret" id="tel-installer">Installer l'appli</button>`}</p>`}
      </div>`;
      const erreur = (m) => { const x = el.querySelector("#tel-erreur"); x.textContent = m; x.hidden = !m; };
      const relier = async (texte) => {
        try { await appairer(texte); demarrer(); } catch (err) { erreur(err.message); }
      };
      el.querySelector("#tel-scanner").onclick = async (ev) => {
        ev.currentTarget.disabled = true;
        erreur("");
        try { await scanner(el.querySelector("#tel-video"), relier); }
        catch (err) { erreur(err.name === "NotAllowedError" ? "Autorise l'appareil photo, ou colle le lien." : err.message); ev.target.disabled = false; }
      };
      el.querySelector("#tel-relier").onclick = () => relier(el.querySelector("#tel-lien").value);
      const inst = el.querySelector("#tel-installer");
      if (inst) inst.onclick = () => (invite ? invite.prompt() : erreur("Menu du navigateur › Installer l'application."));
      return;
    }
    el.innerHTML = T.erreur ? `<div class="tel-accueil"><h1>Atelier MTG</h1><p class="erreur">${e(T.erreur)}</p>
        <button class="btn" id="tel-reessayer">Réessayer</button></div>`
      : `<p class="chargement">Réception de tes decks…</p>`;
    const r = el.querySelector("#tel-reessayer");
    if (r) r.onclick = () => { T.erreur = ""; attenteVue(el); demarrer(); };
  }

  // ------------------------------------------------------------------ démarrage
  async function demarrer() {
    if (!acces) return window.route && route();
    bandeauInstaller();
    envoyer().catch(() => {});                             // ce qui n'était pas parti (hors ligne)
    if (!T.pret && await fichier("index.json.gz")) {   // ce qu'on a déjà : tout de suite, même sans réseau
      T.pret = true;
      if (window.route) route();
    }
    try {
      const nouveau = await synchroniser();
      T.erreur = "";
      if (nouveau || !T.pret) {
        T.pret = true;
        T.date = Date.now();
        if (window.route) route();
      }
    } catch (err) {
      T.erreur = err.message;
      if (!T.pret && window.route) route();
    }
  }

  const T = window.TELEPHONE = {
    api, attente: attenteVue, pret: false, erreur: "",
    enAttente: async () => (await attente()).length,
    envoyer: () => envoyer(),
    acces: () => acces && { depot: acces.d },
    delier: () => { oublier(); route(); },
    synchroniser: () => demarrer(),
  };

  // relié par l'adresse du QR code (appareil photo du téléphone) : on retire aussitôt la clé de l'adresse
  if (location.hash.includes("#appairer=")) {
    const texte = location.hash;
    history.replaceState(null, "", location.pathname + location.search);
    appairer(texte).then(demarrer, (err) => { T.erreur = err.message; demarrer(); });
  } else demarrer();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && acces) demarrer(); });
  setInterval(() => { if (!document.hidden && acces) demarrer(); }, DISTANT);
})();
