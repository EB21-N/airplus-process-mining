"""Lecture, nettoyage et normalisation des trois classeurs. Chaque fait garde sa provenance (fichier, onglet, ligne)."""
import hashlib
import hmac
import io
import re

import openpyxl

from .common import WEEKDAYS, clean, norm_key, rnd, to_clock, to_date, to_float, to_int, to_seconds

REF_RE = re.compile(r"^[A-Z]\d{3}$")


class SourceError(ValueError):
    """Fichier non conforme : message destine a l'utilisateur."""


def _open(data, label):
    try:
        return openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    except Exception as e:
        raise SourceError(f"{label} : classeur Excel illisible ({e.__class__.__name__}).")


def _table(ws, required, label):
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise SourceError(f"{label} : onglet {ws.title!r} vide.")
    head = {norm_key(h): i for i, h in enumerate(rows[0]) if h is not None}
    missing = [k for k in required.values() if k not in head]
    if missing:
        raise SourceError(f"{label} : colonnes absentes dans {ws.title!r} : {', '.join(missing)}.")
    idx = {k: head[v] for k, v in required.items()}
    out = []
    for n, r in enumerate(rows[1:], 2):
        if all(c is None for c in r):
            continue
        out.append((n, {k: (r[i] if i < len(r) else None) for k, i in idx.items()}))
    return out


def _find_sheet(wb, required, label):
    for ws in wb.worksheets:
        first = next(ws.iter_rows(values_only=True, max_row=1), ())
        head = {norm_key(h) for h in first if h is not None}
        if set(required.values()) <= head:
            return ws
    raise SourceError(f"{label} : aucun onglet ne contient les colonnes attendues ({', '.join(required.values())}).")


# ---- Regles documentees ----------------------------------------------------------------------------------
ZONE_RULES = [
    (r"stickers", "Marquage"), (r"faisceaux|lumieres|bout ailes", "Finition ailes"),
    (r"train atterissage gauche|aile gauche avion", "Train gauche"), (r"train atterissage droit|aile droit avion", "Train droit"),
    (r"aile gauche", "Aile gauche"), (r"aile droite", "Aile droite"), (r"reacteurs", "Reacteurs"), (r"cockpit", "Cockpit"),
    (r"queue", "Queue"), (r"fuselage centrale", "Fuselage central"), (r"train|moteur|visserie", "Train avant et liaisons"),
]
ZONE_ORDER = ["Train avant et liaisons", "Fuselage central", "Queue", "Cockpit", "Aile gauche", "Reacteurs", "Train gauche", "Aile droite", "Train droit", "Finition ailes", "Marquage"]
ZONE_LABEL = {"Reacteurs": "Réacteurs"}

M6_RULES = [
    ("Mesure", r"controle qualite|systeme controle|calibration|etalonnage"),
    ("Milieu", r"temperature|ventilation|contamination|variations|vibrations|thermique|pression"),
    ("Méthode", r"synchronisation|desynchronisation|tracabilite|referencement|communication|maintenance|protocoles|processus|parametres|positionnement|placement"),
    ("Matière", r"lubrification|deformation|adherence|connectique|materiaux|matiere"),
    ("Main-d'œuvre", r"manutention|formation"),
    ("Machine", r"outillage|machine|usure|logiciel|robot|panne|reseau|refroidissement|guidage|transport|surchauffe|electrique|systemes|impression"),
]
SKILL_RULES = [
    (r"assemblage", "Assemblage", "« assemblage » dans l'intitulé"),
    (r"montage", "Montage mécanique", "« montage » dans l'intitulé"),
    (r"visserie", "Montage mécanique", "« visserie » dans l'intitulé"),
    (r"fixation", "Montage mécanique", "« fixation » dans l'intitulé"),
    (r"faisceaux|electrique|lumieres", "Montage électrique", "« faisceaux / électrique / lumières » dans l'intitulé"),
]


def zone_of(label):
    k = norm_key(label)
    for pat, z in ZONE_RULES:
        if re.search(pat, k):
            return ZONE_LABEL.get(z, z)
    return "Non classé"


def classify_6m(text):
    k = norm_key(text)
    for cat, pat in M6_RULES:
        m = re.search(pat, k)
        if m:
            return cat, m.group(0)
    return "Non classé", None


def normalized_label(s):
    return re.sub(r"\batterissage\b", "atterrissage", str(s or "").strip())


# ---- MES ---------------------------------------------------------------------------------------------------
def read_mes(data):
    wb = _open(data, "MES")
    req = {"poste": "poste", "nom": "nom", "qty": "nombre pieces", "refs": "reference", "prevu": "temps prevu", "date": "date",
           "start": "heure debut", "end": "heure fin", "reel": "temps reel", "alea": "aleas industriels", "cause": "cause potentielle"}
    ws = _find_sheet(wb, req, "MES")
    ops, op_refs = [], []
    for line, r in _table(ws, req, "MES"):
        poste = to_int(r["poste"])
        src = f"MES!L{line}"
        date = to_date(r["date"]); b = to_clock(r["start"]); e = to_clock(r["end"])
        prevu, reel = to_seconds(r["prevu"]), to_seconds(r["reel"])
        horo = e - b if b is not None and e is not None and e >= b else None
        tokens = [t.strip() for t in str(r["refs"]).split(";") if t.strip()] if r["refs"] is not None else []
        ops.append({
            "op_id": f"OP{poste:02d}" if poste is not None else f"OPL{line}", "poste": poste, "poste_id": f"Poste {poste}",
            "intitule_source": clean(r["nom"]), "intitule": normalized_label(r["nom"]), "zone": zone_of(r["nom"]),
            "date": date.isoformat() if date else None, "jour_semaine": WEEKDAYS[date.weekday()] if date else None,
            "debut": f"{date.isoformat()}T{_c(b)}" if date and b is not None else None,
            "fin": f"{date.isoformat()}T{_c(e)}" if date and e is not None else None,
            "debut_s": b, "fin_s": e, "prevu_s": prevu, "reel_s": reel, "horo_s": horo,
            "ecart_reel_prevu_s": reel - prevu if reel is not None and prevu is not None else None,
            "ratio_reel_prevu": rnd(reel / prevu, 4) if reel is not None and prevu else None,
            "ecart_horo_reel_s": horo - reel if horo is not None and reel is not None else None,
            "qty": to_int(r["qty"]), "refs_source": clean(r["refs"]), "n_tokens_refs": len(tokens), "n_refs_distinctes": len(set(tokens)),
            "alea": clean(r["alea"]), "cause_potentielle": clean(r["cause"]), "src": src,
        })
        counts = {}
        for pos, t in enumerate(tokens, 1):
            c = counts.setdefault(t, {"occ": 0, "pos": []}); c["occ"] += 1; c["pos"].append(pos)
        for ref, c in counts.items():
            op_refs.append({"op_id": ops[-1]["op_id"], "poste": poste, "ref": ref, "occurrences": c["occ"], "positions": c["pos"], "src": src})
    if not ops:
        raise SourceError("MES : aucune operation.")
    for o in ops:
        o["m6"], o["m6_mot_cle"] = classify_6m(o["alea"])
        o["m6_cause_hypothese"], o["m6_cause_mot_cle"] = classify_6m(o["cause_potentielle"])
    return {"sheet": ws.title, "rows": len(ops), "operations": ops, "op_refs": op_refs}


def _c(s):
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


# ---- PLM ---------------------------------------------------------------------------------------------------
def read_plm(data):
    wb = _open(data, "PLM")
    req = {"ref": "code reference", "des": "designation", "qty": "quantite", "sup": "fournisseur", "lead": "delai approvisionnement",
           "crit": "criticite", "mass": "masse kg", "price": "cout achat piece", "cao": "temps cao h"}
    ws = _find_sheet(wb, req, "PLM")
    parts, junk, conversions = [], [], {"masse_texte": 0, "prix_texte": 0, "qte_texte": 0, "cao_texte": 0}
    for line, r in _table(ws, req, "PLM"):
        ref = clean(r["ref"])
        src = f"PLM!{ws.title}!L{line}"
        if not ref or not REF_RE.match(ref):
            junk.append({"sheet": ws.title, "line": line, "value": str(ref)[:80], "src": src})
            continue
        lead = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*jours?\s*", str(r["lead"] or ""))
        for k, f in (("masse_texte", "mass"), ("prix_texte", "price"), ("qte_texte", "qty"), ("cao_texte", "cao")):
            conversions[k] += isinstance(r[f], str)
        price = to_float(r["price"]); qty = to_int(r["qty"]); des = clean(r["des"])
        parts.append({"ref": ref, "designation": des, "qty_nomenclature": qty, "fournisseur": clean(r["sup"]),
                      "delai_source": clean(r["lead"]), "delai_min_j": int(lead[1]) if lead else None, "delai_max_j": int(lead[2]) if lead else None,
                      "criticite": clean(r["crit"]), "masse_kg": to_float(r["mass"]), "prix_achat_eur": price, "cao_h": to_float(r["cao"]),
                      "est_outillage": bool(des and des.lower().startswith("outillage")),
                      "valeur_nomenclature_eur": rnd(qty * price, 2) if qty is not None and price is not None else None, "src": src})
    if not parts:
        raise SourceError("PLM : aucune reference valide.")
    # Autres onglets : reperer ceux qui repetent Code / Designation / Temps CAO
    cao2 = {}
    for other in wb.worksheets:
        if other.title == ws.title:
            continue
        rows = list(other.iter_rows(values_only=True))
        if not rows:
            continue
        head = {norm_key(h): i for i, h in enumerate(rows[0]) if h is not None}
        if "code reference" not in head:
            continue
        for n, row in enumerate(rows[1:], 2):
            code = clean(row[head["code reference"]])
            if code is None:
                continue
            if REF_RE.match(code):
                cao2[code] = {"cao_h": to_float(row[head["temps cao h"]]) if "temps cao h" in head else None,
                              "designation": clean(row[head["designation"]]) if "designation" in head else None, "src": f"PLM!{other.title}!L{n}"}
            else:
                junk.append({"sheet": other.title, "line": n, "value": code[:80], "src": f"PLM!{other.title}!L{n}"})
    for p in parts:
        o = cao2.get(p["ref"])
        p["cao_h_autre_onglet"] = o["cao_h"] if o else None
        p["src_autre_onglet"] = o["src"] if o else None
        p["cao_concordant"] = (o["cao_h"] == p["cao_h"] and o["designation"] == p["designation"]) if o else None
    seen = {}
    for p in parts:
        seen[p["ref"]] = seen.get(p["ref"], 0) + 1
    return {"sheet": ws.title, "sheets": [w.title for w in wb.worksheets], "rows": len(parts), "parts": parts, "junk": junk,
            "conversions": conversions, "duplicates": [k for k, v in seen.items() if v > 1], "refs_autre_onglet": len(cao2)}


# ---- ERP ---------------------------------------------------------------------------------------------------
def read_erp(data):
    wb = _open(data, "ERP")
    req = {"mat": "matricule", "prenom": "prenom", "nom": "nom", "qual": "qualification", "poste": "poste de montage",
           "desc": "description du poste", "comp": "competences", "hab": "habilitations", "rate": "cout horaire", "exp": "niveau d experience",
           "rot": "rotation", "career": "commentaire de carriere"}
    ws = _find_sheet(wb, req, "ERP")
    rows = _table(ws, req, "ERP")
    if not rows:
        raise SourceError("ERP : aucune personne.")
    # Secret derive du contenu nominatif : non publie, donc id internes non reversibles sans le fichier source.
    secret = hashlib.sha256("|".join(f"{r['mat']}:{r['prenom']}:{r['nom']}" for _, r in rows).encode("utf-8")).digest()
    names = sorted({str(r[k]).strip() for _, r in rows for k in ("prenom", "nom") if r[k]}, key=len, reverse=True)
    persons, skills, rotations, identity, bad_comp, redacted = [], [], [], {}, [], 0
    for line, r in rows:
        mat = clean(r["mat"]); prenom = clean(r["prenom"]) or ""; nom = clean(r["nom"]) or ""
        pid = "PX" + hmac.new(secret, str(mat).encode("utf-8"), hashlib.sha256).hexdigest()[:6].upper()
        pseudo = f"{prenom}.{nom[:1].upper()}" if prenom else f"Profil.{pid[-3:]}"
        identity[pid] = {"nom_complet": f"{prenom} {nom}".strip(), "matricule": mat}
        src = f"ERP!{ws.title}!L{line}"
        m = re.search(r"(\d+)", str(r["poste"] or ""))
        poste = int(m[1]) if m else None
        comp = {}
        for c in str(r["comp"] or "").split(","):
            c = c.strip()
            if not c:
                continue
            mm = re.fullmatch(r"(.+?) Niveau (\d)", c)
            if mm:
                comp[mm[1]] = int(mm[2])
                skills.append({"person_id": pid, "competence": mm[1], "niveau": int(mm[2]), "src": src})
            else:
                bad_comp.append({"person_id": pid, "value": c, "src": src})
        for w, pst in re.findall(r"Semaine\s*(\d+)\s*:\s*Poste\s*(\d+)", str(r["rot"] or "")):
            rotations.append({"person_id": pid, "semaine": int(w), "poste": int(pst), "src": src})
        career = clean(r["career"])
        if career:
            new = career
            for n in names:
                new = re.sub(rf"(?<![\w-]){re.escape(n)}(?![\w-])", "[nom masqué]", new)
            redacted += new != career
            career = new
        rate = to_float(r["rate"])
        persons.append({"person_id": pid, "pseudo": pseudo, "qualification": clean(r["qual"]), "experience": clean(r["exp"]), "poste_origine": poste,
                        "description_poste": clean(r["desc"]), "competences": comp,
                        "habilitations": [h.strip() for h in str(r["hab"] or "").split(",") if h.strip()],
                        "taux_horaire_eur": rate, "rotations_source": clean(r["rot"]), "commentaire_carriere": career, "src": src})
    persons.sort(key=lambda p: (p["poste_origine"] or 0, p["src"]))
    return {"sheet": ws.title, "rows": len(rows), "persons": persons, "skills": skills, "rotations": rotations, "identity": identity,
            "bad_competences": bad_comp, "redacted_comments": redacted}


def person_fit(person, required):
    """Regle lisible. Le rapprochement repose sur les mots de l'intitule MES : c'est un repere a verifier."""
    if not required:
        return "sans_repere"
    lv = [person["competences"].get(s) for s in required]
    if any(x == 1 for x in lv):
        return "a_renforcer"
    if any(x is None for x in lv):
        return "competence_inconnue"
    return "fort" if min(lv) == 3 else "intermediaire"


def required_skills(label):
    k = norm_key(label); out, why = [], []
    for pat, skill, reason in SKILL_RULES:
        if re.search(pat, k) and skill not in out:
            out.append(skill); why.append(reason)
    return out, why
