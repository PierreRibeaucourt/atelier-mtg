"""Installe l'Atelier MTG sur ce PC, ou le remet à jour après un « git pull ». On peut le relancer sans risque.

  python installer.py                       installe
  python installer.py --budget 10           budget par carte, en euros (0 = pas d'alerte ; 5 par défaut)
  python installer.py --github MonCompte    compte GitHub où publier les decks partagés
  python installer.py --sans-raccourci      sans raccourci sur le bureau

Étapes, toutes dans ce dossier sauf le raccourci :
1. vérifie Python (3.10 ou plus récent) ;
2. crée l'environnement .venv et y installe les dépendances (requirements.txt) ;
3. écrit les réglages demandés dans reglages.json ;
4. vérifie que l'Atelier démarre (sans ouvrir de page ni rien télécharger) ;
5. crée le raccourci « Atelier MTG » sur le bureau ;
6. dit ce qui manque pour les fonctions facultatives : discussion avec Claude, partage des decks.
"""
import argparse
import os
import shutil
import subprocess
import sys

RACINE = os.path.dirname(os.path.abspath(__file__))
WINDOWS = os.name == "nt"
MAC = sys.platform == "darwin"
VENV = os.path.join(RACINE, ".venv")
PY_VENV = os.path.join(VENV, "Scripts", "python.exe") if WINDOWS else os.path.join(VENV, "bin", "python")
ATELIER = os.path.join(RACINE, "outils", "atelier")
sys.path[:0] = [ATELIER, os.path.join(RACINE, "outils")]
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass


class Echec(Exception):
    pass


def etape(texte):
    print(f"\n» {texte}", flush=True)


def lancer(cmd, **kw):
    r = subprocess.run(cmd, cwd=RACINE, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)
    return r.returncode, (r.stdout + r.stderr).strip()


# ---------------------------------------------------------------- 1-2. Python et dépendances
def verifier_python():
    etape("Python")
    if sys.version_info < (3, 10):
        raise Echec(f"Python {sys.version.split()[0]} est trop ancien : il faut Python 3.10 ou plus récent (python.org).")
    print(f"  Python {sys.version.split()[0]} : OK")


def environnement():
    etape("Environnement Python (.venv) et dépendances")
    if not os.path.isfile(PY_VENV):
        code, sortie = lancer([sys.executable, "-m", "venv", VENV])
        if code:
            conseil = "\n  Sur Debian ou Ubuntu : sudo apt install python3-venv" if not (WINDOWS or MAC) else ""
            raise Echec(f"Impossible de créer .venv :\n{sortie[-800:]}{conseil}")
        print("  .venv créé")
    code, sortie = lancer([PY_VENV, "-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", "requirements.txt"])
    if code:
        raise Echec(f"Installation des dépendances impossible :\n{sortie[-1500:]}")
    print("  Dépendances installées : " + ", ".join(l.strip() for l in open(os.path.join(RACINE, "requirements.txt"), encoding="utf-8")
                                                if l.strip() and not l.startswith("#")))


# ---------------------------------------------------------------- 3. réglages
def regler(budget, github):
    import reglages
    etape("Réglages (reglages.json)")
    if budget is not None or github is not None:
        reglages.ecrire(**({"budget": budget} if budget is not None else {}),
                        **({"github": github.strip().lstrip("@") or None} if github is not None else {}))
    b = reglages.budget_texte()
    print(f"  Budget par carte : {b or 'aucun (pas d’alerte)'}")
    print(f"  Compte GitHub du partage : {reglages.github() or 'aucun (partage désactivé)'}")


# ---------------------------------------------------------------- 4. vérification
ESSAI = r"""
import sys
sys.path[:0] = ["outils/atelier", "outils"]
import PIL, app
app.en_fond = lambda *a, **k: None          # pas de tâche de fond (mise à jour du bracket) coupée à la sortie
c = app.app.test_client()
for url, attendu in (("/", b"Atelier MTG"), ("/static/app.js", b"PARTAGE"), ("/reglages.js", b"window.REGLAGES"), ("/api/decks", b"[")):
    r = c.get(url)
    assert r.status_code == 200 and attendu in r.data[:4000], f"{url} : {r.status_code}"
print("ok")
"""


def verifier():
    etape("Vérification de l'Atelier")
    code, sortie = lancer([PY_VENV, "-c", ESSAI], timeout=300)
    if code or not sortie.endswith("ok"):
        raise Echec(f"L'Atelier ne démarre pas :\n{sortie[-1500:]}")
    print("  L'Atelier démarre : OK")


# ---------------------------------------------------------------- 5. raccourci
def icone(extension):
    """L'icône du chaudron (outils/atelier/atelier.ico ou .png), dessinée par Pillow ; None si le dessin échoue."""
    chemin = os.path.join(ATELIER, "atelier." + extension)
    script = ("import sys; sys.path[:0] = ['outils/atelier', 'outils']; import image_partage as ip; "
              f"im = ip._chaudron(256); im.save(sys.argv[1]{', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]' if extension == 'ico' else ''})")
    code, _ = lancer([PY_VENV, "-c", script, chemin])
    return chemin if code == 0 and os.path.isfile(chemin) else None


def bureau():
    if WINDOWS:
        code, sortie = lancer(["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"])
        if code == 0 and sortie and os.path.isdir(sortie.splitlines()[-1]):
            return sortie.splitlines()[-1]
    else:
        code, sortie = lancer(["xdg-user-dir", "DESKTOP"]) if shutil.which("xdg-user-dir") else (1, "")
        if code == 0 and os.path.isdir(sortie):
            return sortie
    d = os.path.join(os.path.expanduser("~"), "Desktop")
    return d if os.path.isdir(d) else None


def raccourci(dossier):
    etape("Raccourci sur le bureau")
    dossier = dossier or bureau()
    if not dossier:
        print("  Bureau introuvable : pas de raccourci (lance l'Atelier avec « Atelier MTG.bat » ou « atelier.sh »).")
        return
    if WINDOWS:                    # pythonw, sans fenêtre : l'Atelier se range dans la barre d'état (le chaudron)
        lien = os.path.join(dossier, "Atelier MTG.lnk")
        env = dict(os.environ, LIEN=lien, CIBLE=os.path.join(VENV, "Scripts", "pythonw.exe"),
                   ARGS=f'"{os.path.join(ATELIER, "app.py")}"', DOSSIER=RACINE,
                   ICONE=icone("ico") or r"%SystemRoot%\System32\shell32.dll,13")
        code, sortie = lancer(["powershell", "-NoProfile", "-Command",
                               "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LIEN); $s.TargetPath = $env:CIBLE; "
                               "$s.Arguments = $env:ARGS; $s.WorkingDirectory = $env:DOSSIER; $s.IconLocation = $env:ICONE; "
                               "$s.Description = 'Atelier MTG'; $s.Save()"], env=env)
        if code:
            raise Echec(f"Raccourci impossible :\n{sortie[-800:]}")
    elif MAC:
        lien = os.path.join(dossier, "Atelier MTG.command")
        with open(lien, "w", encoding="utf-8") as f:
            f.write(f'#!/bin/sh\nexec "{os.path.join(RACINE, "atelier.sh")}"\n')
        os.chmod(lien, 0o755)
    else:
        lien = os.path.join(dossier, "atelier-mtg.desktop")
        png = icone("png")
        with open(lien, "w", encoding="utf-8") as f:
            f.write("[Desktop Entry]\nType=Application\nName=Atelier MTG\n"
                    f'Exec="{os.path.join(RACINE, "atelier.sh")}"\nPath={RACINE}\nTerminal=true\n' + (f"Icon={png}\n" if png else ""))
        os.chmod(lien, 0o755)
    if not WINDOWS:
        os.chmod(os.path.join(RACINE, "atelier.sh"), 0o755)
    print(f"  {lien}")


# ---------------------------------------------------------------- 6. fonctions facultatives
def facultatif():
    import discussion
    import reglages
    etape("Fonctions facultatives")
    claude = discussion.trouver_claude()
    if claude:
        print(f"  Discussion avec Claude : Claude Code trouvé ({claude}).")
        print("    Il doit être connecté à un compte Claude : lancer « claude » une fois dans un terminal si ce n'est pas fait.")
    else:
        print("  Discussion avec Claude : Claude Code introuvable. Pour l'activer (abonnement Claude nécessaire) :")
        print("    " + ("irm https://claude.ai/install.ps1 | iex      (PowerShell)" if WINDOWS
                        else "curl -fsSL https://claude.ai/install.sh | bash"))
        print("    puis « claude » une fois dans un terminal pour se connecter. Le reste de l'Atelier marche sans.")
    if not shutil.which("git"):
        print("  Partage des decks : git introuvable (git-scm.com). Le reste de l'Atelier marche sans.")
    elif not reglages.github():
        print("  Partage des decks : désactivé. Pour l'activer, voir AGENTS.md (« Partager des decks »).")
    else:
        print(f"  Partage des decks : compte {reglages.github()}. Le dépôt GitHub « decks » doit exister, avec GitHub Pages "
              "activé (voir AGENTS.md).")


def main():
    p = argparse.ArgumentParser(description="Installe l'Atelier MTG sur ce PC.")
    p.add_argument("--budget", type=float, help="budget par carte en euros (0 = pas d'alerte)")
    p.add_argument("--github", help="compte GitHub pour partager des decks (vide pour retirer)")
    p.add_argument("--sans-raccourci", action="store_true", help="ne pas créer de raccourci sur le bureau")
    p.add_argument("--bureau", help=argparse.SUPPRESS)                 # autre dossier pour le raccourci (essais)
    a = p.parse_args()
    try:
        verifier_python()
        environnement()
        regler(a.budget, a.github)
        verifier()
        if not a.sans_raccourci:
            raccourci(a.bureau)
        facultatif()
    except Echec as e:
        print(f"\nÉCHEC : {e}")
        return 1
    lanceur = ("le raccourci « Atelier MTG » du bureau, ou « Atelier MTG.bat ». Il se range dans la barre d'état, près de\n"
               "l'horloge (le chaudron) : clic pour ouvrir la page, clic droit › Quitter pour l'arrêter" if WINDOWS
               else "« ./atelier.sh » (ou le raccourci du bureau)")
    print(f"\nInstallation terminée. Pour lancer l'Atelier : {lanceur}.\n"
          "La page s'ouvre sur http://127.0.0.1:5000. Au premier lancement, l'Atelier télécharge la base des cartes de Scryfall\n"
          "(environ 80 Mo, puis 15 minutes pour les noms français) : la recherche de cartes est prête ensuite, le reste tout de suite.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
