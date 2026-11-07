"""Publie une nouvelle version de l'Atelier : les Ateliers installés la proposeront en un clic (outils/atelier/mise_a_jour.py).

  python outils/publier_version.py 1.1.0 "Une ou deux phrases sur les nouveautés."
  python outils/publier_version.py 1.1.0 "…" --sans-envoi      prépare le commit et l'étiquette sans rien envoyer

1. vérifie le numéro (X.Y.Z, plus grand que la version actuelle et que les étiquettes existantes), la branche (main)
   et qu'aucune modification n'attend d'être commitée ;
2. écrit le numéro dans outils/atelier/version.py et le commite (« Version X.Y.Z ») ;
3. pose l'étiquette annotée vX.Y.Z, dont le message (les nouveautés) s'affiche dans le bandeau des Ateliers installés ;
4. envoie le commit et l'étiquette ensemble : git push origin main vX.Y.Z.
Un envoi sur main sans nouvelle étiquette ne propose rien aux Ateliers installés.
"""
import os
import re
import subprocess
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FICHIER = os.path.join(RACINE, "outils", "atelier", "version.py")
FORMAT = re.compile(r"^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass


def git(*args, ok=False):
    r = subprocess.run(["git", "-C", RACINE, *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode and not ok:
        sys.exit(f"ÉCHEC : git {' '.join(args)}\n{(r.stderr or r.stdout).strip()}")
    return r.stdout.strip()


def numero(v):
    m = FORMAT.match(v.lstrip("v"))
    return tuple(int(x) for x in m.groups()) if m else None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        sys.exit(__doc__)
    version, nouveautes = args[0].lstrip("v"), args[1].strip()
    envoyer = "--sans-envoi" not in sys.argv
    if not numero(version):
        sys.exit(f"ÉCHEC : « {version} » n'est pas un numéro de version (X.Y.Z, par exemple 1.1.0).")
    if not nouveautes:
        sys.exit("ÉCHEC : il faut une ou deux phrases sur les nouveautés.")
    with open(FICHIER, encoding="utf-8") as f:
        texte = f.read()
    actuelle = re.search(r'__version__ = "([^"]+)"', texte).group(1)
    if numero(version) <= numero(actuelle):
        sys.exit(f"ÉCHEC : la version {version} n'est pas plus récente que l'actuelle ({actuelle}).")
    tags = [t for t in git("tag", "-l", "v*").split() if numero(t)]
    if tags and numero(version) <= max(numero(t) for t in tags):
        sys.exit(f"ÉCHEC : l'étiquette {max(tags, key=numero)} existe déjà ; choisis un numéro plus grand.")
    branche = git("rev-parse", "--abbrev-ref", "HEAD")
    if branche != "main":
        sys.exit(f"ÉCHEC : on publie depuis la branche main (actuellement : {branche}).")
    if git("status", "--porcelain", "--untracked-files=no"):
        sys.exit("ÉCHEC : des modifications ne sont pas commitées ; commite-les d'abord.")

    with open(FICHIER, "w", encoding="utf-8", newline="\n") as f:
        f.write(texte.replace(f'__version__ = "{actuelle}"', f'__version__ = "{version}"'))
    git("add", FICHIER)
    git("commit", "-q", "-m", f"Version {version}", "-m", nouveautes)
    git("tag", "-a", f"v{version}", "-m", nouveautes)
    print(f"Version {version} : commit et étiquette v{version} prêts.")
    if envoyer:
        git("push", "-q", "origin", "main", f"v{version}")
        print("Envoyée : les Ateliers installés la proposeront d'ici un jour (au lancement, puis toutes les 20 heures).")
    else:
        print(f"Rien n'est envoyé. Pour publier : git push origin main v{version}")


if __name__ == "__main__":
    main()
