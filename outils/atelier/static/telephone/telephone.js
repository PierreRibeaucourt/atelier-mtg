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
    const index = await fichier("index.json.gz");
    if (!index) throw Object.assign(new Error("Tes decks ne sont pas encore arrivés."), { statut: 503 });
    if (p === "/api/version") return { version: index.version, disponible: null };
    if (p === "/api/noms-cartes") return nomsCartes(index);
    if (k in index.api) return copie(index.api[k]);
    if (p === "/api/ou-sont") {
      const nom = u.searchParams.get("nom"), tout = index.api["/api/ou-sont"] || {};
      return { [nom]: copie(tout[nom]) || { classeur: 0, decks: [] } };
    }
    // un deck : sa page, préparée par le PC
    const m = p.match(/^\/api\/decks\/([^/]+)/);
    const id = m ? decodeURIComponent(m[1]) : u.searchParams.get("deck");
    if (id && index.decks[id]) {
      const d = await fichier(index.decks[id]);
      if (!d) throw Object.assign(new Error("Ce deck n'est pas encore arrivé."), { statut: 503 });
      if (k in d.api) return copie(d.api[k]);
      if (p.endsWith("/comparer") && d.comparer) return comparerPartage(u.searchParams.get("a") || "", u.searchParams.get("b") || "", d.comparer);
      if (p.endsWith("/apercu")) return { modifie: d.api[`/api/decks/${id}`] && d.api[`/api/decks/${id}`].modifie };
    }
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

  // les fiches des cartes : déjà vues dans un deck ou le classeur, sinon demandées à Scryfall (gardées ici)
  let dernierScryfall = 0;
  async function scryfall(url, corps) {
    const pause = dernierScryfall + 500 - Date.now();                     // 2 requêtes par seconde au plus
    if (pause > 0) await new Promise((r) => setTimeout(r, pause));
    dernierScryfall = Date.now();
    const r = await fetch(url, corps ? { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(corps) }
      : { headers: { Accept: "application/json" } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("Scryfall ne répond pas : vérifie la connexion.");
    return r.json();
  }
  async function ficheFr(c) {
    const r = await scryfall(`https://api.scryfall.com/cards/search?unique=prints&q=${encodeURIComponent(`!"${c.name}" lang:fr`)}`).catch(() => null);
    return MOTEUR.fiche(c, r && r.data && r.data[0]);
  }
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
    const c = await scryfall(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(nom)}`);
    const f = c ? await ficheFr(c) : { nom };
    cache[nom] = f;
    await BD.ecrire("@cartes", cache);
    return f;
  }
  // des noms tapés ou collés (français, fautes de casse…) : le nom anglais de Scryfall, et sa fiche
  async function trouverNoms(noms) {
    const res = {};
    for (let i = 0; i < noms.length; i += 75) {
      const bloc = noms.slice(i, i + 75);
      const r = await scryfall("https://api.scryfall.com/cards/collection", { identifiers: bloc.map((name) => ({ name: name.split(" // ")[0] })) });
      const trouvees = new Map(((r && r.data) || []).map((c) => [c.name.split(" // ")[0].toLowerCase(), c]));
      for (const n of bloc) {
        let c = trouvees.get(n.split(" // ")[0].toLowerCase());
        if (!c) c = await scryfall(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(n)}`).catch(() => null);
        if (c) res[n] = c;
      }
    }
    return res;
  }

  const budget = () => Number((window.REGLAGES || {}).budget) || 0;
  async function ecrire(u, b) {
    const p = u.pathname, m = p.match(/^\/api\/decks\/([^/]+)\/(modifier|achats|suggestions\/ecarter)$/);
    if (!(await fichier("index.json.gz"))) throw Object.assign(new Error("Tes decks ne sont pas encore arrivés."), { statut: 503 });
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
    const raison = MOTEUR.modifier(entrees, b.op, d);
    const infos = {};
    for (const e of entrees) if (!prec.cartes.some((c) => c.nom === e.nom)) infos[e.nom] = await ficheCarte(e.nom);
    const page = MOTEUR.page(id, entrees, prec, infos, budget());
    const liste = (await api("/api/decks")).map((x) => (x.id === id ? MOTEUR.resume(page) : x));
    await surcharger({ [`/api/decks/${id}`]: page, [`/api/decks/${id}/export?format=archidekt`]: MOTEUR.texte(entrees), "/api/decks": liste });
    await enAttente({ f: "deck", deck: id, op: b.op, d, raison });
    return copie(page);
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
      const trouves = await trouverNoms([...lues.keys()]);
      const ajouts = {};
      for (const [lu, n] of lues) {
        const c = trouves[lu];
        if (!c) { inconnues.push(lu); continue; }
        ajouts[c.name] = (ajouts[c.name] || 0) + n;
        if (cartes.has(c.name)) cartes.get(c.name).n += n;
        else cartes.set(c.name, { nom: c.name, n, info: await ficheFr(c) });
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
        const lire = async (rel) => {
          if (!originaux.has(rel)) { const t = await contenu(rel, tete); originaux.set(rel, t); fichiers.set(rel, t); }
          return fichiers.get(rel);
        };
        const avant = new Map(), raisons = new Map();
        for (const o of ops) {
          if (o.f === "deck" || o.f === "achats" || o.f === "ecarter") {
            const liste = await lire(`${o.deck}/archidekt.txt`);
            if (liste == null) continue;                    // deck supprimé sur le PC entre-temps
            if (o.f === "deck") {
              const e = MOTEUR.lire(liste);
              try { MOTEUR.modifier(e, o.op, o.d); } catch (_) { continue; }
              if (!avant.has(o.deck)) avant.set(o.deck, originaux.get(`${o.deck}/archidekt.txt`));
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
        const entrees = [];
        for (const [rel, t] of fichiers) {
          if (t == null || t === originaux.get(rel)) continue;
          const b = await ghEcrire("POST", `/repos/${acces.d}/git/blobs`, { content: t, encoding: "utf-8" });
          entrees.push({ path: rel, mode: "100644", type: "blob", sha: b.sha });
        }
        let commit = null;
        if (entrees.length) {
          const nouvel = await ghEcrire("POST", `/repos/${acces.d}/git/trees`, { base_tree: arbre, tree: entrees });
          const resume = [...raisons.values()].flat().slice(0, 3).join(" · ") || "achats, classeur";
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
