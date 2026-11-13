"""La page d'accueil de l'Atelier MTG, https://atelier-mtg.com/ : la page « C'est quoi, l'Atelier MTG ? » des sites de
decks, faite pour les moteurs de recherche, avec ses mentions légales et sa politique de confidentialité. Elle est
indexable, son texte est déjà dans le HTML (pré-rendu par Chrome sans interface : pas besoin de JavaScript pour le
lire), avec ses données structurées, son sitemap et son robots.txt.

Hébergée chez o2switch. GitHub Actions la construit à chaque changement de l'interface ou de la version
(.github/workflows/site.yml) et la pousse sur la branche « accueil » du dépôt ; une tâche planifiée de l'hébergement
la récupère toutes les 15 minutes. L'ancienne adresse, https://pierreribeaucourt.github.io/atelier-mtg/ (GitHub
Pages), ne garde qu'une redirection, pour toujours : les Ateliers installés jusqu'à la 2.0.0 y renvoient.

    python outils/atelier/site_atelier.py <dossier>                  la page d'accueil (Chrome nécessaire)
    python outils/atelier/site_atelier.py --redirection <dossier>    l'ancienne adresse
"""
import html as html_
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [ICI, os.path.dirname(ICI)]

import partage  # noqa: E402
import recherche  # noqa: E402
from version import __version__  # noqa: E402

SITE = partage.ACCUEIL_ATELIER
DOMAINE = urllib.parse.urlsplit(SITE).hostname
DEPOT = "https://github.com/PierreRibeaucourt/atelier-mtg"
CAPTURES = SITE + "a-propos/"                                            # comme CAPTURES_ATELIER dans app.js
# d'où viennent les captures : « Partage Atelier/a-propos/ » de l'auteur, publié avec son site de decks (pas dans le
# dépôt) ; copiées sur le domaine à chaque construction
SOURCE_CAPTURES = "https://pierreribeaucourt.github.io/decks/a-propos/"
CONTACT = "contact@" + DOMAINE                                           # renvoyée vers l'auteur par l'hébergement
MAJ_LEGAL = "13 novembre 2026"                                           # date des textes légaux : à changer avec eux
FAN_CONTENT = "https://company.wizards.com/en/legal/fancontentpolicy"
# l'onglet « Installeur » ouvert dans le HTML, comme pour la plupart des visiteurs
UA_WINDOWS = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 "
              "Safari/537.36")


def donnees(captures):
    """window.PARTAGE de la page : celle d'à propos, sans decks ni auteur ; la barre ramène à l'accueil ; captures : où
    sont ses images."""
    return dict(page=partage.A_PROPOS, accueil="./", titre_accueil="Atelier MTG", auteur=None, atelier=DEPOT,
                captures=captures,
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
    """Ce que dessine app.js dans la page : les moteurs de recherche le lisent sans JavaScript (inserer), et app.js le
    redessine à l'identique au chargement. Une image introuvable y est retirée : elles doivent être en ligne."""
    index = os.path.join(dossier, "index.html")
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profil:     # à part du Chrome ouvert sur ce PC
        r = subprocess.run([chrome(), "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
                            "--no-default-browser-check", f"--user-data-dir={profil}", f"--user-agent={UA_WINDOWS}",
                            "--virtual-time-budget=15000", "--dump-dom", pathlib.Path(index).as_uri()],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
    m = re.search(r'<main id="vue"[^>]*>(.*?)</main>', r.stdout, re.S)
    if not m or 'id="installation"' not in m.group(1):
        raise SystemExit("Pré-rendu impossible : Chrome n'a pas dessiné la page.\n" + r.stderr[-2000:])
    return m.group(1)


def inserer(dossier, rendu):
    index = os.path.join(dossier, "index.html")
    with open(index, encoding="utf-8") as f:
        html = f.read()
    vide = '<main id="vue" class="vue"></main>'
    if vide not in html:
        raise SystemExit("static/index.html a changé : pré-rendu impossible.")
    partage._ecrire(index, html.replace(vide, f'<main id="vue" class="vue vue-pleine">{rendu}</main>'))


def captures(dossier, rendu):
    """Les images de la page (captures, image de partage) copiées dans son a-propos/, sur son propre domaine ; rendu,
    pré-rendu avec les images de la source, les reprend de là."""
    noms = set(re.findall(re.escape(SOURCE_CAPTURES) + r"([\w-]+\.(?:webp|jpg))", rendu))
    if len(noms) < 3:
        raise SystemExit(f"Captures introuvables dans la page pré-rendue ({SOURCE_CAPTURES}).")
    noms.add(partage.IMAGE_ATELIER.rsplit("/", 1)[1])
    d = os.path.join(dossier, "a-propos")
    os.makedirs(d, exist_ok=True)
    for nom in sorted(noms):
        req = urllib.request.Request(SOURCE_CAPTURES + nom, headers={"User-Agent": "atelier-mtg"})
        with urllib.request.urlopen(req, timeout=60) as r, open(os.path.join(d, nom), "wb") as f:
            f.write(r.read())
    return rendu.replace(SOURCE_CAPTURES, "a-propos/")


# ---------------------------------------------------------------------------------------------------- pages légales

def _lien(url, texte=None):
    return f'<a href="{url}">{texte or html_.escape(url.split("//", 1)[-1].rstrip("/"))}</a>'


def _pied():
    """Le pied de la page d'accueil, comme piedPartage() dans app.js."""
    return f"""<footer class="pied-partage">
    <nav><a href="../">C'est quoi, l'Atelier MTG ?</a><a href="{DEPOT}" target="_blank" rel="noopener">Code source sur GitHub</a>
      <a href="{DEPOT}/blob/main/LICENSE" target="_blank" rel="noopener">Licence MIT</a>
      <a href="../mentions-legales/">Mentions légales</a><a href="../confidentialite/">Confidentialité</a></nav>
    <p lang="en">L'Atelier MTG is unofficial Fan Content permitted under the <a href="{FAN_CONTENT}" target="_blank" rel="noopener">Fan Content Policy</a>. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.</p>
    <p>Données des cartes : Scryfall.</p>
  </footer>"""


def page_legale(dossier, chemin, titre, description, corps):
    """dossier/chemin/index.html : une page de texte, sans JavaScript, à l'image de la page d'accueil."""
    with open(os.path.join(partage.STATIQUE, "index.html"), encoding="utf-8") as f:
        icone = re.search(r'<link rel="icon"[^>]*>', f.read()).group(0)
    v = partage._version(os.path.join(dossier, "style.css"))
    partage._ecrire(os.path.join(dossier, chemin, "index.html"), f"""<!doctype html>
<html lang="fr" class="partage">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{titre} · Atelier MTG</title>
  <meta name="description" content="{html_.escape(description)}">
  <link rel="canonical" href="{SITE}{chemin}/">
  {icone}
  <link rel="stylesheet" href="../style.css?v={v}">
  <script>try {{ const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; }} catch (e) {{}}</script>
</head>
<body>
  <header class="barre"><a href="../" class="logo">Atelier MTG</a></header>
  <div class="cadre">
    <main class="vue vue-pleine"><article class="a-propos legal">
      <h1>{titre}</h1>
      <p class="legal-date">Mise à jour le {MAJ_LEGAL}</p>
{corps}
    </article></main>
  </div>
  {_pied()}
</body>
</html>
""")


def mentions_legales(dossier):
    contact = _lien(f"mailto:{CONTACT}", CONTACT)
    page_legale(dossier, "mentions-legales", "Mentions légales",
                "Qui édite et qui héberge l'Atelier MTG, contenu de fan non officiel de Magic: The Gathering.", f"""
      <h2>Éditeur</h2>
      <p>Ce site et l'Atelier MTG sont édités par <strong>Pierre Ribeaucourt</strong>, à titre personnel, qui en est
        aussi le directeur de la publication.</p>
      <p>Pour écrire : {contact}</p>

      <h2>Hébergement</h2>
      <ul>
        <li><strong>Ce site</strong> ({DOMAINE}) : o2switch, SAS au capital de 100 000 €, Chemin des Pardiaux,
          63000 Clermont-Ferrand, France · RCS Clermont-Ferrand 510 909 807 · 04 44 44 60 40 · {_lien("https://www.o2switch.fr/")}</li>
        <li><strong>L'appli du téléphone</strong> (atelier-mtg.github.io) et <strong>le code source</strong> : GitHub, Inc.,
          88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis · {_lien("https://github.com/")}</li>
        <li><strong>Le relais de l'appli du téléphone</strong> (relais.atelier-mtg.workers.dev) : Cloudflare, Inc.,
          101 Townsend Street, San Francisco, CA 94107, États-Unis · {_lien("https://www.cloudflare.com/")}</li>
      </ul>

      <h2>Magic: The Gathering</h2>
      <p>L'Atelier MTG est un contenu de fan non officiel, permis par la {_lien(FAN_CONTENT, "Fan Content Policy")} de
        Wizards of the Coast. Il n'est ni approuvé ni soutenu par Wizards. Magic: The Gathering, les noms, les textes
        et les illustrations des cartes et les symboles de mana appartiennent à Wizards of the Coast LLC.</p>
      <p lang="en">L'Atelier MTG is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed
        by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.</p>

      <h2>Données des cartes</h2>
      <p>Les données des cartes, leurs prix Cardmarket et leurs images viennent de {_lien("https://scryfall.com/", "Scryfall")} ;
        les combos, de {_lien("https://commanderspellbook.com/", "Commander Spellbook")} et de MTGPics. L'Atelier MTG
        n'est lié à aucun de ces services.</p>

      <h2>Code source</h2>
      <p>L'Atelier MTG est un logiciel libre, sous {_lien(DEPOT + "/blob/main/LICENSE", "licence MIT")} : son code est
        {_lien(DEPOT, "sur GitHub")}. Il utilise qrcode-generator (Kazuhiko Arase, licence MIT) et jsQR (Cosmo Wolfe,
        licence Apache 2.0).</p>""")


def confidentialite(dossier):
    contact = _lien(f"mailto:{CONTACT}", CONTACT)
    page_legale(dossier, "confidentialite", "Confidentialité",
                "L'Atelier MTG ne demande aucun compte et ne recueille rien sur vous : ce qui part, où, et pourquoi.", f"""
      <p class="legal-bref">En bref : l'Atelier MTG ne vous demande aucun compte, ne recueille rien sur vous,
        n'affiche aucune publicité et ne vend rien. Vos decks restent chez vous.</p>

      <h2>Ce site</h2>
      <p>{DOMAINE} ne dépose aucun cookie et ne mesure pas son audience. Si vous changez le thème (clair ou sombre),
        votre choix est gardé dans votre navigateur, sans être envoyé nulle part.</p>
      <p>Comme tout hébergeur, o2switch tient des journaux techniques (adresse IP, date, page demandée, navigateur)
        pour la sécurité et le bon fonctionnement de ses serveurs. L'éditeur ne s'en sert pas.</p>

      <h2>L'Atelier sur votre ordinateur</h2>
      <p>L'Atelier s'installe et tourne sur votre ordinateur. Vos decks, votre classeur et vos réglages y sont rangés,
        et nulle part ailleurs tant que vous n'activez pas la sauvegarde. Pour fonctionner, il interroge :</p>
      <ul>
        <li><strong>Scryfall</strong>, pour les données, les prix et les images des cartes ;</li>
        <li><strong>Commander Spellbook</strong>, avec la liste des cartes d'un deck, pour trouver ses combos et estimer
          son bracket ;</li>
        <li><strong>MTGPics</strong>, avec des noms de cartes, pour d'autres combos ;</li>
        <li><strong>GitHub</strong>, pour savoir s'il existe une nouvelle version.</li>
      </ul>
      <p>La discussion et les synergies passent par <strong>Claude</strong>, installé sur votre ordinateur avec votre
        propre compte Anthropic : vos messages et les decks dont vous parlez sont alors envoyés à Anthropic, selon ses
        conditions. Rien ne part si vous ne vous en servez pas.</p>

      <h2>L'appli du téléphone</h2>
      <p>L'appli (atelier-mtg.github.io) garde vos decks dans le stockage de votre navigateur, sur votre téléphone.
        Elle interroge Scryfall, et Commander Spellbook par un petit relais (Cloudflare) qui transmet les demandes sans
        rien garder. Elle et sa base de cartes sont hébergées par GitHub Pages, qui tient ses propres journaux
        techniques.</p>

      <h2>Sauvegarde, téléphone relié et partage</h2>
      <p>Ces fonctions sont facultatives. Elles utilisent <strong>votre</strong> compte GitHub, auquel vous connectez
        l'Atelier ; depuis le téléphone, la connexion passe par le relais, qui ne garde rien. La clé d'accès reste sur
        vos appareils, et « Déconnecter tous mes appareils », dans les options, la retire.</p>
      <ul>
        <li><strong>La sauvegarde</strong> range vos decks et votre classeur dans un dépôt privé de votre compte,
          « atelier-mtg-sauvegarde », que vous seul voyez ;</li>
        <li><strong>le téléphone relié</strong> reçoit vos decks par ce même dépôt ;</li>
        <li><strong>le partage</strong> publie un deck sur une page publique de votre compte : sa liste, et le nom
          affiché comme auteur (celui des options, sinon le nom du compte GitHub).</li>
      </ul>

      <h2>Vos droits</h2>
      <p>L'éditeur ne détient aucune donnée vous concernant : il n'y a ni compte ni base de données. Pour les données
        tenues par les services cités plus haut, adressez-vous à eux : {_lien("https://scryfall.com/docs/privacy", "Scryfall")},
        {_lien("https://commanderspellbook.com/", "Commander Spellbook")},
        {_lien("https://docs.github.com/fr/site-policy/privacy-policies/github-general-privacy-statement", "GitHub")},
        {_lien("https://www.cloudflare.com/privacypolicy/", "Cloudflare")},
        {_lien("https://www.anthropic.com/legal/privacy", "Anthropic")}, {_lien("https://www.o2switch.fr/", "o2switch")}.</p>
      <p>Pour toute question : {contact}. Vous pouvez aussi adresser une réclamation à la
        {_lien("https://www.cnil.fr/", "CNIL")}.</p>""")


# ----------------------------------------------------------------------------------------------- fichiers du domaine

def sitemap(dossier):
    jour = time.strftime("%Y-%m-%d", time.gmtime())
    urls = "\n".join(f"  <url><loc>{SITE}{p}</loc><lastmod>{jour}</lastmod></url>"
                     for p in ("", "mentions-legales/", "confidentialite/"))
    partage._ecrire(os.path.join(dossier, "sitemap.xml"), f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{urls}
</urlset>
""")


def robots(dossier):
    partage._ecrire(os.path.join(dossier, "robots.txt"), f"User-agent: *\nAllow: /\n\nSitemap: {SITE}sitemap.xml\n")


def htaccess(dossier):
    """Apache d'o2switch : tout en https://atelier-mtg.com/ (sans www), sauf .well-known (le certificat s'y vérifie) ; pas de
    liste des fichiers ; app.js et style.css (adresses à ?v=) gardés longtemps, la page jamais."""
    hote = re.escape(DOMAINE)
    partage._ecrire(os.path.join(dossier, ".htaccess"), f"""# Page d'accueil de l'Atelier MTG, publiée par outils/atelier/site_atelier.py : ne pas modifier ici
Options -Indexes
RewriteEngine On
RewriteCond %{{REQUEST_URI}} !^/\\.well-known/
RewriteCond %{{HTTPS}} off [OR]
RewriteCond %{{HTTP_HOST}} !^{hote}$ [NC]
RewriteRule ^ https://{DOMAINE}%{{REQUEST_URI}} [L,R=301]

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html "access plus 0 seconds"
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType text/javascript "access plus 1 year"
  ExpiresByType image/webp "access plus 1 month"
  ExpiresByType image/jpeg "access plus 1 month"
</IfModule>
""")


def construire(dossier):
    entete = dict(titre=partage.TITRE_ATELIER, description=partage.DESCRIPTION_ATELIER, url=SITE,
                  image=partage.IMAGE_ATELIER, alt=partage.ALT_ATELIER, indexer=True, tete=[donnees_structurees()])
    partage._page(dossier, donnees(SOURCE_CAPTURES), entete)        # pré-rendue avec les captures de la source…
    rendu = captures(dossier, pre_rendre(dossier))
    partage._page(dossier, donnees("a-propos/"), entete)            # … publiée avec sa copie
    inserer(dossier, rendu)
    mentions_legales(dossier)
    confidentialite(dossier)
    sitemap(dossier)
    robots(dossier)
    htaccess(dossier)


def redirection(dossier):
    """L'ancienne adresse (GitHub Pages) : la page et toute autre adresse (404.html) renvoient vers le domaine."""
    os.makedirs(dossier, exist_ok=True)
    for f in ("index.html", "404.html"):
        partage._ecrire(os.path.join(dossier, f), partage.redirection(SITE))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        raise SystemExit(__doc__)
    sys.stdout.reconfigure(encoding="utf-8")
    sortie = os.path.abspath(args[0])
    if "--redirection" in sys.argv:
        redirection(sortie)
        print(f"Redirection vers {SITE} prête :", sortie)
    else:
        construire(sortie)
        print("Page d'accueil prête :", os.path.join(sortie, "index.html"))
