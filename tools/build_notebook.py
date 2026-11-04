#!/usr/bin/env python3
"""Genere notebooks/AirPlus_Colab.ipynb en embarquant le code exact du moteur (airplus/engine)."""
import base64
import hashlib
import io
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def bundle():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("airplus/__init__.py", (2000, 1, 1, 0, 0, 0)), '"""Air+"""\n')
        base = os.path.join(ROOT, "airplus", "engine")
        for dp, dn, fn in sorted(os.walk(base)):
            dn.sort(); dn[:] = [d for d in dn if d != "__pycache__"]
            for f in sorted(fn):
                full = os.path.join(dp, f)
                rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
                z.writestr(zipfile.ZipInfo(rel, (2000, 1, 1, 0, 0, 0)), open(full, "rb").read())
    return buf.getvalue()


def md(t):
    return {"cell_type": "markdown", "metadata": {}, "source": t.splitlines(True)}


def code(t):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": t.splitlines(True)}


def main(expected_hash):
    data = bundle(); sha = hashlib.sha256(data).hexdigest(); b64 = base64.b64encode(data).decode()
    wrap = "\n".join(b64[i:i + 120] for i in range(0, len(b64), 120))
    cells = [
        md("# Air+ : pipeline d'analyse\n\nCe notebook exécute **le même moteur Python** que le dashboard. Il prend les trois Excel MES, PLM et ERP, refait le nettoyage, les rapprochements et les calculs, puis produit le ZIP d'analyse à ouvrir dans le dashboard (menu Données).\n\nAucune donnée n'est simulée. Le ZIP ne contient que des identités pseudonymisées.\n"),
        md("## 1. Installer le moteur embarqué\n\nLe code ci-dessous est l'archive exacte de `airplus/engine`, vérifiée par son empreinte.\n"),
        code(f'''import base64, hashlib, importlib.util, io, os, subprocess, sys, zipfile
if importlib.util.find_spec("openpyxl") is None:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "openpyxl"])
ENGINE_B64 = """
{wrap}
"""
raw = base64.b64decode(ENGINE_B64)
assert hashlib.sha256(raw).hexdigest() == "{sha}", "Moteur embarqué altéré"
WORK = os.path.abspath("airplus_colab")
with zipfile.ZipFile(io.BytesIO(raw)) as z:
    z.extractall(WORK)
sys.path.insert(0, WORK)
from airplus import engine
print("Moteur Air+", engine.ENGINE_VERSION)
'''),
        md("## 2. Charger les trois Excel\n\nDans Colab, sélectionnez `MES_Extraction_FR.xlsx`, `PLM_DataSet_FR.xlsx` et `ERP_Equipes Airplus_FR.xlsx`. Hors Colab, définissez la variable `AIRPLUS_SOURCES` vers leur dossier.\n"),
        code('''def _pick(names, key):
    hits = [n for n in names if key in n.upper()]
    assert hits, f"Fichier {key} introuvable parmi {list(names)}"
    return sorted(hits, key=len)[0]

try:
    from google.colab import files as _colab_files
    uploaded = _colab_files.upload()
except ImportError:
    folder = os.environ["AIRPLUS_SOURCES"]
    uploaded = {f: open(os.path.join(folder, f), "rb").read() for f in os.listdir(folder) if f.lower().endswith(".xlsx")}
names = {k: _pick(uploaded, k.upper()) for k in ("mes", "plm", "erp")}
print(names)
'''),
        md("## 3. Exécuter le moteur\n"),
        code('''zip_bytes, analysis, manifest, identity = engine.run(uploaded[names["mes"]], uploaded[names["plm"]], uploaded[names["erp"]], names)
del identity  # les identites restent en memoire le temps du controle, jamais dans le ZIP
print("Empreinte du contenu :", manifest["content_sha256"])
print("Pseudonymisation :", manifest["pseudonymisation"]["fuites"] or "aucune fuite", "sur", manifest["pseudonymisation"]["fichiers_controles"], "fichiers")
'''),
        md("## 4. Indicateurs et contrôles\n"),
        code('''for k in analysis["kpis"]:
    print(f'{k["libelle"]:<58} {str(k["affichage"]):>16} {k["unite"] if k["unite"] != "s" else "":<14} n={k["effectif"]}')
print("\\nSupply chain :", analysis["supply"]["n_fournisseurs"], "fournisseurs,", analysis["supply"]["valeur_totale_eur"], "EUR, top 3 :", analysis["supply"]["part_top3_pct"], "%")
print("\\nJointures :")
for j in analysis["joins"]:
    print(f' - {j["jointure"]:<22} {j["numerateur"]}/{j["denominateur"]} {j["unite"]} ({j["couverture_pct"]} %)')
print("\\nGoulots candidats :")
for c in analysis["candidates"][:5]:
    print(f' - poste {c["poste"]:>2} {c["intitule"]} : écart {c["ecart_s"]} s, {c["src"]}. {c["statut"]}')
'''),
        md("## 5. Écrire et télécharger le ZIP\n\nComparez l'empreinte à celle de l'analyse préchargée : deux empreintes égales signifient des tables strictement identiques.\n"),
        code(f'''EXPECTED_PRELOADED = "{expected_hash}"
OUT = "airplus_analyse.zip"
with open(OUT, "wb") as f:
    f.write(zip_bytes)
print("Identique à l'analyse préchargée :", manifest["content_sha256"] == EXPECTED_PRELOADED)
try:
    from google.colab import files as _colab_files
    _colab_files.download(OUT)
except ImportError:
    print("ZIP écrit :", os.path.abspath(OUT))
'''),
    ]
    nb = {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python"}, "colab": {"name": "AirPlus_Colab.ipynb"}}, "nbformat": 4, "nbformat_minor": 5}
    out = os.path.join(ROOT, "notebooks", "AirPlus_Colab.ipynb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(nb, f, ensure_ascii=False, indent=1)
    print("notebook", out, os.path.getsize(out), "moteur", sha)


if __name__ == "__main__":
    main(sys.argv[1])
