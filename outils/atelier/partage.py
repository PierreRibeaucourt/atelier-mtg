"""Partager un deck : une copie de sa page, à consulter seulement, publiée sur GitHub Pages.

La page reprend l'interface de l'Atelier (static/) avec les réponses de l'API figées dans donnees.js :
liste, visuel, fiches des cartes, statistiques, suggestions (thème et combos), combos du deck, versions, bracket et
rapports de simulation. Rien d'autre ne part : ni les discussions, ni les autres decks, ni le classeur.

Les pages sont rangées dans « Partage Atelier/ », puis publiées de l'une des deux façons :
- connecté (github.py, sans git) : l'Atelier recopie le dossier dans le site de l'Atelier du compte (le dépôt
  <compte>.github.io, créé au premier partage et publié tout seul par GitHub, ou un dépôt « decks » déjà publié) ;
  adresse d'un deck : https://<compte>.github.io/<deck>/ ;
- avec git (reglages.json › github) : « Partage Atelier/ » est un dépôt git à part, poussé vers le dépôt « decks » du
  même compte que l'Atelier, avec la même identité git ; adresse : https://<compte>.github.io/decks/<deck>/.
La racine du site liste les decks partagés.
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
import github
import infos_cartes as ic

ICI = os.path.dirname(os.path.abspath(__file__))
STATIQUE = os.path.join(ICI, "static")
DOSSIER = os.path.join(decks.RACINE, "Partage Atelier")
REGISTRE = os.path.join(DOSSIER, "decks.json")
NOM_DEPOT = "decks"
PUBLICATION = os.path.join(ICI, "publication_github.json")      # connecté : dépôt, branche, site, dernier commit envoyé
DESCRIPTION = "Decks Commander partagés avec l'Atelier MTG"           # celle du dépôt que crée l'Atelier connecté
FORMATS = ("archidekt", "moxfield", "arena", "mtgo", "simple", "fr")
_verrou = threading.Lock()


# ---------------------------------------------------------------- git
def _git(*args, dossier=None, ok=False):
    try:
        r = subprocess.run(["git", "-C", dossier or DOSSIER, *args], capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=120, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except FileNotFoundError:                                   # git n'est pas installé (installeur Windows)
        if ok:
            return subprocess.CompletedProcess(args, 1, "", "git introuvable")
        raise github.NonConnecte("Pour partager tes decks, connecte l'Atelier à GitHub (compte gratuit).") from None
    if r.returncode and not ok:
        msg = (r.stderr or r.stdout).strip().splitlines()
        raise RuntimeError(f"Git ({args[0]}) : {msg[-1] if msg else 'échec'}")
    return r


def compte():
    """Le compte GitHub des pages : celui de reglages.json (clé github), sinon celui du dépôt de l'Atelier (remote
    origin). Renvoie (dépôt des pages, adresse du site). Même compte que l'Atelier : même accès (SSH ou HTTPS).
    Connecté (github.py) : (None, adresse du site), connue dès le premier partage."""
    import reglages
    if github.compte():
        p = _publication()
        if not p.get("site"):
            raise RuntimeError("Aucun deck partagé pour l'instant")
        return None, p["site"]
    proprio = reglages.github()
    if not proprio:            # pas de valeur par défaut : un dépôt cloné pointe vers le compte de son auteur, pas le tien
        raise github.NonConnecte("Pour partager tes decks, connecte l'Atelier à GitHub (compte gratuit).")
    url = _git("remote", "get-url", "origin", dossier=decks.RACINE, ok=True).stdout.strip()
    m = re.match(r"(?:git@([^:]+):|https://([^/]+)/)([^/]+)/[^/]+?(?:\.git)?$", url)
    if m and m.group(3).lower() == proprio.lower():          # le compte de l'Atelier : même accès (SSH ou HTTPS)
        hote, proprio = m.group(1) or m.group(2), m.group(3)
        depot = f"git@{hote}:{proprio}/{NOM_DEPOT}.git" if m.group(1) else f"https://{hote}/{proprio}/{NOM_DEPOT}.git"
    else:
        depot = f"https://github.com/{proprio}/{NOM_DEPOT}.git"
    return depot, f"https://{proprio.lower()}.github.io/{NOM_DEPOT}/"


def depot_atelier():
    """Adresse web du dépôt de l'Atelier (remote origin), pour « Télécharger l'Atelier MTG » sur les pages partagées.
    git@github-perso:Compte/atelier-mtg.git (alias SSH) → https://github.com/Compte/atelier-mtg ; None si introuvable."""
    url = _git("remote", "get-url", "origin", dossier=decks.RACINE, ok=True).stdout.strip()
    m = re.match(r"(?:git@([^:]+):|https://([^/]+)/)([^/]+)/([^/]+?)(?:\.git)?$", url)
    if not m:
        import mise_a_jour                                       # installeur Windows, sans git : le dépôt qu'il suit
        d = mise_a_jour.installation().get("depot")
        return f"https://github.com/{d}" if d else None
    hote = m.group(1) or m.group(2)
    return f"https://{'github.com' if 'github' in hote else hote}/{m.group(3)}/{m.group(4)}"


def _preparer():
    """Le dépôt local des pages, à jour avec GitHub. Renvoie l'adresse du site."""
    if github.compte():
        return _preparer_connecte()
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
        # --autostash : une modification restée en attente (publication interrompue…) ne bloque pas les suivantes
        if _git("rebase", "-q", "--autostash", "origin/main", ok=True).returncode:
            _git("rebase", "--abort", ok=True)
            raise RuntimeError("Le dépôt des pages a changé sur GitHub et ne se fusionne pas : à régler à la main")
    return site


def _publier(message):
    if github.compte():
        p = _publication()
        p.update(commit=github.envoyer(p["depot"], p["branche"], DOSSIER, message),
                 fichiers=sorted(github.fichiers_locaux(DOSSIER)))
        _ecrire(PUBLICATION, json.dumps(p, ensure_ascii=False, indent=1))
        return
    _git("add", "-A")
    if _git("diff", "--cached", "--quiet", ok=True).returncode:
        _git("commit", "-q", "-m", message)
    if _git("rev-parse", "-q", "--verify", "HEAD", ok=True).returncode == 0:
        r = _git("push", "-q", "-u", "origin", "main", ok=True)
        if r.returncode:
            msg = ((r.stderr or "").strip().splitlines() or ["?"])[-1]
            raise RuntimeError(f"GitHub refuse l'envoi ({msg}) : vérifie le compte de reglages.json et ta connexion "
                               "à GitHub (gh auth login, puis gh auth setup-git)")


# ---------------------------------------------------------------- connecté à GitHub (github.py), sans git
def _publication():
    try:
        with open(PUBLICATION, encoding="utf-8") as f:
            p = json.load(f)
        return p if p.get("compte") == github.compte() else {}
    except (OSError, ValueError):
        return {}


def _a_l_atelier(r):
    """Ce dépôt est-il un site de l'Atelier ? Sa description, ou decks.json à sa racine."""
    if r.get("description") == DESCRIPTION:
        return True
    try:
        github.appel("GET", f"/repos/{r['full_name']}/contents/decks.json?ref={r['default_branch']}")
        return True
    except github.Erreur as e:
        if e.statut != 404:
            raise
        return False


def _site_atelier(login):
    """Le dépôt des pages : un site de l'Atelier qui existe déjà, sinon le site personnel <compte>.github.io, créé
    ici : GitHub le publie tout seul. S'il sert déjà à autre chose, on n'y touche pas : les pages vont dans un dépôt
    « decks », dont il faut activer GitHub Pages à la main si besoin (la connexion n'en a pas le droit)."""
    perso = f"{login.lower()}.github.io"
    sites, existants = {perso: f"https://{perso}/", NOM_DEPOT: f"https://{perso}/{NOM_DEPOT}/"}, {}
    for nom in sites:
        try:
            existants[nom] = github.appel("GET", f"/repos/{login}/{nom}")
        except github.Erreur as e:
            if e.statut != 404:
                raise
    nom = next((n for n, r in existants.items() if _a_l_atelier(r)), None)
    if not nom:
        nom = perso if perso not in existants else NOM_DEPOT if NOM_DEPOT not in existants else None
        if not nom:
            raise RuntimeError(f"Tes dépôts {perso} et « {NOM_DEPOT} » servent déjà à autre chose : l'Atelier n'y touche pas")
        existants[nom] = github.appel("POST", "/user/repos", dict(name=nom, description=DESCRIPTION, auto_init=True,
                                                                  has_issues=False, has_projects=False, has_wiki=False))
    r = existants[nom]
    if nom == NOM_DEPOT and not r.get("has_pages"):
        try:
            github.appel("POST", f"/repos/{r['full_name']}/pages", dict(source=dict(branch=r["default_branch"], path="/")),
                         ok=(201, 409))
        except github.Erreur:
            raise RuntimeError(f"Sur github.com, active les pages de ton dépôt « {NOM_DEPOT} » (Settings › Pages › Deploy "
                               f"from a branch › {r['default_branch']}), puis repartage : ton site {perso} sert déjà à "
                               "autre chose") from None
    return dict(depot=r["full_name"], branche=r["default_branch"], site=sites[nom])


def _preparer_connecte():
    """Comme _preparer, sans git : trouve (ou crée) le site, puis ramène ici ce qui a changé sur GitHub depuis la
    dernière publication de ce PC (un autre PC, ou le premier partage). Renvoie l'adresse du site."""
    login = github.compte()
    p = _publication() or dict(compte=login)
    if not p.get("depot"):
        p.update(_site_atelier(login))
    for essai in range(6):                                  # un dépôt tout juste créé met un instant à être prêt
        try:
            tete, _, distant = github.arbre(p["depot"], p["branche"])
            break
        except github.Erreur as e:
            if e.statut not in (404, 409) or essai == 5:
                raise
            time.sleep(2)
    os.makedirs(DOSSIER, exist_ok=True)
    if tete != p.get("commit"):
        local = github.fichiers_locaux(DOSSIER)
        for rel, sha in distant.items():
            chemin = os.path.join(DOSSIER, *rel.split("/"))
            if rel in local:
                with open(chemin, "rb") as f:
                    if github.sha_blob(f.read()) == sha:
                        continue
            os.makedirs(os.path.dirname(chemin), exist_ok=True)
            with open(chemin, "wb") as f:
                f.write(github.telecharger(p["depot"], sha))
        for rel in set(p.get("fichiers", ())) - set(distant):       # retirés sur GitHub depuis : retirés ici aussi
            try:
                os.remove(os.path.join(DOSSIER, *rel.split("/")))
            except OSError:
                pass
        p.update(commit=tete, fichiers=sorted(distant))
    _ecrire(PUBLICATION, json.dumps(p, ensure_ascii=False, indent=1))
    return p["site"]


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
    pris, i = {v["slug"] for v in reg.values()} | {A_PROPOS}, 2
    while s in pris:
        s, i = f"{base}-{i}", i + 1
    return s


def etat(deck):
    """{url, date} si le deck est partagé (plus {erreur} si la dernière mise à jour automatique a échoué), sinon {}."""
    p = _registre().get(deck)
    if not p:
        return {}
    try:
        site = compte()[1]
    except Exception:
        return {}
    e = _echecs.get(deck)
    return dict(url=site + p["slug"] + "/", date=p["date"], **({"erreur": e[1]} if e else {}))


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
    prendre("/api/jouer/jetons", {"deck": deck})             # pour « Jouer » (dossier jouer/ de la page)
    prendre("/api/recherche/fonctions")                      # le formulaire de recherche, montré en vitrine
    # suggestions : thème et combos seulement. Le classeur reste privé : ni son groupe, ni les exemplaires possédés ;
    # les cartes écartées non plus.
    sg = prendre(racine + "/suggestions")
    if sg:
        sg = dict(ecartees=[], cartes=[dict(x, groupes=[g for g in x["groupes"] if g != "classeur"], classeur=0)
                                       for x in sg["cartes"] if any(g != "classeur" for g in x["groupes"])])
        api[_cle(racine + "/suggestions")] = sg

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
    suggerees = {n for x in (sg or {}).get("cartes", []) for n in [x["nom"], *(m for c in x.get("combos", []) for m in c["cartes"])]}
    cites = (dans | set(noms_v) | {n for c in (cb or {}).get("combos", []) for n in c["cartes"]} | set((b or {}).get("gc_liste") or [])
             | suggerees)
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
    from version import __version__
    os.makedirs(dossier, exist_ok=True)
    for f in ("app.js", "style.css"):
        shutil.copyfile(os.path.join(STATIQUE, f), os.path.join(dossier, f))
    donnees = dict(donnees, reglages=reglages.pour_la_page(),         # budget par carte : les cartes chères restent signalées
                   atelier=depot_atelier(),                           # recherche et discussion en vitrine : où télécharger l'Atelier
                   auteur=_auteur(),                             # « Decks de … » à la place de « Mes decks »
                   version=__version__)                               # la version de l'Atelier qui a publié la page
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


def _page_jouer(dossier):
    """jouer/ : le module « Jouer tout seul » de la page du deck, qui lit les mêmes données (../donnees.js)."""
    d = os.path.join(dossier, "jouer")
    os.makedirs(d, exist_ok=True)
    for f in ("jouer.js", "jouer.css"):
        shutil.copyfile(os.path.join(STATIQUE, f), os.path.join(d, f))
    v = {f: _version(os.path.join(d, f)) for f in ("jouer.js", "jouer.css")}
    with open(os.path.join(STATIQUE, "jouer.html"), encoding="utf-8") as f:
        html = f.read()
    html = (html.replace("</title>", '</title>\n  <meta name="robots" content="noindex">', 1)
            .replace('href="/static/jouer.css"', f'href="jouer.css?v={v["jouer.css"]}"')
            .replace('<script src="/static/jouer.js"></script>',
                     f'<script src="../donnees.js?v={_version(os.path.join(dossier, "donnees.js"))}"></script>\n'
                     f'  <script src="jouer.js?v={v["jouer.js"]}"></script>'))
    if "/static/" in html:                                   # jouer.html a changé : mieux vaut ne rien publier de cassé
        raise RuntimeError("La page « Jouer » n'a pas pu être préparée : partage annulé")
    _ecrire(os.path.join(d, "index.html"), html)


# « C'est quoi, l'Atelier MTG ? » : une vraie page (a-propos/), pour que son lien ait son propre aperçu ; son image
# est sur le site de l'auteur de l'Atelier, avec les captures que montre la page
A_PROPOS = "a-propos"
IMAGE_ATELIER = "https://pierreribeaucourt.github.io/decks/a-propos/atelier.jpg"


def _a_propos(donnees, site):
    local = os.path.join(DOSSIER, A_PROPOS, "atelier.jpg")         # le site de l'auteur : l'image est là
    image = f"{site}{A_PROPOS}/atelier.jpg?v={_version(local)}" if os.path.exists(local) else IMAGE_ATELIER
    _page(os.path.join(DOSSIER, A_PROPOS), dict(donnees, accueil="../", page=A_PROPOS), dict(
        titre="L'Atelier MTG : gestionnaire de decks Commander, gratuit et local",
        description=("Concevoir, tester et partager ses decks Commander : statistiques et base de mana, combos, bracket, "
                     "table de jeu, recherche avancée et discussion avec Claude. Gratuit, open source, tout reste sur "
                     "votre ordinateur."),
        url=f"{site}{A_PROPOS}/", image=image, alt="L'Atelier MTG : vos decks Commander, de la liste à la table"))


def _accueil(reg, site):
    """La racine du site : les decks partagés, chacun vers sa page."""
    import recherche
    resumes = sorted((dict(r["resume"]) for r in reg.values()), key=lambda r: r["titre"])
    donnees = dict(accueil=True, date=time.time(), liens={k: v["slug"] + "/" for k, v in reg.items()},
                   cartes={k: v.get("cartes", []) for k, v in reg.items()},           # dans quel deck est Sol Ring ?
                   api={"/api/decks": resumes, "/api/corbeille": [], "/api/noms-cartes": dict(noms=[], communs=[]),
                        "/api/recherche/fonctions": recherche.fonctions()})
    titres = _liste([r["titre"] for r in resumes])
    n = len(resumes)
    auteur = _auteur()
    titre = f"Decks Commander de {auteur}" if auteur else "Mes decks Commander"
    image = _image_partage(DOSSIER, lambda ip, chemin: ip.image_accueil(
        chemin, titre, f"{n} deck{'s' if n > 1 else ''} : {titres}" if n else "Aucun deck partagé",
        [r.get("image_cmd") for r in resumes], [r.get("art") for r in resumes]))
    _page(DOSSIER, donnees, dict(
        titre=titre,
        description=(f"{n} deck{'s' if n > 1 else ''} Commander : {titres}. Listes, visuels, statistiques, combos "
                     "et table de jeu pour tester chaque deck." if n else "Decks Commander."),
        url=site, image=image and site + image, alt=f"Les commandants des decks {titres}" if n else ""))
    _a_propos(donnees, site)
    _ecrire(os.path.join(DOSSIER, ".nojekyll"), "")


def _auteur():
    """À qui sont ces decks : « Decks de … » sur les pages partagées (reglages.json : nom, sinon le compte GitHub)."""
    import reglages
    return reglages.nom() or github.compte()


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
    auteur = _auteur()
    image = _image_partage(dossier, lambda ip, chemin: ip.image_deck(
        chemin, d["titre"], "Deck Commander" + (f" · {couleurs}" if couleurs else ""), cmds, images, d.get("art"),
        d.get("identite"), chiffres, auteur))
    description = (f"{genre[0].upper() + genre[1:]} de {d['total']} cartes"
                   + (f" autour de {_liste(cmds)}" if cmds else "") + f", pour {_euros(d['prix_total'])}"
                   + (f", bracket {b['estime']}" if b.get("estime") else "")
                   + " : liste, visuel, statistiques, combos et table de jeu pour le tester."
                   + (f" Partagé par {auteur}." if auteur else ""))
    url = f"{site}{slug}/"
    _page(dossier, dict(donnees, accueil="../"), dict(
        titre=f"{d['titre']} : {genre}" + (f", par {auteur}" if auteur else ""), description=description, url=url,
        image=image and url + image, alt=f"{d['titre']} : carte de {_liste(cmds) or 'son commandant'}, couleurs et chiffres du deck"))
    _page_jouer(dossier)
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
    _echecs.pop(deck, None)
    return etat(deck)


# ---------------------------------------------------------------- mise à jour automatique des pages partagées
SURVEILLES = (decks.FICHIER, "deck.json", decks.VISUELS, "synergies.json", os.path.join(decks.VERSIONS, "versions.json"))
CALME = 120            # secondes sans modification avant de republier : une série d'ajouts ne publie qu'une fois
REESSAI = 900          # après un échec (pas de réseau…), nouvel essai un quart d'heure plus tard
_echecs = {}           # deck : (heure, message) de la dernière mise à jour automatique ratée


def derniere_modif(deck):
    """Heure de la dernière modification de ce que montre la page : liste, note, impressions, synergies, versions, simulations.
    Pas la discussion avec Claude, qui ne part jamais."""
    base, t = os.path.join(decks.RACINE, deck), 0
    for f in SURVEILLES:
        try:
            t = max(t, os.path.getmtime(os.path.join(base, f)))
        except OSError:
            pass
    try:
        with os.scandir(os.path.join(base, "simulations")) as it:
            t = max([t] + [e.stat().st_mtime for e in it if e.name.endswith(".json")])
    except OSError:
        pass
    return t


def a_republier(maintenant=None):
    """Les decks partagés modifiés depuis leur publication, au calme depuis CALME secondes, sans échec trop récent."""
    maintenant = maintenant or time.time()
    r = []
    for deck, p in _registre().items():
        if not os.path.isdir(os.path.join(decks.RACINE, deck)):
            continue
        t, e = derniere_modif(deck), _echecs.get(deck)
        if (t > p["date"] or p.get("a_refaire")) and maintenant - t >= CALME and not (e and maintenant - e[0] < REESSAI):
            r.append(deck)
    return r


def surveiller(get, pause=30):
    """En fond tant que l'Atelier est ouvert : republie la page d'un deck partagé quand on a fini de le modifier,
    depuis l'Atelier, le Claude de l'Atelier ou un éditeur. Au lancement, rattrape ce qui a changé Atelier fermé."""
    while True:
        time.sleep(pause)
        try:
            decks_a_faire = a_republier()
        except Exception:
            continue
        for deck in decks_a_faire:
            try:
                partager(deck, get)
            except Exception as ex:
                _echecs[deck] = (time.time(), str(ex))


def renommer(ancien, nouveau):
    """Le deck a changé de nom : sa page garde son adresse (le lien déjà envoyé marche toujours) et sera republiée
    avec le nouveau titre par surveiller()."""
    with _verrou:
        reg = _registre()
        if ancien not in reg:
            return
        reg[nouveau] = dict(reg.pop(ancien), a_refaire=True)       # construire() réécrit l'entrée, sans a_refaire
        _ecrire(REGISTRE, json.dumps(reg, ensure_ascii=False, indent=1))
        if not github.compte():                                    # git : enregistré ici, envoyé avec la prochaine publication
            _git("add", "decks.json", ok=True)
            _git("commit", "-q", "-m", f"Renommage : {ancien.removeprefix('Deck ')} → {nouveau.removeprefix('Deck ')}", ok=True)
    _echecs.pop(ancien, None)


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
