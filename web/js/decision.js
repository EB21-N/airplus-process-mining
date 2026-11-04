import { api, esc, openDrawer, store, toast } from './core.js';

const D = { question: '', job: null, jobId: null, status: null, test: null, timer: null, pullTimer: null };
const ROLES = [['recherche', 'Je cherche', 'les lignes utiles dans les données'], ['analyse', 'J\'analyse', 'et je propose des actions'], ['verification', 'Je vérifie', 'chaque affirmation et sa source']];
const STATE_UI = { pret: ['ok', 'IA prête'], service_arrete: ['red', 'IA arrêtée'], modele_manquant: ['red', 'Modèle à installer'], modele_non_configure: ['warn', 'Modèle à choisir'], telechargement: ['warn', 'Téléchargement…'], non_local: ['red', 'Adresse refusée'] };

function suggestions() {
  const A = store.analysis; const c = A.candidates[0]; const s = A.suppliers[0]; const skill = A.skills.find(x => x.competence === 'Soudure');
  void skill;
  return [`Que vérifier en priorité au poste ${c.poste} ?`, `Quels risques d'approvisionnement avec ${s.fournisseur} ?`, `Qui pourrait accompagner sur la soudure au poste ${A.operations.find(o => /soudure/i.test(o.alea))?.poste ?? c.poste} ?`, 'Quelles commandes faut-il lancer en premier ?'];
}
export function renderDecision(root, route) {
  const arg = route.arg || {}; if (arg.question) D.question = arg.question;
  root.innerHTML = `<div class="ask"><div>
    <section class="hero" style="grid-template-columns:1fr"><div><h1>Posez votre question, <em>l'IA répond avec ses sources</em>.</h1><p>Elle tourne sur cet ordinateur. Rien ne sort de la machine, et elle ne reçoit ni noms ni taux individuels.</p></div>
      <div><textarea id="q" aria-label="Votre question" placeholder="Une question sur un poste, une pièce, un fournisseur, une compétence…">${esc(D.question)}</textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap"><button class="btn primary" id="askBtn">Analyser</button><span class="sub" id="askMsg"></span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${suggestions().map(s => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div></div></section>
    <div id="chain" class="mt"></div><div id="answer" class="mt"></div></div>
   <div><div class="card" id="ollama"><h2>L'IA locale</h2><p class="sub">Vérification…</p></div></div></div>`;
  document.getElementById('q').oninput = e => { D.question = e.target.value; };
  document.getElementById('askBtn').onclick = ask;
  root.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { D.question = b.dataset.q; document.getElementById('q').value = D.question; ask(); });
  drawChain(); drawAnswer(); status();
  if (D.jobId && D.job?.state === 'running') poll();
  if (arg.question && arg.auto) { route.arg = null; ask(); }
}
async function status() { try { D.status = await api('/api/ollama/status'); } catch (e) { D.status = { state: 'erreur', message: e.message, models: [], config: {} }; } drawOllama(); }
function drawOllama() {
  const el = document.getElementById('ollama'); if (!el) return; const s = D.status || {}; const ui = STATE_UI[s.state] || ['warn', s.state || '…'];
  const cfg = s.config || {}; const cur = cfg.model || s.model || '';
  el.innerHTML = `<h2>L'IA locale</h2><p style="margin:6px 0"><span class="badge ${ui[0]}">${esc(ui[1])}</span> ${cur ? `<span class="sub">${esc(cur)}</span>` : ''}</p>${s.state !== 'pret' ? `<p class="sub">${esc(s.message || '')}</p>` : ''}
   <button class="btn small primary" id="mTest">Tester le modèle</button><div id="mRes" class="mt">${D.test ? testHtml(D.test) : ''}</div>
   <details class="mt" ${s.state !== 'pret' ? 'open' : ''}><summary>Réglages</summary>
   <label class="sub" style="display:block;margin-top:6px">Modèle<input id="mName" type="text" list="mList" value="${esc(cur)}" style="width:100%"><datalist id="mList">${(s.models || []).map(m => `<option value="${esc(m)}">`).join('')}</datalist></label>
   <label class="sub" style="display:block;margin-top:6px">Adresse locale<input id="mUrl" type="text" value="${esc(cfg.base_url || '')}" style="width:100%"></label>
   <label class="sub" style="display:block;margin-top:6px">Délai par étape (s)<input id="mT" type="number" min="10" max="3600" value="${esc(cfg.timeout_s || 300)}" style="width:100%"></label>
   <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="btn small" id="mSave">Enregistrer</button><button class="btn small" id="mPull">Télécharger le modèle</button><button class="btn small" id="mRe">Actualiser</button></div></details>${s.pull ? `<p class="sub mt">${esc(s.pull.status)} ${s.pull.total ? Math.round(s.pull.completed / s.pull.total * 100) + ' %' : ''}</p>` : ''}`;
  const save = () => api('/api/ollama/config', { model: document.getElementById('mName').value, base_url: document.getElementById('mUrl').value, timeout_s: +document.getElementById('mT').value });
  document.getElementById('mSave').onclick = async () => { try { await save(); toast('Réglages enregistrés.'); status(); } catch (e) { toast(e.message); } };
  document.getElementById('mRe').onclick = status;
  document.getElementById('mTest').onclick = async e => { e.target.disabled = true; e.target.textContent = 'Génération…'; try { await save(); D.test = await api('/api/ollama/test', {}); } catch (x) { D.test = { ok: false, code: 'erreur', message: x.message }; } status(); };
  document.getElementById('mPull').onclick = async () => { try { await save(); const r = await api('/api/ollama/pull', { model: document.getElementById('mName').value }); pollPull(r.job); } catch (x) { toast(x.message); } };
}
const testHtml = t => t.ok ? `<p class="note">Le modèle répond (${(t.duration_ms / 1000).toFixed(1).replace('.', ',')} s).</p>` : `<p class="note red">${esc(t.message)}</p>`;
function pollPull(id) { clearInterval(D.pullTimer); D.pullTimer = setInterval(async () => { const j = await api('/api/job/' + id); if (j.state !== 'running') { clearInterval(D.pullTimer); toast(j.state === 'done' ? 'Modèle téléchargé.' : (j.error?.message || 'Échec du téléchargement.')); } status(); }, 1500); status(); }

async function ask() {
  const q = (document.getElementById('q')?.value || D.question).trim(); const msg = document.getElementById('askMsg');
  if (!q) { msg.textContent = 'Écrivez une question.'; return; }
  D.question = q; D.job = { state: 'running', steps: [] }; drawChain(); drawAnswer(); msg.textContent = 'En général une à deux minutes sur ce type de machine.';
  try { const r = await api('/api/ask', { question: q, overrides: store.overrides }); D.jobId = r.job; poll(); }
  catch (e) { D.job = { state: 'error', steps: [], error: { code: 'erreur', message: e.message } }; drawChain(); drawAnswer(); msg.textContent = ''; }
}
function poll() {
  clearInterval(D.timer);
  D.timer = setInterval(async () => {
    try { D.job = await api('/api/job/' + D.jobId); } catch { return; }
    if (D.job.state !== 'running') { clearInterval(D.timer); const m = document.getElementById('askMsg'); if (m) m.textContent = ''; status(); drawAnswer(); }
    drawChain();
  }, 900);
}
function drawChain() {
  const el = document.getElementById('chain'); if (!el) return; if (!D.job) { el.innerHTML = ''; return; }
  const steps = D.job.steps || []; const trace = D.job.result?.trace;
  el.innerHTML = `<div class="stepper">${ROLES.map(([r, l, d]) => { const s = steps.filter(x => x.role === r).at(-1); const st = s?.state === 'nouvelle_tentative' ? 'en_cours' : s?.state || ''; return `<div class="step ${st}"><b>${esc(l)}</b><span class="sub">${s?.duree_s != null ? Math.round(s.duree_s) + ' s' : esc(d)}</span></div>`; }).join('')}</div>${trace ? '<p class="sub" style="margin-top:6px"><button class="link" id="showTrace">Voir le détail de la chaîne</button></p>' : ''}`;
  const b = document.getElementById('showTrace'); if (b) b.onclick = () => openDrawer(`<h2>Détail de la chaîne</h2><pre style="white-space:pre-wrap;font-size:11px">${esc(JSON.stringify({ trace, perimetre: D.job.result.perimetre }, null, 1))}</pre>`);
}
const cites = list => list.map(c => `<button class="src" data-cite="${esc(c.id)}">${esc(c.titre.length > 42 ? c.titre.slice(0, 41) + '…' : c.titre)}</button>`).join(' ');
function drawAnswer() {
  const el = document.getElementById('answer'); if (!el) return; const j = D.job;
  if (!j || j.state === 'running') { el.innerHTML = ''; return; }
  if (j.state === 'error') { const e = j.error || {}; el.innerHTML = `<div class="card"><p class="note red"><b>L'IA n'a pas pu répondre.</b> ${esc(e.message)}</p><p class="sub">Le reste du tableau de bord fonctionne sans elle.</p></div>`; return; }
  const r = j.result; const all = {}; [...r.constats, ...r.actions].forEach(c => c.citations.forEach(x => all[x.id] = x));
  el.innerHTML = `<div class="card"><p class="sub">${esc(r.question)}</p>
   ${r.etat !== 'reponse_verifiee' ? `<h2>Les données ne permettent pas de répondre.</h2>` : ''}
   ${r.constats.length ? `<h2 class="mt">Ce que disent les données</h2>${r.constats.map(c => `<div class="claim">${esc(c.texte)}<div style="margin-top:5px">${cites(c.citations)}</div></div>`).join('')}` : ''}
   ${r.actions.length ? `<h2 class="mt">Ce que vous pouvez vérifier</h2>${r.actions.map(a => `<div class="claim"><b>${esc(a.action)}</b><dl class="facts"><dt>Concerne</dt><dd>${esc(a.cible)}</dd><dt>Pourquoi</dt><dd>${esc(a.fait)}</dd><dt>À suivre</dt><dd>${esc(a.mesure)}</dd></dl>${a.validation_humaine ? '<span class="tag session">À valider par un responsable</span> ' : ''}${cites(a.citations)}</div>`).join('')}` : ''}
   ${r.donnees_manquantes.length ? `<h3 class="mt">Pour aller plus loin, il faudrait</h3><ul>${r.donnees_manquantes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
   ${r.refusees.length ? `<details class="mt"><summary>${r.refusees.length} affirmation${r.refusees.length > 1 ? 's écartées' : ' écartée'} par les contrôles</summary>${r.refusees.map(x => `<div class="claim sub"><b>${esc(x.motif)}</b><br>${esc(x.texte)}</div>`).join('')}</details>` : ''}
   <p class="sub mt">Une proposition de l'IA reste à confirmer sur le terrain. Cliquez sur une source pour lire la ligne d'origine.</p></div>`;
  el.querySelectorAll('[data-cite]').forEach(b => b.onclick = () => { const c = all[b.dataset.cite]; openDrawer(`<h2>${esc(c.titre)}</h2><p>${esc(c.extrait)}…</p>${c.ligne_source ? `<p class="sub">Ligne source : ${esc(c.ligne_source)}</p>` : ''}${/^(MES|PLM|NOTICE|KPI|ANOM)/.test(c.id) ? `<p><button class="src" data-src="${esc(c.id)}">Voir la ligne d'origine</button></p>` : ''}`); });
}
