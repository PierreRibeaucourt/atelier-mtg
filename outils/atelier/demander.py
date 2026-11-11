"""L'Atelier en ligne de commande, pour l'assistant IA : ce que montre l'interface, en texte court.

Claude, dans la discussion de l'Atelier (ou tout assistant ouvert dans ce dossier), voit ainsi la même chose que
l'utilisateur : decks, statistiques, suggestions, combos, bracket, classeur, achats, versions, simulations, recherche de
cartes. La commande interroge l'Atelier lancé sur ce PC (port ATELIER_PORT, 5000 par défaut) : mêmes calculs, mêmes
données. Seules les statistiques sont refaites ici, avec le calcul de l'onglet Statistiques (calculStats et
tableauBaseMana dans static/app.js) : les garder identiques.

    python outils/atelier/demander.py aide
"""
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

URL = f"http://127.0.0.1:{os.environ.get('ATELIER_PORT', '5000')}"
# lancer Claude depuis Claude, redémarrer l'Atelier qui fait tourner la discussion, toucher à la connexion GitHub : jamais d'ici
INTERDITS = ("/api/discussion", "/api/mise-a-jour", "/api/github", "/api/ouvrir-dossier")

AIDE = """Ce que montre l'Atelier, en texte. <deck> : nom du dossier (« Deck Kels ») ou une partie du nom (« kels »).

  decks                                   tous les decks : commandant, cartes, prix, bracket
  deck <deck> [--texte]                   la liste par catégorie (Maybeboard compris), prix, fonctions ; --texte : textes Oracle
  stats <deck>                            onglet Statistiques : courbe, types, fonctions et tags comparés aux repères,
                                          base de mana (confort de chaque couleur), main de départ, cartes les plus chères
  suggestions <deck> [theme|combos|classeur|tout] [--n 20] [--type Créatures] [--fonction Ramp] [--prixmax 2] [--texte]
                                          onglet Suggestions : cartes à ajouter, déjà filtrées (couleurs, légalité, budget,
                                          hors deck et Maybeboard), triées par intérêt ; sans groupe : les trois groupes
  ecarter <deck> <carte>                  « Écarter » une suggestion (ne plus la proposer) ; reproposer <deck> <carte> l'annule
  combos <deck> [--texte]                 onglet Combos : combos présentes (Spellbook, MTGPics, synergies de Claude)
  combos-carte <deck> <carte> [--toutes-couleurs] [--n 20]   les cartes qui combotent avec une carte
  bracket <deck> [--gc]                   onglet Bracket : estimation, raisons, Game Changers, tuteurs, avis de Spellbook ;
                                          --gc : la liste officielle des Game Changers
  classeur [texte] [--tout]               les cartes du classeur (hors decks), filtrées par nom, type ou texte
  achats <deck>                           onglet Achats : cartes à acheter et cartes déjà là
  versions <deck>                         versions enregistrées et historique automatique
  comparer <deck> <fichier a> [<fichier b>]   différences entre deux versions (sans fichier b : la liste actuelle)
  version <deck> <nom> [note]             enregistre la liste actuelle comme version
  simulations <deck>                      rapports de simulation (fichiers JSON dans <deck>/simulations/)
  couverture <deck>                       les cartes que le simulateur lit mal, avec les lignes qu'il ne comprend pas ;
                                          à décrire dans <deck>/simulateur.json (voir connaissances/simulateur.md)
  simuler <deck> [--n 1000] [--tables Mixte,Contrôle] [--a <version>] [--b <version>]
                                          lance un test (réglages et cartes de simulateur.json) et attend son rapport
  rapport <deck> [fichier]                un rapport de test en texte (sans fichier : le dernier)
  synergies <deck>                        la dernière analyse des synergies faite par Claude
  carte <nom>                             fiche d'une carte (français ou anglais) : textes, prix, légalité, decks qui l'ont
  chercher <texte>                        noms de cartes qui contiennent ce texte
  recherche [--deck <deck>] clé=valeur …  la page Recherche de cartes (critères ci-dessous)
  fonctions [texte]                       les fonctions (fn= de la recherche) ; avec un texte, les étiquettes Scryfall Tagger
  api GET|POST api/<chemin> [json]        n'importe quelle route de l'Atelier (outils/atelier/app.py), réponse JSON brute

Recherche (mêmes critères que la page, tous facultatifs) :
  nom=, type=, texte=     mots à trouver (anglais ou français) ; "expression exacte", !mot exclu
  coul=WUBRG(C)           couleurs permises ; oblig=… couleurs obligatoires ; id=1 : identité de couleur au lieu de la couleur
  types=CR,AR,EN,IN,SO,PL,LA,BAT   tm=2 : tous ces types à la fois
  mv=, mvmin=, mvmax=     valeur de mana ; f=, fmin=, fmax= (force) ; e=, emin=, emax= (endurance)
  fn=ramp,pioche…         fonctions (voir « fonctions ») ; prixmin=, prixmax= ; gc=sans|seul ; cmd=peut|duo (commandants)
  format=commander (par défaut) ; rar=MRUC ; eds=code,code
  ordre=couleur|nom|nomfr|type|cout|prix|pop|date|pertinence (pertinence : avec --deck) ; sens=desc ; par=30|60|120|240 ; page=
  horsdeck=1 (avec --deck) : sans les cartes déjà dans le deck"""

ORDRE_TYPES = ["Créatures", "Planeswalkers", "Batailles", "Éphémères", "Rituels", "Artefacts", "Enchantements", "Terrains", "Autres"]
TYPES_EN = [("Land", "Terrains"), ("Creature", "Créatures"), ("Planeswalker", "Planeswalkers"), ("Battle", "Batailles"),
            ("Instant", "Éphémères"), ("Sorcery", "Rituels"), ("Artifact", "Artefacts"), ("Enchantment", "Enchantements")]
ORDRE_FONCTIONS = ["Ramp", "Pioche", "Tuteurs", "Removal", "Balayages", "Contresorts", "Recursion", "Protection", "Autres"]
REPERES = [(r"^(ramp|acc[eé]l[eé]ration)$", "≈ 10"), (r"^(draw|card draw|pioche)$", "≈ 10"),
           (r"^(removal|d[eé]gagement|anti-?cr[eé]atures?)$", "5 à 10"), (r"^(board ?wipes?|wipes?|rase-?boards?|balayages?)$", "≈ 5"),
           (r"^(lands?|terrains?)$", "37-38")]
COULEURS = [("W", "Blanc"), ("U", "Bleu"), ("B", "Noir"), ("R", "Rouge"), ("G", "Vert")]
BASIQUES = {"W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest"}
NIVEAUX_MANA = [(0.95, "très confortable"), (0.9, "confortable"), (0.8, "juste"), (0, "insuffisant")]
GROUPES = {"theme": "Thème", "combos": "Combos", "classeur": "Classeur", "tout": "Tout"}
SOURCES = {"mtgpics": "MTGPics", "spellbook": "Commander Spellbook", "claude": "synergie trouvée par Claude"}


# ---------------------------------------------------------------- accès à l'Atelier
def sortir(message):
    print(message)
    sys.exit(1)


def api(chemin, corps=None, methode=None):
    methode = methode or ("GET" if corps is None else "POST")
    if chemin.startswith(INTERDITS) or (methode == "POST" and "/partage" in chemin):
        sortir("Pas depuis l'assistant : la discussion, la mise à jour de l'Atelier et la publication des pages partagées "
               "se font dans l'interface, par l'utilisateur.")
    donnees = None if corps is None and methode == "GET" else json.dumps(corps or {}).encode("utf-8")
    req = urllib.request.Request(URL + chemin, data=donnees, method=methode,
                                 headers={"Content-Type": "application/json"} if donnees is not None else {})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        texte = e.read().decode("utf-8", "replace")
        try:
            texte = json.loads(texte).get("erreur") or texte
        except (ValueError, AttributeError):
            pass
        sortir(f"Erreur de l'Atelier ({e.code}) : {str(texte)[:600]}")
    except OSError:
        sortir(f"L'Atelier ne répond pas sur {URL} : il faut le lancer (raccourci « Atelier MTG »), puis recommencer.")


def q(x):
    return urllib.parse.quote(str(x), safe="")


def norm(t):
    t = unicodedata.normalize("NFD", str(t or "").lower())
    return re.sub(r"\s+", " ", "".join(c for c in t if unicodedata.category(c) != "Mn")).strip()


def trouver_deck(nom):
    ds = api("/api/decks")
    n = re.sub(r"^deck ", "", norm(nom))
    for d in ds:
        if n in (re.sub(r"^deck ", "", norm(d["id"])), norm(d["titre"])):
            return d["id"]
    cands = [d for d in ds if n and (n in norm(d["id"]) or n in norm(d["titre"])
                                     or any(n in norm(c) for c in d.get("commandants") or []))]
    if len(cands) == 1:
        return cands[0]["id"]
    sortir(f"Deck « {nom} » {'ambigu' if cands else 'introuvable'}. Decks : " + " ; ".join(d["id"] for d in (cands or ds)))


def trouver_carte(nom):
    """Le nom anglais exact d'une carte écrite en anglais ou en français."""
    res = api("/api/recherche/noms?q=" + q(nom)) or []
    n = norm(nom)
    for x in res:
        if n in (norm(x["nom"]), norm(x.get("fr"))):
            return x["nom"]
    if res:
        return res[0]["nom"]
    sortir(f"Carte « {nom} » introuvable.")


def budget():
    o = api("/api/options")
    b = o.get("budget") if o.get("budget") is not None else o.get("budget_defaut")
    return b or None


# ---------------------------------------------------------------- mise en forme
def euros(x):
    return "prix ?" if x is None else f"{x:.2f} €".replace(".", ",")


def pct(p):
    return f"{math.floor(p * 100)} %"


def nom2(vo, fr):
    return f"{vo} ({fr})" if fr and norm(fr) != norm(vo) else vo


def une_ligne(t):
    return re.sub(r"\s*\n\s*", " / ", (t or "").strip())


def prix_txt(p, b):
    return euros(p) + (" (au-dessus du budget)" if b and p is not None and p > b else "")


def type_carte(t):
    return next((fr for en, fr in TYPES_EN if re.search(rf"\b{en}\b", t or "")), "Autres")


def repere(t):
    return next((r for motif, r in REPERES if re.match(motif, t.strip(), re.I)), "")


def options(args, drapeaux=(), valeurs=()):
    """Sépare les --drapeaux, les --clé valeur et le reste."""
    res, reste, i = {}, [], 0
    while i < len(args):
        a = args[i]
        if a.startswith("--") and a[2:] in drapeaux:
            res[a[2:]] = True
        elif a.startswith("--") and a[2:] in valeurs and i + 1 < len(args):
            res[a[2:]] = args[i + 1]
            i += 1
        else:
            reste.append(a)
        i += 1
    return res, reste


def il_faut(args, n, usage):
    if len(args) < n:
        sortir("Usage : python outils/atelier/demander.py " + usage)


# ---------------------------------------------------------------- commandes
def c_decks(args):
    for d in api("/api/decks"):
        gc = f" · Game Changers : {', '.join(d['gc'])}" if d.get("gc") else ""
        maybe = f" · Maybeboard {d['maybe']}" if d.get("maybe") else ""
        print(f"- {d['id']} : {' + '.join(d.get('commandants') or []) or 'sans commandant'} · {d['total']}/100 cartes"
              f" · {euros(d.get('prix_total'))} · bracket {d.get('bracket') or '?'}{gc}{maybe}")


def c_deck(args):
    o, args = options(args, drapeaux=("texte",))
    il_faut(args, 1, "deck <deck> [--texte]")
    d = api("/api/decks/" + q(trouver_deck(args[0])))
    b = budget()
    print(f"{d['id']} · {' + '.join(d.get('commandants') or [])} · identité {''.join(d.get('identite') or []) or 'incolore'}"
          f" · {d['total']}/100 cartes · {euros(d.get('prix_total'))} · bracket {d.get('bracket')}")
    for r in d.get("bracket_raisons") or []:
        print(f"  bracket : {r}")
    if d.get("trop_cher"):
        print(f"  au-dessus du budget ({euros(b)}) : {', '.join(d['trop_cher'])}")
    if d.get("alertes"):
        print("  alertes : " + json.dumps(d["alertes"], ensure_ascii=False))
    par = {}
    for c in d["cartes"]:
        par.setdefault(c["cat"], []).append(c)
    ordre = sorted(par, key=lambda k: (k != "Commander", k == "Maybeboard", -sum(c["n"] for c in par[k]), k))
    for cat in ordre:
        print(f"\n{cat} ({sum(c['n'] for c in par[cat])})")
        for c in par[cat]:
            i = c.get("info") or {}
            autres_tags = [t for t in c.get("tags") or [] if t != cat]
            bits = [i.get("cout") or "", i.get("fr_type") or i.get("type") or "", prix_txt(i.get("prix"), b)]
            if i.get("gc"):
                bits.append("Game Changer")
            if c.get("fonctions"):
                bits.append("fonctions : " + ", ".join(c["fonctions"]))
            if autres_tags:
                bits.append("tags : " + ", ".join(autres_tags))
            print(f"  {c['n']}x {nom2(c['nom'], i.get('fr'))} — " + " — ".join(x for x in bits if x))
            if o.get("texte") and i.get("texte"):
                print(f"     {une_ligne(i['texte'])}")


def _pips(c, x):
    return sum(1 for s in re.findall(r"\{[^}]+\}", (c.get("info") or {}).get("cout") or "") if x in s)


def _hyper(N, K, n, k):
    if k < 0 or k > n or k > K or n - k > N - K:
        return 0.0
    return math.comb(K, k) * math.comb(N - K, n - k) / math.comb(N, n)


def _au_moins(N, K, n, k):
    n = min(n, N)
    return max(0.0, 1 - sum(_hyper(N, K, n, i) for i in range(k)))


def _confort(lanceurs, N, x, sources):
    """Comme confortCouleur (app.js) : pour chaque sort de cette couleur, la chance d'avoir assez de sources au tour où on
    le lance (on a vu 7 + N cartes au tour N, en multijoueur) ; moyenne sur les sorts, le plus dur à part."""
    tot = poids = 0
    pire = None
    for c in lanceurs:
        k = _pips(c, x)
        if not k:
            continue
        p = _au_moins(N, sources, 7 + max(1, math.ceil((c["info"].get("mv") or 0))), k)
        tot += p * c["n"]
        poids += c["n"]
        if pire is None or p < pire[1]:
            pire = (c, p)
    return (tot / poids, pire) if poids else None


def c_stats(args):
    il_faut(args, 1, "stats <deck>")
    d = api("/api/decks/" + q(trouver_deck(args[0])))
    nb = lambda l: sum(c["n"] for c in l)                       # noqa: E731
    noms = lambda l: ", ".join((f"{c['n']}× " if c["n"] > 1 else "") + c["nom"] for c in l)      # noqa: E731
    terrain = lambda c: type_carte(c["info"].get("type")) == "Terrains"                            # noqa: E731
    jeu = [c for c in d["cartes"] if c["cat"] != "Maybeboard"]
    bib = [c for c in jeu if c["cat"] != "Commander"]
    sorts = [c for c in bib if not terrain(c)]
    terrains = [c for c in bib if terrain(c)]
    cmds = [c for c in jeu if c["cat"] == "Commander"]
    mdfc = [c for c in sorts if (c["info"].get("dos") or {}).get("type") and re.search(r"\bLand\b", c["info"]["dos"]["type"])]
    N, K = nb(bib), nb(terrains)
    if not N:
        sortir("Aucune carte.")
    mv_moy = sum((c["info"].get("mv") or 0) * c["n"] for c in sorts) / (nb(sorts) or 1)
    p24 = sum(_hyper(N, K, 7, k) for k in (2, 3, 4)) if N >= 7 else None
    print(f"{d['id']} : {d['total']}/100 cartes · {N - K} sorts · {K} terrains (repère 37-38)"
          + (f" + {', '.join(c['nom'] for c in mdfc)} (verso terrain)" if mdfc else "")
          + f" · coût moyen {mv_moy:.2f}".replace(".", ",")
          + (f" · main de départ avec 2 à 4 terrains : {round(p24 * 100)} %" if p24 is not None else "")
          + f" · prix {euros(d.get('prix_total'))} · Game Changers : {', '.join(d.get('gc') or []) or 'aucun'}")
    courbe = [[c for c in sorts if min(7, math.floor(c["info"].get("mv") or 0)) == k] for k in range(8)]
    print("\nCourbe de mana (sorts des 99) : " + " · ".join(f"{'7+' if k == 7 else k} : {nb(l)}" for k, l in enumerate(courbe)))
    print("Types : " + " · ".join(f"{t} {nb(l)}" for t in ORDRE_TYPES
                                   for l in [[c for c in bib if type_carte(c["info"].get("type")) == t]] if l))
    print("\nFonctions des sorts des 99 (une carte compte dans chacune des siennes) :")
    for f in ORDRE_FONCTIONS:
        l = [c for c in sorts if (not c.get("fonctions") if f == "Autres" else f in (c.get("fonctions") or []))]
        if l:
            r = repere(f)
            print(f"  {f} : {nb(l)}{f' (repère {r})' if r else ''} — {noms(l)}")
    tags = {}
    for c in jeu:
        for t in c.get("tags") or []:
            if t not in ("Commander", "Maybeboard"):
                tags.setdefault(t, []).append(c)
    if tags:
        print("\nTags de l'utilisateur :")
        for t, l in sorted(tags.items(), key=lambda x: -nb(x[1])):
            r = repere(t)
            print(f"  {t} : {nb(l)}{f' (repère {r})' if r else ''}")
    # base de mana : comme tableauBaseMana (app.js) ; seul le manque est un défaut
    basiques = [x for x in BASIQUES if any(re.search(r"\bBasic\b", t["info"].get("type") or "")
                                             and re.search(rf"\b{BASIQUES[x]}\b", t["info"].get("type") or "") for t in terrains)]

    def trouve(t):
        s = t["info"].get("texte") or ""
        if not re.search("search your library for", s, re.I):
            return []
        nommes = [x for x in BASIQUES if re.search(rf"\b{BASIQUES[x]}\b", s)]
        return nommes or (basiques if re.search("basic land", s, re.I) else [])
    ident = d.get("identite") or []
    coul = []
    for x, nom in COULEURS:
        cartes = [c for c in sorts if _pips(c, x)]
        if not (x in ident if ident else cartes):
            continue
        coul.append(dict(x=x, nom=nom, cartes=cartes, symboles=sum(_pips(c, x) * c["n"] for c in sorts),
                         cmd=sum(_pips(c, x) for c in cmds),
                         sources=[t for t in terrains if x in (t["info"].get("produit") or []) or x in trouve(t)],
                         autres=[c for c in sorts if x in (c["info"].get("produit") or [])]))
    if not coul:
        return
    ids = [k["x"] for k in coul]
    tot_d = sum(k["symboles"] + k["cmd"] for k in coul) or 1

    def mono(x):
        return [t for t in terrains if [y for y in (t["info"].get("produit") or []) if y in ids] == [x]]
    tot_mono = sum(nb(mono(k["x"])) for k in coul)
    lanceurs = sorts + cmds
    base = []
    for k in coul:
        pd, src = (k["symboles"] + k["cmd"]) / tot_d, nb(k["sources"]) + nb(k["autres"])
        conf = _confort(lanceurs, N, k["x"], src)
        cede = math.floor(nb(mono(k["x"])) - tot_mono * pd + 1e-9)
        while cede > 0 and conf and _confort(lanceurs, N, k["x"], src - cede)[0] < 0.9:
            cede -= 1
        base.append((k, pd, src, conf, cede))
    print("\nBase de mana (confort : chance moyenne d'avoir assez de sources au tour où on lance chaque sort ; objectif 90 %) :")
    for k, pd, src, conf, _ in base:
        if not conf:
            print(f"  {k['nom']} : aucun sort ne demande cette couleur · {nb(k['sources'])} terrains, {nb(k['autres'])} autres sources")
            continue
        niv = next(lib for s, lib in NIVEAUX_MANA if conf[0] >= s)
        print(f"  {k['nom']} : {nb(k['cartes'])} cartes, {k['symboles'] + k['cmd']} symboles ({round(pd * 100)} % de la demande)"
              f" · {nb(k['sources'])} terrains + {nb(k['autres'])} autres sources · confort {pct(conf[0])} ({niv})"
              f" · le plus dur : {conf[1][0]['nom']} {conf[1][0]['info'].get('cout') or ''} ({pct(conf[1][1])})")
        if conf[0] < 0.9:
            pistes = [f"{m[4]} terrain(s) {m[0]['nom'].lower()} ({', '.join(sorted({t['nom'] for t in mono(m[0]['x'])}))})"
                      for m in base if m[3] and m[3][0] >= 0.9 and m[4] >= 1]
            if pistes:
                print(f"    piste : remplacer {' ou '.join(pistes)} par des terrains {k['nom'].lower()}s")
    chers = sorted([c for c in jeu if c["info"].get("prix")], key=lambda c: -c["info"]["prix"])[:10]
    print("\nLes plus chères : " + " · ".join(f"{c['nom']} {euros(c['info']['prix'])}" for c in chers))


def _ligne_sugg(x, b, texte):
    bits = [x.get("cout") or "", x.get("type_fr") or x.get("type") or "", prix_txt(x.get("prix"), b),
            f"intérêt {max(1, round(x['note'] * 5))}/5"]
    if x.get("classeur"):
        bits.append(f"déjà dans le classeur (×{x['classeur']})")
    if x.get("gc"):
        bits.append("Game Changer")
    if x.get("ub"):
        bits.append("Universes Beyond")
    if x.get("fonctions"):
        bits.append("fonctions : " + ", ".join(x["fonctions"]))
    print(f"- {nom2(x['nom'], x.get('fr'))} — " + " — ".join(y for y in bits if y))
    for c in (x.get("combos") or [])[:3]:
        avec = [n for n in c["cartes"] if n not in (c.get("manque") or [])]
        print(f"    combo avec {' + '.join(avec)} → {', '.join(c.get('produit') or [])} (bracket {c.get('bracket', '?')}, "
              f"{c.get('popularite', 0)} decks sur Spellbook){' : ' + une_ligne(c['description']) if texte and c.get('description') else ''}")
    if texte and x.get("texte"):
        print(f"    {une_ligne(x['texte'])}")


def c_suggestions(args):
    o, args = options(args, drapeaux=("texte",), valeurs=("n", "type", "fonction", "prixmax"))
    il_faut(args, 1, "suggestions <deck> [theme|combos|classeur|tout] [--n 20] [--type …] [--fonction …] [--prixmax …] [--texte]")
    deck = trouver_deck(args[0])
    groupe = norm(args[1]).replace("è", "e") if len(args) > 1 else ""
    if groupe and groupe not in GROUPES:
        sortir("Groupes : theme, combos, classeur, tout.")
    r = api(f"/api/decks/{q(deck)}/suggestions")
    b = budget()
    cartes = r["cartes"]
    if o.get("type"):
        t = norm(o["type"])
        cartes = [x for x in cartes if t in norm(type_carte(x.get("type"))) or t in norm(x.get("type")) or t in norm(x.get("type_fr"))]
    if o.get("fonction"):
        f = norm(o["fonction"])
        cartes = [x for x in cartes if any(f in norm(y) for y in x.get("fonctions") or [])]
    if o.get("prixmax"):
        pm = float(o["prixmax"].replace(",", "."))
        cartes = [x for x in cartes if x.get("prix") is not None and x["prix"] <= pm]
    cartes.sort(key=lambda x: -x["note"])
    n = int(o.get("n") or (30 if groupe else 15))
    print(f"Suggestions pour {deck} (dans ses couleurs, légales, budget {euros(b) if b else 'libre'}, hors deck et Maybeboard),"
          " triées par intérêt (thème du deck, popularité en Commander, combo). Le calcul ne passe pas par l'IA.")
    for g in ([groupe] if groupe else ["theme", "combos", "classeur"]):
        l = cartes if g == "tout" else [x for x in cartes if g in x["groupes"]]
        print(f"\n{GROUPES[g]} : {len(l)} cartes{f', les {n} premières' if len(l) > n else ''}")
        for x in l[:n]:
            _ligne_sugg(x, b, o.get("texte"))
    if r.get("ecartees"):
        print(f"\nÉcartées par l'utilisateur (ne pas les reproposer) : {', '.join(r['ecartees'])}")


def c_ecarter(args, ecarter=True):
    il_faut(args, 2, f"{'ecarter' if ecarter else 'reproposer'} <deck> <carte>")
    deck, nom = trouver_deck(args[0]), trouver_carte(" ".join(args[1:]))
    api(f"/api/decks/{q(deck)}/suggestions/ecarter", dict(nom=nom, ecarter=ecarter))
    print(f"{nom} : {'ne sera plus proposée' if ecarter else 'de nouveau proposée'} pour {deck}.")


def _ligne_combo(c, texte):
    res = c.get("produit") or c.get("resultats") or []
    pop = c.get("popularite")
    pop = "" if not pop else f"Top 8 : {pop}" if c.get("source") == "mtgpics" else f"{pop} decks"
    bits = [c.get("classe_lib") or c.get("tag") or "", SOURCES.get(c.get("source"), c.get("source") or ""), pop]
    print(f"- {' + '.join(c['cartes'])}{' → ' + ', '.join(res) if res else ''} ({', '.join(x for x in bits if x)})")
    if c.get("prerequis"):
        print(f"    prérequis : {une_ligne(c['prerequis'])}")
    if texte and c.get("description"):
        print(f"    {une_ligne(c['description'])}")


def c_combos(args):
    o, args = options(args, drapeaux=("texte",))
    il_faut(args, 1, "combos <deck> [--texte]")
    deck = trouver_deck(args[0])
    r = api(f"/api/decks/{q(deck)}/combos")
    print(f"Combos présentes dans {deck} : {len(r['combos'])}")
    for c in r["combos"]:
        _ligne_combo(c, o.get("texte"))
    if r.get("erreur"):
        print(f"(erreur : {r['erreur']})")
    print(f"\nCombos à une carte près : python outils/atelier/demander.py suggestions \"{deck}\" combos")


def c_combos_carte(args):
    o, args = options(args, drapeaux=("toutes-couleurs", "texte"), valeurs=("n",))
    il_faut(args, 2, "combos-carte <deck> <carte> [--toutes-couleurs] [--n 20]")
    deck, nom = trouver_deck(args[0]), trouver_carte(" ".join(args[1:]))
    r = api(f"/api/decks/{q(deck)}/combos/carte?nom={q(nom)}&couleurs={'0' if o.get('toutes-couleurs') else '1'}")
    cs, n = r.get("combos") or [], int(o.get("n") or 20)
    print(f"Combos avec {nom}{'' if o.get('toutes-couleurs') else ' dans les couleurs du deck'} : {len(cs)}"
          f"{f', les {n} premières (--n pour en voir plus)' if len(cs) > n else ''}")
    for c in cs[:n]:
        fiches = {f["nom"]: f for f in c.get("fiches") or []}
        hors = [n for n in c["cartes"] if n in fiches and not fiches[n].get("dans")]
        _ligne_combo(c, o.get("texte"))
        if hors:
            print("    pas dans le deck : " + ", ".join(f"{nom2(n, fiches[n].get('fr'))} {euros(fiches[n].get('prix'))}" for n in hors))


def c_bracket(args):
    o, args = options(args, drapeaux=("gc",))
    il_faut(args, 1, "bracket <deck> [--gc]")
    deck = trouver_deck(args[0])
    r = api(f"/api/decks/{q(deck)}/bracket")
    print(f"{deck} : bracket estimé {r.get('estime')} (règles officielles appliquées par l'Atelier)")
    for x in r.get("raisons") or []:
        print(f"  - {x}")
    for cle, lib in (("gc", "Game Changers"), ("tuteurs", "Tuteurs"), ("tours", "Tours supplémentaires"),
                     ("mld", "Destruction massive de terrains")):
        print(f"  {lib} : {', '.join(r.get(cle) or []) or 'aucun'}")
    sb = r.get("spellbook") or {}
    if sb:
        print(f"Commander Spellbook : bracket {sb.get('bracket')} ({sb.get('libelle', '')})"
              f"{'' if r.get('spellbook_a_jour') else ' (pas à jour)'} · {len(sb.get('combos') or [])} combo(s) dans le deck"
              f" · {len(sb.get('presque') or [])} à une carte près")
        for c in sb.get("combos") or []:
            print(f"  - {' + '.join(c['cartes'])} → {', '.join(c.get('produit') or [])} (bracket {c.get('bracket')})")
    if o.get("gc"):
        print("\nListe officielle des Game Changers : " + ", ".join(r.get("gc_liste") or []))


def c_classeur(args):
    o, args = options(args, drapeaux=("tout",))
    cartes = api("/api/classeur")["cartes"]
    t = norm(" ".join(args))
    if t:
        cartes = [c for c in cartes if any(t in norm(v) for v in (c["nom"], (c["info"] or {}).get("fr"),
                                                                  (c["info"] or {}).get("type"), (c["info"] or {}).get("texte")))]
    total = sum(c["n"] for c in cartes)
    print(f"Classeur (cartes hors des decks, Classeur/classeur.txt){f' contenant « {t} »' if t else ''} : {len(cartes)} cartes différentes, {total} exemplaires")
    lim = len(cartes) if o.get("tout") else 150
    for c in cartes[:lim]:
        i = c["info"] or {}
        print(f"  {c['n']}x {nom2(c['nom'], i.get('fr'))} — {i.get('cout') or ''} — {i.get('type') or ''} — {euros(i.get('prix'))}"
              f" — couleurs {''.join(i.get('couleurs') or []) or 'incolore'}")
    if len(cartes) > lim:
        print(f"  … et {len(cartes) - lim} autres (filtre par un mot, ou --tout)")


def c_achats(args):
    il_faut(args, 1, "achats <deck>")
    deck = trouver_deck(args[0])
    d = api("/api/decks/" + q(deck))
    poss = api(f"/api/decks/{q(deck)}/achats")["possedees"]
    vus, acheter, ai = set(), [], []
    for c in d["cartes"]:
        if c["cat"] == "Maybeboard" or c["nom"] in vus:
            continue
        vus.add(c["nom"])
        total = sum(x["n"] for x in d["cartes"] if x["nom"] == c["nom"] and x["cat"] != "Maybeboard")
        base = re.search(r"\bBasic\b", (c.get("info") or {}).get("type") or "")
        j = min(total, poss.get(c["nom"], total if base else 0))
        if j:
            ai.append((c, j))
        if total > j:
            acheter.append((c, total - j))
    tri = lambda x: (-((x[0].get("info") or {}).get("prix") or 0), x[0]["nom"])      # noqa: E731
    cout = sum(((c.get("info") or {}).get("prix") or 0) * n for c, n in acheter)
    print(f"{deck} — à acheter : {sum(n for _, n in acheter)} cartes, {euros(cout)}")
    for c, n in sorted(acheter, key=tri):
        print(f"  {n}x {nom2(c['nom'], (c.get('info') or {}).get('fr'))} — {euros((c.get('info') or {}).get('prix'))}")
    print(f"Déjà là : {sum(n for _, n in ai)} cartes")


def c_versions(args):
    il_faut(args, 1, "versions <deck>")
    deck = trouver_deck(args[0])
    for v in api(f"/api/decks/{q(deck)}/versions"):
        diff = (f" · +{len(v.get('plus') or [])} −{len(v.get('moins') or [])} par rapport à la liste actuelle"
                if v.get("plus") is not None else "")
        print(f"- {v['nom']} [{v.get('type', '')}] fichier « {v['fichier']} »{' · ' + v['note'] if v.get('note') else ''}{diff}")


def c_comparer(args):
    il_faut(args, 2, "comparer <deck> <fichier a> [<fichier b>]")
    deck = trouver_deck(args[0])
    r = api(f"/api/decks/{q(deck)}/comparer?a={q(args[1])}&b={q(args[2] if len(args) > 2 else '')}")
    I = r.get("infos") or {}
    for cle, lib in (("a", args[1]), ("b", args[2] if len(args) > 2 else "liste actuelle")):
        x = r.get(cle) or {}
        print(f"{lib} : {euros(x.get('prix'))} · Game Changers : {', '.join(x.get('gc') or []) or 'aucun'}")
    for cle, lib in (("seulement_a", "Seulement dans a"), ("seulement_b", "Seulement dans b")):
        print(f"\n{lib} :")
        for n in r.get(cle) or []:
            print(f"  {nom2(n, (I.get(n) or {}).get('fr'))} — {euros((I.get(n) or {}).get('prix'))}")


def c_version(args):
    il_faut(args, 2, "version <deck> <nom> [note]")
    deck = trouver_deck(args[0])
    r = api(f"/api/decks/{q(deck)}/versions", dict(nom=args[1], note=" ".join(args[2:])))
    print(f"Version enregistrée : {r.get('fichier')}")


def c_simulations(args):
    il_faut(args, 1, "simulations <deck>")
    deck = trouver_deck(args[0])
    rs = api(f"/api/decks/{q(deck)}/simulations")
    if not rs:
        print("Aucun rapport. Lancer un test : python outils/atelier/demander.py simuler <deck>.")
    for r in rs:
        v = f"victoires A {pct(r['victoire_a'])}" if r.get("victoire_a") is not None else ""
        if r.get("victoire_b") is not None:
            v += f", B {pct(r['victoire_b'])}"
        print(f"- {r['date']} · {r.get('n')} parties · table {r.get('table_resume')} · pilote {r.get('pilote')} · {v}"
              f" · versions {json.dumps(r.get('versions'), ensure_ascii=False)} · {deck}/simulations/{r['fichier']}")


NIVEAU_MOT = {"bon": "solide", "juste": "juste", "alerte": "faible"}
VERDICT_MOT = {"regulier": "Deck régulier", "a_peaufiner": "Deck à peaufiner", "irregulier": "Deck irrégulier"}
MESURES = [("terrains4", "4 terrains au tour 4", "%"), ("couleur", "tours où une couleur manque (2 à 6)", "%"),
           ("mulligans", "deux mulligans ou plus", "%"), ("vides", "tours sans rien jouer (2 à 7)", ""),
           ("usage", "mana utilisé (tours 1 à 6)", "%"), ("defausse", "parties avec défausse en fin de tour", "%"),
           ("permanents8", "permanents au tour 8", ""), ("creatures8", "créatures au tour 8", ""),
           ("morts_moi", "tes créatures mortes par partie", ""), ("tues", "créatures adverses détruites pendant tes tours", ""),
           ("crea_adv8", "créatures par adversaire au tour 8", ""), ("commandant", "commandant à l'heure", "%"),
           ("cmd_tour", "tour moyen du commandant", ""), ("cmd_mort", "commandant tué par partie", "")]


def _mesure(v, unite):
    if v is None:
        return "?"
    return pct(v) if unite == "%" else f"{v:.1f}".replace(".", ",")


def _rapport_texte(deck, r, fichier):
    t0 = "Mixte" if "Mixte" in r["tables"] else r["tables"][0]
    V, R = r["versions"], r["resultats"]
    out = [f"Test du {r['date'][:16].replace('T', ' ')} · {r['n']} parties par table · tables : {', '.join(r['tables'])} · "
           + ("affiné (simulateur.json)" if r.get("affine") else "sans simulateur.json : les cartes mal lues jouent sans effet")]
    for cle, v in V.items():
        cov = v.get("couverture") or {}
        out.append(f"\n{cle} = {v['nom']} · cartes comprises par le simulateur : {cov.get('comprises', '?')} sur {cov.get('total', '?')}")
        reg = R[t0][cle].get("regularite")
        if not reg:
            continue
        out.append(f"  {VERDICT_MOT.get(reg['verdict'], reg['verdict'])} (table {t0})")
        out += [f"  - {i['titre']} : {NIVEAU_MOT.get(i['niveau'], '?')} ({i['valeur']})" for i in reg["indicateurs"]]
        out += [f"  ! {c}" for c in reg["constats"]]
        m = reg.get("mesures") or {}
        out.append("  mesures : " + " · ".join(f"{lib} {_mesure(m.get(k), u)}" for k, lib, u in MESURES))
    b = "B" in V
    out.append("\nVictoires par table" + (" (A / B / écart A − B, ± marge à 95 %)" if b else "") + " :")
    for t in r["tables"]:
        x = R[t]
        s = f"  {t} : {pct(x['A']['victoire'])}"
        if b:
            e = x.get("ecart") or {}
            s += f" / {pct(x['B']['victoire'])} / {e.get('m', 0) * 100:+.1f} ± {e.get('ic', 0) * 100:.1f} pt"
        causes = sorted((x["A"].get("causes") or {}).items(), key=lambda kv: -kv[1])[:4]
        s += f" · fin moyenne T{(x['A'].get('tour_fin') or 0):.1f}".replace(".", ",") + " · défaites : " + (", ".join(f"{k} {pct(v)}" for k, v in causes) or "aucune")
        out.append(s)
    if not r.get("affine"):
        out.append("  (ces victoires ne valent que si le simulateur comprend le deck : voir couverture)")
    out.append(f"\nFichier : {deck}/simulations/{fichier}")
    return "\n".join(out)


def c_couverture(args):
    il_faut(args, 1, "couverture <deck>")
    deck = trouver_deck(args[0])
    d = api(f"/api/decks/{q(deck)}/simulation/cartes")
    print(f"Cartes comprises par le simulateur : {d['comprises']} sur {d['total']} (hors terrains et commandants)"
          + (f" ; décrites dans {deck}/simulateur.json : {len(d['textes'])}" if d.get("textes") else ""))
    for cle, titre in (("partiel", "Lues en partie (le reste de la carte est ignoré)"), ("corps", "Créatures jouées comme simples corps"),
                       ("sans_effet", "Sorts joués sans effet")):
        if d[cle]:
            print(f"\n{titre} :")
            for n in d[cle]:
                print(f"  - {n} : non compris « " + " » « ".join(d["non_lu"].get(n) or []) + " »")
    if d.get("perso_non_lu"):
        print("\nTextes de simulateur.json pas encore compris :")
        for n, l in d["perso_non_lu"].items():
            print(f"  - {n} : « " + " » « ".join(l) + " »")
    if d.get("inconnues"):
        print("\nCartes de simulateur.json absentes du deck : " + ", ".join(d["inconnues"]))
    print("\nFormat de simulateur.json et tournures comprises : connaissances/simulateur.md")


def c_simuler(args):
    o, reste = options(args, valeurs=("n", "tables", "a", "b"))
    il_faut(reste, 1, "simuler <deck> [--n 1000] [--tables Mixte,Contrôle] [--a <version>] [--b <version>]")
    deck = trouver_deck(reste[0])
    tables = [t.strip() for t in re.split(r"[,;]", o.get("tables", "Mixte")) if t.strip()]
    job = api(f"/api/decks/{q(deck)}/simulations", dict(a=o.get("a", ""), b=o.get("b"), tables=tables, n=int(o.get("n", 1000))))
    while True:
        time.sleep(1)
        j = api(f"/api/jobs/{job['id']}")
        if j["statut"] != "en_cours":
            break
    if j["statut"] != "fini":
        sortir(f"Test {j['statut']} : {j.get('erreur') or ''}")
    print(_rapport_texte(deck, api(f"/api/decks/{q(deck)}/simulations/{q(j['rapport'])}"), j["rapport"]))


def c_rapport(args):
    il_faut(args, 1, "rapport <deck> [fichier]")
    deck = trouver_deck(args[0])
    f = args[1] if len(args) > 1 else None
    if not f:
        rs = api(f"/api/decks/{q(deck)}/simulations")
        if not rs:
            sortir("Aucun rapport. Lancer un test : python outils/atelier/demander.py simuler <deck>.")
        f = rs[0]["fichier"]
    f = os.path.basename(f)
    print(_rapport_texte(deck, api(f"/api/decks/{q(deck)}/simulations/{q(f)}"), f))


def c_synergies(args):
    il_faut(args, 1, "synergies <deck>")
    deck = trouver_deck(args[0])
    r = api(f"/api/decks/{q(deck)}/synergies").get("resultat")
    if not r:
        print("Pas d'analyse des synergies pour ce deck (bouton « Chercher les synergies avec Claude », onglet Combos).")
        return
    print(r.get("resume") or "")
    for s in r.get("synergies") or []:
        print(f"- [{s.get('classe')}, force {s.get('force')}] {s.get('titre')} : {' + '.join(s.get('cartes') or [])}. {une_ligne(s.get('explication'))}")


def c_carte(args):
    il_faut(args, 1, "carte <nom>")
    nom = trouver_carte(" ".join(args))
    f = api("/api/carte?nom=" + q(nom))
    b = budget()
    print(f"{nom2(nom, f.get('fr'))} {f.get('cout') or ''}")
    print(f"  {f.get('type') or ''}{' / ' + f['fr_type'] if f.get('fr_type') else ''}{' · ' + f['pt'] if f.get('pt') else ''}")
    if f.get("texte"):
        print(f"  {une_ligne(f['texte'])}")
    if f.get("fr_texte"):
        print(f"  (VF) {une_ligne(f['fr_texte'])}")
    if (f.get("dos") or {}).get("nom"):
        print(f"  Verso : {f['dos'].get('nom')} — {f['dos'].get('type') or ''} — {une_ligne(f['dos'].get('texte'))}")
    print(f"  Prix : {prix_txt(f.get('prix'), b)}{' (' + f['prix_edition'] + ')' if f.get('prix_edition') else ''}"
          f"{' · ' + f['prix_lien'] if f.get('prix_lien') else ''}")
    print(f"  Commander : {'légale' if f.get('legal') == 'legal' else f.get('legal') or '?'}"
          f"{' · Game Changer' if f.get('gc') else ''}{' · peut être commandant' if f.get('peut_commander') else ''}"
          f"{' · partenaire' if f.get('partenaire') else ''}")
    dans = api("/api/recherche-cartes?q=" + q(nom)) or {}
    dans = [dk for dk, ns in dans.items() if nom in ns]
    print(f"  Dans les decks : {', '.join(dans) or 'aucun'}")


def c_chercher(args):
    il_faut(args, 1, "chercher <texte>")
    for x in (api("/api/recherche/noms?q=" + q(" ".join(args))) or [])[:30]:
        print(f"- {nom2(x['nom'], x.get('fr'))} — {x.get('cout') or ''} — {x.get('type_fr') or x.get('type') or ''} — {euros(x.get('prix'))}")


def c_recherche(args):
    o, args = options(args, valeurs=("deck",))
    p = dict(format="commander", par="60")
    for a in args:
        if "=" not in a:
            sortir(f"Critère « {a} » : écrire clé=valeur (python outils/atelier/demander.py aide).")
        k, v = a.split("=", 1)
        p[k.strip()] = v
    if o.get("deck"):
        p["deck"] = trouver_deck(o["deck"])
    r = api("/api/recherche?" + urllib.parse.urlencode(p))
    b = budget()
    print(f"{r['total']} cartes · page {r['page']}/{r['pages']} ({r['par_page']} par page)")
    for x in r["cartes"]:
        bits = [x.get("cout") or "", x.get("type_fr") or x.get("type") or "", prix_txt(x.get("prix"), b)]
        if x.get("rang"):
            bits.append(f"popularité #{x['rang']}")
        if x.get("gc"):
            bits.append("Game Changer")
        if x.get("dans"):
            bits.append(f"déjà : {x['dans']}")
        print(f"- {nom2(x['nom'], x.get('fr'))} — " + " — ".join(y for y in bits if y))


def c_fonctions(args):
    if args:
        for x in api("/api/recherche/tags?q=" + q(" ".join(args))) or []:
            print(f"- fn={x['cle']} : {x['nom']} ({x.get('nb', '?')} cartes){' — ' + x['desc'] if x.get('desc') else ''}")
    else:
        for x in api("/api/recherche/fonctions") or []:
            print(f"- fn={x['cle']} : {x['nom']}")


def c_api(args):
    il_faut(args, 2, "api GET|POST <chemin> [json]")
    # « api/decks » ou « /api/decks » ; Git Bash (Windows) change « /api/… » en « C:/Program Files/Git/api/… »
    i = args[1].find("api/")
    if i < 0:
        sortir("Le chemin commence par api/ : par exemple api/decks")
    chemin = "/" + re.sub(r"/{2,}", "/", args[1][i:])
    corps = json.loads(" ".join(args[2:])) if len(args) > 2 else None
    print(json.dumps(api(chemin, corps, args[0].upper()), ensure_ascii=False, indent=1))


COMMANDES = dict(decks=c_decks, deck=c_deck, stats=c_stats, suggestions=c_suggestions, ecarter=c_ecarter,
                 reproposer=lambda a: c_ecarter(a, False), combos=c_combos, bracket=c_bracket, classeur=c_classeur,
                 achats=c_achats, versions=c_versions, comparer=c_comparer, version=c_version, simulations=c_simulations,
                 couverture=c_couverture, simuler=c_simuler, rapport=c_rapport,
                 synergies=c_synergies, carte=c_carte, chercher=c_chercher, recherche=c_recherche, fonctions=c_fonctions,
                 api=c_api, **{"combos-carte": c_combos_carte})

if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")         # accents et symboles, même dans une console Windows
    except AttributeError:
        pass
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDES:
        print(AIDE)
        sys.exit(0 if len(sys.argv) < 2 or sys.argv[1] in ("aide", "help", "-h", "--help") else 1)
    COMMANDES[sys.argv[1]](sys.argv[2:])
