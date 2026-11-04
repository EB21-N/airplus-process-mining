"""Serveur local du dashboard (bibliotheque standard + openpyxl). Ecoute uniquement sur la boucle locale."""
import base64
import json
import mimetypes
import os
import threading
import uuid
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from . import engine
from .ollama_client import OllamaClient, OllamaError, check_local, status as ollama_status, test_generation
from .rag import PrivacyViolation, run_chain, session_docs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
PRELOADED = os.path.join(ROOT, "data", "preloaded", "analyse_prechargee.zip")
WORK = os.path.join(ROOT, "workspace")
CONFIG = os.path.join(WORK, "config.json")
MAX_BODY = 80 * 1024 * 1024
REVEAL_CODE = "1234"  # masque d'affichage local : les identites ne sont en memoire qu'apres un import local

mimetypes.add_type("model/gltf-binary", ".glb"); mimetypes.add_type("text/javascript", ".js"); mimetypes.add_type("text/css", ".css")


class State:
    def __init__(self):
        self.lock = threading.Lock(); self.analysis = None; self.manifest = None; self.zip_bytes = None; self.origin = None
        self.identity = None; self.needles = (); self.jobs = {}; self.pull = None
        self.config = {"base_url": "http://127.0.0.1:11434", "model": None, "timeout_s": 300}
        os.makedirs(WORK, exist_ok=True)
        if os.path.exists(CONFIG):
            try:
                self.config.update(json.load(open(CONFIG, encoding="utf-8")))
            except (OSError, ValueError):
                pass

    def client(self):
        c = self.config
        model = c.get("model")
        cl = OllamaClient(c["base_url"], model, int(c.get("timeout_s") or 300))
        if not model:
            try:
                tags = cl.tags()
                if tags:
                    cl.model = tags[0]
            except OllamaError:
                pass
        return cl

    def save_config(self):
        with open(CONFIG, "w", encoding="utf-8") as f:
            json.dump(self.config, f, indent=1)

    def set_analysis(self, analysis, manifest, zip_bytes, origin, identity=None):
        with self.lock:
            self.analysis, self.manifest, self.zip_bytes, self.origin = analysis, manifest, zip_bytes, origin
            self.identity = identity
            needles = set()
            for v in (identity or {}).values():
                if v.get("nom_complet"):
                    needles.add(v["nom_complet"].lower())
                    a = v["nom_complet"].split(" ", 1)
                    if len(a) == 2:
                        needles.add(f"{a[1]} {a[0]}".lower())
            self.needles = tuple(needles)

    def open_preloaded(self):
        data = open(PRELOADED, "rb").read()
        analysis, manifest = engine.read_analysis_zip(data)
        self.set_analysis(analysis, manifest, data, "preload")


S = State()


def _new_job(kind):
    jid = uuid.uuid4().hex[:12]
    S.jobs[jid] = {"id": jid, "kind": kind, "state": "running", "steps": [], "result": None, "error": None}
    return S.jobs[jid]


def _ask_worker(job, question, overrides):
    try:
        a = S.analysis
        def on_step(role, state, info):
            job["steps"].append({"role": role, "state": state, **{k: v for k, v in info.items() if k in ("duree_s", "acceptees", "refusees")}})
        res = run_chain(S.client(), a["rag_docs"], question, S.needles, session_docs(overrides, a["persons"]), on_step)
        job["result"] = res; job["state"] = "done"
    except OllamaError as e:
        job["error"] = e.to_dict(); job["state"] = "error"
    except PrivacyViolation as e:
        job["error"] = {"code": "confidentialite", "message": f"Envoi bloqué avant Ollama : {e}."}; job["state"] = "error"
    except Exception as e:  # le dashboard reste utilisable
        job["error"] = {"code": "erreur_interne", "message": f"{e.__class__.__name__}: {e}"}; job["state"] = "error"


def _pull_worker(job, model):
    S.pull = {"state": "running", "model": model, "status": "démarrage", "completed": 0, "total": 0}
    try:
        def prog(m):
            S.pull.update({"status": m.get("status", ""), "completed": m.get("completed", S.pull["completed"]), "total": m.get("total", S.pull["total"])})
            job["steps"] = [dict(S.pull)]
        OllamaClient(S.config["base_url"], model, 3600).pull(model, prog)
        S.pull["state"] = "done"; job["state"] = "done"; job["result"] = {"model": model}
    except OllamaError as e:
        S.pull["state"] = "error"; job["error"] = e.to_dict(); job["state"] = "error"


class H(BaseHTTPRequestHandler):
    server_version = "AirPlus"
    sys_version = ""

    def log_message(self, *a):
        pass

    def _send(self, code, body=b"", ctype="application/json; charset=utf-8", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff"); self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8"))

    def _err(self, code, msg, **kw):
        self._json({"error": msg, **kw}, code)

    def _host_ok(self):
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        return host in ("127.0.0.1", "localhost", "::1")

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("Fichier trop volumineux.")
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    # ---- GET
    def do_GET(self):
        if not self._host_ok():
            return self._err(403, "Hôte refusé.")
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self._api_get(path)
        rel = "index.html" if path == "/" else path.lstrip("/")
        full = os.path.normpath(os.path.join(WEB, rel))
        if not full.startswith(WEB + os.sep) or not os.path.isfile(full):
            return self._err(404, "Introuvable.")
        with open(full, "rb") as f:
            self._send(200, f.read(), mimetypes.guess_type(full)[0] or "application/octet-stream")

    do_HEAD = do_GET

    def _api_get(self, path):
        if path == "/api/state":
            a = S.analysis
            return self._json({"loaded": bool(a), "origin": S.origin, "engine_version": engine.ENGINE_VERSION, "content_sha256": a["meta"]["content_sha256"] if a else None,
                               "can_reveal": bool(S.identity), "preloaded_available": os.path.exists(PRELOADED),
                               "preloaded_matches": None})
        if path == "/api/analysis":
            if not S.analysis:
                return self._err(404, "Aucune analyse chargée.")
            return self._json({k: v for k, v in S.analysis.items() if k != "rag_docs"})
        if path == "/api/analysis/zip":
            if not S.zip_bytes:
                return self._err(404, "Aucune analyse chargée.")
            return self._send(200, S.zip_bytes, "application/zip", {"Content-Disposition": 'attachment; filename="airplus_analyse.zip"'})
        if path == "/api/analysis/manifest":
            return self._json(S.manifest or {})
        if path == "/api/ollama/status":
            return self._json({**ollama_status(S.client(), S.pull), "config": S.config})
        if path.startswith("/api/job/"):
            job = S.jobs.get(path.rsplit("/", 1)[-1])
            return self._json(job) if job else self._err(404, "Tâche inconnue.")
        return self._err(404, "Route inconnue.")

    # ---- POST
    def do_POST(self):
        if not self._host_ok():
            return self._err(403, "Hôte refusé.")
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).hostname not in ("127.0.0.1", "localhost", "::1"):
            return self._err(403, "Origine refusée.")
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self._err(415, "JSON attendu.")
        try:
            body = self._body()
        except ValueError as e:
            return self._err(400, str(e))
        path = urlparse(self.path).path
        try:
            return self._api_post(path, body)
        except (engine.SourceError, ValueError) as e:
            return self._err(422, str(e))
        except OllamaError as e:
            return self._err(422, e.message, erreur=e.code)
        except engine.PseudonymizationError as e:
            return self._err(500, str(e))
        except Exception as e:  # une erreur inattendue ne doit jamais fermer la connexion sans reponse
            return self._err(500, f"{e.__class__.__name__}: {e}")

    def _api_post(self, path, b):
        if path == "/api/import":
            files = b.get("files") or {}
            for k in ("mes", "plm", "erp"):
                if k not in files:
                    raise ValueError(f"Fichier {k.upper()} manquant.")
            blobs = {k: base64.b64decode(files[k]["b64"]) for k in ("mes", "plm", "erp")}
            names = {k: os.path.basename(str(files[k].get("name") or k)) for k in blobs}
            zip_bytes, analysis, manifest, identity = engine.run(blobs["mes"], blobs["plm"], blobs["erp"], names)
            S.set_analysis(analysis, manifest, zip_bytes, "import", identity)
            cmp_hash = None
            if os.path.exists(PRELOADED):
                cmp_hash = engine.read_analysis_zip(open(PRELOADED, "rb").read())[1]["content_sha256"]
            return self._json({"ok": True, "content_sha256": manifest["content_sha256"], "pseudonymisation": manifest["pseudonymisation"], "tables": manifest["tables"], "zip_bytes": len(zip_bytes), "identique_a_prechargee": cmp_hash == manifest["content_sha256"] if cmp_hash else None})
        if path == "/api/open-zip":
            data = base64.b64decode(b.get("b64") or "")
            analysis, manifest = engine.read_analysis_zip(data)
            S.set_analysis(analysis, manifest, data, "zip")
            return self._json({"ok": True, "content_sha256": manifest["content_sha256"]})
        if path == "/api/open-preloaded":
            S.open_preloaded()
            return self._json({"ok": True})
        if path == "/api/reveal":
            if not S.identity:
                return self._err(409, "Les noms ne sont disponibles qu'après un import local des Excel dans cette session.")
            if str(b.get("code")) != REVEAL_CODE:
                return self._err(403, "Code incorrect.")
            return self._json({"names": {k: v["nom_complet"] for k, v in S.identity.items()}})
        if path == "/api/ollama/config":
            if "base_url" in b:
                S.config["base_url"] = check_local(str(b["base_url"]))
            if "model" in b:
                S.config["model"] = str(b["model"]).strip() or None
            if "timeout_s" in b:
                S.config["timeout_s"] = max(10, min(3600, int(b["timeout_s"])))
            S.save_config()
            return self._json({"ok": True, "config": S.config})
        if path == "/api/ollama/test":
            return self._json(test_generation(S.client()))
        if path == "/api/ollama/pull":
            model = str(b.get("model") or S.config.get("model") or "").strip()
            if not model:
                raise ValueError("Indiquez le nom du modèle à télécharger.")
            job = _new_job("pull")
            threading.Thread(target=_pull_worker, args=(job, model), daemon=True).start()
            return self._json({"job": job["id"]})
        if path == "/api/ask":
            q = str(b.get("question") or "").strip()
            if not q:
                raise ValueError("Écrivez une question.")
            if not S.analysis:
                raise ValueError("Aucune analyse chargée.")
            ov = {str(k): v for k, v in (b.get("overrides") or {}).items()}
            job = _new_job("ask")
            threading.Thread(target=_ask_worker, args=(job, q[:2000], ov), daemon=True).start()
            return self._json({"job": job["id"]})
        return self._err(404, "Route inconnue.")


def serve(port=8765, open_browser=True, host="127.0.0.1"):
    if os.path.exists(PRELOADED):
        try:
            S.open_preloaded()
        except ValueError as e:
            print("Analyse préchargée illisible :", e)
    srv, chosen = None, None
    for p in range(port, port + 20):
        try:
            srv = ThreadingHTTPServer((host, p), H); chosen = p
            break
        except OSError:
            continue
    if not srv:
        raise SystemExit(f"Aucun port libre à partir de {port}.")
    url = f"http://127.0.0.1:{chosen}/"
    print(f"Air+ est lancé : {url}\nFermez cette fenêtre ou pressez Ctrl+C pour arrêter.", flush=True)
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
