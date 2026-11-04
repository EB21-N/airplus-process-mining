// Composants communs : bande de valeurs, table triable reliee au graphique, barres.
import { esc } from './core.js';

export const kband = cells => `<div class="kband">${cells.map(c => `<div class="k ${c.sig ? 'sig' : ''}" ${c.attr || ''}><div class="lab">${esc(c.l)}</div><div class="v">${esc(c.v)}</div>${c.n ? `<div class="n">${c.raw ? c.n : esc(c.n)}</div>` : ''}</div>`).join('')}</div>`;

export const barCell = (v, max, label, color = 'var(--red)') => `<div class="cb"><u style="width:${Math.max(1, Math.abs(v) / (max || 1) * 100)}%;background:${color}"></u><span>${label}</span></div>`;

export const barRow = (label, v, max, shown, attr = '', cls = '') => `<${attr ? 'button' : 'div'} class="barrow ${cls}" ${attr}><span>${esc(label)}</span><i style="width:${Math.max(.4, v / (max || 1) * 100)}%"></i><em>${shown}</em></${attr ? 'button' : 'div'}>`;

/* cols : { t: titre, v: r => valeur de tri, h: r => html, n: numerique, c: coupe longue }
   opts : { rows, sort, desc, attr: r => attributs, key: r => id, search, onHover, selected } */
export function dataTable(el, opts) {
  const S = { sort: opts.sort ?? 0, desc: opts.desc ?? false, q: '' };
  const draw = () => {
    const col = opts.cols[S.sort]; const q = S.q.toLowerCase();
    let rows = opts.rows();
    if (q) rows = rows.filter(r => opts.cols.map(c => c.v(r)).join(' ').toLowerCase().includes(q));
    rows = rows.slice().sort((a, b) => { const x = col.v(a), y = col.v(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'fr', { numeric: true }); return S.desc ? -c : c; });
    el.querySelector('table').innerHTML = `<thead><tr>${opts.cols.map((c, i) => `<th class="${c.n ? 'n' : ''} ${i === S.sort ? 'on' : ''}" aria-sort="${i === S.sort ? (S.desc ? 'descending' : 'ascending') : 'none'}"><button data-sort="${i}">${esc(c.t)}${i === S.sort ? (S.desc ? ' ▾' : ' ▴') : ''}</button></th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr class="click" tabindex="0" role="button" data-k="${esc(opts.key(r))}" ${opts.attr(r)}>${opts.cols.map(c => `<td class="${c.n ? 'n' : ''} ${c.c ? 'c' : ''}">${c.h ? c.h(r) : esc(c.v(r))}</td>`).join('')}</tr>`).join('')}</tbody>`;
    const cnt = el.querySelector('.tcount'); if (cnt) cnt.textContent = `${rows.length} ligne${rows.length > 1 ? 's' : ''}`;
    mark();
  };
  const mark = () => { const s = opts.selected?.(); el.querySelectorAll('tbody tr').forEach(t => t.classList.toggle('sel', s != null && t.dataset.k === String(s))); };
  el.innerHTML = `${opts.search ? `<div class="tsearch"><input type="search" aria-label="${esc(opts.search)}" placeholder="${esc(opts.search)}"><span class="tcount"></span></div>` : ''}<table></table>`;
  el.querySelector('input')?.addEventListener('input', e => { S.q = e.target.value; draw(); });
  el.addEventListener('click', e => { const b = e.target.closest('[data-sort]'); if (!b) return; const i = +b.dataset.sort; if (S.sort === i) S.desc = !S.desc; else { S.sort = i; S.desc = !!opts.cols[i].n; } draw(); });
  if (opts.onHover) { el.addEventListener('mouseover', e => { const t = e.target.closest('tbody tr'); if (t) opts.onHover(t.dataset.k); }); el.addEventListener('mouseleave', () => opts.onHover(null)); }
  draw();
  return { draw, mark };
}
