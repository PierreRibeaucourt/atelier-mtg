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
  // la page GitHub de l'appli « Atelier MTG » (relais.js › CLIENT_ID) : « Revoke access » y retire toutes ses clés
  const APPLI_GITHUB = "https://github.com/settings/connections/applications/Ov23li9fE6JyGKnCmR3L";
  const ACCES = "telephone-acces", COMMIT = "telephone-commit", REGLAGES = "telephone-reglages";
  const DISTANT = 5 * 60 * 1000;                      // coup d'œil au dépôt toutes les cinq minutes, appli ouverte
  document.documentElement.classList.add("telephone");

  const lireLocal = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const ecrireLocal = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} };
  const lireAcces = () => { try { const a = JSON.parse(lireLocal(ACCES) || "null"); return a && a.d && a.c ? a : null; } catch (_) { return null; } };
  let acces = lireAcces();
  // sans PC (« Commencer ici ») : les decks sont gardés sur le téléphone (@depot, rangés comme dans la sauvegarde), et
  // leurs pages sont faites ici (pages.js) au lieu d'arriver du PC
  const LOCAL = "telephone-local";
  let local = !acces && lireLocal(LOCAL) === "1";
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

  // la clé GitHub d'ici marche-t-elle encore ? (« Retirer l'accès », app.js) Refusée, elle est oubliée : relié au PC, le
  // téléphone est délié (gh) ; sans PC, ses decks restent, il n'y a qu'à le reconnecter (ghCompte)
  async function cleValide() {
    try {
      if (local) {
        const g = await leCompte();
        if (!g) return { valide: false };
        await ghCompte(g.jeton, "GET", "/user");
      } else if (acces) await gh("/user");
      else return { valide: false };
      return { valide: true };
    } catch (e) {
      if (e.statut === 401) return { valide: false };
      throw e;
    }
  }

  // reçoit ce qui a changé depuis la dernière fois ; true s'il y avait du nouveau
  let enCours = null;
  function synchroniser() {
    return enCours || (enCours = (async () => {
      if (local) {                                      // sans PC : rien à recevoir ; les pages, faites ici si elles manquent
        if (!(await fichier("index.json.gz"))) { await recalculer(await depot()); return true; }
        return false;
      }
      // la branche des decks a disparu alors qu'on l'avait reçue : le PC a arrêté l'appli du téléphone (telephone.couper)
      let commit;
      try { commit = (await gh(`/repos/${acces.d}/git/ref/heads/${BRANCHE}`)).object.sha; }
      catch (e) {
        if (e.statut === 404 && await fichier("index.json.gz")) {
          T.arrete = true;
          throw Object.assign(new Error("Ton PC n'envoie plus tes decks."), { statut: 404 });
        }
        throw e;
      }
      T.arrete = false;
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
      connus = null;
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
    // la recherche de cartes : dans la base de cartes du téléphone
    if (p === "/api/recherche/base") { if (!etatBase.prete && !baseEnCours) laBase().catch(() => {}); return copie(etatBase); }
    if (p === "/api/recherche") return rechercheAvancee(u);
    if (p === "/api/recherche/editions") return demander("editions");
    if (p === "/api/recherche/fonctions") return demander("fonctions");
    if (p === "/api/recherche/tags") return demander("suggestions", u.searchParams.get("q") || "");
    if (p === "/api/recherche/noms") { pret(); return message("noms", [u.searchParams.get("q") || "", await dansDeck(u.searchParams.get("deck")), 8]); }
    if (p === "/api/recherche-cartes") return decksAvecCarte(u.searchParams.get("q") || "");
    if (p === "/api/github/valide") return cleValide();
    if (local && /^\/api\/(github|sauvegarde)(\/|$)/.test(p)) { const r = await routeGithub(p, "GET"); if (r !== undefined) return r; }
    // Commander Spellbook, par le relais : les combos d'une carte ; sans PC, le bracket et les combos du deck à jour
    const sbm = p.match(/^\/api\/decks\/([^/]+)\/(bracket|combos|combos\/carte)$/);
    if (sbm && sbm[2] === "combos/carte") return combosCarte(decodeURIComponent(sbm[1]), u);
    if (sbm && local) {
      const id = decodeURIComponent(sbm[1]), r = await assurerSpellbook(id, u.searchParams.get("force") === "1");
      const d = await fichier("decks/" + id), v = d && d.api[`/api/decks/${id}/${sbm[2]}`];
      if (v) return { ...copie(v), ...(r.erreur ? (sbm[2] === "bracket" ? { spellbook_erreur: r.erreur } : { erreur: r.erreur }) : {}) };
    }
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
      if (etatBase.prete) return message("apercu", [u.searchParams.get("nom") || ""]);
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
    minuterie = setTimeout(() => envoyer().catch(() => {}), local ? 300 : 2500);     // une série de modifications part en une fois
  }

  // ------------------------------------------------------------------ la base de cartes (cartes.js, dans un Worker)
  // Celle de la recherche du PC, allégée (base_telephone.py), publiée avec l'appli et refaite chaque semaine : téléchargée
  // une fois (≈ 10 Mo), gardée ici (@base), puis seulement quand elle change, hors données mobiles. Elle sert à la
  // recherche de cartes, au champ du haut, et aux fiches des cartes : sans réseau, et sans PC.
  const CARTES = "__CARTES__";                        // cartes.js?v=… (telephone_site.py)
  const etatBase = { prete: false, date: null, date_fr: null, nb: 0, verifie: 0, nouveautes: [], prochaine: 0,
    construction: { actif: false, etape: "", fait: 0, total: 0, unite: "", erreur: "" } };
  let travailleur = null, baseEnCours = null, numMsg = 0;
  const reponses = new Map();
  function message(f, a = [], transfert = []) {
    if (!travailleur) {
      travailleur = new Worker(CARTES);
      travailleur.onmessage = (ev) => {
        const r = reponses.get(ev.data.id);
        if (!r) return;
        reponses.delete(ev.data.id);
        if ("e" in ev.data) r.ko(new Error(ev.data.e)); else r.ok(ev.data.r);
      };
      travailleur.onerror = (ev) => { for (const r of reponses.values()) r.ko(new Error(ev.message || "La base de cartes ne répond pas.")); reponses.clear(); };
    }
    return new Promise((ok, ko) => { const id = ++numMsg; reponses.set(id, { ok, ko }); travailleur.postMessage({ id, f, a }, transfert); });
  }
  const mobile = () => { const c = navigator.connection; return !!c && (c.saveData || c.type === "cellular"); };
  async function telechargerBase(idx = null) {
    const c = etatBase.construction;
    Object.assign(c, { actif: true, etape: "Téléchargement de la base de cartes", fait: 0, total: 0, unite: "octets", erreur: "" });
    try {
      idx = idx || await (await fetch("base/index.json", { cache: "no-store" })).json();
      c.total = idx.taille;
      const r = await fetch("base/" + idx.fichier);
      if (!r.ok) throw new Error(`La base de cartes ne répond pas (${r.status}).`);
      const lecteur = r.body.getReader(), morceaux = [];
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        morceaux.push(value);
        c.fait += value.length;
      }
      const g = { fichier: idx.fichier, date: idx.date, nb: idx.nb, donnees: await new Blob(morceaux).arrayBuffer() };
      await BD.ecrire("@base", g);
      return g;
    } catch (e) {
      c.erreur = e instanceof TypeError ? "Pas de réseau : la base de cartes arrivera plus tard." : e.message;
      throw new Error(c.erreur);
    } finally { c.actif = false; }
  }
  // la base dans le Worker : celle gardée ici, sinon téléchargée
  function laBase(g = null) {
    return baseEnCours || (baseEnCours = (async () => {
      g = g || await BD.lire("@base").catch(() => null) || await telechargerBase();
      etatBase.construction.etape = "Lecture de la base de cartes";
      const r = await message("charger", [g.donnees], [g.donnees]);
      await message("reglages", [{ sansUb: !!(window.REGLAGES || {}).sans_ub_illustrations }]);
      Object.assign(etatBase, { prete: true, date: r.date, nb: r.nb });
      etatBase.construction.etape = "";
      if (local) {                                         // sans PC : les pages refaites avec la base (prix, noms français)
        recalculer(await depot()).then(() => { if (window.route && T.pret && document.querySelector("#modale")?.hidden !== false) route(); }).catch(() => {});
      }
    })().catch((e) => { baseEnCours = null; etatBase.construction.erreur = e.message; throw e; }));
  }
  // une nouvelle base publiée : téléchargée (pas sur les données mobiles, sauf si on la demande), puis relue
  async function nouvelleBase(force = false) {
    etatBase.verifie = Date.now() / 1000;
    const idx = await (await fetch("base/index.json", { cache: "no-store" })).json();
    const g = await BD.lire("@base").catch(() => null);
    if (g && g.fichier === idx.fichier) return false;
    if (!force && mobile()) return false;
    const n = await telechargerBase(idx);
    await baseEnCours?.catch(() => {});
    baseEnCours = null;
    await laBase(n);
    return true;
  }
  const pret = () => {
    if (etatBase.prete) return;
    if (!baseEnCours) laBase().catch(() => {});
    throw Object.assign(new Error("La base de cartes n'est pas encore prête."), { statut: 503 });
  };
  const demander = (f, ...a) => { pret(); return message(f, a); };
  // les cartes d'un deck, pour les marquer dans les résultats : {clé du nom: "commandant" | "deck" | "maybe"}
  async function dansDeck(id) {
    if (!id) return {};
    const d = await api(`/api/decks/${id}`).catch(() => null), res = {};
    for (const c of (d && d.cartes) || []) {
      const k = cle(c.nom).toLowerCase(), v = c.cat === "Commander" ? "commandant" : c.cat === "Maybeboard" ? "maybe" : "deck";
      if (res[k] == null || res[k] === "maybe") res[k] = v;
    }
    return res;
  }
  async function rechercheAvancee(u) {
    pret();
    const p = Object.fromEntries(u.searchParams);
    let notes = null;                                     // « Pertinence » : le thème du deck lié (suggestions.py)
    if (p.ordre === "pertinence" && p.deck) {
      const t = await api(`/api/decks/${p.deck}/export?format=archidekt`).catch(() => null);
      if (t) notes = await message("pertinences", [MOTEUR.lire(t)]).catch(() => null);
    }
    return { ...(await message("chercher", [p, await dansDeck(p.deck), notes])), base: copie(etatBase) };
  }
  // le champ du haut : les decks qui contiennent une carte dont le nom (anglais ou français) contient le texte
  async function decksAvecCarte(q) {
    q = simple(q.trim());
    if (q.length < 3) return {};
    const res = {};
    for (const d of await api("/api/decks").catch(() => [])) {
      const page = await api(`/api/decks/${d.id}`).catch(() => null);
      const l = ((page && page.cartes) || []).filter((c) => simple(c.nom).includes(q) || simple((c.info || {}).fr).includes(q)).map((c) => c.nom);
      const t = [...new Set(l)];
      if (t.length) res[d.id] = [...t.slice(0, 4), ...(t.length > 4 ? [`et ${t.length - 4} autres`] : [])];
    }
    return res;
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
  // (la base de cartes d'abord : sans réseau ; Scryfall pour celles qu'elle n'a pas)
  async function fiches(noms, garde = null) {
    const res = etatBase.prete ? await message("fiches", [noms]).catch(() => ({})) : {};
    const reste = noms.filter((n) => !res[n]);
    if (!reste.length) return res;
    try {
      const m = await cartes(reste, garde);
      await francais([...m.values()].filter(Boolean).map((c) => c.name), garde);
      for (const [n, c] of m) if (c) res[n] = ficheDe(c);
    } catch (e) {
      if (e.abandon || !etatBase.prete) throw e;          // pas de réseau : les cartes que la base ne connaît pas restent inconnues
    }
    return res;
  }
  // les fiches que le PC a déjà faites (decks et classeur) : leur prix est celui que montre la fiche d'une carte, la
  // recherche le reprend pour ne pas en montrer un autre. Refaites quand les pages changent.
  let connus = null;
  async function fichesConnues() {
    if (connus) return connus;
    const m = new Map(), index = await fichier("index.json.gz");
    for (const x of (((index && index.api["/api/classeur"]) || {}).cartes || [])) if (x.info && x.info.image) m.set(x.nom, x.info);
    for (const [id, f] of Object.entries((index && index.decks) || {})) {
      const d = await fichier(f);
      for (const c of ((d && d.api[`/api/decks/${id}`]) || {}).cartes || []) if (c.info && c.info.image) m.set(c.nom, c.info);
    }
    return (connus = m);
  }
  const prixConnus = async (res) => {
    const m = await fichesConnues();
    return res.map((x) => { const i = m.get(x.nom); return i && i.prix != null ? { ...x, prix: i.prix, prix_lien: i.prix_lien || x.prix_lien } : x; });
  };
  // une carte d'un deck : déjà vue dans un deck ou le classeur, sinon demandée (base de cartes, Scryfall) et gardée ici
  // une semaine (son prix change)
  async function ficheCarte(nom) {
    const connue = (await fichesConnues()).get(nom);
    if (connue) return connue;
    const cache = (await BD.lire("@cartes").catch(() => null)) || {};
    if (cache[nom] && cache[nom].garde > Date.now() - 7 * 86400000) return cache[nom];
    const f = (await fiches([nom]))[nom] || { nom };
    if (f.image) {
      cache[nom] = { ...f, garde: Date.now() };
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
    if (etatBase.prete) return prixConnus((await message("noms", [texte, {}, 20])).map((x) => ({ ...x, legal: x.legal || "not_legal" })));
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
    return prixConnus(res.filter((x) => m.get(x.nom)).map((x) => {
      const c = m.get(x.nom), f = MOTEUR.fiche(c), p = prixDe(c), t = fr.get(c.name);
      return { nom: c.name, fr: x.fr || (t ? t.fr || "" : BASES_FR[c.name] || null), cout: f.cout, type: f.type, image: f.image, gc: f.gc,
        prix: p.prix, prix_lien: p.prix_lien, legal: f.legal, couleurs: f.couleurs };
    }));
  }
  // le prix du jour et le nom français des résultats d'une recherche (infos_cartes.prix_et_noms)
  async function prixEtNoms(noms) {
    const garde = gardeDe(tourRecherche);
    noms = noms.filter(Boolean).slice(0, 25);
    if (etatBase.prete) {
      const f = await message("fiches", [noms]);
      if (noms.every((n) => f[n])) return Object.fromEntries(noms.map((n) => [n, { prix: f[n].prix, prix_lien: "", fr: f[n].fr }]));
    }
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
      trop_cher: budget() > 0 && (f.prix || 0) > budget(), image_ed: null,
      versions: etatBase.prete ? ((await message("impressionImage", [nom, null]).catch(() => null)) || {}).versions || 0 : 0 };
  }

  const budget = () => Number((window.REGLAGES || {}).budget) || 0;
  // sans PC, les réglages des cartes se changent ici (app.py › api_options) : budget par carte (0 : pas d'alerte),
  // illustrations et suggestions sans Universes Beyond. Gardés sur ce téléphone ; toutes les pages sont refaites.
  // langues des impressions (reglages.LANGUES) : « la moins chère en … » ; sans langue, la moins chère tout court
  const LANGUES = { fr: "français", de: "allemand", it: "italien", es: "espagnol", pt: "portugais", ja: "japonais",
    ko: "coréen", ru: "russe", zhs: "chinois simplifié", zht: "chinois traditionnel" };
  const langueCartes = () => { const l = (window.REGLAGES || {}).langue_cartes; return l in LANGUES ? l : ""; };
  const options = () => { const r = window.REGLAGES || {};
    return { budget: r.budget ?? 5, budget_defaut: 5, langues: LANGUES, langue_cartes: langueCartes(), sans_ub_illustrations: !!r.sans_ub_illustrations,
      sans_ub_suggestions: !!r.sans_ub_suggestions }; };
  async function ecrireOptions(d) {
    const r = { budget: 5, ...(window.REGLAGES || {}) };
    if ("budget" in d) {
      const b = String(d.budget).replace("€", "").replace(",", ".").trim(), v = b ? Number(b) : 5;
      if (!Number.isFinite(v) || v < 0 || v > 100000) throw new Error("Le budget est un nombre d'euros.");
      r.budget = v;
    }
    for (const k of ["sans_ub_illustrations", "sans_ub_suggestions"]) if (k in d) r[k] = !!d[k];
    if ("langue_cartes" in d) {
      if (d.langue_cartes && !(d.langue_cartes in LANGUES)) throw new Error("Langue inconnue.");
      r.langue_cartes = d.langue_cartes || null;
    }
    window.REGLAGES = r;
    ecrireLocal(REGLAGES, JSON.stringify(r));
    if (etatBase.prete) await message("reglages", [{ sansUb: !!r.sans_ub_illustrations }]).catch(() => {});
    const refaire = recalculer(null);           // une autre langue : ses impressions à lire sur Scryfall, en fond
    if ("langue_cartes" in d) refaire.catch(() => {}); else await refaire;
    return options();
  }
  async function ecrire(u, b) {
    const p = u.pathname, m = p.match(/^\/api\/decks\/([^/]+)\/(modifier|achats|suggestions\/ecarter)$/);
    if (local && /^\/api\/(github|sauvegarde)(\/|$)/.test(p)) { const r = await routeGithub(p, "POST", b); if (r !== undefined) return r; }
    if (local && p === "/api/options") return ecrireOptions(b);
    if (p === "/api/prix") return prixEtNoms(b.noms || []);
    if (p === "/api/recherche/base") {                    // « Mettre à jour » : une nouvelle base, même sur les données mobiles
      const c = etatBase.construction;
      Object.assign(c, { actif: true, etape: "Recherche d'une nouvelle base", fait: 0, total: 0, unite: "", erreur: "" });
      nouvelleBase(true).catch((e) => { c.erreur = e instanceof TypeError ? "Pas de réseau." : e.message; }).finally(() => { c.actif = false; });
      return copie(etatBase);
    }
    if (!(await fichier("index.json.gz"))) throw Object.assign(new Error("Tes decks ne sont pas encore arrivés."), { statut: 503 });
    if (!local && T.arrete) throw Object.assign(new Error("Ton PC n'envoie plus tes decks."), { statut: 409 });
    if (p === "/api/decks") return creerDeck(b);
    if (p === "/api/decks/importer") return importerDecks(b);
    if (p === "/api/classeur/importer") return importerClasseur(b);
    const r = p.match(/^\/api\/decks\/([^/]+)\/(renommer|supprimer)$/);
    if (r && r[2] === "renommer") return renommerDeck(decodeURIComponent(r[1]), b.nom);
    if (r) return supprimerDeck(decodeURIComponent(r[1]));
    const v = p.match(/^\/api\/decks\/([^/]+)\/(versions|versions\/supprimer|restaurer)$/);
    if (v && v[2] === "versions") return sauverVersion(decodeURIComponent(v[1]), b);
    if (v && v[2] === "restaurer") return restaurer(decodeURIComponent(v[1]), b.fichier);
    if (v) return supprimerVersion(decodeURIComponent(v[1]), b.fichier);
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
    if (b.liste != null) {                                  // une liste collée
      const lues = lireListe(String(b.liste));
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

  // ------------------------------------------------------------------ importer des fichiers exportés d'une autre appli
  // une liste collée (Archidekt, Moxfield, MTG Arena, « 1 Sol Ring » ou juste « Sol Ring ») : Map nom → exemplaires
  // (classeur.lire_liste)
  function lireListe(texte) {
    const lignes = texte.split(/\r?\n/).filter((l) => l.trim() && !/^\s*(#|\/\/)/.test(l))
      .map((l) => (/^\s*(SB:\s*)?\d/.test(l) ? l : "1 " + l.trim()));
    const lues = new Map();
    for (const e of MOTEUR.lireLignes(lignes)) lues.set(e.nom, (lues.get(e.nom) || 0) + e.n);
    return lues;
  }
  // une collection en CSV (ManaBox, Moxfield, Archidekt, Deckbox, Dragon Shield…) : Map nom → exemplaires ; null si ce
  // n'est pas un CSV avec une colonne de noms (classeur.lire_csv)
  const COL_NOM = ["name", "card name", "card", "card_name", "cardname", "nom"];
  const COL_QTE = ["quantity", "count", "qty", "quantité", "quantite", "qté", "amount", "copies"];
  function champsCsv(ligne, sep) {
    const res = [];
    let x = "", guillemets = false;
    for (let i = 0; i < ligne.length; i++) {
      const c = ligne[i];
      if (guillemets) {
        if (c === '"' && ligne[i + 1] === '"') { x += '"'; i++; }
        else if (c === '"') guillemets = false;
        else x += c;
      } else if (c === '"' && !x) guillemets = true;
      else if (c === sep) { res.push(x); x = ""; }
      else x += c;
    }
    res.push(x);
    return res;
  }
  function lireCsv(texte) {
    let lignes = texte.replace(/^﻿/, "").split(/\r\n|\r|\n/);
    if (lignes.length && lignes[lignes.length - 1] === "") lignes.pop();
    if (lignes.length && lignes[0].toLowerCase().startsWith("sep=")) lignes = lignes.slice(1);
    if (!lignes.length) return null;
    const compte = (s) => lignes[0].split(s).length - 1;
    const sep = [",", ";", "\t"].reduce((a, s) => (compte(s) > compte(a) ? s : a));
    if (!compte(sep)) return null;
    const cols = champsCsv(lignes[0], sep).map((c) => c.trim().toLowerCase());
    const iNom = COL_NOM.map((c) => cols.indexOf(c)).find((i) => i >= 0);
    if (iNom === undefined) return null;
    const iQte = COL_QTE.map((c) => cols.indexOf(c)).find((i) => i >= 0);
    const res = new Map();
    for (const l of lignes.slice(1)) {
      const r = champsCsv(l, sep);
      if (r.length <= iNom || !r[iNom].trim()) continue;
      let n = 1;
      if (iQte !== undefined && iQte < r.length && r[iQte].trim()) { n = Math.trunc(Number(r[iQte])); if (Number.isNaN(n)) n = 1; }
      if (n > 0) res.set(r[iNom].trim(), (res.get(r[iNom].trim()) || 0) + n);
    }
    return res;
  }
  // un nom de deck tiré d'un nom de fichier (« Kels - Dimir.txt »), qui n'existe pas encore : « Kels 2 »… (decks.nom_libre)
  function nomLibre(nom, pris) {
    nom = nom.replace(/[<>:"/\\|?*]/g, " ").split(/\s+/).filter(Boolean).join(" ").replace(/[. ]+$/, "").slice(0, 60).trim() || "Importé";
    const base = nom.replace(/^Deck /, "").trim() || "Importé";
    for (let k = 2; pris.has(MOTEUR.dossier(nom).toLowerCase()); k++) nom = `${base} ${k}`;
    return nom;
  }
  // plusieurs decks d'un coup : {fichiers: [{nom, texte}], montes} → {decks, echecs} (app.py › api_importer_decks) ;
  // montes : toutes leurs cartes sont notées comme déjà là (onglet Achats)
  async function importerDecks(b) {
    const faits = [], echecs = [], pris = new Set((await api("/api/decks")).map((d) => d.id.toLowerCase()));
    for (const f of (b.fichiers || []).slice(0, 200)) {
      const nom = String(f.nom || "").split(/[\\/]/).pop().replace(/\.[^.]*$/, "");
      let texte = String(f.texte || "");
      const c = lireCsv(texte);
      if (c) texte = [...c].map(([carte, n]) => `${n} ${carte}`).join("\n");
      if (!MOTEUR.lireLignes(texte.split(/\r?\n/)).length) { echecs.push({ nom, erreur: "aucune carte reconnue" }); continue; }
      try {
        const { id } = await creerDeck({ nom: nomLibre(nom, pris), commandant: "", liste: texte });
        pris.add(id.toLowerCase());
        if (b.montes) {
          const poss = {};
          for (const x of (await api(`/api/decks/${id}`)).cartes) if (x.cat !== "Maybeboard") poss[x.nom] = (poss[x.nom] || 0) + x.n;
          await marquerAchats(id, poss);
        }
        faits.push(id);
      } catch (e) { echecs.push({ nom, erreur: e.message }); }
    }
    return { decks: faits, echecs };
  }
  // une collection : {texte, sans_decks, remplacer, apercu} → {cartes, en_decks, inconnues} (en exemplaires), et le
  // classeur s'il a changé (app.py › api_classeur_importer). sans_decks : sans les exemplaires déjà notés dans les decks
  async function importerClasseur(b) {
    const texte = String(b.texte || ""), lues = lireCsv(texte) || lireListe(texte);
    const trouves = lues.size ? await fiches([...lues.keys()]) : {};
    let propres = new Map();
    const inconnues = [], infos = new Map();
    for (const [lu, n] of lues) {
      const f = trouves[lu];
      if (!f) { inconnues.push(lu); continue; }
      propres.set(f.nom, (propres.get(f.nom) || 0) + n);
      infos.set(f.nom, f);
    }
    const ouSont = await api("/api/ou-sont").catch(() => ({}));
    const dansDecks = (nom) => ((ouSont[nom] || {}).decks || []).reduce((s, x) => s + (x[2] || 0), 0);
    const r = { cartes: [...propres.values()].reduce((s, n) => s + n, 0), en_decks: [...propres].reduce((s, [nom, n]) => s + Math.min(n, dansDecks(nom)), 0),
      inconnues: inconnues.sort() };
    if (b.apercu) return r;
    if (b.sans_decks) propres = new Map([...propres].map(([nom, n]) => [nom, n - Math.min(n, dansDecks(nom))]).filter(([, n]) => n > 0));
    const cartes = new Map(b.remplacer ? [] : ((await api("/api/classeur")).cartes || []).map((x) => [x.nom, x]));
    for (const [nom, n] of propres) {
      if (cartes.has(nom)) cartes.get(nom).n += n;
      else cartes.set(nom, { nom, n, info: infos.get(nom) || {} });
    }
    const liste = [...cartes.values()].sort((x, y) => (x.nom.toLowerCase() < y.nom.toLowerCase() ? -1 : 1));
    await surcharger({ "/api/classeur": { cartes: liste } });
    await enAttente({ f: "classeur", d: b.remplacer ? { remplacer: Object.fromEntries(propres) } : { ajouter: Object.fromEntries(propres) } });
    return { ...r, classeur: copie(liste) };
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
  // les opérations en attente, rejouées sur des fichiers : ceux de la sauvegarde (relié au PC), ou ceux gardés sur le
  // téléphone (sans PC). source(rel) : le contenu d'un fichier au départ (null s'il n'existe pas). prefixe : devant ce
  // que l'historique du deck note (« Téléphone : … » quand le PC le lira).
  async function rejouer(ops, source, prefixe) {
    const originaux = new Map(), fichiers = new Map(), supprimes = new Set();
    // un deck renommé ou supprimé : tout son dossier part (effaces), et va sous le nouveau nom (origine : nouveau
    // dossier → dossier de départ où sont ses fichiers)
    const origine = new Map(), effaces = new Set();
    const lire = async (rel) => {
      if (!originaux.has(rel)) {
        const dossier = rel.split("/")[0], src = origine.has(dossier) ? origine.get(dossier) : effaces.has(dossier) ? null : dossier;
        const t = src ? await source(src + rel.slice(dossier.length)) : null;
        originaux.set(rel, t);
        fichiers.set(rel, t);
      }
      return fichiers.get(rel);
    };
    const avant = new Map(), raisons = new Map(), nouveaux = [];
    const sous = (rel, dossier) => rel.startsWith(dossier + "/");
    const deplacer = (a, n) => {                        // ce qui est déjà lu ou refait suit le deck
      for (const m of [originaux, fichiers]) for (const [rel, t] of [...m]) if (sous(rel, a)) { m.delete(rel); if (n) m.set(n + rel.slice(a.length), t); }
      for (const rel of [...supprimes]) if (sous(rel, a)) supprimes.delete(rel);
      for (const m of [avant, raisons]) if (m.has(a)) { if (n) m.set(n, m.get(a)); m.delete(a); }
    };
    const titre = (id) => id.replace(/^Deck /, "");
    for (const o of ops) {
      if (o.f === "creer") {
        if ((await lire(`${o.deck}/archidekt.txt`)) != null) continue;      // un deck de ce nom vient d'arriver du PC
        fichiers.set(`${o.deck}/archidekt.txt`, o.texte);
        if ((await lire(`${o.deck}/achats.json`)) == null) fichiers.set(`${o.deck}/achats.json`, ACHATS_VIDES);
        nouveaux.push("nouveau deck " + titre(o.deck));
      } else if (o.f === "renommer" || o.f === "supprimer") {
        const src = origine.has(o.deck) ? origine.get(o.deck) : o.deck;
        origine.delete(o.deck);
        effaces.add(src);
        deplacer(o.deck, o.vers);
        if (o.vers) origine.set(o.vers, src);
        nouveaux.push(o.vers ? `${titre(o.deck)} renommé ${titre(o.vers)}` : `${titre(o.deck)} supprimé`);
      } else if (o.f === "classeur") {
        const c = MOTEUR.lireClasseur((await lire("Classeur/classeur.txt")) || "");
        if (o.d.remplacer) c.cartes = new Map(Object.entries(o.d.remplacer).filter(([, n]) => n > 0));   // classeur.remplacer
        for (const [nom, n] of Object.entries(o.d.ajouter || {})) c.cartes.set(nom, (c.cartes.get(nom) || 0) + n);
        for (const [nom, n] of Object.entries(o.d.fixer || {})) { if (n > 0) c.cartes.set(nom, n); else c.cartes.delete(nom); }
        fichiers.set("Classeur/classeur.txt", MOTEUR.ecrireClasseur(c));
      } else {
        const liste = await lire(`${o.deck}/archidekt.txt`);
        if (liste == null) continue;                        // deck supprimé ailleurs entre-temps
        const changer = (texte, raison) => {                // la liste change : l'historique gardera celle d'avant
          if (!avant.has(o.deck)) avant.set(o.deck, liste);
          fichiers.set(`${o.deck}/archidekt.txt`, texte);
          raisons.set(o.deck, [...(raisons.get(o.deck) || []), raison]);
        };
        if (o.f === "deck") {
          const e = MOTEUR.lire(liste);
          // une impression française choisie : notée dans visuels.json, comme sur le PC
          const vf = `${o.deck}/visuels.json`, L = o.d.edition && o.d.edition.set ? JSON.parse((await lire(vf)) || "{}") : null;
          const L0 = JSON.stringify(L);
          try { MOTEUR.modifier(e, o.op, o.d, L); } catch (_) { continue; }
          if (L && JSON.stringify(L) !== L0) fichiers.set(vf, JSON.stringify(L, null, 1));
          changer(MOTEUR.texte(e), o.raison);
        } else if (o.f === "restaurer") {
          const t = await lire(`${o.deck}/${o.fichier}`);
          if (t != null) changer(MOTEUR.texte(MOTEUR.lire(t)), o.raison);
        } else if (o.f === "version") {                      // decks.sauver_version
          fichiers.set(`${o.deck}/${o.fichier}`, liste);
          supprimes.delete(`${o.deck}/${o.fichier}`);
          const mf = `${o.deck}/versions/versions.json`, meta = JSON.parse((await lire(mf)) || "{}");
          meta[o.fichier.split("/").pop()] = { nom: o.nom, note: o.note, date: o.date };
          fichiers.set(mf, JSON.stringify(meta, null, 1));
          nouveaux.push(`version « ${o.nom} » de ${titre(o.deck)}`);
        } else if (o.f === "supprimerVersion") {             // decks.supprimer_version
          await lire(`${o.deck}/${o.fichier}`);
          fichiers.set(`${o.deck}/${o.fichier}`, null);
          supprimes.add(`${o.deck}/${o.fichier}`);
          const mf = `${o.deck}/versions/versions.json`, meta = JSON.parse((await lire(mf)) || "{}");
          const nom = (meta[o.fichier.split("/").pop()] || {}).nom || o.fichier.split("/").pop();
          delete meta[o.fichier.split("/").pop()];
          fichiers.set(mf, JSON.stringify(meta, null, 1));
          nouveaux.push(`version « ${nom} » de ${titre(o.deck)} supprimée`);
        } else if (o.f === "achats") {
          const t = await lire(`${o.deck}/achats.json`);
          let poss = t ? JSON.parse(t).possedees || {} : null;
          if (!poss) {                                      // jamais noté : le deck est déjà monté (decks.possedees)
            poss = {};
            for (const e of MOTEUR.lire(liste)) if (MOTEUR.categorie(e) !== "Maybeboard") poss[e.nom] = (poss[e.nom] || 0) + e.n;
          }
          for (const [nom, n] of Object.entries(o.d)) poss[nom] = Math.max(0, parseInt(n, 10) || 0);
          fichiers.set(`${o.deck}/achats.json`, JSON.stringify({ possedees: poss }, null, 1));
        } else if (o.f === "ecarter") {
          const t = await lire(`${o.deck}/suggestions.json`);
          const l = ((t && JSON.parse(t).ecartees) || []).filter((n) => n !== o.d.nom);
          if (o.d.oui) l.push(o.d.nom);
          fichiers.set(`${o.deck}/suggestions.json`, JSON.stringify({ ecartees: l.sort() }, null, 1));
        }
      }
    }
    // l'historique du deck, comme sur le PC (decks.instantane) : la liste d'avant, et ce qui a changé
    const quand = horodatage();
    for (const [deck, t] of avant) {
      if (fichiers.get(`${deck}/archidekt.txt`) === t) continue;
      let nom = `${quand}.txt`, k = 2;                      // deux envois dans la même seconde : _2, _3…
      while ((await lire(`${deck}/historique/${nom}`)) != null) nom = `${quand}_${k++}.txt`;
      fichiers.set(`${deck}/historique/${nom}`, t);
      const j = JSON.parse((await lire(`${deck}/historique/journal.json`)) || "{}");
      j[nom] = prefixe + raisons.get(deck).join(" · ");
      fichiers.set(`${deck}/historique/journal.json`, JSON.stringify(j, null, 1));
    }
    const resume = [...nouveaux, ...[...raisons.values()].flat()].slice(0, 3).join(" · ");
    const touches = new Set([...fichiers.keys(), ...supprimes].map((r) => r.split("/")[0]).concat([...origine.keys()], [...effaces]));
    return { originaux, fichiers, supprimes, origine, effaces, resume, touches, sous };
  }

  // relié au PC : un commit sur la branche des decks de la sauvegarde ; le PC le recevra par sa synchronisation
  async function envoyerGithub(ops) {
    const index = await fichier("index.json.gz");
    const branche = (index && index.branche) || "main";
    for (let essai = 0; essai < 3; essai++) {
      const tete = (await gh(`/repos/${acces.d}/git/ref/heads/${branche}`)).object.sha;
      const arbre = (await gh(`/repos/${acces.d}/git/commits/${tete}`)).tree.sha;
      const r = await rejouer(ops, (rel) => contenu(rel, tete), "Téléphone : ");
      // les dossiers renommés ou supprimés : chaque fichier effacé, ou repris tel quel sous le nouveau nom (sans le télécharger)
      const entrees = new Map();
      if (r.effaces.size) {
        const tout = await gh(`/repos/${acces.d}/git/trees/${arbre}?recursive=1`);
        if (tout.truncated) throw new Error("La sauvegarde est trop grande pour renommer un deck d'ici : fais-le sur le PC.");
        const blobs = (tout.tree || []).filter((x) => x.type === "blob");
        for (const x of blobs) if (r.effaces.has(x.path.split("/")[0])) entrees.set(x.path, { path: x.path, mode: x.mode, type: "blob", sha: null });
        for (const [n, a] of r.origine) {
          for (const x of blobs) if (r.sous(x.path, a)) entrees.set(n + x.path.slice(a.length), { path: n + x.path.slice(a.length), mode: x.mode, type: "blob", sha: x.sha });
        }
      }
      for (const rel of r.supprimes) if (r.originaux.get(rel) != null) entrees.set(rel, { path: rel, mode: "100644", type: "blob", sha: null });
      for (const [rel, t] of r.fichiers) {
        if (t == null || (t === r.originaux.get(rel) && !entrees.has(rel))) continue;
        if (t === r.originaux.get(rel) && entrees.get(rel).sha) continue;                 // déplacé tel quel
        const b = await ghEcrire("POST", `/repos/${acces.d}/git/blobs`, { content: t, encoding: "utf-8" });
        entrees.set(rel, { path: rel, mode: "100644", type: "blob", sha: b.sha });
      }
      if (!entrees.size) return null;
      const nouvel = await ghEcrire("POST", `/repos/${acces.d}/git/trees`, { base_tree: arbre, tree: [...entrees.values()] });
      const commit = (await ghEcrire("POST", `/repos/${acces.d}/git/commits`, { message: "Téléphone : " + (r.resume || "achats, classeur"), tree: nouvel.sha, parents: [tete] })).sha;
      try {
        await ghEcrire("PATCH", `/repos/${acces.d}/git/refs/heads/${branche}`, { sha: commit });
        return commit;
      } catch (err) {
        if (err.statut !== 422) throw err;                 // 422 : le PC a envoyé entre-temps, on rejoue sur sa version
      }
    }
    throw new Error("La sauvegarde change trop vite : nouvel essai plus tard.");
  }

  // sans PC : les fichiers du téléphone (@depot), puis les pages des decks touchés, refaites ici
  async function envoyerLocal(ops) {
    const d = await depot(), f = d.fichiers, depart = { ...f };
    const r = await rejouer(ops, async (rel) => (rel in depart ? depart[rel] : null), "");
    for (const rel of Object.keys(f)) if (r.effaces.has(rel.split("/")[0])) delete f[rel];
    for (const [n, a] of r.origine) for (const rel of Object.keys(depart)) if (r.sous(rel, a)) f[n + rel.slice(a.length)] = depart[rel];
    for (const rel of r.supprimes) delete f[rel];
    for (const [rel, t] of r.fichiers) if (t != null) f[rel] = t;
    d.modifies = d.modifies || {};
    for (const [n, a] of r.origine) if (d.modifies[a]) d.modifies[n] = d.modifies[a];
    for (const id of r.touches) if (f[`${id}/archidekt.txt`] !== depart[`${id}/archidekt.txt`]) d.modifies[id] = Date.now() / 1000;
    for (const id of Object.keys(d.modifies)) if (!(`${id}/archidekt.txt` in f)) delete d.modifies[id];
    await BD.ecrire("@depot", d);
    await recalculer(d, r.touches);
  }

  let envoi = null;
  function envoyer() {
    return envoi || (envoi = (async () => {
      const ops = await attente();
      if (!ops.length || !(acces || local) || (!local && T.arrete)) return false;
      const commit = local ? await avecVerrou(() => envoyerLocal(ops)) : await envoyerGithub(ops);
      if (local) planifierSauvegarde();                 // sauvegardé sur GitHub une fois la série de modifications finie
      // fait : ces opérations partent de la file ; sans PC, les pages refaites ici remplacent tout de suite celles
      // d'attente ; relié au PC, elles attendent celles du PC qui les contiennent
      const restent = (await attente()).filter((x) => !ops.some((y) => y.id === x.id));
      await BD.ecrire("@attente", restent);
      const s = await lesSurcharges(), fin = Math.max(...ops.map((x) => x.quand));
      for (const [k, x] of Object.entries(s)) {
        if (x.c || x.quand > fin) continue;
        if (local || !commit) delete s[k]; else x.c = commit;
      }
      await BD.ecrire("@surcharges", s);
      return true;
    })().finally(() => { envoi = null; }));
  }

  // les impressions d'une carte dans la langue choisie (infos_cartes.rafraichir_prix, « imp_lang ») : lues sur Scryfall,
  // gardées une semaine (@langues) ; pas sur les données mobiles tant qu'on ne les a pas (la moins chère en anglais en
  // attendant). {nom: {« set|num »: {i: image, s, n, l: langue, d: date, u: Universes Beyond, p: promo}}}
  async function impressionsLangue(noms, lang) {
    const L = (await BD.lire("@langues").catch(() => null)) || {}, garde = L[lang] || (L[lang] = {}), semaine = Date.now() - 7 * 86400000;
    const jour = Date.now() - 86400000;                // rien trouvé : relu le lendemain (infos_cartes › perime)
    const manque = [...new Set(noms)].filter((n) => n && !(garde[n] && garde[n].t > (Object.keys(garde[n].eds).length ? semaine : jour)));
    if (manque.length && !mobile()) {
      const lus = Object.fromEntries(manque.map((n) => [n, {}])), parCle = new Map(manque.map((n) => [cle(n), n]));
      try {
        await rechercheGroupee(manque, `lang:${lang} game:paper`, { unique: "prints", include_extras: "false", order: "released", dir: "desc" }, (c) => {
          const n = parCle.get(cle(c.name));
          if (!n || c.digital || c.oversized || ["missing", "placeholder"].includes(c.image_status)
            || ["memorabilia", "token", "minigame"].includes(c.set_type)) return;          // infos_cartes._papier
          const img = (c.image_uris || (c.card_faces || [{}])[0].image_uris || {}).normal;
          if (img) lus[n][`${c.set}|${c.collector_number}`] = { i: img, s: c.set, n: c.collector_number, l: c.lang || lang,
            d: c.released_at || "", u: (c.promo_types || []).includes("universesbeyond") ? 1 : 0, p: c.promo ? 1 : 0 };
        }, null, 15);
        for (const n of manque) garde[n] = { t: Date.now(), eds: lus[n] };
        await BD.ecrire("@langues", L);
      } catch (_) { /* pas de réseau : la prochaine fois */ }
    }
    return Object.fromEntries(noms.filter((n) => garde[n]).map((n) => [n, garde[n].eds]));
  }

  // ------------------------------------------------------------------ sans PC : les pages faites ici
  const depot = async () => (await BD.lire("@depot").catch(() => null)) || { fichiers: {}, modifies: {} };
  // ce dont pages.js a besoin : les fiches (base de cartes, sinon Scryfall), les fonctions, les impressions choisies
  function outilsPages(f) {
    const avecBase = (fn, defaut) => (...a) => (etatBase.prete ? message(fn, a).catch(() => defaut) : Promise.resolve(defaut));
    return {
      fiches: async (noms) => {
        const lang = langueCartes(), locs = lang && etatBase.prete ? await impressionsLangue(noms, lang).catch(() => ({})) : {};
        const res = etatBase.prete ? await message("fiches", [noms, locs]).catch(() => ({})) : {};
        for (const n of noms) if (!res[n]) { const x = await ficheCarte(n).catch(() => null); if (x && x.image) res[n] = x; }
        return res;
      },
      fonctions: avecBase("fonctionsCartes", {}),
      impressionImage: avecBase("impressionImage", null),
      gcListe: avecBase("gameChangers", []),
      version: async (nom, ed, lang) => {
        const v = lang && lang !== "en" ? await uneImpression(ed.set, ed.num, lang).catch(() => null) : null;
        return v || (etatBase.prete ? await message("impression", [nom, ed.set, ed.num]).catch(() => null) : null)
          || await uneImpression(ed.set, ed.num, "en").catch(() => null);
      },
      suggestions: async (entrees, refus, combos = {}) => {
        const cl = Object.fromEntries(MOTEUR.lireClasseur(f["Classeur/classeur.txt"] || "").cartes);
        return etatBase.prete ? message("suggerer", [entrees, refus, cl, budget(), !!(window.REGLAGES || {}).sans_ub_suggestions, combos])
          .catch(() => ({ cartes: [], ecartees: refus })) : { cartes: [], ecartees: refus };
      },
      spellbook: spellbookConnu,
      budget: budget(),
      categories: PAGES.categories(f),
    };
  }
  // ------------------------------------------------------------------ Commander Spellbook, par le relais (bracket.spellbook)
  // Spellbook et la connexion GitHub refusent les pages web : un petit relais sans secret (outils/atelier/relais) les transmet.
  const RELAIS = "https://relais.atelier-mtg.workers.dev";
  async function relais(chemin, corps, ms = 60000) {
    if (navigator.onLine === false) throw new Error("pas de réseau");
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(RELAIS + chemin, { method: "POST", body: JSON.stringify(corps), headers: { "Content-Type": "application/json" }, signal: ctl.signal });
      if (!r.ok) throw new Error(`erreur ${r.status}`);
      return await r.json();
    } catch (e) {
      throw new Error(e.name === "AbortError" ? "trop long" : e instanceof TypeError ? "pas de réseau" : e.message);
    } finally { clearTimeout(t); }
  }
  // les analyses gardées (@spellbook) : {analyses: {clé de la liste: analyse}, dernier: {deck: clé}}, comme cache_spellbook.json
  const SB = "@spellbook";
  const lesAnalyses = async () => (await BD.lire(SB).catch(() => null)) || { analyses: {}, dernier: {} };
  async function cleListe(corps) {
    const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(JSON.stringify(corps)));
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // sans réseau : l'analyse de la liste actuelle (a_jour), sinon la dernière du deck (bracket.spellbook_connu)
  async function spellbookConnu(id, entrees) {
    const c = await lesAnalyses(), k = await cleListe(PAGES.corpsSpellbook(entrees));
    return c.analyses[k] ? { sb: c.analyses[k], a_jour: true } : { sb: c.analyses[c.dernier[id]] || null, a_jour: false };
  }
  async function analyserSpellbook(id, entrees) {
    const corps = PAGES.corpsSpellbook(entrees), k = await cleListe(corps);
    const [est, fmc] = await Promise.all([relais("/spellbook/estimate-bracket", corps), relais("/spellbook/find-my-combos", corps)]);
    const res = PAGES.analyse(est, fmc.results || {}, entrees);
    const c = await lesAnalyses();
    c.analyses[k] = res;
    c.dernier[id] = k;
    const gardees = new Set(Object.values(c.dernier));          // les 40 plus récentes, et la dernière de chaque deck
    for (const [x] of Object.entries(c.analyses).filter(([x]) => !gardees.has(x)).sort((a, b) => b[1].date - a[1].date).slice(40)) delete c.analyses[x];
    await BD.ecrire(SB, c);
  }
  // sans PC : la liste actuelle du deck analysée par Spellbook, puis sa page refaite. {fait, erreur}
  // fond : pas de nouvel essai avant 10 min après un échec (à la demande, on réessaie toujours)
  const analyses = new Map(), echecs = new Map();
  function assurerSpellbook(id, force = false, fond = false) {
    if (analyses.has(id)) return analyses.get(id);
    const p = (async () => {
      const texte = (await depot()).fichiers[`${id}/archidekt.txt`];
      if (texte == null) return { fait: false, erreur: null };
      const entrees = MOTEUR.lire(texte);
      if (!force && (await spellbookConnu(id, entrees)).a_jour) return { fait: false, erreur: null };
      if (fond && Date.now() - (echecs.get(id) || 0) < 600000) return { fait: false, erreur: "pas de réseau" };
      try { await analyserSpellbook(id, entrees); echecs.delete(id); }
      catch (e) { echecs.set(id, Date.now()); return { fait: false, erreur: e.message }; }
      await recalculer(null, new Set([id]));
      return { fait: true, erreur: null };
    })().finally(() => analyses.delete(id));
    analyses.set(id, p);
    return p;
  }
  // en fond, les decks pas encore analysés ; la page se refait si elle montre ce deck (sauf fenêtre ouverte)
  async function spellbookEnFond(ids) {
    for (const id of ids) {
      const r = await assurerSpellbook(id, false, true).catch(() => ({}));
      const h = location.hash, deck = `#/deck/${encodeURIComponent(id)}`;
      if (r.fait && window.route && T.pret && document.querySelector("#modale")?.hidden !== false
          && (h === "#/" || h === "" || h === `${deck}/bracket` || h === `${deck}/combos`)) route();
    }
  }
  // l'onglet Combos, vue « une carte » (combos.combos_carte) : les combos de Spellbook avec cette carte
  async function combosCarte(id, u) {
    const nom = u.searchParams.get("nom") || "", page = await api(`/api/decks/${encodeURIComponent(id)}`);
    const jeu = page.cartes.filter((c) => c.cat !== "Maybeboard"), cmds = jeu.filter((c) => c.cat === "Commander");
    const ident = cmds.length ? new Set(cmds.flatMap((c) => (c.info && c.info.couleurs) || [])) : null;
    const filtre = u.searchParams.get("couleurs") !== "0" ? ident : null;
    let res = [], erreur = null;
    try {
      const q = `card:"${cle(nom)}" legal:commander` + (filtre ? ` ci<=${[...filtre].sort().join("").toLowerCase() || "c"}` : "");
      res = (await relais("/spellbook/variants", { q })).results || [];
    } catch (e) { erreur = `Commander Spellbook ne répond pas : ${e.message}`; }
    const noms = [...new Set(res.flatMap((c) => (c.uses || []).map((x) => x.card.name)))];
    const I = noms.length ? await fiches(noms).catch(() => ({})) : {};
    return PAGES.combosCarte(nom, res, I, PAGES.dansDe(jeu.map((c) => c.nom)),
      filtre, new Set(page.cartes.filter((c) => c.cat === "Maybeboard").map((c) => c.nom)), erreur);
  }

  // ------------------------------------------------------------------ sans PC : la sauvegarde sur GitHub (synchro.py)
  // Le téléphone se connecte lui-même à GitHub (le code à recopier, comme sur le PC, par le relais) et range ses decks
  // dans le même dépôt privé que l'Atelier du PC : un PC les récupère ensuite (« Récupérer mes decks »), un autre
  // téléphone aussi. Synchroniser compare trois états : les fichiers du téléphone (@depot), ceux du dépôt et ceux de la
  // dernière synchronisation (@sauvegarde). Ce qui a changé d'un seul côté passe de l'autre ; changé des deux côtés, la
  // version du téléphone l'emporte et la liste d'en face entre dans l'historique du deck.
  const NOM_DEPOT = "atelier-mtg-sauvegarde";
  const DESCRIPTION = "Sauvegarde privée de l'Atelier MTG : decks et classeur (ne pas modifier à la main)";
  const LISEZMOI = "README.md";                       // synchro.TEXTE_LISEZMOI, à l'identique
  const TEXTE_LISEZMOI = "# Sauvegarde de l'Atelier MTG\n\nCe dépôt est **privé** : toi seul le vois. L'Atelier MTG y range une copie de tes decks (listes, versions,\nsimulations, discussions, achats) et de ton classeur, pour les retrouver si ton PC tombe en panne, ou sur un autre PC.\n\n- L'Atelier le tient à jour tout seul : ne modifie pas ces fichiers à la main.\n- Sur un autre PC : installe l'Atelier MTG, puis « Récupérer mes decks » sur sa page d'accueil.\n- Les photos rangées dans les dossiers des decks ne sont pas sauvegardées.\n";
  const GITHUB = "@github", SAUVEGARDE = "@sauvegarde";
  const CALME = 5000;                                 // ms sans modification avant d'envoyer : une série d'ajouts part une fois
  const leCompte = async () => (await BD.lire(GITHUB).catch(() => null)) || null;    // {jeton, compte, id}
  // l'état de la dernière synchronisation, s'il est celui de ce compte
  const lEtat = async (g) => { const e = (await BD.lire(SAUVEGARDE).catch(() => null)) || {}; return !g || e.compte === g.compte ? e : { voulue: e.voulue }; };
  async function ghCompte(jeton, methode, url, corps) {
    const r = await fetch(GH + url, { method: methode, cache: "no-store", body: corps ? JSON.stringify(corps) : undefined, headers: {
      Authorization: "Bearer " + jeton, "X-GitHub-Api-Version": "2022-11-28", Accept: "application/vnd.github+json",
      ...(corps ? { "Content-Type": "application/json" } : {}) } });
    if (r.status === 401) {
      await BD.effacer(GITHUB).catch(() => {});
      throw Object.assign(new Error("GitHub ne reconnaît plus ce téléphone : reconnecte-le."), { statut: 401 });
    }
    if (!r.ok) throw Object.assign(new Error(`GitHub ne répond pas (${r.status}).`), { statut: r.status });
    return r.status === 204 ? null : r.json();
  }
  async function shaBlob(texte) {                     // l'empreinte d'un fichier pour git (github.sha_blob)
    const o = new TextEncoder().encode(texte), t = new TextEncoder().encode(`blob ${o.length}\0`), tout = new Uint8Array(t.length + o.length);
    tout.set(t);
    tout.set(o, t.length);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-1", tout))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function texteDe(base64) {                          // le contenu d'un blob ; null s'il n'est pas du texte (une photo)
    const s = atob(base64.replace(/\s/g, "")), o = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(o); } catch (_) { return null; }
  }

  // se connecter : un code à recopier sur github.com/login/device (github.connecter, etat_connexion). La connexion en
  // cours est gardée : l'appli peut être rouverte pendant qu'on est sur GitHub (iPhone), elle la finit alors seule
  const FLUX = "telephone-connexion-github";
  let flux = (() => { try { const f = JSON.parse(lireLocal(FLUX) || "null"); return f && Date.now() < f.expire ? f : null; } catch (_) { return null; } })();
  const garderFlux = () => ecrireLocal(FLUX, flux && flux.etat === "attente" ? JSON.stringify({ ...flux, demande: false }) : null);
  async function connecterGithub() {
    const c = await relais("/github/code", {}).catch((e) => { throw new Error(`GitHub ne répond pas : ${e.message}`); });
    if (!c.device_code) throw new Error(c.error_description || "GitHub ne répond pas.");
    const pas = (c.interval || 5) * 1000;
    flux = { code: c.device_code, pas, prochain: Date.now() + pas, expire: Date.now() + (c.expires_in || 900) * 1000, etat: "attente" };
    garderFlux();
    return { etat: "attente", code: c.user_code, url: c.verification_uri };
  }
  async function etatConnexion() {
    const f = flux;
    if (!f) return { etat: "erreur", erreur: "Aucune connexion en cours." };
    if (f.etat === "attente" && Date.now() > f.expire) f.etat = "expire";
    if (f.etat === "attente" && !f.demande && Date.now() >= f.prochain) {
      f.demande = true;
      try {
        const r = await relais("/github/jeton", { device_code: f.code });
        f.prochain = Date.now() + f.pas;
        if (r.access_token) {
          const moi = await ghCompte(r.access_token, "GET", "/user");
          await BD.ecrire(GITHUB, { jeton: r.access_token, compte: moi.login, id: moi.id });
          Object.assign(f, { etat: "ok", compte: moi.login });
        } else if (r.error === "slow_down") f.pas += 5000;
        else if (r.error === "access_denied") f.etat = "refus";
        else if (r.error === "expired_token") f.etat = "expire";
        else if (r.error !== "authorization_pending") Object.assign(f, { etat: "erreur", erreur: r.error_description || r.error || "Connexion impossible." });
      } catch (_) { f.prochain = Date.now() + f.pas; }   // pas de réseau : on réessaie
      finally { f.demande = false; garderFlux(); }
    }
    return { etat: f.etat, compte: f.compte || null, erreur: f.erreur || "" };
  }
  async function reprendreConnexion() {
    while (flux && flux.etat === "attente" && Date.now() < flux.expire) {
      await new Promise((ok) => setTimeout(ok, 2000));
      await etatConnexion();
    }
    if (flux && flux.etat === "ok") {
      await sauvegarderEnFond();
      if (window.route && document.querySelector("#modale")?.hidden !== false) route();
    }
  }

  // le dépôt de sauvegarde du compte : {depot, branche, id}, créé (privé) s'il n'existe pas et creer ; null sinon
  async function leDepot(q, g, creer) {
    let r;
    try { r = await q("GET", `/repos/${g.compte}/${NOM_DEPOT}`); }
    catch (e) {
      if (e.statut !== 404) throw e;
      if (!creer) return null;
      r = await q("POST", "/user/repos", { name: NOM_DEPOT, private: true, description: DESCRIPTION, auto_init: true,
        has_issues: false, has_projects: false, has_wiki: false });
    }
    if (!r.private) throw new Error(`Ton dépôt GitHub « ${NOM_DEPOT} » est public : l'Atelier n'y range pas ta sauvegarde. Rends-le privé sur GitHub (Settings › Danger Zone), ou supprime-le.`);
    return { depot: r.full_name, branche: r.default_branch, id: r.id };
  }
  // le dernier commit : {tete, arbre, distant: {chemin: empreinte}, date} ; attend un dépôt tout juste créé
  async function laTete(q, d) {
    for (let essai = 0; ; essai++) {
      try {
        const tete = (await q("GET", `/repos/${d.depot}/git/ref/heads/${d.branche}`)).object.sha;
        const c = await q("GET", `/repos/${d.depot}/git/commits/${tete}`);
        const t = await q("GET", `/repos/${d.depot}/git/trees/${c.tree.sha}?recursive=1`);
        const distant = {};
        for (const x of t.tree) if (x.type === "blob") distant[x.path] = x.sha;
        return { tete, arbre: c.tree.sha, distant, date: c.committer && c.committer.date };
      } catch (e) {
        if (![404, 409].includes(e.statut) || essai === 7) throw e;
        await new Promise((ok) => setTimeout(ok, 2000));
      }
    }
  }
  // ce qu'il y a dans la sauvegarde, sans rien télécharger (« Récupérer mes decks »)
  async function sauvegardeDistante() {
    const g = await leCompte();
    if (!g) throw Object.assign(new Error("Connecte ce téléphone à GitHub."), { statut: 401 });
    const q = (m, u, c) => ghCompte(g.jeton, m, u, c), d = await leDepot(q, g, false);
    if (!d) return { existe: false, decks: [] };
    const { distant, date } = await laTete(q, d);
    const noms = [...new Set(Object.keys(distant).filter((p) => p.startsWith("Deck ") && p.split("/").length === 2 && p.endsWith("/archidekt.txt"))
      .map((p) => p.split("/")[0]))].sort();
    return { existe: noms.length > 0, decks: noms.map((n) => n.slice(5)), date };
  }

  // un seul à la fois : les modifications faites ici (envoyerLocal) et la synchronisation touchent aux mêmes fichiers
  let verrouDepot = Promise.resolve();
  const avecVerrou = (fn) => { const p = verrouDepot.then(fn); verrouDepot = p.catch(() => {}); return p; };
  let sauvegarde = null, erreurSauvegarde = "";
  // synchroniser : {envoyes, recus, conflits, decks, decks_recus} ; {vide: true} sans dépôt quand creer est faux
  function sauvegarder(creer = true) {
    return sauvegarde || (sauvegarde = avecVerrou(() => synchroniserGithub(creer))
      .then((r) => { erreurSauvegarde = ""; return r; }, (e) => { erreurSauvegarde = e.message; throw e; })
      .finally(() => { sauvegarde = null; }));
  }
  async function synchroniserGithub(creer) {
    const g = await leCompte();
    if (!g) throw Object.assign(new Error("Connecte ce téléphone à GitHub (compte gratuit)."), { statut: 401 });
    const q = (m, u, c) => ghCompte(g.jeton, m, u, c), d = await leDepot(q, g, creer);
    if (!d) return { vide: true };
    let e = await lEtat(g);
    if (e.id !== d.id) e = { voulue: e.voulue, fichiers: {} };   // autre dépôt (premier passage, ou refait) : rien de connu
    Object.assign(e, d, { compte: g.compte });
    for (let essai = 0; essai < 3; essai++) {
      const { tete, arbre, distant } = await laTete(q, d);
      const lisezmoi = distant[LISEZMOI];
      delete distant[LISEZMOI];
      if (e.commit && tete !== e.commit) {               // le dernier commit connu a disparu (dépôt refait) : on repart de zéro
        try { await q("GET", `/repos/${d.depot}/git/commits/${e.commit}`); }
        catch (x) { if (![404, 422].includes(x.statut)) throw x; Object.assign(e, { commit: null, fichiers: {} }); }
      }
      const avant = e.commit ? e.fichiers : {}, dep = await depot(), ici = {};
      for (const [rel, t] of Object.entries(dep.fichiers)) ici[rel] = await shaBlob(t);
      for (const rel of e.ignores || []) if (rel in distant) ici[rel] = distant[rel];   // les photos : pas sur le téléphone
      const envois = [], retraits = [], recus = [], effaces = [], conflits = [];
      for (const rel of [...new Set([...Object.keys(ici), ...Object.keys(distant), ...Object.keys(avant)])].sort()) {
        const l = ici[rel] ?? null, r = distant[rel] ?? null, b = avant[rel] ?? null;
        if (l === r) continue;
        if (l === b) (r === null ? effaces : recus).push(rel);              // changé sur GitHub seulement
        else if (r === b) (l === null ? retraits : envois).push(rel);       // changé ici seulement
        else if (l === null) recus.push(rel);                                // supprimé ici, changé là-bas : il revient
        else { envois.push(rel); if (r !== null) conflits.push(rel); }      // changé des deux côtés : celui d'ici gagne
      }
      // 1. ce qui part : un seul commit
      let nouveau = tete;
      const entrees = envois.map((rel) => ({ path: rel, mode: "100644", type: "blob", content: dep.fichiers[rel] }));
      for (const rel of retraits) entrees.push({ path: rel, mode: "100644", type: "blob", sha: null });
      if (lisezmoi !== await shaBlob(TEXTE_LISEZMOI)) entrees.push({ path: LISEZMOI, mode: "100644", type: "blob", content: TEXTE_LISEZMOI });
      if (entrees.length) {
        let base = arbre, lot = [], taille = 0;
        const lots = [];
        for (const x of entrees) {                       // par lots, comme synchro._nouvel_arbre
          const n = (x.content || "").length + 200;
          if (lot.length && (taille + n > 2000000 || lot.length >= 400)) { lots.push(lot); lot = []; taille = 0; }
          lot.push(x);
          taille += n;
        }
        if (lot.length) lots.push(lot);
        for (const l of lots) base = (await q("POST", `/repos/${d.depot}/git/trees`, { base_tree: base, tree: l })).sha;
        const t = new Date(), quand = `${date2(t.getDate())}/${date2(t.getMonth() + 1)}/${t.getFullYear()} ${date2(t.getHours())}:${date2(t.getMinutes())}`;
        nouveau = (await q("POST", `/repos/${d.depot}/git/commits`, { message: `Sauvegarde du ${quand} (téléphone)`, tree: base, parents: [tete] })).sha;
        try { await q("PATCH", `/repos/${d.depot}/git/refs/heads/${d.branche}`, { sha: nouveau }); }
        catch (x) { if (x.statut === 422 && essai < 2) continue; throw x; }   // un autre appareil a envoyé entre-temps
      }
      // 2. ce qui arrive ; la liste d'en face, quand celle d'ici l'emporte, dans l'historique du deck
      const lus = new Map(), ignores = new Set(e.ignores || []);
      const aLire = [...recus, ...conflits.filter((rel) => rel.endsWith("/archidekt.txt"))];
      for (let i = 0; i < aLire.length; i += 6) {
        await Promise.all(aLire.slice(i, i + 6).map(async (rel) => {
          const t = texteDe((await q("GET", `/repos/${d.depot}/git/blobs/${distant[rel]}`)).content);
          if (t === null) ignores.add(rel); else lus.set(rel, t);
        }));
      }
      const f = dep.fichiers, touches = new Set(), avantDecks = new Set(PAGES.decksDe(f));
      dep.modifies = dep.modifies || {};
      for (const rel of recus) {
        if (!lus.has(rel)) continue;
        f[rel] = lus.get(rel);
        touches.add(rel.split("/")[0]);
        if (rel.endsWith("/archidekt.txt")) dep.modifies[rel.split("/")[0]] = Date.now() / 1000;
      }
      for (const rel of conflits) {
        if (!rel.endsWith("/archidekt.txt") || !lus.has(rel)) continue;
        const deck = rel.split("/")[0], nom = `${horodatage()}_autre-appareil.txt`, jf = `${deck}/historique/journal.json`;
        f[`${deck}/historique/${nom}`] = lus.get(rel);
        let j = {};
        try { j = JSON.parse(f[jf] || "{}"); } catch (_) {}
        j[nom] = "Liste d'un autre appareil (sauvegarde en ligne)";
        f[jf] = JSON.stringify(j, null, 1);
        touches.add(deck);
      }
      // 3. ce qui a disparu là-bas (sans avoir changé ici) : retiré ici aussi
      for (const rel of effaces) { delete f[rel]; touches.add(rel.split("/")[0]); }
      for (const id of Object.keys(dep.modifies)) if (!(`${id}/archidekt.txt` in f)) delete dep.modifies[id];
      if (touches.size) await BD.ecrire("@depot", dep);
      const fichiers = { ...distant };
      for (const rel of envois) fichiers[rel] = ici[rel];
      for (const rel of retraits) delete fichiers[rel];
      const nb = new Set(Object.keys(fichiers).filter((rel) => rel.startsWith("Deck ")).map((rel) => rel.split("/")[0])).size;
      Object.assign(e, { commit: nouveau, fichiers, derniere: Date.now() / 1000, decks: nb, ignores: [...ignores] });
      await BD.ecrire(SAUVEGARDE, e);
      if (touches.size) await recalculer(null, touches);
      if (conflits.length) setTimeout(() => planifierSauvegarde(1000));   // la liste d'en face, gardée dans l'historique, part aussi
      return { envoyes: envois.length + retraits.length, recus: recus.length, decks: nb,
        conflits: [...new Set(conflits.filter((rel) => rel.endsWith("/archidekt.txt")).map((rel) => rel.split("/")[0]))].sort(),
        decks_recus: PAGES.decksDe(f).filter((x) => !avantDecks.has(x)).sort() };
    }
    throw new Error("La sauvegarde n'a pas pu s'enregistrer : réessaie.");
  }
  // en fond : après une série de modifications, au lancement, et un coup d'œil toutes les cinq minutes (un autre
  // appareil a pu changer un deck) ; la page se refait si des fichiers sont arrivés
  let minuteurSauvegarde = null;
  async function sauvegarderEnFond() {
    const g = await leCompte();
    if (!g || (await lEtat(g)).voulue === false) return;
    const r = await sauvegarder().catch(() => null);
    if (r && r.recus && window.route && T.pret && document.querySelector("#modale")?.hidden !== false) route();
  }
  function planifierSauvegarde(ms = CALME) {
    clearTimeout(minuteurSauvegarde);
    minuteurSauvegarde = setTimeout(sauvegarderEnFond, ms);
  }
  async function etatSauvegarde() {
    const g = await leCompte(), e = await lEtat(g), voulue = e.voulue !== false;
    return { connecte: !!g, compte: g ? g.compte : null, prive: !!g, voulue, active: !!g && voulue, en_cours: !!sauvegarde,
      derniere: e.derniere || null, erreur: g ? erreurSauvegarde : "", url: e.depot ? `https://github.com/${e.depot}` : null, decks: e.decks ?? null };
  }
  // les demandes de l'écran GitHub de l'Atelier (app.py › api_github, api_sauvegarde…)
  async function routeGithub(p, methode, b) {
    const g = await leCompte(), compte = () => leCompte().then((x) => ({ compte: x ? x.compte : null, git: null, disponible: true, prive: !!x }));
    if (methode === "GET") {
      if (p === "/api/github") return compte();
      if (p === "/api/github/connexion") return etatConnexion();
      if (p === "/api/sauvegarde") return etatSauvegarde();
      if (p === "/api/sauvegarde/distante") return sauvegardeDistante();
      return undefined;
    }
    if (p === "/api/github/connexion") return connecterGithub();
    if (p === "/api/github/deconnexion") { flux = null; garderFlux(); await BD.effacer(GITHUB); return compte(); }
    if (p === "/api/sauvegarde" || p === "/api/sauvegarde/recuperer") {
      const action = p.endsWith("/recuperer") ? "activer" : b.action || "maintenant", e = await lEtat(g);
      if (action === "couper" || action === "activer") await BD.ecrire(SAUVEGARDE, { ...e, voulue: action !== "couper" });
      if (action === "couper") return { etat: await etatSauvegarde() };
      return { resume: await sauvegarder(!p.endsWith("/recuperer")), etat: await etatSauvegarde() };
    }
    return undefined;
  }

  // les pages des decks touchés (tous si touches est vide), puis l'accueil, rangées comme celles du PC ; une seule à la
  // fois (d vide : les fichiers du téléphone au moment du calcul)
  let calculs = Promise.resolve();
  function recalculer(d, touches = null) {
    const p = calculs.then(async () => recalculerMaintenant(d || await depot(), touches));
    calculs = p.catch(() => {});
    return p;
  }
  async function recalculerMaintenant(d, touches) {
    const f = d.fichiers, o = outilsPages(f), ids = PAGES.decksDe(f);
    const ancien = (await fichier("index.json.gz")) || { decks: {} }, pages = {}, decks = {};
    for (const id of ids) {
      const k = "decks/" + id;
      if (!touches || touches.has(id) || !ancien.decks[id]) {
        pages[id] = await PAGES.deck(id, f, { ...o, modifie: (d.modifies || {})[id] || 0 });
        await BD.ecrire(k, { sha: "local", donnees: pages[id] });
      } else pages[id] = await fichier(k);
      decks[id] = k;
    }
    for (const k of await BD.cles()) if (String(k).startsWith("decks/") && !Object.values(decks).includes(k)) await BD.effacer(k);
    const api = await PAGES.index(f, pages, o);
    api["/api/options"] = options();
    await BD.ecrire("index.json.gz", { sha: "local", donnees: { format: FORMAT, date: Date.now() / 1000, version: "", compte: null,
      reglages: window.REGLAGES, decks, api, source: null, branche: null, local: true } });
    memoire.clear();
    fusion = null;
    connus = null;
    setTimeout(() => spellbookEnFond(touches ? [...touches] : ids), 1000);
  }
  // « Commencer ici » : un Atelier sur ce téléphone, sans PC ni compte
  async function commencerIci() {
    ecrireLocal(LOCAL, "1");
    local = true;
    if (!(await BD.lire("@depot").catch(() => null))) await BD.ecrire("@depot", { fichiers: {}, modifies: {} });
    window.REGLAGES = { budget: 5, sans_ub_illustrations: false, ...(window.REGLAGES || {}) };
    ecrireLocal(REGLAGES, JSON.stringify(window.REGLAGES));
    await recalculer(await depot());
    location.hash = "#/";
    location.reload();
  }

  // les versions d'un deck : enregistrer la liste actuelle sous un nom, en supprimer une, revenir à une version
  const date2Iso = (t = new Date()) => `${t.getFullYear()}-${date2(t.getMonth() + 1)}-${date2(t.getDate())}T${date2(t.getHours())}:${date2(t.getMinutes())}:${date2(t.getSeconds())}`;
  async function sauverVersion(id, b) {
    const nom = String(b.nom || "").trim();
    if (!nom) throw new Error("donne un nom à la version");
    const slug = nom.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "version";
    const fichier = `versions/${horodatage()}_${slug}.txt`, note = String(b.note || "").trim(), page = await api(`/api/decks/${id}`);
    const vs = await api(`/api/decks/${id}/versions`).catch(() => []);
    await surcharger({ [`/api/decks/${id}/versions`]: [{ fichier, type: "nommee", nom, note, date: Date.now() / 1000, total: page.total, plus: [], moins: [] }, ...vs] });
    await enAttente({ f: "version", deck: id, nom, note, fichier, date: date2Iso() });
    return { fichier };
  }
  async function supprimerVersion(id, fichier) {
    if (!String(fichier).startsWith("versions/")) throw new Error("seules les versions nommées peuvent être supprimées");
    const vs = await api(`/api/decks/${id}/versions`).catch(() => []);
    await surcharger({ [`/api/decks/${id}/versions`]: vs.filter((v) => v.fichier !== fichier) });
    await enAttente({ f: "supprimerVersion", deck: id, fichier });
    return { ok: true };
  }
  async function restaurer(id, fichier) {
    const texte = local ? (await depot()).fichiers[`${id}/${fichier}`] : await contenu(`${id}/${fichier}`, ((await fichier_("index.json.gz")) || {}).branche || "main");
    if (texte == null) throw new Error(`version introuvable : ${fichier}`);
    const v = ((await api(`/api/decks/${id}/versions`).catch(() => [])).find((x) => x.fichier === fichier) || {}).nom || fichier;
    const prec = await api(`/api/decks/${id}`), entrees = MOTEUR.lire(texte), infos = {};
    for (const e of entrees) if (!prec.cartes.some((c) => c.nom === e.nom)) infos[e.nom] = await ficheCarte(e.nom);
    const page = MOTEUR.page(id, entrees, prec, infos, budget());
    await surcharger({ [`/api/decks/${id}`]: page, [`/api/decks/${id}/export?format=archidekt`]: MOTEUR.texte(entrees) });
    await enAttente({ f: "restaurer", deck: id, fichier, raison: `retour à « ${v} »` });
    return copie(page);
  }
  const fichier_ = (k) => fichier(k);

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
    connus = null;
    return BD.vider().catch(() => {});
  }
  function oublier() {
    acces = null;
    ecrireLocal(ACCES, null);
    ecrireLocal(COMMIT, null);
    memoire.clear();
    fusion = null;
    connus = null;
    T.pret = false;
    T.arrete = false;
    bandeauArrete();
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
  // relié au PC : le PC a arrêté l'appli du téléphone (Options › Téléphone › Arrêter). Ses decks restent lisibles ici,
  // sans modification possible ; relancée sur le PC, l'appli reprend toute seule
  function bandeauArrete() {
    let b = document.getElementById("tel-arrete");
    if (!T.arrete || !acces || !document.body) { if (b) b.remove(); return; }
    const installer = document.getElementById("tel-bandeau");
    if (installer) installer.remove();
    if (!b) {
      b = document.createElement("div");
      b.id = "tel-arrete";
      b.className = "tel-bandeau";
      b.setAttribute("role", "status");
      document.body.appendChild(b);
    }
    b.innerHTML = `<div class="tel-bandeau-texte"><strong>Ton PC n'envoie plus tes decks</strong></div>
      <div class="tel-bandeau-boutons"><button class="btn btn-danger btn-petit" id="tel-arrete-delier">Délier ce téléphone</button></div>`;
    b.querySelector("#tel-arrete-delier").onclick = () => { if (confirm("Délier ce téléphone ? Ses decks en seront effacés.")) T.delier(); };
  }

  function bandeauInstaller() {
    if (installee() || !acces || !document.body || T.arrete) return;
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
        <button class="btn btn-accent" id="tel-commencer">Commencer ici</button>
        <button class="btn" id="tel-scanner">Scanner le QR code du PC</button>
        <p class="muet petit">Sur le PC : Atelier › Options › Téléphone.</p>
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
      el.querySelector("#tel-commencer").onclick = (ev) => { ev.currentTarget.disabled = true; commencerIci().catch((err) => erreur(err.message)); };
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
  // la base de cartes : celle gardée ici, puis la nouvelle si elle a changé ; la première fois, hors données mobiles
  function preparerBase() {
    setTimeout(async () => {
      try {
        if (await BD.lire("@base").catch(() => null)) await laBase().then(() => nouvelleBase());
        else if (!mobile()) await laBase();
      } catch (_) { /* pas de réseau : elle arrivera plus tard */ }
    }, 1500);
  }

  async function demarrer() {
    preparerBase();
    if (local) {                                          // sans PC : tout est ici
      bandeauInstaller();
      envoyer().catch(() => {});
      try { await synchroniser(); T.erreur = ""; } catch (err) { T.erreur = err.message; }
      T.pret = true;
      if (window.route) route();
      setTimeout(async () => spellbookEnFond(PAGES.decksDe((await depot()).fichiers)), 3000);
      sauvegarderEnFond();
      if (flux) reprendreConnexion();
      return;
    }
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
    bandeauArrete();
  }

  const T = window.TELEPHONE = {
    api, attente: attenteVue, pret: false, erreur: "", arrete: false, appliGithub: APPLI_GITHUB,
    enAttente: async () => (await attente()).length,
    envoyer: () => envoyer(),
    acces: () => acces && { depot: acces.d },
    local,
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
  // sans PC : la sauvegarde sur GitHub regarde aussi s'il y a du nouveau
  document.addEventListener("visibilitychange", () => { if (!document.hidden && local) planifierSauvegarde(500); });
  setInterval(() => { if (!document.hidden && local) sauvegarderEnFond(); }, DISTANT);
})();
