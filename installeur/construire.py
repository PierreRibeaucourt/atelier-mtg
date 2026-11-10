"""Fabrique l'installeur Windows de l'Atelier : construction/Atelier-MTG-Windows.exe.

    python installeur/construire.py

1. Python « embarqué » de python.org (version figée, empreinte vérifiée), dans construction/app/python ;
2. les dépendances figées (installeur/dependances.txt), pour ce Python-là ;
3. le code : seulement les fichiers suivis par git (jamais les decks, réglages, caches ni le classeur) ;
4. l'icône du chaudron et installation.json (le dépôt, pour les mises à jour) ;
5. Inno Setup (ISCC) assemble l'installeur à partir de installeur/atelier.iss.

Il faut Inno Setup 6 (winget install JRSoftware.InnoSetup). GitHub Actions fait la même chose à chaque version
(.github/workflows/installeur.yml)."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
CONSTRUCTION = os.path.join(RACINE, "construction")
APP = os.path.join(CONSTRUCTION, "app")
PYTHON = "3.12.10"
PYTHON_URL = f"https://www.python.org/ftp/python/{PYTHON}/python-{PYTHON}-embed-amd64.zip"
PYTHON_SHA256 = "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3"
# fichiers suivis par git qui ne servent pas à l'Atelier installé
EXCLUS = (".github/", "installeur/", ".gitattributes", ".gitignore", "installer.py", "atelier.sh", "Atelier MTG.bat",
          "outils/publier_version.py", "outils/atelier/site_atelier.py")
# le Python embarqué n'ajoute pas le dossier du script à sys.path : on lui donne ceux de l'Atelier (chemins relatifs à ce fichier)
PTH = "python312.zip\n.\nLib\\site-packages\n..\\outils\\atelier\n..\\outils\n"


def etape(t):
    print(f"\n== {t}", flush=True)


def version():
    with open(os.path.join(RACINE, "outils", "atelier", "version.py"), encoding="utf-8") as f:
        return re.search(r'__version__\s*=\s*"([^"]+)"', f.read()).group(1)


def depot():
    """« compte/dépôt » GitHub d'où viennent les mises à jour : celui de GitHub Actions, sinon le remote origin."""
    if os.environ.get("GITHUB_REPOSITORY"):
        return os.environ["GITHUB_REPOSITORY"]
    url = subprocess.run(["git", "-C", RACINE, "remote", "get-url", "origin"], capture_output=True, text=True).stdout.strip()
    m = re.search(r"[:/]([^/:]+/[^/]+?)(?:\.git)?$", url)
    if not m:
        sys.exit(f"Dépôt GitHub introuvable (remote origin : {url!r}).")
    return m.group(1)


def python_embarque():
    etape(f"Python {PYTHON} embarqué")
    archive = os.path.join(CONSTRUCTION, f"python-{PYTHON}-embed-amd64.zip")
    if not os.path.isfile(archive):
        urllib.request.urlretrieve(PYTHON_URL, archive)
    with open(archive, "rb") as f:
        if hashlib.sha256(f.read()).hexdigest() != PYTHON_SHA256:
            os.remove(archive)
            sys.exit("Empreinte du Python téléchargé inattendue : archive supprimée, relance pour la retélécharger.")
    dest = os.path.join(APP, "python")
    with zipfile.ZipFile(archive) as z:
        z.extractall(dest)
    with open(os.path.join(dest, "python312._pth"), "w", encoding="utf-8") as f:
        f.write(PTH)
    return dest


def dependances(python):
    etape("Dépendances")
    cible = os.path.join(python, "Lib", "site-packages")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-deps", "--no-compile",
                        "--only-binary=:all:", "--platform", "win_amd64", "--python-version", "3.12", "--implementation", "cp",
                        "--target", cible, "-r", os.path.join(ICI, "dependances.txt")])
    if r.returncode:
        sys.exit("pip n'a pas pu installer les dépendances.")
    shutil.rmtree(os.path.join(cible, "bin"), ignore_errors=True)          # programmes faits pour le Python qui construit


def code():
    etape("Code de l'Atelier (fichiers suivis par git)")
    noms = subprocess.run(["git", "-C", RACINE, "ls-files", "-z"], capture_output=True, text=True, encoding="utf-8",
                          check=True).stdout.split("\0")
    n = 0
    for nom in filter(None, noms):
        if nom.startswith(EXCLUS) or not os.path.isfile(os.path.join(RACINE, nom)):
            continue
        dest = os.path.join(APP, *nom.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(os.path.join(RACINE, nom), dest)
        n += 1
    print(f"  {n} fichiers")


def icone():
    sys.path[:0] = [os.path.join(RACINE, "outils", "atelier"), os.path.join(RACINE, "outils")]
    from image_partage import _chaudron
    chemin = os.path.join(APP, "outils", "atelier", "atelier.ico")
    _chaudron(256).save(chemin, sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    return chemin


def iscc():
    for d in (os.environ.get("LOCALAPPDATA", ""), os.environ.get("ProgramFiles(x86)", ""), os.environ.get("ProgramFiles", "")):
        chemin = os.path.join(d, *(["Programs"] if d == os.environ.get("LOCALAPPDATA") else []), "Inno Setup 6", "ISCC.exe")
        if d and os.path.isfile(chemin):
            return chemin
    return shutil.which("iscc") or sys.exit("Inno Setup 6 introuvable : winget install JRSoftware.InnoSetup")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    v = version()
    print(f"Atelier MTG {v}")
    if os.environ.get("GITHUB_REF_TYPE") == "tag" and os.environ.get("GITHUB_REF_NAME") != f"v{v}":
        sys.exit(f"L'étiquette {os.environ.get('GITHUB_REF_NAME')} ne correspond pas à version.py ({v}).")
    shutil.rmtree(APP, ignore_errors=True)
    os.makedirs(APP)
    python = python_embarque()
    dependances(python)
    code()
    etape("Icône et installation.json")
    icone()
    with open(os.path.join(APP, "installation.json"), "w", encoding="utf-8") as f:
        json.dump({"type": "windows", "version": v, "depot": depot()}, f, ensure_ascii=False, indent=1)
    etape("Installeur (Inno Setup)")
    r = subprocess.run([iscc(), "/Qp", f"/DVERSION={v}", f"/DSOURCE={APP}", f"/DDEPOT={depot()}", f"/O{CONSTRUCTION}",
                        os.path.join(ICI, "atelier.iss")])
    if r.returncode:
        sys.exit("Inno Setup a échoué.")
    exe = os.path.join(CONSTRUCTION, "Atelier-MTG-Windows.exe")
    print(f"\n{exe}  ({os.path.getsize(exe) / 1e6:.1f} Mo)")


if __name__ == "__main__":
    main()
