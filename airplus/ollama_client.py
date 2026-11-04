"""Client de l'API locale Ollama avec classification explicite des erreurs."""
import json
import socket
import urllib.error
import urllib.parse
import urllib.request

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


class OllamaError(Exception):
    def __init__(self, code, message, detail=None):
        super().__init__(message)
        self.code = code; self.message = message; self.detail = detail

    def to_dict(self):
        return {"code": self.code, "message": self.message, "detail": self.detail}


MESSAGES = {
    "service_arrete": "Le service Ollama ne répond pas. Lancez Ollama puis réessayez.",
    "modele_manquant": "Le modèle demandé n'est pas installé dans Ollama.",
    "telechargement": "Le modèle est en cours de téléchargement.",
    "echec_generation": "Ollama a renvoyé une erreur pendant la génération.",
    "delai_depasse": "Le délai d'attente de la génération est dépassé.",
    "memoire_insuffisante": "Ollama signale une mémoire insuffisante pour charger ce modèle.",
    "reponse_vide": "Le modèle a répondu sans texte exploitable.",
    "non_local": "Seule une API Ollama locale est autorisée.",
}


def check_local(url):
    host = urllib.parse.urlparse(url).hostname
    if host not in LOCAL_HOSTS:
        raise OllamaError("non_local", MESSAGES["non_local"], url)
    return url.rstrip("/")


def _classify_http(status, body):
    low = (body or "").lower()
    if "memory" in low or "mémoire" in low or "out of memory" in low:
        return OllamaError("memoire_insuffisante", MESSAGES["memoire_insuffisante"], body[:400])
    if status == 404 or ("model" in low and "not found" in low) or "try pulling" in low:
        return OllamaError("modele_manquant", MESSAGES["modele_manquant"], body[:400])
    return OllamaError("echec_generation", MESSAGES["echec_generation"], f"HTTP {status}: {(body or '')[:400]}")


class OllamaClient:
    def __init__(self, base_url="http://127.0.0.1:11434", model=None, timeout=300):
        self.base_url = check_local(base_url); self.model = model; self.timeout = timeout

    def _req(self, path, payload=None, timeout=None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise _classify_http(e.code, e.read().decode("utf-8", "replace"))
        except urllib.error.URLError as e:
            if isinstance(e.reason, (socket.timeout, TimeoutError)):
                raise OllamaError("delai_depasse", MESSAGES["delai_depasse"], str(e.reason))
            raise OllamaError("service_arrete", MESSAGES["service_arrete"], str(e.reason))
        except (socket.timeout, TimeoutError) as e:
            raise OllamaError("delai_depasse", MESSAGES["delai_depasse"], str(e))
        except ConnectionError as e:
            raise OllamaError("service_arrete", MESSAGES["service_arrete"], str(e))
        except json.JSONDecodeError as e:
            raise OllamaError("echec_generation", MESSAGES["echec_generation"], f"Réponse non JSON : {e}")

    def tags(self):
        return [m["name"] for m in self._req("/api/tags", timeout=5).get("models", [])]

    def capabilities(self, model):
        try:
            return self._req("/api/show", {"model": model}, timeout=10).get("capabilities") or []
        except OllamaError:
            return []

    def generate(self, prompt, system=None, schema=None, num_predict=900, num_ctx=8192, temperature=0.1, timeout=None, model=None):
        model = model or self.model
        if not model:
            raise OllamaError("modele_manquant", "Aucun modèle n'est configuré.")
        body = {"model": model, "prompt": prompt, "stream": False, "options": {"temperature": temperature, "num_predict": num_predict, "num_ctx": num_ctx}}
        if system:
            body["system"] = system
        if schema:
            body["format"] = schema
        if "thinking" in self.capabilities(model):
            body["think"] = False
        r = self._req("/api/generate", body, timeout=timeout)
        if r.get("error"):
            raise _classify_http(500, r["error"])
        return {"text": (r.get("response") or "").strip(), "eval_count": r.get("eval_count"), "total_duration_ms": int((r.get("total_duration") or 0) / 1e6), "done_reason": r.get("done_reason"), "payload": body}

    def pull(self, model, on_progress):
        req = urllib.request.Request(self.base_url + "/api/pull", data=json.dumps({"model": model, "stream": True}).encode("utf-8"), headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                for line in r:
                    if not line.strip():
                        continue
                    msg = json.loads(line.decode("utf-8"))
                    if msg.get("error"):
                        raise _classify_http(500, msg["error"])
                    on_progress(msg)
        except urllib.error.HTTPError as e:
            raise _classify_http(e.code, e.read().decode("utf-8", "replace"))
        except urllib.error.URLError as e:
            raise OllamaError("service_arrete", MESSAGES["service_arrete"], str(e.reason))


def status(client, pulling=None):
    """Etat sans generation : service, modele, telechargement."""
    if pulling and pulling.get("state") == "running":
        return {"state": "telechargement", "message": MESSAGES["telechargement"], "models": [], "pull": pulling}
    try:
        models = client.tags()
    except OllamaError as e:
        return {"state": e.code, "message": e.message, "detail": e.detail, "models": []}
    if not client.model:
        return {"state": "modele_non_configure", "message": "Service actif. Choisissez un modèle.", "models": models}
    if client.model not in models and f"{client.model}:latest" not in models:
        return {"state": "modele_manquant", "message": MESSAGES["modele_manquant"], "models": models, "model": client.model}
    return {"state": "pret", "message": "Service actif et modèle présent. La génération n'est confirmée que par « Tester le modèle ».", "models": models, "model": client.model}


def test_generation(client):
    """Petite generation reelle. Toute panne est renvoyee avec son code."""
    st = status(client)
    if st["state"] != "pret":
        return {"ok": False, "code": st["state"], "message": st["message"], "detail": st.get("detail")}
    try:
        r = client.generate("Écris uniquement le mot : prêt", system="Réponds par un seul mot, sans explication.", num_predict=48, num_ctx=2048, timeout=client.timeout)
    except OllamaError as e:
        return {"ok": False, **e.to_dict()}
    if not r["text"]:
        return {"ok": False, "code": "reponse_vide", "message": MESSAGES["reponse_vide"], "detail": r.get("done_reason")}
    return {"ok": True, "code": "generation_reussie", "message": "Génération réelle réussie.", "model": client.model, "text": r["text"][:200], "duration_ms": r["total_duration_ms"], "tokens": r["eval_count"]}
