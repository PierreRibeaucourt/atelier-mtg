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


def _combo(c, dans_deck):
    noms = [u["card"]["name"] for u in c.get("uses", [])]
    tag = c.get("bracketTag")
    return dict(cartes=noms, manque=[n for n in noms if n not in dans_deck],
                produit=[p["feature"]["name"] for p in c.get("produces", [])][:6],
                description=c.get("description", ""), prerequis=c.get("easyPrerequisites", "") or "",
                prerequis2=c.get("notablePrerequisites", "") or "", mana=c.get("manaNeeded", ""),
                bracket=TAGS.get(tag, (None, tag))[0], tag=TAGS.get(tag, (None, tag))[1],
                lien=f"https://commanderspellbook.com/combo/{c.get('id')}/" if c.get("id") else "")


def spellbook(deck, force=False):
    """Estimation de bracket et combos du deck selon Commander Spellbook, gardées tant que la liste ne change pas."""
    entrees = decks.lire(decks.chemin(deck))
    jeu = [e for e in entrees if decks.categorie(e) != "Maybeboard"]
    corps = {"main": [{"card": e["nom"], "quantity": e["n"]} for e in jeu if decks.categorie(e) != "Commander"],
             "commanders": [{"card": e["nom"], "quantity": 1} for e in jeu if decks.categorie(e) == "Commander"]}
    cle = hashlib.sha1(json.dumps(corps, sort_keys=True).encode()).hexdigest()
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    if not force and cle in cache:
        return cache[cle]
    est = _spellbook("estimate-bracket", corps)
    fmc = _spellbook("find-my-combos", corps)["results"]
    dans = {e["nom"] for e in jeu} | {e["nom"].split(" // ")[0] for e in jeu}
    drapeaux = {f: [c["card"]["name"] for c in est.get("cards", []) if c.get(f)] for f in ("banned", "gameChanger", "massLandDenial", "extraTurn")}
    tag = est.get("bracketTag")
    res = dict(date=time.time(), tag=tag, bracket=TAGS.get(tag, (None, tag))[0], libelle=TAGS.get(tag, (None, tag))[1], **drapeaux,
               combos=[_combo(c, dans) for c in fmc.get("included", [])],
               presque=[_combo(c, dans) for c in fmc.get("almostIncluded", [])][:40])
    cache[cle] = res
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    return res


def bracket(deck, force=False):
    """Nos comptes + Spellbook + une estimation selon les règles officielles."""
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
        sb = spellbook(deck, force)
        sb_erreur = None
    except Exception as e:                          # Spellbook indisponible : on garde nos propres comptes
        sb, sb_erreur = None, str(e)
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
                tuteurs=tuteurs, tours=tours, mld=mld, spellbook=sb, spellbook_erreur=sb_erreur)
