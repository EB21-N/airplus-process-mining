import { api, bindTips, closeDrawer, displayName, emit, esc, nav, onChange, openDrawer, posteOf, provenance, restoreOverrides, store, toast } from './core.js';
import { bindSheetEvents, closeSheet, des, openEntity, step } from './sheets.js';
import { renderTemps } from './temps.js';
import { renderPieces } from './pieces.js';
import { disposeAvion, renderAvion } from './avion.js';
import { renderEquipe } from './equipe.js';
import { renderQuestion } from './question.js';
import { renderSources } from './sources.js';

const view = document.getElementById('view');
const route = { sub: null, arg: null };
const LENSES = ['temps', 'pieces', 'avion', 'equipe', 'question', 'sources'];
const renderers = { temps: renderTemps, pieces: renderPieces, avion: renderAvion, equipe: renderEquipe, question: renderQuestion, sources: (r, ro) => renderSources(r, ro, reload) };

function render() {
  document.querySelectorAll('.nav button').forEach(b => { const on = b.dataset.go === store.lens; b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  disposeAvion();
  if (!store.analysis) { view.innerHTML = `<div class="page"><div class="card"><h2>Aucune analyse</h2><p><button class="link" data-go="sources">Importer les trois Excel</button></p></div></div>`; return; }
  renderers[store.lens](view, route);
}
nav.go = (lens, sub = null, arg = null) => {
  if (!LENSES.includes(lens)) lens = 'temps';
  route.sub = sub; route.arg = arg; store.lens = lens; closeSheet(); closeDrawer(); window.scrollTo(0, 0);
  history.replaceState(null, '', `#${lens}`); render();
};
function badges() { const n = Object.keys(store.overrides).length; const b = document.getElementById('sessionBadge'); b.classList.toggle('hidden', !n); b.textContent = `${n} affectation${n > 1 ? 's' : ''} déplacée${n > 1 ? 's' : ''}`; }
onChange(k => { if (k === 'assign') badges(); });
function selfCheck() { const A = store.analysis; const k = id => A.kpis.find(x => x.kpi_id === id)?.valeur; const sum = f => A.operations.reduce((s, o) => s + (o[f] || 0), 0); store.selfcheck = [['Prévu', sum('prevu_s'), k('prevu_total')], ['Réalisé', sum('reel_s'), k('reel_declare_total')], ['Pointage', sum('horo_s'), k('horodatage_total')]].map(([l, a, b]) => ({ l, a, b, ok: a === b })); }
async function load() { store.state = await api('/api/state'); if (store.state.loaded) { store.analysis = await api('/api/analysis'); restoreOverrides(); selfCheck(); } else store.analysis = null; store.names = null; badges(); emit('data'); }
async function reload() { await load(); render(); }

// Recherche globale
const pal = { items: [], i: 0 };
function palIndex() { const A = store.analysis; return [...A.postes.map(p => ({ t: 'poste', id: p.poste, l: `${p.poste} ${p.intitule}`, s: 'Poste', k: `poste ${p.poste} ${p.intitule} ${p.zone}` })), ...A.parts.map(p => ({ t: 'ref', id: p.ref, l: des(p.designation), s: `${p.ref} · ${p.fournisseur}`, k: `${p.ref} ${p.designation} ${p.fournisseur}` })), ...A.suppliers.map(s => ({ t: 'sup', id: s.fournisseur, l: s.fournisseur, s: 'Fournisseur', k: s.fournisseur })), ...A.persons.map(p => ({ t: 'person', id: p.person_id, l: displayName(p), s: `${p.qualification} · poste ${posteOf(p)}`, k: `${displayName(p)} ${p.person_id} ${p.qualification}` }))]; }
function palDraw() { document.getElementById('paletteList').innerHTML = pal.items.map((x, i) => `<button class="pal-item ${i === pal.i ? 'on' : ''}" data-i="${i}" role="option" aria-selected="${i === pal.i}"><span>${esc(x.l)}</span><em>${esc(x.s)}</em></button>`).join(''); document.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' }); }
function palFilter(q) { const s = q.trim().toLowerCase(); const all = palIndex(); pal.items = (s ? all.filter(x => x.k.toLowerCase().includes(s)) : all.filter(x => x.t === 'sup').slice(0, 6)).slice(0, 30); pal.i = 0; palDraw(); }
function palOpen() { if (!store.analysis) return; const p = document.getElementById('palette'); p.classList.remove('hidden'); const i = document.getElementById('paletteInput'); i.value = ''; palFilter(''); i.focus(); }
function palClose() { document.getElementById('palette').classList.add('hidden'); }
function palGo(x) { if (x) { palClose(); openEntity(x.t, x.id); } }
document.getElementById('searchBtn').onclick = palOpen;
document.getElementById('paletteInput').oninput = e => palFilter(e.target.value);
document.getElementById('paletteInput').onkeydown = e => { if (e.key === 'ArrowDown') { e.preventDefault(); pal.i = Math.min(pal.items.length - 1, pal.i + 1); palDraw(); } if (e.key === 'ArrowUp') { e.preventDefault(); pal.i = Math.max(0, pal.i - 1); palDraw(); } if (e.key === 'Enter') palGo(pal.items[pal.i]); };
document.getElementById('palette').onclick = e => { const b = e.target.closest('[data-i]'); if (b) palGo(pal.items[+b.dataset.i]); else if (e.target.id === 'palette') palClose(); };

document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]'); if (go) { e.preventDefault(); nav.go(go.dataset.go); return; }
  const s = e.target.closest('[data-src]'); if (s) { openDrawer(provenance(s.dataset.src)); return; }
  if (e.target.closest('[data-close-drawer]')) closeDrawer();
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palOpen(); return; }
  if (e.key === 'Escape') { if (!document.getElementById('palette').classList.contains('hidden')) palClose(); else if (document.getElementById('drawer').classList.contains('open')) closeDrawer(); else closeSheet(); return; }
  if (e.target.matches?.('input,textarea,select')) return;
  if (e.key === '/') { e.preventDefault(); palOpen(); return; }
  if (['1', '2', '3', '4', '5'].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { nav.go(LENSES[+e.key - 1]); return; }
  if (store.sel && e.key === 'ArrowRight') step(1);
  if (store.sel && e.key === 'ArrowLeft') step(-1);
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[tabindex="0"][role="button"]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
bindTips(document.body); bindSheetEvents();
window.__airplus = { store, nav, openEntity };
try { await load(); } catch (e) { toast(e.message); }
const h = location.hash.slice(1).split('/'); store.lens = LENSES.includes(h[0]) ? h[0] : 'temps'; render();
if (h[1] && h[2] && store.analysis) openEntity(h[1], decodeURIComponent(h[2]));
