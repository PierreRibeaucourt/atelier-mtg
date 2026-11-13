"""La base de cartes de l'appli du téléphone : celle de la recherche du PC (recherche.py), allégée, publiée avec l'appli.

    python outils/atelier/base_telephone.py <dossier>        (le dossier base/ du site du téléphone)

Refait d'abord la base si besoin, comme l'Atelier (recherche.verifier : chaque semaine, ou dès qu'une édition a de
nouvelles cartes ; base_cartes.json.gz, gardé d'une fois sur l'autre par le dépôt qui publie l'appli), puis écrit
<dossier>/cartes-<empreinte>.json.gz et <dossier>/index.json ({format, fichier, date, taille, nb}). Le téléphone la
télécharge une fois, puis seulement quand elle change (static/telephone/cartes.js la lit et y cherche).

Allégée : les champs vides ne sont pas écrits, ni l'identifiant Oracle ; chaque impression garde l'identifiant de son
image chez Scryfall au lieu de son chemin ; les descriptions des fonctions sont raccourcies.
"""
import gzip
import hashlib
import json
import os
import re
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [ICI, os.path.dirname(ICI)]
FORMAT = 1                          # static/telephone/cartes.js › FORMAT
GARDER = ("n", "c", "mv", "t", "o", "co", "ci", "p", "e", "l", "pt", "lay", "lg", "gc", "rk", "spe", "fr", "tf", "of", "eur",
          "foil", "s0", "d0", "dig", "fun", "ts", "im", "imd", "tg", "cm", "pa", "cl", "pm")
IMAGE = re.compile(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg")


def _image(chemin):
    m = IMAGE.search(chemin or "")
    return m.group(1) if m else ""


def _nombre(v):
    return int(v) if isinstance(v, float) and v.is_integer() else v


def alleger(b):
    cartes = []
    for x in b["cartes"]:
        y = {}
        for k in GARDER:
            v = x.get(k)
            if v is None or v == "" or v == [] or v is False or (k in ("mv", "im") and v == 0):
                continue
            y[k] = _nombre(v)
        y["pr"] = [[p[0], p[1], p[2], p[3], p[4], _image(p[5]), p[6], p[7], *p[8:9]] for p in x["pr"]]
        if y["pr"] == []:
            del y["pr"]
        cartes.append(y)
    tags = [dict(s=t["s"], **({"d": t["d"][:100]} if t.get("d") else {}), **({"e": t["e"]} if t.get("e") else {})) for t in b["tags"]]
    return dict(format=FORMAT, date=b["date"], date_fr=b.get("date_fr"), cartes=cartes, tags=tags, editions=b["editions"])


def ecrire(b, dossier):
    os.makedirs(dossier, exist_ok=True)
    donnees = json.dumps(alleger(b), ensure_ascii=False, separators=(",", ":")).encode()
    gz = gzip.compress(donnees, compresslevel=9, mtime=0)
    nom = f"cartes-{hashlib.sha1(gz).hexdigest()[:12]}.json.gz"
    with open(os.path.join(dossier, nom), "wb") as f:
        f.write(gz)
    index = dict(format=FORMAT, fichier=nom, date=b["date"], taille=len(gz), nb=len(b["cartes"]))
    with open(os.path.join(dossier, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f)
    return index


if __name__ == "__main__":
    import recherche
    sys.stdout.reconfigure(encoding="utf-8")
    b0 = recherche.base() or {}
    avant = b0.get("date")
    # base d'avant les drapeaux des impressions (recherche.py, p[8]) : refaite tout de suite, sans attendre la semaine
    sans_drapeaux = any(len(p) < 9 for x in (b0.get("cartes") or [])[:500] for p in x["pr"])
    try:
        recherche.construire() if sans_drapeaux else recherche.verifier()
    except Exception as e:                     # Scryfall injoignable : la base d'avant fera l'affaire
        recherche.etat["erreur"] = str(e)
    if recherche.etat["erreur"]:
        print("base :", recherche.etat["erreur"])
    b = recherche._lire_fichier()
    if not b:
        print("pas de base de cartes : l'appli est publiée sans elle")
        sys.exit(0)
    i = ecrire(b, os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "base"))
    print(f"{i['fichier']} : {i['nb']} cartes, {i['taille'] // 1024} Ko" + (" (refaite)" if b["date"] != avant else ""))
    if os.environ.get("GITHUB_OUTPUT"):        # la recette ne garde la base pour la fois suivante que si elle a changé
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"refaite={'oui' if b['date'] != avant else 'non'}\n")
