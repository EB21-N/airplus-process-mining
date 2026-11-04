// Volet de detail : une entite a la fois (poste, reference, fournisseur, personne, occurrence 3D).
import { displayName, dur, emit, esc, eur, FIT_LABEL, fit, hms, laborOp, money, nav, num, posteOf, setAssignment, src, store, teamOf } from './core.js';

export const des = s => String(s || '').replaceAll('_', ' ');
const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const el = () => document.getElementById('sheet');
const row = (a, b, attr = '') => attr ? `<button class="row" ${attr}><span>${a}</span><em>${b}</em></button>` : `<div class="row"><span>${a}</span><em>${b}</em></div>`;
const open = (attr, id) => `data-open="${attr}:${esc(id)}"`;
const RENDER = () => ({ poste: posteSheet, ref: refSheet, sup: supplierSheet, person: personSheet, occ: occSheet });

export function openEntity(type, id) {
  const html = RENDER()[type]?.(id);
  if (!html) return;
  document.getElementById('sheetBody').innerHTML = html;
  el().classList.add('open'); el().setAttribute('aria-hidden', 'false'); el().scrollTop = 0;
  store.sel = { type, id: String(id) };
  history.replaceState(null, '', `#${store.lens || 'temps'}/${type}/${encodeURIComponent(id)}`);
  emit('select');
}
export function closeSheet() {
  if (!store.sel) return;
  el().classList.remove('open'); el().setAttribute('aria-hidden', 'true'); store.sel = null;
  history.replaceState(null, '', `#${store.lens || 'temps'}`); emit('select');
}
export function refresh() { if (store.sel) document.getElementById('sheetBody').innerHTML = RENDER()[store.sel.type](store.sel.id); }
export function step(d) {
  const s = store.sel; if (!s) return; const A = store.analysis;
  const L = { poste: A.postes.map(p => String(p.poste)), ref: A.parts.map(p => p.ref), sup: A.suppliers.map(x => x.fournisseur), person: A.persons.map(p => p.person_id), occ: A.meshes.map(m => m.occurrence_id) }[s.type];
  const i = L.indexOf(s.id); openEntity(s.type, L[(i + d + L.length) % L.length]);
}
const pager = `<div class="pager"><button data-step="-1" aria-label="Précédent">←</button><button data-step="1" aria-label="Suivant">→</button></div>`;

function posteSheet(id) {
  const A = store.analysis; const o = A.operations.find(x => x.poste === +id); if (!o) return null; const pm = A.postes.find(p => p.poste === o.poste);
  const refs = A.op_refs.filter(r => r.op_id === o.op_id); const team = teamOf(o.poste); const mo = laborOp(o); const m = Math.max(o.prevu_s, o.reel_s); const sp = A.supply_postes.find(x => x.poste === o.poste);
  return `${pager}<div class="s-num"><small>Poste</small>${o.poste}</div><h2 class="s-title">${esc(o.intitule)}</h2><p class="s-sub">${esc(o.zone)} · ${esc(o.jour_semaine)} ${o.date.slice(8)}/${o.date.slice(5, 7)}, ${hms(o.debut_s).slice(0, 5)} → ${hms(o.fin_s).slice(0, 5)}</p>
  <div class="minik"><div><b>${dur(o.prevu_s)}</b><span>Prévu</span></div><div><b>${dur(o.reel_s)}</b><span>Réalisé</span></div><div class="sig"><b>${dur(o.ecart_reel_prevu_s, true)}</b><span>Écart</span></div>${mo != null ? `<div><b>${eur(mo, 0)}</b><span>Main-d'œuvre</span></div>` : ''}</div>
  <div class="duo"><div><span>Prévu</span><u style="width:${o.prevu_s / m * 100}%;background:var(--ink)"></u><span>${hms(o.prevu_s)}</span></div><div><span>Réalisé</span><u style="width:${o.reel_s / m * 100}%;background:var(--red)"></u><span>${hms(o.reel_s)}</span></div><div><span>Pointage</span><u style="width:${o.horo_s / m * 100}%;background:var(--hair2)"></u><span>${hms(o.horo_s)}</span></div></div>
  ${o.controle_horloge !== 'concordant' ? `<p class="note">Pointage arrêté à ${hms(o.fin_s).slice(0, 5)}, soit ${dur(o.horo_s)}. ${dur(-o.ecart_horo_reel_s)} hors pointage.</p>` : ''}
  <div class="s-sec"><h3>Aléa</h3><dl class="facts" style="margin-top:5px"><dt>Déclaré</dt><dd>${esc(o.alea)}</dd><dt>Famille</dt><dd>${esc(o.m6)}${o.m6_mot_cle ? ` (mot-clé « ${esc(o.m6_mot_cle)} »)` : ''}</dd><dt>Cause possible</dt><dd>${esc(o.cause_potentielle)}</dd><dt>Ratio</dt><dd>${String(o.ratio_reel_prevu).replace('.', ',')}</dd></dl></div>
  <div class="s-sec"><h3>Équipe (${team.length})${pm?.competences_repere?.length ? `, repère : ${esc(pm.competences_repere.join(', '))}` : ''}</h3>${team.length ? team.map(p => { const f = fit(p, pm?.competences_repere); return row(`${esc(displayName(p))}${store.overrides[p.person_id] ? ' <span class="tag red">déplacé</span>' : ''}`, FIT_LABEL[f] ? FIT_LABEL[f].replace(' sur ce poste', '').toLowerCase() : esc(p.experience).toLowerCase(), open('person', p.person_id)); }).join('') : '<p class="s-sub">Aucune affectation.</p>'}</div>
  ${refs.length ? `<div class="s-sec"><h3>Pièces (${o.qty})</h3>${refs.map(r => { const p = A.parts.find(x => x.ref === r.ref); return row(`${esc(des(p?.designation) || r.ref)}`, `${esc(r.ref)} × ${r.occurrences}`, open('ref', r.ref)); }).join('')}${sp ? `<p class="s-sub" style="margin-top:6px">Délai le plus long ${sp.delai_max_j} j : ${esc(sp.ref_delai_max)}, ${esc(sp.fournisseur_delai_max)}. ${sp.n_fournisseurs} fournisseurs, ${sp.n_critiques} référence${sp.n_critiques > 1 ? 's' : ''} critique${sp.n_critiques > 1 ? 's' : ''}, ${money(sp.valeur_pieces_eur)}.</p>` : ''}</div>` : '<p class="note">Référence vide au MES pour ce poste.</p>'}
  <div class="acts"><button class="btn" data-goto="avion/atelier" data-keep="poste:${o.poste}">Atelier</button><button class="btn red" data-ask="Que vérifier en priorité au poste ${o.poste} ?">Question</button></div><p style="margin-top:12px">${src(o.src)}</p>`;
}
function refSheet(id) {
  const A = store.analysis; const p = A.parts.find(x => x.ref === id); if (!p) return null; const cal = A.supply_calendar.find(c => c.ref === id); const opsMap = Object.fromEntries(A.operations.map(o => [o.op_id, o])); const occ = A.meshes.filter(m => m.ref === id);
  const abc = A.supply_abc.find(a => a.ref === id); const modif = occ.some(m => m.geometrie_modifiee); const ec = A.supply_ecarts.find(e => e.ref === id); const cad = p.cao_3dxml?.[0];
  return `${pager}<div class="s-num small">${esc(des(p.designation))}</div><p class="s-sub" style="margin-top:4px">${esc(p.ref)} · ${esc(p.criticite)}${abc ? ` · classe ${abc.classe}, ${num(abc.part_pct, 2)} % de la valeur` : ''}${p.est_outillage ? ' · outillage' : ''}</p>
  <div class="minik"><div><b>${money(p.prix_achat_eur)}</b><span>Prix</span></div><div class="sig"><b>${money(p.valeur_nomenclature_eur)}</b><span>Valeur</span></div><div><b>${esc(p.delai_source.replace(' jours', ' j'))}</b><span>Délai</span></div><div><b>${num(p.masse_kg, 2)} kg</b><span>Masse</span></div></div>
  <div class="s-sec">${row('Fournisseur', esc(p.fournisseur), open('sup', p.fournisseur))}</div>
  ${cal ? `<div class="s-sec"><h3>Commande</h3>${row('Avec le délai maxi', `${fmtDate(cal.commande_au_plus_tard)}, ${cal.delai_max_j} j`)}${row('Avec le délai mini', `${fmtDate(cal.commande_si_delai_court)}, ${cal.delai_min_j} j`)}${row(`Besoin, poste ${cal.premier_poste}`, fmtDate(cal.date_besoin))}</div>` : ''}
  <div class="s-sec"><h3>Quantités</h3>${[['Nomenclature', p.qty_nomenclature], ['Notice', p.qty_notice], ['MES', p.occ_mes], ['Modèle 3D', occ.length]].filter(x => x[1]).map(([l, v]) => row(l, v)).join('')}${ec ? `<p class="note">Écart MES / nomenclature : ${ec.ecart > 0 ? '+' : ''}${ec.ecart}.</p>` : ''}</div>
  <div class="s-sec"><h3>CAO</h3>${row('Temps CAO', `${num(p.cao_h)} h`)}${cad ? row('Version 3DXML', `${esc(cad.version)}, ${esc(cad.maturity)}`) : ''}${modif ? row('Géométrie', 'modifiée dans la CAO') : ''}</div>
  ${p.operations.length ? `<div class="s-sec"><h3>Postes (${p.operations.length})</h3>${p.operations.map(r => row(`${r.poste} ${esc(opsMap[r.op_id].intitule)}`, `× ${r.occurrences}`, open('poste', r.poste))).join('')}</div>` : ''}
  <div class="acts">${occ.length ? `<button class="btn" data-goto="avion/avion" data-keep="ref:${esc(id)}">Voir sur l'avion</button>` : ''}</div><p style="margin-top:12px">${src(p.src)} ${src(p.src_notice)}</p>`;
}
function supplierSheet(id) {
  const A = store.analysis; const s = A.suppliers.find(x => x.fournisseur === id); if (!s) return null; const parts = A.parts.filter(p => p.fournisseur === id);
  return `${pager}<div class="s-num small">${esc(s.fournisseur)}</div><p class="s-sub" style="margin-top:6px">${num(s.part_pct, 1)} % de la valeur · ${s.delai_min_j} à ${s.delai_max_j} jours</p>
  <div class="minik"><div class="sig"><b>${money(s.valeur_eur)}</b><span>Valeur</span></div><div><b>${s.n_refs}</b><span>Références</span></div><div><b>${s.n_critiques}</b><span>Critiques</span></div><div><b>${num(s.masse_kg, 0)} kg</b><span>Masse</span></div></div>${s.postes.length ? `<div class="s-sec"><h3>Postes (${s.postes.length})</h3><p>${s.postes.map(x => `<button class="link" ${open('poste', x)}>${x}</button>`).join(', ')}</p></div>` : ''}${Object.keys(s.zones).length ? `<div class="s-sec"><h3>Zones</h3>${Object.entries(s.zones).sort((a, b) => b[1] - a[1]).map(([z, n]) => row(esc(z), `${n} pièces`)).join('')}</div>` : ''}
  <div class="s-sec"><h3>Références</h3>${parts.map(p => row(`${esc(des(p.designation))} <span class="s-sub">${esc(p.ref)}</span>`, money(p.valeur_nomenclature_eur), open('ref', p.ref))).join('')}</div>
  ${s.postes.length ? `<div class="acts"><button class="btn red" data-ask="Quels points vérifier sur l'approvisionnement auprès de ${esc(s.fournisseur)} ?">Question</button></div>` : ''}`;
}
export const SKILLS = ['Assemblage', 'Montage mécanique', 'Montage électrique', 'Soudure', 'Contrôle qualité', 'Lecture plan'];
export function glyph(p, opts = {}) {
  const R = 21;
  const spokes = SKILLS.map((s, i) => { const a = (i / 6) * 2 * Math.PI - Math.PI / 2; const n = p.competences[s]; const x = Math.cos(a), y = Math.sin(a); if (!n) return `<circle cx="${(x * 6).toFixed(1)}" cy="${(y * 6).toFixed(1)}" r=".9" fill="var(--ink3)"/>`; const L = 5 + n / 3 * (R - 5); const on = opts.skill === s; return `<line x1="${(x * 3).toFixed(1)}" y1="${(y * 3).toFixed(1)}" x2="${(x * L).toFixed(1)}" y2="${(y * L).toFixed(1)}" stroke="${n === 3 || on ? 'var(--red)' : 'var(--ink)'}" stroke-width="${on ? 3.4 : 2.1}"/>`; }).join('');
  return `<svg viewBox="-25 -25 50 50" aria-hidden="true">${spokes}<circle class="ring" r="23.5" fill="none" stroke="transparent"/></svg>`;
}
function pointsHtml(p) {
  const A = store.analysis; const forts = Object.entries(p.competences).filter(([, n]) => n === 3).map(([s]) => s), faibles = Object.entries(p.competences).filter(([, n]) => n === 1).map(([s]) => s);
  const pf = A.postes.filter(x => fit(p, x.competences_repere) === 'fort').map(x => x.poste), pr = A.postes.filter(x => fit(p, x.competences_repere) === 'a_renforcer').map(x => x.poste);
  const L = a => a.length > 16 ? `${a.slice(0, 16).join(', ')}… (${a.length})` : a.join(', ');
  return `<dl class="facts" style="margin-top:8px">${forts.length ? `<dt>Points forts</dt><dd>${esc(forts.join(', '))}</dd>` : ''}${faibles.length ? `<dt>À renforcer</dt><dd>${esc(faibles.join(', '))}</dd>` : ''}${pf.length ? `<dt>Postes forts</dt><dd>${L(pf)}</dd>` : ''}${pr.length ? `<dt>Postes à renforcer</dt><dd>${L(pr)}</dd>` : ''}</dl>`;
}
function personSheet(id) {
  const A = store.analysis; const p = A.persons.find(x => x.person_id === id); if (!p) return null; const sel = posteOf(p); const pm = A.postes.find(x => x.poste === sel); const f = fit(p, pm?.competences_repere); const strong = A.postes.filter(x => fit(p, x.competences_repere) === 'fort').length; const rot = A.rotations.filter(r => r.person_id === id);
  const opts = A.postes.map(x => `<option value="${x.poste}" ${x.poste === sel ? 'selected' : ''}>${x.poste} ${esc(x.intitule)}</option>`).join('');
  return `${pager}<div style="width:92px">${glyph(p)}</div><div class="s-num small" style="margin-top:4px">${esc(displayName(p))}</div><p class="s-sub" style="margin-top:6px">${esc(p.qualification)} · ${esc(p.experience)} · ${p.person_id}</p>
  <div class="s-sec"><h3>Poste${sel !== p.poste_origine ? `, ERP ${p.poste_origine}` : ''}</h3><select class="field" data-assign="${p.person_id}" aria-label="Poste">${opts}</select><p class="s-sub">${FIT_LABEL[f] ? FIT_LABEL[f] + '. ' : ''}${strong ? `Fort sur ${strong} postes.` : ''}${sel !== p.poste_origine ? ` <button class="link" data-assign-reset="${p.person_id}">Revenir au poste ${p.poste_origine}</button>` : ''}</p></div>
  <div class="s-sec"><h3>Compétences déclarées</h3>${Object.entries(p.competences).sort((a, b) => b[1] - a[1]).map(([s, n]) => row(esc(s), `${'●'.repeat(n)}${'○'.repeat(3 - n)}`)).join('')}${pointsHtml(p)}</div>
  <div class="s-sec"><h3>Habilitations</h3><p>${p.habilitations.map(esc).join(', ')}</p></div>
  ${rot.length ? `<div class="s-sec"><h3>Rotations</h3>${rot.map(r => row(`Semaine ${r.semaine}`, `poste ${r.poste}`, open('poste', r.poste))).join('')}</div>` : ''}
  ${p.commentaire_carriere ? `<div class="s-sec"><h3>Parcours</h3><p style="font-size:14px">${esc(p.commentaire_carriere)}</p></div>` : ''}<p style="margin-top:16px">${src(p.src)}</p>`;
}
function occSheet(id) {
  const A = store.analysis; const occ = A.meshes.find(m => m.occurrence_id === id); if (!occ) return null;
  if (occ.ref) { const h = refSheet(occ.ref); return occ.status === 'inferee' ? h.replace('</p>', `</p><p class="note">${esc(occ.method)}</p>`) : h; }
  return `<div class="s-num small">${esc((occ.mesh_name || occ.node_name).replace(/^(Symétrie de )+/, '').replace(/\.\d+$/, ''))}</div><p class="s-sub" style="margin-top:6px">Sans référence PLM · ${esc(occ.assembly_path)}</p><p style="margin-top:12px">${src(occ.src)}</p>`;
}
export function bindSheetEvents() {
  document.addEventListener('change', e => { const s = e.target.closest('[data-assign]'); if (s) { setAssignment(s.dataset.assign, +s.value); refresh(); } });
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); const i = o.dataset.open.indexOf(':'); openEntity(o.dataset.open.slice(0, i), o.dataset.open.slice(i + 1)); return; }
    const st = e.target.closest('[data-step]'); if (st) { step(+st.dataset.step); return; }
    if (e.target.closest('[data-close-sheet]')) { closeSheet(); return; }
    const r = e.target.closest('[data-assign-reset]'); if (r) { const p = store.analysis.persons.find(x => x.person_id === r.dataset.assignReset); setAssignment(p.person_id, p.poste_origine); refresh(); return; }
    const g = e.target.closest('[data-goto]'); if (g) { const [l, sub] = g.dataset.goto.split('/'); const i = (g.dataset.keep || '').indexOf(':'); const k = i > 0 ? g.dataset.keep.slice(0, i) : null; const v = i > 0 ? g.dataset.keep.slice(i + 1) : null; nav.go(l, sub, k ? { [k]: k === 'poste' ? +v : v } : null); return; }
    const a = e.target.closest('[data-ask]'); if (a) nav.go('question', null, { question: a.dataset.ask, auto: true });
  });
}
