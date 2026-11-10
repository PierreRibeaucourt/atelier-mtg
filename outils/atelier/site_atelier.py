"""La page d'accueil de l'Atelier MTG, https://pierreribeaucourt.github.io/atelier-mtg/ : la page « C'est quoi,
l'Atelier MTG ? » des sites de decks, faite pour les moteurs de recherche. Elle est indexable, son texte est déjà dans
le HTML (pré-rendu par Chrome sans interface : pas besoin de JavaScript pour le lire), avec ses données structurées
(SoftwareApplication) et son sitemap.

GitHub Actions la construit et la publie à chaque changement de l'interface ou de la version
(.github/workflows/site.yml). Pour la construire sur ce PC (Chrome nécessaire) :

    python outils/atelier/site_atelier.py <dossier>
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [ICI, os.path.dirname(ICI)]

import partage  # noqa: E402
import recherche  # noqa: E402
from version import __version__  # noqa: E402

SITE = partage.ACCUEIL_ATELIER
DEPOT = "https://github.com/PierreRibeaucourt/atelier-mtg"
CAPTURES = "https://pierreribeaucourt.github.io/decks/a-propos/"          # comme CAPTURES_ATELIER dans app.js
# l'onglet « Installeur » ouvert dans le HTML, comme pour la plupart des visiteurs
UA_WINDOWS = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 "
              "Safari/537.36")


def donnees():
    """window.PARTAGE de la page : celle d'à propos, sans decks ni auteur ; la barre ramène à l'accueil."""
    return dict(page=partage.A_PROPOS, accueil="./", titre_accueil="Atelier MTG", auteur=None, atelier=DEPOT,
                reglages={"budget": 0},
                api={"/api/decks": [], "/api/corbeille": [], "/api/noms-cartes": dict(noms=[], communs=[]),
                     "/api/recherche/fonctions": recherche.fonctions()})


def donnees_structurees():
    d = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "Atelier MTG",
        "alternateName": "L'Atelier MTG",
        "description": partage.DESCRIPTION_ATELIER,
        "url": SITE,
        "inLanguage": "fr",
        "applicationCategory": "UtilitiesApplication",
        "applicationSubCategory": "Gestionnaire de decks Magic: The Gathering (Commander)",
        "operatingSystem": "Windows 10, Windows 11, macOS, Linux",
        "softwareVersion": __version__,
        "downloadUrl": f"{DEPOT}/releases/latest/download/Atelier-MTG-Windows.exe",
        "isAccessibleForFree": True,
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "EUR"},
        "license": f"{DEPOT}/blob/main/LICENSE",
        "image": partage.IMAGE_ATELIER,
        "screenshot": [f"{CAPTURES}{f}.webp" for f in ("decks", "suggestions", "statistiques")],
        "author": {"@type": "Person", "name": "PierreRibeaucourt", "url": "https://github.com/PierreRibeaucourt"},
        "sameAs": [DEPOT],
    }
    js = json.dumps(d, ensure_ascii=False, indent=2).replace("</", "<\\/")
    return f'<script type="application/ld+json">\n{js}\n  </script>'


def chrome():
    candidats = [os.environ.get("CHROME")] + [shutil.which(n) for n in ("google-chrome", "chromium", "chromium-browser",
                                                                        "chrome")]
    candidats += [os.path.join(os.environ[v], "Google", "Chrome", "Application", "chrome.exe")
                  for v in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA") if os.environ.get(v)]
    for c in candidats:
        if c and os.path.isfile(c):
            return c
    raise SystemExit("Chrome introuvable (variable CHROME : son chemin) : la page ne peut pas être pré-rendue.")


def pre_rendre(dossier):
    """Écrit dans index.html ce que dessine app.js : les moteurs de recherche le lisent sans JavaScript, et app.js le
    redessine à l'identique au chargement."""
    index = os.path.join(dossier, "index.html")
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profil:     # à part du Chrome ouvert sur ce PC
        r = subprocess.run([chrome(), "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
                            "--no-default-browser-check", f"--user-data-dir={profil}", f"--user-agent={UA_WINDOWS}",
                            "--virtual-time-budget=15000", "--dump-dom", pathlib.Path(index).as_uri()],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
    m = re.search(r'<main id="vue"[^>]*>(.*?)</main>', r.stdout, re.S)
    if not m or 'id="installation"' not in m.group(1):
        raise SystemExit("Pré-rendu impossible : Chrome n'a pas dessiné la page.\n" + r.stderr[-2000:])
    with open(index, encoding="utf-8") as f:
        html = f.read()
    vide = '<main id="vue" class="vue"></main>'
    if vide not in html:
        raise SystemExit("static/index.html a changé : pré-rendu impossible.")
    partage._ecrire(index, html.replace(vide, f'<main id="vue" class="vue vue-pleine">{m.group(1)}</main>'))


def sitemap(dossier):
    partage._ecrire(os.path.join(dossier, "sitemap.xml"), f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{SITE}</loc><lastmod>{time.strftime("%Y-%m-%d", time.gmtime())}</lastmod></url>
</urlset>
""")


def construire(dossier):
    partage._page(dossier, donnees(), dict(
        titre=partage.TITRE_ATELIER, description=partage.DESCRIPTION_ATELIER, url=SITE, image=partage.IMAGE_ATELIER,
        alt=partage.ALT_ATELIER, indexer=True, tete=[donnees_structurees()]))
    pre_rendre(dossier)
    sitemap(dossier)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    sys.stdout.reconfigure(encoding="utf-8")
    sortie = os.path.abspath(sys.argv[1])
    construire(sortie)
    print("Page d'accueil prête :", os.path.join(sortie, "index.html"))
