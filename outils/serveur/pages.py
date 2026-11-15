"""Les pages publiques des decks, https://atelier-mtg.com/decks/<pseudo>/<deck>/, écrites par le serveur des comptes.

L'Atelier (PC ou appli) envoie les données de la page du deck (partage.capturer : les réponses de son API) et son image
d'aperçu ; le serveur écrit dans le dossier des pages (réglage « pages » › dossier, sous le site atelier-mtg.com) :
- <pseudo>/<deck>/index.html : l'interface de l'Atelier en lecture seule (modèle static/index.html ; app.js et
  style.css de la page d'accueil), avec ses balises pour les moteurs de recherche et les réseaux sociaux ;
- <pseudo>/<deck>/donnees.js (window.PARTAGE : les données), partage.jpg (l'image), jouer/index.html (la table de jeu) ;
- <pseudo>/index.html et donnees.js : les decks de ce pseudo ;
- sitemap.xml : toutes les pages, pour les moteurs de recherche.
Ce qui vient de l'Atelier est neutralisé (ni balise HTML, ni lien javascript:) ; les achats n'y sont jamais.
Réglages : {"dossier", "url" (adresse publique du dossier), "modeles" (index.html et jouer.html de static/),
"interface" (dossier de app.js, style.css, jouer.js, jouer.css), "interface_url" (leur adresse)}.
"""
import hashlib
import html
import json
import os
import re
import shutil
import time
import unicodedata

DEPOT = "https://github.com/PierreRibeaucourt/atelier-mtg"
RESERVES = {"atelier", "atelier-mtg", "admin", "api", "app", "decks", "fr", "en", "a-propos", "recherche", "modeles",
            "sitemap", "static", "jouer", "contact", "aide", "compte", "comptes", "partage", "voir", "www"}
PSEUDO = re.compile(r"[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])")
COULEURS = {"": "incolore", "W": "mono-blanc", "U": "mono-bleu", "B": "mono-noir", "R": "mono-rouge", "G": "mono-vert",
            "WU": "Azorius", "UB": "Dimir", "BR": "Rakdos", "RG": "Gruul", "WG": "Selesnya", "WB": "Orzhov", "UR": "Izzet",
            "BG": "Golgari", "WR": "Boros", "UG": "Simic", "WUB": "Esper", "UBR": "Grixis", "BRG": "Jund", "WRG": "Naya",
            "WUG": "Bant", "WBG": "Abzan", "WUR": "Jeskai", "UBG": "Sultai", "WBR": "Mardu", "URG": "Temur", "WUBRG": "5 couleurs"}
JAVASCRIPT = re.compile(r"^[\s\x00-\x1f]*(javascript|vbscript)\s*:", re.I)


class Reglages:
    def __init__(self, r):
        self.dossier = os.path.expanduser(r["dossier"])
        self.url = r["url"].rstrip("/") + "/"
        self.modeles = os.path.expanduser(r["modeles"])
        self.interface = os.path.expanduser(r["interface"])
        self.interface_url = r["interface_url"].rstrip("/") + "/"


# ---------------------------------------------------------------- outils
def pseudo_valide(p):
    """3 à 30 caractères : minuscules, chiffres, tirets (pas au début ni à la fin) ; ni un mot réservé."""
    return isinstance(p, str) and bool(PSEUDO.fullmatch(p)) and "--" not in p and p not in RESERVES


def slug_de(deck, pris):
    """L'adresse d'un deck dans le dossier du pseudo, comme partage._slug : « Deck Forgeur de soleil » → forgeur-de-soleil."""
    s = unicodedata.normalize("NFD", deck.removeprefix("Deck ")).encode("ascii", "ignore").decode().lower()
    s = base = re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:60].strip("-") or "deck"
    i = 2
    while s in pris or s in RESERVES:
        s, i = f"{base}-{i}", i + 1
    return s


def neutraliser(x):
    """Les textes venus de l'Atelier, sans balise HTML possible (« < » et « > » deviennent ‹ ›) ni lien javascript:."""
    if isinstance(x, str):
        return "" if JAVASCRIPT.match(x) else x.replace("<", "‹").replace(">", "›")
    if isinstance(x, list):
        return [neutraliser(v) for v in x]
    if isinstance(x, dict):
        return {str(k): neutraliser(v) for k, v in x.items()}
    return x if x is None or isinstance(x, (bool, int, float)) else None


def _version(chemin):
    with open(chemin, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()[:10]


def _ecrire(chemin, contenu):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin + ".tmp", "wb") as f:
        f.write(contenu.encode("utf-8") if isinstance(contenu, str) else contenu)
    os.replace(chemin + ".tmp", chemin)


def _modele(cfg, nom):
    with open(os.path.join(cfg.modeles, nom), encoding="utf-8") as f:
        return f.read()


def _dans(cfg, *parts):
    """Un chemin sous le dossier des pages, jamais ailleurs."""
    p = os.path.normpath(os.path.join(cfg.dossier, *parts))
    if not p.startswith(os.path.normpath(cfg.dossier) + os.sep):
        raise ValueError("chemin hors du dossier des pages")
    return p


def nom_couleurs(identite):
    if identite is None:
        return ""
    k = "".join(c for c in "WUBRG" if c in identite)
    return COULEURS.get(k, f"{len(k)} couleurs")


def _liste(mots):
    return mots[0] if len(mots) == 1 else ", ".join(mots[:-1]) + " et " + mots[-1] if mots else ""


def _euros(x):
    try:
        return f"{float(x):.2f}".replace(".", ",") + " €"
    except (TypeError, ValueError):
        return ""


# ---------------------------------------------------------------- une page
def _page(cfg, dossier, donnees, entete):
    """index.html et donnees.js d'une page (comme partage._page) ; entete : titre, description, url, image, alt."""
    js = "window.PARTAGE = " + json.dumps(donnees, ensure_ascii=False, separators=(",", ":")) + ";\n"
    _ecrire(os.path.join(dossier, "donnees.js"), js)
    v = {f: _version(os.path.join(cfg.interface, f)) for f in ("app.js", "style.css")}
    v["donnees.js"] = hashlib.sha1(js.encode()).hexdigest()[:10]
    e = {k: html.escape(x, quote=True) if isinstance(x, str) else x for k, x in entete.items()}
    meta = [f'<title>{e["titre"]}</title>', f'<meta name="description" content="{e["description"]}">',
            f'<link rel="canonical" href="{e["url"]}">',
            '<meta property="og:type" content="website">', '<meta property="og:site_name" content="Atelier MTG">',
            '<meta property="og:locale" content="fr_FR">', f'<meta property="og:url" content="{e["url"]}">',
            f'<meta property="og:title" content="{e["titre"]}">', f'<meta property="og:description" content="{e["description"]}">']
    if e.get("image"):
        meta += [f'<meta property="og:image" content="{e["image"]}">', '<meta property="og:image:type" content="image/jpeg">',
                 '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
                 f'<meta property="og:image:alt" content="{e["alt"]}">', '<meta name="twitter:card" content="summary_large_image">']
    else:
        meta.append('<meta name="twitter:card" content="summary">')
    meta.append('<script>try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}</script>')
    t = (_modele(cfg, "index.html").replace('<html lang="fr">', '<html lang="fr" class="partage">')
         .replace("<title>Atelier MTG</title>", "\n  ".join(meta))
         .replace('href="/static/style.css"', f'href="{cfg.interface_url}style.css?v={v["style.css"]}"')
         .replace('  <script src="/reglages.js"></script>\n', "")
         .replace('<script src="/static/app.js"></script>',
                  f'<script src="donnees.js?v={v["donnees.js"]}"></script>\n'
                  f'  <script src="{cfg.interface_url}app.js?v={v["app.js"]}"></script>'))
    if "/static/" in t or "/reglages.js" in t:
        raise RuntimeError("le modèle de page a changé : page non écrite")
    _ecrire(os.path.join(dossier, "index.html"), t)
    return v["donnees.js"]


def _page_jouer(cfg, dossier, v_donnees):
    """jouer/ : la table de jeu, qui lit les données de la page du deck (comme partage._page_jouer)."""
    v = {f: _version(os.path.join(cfg.interface, f)) for f in ("jouer.js", "jouer.css")}
    t = (_modele(cfg, "jouer.html").replace("</title>", '</title>\n  <meta name="robots" content="noindex">', 1)
         .replace('href="/static/jouer.css"', f'href="{cfg.interface_url}jouer.css?v={v["jouer.css"]}"')
         .replace('<script src="/static/jouer.js"></script>',
                  f'<script src="../donnees.js?v={v_donnees}"></script>\n  <script src="{cfg.interface_url}jouer.js?v={v["jouer.js"]}"></script>'))
    if "/static/" in t:
        raise RuntimeError("le modèle de la table de jeu a changé : page non écrite")
    _ecrire(os.path.join(dossier, "jouer", "index.html"), t)


def ecrire_deck(cfg, pseudo, slug, deck, donnees, image=None, budget=None):
    """La page d'un deck. donnees : {deck, date, api, comparer, version} (partage.capturer) ; image : le JPEG.
    Renvoie (url, resume) : resume pour la page du pseudo (sans les cartes, avec la liste des noms)."""
    donnees = neutraliser(donnees)
    api = donnees.get("api")
    d = api.get(f"/api/decks/{deck}") if isinstance(api, dict) else None
    if not isinstance(d, dict) or not isinstance(d.get("cartes"), list):
        raise ValueError("Données du deck incomplètes.")
    api.pop(f"/api/decks/{deck}/achats", None)                          # ce qu'on possède n'est jamais public
    b = api.get(f"/api/decks/{deck}/bracket") or {}
    dossier, url = _dans(cfg, pseudo, slug), f"{cfg.url}{pseudo}/{slug}/"
    titre = str(d.get("titre") or deck.removeprefix("Deck "))
    cmds = [str(c) for c in d.get("commandants") or []]
    couleurs = nom_couleurs(d.get("identite"))
    genre = f"deck Commander {couleurs}".strip()
    total = d.get("total") or 0
    description = (f"{genre[0].upper() + genre[1:]} de {total} cartes" + (f" autour de {_liste(cmds)}" if cmds else "")
                   + f", pour {_euros(d.get('prix_total'))}" + (f", bracket {b['estime']}" if b.get("estime") else "")
                   + f" : liste, visuel, statistiques, combos et table de jeu pour le tester. Partagé par {pseudo}.")
    os.makedirs(dossier, exist_ok=True)
    adresse_image = None
    if image:
        _ecrire(os.path.join(dossier, "partage.jpg"), image)
        adresse_image = f"{url}partage.jpg?v={hashlib.sha1(image).hexdigest()[:10]}"
    elif os.path.exists(os.path.join(dossier, "partage.jpg")):
        os.remove(os.path.join(dossier, "partage.jpg"))
    page = {k: donnees[k] for k in ("deck", "date", "api", "comparer", "version") if k in donnees}
    page.update(reglages={"budget": budget if isinstance(budget, (int, float)) and not isinstance(budget, bool) else 5},
                atelier=DEPOT, auteur=pseudo, accueil="../")
    v = _page(cfg, dossier, page, dict(titre=f"{titre} : {genre}, par {pseudo}", description=description, url=url,
                                       image=adresse_image,
                                       alt=f"{titre} : carte de {_liste(cmds) or 'son commandant'}, couleurs et chiffres du deck"))
    _page_jouer(cfg, dossier, v)
    resume = {k: x for k, x in d.items() if k not in ("cartes", "categories")}
    cdr = [c for c in d["cartes"] if isinstance(c, dict) and c.get("cat") == "Commander" and isinstance(c.get("info"), dict)]
    resume.setdefault("image_cmd", next((c["info"].get("image") for c in cdr if c["info"].get("image")), ""))
    resume.setdefault("art", next((c["info"].get("art") for c in cdr if c["info"].get("art")), ""))
    cartes = [[c.get("nom"), (c.get("info") or {}).get("fr") or ""] for c in d["cartes"] if isinstance(c, dict)]
    return url, dict(resume=resume, cartes=cartes, image=adresse_image,
                     fonctions=api.get("/api/recherche/fonctions"))


def ecrire_pseudo(cfg, pseudo, decks):
    """<pseudo>/ : ses decks partagés (comme partage._accueil). decks : [(deck, slug, {resume, cartes, image, fonctions})]."""
    dossier, url = _dans(cfg, pseudo), f"{cfg.url}{pseudo}/"
    if not decks:
        if os.path.isdir(dossier):
            shutil.rmtree(dossier)
        return
    resumes = sorted((dict(x["resume"]) for _, _, x in decks), key=lambda r: str(r.get("titre", "")))
    fonctions = next((x["fonctions"] for _, _, x in decks if x.get("fonctions")), None)
    donnees = dict(accueil=True, date=time.time(), atelier=DEPOT, auteur=pseudo, reglages={"budget": 0},
                   liens={deck: slug + "/" for deck, slug, _ in decks},
                   cartes={deck: x.get("cartes", []) for deck, _, x in decks},
                   api={"/api/decks": resumes, "/api/corbeille": [], "/api/noms-cartes": dict(noms=[], communs=[]),
                        **({"/api/recherche/fonctions": fonctions} if fonctions else {})})
    titres = _liste([str(r.get("titre", "")) for r in resumes])
    n = len(resumes)
    image = next((x["image"] for _, _, x in decks if x.get("image")), None)
    _page(cfg, dossier, donnees, dict(
        titre=f"Decks Commander de {pseudo}", url=url, image=image, alt=f"Un deck de {pseudo}",
        description=f"{n} deck{'s' if n > 1 else ''} Commander : {titres}. Listes, visuels, statistiques, combos et table "
                    "de jeu pour tester chaque deck."))


def retirer_deck(cfg, pseudo, slug):
    p = _dans(cfg, pseudo, slug)
    if os.path.isdir(p):
        shutil.rmtree(p)


def retirer_pseudo(cfg, pseudo):
    p = _dans(cfg, pseudo)
    if os.path.isdir(p):
        shutil.rmtree(p)


def ecrire_sitemap(cfg, lignes):
    """sitemap.xml : la page de chaque pseudo et de chacun de ses decks. lignes : [(pseudo, slug, maj)]."""
    jour = lambda t: time.strftime("%Y-%m-%d", time.gmtime(t))           # noqa: E731
    pseudos = {}
    for pseudo, _, maj in lignes:
        pseudos[pseudo] = max(pseudos.get(pseudo, 0), maj)
    urls = [(f"{cfg.url}{p}/", m) for p, m in sorted(pseudos.items())] + [(f"{cfg.url}{p}/{s}/", m) for p, s, m in sorted(lignes)]
    _ecrire(os.path.join(cfg.dossier, "sitemap.xml"), '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "".join(f"  <url><loc>{html.escape(u)}</loc><lastmod>{jour(m)}</lastmod></url>\n" for u, m in urls)
            + "</urlset>\n")


def relire(cfg, pseudo, slug):
    """Les données d'une page déjà écrite (donnees.js), pour la refaire (nouveau pseudo, nouvelle interface)."""
    with open(os.path.join(_dans(cfg, pseudo, slug), "donnees.js"), encoding="utf-8") as f:
        t = f.read()
    return json.loads(t[len("window.PARTAGE = "):].rstrip().rstrip(";"))
