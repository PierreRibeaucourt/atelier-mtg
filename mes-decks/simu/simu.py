"""Simulateur Commander : compare une ou plusieurs listes contre des tables d'adversaires-archétypes.

Exemples :
  python outils/simu.py "Deck Kels/archidekt.txt" "Deck Kels/liste_avant_refonte.txt"
  python outils/simu.py "Deck Greven Elemental/archidekt.txt" --tables Jetons Contrôle Mixte -n 5000
  python outils/simu.py "Deck Malfegor/liste.txt" --couverture        (seulement : quelles cartes le moteur comprend)
  python outils/simu.py "Deck Greven Elemental/archidekt.txt" --pilote salve   (garde ses créatures pour un gros tour)

Formats de liste acceptés : export Archidekt « 1x Nom [Tags] » (commandant tagué [Commander]),
ou « 1 Nom » avec « SB: 1 Commandant ».
Chaque table = 3 adversaires du même archétype, ou « Mixte » (3 archétypes différents tirés au hasard à chaque partie).
Les listes sont jouées avec les mêmes graines : elles affrontent exactement les mêmes adversaires, ce qui rend la
comparaison beaucoup plus précise que deux séries indépendantes.
Archétypes et leurs réglages : outils/simu_adversaires.py. Cartes écrites à la main : COMPORTEMENTS dans simu_cartes.py.
"""
import argparse
import math
import os
import random
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from simu_adversaires import ARCHETYPES  # noqa: E402
from simu_cartes import construire, lire_liste  # noqa: E402
from simu_moteur import T_MAX, Partie  # noqa: E402

LIBELLES = {"affinee": "décrites pour ce deck (simulateur.json)", "specifique": "écrites à la main", "auto": "lues automatiquement", "partiel": "lues en partie",
            "corps": "créatures sans effet compris (jouées comme simples corps)", "sans_effet": "sorts sans effet compris"}


def table(nom, graine):
    if nom != "Mixte":
        return [nom] * 3
    return random.Random(f"{graine}-table").sample(sorted(ARCHETYPES), 3)


def serie(C, cmd, deck, nom_table, n, pilote="vite", reglages=None, debut=0):
    """Parties de graines debut..debut+n-1 contre la table nom_table."""
    return [Partie(C, cmd, deck, table(nom_table, g), g, pilote, reglages).jouer() for g in range(debut, debut + n)]


def resume(res):
    n = len(res)
    r = Counter(x["resultat"] for x in res)
    causes = Counter(x["cause"] for x in res if x["resultat"] == "defaite")
    fin = [x["tour"] for x in res if x["resultat"] != "pas_finie"]

    def moy_suivi(t, cle):
        v = [x["suivi"][t][cle] for x in res if t in x["suivi"]]
        return sum(v) / len(v) if v else float("nan")

    def somme(prefixe):
        cles = {k for x in res for k in x["stat"] if k.startswith(prefixe)}
        return {k[len(prefixe):]: sum(x["stat"][k] for x in res) / n for k in cles}
    return dict(n=n, victoire=r["victoire"] / n, defaite=r["defaite"] / n, pas_finie=r["pas_finie"] / n,
                causes={k: v / n for k, v in causes.items()}, tour_fin=sum(fin) / len(fin) if fin else float("nan"),
                cmd4=sum(1 for x in res if x["cmd"] and x["cmd"] <= 4) / n, cmd5=sum(1 for x in res if x["cmd"] and x["cmd"] <= 5) / n,
                crea6=moy_suivi(6, "crea_adv"), crea8=moy_suivi(8, "crea_adv"), pv8=moy_suivi(8, "pv"),
                stat={k: sum(x["stat"][k] for x in res) / n for k in ("cmd_mort", "cmd_sauve", "star_detruite", "rase_subi",
                                                                       "cimetiere_exile", "contre_subi", "je_contre", "greven_pioche",
                                                                       "pioche_clamp", "salves", "defausse_fin")},
                degats=somme("dmg_"), elim=somme("elim_"), pertes=somme("perdu_"))


def ecart(ra, rb):
    """Écart de victoires A - B sur les mêmes graines, avec son intervalle à 95 %."""
    d = [(x["resultat"] == "victoire") - (y["resultat"] == "victoire") for x, y in zip(ra, rb)]
    m = sum(d) / len(d)
    sd = math.sqrt(sum((v - m) ** 2 for v in d) / (len(d) - 1)) if len(d) > 1 else 0
    return m, 1.96 * sd / math.sqrt(len(d))


# ---------------------------------------------------------------- régularité : le test sans IA
# Ce que le deck fait de ses cartes, sans juger qui gagne. Le mana, les cartes jouées et l'arrivée du commandant ne
# dépendent que des coûts et des terrains : ils valent même pour un deck dont le simulateur lit mal les cartes. Le board
# (le tien, celui des adversaires) dépend aussi de ce que font les cartes : il gagne à être affiné avec Claude.
# Seuils : niveau « bon » au-delà du premier, « juste » au-delà du second, sinon « alerte ».
SEUILS = dict(terrains4=(0.75, 0.62), couleur=(0.10, 0.20), vides=(0.6, 1.2), usage=(0.80, 0.70), defausse=(0.30, 0.50),
              permanents8=(5.0, 3.5), tues=(5.0, 2.5), commandant=(0.80, 0.60))
PLUS_BAS = {"couleur", "vides", "defausse"}            # pour ceux-là, moins c'est mieux


def _moy(v):
    v = list(v)
    return sum(v) / len(v) if v else None


def _niveau(cle, v):
    if v is None:
        return None, None
    bon, juste = SEUILS[cle]
    if cle in PLUS_BAS:                    # même échelle que les autres : on retourne les valeurs
        v, bon, juste = -v, -bon, -juste
    niveau = "bon" if v >= bon else "juste" if v >= juste else "alerte"
    # position sur la jauge, de 0 à 1 : « alerte » sous 0,4, « juste » de 0,4 à 0,7, « bon » au-delà
    pas = abs(bon - juste) or 1
    if v >= bon:
        place = 0.7 + 0.3 * min(1, (v - bon) / pas)
    elif v >= juste:
        place = 0.4 + 0.3 * (v - juste) / pas
    else:
        place = max(0.05, 0.4 - 0.4 * min(1, (juste - v) / (2 * pas)))
    return niveau, round(place, 3)


def _pct(x):
    return f"{round(x * 100)} %"


def _nb(x):
    return f"{x:.1f}".replace(".", ",").replace(",0", "")


def _s(x):
    return "s" if x >= 2 else ""


def regularite(res, mv_cmd):
    """Indicateurs de régularité d'une série de parties : {verdict, indicateurs, constats, mesures}.
    mv_cmd : valeur de mana du commandant (il est « à l'heure » s'il arrive au plus tard au tour mv + 1)."""
    def suivi(t, cle):
        return [x["suivi"][t][cle] for x in res if t in x["suivi"] and cle in x["suivi"][t]]

    a_lheure = mv_cmd + 1
    m = dict(
        terrains4=_moy(v >= 4 for v in suivi(4, "terrains")),
        couleur=_moy(x["suivi"][t]["couleur"] for x in res for t in range(2, 7) if t in x["suivi"] and "couleur" in x["suivi"][t]),
        mulligans=_moy(x["stat"].get("mulligans", 0) >= 2 for x in res),
        vides=_moy(sum(1 for t in range(2, 8) if t in x["suivi"] and x["suivi"][t].get("joues") == 0) for x in res),
        usage=(lambda d: sum(x["stat"].get(f"depense{t}", 0) for x in res for t in range(1, 7)) / d if d else None)(
            sum(x["stat"].get(f"dispo{t}", 0) for x in res for t in range(1, 7))),
        defausse=_moy(x["stat"].get("defausse_fin", 0) > 0 for x in res),
        permanents8=_moy(suivi(8, "perms")),
        creatures8=_moy(suivi(8, "creas")),
        morts_moi=_moy(x["stat"].get("morts_moi", 0) for x in res),
        tues=_moy(x["stat"].get("tues_moi", 0) for x in res),
        crea_adv8=_moy(suivi(8, "crea_adv")),
        commandant=_moy(bool(x["cmd"] and x["cmd"] <= a_lheure) for x in res),
        cmd_tour=_moy(x["cmd"] for x in res if x["cmd"]),
        cmd_mort=_moy(x["stat"].get("cmd_mort", 0) for x in res),
    )
    N = {k: _niveau(k, m[k]) for k in SEUILS}
    courts = dict(                                       # la valeur affichée à côté de la jauge
        terrains4=lambda v: f"4 terrains au tour 4 : {_pct(v)}", couleur=lambda v: f"couleur manquante : {_pct(v)} des tours",
        vides=lambda v: f"tours sans rien jouer : {_nb(v)}", usage=lambda v: f"mana utilisé : {_pct(v)}",
        defausse=lambda v: f"main pleine : {_pct(v)} des parties", permanents8=lambda v: f"{_nb(v)} permanent{_s(v)} au tour 8",
        tues=lambda v: f"{_nb(v)} créature{_s(v)} détruite{_s(v)} par partie", commandant=lambda v: f"au tour {a_lheure} : {_pct(v)}")

    def indicateur(cle, titre, *mesures):
        connues = [c for c in mesures if N[c][0]]
        if not connues:
            return dict(cle=cle, titre=titre, niveau=None, place=None, valeur="")
        c = min(connues, key=lambda c: N[c][1])              # la mesure la plus faible fait le niveau…
        v = connues[0] if N[c][0] == "bon" else c            # … et la valeur, sauf si tout va bien : la mesure principale
        return dict(cle=cle, titre=titre, niveau=N[c][0], place=N[c][1], valeur=courts[v](m[v]))

    indicateurs = [indicateur("mana", "Mana", "terrains4", "couleur"),
                   indicateur("cartes", "Cartes jouées", "vides", "usage", "defausse"),
                   indicateur("board", "Ton board", "permanents8"),
                   indicateur("adverse", "Board adverse", "tues"),
                   indicateur("commandant", "Commandant", "commandant")]
    alertes = sum(1 for i in indicateurs if i["niveau"] == "alerte")
    justes = sum(1 for i in indicateurs if i["niveau"] == "juste")
    verdict = "irregulier" if alertes >= 2 else "a_peaufiner" if alertes or justes >= 3 else "regulier"
    # ce qui cloche : les mesures en alerte d'abord, puis les justes, puis les signes à part ; trois au plus
    textes = dict(
        terrains4=lambda v: f"4 terrains au tour 4 dans {_pct(v)} des parties",
        couleur=lambda v: f"Une couleur manque pour jouer ta main dans {_pct(v)} des tours",
        vides=lambda v: f"{_nb(v)} tour{_s(v)} sans rien jouer entre les tours 2 et 7",
        usage=lambda v: f"{_pct(v)} du mana utilisé jusqu'au tour 6",
        defausse=lambda v: f"Main pleine : défausse en fin de tour dans {_pct(v)} des parties",
        permanents8=lambda v: f"{_nb(v)} permanent{_s(v)} en jeu au tour 8",
        tues=lambda v: f"{_nb(v)} créature{_s(v)} adverse{_s(v)} détruite{_s(v)} par partie",
        commandant=lambda v: f"Commandant en jeu au tour {a_lheure} dans {_pct(v)} des parties",
    )
    constats = [textes[k](m[k]) for niv in ("alerte", "juste") for k in SEUILS if N[k][0] == niv]
    if m["cmd_mort"] is not None and m["cmd_mort"] >= 1:
        constats.append(f"Commandant tué {_nb(m['cmd_mort'])} fois par partie")
    if m["mulligans"] is not None and m["mulligans"] >= 0.12:
        constats.append(f"Deux mulligans ou plus dans {_pct(m['mulligans'])} des parties")
    return dict(verdict=verdict, indicateurs=indicateurs, constats=constats[:3], mesures=m)


def main():
    ap = argparse.ArgumentParser(description="Simulateur Commander à 4 joueurs contre des archétypes")
    ap.add_argument("listes", nargs="+", help="fichiers de liste ; la 1re est la référence")
    ap.add_argument("--tables", nargs="+", default=list(ARCHETYPES) + ["Mixte"])
    ap.add_argument("-n", type=int, default=2000, help="parties par table et par liste (défaut 2000)")
    ap.add_argument("--couverture", action="store_true", help="affiche seulement ce que le moteur comprend de chaque liste")
    ap.add_argument("--pilote", choices=["vite", "salve"], default="vite",
                    help="vite : tout lancer dès que possible (défaut) ; salve : garder ses créatures pour un gros tour")
    args = ap.parse_args()

    decks = []
    for chemin in args.listes:
        cmd, part, deck = lire_liste(chemin, partenaire=True)
        C, cov = construire(deck, cmd, part)
        lab = os.path.basename(os.path.dirname(chemin)) + "/" + os.path.basename(chemin)
        decks.append((lab, C, cmd, deck, {"partenaire": part} if part else None))
        print(f"{chemin} : {cmd}" + (f" + {part}" if part else "") + f" + {len(deck)} cartes")
        for cle in ("affinee", "specifique", "auto", "partiel", "corps", "sans_effet"):
            if cov[cle]:
                noms = ", ".join(cov[cle]) if cle in ("partiel", "corps", "sans_effet") or args.couverture else ""
                print(f"  {len(cov[cle]):3} {LIBELLES[cle]}" + (f" : {noms}" if noms else ""))
        if args.couverture:
            for n in cov["partiel"] + cov["corps"] + cov["sans_effet"]:
                for ligne in C[n]["non_lu"]:
                    print(f"      {n} — non compris : {ligne}")
    if args.couverture:
        return
    print(f"\n{args.n} parties par table et par liste, 4 joueurs, au plus {T_MAX} tours, pilote « {args.pilote} ».\n")
    for nom_table in args.tables:
        print(f"===== Table : {nom_table}" + (" (3 archétypes différents tirés au hasard)" if nom_table == "Mixte" else " x3"))
        series = [serie(C, cmd, deck, nom_table, args.n, args.pilote, regl) for _, C, cmd, deck, regl in decks]
        for (lab, *_), res in zip(decks, series):
            s = resume(res)
            causes = ", ".join(f"{k} {v:.0%}" for k, v in sorted(s["causes"].items(), key=lambda kv: -kv[1]))
            print(f"  {lab}")
            print(f"    victoire {s['victoire']:.1%} | défaite {s['defaite']:.1%} ({causes}) | pas finie au T{T_MAX} {s['pas_finie']:.1%}"
                  f" | fin moyenne T{s['tour_fin']:.1f}")
            print(f"    commandant lancé : T4 {s['cmd4']:.0%}, T5 {s['cmd5']:.0%} | créatures par adversaire T6 {s['crea6']:.1f},"
                  f" T8 {s['crea8']:.1f} | tes PV au T8 {s['pv8']:.0f}")
            st = s["stat"]
            print(f"    par partie : commandant tué {st['cmd_mort']:.2f} (sauvé {st['cmd_sauve']:.2f}) | star détruite {st['star_detruite']:.2f}"
                  f" | rase-boards subis {st['rase_subi']:.2f} | cimetière exilé {st['cimetiere_exile']:.2f} | sorts contrés {st['contre_subi']:.2f}"
                  + (f" | cartes piochées par Greven {st['greven_pioche']:.1f}" if st["greven_pioche"] else "")
                  + (f" | par le Crâne {st['pioche_clamp']:.1f}" if st["pioche_clamp"] else "")
                  + (f" | salves {st['salves']:.1f}" if st["salves"] else "")
                  + (f" | cartes défaussées en fin de tour {st['defausse_fin']:.1f}" if st["defausse_fin"] else ""))
            mes = {k: v for k, v in s["degats"].items() if not k.endswith("_adv")}
            print("    tes dégâts aux adversaires par partie : " + ", ".join(f"{k} {v:.1f}" for k, v in sorted(mes.items(), key=lambda kv: -kv[1]))
                  + " | adversaires éliminés : " + ", ".join(f"{k} {v:.2f}" for k, v in sorted(s["elim"].items(), key=lambda kv: -kv[1])))
            print("    tes PV perdus par partie : " + ", ".join(f"{k} {v:.1f}" for k, v in sorted(s["pertes"].items(), key=lambda kv: -kv[1])))
        for (lab, *_), res in list(zip(decks, series))[1:]:
            m, ic = ecart(series[0], res)
            print(f"  -> {decks[0][0]} moins {lab} : {m:+.1%} de victoires (± {ic:.1%})")
        print()


if __name__ == "__main__":
    main()
