// L'Atelier dans le navigateur et sur téléphone : pas de serveur Python ici. On se connecte à son compte
// (api.atelier-mtg.com, code reçu par e-mail). Les decks sont gardés ici (IndexedDB, « @depot », rangés comme les dossiers
// de l'Atelier du PC) et synchronisés avec le compte : l'appli s'ouvre aussitôt, même sans réseau, puis envoie et reçoit
// ce qui a changé. Leurs pages sont faites ici (pages.js). Chargé avant app.js, qui passe toutes ses demandes par
// TELEPHONE.api, comme une page partagée lit ses données figées.
(() => {
  const FORMAT = 1;                                   // format des pages gardées ici (index.json.gz)
  const CORBEILLE = "Corbeille Atelier";               // decks.CORBEILLE
  const REGLAGES = "telephone-reglages";
  const DISTANT = 5 * 60 * 1000;                      // coup d'œil au compte toutes les cinq minutes, appli ouverte
  // voir/ (lien instantané d'un deck) : ce script y fait la page du deck, puis charge app.js (VOIR : son adresse) en
  // page partagée, sans démarrer l'appli. ICI : le dossier de l'appli, pour ses fichiers (worker, base), d'où que l'on soit
  const VOIR = window.ATELIER_VOIR || "", ICI = new URL(".", document.currentScript.src).href;
  const BASE_CARTES = new URL("__BASE_CARTES__", ICI).href;     // la base de cartes publiée (telephone_site.py)
  // ORDI : l'appli sur un grand écran à la souris (telephone_site.py › habillage) ; ses decks sont alors dans « ce navigateur »
  const ORDI = document.documentElement.classList.contains("ordinateur"), CET_APPAREIL = ORDI ? "ce navigateur" : "ce téléphone";
  if (!VOIR && !ORDI) document.documentElement.classList.add("telephone");

  const lireLocal = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const ecrireLocal = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} };
  // le compte : {email, jeton} ; « atelier-api » : l'adresse d'un serveur d'essai
  const COMPTE = "atelier-compte", API_COMPTE = lireLocal("atelier-api") || "https://api.atelier-mtg.com";
  const lireCompte = () => { try { const c = JSON.parse(lireLocal(COMPTE) || "null"); return c && c.email && c.jeton ? c : null; } catch (_) { return null; } };
  let compte = VOIR ? null : lireCompte();
  // l'en-tête (app.js › menuCompte) : connecté ou non, et l'initiale du pseudo, dès le premier affichage (comme les pages
  // du site, site_atelier.py › TETE_COMPTE)
  function marquerCompte() {
    const h = document.documentElement;
    h.classList.toggle("connecte", !!compte);
    if (compte && compte.pseudo) h.style.setProperty("--initiale", JSON.stringify(compte.pseudo[0].toUpperCase()));
    else h.style.removeProperty("--initiale");
  }
  if (!VOIR) marquerCompte();
  // d'avant les comptes : des decks gardés seulement ici (« Commencer »), ou reçus d'un PC relié par QR code
  const ANCIEN_LOCAL = !compte && lireLocal("telephone-local") === "1";
  // les decks d'une ancienne adresse de l'appli (demenagement.html), gardés ici jusqu'à la connexion au compte
  const DEMENAGEMENT = "@demenagement", DEMENAGE = "atelier-demenagement";
  const ANCIEN_PC = !compte && (!!lireLocal("telephone-acces") || location.hash.includes("#appairer="));
  if (location.hash.includes("#appairer=")) history.replaceState(null, "", location.pathname + location.search);
  // connecté : les decks sont ici (@depot) et leurs pages faites ici
  let local = !!compte;
  let enConnexion = false, suivi = null;              // seConnecter : la synchronisation sans calcul, puis l'avancement des pages
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

  // ------------------------------------------------------------------ le serveur des comptes (outils/serveur)
  // Ses réponses, demandées compressées (?gz=1) : le proxy de l'hébergeur ne compresse pas le JSON, et les fichiers et
  // les pages d'un compte pèsent six fois moins ainsi. Elles arrivent alors en application/octet-stream.
  const GZ = typeof DecompressionStream === "function";
  const avecGz = (chemin) => (GZ ? chemin + (chemin.includes("?") ? "&" : "?") + "gz=1" : chemin);
  const lireJson = (r) => (r.ok && (r.headers.get("Content-Type") || "").startsWith("application/octet-stream")
    ? new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).json() : r.json());
  async function serveur(chemin, methode = "GET", corps = null) {
    let r;
    try {
      r = await fetch(API_COMPTE + avecGz(chemin), { method: methode, cache: "no-store", body: corps ? JSON.stringify(corps) : undefined,
        headers: { ...(compte ? { Authorization: "Bearer " + compte.jeton } : {}), ...(corps ? { "Content-Type": "application/json" } : {}) } });
    } catch (_) { throw Object.assign(new Error("Pas de réseau : réessaie dans un moment."), { statut: 0 }); }
    const d = await lireJson(r).catch(() => ({}));
    if (r.status === 401 && compte && !chemin.startsWith("/connexion/")) deconnecte(false);   // appareil retiré du compte
    if (!r.ok) throw Object.assign(new Error(d.erreur || `Le serveur ne répond pas (${r.status}).`), { statut: r.status });
    return d;
  }

  // les pages des decks : faites ici si elles manquent ; true si elles viennent d'être faites
  let enCours = null;
  function synchroniser() {
    return enCours || (enCours = (async () => {
      if (!(await fichier("index.json.gz"))) { await recalculer(await depot(), null, true); return true; }
      return false;
    })().finally(() => { enCours = null; }));
  }

  // ------------------------------------------------------------------ les demandes de l'interface (app.js › api)
  // même clé que les pages partagées : chemin décodé, paramètres triés
  const cleDe = (u) => {
    const p = [...u.searchParams].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return decodeURIComponent(u.pathname) + (p.length ? "?" + p.map(([k, v]) => `${k}=${v}`).join("&") : "");
  };
  const copie = (x) => (x == null ? x : structuredClone(x));
  const absente = () => Object.assign(new Error("À faire depuis l'Atelier de ton PC."), { statut: 404 });
  // les tests du simulateur faits sur le PC, venus par la sauvegarde : comme simulation.rapports
  function rapportsSimulation(f, pre) {
    return Object.keys(f).filter((k) => k.startsWith(pre) && k.endsWith(".json") && !k.slice(pre.length).includes("/")).sort().reverse()
      .map((k) => {
        let r;
        try { r = JSON.parse(f[k]); } catch (_) { return null; }
        if (!r || !r.tables || !r.resultats) return null;
        const t0 = r.tables.includes("Mixte") ? "Mixte" : r.tables[0], l = r.resultats[t0] || {}, A = l.A || {}, B = l.B || {};
        return { fichier: k.slice(pre.length), date: r.date, n: r.n, tables: r.tables, pilote: (r.reglages || {}).pilote || "vite",
          versions: Object.fromEntries(Object.entries(r.versions || {}).map(([x, v]) => [x, v.nom])), table_resume: t0, affine: r.affine ?? true,
          verdict: (A.regularite || {}).verdict, verdict_b: (B.regularite || {}).verdict, victoire_a: A.victoire,
          victoire_b: B.victoire, ecart: l.ecart };
      }).filter(Boolean);
  }

  // ------------------------------------------------------------------ le simulateur, ici (comme simulation.py)
  // Python compilé en WebAssembly (Pyodide), dans un Worker (simulateur.js), avec les fichiers du simulateur du PC
  // (simu_navigateur.py). Mêmes listes, mêmes graines, mêmes fiches Scryfall : mêmes parties que sur le PC. Le rapport et
  // les listes jouées vont dans le dossier du deck (simulations/), puis sur le compte, comme le reste.
  const SIMU = new URL("__SIMU__", ICI).href;                           // simulateur.js?v=… (telephone_site.py)
  const SIMU_FICHIERS = Object.fromEntries(Object.entries(__SIMU_FICHIERS__).map(([n, u]) => [n, new URL(u, ICI).href]));
  const SIMU_OPTIONS = __SIMU_OPTIONS__;                                // {tables, defaut, test_n, morceau}
  const FICHES_SIMU = "@simu-fiches";                                   // les fiches lues sur Scryfall : cache_cartes.json
  const travaux = new Map();
  let simuW = null, simuN = 0;
  const simuAttente = new Map();
  function simu(f, ...a) {
    if (!simuW) {
      simuW = new Worker(new URL(SIMU, ICI));
      simuW.onmessage = (ev) => {
        const x = simuAttente.get(ev.data.n);
        if (!x) return;
        simuAttente.delete(ev.data.n);
        if ("e" in ev.data) x.ko(new Error(ev.data.e)); else x.ok(ev.data.r);
      };
      simuW.onerror = () => {
        for (const x of simuAttente.values()) x.ko(new Error("Le simulateur s'est arrêté : recharge l'appli."));
        simuAttente.clear();
        simuW = null;
      };
    }
    return new Promise((ok, ko) => { const n = ++simuN; simuAttente.set(n, { ok, ko }); simuW.postMessage({ n, f, a }); });
  }
  // simulateur.json, dans le dossier du deck : {reglages, cartes} (écrit par Claude sur le PC) ; pilote.json, l'ancien
  function simulateurDe(f, id) {
    try { const d = JSON.parse(f[`${id}/simulateur.json`] || "{}"); return d && typeof d === "object" ? d : {}; } catch (_) { return {}; }
  }
  function textesSim(f, id) {
    const c = simulateurDe(f, id).cartes;
    return c && typeof c === "object" ? Object.fromEntries(Object.entries(c).filter(([k, v]) => typeof v === "string" && v.trim())) : {};
  }
  function reglagesSim(f, id) {
    const r = { ...SIMU_OPTIONS.defaut };
    let d = simulateurDe(f, id).reglages;
    if (!d || typeof d !== "object") { try { d = JSON.parse(f[`${id}/pilote.json`] || "{}"); } catch (_) { d = {}; } }
    for (const k of Object.keys(r)) if (d && k in d) r[k] = d[k];
    return r;
  }
  function libelleSim(f, id, fichier) {                                  // decks.libelle
    if (!fichier) return "Liste actuelle";
    const b = fichier.split("/").pop();
    let meta = {};
    try { meta = JSON.parse(f[`${id}/versions/versions.json`] || "{}") || {}; } catch (_) {}
    if (fichier.startsWith("versions/") && meta[b]) return meta[b].nom;
    if (fichier.startsWith("historique/")) {
      const m = b.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})\d{2}(?:_\d+)?\.txt$/);
      return m ? `Historique du ${m[1]} ${m[2]}:${m[3]}` : "Historique : " + b.replace(/\.[^.]*$/, "");
    }
    return b.replace(/\.[^.]*$/, "").replace(/_/g, " ");
  }
  function suiviTravail(j) {                                             // simulation.suivi
    const ecoule = Date.now() / 1000 - j.debut, reste = j.fait ? ecoule / j.fait * (j.total - j.fait) : null;
    const { annule, ...x } = j;
    return { ...x, ecoule: Math.round(ecoule), reste: reste ? Math.round(reste) : null };
  }
  async function simulerIci(id, b) {                                    // simulation.lancer
    const f = (await depot()).fichiers;
    if (f[`${id}/archidekt.txt`] == null) throw Object.assign(new Error("Deck introuvable."), { statut: 404 });
    const tables = (b.tables || []).filter((t) => SIMU_OPTIONS.tables.includes(t));
    if (!tables.length) tables.push("Mixte");
    const n = Math.max(10, Math.min(parseInt(b.n, 10) || 1000, 20000));
    const reglages = reglagesSim(f, id);
    for (const [k, v] of Object.entries(b.reglages || {})) if (k in SIMU_OPTIONS.defaut) reglages[k] = v;
    const versions = [["A", b.a || ""], ...(b.b != null ? [["B", b.b]] : [])], listes = {};
    for (const [cle, fichier] of versions) {
      listes[cle] = f[`${id}/${fichier || "archidekt.txt"}`];
      if (listes[cle] == null) throw new Error("Version introuvable.");
    }
    const j = { id: Math.random().toString(36).slice(2, 10), deck: id, statut: "en_cours", fait: 0,
      total: n * tables.length * versions.length, debut: Date.now() / 1000, erreur: null, rapport: null, annule: false, etape: "" };
    travaux.set(j.id, j);
    simuler(j, f, id, versions, listes, tables, n, reglages, textesSim(f, id))
      .catch((e) => Object.assign(j, e.annule ? { statut: "annule" } : { statut: "erreur", erreur: e.message }));
    return suiviTravail(j);
  }
  async function simuler(j, f, id, versions, listes, tables, n, reglages, txt) {   // simulation._execute
    const stamp = horodatage(), garde = () => { if (j.annule) throw Object.assign(new Error("annulé"), { annule: true }); };
    j.etape = "Chargement du simulateur…";
    await simu("init", SIMU_FICHIERS);
    garde();
    j.etape = "Lecture des cartes…";
    const manque = JSON.parse(await simu("preparer", JSON.stringify(listes), JSON.stringify((await BD.lire(FICHES_SIMU).catch(() => null)) || {})));
    for (let i = 0; i < manque.length; i += 75) {                        // les fiches qui manquent : simu_cartes.fiches
      garde();
      const bloc = manque.slice(i, i + 75);
      const rep = (await scryfall(`${SCRYFALL}/cards/collection`, { identifiers: bloc.map((x) => ({ name: x })) })) || {};
      const cartes = [...(rep.data || [])];
      for (const nf of rep.not_found || []) {
        const c = (await scryfall(`${SCRYFALL}/cards/named?exact=${encodeURIComponent(nf.name.split(" // ")[0])}`))
          || (await scryfall(`${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(nf.name)}`));
        if (c) { c._demande = nf.name; cartes.push(c); }
      }
      await simu("ranger", JSON.stringify(bloc), JSON.stringify(cartes));
    }
    if (manque.length) await BD.ecrire(FICHES_SIMU, JSON.parse(await simu("fiches")));
    garde();
    const decks = JSON.parse(await simu("construire", JSON.stringify(txt))), M = SIMU_OPTIONS.morceau;
    j.etape = "";
    for (const [cle] of versions) {
      for (const t of tables) {
        for (let d = 0; d < n; d += M) {
          garde();
          j.fait += await simu("morceau", cle, t, d, Math.min(M, n - d), JSON.stringify(reglages));
        }
      }
    }
    const infos = Object.fromEntries(versions.map(([cle, fichier]) => [cle, { fichier, nom: libelleSim(f, id, fichier),
      liste: `simulations/listes/${stamp}_${cle}.txt`, couverture: decks[cle].couverture }]));
    const t = new Date(), date = `${stamp.slice(0, 10)}T${date2(t.getHours())}:${date2(t.getMinutes())}:${date2(t.getSeconds())}`;
    const entete = { date, deck: id, n, tables, reglages, affine: Object.keys(txt).length > 0, versions: infos,
      duree: Math.round((Date.now() / 1000 - j.debut) * 10) / 10 };
    const rapport = await simu("rapport", JSON.stringify(entete), JSON.stringify(Object.fromEntries(versions.map(([cle]) => [cle, decks[cle].mv]))), M);
    const d = { [`simulations/${stamp}.json`]: rapport };
    for (const [cle] of versions) d[`simulations/listes/${stamp}_${cle}.txt`] = listes[cle];
    await enAttente({ f: "simulation", deck: id, d });
    await envoyer();                                                     // le rapport tout de suite dans l'onglet
    Object.assign(j, { statut: "fini", rapport: `${stamp}.json` });
  }
  async function reglagesSimulation(id, r) {                            // simulation.ecrire_reglages
    const defaut = SIMU_OPTIONS.defaut, propre = {};
    for (const k of Object.keys(defaut)) if (k in r && JSON.stringify(r[k]) !== JSON.stringify(defaut[k])) propre[k] = r[k];
    await enAttente({ f: "reglagesSim", deck: id, d: propre });
    return { ...defaut, ...propre };
  }

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
    if (pc && ROUTES_PONT.test(p)) return pontAppel(chemin, opts);
    if ((opts.method || "GET") !== "GET") return ecrire(u, opts.body || {});
    const s = (await lesSurcharges())[k];                // modifiée ici, pas encore recalculée par le PC
    if (s) return copie(s.v);
    // ce qui n'a pas de sens ici : rien ne tourne en fond, pas de discussion avec Claude, pas de mise à jour à installer
    if (p === "/api/etat") return { maj: {} };
    if (p === "/api/corbeille") return corbeilleLocale();
    if (p.startsWith("/api/discussion")) return { actif: false, actives: [], erreur: "", etapes: [], mode: "", outils: [], messages: [] };
    // les cartes : sur Scryfall
    if (p === "/api/chercher") return chercher(u.searchParams.get("q") || "");
    if (p === "/api/carte") return carte(u);
    if (p === "/api/impressions") return impressionsCarte(u.searchParams.get("nom") || "");
    // la recherche de cartes : dans la base de cartes du téléphone
    if (p === "/api/recherche/base") { if (!etatBase.prete && !baseEnCours) laBase().catch(() => {}); return copie(etatBase); }
    if (p === "/api/recherche") return rechercheAvancee(u);
    if (p === "/api/recherche/editions") return demander("editions");
    if (p === "/api/recherche/fonctions") return message("fonctions");      // une liste fixe : sans attendre la base
    if (p === "/api/recherche/tags") return demander("suggestions", u.searchParams.get("q") || "");
    if (p === "/api/recherche/noms") { pret(); return message("noms", [u.searchParams.get("q") || "", await dansDeck(u.searchParams.get("deck")), 8]); }
    if (p === "/api/recherche-cartes") return decksAvecCarte(u.searchParams.get("q") || "");
    const pm = p.match(/^\/api\/decks\/([^/]+)\/partage$/);
    if (pm) return etatPage(decodeURIComponent(pm[1]));
    if (/^\/api\/compte(\/|$)/.test(p)) { const r = await routeCompte(p, "GET"); if (r !== undefined) return r; }
    if (p === "/api/jouer/jetons") {                     // les jetons que créent les cartes du deck (proxies), sur Scryfall
      const page = await api(`/api/decks/${encodeURIComponent(u.searchParams.get("deck") || "")}`);
      return { jetons: await lePartage().jetons(page.cartes.filter((c) => c.cat !== "Maybeboard").map((c) => c.nom)).catch(() => []) };
    }
    // l'onglet Simulation : les tests faits ici (simulerIci) et ceux venus du PC ; un test en cours (/api/jobs/…)
    const sim = p.match(/^\/api\/decks\/([^/]+)\/(simulation\/options|simulations)(?:\/([^/]+))?$/);
    const job = p.match(/^\/api\/jobs\/([^/]+)$/);
    if (job) {
      const j = travaux.get(decodeURIComponent(job[1]));
      if (!j) throw Object.assign(new Error("Simulation inconnue : l'appli a peut-être été rechargée."), { statut: 404 });
      return suiviTravail(j);
    }
    if (sim && local) {
      const id = decodeURIComponent(sim[1]), f = (await depot()).fichiers, pre = `${id}/simulations/`;
      if (sim[2] === "simulation/options") return { tables: [...SIMU_OPTIONS.tables], reglages: reglagesSim(f, id), defaut: { ...SIMU_OPTIONS.defaut },
        coeurs: 1, couverture: null, affine: Object.keys(textesSim(f, id)).length > 0, test_n: SIMU_OPTIONS.test_n,
        versions: await api(`/api/decks/${encodeURIComponent(id)}/versions`).catch(() => []) };
      if (sim[3]) {
        const x = f[pre + decodeURIComponent(sim[3])];
        if (x == null) throw Object.assign(new Error("Test introuvable."), { statut: 404 });
        return JSON.parse(x);
      }
      return rapportsSimulation(f, pre);
    }
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
  async function attente() { return (await BD.lire("@attente").catch(() => null)) || []; }
  let minuterie = null;
  async function enAttente(o) {
    const l = await attente();
    l.push({ ...o, quand: Date.now(), id: Math.random().toString(36).slice(2) });
    await BD.ecrire("@attente", l);
    clearTimeout(minuterie);
    minuterie = setTimeout(() => envoyer().catch(() => {}), 300);     // une série de modifications part en une fois
  }

  // ------------------------------------------------------------------ la base de cartes (cartes.js, dans un Worker)
  // Celle de la recherche du PC, allégée (base_telephone.py), publiée avec l'appli et refaite chaque semaine : téléchargée
  // une fois (≈ 10 Mo), gardée ici (@base), puis seulement quand elle change, hors données mobiles. Elle sert à la
  // recherche de cartes, au champ du haut, et aux fiches des cartes : sans réseau, et sans PC.
  const CARTES = new URL("__CARTES__", ICI).href;     // cartes.js?v=… (telephone_site.py)
  const etatBase = { prete: false, date: null, date_fr: null, nb: 0, verifie: 0, nouveautes: [], prochaine: 0,
    construction: { actif: false, etape: "", fait: 0, total: 0, unite: "", erreur: "" } };
  let travailleur = null, baseEnCours = null, numMsg = 0;
  const reponses = new Map();
  function message(f, a = [], transfert = []) {
    if (!travailleur) {
      travailleur = new Worker(new URL(CARTES, ICI));
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
      idx = idx || await (await fetch(new URL("index.json", BASE_CARTES), { cache: "no-store" })).json();
      c.total = idx.taille;
      const r = await fetch(new URL(idx.fichier, BASE_CARTES));
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
      if (local) {                    // les pages faites sans elle, refaites avec (fonctions, Game Changers, suggestions)
        recalculer(await depot(), BESOIN, true).then((r) => {
          if (r.ameliorees && window.route && T.pret && document.querySelector("#modale")?.hidden !== false) route();
        }).catch(() => {});
      }
    })().catch((e) => { baseEnCours = null; etatBase.construction.erreur = e.message; throw e; }));
  }
  // une nouvelle base publiée : téléchargée (pas sur les données mobiles, sauf si on la demande), puis relue
  async function nouvelleBase(force = false) {
    etatBase.verifie = Date.now() / 1000;
    const idx = await (await fetch(new URL("index.json", BASE_CARTES), { cache: "no-store" })).json();
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

  // les cartes d'un deck, comme ficheCarte mais ensemble : celles que la base de cartes n'a pas (ou pas encore) en une
  // recherche groupée sur Scryfall. Une par une, un deck de 100 cartes prenait plus d'une minute et demie
  async function fichesCartes(noms) {
    const res = {}, connues = await fichesConnues(), manque = [];
    const cache = (await BD.lire("@cartes").catch(() => null)) || {};
    for (const n of noms) {
      const x = connues.get(n) || (cache[n] && cache[n].garde > Date.now() - 7 * 86400000 ? cache[n] : null);
      if (x) res[n] = x; else manque.push(n);
    }
    if (!manque.length) return res;
    const lus = await fiches(manque).catch(() => ({}));
    for (const n of manque) if (lus[n] && lus[n].image) res[n] = cache[n] = { ...lus[n], garde: Date.now() };
    await BD.ecrire("@cartes", cache);
    return res;
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

  const budget = () => { const b = (window.REGLAGES || {}).budget; return b == null ? 5 : Number(b) || 0; };   // vide : 5 €
  // sans PC, les réglages des cartes se changent ici (app.py › api_options) : budget par carte (0 : pas d'alerte),
  // illustrations et suggestions sans Universes Beyond. Gardés sur ce téléphone ; toutes les pages sont refaites.
  // langues des impressions (reglages.LANGUES) : « la moins chère en … » ; sans langue, la moins chère tout court
  const LANGUES = { fr: "français", de: "allemand", it: "italien", es: "espagnol", pt: "portugais", ja: "japonais",
    ko: "coréen", ru: "russe", zhs: "chinois simplifié", zht: "chinois traditionnel" };
  const langueCartes = () => { const l = (window.REGLAGES || {}).langue_cartes; return l in LANGUES ? l : ""; };
  const options = () => { const r = window.REGLAGES || {};
    return { budget: r.budget ?? null, budget_defaut: 5, langues: LANGUES, langue_cartes: langueCartes(), sans_ub_illustrations: !!r.sans_ub_illustrations,
      sans_ub_suggestions: !!r.sans_ub_suggestions }; };
  // Les réglages des cartes sont les mêmes sur tous les appareils (reglages.CARTES) : « Réglages Atelier/cartes.json »
  // dans la sauvegarde. Sans PC, gardés aussi ici (window.REGLAGES) ; relié, le PC les applique et refait les pages.
  const REG_CARTES = "Réglages Atelier/cartes.json";
  function changerReglages(d) {                       // les changements demandés, vérifiés (null : la valeur par défaut)
    const ch = {};
    if ("budget" in d) {
      const b = String(d.budget ?? "").replace("€", "").replace(",", ".").trim(), v = b ? Number(b) : null;
      if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100000)) throw new Error("Le budget est un nombre d'euros.");
      ch.budget = v;
    }
    for (const k of ["sans_ub_illustrations", "sans_ub_suggestions"]) if (k in d) ch[k] = d[k] ? true : null;
    if ("langue_cartes" in d) {
      if (d.langue_cartes && !(d.langue_cartes in LANGUES)) throw new Error("Langue inconnue.");
      ch.langue_cartes = d.langue_cartes || null;
    }
    return ch;
  }
  const texteCartes = (r) => JSON.stringify({ budget: r.budget ?? null, langue_cartes: r.langue_cartes || null,
    sans_ub_illustrations: r.sans_ub_illustrations ? true : null, sans_ub_suggestions: r.sans_ub_suggestions ? true : null }, null, 1) + "\n";
  // reçus d'un autre appareil par la sauvegarde : appliqués ici, toutes les pages refaites (sauf refaire = false)
  async function appliquerReglages(t, refaire = true) {
    let x;
    try { x = JSON.parse(t || "{}") || {}; } catch (_) { return; }
    const r = { ...(window.REGLAGES || {}), budget: typeof x.budget === "number" && x.budget >= 0 ? x.budget : null,
      langue_cartes: x.langue_cartes in LANGUES ? x.langue_cartes : null, sans_ub_illustrations: !!x.sans_ub_illustrations,
      sans_ub_suggestions: !!x.sans_ub_suggestions };
    window.REGLAGES = r;
    ecrireLocal(REGLAGES, JSON.stringify(r));
    if (etatBase.prete) await message("reglages", [{ sansUb: r.sans_ub_illustrations }]).catch(() => {});
    if (refaire) recalculer(null, null, true).catch(() => {});
  }
  async function ecrireOptions(d) {
    const ch = changerReglages(d), r = { ...(window.REGLAGES || {}), ...ch };
    window.REGLAGES = r;
    ecrireLocal(REGLAGES, JSON.stringify(r));
    if (Object.keys(ch).length) {                     // pour les autres appareils, par la sauvegarde
      await avecVerrou(async () => { const dp = await depot(); dp.fichiers[REG_CARTES] = texteCartes(r); await BD.ecrire("@depot", dp); });
      planifierSauvegarde();
    }
    if (etatBase.prete) await message("reglages", [{ sansUb: !!r.sans_ub_illustrations }]).catch(() => {});
    const refaire = recalculer(null);           // une autre langue : ses impressions à lire sur Scryfall, en fond
    if ("langue_cartes" in d) refaire.catch(() => {}); else await refaire;
    return options();
  }
  async function ecrire(u, b) {
    const p = u.pathname, m = p.match(/^\/api\/decks\/([^/]+)\/(modifier|achats|suggestions\/ecarter)$/);
    if (/^\/api\/compte(\/|$)/.test(p)) { const r = await routeCompte(p, "POST", b); if (r !== undefined) return r; }
    if (p === "/api/options") return ecrireOptions(b);
    if (p === "/api/prix") return prixEtNoms(b.noms || []);
    if (p === "/api/recherche/base") {                    // « Mettre à jour » : une nouvelle base, même sur les données mobiles
      const c = etatBase.construction;
      Object.assign(c, { actif: true, etape: "Recherche d'une nouvelle base", fait: 0, total: 0, unite: "", erreur: "" });
      nouvelleBase(true).catch((e) => { c.erreur = e instanceof TypeError ? "Pas de réseau." : e.message; }).finally(() => { c.actif = false; });
      return copie(etatBase);
    }
    if (!(await fichier("index.json.gz"))) throw Object.assign(new Error("Tes decks ne sont pas encore arrivés."), { statut: 503 });
    if (p === "/api/corbeille/recuperer") return recupererLocal(b.fichier);
    const pt = p.match(/^\/api\/decks\/([^/]+)\/(partage|partage\/retirer|visibilite)$/);
    if (pt && pt[2] === "visibilite") return changerVisibilite(decodeURIComponent(pt[1]), (b || {}).visibilite);
    if (pt && pt[2] === "partage/retirer") return changerVisibilite(decodeURIComponent(pt[1]), "prive");
    if (pt) { await publier([decodeURIComponent(pt[1])]); return etatPage(decodeURIComponent(pt[1])); }
    if (p === "/api/decks") return creerDeck(b);
    if (p === "/api/decks/importer") return importerDecks(b);
    if (p === "/api/classeur/importer") return importerClasseur(b);
    const r = p.match(/^\/api\/decks\/([^/]+)\/(renommer|supprimer)$/);
    if (r && r[2] === "renommer") {
      const ancien = decodeURIComponent(r[1]), res = await renommerDeck(ancien, b.nom);
      if (res.id !== ancien) suivrePartage({ op: "renommer", ancien, nouveau: res.id });
      return res;
    }
    if (r) {
      const res = await supprimerDeck(decodeURIComponent(r[1]));
      suivrePartage({ op: "retirer", deck: decodeURIComponent(r[1]) });
      return res;
    }
    const sl = p.match(/^\/api\/decks\/([^/]+)\/(simulations|reglages)$/);
    if (sl && sl[2] === "simulations") return simulerIci(decodeURIComponent(sl[1]), b);
    if (sl) return reglagesSimulation(decodeURIComponent(sl[1]), b || {});
    const ja = p.match(/^\/api\/jobs\/([^/]+)\/annuler$/);
    if (ja) { const j = travaux.get(decodeURIComponent(ja[1])); if (j) j.annule = true; return { ok: true }; }
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
  // (classeur.lire_liste), sans les titres de section (MTG Arena : « Commander », « Deck », « Sideboard »…)
  const SECTIONS = new Set(["about", "commander", "commandant", "companion", "compagnon", "deck", "main", "mainboard", "sideboard",
    "réserve", "maybeboard", "considering", "tokens"]);
  function lireListe(texte) {
    const lignes = texte.split(/\r?\n/)
      .filter((l) => l.trim() && !/^\s*(#|\/\/)/.test(l) && !SECTIONS.has(l.trim().replace(/:$/, "").trim().toLowerCase()))
      .map((l) => (/^\s*(SB:\s*)?\d/.test(l) ? l : "1 " + l.trim()));
    const lues = new Map();
    for (const e of MOTEUR.lireLignes(lignes)) lues.set(e.nom, (lues.get(e.nom) || 0) + e.n);
    return lues;
  }
  // une collection en CSV (ManaBox, Moxfield, Archidekt, Deckbox, Dragon Shield, TCGplayer, Cardmarket…) : Map nom →
  // exemplaires ; null si ce n'est pas un CSV avec une colonne de noms (classeur.lire_csv)
  const COL_NOM = ["simple name", "name", "english name", "card name", "card", "card_name", "cardname", "nom"];
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
    const deja = [];
    for (const f of (b.fichiers || []).slice(0, 200)) {
      const nom = String(f.nom || "").split(/[\\/]/).pop().replace(/\.[^.]*$/, "");
      let texte = String(f.texte || "");
      const appli = texte.trimStart().startsWith("{") ? await importerAppli(texte) : null;      // un fichier de sauvegarde
      if (appli) { faits.push(...appli.decks); deja.push(...appli.deja); appli.decks.forEach((id) => pris.add(id.toLowerCase())); continue; }
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
    return { decks: faits, deja, echecs };
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
  // les opérations en attente, rejouées sur les fichiers gardés ici. source(rel) : le contenu d'un fichier au départ
  // (null s'il n'existe pas). prefixe : devant ce que l'historique du deck note.
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
      } else if (o.f === "reglages") {                // les réglages des cartes, pour tous les appareils
        let x = {};
        try { x = JSON.parse((await lire(REG_CARTES)) || "{}") || {}; } catch (_) {}
        fichiers.set(REG_CARTES, JSON.stringify({ budget: null, langue_cartes: null, sans_ub_illustrations: null,
          sans_ub_suggestions: null, ...x, ...o.d }, null, 1) + "\n");
        nouveaux.push("réglages des cartes");
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
        } else if (o.f === "simulation") {                   // un test du simulateur : son rapport et ses listes
          for (const [rel, t] of Object.entries(o.d)) if (/^simulations\/[\w./-]+$/.test(rel) && !rel.includes("..")) fichiers.set(`${o.deck}/${rel}`, t);
          nouveaux.push(`test de ${titre(o.deck)}`);
        } else if (o.f === "reglagesSim") {                  // simulation.ecrire_reglages
          const rel = `${o.deck}/simulateur.json`;
          let d = {};
          try { d = JSON.parse((await lire(rel)) || "{}") || {}; } catch (_) {}
          if (Object.keys(o.d).length) d.reglages = o.d; else delete d.reglages;
          if (Object.keys(d).length) { fichiers.set(rel, JSON.stringify(d, null, 1)); supprimes.delete(rel); }
          else if ((await lire(rel)) != null) { fichiers.set(rel, null); supprimes.add(rel); }
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

  // les fichiers gardés ici (@depot), puis les pages des decks touchés, refaites ici
  async function envoyerLocal(ops) {
    const d = await depot(), f = d.fichiers, depart = { ...f };
    const r = await rejouer(ops, async (rel) => (rel in depart ? depart[rel] : null), "");
    const renommes = new Set(r.origine.values());
    for (const id of r.effaces) if (!renommes.has(id)) jeter(f, id);          // supprimé : dans la corbeille
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
    suivrePartage({ op: "modifie", decks: [...r.touches] });
  }

  let envoi = null;
  function envoyer() {
    return envoi || (envoi = (async () => {
      const ops = await attente();
      if (!ops.length || !local) return false;
      await avecVerrou(() => envoyerLocal(ops));
      planifierSauvegarde();                              // vers le compte, une fois la série finie
      // fait : ces opérations partent de la file ; les pages refaites ici remplacent tout de suite celles d'attente
      const restent = (await attente()).filter((x) => !ops.some((y) => y.id === x.id));
      await BD.ecrire("@attente", restent);
      const s = await lesSurcharges(), fin = Math.max(...ops.map((x) => x.quand));
      for (const [k, x] of Object.entries(s)) if (x.quand <= fin) delete s[k];
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

  // ------------------------------------------------------------------ la corbeille (decks.supprimer, corbeille, recuperer)
  // Sans PC, un deck supprimé (ici ou sur un autre appareil) va dans « Corbeille Atelier/<deck>__<date> », comme sur le
  // PC ; elle reste sur le téléphone (pas dans la sauvegarde). Relié au PC, c'est la corbeille du PC (index) ; un deck
  // récupéré revient par la sauvegarde, repris de son historique.
  function jeter(f, id) {
    const dest = `${CORBEILLE}/${id}__${horodatage()}/`;
    for (const rel of Object.keys(f)) if (rel.startsWith(id + "/")) f[dest + rel.slice(id.length + 1)] = f[rel];
  }
  async function corbeilleLocale() {
    const vus = new Map();
    for (const rel of Object.keys((await depot()).fichiers)) {
      const m = rel.match(/^Corbeille Atelier\/((.+)__(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})\d{2})\//);
      if (m && !vus.has(m[1])) vus.set(m[1], { fichier: m[1], nom: m[2], date: `${m[3]} ${m[4]}:${m[5]}` });
    }
    return [...vus.values()].sort((a, b) => (a.fichier.split("__")[1] < b.fichier.split("__")[1] ? 1 : -1));
  }
  async function recupererLocal(fichierCorbeille) {
    return avecVerrou(async () => {
      const d = await depot(), f = d.fichiers, pre = `${CORBEILLE}/${fichierCorbeille}/`, nom = String(fichierCorbeille).replace(/__[^_]+_\d{6}$/, "");
      if (!Object.keys(f).some((rel) => rel.startsWith(pre))) throw new Error("Deck introuvable dans la corbeille.");
      if (`${nom}/archidekt.txt` in f) throw new Error(`Un deck « ${nom.replace(/^Deck /, "")} » existe déjà : renomme ou supprime-le d'abord.`);
      for (const rel of Object.keys(f)) if (rel.startsWith(pre)) { f[nom + "/" + rel.slice(pre.length)] = f[rel]; delete f[rel]; }
      d.modifies = { ...(d.modifies || {}), [nom]: Date.now() / 1000 };
      await BD.ecrire("@depot", d);
      await recalculer(d, new Set([nom]));
      planifierSauvegarde();
      return { id: nom };
    });
  }
  // ------------------------------------------------------------------ partager un deck (partage.js)
  // Le lien instantané (voir/) ne demande rien. La page permanente d'un deck viendra du serveur des comptes : en
  // attendant, partage.js n'a pas de compte où publier.
  let partageTel = null;
  const lePartage = () => partageTel || (partageTel = PARTAGE_TELEPHONE({
    api, serveur, scryfall: (url, corps) => scryfall(url, corps),
    page: async (id) => { await calculs; return fichier("decks/" + id); },
    lire: (k) => BD.lire(k).catch(() => null), ecrire: (k, v) => BD.ecrire(k, v),
    reglages: () => ({ budget: budget(), sans_ub_illustrations: !!(window.REGLAGES || {}).sans_ub_illustrations }),
  }));
  // ------------------------------------------------------------------ le pont avec l'Atelier de ce PC (2.3.0)
  // Sur un ordinateur où l'Atelier est installé et connecté au même compte, ce que lui seul sait faire (Claude, les
  // synergies, MTGPics) passe par lui. Il range son adresse et un secret dans « Réglages Atelier/pont.json »
  // (compte.publier_pont) : on ne l'appelle que si ce fichier est là, car le navigateur demande alors, une fois, d'accéder
  // au réseau local. Quand Claude a fini, ce qu'il a changé sur le PC arrive ici aussitôt.
  const MODULE_VU = "atelier-module";                 // ce navigateur a déjà joint un module : « Lancer l'Atelier » (app.js › surPC)
  const ROUTES_PONT = /^\/api\/(discussion(\/|$)|decks\/[^/]+\/(synergies|mtgpics)(\/|$))/;
  let pc = null, claudeActif = false;
  async function chercherPc() {
    if (!ORDI || !compte || pc) return;
    let l = {};
    try { l = JSON.parse((await depot()).fichiers["Réglages Atelier/pont.json"] || "{}") || {}; } catch (_) { return; }
    for (const x of Object.values(l)) {
      try {
        const r = await fetch(`http://127.0.0.1:${Number(x.port)}/api/pont`, { cache: "no-store", headers: { "X-Atelier-Pont": String(x.secret) } });
        const d = r.ok ? await r.json() : {};
        if (d.email && d.email === compte.email) {
          pc = { port: Number(x.port), secret: String(x.secret), version: d.atelier };
          T.pc = pc;
          ecrireLocal(MODULE_VU, "1");
          if (window.quandPc) window.quandPc();
          return;
        }
      } catch (_) { /* pas sur ce PC, ou l'Atelier n'est pas lancé */ }
    }
  }
  async function auPc(chemin, opts = {}, cible = pc) {
    const corps = opts.body !== undefined && opts.body !== null;
    let r;
    try {
      r = await fetch(`http://127.0.0.1:${cible.port}${chemin}`, { method: opts.method || "GET", cache: "no-store",
        headers: { "X-Atelier-Pont": cible.secret, ...(corps ? { "Content-Type": "application/json" } : {}) },
        body: corps ? JSON.stringify(opts.body) : undefined });
    } catch (_) { throw Object.assign(new Error("L'Atelier de ce PC ne répond plus : relance-le."), { statut: 0 }); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.erreur || `L'Atelier de ce PC ne répond pas (${r.status}).`), { statut: r.status });
    return d;
  }
  async function pontAppel(chemin, opts) {
    const d = await auPc(chemin, opts);
    if (chemin.startsWith("/api/discussion")) {
      const actif = !!(d && (d.actif || (d.actives && d.actives.length)));
      if (claudeActif && !actif) setTimeout(apresClaude, 500);
      claudeActif = actif;
    }
    return d;
  }
  // Le module Claude : un Atelier de PC pas encore connecté ouvre le site à #/module/<port>/<secret>
  // (compte.lien_module). Connecté ici, on demande au serveur une connexion pour ce PC (/connexion/appareil), qu'on lui
  // passe par le pont (/api/module/appairer) : il se synchronise alors (ses decks arrivent ici) et publie le pont.
  async function appairerModule(port, secret) {
    if (!compte) throw new Error("Connecte-toi d'abord.");
    const cible = { port: Number(port), secret: String(secret) };
    let info;
    try { info = await auPc("/api/pont", {}, cible); }
    catch (e) { throw Object.assign(new Error("L'Atelier de ce PC ne répond pas : lance « Atelier MTG » sur ce PC, puis recharge cette page."), { statut: e.statut }); }
    if (info.email && info.email !== compte.email) throw new Error(`Ce PC est connecté à un autre compte (${info.email}).`);
    if (!info.email) {
      const c = await serveur("/connexion/appareil", "POST", { appareil: info.appareil || "PC" });
      await auPc("/api/module/appairer", { method: "POST", body: { jeton: c.jeton, email: c.email, pseudo: c.pseudo } }, cible);
    }
    pc = { ...cible, version: info.atelier };
    T.pc = pc;
    ecrireLocal(MODULE_VU, "1");
    if (window.quandPc) window.quandPc();
    setTimeout(() => apresClaude().catch(() => {}), 3000);         // ses decks, envoyés au compte, arrivent ici
    return { decks: info.decks || 0, claude: !!info.claude, deja: !!info.email };
  }
  async function apresClaude() {
    try { await auPc("/api/compte/synchroniser", { method: "POST", body: {} }); } catch (_) { /* il se synchronisera seul */ }
    const r = await sauvegarder().catch(() => null);
    if (r && r.recus && window.route && T.pret && document.querySelector("#modale")?.hidden !== false) route();
  }

  // ------------------------------------------------------------------ l'adresse et la page publique de chaque deck
  // L'adresse d'un deck, atelier-mtg.com/decks/<pseudo>/<slug>/, est le lien à partager : celle de sa page publiée (le
  // serveur la garde), sinon celle qu'il lui donnera (comme pages.slug_de), la même sur tous les appareils. Chaque deck
  // est publié, sauf s'il est privé ; sa visibilité est dans « Deck X/page.json » (absent : public), synchronisée.
  const RESERVES = new Set(["atelier", "atelier-mtg", "admin", "api", "app", "decks", "fr", "en", "a-propos", "recherche", "modeles",
    "sitemap", "static", "jouer", "contact", "aide", "compte", "comptes", "partage", "voir", "www"]);
  const VISIBILITES = ["public", "non-repertorie", "prive"];
  const slugNom = (id) => String(id).replace(/^Deck /, "").normalize("NFD").replace(/[^\x00-\x7f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "deck";
  let slugs = new Map();
  async function majSlugs() {
    const e = (await BD.lire("@partages").catch(() => null)) || {}, publies = {};
    for (const [d, x] of Object.entries(e.decks || {})) publies[d] = x.slug || String(x.url || "").split("/").filter(Boolean).pop();
    const pris = new Set(Object.values(publies)), m = new Map();
    for (const id of PAGES.decksDe((await depot()).fichiers).sort()) {
      let s = publies[id];
      if (!s) {
        const b = slugNom(id);
        s = b;
        for (let i = 2; pris.has(s) || RESERVES.has(s); i++) s = `${b}-${i}`;
        pris.add(s);
      }
      m.set(id, s);
    }
    slugs = m;
  }
  const slugDe = (id) => slugs.get(id) || slugNom(id);
  const deckDeSlug = (s) => ([...slugs].find(([, x]) => x === s) || [null])[0];
  async function visibilite(id) {
    try { const v = JSON.parse((await depot()).fichiers[`${id}/page.json`] || "{}").visibilite; return VISIBILITES.includes(v) ? v : "public"; }
    catch (_) { return "public"; }
  }
  async function etatPage(id) {
    const x = ((await lePartage().partages()) || {})[id] || {};
    return { url: `${location.origin}/decks/${(compte && compte.pseudo) || ""}/${slugDe(id)}/`, visibilite: await visibilite(id),
      publie: !!x.url, date: x.date || null };
  }
  async function changerVisibilite(id, v) {
    if (!VISIBILITES.includes(v)) throw new Error("Visibilité inconnue.");
    await avecVerrou(async () => {
      const d = await depot();
      if (v === "public") delete d.fichiers[`${id}/page.json`];
      else d.fichiers[`${id}/page.json`] = JSON.stringify({ visibilite: v }, null, 1) + "\n";
      await BD.ecrire("@depot", d);
    });
    planifierSauvegarde();
    // privé : la page est retirée tout de suite ; sinon publiée en fond (elle attend que les pages des decks soient prêtes)
    if (v === "prive") { if ((await lePartage().partages())[id]) await lePartage().retirer(id); }
    else suivrePartage({ op: "modifie", decks: [id], vite: true });
    return etatPage(id);
  }
  // publier ces decks (sauf les privés) ; fort : l'erreur remonte (sinon, on essaiera plus tard)
  async function publier(ids, fort = false) {
    for (const id of ids) {
      const v = await visibilite(id);
      if (v === "prive") continue;
      try { await lePartage().partager([id], null, () => ({ visibilite: v, slug: slugDe(id) })); }
      catch (e) { if (fort) throw e; }
    }
    await majSlugs();
  }
  // une page publique suit son deck : renommé (elle garde son adresse), supprimé (retirée), modifié ici (republiée peu
  // après la dernière modification, tant que l'appli est ouverte) ; au démarrage, les decks qui n'ont pas encore la leur
  const aRepublier = new Set();
  let minuteurPartage = null;
  async function suivrePartage(x) {
    try {
      const p = await lePartage().partages();
      if (x.op === "renommer") { if (p[x.ancien]) await lePartage().renommer(x.ancien, x.nouveau); aRepublier.add(x.nouveau); }
      else if (x.op === "retirer" && p[x.deck]) await lePartage().retirer(x.deck);
      else if (x.op === "modifie") for (const id of x.decks) aRepublier.add(id);
      if (aRepublier.size) { clearTimeout(minuteurPartage); minuteurPartage = setTimeout(republier, x.vite ? 3000 : 20000); }
    } catch (_) { /* pas de réseau : la page sera refaite plus tard */ }
  }
  async function republier() {
    const l = [...aRepublier];
    aRepublier.clear();
    const ids = new Set(PAGES.decksDe((await depot()).fichiers));
    await publier(l.filter((id) => ids.has(id))).catch(() => {});
  }
  async function publierManquants() {
    if (!compte || !compte.pseudo) return;
    const p = await lePartage().partages(), ids = PAGES.decksDe((await depot()).fichiers).filter((id) => !p[id]);
    if (ids.length) suivrePartage({ op: "modifie", decks: ids, vite: true });
  }

  // ------------------------------------------------------------------ les pages faites ici
  const depot = async () => (await BD.lire("@depot").catch(() => null)) || { fichiers: {}, modifies: {} };
  // ce dont pages.js a besoin : les fiches (base de cartes, sinon Scryfall), les fonctions, les impressions choisies
  function outilsPages(f) {
    const avecBase = (fn, defaut) => (...a) => (etatBase.prete ? message(fn, a).catch(() => defaut) : Promise.resolve(defaut));
    return {
      fiches: async (noms) => {
        const lang = langueCartes(), locs = lang && etatBase.prete ? await impressionsLangue(noms, lang).catch(() => ({})) : {};
        const res = etatBase.prete ? await message("fiches", [noms, locs]).catch(() => ({})) : {};
        const reste = noms.filter((n) => !res[n]);
        if (reste.length) Object.assign(res, await fichesCartes(reste));
        return res;
      },
      // sans la base de cartes : les impressions choisies du deck demandées ensemble à Scryfall, pas une par carte
      impressions: async (eds) => {
        if (etatBase.prete) return;
        const manque = [...new Map(eds.map((ed) => [`${String(ed.set).toLowerCase()}/${ed.num}/en`, ed])).entries()]
          .filter(([k]) => !impressionsVues.has(k));
        for (let i = 0; i < manque.length; i += 75) {
          const r = await scryfall(`${SCRYFALL}/cards/collection`, { identifiers: manque.slice(i, i + 75)
            .map(([, ed]) => ({ set: String(ed.set).toLowerCase(), collector_number: String(ed.num) })) }).catch(() => null);
          for (const c of (r && r.data) || []) impressionsVues.set(`${c.set}/${c.collector_number}/en`, impression(c));
        }
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
  // ------------------------------------------------------------------ les pages toutes prêtes, dans le compte
  // Les pages d'un deck se font là où sont ses fichiers ; l'appareil qui les a faites les dépose dans le compte
  // (serveur › pages toutes prêtes), avec l'empreinte des fichiers dont elles sont tirées et leur niveau. Un autre
  // appareil qui a les mêmes fichiers les reprend telles quelles : un nouveau téléphone ouvre ses decks aussitôt, sans
  // rien demander à Scryfall ni attendre la base de cartes. Niveau : 2 avec la base de cartes (fonctions, Game Changers,
  // suggestions), +1 avec l'analyse de Commander Spellbook de la liste. L'empreinte (même calcul sur le PC, compte.py ›
  // empreintes) : les fichiers du deck, le classeur et les réglages des cartes ; pour l'accueil (@index), le classeur,
  // les réglages et l'empreinte de chaque deck.
  const FORMAT_PAGES = "1", INDEX_PAGES = "@index", BESOIN = "besoin", SEMAINE = 7 * 86400;
  const sha1 = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(t)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  async function shasDe(f) {                          // {chemin: empreinte git}, comme le compte les garde
    const r = {};
    for (const [rel, t] of Object.entries(f)) if (!rel.startsWith(CORBEILLE + "/")) r[rel] = await shaBlob(t);
    return r;
  }
  async function empreintes(shas) {                   // {deck: empreinte, "@index": empreinte}
    const ligne = async (rel) => `${await sha1(rel)} ${shas[rel] || "-"}`, res = {}, parDeck = {};
    const reg = await ligne(REG_CARTES), cl = await ligne("Classeur/classeur.txt");     // le classeur : les suggestions
    for (const rel of Object.keys(shas)) (parDeck[rel.split("/")[0]] = parDeck[rel.split("/")[0]] || []).push(rel);
    for (const id of PAGES.decksDe(shas)) {
      res[id] = await sha1(["pages " + FORMAT_PAGES, reg, cl, ...(await Promise.all(parDeck[id].map(ligne))).sort()].join("\n"));
    }
    const l = await Promise.all(Object.keys(res).map(async (id) => `${await sha1(id)} ${res[id]}`));
    res[INDEX_PAGES] = await sha1(["index " + FORMAT_PAGES, reg, cl, ...l.sort()].join("\n"));
    return res;
  }
  const niveauDe = (id, page) => (etatBase.prete ? 2 : 0) + (((page.api || {})[`/api/decks/${id}/bracket`] || {}).spellbook_a_jour ? 1 : 0);
  const pagesDuCompte = async () => (await serveur("/pages")).pages || {};
  async function lirePage(id) {                       // {empreinte, niveau, donnees}
    const r = await fetch(API_COMPTE + avecGz(`/pages/lire?deck=${encodeURIComponent(id)}`), { cache: "no-store",
      headers: { Authorization: "Bearer " + compte.jeton } });
    if (!r.ok) throw new Error(`page ${r.status}`);
    return { empreinte: r.headers.get("X-Empreinte"), niveau: Number(r.headers.get("X-Niveau")) || 0, donnees: await lireJson(r) };
  }
  async function deposerPage(id, empreinte, niveau, donnees) {
    const texte = JSON.stringify(donnees);
    let corps = texte, type = "application/json";
    if (typeof CompressionStream === "function") {
      try {
        corps = await new Response(new Blob([texte]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
        type = "application/gzip";
      } catch (_) { corps = texte; }
    }
    const q = new URLSearchParams({ deck: id, empreinte, niveau: String(niveau) });
    const r = await fetch(`${API_COMPTE}/pages?${q}`, { method: "PUT", cache: "no-store", body: corps,
      headers: { Authorization: "Bearer " + compte.jeton, "Content-Type": type } });
    if (!r.ok) throw new Error(`page ${r.status}`);
  }
  async function enParallele(liste, n, fn) {
    const file = [...liste];
    await Promise.all(Array.from({ length: Math.min(n, file.length) }, async () => { while (file.length) await fn(file.shift()); }));
  }
  // l'analyse de Spellbook d'une page reçue du compte, gardée comme si elle avait été faite ici : rien à redemander
  async function garderAnalyse(id, page, f) {
    const b = page.api[`/api/decks/${id}/bracket`];
    if (!b || !b.spellbook || !b.spellbook_a_jour || f[`${id}/archidekt.txt`] == null) return;
    const k = await cleListe(PAGES.corpsSpellbook(MOTEUR.lire(f[`${id}/archidekt.txt`]))), c = await lesAnalyses();
    if (c.analyses[k]) return;
    c.analyses[k] = b.spellbook;
    c.dernier[id] = k;
    await BD.ecrire(SB, c);
  }
  // celles faites ici, pour les autres appareils : une fois leurs fichiers dans le compte (à la synchronisation), si le
  // compte n'a pas déjà la même, ou mieux
  let pagesAEnvoyer = false, envoiPages = null, minuteurPages = null;
  function planifierEnvoiPages(ms = 3000) {
    if (!compte) return;
    clearTimeout(minuteurPages);
    minuteurPages = setTimeout(() => envoyerPages().catch(() => { pagesAEnvoyer = true; }), ms);
  }
  function envoyerPages() {
    return envoiPages || (envoiPages = (async () => {
      if (!compte) return 0;
      pagesAEnvoyer = false;
      const f = (await depot()).fichiers, dansLeCompte = await empreintes((await lEtat()).fichiers || {}), ici = await empreintes(await shasDe(f));
      const l = await pagesDuCompte();
      let n = 0;
      for (const id of [...PAGES.decksDe(f), INDEX_PAGES]) {
        const g = await BD.lire(id === INDEX_PAGES ? "index.json.gz" : "decks/" + id).catch(() => null);
        if (!g || !g.donnees || !g.empreinte || g.sha === "compte") continue;
        if (g.empreinte !== dansLeCompte[id]) { if (g.empreinte === ici[id]) pagesAEnvoyer = true; continue; }   // pas encore partis
        const x = l[id];
        if (x && x.empreinte === g.empreinte && x.niveau >= g.niveau) continue;
        const api = id === INDEX_PAGES ? Object.fromEntries(Object.entries(g.donnees.api).filter(([k]) => k !== "/api/options")) : null;
        await deposerPage(id, g.empreinte, g.niveau, api ? { date: g.donnees.date, date_fiches: g.donnees.date_fiches, api } : g.donnees);
        n++;
      }
      return n;
    })().finally(() => { envoiPages = null; }));
  }

  // ------------------------------------------------------------------ Commander Spellbook, par le relais (bracket.spellbook)
  // Spellbook refuse les pages web : un petit relais sans secret (outils/atelier/relais) lui transmet les demandes.
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

  // ------------------------------------------------------------------ le compte : connexion et synchronisation
  // Synchroniser compare trois états : les fichiers d'ici (@depot), ceux du compte et ceux de la dernière
  // synchronisation (@compte-etat). Ce qui a changé d'un seul côté passe de l'autre ; changé des deux côtés, la version
  // d'ici l'emporte et la liste d'en face entre dans l'historique du deck. La corbeille reste ici.
  const ETAT = "@compte-etat";
  const CALME = 5000;                                 // ms sans modification avant d'envoyer : une série d'ajouts part une fois
  const LOT = 400, LOT_OCTETS = 4000000;               // fichiers et octets par envoi au serveur
  const CACHES = new Set(["@base", "@cartes", "@langues", "@spellbook"]);   // gardés en changeant de compte
  async function shaBlob(texte) {                     // l'empreinte git d'un fichier (serveur.sha_blob)
    const o = new TextEncoder().encode(texte), t = new TextEncoder().encode(`blob ${o.length}\0`), tout = new Uint8Array(t.length + o.length);
    tout.set(t);
    tout.set(o, t.length);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-1", tout))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const lEtat = async () => { const e = (await BD.lire(ETAT).catch(() => null)) || {}; return compte && e.email === compte.email ? e : { fichiers: {} }; };
  // le nom de cet appareil dans la liste du compte
  function nomAppareil() {
    const ua = navigator.userAgent;
    const os = /iphone/i.test(ua) ? "iPhone" : iphone ? "iPad" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows"
      : /mac os/i.test(ua) ? "Mac" : /linux/i.test(ua) ? "Linux" : "Appareil";
    const nav = /edg\//i.test(ua) ? "Edge" : /firefox|fxios/i.test(ua) ? "Firefox" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "";
    return os + (nav ? " · " + nav : "") + (installee() ? " · appli" : "");
  }
  async function viderIci() {                         // tout ce que l'appli garde ici, sauf la base de cartes et les caches
    for (const k of await BD.cles()) if (!CACHES.has(k) && k !== DEMENAGEMENT) await BD.effacer(k);
    memoire.clear();
    fusion = null;
    connus = null;
    surcharges = null;
  }

  // se connecter : le code reçu par e-mail. Les decks déjà ici (d'avant les comptes) partent dans le compte ; ceux d'un
  // autre compte, ou les pages reçues d'un PC relié, sont d'abord effacés. Les pages des decks sont refaites une seule
  // fois, à la fin : toutes s'il n'y en a pas encore ici ou si les réglages viennent d'arriver, sinon celles des decks
  // arrivés. progres(fait, total) : où en est ce calcul (beaucoup de decks : il prend du temps). Un compte sans pseudo
  // le choisit d'abord (demanderPseudo : l'écran de connexion) ; la connexion n'est gardée qu'ensuite
  const demanderCode = (email) => serveur("/connexion/code", "POST", { email });
  async function seConnecter(email, code, progres = null, demanderPseudo = null) {
    const r = await serveur("/connexion/verifier", "POST", { email, code, appareil: nomAppareil() });
    compte = { email: r.email, jeton: r.jeton, pseudo: r.pseudo || null };
    if (!compte.pseudo && demanderPseudo) await demanderPseudo();
    if (progres) progres(0, 0);
    const avant = (await BD.lire(ETAT).catch(() => null)) || {};
    if ((avant.email && avant.email !== r.email) || ANCIEN_PC) await viderIci();
    for (const k of ["telephone-acces", "telephone-commit", "telephone-compte-pc", "telephone-local", "telephone-connexion-github"]) ecrireLocal(k, null);
    for (const k of ["@github", "@sauvegarde", "@partage", "@partage-attente"]) await BD.effacer(k).catch(() => {});
    ecrireLocal(COMPTE, JSON.stringify(compte));
    marquerCompte();
    local = true;
    garderDonnees();
    if (!(await BD.lire("@depot").catch(() => null))) await BD.ecrire("@depot", { fichiers: {}, modifies: {} });
    window.REGLAGES = { budget: 5, sans_ub_illustrations: false, ...(window.REGLAGES || {}) };
    ecrireLocal(REGLAGES, JSON.stringify(window.REGLAGES));
    let s = null;
    enConnexion = true;
    try { s = await sauvegarder(); } catch (_) { /* pas de réseau : la synchronisation reprendra */ } finally { enConnexion = false; }
    const dp = await depot(), reg = dp.fichiers[REG_CARTES];
    if (reg) await appliquerReglages(reg, false);
    const tout = !(await BD.lire("index.json.gz").catch(() => null)) || (s && s.reglages);
    if (tout || (s && s.touches.length)) {
      suivi = progres;
      try { await recalculer(dp, tout ? null : new Set(s.touches), true); } finally { suivi = null; }
    }
    location.hash = "#/";
    location.reload();
  }
  // le pseudo du compte (serveur › choisir_pseudo), choisi une fois : il est dans l'adresse de ses decks
  async function choisirPseudo(p) {
    const r = await serveur("/compte/pseudo", "POST", { pseudo: p });
    compte.pseudo = r.pseudo;
    if (lireCompte()) ecrireLocal(COMPTE, JSON.stringify(compte));
    marquerCompte();
    return r.pseudo;
  }
  // se déconnecter : ce qui n'est pas encore parti part d'abord, puis les decks quittent cet appareil (ils restent dans
  // le compte). Refusé par le serveur (appareil retiré du compte) : on revient à la connexion, sans rien effacer
  async function deconnecter() {
    await envoyer().catch(() => {});
    await sauvegarder();
    await serveur("/deconnexion", "POST").catch(() => {});
    await deconnecte(true);
  }
  async function deconnecte(vider) {
    compte = null;
    local = false;
    ecrireLocal(COMPTE, null);
    if (vider) await viderIci();
    location.hash = "#/";
    location.reload();
  }

  // un seul à la fois : les modifications faites ici (envoyerLocal) et la synchronisation touchent aux mêmes fichiers
  let verrouDepot = Promise.resolve();
  const avecVerrou = (fn) => { const p = verrouDepot.then(fn); verrouDepot = p.catch(() => {}); return p; };
  let sauvegarde = null, erreurSauvegarde = "";
  // synchroniser : {envoyes, recus, conflits, decks, decks_recus}
  function sauvegarder() {
    return sauvegarde || (sauvegarde = avecVerrou(() => synchroniserCompte())
      .then((r) => { erreurSauvegarde = ""; if (pagesAEnvoyer) planifierEnvoiPages(1000); return r; },
        (e) => { erreurSauvegarde = e.message; throw e; })
      .finally(() => { sauvegarde = null; }));
  }
  const pareils = (a, b) => { const k = Object.keys(a); return k.length === Object.keys(b).length && k.every((x) => a[x] === b[x]); };
  function enLots(liste) {
    const lots = [];
    let lot = [], taille = 0;
    for (const x of liste) {
      const n = (x.contenu || "").length + 200;
      if (lot.length && (taille + n > LOT_OCTETS || lot.length >= LOT)) { lots.push(lot); lot = []; taille = 0; }
      lot.push(x);
      taille += n;
    }
    if (lot.length) lots.push(lot);
    return lots;
  }
  async function synchroniserCompte() {
    if (!compte) throw Object.assign(new Error("Connecte-toi."), { statut: 401 });
    let e = await lEtat();
    for (let essai = 0; essai < 3; essai++) {
      const dep = await depot(), ici = {}, avant = e.fichiers || {};
      for (const [rel, t] of Object.entries(dep.fichiers)) if (!rel.startsWith(CORBEILLE + "/")) ici[rel] = await shaBlob(t);
      // rien de changé ici depuis la dernière fois : le serveur dit seulement si le compte a bougé
      const l = await serveur("/fichiers" + (e.revision != null && pareils(ici, avant) ? `?revision=${e.revision}` : ""));
      if (l.inchange) {
        await BD.ecrire(ETAT, { ...e, email: compte.email, derniere: Date.now() / 1000 });
        return { envoyes: 0, recus: 0, decks: e.decks ?? 0, conflits: [], decks_recus: [] };
      }
      const distant = l.fichiers || {};
      const envois = [], retraits = [], recus = [], effaces = [], conflits = [];
      for (const rel of [...new Set([...Object.keys(ici), ...Object.keys(distant), ...Object.keys(avant)])].sort()) {
        const a = ici[rel] ?? null, r = distant[rel] ?? null, b = avant[rel] ?? null;
        if (a === r) continue;
        if (a === b) (r === null ? effaces : recus).push(rel);              // changé dans le compte seulement
        else if (r === b) (a === null ? retraits : envois).push(rel);       // changé ici seulement
        else if (a === null) recus.push(rel);                                // supprimé ici, changé là-bas : il revient
        else { envois.push(rel); if (r !== null) conflits.push(rel); }      // changé des deux côtés : celui d'ici gagne
      }
      // 1. ce qui arrive, et la liste d'en face quand celle d'ici l'emporte (lue avant d'être remplacée)
      const lus = new Map(), aLire = [...recus, ...conflits.filter((rel) => rel.endsWith("/archidekt.txt"))];
      for (let i = 0; i < aLire.length; i += LOT) {
        const r = await serveur("/fichiers/lire", "POST", { chemins: aLire.slice(i, i + LOT) });
        for (const [rel, t] of Object.entries(r.fichiers || {})) lus.set(rel, t);
      }
      // 2. ce qui part ; un autre appareil a écrit entre-temps (conflit) : on recommence
      const lots = enLots([...envois.map((rel) => ({ chemin: rel, contenu: dep.fichiers[rel], base: distant[rel] ?? null })),
        ...retraits.map((rel) => ({ chemin: rel, contenu: null, base: distant[rel] ?? null }))]);
      let revision = l.revision, conflit = false;
      for (const lot of lots) {
        const r = await serveur("/fichiers/ecrire", "POST", { changements: lot });
        if (Object.keys(r.conflits || {}).length) conflit = true;
        revision = r.revision;
      }
      if (conflit) { e = { ...e, revision: null }; continue; }
      // 3. ce qui est arrivé, rangé ici
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
        j[nom] = "Liste d'un autre appareil (compte)";
        f[jf] = JSON.stringify(j, null, 1);
        touches.add(deck);
      }
      // 4. ce qui a disparu du compte (sans avoir changé ici) : retiré ici aussi ; un deck entier, dans la corbeille d'ici
      const partis = new Set(effaces);
      for (const id of new Set(effaces.map((rel) => rel.split("/")[0]))) {
        if (id.startsWith("Deck ") && !Object.keys(f).some((rel) => rel.startsWith(id + "/") && !partis.has(rel))) jeter(f, id);
      }
      for (const rel of effaces) { delete f[rel]; touches.add(rel.split("/")[0]); }
      for (const id of Object.keys(dep.modifies)) if (!(`${id}/archidekt.txt` in f)) delete dep.modifies[id];
      if (touches.size) await BD.ecrire("@depot", dep);
      const fichiers = { ...distant };
      for (const rel of envois) fichiers[rel] = ici[rel];
      for (const rel of retraits) delete fichiers[rel];
      const nb = new Set(Object.keys(fichiers).filter((rel) => rel.startsWith("Deck ")).map((rel) => rel.split("/")[0])).size;
      // la révision n'est sûre que si personne d'autre n'a écrit pendant l'envoi
      const sure = revision === l.revision + lots.length;
      e = { email: compte.email, revision: sure ? revision : null, fichiers, derniere: Date.now() / 1000, decks: nb };
      await BD.ecrire(ETAT, e);
      // à la connexion, seConnecter refait les pages une seule fois, à la fin
      if (touches.size && !enConnexion) await recalculer(null, touches, true);
      if (recus.includes(REG_CARTES) && !enConnexion) await appliquerReglages(dep.fichiers[REG_CARTES]);     // changés sur un autre appareil
      if (conflits.length) setTimeout(() => planifierSauvegarde(1000));   // la liste d'en face, gardée dans l'historique, part aussi
      if (recus.includes("Réglages Atelier/pont.json")) setTimeout(() => chercherPc().catch(() => {}));   // l'Atelier d'un PC
      return { envoyes: envois.length + retraits.length, recus: recus.length, decks: nb, touches: [...touches],
        reglages: recus.includes(REG_CARTES),
        conflits: [...new Set(conflits.filter((rel) => rel.endsWith("/archidekt.txt")).map((rel) => rel.split("/")[0]))].sort(),
        decks_recus: PAGES.decksDe(f).filter((x) => !avantDecks.has(x)).sort() };
    }
    throw new Error("Le compte change trop vite : réessaie dans un instant.");
  }
  // en fond : après une série de modifications, au lancement, au retour sur l'appli et toutes les cinq minutes (un autre
  // appareil a pu changer un deck) ; la page se refait si des fichiers sont arrivés
  let minuteurSauvegarde = null;
  async function sauvegarderEnFond() {
    if (!compte) return;
    const r = await sauvegarder().catch(() => null);
    if (r && r.recus && window.route && T.pret && document.querySelector("#modale")?.hidden !== false) route();
  }
  function planifierSauvegarde(ms = CALME) {
    clearTimeout(minuteurSauvegarde);
    minuteurSauvegarde = setTimeout(sauvegarderEnFond, ms);
  }
  async function etatSauvegarde() {
    const e = await lEtat();
    return { connecte: !!compte, email: compte ? compte.email : null, pseudo: compte ? compte.pseudo : null, synchro: "auto", en_cours: !!sauvegarde,
      derniere: e.derniere || null, erreur: compte ? erreurSauvegarde : "", decks: e.decks ?? null };
  }
  async function exporterCompte() {                   // tout ce que garde le compte, dans un fichier (format atelier-mtg-appli)
    const d = await serveur("/compte/export");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([JSON.stringify(d)], { type: "application/json" })), download: `atelier-mtg-${String(d.date || "").slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  // les demandes de l'écran Compte (app.js › optionsCompte ; sur le PC, app.py › api_compte…)
  async function routeCompte(p, methode, b) {
    if (methode === "GET") {
      if (p === "/api/compte") return etatSauvegarde();
      if (p === "/api/compte/appareils") return serveur("/appareils");
      return undefined;
    }
    if (p === "/api/compte/synchroniser") { await envoyer().catch(() => {}); return { resume: await sauvegarder(), etat: await etatSauvegarde() }; }
    if (p === "/api/compte/appareils/oublier") return serveur(`/appareils/${encodeURIComponent(b.id)}`, "DELETE");
    if (p === "/api/compte/exporter") { await exporterCompte(); return { ok: true }; }
    if (p === "/api/compte/deconnexion") { await deconnecter(); return { ok: true }; }
    if (p === "/api/compte/supprimer") { await serveur("/compte", "DELETE", { email: b.email }); await deconnecte(true); return { ok: true }; }
    return undefined;
  }

  // les pages des decks, puis l'accueil, rangées comme celles du PC ; un calcul à la fois (d vide : les fichiers du
  // téléphone au moment du calcul). touches : les decks à refaire (null : tous ; BESOIN : ceux faits sans la base de
  // cartes, ou il y a plus d'une semaine) ; et toujours ceux qui n'ont pas de page ou dont les fichiers ont changé
  // depuis. distant : une page que le compte a déjà, faite par un autre appareil pour les mêmes fichiers, est reprise
  // telle quelle au lieu d'être refaite. {faites, recues, ameliorees (faites avec la base, sans elle avant)}
  let calculs = Promise.resolve();
  function recalculer(d, touches = null, distant = false) {
    const p = calculs.then(async () => recalculerMaintenant(d || await depot(), touches, distant));
    calculs = p.catch(() => {});
    return p;
  }
  async function recalculerMaintenant(d, touches, distant) {
    const f = d.fichiers, o = outilsPages(f), ids = PAGES.decksDe(f), emp = await empreintes(await shasDe(f));
    const ancien = (await fichier("index.json.gz")) || { decks: {} }, pages = {}, decks = {}, gardees = {};
    for (const id of ids) gardees[id] = await BD.lire("decks/" + id).catch(() => null);
    const t = Date.now() / 1000, niveau = (id) => (gardees[id] && gardees[id].empreinte === emp[id] ? gardees[id].niveau ?? 0 : -1);
    const aRefaire = (id) => {
      const g = gardees[id];
      if (!g || !g.donnees || !ancien.decks[id] || (g.empreinte && g.empreinte !== emp[id])) return true;
      if (touches === BESOIN) return etatBase.prete && (!(g.niveau >= 2) || t - (g.donnees.date || 0) > SEMAINE);
      return !touches || touches.has(id);
    };
    const aFaire = new Set(ids.filter(aRefaire)), recues = new Set();
    let duCompte = null;
    if (distant && compte && aFaire.size) {
      duCompte = await pagesDuCompte().catch(() => ({}));
      const voulues = [...aFaire].filter((id) => {
        const x = duCompte[id], n = niveau(id);
        return x && x.empreinte === emp[id] && (x.niveau > n || (x.niveau === n && x.maj > (((gardees[id] || {}).donnees || {}).date || 0) + 60));
      });
      if (suivi && voulues.length) suivi(0, 0);
      await enParallele(voulues, 4, async (id) => {
        const x = await lirePage(id).catch(() => null);
        if (!x || x.empreinte !== emp[id] || !x.donnees || !x.donnees.api) return;
        gardees[id] = { sha: "compte", empreinte: x.empreinte, niveau: x.niveau, donnees: x.donnees };
        await BD.ecrire("decks/" + id, gardees[id]);
        recues.add(id);
      });
      for (const id of recues) {
        await garderAnalyse(id, gardees[id].donnees, f).catch(() => {});
        if (!(etatBase.prete && gardees[id].niveau < 2)) aFaire.delete(id);
      }
    }
    let fait = 0, ameliorees = 0;
    const faites = [];
    for (const id of ids) {
      const k = "decks/" + id;
      if (aFaire.has(id)) {
        if (suivi) suivi(fait++, aFaire.size);
        const avant = gardees[id] ? gardees[id].niveau ?? 0 : -1;
        pages[id] = await PAGES.deck(id, f, { ...o, modifie: (d.modifies || {})[id] || 0 });
        const nv = niveauDe(id, pages[id]);
        if (avant >= 0 && avant < 2 && nv >= 2) ameliorees++;
        await BD.ecrire(k, { sha: "local", empreinte: emp[id], niveau: nv, donnees: pages[id] });
        faites.push(id);
      } else pages[id] = gardees[id] ? gardees[id].donnees : await fichier(k);
      decks[id] = k;
    }
    for (const k of await BD.cles()) if (String(k).startsWith("decks/") && !Object.values(decks).includes(k)) await BD.effacer(k);
    // l'accueil : celui du compte, s'il est tiré des mêmes fichiers et que rien n'a été refait ici ; sinon fait ici, avec
    // les fiches du classeur déjà connues (l'accueil d'avant, ou celui du compte) : seules les nouvelles cartes sont demandées
    const avant = await BD.lire("index.json.gz").catch(() => null);
    let api = null, source = avant && avant.donnees, niveauIndex = etatBase.prete ? 2 : 0, origine = "local";
    if (distant && compte && (!avant || avant.empreinte !== emp[INDEX_PAGES] || recues.size)) {
      const x = (duCompte || await pagesDuCompte().catch(() => ({})))[INDEX_PAGES];
      const lu = x && (x.empreinte === emp[INDEX_PAGES] || !source) ? await lirePage(INDEX_PAGES).catch(() => null) : null;
      if (lu && lu.donnees && lu.donnees.api) {
        if (lu.empreinte === emp[INDEX_PAGES] && !faites.length) {
          api = { ...lu.donnees.api };
          niveauIndex = lu.niveau;
          origine = "compte";
          source = lu.donnees;
        } else if (!source) source = lu.donnees;
      }
    }
    const frais = !source || (touches === BESOIN && etatBase.prete && t - (source.date_fiches || source.date || 0) > SEMAINE);
    if (touches === BESOIN && !faites.length && !recues.size && !frais && avant && avant.empreinte === emp[INDEX_PAGES]
        && avant.niveau >= niveauIndex) return { faites, recues: [], ameliorees };      // rien de changé
    if (!api) {
      const connues = new Map();
      if (!frais) for (const x of ((source.api || {})["/api/classeur"] || {}).cartes || []) if (x.info && x.info.nom) connues.set(x.nom, x.info);
      const fiches = async (noms) => {
        const res = {}, reste = [];
        for (const n of noms) if (connues.has(n)) res[n] = connues.get(n); else reste.push(n);
        return reste.length ? { ...res, ...(await o.fiches(reste)) } : res;
      };
      api = await PAGES.index(f, pages, { ...o, fiches });
    }
    api["/api/options"] = options();
    const dateFiches = origine === "compte" ? source.date_fiches || source.date : frais ? t : source.date_fiches || source.date || t;
    await BD.ecrire("index.json.gz", { sha: origine, empreinte: emp[INDEX_PAGES], niveau: niveauIndex, donnees: { format: FORMAT,
      date: t, date_fiches: dateFiches, version: "", compte: null, reglages: window.REGLAGES, decks, api, source: null, branche: null, local: true } });
    memoire.clear();
    fusion = null;
    connus = null;
    await majSlugs().catch(() => {});
    setTimeout(() => spellbookEnFond(touches instanceof Set ? [...touches] : ids), 1000);
    if (compte && (faites.length || origine === "local")) { pagesAEnvoyer = true; planifierEnvoiPages(8000); }
    return { faites, recues: [...recues], ameliorees };
  }
  // ce qui n'est pas encore parti vers le compte ne vit qu'ici : on demande au navigateur de ne pas l'effacer
  function garderDonnees() {
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (e) { /* navigateur ancien */ }
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
    const texte = (await depot()).fichiers[`${id}/${fichier}`];
    if (texte == null) throw new Error(`version introuvable : ${fichier}`);
    const v = ((await api(`/api/decks/${id}/versions`).catch(() => [])).find((x) => x.fichier === fichier) || {}).nom || fichier;
    const prec = await api(`/api/decks/${id}`), entrees = MOTEUR.lire(texte), infos = {};
    for (const e of entrees) if (!prec.cartes.some((c) => c.nom === e.nom)) infos[e.nom] = await ficheCarte(e.nom);
    const page = MOTEUR.page(id, entrees, prec, infos, budget());
    await surcharger({ [`/api/decks/${id}`]: page, [`/api/decks/${id}/export?format=archidekt`]: MOTEUR.texte(entrees) });
    await enAttente({ f: "restaurer", deck: id, fichier, raison: `retour à « ${v} »` });
    return copie(page);
  }

  // ------------------------------------------------------------------ l'appli installée sur l'écran d'accueil
  const installee = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const iphone = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let invite = null;                                   // Android : la demande d'installation du navigateur
  if (!VOIR) addEventListener("beforeinstallprompt", (ev) => { ev.preventDefault(); invite = ev; bandeauInstaller(); });
  addEventListener("appinstalled", () => { const b = document.getElementById("tel-bandeau"); if (b) b.remove(); });
  if (!VOIR && "serviceWorker" in navigator) navigator.serviceWorker.register(new URL("sw.js", ICI)).catch(() => {});

  // ouverte dans le navigateur (par le QR code) : un bandeau en bas propose de l'installer, tant qu'elle ne l'est pas.
  // Android : le bouton ouvre la demande du navigateur ; iPhone : la marche à suivre (Safari n'a pas de bouton).
  const PLUS_TARD = "telephone-installer-plus-tard";
  // la hauteur du bandeau du bas (--tel-bandeau) : ce qui est collé en bas de l'écran passe au-dessus
  let suitBandeaux = false;
  function majBandeau() {
    if (!document.body) return;
    if (!suitBandeaux) {
      suitBandeaux = true;
      new MutationObserver(majBandeau).observe(document.body, { childList: true });
      addEventListener("resize", majBandeau);
    }
    const b = document.querySelector("body > .tel-bandeau");
    document.documentElement.style.setProperty("--tel-bandeau", b ? b.offsetHeight + 12 + "px" : "0px");
  }
  function bandeauInstaller() {
    if (ORDI || installee() || !local || T.pseudoRequis || !document.body) return;     // ordinateur : l'Atelier à installer, c'est l'autre
    if (Date.now() - Number(lireLocal(PLUS_TARD) || 0) < 3 * 86400 * 1000) return;
    let b = document.getElementById("tel-bandeau");
    if (!b) {
      b = document.createElement("div");
      b.id = "tel-bandeau";
      b.className = "tel-bandeau";
      b.setAttribute("role", "region");
      b.setAttribute("aria-label", "Ajouter à l'écran d'accueil");
      document.body.appendChild(b);
    }
    b.innerHTML = `<div class="tel-bandeau-texte"><strong>Ajoute l'Atelier à ton écran d'accueil</strong>
        <span>${invite ? "Elle s'ouvrira depuis son icône, même sans réseau."
          : iphone ? "Touche Partager <span class=\"tel-partager\" aria-hidden=\"true\">⬆</span>, puis «&nbsp;Sur l'écran d'accueil&nbsp;». Ouvre-la ensuite depuis son icône et connecte-toi."
          : "Menu du navigateur ⋮, puis «&nbsp;Installer l'application&nbsp;» ou «&nbsp;Ajouter à l'écran d'accueil&nbsp;»."}</span></div>
      <div class="tel-bandeau-boutons">
        ${invite ? `<button class="btn btn-accent btn-petit" id="tel-installer-oui">Ajouter</button>` : ""}
        <button class="btn btn-discret btn-petit" id="tel-installer-non">Plus tard</button></div>`;
    const oui = b.querySelector("#tel-installer-oui");
    if (oui) oui.onclick = async () => {
      invite.prompt();
      const r = await invite.userChoice.catch(() => ({}));
      invite = null;
      if (r.outcome === "accepted") b.remove(); else bandeauInstaller();
    };
    b.querySelector("#tel-installer-non").onclick = () => { ecrireLocal(PLUS_TARD, String(Date.now())); b.remove(); };
    majBandeau();
  }

  const e = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // l'écran de connexion : l'adresse e-mail, puis le code reçu (le même geste crée le compte). Pour les decks d'avant les
  // comptes : ceux gardés ici partent dans le compte à la connexion ; ceux d'un PC relié, c'est le PC qui les envoie
  // le pseudo (à l'inscription, ou à l'ouverture pour un compte d'avant) : l'adresse de ses decks se lit pendant qu'on l'écrit
  const HTML_PSEUDO = `<form id="tel-form-pseudo">
      <div class="form-ligne"><input class="champ" id="tel-pseudo" autocapitalize="none" autocomplete="username" spellcheck="false" maxlength="30"
        placeholder="ton-pseudo" aria-label="Pseudo" required><button class="btn btn-accent">Valider</button></div>
      <p class="muet petit tel-adresse">atelier-mtg.com/decks/<strong id="tel-pseudo-vu">ton-pseudo</strong>/</p></form>`;
  function lierPseudo(zone, erreur, fini) {
    const f = zone.querySelector("#tel-form-pseudo"), champ = f.querySelector("#tel-pseudo"), vu = f.querySelector("#tel-pseudo-vu");
    const occupe = (oui) => f.querySelectorAll("button, input").forEach((x) => { x.disabled = oui; });
    champ.oninput = () => {
      const v = champ.value.toLowerCase().replace(/\s+/g, "-");
      if (v !== champ.value) champ.value = v;
      vu.textContent = v || "ton-pseudo";
    };
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      erreur("");
      occupe(true);
      try { await choisirPseudo(champ.value); fini(); }
      catch (err) { erreur(err.message); occupe(false); champ.focus(); }
    };
    champ.focus();
  }
  function attenteVue(el) {
    if (compte && T.pseudoRequis) {
      el.innerHTML = `<div class="tel-accueil"><div class="tel-marque"><h1>Atelier MTG</h1></div>
        <section class="tel-choix"><h2>Ton pseudo</h2>${HTML_PSEUDO}<p class="erreur" id="tel-erreur" hidden></p></section></div>`;
      const z = el.querySelector("#tel-erreur");
      lierPseudo(el, (m) => { z.textContent = m; z.hidden = !m; }, () => T.pseudoFait && T.pseudoFait());
      return;
    }
    if (!compte) {
      const creer = /inscription/.test(location.hash);
      el.innerHTML = `<div class="tel-accueil">
        <div class="tel-marque"><h1>Atelier MTG</h1>
          <p class="tel-accroche">Tes decks Commander, partout.</p></div>
        <section class="tel-choix">
          <h2>${creer ? "Créer ton compte" : "Connexion"}</h2>
          ${ANCIEN_LOCAL || lireLocal(DEMENAGE) ? `<p>Connecte-toi pour garder les decks de ${CET_APPAREIL} : ils rejoignent ton compte.</p>` : ""}
          ${ANCIEN_PC ? `<p>Tes decks passent maintenant par ton compte. Sur ton PC : mets l'Atelier à jour, puis « Passer en ligne ».</p>` : ""}
          <form class="form-ligne" id="tel-form-email">
            <input class="champ" id="tel-email" type="email" autocomplete="email" placeholder="ton@adresse.fr" aria-label="Adresse e-mail" required>
            <button class="btn btn-accent">Recevoir un code</button></form>
          <form id="tel-form-code" hidden>
            <p id="tel-envoye"></p>
            <div class="form-ligne"><input class="champ" id="tel-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456" aria-label="Code reçu" required>
              <button class="btn btn-accent">Valider</button></div>
            <button type="button" class="lien-discret" id="tel-autre">Changer d'adresse</button></form>
          <p class="erreur" id="tel-erreur" hidden></p>
          <p class="chargement" id="tel-progres" hidden></p>
        </section>
        ${ANCIEN_LOCAL ? `<button class="lien-discret" id="tel-fichier">Enregistrer mes decks dans un fichier</button>` : ""}
        <a class="tel-decouvrir" href="https://atelier-mtg.com/fr/">C'est quoi, l'Atelier MTG ?</a>
      </div>`;
      const $ = (s) => el.querySelector(s), fe = $("#tel-form-email"), fc = $("#tel-form-code");
      const erreur = (m) => { $("#tel-erreur").textContent = m; $("#tel-erreur").hidden = !m; };
      const occupe = (f, oui) => f.querySelectorAll("button, input").forEach((x) => { x.disabled = oui; });
      fe.onsubmit = async (ev) => {
        ev.preventDefault();
        const email = $("#tel-email").value.trim();
        erreur("");
        occupe(fe, true);
        try {
          await demanderCode(email);
          $("#tel-envoye").innerHTML = `Code envoyé à <strong>${e(email)}</strong>.`;
          fe.hidden = true;
          fc.hidden = false;
          fc.dataset.email = email;
          $("#tel-code").focus();
        } catch (err) { erreur(err.message); }
        occupe(fe, false);
      };
      // code bon : à la place du formulaire, la préparation des decks (gardés ici ou arrivés du compte) et son avancement
      let prepare = false;
      const progres = (fait, total) => {
        if (!prepare) {
          prepare = true;
          el.querySelectorAll(".tel-choix > :not(h2), #tel-fichier").forEach((x) => { x.hidden = true; });
          $(".tel-choix h2").textContent = "Bienvenue";
          $("#tel-progres").hidden = false;
        }
        $("#tel-progres").textContent = total ? `Préparation de tes decks : ${fait + 1}/${total}` : "Préparation de tes decks…";
      };
      // code bon, compte sans pseudo : il le choisit avant d'entrer
      const pseudo = () => new Promise((ok) => {
        el.querySelectorAll(".tel-choix > :not(h2, #tel-erreur), #tel-fichier").forEach((x) => { x.hidden = true; });
        $(".tel-choix h2").textContent = "Ton pseudo";
        $(".tel-choix h2").insertAdjacentHTML("afterend", HTML_PSEUDO);
        lierPseudo(el, erreur, ok);
      });
      fc.onsubmit = async (ev) => {
        ev.preventDefault();
        erreur("");
        occupe(fc, true);
        try { await seConnecter(fc.dataset.email, $("#tel-code").value, progres, pseudo); }
        catch (err) {
          if (prepare) { location.hash = "#/"; location.reload(); return; }   // connecté : l'appli finit au démarrage
          erreur(err.message);
          occupe(fc, false);
        }
      };
      $("#tel-autre").onclick = () => { fc.hidden = true; fe.hidden = false; erreur(""); $("#tel-email").focus(); };
      if ($("#tel-fichier")) $("#tel-fichier").onclick = () => enregistrerFichier().catch((err) => erreur(err.message));
      return;
    }
    el.innerHTML = T.erreur ? `<div class="tel-accueil"><h1>Atelier MTG</h1><p class="erreur">${e(T.erreur)}</p>
        <button class="btn" id="tel-reessayer">Réessayer</button></div>`
      : `<p class="chargement">Chargement de tes decks…</p>`;
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
    if (!local) return window.route && route();         // pas connecté : l'écran de connexion
    if (!compte.pseudo) {                               // compte d'avant le pseudo à l'inscription (hors ligne : plus tard)
      const c = await serveur("/compte").catch(() => null);
      if (c && c.pseudo) {
        compte.pseudo = c.pseudo;
        ecrireLocal(COMPTE, JSON.stringify(compte));
        marquerCompte();
      } else if (c) {
        T.pseudoRequis = true;
        if (window.route) route();
        await new Promise((ok) => { T.pseudoFait = ok; });
        T.pseudoRequis = false;
      }
    }
    preparerBase();
    bandeauInstaller();
    envoyer().catch(() => {});                            // ce qui n'était pas parti (hors ligne)
    try { await synchroniser(); T.erreur = ""; } catch (err) { T.erreur = err.message; }
    await majSlugs().catch(() => {});
    await reprendreDemenagement().catch(() => {});
    T.pret = true;
    setTimeout(() => publierManquants().catch(() => {}), 5000);
    chercherPc().catch(() => {});
    if (window.route) route();
    setTimeout(async () => spellbookEnFond(PAGES.decksDe((await depot()).fichiers)), 3000);
    pagesAEnvoyer = true;                                 // après la synchronisation : celles faites ici, pour les autres
    sauvegarderEnFond();
  }

  // ------------------------------------------------------------------ fichier de sauvegarde
  // Tout ce que l'appli garde dans ce navigateur (decks, réglages), sauf la base de cartes et la connexion au compte.
  // Même format que l'export du compte (serveur › exporter) : il s'importe ici (importerDecks) et sur le PC.
  const FICHIER_SAUVEGARDE = "atelier-mtg-appli";
  const PAS_DANS_LE_FICHIER = new Set(["@base", "@github", ETAT]), PAS_DANS_LE_FICHIER_LOCAL = new Set([COMPTE, "telephone-acces"]);
  async function enregistrerFichier() {
    const fichiers = {}, locaux = {};
    for (const k of await BD.cles()) if (!PAS_DANS_LE_FICHIER.has(k)) fichiers[k] = await BD.lire(k);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!PAS_DANS_LE_FICHIER_LOCAL.has(k)) locaux[k] = localStorage.getItem(k);
      }
    } catch (_) {}
    const d = { format: FICHIER_SAUVEGARDE, version: 1, date: new Date().toISOString(), fichiers, local: locaux };
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([JSON.stringify(d)], { type: "application/json" })), download: `atelier-mtg-${d.date.slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  // un fichier de sauvegarde (le sien, ou l'export du compte) : ses decks rejoignent ceux d'ici, comme sur le PC
  // (decks.importer_appli) : même liste → déjà là ; une autre liste du même nom → un nom libre ; le classeur, s'il n'y en
  // a pas encore. null si ce n'est pas un tel fichier
  async function importerAppli(texte) {
    let d = null;
    try { d = JSON.parse(texte); } catch (_) { return null; }
    if (!d || d.format !== FICHIER_SAUVEGARDE) return null;
    const src = (((d.fichiers || {})["@depot"] || {}).fichiers) || {}, parDossier = new Map();
    for (const [rel, t] of Object.entries(src)) {
      const parts = rel.split("/");
      if (typeof t !== "string" || parts.length < 2 || rel.includes("\\") || rel.includes(":") || parts.some((x) => !x.trim() || x.startsWith("."))) continue;
      if (!parDossier.has(parts[0])) parDossier.set(parts[0], {});
      parDossier.get(parts[0])[parts.slice(1).join("/")] = t;
    }
    return avecVerrou(async () => {
      const dep = await depot(), f = dep.fichiers, crees = [], deja = [];
      const pris = new Set(Object.keys(f).map((rel) => rel.split("/")[0].toLowerCase()));
      for (const [dossier, contenu] of parDossier) {
        if (dossier.startsWith("Deck ") && "archidekt.txt" in contenu) {
          if (f[`${dossier}/archidekt.txt`] === contenu["archidekt.txt"]) { deja.push(dossier); continue; }
          const id = pris.has(dossier.toLowerCase()) ? MOTEUR.dossier(nomLibre(dossier.replace(/^Deck /, ""), pris)) : dossier;
          pris.add(id.toLowerCase());
          for (const [rel, t] of Object.entries(contenu)) f[`${id}/${rel}`] = t;
          dep.modifies = { ...(dep.modifies || {}), [id]: Date.now() / 1000 };
          crees.push(id);
        } else if (dossier === "Classeur" && !f["Classeur/classeur.txt"]) {
          for (const [rel, t] of Object.entries(contenu)) f[`Classeur/${rel}`] = t;
        }
      }
      await BD.ecrire("@depot", dep);
      await recalculer(dep, new Set(crees));
      planifierSauvegarde();
      return { decks: crees, deja };
    });
  }

  // les decks reçus d'une ancienne adresse (demenagement.html) rejoignent le compte, comme un fichier de sauvegarde :
  // même liste → déjà là, autre liste du même nom → un nom libre
  async function reprendreDemenagement() {
    const l = await BD.lire(DEMENAGEMENT).catch(() => null);
    if (!Array.isArray(l) || !l.length) return ecrireLocal(DEMENAGE, null);
    let n = 0;
    for (const d of l) n += ((await importerAppli(JSON.stringify(d))) || { decks: [] }).decks.length;
    await BD.effacer(DEMENAGEMENT);
    ecrireLocal(DEMENAGE, null);
    if (n && window.toast) toast(n > 1 ? `${n} decks ajoutés depuis l'ancienne adresse.` : "1 deck ajouté depuis l'ancienne adresse.", 5000);
  }

  // ------------------------------------------------------------------ voir/ : le lien instantané d'un deck
  // Le lien contient la liste du deck (app.js › lienInstantane : JSON compressé en deflate-raw, en base64url, après « # » :
  // le navigateur ne l'envoie à aucun serveur). Sa page est faite ici comme celle d'un deck sans PC (pages.js), avec la
  // base de cartes si ce navigateur l'a déjà, sinon Scryfall, et Commander Spellbook par le relais ; puis app.js la montre
  // comme une page partagée (partage.js › capturer), en lecture seule.
  async function lireLien(code) {
    const b = code.replace(/-/g, "+").replace(/_/g, "/");
    const octets = Uint8Array.from(atob(b + "=".repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
    return JSON.parse(await new Response(new Blob([octets]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text());
  }
  // les Game Changers sans la base de cartes : la liste officielle, chez Scryfall (bracket.game_changers)
  async function gameChangersScryfall() {
    const noms = [];
    for (let url = `${SCRYFALL}/cards/search?q=${encodeURIComponent("is:gamechanger")}&unique=cards`; url;) {
      const r = await scryfall(url);
      if (!r) break;
      noms.push(...r.data.map((c) => c.name));
      url = r.has_more ? r.next_page : null;
    }
    return noms;
  }
  async function voir() {
    let d = null;
    try { d = await lireLien(location.hash.slice(1)); } catch (_) { /* lien abîmé */ }
    const texte = String((d && d.l) || ""), entrees = texte ? MOTEUR.lire(texte) : [];
    if (!entrees.length) throw new Error("Ce lien ne contient pas de deck : il a peut-être été coupé en route.");
    const titre = String(d.t || "").replace(/^Deck /, "").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 80) || "partagé";
    const id = "Deck " + titre, f = { [`${id}/archidekt.txt`]: texte };
    document.title = `${titre} · Atelier MTG`;
    window.REGLAGES = { ...(window.REGLAGES || {}), budget: Number(d.b) || 0 };     // le budget de celui qui partage
    if (await BD.lire("@base").catch(() => null)) await laBase().catch(() => {});   // déjà gardée par l'appli : les fonctions des cartes
    await analyserSpellbook("@voir", entrees).catch(() => {});                     // combos et bracket (retrouvés par la liste)
    const o = outilsPages(f);
    o.fiches = (noms) => fiches(noms);
    if (!etatBase.prete) { const gc = await gameChangersScryfall().catch(() => []); o.gcListe = async () => gc; }
    const p = await PAGES.deck(id, f, { ...o, modifie: 0 });
    const pt = PARTAGE_TELEPHONE({ api, scryfall: (url, corps) => scryfall(url, corps), page: async () => p,
      lire: (k) => BD.lire(k).catch(() => null), ecrire: (k, v) => BD.ecrire(k, v),
      serveur: async () => { throw new Error("Pas de compte ici."); }, reglages: () => ({ budget: budget(), sans_ub_illustrations: false }) });
    window.PARTAGE = { reglages: { budget: budget(), sans_ub_illustrations: false }, atelier: "https://github.com/PierreRibeaucourt/atelier-mtg",
      auteur: null, version: "", ...(await pt.capturer(id)), accueil: "../", titre_accueil: "Atelier MTG", instantane: true };
    const s = document.createElement("script");
    s.src = VOIR;
    s.onload = () => document.documentElement.classList.remove("voir-attente");
    document.body.append(s);
  }
  if (VOIR) {
    voir().catch((err) => {
      document.getElementById("vue").innerHTML = `<div class="panneau"><p class="erreur">${e(err.message)}</p>
        <p><a href="../">Ouvrir l'Atelier MTG</a></p></div>`;
    });
    return;
  }

  // la table de jeu (jouer/, jouer-appli.js) : le deck et ses jetons, gardés ici pour la page qui s'ouvre
  async function preparerJeu(id) {
    const page = await api(`/api/decks/${encodeURIComponent(id)}`);
    const jetons = await api(`/api/jouer/jetons?deck=${encodeURIComponent(id)}`).catch(() => ({ jetons: [] }));
    await BD.ecrire("@jouer", { deck: id, quand: Date.now(), api: { [`/api/decks/${id}`]: page, [`/api/jouer/jetons?deck=${id}`]: jetons } });
  }

  const T = window.TELEPHONE = {
    api, attente: attenteVue, pret: false, erreur: "", slug: slugDe, deckDeSlug,      // l'adresse des decks (app.js › adresseDeRoute)
    enAttente: async () => (await attente()).length,
    envoyer: () => envoyer(),
    local,
    compte: () => compte && { email: compte.email },
    synchroniser: () => demarrer(),
    installee,
    installer: () => { ecrireLocal(PLUS_TARD, "0"); bandeauInstaller(); },     // Options : le bandeau, même après « Plus tard »
    enregistrerFichier,
    preparerJeu,
    appairerModule, chercherPc: () => chercherPc().catch(() => {}), moduleVu: () => lireLocal(MODULE_VU) === "1",   // le module Claude
    ordi: ORDI,                                                       // (app.js › vueModule, surPC)
  };

  demarrer();
  if (local) garderDonnees();
  // un autre appareil a pu changer un deck : un coup d'œil au compte au retour sur l'appli, et toutes les cinq minutes
  document.addEventListener("visibilitychange", () => { if (!document.hidden && local) planifierSauvegarde(500); });
  setInterval(() => { if (!document.hidden && local) sauvegarderEnFond(); }, DISTANT);
})();
