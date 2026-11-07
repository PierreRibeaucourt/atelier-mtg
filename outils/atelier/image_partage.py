"""Image d'aperçu (1200 × 630) des pages partagées, pour les réseaux sociaux et les messageries (balise og:image).

Page d'un deck : l'illustration du commandant en fond, sa carte (deux en éventail pour des partenaires) et les chiffres du deck.
Racine du site : les cartes des commandants des decks partagés.
En JPEG : les messageries n'affichent pas les aperçus trop lourds (WhatsApp, au-delà d'environ 300 Ko).
"""
import io
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

L, H = 1200, 630
ACCENT, BORD = (249, 115, 22), (154, 52, 18)
PIPS = {"W": (248, 246, 216), "U": (14, 104, 171), "B": (60, 52, 48), "R": (211, 32, 42), "G": (0, 115, 62), "C": (190, 186, 182)}
POLICES = {True: ["segoeuib.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf"], False: ["segoeui.ttf", "DejaVuSans.ttf", "Arial.ttf"]}


def _police(gras, taille):
    for nom in POLICES[gras]:
        for dossier in ("", os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts"), "/usr/share/fonts/truetype/dejavu", "/Library/Fonts"):
            try:
                return ImageFont.truetype(os.path.join(dossier, nom) if dossier else nom, taille)
            except OSError:
                continue
    return ImageFont.load_default(taille)


def _image(url):
    if not url:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MTG-assistant-perso/1.0"})
        return Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert("RGB")
    except Exception:                                       # pas de réseau : l'image se fait sans
        return None


def _couvrir(im, l, h):
    return ImageOps.fit(im, (l, h), Image.LANCZOS)


def _fond(art):
    """L'illustration, floutée et assombrie vers la gauche pour que le texte se lise."""
    fond = _couvrir(art, L, H).filter(ImageFilter.GaussianBlur(3)) if art else Image.new("RGB", (L, H), (26, 24, 22))
    voile = Image.new("RGB", (L, H), (18, 16, 14))
    masque = Image.linear_gradient("L").rotate(90, expand=True).resize((L, H))            # opaque à gauche, léger à droite
    masque = masque.point(lambda v: int(245 - v * 95 / 255))
    return Image.composite(voile, fond, masque)


def _carte(im, hauteur, angle=0):
    """Une carte aux coins arrondis, avec son ombre, prête à coller (RGBA)."""
    larg = round(hauteur * 488 / 680)
    c = _couvrir(im, larg, hauteur).convert("RGBA")
    m = Image.new("L", c.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, larg - 1, hauteur - 1), radius=round(larg * .0475), fill=255)
    c.putalpha(m)
    marge = 40
    tout = Image.new("RGBA", (larg + 2 * marge, hauteur + 2 * marge), (0, 0, 0, 0))
    ombre = Image.new("RGBA", tout.size, (0, 0, 0, 0))
    ImageDraw.Draw(ombre).rounded_rectangle((marge, marge + 12, marge + larg, marge + hauteur + 12), radius=20, fill=(0, 0, 0, 170))
    tout = Image.alpha_composite(tout, ombre.filter(ImageFilter.GaussianBlur(16)))
    tout.alpha_composite(c, (marge, marge))
    return tout.rotate(angle, resample=Image.BICUBIC, expand=True) if angle else tout


def _chaudron(taille):
    """Le chaudron du favicon (static/index.html), dessiné à 4 fois la taille puis réduit."""
    k = taille * 4 / 32
    im = Image.new("RGBA", (taille * 4, taille * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = lambda *v: [x * k for x in v]                       # noqa: E731
    for cx, cy, r in ((11.5, 7, 2.8), (18.5, 3.6, 2), (19.8, 9.6, 1.6)):
        d.ellipse(s(cx - r, cy - r, cx + r, cy + r), fill=ACCENT)
    for x0, x1 in ((8, 6.6), (24, 25.4)):
        d.line(s(x0, 27.5, x1, 30.6), fill=BORD, width=round(2.4 * k))
    d.ellipse(s(3.5, 12.9, 28.5, 28.5), fill=(194, 65, 12))
    d.rounded_rectangle(s(2, 11.5, 30, 16.7), radius=2.6 * k, fill=BORD)
    d.arc(s(8, 14.5, 24, 24.5), 90, 180, fill=(253, 186, 116), width=round(1.6 * k))
    return im.resize((taille, taille), Image.LANCZOS)


def _marque(im, pastille=False):
    """« Atelier MTG » et le chaudron, en bas à droite (sur une pastille sombre quand des cartes passent dessous)."""
    d = ImageDraw.Draw(im)
    f = _police(True, 26)
    t = "Atelier MTG"
    w = d.textlength(t, font=f)
    x, y = L - 48 - w, H - 58
    if pastille:
        voile = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(voile).rounded_rectangle((x - 60, y - 12, L - 30, y + 46), radius=29, fill=(18, 16, 14, 225))
        im.alpha_composite(voile)
    d.text((x, y), t, font=f, fill=(236, 232, 226))
    im.alpha_composite(_chaudron(34), (round(x - 44), y - 2))


def _ajuste(d, texte, gras, taille, largeur, mini=30):
    f = _police(gras, taille)
    while taille > mini and d.textlength(texte, font=f) > largeur:
        taille -= 2
        f = _police(gras, taille)
    return f


def _enregistrer(im, chemin):
    im.convert("RGB").save(chemin, "JPEG", quality=84, optimize=True, progressive=True)


def image_deck(chemin, titre, sur_titre, commandants, images, art, identite, lignes, auteur=None):
    """sur_titre : « Deck Commander · Dimir » ; images : celles des commandants ; lignes : chiffres du deck ;
    auteur : « par … » sous les chiffres (à qui est le deck)."""
    im = _fond(_image(art)).convert("RGBA")
    cartes = [x for x in (_image(u) for u in images[:2]) if x]
    x_texte = 80
    if len(cartes) == 1:
        c = _carte(cartes[0], 520)
        im.alpha_composite(c, (30, (H - c.height) // 2))
        x_texte = 30 + c.width
    elif cartes:
        a, b = _carte(cartes[0], 470, 5), _carte(cartes[1], 470, -5)
        im.alpha_composite(a, (20, (H - a.height) // 2 - 6))
        im.alpha_composite(b, (190, (H - b.height) // 2 + 6))
        x_texte = 190 + b.width - 10
    d = ImageDraw.Draw(im)
    larg = L - x_texte - 60
    y = 92
    f = _police(True, 26)
    d.text((x_texte, y), sur_titre.upper(), font=f, fill=ACCENT)
    y += 44
    f = _ajuste(d, titre, True, 76, larg)
    d.text((x_texte, y), titre, font=f, fill=(255, 255, 255))
    y += f.size + 26
    for n in commandants[:2]:
        f = _ajuste(d, n, False, 34, larg, 22)
        d.text((x_texte, y), n, font=f, fill=(225, 220, 212))
        y += f.size + 10
    y += 12
    for i, k in enumerate(sorted(identite or ["C"], key="WUBRGC".find)):
        x = x_texte + i * 44
        d.ellipse((x, y, x + 34, y + 34), fill=PIPS.get(k, PIPS["C"]), outline=(255, 255, 255), width=2)
    y += 64
    f = _police(False, 30)
    for t in lignes:
        d.text((x_texte, y), t, font=f, fill=(236, 232, 226))
        y += 44
    if auteur:
        f = _ajuste(d, "par " + auteur, False, 28, larg, 20)
        d.text((x_texte, y + 6), "par " + auteur, font=f, fill=(190, 184, 175))
    _marque(im)
    _enregistrer(im, chemin)


def image_accueil(chemin, titre, sous_titre, images, arts):
    """Les cartes des commandants en éventail sous le titre, sur leurs illustrations."""
    arts = [x for x in (_image(u) for u in arts[:6]) if x]
    if arts:                                               # les illustrations en bandes verticales
        fond = Image.new("RGB", (L, H))
        w = L // len(arts)
        for i, a in enumerate(arts):
            fond.paste(_couvrir(a, w + (L - w * len(arts) if i == len(arts) - 1 else 0), H), (i * w, 0))
        fond = fond.filter(ImageFilter.GaussianBlur(4))
        im = Image.blend(fond, Image.new("RGB", (L, H), (18, 16, 14)), .72).convert("RGBA")
    else:
        im = Image.new("RGBA", (L, H), (26, 24, 22, 255))
    d = ImageDraw.Draw(im)
    f = _ajuste(d, titre, True, 64, L - 120, 40)
    d.text(((L - d.textlength(titre, font=f)) / 2, 54 + (64 - f.size) // 2), titre, font=f, fill=(255, 255, 255))
    f = _ajuste(d, sous_titre, False, 30, L - 120, 20)
    d.text(((L - d.textlength(sous_titre, font=f)) / 2, 142), sous_titre, font=f, fill=(225, 220, 212))
    cartes = [x for x in (_image(u) for u in images[:6]) if x]
    if cartes:
        n = len(cartes)
        haut = 400
        pas = min(250, (L - 160) // max(1, n))
        angles = [(i - (n - 1) / 2) * 4 for i in range(n)]
        blocs = [_carte(c, haut, -a) for c, a in zip(cartes, angles)]
        total = pas * (n - 1) + blocs[0].width
        x0 = (L - total) // 2
        for i, b in enumerate(blocs):
            im.alpha_composite(b, (x0 + i * pas, 215 + round(abs(angles[i]) * 3)))
    _marque(im, pastille=bool(cartes))
    _enregistrer(im, chemin)
