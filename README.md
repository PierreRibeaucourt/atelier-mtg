# Atelier MTG

Une interface locale pour gérer ses decks Magic: The Gathering au format Commander. On y consulte et modifie les listes, on suit les prix, on vérifie le bracket, on simule des parties et on en discute avec Claude.

Tout tourne sur ton PC, à l'adresse http://127.0.0.1:5000. Rien n'est mis en ligne. Gratuit et libre, sous licence MIT.

Présentation et téléchargement : https://pierreribeaucourt.github.io/atelier-mtg/

## Ce qu'on peut faire

- **Decks.** Créer un deck, vide ou à partir d'une liste Archidekt, Moxfield ou MTG Arena. Copier sa liste (menu « … » du deck) pour Archidekt, Moxfield, MTG Arena, MTGO, en liste simple ou avec les noms français. Le renommer : son historique, ses versions, ses simulations et sa discussion le suivent, et sa page partagée garde son adresse. Le supprimer : il va dans une corbeille d'où on peut le récupérer. Le retrouver parmi des dizaines grâce à la recherche (nom, commandant ou carte contenue), au filtre de couleurs et au raccourci Ctrl+K.
- **Champ du haut (Ctrl+K).** Taper le nom d'une carte, en français ou en anglais, comme dans le champ Titre de Magic-Ville. Les cartes sont proposées, puis les decks dont le nom correspond. Choisir une carte ouvre sa fiche ; si un deck est ouvert, on peut l'y ajouter. Entrée sans choisir ouvre la recherche de cartes avec tous les résultats.
- **Liste.** Afficher le deck en texte ou en images étalées, comme sur Magic-Ville. La carte du commandant s'affiche dans l'en-tête du deck (deux partenaires en éventail). Ranger les cartes par type, par tags ou par fonction (ramp, pioche, tuteurs, removal, balayages, contresorts, recursion, protection, d'après Scryfall Tagger), les trier, les filtrer. Un clic sur une carte ouvre sa fiche : texte en français, prix, tags, actions. On y choisit aussi la version de la carte (son visuel), parmi les impressions anglaises et françaises. On ajoute une carte en la cherchant en français ou en anglais : le bouton + d'une suggestion l'ajoute directement, sans ouvrir sa fiche. Le bouton « Ajouter des cartes » reste visible quand on fait défiler le deck.
- **Recherche de cartes.** Le moteur de recherche de Magic-Ville, avec ses fenêtres et ses règles : Couleurs, Types, Recherche texte en français et en anglais, Valeur de mana, Force, Endurance, Format, Rareté, Éditions. Il ajoute le prix, la fonction des cartes (removal, ramp, pioche…), la popularité et le lien avec un deck : on ajoute une carte au deck ou au Maybeboard depuis les résultats (voir plus bas).
- **Règles du Commander.** Vérifier l'identité de couleur, l'unicité des cartes et les cartes interdites. Vérifier aussi le commandant : il doit pouvoir l'être (liste suivie par Scryfall : créatures légendaires, certains planeswalkers, véhicules et vaisseaux légendaires). Deux commandants doivent aller ensemble : Partner, Partner with, Friends forever, Historique ou compagnon du Docteur.
- **Cartes spéciales.** Les cartes recto-verso se retournent dans leur fiche, et les sorts dont le verso est un terrain sont signalés dans les statistiques. Les cartes qui s'assemblent (Bruna et Gisela) indiquent leur partenaire. La carte formée (Brisela) n'apparaît pas dans la recherche.
- **Statistiques.** Consulter la courbe de mana, les couleurs, les types, les fonctions et les tags comparés à un gabarit de deck et la base de mana. Tirer une main de départ.
- **Aperçu des cartes citées.** Partout dans l'Atelier (listes, combos, versions, bracket, simulation, discussion avec Claude), survoler le nom d'une carte, en français ou en anglais, affiche son image et son prix. Les noms d'un seul mot qui sont aussi des mots courants (« Sacrifice », « Foudre ») ne sont reconnus que dans le deck ouvert ou écrits en gras.
- **Prix.** Afficher le prix Cardmarket du jour, celui de l'édition la moins chère, avec un lien vers Cardmarket.
- **Suggestions.** L'onglet « Suggestions » d'un deck propose des cartes à y ajouter, présentées comme les résultats de la recherche, avec une colonne Intérêt (de 1 à 5). Elles sont calculées sur la base locale, sans autre service :
  - **Thème** : les fonctions de Scryfall Tagger fréquentes dans le deck mais rares ailleurs (le commandant compte triple) et les types de créature dominants (« Élémentaux », « Chaque joueur sacrifie »). Les cartes qui y répondent le mieux passent d'abord, puis les plus jouées (rang EDHREC republié par Scryfall) ;
  - **Combos** : les combos de Commander Spellbook à qui il ne manque qu'une carte. L'étiquette « Combo avec … » déplie l'explication de Spellbook (en anglais) : cartes, résultat, prérequis, mana, étapes ;
  - **Classeur** : les cartes qu'on a déjà et qui touchent au deck ;
  - **Tout** : les trois groupes ensemble.

  Ne sont proposées que les cartes légales, dans les couleurs du commandant, sous le budget par carte, hors terrains et hors du deck et du Maybeboard. Des filtres se cumulent avec le groupe choisi : texte, type, fonction, coût, prix maximum. Les cartes Universes Beyond (créées pour Marvel, Final Fantasy…, d'après Scryfall) portent le badge UB. « Écarter » ne la propose plus pour ce deck ; « Reproposer », en bas de la liste, la remet. Ces refus restent sur ce PC (`suggestions.json` dans le dossier du deck).
- **Achats.** L'onglet « Achats » d'un deck sépare les cartes qu'on a déjà de celles à acheter, avec le coût de ce qui manque : l'amélioration d'un deck, ou le deck entier pour un nouveau. Dans la fiche d'une carte, « Je l'ai » / « À acheter » change son état. « Copier pour Cardmarket » copie ce qui manque au format des listes de wants (« 1 Sol Ring », une carte par ligne). Un deck créé dans l'Atelier part de zéro ; un deck d'avant cette fonction est considéré comme déjà monté. Ces informations restent sur ce PC (`achats.json` dans le dossier du deck) et ne sont jamais partagées.
- **Options.** Le bouton en haut à droite règle le nom affiché sur les pages partagées, le budget par carte, le compte GitHub et le lancement de l'Atelier au démarrage de Windows. Il gère aussi le classeur : les cartes qu'on a en dehors des decks, à ajouter en les cherchant ou en collant une liste. Il se présente comme les résultats de la recherche, en liste ou en images : un clic sur un en-tête (couleur, nom, type, coût, quantité, prix) trie, un clic sur une carte ouvre sa fiche. Il reste sur ce PC (`Classeur/classeur.txt`).
- **Combos.** Deux vues. « Le deck » montre les combos déjà présentes dans le deck. Le bouton « Trouver d'autres combos » ouvre les suggestions sur les cartes qui complètent une combo du deck. « Une carte » montre les autres cartes qui combotent avec elle, avec ou sans le filtre des couleurs du commandant, leur prix et un bouton pour les mettre au Maybeboard. Les combos viennent de MTGPics, de Commander Spellbook et, à la demande, d'une analyse des synergies par Claude (voir plus bas).
- **Bracket.** Repérer les Game Changers de la liste officielle. Afficher l'estimation de bracket de Commander Spellbook.
- **Versions.** Enregistrer des versions nommées, consulter l'historique automatique, comparer deux versions.
- **Simulation.** Jouer des parties à 4 joueurs contre des archétypes d'adversaires (méthode de Monte-Carlo). Comparer deux versions d'un deck, avec la marge d'erreur.
- **Jouer tout seul.** Le bouton « Jouer » d'un deck ouvre une table de jeu dans un nouvel onglet, comme le playtester d'Archidekt. On y trouve la main, le champ de bataille, la bibliothèque, le cimetière, l'exil et la zone de commandement. On pioche et on joue au clic ou en glissant les cartes, on les engage, on pose des marqueurs et des jetons (ceux que créent les cartes du deck, d'après Scryfall, et les donjons où elles font aventurer). On sélectionne plusieurs cartes du champ de bataille en glissant autour d'elles, ou par Ctrl+clic, pour les engager, les déplacer ou les envoyer ailleurs d'un coup. Les planeswalkers arrivent avec leur loyauté, réglée par − et + sur la carte. On peut aussi faire un mulligan, regarder ou meuler X cartes, chercher dans la bibliothèque, annuler, et suivre la partie dans un journal. Les raccourcis clavier sont ceux d'Archidekt (touche ?). Tout est manuel : rien n'applique les règles. La partie en cours est gardée dans le navigateur. La table se joue sur ordinateur, à la souris ; sur un téléphone ou une tablette, elle prévient qu'elle n'y est pas encore adaptée. Le code est à part : `jouer.py` et `static/jouer.*`.
- **Discussion avec Claude.** Une discussion par deck, avec son propre contexte, plus une discussion générale, via Claude Code. On la choisit en haut du panneau, depuis n'importe quelle page : ouvrir un deck passe à sa discussion, et elle reste affichée pendant la recherche de cartes. Claude peut lire et modifier les decks, lancer les outils Python, chercher sur Internet et lire des pages web, sauf EDHREC et Cardmarket ; une étape qui lui est refusée apparaît en rouge. « Compacter » résume la conversation pour qu'elle coûte moins de tokens. Claude voit ce que montre l'Atelier (statistiques, suggestions, combos, bracket, classeur, achats, versions, recherche) grâce à `outils/atelier/demander.py`, et s'appuie sur des repères de construction tirés d'articles de référence (`connaissances/reperes-commander.md`) : ses conseils partent des mêmes chiffres que l'interface.
- **Partage.** Publier la page d'un deck sur GitHub Pages et envoyer le lien (voir plus bas).

## Installation

**Windows** : télécharge [l'installeur](https://github.com/PierreRibeaucourt/atelier-mtg/releases/latest/download/Atelier-MTG-Windows.exe) et lance-le. Il contient son propre Python : rien d'autre à installer. Il installe l'Atelier dans ton dossier utilisateur (`%LOCALAPPDATA%\Programs\Atelier MTG`), sans droits d'administrateur, et pose un raccourci sur le bureau et dans le menu Démarrer. Il n'est pas signé : si Windows affiche « Windows a protégé votre ordinateur », clique sur « Informations complémentaires », puis « Exécuter quand même ». Pour le désinstaller : Paramètres › Applications ; tes decks restent, sauf si tu demandes à les effacer.

**Avec un assistant IA** (Windows, macOS, Linux) : demande à ton assistant (Claude Code, Codex, Cursor, Copilot…) « Installe l'Atelier MTG depuis https://github.com/PierreRibeaucourt/atelier-mtg ». Il suit [AGENTS.md](AGENTS.md). Il te pose trois questions (ton budget par carte, si tu veux partager tes decks, si tu veux discuter avec Claude) et fait le reste.

**À la main**, il faut Python 3.10 ou plus récent, et git :

```
git clone https://github.com/PierreRibeaucourt/atelier-mtg.git "Atelier MTG"
cd "Atelier MTG"
python installer.py --budget 5
```

L'installeur crée l'environnement Python (`.venv`), écrit tes réglages, vérifie que l'Atelier démarre et pose un raccourci « Atelier MTG » sur le bureau. Testé sous Windows ; macOS et Linux devraient marcher.

**Mises à jour.** Quand une nouvelle version est publiée, un bandeau l'annonce en haut de l'Atelier, avec ses nouveautés. « Mettre à jour » l'installe et redémarre l'Atelier ; tes decks et tes réglages ne bougent pas. Pour cela, l'Atelier consulte le dépôt GitHub au lancement, puis une fois par jour (`git fetch`). Si tu as modifié des fichiers de l'Atelier, il ne les écrase pas : la mise à jour se fait alors à la main (`git pull`, puis `python installer.py`). Installé par l'installeur Windows, il consulte les publications du dépôt et télécharge le nouvel installeur, qui remplace le programme sans toucher aux decks.

En option :
- **la discussion avec Claude** demande Claude Code (l'extension de VS Code, de Cursor ou de Windsurf, ou le programme `claude`) et un abonnement Claude. Chaque message compte dans ta limite d'utilisation ;
- **le partage des decks** demande un compte GitHub, gratuit (voir « Partager un deck »).

Les réglages propres à ton installation sont dans `reglages.json`, à la racine, hors du dépôt. Toutes les clés sont facultatives :
- `budget` : le prix maximum par carte, en euros ; les cartes plus chères sont signalées. 5 par défaut, 0 pour aucune alerte ;
- `github` : le compte GitHub où publier les decks partagés ;
- `nom` : le nom affiché sur les pages partagées (« Decks de … »), le compte GitHub par défaut.

## Lancement

Double-clique sur le raccourci « Atelier MTG » du bureau (ou du menu Démarrer, avec l'installeur Windows), sur `Atelier MTG.bat` (Windows) ou lance `./atelier.sh` (macOS, Linux). La page s'ouvre dans le navigateur. Sous Windows, l'Atelier se range dans la barre d'état, près de l'horloge (le chaudron ; avec Windows 11, peut-être derrière la flèche ^) : un clic rouvre la page, clic droit › Quitter l'arrête. Sur macOS et Linux, laisse la fenêtre du terminal ouverte : la fermer arrête l'Atelier.

Si l'Atelier n'est pas lancé, l'adresse http://127.0.0.1:5000 affiche « L'Atelier n'est pas lancé » au lieu d'une erreur, puis la page demandée dès qu'il répond. Sous Windows, le bouton « Lancer l'Atelier » le lance (le navigateur demande d'abord d'ouvrir « Atelier MTG »). Cette page est gardée par le navigateur à la première ouverture de l'Atelier ; effacer les données du site la retire jusqu'à la suivante.

## Où sont les decks

Chaque deck est un dossier `Deck <nom>` placé à la racine (avec l'installeur Windows : `%LOCALAPPDATA%\Programs\Atelier MTG` ; Options › « Ouvrir le dossier » y mène). Il contient sa liste `archidekt.txt`, au format d'import d'Archidekt :

```
1x Greven, Predator Captain [Commander]
1x Lightning Bolt [Removal]
22x Mountain [Land]
1x Coal Stoker [Maybeboard]
```

L'Atelier range aussi dans ce dossier l'historique, les versions, les simulations, les réglages de jeu (`pilote.json`), la discussion, les cartes qu'on a déjà (`achats.json`) et les suggestions écartées (`suggestions.json`). Les dossiers de decks ne sont pas dans ce dépôt (voir `.gitignore`).

## Recherche de cartes

La page « Recherche de cartes » (barre du haut, ou bouton « Chercher des cartes » d'un deck) reprend le moteur de Magic-Ville :
- **Couleurs** : un clic sur une couleur la permet (« peut »), un deuxième l'impose (« doit »), un troisième la retire. La carte a au moins une des couleurs choisies, toutes celles qui « doivent », et aucune autre : pour en permettre d'autres, on les choisit aussi. « Identité de couleur » regarde l'identité plutôt que les couleurs de la carte. Le bouton « Couleurs de … » choisit les couleurs du commandant du deck lié.
- **Recherche texte** : en français, en anglais ou les deux. Tous les mots doivent y être ; `"…"` cherche une expression exacte, `!mot` exclut un mot.
- **Valeur de mana, Force, Endurance, Format, Rareté, Éditions** (avec « Nouvelles cartes uniquement »), **Cartes spéciales** et **Types spéciaux**.
- **Résultats** en liste, disposés comme ceux de Magic-Ville : nom anglais, nom français, type, coût et prix, puis le texte et la force/endurance ou la loyauté. Un clic sur un en-tête trie, un deuxième inverse l'ordre. Ou bien en images. En bas de la liste, « Par page » affiche 30, 60, 120 ou 240 cartes ; le choix vaut aussi pour le classeur et les suggestions.

En plus de Magic-Ville :
- le prix (le moins cher, toutes éditions) ;
- les Game Changers, et les cartes qui peuvent être commandant ou partenaire ;
- le tri par popularité (EDHREC) ou par nouveauté, et, quand un deck est lié, par pertinence pour ce deck (comme ses suggestions) ;
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

« Partager le deck… », dans le menu « … » d'un deck, publie une copie de sa page sur GitHub Pages et donne son lien : `https://<compte>.github.io/<deck>/`. La personne qui l'ouvre voit le deck comme dans l'Atelier, sans rien installer : liste et visuel, aperçu des cartes au survol, fiches, statistiques, suggestions (Thème et Combos, à lire seulement), combos du deck, versions, bracket, rapports de simulation et copie de la liste pour Archidekt, Moxfield, etc. Elle peut aussi tester le deck avec « Jouer » : la même table de jeu que dans l'Atelier, avec les jetons du deck, la partie gardée dans son navigateur. Elle ne peut rien modifier. La recherche de cartes et la discussion s'affichent grisées, avec un lien pour télécharger l'Atelier. Un bandeau en haut de chaque page dit à qui elle est et invite à télécharger l'Atelier ; le bandeau et le pied de page mènent à la page d'accueil de l'Atelier, qui le présente, et le pied de page donne aussi la licence et le lien vers le code source. La racine du site liste les decks partagés.

- Chaque page a son titre, sa description et une image d'aperçu de 1200 × 630 (balises Open Graph) : envoyé sur une messagerie ou un réseau social, le lien s'affiche avec la carte du commandant, les couleurs, le nombre de cartes, le prix, le bracket et ton nom (`nom` de `reglages.json`, ton compte GitHub par défaut), repris dans les pages : « Decks de … ». La racine montre les commandants de tous les decks partagés.
- Les données sont figées au moment du partage, prix compris. Quand on modifie un deck partagé (liste, versions, simulations…), dans l'Atelier, par Claude ou dans un éditeur, l'Atelier republie sa page tout seul, deux minutes après la dernière modification ; s'il était fermé, il le fait au lancement. Après une mise à jour de l'Atelier, il republie aussi toutes les pages partagées, une fois la base de cartes chargée : elles prennent la nouvelle interface et les prix du jour. « Mettre à jour » republie tout de suite ; « Ne plus partager » retire la page du site (elle reste dans l'historique du dépôt).
- Les pages sont publiques pour qui a le lien, et non référencées par les moteurs de recherche. Rien d'autre ne part : ni les discussions, ni les autres decks, ni le classeur (pas de groupe Classeur dans les suggestions, ni les cartes écartées).
- Il faut un compte GitHub, gratuit. Au premier partage, « Se connecter à GitHub » affiche un code : colle-le sur la page de GitHub qui s'ouvre (tu peux y créer ton compte) et accepte. L'Atelier crée alors ton site, `https://<compte>.github.io/`, et y publie tes decks : ni git ni réglage. La connexion se limite à tes dépôts publics ; elle reste sur ce PC (Options › GitHub pour te déconnecter). Une page publiée est en ligne au bout d'une minute environ, quelques minutes la toute première fois.
- Avec git, si tu préfères : le dépôt `decks` de ton compte (`https://<compte>.github.io/decks/<deck>/`) ; AGENTS.md donne la mise en place. Les pages sont rangées dans le dossier `Partage Atelier` (avec git, un dépôt à part, hors de ce dépôt).

## Outils en ligne de commande

- **Prix d'une ou plusieurs cartes** (nom français ou anglais), avec une alerte au-dessus du budget (5 € par défaut, voir `reglages.json`) :
  `python outils/prix.py "Foudre" "Sol Ring"`
- **Probabilités de pioche** (loi hypergéométrique) :
  `python outils/proba.py --deck 99 --cibles 38 --vues 7 --min 2 --max 4`
- **Simulation, ou comparaison de deux listes** sur les mêmes parties :
  `python outils/simu.py "Deck X/archidekt.txt" "Deck X/autre_liste.txt" --tables Mixte -n 2000`
- **Ce que montre l'Atelier, en texte** (l'Atelier doit être lancé) : statistiques, suggestions, combos, bracket, classeur… La liste des commandes : `python outils/atelier/demander.py`.
  `python outils/atelier/demander.py suggestions kels combos`

## Sources

- Données des cartes, images et prix : [Scryfall](https://scryfall.com), qui republie chaque jour les prix Cardmarket.
- Combos et estimation de bracket : [Commander Spellbook](https://commanderspellbook.com) et [MTGPics](https://www.mtgpics.com).
- Repères de construction suivis par Claude : articles de Magic-Casual, de zombie33 (Magic-Ville) et règles des brackets de Wizards of the Coast, réécrits dans `connaissances/reperes-commander.md`, avec leurs liens.
- Fonctions des cartes : [Scryfall Tagger](https://tagger.scryfall.com). Noms français des extensions : moteur de recherche de [Magic-Ville](https://www.magic-ville.com).

Magic: The Gathering est une marque de Wizards of the Coast. Ce projet n'est ni affilié à Wizards of the Coast ni approuvé par elle.

## Licence

Le code est sous licence MIT ([LICENSE](LICENSE)) : chacun peut l'utiliser gratuitement, le modifier et le redistribuer, même pour un usage commercial, en gardant la mention de l'auteur et la licence. Elle ne couvre que le code : les textes et images des cartes appartiennent à Wizards of the Coast, et les données viennent des sources ci-dessus, avec leurs propres conditions.
