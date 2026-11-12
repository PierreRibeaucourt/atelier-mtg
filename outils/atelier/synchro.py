"""Sauvegarde en ligne : une copie privée des decks et du classeur dans un dépôt GitHub du compte connecté.

L'Atelier tourne sur un seul PC. S'il tombe en panne, ou pour retrouver ses decks sur un autre PC, il range une copie
de chaque deck (liste, historique, versions, simulations, discussion avec Claude, achats…) et du classeur dans un dépôt
privé, « atelier-mtg-sauvegarde », que seul le compte voit. Les photos n'y vont pas : trop lourdes, elles restent ici.

Synchroniser, c'est comparer trois états : les fichiers de ce PC, ceux du dépôt, et ceux de la dernière
synchronisation (sauvegarde_github.json). Ce qui a changé d'un seul côté passe de l'autre. Un fichier changé des deux
côtés (deux PC modifiés sans réseau) garde la version de ce PC ; la liste d'un deck venue de l'autre PC entre alors dans
son historique, rien ne se perd. Un deck supprimé sur un PC va dans la corbeille de l'autre.

surveiller() tourne en fond : une synchronisation au lancement, une après chaque série de modifications, et un coup
d'œil au dépôt toutes les cinq minutes (un autre PC a pu changer un deck).
"""
import hashlib
import io
import json
import os
import threading
import time
import zipfile
from datetime import datetime

import decks
import github
import reglages

ICI = os.path.dirname(os.path.abspath(__file__))
NOM_DEPOT = "atelier-mtg-sauvegarde"
DESCRIPTION = "Sauvegarde privée de l'Atelier MTG : decks et classeur (ne pas modifier à la main)"
ETAT = os.path.join(ICI, "sauvegarde_github.json")     # dépôt, dernier commit et fichiers de la dernière synchronisation
CLASSEUR = "Classeur"
LISEZMOI = "README.md"                                  # la page du dépôt sur GitHub : ce qu'il contient
SANS = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif", ".bmp", ".tif", ".tiff", ".mp4", ".mov", ".tmp")
CALME = 20             # secondes sans modification avant d'envoyer : une série d'ajouts ne part qu'une fois
DISTANT = 300          # secondes entre deux coups d'œil au dépôt
REESSAI = 300          # après un échec (pas de réseau…), nouvel essai cinq minutes plus tard
ARCHIVE = 15           # au-delà de ce nombre de fichiers à recevoir, un seul téléchargement (zip) du dépôt
TEXTE_LISEZMOI = """# Sauvegarde de l'Atelier MTG

Ce dépôt est **privé** : toi seul le vois. L'Atelier MTG y range une copie de tes decks (listes, versions,
simulations, discussions, achats) et de ton classeur, pour les retrouver si ton PC tombe en panne, ou sur un autre PC.

- L'Atelier le tient à jour tout seul : ne modifie pas ces fichiers à la main.
- Sur un autre PC : installe l'Atelier MTG, puis « Récupérer mes decks » sur sa page d'accueil.
- Les photos rangées dans les dossiers des decks ne sont pas sauvegardées.
"""

_verrou = threading.Lock()
suivi = dict(en_cours=False, erreur="", echec=0, empreinte=None, coup_d_oeil=0)
quand_recu = None      # appelé quand des fichiers arrivent d'un autre PC (app.py : fiches et prix des nouvelles cartes)


class AAutoriser(github.Erreur):
    """Connecté avant la sauvegarde : GitHub n'a ouvert que les dépôts publics. Il faut se reconnecter une fois."""
    code = 409


# ---------------------------------------------------------------- état
def _lire_etat():
    try:
        with open(ETAT, encoding="utf-8") as f:
            e = json.load(f)
        return e if e.get("compte") == github.compte() else {}
    except (OSError, ValueError):
        return {}


def _ecrire_etat(e):
    with open(ETAT + ".tmp", "w", encoding="utf-8") as f:
        json.dump(e, f, ensure_ascii=False)
    os.replace(ETAT + ".tmp", ETAT)


def voulue():
    """La sauvegarde est en marche dès qu'on est connecté à GitHub, sauf si on l'a coupée (Options)."""
    return reglages.lire().get("sauvegarde") is not False


def active():
    return bool(github.compte()) and voulue() and github.prive()


def etat():
    """Pour la page : {connecte, compte, prive, voulue, active, en_cours, derniere, erreur, url, decks}."""
    compte = github.compte()
    prive = bool(compte) and github.prive()
    e = _lire_etat()
    return dict(connecte=bool(compte), compte=compte, prive=prive, voulue=voulue(), active=prive and voulue(),
                en_cours=suivi["en_cours"], derniere=e.get("derniere"), erreur=suivi["erreur"] if prive else "",
                url=f"https://github.com/{e['depot']}" if e.get("depot") else None, decks=e.get("decks"))


# ---------------------------------------------------------------- fichiers de ce PC
def _locaux():
    """{chemin dans le dépôt: chemin sur ce PC} : les dossiers des decks et le classeur, sans les photos."""
    res = {}
    dossiers = decks.dossiers() + ([CLASSEUR] if os.path.isdir(os.path.join(decks.RACINE, CLASSEUR)) else [])
    for d in dossiers:
        for rel, chemin in github.fichiers_locaux(os.path.join(decks.RACINE, d)).items():
            if not rel.lower().endswith(SANS) and not any(p.startswith(".") for p in rel.split("/")):
                res[f"{d}/{rel}"] = chemin
    return res


def empreinte_locale():
    """Change dès qu'un fichier sauvegardé change, sans le lire (date et taille)."""
    h = hashlib.sha1()
    for rel, chemin in sorted(_locaux().items()):
        try:
            s = os.stat(chemin)
        except OSError:
            continue
        h.update(f"{rel}\0{s.st_mtime_ns}\0{s.st_size}\n".encode())
    return h.hexdigest()


def _chemin(rel):
    return os.path.join(decks.RACINE, *rel.split("/"))


# ---------------------------------------------------------------- le dépôt
def _depot(creer):
    """{depot, branche, id} du dépôt de sauvegarde du compte ; créé (privé) s'il n'existe pas et creer. None sinon."""
    login = github.compte()
    try:
        r = github.appel("GET", f"/repos/{login}/{NOM_DEPOT}")
    except github.Erreur as e:
        if e.statut != 404:
            raise
        if not creer:
            return None
        r = github.appel("POST", "/user/repos", dict(name=NOM_DEPOT, private=True, description=DESCRIPTION, auto_init=True,
                                                     has_issues=False, has_projects=False, has_wiki=False))
    if not r.get("private"):
        raise github.Erreur(f"Ton dépôt GitHub « {NOM_DEPOT} » est public : l'Atelier n'y range pas ta sauvegarde. "
                            "Rends-le privé sur GitHub (Settings › Danger Zone), ou supprime-le.")
    return dict(depot=r["full_name"], branche=r["default_branch"], id=r["id"])


def _tete(d):
    """(commit de tête, arbre, {chemin: empreinte}, date du commit) ; attend un dépôt tout juste créé."""
    for essai in range(8):
        try:
            tete = github.appel("GET", f"/repos/{d['depot']}/git/ref/heads/{d['branche']}")["object"]["sha"]
            c = github.appel("GET", f"/repos/{d['depot']}/git/commits/{tete}")
            t = github.appel("GET", f"/repos/{d['depot']}/git/trees/{c['tree']['sha']}?recursive=1")
            return tete, c["tree"]["sha"], {x["path"]: x["sha"] for x in t["tree"] if x["type"] == "blob"}, c["committer"]["date"]
        except github.Erreur as e:
            if e.statut not in (404, 409) or essai == 7:
                raise
            time.sleep(2)


def _connu(d, sha):
    """Le dernier commit synchronisé est-il encore dans le dépôt ? Sinon (dépôt refait à la main), on repart de zéro
    plutôt que de prendre pour des suppressions tout ce qui manque."""
    try:
        github.appel("GET", f"/repos/{d['depot']}/git/commits/{sha}")
        return True
    except github.Erreur as e:
        if e.statut in (404, 422):
            return False
        raise


def distante():
    """La sauvegarde du compte connecté, sans rien télécharger (« Récupérer mes decks ») : {existe, decks, date}."""
    if not github.prive():
        raise AAutoriser("GitHub doit autoriser l'Atelier une fois de plus.")
    d = _depot(creer=False)
    if not d:
        return dict(existe=False, decks=[])
    _, _, fichiers, date = _tete(d)
    noms = sorted({p.split("/")[0] for p in fichiers if p.count("/") == 1 and p.startswith("Deck ") and p.endswith("/" + decks.FICHIER)})
    return dict(existe=bool(noms), decks=[n.removeprefix("Deck ") for n in noms], date=date)


def _nouvel_arbre(d, base, entrees):
    """L'arbre du commit : les fichiers texte partent dans la même requête (pas un envoi par fichier), par lots."""
    lots, lot, taille = [], [], 0
    for x in entrees:
        n = len(x.get("content") or "") + 200
        if lot and (taille + n > 2_000_000 or len(lot) >= 400):
            lots.append(lot)
            lot, taille = [], 0
        lot.append(x)
        taille += n
    if lot:
        lots.append(lot)
    for lot in lots:
        base = github.appel("POST", f"/repos/{d['depot']}/git/trees", dict(base_tree=base, tree=lot))["sha"]
    return base


def _entree(d, rel, donnees):
    try:
        return dict(path=rel, mode="100644", type="blob", content=donnees.decode("utf-8"))
    except UnicodeDecodeError:
        import base64
        b = github.appel("POST", f"/repos/{d['depot']}/git/blobs", dict(content=base64.b64encode(donnees).decode(), encoding="base64"))
        return dict(path=rel, mode="100644", type="blob", sha=b["sha"])


# ---------------------------------------------------------------- synchroniser
def synchroniser(creer=True):
    """Met ce PC et la sauvegarde d'accord. creer=False (« Récupérer mes decks ») : sans dépôt, ne crée rien.
    Renvoie {envoyes, recus, decks_recus, conflits, decks} ; {vide: True} s'il n'y a pas de sauvegarde."""
    if not github.compte():
        raise github.NonConnecte("Connecte l'Atelier à GitHub (compte gratuit).")
    if not github.prive():
        raise AAutoriser("GitHub doit autoriser l'Atelier une fois de plus : la sauvegarde va dans un dépôt privé.")
    with _verrou:
        suivi["en_cours"] = True
        try:
            r = _synchroniser(creer)
            suivi.update(erreur="", echec=0, empreinte=empreinte_locale(), coup_d_oeil=time.time())
            if r.get("recus") and quand_recu:
                quand_recu()
            return r
        except Exception as ex:
            suivi.update(erreur=str(ex), echec=time.time())
            raise
        finally:
            suivi["en_cours"] = False


def _synchroniser(creer):
    e = _lire_etat()
    d = _depot(creer)
    if not d:
        return dict(vide=True)
    if e.get("id") != d["id"]:                          # autre dépôt (premier passage, ou refait) : rien de connu
        e = dict(compte=github.compte(), fichiers={})
    e.update(d)
    for essai in range(3):
        tete, arbre, distant, _ = _tete(d)
        lisezmoi = distant.pop(LISEZMOI, None)
        if e.get("commit") and tete != e["commit"] and not _connu(d, e["commit"]):
            e.update(commit=None, fichiers={})
        avant = e["fichiers"] if e.get("commit") else {}
        locaux = _locaux()
        contenus = {}
        for rel, chemin in locaux.items():
            with open(chemin, "rb") as f:
                contenus[rel] = f.read()
        ici = {rel: github.sha_blob(x) for rel, x in contenus.items()}
        # un dossier de deck (ou le classeur) disparu sans passer par l'Atelier (désinstallation, Explorateur) n'est pas
        # effacé de la sauvegarde : il revient. Seuls la corbeille de l'Atelier et un renommage valent suppression.
        presents = set(decks.dossiers()) | ({CLASSEUR} if os.path.isdir(os.path.join(decks.RACINE, CLASSEUR)) else set())
        jetes = {x["nom"] for x in decks.corbeille()} | set(e.get("renommes") or {})

        envois, retraits, recus, effaces, conflits = [], [], [], [], []
        for rel in sorted(set(ici) | set(distant) | set(avant)):
            l, r, b = ici.get(rel), distant.get(rel), avant.get(rel)
            if l == r:
                continue
            dossier = rel.split("/")[0]
            if l is None and dossier not in presents and dossier not in jetes:
                if r is not None:
                    recus.append(rel)
                continue
            if l == b:                                  # changé sur GitHub seulement (un autre PC)
                (effaces if r is None else recus).append(rel)
            elif r == b:                                # changé ici seulement
                (retraits if l is None else envois).append(rel)
            elif l is None:                             # supprimé ici, changé là-bas : la version de là-bas revient
                recus.append(rel)
            else:                                       # changé des deux côtés, ou supprimé là-bas : celle d'ici gagne
                envois.append(rel)
                if r is not None:
                    conflits.append(rel)

        # 1. ce qui part : un seul commit
        nouveau = tete
        entrees = [_entree(d, rel, contenus[rel]) for rel in envois]
        entrees += [dict(path=rel, mode="100644", type="blob", sha=None) for rel in retraits]
        if lisezmoi != github.sha_blob(TEXTE_LISEZMOI.encode()):
            entrees.append(dict(path=LISEZMOI, mode="100644", type="blob", content=TEXTE_LISEZMOI))
        if entrees:
            a = _nouvel_arbre(d, arbre, entrees)
            qui = github.auteur()
            quand = datetime.now().strftime("%d/%m/%Y %H:%M")
            nouveau = github.appel("POST", f"/repos/{d['depot']}/git/commits", dict(
                message=f"Sauvegarde du {quand}", tree=a, parents=[tete], author=qui, committer=qui))["sha"]
            try:
                github.appel("PATCH", f"/repos/{d['depot']}/git/refs/heads/{d['branche']}", dict(sha=nouveau))
            except github.Erreur as ex:
                if ex.statut == 422 and essai < 2:       # un autre PC a envoyé entre-temps : on recommence
                    continue
                raise

        # 2. ce qui arrive : les fichiers, puis les listes de l'autre PC en conflit dans l'historique
        a_lire = recus + [rel for rel in conflits if rel.endswith("/" + decks.FICHIER)]
        lire = _lecteur(d, tete, {rel: distant[rel] for rel in a_lire})
        decks_avant = set(decks.dossiers())
        for rel in recus:
            p = _chemin(rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p + ".tmp", "wb") as f:
                f.write(lire(rel))
            os.replace(p + ".tmp", p)
        conflits_decks = []
        for rel in conflits:
            if rel.endswith("/" + decks.FICHIER):
                deck = rel.split("/")[0]
                _dans_l_historique(deck, lire(rel))
                conflits_decks.append(deck)

        # 3. ce qui a disparu là-bas : un deck entier part dans la corbeille (sauf s'il a changé ici entre-temps : il
        #    vient de repartir), un fichier seul est retiré
        restant = {rel.split("/")[0] for rel in list(distant) + envois}
        for deck in sorted({rel.split("/")[0] for rel in effaces}):
            if deck.startswith("Deck ") and deck not in restant and deck in decks.dossiers():
                decks.supprimer(deck)
        for rel in effaces:
            if os.path.exists(_chemin(rel)):
                os.remove(_chemin(rel))

        fichiers = dict(distant)
        fichiers.update({rel: ici[rel] for rel in envois})
        for rel in retraits:
            fichiers.pop(rel, None)
        nb = len({rel.split("/")[0] for rel in fichiers if rel.startswith("Deck ")})
        e.update(commit=nouveau, fichiers=fichiers, derniere=time.time(), decks=nb)
        e.pop("renommes", None)
        _ecrire_etat(e)
        return dict(envoyes=len(envois) + len(retraits), recus=len(recus), conflits=sorted(set(conflits_decks)), decks=nb,
                    decks_recus=sorted(set(decks.dossiers()) - decks_avant))
    raise github.Erreur("La sauvegarde n'a pas pu s'enregistrer : réessaie.")


def _lecteur(d, tete, voulus):
    """Une fonction qui rend le contenu d'un fichier du dépôt : un téléchargement par fichier, ou le dépôt entier
    d'un coup s'il y en a beaucoup (premier passage sur un nouveau PC)."""
    if len(voulus) <= ARCHIVE:
        return lambda rel: github.telecharger(d["depot"], voulus[rel])
    z = zipfile.ZipFile(io.BytesIO(github.archive(d["depot"], tete)))
    racine = z.namelist()[0].split("/")[0]
    return lambda rel: z.read(f"{racine}/{rel}")


def _dans_l_historique(deck, donnees):
    """La liste du deck venue de l'autre PC, gardée dans l'historique (Versions) quand celle de ce PC l'emporte."""
    h = os.path.join(decks.RACINE, deck, decks.HISTO)
    os.makedirs(h, exist_ok=True)
    nom = datetime.now().strftime("%Y-%m-%d_%H%M%S") + "_autre-PC.txt"
    with open(os.path.join(h, nom), "wb") as f:
        f.write(donnees)
    journal = os.path.join(h, "journal.json")
    try:
        with open(journal, encoding="utf-8") as f:
            j = json.load(f)
    except (OSError, ValueError):
        j = {}
    j[nom] = "Liste d'un autre PC (sauvegarde en ligne)"
    with open(journal, "w", encoding="utf-8") as f:
        json.dump(j, f, ensure_ascii=False, indent=1)


def renomme(ancien, nouveau):
    """Un deck renommé dans l'Atelier : son ancien dossier peut disparaître de la sauvegarde (voir _synchroniser)."""
    with _verrou:
        e = _lire_etat()
        if e.get("depot"):
            e.setdefault("renommes", {})[ancien] = nouveau
            _ecrire_etat(e)


# ---------------------------------------------------------------- en fond
def _distant_a_bouge():
    suivi["coup_d_oeil"] = time.time()
    e = _lire_etat()
    if not e.get("depot"):
        return True
    try:
        tete = github.appel("GET", f"/repos/{e['depot']}/git/ref/heads/{e['branche']}")["object"]["sha"]
    except github.Erreur:
        return True
    return tete != e.get("commit")


def surveiller(pause=10):
    """En fond tant que l'Atelier est ouvert (voir en tête du fichier)."""
    time.sleep(10)
    premiere, vue, depuis = True, None, 0
    while True:
        try:
            if active() and time.time() - suivi["echec"] >= REESSAI:
                h, maintenant = empreinte_locale(), time.time()
                if h != vue:
                    vue, depuis = h, maintenant
                ici = h != suivi["empreinte"] and maintenant - depuis >= CALME
                if premiere or ici or (maintenant - suivi["coup_d_oeil"] >= DISTANT and _distant_a_bouge()):
                    premiere = False
                    synchroniser()
        except Exception:
            pass
        time.sleep(pause)
