import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { displayName, dur, esc, eur, FIT_LABEL, fit, hms, laborOp, mix, money, nav, num, src, store, teamOf, tipAttr } from './core.js';

const des = s => String(s || '').replaceAll('_', ' ');

let tab = 'avion'; let cleanup = [];
export function disposeJumeau() { cleanup.forEach(f => f()); cleanup = []; }
const CAT_COLORS = { Temps: '#c8102e', 'Main-d\'œuvre (valorisation)': '#1f5fbf', Machine: '#c98a00', 'Méthode': '#6b3fa0', Milieu: '#0f8a78', Mesure: '#d8527c', 'Matière': '#8f5a1e', "Main-d'œuvre": '#5b8fd9', 'Non classé': '#777777' }; // palette 6M validee (toutes paires, CVD 6,3 : le libelle en legende et dans la fiche sert d'encodage secondaire)
const NEUTRAL = '#cfc9bf';

export function renderJumeau(root, route) {
  if (route.sub) tab = route.sub;
  const arg = route.arg || {};
  root.innerHTML = `<div class="subtabs">${[['avion', 'Avion 3D'], ['atelier', 'Atelier 3D & Ishikawa'], ['catalogue', 'Catalogue']].map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div><div id="jBody"></div>`;
  root.querySelector('.subtabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { tab = b.dataset.t; disposeJumeau(); renderJumeau(root, {}); } };
  const body = document.getElementById('jBody');
  ({ avion: renderAvion, atelier: renderAtelier, catalogue: renderCatalogue })[tab](body, arg);
}

function makeRenderer(host) {
  let r;
  try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); }
  catch (e) { host.innerHTML = `<div class="note red" style="margin:12px">WebGL n'est pas disponible dans ce navigateur. La 3D ne peut pas s'afficher ; les listes et fiches restent utilisables.</div>`; return null; }
  r.setPixelRatio(Math.min(devicePixelRatio, 2)); host.appendChild(r.domElement);
  const size = () => { const w = host.clientWidth, h = host.clientHeight; r.setSize(w, h, false); return [w, h]; };
  size();
  return { r, size };
}
function loop(state) {
  let raf; const tick = () => { raf = requestAnimationFrame(tick); state.controls.update(); state.renderer.render(state.scene, state.camera); }; tick();
  const ro = new ResizeObserver(() => { const [w, h] = state.size(); if (w && h) { state.camera.aspect = w / h; state.camera.updateProjectionMatrix(); } }); ro.observe(state.host);
  cleanup.push(() => { cancelAnimationFrame(raf); ro.disconnect(); state.controls.dispose(); state.renderer.dispose(); state.renderer.forceContextLoss?.(); });
}
function picker(state, objects, onPick) {
  const ray = new THREE.Raycaster(); const el = state.renderer.domElement; let down = null;
  el.addEventListener('pointerdown', e => down = [e.clientX, e.clientY]);
  el.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const b = el.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1), state.camera);
    const hit = ray.intersectObjects(objects(), false)[0]; onPick(hit ? hit.object : null);
  });
}

// ---- Avion 3D --------------------------------------------------------------------------------------------
const air = { layer: 'Temps', zone: '', sel: null, query: '' };
function signals() {
  const A = store.analysis; const ops = Object.fromEntries(A.operations.map(o => [o.op_id, o])); const sig = {};
  for (const r of A.op_refs) {
    const o = ops[r.op_id]; if (air.zone && o.zone !== air.zone) continue;
    const s = sig[r.ref] ||= { Temps: 0, 'Main-d\'œuvre (valorisation)': 0, cats: {} };
    s.Temps += o.ecart_reel_prevu_s || 0; s['Main-d\'œuvre (valorisation)'] += laborOp(o) || 0; s.cats[o.m6] = (s.cats[o.m6] || 0) + (o.ecart_reel_prevu_s || 0);
  }
  return sig;
}
function renderAvion(el, arg) {
  const A = store.analysis;
  if (arg.ref) { air.selRef = arg.ref; air.layer = air.layer || 'Temps'; }
  const cats = A.ishikawa.filter(c => c.n_signaux).map(c => c.categorie);
  const zones = A.zones.map(z => z.zone);
  el.innerHTML = `<div class="split3d"><div class="viewer" id="airHost">
     <div class="overlay"><label class="sub">Signal <select id="airLayer"><option value="Temps">Temps en plus</option><option value="Main-d'œuvre (valorisation)">Coût main-d'œuvre</option><option value="__dom">Type d'aléa principal</option>${cats.map(c => `<option value="${esc(c)}">Aléas : ${esc(c)}</option>`).join('')}</select></label>
      <label class="sub" style="display:block;margin-top:4px">Zone <select id="airZone"><option value="">Toutes</option>${zones.map(z => `<option>${esc(z)}</option>`).join('')}</select></label>
      <input id="airQ" type="search" aria-label="Chercher une référence" placeholder="Chercher une référence" style="width:100%;margin-top:6px"><div id="airLegend" style="margin-top:6px"></div></div>
     <div class="overlay right bottom sub" id="airLoad">Chargement de la géométrie…</div></div>
   <div class="card panel-scroll" id="airCard"><h2>Cliquez sur une pièce</h2><p class="sub">Tournez l'avion avec la souris, zoomez à la molette. Plus une pièce est colorée, plus les postes qui l'utilisent sont concernés par le signal choisi.</p></div></div>`;
  document.getElementById('airLayer').value = air.layer; document.getElementById('airZone').value = air.zone;
  const host = document.getElementById('airHost'); const R = makeRenderer(host); if (!R) return;
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, .001, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9ae9e, 2.1)); const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(1, 2, 1.5); scene.add(d); const d2 = new THREE.DirectionalLight(0xffffff, .6); d2.position.set(-2, -1, -1); scene.add(d2);
  const controls = new OrbitControls(camera, R.r.domElement); controls.enableDamping = true;
  const st = { renderer: R.r, size: R.size, scene, camera, controls, host }; loop(st);
  const meshes = new Map(); // node_index -> { obj, occ }
  const occs = Object.fromEntries(A.meshes.map(m => [m.node_index, m]));
  const paint = () => {
    const sig = signals(); const dom = air.layer === '__dom';
    const value = ref => { const s = sig[ref]; if (!s) return 0; if (air.layer === 'Temps' || air.layer === "Main-d'œuvre (valorisation)") return s[air.layer]; if (dom) return Object.values(s.cats).reduce((a, b) => Math.max(a, b), 0); return s.cats[air.layer] || 0; };
    const inModel = [...new Set(A.meshes.map(m => m.ref).filter(Boolean))]; const vals = inModel.map(value); const max = Math.max(...vals, 0); const pos = vals.filter(v => v > 0); const min = pos.length ? Math.min(...pos) : 0;
    const usedDom = new Set(); let neutralNo = 0, neutralSig = 0;
    for (const { obj, occ } of meshes.values()) {
      let color = NEUTRAL; const v = occ.ref ? value(occ.ref) : 0;
      if (!occ.ref) neutralNo++; else if (!v) neutralSig++;
      if (v > 0) { let cat = air.layer; if (dom) { cat = Object.entries(sig[occ.ref].cats).sort((a, b) => b[1] - a[1])[0][0]; usedDom.add(cat); } color = mix(mix(NEUTRAL, CAT_COLORS[cat] || '#777777', .12), CAT_COLORS[cat] || '#777777', max > min ? (v - min) / (max - min) : 1); }
      obj.material.color.set(color);
      const q = air.query.trim().toUpperCase(); const sel = air.sel; const same = sel && occ.ref && sel.ref === occ.ref;
      obj.material.emissive.set(sel && sel.occurrence_id === occ.occurrence_id ? 0x7a0a1c : same ? 0x3c060e : q && occ.ref === q ? 0x553300 : 0x000000);
    }
    const fmt = air.layer === "Main-d'œuvre (valorisation)" ? v => eur(v, 0) : v => dur(v);
    const lg = document.getElementById('airLegend'); if (!lg) return;
    const note = '';
    if (dom) lg.innerHTML = [...usedDom].map(c => `<div><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${CAT_COLORS[c]};margin-right:5px"></i>${esc(c)}</div>`).join('') + '<div class="sub">Intensité : écart de la catégorie dominante.</div>' + note;
    else if (!pos.length) lg.innerHTML = `<div class="sub">Aucune pièce concernée dans cette sélection.</div>`;
    else { const c = CAT_COLORS[air.layer] || '#777777'; lg.innerHTML = `<div class="gradient" style="background:linear-gradient(90deg,${mix(NEUTRAL, c, .12)},${c})"></div><div class="sub" style="display:flex;justify-content:space-between"><span>${fmt(min)}</span><span>${fmt(max)}</span></div><div class="sub">${air.layer === "Main-d'œuvre (valorisation)" ? 'Coût main-d\'œuvre des postes qui utilisent la pièce.' : 'Temps en plus des postes qui utilisent la pièce.'}</div>` + note; }
  };
  const showOcc = occ => { air.sel = occ; renderPartCard(document.getElementById('airCard'), occ); paint(); };
  const api = { paint, select: id => { const o = A.meshes.find(m => m.occurrence_id === id); if (o) showOcc(o); return !!o; }, ready: false };
  window.__airplus.viewer = api;
  new GLTFLoader().load('/assets/aircraft.glb', g => {
    g.scene.traverse(o => { if (o.isMesh) { const a = g.parser.associations.get(o); const occ = occs[a?.nodes]; o.material = new THREE.MeshStandardMaterial({ color: NEUTRAL, metalness: .05, roughness: .62, side: THREE.DoubleSide }); if (occ) { meshes.set(occ.node_index, { obj: o, occ }); o.userData.occ = occ; } } });
    scene.add(g.scene);
    orient(g.scene, A);
    const box = new THREE.Box3().setFromObject(g.scene); const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3()).length();
    controls.target.copy(c); camera.position.copy(c).add(new THREE.Vector3(.55, .42, .75).multiplyScalar(s * .95)); camera.near = s / 200; camera.far = s * 20; camera.updateProjectionMatrix();
    document.getElementById('airLoad').textContent = `${meshes.size} pièces 3D`;
    api.ready = true; api.meshCount = meshes.size; paint();
    if (air.selRef) { const o = A.meshes.find(m => m.ref === air.selRef); air.selRef = null; if (o) showOcc(o); } else if (air.sel) renderPartCard(document.getElementById('airCard'), air.sel);
  }, undefined, () => { document.getElementById('airLoad').textContent = 'Géométrie introuvable.'; });
  picker(st, () => [...meshes.values()].map(m => m.obj), o => { if (o?.userData.occ) showOcc(o.userData.occ); });
  document.getElementById('airLayer').onchange = e => { air.layer = e.target.value; paint(); };
  document.getElementById('airZone').onchange = e => { air.zone = e.target.value; paint(); };
  document.getElementById('airQ').oninput = e => { air.query = e.target.value; paint(); };
}
// La CAO place l'avion en biais. Repere d'affichage calcule depuis les boites du modele : nez, queue et ailes.
function orient(obj, A) {
  const centers = pred => { const L = A.meshes.filter(pred); if (!L.length) return null; const v = new THREE.Vector3(); L.forEach(m => { v.add(new THREE.Vector3(...m.bbox_min).add(new THREE.Vector3(...m.bbox_max)).multiplyScalar(.5)); }); return v.multiplyScalar(1 / L.length); };
  const nose = centers(m => m.ref === 'D120' || m.ref === 'D119'), tail = centers(m => m.ref === 'D278');
  const wl = centers(m => m.ref === 'D116' && !m.symetrie), wr = centers(m => m.ref === 'D116' && m.symetrie);
  if (!nose || !tail || !wl || !wr) return;
  const x = nose.clone().sub(tail).normalize(); const z = wr.clone().sub(wl); z.addScaledVector(x, -z.dot(x)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const mid = wl.clone().add(wr).multiplyScalar(.5); if (tail.clone().sub(mid).dot(y) < 0) { y.negate(); z.negate(); }
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).invert();
  obj.quaternion.premultiply(q); obj.updateMatrixWorld(true);
}
const STATUS_LABEL = { direct: '', symetrie: 'Pièce symétrique', parent: '', designation: 'Reliée par sa désignation', inferee: 'Lien déduit, à confirmer', aucune: 'Pièce sans référence au catalogue' };
function renderPartCard(el, occ) {
  const A = store.analysis; if (!el) return;
  const p = occ.ref ? A.parts.find(x => x.ref === occ.ref) : null;
  const sibling = occ.ref ? A.meshes.filter(m => m.ref === occ.ref) : [occ];
  const opsMap = Object.fromEntries(A.operations.map(o => [o.op_id, o]));
  const linked = p ? p.operations.map(r => ({ ...r, o: opsMap[r.op_id] })) : [];
  const nameFallback = (occ.mesh_name || occ.node_name).replace(/^(Symétrie de )+/, '').replace(/\.\d+$/, '');
  const total = linked.reduce((s, r) => s + r.o.ecart_reel_prevu_s, 0);
  el.innerHTML = `<h2>${p ? esc(des(p.designation)) : esc(nameFallback)}</h2>
   <p class="sub">${p ? `Référence ${esc(p.ref)} · ` : ''}${sibling.length > 1 ? `${sibling.length} pièces identiques sur l'avion` : ''} ${occ.geometrie_modifiee ? '· géométrie adaptée' : ''}</p>
   ${STATUS_LABEL[occ.status] ? `<p><span class="tag ${occ.status === 'inferee' ? 'a_renforcer' : ''}" title="${esc(occ.method)}">${esc(STATUS_LABEL[occ.status])}</span></p>` : ''}
   ${p ? `<div class="kpis" style="grid-template-columns:repeat(2,1fr);margin:10px 0"><div class="kpi"><div class="l">Prix d'achat</div><div class="v" style="font-size:20px">${money(p.prix_achat_eur)}</div></div><div class="kpi"><div class="l">Délai</div><div class="v" style="font-size:20px">${esc(p.delai_source)}</div></div></div>
     <dl class="facts"><dt>Fournisseur</dt><dd>${esc(p.fournisseur)}</dd><dt>Criticité</dt><dd>${esc(p.criticite)}</dd><dt>Masse</dt><dd>${num(p.masse_kg, 2)} kg</dd><dt>Nomenclature</dt><dd>${p.qty_nomenclature} pièce${p.qty_nomenclature > 1 ? 's' : ''}</dd><dt>Citée au MES</dt><dd>${p.occ_mes} fois</dd></dl>
     <p><button class="link" data-go-cat="${esc(p.ref)}">Voir la fiche complète</button> ${src(p.src)}</p>
     ${linked.length ? `<h3 class="mt">Où elle est montée</h3><p class="sub">${linked.length} poste${linked.length > 1 ? 's' : ''}, ${dur(total)} de plus que prévu au total.</p>
     <table><tbody>${linked.map(r => `<tr class="click" data-open="${r.poste}" ${tipAttr('Cause possible : ' + esc(r.o.cause_potentielle))}><td><b>P${r.poste}</b> ${esc(r.o.intitule)}<br><span class="sub">${esc(r.o.alea)}</span></td><td class="num">${dur(r.o.reel_s)}<br><span class="sub">${dur(r.o.ecart_reel_prevu_s, true)}</span></td></tr>`).join('')}</tbody></table>
       <button class="btn primary mt" id="askAI">Demander à l'IA des pistes d'amélioration</button>` : ''}` : `<p class="sub">${esc(occ.assembly_path || '')}</p>`}`;
  el.querySelectorAll('[data-open]').forEach(t => t.onclick = e => { if (!e.target.closest('[data-src]')) nav.go('jumeau', 'atelier', { poste: +t.dataset.open }); });
  const c = el.querySelector('[data-go-cat]'); if (c) c.onclick = () => nav.go('jumeau', 'catalogue', { ref: c.dataset.goCat });
  const ai = el.querySelector('#askAI');
  if (ai) ai.onclick = () => nav.go('decision', null, { question: `Quelles pistes d'amélioration vérifier pour la référence ${p.ref} (${des(p.designation)}) ${linked.length > 1 ? 'aux postes' : 'au poste'} ${linked.map(l => l.poste).join(', ')} ?`, auto: true });
}

// ---- Atelier 3D et Ishikawa --------------------------------------------------------------------------------
const shop = { poste: null, cat: null };
function renderAtelier(el, arg) {
  const A = store.analysis; if (arg.poste != null) { shop.poste = arg.poste; } if (arg.cat) shop.cat = arg.cat;
  el.innerHTML = `<div class="grid g-2-1"><div class="viewer" id="shopHost" style="height:46vh;min-height:340px"><div class="overlay right bottom" style="max-width:330px"><b>Plan schématique</b><br><span class="sub">Postes rangés par zone, dans l'ordre du relevé. Hauteur : durée. Couleur : temps en plus.</span></div></div>
    <div class="card" id="posteCard" style="height:46vh;min-height:340px;overflow:auto"></div></div>
   <div class="grid g-1-2 mt"><div class="card"><h2>Postes</h2><input id="pQ" type="search" placeholder="Filtrer les postes" style="width:100%;margin:6px 0"><div class="scroll" id="pList" style="max-height:470px"></div></div>
    <div class="card"><h2>Ishikawa 6M</h2><p class="sub">Les aléas déclarés, rangés en six familles par mots-clés. Cliquez sur une famille pour voir le détail, sur un aléa pour ouvrir le poste.</p><div id="fish"></div><div id="fishDetail" class="mt"></div></div></div>`;
  const list = () => { const q = (document.getElementById('pQ').value || '').toLowerCase(); document.getElementById('pList').innerHTML = A.postes.filter(p => !q || `${p.poste} ${p.intitule} ${p.zone}`.toLowerCase().includes(q)).map(p => { const o = opOf(p.poste); const n = teamOf(p.poste).length; return `<div class="poste-row ${shop.poste === p.poste ? 'sel' : ''}" data-p="${p.poste}"><b>P${p.poste}</b><div>${esc(p.intitule)}<br><span class="sub">${esc(p.zone)} · ${n} personne${n > 1 ? 's' : ''}</span></div><span class="sub">${dur(o.ecart_reel_prevu_s, true)}</span></div>`; }).join('') || '<p class="sub">Aucun poste.</p>'; };
  const opOf = p => A.operations.find(o => o.poste === p);
  let view3d = null;
  const select = (p, scroll = true) => { shop.poste = p; list(); posteCard(); drawFish(); view3d?.highlight(p); if (scroll) { const row = document.querySelector(`.poste-row[data-p="${p}"]`), box = document.getElementById('pList'); if (row && box) box.scrollTop = row.offsetTop - box.offsetTop - box.clientHeight / 2; } };
  const posteCard = () => {
    const c = document.getElementById('posteCard'); if (!shop.poste) { c.innerHTML = '<h2>Choisissez un poste</h2><p class="sub">Sur le plan, dans la liste ou sur le diagramme : tout reste synchronisé.</p>'; return; }
    const o = opOf(shop.poste); const pm = A.postes.find(p => p.poste === shop.poste);
    if (!o) { c.innerHTML = `<h2>Poste ${shop.poste}</h2><p class="note red">Ce poste n'existe pas dans le relevé MES.</p>`; return; }
    const team = teamOf(shop.poste); const refs = A.op_refs.filter(r => r.op_id === o.op_id); const mo = laborOp(o);
    c.innerHTML = `<h2>Poste ${o.poste} · ${esc(o.intitule)}</h2><p class="sub">${esc(o.zone)} · ${esc(o.jour_semaine)} ${esc(o.date.split('-').reverse().join('/'))}, ${hms(o.debut_s).slice(0, 5)} → ${hms(o.fin_s).slice(0, 5)} ${src(o.src)}</p>
     <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin:8px 0"><div class="kpi"><div class="l">Prévu</div><div class="v" style="font-size:19px">${dur(o.prevu_s)}</div></div><div class="kpi accent"><div class="l">Réel</div><div class="v" style="font-size:19px">${dur(o.reel_s)}</div></div><div class="kpi"><div class="l">En plus</div><div class="v" style="font-size:19px">${dur(o.ecart_reel_prevu_s)}</div></div></div>
     ${o.controle_horloge !== 'concordant' ? `<p class="sub">Heure de fin relevée à ${hms(o.fin_s).slice(0, 5)} : c'est la durée déclarée qui compte ici.</p>` : ''}
     <dl class="facts"><dt>Aléa déclaré</dt><dd>${esc(o.alea)} <span class="tag">${esc(o.m6)}</span></dd><dt>Cause possible</dt><dd>${esc(o.cause_potentielle)}</dd>
     ${refs.length ? `<dt>Pièces</dt><dd>${refs.map(r => `<button class="link" data-ref="${esc(r.ref)}">${esc(r.ref)}</button> ×${r.occurrences}`).join(', ')}</dd>` : ''}
     ${mo != null ? `<dt>Main-d'œuvre</dt><dd>${eur(mo)}</dd>` : ''}</dl>
     <h3 class="mt">L'équipe (${team.length})</h3>${team.length ? team.map(p => { const f = fit(p, pm?.competences_repere); return `<div style="margin:3px 0">${esc(displayName(p))} ${FIT_LABEL[f] ? `<span class="tag ${f}">${FIT_LABEL[f]}</span>` : ''}${store.overrides[p.person_id] ? '<span class="tag session">modifié</span>' : ''} <span class="sub">${esc(p.qualification)}</span></div>`; }).join('') : '<p class="sub">Personne sur ce poste pour le moment.</p>'}
     <p class="mt"><button class="link" id="toTeam">Voir dans Équipe</button></p>`;
    document.getElementById('toTeam').onclick = () => nav.go('equipe', null, { poste: shop.poste });
  };
  const drawFish = () => { document.getElementById('fish').innerHTML = fishbone(A.ishikawa, shop.poste, shop.cat); fishDetail(); };
  const fishDetail = () => { const d = document.getElementById('fishDetail'); const c = A.ishikawa.find(x => x.categorie === shop.cat); if (!c) { d.innerHTML = ''; return; } d.innerHTML = `<h3>${esc(c.categorie)} : ${c.n_signaux} aléas, ${dur(c.ecart_s)} de plus que prévu</h3><div class="scroll"><table><thead><tr><th>Poste</th><th>Aléa déclaré</th><th>Mot-clé</th><th>Cause possible</th><th class="num">En plus</th><th>Source</th></tr></thead><tbody>${c.signaux.map(s => `<tr class="click ${s.poste === shop.poste ? 'sel' : ''}" data-p="${s.poste}"><td>${s.poste}</td><td>${esc(s.alea)}</td><td>${esc(s.mot_cle)}</td><td class="sub">${esc(s.cause_potentielle)}</td><td class="num">${dur(s.ecart_s)}</td><td>${src(s.src)}</td></tr>`).join('')}</tbody></table></div>`; };
  el.addEventListener('click', e => {
    if (e.target.closest('[data-src],[data-ref]')) return;
    const b = e.target.closest('[data-cat]'); if (b) { shop.cat = b.dataset.cat; drawFish(); return; }
    const p = e.target.closest('[data-p]'); if (p) select(+p.dataset.p);
  });
  document.getElementById('pQ').oninput = list;
  list(); posteCard(); drawFish();
  view3d = buildShop(document.getElementById('shopHost'), A, p => select(p));
  window.__airplus.shop = { select, get poste() { return shop.poste; } };
  if (shop.poste) select(shop.poste);
}
function fishbone(data, poste, activeCat) {
  const W = 1000, H = 400, mid = H / 2; const cats = data.filter(c => c.categorie !== 'Non classé' || c.n_signaux);
  const top = cats.filter((_, i) => i % 2 === 0), bottom = cats.filter((_, i) => i % 2 === 1);
  const X = n => Array.from({ length: n }, (_, i) => 100 + (i + .85) * (690 / Math.max(n, 1)));
  const bone = (c, x, up) => {
    const dir = up ? -1 : 1; const x0 = x - 95, y0 = mid + dir * 178; const signals = [...c.signaux].sort((a, b) => b.ecart_s - a.ecart_s);
    const has = signals.findIndex(s => s.poste === poste); let shown = signals.slice(0, 6); if (has >= 6) shown = [...signals.slice(0, 5), signals[has]];
    const twig = shown.map((s, i) => { const t = (i + 1) / (shown.length + 1); const px = x0 + (x - x0) * t, py = y0 + (mid - y0) * t; const on = s.poste === poste; return `<g style="cursor:pointer" data-p="${s.poste}" ${tipAttr(`<b>Poste ${s.poste}</b> ${esc(s.alea)}<br>Mot-clé : ${esc(s.mot_cle)}<br><i>Cause possible : ${esc(s.cause_potentielle)}</i><br>${dur(s.ecart_s, true)}`)}><line x1="${px}" x2="${px - 13}" y1="${py}" y2="${py}" stroke="${on ? 'var(--red)' : 'var(--line2)'}" stroke-width="${on ? 2 : 1}"/><text x="${px - 16}" y="${py + 3.5}" text-anchor="end" font-size="10.5" fill="${on ? 'var(--red)' : 'var(--ink2)'}" font-weight="${on ? 700 : 400}">P${s.poste} ${esc(s.alea.length > 22 ? s.alea.slice(0, 21) + '…' : s.alea)}</text></g>`; }).join('');
    return `<g class="bone" data-cat="${esc(c.categorie)}"><line x1="${x0}" y1="${y0}" x2="${x}" y2="${mid}" stroke="${activeCat === c.categorie ? 'var(--red)' : 'var(--ink3)'}" stroke-width="2"/><text class="bone-label" x="${x0}" y="${up ? y0 - 6 : y0 + 15}" text-anchor="middle" font-weight="650" font-size="12.5" fill="${activeCat === c.categorie ? 'var(--red)' : 'var(--ink)'}">${esc(c.categorie)} · ${c.n_signaux}${c.n_signaux > shown.length ? ` (+${c.n_signaux - shown.length})` : ''}</text></g>${twig}`;
  };
  return `<svg class="chart fishbone" viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagramme d'Ishikawa"><line x1="40" x2="${W - 150}" y1="${mid}" y2="${mid}" stroke="var(--ink2)" stroke-width="3"/><path d="M${W - 150} ${mid - 7} L${W - 136} ${mid} L${W - 150} ${mid + 7} Z" fill="var(--ink2)"/><rect x="${W - 134}" y="${mid - 30}" width="130" height="60" rx="8" fill="var(--red)"/><text x="${W - 69}" y="${mid - 6}" text-anchor="middle" style="fill:#fff" font-size="12" font-weight="600">Temps en plus</text><text x="${W - 69}" y="${mid + 14}" text-anchor="middle" style="fill:#fff" font-size="14" font-weight="650">${dur(data.reduce((s, c) => s + c.ecart_s, 0))}</text>
   ${X(top.length).map((x, i) => bone(top[i], x, true)).join('')}${X(bottom.length).map((x, i) => bone(bottom[i], x, false)).join('')}</svg>`;
}
function label(text, size = 42, color = '#231f1c', bg = null) {
  const c = document.createElement('canvas'); const g = c.getContext('2d'); g.font = `600 ${size}px "Segoe UI",Arial`; const w = g.measureText(text).width + 18; c.width = Math.ceil(w); c.height = size + 16;
  g.font = `600 ${size}px "Segoe UI",Arial`; if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); } g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 9, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(c.width / c.height * .55, .55, 1); return s;
}
function buildShop(host, A, onPick) {
  const R = makeRenderer(host); if (!R) return null;
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(36, host.clientWidth / host.clientHeight, .1, 300);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcabfae, 2.3)); const d = new THREE.DirectionalLight(0xffffff, 1.4); d.position.set(10, 30, 12); scene.add(d);
  const controls = new OrbitControls(camera, R.r.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2.3;
  const st = { renderer: R.r, size: R.size, scene, camera, controls, host }; loop(st);
  const rowsByZone = A.zones; const ops = Object.fromEntries(A.operations.map(o => [o.poste, o]));
  const rmax = Math.max(...A.operations.map(o => o.ecart_reel_prevu_s)), rmin = Math.min(...A.operations.map(o => o.ecart_reel_prevu_s)); const hmax = Math.max(...A.operations.map(o => o.reel_s));
  const boxes = new Map(); const pts = {}; const stepX = 1.6, stepZ = 2.5; const maxCols = Math.max(...rowsByZone.map(z => z.postes.length));
  // Deux colonnes de zones, lues de haut en bas : le plan occupe mieux une vue large. Disposition schematique.
  const perCol = Math.ceil(rowsByZone.length / 2); const plateW = maxCols * stepX + .7; const labelW = 4.6; const colW = plateW + labelW + .8;
  rowsByZone.forEach((z, idx) => {
    const col = idx < perCol ? 0 : 1; const r = idx < perCol ? idx : idx - perCol; const ox = (col - .5) * colW + labelW / 2; const zz = (r - (perCol - 1) / 2) * stepZ;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(plateW, .05, stepZ - .4), new THREE.MeshStandardMaterial({ color: idx % 2 ? 0xefe8dc : 0xf6f1e8 })); plate.position.set(ox, -.03, zz); scene.add(plate);
    const lab = label(z.zone, 46, '#5e564e'); const sc = 1.45; lab.scale.multiplyScalar(sc); lab.position.set(ox - plateW / 2 - lab.scale.x / 2 - .1, .2, zz); scene.add(lab);
    z.postes.forEach((p, i) => {
      const o = ops[p]; const h = .25 + o.reel_s / hmax * 2.4; const x = ox + (i - (maxCols - 1) / 2) * stepX;
      const c = mix('#ecc8c2', '#8e0c20', (o.ecart_reel_prevu_s - rmin) / Math.max(1, rmax - rmin));
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.15, h, 1.15), new THREE.MeshStandardMaterial({ color: c, roughness: .6 })); m.position.set(x, h / 2, zz); m.userData.poste = p; scene.add(m); boxes.set(p, m); pts[p] = new THREE.Vector3(x, .08, zz);
      const l = label(String(p), 46, '#231f1c', 'rgba(255,253,249,.92)'); l.scale.multiplyScalar(1.05); l.position.set(x, h + .1, zz + .78); scene.add(l);
    });
  });
  const seq = A.operations.slice().sort((a, b) => a.debut.localeCompare(b.debut)).map(o => pts[o.poste]).filter(Boolean);
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(seq), new THREE.LineBasicMaterial({ color: 0x857b70 })));
  const fit = () => { const asp = host.clientWidth / Math.max(1, host.clientHeight); const t = Math.tan(THREE.MathUtils.degToRad(18)); const d = Math.max((perCol * stepZ + 2) / (2 * t), (2 * colW + 1) / (2 * t * asp)) * .9; camera.position.set(0, d, d * .12); controls.target.set(0, 0, 0); camera.lookAt(0, 0, 0); camera.far = d * 6; camera.updateProjectionMatrix(); };
  fit();
  picker(st, () => [...boxes.values()], o => { if (o?.userData.poste) onPick(o.userData.poste); });
  return { highlight: p => { for (const [k, m] of boxes) m.material.emissive.set(k === p ? 0x6a0a18 : 0x000000); }, camera };
}

// ---- Catalogue PLM -----------------------------------------------------------------------------------------
const cat = { q: '', sup: '', crit: '', ref: null };
function renderCatalogue(el, arg) {
  const A = store.analysis; if (arg.ref) cat.ref = arg.ref;
  const sups = [...new Set(A.parts.map(p => p.fournisseur))].sort(); const crits = [...new Set(A.parts.map(p => p.criticite))];
  el.innerHTML = `<div class="grid g-1-2"><div class="card"><h2>${A.parts.length} références</h2><div class="filters" style="position:static;padding:6px 0"><input id="cQ" type="search" aria-label="Chercher une pièce" placeholder="Chercher une pièce" value="${esc(cat.q)}"><select id="cS"><option value="">Fournisseurs</option>${sups.map(s => `<option ${s === cat.sup ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select><select id="cC"><option value="">Criticités</option>${crits.map(s => `<option ${s === cat.crit ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div><div class="scroll tall" id="cList"></div></div><div class="card" id="cCard"></div></div>`;
  const list = () => { const q = cat.q.toLowerCase(); document.getElementById('cList').innerHTML = `<table><thead><tr><th>Réf.</th><th>Désignation</th><th>Fournisseur</th><th class="num">Qté</th></tr></thead><tbody>${A.parts.filter(p => (!q || `${p.ref} ${p.designation}`.toLowerCase().includes(q)) && (!cat.sup || p.fournisseur === cat.sup) && (!cat.crit || p.criticite === cat.crit)).map(p => `<tr class="click ${cat.ref === p.ref ? 'sel' : ''}" data-c="${esc(p.ref)}"><td>${esc(p.ref)}</td><td>${esc(des(p.designation))}</td><td>${esc(p.fournisseur)}</td><td class="num">${p.qty_nomenclature}</td></tr>`).join('')}</tbody></table>`; };
  const card = () => {
    const c = document.getElementById('cCard'); const p = A.parts.find(x => x.ref === cat.ref);
    if (!p) { c.innerHTML = '<h2>Choisissez une référence</h2><p class="sub">Prix, délai, fournisseur et postes où la pièce est montée.</p>'; return; }
    const ops = p.operations; const m = A.meshes.filter(x => x.ref === p.ref); const opsMap = Object.fromEntries(A.operations.map(o => [o.op_id, o]));
    const qty = [['Nomenclature', p.qty_nomenclature], ['Notice', p.qty_notice], ['Citée au MES', p.occ_mes], ['Modèle 3D', m.length]].filter(x => x[1]); const qm = Math.max(...qty.map(x => x[1]), 1);
    c.innerHTML = `<h2>${esc(des(p.designation))}</h2><p class="sub">Référence ${esc(p.ref)} · ${esc(p.fournisseur)} ${p.est_outillage ? '· outillage' : ''} ${src(p.src)} ${p.src_notice ? src(p.src_notice) : ''}</p>
    <div class="kpis" style="margin:10px 0"><div class="kpi"><div class="l">Prix d'achat</div><div class="v" style="font-size:21px">${money(p.prix_achat_eur)}</div></div><div class="kpi"><div class="l">Valeur totale</div><div class="v" style="font-size:21px">${money(p.valeur_nomenclature_eur)}</div></div><div class="kpi"><div class="l">Délai</div><div class="v" style="font-size:21px">${esc(p.delai_source)}</div></div><div class="kpi"><div class="l">Masse</div><div class="v" style="font-size:21px">${num(p.masse_kg, 2)} kg</div></div></div>
    <div class="grid g2"><div><h3>Combien</h3><div style="margin-top:6px">${qty.map(([l, v]) => `<div class="bar-row" style="grid-template-columns:110px 1fr 40px"><span>${l}</span><div class="bar-track"><div class="bar-fill" style="width:${v / qm * 100}%"></div></div><span class="val">${v}</span></div>`).join('')}</div></div>
    <div><h3>Fiche</h3><dl class="facts"><dt>Criticité</dt><dd>${esc(p.criticite)}</dd><dt>Temps CAO</dt><dd>${num(p.cao_h)} h</dd>${p.cao_3dxml?.length ? `<dt>Version CAO</dt><dd>${esc(p.cao_3dxml[0].version)}</dd>` : ''}</dl></div></div>
    ${ops.length ? `<h3 class="mt">Où elle est montée (${ops.length} poste${ops.length > 1 ? 's' : ''})</h3><table><tbody>${ops.map(r => `<tr class="click" data-open="${r.poste}"><td><b>P${r.poste}</b> ${esc(opsMap[r.op_id].intitule)}</td><td class="num">× ${r.occurrences}</td><td>${src(r.src)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${m.length ? `<button class="btn mt" id="to3d">Voir sur l'avion 3D</button>` : ''}`;
    c.querySelectorAll('[data-open]').forEach(t => t.onclick = e => { if (!e.target.closest('[data-src]')) nav.go('jumeau', 'atelier', { poste: +t.dataset.open }); });
    const b = c.querySelector('#to3d'); if (b) b.onclick = () => nav.go('jumeau', 'avion', { ref: p.ref });
  };
  list(); card();
  document.getElementById('cQ').oninput = e => { cat.q = e.target.value; list(); };
  document.getElementById('cS').onchange = e => { cat.sup = e.target.value; list(); };
  document.getElementById('cC').onchange = e => { cat.crit = e.target.value; list(); };
  document.getElementById('cList').onclick = e => { const t = e.target.closest('[data-c]'); if (t) { cat.ref = t.dataset.c; list(); card(); } };
}
