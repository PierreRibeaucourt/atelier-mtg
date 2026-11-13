// Partager un deck depuis le téléphone, sans PC : partage.py refait en JavaScript. La page publiée est celle du PC
// (l'interface de l'Atelier figée avec les données du deck, son image d'aperçu, sa table de jeu), dans le même site
// GitHub Pages du compte (<compte>.github.io, ou son dépôt « decks »), avec le même registre (decks.json) : le PC et le
// téléphone publient au même endroit, et chacun reprend ce que l'autre a publié.
// Ce qui ne part jamais : le classeur, les achats, les cartes écartées des suggestions.
// PARTAGE_TELEPHONE(o) : o.api (l'API du téléphone), o.compte() → {jeton, compte} ou null, o.gh(jeton, méthode, url,
// corps), o.page(id) → la page du deck faite ici ({api, comparer}), o.lire / o.ecrire (IndexedDB), o.scryfall(url, corps),
// o.reglages() → {budget, sans_ub_illustrations}.
"use strict";
const PARTAGE_TELEPHONE = (o) => {
  const NOM_DEPOT = "decks", DESCRIPTION = "Decks Commander partagés avec l'Atelier MTG", A_PROPOS = "a-propos";
  const ACCUEIL_ATELIER = "https://atelier-mtg.com/";
  const ATELIER = "https://github.com/PierreRibeaucourt/atelier-mtg";
  const VERSION = "__VERSION_ATELIER__";               // version.py, écrite par telephone_site.py
  const ETAT = "@partage";                             // {compte, depot, branche, site, reg} : le dernier registre lu
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
  async function shaGit(x) {                                                         // github.sha_blob
    const b = octets(x), t = enc.encode(`blob ${b.length}\0`), tout = new Uint8Array(t.length + b.length);
    tout.set(t); tout.set(b, t.length);
    return sha1(tout);
  }
  function base64(b) {
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const att = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  async function texte(chemin) {                       // un fichier de l'appli (modèles de page, app.js, style.css)
    const r = await fetch(chemin, { cache: "no-cache" });
    if (!r.ok) throw new Error("Pas de réseau : la page n'a pas pu être préparée.");
    return (await r.text()).replace(/\r\n/g, "\n");
  }
  function slugDe(deck, reg) {                         // partage._slug
    if (reg[deck]) return reg[deck].slug;
    const base = deck.replace(/^Deck /, "").normalize("NFD").replace(/[^\x00-\x7f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "deck";
    const pris = new Set([...Object.values(reg).map((v) => v.slug), A_PROPOS]);
    let s = base, i = 2;
    while (pris.has(s)) s = `${base}-${i++}`;
    return s;
  }

  // ------------------------------------------------------------------ GitHub
  async function connexion() {
    const g = await o.compte();
    if (!g) throw Object.assign(new Error("Connecte ce téléphone à GitHub (compte gratuit)."), { statut: 401 });
    return { g, q: (methode, url, corps) => o.gh(g.jeton, methode, url, corps) };
  }
  // le site des pages : un site de l'Atelier qui existe déjà, sinon <compte>.github.io, créé ici (partage._site_atelier)
  async function leSite(g, q, creer = true) {
    const e = (await o.lire(ETAT)) || {};
    if (e.compte === g.compte && e.depot) return e;
    const login = g.compte, perso = `${login.toLowerCase()}.github.io`;
    const sites = { [perso]: `https://${perso}/`, [NOM_DEPOT]: `https://${perso}/${NOM_DEPOT}/` }, existants = {};
    for (const nom of Object.keys(sites)) {
      try { existants[nom] = await q("GET", `/repos/${login}/${nom}`); } catch (x) { if (x.statut !== 404) throw x; }
    }
    let nom = null;
    for (const [n, r] of Object.entries(existants)) {
      if (r.description === DESCRIPTION) { nom = n; break; }
      try { await q("GET", `/repos/${r.full_name}/contents/decks.json?ref=${encodeURIComponent(r.default_branch)}`); nom = n; break; }
      catch (x) { if (x.statut !== 404) throw x; }
    }
    if (!nom && !creer) return null;                   // rien de partagé sur ce compte : on ne crée rien pour regarder
    if (!nom) {
      nom = !existants[perso] ? perso : !existants[NOM_DEPOT] ? NOM_DEPOT : null;
      if (!nom) throw new Error(`Tes dépôts ${perso} et « ${NOM_DEPOT} » servent déjà à autre chose : l'Atelier n'y touche pas.`);
      existants[nom] = await q("POST", "/user/repos", { name: nom, description: DESCRIPTION, auto_init: true, has_issues: false,
        has_projects: false, has_wiki: false });
    }
    const r = existants[nom];
    if (nom === NOM_DEPOT && !r.has_pages) {
      try { await q("POST", `/repos/${r.full_name}/pages`, { source: { branch: r.default_branch, path: "/" } }); }
      catch (x) {
        if (x.statut !== 409) throw new Error(`Sur github.com, active les pages de ton dépôt « ${NOM_DEPOT} » (Settings › Pages › Deploy from a branch › ${r.default_branch}), puis repartage : ton site ${perso} sert déjà à autre chose.`);
      }
    }
    const s = { compte: login, depot: r.full_name, branche: r.default_branch, site: sites[nom], reg: e.compte === login ? e.reg || {} : {} };
    await o.ecrire(ETAT, s);
    return s;
  }
  // la tête de la branche du site, ses fichiers (chemin → sha) et son registre ; un dépôt tout juste créé met un instant
  // à être prêt
  async function lire(s, q) {
    for (let essai = 0; ; essai++) {
      try {
        const tete = (await q("GET", `/repos/${s.depot}/git/ref/heads/${encodeURIComponent(s.branche)}`)).object.sha;
        const arbre = (await q("GET", `/repos/${s.depot}/git/commits/${tete}`)).tree.sha;
        const t = await q("GET", `/repos/${s.depot}/git/trees/${arbre}?recursive=1`);
        if (t.truncated) throw new Error("Ton site de decks est trop grand pour le mettre à jour d'ici : fais-le sur le PC.");
        const fichiers = new Map(t.tree.filter((x) => x.type === "blob").map((x) => [x.path, x.sha]));
        let reg = {};
        if (fichiers.has("decks.json")) {
          const b = await q("GET", `/repos/${s.depot}/git/blobs/${fichiers.get("decks.json")}`);
          reg = JSON.parse(dec.decode(Uint8Array.from(atob(b.content.replace(/\n/g, "")), (c) => c.charCodeAt(0))));
        }
        return { tete, arbre, fichiers, reg };
      } catch (x) {
        if (![404, 409].includes(x.statut) || essai === 5) throw x;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  // un commit : les fichiers changés (sha différent), les effacés ; 422 : le site a changé entre-temps, tout est refait
  async function envoyer(s, q, faire) {
    for (let essai = 0; essai < 3; essai++) {
      const l = await lire(s, q), { fichiers, effacer, message, reg } = await faire(l);
      const entrees = [];
      for (const [chemin, contenu] of fichiers) {
        const b = octets(contenu);
        if (l.fichiers.get(chemin) === await shaGit(b)) continue;
        const blob = await q("POST", `/repos/${s.depot}/git/blobs`, { content: base64(b), encoding: "base64" });
        entrees.push({ path: chemin, mode: "100644", type: "blob", sha: blob.sha });
      }
      for (const chemin of effacer || []) if (l.fichiers.has(chemin) && !fichiers.has(chemin)) entrees.push({ path: chemin, mode: "100644", type: "blob", sha: null });
      let tete = l.tete;
      if (entrees.length) {
        const arbre = await q("POST", `/repos/${s.depot}/git/trees`, { base_tree: l.arbre, tree: entrees });
        const c = await q("POST", `/repos/${s.depot}/git/commits`, { message, tree: arbre.sha, parents: [l.tete] });
        try { await q("PATCH", `/repos/${s.depot}/git/refs/heads/${encodeURIComponent(s.branche)}`, { sha: c.sha }); tete = c.sha; }
        catch (x) { if (x.statut === 422) continue; throw x; }
      }
      await o.ecrire(ETAT, { ...s, reg });
      return tete;
    }
    throw new Error("Ton site de decks change trop vite : réessaie dans un instant.");
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
  async function imageAccueil(titre, sousTitre, images, arts) {
    const [c, ctx] = toile();
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgb(26,24,22)"; ctx.fillRect(0, 0, L, H);
    const fonds = (await Promise.all(arts.slice(0, 6).map(charge))).filter(Boolean);
    if (fonds.length) {                                // les illustrations en bandes verticales, floues et assombries
      const w = Math.floor(L / fonds.length);
      ctx.save(); ctx.filter = "blur(4px)";
      fonds.forEach((a, i) => { ctx.save(); ctx.beginPath(); ctx.rect(i * w, 0, i === fonds.length - 1 ? L - i * w : w, H); ctx.clip(); couvrir(ctx, a, i * w, 0, i === fonds.length - 1 ? L - i * w : w, H); ctx.restore(); });
      ctx.restore();
      ctx.fillStyle = "rgba(18,16,14,0.72)"; ctx.fillRect(0, 0, L, H);
    }
    let t = ajuste(ctx, titre, true, 64, L - 120, 40);
    ctx.fillStyle = "#fff"; ctx.fillText(titre, (L - ctx.measureText(titre).width) / 2, 54 + (64 - t) / 2);
    ajuste(ctx, sousTitre, false, 30, L - 120, 20);
    ctx.fillStyle = "rgb(225,220,212)"; ctx.fillText(sousTitre, (L - ctx.measureText(sousTitre).width) / 2, 142);
    const cartes = (await Promise.all(images.slice(0, 6).map(charge))).filter(Boolean);
    if (cartes.length) {
      const n = cartes.length, haut = 400, pas = Math.min(250, Math.floor((L - 160) / Math.max(1, n)));
      const angles = cartes.map((_, i) => (i - (n - 1) / 2) * 4), larg = Math.round(haut * 488 / 680);
      const [w0] = tailleTournee(larg + 80, haut + 80, angles[0]), x0 = Math.floor((L - (pas * (n - 1) + w0)) / 2);
      cartes.forEach((im, i) => {
        const [w, h] = tailleTournee(larg + 80, haut + 80, angles[i]);
        carte(ctx, im, haut, x0 + i * pas + w / 2, 215 + Math.round(Math.abs(angles[i]) * 3) + h / 2, -angles[i]);
      });
    }
    marque(ctx, cartes.length > 0);
    return jpeg(c);
  }

  // ------------------------------------------------------------------ les pages (partage._page, _page_jouer, _accueil)
  async function page(fichiers, dossier, donnees, entete) {
    const pre = dossier ? dossier + "/" : "", r = o.reglages();
    const tout = { reglages: { budget: r.budget, sans_ub_illustrations: !!r.sans_ub_illustrations }, atelier: ATELIER,
      auteur: entete.auteur || null, version: VERSION, ...donnees };
    const js = "window.PARTAGE = " + JSON.stringify(tout) + ";\n";
    const app = await texte("app.js"), style = await texte("style.css");
    fichiers.set(pre + "app.js", app).set(pre + "style.css", style).set(pre + "donnees.js", js);
    const v = { app: await version(app), style: await version(style), donnees: await version(js) };
    const e = Object.fromEntries(Object.entries(entete).map(([k, x]) => [k, typeof x === "string" ? att(x) : x]));
    const meta = [`<title>${e.titre}</title>`, `<meta name="description" content="${e.description}">`, `<link rel="canonical" href="${e.url}">`,
      '<meta name="robots" content="noindex">', '<meta property="og:type" content="website">', '<meta property="og:site_name" content="Atelier MTG">',
      '<meta property="og:locale" content="fr_FR">', `<meta property="og:url" content="${e.url}">`, `<meta property="og:title" content="${e.titre}">`,
      `<meta property="og:description" content="${e.description}">`];
    if (e.image) meta.push(`<meta property="og:image" content="${e.image}">`, '<meta property="og:image:type" content="image/jpeg">',
      '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
      `<meta property="og:image:alt" content="${e.alt}">`, '<meta name="twitter:card" content="summary_large_image">');
    else meta.push('<meta name="twitter:card" content="summary">');
    let html = await texte("partage/index.html");
    for (const [a, b] of [['<html lang="fr">', '<html lang="fr" class="partage">'], ["<title>Atelier MTG</title>", meta.join("\n  ")],
      ['href="/static/style.css"', `href="style.css?v=${v.style}"`], ['  <script src="/reglages.js"></script>\n', ""],
      ['<script src="/static/app.js"></script>', `<script src="donnees.js?v=${v.donnees}"></script>\n  <script src="app.js?v=${v.app}"></script>`]]) {
      if (!html.includes(a)) throw new Error("La page n'a pas pu être préparée : partage annulé.");
      html = html.replace(a, b);
    }
    fichiers.set(pre + "index.html", html);
    return v.donnees;
  }
  async function pageJouer(fichiers, dossier, vDonnees) {
    const js = await texte("partage/jouer.js"), css = await texte("partage/jouer.css");
    fichiers.set(`${dossier}/jouer/jouer.js`, js).set(`${dossier}/jouer/jouer.css`, css);
    let html = (await texte("partage/jouer.html")).replace("</title>", '</title>\n  <meta name="robots" content="noindex">')
      .replace('href="/static/jouer.css"', `href="jouer.css?v=${await version(css)}"`)
      .replace('<script src="/static/jouer.js"></script>', `<script src="../donnees.js?v=${vDonnees}"></script>\n  <script src="jouer.js?v=${await version(js)}"></script>`);
    if (html.includes("/static/")) throw new Error("La page « Jouer » n'a pas pu être préparée : partage annulé.");
    fichiers.set(`${dossier}/jouer/index.html`, html);
  }
  async function accueil(fichiers, effacer, reg, site, auteur, existants) {
    const resumes = Object.values(reg).map((r) => ({ ...r.resume })).sort((a, b) => (a.titre < b.titre ? -1 : a.titre > b.titre ? 1 : 0));
    const fonctions = await o.api("/api/recherche/fonctions").catch(() => []);
    const donnees = { accueil: true, date: Date.now() / 1000, liens: Object.fromEntries(Object.entries(reg).map(([k, v]) => [k, v.slug + "/"])),
      cartes: Object.fromEntries(Object.entries(reg).map(([k, v]) => [k, v.cartes || []])),
      api: { "/api/decks": resumes, "/api/corbeille": [], "/api/noms-cartes": { noms: [], communs: [] }, "/api/recherche/fonctions": fonctions } };
    const titres = liste(resumes.map((r) => r.titre)), n = resumes.length;
    const titre = auteur ? `Decks Commander de ${auteur}` : "Mes decks Commander";
    let image = null;
    try {
      const jpg = await imageAccueil(titre, n ? `${n} deck${n > 1 ? "s" : ""} : ${titres}` : "Aucun deck partagé",
        resumes.map((r) => r.image_cmd).filter(Boolean), resumes.map((r) => r.art).filter(Boolean));
      fichiers.set("partage.jpg", jpg);
      image = `partage.jpg?v=${await version(jpg)}`;
    } catch (_) { /* sans image : la page se partage quand même */ }
    await page(fichiers, "", donnees, { titre, auteur,
      description: n ? `${n} deck${n > 1 ? "s" : ""} Commander : ${titres}. Listes, visuels, statistiques, combos et table de jeu pour tester chaque deck.` : "Decks Commander.",
      url: site, image: image && site + image, alt: n ? `Les commandants des decks ${titres}` : "" });
    if (existants.has(`${A_PROPOS}/index.html`)) {     // partage._a_propos : l'ancienne copie devient une redirection
      for (const f of ["app.js", "style.css", "donnees.js"]) effacer.push(`${A_PROPOS}/${f}`);
      fichiers.set(`${A_PROPOS}/index.html`, `<!doctype html>\n<html lang="fr">\n<head>\n  <meta charset="utf-8">\n  <title>L'Atelier MTG</title>\n  <link rel="canonical" href="${ACCUEIL_ATELIER}">\n  <meta http-equiv="refresh" content="0; url=${ACCUEIL_ATELIER}">\n  <script>location.replace(${JSON.stringify(ACCUEIL_ATELIER)} + location.hash);</script>\n</head>\n<body>\n  <p><a href="${ACCUEIL_ATELIER}">L'Atelier MTG</a></p>\n</body>\n</html>\n`);
    }
    fichiers.set(".nojekyll", "");
    fichiers.set("decks.json", JSON.stringify(reg, null, 1));
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

  // ------------------------------------------------------------------ partager, retirer
  const etatDe = (s, deck) => (s && s.reg && s.reg[deck] ? { url: s.site + s.reg[deck].slug + "/", date: s.reg[deck].date } : {});
  // ce qu'on sait sans réseau ; frais : relu sur GitHub (le PC a pu partager entre-temps)
  async function etat(deck, frais = true) {
    const g = await o.compte(), e = await o.lire(ETAT);
    if (!g) return {};
    if (frais) {
      try {
        const { q } = await connexion(), s = await leSite(g, q, false);
        if (!s) return {};
        const l = await lire(s, q);
        await o.ecrire(ETAT, { ...s, reg: l.reg });
        return etatDe({ ...s, reg: l.reg }, deck);
      } catch (_) { /* pas de réseau : ce qu'on sait */ }
    }
    return e && e.compte === g.compte ? etatDe(e, deck) : {};
  }
  // publie (ou met à jour) les pages de ces decks, en un seul envoi
  async function partager(decks) {
    const { g, q } = await connexion(), s = await leSite(g, q), auteur = g.compte, prets = [];
    for (const deck of decks) {
      const donnees = await capturer(deck), d = donnees.api[`/api/decks/${deck}`], b = donnees.api[`/api/decks/${deck}/bracket`] || {};
      const cmds = d.commandants || [], couleurs = nomCouleurs(d.identite), nbGc = (d.gc || []).length;
      const chiffres = [`${d.total} cartes · ${euros(d.prix_total)}`,
        [b.estime ? `Bracket ${b.estime}` : "", `${nbGc} Game Changer${nbGc > 1 ? "s" : ""}`].filter(Boolean).join(" · ")];
      const cmdCartes = d.cartes.filter((c) => c.cat === "Commander" && c.info.image);
      let jpg = null;
      try {
        jpg = await imageDeck(d.titre, "Deck Commander" + (couleurs ? ` · ${couleurs}` : ""), cmds, cmdCartes.map((c) => c.info.image),
          d.art || (cmdCartes[0] && cmdCartes[0].info.art) || "", d.identite, chiffres, auteur);
      } catch (_) { /* sans image */ }
      prets.push({ deck, donnees, d, b, cmds, couleurs, jpg });
    }
    await envoyer(s, q, async (l) => {
      const reg = l.reg, fichiers = new Map(), effacer = [];
      for (const { deck, donnees, d, b, cmds, couleurs, jpg } of prets) {
        const slug = slugDe(deck, reg), url = `${s.site}${slug}/`, genre = `deck Commander ${couleurs}`.trim();
        let image = null;
        if (jpg) { fichiers.set(`${slug}/partage.jpg`, jpg); image = `partage.jpg?v=${await version(jpg)}`; }
        const description = `${genre[0].toUpperCase() + genre.slice(1)} de ${d.total} cartes` + (cmds.length ? ` autour de ${liste(cmds)}` : "")
          + `, pour ${euros(d.prix_total)}` + (b.estime ? `, bracket ${b.estime}` : "")
          + ` : liste, visuel, statistiques, combos et table de jeu pour le tester. Partagé par ${auteur}.`;
        const v = await page(fichiers, slug, { ...donnees, accueil: "../" }, { titre: `${d.titre} : ${genre}, par ${auteur}`, auteur,
          description, url, image: image && url + image, alt: `${d.titre} : carte de ${liste(cmds) || "son commandant"}, couleurs et chiffres du deck` });
        await pageJouer(fichiers, slug, v);
        const resume = Object.fromEntries(Object.entries(d).filter(([k]) => k !== "cartes" && k !== "categories"));
        if (!resume.image_cmd) resume.image_cmd = (d.cartes.find((c) => c.cat === "Commander" && c.info.image) || { info: {} }).info.image || "";
        if (!resume.art) resume.art = (d.cartes.find((c) => c.cat === "Commander" && c.info.art) || { info: {} }).info.art || "";
        reg[deck] = { slug, date: donnees.date, version: VERSION, resume, cartes: d.cartes.map((c) => [c.nom, c.info.fr || ""]) };
      }
      await accueil(fichiers, effacer, reg, s.site, auteur, l.fichiers);
      return { fichiers, effacer, reg, message: "Partage : " + prets.map((x) => x.d.titre).join(", ") };
    });
    return decks.length === 1 ? etatDe(await o.lire(ETAT), decks[0]) : {};
  }
  async function retirer(deck) {
    const { g, q } = await connexion(), s = await leSite(g, q, false);
    if (!s) return {};
    await envoyer(s, q, async (l) => {
      const reg = l.reg, fichiers = new Map(), effacer = [];
      const p = reg[deck];
      if (!p) return { fichiers, effacer, reg, message: "" };
      delete reg[deck];
      for (const chemin of l.fichiers.keys()) if (chemin.startsWith(p.slug + "/")) effacer.push(chemin);
      await accueil(fichiers, effacer, reg, s.site, g.compte, l.fichiers);
      return { fichiers, effacer, reg, message: `Retrait : ${deck.replace(/^Deck /, "")}` };
    });
    return {};
  }
  // le deck a changé de nom : sa page garde son adresse (le lien déjà envoyé marche toujours) et sera republiée avec le
  // nouveau titre (a_refaire), par le PC ou par un téléphone sans PC (partage.renommer)
  async function renommer(ancien, nouveau) {
    const { g, q } = await connexion(), s = await leSite(g, q, false);
    if (!s) return {};
    await envoyer(s, q, async (l) => {
      const reg = l.reg, fichiers = new Map();
      if (reg[ancien] && !reg[nouveau]) {
        reg[nouveau] = { ...reg[ancien], a_refaire: true };
        delete reg[ancien];
        fichiers.set("decks.json", JSON.stringify(reg, null, 1));
      }
      return { fichiers, effacer: [], reg, message: `Renommage : ${ancien.replace(/^Deck /, "")} → ${nouveau.replace(/^Deck /, "")}` };
    });
    return {};
  }
  // les decks partagés de ce compte, d'après le dernier registre lu (pour les republier quand ils changent)
  async function partages() {
    const g = await o.compte(), e = await o.lire(ETAT);
    return g && e && e.compte === g.compte ? e.reg || {} : {};
  }
  const compteConnu = async () => !!(await o.compte().catch(() => null));
  return { etat, partager, retirer, renommer, partages, compteConnu };
};
