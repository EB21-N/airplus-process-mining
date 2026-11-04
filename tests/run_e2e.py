#!/usr/bin/env python3
"""Parcours de verification sans navigateur. Usage :
   python tests/run_e2e.py <AirPlus.zip> <dossier_des_trois_excel> [--python chemin] [--real-model NOM]

Decompresse le ZIP dans un dossier neuf, lance le dashboard depuis ce dossier, importe les fichiers reels,
compare preloaded / import / notebook, recalcule des valeurs avec un code independant du moteur,
controle la pseudonymisation et teste la chaine IA contre une API de test (mock_ollama.py).
Les noms ne sont jamais imprimes.
"""
import argparse
import base64
import datetime as dt
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
RESULTS = []


def check(group, name, ok, detail=""):
    RESULTS.append((group, name, bool(ok), str(detail)))
    print(("OK  " if ok else "KO  ") + f"[{group}] {name}" + (f" : {detail}" if detail else ""), flush=True)


class Api:
    def __init__(self, base):
        self.base = base

    def get(self, p, raw=False):
        with urllib.request.urlopen(self.base + p, timeout=60) as r:
            d = r.read()
        return d if raw else json.loads(d)

    def post(self, p, b, expect=None):
        req = urllib.request.Request(self.base + p, json.dumps(b).encode(), {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def ask(self, q, overrides=None, wait=900):
        code, r = self.post("/api/ask", {"question": q, "overrides": overrides or {}})
        assert code == 200, r
        t = time.time()
        while time.time() - t < wait:
            j = self.get("/api/job/" + r["job"])
            if j["state"] != "running":
                return j
            time.sleep(.5)
        raise TimeoutError(q)


def find_sources(folder):
    names = os.listdir(folder)
    pick = lambda k: os.path.join(folder, sorted([n for n in names if n.upper().startswith(k) and n.endswith(".xlsx")], key=len)[0])
    return {"mes": pick("MES"), "plm": pick("PLM"), "erp": pick("ERP")}


def identities(erp_path, vendor):
    sys.path.insert(0, vendor)
    import openpyxl
    wb = openpyxl.load_workbook(erp_path, data_only=True)
    rows = list(wb["RESSOURCES"].iter_rows(values_only=True))[1:]
    needles = set()
    for r in rows:
        needles |= {str(r[0]).lower(), f"{r[1]} {r[2]}".lower(), f"{r[2]} {r[1]}".lower()}
    authors = set()
    return rows, needles, authors


def scan_text(blobs, needles):
    pat = re.compile("|".join(re.escape(n) for n in sorted(needles, key=len, reverse=True)))
    return [name for name, data in blobs.items() if pat.search(data.decode("utf-8", "ignore").lower()) or pat.search(name.lower())]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("zip"); ap.add_argument("sources"); ap.add_argument("--python", default=sys.executable); ap.add_argument("--real-model"); ap.add_argument("--port", type=int, default=18765)
    args = ap.parse_args()
    src = find_sources(args.sources)
    tmp = tempfile.mkdtemp(prefix="airplus_e2e_")
    print("Dossier neuf :", tmp)
    with zipfile.ZipFile(args.zip) as z:
        z.extractall(tmp)
        names = z.namelist()
    root = os.path.join(tmp, "AirPlus")
    vendor = os.path.join(root, "vendor")
    rows, needles, _ = identities(src["erp"], vendor)
    import openpyxl

    # --- Parcours 1 : ZIP neuf, lancement, analyse prechargee
    check("1", "aucun classeur source dans le ZIP", not [n for n in names if n.endswith(".xlsx")])
    for f in ("lancer_windows.bat", "lancer_macos.command", "lancer_linux.sh", "README.md", "notebooks/AirPlus_Colab.ipynb", "data/preloaded/analyse_prechargee.zip", "web/assets/aircraft.glb", "web/assets/notice_meccano_dreamliner.pdf", "web/vendor/three/three.module.min.js", "ressources_3d/Boeing 787 A_.stp"):
        check("1", f"présent : {f}", os.path.exists(os.path.join(root, f)))
    env = dict(os.environ, PYTHONUTF8="1"); env.pop("PYTHONPATH", None)
    proc = subprocess.Popen([args.python, "-m", "airplus", "serve", "--no-browser", "--port", str(args.port)], cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
    line = proc.stdout.readline(); m = re.search(r"http://127\.0\.0\.1:(\d+)/", line)
    assert m, line
    base = f"http://127.0.0.1:{m[1]}"; api = Api(base)
    try:
        time.sleep(.3)
        st = api.get("/api/state")
        check("1", "analyse préchargée ouverte au démarrage", st["loaded"] and st["origin"] == "preload", st["content_sha256"][:16])
        pre_hash = st["content_sha256"]
        check("1", "page servie", b"Air+" in api.get("/", raw=True))
        check("1", "maillage servi", len(api.get("/assets/aircraft.glb", raw=True)) > 1_000_000)
        A = api.get("/api/analysis")

        # --- Parcours 6 (ZIP) : sans import, les noms sont inaccessibles
        code, r = api.post("/api/reveal", {"code": "1234"})
        check("6", "révélation refusée sans import local", code == 409, r.get("error"))

        # --- Parcours 2 : import, ZIP, reouverture, comparaison
        files = {k: {"name": os.path.basename(v), "b64": base64.b64encode(open(v, "rb").read()).decode()} for k, v in src.items()}
        code, r = api.post("/api/import", {"files": files})
        check("2", "import des trois Excel", code == 200, r.get("content_sha256", r)[:16])
        check("2", "import identique à la préchargée", r["identique_a_prechargee"] is True)
        zip_import = api.get("/api/analysis/zip", raw=True)
        code, r2 = api.post("/api/open-zip", {"b64": base64.b64encode(zip_import).decode()})
        check("2", "ZIP généré rouvert, même empreinte", code == 200 and r2["content_sha256"] == pre_hash)
        tampered = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(zip_import)) as zi, zipfile.ZipFile(tampered, "w") as zo:
            for n in zi.namelist():
                d = zi.read(n)
                zo.writestr(n, d.replace(b'"poste": 31', b'"poste": 99') if n == "dashboard/analysis.json" else d)
        code, r3 = api.post("/api/open-zip", {"b64": base64.b64encode(tampered.getvalue()).decode()})
        check("2", "ZIP altéré refusé", code == 422, r3.get("error"))
        code, r3 = api.post("/api/open-zip", {"b64": base64.b64encode(b"pas un zip").decode()})
        check("2", "fichier non ZIP refusé", code == 422, r3.get("error"))
        code, r3 = api.post("/api/import", {"files": {"mes": files["plm"], "plm": files["plm"], "erp": files["erp"]}})
        check("2", "mauvais classeur MES refusé avec message", code == 422, r3.get("error"))
        # Notebook : execution des cellules de code hors Colab
        nb = json.load(open(os.path.join(root, "notebooks", "AirPlus_Colab.ipynb"), encoding="utf-8"))
        nbdir = os.path.join(tmp, "nb"); os.makedirs(nbdir); srcdir = os.path.join(nbdir, "src"); os.makedirs(srcdir)
        for v in src.values():
            shutil.copy(v, srcdir)
        script = os.path.join(nbdir, "run_nb.py")
        with open(script, "w", encoding="utf-8") as f:
            f.write("\n\n".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code"))
        env2 = dict(env, AIRPLUS_SOURCES=srcdir, PYTHONPATH=vendor)
        out = subprocess.run([args.python, script], cwd=nbdir, env=env2, capture_output=True, text=True, encoding="utf-8")
        check("2", "notebook exécuté (hors Colab)", out.returncode == 0, out.stderr[-300:])
        check("2", "notebook identique à la préchargée", f"Empreinte du contenu : {pre_hash}" in out.stdout and "Identique à l'analyse préchargée : True" in out.stdout)

        # --- Parcours 3 : verification manuelle independante, depuis les lignes sources
        mes = openpyxl.load_workbook(src["mes"], data_only=True)["MES"]; plm = openpyxl.load_workbook(src["plm"], data_only=True)["Sheet1"]
        L32 = [c.value for c in mes[32]]; sec = lambda t: t.hour * 3600 + t.minute * 60 + t.second
        op31 = next(o for o in A["operations"] if o["poste"] == 31)
        check("3", "durée MES!L32 : réel, prévu, horodatages", (sec(L32[8]), sec(L32[4]), sec(L32[7]) - sec(L32[6])) == (op31["reel_s"], op31["prevu_s"], op31["horo_s"]), f"réel {L32[8]}, prévu {L32[4]}, {L32[6]}→{L32[7]}")
        check("3", "écart d'horloge conservé L32", op31["ecart_horo_reel_s"] == (sec(L32[7]) - sec(L32[6])) - sec(L32[8]) and op31["controle_horloge"] == "fin_tronquee_fin_de_journee", op31["ecart_horo_reel_s"])
        total = sum(sec(mes.cell(i, 9).value) for i in range(2, 58)); check("3", "somme du déclaré recalculée", total == next(k for k in A["kpis"] if k["kpi_id"] == "reel_declare_total")["valeur"], total)
        L11 = str(mes.cell(11, 4).value).split(";"); prow = next(r for r in plm.iter_rows(min_row=2, values_only=True) if r[0] == "D278")
        a806 = sum(str(mes.cell(i, 4).value or "").split(";").count("A806") for i in range(2, 58)); part = next(p for p in A["parts"] if p["ref"] == "A806")
        check("3", "rapprochement MES–PLM A806 : occurrences et nomenclature", a806 == part["occ_mes"] and part["qty_nomenclature"] == 13, f"MES {a806}, PLM 13, écart conservé")
        check("3", "rapprochement MES!L11 → PLM D278", "D278" in L11 and next(p for p in A["parts"] if p["ref"] == "D278")["fournisseur"] == prow[3], f"{prow[1]}, {prow[3]}, {prow[7]} EUR")
        d142 = next(r for r in plm.iter_rows(min_row=2, values_only=True) if r[0] == "D142"); pd = next(p for p in A["parts"] if p["ref"] == "D142")
        check("3", "coût matière D142 = quantité × prix", pd["valeur_nomenclature_eur"] == d142[2] * d142[7] == 10000000, f"{d142[2]} × {d142[7]}")
        tot = sum(r[2] * r[7] for r in plm.iter_rows(min_row=2, values_only=True) if not str(r[1]).startswith("Outillage"))
        check("3", "total matières hors outillage", tot == next(k for k in A["kpis"] if k["kpi_id"] == "matieres_hors_outillage")["valeur"], tot)
        rate31 = sum(float(r[9]) for r in rows if r[5] == "Poste 31"); expected = round(rate31 * sec(L32[8]) / 3600, 2)
        check("3", "valorisation MO poste 31 = durée × somme des taux", expected == op31["valo_mo_reel_eur"], f"{rate31} EUR/h × {sec(L32[8])} s = {expected}")
        mo_all = 0
        for i in range(2, 58):
            pst = mes.cell(i, 1).value; rs = sum(float(r[9]) for r in rows if r[5] == f"Poste {pst}"); mo_all += round(rs * sec(mes.cell(i, 9).value) / 3600, 2)
        check("3", "valorisation MO totale", abs(round(mo_all, 2) - next(k for k in A["kpis"] if k["kpi_id"] == "mo_reel")["valeur"]) < 0.005, round(mo_all, 2))
        gen = A["general"]; check("3", "table générale sans multiplication des durées", sum(g["op_reel_s"] for g in gen if g["ligne_operation_1"]) == total and len(gen) > 56, f"{len(gen)} lignes")

        # --- Supply chain : recalcul independant depuis le PLM et le MES
        plm_rows = [r for r in plm.iter_rows(min_row=2, values_only=True)]
        totv = sum(r[2] * r[7] for r in plm_rows); by_sup = {}
        for r in plm_rows:
            by_sup[r[3]] = by_sup.get(r[3], 0) + r[2] * r[7]
        top3 = sorted(by_sup.values(), reverse=True)[:3]
        check("S", "valeur totale = somme quantité × prix", totv == A["supply"]["valeur_totale_eur"], totv)
        check("S", "part des 3 premiers fournisseurs", abs(100 * sum(top3) / totv - A["supply"]["part_top3_pct"]) < .06, round(100 * sum(top3) / totv, 2))
        masse = sum(r[2] * float(r[6]) for r in plm_rows); check("S", "masse totale", abs(masse - A["supply"]["masse_totale_kg"]) < .01, round(masse, 2))
        d142 = next(c for c in A["supply_calendar"] if c["ref"] == "D142"); use = min(mes.cell(i, 6).value for i in range(2, 58) if "D142" in str(mes.cell(i, 4).value or "").split(";"))
        check("S", "rétro-planning D142 : premier usage − 45 j", d142["commande_au_plus_tard"] == (use - dt.timedelta(days=45)).date().isoformat(), d142["commande_au_plus_tard"])
        cls = {c["classe"]: c for c in A["supply_abc_classes"]}; check("S", "classes ABC complètes", sum(c["n_refs"] for c in cls.values()) == len(plm_rows) and abs(sum(c["valeur_eur"] for c in cls.values()) - totv) < .01, {k: v["n_refs"] for k, v in cls.items()})
        fl = sum(f["pieces"] for f in A["supply_flows"]); check("S", "flux = occurrences MES", fl == sum(r["occurrences"] for r in A["op_refs"]), fl)
        check("S", "aucun indicateur non calculable dans l'analyse", not ({"indisponibles", "impact", "coverage", "thread"} & set(A)))

        # --- Parcours 6 : pseudonymisation du ZIP d'analyse et du ZIP de livraison
        with zipfile.ZipFile(io.BytesIO(zip_import)) as z:
            blobs = {n: z.read(n) for n in z.namelist()}
            leak = scan_text(blobs, needles)
            check("6", "ZIP d'analyse : ni nom complet ni matricule", not leak, f"{len(blobs)} fichiers, {leak}")
            check("6", "ZIP d'analyse : pas de commentaire ni date réelle", not z.comment and all(i.date_time[0] == 2000 for i in z.infolist()))
            ana = json.loads(blobs["dashboard/analysis.json"])
            check("6", "ZIP d'analyse : âge absent, taux présents", all("age" not in p and p["taux_horaire_eur"] for p in ana["persons"]))
            check("6", "ZIP d'analyse : identifiants internes uniques", len({p["person_id"] for p in ana["persons"]}) == len(rows))
            check("6", "ZIP d'analyse : format Prénom.I", all(re.fullmatch(r"[^\W\d_]+\.[A-Z]", p["pseudo"]) for p in ana["persons"]))
            docs = json.loads(blobs["dashboard/rag_docs.json"])
            check("6", "index IA : aucun taux ni commentaire", not any(re.search(r"\b(taux|horaire)\b", d["texte"], re.I) and d["type"] == "profil" for d in docs) and not any(p["commentaire_carriere"] and p["commentaire_carriere"][:50] in d["texte"] for p in ana["persons"][:150] for d in docs if d["type"] == "profil"))
        delivery = {}
        with zipfile.ZipFile(args.zip) as z:
            for n in z.namelist():
                if n.endswith((".py", ".js", ".json", ".md", ".html", ".ipynb", ".txt", ".csv", ".css", ".stp", ".gltf", ".bat", ".sh", ".command")):
                    delivery[n] = z.read(n)
        leak = scan_text(delivery, needles)
        check("6", "ZIP de livraison : ni nom complet ni matricule ERP", not leak, leak)
        hdr = delivery[[n for n in delivery if n.endswith(".stp")][0]][:3000]
        check("6", "en-tête STEP sans chemin nominatif", b"Users" not in hdr)
        code, r = api.post("/api/import", {"files": files})
        code, r = api.post("/api/reveal", {"code": "0000"}); check("6", "code incorrect refusé", code == 403)
        code, r = api.post("/api/reveal", {"code": "1234"}); check("6", "code 1234 révèle après import local", code == 200 and len(r["names"]) == len(rows), f"{len(r.get('names', {}))} profils, noms non imprimés")
        check("6", "le ZIP après révélation reste pseudonymisé", not scan_text({"z": api.get("/api/analysis", raw=True)}, needles))

        # --- Parcours 7 : chaine IA contre l'API de test
        import mock_ollama
        srv, mport = mock_ollama.start(0)
        mock = f"http://127.0.0.1:{mport}"
        cfg = lambda model, **k: api.post("/api/ollama/config", {"base_url": mock, "model": model, "timeout_s": k.get("timeout", 30)})
        code, r = api.post("/api/ollama/config", {"base_url": "http://example.com:11434"}); check("7", "adresse Ollama non locale refusée", code == 422, r.get("error"))
        cfg("mock-ok")
        code, t = api.post("/api/ollama/test", {}); check("7", "Tester le modèle : génération (API de test)", t["ok"] and t["code"] == "generation_reussie", t)
        cfg("modele-absent"); code, t = api.post("/api/ollama/test", {}); check("7", "code modele_manquant", t["code"] == "modele_manquant", t["message"])
        cfg("mock-memoire"); code, t = api.post("/api/ollama/test", {}); check("7", "code memoire_insuffisante", t["code"] == "memoire_insuffisante", t.get("detail"))
        cfg("mock-erreur"); code, t = api.post("/api/ollama/test", {}); check("7", "code echec_generation", t["code"] == "echec_generation", t.get("detail"))
        cfg("mock-vide"); code, t = api.post("/api/ollama/test", {}); check("7", "code reponse_vide", t["code"] == "reponse_vide")
        cfg("mock-lent", timeout=10); api.post("/api/ollama/config", {"timeout_s": 10}); code, t = api.post("/api/ollama/test", {}); check("7", "code delai_depasse", t["code"] == "delai_depasse", t.get("detail"))
        cfg("mock-ok")
        urllib.request.urlopen(urllib.request.Request(mock + "/_reset", b"{}", {"Content-Type": "application/json"}))
        questions = {"poste": "Que vérifier au poste 31 ?", "fournisseur": "Quels risques pour le fournisseur Latecoere ?", "competence": "Qui pourrait accompagner sur la soudure au poste 2 ?"}
        for k, q in questions.items():
            j = api.ask(q)
            r = j["result"]; ev = [p["id"] for p in r["perimetre"]["preuves_transmises"]]
            check("7", f"question {k} : réponse vérifiée (API de test)", r["etat"] == "reponse_verifiee" and r["constats"], f"preuves {ev[:5]}")
            if k == "poste":
                check("7", "poste 31 : ligne MES!L32 en preuve", "MES!L32" in ev)
            if k == "fournisseur":
                check("7", "fournisseur : agrégat Latecoere en preuve", "SUP!Latecoere" in ev)
            if k == "competence":
                check("7", "compétence : profils pseudonymisés en preuve", any(e.startswith(("ERP!PX", "POSTE!2")) for e in ev))
        cap = json.loads(urllib.request.urlopen(mock + "/_captured").read())
        payload = json.dumps(cap, ensure_ascii=False)
        check("6", "payload Ollama : ni nom complet ni matricule", not scan_text({"p": payload.encode()}, needles), f"{len(cap)} appels capturés")
        rates = {f"{float(r[9]):.2f}" for r in rows}
        profile_ev = re.findall(r"\[ERP!PX[0-9A-F]{6}\][^\n]*", "\n".join(c["prompt"] for c in cap))
        check("6", "payload Ollama : profils sans taux ni champ taux", profile_ev and not any(re.search(r"taux|horaire|EUR", p) or any(x in p for x in rates) for p in profile_ev), f"{len(profile_ev)} extraits de profil")
        check("7", "trois rôles appelés", {"rôle de recherche", "analyste", "vérificateur"} <= {w for c in cap for w in ("rôle de recherche", "analyste", "vérificateur") if w in (c.get("system") or "")})
        cfg("mock-citation"); j = api.ask("Que vérifier au poste 31 ?"); r = j["result"]
        check("7", "citation inexistante refusée par le serveur", r["etat"] == "preuves_insuffisantes" and any("inexistante" in x["motif"] for x in r["refusees"]), [x["motif"] for x in r["refusees"]])
        check("7", "affirmation sans citation refusée", any(x["motif"] == "Aucune citation." for x in r["refusees"]))
        cfg("mock-gain"); j = api.ask("Que vérifier au poste 31 ?"); r = j["result"]; motifs = [x["motif"] for x in r["refusees"]]
        check("7", "gain chiffré refusé", any("Gain" in m for m in motifs), motifs); check("7", "chiffre absent des preuves refusé", any("Chiffre absent" in m for m in motifs))
        check("7", "tutorat sans compétence citée refusé", any("Tutorat" in m for m in motifs))
        cfg("mock-refus-verif"); j = api.ask("Que vérifier au poste 31 ?"); r = j["result"]
        check("7", "refus du rôle de vérification respecté", r["etat"] == "preuves_insuffisantes" and all(x["etape"] == "verification" for x in r["refusees"]) and r["refusees"])
        cfg("mock-ok"); j = api.ask("Quel est le taux de retouche et le TRS ?"); r = j["result"]
        check("7", "question sur donnée absente : GAP dans les preuves", any(d["id"] in ("GAP!retouches", "GAP!trs") for d in r["donnees_absentes_index"]), [d["id"] for d in r["donnees_absentes_index"]])
        api.post("/api/ollama/config", {"base_url": "http://127.0.0.1:9", "model": "x"})
        st2 = api.get("/api/ollama/status"); check("7", "code service_arrete au statut", st2["state"] == "service_arrete", st2["message"])
        code, t = api.post("/api/ollama/test", {}); check("7", "Tester le modèle : service arrêté", t["code"] == "service_arrete")
        j = api.ask("Que vérifier au poste 31 ?"); check("7", "question sans Ollama : erreur explicite", j["state"] == "error" and j["error"]["code"] == "service_arrete", j["error"]["message"])
        check("7", "dashboard utilisable sans Ollama", api.get("/api/analysis")["kpis"][0]["valeur"] == 56)
        srv.shutdown()

        # --- Option : vrai modele
        if args.real_model:
            api.post("/api/ollama/config", {"base_url": "http://127.0.0.1:11434", "model": args.real_model, "timeout_s": 600})
            code, t = api.post("/api/ollama/test", {}); check("R", f"Tester le modèle {args.real_model}", t.get("ok"), t)
            print(json.dumps(t, ensure_ascii=False))
    finally:
        proc.terminate(); proc.wait(10); shutil.rmtree(tmp, ignore_errors=True)
    ko = [r for r in RESULTS if not r[2]]
    print(f"\n{len(RESULTS) - len(ko)}/{len(RESULTS)} contrôles réussis")
    return 1 if ko else 0


if __name__ == "__main__":
    sys.exit(main())
