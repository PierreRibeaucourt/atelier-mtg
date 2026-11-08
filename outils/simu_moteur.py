"""Moteur générique du simulateur Commander à 4 joueurs : ton deck, carte par carte, contre 3 adversaires-archétypes.

Les cartes arrivent de simu_cartes : soit avec un comportement écrit à la main (kind), soit avec des effets lus
automatiquement dans leur texte Oracle (effets / statiques / activables). Chaque permanent que tu contrôles est un objet
(dict) : carte, jeton, commandant, avec ses bonus du tour, ses équipements et ses marqueurs.

Un tour de table = ton tour puis les 3 tours adverses. La partie s'arrête quand tu es le dernier en vie (victoire),
quand tu meurs ou qu'un combo adverse passe (défaite), ou au tour T_MAX (partie pas finie).
Hasard : ta pioche dépend de `graine` ; ce que fait l'adversaire j au tour t dépend de (graine, t, j) seulement,
donc deux listes jouées avec la même graine affrontent exactement les mêmes adversaires.
"""
import random
from collections import Counter

from simu_adversaires import ARCHETYPES, MODELES, TOUR_FINAL
from simu_cartes import JETABLES, VALEUR_KIND, VALEUR_PERM
from simu_engage import Engagement

T_MAX = 15
# kinds « e_… » : mode engagement (simu_engage.py), seulement pour les decks qui en contiennent
ORDRE_ENGAG = ["e_kefnet", "e_propagande", "e_couronne", "e_opposition", "e_contemplation", "e_lame", "e_bident", "e_thassa",
               "e_aura", "e_goad_aura", "e_fealty", "e_saga", "e_tamiyo", "e_sort_tap", "e_vague", "e_pioche_eng", "e_tazeem",
               "e_crea_tap", "e_tolarian", "e_maeve", "e_sly", "e_archiviste", "e_amirale", "e_turtle", "e_benthid",
               "e_redirect", "e_menaces", "e_gambit"]
ORDRE = ["rock", "a_ramp"] + ORDRE_ENGAG + ["wipe1", "wipe", "nightinc", "a_rase",
         "dawn", "vat", "gift", "brink", "sneak", "echoes", "rite", "a_moteur", "clamp", "blade", "a_equip",
         "dt", "fab", "mage", "sidisi", "gate", "ophio", "attrition", "bitter", "soulstoke", "thunderkin", "spitter", "necro", "servant",
         "sheoW", "konrad", "sheoA", "bastion", "butcher", "demon", "wurm", "archon", "gray", "reaper", "opportunist",
         "maraud", "remcrea", "remsort", "a_removal", "evoke", "exploit",
         "appeal", "nova", "cinder", "a_crea", "corps", "supplier", "a_reanime", "encore", "serpent",
         "vrites", "sacdraw", "solemn", "jeska", "geyser", "a_pioche", "study", "autre", "a_autre"]
CHOIX_AUBE = ["gray", "archon", "maraud", "sheoA", "wurm", "demon", "butcher", "remcrea", "evoke"]     # retour pour un tour (Kels)
CHOIX_GIFT = ["sheoW", "archon", "maraud", "sheoA", "wurm", "gray", "butcher", "remcrea", "evoke"]
CHOIX_PERM = ["sheoW", "gray", "archon", "sheoA", "maraud", "wurm", "demon", "butcher", "remcrea", "evoke"]  # retour définitif
DRAINS = ("konrad", "bastion", "butcher", "wurm")
# pilote « salve » : créatures gardées en main jusqu'au tour de l'explosion
SALVE = ("a_crea", "nova", "serpent", "appeal", "cinder")
# Réglages de jeu d'un deck (fichier pilote.json du deck, ou paramètre reglages de Partie) :
# pilote « vite » ou « salve » ; salve_pv : on arrête d'attendre sous ces PV ; salve_main : main maximale avant de lancer ;
# salve_nb : nombre de créatures lançables pour déclencher la salve ; greven_main / greven_pv : Greven pioche pour remonter à
# greven_main cartes sans descendre sous greven_pv PV ; premier : cartes lancées avant tout le reste dès qu'on peut les payer ;
# garder : cartes gardées en main jusqu'à une salve, quel que soit le pilote.
REGLAGES_DEFAUT = dict(pilote="vite", salve_pv=15, salve_main=7, salve_nb=3, greven_main=5, greven_pv=10, premier=[], garder=[])
UNIQUES = ("dawn", "vat", "gift", "ophio", "bitter", "attrition", "vrites", "brink", "sneak", "echoes", "rite", "clamp", "blade")
JETONS = {"snake": dict(p=1, t=1, kws={"contact"}), "faerie": dict(p=1, t=1, kws={"vol"}), "goat": dict(p=0, t=1),
          "human": dict(p=1, t=1), "vole": dict(p=3, t=3), "rager": dict(p=5, t=1, kws={"pietine", "celerite"}, types={"Elemental"}),
          "spark": dict(p=3, t=1, kws={"pietine", "celerite"}, types={"Elemental"}), "elem11": dict(p=1, t=1, types={"Elemental"}),
          "appeal": dict(p=7, t=1, kws={"pietine", "celerite"}, types={"Elemental"}), "zombie": dict(p=2, t=2)}
COULEUR = {"red": "R", "black": "B", "blue": "U", "white": "W", "green": "G"}


# ---------------------------------------------------------------- combat (commun à tous les joueurs)
def peut_bloquer(b, a):
    if a.get("vol") and not (b.get("vol") or b.get("portee")):
        return False
    if a.get("peur") and not b.get("noir", False):
        return False
    return not b.get("ne_bloque_pas")


def tue(x, y):
    return x["p"] > 0 and (x.get("contact") or x["p"] >= y["t"])


def resoudre(att, dfn, pv_def, jetable):
    """Combat simplifié : un bloqueur par attaquant (deux pour la menace). Le défenseur fait d'abord les blocages
    gagnants, puis les murs, puis les échanges avec ses créatures jetables, et ne fait de blocages-suicide que si
    les dégâts seraient mortels. Double initiative : l'attaquant frappe deux fois, les bloqueurs tués au premier coup
    ne ripostent pas. Renvoie (dégâts au joueur, attaquants morts, bloqueurs morts, {id attaquant: dégâts au joueur})."""
    libres = [b for b in dfn if not b.get("ne_bloque_pas")]
    blocs = {}
    ordre = sorted(att, key=lambda a: -a["p"])
    etapes = [
        lambda a, b: tue(b, a) and not tue(a, b),
        lambda a, b: not tue(a, b) and b["t"] > 0,
        lambda a, b: tue(b, a) and jetable(b) and b["valeur"] < a["valeur"],
    ]
    for ok in etapes:
        for a in ordre:
            if id(a) in blocs or a.get("menace"):
                continue
            c = [b for b in libres if peut_bloquer(b, a) and ok(a, b)]
            if c:
                b = min(c, key=lambda b: b["valeur"])
                blocs[id(a)] = [b]
                libres.remove(b)

    def frappe(a):
        return a["p"] * (2 if a.get("df") else 1)

    def passe():
        return sum(frappe(a) for a in att if id(a) not in blocs)
    for a in ordre:
        if passe() < pv_def:
            break
        if id(a) in blocs:
            continue
        besoin = 2 if a.get("menace") else 1
        c = sorted([b for b in libres if peut_bloquer(b, a)], key=lambda b: b["valeur"])
        if len(c) >= besoin:
            blocs[id(a)] = c[:besoin]
            for b in c[:besoin]:
                libres.remove(b)
    degats, morts_a, morts_b, detail = 0, [], [], {}
    for a in att:
        if id(a) not in blocs:
            detail[id(a)] = frappe(a)
            degats += frappe(a)
            continue
        bs = blocs[id(a)]
        vivants = list(bs)
        passe_a = 0
        for coup in range(2 if a.get("df") else 1):
            reste = a["p"]
            for b in list(vivants):
                besoin = 1 if a.get("contact") else b["t"]
                if reste >= besoin and reste > 0:
                    morts_b.append(b)
                    vivants.remove(b)
                    reste -= besoin
                else:
                    reste = 0
                    break
            if a.get("pietine") and not vivants:
                passe_a += reste
        ripostent = vivants if a.get("df") else bs
        if any(b.get("contact") and b["p"] > 0 for b in ripostent) or sum(b["p"] for b in ripostent) >= a["t"]:
            morts_a.append(a)
        if passe_a:
            detail[id(a)] = passe_a
            degats += passe_a
    return degats, morts_a, morts_b, detail


def valeur_adv(c):
    return c["p"] + c["t"] + (0 if c["jeton"] else 2) + (2 if c.get("vol") else 0) + (3 if c.get("hexproof") else 0) + (4 if c.get("cmd") else 0)


class Adversaire:
    def __init__(self, i, nom):
        self.i, self.nom, self.a = i, nom, ARCHETYPES[nom]
        self.pv, self.creas, self.cim, self.crea_cim, self.dmg_cmd = 40, [], 0, 0, 0
        self.contre_pris, self.aristo, self.renvois = False, False, []
        self.cmd_retour = self.a["commandant"]["tour"]

    def vivant(self):
        return self.pv > 0


class Partie(Engagement):
    def __init__(self, C, cmd, deck, archetypes, graine, pilote="vite", reglages=None):
        """pilote : « vite » lance tout dès que possible ; « salve » garde ses créatures pour un gros tour (voir tient_salve).
        reglages : voir REGLAGES_DEFAUT (une clé « pilote » dans reglages l'emporte sur le paramètre pilote)."""
        self.C, self.cmd, self.graine = C, cmd, graine
        self.R = {**REGLAGES_DEFAUT, "pilote": pilote, **(reglages or {})}
        self.pilote, self.salve_tour = self.R["pilote"], None
        self.kc = C[cmd]
        self.rng = random.Random(f"{graine}-moi")
        self.adv = [Adversaire(i, a) for i, a in enumerate(archetypes)]
        for a in self.adv:
            if a.a.get("aristo"):
                a.aristo = random.Random(f"{graine}-aristo-{a.i}").random() < a.a["aristo"][1]
        self.pv = 40
        self.gy, self.perms, self.terrains = [], [], []
        self.tresors, self.pool = 0, []
        self.taxe, self.cmd_tour = 0, None
        self.imprint, self.saga, self.E, self.t = None, 0, 0, 0
        self.en_mon_tour = False
        self.seg_mort = self.opport = False
        self.sacs = 0
        self.pv_perdu_tour = 0
        self.pas_bloquer = 0
        self.phase2 = False
        self.vat_fait = False
        self.fin = None
        self.stat = Counter()
        self.pose = {}
        self.main_depart(deck)
        self.init_engag()

    # ================================================================ outils de base
    def kind(self, n):
        return self.C[n]["kind"] if n in self.C else None

    def kindp(self, P):
        return P["k"]["kind"] if P.get("k") else "jeton"

    def sur(self, kind):
        return any(P.get("k") and P["k"]["kind"] == kind for P in self.perms)

    def perm(self, kind):
        return next((P for P in self.perms if P.get("k") and P["k"]["kind"] == kind), None)

    def vivants(self):
        return [a for a in self.adv if a.vivant()]

    def pioche(self, n):
        for _ in range(int(n) if n != "X" else 2):
            if self.lib:
                self.hand.append(self.lib.pop(0))

    def cmd_en_jeu(self):
        return next((P for P in self.perms if P.get("cmd")), None)

    def est_crea(self, P):
        return P["k"]["creature"] if P.get("k") and not P.get("jeton_pur") else True

    def creatures(self):
        return [P for P in self.perms if self.est_crea(P)]

    def devotion(self):
        return sum(P.get("pips", 0) for P in self.perms)

    def nouveau(self, k=None, jeton=False, **kw):
        """Nouveau permanent : carte (k), copie-jeton d'une carte (k, jeton=True) ou jeton pur (nomj=...)."""
        P = dict(k=k, jeton=jeton, entree=self.t, bonus_p=0, bonus_t=0, compteurs=0, hate=False, fin=None, kws_tmp=set())
        if k:
            P.update(nom=k["nom"], p0=k["p"], t0=k["t"], kws=set(k["kw"]), types=set(k["sous_types"]), pips=k["pips"])
        P.update(kw)
        return P

    def jeton(self, nomj, **kw):
        d = JETONS[nomj]
        return self.nouveau(None, jeton=True, jeton_pur=True, nomj=nomj, nom=nomj, p0=d["p"], t0=d["t"], kws=set(d.get("kws", ())),
                            types=set(d.get("types", ())), pips=0, **kw)

    # ---------------------------------------------------------------- caractéristiques d'une créature
    def statiques(self):
        for Q in self.perms:
            if Q.get("k"):
                for s in Q["k"]["statiques"]:
                    yield Q, s

    def stats(self, P):
        p = P["p0"] + P["bonus_p"] - P["compteurs"]
        t = P["t0"] + P["bonus_t"] - P["compteurs"]
        kws = set(P["kws"]) | P["kws_tmp"]
        for Q, s in self.statiques():
            if s["s"] == "anthem" and (not s["type"] or s["type"] in P["types"]) and not (s["autres"] and Q is P):
                p += s["p"]
                t += s["t"]
            elif s["s"] == "hate" and (not s["type"] or s["type"] in P["types"]):
                kws.add("celerite")
            elif s["s"] in ("equip_bonus", "equip_mots") and Q.get("sur") is P:
                if s["s"] == "equip_bonus":
                    p += s["p"]
                    t += s["t"]
                else:
                    kws |= set(s["kws"])
        for Q in self.perms:
            k = Q.get("k")
            if not k:
                continue
            if k["kind"] == "soulstoke" and Q is not P and "Elemental" in P["types"]:
                p += 1
                t += 1
            elif k["kind"] == "clamp" and Q.get("sur") is P:
                p += 1
                t -= 1
            elif k["kind"] == "blade" and Q.get("sur") is P:
                p += 3
                t += 1
        if P.get("cmd") and self.kc["kind"] == "greven":
            p += self.pv_perdu_tour
        if P.get("hate"):
            kws.add("celerite")
        if P.get("cmd") and self.kc["kind"] == "tromo" and not P.get("attaque"):   # défense talismanique sauf en attaquant
            kws.add("hexproof")
        if P.get("nom") == "Thunderblust" and P["compteurs"]:
            kws.add("pietine")
        return p, t, kws

    def valeur(self, P):
        k = P.get("k")
        if P.get("cmd"):
            return 9
        if k and k["kind"] in VALEUR_KIND:
            return VALEUR_KIND[k["kind"]]
        p, t, _ = self.stats(P)
        if k and k["kind"] == "a_moteur":
            return 7
        return p + t - (2 if P.get("fin") or (k and k.get("ephemere")) else 0)

    def jetable(self, P):
        k = P.get("k")
        return P.get("jeton_pur") or P.get("fin") or (k and (k["kind"] in JETABLES or k.get("ephemere")) and not P.get("cmd"))

    def neriv(self, P):
        """2 si la créature P est arrivée ce tour (sur ton tour) et que Neriv est en jeu, sinon 1."""
        if P is None or P.get("entree") != self.t or not self.en_mon_tour:
            return 1
        return 2 if any(s["s"] == "double_neuves" for _, s in self.statiques()) else 1

    def vue(self, P):
        p, t, kws = self.stats(P)
        mult = (2 if any(s["s"] == "double_degats" for _, s in self.statiques()) else 1) * self.neriv(P)
        return dict(P=P, p=p * mult, pbase=p, t=t, vol="vol" in kws, menace="menace" in kws, contact="contact" in kws,
                    pietine="pietine" in kws, celerite="celerite" in kws, peur="peur" in kws, marais="marais" in kws,
                    ne_bloque_pas=any(s["s"] == "pas_bloquer" for s in (P["k"]["statiques"] if P.get("k") else [])),
                    malade=P["entree"] == self.t and "celerite" not in kws, valeur=self.valeur(P), jetable=self.jetable(P),
                    ephemere=bool(P.get("fin") or (P.get("k") and P["k"].get("ephemere"))), kind=self.kindp(P), cmd=P.get("cmd", False))

    def mes_vues(self):
        return [self.vue(P) for P in self.creatures()]

    # ================================================================ main de départ (London, 1er mulligan gratuit)
    def main_depart(self, deck):
        """Garde 3 à 5 terrains (ou 2 avec un caillou) ; après le mulligan gratuit, 2 à 5 terrains ; la 4e main est gardée."""
        for essai in range(4):
            lib = deck[:]
            self.rng.shuffle(lib)
            main, lib = lib[:7], lib[7:]
            garde = 7 - max(0, essai - 1)
            terrains = sum(1 for c in main if self.C[c]["terrain"])
            caillou = any(self.kind(c) == "rock" and self.C[c]["mv"] <= 2 for c in main)
            if 3 <= terrains <= 5 or (terrains == 2 and (caillou or essai >= 1)) or essai == 3:
                break
        while len(main) > garde:          # on remet dessous : terrains en trop, sinon le sort le plus cher
            n_t = sum(1 for c in main if self.C[c]["terrain"])
            c = next((c for c in main if self.C[c]["terrain"]), None) if n_t > 4 else max(
                (c for c in main if not self.C[c]["terrain"]), key=lambda c: self.C[c]["mv"], default=main[0])
            main.remove(c)
            lib.append(c)
        self.hand, self.lib = main, lib
        if "Leyline of Anticipation" in self.hand:
            self.hand.remove("Leyline of Anticipation")
            self.perms.append(self.nouveau(self.C["Leyline of Anticipation"]))

    # ================================================================ mana
    def besoin(self):
        b = Counter()
        for n in self.hand:
            for p in self.C[n]["cout"][1]:
                for c in p:
                    b[c] += 1
        return b

    def a_couleur(self, c):
        return any(c in x[1] for x in self.terrains) or any(c in P["k"].get("mana", "") for P in self.perms if self.kindp(P) == "rock")

    def joue_terrain(self):
        main = [c for c in self.hand if self.C[c]["terrain"]]
        if not main:
            return
        b = self.besoin()
        manque = [c for c in "WUBRG" if b[c] and not self.a_couleur(c)]
        types_en_jeu = set().union(*[self.C[x[0]]["types_terrain"] for x in self.terrains]) if self.terrains else set()

        def prete(n):
            k = self.C[n]
            r = k.get("regle")
            if not r:
                return True
            code, arg = r
            if code == "fetch" or code == "engage":
                return False
            if code == "controle":
                return bool(arg & types_en_jeu)
            if code == "bases2":
                return sum(1 for x in self.terrains if self.C[x[0]]["base"]) >= 2
            if code == "autres2":
                return len(self.terrains) >= 2
            if code == "revele":
                return any(c != n and ((self.C[c]["types_terrain"] & arg) if self.C[c]["terrain"] else (arg & self.C[c]["sous_types"]))
                           for c in self.hand)
            return True

        def valeur(n):
            coul = self.C[n]["mana"]
            return (bool(coul), (not prete(n)) if self.t == 1 else prete(n), any(c in coul for c in manque), len(coul) > 1, coul != "C")
        n = max(main, key=valeur)
        self.hand.remove(n)
        r = self.C[n].get("regle") or (None, None)
        if r[0] == "fetch":
            self.cherche_base(pret=False)
            return
        coul = self.C[n]["mana"]
        if r[0] == "pathway":
            coul = next((c for c in coul if c in manque), coul[-1])
        elif r[0] == "tainted":
            coul = "tainted"
        elif r[0] == "realms":
            coul = "realms"
        self.terrains.append([n, coul, prete(n)])

    def cherche_base(self, pret=False):
        b = self.besoin()
        bases = [c for c in set(self.lib) if self.C[c]["terrain"] and self.C[c]["base"]]
        if not bases:
            return
        base = max(bases, key=lambda c: (sum(b[x] for x in self.C[c]["mana"]) - sum(1 for t in self.terrains if self.C[c]["mana"] in t[1]), c))
        self.lib.remove(base)
        self.rng.shuffle(self.lib)
        self.terrains.append([base, self.C[base]["mana"], pret])

    def identite(self):
        return "".join(c for c in "WUBRG" if c in self.kc["couleurs"]) or "C"

    def construit_pool(self):
        marais = any("Swamp" in self.C[x[0]]["types_terrain"] for x in self.terrains)
        self.pool = []
        for n, coul, pret in self.terrains:
            if not pret or not coul:           # terrain qui ne produit pas de mana (Labyrinthe d'Ith)
                continue
            if coul == "tainted":
                self.pool.append([("UB" if marais else "C"), False, None])
            elif coul == "realms":
                self.pool.append(["C", False, ("realms", "Elemental")])
            else:
                self.pool.append([coul, False, None])
        for P in self.perms:
            k = P.get("k")
            if k and (k["kind"] == "rock" or k.get("rock")) and (k.get("immediat") or P["entree"] < self.t):
                restr = ("type", k["restriction"]) if k.get("restriction") else None
                for _ in range(k.get("mana_n", 1)):
                    self.pool.append([k["mana"], False, restr])
        self.pool += [[self.identite(), True, None] for _ in range(self.tresors)]
        self.stat[f"dispo{self.t}"] = len(self.pool)

    def plan(self, g, pips, types=frozenset()):
        """Choisit les sources de mana pour payer g génériques + pips colorés. types : sous-types du sort (mana réservé)."""
        pool = self.pool
        dispo = []
        for i, (coul, tres, restr) in enumerate(pool):
            if restr and restr[0] == "type" and restr[1] not in types:
                continue
            if restr and restr[0] == "realms":
                coul = self.identite() if restr[1] in types else "C"
            dispo.append((i, coul, tres, restr is not None))
        ordre = sorted(dispo, key=lambda x: (x[2], not x[3], 0 if x[1] == "C" else len(x[1])))   # réservé d'abord, trésors en dernier
        coul_de = {i: c for i, c, _, _ in dispo}
        pris = {}

        def essaie(pi, vus):
            for i, coul, _, _ in ordre:
                if i in vus or coul == "C" or not any(c in coul for c in pips[pi]):
                    continue
                vus.add(i)
                if i not in pris or essaie(pris[i], vus):
                    pris[i] = pi
                    return True
            return False
        for pi in sorted(range(len(pips)), key=lambda i: len(pips[i])):
            if not essaie(pi, set()):
                return None
        b = self.besoin()
        reste = sorted((x for x in ordre if x[0] not in pris),
                       key=lambda x: (x[2], not x[3], 0 if x[1] == "C" else 1 + 10 * (len(x[1]) > 1) + sum(b[c] for c in x[1])))
        if g > len(reste):
            return None
        _ = coul_de
        return list(pris) + [x[0] for x in reste[:g]]

    def peut(self, g, pips=(), types=frozenset()):
        return self.plan(g, pips, types) is not None

    def paie(self, g, pips=(), types=frozenset()):
        p = self.plan(g, pips, types)
        if p is None:
            return False
        for i in sorted(p, reverse=True):
            if self.pool[i][1]:
                self.tresors -= 1
            self.pool.pop(i)
        self.stat[f"depense{self.t}"] += len(p)
        return True

    def ajoute_mana(self, n, coul=None):
        for _ in range(n):
            self.pool.append([coul or self.identite(), False, None])

    def tresor(self):
        self.tresors += 1
        self.pool.append([self.identite(), True, None])

    def cout(self, k, alt=None):
        g, pips = alt or k["cout"]
        for Q, s in self.statiques():
            if s["s"] == "reduction" and (not s["couleur"] or any(
                    COULEUR.get(c) in k["couleurs"] or c.capitalize() in k["sous_types"]
                    for c in (s["couleur"], s.get("autre")) if c)):
                g -= s["n"]
        if any(s["s"] == "reduc_creatures" for s in k["statiques"]):
            g -= len(self.creatures()) + sum(len(a.creas) for a in self.vivants())
        if self.engag and k["creature"] and "U" in k["couleurs"]:      # Monument de Kefnet
            g -= len(self.kperm("e_kefnet"))
        return max(0, g), pips

    def paie_carte(self, k, alt=None, extra=0):
        g, pips = self.cout(k, alt)
        return self.paie(g + extra, pips, frozenset(k["sous_types"]))

    def peut_carte(self, k, alt=None, extra=0):
        g, pips = self.cout(k, alt)
        return self.peut(g + extra, pips, frozenset(k["sous_types"]))

    # ================================================================ PV
    def moi_perd(self, x, cause):
        if self.fin or x <= 0:
            return
        self.pv -= x
        self.pv_perdu_tour += x
        self.stat["perdu_" + cause] += x
        if self.pv <= 0:
            self.fin = ("defaite", cause)

    def perte(self, a, x, src):
        """L'adversaire a perd x PV. Renvoie ce qu'il a vraiment perdu."""
        if not a.vivant() or x <= 0:
            return 0
        x = min(x, a.pv)
        a.pv -= x
        self.stat["dmg_" + src] += x
        if a.pv <= 0:
            a.creas = []
            self.stat["elim_" + src] += 1
            if not self.vivants() and not self.fin:
                self.fin = ("victoire", src)
        return x

    def chaque(self, x, src):
        return sum(self.perte(a, x, src) for a in self.vivants())

    def draine(self, x, src):
        self.pv += self.chaque(x, src)

    def cible_faible(self):
        v = self.vivants()
        return min(v, key=lambda a: a.pv) if v else None

    # ================================================================ adversaires : morts, ciblages
    def mort_adv(self, a, c):
        """La créature c de l'adversaire a meurt (sacrifiée, détruite, au combat...)."""
        if c not in a.creas:
            return
        a.creas.remove(c)
        if c.get("cmd"):
            a.cmd_retour = self.t + 2
        self.stat["morts_adv"] += 1
        self.seg_mort = True
        a.cim += 1
        if not c["jeton"]:
            a.crea_cim += 1
        if self.sur("demon"):
            self.E += 1
        if self.sur("konrad"):
            self.chaque(1, "konrad")
        if self.sur("wurm"):
            self.perte(a, 2, "wurm")
        for Q in list(self.perms):
            for e in (Q["k"]["effets"] if Q.get("k") else []):
                if e["quand"] in ("toute_mort", "adv_meurt"):
                    self.execute(e, Q, cible_adv=a)
        if a.aristo and self.t >= a.a["aristo"][0]:
            self.moi_perd(1, "aristo")
            for b in self.vivants():
                if b is not a:
                    self.perte(b, 1, "aristo_adv")
        self.opportuniste()

    def edict_adv(self, nontoken=False, n=1):
        for a in self.vivants():
            for _ in range(n):
                c = [x for x in a.creas if not (nontoken and x["jeton"])]
                if c:
                    self.mort_adv(a, min(c, key=valeur_adv))

    def tue_une(self, nonblack=False, max_t=None, exil=False):
        """Tu détruis (ou exiles) la meilleure créature adverse que tu peux cibler."""
        c = [(a, x) for a in self.vivants() for x in a.creas
             if not x.get("hexproof") and not (nonblack and x["noir"]) and (max_t is None or x["t"] <= max_t)]
        if c:
            a, x = max(c, key=lambda ax: valeur_adv(ax[1]))
            if exil:
                a.creas.remove(x)
            else:
                self.mort_adv(a, x)
            return True
        return False

    def renvoie_une(self):
        c = [(a, x) for a in self.vivants() for x in a.creas if not x.get("hexproof")]
        if c:
            a, x = max(c, key=lambda ax: valeur_adv(ax[1]))
            a.creas.remove(x)
            a.renvois.append(x)

    def degats_cible(self, n, cible, src=None, source="sort"):
        """Dégâts « any target » ou « target creature » : tue une menace si ça vaut le coup, sinon vise un joueur."""
        if n <= 0:
            return
        if cible == "chaque_adv":
            self.chaque(n, source)
            return
        menaces = [(a, x) for a in self.vivants() for x in a.creas if not x.get("hexproof") and x["t"] <= n]
        meilleure = max(menaces, key=lambda ax: valeur_adv(ax[1]), default=None)
        if cible == "crea" or (meilleure and valeur_adv(meilleure[1]) >= 9 and n < (self.cible_faible().pv if self.cible_faible() else 99)):
            if meilleure:
                self.mort_adv(*meilleure)
            return
        a = self.cible_faible()
        if a:
            self.perte(a, n, source)

    def degats_tous(self, n, moi=True, sauf=None):
        for a in self.vivants():
            for c in [c for c in a.creas if c["t"] <= n]:
                self.mort_adv(a, c)
        if moi:
            protege = self.kc["kind"] == "kels" and self.kels_indestructible() if n >= 4 else False
            for P in list(self.creatures()):
                if P is sauf or (P.get("cmd") and protege):
                    continue
                if self.stats(P)[1] <= n:
                    self.meurt(P)

    def moins_x(self, x, moi=True, sauf=None):
        for a in self.vivants():
            for c in [c for c in a.creas if c["t"] <= x]:
                self.mort_adv(a, c)
        if moi:
            for P in list(self.creatures()):
                if P is not sauf and self.stats(P)[1] <= x:
                    self.meurt(P)

    def rase(self, tempest=False, seulement_adv=False):
        """Détruit toutes les créatures. Kels peut devenir indestructible en réponse ({1} + sacrifier une créature)."""
        for a in self.vivants():
            if tempest:
                self.perte(a, len(a.creas), "tempest")
            for c in list(a.creas):
                self.mort_adv(a, c)
        if seulement_adv:
            return
        protege = self.kc["kind"] == "kels" and self.kels_indestructible()
        for P in list(self.creatures()):
            if P.get("cmd") and protege:
                continue
            self.meurt(P)

    # ================================================================ tes permanents : arrivées et morts
    def entre(self, P, depuis_main=False):
        """Un permanent arrive sous ton contrôle : effets d'arrivée, puis déclencheurs des autres."""
        self.perms.append(P)
        P["entree"] = self.t
        if P.get("k"):
            self.pose.setdefault(P["nom"], self.t)
        if P.get("k") and P["k"]["kind"] == "rock" and P["k"].get("immediat") and not P.get("jeton"):
            restr = ("type", P["k"]["restriction"]) if P["k"].get("restriction") else None
            for _ in range(P["k"].get("mana_n", 1)):
                self.pool.append([P["k"]["mana"], False, restr])
        if not self.est_crea(P):
            if P.get("k") and P["k"]["kind"] == "bastion":
                self.entre(self.jeton("human"))
            elif P.get("k"):
                for e in P["k"]["effets"]:
                    if e["quand"] == "etb":
                        self.execute(e, P)
            return
        puissance = self.stats(P)[0]
        parti = self.etb(P, depuis_main)
        for Q in list(self.perms):
            if Q is P or not Q.get("k"):
                continue
            for e in Q["k"]["effets"]:
                if e["quand"] == "autre_entre":
                    if e.get("type") and e["type"] not in P["types"]:
                        continue
                    self.execute(e, Q, force=puissance)
                elif e["quand"] == "toute_entre":
                    self.execute(e, P, force=puissance)
        if self.sur("echoes") and P.get("k") and not P.get("jeton") and "Elemental" in P["types"]:
            copie = self.nouveau(P["k"], jeton=True, fin="exil", hate=True)
            self.entre(copie)
        return parti

    def meurt(self, P, sacrifice=False, exil=False):
        """Un de tes permanents quitte le champ de bataille : il meurt (déclencheurs) ou il est exilé."""
        if P not in self.perms:
            return
        self.perms.remove(P)
        if P.get("exile_main"):
            self.hand.append(P.pop("exile_main"))
        equipe = [Q for Q in self.perms if Q.get("sur") is P]
        for Q in equipe:
            Q["sur"] = None
        k = P.get("k")
        kd = self.kindp(P)
        if P.get("cmd"):
            self.taxe += 2
            self.stat["cmd_mort"] += 1
        if k:
            for e in k["effets"]:
                if e["quand"] == "quitte":
                    self.execute(e, P)
        if P.get("unearth"):
            exil = True
        if not self.est_crea(P):
            if k and not P.get("jeton") and not exil:
                self.gy.append(P["nom"])
            if k and k["kind"] == "vat":
                self.imprint = None
            return
        if exil:
            if k and k["kind"] == "nova" and P.get("champion"):
                self.revient(P["champion"])
            return
        # --- mort
        self.stat["morts_moi"] += 1
        self.seg_mort = True
        if sacrifice and self.kc["kind"] == "kels" and self.cmd_en_jeu():
            self.sacs += 1
        for Q in list(self.perms):
            kq = self.kindp(Q)
            if kq == "demon" and kd != "demon":
                self.E += 1
            elif kq == "bastion":
                self.draine(1, "bastion")
            elif kq == "konrad":
                self.chaque(1, "konrad")
            elif kq == "butcher":
                self.edict_adv()
            elif kq == "gate" and k and not P.get("jeton"):
                self.pv += 1
            if Q.get("k"):
                for e in Q["k"]["effets"]:
                    if e["quand"] in ("ma_mort", "autre_meurt", "toute_mort") or (e["quand"] == "sac" and sacrifice):
                        self.execute(e, Q)
        if kd == "butcher":
            self.edict_adv()
        if k:
            for e in k["effets"]:
                if e["quand"] in ("meurt", "ma_mort"):
                    self.execute(e, P)
        for Q in equipe:
            if self.kindp(Q) == "clamp":
                self.pioche(2)
                self.stat["pioche_clamp"] += 2
            elif self.kindp(Q) == "blade":
                self.pioche(1)
            for e in Q["k"]["effets"]:
                if e["quand"] == "equipee_meurt":
                    self.execute(e, Q)
        self.opportuniste()
        if k and k["kind"] == "nova" and P.get("champion"):
            self.revient(P["champion"])
        if k and P.get("jeton"):
            return
        if not k:
            return
        if P.get("persist_ok", True) and k.get("persist") and P["compteurs"] == 0:
            R = self.nouveau(k, compteurs=1)
            self.entre(R)
            return
        n = P["nom"]
        if n == "Solemn Simulacrum":
            self.pioche(1)
        if kd == "supplier":
            self.meule(3)
        if self.sur("vat") and self.choix_empreinte(n):
            if self.imprint and self.imprint in self.C:
                self.gy.append(self.imprint)
            self.imprint = n
            if self.sur("konrad"):
                self.chaque(1, "konrad")
        else:
            self.gy.append(n)

    def choix_empreinte(self, n):
        """La Cuve garde-t-elle cette carte ? (Kels : un Maraudeur ou le Marchand/Archonte ; sinon la plus forte créature)."""
        k = self.C[n]
        if self.kc["kind"] == "kels":
            return self.imprint is None and ((k["kind"] == "maraud" and not k.get("nontoken")) or
                                             (k["kind"] in ("gray", "archon") and not self.sur("dawn")))
        return k["creature"] and (self.imprint is None or k["p"] > self.C[self.imprint]["p"])

    def revient(self, nom):
        """Une carte exilée revient sur le champ de bataille (Champion)."""
        if nom in self.C:
            self.entre(self.nouveau(self.C[nom]))

    def sacrifie(self, P):
        self.meurt(P, sacrifice=True)

    def opportuniste(self):
        if self.sur("opportunist") and not self.opport:
            self.opport = True
            self.pioche(1)

    def meule(self, n):
        for _ in range(n):
            if not self.lib:
                return
            c = self.lib.pop(0)
            self.gy.append(c)
            if self.C[c]["creature"] and self.sur("konrad"):
                self.chaque(1, "konrad")

    def quitte_cim(self, nom):
        self.gy.remove(nom)
        if self.sur("konrad"):
            self.chaque(1, "konrad")

    def fodder(self, sauf=None, nontoken=False):
        """Ta créature la moins précieuse à sacrifier."""
        c = [P for P in self.creatures() if P is not sauf and not P.get("cmd") and not (nontoken and P.get("jeton"))]
        return min(c, key=self.valeur, default=None)

    # ================================================================ effets lus automatiquement
    def execute(self, e, src=None, force=None, cible_adv=None):
        a = e["a"]
        if self.fin:
            return
        mult = 2 if src is not None and self.est_crea(src) and any(s["s"] == "double_degats" for _, s in self.statiques()) else 1
        if src is not None and self.est_crea(src):
            mult *= self.neriv(src)
        if a == "detruit":
            self.tue_une(nonblack=e.get("nonblack", False), exil=e.get("exil", False))
        elif a == "degats":
            n = e["n"]
            if n == "X":
                n = len(self.creatures()) + sum(len(x.creas) for x in self.vivants()) if e.get("x_creatures") else 2
            if e["cible"] == "chaque_crea":
                self.degats_tous(n * mult)
            else:
                self.degats_cible(n * mult, e["cible"], src, "effet")
        elif a == "degats_force":
            n = force if force is not None else (self.stats(src)[0] if src is not None else 0)
            self.degats_cible(n * mult, e["cible"], src, "entree")
        elif a == "edict":
            n = e["n"] if e["n"] != "X" else 1
            self.edict_adv(nontoken=e.get("nontoken", False), n=n)
            if e["qui"] == "tous":
                for _ in range(n):
                    f = self.fodder(nontoken=e.get("nontoken", False))
                    if f:
                        self.sacrifie(f)
        elif a == "pioche":
            self.pioche(e["n"])
        elif a == "jetons":
            n = e["n"] if e["n"] != "X" else 2
            for _ in range(n):
                P = self.nouveau(None, jeton=True, jeton_pur=True, nomj="auto", nom="jeton", p0=e["p"], t0=e["t"], kws=set(e["kws"]),
                                 types=set(e["types"]), pips=0, fin=e.get("fin"))
                self.entre(P)
        elif a == "reanime":
            n = self.meilleure_au_cim()
            if n:
                self.quitte_cim(n)
                P = self.nouveau(self.C[n], hate=e.get("hate", False), fin="sac" if e.get("temp") else None)
                self.entre(P)
        elif a == "recup":
            n = self.meilleure_au_cim()
            if n:
                self.quitte_cim(n)
                self.hand.append(n)
        elif a == "terrain_base":
            self.cherche_base(pret=False)
        elif a == "tuteur":
            self.tuteur(e.get("type"), e.get("dessus", False))
        elif a == "draine":
            if e.get("cible_une"):
                c = self.cible_faible()
                if c:
                    x = self.perte(c, e["n"] if e["n"] != "X" else 2, "draine")
                    if e.get("gagne"):
                        self.pv += x
            elif e.get("gagne"):
                self.draine(e["n"] if e["n"] != "X" else 2, "draine")
            else:
                self.chaque(e["n"] if e["n"] != "X" else 2, "draine")
        elif a == "perte_proprio":
            if cible_adv is not None:
                self.perte(cible_adv, e["n"], "effet")
        elif a == "vie":
            self.pv += e["n"]
        elif a == "perd":
            self.moi_perd(e["n"], "effet")
        elif a == "pump":
            P = self.cible_pump(e.get("hate"))
            if P:
                P["bonus_p"] += e["p"] if e["p"] != "X" else 2
                P["bonus_t"] += e["t"]
                if e.get("hate"):
                    P["hate"] = True
                if e.get("df"):
                    P["kws_tmp"].add("double")
        elif a == "hate_tous":
            for P in self.creatures():
                if not e.get("type") or e["type"] in P["types"]:
                    P["hate"] = True
        elif a == "rase":
            self.rase(seulement_adv=e.get("seulement_adv", False))
        elif a == "moins":
            self.moins_x(e["n"], moi=not e.get("seulement_adv"), sauf=src if e.get("autres") else None)
        elif a == "pas_bloquer":
            self.pas_bloquer += e["n"]
        elif a == "mana":
            self.ajoute_mana(e["n"])
        elif a == "contre":
            pass

    def cible_pump(self, hate):
        """Cible d'un « +X/+0 et célérité » : ton commandant s'il ne peut pas encore attaquer, sinon ton meilleur attaquant."""
        c = self.cmd_en_jeu()
        if hate and c and c["entree"] == self.t and "celerite" not in self.stats(c)[2]:
            return c
        att = [P for P in self.creatures() if not (P["entree"] == self.t and "celerite" not in self.stats(P)[2])]
        return max(att or self.creatures(), key=lambda P: self.stats(P)[0], default=None)

    def meilleure_au_cim(self, ordre=None, exclure=()):
        cands = [n for n in self.gy if self.C[n]["creature"] and n not in exclure]
        if not cands:
            return None
        if ordre:
            for kd in ordre:
                for n in cands:
                    if self.C[n]["kind"] == kd:
                        return n
        return max(cands, key=lambda n: self.valeur_rea(n))

    def valeur_rea(self, n):
        """Ce que rapporte une créature réanimée pour un tour : force si elle a la célérité, effets d'arrivée."""
        k = self.C[n]
        v = k["p"] * (1.5 if k["celerite"] or self.sur("echoes") else 0.7)
        v += 3 * sum(1 for e in k["effets"] if e["quand"] == "etb")
        v += 4 * sum(1 for e in k["effets"] if e["quand"] == "quitte")
        return v + VALEUR_KIND.get(k["kind"], 0)

    def tuteur(self, type_=None, dessus=False):
        ordre = ("Dawn of the Dead", "Mimic Vat", "God-Pharaoh's Gift", "Syr Konrad, the Grim", "Gray Merchant of Asphodel") \
            if self.kc["kind"] == "kels" else ()
        cible = next((c for c in ordre if c in self.lib and not self.sur(self.kind(c))), None)
        if not cible:
            cands = [c for c in self.lib if not self.C[c]["terrain"] and (not type_ or type_ in self.C[c]["sous_types"])]
            cible = max(cands, key=lambda c: (self.valeur_carte(c), c), default=None)
        if cible:
            self.lib.remove(cible)
            if dessus:
                self.lib.insert(0, cible)
            else:
                self.hand.append(cible)

    def valeur_carte(self, n):
        k = self.C[n]
        return VALEUR_KIND.get(k["kind"], 0) + VALEUR_PERM.get(k["kind"], 0) + k["p"] + (3 if k["kind"] == "a_moteur" else 0)

    # ================================================================ Kels : capacités, protections
    def kels_indestructible(self):
        c = self.cmd_en_jeu()
        if not c or self.kc["kind"] != "kels":
            return False
        f = self.fodder(sauf=c)
        if f and self.jetable(f) and self.paie(1):
            self.sacrifie(f)
            self.stat["cmd_sauve"] += 1
            return True
        return False

    def a_autel(self):
        return (self.kc["kind"] == "kels" and self.cmd_en_jeu()) or self.sur("attrition") or self.sur("vrites")

    def autel(self, P):
        if self.sur("attrition") and any(x for a in self.vivants() for x in a.creas if not x["noir"]) and self.paie(0, ("B",)):
            self.sacrifie(P)
            self.tue_une(True)
            return True
        if self.kc["kind"] == "kels" and self.cmd_en_jeu() and self.paie(1):
            self.sacrifie(P)
            return True
        if self.sur("vrites") and self.paie(1, ("B",)):
            self.sacrifie(P)
            self.pv += 1
            self.pioche(1)
            return True
        return False

    def archonte(self):
        a = self.cible_faible()
        if not a:
            return
        if a.creas:
            self.mort_adv(a, min(a.creas, key=valeur_adv))
        self.perte(a, 3, "archon")
        self.pv += 3
        self.pioche(1)

    # ================================================================ effets d'arrivée des cartes écrites à la main
    def etb(self, P, depuis_main=False):
        """Effet d'arrivée. Renvoie True si la créature a quitté le champ pendant son arrivée."""
        k = P.get("k")
        if not k:
            return False
        kd = k["kind"]
        if kd.startswith("e_") or kd == "tromo":
            return self.etb_engag(P, depuis_main)
        if kd == "maraud":
            if k.get("grave") and self.seg_mort:
                self.pioche(1)
                return False
            n_fois = 1
            if k.get("squad") and depuis_main:
                while n_fois < 3 and self.paie(2):
                    n_fois += 1
            for _ in range(n_fois):
                self.edict_adv(nontoken=k.get("nontoken", False))
            for _ in range(n_fois - 1):          # copies d'escouade : on les sacrifie aussi
                T = self.nouveau(k, jeton=True)
                self.perms.append(T)
                self.sacrifie(T)
            self.sacrifie(P)
            return True
        if kd == "remcrea":
            self.tue_une(k.get("nonblack", False))
        elif kd == "gray":
            self.draine(self.devotion(), "gray")
        elif kd == "archon":
            self.archonte()
        elif kd == "demon":
            self.moins_x(2, moi=True, sauf=P)
        elif kd == "sheoA":
            self.edict_adv(nontoken=True)
        elif kd == "wurm":
            for a in self.vivants():
                for c in [c for c in a.creas if c["t"] <= 2]:
                    self.mort_adv(a, c)
        elif kd == "nightinc" and depuis_main:
            self.sacrifie(P)
            self.moins_x(3, moi=True)
            return True
        elif kd == "evoke":
            self.pioche(k.get("draw", 0))
            if k.get("kill"):
                self.tue_une(k.get("nonblack", False))
            if k.get("renvoi"):
                self.renvoie_une()
            if depuis_main:
                self.sacrifie(P)
                return True
        elif kd in ("exploit", "sidisi"):
            f = self.fodder(sauf=P)
            cible = f if f is not None and (f.get("jeton_pur")) else P
            self.sacrifie(cible)
            if kd == "exploit":
                self.pioche(k["draw"])
            else:
                self.tuteur()
            return P not in self.perms
        elif kd == "mage":
            if k["cherche"] in self.lib:
                self.lib.remove(k["cherche"])
                self.hand.append(k["cherche"])
        elif kd == "corps":
            self.pioche(k.get("draw", 0))
        elif kd == "supplier":
            self.meule(3)
        elif kd == "solemn":
            self.cherche_base(pret=False)
        elif kd == "nova":                       # Champion : exile un autre Élémental, sinon se sacrifie
            autre = [Q for Q in self.creatures() if Q is not P and "Elemental" in Q["types"] and not Q.get("cmd")]
            if autre:
                Q = min(autre, key=self.valeur)
                self.perms.remove(Q)
                if Q.get("k") and not Q.get("jeton"):
                    P["champion"] = Q["nom"]
            else:
                self.sacrifie(P)
                return True
        elif kd == "cinder":
            P["bonus_p"] += sum(Q["k"]["rouges"] for Q in self.perms if Q.get("k"))
        elif kd in ("thunderkin", "spitter", "necro", "soulstoke", "servant", "greven", "kels"):
            pass
        elif kd.startswith("a_") or kd == "rock":
            if depuis_main and P.get("evoque"):
                for e in k["effets"]:
                    if e["quand"] == "etb":
                        self.execute(e, P)
                self.sacrifie(P)
                return True
            for e in k["effets"]:
                if e["quand"] == "etb":
                    self.execute(e, P)
        return P not in self.perms

    # ================================================================ phase principale
    def veut(self, n, k, kd):
        if kd.startswith("e_"):
            return self.veut_engag(n, k, kd)
        if kd in UNIQUES and self.sur(kd):
            return False
        adv_crea = sum(len(a.creas) for a in self.vivants())
        mes = len(self.creatures())
        if kd == "gate" and (self.sur("gift") or "God-Pharaoh's Gift" in self.hand):
            return False
        if kd == "maraud" and not (adv_crea or any(self.sur(d) for d in DRAINS)):
            return False
        if kd in ("remcrea", "remsort", "a_removal") and not adv_crea:
            return False
        if kd == "evoke" and (k.get("kill") or k.get("renvoi")) and not adv_crea:
            return False
        if kd == "sacdraw" and not any(self.jetable(P) for P in self.creatures()):
            return False
        if kd == "wipe1" and adv_crea < 4:
            return False
        if kd in ("wipe", "nightinc", "a_rase"):
            survit = kd == "a_rase" and self.cmd_en_jeu() and all(
                e["a"] != "moins" or self.stats(self.cmd_en_jeu())[1] > e["n"] for e in k["effets"]) and \
                all(e["a"] != "degats" or e["n"] == "X" or self.stats(self.cmd_en_jeu())[1] > e["n"] for e in k["effets"]) and \
                not any(e["a"] == "rase" for e in k["effets"])
            if not (adv_crea >= 5 and adv_crea >= 2 * (mes if not survit else max(mes - 1, 0))):
                return False
        if kd == "a_reanime" and not any(self.C[c]["creature"] for c in self.gy):
            return False
        if kd in ("a_pioche", "study") and len(self.hand) > 4:
            return False
        if kd == "geyser" and self.mana_geyser() < 4:
            return False
        if kd == "jeska" and not any(not self.C[c]["terrain"] for c in self.hand if c != n):
            return False
        if kd == "encore" and not any(a.crea_cim for a in self.vivants()):
            return False
        if kd in ("reactif", "terrain", "a_fling", "a_reactif", "tbr"):
            return False
        if self.phase2 and (k.get("ephemere") or kd in ("appeal", "serpent", "nova")):
            return False
        if self.tient_salve(kd, n):
            return False
        return True

    # ---------------------------------------------------------------- pilote « salve »
    def arme(self):
        """Un moteur de salve en jeu : dégâts quand une créature arrive (Pandemonium, Terror), doubleur, Soulstoke, Échos en fusion."""
        for P in self.perms:
            k = P.get("k")
            if not k:
                continue
            if k["kind"] in ("soulstoke", "echoes"):
                return True
            if any(x["s"] in ("double_degats", "double_frappe", "double_neuves") for x in k["statiques"]):
                return True
            if any(e["quand"] in ("autre_entre", "toute_entre") and e["a"] in ("degats_force", "degats", "draine", "perd")
                   for e in k["effets"]):
                return True
        return False

    def salve_possible(self):
        """Créatures de salve lançables ce tour (les moins chères d'abord) et dégâts immédiats possibles (célérité, Pandemonium)."""
        pool, tres, dep = list(self.pool), self.tresors, self.stat[f"depense{self.t}"]
        entree = sum(1 for P in self.perms if P.get("k") and any(
            e["quand"] in ("autre_entre", "toute_entre") and e["a"] == "degats_force" for e in P["k"]["effets"]))
        mult = 2 if any(x["s"] == "double_degats" for _, x in self.statiques()) else 1
        nv = 2 if any(x["s"] == "double_neuves" for _, x in self.statiques()) else 1     # Neriv : les nouvelles doublent
        nb = 0
        force = sum(v["p"] for v in self.mes_vues() if not v["malade"])
        for n in sorted((n for n in self.hand if self.kind(n) in SALVE or n in self.R["garder"]),
                        key=lambda n: self.cout(self.C[n])[0] + len(self.C[n]["cout"][1])):
            k = self.C[n]
            if self.paie_carte(k):
                nb += 1
                force += k["p"] * (entree * mult * nv + (nv if k.get("celerite") else 0))
        self.pool, self.tresors = pool, tres
        self.stat[f"depense{self.t}"] = dep
        return nb, force

    def tient_salve(self, kd, n=None):
        """Cette carte reste-t-elle en main ? Pilote « salve » (créatures de salve) ou carte de la liste « garder ».
        On la lance si la salve part ce tour : moteur en jeu et au moins salve_nb créatures lançables, ou un adversaire tuable ;
        ou si on ne peut plus attendre (moins de salve_pv PV, plus de salve_main cartes en main)."""
        R = self.R
        if not ((self.pilote == "salve" and kd in SALVE) or (n is not None and n in R["garder"])):
            return False
        if self.salve_tour == self.t and not self.phase2:
            return False
        if self.pv < R["salve_pv"] or len(self.hand) > R["salve_main"]:
            return False
        nb, force = self.salve_possible()
        vivants = self.vivants()
        if (self.arme() and nb >= R["salve_nb"]) or (vivants and nb and force >= min(a.pv for a in vivants)):
            if self.salve_tour != self.t:
                self.stat["salves"] += 1
            self.salve_tour = self.t
            return False
        return True

    def mana_geyser(self):
        return int(sum(min(self.t, 8) * 0.6 for _ in self.vivants()))

    def lancer(self):
        while not self.fin:
            if not self.cmd_en_jeu() and self.lance_commandant():
                continue
            fait = any(self.essaie(n, self.kind(n)) for n in [x for x in self.R["premier"] if x in self.hand])
            if not fait:
                for kd in ORDRE:
                    cartes = sorted((n for n in self.hand if self.kind(n) == kd), key=lambda n: -self.C[n]["mv"])
                    if any(self.essaie(n, kd) for n in cartes):
                        fait = True
                        break
            if not fait:
                return

    def essaie(self, n, kd):
        """Lance la carte n de la main si le pilote le veut et si on peut la payer. Renvoie True si elle a été lancée."""
        k = self.C[n]
        if not self.veut(n, k, kd):
            return False
        alt = None
        if k.get("evoke") and not self.peut_carte(k) and self.peut_carte(k, k["evoke"]) and \
                any(e["quand"] in ("etb", "quitte") for e in k["effets"]):
            alt = k["evoke"]
        if kd == "serpent":
            return self.lance_serpent(n)
        if k.get("behold") and not self.choix_behold(n, k["behold"]):
            return False
        if not self.paie_carte(k, alt):
            return False
        self.hand.remove(n)
        self.stat["lances"] += 1
        if self.engag:
            self.apres_sort_engag(k)
        exile = self.paie_behold(n, k["behold"]) if k.get("behold") else None
        if self.contre_adverse(k):
            self.gy.append(n)
        else:
            self.resout(n, k, kd, evoque=alt is not None)
            if exile:
                P = next((Q for Q in reversed(self.perms) if Q.get("nom") == n and Q.get("k") is k), None)
                if P:
                    P["exile_main"] = exile
                else:
                    self.hand.append(exile)
        return True

    def choix_behold(self, n, typ):
        """Ce qu'on exile pour « behold » : d'abord un jeton du type en jeu, sinon la carte du type la plus faible en main."""
        jetons = [P for P in self.creatures() if P.get("jeton_pur") and typ in P["types"] and not P.get("cmd")]
        if jetons:
            return min(jetons, key=lambda P: self.stats(P)[0])
        main = [x for x in self.hand if x != n and self.C[x]["creature"] and typ in self.C[x]["sous_types"]]
        if main:
            return min(main, key=lambda x: (self.C[x]["p"], self.C[x]["mv"]))
        return None

    def paie_behold(self, n, typ):
        """Exile le choix de choix_behold ; renvoie le nom de la carte à rendre en main plus tard (None pour un jeton)."""
        c = self.choix_behold(n, typ)
        if c is None:
            return None
        if isinstance(c, dict):
            self.perms.remove(c)
            return None
        self.hand.remove(c)
        return c

    def lance_commandant(self):
        k = self.kc
        g, pips = self.cout(k)
        servant = self.servant_pret() if not k["celerite"] else None
        if not self.peut(g + self.taxe, pips, frozenset(k["sous_types"])):
            if not (servant and self.peut(max(0, g + self.taxe - 2), pips)):
                return False
        hate = False
        if servant and not self.peut(g + self.taxe, pips) or (servant and self.t >= 3):
            self.sacrifie(servant)
            self.ajoute_mana(2, "C")
            hate = True
        if not self.paie(g + self.taxe, pips, frozenset(k["sous_types"])):
            return False
        self.stat["lances"] += 1
        if self.engag:
            self.apres_sort_engag(k)
        if self.contre_adverse(k):
            self.taxe += 2
            return True
        self.cmd_tour = self.cmd_tour or self.t
        P = self.nouveau(k, cmd=True, hate=hate)
        self.entre(P, depuis_main=True)
        return True

    def servant_pret(self):
        return next((P for P in self.perms if self.kindp(P) == "servant" and P["entree"] < self.t), None)

    def lance_serpent(self, n):
        k = self.C[n]
        g, pips = self.cout(k)
        x = 0
        while self.peut(g + x + 1, pips, frozenset(k["sous_types"])):
            x += 1
        if x < 3:
            return False
        self.paie(g + x, pips, frozenset(k["sous_types"]))
        self.hand.remove(n)
        self.stat["lances"] += 1
        P = self.nouveau(k)
        P["p0"] = k["p"] + x
        self.entre(P, depuis_main=True)
        return True

    def resout(self, n, k, kd, evoque=False):
        """Résolution d'un sort lancé depuis la main."""
        if kd.startswith("e_"):
            return self.resout_engag(n, k, kd)
        if kd == "dt":
            self.gy.append(n)
            self.tuteur()
        elif kd == "fab":
            self.gy.append(n)
            for c in ("Mimic Vat", "God-Pharaoh's Gift"):
                if c in self.lib and not self.sur(self.kind(c)):
                    self.lib.remove(c)
                    self.hand.append(c)
                    break
        elif kd == "remsort":
            self.gy.append(n)
            self.tue_une(exil=n == "Chaos Warp")
        elif kd == "wipe":
            if k["creature"]:
                self.rase()
                self.entre(self.nouveau(k))
            else:
                self.gy.append(n)
                self.rase(tempest=k.get("tempest", False))
        elif kd == "wipe1":
            self.gy.append(n)
            self.rase(seulement_adv=True)
        elif kd == "sacdraw":
            f = self.fodder()
            if f:
                if k.get("vie") and f.get("k"):
                    self.pv += f["k"]["mv"]
                self.sacrifie(f)
            self.pioche(k["n"])
            self.gy.append(n)
            if k.get("tresor"):
                self.tresor()
        elif kd == "appeal":
            self.gy.append(n)
            P = self.jeton("appeal", fin="exil")
            if self.paie(5):
                P["bonus_p"] += 7
            self.entre(P)
        elif kd == "jeska":
            self.gy.append(n)
            self.ajoute_mana(4, "R")
            if self.cmd_en_jeu():
                self.pioche(2)
        elif kd == "geyser":
            self.gy.append(n)
            self.ajoute_mana(self.mana_geyser(), "R")
        elif kd == "study":
            self.gy.append(n)
            self.pioche(self.kc["mv"])
            self.moi_perd(self.kc["mv"], "effet")
        elif kd == "encore":
            self.gy.append(n)
            a = max((a for a in self.vivants() if a.crea_cim), key=lambda a: a.crea_cim, default=None)
            if a:
                a.crea_cim -= 1
                P = self.nouveau(None, jeton=True, jeton_pur=True, nomj="encore", nom="volé", p0=4, t0=4, kws=set(), types=set(),
                                 pips=0, fin="exil", hate=True)
                self.entre(P)
        elif not k["permanent"]:
            self.gy.append(n)
            if any(s["s"] == "cout_sac" for s in k["statiques"]):
                f = self.fodder()
                if not f:
                    return
                force = self.stats(f)[0]
                self.sacrifie(f)
                for e in k["effets"]:
                    self.execute(e, None, force=force)
                return
            for e in k["effets"]:
                if e["quand"] == "sort":
                    self.execute(e, None)
        else:
            P = self.nouveau(k, evoque=evoque)
            if kd == "gray":
                self.entre(P, depuis_main=True)
                if (self.sur("dawn") or "Dawn of the Dead" in self.hand) and P in self.perms and self.a_autel():
                    self.autel(P)
                return
            self.entre(P, depuis_main=True)

    # ================================================================ actions avant le combat
    def avant_combat(self):
        t = self.t
        self.sheoA_transforme()
        self.brink()
        if self.sur("gate") and not self.sur("gift") and sum(1 for n in self.gy if self.C[n]["creature"]) >= 6 and self.peut(2):
            for zone in (self.lib, self.hand, self.gy):
                if "God-Pharaoh's Gift" in zone:
                    zone.remove("God-Pharaoh's Gift")
                    self.paie(2)
                    G = self.perm("gate")
                    self.perms.remove(G)
                    self.gy.append("Gate to the Afterlife")
                    self.entre(self.nouveau(self.C["God-Pharaoh's Gift"]))
                    break
        # Greven : il lui faut la célérité le tour où il arrive
        c = self.cmd_en_jeu()
        if c and c["entree"] == t and "celerite" not in self.stats(c)[2]:
            if any(self.C[x[0]].get("hate_terrain") for x in self.terrains) and self.paie(1, ("R",)):
                c["hate"] = True
        self.equiper()
        # Cuve : sur ton tour quand l'empreinte attaque ou draine (Kels), toujours pour Greven
        vat = self.perm("vat")
        if vat and self.imprint and self.imprint in self.C and (self.kc["kind"] != "kels" or self.kind(self.imprint) in ("gray", "archon")) \
                and self.paie(3):
            self.vat_fait = True
            self.entre(self.nouveau(self.C[self.imprint], jeton=True, fin="exil", hate=True))
        # Nécromancien apprenti, Soulstoke, Sneak Attack, Sparkspitter
        for P in [P for P in self.perms if self.kindp(P) == "necro" and P["entree"] < t]:
            n = self.meilleure_au_cim()
            if n and self.C[n]["p"] >= 4 and self.paie(0, ("B",)):
                self.sacrifie(P)
                self.quitte_cim(n)
                self.entre(self.nouveau(self.C[n], hate=True, fin="sac"))
        for P in [P for P in self.perms if self.kindp(P) == "soulstoke" and P["entree"] < t]:
            elem = [n for n in self.hand if self.C[n]["creature"] and "Elemental" in self.C[n]["sous_types"]]
            if elem and self.paie(1, ("R",), frozenset({"Elemental"})):
                n = max(elem, key=lambda n: self.C[n]["p"])
                self.hand.remove(n)
                self.entre(self.nouveau(self.C[n], hate=True, fin="sac"))
        if self.sur("sneak"):
            for n in sorted([n for n in self.hand if self.C[n]["creature"]], key=lambda n: -self.C[n]["p"]):
                if (self.C[n].get("ephemere") or self.C[n]["p"] >= 5 or self.C[n]["kind"] == "nova") and self.paie(0, ("R",)):
                    self.hand.remove(n)
                    self.entre(self.nouveau(self.C[n], hate=True, fin="sac"))
        for P in [P for P in self.perms if self.kindp(P) == "spitter" and P["entree"] < t]:
            jetables = [n for n in self.hand if self.C[n]["terrain"]] if len(self.terrains) >= 6 else []
            if jetables and self.paie(0, ("R",), frozenset({"Elemental"})):
                self.hand.remove(jetables[0])
                self.gy.append(jetables[0])
                self.entre(self.jeton("spark", fin="sac"))
        # Gift (début de combat)
        if self.sur("gift"):
            ordre = CHOIX_GIFT if self.kc["kind"] == "kels" else None
            n = self.choix_kels(CHOIX_GIFT, gift=True) if ordre else self.meilleure_au_cim()
            if n:
                self.quitte_cim(n)
                P = self.nouveau(self.C[n], jeton=True, hate=True, gift=True, p0=4, t0=4)
                self.entre(P)
        # unearth (Hellspark)
        for n in [n for n in self.gy if self.C[n].get("alt", {}).get("unearth")]:
            if self.paie(*self.C[n]["alt"]["unearth"]):
                self.quitte_cim(n)
                self.entre(self.nouveau(self.C[n], hate=True, unearth=True, fin="exil"))
        if self.engag:
            self.avant_combat_engag()

    def equiper(self):
        """Bottes et Grèves sur le commandant ; équipements de force sur le meilleur attaquant ; Crâne sur une créature X/1 qui part."""
        c = self.cmd_en_jeu()
        for E in [P for P in self.perms if P.get("k") and P["k"]["kind"] == "a_equip" and P.get("sur") not in self.perms]:
            g, pips = E["k"]["alt"].get("equip", (1, ()))
            mots = {m for s in E["k"]["statiques"] if s["s"] == "equip_mots" for m in s["kws"]}
            cible = c if (c and mots & {"celerite", "hexproof", "linceul"}) else max(
                self.creatures(), key=lambda P: self.stats(P)[0], default=None)
            if cible and self.paie(g, pips):
                E["sur"] = cible
        B = self.perm("blade")
        if B and B.get("sur") not in self.perms:
            eph = [P for P in self.creatures() if (P.get("fin") or (P.get("k") and P["k"].get("ephemere"))) and "Elemental" in P["types"]]
            if eph and self.paie(1):
                B["sur"] = max(eph, key=lambda P: self.stats(P)[0])

    def choix_kels(self, ordre, gift=False):
        for kd in ordre:
            for n in self.gy:
                k = self.C[n]
                if k["kind"] != kd or not k["creature"]:
                    continue
                if gift and kd == "maraud" and k.get("nontoken"):
                    continue
                if gift and kd == "gray" and self.sur("dawn"):
                    continue
                if kd == "remcrea" and not any(a.creas for a in self.vivants()):
                    continue
                return n
        return None

    def brink(self):
        if not self.sur("brink"):
            return
        while True:
            mar = [n for n in self.gy if self.kind(n) == "maraud" and not self.C[n].get("nontoken")]
            if self.sur("dawn") and len(mar) <= 1:
                mar = []
            cands = [n for n in self.gy if self.kind(n) == "sheoW"] + ([n for n in self.gy if self.kind(n) == "gray"] if self.devotion() >= 6 else [])
            cands += sorted(mar, key=lambda n: self.C[n]["mv"]) + [n for n in self.gy if self.kind(n) == "sheoA"]
            fait = False
            for n in cands:
                if self.paie(*self.C[n]["plein"]):
                    self.quitte_cim(n)
                    self.entre(self.nouveau(self.C[n], jeton=True))
                    fait = True
                    break
            if not fait:
                return

    def sheoA_transforme(self):
        P = next((P for P in self.perms if self.kindp(P) == "sheoA" and not P.get("jeton")), None)
        if P and max([a.cim for a in self.vivants()] or [0]) >= 8 and self.paie(4, ("B",)):
            self.perms.remove(P)
            self.saga = 1
            for a in self.vivants():
                c = [x for x in a.creas if not x.get("hexproof")]
                if c:
                    self.mort_adv(a, max(c, key=valeur_adv))

    def saga_suite(self):
        if not self.saga:
            return
        self.saga += 1
        if self.saga == 2:
            for a in self.vivants():
                a.cim += 6
        elif self.saga == 3:
            for n in [n for n in self.gy if self.C[n]["creature"]]:
                if n in self.gy:
                    self.quitte_cim(n)
                    self.entre(self.nouveau(self.C[n]))
            for a in self.adv:
                for _ in range(a.crea_cim):
                    self.entre(self.jeton("vole"))
                a.crea_cim = 0
            self.saga = 0
            self.entre(self.nouveau(self.C["Sheoldred // The True Scriptures"]))

    def demon(self):
        while self.sur("demon") and self.E >= 4 and self.peut(2, ("B",)):
            n = self.choix_kels(CHOIX_PERM) if self.kc["kind"] == "kels" else self.meilleure_au_cim()
            if not n:
                return
            self.paie(2, ("B",))
            self.E -= 4
            self.quitte_cim(n)
            self.entre(self.nouveau(self.C[n]))

    # ================================================================ contresorts
    def contre_adverse(self, k):
        """Un adversaire contre-t-il ton sort (4 manas ou plus) ? Une fois par adversaire et par tour de table."""
        if k["mv"] < 4:
            return False
        for a in self.vivants():
            if a.a.get("contre") and not a.contre_pris and self.rng_contre.random() < a.a["contre"]:
                a.contre_pris = True
                self.stat["contre_subi"] += 1
                return True
        return False

    def je_contre(self):
        """Un contresort en main et payable : tu contres la menace."""
        for n in [n for n in self.hand if self.kind(n) in ("reactif", "a_reactif")]:
            k = self.C[n]
            if k.get("bleu") and self.rng_contre.random() > 0.3:
                continue
            if self.paie_carte(k):
                self.hand.remove(n)
                if k["creature"]:
                    self.entre(self.nouveau(k))
                else:
                    self.gy.append(n)
                self.stat["je_contre"] += 1
                return True
        return False

    # ================================================================ ton combat
    def attaque_sure(self, v, dfn):
        bl = [b for b in dfn if peut_bloquer(b, v)]
        if v["menace"]:
            if len(bl) < 2:
                return True
            deux = sorted(bl, key=lambda b: -b["p"])[:2]
            return sum(b["p"] for b in deux) < v["t"] and not any(b.get("contact") for b in deux)
        return not any(tue(b, v) for b in bl)

    def mon_attaque(self):
        df = any(s["s"] == "double_frappe" for _, s in self.statiques())
        vues = [v for v in self.mes_vues() if v["p"] > 0 and not v["malade"] and v["kind"] != "snake"
                and not (v["P"].get("nomj") == "snake")]
        if not vues or not self.vivants():
            return
        meilleur = None
        for a in self.vivants():
            dfn = [dict(c, valeur=valeur_adv(c)) for c in a.creas]
            sures = [v for v in vues if v["ephemere"] or self.attaque_sure(v, dfn)]
            score = a.pv - sum(v["p"] * (2 if df else 1) for v in sures)
            if sures and (meilleur is None or score < meilleur[0]):
                meilleur = (score, a, sures)
        # Greven attaque même sans être à l'abri dès qu'il a une créature d'au moins 3 de force à sacrifier pour piocher
        g = next((v for v in vues if v["cmd"]), None)
        if g and self.kc["kind"] == "greven" and self.cible_greven(g["P"]) is not None:
            if not meilleur:
                a = min(self.vivants(), key=lambda a: (sum(1 for c in a.creas if c["p"] >= 3), a.pv))
                meilleur = (0, a, [g])
            elif g not in meilleur[2]:
                meilleur[2].append(g)
        if not meilleur:
            return
        _, a, att = meilleur
        for v in att:
            v["df"] = df or "double" in v["P"]["kws_tmp"]
            if v["kind"] == "archon":
                self.archonte()
        # déclencheurs d'attaque
        for v in list(att):
            P = v["P"]
            if P.get("k"):
                for e in P["k"]["effets"]:
                    if e["quand"] == "attaque":
                        self.execute(e, P)
            if self.kindp(P) == "thunderkin":
                t_max = self.stats(P)[1]
                cands = [n for n in self.gy if self.C[n]["creature"] and "Elemental" in self.C[n]["sous_types"] and self.C[n]["t"] < t_max]
                if cands:
                    n = max(cands, key=lambda n: self.C[n]["p"])
                    self.quitte_cim(n)
                    Q = self.nouveau(self.C[n], fin="sac", hate=True)
                    self.entre(Q)
                    if Q in self.perms:
                        w = self.vue(Q)
                        w["malade"] = False
                        w["df"] = df
                        att.append(w)
        cmd = next((v for v in att if v["cmd"]), None)
        if cmd and self.kc["kind"] == "greven":
            self.greven_sacrifie(att, a)
            cmd.update({k: v for k, v in self.vue(cmd["P"]).items() if k in ("p", "pbase", "t")})
        if not a.vivant() or self.fin:
            return
        # Rage de bataille temur : double initiative + piétinement sur le meilleur attaquant
        tbr = next((n for n in self.hand if self.kind(n) == "tbr"), None)
        if tbr and att and self.paie_carte(self.C[tbr]):
            self.hand.remove(tbr)
            self.gy.append(tbr)
            best = max(att, key=lambda v: v["p"] * (2 if v.get("pietine") or v.get("menace") or v.get("vol") else 1))
            best["df"] = True
            best["pietine"] = True
        dfn = a.creas
        for c in dfn:
            c["valeur"] = valeur_adv(c)
        if self.pas_bloquer:
            for c in sorted(dfn, key=lambda c: -c["p"])[:self.pas_bloquer]:
                c["ne_bloque_pas"] = True
        degats, morts_a, morts_b, detail = resoudre(att, dfn, a.pv, lambda b: True)
        for c in dfn:
            c.pop("ne_bloque_pas", None)
        self.pas_bloquer = 0
        dmg_cmd = sum(detail.get(id(v), 0) for v in att if v["cmd"])
        for b in morts_b:
            self.mort_adv(a, b)
        for v in morts_a:
            self.meurt(v["P"])
        if dmg_cmd and a.vivant():
            a.dmg_cmd += dmg_cmd
        self.perte(a, degats, "combat")
        if a.vivant() and a.dmg_cmd >= 21:
            self.perte(a, a.pv, "commandant")
        for v in att:
            P = v["P"]
            if detail.get(id(v)) and P.get("k"):
                for e in P["k"]["effets"]:
                    if e["quand"] == "degats_joueur":
                        self.execute(e, P)

    def cible_greven(self, greven):
        """La créature que Greven sacrifierait : celle qui part de toute façon (fin de tour, jeton) avec la plus grosse force,
        sinon une créature jetable d'au moins 3 de force si ta main est presque vide. None si rien ne vaut le coup."""
        if self.pilote == "salve":
            return self.cible_greven_salve(greven)
        cands = [P for P in self.creatures() if P is not greven]
        prio = [P for P in cands if self.jetable(P) and (P.get("fin") or (P.get("k") and P["k"].get("ephemere")) or P.get("jeton_pur"))]
        P = max(prio, key=lambda P: self.stats(P)[0], default=None)
        if P is None:
            fodder = [P for P in cands if self.jetable(P) and self.stats(P)[0] >= 3]
            if len(self.hand) <= 3 and fodder:
                P = max(fodder, key=lambda P: self.stats(P)[0])
        if P is None:
            return None
        p, t, _ = self.stats(P)
        if p < 3 or (self.pv - t <= 8 and t > 1):
            return None
        return P

    def cible_greven_salve(self, greven):
        """Pilote « salve » : remonter à 5 cartes en main sans descendre sous 10 PV. D'abord ce qui part de toute façon,
        la plus petite force qui suffit (les autres continuent de frapper) ; une créature qui resterait seulement si la main est vide."""
        besoin = self.R["greven_main"] - len(self.hand)
        if besoin <= 0:
            return None
        cands = []
        for P in self.creatures():
            if P is greven or not self.jetable(P):
                continue
            p, t, _ = self.stats(P)
            if p <= 0 or self.pv - t < self.R["greven_pv"]:
                continue
            part = bool(P.get("fin") or (P.get("k") and P["k"].get("ephemere")) or P.get("jeton_pur"))
            if not part and besoin < 3:
                continue
            cands.append((P, p, t, part))
        if not cands:
            return None
        return min(cands, key=lambda c: (not c[3], c[1] < besoin, c[1] if c[1] >= besoin else -c[1], c[2]))[0]

    def greven_sacrifie(self, att, cible):
        """Greven attaque : tu peux sacrifier une autre créature, piocher sa force et perdre son endurance."""
        P = self.cible_greven(self.cmd_en_jeu())
        if P is None:
            return
        p, t, _ = self.stats(P)
        for v in list(att):
            if v["P"] is P:
                att.remove(v)
        self.sacrifie(P)
        self.stat["greven_pioche"] += p
        self.pioche(p)
        self.moi_perd(t, "greven")

    def apres_combat(self):
        # Fling / Thud : on lance une créature qui va mourir, ou on finit un adversaire
        for n in [n for n in self.hand if self.kind(n) == "a_fling"]:
            k = self.C[n]
            cands = [P for P in self.creatures() if not P.get("cmd")]
            if not cands:
                break
            P = max(cands, key=lambda P: self.stats(P)[0])
            force = self.stats(P)[0]
            a = self.cible_faible()
            letal = a and force >= a.pv
            if (letal or self.jetable(P) and (P.get("fin") or (P.get("k") and P["k"].get("ephemere")))) and force >= 4 and self.paie_carte(k):
                self.hand.remove(n)
                self.gy.append(n)
                self.sacrifie(P)
                for e in k["effets"]:
                    if e["a"] == "degats_force":
                        if a:
                            self.perte(a, force, "fling")
        # Crâne (Skullclamp) : sur chaque créature X/1 qui va partir, pioche 2
        clamp = self.perm("clamp")
        if clamp:
            for P in list(self.creatures()):
                part = P.get("fin") or (P.get("k") and P["k"].get("ephemere")) or (P.get("jeton_pur") and self.stats(P)[1] <= 1)
                if part and self.stats(P)[1] <= 1 and not P.get("cmd") and self.paie(1):
                    clamp["sur"] = P
                    self.meurt(P)
        # capacités activées « cherche un terrain de base » (Wayfarer's Bauble)
        for P in list(self.perms):
            if P.get("k") and P["k"]["kind"] == "a_ramp":
                for ab in P["k"]["activables"]:
                    if ab["actions"] and ab["actions"][0]["a"] == "terrain_base" and ab["sac_soi"] and self.paie(*ab["cout"]):
                        self.meurt(P)
                        self.cherche_base(pret=False)
                        break

    def fin_de_tour(self):
        if self.engag:
            self.fin_tour_engag()
        for P in list(self.perms):
            if P.get("k"):
                for e in P["k"]["effets"]:
                    if e["quand"] == "fin_tour":
                        self.execute(e, P)
        for P in list(self.perms):
            if not self.est_crea(P):
                continue
            if P.get("fin") == "exil":
                self.meurt(P, exil=True)
            elif P.get("fin") == "aube":
                if not (self.a_autel() and self.autel(P)):
                    self.meurt(P, exil=True)
            elif P.get("fin") == "sac" or (P.get("k") and P["k"].get("ephemere")):
                self.meurt(P, sacrifice=True)
        for P in self.perms:
            P["bonus_p"] = P["bonus_t"] = 0
            P["kws_tmp"] = set()
            P["hate"] = False
        while len(self.hand) > 7:                      # taille de main maximale : un terrain si on en a assez, sinon la plus chère
            terres = [n for n in self.hand if self.C[n]["terrain"]]
            n = terres[0] if terres and len(self.terrains) >= 5 else max(self.hand, key=lambda n: self.C[n]["mv"])
            self.hand.remove(n)
            self.gy.append(n)
            self.stat["defausse_fin"] += 1

    # ================================================================ ton tour
    def mon_tour(self, t):
        self.t = t
        self.rng_contre = random.Random(f"{self.graine}-{t}-contre")
        self.pv_perdu_tour = 0
        for x in self.terrains:
            x[2] = True
        for a in self.adv:
            a.contre_pris = False
        self.sacs = 0
        self.seg_mort = self.opport = False
        self.vat_fait = False
        self.aube_tmp = None
        if self.engag:
            self.debut_tour_engag()
        # entretien
        if self.sur("bitter"):
            self.entre(self.jeton("faerie"))
            self.moi_perd(1, "bitterblossom")
        if self.sur("dawn"):
            self.moi_perd(1, "aube")
        if self.sur("rite"):
            self.entre(self.jeton("rager", fin="sac", hate=True))
        if self.sur("ophio") and not any(P.get("nomj") == "snake" for P in self.perms):
            self.entre(self.jeton("snake"))
        for P in list(self.perms):
            if P.get("k"):
                for e in P["k"]["effets"]:
                    if e["quand"] in ("entretien", "entretien_chaque"):
                        self.execute(e, P)
        if self.sur("sheoW"):
            n = next((x for x in [self.choix_kels([k]) for k in CHOIX_PERM if k != "sheoW"] if x), None)
            if n:
                self.quitte_cim(n)
                self.entre(self.nouveau(self.C[n]))
        if self.sur("dawn"):
            n = self.choix_kels(CHOIX_AUBE) if self.kc["kind"] == "kels" else self.meilleure_au_cim()
            if n:
                self.quitte_cim(n)
                P = self.nouveau(self.C[n], hate=True, fin="aube")
                self.entre(P)
        if self.fin:
            return
        self.pioche(1)
        self.saga_suite()
        self.joue_terrain()
        self.construit_pool()
        if self.engag:
            self.sagas_engag()
            self.landfall_engag()
        self.lancer()
        if self.fin:
            return
        self.avant_combat()
        if self.fin:
            return
        if self.engag:
            self.attaque_engag()
        else:
            self.mon_attaque()
        if self.fin:
            return
        self.apres_combat()
        if self.engag:
            self.landfall_engag()
        self.phase2 = True
        self.lancer()
        self.phase2 = False
        self.demon()
        reserve = (3 if self.imprint and not self.vat_fait else 0) + (3 if self.sur("ophio") and self.a_autel() else 0) + \
            (2 if any(self.kind(n) in ("reactif", "a_reactif") for n in self.hand) else 0)
        if any(self.sur(d) for d in DRAINS) or self.sur("attrition"):
            while len(self.pool) - reserve >= 1:
                pj = [P for P in self.perms if P.get("jeton_pur") and P.get("nomj") not in ("snake",)]
                if not pj or not self.autel(pj[0]):
                    break
        if self.fin:
            return
        self.fin_de_tour()
        if self.sur("reaper") and self.seg_mort:
            self.tue_une()

    # ================================================================ tour d'un adversaire
    def cible_retrait(self, a):
        """La meilleure créature de la table hors celles de a : la tienne ou celle d'un autre adversaire."""
        miennes = [v for v in self.mes_vues() if not ({"hexproof", "linceul"} & self.stats(v["P"])[2])]
        mien = max(miennes, key=lambda v: v["valeur"], default=None)
        autres = [(b, c) for b in self.vivants() if b is not a for c in b.creas if not c.get("hexproof")]
        lui = max(autres, key=lambda bc: valeur_adv(bc[1]), default=None)
        if mien and (not lui or mien["valeur"] >= valeur_adv(lui[1])):
            return ("moi", mien)
        return ("adv", lui) if lui else None

    def tour_adv(self, a):
        t = self.t
        rng = random.Random(f"{self.graine}-{t}-{a.i}")
        A = a.a
        self.seg_mort = self.opport = False
        for c in a.creas:
            c["neuve"] = False
        for c in a.renvois:
            c["neuve"] = True
            a.creas.append(c)
        a.renvois = []
        if self.engag:
            self.degagement_adv(a)
        if self.sur("ophio") and not any(P.get("nomj") == "snake" for P in self.perms):
            self.entre(self.jeton("snake"))
        if self.sur("sheoW") and a.creas:
            self.mort_adv(a, min(a.creas, key=valeur_adv))
        for P in list(self.perms):
            if P.get("k"):
                for e in P["k"]["effets"]:
                    if e["quand"] == "entretien_chaque":
                        self.execute(e, P)
        if self.sur("rite"):                   # son Lightning Rager ne peut pas t'attaquer : il frappe un autre adversaire
            autres = [b for b in self.vivants() if b is not a]
            if autres and rng.random() < 0.6:
                self.perte(rng.choice(autres), 5, "rite_adv")
        serpent = next((P for P in self.perms if P.get("nomj") == "snake"), None)
        if serpent and self.a_autel():
            self.autel(serpent)
        if not self.vat_fait and self.imprint and self.kind(self.imprint) == "maraud" and self.sur("vat") and self.paie(3):
            self.vat_fait = True
            self.entre(self.nouveau(self.C[self.imprint], jeton=True, fin="exil", hate=True))
            for P in [P for P in self.perms if P.get("fin") == "exil"]:
                self.meurt(P, exil=True)
        if self.fin or not a.vivant():
            return
        a.cim += 1
        nouvelles = []
        if t >= A["debut"]:
            r, cumul = rng.random(), 0
            for p, nb, m in A["creatures"]:
                cumul += p
                if r < cumul:
                    for _ in range(nb):
                        M = MODELES[m]
                        nouvelles.append(dict(p=M["p"], t=M["t"], jeton=M.get("jeton", False), noir=rng.random() < A["noir"],
                                              vol=rng.random() < M.get("vol", 0), pietine=rng.random() < M.get("pietine", 0),
                                              hexproof=rng.random() < M.get("hexproof", 0), celerite=rng.random() < M.get("celerite", 0),
                                              contact=False, neuve=True))
                    break
        cm = A["commandant"]
        chef = next((c for c in a.creas if c.get("cmd")), None)
        if chef is None and t >= a.cmd_retour:
            nouvelles.append(dict(p=cm["p"], t=cm["t"], jeton=False, noir=rng.random() < A["noir"], vol=cm.get("vol", False),
                                  pietine=cm.get("pietine", False), hexproof=rng.random() < cm.get("hexproof", 0),
                                  celerite=cm.get("celerite", False), contact=False, neuve=True, cmd=True))
        elif chef is not None:
            if cm.get("generateur"):
                nouvelles.append(dict(p=1, t=1, jeton=True, noir=False, vol=False, pietine=False, hexproof=False,
                                      celerite=False, contact=False, neuve=True))
            if cm.get("croissance"):
                chef["p"] += 1
                chef["t"] += 1
        for c in nouvelles:
            a.creas.append(c)
            for Q in list(self.perms):          # Pandemonium : chaque créature qui arrive inflige sa force
                if Q.get("k") and any(e["quand"] == "toute_entre" for e in Q["k"]["effets"]):
                    cibles = ([None] if self.pv > 0 else []) + [b for b in self.vivants() if b is not a]
                    cible = rng.choice(cibles) if cibles else None
                    if cible is None:
                        self.moi_perd(c["p"], "pandemonium")
                    else:
                        self.perte(cible, c["p"], "pandemonium_adv")
        if self.fin:
            return
        if A.get("brulure") and rng.random() < A["brulure"]:
            cibles = ([None] if self.pv > 0 else []) + [b for b in self.vivants() if b is not a]
            if cibles:
                cible = rng.choice(cibles)
                if cible is None:
                    self.moi_perd(2, "brulure")
                else:
                    self.perte(cible, 2, "brulure_adv")
                if self.fin:
                    return
        if A.get("combo") and t >= A["combo"][0] and rng.random() < A["combo"][1]:
            if not self.je_contre():
                self.fin = ("defaite", "combo")
                return
        autres = len(self.creatures()) + sum(len(b.creas) for b in self.vivants() if b is not a)
        if t >= 5 and rng.random() < A.get("rase", 0) and autres >= len(a.creas) + 3:
            if not (len(self.creatures()) >= 3 and self.je_contre()):
                self.stat["rase_subi"] += 1
                self.rase()
        if rng.random() < A.get("retrait", 0):
            cible = self.cible_retrait(a)
            detruit = rng.random() < 0.6
            if cible and cible[0] == "moi":
                v = cible[1]
                if not (v["valeur"] >= 8 and self.je_contre()):
                    if v["cmd"] and detruit and self.kels_indestructible():
                        pass
                    else:
                        self.stat["retrait_subi"] += 1
                        self.meurt(v["P"], exil=not detruit)
            elif cible:
                b, c = cible[1]
                if detruit:
                    self.mort_adv(b, c)
                else:
                    b.creas.remove(c)
        if rng.random() < A.get("retrait_perm", 0):
            perms = [P for P in self.perms if not self.est_crea(P) and P.get("k") and self.kindp(P) in VALEUR_PERM]
            if perms:
                P = max(perms, key=lambda P: VALEUR_PERM[self.kindp(P)])
                if not (VALEUR_PERM[self.kindp(P)] >= 8 and self.je_contre()):
                    self.meurt(P)
                    self.stat["star_detruite"] += 1
        if rng.random() < A.get("cimetiere", 0) and sum(1 for n in self.gy if self.C[n]["creature"]) >= 4:
            for n in [n for n in self.gy if self.C[n]["creature"]]:
                self.quitte_cim(n)
            self.stat["cimetiere_exile"] += 1
        if self.fin or not a.vivant():
            return
        if self.engag:
            self.attaque_adv_engag(a, rng)
            self.fin_tour_adv_engag(a)
        else:
            self.attaque_adv(a, rng)
        for c in [c for c in a.creas if c.get("rager")]:
            a.creas.remove(c)
        if self.sur("reaper") and self.seg_mort:
            self.tue_une()

    def attaque_adv(self, a, rng):
        att = [c for c in a.creas if c["p"] > 0 and (not c["neuve"] or c["celerite"])]
        cibles = ([None] if self.pv > 0 else []) + [b for b in self.vivants() if b is not a]
        if not att or not cibles:
            return
        poids = [1 / max(self.pv, 1) if c is None else 1 / c.pv for c in cibles]
        cible = rng.choices(cibles, weights=poids)[0]
        if cible is None:
            dfn = self.mes_vues()
            pv_def = self.pv
        else:
            dfn = cible.creas
            for c in dfn:
                c["valeur"] = valeur_adv(c)
            pv_def = cible.pv
        for c in att:
            c["valeur"] = valeur_adv(c)
        if not a.a.get("agressif") and self.t < TOUR_FINAL:
            att = [c for c in att if not any(peut_bloquer(b, c) and tue(b, c) and not tue(c, b) for b in dfn)]
        if not att:
            return
        jetable = (lambda b: b["jetable"]) if cible is None else (lambda b: True)
        degats, morts_a, morts_b, _ = resoudre(att, dfn, pv_def, jetable)
        for c in morts_a:
            self.mort_adv(a, c)
        if cible is None:
            for v in morts_b:
                self.meurt(v["P"])
            self.moi_perd(degats, "combat")
        else:
            for c in morts_b:
                self.mort_adv(cible, c)
            self.perte(cible, degats, "combat_adv")

    # ================================================================ une partie complète
    def jouer(self, T=T_MAX):
        suivi = {}
        for t in range(1, T + 1):
            self.en_mon_tour = True
            self.mon_tour(t)
            self.en_mon_tour = False
            for a in self.adv:
                if self.fin:
                    break
                if a.vivant():
                    self.tour_adv(a)
            if not self.fin and self.kc["kind"] == "kels" and self.cmd_en_jeu():
                for _ in range(self.sacs):
                    if not self.paie(0, ("UB",)):
                        break
                    self.pioche(1)
            v = self.vivants()
            suivi[t] = dict(pv=self.pv, crea_adv=sum(len(a.creas) for a in v) / max(len(v), 1), adv_vivants=len(v),
                            star=any(self.sur(k) for k in ("dawn", "vat", "gift", "sneak")))
            if self.fin:
                break
        res, cause = self.fin or ("pas_finie", "")
        return dict(resultat=res, cause=cause, tour=self.t, suivi=suivi, cmd=self.cmd_tour, stat=self.stat)
