# Résultats de vérification

Date : 04/11/2026. Machine : Windows 11, 16 Go de RAM. Le script `tests/run_e2e.py` rejoue les contrôles sans navigateur.

## Trois niveaux de preuve

| Niveau | Ce qui a été exécuté |
|---|---|
| **Fichiers réels** | Les trois Excel fournis, à travers le moteur, l'import HTTP et le notebook exécuté hors Colab |
| **API de test** | `tests/mock_ollama.py` imite Ollama, pour les pannes et les refus |
| **Vrai modèle** | Ollama local, modèle `qwen3:4b` |

## Parcours

| # | Parcours | Résultat | Niveau |
|---|---|---|---|
| 1 | ZIP décompressé dans un dossier neuf, lancement, analyse préchargée | Réussi | Fichiers réels |
| 2 | Import des 3 Excel, ZIP, réouverture, comparaison à la préchargée et au notebook | Empreintes identiques. ZIP altéré et mauvais classeur refusés | Fichiers réels |
| 3 | Vérification depuis les lignes sources, avec un code indépendant du moteur | Réussi | Fichiers réels |
| 4 | Modifier une affectation, voir Équipe, Atelier et Pilotage, rétablir | Réussi | Navigateur |
| 5 | Pièce 3D → fiche → poste, Ishikawa → atelier, pièce sans référence | Réussi | Navigateur |
| 6 | Pseudonymisation du ZIP et de ce qui part vers Ollama | Réussi | Fichiers réels et API de test |
| 7 | Questions, citations invalides, Ollama indisponible | Réussi | API de test et vrai modèle |
| S | Supply chain : valeur, part des 3 premiers, masse, ABC, flux, rétro-planning | Recalcul indépendant concordant | Fichiers réels |

## Valeurs vérifiées

| Élément | Lignes sources | Calcul | Résultat |
|---|---|---|---|
| Durée | `MES!L32` | Déclaré 02:07:45, prévu 01:30:00, 16:48:50 → 17:00:00 | Trois mesures conservées |
| Rapprochement MES–PLM | `MES!L11`, `PLM!Sheet1!L9` | D278 → Queue_Arrière, Airbus Composites, 75 000 € | Concordant |
| Coût matière | `PLM!Sheet1!L6` | D142 : 4 × 2 500 000 € | 10 000 000 € |
| Valeur totale | `PLM!Sheet1` | Somme quantité × prix | 21 099 590 € |
| Part des 3 premiers fournisseurs | `PLM!Sheet1` | Safran Engines, Stelia Aerospace, Messier-Bugatti-Dowty | 89,45 % |
| Masse | `PLM!Sheet1` | Somme quantité × masse | 13 357,97 kg |
| Rétro-planning | `MES!L28`, `PLM!Sheet1!L6` | 02/09/2023 − 45 jours | 19/07/2023 |
| Main-d'œuvre, poste 31 | `MES!L32`, 3 lignes ERP | 114,50 €/h × 7 665 s | 243,79 € |
| Main-d'œuvre, total | MES et ERP | Somme des 56 opérations | 3 297,68 € |

Affectation modifiée (une personne du poste 31 vers le 27) : 3 269,40 €, écart −28,28 € conforme au calcul. Après retour aux affectations ERP : 3 297,68 €.

## Limite observée sur l'IA

Avec un petit modèle, le rôle de vérification laisse parfois passer une formulation imprécise. Les contrôles de code (citation existante, chiffres présents dans la source, gains chiffrés écartés) ne dépendent pas du modèle. Le jugement de fond, lui, en dépend : relisez les sources citées, et préférez un modèle plus grand si la machine le permet.

## Non exécuté

| Test | Raison |
|---|---|
| Notebook dans Google Colab | Cellules exécutées hors Colab, avec le même code |
| Lanceurs macOS et Linux | Aucune machine de ces systèmes |
| `lancer_windows.bat` par double-clic | Remplacé par `python -m airplus serve`, la commande qu'il lance |
| Téléchargement d'un modèle (bouton) | Non lancé, pour éviter un téléchargement volumineux |
| Saturation mémoire réelle d'Ollama | Testée avec le message d'erreur imité par l'API de test |
| Import par le sélecteur de fichiers | Import testé par l'API que ce formulaire appelle |
