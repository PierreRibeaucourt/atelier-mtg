"""Moteur de recherche de cartes de l'Atelier, sur le modèle de celui de Magic-Ville : mêmes fenêtres, mêmes règles
(Manas en trois rangées, Couleurs, Types, Recherche texte en français et en anglais, Valeur de mana, Force,
Endurance, Format, Rareté, Éditions), plus ce que Magic-Ville n'a pas : prix, fonction des cartes, popularité,
lien avec un deck.

La recherche se fait en local, sur une base construite à partir de Scryfall et refaite chaque semaine
(base_cartes.json.gz, hors du dépôt git) :
- default_cards (fichier complet, ≈ 80 Mo compressés, lu au fil du téléchargement) : texte Oracle, coût, types,
  légalités, et chaque impression (édition, rareté, prix Cardmarket du jour) ;
- les impressions françaises (recherche lang:fr, ≈ 340 pages espacées la première fois, ensuite seulement les
  nouvelles) : nom, type et texte imprimés en français ;
- oracle_tags (Scryfall Tagger) : la fonction des cartes (removal, ramp, pioche…) ;
- la liste des éditions ; les noms français des extensions viennent du moteur de Magic-Ville.
"""
import gzip
import json
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.request
from collections import Counter
from datetime import date, timedelta

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(ICI))
from prix import EDITIONS_DOUTEUSES, ENTETES, get  # noqa: E402

import decks  # noqa: E402
import infos_cartes as ic  # noqa: E402
import reglages  # noqa: E402

FICHIER = os.path.join(ICI, "base_cartes.json.gz")
VERSION = 1
DUREE = 7 * 86400                      # la base est refaite au moins chaque semaine (prix), et dès qu'une édition a de nouvelles cartes
VERIFICATION = 6 * 3600                # toutes les 6 h, l'Atelier demande à Scryfall la liste des éditions (une requête)
RECENTES = 150                         # éditions surveillées : sorties depuis moins de 150 jours, ou à venir (spoilers)
PAR_PAGE = 30                          # comme Magic-Ville
PAR_PAGE_CHOIX = (30, 60, 120, 240)    # « Par page » des listes de cartes (par= dans la requête)
COULEURS = "WUBRG"

# ---------------------------------------------------------------- ce que proposent les fenêtres
TYPES = {"AR": "Artifact", "CR": "Creature", "EN": "Enchantment", "IN": "Instant", "SO": "Sorcery",
         "BAT": "Battle", "PL": "Planeswalker", "LA": "Land"}
FORMATS = {"commander": "commander", "duel": "duel", "modern": "modern", "pioneer": "pioneer", "standard": "standard",
           "vintage": "vintage", "legacy": "legacy", "premodern": "premodern", "pauper": "pauper",
           "historic": "historic", "alchemy": "alchemy"}
SPECIAUX = {"TR", "TK", "DUN", "PN", "SC", "CH", "HE", "CO"}            # « Types spéciaux » de Magic-Ville
HORS_JEU = (SPECIAUX - {"TR"}) | {"ME"}                                  # écartés sauf si on les demande (ME : carte formée par assemblage)
RARETES = {"M": "m", "R": "r", "U": "u", "C": "c", "S": "s"}
# Rareté d'une carte : celle de sa version de base dans chaque édition (le plus petit numéro), et sans choix d'édition,
# seulement dans les éditions normales. Sol Ring n'est pas « mythique » parce qu'une variante numérotée d'un deck
# Commander, une Masterpiece ou un From the Vault l'est.
NORMALES = {"expansion", "core", "commander", "masters", "draft_innovation", "starter", "duel_deck", "planechase",
            "archenemy", "premium_deck"}

# Fonctions (Scryfall Tagger), avec leurs sous-fonctions : « removal » comprend removal-creature, sweeper, etc.
FONCTIONS = [
    ("ramp", "Ramp (accélération)", ["ramp"]),
    ("mana-rock", "Mana rock (artefact de mana)", ["mana-rock"]),
    ("mana-dork", "Mana dork (créature de mana)", ["mana-dork"]),
    ("reducteur", "Réduction de coût", ["cost-reducer"]),
    ("pioche", "Pioche", ["draw"]),
    ("avantage", "Avantage de cartes (pioche, impulsion…)", ["card-advantage"]),
    ("wheel", "Wheel (défausser sa main, repiocher)", ["wheel"]),
    ("tuteur", "Tuteur (chercher une carte)", ["tutor"]),
    ("removal", "Removal (tous)", ["removal"]),
    ("spot", "Removal ciblé", ["spot-removal"]),
    ("removal-creature", "Removal de créature", ["removal-creature"]),
    ("balayage", "Balayage (wrath)", ["sweeper"]),
    ("contresort", "Contresort", ["counterspell"]),
    ("burn", "Burn (blessures)", ["burn"]),
    ("pinger", "Pinger (1 ou 2 blessures répétées)", ["pinger"]),
    ("drain", "Drain de vie", ["drain-life"]),
    ("gain", "Gain de vie", ["lifegain"]),
    ("defausse", "Défausse (adversaires)", ["discard"]),
    ("outlet-defausse", "Se défausser (outlet de défausse)", ["discard-outlet"]),
    ("sacrifice", "Sacrifice outlet", ["sacrifice-outlet"]),
    ("mort", "Déclencheur de mort", ["death-trigger"]),
    ("recursion", "Recursion (retour du cimetière)", ["recursion"]),
    ("reanimation", "Réanimation", ["reanimate"]),
    ("meule", "Meule (mill)", ["mill"]),
    ("haine-cimetiere", "Haine du cimetière", ["hate-graveyard"]),
    ("jetons", "Jetons (création répétée)", ["repeatable-token-generator"]),
    ("tresors", "Trésors (création répétée)", ["repeatable-treasures"]),
    ("anthem", "Anthem (+N/+N à l'équipe)", ["anthem"]),
    ("celerite", "Donne la célérité", ["gives-haste"]),
    ("evasion", "Évasion", ["evasion"]),
    ("protection", "Protection", ["protection"]),
    ("blink", "Blink (exiler puis renvoyer)", ["flicker"]),
    ("bounce", "Renvoi en main (bounce)", ["bounce"]),
    ("vol", "Vol de contrôle", ["theft"]),
    ("copie", "Copie, clone", ["copy"]),
    ("degagement", "Dégagement (untap)", ["untapper"]),
    ("tours", "Tours supplémentaires", ["extra-turn"]),
    ("combats", "Combats supplémentaires", ["extra-combat-phase"]),
    ("multiplicateur", "Multiplicateur de blessures", ["damage-multiplier"]),
    ("brouillard", "Brouillard (fog)", ["fog"]),
    ("pillowfort", "Pillowfort (dissuader d'attaquer)", ["pillowfort"]),
    ("group-hug", "Group hug", ["group-hug"]),
]

# Fonctions d'une carte dans un deck (onglet Liste « ranger par fonction », statistiques) : les familles du gabarit d'un deck
# Commander, dans l'ordre qui choisit la famille principale d'une carte qui en a plusieurs (Cyclonic Rift : Balayages).
# (libellé, fonctions ci-dessus, fonctions Tagger exclues) : chercher un terrain (Cultivate, Solemn Simulacrum) est du ramp.
FAMILLES = [
    ("Balayages", ["balayage"], []),
    ("Contresorts", ["contresort"], []),
    ("Removal", ["removal"], []),
    ("Ramp", ["ramp", "mana-rock", "mana-dork", "reducteur", "tresors"], []),
    ("Tuteurs", ["tuteur"], ["tutor-land"]),
    ("Pioche", ["pioche", "avantage", "wheel"], []),
    ("Recursion", ["recursion", "reanimation"], []),
    ("Protection", ["protection"], []),
]
# dans la fiche, la fonction générale disparaît quand une plus précise est là (« Mana rock » plutôt que « Ramp, Mana rock »)
GENERALES = {"removal": ["spot", "removal-creature", "balayage"], "ramp": ["mana-rock", "mana-dork"], "avantage": ["pioche", "wheel"]}

GROUPES_EDITIONS = [
    ("expansion", "Extensions"), ("core", "Éditions de base"), ("commander", "Commander"),
    ("masters", "Rééditions (Masters)"), ("eternal", "Rééditions (Masters)"), ("draft_innovation", "Draft spécial (Horizons, Jumpstart…)"),
    ("box", "Secret Lair et coffrets"), ("arsenal", "Secret Lair et coffrets"), ("treasure_chest", "Secret Lair et coffrets"),
    ("masterpiece", "Masterpiece"), ("from_the_vault", "From the Vault"), ("spellbook", "Signature Spellbook"),
    ("premium_deck", "Premium Deck Series"), ("duel_deck", "Duel Decks"), ("planechase", "Planechase et Archenemy"),
    ("archenemy", "Planechase et Archenemy"), ("starter", "Starter et Portal"), ("funny", "Fantaisie (Un-sets)"),
    ("promo", "Promos"), ("alchemy", "MTG Arena (numérique)"), ("vanguard", "Vanguard"),
]

# Noms français des extensions et éditions de base (repris du moteur de recherche de Magic-Ville)
NOMS_FR_EDITIONS = {
    "sos": "Les secrets de Strixhaven", "ecl": "Lorwyn éclipsé", "eoe": "Aux portes des Éternités",
    "tdm": "Tarkir : la tempête des dragons", "dsk": "Mornebrume : La maison de l'horreur",
    "otj": "Les hors-la-loi de Croisetonnerre", "mkm": "Meurtres au manoir Karlov", "lci": "Les cavernes oubliées d'Ixalan",
    "woe": "Les friches d'Eldraine", "mat": "L'Invasion des machines : Le jour d'après", "mom": "L'invasion des machines",
    "one": "Tous Phyrexians", "bro": "La Guerre Fratricide", "dmu": "Dominaria Uni",
    "snc": "Les rues de la Nouvelle-Capenna", "neo": "Kamigawa : la dynastie Néon", "vow": "Innistrad : noce écarlate",
    "mid": "Innistrad : chasse de minuit", "afr": "Dungeons & Dragons: Aventures dans les Royaumes Oubliés",
    "stx": "Strixhaven L'académie des mages", "znr": "Renaissance de Zendikar", "iko": "Ikoria : la terre des béhémoths",
    "thb": "Theros par-delà la mort", "eld": "Le trône d'Eldraine", "war": "La guerre des planeswalkers",
    "rna": "L'allégeance de Ravnica", "grn": "Les guildes de Ravnica", "rix": "Les combattants d'Ixalan",
    "hou": "L'Âge de la Destruction", "aer": "La révolte éthérique", "emn": "La lune hermétique",
    "soi": "Ténèbres sur Innistrad", "ogw": "Le serment des Sentinelles", "bfz": "La bataille de Zendikar",
    "dtk": "Les dragons de Tarkir", "frf": "Destin Reforgé", "ktk": "Les Khans de Tarkir", "jou": "Incursion dans Nyx",
    "bng": "Créations divines", "dgm": "Le labyrinthe du dragon", "gtc": "Insurrection", "rtr": "Retour sur Ravnica",
    "avr": "Avacyn ressuscitée", "dka": "Obscure ascension", "nph": "La Nouvelle Phyrexia", "mbs": "Mirrodin assiégé",
    "som": "Les cicatrices de Mirrodin", "roe": "L'ascension des Eldrazi", "arb": "La renaissance d'Alara",
    "ala": "Les éclats d'Alara", "eve": "Coucheciel", "shm": "Sombrelande", "mor": "Lèveciel", "fut": "Vision de l'avenir",
    "plc": "Chaos planaire", "tsp": "Spirale temporelle", "dis": "Discorde", "gpt": "Le Pacte des guildes",
    "rav": "Ravnica : la Cité des Guildes", "sok": "Libérateurs de Kamigawa", "bok": "Traîtres de Kamigawa",
    "chk": "Guerriers de Kamigawa", "5dn": "La cinquième aube", "dst": "Sombracier", "scg": "Fléau", "lgn": "Légions",
    "ons": "Carnage", "jud": "Jugement", "tor": "Tourment", "ody": "Odyssée", "pcy": "Prophétie",
    "mmq": "Masques de Mercadia", "uds": "La destinée d'Urza", "ulg": "L'héritage d'Urza", "usg": "L'épopée d'Urza",
    "exo": "Exode", "sth": "Forteresse", "tmp": "Tempête", "wth": "Aquilon", "csp": "Souffle glaciaire",
    "ice": "Ère Glaciaire", "hml": "Terres Natales", "hob": "Le Hobbit", "big": "Croisetonnerre - The Big Score",
    "m21": "Édition de base 2021", "m20": "Édition de base 2020", "m19": "Magic 2019", "ori": "Magic Origines",
    "10e": "10ème Edition", "9ed": "9ème Edition", "8ed": "8ème Edition", "7ed": "7ème Edition", "6ed": "6ème Edition",
    "5ed": "5ème Edition", "4ed": "4ème Edition", "3ed": "3ème Edition", "2ed": "Unlimited", "leb": "Limited (Beta)",
    "lea": "Limited (Alpha)", "sum": "Summer Magic",
}


etat = dict(actif=False, etape="", fait=0, total=0, erreur="", unite="")
_verrou = threading.RLock()
_base = None                         # la base prête à chercher (chargée une fois)


# ---------------------------------------------------------------- outils
def _norm(s):
    """Minuscules sans accents, apostrophes droites : « Éclair » et « eclair », « l’ » et « l' » se valent."""
    s = unicodedata.normalize("NFD", (s or "").lower().replace("’", "'").replace("‘", "'"))
    return re.sub(r"\s+", " ", "".join(ch for ch in s if unicodedata.category(ch) != "Mn"))


def _symboles(cout):
    return re.findall(r"\{([^}]+)\}", cout or "")


def _colores(syms):
    """Symboles colorés d'un coût : [(couleurs, souple)] ; souple = payable sans cette couleur ({W/P}, {2/W})."""
    res = []
    for s in syms:
        cols = frozenset(ch for ch in s.split("/") if ch in COULEURS)
        if cols:
            res.append((cols, "P" in s.split("/") or any(p.isdigit() for p in s.split("/"))))
    return res


def _image(chemin, taille="normal"):
    return f"https://cards.scryfall.io/{taille}/{chemin}" if chemin else ""


def _chemin_image(c):
    faces = c.get("card_faces") or [c]
    url = (c.get("image_uris") or faces[0].get("image_uris") or {}).get("normal", "")
    return url.split("/normal/", 1)[1] if "/normal/" in url else ""


def _pt(c):
    return ic._pt(c)


# ---------------------------------------------------------------- construction de la base
class _Compteur:
    """Compte les octets téléchargés (barre d'avancement)."""
    def __init__(self, r):
        self.r = r

    def read(self, n=-1):
        b = self.r.read(n)
        etat["fait"] += len(b)
        return b


def _fichier_complet(type_, avec_date=False):
    r = get("https://api.scryfall.com/bulk-data")
    for b in (r or {}).get("data", []):
        if b["type"] == type_:
            res = (b.get("jsonl_download_uri") or b["download_uri"], b.get("compressed_size") or b.get("size") or 0)
            return res + (b.get("updated_at", ""),) if avec_date else res
    raise RuntimeError(f"Scryfall ne propose plus le fichier {type_}")


def _lignes(url):
    req = urllib.request.Request(url, headers={"User-Agent": ENTETES["User-Agent"]})
    with urllib.request.urlopen(req, timeout=180) as r:
        brut = _Compteur(r) if url.endswith(".gz") or r.headers.get("Content-Encoding") != "gzip" else r
        flux = gzip.GzipFile(fileobj=brut) if url.endswith(".gz") else brut
        for ligne in flux:
            ligne = ligne.strip().rstrip(b",")
            if ligne.startswith(b"{"):
                yield json.loads(ligne)


def _rang_impression(c):
    """Plus petit = meilleure impression pour représenter la carte : papier, édition normale, en anglais, la plus récente."""
    speciale = c.get("promo") or c.get("set_type") in ("promo", "box", "masterpiece", "token", "funny") or c.get("set") == "plst"
    jour = int((c.get("released_at") or "0").replace("-", "") or 0)
    return (bool(c.get("digital")), bool(speciale), c.get("lang", "en") != "en", not _chemin_image(c), -jour)


def _speciale(c):
    lay, t = c.get("layout", ""), c.get("type_line", "")
    if lay == "meld" and any(x.get("component") == "meld_result" and x.get("name") == c.get("name") for x in c.get("all_parts") or []):
        return "ME"                                    # Brisela : formée par Bruna + Gisela, elle ne se met pas dans un deck
    if lay in ("token", "double_faced_token", "emblem") or t.startswith("Token"):
        return "TK"
    if lay == "planar":
        return "PN"
    if lay == "scheme":
        return "SC"
    if lay == "vanguard":
        return "CH"
    if "Dungeon" in t:
        return "DUN"
    if re.search(r"\bHero\b", t.split("—")[0]):
        return "HE"
    if "Conspiracy" in t:
        return "CO"
    return ""


def _carte(c):
    """Ce qu'on garde d'une carte (le texte Oracle est le même dans toutes ses impressions)."""
    faces = c.get("card_faces") or []
    cout = c["mana_cost"] if "mana_cost" in c else " // ".join(f["mana_cost"] for f in faces if f.get("mana_cost"))
    texte = c["oracle_text"] if "oracle_text" in c else "\n//\n".join(f.get("oracle_text", "") for f in faces)
    couleurs = c.get("colors")
    if couleurs is None:
        couleurs = sorted({k for f in faces for k in f.get("colors") or []})
    avant = next((f for f in [c] + faces if f.get("power") is not None), {})
    leg = [k for k, v in (c.get("legalities") or {}).items() if v in ("legal", "restricted")]
    return dict(n=c["name"], c=cout, mv=c.get("cmc", 0), t=c.get("type_line") or " // ".join(f.get("type_line", "") for f in faces),
                o=texte, co="".join(k for k in COULEURS if k in couleurs), ci="".join(k for k in COULEURS if k in c.get("color_identity", [])),
                p=avant.get("power"), e=avant.get("toughness"), l=next((f.get("loyalty") for f in [c] + faces if f.get("loyalty")), None),
                pt=_pt(c), lay=c.get("layout", ""), lg=leg, gc=bool(c.get("game_changer")), rk=c.get("edhrec_rank"),
                spe=_speciale(c), fr="", tf="", of="")


def _cartes_et_impressions():
    url, taille, maj = _fichier_complet("default_cards", avec_date=True)
    etat.update(etape="Cartes et impressions (fichier complet de Scryfall)", fait=0, total=taille, unite="octets")
    cartes, meilleure = {}, {}
    comptes = Counter()                  # cartes de chaque édition dans le fichier (comparé ensuite à ce qu'annonce Scryfall)
    for c in _lignes(url):
        comptes[c.get("set", "")] += 1
        if c.get("layout") == "art_series" or c.get("set_type") in ("memorabilia", "minigame"):
            continue
        faces = c.get("card_faces") or []
        oid = c.get("oracle_id") or (faces[0].get("oracle_id") if faces else None)
        if not oid:
            continue
        x = cartes.get(oid)
        if x is None:
            if c.get("layout") == "reversible_card":
                continue                               # face réversible (Secret Lair) : la carte viendra d'une impression normale
            x = cartes[oid] = _carte(c)
            x.update(id=oid, pr=[], eur=None, foil=False, s0="", d0="", dig=True, fun=True, ts=False, im=None)
        if c.get("frame") == "future" or "colorshifted" in (c.get("frame_effects") or []) or c.get("set") == "tsb":
            x["ts"] = True
        if c.get("set_type") != "funny":
            x["fun"] = False
        if c.get("digital"):
            continue                                   # les impressions numériques ne comptent ni pour les éditions ni pour le prix
        x["dig"] = False
        p = c.get("prices") or {}
        eur = float(p["eur"]) if p.get("eur") else None
        foil = float(p["eur_foil"]) if p.get("eur_foil") else None
        fiable = not (c.get("set") in EDITIONS_DOUTEUSES or c.get("border_color") == "gold" or c.get("oversized")
                      or c.get("set_type") == "token")
        if fiable and eur is not None and (x["eur"] is None or x["foil"] or eur < x["eur"]):
            x["eur"], x["foil"] = eur, False
        elif fiable and eur is None and foil is not None and (x["eur"] is None or (x["foil"] and foil < x["eur"])):
            x["eur"], x["foil"] = foil, True           # carte qui n'existe qu'en foil (ex. Greven, C19)
        d = c.get("released_at") or ""
        x["pr"].append([c["set"], c["collector_number"], (c.get("rarity") or "?")[0], d, eur if eur is not None else foil,
                        _chemin_image(c), c.get("lang", "en"), int(ic._ub(c))])      # 1 : impression Universes Beyond
        if d and not c.get("promo") and c.get("set_type") not in ("promo", "token") and (not x["d0"] or d < x["d0"]):
            x["d0"], x["s0"] = d, c["set"]             # première édition (pour « Nouvelles cartes uniquement »)
        r = _rang_impression(c)
        if oid not in meilleure or r < meilleure[oid][0]:
            faces = c.get("card_faces") or []
            dos = (faces[1].get("image_uris") or {}).get("normal", "") if len(faces) > 1 else ""
            meilleure[oid] = (r, c["set"], c["collector_number"], dos.split("/normal/", 1)[1] if "/normal/" in dos else "")
    for oid, x in cartes.items():
        x["pr"].sort(key=lambda p: p[3], reverse=True)
        if x["pr"] and oid in meilleure:
            _, s, n, dos = meilleure[oid]
            x["im"] = next((i for i, p in enumerate(x["pr"]) if p[0] == s and p[1] == n), 0)
            x["imd"] = dos
        if not x["d0"] and x["pr"]:
            x["d0"], x["s0"] = min((p[3], p[0]) for p in x["pr"])
    return cartes, dict(comptes), maj


def _tags(cartes):
    url, taille = _fichier_complet("oracle_tags")
    etat.update(etape="Fonctions des cartes (Scryfall Tagger)", fait=0, total=taille, unite="octets")
    tags, par_carte, index = [], {}, {}
    brut = list(_lignes(url))
    for t in brut:
        index[t["id"]] = len(tags)
        tags.append(dict(s=t["slug"], d=(t.get("description") or "")[:200], e=[]))
    for t in brut:
        i = index[t["id"]]
        tags[i]["e"] = [index[e] for e in t.get("child_ids") or [] if e in index]
        for g in t.get("taggings") or []:
            if g.get("oracle_id") in cartes:
                par_carte.setdefault(g["oracle_id"], []).append(i)
    for oid, liste in par_carte.items():
        cartes[oid]["tg"] = sorted(set(liste))
    return tags


def _editions(cartes):
    etat.update(etape="Éditions", fait=0, total=1, unite="")
    r = get("https://api.scryfall.com/sets") or {}
    nb = Counter(p[0] for x in cartes.values() for p in x["pr"])
    noms_fr = NOMS_FR_EDITIONS
    res = {}
    for s in r.get("data", []):
        if s["set_type"] in ("token", "memorabilia", "minigame") or not nb.get(s["code"]):      # éditions papier seulement
            continue
        res[s["code"]] = dict(n=s["name"], fr=noms_fr.get(s["code"], ""), ty=s["set_type"], d=s.get("released_at") or "",
                              nb=nb.get(s["code"], s.get("card_count", 0)), ic=s.get("icon_svg_uri", ""),
                              pa=s.get("parent_set_code") or "", dig=bool(s.get("digital")))
    etat["fait"] = 1
    return res


def _commandants(cartes):
    """Qui peut être commandant (is:commander) et qui peut en accompagner un autre (is:partner : Partner, Historique,
    compagnon du Docteur…), selon Scryfall, qui suit les règles officielles."""
    for cle, q in (("cm", "is:commander"), ("pa", "is:partner")):
        r = get("https://api.scryfall.com/cards/search", {"q": q, "unique": "cards"})
        etat.update(etape="Commandants possibles et partenaires", fait=0, total=(r or {}).get("total_cards", 0), unite="cartes")
        while r:
            for c in r.get("data", []):
                etat["fait"] += 1
                oid = c.get("oracle_id") or ((c.get("card_faces") or [{}])[0].get("oracle_id"))
                if oid in cartes:
                    cartes[oid][cle] = True
            r = get(r["next_page"]) if r.get("has_more") else None


def _francais(cartes, depuis=None):
    """Nom, type et texte imprimés en français. Les impressions sont lues des plus récentes aux plus anciennes : chaque
    élément vient de la plus récente qui l'a vraiment en français (certaines gardent le nom anglais, ex. Delver of
    Secrets en MID, alors que l'édition d'Innistrad dit « Sondeur de secrets »)."""
    q = "lang:fr" + (f" date>={depuis}" if depuis else "")
    r = get("https://api.scryfall.com/cards/search", {"q": q, "unique": "prints", "order": "released", "dir": "desc"})
    etat.update(etape="Noms et textes français" + (" (nouvelles impressions)" if depuis else ""), fait=0,
                total=(r or {}).get("total_cards", 0), unite="impressions")
    vus = set()                          # éléments déjà pris pendant ce passage (les plus récents gagnent)
    while r:
        for c in r.get("data", []):
            etat["fait"] += 1
            faces = c.get("card_faces") or []
            oid = c.get("oracle_id") or (faces[0].get("oracle_id") if faces else None)
            x = cartes.get(oid)
            if not x:
                continue
            nom = c.get("printed_name") or " // ".join(f.get("printed_name") or "" for f in faces).strip(" /")
            typ = c.get("printed_type_line") or " // ".join(f.get("printed_type_line") or "" for f in faces).strip(" /")
            texte = c.get("printed_text") if c.get("printed_text") else "\n//\n".join(f.get("printed_text") or "" for f in faces).strip("\n/")
            for cle, val, anglais in (("fr", nom, x["n"]), ("tf", typ, x["t"]), ("of", texte, x["o"])):
                if not val or _norm(val) == _norm(anglais) or (oid, cle) in vus:
                    continue
                if depuis or not x[cle]:
                    x[cle] = val
                    vus.add((oid, cle))
        r = get(r["next_page"]) if r.get("has_more") else None


def _lire_fichier():
    if not os.path.exists(FICHIER):
        return None
    try:
        with gzip.open(FICHIER, "rt", encoding="utf-8") as f:
            b = json.load(f)
        return b if b.get("version") == VERSION else None
    except Exception:
        return None


def construire(complet=False):
    """(Re)fait la base. complet=True : relit aussi toutes les impressions françaises (sinon seulement les nouvelles)."""
    with _verrou:
        if etat["actif"]:
            return
        etat.update(actif=True, etape="Préparation", fait=0, total=0, erreur="", unite="")
    try:
        # textes français déjà lus : ceux de la base en mémoire (sinon du fichier), pour ne relire que les nouvelles impressions
        ancienne = _base or _lire_fichier()
        cartes, comptes, maj = _cartes_et_impressions()
        tags = _tags(cartes)
        editions = _editions(cartes)
        _commandants(cartes)
        depuis = None
        if ancienne and not complet and ancienne.get("date_fr"):
            vieux = {x["id"]: x for x in ancienne["cartes"]}
            for oid, x in cartes.items():
                v = vieux.get(oid)
                if v:
                    x.update(fr=v.get("fr", ""), tf=v.get("tf", ""), of=v.get("of", ""))
            depuis = (date.fromisoformat(ancienne["date_fr"]) - timedelta(days=30)).isoformat()
            del vieux
        del ancienne
        date_fr = None
        try:
            _francais(cartes, depuis)
            date_fr = date.today().isoformat()
        except Exception as e:               # réseau coupé en route : on garde ce qu'on a, on finira la fois suivante
            etat["erreur"] = f"textes français incomplets : {e}"
            date_fr = _base.get("date_fr") if _base and depuis else None
        etat.update(etape="Enregistrement", fait=0, total=0, unite="")
        base = dict(version=VERSION, date=time.time(), date_fr=date_fr, cartes=list(cartes.values()), tags=tags, editions=editions,
                    comptes=comptes, bulk=maj, cmd_v=1)
        tmp = FICHIER + ".tmp"
        with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as f:
            json.dump(base, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, FICHIER)
        _preparer(base)
        suivi.update(verifie=time.time(), nouveautes=[])
    except Exception as e:
        etat["erreur"] = str(e)
    finally:
        etat.update(actif=False, etape="", fait=0, total=0)


suivi = dict(verifie=0, nouveautes=[], prochaine=0)      # dernière vérification auprès de Scryfall


def nouveautes():
    """Éditions récentes ou à venir qui ont, chez Scryfall, plus de cartes que dans la base (nouvelle extension, spoilers)."""
    b = _base
    r = get("https://api.scryfall.com/sets") or {}
    limite = (date.today() - timedelta(days=RECENTES)).isoformat()
    res = []
    for s in r.get("data", []):
        if s.get("digital") or s["set_type"] in ("token", "memorabilia", "minigame", "alchemy"):
            continue
        if (s.get("released_at") or "9999") < limite or not s.get("card_count"):
            continue
        if s["card_count"] > (b.get("comptes") or {}).get(s["code"], 0):
            res.append(NOMS_FR_EDITIONS.get(s["code"]) or s["name"])
    return res


def verifier(force=False):
    """Refait la base si Scryfall a de nouvelles cartes (et que son fichier complet les contient déjà), ou si elle a plus
    d'une semaine. force=True : la refait dans tous les cas (bouton « Mettre à jour maintenant »)."""
    b = _base
    if etat["actif"]:
        return
    if force or b is None or not b.get("comptes") or not b.get("date_fr") or not b.get("cmd_v"):
        return construire()
    nouv = nouveautes()
    suivi.update(verifie=time.time(), nouveautes=nouv)
    vieille = time.time() - b["date"] > DUREE
    if nouv or vieille:
        _, _, maj = _fichier_complet("default_cards", avec_date=True)
        if vieille or maj > (b.get("bulk") or ""):          # sinon : Scryfall n'a pas encore refait son fichier, on repassera
            construire()


def demarrer():
    """Au lancement de l'Atelier : charge la base, la refait si besoin, puis la surveille tant que l'Atelier est ouvert."""
    try:
        b = _lire_fichier()
        if b:
            _preparer(b)
            noms_cites()                      # prêts pour la première page
        verifier()
    except Exception as e:
        etat["erreur"] = str(e)
    while True:
        suivi["prochaine"] = time.time() + VERIFICATION
        time.sleep(VERIFICATION)
        try:
            verifier()
        except Exception as e:                # pas de réseau : on réessaiera à la prochaine vérification
            etat["erreur"] = str(e)


# ---------------------------------------------------------------- base en mémoire
def _preparer(b):
    global _base
    cartes = b["cartes"]
    for x in cartes:
        x["_n"], x["_nf"] = _norm(x["n"]), _norm(x.get("fr"))
        x["_t"], x["_tf"] = _norm(x["t"]), _norm(x.get("tf"))
        x["_o"], x["_of"] = _norm(x["o"]), _norm(x.get("of"))
        moities = [_symboles(m) for m in (x["c"] or "").split(" // ")]
        x["_moities"] = moities
        x["_sym"] = [s for m in moities for s in m]
        x["_col"] = _colores(x["_sym"])
        x["_x"] = "X" in x["_sym"]
        x["_types"] = set(re.findall(r"[A-Za-z]+", " ".join(f.split("—")[0] for f in x["t"].split(" // "))))
        x["_tg"] = set(x.get("tg") or [])
        x["_sets"] = {p[0] for p in x["pr"]}
        x["_base"] = {}                                  # version de base de chaque édition (le plus petit numéro)
        for pr in x["pr"]:
            if pr[0] not in x["_base"] or _numero(pr[1]) < _numero(x["_base"][pr[0]][1]):
                x["_base"][pr[0]] = pr
        x["_lg"] = set(x["lg"])
        x["_cle"] = ic._cle(x["n"]).lower()
    slugs = {t["s"]: i for i, t in enumerate(b["tags"])}
    par_tag = {}                                        # fonction -> cartes jouables qui l'ont (pour compter les cartes)
    for k, x in enumerate(cartes):
        if x["spe"] not in HORS_JEU and not x["dig"] and not x["fun"]:
            for t in x["_tg"]:
                par_tag.setdefault(t, []).append(k)
    _base = dict(cartes=cartes, tags=b["tags"], slugs=slugs, editions=b["editions"], date=b["date"], date_fr=b.get("date_fr"),
                 comptes=b.get("comptes"), bulk=b.get("bulk"), cmd_v=b.get("cmd_v"), descendants={}, fonctions={}, par_tag=par_tag,
                 par_cle={x["_cle"]: x for x in cartes if x["spe"] != "ME"})
    for cle, _, liste in FONCTIONS:
        _base["fonctions"][cle] = set().union(*[_descendants(s) for s in liste]) if liste else set()


def _numero(n):
    m = re.match(r"\d+", n or "")
    return int(m.group()) if m else 10 ** 6


def _descendants(slug):
    b = _base
    if slug in b["descendants"]:
        return b["descendants"][slug]
    i = b["slugs"].get(slug)
    vus = set()
    pile = [i] if i is not None else []
    while pile:
        k = pile.pop()
        if k not in vus:
            vus.add(k)
            pile.extend(b["tags"][k]["e"])
    b["descendants"][slug] = vus
    return vus


def base():
    global _base
    if _base is None:
        b = _lire_fichier()
        if b:
            _preparer(b)
    return _base


def etat_base():
    b = _base
    return dict(prete=b is not None, date=b and b["date"], date_fr=b and b["date_fr"], nb=len(b["cartes"]) if b else 0,
                construction=dict(etat), verifie=suivi["verifie"], nouveautes=suivi["nouveautes"], prochaine=suivi["prochaine"])


# ---------------------------------------------------------------- critères
def _lettres(s, permis):
    return {ch for ch in (s or "").upper() if ch in permis}


def _nombre(s):
    try:
        return float(str(s).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _termes(q):
    """« add et », « "add et" » (expression exacte), « !additio » (mot exclu) -> (à trouver, à exclure)."""
    incl, excl = [], []
    for m in re.finditer(r'(!?)"([^"]+)"|(\S+)', _norm(q)):
        if m.group(2) is not None:
            (excl if m.group(1) else incl).append(m.group(2).strip())
        else:
            mot = m.group(3)
            if mot.startswith("!"):
                if len(mot) > 1:
                    excl.append(mot[1:])
            else:
                incl.append(mot)
    return [t for t in incl if t], [t for t in excl if t]


def _ok_texte(textes, incl, excl):
    """Tous les mots dans le même texte (français ou anglais), aucun mot exclu dans aucun des deux."""
    if excl and any(t in h for h in textes for t in excl):
        return False
    return not incl or any(all(t in h for t in incl) for h in textes)


def _motif(s):
    """Coût exact : « 2UU », « {1}{B}{R} », « U? » (plus un mana générique quelconque), « U** » (deux colorés quelconques)."""
    s = (s or "").upper().replace(" ", "")
    toks = re.findall(r"\{([^}]+)\}", s) if "{" in s else re.findall(r"\d+|[WUBRGCXS?*]", s)
    gen, cols, autres = None, [], Counter()
    for t in toks:
        if t.isdigit():
            gen = (gen if isinstance(gen, int) else 0) + int(t)
        elif t == "?":
            gen = "?"
        elif t == "*":
            cols.append(None)
        elif any(k in t for k in COULEURS):
            cols.append(frozenset(k for k in t if k in COULEURS))
        else:
            autres[t] += 1
    return gen, cols, autres


def _ok_motif(syms, motif):
    gen, cols, autres = motif
    g = sum(int(s) for s in syms if s.isdigit())
    if (gen is None and g) or (isinstance(gen, int) and g != gen) or (gen == "?" and not g):
        return False
    if Counter(s for s in syms if s in ("C", "X", "Y", "Z", "S")) != autres:
        return False
    carte = [frozenset(k for k in s.split("/") if k in COULEURS) for s in syms if any(k in s for k in COULEURS)]
    if len(carte) != len(cols):
        return False

    def place(i, libres):              # chaque symbole du motif sur un symbole de la carte (hybride compris)
        if i == len(cols):
            return True
        for j in list(libres):
            if cols[i] is None or cols[i] & carte[j]:
                libres.discard(j)
                if place(i + 1, libres):
                    return True
                libres.add(j)
        return False
    return place(0, set(range(len(carte))))


def _ok_couleurs(cc, sel, incolore, toutes, seules, oblig=frozenset()):
    """oblig : les couleurs choisies que la carte doit avoir (second clic sur la couleur), les autres choisies sont permises."""
    if not sel and not incolore:
        return True
    ok = (sel <= cc and (not incolore or not cc)) if toutes else (bool(cc & sel) or (incolore and not cc))
    return ok and oblig <= cc and (not seules or cc <= sel)


def _compare(v, eq, mn, mx):
    return (eq is None or v == eq) and (mn is None or v >= mn) and (mx is None or v <= mx)


def _ok_pt(val, eq, mn, mx, etoile):
    if eq is None and mn is None and mx is None:
        return True
    if val is None:
        return False
    if not re.fullmatch(r"-?\d+(\.\d+)?", val):          # *, 1+*, X : selon « * inclus »
        return etoile
    return _compare(float(val), eq, mn, mx)


def _deck(deck):
    """Cartes du deck lié : {clé de nom: "commandant" | "deck" | "maybe"}."""
    if not deck:
        return {}
    try:
        entrees = decks.lire(decks.chemin(deck))
    except Exception:
        return {}
    res = {}
    for e in entrees:
        cat = decks.categorie(e)
        k = ic._cle(e["nom"]).lower()
        v = "commandant" if cat == "Commander" else "maybe" if cat == "Maybeboard" else "deck"
        if res.get(k) in (None, "maybe"):
            res[k] = v
    return res


# ---------------------------------------------------------------- recherche
def _filtre(p, b):
    """Les critères (paramètres de la page) -> une fonction carte -> bool."""
    g = lambda k: (p.get(k) or "").strip()          # noqa: E731
    oui = lambda k: g(k) == "1"                     # noqa: E731
    fr, en = oui("fr"), oui("en")
    if not fr and not en:
        fr = en = True
    tests = []

    def langues(x, cle):
        return ([x["_" + cle]] if en else []) + ([x["_" + cle + "f"]] if fr and x["_" + cle + "f"] else [])

    for champ, cle in (("nom", "n"), ("type", "t"), ("texte", "o")):
        if g(champ):
            incl, excl = _termes(g(champ))
            tests.append(lambda x, cle=cle, incl=incl, excl=excl: _ok_texte(langues(x, cle), incl, excl))
    if oui("vanilla"):
        tests.append(lambda x: not x["o"].strip())

    # Manas
    if g("cout"):
        motif = _motif(g("cout"))
        tests.append(lambda x: any(_ok_motif(m, motif) for m in x["_moities"]))
    if oui("un"):                                    # un seul symbole par couleur ; l'hybride compte pour ses deux couleurs
        tests.append(lambda x: all(sum(1 for cols, _ in x["_col"] if k in cols) <= 1 for k in COULEURS))
    spe = g("spe")
    if spe:
        f = {"colorless": lambda x: "C" in x["_sym"], "split": lambda x: x["lay"] == "split",
             "flip": lambda x: x["lay"] == "flip", "dfc": lambda x: x["lay"] in ("transform", "modal_dfc", "meld"),
             "adv": lambda x: x["lay"] == "adventure", "hyb": lambda x: any("/" in s and "P" not in s for s in x["_sym"]),
             "phy": lambda x: any("P" in s.split("/") for s in x["_sym"]), "time": lambda x: x["ts"],
             "historic": lambda x: bool(x["_types"] & {"Legendary", "Artifact", "Saga"}), "X": lambda x: x["_x"]}.get(spe)
        if f:
            tests.append(f)

    # Couleurs
    # chaque couleur choisie « peut » (au moins une d'elles) ou « doit » (oblig), et aucune autre couleur que celles
    # choisies (pour en permettre d'autres, on les choisit aussi). cm=2 (ancienne case « Toutes ») : toutes obligatoires.
    oblig = _lettres(g("oblig"), COULEURS)
    sel, incolore = _lettres(g("coul"), COULEURS) | oblig, "C" in g("coul").upper()
    if g("cm") == "2":
        oblig = set(sel)
    if sel or incolore:
        ident = oui("id")
        tests.append(lambda x: _ok_couleurs(set(x["ci"] if ident else x["co"]), sel, incolore, False, True, oblig))

    # Types
    types = [TYPES[t] for t in g("types").split(",") if t in TYPES]
    if types:
        tous = g("tm") == "2"
        tests.append(lambda x: (all if tous else any)(t in x["_types"] for t in types))
    spt = g("spt")
    if spt == "TR":
        tests.append(lambda x: bool(x["_types"] & {"Kindred", "Tribal"}))
    elif spt in SPECIAUX:
        tests.append(lambda x: x["spe"] == spt)
    else:
        tests.append(lambda x: x["spe"] not in HORS_JEU)

    # Valeur de mana, force, endurance
    eq, mn, mx = _nombre(g("mv")), _nombre(g("mvmin")), _nombre(g("mvmax"))
    pair, impair, avec_x = oui("pair"), oui("impair"), oui("mvx")
    if eq is not None or mn is not None or mx is not None or pair or impair:
        def ok_mv(x):
            v = x["mv"]
            if x["_x"]:
                if not avec_x:
                    return False
                return (eq is None or v <= eq) and (mx is None or v <= mx)        # X peut faire monter la valeur
            if not _compare(v, eq, mn, mx):
                return False
            return not ((pair and v % 2) or (impair and not v % 2))
        tests.append(ok_mv)
    for cle, champ in (("p", "f"), ("e", "e")):
        eq2, mn2, mx2 = _nombre(g(champ)), _nombre(g(champ + "min")), _nombre(g(champ + "max"))
        if eq2 is not None or mn2 is not None or mx2 is not None:
            etoile = oui(champ + "x")
            tests.append(lambda x, cle=cle, a=eq2, b_=mn2, c=mx2, s=etoile: _ok_pt(x[cle], a, b_, c, s))

    # Format, rareté, éditions
    fmt = FORMATS.get(g("format"))
    if fmt:
        tests.append(lambda x: fmt in x["_lg"])
    eds = {e for e in g("eds").lower().split(",") if e}
    rar = {RARETES[k] for k in g("rar").upper() if k in RARETES}
    if rar:
        tests.append(lambda x: any(_ok_impression(pr, eds, rar, b) for pr in x["_base"].values()))
    elif eds:
        tests.append(lambda x: bool(x["_sets"] & eds))
        if eds and oui("neuves"):
            tests.append(lambda x: x["s0"] in eds)
    numerique = fmt in ("historic", "alchemy") or any(b["editions"].get(e, {}).get("dig") for e in eds)
    if not numerique:
        tests.append(lambda x: not x["dig"])
    if not oui("fun") and not any(b["editions"].get(e, {}).get("ty") == "funny" for e in eds):
        tests.append(lambda x: not x["fun"])

    # En plus de Magic-Ville : prix, Game Changers, fonction, deck
    pmax, pmin = _nombre(g("prixmax")), _nombre(g("prixmin"))
    if pmax is not None or pmin is not None:
        tests.append(lambda x: x["eur"] is not None and _compare(x["eur"], None, pmin, pmax))
    if g("gc") == "sans":
        tests.append(lambda x: not x["gc"])
    elif g("gc") == "seul":
        tests.append(lambda x: x["gc"])
    if g("cmd") == "peut":
        tests.append(lambda x: x.get("cm", False))
    elif g("cmd") == "duo":
        tests.append(lambda x: x.get("pa", False))
    for fn in [f for f in g("fn").split(",") if f]:      # plusieurs fonctions : la carte doit les avoir toutes
        cibles = b["fonctions"].get(fn) or _descendants(fn)
        tests.append(lambda x, cibles=cibles: bool(x["_tg"] & cibles))
    return tests


def _ok_impression(pr, eds, rar, b):
    if eds and pr[0] not in eds:
        return False
    if rar and (pr[2] not in rar or (not eds and b["editions"].get(pr[0], {}).get("ty") not in NORMALES)):
        return False
    return True


def _cle_couleur(x):
    """Comme Magic-Ville : blanc, bleu, noir, rouge, vert, puis les bicolores et les multicolores (dans l'ordre WUBRG),
    les incolores (artefacts…), enfin les terrains."""
    cc = x["co"]
    if "Land" in x["_types"] and not cc:
        return (8, ())
    if not cc:
        return (7, ())
    if len(cc) == 1:
        return (COULEURS.index(cc), ())
    return (5 + (len(cc) > 2), tuple(COULEURS.index(k) for k in cc))


TRIS = {
    "couleur": lambda x: (_cle_couleur(x), x["mv"], x["_n"]),       # dans chaque couleur : coût de mana croissant
    "nom": lambda x: x["_n"],
    "nomfr": lambda x: (x["_nf"] or x["_n"]),
    "type": lambda x: (_rang_type(x), x["_n"]),
    "cout": lambda x: (x["mv"], x["_n"]),
    "prix": lambda x: (x["eur"] is None, x["eur"] or 0, x["_n"]),
    "pop": lambda x: (x["rk"] is None, x["rk"] or 0),
    "date": lambda x: (x["d0"] or "", x["_n"]),
}
ORDRE_TYPES = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land"]


def _rang_type(x):
    if "Land" in x["_types"]:
        return 7
    return next((i for i, t in enumerate(ORDRE_TYPES) if t in x["_types"]), 8)


def _sortie(x, b, dans, imp=None, jour=None):
    pr = x["pr"]
    p = imp if imp is not None else (pr[x["im"]] if x.get("im") is not None and pr else None)
    if imp is None and p and len(p) > 7 and p[7] and reglages.impression()[1]:      # Options : éviter les Universes Beyond
        p = next((q for q in pr if len(q) > 7 and not q[7] and q[5]), p)          # (base d'avant : on ne sait pas)
    ed = b["editions"].get(p[0], {}) if p else {}
    prix = x["eur"] if imp is None else p[4]
    fiche = ic._charge()["cartes"].get(x["n"]) or {}
    if imp is None and fiche.get("prix_date") == jour and fiche.get("prix") is not None:
        prix = fiche["prix"]                         # prix du jour déjà connu de l'Atelier
    texte_fr = x["of"] if len(re.sub(r"[^\w]", "", x["of"] or "")) > 3 else ""      # « R » d'un terrain de base : le texte anglais dit mieux
    return dict(nom=x["n"], fr=x["fr"], cout=x["c"], mv=x["mv"], type=x["t"], type_fr=x["tf"], texte=x["o"], texte_fr=texte_fr,
                pt=x["pt"], couleurs=list(x["ci"]), gc=x["gc"], prix=prix, foil=x["foil"] and imp is None,
                legal="legal" if "commander" in x["_lg"] else "", rang=x["rk"],
                image=_image(p[5]) if p else "", petite=_image(p[5], "small") if p else "",
                image_dos=_image(x.get("imd")) if imp is None and x.get("imd") else "", commandant=x.get("cm", False), partenaire=x.get("pa", False),
                edition=dict(set=p[0], num=p[1], rarete=p[2], nom=ed.get("fr") or ed.get("n", p[0].upper()), annee=p[3][:4],
                             icone=ed.get("ic", "")) if p else None,
                versions=len(pr), dans=dans.get(x["_cle"]))


def chercher(p, deck=None):
    """Une page de résultats : dict(total, page, pages, cartes=[...], lignes=nombre de lignes avant pagination)."""
    b = base()
    if b is None:
        raise RuntimeError("La base de cartes n'est pas encore prête : elle se construit (quelques minutes la première fois).")
    tests = _filtre(p, b)
    dans = _deck(deck)
    if (p.get("horsdeck") or "") == "1" and dans:
        tests.append(lambda x: dans.get(x["_cle"]) not in ("deck", "commandant"))
    res = [x for x in b["cartes"] if all(t(x) for t in tests)]
    ordre = p.get("ordre") or "couleur"
    if ordre == "pertinence" and deck:               # pour le deck lié : son thème, puis la popularité (suggestions.py)
        import suggestions
        notes = suggestions.pertinences(deck)
        res.sort(key=lambda x: (-notes.get(x["_cle"], 0), x["rk"] is None, x["rk"] or 0), reverse=(p.get("sens") == "desc"))
    else:
        res.sort(key=TRIS.get(ordre, TRIS["couleur"]), reverse=(p.get("sens") == "desc"))
    total = len(res)
    jour = ic.aujourdhui()
    if p.get("versions") == "1":                     # « Toutes les versions » : une ligne par impression
        eds = {e for e in (p.get("eds") or "").lower().split(",") if e}
        rar = {RARETES[k] for k in (p.get("rar") or "").upper() if k in RARETES}
        lignes = [(x, imp) for x in res for imp in x["pr"] if _ok_impression(imp, eds, rar, b)]
    else:
        lignes = [(x, None) for x in res]
    par = int(_nombre(p.get("par")) or PAR_PAGE)
    par = par if par in PAR_PAGE_CHOIX else PAR_PAGE
    pages = max(1, -(-len(lignes) // par))
    page = min(max(1, int(_nombre(p.get("page")) or 1)), pages)
    morceau = lignes[(page - 1) * par: page * par]
    return dict(total=total, lignes=len(lignes), page=page, pages=pages, par_page=par,
                cartes=[_sortie(x, b, dans, imp, jour) for x, imp in morceau], base=etat_base())


def editions():
    """Éditions pour la fenêtre Éditions, par groupe, des plus récentes aux plus anciennes."""
    b = base()
    if b is None:
        return []
    ordre = list(dict.fromkeys(lib for _, lib in GROUPES_EDITIONS))
    groupe = dict(GROUPES_EDITIONS)
    par = {lib: [] for lib in ordre}
    for code, e in b["editions"].items():
        lib = groupe.get(e["ty"])
        if lib and not e.get("dig"):
            par[lib].append(dict(code=code, nom=e["fr"] or e["n"], en=e["n"], date=e["d"], nb=e["nb"], icone=e["ic"]))
    return [dict(groupe=lib, editions=sorted(par[lib], key=lambda e: e["date"], reverse=True)) for lib in ordre if par[lib]]


def fonctions():
    return [dict(cle=cle, nom=lib) for cle, lib, _ in FONCTIONS]


def _compte(b, tags):
    return len(set().union(*(b["par_tag"].get(t, ()) for t in tags))) if tags else 0


def suggestions(q, n=25):
    """Fonctions Scryfall Tagger qui correspondent au texte tapé : d'abord les fonctions traduites (« défausse »,
    « pioche »…), puis toutes les autres par leur nom anglais (« pinger », « sacrifice outlet »…), avec leur nombre de
    cartes (sous-fonctions comprises). Sans texte : les fonctions traduites."""
    b = base()
    if b is None:
        return []
    qn = _norm(q).strip().replace("-", " ")
    mots = qn.split()
    res, vus = [], set()
    for cle, lib, slugs in FONCTIONS:
        h = _norm(lib) + " " + " ".join(s.replace("-", " ") for s in slugs)
        if all(m in h for m in mots):
            res.append(dict(cle=cle, nom=lib, desc="", fr=True, nb=_compte(b, b["fonctions"][cle])))
        vus.update(slugs)
    if mots:
        autres = []
        for i, t in enumerate(b["tags"]):
            h = t["s"].replace("-", " ")
            if t["s"] in vus or not all(m in h for m in mots):
                continue
            autres.append((not h.startswith(qn), len(h), i))     # celles qui commencent par le texte, puis les plus courtes
        autres.sort()
        for _, _, i in autres[:n * 2]:
            t = b["tags"][i]
            nb = _compte(b, _descendants(t["s"]))
            if nb:
                res.append(dict(cle=t["s"], nom=t["s"].replace("-", " "), desc=t.get("d", ""), fr=False, nb=nb))
    return res[:n]


def eligibilite(nom):
    """Pour les règles du deck : la carte peut-elle être commandant, et en accompagner un autre ? None si la base n'est pas prête."""
    b = _base
    if b is None or not b.get("cmd_v"):
        return None
    x = b["par_cle"].get(ic._cle(nom).lower())
    return dict(commandant=x.get("cm", False), partenaire=x.get("pa", False)) if x else None


def noms(q, deck=None, n=8):
    """Champ du haut (« Chercher une carte ») : les cartes dont le nom français ou anglais correspond, comme le champ
    Titre de Magic-Ville. Nom exact d'abord, puis début du nom (ou d'un mot), puis le reste ; à égalité, les plus jouées."""
    b = base()
    qn = _norm(q).strip()
    if b is None or len(qn) < 2:
        return []
    trouves = []
    for x in b["cartes"]:
        if x["spe"] in HORS_JEU or x["dig"] or x["fun"]:
            continue
        rang = None
        for h in (x["_n"], x["_nf"]):
            if not h or qn not in h:
                continue
            faces = h.split(" // ")
            r = 0 if qn in faces else 1 if any(f.startswith(qn) for f in faces) else 2 if any(m.startswith(qn) for f in faces for m in f.split()) else 3
            rang = r if rang is None else min(rang, r)
        if rang is not None:
            trouves.append((rang, x["rk"] is None, x["rk"] or 0, x["_n"], x))
    trouves.sort(key=lambda t: t[:4])
    dans = _deck(deck)
    jour = ic.aujourdhui()
    return [_sortie(x, b, dans, None, jour) for *_, x in trouves[:n]]


# ---------------------------------------------------------------- cartes citées dans un texte (aperçu au survol)
_citees = {}


def noms_cites():
    """Noms des cartes jouables, pour reconnaître une carte citée n'importe où dans l'Atelier : [anglais] ou
    [anglais, français], plus les noms d'un seul mot qui sont aussi des mots courants (« Sacrifice », « Endurance »),
    que l'interface ne lie que dans leur deck ou en gras. Un mot est courant s'il s'écrit en minuscules dans le texte
    des cartes, ou s'il sert dans l'interface. None tant que la base se charge (au lancement de l'Atelier)."""
    b = _base
    if b is None:
        return None
    with _verrou:
        if _citees.get("date") != b["date"]:
            jouables = [x for x in b["cartes"] if x["spe"] not in HORS_JEU and not x["dig"] and not x["fun"]]
            noms = [[x["n"], x["fr"]] if x.get("fr") and x["fr"] != x["n"] else [x["n"]] for x in jouables]
            seuls = {a.lower().replace("’", "'") for n in noms for nom in n for a in [nom, *nom.split(" // ")] if not re.search(r"\s", a)}
            courants = set()
            for x in b["cartes"]:
                for k in ("o", "of", "t", "tf"):
                    courants.update(m for m in re.findall(r"[^\W_][\w'’-]*", (x.get(k) or "").replace("’", "'")) if m == m.lower())
            for f in ("app.js", "index.html"):
                with open(os.path.join(ICI, "static", f), encoding="utf-8") as fh:
                    src = re.sub(r"/\*.*?\*/|(?<!:)//[^\n]*|<!--.*?-->", "", fh.read(), flags=re.S)   # sans les commentaires
                src = re.sub(r"\b\w+(?=:)", "", src)                       # ni les clés du code (aube: "Dawn of the Dead")
                courants.update(m.lower() for m in re.findall(r"[^\W_][\w'’-]*", src.replace("’", "'")))
            _citees.update(date=b["date"], donnees=dict(noms=noms, communs=sorted(seuls & courants)))
        return _citees["donnees"]


def fonctions_cartes(noms):
    """{nom: (familles, fonctions)} pour les cartes d'un deck : familles du gabarit (la principale d'abord) et fonctions
    traduites, sans parenthèses (« Mana rock », « Removal ciblé »). None tant que la base se charge."""
    b = _base
    if b is None:
        return None
    court = {cle: re.sub(r"\s*\(.*\)$", "", lib) for cle, lib, _ in FONCTIONS}
    if "familles" not in b:                             # étiquettes Tagger de chaque famille, une fois par base
        b["familles"] = [(lib, set().union(*(b["fonctions"][c] for c in cles)) - set().union(set(), *(_descendants(s) for s in sauf)))
                         for lib, cles, sauf in FAMILLES]
    res = {}
    for n in noms:
        x = b["par_cle"].get(ic._cle(n).lower())
        fns = [cle for cle, _, _ in FONCTIONS if x and x["_tg"] & b["fonctions"][cle]]
        fam = [lib for lib, tags in b["familles"] if x and x["_tg"] & tags]
        precises = [c for c in fns if not any(p in fns for p in GENERALES.get(c, []))]
        res[n] = (fam, [court[c] for c in precises])
    return res


def apercu(nom):
    """Image et prix d'une carte citée."""
    b = base()
    x = b and b["par_cle"].get(ic._cle(nom).lower())
    if not x:
        return None
    s = _sortie(x, b, {}, None, ic.aujourdhui())
    return {k: s[k] for k in ("nom", "fr", "image", "prix", "foil")}
