"""Jouer tout seul (le « playtester ») : ce qu'il faut à la page /jouer en plus de la liste du deck.

Les jetons que créent les cartes du deck viennent de Scryfall : le champ all_parts d'une carte liste ses jetons
(composant « token ») et les donjons où elle fait aventurer (composant « combo_piece », type « Dungeon »). Une requête /cards/collection par paquet de 75 cartes, puis une pour les jetons eux-mêmes ;
le tout est gardé dans cache_jetons.json, donc un deck déjà joué ne redemande rien.
"""
import json
import os
import re
import sys
import threading
import time
import urllib.request

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(ICI))
from prix import ENTETES  # noqa: E402

CACHE = os.path.join(ICI, "cache_jetons.json")
VERSION = 2                      # 2 : les donjons en plus des jetons (les cartes déjà lues sont relues)
_verrou = threading.Lock()


def _cle(nom):
    """Nom de la première face : « Cut // Ribbons » -> « Cut »."""
    return re.split(r" /{1,2} ", nom)[0]


def _lire():
    try:
        with open(CACHE, encoding="utf-8") as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = dict(cartes={}, jetons={})
    if cache.get("version") != VERSION:
        cache.update(version=VERSION, cartes={})
    return cache


def _a_creer(p):
    """Ce qu'une carte met en jeu sans être dans le deck : ses jetons, et les donjons (aventure, initiative)."""
    return p.get("component") == "token" or (p.get("component") == "combo_piece" and (p.get("type_line") or "").startswith("Dungeon"))


def _ecrire(cache):
    tmp = CACHE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    os.replace(tmp, CACHE)


def _collection(identifiants):
    """Scryfall /cards/collection, par paquets de 75 identifiants."""
    cartes = []
    for i in range(0, len(identifiants), 75):
        corps = json.dumps({"identifiers": identifiants[i:i + 75]}).encode()
        req = urllib.request.Request("https://api.scryfall.com/cards/collection", data=corps,
                                     headers={**ENTETES, "Content-Type": "application/json"})
        time.sleep(0.5)                        # Scryfall : 2 requêtes par seconde au plus
        with urllib.request.urlopen(req, timeout=30) as r:
            cartes += json.load(r).get("data", [])
    return cartes


def _image(c):
    u = c.get("image_uris") or ((c.get("card_faces") or [{}])[0].get("image_uris")) or {}
    return u.get("normal", "")


def jetons(noms):
    """Les jetons que peuvent créer ces cartes : [dict(nom, type, pt, texte, image, cartes=[cartes qui le créent])]."""
    noms = list(dict.fromkeys(noms))
    with _verrou:
        cache = _lire()
        manquants = [n for n in noms if n not in cache["cartes"]]
        if manquants:
            trouvees = {_cle(c["name"]).lower(): c for c in _collection([{"name": _cle(n)} for n in manquants])}
            for n in manquants:
                c = trouvees.get(_cle(n).lower()) or {}
                cache["cartes"][n] = [p["id"] for p in c.get("all_parts") or [] if _a_creer(p)]
        ids = list(dict.fromkeys(i for n in noms for i in cache["cartes"].get(n, [])))
        a_charger = [i for i in ids if i not in cache["jetons"]]
        if a_charger:
            for c in _collection([{"id": i} for i in a_charger]):
                cache["jetons"][c["id"]] = dict(
                    nom=c.get("name", ""), type=c.get("type_line", ""), texte=c.get("oracle_text", ""), image=_image(c),
                    pt=f"{c['power']}/{c['toughness']}" if c.get("power") is not None else "")
            for i in a_charger:
                cache["jetons"].setdefault(i, {})      # introuvable : on ne le redemande pas
        if manquants or a_charger:
            _ecrire(cache)
    # un même jeton imprimé dans plusieurs éditions (Trésor, Indice…) n'apparaît qu'une fois
    uniques = {}
    for n in noms:
        for i in cache["cartes"].get(n, []):
            j = cache["jetons"].get(i) or {}
            if not j.get("nom") or j["nom"] == "Copy":       # « Copy » : simple aide-mémoire de Scryfall
                continue
            k = (j["nom"], j["type"], j["pt"], j["texte"])
            u = uniques.setdefault(k, dict(j, cartes=[]))
            if n not in u["cartes"]:
                u["cartes"].append(n)
    return sorted(uniques.values(), key=lambda j: (j["nom"], j["pt"]))
