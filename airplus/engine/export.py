"""Production du ZIP d'analyse : tables par phase, table generale documentee, controle de pseudonymisation."""
import csv
import hashlib
import io
import json
import re
import zipfile

from .common import ENGINE_VERSION, hms

FIXED_TS = (2000, 1, 1, 0, 0, 0)  # horodatage neutre : aucune metadonnee de poste ou de date dans l'archive
DASHBOARD_ENTRY = "dashboard/analysis.json"
SENSITIVE_PERSON_FIELDS_AI = ("taux_horaire_eur", "commentaire_carriere")


class PseudonymizationError(RuntimeError):
    pass


def _json_bytes(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=1, default=str).encode("utf-8")


def _csv_bytes(rows, columns=None):
    rows = list(rows)
    cols = columns or (list(dict.fromkeys(k for r in rows for k in r)) if rows else [])
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, delimiter=";", extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({k: (json.dumps(v, ensure_ascii=False, sort_keys=True) if isinstance(v, (list, dict)) else ("" if v is None else v)) for k, v in r.items()})
    return ("﻿" + buf.getvalue()).encode("utf-8")


def content_hash(analysis):
    """Empreinte du contenu calcule. Ne depend ni de l'horodatage, ni du nom des fichiers importes."""
    core = {k: v for k, v in analysis.items() if k != "meta"}
    return hashlib.sha256(json.dumps(core, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")).hexdigest()


TABLES = [
    # (chemin, cle dans analysis, granularite, cles)
    ("1_DISCOVER/1.1_extraction_journal/operations.csv", "operations", "Une ligne = une opération MES (une ligne Excel, un poste).", "op_id"),
    ("1_DISCOVER/1.1_extraction_journal/event_log.csv", "events", "Une ligne = un événement (début ou fin) d'une opération.", "event_id"),
    ("1_DISCOVER/1.1_extraction_journal/op_refs.csv", "op_refs", "Une ligne = une référence distincte dans une opération, avec son nombre d'occurrences. Ne pas sommer les durées ici.", "op_id, ref"),
    ("1_DISCOVER/1.1_extraction_journal/parts.csv", "parts", "Une ligne = une référence PLM.", "ref"),
    ("1_DISCOVER/1.1_extraction_journal/persons_pseudonymises.csv", "persons", "Une ligne = un profil ERP pseudonymisé.", "person_id"),
    ("1_DISCOVER/1.1_extraction_journal/person_skills.csv", "skills", "Une ligne = une compétence déclarée d'un profil.", "person_id, competence"),
    ("1_DISCOVER/1.1_extraction_journal/person_rotations.csv", "rotations", "Une ligne = une rotation déclarée d'un profil. Semaines non datées.", "person_id, semaine"),
    ("1_DISCOVER/1.1_extraction_journal/mesh_links.csv", "meshes", "Une ligne = une occurrence maillée du modèle 3D.", "occurrence_id"),
    ("1_DISCOVER/1.3_cartographie_flux/flow_edges.csv", "flow_edges", "Une ligne = une transition entre deux opérations consécutives.", "de, vers"),
    ("1_DISCOVER/1.3_cartographie_flux/zones.csv", "zones", "Une ligne = une zone d'opérations (regroupement par règle sur l'intitulé).", "zone"),
    ("1_DISCOVER/1.3_cartographie_flux/zone_edges.csv", "zone_edges", "Une ligne = un passage entre deux zones.", "de, vers"),
    ("2_DEFINE/2.1_perimetre/jointures.csv", "joins", "Une ligne = une jointure avec sa couverture.", "jointure"),
    ("2_DEFINE/2.2_caracterisation/postes.csv", "postes", "Une ligne = un poste de référence.", "poste"),
    ("2_DEFINE/2.3_indicateurs/kpis.csv", "kpis", "Une ligne = un indicateur calculé.", "kpi_id"),
    ("2_DEFINE/2.3_indicateurs/fournisseurs.csv", "suppliers", "Une ligne = un fournisseur (agrégat de références PLM).", "fournisseur"),
    ("2_DEFINE/2.4_ecarts/anomalies.csv", "anomalies", "Une ligne = une anomalie ou un contrôle.", "anomalie_id"),
    ("2_DEFINE/2.4_ecarts/reconciliation_references.csv", "reconciliation", "Une ligne = une référence, comparée entre PLM, notice, MES et modèle 3D.", "ref"),
    ("2_DEFINE/2.4_ecarts/goulots_candidats.csv", "candidates", "Une ligne = une opération dont le dépassement est à investiguer.", "op_id"),
    ("2_DEFINE/2.5_supply_chain/abc_references.csv", "supply_abc", "Une ligne = une référence avec sa classe ABC sur la valeur de nomenclature.", "ref"),
    ("2_DEFINE/2.5_supply_chain/flux_fournisseur_zone.csv", "supply_flows", "Une ligne = un fournisseur et une zone, avec les pièces citées au MES.", "fournisseur, zone"),
    ("2_DEFINE/2.5_supply_chain/retroplanning_commandes.csv", "supply_calendar", "Une ligne = une référence citée au MES : premier usage moins délai PLM.", "ref"),
    ("2_DEFINE/2.5_supply_chain/criticite_delai.csv", "supply_grid", "Une ligne = une criticité et une tranche de délai.", "criticite, delai"),
    ("2_DEFINE/2.5_supply_chain/postes_approvisionnement.csv", "supply_postes", "Une ligne = un poste avec les délais et fournisseurs de ses pièces.", "poste"),
    ("2_DEFINE/2.5_supply_chain/ecarts_nomenclature_mes.csv", "supply_ecarts", "Une ligne = une référence dont les occurrences MES diffèrent de la nomenclature.", "ref"),
    ("3_DESIGN/3.1_processus_cible/processus_cible.csv", "target_process", "Une ligne = une opération de la séquence ; la durée cible est le Temps Prévu source.", "op_id"),
    ("3_DESIGN/3.2_pistes_amelioration/pistes.csv", "leads", "Une ligne = une piste dérivée par règle, sans gain chiffré.", "piste_id"),
    ("general/table_generale.csv", "general", "Une ligne = une référence distincte dans une opération (ou l'opération seule si la référence manque). Les colonnes op_* sont au grain opération : les sommer uniquement sur ligne_operation_1 = 1. Les profils sont listés dans une seule cellule pour ne pas multiplier les lignes.", "op_id, ref"),
]

DOCS = {
    "1_DISCOVER/1.2_identification_processus/README.md": lambda a: f"""# Identification du processus
Processus : assemblage du modèle Dreamliner, en {len(a['operations'])} opérations séquentielles, une par poste.
Le relevé forme une séquence observée. Activité : intitulé MES (`Nom`) ; la clé est le numéro de poste.
""",
    "1_DISCOVER/1.4_parcours/README.md": lambda a: "# Visualisation des parcours\nLe parcours observé est `flow_edges.csv` au grain opération et `zone_edges.csv` au grain zone.\n",
    "3_DESIGN/3.3_actions_terrain/README.md": lambda a: "# Actions à vérifier sur le terrain\nLes pistes de `3.2_pistes_amelioration/pistes.csv` sont des points de contrôle. Une cause potentielle reste une hypothèse.\n",
    "4_DELIVER/4.1_implementation/README.md": lambda a: f"# Implémentation\nMoteur Air+ {ENGINE_VERSION}. Le même code alimente le dashboard et le notebook Colab.\n",
    "4_DELIVER/4.2_lancement_equipe/README.md": lambda a: "# Lancement par l'équipe\nLancer le dashboard avec le lanceur de son système, ouvrir l'analyse préchargée ou importer les trois Excel.\n",
    "4_DELIVER/4.3_documentation/DICTIONNAIRE.md": None,
    "4_DELIVER/4.4_prise_en_main/README.md": lambda a: "# Prise en main\nParcours conseillé : Pilotage, Supply chain, Jumeau 3D, Équipe, Aide à la décision.\n",
}


def data_dictionary():
    lines = ["# Dictionnaire des tables", "", "CSV UTF-8 avec BOM, séparateur `;`. Provenance : `MES!L32` = fichier MES, ligne Excel 32 ; `PLM!Sheet1!L6` ; `ERP!RESSOURCES!L2`.", "", "| Fichier | Granularité | Clé |", "|---|---|---|"]
    lines += [f"| `{p}` | {g} | {k} |" for p, _, g, k in TABLES]
    lines += ["", "## Mesures de durée", "- `prevu_s` : colonne Temps Prévu.", "- `reel_s` : colonne Temps Réel, le réel déclaré.", "- `horo_s` : Heure Fin − Heure Début.", "- `ecart_horo_reel_s` : écart conservé entre horodatages et déclaré.", "", "## Identités", "`person_id` est dérivé par HMAC d'un secret calculé sur le fichier ERP. Le secret n'est pas publié. Ni nom complet ni matricule dans cette archive. L'âge n'est pas repris."]
    return "\n".join(lines) + "\n"


def build_zip(analysis, identity, generated_at=None):
    """Construit le ZIP puis verifie l'absence d'identites. Leve PseudonymizationError en cas de fuite."""
    files = {}
    for path, key, _, _ in TABLES:
        files[path] = _csv_bytes(analysis[key])
    files["2_DEFINE/2.5_supply_chain/synthese.json"] = _json_bytes(analysis["supply"])
    files["2_DEFINE/2.3_indicateurs/ishikawa.json"] = _json_bytes(analysis["ishikawa"])
    files["1_DISCOVER/1.2_identification_processus/colonnes_sources.json"] = _json_bytes(analysis["headers"])
    files["4_DELIVER/4.5_suivi_indicateurs/suivi.csv"] = _csv_bytes([{"kpi_id": k["kpi_id"], "libelle": k["libelle"], "reference_observee": k["affichage"], "unite": k["unite"], "formule": k["formule"], "src": k["src"]} for k in analysis["kpis"]])
    for p, fn in DOCS.items():
        files[p] = (fn(analysis).encode("utf-8") if fn else data_dictionary().encode("utf-8"))
    chash = content_hash(analysis)
    analysis["meta"]["content_sha256"] = chash
    report = scan_identity(files, identity, analysis)
    manifest = {"engine_version": ENGINE_VERSION, "content_sha256": chash, "generated_at": generated_at, "sources": analysis["meta"]["sources"], "pseudonymisation": report,
                "tables": [{"fichier": p, "granularite": g, "cle": k, "lignes": len(analysis[t])} for p, t, g, k in TABLES]}
    files["manifest.json"] = _json_bytes(manifest)
    files[DASHBOARD_ENTRY] = _json_bytes(analysis)
    files["dashboard/rag_docs.json"] = _json_bytes(analysis["rag_docs"])
    files["README.md"] = f"# Analyse Air+\nMoteur {ENGINE_VERSION}. Empreinte du contenu `{chash}`.\nDossiers : 1_DISCOVER, 2_DEFINE, 3_DESIGN, 4_DELIVER, general, dashboard.\nÀ recharger dans le dashboard Air+ : menu Données > Ouvrir un ZIP d'analyse.\n".encode("utf-8")
    final = scan_identity(files, identity, analysis)
    if final["fuites"]:
        raise PseudonymizationError(f"Identités détectées dans l'archive : {final['fuites']} fichier(s). ZIP non écrit.")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, FIXED_TS); info.compress_type = zipfile.ZIP_DEFLATED; info.external_attr = 0o644 << 16
            z.writestr(info, files[name])
    return buf.getvalue(), manifest


def scan_identity(files, identity, analysis):
    """Cherche noms complets (dans les deux ordres), matricules et champs interdits. Le rapport ne contient aucun nom."""
    needles = set()
    for v in identity.values():
        full = v["nom_complet"].strip()
        if full:
            needles.add(full.lower())
            parts = full.split(" ", 1)
            if len(parts) == 2:
                needles.add(f"{parts[1]} {parts[0]}".lower()); needles.add(f"{parts[0]}.{parts[1]}".lower())
        if v["matricule"]:
            needles.add(str(v["matricule"]).lower())
    pat = re.compile("|".join(sorted((re.escape(n) for n in needles), key=len, reverse=True))) if needles else None
    leaks = []
    for name, data in files.items():
        text = data.decode("utf-8", "ignore").lower()
        if pat and pat.search(text):
            leaks.append(name)
        if pat and pat.search(name.lower()):
            leaks.append(name)
    return {"controle": "noms complets (deux ordres), prénom.nom, matricules", "motifs_cherches": len(needles), "fichiers_controles": len(files), "fuites": sorted(set(leaks)), "metadonnees_zip": "dates neutres, aucun commentaire, aucun classeur source"}


def read_analysis_zip(data, max_uncompressed=200 * 1024 * 1024):
    """Lit un ZIP d'analyse sans rien extraire sur disque."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if sum(i.file_size for i in z.infolist()) > max_uncompressed:
                raise ValueError("Archive trop volumineuse.")
            if DASHBOARD_ENTRY not in z.namelist() or "manifest.json" not in z.namelist():
                raise ValueError("Ce ZIP n'est pas une analyse Air+ (dashboard/analysis.json absent).")
            analysis = json.loads(z.read(DASHBOARD_ENTRY).decode("utf-8"))
            manifest = json.loads(z.read("manifest.json").decode("utf-8"))
    except zipfile.BadZipFile:
        raise ValueError("Fichier ZIP illisible.")
    stored = analysis.get("meta", {}).get("content_sha256")
    if stored != content_hash(analysis):
        raise ValueError("Empreinte de l'analyse incohérente : archive modifiée ou incomplète.")
    return analysis, manifest
