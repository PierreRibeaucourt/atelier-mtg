"""Nouvelle version de l'Atelier : repérée une fois par jour, installée en un clic.

Une version publiée, c'est une étiquette git « vX.Y.Z » sur le dépôt de l'Atelier (remote origin), annotée avec ses
nouveautés, et le même numéro dans version.py (outils/publier_version.py fait les deux). L'Atelier lit les étiquettes
du dépôt (git fetch) au lancement puis toutes les 20 heures ; si l'une est plus récente que la sienne, un bandeau
propose « Mettre à jour » :
1. git merge --ff-only vers l'étiquette : rien n'est écrasé, et les decks, ignorés par git, ne bougent pas ;
2. les dépendances sont réinstallées si requirements.txt a changé ;
3. l'Atelier redémarre, et la page se recharge sur la nouvelle version.
Sans git, sans dépôt ou hors ligne, rien ne s'affiche et rien ne casse."""
import json
import os
import re
import subprocess
import sys
import threading
import time

import decks
from version import __version__

ICI = os.path.dirname(os.path.abspath(__file__))
ETAT = os.path.join(ICI, "cache_version.json")
FORMAT = re.compile(r"^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$")
INTERVALLE = 20 * 3600                 # secondes entre deux lectures des étiquettes du dépôt
_verrou = threading.Lock()


def numero(version):
    m = FORMAT.match(version or "")
    return tuple(int(x) for x in m.groups()) if m else None


def _git(*args, timeout=60):
    return subprocess.run(["git", "-C", decks.RACINE, *args], capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=timeout, stdin=subprocess.DEVNULL,
                          env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def depot_git():
    try:
        return _git("rev-parse", "--is-inside-work-tree", timeout=10).stdout.strip() == "true"
    except (OSError, subprocess.SubprocessError):
        return False


def lire():
    """Dernière lecture : {"verifie": horodatage, "version", "nouveautes"}."""
    try:
        with open(ETAT, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _ecrire(etat):
    with open(ETAT, "w", encoding="utf-8") as f:
        json.dump(etat, f, ensure_ascii=False)


def derniere_etiquette():
    """(version, nouveautés) de l'étiquette « v… » la plus récente connue du dépôt local, ou (None, "")."""
    tags = [t for t in _git("tag", "-l", "v*", timeout=15).stdout.split() if numero(t)]
    if not tags:
        return None, ""
    t = max(tags, key=numero)
    texte = _git("tag", "-l", "--format=%(contents)", t, timeout=15).stdout
    texte = texte.split("-----BEGIN")[0].strip()          # sans la signature, si l'étiquette est signée
    return t.lstrip("v"), texte[:400]


def verifier(force=False, maintenant=None):
    """Lit les étiquettes du dépôt au plus une fois toutes les INTERVALLE secondes. Une erreur (hors ligne, pas de git)
    ne gêne rien : nouvel essai à l'intervalle suivant."""
    maintenant = time.time() if maintenant is None else maintenant
    etat = lire()
    if not force and maintenant - etat.get("verifie", 0) < INTERVALLE:
        return etat
    try:
        if depot_git():
            _git("fetch", "--quiet", "--tags", "origin")
            v, nouveautes = derniere_etiquette()
            etat = {"verifie": maintenant, "version": v, "nouveautes": nouveautes}
        else:
            etat = {"verifie": maintenant}
    except (OSError, subprocess.SubprocessError):
        etat = dict(etat, verifie=maintenant)
    _ecrire(etat)
    return etat


def disponible():
    """{"version", "nouveautes"} d'une version plus récente que celle-ci, ou None."""
    etat = lire()
    v = etat.get("version")
    if numero(v) and numero(v) > numero(__version__):
        return {"version": v, "nouveautes": etat.get("nouveautes", "")}
    return None


def surveiller():
    """En fond tant que l'Atelier est ouvert : une lecture peu après chaque lancement, puis toutes les INTERVALLE secondes."""
    time.sleep(5)
    force = True
    while True:
        try:
            verifier(force=force)
        except Exception:
            pass
        force = False
        time.sleep(3600)


class Echec(Exception):
    pass


def installer(version):
    """Passe le code à l'étiquette v<version> (avance rapide seulement) et réinstalle les dépendances si besoin."""
    if not numero(version) or not depot_git():
        raise Echec("Mise à jour impossible : l'Atelier n'a pas été installé avec git.")
    with _verrou:
        modifies = [l[3:] for l in _git("status", "--porcelain", "--untracked-files=no", timeout=30).stdout.splitlines()]
        if modifies:
            raise Echec("Des fichiers de l'Atelier ont été modifiés sur ce PC (" + ", ".join(modifies[:3])
                        + ("…" if len(modifies) > 3 else "") + ") : la mise à jour ne les écrase pas. "
                        "Demande à ton assistant IA de mettre l'Atelier à jour.")
        avant = _git("rev-parse", "HEAD", timeout=15).stdout.strip()
        r = _git("merge", "--ff-only", "--quiet", "v" + version, timeout=120)
        if r.returncode:
            msg = (r.stderr or r.stdout).strip().splitlines()
            raise Echec("Mise à jour impossible (" + (msg[-1] if msg else "git merge") + "). "
                        "Demande à ton assistant IA de mettre l'Atelier à jour.")
        if _git("diff", "--quiet", avant, "HEAD", "--", "requirements.txt", timeout=15).returncode:
            py = os.path.join(os.path.dirname(sys.executable), "python.exe" if os.name == "nt" else "python")
            r = subprocess.run([py if os.path.isfile(py) else sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
                                "-q", "-r", os.path.join(decks.RACINE, "requirements.txt")], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=600,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if r.returncode:
                raise Echec("Code mis à jour, mais les nouvelles dépendances ne s'installent pas : lance « python installer.py ».")


RELANCE = """import socket, subprocess, sys, time
for _ in range(150):                      # attend que l'ancien Atelier ait libéré son port
    with socket.socket() as s:
        if s.connect_ex(("127.0.0.1", int(sys.argv[1]))):
            break
    time.sleep(.2)
time.sleep(.5)
subprocess.Popen(sys.argv[2:], close_fds=True,
                 creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
"""


def redemarrer(port, fichier_app):
    """Relance l'Atelier avec les mêmes options, sans rouvrir d'onglet, une fois celui-ci arrêté ; puis l'arrête.
    Sans console, le nouvel Atelier se range dans la barre d'état, comme celui lancé par le raccourci."""
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    lanceur = pyw if os.path.isfile(pyw) else sys.executable
    cmd = [sys.executable, fichier_app, *[a for a in sys.argv[1:] if a != "--sans-navigateur"], "--sans-navigateur"]
    subprocess.Popen([lanceur, "-c", RELANCE, str(port), *cmd], close_fds=True, cwd=decks.RACINE,
                     creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    threading.Timer(1.0, lambda: os._exit(0)).start()
