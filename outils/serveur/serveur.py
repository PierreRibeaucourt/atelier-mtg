"""Serveur des comptes de l'Atelier MTG (api.atelier-mtg.com).

Un compte = une adresse e-mail. On se connecte avec un code à 6 chiffres reçu par e-mail : pas de mot de passe.
Chaque compte garde ses fichiers {chemin: texte}, rangés comme les dossiers de l'Atelier du PC
(« Deck X/archidekt.txt », « Deck X/historique/… », « Classeur/classeur.txt »…) : l'appli du navigateur s'y
synchronise toute seule, l'Atelier du PC y envoie ou en récupère ses decks à la demande.

Réglages : un JSON hors du dépôt (variable ATELIER_API_REGLAGES, sinon ~/atelier-mtg-api/reglages.json) :
  {"base": "mysql://…" ou "sqlite:///…", "poivre": "<secret>", "origines": ["https://app.atelier-mtg.com"],
   "courriel": {"mode": "sendmail", "expediteur": "ne-pas-repondre@atelier-mtg.com"}}
Facultatifs : "quota" (octets par compte), "taille_max" (octets par fichier), "requete_max" (octets par requête),
"quota_pages" et "page_max" (octets compressés : les pages toutes prêtes d'un compte, une page),
"pages" (les pages publiques des decks, voir pages.py : dossier, url, modeles, interface, interface_url).

Les pages des decks toutes prêtes (GET/PUT /pages) : chaque appareil fait celles de ses decks et les dépose ici, pour
qu'un autre appareil qui a les mêmes fichiers les reprenne au lieu de les refaire (voir « pages toutes prêtes »).
"""
import base64
import functools
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
import zlib
from datetime import datetime, timezone

from flask import Flask, Response, g, jsonify, request
from werkzeug.exceptions import HTTPException

import courriel
import pages
from base import Base

DUREE_CODE = 15 * 60
ESSAIS_CODE = 5
CODES_PAR_HEURE = 3             # par adresse e-mail
CODES_PAR_HEURE_IP = 20         # par adresse IP
SESSIONS_MAX = 50               # appareils connectés à un compte, au plus (une connexion donnée par un autre appareil)
QUOTA = 50 * 2**20
TAILLE_MAX = 2**20
REQUETE_MAX = 20 * 2**20
CHEMIN_MAX = 400
LOT_MAX = 2000                  # fichiers par lecture ou écriture
FORMAT_APPLI = "atelier-mtg-appli"
IMAGE_MAX = 2 * 1024 * 1024       # l'image d'aperçu d'une page publique (JPEG)     # celui de « Enregistrer dans un fichier » (decks.lire_appli sur le PC)
QUOTA_PAGES = 40 * 2**20          # les pages toutes prêtes d'un compte, compressées
PAGE_MAX = 4 * 2**20              # une page, compressée
PAGE_TEXTE_MAX = 40 * 2**20       # une page, décompressée
INDEX_PAGES = "@index"            # l'accueil : la liste des decks, le classeur, où sont mes cartes
COMPRESSER = 1400                 # au-delà (octets), une réponse JSON part compressée si le navigateur le veut

EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s.]{2,}$")
CONTROLES = re.compile(r"[\x00-\x1f\x7f]")
EMPREINTE = re.compile(r"^[0-9a-f]{40}$")


class Refus(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.message, self.code = message, code


def maintenant():
    return int(time.time())


def sha_blob(texte):
    """L'empreinte git d'un fichier (comme compte.sha sur le PC et shaBlob dans l'appli)."""
    o = texte.encode("utf-8")
    return hashlib.sha1(b"blob %d\0" % len(o) + o).hexdigest()


def chemin_valide(c):
    """« Dossier/…/fichier » sans rien qui puisse sortir d'un dossier une fois écrit sur un disque."""
    if not isinstance(c, str) or not 0 < len(c) <= CHEMIN_MAX or "\\" in c or ":" in c or CONTROLES.search(c):
        return False
    parts = c.split("/")
    return len(parts) >= 2 and all(p.strip() and p == p.strip() and not p.startswith(".") for p in parts)


def lire_reglages():
    chemin = os.environ.get("ATELIER_API_REGLAGES") or os.path.expanduser("~/atelier-mtg-api/reglages.json")
    with open(chemin, encoding="utf-8") as f:
        return json.load(f)


def creer(reglages):
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = int(reglages.get("requete_max", REQUETE_MAX))
    app.json.ensure_ascii = False
    base = Base(reglages["base"])
    base.creer_tables()
    poivre = reglages["poivre"].encode()
    origines = set(reglages.get("origines", []))
    quota = int(reglages.get("quota", QUOTA))
    taille_max = int(reglages.get("taille_max", TAILLE_MAX))
    quota_pages = int(reglages.get("quota_pages", QUOTA_PAGES))
    page_max = int(reglages.get("page_max", PAGE_MAX))
    envoi = reglages.get("courriel", {"mode": "memoire"})

    def empreinte(*morceaux):
        return hashlib.sha256(poivre + "\0".join(morceaux).encode()).hexdigest()

    def corps():
        d = request.get_json(silent=True)
        if not isinstance(d, dict):
            raise Refus("Requête invalide.")
        return d

    def email_de(d):
        e = str(d.get("email", "")).strip().lower()
        if len(e) > 254 or not EMAIL.match(e):
            raise Refus("Adresse e-mail invalide.")
        return e

    # --- réponses ---------------------------------------------------------------------------------------------
    @app.after_request
    def entetes(rep):
        o = request.headers.get("Origin")
        if o and o in origines:
            rep.headers["Access-Control-Allow-Origin"] = o
            rep.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            rep.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
            rep.headers["Access-Control-Expose-Headers"] = "X-Empreinte, X-Niveau"
            rep.headers["Access-Control-Max-Age"] = "86400"
        # les fichiers et les pages d'un compte arrivent bien plus vite compressés, surtout sur un téléphone
        if (rep.status_code == 200 and rep.mimetype == "application/json" and not rep.direct_passthrough
                and "Content-Encoding" not in rep.headers and "gzip" in request.headers.get("Accept-Encoding", "")):
            corps = rep.get_data()
            if len(corps) > COMPRESSER:
                rep.set_data(gzip.compress(corps, compresslevel=5))
                rep.headers["Content-Encoding"] = "gzip"
        rep.headers["Vary"] = "Origin, Accept-Encoding"
        rep.headers["Cache-Control"] = "no-store"
        rep.headers["X-Content-Type-Options"] = "nosniff"
        return rep

    @app.errorhandler(Refus)
    def refus(e):
        return jsonify(erreur=e.message), e.code

    @app.errorhandler(HTTPException)
    def http(e):
        messages = {404: "Introuvable.", 405: "Méthode refusée.", 413: "Envoi trop gros."}
        return jsonify(erreur=messages.get(e.code, e.name)), e.code

    # --- connexion --------------------------------------------------------------------------------------------
    def connecte(f):
        @functools.wraps(f)
        def g_(*a, **k):
            entete = request.headers.get("Authorization", "")
            jeton = entete[7:].strip() if entete.startswith("Bearer ") else ""
            if not jeton:
                raise Refus("Connexion nécessaire.", 401)
            with base.session() as s:
                r = s.un("SELECT s.id, s.compte, s.vu, c.email FROM sessions s JOIN comptes c ON c.id = s.compte "
                         "WHERE s.empreinte = ?", hashlib.sha256(jeton.encode()).hexdigest())
                if not r:
                    raise Refus("Connexion expirée : reconnecte-toi.", 401)
                g.session, g.compte, vu, g.email = r
                t = maintenant()
                if t - vu > 3600:
                    s.faire("UPDATE sessions SET vu = ? WHERE id = ?", t, g.session)
                    s.faire("UPDATE comptes SET vu = ? WHERE id = ?", t, g.compte)
            return f(*a, **k)
        return g_

    @app.get("/")
    def accueil():
        return jsonify(service="atelier-mtg", version=1)

    @app.post("/connexion/code")
    def demander_code():
        email = email_de(corps())
        t = maintenant()
        ip = request.remote_addr or "?"
        with base.session() as s:
            s.faire("DELETE FROM envois WHERE quand < ?", t - 86400)
            s.faire("DELETE FROM codes WHERE expire < ?", t)
            if (s.un("SELECT COUNT(*) FROM envois WHERE cle = ? AND quand > ?", "e:" + email, t - 3600)[0]
                    >= CODES_PAR_HEURE
                    or s.un("SELECT COUNT(*) FROM envois WHERE cle = ? AND quand > ?", "ip:" + ip, t - 3600)[0]
                    >= CODES_PAR_HEURE_IP):
                raise Refus("Trop de codes demandés : réessaie dans une heure.", 429)
            code = f"{secrets.randbelow(10**6):06d}"
            s.faire("DELETE FROM codes WHERE email = ?", email)
            s.faire("INSERT INTO codes (email, empreinte, expire, essais) VALUES (?, ?, ?, 0)",
                    email, empreinte(email, code), t + DUREE_CODE)
            s.faire("INSERT INTO envois (cle, quand) VALUES (?, ?)", "e:" + email, t)
            s.faire("INSERT INTO envois (cle, quand) VALUES (?, ?)", "ip:" + ip, t)
        try:
            courriel.envoyer_code(envoi, email, code)
        except Exception as e:                      # noqa: BLE001 - on le dit sans détailler
            app.logger.error("envoi du code à %s : %s", email, e)
            raise Refus("Le code n'a pas pu partir : réessaie dans un moment.", 503)
        return jsonify(ok=True)

    @app.post("/connexion/verifier")
    def verifier_code():
        d = corps()
        email = email_de(d)
        code = re.sub(r"\s", "", str(d.get("code", "")))
        appareil = CONTROLES.sub("", str(d.get("appareil") or "Appareil")).strip()[:80] or "Appareil"
        t = maintenant()
        erreur = None
        with base.session() as s:      # un essai raté doit être compté : on valide AVANT de refuser
            r = s.un("SELECT empreinte, expire, essais FROM codes WHERE email = ?", email)
            if not r or r[1] < t:
                erreur = "Code expiré : demande un nouveau code."
            elif r[2] >= ESSAIS_CODE:
                s.faire("DELETE FROM codes WHERE email = ?", email)
                erreur = "Trop d'essais : demande un nouveau code."
            elif not hmac.compare_digest(r[0], empreinte(email, code)):
                s.faire("UPDATE codes SET essais = essais + 1 WHERE email = ?", email)
                erreur = "Code incorrect."
        if erreur:
            raise Refus(erreur)
        with base.session() as s:
            if not s.faire("DELETE FROM codes WHERE email = ?", email):
                raise Refus("Code expiré : demande un nouveau code.")      # utilisé entre-temps
            c = s.un("SELECT id, pseudo FROM comptes WHERE email = ?", email)
            nouveau = not c
            compte = c[0] if c else s.inserer("INSERT INTO comptes (email, cree, vu) VALUES (?, ?, ?)", email, t, t)
            pseudo = c[1] if c else None
            jeton = secrets.token_urlsafe(32)
            s.inserer("INSERT INTO sessions (compte, empreinte, appareil, cree, vu) VALUES (?, ?, ?, ?, ?)",
                      compte, hashlib.sha256(jeton.encode()).hexdigest(), appareil, t, t)
        return jsonify(jeton=jeton, email=email, nouveau=nouveau, pseudo=pseudo)

    @app.post("/connexion/appareil")
    @connecte
    def connecter_appareil():
        """{appareil} : une connexion de plus pour la même personne, donnée par un appareil déjà connecté (le site la passe
        au module Claude de son PC, sans code). Son propre jeton : elle se retire seule (Mon compte › appareils)."""
        appareil = CONTROLES.sub("", str(corps().get("appareil") or "Appareil")).strip()[:80] or "Appareil"
        t = maintenant()
        jeton = secrets.token_urlsafe(32)
        with base.session() as s:
            if s.un("SELECT COUNT(*) FROM sessions WHERE compte = ?", g.compte)[0] >= SESSIONS_MAX:
                raise Refus("Trop d'appareils connectés : retire ceux que tu n'utilises plus (Mon compte).", 409)
            s.inserer("INSERT INTO sessions (compte, empreinte, appareil, cree, vu) VALUES (?, ?, ?, ?, ?)",
                      g.compte, hashlib.sha256(jeton.encode()).hexdigest(), appareil, t, t)
            pseudo = s.un("SELECT pseudo FROM comptes WHERE id = ?", g.compte)[0]
        return jsonify(jeton=jeton, email=g.email, pseudo=pseudo)

    @app.post("/deconnexion")
    @connecte
    def deconnexion():
        with base.session() as s:
            s.faire("DELETE FROM sessions WHERE id = ?", g.session)
        return jsonify(ok=True)

    # --- compte -----------------------------------------------------------------------------------------------
    @app.get("/compte")
    @connecte
    def compte():
        with base.session() as s:
            email, pseudo, cree, octets, revision = s.un(
                "SELECT email, pseudo, cree, octets, revision FROM comptes WHERE id = ?", g.compte)
        return jsonify(email=email, pseudo=pseudo, cree=cree, octets=octets, quota=quota, revision=revision)

    def fixer_pseudo(s, voulu):
        """Le pseudo du compte, choisi une fois (à l'inscription ; avant, au premier partage) : None si c'est fait, sinon
        ce qui ne va pas. Il est dans l'adresse des pages : il ne change pas (plus tard, avec une redirection)."""
        voulu = str(voulu or "").strip().lower()
        if not voulu:
            return "Choisis ton pseudo : il sera dans l'adresse de tes decks."
        if not pages.pseudo_valide(voulu):
            return "Pseudo : de 3 à 30 lettres minuscules, chiffres ou tirets."
        if s.un("SELECT 1 FROM comptes WHERE pseudo = ? AND id <> ?", voulu, g.compte):
            return "Ce pseudo est déjà pris : choisis-en un autre."
        actuel = s.un("SELECT pseudo FROM comptes WHERE id = ?", g.compte)[0]
        if actuel and actuel != voulu:
            return "Ton pseudo est déjà choisi."
        s.faire("UPDATE comptes SET pseudo = ? WHERE id = ?", voulu, g.compte)
        return None

    @app.post("/compte/pseudo")
    @connecte
    def choisir_pseudo():
        """{pseudo} : le pseudo du compte (à l'inscription). 409 {erreur} s'il est pris, invalide ou déjà choisi."""
        with base.session() as s:
            verrouiller(s)
            erreur = fixer_pseudo(s, corps().get("pseudo"))
            if erreur:
                return jsonify(erreur=erreur), 409
            pseudo = s.un("SELECT pseudo FROM comptes WHERE id = ?", g.compte)[0]
        return jsonify(pseudo=pseudo)

    @app.delete("/compte")
    @connecte
    def supprimer_compte():
        if str(corps().get("email", "")).strip().lower() != g.email:
            raise Refus("Confirme avec l'adresse e-mail du compte.")
        with base.session() as s:
            pseudo = s.un("SELECT pseudo FROM comptes WHERE id = ?", g.compte)[0]
            for table in ("fichiers", "sessions", "partages", "pages"):
                s.faire(f"DELETE FROM {table} WHERE compte = ?", g.compte)
            s.faire("DELETE FROM codes WHERE email = ?", g.email)
            s.faire("DELETE FROM comptes WHERE id = ?", g.compte)
            if pseudo and cfg_pages:                     # ses pages publiques partent avec lui
                pages.retirer_pseudo(cfg_pages, pseudo)
                plan_du_site(s)
        return jsonify(ok=True)

    @app.get("/compte/export")
    @connecte
    def exporter():
        with base.session() as s:
            fichiers = dict(s.tous("SELECT chemin, contenu FROM fichiers WHERE compte = ? ORDER BY chemin", g.compte))
        date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        rep = jsonify(format=FORMAT_APPLI, version=1, date=date, local={},
                      fichiers={"@depot": {"fichiers": fichiers, "modifies": {}}})
        rep.headers["Content-Disposition"] = f'attachment; filename="atelier-mtg-{date[:10]}.json"'
        return rep

    @app.get("/appareils")
    @connecte
    def appareils():
        with base.session() as s:
            r = s.tous("SELECT id, appareil, cree, vu FROM sessions WHERE compte = ? ORDER BY vu DESC", g.compte)
        return jsonify(appareils=[dict(id=i, appareil=a, cree=c, vu=v, courant=i == g.session) for i, a, c, v in r])

    @app.delete("/appareils/<int:ident>")
    @connecte
    def oublier_appareil(ident):
        with base.session() as s:
            if not s.faire("DELETE FROM sessions WHERE id = ? AND compte = ?", ident, g.compte):
                raise Refus("Appareil introuvable.", 404)
        return jsonify(ok=True)

    # --- fichiers ---------------------------------------------------------------------------------------------
    @app.get("/fichiers")
    @connecte
    def liste():
        """{revision, fichiers: {chemin: sha}} ; {revision, inchange: true} si rien n'a bougé depuis ?revision=."""
        with base.session() as s:
            revision = s.un("SELECT revision FROM comptes WHERE id = ?", g.compte)[0]
            if request.args.get("revision") == str(revision):
                return jsonify(revision=revision, inchange=True)
            fichiers = dict(s.tous("SELECT chemin, sha FROM fichiers WHERE compte = ?", g.compte))
        return jsonify(revision=revision, fichiers=fichiers)

    @app.post("/fichiers/lire")
    @connecte
    def lire():
        chemins = corps().get("chemins")
        if not isinstance(chemins, list) or len(chemins) > LOT_MAX or not all(isinstance(c, str) for c in chemins):
            raise Refus("Liste de fichiers invalide.")
        voulus, trouves = set(chemins), {}
        with base.session() as s:
            for chemin, contenu in s.tous("SELECT chemin, contenu FROM fichiers WHERE compte = ?", g.compte):
                if chemin in voulus:
                    trouves[chemin] = contenu
        return jsonify(fichiers=trouves)

    @app.post("/fichiers/ecrire")
    @connecte
    def ecrire():
        """changements : [{chemin, contenu (texte, ou null pour effacer), base (sha attendu, null = absent)}].
        Un fichier qui a changé depuis « base » n'est pas touché : il revient dans « conflits » avec son sha actuel.
        « force » : true écrit sans regarder « base » (l'Atelier du PC qui envoie ses decks)."""
        d = corps()
        changements, force = d.get("changements"), bool(d.get("force"))
        if not isinstance(changements, list) or len(changements) > LOT_MAX:
            raise Refus("Liste de changements invalide.")
        vus = set()
        for ch in changements:
            if not isinstance(ch, dict) or not chemin_valide(ch.get("chemin")) or ch["chemin"] in vus:
                raise Refus(f"Chemin refusé : {str(ch.get('chemin') if isinstance(ch, dict) else ch)[:120]}")
            vus.add(ch["chemin"])
            if ch.get("contenu") is not None and not isinstance(ch["contenu"], str):
                raise Refus(f"Contenu refusé : {ch['chemin']}")
            if ch.get("contenu") is not None and len(ch["contenu"].encode("utf-8")) > taille_max:
                raise Refus(f"Fichier trop gros : {ch['chemin']}", 413)
        t = maintenant()
        ecrits, conflits = {}, {}
        with base.session() as s:
            # verrou sur le compte : deux écritures du même compte passent l'une après l'autre
            if base.mysql:
                s.un("SELECT revision FROM comptes WHERE id = ? FOR UPDATE", g.compte)
            else:
                s.faire("UPDATE comptes SET revision = revision WHERE id = ?", g.compte)
            revision, octets = s.un("SELECT revision, octets FROM comptes WHERE id = ?", g.compte)
            actuels = {c: (sha, taille) for c, sha, taille in
                       s.tous("SELECT chemin, sha, taille FROM fichiers WHERE compte = ?", g.compte)}
            a_faire = []
            for ch in changements:
                chemin, contenu = ch["chemin"], ch.get("contenu")
                actuel = actuels.get(chemin)
                sha = sha_blob(contenu) if contenu is not None else None
                if (actuel[0] if actuel else None) == sha:
                    ecrits[chemin] = sha                 # déjà comme ça
                elif not force and (actuel[0] if actuel else None) != ch.get("base"):
                    conflits[chemin] = actuel[0] if actuel else None
                else:
                    a_faire.append((chemin, contenu, sha))
                    octets += (len(contenu.encode("utf-8")) if contenu is not None else 0) - (actuel[1] if actuel else 0)
            if octets > quota:
                raise Refus("Compte plein : supprime des decks ou leur historique.", 413)
            for chemin, contenu, sha in a_faire:
                if contenu is None:
                    s.faire("DELETE FROM fichiers WHERE compte = ? AND chemin = ?", g.compte, chemin)
                else:
                    s.faire("REPLACE INTO fichiers (compte, chemin, contenu, sha, taille, maj) VALUES (?, ?, ?, ?, ?, ?)",
                            g.compte, chemin, contenu, sha, len(contenu.encode("utf-8")), t)
                ecrits[chemin] = sha
            if a_faire:
                revision += 1
                s.faire("UPDATE comptes SET revision = ?, octets = ?, vu = ? WHERE id = ?", revision, octets, t, g.compte)
        return jsonify(revision=revision, ecrits=ecrits, conflits=conflits)

    # --- pages publiques des decks (pages.py) -------------------------------------------------------------------
    cfg_pages = pages.Reglages(reglages["pages"]) if reglages.get("pages") else None

    def pages_pretes():
        if not cfg_pages:
            raise Refus("Les pages publiques ne sont pas encore disponibles.", 503)

    def verrouiller(s):
        if base.mysql:
            s.un("SELECT id FROM comptes WHERE id = ? FOR UPDATE", g.compte)
        else:
            s.faire("UPDATE comptes SET revision = revision WHERE id = ?", g.compte)

    def nom_deck(x):
        d = str(x or "")
        if not d or len(d) > 200 or CONTROLES.search(d):
            raise Refus("Nom de deck invalide.")
        return d

    def plan_du_site(s):
        pages.ecrire_sitemap(cfg_pages, s.tous("SELECT c.pseudo, p.slug, p.maj FROM partages p JOIN comptes c ON c.id = p.compte "
                                               "WHERE p.visibilite = 'public'"))

    def page_du_pseudo(s, pseudo):
        lignes = s.tous("SELECT deck, slug, resume FROM partages WHERE compte = ? AND visibilite = 'public' ORDER BY maj DESC",
                        g.compte)
        pages.ecrire_pseudo(cfg_pages, pseudo, [(d, sl, json.loads(r)) for d, sl, r in lignes])

    @app.get("/partages")
    @connecte
    def partages():
        """{pseudo, partages: [{deck, slug, url, date, visibilite}]}."""
        with base.session() as s:
            pseudo = s.un("SELECT pseudo FROM comptes WHERE id = ?", g.compte)[0]
            lignes = s.tous("SELECT deck, slug, maj, visibilite FROM partages WHERE compte = ? ORDER BY deck", g.compte)
        url = cfg_pages.url if cfg_pages else ""
        return jsonify(pseudo=pseudo, partages=[dict(deck=d, slug=sl, url=f"{url}{pseudo}/{sl}/", date=m, visibilite=v)
                                                for d, sl, m, v in lignes])

    @app.post("/partages")
    @connecte
    def partager():
        """{deck, donnees (partage.capturer), image (JPEG en base64, facultative), budget, pseudo (compte sans pseudo),
        visibilite (« public », par défaut, ou « non-repertorie »), slug (l'adresse voulue par l'Atelier, la première
        fois)} : publie ou met à jour la page du deck. Renvoie {url, slug, date, pseudo} ; 409 {pseudo_requis} sans pseudo."""
        pages_pretes()
        d = corps()
        deck, donnees = nom_deck(d.get("deck")), d.get("donnees")
        if not isinstance(donnees, dict) or not isinstance(donnees.get("api"), dict):
            raise Refus("Données de la page invalides.")
        visibilite = d.get("visibilite") or "public"
        if visibilite not in ("public", "non-repertorie"):
            raise Refus("Visibilité invalide.")
        image = None
        if d.get("image"):
            try:
                image = base64.b64decode(str(d["image"]), validate=True)
            except ValueError:
                raise Refus("Image invalide.") from None
            if len(image) > IMAGE_MAX or not image.startswith(b"\xff\xd8\xff"):
                raise Refus("Image invalide.")
        t = maintenant()
        with base.session() as s:
            verrouiller(s)
            pseudo = s.un("SELECT pseudo FROM comptes WHERE id = ?", g.compte)[0]
            if not pseudo:
                erreur = fixer_pseudo(s, d.get("pseudo"))
                if erreur:
                    return jsonify(erreur=erreur, pseudo_requis=True), 409
                pseudo = s.un("SELECT pseudo FROM comptes WHERE id = ?", g.compte)[0]
            r = s.un("SELECT slug FROM partages WHERE compte = ? AND deck = ?", g.compte, deck)
            if r:
                slug = r[0]                                    # l'adresse d'une page ne change pas
            else:
                pris = {x for (x,) in s.tous("SELECT slug FROM partages WHERE compte = ?", g.compte)}
                voulu = str(d.get("slug") or "")
                slug = voulu if pages.slug_valide(voulu) and voulu not in pris else pages.slug_de(deck, pris)
            try:
                url, resume = pages.ecrire_deck(cfg_pages, pseudo, slug, deck, donnees, image, d.get("budget"),
                                                indexer=visibilite == "public")
            except ValueError as e:
                raise Refus(str(e)) from None
            s.faire("REPLACE INTO partages (compte, deck, slug, maj, resume, visibilite) VALUES (?, ?, ?, ?, ?, ?)",
                    g.compte, deck, slug, t, json.dumps(resume, ensure_ascii=False), visibilite)
            page_du_pseudo(s, pseudo)
            plan_du_site(s)
        return jsonify(url=url, slug=slug, date=t, pseudo=pseudo, visibilite=visibilite)

    @app.post("/partages/retirer")
    @connecte
    def retirer_partage():
        """{deck} : la page n'est plus en ligne."""
        pages_pretes()
        deck = nom_deck(corps().get("deck"))
        with base.session() as s:
            verrouiller(s)
            pseudo = s.un("SELECT pseudo FROM comptes WHERE id = ?", g.compte)[0]
            r = s.un("SELECT slug FROM partages WHERE compte = ? AND deck = ?", g.compte, deck)
            if r and pseudo:
                s.faire("DELETE FROM partages WHERE compte = ? AND deck = ?", g.compte, deck)
                pages.retirer_deck(cfg_pages, pseudo, r[0])
                page_du_pseudo(s, pseudo)
                plan_du_site(s)
        return jsonify(ok=True)

    @app.post("/partages/renommer")
    @connecte
    def renommer_partage():
        """{ancien, nouveau} : le deck a changé de nom ; sa page garde son adresse (le lien envoyé marche toujours)."""
        d = corps()
        ancien, nouveau = nom_deck(d.get("ancien")), nom_deck(d.get("nouveau"))
        with base.session() as s:
            verrouiller(s)
            if not s.un("SELECT 1 FROM partages WHERE compte = ? AND deck = ?", g.compte, nouveau):
                s.faire("UPDATE partages SET deck = ? WHERE compte = ? AND deck = ?", nouveau, g.compte, ancien)
        return jsonify(ok=True)

    # --- pages toutes prêtes -------------------------------------------------------------------------------------
    # Chaque appareil fait les pages de ses decks (l'appli : pages.js ; le PC : son Atelier) et les dépose ici avec
    # l'empreinte des fichiers dont elles sont tirées (même calcul partout : telephone.js › empreintes, compte.py) et
    # leur niveau (2 : faite avec la base de cartes ; +1 : avec l'analyse de Commander Spellbook de la liste). Un appareil
    # qui a les mêmes fichiers reprend la page telle quelle : rien à refaire, rien à demander à Scryfall. Un cache : ni
    # dans l'export, ni dans le quota des fichiers ; la page d'un deck qui n'est plus dans le compte est oubliée.
    def decks_presents(s):
        return {c.rsplit("/", 1)[0] for (c,) in s.tous("SELECT chemin FROM fichiers WHERE compte = ? AND chemin LIKE ?",
                                                          g.compte, "%/archidekt.txt") if c.count("/") == 1}

    @app.get("/pages")
    @connecte
    def liste_pages():
        """{pages: {deck: {empreinte, niveau, maj, taille}}} ; « @index » : l'accueil."""
        with base.session() as s:
            presents = decks_presents(s)
            lignes = s.tous("SELECT deck, empreinte, niveau, maj, taille FROM pages WHERE compte = ?", g.compte)
            partis = {d for d, *_ in lignes if d != INDEX_PAGES and d not in presents}
            for d in partis:
                s.faire("DELETE FROM pages WHERE compte = ? AND deck = ?", g.compte, d)
        return jsonify(pages={d: dict(empreinte=e, niveau=n, maj=m, taille=t) for d, e, n, m, t in lignes if d not in partis})

    @app.get("/pages/lire")
    @connecte
    def lire_page():
        """?deck= : la page (JSON), compressée comme elle est gardée ; son empreinte et son niveau dans les en-têtes."""
        deck = nom_deck(request.args.get("deck"))
        with base.session() as s:
            r = s.un("SELECT empreinte, niveau, contenu FROM pages WHERE compte = ? AND deck = ?", g.compte, deck)
        if not r:
            raise Refus("Page introuvable.", 404)
        contenu = bytes(r[2])
        if "gzip" in request.headers.get("Accept-Encoding", ""):
            rep = Response(contenu, mimetype="application/json")
            rep.headers["Content-Encoding"] = "gzip"
        else:
            rep = Response(gzip.decompress(contenu), mimetype="application/json")
        rep.headers["X-Empreinte"], rep.headers["X-Niveau"] = r[0], str(r[1])
        return rep

    @app.put("/pages")
    @connecte
    def ecrire_page():
        """?deck=&empreinte=&niveau= ; le corps : la page en JSON, compressée (Content-Type: application/gzip) ou non.
        Une page des mêmes fichiers (même empreinte) de niveau plus haut, déjà là, est gardée. {ok, garde}."""
        a = request.args
        deck, empreinte = nom_deck(a.get("deck")), str(a.get("empreinte") or "")
        if not EMPREINTE.match(empreinte):
            raise Refus("Empreinte invalide.")
        try:
            niveau = int(a.get("niveau", ""))
        except ValueError:
            raise Refus("Niveau invalide.") from None
        if not 0 <= niveau <= 9:
            raise Refus("Niveau invalide.")
        corps = request.get_data(cache=False)
        try:
            if request.mimetype == "application/gzip":
                d = zlib.decompressobj(16 + zlib.MAX_WBITS)
                texte = d.decompress(corps, PAGE_TEXTE_MAX + 1)
                if len(texte) > PAGE_TEXTE_MAX or d.unconsumed_tail:
                    raise Refus("Page trop grosse.", 413)
                if not d.eof:
                    raise ValueError
                contenu = corps
            else:
                texte, contenu = corps, gzip.compress(corps, compresslevel=6)
            if not isinstance(json.loads(texte), dict):
                raise ValueError
        except (ValueError, zlib.error):
            raise Refus("Page invalide.") from None
        if len(contenu) > page_max:
            raise Refus("Page trop grosse.", 413)
        with base.session() as s:
            verrouiller(s)
            r = s.un("SELECT empreinte, niveau, taille FROM pages WHERE compte = ? AND deck = ?", g.compte, deck)
            if r and r[0] == empreinte and r[1] > niveau:
                return jsonify(ok=True, garde=True)
            total = int(s.un("SELECT COALESCE(SUM(taille), 0) FROM pages WHERE compte = ?", g.compte)[0])
            if total - (r[2] if r else 0) + len(contenu) > quota_pages:
                raise Refus("Trop de pages gardées pour ce compte.", 413)
            s.faire("REPLACE INTO pages (compte, deck, empreinte, niveau, maj, taille, contenu) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    g.compte, deck, empreinte, niveau, maintenant(), len(contenu), contenu)
        return jsonify(ok=True, garde=False)

    return app


def refaire_pages(reglages):
    """Chaque page publique refaite avec l'interface du moment (app.js, style.css et modèles de la page d'accueil,
    tout juste redéployée) : python serveur.py --refaire-pages, lancé par la tâche qui déploie la page d'accueil."""
    cfg, base = pages.Reglages(reglages["pages"]), Base(reglages["base"])
    with base.session() as s:
        lignes = s.tous("SELECT c.pseudo, p.deck, p.slug, p.resume, p.visibilite FROM partages p "
                        "JOIN comptes c ON c.id = p.compte ORDER BY p.maj DESC")
    par_pseudo = {}
    for pseudo, deck, slug, resume, visibilite in lignes:
        try:
            d = pages.relire(cfg, pseudo, slug)
            jpg = os.path.join(cfg.dossier, pseudo, slug, "partage.jpg")
            image = open(jpg, "rb").read() if os.path.exists(jpg) else None
            pages.ecrire_deck(cfg, pseudo, slug, deck, d, image, (d.get("reglages") or {}).get("budget"),
                              indexer=visibilite == "public")
        except (OSError, ValueError) as e:
            print(f"{pseudo}/{slug} : {e}")
        par_pseudo.setdefault(pseudo, [])
        if visibilite == "public":
            par_pseudo[pseudo].append((deck, slug, json.loads(resume)))
    for pseudo, decks in par_pseudo.items():
        pages.ecrire_pseudo(cfg, pseudo, decks)
    return len(lignes)


if __name__ == "__main__":          # essai local : python serveur.py (réglages de ATELIER_API_REGLAGES)
    if "--refaire-pages" in sys.argv:
        print(refaire_pages(lire_reglages()), "pages refaites")
    else:
        creer(lire_reglages()).run(port=int(os.environ.get("PORT", 5090)))
