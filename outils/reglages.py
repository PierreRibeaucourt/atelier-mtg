"""Réglages propres à chaque installation : reglages.json à la racine (hors du dépôt), tous facultatifs.

  {"budget": 5, "github": "MonCompte"}

- budget : prix maximum par carte, en euros ; les cartes plus chères sont signalées. 5 par défaut, 0 = pas d'alerte.
- github : compte GitHub où publier les decks partagés (dépôt « decks »). Par défaut, celui du dépôt de l'Atelier
  (remote origin).
- nom : le nom affiché sur les pages partagées (« Decks de … »). Par défaut, le compte GitHub.
- fermeture : « arreter » = l'Atelier s'arrête quand on ferme sa dernière page ; sinon il reste prêt en arrière-plan.
- langue_cartes : l'impression par défaut des cartes est la moins chère qui existe dans cette langue (« fr »…) ;
  sans elle, la moins chère.
- sans_ub_illustrations : impression par défaut hors Universes Beyond quand il en existe une autre (Sol Ring, une Île…).
- sans_ub_suggestions : ne pas suggérer les cartes qui n'existent qu'en Universes Beyond (Marvel, Final Fantasy…).
- preferences : true une fois que la page a posé ses questions (fermeture, impression, Universes Beyond).
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


# langues des impressions de cartes (codes Scryfall), pour « la moins chère en … » ; l'anglais est la moins chère tout court
LANGUES = {"fr": "français", "de": "allemand", "it": "italien", "es": "espagnol", "pt": "portugais", "ja": "japonais",
           "ko": "coréen", "ru": "russe", "zhs": "chinois simplifié", "zht": "chinois traditionnel"}


def impression():
    """(langue des impressions par défaut, ou None pour la moins chère toutes langues ; éviter les illustrations
    Universes Beyond)."""
    r = lire()
    return (r.get("langue_cartes") if r.get("langue_cartes") in LANGUES else None), bool(r.get("sans_ub_illustrations"))


def sans_ub_suggestions():
    return bool(lire().get("sans_ub_suggestions"))


def arret_a_la_fermeture():
    return lire().get("fermeture") == "arreter"


def nom():
    """Le nom affiché sur les pages partagées (« Decks de … ») : la clé nom, sinon le compte GitHub ; None sans les deux."""
    return (lire().get("nom") or "").strip() or github()
