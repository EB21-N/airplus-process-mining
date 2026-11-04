#!/usr/bin/env python3
"""Outil de BUILD : prepare les references integrees (notice et 3DXML). Non requis a l'execution.

Usage : python build_reference.py <notice.pdf> <fichier.3dxml> <dossier_reference>
Dependance de build : pymupdf.

La nomenclature p.43 de la notice est un scan avec OCR imparfait (ex. 'poss' pour D088, '0234' pour D234, 'x11'
pour x1). La valeur retenue est une transcription relue visuellement sur la page rendue ; le texte OCR brut et
sa zone (bbox en points PDF) sont conserves pour la provenance.
"""
import json, os, re, sys, zipfile
import xml.etree.ElementTree as ET
import pymupdf

# Transcription visuelle de la page 43 (reference, quantite, repere visuel de la vignette)
NOTICE_P43 = [
    ("D119", 1, "coiffe de nez"), ("D120", 1, "coiffe de nez"), ("D145", 1, "demi-coque arriere"), ("D144", 1, "demi-coque arriere"),
    ("D142", 4, "demi-coque nacelle"), ("D088", 6, "demi-coque fuselage"), ("D122", 2, "plaque perforee"), ("D278", 1, "plaque triangulaire"),
    ("D116", 2, "plaque triangulaire"), ("D117", 2, "plaque triangulaire"), ("D234", 1, "boitier electronique"), ("A018", 5, "axe 25 mm"),
    ("A415", 8, "bande perforee"), ("A413", 4, "bande perforee"), ("A235", 6, "bande perforee"), ("A417", 6, "bande perforee"),
    ("C769", 1, "bande perforee"), ("C775", 2, "bande coudee"), ("A437", 4, "equerre"), ("A416", 1, "bande"), ("C768", 5, "bande perforee"),
    ("A806", 13, "bande courte"), ("C483", 2, "equerre"), ("C330", 4, "equerre"), ("A012", 2, "equerre"), ("A423", 2, "support de train"),
    ("A247", 2, "vis B1 14,7 mm"), ("A511", 29, "vis S2 9,5 mm"), ("A637", 56, "vis S1 5,8 mm"), ("D005", 10, "rivet"), ("A337", 73, "ecrou carre"),
    ("D277", 12, "ecrou"), ("A138", 8, "rondelle"), ("A623", 10, "roue"), ("A238", 2, "entretoise"), ("A259", 12, "entretoise"), ("D010", 4, "agrafe"),
    ("C994", 1, "tournevis"), ("C993", 1, "cle de serrage"),
]
OCR_ALIASES = {"D088": ["poss"], "D234": ["0234"], "D277": ["0277"], "A138": ["A188"]}


def build_notice(pdf):
    doc = pymupdf.open(pdf)
    words = doc[42].get_text("words")
    items = []
    for ref, qty, visu in NOTICE_P43:
        keys = [ref.lower()] + [a.lower() for a in OCR_ALIASES.get(ref, [])]
        hit = next((i for i, w in enumerate(words) if w[4].lower() in keys), None)
        ocr, bbox = None, None
        if hit is not None:
            w = words[hit]; nxt = words[hit + 1] if hit + 1 < len(words) else None
            ocr = w[4] + (" " + nxt[4] if nxt else "")
            x1 = nxt[2] if nxt else w[2]; y1 = max(w[3], nxt[3]) if nxt else w[3]
            bbox = [round(w[0], 1), round(w[1], 1), round(x1, 1), round(y1, 1)]
        items.append({"ref": ref, "qty": qty, "repere_visuel": visu, "page": 43, "bbox_pt": bbox, "ocr_brut": ocr,
                      "citation": f"NOTICE!p43!{ref}", "lecture": "transcription visuelle, OCR conserve"})
    items.append({"ref": None, "qty": 1, "repere_visuel": "planche d'autocollants (aucune reference imprimee)", "page": 43, "bbox_pt": None,
                  "ocr_brut": None, "citation": "NOTICE!p43!AUTOCOLLANTS", "lecture": "transcription visuelle"})
    p3 = doc[2].get_text()
    m = re.search(r"FR\.\s*Contenu\s*:\s*([^\n]+)", p3)
    excerpt = m.group(0).replace("\n", " ").strip() if m else None
    offset = m.start() if m else None
    return {"document": "meccano dreamliner.pdf", "pages": doc.page_count, "nomenclature": items,
            "contenu_p3": {"citation": "NOTICE!p3!CONTENU", "page": 3, "offset_texte": offset, "extrait_ocr": excerpt},
            "exemple_etape_poste": {"citation": "NOTICE!p12!ETAPE10", "page": 12,
                                    "constat": "Etape 10 de la notice relue visuellement : 2 bandes longues, 1 bande 5 trous, 2 bandes courtes, 1 vis S2, 2 vis S1, 3 ecrous, 1 plaque triangulaire, soit 12 pieces.",
                                    "statut": "Comparaison ponctuelle. La correspondance generale etape/poste n'est pas documentee."}}


def build_3dxml(path):
    z = zipfile.ZipFile(path); root = ET.fromstring(z.read("PRODUCT.3dxml"))
    x = "{http://www.3ds.com/xsd/3DXML}"
    refs = {}
    for r in root.iter(x + "Reference3D"):
        refs[r.get("id")] = {"name": r.findtext(x + "V_Name"), "version": r.findtext(x + "V_version"), "maturity": r.findtext(x + "V_maturity")}
    counts = {}
    for i in root.iter(x + "Instance3D"):
        counts[i.findtext(x + "IsInstanceOf")] = counts.get(i.findtext(x + "IsInstanceOf"), 0) + 1
    index = {}
    for rid, r in refs.items():
        e = index.setdefault(r["name"], {"version": r["version"], "maturity": r["maturity"], "instances": 0})
        e["instances"] += counts.get(rid, 0)
    return {"source": "Projet_Innovation_4_All_STEP_A.3dxml (PRODUCT.3dxml)", "references": len(refs),
            "instances": sum(counts.values()),
            "note": "Version et maturite du modele CAO. Ces attributs ne relient ni un avion, ni un lot, ni une operation MES.",
            "par_nom": dict(sorted(index.items()))}


if __name__ == "__main__":
    pdf, xml, out = sys.argv[1:4]
    os.makedirs(out, exist_ok=True)
    n = build_notice(pdf); c = build_3dxml(xml)
    json.dump(n, open(os.path.join(out, "notice_nomenclature.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(c, open(os.path.join(out, "cad_3dxml_index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("sans bbox:", [i["ref"] for i in n["nomenclature"] if not i["bbox_pt"]])
    print("somme qte notice hors outils/autocollants:", sum(i["qty"] for i in n["nomenclature"] if i["ref"] not in (None, "C994", "C993")))
    print(n["contenu_p3"]); print(c["references"], c["instances"])
