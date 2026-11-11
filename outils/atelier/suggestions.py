"""Cartes à proposer pour un deck, calculées sur la base locale (Scryfall et Scryfall Tagger), sans autre service.

- Thème : les étiquettes de Scryfall Tagger fréquentes dans le deck mais rares ailleurs (le commandant compte triple), et
  les types de créature dominants. Chaque carte est notée sur ce profil, puis sur sa popularité (rang EDHREC republié par
  Scryfall : EDHREC lui-même n'est jamais interrogé).
- Combos : celles de Commander Spellbook à qui il ne manque qu'une carte, déjà demandées pour le bracket, avec leur
  explication.
- Classeur : les cartes qu'on a déjà, hors des decks.
Écartées : les cartes du deck et du Maybeboard, les terrains, celles hors des couleurs du commandant, non légales,
au-dessus du budget par carte, et celles qu'on a refusées (« Ne plus proposer » : suggestions.json dans le dossier du deck).
"""
import json
import math
import os
import re
import threading
from collections import Counter

import bracket
import classeur
import decks
import recherche
import reglages

FICHIER = "suggestions.json"
POIDS_COMMANDANT = 3
# étiquettes qui ne disent rien du thème : formes de texte, cycles d'impression, mots du nom, et les fonctions que tout
# deck a (ramp, pioche, removal… ; les removal particuliers, comme « chaque joueur sacrifie », restent)
NEUTRES = {"triggered-ability", "activated-ability", "drawback", "intervening-if-clause", "single-target-instant-sorcery",
           "symmetrical", "impact-effect", "alt-commander", "pair-commander", "mana-ability-with-extra-effect", "delayed-trigger",
           "additional-cost", "cheaper-than-mv", "refund", "alliteration", "onomatopoeia", "single-english-word-name",
           "virtual-vanilla", "virtual-french-vanilla", "french-vanilla", "vanilla", "unique-type-line", "meme",
           "multiplayer", "noncreature-typal", "keyword-soup",
           "ramp", "mana-rock", "mana-dork", "adds-multiple-mana", "draw", "card-advantage", "pure-draw", "repeatable-pure-draw",
           "draw-engine", "burst-draw", "cantrip", "removal", "spot-removal", "removal-creature", "removal-artifact",
           "removal-enchantment", "removal-planeswalker", "removal-land", "removal-exile", "removal-destroy", "multi-removal",
           "sweeper", "counterspell", "evasion", "tutor", "tutor-to-hand"}
NEUTRES_DEBUT = ("cycle-", "namesake-", "flavor-", "art-", "tutor-land")
TYPES_COURANTS = 3        # un type de créature n'est un thème que s'il est 3 fois plus présent dans le deck qu'ailleurs
PAR_THEME = 60            # au-delà, des cartes de plus en plus loin du deck

_verrou = threading.Lock()
_cache = {}


# ---------------------------------------------------------------- cartes refusées (« Ne plus proposer »)
def _chemin(deck):
    return decks.chemin(deck, FICHIER)


def ecartees(deck):
    try:
        return json.load(open(_chemin(deck), encoding="utf-8")).get("ecartees", [])
    except (OSError, ValueError):
        return []


def ecarter(deck, nom, oui=True):
    with _verrou:
        liste = [n for n in ecartees(deck) if n != nom] + ([nom] if oui else [])
        with open(_chemin(deck), "w", encoding="utf-8") as f:
            json.dump(dict(ecartees=sorted(liste)), f, ensure_ascii=False, indent=1)
    return liste


# ---------------------------------------------------------------- le profil du deck
def _neutre(b, t):
    s = b["tags"][t]["s"]
    return s in NEUTRES or s.startswith(NEUTRES_DEBUT)


def _sous_types(x):
    return [s for face in x["t"].split(" // ") if "—" in face and "Creature" in face.split("—")[0] for s in face.split("—")[1].split()]


def _parts_types(b):
    """Part de chaque type de créature parmi toutes les créatures (Humain ≈ 20 %, Élémental ≈ 3 %), une fois par base."""
    if "_parts_types" not in b:
        st, n = Counter(), 0
        for x in b["cartes"]:
            if "Creature" in x["_types"] and not x["dig"] and not x["fun"]:
                n += 1
                st.update(set(_sous_types(x)))
        b["_parts_types"] = {s: c / max(n, 1) for s, c in st.items()}
    return b["_parts_types"]


def _deck(deck):
    """(commandants, cartes du deck avec leurs exemplaires, toutes les clés de nom du deck et du Maybeboard, identité)."""
    b = recherche.base()
    entrees = decks.lire(decks.chemin(deck))
    trouve = lambda nom: b["par_cle"].get(recherche.ic._cle(nom).lower())      # noqa: E731
    cmd = [x for x in (trouve(e["nom"]) for e in entrees if decks.categorie(e) == "Commander") if x]
    jeu = [(x, e["n"]) for e in entrees if decks.categorie(e) not in ("Commander", "Maybeboard") for x in [trouve(e["nom"])] if x]
    cles = {recherche.ic._cle(e["nom"]).lower() for e in entrees}
    ident = set("".join(x["ci"] for x in cmd)) if cmd else set("".join(x["ci"] for x, _ in jeu))
    return cmd, jeu, cles, ident


def _profil(b, cmd, jeu):
    """{étiquette: poids} et les types de créature dominants (ceux du deck, pas du commandant : un Kraken ne fait pas
    un deck de Krakens)."""
    sorts = [(x, n) for x, n in jeu if "Land" not in x["_types"]]
    compte = Counter()
    for x, _ in sorts:
        compte.update(x["_tg"])
    for x in cmd:
        for t in x["_tg"]:
            compte[t] += POIDS_COMMANDANT
    N = len(b["cartes"])
    profil = {t: c * math.log(N / (1 + len(b["par_tag"].get(t, ())))) for t, c in compte.items()
              if c >= 2 and len(b["par_tag"].get(t, ())) >= 5 and not _neutre(b, t)}
    creatures = [x for x, _ in sorts if "Creature" in x["_types"]]
    st = Counter(s for x in creatures for s in set(_sous_types(x)))
    parts = _parts_types(b)
    tribus = [s for s, c in st.most_common() if c >= max(4, len(creatures) * .3) and c / len(creatures) >= TYPES_COURANTS * parts.get(s, 1)]
    return profil, tribus


def _notes(b, profil, tribus):
    """{indice de la carte dans la base: note de thème brute}, pour les cartes qui touchent au profil."""
    motifs = [re.compile(rf"\b{re.escape(s)}s?\b") for s in tribus]
    res = {}
    for k, x in enumerate(b["cartes"]):
        communs = [t for t in x["_tg"] if t in profil]
        tribu = any(m.search(x["t"]) or m.search(x["o"]) for m in motifs)
        if not communs and not tribu:
            continue
        s = sum(profil[t] for t in communs) / math.sqrt(len(x["_tg"]) + 3)
        if tribu:
            s = s * 1.6 if s else 0.5 * max(profil.values(), default=1) / math.sqrt(len(x["_tg"]) + 3)
        res[k] = s
    return res


def _popularite(x):
    return 1 - min(math.log10(x["rk"]), 5) / 5 if x.get("rk") else 0.0       # rang 1 → 1, rang 100 000 → 0


def _reference(notes, candidats):
    """La note de thème qui vaut « 100 % » : la 10e meilleure des cartes proposables."""
    vals = sorted((notes[k] for k in candidats if k in notes), reverse=True)
    return vals[min(9, len(vals) - 1)] if vals else 1.0


def _analyse(deck):
    """Le profil du deck et les notes de thème de toutes les cartes, gardés tant que le deck et la base ne changent pas."""
    b = recherche.base()
    if b is None:
        raise RuntimeError("La base de cartes n'est pas encore prête : elle se construit (quelques minutes la première fois).")
    cle = (os.path.getmtime(decks.chemin(deck)), b["date"])
    if _cache.get(deck, (None,))[0] == cle:
        return _cache[deck][1]
    recherche.fonctions_cartes([])                         # familles du gabarit (b["familles"]) : le filtre « Fonction »
    cmd, jeu, cles, ident = _deck(deck)
    profil, tribus = _profil(b, cmd, jeu)
    a = dict(b=b, cmd=cmd, jeu=jeu, cles=cles, ident=ident, notes=_notes(b, profil, tribus))
    _cache[deck] = (cle, a)
    return a


# ---------------------------------------------------------------- la recherche : tri « Pertinence » pour le deck lié
def pertinences(deck):
    """{clé de nom: note de 0 à 1} pour toutes les cartes qui touchent au thème du deck."""
    a = _analyse(deck)
    b, notes = a["b"], a["notes"]
    ref = _reference(notes, notes.keys()) or 1.0
    return {b["cartes"][k]["_cle"]: .65 * min(1, s / ref) + .35 * _popularite(b["cartes"][k]) for k, s in notes.items()}


# ---------------------------------------------------------------- l'onglet Suggestions
def _combos(deck):
    """{nom de la carte qui manque: [combos de Spellbook]} d'après la dernière analyse du deck (cartes, résultats,
    prérequis, explication, lien)."""
    sb, a_jour = bracket.spellbook_connu(deck)
    if not a_jour:                                         # liste changée depuis : nouvelle analyse en tâche de fond
        threading.Thread(target=bracket.rafraichir, args=(deck,), daemon=True).start()
    res = {}
    for c in (sb or {}).get("presque", []):
        if len(c.get("manque", [])) == 1:
            res.setdefault(c["manque"][0], []).append(c)
    return res


_ub_demande = threading.Event()


def _universes_beyond():
    """Les cartes Universes Beyond connues ; la première fois, la liste se charge en tâche de fond (badge au prochain calcul)."""
    noms = (recherche.ic._charge().get("ub") or {}).get("noms")
    if not noms and not _ub_demande.is_set():
        _ub_demande.set()
        threading.Thread(target=lambda: _sans_erreur(recherche.ic.universes_beyond), daemon=True).start()
    return set(noms or ())


def _sans_erreur(f):
    try:
        f()
    except Exception:                                      # pas de réseau : on réessaiera au prochain lancement
        _ub_demande.clear()


def calculer(deck):
    a = _analyse(deck)
    b, notes, ident = a["b"], a["notes"], a["ident"]
    if not a["cmd"] and not a["jeu"]:                      # deck vide, sans commandant : rien à quoi se rattacher
        return dict(cartes=[], ecartees=ecartees(deck))
    budget = reglages.budget()                             # math.inf : pas de budget
    refus = set(ecartees(deck))
    poss = classeur.cartes()
    combos = _combos(deck)
    ub = _universes_beyond()
    sans_ub = reglages.sans_ub_suggestions()                # Options : ne pas suggérer de cartes Universes Beyond

    def proposable(x):
        return (x["_cle"] not in a["cles"] and x["n"] not in refus and "commander" in x["_lg"] and set(x["ci"]) <= ident
                and not (sans_ub and x["n"] in ub)
                and x["spe"] not in recherche.HORS_JEU and not x["dig"] and not x["fun"] and "Land" not in x["_types"]
                and (budget == math.inf or (x["eur"] is not None and x["eur"] <= budget)))

    candidats = [k for k, x in enumerate(b["cartes"]) if proposable(x)]
    ref = _reference(notes, candidats) or 1.0
    theme = {k: min(1.0, notes[k] / ref) for k in candidats if k in notes}

    groupes = {}
    for k in sorted(theme, key=lambda k: -theme[k] * (.6 + .4 * _popularite(b["cartes"][k])))[:PAR_THEME]:
        if theme[k] >= .2:
            groupes.setdefault(k, set()).add("theme")
    par_nom = {b["cartes"][k]["n"]: k for k in candidats}
    for nom in combos:                                     # combos à une carte près
        k = par_nom.get(nom)
        if k is not None:
            groupes.setdefault(k, set()).add("combos")
    for k in candidats:                                    # classeur : ce qui touche au deck, même de loin
        if b["cartes"][k]["n"] in poss and (k in groupes or theme.get(k, 0) >= .1):
            groupes.setdefault(k, set()).add("classeur")

    jour = recherche.ic.aujourdhui()
    cartes = []
    for k, g in groupes.items():
        x = b["cartes"][k]
        note = min(1.0, .65 * theme.get(k, 0) + .35 * _popularite(x) + (.2 if "combos" in g else 0))
        s = recherche._sortie(x, b, {}, None, jour)
        s.update(note=round(note, 3), groupes=sorted(g), combos=combos.get(x["n"], []), classeur=poss.get(x["n"], 0),
                 ub=x["n"] in ub, fonctions=[lib for lib, tags in b["familles"] if x["_tg"] & tags])   # filtre « Fonction »
        cartes.append(s)
    cartes.sort(key=lambda s: -s["note"])
    return dict(cartes=cartes, ecartees=sorted(refus))
