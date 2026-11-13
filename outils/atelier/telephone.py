"""L'Atelier sur téléphone : le PC prépare les pages de tous les decks et les dépose dans la sauvegarde en ligne.

L'appli du téléphone (un site à part, voir telephone_site.py) n'a pas de serveur Python : elle affiche ce que le PC a
préparé, comme les pages partagées (partage.capturer), mais en privé. Elle a donc tout ce que montre l'Atelier : liste,
fiches, statistiques, suggestions (classeur compris), combos, bracket, versions, achats, et le classeur.

Les pages vont dans le dépôt privé de la sauvegarde (synchro.py), sur une branche à part, « telephone », qui ne garde pas
d'historique : chaque envoi la remplace (un commit sans parent), pour que le dépôt ne grossisse pas des prix qui
changent. Fichiers, en JSON compressé (gzip) :
- index.json.gz : la liste des decks, le classeur, où sont mes cartes, les réglages de la page, et le fichier de chaque deck ;
- decks/<empreinte du nom>.json.gz : les réponses de l'API pour la page du deck.
Seuls les decks modifiés depuis l'envoi précédent sont recalculés, et tous une fois par semaine (les prix).

Le téléphone reçoit la clé GitHub du PC par un QR code (Options › Téléphone) : lien() la met dans l'adresse de l'appli,
après « # » (le navigateur ne l'envoie à aucun serveur). La préparation ne tourne que si on l'a demandée (réglage
« telephone ») et que la sauvegarde en ligne marche.
"""
import base64
import gzip
import hashlib
import json
import os
import threading
import time
import urllib.parse

import decks
import github
import reglages
import synchro

ICI = os.path.dirname(os.path.abspath(__file__))
ADRESSE = "https://atelier-mtg.github.io/"      # l'appli du téléphone (organisation GitHub « atelier-mtg »)
BRANCHE = "telephone"
FORMAT = 1                                       # version des fichiers : l'appli refuse un format qu'elle ne connaît pas
ETAT = os.path.join(ICI, "telephone.json")       # ce qui a été envoyé : empreinte et fichier de chaque deck (propre à ce PC)
CALME = 60             # secondes sans modification avant de préparer : une série d'ajouts ne part qu'une fois
SEMAINE = 7 * 86400    # au-delà, un deck est recalculé même sans modification (prix du jour)
REESSAI = 600          # après un échec (pas de réseau…), nouvel essai dix minutes plus tard
_verrou = threading.Lock()
suivi = {"en_cours": False, "erreur": "", "echec": 0}


def voulu():
    return reglages.lire().get("telephone") is True


def actif():
    return voulu() and synchro.active()


def _lire_etat():
    try:
        with open(ETAT, encoding="utf-8") as f:
            e = json.load(f)
        return e if e.get("compte") == github.compte() and e.get("format") == FORMAT else {}
    except (OSError, ValueError):
        return {}


def _ecrire_etat(e):
    with open(ETAT + ".tmp", "w", encoding="utf-8") as f:
        json.dump(e, f, ensure_ascii=False)
    os.replace(ETAT + ".tmp", ETAT)


def etat():
    """Pour la page : {voulu, possible (sauvegarde en marche), actif, en_cours, derniere, decks, erreur, adresse}."""
    e = _lire_etat()
    return dict(voulu=voulu(), possible=synchro.active(), actif=actif(), en_cours=suivi["en_cours"],
                derniere=e.get("date"), decks=len(e.get("decks") or {}), erreur=suivi["erreur"] if actif() else "",
                adresse=ADRESSE)


def lien():
    """L'adresse de l'appli avec de quoi lire la sauvegarde : le dépôt et la clé GitHub, après « # »."""
    jeton = github._lire().get("jeton")
    d = synchro._depot(creer=False)
    if not jeton or not d:
        raise github.NonConnecte("Active d'abord la sauvegarde en ligne.")
    code = base64.urlsafe_b64encode(json.dumps({"d": d["depot"], "c": jeton}).encode()).decode().rstrip("=")
    return f"{ADRESSE}#appairer={code}"


# ---------------------------------------------------------------- les pages préparées
def _empreinte(deck):
    """Change dès qu'un fichier du deck change (sans l'historique ni la discussion), ou le classeur : ses cartes
    entrent dans les suggestions et les achats."""
    h = hashlib.sha1()
    base = os.path.join(decks.RACINE, deck)
    fichiers = [os.path.join(decks.RACINE, "Classeur", "classeur.txt")]
    for racine, sous, noms in os.walk(base):
        sous[:] = sorted(s for s in sous if s not in (decks.HISTO, ".git"))
        fichiers += [os.path.join(racine, n) for n in sorted(noms) if not n.endswith(".tmp") and n != "discussion.json"]
    for p in fichiers:
        try:
            s = os.stat(p)
        except OSError:
            continue
        h.update(f"{os.path.relpath(p, decks.RACINE)}\0{s.st_mtime_ns}\0{s.st_size}\n".encode())
    return h.hexdigest()


def _fichier(deck):
    return "decks/" + hashlib.sha1(deck.encode()).hexdigest()[:16] + ".json.gz"


def _gz(donnees):
    """JSON compressé, toujours les mêmes octets pour les mêmes données (date de compression à zéro)."""
    return gzip.compress(json.dumps(donnees, ensure_ascii=False, separators=(",", ":")).encode(), compresslevel=9, mtime=0)


def capturer(deck, get):
    """Les réponses de l'API pour la page du deck, comme une page partagée, plus ce qui reste privé : les achats, et les
    suggestions entières (classeur compris, cartes écartées)."""
    import partage
    d = partage.capturer(deck, get)
    racine = f"/api/decks/{deck}"
    for chemin in (racine + "/suggestions", racine + "/achats"):
        r = get(urllib.parse.quote(chemin))
        if r.status_code == 200:
            d["api"][partage._cle(chemin)] = r.get_json()
    return d


def _index(get, fichiers):
    """Ce que montrent l'accueil et les Options : les decks, le classeur, où sont mes cartes, les réglages."""
    api = {}
    for chemin in ("/api/decks", "/api/classeur", "/api/ou-sont", "/api/options", "/api/corbeille"):
        r = get(chemin)
        if r.status_code == 200:
            api[chemin] = r.get_json()
    from version import __version__
    s = synchro._lire_etat()
    # source : le commit de la sauvegarde que ces pages reflètent (le téléphone sait ainsi si ses propres modifications,
    # envoyées sur la branche des decks, y sont déjà) ; branche : celle des decks, où le téléphone les envoie
    return dict(format=FORMAT, date=time.time(), version=__version__, compte=github.compte(),
                reglages=reglages.pour_la_page(), decks=fichiers, api=api, source=s.get("commit"), branche=s.get("branche"))


def _empreintes():
    return {deck: _empreinte(deck) for deck in decks.dossiers() if os.path.exists(os.path.join(decks.RACINE, deck, decks.FICHIER))}


def preparer(get, tout=False):
    """Recalcule les pages des decks qui ont changé et envoie la branche « telephone ». Renvoie le nombre de decks
    recalculés (0 : rien n'a changé, rien n'est envoyé)."""
    with _verrou:
        suivi["en_cours"] = True
        try:
            n = _preparer(get, tout)
            suivi.update(erreur="", echec=0)
            return n
        except Exception as e:
            suivi.update(erreur=str(e), echec=time.time())
            raise
        finally:
            suivi["en_cours"] = False


def _preparer(get, tout):
    e = _lire_etat()
    connus = e.get("decks") or {}
    maintenant = time.time()
    empreintes = _empreintes()
    a_faire = [d for d, h in empreintes.items()
               if tout or d not in connus or connus[d]["empreinte"] != h or maintenant - connus[d]["date"] > SEMAINE]
    if not a_faire and set(connus) == set(empreintes) and e.get("commit"):
        return 0
    fichiers = {}                                        # {chemin dans la branche: octets} à envoyer
    nouveaux = {}
    for deck, h in empreintes.items():
        if deck in a_faire:
            donnees = _gz(capturer(deck, get))
            fichiers[_fichier(deck)] = donnees
            nouveaux[deck] = dict(empreinte=h, date=maintenant, sha=github.sha_blob(donnees))
        else:
            nouveaux[deck] = connus[deck]
    index = _gz(_index(get, {deck: _fichier(deck) for deck in empreintes}))
    fichiers["index.json.gz"] = index
    d = synchro._depot(creer=False)
    if not d:
        raise github.Erreur("La sauvegarde en ligne n'a pas encore de dépôt.")
    try:
        commit = _envoyer(d["depot"], fichiers, {_fichier(x): v["sha"] for x, v in nouveaux.items() if x not in a_faire})
    except github.Erreur as err:
        if err.statut != 422 or not connus:
            raise
        # un fichier d'avant n'est plus dans le dépôt (refait à la main…) : on repart de zéro
        _ecrire_etat({})
        return _preparer(get, True)
    _ecrire_etat(dict(compte=github.compte(), format=FORMAT, depot=d["depot"], commit=commit, date=maintenant, decks=nouveaux))
    return len(a_faire)


def _envoyer(depot, fichiers, deja):
    """Remplace la branche par ces fichiers, plus ceux déjà dans le dépôt (deja : {chemin: empreinte}), en un commit
    sans parent. Renvoie le commit."""
    entrees = [dict(path=p, mode="100644", type="blob", sha=sha) for p, sha in deja.items()]
    for p, donnees in fichiers.items():
        b = github.appel("POST", f"/repos/{depot}/git/blobs", dict(content=base64.b64encode(donnees).decode(), encoding="base64"))
        entrees.append(dict(path=p, mode="100644", type="blob", sha=b["sha"]))
    arbre = github.appel("POST", f"/repos/{depot}/git/trees", dict(tree=entrees))["sha"]
    commit = github.appel("POST", f"/repos/{depot}/git/commits", dict(message="Decks pour le téléphone", tree=arbre, parents=[]))["sha"]
    try:
        github.appel("PATCH", f"/repos/{depot}/git/refs/heads/{BRANCHE}", dict(sha=commit, force=True))
    except github.Erreur as err:
        if err.statut not in (404, 422):
            raise
        github.appel("POST", f"/repos/{depot}/git/refs", dict(ref=f"refs/heads/{BRANCHE}", sha=commit))
    return commit


def couper():
    """Plus de préparation pour le téléphone ; la branche est retirée du dépôt (l'appli n'a plus rien à lire)."""
    reglages.ecrire(telephone=False)
    e = _lire_etat()
    try:
        if e.get("depot"):
            github.appel("DELETE", f"/repos/{e['depot']}/git/refs/heads/{BRANCHE}", ok=(204,))
    except (github.Erreur, OSError):
        pass
    _ecrire_etat({})


def surveiller(get, pause=20):
    """En fond tant que l'Atelier est ouvert : prépare les decks pour le téléphone une minute après une série de
    modifications, et chaque semaine pour les prix."""
    time.sleep(30)
    vue, depuis = None, 0
    while True:
        try:
            if actif() and time.time() - suivi["echec"] >= REESSAI:
                h = hashlib.sha1(json.dumps(_empreintes(), sort_keys=True).encode()).hexdigest()
                if h != vue:
                    vue, depuis = h, time.time()
                if time.time() - depuis >= CALME:
                    preparer(get)
        except Exception:
            pass
        time.sleep(pause)
