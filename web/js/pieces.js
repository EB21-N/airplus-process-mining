// Pieces : valeurs en bande, disques proportionnels a la valeur, tables reliees, criticite, ecarts et ABC en dessous.
import { esc, eur, money, num, onChange, store, tipAttr } from './core.js';
import { des, openEntity } from './sheets.js';
import { barCell, dataTable, kband } from './table.js';

const P = { mode: 'valeur', sup: null, metric: 'pieces', tab: 'refs', hover: null };
const VW = 1000, VH = 760;
const MODES = [['valeur', 'Valeur'], ['delai', 'Délai'], ['commandes', 'Commandes'], ['flux', 'Flux']];
const TABS = [['refs', 'Références'], ['sups', 'Fournisseurs'], ['cmd', 'Commandes'], ['postes', 'Postes']];
const CRITS = ['Critique', 'Haute', 'Moyenne', 'Basse'];
const CLASS = { A: 'var(--red)', B: 'var(--ink)', C: '#a39c90' };
let unsub = null, packCache = null, packKey = null, tbl = null;
const d2 = d => d.split('-').reverse().slice(0, 2).join('/');
const crit = c => `<i class="crit ${esc(c)}"></i>${esc(c)}`;

function pack(parts) {
  const key = store.state?.content_sha256;
  if (packCache && packKey === key) return packCache;
  const total = parts.reduce((s, p) => s + (p.valeur_nomenclature_eur || 0), 0); const k = (VW * VH * .36) / (Math.PI * total);
  const items = parts.slice().sort((a, b) => b.valeur_nomenclature_eur - a.valeur_nomenclature_eur).map(p => ({ ref: p.ref, r: Math.max(5, Math.sqrt(k * (p.valeur_nomenclature_eur || 0))) }));
  const placed = [];
  for (const it of items) {
    let best = placed.length ? null : { x: VW / 2 - 175, y: VH / 2 };
    for (let d = 0; d < 900 && !best; d += 3) { const steps = Math.max(8, Math.floor(d / 2)); for (let i = 0; i < steps; i++) { const a = i / steps * 2 * Math.PI + d * .05; const x = VW / 2 + Math.cos(a) * d * 1.28, y = VH / 2 + Math.sin(a) * d * .92; if (placed.every(q => Math.hypot(q.x - x, q.y - y) >= q.r + it.r + 3) && x - it.r > 4 && x + it.r < VW - 4 && y - it.r > 4 && y + it.r < VH - 4) { best = { x, y }; break; } } }
    placed.push({ ...it, ...(best || { x: VW / 2, y: VH / 2 }) });
  }
  packKey = key;
  return (packCache = Object.fromEntries(placed.map(p => [p.ref, p])));
}
const calAxis = () => { const cal = store.analysis.supply_calendar; const t = d => new Date(d + 'T12:00:00').getTime(); const a = t(store.analysis.supply.premiere_commande) - 2 * 864e5, b = Math.max(...cal.map(c => t(c.date_besoin))) + 2 * 864e5; return { cal, a, b, x: d => 190 + (t(d) - a) / (b - a) * (VW - 210), rh: (VH - 30) / cal.length }; };
function positions() {
  const A = store.analysis; const pk = pack(A.parts); const small = r => Math.max(4.5, Math.min(30, r * .42));
  if (P.mode === 'valeur') return pk;
  if (P.mode === 'delai') {
    const x = d => 90 + d / 50 * (VW - 130); const laneY = c => 90 + CRITS.indexOf(c) * 170; const out = {}; const placed = {};
    for (const p of A.parts.slice().sort((a, b) => b.valeur_nomenclature_eur - a.valeur_nomenclature_eur)) { const r = small(pk[p.ref].r); const px = x(p.delai_max_j); const lane = placed[p.criticite] ||= []; let y = laneY(p.criticite), off = 0, sgn = 1; while (lane.some(q => Math.hypot(q.x - px, q.y - y) < q.r + r + 1)) { off += 3; sgn = -sgn; y = laneY(p.criticite) + sgn * off; } lane.push({ x: px, y, r }); out[p.ref] = { x: px, y, r }; }
    return out;
  }
  if (P.mode === 'commandes') {
    const { cal, x, rh } = calAxis(); const out = {};
    cal.forEach((c, i) => { out[c.ref] = { x: x(c.commande_au_plus_tard), y: 26 + i * rh + rh / 2, r: Math.max(4, Math.min(rh / 2 - .5, small(pk[c.ref].r))) }; });
    for (const p of A.parts) if (!out[p.ref]) out[p.ref] = { x: VW / 2, y: VH + 60, r: 0 };
    return out;
  }
  return Object.fromEntries(A.parts.map(p => [p.ref, { ...pk[p.ref], r: 0 }]));
}
function axisLayer() {
  if (P.mode === 'delai') { const x = d => 90 + d / 50 * (VW - 130); return `${[0, 10, 20, 30, 40, 50].map(d => `<line x1="${x(d)}" x2="${x(d)}" y1="16" y2="${VH - 26}" stroke="var(--hair)"/><text x="${x(d)}" y="${VH - 8}" text-anchor="middle">${d} j</text>`).join('')}${CRITS.map((c, i) => `<text x="0" y="${94 + i * 170}">${c}</text>`).join('')}`; }
  if (P.mode === 'commandes') {
    const { cal, a, b, x, rh } = calAxis(); const wk = []; for (let d = a; d <= b; d += 7 * 864e5) wk.push(new Date(d).toISOString().slice(0, 10));
    return wk.map(d => `<line x1="${x(d)}" x2="${x(d)}" y1="18" y2="${VH}" stroke="var(--hair)"/><text x="${x(d)}" y="12" text-anchor="middle" style="font-size:13px">${d2(d)}</text>`).join('') + cal.map((c, i) => { const y = 26 + i * rh + rh / 2; const dim = P.sup && c.fournisseur !== P.sup; const xs = x(c.commande_si_delai_court); return `<g opacity="${dim ? .12 : 1}" data-open="ref:${esc(c.ref)}" style="cursor:pointer" ${tipAttr(`<b>${esc(des(c.designation))}</b> ${esc(c.ref)}<br>${esc(c.fournisseur)}<br>Délai maxi ${c.delai_max_j} j : commande ${d2(c.commande_au_plus_tard)}<br>Délai mini ${c.delai_min_j} j : commande ${d2(c.commande_si_delai_court)}<br>Poste ${c.premier_poste}, ${d2(c.date_besoin)}`)}><line x1="${x(c.commande_au_plus_tard)}" x2="${x(c.date_besoin)}" y1="${y}" y2="${y}" stroke="${c.criticite === 'Critique' ? 'var(--red)' : c.criticite === 'Haute' ? 'var(--ink)' : '#a39c90'}" stroke-width="1.6"/><rect x="${xs - 3}" y="${y - 3}" width="6" height="6" transform="rotate(45 ${xs} ${y})" fill="var(--paper)" stroke="var(--ink)"/><text x="178" y="${y + 4}" text-anchor="end" style="font-size:12.5px">${esc(c.ref)} ${esc(des(c.designation).slice(0, 17))}</text></g>`; }).join('');
  }
  if (P.mode === 'flux') return sankey();
  return '';
}
function sankey() {
  const A = store.analysis; const metric = P.metric; const flows = A.supply_flows.filter(f => f[metric] > 0); const total = flows.reduce((s, f) => s + f[metric], 0); const gap = 9, top = 8; const H = VH;
  const left = [...new Set(flows.map(f => f.fournisseur))].map(n => ({ n, v: flows.filter(f => f.fournisseur === n).reduce((s, f) => s + f[metric], 0) })).sort((a, b) => b.v - a.v);
  const right = A.zones.map(z => z.zone).filter(z => flows.some(f => f.zone === z)).map(n => ({ n, v: flows.filter(f => f.zone === n).reduce((s, f) => s + f[metric], 0) }));
  const sc = Math.min(H - top * 2 - gap * (left.length - 1), H - top * 2 - gap * (right.length - 1)) * .86 / total;
  const place = L => { let y = top; for (const x of L) { x.h = Math.max(3, x.v * sc); x.y = y; x.off = 0; y += x.h + gap; } const free = H - y; L.forEach((x, i) => { x.y += Math.max(0, free) * (i / Math.max(1, L.length - 1)); }); };
  place(left); place(right); const x0 = 215, x1 = VW - 150; const m = (x0 + x1) / 2;
  const rib = flows.slice().sort((a, b) => b[metric] - a[metric]).map(f => { const l = left.find(x => x.n === f.fournisseur), r = right.find(x => x.n === f.zone); const lh = Math.max(.8, f[metric] / l.v * l.h), rh = Math.max(.8, f[metric] / r.v * r.h); const ya = l.y + l.off, yb = r.y + r.off; l.off += lh; r.off += rh; const on = !P.sup || P.sup === f.fournisseur; return `<path d="M${x0} ${ya} C${m} ${ya} ${m} ${yb} ${x1} ${yb} L${x1} ${yb + rh} C${m} ${yb + rh} ${m} ${ya + lh} ${x0} ${ya + lh} Z" fill="${P.sup === f.fournisseur ? 'var(--red)' : 'var(--ink)'}" opacity="${on ? (P.sup ? .8 : .18) : .03}" ${tipAttr(`<b>${esc(f.fournisseur)} → ${esc(f.zone)}</b><br>${f.pieces} pièces, ${money(f.valeur_eur)}<br>Postes ${f.postes.join(', ')}`)}/>`; }).join('');
  return rib + left.map(n => `<g data-open="sup:${esc(n.n)}" style="cursor:pointer"><rect x="${x0 - 4}" y="${n.y}" width="4" height="${n.h}" fill="${P.sup === n.n ? 'var(--red)' : 'var(--ink)'}"/><text x="${x0 - 9}" y="${n.y + n.h / 2 + 4}" text-anchor="end">${esc(n.n.length > 25 ? n.n.slice(0, 24) + '…' : n.n)}</text></g>`).join('') + right.map(n => `<g><rect x="${x1}" y="${n.y}" width="4" height="${n.h}" fill="var(--ink)"/><text x="${x1 + 9}" y="${n.y + n.h / 2 + 4}">${esc(n.n)}</text></g>`).join('');
}
const TABLES = {
  refs: () => ({ search: 'Filtrer : référence, désignation, fournisseur', sort: 4, desc: true, key: p => p.ref, rows: () => store.analysis.parts.filter(p => !P.sup || p.fournisseur === P.sup), attr: p => `data-open="ref:${esc(p.ref)}"`, onHover: k => { P.hover = k; hot(); }, selected: () => store.sel?.type === 'ref' ? store.sel.id : null,
    cols: [{ t: 'Réf.', v: p => p.ref }, { t: 'Désignation', v: p => des(p.designation), c: true }, { t: 'Fournisseur', v: p => p.fournisseur, c: true }, { t: 'Qté', v: p => p.qty_nomenclature, n: true }, { t: 'Valeur', v: p => p.valeur_nomenclature_eur, n: true, h: p => barCell(Math.sqrt(p.valeur_nomenclature_eur), Math.sqrt(1e7), money(p.valeur_nomenclature_eur)) }, { t: 'Délai', v: p => p.delai_max_j, n: true, h: p => `${p.delai_min_j}-${p.delai_max_j} j` }, { t: 'Criticité', v: p => CRITS.indexOf(p.criticite), h: p => crit(p.criticite) }] }),
  sups: () => ({ sort: 2, desc: true, key: s => s.fournisseur, rows: () => store.analysis.suppliers, attr: s => `data-sup="${esc(s.fournisseur)}" data-open="sup:${esc(s.fournisseur)}"`, selected: () => P.sup,
    cols: [{ t: 'Fournisseur', v: s => s.fournisseur, c: true }, { t: 'Réf.', v: s => s.n_refs, n: true }, { t: 'Valeur', v: s => s.valeur_eur, n: true, h: s => barCell(Math.sqrt(s.valeur_eur), Math.sqrt(1e7), money(s.valeur_eur)) }, { t: 'Part', v: s => s.part_pct, n: true, h: s => `${num(s.part_pct, 1)} %` }, { t: 'Délai', v: s => s.delai_max_j, n: true, h: s => `${s.delai_min_j}-${s.delai_max_j} j` }, { t: 'Masse', v: s => s.masse_kg, n: true, h: s => `${num(s.masse_kg, 0)} kg` }, { t: 'Critiques', v: s => s.n_critiques, n: true }, { t: 'Crit. maxi', v: s => CRITS.indexOf(s.criticite_max), h: s => crit(s.criticite_max) }] }),
  cmd: () => ({ search: 'Filtrer', sort: 3, key: c => c.ref, rows: () => store.analysis.supply_calendar.filter(c => !P.sup || c.fournisseur === P.sup), attr: c => `data-open="ref:${esc(c.ref)}"`, onHover: k => { P.hover = k; hot(); }, selected: () => store.sel?.type === 'ref' ? store.sel.id : null,
    cols: [{ t: 'Réf.', v: c => c.ref }, { t: 'Désignation', v: c => des(c.designation), c: true }, { t: 'Fournisseur', v: c => c.fournisseur, c: true }, { t: 'Cde délai maxi', v: c => c.commande_au_plus_tard, n: true, h: c => d2(c.commande_au_plus_tard) }, { t: 'Cde délai mini', v: c => c.commande_si_delai_court, n: true, h: c => d2(c.commande_si_delai_court) }, { t: 'Besoin', v: c => c.date_besoin, n: true, h: c => d2(c.date_besoin) }, { t: 'Poste', v: c => c.premier_poste, n: true }, { t: 'Criticité', v: c => CRITS.indexOf(c.criticite), h: c => crit(c.criticite) }] }),
  postes: () => ({ search: 'Filtrer', sort: 2, desc: true, key: x => x.poste, rows: () => store.analysis.supply_postes.filter(x => !P.sup || store.analysis.op_refs.some(r => r.poste === x.poste && store.analysis.parts.find(p => p.ref === r.ref)?.fournisseur === P.sup)), attr: x => `data-open="poste:${x.poste}"`, selected: () => store.sel?.type === 'poste' ? store.sel.id : null,
    cols: [{ t: 'P', v: x => x.poste, n: true }, { t: 'Opération', v: x => x.intitule, c: true }, { t: 'Délai maxi', v: x => x.delai_max_j, n: true, h: x => barCell(x.delai_max_j, 45, `${x.delai_max_j} j`) }, { t: 'Pièce', v: x => x.ref_delai_max }, { t: 'Fournisseur', v: x => x.fournisseur_delai_max, c: true }, { t: 'Réf.', v: x => x.n_refs, n: true }, { t: 'Four.', v: x => x.n_fournisseurs, n: true }, { t: 'Crit.', v: x => x.n_critiques, n: true }, { t: 'Valeur', v: x => x.valeur_pieces_eur, n: true, h: x => money(x.valeur_pieces_eur) }] }),
};
export function renderPieces(root) {
  if (unsub) unsub(); unsub = onChange(k => { if (k === 'select') { marks(); tbl?.mark(); } });
  const A = store.analysis; const s = A.supply; const abc = A.supply_abc_classes[0]; const kp = id => A.kpis.find(k => k.kpi_id === id).valeur;
  root.innerHTML = `${kband([{ l: 'Valeur totale', v: money(s.valeur_totale_eur), n: `${s.n_refs} références, ${s.qty_totale} pièces` }, { l: 'Pièces / outillage', v: money(kp('matieres_hors_outillage')), n: `outillage ${eur(kp('outillage'), 0)}` }, { l: 'Top 3 fournisseurs', v: `${num(s.part_top3_pct, 0)} %`, n: `sur ${s.n_fournisseurs} fournisseurs`, sig: true }, { l: 'Classe A', v: `${num(abc.part_pct, 1)} %`, n: `${abc.refs.length} réf. : ${abc.refs.join(', ')}` }, { l: 'Critiques', v: `${s.n_critiques}`, n: `${num(s.part_critique_pct, 0)} % de la valeur` }, { l: 'Délai maxi', v: `${s.delai_max_j} j`, n: `pondéré ${num(s.delai_moyen_pondere_j, 0)} j, simple ${num(s.delai_moyen_simple_j, 0)} j` }, { l: 'Masse', v: `${num(s.masse_totale_kg / 1000, 1)} t`, n: 'quantité × masse' }, { l: '1re commande', v: d2(s.premiere_commande), n: `${s.premiere_commande_ref}, démarrage ${d2(s.premier_besoin)}` }])}
   <div class="work"><section class="panel"><div class="tools"><div class="modes" id="pModes"></div><button class="link hidden" id="pClear"></button><div class="key right" id="pKey"></div></div><div class="canvas" id="pCanvas"></div></section><section class="panel"><div class="tools"><div class="tabs" id="pTabs"></div></div><div class="tablewrap" id="pTable"></div></section></div><div class="more" id="pMore"></div>`;
  document.getElementById('pModes').onclick = e => { const b = e.target.closest('[data-m]'); if (b) { P.mode = b.dataset.m; if (b.dataset.m === 'commandes') P.tab = 'cmd'; draw(); drawTable(); } };
  document.getElementById('pTabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { P.tab = b.dataset.tab; drawTable(); } };
  document.getElementById('pClear').onclick = () => { P.sup = null; draw(); drawTable(); };
  document.getElementById('pTable').addEventListener('click', e => { const t = e.target.closest('tr[data-sup]'); if (t) { P.sup = t.dataset.sup; draw(); tbl?.mark(); } });
  drawTable(); draw(); more();
}
function drawTable() {
  document.getElementById('pTabs').innerHTML = TABS.map(([k, l]) => `<button class="${P.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('');
  const old = document.getElementById('pTable'); const fresh = old.cloneNode(false); old.replaceWith(fresh); fresh.addEventListener('click', e => { const t = e.target.closest('tr[data-sup]'); if (t) { P.sup = t.dataset.sup; draw(); tbl?.mark(); } });
  tbl = dataTable(fresh, TABLES[P.tab]());
}
function draw() {
  const A = store.analysis; const c = document.getElementById('pCanvas'); if (!c) return;
  document.getElementById('pModes').innerHTML = MODES.map(([k, l]) => `<button class="${P.mode === k ? 'on' : ''}" data-m="${k}">${l}</button>`).join('');
  const cl = document.getElementById('pClear'); cl.classList.toggle('hidden', !P.sup); if (P.sup) cl.textContent = `${P.sup} ×`;
  document.getElementById('pKey').innerHTML = P.mode === 'flux' ? `<div class="modes"><button class="${P.metric === 'pieces' ? 'on' : ''}" data-metric="pieces">Pièces</button><button class="${P.metric === 'valeur_eur' ? 'on' : ''}" data-metric="valeur_eur">Valeur</button></div>` : `<span><i style="background:var(--red);border-radius:50%"></i>critique</span><span><i style="background:var(--ink);border-radius:50%"></i>haute</span><span><i style="background:#a39c90;border-radius:50%"></i>moyenne</span><span><i style="border:1px solid var(--ink);border-radius:50%"></i>basse</span>${P.mode === 'commandes' ? '<span>◇ délai mini</span>' : ''}`;
  document.querySelectorAll('[data-metric]').forEach(b => b.onclick = () => { P.metric = b.dataset.metric; draw(); });
  const pos = positions(); let svg = c.querySelector('svg.bubbles');
  if (!svg) {
    c.innerHTML = `<svg class="bubbles" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Références"><g class="layer" id="pAxis"></g><g id="pBubs">${A.parts.map(p => `<g class="bub c-${esc(p.criticite)}" data-open="ref:${esc(p.ref)}" tabindex="0" role="button" aria-label="${esc(des(p.designation))}, ${esc(p.fournisseur)}, ${money(p.valeur_nomenclature_eur)}" data-ref="${esc(p.ref)}" data-sf="${esc(p.fournisseur)}" ${tipAttr(`<b>${esc(des(p.designation))}</b> ${esc(p.ref)}<br>${esc(p.fournisseur)}<br>${money(p.valeur_nomenclature_eur)}, ${esc(p.delai_source)}`)}><circle r="0"/><text class="t1"></text><text class="t2"></text></g>`).join('')}</g></svg>`;
    svg = c.querySelector('svg'); svg.getBoundingClientRect();
  }
  document.getElementById('pAxis').innerHTML = axisLayer();
  svg.querySelectorAll('.bub').forEach(g => { const p = pos[g.dataset.ref]; g.style.transform = `translate(${p.x}px,${p.y}px)`; const ci = g.querySelector('circle'); ci.setAttribute('r', p.r); ci.style.r = p.r + 'px'; g.classList.toggle('dim', !!P.sup && g.dataset.sf !== P.sup); g.style.pointerEvents = p.r ? '' : 'none';
    const part = A.parts.find(x => x.ref === g.dataset.ref); const t1 = g.querySelector('.t1'), t2 = g.querySelector('.t2'); const big = P.mode === 'valeur' && p.r > 42; const fs = Math.min(p.r / 3.2, 40); const fsz = Math.max(fs * .55, 13); const nm = des(part.designation); t1.textContent = big && nm.length * fsz * .56 < p.r * 1.75 ? nm : big ? part.ref : ''; t2.textContent = big ? money(part.valeur_nomenclature_eur) : ''; t1.style.fontSize = fsz + 'px'; t2.style.fontSize = fs + 'px'; t2.setAttribute('y', fs * .95); t1.setAttribute('y', -fs * .3); });
  marks();
}
function hot() { document.querySelectorAll('.bub').forEach(g => g.classList.toggle('hot', g.dataset.ref === P.hover)); }
function marks() { const sel = store.sel?.type === 'ref' ? store.sel.id : null; document.querySelectorAll('.bub').forEach(g => { const c = g.querySelector('circle'); c.style.stroke = g.dataset.ref === sel ? 'var(--ink)' : ''; c.style.strokeWidth = g.dataset.ref === sel ? '3px' : ''; }); }
function more() {
  const A = store.analysis; const el = document.getElementById('pMore');
  const cols = [...new Set(A.supply_grid.map(g => g.delai))], rows = [...new Set(A.supply_grid.map(g => g.criticite))]; const m = Math.max(...A.supply_grid.map(g => Math.log10(g.valeur_eur + 1)));
  const heat = `<div class="heat"><span></span>${cols.map(c => `<span class="h">${esc(c)}</span>`).join('')}${rows.map(r => `<span class="r">${crit(r)}</span>` + cols.map(c => { const g = A.supply_grid.find(x => x.criticite === r && x.delai === c); if (!g.n_refs) return '<div class="c"></div>'; const t = Math.log10(g.valeur_eur + 1) / m; const hex = n => Math.round(n).toString(16).padStart(2, '0'); const mx = (a, b) => a + (b - a) * t; return `<div class="c" style="background:#${hex(mx(248, 158))}${hex(mx(232, 0))}${hex(mx(228, 16))};color:${t > .55 ? '#fff' : 'var(--ink)'}" ${tipAttr(`<b>${esc(r)}, ${esc(c)}</b><br>${g.n_refs} références : ${esc(g.refs.join(', '))}`)}><b>${g.n_refs}</b><small>${money(g.valeur_eur)}</small></div>`; }).join('')).join('')}</div>`;
  const E = A.supply_ecarts; const me = Math.max(...E.map(e => Math.abs(e.ecart)));
  const ecarts = `<table><thead><tr><th>Réf.</th><th>Désignation</th><th class="n">Nomencl.</th><th class="n">MES</th><th>Écart</th></tr></thead><tbody>${E.map(e => `<tr class="click" data-open="ref:${esc(e.ref)}"><td>${esc(e.ref)}</td><td>${esc(des(e.designation))}</td><td class="n">${e.nomenclature}</td><td class="n">${e.occurrences_mes}</td><td>${barCell(e.ecart, me, `${e.ecart > 0 ? '+' : ''}${e.ecart}`, e.ecart < 0 ? 'var(--ink)' : 'var(--red)')}</td></tr>`).join('')}</tbody></table>`;
  const abc = `<div class="seg" role="img" aria-label="Répartition ABC">${A.supply_abc_classes.map(c => `<div style="width:${c.part_pct}%;background:${CLASS[c.classe]}">${c.part_pct > 8 ? `${c.classe} ${num(c.part_pct, 0)} %` : ''}</div>`).join('')}</div><table><thead><tr><th>Classe</th><th class="n">Réf.</th><th class="n">Valeur</th><th class="n">Part</th><th>Références</th></tr></thead><tbody>${A.supply_abc_classes.map(c => `<tr><td><i class="crit" style="background:${CLASS[c.classe]}"></i>${c.classe}</td><td class="n">${c.n_refs}</td><td class="n">${money(c.valeur_eur)}</td><td class="n">${num(c.part_pct, 1)} %</td><td class="sub">${esc(c.refs.slice(0, 12).join(', '))}${c.refs.length > 12 ? '…' : ''}</td></tr>`).join('')}</tbody></table>`;
  el.innerHTML = `<div class="g3"><div class="card"><h2>Criticité × délai <small>références et valeur</small></h2>${heat}</div><div class="card"><h2>Écarts nomenclature / MES <small>${E.length} références</small></h2>${ecarts}</div><div class="card"><h2>Analyse ABC <small>A jusqu'à 80 %, B jusqu'à 95 %</small></h2>${abc}<p class="sub" style="margin-top:8px">Un seul fournisseur par référence au PLM (${A.parts.length} références).</p></div></div>`;
}
void openEntity;
