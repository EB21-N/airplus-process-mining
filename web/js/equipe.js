import { api, displayName, dur, esc, FIT_LABEL, fit, onChange, posteOf, resetAssignments, reviewCount, setAssignment, src, store, teamOf, toast } from './core.js';

const T = { q: '', poste: null, review: false };
const LV = n => `<span class="lvl" role="img" aria-label="niveau ${n} sur 3">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
const initials = name => name.replace(/\./g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

export function renderEquipe(root, route) {
  if (route.arg?.poste) { T.poste = route.arg.poste; route.arg = null; }
  root.innerHTML = `<section class="hero" id="tHero"></section>
    <div class="filters"><input id="tQ" type="search" aria-label="Rechercher" placeholder="Rechercher une personne, une compétence, un poste" value="${esc(T.q)}" style="width:min(340px,100%)">
    <button id="tReview" class="chip ${T.review ? 'on' : ''}" aria-pressed="${T.review}"></button><button class="btn small" id="tClear">Tout afficher</button><button class="btn small" id="tReset">Rétablir les affectations</button>
    <span style="margin-left:auto;display:flex;gap:6px;align-items:center" id="revealBox"></span></div>
    <div class="team"><div class="people" id="tPeople"></div><div class="card" style="padding:0;align-self:start;position:sticky;top:124px;max-height:calc(100vh - 138px);overflow:auto"><div class="stickyhead" style="padding:12px 14px;border-bottom:1px solid var(--line)"><h2>Les postes</h2><p class="sub">Cliquez pour voir qui y travaille. Le temps affiché est celui de l'opération au MES.</p></div><div id="tPostes"></div></div></div>`;
  document.getElementById('tQ').oninput = e => { T.q = e.target.value; people(); };
  document.getElementById('tReview').onclick = () => { T.review = !T.review; header(); people(); };
  document.getElementById('tClear').onclick = () => { T.q = ''; T.poste = null; T.review = false; renderEquipe(root, {}); };
  document.getElementById('tReset').onclick = () => { resetAssignments(); toast('Affectations d\'origine rétablies.'); all(); };
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
  document.getElementById('tHero').innerHTML = `<div><h1>${A.persons.length} personnes sur <em>${A.postes.length} postes</em>.</h1><p>${exp('Expert')} experts, ${exp('Confirmé')} confirmés et ${exp('Débutant')} débutants. ${c.renf ? `${c.renf} personnes occupent un poste dont une compétence clé est déclarée au niveau 1 : à regarder ensemble.` : 'Aucune personne n\'occupe un poste dont une compétence clé est déclarée au niveau 1.'}</p><p class="sub">Le lien entre compétence et poste vient des mots de l'intitulé d'opération. C'est un repère à confirmer sur le terrain. Un niveau déclaré ne mesure pas la performance.</p></div>
   <div><div class="legend" style="margin-top:0"><span><b>Compétences déclarées</b></span>${['Niveau 1', 'Niveau 2', 'Niveau 3'].map((l, i) => `<span><i style="background:${col[i]}"></i>${l}</span>`).join('')}</div>${rows.map(r => `<div class="bar-row" style="grid-template-columns:130px 1fr 30px"><span>${esc(r.s)}</span><div style="display:flex;gap:2px;height:13px;width:${r.n / m * 100}%">${r.c.map((v, i) => `<div style="flex:${v};background:${col[i]};border-radius:3px" data-tip="${esc(r.s)}, niveau ${i + 1} : ${v} personnes"></div>`).join('')}</div><span class="val">${r.n}</span></div>`).join('')}</div>`;
}
function header() { const c = reviewCount(); const b = document.getElementById('tReview'); if (b) { b.textContent = `À regarder ensemble : ${c.renf}`; b.classList.toggle('on', T.review); b.setAttribute('aria-pressed', T.review); } }
function postes() {
  const A = store.analysis; const el = document.getElementById('tPostes');
  el.innerHTML = A.postes.map(p => { const o = A.operations.find(x => x.poste === p.poste); const team = teamOf(p.poste); const ch = team.some(x => store.overrides[x.person_id]) || A.persons.some(x => x.poste_origine === p.poste && store.overrides[x.person_id]);
    return `<div class="poste-row ${T.poste === p.poste ? 'sel' : ''}" data-p="${p.poste}" tabindex="0" role="button"><b>P${p.poste}</b><div>${esc(p.intitule)}<br><span class="sub">${team.length ? team.map(x => esc(displayName(x))).join(', ') : 'Personne pour le moment'}</span>${ch ? ' <span class="tag session">modifié</span>' : ''}</div><div style="text-align:right"><b>${team.length}</b><br><span class="sub">${dur(o.reel_s)}</span></div></div>`; }).join('');
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
  el.innerHTML = shown.length ? shown.map(p => card(p, pm, opts)).join('') : '<div class="card">Personne ne correspond à ce filtre.</div>';
  el.querySelectorAll('[data-assign]').forEach(s => { s.value = String(posteOf(A.persons.find(x => x.person_id === s.dataset.assign))); });
}
function card(p, pm, opts) {
  const sel = posteOf(p); const changed = sel !== p.poste_origine; const f = fit(p, pm[sel]?.competences_repere); const name = displayName(p);
  const strong = store.analysis.postes.filter(x => fit(p, x.competences_repere) === 'fort').length;
  const rot = store.analysis.rotations.filter(r => r.person_id === p.person_id);
  return `<article class="person ${changed ? 'changed' : ''} ${f === 'fort' ? 'fort' : ''}"><div class="person-head"><div class="avatar" aria-hidden="true">${esc(initials(name))}</div><div><h3>${esc(name)}</h3><div class="sub">${esc(p.qualification)} · ${esc(p.experience)}</div></div></div>
   <label class="sub">Poste <span title="Poste d'origine à l'ERP : P${p.poste_origine}">(à l'origine : P${p.poste_origine})</span><select data-assign="${p.person_id}" style="width:100%;margin-top:3px">${opts}</select></label>
   <p style="margin:6px 0 0">${FIT_LABEL[f] ? `<span class="tag ${f}">${FIT_LABEL[f]}</span>` : ''}${changed ? '<span class="tag session">modifié</span>' : ''}${strong ? `<span class="tag">Point fort sur ${strong} poste${strong > 1 ? 's' : ''}</span>` : ''}</p>
   <div class="skills">${Object.entries(p.competences).sort((a, b) => b[1] - a[1]).map(([s, n]) => `<span>${esc(s)}</span>${LV(n)}`).join('')}</div>
   <div>${p.habilitations.map(h => `<span class="tag">${esc(h)}</span>`).join('')}</div>
   <div class="sub" style="margin-top:5px">${rot.length ? 'Rotations : ' + rot.map(r => `semaine ${r.semaine} au P${r.poste}`).join(', ') : ''}</div>
   <details class="sub" style="margin-top:4px"><summary>Parcours et source</summary>${p.commentaire_carriere ? esc(p.commentaire_carriere) + '<br>' : ''}<span class="pid">${p.person_id}</span> ${src(p.src)}</details></article>`;
}
function reveal() {
  const box = document.getElementById('revealBox'); const can = store.state?.can_reveal;
  if (store.names) { box.innerHTML = `<span class="badge warn">Noms affichés sur cet écran</span><button class="btn small" id="hide">Masquer</button>`; document.getElementById('hide').onclick = () => { store.names = null; renderEquipe(document.getElementById('view'), {}); }; return; }
  if (!can) { box.innerHTML = ''; return; }
  box.innerHTML = `<input id="code" type="password" aria-label="Code d'affichage des noms" placeholder="Code" style="width:74px" autocomplete="off"><button class="btn small" id="doReveal">Afficher les noms</button>`;
  document.getElementById('doReveal').onclick = async () => { try { const r = await api('/api/reveal', { code: document.getElementById('code').value }); store.names = r.names; renderEquipe(document.getElementById('view'), {}); } catch (e) { toast(e.message); } };
}
void onChange;
