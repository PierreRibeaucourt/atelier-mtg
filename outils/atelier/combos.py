"""Onglet Combos de l'Atelier : deux vues.

1. Le deck : les combos déjà présentes (toutes leurs cartes sont dans le deck).
2. Une carte : les autres cartes qui combotent avec elle, dans les couleurs du deck ou non.

Trois sources, mises dans le même format :
- MTGPics : la base de combos de Magic-Ville (site jumeau, sans Cloudflare), lue carte par carte (mtgpics.py) ;
- Commander Spellbook : base ouverte et vérifiée (find-my-combos pour le deck, recherche par carte) ;
- Claude : synergies du deck, à la demande (synergies.py).
EDHREC interdit les requêtes automatiques et Magic-Ville est derrière Cloudflare : on ne les interroge pas.
"""
import json
import re
import urllib.parse
import urllib.request

import bracket
import decks
import infos_cartes as ic
import mtgpics
import synergies

# ---------------------------------------------------------------- résultats Spellbook en français et classes
PHRASES = {
    "target opponent loses the game": "Un adversaire ciblé perd la partie",
    "each opponent loses the game": "Chaque adversaire perd la partie",
    "win the game": "Vous gagnez la partie",
    "lock": "Verrou",
    "you control one opponent on each of their turns": "Vous contrôlez un adversaire pendant chacun de ses tours",
    "infinitely large creature until end of turn": "Créature infiniment grande jusqu'à la fin du tour",
    "infinite turns": "Tours supplémentaires à l'infini",
}
NOMS = {
    "damage": "dégâts", "damage to all players": "dégâts à tous les joueurs", "damage to creatures": "dégâts aux créatures",
    "damage to each opponent": "dégâts à chaque adversaire",
    "lifegain": "gain de vie", "lifeloss": "perte de vie", "lifeloss for all players": "perte de vie pour tous les joueurs",
    "lifegain triggers": "déclenchements de gain de vie", "lifeloss triggers": "déclenchements de perte de vie",
    "creature etb": "arrivées de créatures", "creature ltb": "départs de créatures", "etb": "arrivées", "ltb": "départs",
    "death triggers": "déclenchements de mort", "creature sacrifice triggers": "sacrifices de créatures",
    "sacrifice triggers": "sacrifices", "draw triggers": "déclenchements de pioche", "card draw": "pioche",
    "card draw for each opponent": "pioche pour chaque adversaire", "draw triggers for each opponent": "déclenchements de pioche adverses",
    "looting": "pioche-défausse", "self-discard triggers": "défausses", "discard triggers": "défausses",
    "storm count": "compteur de tempête", "blinking of permanents": "clignotements de permanents",
    "mana": "mana", "colored mana": "mana coloré", "colorless mana": "mana incolore", "red mana": "mana rouge",
    "black mana": "mana noir", "blue mana": "mana bleu", "white mana": "mana blanc", "green mana": "mana vert",
    "mana lands you control can produce": "mana de vos terrains", "mana creatures you control can produce": "mana de vos créatures",
    "magecraft triggers": "déclenchements de magecraft", "cast triggers": "déclenchements de lancement",
    "+1/+1 counters on a creature": "marqueurs +1/+1 sur une créature", "creature tokens": "jetons de créature",
    "tokens": "jetons", "mill": "meule", "self-mill": "meule de votre bibliothèque", "untap of creatures": "dégagements de créatures",
    "untap of permanents": "dégagements de permanents", "untap of creatures you control": "dégagements de vos créatures",
    "creature tokens with haste": "jetons de créature avec la célérité", "combat phases": "phases de combat", "landfall triggers": "déclenchements d'atterrissage",
    "attack triggers": "déclenchements d'attaque", "spells cast": "sorts lancés",
}
# un libellé par classe, quelle que soit la source (MTGPics « Infinite (Win) » et « Win » = Victoire, « Lock » = Verrou…)
CLASSES = {"victoire": "Victoire", "verrou": "Verrou", "mana": "Mana infini", "pioche": "Pioche", "boucle": "Boucle infinie",
           "valeur": "Valeur", "menace": "Menace", "syn": "Synergie"}


CLAUDE = {"Victoire": "victoire", "Pioche": "pioche", "Mana": "mana"}      # mêmes couleurs que les classes des autres sources


def _libelles(liste):
    """MTGPics et Spellbook : le libellé commun de leur classe. Claude garde ses classes (Moteur, Récursion…)."""
    for c in liste:
        if c["source"] == "claude":
            c["classe"] = CLAUDE.get(c["classe_lib"], c["classe"])
        else:
            c["classe_lib"] = CLASSES.get(c["classe"], c["classe_lib"])
    return liste


def _cle_combo(cartes):
    return frozenset(ic._simple(n.split(" // ")[0]) for n in cartes)


def _sans_doublons(liste):
    """Une combo connue des deux sources (mêmes cartes) : on garde Spellbook, qui l'explique pas à pas."""
    rang = {"spellbook": 0, "mtgpics": 1}
    garde = {}
    for c in sorted(liste, key=lambda c: (rang.get(c["source"], 2), -(c.get("popularite") or 0))):
        garde.setdefault(_cle_combo(c["cartes"]), c)
    retenues = {id(c) for c in garde.values()}
    return [c for c in liste if id(c) in retenues]


def en_francais(feature):
    b = feature.strip().lower()
    if b in PHRASES:
        return PHRASES[b]
    m = re.match(r"(near-)?infinite\s+(.+)$", b)
    if m and m.group(2) in NOMS:
        nom = NOMS[m.group(2)]
        return nom[0].upper() + nom[1:] + (" presque à l'infini" if m.group(1) else " à l'infini")
    return feature.strip()


def classe(produits):
    p = [x.lower() for x in produits]

    def a(*mots, sauf=()):
        return any(any(m in x for m in mots) and not any(s in x for s in sauf) for x in p)
    # phases de combat à l'infini (Aurelia + Helm of the Host) : on attaque sans fin, la partie est gagnée
    if a("loses the game", "win the game", "poison", "combat phases") or a("damage", "lifeloss", "mill", sauf=("to creatures", "self-mill")):
        return "victoire"
    if a("lock", "control one opponent", "infinite turns"):
        return "verrou"
    if a("mana", sauf=("magecraft",)):
        return "mana"
    if a("card draw", "looting"):
        return "pioche"
    if a("infinite"):
        return "boucle"
    return "valeur"


def _spellbook(c):
    """Une combo Spellbook (bracket._combo) au format commun."""
    k = classe(c["produit"])
    return dict(c, source="spellbook", classe=k, classe_lib=CLASSES[k], resultats=[en_francais(x) for x in c["produit"]])


# ---------------------------------------------------------------- cartes d'une combo (nom français, image, prix, dans le deck ?)
def _fiches(liste, dans):
    noms = sorted({n for c in liste for n in c["cartes"]})
    I = ic.infos(noms) if noms else {}
    dehors = sorted({n for n in noms if n not in dans})
    if dehors:
        try:
            ic.noms_francais(dehors, suivi=False)
            ic.rafraichir_prix(dehors, suivi=False)
        except Exception:                             # pas de réseau : on montre ce qu'on a
            pass
    cache = ic._charge()["cartes"]
    for c in liste:
        c["fiches"] = []
        for n in c["cartes"]:
            f = cache.get(n) or I.get(n) or {}
            c["fiches"].append(dict(nom=n, fr=f.get("fr") or "", image=f.get("image", ""), prix=f.get("prix"),
                                    couleurs=f.get("couleurs", []), dans=n in dans or n.split(" // ")[0] in dans))
    return liste


def _contexte(deck):
    entrees = decks.lire(decks.chemin(deck))
    jeu = [e for e in entrees if decks.categorie(e) != "Maybeboard"]
    dans = {e["nom"] for e in jeu} | {e["nom"].split(" // ")[0] for e in jeu}
    cmds = [e["nom"] for e in jeu if decks.categorie(e) == "Commander"]
    I = ic.infos(cmds) if cmds else {}
    ident = set().union(*[set((I.get(n) or {}).get("couleurs", [])) for n in cmds]) if cmds else None
    maybe = {e["nom"] for e in entrees if decks.categorie(e) == "Maybeboard"}
    return dans, ident, maybe


def _harmoniser(liste, noms):
    """MTGPics écrit parfois seulement la première face (« Delver of Secrets ») : on reprend le nom complet du deck."""
    par_face = {ic._simple(n.split(" // ")[0]): n for n in noms if " // " in n}
    for c in liste:
        c["cartes"] = [par_face.get(ic._simple(n), n) for n in c["cartes"]]
    return liste


# ---------------------------------------------------------------- 1. le deck : combos présentes
def combos_deck(deck, force=False):
    dans, ident, _ = _contexte(deck)
    liste, erreur = [], None
    for c in _harmoniser([mtgpics.ligne(c) for c in mtgpics.combos_gardees()], dans):
        if all(n in dans for n in c["cartes"]):
            liste.append(c)
    try:
        liste += [_spellbook(dict(c)) for c in bracket.spellbook(deck, force)["combos"]]
    except Exception as e:                             # Spellbook injoignable : le reste s'affiche
        erreur = str(e)
    liste = _sans_doublons(liste)
    st = synergies.etat(deck)
    vus = {_cle_combo(c["cartes"]): c for c in liste}
    for s in (st["resultat"] or {}).get("synergies", []):
        if not all(n in dans for n in s["cartes"]):
            continue
        meme = vus.get(_cle_combo(s["cartes"]))
        if meme:                                        # déjà connue (MTGPics, Spellbook) : on y ajoute l'explication de Claude
            meme["explication"] = s["explication"]
            continue
        liste.append(dict(source="claude", cartes=s["cartes"], classe="syn", classe_lib=s["classe"], force=s["force"],
                          titre=s["titre"], explication=s["explication"], resultats=[], popularite=None, lien=""))
    ordre = {"mtgpics": 0, "spellbook": 1, "claude": 2}
    liste.sort(key=lambda c: (ordre[c["source"]], -(c.get("popularite") or c.get("force") or 0)))
    return dict(combos=_fiches(_libelles(liste), dans), synergies=st, erreur=erreur, mtgpics=mtgpics.etat_deck(deck))


# ---------------------------------------------------------------- 2. une carte : les cartes qui combotent avec elle
def _spellbook_carte(carte, ident):
    q = f'card:"{ic._cle(carte)}" legal:commander' + (f" ci<={''.join(sorted(ident)).lower() or 'c'}" if ident is not None else "")
    url = f"{bracket.SPELLBOOK}/variants/?" + urllib.parse.urlencode({"q": q, "limit": 60})
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "MTG-assistant-perso/1.0"})
    return [_spellbook(bracket._combo(c, set())) for c in json.load(urllib.request.urlopen(req, timeout=60)).get("results", [])]


def combos_carte(deck, carte, couleurs=True, force=False):
    dans, ident, maybe = _contexte(deck)
    filtre = ident if couleurs else None
    erreurs, info = [], None
    try:
        info = mtgpics.combos_carte(carte, force)          # la première fois : quelques secondes (requêtes espacées)
    except Exception as e:
        erreurs.append(f"MTGPics ne répond pas : {e}")
    liste = _harmoniser([mtgpics.ligne(c) for c in mtgpics.combos_gardees(carte)], dans | {carte})
    try:
        liste += _spellbook_carte(carte, filtre)
    except Exception as e:
        erreurs.append(f"Commander Spellbook ne répond pas : {e}")
    liste = _fiches(_libelles(_sans_doublons(liste)), dans)
    if filtre is not None:                             # MTGPics ne filtre pas : on retire ce qui sort des couleurs
        liste = [c for c in liste if all(set(f["couleurs"]) <= filtre for f in c["fiches"])]
    for c in liste:
        c["manque"] = [f["nom"] for f in c["fiches"] if not f["dans"] and f["nom"] != carte]
        c["maybe"] = [n for n in c["manque"] if n in maybe]
    liste.sort(key=lambda c: (len(c["manque"]), c["source"] != "mtgpics", -(c.get("popularite") or 0)))
    return dict(carte=carte, combos=liste, erreur=" · ".join(erreurs) or None, mtgpics=info,
                couleurs="".join(sorted(ident)) if ident is not None else None)
