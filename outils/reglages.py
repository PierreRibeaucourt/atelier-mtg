"""Réglages propres à chaque installation : reglages.json à la racine (hors du dépôt), tous facultatifs.

  {"budget": 5, "github": "MonCompte"}

- budget : prix maximum par carte, en euros ; les cartes plus chères sont signalées. 5 par défaut, 0 = pas d'alerte.
- github : compte GitHub où publier les decks partagés (dépôt « decks »). Par défaut, celui du dépôt de l'Atelier
  (remote origin).
- nom : le nom affiché sur les pages partagées (« Decks de … »). Par défaut, le compte GitHub.
"""
import json
import os

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FICHIER = os.path.join(RACINE, "reglages.json")
BUDGET_DEFAUT = 5.0


def lire():
    try:
        with open(FICHIER, encoding="utf-8") as f:
            r = json.load(f)
        return r if isinstance(r, dict) else {}
    except (OSError, ValueError):
        return {}


def ecrire(**valeurs):
    """Ajoute ou remplace des réglages ; None retire la clé."""
    r = lire()
    for k, v in valeurs.items():
        if v is None:
            r.pop(k, None)
        else:
            r[k] = v
    with open(FICHIER, "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return r


def budget():
    """Le budget par carte en euros ; float("inf") s'il n'y en a pas (0 dans reglages.json)."""
    try:
        b = float(lire().get("budget", BUDGET_DEFAUT))
    except (TypeError, ValueError):
        return BUDGET_DEFAUT
    return b if b > 0 else float("inf")


def budget_texte():
    """« 5 € », « 2,5 € » ; vide s'il n'y a pas de budget."""
    b = budget()
    return "" if b == float("inf") else f"{b:g}".replace(".", ",") + " €"


def pour_la_page():
    """Ce que l'interface doit savoir (window.REGLAGES) : budget 0 = pas d'alerte."""
    b = budget()
    return {"budget": 0 if b == float("inf") else b}


def github():
    return (lire().get("github") or "").strip().lstrip("@") or None


def nom():
    """Le nom affiché sur les pages partagées (« Decks de … ») : la clé nom, sinon le compte GitHub ; None sans les deux."""
    return (lire().get("nom") or "").strip() or github()
