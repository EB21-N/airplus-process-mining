# Air+

Tableau de bord de process mining pour la ligne d'assemblage de l'avion Air+. Il croise les extraits MES, PLM et ERP, le modèle 3D et la notice de montage pour répondre à quatre questions : où part le temps, de quoi dépend l'approvisionnement, à quel endroit de l'avion se situent les écarts, et qui travaille sur quel poste.

L'application tourne sur votre machine. Le serveur écoute uniquement sur `127.0.0.1`, rien n'est envoyé sur Internet, et l'IA facultative passe par un Ollama local.

## Sommaire

1. [Ce que montrent les données](#ce-que-montrent-les-données)
2. [Lancer Air+](#lancer-air)
3. [Utiliser l'interface](#utiliser-linterface)
4. [Page Temps](#page-temps)
5. [Page Pièces](#page-pièces)
6. [Page Avion](#page-avion)
7. [Page Équipe](#page-équipe)
8. [Page Question](#page-question)
9. [Page Sources](#page-sources)
10. [Fiches de détail](#fiches-de-détail)
11. [Données sources et rapprochements](#données-sources-et-rapprochements)
12. [Règles de calcul](#règles-de-calcul)
13. [Confidentialité](#confidentialité)
14. [Le ZIP d'analyse](#le-zip-danalyse)
15. [Notebook et ligne de commande](#notebook-et-ligne-de-commande)
16. [Organisation du projet](#organisation-du-projet)
17. [Tests et vérifications](#tests-et-vérifications)
18. [Limites](#limites)

## Ce que montrent les données

Chiffres de l'analyse préchargée, calculés sur les trois fichiers fournis.

| Sujet | Résultat |
|---|---|
| Relevé | 56 opérations sur 56 postes, du 01/09/2023 08:00 au 04/09/2023 09:13 |
| Temps | 21 h 50 prévues, 30 h 47 réalisées, soit +8 h 57 (+41 %) |
| Plus gros écart | Poste 31, assemblage du train d'atterrissage gauche : +37 min 45, 7 % de l'écart total |
| Zones les plus en écart | Aile gauche +1 h 37, aile droite +1 h 35, queue +1 h 32 |
| Aléas déclarés | Famille Machine en tête : 17 aléas, +3 h 22 |
| Pointage | 3 fins pointées à 17:00 (P15, P31, P50) laissent 2 h 33 déclarées hors pointage |
| Main-d'œuvre | 3 297,68 € sur le réalisé, 2 342,64 € sur le prévu |
| Valeur des pièces | 21 099 590 €, dont 89,4 % chez 3 fournisseurs sur 16 |
| Concentration | 2 références (D142, D088) portent 81,5 % de la valeur |
| Pièces critiques | 7 références, 91,3 % de la valeur |
| Approvisionnement | Délai maxi de 45 jours, première commande le 19/07/2023 pour un démarrage le 01/09/2023 |
| Équipe | 150 personnes, dont 67 expertes, 63 confirmées et 20 débutantes |
| À renforcer | 10 affectations ont un niveau 1 sur une compétence repère du poste |
| Modèle 3D | 91 occurrences sur 99 reliées au PLM, 27 références modélisées sur 40 |

Un écart est un signal à vérifier sur le terrain. Il ne prouve ni un goulot de capacité ni une cause.

## Lancer Air+

Il faut Python 3.9 ou plus récent. Aucune installation et aucun accès Internet ne sont nécessaires : les dépendances sont livrées dans `vendor/`.

| Système | Lancement |
|---|---|
| Windows | Double-clic sur `lancer_windows.bat` |
| macOS | Double-clic sur `lancer_macos.command` (si besoin : clic droit, puis Ouvrir) |
| Linux | `sh lancer_linux.sh` |

La commande équivalente, depuis le dossier du projet :

```bash
python -m airplus serve
```

Le navigateur s'ouvre sur l'analyse préchargée. Le port par défaut est 8765 ; s'il est occupé, Air+ prend le suivant libre et affiche l'adresse dans la fenêtre. Options : `--port 9000` et `--no-browser`.

Depuis GitHub :

```bash
git clone -b version-graphique https://github.com/EB21-N/airplus-process-mining.git
```

### Activer l'IA (facultatif)

Toutes les pages fonctionnent sans IA, sauf **Question**.

1. Installez [Ollama](https://ollama.com) et lancez-le.
2. Dans **Question**, ouvrez **Réglages**, saisissez un nom de modèle, puis **Télécharger** s'il manque.
3. Cliquez sur **Tester le modèle**. Le premier chargement peut être long.

### Utiliser vos propres fichiers

Dans **Sources**, sélectionnez les trois Excel MES, PLM et ERP, puis **Analyser**. Air+ refait tous les calculs, produit un ZIP d'analyse et le charge. Si les fichiers sont les mêmes que ceux de l'analyse préchargée, un message le confirme.

## Utiliser l'interface

Le bandeau donne accès à **Temps**, **Pièces**, **Avion**, **Équipe** et **Question**, ainsi qu'à **Rechercher** et **Sources**.

Les pages d'analyse suivent la même lecture :

- une **bande de valeurs** en haut donne les chiffres clés ;
- le **graphique** à gauche se réorganise selon le mode choisi ;
- la **table** à droite se trie en cliquant sur un en-tête et se filtre en tapant du texte ;
- survoler une ligne allume l'élément correspondant sur le graphique ;
- un clic ouvre la **fiche** de détail ;
- les **vues détaillées** sont sous le graphique.

| Raccourci | Action |
|---|---|
| `1` à `5` | Temps, Pièces, Avion, Équipe, Question |
| `Ctrl K` ou `/` | Chercher un poste, une pièce, un fournisseur ou une personne |
| `←` `→` | Fiche précédente ou suivante |
| `Échap` | Fermer la recherche, le volet ou la fiche |

## Page Temps

**Question traitée : où le temps réalisé s'écarte-t-il du prévu ?**

### Informations

| Valeur | Résultat | Signification |
|---|---|---|
| Opérations | 56 | Du 01/09 08:00 au 04/09 09:13 |
| Prévu | 21 h 50 | Somme de Temps Prévu |
| Réalisé | 30 h 47 | Somme de Temps Réel |
| Écart | +8 h 57 | +41 % sur le prévu |
| Pointage | 28 h 13 | Somme de Heure Fin − Heure Début |
| Plus gros écart | P31 | +37 min 45 |
| Main-d'œuvre | 3 297,68 € | Base au choix : réalisé, prévu ou pointage |

Toutes ces valeurs se recalculent lorsqu'un groupe est filtré.

La table liste chaque opération : poste, intitulé, prévu, réalisé, écart et aléa déclaré. Le symbole `○` signale une fin pointée à 17:00.

### Analyses

**Turbine des 56 opérations.** Chaque pale est un poste : le noir représente le prévu et le rouge le dépassement. Le centre affiche l'écart du groupe ou du poste survolé. Quatre modes réorganisent les mêmes pales :

| Mode | Regroupement |
|---|---|
| Déroulé | Par jour, dans l'ordre des opérations |
| Zones | Par zone, de la plus en écart à la moins en écart |
| Aléas | Par famille 6M |
| Écarts | Tous les postes, du plus grand écart au plus petit |

**Déroulé jour par jour.** Diagramme de Gantt de 8 h à 17 h. La couleur suit le ratio réalisé / prévu. Le relevé compte 15 opérations le vendredi 01/09, 16 le samedi 02/09, 19 le dimanche 03/09 et 6 le lundi 04/09.

**Écart par zone.**

| Zone | Postes | Écart | Ratio réalisé / prévu |
|---|---|---:|---:|
| Aile gauche | 10 | +1 h 37 min 30 | 1,44 |
| Aile droite | 10 | +1 h 35 min 50 | 1,44 |
| Queue | 9 | +1 h 32 min 30 | 1,40 |
| Train gauche | 5 | +1 h 10 min 00 | 1,42 |
| Train avant et liaisons | 5 | +41 min 45 | 1,33 |
| Fuselage central | 4 | +40 min 40 | 1,35 |
| Train droit | 4 | +32 min 15 | 1,43 |
| Finition ailes | 3 | +22 min 45 | 1,46 |
| Réacteurs | 1 | +22 min 30 | 1,38 |
| Cockpit | 1 | +12 min 15 | 1,41 |
| Marquage | 4 | +9 min 30 | 1,48 |

**Écart par famille d'aléa.** Les 56 aléas sont classés en 6M par mots-clés. La répartition figure dans [la vue Ishikawa](#vue-ishikawa).

**Main-d'œuvre par zone.** Durée × somme des taux de l'équipe du poste, sur la base choisie dans la bande. Le total vaut 3 297,68 € sur le réalisé, 2 342,64 € sur le prévu et 3 014,78 € sur le pointage. Il change si une personne est déplacée dans **Équipe**, et l'interface rappelle alors la valeur issue de l'ERP.

**Contrôle du pointage.** Sur 53 postes, le pointage est égal au temps déclaré. Sur les 3 autres, la fin est pointée à 17:00 alors que le temps déclaré est plus long :

| Poste | Pointage | Déclaré | Hors pointage |
|---|---:|---:|---:|
| P15 | 16 min 50 | 35 min 10 | 18 min 20 |
| P31 | 11 min 10 | 2 h 07 min 45 | 1 h 56 min 35 |
| P50 | 9 min 40 | 28 min 30 | 18 min 50 |

Les trois mesures sont conservées. Le réalisé utilise le temps déclaré.

### Interactions

- Cliquer sur un jour, une zone ou une famille filtre la page.
- Cliquer sur une barre d'écart applique le même filtre et remonte vers la turbine.
- Cliquer sur une pale, une ligne ou un bloc du déroulé ouvre la fiche du poste.

## Page Pièces

**Question traitée : combien valent les pièces, qui les fournit, et quand faut-il les commander ?**

### Informations

| Valeur | Résultat | Signification |
|---|---|---|
| Valeur totale | 21 099 590 € | 40 références, 308 pièces en nomenclature |
| Pièces / outillage | 21 099 040 € | Outillage : 550 € |
| Top 3 fournisseurs | 89 % | Sur 16 fournisseurs |
| Classe A | 81,5 % | D142 et D088 |
| Critiques | 7 | 91 % de la valeur |
| Délai maxi | 45 j | Pondéré par la valeur 35 j, simple 18 j |
| Masse | 13,4 t | Quantité × masse unitaire |
| 1re commande | 19/07 | D142, démarrage le 01/09 |

Quatre tables sont disponibles :

| Table | Colonnes |
|---|---|
| Références | Référence, désignation, fournisseur, quantité, valeur, délai, criticité |
| Fournisseurs | Nombre de références, valeur, part, délai, masse, nombre de critiques, criticité maximale |
| Commandes | Dates de commande avec le délai maxi et le délai mini, date de besoin, poste, criticité |
| Postes | Délai le plus long, pièce et fournisseur concernés, références, fournisseurs, critiques, valeur |

### Analyses

**Disques de valeur.** Un disque par référence, dont la surface suit la valeur et la couleur la criticité. Quatre modes replacent les mêmes pièces :

| Mode | Lecture |
|---|---|
| Valeur | Poids de chaque référence |
| Délai | Délai maxi en abscisse, une ligne par niveau de criticité |
| Commandes | Rétro-planning de chaque référence, du lancement au besoin. `◇` marque la commande avec le délai mini |
| Flux | Diagramme fournisseurs → zones, en pièces ou en valeur (47 liaisons, 304 pièces) |

**Concentration fournisseurs.**

| Fournisseur | Références | Valeur | Part | Délai |
|---|---:|---:|---:|---:|
| Safran Engines | 1 | 10 000 000 € | 47,39 % | 30-45 j |
| Stelia Aerospace | 5 | 7 222 900 € | 34,23 % | 20-25 j |
| Messier-Bugatti-Dowty | 2 | 1 650 000 € | 7,82 % | 25-35 j |
| Latecoere | 5 | 1 427 400 € | 6,77 % | 15-20 j |
| 12 autres | 27 | 799 290 € | 3,79 % | 5-35 j |

Le PLM indique un seul fournisseur par référence.

**Analyse ABC.** Les références sont classées par valeur décroissante. La classe A va jusqu'à 80 % du cumul, la classe B jusqu'à 95 %.

| Classe | Références | Valeur | Part |
|---|---:|---:|---:|
| A | 2 | 17 200 000 € | 81,5 % |
| B | 4 | 3 050 000 € | 14,5 % |
| C | 34 | 849 590 € | 4,0 % |

**Criticité × délai.** Nombre de références et valeur par case.

| | ≤ 10 j | 11-20 j | 21-35 j | > 35 j |
|---|---:|---:|---:|---:|
| Critique | | 2 / 170 000 € | 4 / 9 100 000 € | 1 / 10 000 000 € |
| Haute | | 5 / 1 605 000 € | 1 / 14 000 € | |
| Moyenne | 6 / 7 830 € | 9 / 172 600 € | 4 / 22 900 € | |
| Basse | 8 / 7 260 € | | | |

**Rétro-planning.** Date de premier usage au MES moins le délai du PLM, calculé pour les 36 références citées au MES. Les premières commandes sont :

| Référence | Fournisseur | Avec le délai maxi | Avec le délai mini | Besoin | Poste |
|---|---|---:|---:|---:|---:|
| D142 | Safran Engines | 19/07 | 03/08 | 02/09 | 27 |
| A623 | Messier-Bugatti-Dowty | 28/07 | 07/08 | 01/09 | 1 |
| D234 | Thales Avionics | 28/07 | 07/08 | 01/09 | 2 |
| A423 | Messier-Bugatti-Dowty | 29/07 | 08/08 | 02/09 | 31 |
| A437 | Safran Nacelles | 03/08 | 08/08 | 02/09 | 27 |

**Écarts nomenclature / MES.** Neuf références ont un nombre d'occurrences au MES différent de la quantité en nomenclature :

| Référence | Nomenclature | MES | Écart |
|---|---:|---:|---:|
| A337 | 73 | 69 | −4 |
| A511 | 29 | 25 | −4 |
| A806 | 13 | 12 | −1 |
| D122 | 2 | 1 | −1 |
| D145 | 1 | 2 | +1 |
| D278 | 1 | 2 | +1 |
| C995 | 1 | 4 | +3 |
| A012 | 2 | 6 | +4 |
| A247 | 2 | 6 | +4 |

### Interactions

- Choisir un fournisseur met ses pièces en avant et filtre les autres tables. Le filtre se retire depuis le bouton `×`.
- Le mode **Commandes** ouvre automatiquement la table Commandes.
- Cliquer sur un disque ou une ligne ouvre la fiche de la référence.

## Page Avion

**Question traitée : à quel endroit physique se situent les écarts, et comment sont-ils classés ?**

La page comporte quatre vues, chacune avec sa propre bande de valeurs.

### Vue Avion

Le modèle 3D est coloré selon un signal au choix : écart de temps, main-d'œuvre, famille d'aléa dominante ou famille précise, sur toutes les zones ou sur une seule.

| Valeur | Résultat |
|---|---|
| Occurrences 3D | 99 |
| Reliées au PLM | 91, dont 43 directes et 38 symétriques |
| Références modélisées | 27 sur 40 (la visserie n'est pas modélisée) |
| Sans référence | 8 (joints de train) |
| Liens à confirmer | 2, déduits par symétrie |
| Version CAO | A, statut IN_WORK dans le 3DXML |

Le signal d'une pièce est la somme des écarts, ou de la main-d'œuvre, des opérations qui citent sa référence. La table associée donne, pour chaque référence modélisée, la désignation, le fournisseur, le nombre d'occurrences 3D, le signal et la criticité.

Survoler une ligne allume la pièce. Cliquer sur une pièce ouvre sa fiche. Glisser fait tourner le modèle et la molette règle le zoom.

### Vue Atelier

Plan schématique en 3D des 56 postes, rangés par zone. La hauteur d'un bloc suit le temps réalisé, sa couleur suit l'écart, et une ligne relie les postes dans l'ordre chronologique. La disposition n'est pas le plan réel de l'atelier, qui ne figure pas dans les sources.

La bande indique le nombre de postes (56), de zones (11), le plus gros écart (P31), la zone la plus en écart (Aile gauche) et l'effectif (150). La table donne le poste, l'opération, la zone, le réalisé, l'écart et l'effectif.

### Vue Ishikawa

Diagramme 6M de l'écart total (+8 h 57). Chaque aléa déclaré est classé par mot-clé.

| Famille | Aléas | Écart cumulé | Exemples de mots-clés |
|---|---:|---:|---|
| Machine | 17 | +3 h 22 min 30 | outillage, usure, logiciel, surchauffe |
| Milieu | 13 | +2 h 00 min 55 | température, ventilation, vibrations |
| Méthode | 13 | +1 h 48 min 15 | synchronisation, traçabilité, protocoles |
| Mesure | 8 | +57 min 20 | contrôle qualité, calibration |
| Matière | 4 | +31 min 15 | lubrification, déformation, adhérence |
| Main-d'œuvre | 1 | +17 min 15 | manutention |

Ce diagramme classe des signaux : il ne démontre pas une cause. La table sépare l'aléa déclaré, le mot-clé retenu et la cause possible, qui reste une hypothèse. Cliquer sur une famille la développe et filtre la table. Cliquer sur un aléa ouvre le poste.

### Vue Catalogue

Toutes les références PLM dans une seule table de 14 colonnes : référence, désignation, fournisseur, quantités en nomenclature, à la notice, au MES et en 3D, prix, valeur, masse, délai, temps CAO, version et criticité.

| Valeur | Résultat |
|---|---|
| Références | 40, soit 308 pièces |
| Fournisseurs | 16 |
| Valeur | 21 099 590 € |
| Citées au MES | 36 sur 40 |
| Dans la notice | 38 sur 40 (même référence exacte) |
| Modélisées en 3D | 27 sur 40 |

## Page Équipe

**Question traitée : qui est affecté à quel poste, et avec quelles compétences déclarées ?**

### Informations

| Valeur | Résultat |
|---|---|
| Effectif | 150 personnes sur 56 postes (3 par poste de P1 à P38, 2 de P39 à P56) |
| Experts | 67 (45 %) |
| Confirmés | 63 (42 %) |
| Débutants | 20 (13 %) |
| À renforcer | 10 |
| Déplacées | 0 au départ, suit les changements faits dans la session |

Deux tables sont disponibles :

- **Personnes** : pseudonyme, qualification, expérience, poste, niveau sur le poste, compétences ;
- **Postes** : opération, effectif, profils, compétences repère, temps MES.

### Analyses

**Mur des empreintes.** Une empreinte par personne, avec une branche par compétence déclarée parmi les six de l'ERP. La longueur suit le niveau, de 1 à 3, et le niveau 3 est en rouge. Le mur se lit par poste ou par expérience. Un clic sur une compétence la met en évidence et filtre la table.

**Adéquation au poste.** Les compétences repère sont déduites de l'intitulé du poste : « assemblage » renvoie à Assemblage, « montage », « visserie » ou « fixation » à Montage mécanique, « faisceaux », « électrique » ou « lumières » à Montage électrique. Cette déduction reste à confirmer en atelier.

| Résultat | Règle |
|---|---|
| Fort | Toutes les compétences repère au niveau 3 |
| Moyen | Compétences renseignées, minimum au niveau 2 |
| À renforcer | Au moins une compétence repère au niveau 1 |
| Aucune mention | Compétence absente de l'ERP, ou aucun repère dans l'intitulé |

Une compétence absente est inconnue, et n'est jamais comptée comme faible. Un niveau déclaré ne prouve ni une productivité ni une qualité.

**Compétences déclarées** (438 déclarations).

| Compétence | Niveau 1 | Niveau 2 | Niveau 3 | Total |
|---|---:|---:|---:|---:|
| Assemblage | 10 | 42 | 27 | 79 |
| Lecture plan | 12 | 36 | 28 | 76 |
| Soudure | 3 | 36 | 34 | 73 |
| Montage mécanique | 7 | 38 | 26 | 71 |
| Contrôle qualité | 12 | 31 | 27 | 70 |
| Montage électrique | 9 | 23 | 37 | 69 |

**Habilitations.** Hydraulique 62, Électrique 56, Pneumatique 54, Mécanique 44, Pneumatique Certifié 1.

**Qualifications.** Répartition des 15 intitulés de qualification de l'ERP.

### Déplacer une personne

Dans la fiche d'une personne, la liste **Poste** permet de simuler une autre affectation. Le niveau sur le poste, la page Équipe et le coût de main-d'œuvre sont alors recalculés. Par exemple, passer une personne du poste 31 au poste 27 donne 3 269,40 € au lieu de 3 297,68 €.

Ces changements restent dans l'onglet du navigateur et ne modifient ni l'ERP ni le ZIP d'analyse. Cliquer sur la case **Déplacées** rétablit les affectations de l'ERP.

### Afficher les noms

Les personnes apparaissent sous la forme Prénom.I. Après un import local des Excel, le code `1234` affiche les noms à l'écran. Voir [Confidentialité](#confidentialité).

## Page Question

**Question traitée : que disent les données sur un point précis, avec quelles preuves ?**

Écrivez une question sur un poste, une pièce, un fournisseur ou une compétence, ou choisissez une des quatre suggestions. Les fiches proposent aussi un bouton **Question** déjà rempli.

### Chaîne à trois rôles

| Étape | Rôle |
|---|---|
| Recherche | Transforme la question en requêtes, puis un index BM25 retrouve les extraits utiles |
| Analyse | Rédige constats et actions à partir de ces extraits seulement, avec citations |
| Vérification | Décide, affirmation par affirmation, si les extraits la soutiennent |

### Contrôles indépendants du modèle

Le serveur écarte une affirmation dans les cas suivants :

- elle n'a aucune citation, ou sa citation n'existe pas ;
- elle cite une source qui n'a pas été transmise au modèle ;
- elle contient un chiffre absent des sources citées ;
- elle annonce un gain chiffré ;
- elle propose un tutorat sans citer de compétence déclarée.

### Réponse

| Bloc | Contenu |
|---|---|
| Constats | Chaque constat, avec des citations cliquables vers l'extrait et sa ligne source |
| Actions à vérifier | Action, élément concerné, fait qui la motive et mesure à suivre |
| Validation responsable | Mention ajoutée aux actions qui demandent une décision humaine |
| Données à collecter | Ce qui manque pour répondre |
| Affirmations écartées | Le texte retiré et le motif du refus |
| Journal | Le détail de la chaîne et le périmètre utilisé |

Si aucune affirmation ne passe les contrôles, la page l'indique plutôt que de produire une réponse non sourcée.

### Réglages et données transmises

Le panneau **Ollama** montre l'état du service et permet de choisir le modèle, l'adresse et le délai par étape, puis de tester ou de télécharger un modèle. Seule une adresse locale est acceptée.

Le modèle reçoit les opérations, les pièces, les fournisseurs, les indicateurs, les contrôles, la notice et les profils pseudonymisés. Il ne reçoit jamais de nom complet, de matricule, d'âge, de taux individuel ni de commentaire de carrière.

## Page Sources

**Question traitée : d'où viennent les chiffres, et peut-on s'y fier ?**

### Informations

| Valeur | Résultat |
|---|---|
| Analyse | Préchargée, import local ou ZIP, avec son empreinte |
| MES | 56 lignes, `MES_Extraction_FR.xlsx` |
| PLM | 40 lignes, `PLM_DataSet_FR.xlsx` |
| ERP | 150 lignes, `ERP_Equipes Airplus_FR.xlsx` |
| Contrôles | 49 points, 17 types |

### Actions

- Télécharger le ZIP d'analyse, ou en ouvrir un autre.
- Revenir à l'analyse préchargée.
- Importer les trois Excel.
- Ouvrir la présentation du projet (`web/presentation.html`).

### Analyses

**Rapprochements.** Couverture des liens entre sources, détaillée dans [la section suivante](#données-sources-et-rapprochements).

**Points de contrôle.** Chaque point donne son type, l'élément concerné, un message et sa ligne source. Il peut se filtrer par type.

| Type | Nombre | Type | Nombre |
|---|---:|---|---:|
| Écart MES / nomenclature | 9 | Fins pointées à 17:00 | 3 |
| Intitulé partagé | 9 | Lien 3D à vérifier | 2 |
| Ligne parasite du PLM | 7 | Référence vide | 1 |
| Référence absente du MES | 4 | Dates de week-end | 1 |
| Référence hors lien | 3 | Enchaînement sans attente | 1 |
| Désignation partagée | 3 | Conversions de types | 1 |
| Orthographe | 1 | Pseudonymes partagés | 1 |
| Qualification | 1 | Rotation sur le poste d'origine | 1 |
| Total de la notice | 1 | | |

**Quantités par référence.** Comparaison du PLM, de la notice, du MES et du modèle 3D pour chaque référence, avec l'écart et la source.

**Journal.** Les 112 événements de début et de fin d'opération, filtrables, avec leur ligne source. Les fins à 17:00 y sont signalées.

## Fiches de détail

Un clic sur un élément ouvre sa fiche sans quitter la page. Les flèches passent à la fiche voisine.

| Fiche | Contenu |
|---|---|
| Poste | Date, horaires, prévu, réalisé, écart, main-d'œuvre, comparaison avec le pointage, aléa déclaré, famille, cause possible, ratio, équipe et niveau de chacun, pièces, délai le plus long, liens vers l'atelier et la page Question |
| Référence | Classe ABC, prix, valeur, délai, masse, fournisseur, dates de commande, quantités selon chaque source, temps et version CAO, postes, lien vers l'avion |
| Fournisseur | Part de la valeur, délais, valeur, références, critiques, masse, postes, zones livrées, liste des références |
| Personne | Empreinte, qualification, expérience, identifiant interne, poste modifiable, compétences, points forts, postes forts et à renforcer, habilitations, rotations, parcours |
| Pièce 3D | Fiche de la référence reliée, ou chemin de l'assemblage si la pièce n'a pas de référence PLM |

Aucune fiche ne montre de taux horaire individuel ou d'heures par personne. Les codes comme `MES!L32` renvoient au fichier, à l'onglet et à la ligne d'origine.

## Données sources et rapprochements

| Source | Contenu | Clé |
|---|---|---|
| MES | Une ligne par opération : poste, pièces, références, temps prévu, date, horaires, temps réel, aléa, cause potentielle | Poste |
| PLM | Une ligne par référence : désignation, quantité, fournisseur, délai, criticité, masse, prix, temps CAO | Référence |
| ERP | Une ligne par personne : qualification, poste, compétences, habilitations, taux, expérience, rotations, commentaire | Matricule |
| Notice Meccano | Nomenclature et étapes de montage | Référence |
| STEP et 3DXML | Géométrie, assemblage, version et maturité | Nom de pièce |

| Rapprochement | Couverture |
|---|---:|
| MES → PLM, occurrences de référence | 304 / 304 |
| PLM → MES, références | 36 / 40 |
| PLM → Notice, références | 38 / 40 |
| MES → ERP, opérations | 56 / 56 |
| ERP → MES, personnes | 150 / 150 |
| Rotations ERP → MES, postes | 300 / 300 |
| Maillage → PLM, occurrences | 91 / 99 |
| PLM → Maillage, références | 27 / 40 |

Les maillages sont reliés au PLM selon 6 statuts : 43 directs (référence dans le nom), 38 par symétrie, 6 par l'assemblage parent, 2 par la désignation, 2 déduits à vérifier et 8 sans référence.

Le détail de l'audit, avec les lignes concernées, est dans [docs/AUDIT_DONNEES.md](docs/AUDIT_DONNEES.md).

## Règles de calcul

| Calcul | Règle |
|---|---|
| Réalisé | Colonne Temps Réel du MES |
| Pointage | Heure Fin − Heure Début |
| Écart | Réalisé − prévu |
| Ratio | Réalisé ÷ prévu |
| Zone | Déduite de l'intitulé de l'opération par règles de mots-clés |
| Aléa | Valeur déclarée au MES, classée en 6M par mots-clés |
| Cause possible | Colonne Cause Potentielle, conservée comme hypothèse et séparée de l'aléa |
| Main-d'œuvre | Durée × somme des taux de l'équipe du poste, équipe complète sur toute l'opération |
| Valeur d'une référence | Quantité nomenclature × coût d'achat |
| Masse | Quantité nomenclature × masse unitaire |
| Délai pondéré | Délai maxi pondéré par la valeur |
| Rétro-planning | Date du premier usage au MES − délai PLM, maxi ou mini |
| Flux | Occurrences MES par fournisseur et par zone |
| Classes ABC | A jusqu'à 80 % de la valeur cumulée, B jusqu'à 95 %, C au-delà |
| Atelier 3D | Plan schématique par zone, sans valeur de plan réel |

Air+ n'affiche que ce qui est présent dans les sources ou calculable à partir d'elles. Il ne comporte ni donnée simulée, ni gain estimé.

## Confidentialité

- Le ZIP d'analyse et l'analyse préchargée ne contiennent aucun nom complet, aucun matricule et aucune métadonnée de personne. Un contrôle bloque l'export si une identité y est détectée.
- Chaque personne a un identifiant interne `PX…` calculé par HMAC, et un pseudonyme Prénom.I. Comme 19 pseudonymes sont partagés par 44 profils, seul l'identifiant les distingue.
- Le code `1234` est un simple masque d'affichage. Il n'agit qu'après un import local : les noms restent alors en mémoire le temps de la session et n'entrent ni dans le ZIP ni dans l'IA. Il ne protège pas contre une personne ayant accès au fichier ERP.
- L'interface n'affiche ni salaire individuel, ni heures par personne, ni âge.
- Les fichiers Excel ne sont pas dans le dépôt et le STEP livré a un en-tête nettoyé.

## Le ZIP d'analyse

Le ZIP se télécharge depuis **Sources**, se partage et se rouvre. Une empreinte de contenu permet de vérifier que deux analyses sont identiques, et un ZIP altéré est refusé. Il suit les phases du challenge :

| Dossier | Contenu |
|---|---|
| `1_DISCOVER` | Opérations, journal d'événements, pièces, profils pseudonymisés, compétences, rotations, liens 3D, flux et zones |
| `2_DEFINE` | Rapprochements, postes, indicateurs, fournisseurs, Ishikawa, anomalies, comparaison des références, 12 dépassements à investiguer, supply chain |
| `3_DESIGN` | Séquence avec le temps prévu comme cible, 8 pistes à vérifier sur le terrain, sans gain chiffré |
| `4_DELIVER` | Mise en œuvre, prise en main, dictionnaire des données, suivi des indicateurs |
| `dashboard/` | Données lues par le tableau de bord et par l'IA |
| `general/` | Table générale |

Le dictionnaire se trouve dans `4_DELIVER/4.3_documentation/DICTIONNAIRE.md`.

## Notebook et ligne de commande

Le notebook `notebooks/AirPlus_Colab.ipynb` embarque le même moteur que le tableau de bord, pour une exécution dans Google Colab. Exécuté hors Colab sur les trois fichiers fournis, il a produit la même empreinte que le tableau de bord.

Pour produire un ZIP sans ouvrir l'interface :

```bash
python -m airplus analyze --mes MES.xlsx --plm PLM.xlsx --erp ERP.xlsx --out analyse.zip
```

## Organisation du projet

| Élément | Contenu |
|---|---|
| `airplus/engine/` | Moteur : lecture des Excel, rapprochements, calculs, exports, pseudonymisation |
| `airplus/rag.py`, `ollama_client.py` | Index de recherche, chaîne à trois rôles, contrôles, client Ollama |
| `airplus/server.py` | Serveur local et API |
| `web/` | Interface, three.js, maillage 3D, notice, police et présentation |
| `data/preloaded/` | Analyse des trois fichiers fournis, pseudonymisée |
| `notebooks/` | Notebook Colab |
| `ressources_3d/` | Fichiers STEP, glTF et 3DXML |
| `vendor/` | openpyxl et et_xmlfile |
| `docs/` | [Audit des données](docs/AUDIT_DONNEES.md), [parcours de démonstration](docs/PARCOURS_DEMO.md), [résultats de vérification](docs/RESULTATS_VERIFICATION.md) |
| `tools/` | Construction de la géométrie, de la référence, du notebook et du ZIP de livraison |
| `tests/` | Test de bout en bout et imitation d'Ollama |

## Tests et vérifications

```bash
python tests/run_e2e.py AirPlus_version_graphique.zip dossier_des_trois_excel
```

Le script décompresse le ZIP dans un dossier neuf, lance le serveur et rejoue 78 contrôles. L'option `--real-model nom_du_modèle` ajoute un essai avec un vrai modèle Ollama.

| Niveau | Ce qui a été exécuté |
|---|---|
| Fichiers réels | Les trois Excel fournis, à travers le moteur, l'import et le notebook exécuté hors Colab |
| API de test | `tests/mock_ollama.py` imite Ollama pour les pannes, les citations fausses et les refus |
| Vrai modèle | Ollama local, modèle `qwen3:4b` |

**Non testé :**

- le notebook dans Google Colab ;
- les lanceurs macOS et Linux ;
- le double-clic sur `lancer_windows.bat`, remplacé par la commande qu'il lance ;
- le téléchargement d'un modèle par le bouton ;
- l'import par le sélecteur de fichiers, testé par l'API que ce formulaire appelle.

Le détail est dans [docs/RESULTATS_VERIFICATION.md](docs/RESULTATS_VERIFICATION.md).

## Limites

- **Relevé unique.** Le MES couvre un seul relevé de 56 opérations, sans identifiant d'avion, de série ni de lot : aucune comparaison entre avions n'est possible.
- **Files d'attente.** Les opérations s'enchaînent sans attente dans le relevé, donc les files ne sont pas observables.
- **Calendrier.** Le relevé comprend un samedi et un dimanche, et aucun calendrier n'est fourni pour les interpréter.
- **Stocks.** Le PLM ne donne aucun stock : le rétro-planning suppose une commande dédiée à chaque besoin.
- **Échelle des prix.** Les montants du PLM sont à l'échelle d'un avion (D142 à 2 500 000 € l'unité), alors que la notice décrit une maquette. Ils sont repris tels quels.
- **Main-d'œuvre.** Le calcul compte toute l'équipe sur toute l'opération. La présence réelle de chacun n'est pas connue.
- **Rotations.** Les semaines de rotation ne sont pas datées et ne sont donc pas reliées aux dates du MES.
- **Compétences.** Les niveaux sont déclaratifs, et chaque personne en renseigne au plus 4 sur 6.
- **Modèle 3D.** Le glTF fourni référence un fichier `.bin` absent. La géométrie affichée vient donc du STEP. Les pièces de visserie ne sont pas modélisées.
- **IA.** Les contrôles automatiques ne dépendent pas du modèle, mais le jugement de fond oui : un petit modèle peut laisser passer une formulation imprécise. Relisez les sources citées.
