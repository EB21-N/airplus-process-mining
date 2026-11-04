import { dur, esc, eur, hms, laborOp, laborTotal, mix, money, nav, num, onChange, sheet, src, store, tipAttr } from './core.js';

const F = { day: '', zone: '', m6: '' };
let tab = 'flux', moBase = 'reel', unsub = null;

function filtered() { return store.analysis.operations.filter(o => (!F.day || o.date === F.day) && (!F.zone || o.zone === F.zone) && (!F.m6 || o.m6 === F.m6)); }
const sum = (L, f) => L.reduce((s, o) => s + (o[f] ?? 0), 0);
const opTip = o => tipAttr(`<b>Poste ${o.poste}</b> · ${esc(o.intitule)}<br>Prévu ${dur(o.prevu_s)} · Réalisé ${dur(o.reel_s)} · ${dur(o.ecart_reel_prevu_s, true)}<br>${o.controle_horloge !== 'concordant' ? `Pointage ${hms(o.debut_s).slice(0, 5)} → ${hms(o.fin_s).slice(0, 5)}, soit ${dur(o.horo_s)}<br>` : ''}Aléa : ${esc(o.alea)}<br>Cause possible : ${esc(o.cause_potentielle)}`);
const open = p => nav.go('jumeau', 'atelier', { poste: p });
const dayLabel = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export function renderPilotage(root, route) {
  if (route.sub === 'flux' || route.sub === 'journal') tab = route.sub;
  if (unsub) unsub();
  unsub = onChange(k => { if (k === 'assign' && document.getElementById('valo')) renderValo(filtered()); });
  root.innerHTML = `<div class="subtabs" role="tablist">${[['flux', 'Flux & coûts'], ['journal', 'Journal & contrôles']].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div><div id="tabBody"></div>`;
  root.querySelector('.subtabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; renderPilotage(root, {}); } };
  (tab === 'flux' ? renderFlux : renderJournal)(document.getElementById('tabBody'));
}

function renderFlux(el) {
  const A = store.analysis; const days = [...new Set(A.operations.map(o => o.date))];
  el.innerHTML = `<div id="hero"></div><div class="filters">
    <span class="sub">Jour</span><span class="seg"><button class="chip ${!F.day ? 'on' : ''}" data-day="">Tous</button>${days.map(d => `<button class="chip ${F.day === d ? 'on' : ''}" data-day="${d}">${d.slice(8)}/${d.slice(5, 7)}</button>`).join('')}</span>
    <label>Zone <select data-f="zone"><option value="">Toutes</option>${A.zones.map(z => `<option ${F.zone === z.zone ? 'selected' : ''}>${esc(z.zone)}</option>`).join('')}</select></label>
    <label>Aléa <select data-f="m6"><option value="">Tous</option>${A.ishikawa.map(c => `<option ${F.m6 === c.categorie ? 'selected' : ''}>${esc(c.categorie)}</option>`).join('')}</select></label>
    <button class="btn small" id="resetF">Effacer</button><span class="badge" id="nFiltered"></span></div><div id="fluxBody"></div>`;
  el.querySelector('.filters').addEventListener('change', e => { const k = e.target.dataset.f; if (k) { F[k] = e.target.value; draw(); } });
  el.querySelector('.filters').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b) { F.day = b.dataset.day; el.querySelectorAll('[data-day]').forEach(x => x.classList.toggle('on', x === b)); draw(); } });
  document.getElementById('resetF').onclick = () => { Object.keys(F).forEach(k => F[k] = ''); renderFlux(el); };
  draw();
}
function draw() {
  const ops = filtered(); const A = store.analysis; const body = document.getElementById('fluxBody'); const hero = document.getElementById('hero');
  document.getElementById('nFiltered').textContent = `${ops.length} / ${A.operations.length} op.`;
  if (!ops.length) { hero.innerHTML = ''; body.innerHTML = '<div class="card">Aucune opération.</div>'; return; }
  const p = sum(ops, 'prevu_s'), r = sum(ops, 'reel_s'), h = sum(ops, 'horo_s'); const pct = p ? Math.round((r / p - 1) * 100) : 0;
  const cut = ops.filter(o => o.controle_horloge !== 'concordant');
  const t0 = ops.map(o => o.debut).sort()[0], t1 = ops.map(o => o.fin).sort().at(-1); const dm = t => `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`;
  const top = ops.slice().sort((a, b) => b.ecart_reel_prevu_s - a.ecart_reel_prevu_s)[0];
  hero.innerHTML = sheet('01', "Temps d'assemblage", `${ops.length} opérations relevées du ${dm(t0)} au ${dm(t1)}. Plus gros écart : poste ${top.poste}, ${esc(top.intitule.toLowerCase())}, ${dur(top.ecart_reel_prevu_s, true)}.`, [
    ['Prévu', dur(p), ''], ['Réalisé', dur(r), 'temps déclaré'], ['Écart', dur(r - p, true), `${pct >= 0 ? '+' : ''}${pct} % sur le prévu`, true], ['Pointage', dur(h), cut.length ? `${cut.length} fin${cut.length > 1 ? 's' : ''} pointée${cut.length > 1 ? 's' : ''} à 17:00` : 'identique au déclaré'], ['Pièces', money(A.supply.valeur_totale_eur), `${A.supply.n_refs} références`], ['Effectif', String(A.persons.length), `${A.postes.length} postes`]]);
  body.innerHTML = `
  <div class="grid g-3-2 mt">
    <div class="card"><h2>Réalisé et prévu par poste</h2>
      <div class="legend"><span><i style="background:var(--reel)"></i>Réalisé</span><span><i style="background:var(--horo);height:3px;vertical-align:3px"></i>Prévu</span><span>▼ fin pointée à 17:00</span></div>${chartOps(ops)}</div>
    <div class="card"><h2>Plus gros écarts</h2><div id="topCards">${topCards(ops)}</div></div>
  </div>
  <div class="card mt"><h2>Déroulé</h2><p class="sub">Couleur : ratio réalisé / prévu. ▼ fin pointée à 17:00, durée déclarée plus longue que le pointage.</p>${chartGantt(ops)}</div>
  <div class="grid g2 mt">
    <div class="card"><h2>Écart par zone</h2><div style="margin-top:8px">${groupBars(ops, 'zone', 'zone')}</div></div>
    <div class="card"><h2>Écart par famille d'aléa (6M)</h2><div style="margin-top:8px">${groupBars(ops, 'm6', 'm6')}</div></div>
  </div>
  <div id="valo" class="mt"></div>
  <details class="card mt"><summary>Tableau des opérations</summary><div class="scroll mt">${tableOps(ops)}</div></details>`;
  body.querySelectorAll('[data-poste]').forEach(e => e.addEventListener('click', ev => { if (!ev.target.closest('[data-src]')) open(+e.dataset.poste); }));
  body.querySelectorAll('[data-g]').forEach(e => e.addEventListener('click', () => { F[e.dataset.k] = e.dataset.g; const s = document.querySelector(`[data-f=${e.dataset.k}]`); if (s) s.value = F[e.dataset.k]; draw(); }));
  renderValo(ops);
}
const kpi = (l, v, n, a) => `<div class="kpi ${a ? 'accent' : ''}"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="n">${esc(n)}</div></div>`;

function chartOps(ops) {
  const W = 900, H = 270, L = 42, B = 24, T = 10; const max = Math.max(...ops.map(o => Math.max(o.reel_s, o.prevu_s)));
  const step = (W - L - 6) / ops.length; const bw = Math.max(3, Math.min(13, step - 3)); const y = v => H - B - (v / max) * (H - B - T);
  const ticks = []; const tk = max > 5400 ? 1800 : max > 2400 ? 900 : 300; for (let v = 0; v <= max; v += tk) ticks.push(v);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Temps prévu et réel déclaré par opération">
    ${ticks.map(v => `<line x1="${L}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v ? dur(v) : '0'}</text>`).join('')}
    ${ops.map((o, i) => { const x = L + i * step + (step - bw) / 2; const rh = y(0) - y(o.reel_s); const rad = 0; void rh;
      return `<g><path d="M${x} ${y(0)} V${y(o.reel_s) + rad} a${rad} ${rad} 0 0 1 ${rad} -${rad} h${bw - 2 * rad} a${rad} ${rad} 0 0 1 ${rad} ${rad} V${y(0)} Z" fill="var(--reel)"/>
      <line x1="${x - 2}" x2="${x + bw + 2}" y1="${y(o.prevu_s)}" y2="${y(o.prevu_s)}" stroke="var(--horo)" stroke-width="2.5"/>
      ${o.controle_horloge !== 'concordant' ? `<path d="M${x + bw / 2 - 4} ${y(o.reel_s) - 9} h8 l-4 6 Z" fill="var(--ink)"/>` : ''}
      ${(ops.length <= 28 || (i + 1) % 5 === 0 || i === 0) ? `<text x="${x + bw / 2}" y="${H - 7}" text-anchor="middle">${o.poste}</text>` : ''}
      <rect class="mark-hit" tabindex="0" role="button" aria-label="Poste ${o.poste}" data-poste="${o.poste}" x="${L + i * step}" y="${T}" width="${step}" height="${H - T - B}" ${opTip(o)}/></g>`; }).join('')}</svg>`;
}
function topCards(ops) {
  const rows = ops.slice().sort((a, b) => b.ecart_reel_prevu_s - a.ecart_reel_prevu_s).slice(0, 5); const m = Math.max(...rows.map(o => o.reel_s));
  return rows.map((o, i) => `<button class="rank" data-poste="${o.poste}"><span class="rk">${i + 1}</span><b>P${o.poste} ${esc(o.intitule)}</b><span class="ec">${dur(o.ecart_reel_prevu_s, true)}</span>
    <div class="pair"><div class="bar" style="width:${o.prevu_s / m * 100}%;background:var(--ink)"></div><div class="bar" style="width:${o.reel_s / m * 100}%;background:var(--red)"></div></div>
    <div class="sub">${esc(o.alea)} — cause possible : ${esc(o.cause_potentielle.toLowerCase())}</div></button>`).join('');
}
function chartGantt(ops) {
  const days = [...new Set(ops.map(o => o.date))]; const W = 1100, L = 118, rh = 38, H = days.length * rh + 26;
  const a = 8 * 3600, b = 17 * 3600; const x = s => L + (s - a) / (b - a) * (W - L - 8);
  const all = store.analysis.operations.map(o => o.ratio_reel_prevu); const rmin = Math.min(...all), rmax = Math.max(...all);
  const col = r => mix('#f3d6d0', '#8e0c20', (r - rmin) / Math.max(.001, rmax - rmin));
  const hrs = []; for (let h = 8; h <= 17; h++) hrs.push(h);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Déroulé des opérations par jour">
   ${hrs.map(h => `<line x1="${x(h * 3600)}" x2="${x(h * 3600)}" y1="0" y2="${H - 20}" stroke="var(--line)"/><text x="${x(h * 3600)}" y="${H - 5}" text-anchor="middle">${h} h</text>`).join('')}
   ${days.map((d, i) => `<text x="0" y="${i * rh + 23}" style="fill:var(--ink2);font-size:12px">${esc(ops.find(o => o.date === d).jour_semaine.slice(0, 3).toUpperCase() + ' ' + d.slice(8) + '/' + d.slice(5, 7))}</text>` + ops.filter(o => o.date === d).map(o => {
     const X = x(o.debut_s), w = Math.max(2, x(o.fin_s) - X - 1.5); const dark = (o.ratio_reel_prevu - rmin) / Math.max(.001, rmax - rmin) > .45; return `<rect data-poste="${o.poste}" style="cursor:pointer" x="${X}" y="${i * rh + 5}" width="${w}" height="28" fill="${col(o.ratio_reel_prevu)}" ${opTip(o)}/>${o.controle_horloge !== 'concordant' ? `<path d="M${X + w / 2 - 5} ${i * rh - 1} h10 l-5 6 Z" fill="var(--ink)" style="pointer-events:none"/>` : ''}${w > 22 ? `<text x="${X + w / 2}" y="${i * rh + 23}" text-anchor="middle" style="fill:${dark ? '#fff' : 'var(--ink)'};pointer-events:none">${o.poste}</text>` : ''}`; }).join('')).join('')}</svg>`;
}
function groupBars(ops, key, k) {
  const g = {}; for (const o of ops) g[o[key]] = (g[o[key]] || 0) + o.ecart_reel_prevu_s;
  const e = Object.entries(g).sort((a, b) => b[1] - a[1]); const m = Math.max(...e.map(x => x[1]), 1);
  return e.map(([z, v]) => `<button class="bar-row click" data-k="${k}" data-g="${esc(z)}"><span>${esc(z)}</span><div class="bar-track"><div class="bar-fill" style="width:${v / m * 100}%"></div></div><span class="val">${dur(v)}</span></button>`).join('');
}
function tableOps(ops) {
  return `<table><thead><tr><th>Poste</th><th>Opération</th><th>Zone</th><th class="num">Prévu</th><th class="num">Réalisé</th><th class="num">Pointage</th><th class="num">Écart</th><th>Aléa déclaré</th><th>Cause possible</th><th>Source</th></tr></thead><tbody>
  ${ops.map(o => `<tr class="click" data-poste="${o.poste}"><td>${o.poste}</td><td>${esc(o.intitule)}</td><td>${esc(o.zone)}</td><td class="num">${hms(o.prevu_s)}</td><td class="num">${hms(o.reel_s)}</td><td class="num">${hms(o.horo_s)}</td><td class="num">${hms(o.ecart_reel_prevu_s)}</td><td>${esc(o.alea)}</td><td class="sub">${esc(o.cause_potentielle)}</td><td>${src(o.src)}</td></tr>`).join('')}</tbody></table>`;
}

function renderValo(ops) {
  const A = store.analysis; const el = document.getElementById('valo'); if (!el) return;
  const k = id => A.kpis.find(x => x.kpi_id === id);
  const sup = A.suppliers.slice(0, 6); const ms = Math.max(...sup.map(s => s.valeur_eur));
  const L = laborTotal(ops, moBase); const all = laborTotal(A.operations, moBase);
  const refMo = { prevu: k('mo_prevu'), reel: k('mo_reel'), horo: k('mo_horo') }[moBase].valeur;
  const nOv = Object.keys(store.overrides).length; const empty = ops.filter(o => laborOp(o, moBase) == null);
  const byZone = {}; for (const o of ops) byZone[o.zone] = (byZone[o.zone] || 0) + (laborOp(o, moBase) || 0);
  const ze = Object.entries(byZone).sort((a, b) => b[1] - a[1]); const mz = Math.max(...ze.map(x => x[1]), 1);
  el.innerHTML = `<div class="grid g2">
   <div class="card"><h2>Coût des pièces</h2><p class="sub">Quantité nomenclature × prix d'achat.</p>
    <div class="kpis mt">${kpi('Pièces', money(k('matieres_hors_outillage').valeur), `${k('matieres_hors_outillage').effectif} références`)}${kpi('Outillage', eur(k('outillage').valeur, 0), '2 références')}</div>
    <h3 class="mt">Fournisseurs</h3><div style="margin-top:6px">${sup.map(s => `<div class="bar-row"><span>${esc(s.fournisseur)}</span><div class="bar-track"><div class="bar-fill" style="width:${s.valeur_eur / ms * 100}%"></div></div><span class="val">${money(s.valeur_eur)}</span></div>`).join('')}</div>
    <p class="mt"><button class="link" id="toSupply">Supply chain</button></p></div>
   <div class="card"><h2>Coût main-d'œuvre</h2><p class="sub">Durée × somme des taux de l'équipe du poste, équipe complète sur toute l'opération.</p>
    <p style="margin:8px 0"><label class="sub">Base <select id="moBase"><option value="reel" ${moBase === 'reel' ? 'selected' : ''}>Réalisé</option><option value="prevu" ${moBase === 'prevu' ? 'selected' : ''}>Prévu</option><option value="horo" ${moBase === 'horo' ? 'selected' : ''}>Pointage</option></select></label></p>
    <div class="kpis">${kpi(ops.length === A.operations.length ? 'Total' : 'Sélection', eur(L.total), `${L.n} opérations`, true)}${ops.length === A.operations.length ? (nOv ? kpi('ERP d\'origine', eur(refMo), `écart ${eur(all.total - refMo)}`) : '') : kpi('Total', eur(all.total), nOv ? `origine ${eur(refMo)}` : `${all.n} opérations`)}</div>
    ${nOv ? `<p class="note red mt">${nOv} affectation${nOv > 1 ? 's modifiées' : ' modifiée'} dans Équipe.</p>` : ''}
    ${empty.length ? `<p class="note mt">Sans équipe, non comptés : P${empty.map(o => o.poste).join(', P')}.</p>` : ''}
    <h3 class="mt">Par zone</h3><div style="margin-top:6px">${ze.map(([z, v]) => `<div class="bar-row"><span>${esc(z)}</span><div class="bar-track"><div class="bar-fill" style="width:${v / mz * 100}%"></div></div><span class="val">${eur(v, 0)}</span></div>`).join('')}</div></div></div>`;
  document.getElementById('moBase').onchange = e => { moBase = e.target.value; renderValo(filtered()); };
  document.getElementById('toSupply').onclick = () => nav.go('supply');
}

// ---- Journal et qualite ---------------------------------------------------------------------------------
const TYPE_LABEL = { ecart_horloge: 'Fin pointée à 17:00', reference_manquante: 'Référence vide', quantite_vs_references: 'Quantité et références différentes', date_week_end: 'Opérations le week-end', attente_nulle: 'Enchaînement sans attente', quantite_plm_notice: 'Quantité PLM / notice', reference_sans_correspondance: 'Référence PLM / notice', occurrences_mes_vs_nomenclature: 'Quantité MES / nomenclature', reference_absente_mes: 'Référence jamais citée au MES', ligne_parasite_plm: 'Ligne parasite exclue', types_a_convertir: 'Valeurs converties', designation_non_unique: 'Désignation partagée', intitule_non_unique: 'Intitulé partagé', orthographe_source: 'Orthographe', pseudonymes_partages: 'Pseudonymes partagés', qualification_vs_experience: 'Qualification / expérience', rotation_sur_poste_origine: 'Rotation vers le poste d\'origine', lien_3d_a_verifier: 'Lien 3D à vérifier', controle_total_notice: 'Total de la notice' };
let anomType = '', evQ = '';
function renderJournal(el) {
  const A = store.analysis; const types = [...new Set(A.anomalies.map(a => a.type))];
  const ok = A.operations.filter(o => o.controle_horloge === 'concordant').length;
  el.innerHTML = sheet('01', 'Journal & contrôles', `${ok} opérations sur ${A.operations.length} : pointage égal au temps déclaré. ${A.anomalies.length} points de contrôle.`) + `<div class="card"><h2>Rapprochements</h2><div style="margin-top:6px">${A.joins.filter(j => !j.jointure.includes('Rotations')).map(j => `<div class="bar-row" ${tipAttr(esc(j.cle) + (j.sans_correspondance?.length ? '<br>Hors lien : ' + esc(j.sans_correspondance.join(', ')) : ''))}><span>${esc(j.jointure)}</span><div class="bar-track"><div class="bar-fill" style="width:${j.couverture_pct}%"></div></div><span class="val">${j.numerateur}/${j.denominateur}</span></div>`).join('')}</div></div>
  <div class="card mt"><h2>Points de contrôle</h2><div class="filters" style="padding:8px 0"><button class="chip ${!anomType ? 'on' : ''}" data-t="">Tous (${A.anomalies.length})</button>${types.map(t => `<button class="chip ${anomType === t ? 'on' : ''}" data-t="${t}">${esc(TYPE_LABEL[t] || t)} (${A.anomalies.filter(a => a.type === t).length})</button>`).join('')}</div><div class="scroll" id="anTable"></div></div>
  <div class="card mt"><h2>Quantités par référence</h2><div class="scroll">${reconTable()}</div></div>
  <div class="card mt"><h2>Journal</h2><input type="search" id="evQ" aria-label="Filtrer le journal" placeholder="Filtrer" value="${esc(evQ)}" style="margin:6px 0;width:280px"><div class="scroll tall" id="evTable"></div></div>`;
  const anR = () => document.getElementById('anTable').innerHTML = `<table><thead><tr><th>Type</th><th>Sur</th><th>Constat</th><th>Source</th></tr></thead><tbody>${A.anomalies.filter(a => !anomType || a.type === anomType).map(a => `<tr><td>${esc(TYPE_LABEL[a.type] || a.type)}</td><td>${esc(a.cle)}</td><td>${esc(a.message)}</td><td>${src(a.src)}</td></tr>`).join('')}</tbody></table>`;
  const evR = () => { const q = evQ.toLowerCase(); document.getElementById('evTable').innerHTML = `<table><thead><tr><th>Poste</th><th>Activité</th><th>Événement</th><th>Date et heure</th><th>Source</th></tr></thead><tbody>${A.events.filter(e => !q || JSON.stringify(e).toLowerCase().includes(q)).map(e => `<tr><td>${e.poste}</td><td>${esc(e.activite)}</td><td>${e.cycle_de_vie === 'debut' ? 'Début' : 'Fin'}${e.alerte ? ' <span class="tag a_renforcer">17:00</span>' : ''}</td><td class="num">${esc(e.horodatage?.replace('T', ' '))}</td><td>${src(e.src)}</td></tr>`).join('')}</tbody></table>`; };
  anR(); evR();
  el.querySelector('.filters').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { anomType = b.dataset.t; el.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); anR(); } };
  document.getElementById('evQ').oninput = e => { evQ = e.target.value; evR(); };
}
function reconTable() {
  return `<table><thead><tr><th>Référence</th><th>Désignation</th><th class="num">PLM</th><th class="num">Notice</th><th class="num">MES</th><th class="num">Écart MES − PLM</th><th class="num">3D</th><th>Source</th></tr></thead><tbody>
  ${store.analysis.reconciliation.map(r => `<tr><td>${r.qty_plm != null ? `<button class="link" data-ref="${esc(r.ref)}">${esc(r.ref)}</button>` : esc(r.ref)}</td><td>${esc((r.designation || '').replaceAll('_', ' '))}</td><td class="num">${r.qty_plm ?? ''}</td><td class="num">${r.qty_notice ?? ''}</td><td class="num">${r.occ_mes || ''}</td><td class="num">${r.ecart_mes_plm ? (r.ecart_mes_plm > 0 ? '+' : '') + r.ecart_mes_plm : ''}</td><td class="num">${r.occ_modele_3d || ''}</td><td>${src(r.src_plm || r.src_notice)}</td></tr>`).join('')}</tbody></table>`;
}
void num;
document.addEventListener('click', e => { const b = e.target.closest('[data-ref]'); if (b && !b.closest('#drawer')) { const r = b.dataset.ref; if (store.analysis.parts.some(p => p.ref === r)) nav.go('jumeau', 'catalogue', { ref: r }); } });
