# Atelier MTG

Une interface locale pour gérer ses decks Magic: The Gathering au format Commander. On y consulte et modifie les listes, on suit les prix, on vérifie le bracket, on simule des parties et on en discute avec Claude.

Tout tourne sur ton PC, à l'adresse http://127.0.0.1:5000. Rien n'est mis en ligne.

## Ce qu'on peut faire

- **Decks.** Créer un deck, vide ou à partir d'une liste Archidekt, Moxfield ou MTG Arena. Copier sa liste (menu « … » du deck) pour Archidekt, Moxfield, MTG Arena, MTGO, en liste simple ou avec les noms français. Le supprimer : il va dans une corbeille d'où on peut le récupérer. Le retrouver parmi des dizaines grâce à la recherche (nom, commandant ou carte contenue), au filtre de couleurs et au raccourci Ctrl+K.
- **Champ du haut (Ctrl+K).** Taper le nom d'une carte, en français ou en anglais, comme dans le champ Titre de Magic-Ville. Les cartes sont proposées, puis les decks dont le nom correspond. Choisir une carte ouvre sa fiche ; si un deck est ouvert, on peut l'y ajouter. Entrée sans choisir ouvre la recherche de cartes avec tous les résultats.
- **Liste.** Afficher le deck en texte ou en images étalées, comme sur Magic-Ville. La carte du commandant s'affiche dans l'en-tête du deck (deux partenaires en éventail). Ranger les cartes par type, par tags ou par fonction (ramp, pioche, tuteurs, removal, balayages, contresorts, recursion, protection, d'après Scryfall Tagger), les trier, les filtrer. Un clic sur une carte ouvre sa fiche : texte en français, prix, tags, actions. On y choisit aussi la version de la carte (son visuel), parmi les impressions anglaises et françaises. On ajoute une carte en la cherchant en français ou en anglais : le bouton + d'une suggestion l'ajoute directement, sans ouvrir sa fiche. Le bouton « Ajouter des cartes » reste visible quand on fait défiler le deck.
- **Recherche de cartes.** Le moteur de recherche de Magic-Ville, avec ses fenêtres et ses règles : Couleurs, Types, Recherche texte en français et en anglais, Valeur de mana, Force, Endurance, Format, Rareté, Éditions. Il ajoute le prix, la fonction des cartes (removal, ramp, pioche…), la popularité et le lien avec un deck : on ajoute une carte au deck ou au Maybeboard depuis les résultats (voir plus bas).
- **Règles du Commander.** Vérifier l'identité de couleur, l'unicité des cartes et les cartes interdites. Vérifier aussi le commandant : il doit pouvoir l'être (liste suivie par Scryfall : créatures légendaires, certains planeswalkers, véhicules et vaisseaux légendaires). Deux commandants doivent aller ensemble : Partner, Partner with, Friends forever, Historique ou compagnon du Docteur.
- **Cartes spéciales.** Les cartes recto-verso se retournent dans leur fiche, et les sorts dont le verso est un terrain sont signalés dans les statistiques. Les cartes qui s'assemblent (Bruna et Gisela) indiquent leur partenaire. La carte formée (Brisela) n'apparaît pas dans la recherche.
- **Statistiques.** Consulter la courbe de mana, les couleurs, les types, les fonctions et les tags comparés à un gabarit de deck et la base de mana. Tirer une main de départ.
- **Aperçu des cartes citées.** Partout dans l'Atelier (listes, combos, versions, bracket, simulation, discussion avec Claude), survoler le nom d'une carte, en français ou en anglais, affiche son image et son prix. Les noms d'un seul mot qui sont aussi des mots courants (« Sacrifice », « Foudre ») ne sont reconnus que dans le deck ouvert ou écrits en gras.
- **Prix.** Afficher le prix Cardmarket du jour, celui de l'édition la moins chère, avec un lien vers Cardmarket.
- **Combos.** Deux vues. « Le deck » montre les combos déjà présentes dans le deck. « Une carte » montre les autres cartes qui combotent avec elle, avec ou sans le filtre des couleurs du commandant, leur prix et un bouton pour les mettre au Maybeboard. Les combos viennent de MTGPics, de Commander Spellbook et, à la demande, d'une analyse des synergies par Claude (voir plus bas).
- **Bracket.** Repérer les Game Changers de la liste officielle. Afficher l'estimation de bracket de Commander Spellbook.
- **Versions.** Enregistrer des versions nommées, consulter l'historique automatique, comparer deux versions.
- **Simulation.** Jouer des parties à 4 joueurs contre des archétypes d'adversaires (méthode de Monte-Carlo). Comparer deux versions d'un deck, avec la marge d'erreur.
- **Jouer tout seul.** Le bouton « Jouer » d'un deck ouvre une table de jeu dans un nouvel onglet, comme le playtester d'Archidekt. On y trouve la main, le champ de bataille, la bibliothèque, le cimetière, l'exil et la zone de commandement. On pioche et on joue au clic ou en glissant les cartes, on les engage, on pose des marqueurs et des jetons (ceux que créent les cartes du deck, d'après Scryfall). On peut aussi faire un mulligan, regarder ou meuler X cartes, chercher dans la bibliothèque, annuler, et suivre la partie dans un journal. Les raccourcis clavier sont ceux d'Archidekt (touche ?). Tout est manuel : rien n'applique les règles. La partie en cours est gardée dans le navigateur. Le code est à part : `jouer.py` et `static/jouer.*`.
- **Discussion avec Claude.** Une discussion par deck, avec son propre contexte, plus une discussion générale, via Claude Code. On la choisit en haut du panneau, depuis n'importe quelle page : ouvrir un deck passe à sa discussion, et elle reste affichée pendant la recherche de cartes. Claude peut lire et modifier les decks, lancer les outils Python, chercher sur Internet et lire des pages web, sauf EDHREC et Cardmarket ; une étape qui lui est refusée apparaît en rouge. « Compacter » résume la conversation pour qu'elle coûte moins de tokens.
- **Partage.** Publier la page d'un deck sur GitHub Pages et envoyer le lien (voir plus bas).

## Installation

Le plus simple : demande à ton assistant IA (Claude Code, Codex, Cursor, Copilot…) « Installe l'Atelier MTG depuis https://github.com/PierreRibeaucourt/atelier-mtg ». Il suit [AGENTS.md](AGENTS.md). Il te pose trois questions (ton budget par carte, si tu veux partager tes decks, si tu veux discuter avec Claude) et fait le reste.

À la main, il faut Python 3.10 ou plus récent, et git :

```
git clone https://github.com/PierreRibeaucourt/atelier-mtg.git "Atelier MTG"
cd "Atelier MTG"
python installer.py --budget 5
```

L'installeur crée l'environnement Python (`.venv`), écrit tes réglages, vérifie que l'Atelier démarre et pose un raccourci « Atelier MTG » sur le bureau. On le relance après une mise à jour (`git pull`). Testé sous Windows ; macOS et Linux devraient marcher.

En option :
- **la discussion avec Claude** demande Claude Code (l'extension de VS Code, de Cursor ou de Windsurf, ou le programme `claude`) et un abonnement Claude. Chaque message compte dans ta limite d'utilisation ;
- **le partage des decks** demande git et un compte GitHub (voir « Partager un deck »).

Les réglages propres à ton installation sont dans `reglages.json`, à la racine, hors du dépôt. Toutes les clés sont facultatives :
- `budget` : le prix maximum par carte, en euros ; les cartes plus chères sont signalées. 5 par défaut, 0 pour aucune alerte ;
- `github` : le compte GitHub où publier les decks partagés.

## Lancement

Double-clique sur le raccourci « Atelier MTG » du bureau, sur `Atelier MTG.bat` (Windows) ou lance `./atelier.sh` (macOS, Linux). La page s'ouvre dans le navigateur. Sous Windows, l'Atelier se range dans la barre d'état, près de l'horloge (le chaudron ; avec Windows 11, peut-être derrière la flèche ^) : un clic rouvre la page, clic droit › Quitter l'arrête. Sur macOS et Linux, laisse la fenêtre du terminal ouverte : la fermer arrête l'Atelier.

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

La base se tient à jour toute seule. Au lancement, puis toutes les 6 heures tant que l'Atelier est ouvert, il demande à Scryfall la liste des éditions. Il refait la base dès qu'une édition récente ou à venir a plus de cartes que dans la base : nouvelle extension, spoilers. Il attend pour cela que le fichier complet de Scryfall les contienne, car Scryfall le refait une fois par jour. Il la refait aussi chaque semaine, pour les prix. Le bouton « Mettre à jour », en bas des résultats, force une mise à jour.

## Combos

Les combos viennent de trois sources :
- [MTGPics](https://www.mtgpics.com), la version internationale de Magic-Ville, avec la même base de combos. L'Atelier l'interroge poliment (une requête toutes les 1,5 seconde) et garde les résultats 30 jours. Il ne retient que les vraies combos : Win, Lock, Infinite, Threat, Synergy et clones.
- [Commander Spellbook](https://commanderspellbook.com), la base ouverte des combos de Commander.
- Claude, à la demande, pour les synergies du deck.

## Partager un deck

« Partager le deck… », dans le menu « … » d'un deck, publie une copie de sa page sur GitHub Pages et donne son lien : `https://<compte>.github.io/decks/<deck>/`. La personne qui l'ouvre voit le deck comme dans l'Atelier, sans rien installer : liste et visuel, aperçu des cartes au survol, fiches, statistiques, combos du deck, versions, bracket, rapports de simulation et copie de la liste pour Archidekt, Moxfield, etc. Elle ne peut rien modifier. La recherche de cartes et la discussion ne sont pas sur la page. La racine du site liste les decks partagés.

- Chaque page a son titre, sa description et une image d'aperçu de 1200 × 630 (balises Open Graph) : envoyé sur une messagerie ou un réseau social, le lien s'affiche avec la carte du commandant, les couleurs, le nombre de cartes, le prix et le bracket. La racine montre les commandants de tous les decks partagés.
- Les données sont figées au moment du partage, prix compris. Quand on modifie un deck partagé (liste, versions, simulations…), dans l'Atelier, par Claude ou dans un éditeur, l'Atelier republie sa page tout seul, deux minutes après la dernière modification ; s'il était fermé, il le fait au lancement. « Mettre à jour » republie tout de suite ; « Ne plus partager » retire la page du site (elle reste dans l'historique du dépôt).
- Les pages sont publiques pour qui a le lien, et non référencées par les moteurs de recherche. Rien d'autre ne part : ni les discussions, ni les autres decks.
- Une fois, avant le premier partage : indiquer son compte GitHub dans `reglages.json` (`python installer.py --github <compte>`), puis créer sur ce compte un dépôt public `decks`, avec un README, et activer GitHub Pages : Settings › Pages › Deploy from a branch › `main`, dossier `/ (root)`. AGENTS.md donne les commandes. Une page publiée est en ligne au bout d'une minute environ.
- Les pages sont rangées dans le dossier `Partage Atelier` (un dépôt git à part, hors de ce dépôt), et envoyées avec l'identité git de l'Atelier.

## Outils en ligne de commande

- **Prix d'une ou plusieurs cartes** (nom français ou anglais), avec une alerte au-dessus du budget (5 € par défaut, voir `reglages.json`) :
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
