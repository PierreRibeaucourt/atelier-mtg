# Atelier MTG : guide pour les assistants IA

Ce fichier s'adresse à l'assistant IA (Claude Code, Codex, Cursor, Copilot…) à qui l'on demande d'installer l'Atelier MTG, de le mettre à jour ou de le dépanner. Le README décrit l'outil pour la personne qui l'utilise.

L'Atelier est une application web locale pour les joueurs de Magic: The Gathering au format Commander : decks, prix, bracket, combos, recherche de cartes, simulation, discussion avec Claude. C'est un serveur Flask qui écoute seulement sur `127.0.0.1:5000` et ouvre la page dans le navigateur. Interface en français. Les données restent sur le PC.

## Installer

Sous Windows, l'installeur suffit à la plupart des gens : https://github.com/PierreRibeaucourt/atelier-mtg/releases/latest/download/Atelier-MTG-Windows.exe (voir « Atelier installé par l'installeur Windows »). Il ne demande ni Python ni git. Les étapes ci-dessous conviennent sous macOS et Linux, ou pour suivre le code avec git.

Parle à la personne en français, simplement, sans jargon. Fais tout toi-même ; ne lui demande que ce qui suit.

1. **Prérequis.**
   - Python 3.10 ou plus récent. Vérifie avec `python --version` (sous Windows, essaie aussi `py --version`).
   - S'il manque : sous Windows, `winget install Python.Python.3.12` ou python.org (case « Add python.exe to PATH ») ; sur macOS, `brew install python` ou python.org ; sous Linux, le paquet `python3` avec `python3-venv`.
   - git, conseillé pour récupérer le code et les mises à jour, et nécessaire pour partager des decks : `winget install Git.Git`, `brew install git` ou le paquet `git`.
2. **Récupérer le code.**
   - Commande : `git clone https://github.com/PierreRibeaucourt/atelier-mtg.git "Atelier MTG"`, dans le dossier où la personne range ses affaires (Documents par exemple). Sans git, l'archive ZIP de GitHub marche aussi, mais sans mises à jour faciles.
   - Si elle a déjà un dossier de decks (sous-dossiers `Deck <nom>`), installe le code à côté ou dans ce dossier : les decks doivent finir à la racine du dépôt.
3. **Lui poser trois questions, pas plus.**
   - Son budget maximum par carte, en euros. Les cartes plus chères sont signalées. 5 € par défaut ; 0 pour aucune alerte.
   - Veut-elle partager ses decks en ligne, avec un lien à envoyer ? Il faut alors un compte GitHub (gratuit).
   - Veut-elle discuter avec Claude depuis l'Atelier ? Il faut alors un abonnement Claude.
4. **Lancer l'installeur** depuis la racine du dépôt : `python installer.py --budget 5` (avec `py` ou `python3` selon le système). Ajoute `--github <compte>` si elle partage ses decks.
   - L'installeur crée l'environnement `.venv` et y installe les dépendances (`requirements.txt` : Flask, Pillow, pystray).
   - Il écrit `reglages.json`, vérifie que l'Atelier démarre et crée le raccourci « Atelier MTG » sur le bureau.
   - Il signale enfin ce qui manque pour les fonctions facultatives.
   - On peut le relancer sans risque. Lis sa sortie : s'il affiche « ÉCHEC », règle le problème (voir Dépannage), puis relance-le.
5. **Fonctions facultatives** qu'elle a demandées : voir plus bas.
6. **Lancer l'Atelier** une première fois :
   - Windows : le raccourci du bureau ou `Atelier MTG.bat`.
   - macOS, Linux : `./atelier.sh`.
   - Ce qu'elle voit au premier lancement :
     - La page s'ouvre sur http://127.0.0.1:5000.
     - L'Atelier télécharge la base des cartes de Scryfall en tâche de fond : environ 80 Mo, puis une quinzaine de minutes pour les noms français. Pendant ce temps, la recherche de cartes affiche son avancement ; le reste marche tout de suite.
     - Windows : l'Atelier se range dans la barre d'état, près de l'horloge (le chaudron ; avec Windows 11, peut-être derrière la flèche ^, où l'on peut l'épingler). Un clic rouvre la page, clic droit › Quitter l'arrête. Ce qu'il écrirait dans une console va dans `outils/atelier/atelier.log`.
     - macOS, Linux : une fenêtre de terminal reste ouverte ; la fermer arrête l'Atelier.
7. **Montrer comment créer un premier deck.** Bouton « Nouveau deck » sur l'accueil. On peut coller une liste exportée d'Archidekt, de Moxfield ou de MTG Arena, ou partir d'un deck vide.

Testé sous Windows. macOS et Linux devraient marcher (Python et Flask sont multiplateformes), sans avoir été essayés : signale tout problème.

## Atelier installé par l'installeur Windows

Un fichier `installation.json` à la racine le signale. L'installeur (Inno Setup, `installeur/atelier.iss`) met tout dans `%LOCALAPPDATA%\Programs\Atelier MTG`, sans droits d'administrateur : le code, un Python embarqué dans `python\` (avec Flask, Pillow et pystray), puis les decks, le classeur et les réglages que l'Atelier y crée, comme à la racine d'un dépôt. Raccourcis sur le bureau et dans le menu Démarrer ; désinstallation par Paramètres › Applications, qui demande avant d'effacer les decks.
- Pas de git, pas de `.venv`, pas de pip : ne lance pas `installer.py`. Le Python à utiliser est `python\python.exe` ; dans la discussion, `python` y mène déjà. Son fichier `python312._pth` met `outils/` et `outils/atelier/` dans les chemins de Python.
- Mises à jour : l'Atelier lit la dernière publication GitHub du dépôt (`installation.json` › `depot`) ; « Mettre à jour » télécharge son installeur et le lance sans fenêtre, puis l'Atelier redémarre. Journal : `%TEMP%\Atelier-MTG-mise-a-jour.log`. Si ça échoue, retélécharger l'installeur et le relancer suffit : il remplace le code et garde les decks.
- Le partage des decks passe par la connexion à GitHub depuis l'Atelier (voir « Partager des decks ») : pas besoin de git.

## Fonctions facultatives

### Discussion avec Claude

L'Atelier lance Claude Code (`claude -p`) dans le dossier du dépôt : pas de clé API, chaque message compte dans l'abonnement Claude de la personne.
- Il trouve Claude Code tout seul :
  - le programme de l'extension Claude Code de VS Code, Cursor ou Windsurf ;
  - sinon `claude` dans le PATH, ou dans `~/.local/bin`.
- Pour l'installer (documentation : https://code.claude.com/docs/en/setup) :
  - Windows (PowerShell) : `irm https://claude.ai/install.ps1 | iex` ;
  - macOS, Linux : `curl -fsSL https://claude.ai/install.sh | bash`.
- Puis la personne lance `claude` une fois dans un terminal pour se connecter à son compte. Relance l'installeur : il doit afficher « Claude Code trouvé ».

### Partager des decks (GitHub Pages)

« Partager le deck… » publie une copie en lecture seule de la page du deck sur GitHub Pages. Il faut un compte GitHub, gratuit.

**Le plus simple : se connecter depuis l'Atelier.** Rien à installer ni à configurer : au premier partage (ou Options › GitHub › « Se connecter »), l'Atelier affiche un code ; la personne le colle sur github.com/login/device (où elle peut créer son compte) et accepte. L'Atelier crée alors son site, le dépôt `<compte>.github.io`, que GitHub publie tout seul, et y envoie les pages par l'API de GitHub, sans git : `https://<compte>.github.io/<deck>/`. Voir `outils/atelier/github.py`. La connexion se limite aux dépôts publics (`public_repo`) ; son jeton reste sur le PC, chiffré par Windows (`outils/atelier/connexion_github.dat`), et ne passe jamais par la page. Si ce site existe déjà pour autre chose, les pages vont dans un dépôt `decks`, dont il faut activer GitHub Pages à la main (le message dit comment).

**Avec git**, pour qui le préfère : le dépôt `decks`, servi à `https://<compte>.github.io/decks/<deck>/`. Mise en place, une seule fois, de préférence avec la CLI GitHub (`gh`, `winget install GitHub.cli` ou `brew install gh`) :

1. `gh auth login`, puis `gh auth setup-git` : git peut alors envoyer vers GitHub en HTTPS.
2. Une identité git, si `git config --global user.email` ne répond rien :
   - `git config --global user.name "<pseudo>"` ;
   - `git config --global user.email "<id>+<compte>@users.noreply.github.com"` : l'adresse « noreply » de GitHub, que l'on voit dans ses réglages, pour ne pas publier son adresse e-mail.
3. `gh repo create decks --public --add-readme`
4. Activer GitHub Pages : `gh api -X POST repos/<compte>/decks/pages -f "source[branch]=main" -f "source[path]=/"`
5. `python installer.py --github <compte>`, ou bien la clé `"github"` dans `reglages.json`.

Sans `gh` : créer le dépôt public `decks` sur github.com, avec un README, puis Settings › Pages › Deploy from a branch › `main` / `(root)`.

Dans les deux cas, les pages sont préparées dans le dossier `Partage Atelier/` (avec git, un dépôt à part), ignoré par ce dépôt-ci. Connecté, l'Atelier publie par l'API même si `reglages.json` a un compte `github`. Une page publiée est en ligne au bout d'une minute environ (quelques minutes pour un site tout neuf).

## Réglages

`reglages.json`, à la racine, est propre à chaque installation et ignoré par git. Toutes ses clés sont facultatives : `{"budget": 5, "github": "MonCompte", "nom": "Mon nom"}` (`nom` : affiché sur les pages partagées, le compte GitHub par défaut). Voir `outils/reglages.py`. La page Options de l'Atelier (en haut à droite) les modifie et les applique tout de suite ; après une modification du fichier à la main, relance l'Atelier.

La page Options règle aussi le lancement au démarrage de Windows (raccourci « Atelier MTG » du dossier Démarrage, sans ouvrir d'onglet) et le classeur : `Classeur/classeur.txt`, les cartes qu'on a en dehors des decks, « 1 Nom anglais » par ligne (les lignes `#` du début sont des notes gardées). Voir `outils/atelier/classeur.py`.

## Mettre à jour

L'Atelier se met à jour tout seul (`outils/atelier/mise_a_jour.py`). Au lancement, puis toutes les 20 heures, il lit les étiquettes `vX.Y.Z` du dépôt (`git fetch --tags origin`). Si l'une est plus récente que `outils/atelier/version.py`, un bandeau propose « Mettre à jour » : `git merge --ff-only vX.Y.Z`, dépendances réinstallées si `requirements.txt` a changé, puis redémarrage. Il refuse si des fichiers suivis par git ont été modifiés, ou si Claude répond, une recherche de synergies ou une simulation tourne.

À la main : `git pull`, puis `python installer.py` (pour les nouvelles dépendances), puis relancer l'Atelier. Installé par l'installeur Windows : voir plus haut. Les decks ne bougent pas : ils sont ignorés par git.

## Publier une version (auteur du dépôt)

`python outils/publier_version.py 1.1.0 "Une ou deux phrases sur les nouveautés."` : change le numéro dans `version.py`, commite « Version 1.1.0 », pose l'étiquette annotée `v1.1.0` (son message s'affiche dans le bandeau des Ateliers installés) et envoie le commit et l'étiquette (`git push origin main v1.1.0`). Commite d'abord le reste. Un envoi sur `main` sans nouvelle étiquette ne propose rien aux Ateliers installés. `--sans-envoi` prépare sans envoyer.

L'étiquette déclenche GitHub Actions (`.github/workflows/installeur.yml`) : il fabrique l'installeur Windows et le joint à une publication GitHub du même nom, avec les nouveautés de l'étiquette, en quelques minutes. Les Ateliers installés par l'installeur ne voient la version qu'une fois cette publication faite. Pour fabriquer l'installeur sur son PC : `python installeur/construire.py` (il faut Inno Setup 6 : `winget install JRSoftware.InnoSetup`), qui le dépose dans `construction/`.

La page d'accueil de l'Atelier, https://pierreribeaucourt.github.io/atelier-mtg/, est la page « C'est quoi, l'Atelier MTG ? » faite pour les moteurs de recherche : indexable, texte pré-rendu dans le HTML, données structurées et sitemap. GitHub Actions (`.github/workflows/site.yml`) la reconstruit et la publie sur GitHub Pages à chaque envoi sur `main` qui touche `outils/atelier/`. Pour la construire sur son PC (Chrome nécessaire) : `python outils/atelier/site_atelier.py <dossier>`. Les copies de cette page sur les sites de decks (`…/a-propos/`) la désignent comme canonique.

## Où sont les données

Tout ceci est ignoré par git et ne doit jamais être commité, poussé ni effacé : pas de `git clean -x`, pas de `git reset --hard` qui toucherait à ces dossiers.
- `Deck <nom>/`, un dossier par deck, à la racine :
  - `archidekt.txt`, la liste de référence au format Archidekt (`1x Nom [Catégorie]`) ;
  - l'historique et les versions ;
  - `simulations/`, `pilote.json` (réglages du simulateur), `discussion.json`, `achats.json` (cartes possédées : le reste est à acheter) et `suggestions.json` (cartes que l'onglet Suggestions ne propose plus).
- `Corbeille Atelier/` : les decks supprimés, récupérables.
- `Partage Atelier/` : les pages partagées. `reglages.json` : les réglages. `Classeur/` : le classeur.
- Les caches, dans `outils/` et `outils/atelier/` : base des cartes, prix, combos. Ils se reconstruisent tout seuls.

Sauvegarder ses decks, c'est copier les dossiers `Deck …`.

## Dépannage

- **`python` ouvre le Microsoft Store ou n'existe pas (Windows).** Installe Python (voir plus haut), ou utilise `py installer.py`.
- **« externally-managed-environment » (macOS, Linux).** N'installe rien avec le pip du système : l'installeur passe par `.venv`. Si `venv` manque (Debian, Ubuntu) : `sudo apt install python3-venv`.
- **Rien ne s'ouvre avec le raccourci (Windows).** Lis `outils/atelier/atelier.log`, ou lance `python outils/atelier/app.py` dans un terminal pour voir l'erreur. Le chaudron absent de la barre d'état : regarde derrière la flèche ^.
- **« Ce site est inaccessible » au lieu de « L'Atelier n'est pas lancé ».** La page de remplacement (`static/sw.js` et `/eteint`) s'installe dans le navigateur à la première ouverture de l'Atelier : ouvre-le une fois. Le bouton « Lancer l'Atelier » (Windows) suit le lien `atelier-mtg://`, que l'Atelier enregistre à chaque lancement dans `HKEY_CURRENT_USER\Software\Classes\atelier-mtg` (pythonw, `app.py --sans-navigateur`, sans droits d'administrateur). Supprimer cette clé retire le lien.
- **Port 5000 déjà pris**, par exemple par le récepteur AirPlay d'un Mac. L'Atelier prend le port libre suivant et ouvre la bonne page. Pour imposer un port : variable d'environnement `ATELIER_PORT`.
- **La recherche affiche « La base de cartes se construit ».** C'est normal au premier lancement (voir plus haut) : laisse l'Atelier ouvert. En cas d'erreur réseau, le bouton « Relancer » reprend la construction ; ensuite, « Mettre à jour », en bas des résultats, force une mise à jour.
- **« Claude Code est introuvable » dans la discussion.** Voir « Discussion avec Claude », puis relance l'Atelier.
- **Le partage échoue.** Le message dit quoi faire. Connecté : reconnecter l'Atelier (Options › GitHub) si la connexion a expiré. Avec git : compte absent de `reglages.json`, dépôt `decks` inexistant, accès refusé (`gh auth login`, puis `gh auth setup-git`), identité git manquante.
- **Pour vérifier l'installation sans lancer l'interface :** `python installer.py --sans-raccourci`.

## Règles pour l'assistant

- **Voir ce que voit l'utilisateur.** `python outils/atelier/demander.py` (sans argument : l'aide) donne en texte chaque écran de l'Atelier lancé : decks, statistiques, suggestions, combos, bracket, classeur, achats, versions, simulations, recherche de cartes, et toute autre route par `api`. Pour conseiller un deck, pars de `stats` et de `suggestions`, et vérifie chaque carte avec `carte`.
- **Repères de construction.** `connaissances/reperes-commander.md` : gabarit des 100 cartes, ramp, pioche, removal, terrains, base de mana, brackets, cut. Les préférences du joueur passent avant.
- **Prix.** Ils viennent de Scryfall, qui republie chaque jour ceux de Cardmarket. N'interroge jamais Cardmarket automatiquement : il bloque les robots, et ses protections ne se contournent pas.
- **EDHREC.** N'interroge pas EDHREC automatiquement : ses conditions d'utilisation l'interdisent. La popularité vient du rang EDHREC que Scryfall inclut dans ses données.
- **Scryfall.** Respecte ses limites : 10 requêtes par seconde au plus, moins pour les recherches. Le code attend déjà entre deux requêtes.
- **Listes des decks.** Avant de modifier un `archidekt.txt`, lance `python outils/atelier/sauvegarde.py "<dossier du deck>" "<ce qui change>"` : l'ancienne liste reste dans l'historique. Remplace une carte à la même ligne, pour que les simulations restent comparables.
- **Code.** Après une modification du Python, relance l'Atelier. Pour le JavaScript et le CSS (`outils/atelier/static/`), un rechargement de la page suffit (Ctrl+F5).
- **Organisation du code** :
  - `outils/atelier/app.py`, le serveur et ses routes ;
  - `outils/atelier/static/`, l'interface, en JavaScript sans framework ;
  - `outils/atelier/*.py`, les modules (decks, prix, bracket, combos, suggestions, recherche, simulation, discussion, partage, et github pour la connexion du partage sans git) ;
  - `outils/atelier/demander.py`, l'Atelier en ligne de commande pour les assistants ;
  - `connaissances/`, les repères de construction d'un deck ;
  - `outils/simu*.py`, le simulateur ;
  - `outils/prix.py` et `outils/proba.py`, des outils en ligne de commande ;
  - `installeur/`, l'installeur Windows (script Inno Setup, dépendances figées, fabrication).
- **Contribution.** Ce dépôt est celui de son auteur. Pour contribuer, travaille dans un fork : ne pousse rien sur le dépôt d'origine.
