"""Mon classeur : les cartes que j'ai en dehors des decks. Classeur/classeur.txt, à la racine, hors du dépôt.

Une carte par ligne, « quantité nom anglais » (« 1 Sol Ring »), triées par nom : le fichier se colle tel quel dans
Archidekt, Moxfield ou l'Atelier. Les lignes « # … » du début sont des notes, gardées telles quelles.
"""
import csv
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


# colonnes des collections exportées en CSV : ManaBox (Name, Quantity), Moxfield et Deckbox (Count, Name), Archidekt
# (Quantity, Name), Dragon Shield (Quantity, Card Name, après une ligne « sep=, »), TCGplayer (Quantity, Name)…
COL_NOM = ("name", "card name", "card", "card_name", "cardname", "nom")
COL_QTE = ("quantity", "count", "qty", "quantité", "quantite", "qté", "amount", "copies")


def lire_csv(texte):
    """Une collection exportée en CSV par une autre appli : Counter nom → exemplaires. None si ce n'est pas un CSV
    avec une colonne de noms (une liste « 1 Sol Ring », par exemple)."""
    lignes = texte.lstrip("﻿").splitlines()
    if lignes and lignes[0].lower().startswith("sep="):
        lignes = lignes[1:]
    if not lignes:
        return None
    sep = max((",", ";", "	"), key=lignes[0].count)
    if not lignes[0].count(sep):
        return None
    lecteur = csv.reader(lignes, delimiter=sep)
    cols = [c.strip().lower() for c in next(lecteur)]
    i_nom = next((cols.index(c) for c in COL_NOM if c in cols), None)
    if i_nom is None:
        return None
    i_qte = next((cols.index(c) for c in COL_QTE if c in cols), None)
    res = Counter()
    for r in lecteur:
        if len(r) <= i_nom or not r[i_nom].strip():
            continue
        try:
            n = int(float(r[i_qte])) if i_qte is not None and i_qte < len(r) and r[i_qte].strip() else 1
        except ValueError:
            n = 1
        if n > 0:
            res[r[i_nom].strip()] += n
    return res


def lire_fichier(texte):
    """Un fichier exporté (CSV d'une collection) ou une liste (« 1 Sol Ring ») : Counter nom → exemplaires."""
    c = lire_csv(texte)
    return lire_liste(texte) if c is None else c


def remplacer(cartes_):
    """Le classeur devient exactement ces cartes ({nom: exemplaires}), notes du début gardées."""
    with _verrou:
        notes, _ = _lire()
        _ecrire(notes, Counter({k: v for k, v in cartes_.items() if v > 0}))


def index():
    """Où sont mes cartes : {nom: {"classeur": exemplaires, "decks": [[deck, exemplaires joués, exemplaires que j'ai]]}}.
    Les decks comptent hors Maybeboard et sans les terrains de base ; « que j'ai » vient de l'onglet Achats."""
    res = {}
    for nom, n in cartes().items():
        res[nom] = {"classeur": n, "decks": []}
    for deck in decks.dossiers():
        p = os.path.join(decks.RACINE, deck, decks.FICHIER)
        if not os.path.exists(p):
            continue
        besoin = Counter()
        for e in decks.lire(p):
            if decks.categorie(e) != "Maybeboard" and e["nom"] not in decks.BASES:
                besoin[e["nom"]] += e["n"]
        poss = decks.possedees(deck)
        for nom, n in besoin.items():
            res.setdefault(nom, {"classeur": 0, "decks": []})["decks"].append([deck, n, min(n, int(poss.get(nom) or 0))])
    return res


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
