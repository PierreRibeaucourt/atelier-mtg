"""Cartes du simulateur Commander : lecture des listes, fiches Scryfall (cache local), lecture automatique du texte Oracle.

Chaque carte reçoit :
- ses caractéristiques (types, coût, force, endurance, mots-clés) ;
- soit un comportement écrit à la main (COMPORTEMENTS, pour les cartes trop particulières),
- soit des effets reconnus automatiquement dans son texte Oracle (effets d'arrivée, déclencheurs, capacités activées,
  effets statiques, mana, terrains à condition).
`couverture(C)` dit, carte par carte, ce qui a été compris et ce qui ne l'a pas été.
"""
import json
import os
import re
import sys
import urllib.request
from collections import Counter

DOSSIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DOSSIER)
from prix import ENTETES, get  # noqa: E402

CACHE = os.path.join(DOSSIER, "cache_cartes.json")


def K(kind, **kw):
    return dict(kind=kind, **kw)


# ---------------------------------------------------------------- comportements écrits à la main
COMPORTEMENTS = {
    # --- Kels
    "Kels, Fight Fixer": K("kels"),
    "Dawn of the Dead": K("dawn"), "Mimic Vat": K("vat"), "God-Pharaoh's Gift": K("gift"), "Gate to the Afterlife": K("gate"),
    "Back from the Brink": K("brink"), "Ophiomancer": K("ophio"), "Bitterblossom": K("bitter"),
    "Attrition": K("attrition"), "Vampiric Rites": K("vrites"),
    "Demonic Tutor": K("dt"), "Fabricate": K("fab"), "Sidisi, Undead Vizier": K("sidisi"),
    "Trophy Mage": K("mage", cherche="Mimic Vat"), "Treasure Mage": K("mage", cherche="God-Pharaoh's Gift"),
    "Village Rites": K("sacdraw", n=2), "Perilous Research": K("sacdraw", n=2),
    "Reckoner's Bargain": K("sacdraw", n=2, vie=True), "Deadly Dispute": K("sacdraw", n=2, tresor=True),
    "Fleshbag Marauder": K("maraud"), "Merciless Executioner": K("maraud"), "Plaguecrafter": K("maraud"),
    "Demon's Disciple": K("maraud"), "Gravelighter": K("maraud", grave=True), "Merchant of Venom": K("maraud"),
    "Slum Reaper": K("maraud"), "Lokhust Heavy Destroyer": K("maraud"), "Wasteland Raider": K("maraud", squad=True),
    "Accursed Marauder": K("maraud", nontoken=True), "Chain Devil": K("maraud", nontoken=True),
    "Winter, Tormented Loner": K("maraud", onesided=True),
    "Syr Konrad, the Grim": K("konrad"), "Bastion of Remembrance": K("bastion"), "Butcher of Malakir": K("butcher"),
    "Gray Merchant of Asphodel": K("gray"), "Archon of Cruelty": K("archon"), "Massacre Wurm": K("wurm"),
    "Demon of Dark Schemes": K("demon"), "Sheoldred, Whispering One": K("sheoW"), "Sheoldred // The True Scriptures": K("sheoA"),
    "Reaper from the Abyss": K("reaper"), "Morbid Opportunist": K("opportunist"),
    "Mulldrifter": K("evoke", draw=2), "Shriekmaw": K("evoke", kill=1, nonblack=True), "Nevermaker": K("evoke", renvoi=True),
    "Aethersnipe": K("evoke", renvoi=True), "Mournwhelk": K("evoke"), "Slithermuse": K("evoke"),
    "Night Incarnate": K("nightinc"), "Fell Stinger": K("exploit", draw=2), "Stitcher's Supplier": K("supplier"),
    "Baleful Strix": K("corps", draw=1), "Sphinx of Uthuun": K("corps", draw=2), "Reassembling Skeleton": K("corps"),
    "Callidus Assassin": K("corps"), "Solemn Simulacrum": K("solemn"),
    "Ravenous Chupacabra": K("remcrea"), "Nekrataal": K("remcrea", nonblack=True), "Meteor Golem": K("remcrea"),
    "Counterspell": K("reactif"), "Venser, Shaper Savant": K("reactif"), "Feed the Swarm": K("remsort"),
    "Damnation": K("wipe"), "Deadly Tempest": K("wipe", tempest=True), "Massacre Girl": K("wipe"), "In Garruk's Wake": K("wipe1"),
    "Leyline of Anticipation": K("autre"), "Vedalken Orrery": K("autre"),
    # --- Greven
    "Greven, Predator Captain": K("greven"),
    "Sneak Attack": K("sneak"), "Incandescent Soulstoke": K("soulstoke"), "Molten Echoes": K("echoes"),
    "Thunderkin Awakener": K("thunderkin"), "Apprentice Necromancer": K("necro"), "Skullclamp": K("clamp"),
    "Heirloom Blade": K("blade"), "Sparkspitter": K("spitter"), "Nova Chaser": K("nova"), "Lightning Serpent": K("serpent"),
    "Elemental Appeal": K("appeal"), "Jeska's Will": K("jeska"), "Mana Geyser": K("geyser"),
    "Rite of the Raging Storm": K("rite"), "Temur Battle Rage": K("tbr"), "Generator Servant": K("servant"),
    "Heartlash Cinder": K("cinder"), "Tibalt's Trickery": K("reactif"), "Gruesome Encore": K("encore"),
    "Stinging Study": K("study"), "Pyroblast": K("reactif", bleu=True), "Red Elemental Blast": K("reactif", bleu=True),
    "Last One Standing": K("wipe"), "Chaos Warp": K("remsort"),
    # --- Tromokratis : mode engagement (simu_engage.py)
    "Tromokratis": K("tromo"),
    "Kefnet's Monument": K("e_kefnet"), "Propaganda": K("e_propagande"), "Hylda's Crown of Winter": K("e_couronne"),
    "Opposition": K("e_opposition"), "Quiet Contemplation": K("e_contemplation"), "Bloodthirsty Blade": K("e_lame"),
    "Bident of Thassa": K("e_bident"), "Thassa, God of the Sea": K("e_thassa", creature=False),
    "Claustrophobia": K("e_aura"), "Bubble Snare": K("e_aura", kicker=True), "Fall from Favor": K("e_aura", monarque=True),
    "Stunning Strike": K("e_aura", flash=True), "Observed Stasis": K("e_aura", flash=True, neutralise=True),
    "Psychic Impetus": K("e_goad_aura"), "Fealty to the Realm": K("e_fealty"),
    "Time of Ice": K("e_saga"), "Kang Dynasty": K("e_saga"), "Summon: Shiva": K("e_saga"), "Scroll of Isildur": K("e_saga"),
    "Tamiyo, the Moon Sage": K("e_tamiyo"),
    "Gigadrowse": K("e_sort_tap", mode="giga"), "Icy Blast": K("e_sort_tap", mode="icy"),
    "Lost in the Maze": K("e_sort_tap", mode="maze"), "Sleep": K("e_sort_tap", mode="sleep"),
    "Cryptic Command": K("e_sort_tap", mode="cryptic"), "Imaginary Threats": K("e_menaces"),
    "Borrowing 100,000 Arrows": K("e_pioche_eng"), "Theft of Dreams": K("e_pioche_eng"),
    "Whelming Wave": K("e_vague", mode="whelming"), "Engulf the Shore": K("e_vague", mode="engulf"),
    "Cyclonic Rift": K("e_vague", mode="rift"), "Scourge of Fleets": K("e_vague", mode="scourge"),
    "Slinn Voda, the Rising Deep": K("e_vague", mode="slinn"), "Kederekt Leviathan": K("e_vague", mode="kederekt"),
    "Stubborn Denial": K("reactif"),
    "Snaremaster Sprite": K("e_crea_tap", n=1, gel=1, extra=2), "Floodpits Drowner": K("e_crea_tap", n=1, gel=1, noyeur=True),
    "Freeze in Place": K("e_sort_tap", mode="stun3"), "Impede Momentum": K("e_sort_tap", mode="stun3"),
    "Grappling Kraken": K("e_tazeem", toujours_gel=True),
    "Portal Mage": K("e_redirect"), "Misleading Signpost": K("e_redirect", rock=True), "Illusionist's Gambit": K("e_gambit"),
    "Mesmerizing Benthid": K("e_benthid"),
    "Merfolk Trickster": K("e_crea_tap", n=1, flash=True), "Frost Trickster": K("e_crea_tap", n=1, gel=1),
    "Juvenile Mist Dragon": K("e_crea_tap", n="chaque", gel=1), "Frost Titan": K("e_crea_tap", n=1, gel=1, attaque=True),
    "Breaching Leviathan": K("e_crea_tap", n="tous", gel=1),
    "Guardian of Tazeem": K("e_tazeem"), "Tolarian Kraken": K("e_tolarian"), "Angler Turtle": K("e_turtle"),
    "Maeve, Insidious Singer": K("e_maeve"), "Sly Instigator": K("e_sly"),
    "Archivist of Gondor": K("e_archiviste"), "Azure Fleet Admiral": K("e_amirale"),
}
# mana net des sources qui demandent du mana pour en produire (sinon le moteur compte le mana produit sans le coût)
MANA_NET = {"Apprentice Wizard": 2}           # {U}, {T} : {C}{C}{C}
# terrains compris par le mode engagement (simu_engage.py) : leurs capacités ne sont pas lues automatiquement
TERRAINS_ENGAG = {"Maze of Ith", "Mystifying Maze", "Minamo, School at Water's Edge"}

# Valeur d'une de tes créatures : ce que l'adversaire vise en premier, ce que tu évites d'échanger.
VALEUR_KIND = {"sheoW": 10, "kels": 9, "greven": 9, "butcher": 8, "demon": 8, "konrad": 8, "sheoA": 7, "wurm": 7, "reaper": 7,
               "archon": 7, "gray": 6, "ophio": 5, "opportunist": 4, "soulstoke": 6, "thunderkin": 5, "spitter": 4}
# Valeur de tes artefacts / enchantements pour les destructions adverses.
VALEUR_PERM = {"gift": 10, "dawn": 9, "vat": 8, "sneak": 9, "echoes": 7, "brink": 6, "attrition": 6, "bitter": 5, "bastion": 5,
               "gate": 4, "vrites": 3, "clamp": 6, "rite": 5, "a_moteur": 7}
# Créatures que tu acceptes d'échanger au combat.
JETABLES = {"corps", "supplier", "rock", "mage", "evoke", "exploit", "sidisi", "maraud", "remcrea", "solemn", "a_crea", "a_removal"}

TYPES_TERRAIN = {"Swamp": {"Swamp"}, "Island": {"Island"}, "Mountain": {"Mountain"}, "Forest": {"Forest"}, "Plains": {"Plains"},
                 "Sunken Hollow": {"Island", "Swamp"}, "Smoldering Marsh": {"Swamp", "Mountain"}}
TERRAINS_SPECIAUX = {"Clearwater Pathway": ("pathway", None), "Tainted Isle": ("tainted", None), "Eclipsed Realms": ("realms", "Elemental"),
                     "Evolving Wilds": ("fetch", None), "Terramorphic Expanse": ("fetch", None)}

MOTS = {"flying": "vol", "menace": "menace", "deathtouch": "contact", "trample": "pietine", "haste": "celerite",
        "double strike": "double", "first strike": "premiere", "lifelink": "lien", "vigilance": "vigilance", "defender": "defenseur",
        "flash": "flash", "indestructible": "indestructible", "hexproof": "hexproof", "shroud": "linceul", "reach": "portee",
        "swampwalk": "marais", "fear": "peur", "intimidate": "peur", "persist": "persist", "undying": "persist"}
MOTS_SANS_EFFET = ("morph", "bloodrush", "chroma", "champion", "squad", "exploit", "escape", "kicker", "evoke", "unearth", "cycling",
                   "swampcycling", "mountaincycling", "islandcycling", "forestcycling", "plainscycling", "landcycling", "equip",
                   "ward", "protection from", "flashback", "foretell", "mutate", "prowess", "echo", "madness", "imprint", "meld",
                   "behold", "station", "start your engines", "raid", "boast", "heroic", "tribute", "devoid", "changeling",
                   "landwalk", "affinity", "convoke", "delve", "emerge", "cascade", "storm", "split second", "suspend", "partner")
# mot entier : « equip {1} » est un mot-clé, « equipped creature has haste » n'en est pas un
MOTS_SANS_EFFET_RX = re.compile(r"(?:" + "|".join(map(re.escape, MOTS_SANS_EFFET)) + r")\b")
NOMBRES = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "x": "X"}


# ---------------------------------------------------------------- listes
def lire_liste(chemin):
    """Lit une liste : export Archidekt « 1x Nom [Tags] », ou « 1 Nom » avec « SB: 1 Commandant ».
    Renvoie (commandant, liste des autres cartes avec répétitions)."""
    cmd, cartes = None, []
    for ligne in open(chemin, encoding="utf-8"):
        ligne = ligne.strip()
        m = re.search(r"commandant\s*:\s*(.+)$", ligne, re.I)
        if ligne.startswith("//"):
            if m and not cmd:
                cmd = m.group(1).strip()
            continue
        sb = ligne.upper().startswith("SB:")
        ligne = re.sub(r"\s*\^[^^]*\^\s*$", "", ligne)          # étiquette Archidekt « ^Have,#37d67a^ »
        m = re.match(r"(?:SB:\s*)?(\d+)x?\s+(.+?)\s*(?:\[(.*)\])?\s*$", ligne)
        if not m:
            continue
        n, nom, tags = int(m.group(1)), m.group(2).strip(), m.group(3) or ""
        nom = re.sub(r"\s+\([A-Za-z0-9]{2,6}\)(?:\s+[\w★-]+)?(?:\s+\*[A-Z]+\*)?$", "", nom)   # impression « (ima) 205 *F* »
        if "Maybeboard" in tags or "Sideboard" in tags:
            continue
        if "Commander" in tags or sb:
            cmd = nom
            continue
        cartes += [nom] * n
    return cmd, [c for c in cartes if c != cmd]


def fiches(noms):
    """Fiches Scryfall des cartes, gardées dans cache_cartes.json pour ne pas réinterroger Scryfall."""
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    manquants = sorted({n for n in noms if n not in cache})
    for i in range(0, len(manquants), 75):
        bloc = manquants[i:i + 75]
        corps = json.dumps({"identifiers": [{"name": n} for n in bloc]}).encode()
        req = urllib.request.Request("https://api.scryfall.com/cards/collection", data=corps,
                                     headers={**ENTETES, "Content-Type": "application/json"})
        rep = json.load(urllib.request.urlopen(req))
        cartes = list(rep["data"])
        for nf in rep.get("not_found", []):          # cartes recto-verso demandées sous leur nom complet, noms approximatifs
            c = (get("https://api.scryfall.com/cards/named", {"exact": nf["name"].split(" // ")[0]})
                 or get("https://api.scryfall.com/cards/named", {"fuzzy": nf["name"]}))
            if c:
                c["_demande"] = nf["name"]
                cartes.append(c)
            else:
                print("Carte introuvable sur Scryfall :", nf["name"])
        for c in cartes:
            f0 = (c.get("card_faces") or [c])[0]
            fiche = dict(nom=c["name"], cout=f0.get("mana_cost") or c.get("mana_cost") or "", type=f0.get("type_line") or c["type_line"],
                         texte=f0.get("oracle_text") or c.get("oracle_text") or "", force=f0.get("power"), endurance=f0.get("toughness"),
                         mots=c.get("keywords", []), produit=c.get("produced_mana") or [], identite=c.get("color_identity", []))
            for n in bloc:
                if n == c.get("_demande") or n == c["name"] or c["name"].startswith(n + " // ") or n.split(" // ")[0] == c["name"].split(" // ")[0]:
                    cache[n] = fiche
    if manquants:
        json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return cache


def parse_cout(txt):
    """'{2}{U}{B}' -> (générique, symboles colorés). Hybride {U/B} -> 'UB' ; phyrexian {B/P} -> 'B' (payé en mana) ; X = 0."""
    g, pips = 0, []
    for s in re.findall(r"\{([^}]*)\}", txt or ""):
        s = s.upper()
        if s.isdigit():
            g += int(s)
        elif s in ("W", "U", "B", "R", "G"):
            pips.append(s)
        elif s == "C":
            g += 1
        elif "/" in s:
            parts = [p for p in s.split("/") if p in "WUBRG"]
            if parts:
                pips.append("".join(parts))
            else:
                g += int(s.split("/")[0])
    return g, tuple(pips)


def _entier(x):
    return int(x) if x and str(x).lstrip("-").isdigit() else 0


def _nb(s):
    s = (s or "a").strip()
    return int(s) if s.isdigit() else NOMBRES.get(s, 1)


# ---------------------------------------------------------------- lecture automatique du texte Oracle
def _cible(s):
    s = s or ""
    if "each opponent" in s:
        return "chaque_adv"
    if "each creature" in s or "each other creature" in s:
        return "chaque_crea"
    if "any target" in s or "target player or planeswalker" in s or "target opponent" in s or "target player" in s:
        return "joueur_ou_crea"
    return "crea"


IGNOREES = (r"can't be regenerated|spend this mana only|meld them|deals 1 damage to you|^activate only|that player discards|lose indestructible until end of turn|"
            r"^then shuffle|^shuffle|^reveal it|it gains haste|that creature gains haste|^choose one|"
            r"sacrifice (it|that creature|the creature) at the beginning of the next end step|exile (it|that token|them) at the beginning of the next end step")


def actions(c):
    """Traduit le texte d'un effet en liste d'actions. Renvoie (actions, tout_compris)."""
    acts, tout = [], True
    for phrase in re.split(r"(?<=\.)\s+", c.strip()):
        p = phrase.strip().rstrip(".")
        p = re.sub(r"^(you may |if you do, |then )", "", p)
        if not p:
            continue
        if re.search(IGNOREES, p):
            continue
        r = None
        if m := re.search(r"destroy (?:up to one )?target ((?:non\w+,? )*)(creature|permanent|nonland permanent|artifact|enchantment)(?: or \w+)?( an opponent controls)?", p):
            r = dict(a="detruit", nonblack="nonblack" in m.group(1), nonartifact="nonartifact" in m.group(1), quoi=m.group(2))
        elif re.search(r"exile (?:up to one )?target (?:nontoken )?(?:creature|nonland permanent|permanent)", p):
            r = dict(a="detruit", exil=True)
        elif re.search(r"the owner of target permanent shuffles it into their library", p):
            r = dict(a="detruit", exil=True)
        elif m := re.search(r"deals? (\d+|x) damage to (any target|target creature or planeswalker|target creature|target player or planeswalker|target opponent|target player|each opponent|each creature and each [\w-]+ planeswalker|each creature|each other creature)", p):
            n = _nb(m.group(1))
            r = dict(a="degats", n=n, cible=_cible(m.group(2)), x_creatures="number of creatures on the battlefield" in c)
        elif m := re.search(r"deals? damage equal to (?:its|that creature's|the sacrificed creature's|~'s) power to (any target|target creature|each opponent|target player|target opponent)", p):
            r = dict(a="degats_force", cible=_cible(m.group(1)), sacrifiee="sacrificed" in p)
        elif m := re.search(r"each player sacrifices (a|an|one|two|three) (nontoken )?creature", p):
            r = dict(a="edict", qui="tous", n=_nb(m.group(1)), nontoken=bool(m.group(2)))
        elif m := re.search(r"(each opponent|target opponent|target player|each other player) sacrifices (a|an|one|two|three) (nontoken )?creature", p):
            r = dict(a="edict", qui="adv", n=_nb(m.group(2)), nontoken=bool(m.group(3)))
        elif m := re.search(r"(?:you |target player )?draws? (a|one|two|three|four|five|x|\d+) cards?", p):
            r = dict(a="pioche", n=_nb(m.group(1)))
        elif "draw a card" in p:
            r = dict(a="pioche", n=1)
        elif m := re.search(r"create (a|an|one|two|three|four|five|\d+|x) (tapped )?(\d+)/(\d+) ([\w\s,-]+?) creature tokens?(?: with ([\w\s,]+?))?(?: named [\w\s']+)?$", p):
            kws = {MOTS[w.strip()] for w in re.split(r",| and ", m.group(6) or "") if w.strip() in MOTS}
            r = dict(a="jetons", n=_nb(m.group(1)), p=int(m.group(3)), t=int(m.group(4)), kws=sorted(kws),
                     types=[w.capitalize() for w in m.group(5).split() if w not in ("red", "black", "blue", "white", "green", "colorless", "and")],
                     fin="exil" if "exile it at the beginning" in c.lower() or "exile them at the beginning" in c.lower() else
                         ("sac" if "sacrifice this token" in c.lower() or "sacrifice that token" in c.lower() or "sacrifice it at the beginning" in c.lower() else None))
        elif "return target creature card from your graveyard to the battlefield" in p or "return target creature card from a graveyard to the battlefield" in p \
                or "put target creature card from a graveyard onto the battlefield" in p:
            r = dict(a="reanime", temp=bool(re.search(r"sacrifice (?:it|that creature)|exile it at the beginning", c.lower())), hate="haste" in c.lower())
        elif "return target creature card from your graveyard to your hand" in p:
            r = dict(a="recup")
        elif re.search(r"search your library for (?:up to (?:one|two) |a |an )?basic land cards?", p) and "battlefield" in c.lower():
            r = dict(a="terrain_base")
        elif m := re.search(r"search your library for an? ([\w]+ )?card", p):
            r = dict(a="tuteur", type=(m.group(1) or "").strip().capitalize() or None, dessus="on top" in c.lower())
        elif m := re.search(r"each opponent loses (\d+|x) life", p):
            r = dict(a="draine", n=_nb(m.group(1)), gagne="you gain" in p)
        elif m := re.search(r"target (?:player|opponent) loses (\d+|x) life", p):
            r = dict(a="draine", n=_nb(m.group(1)), cible_une=True, gagne="you gain" in p)
        elif m := re.search(r"that player loses (\d+) life", p):
            r = dict(a="perte_proprio", n=int(m.group(1)))
        elif m := re.search(r"you gain (\d+) life", p):
            r = dict(a="vie", n=int(m.group(1)))
        elif m := re.search(r"you lose (\d+) life", p):
            r = dict(a="perd", n=int(m.group(1)))
        elif re.search(r"you lose life equal to that permanent's mana value", p):
            r = dict(a="rien")
        elif m := re.search(r"target creature (?:you control )?gets \+(\d+|x)/\+(\d+)(?: and gains ([\w ]+))?", p):
            r = dict(a="pump", p=_nb(m.group(1)), t=int(m.group(2)), hate="haste" in p, df="double strike" in p)
        elif re.search(r"target creature gains (double strike|haste)", p):
            r = dict(a="pump", p=0, t=0, hate="haste" in p, df="double strike" in p)
        elif m := re.search(r"(\w+?)s? you control gain haste until end of turn", p):
            r = dict(a="hate_tous", type=None if m.group(1) in ("creature", "") else m.group(1).capitalize())
        elif "counter target spell" in p:
            r = dict(a="contre")
        elif re.search(r"destroy all creatures you don't control", p):
            r = dict(a="rase", seulement_adv=True)
        elif re.search(r"destroy all (?:other )?creatures", p) or re.search(r"choose a creature at random, then destroy the rest", p):
            r = dict(a="rase")
        elif m := re.search(r"all (other )?creatures get -(\d+)/-(\d+)", p):
            r = dict(a="moins", n=int(m.group(3)), autres=bool(m.group(1)))
        elif m := re.search(r"creatures your opponents control get -(\d+)/-(\d+)", p):
            r = dict(a="moins", n=int(m.group(2)), seulement_adv=True)
        elif m := re.search(r"up to (one|two|three) target creatures can't block", p):
            r = dict(a="pas_bloquer", n=_nb(m.group(1)))
        elif m := re.search(r"^add (\{[^}]+\}(?:\{[^}]+\})*)", p):
            r = dict(a="mana", n=len(re.findall(r"\{", m.group(1))))
        elif re.search(r"^add (one|two) mana", p):
            r = dict(a="mana", n=_nb(re.search(r"^add (one|two)", p).group(1)))
        elif "put it into your hand" in p or "put that card into your hand" in p:
            r = dict(a="rien")
        if r:
            acts.append(r)
        else:
            tout = False
    return acts, tout


DECLENCHEURS = [
    (r"^when(?:ever)? ~ enters or attacks, (.*)", ["etb", "attaque"]),
    (r"^when(?:ever)? ~ enters(?: the battlefield)?(?: or dies)?, (.*)", ["etb"]),
    (r"^when ~ leaves the battlefield, (.*)", ["quitte"]),
    (r"^when ~ dies, (.*)", ["meurt"]),
    (r"^whenever ~ or another creature you control dies, (.*)", ["ma_mort"]),
    (r"^whenever a creature you control dies, (.*)", ["ma_mort"]),
    (r"^whenever another (?:nontoken )?creature you control dies, (.*)", ["autre_meurt"]),
    (r"^whenever ~ or another creature dies, (.*)", ["toute_mort"]),
    (r"^whenever (?:another|a) creature dies, (.*)", ["toute_mort"]),
    (r"^whenever a creature an opponent controls dies, (.*)", ["adv_meurt"]),
    (r"^whenever another creature you control enters, (.*)", ["autre_entre"]),
    (r"^whenever another creature enters(?: the battlefield)? under your control, (.*)", ["autre_entre"]),
    (r"^whenever a creature enters(?: the battlefield)?, (.*)", ["toute_entre"]),
    (r"^at the beginning of your upkeep, (.*)", ["entretien"]),
    (r"^at the beginning of each (?:player's )?upkeep, (.*)", ["entretien_chaque"]),
    (r"^at the beginning of your end step, (.*)", ["fin_tour"]),
    (r"^whenever ~ attacks, (.*)", ["attaque"]),
    (r"^whenever ~ deals combat damage to a player, (.*)", ["degats_joueur"]),
    (r"^whenever you sacrifice (?:a|another) creature, (.*)", ["sac"]),
    (r"^whenever equipped creature dies, (.*)", ["equipee_meurt"]),
]


def analyser(nom, f, permanent=True):
    """Lit le texte Oracle : renvoie effets, statiques, activables, mana, règle d'arrivée (terrains) et lignes non comprises."""
    court = nom.split(" // ")[0]
    texte = re.sub(r"\([^)]*\)", "", f["texte"])
    for x in (court, court.split(",")[0]):
        texte = texte.replace(x, "~")
    texte = re.sub(r"\bthis (creature|artifact|enchantment|land|spell|token|equipment|card|aura)\b", "~", texte, flags=re.I)
    d = dict(effets=[], statiques=[], activables=[], mana=None, regle=None, ephemere=None, non_lu=[], alt={}, behold=None)
    for ligne in [l.strip() for l in texte.split("\n") if l.strip()]:
        l = ligne.lower().rstrip()
        mots = [w.strip() for w in re.split(r",|;", l) if w.strip()]
        if all(w in MOTS or MOTS_SANS_EFFET_RX.match(w) or w.split(" {")[0] in MOTS for w in mots):
            for w in mots:                     # ligne de mots-clés : évocation, kicker, unearth, recyclage de terrain, équipement
                for cle in ("evoke", "kicker", "unearth", "equip", "flashback"):
                    if w.startswith(cle + " "):
                        d["alt"][cle] = parse_cout(w[len(cle):])
                if re.match(r"\w*cycling \{", w):
                    d["alt"]["landcycling" if re.match(r"(swamp|mountain|island|forest|plains|land)cycling", w) else "cycling"] = parse_cout(w)
            continue
        if re.match(r"at the beginning of (?:the|each|your) (?:next )?end step, (?:if ~ wasn't kicked, )?sacrifice (?:~|it)", l):
            d["ephemere"] = "sac"
            continue
        # coût additionnel « behold » (Champion of the Path) : exiler un X qu'on contrôle ou qu'on a en main, rendu en main au départ
        if m := re.match(r"^as an additional cost to cast ~, behold an? (\w+) and exile it", l):
            d["behold"] = m.group(1).capitalize()
            continue
        if re.match(r"^when ~ leaves the battlefield, return the exiled card to its owner's hand", l):
            continue
        # « whenever another Elemental you control enters » : déclencheur limité à un type de créature
        if (m := re.match(r"^whenever another (\w+) you control enters(?: the battlefield)?, (.*)", l)) and m.group(1) != "creature":
            acts, tout = actions(m.group(2))
            for a in acts:
                d["effets"].append(dict(quand="autre_entre", type=m.group(1).capitalize(), **a))
            if not tout:
                d["non_lu"].append(ligne)
            continue
        trouve = False
        for rx, quand in DECLENCHEURS:
            m = re.match(rx, l)
            if m:
                acts, tout = actions(m.group(1))
                for q in quand:
                    for a in acts:
                        d["effets"].append(dict(quand=q, **a))
                if not tout:
                    d["non_lu"].append(ligne)
                trouve = True
                break
        if trouve:
            continue
        # capacités activées « coût : effet »
        m = re.match(r"^((?:\{[^}]+\}|,|\s|sacrifice [\w~ ]+?|discard a card|pay \d+ life|exile [\w ~]+? from your graveyard|remove [\w ]+)+):\s*(.+)$", l)
        if m and ("{" in m.group(1) or m.group(1).startswith(("sacrifice", "discard", "pay"))):
            cout_txt, eff = m.group(1), m.group(2)
            acts, tout = actions(eff)
            restr = re.search(r"spend this mana only to cast (\w+) spells", eff)
            ab = dict(cout=parse_cout(re.sub(r"\{t\}", "", cout_txt)), tap="{t}" in cout_txt, sac_soi="sacrifice ~" in cout_txt,
                      sac_crea=bool(re.search(r"sacrifice (?:a|another) creature", cout_txt)), defausse="discard a card" in cout_txt,
                      actions=acts, restriction=restr.group(1).capitalize() if restr else None)
            if acts and acts[0]["a"] == "mana":
                ab["mana_n"] = acts[0]["n"]
            d["activables"].append(ab)
            if not tout:
                d["non_lu"].append(ligne)
            continue
        # effets statiques
        if m := re.match(r"^(other )?(\w+ )?creatures you control get \+(\d+)/\+(\d+)", l):
            d["statiques"].append(dict(s="anthem", type=(m.group(2) or "").strip().capitalize() or None, p=int(m.group(3)),
                                       t=int(m.group(4)), autres=bool(m.group(1))))
        elif "it deals double that damage" in l:
            d["statiques"].append(dict(s="double_degats"))
        elif "that entered this turn would deal damage" in l and "twice that much damage" in l:   # Neriv
            d["statiques"].append(dict(s="double_neuves"))
        elif re.match(r"^attacking creatures you control have double strike", l):
            d["statiques"].append(dict(s="double_frappe"))
        elif m := re.match(r"^(\w+ )?spells you cast cost \{(\d+)\} less", l):
            d["statiques"].append(dict(s="reduction", couleur=(m.group(1) or "").strip(), n=int(m.group(2))))
        elif m := re.match(r"^(\w+) spells and (\w+) spells you cast cost \{(\d+)\} less", l):   # Banneret
            d["statiques"].append(dict(s="reduction", couleur=m.group(1), autre=m.group(2), n=int(m.group(3))))
        elif re.match(r"^~ costs \{1\} less to cast for each creature on the battlefield", l):
            d["statiques"].append(dict(s="reduc_creatures"))
        elif m := re.match(r"^equipped creature gets \+(\d+)/([+-]\d+)", l):
            d["statiques"].append(dict(s="equip_bonus", p=int(m.group(1)), t=int(m.group(2))))
        elif m := re.match(r"^equipped creature has ([\w, ]+)", l):
            d["statiques"].append(dict(s="equip_mots", kws=[MOTS[w.strip()] for w in re.split(r",| and ", m.group(1)) if w.strip() in MOTS]))
        elif m := re.match(r"^(\w+ )?creatures you control have haste", l):
            d["statiques"].append(dict(s="hate", type=(m.group(1) or "").strip().capitalize() or None))
        elif re.match(r"^~ can't block", l):
            d["statiques"].append(dict(s="pas_bloquer"))
        elif re.match(r"^(~ )?enters tapped\.?$", l) or re.match(r"^~ enters tapped\.?$", l):
            d["regle"] = ("engage", None)
        elif m := re.match(r"^~ enters tapped unless you control (?:a|an) (\w+) or (?:a|an) (\w+)", l):
            d["regle"] = ("controle", {m.group(1).capitalize(), m.group(2).capitalize()})
        elif re.match(r"^~ enters tapped unless you control two or more basic lands", l):
            d["regle"] = ("bases2", None)
        elif re.match(r"^~ enters tapped unless you control two or more other lands", l):
            d["regle"] = ("autres2", None)
        elif m := re.match(r"^as ~ enters, you may reveal (?:a|an) (\w+)(?: or (\w+))? card from your hand", l):
            d["regle"] = ("revele", {x.capitalize() for x in m.groups() if x})
        elif re.match(r"^as an additional cost to cast ~, sacrifice a creature", l):
            d["statiques"].append(dict(s="cout_sac"))
        elif re.match(r"^~ (has trample as long as|enters tapped\.? $)", l) or "meld them" in l or re.match(r"^as ~ enters, choose", l):
            pass
        elif not permanent and (lambda r: r[0] and r[1])(actions(l)):
            for a in actions(l)[0]:
                d["effets"].append(dict(quand="sort", **a))
        elif not permanent and actions(l)[0]:
            for a in actions(l)[0]:
                d["effets"].append(dict(quand="sort", **a))
            d["non_lu"].append(ligne)
        elif re.match(r"^(you have no maximum hand size|~ attacks each combat if able|~ can't be countered|"
                      r"spells your opponents cast that target ~ cost|you may cast ~ from your graveyard|~ gets \+x/\+0, where x)", l):
            pass
        else:
            d["non_lu"].append(ligne)
    # mana des terrains et cailloux
    for ab in d["activables"]:
        if ab.get("mana_n"):
            d["mana"] = dict(n=ab["mana_n"], restriction=ab["restriction"], cout=ab["cout"], tap=ab["tap"], sac_soi=ab["sac_soi"])
            break
    return d


# ---------------------------------------------------------------- préparation des cartes pour le moteur
def role_auto(k):
    """Rôle d'une carte lue automatiquement, qui fixe sa priorité de lancement."""
    acts = {e["a"] for e in k["effets"]}
    sorts = [e for e in k["effets"] if e["quand"] in ("sort", "etb")]
    if k["terrain"]:
        return "terrain"
    if k["mana"] and not k["creature"] and k["permanent"]:
        return "rock"
    if k["mana"] and k["creature"]:
        return "rock"
    if any(e["a"] == "terrain_base" for e in sorts) or any(a["actions"] and a["actions"][0]["a"] == "terrain_base" for a in k["activables"]):
        return "a_ramp"
    if any(s["s"] in ("double_degats", "double_frappe", "anthem", "reduction", "hate") for s in k["statiques"]) and not k["creature"]:
        return "a_moteur"
    if any(s["s"].startswith("equip") for s in k["statiques"]):
        return "a_equip"
    if any(e["quand"] in ("autre_entre", "toute_entre", "ma_mort", "autre_meurt", "toute_mort", "adv_meurt", "entretien", "entretien_chaque", "sac")
           for e in k["effets"]):
        return "a_moteur"
    if not k["permanent"]:
        if acts & {"rase", "moins"} or any(e["a"] == "degats" and e["cible"] == "chaque_crea" for e in k["effets"]):
            return "a_rase"
        if "degats_force" in acts:
            return "a_fling"
        if "contre" in acts:
            return "a_reactif"
        if acts & {"detruit", "degats", "edict"}:
            return "a_removal"
        if "reanime" in acts:
            return "a_reanime"
        if acts & {"pioche", "tuteur", "recup"}:
            return "a_pioche"
        return "a_autre"
    if k["creature"]:
        return "a_crea"
    return "a_moteur" if k["effets"] or k["statiques"] else "a_autre"


def construire(noms, cmd):
    """Prépare toutes les cartes d'une liste (plus le commandant) pour le moteur. Renvoie (cartes, noms non compris)."""
    F = fiches(list(noms) + [cmd])
    identite = set(F[cmd]["identite"]) or {"C"}
    C = {}
    for n in set(noms) | {cmd}:
        f = F[n]
        types = set(re.findall(r"\b(Creature|Land|Artifact|Enchantment|Instant|Sorcery|Planeswalker|Battle)\b", f["type"]))
        sous = set(f["type"].split("—")[1].split()) if "—" in f["type"] else set()
        comp = COMPORTEMENTS.get(n)
        an = analyser(n, f, permanent=not ({"Instant", "Sorcery"} & types))
        k = dict(nom=n, types=types, sous_types=sous, creature="Creature" in types, terrain="Land" in types,
                 permanent=not ({"Instant", "Sorcery"} & types), legendaire="Legendary" in f["type"])
        k.update({a: b for a, b in (comp or {}).items() if a != "kind"})
        k["plein"] = parse_cout(f["cout"])
        k["x"] = "{X}" in f["cout"]
        k["mv"] = k["plein"][0] + len(k["plein"][1])
        k["couleurs"] = {c for p in k["plein"][1] for c in p}
        k["pips"] = sum(1 for p in k["plein"][1] if "B" in p)             # dévotion au noir (Marchand gris)
        k["rouges"] = sum(1 for p in k["plein"][1] if "R" in p)
        k["p"], k["t"] = _entier(f["force"]), _entier(f["endurance"])
        mots = {MOTS[m.lower()] for m in f["mots"] if m.lower() in MOTS}
        k["kw"] = mots
        k.update(vol="vol" in mots, menace="menace" in mots, contact="contact" in mots, pietine="pietine" in mots,
                 celerite="celerite" in mots, marais="marais" in mots, peur="peur" in mots)
        k["effets"], k["statiques"], k["activables"] = an["effets"], an["statiques"], an["activables"]
        k["alt"], k["ephemere"], k["non_lu"] = an["alt"], an["ephemere"], an["non_lu"]
        k["behold"] = an["behold"]
        k["persist"] = "persist" in mots
        evoke = an["alt"].get("evoke")
        k["cout"] = k["plein"]
        couleurs = "".join(c for c in "WUBRG" if c in f["produit"] and c in identite)
        if k["terrain"]:
            k["kind"] = "terrain"
            k["regle"] = TERRAINS_SPECIAUX.get(n) or an["regle"]
            # « » : ne produit pas de mana (Labyrinthe d'Ith) ; les fetchs (TERRAINS_SPECIAUX) gardent « C »
            k["mana"] = (couleurs or "C") if (f["produit"] or n in TERRAINS_SPECIAUX) else ""
            k["types_terrain"] = TYPES_TERRAIN.get(n, {t for t in sous if t in ("Swamp", "Island", "Mountain", "Forest", "Plains")})
            k["base"] = "Basic" in f["type"]
            k["hate_terrain"] = any(a["actions"] and a["actions"][0]["a"] == "pump" and a["actions"][0].get("hate") for a in an["activables"])
            k["filtre"] = bool(re.search(r"\{[^}]+\}, \{T\}: Add \{", f["texte"])) or "{1}, {T}" in f["texte"]
        elif comp:                      # écrite à la main : on n'utilise pas la lecture automatique (sinon effets en double)
            k["kind"] = comp["kind"]
            k["effets"], k["statiques"], k["activables"] = [], [], []
            if comp["kind"] == "evoke" and evoke:
                k["cout"] = evoke
        else:
            k["mana_auto"] = an["mana"]
            k["kind"] = role_auto(dict(k, mana=an["mana"]))
            k["evoke"] = evoke
        if k["kind"] == "rock" or (not k["terrain"] and an["mana"]):
            k["mana"] = couleurs or "C"
            m = an["mana"] or {}
            k["mana_n"] = m.get("n", 1)
            k["restriction"] = m.get("restriction")
            k["immediat"] = not k["creature"] and "enters tapped" not in f["texte"] and not m.get("sac_soi")
            if n in MANA_NET:
                k["mana_n"] = MANA_NET[n]
        C[n] = k
    return C, couverture(C)


def couverture(C):
    """Classe chaque carte : écrite à la main, lue automatiquement, lue en partie, ou jouée sans effet."""
    res = {"specifique": [], "auto": [], "partiel": [], "corps": [], "sans_effet": []}
    engag = any(k["kind"].startswith("e_") or k["kind"] == "tromo" for k in C.values())
    for n, k in sorted(C.items()):
        if k["terrain"] and (not k["non_lu"] or n in TERRAINS_SPECIAUX):
            res["auto"].append(n)
        elif k["terrain"] and n in TERRAINS_ENGAG and engag:
            res["specifique"].append(n)
        elif n in COMPORTEMENTS:
            res["specifique"].append(n)
        elif k["non_lu"] and (k["effets"] or k["statiques"] or k["activables"] or k.get("ephemere")):
            res["partiel"].append(n)
        elif k["non_lu"]:
            res["corps" if k["creature"] else "sans_effet"].append(n)
        else:
            res["auto"].append(n)
    return res
