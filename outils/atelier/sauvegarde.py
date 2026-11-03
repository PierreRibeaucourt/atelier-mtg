"""Garde la liste actuelle d'un deck dans son historique avant une modification faite à la main ou par Claude.

Usage : python outils/atelier/sauvegarde.py "Deck Greven Elemental" "Champion of the Path à la place de Languish"
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")
import decks  # noqa: E402

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    nom = decks.instantane(sys.argv[1], " ".join(sys.argv[2:]))
    print(f"Ancienne liste gardée : {sys.argv[1]}/{decks.HISTO}/{nom}" if nom else "Rien à sauvegarder (pas de archidekt.txt).")
