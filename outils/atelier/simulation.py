"""Simulations lancées depuis l'Atelier : en tâche de fond, sur plusieurs cœurs, avec une progression.

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
DOSSIER = "simulations"
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


# ---------------------------------------------------------------- dans les processus de calcul
def _deck(chemin):
    cle = (chemin, os.path.getmtime(chemin))
    if cle not in _cache_w:
        from simu_cartes import construire, lire_liste
        cmd, L = lire_liste(chemin)
        C, _ = construire(L, cmd)
        _cache_w[cle] = (C, cmd, L)
    return _cache_w[cle]


def _morceau(chemin, nom_table, debut, n, reglages):
    from simu import serie
    C, cmd, L = _deck(chemin)
    return serie(C, cmd, L, nom_table, n, reglages.get("pilote", "vite"), reglages, debut)


# ---------------------------------------------------------------- réglages de jeu du deck (pilote.json)
def lire_reglages(deck):
    p = os.path.join(decks.RACINE, deck, "pilote.json")
    r = reglages_defaut()
    if os.path.exists(p):
        r.update(json.load(open(p, encoding="utf-8")))
    return r


def ecrire_reglages(deck, r):
    defaut = reglages_defaut()
    propre = {k: r[k] for k in defaut if k in r}
    json.dump(propre, open(os.path.join(decks.RACINE, deck, "pilote.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return {**defaut, **propre}


# ---------------------------------------------------------------- lancement et suivi
def _sans_nan(x):
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    if isinstance(x, dict):
        return {str(k): _sans_nan(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_sans_nan(v) for v in x]
    return x


def _couverture(chemin):
    from simu_cartes import construire, couverture, lire_liste
    cmd, L = lire_liste(chemin)
    C, cov = construire(L, cmd)
    return {k: cov[k] for k in ("partiel", "corps", "sans_effet")}


def lancer(deck, a, b, tables, n, reglages):
    """a, b : fichiers de version (vide = liste actuelle ; b None = pas de comparaison)."""
    global _pool
    tables = [t for t in tables if t in tables_dispo()] or ["Mixte"]
    n = max(10, min(int(n), 20000))
    job = dict(id=uuid.uuid4().hex[:8], deck=deck, statut="en_cours", fait=0, total=n * len(tables) * (2 if b is not None else 1),
               debut=time.time(), erreur=None, rapport=None, annule=False)
    with _verrou:
        _jobs[job["id"]] = job
        if _pool is None:
            _pool = ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 2) - 1))
    threading.Thread(target=_execute, args=(job, deck, a, b, tables, n, reglages), daemon=True).start()
    return job


def _execute(job, deck, a, b, tables, n, reglages):
    try:
        from simu import ecart, resume
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        base = os.path.join(decks.RACINE, deck, DOSSIER)
        os.makedirs(os.path.join(base, "listes"), exist_ok=True)
        versions = [("A", a)] + ([("B", b)] if b is not None else [])
        figees, infos_v = {}, {}
        for cle, fichier in versions:
            texte = open(decks.chemin_version(deck, fichier), encoding="utf-8").read()
            p = os.path.join(base, "listes", f"{stamp}_{cle}.txt")
            open(p, "w", encoding="utf-8", newline="\n").write(texte)
            figees[cle] = p
            infos_v[cle] = dict(fichier=fichier, nom=decks.libelle(deck, fichier), liste=f"{DOSSIER}/listes/{stamp}_{cle}.txt",
                                couverture=_couverture(p))
        futurs = {}
        for cle, _ in versions:
            for t in tables:
                for d in range(0, n, MORCEAU):
                    f = _pool.submit(_morceau, figees[cle], t, d, min(MORCEAU, n - d), reglages)
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
                ligne[cle] = resume(par[cle])
            if b is not None:
                m, ic = ecart(par["A"], par["B"])
                ligne["ecart"] = dict(m=m, ic=ic)
            res[t] = ligne
        rapport = _sans_nan(dict(date=datetime.now().isoformat(timespec="seconds"), deck=deck, n=n, tables=tables, reglages=reglages,
                                 versions=infos_v, resultats=res, duree=round(time.time() - job["debut"], 1)))
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
                t0 = "Mixte" if "Mixte" in r["tables"] else r["tables"][0]
                ligne = r["resultats"][t0]
                out.append(dict(fichier=f, date=r["date"], n=r["n"], tables=r["tables"], pilote=r["reglages"].get("pilote", "vite"),
                                versions={k: v["nom"] for k, v in r["versions"].items()}, table_resume=t0,
                                victoire_a=ligne["A"]["victoire"], victoire_b=(ligne.get("B") or {}).get("victoire"),
                                ecart=ligne.get("ecart")))
    return out


def rapport(deck, fichier):
    p = os.path.normpath(os.path.join(decks.RACINE, deck, DOSSIER, fichier))
    if not p.startswith(os.path.join(decks.RACINE, deck, DOSSIER)):
        raise ValueError("rapport hors du deck")
    return json.load(open(p, encoding="utf-8"))
