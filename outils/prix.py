"""Prix Cardmarket (EUR) d'une ou plusieurs cartes, via l'API publique Scryfall.

Cardmarket bloque les accès automatiques ; Scryfall republie ses prix en euros.
Accepte les noms anglais ou français.

Usage :
  python outils/prix.py "Tour de commandement" "Sol Ring"
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ENTETES = {"User-Agent": "MTG-assistant-perso/1.0", "Accept": "application/json"}
BUDGET = 5.0  # seuil habituel par carte


def get(url, params=None):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    for essai in range(5):
        time.sleep(0.6)  # Scryfall limite les recherches à 2 par seconde
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=ENTETES)) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                return None
            if e.code == 429:  # trop de requêtes : on attend puis on réessaie
                time.sleep(15 * (essai + 1))
                continue
            raise
    raise RuntimeError("Scryfall refuse les requêtes (429), réessayer plus tard")


def nom_anglais(nom):
    """Retrouve le nom anglais officiel (Scryfall indexe les noms français avec lang:fr)."""
    c = get("https://api.scryfall.com/cards/named", {"fuzzy": nom})
    if c:
        return c["name"]
    for q in (f'!"{nom}" lang:fr', f"{nom} lang:fr"):
        r = get("https://api.scryfall.com/cards/search", {"q": q})
        if r and r.get("data"):
            return r["data"][0]["name"]
    return None


# Éditions dont le prix Cardmarket publié est faux : Summer Magic (1994, rarissime) donne Wheel of Fortune à 0,02 €.
EDITIONS_DOUTEUSES = {"sum"}


def prix_fiable(c):
    """Cette impression compte-t-elle pour le prix le plus bas ? Non pour une édition douteuse, un bord doré
    (World Championship, non jouable), une carte géante, numérique ou un objet de collection."""
    return not (c.get("set") in EDITIONS_DOUTEUSES or c.get("border_color") == "gold" or c.get("oversized")
                or c.get("digital") or c.get("set_type") in ("memorabilia", "token", "minigame"))


def impressions(nom):
    """Toutes les éditions de la carte qui ont un prix en euros (sauf celles dont le prix n'est pas fiable)."""
    r = get("https://api.scryfall.com/cards/search",
            {"q": f'!"{nom}"', "unique": "prints", "include_extras": "true"})
    cartes = []
    while r:
        cartes += r.get("data", [])
        r = get(r["next_page"]) if r.get("has_more") else None
    res = []
    for c in cartes:
        eur = c.get("prices", {}).get("eur")
        # même carte seulement : « Naktamun Lorespinner // Wheel of Fortune » (2026) n'est pas Wheel of Fortune
        meme = c["name"].split(" // ")[0] == nom.split(" // ")[0]
        if eur and prix_fiable(c) and meme:
            res.append((float(eur), c["set_name"], c.get("purchase_uris", {}).get("cardmarket", "")))
    game_changer = any(c.get("game_changer") for c in cartes)
    return sorted(res), game_changer


def main(noms):
    total = 0.0
    game_changers = []
    for saisi in noms:
        nom = nom_anglais(saisi)
        if not nom:
            print(f"? {saisi} : carte introuvable")
            continue
        prix, gc = impressions(nom)
        if gc:
            game_changers.append(nom)
        if not prix:
            print(f"? {nom} : aucun prix en euros connu")
            continue
        mini, edition, lien = prix[0]
        total += mini
        alerte = "  <-- AU-DESSUS DE 5 EUR" if mini > BUDGET else ""
        alerte += "  [GAME CHANGER]" if gc else ""
        print(f"{nom} : {mini:.2f} EUR minimum ({edition}){alerte}")
        if len(prix) > 1:
            autres = ", ".join(f"{p:.2f} ({e})" for p, e, _ in prix[1:4])
            print(f"    autres éditions : {autres}")
        print(f"    {lien.split('&referrer')[0].replace('/en/', '/fr/')}")
    if len(noms) > 1:
        print(f"\nTotal (édition la moins chère de chaque carte) : {total:.2f} EUR")
        print(f"Game Changers : {len(game_changers)}"
              + (f" ({', '.join(game_changers)})" if game_changers else "")
              + " -- brackets 1-2 : 0 autorisé, bracket 3 : 3 max")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        print(__doc__)
    else:
        main(sys.argv[1:])
