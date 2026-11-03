"""Probabilités de pioche pour Magic (loi hypergéométrique).

Exemples :
  Main de départ EDH avec 38 terrains, proba d'avoir 2 à 4 terrains :
    python outils/proba.py --deck 99 --cibles 38 --min 2 --max 4

  Proba d'avoir vu au moins 1 de mes 10 ramps, tour par tour (multijoueur) :
    python outils/proba.py --deck 99 --cibles 10 --min 1 --tours 6

Pioche : en multijoueur tout le monde pioche dès le tour 1 (7 + T cartes vues
au tour T). En duel, le joueur qui commence ne pioche pas au tour 1 : --otp.
En EDH, le deck vaut 99 (le commandant est en zone de commandement).
"""
import argparse
import sys
from math import comb


def p_exact(N, K, n, k):
    if k < 0 or k > K or n - k > N - K:
        return 0.0
    return comb(K, k) * comb(N - K, n - k) / comb(N, n)


def p_entre(N, K, n, kmin, kmax):
    return sum(p_exact(N, K, n, k) for k in range(kmin, min(kmax, K, n) + 1))


def main():
    a = argparse.ArgumentParser(description="Probabilités de pioche (hypergéométrique)")
    a.add_argument("--deck", type=int, required=True, help="nombre de cartes dans la bibliothèque (99 en EDH)")
    a.add_argument("--cibles", type=int, required=True, help="nombre de cartes recherchées dans le deck")
    a.add_argument("--vues", type=int, default=7, help="cartes vues (7 = main de départ)")
    a.add_argument("--min", type=int, default=1, help="nombre minimum de cibles voulues")
    a.add_argument("--max", type=int, default=None, help="nombre maximum de cibles voulues")
    a.add_argument("--tours", type=int, default=0, help="afficher la proba tour par tour jusqu'à ce tour")
    a.add_argument("--otp", action="store_true", help="duel en commençant : pas de pioche au tour 1")
    o = a.parse_args()
    kmax = o.max if o.max is not None else o.cibles
    plage = f"{o.min}" + (f" à {kmax}" if o.max is not None else " ou plus")

    print(f"Deck {o.deck} cartes, {o.cibles} cibles, voulu : {plage}")
    if o.tours:
        for t in range(0, o.tours + 1):
            vues = 7 + max(0, t - 1 if o.otp else t)
            p = p_entre(o.deck, o.cibles, vues, o.min, kmax)
            etiquette = "main de départ" if t == 0 else f"tour {t}"
            print(f"  {etiquette:<15} ({vues:>2} cartes vues) : {p:6.1%}")
    else:
        print(f"  Sur {o.vues} cartes vues :")
        for k in range(0, min(o.cibles, o.vues) + 1):
            p = p_exact(o.deck, o.cibles, o.vues, k)
            if p >= 0.0005:
                print(f"    exactement {k:>2} : {p:6.1%}")
        print(f"  => {plage} : {p_entre(o.deck, o.cibles, o.vues, o.min, kmax):.1%}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
