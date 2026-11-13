"""Fabrique l'appli du téléphone : un site statique, installable sur l'écran d'accueil (appli web), sans serveur.

    python outils/atelier/telephone_site.py [dossier]        (site-telephone/ à la racine par défaut)

Le site reprend l'interface de l'Atelier (static/index.html, app.js, style.css) avec telephone.js, qui lit les decks dans
la sauvegarde en ligne au lieu du serveur Python (voir telephone.py), plus ce qu'il faut à une appli installable : le
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


def construire(dossier):
    if os.path.isdir(dossier):
        shutil.rmtree(dossier)
    os.makedirs(dossier)
    for f in ("app.js", "style.css"):
        shutil.copyfile(os.path.join(STATIQUE, f), os.path.join(dossier, f))
    for f in ("moteur.js", "pages.js", "cartes.js", "jsQR.js", "demenagement.html"):
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
    with open(os.path.join(STATIQUE, "telephone", "telephone.js"), encoding="utf-8") as f:      # le Worker de la base de cartes
        tel = f.read().replace("__CARTES__", "cartes.js?v=" + _empreinte(os.path.join(dossier, "cartes.js")))
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
    tete = "\n  ".join(['<meta name="robots" content="noindex">',
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
                "jsQR.js", "manifest.webmanifest", *ICONES]
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
    remplacements = [
        ('<html lang="fr">', '<html lang="fr" class="partage">'),
        ("<title>Atelier MTG</title>", "<title>Deck partagé · Atelier MTG</title>\n  " + tete),
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


def passerelle(dossier):
    """L'ancienne adresse de l'appli (atelier-mtg.github.io) : la passerelle vers la nouvelle (passerelle.html), qui
    emporte ce que le navigateur gardait ici ; la même page pour toute adresse (404.html), et un service worker qui
    efface les fichiers de l'ancienne appli puis s'en va."""
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
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    sortie = os.path.abspath(args[0] if args else os.path.join(RACINE, "site-telephone"))
    print(passerelle(sortie) if "--passerelle" in sys.argv else construire(sortie))
