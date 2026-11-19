"""Le rapport d'une simulation, le même sur le PC (atelier/simulation.py) et dans le navigateur (simu_navigateur.py) :
ce que le simulateur comprend d'une liste, puis les résultats de chaque version sur chaque table."""
import math

from simu import ecart, regularite, resume


def couverture(C, cov, L, txt=None, detail=False):
    """Cartes jouables (hors terrains et commandants) : combien le simulateur en comprend, et lesquelles il lit mal.
    C, cov : ce que renvoie simu_cartes.construire ; L : les autres cartes de la liste. detail : pour Claude, chaque carte
    mal lue avec ses lignes non comprises."""
    jouables = {n for n in set(L) if not C[n]["terrain"]}
    mal = {k: sorted(n for n in cov[k] if n in jouables) for k in ("partiel", "corps", "sans_effet")}
    r = dict(mal, affinee=sorted(n for n in cov["affinee"] if n in jouables), total=len(jouables),
             comprises=len(jouables) - sum(len(v) for v in mal.values()))
    if detail:
        r["non_lu"] = {n: C[n]["non_lu"] for v in mal.values() for n in v}
        r["perso_non_lu"] = {n: C[n]["non_lu"] for n in (txt or {}) if n in C and C[n]["non_lu"]}
        r["inconnues"] = sorted(n for n in (txt or {}) if n not in C)
    return r


def resultats(par, mv, tables, cles):
    """par : {(version, table): parties, dans l'ordre des graines} ; mv : {version: valeur de mana du commandant}.
    Renvoie {table: {A: {…, regularite}, B: …, ecart: {m, ic}}} (écart seulement avec deux versions)."""
    res = {}
    for t in tables:
        ligne = {cle: dict(resume(par[(cle, t)]), regularite=regularite(par[(cle, t)], mv[cle])) for cle in cles}
        if "B" in cles:
            m, ic = ecart(par[("A", t)], par[("B", t)])
            ligne["ecart"] = dict(m=m, ic=ic)
        res[t] = ligne
    return res


def sans_nan(x):
    """NaN et infini deviennent null : le rapport reste du JSON valide."""
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    if isinstance(x, dict):
        return {str(k): sans_nan(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [sans_nan(v) for v in x]
    return x
