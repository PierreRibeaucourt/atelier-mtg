# Atelier MTG

Une interface locale pour gérer ses decks Magic: The Gathering au format Commander. On y consulte et modifie les listes, on suit les prix, on vérifie le bracket, on simule des parties et on en discute avec Claude.

Tout tourne sur ton PC, à l'adresse http://127.0.0.1:5000. Rien n'est mis en ligne.

## Ce qu'on peut faire

- **Decks.** Créer un deck, vide ou à partir d'une liste Archidekt, Moxfield ou MTG Arena. Le supprimer : il va dans une corbeille d'où on peut le récupérer. Le retrouver parmi des dizaines grâce à la recherche (nom, commandant ou carte contenue), au filtre de couleurs et au raccourci Ctrl+K.
- **Liste.** Afficher le deck en texte ou en images étalées, comme sur Magic-Ville. Ranger les cartes par type ou par tags, les trier, les filtrer. Un clic sur une carte ouvre sa fiche : texte en français, prix, tags, actions. On y choisit aussi la version de la carte (son visuel), parmi les impressions anglaises et françaises. On ajoute une carte en la cherchant en français ou en anglais.
- **Règles du Commander.** Vérifier l'identité de couleur, l'unicité des cartes et les cartes interdites.
- **Statistiques.** Consulter la courbe de mana, les couleurs, les types, les tags comparés à un gabarit de deck et la base de mana. Tirer une main de départ.
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

Magic: The Gathering est une marque de Wizards of the Coast. Ce projet n'est ni affilié à Wizards of the Coast ni approuvé par elle.
