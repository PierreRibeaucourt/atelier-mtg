"""Connexion à GitHub depuis l'Atelier, pour partager ses decks sans git ni ligne de commande.

Flux « par appareil » d'une application OAuth : l'Atelier demande un code à GitHub, la personne le colle sur
github.com/login/device (où elle peut aussi créer son compte) et accepte ; l'Atelier reçoit alors un jeton, limité aux
dépôts publics (public_repo), gardé sur ce PC seulement (chiffré par Windows pour cette session). Aucun mot de passe ni
jeton ne passe par la page.

Publier, c'est recopier un dossier local dans un dépôt GitHub par l'API Git (blobs, arbre, commit) : seuls les fichiers
changés partent. Voir partage.py, qui s'en sert quand l'Atelier est connecté.
"""
import base64
import hashlib
import json
import os
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ICI = os.path.dirname(os.path.abspath(__file__))
# l'application OAuth « Atelier MTG » (flux par appareil activé) : un identifiant public, pas un secret
CLIENT_ID = os.environ.get("ATELIER_GITHUB_CLIENT_ID", "Ov23li9fE6JyGKnCmR3L")
PORTEE = "public_repo"
FICHIER = os.path.join(ICI, "connexion_github.dat")
API = "https://api.github.com"
_verrou = threading.Lock()
_flux = {}                      # connexion en cours : etat (attente, ok, refus, expire, erreur), code, url, expire


class Erreur(RuntimeError):
    def __init__(self, message, statut=None):
        super().__init__(message)
        self.statut = statut


class NonConnecte(Erreur):
    code = 401                  # réponse de l'API de l'Atelier : la page propose alors de se connecter


# ---------------------------------------------------------------- le jeton, chiffré pour la session Windows
def _dpapi(donnees, chiffrer):
    import ctypes
    from ctypes import wintypes

    class BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.c_void_p)]
    tampon = ctypes.create_string_buffer(donnees, len(donnees))
    entree, sortie = BLOB(len(donnees), ctypes.cast(tampon, ctypes.c_void_p)), BLOB()
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    f = crypt32.CryptProtectData if chiffrer else crypt32.CryptUnprotectData
    f.argtypes = [ctypes.POINTER(BLOB), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                  wintypes.DWORD, ctypes.POINTER(BLOB)]
    f.restype = wintypes.BOOL
    if not f(ctypes.byref(entree), None, None, None, None, 1, ctypes.byref(sortie)):      # 1 : sans fenêtre
        raise OSError("chiffrement Windows impossible")
    try:
        return ctypes.string_at(sortie.pbData, sortie.cbData)
    finally:
        kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        kernel32.LocalFree(sortie.pbData)


def _lire():
    try:
        with open(FICHIER, "rb") as f:
            brut = f.read()
        return json.loads(_dpapi(brut, False) if os.name == "nt" else brut)
    except (OSError, ValueError):
        return {}


def _garder(connexion):
    brut = json.dumps(connexion).encode()
    with open(FICHIER, "wb") as f:
        f.write(_dpapi(brut, True) if os.name == "nt" else brut)
    if os.name != "nt":
        os.chmod(FICHIER, 0o600)


def compte():
    """Le compte GitHub connecté, ou None."""
    return _lire().get("compte")


def auteur():
    """L'auteur des commits de l'Atelier : le compte, avec son adresse anonyme de GitHub. Sans elle, GitHub met
    l'adresse e-mail principale du compte, visible de tous dans un dépôt public."""
    c = _lire()
    if not c.get("id"):                                     # connecté avant que l'Atelier ne note l'identifiant
        c["id"] = _appel("GET", "/user")["id"]
        _garder(c)
    return dict(name=c["compte"], email=f"{c['id']}+{c['compte']}@users.noreply.github.com")


def deconnecter():
    try:
        os.remove(FICHIER)
    except OSError:
        pass
    _flux.clear()


# ---------------------------------------------------------------- connexion par code
def _poster(url, donnees):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(donnees).encode(),
                                 headers={"Accept": "application/json", "User-Agent": "atelier-mtg"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def _cause(e):
    """Pourquoi une requête n'a pas abouti, en quelques mots : le message le dit, et le journal (atelier.log) le garde.
    Sans elle, un pare-feu, une horloge fausse (certificat refusé) ou une coupure donnaient tous « GitHub ne répond pas »."""
    print(f"GitHub : {type(e).__name__} : {e}", file=sys.stderr, flush=True)
    r = getattr(e, "reason", e)
    texte = str(r)
    if isinstance(r, ssl.SSLCertVerificationError) or "CERTIFICATE" in texte.upper():
        return "certificat refusé. Vérifie la date et l'heure du PC, ou ton antivirus."
    if isinstance(r, ssl.SSLError):
        return "connexion sécurisée impossible. Un antivirus ou un pare-feu bloque peut-être GitHub."
    if isinstance(r, socket.gaierror):
        return "adresse introuvable. Le PC est-il connecté à Internet ?"
    quoi = ("pas de réponse à temps" if isinstance(r, TimeoutError) or "timed out" in texte
            else "connexion coupée" if isinstance(r, ConnectionError) else type(r).__name__)
    return quoi + ". Vérifie ta connexion, puis réessaie."


def connecter():
    """Demande un code à GitHub et attend en fond qu'on l'accepte. Renvoie {code, url, expire}."""
    if not CLIENT_ID:
        raise Erreur("La connexion à GitHub n'est pas encore disponible dans cette version de l'Atelier.")
    for essai in range(2):                                   # un raté passager (réseau qui revient, Wi-Fi) : un second essai
        try:
            d = _poster("https://github.com/login/device/code", dict(client_id=CLIENT_ID, scope=PORTEE))
            break
        except urllib.error.HTTPError as e:                  # GitHub répond, mais refuse (trop de demandes…)
            try:
                desc = json.loads(e.read()).get("error_description", "")
            except (OSError, ValueError, AttributeError):
                desc = ""
            _cause(e)
            raise Erreur(f"GitHub refuse la demande ({e.code}{' : ' + desc if desc else ''}). Réessaie dans quelques minutes.") from None
        except ValueError as e:                              # une page qui n'est pas de GitHub (proxy, portail Wi-Fi)
            _cause(e)
            raise Erreur("GitHub a répondu une page inattendue : un proxy ou un portail Wi-Fi ? Réessaie plus tard.") from None
        except OSError as e:
            cause = _cause(e)
            if essai:
                raise Erreur(f"GitHub ne répond pas : {cause}") from None
            time.sleep(2)
    if "device_code" not in d:
        raise Erreur("GitHub refuse la connexion (" + d.get("error_description", d.get("error", "?")) + ").")
    ticket = object()                                       # une nouvelle demande rend caduque l'attente de la précédente
    with _verrou:
        _flux.clear()
        _flux.update(etat="attente", code=d["user_code"], url=d["verification_uri"], expire=time.time() + d["expires_in"],
                     ticket=ticket)
    threading.Thread(target=_attendre, args=(d["device_code"], d.get("interval", 5), ticket), daemon=True).start()
    return etat_connexion()


def _attendre(code_appareil, intervalle, ticket):
    """Interroge GitHub jusqu'à ce que la personne accepte, refuse, ou que le code expire."""
    while _flux.get("ticket") is ticket and time.time() < _flux.get("expire", 0):
        time.sleep(intervalle)
        try:
            r = _poster("https://github.com/login/oauth/access_token", dict(
                client_id=CLIENT_ID, device_code=code_appareil, grant_type="urn:ietf:params:oauth:grant-type:device_code"))
        except (OSError, ValueError):
            continue                                                # réseau coupé un instant : on réessaie
        if r.get("access_token"):
            try:
                moi = _appel("GET", "/user", jeton_acces=r["access_token"])
                _garder({"jeton": r["access_token"], "compte": moi["login"], "id": moi["id"]})
                etat = dict(etat="ok", compte=moi["login"])
            except (Erreur, OSError) as e:
                etat = dict(etat="erreur", erreur=str(e))
            break
        e = r.get("error")
        if e == "slow_down":
            intervalle = r.get("interval", intervalle + 5)
        elif e != "authorization_pending":
            etat = dict(etat="refus" if e == "access_denied" else "expire" if e in ("expired_token", "token_expired")
                        else "erreur", erreur=r.get("error_description", e))
            break
    else:
        etat = dict(etat="expire")
    with _verrou:
        if _flux.get("ticket") is ticket:
            _flux.update(etat)


def etat_connexion():
    """Où en est la connexion : {etat, code, url, compte, erreur}."""
    if compte() and _flux.get("etat") in (None, "ok"):
        return dict(etat="ok", compte=compte())
    return {k: v for k, v in _flux.items() if k in ("etat", "code", "url", "compte", "erreur")} or dict(etat="aucune")


# ---------------------------------------------------------------- l'API de GitHub
def _appel(methode, chemin, donnees=None, jeton_acces=None, ok=(200, 201)):
    jeton_acces = jeton_acces or _lire().get("jeton")
    if not jeton_acces:
        raise NonConnecte("Pour partager tes decks, connecte l'Atelier à GitHub (compte gratuit).")
    req = urllib.request.Request(API + chemin, method=methode,
                                 data=None if donnees is None else json.dumps(donnees).encode(),
                                 headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {jeton_acces}",
                                          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "atelier-mtg"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            corps = r.read()
            statut = r.status
    except urllib.error.HTTPError as e:
        corps, statut = e.read(), e.code
    except OSError as e:
        raise Erreur(f"GitHub ne répond pas : {_cause(e)}") from None
    if statut == 401:
        deconnecter()
        raise NonConnecte("La connexion à GitHub a expiré : reconnecte l'Atelier.", 401)
    if statut not in ok:
        try:
            msg = json.loads(corps).get("message", "")
        except ValueError:
            msg = ""
        raise Erreur(f"GitHub refuse ({statut}{' : ' + msg if msg else ''}).", statut)
    return json.loads(corps) if corps else {}


def appel(methode, chemin, donnees=None, ok=(200, 201)):
    return _appel(methode, chemin, donnees, ok=ok)


# ---------------------------------------------------------------- recopier un dossier dans un dépôt
def sha_blob(donnees):
    """L'empreinte que git donne à un fichier : sert à ne renvoyer que ce qui a changé."""
    return hashlib.sha1(b"blob %d\0" % len(donnees) + donnees).hexdigest()


def fichiers_locaux(dossier, exclus=()):
    """{chemin/avec/des/barres: chemin complet} des fichiers du dossier, sans .git ni les exclus."""
    res = {}
    for racine, sous, noms in os.walk(dossier):
        sous[:] = [s for s in sous if s != ".git"]
        for n in noms:
            chemin = os.path.join(racine, n)
            rel = os.path.relpath(chemin, dossier).replace(os.sep, "/")
            if rel not in exclus:
                res[rel] = chemin
    return res


def arbre(depot, branche):
    """(commit de tête, arbre de tête, {chemin: empreinte}) de la branche du dépôt."""
    tete = appel("GET", f"/repos/{depot}/git/ref/heads/{branche}")["object"]["sha"]
    a = appel("GET", f"/repos/{depot}/git/commits/{tete}")["tree"]["sha"]
    t = appel("GET", f"/repos/{depot}/git/trees/{a}?recursive=1")
    return tete, a, {x["path"]: x["sha"] for x in t["tree"] if x["type"] == "blob"}


def telecharger(depot, sha):
    return base64.b64decode(appel("GET", f"/repos/{depot}/git/blobs/{sha}")["content"])


def envoyer(depot, branche, dossier, message, exclus=()):
    """Fait du dépôt le reflet du dossier en un commit : fichiers nouveaux ou changés envoyés, absents retirés.
    Renvoie le commit de tête (inchangé s'il n'y avait rien à envoyer)."""
    for essai in range(2):
        tete, base, distant = arbre(depot, branche)
        local = fichiers_locaux(dossier, exclus)
        entrees = []
        for rel, chemin in sorted(local.items()):
            with open(chemin, "rb") as f:
                donnees = f.read()
            if distant.get(rel) != sha_blob(donnees):
                b = appel("POST", f"/repos/{depot}/git/blobs",
                          dict(content=base64.b64encode(donnees).decode(), encoding="base64"))
                entrees.append(dict(path=rel, mode="100644", type="blob", sha=b["sha"]))
        entrees += [dict(path=rel, mode="100644", type="blob", sha=None) for rel in sorted(distant) if rel not in local]
        if not entrees:
            return tete
        a = appel("POST", f"/repos/{depot}/git/trees", dict(base_tree=base, tree=entrees))["sha"]
        qui = auteur()
        c = appel("POST", f"/repos/{depot}/git/commits", dict(message=message, tree=a, parents=[tete], author=qui,
                                                              committer=qui))["sha"]
        try:
            appel("PATCH", f"/repos/{depot}/git/refs/heads/{branche}", dict(sha=c))
            return c
        except Erreur as e:
            if e.statut != 422 or essai:             # 422 : la branche a bougé entre-temps, on recommence une fois
                raise
    return tete
