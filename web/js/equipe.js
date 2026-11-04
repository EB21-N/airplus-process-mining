import { api, displayName, dur, esc, FIT_LABEL, fit, onChange, posteOf, resetAssignments, reviewCount, setAssignment, sheet, src, store, teamOf, toast } from './core.js';

const T = { q: '', poste: null, review: false };
const LV = n => `<span class="lvl" role="img" aria-label="niveau ${n} sur 3">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

export function renderEquipe(root, route) {
  if (route.arg?.poste) { T.poste = route.arg.poste; route.arg = null; }
  root.innerHTML = `<div id="tHero"></div>
    <div class="filters"><input id="tQ" type="search" aria-label="Rechercher" placeholder="Nom, compétence, habilitation, poste" value="${esc(T.q)}" style="width:min(340px,100%)">
    <button id="tReview" class="chip ${T.review ? 'on' : ''}" aria-pressed="${T.review}"></button><button class="btn small" id="tClear">Effacer</button><button class="btn small" id="tReset">Affectations ERP</button>
    <span style="margin-left:auto;display:flex;gap:6px;align-items:center" id="revealBox"></span></div>
    <div class="team"><div class="people" id="tPeople"></div><div class="card" style="padding:0;align-self:start;position:sticky;top:96px;max-height:calc(100vh - 108px);overflow:auto"><div class="stickyhead" style="padding:12px 14px;border-bottom:1px solid var(--line)"><h2>Postes</h2><p class="sub">Effectif · temps de l'opération au MES</p></div><div id="tPostes"></div></div></div>`;
  document.getElementById('tQ').oninput = e => { T.q = e.target.value; people(); };
  document.getElementById('tReview').onclick = () => { T.review = !T.review; header(); people(); };
  document.getElementById('tClear').onclick = () => { T.q = ''; T.poste = null; T.review = false; renderEquipe(root, {}); };
  document.getElementById('tReset').onclick = () => { resetAssignments(); toast('Affectations ERP rétablies.'); all(); };
  document.getElementById('tPostes').onclick = e => { const r = e.target.closest('[data-p]'); if (r) { T.poste = T.poste === +r.dataset.p ? null : +r.dataset.p; postes(); people(); } };
  document.getElementById('tPeople').onchange = e => { const s = e.target.closest('[data-assign]'); if (s) { setAssignment(s.dataset.assign, +s.value); all(); } };
  const all = () => { hero(); header(); postes(); people(); };
  reveal(); all();
}
function hero() {
  const A = store.analysis; const skills = [...new Set(A.skills.map(s => s.competence))].sort();
  const rows = skills.map(s => { const L = A.skills.filter(x => x.competence === s); return { s, n: L.length, c: [1, 2, 3].map(l => L.filter(x => x.niveau === l).length) }; }).sort((a, b) => b.c[2] - a.c[2]);
  const m = Math.max(...rows.map(r => r.n)); const col = ['var(--c-moyenne)', 'var(--c-haute)', 'var(--c-critique)'];
  const c = reviewCount(); const exp = l => A.persons.filter(p => p.experience === l).length;
  document.getElementById('tHero').innerHTML = sheet('04', 'Équipe', `Compétences attendues déduites de l'intitulé du poste, à confirmer en atelier. Niveaux déclarés à l'ERP.`, [['Effectif', String(A.persons.length), `${A.postes.length} postes`], ['Experts', String(exp('Expert')), ''], ['Confirmés', String(exp('Confirmé')), ''], ['Débutants', String(exp('Débutant')), ''], ['À renforcer', String(c.renf), 'niveau 1 sur le poste', c.renf > 0]]) +
   `<div class="card"><h2>Compétences déclarées</h2><div class="legend">${['Niveau 1', 'Niveau 2', 'Niveau 3'].map((l, i) => `<span><i style="background:${col[i]}"></i>${l}</span>`).join('')}</div><div class="grid g2" style="gap:0 24px">${rows.map(r => `<div class="bar-row" style="grid-template-columns:130px 1fr 30px"><span>${esc(r.s)}</span><div style="display:flex;gap:1px;height:12px;width:${r.n / m * 100}%">${r.c.map((v, i) => `<div style="flex:${v};background:${col[i]}" data-tip="${esc(r.s)}, niveau ${i + 1} : ${v}"></div>`).join('')}</div><span class="val">${r.n}</span></div>`).join('')}</div></div>`;
}
function header() { const c = reviewCount(); const b = document.getElementById('tReview'); if (b) { b.textContent = `À renforcer : ${c.renf}`; b.classList.toggle('on', T.review); b.setAttribute('aria-pressed', T.review); } }
function postes() {
  const A = store.analysis; const el = document.getElementById('tPostes');
  el.innerHTML = A.postes.map(p => { const o = A.operations.find(x => x.poste === p.poste); const team = teamOf(p.poste); const ch = team.some(x => store.overrides[x.person_id]) || A.persons.some(x => x.poste_origine === p.poste && store.overrides[x.person_id]);
    return `<div class="poste-row ${T.poste === p.poste ? 'sel' : ''}" data-p="${p.poste}" tabindex="0" role="button"><b>P${p.poste}</b><div>${esc(p.intitule)}<br><span class="sub">${team.length ? team.map(x => esc(displayName(x))).join(', ') : 'Aucune affectation'}</span>${ch ? ' <span class="tag session">modifié</span>' : ''}</div><div style="text-align:right;font-family:var(--mono)"><b>${team.length}</b><br><span class="sub">${dur(o.reel_s)}</span></div></div>`; }).join('');
}
function people() {
  const A = store.analysis; const q = T.q.toLowerCase(); const pm = Object.fromEntries(A.postes.map(p => [p.poste, p]));
  const shown = A.persons.filter(p => {
    if (T.poste && posteOf(p) !== T.poste) return false;
    if (T.review && fit(p, pm[posteOf(p)]?.competences_repere) !== 'a_renforcer') return false;
    return !q || `${displayName(p)} ${p.person_id} ${p.qualification} ${p.experience} ${Object.keys(p.competences).join(' ')} ${p.habilitations.join(' ')} poste ${posteOf(p)}`.toLowerCase().includes(q);
  });
  const el = document.getElementById('tPeople');
  const opts = A.postes.map(x => `<option value="${x.poste}">Poste ${x.poste} — ${esc(x.intitule)}</option>`).join('');
  el.innerHTML = shown.length ? shown.map(p => card(p, pm, opts)).join('') : '<div class="card">Aucun résultat.</div>';
  el.querySelectorAll('[data-assign]').forEach(s => { s.value = String(posteOf(A.persons.find(x => x.person_id === s.dataset.assign))); });
}
function card(p, pm, opts) {
  const sel = posteOf(p); const changed = sel !== p.poste_origine; const f = fit(p, pm[sel]?.competences_repere); const name = displayName(p);
  const strong = store.analysis.postes.filter(x => fit(p, x.competences_repere) === 'fort').length;
  const rot = store.analysis.rotations.filter(r => r.person_id === p.person_id);
  const skills = Object.entries(p.competences).sort((a, b) => b[1] - a[1]);
  return `<article class="person ${changed ? 'changed' : ''}"><div class="person-head"><h3>${esc(name)}</h3><span class="pid">${p.person_id}</span></div><div class="sub">${esc(p.qualification)} · ${esc(p.experience)}</div>
   <label class="sub" style="display:block;margin-top:6px">Poste (ERP : P${p.poste_origine})<select data-assign="${p.person_id}" style="width:100%;margin-top:2px">${opts}</select></label>
   <p style="margin:5px 0 0">${FIT_LABEL[f] ? `<span class="tag ${f}">${FIT_LABEL[f]}</span>` : ''}${changed ? '<span class="tag session">modifié</span>' : ''}${strong ? `<span class="tag">Fort sur ${strong} poste${strong > 1 ? 's' : ''}</span>` : ''}</p>
   <div class="skills">${skills.map(([s, n]) => `<span>${esc(s)}</span>${LV(n)}`).join('')}</div>
   <div>${p.habilitations.map(h => `<span class="tag">${esc(h)}</span>`).join('')}</div>
   ${rot.length ? `<div class="sub" style="margin-top:4px">Rotations : ${rot.map(r => `S${r.semaine} P${r.poste}`).join(', ')}</div>` : ''}
   <details class="sub" style="margin-top:3px"><summary>Parcours</summary>${p.commentaire_carriere ? esc(p.commentaire_carriere) + ' ' : ''}${src(p.src)}</details></article>`;
}
function reveal() {
  const box = document.getElementById('revealBox'); const can = store.state?.can_reveal;
  if (store.names) { box.innerHTML = `<span class="badge warn">Noms affichés</span><button class="btn small" id="hide">Masquer</button>`; document.getElementById('hide').onclick = () => { store.names = null; renderEquipe(document.getElementById('view'), {}); }; return; }
  if (!can) { box.innerHTML = ''; return; }
  box.innerHTML = `<input id="code" type="password" aria-label="Code d'affichage des noms" placeholder="Code" style="width:74px" autocomplete="off"><button class="btn small" id="doReveal">Noms</button>`;
  document.getElementById('doReveal').onclick = async () => { try { const r = await api('/api/reveal', { code: document.getElementById('code').value }); store.names = r.names; renderEquipe(document.getElementById('view'), {}); } catch (e) { toast(e.message); } };
}
void onChange;
