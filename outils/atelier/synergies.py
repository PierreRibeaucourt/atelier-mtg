"""Synergies d'un deck (ce que Magic-Ville classe « Synergie »), cherchées par Claude dans les textes Oracle.

Aucune base ouverte ne recense les synergies entre cartes : Magic-Ville bloque les robots, EDHREC interdit les requêtes
automatiques, Commander Spellbook ne garde que les combos. Claude lit donc la liste et les textes Oracle, et rend une liste
structurée (--json-schema), sans aucun outil (--tools "") : il ne touche à aucun fichier.
L'analyse se lance à la demande (elle compte dans la limite d'utilisation Claude) et reste valable tant que la liste ne change
pas : <dossier du deck>/synergies.json.
"""
import hashlib
import json
import os
import subprocess
import threading
import time

import decks
import discussion
import infos_cartes as ic

FICHIER = "synergies.json"
CLASSES = ["Victoire", "Moteur", "Mana", "Pioche", "Récursion", "Protection", "Contrôle", "Synergie"]
SCHEMA = {
    "type": "object",
    "properties": {
        "synergies": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "cartes": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 4},
                "classe": {"type": "string", "enum": CLASSES},
                "force": {"type": "integer", "minimum": 1, "maximum": 3},
                "titre": {"type": "string"},
                "explication": {"type": "string"},
            },
            "required": ["cartes", "classe", "force", "titre", "explication"]}},
        "resume": {"type": "string"},
    },
    "required": ["synergies", "resume"],
}
CONSIGNE = """Tu analyses un deck Commander pour l'Atelier MTG de l'utilisateur, comme la rubrique « Combos » de Magic-Ville :
liste les SYNERGIES entre 2 à 4 cartes de ce deck (pas les combos infinies, déjà données par Commander Spellbook et rappelées plus bas).

Règles :
- Seulement des interactions précises et réelles, vérifiées sur le texte Oracle, la force et l'endurance données dans la liste
  (types, conditions, timing). N'invente aucune caractéristique : tout ce qu'il faut savoir d'une carte est dans sa ligne.
  Exemple attendu : « Thunderkin Awakener + Spitebellows » (l'Éveilleur ramène chaque tour un élémental d'endurance plus faible
  dont l'arrivée inflige 6 dégâts).
- Pas d'évidences génériques : une accélération + une carte chère, un tuteur + n'importe quoi, une pioche + n'importe quoi,
  « bon avec toutes les créatures », un terrain qui produit la bonne couleur.
- Si une carte a la même synergie avec beaucoup de cartes du deck, garde les 2 ou 3 meilleures paires, pas toutes.
- 30 synergies au plus, les plus fortes d'abord. force : 3 = gagne des parties ou change le jeu, 2 = solide, 1 = petit bonus.
- classe : Victoire (achève ou gagne), Moteur (avantage répété à chaque tour), Mana, Pioche, Récursion (ramène des cartes),
  Protection, Contrôle, Synergie (le reste).
- « cartes » : les noms ANGLAIS exacts tels qu'ils sont écrits dans la liste.
- « titre » : 3 à 6 mots en français. « explication » : 1 à 2 phrases en français, avec les noms français des cartes quand ils existent.
  Coûts et symboles entre accolades, comme sur les cartes : {2}{R}, {T}, {W/U} (l'Atelier les affiche en symboles).
- « resume » : 1 phrase sur le cœur du deck (son moteur principal).
Réponds uniquement par la structure demandée."""


def _jeu(deck):
    return [e for e in decks.lire(decks.chemin(deck)) if decks.categorie(e) != "Maybeboard"]


def _cle(jeu):
    return hashlib.sha1("\n".join(sorted(e["nom"] for e in jeu)).encode()).hexdigest()


def _chemin(deck):
    return decks.chemin(deck, FICHIER)


def lire(deck):
    p = _chemin(deck)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None


# ---------------------------------------------------------------- tâches en cours (une par deck)
_verrou = threading.Lock()
_jobs = {}


def etat(deck):
    """Dernière analyse (et si elle correspond toujours à la liste), plus l'analyse en cours s'il y en a une."""
    r = lire(deck)
    with _verrou:
        j = dict(_jobs.get(deck) or {})
    return dict(resultat=r, a_jour=bool(r) and r.get("cle") == _cle(_jeu(deck)),
                actif=j.get("actif", False), erreur=j.get("erreur", ""), debut=j.get("debut"))


def lancer(deck, modele=""):
    exe = discussion.trouver_claude()
    if not exe:
        raise RuntimeError("Claude Code introuvable : installe l'extension Claude Code de VS Code, ou le programme « claude ».")
    jeu = _jeu(deck)
    if len(jeu) < 2:
        raise ValueError("le deck n'a pas assez de cartes")
    with _verrou:
        if (_jobs.get(deck) or {}).get("actif"):
            raise RuntimeError("l'analyse des synergies est déjà en cours pour ce deck")
        j = _jobs[deck] = dict(actif=True, erreur="", debut=time.time(), proc=None)
    threading.Thread(target=_travail, args=(j, exe, deck, jeu, modele), daemon=True).start()
    return etat(deck)


def _texte_deck(jeu, deck):
    I = ic.infos([e["nom"] for e in jeu])
    lignes = []
    for e in jeu:
        f = I.get(e["nom"]) or {}
        role = " [COMMANDANT]" if decks.categorie(e) == "Commander" else ""
        fr = f" (FR : {f['fr']})" if f.get("fr") and f["fr"] != e["nom"] else ""
        texte = (f.get("texte") or "").replace("\n", " / ")
        pt = f" | {f['pt']}" if f.get("pt") else ""
        lignes.append(f"- {e['n']}x {e['nom']}{fr}{role} | {f.get('cout', '')} | {f.get('type', '')}{pt} | {texte}")
    combos = []
    try:
        import bracket
        combos = [" + ".join(c["cartes"]) for c in bracket.spellbook(deck)["combos"]]
    except Exception:                                   # Spellbook injoignable : Claude cherchera sans la liste
        pass
    return ("LISTE DU DECK (nom anglais (nom français) | coût | type | force/endurance | texte Oracle) :\n" + "\n".join(lignes)
            + "\n\nCOMBOS DÉJÀ CONNUES (Commander Spellbook, à ne pas répéter) : " + ("; ".join(combos) or "aucune"))


def _travail(j, exe, deck, jeu, modele):
    try:
        cmd = [exe, "-p", "--output-format", "json", "--json-schema", json.dumps(SCHEMA), "--tools", "",
               "--no-session-persistence", "--append-system-prompt", CONSIGNE]
        if modele:
            cmd += ["--model", modele]
        proc = j["proc"] = subprocess.Popen(cmd, cwd=decks.RACINE, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                            stderr=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        sortie, err = proc.communicate(_texte_deck(jeu, deck).encode("utf-8"), timeout=900)
        try:
            fin = json.loads(sortie.decode("utf-8", "replace"))
        except ValueError:
            raise RuntimeError((err.decode("utf-8", "replace").strip() or sortie.decode("utf-8", "replace").strip()
                                or f"Claude Code s'est arrêté (code {proc.returncode})")[:800])
        if fin.get("is_error"):
            raise RuntimeError(str(fin.get("result") or "erreur de Claude Code")[:800])
        data = fin.get("structured_output")
        if data is None:                                 # au cas où la réponse arrive en texte
            data = json.loads(fin.get("result") or "{}")
        noms = {e["nom"].lower(): e["nom"] for e in jeu}
        noms.update({e["nom"].split(" // ")[0].lower(): e["nom"] for e in jeu})
        syn = []
        for s in data.get("synergies", []):              # on ne garde que des cartes vraiment dans le deck
            cartes = [noms.get(n.strip().lower()) for n in s.get("cartes", [])]
            if len(cartes) >= 2 and all(cartes) and len(set(cartes)) == len(cartes):
                syn.append(dict(cartes=cartes, classe=s.get("classe", "Synergie"), force=int(s.get("force", 1)),
                                titre=s.get("titre", ""), explication=s.get("explication", "")))
        res = dict(cle=_cle(jeu), date=time.time(), modele=modele or "habituel", resume=data.get("resume", ""),
                   synergies=syn, cout=fin.get("total_cost_usd"))
        p = _chemin(deck)
        json.dump(res, open(p + ".tmp", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        os.replace(p + ".tmp", p)
    except subprocess.TimeoutExpired:
        j["proc"].kill()
        j["erreur"] = "Claude n'a pas répondu en 15 minutes."
    except Exception as e:                               # noqa: BLE001 — affiché dans l'onglet Combos
        j["erreur"] = str(e)
    finally:
        with _verrou:
            j["actif"] = False
            j["proc"] = None
