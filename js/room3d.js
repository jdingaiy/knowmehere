/**
 * room3d.js — central cylinder ("utility pole" placeholder) with stickers
 * that wrap onto its curved surface.
 *
 * White background, one upright cylinder centred in the scene, no lighting.
 * Stickers are subdivided meshes whose vertices are projected onto the
 * cylinder so the sticker really hugs the curve. Drag uses raycasting
 * against the cylinder; the hit point gives (theta, y) and the sticker
 * follows the cursor along the surface.
 *
 * Replace later with a real model by overriding `getPoleSurface()` to
 * return your model's (theta, y) -> world position/normal mapping.
 */
import * as THREE from 'three';

const CFG = {
  poleRadius: 4.2,
  poleHeight: 28,        // tall — extends past the top/bottom of view
  poleSegments: 96,      // smooth silhouette
  stickerStripWidth: 1.9, // arc-length size of stickers (unit world)
  whiteKey: 0.9,
  whiteFeather: 0.06,
  viewYRange: 3,         // vertical pan clamp (matches sticker layout)
  sidePadPx: 80,         // screen-px padding from pole edge to viewport edge
  camZDefault: 14,       // baseline camera distance for wide screens
};

let scene, camera, renderer, raycaster, pointer;
let pole, world;
let rotating = null;   // { startX, startY, baseRot, baseY } during a drag-the-pole gesture
let viewY = 0;         // vertical pan offset (scroll / swipe)
let stickers = [];
let dragging = null, dragMoved = false, downPos = { x: 0, y: 0 };
let topOrder = 100;
let isPaused = false;
let shadowMesh = null;     // reused dark plane that lays on the cylinder under a lifted sticker
const SHADOW_LIFT = 0.005; // hugs the cylinder surface (same as a resting sticker)
const DRAG_LIFT   = 0.55;  // how high a dragged sticker pops up off the cylinder
let container, modalApi, tagEl;
const texLoader = new THREE.TextureLoader();

/* ---------- pole: real PBR-ish material with a fixed light ---------- */
const POLE_TEX = 'assets/texture/gravel_embedded_concrete_2k.blend/textures/gravel_embedded_concrete_diff_2k.jpg';
const poleTex = texLoader.load(POLE_TEX, renderOnce, undefined,
  (err) => console.error('[room3d] pole texture failed:', POLE_TEX, err));
poleTex.colorSpace = THREE.SRGBColorSpace;
poleTex.wrapS = THREE.RepeatWrapping;
poleTex.wrapT = THREE.RepeatWrapping;
poleTex.anisotropy = 8;
// Tile so each repetition is roughly square in world units. Circumference is
// 2*pi*radius ≈ 26.4, height 28; aim for ~4 world-unit tiles -> 6.6 × 7.
poleTex.repeat.set(6.6, 7);

const poleMat = new THREE.MeshStandardMaterial({
  map: poleTex,
  roughness: 0.95,
  metalness: 0.0,
});

/* ---------- sticker shader: white-key + dilated white die-cut border ---------- */
const stickerVert = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;
const stickerFrag = `
  precision highp float;
  uniform sampler2D map;
  uniform float keyVal, feather, bw;
  uniform vec2 texel;
  varying vec2 vUv;
  float fillA(vec2 uv){
    vec4 c = texture2D(map, uv);
    float l = dot(c.rgb, vec3(0.299,0.587,0.114));
    return 1.0 - smoothstep(keyVal - feather, keyVal + feather, l);
  }
  void main(){
    vec4 c = texture2D(map, vUv);
    float a = fillA(vUv);
    float d = 0.0;
    for(int x=-2;x<=2;x++){
      for(int y=-2;y<=2;y++){
        d = max(d, fillA(vUv + vec2(float(x), float(y)) * texel * bw));
      }
    }
    float outA = max(a, d);
    if(outA < 0.03) discard;
    vec3 col = mix(vec3(1.0), c.rgb, a);
    gl_FragColor = vec4(col, outA);
  }
`;

/* ============ INIT ============ */
export function initRoom(opts) {
  container = opts.container;
  modalApi  = opts.modalApi;
  tagEl     = document.getElementById('sticker-tag');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  // Fixed lights — affect the pole material only (stickers use a custom
  // unlit shader). Bright ambient keeps the back side from going dark.
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(6, 10, 8);   // top-front-right of the pole
  scene.add(key);

  const w = container.clientWidth, h = container.clientHeight;
  camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 200);
  baseCam();

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.touchAction = 'none'; // let pointer drags work on touch
  container.appendChild(renderer.domElement);

  buildPole();
  // shared shadow under a dragged sticker
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.22,
    depthWrite: false, side: THREE.DoubleSide
  });
  shadowMesh = new THREE.Mesh(new THREE.BufferGeometry(), shadowMat);
  shadowMesh.visible = false;
  shadowMesh.renderOrder = 1;
  world.add(shadowMesh);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  bindEvents();
  animate();
}

function baseCam() {
  // Dynamic distance: on narrow screens pull the camera back so the pole
  // never touches the viewport edge (~CFG.sidePadPx of padding both sides).
  const w = Math.max(1, container.clientWidth);
  const aspect = camera.aspect;
  const halfTan = Math.tan((camera.fov * Math.PI / 180) / 2);
  const padFrac = CFG.sidePadPx / w;            // padding as fraction of width
  const minZ = CFG.poleRadius / ((1 - 2 * padFrac) * halfTan * aspect);
  const z = Math.max(CFG.camZDefault, minZ);
  // Vertical pan shifts camera + lookAt together so perspective doesn't tilt.
  camera.position.set(0, viewY, z);
  camera.lookAt(0, viewY, 0);
}

/* ============ POLE ============ */
function buildPole() {
  world = new THREE.Group();
  world.name = 'world';
  scene.add(world);

  const g = new THREE.CylinderGeometry(
    CFG.poleRadius, CFG.poleRadius,
    CFG.poleHeight, CFG.poleSegments, 1, true
  );
  pole = new THREE.Mesh(g, poleMat);
  pole.name = 'pole';
  world.add(pole);
}

/**
 * Surface mapping: (theta, y) -> { pos, normal } in world space.
 * theta = angle around the pole (0 faces +Z, i.e. the camera).
 * y     = vertical world position.
 *
 * To swap in a real model later, replace this function with one that
 * samples your model's silhouette/UV.
 */
function getPoleSurface(theta, y, out) {
  const r = CFG.poleRadius + 0.005; // tiny lift so sticker sits on the surface
  const nx = Math.sin(theta), nz = Math.cos(theta);
  out.pos.set(r * nx, y, r * nz);
  out.normal.set(nx, 0, nz);
  return out;
}

/* ---- build a curved sticker geometry (subdivided, follows cylinder) ---- */
const _surf = { pos: new THREE.Vector3(), normal: new THREE.Vector3() };
function buildStickerGeometry(thetaC, yC, S) {
  const N = 28;
  const arcHalf = (S / 2) / CFG.poleRadius; // half angular span
  const pos = new Float32Array((N+1)*(N+1)*3);
  const uvs = new Float32Array((N+1)*(N+1)*2);
  let p = 0, q = 0;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const fx = i / N, fy = j / N;
      const theta = thetaC + (fx - 0.5) * 2 * arcHalf;
      const y     = yC     + (0.5 - fy) * S;        // top of strip is high y
      getPoleSurface(theta, y, _surf);
      pos[p++] = _surf.pos.x; pos[p++] = _surf.pos.y; pos[p++] = _surf.pos.z;
      uvs[q++] = fx; uvs[q++] = 1.0 - fy;
    }
  }
  const idx = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j*(N+1) + i, b = a + 1, c2 = a + (N+1), d = c2 + 1;
      idx.push(a, c2, b,  b, c2, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/* ============ STICKERS ============ */
const SIZES = { large: 4.0, normal: 3.3, small: 2.7 };

export function addStickers(list) {
  if (!Array.isArray(list) || !list.length) {
    console.error('[room3d] STICKERS_DATA missing/empty:', list);
    return;
  }
  list.forEach((d, i) => {
    const S = SIZES[d.size] || SIZES.normal;

    const tex = texLoader.load(d.sticker, renderOnce, undefined,
      (err) => console.error('[room3d] texture failed:', d.sticker, err));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map:    { value: tex },
        keyVal: { value: CFG.whiteKey },
        feather:{ value: CFG.whiteFeather },
        texel:  { value: new THREE.Vector2(1/1024, 1/1024) },
        bw:     { value: 4.0 },
      },
      vertexShader: stickerVert, fragmentShader: stickerFrag,
      transparent: true, depthWrite: false, depthTest: true,
      side: THREE.DoubleSide,
    });

    const saved = loadPos(d.id);
    const layout = saved ? saved : defaultLayout(d, i);
    const theta = layout.theta;
    const y = layout.y;

    const mesh = new THREE.Mesh(buildStickerGeometry(theta, y, S), mat);
    mesh.renderOrder = 2 + i;
    world.add(mesh);
    stickers.push({ mesh, data: d, theta, y, S });
  });
  renderOnce();
}

// Default placement spreads stickers around the front half of the pole at
// staggered heights so they're all visible from the camera.
function defaultLayout(d, i) {
  const cols = 3, rows = Math.ceil(20 / cols);
  const col = i % cols, row = Math.floor(i / cols);
  // theta in [-0.7, 0.7] rad keeps stickers on the front-facing arc
  const theta = (col - (cols - 1) / 2) * 0.55;
  const y = 4 - row * 2.6 + (col === 1 ? 0 : 0.6);
  return { theta, y };
}

function rebuild(entry) {
  // clamp y inside the visible pole, theta is unclamped (free spin)
  entry.y = clamp(entry.y, -CFG.poleHeight/2 + 1, CFG.poleHeight/2 - 1);
  const g = buildStickerGeometry(entry.theta, entry.y, entry.S, entry.lift);
  entry.mesh.geometry.dispose();
  entry.mesh.geometry = g;
}

/* ============ INTERACTION ============ */
function bindEvents() {
  const el = renderer.domElement;
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('resize', onResize);
  el.addEventListener('pointerleave', hideTag);
  // mouse wheel / trackpad vertical scroll -> pan view up/down
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    viewY = clamp(viewY - e.deltaY * 0.01, -CFG.viewYRange, CFG.viewYRange);
  }, { passive: false });
}
function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}
function onDown(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const sHit = raycaster.intersectObjects(stickers.map(s => s.mesh), false)[0];
  const pHit = raycaster.intersectObject(pole, false)[0];
  downPos = { x: e.clientX, y: e.clientY };
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) {}
  // Sticker pick is valid only if it sits in FRONT of the pole. Stickers on
  // the far side are occluded visually but the raycaster doesn't check that
  // by itself — compare distances here.
  if (sHit && (!pHit || sHit.distance < pHit.distance)) {
    dragging = stickers.find(s => s.mesh === sHit.object);
    dragging.mesh.renderOrder = ++topOrder;
    dragging._startX = e.clientX;
    dragging._baseRot = world.rotation.y;
    // lift the sticker off the cylinder + drop a shadow under it
    dragging.lift = DRAG_LIFT;
    rebuild(dragging);
    updateShadow();
    dragging._baseTheta = dragging.theta;
    dragMoved = false;
    return;
  }
  // empty space (or click landed on the pole / back-side sticker) -> spin & pan
  rotating = { startX: e.clientX, startY: e.clientY, baseRot: world.rotation.y, baseY: viewY, touch: (e.pointerType === 'touch') };
}
function onMove(e) {
  updateHoverTag(e);
  if (rotating) {
    const dx = e.clientX - rotating.startX;
    const dy = e.clientY - rotating.startY;
    world.rotation.y = rotating.baseRot + (dx / window.innerWidth) * Math.PI * 2;
    if (!rotating.touch) {
      viewY = clamp(rotating.baseY - dy * 0.025, -CFG.viewYRange, CFG.viewYRange);
    }
    return;
  }
  if (!dragging) return;
  if (Math.abs(e.clientX - downPos.x) > 4 || Math.abs(e.clientY - downPos.y) > 4)
    dragMoved = true;
  // Sticker drag:
  //   horizontal -> rotate the pole UNDER the sticker; sticker.theta counter-
  //                 rotates so the sticker stays anchored at its pickup
  //                 screen-X position. Net effect: pole spins, sticker stays
  //                 visually put, sticker's LOCAL position on the pole shifts.
  //   vertical   -> sticker.y follows the cursor's projected y on the pole.
  const dx = e.clientX - dragging._startX;
  const turn = -(dx / window.innerWidth) * Math.PI * 2;
  world.rotation.y = dragging._baseRot + turn;
  dragging.theta   = dragging._baseTheta - turn;
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(pole, false)[0];
  if (hit) {
    const local = pole.worldToLocal(hit.point.clone());
    dragging.y = local.y;
  }
  rebuild(dragging);
  updateShadow();
}
function onUp(e) {
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (err) {}
  if (rotating) { rotating = null; return; }
  if (!dragging) return;
  if (dragMoved) savePos(dragging.data.id, dragging.theta, dragging.y);
  else if (modalApi && modalApi.open) modalApi.open(dragging.data);
  // settle: drop the sticker back onto the cylinder + hide its shadow
  dragging.lift = SHADOW_LIFT;
  rebuild(dragging);
  if (shadowMesh) shadowMesh.visible = false;
  dragging = null;
}

function updateShadow() {
  if (!shadowMesh || !dragging) return;
  // shadow geometry: same curved patch as the sticker, slightly larger and
  // sitting on the cylinder surface (SHADOW_LIFT), offset down a touch to
  // imply a soft top-down light.
  const yOff = -0.18;
  const g = buildStickerGeometry(
    dragging.theta, dragging.y + yOff, dragging.S * 1.08, SHADOW_LIFT
  );
  shadowMesh.geometry.dispose();
  shadowMesh.geometry = g;
  shadowMesh.visible = true;
}


function updateHoverTag(e) {
  if (!tagEl) return;
  if (dragging || rotating) { hideTag(); return; }
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const sHit = raycaster.intersectObjects(stickers.map(s => s.mesh), false)[0];
  const pHit = raycaster.intersectObject(pole, false)[0];
  if (sHit && (!pHit || sHit.distance < pHit.distance)) {
    const entry = stickers.find(s => s.mesh === sHit.object);
    if (entry) showTag(entry.data.name, e.clientX, e.clientY);
  } else {
    hideTag();
  }
}
function showTag(text, x, y) {
  tagEl.textContent = text;
  tagEl.style.left = x + 'px';
  tagEl.style.top  = y + 'px';
  tagEl.classList.add('visible');
}
function hideTag() { if (tagEl) tagEl.classList.remove('visible'); }
/* ============ FILTER / RESET ============ */
export function applyFilter(cat) {
  stickers.forEach(s => { s.mesh.visible = (cat === 'all' || s.data.category === cat); });
}
export function resetStickers() {
  stickers.forEach(s => { try { localStorage.removeItem('skP_' + s.data.id); } catch (e) {} });
  location.reload();
}

/* ============ LOOP ============ */
function onResize() {
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
function renderOnce() { if (renderer && scene && camera) renderer.render(scene, camera); }
function animate() {
  if (isPaused) return;
  requestAnimationFrame(animate);
  baseCam();
  renderer.render(scene, camera);
}
export function pause()  { isPaused = true; }
export function resume() {
  if (!isPaused) return;
  isPaused = false;
  animate();
}

/* ============ STORAGE / UTILS ============ */
function savePos(id, theta, y) {
  try { localStorage.setItem('skP_' + id, JSON.stringify({ theta, y })); } catch (e) {}
}
function loadPos(id) {
  try { const r = localStorage.getItem('skP_' + id); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }