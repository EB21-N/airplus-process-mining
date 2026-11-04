"""Rapprochements, KPI, controles et livrables par phase. Toutes les valeurs proviennent des tables de reference."""
import collections
import datetime as dt
import io
import json
import os
import re

import openpyxl

from .common import ENGINE_VERSION, hms, norm_key, rnd
from .sources import M6_RULES, SKILL_RULES, ZONE_ORDER, ZONE_LABEL, person_fit, read_erp, read_mes, read_plm, required_skills

REFERENCE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference")
MOBILISATION = "Calcul : toutes les personnes affectées au poste sont comptées pendant toute la durée de l'opération."


def _load_ref(name):
    with open(os.path.join(REFERENCE_DIR, name), encoding="utf-8") as f:
        return json.load(f)


# ---- Maillages <-> references ------------------------------------------------------------------------------
def map_meshes(manifest, parts_by_ref):
    """Correspondances documentees. status : direct | symetrie | parent | designation | inferee | aucune."""
    out = []
    ref_re = re.compile(r"\b([ACD]\d{3})\b")
    for i, o in enumerate(manifest["occurrences"]):
        mesh, node = o["mesh_name"] or "", o["node_name"] or ""
        path = o["assembly_path"]
        parent = path[-2] if len(path) >= 2 else ""
        mirror = "symétrie" in mesh.lower() or "symétrie" in node.lower()
        modified = "modifi" in mesh.lower() or "modifi" in parent.lower()
        ref, status, method, candidates = None, "aucune", "Aucune référence dans le nom du maillage, du nœud ou de l'assemblage parent.", []
        m = ref_re.search(mesh) if mesh not in ("SOLID", "COMPOUND", "") else None
        if m:
            ref = m[1]; status = "symetrie" if mirror else "direct"
            method = f"Référence lue dans le nom du maillage « {mesh} »."
            if ref == "D144" and mirror:  # D144 x1 et D145 x1 en nomenclature : la piece miroir de D144 n'est pas nommee D145 dans la CAO
                ref, status = "D145", "inferee"
                method = "Le maillage s'appelle « Symétrie de D144 » ; la nomenclature contient D144 ×1 et D145 ×1 (Queue_Arrière_Droite/Gauche). D145 est déduite : à vérifier."
                candidates = ["D144", "D145"]
        elif mesh in ("SOLID", "COMPOUND", "") and ref_re.search(parent):
            ref = ref_re.search(parent)[1]; status = "parent"
            method = f"Maillage sans nom ; référence lue dans l'assemblage parent « {parent} »."
        elif re.match(r"nez avion", mesh, re.I) and "D120" in parent:
            ref, status = "D120", "parent"
            method = f"Maillage « {mesh} » rattaché à l'assemblage parent « {parent} »."
        elif "nez avion" in mesh.lower() and mirror:
            ref, status = "D119", "inferee"
            method = "Le maillage « Symétrie de nez avion » est le miroir de D120 ; la nomenclature contient D119 ×1 (Nez_Gauche) et D120 ×1 (Nez_Droit). D119 est déduite : à vérifier."
            candidates = ["D119", "D120"]
        elif "train d'atterissage central" in mesh.lower():
            ref, status = "A423", "designation"
            method = "Rapproché de la désignation PLM unique « Train_Atterissage » (A423, quantité 2 ; 2 occurrences dans le modèle)."
        if ref and ref not in parts_by_ref:
            status = "aucune"; method = f"La référence {ref} lue dans la CAO n'existe pas dans le PLM."; ref = None
        out.append({"occurrence_id": f"M{i + 1:03d}", "node_index": o["node_index"], "node_name": node, "mesh_name": mesh,
                    "assembly_path": " > ".join(p for p in path[1:] if p), "ref": ref, "status": status, "method": method,
                    "candidates": candidates, "symetrie": mirror, "geometrie_modifiee": modified,
                    "bbox_min": o["world_bbox_min"], "bbox_max": o["world_bbox_max"], "src": f"CAO!{node or mesh}"})
    return out


def _headers(data):
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    res = []
    for ws in wb.worksheets:
        first = next(ws.iter_rows(values_only=True, max_row=1), ())
        res += [f"{ws.title}: {h}" for h in first if h is not None]
    wb.close()
    return res


# ---- Supply chain : uniquement PLM, MES et leurs liens par reference ----------------------------------------
CRIT_ORDER = ["Critique", "Haute", "Moyenne", "Basse"]
LEAD_BUCKETS = [("≤ 10 j", 0, 10), ("11-20 j", 11, 20), ("21-35 j", 21, 35), ("> 35 j", 36, 10 ** 6)]


def build_supply(parts, ops, op_refs, suppliers, recon):
    by_op = {o["op_id"]: o for o in ops}
    total = sum(p["valeur_nomenclature_eur"] or 0 for p in parts) or 1
    # ABC sur la valeur de nomenclature
    ranked = sorted(parts, key=lambda p: (-(p["valeur_nomenclature_eur"] or 0), p["ref"]))
    abc, cum = [], 0
    for p in ranked:
        v = p["valeur_nomenclature_eur"] or 0
        prev = cum; cum += v
        cls = "A" if prev / total < .8 else "B" if prev / total < .95 else "C"
        abc.append({"ref": p["ref"], "designation": p["designation"], "fournisseur": p["fournisseur"], "criticite": p["criticite"], "valeur_eur": v, "part_pct": rnd(100 * v / total, 2), "cumul_pct": rnd(100 * cum / total, 2), "classe": cls, "src": p["src"]})
    abc_sum = []
    for c in "ABC":
        L = [a for a in abc if a["classe"] == c]
        abc_sum.append({"classe": c, "n_refs": len(L), "valeur_eur": rnd(sum(a["valeur_eur"] for a in L), 2), "part_pct": rnd(100 * sum(a["valeur_eur"] for a in L) / total, 1), "refs": [a["ref"] for a in L]})
    # Fournisseurs enrichis
    cum = 0
    part_by = {p["ref"]: p for p in parts}
    for s in suppliers:
        ps = [p for p in parts if p["fournisseur"] == s["fournisseur"]]
        cum += s["valeur_eur"]
        rs = [r for r in op_refs if r["ref"] in s["refs"]]
        zones = {}
        for r in rs:
            z = by_op[r["op_id"]]["zone"]; zones[z] = zones.get(z, 0) + r["occurrences"]
        s.update({"n_refs": len(ps), "part_pct": rnd(100 * s["valeur_eur"] / total, 2), "cumul_pct": rnd(100 * cum / total, 2), "qty_totale": sum(p["qty_nomenclature"] or 0 for p in ps),
                  "masse_kg": rnd(sum((p["qty_nomenclature"] or 0) * (p["masse_kg"] or 0) for p in ps), 2), "delai_min_j": min((p["delai_min_j"] for p in ps if p["delai_min_j"] is not None), default=None),
                  "n_critiques": sum(1 for p in ps if p["criticite"] == "Critique"), "postes": sorted({r["poste"] for r in rs}), "zones": zones,
                  "criticite_max": next((c for c in CRIT_ORDER if any(p["criticite"] == c for p in ps)), None), "outillage_seul": all(p["est_outillage"] for p in ps)})
    # Flux fournisseur -> zone (pieces citees dans le MES)
    flows = {}
    for r in op_refs:
        p = part_by.get(r["ref"])
        if not p:
            continue
        o = by_op[r["op_id"]]
        k = (p["fournisseur"], o["zone"])
        f = flows.setdefault(k, {"fournisseur": k[0], "zone": k[1], "pieces": 0, "valeur_eur": 0, "refs": set(), "postes": set()})
        f["pieces"] += r["occurrences"]; f["valeur_eur"] += r["occurrences"] * (p["prix_achat_eur"] or 0); f["refs"].add(r["ref"]); f["postes"].add(r["poste"])
    flow_rows = [{**f, "valeur_eur": rnd(f["valeur_eur"], 2), "refs": sorted(f["refs"]), "postes": sorted(f["postes"])} for _, f in sorted(flows.items())]
    # Retro-planning : date de premier usage au MES moins le delai PLM
    calendar = []
    for p in parts:
        uses = [by_op[x["op_id"]] for x in p["operations"]]
        if not uses or p["delai_max_j"] is None:
            continue
        first = min(uses, key=lambda o: o["debut"])
        d = dt.date.fromisoformat(first["date"])
        calendar.append({"ref": p["ref"], "designation": p["designation"], "fournisseur": p["fournisseur"], "criticite": p["criticite"], "premier_poste": first["poste"], "date_besoin": first["date"], "delai_min_j": p["delai_min_j"], "delai_max_j": p["delai_max_j"],
                         "commande_au_plus_tard": (d - dt.timedelta(days=p["delai_max_j"])).isoformat(), "commande_si_delai_court": (d - dt.timedelta(days=p["delai_min_j"])).isoformat(), "src": p["src"], "src_mes": first["src"]})
    calendar.sort(key=lambda c: (c["commande_au_plus_tard"], c["ref"]))
    # Criticite x delai
    grid = []
    for crit in CRIT_ORDER:
        for label, lo, hi in LEAD_BUCKETS:
            L = [p for p in parts if p["criticite"] == crit and p["delai_max_j"] is not None and lo <= p["delai_max_j"] <= hi]
            grid.append({"criticite": crit, "delai": label, "n_refs": len(L), "valeur_eur": rnd(sum(p["valeur_nomenclature_eur"] or 0 for p in L), 2), "refs": [p["ref"] for p in L]})
    # Postes : ce que chaque operation attend des fournisseurs
    postes = []
    for o in ops:
        rs = [r for r in op_refs if r["op_id"] == o["op_id"] and r["ref"] in part_by]
        if not rs:
            continue
        ps = [part_by[r["ref"]] for r in rs]
        longest = max(ps, key=lambda p: (p["delai_max_j"] or 0, p["valeur_nomenclature_eur"] or 0))
        postes.append({"poste": o["poste"], "intitule": o["intitule"], "zone": o["zone"], "n_refs": len(ps), "n_fournisseurs": len({p["fournisseur"] for p in ps}), "n_critiques": sum(1 for p in ps if p["criticite"] == "Critique"), "delai_max_j": longest["delai_max_j"], "ref_delai_max": longest["ref"], "fournisseur_delai_max": longest["fournisseur"],
                       "valeur_pieces_eur": o["valeur_matiere_mes_eur"], "src": o["src"]})
    postes.sort(key=lambda x: (-(x["delai_max_j"] or 0), -x["n_critiques"], x["poste"]))
    ecarts = [{"ref": r["ref"], "designation": r["designation"], "nomenclature": r["qty_plm"], "occurrences_mes": r["occ_mes"], "ecart": r["ecart_mes_plm"], "src": r["src_plm"]} for r in recon if r["ecart_mes_plm"] not in (None, 0) and r["occ_mes"] > 0]
    ecarts.sort(key=lambda e: e["ecart"])
    crit = [p for p in parts if p["criticite"] == "Critique"]
    with_lead = [p for p in parts if p["delai_max_j"] is not None]
    summary = {"n_fournisseurs": len(suppliers), "n_refs": len(parts), "valeur_totale_eur": rnd(total, 2), "masse_totale_kg": rnd(sum((p["qty_nomenclature"] or 0) * (p["masse_kg"] or 0) for p in parts), 2), "qty_totale": sum(p["qty_nomenclature"] or 0 for p in parts),
               "part_top3_pct": rnd(sum(s["part_pct"] for s in suppliers[:3]), 1), "top3": [s["fournisseur"] for s in suppliers[:3]], "delai_max_j": max((p["delai_max_j"] for p in with_lead), default=None),
               "delai_moyen_pondere_j": rnd(sum(p["delai_max_j"] * (p["valeur_nomenclature_eur"] or 0) for p in with_lead) / total, 1), "delai_moyen_simple_j": rnd(sum(p["delai_max_j"] for p in with_lead) / max(1, len(with_lead)), 1),
               "n_critiques": len(crit), "valeur_critique_eur": rnd(sum(p["valeur_nomenclature_eur"] or 0 for p in crit), 2), "part_critique_pct": rnd(100 * sum(p["valeur_nomenclature_eur"] or 0 for p in crit) / total, 1),
               "premiere_commande": calendar[0]["commande_au_plus_tard"] if calendar else None, "premiere_commande_ref": calendar[0]["ref"] if calendar else None, "premier_besoin": min((c["date_besoin"] for c in calendar), default=None), "src": "PLM et MES"}
    return summary, abc, abc_sum, flow_rows, calendar, grid, postes, ecarts


# ---- Analyse -----------------------------------------------------------------------------------------------
def analyze(mes_bytes, plm_bytes, erp_bytes, file_names=None):
    """Point d'entree du moteur commun au dashboard et au notebook. Renvoie (analysis, identity)."""
    mes = read_mes(mes_bytes); plm = read_plm(plm_bytes); erp = read_erp(erp_bytes)
    ops, op_refs, parts, persons = mes["operations"], mes["op_refs"], plm["parts"], erp["persons"]
    parts_by_ref = {p["ref"]: p for p in parts}
    notice = _load_ref("notice_nomenclature.json")
    cad = _load_ref("cad_3dxml_index.json")
    geo_val = _load_ref("geometry_validation.json")
    meshes = map_meshes(_load_ref("geometry_manifest.json"), parts_by_ref)
    notice_by_ref = {i["ref"]: i for i in notice["nomenclature"] if i["ref"]}
    persons_by_poste = collections.defaultdict(list)
    for p in persons:
        persons_by_poste[p["poste_origine"]].append(p)

    # --- Enrichissement operations (mesures au grain operation uniquement)
    day_last = {}
    for o in ops:
        day_last[o["date"]] = o["op_id"]
    for o in ops:
        tr = o["ecart_horo_reel_s"]
        o["controle_horloge"] = "absent" if tr is None else "concordant" if tr == 0 else ("fin_tronquee_fin_de_journee" if tr < 0 and day_last.get(o["date"]) == o["op_id"] else "ecart")
        rs = [r for r in op_refs if r["op_id"] == o["op_id"]]
        known = [r for r in rs if r["ref"] in parts_by_ref]
        o["valeur_matiere_mes_eur"] = rnd(sum(r["occurrences"] * (parts_by_ref[r["ref"]]["prix_achat_eur"] or 0) for r in known), 2) if rs else None
        o["ref_manquante"] = not rs
        rates = [p["taux_horaire_eur"] for p in persons_by_poste.get(o["poste"], []) if p["taux_horaire_eur"] is not None]
        o["effectif_ref"] = len(rates)
        s = sum(rates) if rates else None
        o["valo_mo_reel_eur"] = rnd(s * o["reel_s"] / 3600, 2) if s is not None and o["reel_s"] is not None else None
        o["valo_mo_prevu_eur"] = rnd(s * o["prevu_s"] / 3600, 2) if s is not None and o["prevu_s"] is not None else None
        o["valo_mo_horo_eur"] = rnd(s * o["horo_s"] / 3600, 2) if s is not None and o["horo_s"] is not None else None
        req, why = required_skills(o["intitule"])
        o["competences_repere"] = req; o["competences_repere_regle"] = why

    # --- Journal d'evenements (2 evenements par operation), sans cas avion dans les sources
    events = []
    for o in ops:
        for life, ts, field in (("debut", o["debut"], "Heure Début"), ("fin", o["fin"], "Heure Fin")):
            events.append({"event_id": f"{o['op_id']}-{life}", "case_id": None, "op_id": o["op_id"], "poste": o["poste"], "activite": o["intitule"], "zone": o["zone"],
                           "cycle_de_vie": life, "horodatage": ts, "champ_source": field,
                           "alerte": o["controle_horloge"] if life == "fin" and o["controle_horloge"] not in ("concordant",) else None, "src": o["src"]})
    events.sort(key=lambda e: (e["horodatage"] or "", 0 if e["cycle_de_vie"] == "fin" else 1))

    # --- Flux : transitions entre operations consecutives (ordre des horodatages)
    seq = sorted(ops, key=lambda o: o["debut"] or "")
    edges = []
    for a, b in zip(seq, seq[1:]):
        same = a["date"] == b["date"]
        wait = b["debut_s"] - a["fin_s"] if same else None
        edges.append({"de": a["op_id"], "vers": b["op_id"], "de_poste": a["poste"], "vers_poste": b["poste"], "de_zone": a["zone"], "vers_zone": b["zone"],
                      "meme_jour": same, "attente_s": wait, "src": f"{a['src']};{b['src']}"})
    zone_stats = {}
    for o in seq:
        z = zone_stats.setdefault(o["zone"], {"zone": o["zone"], "n_ops": 0, "prevu_s": 0, "reel_s": 0, "postes": []})
        z["n_ops"] += 1; z["prevu_s"] += o["prevu_s"] or 0; z["reel_s"] += o["reel_s"] or 0; z["postes"].append(o["poste"])
    for z in zone_stats.values():
        z["ecart_s"] = z["reel_s"] - z["prevu_s"]; z["ratio"] = rnd(z["reel_s"] / z["prevu_s"], 4) if z["prevu_s"] else None
    zones = [zone_stats[z] for z in dict.fromkeys(o["zone"] for o in seq)]
    zone_edges = collections.Counter((e["de_zone"], e["vers_zone"]) for e in edges if e["de_zone"] != e["vers_zone"])
    overlaps = sum(1 for a, b in zip(seq, seq[1:]) if a["date"] == b["date"] and b["debut_s"] < a["fin_s"])

    # --- Rapprochement par reference (sans multiplier : une ligne par reference)
    occ = collections.Counter(); ops_of = collections.defaultdict(list)
    for r in op_refs:
        occ[r["ref"]] += r["occurrences"]; ops_of[r["ref"]].append({"op_id": r["op_id"], "poste": r["poste"], "occurrences": r["occurrences"], "src": r["src"]})
    mesh_count = collections.Counter(m["ref"] for m in meshes if m["ref"])
    recon = []
    for ref in sorted(set(parts_by_ref) | set(occ) | set(notice_by_ref)):
        p = parts_by_ref.get(ref); n = notice_by_ref.get(ref)
        qp, qn, qm = (p or {}).get("qty_nomenclature"), (n or {}).get("qty"), occ.get(ref, 0)
        status = []
        if not p:
            status.append("absente_plm")
        if not n:
            status.append("absente_notice")
        if p and n and qp != qn:
            status.append("plm_diff_notice")
        if p and qm == 0:
            status.append("absente_mes")
        elif p and qm != qp:
            status.append("mes_diff_plm")
        recon.append({"ref": ref, "designation": (p or {}).get("designation"), "qty_plm": qp, "qty_notice": qn, "occ_mes": qm, "n_ops_mes": len(ops_of.get(ref, [])),
                      "ecart_mes_plm": qm - qp if qp is not None else None, "occ_modele_3d": mesh_count.get(ref, 0), "statuts": status,
                      "src_plm": (p or {}).get("src"), "src_notice": (n or {}).get("citation")})
    recon_by = {r["ref"]: r for r in recon}
    for p in parts:
        r = recon_by[p["ref"]]
        p.update({"occ_mes": r["occ_mes"], "n_ops_mes": r["n_ops_mes"], "qty_notice": r["qty_notice"], "occ_modele_3d": r["occ_modele_3d"], "statuts": r["statuts"],
                  "src_notice": r["src_notice"], "operations": ops_of.get(p["ref"], [])})
        names = [p["ref"], f"Symétrie de {p['ref']}", f"{p['ref']} modifié", f"{p['ref']} modified"]
        cad_hits = [{"nom": k, **cad["par_nom"][k]} for k in cad["par_nom"] if k in names or k == f"Symétrie de {p['ref']} modifié"]
        p["cao_3dxml"] = cad_hits

    # --- Postes
    postes = []
    for o in seq:
        team = persons_by_poste.get(o["poste"], [])
        fit = collections.Counter(person_fit(x, o["competences_repere"]) for x in team)
        postes.append({"poste": o["poste"], "poste_id": o["poste_id"], "op_id": o["op_id"], "intitule": o["intitule"], "zone": o["zone"], "effectif_ref": len(team),
                       "profils_ref": [x["person_id"] for x in team], "competences_repere": o["competences_repere"], "regle": o["competences_repere_regle"], "fit_ref": dict(sorted(fit.items())), "src": o["src"]})
    all_fit = collections.Counter()
    for pst in postes:
        all_fit.update(pst["fit_ref"])

    # --- Couverture des jointures
    tokens = sum(r["occurrences"] for r in op_refs)
    tok_ok = sum(r["occurrences"] for r in op_refs if r["ref"] in parts_by_ref)
    op_postes = {o["poste"] for o in ops}
    rot_ok = sum(1 for r in erp["rotations"] if r["poste"] in op_postes)
    mesh_status = collections.Counter(m["status"] for m in meshes)
    joins = [
        {"jointure": "MES → PLM", "cle": "Référence (jeton de la colonne Référence)", "numerateur": tok_ok, "denominateur": tokens, "unite": "occurrences de référence",
         "sans_correspondance": sorted({r["ref"] for r in op_refs if r["ref"] not in parts_by_ref}), "note": f"{sum(o['ref_manquante'] for o in ops)} opération(s) sans référence : " + ", ".join(o["src"] for o in ops if o["ref_manquante"])},
        {"jointure": "PLM → MES", "cle": "Référence", "numerateur": sum(1 for p in parts if p["occ_mes"] > 0), "denominateur": len(parts), "unite": "références PLM",
         "sans_correspondance": [p["ref"] for p in parts if p["occ_mes"] == 0], "note": "Références de la nomenclature jamais citées dans le MES."},
        {"jointure": "PLM → Notice", "cle": "Référence exacte", "numerateur": sum(1 for p in parts if p["qty_notice"] is not None), "denominateur": len(parts), "unite": "références PLM",
         "sans_correspondance": [p["ref"] for p in parts if p["qty_notice"] is None], "note": "C984 (PLM) face à C994 (notice p.43) : écart conservé, aucun rapprochement forcé. C995 : la notice n'imprime pas de référence pour la planche d'autocollants."},
        {"jointure": "MES → ERP", "cle": "Numéro de poste", "numerateur": sum(1 for o in ops if o["poste"] in persons_by_poste), "denominateur": len(ops), "unite": "opérations",
         "sans_correspondance": [o["poste"] for o in ops if o["poste"] not in persons_by_poste], "note": "Le poste relie un intitulé d'opération à des personnes de référence. Aucune source ne dit qui a travaillé sur l'opération."},
        {"jointure": "ERP → MES", "cle": "Poste de montage", "numerateur": sum(1 for p in persons if p["poste_origine"] in op_postes), "denominateur": len(persons), "unite": "personnes",
         "sans_correspondance": [p["person_id"] for p in persons if p["poste_origine"] not in op_postes], "note": ""},
        {"jointure": "Rotations ERP → MES", "cle": "Poste de rotation", "numerateur": rot_ok, "denominateur": len(erp["rotations"]), "unite": "rotations", "sans_correspondance": [], "note": "Les semaines de rotation ne sont pas datées : elles ne sont pas rapprochées des dates MES."},
        {"jointure": "Maillage → PLM", "cle": "Nom de maillage, de nœud ou de parent", "numerateur": sum(1 for m in meshes if m["ref"]), "denominateur": len(meshes), "unite": "occurrences 3D",
         "sans_correspondance": sorted({m["mesh_name"] for m in meshes if not m["ref"]}), "note": "Statuts : " + ", ".join(f"{k} {v}" for k, v in sorted(mesh_status.items()))},
        {"jointure": "PLM → Maillage", "cle": "Référence", "numerateur": sum(1 for p in parts if p["occ_modele_3d"] > 0), "denominateur": len(parts), "unite": "références PLM",
         "sans_correspondance": [p["ref"] for p in parts if p["occ_modele_3d"] == 0], "note": "La visserie et plusieurs petites pièces ne sont pas modélisées dans la CAO fournie."},
    ]
    for j in joins:
        j["couverture_pct"] = rnd(100 * j["numerateur"] / j["denominateur"], 1) if j["denominateur"] else None

    # --- Anomalies et controles
    anomalies = []
    def anom(kind, sev, key, msg, src, **extra):
        anomalies.append({"anomalie_id": f"ANOM!{len(anomalies) + 1:03d}", "type": kind, "gravite": sev, "cle": key, "message": msg, "src": src, **extra})
    for o in ops:
        if o["controle_horloge"] not in ("concordant", "absent"):
            anom("ecart_horloge", "élevée", o["poste_id"], f"Durée issue des horodatages {hms(o['horo_s'])} contre {hms(o['reel_s'])} déclarés (écart {hms(o['ecart_horo_reel_s'])}). Fin relevée à {o['fin'][-8:]}, dernière opération de la journée, et la suivante démarre le lendemain à 08:00:00.", o["src"], ecart_s=o["ecart_horo_reel_s"])
        if o["ref_manquante"]:
            anom("reference_manquante", "moyenne", o["poste_id"], f"Colonne Référence vide alors que Nombre pièces = {o['qty']} ({o['intitule_source']}).", o["src"])
        elif o["qty"] != o["n_tokens_refs"]:
            anom("quantite_vs_references", "moyenne", o["poste_id"], f"Nombre pièces = {o['qty']} pour {o['n_tokens_refs']} références listées.", o["src"])
    weekend = sorted({o["date"] for o in ops if o["jour_semaine"] in ("samedi", "dimanche")})
    if weekend:
        anom("date_week_end", "information", "Calendrier", "Opérations datées d'un week-end : " + ", ".join(weekend) + ".", ";".join(o["src"] for o in ops if o["date"] in weekend[:1])[:40])
    zero = [e for e in edges if e["meme_jour"] and e["attente_s"] == 0]
    if zero and len(zero) == sum(e["meme_jour"] for e in edges):
        anom("attente_nulle", "information", "Horodatages", f"Les {len(zero)} transitions d'un même jour ont une attente de 0 s : chaque début égale la fin précédente.", "MES!Heure Début;Heure Fin")
    for r in recon:
        if "plm_diff_notice" in r["statuts"]:
            anom("quantite_plm_notice", "moyenne", r["ref"], f"PLM {r['qty_plm']} contre notice {r['qty_notice']}.", f"{r['src_plm']};{r['src_notice']}")
        if "absente_notice" in r["statuts"] or "absente_plm" in r["statuts"]:
            anom("reference_sans_correspondance", "moyenne", r["ref"], "Référence présente dans " + ("le PLM" if r["src_plm"] else "la notice") + " mais pas dans " + ("la notice" if r["src_plm"] else "le PLM") + ".", r["src_plm"] or r["src_notice"])
        if "mes_diff_plm" in r["statuts"]:
            anom("occurrences_mes_vs_nomenclature", "moyenne" if abs(r["ecart_mes_plm"]) > 0 else "information", r["ref"], f"{r['occ_mes']} occurrences MES contre {r['qty_plm']} en nomenclature (écart {r['ecart_mes_plm']:+d}).", r["src_plm"])
        if "absente_mes" in r["statuts"]:
            anom("reference_absente_mes", "information", r["ref"], f"Nomenclature {r['qty_plm']}, aucune occurrence MES ({r['designation']}).", r["src_plm"])
    for j in plm["junk"]:
        anom("ligne_parasite_plm", "faible", j["src"], f"Ligne exclue, ce n'est pas une référence : « {j['value']} ».", j["src"])
    if any(plm["conversions"].values()):
        anom("types_a_convertir", "faible", "PLM", "Valeurs stockées en texte puis converties : " + ", ".join(f"{k} {v}" for k, v in plm["conversions"].items() if v) + ".", f"PLM!{plm['sheet']}")
    des = collections.Counter(p["designation"] for p in parts)
    for d, c in des.items():
        if c > 1:
            anom("designation_non_unique", "information", d, f"La désignation est partagée par {c} références : elle n'est pas une clé.", f"PLM!{plm['sheet']}", refs=[p["ref"] for p in parts if p["designation"] == d])
    lab = collections.Counter(o["intitule"] for o in ops)
    for d, c in lab.items():
        if c > 1:
            anom("intitule_non_unique", "information", d, f"Intitulé porté par {c} postes : le numéro de poste est la clé.", ";".join(o["src"] for o in ops if o["intitule"] == d)[:60])
    if any(o["intitule"] != o["intitule_source"] for o in ops):
        anom("orthographe_source", "faible", "atterissage", "Intitulés MES écrits « atterissage » : affichés « atterrissage », valeur source conservée dans intitule_source.", "MES!Nom")
    pcnt = collections.Counter(p["pseudo"] for p in persons)
    homonymes = {k: v for k, v in pcnt.items() if v > 1}
    if homonymes:
        anom("pseudonymes_partages", "information", "ERP", f"{len(homonymes)} pseudonymes partagés par {sum(homonymes.values())} profils, distingués par l'identifiant interne.", f"ERP!{erp['sheet']}")
    mism = [p for p in persons if ("junior" in (p["qualification"] or "").lower()) != (p["experience"] == "Débutant")]
    if mism:
        anom("qualification_vs_experience", "faible", "ERP", f"{len(mism)} profils : mention Junior et niveau Débutant non alignés.", f"ERP!{erp['sheet']}", profils=[p["person_id"] for p in mism])
    rot_self = [r for r in erp["rotations"] if any(p["person_id"] == r["person_id"] and p["poste_origine"] == r["poste"] for p in persons)]
    if rot_self:
        anom("rotation_sur_poste_origine", "information", "ERP", f"{len(rot_self)} rotations déclarées pointent vers le poste d'origine de la personne.", f"ERP!{erp['sheet']}")
    for m in meshes:
        if m["status"] == "inferee":
            anom("lien_3d_a_verifier", "moyenne", m["occurrence_id"], m["method"], m["src"])
    if notice["contenu_p3"]["extrait_ocr"]:
        total_notice = sum(i["qty"] for i in notice["nomenclature"] if i["ref"] not in (None, "C994", "C993", "D234"))
        anom("controle_total_notice", "information", "Notice", f"Somme des quantités p.43 hors outils, boîtier et autocollants : {total_notice}. Annonce p.3 : « {notice['contenu_p3']['extrait_ocr'][:70]} ».", "NOTICE!p3!CONTENU")

    # --- Controle des colonnes pour le fil numerique
    headers = {"MES": _headers(mes_bytes), "PLM": _headers(plm_bytes), "ERP": _headers(erp_bytes)}
    thread_terms = {"Identifiant avion": r"\bmsn\b|avion|aircraft|tail", "Numéro de série": r"\bserie\b|serial", "Lot": r"\blot\b|batch", "Révision": r"revision|indice", "Stock": r"\bstock\b"}
    thread = []
    for label, pat in thread_terms.items():
        found = [f"{sys}: {h}" for sys, hs in headers.items() for h in hs if re.search(pat, norm_key(h.split(': ', 1)[1]))]
        thread.append({"attribut": label, "colonnes_trouvees": found, "statut": "présent" if found else "absent des trois classeurs",
                       "consequence": "Suivi possible" if found else f"{label} : aucun suivi ne peut être affiché. Un lien PLM–MES par référence ou MES–ERP par poste n'en tient pas lieu."})
    thread.append({"attribut": "Version CAO (3DXML)", "colonnes_trouvees": ["V_version, V_maturity"], "statut": "présent dans la CAO uniquement",
                   "consequence": f"Toutes les références CAO portent {sorted({v['version'] for v in cad['par_nom'].values()})} / {sorted({v['maturity'] for v in cad['par_nom'].values()})}. Rien ne relie cet attribut à une opération."})

    # --- KPI (tables de reference uniquement)
    cmp_ops = [o for o in ops if o["prevu_s"] is not None and o["reel_s"] is not None]
    cons_ops = [o for o in cmp_ops if o["controle_horloge"] == "concordant"]
    t_prevu = sum(o["prevu_s"] for o in cmp_ops); t_reel = sum(o["reel_s"] for o in cmp_ops)
    t_horo = sum(o["horo_s"] or 0 for o in ops)
    c_prevu = sum(o["prevu_s"] for o in cons_ops); c_reel = sum(o["reel_s"] for o in cons_ops); c_horo = sum(o["horo_s"] for o in cons_ops)
    t0, t1 = min(o["debut"] for o in ops), max(o["fin"] for o in ops)
    amp = dt.datetime.fromisoformat(t1) - dt.datetime.fromisoformat(t0)
    parts_ntools = [p for p in parts if not p["est_outillage"]]; tools = [p for p in parts if p["est_outillage"]]
    val = lambda L: rnd(sum(p["valeur_nomenclature_eur"] or 0 for p in L), 2)
    priced = sum(1 for p in parts if p["valeur_nomenclature_eur"] is not None)
    mo = lambda f: rnd(sum(o[f] or 0 for o in ops), 2)
    mo_scope = sum(1 for o in ops if o["valo_mo_reel_eur"] is not None)
    k = []
    def kpi(id_, label, value, unit, n=None, excl=None, formula="", src="", phase="DEFINE", display=None):
        k.append({"kpi_id": id_, "citation": f"KPI!{id_}", "libelle": label, "valeur": value, "unite": unit, "effectif": n, "exclusions": excl, "formule": formula, "src": src, "phase": phase,
                  "affichage": display if display is not None else (hms(value) if unit == "s" else value)})
    S = "MES!L2-L%d" % (len(ops) + 1)
    kpi("n_operations", "Opérations relevées", len(ops), "opérations", len(ops), None, "Lignes MES", S, "DISCOVER")
    kpi("prevu_total", "Temps opératoire prévu", t_prevu, "s", len(cmp_ops), None, "Somme de Temps Prévu", S)
    kpi("reel_declare_total", "Temps réel déclaré", t_reel, "s", len(cmp_ops), None, "Somme de Temps Réel", S)
    kpi("ecart_reel_prevu", "Écart réel déclaré − prévu", t_reel - t_prevu, "s", len(cmp_ops), None, "Somme des écarts sur le même ensemble", S)
    kpi("ratio_reel_prevu", "Ratio réel déclaré / prévu", rnd(t_reel / t_prevu, 4), "ratio", len(cmp_ops), None, "Réel déclaré ÷ prévu", S)
    n_horo_ex = len(ops) - len(cons_ops)
    kpi("horodatage_total", "Somme des durées issues des horodatages", t_horo, "s", len(ops), None, "Somme de Heure Fin − Heure Début", S)
    kpi("perimetre_concordant_n", "Opérations où horodatages et déclaré concordent", len(cons_ops), "opérations", len(ops), n_horo_ex, "Heure Fin − Heure Début = Temps Réel", S)
    kpi("concordant_prevu", "Prévu, périmètre concordant", c_prevu, "s", len(cons_ops), n_horo_ex, "Exclut les fins tronquées", S)
    kpi("concordant_reel", "Réel déclaré, périmètre concordant", c_reel, "s", len(cons_ops), n_horo_ex, "Exclut les fins tronquées", S)
    kpi("concordant_horo", "Horodatages, périmètre concordant", c_horo, "s", len(cons_ops), n_horo_ex, "Exclut les fins tronquées", S)
    kpi("ecart_horloge_total", "Temps déclaré non couvert par les horodatages", t_horo - t_reel, "s", len(ops), None, "Somme horodatages − somme déclaré", S)
    kpi("amplitude_releve", "Amplitude du relevé (calendaire)", int(amp.total_seconds()), "s", len(ops), None, f"Dernière fin {t1} − premier début {t0}", S, "DISCOVER", f"{amp.days} j {hms(amp.seconds)}")
    kpi("jours_releve", "Jours distincts du relevé", len({o['date'] for o in ops}), "jours", len(ops), None, "Valeurs distinctes de Date", S, "DISCOVER")
    kpi("simultanees", "Opérations simultanées observées", overlaps, "chevauchements", len(edges), None, "Début suivant < fin précédente, même jour", S, "DISCOVER")
    kpi("mes_plm_couverture", "Couverture MES → PLM", joins[0]["couverture_pct"], "%", joins[0]["denominateur"], None, "Occurrences de référence retrouvées dans le PLM", S)
    kpi("mes_erp_couverture", "Couverture MES → ERP", joins[3]["couverture_pct"], "%", joins[3]["denominateur"], None, "Opérations dont le poste existe dans l'ERP", S)
    kpi("mesh_plm_couverture", "Couverture maillage → PLM", joins[6]["couverture_pct"], "%", joins[6]["denominateur"], None, "Occurrences 3D rattachées à une référence", "CAO")
    kpi("matieres_hors_outillage", "Matières : nomenclature hors outillage", val(parts_ntools), "EUR", len(parts_ntools), None, "Somme quantité nomenclature × coût achat pièce", f"PLM!{plm['sheet']}")
    kpi("outillage", "Outillage identifié", val(tools), "EUR", len(tools), None, "Désignations commençant par Outillage", f"PLM!{plm['sheet']}")
    kpi("matieres_couverture", "Couverture des prix", rnd(100 * priced / len(parts), 1), "%", len(parts), len(parts) - priced, "Références avec quantité et prix", f"PLM!{plm['sheet']}")
    kpi("mo_prevu", "Valorisation main-d'œuvre, base prévu", mo("valo_mo_prevu_eur"), "EUR", mo_scope, len(ops) - mo_scope, "Durée prévue × somme des taux ERP du poste de référence", S)
    kpi("mo_reel", "Valorisation main-d'œuvre, base réel déclaré", mo("valo_mo_reel_eur"), "EUR", mo_scope, len(ops) - mo_scope, "Durée déclarée × somme des taux ERP du poste de référence", S)
    kpi("mo_horo", "Valorisation main-d'œuvre, base horodatages", mo("valo_mo_horo_eur"), "EUR", mo_scope, len(ops) - mo_scope, "Durée horodatée × somme des taux ERP du poste de référence", S)
    kpi("effectif_erp", "Personnes dans l'ERP", len(persons), "personnes", len(persons), None, "Lignes ERP", f"ERP!{erp['sheet']}")
    kpi("postes_a_verifier_ref", "Affectations de référence à renforcer selon la règle", all_fit.get("a_renforcer", 0), "affectations", len(persons), None, "Niveau 1 sur une compétence repère de l'intitulé", f"ERP!{erp['sheet']}")
    unavailable = [
        {"id": "lead_time", "citation": "GAP!lead_time", "libelle": "Lead time par avion", "manque": "Identifiant avion et bornes de cas. Le relevé n'indique pas à quel avion appartient chaque opération.", "substitut": "Somme des temps opératoires et amplitude du relevé"},
        {"id": "wip", "citation": "GAP!wip", "libelle": "WIP", "manque": "Identifiant de cas ou d'en-cours. Seule une séquence sans chevauchement est observée.", "substitut": "Opérations simultanées observées"},
        {"id": "variantes", "citation": "GAP!variantes", "libelle": "Variantes par cas", "manque": "Plusieurs cas identifiés. Le relevé ne contient qu'une séquence.", "substitut": "Parcours observé par opérations et zones"},
        {"id": "cout_reel_avion", "citation": "GAP!cout_reel_avion", "libelle": "Coût réel par avion", "manque": "Identifiant avion, consommation matière par avion et heures imputées.", "substitut": "Valorisation matières de nomenclature et valorisation main-d'œuvre sous hypothèse"},
        {"id": "trs", "citation": "GAP!trs", "libelle": "TRS / OEE", "manque": "Disponibilité : temps d'ouverture et durées d'arrêt. Performance : cadence théorique et quantités produites par équipement. Qualité : pièces bonnes et pièces totales.", "substitut": "Aucun. Le TRS n'est pas calculé."},
        {"id": "retouches", "citation": "GAP!retouches", "libelle": "Taux de retouche", "manque": "Opérations retouchées, motif et temps de retouche. Le « 25 % » du brief n'a pas de ligne source dans les fichiers.", "substitut": "Signalements d'aléas classés Mesure (ce n'est pas une mesure de retouche)"},
        {"id": "stock", "citation": "GAP!stock", "libelle": "Stock", "manque": "Aucune colonne de stock dans le PLM ni dans l'ERP.", "substitut": "Quantité de nomenclature et occurrences MES"},
        {"id": "gain", "citation": "GAP!gain", "libelle": "Gain d'une action", "manque": "Mesures comparables avant et après sur le même périmètre.", "substitut": "Aucun gain n'est chiffré"},
    ]

    # --- Goulots candidats
    ranked = sorted([o for o in ops if o["ecart_reel_prevu_s"] is not None], key=lambda o: -o["ecart_reel_prevu_s"])
    tot_e = sum(o["ecart_reel_prevu_s"] for o in ranked) or 1
    candidates = [{"rang": i + 1, "op_id": o["op_id"], "poste": o["poste"], "intitule": o["intitule"], "zone": o["zone"], "prevu_s": o["prevu_s"], "reel_s": o["reel_s"], "horo_s": o["horo_s"],
                   "ecart_s": o["ecart_reel_prevu_s"], "ratio": o["ratio_reel_prevu"], "part_ecart_pct": rnd(100 * o["ecart_reel_prevu_s"] / tot_e, 1), "alea": o["alea"], "cause_potentielle": o["cause_potentielle"],
                   "statut": "Dépassement à investiguer sur le terrain.", "src": o["src"]} for i, o in enumerate(ranked[:12])]

    # --- Ishikawa : classement de signaux observes
    ishikawa = []
    cats = [c for c, _ in M6_RULES] + ["Non classé"]
    for c in cats:
        items = [o for o in ops if o["m6"] == c]
        if not items and c == "Non classé":
            continue
        ishikawa.append({"categorie": c, "n_signaux": len(items), "ecart_s": sum(o["ecart_reel_prevu_s"] or 0 for o in items), "reel_s": sum(o["reel_s"] or 0 for o in items),
                         "regle": next((p for cc, p in M6_RULES if cc == c), None),
                         "signaux": [{"op_id": o["op_id"], "poste": o["poste"], "alea": o["alea"], "mot_cle": o["m6_mot_cle"], "cause_potentielle": o["cause_potentielle"], "cause_categorie_hypothese": o["m6_cause_hypothese"], "ecart_s": o["ecart_reel_prevu_s"], "src": o["src"]} for o in items]})

    # --- Fournisseurs
    sup = {}
    for p in parts:
        s = sup.setdefault(p["fournisseur"], {"fournisseur": p["fournisseur"], "refs": [], "valeur_eur": 0, "delai_max_j": 0, "criticites": collections.Counter(), "occ_mes": 0, "srcs": []})
        s["refs"].append(p["ref"]); s["valeur_eur"] = rnd(s["valeur_eur"] + (p["valeur_nomenclature_eur"] or 0), 2); s["delai_max_j"] = max(s["delai_max_j"], p["delai_max_j"] or 0)
        s["criticites"][p["criticite"]] += 1; s["occ_mes"] += p["occ_mes"]; s["srcs"].append(p["src"])
    suppliers = sorted(sup.values(), key=lambda s: -s["valeur_eur"])
    for s in suppliers:
        s["criticites"] = dict(sorted(s["criticites"].items())); s["citation"] = "SUP!" + re.sub(r"[^A-Za-z0-9]+", "_", s["fournisseur"])

    # --- Table generale documentee : une ligne par (operation, reference). Les mesures d'operation ne se somment que sur ligne_operation_1=1.
    general = []
    for o in ops:
        rs = [r for r in op_refs if r["op_id"] == o["op_id"]] or [None]
        team = persons_by_poste.get(o["poste"], [])
        for i, r in enumerate(rs):
            p = parts_by_ref.get(r["ref"]) if r else None
            general.append({"op_id": o["op_id"], "poste": o["poste"], "intitule": o["intitule"], "zone": o["zone"], "ligne_operation_1": 1 if i == 0 else 0,
                            "op_prevu_s": o["prevu_s"], "op_reel_s": o["reel_s"], "op_horo_s": o["horo_s"], "op_valo_mo_reel_eur": o["valo_mo_reel_eur"], "effectif_ref": o["effectif_ref"],
                            "profils_ref": " ".join(x["pseudo"] + "#" + x["person_id"] for x in team), "alea": o["alea"], "cause_potentielle_hypothese": o["cause_potentielle"], "m6": o["m6"],
                            "ref": r["ref"] if r else None, "occurrences_dans_operation": r["occurrences"] if r else None, "designation": p["designation"] if p else None, "fournisseur": p["fournisseur"] if p else None,
                            "prix_achat_eur": p["prix_achat_eur"] if p else None, "qty_nomenclature_ref": p["qty_nomenclature"] if p else None, "statut_jointure": ("rapprochee" if p else "ref_absente_plm") if r else "ref_manquante_mes", "src_mes": o["src"], "src_plm": p["src"] if p else None})

    kd = {x["kpi_id"]: x for x in k}
    # --- DESIGN : processus cible documente et pistes derivees par regles (pas d'IA, pas de gain)
    target = [{"ordre": i + 1, "op_id": o["op_id"], "poste": o["poste"], "intitule": o["intitule"], "duree_cible_s": o["prevu_s"], "reel_declare_s": o["reel_s"], "ecart_s": o["ecart_reel_prevu_s"], "base": "Le seul référentiel cible fourni est Temps Prévu", "src": o["src"]} for i, o in enumerate(seq)]
    leads = [{"piste_id": f"P{c['rang']:02d}", "action_a_verifier": f"Observer le poste {c['poste']} et confirmer ou écarter l'aléa déclaré « {c['alea']} ».", "cible": f"Poste {c['poste']} — {c['intitule']}", "fait": f"Déclaré {hms(c['reel_s'])}, prévu {hms(c['prevu_s'])}, écart {hms(c['ecart_s'])}.", "hypothese": c["cause_potentielle"], "mesure_a_suivre": "Temps réel du poste", "src": c["src"]} for c in candidates[:8]]

    sup_summary, sup_abc, sup_abc_sum, sup_flows, sup_calendar, sup_grid, sup_postes, sup_ecarts = build_supply(parts, ops, op_refs, suppliers, recon)

    # --- Index RAG. Aucun nom complet, aucun matricule, aucun taux individuel, aucun commentaire de carriere.
    docs = build_rag_docs(ops, op_refs, parts, persons, postes, k, unavailable, suppliers, zones, ishikawa, anomalies, notice, joins, thread, erp, sup_summary, sup_abc_sum, sup_calendar, sup_postes)

    analysis = {
        "meta": {"engine_version": ENGINE_VERSION, "phases": ["DISCOVER", "DEFINE", "DESIGN", "DELIVER"],
                 "sources": {"mes": {"fichier": (file_names or {}).get("mes", "MES_Extraction_FR.xlsx"), "onglet": mes["sheet"], "lignes": mes["rows"]},
                             "plm": {"fichier": (file_names or {}).get("plm", "PLM_DataSet_FR.xlsx"), "onglet": plm["sheet"], "onglets": plm["sheets"], "lignes": plm["rows"], "refs_autre_onglet": plm["refs_autre_onglet"]},
                             "erp": {"fichier": (file_names or {}).get("erp", "ERP_Equipes Airplus_FR.xlsx"), "onglet": erp["sheet"], "lignes": erp["rows"]}},
                 "regles": {"mobilisation": MOBILISATION, "duree_comparable": "Les durées Excel (fractions de jour) sont converties en secondes entières. Prévu et déclaré sont comparés sur les opérations où les deux existent. Les durées issues des horodatages sont comparées au déclaré et ne le remplacent jamais.",
                            "m6": [{"categorie": c, "mots_cles": p} for c, p in M6_RULES], "competences_repere": [{"motif": p, "competence": s, "raison": r} for p, s, r in SKILL_RULES],
                            "fit": {"fort": "Toutes les compétences repère au niveau 3", "intermediaire": "Compétences repère renseignées, minimum au niveau 2", "a_renforcer": "Au moins une compétence repère au niveau 1", "competence_inconnue": "Compétence repère non renseignée : ce n'est pas un niveau faible", "sans_repere": "Aucun mot de l'intitulé ne renvoie à une compétence ERP"}}},
        "kpis": k, "operations": ops, "op_refs": op_refs, "events": events, "flow_edges": edges, "zones": zones, "zone_order": ZONE_ORDER,
        "zone_edges": [{"de": a, "vers": b, "n": n} for (a, b), n in zone_edges.items()], "parts": parts, "reconciliation": recon, "suppliers": suppliers, "persons": persons, "skills": erp["skills"], "rotations": erp["rotations"],
        "postes": postes, "meshes": meshes, "joins": joins, "anomalies": anomalies, "candidates": candidates, "ishikawa": ishikawa, "headers": headers, "general": general,
        "supply": sup_summary, "supply_abc": sup_abc, "supply_abc_classes": sup_abc_sum, "supply_flows": sup_flows, "supply_calendar": sup_calendar, "supply_grid": sup_grid, "supply_postes": sup_postes, "supply_ecarts": sup_ecarts,
        "target_process": target, "leads": leads, "notice": notice, "geometry": geo_val, "rag_docs": docs,
    }
    return analysis, erp["identity"]


# ---- Documents indexes ---------------------------------------------------------------------------------------
def build_rag_docs(ops, op_refs, parts, persons, postes, kpis, unavailable, suppliers, zones, ishikawa, anomalies, notice, joins, thread, erp, sup, abc_classes, calendar, sup_postes):
    docs = []
    def add(id_, kind, title, text, **m):
        docs.append({"id": id_, "type": kind, "titre": title, "texte": text, **m})
    by_op = collections.defaultdict(list)
    for r in op_refs:
        by_op[r["op_id"]].append(f"{r['ref']}×{r['occurrences']}")
    pseudo = {p["person_id"]: p for p in persons}
    for o in ops:
        add(o["src"], "operation", f"Poste {o['poste']} — {o['intitule']}",
            f"Opération MES du poste {o['poste']}, intitulé « {o['intitule']} », zone {o['zone']}, datée du {o['date']} ({o['jour_semaine']}) de {o['debut'][-8:]} à {o['fin'][-8:]}. "
            f"Temps prévu {hms(o['prevu_s'])}, temps réel déclaré {hms(o['reel_s'])}, durée issue des horodatages {hms(o['horo_s'])} (contrôle : {o['controle_horloge']}), écart réel déclaré moins prévu {hms(o['ecart_reel_prevu_s'])}, ratio {o['ratio_reel_prevu']}. "
            f"Nombre de pièces {o['qty']}. Références : {', '.join(by_op[o['op_id']]) or 'non renseignées'}. Aléa déclaré : {o['alea']} (classement 6M {o['m6']}, mot-clé {o['m6_mot_cle']}). Cause potentielle, hypothèse non vérifiée : {o['cause_potentielle']}. Valorisation main-d'œuvre réel déclaré du poste {o['valo_mo_reel_eur']} EUR sous hypothèse de mobilisation complète.",
            poste=o["poste"])
    for p in parts:
        ops_txt = ", ".join(f"poste {x['poste']} ×{x['occurrences']}" for x in p["operations"]) or "aucune opération MES"
        add(p["src"], "piece", f"{p['ref']} — {p['designation']}",
            f"Référence PLM {p['ref']}, désignation {p['designation']}, fournisseur {p['fournisseur']}, quantité de nomenclature {p['qty_nomenclature']}, coût d'achat unitaire {p['prix_achat_eur']} EUR, valeur de nomenclature {p['valeur_nomenclature_eur']} EUR, masse {p['masse_kg']} kg, délai d'approvisionnement {p['delai_source']}, criticité {p['criticite']}, temps CAO {p['cao_h']} h. "
            f"Occurrences MES {p['occ_mes']} ({ops_txt}). Quantité notice {p['qty_notice'] if p['qty_notice'] is not None else 'non vérifiable'}. Occurrences dans le modèle 3D {p['occ_modele_3d']}.", ref=p["ref"])
    for s in suppliers:
        add(s["citation"], "fournisseur", f"Fournisseur {s['fournisseur']}",
            f"Fournisseur {s['fournisseur']} : {len(s['refs'])} références ({', '.join(s['refs'])}), valeur de nomenclature {s['valeur_eur']} EUR, délai maximal {s['delai_max_j']} jours, criticités {s['criticites']}, {s['occ_mes']} occurrences MES. Agrégat calculé depuis {s['srcs'][0]} et lignes PLM de ces références.")
    add("SUPPLY!synthese", "supply", "Synthèse supply chain", f"Supply chain : {sup['n_fournisseurs']} fournisseurs, {sup['n_refs']} références, valeur de nomenclature {sup['valeur_totale_eur']} EUR, masse {sup['masse_totale_kg']} kg. Les trois premiers fournisseurs ({', '.join(sup['top3'])}) représentent {sup['part_top3_pct']} % de la valeur. Délai maximal {sup['delai_max_j']} jours, délai moyen pondéré par la valeur {sup['delai_moyen_pondere_j']} jours. {sup['n_critiques']} références critiques, soit {sup['part_critique_pct']} % de la valeur.")
    for c in abc_classes:
        add(f"SUPPLY!classe_{c['classe']}", "supply", f"Classe ABC {c['classe']}", f"Classe {c['classe']} de l'analyse ABC sur la valeur de nomenclature : {c['n_refs']} références ({', '.join(c['refs'])}), {c['valeur_eur']} EUR, {c['part_pct']} % de la valeur.")
    if calendar:
        add("SUPPLY!retroplanning", "supply", "Rétro-planning des commandes", "Date de commande au plus tard, calculée par date de premier usage MES moins délai maximal PLM. " + "; ".join(f"{c['ref']} ({c['fournisseur']}) : commande le {c['commande_au_plus_tard']} pour le poste {c['premier_poste']} du {c['date_besoin']}" for c in calendar[:14]) + ".")
    for x in sup_postes[:12]:
        add(f"SUPPLY!poste_{x['poste']}", "supply", f"Approvisionnement du poste {x['poste']}", f"Poste {x['poste']} ({x['intitule']}) : {x['n_refs']} références, {x['n_fournisseurs']} fournisseurs, {x['n_critiques']} références critiques, délai le plus long {x['delai_max_j']} jours sur {x['ref_delai_max']} ({x['fournisseur_delai_max']}), valeur des pièces citées {x['valeur_pieces_eur']} EUR.", poste=x["poste"])
    for x in kpis:
        add(x["citation"], "kpi", x["libelle"], f"Indicateur « {x['libelle']} » : {x['affichage']} {x['unite'] if x['unite'] != 's' else ''}. Effectif {x['effectif']}, exclusions {x['exclusions']}. Calcul : {x['formule']}. Source {x['src']}.")
    for u in unavailable:
        add(u["citation"], "donnee_absente", u["libelle"], f"{u['libelle']} : non disponible. Données manquantes : {u['manque']} Substitut affiché : {u['substitut']}.")
    for z in zones:
        add("ZONE!" + re.sub(r"[^A-Za-z0-9]+", "_", z["zone"]), "zone", f"Zone {z['zone']}", f"Zone d'opérations {z['zone']} : postes {z['postes']}, {z['n_ops']} opérations, prévu {hms(z['prevu_s'])}, déclaré {hms(z['reel_s'])}, écart {hms(z['ecart_s'])}, ratio {z['ratio']}.")
    for c in ishikawa:
        add("6M!" + re.sub(r"[^A-Za-z0-9]+", "_", c["categorie"]), "6m", f"6M {c['categorie']}", f"Classement 6M {c['categorie']} : {c['n_signaux']} signaux observés, écart cumulé {hms(c['ecart_s'])}. Postes : " + ", ".join(f"{s['poste']} ({s['alea']})" for s in c["signaux"]) + ". C'est un classement de signaux par mots-clés, pas une cause démontrée.")
    for p in persons:
        add(f"ERP!{p['person_id']}", "profil", f"Profil {p['pseudo']} ({p['person_id']})",
            f"Profil pseudonymisé {p['pseudo']}, identifiant {p['person_id']}, qualification {p['qualification']}, expérience {p['experience']}, poste d'origine {p['poste_origine']}. Compétences déclarées : " + ", ".join(f"{k} niveau {v}" for k, v in sorted(p["competences"].items())) + f". Habilitations : {', '.join(p['habilitations'])}. Rotations déclarées : {p['rotations_source']}.", poste=p["poste_origine"], ligne_source=p["src"])
    for pst in postes:
        team = [pseudo[i] for i in pst["profils_ref"]]
        lv = collections.defaultdict(list)
        for t in team:
            for s, n in t["competences"].items():
                lv[s].append(n)
        add(f"POSTE!{pst['poste']}", "poste_equipe", f"Équipe du poste {pst['poste']}", f"Poste {pst['poste']} ({pst['intitule']}) : {pst['effectif_ref']} profils d'origine ({', '.join(t['pseudo'] + ' ' + t['person_id'] for t in team)}). Compétences repère issues de l'intitulé, à vérifier : {', '.join(pst['competences_repere']) or 'aucune'}. Résultat de la règle : {pst['fit_ref']}. Niveaux déclarés par compétence : " + "; ".join(f"{s} {sorted(v)}" for s, v in sorted(lv.items())) + ".", poste=pst["poste"])
    for a in anomalies:
        add(a["anomalie_id"], "controle", f"Contrôle {a['type']} — {a['cle']}", f"Contrôle {a['type']}, gravité {a['gravite']}, sur {a['cle']} : {a['message']} Source {a['src']}.")
    for i in notice["nomenclature"]:
        add(i["citation"], "notice", f"Notice p.{i['page']} {i['ref'] or 'autocollants'}", f"Nomenclature de la notice Meccano, page {i['page']}, zone {i['bbox_pt']} : {i['ref'] or 'sans référence imprimée'} ×{i['qty']}, repère visuel {i['repere_visuel']}.")
    add(notice["contenu_p3"]["citation"], "notice", "Notice p.3 contenu", f"Page 3, offset {notice['contenu_p3']['offset_texte']} : {notice['contenu_p3']['extrait_ocr']}")
    for j in joins:
        add("JOIN!" + re.sub(r"[^A-Za-z0-9]+", "_", j["jointure"]), "jointure", f"Jointure {j['jointure']}", f"Jointure {j['jointure']} par {j['cle']} : {j['numerateur']}/{j['denominateur']} {j['unite']}, soit {j['couverture_pct']} %. Sans correspondance : {j['sans_correspondance']}. {j['note']}")
    for t in thread:
        add("FIL!" + re.sub(r"[^A-Za-z0-9]+", "_", t["attribut"]), "fil_numerique", f"Fil numérique {t['attribut']}", f"{t['attribut']} : {t['statut']}. {t['consequence']}")
    return docs
