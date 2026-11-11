"""Atelier MTG : interface locale pour consulter et éditer les decks, vérifier prix et bracket, simuler, discuter avec Claude.

Lancement : double-clic sur « Atelier MTG.bat » (dossier MTG), ou  python outils/atelier/app.py
La page s'ouvre sur http://127.0.0.1:5000 (rien n'est accessible depuis l'extérieur de ton PC).
"""
import os
import re
import socket
import sys
import threading
import time
import webbrowser

ICI = os.path.dirname(os.path.abspath(__file__))
OUTILS = os.path.dirname(ICI)
sys.path.insert(0, ICI)
sys.path.insert(0, OUTILS)
# sans console (pythonw : raccourci du bureau, icône de la barre d'état) : ce qui s'afficherait va dans atelier.log
SANS_CONSOLE = sys.stdout is None
if sys.stdout is None or sys.stderr is None:
    _log = os.path.join(ICI, "atelier.log")
    _j = open(_log, "a" if os.path.exists(_log) and os.path.getsize(_log) < 1_000_000 else "w", encoding="utf-8", buffering=1)
    sys.stdout, sys.stderr = sys.stdout or _j, sys.stderr or _j
sys.stdout.reconfigure(encoding="utf-8")

from flask import Flask, Response, jsonify, request, send_from_directory  # noqa: E402

import decks  # noqa: E402
import infos_cartes as ic  # noqa: E402

PORT = int(os.environ.get("ATELIER_PORT", 5000))      # autre port possible pour un essai à côté de l'Atelier ouvert
app = Flask(__name__, static_folder=os.path.join(ICI, "static"), static_url_path="/static")
app.json.ensure_ascii = False
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0      # le navigateur revérifie app.js et style.css à chaque chargement (pas de vieille version en cache)


def tous_les_noms():
    """Les cartes des decks et du classeur : leurs fiches, noms français et prix sont tenus à jour."""
    import classeur
    noms = set(classeur.cartes())
    for d in decks.dossiers():
        p = os.path.join(decks.RACINE, d, decks.FICHIER)
        if os.path.exists(p):
            noms |= set(decks.noms(decks.lire(p)))
    return sorted(noms)


def en_fond(f, *a, **kw):
    threading.Thread(target=f, args=a, kwargs=kw, daemon=True).start()


PLUSIEURS = re.compile(r"deck can have (?:any number|up to \w+) of cards named", re.I)


def eligibilite(nom):
    """Peut-elle être commandant (règles suivies par Scryfall : créatures légendaires, certains planeswalkers, véhicules
    et vaisseaux légendaires…) ? None tant que la base de la recherche n'est pas prête."""
    try:
        import recherche
        return recherche.eligibilite(nom)
    except Exception:
        return None


def partenaires_ok(a, b):
    """Deux commandants ensemble : Partner, Partner with, Partner—…, Friends forever, Historique, compagnon du Docteur."""
    ta, tb = a.get("texte") or "", b.get("texte") or ""
    na, nb = ic._cle(a.get("nom", "")).lower(), ic._cle(b.get("nom", "")).lower()

    def avec(t):                                          # « Partner with Pir, Imaginative Rascal »
        m = re.search(r"^Partner with ([^(\n]+)", t, re.M)
        return ic._cle(m.group(1).strip()).lower() if m else None

    def variante(t):                                      # « Partner—Survivors » : seulement avec la même variante
        m = re.search(r"^Partner\s*[—-]\s*([^(\n]+)", t, re.M)
        return m.group(1).strip().lower() if m else None

    def simple(t):
        return bool(re.search(r"^Partner\s*(\(|$)", t, re.M))

    if avec(ta) or avec(tb):
        return avec(ta) == nb or avec(tb) == na
    if variante(ta) or variante(tb):
        return variante(ta) == variante(tb)
    if simple(ta) and simple(tb):
        return True
    if "Friends forever" in ta and "Friends forever" in tb:
        return True
    if ("Choose a Background" in ta and "Background" in (b.get("type") or "")) or ("Choose a Background" in tb and "Background" in (a.get("type") or "")):
        return True
    doc = lambda f: "Time Lord Doctor" in (f.get("type") or "")        # noqa: E731
    return ("Doctor's companion" in ta and doc(b)) or ("Doctor's companion" in tb and doc(a))


def alertes_cartes(entrees, I):
    """Règles du Commander, comme Archidekt et Moxfield : couleurs du commandant, une seule copie, cartes interdites."""
    cmds = [e["nom"] for e in entrees if decks.categorie(e) == "Commander"]
    ident = set().union(*[set(I[c].get("couleurs") or []) for c in cmds]) if cmds and all(I.get(c) for c in cmds) else None
    jeu = [e for e in entrees if decks.categorie(e) != "Maybeboard"]
    copies = {}
    for e in jeu:
        copies[e["nom"]] = copies.get(e["nom"], 0) + e["n"]
    res = {}
    # le ou les commandants : combien, peuvent-ils l'être, vont-ils ensemble ?
    for c in cmds:
        a = []
        if len(cmds) > 2:
            a.append("trop de commandants")
        el = eligibilite(c)
        if el is not None and not el["commandant"]:
            a.append("ne peut pas être commandant")
        if len(cmds) == 2 and all(I.get(x) for x in cmds) and not partenaires_ok(I[cmds[0]], I[cmds[1]]):
            a.append("partenaires incompatibles")
        if a:
            res[c] = a
    for e in entrees:
        f = I.get(e["nom"]) or {}
        a = list(res.get(e["nom"], [])) if decks.categorie(e) == "Commander" else []
        if f.get("legal") == "banned":
            a.append("interdite")
        elif f.get("legal") == "not_legal" and decks.categorie(e) != "Commander":
            a.append("non légale")
        if ident is not None and f.get("couleurs") and not set(f["couleurs"]) <= ident:
            a.append("hors couleurs")
        if decks.categorie(e) != "Maybeboard" and copies.get(e["nom"], 0) > 1 and e["nom"] not in decks.BASES \
                and not (f.get("type") or "").startswith("Basic") and not PLUSIEURS.search(f.get("texte") or ""):
            a.append("en double")
        if a:
            res[e["nom"]] = a
    return res, sorted(ident) if ident is not None else None


def visuels(deck, entrees, seulement=None):
    """Impression choisie de chaque carte qui en a une (« (ima) 205 » dans la liste) : {index: fiche de l'impression}."""
    langues = decks.langues(deck)
    cles = {}
    for i, e in enumerate(entrees):
        ed = e.get("edition")
        if ed and ed.get("num") and (seulement is None or i in seulement):
            cles[i] = (ed["set"], ed["num"], langues.get(f"{ed['set']}/{ed['num']}", "en"))
    if not cles:
        return {}
    try:
        P = ic.impressions(list(cles.values()))
    except Exception:                                   # pas de réseau : l'image par défaut fera l'affaire
        return {}
    return {i: P[k] for i, k in cles.items() if P.get(k)}


def avec_visuel(f, v):
    """La fiche d'une carte, avec l'image de l'impression choisie."""
    f = dict(f or {})
    if v and v.get("image"):
        f.update(image=v["image"], petite=v["petite"], art=v["art"] or f.get("art", ""))
    return f


def version_courte(v):
    return dict(set=v["set"], num=v["num"], lang=v["lang"], edition=v["edition"], annee=v["annee"]) if v else None


def edition_image(nom, f):
    """Sous l'image d'une fiche de carte, comme dans la recherche : « édition · année » de l'image par défaut, et le nombre
    de versions. D'après la base de la recherche, sans l'attendre si elle se charge encore."""
    import recherche
    imp = f.get("imp") or {}
    ii = recherche.impression_image(nom, imp.get("set"))
    return dict(image_ed=dict(edition=ii["edition"], annee=ii["annee"], lang=imp.get("lang", "en")) if ii and ii["edition"] else None,
                versions=ii["versions"] if ii else 0)


def bracket_resume(deck):
    """Bracket estimé (règles officielles) pour l'accueil et l'en-tête, sans attendre Commander Spellbook : sa dernière
    analyse du deck sert en attendant la nouvelle, lancée en tâche de fond. (None, []) si le deck n'a jamais été analysé."""
    import bracket
    try:
        b = bracket.bracket(deck, reseau=False)
    except Exception:
        return None, []
    if not b["spellbook_a_jour"]:
        en_fond(bracket.rafraichir, deck)
    return (b["estime"], b["raisons"]) if b["spellbook"] else (None, [])


def resume_deck(deck, avec_cartes=False):
    entrees = decks.lire(decks.chemin(deck))
    cpt = decks.comptes(entrees)
    I = ic.infos(decks.noms(entrees))
    ic.game_changers()
    i_cmd = next((i for i, e in enumerate(entrees) if decks.categorie(e) == "Commander"), None)
    V = visuels(deck, entrees, None if avec_cartes else {i_cmd})
    jeu = [e for e in entrees if decks.categorie(e) != "Maybeboard"]
    prix_total = sum((I[e["nom"]] or {}).get("prix") or 0 for e in jeu for _ in range(e["n"]))
    gc = [e["nom"] for e in jeu if ic.est_gc(e["nom"])]
    trop_cher = [e["nom"] for e in entrees if ((I[e["nom"]] or {}).get("prix") or 0) > ic.BUDGET]
    cmd = cpt["commandant"]
    alertes, ident = alertes_cartes(entrees, I)
    hors_maybe = {e["nom"] for e in jeu}
    br, br_raisons = bracket_resume(deck)
    r = dict(bracket=br, bracket_raisons=br_raisons, id=deck, titre=deck.removeprefix("Deck "), note=decks.note(deck), **cpt, prix_total=round(prix_total, 2),
             commandants=[e["nom"] for e in entrees if decks.categorie(e) == "Commander"],
             gc=gc, trop_cher=trop_cher, art=avec_visuel(I.get(cmd), V.get(i_cmd)).get("art", ""),
             image_cmd=avec_visuel(I.get(cmd), V.get(i_cmd)).get("image", ""),
             identite=ident, alertes={n: a for n, a in alertes.items() if n in hors_maybe},
             modifie=os.path.getmtime(decks.chemin(deck)))
    if avec_cartes:
        try:
            import recherche
            F = recherche.fonctions_cartes(decks.noms(entrees)) or {}      # vide tant que la base se charge
        except Exception:
            F = {}
        cartes = []
        for i, e in enumerate(entrees):
            f = avec_visuel(I.get(e["nom"]), V.get(i))
            f["gc"] = ic.est_gc(e["nom"])
            el = eligibilite(e["nom"])
            f["peut_commander"], f["partenaire"] = (el["commandant"], el["partenaire"]) if el else (None, None)
            fam, fns = F.get(e["nom"], ([], []))
            cartes.append(dict(index=i, n=e["n"], nom=e["nom"], tags=e["tags"], cat=decks.categorie(e), info=f,
                               fonctions=fam, fonctions_detail=fns,
                               alertes=alertes.get(e["nom"], []), version=version_courte(V.get(i)), **edition_image(e["nom"], f)))
        r.update(cartes=cartes, categories=decks.categories(entrees))
    return r


# ---------------------------------------------------------------- pages
@app.get("/")
def accueil():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/sw.js")
def service_worker():
    """Gardé par le navigateur : quand l'Atelier n'est pas lancé, l'adresse montre /eteint (voir static/sw.js)."""
    r = send_from_directory(app.static_folder, "sw.js", mimetype="text/javascript", max_age=0)
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.get("/eteint")
def page_eteint():
    """« L'Atelier n'est pas lancé », avec le bouton qui le lance si le lien atelier-mtg:// est enregistré sur ce PC."""
    with open(os.path.join(app.static_folder, "eteint.html"), encoding="utf-8") as f:
        html = f.read()
    if lien_enregistre():
        html = html.replace('data-lancer=""', 'data-lancer="1"', 1)
    return Response(html, mimetype="text/html", headers={"Cache-Control": "no-cache"})


@app.get("/jouer")
def page_jouer():
    """Jouer tout seul (playtester) : une page à part, /jouer?deck=Deck Kels (code : jouer.py, static/jouer.*)."""
    return send_from_directory(app.static_folder, "jouer.html")


@app.get("/a-propos/<nom>")
def capture_a_propos(nom):
    """Captures de la page « C'est quoi, l'Atelier MTG ? » rangées dans le site partagé de ce PC (Partage Atelier/a-propos) :
    la page les montre avant leur mise en ligne. Ailleurs, 404, et la page les prend sur le site de l'auteur."""
    import partage
    return send_from_directory(os.path.join(partage.DOSSIER, "a-propos"), nom)


@app.get("/api/jouer/jetons")
def api_jouer_jetons():
    """Les jetons que créent les cartes du deck (Scryfall, gardés dans cache_jetons.json)."""
    import jouer
    deck = request.args.get("deck", "")
    return jsonify(jetons=jouer.jetons(decks.noms(decks.lire(decks.chemin(deck)), maybe=False)))


@app.get("/reglages.js")
def reglages_js():
    """Les réglages de cette installation (reglages.json) pour l'interface : budget par carte."""
    import json
    import reglages
    return Response("window.REGLAGES = " + json.dumps(reglages.pour_la_page()) + ";\n", mimetype="text/javascript")


# ---------------------------------------------------------------- options (reglages.json, démarrage de Windows) et classeur
@app.get("/api/options")
def api_options():
    import reglages
    r = reglages.lire()
    lang, sans_ub = reglages.impression()
    return jsonify(nom=r.get("nom") or "", github=r.get("github") or "", budget=r.get("budget"), budget_defaut=reglages.BUDGET_DEFAUT,
                   demarrage=demarrage(), fermeture="arreter" if reglages.arret_a_la_fermeture() else "garder",
                   langue_cartes=lang or "", sans_ub_illustrations=sans_ub, sans_ub_suggestions=reglages.sans_ub_suggestions(),
                   langues=reglages.LANGUES, preferences=bool(r.get("preferences")))


@app.post("/api/options")
def api_options_ecrire():
    """Ce qui change : nom, github, budget (vide = 5 € par défaut, 0 = pas d'alerte), demarrage (true / false),
    fermeture (garder / arreter), langue_cartes (vide = la moins chère, ou un code de reglages.LANGUES),
    sans_ub_illustrations, sans_ub_suggestions, preferences (true : les questions du premier lancement ont eu leur réponse)."""
    import reglages
    d = request.get_json() or {}
    ch = {}
    if "fermeture" in d:
        ch["fermeture"] = "arreter" if d["fermeture"] == "arreter" else "garder"
    if "preferences" in d:
        ch["preferences"] = True
    impression_avant = reglages.impression()
    if "langue_cartes" in d:
        if d["langue_cartes"] and d["langue_cartes"] not in reglages.LANGUES:
            raise ValueError("Langue inconnue.")
        ch["langue_cartes"] = d["langue_cartes"] or None
    for k in ("sans_ub_illustrations", "sans_ub_suggestions"):
        if k in d:
            ch[k] = bool(d[k]) or None
    if "nom" in d:
        ch["nom"] = " ".join(str(d["nom"]).split())[:60] or None
    if "github" in d:
        g = str(d["github"]).strip().lstrip("@")
        if g and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}", g):
            raise ValueError("Un compte GitHub ne contient que des lettres, des chiffres et des tirets.")
        ch["github"] = g or None
    if "budget" in d:
        b = str(d["budget"]).replace("€", "").replace(",", ".").strip()
        try:
            v = float(b) if b else None
        except ValueError:
            raise ValueError("Le budget est un nombre d'euros.") from None
        if v is not None and not 0 <= v <= 100000:
            raise ValueError("Le budget est un nombre d'euros.")
        ch["budget"] = None if v is None else int(v) if v == int(v) else v
    if ch:
        reglages.ecrire(**ch)
        ic.BUDGET = reglages.budget()                       # tout de suite, sans relancer l'Atelier
    if reglages.impression() != impression_avant:           # autre impression par défaut : images et prix refaits
        en_fond(ic.mise_a_jour, tous_les_noms())
    if "demarrage" in d:
        regler_demarrage(bool(d["demarrage"]))
    return api_options()


@app.get("/api/github")
def api_github():
    """Le compte GitHub connecté (partage sans git), et le compte du partage avec git (reglages.json), s'il y en a un."""
    import github
    import reglages
    return jsonify(compte=github.compte(), git=reglages.github(), disponible=bool(github.CLIENT_ID))


@app.post("/api/github/connexion")
def api_github_connecter():
    """Demande un code à GitHub : {etat, code, url}. La page le montre et suit GET /api/github/connexion."""
    import github
    return jsonify(github.connecter())


@app.get("/api/github/connexion")
def api_github_connexion():
    import github
    return jsonify(github.etat_connexion())


@app.post("/api/github/deconnexion")
def api_github_deconnecter():
    import github
    github.deconnecter()
    return api_github()


@app.post("/api/ouvrir-dossier")
def api_ouvrir_dossier():
    """Ouvre le dossier de l'Atelier (decks, classeur, réglages) dans l'explorateur de fichiers."""
    if os.name == "nt":
        os.startfile(decks.RACINE)
    else:
        import subprocess
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", decks.RACINE])
    return jsonify(ok=True)


@app.get("/api/classeur")
def api_classeur():
    """Les cartes du classeur (Classeur/classeur.txt), avec nom français, prix et image."""
    import classeur
    c = classeur.cartes()
    I = ic.infos(list(c))
    return jsonify(cartes=[dict(nom=n, n=k, info=I.get(n) or {}) for n, k in sorted(c.items(), key=lambda x: x[0].lower())])


@app.post("/api/classeur")
def api_classeur_modifier():
    """{liste : texte collé} ajoute ces cartes, noms corrigés comme à la création d'un deck ; {nom, n} : le nombre
    d'exemplaires de cette carte (0 = retirée). Renvoie le classeur, et les noms introuvables."""
    import classeur
    d = request.get_json() or {}
    inconnues = []
    if "liste" in d:
        ajouts = classeur.lire_liste(str(d["liste"]))
        I = ic.infos(list(ajouts))
        propres = {}
        for nom, n in ajouts.items():
            if I.get(nom):
                propres[I[nom]["nom"]] = propres.get(I[nom]["nom"], 0) + n
            else:
                inconnues.append(nom)
        classeur.ajouter(propres)
        en_fond(lambda: (ic.noms_francais(list(propres)), ic.rafraichir_prix(list(propres))))
    elif "nom" in d:
        classeur.fixer(str(d["nom"]), int(d.get("n", 0)))
    return jsonify(cartes=api_classeur().get_json()["cartes"], inconnues=inconnues)


@app.errorhandler(Exception)
def erreur(e):
    code = getattr(e, "code", 500)
    return jsonify(erreur=str(e)), code if isinstance(code, int) else 500


# ---------------------------------------------------------------- decks
@app.get("/api/decks")
def api_decks():
    return jsonify([resume_deck(d) for d in decks.dossiers() if os.path.exists(os.path.join(decks.RACINE, d, decks.FICHIER))])


@app.post("/api/decks")
def api_creer():
    """Nouveau deck : nom, commandant (facultatif), liste collée (facultatif, Archidekt / Moxfield / MTG Arena)."""
    d = request.get_json()
    deck = decks.creer(d.get("nom", ""), d.get("commandant", ""), d.get("liste", ""))
    entrees = decks.lire(decks.chemin(deck))
    if entrees:
        I = ic.infos(decks.noms(entrees))
        change = False
        for e in entrees:                                   # noms corrigés : « sol ring » → « Sol Ring », fautes de frappe
            f = I.get(e["nom"])
            if f and f["nom"] != e["nom"]:
                e["nom"], change = f["nom"], True
        vues = {}
        for e in list(entrees):                             # même carte sur deux lignes : une seule ligne, quantités additionnées
            cle = (e["nom"], decks.categorie(e) == "Maybeboard")
            if cle in vues:
                vues[cle]["n"] += e["n"]
                entrees.remove(e)
                change = True
            else:
                vues[cle] = e
        if change:
            with open(decks.chemin(deck), "w", encoding="utf-8", newline="\n") as fh:
                fh.write(decks.texte(entrees))
        noms = decks.noms(entrees)
        ic.infos(noms)
        en_fond(lambda: (ic.noms_francais(noms), ic.rafraichir_prix(noms)))
    return jsonify(id=deck)


@app.post("/api/decks/<path:deck>/supprimer")
def api_supprimer(deck):
    return jsonify(corbeille=decks.supprimer(deck))


@app.post("/api/decks/<path:deck>/renommer")
def api_renommer(deck):
    """{nom} : le nouveau nom. Pas pendant que Claude, une analyse ou une simulation travaille sur ce deck. La page
    partagée garde son adresse et se republie avec le nouveau titre."""
    for module, quoi in (("discussion", "Claude répond dans sa discussion"), ("synergies", "l'analyse des synergies tourne"),
                         ("mtgpics", "la recherche des combos tourne")):
        m = sys.modules.get(module)                         # module pas encore chargé : rien ne tourne
        if m and (m._jobs.get(deck) or {}).get("actif"):
            raise RuntimeError(f"Pas maintenant : {quoi}. Réessaie quand c'est fini.")
    m = sys.modules.get("simulation")
    if m and any(j["deck"] == deck and j["statut"] == "en_cours" for j in list(m._jobs.values())):
        raise RuntimeError("Pas maintenant : une simulation de ce deck tourne. Réessaie quand elle est finie.")
    nouveau = decks.renommer(deck, (request.get_json() or {}).get("nom", ""))
    if nouveau != deck:
        import partage
        partage.renommer(deck, nouveau)
    return jsonify(id=nouveau)


@app.get("/api/recherche-cartes")
def api_recherche_cartes():
    """Decks qui contiennent une carte dont le nom (anglais ou français) contient le texte : {deck: [noms]}."""
    q = ic._simple(request.args.get("q", "").strip())
    if len(q) < 3:
        return jsonify({})
    fiches = ic._charge()["cartes"]
    res = {}
    for d in decks.dossiers():
        p = os.path.join(decks.RACINE, d, decks.FICHIER)
        if not os.path.exists(p):
            continue
        trouve = [e["nom"] for e in decks.lire(p)
                  if q in ic._simple(e["nom"]) or q in ic._simple((fiches.get(e["nom"]) or {}).get("fr") or "")]
        if trouve:
            res[d] = trouve[:4] + ([f"et {len(trouve) - 4} autres"] if len(trouve) > 4 else [])
    return jsonify(res)


@app.get("/api/corbeille")
def api_corbeille():
    return jsonify(decks.corbeille())


@app.post("/api/corbeille/recuperer")
def api_recuperer():
    return jsonify(id=decks.recuperer(request.get_json()["fichier"]))


@app.get("/api/decks/<path:deck>")
def api_deck(deck):
    return jsonify(resume_deck(deck, avec_cartes=True))


@app.post("/api/decks/<path:deck>/modifier")
def api_modifier(deck):
    d = request.get_json()
    entrees = decks.modifier(deck, d["op"], d)
    nouveaux = [n for n in decks.noms(entrees) if n not in ic._charge()["cartes"]]
    if nouveaux:
        ic.infos(nouveaux)
        en_fond(lambda: (ic.noms_francais(nouveaux), ic.rafraichir_prix(nouveaux)))
    return jsonify(resume_deck(deck, avec_cartes=True))


def nom_export(nom, fmt):
    """fr : le nom français ; arena et mtgo : le recto seul d'une carte recto-verso (ou à aventure), comme dans ces jeux."""
    import recherche
    b = recherche._base
    x = b and b["par_cle"].get(ic._cle(nom).lower())
    if fmt == "fr":
        return (ic._charge()["cartes"].get(nom) or {}).get("fr") or (x and x.get("fr")) or nom
    if " // " in nom and fmt in ("arena", "mtgo"):
        if x and x["lay"] in ("split", "aftermath"):               # Feu // Glace reste entière
            return nom.replace(" // ", "/") if fmt == "mtgo" else nom
        return ic._cle(nom)
    return nom


@app.get("/api/decks/<path:deck>/export")
def api_export(deck):
    """?format= archidekt (par défaut), moxfield, arena, mtgo, simple, fr."""
    fmt = request.args.get("format", "archidekt")
    return Response(decks.exporter(decks.lire(decks.chemin(deck)), fmt, nom_export), mimetype="text/plain; charset=utf-8")


@app.get("/api/decks/<path:deck>/achats")
def api_achats(deck):
    """Cartes que j'ai pour ce deck : {possedees: {nom: exemplaires}} ; le reste est à acheter. Reste sur ce PC."""
    return jsonify(possedees=decks.possedees(deck))


@app.post("/api/decks/<path:deck>/achats")
def api_marquer(deck):
    """{possedees: {nom: exemplaires que j'ai}}, ajoutées à celles déjà notées."""
    return jsonify(possedees=decks.marquer(deck, request.get_json().get("possedees", {})))


@app.get("/api/decks/<path:deck>/suggestions")
def api_suggestions(deck):
    """Cartes à proposer pour le deck : thème, combos à une carte près, classeur (base locale)."""
    import suggestions
    return jsonify(suggestions.calculer(deck))


@app.post("/api/decks/<path:deck>/suggestions/ecarter")
def api_suggestions_ecarter(deck):
    """{nom, ecarter} : « Ne plus proposer » cette carte pour ce deck (ecarter=false la repropose)."""
    import suggestions
    d = request.get_json()
    return jsonify(ecartees=suggestions.ecarter(deck, d["nom"], d.get("ecarter", True)))


@app.get("/api/decks/<path:deck>/partage")
def api_partage(deck):
    """Page partagée du deck sur GitHub Pages : {url, date}, ou {} s'il n'est pas partagé."""
    import partage
    return jsonify(partage.etat(deck))


@app.post("/api/decks/<path:deck>/partage")
def api_partager(deck):
    """Publie ou met à jour la page partagée : les réponses de l'API sont figées par le client de test de Flask."""
    import partage
    return jsonify(partage.partager(deck, app.test_client().get))


@app.post("/api/decks/<path:deck>/partage/retirer")
def api_partage_retirer(deck):
    import partage
    return jsonify(partage.retirer(deck))


@app.get("/api/decks/<path:deck>/versions")
def api_versions(deck):
    return jsonify(decks.versions(deck))


@app.post("/api/decks/<path:deck>/versions")
def api_sauver_version(deck):
    d = request.get_json()
    return jsonify(fichier=decks.sauver_version(deck, d.get("nom", ""), d.get("note", "")))


@app.post("/api/decks/<path:deck>/versions/supprimer")
def api_supprimer_version(deck):
    decks.supprimer_version(deck, request.get_json()["fichier"])
    return jsonify(ok=True)


@app.post("/api/decks/<path:deck>/restaurer")
def api_restaurer(deck):
    decks.restaurer(deck, request.get_json()["fichier"])
    return jsonify(resume_deck(deck, avec_cartes=True))


@app.get("/api/decks/<path:deck>/comparer")
def api_comparer(deck):
    """Deux versions côte à côte : cartes propres à chacune (avec prix et nom français), totaux, Game Changers."""
    fa, fb = request.args.get("a", ""), request.args.get("b", "")
    c = decks.comparer(deck, fa, fb)
    for cle, f in (("a", fa), ("b", fb)):
        noms = decks.noms_jeu(decks.lire(decks.chemin_version(deck, f)))
        I = ic.infos(noms)
        c[cle]["prix"] = round(sum((I[n] or {}).get("prix") or 0 for n in noms), 2)
        c[cle]["gc"] = sorted({n for n in noms if ic.est_gc(n)})
    I = ic.infos(c["seulement_a"] + c["seulement_b"])
    c["infos"] = {n: dict(fr=(I[n] or {}).get("fr"), prix=(I[n] or {}).get("prix"), image=(I[n] or {}).get("image"),
                          cout=(I[n] or {}).get("cout"), type=(I[n] or {}).get("type"), gc=ic.est_gc(n)) for n in I}
    return jsonify(c)


# ---------------------------------------------------------------- simulations
@app.get("/api/decks/<path:deck>/simulation/options")
def api_sim_options(deck):
    import simulation
    try:
        cov = simulation.couverture_deck(deck)
    except Exception:                                       # le simulateur ne doit jamais empêcher d'ouvrir l'onglet
        cov = None
    return jsonify(tables=simulation.tables_dispo(), reglages=simulation.lire_reglages(deck), defaut=simulation.reglages_defaut(),
                   versions=decks.versions(deck), coeurs=max(1, (os.cpu_count() or 2) - 1), couverture=cov,
                   affine=bool(simulation.textes(deck)), test_n=simulation.TEST_N)


@app.get("/api/decks/<path:deck>/simulation/cartes")
def api_sim_cartes(deck):
    """Pour Claude (demander.py couverture) : les cartes que le simulateur lit mal, avec leurs lignes non comprises, et
    les textes de simulateur.json qu'il ne comprend pas encore."""
    import simulation
    return jsonify(simulation.couverture_deck(deck, detail=True) | dict(textes=simulation.textes(deck)))


@app.post("/api/decks/<path:deck>/reglages")
def api_reglages(deck):
    import simulation
    return jsonify(simulation.ecrire_reglages(deck, request.get_json()))


@app.post("/api/decks/<path:deck>/simulations")
def api_simuler(deck):
    import simulation
    d = request.get_json()
    job = simulation.lancer(deck, d.get("a", ""), d.get("b"), d.get("tables", ["Mixte"]), d.get("n", 1000), d.get("reglages") or {})
    return jsonify(simulation.suivi(job["id"]))


@app.get("/api/decks/<path:deck>/simulations")
def api_rapports(deck):
    import simulation
    return jsonify(simulation.rapports(deck))


@app.get("/api/decks/<path:deck>/simulations/<fichier>")
def api_rapport(deck, fichier):
    import simulation
    return jsonify(simulation.rapport(deck, fichier))


@app.get("/api/jobs/<id_>")
def api_job(id_):
    import simulation
    j = simulation.suivi(id_)
    return (jsonify(j), 200) if j else (jsonify(erreur="simulation inconnue (l'Atelier a peut-être redémarré)"), 404)


@app.post("/api/jobs/<id_>/annuler")
def api_annuler(id_):
    import simulation
    simulation.annuler(id_)
    return jsonify(ok=True)


# ---------------------------------------------------------------- cartes, prix, Game Changers
@app.get("/api/chercher")
def api_chercher():
    return jsonify(ic.chercher(request.args.get("q", "")))


@app.post("/api/prix")
def api_prix():
    """Prix du jour (le plus bas) et nom français des résultats d'une recherche."""
    noms = [n for n in (request.get_json().get("noms") or []) if n][:25]
    return jsonify(ic.prix_et_noms(noms))


@app.get("/api/carte")
def api_carte():
    nom = request.args["nom"]
    ic.infos([nom])
    ic.rafraichir_prix([nom], suivi=False)
    ic.noms_francais([nom], suivi=False)
    v = None
    if request.args.get("set") and request.args.get("num"):          # impression choisie avant d'ajouter la carte
        k = (request.args["set"], request.args["num"], request.args.get("lang", "en"))
        v = ic.impressions([k]).get((k[0].lower(), k[1], k[2] or "en"))
    f = avec_visuel(ic._charge()["cartes"].get(nom), v)
    f["version"] = version_courte(v)
    f["gc"] = ic.est_gc(nom)
    el = eligibilite(nom)
    f["peut_commander"], f["partenaire"] = (el["commandant"], el["partenaire"]) if el else (None, None)
    f["trop_cher"] = (f.get("prix") or 0) > ic.BUDGET
    f.update(edition_image(nom, f))
    return jsonify(f)


@app.get("/api/impressions")
def api_impressions():
    """Toutes les impressions d'une carte (anglaises et françaises), pour choisir son visuel."""
    nom = request.args["nom"]
    ic.infos([nom])
    return jsonify(ic.impressions_carte(nom))


# ---------------------------------------------------------------- recherche de cartes (moteur façon Magic-Ville)
@app.get("/api/recherche")
def api_recherche():
    """Une page de résultats ; les critères sont ceux de la page (#/recherche?…), deck= pour marquer ses cartes."""
    import recherche
    return jsonify(recherche.chercher(request.args.to_dict(), request.args.get("deck") or None))


@app.get("/api/recherche/base")
def api_recherche_base():
    import recherche
    return jsonify(recherche.etat_base())


@app.post("/api/recherche/base")
def api_recherche_maj():
    """Refait la base de cartes en tâche de fond (complet=true : relit aussi tous les textes français)."""
    import recherche
    en_fond(recherche.construire, bool((request.get_json(silent=True) or {}).get("complet")))
    return jsonify(recherche.etat_base())


@app.get("/api/recherche/editions")
def api_recherche_editions():
    import recherche
    return jsonify(recherche.editions())


@app.get("/api/recherche/fonctions")
def api_recherche_fonctions():
    import recherche
    return jsonify(recherche.fonctions())


@app.get("/api/recherche/noms")
def api_recherche_noms():
    """Champ du haut : les cartes dont le nom (français ou anglais) correspond ; deck= pour marquer celles qu'il contient."""
    import recherche
    return jsonify(recherche.noms(request.args.get("q", ""), request.args.get("deck") or None))


@app.get("/api/noms-cartes")
def api_noms_cartes():
    """Noms de toutes les cartes, pour donner un aperçu au survol de chaque carte citée (revérifié à chaque chargement)."""
    import recherche
    d = recherche.noms_cites()
    if d is None:
        return jsonify(noms=[], communs=[])
    r = jsonify(d)
    r.set_etag(f"{recherche.base()['date']}-{len(d['noms'])}-{len(d['communs'])}")
    r.headers["Cache-Control"] = "no-cache"
    return r.make_conditional(request)


@app.get("/api/apercu-carte")
def api_apercu_carte():
    import recherche
    return jsonify(recherche.apercu(request.args.get("nom", "")))


@app.get("/api/recherche/tags")
def api_recherche_tags():
    """Fonctions Scryfall Tagger qui correspondent au texte tapé (fenêtre Fonctions de la recherche)."""
    import recherche
    return jsonify(recherche.suggestions(request.args.get("q", "")))


@app.get("/api/decks/<path:deck>/apercu")
def api_apercu(deck):
    """L'essentiel d'un deck pour la page Recherche (et pour voir s'il a changé dans un autre onglet)."""
    entrees = decks.lire(decks.chemin(deck))
    cpt = decks.comptes(entrees)
    cmds = [e["nom"] for e in entrees if decks.categorie(e) == "Commander"]
    I = ic.infos(cmds) if cmds else {}
    ident = sorted(set().union(*[set(I[c].get("couleurs") or []) for c in cmds])) if cmds and all(I.get(c) for c in cmds) else None
    return jsonify(dict(id=deck, titre=deck.removeprefix("Deck "), identite=ident, **cpt, categories=decks.categories(entrees),
                        modifie=os.path.getmtime(decks.chemin(deck))))


@app.get("/api/decks/<path:deck>/combos")
def api_combos(deck):
    """Vue « deck » : combos présentes (Magic-Ville, Commander Spellbook, synergies de Claude)."""
    import combos
    return jsonify(combos.combos_deck(deck, force=request.args.get("force") == "1"))


@app.get("/api/decks/<path:deck>/combos/carte")
def api_combos_carte(deck):
    """Vue « carte » : les cartes qui combotent avec elle, dans les couleurs du deck (couleurs=1) ou non."""
    import combos
    return jsonify(combos.combos_carte(deck, request.args["nom"], request.args.get("couleurs", "1") == "1",
                                       force=request.args.get("force") == "1"))


@app.get("/api/decks/<path:deck>/mtgpics")
def api_mtgpics(deck):
    """Combos MTGPics de toutes les cartes du deck : où en est la recherche."""
    import mtgpics
    return jsonify(mtgpics.etat_deck(deck))


@app.post("/api/decks/<path:deck>/mtgpics")
def api_mtgpics_lancer(deck):
    """Cherche en tâche de fond les combos MTGPics des cartes du deck pas encore regardées (une requête toutes les 1,5 s)."""
    import mtgpics
    return jsonify(mtgpics.lancer_deck(deck))


@app.get("/api/decks/<path:deck>/synergies")
def api_synergies(deck):
    import synergies
    return jsonify(synergies.etat(deck))


@app.post("/api/decks/<path:deck>/synergies")
def api_lancer_synergies(deck):
    import synergies
    return jsonify(synergies.lancer(deck, (request.get_json(silent=True) or {}).get("modele", "")))


@app.get("/api/decks/<path:deck>/bracket")
def api_bracket(deck):
    import bracket
    return jsonify(bracket.bracket(deck, force=request.args.get("force") == "1"))


@app.get("/api/etat")
def api_etat():
    """L'avancement des mises à jour ; la page l'interroge toutes les 3 s (?page=… : elle est encore ouverte)."""
    if request.args.get("page"):
        page_ouverte(request.args["page"])
    gc = ic._charge()["gc"]
    return jsonify(dict(maj=dict(ic.etat), gc_nb=len(gc.get("noms") or []), gc_maj=gc.get("maj")))


# ---------------------------------------------------------------- arrêt : bouton des Options, ou dernière page fermée
_pages = {}                    # pages ouvertes : identifiant -> dernière nouvelle (heure)
_pages_vues = threading.Event()
PAGE_PERDUE = 150              # s sans nouvelles d'une page : fermée sans prévenir (un onglet en arrière-plan écrit 1 fois/min)
DELAI_ARRET = 20               # s après la dernière page fermée : un rechargement ou un lien vers une autre page n'arrête rien
_icone = None                  # le chaudron de la barre d'état, à retirer avant de s'arrêter


def page_ouverte(page):
    _pages[str(page)[:40]] = time.time()
    _pages_vues.set()


@app.post("/api/presence/fin")
def api_presence_fin():
    """Une page se ferme (navigator.sendBeacon) : l'identifiant de la page dans le corps."""
    _pages.pop(request.get_data(as_text=True)[:40], None)
    return "", 204


def occupe_pour_arreter():
    """Ce que l'arrêt automatique attend : ce qu'un redémarrage couperait, plus les mises à jour et les partages."""
    import partage
    import recherche
    return occupe() or (recherche.etat_base()["construction"].get("actif") and "la base de cartes se construit") \
        or (ic.etat.get("tache") and "une mise à jour tourne") or (partage._verrou.locked() and "un partage se publie")


def arreter():
    """Arrête l'Atelier : le chaudron disparaît de la barre d'état (lancement normal), sinon le programme s'arrête."""
    if _icone:
        _icone.stop()                              # barre_etat rend la main : le lancement se termine (os._exit)
    else:
        os._exit(0)


def surveiller_fermeture(pas=10):
    """Réglage « Arrêter l'Atelier » à la fermeture de la page : une fois qu'une page a été ouverte, l'Atelier s'arrête
    quand plus aucune n'est ouverte et que rien ne tourne. Un PC en veille ne compte pas comme une page fermée."""
    import reglages
    vide_depuis, avant = None, time.time()
    while True:
        time.sleep(pas)
        maintenant = time.time()
        if maintenant - avant > 3 * pas:           # sortie de veille : les pages n'ont pas pu donner de nouvelles
            for p in _pages:
                _pages[p] = maintenant
        avant = maintenant
        for p, t in list(_pages.items()):
            if maintenant - t > PAGE_PERDUE:
                _pages.pop(p, None)
        if _pages or not _pages_vues.is_set() or not reglages.arret_a_la_fermeture():
            vide_depuis = None
            continue
        vide_depuis = vide_depuis or maintenant
        if maintenant - vide_depuis >= DELAI_ARRET and not occupe_pour_arreter():
            arreter()


@app.post("/api/arreter")
def api_arreter():
    """Bouton « Arrêter l'Atelier » des Options."""
    o = occupe()
    if o:
        return jsonify(erreur=f"Arrêt impossible pour l'instant : {o}. Réessaie quand c'est fini."), 409
    threading.Timer(0.5, arreter).start()          # le temps de répondre à la page
    return jsonify(ok=True)


@app.post("/api/rafraichir")
def api_rafraichir():
    def tache():
        ic.game_changers(force=True)
        ic.mise_a_jour(tous_les_noms(), force_prix=True)
    en_fond(tache)
    return jsonify(ok=True)


# ---------------------------------------------------------------- discussion avec Claude
# Une discussion par deck (?deck=Deck Sefris), plus la discussion générale (deck vide), chacune avec sa session Claude.
@app.get("/api/discussion")
def api_discussion():
    import discussion
    cle = request.args.get("deck", "")
    e = discussion.lire_etat(cle)
    return jsonify(messages=e["messages"], session=bool(e.get("session")), contexte=e.get("contexte"),
                   disponible=bool(discussion.trouver_claude()), en_cours=discussion.en_cours(cle))


@app.post("/api/discussion/nouvelle")
def api_discussion_nouvelle():
    import discussion
    discussion.nouvelle((request.get_json(silent=True) or {}).get("deck", ""))
    return jsonify(ok=True)


@app.post("/api/discussion")
def api_discussion_envoyer():
    """Lance la réponse de Claude en tâche de fond ; la page suit son avancement avec /api/discussion/en-cours.
    Elle continue même si la page est fermée ou rechargée."""
    import discussion
    d = request.get_json()
    return jsonify(discussion.lancer(d.get("message", ""), d.get("page", ""), d.get("modele", ""), d.get("deck", "")))


@app.post("/api/discussion/compacter")
def api_discussion_compacter():
    """/compact : Claude résume la conversation pour qu'elle coûte moins de tokens ; suivi comme une réponse."""
    import discussion
    d = request.get_json(silent=True) or {}
    return jsonify(discussion.compacter(d.get("deck", ""), d.get("modele", "")))


@app.get("/api/discussion/en-cours")
def api_discussion_en_cours():
    """État de la réponse en cours dans une discussion, plus la liste des discussions où Claude répond (« actives »)."""
    import discussion
    return jsonify(discussion.en_cours(request.args.get("deck", "")))


@app.post("/api/discussion/arreter")
def api_discussion_arreter():
    import discussion
    discussion.arreter((request.get_json(silent=True) or {}).get("deck", ""))
    return jsonify(ok=True)


# ---------------------------------------------------------------- version et mise à jour (mise_a_jour.py)
@app.get("/api/version")
def api_version():
    import mise_a_jour
    from version import __version__
    return jsonify(version=__version__, disponible=mise_a_jour.disponible())


def occupe():
    """Ce qu'un redémarrage couperait : une réponse de Claude, une recherche de synergies, une simulation."""
    import discussion
    import simulation
    import synergies
    if discussion.en_cours("")["actives"]:
        return "Claude est en train de répondre"
    if any(j.get("actif") for j in synergies._jobs.values()):
        return "Claude cherche des synergies"
    if any(j.get("statut") == "en_cours" for j in simulation._jobs.values()):
        return "une simulation tourne"
    return None


@app.post("/api/mise-a-jour")
def api_mise_a_jour():
    """Installe la version annoncée, puis redémarre l'Atelier : la page attend la nouvelle version et se recharge."""
    import mise_a_jour
    d = mise_a_jour.disponible()
    if not d:
        return jsonify(erreur="Aucune nouvelle version à installer."), 400
    o = occupe()
    if o:
        return jsonify(erreur=f"Mise à jour impossible pour l'instant : {o}. Réessaie quand c'est fini."), 409
    try:
        installeur = mise_a_jour.installer(d["version"])
    except mise_a_jour.Echec as e:
        return jsonify(erreur=str(e)), 409
    mise_a_jour.redemarrer(PORT, os.path.abspath(__file__), installeur)
    return jsonify(version=d["version"])


# ---------------------------------------------------------------- lancement
def port_pris(port):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def atelier_sur(port):
    """L'Atelier répond-il déjà sur ce port (et pas un autre programme, comme AirPlay sur le port 5000 d'un Mac) ?"""
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/reglages.js", timeout=3) as r:
            return r.read(40).startswith(b"window.REGLAGES")
    except Exception:
        return False


def icone_possible():
    try:
        import pystray  # noqa: F401
        return True
    except Exception:
        return False


# Windows : le lien atelier-mtg:// lance l'Atelier dans la barre d'état, sans ouvrir d'onglet (la page « L'Atelier n'est
# pas lancé » le propose, puis se recharge). Dans le registre de l'utilisateur, sans droits d'administrateur. La commande
# ne reçoit pas l'adresse du lien : un site qui l'appellerait ne peut rien faire d'autre que lancer l'Atelier.
LIEN = r"Software\Classes\atelier-mtg"


def lien_enregistre():
    if os.name != "nt":
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, LIEN + r"\shell\open\command"):
            return True
    except OSError:
        return False


def pythonw():
    """Windows : le Python sans fenêtre qui lance l'Atelier dans la barre d'état ; None s'il n'y en a pas, ou sans icône
    possible (on ne pourrait plus l'arrêter)."""
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    return pyw if os.name == "nt" and os.path.isfile(pyw) and icone_possible() else None


def enregistrer_lien():
    pyw = pythonw()
    if not pyw:
        return
    import winreg
    try:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, LIEN) as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:Atelier MTG")
            winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, LIEN + r"\shell\open") as k:      # « Ouvrir Atelier MTG ? », pas « Python »
            winreg.SetValueEx(k, "FriendlyAppName", 0, winreg.REG_SZ, "Atelier MTG")
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, LIEN + r"\shell\open\command") as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, f'"{pyw}" "{os.path.abspath(__file__)}" --sans-navigateur')
    except OSError:
        pass


# Windows : l'Atelier lancé à l'ouverture de session (raccourci « Atelier MTG » du dossier Démarrage), sans ouvrir d'onglet
def _raccourci_demarrage():
    return os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Atelier MTG.lnk")


def demarrage():
    """True ou False ; None si l'option n'existe pas sur ce PC."""
    return os.path.isfile(_raccourci_demarrage()) if pythonw() and os.environ.get("APPDATA") else None


def regler_demarrage(oui):
    lien = _raccourci_demarrage()
    if not oui:
        if os.path.isfile(lien):
            os.remove(lien)
        return
    pyw = pythonw()
    if not pyw or not os.environ.get("APPDATA"):
        raise RuntimeError("Le lancement au démarrage n'existe que sous Windows.")
    import subprocess
    icone = os.path.join(ICI, "atelier.ico")
    env = dict(os.environ, LIEN=lien, CIBLE=pyw, ARGS=f'"{os.path.abspath(__file__)}" --sans-navigateur', DOSSIER=decks.RACINE,
               ICONE=icone if os.path.isfile(icone) else pyw)
    r = subprocess.run(["powershell", "-NoProfile", "-Command",
                        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LIEN); $s.TargetPath = $env:CIBLE; "
                        "$s.Arguments = $env:ARGS; $s.WorkingDirectory = $env:DOSSIER; $s.IconLocation = $env:ICONE; "
                        "$s.Description = 'Atelier MTG'; $s.Save()"],
                       env=env, capture_output=True, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode or not os.path.isfile(lien):
        raise RuntimeError("Windows refuse de créer le raccourci de démarrage : "
                           + ((r.stderr or r.stdout or "").strip().splitlines() or ["?"])[-1])


def relancer_sans_console():
    """Windows : relance l'Atelier avec pythonw, sans fenêtre ; il vit dans la barre d'état. False si c'est impossible."""
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    if os.name != "nt" or not os.path.isfile(pyw) or not icone_possible():
        return False
    import subprocess
    subprocess.Popen([pyw, os.path.abspath(__file__), *[a for a in sys.argv[1:] if a != "--barre"]], close_fds=True,
                     creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
    return True


def montrer_icone():
    """Windows 11 range les nouvelles icônes derrière la flèche ^ : on affiche le chaudron dans la barre, sauf si
    on l'a soi-même caché (Paramètres › Barre des tâches)."""
    if os.name != "nt":
        return
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Control Panel\NotifyIconSettings") as racine:
            for i in range(winreg.QueryInfoKey(racine)[0]):
                with winreg.OpenKey(racine, winreg.EnumKey(racine, i), 0, winreg.KEY_READ | winreg.KEY_SET_VALUE) as k:
                    try:
                        exe = winreg.QueryValueEx(k, "ExecutablePath")[0]
                    except FileNotFoundError:
                        continue
                    if os.path.normcase(exe) != os.path.normcase(sys.executable):
                        continue
                    try:
                        winreg.QueryValueEx(k, "IsPromoted")             # déjà choisi : on n'y touche pas
                    except FileNotFoundError:
                        winreg.SetValueEx(k, "IsPromoted", 0, winreg.REG_DWORD, 1)
    except OSError:
        pass


def barre_etat(url):
    """Le chaudron dans la barre d'état, près de l'horloge : clic = ouvrir l'Atelier ; clic droit › Quitter.
    Rend la main quand on choisit « Quitter »."""
    import pystray
    from image_partage import _chaudron

    def ouvrir(icone, item):
        webbrowser.open(url)

    def quitter(icone, item):
        icone.stop()
    global _icone
    menu = pystray.Menu(pystray.MenuItem("Ouvrir l'Atelier", ouvrir, default=True), pystray.MenuItem("Quitter", quitter))
    threading.Timer(4, montrer_icone).start()      # Windows enregistre l'icône quand elle apparaît
    _icone = pystray.Icon("atelier-mtg", _chaudron(64), "Atelier MTG", menu)
    _icone.run()


if __name__ == "__main__":
    os.chdir(decks.RACINE)                         # comme le raccourci et « Atelier MTG.bat », même lancé par le lien atelier-mtg://
    # dans la barre d'état : lancé sans console (raccourci du bureau), ou avec --barre (« Atelier MTG.bat »)
    barre = SANS_CONSOLE or "--barre" in sys.argv
    if barre and not SANS_CONSOLE:                 # lancé dans une console : on repart sans elle
        if relancer_sans_console():
            sys.exit(0)
        barre = False                              # pas de pythonw ou de pystray : l'Atelier reste dans cette fenêtre
    if barre and not icone_possible():             # sans console ni icône, on ne pourrait plus l'arrêter
        if os.name == "nt":
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, "Il manque pystray : lance « python installer.py » dans le dossier de l'Atelier.",
                                             "Atelier MTG", 0x10)
        sys.exit(1)
    for p in range(PORT, PORT + 20):               # port occupé par un autre programme : le suivant
        if not port_pris(p):
            PORT = p
            break
        if atelier_sur(p):                         # l'Atelier est déjà ouvert : on montre sa page
            if "--sans-navigateur" not in sys.argv:
                webbrowser.open(f"http://127.0.0.1:{p}")
            sys.exit(0)
    url = f"http://127.0.0.1:{PORT}"
    os.environ["ATELIER_PORT"] = str(PORT)         # pour demander.py, que Claude lance depuis la discussion
    import simulation
    simulation.effacer_anciens()                   # rapports d'avant les jauges de régularité, avant que le partage ne parte
    en_fond(ic.mise_a_jour, tous_les_noms())
    import recherche
    en_fond(recherche.demarrer)                    # base de la recherche de cartes : chargée, puis surveillée (nouvelles cartes, prix)
    if "--essai" not in sys.argv:                  # un Atelier d'essai lancé à côté ne publie rien et ne se met pas à jour
        import mise_a_jour
        import partage
        en_fond(partage.surveiller, app.test_client().get)     # pages partagées remises à jour quand un deck change
        en_fond(mise_a_jour.surveiller)                        # nouvelle version de l'Atelier : lue une fois par jour
        enregistrer_lien()
    en_fond(surveiller_fermeture)                  # réglage « Arrêter l'Atelier » quand on ferme la page
    if "--sans-navigateur" not in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    if barre:
        threading.Thread(target=lambda: app.run(host="127.0.0.1", port=PORT, threaded=True, debug=False), daemon=True).start()
        barre_etat(url)
        os._exit(0)                                # « Quitter » : tout s'arrête, comme en fermant la fenêtre
    print(f"Atelier MTG : {url}  (ferme cette fenêtre pour arrêter l'Atelier)")
    app.run(host="127.0.0.1", port=PORT, threaded=True, debug=False)
