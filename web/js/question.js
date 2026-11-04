// Question : une page blanche, une ligne, une reponse sourcee.
import { api, esc, openDrawer, store, toast } from './core.js';

const D = { question: '', job: null, jobId: null, status: null, test: null, timer: null, pullTimer: null };
const ROLES = [['recherche', 'Recherche'], ['analyse', 'Analyse'], ['verification', 'Vérification']];
const STATE = { pret: ['ok', 'En service'], service_arrete: ['bad', 'Arrêté'], modele_manquant: ['bad', 'Modèle manquant'], modele_non_configure: ['', 'Modèle à choisir'], telechargement: ['', 'Téléchargement'], non_local: ['bad', 'Adresse refusée'] };
function suggestions() { const A = store.analysis; return [`Que vérifier en priorité au poste ${A.candidates[0].poste} ?`, `Quels risques d'approvisionnement avec ${A.suppliers[0].fournisseur} ?`, `Qui pourrait accompagner sur la soudure au poste ${A.operations.find(o => /soudure/i.test(o.alea))?.poste ?? A.candidates[0].poste} ?`, 'Quelles commandes faut-il lancer en premier ?']; }
export function renderQuestion(root, route) {
  const arg = route.arg || {}; if (arg.question) D.question = arg.question;
  root.innerHTML = `<div class="ask"><div class="ask-main"><textarea id="q" rows="1" aria-label="Question" placeholder="Question sur un poste, une pièce, un fournisseur, une compétence">${esc(D.question)}</textarea>
   <div class="sugg" id="sugg">${suggestions().map(s => `<button data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
   <div id="chain"></div><div id="answer" class="ans"></div></div><aside class="ask-side"><h2>Ollama</h2><div id="ollama"></div><h2>Données transmises</h2><p class="sub" style="margin-top:6px">Opérations, pièces, fournisseurs, KPI, contrôles, notice, profils pseudonymisés. Jamais de noms complets, matricules, âges, taux individuels ni commentaires de carrière.</p></aside></div>`;
  const q = document.getElementById('q'); const fit = () => { q.style.height = 'auto'; q.style.height = q.scrollHeight + 'px'; }; fit();
  q.oninput = e => { D.question = e.target.value; fit(); };
  q.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } };
  root.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { D.question = b.dataset.q; q.value = D.question; fit(); ask(); });
  drawChain(); drawAnswer(); status();
  if (D.jobId && D.job?.state === 'running') poll();
  if (arg.question && arg.auto) { route.arg = null; ask(); } else if (!D.job) q.focus({ preventScroll: true });
}
async function status() { try { D.status = await api('/api/ollama/status'); } catch (e) { D.status = { state: 'erreur', message: e.message, models: [], config: {} }; } drawOllama(); }
function drawOllama() {
  const el = document.getElementById('ollama'); if (!el) return; const s = D.status || {}; const ui = STATE[s.state] || ['', s.state || '…']; const cfg = s.config || {}; const cur = cfg.model || s.model || '';
  el.innerHTML = `<p style="margin:7px 0"><span class="dot ${ui[0]}"></span>${esc(ui[1])}${cur ? `, ${esc(cur)}` : ''}</p><details ${s.state !== 'pret' ? 'open' : ''}><summary>Réglages</summary><div style="margin-top:8px">${s.state !== 'pret' ? `<p class="sub" style="margin-bottom:10px">${esc(s.message || '')}</p>` : ''}
   <label class="sub">Modèle<input class="field" id="mName" list="mList" value="${esc(cur)}"><datalist id="mList">${(s.models || []).map(m => `<option value="${esc(m)}">`).join('')}</datalist></label>
   <label class="sub">Adresse locale<input class="field" id="mUrl" value="${esc(cfg.base_url || '')}"></label>
   <label class="sub">Délai par étape, en secondes<input class="field" id="mT" type="number" min="10" max="3600" value="${esc(cfg.timeout_s || 300)}"></label>
   <div class="acts" style="margin-top:4px"><button class="btn red" id="mTest">Tester le modèle</button><button class="btn" id="mSave">Enregistrer</button><button class="btn" id="mPull">Télécharger</button><button class="btn" id="mRe">Actualiser</button></div><div id="mRes" style="margin-top:12px">${D.test ? testHtml(D.test) : ''}</div>${s.pull ? `<p class="sub">${esc(s.pull.status)} ${s.pull.total ? Math.round(s.pull.completed / s.pull.total * 100) + ' %' : ''}</p>` : ''}</div></details>`;
  const save = () => api('/api/ollama/config', { model: document.getElementById('mName').value, base_url: document.getElementById('mUrl').value, timeout_s: +document.getElementById('mT').value });
  document.getElementById('mSave').onclick = async () => { try { await save(); toast('Enregistré.'); status(); } catch (e) { toast(e.message); } };
  document.getElementById('mRe').onclick = status;
  document.getElementById('mTest').onclick = async e => { e.target.disabled = true; e.target.textContent = 'Génération…'; try { await save(); D.test = await api('/api/ollama/test', {}); } catch (x) { D.test = { ok: false, code: 'erreur', message: x.message }; } status(); };
  document.getElementById('mPull').onclick = async () => { try { await save(); const r = await api('/api/ollama/pull', { model: document.getElementById('mName').value }); pollPull(r.job); } catch (x) { toast(x.message); } };
}
const testHtml = t => t.ok ? `<p class="sub">Génération réussie, ${(t.duration_ms / 1000).toFixed(1).replace('.', ',')} s.</p>` : `<p class="note">${esc(t.message)}</p>`;
function pollPull(id) { clearInterval(D.pullTimer); D.pullTimer = setInterval(async () => { const j = await api('/api/job/' + id); if (j.state !== 'running') { clearInterval(D.pullTimer); toast(j.state === 'done' ? 'Modèle téléchargé.' : (j.error?.message || 'Échec du téléchargement.')); } status(); }, 1500); status(); }
async function ask() {
  const q = (document.getElementById('q')?.value || D.question).trim(); if (!q) return;
  D.question = q; D.job = { state: 'running', steps: [] }; document.getElementById('sugg')?.classList.add('hidden'); drawChain(); drawAnswer();
  try { const r = await api('/api/ask', { question: q, overrides: store.overrides }); D.jobId = r.job; poll(); }
  catch (e) { D.job = { state: 'error', steps: [], error: { code: 'erreur', message: e.message } }; drawChain(); drawAnswer(); }
}
function poll() { clearInterval(D.timer); D.timer = setInterval(async () => { try { D.job = await api('/api/job/' + D.jobId); } catch { return; } if (D.job.state !== 'running') { clearInterval(D.timer); drawAnswer(); } drawChain(); }, 900); }
function drawChain() {
  const el = document.getElementById('chain'); if (!el) return; if (!D.job) { el.innerHTML = ''; return; } const steps = D.job.steps || []; const trace = D.job.result?.trace;
  el.innerHTML = `<div class="steps">${ROLES.map(([r, l]) => { const s = steps.filter(x => x.role === r).at(-1); const st = s?.state === 'nouvelle_tentative' ? 'en_cours' : s?.state || ''; return `<span class="${st}">${l}${s?.duree_s != null ? ` ${Math.round(s.duree_s)} s` : ''}</span>`; }).join('')}${trace ? '<button class="link" id="showTrace" style="font-size:12.5px">Journal</button>' : ''}</div>`;
  const b = document.getElementById('showTrace'); if (b) b.onclick = () => openDrawer(`<h2>Journal de la chaîne</h2><pre style="white-space:pre-wrap;font-size:11px">${esc(JSON.stringify({ trace, perimetre: D.job.result.perimetre }, null, 1))}</pre>`);
}
const cites = list => list.map(c => `<button class="cite" data-cite="${esc(c.id)}">${esc(c.titre.length > 44 ? c.titre.slice(0, 43) + '…' : c.titre)}</button>`).join('');
function drawAnswer() {
  const el = document.getElementById('answer'); if (!el) return; const j = D.job;
  if (!j || j.state === 'running') { el.innerHTML = ''; return; }
  if (j.state === 'error') { el.innerHTML = `<p class="note" style="margin-top:14px">${esc(j.error?.message)}</p>`; return; }
  const r = j.result; const all = {}; [...r.constats, ...r.actions].forEach(c => c.citations.forEach(x => all[x.id] = x));
  el.innerHTML = `${r.etat !== 'reponse_verifiee' ? '<h2>Pas de réponse sourcée</h2>' : ''}${r.constats.length ? `<h2>Constats</h2>${r.constats.map(c => `<div class="claim">${esc(c.texte)}<div style="margin-top:5px">${cites(c.citations)}</div></div>`).join('')}` : ''}
   ${r.actions.length ? `<h2>Actions à vérifier</h2>${r.actions.map(a => `<div class="claim">${esc(a.action)}<dl class="facts"><dt>Concerne</dt><dd>${esc(a.cible)}</dd><dt>Fait</dt><dd>${esc(a.fait)}</dd><dt>Mesure</dt><dd>${esc(a.mesure)}</dd></dl>${a.validation_humaine ? '<span class="tag red">Validation responsable</span>' : ''}${cites(a.citations)}</div>`).join('')}` : ''}
   ${r.donnees_manquantes.length ? `<h2>Données à collecter</h2>${r.donnees_manquantes.map(x => `<div class="claim" style="font-size:15px">${esc(x)}</div>`).join('')}` : ''}
   ${r.refusees.length ? `<details style="margin-top:24px"><summary>${r.refusees.length} affirmation${r.refusees.length > 1 ? 's écartées' : ' écartée'}</summary>${r.refusees.map(x => `<div class="claim" style="font-size:13.5px;color:var(--ink2)">${esc(x.motif)}<br>${esc(x.texte)}</div>`).join('')}</details>` : ''}`;
  el.querySelectorAll('[data-cite]').forEach(b => b.onclick = () => { const c = all[b.dataset.cite]; openDrawer(`<h2 style="font-weight:300;font-size:22px">${esc(c.titre)}</h2><p style="margin-top:10px">${esc(c.extrait)}…</p>${c.ligne_source ? `<p class="sub" style="margin-top:8px">Ligne source : ${esc(c.ligne_source)}</p>` : ''}${/^(MES|PLM|NOTICE|KPI|ANOM)/.test(c.id) ? `<p style="margin-top:12px"><button class="link" style="color:#ff8a8a" data-src="${esc(c.id)}">Ligne source</button></p>` : ''}`); });
}
