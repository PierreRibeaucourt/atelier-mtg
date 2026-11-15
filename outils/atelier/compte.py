"""Le compte Atelier MTG sur ce PC : on s'y connecte par un code reçu par e-mail (api.atelier-mtg.com, outils/serveur/).

L'appli du navigateur et du téléphone se synchronise toute seule avec le compte ; le PC, lui, quand on le demande
(Options › Compte) :
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


def _appel(methode, chemin, corps=None, avec_jeton=True, autre_jeton=None):
    entetes = {"Accept": "application/json", "User-Agent": "atelier-mtg"}
    if avec_jeton:
        jeton = autre_jeton or _connexion().get("jeton")
        if not jeton:
            raise NonConnecte("Connecte-toi à ton compte.")
        entetes["Authorization"] = f"Bearer {jeton}"
    donnees = None if corps is None else json.dumps(corps).encode()
    if donnees is not None:
        entetes["Content-Type"] = "application/json"
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
    garder_chiffre(FICHIER, dict(email=r["email"], jeton=r["jeton"]))
    suivi["erreur"] = ""
    if ancien and ancien != r["jeton"]:
        try:
            _appel("POST", "/deconnexion", {}, autre_jeton=ancien)
        except Erreur:
            pass
    return etat()


def deconnecter():
    """Se déconnecter : le jeton est retiré du compte, puis oublié ici. Les decks de ce PC restent."""
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


# ---------------------------------------------------------------- pour la page
def etat():
    """{connecte, email, synchro: "manuelle", en_cours, erreur, envoi, reception, derniere, a_envoyer, github}."""
    c = _connexion()
    github = bool(reglages.lire().get("github_migre"))
    if not c.get("jeton"):
        return dict(connecte=False, synchro="manuelle", github=github, decks=len(decks.dossiers()))
    e = _etat()
    return dict(connecte=True, email=c.get("email"), synchro="manuelle", en_cours=suivi["en_cours"], erreur=suivi["erreur"],
                envoi=e.get("envoi"), reception=e.get("reception"),
                derniere=max(e.get("envoi") or 0, e.get("reception") or 0) or None,
                a_envoyer=bool(decks.dossiers()) and empreinte() != e.get("empreinte"), github=github,
                decks=len(decks.dossiers()))


# ---------------------------------------------------------------- la fin de la sauvegarde GitHub (2.2.0)
def finir_github(pause=300):
    """Jusqu'à la 2.1.0, la sauvegarde en ligne allait sur GitHub (synchro.py). Une dernière synchronisation ramène
    ici ce que les autres appareils y avaient mis ; puis elle s'arrête, et l'accueil propose d'envoyer les decks sur
    le compte. En fond, au lancement ; sans réseau, nouvel essai cinq minutes plus tard."""
    import synchro
    time.sleep(5)
    while synchro.active() and not reglages.lire().get("github_migre"):
        try:
            synchro.synchroniser(creer=False)
            reglages.ecrire(github_migre=True, sauvegarde=False)
            return
        except Exception as e:
            print(f"Dernière sauvegarde GitHub : {e}", file=sys.stderr, flush=True)
            if isinstance(e, synchro.github.NonConnecte):
                return
        time.sleep(pause)
