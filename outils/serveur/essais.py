"""Essais du serveur des comptes, sur une base SQLite jetable et sans envoyer d'e-mail.

    python outils/serveur/essais.py
Sur o2switch, contre MariaDB : ATELIER_API_ESSAI_BASE="mysql://…" python essais.py (base d'essai vide).
"""
import os
import shutil
import sys
import tempfile
import unittest

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
sys.path.insert(0, os.path.join(os.path.dirname(ICI), "atelier"))

import courriel  # noqa: E402
import serveur  # noqa: E402

APPLI = "https://app.atelier-mtg.com"


class Essais(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.mkdtemp()
        adresse = os.environ.get("ATELIER_API_ESSAI_BASE") or "sqlite:///" + os.path.join(self.dossier, "essai.db")
        if adresse.startswith("mysql://"):
            from base import Base, TABLES
            with Base(adresse).session() as s:
                for t in TABLES:
                    s.faire(f"DROP TABLE IF EXISTS {t}")
        self.reglages = dict(base=adresse, poivre="poivre-essai", origines=[APPLI], courriel={"mode": "memoire"},
                             quota=4000, taille_max=1500)
        self.app = serveur.creer(self.reglages)
        self.c = self.app.test_client()
        courriel.ENVOYES.clear()

    def tearDown(self):
        shutil.rmtree(self.dossier, ignore_errors=True)

    # --- aides ---
    def code(self, email):
        r = self.c.post("/connexion/code", json={"email": email})
        self.assertEqual(r.status_code, 200, r.json)
        return courriel.ENVOYES[-1][1]

    def connecter(self, email="joueur@exemple.fr", appareil="Essai"):
        code = self.code(email)
        r = self.c.post("/connexion/verifier", json={"email": email, "code": code, "appareil": appareil})
        self.assertEqual(r.status_code, 200, r.json)
        return {"Authorization": "Bearer " + r.json["jeton"]}, r.json

    def ecrire(self, h, changements, force=False):
        return self.c.post("/fichiers/ecrire", json={"changements": changements, "force": force}, headers=h)

    # --- connexion ---
    def test_code_et_compte(self):
        code = self.code("  Joueur@Exemple.FR ")
        self.assertEqual(courriel.ENVOYES[-1][0], "joueur@exemple.fr")
        self.assertRegex(code, r"^\d{6}$")
        faux = "000000" if code != "000000" else "111111"
        r = self.c.post("/connexion/verifier", json={"email": "joueur@exemple.fr", "code": faux})
        self.assertEqual((r.status_code, r.json["erreur"]), (400, "Code incorrect."))
        r = self.c.post("/connexion/verifier", json={"email": "JOUEUR@exemple.fr", "code": code[:3] + " " + code[3:]})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json["nouveau"])
        # le code ne sert qu'une fois
        r2 = self.c.post("/connexion/verifier", json={"email": "joueur@exemple.fr", "code": code})
        self.assertEqual(r2.status_code, 400)
        h = {"Authorization": "Bearer " + r.json["jeton"]}
        self.assertEqual(self.c.get("/compte", headers=h).json["email"], "joueur@exemple.fr")
        # deuxième connexion : même compte
        _, j = self.connecter("joueur@exemple.fr")
        self.assertFalse(j["nouveau"])

    def test_essais_limites(self):
        code = self.code("a@exemple.fr")
        faux = "000000" if code != "000000" else "111111"
        for _ in range(serveur.ESSAIS_CODE):
            self.assertEqual(self.c.post("/connexion/verifier", json={"email": "a@exemple.fr", "code": faux}).json["erreur"],
                             "Code incorrect.")
        r = self.c.post("/connexion/verifier", json={"email": "a@exemple.fr", "code": code})
        self.assertEqual(r.json["erreur"], "Trop d'essais : demande un nouveau code.")
        r = self.c.post("/connexion/verifier", json={"email": "a@exemple.fr", "code": code})
        self.assertEqual(r.json["erreur"], "Code expiré : demande un nouveau code.")

    def test_trop_de_codes(self):
        for _ in range(serveur.CODES_PAR_HEURE):
            self.code("b@exemple.fr")
        r = self.c.post("/connexion/code", json={"email": "b@exemple.fr"})
        self.assertEqual(r.status_code, 429)
        self.assertEqual(self.c.post("/connexion/code", json={"email": "pas-une-adresse"}).status_code, 400)

    def test_sans_connexion(self):
        self.assertEqual(self.c.get("/fichiers").status_code, 401)
        self.assertEqual(self.c.get("/fichiers", headers={"Authorization": "Bearer faux"}).status_code, 401)

    # --- fichiers ---
    def test_ecrire_lire_conflits(self):
        h, _ = self.connecter()
        r = self.ecrire(h, [{"chemin": "Deck Kels/archidekt.txt", "contenu": "1x Sol Ring\n", "base": None},
                            {"chemin": "Classeur/classeur.txt", "contenu": "1 Island\n", "base": None}])
        self.assertEqual(r.status_code, 200, r.json)
        sha = r.json["ecrits"]["Deck Kels/archidekt.txt"]
        self.assertEqual(sha, serveur.sha_blob("1x Sol Ring\n"))
        rev = r.json["revision"]
        liste = self.c.get("/fichiers", headers=h).json
        self.assertEqual(liste["fichiers"]["Deck Kels/archidekt.txt"], sha)
        self.assertTrue(self.c.get(f"/fichiers?revision={rev}", headers=h).json["inchange"])
        # un autre appareil écrit par-dessus : la base périmée donne un conflit, rien n'est touché
        r = self.ecrire(h, [{"chemin": "Deck Kels/archidekt.txt", "contenu": "1x Arcane Signet\n", "base": sha}])
        sha2 = r.json["ecrits"]["Deck Kels/archidekt.txt"]
        r = self.ecrire(h, [{"chemin": "Deck Kels/archidekt.txt", "contenu": "1x Mind Stone\n", "base": sha}])
        self.assertEqual(r.json["conflits"], {"Deck Kels/archidekt.txt": sha2})
        self.assertEqual(r.json["ecrits"], {})
        lu = self.c.post("/fichiers/lire", json={"chemins": ["Deck Kels/archidekt.txt", "Absent/x"]}, headers=h).json
        self.assertEqual(lu["fichiers"], {"Deck Kels/archidekt.txt": "1x Arcane Signet\n"})
        # même contenu : pas un conflit
        r = self.ecrire(h, [{"chemin": "Deck Kels/archidekt.txt", "contenu": "1x Arcane Signet\n", "base": "vieux"}])
        self.assertEqual(r.json["conflits"], {})
        # force : écrit quand même (l'Atelier du PC qui envoie)
        r = self.ecrire(h, [{"chemin": "Deck Kels/archidekt.txt", "contenu": "1x Mind Stone\n", "base": sha}], force=True)
        self.assertIn("Deck Kels/archidekt.txt", r.json["ecrits"])
        # effacer
        r = self.ecrire(h, [{"chemin": "Classeur/classeur.txt", "contenu": None,
                             "base": serveur.sha_blob("1 Island\n")}])
        self.assertIsNone(r.json["ecrits"]["Classeur/classeur.txt"])
        self.assertNotIn("Classeur/classeur.txt", self.c.get("/fichiers", headers=h).json["fichiers"])
        self.assertEqual(self.c.get("/compte", headers=h).json["octets"], len("1x Mind Stone\n"))

    def test_comptes_separes(self):
        h1, _ = self.connecter("un@exemple.fr")
        h2, _ = self.connecter("deux@exemple.fr")
        self.ecrire(h1, [{"chemin": "Deck A/archidekt.txt", "contenu": "x", "base": None}])
        self.assertEqual(self.c.get("/fichiers", headers=h2).json["fichiers"], {})

    def test_chemins_refuses(self):
        h, _ = self.connecter()
        for c in ["../x/y", "Deck/../../x", "a\\b/c", "C:/x/y", "Deck/.git", ".cache/x", "seul", "Deck//x", "Deck/ x",
                  "/Deck/x", "Deck/x\n", "", None, 3]:
            r = self.ecrire(h, [{"chemin": c, "contenu": "x", "base": None}])
            self.assertEqual(r.status_code, 400, c)
        r = self.ecrire(h, [{"chemin": "Deck Ça/archidekt.txt", "contenu": "x", "base": None}] * 2)
        self.assertEqual(r.status_code, 400)

    def test_tailles(self):
        h, _ = self.connecter()
        r = self.ecrire(h, [{"chemin": "Deck A/gros.txt", "contenu": "x" * 1600, "base": None}])
        self.assertEqual(r.status_code, 413)
        ok = [{"chemin": f"Deck A/f{i}.txt", "contenu": "é" * 700, "base": None} for i in range(2)]   # 2 × 1400 octets
        self.assertEqual(self.ecrire(h, ok).status_code, 200)
        r = self.ecrire(h, [{"chemin": "Deck A/f9.txt", "contenu": "é" * 700, "base": None}])
        self.assertEqual(r.status_code, 413)
        self.assertNotIn("Deck A/f9.txt", self.c.get("/fichiers", headers=h).json["fichiers"])

    # --- compte ---
    def test_export_lisible_par_le_pc(self):
        import decks
        h, _ = self.connecter()
        self.ecrire(h, [{"chemin": "Deck Kels/archidekt.txt", "contenu": "1x Sol Ring\n", "base": None},
                        {"chemin": "Deck Kels/historique/2026-11-14_120000.txt", "contenu": "1x Island\n", "base": None}])
        r = self.c.get("/compte/export", headers=h)
        self.assertIn("attachment", r.headers["Content-Disposition"])
        self.assertEqual(decks.lire_appli(r.get_data(as_text=True)),
                         {"Deck Kels/archidekt.txt": "1x Sol Ring\n",
                          "Deck Kels/historique/2026-11-14_120000.txt": "1x Island\n"})

    def test_appareils_et_suppression(self):
        h1, _ = self.connecter(appareil="PC")
        h2, _ = self.connecter(appareil="iPhone · Safari")
        apps = self.c.get("/appareils", headers=h1).json["appareils"]
        self.assertEqual(sorted(a["appareil"] for a in apps), ["PC", "iPhone · Safari"])
        autre = next(a for a in apps if not a["courant"])
        self.assertEqual(self.c.delete(f"/appareils/{autre['id']}", headers=h1).status_code, 200)
        self.assertEqual(self.c.get("/compte", headers=h2).status_code, 401)
        self.ecrire(h1, [{"chemin": "Deck A/archidekt.txt", "contenu": "x", "base": None}])
        self.assertEqual(self.c.delete("/compte", json={"email": "autre@exemple.fr"}, headers=h1).status_code, 400)
        self.assertEqual(self.c.delete("/compte", json={"email": "Joueur@exemple.fr"}, headers=h1).status_code, 200)
        self.assertEqual(self.c.get("/compte", headers=h1).status_code, 401)
        h3, j = self.connecter()
        self.assertTrue(j["nouveau"])
        self.assertEqual(self.c.get("/fichiers", headers=h3).json["fichiers"], {})

    def test_deconnexion(self):
        h, _ = self.connecter()
        self.assertEqual(self.c.post("/deconnexion", headers=h).status_code, 200)
        self.assertEqual(self.c.get("/compte", headers=h).status_code, 401)

    def test_cors(self):
        r = self.c.options("/fichiers", headers={"Origin": APPLI, "Access-Control-Request-Method": "GET",
                                                 "Access-Control-Request-Headers": "authorization"})
        self.assertEqual(r.headers.get("Access-Control-Allow-Origin"), APPLI)
        self.assertIn("Authorization", r.headers.get("Access-Control-Allow-Headers"))
        r = self.c.get("/", headers={"Origin": "https://ailleurs.example"})
        self.assertIsNone(r.headers.get("Access-Control-Allow-Origin"))

    def test_message(self):
        m = courriel.message({"expediteur": "ne-pas-repondre@atelier-mtg.com"}, "a@exemple.fr", "123456")
        self.assertEqual(m["Subject"], "123456 : ton code Atelier MTG")
        self.assertIn("123456", m.get_content())
        self.assertIn("atelier-mtg.com", m["Message-ID"])


STATIQUE = os.path.join(os.path.dirname(ICI), "atelier", "static")
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 100


def donnees(deck, titre="Kels", **en_plus):
    """Ce qu'envoie partage.capturer, en tout petit."""
    d = {"titre": titre, "commandants": ["Kels, Fight Fixer"], "identite": ["U", "B"], "total": 100, "prix_total": 176.7,
         "cartes": [{"nom": "Kels, Fight Fixer", "cat": "Commander", "info": {"fr": "", "image": "https://cards.scryfall.io/k.jpg"}},
                    {"nom": "Sol Ring", "cat": "Artefacts", "info": {"fr": "Anneau solaire"}}], **en_plus}
    return {"deck": deck, "date": 1, "version": "2.2.0",
            "api": {f"/api/decks/{deck}": d, f"/api/decks/{deck}/bracket": {"estime": 3},
                    f"/api/decks/{deck}/achats": {"possedees": {"Sol Ring": 1}}, "/api/recherche/fonctions": [["ramp", "Ramp"]]}}


class EssaisBase(unittest.TestCase):
    def test_colonne_ajoutee(self):
        """Une base d'avant la visibilité des pages : la colonne est ajoutée, les pages gardées (publiques)."""
        from base import Base
        d = tempfile.mkdtemp()
        try:
            import sqlite3
            f = os.path.join(d, "ancienne.db")
            c = sqlite3.connect(f)
            c.execute("CREATE TABLE partages (compte BIGINT NOT NULL, deck VARCHAR(200) NOT NULL, slug VARCHAR(80) NOT NULL, "
                      "maj BIGINT NOT NULL, resume TEXT NOT NULL, PRIMARY KEY (compte, deck), UNIQUE (compte, slug))")
            c.execute("INSERT INTO partages VALUES (1, 'Deck Kels', 'kels', 1, '{}')")
            c.commit()
            c.close()
            b = Base("sqlite:///" + f)
            b.creer_tables()
            b.creer_tables()                                                              # une deuxième fois : rien à faire
            with b.session() as s:
                self.assertEqual(s.un("SELECT deck, visibilite FROM partages"), ("Deck Kels", "public"))
        finally:
            shutil.rmtree(d, ignore_errors=True)


class EssaisPages(unittest.TestCase):
    """Les pages publiques des decks (pages.py)."""
    code, connecter, tearDown = Essais.code, Essais.connecter, Essais.tearDown

    def setUp(self):
        Essais.setUp(self)
        self.pages = os.path.join(self.dossier, "decks")
        self.reglages["pages"] = dict(dossier=self.pages, url="https://atelier-mtg.com/decks/", modeles=STATIQUE,
                                      interface=STATIQUE, interface_url="/fr/")
        self.app = serveur.creer(self.reglages)
        self.c = self.app.test_client()

    def lire(self, *parts):
        with open(os.path.join(self.pages, *parts), encoding="utf-8") as f:
            return f.read()

    def partager(self, h, deck="Deck Kels", **kw):
        import base64
        corps = {"deck": deck, "donnees": kw.pop("d", None) or donnees(deck), "image": base64.b64encode(JPEG).decode(), **kw}
        return self.c.post("/partages", json=corps, headers=h)

    def test_visibilite_et_adresse(self):
        h, _ = self.connecter()
        self.c.post("/compte/pseudo", json={"pseudo": "joueur"}, headers=h)
        r = self.partager(h, slug="mon-kels")
        self.assertEqual((r.json["slug"], r.json["visibilite"]), ("mon-kels", "public"))
        page = self.lire("joueur", "mon-kels", "index.html")
        self.assertNotIn('content="noindex"', page)
        self.assertIn('c.pseudo === "joueur"', page)                                   # le propriétaire va dans l'appli
        self.assertIn('const d = "Deck Kels"', page)
        # non répertoriée : noindex, hors du plan du site et de la page du pseudo ; une adresse déjà prise n'est pas reprise
        r = self.partager(h, deck="Deck Sefris", d=donnees("Deck Sefris", titre="Sefris"), visibilite="non-repertorie", slug="mon-kels")
        self.assertEqual((r.json["slug"], r.json["visibilite"]), ("sefris", "non-repertorie"))
        self.assertIn('<meta name="robots" content="noindex">', self.lire("joueur", "sefris", "index.html"))
        self.assertNotIn("joueur/sefris/", self.lire("sitemap.xml"))
        self.assertNotIn("Deck Sefris", self.lire("joueur", "donnees.js"))
        self.assertIn('c.pseudo === "joueur"', self.lire("joueur", "index.html"))
        # devenue publique : même adresse (celle d'une page ne change pas), dans le plan du site
        r = self.partager(h, deck="Deck Sefris", d=donnees("Deck Sefris", titre="Sefris"), slug="autre")
        self.assertEqual((r.json["slug"], r.json["visibilite"]), ("sefris", "public"))
        self.assertIn("joueur/sefris/", self.lire("sitemap.xml"))
        self.assertIn("Deck Sefris", self.lire("joueur", "donnees.js"))
        self.assertEqual(self.partager(h, visibilite="prive").status_code, 400)          # privé : on retire la page
        l = {x["deck"]: (x["slug"], x["visibilite"]) for x in self.c.get("/partages", headers=h).json["partages"]}
        self.assertEqual(l, {"Deck Kels": ("mon-kels", "public"), "Deck Sefris": ("sefris", "public")})
        for mauvais in ("Mon Kels", "a--b", "decks", "-x"):                                # adresse invalide : celle du nom
            r = self.partager(h, deck=f"Deck {mauvais}", d=donnees(f"Deck {mauvais}"), slug=mauvais)
            self.assertNotEqual(r.json["slug"], mauvais)

    def test_connexion_donnee_a_un_appareil(self):
        self.assertEqual(self.c.post("/connexion/appareil", json={"appareil": "PC"}).status_code, 401)
        h, _ = self.connecter()
        self.c.post("/compte/pseudo", json={"pseudo": "pierre"}, headers=h)
        r = self.c.post("/connexion/appareil", json={"appareil": "Module Claude · PC\x07"}, headers=h)
        self.assertEqual((r.status_code, r.json["email"], r.json["pseudo"]), (200, "joueur@exemple.fr", "pierre"))
        h2 = {"Authorization": "Bearer " + r.json["jeton"]}
        self.assertEqual(self.c.get("/compte", headers=h2).json["email"], "joueur@exemple.fr")
        noms = [a["appareil"] for a in self.c.get("/appareils", headers=h).json["appareils"]]
        self.assertIn("Module Claude · PC", noms)
        self.c.post("/deconnexion", json={}, headers=h)                       # le site se déconnecte : le module reste
        self.assertEqual(self.c.get("/compte", headers=h2).status_code, 200)
        self.assertEqual(self.c.get("/compte", headers=h).status_code, 401)

    def test_pseudo_a_l_inscription(self):
        h, r = self.connecter()
        self.assertIsNone(r["pseudo"])
        for mauvais in ("", "ab", "Pierre!", "-pierre", "admin", "decks", "a" * 31):
            self.assertEqual(self.c.post("/compte/pseudo", json={"pseudo": mauvais}, headers=h).status_code, 409, mauvais)
        r = self.c.post("/compte/pseudo", json={"pseudo": " Pierre-MTG "}, headers=h)
        self.assertEqual((r.status_code, r.json["pseudo"]), (200, "pierre-mtg"))
        self.assertEqual(self.c.post("/compte/pseudo", json={"pseudo": "pierre-mtg"}, headers=h).status_code, 200)   # le même
        r = self.c.post("/compte/pseudo", json={"pseudo": "autre"}, headers=h)
        self.assertEqual((r.status_code, r.json["erreur"]), (409, "Ton pseudo est déjà choisi."))
        self.assertEqual(self.c.get("/compte", headers=h).json["pseudo"], "pierre-mtg")
        self.assertEqual(self.connecter()[1]["pseudo"], "pierre-mtg")              # renvoyé à la connexion
        h2, _ = self.connecter("autre@exemple.fr")
        r = self.c.post("/compte/pseudo", json={"pseudo": "pierre-mtg"}, headers=h2)
        self.assertEqual((r.status_code, r.json["erreur"]), (409, "Ce pseudo est déjà pris : choisis-en un autre."))
        r = self.partager(h)                                                         # plus de pseudo à donner au partage
        self.assertEqual((r.status_code, r.json["url"]), (200, "https://atelier-mtg.com/decks/pierre-mtg/kels/"))

    def test_partager(self):
        h, _ = self.connecter()
        r = self.partager(h)
        self.assertEqual(r.status_code, 409)
        self.assertTrue(r.json["pseudo_requis"])
        for mauvais in ("ab", "Pierre!", "-pierre", "admin", "decks", "a" * 31):
            self.assertEqual(self.partager(h, pseudo=mauvais).status_code, 409, mauvais)
        r = self.partager(h, pseudo="Pierre-MTG")
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(r.json["url"], "https://atelier-mtg.com/decks/pierre-mtg/kels/")
        page = self.lire("pierre-mtg", "kels", "index.html")
        self.assertIn("<title>Kels : deck Commander Dimir, par pierre-mtg</title>", page)
        self.assertIn('href="/fr/style.css?v=', page)
        self.assertIn('<script src="/fr/app.js?v=', page)
        self.assertIn("partage.jpg?v=", page)
        self.assertNotIn("/static/", page)
        self.assertNotIn("noindex", page)
        js = self.lire("pierre-mtg", "kels", "donnees.js")
        self.assertNotIn("achats", js)                                 # ce qu'on possède n'est jamais public
        self.assertIn('"auteur":"pierre-mtg"', js)
        self.assertIn("noindex", self.lire("pierre-mtg", "kels", "jouer", "index.html"))
        self.assertTrue(os.path.exists(os.path.join(self.pages, "pierre-mtg", "kels", "partage.jpg")))
        self.assertIn('"liens":{"Deck Kels":"kels/"}', self.lire("pierre-mtg", "donnees.js"))
        plan = self.lire("sitemap.xml")
        self.assertIn("<loc>https://atelier-mtg.com/decks/pierre-mtg/</loc>", plan)
        self.assertIn("<loc>https://atelier-mtg.com/decks/pierre-mtg/kels/</loc>", plan)
        # republier : même adresse ; un autre deck au même nom de dossier : une autre adresse
        self.assertEqual(self.partager(h).json["url"], "https://atelier-mtg.com/decks/pierre-mtg/kels/")
        self.assertEqual(self.partager(h, deck="Deck  Kels!").json["url"], "https://atelier-mtg.com/decks/pierre-mtg/kels-2/")
        l = self.c.get("/partages", headers=h).json
        self.assertEqual(l["pseudo"], "pierre-mtg")
        self.assertEqual(sorted(x["deck"] for x in l["partages"]), ["Deck  Kels!", "Deck Kels"])
        # le pseudo d'un autre compte
        h2, _ = self.connecter("autre@exemple.fr")
        r = self.partager(h2, pseudo="pierre-mtg")
        self.assertEqual(r.status_code, 409)
        self.assertIn("déjà pris", r.json["erreur"])

    def test_texte_neutralise(self):
        h, _ = self.connecter()
        d = donnees("Deck X", titre='<script>alert("x")</script>', note="javascript:alert(1)")
        r = self.partager(h, deck="Deck X", d=d, pseudo="joueur")
        self.assertEqual(r.status_code, 200, r.json)
        js, page = self.lire("joueur", "x", "donnees.js"), self.lire("joueur", "x", "index.html")
        self.assertNotIn("<script>alert", js)
        self.assertNotIn("javascript:", js)
        self.assertNotIn("<script>alert", page)
        self.assertIn("‹script›", js)

    def test_refus(self):
        h, _ = self.connecter()
        self.assertEqual(self.partager(h, pseudo="joueur", image="pas-du-base64!").status_code, 400)
        import base64
        r = self.c.post("/partages", json={"deck": "Deck K", "donnees": donnees("Deck K"), "pseudo": "joueur",
                                           "image": base64.b64encode(b"GIF89a" + b"0" * 10).decode()}, headers=h)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.c.post("/partages", json={"deck": "Deck K", "donnees": {"api": {}}, "pseudo": "joueur"},
                                     headers=h).status_code, 400)
        self.assertEqual(self.c.post("/partages", json={"deck": "", "donnees": donnees("")}, headers=h).status_code, 400)
        self.assertEqual(self.c.post("/partages", json={"deck": "Deck K"}).status_code, 401)

    def test_retirer_renommer_supprimer(self):
        h, _ = self.connecter()
        self.partager(h, pseudo="joueur")
        self.partager(h, deck="Deck Tromo")
        self.c.post("/partages/renommer", json={"ancien": "Deck Kels", "nouveau": "Deck Kels II"}, headers=h)
        self.assertEqual(self.partager(h, deck="Deck Kels II", d=donnees("Deck Kels II")).json["url"],
                         "https://atelier-mtg.com/decks/joueur/kels/")          # la page garde son adresse
        self.c.post("/partages/retirer", json={"deck": "Deck Tromo"}, headers=h)
        self.assertFalse(os.path.exists(os.path.join(self.pages, "joueur", "tromo")))
        self.assertNotIn("tromo", self.lire("sitemap.xml"))
        self.assertIn("joueur/kels/", self.lire("sitemap.xml"))
        self.c.post("/partages/retirer", json={"deck": "Deck Kels II"}, headers=h)
        self.assertFalse(os.path.exists(os.path.join(self.pages, "joueur")))   # plus aucun deck : plus de page du pseudo
        self.partager(h)
        r = self.c.delete("/compte", json={"email": "joueur@exemple.fr"}, headers=h)
        self.assertEqual(r.status_code, 200)
        self.assertFalse(os.path.exists(os.path.join(self.pages, "joueur")))   # le compte supprimé emporte ses pages
        self.assertNotIn("joueur", self.lire("sitemap.xml"))

    def test_refaire_pages(self):
        h, _ = self.connecter()
        self.partager(h, pseudo="joueur")
        p = os.path.join(self.pages, "joueur", "kels", "index.html")
        with open(p, "w", encoding="utf-8") as f:
            f.write("ancienne interface")
        self.assertEqual(serveur.refaire_pages(self.reglages), 1)
        self.assertIn("<title>Kels : deck Commander Dimir, par joueur</title>", self.lire("joueur", "kels", "index.html"))
        self.assertIn("partage.jpg?v=", self.lire("joueur", "kels", "index.html"))

    def test_sans_pages(self):
        del self.reglages["pages"]
        c = serveur.creer(self.reglages).test_client()
        h, _ = self.connecter()
        self.assertEqual(c.post("/partages", json={"deck": "Deck K", "donnees": donnees("Deck K")}, headers=h).status_code, 503)


if __name__ == "__main__":
    unittest.main(verbosity=1)
