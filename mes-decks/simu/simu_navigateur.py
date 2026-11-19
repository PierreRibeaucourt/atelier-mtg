"""Le simulateur dans le navigateur (Pyodide), pour l'appli : la même chose que atelier/simulation.py, sans processus ni
réseau. static/telephone/simulateur.js (un Worker) s'en sert ainsi :
1. preparer(listes, fiches) : les listes à simuler {version: texte} et les fiches déjà gardées ; renvoie les cartes
   dont il manque la fiche ;
2. ranger(bloc, cartes) : les fiches reçues de Scryfall (l'appli fait les requêtes, comme simu_cartes.fiches) ;
3. construire(textes) : les decks, ce que le simulateur en comprend (couverture) ;
4. morceau(version, table, debut, n) : n parties à partir de la graine debut, comme simulation._morceau (l'appli suit
   la progression et peut annuler entre deux morceaux) ;
5. rapport(…) : le rapport, comme simulation._execute ; fiches() : les fiches à garder pour la fois suivante.
Mêmes listes, mêmes graines, mêmes fiches : mêmes parties que sur le PC.
"""
import json
import os

import simu_cartes
from simu import serie
from simu_cartes import construire as construire_cartes, lire_liste
from simu_rapport import couverture, resultats, sans_nan

DOSSIER = os.path.dirname(os.path.abspath(__file__))
_cache = {}           # {nom demandé: fiche} : comme cache_cartes.json
_listes = {}          # {version: chemin de la liste}
_decks = {}           # {version: (C, cmd, L, partenaire)}
_parties = {}         # {(version, table, debut): parties}


class CarteInconnue(Exception):
    pass


def _fiches(noms):
    """simu_cartes.fiches, sans réseau : les fiches viennent de l'appli."""
    manque = sorted({n for n in noms if n not in _cache})
    if manque:
        raise CarteInconnue("Carte inconnue de Scryfall : " + ", ".join(manque[:5]))
    return _cache


simu_cartes.fiches = _fiches


def preparer(listes_json, fiches_json):
    _listes.clear()
    _decks.clear()
    _parties.clear()
    _cache.clear()
    _cache.update(json.loads(fiches_json or "{}"))
    noms = set()
    for cle, texte in json.loads(listes_json).items():
        p = os.path.join(DOSSIER, f"liste_{cle}.txt")
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write(texte)
        _listes[cle] = p
        cmd, part, L = lire_liste(p, partenaire=True)
        if not cmd:
            raise CarteInconnue("Ce deck n'a pas de commandant.")
        noms.update(L, [cmd] + ([part] if part else []))
    return json.dumps(sorted(n for n in noms if n not in _cache))


def ranger(bloc_json, cartes_json):
    simu_cartes.ranger(_cache, json.loads(bloc_json), json.loads(cartes_json))


def construire(textes_json):
    """Les decks de chaque version ; renvoie {version: {couverture, mv}}."""
    txt = json.loads(textes_json or "{}")
    r = {}
    for cle, p in _listes.items():
        cmd, part, L = lire_liste(p, partenaire=True)
        C, cov = construire_cartes(L, cmd, part, txt)
        _decks[cle] = (C, cmd, L, part)
        r[cle] = dict(couverture=couverture(C, cov, L, txt), mv=C[cmd]["mv"])
    return json.dumps(r)


def morceau(cle, table, debut, n, reglages_json):
    C, cmd, L, part = _decks[cle]
    reglages = json.loads(reglages_json)
    if part:
        reglages = {**reglages, "partenaire": part}
    _parties[(cle, table, debut)] = serie(C, cmd, L, table, n, reglages.get("pilote", "vite"), reglages, debut)
    return len(_parties[(cle, table, debut)])


def rapport(entete_json, mv_json, morceau_n):
    """entete : {date, deck, n, tables, reglages, affine, versions, duree} ; le reste vient des parties jouées."""
    e = json.loads(entete_json)
    mv, n, tables = json.loads(mv_json), e["n"], e["tables"]
    cles = list(e["versions"])
    par = {(cle, t): [x for d in range(0, n, morceau_n) for x in _parties[(cle, t, d)]] for cle in cles for t in tables}
    return json.dumps(sans_nan(dict(e, resultats=resultats(par, mv, tables, cles))), ensure_ascii=False)


def fiches():
    return json.dumps(_cache, ensure_ascii=False)
