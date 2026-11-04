"""Chaine RAG a trois roles : recherche des preuves, analyse, verification.

Aucune reponse metier n'est ecrite ici. Le code construit les prompts, cherche dans l'index et controle les
sorties. Tout le contenu affiche vient du modele et des documents cites.
"""
import json
import math
import re
import time
import unicodedata
from collections import Counter, defaultdict

from .ollama_client import OllamaError

STOP = set("""a au aux avec ce ces cet cette dans de des du elle en et est il ils je la le les leur leurs lui ma mais me mes
mon ne nos notre nous on ou où par pas pour quand que quel quelle quelles quels qui sa se ses si son sont sur ta te tes
ton tu un une vos votre vous y été être faire fait peut peux plus quoi comment pourquoi quels the of and donne donner
propose proposer quelles actions action""".split())

CITATION_RE = re.compile(r"^(MES!L\d+|PLM![^!]+!L\d+|ERP!PX[0-9A-F]{6}|POSTE!\d+|KPI![a-z_]+|GAP![a-z_]+|SUP!\w+|ZONE!\w+|6M!\S+|ANOM!\d+|NOTICE!\S+|JOIN!\S+|FIL!\S+|SUPPLY!\S+|SESSION!PX[0-9A-F]{6})$")
GAIN_RE = re.compile(r"(gain|économi|reduction|réduction|réduire|diminu|baisse|améliorer?)[^.]{0,40}\d+\s*(%|€|eur|minutes?|heures?|h\b|min\b)", re.I)
TUTOR_RE = re.compile(r"tutor|mentor|binôm|accompagn|parrain", re.I)

ANALYST_SYSTEM = """Tu es l'analyste d'une équipe industrielle d'assemblage. Tu réponds en français à partir des PREUVES fournies, et d'elles seules.
Règles absolues :
- Chaque constat et chaque action cite au moins un identifiant de preuve, recopié exactement tel qu'il apparaît entre crochets. Pas d'autre source.
- Recopie les chiffres tels qu'ils figurent dans les preuves. N'invente aucune valeur.
- Aléa déclaré et cause potentielle sont distincts. Une cause potentielle reste une hypothèse, formule-la ainsi.
- Un dépassement de temps déclenche une investigation ; il ne prouve pas un goulot de capacité.
- Ne promets aucun gain et ne chiffre aucune amélioration.
- Un niveau de compétence déclaré ne prouve ni productivité ni qualité. Un tutorat s'appuie sur des compétences déclarées et reste soumis à validation humaine.
- Une action précise : l'action à vérifier, le poste ou la pièce concernée, le fait qui la motive, la mesure à suivre.
- Si les preuves ne permettent pas de répondre, laisse constats et actions vides, explique-le dans reponse_courte et liste la donnée nécessaire dans donnees_manquantes.
- Sois bref : reponse_courte en deux phrases au plus, au plus 5 constats et 4 actions, chaque texte en une phrase.
Réponds uniquement avec le JSON demandé."""

VERIFIER_SYSTEM = """Tu es le vérificateur. Tu décides si les extraits soutiennent réellement l'affirmation.
soutenu=true seulement si le contenu de l'affirmation se déduit directement des extraits. Une action à vérifier est soutenue si le fait qui la motive figure dans les extraits.
soutenu=false si l'affirmation présente une hypothèse comme un fait, ajoute une valeur absente, conclut à une productivité ou une qualité à partir d'un niveau déclaré, ou affirme une cause non établie.
Donne une raison courte. Réponds uniquement avec le JSON demandé."""

RETRIEVER_SYSTEM = """Tu es le rôle de recherche. Tu transformes la question en requêtes pour un index de données industrielles.
L'index contient : opérations MES (postes, durées, aléas, causes potentielles), pièces et fournisseurs PLM, supply chain (délais, classes ABC, rétro-planning), indicateurs, profils ERP pseudonymisés (compétences, habilitations, rotations), contrôles, données absentes, notice.
Donne 1 à 4 requêtes courtes en français avec les mots utiles, et les identifiants cités (numéro de poste, référence). Réponds uniquement avec le JSON demandé."""

RETRIEVER_SCHEMA = {"type": "object", "properties": {"requetes": {"type": "array", "items": {"type": "string"}}, "postes": {"type": "array", "items": {"type": "integer"}}, "references": {"type": "array", "items": {"type": "string"}}}, "required": ["requetes"]}
ANALYST_SCHEMA = {"type": "object", "properties": {
    "reponse_courte": {"type": "string"},
    "constats": {"type": "array", "items": {"type": "object", "properties": {"texte": {"type": "string"}, "citations": {"type": "array", "items": {"type": "string"}}}, "required": ["texte", "citations"]}},
    "actions": {"type": "array", "items": {"type": "object", "properties": {"action": {"type": "string"}, "cible": {"type": "string"}, "fait": {"type": "string"}, "mesure": {"type": "string"}, "citations": {"type": "array", "items": {"type": "string"}}}, "required": ["action", "cible", "fait", "mesure", "citations"]}},
    "donnees_manquantes": {"type": "array", "items": {"type": "string"}}}, "required": ["reponse_courte", "constats", "actions", "donnees_manquantes"]}
VERIFIER_SCHEMA = {"type": "object", "properties": {"soutenu": {"type": "boolean"}, "raison": {"type": "string"}}, "required": ["soutenu", "raison"]}


def tokenize(text):
    t = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode().lower()
    t = t.replace("'", " ")
    toks = re.findall(r"[a-z0-9]+", t)
    out = []
    for w in toks:
        if w in STOP or len(w) < 2:
            continue
        if len(w) > 4 and w.endswith("s"):
            w = w[:-1]
        out.append(w)
    return out


class Index:
    """BM25 sur les documents autorises (operations, pieces, fournisseurs, KPI, profils pseudonymises, controles)."""

    def __init__(self, docs):
        self.docs = docs; self.by_id = {d["id"]: d for d in docs}
        self.tf = []; self.df = Counter(); self.len = []
        for d in docs:
            tf = Counter(tokenize(d["titre"] + " " + d["titre"] + " " + d["texte"]))
            self.tf.append(tf); self.len.append(sum(tf.values())); self.df.update(tf.keys())
        self.avg = sum(self.len) / max(1, len(self.len))

    def search(self, query, k=12):
        qt = tokenize(query); N = len(self.docs); scores = []
        for i, tf in enumerate(self.tf):
            s = 0.0
            for w in qt:
                if w in tf:
                    idf = math.log(1 + (N - self.df[w] + .5) / (self.df[w] + .5))
                    s += idf * tf[w] * 2.2 / (tf[w] + 1.2 * (0.25 + 0.75 * self.len[i] / self.avg))
            if s > 0:
                scores.append((s, i))
        scores.sort(key=lambda x: -x[0])
        return [(self.docs[i], s) for s, i in scores[:k]]


def detect_entities(question, index):
    q = question
    postes = {int(x) for x in re.findall(r"\bposte\s*n?°?\s*(\d{1,3})\b", q, re.I)}
    refs = {r.upper() for r in re.findall(r"\b([ACDacd]\d{3})\b", q)}
    pids = {p.upper() for p in re.findall(r"\b(PX[0-9A-Fa-f]{6})\b", q)}
    sup = []
    nq = " ".join(tokenize(q))
    for d in index.docs:
        if d["type"] == "fournisseur":
            name = " ".join(tokenize(d["titre"].replace("Fournisseur ", "")))
            first = name.split(" ")[0] if name else ""
            if name and (name in nq or (len(first) > 4 and first in nq.split(" "))):
                sup.append(d["id"])
    return postes, refs, pids, sup


def retrieve(index, question, queries, postes, refs, limit=12):
    """Selection deterministe et reproductible. Les entites explicites passent avant le score lexical."""
    p2, r2, pids, sups = detect_entities(question, index)
    postes = set(postes) | p2; refs = {str(r).upper() for r in refs} | r2
    picked, reasons = [], {}
    def take(doc, why):
        if doc and doc["id"] not in reasons:
            picked.append(doc); reasons[doc["id"]] = why
    for d in index.docs:
        if d.get("poste") in postes and d["type"] == "operation":
            take(d, "poste cité")
    for pst in sorted(postes):
        take(index.by_id.get(f"POSTE!{pst}"), "poste cité")
    for d in index.docs:
        if d.get("ref") in refs:
            take(d, "référence citée")
    for pid in pids:
        take(index.by_id.get(f"ERP!{pid}"), "profil cité")
    for s in sups:
        take(index.by_id.get(s), "fournisseur cité")
        for ref in re.findall(r"\b[ACD]\d{3}\b", index.by_id[s]["texte"])[:4]:
            for d in index.docs:
                if d.get("ref") == ref:
                    take(d, "référence du fournisseur cité")
    if postes:
        for d in index.docs:
            if d["type"] == "profil" and d.get("poste") in postes and len(picked) < limit - 2:
                take(d, "profil du poste cité")
    agg = defaultdict(float); docs = {}
    for w, q in enumerate([question] + list(queries)[:4]):
        for d, s in index.search(q, 14):
            agg[d["id"]] += s * (1.3 if w == 0 else 1); docs[d["id"]] = d
    for did, _ in sorted(agg.items(), key=lambda x: -x[1]):
        if len(picked) >= limit:
            break
        take(docs[did], "score lexical")
    for d in picked:
        d["_why"] = reasons[d["id"]]
    return picked


def parse_json(text):
    t = re.sub(r"^```(?:json)?|```$", "", (text or "").strip(), flags=re.M).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", t, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                return None
    return None


def numbers_in(text):
    s = re.sub(r"\b[A-Z0-9]+![^\s,;:)\]]+|\b[ACD]\d{3}\b|\bPX[0-9A-F]{6}\b", " ", str(text))
    return re.findall(r"\d{1,2}:\d{2}:\d{2}|\d+(?:[.,]\d+)?", s)


def _num_key(n):
    if ":" in n:
        return n
    try:
        return f"{float(n.replace(',', '.')):g}"
    except ValueError:
        return n


def unsupported_numbers(claim, evidence_text):
    allowed = {_num_key(n) for n in numbers_in(evidence_text.replace(" ", " "))}
    out = []
    for n in numbers_in(claim):
        k = _num_key(n)
        if k in allowed:
            continue
        if ":" not in n and "." not in n and "," not in n and int(n) <= 12:  # petits denombrements et numerotations
            continue
        out.append(n)
    return out


INLINE_CITE_RE = re.compile(r"\s*[\[(]?\b(?:MES|PLM|ERP|POSTE|KPI|GAP|SUP|ZONE|6M|ANOM|NOTICE|JOIN|FIL|SUPPLY|SESSION)![^\s,;)\]]+[\])]?")


def clean_text(t):
    """Retire les identifiants de citation recopies dans le texte : ils sont affiches a part."""
    t = INLINE_CITE_RE.sub("", str(t or "")).strip()
    return re.sub(r"\s*(?:selon|d'après)\s+(?:les\s+)?preuves?(?:\s+et)?\s*(?=\.|$)", "", t).strip()


def _flat_claims(result):
    claims = []
    for i, c in enumerate(result.get("constats") or []):
        if isinstance(c, dict):
            claims.append({"id": f"C{i + 1}", "kind": "constat", "texte": str(c.get("texte", "")).strip(), "citations": c.get("citations") or [], "item": c})
    for i, a in enumerate(result.get("actions") or []):
        if isinstance(a, dict):
            txt = " ".join(str(a.get(k, "")) for k in ("action", "cible", "fait", "mesure")).strip()
            claims.append({"id": f"A{i + 1}", "kind": "action", "texte": txt, "citations": a.get("citations") or [], "item": a})
    return claims


def server_validate(result, index, evidence_ids):
    """Controle deterministe : les citations existent, ont ete fournies, et les chiffres s'y retrouvent."""
    ok, rejected, seen = [], [], set()
    for c in _flat_claims(result):
        cites = [str(x).strip().strip("[]") for x in c["citations"] if str(x).strip()]
        reason = None
        key = " ".join(tokenize(c["texte"]))
        if key in seen:  # le modele repete parfois un constat : une seule occurrence est gardee
            continue
        seen.add(key)
        if not c["texte"]:
            reason = "Affirmation vide."
        elif not cites:
            reason = "Aucune citation."
        else:
            bad = [x for x in cites if x not in index.by_id or not CITATION_RE.match(x)]
            outside = [x for x in cites if x in index.by_id and x not in evidence_ids]
            if bad:
                reason = "Citation inexistante : " + ", ".join(bad[:4])
            elif outside:
                reason = "Citation hors des preuves transmises : " + ", ".join(outside[:4])
        if not reason:
            ev = " ".join(index.by_id[x]["texte"] for x in cites)
            miss = unsupported_numbers(c["texte"], ev)
            if GAIN_RE.search(c["texte"]):
                reason = "Gain chiffré sans mesures comparables avant et après."
            elif miss:
                reason = "Chiffre absent des preuves citées : " + ", ".join(miss[:5])
            elif TUTOR_RE.search(c["texte"]) and not any(x.startswith(("ERP!", "POSTE!", "SESSION!")) for x in cites):
                reason = "Tutorat sans compétence déclarée citée."
        c["citations"] = cites
        if reason:
            rejected.append({"id": c["id"], "kind": c["kind"], "texte": c["texte"], "citations": cites, "motif": reason, "etape": "serveur"})
        else:
            ok.append(c)
    return ok, rejected


def session_docs(overrides, persons):
    """Affectations modifiees dans l'interface : uniquement des identifiants internes et des pseudonymes."""
    docs = []
    by = {p["person_id"]: p for p in persons}
    for pid, poste in (overrides or {}).items():
        p = by.get(pid)
        if p and isinstance(poste, int) and poste != p["poste_origine"]:
            docs.append({"id": f"SESSION!{pid}", "type": "session", "titre": f"Affectation en session {p['pseudo']}", "texte": f"Modification en session, non présente dans l'ERP : {p['pseudo']} ({pid}), poste d'origine {p['poste_origine']}, sélectionné au poste {poste}."})
    return docs


def assert_private(payload_text, identity_needles, forbidden=("taux_horaire", "coût horaire", "cout horaire", "matricule")):
    low = payload_text.lower()
    for f in forbidden:
        if f in low:
            raise PrivacyViolation(f"champ interdit « {f} »")
    if re.search(r"\bAIR\d{4}\b", payload_text):
        raise PrivacyViolation("matricule")
    for n in identity_needles:
        if n in low:
            raise PrivacyViolation("nom complet")


class PrivacyViolation(RuntimeError):
    pass


def run_chain(client, index_docs, question, identity_needles=(), overrides_docs=(), on_step=None, limit=12):
    """Execute les trois roles et renvoie resultat + journal auditable (prompts et ids transmis)."""
    trace = []
    def step(role, state, **info):
        trace.append({"role": role, "state": state, "t": round(time.time(), 2), **info})
        if on_step:
            on_step(role, state, info)
    index = Index(list(index_docs) + list(overrides_docs))

    # Role 1 : recherche des preuves
    step("recherche", "en_cours")
    p1 = f"Question de l'utilisateur :\n{question}"
    assert_private(question, identity_needles, forbidden=())
    t0 = time.time()
    r1 = client.generate(p1, system=RETRIEVER_SYSTEM, schema=RETRIEVER_SCHEMA, num_predict=160, num_ctx=2048)
    parsed1 = parse_json(r1["text"]) or {}
    queries = [str(q) for q in (parsed1.get("requetes") or []) if str(q).strip()]
    postes = [int(x) for x in (parsed1.get("postes") or []) if isinstance(x, int)]
    refs = [str(x) for x in (parsed1.get("references") or [])]
    evidence = retrieve(index, question, queries, postes, refs, limit)
    evidence_ids = {d["id"] for d in evidence}
    step("recherche", "termine", duree_s=round(time.time() - t0, 1), requetes=queries, sortie_modele_valide=bool(parsed1), preuves=[{"id": d["id"], "titre": d["titre"], "raison": d["_why"]} for d in evidence])

    # Role 2 : analyse
    step("analyse", "en_cours")
    ev_text = "\n".join(f"[{d['id']}] {d['texte']}" for d in evidence) or "(aucune preuve trouvée)"
    p2 = f"PREUVES :\n{ev_text}\n\nQUESTION :\n{question}\n\nProduis l'analyse et les actions en citant les identifiants entre crochets ci-dessus (sans les crochets dans le champ citations)."
    assert_private(ev_text, identity_needles)
    assert_private(question, identity_needles, forbidden=())
    t0 = time.time()
    r2 = client.generate(p2, system=ANALYST_SYSTEM, schema=ANALYST_SCHEMA, num_predict=1600, num_ctx=8192)
    result = parse_json(r2["text"])
    if result is None:  # sortie tronquee : une seconde tentative, plus courte
        step("analyse", "nouvelle_tentative", motif=r2.get("done_reason"))
        r2 = client.generate(p2 + "\n\nRéponse tronquée précédemment : au plus 3 constats et 2 actions, très courts.", system=ANALYST_SYSTEM, schema=ANALYST_SCHEMA, num_predict=1600, num_ctx=8192)
        result = parse_json(r2["text"])
    if result is None:
        step("analyse", "echec", duree_s=round(time.time() - t0, 1), sortie_brute=r2["text"][:500])
        raise OllamaError("echec_generation", "Le rôle d'analyse n'a pas produit de JSON exploitable. Réessayez ou changez de modèle.", r2.get("done_reason"))
    step("analyse", "termine", duree_s=round(time.time() - t0, 1), constats=len(result.get("constats") or []), actions=len(result.get("actions") or []))

    # Controle serveur puis role 3 : verification
    ok, rejected = server_validate(result, index, evidence_ids)
    step("controle_serveur", "termine", acceptees=len(ok), refusees=len(rejected), motifs=[r["motif"] for r in rejected])
    verdicts = {}
    summary = str(result.get("reponse_courte") or "").strip()
    def verify(cid, text, cites):
        ext = "\n".join(f"[{x}] {index.by_id[x]['texte']}" for x in cites)
        p3 = f"AFFIRMATION :\n{text}\n\nEXTRAITS :\n{ext}"
        assert_private(p3, identity_needles, forbidden=())
        r3 = client.generate(p3, system=VERIFIER_SYSTEM, schema=VERIFIER_SCHEMA, num_predict=140, num_ctx=4096)
        parsed = parse_json(r3["text"])
        if isinstance(parsed, dict) and isinstance(parsed.get("soutenu"), bool):
            return {"id": cid, "soutenu": parsed["soutenu"], "raison": str(parsed.get("raison") or "")}
        return None
    if ok:
        step("verification", "en_cours")
        t0 = time.time()
        for c in ok:
            v = verify(c["id"], c["texte"], c["citations"])
            if v:
                verdicts[c["id"]] = v
        step("verification", "termine", duree_s=round(time.time() - t0, 1), verdicts=list(verdicts.values()))

    # Decision : rien n'est affiche comme verifie sans verdict positif du role de verification.
    constats, actions = [], []
    for c in ok:
        v = verdicts.get(c["id"])
        cit = [{"id": x, "titre": index.by_id[x]["titre"], "extrait": index.by_id[x]["texte"][:320], "ligne_source": index.by_id[x].get("ligne_source")} for x in c["citations"]]
        if v is None or v.get("soutenu") is not True:
            rejected.append({"id": c["id"], "kind": c["kind"], "texte": c["texte"], "citations": c["citations"], "motif": ("Non soutenue : " + str(v.get("raison"))) if v else "Pas de verdict du rôle de vérification.", "etape": "verification"})
            continue
        if c["kind"] == "constat":
            constats.append({"texte": clean_text(c["texte"]), "citations": cit, "verdict": v.get("raison")})
        else:
            a = c["item"]
            actions.append({"action": clean_text(a.get("action")), "cible": clean_text(a.get("cible")), "fait": clean_text(a.get("fait")), "mesure": clean_text(a.get("mesure")), "citations": cit, "verdict": v.get("raison"), "validation_humaine": bool(TUTOR_RE.search(c["texte"]))})
    missing = [str(x) for x in (result.get("donnees_manquantes") or []) if str(x).strip()]
    state = "reponse_verifiee" if (constats or actions) else "preuves_insuffisantes"
    absent_docs = [{"id": d["id"], "titre": d["titre"], "texte": d["texte"]} for d in evidence if d["type"] in ("donnee_absente", "fil_numerique")]
    return {"etat": state, "question": question, "synthese_non_verifiee": summary, "constats": constats, "actions": actions, "donnees_manquantes": missing, "donnees_absentes_index": absent_docs, "refusees": rejected, "trace": trace,
            "perimetre": {"model": client.model, "preuves_transmises": [{"id": d["id"], "type": d["type"], "titre": d["titre"]} for d in evidence], "champs_exclus": ["noms complets", "matricules", "âge", "taux horaires individuels", "commentaires de carrière"]}}
