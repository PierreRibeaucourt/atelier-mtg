"""Le pont par le relais (2.5.0) : le site joint l'Atelier de ce PC sans passer par son adresse locale.

Jusqu'à 2.4.0, le site appelait http://127.0.0.1:<port> ; les navigateurs demandent pour ça une autorisation (« accès
aux applications de cet appareil ») qu'un refus, ou trois fermetures, bloque des jours. Ici, c'est l'Atelier qui ouvre
une connexion WebSocket vers le relais (relais/relais.js, sur Cloudflare) et la garde ouverte ; le site ouvre la sienne
au même endroit, et le relais passe les messages. Le canal est l'empreinte d'une preuve tirée du secret du pont
(compte.secret_pont) : seul ce PC peut s'y brancher comme PC. Chaque demande du site est signée avec le secret (HMAC),
datée, et ne sert qu'une fois ; elle passe ensuite par les mêmes contrôles que l'ancien chemin (app.py › pont_avant).

Rien à installer : un client WebSocket minimal (RFC 6455), en bibliothèque standard.
"""
import base64
import hashlib
import hmac
import json
import os
import queue
import socket
import ssl
import struct
import sys
import threading
import time
import urllib.parse

RELAIS = (os.environ.get("ATELIER_RELAIS") or "wss://relais.atelier-mtg.workers.dev").rstrip("/")
BATTEMENT = 30          # secondes entre deux « ping » (le relais répond « pong » sans se réveiller)
SILENCE = 75            # sans rien reçu pendant ce temps, la connexion est morte : on la rouvre
ECART = 600             # secondes d'écart toléré entre l'horloge du site et celle de ce PC
MAX_MESSAGE = 8 << 20

suivi = dict(connecte=False, erreur="", depuis=None)


def preuve(secret):
    return hashlib.sha256(("atelier-pont-pc:" + secret).encode()).hexdigest()


def canal(secret):
    return hashlib.sha256(preuve(secret).encode()).hexdigest()


class Fermee(OSError):
    pass


class Socket:
    """Un client WebSocket : poignée de main, messages texte, ping/pong, fermeture. Un seul fil s'en sert : une
    connexion chiffrée (TLS) ne supporte pas une lecture et une écriture en même temps depuis deux fils (le flux se
    corrompt, le relais coupe) ; boucle() fait tout dans le sien."""

    def __init__(self, url, delai=20, entetes=None):
        u = urllib.parse.urlsplit(url)
        port = u.port or (443 if u.scheme == "wss" else 80)
        s = socket.create_connection((u.hostname, port), timeout=delai)
        if u.scheme == "wss":
            s = ssl.create_default_context().wrap_socket(s, server_hostname=u.hostname)
        cle = base64.b64encode(os.urandom(16)).decode()
        chemin = (u.path or "/") + ("?" + u.query if u.query else "")
        hote = u.hostname + (f":{u.port}" if u.port else "")
        s.sendall((f"GET {chemin} HTTP/1.1\r\nHost: {hote}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                   f"Sec-WebSocket-Key: {cle}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: atelier-mtg\r\n"
                   + "".join(f"{k}: {v}\r\n" for k, v in (entetes or {}).items()) + "\r\n").encode())
        tete = b""
        while b"\r\n\r\n" not in tete:
            b = s.recv(4096)
            if not b:
                raise Fermee("le relais a fermé la connexion")
            tete += b
            if len(tete) > 65536:
                raise OSError("réponse du relais illisible")
        tete, self._reste = tete.split(b"\r\n\r\n", 1)
        lignes = tete.decode("latin-1").split("\r\n")
        if len(lignes[0].split()) < 2 or lignes[0].split()[1] != "101":
            s.close()
            raise OSError(f"le relais refuse : {lignes[0][:80]}")
        attendu = base64.b64encode(hashlib.sha1((cle + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        if not any(l.split(":", 1)[0].strip().lower() == "sec-websocket-accept" and l.split(":", 1)[1].strip() == attendu
                   for l in lignes[1:] if ":" in l):
            s.close()
            raise OSError("le relais ne parle pas WebSocket")
        self.s = s
        self._morceaux = []

    def _trame(self):
        """(premier octet, données) de la trame entière en tête du tampon ; None s'il en manque encore."""
        r = self._reste
        if len(r) < 2:
            return None
        b1, b2 = r[0], r[1]
        n, i = b2 & 0x7F, 2
        if n == 126:
            if len(r) < 4:
                return None
            n, i = struct.unpack(">H", r[2:4])[0], 4
        elif n == 127:
            if len(r) < 10:
                return None
            n, i = struct.unpack(">Q", r[2:10])[0], 10
        if n > MAX_MESSAGE:
            raise OSError("message du relais trop long")
        masque = None
        if b2 & 0x80:
            if len(r) < i + 4:
                return None
            masque, i = r[i:i + 4], i + 4
        if len(r) < i + n:
            return None
        d, self._reste = r[i:i + n], r[i + n:]
        if masque:
            d = bytes(x ^ masque[k % 4] for k, x in enumerate(d))
        return b1, d

    def envoyer(self, donnees, op=1):
        d = donnees.encode("utf-8") if isinstance(donnees, str) else bytes(donnees)
        n, masque = len(d), os.urandom(4)
        tete = bytes([0x80 | op])
        if n < 126:
            tete += bytes([0x80 | n])
        elif n < 65536:
            tete += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            tete += bytes([0x80 | 127]) + struct.pack(">Q", n)
        cache = (masque * (n // 4 + 1))[:n]
        corps = (int.from_bytes(d, "big") ^ int.from_bytes(cache, "big")).to_bytes(n, "big") if n else b""
        avant = self.s.gettimeout()
        self.s.settimeout(30)                          # un envoi n'est jamais coupé en route (le flux serait faux)
        try:
            self.s.sendall(tete + masque + corps)
        finally:
            self.s.settimeout(avant)

    def recevoir(self, attente=None):
        """Le message texte suivant ; None si rien n'arrive en « attente » secondes (sans attente : le délai de la
        connexion, puis TimeoutError). Fermee quand le relais ferme. Répond aux ping du protocole."""
        fin = None if attente is None else time.monotonic() + attente
        while True:
            t = self._trame()
            if t is None:
                if fin is not None:
                    reste = fin - time.monotonic()
                    if reste <= 0:
                        return None
                    self.s.settimeout(reste)
                try:
                    b = self.s.recv(65536)
                except socket.timeout:
                    if fin is not None:
                        return None
                    raise
                if not b:
                    raise Fermee("le relais a coupé la connexion")
                self._reste += b
                continue
            b1, d = t
            op = b1 & 0x0F
            if op == 8:
                try:
                    self.envoyer(d[:2] or b"\x03\xe8", 8)
                except OSError:
                    pass
                code = struct.unpack(">H", d[:2])[0] if len(d) >= 2 else ""
                raise Fermee(f"le relais a fermé la connexion ({code} {d[2:].decode('utf-8', 'replace')})".replace(" )", ")"))
            if op == 9:
                self.envoyer(d, 10)
                continue
            if op == 10:
                continue
            self._morceaux.append(d)
            if b1 & 0x80:
                texte, self._morceaux = b"".join(self._morceaux).decode("utf-8", "replace"), []
                return texte

    def fermer(self):
        try:
            self.envoyer(b"\x03\xe8", 8)
        except OSError:
            pass
        try:
            self.s.close()
        except OSError:
            pass


# ---------------------------------------------------------------- les demandes du site
_vues = {}
_vues_verrou = threading.Lock()


def verifier(m, secret, maintenant=None):
    """None si la demande est bien du site (signée avec le secret, récente, jamais vue) ; sinon (statut, corps)."""
    refus = (403, json.dumps({"erreur": "Atelier de ce PC : le pont refuse cette demande."}))
    try:
        ident, ts, methode, chemin = str(m["id"]), int(m["ts"]), str(m["methode"]), str(m["chemin"])
        corps = m.get("corps") or ""
        if not isinstance(corps, str):
            return refus
    except (KeyError, TypeError, ValueError):
        return refus
    attendu = hmac.new(secret.encode(), f"{ident}\n{ts}\n{methode}\n{chemin}\n{corps}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(attendu, str(m.get("sig") or "")):
        return refus
    maintenant = time.time() if maintenant is None else maintenant
    if abs(maintenant - ts / 1000) > ECART:
        return 403, json.dumps({"erreur": "L'heure de cet appareil et celle du PC diffèrent trop : règle l'horloge."})
    if methode not in ("GET", "POST") or not chemin.startswith("/api/") or len(ident) > 100:
        return refus
    with _vues_verrou:
        for k in [k for k, t in _vues.items() if maintenant - t > 2 * ECART]:
            del _vues[k]
        if ident in _vues:
            return refus
        _vues[ident] = maintenant
    return None


def _traiter(sortie, brut, secret, appel_local):
    """Dans son propre fil (une demande peut prendre du temps) ; la réponse part par la file « sortie », que le fil de
    la connexion envoie."""
    try:
        m = json.loads(brut)
    except ValueError:
        return
    if not isinstance(m, dict) or m.get("type") != "appel":
        return
    r = verifier(m, secret)
    try:
        statut, corps = r if r else appel_local(m["methode"], m["chemin"], m.get("corps") or "")
    except Exception as e:                                               # noqa: BLE001 - le site affiche l'erreur
        statut, corps = 500, json.dumps({"erreur": f"Atelier de ce PC : {e}"})
    sortie.put(json.dumps({"type": "reponse", "id": m.get("id"), "de": m.get("de"), "statut": statut, "corps": corps}))


def boucle(secret_pont, appel_local):
    """En fond (app.py) : garde la connexion au relais ouverte, la rouvre quand elle tombe (réseau absent au démarrage du
    PC, veille, relais redémarré), et répond aux demandes du site. appel_local(methode, chemin, corps) -> (statut, corps)."""
    attente, dernier_message = 2, ""
    while True:
        try:
            secret = secret_pont()
            ws = Socket(f"{RELAIS}/pont/{canal(secret)}?pc={preuve(secret)}")
            suivi.update(connecte=True, erreur="", depuis=time.time())
            if dernier_message:
                print("Relais : reconnecté", file=sys.stderr, flush=True)
            attente, dernier_message = 2, ""
            sortie = queue.Queue()
            try:
                vu = battu = time.monotonic()
                while True:                            # ce fil seul lit et écrit (Socket) : réponses prêtes, ping, lecture
                    while True:
                        try:
                            ws.envoyer(sortie.get_nowait())
                        except queue.Empty:
                            break
                    if time.monotonic() - battu > BATTEMENT:
                        ws.envoyer("ping")
                        battu = time.monotonic()
                    m = ws.recevoir(0.1)
                    if m is None:
                        if time.monotonic() - vu > SILENCE:
                            raise OSError("le relais ne répond plus")
                        continue
                    vu = time.monotonic()
                    if m != "pong":
                        threading.Thread(target=_traiter, args=(sortie, m, secret, appel_local), daemon=True).start()
            finally:
                suivi["connecte"] = False
                ws.fermer()
        except Exception as e:                                           # noqa: BLE001 - on réessaie
            message = str(e) or type(e).__name__
            suivi.update(connecte=False, erreur=message)
            if message != dernier_message:
                print(f"Relais : {message}", file=sys.stderr, flush=True)
                dernier_message = message
        time.sleep(attente)
        attente = min(attente * 2, 60)
