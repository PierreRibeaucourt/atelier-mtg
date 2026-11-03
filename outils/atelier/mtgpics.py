"""Combos de MTGPics (www.mtgpics.com), le site jumeau de Magic-Ville : même base de combos, mêmes classes, en anglais.

Magic-Ville est derrière Cloudflare ; MTGPics non, et il ne pose aucune restriction (pas de robots.txt). L'Atelier
l'interroge poliment : une requête toutes les 1,5 s au plus, un User-Agent qui dit qui il est, et tout est gardé
dans mtgpics.json pendant 30 jours.
Pour une carte : recherche du nom -> fiche de la carte -> lien « See all combos » (code de référence de la carte, ex.
4th023 pour Ball Lightning) -> pages de résultats, seulement les « vraies » combos (Win, Lock, Infinite, Threat, Synergy,
clones), triées comme sur le site (les plus fortes d'abord).
"""
import html as _html
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request

import decks
import infos_cartes as ic

ICI = os.path.dirname(os.path.abspath(__file__))
FICHIER = os.path.join(ICI, "mtgpics.json")
BASE = "https://www.mtgpics.com"
ENTETES = {"User-Agent": "AtelierMTG/1.0 (outil personnel, requetes espacees)"}
PAUSE = 1.5
DUREE = 30 * 86400
MAX_PAGES = 10                                             # 200 combos par carte au plus (les plus fortes d'abord)
CLASSES = "&class[kill]=1&class[lock]=1&class[infinite]=1&class[threat]=1&class[synergy]=1&class[clone]=1"
LIBELLES = {"win": ("victoire", "Win"), "lock": ("verrou", "Lock"), "infinite": ("boucle", "Infini"),
            "threat": ("valeur", "Menace"), "synergy": ("syn", "Synergie"), "synergie": ("syn", "Synergie")}

_verrou = threading.RLock()
_reseau = threading.Lock()
_dernier = [0.0]
_cache = None


# ---------------------------------------------------------------- stockage
def _lire():
    global _cache
    with _verrou:
        if _cache is None:
            _cache = json.load(open(FICHIER, encoding="utf-8")) if os.path.exists(FICHIER) else {}
            _cache.setdefault("combos", {})
            _cache.setdefault("cartes", {})
        return _cache


def _ecrire():
    with _verrou:
        tmp = FICHIER + ".tmp"
        json.dump(_cache, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
        os.replace(tmp, FICHIER)


# ---------------------------------------------------------------- réseau (poli)
def _get(chemin, donnees=None):
    with _reseau:
        attente = _dernier[0] + PAUSE - time.time()
        if attente > 0:
            time.sleep(attente)
        try:
            req = urllib.request.Request(BASE + chemin, data=donnees, headers=ENTETES)
            with urllib.request.urlopen(req, timeout=30) as r:
                brut = r.read()
        finally:
            _dernier[0] = time.time()
    return brut.decode("cp1252", "replace")


def _q(s):
    return urllib.parse.quote_plus(s, encoding="cp1252", errors="replace")


def _texte(s):
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


# ---------------------------------------------------------------- lecture des pages
def _ref_combos(nom):
    """Code de référence de la carte pour ses combos ; "" = aucune combo ; None = carte introuvable sur MTGPics."""
    face = nom.split(" // ")[0]
    page = _get("/results.php?zbob=1", ("cardtitle_search=" + _q(face)).encode())
    m = re.search(r"""location(?:\.href)?\s*=\s*["'][^"']*card\?ref=(\w+)""", page)
    ref = m.group(1) if m else None
    if not ref:                                            # plusieurs cartes : celle qui porte exactement ce nom
        for r, titre in re.findall(r'card\?ref=(\w+)"?[^>]*>([^<]+)<', page):
            if ic._simple(_texte(titre)) == ic._simple(face):
                ref = r
                break
    if not ref:
        return None
    fiche = _get(f"/card?ref={ref}")
    m = re.search(r"combos/results\?card_to_search\[(\w+)\]=", fiche)
    return m.group(1) if m else ""


def _analyser(page):
    res = []
    for ligne in re.findall(r'(?s)<tr id="?r_\w+.*?</tr>', page):
        ref = re.search(r"showcombo\?ref=(\d+)", ligne)
        cellules = re.findall(r"(?s)<td[^>]*>(.*?)</td>", ligne)
        if not ref or len(cellules) < 4:
            continue
        liens = re.findall(r'(?:carte|card)\?ref=\w+"?>([^<]+)</a>', cellules[1])
        noms = [_texte(n) for n in liens]
        parties = [p for p in _texte(cellules[1]).split(" + ") if p.strip()]
        top8, formats = None, ""
        for c in cellules[3:-1]:
            t = _texte(c)
            if re.fullmatch(r"\d*", t):
                top8 = int(t) if t else None
            else:
                formats = t
        res.append(dict(id=ref.group(1), cartes=noms, generique=len(parties) != len(noms) or not noms,
                        formats=formats, top8=top8, classe=_texte(cellules[-1])))
    return res


def combos_carte(nom, force=False):
    """Combos MTGPics d'une carte (gardées 30 jours) : dict(ref, date, total, combos=[numéros], pages, lues)."""
    d = _lire()
    info = d["cartes"].get(nom)
    if info and not force and time.time() - info["date"] < DUREE:
        return info
    ref = _ref_combos(nom)
    ids, total, nb = [], 0, 0
    if ref:
        n, nb = 1, 1
        while n <= min(nb, MAX_PAGES):
            page = _get(f"/combos/results?rare_sel=&card_to_search[{ref}]={_q(nom.split(' // ')[0])}&ordre=class&page_nb={n}{CLASSES}")
            if n == 1:
                p = re.search(r'page_nb"?\s+value="?\d+"?\s*>\s*/\s*(\d+)', page)
                t = re.search(r"(\d+)\s+combos?\s+found", page)
                nb, total = (int(p.group(1)) if p else 1), (int(t.group(1)) if t else 0)
            with _verrou:
                for c in _analyser(page):
                    d["combos"][c["id"]] = c
                    ids.append(c["id"])
            n += 1
    info = dict(ref=ref, date=time.time(), total=total, combos=ids, pages=nb, lues=min(nb, MAX_PAGES))
    with _verrou:
        d["cartes"][nom] = info
    _ecrire()
    return info


def connue(nom):
    info = _lire()["cartes"].get(nom)
    return bool(info) and time.time() - info["date"] < DUREE


# ---------------------------------------------------------------- combos gardées, au format commun de l'onglet Combos
def combos_gardees(carte=None):
    d = _lire()
    if carte:
        info = d["cartes"].get(carte) or {}
        liste = [d["combos"][i] for i in info.get("combos", []) if i in d["combos"]]
        face = ic._simple(carte.split(" // ")[0])          # et celles lues en cherchant une autre carte
        liste += [c for c in d["combos"].values() if c not in liste and any(ic._simple(n) == face for n in c["cartes"])]
    else:
        liste = list(d["combos"].values())
    return [c for c in liste if not c.get("generique") and c.get("cartes")]


def classe(cl):
    """Classe MTGPics -> (clé de couleur, libellé) : « Infinite (Win) » -> victoire, « Infini (Win) »."""
    b = (cl or "").lower()
    k, lib = LIBELLES.get(b.split(" ")[0], ("syn", cl or "Synergie"))
    if "win" in b:
        k, lib = "victoire", (lib if b == "win" else lib + " (Win)")
    return k, lib


def ligne(c):
    k, lib = classe(c.get("classe"))
    return dict(source="mtgpics", id=c["id"], cartes=list(c["cartes"]), autres=[], produit=[], resultats=[],
                description="", prerequis="", prerequis2="", mana="", popularite=c.get("top8"), identite="",
                lien=f"{BASE}/combos/showcombo?ref={c['id']}", formats=c.get("formats", ""), classe=k, classe_lib=lib)


# ---------------------------------------------------------------- toutes les cartes d'un deck, en tâche de fond
_jobs = {}


def cartes_a_chercher(deck):
    """Cartes du deck (hors Maybeboard et terrains de base) : toutes peuvent faire partie d'une combo."""
    jeu = [e for e in decks.lire(decks.chemin(deck)) if decks.categorie(e) != "Maybeboard"]
    I = ic.infos([e["nom"] for e in jeu])
    return [e["nom"] for e in jeu if not ((I.get(e["nom"]) or {}).get("type") or "").startswith("Basic")]


def etat_deck(deck):
    cartes = cartes_a_chercher(deck)
    with _verrou:
        j = dict(_jobs.get(deck) or {})
    return dict(cartes=len(cartes), connues=sum(1 for n in cartes if connue(n)), actif=j.get("actif", False),
                fait=j.get("fait", 0), total=j.get("total", 0), erreur=j.get("erreur", ""))


def lancer_deck(deck):
    reste = [n for n in cartes_a_chercher(deck) if not connue(n)]
    with _verrou:
        if (_jobs.get(deck) or {}).get("actif"):
            return etat_deck(deck)
        j = _jobs[deck] = dict(actif=True, fait=0, total=len(reste), erreur="")

    def travail():
        try:
            for n in reste:
                try:
                    combos_carte(n)
                except Exception as e:                 # une carte en erreur n'arrête pas les autres
                    j["erreur"] = f"{n} : {e}"
                j["fait"] += 1
        finally:
            j["actif"] = False
    threading.Thread(target=travail, daemon=True).start()
    return etat_deck(deck)
