# Audit des sources

Audit fait sur les fichiers fournis le 04/11/2026. Provenance notée `MES!L32` = ligne Excel 32.

## MES : `MES_Extraction_FR.xlsx`, onglet `MES` (56 lignes)

- **Une ligne** : une opération sur un poste, un poste par ligne (Poste 1 à 56, sans doublon).
- **Champs** : Poste, Nom, Nombre pièces, Référence (liste séparée par `;`, répétitions comprises), Temps Prévu, Date, Heure Début, Heure Fin, Temps Réel, Aléas Industriels, Cause Potentielle.
- **Unités** : durées et heures en temps Excel, converties en secondes entières.
- **Clé** : Poste. `Nom` n'est pas unique (9 intitulés partagés, ex. « Assemblage fuselage centrale » : L7 à L10).
- **Pas d'identifiant avion**, ni de série, de lot, ni de révision.

| Constat | Exemple | Traitement |
|---|---|---|
| 3 fins tronquées à 17:00:00 | L32 : 16:48:50 → 17:00:00 soit 00:11:10, déclaré 02:07:45. Aussi L16 et L51 | Trois mesures conservées. Écart total −02:33:45. Le déclaré sert de base, les 3 lignes sortent du périmètre concordant |
| Sur les 53 autres, horodatages = déclaré | L2 : 08:00:00 → 08:32:45, déclaré 00:32:45 | Contrôle `concordant` |
| Attente nulle sur les transitions de même jour | L3 commence à la fin de L2 | Les files d'attente ne sont pas observables |
| Référence vide | L52, poste 51, Nombre pièces = 1 | `ref_manquante`, jamais comblée |
| Dates un samedi et un dimanche | 02 et 03/09/2023 | Signalé. Calendrier non fourni |
| Orthographe « atterissage » | L2 | Affichage corrigé, `intitule_source` conservé |
| Un aléa et une cause sur chaque ligne | Tous différents ou presque | L'aléa est classé 6M par mots-clés, la cause reste une hypothèse |

Totaux : prévu 21:50:00, déclaré 30:47:30, horodatages 28:13:45. Périmètre concordant (53) : prévu 19:35:00, déclaré = horodatages = 27:36:05.

## PLM : `PLM_DataSet_FR.xlsx`

**`Sheet1`** (40 lignes). Une ligne : une référence. Clé : `Code / Référence`, unique. Champs : Désignation, Quantité, Fournisseur, Délai (texte « 15-20 jours »), Criticité, Masse (kg, stockée en texte), Coût achat pièce (€), Temps CAO (h). Pas de stock.

**`Feuil1`** (40 références + 7 lignes parasites). Répète code, désignation et Temps CAO, concordants avec `Sheet1` pour les 40. Les lignes L42 à L50 sont un texte collé (« ``` », « Caractéristiques : », `#NAME?`, « Voulez-vous une analyse… ») : exclues et listées dans les contrôles.

| Constat | Exemple |
|---|---|
| Désignation non unique | `Element_Structure` : 13 références. `Visserie` et `Entretoise` aussi. La désignation n'est pas une clé |
| Écart avec la notice | PLM `C984` (Outillage_Tournevis), notice p. 43 `C994`. Aucun rapprochement forcé |
| Référence sans équivalent notice | `C995` : la notice n'imprime pas de référence sur la planche d'autocollants |
| Référence PLM absente du MES | D144, C330, C984, C993 |
| Occurrences MES ≠ quantité PLM | A806 : 12 / 13 ; A337 : 69 / 73 ; A511 : 25 / 29 ; A247 : 6 / 2 ; A012 : 6 / 2 ; D145 : 2 / 1 ; D278 : 2 / 1 ; D122 : 1 / 2 ; C995 : 4 / 1 |

Notice et PLM donnent les mêmes quantités sur les 38 références communes. La somme p. 43 hors outils, boîtier et autocollants vaut 304, soit l'annonce de la p. 3 (« 304 pièces »).

Comparaison ponctuelle : l'étape 10 de la notice (p. 12) montre 12 pièces, le poste 10 du MES en liste 11. Le rang « bande courte ×2 » de la notice ne correspond qu'à un A806 dans `MES!L11`, ce qui est cohérent avec l'écart A806 de −1. La correspondance générale étape/poste n'est pas documentée et n'est donc pas utilisée dans les calculs.

Échelle : le PLM valorise la nomenclature à 21 099 040 € hors outillage (ex. D142 à 2 500 000 €), alors que la notice décrit une maquette. Les montants sont repris tels quels.

## ERP : `ERP_Equipes Airplus_FR.xlsx`, onglet `RESSOURCES` (150 lignes)

- **Une ligne** : une personne. Clé : Matricule, unique.
- **Champs** : Matricule, Prénom, Nom, Âge, Qualification, Poste de montage, Description du poste, Compétences (« Soudure Niveau 2 », séparateur virgule), Habilitations, Coût horaire (€, en texte), Niveau d'expérience, Rotation (« Semaine 1: Poste 55 | Semaine 3: Poste 50 »), Commentaire de Carrière.
- **Effectifs** : 3 personnes par poste de 1 à 38, 2 de 39 à 56.

| Constat | Traitement |
|---|---|
| 14 couples prénom + nom partagés par plusieurs matricules | Identifiant interne `PX…` par HMAC, secret dérivé du fichier ERP et non publié |
| 19 pseudonymes Prénom.I partagés par 44 profils | Distingués par l'identifiant interne |
| Compétences partielles : au plus 4 sur 6 par personne | Compétence absente = inconnue, jamais faible |
| Description du poste générique | Conservée, mais sans information métier |
| Semaines de rotation non datées | Non rapprochées des dates MES |
| 5 rotations vers le poste d'origine | Signalé |
| 5 profils : mention « Junior » et niveau « Débutant » non alignés | Signalé |
| Âge | Non repris : inutile aux calculs |
| Commentaire de carrière | Aucun nom détecté. Masquage automatique si un nom y figurait. Exclu du contexte IA |

Attention : la propriété « auteur » des classeurs et le chemin dans l'en-tête du STEP contiennent des noms. Rien de cela n'entre dans le ZIP d'analyse. Le STEP livré a un en-tête nettoyé.

## Fichiers 3D

| Fichier | Constat |
|---|---|
| `Boeing 787 A_.gltf` | Référence `Boeing 787 A_.bin`, **absent**. Ne contient que des bornes. 2 nœuds pointent vers un maillage inexistant (99 et 100 sur 99) |
| `Boeing 787 A_.stp` | AP242, B-Rep complète, 81 produits, 106 occurrences. Source de la géométrie affichée |
| `Projet_Innovation_4_All_STEP_A.3dxml` | 81 références, 106 instances, `V_version` = A et `V_maturity` = IN_WORK partout. Représentations binaires CGR non lues. Sert d'index CAO |

Géométrie : STEP tessellé avec Open CASCADE. Les bornes des 99 maillages concordent avec celles du glTF, à 0,044 mm près (`airplus/engine/reference/geometry_validation.json`).

Correspondances maillage → référence (99 occurrences) :

| Statut | Nombre | Règle |
|---|---|---|
| direct | 43 | Référence dans le nom du maillage |
| symetrie | 38 | « Symétrie de A806 » → A806 |
| parent | 6 | Nom vide ou « nez avion » : référence de l'assemblage parent |
| designation | 2 | « Train d'atterissage central » → A423, seule désignation Train_Atterissage, quantité 2 |
| inferee | 2 | « Symétrie de D144 » → D145 et « Symétrie de nez avion » → D119 : à vérifier |
| aucune | 8 | « Joint train cental » : aucune référence, pièce neutre |

Visserie, écrous, rivets et boîtier ne sont pas modélisés (13 références PLM sans maillage).

## Jointures

| Jointure | Couverture |
|---|---|
| MES → PLM, occurrences de référence | 304 / 304 |
| PLM → MES, références | 36 / 40 |
| PLM → Notice, références | 38 / 40 |
| MES → ERP, opérations par poste | 56 / 56 |
| ERP → MES, personnes | 150 / 150 |
| Rotations → MES, postes | 300 / 300 |
| Maillage → PLM, occurrences | 91 / 99 |
| PLM → Maillage, références | 27 / 40 |

## Supply chain

Calculs faits uniquement sur le PLM et le MES :

| Calcul | Règle | Résultat |
|---|---|---|
| Valeur par fournisseur | Quantité × coût achat pièce | 21 099 590 € sur 16 fournisseurs. Les 3 premiers : 89,4 % |
| Analyse ABC | Classe A jusqu'à 80 % du cumul, B jusqu'à 95 %, C au-delà | A : 2 références, 81,5 %. B : 4, 14,5 %. C : 34, 4 % |
| Masse | Quantité × masse unitaire | 13 358 kg |
| Délai pondéré | Délai maximal pondéré par la valeur | 34,8 jours, contre 17,9 sans pondération |
| Rétro-planning | Date de premier usage au MES − délai PLM maximal | Première commande le 19/07/2023 (D142) |
| Flux | Occurrences MES par fournisseur et par zone | 304 pièces, 47 liaisons |
