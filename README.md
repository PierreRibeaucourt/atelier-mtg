# Atelier MTG

Une interface locale pour gérer ses decks Magic: The Gathering au format Commander. On y consulte et modifie les listes, on suit les prix, on vérifie le bracket, on simule des parties et on en discute avec Claude.

Tout tourne sur ton PC, à l'adresse http://127.0.0.1:5000. Rien n'est mis en ligne.

## Ce qu'on peut faire

- **Decks.** Créer un deck, vide ou à partir d'une liste Archidekt, Moxfield ou MTG Arena. Copier sa liste (menu « … » du deck) pour Archidekt, Moxfield, MTG Arena, MTGO, en liste simple ou avec les noms français. Le supprimer : il va dans une corbeille d'où on peut le récupérer. Le retrouver parmi des dizaines grâce à la recherche (nom, commandant ou carte contenue), au filtre de couleurs et au raccourci Ctrl+K.
- **Champ du haut (Ctrl+K).** Taper le nom d'une carte, en français ou en anglais, comme dans le champ Titre de Magic-Ville. Les cartes sont proposées, puis les decks dont le nom correspond. Choisir une carte ouvre sa fiche ; si un deck est ouvert, on peut l'y ajouter. Entrée sans choisir ouvre la recherche de cartes avec tous les résultats.
- **Liste.** Afficher le deck en texte ou en images étalées, comme sur Magic-Ville. La carte du commandant s'affiche dans l'en-tête du deck (deux partenaires en éventail). Ranger les cartes par type ou par tags, les trier, les filtrer. Un clic sur une carte ouvre sa fiche : texte en français, prix, tags, actions. On y choisit aussi la version de la carte (son visuel), parmi les impressions anglaises et françaises. On ajoute une carte en la cherchant en français ou en anglais : le bouton + d'une suggestion l'ajoute directement, sans ouvrir sa fiche. Le bouton « Ajouter des cartes » reste visible quand on fait défiler le deck.
- **Recherche de cartes.** Le moteur de recherche de Magic-Ville, avec ses fenêtres et ses règles : Couleurs, Types, Recherche texte en français et en anglais, Valeur de mana, Force, Endurance, Format, Rareté, Éditions. Il ajoute le prix, la fonction des cartes (removal, ramp, pioche…), la popularité et le lien avec un deck : on ajoute une carte au deck ou au Maybeboard depuis les résultats (voir plus bas).
- **Règles du Commander.** Vérifier l'identité de couleur, l'unicité des cartes et les cartes interdites. Vérifier aussi le commandant : il doit pouvoir l'être (liste suivie par Scryfall : créatures légendaires, certains planeswalkers, véhicules et vaisseaux légendaires). Deux commandants doivent aller ensemble : Partner, Partner with, Friends forever, Historique ou compagnon du Docteur.
- **Cartes spéciales.** Les cartes recto-verso se retournent dans leur fiche, et les sorts dont le verso est un terrain sont signalés dans les statistiques. Les cartes qui s'assemblent (Bruna et Gisela) indiquent leur partenaire. La carte formée (Brisela) n'apparaît pas dans la recherche.
- **Statistiques.** Consulter la courbe de mana, les couleurs, les types, les tags comparés à un gabarit de deck et la base de mana. Tirer une main de départ.
- **Aperçu des cartes citées.** Partout dans l'Atelier (listes, combos, versions, bracket, simulation, discussion avec Claude), survoler le nom d'une carte, en français ou en anglais, affiche son image et son prix. Les noms d'un seul mot qui sont aussi des mots courants (« Sacrifice », « Foudre ») ne sont reconnus que dans le deck ouvert ou écrits en gras.
- **Prix.** Afficher le prix Cardmarket du jour, celui de l'édition la moins chère, avec un lien vers Cardmarket.
- **Combos.** Deux vues. « Le deck » montre les combos déjà présentes dans le deck. « Une carte » montre les autres cartes qui combotent avec elle, avec ou sans le filtre des couleurs du commandant, leur prix et un bouton pour les mettre au Maybeboard. Les combos viennent de MTGPics, de Commander Spellbook et, à la demande, d'une analyse des synergies par Claude (voir plus bas).
- **Bracket.** Repérer les Game Changers de la liste officielle. Afficher l'estimation de bracket de Commander Spellbook.
- **Versions.** Enregistrer des versions nommées, consulter l'historique automatique, comparer deux versions.
- **Simulation.** Jouer des parties à 4 joueurs contre des archétypes d'adversaires (méthode de Monte-Carlo). Comparer deux versions d'un deck, avec la marge d'erreur.
- **Discussion avec Claude.** Une discussion par deck, avec son propre contexte, via Claude Code.

## Installation

Il faut Windows et Python 3.10 ou plus récent.

```
pip install -r requirements.txt
```

La discussion demande en plus l'extension Claude Code de VS Code (ou le programme `claude`) et un abonnement Claude. Chaque message compte dans ta limite d'utilisation.

## Lancement

Double-clique sur `Atelier MTG.bat`, ou lance `python outils/atelier/app.py`. La page s'ouvre dans le navigateur. Laisse la fenêtre noire ouverte : la fermer arrête l'Atelier.

## Où sont les decks

Chaque deck est un dossier `Deck <nom>` placé à la racine. Il contient sa liste `archidekt.txt`, au format d'import d'Archidekt :

```
1x Greven, Predator Captain [Commander]
1x Lightning Bolt [Removal]
22x Mountain [Land]
1x Coal Stoker [Maybeboard]
```

L'Atelier range aussi dans ce dossier l'historique, les versions, les simulations, les réglages de jeu (`pilote.json`) et la discussion. Les dossiers de decks ne sont pas dans ce dépôt (voir `.gitignore`).

## Recherche de cartes

La page « Recherche de cartes » (barre du haut, ou bouton « Chercher des cartes » d'un deck) reprend le moteur de Magic-Ville :
- **Couleurs** : au moins une ou toutes, uniquement celles choisies, identité de couleur. Le bouton « Couleurs de … » coche les couleurs du commandant du deck lié. La fenêtre prend aussi le coût, à la place de la fenêtre Manas de Magic-Ville : un coût exact (`2BR`, `U?` plus un mana générique quelconque, `1**` deux manas colorés quelconques) et « Un seul symbole par couleur ».
- **Recherche texte** : en français, en anglais ou les deux. Tous les mots doivent y être ; `"…"` cherche une expression exacte, `!mot` exclut un mot.
- **Valeur de mana, Force, Endurance, Format, Rareté, Éditions** (avec « Nouvelles cartes uniquement »), **Cartes spéciales** et **Types spéciaux**.

En plus de Magic-Ville :
- le prix (le moins cher, toutes éditions) ;
- les Game Changers, et les cartes qui peuvent être commandant ou partenaire ;
- le tri par popularité (EDHREC) ou par nouveauté ;
- l'ajout direct au deck lié ;
- une fenêtre **Fonctions** avec les étiquettes de [Scryfall Tagger](https://tagger.scryfall.com), un classement fait à la main par la communauté de Scryfall. Les plus utiles sont traduites et se cochent d'un clic (ramp, pioche, tuteur, removal…). Les 4 600 autres se cherchent par leur nom anglais (pinger, blood artist ability…), avec leur nombre de cartes. Quand on en choisit plusieurs, la carte doit les avoir toutes.

La recherche est instantanée : elle se fait sur une base locale (`outils/atelier/base_cartes.json.gz`, hors du dépôt), construite à partir des fichiers complets de Scryfall :
- les cartes et leurs impressions (environ 80 Mo à télécharger) ;
- les fonctions ;
- les noms et textes français. La première fois, il faut environ 15 minutes pour lire les 59 000 impressions françaises. Ensuite, seules les nouvelles sont lues : une mise à jour prend moins d'une minute.

La base se tient à jour toute seule. Au lancement, puis toutes les 6 heures tant que l'Atelier est ouvert, il demande à Scryfall la liste des éditions. Il refait la base dès qu'une édition récente ou à venir a plus de cartes que dans la base : nouvelle extension, spoilers. Il attend pour cela que le fichier complet de Scryfall les contienne, car Scryfall le refait une fois par jour. Il la refait aussi chaque semaine, pour les prix. Le bouton « Mettre à jour maintenant », en bas des résultats, force une mise à jour.

## Combos

Les combos viennent de trois sources :
- [MTGPics](https://www.mtgpics.com), la version internationale de Magic-Ville, avec la même base de combos. L'Atelier l'interroge poliment (une requête toutes les 1,5 seconde) et garde les résultats 30 jours. Il ne retient que les vraies combos : Win, Lock, Infinite, Threat, Synergy et clones.
- [Commander Spellbook](https://commanderspellbook.com), la base ouverte des combos de Commander.
- Claude, à la demande, pour les synergies du deck.

## Outils en ligne de commande

- **Prix d'une ou plusieurs cartes** (nom français ou anglais), avec une alerte au-dessus de 5 € :
  `python outils/prix.py "Foudre" "Sol Ring"`
- **Probabilités de pioche** (loi hypergéométrique) :
  `python outils/proba.py --deck 99 --cibles 38 --vues 7 --min 2 --max 4`
- **Simulation, ou comparaison de deux listes** sur les mêmes parties :
  `python outils/simu.py "Deck X/archidekt.txt" "Deck X/autre_liste.txt" --tables Mixte -n 2000`

## Sources

- Données des cartes, images et prix : [Scryfall](https://scryfall.com), qui republie chaque jour les prix Cardmarket.
- Combos et estimation de bracket : [Commander Spellbook](https://commanderspellbook.com) et [MTGPics](https://www.mtgpics.com).
- Fonctions des cartes : [Scryfall Tagger](https://tagger.scryfall.com). Noms français des extensions : moteur de recherche de [Magic-Ville](https://www.magic-ville.com).

Magic: The Gathering est une marque de Wizards of the Coast. Ce projet n'est ni affilié à Wizards of the Coast ni approuvé par elle.
