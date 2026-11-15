"""Envoi du code de connexion par e-mail.

Modes (réglage « courriel » › « mode ») :
- « sendmail » : le sendmail du serveur (o2switch), sans mot de passe à garder ;
- « smtp » : un serveur SMTP en SSL (hote, port, utilisateur, mot_de_passe) ;
- « memoire » : rien ne part, les messages sont gardés dans ENVOYES (essais) ;
- « journal » : rien ne part, « adresse code » est ajouté au fichier « fichier » (essais de l'appli dans un navigateur).
"""
import smtplib
import subprocess
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

ENVOYES = []      # mode « memoire » : (destinataire, code)

TEXTE = """Ton code de connexion à l'Atelier MTG : {code}

Il est valable 15 minutes.

Si tu n'as rien demandé, ignore ce message : personne ne peut se connecter sans ce code.

--
Atelier MTG · https://atelier-mtg.com
"""


def message(reglages, email, code):
    expediteur = reglages.get("expediteur", "ne-pas-repondre@atelier-mtg.com")
    m = EmailMessage()
    m["Subject"] = f"{code} : ton code Atelier MTG"
    m["From"] = formataddr(("Atelier MTG", expediteur))
    m["To"] = email
    m["Date"] = formatdate(localtime=True)
    m["Message-ID"] = make_msgid(domain=expediteur.split("@")[-1])
    m["Auto-Submitted"] = "auto-generated"
    m.set_content(TEXTE.format(code=code))
    return m


def envoyer_code(reglages, email, code):
    mode = reglages.get("mode", "memoire")
    if mode == "memoire":
        ENVOYES.append((email, code))
        return
    if mode == "journal":
        with open(reglages["fichier"], "a", encoding="utf-8") as f:
            f.write(f"{email} {code}\n")
        return
    m = message(reglages, email, code)
    if mode == "sendmail":
        subprocess.run([reglages.get("sendmail", "/usr/sbin/sendmail"), "-t", "-i",
                        "-f", reglages.get("expediteur", "ne-pas-repondre@atelier-mtg.com")],
                       input=m.as_bytes(), check=True, timeout=30)
    elif mode == "smtp":
        with smtplib.SMTP_SSL(reglages["hote"], int(reglages.get("port", 465)), timeout=30) as s:
            s.login(reglages["utilisateur"], reglages["mot_de_passe"])
            s.send_message(m)
    else:
        raise ValueError(f"mode d'envoi inconnu : {mode}")
