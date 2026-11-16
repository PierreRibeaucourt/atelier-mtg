"""Partager un deck : une copie de sa page, à consulter seulement, publiée sur https://atelier-mtg.com/decks/.

La page reprend l'interface de l'Atelier (static/) avec les réponses de l'API figées (capturer) : liste, visuel, fiches
des cartes, statistiques, suggestions (thème et combos), combos du deck, versions, bracket et rapports de simulation.
Rien d'autre ne part : ni les discussions, ni les autres decks, ni le classeur, ni les achats.

L'Atelier envoie ces données et l'image d'aperçu (image_partage.py) au serveur des comptes (compte.py ; côté serveur,
outils/serveur/pages.py), qui écrit la page à https://atelier-mtg.com/decks/<pseudo>/<deck>/. Il faut être connecté à
son compte ; au premier partage, on choisit son pseudo. L'appli publie les mêmes pages (static/telephone/partage.js).

Seuls les decks qu'on partage (bouton « Partager ») sont publiés. Une fois partagé, un deck modifié sur ce PC voit sa
page refaite deux minutes après la dernière modification (surveiller) ; un deck qu'on retire du partage n'est plus
publié, jusqu'à ce qu'on le repartage. Jusqu'à la 2.1.0, les pages allaient sur GitHub Pages : elles y restent, figées.
"""
import base64
import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
import time
import urllib.parse
from collections import Counter

import decks
import infos_cartes as ic
from version import __version__

ICI = os.path.dirname(os.path.abspath(__file__))
STATIQUE = os.path.join(ICI, "static")
DOSSIER = os.path.join(decks.RACINE, "Partage Atelier")         # les captures de la page d'accueil (a-propos/)
ETAT = os.path.join(ICI, "partages_compte.json")               # {email, pseudo, lu, decks: {deck: {url, date}}}
DEPOT = "https://github.com/PierreRibeaucourt/atelier-mtg"
FORMATS = ("archidekt", "moxfield", "arena", "mtgo", "simple", "fr")
_verrou = threading.Lock()


class PseudoRequis(RuntimeError):
    """Premier partage : le compte n'a pas encore de pseudo (il sera dans l'adresse des pages)."""
    code = 409


# le compte, avant tout affichage (comme telephone.js › marquerCompte) : l'en-tête montre « Mes decks » et le rond du pseudo
TETE_COMPTE = ('<script>try { const c = JSON.parse(localStorage.getItem("atelier-compte") || "null"), h = document.documentElement; '
               'if (c && c.jeton) { h.classList.add("connecte"); if (c.pseudo) h.style.setProperty("--initiale", '
               'JSON.stringify(c.pseudo[0].toUpperCase())); } } catch (e) {}</script>')


# ---------------------------------------------------------------- les pages du compte, d'après le dernier passage

def _etat():
    import compte
    try:
        with open(ETAT, encoding="utf-8") as f:
            e = json.load(f)
    except (OSError, ValueError):
        return {}
    return e if e.get("email") and e.get("email") == compte._connexion().get("email") else {}


def _ecrire_etat(e):
    import compte
    e["email"] = compte._connexion().get("email")
    _ecrire(ETAT, json.dumps(e, ensure_ascii=False, indent=1))


def _registre():
    """{deck: {url, date, visibilite}} : les pages publiées du compte connecté."""
    return _etat().get("decks") or {}


VISIBILITES = ("public", "non-repertorie", "prive")


def visibilite(deck):
    """Celle du deck (2.3.0) : « Deck X/page.json » › visibilite, synchronisé comme le reste du deck ; absent : public."""
    try:
        with open(os.path.join(decks.RACINE, deck, "page.json"), encoding="utf-8") as f:
            v = json.load(f).get("visibilite")
        return v if v in VISIBILITES else "public"
    except (OSError, ValueError, AttributeError):
        return "public"


def changer_visibilite(deck, v):
    """Public, non répertorié ou privé : rangé dans le deck (page.json) ; privé, la page est retirée tout de suite,
    sinon surveiller() la publie dans la minute."""
    if v not in VISIBILITES:
        raise ValueError("Visibilité inconnue.")
    p = os.path.join(decks.RACINE, deck, "page.json")
    if v == "public":
        try:
            os.remove(p)
        except OSError:
            pass
    else:
        _ecrire(p, json.dumps({"visibilite": v}, ensure_ascii=False, indent=1) + "\n")
    p = _registre().get(deck)
    if v == "prive" and p:
        retirer(deck)
    elif p and p.get("visibilite", "public") != v:
        e = _etat()
        e["decks"][deck]["a_refaire"] = True
        _ecrire_etat(e)
    return etat_page(deck)


def etat_page(deck):
    """Pour « Partager » (app.js › modaleLien, comme telephone.js › etatPage) : {url, visibilite, publie, date}."""
    import compte
    if not compte._connexion().get("jeton"):
        raise compte.NonConnecte("Connecte-toi à ton compte : la page de ce deck sera sur atelier-mtg.com.", 401)
    p = _registre().get(deck) or {}
    pseudo = _etat().get("pseudo") or compte._connexion().get("pseudo") or ""
    url = p.get("url") or f"{DOMAINE_ATELIER}decks/{pseudo}/{slug(deck)}/"
    return dict(url=url, visibilite=visibilite(deck), publie=bool(p), date=p.get("date"))


def suivre(intervalle=300):
    """Relit les pages du compte sur le serveur (l'appli a pu en publier ou en retirer), au plus toutes les cinq minutes."""
    import compte
    e = _etat()
    if not compte._connexion().get("jeton") or time.time() - e.get("lu", 0) < intervalle:
        return
    r = compte._appel("GET", "/partages")
    avant = e.get("decks") or {}
    e.update(lu=time.time(), pseudo=r.get("pseudo"),
             decks={p["deck"]: dict(url=p["url"], date=p["date"], visibilite=p.get("visibilite") or "public",
                                    **({"a_refaire": True} if (avant.get(p["deck"]) or {}).get("a_refaire") else {}))
                    for p in r.get("partages") or []})
    _ecrire_etat(e)


def actif():
    """Connecté au compte : les decks partagés se republient tout seuls quand ils changent ici."""
    import compte
    return bool(compte._connexion().get("jeton"))


def _ecrire(chemin, texte):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin + ".tmp", "w", encoding="utf-8", newline="\n") as f:
        f.write(texte)
    os.replace(chemin + ".tmp", chemin)


def etat(deck):
    """{url, date} si le deck est partagé (plus {erreur} si la dernière mise à jour automatique a échoué), sinon {}."""
    p = _registre().get(deck)
    if not p:
        return {}
    e = _echecs.get(deck)
    return dict(url=p["url"], date=p["date"], **({"erreur": e[1]} if e else {}))


# ---------------------------------------------------------------- données de la page
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
    """Aucun chemin de ce PC ne doit partir en ligne."""
    for p in {os.path.expanduser("~"), decks.RACINE}:
        for forme in (p, p.replace("\\", "/"), json.dumps(p)[1:-1]):
            if forme and forme in texte:
                raise RuntimeError("Un chemin de ton PC est dans les données de la page : partage annulé")


# ---------------------------------------------------------------- pages
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


def _image(dessiner):
    """L'image d'aperçu (1200 × 630, JPEG) ; None si Pillow manque ou si le dessin échoue (la page s'en passe)."""
    try:
        import image_partage
        with tempfile.TemporaryDirectory() as d:
            chemin = os.path.join(d, "partage.jpg")
            dessiner(image_partage, chemin)
            with open(chemin, "rb") as f:
                return f.read()
    except Exception:
        return None


def _page(dossier, donnees, entete):
    """index.html, app.js, style.css et donnees.js : une copie de l'interface, figée avec ses données.
    entete : titre, description, url (adresse absolue de la page), image (adresse absolue de partage.jpg ou None), alt ;
    et pour une page à montrer aux moteurs de recherche : indexer, tete (lignes HTML en plus dans <head>)."""
    import reglages
    os.makedirs(dossier, exist_ok=True)
    for f in ("app.js", "style.css"):
        shutil.copyfile(os.path.join(STATIQUE, f), os.path.join(dossier, f))
    donnees = {"reglages": reglages.pour_la_page(),          # budget par carte : les cartes chères restent signalées
               "atelier": DEPOT,                              # recherche et discussion en vitrine : où télécharger l'Atelier
               "auteur": _auteur(),                           # « Decks de … » à la place de « Mes decks »
               "version": __version__,                        # la version de l'Atelier qui a publié la page
               **donnees}                                     # sauf avis contraire (page d'accueil de l'Atelier : sans auteur)
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
            f'<link rel="canonical" href="{e["url"]}">']
    if not e.get("indexer"):
        meta.append('<meta name="robots" content="noindex">')         # pour qui a le lien, pas pour les moteurs de recherche
    meta += ['<meta property="og:type" content="website">',
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
    # le thème choisi (bouton ◐), avant tout affichage : la page et ses captures (claires ou sombres) sont justes d'emblée
    meta.append('<script>try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}</script>')
    # connecté (l'appli, sur ce domaine, garde « atelier-compte ») : « Mes decks » et l'initiale du pseudo dès l'affichage
    meta.append(TETE_COMPTE)
    meta += entete.get("tete", [])
    html = (html.replace('<html lang="fr">', '<html lang="fr" class="partage">')    # barre de page partagée dès l'affichage
            .replace("<title>Atelier MTG</title>", "\n  ".join(meta))
            .replace('href="/static/style.css"', f'href="style.css?v={v["style.css"]}"')
            .replace('  <script src="/reglages.js"></script>\n', "")
            .replace('<script src="/static/app.js"></script>',
                     f'<script src="donnees.js?v={v["donnees.js"]}"></script>\n  <script src="app.js?v={v["app.js"]}"></script>'))
    _ecrire(os.path.join(dossier, "index.html"), html)


A_PROPOS = "a-propos"
DOMAINE_ATELIER = "https://atelier-mtg.com/"                # sa racine renvoie vers /fr/, en attendant l'anglais
ACCUEIL_ATELIER = DOMAINE_ATELIER + "fr/"                   # la page d'accueil, en français
IMAGE_ATELIER = DOMAINE_ATELIER + "a-propos/atelier.jpg"    # les images : à la racine, pour toutes les langues
TITRE_ATELIER = "L'Atelier MTG : Deck Builder Commander Gratuit (en Français)"
DESCRIPTION_ATELIER = ("Deck builder Commander gratuit et open source : créez, testez et partagez vos decks Magic (recherche "
                       "multicritère, prix Cardmarket, combos, bracket, simulateur).")
ALT_ATELIER = "L'Atelier MTG : deck builder Commander gratuit et open source"


def redirection(cible):
    """Une page qui renvoie aussitôt vers cible, avec la fin de l'adresse (#installation) : GitHub Pages ne sait pas
    rediriger vers un autre domaine ; la canonical et le refresh immédiat valent une redirection pour les moteurs."""
    return f"""<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>L'Atelier MTG</title>
  <link rel="canonical" href="{cible}">
  <meta http-equiv="refresh" content="0; url={cible}">
  <script>location.replace({json.dumps(cible)} + location.hash);</script>
</head>
<body>
  <p><a href="{cible}">L'Atelier MTG</a></p>
</body>
</html>
"""


def _auteur():
    """Le nom sur l'image d'aperçu : le pseudo du compte."""
    return _etat().get("pseudo") or ""


def _euros(x):
    return f"{x:.2f}".replace(".", ",") + " €"


def partager(deck, get, pseudo=None):
    """Publie (ou met à jour) la page du deck. pseudo : au premier partage. Renvoie {url, date}."""
    import compte
    import reglages
    with _verrou:
        donnees = capturer(deck, get)
        donnees["version"] = __version__
        _verifier(json.dumps(donnees, ensure_ascii=False))
        d = donnees["api"][f"/api/decks/{deck}"]
        b = donnees["api"].get(f"/api/decks/{deck}/bracket") or {}
        cmds = d.get("commandants") or []
        couleurs = nom_couleurs(d.get("identite"))
        nb_gc = len(d.get("gc") or [])
        chiffres = [f"{d['total']} cartes · {_euros(d['prix_total'])}",
                    " · ".join(x for x in (f"Bracket {b['estime']}" if b.get("estime") else "",
                                           f"{nb_gc} Game Changer{'s' if nb_gc > 1 else ''}") if x)]
        images = [c["info"].get("image") for c in d["cartes"] if c["cat"] == "Commander" and c["info"].get("image")]
        auteur = pseudo or _auteur()
        image = _image(lambda ip, chemin: ip.image_deck(
            chemin, d["titre"], "Deck Commander" + (f" · {couleurs}" if couleurs else ""), cmds, images, d.get("art"),
            d.get("identite"), chiffres, auteur))
        v = visibilite(deck)
        try:
            r = compte._appel("POST", "/partages", dict(
                deck=deck, donnees=donnees, image=base64.b64encode(image).decode() if image else None,
                budget=reglages.pour_la_page().get("budget"), pseudo=(pseudo or "").strip().lower() or None,
                visibilite=v if v != "prive" else "public", slug=slug(deck)))
        except compte.NonConnecte:
            raise
        except compte.Erreur as ex:
            if ex.statut == 409:
                raise PseudoRequis(str(ex)) from None
            raise
        e = _etat()
        e.setdefault("decks", {})[deck] = dict(url=r["url"], date=r["date"], visibilite=r.get("visibilite") or "public")
        e["pseudo"] = r.get("pseudo") or e.get("pseudo")
        _ecrire_etat(e)
    _echecs.pop(deck, None)
    _retirer_a_la_main(deck, False)
    return etat(deck)


def publier(liste, get):
    """Republie les pages de ces decks ; un deck qui échoue est noté dans _echecs, les autres partent."""
    for deck in liste:
        try:
            partager(deck, get)
        except Exception as ex:
            _echecs[deck] = (time.time(), str(ex))


def _retires():
    """Les decks retirés du partage à la main (reglages.json, jamais publié) : pas republiés tout seuls."""
    import reglages
    return set(reglages.lire().get("non_partages") or ())


def _retirer_a_la_main(deck, oui, nouveau=None):
    import reglages
    avant = _retires()
    apres = (avant - {deck}) | ({nouveau or deck} if oui else set())
    if apres != avant:
        reglages.ecrire(non_partages=sorted(apres) or None)


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
    """Depuis 2.3.0, chaque deck a sa page, sauf s'il est privé : les decks sans page, ceux modifiés sur ce PC (ou
    arrivés du compte) depuis la publication de la leur, ou dont la visibilité a changé, au calme depuis CALME secondes,
    sans échec trop récent. Un deck devenu privé (sur un autre appareil) : sa page est retirée."""
    if not actif():
        return []
    maintenant = maintenant or time.time()
    reg, r = _registre(), []
    for deck in decks.dossiers():
        p, e, v = reg.get(deck), _echecs.get(deck), visibilite(deck)
        if v == "prive":
            if p:
                retirer(deck)
            continue
        if e and maintenant - e[0] < REESSAI:
            continue
        t = derniere_modif(deck)
        if maintenant - t >= CALME and (not p or t > p["date"] or p.get("a_refaire") or p.get("visibilite", "public") != v):
            r.append(deck)
    return r


def slug(deck):
    """L'adresse que le serveur donnera au deck (pages.slug_de, sans les adresses déjà prises : il les évite)."""
    import unicodedata
    s = unicodedata.normalize("NFD", deck.removeprefix("Deck ")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:60].strip("-") or "deck"


def surveiller(get, pause=30):
    """En fond tant que l'Atelier est ouvert : relit les pages du compte, et republie celle d'un deck partagé quand on a
    fini de le modifier ici (depuis l'Atelier, le Claude de l'Atelier ou un éditeur). Les prix et les Game Changers
    sont mis à jour avant (rien n'est refait s'ils sont du jour)."""
    while True:
        time.sleep(pause)
        try:
            suivre()
        except Exception:
            pass
        try:
            liste = a_republier()
            if not liste:
                continue
            ic.mise_a_jour(sorted({c["nom"] for d in liste for c in decks.lire(decks.chemin(d))}))
        except Exception:
            continue
        publier(liste, get)


def renommer(ancien, nouveau):
    """Le deck a changé de nom : sa page garde son adresse (le lien déjà envoyé marche toujours) et sera republiée
    avec le nouveau titre par surveiller()."""
    import compte
    with _verrou:
        if ancien in _retires():
            _retirer_a_la_main(ancien, True, nouveau)
        e = _etat()
        reg = e.get("decks") or {}
        if ancien not in reg:
            return
        try:
            compte._appel("POST", "/partages/renommer", dict(ancien=ancien, nouveau=nouveau))
        except compte.Erreur:
            return
        reg[nouveau] = dict(reg.pop(ancien), a_refaire=True)
        _ecrire_etat(e)
    _echecs.pop(ancien, None)


def retirer(deck):
    """La page du deck n'est plus en ligne."""
    import compte
    with _verrou:
        compte._appel("POST", "/partages/retirer", dict(deck=deck))
        e = _etat()
        (e.get("decks") or {}).pop(deck, None)
        _ecrire_etat(e)
    _retirer_a_la_main(deck, True)
    return {}
