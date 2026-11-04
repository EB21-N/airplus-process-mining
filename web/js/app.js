import { api, bindTips, closeDrawer, emit, esc, nav, onChange, openDrawer, provenance, restoreOverrides, reviewCount, store, toast } from './core.js';
import { renderPilotage } from './pilotage.js';
import { renderJumeau, disposeJumeau } from './jumeau.js';
import { renderEquipe } from './equipe.js';
import { renderDecision } from './decision.js';
import { renderSupply } from './supply.js';

const view = document.getElementById('view');
const route = { space: 'pilotage', sub: null, arg: null };
const renderers = { pilotage: renderPilotage, supply: renderSupply, jumeau: renderJumeau, equipe: renderEquipe, decision: renderDecision };

function setActive() { document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.go === route.space)); }
function render() {
  setActive(); disposeJumeau();
  if (!store.analysis) { view.innerHTML = `<div class="card"><h2>Aucune analyse chargée</h2><p class="sub">Ouvrez le menu Données pour importer les trois Excel ou charger un ZIP d'analyse.</p></div>`; return; }
  renderers[route.space](view, route);
}
nav.go = (space, sub = null, arg = null) => { route.sub = sub ?? (space === route.space ? route.sub : null); route.space = space; route.arg = arg; closeDrawer(); window.scrollTo(0, 0); render(); };

function badges() {
  const s = store.state; const db = document.getElementById('dataBadge'); const sb = document.getElementById('sessionBadge');
  const lab = { preload: 'Analyse préchargée', import: 'Import local', zip: 'ZIP d\'analyse' }[s?.origin] || 'Aucune donnée';
  db.textContent = lab;
  db.title = store.analysis ? `Empreinte du contenu : ${s.content_sha256}` : '';
  const n = Object.keys(store.overrides).length; sb.classList.toggle('hidden', !n); sb.className = 'badge red' + (n ? '' : ' hidden'); sb.textContent = `${n} affectation${n > 1 ? 's' : ''} modifiée${n > 1 ? 's' : ''}`;
}
onChange(k => { if (k === 'assign') badges(); });

async function load() {
  store.state = await api('/api/state');
  if (store.state.loaded) { store.analysis = await api('/api/analysis'); restoreOverrides(); selfCheck(); } else store.analysis = null;
  store.names = null; badges(); emit('data');
}
// Controle croise : les totaux recalcules dans le navigateur doivent egaler ceux du moteur Python
function selfCheck() {
  const A = store.analysis; const k = id => A.kpis.find(x => x.kpi_id === id)?.valeur;
  const sum = f => A.operations.reduce((s, o) => s + (o[f] || 0), 0);
  store.selfcheck = [['Prévu', sum('prevu_s'), k('prevu_total')], ['Réel déclaré', sum('reel_s'), k('reel_declare_total')], ['Horodatages', sum('horo_s'), k('horodatage_total')]].map(([l, a, b]) => ({ l, a, b, ok: a === b }));
}

// ---- Fenetre Donnees
const b64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
function dataModal() {
  const m = document.getElementById('modal'); const s = store.state;
  document.getElementById('modalBody').innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center"><h2>Données</h2><button class="btn small" data-close-modal>Fermer</button></div>
  <p class="sub">Source active : <b>${esc({ preload: 'analyse préchargée', import: 'import local', zip: "ZIP d'analyse" }[s.origin] || 'aucune')}</b>${s.content_sha256 ? ` · empreinte <code>${s.content_sha256.slice(0, 16)}…</code>` : ''}</p>
  <div class="grid g2 mt">
    <div class="card"><h3>Analyse préchargée</h3><p class="sub">Les trois fichiers fournis.</p><button class="btn" id="openPre" ${s.preloaded_available ? '' : 'disabled'}>Ouvrir</button></div>
    <div class="card"><h3>ZIP d'analyse</h3><p class="sub">Archive pseudonymisée.</p><a class="btn" href="/api/analysis/zip" download id="dlZip">Télécharger</a> <label class="btn">Ouvrir un ZIP<input type="file" id="zipFile" accept=".zip" hidden></label></div>
  </div>
  <div class="card mt"><h3>Importer les trois Excel</h3>
   <div class="grid" style="grid-template-columns:90px 1fr;align-items:center;margin:8px 0">
    <label for="fmes">MES</label><input id="fmes" type="file" accept=".xlsx">
    <label for="fplm">PLM</label><input id="fplm" type="file" accept=".xlsx">
    <label for="ferp">ERP</label><input id="ferp" type="file" accept=".xlsx"></div>
   <button class="btn primary" id="runImport">Analyser</button> <span id="impMsg" class="sub"></span></div>`;
  m.classList.remove('hidden');
  const after = async msg => { await load(); m.classList.add('hidden'); render(); toast(msg); };
  document.getElementById('openPre').onclick = async () => { await api('/api/open-preloaded', {}); after('Analyse préchargée ouverte.'); };
  document.getElementById('zipFile').onchange = async e => { try { const r = await api('/api/open-zip', { b64: await b64(e.target.files[0]) }); after(`ZIP chargé, empreinte ${r.content_sha256.slice(0, 8)}.`); } catch (x) { toast(x.message); } };
  document.getElementById('runImport').onclick = async () => {
    const f = ['mes', 'plm', 'erp'].map(k => document.getElementById('f' + k).files[0]); const msg = document.getElementById('impMsg');
    if (f.some(x => !x)) { msg.textContent = 'Sélectionnez les trois fichiers.'; return; }
    msg.textContent = 'Analyse en cours…';
    try {
      const files = {}; for (const [i, k] of ['mes', 'plm', 'erp'].entries()) files[k] = { name: f[i].name, b64: await b64(f[i]) };
      const r = await api('/api/import', { files });
      await load(); render();
      msg.innerHTML = `Terminé. Empreinte <code>${r.content_sha256.slice(0, 12)}…</code>. ${r.identique_a_prechargee === true ? 'Identique à l\'analyse préchargée.' : r.identique_a_prechargee === false ? 'Différente de l\'analyse préchargée.' : ''} Pseudonymisation : ${r.pseudonymisation.fuites.length} fuite(s) sur ${r.pseudonymisation.fichiers_controles} fichiers.`;
    } catch (x) { msg.textContent = x.message; }
  };
}

document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]'); if (go) { e.preventDefault(); nav.go(go.dataset.go); return; }
  const s = e.target.closest('[data-src]'); if (s) { openDrawer(provenance(s.dataset.src)); return; }
  if (e.target.closest('[data-close-drawer]')) closeDrawer();
  if (e.target.closest('[data-close-modal]') || e.target.id === 'modal') document.getElementById('modal').classList.add('hidden');
  if (e.target.id === 'dataBtn') dataModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeDrawer(); document.getElementById('modal').classList.add('hidden'); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[tabindex="0"][role="button"]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
bindTips(document.body);

window.__airplus = { store, reviewCount, nav };
try { await load(); } catch (e) { toast(e.message); }
render();
