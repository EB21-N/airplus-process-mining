#!/usr/bin/env python3
"""Assemble le ZIP unique de livraison. N'inclut ni classeur source, ni workspace, ni cache.

Usage : python package.py <sortie.zip> <stp> <gltf> <3dxml>
"""
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCLUDE_DIRS = {"__pycache__", "workspace", ".claude", "dist", ".git"}
EXEC = {"lancer_macos.command", "lancer_linux.sh"}


def main(out, stp, gltf, xml):
    # Ressources CAO d'origine. Le chemin local nominatif de l'en-tete STEP est retire.
    res = os.path.join(ROOT, "ressources_3d"); os.makedirs(res, exist_ok=True)
    s = open(stp, "rb").read()
    s2 = re.sub(rb"FILE_NAME\('[^']*'", b"FILE_NAME('Boeing 787 A_.stp'", s, count=1)
    assert b"Users" not in s2[:3000]
    open(os.path.join(res, "Boeing 787 A_.stp"), "wb").write(s2)
    open(os.path.join(res, "Boeing 787 A_.gltf"), "wb").write(open(gltf, "rb").read())
    open(os.path.join(res, "Projet_Innovation_4_All_STEP_A.3dxml"), "wb").write(open(xml, "rb").read())
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for dp, dn, fn in os.walk(ROOT):
            dn[:] = sorted(d for d in dn if d not in EXCLUDE_DIRS)
            for f in sorted(fn):
                if f.endswith((".xlsx", ".pyc")) or f == ".git":
                    continue
                full = os.path.join(dp, f); rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
                info = zipfile.ZipInfo("AirPlus/" + rel, (2026, 11, 4, 12, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (0o755 if f in EXEC else 0o644) << 16
                z.writestr(info, open(full, "rb").read())
    print(out, os.path.getsize(out))


if __name__ == "__main__":
    main(*sys.argv[1:5])
