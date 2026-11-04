#!/usr/bin/env python3
"""Reconstruit le maillage de l'avion a partir du STEP fourni (outil de BUILD, jamais requis a l'execution).

Pourquoi : le glTF fourni reference un fichier `Boeing 787 A_.bin` absent de la livraison. Ses accessors
ne contiennent que des bornes min/max, pas de sommets. Le STEP contient la B-Rep complete : on le
tessellise avec Open CASCADE (meme generateur que le glTF : "Open CASCADE Technology") puis on controle
le resultat contre les bornes du glTF fourni.

Usage : python build_geometry.py <fichier.stp> <fichier.gltf> <dossier_assets>
Dependances de build : cadquery-ocp, numpy.
Sorties : aircraft.glb (1 primitive par maillage), geometry_manifest.json, geometry_validation.json.
"""
import json, os, struct, sys, tempfile
import numpy as np
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString, TCollection_AsciiString
from OCP.XCAFApp import XCAFApp_Application
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.IFSelect import IFSelect_RetDone
from OCP.RWGltf import RWGltf_CafWriter, RWGltf_WriterTrsfFormat
from OCP.OCP.collections import IndexedDataMap_TCollection_AsciiString_TCollection_AsciiString as InfoMap
from OCP.Message import Message_ProgressRange
from OCP.OCP.collections import Sequence_TDF_Label as TDF_LabelSequence
from OCP.RWMesh import RWMesh_CoordinateSystem

LINEAR_DEFLECTION = 0.1  # millimetres (unite interne du document STEP)
ANGULAR_DEFLECTION = 0.5


def tessellate(step_path, glb_path):
    app = XCAFApp_Application.GetApplication_s()
    doc = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
    app.NewDocument(TCollection_ExtendedString("BinXCAF"), doc)
    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True); reader.SetColorMode(True); reader.SetLayerMode(True)
    if reader.ReadFile(step_path) != IFSelect_RetDone:
        raise SystemExit("Lecture STEP impossible")
    reader.Transfer(doc, Message_ProgressRange())
    tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    labels = TDF_LabelSequence(); tool.GetFreeShapes(labels)
    for i in range(1, labels.Length() + 1):
        BRepMesh_IncrementalMesh(tool.GetShape_s(labels.Value(i)), LINEAR_DEFLECTION, False, ANGULAR_DEFLECTION, True)
    w = RWGltf_CafWriter(TCollection_AsciiString(glb_path), True)
    w.SetTransformationFormat(RWGltf_WriterTrsfFormat.RWGltf_WriterTrsfFormat_TRS)
    w.ChangeCoordinateSystemConverter().SetInputLengthUnit(0.001)
    w.ChangeCoordinateSystemConverter().SetInputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)
    if not w.Perform(doc, InfoMap(), Message_ProgressRange()):
        raise SystemExit("Ecriture glTF impossible")


def read_glb(path):
    b = open(path, "rb").read()
    _, _, total = struct.unpack_from("<III", b, 0)
    jl, _ = struct.unpack_from("<II", b, 12)
    g = json.loads(b[20:20 + jl].decode("utf-8"))
    off = 20 + jl
    bl, _ = struct.unpack_from("<II", b, off)
    return g, b[off + 8:off + 8 + bl]


def accessor(g, bin_, i):
    a = g["accessors"][i]; v = g["bufferViews"][a["bufferView"]]
    comp = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a["componentType"]]
    n = {"VEC3": 3, "SCALAR": 1}[a["type"]]
    data = np.frombuffer(bin_, comp, a["count"] * n, v.get("byteOffset", 0) + a.get("byteOffset", 0))
    return data.reshape(-1, 3) if n == 3 else data


def merge(g, bin_, out_path):
    """Fusionne les primitives (une par face B-Rep) en une primitive par maillage : un seul appel de rendu par piece."""
    blobs = []; views = []; accs = []; meshes = []; pos_off = 0; remap = {}
    def add(arr, target, comp, typ, mm=False):
        nonlocal pos_off
        raw = arr.tobytes(); pad = (4 - len(raw) % 4) % 4
        views.append({"buffer": 0, "byteOffset": pos_off, "byteLength": len(raw), "target": target})
        blobs.append(raw + b"\0" * pad)
        acc = {"bufferView": len(views) - 1, "componentType": comp, "count": len(arr), "type": typ}
        if mm:
            acc["min"] = [float(x) for x in arr.min(axis=0)]; acc["max"] = [float(x) for x in arr.max(axis=0)]
        accs.append(acc); pos_off += len(raw) + pad
        return len(accs) - 1
    for mesh_idx, m in enumerate(g["meshes"]):
        P, N, I = [], [], []; base = 0
        for pr in m["primitives"]:
            if pr.get("mode", 4) != 4:  # OCCT ecrit aussi les aretes (LINES) et sommets (POINTS) : seuls les triangles sont gardes
                continue
            p = accessor(g, bin_, pr["attributes"]["POSITION"])
            ix = accessor(g, bin_, pr["indices"]).astype(np.uint32)
            if "NORMAL" in pr["attributes"]:
                n = accessor(g, bin_, pr["attributes"]["NORMAL"])
            else:  # certaines faces sont ecrites sans normales : calcul par moyenne des triangles de la face
                t = ix.reshape(-1, 3); fn = np.cross(p[t[:, 1]] - p[t[:, 0]], p[t[:, 2]] - p[t[:, 0]])
                n = np.zeros_like(p, dtype=np.float64)
                for k in range(3):
                    np.add.at(n, t[:, k], fn)
                n = (n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-30)).astype(np.float32)
            P.append(p); N.append(n); I.append(ix + base); base += len(p)
        if not P:  # maillage purement filaire (esquisses "COMPOUND" du STEP) : aucune surface a afficher
            continue
        remap[mesh_idx] = len(meshes)
        P = np.concatenate(P); N = np.concatenate(N); I = np.concatenate(I).astype(np.uint32)
        meshes.append({"name": m.get("name", ""), "primitives": [{
            "attributes": {"POSITION": add(P, 34962, 5126, "VEC3", True), "NORMAL": add(N, 34962, 5126, "VEC3")},
            "indices": add(I, 34963, 5125, "SCALAR"), "material": 0, "mode": 4}]})
    for n in g["nodes"]:
        if "mesh" in n:
            if n["mesh"] in remap:
                n["mesh"] = remap[n["mesh"]]
            else:
                del n["mesh"]
    payload = b"".join(blobs)
    out = {"asset": {"version": "2.0", "generator": "Air+ build_geometry.py (Open CASCADE, source: STEP fourni)"},
           "scene": 0, "scenes": g["scenes"], "nodes": g["nodes"], "meshes": meshes,
           "materials": [{"name": "neutre", "doubleSided": True,
                          "pbrMetallicRoughness": {"baseColorFactor": [.72, .72, .72, 1], "metallicFactor": .1, "roughnessFactor": .65}}],
           "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(payload)}]}
    js = json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(payload)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total)); f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(payload), 0x004E4942)); f.write(payload)
    return out


def trs(n):
    m = np.eye(4)
    if "matrix" in n:
        return np.array(n["matrix"]).reshape(4, 4).T
    x, y, z, w = n.get("rotation", [0, 0, 0, 1])
    r = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    m[:3, :3] = r * np.array(n.get("scale", [1, 1, 1])); m[:3, 3] = n.get("translation", [0, 0, 0])
    return m


def walk(g, get_bounds):
    """Parcours de l'arbre : une entree par occurrence maillee, avec son chemin d'assemblage."""
    rows = []
    def rec(idx, path, M):
        n = g["nodes"][idx]; name = n.get("name", ""); M2 = M @ trs(n); p = path + [name]
        if "mesh" in n and n["mesh"] >= len(g["meshes"]):
            print("glTF incoherent: noeud", idx, repr(name), "reference le maillage", n["mesh"], "sur", len(g["meshes"]))
        elif "mesh" in n:
            mn, mx = get_bounds(n["mesh"])
            corners = np.array([[a, b, c, 1] for a in (mn[0], mx[0]) for b in (mn[1], mx[1]) for c in (mn[2], mx[2])])
            w = (M2 @ corners.T).T[:, :3]
            rows.append({"node_index": idx, "node_name": name, "mesh_index": n["mesh"], "mesh_name": g["meshes"][n["mesh"]].get("name", ""),
                         "assembly_path": p, "world_bbox_min": [round(float(x), 6) for x in w.min(0)], "world_bbox_max": [round(float(x), 6) for x in w.max(0)]})
        for c in n.get("children", []):
            rec(c, p, M2)
    for r in g["scenes"][0]["nodes"]:
        rec(r, [], np.eye(4))
    return rows


def main(step, gltf, outdir):
    os.makedirs(outdir, exist_ok=True)
    with tempfile.TemporaryDirectory() as t:
        raw = os.path.join(t, "raw.glb")
        tessellate(step, raw)
        g, bin_ = read_glb(raw)
        merged = merge(g, bin_, os.path.join(outdir, "aircraft.glb"))
    def bounds(i):
        a = merged["accessors"][merged["meshes"][i]["primitives"][0]["attributes"]["POSITION"]]
        return np.array(a["min"]), np.array(a["max"])
    rows = walk(merged, bounds)
    # Controle contre le glTF fourni, maillage par maillage dans l'ordre du fichier :
    # ses noeuds ne sont pas exploitables tels quels (2 noeuds y pointent vers un maillage inexistant).
    ref = json.load(open(gltf, encoding="utf-8"))
    broken = [{"node": n.get("name"), "mesh": n["mesh"]} for n in ref["nodes"] if "mesh" in n and n["mesh"] >= len(ref["meshes"])]
    def ref_bounds(i):
        mins = [ref["accessors"][p["attributes"]["POSITION"]]["min"] for p in ref["meshes"][i]["primitives"]]
        maxs = [ref["accessors"][p["attributes"]["POSITION"]]["max"] for p in ref["meshes"][i]["primitives"]]
        return np.min(mins, axis=0), np.max(maxs, axis=0)
    diffs = []
    for i, (a, b) in enumerate(zip(merged["meshes"], ref["meshes"])):
        (mn, mx), (rmn, rmx) = bounds(i), ref_bounds(i)
        d = max(float(np.abs(mn - rmn).max()), float(np.abs(mx - rmx).max()))
        diffs.append({"mesh": i, "name": a["name"], "ref_name": b.get("name", ""), "max_abs_diff_m": round(d, 7)})
    tris = sum(merged["accessors"][m["primitives"][0]["indices"]]["count"] for m in merged["meshes"]) // 3
    val = {"source_step": os.path.basename(step), "source_gltf": os.path.basename(gltf),
           "missing_in_delivery": "Boeing 787 A_.bin (reference par le glTF, absent)",
           "tessellation": {"linear_deflection_mm": LINEAR_DEFLECTION, "angular_deflection_rad": ANGULAR_DEFLECTION},
           "gltf_reference": {"nodes": len(ref["nodes"]), "meshes": len(ref["meshes"]), "noeuds_vers_maillage_inexistant": broken},
           "glb_produit": {"nodes": len(merged["nodes"]), "meshes": len(merged["meshes"]), "occurrences_maillees": len(rows), "triangles": int(tris)},
           "maillages_compares": len(diffs),
           "ecart_max_bbox_m": max((d["max_abs_diff_m"] for d in diffs), default=None),
           "maillages_ecart_sup_0_1mm": [d for d in diffs if d["max_abs_diff_m"] > 1e-4]}
    json.dump({"source": "tessellation du STEP fourni", "occurrences": rows}, open(os.path.join(outdir, "geometry_manifest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(val, open(os.path.join(outdir, "geometry_validation.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(val, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:4])
