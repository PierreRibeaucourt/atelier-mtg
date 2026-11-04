"""Partager un deck : une copie de sa page, à consulter seulement, publiée sur GitHub Pages.

La page reprend l'interface de l'Atelier (static/) avec les réponses de l'API figées dans donnees.js :
liste, visuel, fiches des cartes, statistiques, combos du deck, versions, bracket et rapports de simulation.
Rien d'autre ne part : ni les discussions, ni les autres decks.

Les pages sont rangées dans « Partage Atelier/ », un dépôt git à part (hors du dépôt de l'Atelier), poussé vers
le dépôt « decks » du même compte GitHub que l'Atelier, avec la même identité git. Adresse d'un deck :
https://<compte>.github.io/decks/<deck>/ ; la racine liste les decks partagés.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
import unicodedata
import urllib.parse
from collections import Counter

import decks
import infos_cartes as ic

ICI = os.path.dirname(os.path.abspath(__file__))
STATIQUE = os.path.join(ICI, "static")
DOSSIER = os.path.join(decks.RACINE, "Partage Atelier")
REGISTRE = os.path.join(DOSSIER, "decks.json")
NOM_DEPOT = "decks"
FORMATS = ("archidekt", "moxfield", "arena", "mtgo", "simple", "fr")
_verrou = threading.Lock()


# ---------------------------------------------------------------- git
def _git(*args, dossier=None, ok=False):
    r = subprocess.run(["git", "-C", dossier or DOSSIER, *args], capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=120, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode and not ok:
        msg = (r.stderr or r.stdout).strip().splitlines()
        raise RuntimeError(f"Git ({args[0]}) : {msg[-1] if msg else 'échec'}")
    return r


def compte():
    """Le compte GitHub des pages : celui de reglages.json (clé github), sinon celui du dépôt de l'Atelier (remote
    origin). Renvoie (dépôt des pages, adresse du site). Même compte que l'Atelier : même accès (SSH ou HTTPS)."""
    import reglages
    proprio = reglages.github()
    if not proprio:            # pas de valeur par défaut : un dépôt cloné pointe vers le compte de son auteur, pas le tien
        raise RuntimeError("Indique ton compte GitHub dans reglages.json, à la racine de l'Atelier : "
                           '{"github": "TonCompte"} (voir README, « Partager un deck »)')
    url = _git("remote", "get-url", "origin", dossier=decks.RACINE, ok=True).stdout.strip()
    m = re.match(r"(?:git@([^:]+):|https://([^/]+)/)([^/]+)/[^/]+?(?:\.git)?$", url)
    if m and m.group(3).lower() == proprio.lower():          # le compte de l'Atelier : même accès (SSH ou HTTPS)
        hote, proprio = m.group(1) or m.group(2), m.group(3)
        depot = f"git@{hote}:{proprio}/{NOM_DEPOT}.git" if m.group(1) else f"https://{hote}/{proprio}/{NOM_DEPOT}.git"
    else:
        depot = f"https://github.com/{proprio}/{NOM_DEPOT}.git"
    return depot, f"https://{proprio.lower()}.github.io/{NOM_DEPOT}/"


def _preparer():
    """Le dépôt local des pages, à jour avec GitHub. Renvoie l'adresse du site."""
    depot, site = compte()
    os.makedirs(DOSSIER, exist_ok=True)
    if not os.path.isdir(os.path.join(DOSSIER, ".git")):
        _git("init", "-q", "-b", "main")
        for k in ("user.name", "user.email"):                 # la même identité que l'Atelier
            v = _git("config", k, dossier=decks.RACINE, ok=True).stdout.strip()
            if not v:
                raise RuntimeError(f"Identité git manquante : git config --global {k} \"…\"")
            _git("config", k, v)
        _git("remote", "add", "origin", depot)
    else:
        actuel = _git("remote", "get-url", "origin", ok=True).stdout.strip()
        if actuel and actuel != depot:                        # autre compte : ces pages-là ne partent pas chez lui
            raise RuntimeError(f"Le dossier « Partage Atelier » publie vers {actuel}, pas vers {depot} : "
                               "renomme-le pour repartir de zéro")
    r = _git("fetch", "-q", "origin", ok=True)
    if r.returncode:
        if re.search(r"not found|could not read", r.stderr or "", re.I):
            raise RuntimeError(f"Le dépôt GitHub « {NOM_DEPOT} » n'existe pas encore : crée-le sur github.com "
                               f"(public, avec un README), puis active GitHub Pages (Settings › Pages › branche main)")
        raise RuntimeError("GitHub ne répond pas : " + ((r.stderr or "").strip().splitlines() or ["?"])[-1])
    distant = _git("rev-parse", "-q", "--verify", "origin/main", ok=True).returncode == 0
    local = _git("rev-parse", "-q", "--verify", "HEAD", ok=True).returncode == 0
    if distant and not local:                                 # dépôt créé sur GitHub avec un README : on part de lui
        _git("reset", "-q", "origin/main")
        _git("checkout", "-q", "--", ".")
    elif distant:
        if _git("rebase", "-q", "origin/main", ok=True).returncode:
            _git("rebase", "--abort", ok=True)
            raise RuntimeError("Le dépôt des pages a changé sur GitHub et ne se fusionne pas : à régler à la main")
    return site


def _publier(message):
    _git("add", "-A")
    if _git("diff", "--cached", "--quiet", ok=True).returncode:
        _git("commit", "-q", "-m", message)
    if _git("rev-parse", "-q", "--verify", "HEAD", ok=True).returncode == 0:
        r = _git("push", "-q", "-u", "origin", "main", ok=True)
        if r.returncode:
            msg = ((r.stderr or "").strip().splitlines() or ["?"])[-1]
            raise RuntimeError(f"GitHub refuse l'envoi ({msg}) : vérifie le compte de reglages.json et ta connexion "
                               "à GitHub (gh auth login, puis gh auth setup-git)")


# ---------------------------------------------------------------- registre des decks partagés
def _registre():
    try:
        with open(REGISTRE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _ecrire(chemin, texte):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin, "w", encoding="utf-8", newline="\n") as f:
        f.write(texte)


def _slug(deck, reg):
    if deck in reg:
        return reg[deck]["slug"]
    s = unicodedata.normalize("NFD", deck.removeprefix("Deck ")).encode("ascii", "ignore").decode().lower()
    s = base = re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "deck"
    pris, i = {v["slug"] for v in reg.values()}, 2
    while s in pris:
        s, i = f"{base}-{i}", i + 1
    return s


def etat(deck):
    """{url, date} si le deck est partagé, sinon {}."""
    p = _registre().get(deck)
    if not p:
        return {}
    try:
        site = compte()[1]
    except Exception:
        return {}
    return dict(url=site + p["slug"] + "/", date=p["date"])


# ---------------------------------------------------------------- données de la page
def _cle(chemin, params=None):
    """Même clé que app.js en page partagée : chemin décodé, paramètres triés."""
    p = sorted((params or {}).items())
    return chemin + ("?" + "&".join(f"{k}={v}" for k, v in p) if p else "")


def capturer(deck, get):
    """Les réponses de l'API dont la page du deck a besoin. get(url) : client de test de Flask."""
    api = {}

    def prendre(chemin, params=None, texte=False, obligatoire=False):
        url = urllib.parse.quote(chemin) + ("?" + urllib.parse.urlencode(params) if params else "")
        r = get(url)
        if r.status_code != 200:
            if obligatoire:
                raise RuntimeError(f"{chemin} : {(r.get_json(silent=True) or {}).get('erreur', r.status_code)}")
            return None
        v = r.get_data(as_text=True) if texte else r.get_json()
        api[_cle(chemin, params)] = v
        return v

    racine = f"/api/decks/{deck}"
    d = prendre(racine, obligatoire=True)
    for f in FORMATS:
        prendre(racine + "/export", {"format": f}, texte=True)
    vs = prendre(racine + "/versions") or []
    b = prendre(racine + "/bracket")
    cb = prendre(racine + "/combos")
    prendre(racine + "/simulation/options")
    for r in prendre(racine + "/simulations") or []:
        prendre(racine + "/simulations/" + r["fichier"])

    # versions : chaque liste, pour comparer deux versions dans la page (toutes les paires ne tiennent pas en fichier)
    listes = {}
    for f in [""] + [v["fichier"] for v in vs]:
        try:
            listes[f] = dict(nom=decks.libelle(deck, f), cartes=dict(Counter(decks.noms_jeu(decks.lire(decks.chemin_version(deck, f))))))
        except (OSError, ValueError, UnicodeDecodeError):
            continue
    noms_v = sorted({n for x in listes.values() for n in x["cartes"]})
    I = ic.infos(noms_v) if noms_v else {}
    for x in listes.values():
        x["total"] = sum(x["cartes"].values())
        x["prix"] = round(sum(((I.get(n) or {}).get("prix") or 0) * k for n, k in x["cartes"].items()), 2)
        x["gc"] = sorted(n for n in x["cartes"] if ic.est_gc(n))
    infos = {n: dict(fr=(I.get(n) or {}).get("fr"), prix=(I.get(n) or {}).get("prix"), image=(I.get(n) or {}).get("image"),
                     cout=(I.get(n) or {}).get("cout"), type=(I.get(n) or {}).get("type"), gc=ic.est_gc(n)) for n in noms_v}

    # cartes citées : aperçu au survol des noms qu'on peut croiser dans la page
    dans = {c["nom"] for c in d["cartes"]}
    cites = dans | set(noms_v) | {n for c in (cb or {}).get("combos", []) for n in c["cartes"]} | set((b or {}).get("gc_liste") or [])
    import recherche
    nc = recherche.noms_cites()
    if nc:
        garde = [n for n in nc["noms"] if n[0] in cites]
        mots = {a.lower().replace("’", "'") for n in garde for x in n for a in [x, *x.split(" // ")]}
        api["/api/noms-cartes"] = dict(noms=garde, communs=[m for m in nc["communs"] if m in mots])
    else:                                                     # base de la recherche pas encore chargée : le cache des fiches
        F = ic._charge()["cartes"]
        api["/api/noms-cartes"] = dict(noms=[[n, F[n]["fr"]] if (F.get(n) or {}).get("fr") and F[n]["fr"] != n else [n]
                                             for n in sorted(cites)], communs=[])
    for n in sorted(cites - dans):
        prendre("/api/apercu-carte", {"nom": n})
    return dict(deck=deck, date=time.time(), api=api, comparer=dict(listes=listes, infos=infos))


def _verifier(texte):
    """Aucun chemin de ce PC ne doit partir sur GitHub."""
    for p in {os.path.expanduser("~"), decks.RACINE}:
        for forme in (p, p.replace("\\", "/"), json.dumps(p)[1:-1]):
            if forme and forme in texte:
                raise RuntimeError("Un chemin de ton PC est dans les données de la page : partage annulé")


# ---------------------------------------------------------------- pages
def _version(chemin):
    with open(chemin, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()[:10]


COULEURS = {"": "incolore", "W": "mono-blanc", "U": "mono-bleu", "B": "mono-noir", "R": "mono-rouge", "G": "mono-vert",
            "WU": "Azorius", "UB": "Dimir", "BR": "Rakdos", "RG": "Gruul", "WG": "Selesnya", "WB": "Orzhov", "UR": "Izzet",
            "BG": "Golgari", "WR": "Boros", "UG": "Simic", "WUB": "Esper", "UBR": "Grixis", "BRG": "Jund", "WRG": "Naya",
            "WUG": "Bant", "WBG": "Abzan", "WUR": "Jeskai", "UBG": "Sultai", "WBR": "Mardu", "URG": "Temur", "WUBRG": "5 couleurs"}


def nom_couleurs(identite):
    """« Dimir », « mono-noir », « 4 couleurs » ; vide si l'identité est inconnue (pas de commandant)."""
    if identite is None:
        return ""
    k = "".join(c for c in "WUBRG" if c in identite)
    return COULEURS.get(k, f"{len(k)} couleurs")


def _liste(mots):
    return mots[0] if len(mots) == 1 else ", ".join(mots[:-1]) + " et " + mots[-1] if mots else ""


def _image_partage(dossier, dessiner):
    """partage.jpg (1200 × 630) ; None si Pillow manque ou si le dessin échoue (la page se passe d'image)."""
    try:
        import image_partage
        chemin = os.path.join(dossier, "partage.jpg")
        os.makedirs(dossier, exist_ok=True)
        dessiner(image_partage, chemin)
        return "partage.jpg?v=" + _version(chemin)
    except Exception:
        return None


def _page(dossier, donnees, entete):
    """index.html, app.js, style.css et donnees.js : une copie de l'interface, figée avec ses données.
    entete : titre, description, url (adresse absolue de la page), image (adresse absolue de partage.jpg ou None), alt."""
    import reglages
    os.makedirs(dossier, exist_ok=True)
    for f in ("app.js", "style.css"):
        shutil.copyfile(os.path.join(STATIQUE, f), os.path.join(dossier, f))
    donnees = dict(donnees, reglages=reglages.pour_la_page())         # budget par carte : les cartes chères restent signalées
    js = "window.PARTAGE = " + json.dumps(donnees, ensure_ascii=False, separators=(",", ":")) + ";\n"
    _verifier(js)
    _ecrire(os.path.join(dossier, "donnees.js"), js)
    with open(os.path.join(STATIQUE, "index.html"), encoding="utf-8") as f:
        html = f.read()
    v = {f: _version(os.path.join(dossier, f)) for f in ("app.js", "style.css", "donnees.js")}
    att = lambda s: s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")      # noqa: E731
    e = {k: att(x) if isinstance(x, str) else x for k, x in entete.items()}
    meta = [f'<title>{e["titre"]}</title>',
            f'<meta name="description" content="{e["description"]}">',
            f'<link rel="canonical" href="{e["url"]}">',
            '<meta name="robots" content="noindex">',                  # pour qui a le lien, pas pour les moteurs de recherche
            '<meta property="og:type" content="website">',
            '<meta property="og:site_name" content="Atelier MTG">',
            '<meta property="og:locale" content="fr_FR">',
            f'<meta property="og:url" content="{e["url"]}">',
            f'<meta property="og:title" content="{e["titre"]}">',
            f'<meta property="og:description" content="{e["description"]}">']
    if e.get("image"):
        meta += [f'<meta property="og:image" content="{e["image"]}">',
                 '<meta property="og:image:type" content="image/jpeg">',
                 '<meta property="og:image:width" content="1200">',
                 '<meta property="og:image:height" content="630">',
                 f'<meta property="og:image:alt" content="{e["alt"]}">',
                 '<meta name="twitter:card" content="summary_large_image">']
    else:
        meta.append('<meta name="twitter:card" content="summary">')
    html = (html.replace("<title>Atelier MTG</title>", "\n  ".join(meta))
            .replace('href="/static/style.css"', f'href="style.css?v={v["style.css"]}"')
            .replace('  <script src="/reglages.js"></script>\n', "")
            .replace('<script src="/static/app.js"></script>',
                     f'<script src="donnees.js?v={v["donnees.js"]}"></script>\n  <script src="app.js?v={v["app.js"]}"></script>'))
    _ecrire(os.path.join(dossier, "index.html"), html)


def _accueil(reg, site):
    """La racine du site : les decks partagés, chacun vers sa page."""
    resumes = sorted((dict(r["resume"]) for r in reg.values()), key=lambda r: r["titre"])
    donnees = dict(accueil=True, date=time.time(), liens={k: v["slug"] + "/" for k, v in reg.items()},
                   cartes={k: v.get("cartes", []) for k, v in reg.items()},           # dans quel deck est Sol Ring ?
                   api={"/api/decks": resumes, "/api/corbeille": [], "/api/noms-cartes": dict(noms=[], communs=[])})
    titres = _liste([r["titre"] for r in resumes])
    n = len(resumes)
    image = _image_partage(DOSSIER, lambda ip, chemin: ip.image_accueil(
        chemin, "Mes decks Commander", f"{n} deck{'s' if n > 1 else ''} : {titres}" if n else "Aucun deck partagé",
        [r.get("image_cmd") for r in resumes], [r.get("art") for r in resumes]))
    _page(DOSSIER, donnees, dict(
        titre="Mes decks Commander",
        description=(f"{n} deck{'s' if n > 1 else ''} Commander : {titres}. Listes, visuels, statistiques et combos de chaque deck."
                     if n else "Decks Commander."),
        url=site, image=image and site + image, alt=f"Les commandants des decks {titres}" if n else ""))
    _ecrire(os.path.join(DOSSIER, ".nojekyll"), "")


def _euros(x):
    return f"{x:.2f}".replace(".", ",") + " €"


def construire(deck, get):
    """Écrit la page du deck et la racine du site, sans rien publier. Renvoie le titre du deck."""
    site = compte()[1]
    reg = _registre()
    slug = _slug(deck, reg)
    donnees = capturer(deck, get)
    d = donnees["api"][f"/api/decks/{deck}"]
    b = donnees["api"].get(f"/api/decks/{deck}/bracket") or {}
    cmds = d.get("commandants") or []
    couleurs = nom_couleurs(d.get("identite"))
    genre = f"deck Commander {couleurs}".strip()
    nb_gc = len(d.get("gc") or [])
    chiffres = [f"{d['total']} cartes · {_euros(d['prix_total'])}",
                " · ".join(x for x in (f"Bracket {b['estime']}" if b.get("estime") else "",
                                       f"{nb_gc} Game Changer{'s' if nb_gc > 1 else ''}") if x)]
    dossier = os.path.join(DOSSIER, slug)
    images = [c["info"].get("image") for c in d["cartes"] if c["cat"] == "Commander" and c["info"].get("image")]
    image = _image_partage(dossier, lambda ip, chemin: ip.image_deck(
        chemin, d["titre"], "Deck Commander" + (f" · {couleurs}" if couleurs else ""), cmds, images, d.get("art"),
        d.get("identite"), chiffres))
    description = (f"{genre[0].upper() + genre[1:]} de {d['total']} cartes"
                   + (f" autour de {_liste(cmds)}" if cmds else "") + f", pour {_euros(d['prix_total'])}"
                   + (f", bracket {b['estime']}" if b.get("estime") else "") + " : liste, visuel, statistiques et combos.")
    url = f"{site}{slug}/"
    _page(dossier, dict(donnees, accueil="../"), dict(
        titre=f"{d['titre']} : {genre}", description=description, url=url, image=image and url + image,
        alt=f"{d['titre']} : carte de {_liste(cmds) or 'son commandant'}, couleurs et chiffres du deck"))
    reg[deck] = dict(slug=slug, date=donnees["date"],
                     resume={k: v for k, v in d.items() if k not in ("cartes", "categories", "erreur_sim")},
                     cartes=[[c["nom"], c["info"].get("fr") or ""] for c in d["cartes"]])
    _ecrire(REGISTRE, json.dumps(reg, ensure_ascii=False, indent=1))
    _accueil(reg, site)
    return d["titre"]


def partager(deck, get):
    """Publie (ou met à jour) la page du deck. Renvoie {url, date}."""
    with _verrou:
        _preparer()
        _publier("Partage : " + construire(deck, get))
    return etat(deck)


def retirer(deck):
    """Retire la page du deck du site (elle reste dans l'historique du dépôt)."""
    with _verrou:
        _preparer()
        reg = _registre()
        p = reg.pop(deck, None)
        if not p:
            return {}
        shutil.rmtree(os.path.join(DOSSIER, p["slug"]), ignore_errors=True)
        _ecrire(REGISTRE, json.dumps(reg, ensure_ascii=False, indent=1))
        _accueil(reg, compte()[1])
        _publier(f"Retrait : {deck.removeprefix('Deck ')}")
    return {}
