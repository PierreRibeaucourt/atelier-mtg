"""Atelier MTG : interface locale pour consulter et éditer les decks, vérifier prix et bracket, simuler, discuter avec Claude.

Lancement : double-clic sur « Atelier MTG.bat » (dossier MTG), ou  python outils/atelier/app.py
La page s'ouvre sur http://127.0.0.1:5000 (rien n'est accessible depuis l'extérieur de ton PC).
"""
import os
import re
import socket
import sys
import threading
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
    noms = set()
    for d in decks.dossiers():
        p = os.path.join(decks.RACINE, d, decks.FICHIER)
        if os.path.exists(p):
            noms |= set(decks.noms(decks.lire(p)))
    return sorted(noms)


def en_fond(f, *a, **kw):
    threading.Thread(target=f, args=a, kwargs=kw, daemon=True).start()


def couverture_sim(entrees, cmd):
    """Ce que le simulateur comprend de chaque carte : {nom: (classe, lignes non comprises)}."""
    try:
        from simu_cartes import construire, couverture
        noms = [n for n in decks.noms(entrees) if n != cmd]
        C, cov = construire(noms, cmd)
        res = {}
        for cle in ("partiel", "corps", "sans_effet"):
            for n in cov[cle]:
                res[n] = dict(classe=cle, non_lu=C[n].get("non_lu", []))
        for n in cov["specifique"]:
            res[n] = dict(classe="specifique", non_lu=[])
        return res
    except Exception as e:                                  # le simulateur ne doit jamais empêcher d'afficher un deck
        return {"_erreur": dict(classe="erreur", non_lu=[str(e)])}


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
        cov = couverture_sim(entrees, cmd) if cmd else {}
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
            cartes.append(dict(index=i, n=e["n"], nom=e["nom"], tags=e["tags"], cat=decks.categorie(e), info=f, sim=cov.get(e["nom"]),
                               fonctions=fam, fonctions_detail=fns,
                               alertes=alertes.get(e["nom"], []), version=version_courte(V.get(i))))
        r.update(cartes=cartes, categories=decks.categories(entrees), erreur_sim=cov.get("_erreur"))
    return r


# ---------------------------------------------------------------- pages
@app.get("/")
def accueil():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/jouer")
def page_jouer():
    """Jouer tout seul (playtester) : une page à part, /jouer?deck=Deck Kels (code : jouer.py, static/jouer.*)."""
    return send_from_directory(app.static_folder, "jouer.html")


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
    return jsonify(tables=simulation.tables_dispo(), reglages=simulation.lire_reglages(deck), defaut=simulation.reglages_defaut(),
                   versions=decks.versions(deck), coeurs=max(1, (os.cpu_count() or 2) - 1))


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
    gc = ic._charge()["gc"]
    return jsonify(dict(maj=dict(ic.etat), gc_nb=len(gc.get("noms") or []), gc_maj=gc.get("maj")))


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
        mise_a_jour.installer(d["version"])
    except mise_a_jour.Echec as e:
        return jsonify(erreur=str(e)), 409
    mise_a_jour.redemarrer(PORT, os.path.abspath(__file__))
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
    menu = pystray.Menu(pystray.MenuItem("Ouvrir l'Atelier", ouvrir, default=True), pystray.MenuItem("Quitter", quitter))
    threading.Timer(4, montrer_icone).start()      # Windows enregistre l'icône quand elle apparaît
    pystray.Icon("atelier-mtg", _chaudron(64), "Atelier MTG", menu).run()


if __name__ == "__main__":
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
            webbrowser.open(f"http://127.0.0.1:{p}")
            sys.exit(0)
    url = f"http://127.0.0.1:{PORT}"
    en_fond(ic.mise_a_jour, tous_les_noms())
    import recherche
    en_fond(recherche.demarrer)                    # base de la recherche de cartes : chargée, puis surveillée (nouvelles cartes, prix)
    if "--essai" not in sys.argv:                  # un Atelier d'essai lancé à côté ne publie rien et ne se met pas à jour
        import mise_a_jour
        import partage
        en_fond(partage.surveiller, app.test_client().get)     # pages partagées remises à jour quand un deck change
        en_fond(mise_a_jour.surveiller)                        # nouvelle version de l'Atelier : lue une fois par jour
    if "--sans-navigateur" not in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    if barre:
        threading.Thread(target=lambda: app.run(host="127.0.0.1", port=PORT, threaded=True, debug=False), daemon=True).start()
        barre_etat(url)
        os._exit(0)                                # « Quitter » : tout s'arrête, comme en fermant la fenêtre
    print(f"Atelier MTG : {url}  (ferme cette fenêtre pour arrêter l'Atelier)")
    app.run(host="127.0.0.1", port=PORT, threaded=True, debug=False)
