// Equipe : valeurs en bande, mur d'empreintes, table reliee, competences et rotations en dessous.
import { api, displayName, dur, esc, FIT_LABEL, fit, onChange, posteOf, resetAssignments, reviewCount, store, teamOf, tipAttr, toast } from './core.js';
import { glyph, SKILLS } from './sheets.js';
import { dataTable, kband } from './table.js';

const E = { mode: 'poste', skill: null, review: false, tab: 'people', hover: null };
let unsub = null, tbl = null;
const MODES = [['poste', 'Par poste'], ['exp', 'Par expérience']];
const TABS = [['people', 'Personnes'], ['postes', 'Postes']];
const pmap = () => Object.fromEntries(store.analysis.postes.map(p => [p.poste, p]));
const fitTag = f => f === 'fort' ? '<span class="pill ink">Fort</span>' : f === 'a_renforcer' ? '<span class="pill red">À renforcer</span>' : f === 'intermediaire' ? '<span class="pill">Moyen</span>' : '';

export function renderEquipe(root, route) {
  if (route.arg?.poste) route.arg = null;
  if (unsub) unsub();
  unsub = onChange(k => { if (k === 'assign') { band(); drawWall(); drawTable(); more(); } if (k === 'select') { marks(); tbl?.mark(); } });
  root.innerHTML = `<div id="eBand"></div><div class="work"><section class="panel"><div class="tools"><div class="modes" id="eModes"></div><div class="modes" id="eSkills" role="group" aria-label="Compétence"></div></div><div class="wall" id="eWall"></div></section><section class="panel"><div class="tools"><div class="tabs" id="eTabs"></div><div class="right" id="eReveal"></div></div><div class="tablewrap" id="eTable"></div></section></div><div class="more" id="eMore"></div>`;
  document.getElementById('eModes').onclick = e => { const b = e.target.closest('[data-m]'); if (b) { E.mode = b.dataset.m; tools(); drawWall(); } };
  document.getElementById('eSkills').onclick = e => { const b = e.target.closest('[data-skill]'); if (b) { E.skill = E.skill === b.dataset.skill ? null : b.dataset.skill; tools(); drawWall(); drawTable(); more(); } };
  document.getElementById('eTabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { E.tab = b.dataset.tab; tools(); drawTable(); } };
  document.getElementById('eBand').addEventListener('click', e => { if (e.target.closest('[data-review]')) { E.review = !E.review; band(); drawWall(); drawTable(); } if (e.target.closest('[data-reset]')) { resetAssignments(); toast('Affectations ERP rétablies.'); } });
  band(); tools(); drawWall(); drawTable(); more(); reveal();
}
function band() {
  const A = store.analysis; const el = document.getElementById('eBand'); if (!el) return; const c = reviewCount(); const exp = l => A.persons.filter(p => p.experience === l).length; const n = Object.keys(store.overrides).length;
  const avg = A.persons.reduce((s, p) => s + (p.taux_horaire_eur || 0), 0) && null; void avg;
  el.innerHTML = kband([{ l: 'Effectif', v: String(A.persons.length), n: `${A.postes.length} postes` }, { l: 'Experts', v: String(exp('Expert')), n: `${Math.round(exp('Expert') / A.persons.length * 100)} %` }, { l: 'Confirmés', v: String(exp('Confirmé')), n: `${Math.round(exp('Confirmé') / A.persons.length * 100)} %` }, { l: 'Débutants', v: String(exp('Débutant')), n: `${Math.round(exp('Débutant') / A.persons.length * 100)} %` }, { l: 'À renforcer', v: String(c.renf), n: E.review ? 'filtre actif, cliquer pour retirer' : 'niveau 1 sur le poste, cliquer pour filtrer', sig: E.review || c.renf > 0, attr: 'data-review tabindex="0" role="button" style="cursor:pointer"' }, { l: 'Déplacées', v: String(n), n: n ? 'cliquer pour revenir à l\'ERP' : 'affectations ERP', attr: n ? 'data-reset tabindex="0" role="button" style="cursor:pointer"' : '' }]);
}
function tools() {
  document.getElementById('eModes').innerHTML = MODES.map(([k, l]) => `<button class="${E.mode === k ? 'on' : ''}" data-m="${k}">${l}</button>`).join('');
  document.getElementById('eSkills').innerHTML = SKILLS.map(s => `<button class="${E.skill === s ? 'on' : ''}" data-skill="${esc(s)}" aria-pressed="${E.skill === s}">${esc(s)}</button>`).join('');
  document.getElementById('eTabs').innerHTML = TABS.map(([k, l]) => `<button class="${E.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('');
}
function reveal() {
  const box = document.getElementById('eReveal'); if (!box) return;
  const redraw = () => { reveal(); drawWall(); drawTable(); };
  if (store.names) { box.innerHTML = `<button class="link" id="eHide">Masquer les noms</button>`; document.getElementById('eHide').onclick = () => { store.names = null; redraw(); }; return; }
  if (!store.state?.can_reveal) { box.innerHTML = ''; return; }
  box.innerHTML = `<input id="eCode" type="password" aria-label="Code" placeholder="Code" style="width:58px;border:1px solid var(--hair2);background:none;padding:1px 5px" autocomplete="off"><button class="link" id="eShow">Afficher les noms</button>`;
  document.getElementById('eShow').onclick = async () => { try { const r = await api('/api/reveal', { code: document.getElementById('eCode').value }); store.names = r.names; redraw(); } catch (e) { toast(e.message); } };
}
function matches(p, pm) {
  if (E.review && fit(p, pm[posteOf(p)]?.competences_repere) !== 'a_renforcer') return false;
  if (E.skill && !p.competences[E.skill]) return false;
  return true;
}
const fpHtml = (p, pm) => { const changed = store.overrides[p.person_id] != null; const f = fit(p, pm[posteOf(p)]?.competences_repere); return `<button class="fp ${changed ? 'changed' : ''} ${matches(p, pm) ? '' : 'dim'}" data-open="person:${p.person_id}" data-pid="${p.person_id}" aria-label="${esc(displayName(p))}, ${esc(p.qualification)}" ${tipAttr(`<b>${esc(displayName(p))}</b> ${esc(p.qualification)}<br>${esc(Object.entries(p.competences).map(([s, n]) => `${s} ${n}`).join(', '))}${FIT_LABEL[f] ? `<br>${FIT_LABEL[f]}` : ''}`)}>${glyph(p, { skill: E.skill })}<span>${esc(displayName(p))}</span></button>`; };
function drawWall() {
  const A = store.analysis; const el = document.getElementById('eWall'); if (!el) return; const pm = pmap(); const top = el.scrollTop;
  if (E.mode === 'exp') el.innerHTML = ['Expert', 'Confirmé', 'Débutant'].map(l => { const L = A.persons.filter(p => p.experience === l); return `<div class="group wide"><b>${l}, ${L.length}</b><div class="gl">${L.map(p => fpHtml(p, pm)).join('')}</div></div>`; }).join('');
  else el.innerHTML = A.postes.map(x => { const t = teamOf(x.poste); const o = A.operations.find(a => a.poste === x.poste); return `<div class="group"><b><button data-open="poste:${x.poste}" ${tipAttr(`${esc(x.intitule)}<br>Opération : ${dur(o.reel_s)}`)}>P${x.poste}</button></b><div class="gl">${t.length ? t.map(p => fpHtml(p, pm)).join('') : '<span class="fp"></span>'}</div></div>`; }).join('');
  el.scrollTop = top; marks();
}
function drawTable() {
  const A = store.analysis; const old = document.getElementById('eTable'); if (!old) return; const fresh = old.cloneNode(false); old.replaceWith(fresh); const pm = pmap();
  if (E.tab === 'people') tbl = dataTable(fresh, { search: 'Filtrer : nom, qualification, compétence, habilitation', sort: 3, key: p => p.person_id, rows: () => A.persons.filter(p => matches(p, pm)), attr: p => `data-open="person:${p.person_id}"`, selected: () => store.sel?.type === 'person' ? store.sel.id : null, onHover: k => { document.querySelectorAll('.fp').forEach(f => f.classList.toggle('hot', f.dataset.pid === k)); },
    cols: [{ t: 'Personne', v: p => displayName(p) }, { t: 'Qualification', v: p => p.qualification, c: true }, { t: 'Expérience', v: p => p.experience }, { t: 'Poste', v: p => posteOf(p), n: true, h: p => `${posteOf(p)}${store.overrides[p.person_id] ? ' <span class="pill red">déplacé</span>' : ''}` }, { t: 'Sur le poste', v: p => fit(p, pm[posteOf(p)]?.competences_repere), h: p => fitTag(fit(p, pm[posteOf(p)]?.competences_repere)) }, { t: 'Compétences', v: p => Object.entries(p.competences).map(([s, n]) => `${s} ${n}`).join(' ') + ' ' + p.habilitations.join(' '), c: true, h: p => esc(Object.entries(p.competences).map(([s, n]) => `${s} ${n}`).join(', ')) }] });
  else tbl = dataTable(fresh, { search: 'Filtrer : poste, opération', sort: 0, key: x => x.poste, rows: () => A.postes, attr: x => `data-open="poste:${x.poste}"`, selected: () => store.sel?.type === 'poste' ? store.sel.id : null,
    cols: [{ t: 'P', v: x => x.poste, n: true }, { t: 'Opération', v: x => x.intitule, c: true }, { t: 'Effectif', v: x => teamOf(x.poste).length, n: true }, { t: 'Profils', v: x => teamOf(x.poste).map(displayName).join(', '), c: true }, { t: 'Compétences repère', v: x => (x.competences_repere || []).join(', '), c: true }, { t: 'Temps MES', v: x => A.operations.find(o => o.poste === x.poste).reel_s, n: true, h: x => dur(A.operations.find(o => o.poste === x.poste).reel_s) }] });
}
function marks() { const sel = store.sel?.type === 'person' ? store.sel.id : null; document.querySelectorAll('.fp').forEach(f => f.classList.toggle('sel', f.dataset.pid === sel)); }
function more() {
  const A = store.analysis; const el = document.getElementById('eMore'); if (!el) return; const col = ['#c9c2b6', 'var(--ink)', 'var(--red)'];
  const rows = SKILLS.map(s => { const L = A.skills.filter(x => x.competence === s); return { s, n: L.length, k: [1, 2, 3].map(v => L.filter(x => x.niveau === v).length) }; }); const m = Math.max(...rows.map(r => r.n));
  const hab = {}; A.persons.forEach(p => p.habilitations.forEach(h => { hab[h] = (hab[h] || 0) + 1; })); const he = Object.entries(hab).sort((a, b) => b[1] - a[1]); const mh = Math.max(...he.map(x => x[1]));
  const qual = {}; A.persons.forEach(p => { qual[p.qualification] = (qual[p.qualification] || 0) + 1; }); const qe = Object.entries(qual).sort((a, b) => b[1] - a[1]);
  el.innerHTML = `<div class="g3"><div class="card"><h2>Compétences déclarées <small>clair : niveau 1, noir : 2, rouge : 3</small></h2>${rows.map(r => `<button class="barrow ${E.skill === r.s ? 'on' : ''}" data-skillrow="${esc(r.s)}" style="grid-template-columns:130px 1fr 34px"><span>${esc(r.s)}</span><div class="st" style="width:${r.n / m * 100}%">${r.k.map((v, i) => `<i style="flex:${v};background:${col[i]};height:10px" data-tip="Niveau ${i + 1} : ${v}"></i>`).join('')}</div><em>${r.n}</em></button>`).join('')}<p class="sub" style="margin-top:6px">Compétences attendues déduites de l'intitulé du poste, à confirmer en atelier.</p></div>
   <div class="card"><h2>Habilitations</h2>${he.map(([h, v]) => `<div class="barrow"><span>${esc(h)}</span><i style="width:${v / mh * 100}%"></i><em>${v}</em></div>`).join('')}</div>
   <div class="card"><h2>Qualifications</h2><div class="scrollbox" style="max-height:230px">${qe.map(([q, v]) => `<div class="row"><span>${esc(q)}</span><em>${v}</em></div>`).join('')}</div></div></div>`;
  el.querySelectorAll('[data-skillrow]').forEach(b => b.onclick = () => { E.skill = E.skill === b.dataset.skillrow ? null : b.dataset.skillrow; tools(); drawWall(); drawTable(); more(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
}
