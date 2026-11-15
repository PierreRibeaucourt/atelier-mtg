"""Point d'entrée pour o2switch (cPanel › Setup Python App, Passenger) : l'objet « application »."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from serveur import creer, lire_reglages  # noqa: E402

application = creer(lire_reglages())
