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
  poleHeight: 44,        // tall — extends well past the viewport top/bottom
                         // even on narrow mobile screens (where the camera
                         // gets pulled back and the visible world half-height
                         // grows past the desktop value)
  poleSegments: 96,      // smooth silhouette
  stickerStripWidth: 1.9, // arc-length size of stickers (unit world)
  whiteKey: 0.9,
  whiteFeather: 0.06,
  viewYRange: 8,         // vertical pan clamp — wide enough to reach stickers
                         // spread around the full circle / pole height
  sidePadPx: 80,         // screen-px padding from pole edge to viewport edge
  camZDefault: 14,       // baseline camera distance for wide screens
};

let scene, camera, renderer, raycaster, pointer;
let pole, world;
let rotating = null;   // { startX, startY, baseRot, baseY } during a drag-the-pole gesture
let viewY = 0;         // vertical pan offset (scroll / swipe)
let cameraAngle = 0;   // camera orbit angle around the Y axis (radians)
// Animate cameraAngle (camera orbit around the pole) to a target value.
// Picks the shorter rotation direction. Returns a promise.
let _rotAnim = null;
function tweenCameraAngle(target, ms) {
  if (_rotAnim) cancelAnimationFrame(_rotAnim.raf);
  const start = cameraAngle;
  let delta = target - start;
  while (delta >  Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const t0 = performance.now();
  return new Promise((resolve) => {
    function step(now) {
      const k = Math.min(1, (now - t0) / ms);
      const ease = 1 - Math.pow(1 - k, 3);
      cameraAngle = start + delta * ease;
      if (k < 1) _rotAnim = { raf: requestAnimationFrame(step) };
      else { _rotAnim = null; resolve(); }
    }
    _rotAnim = { raf: requestAnimationFrame(step) };
  });
}

// Vertical pan tween — bring a sticker's y to the centre of the viewport.
let _yAnim = null;
function tweenViewY(target, ms) {
  if (_yAnim) cancelAnimationFrame(_yAnim.raf);
  const start = viewY;
  const lo = -CFG.viewYRange, hi = CFG.viewYRange;
  const goal = Math.max(lo, Math.min(hi, target));
  const t0 = performance.now();
  return new Promise((resolve) => {
    function step(now) {
      const k = Math.min(1, (now - t0) / ms);
      const ease = 1 - Math.pow(1 - k, 3);
      viewY = start + (goal - start) * ease;
      if (k < 1) _yAnim = { raf: requestAnimationFrame(step) };
      else { _yAnim = null; resolve(); }
    }
    _yAnim = { raf: requestAnimationFrame(step) };
  });
}
let stickers = [];
let dragging = null, dragMoved = false, downPos = { x: 0, y: 0 };
let snapping = false;   // true during the per-pick snap animation; disables drag tracking
let topOrder = 100;
let isPaused = false;
const DRAG_LIFT = 0.55;    // how high a dragged sticker pops up off the cylinder
const REST_LIFT = 0.005;   // resting lift just off the surface
let container, modalApi, tagEl;
const texLoader = new THREE.TextureLoader();

/* ---------- pole: real PBR-ish material with a fixed light ---------- */
const POLE_TEX = 'assets/texture/gravel_embedded_concrete_2k.blend/textures/gravel_embedded_concrete_diff_2k.jpg';

const poleMat = new THREE.MeshStandardMaterial({
  // Until the texture finishes downloading we render a flat warm-gray pole
  // so visitors see "loading concrete" rather than a stark black silhouette
  // (which is what an untextured StandardMaterial defaults to).
  color: 0xb8b3ad,
  map: null,
  roughness: 0.95,
  metalness: 0.0,
});
// Swap the diffuse map in once it's ready, then trigger a re-render.
texLoader.load(POLE_TEX, (loaded) => {
  loaded.colorSpace = THREE.SRGBColorSpace;
  loaded.wrapS = THREE.RepeatWrapping;
  loaded.wrapT = THREE.RepeatWrapping;
  loaded.anisotropy = 8;
  // Tile so each repetition is roughly square in world units. Circumference
  // is 2*pi*radius ≈ 26.4, height 44; aim for ~4 world-unit tiles -> 6.6 × 11.
  loaded.repeat.set(6.6, 11);
  poleMat.map = loaded;
  poleMat.color.set(0xffffff);   // restore neutral tint so map shows true colour
  poleMat.needsUpdate = true;
  renderOnce();
}, undefined, (err) => console.error('[room3d] pole texture failed:', POLE_TEX, err));

/* ---------- sticker shader: white-key + dilated white die-cut border ---------- */
const stickerVert = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;
// Sticker shader.
//   - PNG content output as-is (no tint, no gamma, no fill).
//   - Outline thickness is in SCREEN PIXELS (via dFdx/dFdy), independent of
//     texture resolution. ~3px target.
//   - Outline color biased lighter on top so it reads as a faint highlight
//     from above (the "reflection" hint requested).
const stickerFrag = `
  precision highp float;
  uniform sampler2D map;
  uniform float borderPx;
  uniform float cornerR;     // rounded-rect radius in UV units (0 = square)
  varying vec2 vUv;
  // Anti-aliased rounded-rect mask in UV [0,1] space.
  float roundMask(vec2 uv){
    if (cornerR <= 0.0) return 1.0;
    vec2 q = abs(uv - 0.5) - (0.5 - cornerR);
    float d = length(max(q, 0.0)) - cornerR;
    vec2 px = vec2(length(dFdx(uv)), length(dFdy(uv)));
    float aa = max(max(px.x, px.y), 1e-5);
    return 1.0 - smoothstep(-aa, aa, d);
  }
  float aAt(vec2 uv){
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(map, uv).a * roundMask(uv);
  }
  void main(){
    bool inside = (vUv.x >= 0.0 && vUv.x <= 1.0 && vUv.y >= 0.0 && vUv.y <= 1.0);
    vec4 c = inside ? texture2D(map, vUv) : vec4(0.0);
    float mask = inside ? roundMask(vUv) : 0.0;
    c.a *= mask;
    vec2 px = vec2(length(dFdx(vUv)), length(dFdy(vUv)));
    float border = 0.0;
    for(int x=-2;x<=2;x++){
      for(int y=-2;y<=2;y++){
        vec2 off = vec2(float(x), float(y)) * px * (borderPx * 0.5);
        border = max(border, aAt(vUv + off));
      }
    }
    float outA = max(c.a, border);
    if (outA < 0.005) discard;
    // Continuous blend: at high c.a -> artwork; at c.a=0 (in the dilated ring)
    // -> the top-biased white outline. No hard branch -> no jaggies on the
    // alpha boundary.
    float topLight = mix(0.88, 1.0, clamp(1.0 - vUv.y, 0.0, 1.0));
    vec3 col = mix(vec3(topLight), c.rgb, c.a);
    gl_FragColor = vec4(col, outA);
  }
`;

// Sticker shadow shader: solid black silhouette using the same texture alpha.
// Soft contact shadow — multi-tap blur over a configurable screen-pixel radius
// so the shadow reads as a diffuse fall-off, not a hard silhouette.
const shadowFrag = `
  precision highp float;
  uniform sampler2D map;
  uniform float strength;
  uniform float blurPx;  // blur radius in screen pixels
  uniform float cornerR; // rounded-rect mask radius in UV units (0 = square)
  varying vec2 vUv;
  float roundMask(vec2 uv){
    if (cornerR <= 0.0) return 1.0;
    vec2 q = abs(uv - 0.5) - (0.5 - cornerR);
    float d = length(max(q, 0.0)) - cornerR;
    vec2 px = vec2(length(dFdx(uv)), length(dFdy(uv)));
    float aa = max(max(px.x, px.y), 1e-5);
    return 1.0 - smoothstep(-aa, aa, d);
  }
  float aAt(vec2 uv){
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(map, uv).a * roundMask(uv);
  }
  void main(){
    vec2 px = vec2(length(dFdx(vUv)), length(dFdy(vUv)));
    float sum = 0.0;
    float wTot = 0.0;
    for(int x=-3; x<=3; x++){
      for(int y=-3; y<=3; y++){
        // gaussian-ish falloff
        float r = sqrt(float(x*x + y*y));
        float w = exp(-r * r * 0.35);
        vec2 off = vec2(float(x), float(y)) * px * (blurPx / 3.0);
        sum  += aAt(vUv + off) * w;
        wTot += w;
      }
    }
    float a = sum / wTot;
    if (a < 0.01) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, strength * a);
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
  // (per-sticker shadows are created in addStickers)

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  bindEvents();
  animate();
}

function baseCam() {
  // Narrow-screen padding: pull the camera back so the pole never touches
  // the viewport edge (~CFG.sidePadPx of padding both sides).
  const w = Math.max(1, container.clientWidth);
  const aspect = camera.aspect;
  const halfTan = Math.tan((camera.fov * Math.PI / 180) / 2);
  const padFrac = CFG.sidePadPx / w;
  const minZ = CFG.poleRadius / ((1 - 2 * padFrac) * halfTan * aspect);
  const dist = Math.max(CFG.camZDefault, minZ);
  // How far up/down we can pan before the pole top/bottom enters the frame.
  const halfH = dist * halfTan;
  const safe = Math.max(0, CFG.poleHeight / 2 - halfH - 0.5);
  viewY = clamp(viewY, -safe, safe);
  // Orbit the camera around the Y axis. The pole + all stickers stay still
  // in world space; only the camera moves. Looking at the cylinder centre
  // at the same height puts that point dead-centre on screen.
  camera.position.set(
    Math.sin(cameraAngle) * dist,
    viewY,
    Math.cos(cameraAngle) * dist
  );
  camera.lookAt(0, viewY, 0);
}

// Largest |viewY| that keeps the pole top/bottom out of frame, given the
// current viewport. On wide desktops this is generous (~5); on narrow phones
// the camera gets pulled back, the visible world half-height grows, and this
// shrinks (often 1–3). Callers use it to decide whether to snap the camera
// vertically onto a sticker.
function safeViewYRange() {
  const w = Math.max(1, container.clientWidth);
  const aspect = camera.aspect;
  const halfTan = Math.tan((camera.fov * Math.PI / 180) / 2);
  const padFrac = CFG.sidePadPx / w;
  const minZ = CFG.poleRadius / ((1 - 2 * padFrac) * halfTan * aspect);
  const dist = Math.max(CFG.camZDefault, minZ);
  const halfH = dist * halfTan;
  return Math.max(0, CFG.poleHeight / 2 - halfH - 0.5);
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
function getPoleSurface(theta, y, out, lift) {
  const r = CFG.poleRadius + (lift != null ? lift : 0.005);
  const nx = Math.sin(theta), nz = Math.cos(theta);
  out.pos.set(r * nx, y, r * nz);
  out.normal.set(nx, 0, nz);
  return out;
}

/* ---- build a curved sticker geometry (subdivided, follows cylinder) ---- */
const _surf = { pos: new THREE.Vector3(), normal: new THREE.Vector3() };
function buildStickerGeometry(thetaC, yC, S, lift, aspect, marginIn) {
  const N = 28;
  const ar = (typeof aspect === 'number' && aspect > 0) ? aspect : 1;
  // Geometry is grown by `m` on each side; UVs are remapped so the texture's
  // [0,1] maps to the inner region. The margin area (UV outside [0,1]) is
  // where the outline + soft shadow can spill past the texture extent.
  const m  = (typeof marginIn === 'number') ? marginIn : 0.08;
  const sw = S       * (1 + 2 * m);
  const sh = (S / ar) * (1 + 2 * m);
  const arcHalf = (sw / 2) / CFG.poleRadius;
  const pos = new Float32Array((N+1)*(N+1)*3);
  const uvs = new Float32Array((N+1)*(N+1)*2);
  let p = 0, q = 0;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const fx = i / N, fy = j / N;
      const theta = thetaC + (fx - 0.5) * 2 * arcHalf;
      const y     = yC     + (0.5 - fy) * sh;
      getPoleSurface(theta, y, _surf, lift);
      pos[p++] = _surf.pos.x; pos[p++] = _surf.pos.y; pos[p++] = _surf.pos.z;
      const u = fx       * (1 + 2 * m) - m;
      const v = (1 - fy) * (1 + 2 * m) - m;
      uvs[q++] = u; uvs[q++] = v;
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
const SIZES = { large: 4.0, normal: 3.3, small: 2.7, tiny: 1.65 };

export function addStickers(list) {
  if (!Array.isArray(list) || !list.length) {
    console.error('[room3d] STICKERS_DATA missing/empty:', list);
    return;
  }
  list.forEach((d, i) => {
    const S = SIZES[d.size] || SIZES.normal;

    const tex = texLoader.load(
      d.sticker,
      (loaded) => {
        const img = loaded.image;
        const entry = stickers.find(s => s.mesh === mesh);
        if (entry) {
          entry.aspect = img.width / img.height;
          // Rasterize at modest resolution for cheap per-pixel alpha lookups
          // during raycasting (so transparent areas don't catch clicks/hover).
          const maxDim = 256;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const cw = Math.max(1, Math.round(img.width * scale));
          const ch = Math.max(1, Math.round(img.height * scale));
          const cv = document.createElement('canvas');
          cv.width = cw; cv.height = ch;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, cw, ch);
          entry._alphaCtx = ctx;
          rebuild(entry);
        }
        renderOnce();
      },
      undefined,
      (err) => console.error('[room3d] texture failed:', d.sticker, err)
    );
    tex.colorSpace = THREE.NoColorSpace;   // don't run sRGB conversion on the sticker
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 16;

    // Some IPs (ciji) are square photo crops — give them a rounded-rect mask
    // so they read as sticker cards instead of raw screenshots. Other entries
    // are PNGs with their own die-cut alpha and don't want any extra clip.
    const cornerR = (d && d.ipName === 'ciji') ? 0.08 : 0.0;
    // Outline reads as a faint highlight; shrink it on narrow viewports
    // where stickers already take less screen space.
    const isPhone = (container.clientWidth || window.innerWidth) < 720;
    const borderPx = isPhone ? 3.5 : 6.0;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map:      { value: tex },
        borderPx: { value: borderPx },     // outline width in screen pixels
        cornerR:  { value: cornerR },
      },
      vertexShader: stickerVert, fragmentShader: stickerFrag,
      transparent: true, depthWrite: false, depthTest: true,
      side: THREE.DoubleSide,
      extensions: { derivatives: true },   // dFdx/dFdy
    });

    // Per-sticker drop shadow — always visible, sits on the cylinder
    // surface, takes the silhouette from the same texture alpha.
    const shMat = new THREE.ShaderMaterial({
      uniforms: {
        map:      { value: tex },
        strength: { value: 0.35 },
        blurPx:   { value: 10.0 },   // soft blur radius in screen pixels
        cornerR:  { value: cornerR },
      },
      vertexShader: stickerVert, fragmentShader: shadowFrag,
      transparent: true, depthWrite: false, depthTest: true,
      side: THREE.DoubleSide,
      extensions: { derivatives: true },
    });
    const shMesh = new THREE.Mesh(new THREE.BufferGeometry(), shMat);
    shMesh.renderOrder = 1;                // behind the sticker (renderOrder 2+)
    world.add(shMesh);

    const saved = loadPos(d.id);
    const layout = saved ? saved : defaultLayout(d, i);
    const theta = layout.theta;
    const y = layout.y;

    const mesh = new THREE.Mesh(buildStickerGeometry(theta, y, S), mat);
    mesh.renderOrder = 2 + i;
    world.add(mesh);
    stickers.push({ mesh, shMesh, data: d, theta, y, S, lift: 0.005, aspect: 1 });
  });
  // Aim the camera at whichever side of the pole has the most stickers, so
  // the first paint never lands on an empty back. Also pan vertically to
  // their centre so the cluster lands in the middle of the viewport.
  const best = densestPose();
  if (best) {
    cameraAngle = best.angle;
    const safe = (typeof container !== 'undefined' && container)
      ? safeViewYRange() : CFG.viewYRange;
    viewY = clamp(best.y, -safe, safe);
  }
  renderOnce();
}

// Find the camera angle whose ±90° front-arc covers the most stickers, and
// the average y of those stickers (so the camera also pans to their vertical
// centre, not just their azimuth). Used for first-paint orientation and for
// the double-tap "find stickers" gesture. Returns null when there are no
// stickers yet.
function densestPose() {
  if (!stickers.length) return null;
  const STEPS = 72, HALF = Math.PI / 2;
  let bestAngle = 0, bestScore = -1, bestY = 0;
  for (let k = 0; k < STEPS; k++) {
    const a = (k / STEPS) * 2 * Math.PI - Math.PI;
    let score = 0, ySum = 0;
    for (const s of stickers) {
      let d2 = s.theta - a;
      while (d2 >  Math.PI) d2 -= 2 * Math.PI;
      while (d2 < -Math.PI) d2 += 2 * Math.PI;
      if (Math.abs(d2) <= HALF) { score++; ySum += s.y; }
    }
    if (score > bestScore) {
      bestScore = score;
      bestAngle = a;
      bestY = score > 0 ? ySum / score : 0;
    }
  }
  return { angle: bestAngle, y: bestY };
}

// Default placement.
//   IP stickers — scattered across the full circle (including the back of the
//     pole) and a centred vertical band so they cluster around eye-level
//     instead of being thrown the full pan range; seeded by per-sticker
//     randoms baked into the manifest entries so positions stay stable
//     between renders.
//   Project stickers — a wider front-half arc + staggered heights so they
//     read as a loose grid rather than a tight column.
function defaultLayout(d, i) {
  if (d && d.kind === 'illustration-ip') {
    const ix = (typeof d.ix === 'number') ? d.ix : Math.random();
    const iy = (typeof d.iy === 'number') ? d.iy : Math.random();
    const theta = (ix * 2 - 1) * Math.PI;            // -π..π (full circle)
    // Half of viewYRange keeps every IP teaser visible from the default
    // camera height — users don't need to pan to find them.
    const y     = (iy * 2 - 1) * (CFG.viewYRange * 0.5);
    return { theta, y };
  }
  const cols = 3;
  const col = i % cols, row = Math.floor(i / cols);
  const theta = (col - (cols - 1) / 2) * 1.1;        // ±1.1 rad — wider arc
  const y = 4 - row * 2.6 + (col === 1 ? 0 : 0.6);
  return { theta, y };
}

function rebuild(entry) {
  entry.y = clamp(entry.y, -CFG.poleHeight/2 + 1, CFG.poleHeight/2 - 1);
  // sticker (margin a little wider so outline can spill past the artwork)
  const g = buildStickerGeometry(
    entry.theta, entry.y, entry.S, entry.lift, entry.aspect, 0.08
  );
  entry.mesh.geometry.dispose();
  entry.mesh.geometry = g;
  // shadow — almost-touching contact shadow that softens with blur, not by
  // moving away. As lift grows (drag), it drops slightly + softens further.
  if (entry.shMesh) {
    const yOff  = -0.02 - entry.lift * 0.18;
    const scale = 1.04 + entry.lift * 0.10;
    // wider margin on shadow so the blur tail can fade past the artwork
    const sg = buildStickerGeometry(
      entry.theta, entry.y + yOff, entry.S * scale, 0.001, entry.aspect, 0.18
    );
    entry.shMesh.geometry.dispose();
    entry.shMesh.geometry = sg;
    const u = entry.shMesh.material.uniforms;
    u.strength.value = 0.35 - entry.lift * 0.18;
    u.blurPx.value   = 10.0 + entry.lift * 14.0; // blurrier when lifted
  }
}

// Position the flat preview plane in front of the cylinder, centred in screen
// space. We place it at world (0, 0, poleRadius + offset) — i.e. directly on
// the camera-facing side of the pole — and scale it to the sticker's size.
function buildFlatGeometry(S, aspect, margin) {
  const m  = (typeof margin === 'number') ? margin : 0.08;
  const ar = (aspect && aspect > 0) ? aspect : 1;
  const halfW = (S       * (1 + 2 * m)) / 2;
  const halfH = ((S / ar) * (1 + 2 * m)) / 2;
  const pos = new Float32Array([
    -halfW, -halfH, 0,
     halfW, -halfH, 0,
    -halfW,  halfH, 0,
     halfW,  halfH, 0,
  ]);
  const uvs = new Float32Array([
       -m,    -m,
     1 + m,    -m,
       -m, 1 + m,
     1 + m, 1 + m,
  ]);
  const idx = [0, 1, 2, 1, 3, 2];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}
function updateFlatPose(entry) {
  if (!entry.flat) return;
  // (re)build with margin so the outline shader has room to draw past the
  // artwork edge; baked at world units so we never need geometry scaling.
  if (entry.flat.geometry) entry.flat.geometry.dispose();
  entry.flat.geometry = buildFlatGeometry(entry.S, entry.aspect, 0.08);
  entry.flat.scale.set(1, 1, 1);
  entry.flat.rotation.set(0, 0, 0);
  // x stays 0 (vertical seam centred on screen). y follows viewY so the
  // sticker stays in the optical centre while the pan tween runs. z sits
  // just in front of the cylinder.
  entry.flat.position.set(0, viewY, CFG.poleRadius + 1.2);
}
// Called every frame for the currently-dragged sticker so it tracks viewY.
function syncFlatToView() {
  if (dragging && dragging.flat && dragging.flat.visible) {
    dragging.flat.position.y = viewY;
  }
}
/* ============ INTERACTION ============ */
let lastTapAt = 0;     // for double-tap detection on empty space
let rotateMoved = false;
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
// Sample the sticker's source image at the raycast UV. Returns null if the
// hit landed on a transparent pixel (or out of bounds) so transparent areas
// don't trigger drag / click.
function alphaAt(entry, uv) {
  const ctx = entry._alphaCtx;
  if (!ctx || uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) return 0;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  // texture UV.y was inverted in geometry build (1-fy in inner region remap),
  // so we use uv directly here — the geometry builder maps texture's [0,1]
  // to inner region of the mesh.
  const x = Math.min(w - 1, Math.max(0, Math.floor(uv.x * w)));
  const y = Math.min(h - 1, Math.max(0, Math.floor((1 - uv.y) * h)));
  try { return ctx.getImageData(x, y, 1, 1).data[3] / 255; } catch (e) { return 0; }
}
// Find the FRONT-most sticker whose silhouette covers this pointer, by
// walking ALL ray intersections (not just the first), in order of distance,
// and skipping any whose alpha at the hit UV is transparent.
function pickStickerByAlpha() {
  const all = raycaster.intersectObjects(stickers.map(s => s.mesh), false);
  if (!all.length) return null;
  const pHit = raycaster.intersectObject(pole, false)[0];
  for (const h of all) {
    if (pHit && h.distance > pHit.distance) break; // behind the pole — done
    const entry = stickers.find(s => s.mesh === h.object);
    if (!entry || !h.uv) continue;
    if (alphaAt(entry, h.uv) > 0.05) return entry;
  }
  return null;
}
function onDown(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const picked = pickStickerByAlpha();
  downPos = { x: e.clientX, y: e.clientY };
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) {}
  if (picked) {
    dragging = picked;
    dragging.mesh.renderOrder = ++topOrder;
    const targetAngle = picked.theta;
    dragging._startX = e.clientX;
    dragging._baseAngle = targetAngle;
    dragging._baseTheta = picked.theta;
    dragging._touch = (e.pointerType === 'touch');
    dragging.lift = DRAG_LIFT;
    rebuild(dragging);
    dragMoved = false;
    snapping = true;
    // Snap horizontally to centre the sticker. Snap vertically only when the
    // sticker's y is within the current safe viewport range — otherwise the
    // pole's top/bottom would enter frame and baseCam() would have to clamp
    // viewY anyway, producing a visible bounce-back.
    const safe = safeViewYRange();
    const tweens = [tweenCameraAngle(targetAngle, 380)];
    if (Math.abs(picked.y) <= safe) tweens.push(tweenViewY(picked.y, 380));
    Promise.all(tweens).then(() => { snapping = false; });
    return;
  }
  // empty space (or click landed on the pole / back-side sticker) -> spin & pan
  rotateMoved = false;
  rotating = { startX: e.clientX, startY: e.clientY, baseRot: cameraAngle, baseY: viewY, touch: (e.pointerType === 'touch') };
}
function onMove(e) {
  updateHoverTag(e);
  if (rotating) {
    const dx = e.clientX - rotating.startX;
    const dy = e.clientY - rotating.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) rotateMoved = true;
    cameraAngle = rotating.baseRot - (dx / window.innerWidth) * Math.PI * 2;
    // Vertical pan works for both mouse and touch — baseCam() clamps viewY
    // to the safe range so the pole's caps stay out of frame. Touch needs a
    // higher gain because finger travel is shorter than mouse travel.
    const gain = rotating.touch ? 0.045 : 0.025;
    viewY = clamp(rotating.baseY - dy * gain, -CFG.viewYRange, CFG.viewYRange);
    return;
  }
  if (!dragging) return;
  if (snapping) return;                       // wait until the snap finishes
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
  cameraAngle = dragging._baseAngle + turn;
  dragging.theta = dragging._baseTheta + turn;
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(pole, false)[0];
  if (hit) {
    const local = pole.worldToLocal(hit.point.clone());
    const ny = clamp(local.y, -CFG.viewYRange, CFG.viewYRange);
    dragging.y = ny;
    // Camera follows the sticker vertically — but only inside the current
    // safe range, AND only on mouse (touch + camera-follow creates a feedback
    // loop). Once the sticker leaves the safe range we leave viewY alone so
    // baseCam() doesn't have to fight the tween to keep the pole's caps out
    // of frame.
    if (!dragging._touch) {
      const safe = safeViewYRange();
      if (Math.abs(ny) <= safe) viewY = ny;
    }
  }
  rebuild(dragging);

}
function onUp(e) {
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (err) {}
  if (rotating) {
    const wasTap = !rotateMoved;
    rotating = null;
    // Double-tap on empty space -> spin and pan to the densest sticker cluster.
    if (wasTap) {
      const now = performance.now();
      if (now - lastTapAt < 350) {
        lastTapAt = 0;
        const target = densestPose();
        if (target) {
          const safe = safeViewYRange();
          const targetY = clamp(target.y, -safe, safe);
          tweenCameraAngle(target.angle, 520);
          tweenViewY(targetY, 520);
        }
      } else {
        lastTapAt = now;
      }
    }
    return;
  }
  if (!dragging) return;
  if (dragMoved) savePos(dragging.data.id, dragging.theta, dragging.y);
  else if (modalApi && modalApi.open) modalApi.open(dragging.data);
  // hide the flat preview, restore the curved sticker on the cylinder
  if (dragging.shMesh) dragging.shMesh.visible = true;
  dragging.mesh.visible = true;
  dragging.lift = REST_LIFT;
  rebuild(dragging);
  snapping = false;
  dragging = null;
}




function updateHoverTag(e) {
  if (!tagEl) return;
  if (dragging || rotating) { hideTag(); return; }
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const picked = pickStickerByAlpha();
  if (picked) {
    showTag(picked.data.name, e.clientX, e.clientY);
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
  syncFlatToView();
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