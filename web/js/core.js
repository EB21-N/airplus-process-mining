// Etat partage, calculs recalculables et utilitaires d'affichage.
export const store = { analysis: null, state: null, overrides: {}, names: null, listeners: new Set(), lastAsk: null };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const hms = sec => { if (sec == null) return '—'; const n = sec < 0; sec = Math.abs(Math.round(sec)); const p = v => String(v).padStart(2, '0'); return (n ? '−' : '') + p(Math.floor(sec / 3600)) + ':' + p(Math.floor(sec % 3600 / 60)) + ':' + p(sec % 60); };
export const eur = (v, dec = 2) => v == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
export const num = (v, d = 0) => v == null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(v);
export const unk = (v, suffix = '') => v == null || v === '' ? '' : esc(v) + suffix;
// Durees et montants lisibles par un humain ; la valeur exacte reste dans les tableaux et la provenance.
export const dur = (sec, signed = false) => { if (sec == null) return ''; const a = Math.abs(Math.round(sec)); const h = Math.floor(a / 3600), m = Math.round(a % 3600 / 60); const hh = m === 60 ? h + 1 : h, mm = m === 60 ? 0 : m; const t = hh ? `${hh} h${mm ? ' ' + String(mm).padStart(2, '0') : ''}` : mm ? `${mm} min` : `${a} s`; return (sec < 0 ? '−' : signed ? '+' : '') + t; };
export const money = v => { if (v == null) return ''; const a = Math.abs(v); const f = (n, d) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(n); return a >= 1e6 ? `${f(v / 1e6, 1)} M€` : a >= 1e4 ? `${f(v / 1e3, 0)} k€` : `${f(v, 0)} €`; };
const srcLabel = x => { let m; if ((m = x.match(/^MES!L(\d+)$/))) return `MES, ligne ${m[1]}`; if ((m = x.match(/^PLM!.*!L(\d+)$/))) return `PLM, ligne ${m[1]}`; if ((m = x.match(/^ERP!.*!L(\d+)$/))) return `ERP, ligne ${m[1]}`; if ((m = x.match(/^NOTICE!p(\d+)/))) return `Notice, p. ${m[1]}`; if (x.startsWith('CAO!')) return 'Modèle 3D'; if (x.startsWith('KPI!')) return 'Calcul'; return x.split('!')[0]; };
export const src = s => s ? [...new Set(String(s).split(';').filter(Boolean))].slice(0, 4).map(x => `<button class="src" data-src="${esc(x)}" title="Voir la source ${esc(x)}">${esc(srcLabel(x))}</button>`).join(' ') : '';

export async function api(path, body) {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({ error: 'Réponse illisible du serveur.' }));
  if (!r.ok) { const e = new Error(j.error || `Erreur ${r.status}`); e.status = r.status; e.data = j; throw e; }
  return j;
}

export function onChange(fn) { store.listeners.add(fn); return () => store.listeners.delete(fn); }
export function emit(kind) { for (const f of [...store.listeners]) f(kind); }

// ---- Affectations : reference ERP + modifications en session -------------------------------------------
export function posteOf(p) { return store.overrides[p.person_id] ?? p.poste_origine; }
export function setAssignment(pid, poste) {
  const p = store.analysis.persons.find(x => x.person_id === pid);
  if (poste === p.poste_origine) delete store.overrides[pid]; else store.overrides[pid] = poste;
  persist(); emit('assign');
}
export function resetAssignments() { store.overrides = {}; persist(); emit('assign'); }
const KEY = () => 'airplus-overrides-' + (store.state?.content_sha256 || '');
function persist() { try { sessionStorage.setItem(KEY(), JSON.stringify(store.overrides)); } catch { /* stockage indisponible : la session reste en memoire */ } }
export function restoreOverrides() { try { const v = sessionStorage.getItem(KEY()); store.overrides = v ? JSON.parse(v) : {}; } catch { store.overrides = {}; } }
export function teamOf(poste) { return store.analysis.persons.filter(p => posteOf(p) === poste); }
export function displayName(p) { return store.names?.[p.person_id] || p.pseudo; }

// ---- Valorisation main-d'oeuvre : duree operatoire x somme des taux ERP des personnes affectees au poste
const BASE = { prevu: 'prevu_s', reel: 'reel_s', horo: 'horo_s' };
export function rateSum(poste) { return teamOf(poste).reduce((s, p) => s + (p.taux_horaire_eur || 0), 0); }
export function laborOp(op, base = 'reel') { const d = op[BASE[base]]; const t = teamOf(op.poste); if (d == null || !t.length) return null; return rateSum(op.poste) * d / 3600; }
export function laborTotal(ops, base = 'reel') { let s = 0, n = 0, ex = 0; for (const o of ops) { const v = laborOp(o, base); if (v == null) ex++; else { s += Number(v.toFixed(2)); n++; } } return { total: Number(s.toFixed(2)), n, ex }; } // meme arrondi que round(x, 2) du moteur Python
export function fit(person, required) {
  if (!required?.length) return 'sans_repere';
  const lv = required.map(s => person.competences[s]);
  if (lv.some(x => x === 1)) return 'a_renforcer';
  if (lv.some(x => x == null)) return 'competence_inconnue';
  return Math.min(...lv) === 3 ? 'fort' : 'intermediaire';
}
export const FIT_LABEL = { fort: 'Point fort sur ce poste', intermediaire: 'Bon niveau sur ce poste', a_renforcer: 'À renforcer sur ce poste', competence_inconnue: '', sans_repere: '' };
export function reviewCount() {
  const A = store.analysis; const pm = Object.fromEntries(A.postes.map(p => [p.poste, p]));
  let renf = 0, inc = 0; for (const p of A.persons) { const f = fit(p, pm[posteOf(p)]?.competences_repere); if (f === 'a_renforcer') renf++; if (f === 'competence_inconnue') inc++; }
  return { renf, inc, total: renf + inc };
}

// ---- Navigation
export const nav = { go: () => {} };
export function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 3500); }

// ---- Provenance
export function provenance(code) {
  const A = store.analysis; const M = A.meta.sources; let title = code, html = '';
  const fact = o => '<dl class="facts">' + Object.entries(o).filter(([, v]) => v != null && v !== '' && typeof v !== 'object').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>';
  let m;
  if ((m = code.match(/^MES!L(\d+)$/))) {
    const o = A.operations.find(x => x.src === code);
    html = `<p><b>${esc(M.mes.fichier)}</b> › onglet ${esc(M.mes.onglet)} › ligne ${m[1]}</p>` + (o ? fact({ Poste: o.poste, Nom: o.intitule_source, 'Nombre pièces': o.qty, 'Référence': o.refs_source ?? '(vide)', 'Temps Prévu': hms(o.prevu_s), Date: o.date, 'Heure Début': hms(o.debut_s), 'Heure Fin': hms(o.fin_s), 'Temps Réel': hms(o.reel_s), 'Aléas Industriels': o.alea, 'Cause Potentielle (hypothèse)': o.cause_potentielle }) : '');
  } else if ((m = code.match(/^PLM!([^!]+)(?:!L(\d+))?$/))) {
    const o = A.parts.find(x => x.src === code || x.src_autre_onglet === code);
    html = `<p><b>${esc(M.plm.fichier)}</b> › onglet ${esc(m[1])}${m[2] ? ' › ligne ' + m[2] : ''}</p>` + (o ? fact({ 'Code / Référence': o.ref, 'Désignation': o.designation, 'Quantité': o.qty_nomenclature, Fournisseur: o.fournisseur, 'Délai': o.delai_source, 'Criticité': o.criticite, 'Masse (kg)': o.masse_kg, 'Coût achat pièce (€)': o.prix_achat_eur, 'Temps CAO (h)': o.cao_h }) : '');
    const a = A.anomalies.find(x => x.src === code && x.type === 'ligne_parasite_plm'); if (a) html += `<p class="note">${esc(a.message)}</p>`;
  } else if ((m = code.match(/^ERP!(.+)$/))) {
    html = `<p><b>${esc(M.erp.fichier)}</b> › ${esc(m[1].replace('!', ' › '))}</p><p class="sub">Les noms et matricules restent dans le fichier source. Cette archive ne contient que les profils pseudonymisés.</p>`;
    const o = A.persons.find(x => x.src === code); if (o) html += fact({ Profil: o.pseudo, Identifiant: o.person_id, Qualification: o.qualification, Poste: o.poste_origine, Rotations: o.rotations_source });
  } else if ((m = code.match(/^NOTICE!p(\d+)(?:!(.+))?$/))) {
    const it = A.notice.nomenclature.find(x => x.citation === code);
    html = `<p><b>${esc(A.notice.document)}</b> › page ${m[1]}${it?.bbox_pt ? ' › zone ' + esc(it.bbox_pt.join(', ')) + ' pt' : ''}</p>` + (it ? fact({ 'Référence': it.ref ?? '(non imprimée)', 'Quantité': it.qty, 'Repère': it.repere_visuel, 'OCR brut': it.ocr_brut, Lecture: it.lecture }) : '') + (code === A.notice.contenu_p3.citation ? `<p>${esc(A.notice.contenu_p3.extrait_ocr)}</p><p class="sub">Offset ${A.notice.contenu_p3.offset_texte} dans le texte OCR.</p>` : '') + `<p><a class="link" target="_blank" rel="noopener" href="/assets/notice_meccano_dreamliner.pdf#page=${m[1]}">Ouvrir la notice page ${m[1]}</a></p>`;
  } else if (code.startsWith('CAO!')) {
    const o = A.meshes.find(x => x.src === code);
    html = `<p>Modèle CAO, occurrence <b>${esc(code.slice(4))}</b></p>` + (o ? fact({ Maillage: o.mesh_name, Assemblage: o.assembly_path, 'Référence liée': o.ref ?? 'aucune', Statut: o.status, 'Méthode': o.method }) : `<p class="sub">Géométrie issue du fichier STEP fourni.</p>`);
  } else if (code.startsWith('KPI!') || code.startsWith('GAP!')) {
    const k = A.kpis.find(x => x.citation === code);
    html = k ? fact(k) : '';
  } else if (code.startsWith('ANOM!')) {
    html = fact(A.anomalies.find(x => x.anomalie_id === code) || {});
  } else html = `<p class="sub">Élément calculé par le moteur à partir des tables de référence.</p>`;
  return `<h2>Provenance</h2><p class="sub"><code>${esc(title)}</code></p>${html}`;
}
export function openDrawer(html) { const d = document.getElementById('drawer'); document.getElementById('drawerBody').innerHTML = html; d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); }
export function closeDrawer() { const d = document.getElementById('drawer'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }

// ---- Infobulle
export function bindTips(root) {
  root.addEventListener('mousemove', e => {
    const t = e.target.closest?.('[data-tip]'); const tip = document.getElementById('tooltip');
    if (!t) { tip.classList.add('hidden'); return; }
    tip.innerHTML = t.getAttribute('data-tip'); tip.classList.remove('hidden');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 12) + 'px'; tip.style.top = Math.max(8, Math.min(innerHeight - h - 8, e.clientY + 12)) + 'px';
  });
  root.addEventListener('mouseleave', () => document.getElementById('tooltip').classList.add('hidden'));
}
export const tipAttr = html => `data-tip="${esc(html)}"`;
// Interpolation lineaire de couleur pour les rampes sequentielles
export function mix(a, b, t) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
