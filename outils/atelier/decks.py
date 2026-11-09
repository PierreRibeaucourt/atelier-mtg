"""Decks de l'Atelier : lecture et écriture des listes au format Archidekt, historique des versions.

Chaque deck est un dossier « Deck … » à la racine du dossier MTG. La liste de référence est `archidekt.txt` :
« 1x Nom [Catégorie,Autre] », le commandant tagué [Commander], les cartes à tester tagguées [Maybeboard,…].
Une impression choisie (le visuel) s'écrit comme dans les exports Archidekt : « 1x Nom (ima) 205 [Tags] ».
Chaque enregistrement garde l'ancienne version dans `historique/`.
"""
import json
import os
import re
from collections import Counter
from datetime import datetime

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # dossier MTG
FICHIER = "archidekt.txt"
HISTO = "historique"
CORBEILLE = "Corbeille Atelier"          # decks supprimés depuis l'Atelier (récupérables)
LIGNE = re.compile(r"^(?:SB:\s*)?(\d+)x?\s+(.+?)\s*(?:\[([^\]]*)\])?\s*$")
ETIQUETTE = re.compile(r"\s*(\^[^^]*\^)\s*$")
EDITION = re.compile(r"\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([\w★-]+))?(?:\s+\*([A-Z]+)\*)?$")   # « (cmm) 410 *F* » : l'impression choisie
VISUELS = "visuels.json"   # langue des impressions choisies dans l'Atelier, qu'Archidekt ne note pas : {"ima/205": "fr"}
NOM_INTERDIT = re.compile(r'[<>:"/\\|?*]')
BASES = {"Mountain", "Swamp", "Island", "Plains", "Forest", "Wastes"}


def dossiers():
    return sorted(d for d in os.listdir(RACINE) if d.startswith("Deck ") and os.path.isdir(os.path.join(RACINE, d)))


def chemin(deck, nom=FICHIER):
    if deck not in dossiers():
        raise KeyError(f"deck inconnu : {deck}")
    return os.path.join(RACINE, deck, nom)


# ---------------------------------------------------------------- lecture / écriture
def lire(path):
    """Entrées dans l'ordre du fichier : dict(n, nom, tags, etiquette). Accepte aussi « 1 Nom » + « SB: 1 Commandant »."""
    return lire_lignes(open(path, encoding="utf-8"))


def lire_lignes(lignes):
    """Lit une liste Archidekt, Moxfield ou MTG Arena (« 1x Nom (set) 123 [Tags] », « 1 Nom », « SB: 1 Nom »)."""
    entrees, cmd_comment = [], None
    for ligne in lignes:
        l = ligne.strip()
        if not l:
            continue
        if l.startswith(("//", "#")):
            m = re.search(r"commandant\s*:\s*(.+)$", l, re.I)
            if m:
                cmd_comment = m.group(1).strip()
            continue
        etiquette = None
        m = ETIQUETTE.search(l)
        if m:
            etiquette = m.group(1)
            l = l[:m.start()]
        m = LIGNE.match(l)
        if not m:
            continue
        tags = [re.sub(r"\{[^}]*\}", "", t).strip() for t in (m.group(3) or "").split(",")]   # « Maybeboard{noDeck} »
        tags = [t for t in tags if t]
        if l.upper().startswith("SB:") and "Commander" not in tags:
            tags.insert(0, "Commander")
        nom, edition = m.group(2).strip(), None
        ed = EDITION.search(nom)
        if ed:
            nom = nom[:ed.start()].strip()
            edition = dict(set=ed.group(1).lower(), num=ed.group(2) or "", fini=ed.group(3) or "")
        entrees.append(dict(n=int(m.group(1)), nom=nom, tags=tags, etiquette=etiquette, edition=edition))
    if cmd_comment and not any("Commander" in e["tags"] for e in entrees):
        for e in entrees:
            if e["nom"] == cmd_comment:
                e["tags"].insert(0, "Commander")
    return entrees


def categorie(e):
    if "Commander" in e["tags"]:
        return "Commander"
    if "Maybeboard" in e["tags"]:
        return "Maybeboard"
    return e["tags"][0] if e["tags"] else "Sans catégorie"


def ordonner(entrees):
    """Commandant d'abord, Maybeboard à la fin ; le reste garde son ordre (il fixe le mélange des simulations)."""
    cmd = [e for e in entrees if categorie(e) == "Commander"]
    maybe = [e for e in entrees if categorie(e) == "Maybeboard"]
    reste = [e for e in entrees if e not in cmd and e not in maybe]
    return cmd + reste + maybe


def texte(entrees):
    lignes, prec = [], None
    for e in ordonner(entrees):
        cat = categorie(e)
        if prec is not None and cat != prec:
            lignes.append("")
        tags = f" [{','.join(e['tags'])}]" if e["tags"] else ""
        lignes.append(f"{e['n']}x {e['nom']}{texte_edition(e.get('edition'))}{tags}" + (f" {e['etiquette']}" if e.get("etiquette") else ""))
        prec = cat
    return "\n".join(lignes) + "\n"


def exporter(entrees, fmt, nom=None):
    """La liste à coller dans un autre site.
    archidekt : le fichier tel quel (tags, Maybeboard, impressions choisies). Les autres laissent le Maybeboard de côté :
    moxfield et arena en sections « Commander » / « Deck » (moxfield garde l'impression choisie), mtgo avec le
    commandant en réserve après une ligne vide, simple et fr une carte par ligne, commandant d'abord.
    nom(nom, fmt) : le nom à écrire (français, recto seul…)."""
    if fmt == "archidekt":
        return texte(entrees)
    nom = nom or (lambda n, f: n)
    cmd = [e for e in entrees if categorie(e) == "Commander"]
    jeu = [e for e in ordonner(entrees) if categorie(e) not in ("Commander", "Maybeboard")]

    def ligne(e):
        ed = e.get("edition") or {}
        impression = f" ({ed['set'].upper()}) {ed.get('num', '')}".rstrip() + (" *F*" if ed.get("fini") == "F" else "") if fmt == "moxfield" and ed.get("set") else ""
        return f"{e['n']} {nom(e['nom'], fmt)}{impression}"
    if fmt in ("moxfield", "arena"):
        blocs = ([["Commander", *map(ligne, cmd)]] if cmd else []) + [["Deck", *map(ligne, jeu)]]
    elif fmt == "mtgo":
        blocs = [list(map(ligne, jeu)), list(map(ligne, cmd))]
    elif fmt in ("simple", "fr"):
        blocs = [list(map(ligne, cmd + jeu))]
    else:
        raise ValueError(f"format d'export inconnu : {fmt}")
    return "\n\n".join("\n".join(b) for b in blocs if b) + "\n"


def texte_edition(ed):
    """« (ima) 205 », comme les exports Archidekt : Archidekt affiche alors la même impression."""
    if not ed or not ed.get("set"):
        return ""
    return f" ({ed['set']})" + (f" {ed['num']}" if ed.get("num") else "") + (f" *{ed['fini']}*" if ed.get("fini") else "")


def _edition(d):
    """Impression demandée par la page : {set, num} ; rien = l'image par défaut de Scryfall."""
    d = d or {}
    s, num = str(d.get("set") or "").strip().lower(), str(d.get("num") or "").strip()
    return dict(set=s, num=num, fini="") if s and num else None


def langues(deck):
    p = os.path.join(RACINE, deck, VISUELS)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}


def _noter_langue(deck, ed, lang):
    """Impression française choisie : on le note à côté de la liste (la ligne Archidekt n'a pas de place pour la langue)."""
    if not ed:
        return
    L, cle = langues(deck), f"{ed['set']}/{ed['num']}"
    if lang and lang != "en":
        L[cle] = lang
    elif cle in L:
        del L[cle]
    else:
        return
    json.dump(L, open(os.path.join(RACINE, deck, VISUELS), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def instantane(deck, raison=""):
    """Copie la liste actuelle dans historique/ avant une modification."""
    src = chemin(deck)
    if not os.path.exists(src):
        return None
    d = os.path.join(RACINE, deck, HISTO)
    os.makedirs(d, exist_ok=True)
    base = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    nom, k = base + ".txt", 2
    while os.path.exists(os.path.join(d, nom)):              # deux modifications dans la même seconde
        nom, k = f"{base}_{k}.txt", k + 1
    contenu = open(src, encoding="utf-8").read()
    with open(os.path.join(d, nom), "w", encoding="utf-8", newline="\n") as f:
        f.write(contenu)
    if raison:
        journal = os.path.join(d, "journal.json")
        j = json.load(open(journal, encoding="utf-8")) if os.path.exists(journal) else {}
        j[nom] = raison
        json.dump(j, open(journal, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return nom


def enregistrer(deck, entrees, raison=""):
    instantane(deck, raison)
    with open(chemin(deck), "w", encoding="utf-8", newline="\n") as f:
        f.write(texte(entrees))


# ---------------------------------------------------------------- informations sur un deck
def note(deck):
    p = os.path.join(RACINE, deck, "deck.json")
    return json.load(open(p, encoding="utf-8")).get("note", "") if os.path.exists(p) else ""


# ---------------------------------------------------------------- cartes que j'ai, cartes à acheter
# achats.json, à côté de la liste (jamais partagé) : {"possedees": {"Sol Ring": 1, "Mountain": 0}}, combien d'exemplaires
# j'ai de chaque carte pour ce deck. Une carte absente : à acheter (un terrain de base : je l'ai). Une carte retirée du
# deck reste notée : si elle revient, je l'ai toujours.
ACHATS = "achats.json"


def _ecrire_achats(deck, poss):
    with open(os.path.join(RACINE, deck, ACHATS), "w", encoding="utf-8", newline="\n") as f:
        json.dump(dict(possedees=poss), f, ensure_ascii=False, indent=1)


def possedees(deck):
    """{nom: exemplaires que j'ai}. La première fois, toutes les cartes du deck (hors Maybeboard) : un deck d'avant cette
    fonction est déjà monté. Un deck créé dans l'Atelier part de zéro (creer écrit un fichier vide)."""
    p = os.path.join(RACINE, deck, ACHATS)
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8")).get("possedees", {})
    poss = Counter()
    if os.path.exists(chemin(deck)):
        for e in lire(chemin(deck)):
            if categorie(e) != "Maybeboard":
                poss[e["nom"]] += e["n"]
    _ecrire_achats(deck, dict(poss))
    return dict(poss)


def marquer(deck, changements):
    """changements : {nom: exemplaires que j'ai}. Renvoie toutes les cartes que j'ai."""
    poss = possedees(deck)
    for nom, n in changements.items():
        poss[str(nom)] = max(0, int(n))
    _ecrire_achats(deck, poss)
    return poss


def comptes(entrees):
    jeu = [e for e in entrees if categorie(e) != "Maybeboard"]
    cmd = next((e["nom"] for e in entrees if categorie(e) == "Commander"), None)
    return dict(commandant=cmd, total=sum(e["n"] for e in jeu), maybe=sum(e["n"] for e in entrees if categorie(e) == "Maybeboard"))


def noms(entrees, maybe=True):
    return [e["nom"] for e in entrees if maybe or categorie(e) != "Maybeboard"]


def categories(entrees):
    """Toutes les catégories déjà utilisées dans les decks, pour proposer les mêmes noms partout."""
    vues = Counter()
    for deck in dossiers():
        p = os.path.join(RACINE, deck, FICHIER)
        if os.path.exists(p):
            for e in lire(p):
                for t in e["tags"]:
                    vues[t] += 1
    for e in entrees:
        for t in e["tags"]:
            vues[t] += 1
    return [t for t, _ in vues.most_common() if t not in ("Commander", "Maybeboard")]


# ---------------------------------------------------------------- modifications
def modifier(deck, op, d):
    """op : ajouter, retirer, maybeboard, categorie, remplacer, edition, quantite. Renvoie la nouvelle liste."""
    entrees = lire(chemin(deck))
    i = d.get("index")
    if i is not None:
        if not 0 <= i < len(entrees) or entrees[i]["nom"] != d.get("nom_actuel", entrees[i]["nom"]):
            raise ValueError("la liste a changé entre-temps : recharge la page")
        e = entrees[i]
    if op == "ajouter":
        tags = [t for t in d.get("tags", []) if t]          # sans tag : rangée par type dans l'Atelier comme dans Archidekt
        nouvelle = dict(n=int(d.get("n", 1)), nom=d["nom"], tags=tags, etiquette=None, edition=_edition(d.get("edition")))
        cat = categorie(nouvelle)
        meme = next((x for x in entrees if x["nom"] == d["nom"] and (categorie(x) == "Maybeboard") == (cat == "Maybeboard")), None)
        if meme:                                            # déjà là (ex. une Montagne de plus) : on augmente la quantité
            meme["n"] += nouvelle["n"]
            raison = f"+ {d['nom']} (×{meme['n']})"
        else:
            _noter_langue(deck, nouvelle["edition"], (d.get("edition") or {}).get("lang"))
            pos = max((k for k, x in enumerate(entrees) if categorie(x) == cat), default=None)
            if pos is None:
                pos = max((k for k, x in enumerate(entrees) if categorie(x) != "Maybeboard"), default=len(entrees) - 1)
            entrees.insert(pos + 1, nouvelle)
            raison = f"+ {d['nom']}" + (" (Maybeboard)" if cat == "Maybeboard" else "")
    elif op == "retirer":
        entrees.pop(i)
        raison = f"− {e['nom']}"
    elif op == "commandant":
        if "Commander" in e["tags"]:
            e["tags"].remove("Commander")
            raison = f"{e['nom']} n'est plus commandant"
        else:
            e["tags"] = ["Commander"] + [t for t in e["tags"] if t != "Maybeboard"]
            e["n"] = 1
            raison = f"{e['nom']} devient commandant"
    elif op == "maybeboard":
        if "Maybeboard" in e["tags"]:
            e["tags"] = [t for t in e["tags"] if t != "Maybeboard"]
            entrees.pop(i)
            cat = categorie(e)
            pos = max((k for k, x in enumerate(entrees) if categorie(x) == cat), default=None)
            if pos is None:
                pos = max((k for k, x in enumerate(entrees) if categorie(x) != "Maybeboard"), default=len(entrees) - 1)
            entrees.insert(pos + 1, e)
            raison = f"{e['nom']} : Maybeboard → deck"
        else:
            e["tags"] = ["Maybeboard"] + [t for t in e["tags"] if t != "Commander"]
            raison = f"{e['nom']} : deck → Maybeboard"
    elif op == "categorie":
        avant = list(e["tags"])
        garde = [t for t in avant if t in ("Commander", "Maybeboard")]
        e["tags"] = garde + [t for t in d["tags"] if t and t not in garde]
        raison = f"{e['nom']} : {','.join(avant)} → {','.join(e['tags'])}"
    elif op == "remplacer":
        raison = f"{e['nom']} → {d['nom']}"
        e["nom"] = d["nom"]          # même ligne : la simulation garde le même mélange, la comparaison reste appariée
        e["n"] = 1
        e["etiquette"] = None
        e["edition"] = _edition(d.get("edition"))
        _noter_langue(deck, e["edition"], (d.get("edition") or {}).get("lang"))
    elif op == "edition":            # autre impression de la même carte : seul le visuel change
        e["edition"] = _edition(d.get("edition"))
        _noter_langue(deck, e["edition"], (d.get("edition") or {}).get("lang"))
        ed = d.get("edition") or {}
        raison = f"{e['nom']} : visuel " + (f"{ed.get('nom_edition') or e['edition']['set'].upper()} {e['edition']['num']}"
                                             + (" (français)" if ed.get("lang") == "fr" else "") if e["edition"] else "par défaut")
    elif op == "quantite":
        e["n"] = max(1, int(d["n"]))
        raison = f"{e['nom']} × {e['n']}"
    else:
        raise ValueError(f"opération inconnue : {op}")
    enregistrer(deck, entrees, raison)
    return entrees


# ---------------------------------------------------------------- créer, renommer, supprimer, récupérer un deck
def _dossier(nom):
    """Le dossier « Deck <nom> » d'un nom tapé, après vérification du nom."""
    nom = " ".join(nom.split())
    if not nom.removeprefix("Deck ").strip():
        raise ValueError("donne un nom au deck")
    if NOM_INTERDIT.search(nom) or nom.endswith("."):
        raise ValueError('le nom ne peut pas contenir < > : " / \\ | ? * ni finir par un point')
    return nom if nom.startswith("Deck ") else "Deck " + nom


def creer(nom, commandant="", liste=""):
    """Nouveau dossier « Deck <nom> » avec son archidekt.txt (vide, ou la liste collée). Renvoie le nom du dossier."""
    dossier = _dossier(nom)
    p = os.path.join(RACINE, dossier)
    if os.path.exists(p):
        raise ValueError(f"le deck « {dossier} » existe déjà")
    entrees = lire_lignes(liste.splitlines()) if liste.strip() else []
    commandant = commandant.strip()
    if commandant:
        e = next((x for x in entrees if x["nom"].lower() == commandant.lower()), None)
        if e:
            e["tags"] = ["Commander"] + [t for t in e["tags"] if t not in ("Commander", "Maybeboard")]
            e["n"] = 1
        else:
            entrees.insert(0, dict(n=1, nom=commandant, tags=["Commander"], etiquette=None, edition=None))
    os.makedirs(p)
    with open(os.path.join(p, FICHIER), "w", encoding="utf-8", newline="\n") as f:
        f.write(texte(entrees) if entrees else "")
    _ecrire_achats(dossier, {})                             # nouveau deck : tout est à acheter
    return dossier


def renommer(deck, nom):
    """Renomme le dossier du deck : liste, historique, versions, simulations, discussion et achats suivent.
    Renvoie le nouveau nom du dossier."""
    src = os.path.dirname(chemin(deck))
    dossier = _dossier(nom)
    if dossier == deck:
        return deck
    if os.path.exists(os.path.join(RACINE, dossier)) and dossier.lower() != deck.lower():   # changer une majuscule : permis
        raise ValueError(f"le deck « {dossier} » existe déjà")
    try:
        os.rename(src, os.path.join(RACINE, dossier))
    except PermissionError:
        raise RuntimeError("Windows refuse de renommer le dossier : un de ses fichiers est ouvert ailleurs "
                           "(éditeur, Explorateur). Ferme-le et réessaie.") from None
    return dossier


def supprimer(deck):
    """Range le dossier du deck dans « Corbeille Atelier » (rien n'est effacé : il se récupère depuis l'accueil)."""
    src = os.path.dirname(chemin(deck))
    d = os.path.join(RACINE, CORBEILLE)
    os.makedirs(d, exist_ok=True)
    dest = os.path.join(d, f"{deck}__{datetime.now().strftime('%Y-%m-%d_%H%M%S')}")
    os.rename(src, dest)
    return os.path.basename(dest)


def corbeille():
    d = os.path.join(RACINE, CORBEILLE)
    if not os.path.isdir(d):
        return []
    res = []
    for f in os.listdir(d):
        m = re.match(r"(.+)__(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})\d{2}$", f)
        if m and os.path.isdir(os.path.join(d, f)):
            res.append(dict(fichier=f, nom=m.group(1), date=f"{m.group(2)} {m.group(3)}:{m.group(4)}"))
    return sorted(res, key=lambda x: x["fichier"].split("__")[1], reverse=True)


def recuperer(fichier):
    d = os.path.join(RACINE, CORBEILLE)
    if fichier not in {x["fichier"] for x in corbeille()}:
        raise ValueError("deck introuvable dans la corbeille")
    nom = fichier.rsplit("__", 1)[0]
    if os.path.exists(os.path.join(RACINE, nom)):
        raise ValueError(f"un deck « {nom} » existe déjà : renomme ou supprime-le d'abord")
    os.rename(os.path.join(d, fichier), os.path.join(RACINE, nom))
    return nom


# ---------------------------------------------------------------- versions
VERSIONS = "versions"          # versions nommées, enregistrées à la demande


def _meta_versions(deck):
    p = os.path.join(RACINE, deck, VERSIONS, "versions.json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}


def chemin_version(deck, fichier):
    """Chemin d'une version ; fichier vide = la liste actuelle. Refuse tout chemin hors du dossier du deck."""
    if not fichier:
        return chemin(deck)
    base = os.path.join(RACINE, deck)
    p = os.path.normpath(os.path.join(base, fichier))
    if not p.startswith(base + os.sep) or not os.path.exists(p):
        raise ValueError(f"version introuvable : {fichier}")
    return p


def libelle(deck, fichier):
    if not fichier:
        return "Liste actuelle"
    meta = _meta_versions(deck)
    b = os.path.basename(fichier)
    if fichier.replace("\\", "/").startswith(VERSIONS + "/") and b in meta:
        return meta[b]["nom"]
    if fichier.replace("\\", "/").startswith(HISTO + "/"):
        m = re.match(r"(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})\d{2}(?:_\d+)?\.txt$", b)
        return f"Historique du {m.group(1)} {m.group(2)}:{m.group(3)}" if m else "Historique : " + os.path.splitext(b)[0]
    return os.path.splitext(b)[0].replace("_", " ")


def sauver_version(deck, nom, note=""):
    """Garde une copie nommée de la liste actuelle (ex. « avant le tournoi », « version Champion »)."""
    nom = nom.strip()
    if not nom:
        raise ValueError("donne un nom à la version")
    d = os.path.join(RACINE, deck, VERSIONS)
    os.makedirs(d, exist_ok=True)
    slug = re.sub(r"[^\w-]+", "-", nom.lower(), flags=re.U).strip("-")[:40] or "version"
    fichier = datetime.now().strftime("%Y-%m-%d_%H%M%S") + "_" + slug + ".txt"
    with open(os.path.join(d, fichier), "w", encoding="utf-8", newline="\n") as f:
        f.write(open(chemin(deck), encoding="utf-8").read())
    meta = _meta_versions(deck)
    meta[fichier] = dict(nom=nom, note=note.strip(), date=datetime.now().isoformat(timespec="seconds"))
    json.dump(meta, open(os.path.join(d, "versions.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return f"{VERSIONS}/{fichier}"


def supprimer_version(deck, fichier):
    """Supprime une version nommée (jamais l'historique automatique ni la liste actuelle)."""
    if not fichier.replace("\\", "/").startswith(VERSIONS + "/"):
        raise ValueError("seules les versions nommées peuvent être supprimées")
    p = chemin_version(deck, fichier)
    os.remove(p)
    meta = _meta_versions(deck)
    meta.pop(os.path.basename(p), None)
    json.dump(meta, open(os.path.join(RACINE, deck, VERSIONS, "versions.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def versions(deck):
    """Toutes les versions : nommées, anciennes listes du dossier (liste_avant_…) et historique automatique."""
    actuelle = Counter(noms_jeu(lire(chemin(deck))))
    base = os.path.join(RACINE, deck)
    journal_p = os.path.join(base, HISTO, "journal.json")
    journal = json.load(open(journal_p, encoding="utf-8")) if os.path.exists(journal_p) else {}
    meta = _meta_versions(deck)
    fichiers = []
    for sous, typ in ((VERSIONS, "nommee"), (HISTO, "auto")):
        d = os.path.join(base, sous)
        if os.path.isdir(d):
            fichiers += [(f"{sous}/{f}", typ) for f in os.listdir(d) if f.endswith(".txt")]
    fichiers += [(f, "ancienne") for f in os.listdir(base) if f.startswith("liste") and f.endswith(".txt") and f != "liste-achat.txt"]
    res = []
    for rel, typ in fichiers:
        p = os.path.join(base, rel)
        try:
            v = Counter(noms_jeu(lire(p)))
        except (OSError, UnicodeDecodeError):
            continue
        if not v:
            continue
        b = os.path.basename(rel)
        m = meta.get(b, {}) if typ == "nommee" else {}
        res.append(dict(fichier=rel, type=typ, nom=libelle(deck, rel), note=m.get("note", "") or journal.get(b, ""),
                        date=os.path.getmtime(p), total=sum(v.values()),
                        plus=sorted((v - actuelle).elements()), moins=sorted((actuelle - v).elements())))
    return sorted(res, key=lambda x: -x["date"])


def comparer(deck, fa, fb):
    """Différences entre deux versions (fichier vide = liste actuelle) : cartes propres à chacune et cartes communes."""
    a, b = Counter(noms_jeu(lire(chemin_version(deck, fa)))), Counter(noms_jeu(lire(chemin_version(deck, fb))))
    return dict(a=dict(fichier=fa, nom=libelle(deck, fa), total=sum(a.values())), b=dict(fichier=fb, nom=libelle(deck, fb), total=sum(b.values())),
                seulement_a=sorted((a - b).elements()), seulement_b=sorted((b - a).elements()), communes=sum((a & b).values()))


def noms_jeu(entrees):
    out = []
    for e in entrees:
        if categorie(e) != "Maybeboard":
            out += [e["nom"]] * e["n"]
    return out


def restaurer(deck, fichier):
    entrees = lire(chemin_version(deck, fichier))
    enregistrer(deck, entrees, f"retour à « {libelle(deck, fichier)} »")
    return entrees
