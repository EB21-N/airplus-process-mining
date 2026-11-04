import { dur, esc, eur, hms, money, nav, num, src, store, tipAttr } from './core.js';

const S = { sup: null, crit: ['Critique', 'Haute'], metric: 'pieces' };
const CRIT = { Critique: 'var(--c-critique)', Haute: 'var(--c-haute)', Moyenne: 'var(--c-moyenne)', Basse: 'var(--c-basse)' };
const CLASS = { A: 'var(--c-critique)', B: 'var(--c-haute)', C: 'var(--c-moyenne)' };
const des = s => String(s || '').replaceAll('_', ' ');
const fmtDate = (d, opt = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', opt);
const kpi = (l, v, n, a) => `<div class="kpi ${a ? 'accent' : ''}"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="n">${esc(n)}</div></div>`;
const legendCrit = () => `<div class="legend">${Object.entries(CRIT).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('')}</div>`;

export function renderSupply(root) {
  const A = store.analysis; const s = A.supply; const top = s.top3.join(', ').replace(/, ([^,]*)$/, ' et $1');
  const a = A.supply_abc_classes.find(c => c.classe === 'A');
  root.innerHTML = `<section class="hero"><div><h1><em>${num(s.part_top3_pct, 0)} % de la valeur</em> repose sur trois fournisseurs.</h1><p>${s.n_fournisseurs} fournisseurs livrent ${s.n_refs} références pour ${money(s.valeur_totale_eur)}. ${esc(top)} concentrent l'essentiel. À elles seules, ${a.refs.length} références (${a.refs.map(r => des(A.parts.find(p => p.ref === r).designation).toLowerCase()).join(', ')}) pèsent ${num(a.part_pct, 1)} % de la valeur.</p></div>
    <div><div class="legend" style="margin-bottom:0"><span><b>Analyse ABC</b> : la valeur en trois classes</span></div><div class="segbar" role="img" aria-label="Répartition de la valeur par classe ABC">${A.supply_abc_classes.map(c => `<div style="width:${c.part_pct}%;background:${CLASS[c.classe]}" ${tipAttr(`<b>Classe ${c.classe}</b> : ${c.n_refs} références, ${money(c.valeur_eur)}<br>${esc(c.refs.slice(0, 10).join(', '))}${c.refs.length > 10 ? '…' : ''}`)}>${c.part_pct > 25 ? `${c.classe} · ${num(c.part_pct, 0)} %` : c.part_pct > 8 ? c.classe : ''}</div>`).join('')}</div><div class="legend">${A.supply_abc_classes.map(c => `<span><i style="background:${CLASS[c.classe]}"></i>${c.classe} : ${c.n_refs} réf., ${num(c.part_pct, 1)} %</span>`).join('')}</div></div></section>
  <div class="kpis mt">
    ${kpi('Valeur totale', money(s.valeur_totale_eur), `${s.qty_totale} pièces, ${s.n_refs} références`)}
    ${kpi('Masse à recevoir', `${num(s.masse_totale_kg / 1000, 1)} t`, 'quantité × masse unitaire')}
    ${kpi('Délai le plus long', `${s.delai_max_j} jours`, `${A.parts.find(p => p.ref === s.premiere_commande_ref).fournisseur}, ${s.premiere_commande_ref}`, true)}
    ${kpi('Délai moyen pondéré', `${num(s.delai_moyen_pondere_j, 0)} jours`, `${num(s.delai_moyen_simple_j, 0)} jours sans pondérer par la valeur`)}
    ${kpi('Références critiques', String(s.n_critiques), `${num(s.part_critique_pct, 0)} % de la valeur`)}
    ${kpi('Première commande', fmtDate(s.premiere_commande, { day: 'numeric', month: 'short' }), `pour un démarrage le ${fmtDate(s.premier_besoin, { day: 'numeric', month: 'short' })}`)}
  </div>
  <div class="grid g-3-2 mt"><div class="card"><h2>Qui livre quoi</h2><p class="sub">Part de chaque fournisseur dans la valeur de la nomenclature. Cliquez pour le suivre dans toute la page.</p><div id="supBars" style="margin-top:8px"></div></div>
    <div class="card sup-card" id="supCard"></div></div>
  <div class="card mt"><h2>Le chemin des pièces, du fournisseur à l'avion</h2><p class="sub">Pièces citées au MES, de chaque fournisseur vers chaque zone d'assemblage.</p>
    <div class="filters" style="padding:6px 0"><button class="chip" data-m="pieces">En nombre de pièces</button><button class="chip" data-m="valeur_eur">En valeur</button></div><div id="sankey"></div></div>
  <div class="card mt"><h2>Le rétro-planning des commandes</h2><p class="sub">Date de première utilisation au MES moins délai du PLM : quand commander pour que la pièce arrive à temps, en prenant le délai le plus long. Le losange marque le délai le plus court.</p>
    <div class="filters" style="padding:6px 0" id="critChips">${Object.entries(CRIT).map(([k, c]) => `<button class="chip" data-c="${k}"><i style="background:${c}"></i>${k}</button>`).join('')}</div><div id="calendar"></div></div>
  <div class="grid g2 mt"><div class="card"><h2>Valeur et délai, référence par référence</h2><p class="sub">En haut à droite : cher et long à obtenir. Échelle de valeur logarithmique. Cliquez pour ouvrir la fiche.</p>${legendCrit()}<div id="scatter"></div></div>
    <div class="card"><h2>Criticité et délai</h2><p class="sub">Nombre de références et valeur par case. Plus la case est sombre, plus elle pèse en valeur.</p><div id="heat" style="margin-top:10px"></div></div></div>
  <div class="grid g2 mt"><div class="card"><h2>Les postes qui dépendent le plus des fournisseurs</h2><p class="sub">Délai le plus long parmi les pièces du poste. Cliquez pour ouvrir le poste.</p><div id="supPostes" style="margin-top:8px"></div></div>
    <div class="card"><h2>Nomenclature et relevé ne disent pas toujours pareil</h2><p class="sub">Occurrences au MES moins quantité de nomenclature, pour les ${A.supply_ecarts.length} références qui diffèrent.</p><div id="ecarts" style="margin-top:8px"></div></div></div>`;
  root.addEventListener('click', onClick);
  drawAll();
}
function onClick(e) {
  const v = document.getElementById('supBars'); if (!v) return;
  const f = e.target.closest('[data-sup]'); if (f) { S.sup = S.sup === f.dataset.sup ? null : f.dataset.sup; drawAll(); return; }
  const m = e.target.closest('[data-m]'); if (m) { S.metric = m.dataset.m; drawSankey(); return; }
  const c = e.target.closest('[data-c]'); if (c) { S.crit = S.crit.includes(c.dataset.c) ? S.crit.filter(x => x !== c.dataset.c) : [...S.crit, c.dataset.c]; drawCalendar(); return; }
  const r = e.target.closest('[data-cat]'); if (r) { nav.go('jumeau', 'catalogue', { ref: r.dataset.cat }); return; }
  const p = e.target.closest('[data-open]'); if (p) { nav.go('jumeau', 'atelier', { poste: +p.dataset.open }); return; }
  const ai = e.target.closest('#supAsk'); if (ai) nav.go('decision', null, { question: `Quels points vérifier sur l'approvisionnement auprès de ${S.sup} et quels postes sont concernés ?`, auto: true });
}
function drawAll() { drawBars(); drawCard(); drawSankey(); drawCalendar(); drawScatter(); drawHeat(); drawPostes(); drawEcarts(); }

function drawBars() {
  const A = store.analysis; const m = A.suppliers[0].valeur_eur;
  document.getElementById('supBars').innerHTML = A.suppliers.map(s => `<button class="bar-row click ${S.sup === s.fournisseur ? 'sel' : ''}" data-sup="${esc(s.fournisseur)}" aria-pressed="${S.sup === s.fournisseur}" ${tipAttr(`<b>${esc(s.fournisseur)}</b><br>${s.n_refs} référence${s.n_refs > 1 ? 's' : ''}, ${num(s.part_pct, 1)} % de la valeur<br>Délai : ${s.delai_min_j} à ${s.delai_max_j} jours`)}><span>${esc(s.fournisseur)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(s.valeur_eur / m * 100, .4)}%;background:${CRIT[s.criticite_max]}"></div></div><span class="val">${money(s.valeur_eur)}</span></button>`).join('') + `<div style="margin-top:8px">${legendCrit().replace('<div class="legend">', '<div class="legend"><span class="sub">Criticité la plus haute de ses pièces :</span>')}</div>`;
}
function drawCard() {
  const A = store.analysis; const el = document.getElementById('supCard'); const s = A.suppliers.find(x => x.fournisseur === S.sup);
  if (!s) {
    const ps = A.supply_postes.slice(0, 1)[0]; const c = A.supply_calendar.slice(0, 3);
    el.innerHTML = `<h2>À retenir</h2><div class="claim"><b>${esc(des(c[0].designation))} : la commande à lancer en premier.</b><br><span class="sub">${esc(c[0].ref)} (${esc(c[0].fournisseur)}) demande jusqu'à ${c[0].delai_max_j} jours : à commander le ${fmtDate(c[0].commande_au_plus_tard)} au plus tard pour le poste ${c[0].premier_poste}.</span></div>
    <div class="claim"><b>Le poste ${ps.poste} attend le plus longtemps.</b><br><span class="sub">${esc(ps.intitule)} : ${ps.n_refs} références de ${ps.n_fournisseurs} fournisseurs, pour ${money(ps.valeur_pieces_eur)}.</span></div>
    <div class="claim"><b>Un fournisseur par référence.</b><br><span class="sub">Dans le PLM, chacune des ${A.parts.length} références n'a qu'un seul fournisseur.</span></div><p class="sub">Cliquez sur un fournisseur pour voir sa fiche.</p>`; return;
  }
  const parts = A.parts.filter(p => p.fournisseur === s.fournisseur);
  el.innerHTML = `<h2>${esc(s.fournisseur)}</h2><p class="sub">${num(s.part_pct, 1)} % de la valeur · délai ${s.delai_min_j} à ${s.delai_max_j} jours</p>
   <dl class="facts"><dt>Valeur</dt><dd><b>${eur(s.valeur_eur, 0)}</b></dd><dt>Masse</dt><dd>${num(s.masse_kg, 1)} kg</dd><dt>Postes servis</dt><dd>${s.postes.length ? s.postes.length : 'aucun au MES'}</dd>${Object.keys(s.zones).length ? `<dt>Zones</dt><dd>${Object.keys(s.zones).map(esc).join(', ')}</dd>` : ''}</dl>
   <h3 class="mt">Références</h3><table><tbody>${parts.map(p => `<tr class="click" data-cat="${esc(p.ref)}"><td>${esc(p.ref)}</td><td>${esc(des(p.designation))}</td><td class="num">× ${p.qty_nomenclature}</td><td class="num">${money(p.valeur_nomenclature_eur)}</td></tr>`).join('')}</tbody></table>
   ${s.postes.length ? `<button class="btn primary mt" id="supAsk">Demander à l'IA quoi vérifier</button>` : ''} <button class="btn mt" data-sup="${esc(s.fournisseur)}">Fermer</button>`;
}
function drawSankey() {
  const A = store.analysis; const metric = S.metric; document.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === metric));
  const flows = A.supply_flows.filter(f => f[metric] > 0);
  const total = flows.reduce((s, f) => s + f[metric], 0); const W = 1100, gap = 8, top = 6;
  const left = [...new Set(flows.map(f => f.fournisseur))].map(n => ({ n, v: flows.filter(f => f.fournisseur === n).reduce((s, f) => s + f[metric], 0) })).sort((a, b) => b.v - a.v);
  const order = A.zones.map(z => z.zone); const right = order.filter(z => flows.some(f => f.zone === z)).map(n => ({ n, v: flows.filter(f => f.zone === n).reduce((s, f) => s + f[metric], 0) }));
  const H = Math.max(left.length * 28, right.length * 34) + 40; const usable = n => H - top * 2 - gap * (n - 1);
  const minH = metric === 'pieces' ? 4 : 5; const scale = Math.min(usable(left.length), usable(right.length)) * .78 / total;
  const place = L => { let y = top; for (const x of L) { x.h = Math.max(minH, x.v * scale); x.y = y; x.off = 0; y += x.h + gap; } const free = H - top - y; if (free > 0) L.forEach((x, i) => { x.y += free * (i / Math.max(1, L.length - 1)) * .9; }); };
  place(left); place(right);
  const x0 = 210, x1 = W - 170; const fmt = v => metric === 'pieces' ? `${v} pièce${v > 1 ? 's' : ''}` : money(v);
  const ribbons = flows.slice().sort((a, b) => b[metric] - a[metric]).map(f => {
    const l = left.find(x => x.n === f.fournisseur), r = right.find(x => x.n === f.zone); const lh = Math.max(1, f[metric] / l.v * l.h), rh = Math.max(1, f[metric] / r.v * r.h);
    const ya = l.y + l.off, yb = r.y + r.off; l.off += lh; r.off += rh; const m = (x0 + x1) / 2; const on = !S.sup || S.sup === f.fournisseur;
    return `<path d="M${x0} ${ya} C${m} ${ya} ${m} ${yb} ${x1} ${yb} L${x1} ${yb + rh} C${m} ${yb + rh} ${m} ${ya + lh} ${x0} ${ya + lh} Z" fill="${S.sup === f.fournisseur ? 'var(--red)' : 'var(--c-moyenne)'}" opacity="${on ? (S.sup ? .85 : .5) : .1}" ${tipAttr(`<b>${esc(f.fournisseur)} → ${esc(f.zone)}</b><br>${f.pieces} pièces, ${money(f.valeur_eur)}<br>Références : ${esc(f.refs.join(', '))}<br>Postes : ${f.postes.join(', ')}`)}/>`;
  }).join('');
  const node = (x, L, anchor, dx) => L.map(n => `<g ${anchor === 'end' ? `data-sup="${esc(n.n)}" style="cursor:pointer"` : ''}><rect x="${x}" y="${n.y}" width="8" height="${n.h}" rx="3" fill="${S.sup === n.n ? 'var(--red)' : 'var(--ink2)'}"/><text x="${x + dx}" y="${n.y + n.h / 2 + 4}" text-anchor="${anchor}" style="fill:var(--ink);font-size:13px" font-weight="${S.sup === n.n ? 650 : 400}">${esc(n.n.length > 29 ? n.n.slice(0, 28) + '…' : n.n)}</text></g>`).join('');
  document.getElementById('sankey').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Flux de pièces des fournisseurs vers les zones">${ribbons}${node(x0 - 8, left, 'end', -6)}${node(x1, right, 'start', 14)}</svg><p class="sub">${fmt(total)} au total.</p>`;
}
function drawCalendar() {
  const A = store.analysis; document.querySelectorAll('[data-c]').forEach(b => { const on = S.crit.includes(b.dataset.c); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const rows = A.supply_calendar.filter(c => S.crit.includes(c.criticite) && (!S.sup || c.fournisseur === S.sup));
  const el = document.getElementById('calendar');
  if (!rows.length) { el.innerHTML = '<p class="sub">Aucune référence pour cette sélection.</p>'; return; }
  const W = 1100, L = 210, rh = 25, T = 26; const H = T + rows.length * rh + 6;
  const t = d => new Date(d + 'T12:00:00').getTime(); const a = t(A.supply.premiere_commande) - 2 * 864e5, b = Math.max(...A.supply_calendar.map(c => t(c.date_besoin))) + 2 * 864e5; const x = d => L + (t(d) - a) / (b - a) * (W - L - 10);
  const weeks = []; for (let d = a; d <= b; d += 7 * 864e5) weeks.push(new Date(d).toISOString().slice(0, 10));
  document.getElementById('calendar').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rétro-planning des commandes">
   ${weeks.map(d => `<line x1="${x(d)}" x2="${x(d)}" y1="${T - 6}" y2="${H}" stroke="var(--line)"/><text x="${x(d)}" y="14" text-anchor="middle">${fmtDate(d, { day: 'numeric', month: 'short' })}</text>`).join('')}
   ${rows.map((c, i) => { const y = T + i * rh; return `<g data-cat="${esc(c.ref)}" style="cursor:pointer" ${tipAttr(`<b>${esc(c.ref)} ${esc(des(c.designation))}</b> · ${esc(c.fournisseur)}<br>Commander le ${fmtDate(c.commande_au_plus_tard)} (délai de ${c.delai_max_j} j)<br>Ou le ${fmtDate(c.commande_si_delai_court)} si le délai court de ${c.delai_min_j} j est tenu<br>Premier usage : poste ${c.premier_poste}, ${fmtDate(c.date_besoin)}`)}>
     <text x="${L - 10}" y="${y + 15}" text-anchor="end" style="fill:var(--ink);font-size:12.5px">${esc(c.ref)} ${esc(des(c.designation).slice(0, 21))}</text>
     <rect x="${x(c.commande_au_plus_tard)}" y="${y + 4}" width="${Math.max(2, x(c.date_besoin) - x(c.commande_au_plus_tard))}" height="15" rx="5" fill="${CRIT[c.criticite]}"/>
     <rect x="${x(c.commande_si_delai_court) - 4}" y="${y + 7.5}" width="8" height="8" transform="rotate(45 ${x(c.commande_si_delai_court)} ${y + 11.5})" fill="#fff" stroke="var(--ink)" stroke-width="1"/></g>`; }).join('')}</svg>`;
}
function drawScatter() {
  const A = store.analysis; const parts = A.parts.filter(p => p.delai_max_j != null && p.valeur_nomenclature_eur > 0); const W = 620, H = 330, L = 58, B = 34, T = 10, R = 12;
  const lx = d => L + d / 50 * (W - L - R); const vmin = 40, vmax = 2e7; const ly = v => H - B - (Math.log10(v) - Math.log10(vmin)) / (Math.log10(vmax) - Math.log10(vmin)) * (H - B - T);
  const seen = {}; const dots = parts.map(p => { const k = p.delai_max_j; seen[k] = (seen[k] || 0) + 1; const j = ((seen[k] % 5) - 2) * 3.4; return { p, x: lx(k) + j, y: ly(p.valeur_nomenclature_eur) }; });
  const ticks = [100, 1000, 10000, 100000, 1000000, 10000000];
  const labelled = new Set(A.supply_abc_classes[0].refs.concat(A.supply_abc_classes[1].refs.slice(0, 2)));
  document.getElementById('scatter').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Valeur et délai par référence">
   ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${ly(v)}" y2="${ly(v)}" stroke="var(--line)"/><text x="${L - 7}" y="${ly(v) + 4}" text-anchor="end">${money(v)}</text>`).join('')}
   ${[0, 10, 20, 30, 40, 50].map(d => `<text x="${lx(d)}" y="${H - 14}" text-anchor="middle">${d} j</text>`).join('')}<text x="${W - R}" y="${H - 1}" text-anchor="end">délai maximal</text>
   ${dots.map(({ p, x, y }) => { const dim = S.sup && p.fournisseur !== S.sup; return `<g data-cat="${esc(p.ref)}" style="cursor:pointer" opacity="${dim ? .15 : 1}" ${tipAttr(`<b>${esc(p.ref)} ${esc(des(p.designation))}</b><br>${esc(p.fournisseur)}<br>${money(p.valeur_nomenclature_eur)}, délai ${esc(p.delai_source)}<br>Criticité ${esc(p.criticite)}`)}><circle cx="${x}" cy="${y}" r="12" fill="transparent"/><circle cx="${x}" cy="${y}" r="6" fill="${CRIT[p.criticite]}" stroke="#fffdf9" stroke-width="1.5"/>${labelled.has(p.ref) ? `<text x="${x + 9}" y="${y + 4}" style="fill:var(--ink);font-size:12px">${esc(des(p.designation))}</text>` : ''}</g>`; }).join('')}</svg>`;
}
function drawHeat() {
  const A = store.analysis; const cols = [...new Set(A.supply_grid.map(g => g.delai))], rows = [...new Set(A.supply_grid.map(g => g.criticite))]; const m = Math.max(...A.supply_grid.map(g => Math.log10(g.valeur_eur + 1)));
  const shade = v => { if (!v) return ['var(--surface2)', 'var(--ink3)']; const t = Math.log10(v + 1) / m; const hex = n => Math.round(n).toString(16).padStart(2, '0'); const mixc = (a, b) => a + (b - a) * t; return [`#${hex(mixc(252, 125))}${hex(mixc(236, 10))}${hex(mixc(232, 28))}`, t > .55 ? '#fff' : 'var(--ink)']; };
  document.getElementById('heat').innerHTML = `<div class="heat"><span></span>${cols.map(c => `<span class="h">${esc(c)}</span>`).join('')}${rows.map(r => `<span class="r">${esc(r)}</span>` + cols.map(c => { const g = A.supply_grid.find(x => x.criticite === r && x.delai === c); const [bg, fg] = shade(g.valeur_eur); return g.n_refs ? `<div class="c" style="background:${bg};color:${fg}" ${tipAttr(`<b>${esc(r)}, ${esc(c)}</b><br>${g.n_refs} références : ${esc(g.refs.join(', '))}`)}><b>${g.n_refs}</b><small>${money(g.valeur_eur)}</small></div>` : `<div class="c" style="background:${bg};opacity:.5"></div>`; }).join('')).join('')}</div>`;
}
function drawPostes() {
  const A = store.analysis; const rows = A.supply_postes.filter(p => !S.sup || A.parts.find(x => x.ref === p.ref_delai_max)?.fournisseur === S.sup).slice(0, 8); const m = 45;
  document.getElementById('supPostes').innerHTML = rows.map(p => `<button class="bar-row click" data-open="${p.poste}" style="grid-template-columns:minmax(120px,1.4fr) 1fr 60px" ${tipAttr(`<b>Poste ${p.poste}</b> · ${esc(p.intitule)}<br>${p.n_refs} références, ${p.n_fournisseurs} fournisseurs, ${p.n_critiques} critiques<br>Délai le plus long : ${esc(p.ref_delai_max)} (${esc(p.fournisseur_delai_max)})<br>Valeur des pièces : ${money(p.valeur_pieces_eur)}`)}><span>P${p.poste} ${esc(p.intitule)}</span><div class="bar-track"><div class="bar-fill" style="width:${p.delai_max_j / m * 100}%"></div></div><span class="val">${p.delai_max_j} j</span></button>`).join('') || '<p class="sub">Ce fournisseur ne donne le délai le plus long d\'aucun poste.</p>';
}
function drawEcarts() {
  const A = store.analysis; const rows = A.supply_ecarts; const m = Math.max(...rows.map(e => Math.abs(e.ecart))); const W = 560, rh = 27, L = 176, half = (W - L - 66) / 2, mid = L + 34 + half; const H = rows.length * rh + 22;
  document.getElementById('ecarts').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Écarts entre occurrences MES et nomenclature"><text x="${mid - half}" y="12">moins au MES</text><text x="${mid + half}" y="12" text-anchor="end">plus au MES</text><line x1="${mid}" x2="${mid}" y1="18" y2="${H}" stroke="var(--ink3)"/>
   ${rows.map((e, i) => { const y = 20 + i * rh; const w = Math.abs(e.ecart) / m * half; const x = e.ecart < 0 ? mid - w : mid; const dim = S.sup && A.parts.find(p => p.ref === e.ref)?.fournisseur !== S.sup; return `<g data-cat="${esc(e.ref)}" style="cursor:pointer" opacity="${dim ? .2 : 1}" ${tipAttr(`<b>${esc(e.ref)} ${esc(des(e.designation))}</b><br>Nomenclature ${e.nomenclature}, MES ${e.occurrences_mes}`)}><text x="${L - 10}" y="${y + 15}" text-anchor="end" style="fill:var(--ink);font-size:12.5px">${esc(e.ref)} ${esc(des(e.designation).slice(0, 15))}</text><rect x="${x}" y="${y + 3}" width="${w}" height="16" rx="4" fill="${e.ecart < 0 ? 'var(--horo)' : 'var(--red)'}"/><text x="${e.ecart < 0 ? x - 5 : x + w + 5}" y="${y + 15}" text-anchor="${e.ecart < 0 ? 'end' : 'start'}" style="fill:var(--ink2)">${e.ecart > 0 ? '+' : ''}${e.ecart}</text></g>`; }).join('')}</svg>`;
}
void dur; void hms; void src;
