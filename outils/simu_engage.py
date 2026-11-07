"""Mode « engagement » du moteur : engager, geler, provoquer, monarque, Tromokratis (deck Tromo).

Il ne s'active que si le deck contient une carte de ce mode (kind « e_… » dans simu_cartes, ou le commandant Tromokratis) :
les autres decks gardent exactement leurs résultats.

Ce que ce mode ajoute :
- les créatures adverses ont un état engagé. Celles qui attaquent restent engagées jusqu'au dégagement de leur contrôleur ;
  une créature engagée ne bloque pas et n'attaque pas. « gel » = ne se dégage pas à son prochain dégagement ; « verrou » = ne se
  dégage pas tant que l'aura ou la saga est en jeu ; « neutre » = ne peut ni attaquer ni bloquer (Observed Stasis) ;
- tes créatures qui attaquent restent engagées pendant les tours adverses (elles ne bloquent pas) ;
- provocation : la créature attaque à chaque combat, un autre joueur que toi si possible ;
- Propagande : t'attaquer coûte {2} par créature : au plus PROPAGANDE_MAX créatures t'attaquent, jamais une créature forcée ;
- monarque : tu pioches à ta fin de tour ; celui qui inflige des blessures de combat au monarque prend la couronne ;
- Tromokratis : imblocable si une créature du défenseur est engagée ou ne peut pas bloquer ; sinon le défenseur bloque avec
  toutes ses créatures seulement s'il le tue ou si les dégâts seraient mortels ; défense talismanique sauf en attaquant :
  quand il attaque, chaque adversaire a une chance (son taux de retrait × RISQUE_ATTAQUE) de le tuer en éphémère, sauf
  sous Perdu dans le labyrinthe (tes créatures engagées ont la défense talismanique) ;
- avant ton combat, le pilote rend Tromokratis imblocable avec le moins cher : Couronne de Hylda, Opposition, Kraken de
  Tolaria, Tamiyo, Thassa, puis les sorts gardés en main (Gigatorpeur, Escroc ondin, Salve glaciale, Perdu dans le labyrinthe) ;
- pendant les tours adverses : Maeve provoque, le Bident et Menaces imaginaires forcent à attaquer (seulement sous Propagande) ;
  une fois les attaquants déclarés sur toi : Labyrinthe d'Ith, Frappe étourdissante, Observed Stasis, Labyrinthe mystificateur.
"""
import random

RISQUE_ATTAQUE = 0.3
PROPAGANDE_MAX = 2
MONSTRES_MARINS = {"Kraken", "Leviathan", "Octopus", "Serpent"}
SAGAS = {
    "Time of Ice": [("verrou", 1), ("verrou", 1), ("renvoi_engages",)],
    "Kang Dynasty": [("goad_chaque",), ("goad_chaque",), ("pompe_main",)],
    "Summon: Shiva": [("gel", 1), ("gel", 1), ("pioche_tous",)],
    "Scroll of Isildur": [None, ("gel", 2), ("pioche_un",)],
}


def _m():
    import simu_moteur
    return simu_moteur


class Engagement:
    # ================================================================ état
    def init_engag(self):
        self.engag = self.kc["kind"] == "tromo" or any(k["kind"].startswith("e_") for k in self.C.values())
        self.monarque = None                     # None, "moi" ou un Adversaire
        self.rng_e = random.Random(f"{self.graine}-engag")
        self.maze_ith = self.maze_myst = False
        self.myst_retour = []
        self.nb_terrains = 0
        self.fealty = None

    def kperm(self, kind):
        return [P for P in self.perms if P.get("k") and P["k"]["kind"] == kind]

    def a_terrain(self, nom):
        return any(x[0] == nom for x in self.terrains)

    def neutre(self, c):
        return c.get("neutre") is not None and c["neutre"] in self.perms

    def libre(self, c):
        return not c.get("eng") and not self.neutre(c)

    def prov(self, c):
        return bool(c.get("prov")) or (c.get("prov_perm") is not None and c["prov_perm"] in self.perms)

    def steve(self, a):
        """Tromokratis est imblocable contre a : une créature engagée ou qui ne peut pas bloquer, ou aucune créature."""
        return not a.creas or any(c.get("eng") or self.neutre(c) for c in a.creas)

    def tromo(self):
        P = self.cmd_en_jeu()
        return P if P and self.kc["kind"] == "tromo" else None

    def nb_eng(self, a):
        return sum(1 for c in a.creas if c.get("eng"))

    def paie_u(self, g, u=1):
        return self.paie(g, tuple("U" for _ in range(u)))

    # ---------------------------------------------------------------- engager, geler
    def engage(self, a, c, gel=0, verrou=None):
        if not c.get("eng"):
            self.stat["e_engagees"] += 1
        c["eng"] = True
        if gel:
            c["gel"] = max(c.get("gel", 0), gel)
            self.stat["e_gelees"] += 1
        if verrou is not None:
            c["verrou"] = verrou
            self.stat["e_verrouillees"] += 1

    def cibles_libres(self, a=None):
        return [(b, c) for b in ([a] if a else self.vivants()) for c in b.creas if self.libre(c) and not c.get("hexproof")]

    def choisit(self, n=1, a=None):
        """Créatures adverses à engager : d'abord une sur la cible de Tromokratis s'il n'y est pas déjà imblocable,
        puis les plus menaçantes encore dégagées."""
        M = _m()
        pris = []
        t = self.cible_tromo() if self.tromo() and a is None else None
        if t is not None and not self.steve(t):
            c = self.cibles_libres(t)
            if c:
                pris.append(max(c, key=lambda bc: M.valeur_adv(bc[1])))
        reste = [bc for bc in self.cibles_libres(a) if bc not in pris]
        reste.sort(key=lambda bc: -M.valeur_adv(bc[1]))
        return (pris + reste)[:n]

    def engage_n(self, n=1, gel=0, a=None, verrou=None):
        for b, c in self.choisit(n, a):
            self.engage(b, c, gel, verrou)

    def engage_chaque(self, gel=0, goad=None):
        M = _m()
        for b in self.vivants():
            c = self.cibles_libres(b)
            if c:
                _, x = max(c, key=lambda bc: M.valeur_adv(bc[1]))
                self.engage(b, x, gel)
                if goad:
                    x["prov"], x["prov_src"] = True, goad

    def meilleure_adv(self, filtre=lambda c: True):
        M = _m()
        c = [(b, x) for b in self.vivants() for x in b.creas if not x.get("hexproof") and filtre(x)]
        return max(c, key=lambda bc: M.valeur_adv(bc[1]), default=None)

    # ---------------------------------------------------------------- monarque
    def devient_monarque(self, qui):
        if self.monarque is qui:
            return
        ancien, self.monarque = self.monarque, qui
        if qui == "moi":
            self.stat["e_couronne_prise"] += 1
        elif ancien == "moi":
            self.stat["e_couronne_perdue"] += 1
        if self.fealty and qui != "moi":         # Allégeance au royaume : la créature passe au nouveau monarque
            P, c = self.fealty
            self.fealty = None
            if P in self.perms:
                self.perms.remove(P)
                if qui is not None and qui.vivant():
                    c["eng"] = False
                    qui.creas.append(c)

    # ================================================================ ton tour
    def debut_tour_engag(self):
        self.maze_ith = self.maze_myst = False
        for P in self.perms:
            P["eng"] = False
            P["utilise"] = False
        for a in self.adv:
            for c in a.creas:
                if c.get("prov"):
                    c["prov"] = False
                    c.pop("prov_src", None)
        vivantes = {id(c) for a in self.vivants() for c in a.creas}
        for P in [P for P in self.perms if P.get("sur_adv") is not None]:
            if id(P["sur_adv"]) not in vivantes:
                if P["k"]["kind"] == "e_lame":
                    P["sur_adv"] = None
                else:
                    self.perms.remove(P)
                    self.gy.append(P["nom"])
        self.nb_terrains = len(self.terrains)

    def sagas_engag(self):
        for P in list(self.perms):
            if P.get("lore") and P["entree"] < self.t:
                P["lore"] += 1
                self.chapitre(P)

    def chapitre(self, P):
        ch = SAGAS[P["nom"]][P["lore"] - 1]
        if ch:
            code = ch[0]
            if code == "verrou":
                self.engage_n(ch[1], verrou=P)
            elif code == "gel":
                self.engage_n(ch[1], gel=1)
            elif code == "goad_chaque":
                self.engage_chaque(goad="kang")
            elif code == "renvoi_engages":
                for a in self.vivants():
                    for c in [c for c in a.creas if c.get("eng")]:
                        a.creas.remove(c)
                        for cle in ("eng", "gel", "verrou", "prov", "prov_perm", "neutre"):
                            c.pop(cle, None)
                        a.renvois.append(c)
                        self.stat["e_renvoyees"] += 1
            elif code == "pompe_main":
                T = self.tromo() or max(self.creatures(), key=lambda Q: self.stats(Q)[0], default=None)
                if T:
                    T["bonus_p"] += len(self.hand)
                    T["bonus_t"] += len(self.hand)
                    T["imblocable"] = self.t
            elif code == "pioche_tous":
                self.pioche_eng(sum(self.nb_eng(a) for a in self.vivants()))
            elif code == "pioche_un":
                self.pioche_eng(max([self.nb_eng(a) for a in self.vivants()] or [0]))
        if P["lore"] >= 3:
            if self.est_crea(P):
                self.sacrifie(P)
            elif P in self.perms:
                self.perms.remove(P)
                self.gy.append(P["nom"])

    def pioche_eng(self, n):
        self.stat["e_pioche"] += n
        self.pioche(n)

    def landfall_engag(self):
        nouveaux = self.terrains[self.nb_terrains:]
        self.nb_terrains = len(self.terrains)
        for x in nouveaux:
            for P in self.kperm("e_tazeem"):     # Vigile de Tazeem (gel si c'est une Île), Kraken accrocheur (étourdit toujours)
                self.engage_n(1, gel=1 if P["k"].get("toujours_gel") or "Island" in self.C[x[0]]["types_terrain"] else 0)

    def apres_sort_engag(self, k):
        """Déclencheurs « quand tu lances » : Monument de Kefnet (créature), Contemplation silencieuse (non-créature)."""
        if k["creature"]:
            for _ in self.kperm("e_kefnet"):
                c = self.meilleure_adv(lambda x: x.get("eng") and not x.get("gel"))
                if c:
                    self.engage(c[0], c[1], gel=1)
        else:
            for _ in self.kperm("e_contemplation"):
                if self.choisit(1) and self.paie(1):
                    self.engage_n(1, gel=1)

    # ---------------------------------------------------------------- envie de lancer
    def reserve(self):
        """Mana gardé pour les tours adverses une fois Tromokratis en jeu (Maeve, Bident, auras à flash)."""
        if not self.tromo():
            return 0
        r = 0
        if self.kperm("e_maeve"):
            r = 3
        if any(self.C[n]["kind"] == "e_aura" and self.C[n].get("flash") for n in self.hand):
            r = max(r, 3)
        if self.kperm("e_bident") and self.kperm("e_propagande"):
            r = max(r, 2)
        return r

    def veut_engag(self, n, k, kd):
        adv = sum(len(a.creas) for a in self.vivants())
        g, pips = self.cout(k)
        if kd not in ("e_kefnet",) and len(self.pool) - g - len(pips) < self.reserve() and len(self.hand) < 6:
            return False
        if kd == "e_crea_tap" and k.get("flash"):
            return self.phase2 and len(self.hand) >= 5
        if kd == "e_aura":
            if k.get("flash") and len(self.hand) < 6:
                return False
            return self.meilleure_adv(lambda c: not c.get("verrou") and not c.get("neutre")) is not None
        if kd in ("e_goad_aura", "e_fealty"):
            return self.meilleure_adv() is not None
        if kd == "e_sort_tap":
            mode = k["mode"]
            if mode == "sleep":
                return any(sum(c["p"] for c in a.creas if self.libre(c)) >= 8 or sum(1 for c in a.creas if self.libre(c)) >= 3
                           for a in self.vivants())
            if mode == "cryptic":
                libres = sum(1 for a in self.vivants() for c in a.creas if self.libre(c))
                return libres >= 6 or (libres >= 4 and self.tromo() is not None)
            if mode == "stun3":                  # Congelé sur place, Bloquer le mouvement : 3 marqueurs d'étourdissement
                return self.meilleure_adv(lambda c: not c.get("verrou") and not self.neutre(c) and c.get("gel", 0) < 2) is not None
            return False                         # Gigatorpeur, Salve glaciale, Perdu dans le labyrinthe : gardés pour le combat
        if kd == "e_pioche_eng":
            m = max([self.nb_eng(a) for a in self.vivants()] or [0])
            return m >= 3 or (m >= 2 and len(self.hand) <= 2)
        if kd == "e_vague":
            return self.veut_vague(k["mode"], adv)
        if kd == "e_menaces" or kd == "e_gambit":
            return False
        if kd == "e_redirect":                   # gardés pour une attaque sur toi ; le Poteau sert de caillou en début de partie
            return len(self.hand) >= 6 or (k.get("rock") and self.tromo() is None and self.t <= 4)
        return True

    def iles(self):
        return sum(1 for x in self.terrains if "Island" in self.C[x[0]]["types_terrain"])

    def veut_vague(self, mode, adv):
        """Renvois de masse : seulement s'ils renvoient beaucoup plus de créatures adverses que des tiennes."""
        mes_non_marins = [P for P in self.creatures() if not (P["types"] & MONSTRES_MARINS) and not P.get("cmd")]
        if mode in ("scourge", "slinn"):
            return True                          # créatures : lancées de toute façon (le kicker de Slinn Voda se décide à la résolution)
        if mode == "whelming":
            return adv >= 6 and len(mes_non_marins) <= 2
        if mode == "engulf":
            x = self.iles()
            T = self.tromo()
            adv_x = sum(1 for a in self.vivants() for c in a.creas if c["t"] <= x)
            mes_x = sum(1 for P in self.creatures() if self.stats(P)[1] <= x and not P.get("cmd"))
            return adv_x >= 4 and mes_x <= 1 and not (T and self.stats(T)[1] <= x)
        if mode == "rift":
            return adv >= 6 and len(self.pool) >= 7
        if mode == "kederekt":
            miens = sum(1 for P in self.perms if not P.get("cmd"))
            return adv >= 7 and miens <= 6
        return False

    def renvoi_masse(self, adv_ok, moi_ok, tout=False, sauf=None):
        """Renvoie en main les créatures adverses qui vérifient adv_ok, et tes permanents (créatures qui vérifient moi_ok,
        tous tes permanents non-terrains si tout). Ton commandant retourne dans la zone de commandement sans taxe."""
        nb = 0
        for a in self.vivants():
            for c in [c for c in a.creas if adv_ok(c)]:
                a.creas.remove(c)
                for cle in ("eng", "gel", "verrou", "prov", "prov_perm", "neutre"):
                    c.pop(cle, None)
                a.renvois.append(c)
                nb += 1
        for P in list(self.perms):
            if P is sauf or not (tout or (self.est_crea(P) and moi_ok(P))):
                continue
            self.perms.remove(P)
            if P.get("cmd") or P.get("jeton"):
                continue
            if P.get("k"):
                self.hand.append(P["nom"])
        self.stat["e_renvoyees"] += nb
        self.stat["e_vagues"] += 1

    def vague(self, mode, P=None):
        if mode in ("whelming", "slinn"):
            self.renvoi_masse(lambda c: True, lambda Q: not (Q["types"] & (MONSTRES_MARINS | {"Merfolk"} if mode == "slinn" else MONSTRES_MARINS)))
        elif mode == "engulf":
            x = self.iles()
            self.renvoi_masse(lambda c: c["t"] <= x, lambda Q: self.stats(Q)[1] <= x)
        elif mode == "scourge":
            x = self.iles()
            self.renvoi_masse(lambda c: c["t"] <= x, lambda Q: False)
        elif mode == "rift":
            self.renvoi_masse(lambda c: True, lambda Q: False)
        elif mode == "kederekt":
            self.renvoi_masse(lambda c: True, lambda Q: True, tout=True, sauf=P)

    # ---------------------------------------------------------------- résolution
    def resout_engag(self, n, k, kd):
        if not k["permanent"]:
            self.gy.append(n)
            if kd == "e_sort_tap":
                self.sort_tap(k["mode"])
            elif kd == "e_pioche_eng":
                self.pioche_eng(max([self.nb_eng(a) for a in self.vivants()] or [0]))
            elif kd == "e_vague":
                if k["mode"] == "rift" and not self.paie(5):   # surcharge {6}{U} : {1}{U} déjà payés
                    bc = self.meilleure_adv()                  # sinon une seule cible
                    if bc:
                        self.renvoi_masse(lambda c: c is bc[1], lambda Q: False)
                    return
                self.vague(k["mode"])
            return
        P = self.nouveau(k)
        if kd == "e_vague" and k["mode"] == "slinn":
            adv = sum(len(a.creas) for a in self.vivants())
            if self.veut_vague("whelming", adv) and self.paie_u(1):
                P["kick"] = True
        if k["creature"]:
            self.entre(P, depuis_main=True)
            if n in SAGAS and P in self.perms:
                P["lore"] = 1
                self.chapitre(P)
            return
        self.perms.append(P)
        P["entree"] = self.t
        self.pose.setdefault(P["nom"], self.t)
        if k.get("rock") and k.get("immediat"):   # Poteau indicateur fallacieux lancé comme caillou
            self.pool.append([k["mana"], False, None])
        if n in SAGAS:
            P["lore"] = 1
            self.chapitre(P)
        elif kd == "e_aura":
            self.pose_aura(P, k)
        elif kd == "e_goad_aura":
            bc = self.meilleure_adv(lambda c: not self.prov(c))
            if bc:
                bc[1]["p"] += 2
                bc[1]["t"] += 2
                bc[1]["prov_perm"] = P
                P["sur_adv"] = bc[1]
        elif kd == "e_fealty":
            self.devient_monarque("moi")
            bc = self.meilleure_adv()
            if bc:
                a, c = bc
                a.creas.remove(c)
                Q = self.nouveau(None, jeton=True, jeton_pur=True, nomj="fealty", nom="volée", p0=c["p"], t0=c["t"],
                                 kws={"vol"} if c.get("vol") else set(), types=set(), pips=0)
                self.entre(Q)
                self.fealty = (Q, c)
        elif kd == "e_lame":
            self.equipe_lame(P)
        elif kd == "e_tamiyo":
            P["loyaute"] = 4
        elif kd == "e_sort_tap" and k["mode"] == "maze":      # Perdu dans le labyrinthe lancé en phase principale
            pass

    def pose_aura(self, P, k, cible=None):
        """Auras qui engagent : Claustrophobie, Collet à bulles, Perdre les bonnes grâces, Frappe étourdissante, Observed Stasis."""
        if k.get("monarque"):
            self.devient_monarque("moi")
        if cible is None:
            if k.get("kicker"):                  # Collet à bulles : sur une créature déjà engagée, sinon avec le kicker
                bc = self.meilleure_adv(lambda c: c.get("eng") and not c.get("verrou"))
                if bc is None:
                    bc = self.meilleure_adv(lambda c: not c.get("verrou"))
                    if bc and not self.paie_u(2):
                        P["sur_adv"] = bc[1]
                        bc[1]["verrou"] = P
                        return
            else:
                bc = self.meilleure_adv(lambda c: not c.get("verrou") and not c.get("neutre"))
        else:
            bc = cible
        if not bc:
            return
        a, c = bc
        P["sur_adv"] = c
        if k.get("neutralise"):
            c["neutre"] = P
            self.stat["e_neutralisees"] += 1
            self.pioche_eng(self.nb_eng(a))
        else:
            self.engage(a, c, verrou=P)

    def equipe_lame(self, P):
        bc = self.meilleure_adv(lambda c: not self.prov(c) and not c.get("verrou") and not self.neutre(c))
        if bc and self.paie(1):
            bc[1]["p"] += 2
            bc[1]["prov_perm"] = P
            P["sur_adv"] = bc[1]

    def sort_tap(self, mode):
        if mode == "sleep":
            a = max(self.vivants(), key=lambda a: (sum(c["p"] for c in a.creas if self.libre(c)), a is self.cible_tromo()))
            for c in a.creas:
                if self.libre(c):
                    self.engage(a, c, gel=1)
        elif mode == "cryptic":
            for a in self.vivants():
                for c in a.creas:
                    if self.libre(c):
                        self.engage(a, c)
            self.pioche(1)
        elif mode == "stun3":
            bc = self.meilleure_adv(lambda c: not c.get("verrou") and not self.neutre(c) and c.get("gel", 0) < 2)
            if bc:
                self.engage(bc[0], bc[1], gel=3)

    def etb_engag(self, P, depuis_main=False):
        k = P["k"]
        kd = k["kind"]
        if kd == "e_vague":
            mode = k["mode"]
            if mode == "scourge" or (mode == "slinn" and P.get("kick")):
                self.vague(mode)
            elif mode == "kederekt" and depuis_main:
                self.vague(mode, P)
        elif kd == "e_crea_tap":
            n = k.get("n", 1)
            if k.get("extra") and not self.paie(k["extra"]):     # Farfadette maîtresse entraveuse : {2} pour engager
                return False
            if n == "chaque":
                self.engage_chaque(gel=k.get("gel", 0))
            elif n == "tous":
                if depuis_main:
                    for a in self.vivants():
                        for c in a.creas:
                            self.engage(a, c, gel=1)
            else:
                self.engage_n(n, gel=k.get("gel", 0))
        elif kd == "e_amirale":
            self.devient_monarque("moi")
        elif kd == "e_benthid":                  # Benthide hypnotisant : deux Illusions 0/2 qui bloquent
            for _ in range(2):
                self.entre(self.nouveau(None, jeton=True, jeton_pur=True, nomj="illusion", nom="illusion", p0=0, t0=2,
                                        kws=set(), types={"Illusion"}, pips=0))
        return P not in self.perms

    # ---------------------------------------------------------------- avant le combat : rendre Tromokratis imblocable
    def cible_tromo(self):
        v = self.vivants()
        if not v:
            return None
        T = self.cmd_en_jeu()
        force = self.stats(T)[0] if T else 8

        def reste(a):
            return min(a.pv, 21 - a.dmg_cmd)
        return min(v, key=lambda a: (reste(a) > force, not self.steve(a), reste(a)))

    def avant_combat_engag(self):
        t = self.t
        for P in self.kperm("e_lame"):
            if P.get("sur_adv") is None:
                self.equipe_lame(P)
        for P in [P for P in self.kperm("e_crea_tap") if P["k"].get("noyeur") and P["entree"] < t]:
            # Noyeur de Fossecrue : {1}{U}, {T} : mélange une créature étourdie (et lui-même) dans les bibliothèques
            bc = self.meilleure_adv(lambda c: c.get("gel", 0) > 0)
            if bc and _m().valeur_adv(bc[1]) >= 6 and self.paie_u(1):
                bc[0].creas.remove(bc[1])
                self.perms.remove(P)
                self.stat["e_noyees"] += 1
        for P in self.kperm("e_tamiyo"):        # Tamiyo : −2 si un joueur a 4 créatures engagées, sinon +1
            m = max([self.nb_eng(a) for a in self.vivants()] or [0])
            if m >= 4 and P["loyaute"] >= 3:
                P["loyaute"] -= 2
                self.pioche_eng(m)
            else:
                P["loyaute"] += 1
                self.engage_n(1, gel=1)
        T = self.tromo()
        if not T or (T["entree"] == t and "celerite" not in self.stats(T)[2]):
            return
        a = self.cible_tromo()
        if a is None:
            return
        if T.get("imblocable") == t:
            self.stat["e_steve_kang"] += 1
            return
        deja = self.steve(a)
        if deja:
            self.stat["e_steve_vide" if not a.creas else "e_steve_gratuit"] += 1
        if any(self.C[n]["kind"] == "e_sort_tap" and self.C[n]["mode"] == "maze" for n in self.hand) and \
                self.lance_maze(a):
            self.stat["e_maze_lance"] += 1
            if not deja:
                self.stat["e_steve_maze"] += 1
            return
        if deja:
            return
        self.stat["e_steve_" + (self.rend_steve(a, T) or "rate")] += 1

    def lance_maze(self, a):
        """Perdu dans le labyrinthe avant d'attaquer : X créatures étourdies (d'abord sur la cible) + défense talismanique."""
        n = next(n for n in self.hand if self.C[n]["kind"] == "e_sort_tap" and self.C[n]["mode"] == "maze")
        k = self.C[n]
        besoin = 0 if self.steve(a) else 1
        if besoin and not self.cibles_libres(a):
            return False
        x = 0
        while x < 3 and self.peut_carte(k, extra=x + 1) and (x < besoin or len(self.choisit(x + 1)) > x):
            x += 1
        if x < besoin or not self.paie_carte(k, extra=x):
            return False
        self.hand.remove(n)
        self.stat["lances"] += 1
        self.apres_sort_engag(k)
        P = self.nouveau(k)
        self.perms.append(P)
        P["entree"] = self.t
        if besoin:
            self.engage_n(1, gel=1, a=a)
            x -= 1
        self.engage_n(x, gel=1)
        return True

    def rend_steve(self, a, T):
        def cibles():
            return self.cibles_libres(a)
        # Couronne d'hiver de Hylda : gratuite pendant ton tour (puis Minamo pour la réutiliser)
        for P in self.kperm("e_couronne"):
            if not P.get("utilise") and cibles():
                P["utilise"] = True
                self.engage_n(1, a=a)
                return "couronne"
        # Opposition : engager une de tes créatures qui n'attaquera pas
        if self.kperm("e_opposition") and cibles():
            tap = [Q for Q in self.creatures() if not Q.get("eng") and not Q.get("cmd")
                   and (Q["entree"] == self.t or self.stats(Q)[0] <= 3)]
            if tap:
                Q = min(tap, key=lambda Q: self.stats(Q)[0])
                Q["eng"] = True
                self.engage_n(1, a=a)
                return "opposition"
        for P in self.kperm("e_tolarian"):
            if cibles() and self.paie(1):
                self.engage_n(1, a=a)
                return "tolarian"
        if self.kperm("e_thassa") and self.paie_u(1):
            T["imblocable"] = self.t
            return "thassa"
        # sorts gardés en main
        for n in list(self.hand):
            k = self.C[n]
            kd = k["kind"]
            if kd == "e_sort_tap" and k["mode"] == "giga" and cibles() and self.paie_carte(k):
                self.hand.remove(n)
                self.gy.append(n)
                self.stat["lances"] += 1
                self.apres_sort_engag(k)
                self.engage_n(1, a=a)
                return "gigatorpeur"
            if kd == "e_crea_tap" and k.get("flash") and cibles() and self.paie_carte(k):
                self.hand.remove(n)
                self.stat["lances"] += 1
                self.apres_sort_engag(k)
                Q = self.nouveau(k)
                self.perms.append(Q)
                Q["entree"] = self.t
                self.engage_n(1, a=a)
                return "escroc"
            if kd == "e_sort_tap" and k["mode"] == "icy" and cibles():
                nb = sum(1 for b in self.vivants() if self.cibles_libres(b))
                x = 0
                while x < nb and self.peut_carte(k, extra=x + 1):
                    x += 1
                if x and self.paie_carte(k, extra=x):
                    self.hand.remove(n)
                    self.gy.append(n)
                    self.stat["lances"] += 1
                    self.apres_sort_engag(k)
                    self.engage_n(1, gel=1, a=a)
                    for b in self.vivants():
                        if b is not a and x > 1 and self.cibles_libres(b):
                            self.engage_n(1, gel=1, a=b)
                            x -= 1
                    return "salve"
        for P in self.kperm("e_couronne"):        # Minamo dégage la Couronne déjà utilisée
            if P.get("utilise") and self.a_terrain("Minamo, School at Water's Edge") and cibles() and self.paie_u(1):
                self.engage_n(1, a=a)
                return "minamo"

    # ---------------------------------------------------------------- ton combat
    def attaque_engag(self):
        M = _m()
        T = self.tromo()
        vues = [v for v in self.mes_vues() if v["p"] > 0 and not v["malade"] and not v["P"].get("eng")]
        if not vues or not self.vivants():
            return
        tv = next((v for v in vues if v["cmd"]), None) if T else None
        if tv:
            a = self.cible_tromo()
        else:
            a = min(self.vivants(), key=lambda b: b.pv - sum(v["p"] for v in vues if self.attaque_sure(v, self.bloqueurs(b))))
        dfn = self.bloqueurs(a)
        autres = [v for v in vues if v is not tv and (v["P"].get("nomj") == "fealty" or v["ephemere"] or self.attaque_sure(v, dfn)
                                                     or (self.kindp(v["P"]) == "e_amirale" and self.monarque is a))]
        if not tv and not autres:
            return
        att = ([tv] if tv else []) + autres
        for v in att:
            v["P"]["eng"] = True
            if self.kindp(v["P"]) == "e_crea_tap" and v["P"]["k"].get("attaque"):   # Titan de givre
                self.engage_n(1, gel=1, a=a)
        # Tromokratis : éphémère adverse pendant l'attaque (sauf Perdu dans le labyrinthe)
        if tv:
            self.stat["e_tromo_attaque"] += 1
            T["attaque"] = True
            if not self.maze_en_jeu():
                for b in self.vivants():
                    if self.rng_e.random() < b.a.get("retrait", 0) * RISQUE_ATTAQUE:
                        self.stat["e_tromo_tue_attaque"] += 1
                        T.pop("attaque", None)
                        self.meurt(T, exil=self.rng_e.random() < 0.4)
                        att.remove(tv)
                        tv = None
                        break
        degats, dmg_cmd = 0, 0
        bloque_tous = False
        if tv:
            p = tv["p"]
            bl = [c for c in a.creas if self.libre(c)]
            imbl = self.steve(a) or T.get("imblocable") == self.t
            if not imbl and bl:
                tue_t = sum(c["p"] for c in bl) >= tv["t"] or any(c.get("contact") for c in bl)
                letal = p >= a.pv or a.dmg_cmd + p >= 21
                if tue_t or letal or (len(bl) == 1 and bl[0]["jeton"]):
                    bloque_tous = True
                    self.stat["e_tromo_bloque"] += 1
                    reste = p
                    for c in sorted(bl, key=lambda c: c["t"]):
                        if reste >= c["t"]:
                            reste -= c["t"]
                            self.mort_adv(a, c)
                    if tue_t:
                        self.stat["e_tromo_mort_bloc"] += 1
                        T.pop("attaque", None)
                        self.meurt(T)
            if not bloque_tous:
                self.stat["e_tromo_passe"] += 1
                degats += p
                dmg_cmd = p
        T and T.pop("attaque", None)
        reste_att = [v for v in att if v is not tv]
        if reste_att and a.vivant():
            dfn = [] if bloque_tous else self.bloqueurs(a)
            for v in reste_att:
                if self.kindp(v["P"]) == "e_amirale" and self.monarque is a:
                    v["vol"] = True
            d, morts_a, morts_b, detail = M.resoudre(reste_att, dfn, a.pv - degats, lambda b: True)
            for b in morts_b:
                self.mort_adv(a, b)
            for v in morts_a:
                self.meurt(v["P"])
            degats += d
            if self.kperm("e_bident"):
                self.pioche(sum(1 for v in reste_att if detail.get(id(v))))
        if dmg_cmd and self.kperm("e_bident"):
            self.pioche(1)
        if dmg_cmd:
            a.dmg_cmd += dmg_cmd
            self.stat["e_dmg_cmd"] += dmg_cmd
            if self.monarque is None and self.kperm("e_archiviste"):
                self.devient_monarque("moi")
        if degats and self.monarque is a:
            self.devient_monarque("moi")
        self.perte(a, degats, "combat")
        if a.vivant() and a.dmg_cmd >= 21:
            self.perte(a, a.pv, "commandant")

    def bloqueurs(self, a):
        """Créatures dégagées de a qui peuvent bloquer (les dicts eux-mêmes, avec leur valeur à jour)."""
        M = _m()
        res = [c for c in a.creas if self.libre(c)]
        for c in res:
            c["valeur"] = M.valeur_adv(c)
        return res

    def maze_en_jeu(self):
        return any(P["k"].get("mode") == "maze" for P in self.kperm("e_sort_tap"))

    def fin_tour_engag(self):
        if self.monarque == "moi":
            n = 1 + len(self.kperm("e_archiviste"))
            self.stat["e_pioche_monarque"] += n
            self.pioche(n)
        for P in self.kperm("e_sly"):           # Instigateur sournois : provoque la plus grosse créature adverse
            if not P.get("eng") and P["entree"] < self.t:
                bc = self.meilleure_adv(lambda c: self.libre(c) and not self.prov(c))
                if bc and self.paie_u(0):
                    P["eng"] = True
                    bc[1]["prov"], bc[1]["prov_src"] = True, "sly"
                    self.stat["e_provoque"] += 1
        T = self.tromo()                          # Minamo : Tromokratis se dégage pour bloquer
        if T and T.get("eng") and self.a_terrain("Minamo, School at Water's Edge") and len(self.pool) >= 2 and self.paie_u(1):
            T["eng"] = False

    # ================================================================ tours adverses
    def degagement_adv(self, a):
        for c in a.creas:
            if c.get("neuve"):
                continue
            c.pop("force", None)
            v = c.get("verrou")
            if v is not None:
                if v not in self.perms:
                    c["verrou"] = None
                elif not (v.get("k") and v["k"].get("monarque") and self.monarque is a):
                    continue
            if c.get("gel", 0) > 0:
                c["gel"] -= 1
                continue
            c["eng"] = False
        a.force = False

    def avant_attaque_adv(self, a, dispo):
        """Début du combat adverse : Maeve provoque ; Bident et Menaces imaginaires forcent l'attaque sous Propagande."""
        propa = bool(self.kperm("e_propagande"))
        for P in self.kperm("e_maeve"):
            c = [c for c in dispo if not self.prov(c)]
            if c and self.paie_u(2):
                x = max(c, key=lambda c: c["p"])
                x["prov"], x["prov_src"] = True, "maeve"
                self.stat["e_provoque"] += 1
        if propa and len(dispo) >= 2:
            for P in self.kperm("e_bident"):
                if not P.get("utilise") and self.paie_u(1):
                    P["utilise"] = True
                    a.force = True
                    self.stat["e_force_attaque"] += 1
            if not a.force and len(dispo) >= 3:
                n = next((n for n in self.hand if self.C[n]["kind"] == "e_menaces"), None)
                if n and self.paie_carte(self.C[n]):
                    self.hand.remove(n)
                    self.gy.append(n)
                    a.force = True
                    a.gel_apres = True
                    self.stat["e_force_attaque"] += 1

    def attaque_adv_engag(self, a, rng):
        M = _m()
        dispo = [c for c in a.creas if c["p"] > 0 and (not c["neuve"] or c["celerite"]) and self.libre(c)]
        if not dispo:
            return
        autres = [b for b in self.vivants() if b is not a]
        moi_ok = self.pv > 0
        if not autres and not moi_ok:
            return
        self.avant_attaque_adv(a, dispo)
        propa = bool(self.kperm("e_propagande"))
        force = a.force or bool(self.kperm("e_turtle"))
        agressif = a.a.get("agressif") or self.t >= M.TOUR_FINAL

        def poids(b):
            if b is None:
                return (1 / max(self.pv, 1)) * (0.35 if propa else 1) * (2 if self.monarque == "moi" else 1)
            return (1 / max(b.pv, 1)) * (2 if self.monarque is b else 1)
        cibles = ([None] if moi_ok else []) + autres
        cible = rng.choices(cibles, weights=[poids(b) for b in cibles])[0]

        def autre_adv():
            return rng.choices(autres, weights=[poids(b) for b in autres])[0] if autres else None
        groupes = {}
        sur_moi = 0
        for c in sorted(dispo, key=lambda c: -c["p"]):
            oblige = force or self.prov(c)
            dest = cible
            if dest is None and (self.prov(c) or (propa and (oblige or sur_moi >= PROPAGANDE_MAX))):
                dest = autre_adv()
                if dest is None:
                    if self.prov(c) and not propa:
                        dest = None
                    else:
                        continue
            if not oblige and not agressif:
                dfn = [v for v in self.mes_vues() if not v["P"].get("eng")] if dest is None else self.bloqueurs(dest)
                if any(M.peut_bloquer(b, c) and M.tue(b, c) and not M.tue(c, b) for b in dfn):
                    continue
            if dest is None:
                sur_moi += 1
            groupes.setdefault(id(dest) if dest else None, (dest, []))[1].append(c)
        for cle, (dest, att) in groupes.items():
            if self.fin:
                return
            for c in att:
                c["valeur"] = M.valeur_adv(c)
            if dest is None:
                att, rediriges = self.repond_attaque(a, att, bool(autres))
                dfn = [v for v in self.mes_vues() if not v["P"].get("eng")]
                degats, morts_a, morts_b, detail = M.resoudre(att, dfn, self.pv, lambda b: b["jetable"])
                for c in morts_a:
                    self.mort_adv(a, c)
                for v in morts_b:
                    self.meurt(v["P"])
                self.moi_perd(degats, "combat")
                if degats and self.monarque == "moi":
                    self.devient_monarque(a)
                b = autre_adv() if rediriges else None
                if b is not None and not self.fin:      # attaquants redirigés vers un autre adversaire
                    self.combat_entre(a, b, rediriges)
                    att = att + rediriges
            else:
                self.combat_entre(a, dest, att)
            for c in att:                         # les attaquants restent engagés (ceux retirés du combat ne sont plus dans att)
                if c in a.creas:
                    c["eng"] = True

    def combat_entre(self, a, dest, att):
        """Les créatures att de l'adversaire a attaquent l'adversaire dest."""
        M = _m()
        dfn = self.bloqueurs(dest)
        degats, morts_a, morts_b, detail = M.resoudre(att, dfn, dest.pv, lambda b: True)
        for c in morts_a:
            self.mort_adv(a, c)
        for b in morts_b:
            self.mort_adv(dest, b)
        self.perte(dest, degats, "combat_adv")
        if degats and self.monarque is dest:
            self.devient_monarque(a)
        for c in att:
            if c.get("prov_src") == "maeve":
                self.pioche_eng(1)
            if c.get("prov_src") == "kang" and detail.get(id(c)):
                self.pioche_eng(1)
        self.stat["e_attaques_entre_adv"] += 1

    def repond_attaque(self, a, att, autres=True):
        """Attaquants déclarés sur toi : Labyrinthe d'Ith, redirections (Pari de l'illusionniste, Mage du portail,
        Poteau indicateur fallacieux), auras à flash, Labyrinthe mystificateur. Renvoie (attaquants restants, redirigés)."""
        att = sorted(att, key=lambda c: -c["p"])
        rediriges = []
        if att and self.a_terrain("Maze of Ith") and not self.maze_ith:
            att.pop(0)                            # dégagée, ses blessures sont prévenues
            self.maze_ith = True
            self.stat["e_ith"] += 1
        total = sum(c["p"] for c in att)
        if autres and att and (total >= 6 or total * 2 >= self.pv):
            n = next((n for n in self.hand if self.C[n]["kind"] == "e_gambit"), None)
            if n and self.paie_carte(self.C[n]):
                self.hand.remove(n)
                self.gy.append(n)
                self.stat["lances"] += 1
                self.stat["e_rediriges"] += len(att)
                return [], att
        for n in [n for n in self.hand if self.C[n]["kind"] == "e_redirect"]:
            if not autres or not att or att[0]["p"] < 3:
                break
            k = self.C[n]
            if not self.paie_carte(k):
                continue
            self.hand.remove(n)
            self.stat["lances"] += 1
            P = self.nouveau(k)
            if k["creature"]:
                self.entre(P)
            else:
                self.perms.append(P)
                P["entree"] = self.t
            rediriges.append(att.pop(0))
            self.stat["e_rediriges"] += 1
        total = sum(c["p"] for c in att)
        for n in [n for n in self.hand if self.C[n]["kind"] == "e_aura" and self.C[n].get("flash")]:
            if not att or not (total >= 6 or total * 2 >= self.pv):
                break
            k = self.C[n]
            if not self.paie_carte(k):
                continue
            self.hand.remove(n)
            self.stat["lances"] += 1
            self.apres_sort_engag(k)
            c = att.pop(0)
            P = self.nouveau(k)
            self.perms.append(P)
            P["entree"] = self.t
            self.pose_aura(P, k, cible=(a, c))
            self.stat["e_retire_combat"] += 1
            total = sum(c["p"] for c in att)
        if att and self.a_terrain("Mystifying Maze") and not self.maze_myst and (total >= 5 or total >= self.pv) and self.paie(5):
            c = att.pop(0)
            self.maze_myst = True
            a.creas.remove(c)
            self.myst_retour.append((a, c))
            self.stat["e_retire_combat"] += 1
        return att, rediriges

    def fin_tour_adv_engag(self, a):
        for b, c in self.myst_retour:
            if b.vivant():
                c["eng"] = True
                b.creas.append(c)
        self.myst_retour = []
        if getattr(a, "gel_apres", False):
            for c in a.creas:
                c["gel"] = max(c.get("gel", 0), 1)
            a.gel_apres = False
        elif a.vivant() and self.nb_eng(a) >= 3:          # Menaces imaginaires à la fin de son tour : ses attaquants restent engagés
            n = next((n for n in self.hand if self.C[n]["kind"] == "e_menaces"), None)
            if n and self.paie_carte(self.C[n]):
                self.hand.remove(n)
                self.gy.append(n)
                for c in a.creas:
                    c["gel"] = max(c.get("gel", 0), 1)
                self.stat["e_gelees"] += self.nb_eng(a)
