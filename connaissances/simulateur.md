# Affiner le simulateur d'un deck

Pour Claude, quand le joueur clique sur « Affiner avec Claude » dans l'onglet Simulation. Sans aide, le simulateur lit
lui-même le texte des cartes, mais beaucoup lui échappent : il les joue alors sans effet. Ton travail : lui décrire ces
cartes et le plan de jeu du deck, rejouer, puis expliquer le résultat au joueur.

## La règle d'or

N'écris **jamais** dans `outils/`. C'est le programme : il est remplacé à chaque mise à jour, et le modifier bloque les
mises à jour du joueur. Tout ce que tu apprends au simulateur sur un deck va dans **`<dossier du deck>/simulateur.json`**,
qui reste sur son PC. Ce que ce fichier ne sait pas dire, tu le dis au joueur, sans coder.

## La méthode

1. `python outils/atelier/demander.py couverture <deck>` : la liste des cartes que le simulateur lit mal, avec les lignes
   qu'il ne comprend pas.
2. Décris ces cartes dans `simulateur.json`, en commençant par celles qui comptent : moteurs du deck, ramp, pioche,
   removal, rase-boards, conditions de victoire. Une carte anecdotique peut rester sans effet.
3. Relance `couverture` : la partie « Textes de simulateur.json pas encore compris » doit être vide. Sinon, reformule ces
   lignes avec les tournures ci-dessous.
4. `python outils/atelier/demander.py simuler <deck>` : 1 000 parties contre une table variée (quelques secondes), puis le
   rapport en texte. `rapport <deck>` le relit.
5. Ajuste et relance, **trois essais au plus**. Puis explique au joueur, en mots de joueur : le verdict, ce qui cloche, et
   maintenant que le deck est compris, ses victoires. Dis aussi ce qui reste approché ou impossible à simuler.

Pour comparer deux versions du deck : `simuler <deck> --b <fichier de version>` (voir `versions <deck>`). Les deux listes
jouent exactement les mêmes parties ; un écart plus petit que sa marge (« ± ») ne prouve rien.

## Le fichier

```json
{
  "cartes": {
    "Esper Sentinel": "Whenever a creature an opponent controls dies, draw a card.",
    "Ravenous Chupacabra": "When ~ enters, destroy target creature an opponent controls.",
    "Phyrexian Arena": "At the beginning of your upkeep, draw a card. You lose 1 life."
  },
  "reglages": {"premier": ["Sol Ring", "Arcane Signet"]}
}
```

- **`cartes`** : pour chaque carte, son texte réécrit en anglais avec les tournures comprises, une capacité par ligne
  (`\n` entre deux lignes). `~` désigne la carte. Ce texte **remplace** le texte Oracle pour le simulateur : garde tout ce
  qui compte, pas seulement la ligne mal lue. La force, l'endurance, le coût et les mots-clés (vol, célérité…) restent
  ceux de la carte. Une approximation honnête vaut mieux que rien : un moteur de pioche conditionnel peut devenir
  « At the beginning of your upkeep, draw a card. » si c'est à peu près ce qu'il rapporte par tour.
- **`reglages`** (facultatif) :
  - `premier` : les cartes à lancer avant toutes les autres ;
  - `pilote` : `"vite"` (par défaut, tout lancer dès que possible) ou `"salve"` (garder ses créatures pour un gros
    tour : seulement pour un deck qui en a le moteur), avec `salve_nb`, `salve_pv`, `salve_main` et `garder` ;
  - `greven_main`, `greven_pv` : propres au commandant Greven.

## Les tournures comprises

Une ligne commence par un déclencheur, suivi d'effets séparés par des points. Sans déclencheur, sur un éphémère ou un
rituel, l'effet se produit quand on lance le sort.

**Déclencheurs**
- `When ~ enters, …` · `When ~ enters or attacks, …` · `When ~ dies, …` · `When ~ leaves the battlefield, …`
- `Whenever ~ attacks, …` · `Whenever ~ deals combat damage to a player, …`
- `Whenever a creature you control dies, …` · `Whenever another creature you control dies, …`
- `Whenever a creature dies, …` · `Whenever a creature an opponent controls dies, …`
- `Whenever another creature you control enters, …` · `Whenever another Elf you control enters, …` (un type) ·
  `Whenever a creature enters, …`
- `At the beginning of your upkeep, …` · `At the beginning of each upkeep, …` · `At the beginning of your end step, …`
- `Whenever you sacrifice a creature, …` · `Whenever equipped creature dies, …`
- Capacité activée : `{2}{B}, {T}: …` · `{T}, Sacrifice a creature: …` · `Sacrifice ~: …` · `Discard a card: …` ·
  `Pay 2 life: …`

**Effets**
- Retirer : `destroy target creature` (aussi `nonblack creature`, `nonland permanent`, `artifact`, `enchantment`,
  `… an opponent controls`) · `exile target creature` · `each opponent sacrifices a creature` · `each player sacrifices a creature`
- Dégâts : `~ deals 3 damage to any target` (aussi `target creature`, `each opponent`, `each creature`, `X`) ·
  `~ deals damage equal to its power to any target`
- Rase-boards : `destroy all creatures` · `destroy all creatures you don't control` · `all creatures get -2/-2` ·
  `creatures your opponents control get -1/-1`
- Pioche et recherche : `draw two cards` · `draw a card` · `search your library for a creature card, put it into your hand` ·
  `search your library for a basic land card, put it onto the battlefield tapped`
- Mana : `add {G}{G}` · `add two mana` (en capacité activée avec `{T}`, la carte devient une source de mana)
- Créatures : `create two 1/1 white Soldier creature tokens with flying` · `return target creature card from your graveyard
  to the battlefield` · `return target creature card from your graveyard to your hand`
- Vie : `each opponent loses 2 life and you gain 2 life` · `target opponent loses 3 life` · `you gain 3 life` · `you lose 2 life`
- Combat : `target creature gets +3/+3 and gains haste` · `target creature gains double strike` ·
  `creatures you control gain haste until end of turn` · `up to two target creatures can't block`
- `counter target spell`

**Effets permanents** (une ligne seule)
- `Creatures you control get +1/+1` · `Other Elf creatures you control get +1/+1` · `Creatures you control have haste`
- `Equipped creature gets +2/+0` · `Equipped creature has flying`
- `Spells you cast cost {1} less to cast` · `Red spells you cast cost {1} less to cast`
- `Attacking creatures you control have double strike` · `… it deals double that damage` · `~ can't block`

## Ce que le simulateur ne sait pas jouer

Copies, tours supplémentaires, victoires alternatives, marqueurs +1/+1 qui s'accumulent, défausse et wheels, recyclage
du cimetière au-delà de la réanimation, doubleurs de mana, effets qui dépendent des choix des adversaires. Approche-les
quand une approximation a du sens ; sinon, dis au joueur que le test ne les compte pas.
