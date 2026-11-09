# Repères pour construire un deck Commander

Repères tirés de quelques articles de référence (sources en bas de page), réécrits pour l'assistant de l'Atelier.
Ce sont des points de départ, pas des règles : un deck peut s'en écarter pour de bonnes raisons, et les préférences du
joueur passent avant.

## Les 100 cartes

- **Commandant** : 1, ou 2 avec Partenaire (98 cartes + 2 commandants, identité de couleur = celle des deux réunis).
- **Plan de jeu** (synergies, moteur, conditions de victoire) : une trentaine de cartes.
- **Ramp** : une dizaine, en plus des terrains : le ramp ne remplace pas un terrain.
- **Pioche** (avantage de cartes) : une dizaine, de préférence répétable.
- **Removal** ciblé : 5 à 10, contresorts compris.
- **Balayages** : environ 5. Plus en contrôle ou avec peu de créatures, moins dans un deck qui remplit la table.
- **Terrains** : 36 à 42. 37-38 par défaut, 34-36 en aggro, 40-42 en contrôle ou avec beaucoup de cartes chères.
- **Le reste** : tuteurs, protection, conditions de victoire supplémentaires.

L'onglet Statistiques compare les fonctions des cartes du deck à ces repères (`python outils/atelier/demander.py stats <deck>`).

## Le commandant

- 2 ou 3 couleurs sont le plus confortable. Avec 4 ou 5, la base de mana devient fragile ; en monocolore, elle est stable mais les options sont moins nombreuses.
- Un coût de 2 à 5 manas. Au-delà, il arrive tard et attire tous les removal.
- Le deck doit pouvoir gagner sans lui : il sera tué, exilé, ou deviendra trop cher à relancer.

## Plan de jeu et conditions de victoire

- On doit pouvoir résumer le plan en une phrase. Le commandant le donne souvent.
- Plusieurs façons de gagner, cohérentes avec le plan : un seul contresort ou un seul removal ne doit pas tout arrêter.
- Du mana infini ou une pioche infinie ne gagnent pas seuls : il faut une carte pour finir.
- Le commandant peut être une condition de victoire, jamais la seule.

## Synergies

Une bonne carte de synergie :
- produit avec les autres plus que la somme de leurs effets ;
- reste utile seule dans le plan du deck ;
- est jouable : coût raisonnable, pas trop fragile.

À éviter : deux cartes qui ne servent qu'entre elles. Deux cartes peuvent aussi se compléter à travers une troisième.
Équilibrer ce qui déclenche et ce qui en profite : dans un deck de sacrifice, il faut des moyens de sacrifier ET des
créatures à sacrifier.

## Ramp

Du plus solide au plus fragile :
1. les sorts qui vont chercher des terrains (surtout en vert ; les terrains sont rarement détruits) ;
2. les artefacts de mana, idéalement à 2 manas (sensibles aux destructions d'artefacts et aux renvois en main) ;
3. les créatures de mana (elles meurent aux balayages, mais peuvent bloquer).

## Pioche

- De la pioche répétable avant tout : une carte qui pioche une seule fois ne suffit pas.
- Elle doit suivre le plan : une pioche liée aux créatures ne vaut rien dans un deck qui en joue peu.
- En rouge, l'« impulsion » (exiler le dessus de la bibliothèque pour le jouer) compte comme de la pioche.
- Défausser pour piocher fait creuser, mais ne donne pas de carte en plus, sauf si le deck profite de la défausse.

## Removal et balayages

- Removal : polyvalent (plusieurs types de permanents), à 3 ou 4 manas au plus.
- Balayages : choisir ceux qui épargnent son propre plan (contre les petites créatures, contre les grosses, contre tout).
  Ceux qui ne touchent que les adversaires coûtent plus cher, mais rapportent plus.

## Terrains et base de mana

- Un terrain qui arrive engagé doit rapporter quelque chose : une troisième couleur, un regard sur la bibliothèque,
  un effet. Gagner 1 point de vie ne suffit pas.
- La Tour de commandement (Command Tower) va dans tout deck multicolore. Un terrain qui ne produit pas de mana ne compte
  pas dans le total des terrains.
- Petit budget : checklands, painlands, temples (un regard, très bons en Commander), terrains qui demandent de révéler un
  terrain, tri-lands en 4 ou 5 couleurs, Verger exotique (Exotic Orchard), Étendues sauvages en évolution (Evolving Wilds).
- Plus chers : fetchlands, shocklands, dual lands, bondlands (excellents en multijoueur), fastlands (surtout en duel).
- Bouncelands : à éviter, sauf avec des effets de « landfall ». Ils aident à avoir 3 manas au tour 3 ou 4 au tour 4,
  mais une main dont les seuls terrains sont des bouncelands ne produit aucun mana (zombie33).
- Ce que coûte un terrain engagé, mesuré par zombie33 en mana disponible sur les premiers tours : parmi les terrains
  bicolores, les fastlands donnent le plus de mana aux tours 1 à 3 et les checklands aux tours 4 et 5 ; les battlelands
  font mieux que les terrains qui demandent de révéler un terrain.
- Répartition : la part des sources d'une couleur suit à peu près la part de cette couleur dans les coûts, avec plus de
  sources dégagées pour les couleurs des premiers tours.
- Seul le manque compte : avoir trop de sources d'une couleur secondaire n'est pas un défaut. L'Atelier mesure le confort
  de chaque couleur, à la manière de Frank Karsten : la chance d'avoir assez de sources au tour où on lance chaque sort,
  avec un objectif de 90 %. Il compte les artefacts et les créatures de mana comme des sources.

## Optimiser par le calcul : main de départ, mulligan, courbe (d'après zombie33)

Les calculs de zombie33 portent sur des decks de 40 et 60 cartes en duel, et supposent que seuls les terrains
produisent du mana, qu'on pioche une carte par tour et qu'on ne va chercher aucune carte. Un deck Commander, avec son
ramp, ses tuteurs et sa pioche, sort de ce cadre : ses chiffres ne se transposent pas (nombre de terrains pour 40 ou
60 cartes, vitesse des formats). Ses principes, si.

- **Bien choisir ce qu'on optimise.** Un objectif mal posé donne une réponse absurde : pour être sûr d'avoir deux
  terrains au tour 2, il faudrait 54 terrains sur 60 (le piège du « roi Midas »). Trois objectifs sont possibles :
  - maximiser les débuts parfaits (les decks tout ou rien) ;
  - optimiser la moyenne : son choix, et le bon quand on joue beaucoup de parties avec le même deck ;
  - limiter les parties ratées, selon le risque qu'on accepte.
- **Trois horizons.** La main de départ s'optimise facilement, les premiers tours demandent des hypothèses sur le deck,
  la partie entière ne se calcule presque pas : c'est le rôle des simulations.
- **Un deck, c'est aussi sa façon de faire mulligan.** On optimise ensemble les cartes et les règles pour garder ou
  refaire sa main. La bonne décision n'est pas forcément la même selon qu'on commence ou non, et la règle de mulligan
  en vigueur peut changer le nombre de terrains idéal.
- **Les quatre raisons de refaire sa main** : pas assez de mana, trop de mana, pas les bonnes couleurs, ou une main
  qui n'aura rien à faire dans les premiers tours. Le nombre et le type des terrains passent en premier.
- **Avoir 2 à 4 terrains dans sa main de 7** est un des objectifs qu'il étudie ; c'est celui que mesure l'Atelier
  (onglet Statistiques). En multijoueur, chacun pioche dès son premier tour.
- **Le tour fondamental.** C'est le tour où le deck gagne en théorie : où l'aggro tue, où la combo est réunie, où le
  contrôle prend un avantage décisif. C'est sur les tours qui y mènent que la courbe de mana compte.
- **N'optimiser que les premiers tours pousse à jouer trop de terrains**, parce qu'on oublie les tours suivants, où
  l'on en pioche trop.
- **Le coût moyen dépend aussi de la stratégie.** À nombre de terrains égal, les decks aggro et contrôle n'ont pas le
  même coût moyen (mesuré sur plus de 1 300 decks du haut des tournois Standard, de 2010 à 2020). Ses conventions pour
  le calculer : un mana phyrexian compte 0, un sort qui peut se lancer gratuitement compte 0, X vaut 1. L'Atelier, lui,
  prend la valeur de mana imprimée.
- **Tester seul a du sens pour un deck qui interagit peu** : moins il dépend de l'adversaire, plus une partie jouée
  seul (en « goldfish », avec la table de jeu de l'Atelier) mesure bien sa vitesse.
- **Les cartes qui creusent** forment deux familles : celles qui regardent le dessus de la bibliothèque et en gardent
  une partie (Opt, Preordain, Foresee…), et celles qui révèlent plusieurs cartes pour en prendre une partie (Impulse,
  Commune with Nature, Grisly Salvage, Dig Through Time…). Brainstorm est faible sans moyen de mélanger la
  bibliothèque ensuite.

## Brackets

Règles officielles de Wizards (bêta de février 2025), à vérifier si une annonce plus récente les a changées :
- **1 Exhibition** : deck à thème, très décontracté. Aucun Game Changer, aucune combo infinie à 2 cartes, aucun tour
  supplémentaire, aucune destruction massive de terrains, très peu de tuteurs.
- **2 Core** : niveau d'un précon actuel, parties de 9 tours ou plus. Mêmes interdits ; les tours supplémentaires sont
  rares et jamais enchaînés, les tuteurs rares.
- **3 Upgraded** : au-dessus d'un précon, chaque carte choisie. 3 Game Changers au plus ; pas de combo infinie à 2 cartes
  dans les premiers tours (avant le 6e environ) ; pas de destruction massive de terrains ; tours supplémentaires rares et
  jamais enchaînés.
- **4 Optimized** : tout est permis, sans être un deck de tournoi.
- **5 cEDH** : compétitif, construit pour le méta des tournois.

Destruction massive de terrains : détruire, exiler, renvoyer en main, garder engagés ou changer le mana d'au moins
4 terrains par joueur (par exemple Armageddon, Blood Moon, Winter Orb). C'est l'intention qui compte : un deck très fort
sans Game Changer se joue dans un bracket plus haut. À une même table, un bracket d'écart passe, deux non.

La liste des Game Changers change régulièrement : l'Atelier la relit chaque jour
(`python outils/atelier/demander.py bracket <deck> --gc`).

## Faire un cut

- Ranger les cartes en piles par rôle : ramp, pioche, removal, et les thèmes du deck. Une carte peut aller dans deux piles.
- Pour chaque carte : « que fait-elle dans ce deck ? ».
- Retirer la plus faible de chaque pile, plutôt que de vider une seule catégorie.

## Sortir des listes toutes faites

1. Jouer un commandant populaire autrement que par son thème évident.
2. Jouer une couleur à contre-courant, mais en s'appuyant sur ses vraies forces.
3. Faire marcher un commandant peu joué dont la capacité a du potentiel.
4. Partir d'une idée, et choisir le commandant ensuite.
5. Construire autour d'une carte clé du deck (un « commandant caché »), qu'on va chercher par tuteurs, pioche ou réanimation.

## Erreurs fréquentes

- Dépendre du commandant pour gagner.
- N'avoir qu'une seule condition de victoire.
- Garder des synergies qui ne servent qu'entre elles.
- Jouer moins de 10 cartes de pioche, ou trop peu de removal.
- Ajouter des cartes fortes ailleurs, mais hors du plan du deck.
- Recopier une liste populaire avant d'avoir construit la sienne.
- Compter un terrain sans mana comme un terrain.

## Sources

- Magic-Casual, « Comment créer un deck Commander (EDH) ? » (2020) : https://magic-casual.fr/comment-creer-deck-edh/
- Magic-Casual, « Comment bien choisir ses terrains pour son deck Magic ? » (2019) : https://magic-casual.fr/comment-choisir-terrains-deck-magic/
- Magic-Casual, « 5 méthodes pour créer un deck EDH unique et original » : https://magic-casual.fr/comment-creer-un-deck-edh-original-et-unique/
- zombie33, « L'Art d'optimiser les decks », Magic-Ville, en 4 parties :
  https://www.magic-ville.com/fr/gazette/show_article?ref=594 (puis ref=596, 597 et 598)
- Wizards of the Coast, « Introducing Commander Brackets Beta » (11 février 2025) : https://magic.wizards.com/en/news/announcements/introducing-commander-brackets-beta
