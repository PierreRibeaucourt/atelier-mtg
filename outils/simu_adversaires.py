"""Archétypes adverses du simulateur Commander. Tous les chiffres sont réglables ici.

À chacun de ses tours (à partir du tour `debut`), un adversaire tire UN événement de `creatures` :
(probabilité, nombre, modèle). Les probabilités se cumulent ; au-delà de leur somme, il ne pose rien.
Commandant : posé au tour indiqué, il revient 2 tours après chaque mort. `generateur` : tant qu'il est en jeu,
il crée un jeton 1/1 par tour. `croissance` : il gagne +1/+1 par tour (équipements, auras).
Interaction, par tour et par adversaire :
- retrait       : détruit (60 %) ou exile (40 %) la meilleure créature de la table (la tienne si c'est la plus forte) ;
- retrait_perm  : détruit ton meilleur artefact / enchantement (Gift, Aube, Cuve...) ;
- rase          : rase-board (toutes les créatures), seulement s'il est en retard d'au moins 3 créatures, dès le tour 5 ;
- cimetiere     : exile ton cimetière (dès que tu y as 4 cartes de créature) ;
- contre        : contre un de tes sorts à 4 manas ou plus (une fois par tour de table) ;
- brulure       : dégâts directs infligés chaque tour à un joueur (drains, sorts, capacités) ;
- combo         : (tour minimum, probabilité par tour) de gagner la partie d'un coup ;
- aristo        : (tour, probabilité qu'il ait son moteur) : chaque mort d'une de ses créatures fait perdre 1 PV à tous les autres ;
- agressif      : attaque avec tout, même dans de mauvais blocages. Tout le monde le devient à partir de TOUR_FINAL.
"""

TOUR_FINAL = 9

MODELES = {
    # force, endurance, jeton, et probabilités de mots-clés
    "jeton11": dict(p=1, t=1, jeton=True),
    "jeton22": dict(p=2, t=2, jeton=True),
    "petite": dict(p=2, t=2),
    "moyenne": dict(p=3, t=3),
    "volante": dict(p=3, t=3, vol=1.0),
    "grosse": dict(p=5, t=5, pietine=0.4),
    "enorme": dict(p=7, t=7, pietine=0.6, hexproof=0.5),
    "dork": dict(p=1, t=1),
    "agressive": dict(p=3, t=2, celerite=0.5),
}

ARCHETYPES = {
    "Milieu": dict(debut=2, creatures=[(0.45, 1, "moyenne"), (0.15, 1, "grosse"), (0.10, 2, "petite")],
                   commandant=dict(tour=4, p=4, t=4), brulure=0.5,
                   retrait=0.18, retrait_perm=0.08, rase=0.03, cimetiere=0.04, noir=0.2),
    "Jetons": dict(debut=2, creatures=[(0.45, 2, "jeton11"), (0.20, 3, "jeton11"), (0.15, 1, "petite")],
                   commandant=dict(tour=3, p=2, t=3, generateur=True), brulure=0.5,
                   retrait=0.10, retrait_perm=0.05, rase=0.02, cimetiere=0.02, noir=0.2),
    "Gros bras": dict(debut=2, creatures=[(0.35, 1, "grosse"), (0.12, 1, "enorme"), (0.15, 1, "moyenne"), (0.10, 1, "dork")],
                      commandant=dict(tour=3, p=4, t=4, pietine=True, croissance=True, hexproof=0.5), brulure=0.0,
                      retrait=0.12, retrait_perm=0.06, rase=0.03, cimetiere=0.03, noir=0.2),
    "Contrôle": dict(debut=3, creatures=[(0.22, 1, "volante"), (0.08, 1, "grosse")],
                     commandant=dict(tour=4, p=3, t=4, vol=True), brulure=1.0,
                     retrait=0.30, retrait_perm=0.15, rase=0.07, cimetiere=0.08, contre=0.25, noir=0.3),
    "Aggro": dict(debut=1, creatures=[(0.55, 1, "agressive"), (0.20, 2, "petite")],
                  commandant=dict(tour=2, p=3, t=3, celerite=True), brulure=1.0,
                  retrait=0.12, retrait_perm=0.03, rase=0.0, cimetiere=0.02, agressif=True, noir=0.2),
    "Aristocrates": dict(debut=2, creatures=[(0.40, 2, "jeton11"), (0.25, 1, "petite"), (0.10, 1, "moyenne")],
                         commandant=dict(tour=3, p=2, t=2, generateur=True), brulure=0.5,
                         retrait=0.12, retrait_perm=0.05, rase=0.02, cimetiere=0.04, aristo=(4, 0.7), noir=0.5),
    "Combo": dict(debut=2, creatures=[(0.30, 1, "dork"), (0.15, 1, "moyenne")],
                  commandant=dict(tour=3, p=2, t=3), brulure=0.0,
                  retrait=0.12, retrait_perm=0.05, rase=0.02, cimetiere=0.03, contre=0.15, combo=(8, 0.12), noir=0.2),
}
