"""API de test imitant Ollama. Le comportement depend du nom de modele. Sert aux tests d'integration, jamais au produit."""
import json
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CAPTURED = []
MODELS = ["mock-ok", "mock-citation", "mock-gain", "mock-memoire", "mock-erreur", "mock-lent", "mock-vide", "mock-refus-verif"]


def first_ids(prompt):
    return re.findall(r"^\[([^\]]+)\]", prompt, flags=re.M)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _j(self, o, code=200):
        b = json.dumps(o).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if self.path == "/api/tags":
            return self._j({"models": [{"name": m} for m in MODELS]})
        if self.path == "/_captured":
            return self._j(CAPTURED)
        self._j({"error": "not found"}, 404)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path == "/_reset":
            CAPTURED.clear(); return self._j({})
        if self.path == "/api/show":
            return self._j({"capabilities": ["completion"]})
        if self.path == "/api/generate":
            CAPTURED.append(body)
            return self.generate(body)
        self._j({"error": "not found"}, 404)

    def generate(self, b):
        model, prompt, system = b["model"], b["prompt"], b.get("system") or ""
        if model not in MODELS:
            return self._j({"error": f"model '{model}' not found"}, 404)
        if model == "mock-memoire":
            return self._j({"error": "model requires more system memory (9.1 GiB) than is available (2.0 GiB)"}, 500)
        if model == "mock-erreur":
            return self._j({"error": "llama runner process has terminated"}, 500)
        if model == "mock-lent":
            time.sleep(30)
        if model == "mock-vide":
            return self._j({"response": "", "done": True, "done_reason": "length"})
        if "rôle de recherche" in system:
            text = {"requetes": ["poste"], "postes": [], "references": []}
        elif "analyste" in system:
            ids = first_ids(prompt)
            real = ids[0] if ids else None
            quote = next((l for l in prompt.splitlines() if l.startswith(f"[{real}]")), "") if real else ""
            nums = re.findall(r"\d{2}:\d{2}:\d{2}", quote)
            fact = f"La preuve indique la durée {nums[0]}." if nums else "La preuve décrit cet élément."
            if model == "mock-citation":
                text = {"reponse_courte": "Test", "constats": [{"texte": fact, "citations": ["MES!L9999"]}, {"texte": fact + " Sans citation.", "citations": []}], "actions": [], "donnees_manquantes": ["Donnée de test"]}
            elif model == "mock-gain":
                text = {"reponse_courte": "Test", "constats": [{"texte": "Cette action permet de réduire le temps de 25 %.", "citations": [real]}, {"texte": "Valeur inventée 987654.", "citations": [real]}], "actions": [{"action": "Organiser un tutorat", "cible": "Poste 1", "fait": "Fait", "mesure": "Mesure", "citations": ["KPI!n_operations"] if "KPI!n_operations" in ids else [real]}], "donnees_manquantes": []}
            else:
                text = {"reponse_courte": "Réponse de test", "constats": [{"texte": fact, "citations": [real]}] if real else [], "actions": [{"action": "Vérifier sur le terrain", "cible": "Élément cité", "fait": fact, "mesure": "Temps réel", "citations": [real]}] if real else [], "donnees_manquantes": []}
        elif "vérificateur" in system:
            text = {"soutenu": model != "mock-refus-verif", "raison": "test"}
        else:
            return self._j({"response": "prêt", "done": True, "eval_count": 2, "total_duration": 1000000})
        return self._j({"response": json.dumps(text, ensure_ascii=False), "done": True, "eval_count": 5, "total_duration": 1000000})


class Quiet(ThreadingHTTPServer):
    def handle_error(self, request, client_address):  # coupure attendue du test de delai depasse
        pass


def start(port=0):
    s = Quiet(("127.0.0.1", port), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s, s.server_address[1]


if __name__ == "__main__":
    srv, p = start(int(sys.argv[1]) if len(sys.argv) > 1 else 11999)
    print("mock", p, flush=True)
    threading.Event().wait()
