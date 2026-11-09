"""Mon classeur : les cartes que j'ai en dehors des decks. Classeur/classeur.txt, à la racine, hors du dépôt.

Une carte par ligne, « quantité nom anglais » (« 1 Sol Ring »), triées par nom : le fichier se colle tel quel dans
Archidekt, Moxfield ou l'Atelier. Les lignes « # … » du début sont des notes, gardées telles quelles.
"""
import os
import re
import threading
from collections import Counter

import decks

DOSSIER = os.path.join(decks.RACINE, "Classeur")
FICHIER = os.path.join(DOSSIER, "classeur.txt")
_verrou = threading.Lock()


def _lire():
    """(notes du début du fichier, Counter nom → exemplaires)."""
    try:
        with open(FICHIER, encoding="utf-8") as f:
            lignes = f.read().splitlines()
    except OSError:
        return [], Counter()
    notes = []
    for l in lignes:
        if not l.startswith("#"):
            break
        notes.append(l)
    cartes = Counter()
    for e in decks.lire_lignes([l for l in lignes if not l.lstrip().startswith(("#", "//"))]):
        cartes[e["nom"]] += e["n"]
    return notes, cartes


def _ecrire(notes, cartes):
    os.makedirs(DOSSIER, exist_ok=True)
    lignes = [f"{n} {nom}" for nom, n in sorted(cartes.items(), key=lambda x: x[0].lower()) if n > 0]
    with open(FICHIER, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(notes + ([""] if notes else []) + lignes) + "\n")


def cartes():
    """{nom anglais: exemplaires}."""
    return dict(_lire()[1])


def lire_liste(texte):
    """Une liste collée (Archidekt, Moxfield, MTG Arena, « 1 Sol Ring » ou juste « Sol Ring ») : Counter nom → exemplaires."""
    lignes = [l if re.match(r"\s*(SB:\s*)?\d", l) else "1 " + l.strip()
              for l in texte.splitlines() if l.strip() and not l.lstrip().startswith(("#", "//"))]
    c = Counter()
    for e in decks.lire_lignes(lignes):
        c[e["nom"]] += e["n"]
    return c


def ajouter(ajouts):
    """ajouts : {nom: exemplaires en plus}. Renvoie toutes les cartes."""
    with _verrou:
        notes, c = _lire()
        for nom, n in ajouts.items():
            c[nom] += max(0, int(n))
        _ecrire(notes, c)
        return dict(c)


def fixer(nom, n):
    """Le nombre d'exemplaires d'une carte (0 : elle sort du classeur). Renvoie toutes les cartes."""
    with _verrou:
        notes, c = _lire()
        c[nom] = max(0, int(n))
        if not c[nom]:
            del c[nom]
        _ecrire(notes, c)
        return dict(c)
