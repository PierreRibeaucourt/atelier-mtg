"""Le compte Atelier MTG sur ce PC : on s'y connecte par un code reçu par e-mail (api.atelier-mtg.com, outils/serveur/).

Depuis 2.3.0, le PC se synchronise tout seul avec le compte, comme l'appli (synchroniser(), en fond : boucle()). Il
compare trois états, ses fichiers, ceux du compte et ceux de la dernière synchronisation (compte_etat.json › fichiers) :
ce qui a changé d'un seul côté passe de l'autre ; changé des deux côtés, la version de ce PC l'emporte et la liste
d'en face entre dans l'historique du deck (les journaux sont fusionnés) ; un deck supprimé ou renommé d'un côté, sans
changement de l'autre, part dans la corbeille de ce PC (ou quitte le compte).

Avant 2.3.0, le PC ne se synchronisait que quand on le demandait (envoyer(), recuperer(), gardés pour l'instant) :
- Envoyer : les decks, le classeur et les réglages des cartes de ce PC partent sur le compte ;
- Récupérer : ceux du compte arrivent sur ce PC.
Dans les deux sens on ajoute et on remplace. La liste d'un deck qu'on remplace est d'abord gardée dans son historique,
si elle n'y est pas déjà (« Liste d'un autre appareil », ou celle de ce PC avant « Récupérer ») ; les journaux de
l'historique et des versions sont fusionnés. Rien ne se perd.

Pas de deck en double : un deck renommé ou supprimé d'un côté l'est aussi de l'autre, s'il n'y a pas changé depuis le
dernier échange (compte_etat.json › communs : la liste de chaque deck pareil des deux côtés). Envoyer le retire du
compte ; Récupérer le met dans la corbeille de ce PC. Un deck changé entre-temps est gardé.

Les fichiers ont la même forme que dans l'appli (telephone.js › @depot) : « Deck X/archidekt.txt », « Classeur/… »,
« Réglages Atelier/cartes.json »… Le jeton de connexion reste sur ce PC, chiffré par Windows (connexion_compte.dat).
"""
import hashlib
import json
import os
import platform
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime

import decks
import reglages

ICI = os.path.dirname(os.path.abspath(__file__))
API = (os.environ.get("ATELIER_API") or "https://api.atelier-mtg.com").rstrip("/")
FICHIER = os.path.join(ICI, "connexion_compte.dat")     # {email, jeton}, chiffré
ETAT = os.path.join(ICI, "compte_etat.json")            # {email, envoi, reception, empreinte}
CLASSEUR = "Classeur"
SANS = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif", ".bmp", ".tif", ".tiff", ".mp4", ".mov", ".tmp")
TAILLE_MAX = 1 << 20                                    # comme le serveur
LOT, LOT_OCTETS = 400, 4_000_000                        # fichiers et octets par requête
JOURNAUX = (f"/{decks.HISTO}/journal.json", f"/{decks.VERSIONS}/versions.json")
AUTRE = "Liste d'un autre appareil (compte)"
AVANT = "Liste de ce PC avant « Récupérer »"

_verrou = threading.Lock()
suivi = dict(en_cours=False, erreur="")
quand_recu = None      # appelé quand des fichiers arrivent (app.py : fiches et prix des nouvelles cartes)


class Erreur(RuntimeError):
    def __init__(self, message, statut=None):
        super().__init__(message)
        self.statut = statut


class NonConnecte(Erreur):
    code = 401


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


def lire_chiffre(fichier):
    try:
        with open(fichier, "rb") as f:
            brut = f.read()
        return json.loads(_dpapi(brut, False) if os.name == "nt" else brut)
    except (OSError, ValueError):
        return {}


def garder_chiffre(fichier, donnees):
    brut = json.dumps(donnees).encode()
    with open(fichier, "wb") as f:
        f.write(_dpapi(brut, True) if os.name == "nt" else brut)
    if os.name != "nt":
        os.chmod(fichier, 0o600)


def _connexion():
    return lire_chiffre(FICHIER)


def _oublier():
    try:
        os.remove(FICHIER)
    except OSError:
        pass


def _etat():
    try:
        with open(ETAT, encoding="utf-8") as f:
            e = json.load(f)
        return e if e.get("email") == _connexion().get("email") else {}
    except (OSError, ValueError):
        return {}


def _ecrire_etat(**valeurs):
    e = _etat()
    e.update(email=_connexion().get("email"), **valeurs)
    with open(ETAT + ".tmp", "w", encoding="utf-8") as f:
        json.dump(e, f, ensure_ascii=False)
    os.replace(ETAT + ".tmp", ETAT)


# ---------------------------------------------------------------- le serveur
def _cause(e):
    """Pourquoi le serveur n'a pas répondu, en quelques mots (le journal atelier.log garde le détail)."""
    print(f"Compte : {type(e).__name__} : {e}", file=sys.stderr, flush=True)
    r = getattr(e, "reason", e)
    texte = str(r)
    if isinstance(r, ssl.SSLCertVerificationError) or "CERTIFICATE" in texte.upper():
        if getattr(r, "verify_code", None) in (9, 10, 0x800B0101) or "expired" in texte or "not yet valid" in texte:
            return "certificat refusé : la date ou l'heure du PC est fausse."
        return "certificat refusé. Un antivirus ou un proxy intercepte peut-être la connexion."
    if isinstance(r, ssl.SSLError):
        return "connexion sécurisée impossible. Un antivirus ou un pare-feu bloque peut-être la connexion."
    if isinstance(r, socket.gaierror):
        return "adresse introuvable. Le PC est-il connecté à Internet ?"
    quoi = ("pas de réponse à temps" if isinstance(r, TimeoutError) or "timed out" in texte
            else "connexion coupée" if isinstance(r, ConnectionError) else type(r).__name__)
    return quoi + ". Vérifie ta connexion, puis réessaie."


def _appel(methode, chemin, corps=None, avec_jeton=True, autre_jeton=None, brut=None, type_brut=None):
    """corps : envoyé en JSON ; brut (octets, de type type_brut) : tel quel."""
    entetes = {"Accept": "application/json", "User-Agent": "atelier-mtg"}
    if avec_jeton:
        jeton = autre_jeton or _connexion().get("jeton")
        if not jeton:
            raise NonConnecte("Connecte-toi à ton compte.")
        entetes["Authorization"] = f"Bearer {jeton}"
    donnees = brut if brut is not None else None if corps is None else json.dumps(corps).encode()
    if donnees is not None:
        entetes["Content-Type"] = type_brut if brut is not None else "application/json"
    req = urllib.request.Request(API + chemin, data=donnees, method=methode, headers=entetes)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            brut = r.read()
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("erreur") or ""
        except (OSError, ValueError, AttributeError):
            msg = ""
        if e.code == 401 and avec_jeton and not autre_jeton:
            _oublier()
            raise NonConnecte("Ta connexion au compte a pris fin : reconnecte-toi.", 401) from None
        raise Erreur(msg or f"Le serveur refuse ({e.code}).", e.code) from None
    except OSError as e:
        raise Erreur(f"Le serveur ne répond pas : {_cause(e)}") from None
    try:
        return json.loads(brut) if brut else {}
    except ValueError:
        raise Erreur("Le serveur a répondu une page inattendue : un proxy ou un portail Wi-Fi ? Réessaie plus tard.") from None


# ---------------------------------------------------------------- connexion
def nom_appareil():
    return f"PC · {platform.node() or 'Windows'}"[:80]


def demander_code(email):
    _appel("POST", "/connexion/code", dict(email=str(email or "").strip()), avec_jeton=False)
    return dict(ok=True)


def se_connecter(email, code):
    """Le code reçu ouvre le compte sur ce PC ; une connexion d'avant (même compte ou un autre) est retirée du compte."""
    ancien = _connexion().get("jeton")
    r = _appel("POST", "/connexion/verifier", dict(email=str(email or "").strip(), code=str(code or "").strip(),
                                                   appareil=nom_appareil()), avec_jeton=False)
    with _verrou:                                                 # une synchronisation en cours finit avec l'ancien compte
        garder_chiffre(FICHIER, dict(email=r["email"], jeton=r["jeton"], pseudo=r.get("pseudo")))
    suivi["erreur"] = ""
    reveil.set()                                                  # la synchronisation, tout de suite
    if ancien and ancien != r["jeton"]:
        try:
            _appel("POST", "/deconnexion", {}, autre_jeton=ancien)
        except Erreur:
            pass
    return etat()


def adopter(jeton, email, pseudo=None):
    """Le site (atelier-mtg.com, connecté) donne à ce PC sa propre connexion au compte (serveur : /connexion/appareil),
    par le pont : app.py › api_module_appairer. Comme se_connecter, sans code."""
    jeton, email = str(jeton or "").strip(), str(email or "").strip().lower()
    if len(jeton) < 32 or "@" not in email:
        raise Erreur("Connexion incomplète.")
    actuel = _connexion()
    if actuel.get("jeton") and actuel.get("email") != email:
        raise Erreur(f"Ce PC est connecté à un autre compte ({actuel.get('email')}).", 409)
    with _verrou:
        garder_chiffre(FICHIER, dict(email=email, jeton=jeton, pseudo=pseudo or None))
    suivi["erreur"] = ""
    reveil.set()
    if actuel.get("jeton") and actuel["jeton"] != jeton:
        try:
            _appel("POST", "/deconnexion", {}, autre_jeton=actuel["jeton"])
        except Erreur:
            pass
    return etat()


def lien_module(port):
    """L'adresse qui associe cet Atelier au compte ouvert sur le site (app.py, au lancement sans connexion)."""
    site = os.environ.get("ATELIER_SITE") or "https://atelier-mtg.com/mes-decks/"
    return f"{site}#/module/{int(port)}/{secret_pont()}"


def deconnecter():
    """Se déconnecter : le jeton est retiré du compte, puis oublié ici. Les decks de ce PC restent."""
    with _verrou:                                                 # pas au milieu d'une synchronisation
        try:
            _appel("POST", "/deconnexion", {})
        except Erreur:
            pass
        _oublier()
    return etat()


def supprimer(email):
    _appel("DELETE", "/compte", dict(email=str(email or "").strip()))
    _oublier()
    return etat()


def appareils():
    return _appel("GET", "/appareils")


def oublier_appareil(ident):
    return _appel("DELETE", f"/appareils/{int(ident)}")


def exporter():
    return _appel("GET", "/compte/export")


# ---------------------------------------------------------------- fichiers de ce PC
def sha(texte):
    """L'empreinte git d'un texte, comme le serveur (serveur.sha_blob) et l'appli (shaBlob)."""
    o = texte.encode("utf-8")
    return hashlib.sha1(b"blob %d\0" % len(o) + o).hexdigest()


def _dossiers():
    return decks.dossiers() + [d for d in (CLASSEUR, reglages.DOSSIER_CARTES) if os.path.isdir(os.path.join(decks.RACINE, d))]


def locaux():
    """{chemin dans le compte: chemin sur ce PC} : les dossiers des decks, le classeur et les réglages des cartes, sans
    les photos ni les fichiers cachés."""
    res = {}
    for d in _dossiers():
        base = os.path.join(decks.RACINE, d)
        for racine, sous, noms in os.walk(base):
            sous[:] = [s for s in sous if not s.startswith(".")]
            for n in noms:
                rel = os.path.relpath(os.path.join(racine, n), base).replace(os.sep, "/")
                if not n.startswith(".") and not n.lower().endswith(SANS):
                    res[f"{d}/{rel}"] = os.path.join(racine, n)
    return res


def empreinte():
    """Change dès qu'un fichier envoyé change, sans le lire (date et taille) : « À envoyer » sur l'accueil."""
    h = hashlib.sha1()
    for rel, chemin in sorted(locaux().items()):
        try:
            s = os.stat(chemin)
        except OSError:
            continue
        h.update(f"{rel}\0{s.st_mtime_ns}\0{s.st_size}\n".encode())
    return h.hexdigest()


def _texte(chemin):
    """Le texte du fichier, ou None s'il ne peut pas aller sur le compte (trop gros, pas du texte)."""
    try:
        with open(chemin, "rb") as f:
            b = f.read(TAILLE_MAX + 1)
        return b.decode("utf-8") if len(b) <= TAILLE_MAX else None
    except (OSError, UnicodeDecodeError):
        return None


def _chemin_sur(rel):
    """Le chemin d'un fichier du compte sur ce PC, s'il reste dans un dossier de deck, le classeur ou les réglages."""
    parts = rel.split("/") if isinstance(rel, str) else []
    if (len(parts) < 2 or any(p in ("", ".", "..") or p.startswith(".") or p != p.strip() for p in parts)
            or any(c in rel for c in '\\:*?"<>|') or any(ord(c) < 32 for c in rel)
            or not (parts[0].startswith("Deck ") or parts[0] in (CLASSEUR, reglages.DOSSIER_CARTES))):
        return None
    base = os.path.join(decks.RACINE, parts[0])
    p = os.path.normpath(os.path.join(base, *parts[1:]))
    return p if p.startswith(base + os.sep) else None


def _ecrire(p, texte):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".tmp", "wb") as f:
        f.write(texte.encode("utf-8"))
    os.replace(p + ".tmp", p)


def _est_liste(rel):
    return rel.count("/") == 1 and rel.startswith("Deck ") and rel.endswith("/" + decks.FICHIER)


def _est_journal(rel):
    return rel.startswith("Deck ") and rel.count("/") == 2 and rel.endswith(JOURNAUX)


def _fusion(dessous, dessus):
    """Deux journaux (historique, versions) : les entrées des deux, celles de « dessus » l'emportent."""
    try:
        a, b = json.loads(dessous or "{}"), json.loads(dessus or "{}")
    except ValueError:
        return dessus
    if not isinstance(a, dict) or not isinstance(b, dict):
        return dessus
    return json.dumps({**a, **b}, ensure_ascii=False, indent=1)


def _communs(distant, ici):
    """{deck: empreinte de sa liste} des decks qui ont la même liste ici et sur le compte, après un échange."""
    return {rel.split("/")[0]: s for rel, s in distant.items() if _est_liste(rel) and ici.get(rel) == s}


def _connues(deck, ici, distant):
    """Les empreintes des listes déjà gardées pour ce deck (historique, versions), ici et sur le compte."""
    res = set()
    for prefixe in (f"{deck}/{decks.HISTO}/", f"{deck}/{decks.VERSIONS}/"):
        res.update(s for rel, s in ici.items() if rel.startswith(prefixe) and rel.endswith(".txt"))
        res.update(s for rel, s in distant.items() if rel.startswith(prefixe) and rel.endswith(".txt"))
    return res


def _dans_l_historique(deck, texte, raison, suffixe, distant):
    """Garde une liste dans l'historique du deck, sous un nom libre ici et sur le compte (un fichier qui en arrive ne
    l'écrasera pas) ; renvoie son chemin dans le compte."""
    h = os.path.join(decks.RACINE, deck, decks.HISTO)
    base = datetime.now().strftime("%Y-%m-%d_%H%M%S") + suffixe
    nom, k = base + ".txt", 2
    while os.path.exists(os.path.join(h, nom)) or f"{deck}/{decks.HISTO}/{nom}" in distant:
        nom, k = f"{base}_{k}.txt", k + 1
    _ecrire(os.path.join(h, nom), texte)
    journal = os.path.join(h, "journal.json")
    try:
        with open(journal, encoding="utf-8") as f:
            j = json.load(f)
    except (OSError, ValueError):
        j = {}
    j[nom] = raison
    _ecrire(journal, json.dumps(j, ensure_ascii=False, indent=1))
    return f"{deck}/{decks.HISTO}/{nom}"


def _lire_distants(chemins):
    res = {}
    chemins = list(chemins)
    for i in range(0, len(chemins), LOT):
        res.update(_appel("POST", "/fichiers/lire", dict(chemins=chemins[i:i + LOT])).get("fichiers") or {})
    return res


def _lots(changements):
    lot, taille = [], 0
    for ch in changements:
        n = len((ch.get("contenu") or "").encode("utf-8")) + 200
        if lot and (len(lot) >= LOT or taille + n > LOT_OCTETS):
            yield lot
            lot, taille = [], 0
        lot.append(ch)
        taille += n
    if lot:
        yield lot


def _avec_suivi(f):
    with _verrou:
        suivi.update(en_cours=True)
        try:
            r = f()
            suivi["erreur"] = ""
            return r
        except NonConnecte:
            suivi["erreur"] = ""
            raise
        except Exception as ex:
            suivi["erreur"] = str(ex)
            raise
        finally:
            suivi["en_cours"] = False


# ---------------------------------------------------------------- envoyer, récupérer
def envoyer():
    """Ce PC → le compte. Renvoie {decks: [dossiers envoyés], classeur, gardes: [decks dont la liste du compte est
    passée dans l'historique], ignores: [fichiers trop gros ou pas du texte]}."""
    return _avec_suivi(_envoyer)


def _envoyer():
    for essai in range(3):
        distant = _appel("GET", "/fichiers").get("fichiers") or {}
        ici, ignores = {}, []
        for rel, p in locaux().items():
            t = _texte(p)
            if t is None:
                ignores.append(rel)
            else:
                ici[rel] = t
        empreintes = {rel: sha(t) for rel, t in ici.items()}
        # un deck des deux côtés au dernier échange, qui n'est plus ici (renommé, ou dans la corbeille) et dont la liste
        # n'a pas changé sur le compte : retiré du compte, pour ne pas l'y garder en double
        communs, ici_decks = _etat().get("communs") or {}, set(decks.dossiers())
        retires = sorted(d for d, s in communs.items() if d not in ici_decks and distant.get(f"{d}/{decks.FICHIER}") == s)
        retraits = [dict(chemin=rel, contenu=None, base=s) for rel, s in sorted(distant.items()) if rel.split("/")[0] in retires]
        # les listes du compte qu'on va remplacer, et qu'on n'a pas ici : gardées dans l'historique (ici et là-bas)
        a_garder = [rel for rel in ici if _est_liste(rel) and distant.get(rel) not in (None, empreintes[rel])
                    and distant[rel] not in _connues(rel.split("/")[0], empreintes, distant)]
        decks_gardes = {rel.split("/")[0] for rel in a_garder}
        journaux = [rel for rel in distant if _est_journal(rel)
                    and (rel.split("/")[0] in decks_gardes or (rel in ici and distant[rel] != empreintes[rel]))]
        lus = _lire_distants(a_garder + journaux)
        for rel in a_garder:
            if rel in lus:
                deck = rel.split("/")[0]
                h = _dans_l_historique(deck, lus[rel], AUTRE, "_autre-appareil", distant)
                ici[h] = lus[rel]
                ici[f"{deck}/{decks.HISTO}/journal.json"] = _texte(os.path.join(decks.RACINE, deck, decks.HISTO, "journal.json"))
        envoi = dict(ici)
        for rel in journaux:
            if rel in lus and rel in ici:
                envoi[rel] = _fusion(lus[rel], ici[rel])          # sur le compte : ses entrées et les nôtres
        changements = [dict(chemin=rel, contenu=t, base=distant.get(rel)) for rel, t in sorted(envoi.items())
                       if sha(t) != distant.get(rel)]
        conflits = {}
        for lot in _lots(changements + retraits):
            conflits.update(_appel("POST", "/fichiers/ecrire", dict(changements=lot)).get("conflits") or {})
        if conflits and essai < 2:                                # le compte a changé entre-temps : on recommence
            continue
        if conflits:
            raise Erreur("Le compte change sans arrêt (un autre appareil ?) : réessaie dans un instant.")
        apres = {**{rel: s for rel, s in distant.items() if rel.split("/")[0] not in retires},
                 **{ch["chemin"]: sha(ch["contenu"]) for ch in changements}}
        _ecrire_etat(envoi=time.time(), empreinte=empreinte(), communs=_communs(apres, {rel: sha(t) for rel, t in ici.items()}))
        touches = sorted({ch["chemin"].split("/")[0] for ch in changements})
        return dict(decks=[d for d in touches if d.startswith("Deck ")], classeur=CLASSEUR in touches,
                    gardes=sorted(decks_gardes), ignores=ignores, fichiers=len(changements), retires=retires)


def recuperer():
    """Le compte → ce PC. Renvoie {decks: [dossiers touchés], nouveaux: [decks qui n'étaient pas ici], classeur,
    gardes: [decks dont la liste de ce PC est passée dans l'historique], supprimes: [decks mis à la corbeille ici],
    reglages: les réglages des cartes ont changé}."""
    return _avec_suivi(_recuperer)


def _recuperer():
    propre = empreinte() == _etat().get("empreinte")             # rien à envoyer avant : rien après non plus
    distant = _appel("GET", "/fichiers").get("fichiers") or {}
    chemins = locaux()
    ici = {}
    for rel, p in chemins.items():
        t = _texte(p)
        if t is not None:
            ici[rel] = sha(t)
    voulus = sorted(rel for rel, s in distant.items() if s != ici.get(rel) and _chemin_sur(rel))
    lus = _lire_distants(voulus)
    avant = set(decks.dossiers())
    # les listes de ce PC qu'on va remplacer, si elles ne sont pas déjà dans un historique : gardées d'abord
    gardes = []
    for rel in voulus:
        if _est_liste(rel) and rel in ici and rel in lus:
            deck = rel.split("/")[0]
            if ici[rel] not in _connues(deck, ici, distant):
                _dans_l_historique(deck, _texte(chemins[rel]), AVANT, "_ce-pc", distant)
                gardes.append(deck)
    touches, echecs = set(), []
    for rel in voulus:
        texte = lus.get(rel)
        if texte is None:                                         # effacé du compte entre-temps
            continue
        p = _chemin_sur(rel)
        if _est_journal(rel) and os.path.exists(p):
            texte = _fusion(_texte(p), texte)                     # ici : nos entrées et celles du compte
        try:
            _ecrire(p, texte)
            touches.add(rel.split("/")[0])
            ici[rel] = sha(texte)
        except OSError:                                           # un nom que Windows refuse
            echecs.append(rel)
    # un deck des deux côtés au dernier échange, qui n'est plus sur le compte (renommé ou supprimé ailleurs) et dont la
    # liste n'a pas changé ici : dans la corbeille de ce PC, pour ne pas l'y garder en double
    supprimes = sorted(d for d, s in (_etat().get("communs") or {}).items()
                       if f"{d}/{decks.FICHIER}" not in distant and d in avant and ici.get(f"{d}/{decks.FICHIER}") == s)
    for d in supprimes:
        decks.supprimer(d)
    carte = f"{reglages.DOSSIER_CARTES}/cartes.json"
    nouveaux_reglages = carte in voulus and carte in lus and reglages.appliquer_cartes()
    _ecrire_etat(reception=time.time(), communs=_communs(distant, ici), **({"empreinte": empreinte()} if propre else {}))
    if touches and quand_recu:
        quand_recu()
    return dict(decks=sorted(d for d in touches if d.startswith("Deck ")), nouveaux=sorted(set(decks.dossiers()) - avant),
                classeur=CLASSEUR in touches, gardes=gardes, echecs=echecs, reglages=bool(nouveaux_reglages),
                supprimes=supprimes)


# ---------------------------------------------------------------- la synchronisation automatique (2.3.0)
_empreintes = {}       # chemin → (date, taille, sha) : un fichier qui n'a pas bougé n'est pas relu


def _ici():
    """{chemin dans le compte: sha} des fichiers de ce PC qui vont sur le compte (texte, 1 Mo au plus)."""
    res = {}
    for rel, chemin in locaux().items():
        try:
            s = os.stat(chemin)
        except OSError:
            continue
        cle = (s.st_mtime_ns, s.st_size)
        connu = _empreintes.get(chemin)
        if connu and connu[0] == cle:
            if connu[1]:
                res[rel] = connu[1]
            continue
        texte = _texte(chemin)
        _empreintes[chemin] = (cle, sha(texte) if texte is not None else None)
        if texte is not None:
            res[rel] = _empreintes[chemin][1]
    return res


def synchroniser():
    """Ce PC et le compte, dans les deux sens (comme l'appli : telephone.js › synchroniserCompte). Renvoie {envoyes,
    recus, decks_recus, conflits, supprimes}."""
    return _avec_suivi(_synchroniser)


def _synchroniser():
    e = _etat()
    for essai in range(3):
        ici, avant, chemins = _ici(), e.get("fichiers") or {}, locaux()
        rev = e.get("revision")
        # rien de changé ici depuis la dernière fois : le serveur dit seulement si le compte a bougé
        l = _appel("GET", "/fichiers" + (f"?revision={rev}" if rev is not None and ici == avant else ""))
        if l.get("inchange"):
            _ecrire_etat(derniere=time.time())
            return dict(envoyes=0, recus=0, decks_recus=[], conflits=[], supprimes=[])
        distant = l.get("fichiers") or {}
        envois, retraits, recus, effaces, conflits = [], [], [], [], []
        for rel in sorted(set(ici) | set(distant) | set(avant)):
            a, r, b = ici.get(rel), distant.get(rel), avant.get(rel)
            if a == r or not _chemin_sur(rel):
                continue
            if a == b:
                (effaces if r is None else recus).append(rel)           # changé dans le compte seulement
            elif r == b:
                (retraits if a is None else envois).append(rel)         # changé ici seulement
            elif a is None:
                recus.append(rel)                                        # supprimé ici, changé là-bas : il revient
            else:
                envois.append(rel)                                       # changé des deux côtés : celui d'ici gagne
                if r is not None:
                    conflits.append(rel)
        lus = _lire_distants(recus + [rel for rel in conflits if _est_liste(rel) or _est_journal(rel)])
        # 1. changé des deux côtés : la liste d'en face dans l'historique du deck ; les journaux, fusionnés
        textes = {rel: _texte(chemins[rel]) for rel in envois}
        for rel in conflits:
            if rel not in lus:
                continue
            if _est_liste(rel):
                h = _dans_l_historique(rel.split("/")[0], lus[rel], AUTRE, "_autre-appareil", distant)
                textes[h] = lus[rel]
                j = f"{rel.split('/')[0]}/{decks.HISTO}/journal.json"
                textes[j] = _texte(_chemin_sur(j))
            elif _est_journal(rel):
                textes[rel] = _fusion(lus[rel], textes[rel])
                _ecrire(_chemin_sur(rel), textes[rel])
        # 2. ce qui part
        changements = [dict(chemin=rel, contenu=tx, base=distant.get(rel)) for rel, tx in sorted(textes.items()) if tx is not None]
        changements += [dict(chemin=rel, contenu=None, base=distant.get(rel)) for rel in retraits]
        revision, conflit, lots = l.get("revision"), False, 0
        for lot in _lots(changements):
            r = _appel("POST", "/fichiers/ecrire", dict(changements=lot))
            conflit = conflit or bool(r.get("conflits"))
            revision, lots = r.get("revision"), lots + 1
        if conflit:                                                      # un autre appareil a écrit entre-temps
            e = {**e, "revision": None}
            continue
        # 3. ce qui arrive : la liste de ce PC qu'on remplace, si elle n'est gardée nulle part, d'abord dans l'historique
        touches, echecs = set(), []
        for rel in recus:
            texte = lus.get(rel)
            if texte is None:
                continue
            p = _chemin_sur(rel)
            if _est_liste(rel) and rel in ici and ici[rel] not in _connues(rel.split("/")[0], ici, distant):
                _dans_l_historique(rel.split("/")[0], _texte(p), AVANT, "_ce-pc", distant)
            if _est_journal(rel) and os.path.exists(p):
                texte = _fusion(_texte(p), texte)
            try:
                _ecrire(p, texte)
                touches.add(rel.split("/")[0])
            except OSError:                                              # un nom que Windows refuse
                echecs.append(rel)
        # 4. ce qui a disparu du compte sans avoir changé ici : retiré ici aussi ; un deck entier, dans la corbeille
        supprimes = []
        partis = set(effaces)
        for deck in sorted({rel.split("/")[0] for rel in effaces}):
            if deck.startswith("Deck ") and not any(rel.split("/")[0] == deck and rel not in partis for rel in ici):
                decks.supprimer(deck)
                supprimes.append(deck)
        for rel in effaces:
            if rel.split("/")[0] not in supprimes:
                try:
                    os.remove(_chemin_sur(rel))
                except OSError:
                    pass
        # l'état commun : celui du compte, avec ce qu'on vient d'y écrire ; la révision n'est sûre que si personne
        # d'autre n'a écrit pendant l'envoi
        commun = dict(distant)
        for ch in changements:
            if ch["contenu"] is None:
                commun.pop(ch["chemin"], None)
            else:
                commun[ch["chemin"]] = sha(ch["contenu"])
        for rel in recus:
            if rel in lus and rel not in echecs:
                commun[rel] = distant[rel]
        for rel in effaces:
            commun.pop(rel, None)
        sure = revision is not None and l.get("revision") is not None and revision == l["revision"] + lots
        _ecrire_etat(fichiers=commun, revision=revision if sure else None, derniere=time.time())
        carte = f"{reglages.DOSSIER_CARTES}/cartes.json"
        if carte in recus and carte in lus:
            reglages.appliquer_cartes()
        if (touches or supprimes) and quand_recu:
            quand_recu()
        return dict(envoyes=len(changements), recus=len(touches), conflits=sorted({rel.split("/")[0] for rel in conflits if _est_liste(rel)}),
                    decks_recus=sorted(d for d in touches if d.startswith("Deck ")), supprimes=supprimes, echecs=echecs)
    raise Erreur("Le compte change sans arrêt (un autre appareil ?) : réessaie dans un instant.")


# ---------------------------------------------------------------- les pages toutes prêtes (serveur › pages)
# Comme l'appli (telephone.js › envoyerPages) : ce PC dépose dans le compte les pages de ses decks, faites par son
# Atelier, pour qu'un téléphone ou un navigateur qui a les mêmes fichiers les reprenne telles quelles au lieu de les
# refaire (sans base de cartes, il lui faudrait tout demander à Scryfall). L'empreinte : les fichiers du deck, le
# classeur et les réglages des cartes, le même calcul que l'appli ; le niveau : 2 (la base de cartes du PC), +1 avec
# l'analyse de Commander Spellbook de la liste actuelle. Une page n'est déposée qu'une fois les fichiers du deck dans le
# compte tels qu'ici, au calme, et de nouveau chaque semaine (les prix).
FORMAT_PAGES = "1"
INDEX_PAGES = "@index"                                  # l'accueil : la liste des decks, le classeur, où sont mes cartes
PAGES = os.path.join(ICI, "pages_compte.json")          # {email, pages: {deck: [empreinte, niveau, date]}}
CALME_PAGES = 60                                        # secondes sans modification d'un deck avant de déposer sa page
REESSAI_PAGES = 900                                     # une page qui n'a pas pu se faire : nouvel essai un quart d'heure après
SEMAINE = 7 * 86400
capteur = None         # app.py : le client de test de Flask (get), qui fait les pages comme l'Atelier les montre
_echecs_pages = {}     # deck : heure du dernier échec


def _sha1(texte):
    return hashlib.sha1(texte.encode("utf-8")).hexdigest()


def empreintes(shas):
    """{deck: empreinte, "@index": empreinte} tirées de {chemin: sha} : le même calcul que l'appli (telephone.js ›
    empreintes), pour que deux appareils qui ont les mêmes fichiers trouvent la même."""
    def ligne(rel):
        return f"{_sha1(rel)} {shas.get(rel) or '-'}"
    reg, cl = ligne(f"{reglages.DOSSIER_CARTES}/cartes.json"), ligne(f"{CLASSEUR}/classeur.txt")   # classeur : suggestions
    par_deck, res = {}, {}
    for rel in shas:
        par_deck.setdefault(rel.split("/")[0], []).append(rel)
    for d, rels in par_deck.items():
        if d.startswith("Deck ") and f"{d}/{decks.FICHIER}" in shas:
            res[d] = _sha1("\n".join(["pages " + FORMAT_PAGES, reg, cl, *sorted(ligne(r) for r in rels)]))
    res[INDEX_PAGES] = _sha1("\n".join(["index " + FORMAT_PAGES, reg, cl, *sorted(f"{_sha1(d)} {e}" for d, e in res.items())]))
    return res


def _pages_deposees():
    try:
        with open(PAGES, encoding="utf-8") as f:
            e = json.load(f)
        return (e.get("pages") or {}) if e.get("email") == _connexion().get("email") else {}
    except (OSError, ValueError):
        return {}


def _garder_pages(p):
    with open(PAGES + ".tmp", "w", encoding="utf-8") as f:
        json.dump(dict(email=_connexion().get("email"), pages=p), f, ensure_ascii=False)
    os.replace(PAGES + ".tmp", PAGES)


def capturer_page(deck, get):
    """La page du deck comme l'appli la fait (pages.js › deck) : celle de la page partagée (partage.capturer), avec ce
    qui reste privé, les suggestions entières (classeur compris, cartes écartées) et les achats."""
    import urllib.parse
    import partage
    d = partage.capturer(deck, get)
    racine = f"/api/decks/{deck}"
    for chemin in (racine + "/suggestions", racine + "/achats"):
        r = get(urllib.parse.quote(chemin))
        if r.status_code == 200:
            d["api"][partage._cle(chemin)] = r.get_json()
    return d


def capturer_index(get):
    """L'accueil comme l'appli le fait (pages.js › index) : la liste des decks, le classeur, où sont mes cartes."""
    api = {}
    for chemin in ("/api/decks", "/api/classeur", "/api/ou-sont"):
        r = get(chemin)
        if r.status_code != 200:
            raise Erreur(f"{chemin} : {r.status_code}")
        api[chemin] = r.get_json()
    t = time.time()
    return dict(date=t, date_fiches=t, api=api)


def deposer_pages(get):
    """Les pages de ce PC, déposées dans le compte : celles des decks dont les fichiers y sont tels qu'ici, au calme
    depuis CALME_PAGES secondes, que ce PC n'a pas encore déposées (ou il y a plus d'une semaine), si le compte n'a pas
    déjà la même. L'accueil en dernier. Renvoie le nombre de pages déposées."""
    import gzip
    import urllib.parse
    import partage
    if not _connexion().get("jeton"):
        return 0
    ici, commun, t = _ici(), _etat().get("fichiers") or {}, time.time()
    emp, dans_le_compte, faites = empreintes(ici), empreintes(commun), _pages_deposees()
    chemins = locaux()

    def calme(d):
        dates = [os.path.getmtime(p) for rel, p in chemins.items() if (d == INDEX_PAGES or rel.split("/")[0] == d)
                 and os.path.exists(p)]
        return t - max(dates, default=0) >= CALME_PAGES

    a_faire = [d for d in emp if emp[d] == dans_le_compte.get(d) and ((faites.get(d) or [None])[0] != emp[d]
                                                                       or t - faites[d][2] > SEMAINE)
               and t - _echecs_pages.get(d, 0) > REESSAI_PAGES and calme(d)]
    if not a_faire:
        return 0
    l = _appel("GET", "/pages").get("pages") or {}
    n = 0
    for d in sorted(a_faire, key=lambda x: (x == INDEX_PAGES, x)):
        x = l.get(d) or {}
        if x.get("empreinte") == emp[d] and x.get("niveau", 0) >= 2 and t - x.get("maj", 0) < SEMAINE:
            faites[d] = [emp[d], x["niveau"], x["maj"]]           # déjà là, faite par un autre appareil
            continue
        try:
            donnees = capturer_index(get) if d == INDEX_PAGES else capturer_page(d, get)
            texte = json.dumps(donnees, ensure_ascii=False, separators=(",", ":"))
            partage._verifier(texte)                               # aucun chemin de ce PC ne part
        except Exception as e:                                     # noqa: BLE001 - la page attendra
            print(f"Compte : page de {d} : {e}", file=sys.stderr, flush=True)
            _echecs_pages[d] = t
            continue
        b = donnees["api"].get(f"/api/decks/{d}/bracket") or {}
        niveau = 2 + (1 if b.get("spellbook_a_jour") else 0)
        _appel("PUT", "/pages?" + urllib.parse.urlencode(dict(deck=d, empreinte=emp[d], niveau=niveau)),
               brut=gzip.compress(texte.encode("utf-8"), compresslevel=6), type_brut="application/gzip")
        faites[d] = [emp[d], niveau, t]
        n += 1
    _garder_pages({d: v for d, v in faites.items() if d in emp})
    return n


# ---------------------------------------------------------------- le pont avec l'appli en ligne (2.3.0)
PONT = os.path.join(ICI, "pont.dat")


def secret_pont():
    """Le secret du pont (app.py › pont_avant) : créé une fois, gardé sur ce PC (pont.dat, jamais dans le dépôt)."""
    try:
        with open(PONT, encoding="utf-8") as f:
            s = f.read().strip()
        if len(s) >= 32:
            return s
    except OSError:
        pass
    import secrets
    s = secrets.token_urlsafe(32)
    with open(PONT, "w", encoding="utf-8") as f:
        f.write(s)
    return s


def publier_pont(port):
    """L'adresse de cet Atelier et le secret du pont, dans « Réglages Atelier/pont.json » (synchronisé) : l'appli en
    ligne sait ainsi le joindre (Claude, synergies, MTGPics), par le relais (relais_pont.py) depuis 2.5.0. Une entrée
    par PC."""
    p = os.path.join(decks.RACINE, reglages.DOSSIER_CARTES, "pont.json")
    try:
        with open(p, encoding="utf-8") as f:
            l = json.load(f)
    except (OSError, ValueError):
        l = {}
    l = l if isinstance(l, dict) else {}
    entree = dict(port=int(port), secret=secret_pont(), relais=True)     # relais : le site le joint par le relais (2.5.0)
    if l.get(nom_appareil()) != entree:
        l[nom_appareil()] = entree
        _ecrire(p, json.dumps(l, ensure_ascii=False, indent=1) + "\n")
        reveil.set()


PAUSE = 20             # secondes entre deux synchronisations, tant que l'Atelier tourne et qu'on est connecté
reveil = threading.Event()


def boucle():
    """En fond (app.py) : synchronise toutes les PAUSE secondes, ou tout de suite si on la réveille (reveil.set() :
    après une modification, ou quand l'appli en ligne le demande) ; puis dépose les pages des decks qui ont changé."""
    while True:
        if _connexion().get("jeton"):
            try:
                synchroniser()
            except Exception:                                            # noqa: BLE001 - suivi["erreur"] le dit
                pass
            if capteur:
                try:
                    deposer_pages(capteur)
                except Exception as e:                                   # noqa: BLE001 - au tour suivant
                    print(f"Compte : pages : {e}", file=sys.stderr, flush=True)
        reveil.wait(PAUSE)
        reveil.clear()


# ---------------------------------------------------------------- pour la page
def etat():
    """{connecte, email, pseudo, synchro: "auto", en_cours, erreur, derniere, decks}."""
    c = _connexion()
    if not c.get("jeton"):
        return dict(connecte=False, synchro="auto", decks=len(decks.dossiers()))
    e = _etat()
    return dict(connecte=True, email=c.get("email"), pseudo=c.get("pseudo"), synchro="auto", en_cours=suivi["en_cours"],
                erreur=suivi["erreur"], derniere=e.get("derniere"), decks=len(decks.dossiers()))
