// Avion : modele 3D, atelier schematique, Ishikawa et catalogue, chacun avec sa bande de valeurs et sa table.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { dur, esc, eur, hms, laborOp, mix, money, onChange, store, tipAttr } from './core.js';
import { des, openEntity } from './sheets.js';
import { barCell, dataTable, kband } from './table.js';

const MODES = [['avion', 'Avion'], ['atelier', 'Atelier'], ['ishikawa', 'Ishikawa'], ['catalogue', 'Catalogue']];
const CAT = { Temps: '#d90016', MO: '#1f5fbf', Machine: '#c98a00', 'Méthode': '#6b3fa0', Milieu: '#0f8a78', Mesure: '#d8527c', 'Matière': '#8f5a1e', "Main-d'œuvre": '#5b8fd9', 'Non classé': '#777777' };
const NEUTRAL = '#e7e1d6';
const V = { mode: 'avion', layer: 'Temps', zone: '', q: '', cat: null, focusRef: null, focusPoste: null };
const CRITS = ['Critique', 'Haute', 'Moyenne', 'Basse'];
let cleanup = [], unsub = null, tbl = null;
const crit = c => `<i class="crit ${esc(c)}"></i>${esc(c)}`;
export function disposeAvion() { cleanup.forEach(f => f()); cleanup = []; if (unsub) { unsub(); unsub = null; } }

export function renderAvion(root, route) {
  disposeAvion();
  if (['avion', 'atelier', 'ishikawa', 'catalogue'].includes(route.sub)) V.mode = route.sub;
  if (route.arg?.ref) V.focusRef = route.arg.ref;
  if (route.arg?.poste) V.focusPoste = route.arg.poste;
  route.arg = null;
  root.innerHTML = `<div id="avBand"></div><div id="avBody"></div>`;
  draw(root);
}
function modesHtml() { return `<div class="tools"><div class="modes" id="avModes">${MODES.map(([k, l]) => `<button class="${V.mode === k ? 'on' : ''}" data-av="${k}">${l}</button>`).join('')}</div></div>`; }
function draw() {
  disposeAvion();
  const f = document.getElementById('avBody'); if (!f) return;
  ({ avion: drawAvion, atelier: drawAtelier, ishikawa: drawFish, catalogue: drawCatalogue })[V.mode](f);
  f.querySelector('#avModes')?.addEventListener('click', e => { const b = e.target.closest('[data-av]'); if (b) { V.mode = b.dataset.av; draw(); } });
}
function makeRenderer(host) {
  let r; try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { host.innerHTML = '<p style="padding:40px">WebGL indisponible dans ce navigateur.</p>'; return null; }
  r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(host.clientWidth, host.clientHeight, false); host.appendChild(r.domElement);
  return r;
}
function loop(st) {
  let raf; const tick = () => { raf = requestAnimationFrame(tick); st.controls.update(); st.renderer.render(st.scene, st.camera); }; tick();
  const ro = new ResizeObserver(() => { const w = st.host.clientWidth, h = st.host.clientHeight; if (w && h) { st.renderer.setSize(w, h, false); st.camera.aspect = w / h; st.camera.updateProjectionMatrix(); st.onResize?.(); } }); ro.observe(st.host);
  cleanup.push(() => { cancelAnimationFrame(raf); ro.disconnect(); st.controls.dispose(); st.renderer.dispose(); st.renderer.forceContextLoss?.(); });
}
function picker(st, objects, onPick, onHover) {
  const ray = new THREE.Raycaster(); const el = st.renderer.domElement; let down = null;
  const pick = e => { const b = el.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1), st.camera); return ray.intersectObjects(objects(), false)[0]?.object || null; };
  el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; st.controls.autoRotate = false; });
  el.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) <= 5) { const o = pick(e); if (o) onPick(o); } });
  let pending = false; el.addEventListener('pointermove', e => { if (pending || e.buttons) return; pending = true; requestAnimationFrame(() => { pending = false; const o = pick(e); el.style.cursor = o ? 'pointer' : 'grab'; onHover?.(o); }); });
}
function orient(obj, A) {
  const centers = pred => { const L = A.meshes.filter(pred); if (!L.length) return null; const v = new THREE.Vector3(); L.forEach(m => { v.add(new THREE.Vector3(...m.bbox_min).add(new THREE.Vector3(...m.bbox_max)).multiplyScalar(.5)); }); return v.multiplyScalar(1 / L.length); };
  const nose = centers(m => m.ref === 'D120' || m.ref === 'D119'), tail = centers(m => m.ref === 'D278'); const wl = centers(m => m.ref === 'D116' && !m.symetrie), wr = centers(m => m.ref === 'D116' && m.symetrie);
  if (!nose || !tail || !wl || !wr) return;
  const x = nose.clone().sub(tail).normalize(); const z = wr.clone().sub(wl); z.addScaledVector(x, -z.dot(x)).normalize(); const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const mid = wl.clone().add(wr).multiplyScalar(.5); if (tail.clone().sub(mid).dot(y) < 0) { y.negate(); z.negate(); }
  obj.quaternion.premultiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).invert()); obj.updateMatrixWorld(true);
}
function signals() {
  const A = store.analysis; const ops = Object.fromEntries(A.operations.map(o => [o.op_id, o])); const sig = {};
  for (const r of A.op_refs) { const o = ops[r.op_id]; if (V.zone && o.zone !== V.zone) continue; const s = sig[r.ref] ||= { Temps: 0, MO: 0, cats: {} }; s.Temps += o.ecart_reel_prevu_s || 0; s.MO += laborOp(o) || 0; s.cats[o.m6] = (s.cats[o.m6] || 0) + (o.ecart_reel_prevu_s || 0); }
  return sig;
}
function drawAvion(f) {
  const A = store.analysis; const cats = A.ishikawa.filter(c => c.n_signaux).map(c => c.categorie);
  const refs3d = new Set(A.meshes.map(m => m.ref).filter(Boolean)); const st0 = {}; A.meshes.forEach(m => st0[m.status] = (st0[m.status] || 0) + 1);
  document.getElementById('avBand').innerHTML = kband([{ l: 'Occurrences 3D', v: String(A.meshes.length), n: 'dans le modèle' }, { l: 'Reliées au PLM', v: `${A.meshes.filter(m => m.ref).length}/${A.meshes.length}`, n: `${st0.direct || 0} directes, ${st0.symetrie || 0} symétriques`, sig: false }, { l: 'Références modélisées', v: `${refs3d.size}/${A.parts.length}`, n: 'la visserie n\'est pas modélisée' }, { l: 'Sans référence', v: String(st0.aucune || 0), n: 'joints de train' }, { l: 'Liens à confirmer', v: String(st0.inferee || 0), n: 'déduits par symétrie' }, { l: 'Version CAO', v: 'A', n: 'IN_WORK, tous les modèles 3DXML' }]);
  f.innerHTML = `<div class="work"><section class="panel">${modesHtml()}<div class="viewer"><div class="host" id="airHost"></div><div class="vui"><select class="minifield" id="airLayer" aria-label="Signal"><option value="Temps">Écart de temps</option><option value="MO">Main-d'œuvre</option><option value="__dom">Famille d'aléa dominante</option>${cats.map(c => `<option value="${esc(c)}">Aléas : ${esc(c)}</option>`).join('')}</select><select class="minifield" id="airZone" aria-label="Zone"><option value="">Toutes les zones</option>${A.zones.map(z => `<option>${esc(z.zone)}</option>`).join('')}</select><div id="airLegend" class="sub"></div></div><div class="hover-name" id="airName"></div></div></section><section class="panel"><div class="tablewrap" id="airTable"></div></section></div>`;
  document.getElementById('airLayer').value = V.layer; document.getElementById('airZone').value = V.zone;
  const host = document.getElementById('airHost'); const R = makeRenderer(host); if (!R) return;
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(30, host.clientWidth / host.clientHeight, .001, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8ba, 2.4)); const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(1, 2, 1.5); scene.add(d);
  const controls = new OrbitControls(camera, R.domElement); controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = .5;
  const st = { renderer: R, scene, camera, controls, host }; loop(st);
  const meshes = new Map(); const occs = Object.fromEntries(A.meshes.map(m => [m.node_index, m])); let hoverRef = null;
  const value = (sig, ref) => { const s = sig[ref]; if (!s) return 0; if (V.layer === 'Temps' || V.layer === 'MO') return s[V.layer]; if (V.layer === '__dom') return Object.values(s.cats).reduce((a, b) => Math.max(a, b), 0); return s.cats[V.layer] || 0; };
  const fmt = v => V.layer === 'MO' ? eur(v, 0) : dur(v);
  const paint = () => {
    const sig = signals(); const dom = V.layer === '__dom';
    const inModel = [...refs3d]; const vals = inModel.map(r => value(sig, r)); const max = Math.max(...vals, 0); const pos = vals.filter(v => v > 0); const min = pos.length ? Math.min(...pos) : 0; const used = new Set();
    const selRef = store.sel?.type === 'occ' ? A.meshes.find(m => m.occurrence_id === store.sel.id)?.ref : store.sel?.type === 'ref' ? store.sel.id : null; const selOcc = store.sel?.type === 'occ' ? store.sel.id : null;
    for (const { obj, occ } of meshes.values()) {
      let color = NEUTRAL; const v = occ.ref ? value(sig, occ.ref) : 0;
      if (v > 0) { let cat = V.layer; if (dom) { cat = Object.entries(sig[occ.ref].cats).sort((a, b) => b[1] - a[1])[0][0]; used.add(cat); } const base = CAT[cat] || '#777777'; color = mix(mix(NEUTRAL, base, .1), base, max > min ? (v - min) / (max - min) : 1); }
      obj.material.color.set(color); obj.material.emissive.set(occ.ref && occ.ref === hoverRef ? 0x884400 : occ.occurrence_id === selOcc ? 0x660010 : (selRef && occ.ref === selRef) ? 0x33000a : 0);
    }
    const lg = document.getElementById('airLegend'); if (!lg) return;
    if (dom) lg.innerHTML = [...used].map(c => `<div><span class="dot" style="background:${CAT[c]}"></span>${esc(c)}</div>`).join('');
    else if (!pos.length) lg.textContent = 'Aucune pièce.';
    else { const c = CAT[V.layer] || '#777777'; lg.innerHTML = `<div class="legend-bar" style="background:linear-gradient(90deg,${mix(NEUTRAL, c, .1)},${c})"></div><div style="display:flex;justify-content:space-between"><span>${fmt(min)}</span><span>${fmt(max)}</span></div>`; }
  };
  const rows = () => { const sig = signals(); return A.parts.filter(p => refs3d.has(p.ref)).map(p => ({ p, v: value(sig, p.ref), occ: A.meshes.filter(m => m.ref === p.ref).length })); };
  tbl = dataTable(document.getElementById('airTable'), { rows, key: r => r.p.ref, sort: 4, desc: true, search: 'Filtrer : référence, désignation, fournisseur', attr: r => `data-open="ref:${esc(r.p.ref)}"`, selected: () => store.sel?.type === 'ref' ? store.sel.id : null, onHover: k => { hoverRef = k; controls.autoRotate = !k && controls.autoRotate; paint(); },
    cols: [{ t: 'Réf.', v: r => r.p.ref }, { t: 'Désignation', v: r => des(r.p.designation), c: true }, { t: 'Fournisseur', v: r => r.p.fournisseur, c: true }, { t: '3D', v: r => r.occ, n: true }, { t: 'Signal', v: r => r.v, n: true, h: r => barCell(r.v, Math.max(...rows().map(x => x.v), 1), r.v ? fmt(r.v) : '') }, { t: 'Criticité', v: r => CRITS.indexOf(r.p.criticite), h: r => crit(r.p.criticite) }] });
  unsub = onChange(k => { if (k === 'select' || k === 'assign') { paint(); tbl?.mark(); } });
  window.__airplus.viewer = { paint, select: id => openEntity('occ', id), get ready() { return meshes.size > 0; }, get meshCount() { return meshes.size; } };
  new GLTFLoader().load('/assets/aircraft.glb', g => {
    g.scene.traverse(o => { if (o.isMesh) { const occ = occs[g.parser.associations.get(o)?.nodes]; o.material = new THREE.MeshStandardMaterial({ color: NEUTRAL, metalness: .02, roughness: .7, side: THREE.DoubleSide }); if (occ) { meshes.set(occ.node_index, { obj: o, occ }); o.userData.occ = occ; } } });
    scene.add(g.scene); orient(g.scene, A);
    const box = new THREE.Box3().setFromObject(g.scene); const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3()).length();
    controls.target.copy(c); camera.position.copy(c).add(new THREE.Vector3(.5, .36, .78).multiplyScalar(s * Math.max(1.02, 1.3 / (host.clientWidth / host.clientHeight)))); camera.near = s / 200; camera.far = s * 20; camera.updateProjectionMatrix();
    paint();
    if (V.focusRef) { const o = A.meshes.find(m => m.ref === V.focusRef); V.focusRef = null; if (o) { controls.autoRotate = false; openEntity('occ', o.occurrence_id); } }
  });
  picker(st, () => [...meshes.values()].map(m => m.obj), o => { if (o.userData.occ) { controls.autoRotate = false; openEntity('occ', o.userData.occ.occurrence_id); } }, o => {
    const n = document.getElementById('airName'); if (!n) return; const occ = o?.userData.occ; if (!occ) { n.innerHTML = ''; return; } const p = occ.ref ? A.parts.find(x => x.ref === occ.ref) : null;
    n.innerHTML = p ? `${esc(des(p.designation))}<small>${esc(p.ref)} · ${esc(p.fournisseur)} · ${money(p.prix_achat_eur)}</small>` : `${esc((occ.mesh_name || occ.node_name).replace(/^(Symétrie de )+/, '').replace(/\.\d+$/, ''))}<small>Sans référence PLM</small>`;
  });
  document.getElementById('airLayer').onchange = e => { V.layer = e.target.value; paint(); tbl.draw(); };
  document.getElementById('airZone').onchange = e => { V.zone = e.target.value; paint(); tbl.draw(); };
}
function label(text, size, color) {
  const c = document.createElement('canvas'); const g = c.getContext('2d'); const font = `600 ${size}px Archivo,Arial`; g.font = font; c.width = Math.ceil(g.measureText(text).width + 14); c.height = size + 12; g.font = font;
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 7, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(c.width / c.height * .55, .55, 1); return s;
}
function drawAtelier(f) {
  const A = store.analysis; const O = A.operations; const worst = O.slice().sort((a, b) => b.ecart_reel_prevu_s - a.ecart_reel_prevu_s)[0]; const zw = A.zones.slice().sort((a, b) => b.ecart_s - a.ecart_s)[0];
  document.getElementById('avBand').innerHTML = kband([{ l: 'Postes', v: String(O.length), n: `${A.zones.length} zones` }, { l: 'Plus gros écart', v: `P${worst.poste}`, n: `${dur(worst.ecart_reel_prevu_s, true)}, ${worst.intitule}`, sig: true, attr: `data-open="poste:${worst.poste}" style="cursor:pointer"` }, { l: 'Zone la plus en écart', v: zw.zone, n: dur(zw.ecart_s, true) }, { l: 'Personnes', v: String(A.persons.length), n: '2 à 3 par poste à l\'ERP' }, { l: 'Plan', v: 'Schématique', n: 'par zone, ordre du relevé' }]);
  f.innerHTML = `<div class="work"><section class="panel">${modesHtml()}<div class="viewer"><div class="host" id="shopHost"></div><div class="hover-name" id="shopName"></div></div></section><section class="panel"><div class="tablewrap" id="shopTable"></div></section></div>`;
  const host = document.getElementById('shopHost'); const R = makeRenderer(host); if (!R) return;
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(32, host.clientWidth / host.clientHeight, .1, 400);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd6cfc2, 2.5)); const d = new THREE.DirectionalLight(0xffffff, 1.3); d.position.set(10, 30, 12); scene.add(d);
  const controls = new OrbitControls(camera, R.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2.3;
  const ops = Object.fromEntries(O.map(o => [o.poste, o])); const E = O.map(o => o.ecart_reel_prevu_s); const emin = Math.min(...E), emax = Math.max(...E); const hmax = Math.max(...O.map(o => o.reel_s));
  const boxes = new Map(), pts = {}; const stepX = 1.5, stepZ = 2.5; const maxCols = Math.max(...A.zones.map(z => z.postes.length)); const perCol = Math.ceil(A.zones.length / 2); const plateW = maxCols * stepX; const labelW = 5.6; const colW = plateW + labelW + .8;
  A.zones.forEach((z, idx) => {
    const col = idx < perCol ? 0 : 1; const r = idx < perCol ? idx : idx - perCol; const ox = (col - .5) * colW + labelW / 2; const zz = (r - (perCol - 1) / 2) * stepZ;
    const lab = label(z.zone, 44, '#4f4941'); lab.scale.multiplyScalar(1.5); lab.position.set(ox - plateW / 2 - lab.scale.x / 2 - .1, .1, zz); scene.add(lab);
    z.postes.forEach((p, i) => { const o = ops[p]; const h = .2 + o.reel_s / hmax * 3.4; const x = ox + (i - (maxCols - 1) / 2) * stepX; const m = new THREE.Mesh(new THREE.BoxGeometry(1.05, h, 1.05), new THREE.MeshStandardMaterial({ color: mix('#efe9de', '#d90016', (o.ecart_reel_prevu_s - emin) / Math.max(1, emax - emin)), roughness: .75 })); m.position.set(x, h / 2, zz); m.userData.poste = p; scene.add(m); boxes.set(p, m); pts[p] = new THREE.Vector3(x, .03, zz); const l = label(String(p), 40, '#14120f'); l.scale.multiplyScalar(.85); l.position.set(x, .05, zz + .85); scene.add(l); });
  });
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(O.slice().sort((a, b) => a.debut.localeCompare(b.debut)).map(o => pts[o.poste])), new THREE.LineBasicMaterial({ color: 0xb3ac9f })));
  const fit = () => { const asp = host.clientWidth / Math.max(1, host.clientHeight); const t = Math.tan(THREE.MathUtils.degToRad(16)); const dist = Math.max((perCol * stepZ + 5) / (2 * t), (2 * colW + 2) / (2 * t * asp)); camera.position.set(0, dist, dist * .28); controls.target.set(0, 0, .3); camera.far = dist * 6; camera.updateProjectionMatrix(); };
  const st = { renderer: R, scene, camera, controls, host, onResize: fit }; fit(); loop(st);
  let hover = null;
  const hi = () => { const sel = store.sel?.type === 'poste' ? +store.sel.id : null; for (const [k, m] of boxes) m.material.emissive.set(k === hover ? 0x884400 : k === sel ? 0x770012 : 0); };
  tbl = dataTable(document.getElementById('shopTable'), { rows: () => O, key: o => o.poste, sort: 0, search: 'Filtrer : poste, opération, zone', attr: o => `data-open="poste:${o.poste}"`, selected: () => store.sel?.type === 'poste' ? store.sel.id : null, onHover: k => { hover = k == null ? null : +k; hi(); },
    cols: [{ t: 'P', v: o => o.poste, n: true }, { t: 'Opération', v: o => o.intitule, c: true }, { t: 'Zone', v: o => o.zone, c: true }, { t: 'Réalisé', v: o => o.reel_s, n: true, h: o => hms(o.reel_s) }, { t: 'Écart', v: o => o.ecart_reel_prevu_s, n: true, h: o => barCell(o.ecart_reel_prevu_s, 2265, dur(o.ecart_reel_prevu_s, true)) }, { t: 'Équipe', v: o => A.persons.filter(p => (store.overrides[p.person_id] ?? p.poste_origine) === o.poste).length, n: true }] });
  unsub = onChange(k => { if (k === 'select') { hi(); tbl.mark(); } });
  picker(st, () => [...boxes.values()], o => openEntity('poste', o.userData.poste), o => { const n = document.getElementById('shopName'); if (!n) return; const p = o?.userData.poste; if (!p) { n.innerHTML = ''; return; } const x = ops[p]; n.innerHTML = `Poste ${p}<small>${esc(x.intitule)} · ${dur(x.reel_s)} · ${dur(x.ecart_reel_prevu_s, true)}</small>`; });
  window.__airplus.shop = { get boxes() { return boxes.size; } };
  if (V.focusPoste) { openEntity('poste', V.focusPoste); V.focusPoste = null; }
  hi();
}
function drawFish(f) {
  const A = store.analysis; const data = A.ishikawa.filter(c => c.n_signaux);
  document.getElementById('avBand').innerHTML = kband(data.map(c => ({ l: c.categorie, v: dur(c.ecart_s, true), n: `${c.n_signaux} aléa${c.n_signaux > 1 ? 's' : ''}`, attr: `data-fc="${esc(c.categorie)}" style="cursor:pointer"`, sig: V.cat === c.categorie })));
  f.innerHTML = `<div class="work"><section class="panel">${modesHtml()}<div class="fish" id="fishWrap"></div></section><section class="panel"><div class="tablewrap" id="fishTable"></div></section></div>`;
  const rows = () => data.filter(c => !V.cat || c.categorie === V.cat).flatMap(c => c.signaux.map(s => ({ ...s, cat: c.categorie })));
  tbl = dataTable(document.getElementById('fishTable'), { rows, key: s => s.poste, sort: 5, desc: true, search: 'Filtrer : aléa, cause', attr: s => `data-open="poste:${s.poste}"`, selected: () => store.sel?.type === 'poste' ? store.sel.id : null,
    cols: [{ t: 'P', v: s => s.poste, n: true }, { t: 'Famille', v: s => s.cat }, { t: 'Aléa déclaré', v: s => s.alea, c: true }, { t: 'Mot-clé', v: s => s.mot_cle || '' }, { t: 'Cause possible', v: s => s.cause_potentielle, c: true }, { t: 'Écart', v: s => s.ecart_s, n: true, h: s => dur(s.ecart_s, true) }] });
  const render = () => { const w = document.getElementById('fishWrap'); if (w) w.innerHTML = fishbone(data); };
  render();
  const setCat = c => { V.cat = V.cat === c ? null : c; draw(); };
  document.getElementById('fishWrap').addEventListener('click', e => { const t = e.target.closest('[data-p]'); if (t) { openEntity('poste', t.dataset.p); return; } const b = e.target.closest('[data-cat]'); if (b) setCat(b.dataset.cat); });
  document.getElementById('avBand').onclick = e => { const b = e.target.closest('[data-fc]'); if (b) setCat(b.dataset.fc); };
  unsub = onChange(k => { if (k === 'select') { render(); tbl.mark(); } });
}
function fishbone(data) {
  const W = 1000, H = 730, mid = H / 2; const sel = store.sel?.type === 'poste' ? +store.sel.id : null;
  const top = data.filter((_, i) => i % 2 === 0), bot = data.filter((_, i) => i % 2 === 1); const X = n => Array.from({ length: n }, (_, i) => 215 + (i + .55) * (660 / n));
  const bone = (c, x, up) => {
    const dir = up ? -1 : 1; const x0 = x - 120, y0 = mid + dir * 278; const sig = [...c.signaux].sort((a, b) => b.ecart_s - a.ecart_s); const open = V.cat === c.categorie; const lim = open ? 14 : 6; let shown = sig.slice(0, lim); const h = sig.find(s => s.poste === sel); if (h && !shown.includes(h)) shown = [...shown.slice(0, lim - 1), h];
    const twig = shown.map((s, i) => { const t = (i + 1) / (shown.length + 1); const px = x0 + (x - x0) * t, py = y0 + (mid - y0) * t; const on = s.poste === sel; return `<g style="cursor:pointer" data-p="${s.poste}" ${tipAttr(`<b>Poste ${s.poste}</b> ${esc(s.alea)}<br>Cause possible : ${esc(s.cause_potentielle)}<br>${dur(s.ecart_s, true)}`)}><text x="${px - 7}" y="${py + 4}" text-anchor="end" font-size="13" font-weight="${on ? 700 : 400}" fill="${on ? 'var(--red)' : 'var(--ink2)'}">${s.poste} ${esc(s.alea.length > 21 ? s.alea.slice(0, 20) + '…' : s.alea)}</text></g>`; }).join('');
    return `<g class="bone" data-cat="${esc(c.categorie)}"><line x1="${x0}" y1="${y0}" x2="${x}" y2="${mid}" stroke="${open ? 'var(--red)' : 'var(--ink)'}" stroke-width="1.4"/><text class="bone-label" x="${x0}" y="${up ? y0 - 8 : y0 + 22}" text-anchor="middle" font-size="22" font-weight="700" style="font-stretch:84%" fill="${open ? 'var(--red)' : 'var(--ink)'}">${esc(c.categorie)}</text></g>${twig}`;
  };
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagramme d'Ishikawa"><line x1="90" x2="${W - 100}" y1="${mid}" y2="${mid}" stroke="var(--ink)" stroke-width="3"/><rect x="${W - 100}" y="${mid - 34}" width="100" height="68" fill="var(--red)"/><text x="${W - 50}" y="${mid - 3}" text-anchor="middle" font-size="13" style="fill:#fff">Écart</text><text x="${W - 50}" y="${mid + 20}" text-anchor="middle" font-size="22" font-weight="700" style="font-stretch:84%;fill:#fff">${dur(data.reduce((s, c) => s + c.ecart_s, 0), true)}</text>${X(top.length).map((x, i) => bone(top[i], x, true)).join('')}${X(bot.length).map((x, i) => bone(bot[i], x, false)).join('')}</svg>`;
}
function drawCatalogue(f) {
  const A = store.analysis; const s = A.supply;
  document.getElementById('avBand').innerHTML = kband([{ l: 'Références', v: String(A.parts.length), n: `${s.qty_totale} pièces` }, { l: 'Fournisseurs', v: String(s.n_fournisseurs), n: '' }, { l: 'Valeur', v: money(s.valeur_totale_eur), n: '' }, { l: 'Citées au MES', v: `${A.parts.filter(p => p.occ_mes).length}/${A.parts.length}`, n: '' }, { l: 'Dans la notice', v: `${A.parts.filter(p => p.qty_notice != null).length}/${A.parts.length}`, n: 'même référence exacte' }, { l: 'Modélisées 3D', v: `${A.parts.filter(p => p.occ_modele_3d).length}/${A.parts.length}`, n: '' }]);
  f.innerHTML = `${modesHtml()}<div id="cList" style="background:var(--panel)"></div>`;
  tbl = dataTable(document.getElementById('cList'), { rows: () => A.parts, key: p => p.ref, sort: 0, search: 'Filtrer : référence, désignation, fournisseur, criticité', attr: p => `data-open="ref:${esc(p.ref)}"`, selected: () => store.sel?.type === 'ref' ? store.sel.id : null,
    cols: [{ t: 'Réf.', v: p => p.ref }, { t: 'Désignation', v: p => des(p.designation) }, { t: 'Fournisseur', v: p => p.fournisseur }, { t: 'Nomencl.', v: p => p.qty_nomenclature, n: true }, { t: 'Notice', v: p => p.qty_notice ?? -1, n: true, h: p => p.qty_notice ?? '' }, { t: 'MES', v: p => p.occ_mes, n: true, h: p => p.occ_mes || '' }, { t: '3D', v: p => p.occ_modele_3d, n: true, h: p => p.occ_modele_3d || '' }, { t: 'Prix', v: p => p.prix_achat_eur, n: true, h: p => money(p.prix_achat_eur) }, { t: 'Valeur', v: p => p.valeur_nomenclature_eur, n: true, h: p => money(p.valeur_nomenclature_eur) }, { t: 'Masse', v: p => p.masse_kg, n: true, h: p => `${p.masse_kg} kg` }, { t: 'Délai', v: p => p.delai_max_j, n: true, h: p => esc(p.delai_source) }, { t: 'CAO', v: p => p.cao_h, n: true, h: p => `${p.cao_h} h` }, { t: 'Version', v: p => p.cao_3dxml?.[0]?.version || '' }, { t: 'Criticité', v: p => CRITS.indexOf(p.criticite), h: p => crit(p.criticite) }] });
  unsub = onChange(k => { if (k === 'select') tbl.mark(); });
}
