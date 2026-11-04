// Temps : valeurs en bande, turbine des 56 operations, table reliee, deroule et couts en dessous.
import { dur, esc, eur, hms, laborOp, laborTotal, mix, onChange, src, store, tipAttr } from './core.js';
import { openEntity } from './sheets.js';
import { barCell, barRow, dataTable, kband } from './table.js';

const T = { mode: 'ordre', group: null, base: 'reel', hover: null };
const R0 = 136, LEN = 328, W = 8.4;
const MODES = [['ordre', 'Déroulé'], ['zone', 'Zones'], ['m6', 'Aléas'], ['ecart', 'Écarts']];
let unsub = null, tbl = null;

function layout(ops) {
  const key = { ordre: o => o.date, zone: o => o.zone, m6: o => o.m6, ecart: () => '' }[T.mode];
  const sorted = T.mode === 'ecart' ? ops.slice().sort((a, b) => b.ecart_reel_prevu_s - a.ecart_reel_prevu_s) : ops.slice();
  const groups = []; for (const o of sorted) { const k = key(o); let g = groups.find(x => x.k === k); if (!g) groups.push(g = { k, ops: [] }); g.ops.push(o); }
  if (T.mode === 'zone' || T.mode === 'm6') groups.sort((a, b) => b.ops.reduce((s, o) => s + o.ecart_reel_prevu_s, 0) - a.ops.reduce((s, o) => s + o.ecart_reel_prevu_s, 0));
  const gap = groups.length > 1 ? 2.4 : 0; const slots = ops.length + gap * groups.length; let c = gap / 2; const ang = {};
  for (const g of groups) { g.a0 = c; for (const o of g.ops) { ang[o.poste] = (c + .5) / slots * 360; c++; } g.a1 = c; c += gap; g.mid = ((g.a0 + g.a1) / 2) / slots * 360; }
  return { ang, groups };
}
const dayLabel = o => `${o.jour_semaine.slice(0, 3)}. ${o.date.slice(8)}/${o.date.slice(5, 7)}`;
const groupLabel = g => T.mode === 'ordre' ? dayLabel(g.ops[0]) : g.k;
function selected() { return store.analysis.operations.filter(o => !T.group || ({ ordre: o.date, zone: o.zone, m6: o.m6 }[T.mode]) === T.group); }
const groupName = ops => T.group ? (T.mode === 'ordre' ? dayLabel(ops[0]) : T.group) : null;

export function renderTemps(root) {
  if (unsub) unsub();
  unsub = onChange(k => { if (k === 'select') { mark(); center(); tbl?.mark(); } if (k === 'assign') { band(); more(); } });
  root.innerHTML = `<div id="tBand"></div><div class="work"><section class="panel"><div class="tools"><div class="modes" role="group" aria-label="Organisation" id="tModes"></div><button class="link hidden" id="tClear"></button><div class="key right"><span><i style="background:var(--ink)"></i>prévu</span><span><i style="background:var(--red)"></i>dépassement</span><span><i style="border:1.6px solid var(--ink);border-radius:50%"></i>fin pointée à 17:00</span></div></div><div class="canvas" id="tCanvas"></div></section>
   <section class="panel"><div class="tablewrap" id="tTable"></div></section></div><div class="more" id="tMore"></div>`;
  document.getElementById('tClear').onclick = () => { T.group = null; update(); };
  document.getElementById('tModes').onclick = e => { const b = e.target.closest('[data-mode]'); if (b) { T.mode = b.dataset.mode; T.group = null; update(); } };
  const hoverP = k => { T.hover = k == null ? null : +k; center(); hot(); };
  tbl = dataTable(document.getElementById('tTable'), { rows: selected, key: o => o.poste, sort: 4, desc: true, search: 'Filtrer : poste, opération, zone, aléa', selected: () => store.sel?.type === 'poste' ? store.sel.id : null, attr: o => `data-open="poste:${o.poste}"`, onHover: hoverP,
    cols: [{ t: 'P', v: o => o.poste, n: true }, { t: 'Opération', v: o => `${o.intitule} ${o.zone}`, c: true, h: o => `<span title="${esc(o.zone)}">${esc(o.intitule)}</span>` }, { t: 'Prévu', v: o => o.prevu_s, n: true, h: o => hms(o.prevu_s) }, { t: 'Réalisé', v: o => o.reel_s, n: true, h: o => `${hms(o.reel_s)}${o.controle_horloge !== 'concordant' ? ' ○' : ''}` }, { t: 'Écart', v: o => o.ecart_reel_prevu_s, n: true, h: o => barCell(o.ecart_reel_prevu_s, 2265, `+${hms(o.ecart_reel_prevu_s).slice(0, 8)}`) }, { t: 'Aléa', v: o => `${o.m6} ${o.alea}`, c: true, h: o => `<span title="${esc(o.alea)}">${esc(o.alea)}</span>` }] });
  update();
}
function update() { band(); modes(); turbine(); tbl?.draw(); more(); }
function modes() {
  document.getElementById('tModes').innerHTML = MODES.map(([k, l]) => `<button class="${T.mode === k ? 'on' : ''}" data-mode="${k}">${l}</button>`).join('');
  const c = document.getElementById('tClear'); const ops = selected(); c.classList.toggle('hidden', !T.group); if (T.group) c.textContent = `${groupName(ops)} ×`;
}
function band() {
  const el = document.getElementById('tBand'); if (!el) return; const ops = selected(); const A = store.analysis;
  const p = ops.reduce((s, o) => s + o.prevu_s, 0), r = ops.reduce((s, o) => s + o.reel_s, 0), h = ops.reduce((s, o) => s + o.horo_s, 0); const pct = Math.round((r / p - 1) * 100); const L = laborTotal(ops, T.base); const cut = ops.filter(o => o.controle_horloge !== 'concordant').length; const n = Object.keys(store.overrides).length;
  const t0 = ops.map(o => o.debut).sort()[0], t1 = ops.map(o => o.fin).sort().at(-1); const dm = t => `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`; const worst = ops.slice().sort((a, b) => b.ecart_reel_prevu_s - a.ecart_reel_prevu_s)[0];
  const baseSel = `base <select id="tBase" aria-label="Base du calcul"><option value="reel" ${T.base === 'reel' ? 'selected' : ''}>réalisé</option><option value="prevu" ${T.base === 'prevu' ? 'selected' : ''}>prévu</option><option value="horo" ${T.base === 'horo' ? 'selected' : ''}>pointage</option></select>${n ? ` · ERP ${eur(A.kpis.find(k => k.kpi_id === 'mo_' + T.base).valeur, 2)}` : ''}`;
  el.innerHTML = kband([{ l: 'Opérations', v: String(ops.length), n: `${dm(t0)} → ${dm(t1)}` }, { l: 'Prévu', v: dur(p), n: 'somme des opérations' }, { l: 'Réalisé', v: dur(r), n: 'temps déclaré' }, { l: 'Écart', v: dur(r - p, true), n: `+${pct} % sur le prévu`, sig: true }, { l: 'Pointage', v: dur(h), n: cut ? `${cut} fin${cut > 1 ? 's' : ''} pointée${cut > 1 ? 's' : ''} à 17:00` : 'égal au déclaré' }, { l: 'Plus gros écart', v: `P${worst.poste}`, n: `${dur(worst.ecart_reel_prevu_s, true)}, ${worst.intitule}`, attr: `data-open="poste:${worst.poste}" style="cursor:pointer"` }, { l: "Main-d'œuvre", v: eur(L.total, 2), n: baseSel, raw: true }]);
  document.getElementById('tBase').onchange = e => { T.base = e.target.value; band(); more(); };
}
function turbine() {
  const A = store.analysis; const c = document.getElementById('tCanvas'); if (!c) return;
  const max = Math.max(...A.operations.map(o => o.reel_s)); const { ang, groups } = layout(A.operations); const S = R0 + LEN + 30;
  const ex = c.querySelector('svg.turbine');
  if (ex) { for (const b of ex.querySelectorAll('.blade')) b.style.transform = `rotate(${ang[b.dataset.p]}deg)`; ex.querySelector('#tLabels').innerHTML = labels(groups); }
  else {
    c.innerHTML = `<svg class="turbine" viewBox="${-S} ${-S} ${2 * S} ${2 * S}" role="img" aria-label="Turbine des 56 opérations"><circle r="${R0 - 7}" fill="none" stroke="var(--hair2)"/><g id="tBlades">${A.operations.map(o => { const lp = o.prevu_s / max * LEN, lr = o.reel_s / max * LEN; const y0 = -R0; return `<g class="blade" tabindex="0" role="button" aria-label="Poste ${o.poste}, ${esc(o.intitule)}, ${dur(o.reel_s)} pour ${dur(o.prevu_s)} prévues" data-p="${o.poste}" style="transform:rotate(${ang[o.poste]}deg)"><rect class="hit" x="-11" y="${y0 - LEN - 6}" width="22" height="${LEN + 10}"/><rect class="pv" x="${-W / 2}" y="${y0 - lp}" width="${W}" height="${lp}"/><rect class="rl" x="${-W / 2}" y="${y0 - lr}" width="${W}" height="${lr - lp}"/>${o.controle_horloge !== 'concordant' ? `<circle class="tip" cy="${y0 - lr - 11}" r="4.6"/>` : ''}</g>`; }).join('')}</g><g id="tLabels">${labels(groups)}</g></svg><div class="center" id="tCenter"></div>`;
    const svg = c.querySelector('svg');
    svg.addEventListener('mouseover', e => { const b = e.target.closest('.blade'); if (b) { T.hover = +b.dataset.p; center(); hot(); } });
    svg.addEventListener('mouseout', e => { if (e.target.closest('.blade')) { T.hover = null; center(); hot(); } });
    svg.addEventListener('click', e => { const b = e.target.closest('.blade'); if (b) { openEntity('poste', b.dataset.p); return; } const g = e.target.closest('[data-group]'); if (g) { T.group = T.group === g.dataset.group ? null : g.dataset.group; update(); } });
    svg.addEventListener('focusin', e => { if (e.target.classList?.contains('blade')) { T.hover = +e.target.dataset.p; center(); hot(); } });
    svg.addEventListener('focusout', () => { T.hover = null; center(); hot(); });
  }
  center(); mark();
}
function labels(groups) {
  if (T.mode === 'ecart') return '';
  const max = Math.max(...store.analysis.operations.map(o => o.reel_s));
  return groups.map(g => { const r = R0 + Math.max(...g.ops.map(o => o.reel_s)) / max * LEN + 24; const a = (g.mid - 90) * Math.PI / 180; const x = Math.cos(a) * r, y = Math.sin(a) * r; const anchor = Math.abs(x) < 40 ? 'middle' : x > 0 ? 'start' : 'end'; return `<text class="glabel ${T.group === g.k ? 'on' : ''}" data-group="${esc(g.k)}" x="${x.toFixed(0)}" y="${(y + 5).toFixed(0)}" text-anchor="${anchor}"><title>${g.ops.length} opérations, ${dur(g.ops.reduce((s, o) => s + o.ecart_reel_prevu_s, 0), true)}</title>${esc(groupLabel(g))}</text>`; }).join('');
}
function mark() {
  const ops = new Set(selected().map(o => o.poste)); const sel = store.sel?.type === 'poste' ? +store.sel.id : null;
  document.querySelectorAll('.blade').forEach(b => { const p = +b.dataset.p; b.classList.toggle('dim', !ops.has(p)); b.classList.toggle('sel', p === sel); });
}
function hot() { document.querySelectorAll('.blade').forEach(b => b.classList.toggle('hot', +b.dataset.p === T.hover)); }
function center() {
  const el = document.getElementById('tCenter'); if (!el) return; const A = store.analysis;
  const focus = T.hover ?? (store.sel?.type === 'poste' ? +store.sel.id : null);
  if (focus != null) { const o = A.operations.find(x => x.poste === focus); el.innerHTML = `<div class="v" style="color:var(--red)">${dur(o.ecart_reel_prevu_s, true)}</div><div class="l"><b>P${o.poste}</b> ${esc(o.intitule)}<br>${esc(o.alea)}</div>`; return; }
  const ops = selected(); const p = ops.reduce((s, o) => s + o.prevu_s, 0), r = ops.reduce((s, o) => s + o.reel_s, 0);
  el.innerHTML = `<div class="v">${dur(r - p, true)}</div><div class="l">${esc(groupName(ops) ? groupName(ops) + ', ' : '')}${ops.length} opérations</div>`;
}
function gantt(ops) {
  const days = [...new Set(store.analysis.operations.map(o => o.date))]; const Wd = 1400, L = 86, rh = 40, H = days.length * rh + 24; const a = 8 * 3600, b = 17 * 3600; const x = s => L + (s - a) / (b - a) * (Wd - L - 6);
  const all = store.analysis.operations.map(o => o.ratio_reel_prevu); const rmin = Math.min(...all), rmax = Math.max(...all); const show = new Set(ops.map(o => o.poste)); const hrs = []; for (let h = 8; h <= 17; h++) hrs.push(h);
  return `<svg class="chart" style="width:100%;display:block" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Déroulé des opérations par jour">${hrs.map(h => `<line x1="${x(h * 3600)}" x2="${x(h * 3600)}" y1="0" y2="${H - 20}" stroke="var(--hair)"/><text x="${x(h * 3600)}" y="${H - 5}" text-anchor="middle" font-size="13" fill="var(--ink3)">${h}:00</text>`).join('')}
   ${days.map((d, i) => { const dayOps = store.analysis.operations.filter(o => o.date === d); return `<text x="0" y="${i * rh + 25}" font-size="14" fill="var(--ink)">${esc(dayLabel(dayOps[0]))}</text>` + dayOps.map(o => { const X = x(o.debut_s), w = Math.max(2, x(o.fin_s) - X - 1.5); const t = (o.ratio_reel_prevu - rmin) / Math.max(.001, rmax - rmin); return `<g data-open="poste:${o.poste}" style="cursor:pointer" opacity="${show.has(o.poste) ? 1 : .12}" ${tipAttr(`<b>Poste ${o.poste}</b> ${esc(o.intitule)}<br>${hms(o.debut_s).slice(0, 5)} → ${hms(o.fin_s).slice(0, 5)}<br>Prévu ${dur(o.prevu_s)}, réalisé ${dur(o.reel_s)}`)}><rect x="${X}" y="${i * rh + 6}" width="${w}" height="30" fill="${mix('#efc9c3', '#9e0010', t)}"/>${w > 24 ? `<text x="${X + w / 2}" y="${i * rh + 26}" text-anchor="middle" font-size="13" fill="${t > .45 ? '#fff' : 'var(--ink)'}">${o.poste}</text>` : ''}${o.controle_horloge !== 'concordant' ? `<circle cx="${X + w}" cy="${i * rh + 6}" r="5" fill="var(--panel)" stroke="var(--ink)" stroke-width="1.8"/>` : ''}</g>`; }).join(''); }).join('')}</svg>`;
}
function more() {
  const el = document.getElementById('tMore'); if (!el) return; const ops = selected(); const A = store.analysis;
  const bars = (key, mode) => { const g = {}; for (const o of ops) g[o[key]] = (g[o[key]] || 0) + o.ecart_reel_prevu_s; const e = Object.entries(g).sort((a, b) => b[1] - a[1]); const m = Math.max(...e.map(x => x[1]), 1); return e.map(([k, v]) => barRow(k, v, m, dur(v, true), `data-fg="${mode}" data-fv="${esc(k)}"`, T.mode === mode && T.group === k ? 'on' : '')).join(''); };
  const byZ = {}; for (const o of ops) byZ[o.zone] = (byZ[o.zone] || 0) + (laborOp(o, T.base) || 0); const ze = Object.entries(byZ).sort((a, b) => b[1] - a[1]); const mz = Math.max(...ze.map(x => x[1]), 1);
  const empty = ops.filter(o => laborOp(o, T.base) == null);
  el.innerHTML = `<div class="card"><h2>Déroulé <small>Couleur : ratio réalisé / prévu. ○ fin pointée à 17:00.</small></h2>${gantt(ops)}</div>
   <div class="g3"><div class="card"><h2>Écart par zone</h2>${bars('zone', 'zone')}</div><div class="card"><h2>Écart par famille d'aléa <small>6M, par mots-clés</small></h2>${bars('m6', 'm6')}</div><div class="card"><h2>Main-d'œuvre par zone <small>durée × taux de l'équipe du poste</small></h2>${ze.map(([z, v]) => barRow(z, v, mz, eur(v, 0))).join('')}${empty.length ? `<p class="sub">Sans équipe : P${empty.map(o => o.poste).join(', P')}.</p>` : ''}</div></div>`;
  el.querySelectorAll('[data-fg]').forEach(b => b.onclick = () => { T.mode = b.dataset.fg; T.group = T.group === b.dataset.fv ? null : b.dataset.fv; update(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
}
void src;
