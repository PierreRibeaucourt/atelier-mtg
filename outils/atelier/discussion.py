"""Discussion avec Claude depuis l'Atelier, via Claude Code (claude.exe), déjà installé avec l'extension VS Code.

Pas de clé API : Claude Code utilise ton abonnement Claude (chaque message compte dans ta limite d'utilisation).
Lancé dans le dossier MTG, Claude a la même mémoire que dans VS Code. Il peut lire et modifier les fichiers du dossier
et lancer python (rien d'autre).

Une discussion par deck (<dossier du deck>/discussion.json : son historique et sa session Claude, donc son propre contexte),
plus une discussion générale (outils/atelier/discussion.json), au choix depuis n'importe quelle page. La conversation reprend d'un
message à l'autre (--resume). Chaque réponse tourne en tâche de fond sur le serveur, pas dans la page : fermer ou recharger
la page ne la perd pas, et plusieurs decks peuvent avoir une réponse en cours en même temps.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import threading

import decks

ICI = os.path.dirname(os.path.abspath(__file__))
ETAT_GENERAL = os.path.join(ICI, "discussion.json")
FICHIER = "discussion.json"
OUTILS_PERMIS = "Read Edit Write Glob Grep Bash(python *) WebFetch(domain:api.scryfall.com) WebFetch(domain:backend.commanderspellbook.com)"

CONSIGNE = """Tu es appelé depuis l'Atelier MTG, l'interface locale de l'utilisateur (code dans outils/atelier).
Réponds en français, court et concret ; la fenêtre affiche du texte simple (listes à puces et **gras** acceptés, pas de tableaux).
Chaque message commence par [Page : …] : c'est ce que l'utilisateur regarde dans l'Atelier.
- Les decks sont dans les dossiers « Deck … » : la liste de référence est archidekt.txt (format « 1x Nom [Catégorie] »,
  ou « 1x Nom (ima) 205 [Catégorie] » quand l'utilisateur a choisi une impression : garde ce « (set) numéro » si tu touches la ligne).
  AVANT de modifier un archidekt.txt, lance : python outils/atelier/sauvegarde.py "<dossier du deck>" "<ce que tu changes>"
  (ça garde l'ancienne liste dans l'historique). Remplace une carte À LA MÊME LIGNE pour garder les simulations comparables.
- Réglages de jeu du simulateur pour un deck : <dossier du deck>/pilote.json, clés pilote ("vite" ou "salve"), salve_pv,
  salve_main, salve_nb, greven_main, greven_pv, premier (cartes lancées avant tout), garder (cartes gardées pour une salve).
  Une consigne de jeu en français qui ne rentre pas dans ces réglages se code dans outils/simu_moteur.py (vérifie ensuite que
  les résultats par défaut ne changent pas).
- Rapports de simulation : <dossier du deck>/simulations/*.json. Simulateur : outils/simu.py, simu_cartes.py, simu_moteur.py.
- Prix : python outils/prix.py "<carte>" ({budget}). Respecte la méthode et les préférences gardées en mémoire."""


def consigne(cle):
    import reglages
    b = reglages.budget_texte()
    base = CONSIGNE.replace("{budget}", f"budget {b} par carte" if b else "pas de budget par carte")
    if cle:
        return base + (f"\n\nCETTE DISCUSSION PORTE SUR LE DECK DU DOSSIER « {cle} » (liste : {cle}/archidekt.txt). "
                           "Chaque deck a sa propre discussion dans l'Atelier : reste sur ce deck, sauf si l'utilisateur en parle d'un autre.")
    return base + "\n\nDiscussion générale de l'Atelier : pas un deck en particulier."


def trouver_claude():
    """Claude Code : le programme de l'extension la plus récente (VS Code, Cursor, Windsurf…), sinon « claude » dans
    le PATH ou à sa place d'installation habituelle."""
    exe = ".exe" if os.name == "nt" else ""

    def version(p):
        m = re.search(r"claude-code-(\d+)\.(\d+)\.(\d+)", p)
        return tuple(int(x) for x in m.groups()) if m else (0,)
    cands = [p for d in ("~/.vscode", "~/.vscode-insiders", "~/.cursor", "~/.windsurf", "~/.vscode-oss")
             for p in glob.glob(os.path.expanduser(f"{d}/extensions/anthropic.claude-code-*/resources/native-binary/claude{exe}"))]
    if cands:
        return max(cands, key=version)
    if shutil.which("claude"):
        return shutil.which("claude")
    for p in ("~/.local/bin/claude", "~/.claude/local/claude"):
        p = os.path.expanduser(p + exe)
        if os.path.isfile(p):
            return p
    return None


# ---------------------------------------------------------------- historique d'une discussion
def chemin_etat(cle=""):
    """cle = dossier du deck (« Deck Sefris »), ou "" pour la discussion générale."""
    return decks.chemin(cle, FICHIER) if cle else ETAT_GENERAL


def lire_etat(cle=""):
    p = chemin_etat(cle)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else dict(session=None, messages=[])


def ecrire_etat(e, cle=""):
    p = chemin_etat(cle)
    tmp = p + ".tmp"
    json.dump(e, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, p)


def nouvelle(cle=""):
    if en_cours(cle)["actif"]:
        raise RuntimeError("Claude est en train de répondre dans cette discussion : attends la fin (ou arrête la réponse).")
    ecrire_etat(dict(session=None, messages=[]), cle)


def _resume_outil(nom, entree):
    """Une ligne lisible pour un outil utilisé par Claude."""
    if nom in ("Read", "Edit", "Write"):
        f = os.path.relpath(entree.get("file_path", ""), decks.RACINE) if entree.get("file_path") else ""
        return {"Read": "lit", "Edit": "modifie", "Write": "écrit"}[nom] + " " + f
    if nom == "Bash":
        return "lance : " + (entree.get("command", "")[:140])
    if nom in ("Glob", "Grep"):
        return "cherche : " + (entree.get("pattern", "")[:100])
    if nom == "WebFetch":
        return "consulte " + entree.get("url", "")[:100]
    return nom


# ---------------------------------------------------------------- réponses en cours (une par discussion au plus)
_verrou = threading.Lock()
_jobs = {}            # cle -> dict(actif, texte, outils, erreur, proc, arret) ; garde le dernier état une fois fini


def en_cours(cle=""):
    with _verrou:
        j = _jobs.get(cle) or {}
        return dict(actif=j.get("actif", False), texte=j.get("texte", ""), outils=list(j.get("outils", [])),
                    erreur=j.get("erreur", ""), actives=[k for k, x in _jobs.items() if x["actif"]])


def lancer(message, page="", modele="", cle=""):
    """Démarre la réponse de Claude en tâche de fond et rend la main tout de suite."""
    exe = trouver_claude()
    if not exe:
        raise RuntimeError("Claude Code introuvable : installe l'extension Claude Code de VS Code, ou le programme « claude ».")
    if not message.strip():
        raise ValueError("message vide")
    chemin_etat(cle)                                         # deck inconnu : erreur tout de suite
    with _verrou:
        if (_jobs.get(cle) or {}).get("actif"):
            raise RuntimeError("Claude répond déjà dans cette discussion : attends la fin de la réponse (ou arrête-la).")
        j = _jobs[cle] = dict(actif=True, texte="", outils=[], erreur="", proc=None, arret=False)
    threading.Thread(target=_travail, args=(j, exe, message, page, modele, cle), daemon=True).start()
    return en_cours(cle)


def arreter(cle=""):
    j = _jobs.get(cle)
    if j and j["actif"]:
        j["arret"] = True
        if j["proc"] and j["proc"].poll() is None:
            j["proc"].terminate()


def _travail(j, exe, message, page, modele, cle):
    try:
        for ev in _envoyer(j, exe, message, page, modele, cle):
            with _verrou:
                if ev["type"] == "texte":
                    j["texte"] += ev["texte"]
                elif ev["type"] == "outil":
                    j["outils"].append(ev["texte"])
                elif ev["type"] == "erreur":
                    j["erreur"] = ev["texte"]
    except Exception as e:                                  # noqa: BLE001 — l'erreur s'affiche dans la discussion
        with _verrou:
            j["erreur"] = str(e)
    finally:
        with _verrou:
            j["actif"] = False
            j["proc"] = None


def _envoyer(j, exe, message, page, modele, cle):
    """Générateur d'événements : dict(type=texte|outil|fin|erreur, ...)."""
    e = lire_etat(cle)
    cmd = [exe, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
           "--permission-mode", "acceptEdits", "--allowedTools", OUTILS_PERMIS, "--append-system-prompt", consigne(cle)]
    if modele:
        cmd += ["--model", modele]
    if e.get("session"):
        cmd += ["--resume", e["session"]]
    texte_envoye = (f"[Page : {page}]\n" if page else "") + message
    e["messages"].append(dict(role="moi", texte=message))
    ecrire_etat(e, cle)
    proc = j["proc"] = subprocess.Popen(cmd, cwd=decks.RACINE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    proc.stdin.write(texte_envoye.encode("utf-8"))
    proc.stdin.close()
    reponse, delta_vu, session, fin, outils = [], False, e.get("session"), None, []
    for brut in proc.stdout:
        try:
            ev = json.loads(brut.decode("utf-8", "replace"))
        except ValueError:
            continue
        session = ev.get("session_id") or session
        t = ev.get("type")
        if t == "stream_event":
            d = (ev.get("event") or {}).get("delta") or {}
            if d.get("type") == "text_delta" and d.get("text"):
                delta_vu = True
                reponse.append(d["text"])
                yield dict(type="texte", texte=d["text"])
        elif t == "assistant":
            for bloc in (ev.get("message") or {}).get("content", []):
                if bloc.get("type") == "tool_use":
                    outils.append(_resume_outil(bloc.get("name", ""), bloc.get("input") or {}))
                    yield dict(type="outil", texte=outils[-1])
                elif bloc.get("type") == "text" and not delta_vu and bloc.get("text"):
                    reponse.append(bloc["text"])
                    yield dict(type="texte", texte=bloc["text"])
            delta_vu = False
            if reponse and not reponse[-1].endswith("\n"):
                reponse.append("\n")
                yield dict(type="texte", texte="\n")
        elif t == "result":
            fin = ev
    proc.wait()
    texte = "".join(reponse).strip()
    if j["arret"]:
        texte += "\n\n(réponse arrêtée)"
        yield dict(type="erreur", texte="Réponse arrêtée.")
    elif fin is None or fin.get("is_error"):
        err = proc.stderr.read().decode("utf-8", "replace").strip()
        msg = (fin or {}).get("result") or err or f"Claude Code s'est arrêté (code {proc.returncode})."
        yield dict(type="erreur", texte=msg[:2000])
    e = lire_etat(cle)
    e["session"] = session
    e["messages"].append(dict(role="claude", texte=texte, outils=outils))
    ecrire_etat(e, cle)
    yield dict(type="fin", session=session, cout=(fin or {}).get("total_cost_usd"))
