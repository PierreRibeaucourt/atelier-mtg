"""Simulations lancées depuis l'Atelier : en tâche de fond, sur plusieurs cœurs, avec une progression.

Deux usages :
- « Tester le deck » (sans IA) : la liste actuelle, table Mixte, TEST_N parties ; le rapport dit si le deck est régulier
  (simu.regularite : mana, cartes jouées, board, commandant), sans taux de victoire, qui n'a de sens que si le simulateur
  comprend les cartes ;
- avec Claude : il décrit les cartes mal lues et le plan de jeu dans <deck>/simulateur.json (voir
  connaissances/simulateur.md), lance des tests (demander.py simuler) et compare des versions ; le rapport est alors
  « affiné » et montre aussi les victoires.
On compare une version A (souvent la liste actuelle) à une version B facultative, sur les mêmes graines : les deux listes
affrontent exactement les mêmes adversaires, comme `outils/simu.py`. Les listes simulées sont figées au lancement
(copie dans simulations/listes/) et le rapport est gardé dans simulations/AAAA-MM-JJ_HHMMSS.json.
"""
import json
import math
import os
import sys
import threading
import time
import uuid
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime

ICI = os.path.dirname(os.path.abspath(__file__))
OUTILS = os.path.dirname(ICI)
for p in (ICI, OUTILS):
    if p not in sys.path:
        sys.path.insert(0, p)

import decks  # noqa: E402

MORCEAU = 50                 # parties par tâche envoyée à un cœur
TEST_N = 1000                # « Tester le deck » : quelques secondes
DOSSIER = "simulations"
FICHIER = "simulateur.json"  # dans le dossier du deck : {"reglages": {...}, "cartes": {carte: texte}}, écrit par Claude
ANCIEN = "pilote.json"       # l'ancien fichier des réglages, encore lu
_jobs = {}
_pool = None
_verrou = threading.Lock()
_cache_w = {}                # dans chaque processus de calcul : deck déjà construit


def tables_dispo():
    from simu_adversaires import ARCHETYPES
    return list(ARCHETYPES) + ["Mixte"]


def reglages_defaut():
    from simu_moteur import REGLAGES_DEFAUT
    return dict(REGLAGES_DEFAUT)


# ---------------------------------------------------------------- ce que le deck apprend au simulateur (simulateur.json)
def _fichier(deck):
    p = os.path.join(decks.RACINE, deck, FICHIER)
    try:
        d = json.load(open(p, encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def textes(deck):
    """{carte: texte} : les cartes décrites pour ce deck."""
    c = _fichier(deck).get("cartes")
    return {k: v for k, v in c.items() if isinstance(k, str) and isinstance(v, str) and v.strip()} if isinstance(c, dict) else {}


def lire_reglages(deck):
    r = reglages_defaut()
    d = _fichier(deck).get("reglages")
    if not isinstance(d, dict):
        try:
            d = json.load(open(os.path.join(decks.RACINE, deck, ANCIEN), encoding="utf-8"))
        except (OSError, ValueError):
            d = {}
    r.update({k: v for k, v in d.items() if k in r})
    return r


def ecrire_reglages(deck, r):
    defaut = reglages_defaut()
    propre = {k: r[k] for k in defaut if k in r and r[k] != defaut[k]}
    d = _fichier(deck)
    if propre:
        d["reglages"] = propre
    else:
        d.pop("reglages", None)
    p = os.path.join(decks.RACINE, deck, FICHIER)
    if d:
        json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    elif os.path.exists(p):
        os.remove(p)
    return {**defaut, **propre}


# ---------------------------------------------------------------- dans les processus de calcul
def _deck(chemin, txt=None):
    cle = (chemin, os.path.getmtime(chemin), json.dumps(txt or {}, sort_keys=True))
    if cle not in _cache_w:
        from simu_cartes import construire, lire_liste
        cmd, part, L = lire_liste(chemin, partenaire=True)
        C, _ = construire(L, cmd, part, txt)
        _cache_w[cle] = (C, cmd, L, part)
    return _cache_w[cle]


def _morceau(chemin, nom_table, debut, n, reglages, txt=None):
    from simu import serie
    C, cmd, L, part = _deck(chemin, txt)
    if part:
        reglages = {**reglages, "partenaire": part}
    return serie(C, cmd, L, nom_table, n, reglages.get("pilote", "vite"), reglages, debut)


# ---------------------------------------------------------------- ce que le simulateur comprend d'une liste
def _couverture(chemin, txt=None, detail=False):
    """Cartes jouables (hors terrains et commandants) : combien le simulateur en comprend, et lesquelles il lit mal.
    detail : pour Claude, chaque carte mal lue avec ses lignes non comprises."""
    from simu_cartes import construire, couverture, lire_liste
    cmd, part, L = lire_liste(chemin, partenaire=True)
    C, cov = construire(L, cmd, part, txt)
    jouables = {n for n in set(L) if not C[n]["terrain"]}
    mal = {k: sorted(n for n in cov[k] if n in jouables) for k in ("partiel", "corps", "sans_effet")}
    r = dict(mal, affinee=sorted(n for n in cov["affinee"] if n in jouables), total=len(jouables),
             comprises=len(jouables) - sum(len(v) for v in mal.values()))
    if detail:
        r["non_lu"] = {n: C[n]["non_lu"] for v in mal.values() for n in v}
        r["perso_non_lu"] = {n: C[n]["non_lu"] for n in (txt or {}) if n in C and C[n]["non_lu"]}
        r["inconnues"] = sorted(n for n in (txt or {}) if n not in C)
    return r


def couverture_deck(deck, detail=False):
    return _couverture(decks.chemin(deck), textes(deck), detail)


# ---------------------------------------------------------------- lancement et suivi
def _sans_nan(x):
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    if isinstance(x, dict):
        return {str(k): _sans_nan(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_sans_nan(v) for v in x]
    return x


def lancer(deck, a, b, tables, n, reglages=None):
    """a, b : fichiers de version (vide = liste actuelle ; b None = pas de comparaison). Les réglages du deck
    (simulateur.json) s'appliquent ; ceux passés ici les complètent."""
    global _pool
    tables = [t for t in tables if t in tables_dispo()] or ["Mixte"]
    n = max(10, min(int(n), 20000))
    reglages = {**lire_reglages(deck), **{k: v for k, v in (reglages or {}).items() if k in reglages_defaut()}}
    txt = textes(deck)
    job = dict(id=uuid.uuid4().hex[:8], deck=deck, statut="en_cours", fait=0, total=n * len(tables) * (2 if b is not None else 1),
               debut=time.time(), erreur=None, rapport=None, annule=False)
    with _verrou:
        _jobs[job["id"]] = job
        if _pool is None:
            _pool = ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 2) - 1))
    threading.Thread(target=_execute, args=(job, deck, a, b, tables, n, reglages, txt), daemon=True).start()
    return job


def _execute(job, deck, a, b, tables, n, reglages, txt):
    try:
        from simu import ecart, regularite, resume
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        base = os.path.join(decks.RACINE, deck, DOSSIER)
        os.makedirs(os.path.join(base, "listes"), exist_ok=True)
        versions = [("A", a)] + ([("B", b)] if b is not None else [])
        figees, infos_v, mv = {}, {}, {}
        for cle, fichier in versions:
            texte = open(decks.chemin_version(deck, fichier), encoding="utf-8").read()
            p = os.path.join(base, "listes", f"{stamp}_{cle}.txt")
            open(p, "w", encoding="utf-8", newline="\n").write(texte)
            figees[cle] = p
            infos_v[cle] = dict(fichier=fichier, nom=decks.libelle(deck, fichier), liste=f"{DOSSIER}/listes/{stamp}_{cle}.txt",
                                couverture=_couverture(p, txt))
            C, cmd, _, _ = _deck(p, txt)
            mv[cle] = C[cmd]["mv"]
        futurs = {}
        for cle, _ in versions:
            for t in tables:
                for d in range(0, n, MORCEAU):
                    f = _pool.submit(_morceau, figees[cle], t, d, min(MORCEAU, n - d), reglages, txt)
                    futurs[f] = (cle, t, d)
        brut = {}
        for f in list(futurs):
            if job["annule"]:
                for g in futurs:
                    g.cancel()
                job["statut"] = "annule"
                return
            r = f.result()
            brut[futurs[f]] = r
            job["fait"] += len(r)
        res = {}
        for t in tables:
            ligne = {}
            par = {cle: [x for d in range(0, n, MORCEAU) for x in brut[(cle, t, d)]] for cle, _ in versions}
            for cle, _ in versions:
                ligne[cle] = dict(resume(par[cle]), regularite=regularite(par[cle], mv[cle]))
            if b is not None:
                m, ic = ecart(par["A"], par["B"])
                ligne["ecart"] = dict(m=m, ic=ic)
            res[t] = ligne
        rapport = _sans_nan(dict(date=datetime.now().isoformat(timespec="seconds"), deck=deck, n=n, tables=tables, reglages=reglages,
                                 affine=bool(txt), versions=infos_v, resultats=res, duree=round(time.time() - job["debut"], 1)))
        nom = f"{stamp}.json"
        json.dump(rapport, open(os.path.join(base, nom), "w", encoding="utf-8"), ensure_ascii=False)
        job.update(statut="fini", rapport=nom)
    except Exception as e:
        job.update(statut="erreur", erreur=f"{type(e).__name__} : {e}")


def suivi(id_):
    j = _jobs.get(id_)
    if not j:
        return None
    ecoule = time.time() - j["debut"]
    reste = ecoule / j["fait"] * (j["total"] - j["fait"]) if j["fait"] else None
    return {k: v for k, v in j.items() if k != "annule"} | dict(ecoule=round(ecoule), reste=round(reste) if reste else None)


def annuler(id_):
    if id_ in _jobs:
        _jobs[id_]["annule"] = True


def table_resume(r):
    return "Mixte" if "Mixte" in r["tables"] else r["tables"][0]


def rapports(deck):
    base = os.path.join(decks.RACINE, deck, DOSSIER)
    out = []
    if os.path.isdir(base):
        for f in sorted(os.listdir(base), reverse=True):
            if f.endswith(".json"):
                try:
                    r = json.load(open(os.path.join(base, f), encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                t0 = table_resume(r)
                ligne = r["resultats"][t0]
                out.append(dict(fichier=f, date=r["date"], n=r["n"], tables=r["tables"], pilote=r["reglages"].get("pilote", "vite"),
                                versions={k: v["nom"] for k, v in r["versions"].items()}, table_resume=t0, affine=r.get("affine", True),
                                verdict=(ligne["A"].get("regularite") or {}).get("verdict"),
                                verdict_b=((ligne.get("B") or {}).get("regularite") or {}).get("verdict"),
                                victoire_a=ligne["A"]["victoire"], victoire_b=(ligne.get("B") or {}).get("victoire"),
                                ecart=ligne.get("ecart")))
    return out


def effacer_anciens():
    """Efface les rapports d'avant les jauges de régularité (version 1.7), avec leurs listes figées."""
    for deck in decks.dossiers():
        base = os.path.join(decks.RACINE, deck, DOSSIER)
        if not os.path.isdir(base):
            continue
        for f in os.listdir(base):
            if not f.endswith(".json"):
                continue
            try:
                r = json.load(open(os.path.join(base, f), encoding="utf-8"))
                if r["resultats"][table_resume(r)]["A"].get("regularite"):
                    continue
            except (OSError, ValueError, KeyError, IndexError, TypeError):
                continue
            stamp = f[:-5]
            for p in [f] + [f"listes/{stamp}_{cle}.txt" for cle in "AB"]:
                try:
                    os.remove(os.path.join(base, p))
                except OSError:
                    pass


def rapport(deck, fichier):
    p = os.path.normpath(os.path.join(decks.RACINE, deck, DOSSIER, fichier))
    if not p.startswith(os.path.join(decks.RACINE, deck, DOSSIER)):
        raise ValueError("rapport hors du deck")
    return json.load(open(p, encoding="utf-8"))
