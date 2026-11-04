"""Bracket d'un deck : Game Changers, combos, tours supplémentaires, destruction massive de terrains, tuteurs.

Deux sources :
- nos propres comptes (liste officielle des Game Changers via Scryfall, textes Oracle pour les tuteurs) ;
- Commander Spellbook (backend.commanderspellbook.com) : estimation de bracket et combos du deck.
Règles des brackets (Wizards, 2025) : 1-2 sans Game Changer ni combo infinie à 2 cartes, 3 avec 3 Game Changers au plus
et pas de combo en début de partie, 4 sans limite. Pas de destruction massive de terrains ni de tours supplémentaires
enchaînés avant le bracket 4.
"""
import hashlib
import json
import os
import re
import time
import urllib.request

import decks
import infos_cartes as ic

ICI = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ICI, "cache_spellbook.json")
SPELLBOOK = "https://backend.commanderspellbook.com"
TAGS = {"R": (4, "Ruthless"), "S": (3, "Spicy"), "P": (3, "Powerful"), "O": (2, "Oddball"), "C": (2, "Core"), "E": (1, "Exhibition"),
        "B": (None, "carte bannie")}
TUTEUR = re.compile(r"search your library for (?:a|an|up to \w+|two|three) (?![\w ,-]*\b(?:basic|lands?|plains|island|swamp|mountain|forest)\b)[\w ,-]*?cards?", re.I)


def _spellbook(endpoint, corps):
    req = urllib.request.Request(f"{SPELLBOOK}/{endpoint}", data=json.dumps(corps).encode(),
                                 headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "MTG-assistant-perso/1.0"})
    return json.load(urllib.request.urlopen(req, timeout=90))


VERSION_CACHE = 2          # change quand on garde plus d'informations par combo (les anciennes entrées sont recalculées)


def _combo(c, dans_deck):
    noms = [u["card"]["name"] for u in c.get("uses", [])]
    tag = c.get("bracketTag")
    return dict(id=c.get("id", ""), cartes=noms, manque=[n for n in noms if n not in dans_deck],
                autres=[f"{r['template']['name']}" + (f" (×{r['quantity']})" if r.get("quantity", 1) > 1 else "") for r in c.get("requires", [])],
                produit=[p["feature"]["name"] for p in c.get("produces", [])][:8],
                description=c.get("description", ""), prerequis=c.get("easyPrerequisites", "") or "",
                prerequis2=c.get("notablePrerequisites", "") or "", mana=c.get("manaNeeded", ""),
                popularite=c.get("popularity"), identite=c.get("identity", ""),
                bracket=TAGS.get(tag, (None, tag))[0], tag=TAGS.get(tag, (None, tag))[1],
                lien=f"https://commanderspellbook.com/combo/{c.get('id')}/" if c.get("id") else "")


def _liste(deck):
    """Ce qu'on envoie à Spellbook, et la clé du cache (la liste du deck, hors Maybeboard)."""
    jeu = [e for e in decks.lire(decks.chemin(deck)) if decks.categorie(e) != "Maybeboard"]
    corps = {"main": [{"card": e["nom"], "quantity": e["n"]} for e in jeu if decks.categorie(e) != "Commander"],
             "commanders": [{"card": e["nom"], "quantity": 1} for e in jeu if decks.categorie(e) == "Commander"]}
    return jeu, corps, hashlib.sha1(json.dumps(dict(corps, v=VERSION_CACHE), sort_keys=True).encode()).hexdigest()


def _cache():
    return json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}


def _noter_dernier(cache, deck, cle):
    """« _dernier » : la dernière analyse de chaque deck, pour l'afficher pendant que la nouvelle se fait."""
    if cache.setdefault("_dernier", {}).get(deck) != cle:
        cache["_dernier"][deck] = cle
        json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)


def spellbook_connu(deck):
    """Sans réseau : (analyse de la liste actuelle, True), sinon (dernière analyse du deck ou None, False)."""
    _, _, cle = _liste(deck)
    cache = _cache()
    if cle in cache:
        return cache[cle], True
    return cache.get(cache.get("_dernier", {}).get(deck) or ""), False


_en_cours = set()


def rafraichir(deck):
    """Analyse Spellbook de la liste actuelle, en tâche de fond (une seule à la fois par deck)."""
    if deck in _en_cours:
        return
    _en_cours.add(deck)
    try:
        spellbook(deck)
    except Exception:                                   # pas de réseau : on réessaiera au prochain affichage
        pass
    finally:
        _en_cours.discard(deck)


def spellbook(deck, force=False):
    """Estimation de bracket et combos du deck selon Commander Spellbook, gardées tant que la liste ne change pas."""
    jeu, corps, cle = _liste(deck)
    cache = _cache()
    if not force and cle in cache:
        _noter_dernier(cache, deck, cle)
        return cache[cle]
    est = _spellbook("estimate-bracket", corps)
    fmc = _spellbook("find-my-combos", corps)["results"]
    dans = {e["nom"] for e in jeu} | {e["nom"].split(" // ")[0] for e in jeu}
    drapeaux = {f: [c["card"]["name"] for c in est.get("cards", []) if c.get(f)] for f in ("banned", "gameChanger", "massLandDenial", "extraTurn")}
    tag = est.get("bracketTag")
    res = dict(date=time.time(), tag=tag, bracket=TAGS.get(tag, (None, tag))[0], libelle=TAGS.get(tag, (None, tag))[1], **drapeaux,
               combos=[_combo(c, dans) for c in fmc.get("included", [])],
               presque=[_combo(c, dans) for c in fmc.get("almostIncluded", [])][:80])
    cache = _cache()                                   # relu : une autre analyse a pu l'écrire pendant les requêtes
    cache[cle] = res
    cache.setdefault("_dernier", {})[deck] = cle
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    return res


def bracket(deck, force=False, reseau=True):
    """Nos comptes + Spellbook + une estimation selon les règles officielles.
    reseau=False : sans attendre Spellbook, avec sa dernière analyse du deck (spellbook_a_jour dit si c'est celle de la liste actuelle)."""
    entrees = decks.lire(decks.chemin(deck))
    jeu = [e for e in entrees if decks.categorie(e) != "Maybeboard"]
    noms = [e["nom"] for e in jeu]
    I = ic.infos(noms)
    ic.game_changers(force=force)
    gc = [n for n in noms if ic.est_gc(n)]
    sans_rappel = {n: re.sub(r"\([^)]*\)", "", (I.get(n) or {}).get("texte", "")) for n in noms}   # sans texte de rappel (recyclage de terrain)
    tuteurs = [n for n in noms if TUTEUR.search(sans_rappel[n])]
    tours = [n for n in noms if re.search(r"extra turn", (I.get(n) or {}).get("texte", ""), re.I)]
    try:
        sb, a_jour = (spellbook(deck, force), True) if reseau else spellbook_connu(deck)
        sb_erreur = None
    except Exception as e:                          # Spellbook indisponible : on garde nos propres comptes
        sb, sb_erreur, a_jour = None, str(e), False
    mld = sb["massLandDenial"] if sb else []
    tours = sorted(set(tours) | set(sb["extraTurn"] if sb else []))
    combos2 = [c for c in (sb["combos"] if sb else []) if len(c["cartes"]) <= 2]
    raisons = []
    if sb and sb["banned"]:
        estime, raisons = None, [f"carte bannie en Commander : {', '.join(sb['banned'])}"]
    elif len(gc) > 3 or mld or len(tours) > 2:
        estime = 4
        if len(gc) > 3:
            raisons.append(f"{len(gc)} Game Changers (3 au plus en bracket 3)")
        if mld:
            raisons.append("destruction massive de terrains : " + ", ".join(mld))
        if len(tours) > 2:
            raisons.append(f"{len(tours)} cartes de tours supplémentaires")
    elif gc or combos2:
        estime = 3
        if gc:
            raisons.append(f"{len(gc)} Game Changer{'s' if len(gc) > 1 else ''} : {', '.join(gc)}")
        if combos2:
            raisons.append(f"{len(combos2)} combo{'s' if len(combos2) > 1 else ''} infinie{'s' if len(combos2) > 1 else ''} à 2 cartes : à ne pas sortir en début de partie")
    else:
        estime = 2
        raisons.append("aucun Game Changer, aucune combo infinie à 2 cartes : bracket 2 (ou 1 si le deck est très décontracté)")
    if tours and estime and estime < 4:
        raisons.append(f"tours supplémentaires : {', '.join(tours)} (peu, jamais enchaînés)")
    if len(tuteurs) > 3:
        raisons.append(f"{len(tuteurs)} tuteurs : beaucoup pour un bracket 1-2")
    return dict(estime=estime, raisons=raisons, gc=gc, gc_liste=ic._charge()["gc"].get("noms", []), gc_maj=ic._charge()["gc"].get("maj"),
                tuteurs=tuteurs, tours=tours, mld=mld, spellbook=sb, spellbook_erreur=sb_erreur, spellbook_a_jour=a_jour)
