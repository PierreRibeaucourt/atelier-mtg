"""Fabrique l'appli du téléphone : un site statique, installable sur l'écran d'accueil (appli web), sans serveur.

    python outils/atelier/telephone_site.py [dossier] [--base URL]      (site-telephone/ à la racine par défaut)
    python outils/atelier/telephone_site.py dossier --passerelle       (une ancienne adresse : vers la nouvelle)
    python outils/atelier/telephone_site.py dossier --demenagement     (la même, pour app.atelier-mtg.com)

Depuis la refonte « site unique », l'appli est à https://atelier-mtg.com/mes-decks/, avec la page d'accueil (branche
« accueil », .github/workflows/site.yml) : même domaine, donc les pages du site savent si l'on est connecté. --base :
l'adresse de la base de cartes, restée à l'ancienne adresse (le dépôt « app » la publie avec demenagement()).

Le site reprend l'interface de l'Atelier (static/index.html, app.js, style.css) avec telephone.js, qui garde les decks
dans le navigateur et les synchronise avec le compte (outils/serveur/) au lieu du serveur Python, plus ce qu'il faut à
une appli installable : le
manifeste, les icônes et le service worker (sw.js), qui la garde pour l'ouvrir sans réseau. Il est publié à
https://app.atelier-mtg.com/ par l'organisation GitHub « atelier-mtg » (son dépôt « app » le fabrique à partir
de ce dépôt-ci) ; son ancienne adresse, https://atelier-mtg.github.io/, n'est plus qu'une passerelle (passerelle()).
"""
import hashlib
import json
import os
import shutil
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
STATIQUE = os.path.join(ICI, "static")
OUTILS = os.path.dirname(ICI)
# le simulateur, pour l'appli (simu_navigateur.py) : ses fichiers, et ceux qu'ils importent
SIMU = ("simu.py", "simu_adversaires.py", "simu_cartes.py", "simu_engage.py", "simu_moteur.py", "simu_rapport.py",
        "simu_navigateur.py", "prix.py", "reglages.py")
RACINE = os.path.dirname(os.path.dirname(ICI))
FOND = "#161513"                    # le fond du thème sombre (style.css) : écran de lancement et barre du téléphone
ICONES = {"icone-192.png": (192, False), "icone-512.png": (512, False), "icone-masque-512.png": (512, True),
          "icone-180.png": (180, False)}


def _empreinte(chemin):
    with open(chemin, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()[:10]


def _icones(dossier):
    """Le chaudron de l'Atelier sur le fond sombre ; « masque » : plus petit, pour les icônes rondes d'Android."""
    sys.path.insert(0, ICI)
    from PIL import Image
    from image_partage import _chaudron
    for nom, (taille, masque) in ICONES.items():
        im = Image.new("RGBA", (taille, taille), FOND)
        c = _chaudron(round(taille * (0.56 if masque else 0.74)))
        im.alpha_composite(c, ((taille - c.width) // 2, (taille - c.height) // 2))
        im.convert("RGB").save(os.path.join(dossier, nom), optimize=True)


def construire(dossier, base="base/"):
    if os.path.isdir(dossier):
        shutil.rmtree(dossier)
    os.makedirs(dossier)
    for f in ("app.js", "style.css"):
        shutil.copyfile(os.path.join(STATIQUE, f), os.path.join(dossier, f))
    for f in ("moteur.js", "pages.js", "cartes.js", "demenagement.html"):
        shutil.copyfile(os.path.join(STATIQUE, "telephone", f), os.path.join(dossier, f))
    # partager un deck sans PC (partage.js) : la version de l'Atelier, et les modèles de la page publiée (partage.py)
    sys.path.insert(0, ICI)
    from version import __version__
    with open(os.path.join(STATIQUE, "telephone", "partage.js"), encoding="utf-8") as f:
        js = f.read().replace("__VERSION_ATELIER__", __version__)
    with open(os.path.join(dossier, "partage.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write(js)
    os.makedirs(os.path.join(dossier, "partage"))
    for f in ("index.html", "jouer.html", "jouer.js", "jouer.css"):
        shutil.copyfile(os.path.join(STATIQUE, f), os.path.join(dossier, "partage", f))
    # la table de jeu de l'appli : jouer.js lit le deck que l'appli vient de préparer (jouer-appli.js)
    shutil.copyfile(os.path.join(STATIQUE, "telephone", "jouer-appli.js"), os.path.join(dossier, "jouer-appli.js"))
    os.makedirs(os.path.join(dossier, "jouer"))
    with open(os.path.join(STATIQUE, "jouer.html"), encoding="utf-8") as f:
        jeu = f.read()
    ej, ec, ea = (_empreinte(os.path.join(dossier, "partage", "jouer.js")), _empreinte(os.path.join(dossier, "partage", "jouer.css")),
                  _empreinte(os.path.join(dossier, "jouer-appli.js")))
    jeu = (jeu.replace('href="/static/jouer.css"', f'href="../partage/jouer.css?v={ec}"')
           .replace('<script src="/static/jouer.js"></script>',
                    f'<script src="../jouer-appli.js?v={ea}" data-jouer="../partage/jouer.js?v={ej}"></script>'))
    if "/static/" in jeu:
        raise SystemExit("jouer.html : une adresse /static/ n'a pas été remplacée")
    with open(os.path.join(dossier, "jouer", "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(jeu)
    # le simulateur dans l'appli (simulateur.js, un Worker avec Pyodide) : les fichiers Python du PC, et ses options
    # (simulation.py : tables, réglages par défaut, nombre de parties d'un test, parties par morceau)
    shutil.copyfile(os.path.join(STATIQUE, "telephone", "simulateur.js"), os.path.join(dossier, "simulateur.js"))
    os.makedirs(os.path.join(dossier, "simu"))
    simu = {}
    for nom in SIMU:
        shutil.copyfile(os.path.join(OUTILS, nom), os.path.join(dossier, "simu", nom))
        simu[nom] = f"simu/{nom}?v={_empreinte(os.path.join(dossier, 'simu', nom))}"
    sys.path[:0] = [ICI, OUTILS]
    import simulation
    options = dict(tables=simulation.tables_dispo(), defaut=simulation.reglages_defaut(), test_n=simulation.TEST_N,
                   morceau=simulation.MORCEAU)
    with open(os.path.join(STATIQUE, "telephone", "telephone.js"), encoding="utf-8") as f:      # le Worker de la base de cartes
        tel = (f.read().replace("__CARTES__", "cartes.js?v=" + _empreinte(os.path.join(dossier, "cartes.js")))
               .replace("__SIMU__", "simulateur.js?v=" + _empreinte(os.path.join(dossier, "simulateur.js")))
               .replace("__SIMU_FICHIERS__", json.dumps(simu)).replace("__SIMU_OPTIONS__", json.dumps(options, ensure_ascii=False))
               .replace("__BASE_CARTES__", base))
        if "__SIMU" in tel or "__BASE_CARTES__" in tel:
            raise SystemExit("telephone.js : une marque n'a pas été remplacée")
    with open(os.path.join(dossier, "telephone.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write(tel)
    _icones(dossier)
    with open(os.path.join(dossier, "manifest.webmanifest"), "w", encoding="utf-8") as f:
        json.dump(dict(name="Atelier MTG", short_name="Atelier MTG", description="Tes decks Commander, partout.", lang="fr",
                       start_url="./", scope="./", display="standalone", orientation="portrait",
                       background_color=FOND, theme_color=FOND,
                       icons=[dict(src="icone-192.png", sizes="192x192", type="image/png"),
                              dict(src="icone-512.png", sizes="512x512", type="image/png"),
                              dict(src="icone-masque-512.png", sizes="512x512", type="image/png", purpose="maskable")]),
                  f, ensure_ascii=False, indent=1)
    v = {f: _empreinte(os.path.join(dossier, f)) for f in ("app.js", "style.css", "moteur.js", "pages.js", "partage.js", "telephone.js", "cartes.js")}
    with open(os.path.join(STATIQUE, "index.html"), encoding="utf-8") as f:
        html = f.read()
    # avant tout affichage : l'habillage (grand écran à la souris : la barre du PC, sans onglets en bas), le thème choisi,
    # les fonctions Claude masquées (Options) et la connexion (le rond du compte, comme telephone.js › marquerCompte)
    habillage = ('<script>(function (h) { if (matchMedia("(min-width: 900px) and (pointer: fine)").matches) h.className = "ordinateur";\n'
                 '    else h.classList.add("sans-claude");\n'
                 '    try { var t = localStorage.getItem("theme"); if (t) h.dataset.theme = t;\n'
                 '      if (localStorage.getItem("atelier-claude") === "non") h.classList.add("sans-claude"); } catch (e) {}\n'
                 '    try { var c = JSON.parse(localStorage.getItem("atelier-compte") || "null"); if (c && c.jeton) { h.classList.add("connecte");\n'
                 '      if (c.pseudo) h.style.setProperty("--initiale", JSON.stringify(c.pseudo[0].toUpperCase())); } } catch (e) {}\n'
                 '  })(document.documentElement);</script>')
    tete = "\n  ".join([habillage, '<meta name="robots" content="noindex">',
                        f'<meta name="theme-color" content="{FOND}">',
                        '<meta name="apple-mobile-web-app-capable" content="yes">',
                        '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
                        '<meta name="apple-mobile-web-app-title" content="Atelier MTG">',
                        '<link rel="manifest" href="manifest.webmanifest">',
                        '<link rel="apple-touch-icon" href="icone-180.png">'])
    remplacements = [
        ('<html lang="fr">', '<html lang="fr" class="telephone">'),
        ('<meta name="viewport" content="width=device-width, initial-scale=1">',
         '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">\n  ' + tete),
        ('href="/static/style.css"', f'href="style.css?v={v["style.css"]}"'),
        ('  <script src="/reglages.js"></script>\n', ""),
        ('<script src="/static/app.js"></script>',
         f'<script src="moteur.js?v={v["moteur.js"]}"></script>\n  <script src="pages.js?v={v["pages.js"]}"></script>\n'
         f'  <script src="partage.js?v={v["partage.js"]}"></script>\n'
         f'  <script src="telephone.js?v={v["telephone.js"]}"></script>\n'
         f'  <script src="app.js?v={v["app.js"]}"></script>'),
        # en haut à droite, le rond du compte (app.js › menuCompte)
        ('<span class="txt">Demander à Claude</span></button>',
         '<span class="txt">Demander à Claude</span></button>\n'
         '      <button id="btn-compte" class="btn btn-compte en-compte" data-ico="compte" aria-label="Mon compte"></button>'),
    ]
    for a, b in remplacements:
        if a not in html:
            raise SystemExit(f"index.html a changé : « {a} » introuvable")
        html = html.replace(a, b)
    with open(os.path.join(dossier, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    voir(dossier, v)
    fichiers = ["./", f"app.js?v={v['app.js']}", f"style.css?v={v['style.css']}", f"moteur.js?v={v['moteur.js']}",
                f"pages.js?v={v['pages.js']}", f"partage.js?v={v['partage.js']}", f"telephone.js?v={v['telephone.js']}", f"cartes.js?v={v['cartes.js']}",
                "manifest.webmanifest", "jouer/", "jouer-appli.js", "partage/jouer.js", "partage/jouer.css", *ICONES]
    version = hashlib.sha1("".join(sorted(v.values())).encode() + html.encode()).hexdigest()[:12]
    with open(os.path.join(STATIQUE, "telephone", "sw.js"), encoding="utf-8") as f:
        sw = f.read().replace("__VERSION__", "atelier-" + version).replace("__FICHIERS__", json.dumps(fichiers))
    with open(os.path.join(dossier, "sw.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write(sw)
    open(os.path.join(dossier, ".nojekyll"), "w").close()          # GitHub Pages : les fichiers tels quels
    return dossier


def voir(dossier, v):
    """voir/ : le lien instantané d'un deck (app.js › lienInstantane), montré comme une page partagée. telephone.js y
    fait la page du deck à partir de la liste du lien (ATELIER_VOIR : il ne démarre pas l'appli), puis charge app.js."""
    with open(os.path.join(STATIQUE, "index.html"), encoding="utf-8") as f:
        html = f.read()
    tete = "\n  ".join(['<meta name="robots" content="noindex">',
                        f'<meta name="theme-color" content="{FOND}">',
                        '<meta property="og:type" content="website">',
                        '<meta property="og:site_name" content="Atelier MTG">',
                        '<meta property="og:locale" content="fr_FR">',
                        '<meta property="og:title" content="Un deck Commander partagé avec l\'Atelier MTG">',
                        '<meta property="og:description" content="Sa liste, en visuel, avec ses statistiques, ses combos et son bracket.">',
                        '<meta property="og:image" content="https://atelier-mtg.com/a-propos/atelier.jpg">',
                        '<meta name="twitter:card" content="summary_large_image">',
                        '<link rel="apple-touch-icon" href="../icone-180.png">'])
    # sans liste après « # » : l'appli, avant tout affichage ; voir-attente : l'en-tête n'a que le logo tant qu'app.js
    # n'est pas là (ses boutons et leurs icônes arrivent avec la page du deck, ou pas du tout si le lien est abîmé)
    remplacements = [
        ('<html lang="fr">', '<html lang="fr" class="partage voir-attente">'),
        ("<title>Atelier MTG</title>", "<title>Deck partagé · Atelier MTG</title>\n  "
         '<script>if (!location.hash.slice(1)) location.replace("../");</script>\n  ' + tete),
        ('<a href="#/" class="logo">', '<a href="../" class="logo">'),
        ('href="/static/style.css"', f'href="../style.css?v={v["style.css"]}"'),
        ('  <script src="/reglages.js"></script>\n', ""),
        ('<main id="vue" class="vue"></main>', '<main id="vue" class="vue"><p class="chargement">Chargement du deck…</p></main>'),
        ('<script src="/static/app.js"></script>',
         f'<script>window.ATELIER_VOIR = "../app.js?v={v["app.js"]}";</script>\n'
         f'  <script src="../moteur.js?v={v["moteur.js"]}"></script>\n  <script src="../pages.js?v={v["pages.js"]}"></script>\n'
         f'  <script src="../partage.js?v={v["partage.js"]}"></script>\n  <script src="../telephone.js?v={v["telephone.js"]}"></script>'),
    ]
    for a, b in remplacements:
        if a not in html:
            raise SystemExit(f"index.html a changé : « {a} » introuvable")
        html = html.replace(a, b)
    os.makedirs(os.path.join(dossier, "voir"), exist_ok=True)
    with open(os.path.join(dossier, "voir", "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(html)


def demenagement(dossier):
    """L'ancienne adresse app.atelier-mtg.com (dépôt « app », GitHub Pages) : la même passerelle que l'autre ancienne
    adresse ; le dépôt « app » y ajoute base/, la base de cartes, que l'appli lit toujours là (--base)."""
    return passerelle(dossier)


def passerelle(dossier):
    """Les anciennes adresses de l'appli (atelier-mtg.github.io, app.atelier-mtg.com) : la passerelle vers
    atelier-mtg.com/mes-decks/ (passerelle.html), qui emporte les decks d'un téléphone sans compte gardés là ; la même
    page pour toute adresse (404.html), et un service worker qui efface les fichiers de l'ancienne appli puis s'en va."""
    if os.path.isdir(dossier):
        shutil.rmtree(dossier)
    os.makedirs(dossier)
    for f in ("index.html", "404.html"):
        shutil.copyfile(os.path.join(STATIQUE, "telephone", "passerelle.html"), os.path.join(dossier, f))
    with open(os.path.join(dossier, "sw.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write("// L'ancienne adresse de l'appli : plus rien à garder ici (passerelle.html).\n"
                "self.addEventListener(\"install\", () => self.skipWaiting());\n"
                "self.addEventListener(\"activate\", (ev) => ev.waitUntil(caches.keys()\n"
                "  .then((l) => Promise.all(l.map((k) => caches.delete(k)))).then(() => self.registration.unregister())));\n")
    open(os.path.join(dossier, ".nojekyll"), "w").close()
    return dossier


if __name__ == "__main__":
    a = sys.argv[1:]
    base = a[a.index("--base") + 1] if "--base" in a else "base/"
    args = [x for i, x in enumerate(a) if not x.startswith("--") and not (i and a[i - 1] == "--base")]
    sortie = os.path.abspath(args[0] if args else os.path.join(RACINE, "site-telephone"))
    print(passerelle(sortie) if "--passerelle" in a else demenagement(sortie) if "--demenagement" in a
          else construire(sortie, base))
