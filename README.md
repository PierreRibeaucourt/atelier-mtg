# Atelier MTG

Une interface locale pour gérer ses decks Magic: The Gathering au format Commander. On y consulte et modifie les listes, on suit les prix, on vérifie le bracket, on simule des parties et on en discute avec Claude.

Tout tourne sur ton PC, à l'adresse http://127.0.0.1:5000. Rien n'est mis en ligne. Gratuit et libre, sous licence MIT.

Présentation et téléchargement : https://pierreribeaucourt.github.io/atelier-mtg/

## Ce qu'on peut faire

- **Decks.** Créer un deck, vide ou à partir d'une liste Archidekt, Moxfield ou MTG Arena. En importer plusieurs d'un coup (« Importer des fichiers… », dans la fenêtre « Nouveau deck ») : un fichier par deck, exporté de ManaBox, Moxfield, Archidekt… (liste ou CSV), qui lui donne son nom ; les sections « Commander », « Deck » et « Sideboard » des exports sont reconnues, et « Decks déjà montés » note leurs cartes comme déjà là (onglet Achats). Copier sa liste (menu « … » du deck) pour Archidekt, Moxfield, MTG Arena, MTGO, en liste simple ou avec les noms français. Le renommer : son historique, ses versions, ses simulations et sa discussion le suivent, et sa page partagée garde son adresse. Le supprimer : il va dans une corbeille d'où on peut le récupérer. Le retrouver parmi des dizaines grâce à la recherche (nom, commandant ou carte contenue), au filtre de couleurs et au raccourci Ctrl+K.
- **Champ du haut (Ctrl+K).** Taper le nom d'une carte, en français ou en anglais, comme dans le champ Titre de Magic-Ville. Les cartes sont proposées, puis les decks dont le nom correspond. Choisir une carte ouvre sa fiche ; si un deck est ouvert, on peut l'y ajouter. Entrée sans choisir ouvre la recherche de cartes avec tous les résultats.
- **Liste.** Afficher le deck en texte ou en images étalées, comme sur Magic-Ville. La carte du commandant s'affiche dans l'en-tête du deck (deux partenaires en éventail). Ranger les cartes par type, par tags ou par fonction (ramp, pioche, tuteurs, removal, balayages, contresorts, recursion, protection, d'après Scryfall Tagger), les trier, les filtrer. Un clic sur une carte ouvre sa fiche : texte en français, prix, tags, actions. On y choisit aussi la version de la carte (son visuel), parmi les impressions anglaises et françaises. On ajoute une carte en la cherchant en français ou en anglais : le bouton + d'une suggestion l'ajoute directement au deck, sans ouvrir sa fiche, le bouton d'à côté au Maybeboard, et Entrée ajoute au deck la première de la liste. Le bouton « Ajouter des cartes » reste visible quand on fait défiler le deck.
- **Recherche de cartes.** Le moteur de recherche de Magic-Ville, avec ses fenêtres et ses règles : Couleurs, Types, Recherche texte en français et en anglais, Valeur de mana, Force, Endurance, Format, Rareté, Éditions. Il ajoute le prix, la fonction des cartes (removal, ramp, pioche…), la popularité et le lien avec un deck : on ajoute une carte au deck ou au Maybeboard depuis les résultats (voir plus bas).
- **Règles du Commander.** Vérifier l'identité de couleur, l'unicité des cartes et les cartes interdites. Vérifier aussi le commandant : il doit pouvoir l'être (liste suivie par Scryfall : créatures légendaires, certains planeswalkers, véhicules et vaisseaux légendaires). Deux commandants doivent aller ensemble : Partner, Partner with, Friends forever, Historique ou compagnon du Docteur.
- **Cartes spéciales.** Les cartes recto-verso se retournent dans leur fiche, et les sorts dont le verso est un terrain sont signalés dans les statistiques. Les cartes qui s'assemblent (Bruna et Gisela) indiquent leur partenaire. La carte formée (Brisela) n'apparaît pas dans la recherche.
- **Statistiques.** Consulter la courbe de mana, les couleurs, les types, les fonctions et les tags comparés à un gabarit de deck et la base de mana. Voir les jetons que créent ses cartes (d'après Scryfall), et les imprimer. Tirer une main de départ.
- **Aperçu des cartes citées.** Partout dans l'Atelier (listes, combos, versions, bracket, simulation, discussion avec Claude), survoler le nom d'une carte, en français ou en anglais, affiche son image et son prix. Les noms d'un seul mot qui sont aussi des mots courants (« Sacrifice », « Foudre ») ne sont reconnus que dans le deck ouvert ou écrits en gras.
- **Prix.** Afficher le prix Cardmarket du jour, celui de l'édition la moins chère, avec un lien vers Cardmarket. Une carte sans version choisie montre cette édition-là ; selon les Options, la moins chère qui existe dans une langue (le français…), et hors Universes Beyond quand c'est possible.
- **Suggestions.** L'onglet « Suggestions » d'un deck propose des cartes à y ajouter, présentées comme les résultats de la recherche, avec une colonne Intérêt (de 1 à 5). Elles sont calculées sur la base locale, sans autre service :
  - **Thème** : les fonctions de Scryfall Tagger fréquentes dans le deck mais rares ailleurs (le commandant compte triple) et les types de créature dominants (« Élémentaux », « Chaque joueur sacrifie »). Les cartes qui y répondent le mieux passent d'abord, puis les plus jouées (rang EDHREC republié par Scryfall) ;
  - **Combos** : les combos de Commander Spellbook à qui il ne manque qu'une carte. L'étiquette « Combo avec … » déplie l'explication de Spellbook (en anglais) : cartes, résultat, prérequis, mana, étapes ;
  - **Classeur** : les cartes qu'on a déjà et qui touchent au deck ;
  - **Tout** : les trois groupes ensemble.

  Ne sont proposées que les cartes légales, dans les couleurs du commandant, sous le budget par carte, hors terrains et hors du deck et du Maybeboard. Des filtres se cumulent avec le groupe choisi : texte, type, fonction, coût, prix maximum. « Écarter » ne la propose plus pour ce deck ; « Reproposer », en bas de la liste, la remet. Ces refus restent sur ce PC (`suggestions.json` dans le dossier du deck).
- **Achats.** L'onglet « Achats » d'un deck sépare les cartes qu'on a déjà de celles à acheter, avec le coût de ce qui manque : l'amélioration d'un deck, ou le deck entier pour un nouveau. Dans la fiche d'une carte, « Je l'ai » / « À acheter » change son état. Une carte à acheter qu'on a déjà ailleurs le dit (« J'en ai : Classeur, Kels ») : on la déplace au lieu de la racheter. « Copier pour Cardmarket » copie ce qui manque au format des listes de wants (« 1 Sol Ring », une carte par ligne). Un deck créé dans l'Atelier part de zéro ; un deck d'avant cette fonction est considéré comme déjà monté. Ces informations restent sur ce PC (`achats.json` dans le dossier du deck) et ne vont jamais sur les pages partagées ; seule la sauvegarde en ligne, privée, en garde une copie.
- **Options.** Le bouton en haut à droite règle le nom affiché sur les pages partagées, le budget par carte, le compte GitHub, la sauvegarde en ligne et le lancement de l'Atelier au démarrage de Windows. Des préférences, demandées une fois au premier lancement : ce que fait l'Atelier quand on ferme sa page (rester prêt en arrière-plan, ou s'arrêter), le visuel par défaut des cartes (l'édition la moins chère, ou la moins chère dans une langue), éviter les illustrations Universes Beyond quand une autre existe, et ne pas suggérer de cartes Universes Beyond. « Arrêter l'Atelier » l'arrête tout de suite. Il gère aussi le classeur : les cartes qu'on a en dehors des decks, à ajouter en les cherchant, en collant une liste, ou en important la collection exportée d'une autre appli (« Importer une collection… » : CSV de ManaBox, Moxfield, Archidekt, Dragon Shield…), sans les exemplaires déjà notés dans les decks. « Dans plusieurs decks » liste les cartes jouées par plusieurs decks, avec combien on en a pour combien il en faut. Partout, la fiche d'une carte dit où elle est : au classeur, et dans quels autres decks. Il se présente comme les résultats de la recherche, en liste ou en images : un clic sur un en-tête (couleur, nom, type, coût, quantité, prix) trie, un clic sur une carte ouvre sa fiche. Il reste sur ce PC (`Classeur/classeur.txt`).
- **Combos.** Deux vues. « Le deck » montre les combos déjà présentes dans le deck. Le bouton « Trouver d'autres combos » ouvre les suggestions sur les cartes qui complètent une combo du deck. « Une carte » montre les autres cartes qui combotent avec elle, avec ou sans le filtre des couleurs du commandant, leur prix et un bouton pour les mettre au Maybeboard. Les combos viennent de MTGPics, de Commander Spellbook et, à la demande, d'une analyse des synergies par Claude (voir plus bas).
- **Bracket.** Repérer les Game Changers de la liste officielle. Afficher l'estimation de bracket de Commander Spellbook.
- **Versions.** Enregistrer des versions nommées, consulter l'historique automatique, comparer deux versions.
- **Simulation.** « Tester le deck » joue 1 000 parties à 4 joueurs contre des archétypes d'adversaires (méthode de Monte-Carlo) et rend un verdict de régularité : mana (4 terrains au tour 4, couleur manquante), cartes jouées (tours à vide, mana utilisé, main pleine), ton board, le board adverse, l'arrivée du commandant ; puis « ce qui cloche ». Le simulateur lit seul le texte d'une partie des cartes et joue les autres sans effet : ces mesures-là n'en dépendent presque pas, les victoires si, c'est pourquoi le test sans IA ne les montre pas. « Affiner avec Claude » : Claude décrit les cartes mal lues et le plan de jeu dans `simulateur.json` (dans le dossier du deck), rejoue et explique ; ses tests montrent alors aussi les victoires. « Comparer deux versions » joue les deux listes sur les mêmes parties.
- **Jouer tout seul.** Le bouton « Jouer » d'un deck ouvre une table de jeu dans un nouvel onglet, comme le playtester d'Archidekt. On y trouve la main, le champ de bataille, la bibliothèque, le cimetière, l'exil et la zone de commandement. On pioche et on joue au clic ou en glissant les cartes, on les engage, on pose des marqueurs et des jetons (ceux que créent les cartes du deck, d'après Scryfall, et les donjons où elles font aventurer). On sélectionne plusieurs cartes du champ de bataille en glissant autour d'elles, ou par Ctrl+clic, pour les engager, les déplacer ou les envoyer ailleurs d'un coup. Les planeswalkers arrivent avec leur loyauté, réglée par − et + sur la carte. On peut aussi faire un mulligan, regarder ou meuler X cartes, chercher dans la bibliothèque, annuler, et suivre la partie dans un journal. Les raccourcis clavier sont ceux d'Archidekt (touche ?). Tout est manuel : rien n'applique les règles. La partie en cours est gardée dans le navigateur. La table se joue sur ordinateur, à la souris ; sur un téléphone ou une tablette, elle prévient qu'elle n'y est pas encore adaptée. Le code est à part : `jouer.py` et `static/jouer.*`.
- **Discussion avec Claude.** Une discussion par deck, avec son propre contexte, plus une discussion générale, via Claude Code. On la choisit en haut du panneau, depuis n'importe quelle page : ouvrir un deck passe à sa discussion, et elle reste affichée pendant la recherche de cartes. Claude peut lire et modifier les decks, lancer les outils Python, chercher sur Internet et lire des pages web, sauf EDHREC et Cardmarket ; une étape qui lui est refusée apparaît en rouge. « Compacter » résume la conversation pour qu'elle coûte moins de tokens. Claude voit ce que montre l'Atelier (statistiques, suggestions, combos, bracket, classeur, achats, versions, recherche) grâce à `outils/atelier/demander.py`, et s'appuie sur des repères de construction tirés d'articles de référence (`connaissances/reperes-commander.md`) : ses conseils partent des mêmes chiffres que l'interface.
- **Proxies.** « Imprimer les proxies… », dans le menu « … » d'un deck, prépare des feuilles A4 de 9 cartes à la taille réelle (63 × 88 mm), bord à bord pour couper d'un trait, comme la Machine à Proxies de Magic-Ville. En texte (nom, coût, type, texte, force et endurance, en noir et blanc, en français ou en anglais ; la police rétrécit pour les cartes très longues) ou en images (la version choisie dans le deck, verso compris pour les cartes à deux faces). Les cartes à acheter, tout le deck (avec ou sans les terrains de base) ou ses jetons. Un aperçu montre les pages ; « Imprimer » ouvre l'impression du navigateur (ou « Enregistrer au format PDF »).
- **Sauvegarde en ligne.** Une copie privée des decks et du classeur sur ton compte GitHub, pour les retrouver après une panne ou sur un autre PC (voir plus bas).
- **Téléphone.** Options › Téléphone prépare tes decks pour l'appli du téléphone, https://atelier-mtg.github.io/, à installer sur l'écran d'accueil (Android : « Installer l'application » ; iPhone : Partager › « Sur l'écran d'accueil ») et à relier au PC par un QR code. Elle montre tout ce que montre l'Atelier (liste, fiches, statistiques, suggestions, combos, bracket, versions, simulations, achats, classeur), même sans réseau ; elle reçoit les changements par la sauvegarde en ligne, qu'il faut donc activer. On y modifie aussi ses decks, ses achats et son classeur : chercher et ajouter des cartes (sur Scryfall), changer leur version, créer, renommer et supprimer un deck. Chaque modification est faite tout de suite sur le téléphone, puis envoyée à la sauvegarde, rejouée sur la dernière version des fichiers pour ne rien écraser ; le PC la reçoit et refait les suggestions, les combos et le bracket. La recherche de cartes y marche comme sur le PC, même sans réseau : l'appli télécharge une fois la base de cartes (≈ 10 Mo, `base_telephone.py`, refaite chaque semaine par le dépôt qui publie l'appli), puis seulement quand elle change, hors données mobiles. La discussion avec Claude, la simulation, « Jouer », les proxies et l'import de fichiers restent sur le PC.
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
- **la sauvegarde en ligne et le partage des decks** demandent un compte GitHub, gratuit (voir « Sauvegarde en ligne » et « Partager un deck »).

Les réglages propres à ton installation sont dans `reglages.json`, à la racine, hors du dépôt. Toutes les clés sont facultatives :
- `budget` : le prix maximum par carte, en euros ; les cartes plus chères sont signalées. 5 par défaut, 0 pour aucune alerte ;
- `github` : le compte GitHub où publier les decks partagés ;
- `nom` : le nom affiché sur les pages partagées (« Decks de … »), le compte GitHub par défaut.

## Lancement

Double-clique sur le raccourci « Atelier MTG » du bureau (ou du menu Démarrer, avec l'installeur Windows), sur `Atelier MTG.bat` (Windows) ou lance `./atelier.sh` (macOS, Linux). La page s'ouvre dans le navigateur. Sous Windows, l'Atelier se range dans la barre d'état, près de l'horloge (le chaudron ; avec Windows 11, peut-être derrière la flèche ^) : un clic rouvre la page, clic droit › Quitter l'arrête. Options › « Arrêter l'Atelier » aussi ; Options › Page fermée › « Arrêter l'Atelier » l'arrête tout seul une demi-minute après la fermeture de sa dernière page, une fois fini ce qui tourne (réponse de Claude, simulation…). Sur macOS et Linux, laisse la fenêtre du terminal ouverte : la fermer arrête l'Atelier.

Si l'Atelier n'est pas lancé, l'adresse http://127.0.0.1:5000 affiche « L'Atelier n'est pas lancé » au lieu d'une erreur, puis la page demandée dès qu'il répond. Sous Windows, le bouton « Lancer l'Atelier » le lance (le navigateur demande d'abord d'ouvrir « Atelier MTG »). Cette page est gardée par le navigateur à la première ouverture de l'Atelier ; effacer les données du site la retire jusqu'à la suivante.

## Où sont les decks

Chaque deck est un dossier `Deck <nom>` placé à la racine (avec l'installeur Windows : `%LOCALAPPDATA%\Programs\Atelier MTG` ; Options › « Ouvrir le dossier » y mène). Il contient sa liste `archidekt.txt`, au format d'import d'Archidekt :

```
1x Greven, Predator Captain [Commander]
1x Lightning Bolt [Removal]
22x Mountain [Land]
1x Coal Stoker [Maybeboard]
```

L'Atelier range aussi dans ce dossier l'historique, les versions, les simulations, ce que le simulateur sait du deck (`simulateur.json`, écrit par Claude), la discussion, les cartes qu'on a déjà (`achats.json`) et les suggestions écartées (`suggestions.json`). Les dossiers de decks ne sont pas dans ce dépôt (voir `.gitignore`).

## Recherche de cartes

La page « Recherche de cartes » (barre du haut, ou bouton « Chercher pour ce deck », qui ouvre un formulaire vierge aux couleurs du deck) reprend le moteur de Magic-Ville :
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
- Seuls les decks que tu partages sont publiés (se connecter à GitHub pour la sauvegarde ne publie rien). Une fois partagé, un deck est tenu à jour tout seul, tant que l'Atelier est ouvert : un deck modifié (liste, versions, simulations…, dans l'Atelier, par Claude ou dans un éditeur) deux minutes après la dernière modification, et toutes les pages une fois par jour, avec les prix du jour. Ce qui a changé Atelier fermé part au lancement. Après une mise à jour de l'Atelier, toutes les pages sont refaites avec la nouvelle interface. « Mettre à jour » republie tout de suite ; « Ne plus partager » retire la page du site (elle reste dans l'historique du dépôt), jusqu'à ce que tu le repartages.
- Les pages sont publiques pour qui a le lien, et non référencées par les moteurs de recherche. Rien d'autre ne part : ni les discussions, ni le classeur (pas de groupe Classeur dans les suggestions, ni les cartes écartées).
- Le premier partage prévient que la page sera publique. Il faut un compte GitHub, gratuit : l'Atelier explique ce que c'est, puis affiche un code à coller sur la page de GitHub qui s'ouvre (on peut y créer son compte). L'Atelier crée alors ton site, `https://<compte>.github.io/`, et y publie tes decks : ni git ni réglage. La même connexion sert à la sauvegarde en ligne ; elle reste sur ce PC (Options › Sauvegarde et partage pour te déconnecter). Une page publiée est en ligne au bout d'une minute environ, quelques minutes la toute première fois.
- Avec git, si tu préfères : le dépôt `decks` de ton compte (`https://<compte>.github.io/decks/<deck>/`) ; AGENTS.md donne la mise en place. Les pages sont rangées dans le dossier `Partage Atelier` (avec git, un dépôt à part, hors de ce dépôt).

## Sauvegarde en ligne

L'Atelier tourne sur ton PC : s'il tombe en panne, ou pour retrouver tes decks sur un autre PC, il en garde une copie sur ton compte GitHub, dans un dépôt **privé**, `atelier-mtg-sauvegarde`, que toi seul vois.

- Elle se met en place en se connectant à GitHub : bandeau « Les sauvegarder en ligne » de l'accueil, ou Options › Sauvegarde et partage. L'Atelier présente d'abord GitHub (un service gratuit qui garde des fichiers en ligne) et ses deux usages, la sauvegarde et le partage. GitHub demande d'autoriser l'accès aux dépôts publics et privés : les pages partagées vont dans un dépôt public, la sauvegarde dans un dépôt privé. Une connexion faite avant la sauvegarde (dépôts publics seulement) demande un nouveau code, une fois.
- Ce qui part : chaque dossier de deck (liste, historique, versions, simulations, discussion avec Claude, achats…) et le classeur. Pas les photos, trop lourdes. Ensuite, chaque modification part toute seule une vingtaine de secondes après la dernière, et l'Atelier regarde toutes les cinq minutes si un autre PC a changé quelque chose. L'accueil affiche « Sauvegardé » ; Options donne l'heure de la dernière sauvegarde, « Sauvegarder maintenant » et le lien du dépôt. On peut la couper.
- Sur un autre PC : installe l'Atelier ; sa page d'accueil, vide, propose « Récupérer mes decks ». Après la connexion au même compte GitHub, il montre les decks de la sauvegarde et les ramène.
- Rien ne se perd : un fichier changé sur deux PC à la fois garde la version de ce PC, et la liste venue de l'autre PC entre dans l'historique du deck (« Liste d'un autre PC »). Un deck supprimé dans l'Atelier va dans la corbeille des autres PC. Un dossier de deck disparu sans passer par l'Atelier (désinstallation, Explorateur) n'est pas effacé de la sauvegarde : il revient au passage suivant.

## Outils en ligne de commande

- **Prix d'une ou plusieurs cartes** (nom français ou anglais), avec une alerte au-dessus du budget (5 € par défaut, voir `reglages.json`) :
  `python outils/prix.py "Foudre" "Sol Ring"`
- **Probabilités de pioche** (loi hypergéométrique) :
  `python outils/proba.py --deck 99 --cibles 38 --vues 7 --min 2 --max 4`
- **Simulation, ou comparaison de deux listes** sur les mêmes parties :
  `python outils/simu.py "Deck X/archidekt.txt" "Deck X/autre_liste.txt" --tables Mixte -n 2000`
  ou, l'Atelier lancé, avec les cartes décrites dans `simulateur.json` : `python outils/atelier/demander.py simuler kels`
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
