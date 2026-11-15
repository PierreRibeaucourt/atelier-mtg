"""Base de données du serveur des comptes : SQLite pour les essais, MariaDB/MySQL en ligne, avec le même SQL.

Adresse : « sqlite:///chemin/du/fichier.db » ou « mysql://utilisateur:mot-de-passe@hôte/base ».
Le SQL est écrit avec des « ? » ; pour MySQL ils deviennent des « %s ». Pas de « % » littéral dans les requêtes.
"""
import contextlib
import sqlite3
import urllib.parse

# colonnes de chaque table ; {pk} et {texte} changent selon le moteur
TABLES = {
    "comptes": "id {pk}, email VARCHAR(254) NOT NULL UNIQUE, pseudo VARCHAR(40) UNIQUE, cree BIGINT NOT NULL, "
               "vu BIGINT NOT NULL, revision BIGINT NOT NULL DEFAULT 0, octets BIGINT NOT NULL DEFAULT 0",
    "codes": "email VARCHAR(254) NOT NULL PRIMARY KEY, empreinte CHAR(64) NOT NULL, expire BIGINT NOT NULL, "
             "essais INT NOT NULL DEFAULT 0",
    "envois": "cle VARCHAR(300) NOT NULL, quand BIGINT NOT NULL",
    "sessions": "id {pk}, compte BIGINT NOT NULL, empreinte CHAR(64) NOT NULL UNIQUE, appareil VARCHAR(80) NOT NULL, "
                "cree BIGINT NOT NULL, vu BIGINT NOT NULL",
    "fichiers": "compte BIGINT NOT NULL, chemin VARCHAR(400) NOT NULL, contenu {texte} NOT NULL, sha CHAR(40) NOT NULL, "
                "taille INT NOT NULL, maj BIGINT NOT NULL, PRIMARY KEY (compte, chemin)",
    "partages": "compte BIGINT NOT NULL, deck VARCHAR(200) NOT NULL, slug VARCHAR(80) NOT NULL, maj BIGINT NOT NULL, "
                "resume {texte} NOT NULL, visibilite VARCHAR(20) NOT NULL DEFAULT 'public', "
                "PRIMARY KEY (compte, deck), UNIQUE (compte, slug)",
}
# les colonnes venues après la création des tables : ajoutées à une base qui ne les a pas encore
AJOUTS = {"partages": {"visibilite": "VARCHAR(20) NOT NULL DEFAULT 'public'"}}
INDEX = {"envois": "cle, quand", "sessions": "compte"}


class Base:
    def __init__(self, adresse):
        self.adresse = adresse
        self.mysql = adresse.startswith("mysql://")
        if not self.mysql and not adresse.startswith("sqlite:///"):
            raise ValueError("adresse de base inconnue : sqlite:///… ou mysql://…")

    def _ouvrir(self):
        if self.mysql:
            import pymysql
            a = urllib.parse.urlsplit(self.adresse)
            return pymysql.connect(host=a.hostname or "localhost", port=a.port or 3306,
                                   user=urllib.parse.unquote(a.username or ""),
                                   password=urllib.parse.unquote(a.password or ""),
                                   database=a.path.lstrip("/"), charset="utf8mb4", autocommit=False)
        c = sqlite3.connect(self.adresse[len("sqlite:///"):], timeout=15)
        c.execute("PRAGMA journal_mode=WAL")
        return c

    @contextlib.contextmanager
    def session(self):
        """Une transaction : validée à la sortie, annulée sur une erreur."""
        c = self._ouvrir()
        try:
            yield Curseur(c, self.mysql)
            c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()

    def creer_tables(self):
        pk = "BIGINT AUTO_INCREMENT PRIMARY KEY" if self.mysql else "INTEGER PRIMARY KEY AUTOINCREMENT"
        texte = "MEDIUMTEXT" if self.mysql else "TEXT"
        fin = " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin" if self.mysql else ""
        with self.session() as s:
            for nom, colonnes in TABLES.items():
                s.faire(f"CREATE TABLE IF NOT EXISTS {nom} ({colonnes.format(pk=pk, texte=texte)}){fin}")
            for nom, ajouts in AJOUTS.items():
                if self.mysql:
                    vues = {x for (x,) in s.tous("SELECT column_name FROM information_schema.columns WHERE table_schema = "
                                                 "DATABASE() AND table_name = ?", nom)}
                else:
                    vues = {x[1] for x in s.tous(f"PRAGMA table_info({nom})")}
                for col, definition in ajouts.items():
                    if col not in vues:
                        s.faire(f"ALTER TABLE {nom} ADD COLUMN {col} {definition}")
            for nom, colonnes in INDEX.items():
                if self.mysql:
                    if not s.un("SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() "
                                "AND table_name = ? AND index_name = ?", nom, f"i_{nom}"):
                        s.faire(f"CREATE INDEX i_{nom} ON {nom} ({colonnes})")
                else:
                    s.faire(f"CREATE INDEX IF NOT EXISTS i_{nom} ON {nom} ({colonnes})")


class Curseur:
    def __init__(self, connexion, mysql):
        self.c, self.mysql = connexion, mysql

    def _exec(self, sql, p):
        cur = self.c.cursor()
        cur.execute(sql.replace("?", "%s") if self.mysql else sql, p)
        return cur

    def faire(self, sql, *p):
        """Exécute ; renvoie le nombre de lignes touchées."""
        return self._exec(sql, p).rowcount

    def inserer(self, sql, *p):
        """Exécute un INSERT ; renvoie l'id créé."""
        return self._exec(sql, p).lastrowid

    def un(self, sql, *p):
        return self._exec(sql, p).fetchone()

    def tous(self, sql, *p):
        return self._exec(sql, p).fetchall()
