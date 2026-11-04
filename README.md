# Air+

Process mining de la ligne d'assemblage, à partir des extraits MES, PLM et ERP. Application locale : le serveur écoute uniquement sur `127.0.0.1`.

## Espaces

Chaque espace s'organise de la même façon : une bande de valeurs en haut, le graphique à gauche, une table triable et filtrable à droite, reliée au graphique, et les vues détaillées en dessous. Un clic ouvre la fiche.

| Espace | Graphique | Tables et vues détaillées |
|---|---|---|
| **Temps** | Turbine des 56 opérations, par déroulé, zones, aléas, écarts | Opérations, déroulé jour par jour, écart par zone et par aléa, main-d'œuvre par zone |
| **Pièces** | Disques de la valeur, délais, commandes, flux | Références, fournisseurs, commandes, postes, criticité × délai, écarts nomenclature / MES, ABC |
| **Avion** | Modèle 3D, atelier schématique, Ishikawa 6M | Pièces, postes, aléas, catalogue complet |
| **Équipe** | Mur des 150 empreintes de compétences | Personnes, postes, compétences, habilitations, qualifications |
| **Question** | Ollama en local, réponses avec citations | Journal de la chaîne, lignes sources |

`Sources`, dans le bandeau : import des Excel, ZIP d'analyse, rapprochements, contrôles et journal.

Raccourcis : `1` à `5` pour les espaces, `Ctrl K` ou `/` pour chercher, `←` `→` dans une fiche, `Échap` pour fermer.

## Lancer

Il suffit de Python 3.9 ou plus récent. Aucune installation, aucun accès Internet.

| Système | Lanceur |
|---|---|
| Windows | double-clic sur `lancer_windows.bat` |
| macOS | double-clic sur `lancer_macos.command` (si besoin : clic droit > Ouvrir) |
| Linux | `sh lancer_linux.sh` |

Équivalent en ligne de commande :

```bash
python -m airplus serve
```

Le navigateur s'ouvre sur l'analyse préchargée.

## Activer l'IA (facultatif)

1. Installez [Ollama](https://ollama.com) et lancez-le.
2. Dans **Question**, ouvrez les réglages Ollama, saisissez un modèle, puis **Télécharger le modèle** s'il manque.
3. Cliquez sur **Tester le modèle**.

## Utiliser vos propres fichiers

Page **Sources** : sélectionnez les trois Excel MES, PLM et ERP. Air+ refait tous les calculs, produit un ZIP d'analyse et le charge. Ce ZIP se partage et se rouvre.

Les personnes apparaissent sous la forme Prénom.I. Après un import local, le code `1234` affiche les noms sur l'écran : ils restent en mémoire et n'entrent jamais dans le ZIP ni dans l'IA.

Le notebook `notebooks/AirPlus_Colab.ipynb` contient le même moteur, pour Google Colab.

```bash
python -m airplus analyze --mes MES.xlsx --plm PLM.xlsx --erp ERP.xlsx --out analyse.zip
```

## Organisation

| Dossier | Contenu |
|---|---|
| `airplus/engine/` | Moteur : lecture, rapprochements, calculs, exports, pseudonymisation |
| `airplus/rag.py`, `ollama_client.py` | Chaîne IA à trois rôles : chercher, analyser, vérifier |
| `airplus/server.py` | Serveur local |
| `web/` | Tableau de bord, three.js, maillage 3D, notice, présentation (`presentation.html`) |
| `data/preloaded/` | Analyse des trois fichiers fournis, identités pseudonymisées |
| `notebooks/` | Notebook Colab |
| `ressources_3d/` | STEP, glTF et 3DXML |
| `docs/` | Audit des données, parcours de démonstration, résultats de vérification |
| `tools/`, `tests/` | Construction des ressources et du ZIP, tests de bout en bout |

Le ZIP d'analyse suit les phases du challenge : `1_DISCOVER`, `2_DEFINE`, `3_DESIGN`, `4_DELIVER`. Son dictionnaire est dans `4_DELIVER/4.3_documentation/DICTIONNAIRE.md`.

## Règles de calcul

- Réalisé : colonne Temps Réel du MES. Pointage : Heure Fin − Heure Début. Sur 3 postes, la fin est pointée à 17:00 et le temps déclaré dépasse le pointage (P15, P31, P50).
- Aléa : valeur déclarée au MES. Cause possible : colonne Cause Potentielle, hypothèse à vérifier.
- Coût main-d'œuvre : durée × somme des taux de l'équipe du poste, équipe complète sur toute l'opération.
- Atelier 3D : plan schématique, postes rangés par zone.
- Rétro-planning : premier usage au MES − délai maxi du PLM.
- IA : le serveur écarte les citations inexistantes et les chiffres absents des sources citées. La qualité des réponses dépend du modèle.

## Tests

```bash
python tests/run_e2e.py AirPlus_livraison.zip dossier_des_trois_excel
```
