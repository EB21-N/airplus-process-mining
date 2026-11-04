# Air+ : comprendre ce qui ralentit l'assemblage

Air+ est un tableau de bord local de process mining. Il relie les données de production (MES), de nomenclature (PLM) et d'équipes (ERP) pour montrer où le temps part, d'où viennent les pièces, qui travaille où, et pour poser des questions à une IA qui cite ses sources.

Tout tourne sur votre ordinateur : le serveur écoute uniquement sur `127.0.0.1`, rien ne sort de la machine.

## Ce que l'on y trouve

| Espace | Pour répondre à |
|---|---|
| **Pilotage** | Combien de temps en plus, où, à quels postes, et ce que cela coûte |
| **Supply chain** | Qui livre quoi, combien cela pèse, quand commander, quels postes en dépendent |
| **Jumeau 3D** | Voir les pièces sur l'avion, les postes dans l'atelier, l'Ishikawa, le catalogue |
| **Équipe** | Qui est sur quel poste, avec quelles compétences. Modifier une affectation recalcule tout |
| **Aide à la décision** | Poser une question libre à une IA locale, qui répond avec ses sources |

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
2. Dans **Aide à la décision > Réglages**, saisissez un modèle, puis **Télécharger le modèle** s'il manque.
3. Cliquez sur **Tester le modèle**.

## Utiliser vos propres fichiers

Bouton **Données** : sélectionnez les trois Excel MES, PLM et ERP. Air+ refait tous les calculs, produit un ZIP d'analyse et le charge. Ce ZIP se partage et se rouvre.

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

## Comment lire les chiffres

- Chaque chiffre remonte à une ligne de l'un des fichiers : cliquez sur une étiquette de source.
- Un aléa est ce que l'équipe a déclaré. Une « cause possible » reste une hypothèse à vérifier.
- Le coût main-d'œuvre compte toute l'équipe du poste pendant toute l'opération.
- Le plan de l'atelier est schématique : les postes sont rangés par zone.
- Le rétro-planning part de la première date d'usage au MES et du délai le plus long du PLM.
- Les réponses de l'IA se vérifient : elle cite ses sources, et le serveur écarte ce qu'il ne retrouve pas dans les données. Sa qualité dépend du modèle choisi.

## Tests

```bash
python tests/run_e2e.py AirPlus_livraison.zip dossier_des_trois_excel
```
