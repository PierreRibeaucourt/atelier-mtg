"""Infos des cartes pour l'Atelier : nom français, image, prix Cardmarket en euros, lien Cardmarket, Game Changer.

Source : Scryfall, qui republie chaque jour les prix Cardmarket (Cardmarket bloque les accès automatiques).
Tout est gardé dans cache_infos.json : les fiches et noms français pour toujours, les prix 24 h, la liste des
Game Changers 24 h (rafraîchie au lancement de l'Atelier ou par le bouton).
"""
import json
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import date

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(ICI))
from prix import ENTETES, get, prix_fiable  # noqa: E402
import reglages  # noqa: E402

CACHE = os.path.join(ICI, "cache_infos.json")
BASES_FR = {"Mountain": "Montagne", "Swamp": "Marais", "Island": "Île", "Plains": "Plaine", "Forest": "Forêt", "Wastes": "Désolation"}
BUDGET = reglages.budget()                       # prix maximum par carte (reglages.json)
_verrou = threading.RLock()
_cache = None
etat = dict(tache="", fait=0, total=0)          # avancement de la mise à jour en tâche de fond


def _charge():
    global _cache
    if _cache is None:
        _cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
        _cache.setdefault("cartes", {})
        _cache.setdefault("gc", {})
        _cache.setdefault("impressions", {})       # « ima/205/fr » -> image et édition d'une impression précise ({} = introuvable)
    return _cache


def _sauve():
    with _verrou:
        tmp = CACHE + ".tmp"
        json.dump(_cache, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
        os.replace(tmp, CACHE)


def aujourdhui():
    return date.today().isoformat()


def _fiche(c):
    """Ce qu'on garde d'une carte Scryfall."""
    faces = c.get("card_faces") or [c]
    img = c.get("image_uris") or faces[0].get("image_uris") or {}
    texte = "\n//\n".join(f.get("oracle_text", "") for f in faces) if c.get("card_faces") else c.get("oracle_text", "")
    lien = (c.get("purchase_uris") or {}).get("cardmarket", "")
    return dict(nom=c["name"], cout=faces[0].get("mana_cost") or c.get("mana_cost") or "", mv=c.get("cmc", 0),
                type=faces[0].get("type_line") or c.get("type_line", ""), texte=texte, couleurs=c.get("color_identity", []),
                image=img.get("normal", ""), petite=img.get("small", ""), art=img.get("art_crop", ""),
                gc=bool(c.get("game_changer")), prix=_eur(c), prix_lien=_lien(lien), prix_date=None, fr=None,
                legal=(c.get("legalities") or {}).get("commander", ""), produit=c.get("produced_mana") or [], pt=_pt(c),
                gatherer=(c.get("related_uris") or {}).get("gatherer", ""), dos=_dos(c), assemble=_assemble(c))


def _dos(c):
    """Le verso d'une carte recto-verso (Delver, Valakut Awakening…) : nom, type et image ; None sinon."""
    faces = c.get("card_faces") or []
    if len(faces) < 2 or not faces[1].get("image_uris"):
        return None                                   # cartes doubles, aventures, à inversion : une seule image
    img = faces[1]["image_uris"]
    return dict(nom=faces[1].get("name", ""), type=faces[1].get("type_line", ""), image=img.get("normal", ""), petite=img.get("small", ""))


def _assemble(c):
    """Cartes qui s'assemblent (Bruna + Gisela = Brisela) : les autres morceaux et la carte formée ; None sinon."""
    if c.get("layout") != "meld":
        return None
    parts = c.get("all_parts") or []
    resultat = next((x["name"] for x in parts if x.get("component") == "meld_result"), "")
    pieces = [x["name"] for x in parts if x.get("component") == "meld_part" and x["name"] != c["name"]]
    if resultat == c["name"]:                          # la carte formée elle-même : elle ne se joue pas seule
        return dict(resultat=resultat, pieces=[x["name"] for x in parts if x.get("component") == "meld_part"], est_resultat=True)
    return dict(resultat=resultat, pieces=pieces, est_resultat=False)


def _pt(c):
    """Force/endurance (ou loyauté) de chaque face : « 6/1 », « 2/2 // 4/4 », « loyauté 3 »."""
    vals = []
    for f in (c.get("card_faces") or [c]):
        if f.get("power") is not None:
            vals.append(f"{f['power']}/{f.get('toughness', '')}")
        elif f.get("loyalty") is not None:
            vals.append(f"loyauté {f['loyalty']}")
    if not vals and c.get("power") is not None:
        vals.append(f"{c['power']}/{c.get('toughness', '')}")
    return " // ".join(vals)


# déjà calculés : on ne les perd pas quand une fiche est complétée (sans imp_pref : son image par défaut sera refaite)
GARDES = ("fr", "fr_type", "fr_texte", "prix", "prix_lien", "prix_date", "prix_edition", "imp_lang")


def _eur(c):
    p = (c.get("prices") or {}).get("eur")
    return float(p) if p else None


def _lien(url):
    """Lien Cardmarket en français, sans les paramètres de suivi (on garde le nom cherché)."""
    if not url:
        return ""
    p = urllib.parse.urlsplit(url)
    garde = {k: v[0] for k, v in urllib.parse.parse_qs(p.query).items() if k in ("idProduct", "searchString")}
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path.replace("/en/", "/fr/"), urllib.parse.urlencode(garde), ""))


def _simple(s):
    """Minuscules sans accents, pour comparer « Éclair » et « eclair »."""
    return "".join(ch for ch in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(ch) != "Mn")


def _cle(nom):
    """Nom de la première face : « Cut // Ribbons », « Cut / Ribbons » -> « Cut »."""
    return re.split(r" /{1,2} ", nom)[0]


# ---------------------------------------------------------------- fiches
def infos(noms):
    """Fiches des cartes demandées ; celles qu'on n'a pas encore sont demandées à Scryfall (75 par requête)."""
    cache = _charge()
    with _verrou:      # absentes, ou fiches d'avant l'ajout du lien Gatherer, du verso et des cartes qui s'assemblent
        manquants = sorted({n for n in noms if n and (n not in cache["cartes"] or "assemble" not in cache["cartes"][n])})
    for i in range(0, len(manquants), 75):
        bloc = manquants[i:i + 75]
        corps = json.dumps({"identifiers": [{"name": _cle(n)} for n in bloc]}).encode()
        req = urllib.request.Request("https://api.scryfall.com/cards/collection", data=corps,
                                     headers={**ENTETES, "Content-Type": "application/json"})
        time.sleep(0.1)
        rep = json.load(urllib.request.urlopen(req))
        trouvees = {_cle(c["name"]).lower(): c for c in rep.get("data", [])}
        for n in bloc:
            c = trouvees.get(_cle(n).lower()) or get("https://api.scryfall.com/cards/named", {"fuzzy": n})
            if c:
                f = _fiche(c)
                f["fr"] = BASES_FR.get(n)
                with _verrou:
                    ancien = cache["cartes"].get(n) or {}
                    f.update({k: ancien[k] for k in GARDES if ancien.get(k) is not None})
                    cache["cartes"][n] = f
        _sauve()
    with _verrou:
        return {n: cache["cartes"].get(n) for n in noms}


def _recherche_groupee(noms, extra, traite, recentes_dabord=False):
    """Une recherche Scryfall pour plusieurs cartes à la fois : (!"A" or !"B" ...) + extra, toutes les pages."""
    ordre = {"order": "released", "dir": "desc"} if recentes_dabord else {}
    for i in range(0, len(noms), 15):
        bloc = noms[i:i + 15]
        q = "(" + " or ".join(f'!"{_cle(n)}"' for n in bloc) + ") " + extra
        r = get("https://api.scryfall.com/cards/search", {"q": q, "unique": "prints", "include_extras": "false", **ordre})
        while r:
            for c in r.get("data", []):
                traite(c)
            r = get(r["next_page"]) if r.get("has_more") else None
        yield len(bloc)


def _ub(c):
    """Impression Universes Beyond (Marvel, Final Fantasy, Fallout…) : Scryfall le note sur chaque impression."""
    return "universesbeyond" in (c.get("promo_types") or [])


def _papier(c):
    """Une impression qu'on peut montrer : papier, image disponible, pas un objet de collection ni une carte géante."""
    return not (c.get("digital") or c.get("oversized") or c.get("image_status") in ("missing", "placeholder")
                or c.get("set_type") in ("memorabilia", "token", "minigame"))


def _choisir(anglaises, locales, sans_ub):
    """L'impression par défaut d'une carte : (impression anglaise, impression à montrer, prix, foil ?) ou None.
    La moins chère (hors foil, sinon foil) ; d'abord parmi celles qui existent dans la langue choisie (locales) ; hors
    Universes Beyond quand on l'a demandé et qu'il en reste."""
    def moins_chere(paires):
        for cle_prix, foil in (("prix", False), ("prix_foil", True)):
            p = [(en[cle_prix], i) for i, (en, _) in enumerate(paires) if en.get(cle_prix) is not None]
            if p:
                prix, i = min(p)
                return paires[i][0], paires[i][1], prix, foil
        return None
    toutes = [(i, i) for i in anglaises.values()]
    loc = [(anglaises[k], v) for k, v in ((tuple(k.split("|", 1)), v) for k, v in (locales or {}).items()) if k in anglaises]
    ordre = ([[p for p in loc if not p[1]["ub"]], [p for p in toutes if not p[0]["ub"]]] if sans_ub else []) + [loc, toutes]
    for paires in ordre:
        r = moins_chere(paires)
        if r:
            return r
    return None


def _bases_par_defaut(noms, lang, sans_ub, pref):
    """Terrains de base : leur prix ne compte pas ; l'image est celle de l'impression la plus récente, dans la langue
    choisie et hors Universes Beyond si demandé. Une requête par terrain, refaite quand les préférences changent."""
    cache = _charge()["cartes"]
    for n in noms:
        f = cache.get(n)
        if n not in BASES_FR or not f or f.get("imp_pref") == pref:
            continue
        for filtre in [f"lang:{lang}" if lang else "", ""] if lang else [""]:
            q = f'!"{n}" game:paper -is:promo {filtre} {"-is:ub" if sans_ub else ""}'
            r = get("https://api.scryfall.com/cards/search", {"q": " ".join(q.split()), "unique": "prints", "order": "released",
                                                              "dir": "desc"})
            c = next((c for c in (r or {}).get("data", []) if _papier(c) and c["name"] == n), None)
            if c:
                i = _impression(c)
                with _verrou:
                    f.update(image=i["image"], petite=i["petite"], art=i["art"] or f.get("art", ""),
                             imp=dict(set=i["set"], num=i["num"], lang=i["lang"]), imp_pref=pref)
                break
        else:
            with _verrou:
                f["imp_pref"] = pref                 # rien trouvé (ou pas de réseau) : l'image d'avant, jusqu'au prochain changement


def rafraichir_prix(noms, force=False, suivi=True):
    """Prix du jour et impression par défaut de chaque carte, selon les préférences (Options) : l'impression la moins
    chère, ou la moins chère qui existe dans la langue choisie (son image dans cette langue, le prix de son édition) ;
    hors Universes Beyond quand il en existe une autre, si on l'a demandé. Prix en euros hors foil, comme outils/prix.py
    (le foil si la carte n'existe qu'en foil). Gardé 24 h ; la liste des impressions dans la langue choisie, une semaine.
    Une impression choisie dans un deck (« (ima) 205 ») garde son image : celle-ci ne sert que par défaut.
    suivi=False : sans afficher l'avancement dans la barre du haut (recherche d'une carte)."""
    cache = _charge()
    jour = aujourdhui()
    lang, sans_ub = reglages.impression()
    pref = f"{lang or ''}|{int(sans_ub)}"                 # préférences changées : tout est à refaire
    _bases_par_defaut(noms, lang, sans_ub, pref)
    def a_refaire(f):
        # « prix_edition » absent = prix calculé avant l'exclusion des éditions douteuses : à refaire
        if force or f.get("prix_date") != jour or "prix_edition" not in f:
            return True
        return f.get("imp_pref") != pref and (suivi or not lang)     # recherche : la langue attendra une mise à jour suivie
    a_faire = [n for n in noms if n not in BASES_FR and cache["cartes"].get(n) and a_refaire(cache["cartes"][n])]
    if not a_faire:
        _sauve()
        return
    par_cle = {_cle(n): n for n in a_faire}
    anglaises = {n: {} for n in a_faire}                  # (set, numéro) -> impression, avec son prix et son lien Cardmarket

    def traite(c):
        n = par_cle.get(_cle(c["name"]))
        if n and prix_fiable(c):
            anglaises[n][(c["set"], c["collector_number"])] = dict(
                _impression(c), ub=_ub(c), lien=_lien((c.get("purchase_uris") or {}).get("cardmarket", "")))
    if suivi:
        etat.update(tache="prix", fait=0, total=len(a_faire))
    for k in _recherche_groupee(a_faire, "", traite):
        if suivi:
            etat["fait"] += k

    # les impressions dans la langue choisie, relues chaque semaine ; pas pour une recherche (suivi=False) : ses images
    # viennent de la base de cartes, et la carte sera complétée quand elle entrera dans un deck ou le classeur
    if lang and suivi:
        def perime(f):
            L = f.get("imp_lang") or {}
            return L.get("lang") != lang or not L.get("date") or (date.fromisoformat(jour) - date.fromisoformat(L["date"])).days >= 7
        a_lire = [n for n in a_faire if perime(cache["cartes"][n])]
        lues = {n: {} for n in a_lire}

        def traite_langue(c):
            n = par_cle.get(_cle(c["name"]))
            if n in lues and _papier(c):
                i = _impression(c)
                lues[n][f"{c['set']}|{c['collector_number']}"] = dict(image=i["image"], petite=i["petite"], art=i["art"],
                                                                         lang=lang, ub=_ub(c))
        if a_lire:
            for _ in _recherche_groupee(a_lire, f"lang:{lang} game:paper", traite_langue):
                pass
            with _verrou:
                for n in a_lire:
                    cache["cartes"][n]["imp_lang"] = dict(lang=lang, date=jour, eds=lues[n])

    with _verrou:
        for n in a_faire:
            f = cache["cartes"][n]
            choix = _choisir(anglaises[n], (f.get("imp_lang") or {}).get("eds") if lang else None, sans_ub)
            if choix:
                en, vue, prix, foil = choix
                f["prix"], f["prix_lien"] = prix, en["lien"] or f["prix_lien"]
                f["prix_edition"] = en["edition"] + (" (foil)" if foil else "")
                if vue.get("image"):
                    f.update(image=vue["image"], petite=vue["petite"], art=vue["art"] or f.get("art", ""))
                f["imp"] = dict(set=en["set"], num=en["num"], lang=vue.get("lang") or "en")
            else:                                    # rien trouvé (ou Scryfall injoignable) : on garde l'ancien prix
                f.setdefault("prix_edition", "")
            f["prix_date"] = jour
            if not lang or (f.get("imp_lang") or {}).get("lang") == lang:
                f["imp_pref"] = pref                 # sinon : à refaire avec la langue, à la prochaine mise à jour suivie
    _sauve()


def noms_francais(noms, suivi=True):
    """Nom, type et texte imprimés sur l'édition française la plus récente (une fois pour toutes).
    fr = "" : la carte n'existe pas en français ; l'Atelier affiche alors le texte anglais."""
    cache = _charge()
    a_faire = [n for n in noms if n not in BASES_FR and cache["cartes"].get(n)
               and (cache["cartes"][n].get("fr") is None or cache["cartes"][n].get("fr_v") != 2)]
    if not a_faire:
        return
    par_cle = {_cle(n): n for n in a_faire}
    fr = {}

    def traite(c):
        n = par_cle.get(_cle(c["name"]))
        if not n:
            return
        faces = c.get("card_faces") or []
        if c.get("printed_name"):
            nom = c["printed_name"]
        elif faces and faces[0].get("printed_name"):
            nom = " // ".join(f.get("printed_name", "") for f in faces)
        else:
            return
        if faces and not c.get("printed_text"):    # cartes à deux faces, aventures…
            texte = "\n//\n".join(f.get("printed_text", "") for f in faces).strip("\n/")
            typ = faces[0].get("printed_type_line", "")
        else:
            texte, typ = c.get("printed_text", ""), c.get("printed_type_line", "")
        # éditions les plus récentes d'abord : chaque élément vient de la plus récente qui l'a vraiment en français
        # (une promo n'a parfois pas de type ; l'édition MID de Delver of Secrets garde le nom anglais, ISD dit « Sondeur de secrets »)
        anglais = cache["cartes"][n]
        if _simple(nom) == _simple(n) or _simple(nom) == _simple(anglais.get("nom", "")):
            nom = ""
        if _simple(texte) == _simple(anglais.get("texte", "")):
            texte = ""
        nom0, typ0, texte0 = fr.get(n, ("", "", ""))
        fr[n] = (nom0 or nom, typ0 or typ, texte0 or texte)
    if suivi:
        etat.update(tache="noms français", fait=0, total=len(a_faire))
    for k in _recherche_groupee(a_faire, "lang:fr", traite, recentes_dabord=True):
        if suivi:
            etat["fait"] += k
    with _verrou:
        for n in a_faire:
            f = cache["cartes"][n]
            f["fr_v"] = 2
            if n in fr:
                f["fr"], f["fr_type"], f["fr_texte"] = fr[n]
            else:
                f["fr"] = "" if _simple(f.get("fr") or "") == _simple(n) else (f.get("fr") or "")      # "" : nom anglais
                f.setdefault("fr_type", "")
                f.setdefault("fr_texte", "")
    _sauve()


# ---------------------------------------------------------------- impressions (le visuel choisi d'une carte)
def cle_impression(s, num, lang="en"):
    return f"{s.lower()}/{num}/{lang or 'en'}"


def _impression(c):
    faces = c.get("card_faces") or [c]
    img = c.get("image_uris") or faces[0].get("image_uris") or {}
    p = c.get("prices") or {}
    return dict(set=c["set"], num=c["collector_number"], lang=c.get("lang", "en"), nom=c["name"],
                edition=c.get("set_name", ""), annee=(c.get("released_at") or "")[:4],
                image=img.get("normal", ""), petite=img.get("small", ""), art=img.get("art_crop", ""),
                prix=float(p["eur"]) if p.get("eur") else None, prix_foil=float(p["eur_foil"]) if p.get("eur_foil") else None)


def impressions(cles):
    """Fiches des impressions demandées [(set, num, langue)] : {(set, num, langue): fiche ou None}. Gardées pour toujours."""
    cache = _charge()["impressions"]
    cles = list(dict.fromkeys((s.lower(), num, lang or "en") for s, num, lang in cles))
    with _verrou:
        manquantes = [k for k in cles if cle_impression(*k) not in cache]
    anglaises = [k for k in manquantes if k[2] == "en"]
    for i in range(0, len(anglaises), 75):
        bloc = anglaises[i:i + 75]
        corps = json.dumps({"identifiers": [{"set": s, "collector_number": num} for s, num, _ in bloc]}).encode()
        req = urllib.request.Request("https://api.scryfall.com/cards/collection", data=corps,
                                     headers={**ENTETES, "Content-Type": "application/json"})
        time.sleep(0.1)
        rep = json.load(urllib.request.urlopen(req))
        trouvees = {(c["set"], c["collector_number"]): _impression(c) for c in rep.get("data", [])}
        with _verrou:
            for s, num, lang in bloc:
                cache[cle_impression(s, num, lang)] = trouvees.get((s, num)) or {}      # {} : code d'édition faux, on ne redemande pas
    for s, num, lang in manquantes:
        if lang != "en":                                 # impression française : une requête par carte (rare, et déjà connue si choisie dans l'Atelier)
            c = get(f"https://api.scryfall.com/cards/{urllib.parse.quote(s)}/{urllib.parse.quote(num)}/{urllib.parse.quote(lang)}")
            with _verrou:
                cache[cle_impression(s, num, lang)] = _impression(c) if c else {}
    if manquantes:
        _sauve()
    with _verrou:
        return {k: cache.get(cle_impression(*k)) or None for k in cles}


def impressions_carte(nom):
    """Toutes les impressions papier d'une carte, en anglais et en français, des plus récentes aux plus anciennes."""
    res = []
    q = f'!"{_cle(nom)}" (lang:en or lang:fr) game:paper'
    r = get("https://api.scryfall.com/cards/search", {"q": q, "unique": "prints", "order": "released", "dir": "desc"})
    while r:
        for c in r.get("data", []):
            if _cle(c["name"]).lower() != _cle(nom).lower() or not _papier(c):
                continue
            res.append(_impression(c))
        r = get(r["next_page"]) if r.get("has_more") else None
    cache = _charge()["impressions"]
    with _verrou:
        for p in res:
            cache[cle_impression(p["set"], p["num"], p["lang"])] = p
    if res:
        _sauve()
    defaut = ((_charge()["cartes"].get(nom) or {}).get("image") or "").split("?")[0]
    for p in res:
        p["defaut"] = bool(defaut) and p["image"].split("?")[0] == defaut
    return res


# ---------------------------------------------------------------- Game Changers
def game_changers(force=False):
    """Liste officielle des Game Changers (Scryfall suit la liste de Wizards). Rafraîchie si elle a plus de 24 h."""
    cache = _charge()
    gc = cache["gc"]
    if force or not gc.get("noms") or time.time() - gc.get("maj", 0) > 24 * 3600:
        noms, r = [], get("https://api.scryfall.com/cards/search", {"q": "is:gamechanger", "unique": "cards"})
        while r:
            noms += [c["name"] for c in r.get("data", [])]
            r = get(r["next_page"]) if r.get("has_more") else None
        if noms:
            with _verrou:
                cache["gc"] = dict(noms=sorted(noms), maj=time.time())
            _sauve()
    return cache["gc"]


def est_gc(nom):
    gc = _charge()["gc"].get("noms") or []
    return nom in gc or _cle(nom) in {_cle(g) for g in gc}


# ---------------------------------------------------------------- Universes Beyond
def universes_beyond(force=False):
    """Cartes créées pour Universes Beyond (Marvel, Final Fantasy…), sans les cartes de Magic rééditées dans ces produits
    (Sol Ring) : les suggestions les signalent. Une vingtaine de pages Scryfall, rafraîchies chaque semaine."""
    cache = _charge()
    ub = cache.get("ub") or {}
    if force or not ub.get("noms") or time.time() - ub.get("maj", 0) > 7 * 86400:
        noms, r = [], get("https://api.scryfall.com/cards/search", {"q": "is:ub not:reprint", "unique": "cards"})
        while r:
            noms += [c["name"] for c in r.get("data", [])]
            r = get(r["next_page"]) if r.get("has_more") else None
        if noms:
            with _verrou:
                cache["ub"] = dict(noms=sorted(noms), maj=time.time())
            _sauve()
    return cache.get("ub") or {}


# ---------------------------------------------------------------- recherche pour ajouter une carte
def chercher(texte):
    """Cartes dont le nom (anglais ou français) contient le texte : [{nom, fr, cout, type, image, gc, prix?}].
    Le prix n'est donné que s'il est déjà connu (le plus bas du jour) ; sinon la page le demande ensuite (prix_et_noms)."""
    texte = texte.strip()
    if len(texte) < 2:
        return []
    res, vus = [], set()
    r = get("https://api.scryfall.com/cards/autocomplete", {"q": texte})
    for n in (r or {}).get("data", [])[:12]:
        faces = n.split(" // ")
        if len(faces) > 1 and len(set(faces)) == 1:      # « Sol Ring // Sol Ring » : carte d'illustration, pas jouable
            continue
        if n not in vus:
            vus.add(n)
            res.append(dict(nom=n, fr=None))
    r = get("https://api.scryfall.com/cards/search", {"q": f"{texte} lang:fr", "unique": "cards"})
    for c in (r or {}).get("data", [])[:12]:
        if c["name"] not in vus:
            vus.add(c["name"])
            res.append(dict(nom=c["name"], fr=c.get("printed_name")))
    q = _simple(texte)

    def rang(x):                       # « foudre » : Foudre (Lightning Bolt) d'abord, puis les noms qui commencent par « foudre »
        noms = [_simple(x["nom"]), _simple(_cle(x["nom"])), _simple(x["fr"] or "")]
        return 0 if q in noms else 1 if any(n.startswith(q) for n in noms) else 2
    res = sorted(res, key=rang)[:20]
    I = infos([x["nom"] for x in res])
    for x in res:
        f = I.get(x["nom"]) or {}
        x.update(fr=x["fr"] or f.get("fr") or None, cout=f.get("cout", ""), type=f.get("type", ""), image=f.get("image", ""),
                 gc=est_gc(x["nom"]), prix=f.get("prix") if f.get("prix_date") == aujourdhui() else None,
                 prix_lien=f.get("prix_lien", ""), legal=f.get("legal", ""), couleurs=f.get("couleurs", []))
    return res


def prix_et_noms(noms):
    """Prix le plus bas du jour et nom français de quelques cartes (résultats d'une recherche), sans toucher à la barre d'état."""
    infos(noms)
    rafraichir_prix(noms, suivi=False)
    noms_francais(noms, suivi=False)
    cache = _charge()["cartes"]
    return {n: dict(prix=(cache.get(n) or {}).get("prix"), prix_lien=(cache.get(n) or {}).get("prix_lien", ""),
                    fr=(cache.get(n) or {}).get("fr") or None) for n in noms}


# ---------------------------------------------------------------- mise à jour au lancement
def mise_a_jour(noms, force_prix=False):
    """Fiches, noms français, prix du jour et Game Changers pour toutes les cartes des decks. Lancée en tâche de fond."""
    try:
        etat.update(tache="fiches", fait=0, total=len(noms))
        infos(noms)
        etat.update(tache="Game Changers", fait=0, total=1)
        game_changers()
        universes_beyond()
        noms_francais(noms)
        rafraichir_prix(noms, force=force_prix)
    except Exception as e:                       # pas de réseau, Scryfall indisponible : l'Atelier marche avec le cache
        etat["erreur"] = str(e)
    finally:
        etat.update(tache="", fait=0, total=0)
