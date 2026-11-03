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

LIBELLES = {"specifique": "écrites à la main", "auto": "lues automatiquement", "partiel": "lues en partie",
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
        cmd, deck = lire_liste(chemin)
        C, cov = construire(deck, cmd)
        lab = os.path.basename(os.path.dirname(chemin)) + "/" + os.path.basename(chemin)
        decks.append((lab, C, cmd, deck))
        print(f"{chemin} : {cmd} + {len(deck)} cartes")
        for cle in ("specifique", "auto", "partiel", "corps", "sans_effet"):
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
        series = [serie(C, cmd, deck, nom_table, args.n, args.pilote) for _, C, cmd, deck in decks]
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
