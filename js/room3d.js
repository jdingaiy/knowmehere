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
import * as THREE from './three.module.js';

const gsap = window.gsap;
const reducedMotion = () => window.__motionReduced?.() ?? false;
const stickerTimeUniform = { value: 0 };

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
let pole, world, poleLightMap = null;
let rotating = null;   // { startX, startY, baseRot, baseY } during a drag-the-pole gesture
let viewY = 0;         // vertical pan offset (scroll / swipe)
let cameraAngle = 0;   // camera orbit angle around the Y axis (radians)
// Animate cameraAngle (camera orbit around the pole) to a target value.
// Picks the shorter rotation direction. Returns a promise.
let _rotAnim = null;
function tweenCameraAngle(target, ms) {
  if (_rotAnim) _rotAnim.kill();
  const start = cameraAngle;
  let delta = target - start;
  while (delta >  Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const state = { value: start };
  _rotAnim = gsap.to(state, {
    value: start + delta,
    duration: reducedMotion() ? 0 : ms / 1000,
    ease: 'power3.out',
    overwrite: 'auto',
    onUpdate: () => { cameraAngle = state.value; },
    onComplete: () => { _rotAnim = null; },
  });
  return _rotAnim;
}

// Vertical pan tween — bring a sticker's y to the centre of the viewport.
let _yAnim = null;
function tweenViewY(target, ms) {
  if (_yAnim) _yAnim.kill();
  const start = viewY;
  const lo = -CFG.viewYRange, hi = CFG.viewYRange;
  const goal = Math.max(lo, Math.min(hi, target));
  const state = { value: start };
  _yAnim = gsap.to(state, {
    value: goal,
    duration: reducedMotion() ? 0 : ms / 1000,
    ease: 'power3.out',
    overwrite: 'auto',
    onUpdate: () => { viewY = state.value; },
    onComplete: () => { _yAnim = null; },
  });
  return _yAnim;
}
let stickers = [];
let dragging = null, dragMoved = false, downPos = { x: 0, y: 0 };
let topOrder = 100;
let isPaused = false;
// Desktop hover intent: wait briefly before centring a sticker so casually
// crossing the pole does not make the camera chase every item.
const HOVER_FOCUS_DELAY = 220;
let hoverFocusTimer = null;
let hoverFocusTarget = null;
let focusedSticker = null;
let focusedPointer = null;
// One-shot hint: until the visitor has clicked any sticker, periodically
// wiggle a random visible one to suggest they're interactive. The flag is
// persisted so the hint never replays for returning visitors.
const HINT_KEY = 'sk_hint_done_v1';
let hintTimer = null, hintActive = null, hintStart = 0;
const DRAG_LIFT = 0.22;    // detached height after a deliberate peel
const REST_LIFT = 0.005;   // resting lift just off the surface
const PEEL_START = 0.14;   // small edge curl on pointer-down
const PEEL_DISTANCE = 118; // pointer pixels needed for a full peel
const PEEL_DETACH = 0.78;  // curl becomes a free, flat sticker after this point
let container, modalApi, tagEl;

/* ---------- loading manager + reveal (intro animation) state ---------- */
let onProgressCb = null, onReadyCb = null;
let mgrBusy = false, stickersAdded = false, revealed = false;
let _revealPose = null;
const loadMgr = new THREE.LoadingManager();
loadMgr.onStart = () => { mgrBusy = true; };
loadMgr.onLoad  = () => { mgrBusy = false; maybeReveal(); };
loadMgr.onProgress = (url, loaded, total) => { if (onProgressCb) onProgressCb(loaded, total); };
const texLoader = new THREE.TextureLoader(loadMgr);

/* ---------- pole: real PBR-ish material with a fixed light ---------- */
const POLE_TEX = 'assets/texture/gravel_embedded_concrete_2k.blend/textures/gravel_embedded_concrete_diff_2k.jpg';
const POLE_NOR = 'assets/texture/gravel_embedded_concrete_2k.blend/textures/gravel_embedded_concrete_nor_2k.jpg';
const POLE_ROUGH = 'assets/texture/gravel_embedded_concrete_2k.blend/textures/gravel_embedded_concrete_rough_2k.jpg';
const POLE_LIGHT = 'assets/texture/dappled_light.jpg';

const poleMat = new THREE.MeshStandardMaterial({
  color: 0xb8b3ad,
  map: null,
  normalMap: null,
  normalScale: new THREE.Vector2(1.2, 1.2), // slightly stronger bumpiness for realistic gravel texture
  roughnessMap: null,
  roughness: 0.95,
  metalness: 0.0,
});

// Custom Gobo project map parameters stored in userData
poleMat.userData.goboRepeat = { value: new THREE.Vector2(1.0, 1.0) }; // smaller sunlight spots wrapping seamlessly (integer horizontally)
poleMat.userData.goboOffset = { value: new THREE.Vector2(0, 0) };
poleMat.userData.goboTime = { value: 0 };
poleMat.userData.goboMap = { value: null };
poleMat.userData.goboIntensity = { value: 0.2 }; // 揭幕时从暗渐亮到 1.7（见 startReveal）

poleMat.onBeforeCompile = (shader) => {
  shader.uniforms.goboRepeat = poleMat.userData.goboRepeat;
  shader.uniforms.goboOffset = poleMat.userData.goboOffset;
  shader.uniforms.goboTime = poleMat.userData.goboTime;
  shader.uniforms.goboMap = poleMat.userData.goboMap;
  shader.uniforms.goboIntensity = poleMat.userData.goboIntensity;
  
  // Inject custom varying into vertex shader
  shader.vertexShader = `
    varying vec3 vCustomWorldPosition;
  ` + shader.vertexShader;
  
  // Assign custom varying in vertex shader (explicitly calculate worldPosition to bypass Three.js defines)
  shader.vertexShader = shader.vertexShader.replace(
    '#include <worldpos_vertex>',
    `#include <worldpos_vertex>
    vCustomWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
  );
  
  // Inject custom uniforms and varying into fragment shader
  shader.fragmentShader = `
    uniform vec2 goboRepeat;
    uniform vec2 goboOffset;
    uniform float goboTime;
    uniform sampler2D goboMap;
    uniform float goboIntensity;
    varying vec3 vCustomWorldPosition;
  ` + shader.fragmentShader;
  
  // Inject custom projected lightMap multiplication at the end with directional masking
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `#include <opaque_fragment>
    // Project lightMap onto the cylinder seamlessly
    float theta = atan(vCustomWorldPosition.x, vCustomWorldPosition.z);
    float u_cyl = theta / (2.0 * 3.14159265) + 0.5;
    float v_cyl = (vCustomWorldPosition.y / 44.0) + 0.5;
    vec2 goboUv = vec2(u_cyl, v_cyl) * goboRepeat + goboOffset;
    vec4 goboVal = texture2D(goboMap, goboUv); // sample from custom goboMap uniform
    
    vec3 goboN = normalize(vec3(vCustomWorldPosition.x, 0.0, vCustomWorldPosition.z));
    vec3 goboL = vec3(0.0, 0.0, 1.0); // straight front: front half lit, back half shadow
    float NdotL = dot(goboN, goboL);
    // Front half: full gobo. Smooth fade over a very wide band. Back: zero.
    float goboMask = smoothstep(-0.4, 0.8, NdotL);

    float currentIntensity = goboIntensity;
    vec3 sunColor = vec3(1.0, 0.88, 0.70);
    float goboLight = smoothstep(0.20, 0.85, goboVal.r);

    // Only add gobo spots on the front face - Three.js PBR handles all shadow/lighting naturally
    gl_FragColor.rgb += (currentIntensity - 1.0) * goboLight * (1.0 - gl_FragColor.rgb) * sunColor * goboMask;
    `
  );
};

function configurePoleMap(tex) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.repeat.set(7, 11);
  // Disable mipmaps on all pole textures - prevents UV seam artifacts at geometry UV boundary
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
}

// Load Diffuse Map
texLoader.load(POLE_TEX, (loaded) => {
  loaded.colorSpace = THREE.SRGBColorSpace;
  configurePoleMap(loaded);
  poleMat.map = loaded;
  poleMat.color.set(0xffffff);
  poleMat.needsUpdate = true;
  renderOnce();
}, undefined, (err) => console.error('[room3d] diffuse failed:', err));

// Load Normal Map (Generated from diffuse for micro-bump 3D depth)
texLoader.load(POLE_NOR, (loaded) => {
  configurePoleMap(loaded);
  poleMat.normalMap = loaded;
  poleMat.needsUpdate = true;
  renderOnce();
}, undefined, (err) => console.error('[room3d] normal failed:', err));

// Load Roughness Map
texLoader.load(POLE_ROUGH, (loaded) => {
  configurePoleMap(loaded);
  poleMat.roughnessMap = loaded;
  poleMat.needsUpdate = true;
  renderOnce();
}, undefined, (err) => console.error('[room3d] roughness failed:', err));

// Load Dappled Light Map (Forest leaf shadows and sunlight spots)
texLoader.load(POLE_LIGHT, (loaded) => {
  loaded.wrapS = THREE.RepeatWrapping;
  loaded.wrapT = THREE.RepeatWrapping;
  loaded.generateMipmaps = false; // disable mipmaps to completely eliminate the WebGL mipmap derivative seam at the wrapping boundary!
  loaded.minFilter = THREE.LinearFilter;
  
  // Assign to custom goboMap uniform instead of native lightMap property
  // This prevents Three.js from defining USE_LIGHTMAP and automatically blending the texture into ambient lighting
  poleMat.userData.goboMap.value = loaded;
  poleLightMap = loaded;
  
  // Assign to any stickers that have already loaded
  stickers.forEach(s => {
    if (s.mesh.material.uniforms && s.mesh.material.uniforms.lightMap) {
      s.mesh.material.uniforms.lightMap.value = loaded;
    }
  });

  poleMat.needsUpdate = true;
  renderOnce();
}, undefined, (err) => console.error('[room3d] gobo failed:', err));

/* ---------- sticker shader: white-key + dilated white die-cut border ---------- */
const stickerVert = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main(){
    vUv = uv;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
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
  uniform sampler2D lightMap;
  uniform vec2 lightMapRepeat;
  uniform vec2 lightMapOffset;
  uniform float lightMapIntensity;
  uniform float time;
  uniform float appear;
  uniform float reflectStrength;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main(){
    // 入场 pop：UV 从贴纸中心向外展开，配合 alpha 淡入
    float sc = mix(0.55, 1.0, min(appear, 1.0));
    vec2 uv = (vUv - 0.5) / sc + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
    vec4 c = texture2D(map, uv);
    if (c.a < 0.005) discard;

    // Cylindrical projection for seamless lightMap alignment with the pole
    float theta = atan(vWorldPos.x, vWorldPos.z);
    float u_cyl = theta / (2.0 * 3.14159265) + 0.5;
    float v_cyl = (vWorldPos.y / 44.0) + 0.5;

    vec2 lightUv = vec2(u_cyl, v_cyl) * lightMapRepeat + lightMapOffset;
    vec4 lightVal = texture2D(lightMap, lightUv);

    vec3 sN = normalize(vec3(vWorldPos.x, 0.0, vWorldPos.z));
    vec3 sL = vec3(0.0, 0.0, 1.0); // same front direction as pole
    float sNdotL = dot(sN, sL);
    // Smooth fade matching the pole
    float goboMask = smoothstep(-0.4, 0.8, sNdotL);

    vec3 sunColor = vec3(1.0, 0.88, 0.70);
    float lightIntensity = smoothstep(0.20, 0.85, lightVal.r);
    float currentIntensity = lightMapIntensity;

    // Only add gobo spots on front face - nothing else changed
    c.rgb += (currentIntensity - 1.0) * lightIntensity * (1.0 - c.rgb) * sunColor * goboMask;

    c.a *= smoothstep(0.0, 0.35, appear);
    // Satin laminate reflection: a broad view-dependent band plus a small
    // directional highlight. The artwork remains legible instead of being
    // uniformly washed out, and the sheen travels as the camera/pole moves.
    if (gl_FrontFacing) {
      vec3 N = normalize(vWorldNormal);
      vec3 V = normalize(cameraPosition - vWorldPos);
      vec3 L = normalize(vec3(-0.35, 0.72, 0.60));
      vec3 H = normalize(V + L);
      float specular = pow(max(dot(N, H), 0.0), 28.0);
      float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      float viewShift = dot(V, normalize(vec3(0.74, 0.06, 0.67))) * 0.30;
      float idleShift = time * 0.035;
      float bandPos = fract(uv.x * 0.74 + uv.y * 0.26 + viewShift + idleShift);
      float filmBand = exp(-pow((bandPos - 0.5) / 0.115, 2.0));
      float fineGlint = exp(-pow((bandPos - 0.52) / 0.035, 2.0));
      float sheen = clamp(specular * 0.90 + filmBand * 0.58 + fineGlint * 0.18 + fresnel * 0.22, 0.0, 0.92);
      vec3 filmColor = mix(vec3(1.0, 0.975, 0.93), vec3(0.86, 0.94, 1.0), 0.42 + 0.18 * sin(time * 0.35));
      c.rgb = mix(c.rgb, filmColor, sheen * reflectStrength);
    }
    // Curled triangles reveal a warm, subtly fibrous paper back.
    if (!gl_FrontFacing) {
      float fibre = 0.018 * sin(vUv.x * 210.0 + vUv.y * 97.0);
      c.rgb = vec3(0.91 + fibre, 0.895 + fibre, 0.86 + fibre);
    }
    gl_FragColor = c;
  }
`;

const shadowFrag = `
  precision highp float;
  uniform sampler2D map;
  uniform float strength;
  uniform float blurPx;
  uniform float appear;
  varying vec2 vUv;

  float rand(vec2 co){
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main(){
    float sum = 0.0;
    float wTot = 0.0;
    
    // Discrete steps can cause banding lines if aligned.
    // Jittering the step size and angle per-pixel completely dissolves these lines.
    vec2 stepSize = vec2(0.0020 * blurPx);
    
    float noise = rand(gl_FragCoord.xy);
    float angle = noise * 6.2831853;
    float s = sin(angle);
    float c = cos(angle);
    mat2 rot = mat2(c, -s, s, c);

    for(int x=-3; x<=3; x++){
      for(int y=-3; y<=3; y++){
        float r = sqrt(float(x*x + y*y));
        if (r > 3.2) continue; // keep the kernel circular
        
        float w = exp(-r * r * 0.40);
        vec2 off = rot * (vec2(float(x), float(y)) * stepSize);
        vec2 uv = vUv + off;
        
        float a = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? 0.0 : texture2D(map, uv).a;
        sum  += a * w;
        wTot += w;
      }
    }
    float a = sum / wTot;
    if (a < 0.01) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, strength * a * smoothstep(0.0, 0.5, appear));
  }
`;

/* ============ INIT ============ */
export function initRoom(opts) {
  container = opts.container;
  modalApi  = opts.modalApi;
  onProgressCb = opts.onProgress || null;
  onReadyCb    = opts.onReady    || null;
  tagEl     = document.getElementById('sticker-tag');

  scene = new THREE.Scene();

  // High-contrast directional and ambient light rig (lower ambient, stronger key)
  scene.add(new THREE.AmbientLight(0xe8ece8, 0.15));
  const key = new THREE.DirectionalLight(0xfff8eb, 1.25);
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

  setupEnvironment();

  buildPole();
  // (per-sticker shadows are created in addStickers)

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  bindEvents();
  // 白屏开场期间不渲染被遮住的场景（开场卡顿来源之一）；
  // 纹理加载回调里的 renderOnce 仍会预热 GPU 上传，startReveal 时 resume()。
  isPaused = true;
  animate();
}

function setupEnvironment() {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  // Blur the background slightly to create a premium depth-of-field bokeh effect
  scene.backgroundBlurriness = 0.08;

  texLoader.load('assets/texture/forest_pan.jpg', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    scene.background = texture;

    const envMap = pmremGenerator.fromEquirectangular(texture).texture;
    scene.environment = envMap;

    pmremGenerator.dispose();
    renderOnce();
  }, undefined, (err) => console.error('[room3d] panorama load failed:', err));
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
  g.setAttribute('uv2', new THREE.BufferAttribute(g.attributes.uv.array, 2));
  pole = new THREE.Mesh(g, poleMat);
  pole.name = 'pole';
  // Rotate 180° so Three.js UV seam (default: front, z=+r) moves to the back (z=−r),
  // co-located with the atan gobo seam — front face is completely clean.
  pole.rotation.y = Math.PI;
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
function buildStickerGeometry(thetaC, yC, S, lift, aspect, marginIn, peelEntry) {
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
      // Sticker-Forge-inspired edge peel, adapted to the shared cylindrical
      // mesh. Only the strip nearest the grabbed edge bends; the remainder
      // stays rigidly attached to the pole.
      const peel = peelEntry ? clamp(peelEntry.peel || 0, 0, 1) : 0;
      if (peel > 0.001 && peelEntry.peelEdge) {
        const edge = peelEntry.peelEdge;
        const horizontal = edge === 'left' || edge === 'right';
        const span = horizontal ? sw : sh;
        const d = edge === 'left' ? fx * sw
          : edge === 'right' ? (1 - fx) * sw
          : edge === 'top' ? fy * sh
          : (1 - fy) * sh;
        const extent = span * (0.055 + 0.40 * peel);
        if (d < extent) {
          const qPeel = extent - d;
          const maxAngle = 0.16 + peel * 2.22;
          const aPeel = (qPeel / extent) * maxAngle;
          const radius = extent / maxAngle;
          const tangentShift = qPeel - radius * Math.sin(aPeel);
          const normalLift = radius * (1 - Math.cos(aPeel));
          if (horizontal) {
            const sign = edge === 'left' ? 1 : -1;
            _surf.pos.x += Math.cos(theta) * tangentShift * sign + _surf.normal.x * normalLift;
            _surf.pos.z += -Math.sin(theta) * tangentShift * sign + _surf.normal.z * normalLift;
          } else {
            _surf.pos.y += tangentShift * (edge === 'top' ? -1 : 1);
            _surf.pos.x += _surf.normal.x * normalLift;
            _surf.pos.z += _surf.normal.z * normalLift;
          }
        }
      }
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
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/* ============ STICKERS ============ */

export function addStickers(list) {
  if (!Array.isArray(list) || !list.length) {
    console.error('[room3d] STICKERS_DATA missing/empty:', list);
    return;
  }
  const isPhone = (container.clientWidth || window.innerWidth) < 720;
  const SIZES = isPhone 
    ? { large: 5.2, normal: 4.3, small: 3.5, tiny: 2.3 } // scaled up for mobile readability
    : { large: 4.0, normal: 3.3, small: 2.7, tiny: 1.65 };

  list.forEach((d, i) => {
    const S = SIZES[d.size] || SIZES.normal;

    const tex = texLoader.load(
      d.sticker,
      (loaded) => {
        const img = loaded.image;
        const entry = stickers.find(s => s.mesh === mesh);
        if (entry) {
          // 1. Determine if the loaded image has transparency
          const maxRayDim = 256;
          const scale = Math.min(1, maxRayDim / Math.max(img.width, img.height));
          const cw = Math.max(1, Math.round(img.width * scale));
          const ch = Math.max(1, Math.round(img.height * scale));
          
          const checkCv = document.createElement('canvas');
          checkCv.width = cw; checkCv.height = ch;
          const checkCtx = checkCv.getContext('2d');
          checkCtx.drawImage(img, 0, 0, cw, ch);
          
          const imgData = checkCtx.getImageData(0, 0, cw, ch).data;
          let hasTransparency = false;
          for (let idx = 3; idx < imgData.length; idx += 4) {
            if (imgData[idx] < 250) {
              hasTransparency = true;
              break;
            }
          }
          
          // 2. Calculate border width B in texture pixels and padding P
          // S is the size of the sticker quad. To unify the visual border width
          // on screen, we scale B inversely with the larger 3D mesh dimension so it remains constant in world space.
          const maxDim = Math.max(img.width, img.height);
          const aspect = img.width / img.height;
          const maxMeshDim = S * Math.max(1, 1 / aspect);
          const W_world = 0.065; // unified border width in world units (adjust to change thickness)
          const B = Math.max(3, Math.round((W_world / maxMeshDim) * maxDim));
          const P = 4; // transparent padding to prevent edge clamping artifacts
          
          // 3. Create the pre-processed canvas
          const canvas = document.createElement('canvas');
          canvas.width = img.width + 2 * B + 2 * P;
          canvas.height = img.height + 2 * B + 2 * P;
          const ctx = canvas.getContext('2d');
          
          const drawOffset = B + P;
          
          if (hasTransparency) {
            // Contour PNG outline: draw silhouette at multiple angles
            const tempCv = document.createElement('canvas');
            tempCv.width = img.width;
            tempCv.height = img.height;
            const tempCtx = tempCv.getContext('2d');
            tempCtx.drawImage(img, 0, 0);
            tempCtx.globalCompositeOperation = 'source-in';
            tempCtx.fillStyle = '#ffffff';
            tempCtx.fillRect(0, 0, img.width, img.height);
            
            const steps = 48;
            for (let j = 0; j < steps; j++) {
              const angle = (j * 2 * Math.PI) / steps;
              const ox = drawOffset + B * Math.cos(angle);
              const oy = drawOffset + B * Math.sin(angle);
              ctx.drawImage(tempCv, ox, oy);
            }
            
            // Draw original image in center
            ctx.drawImage(img, drawOffset, drawOffset);
          } else {
            // Rectangular rounded card (screenshots)
            const r = (d.ipName === 'ciji') ? Math.round(maxDim * 0.08) : Math.round(maxDim * 0.05);
            const w = img.width;
            const h = img.height;
            
            // Draw white border rounded rect (covers outer boundary)
            ctx.fillStyle = '#ffffff';
            drawRoundedRect(ctx, P, P, w + 2*B, h + 2*B, r + B);
            ctx.fill();
            
            // Draw image clipped inside
            ctx.save();
            ctx.beginPath();
            drawRoundedRect(ctx, drawOffset, drawOffset, w, h, r);
            ctx.clip();
            ctx.drawImage(img, drawOffset, drawOffset);
            ctx.restore();
          }
          
          // 4. Update texture source to canvas
          loaded.image = canvas;
          loaded.needsUpdate = true;
          
          // Update entry properties
          entry.aspect = canvas.width / canvas.height;
          
          // 5. Store alpha context for raycasting
          const rayCv = document.createElement('canvas');
          rayCv.width = cw; rayCv.height = ch;
          const rayCtx = rayCv.getContext('2d', { willReadFrequently: true });
          rayCtx.drawImage(canvas, 0, 0, cw, ch);
          entry._alphaCtx = rayCtx;
          
          rebuild(entry);
          if (entry.flat) {
            entry.flat.geometry.dispose();
            entry.flat.geometry = buildFlatGeometry(entry.S, entry.aspect, 0.08);
          }
        }
        renderOnce();
      },
      undefined,
      (err) => console.error('[room3d] texture failed:', d.sticker, err)
    );
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 16;

    const cornerR = (d && d.ipName === 'ciji') ? 0.08 : 0.06;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: tex },
        lightMap: { value: poleLightMap },
        lightMapRepeat: { value: new THREE.Vector2(1.0, 1.0) },
        lightMapOffset: { value: new THREE.Vector2(0, 0) },
        lightMapIntensity: { value: 1.45 },
        time: stickerTimeUniform,
        appear: { value: revealed ? 1 : 0 },
        reflectStrength: { value: 0.72 }
      },
      vertexShader: stickerVert, fragmentShader: stickerFrag,
      transparent: true, depthWrite: false, depthTest: true,
      side: THREE.DoubleSide
    });

    const shMat = new THREE.ShaderMaterial({
      uniforms: {
        map:      { value: tex },
        strength: { value: 0.22 },
        blurPx:   { value: isPhone ? 8.0 : 15.0 },
        appear:   { value: revealed ? 1 : 0 }
      },
      vertexShader: stickerVert, fragmentShader: shadowFrag,
      transparent: true, depthWrite: false, depthTest: true,
      side: THREE.DoubleSide,
      extensions: { derivatives: true }
    });
    const shMesh = new THREE.Mesh(new THREE.BufferGeometry(), shMat);
    shMesh.renderOrder = 1;
    world.add(shMesh);

    const saved = loadPos(d.id);
    const layout = saved ? saved : defaultLayout(d, i);
    const theta = layout.theta;
    const y = layout.y;

    const mesh = new THREE.Mesh(buildStickerGeometry(theta, y, S), mat);
    mesh.renderOrder = 2 + i;
    world.add(mesh);
    const flat = new THREE.Mesh(buildFlatGeometry(S, 1, 0.08), mat);
    flat.visible = false;
    flat.renderOrder = 1000;
    world.add(flat);
    stickers.push({ mesh, flat, shMesh, data: d, theta, y, S, lift: REST_LIFT, peel: 0, peelEdge: null, detached: false, aspect: 1, appear: revealed ? 1 : 0 });
  });
  // Aim the camera at whichever side of the pole has the most stickers, so
  // the first paint never lands on an empty back. During the intro the camera
  // starts slightly rotated away / lower and tweens to this pose on reveal.
  const best = densestPose();
  if (best) {
    _revealPose = best;
    const safe = (typeof container !== 'undefined' && container)
      ? safeViewYRange() : CFG.viewYRange;
    cameraAngle = best.angle - 0.55;
    viewY = clamp(best.y + 2.0, -safe, safe);
  }
  renderOnce();
  stickersAdded = true;
  maybeReveal();
  // Kick off the click-hint loop on first paint (unless the visitor has
  // already tapped a sticker in a previous session).
  scheduleHint(1200);
}

/* ============ CLICK HINT ============ */
// Picks a random sticker currently in the front 180° arc and rocks it
// gently in place to suggest stickers are clickable. Cancels on any user
// gesture; never replays once a sticker has been opened.
function hintDone() {
  try { return localStorage.getItem(HINT_KEY) === '1'; } catch (_) { return false; }
}
function scheduleHint(delayMs) {
  if (hintDone()) return;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(playHint, delayMs);
}
function stopHint() {
  clearTimeout(hintTimer); hintTimer = null;
  if (hintActive) {
    // Snap the borrowed sticker back to its true theta + lift.
    hintActive.theta = hintActive._hintTheta;
    hintActive.lift  = REST_LIFT;
    rebuild(hintActive);
    hintActive = null;
  }
}
function pickHintCandidate() {
  const HALF = Math.PI / 2;
  const front = stickers
    .filter(s => s.mesh.visible)
    .map(s => {
      let d = s.theta - cameraAngle;
      while (d >  Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return { s, d: Math.abs(d) };
    })
    .filter(x => x.d <= HALF)
    .sort((a, b) => a.d - b.d);
  if (!front.length) return null;
  // Bias toward whichever sticker is closest to the camera's current forward
  // direction — pick from the nearest two so it doesn't always wiggle the
  // exact same one when the camera is stationary.
  const pool = front.slice(0, Math.min(2, front.length));
  return pool[Math.floor(Math.random() * pool.length)].s;
}
function playHint() {
  if (hintDone() || rotating || dragging || !revealed) { scheduleHint(2000); return; }
  const s = pickHintCandidate();
  if (!s) { scheduleHint(2000); return; }
  hintActive = s;
  hintActive._hintTheta = s.theta;
  hintStart = performance.now();
  // The animation runs inside the main render loop via stepHint(); see
  // animate(). We only kick off here and queue the next firing.
  scheduleHint(2400);
}
function stepHint() {
  if (!hintActive) return;
  const DURATION = 1100;        // total wiggle length (ms)
  const t = (performance.now() - hintStart) / DURATION;
  if (t >= 1) {
    // Restore and clear; next firing already scheduled in playHint().
    hintActive.theta = hintActive._hintTheta;
    hintActive.lift  = REST_LIFT;
    rebuild(hintActive);
    hintActive = null;
    return;
  }
  // Decaying sine — ~2.5 oscillations, amplitude shrinks to zero.
  const decay = Math.pow(1 - t, 1.2);
  const swing = Math.sin(t * Math.PI * 2 * 2.5) * 0.06 * decay; // radians
  hintActive.theta = hintActive._hintTheta + swing;
  hintActive.lift  = REST_LIFT + 0.18 * decay; // small bob off the surface
  rebuild(hintActive);
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
    entry.theta, entry.y, entry.S, entry.lift, entry.aspect, 0.08, entry
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

// Flat detached representation. It stays tangent to the cylinder at the
// pointer-mapped surface position, so dragging remains predictable while the
// artwork itself is no longer bent around the pole.
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
  g.computeVertexNormals();
  return g;
}
function updateFlatPose(entry) {
  if (!entry.flat) return;
  const radius = CFG.poleRadius + DRAG_LIFT + 0.08;
  entry.flat.position.set(
    Math.sin(entry.theta) * radius,
    entry.y,
    Math.cos(entry.theta) * radius
  );
  entry.flat.rotation.set(0, entry.theta, 0);
}
function detachSticker(entry) {
  if (!entry || entry.detached) return;
  entry.detached = true;
  entry.peel = 1;
  entry._targetPeel = 1;
  entry.mesh.visible = false;
  if (entry.shMesh) entry.shMesh.visible = false;
  updateFlatPose(entry);
  entry.flat.visible = true;
  entry.flat.scale.set(0.94, 0.94, 0.94);
  gsap.to(entry.flat.scale, {
    x: 1, y: 1, z: 1,
    duration: reducedMotion() ? 0 : 0.16,
    ease: 'power2.out',
    overwrite: 'auto'
  });
  if (peelAudioState) emitPeelGrain(peelAudioState.peak, 1, true);
}
// Called every frame for the currently dragged flat sticker.
function syncFlatToView() {
  if (dragging && dragging.flat && dragging.flat.visible) {
    updateFlatPose(dragging);
  }
}

/* ---------- lightweight velocity-reactive peel audio ----------
 * Inspired by Sticker Forge's interaction model, but synthesized locally:
 * no copied samples, no extra download, and silence while the pointer rests.
 */
let peelAudioCtx = null;
let peelNoise = null;
let peelAudioState = null;
function ensurePeelAudio() {
  if (peelAudioCtx) {
    if (peelAudioCtx.state === 'suspended') peelAudioCtx.resume();
    return peelAudioCtx;
  }
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  peelAudioCtx = new AudioContext();
  const length = Math.floor(peelAudioCtx.sampleRate * 0.16);
  peelNoise = peelAudioCtx.createBuffer(1, length, peelAudioCtx.sampleRate);
  const data = peelNoise.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.72 + white * 0.28;
    data[i] = last;
  }
  return peelAudioCtx;
}
function startPeelAudio(e) {
  ensurePeelAudio();
  peelAudioState = { x: e.clientX, y: e.clientY, at: performance.now(), grainAt: 0, peak: 0 };
}
function emitPeelGrain(speed, progress, release) {
  const ctx = ensurePeelAudio();
  if (!ctx || !peelNoise) return;
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  src.buffer = peelNoise;
  src.playbackRate.value = release ? 0.64 : 0.78 + Math.random() * 0.5 + speed * 0.002;
  filter.type = 'bandpass';
  filter.frequency.value = release ? 620 : 900 + progress * 1500 + speed * 3;
  filter.Q.value = release ? 0.7 : 0.45 + progress * 0.7;
  const level = release ? 0.018 : Math.min(0.032, 0.006 + speed * 0.00012);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(level, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (release ? 0.10 : 0.045));
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(now, Math.random() * 0.04, release ? 0.12 : 0.055);
  src.stop(now + 0.14);
}
function playPeelAudio(e, progress) {
  if (!peelAudioState) return;
  const now = performance.now();
  const dt = Math.max(8, now - peelAudioState.at);
  const speed = Math.hypot(e.clientX - peelAudioState.x, e.clientY - peelAudioState.y) / dt * 1000;
  peelAudioState.peak = Math.max(peelAudioState.peak, speed);
  const interval = clamp(92 - speed * 0.16, 24, 90);
  if (speed > 28 && now - peelAudioState.grainAt > interval) {
    emitPeelGrain(speed, progress, false);
    peelAudioState.grainAt = now;
  }
  peelAudioState.x = e.clientX;
  peelAudioState.y = e.clientY;
  peelAudioState.at = now;
}
function finishPeelAudio(detached) {
  if (detached && peelAudioState) emitPeelGrain(peelAudioState.peak, 1, true);
  peelAudioState = null;
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
  el.addEventListener('pointerleave', () => {
    hideTag();
    cancelHoverFocus();
  });
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
    if (alphaAt(entry, h.uv) > 0.05) {
      entry._pickUv = h.uv.clone();
      return entry;
    }
  }
  return null;
}
function onDown(e) {
  // Any pointer activity dismisses the wiggle hint for this session; if the
  // visitor actually opens a sticker we'll persist it (see onUp).
  stopHint();
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const picked = pickStickerByAlpha();
  downPos = { x: e.clientX, y: e.clientY };
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) {}
  if (picked) {
    cancelHoverFocus();
    clearFocusedSticker();
    dragging = picked;
    dragging.mesh.renderOrder = ++topOrder;
    dragging._touch = (e.pointerType === 'touch');
    dragging._targetTheta = picked.theta;
    dragging._targetY = picked.y;
    dragging._targetPeel = PEEL_START;
    dragging.detached = false;
    const uv = picked._pickUv || { x: 0.5, y: 0.5 };
    const edgeDistances = [
      ['left', uv.x], ['right', 1 - uv.x],
      ['bottom', uv.y], ['top', 1 - uv.y]
    ];
    edgeDistances.sort((a, b) => a[1] - b[1]);
    dragging.peelEdge = edgeDistances[0][0];
    startPeelAudio(e);
    const surfaceHit = raycaster.intersectObject(pole, false)[0];
    const hitTheta = surfaceHit ? Math.atan2(surfaceHit.point.x, surfaceHit.point.z) : picked.theta;
    dragging._grabThetaOffset = shortestAngleDelta(picked.theta, hitTheta);
    dragging._grabYOffset = surfaceHit ? picked.y - surfaceHit.point.y : 0;
    gsap.killTweensOf(dragging, 'lift,peel');
    gsap.to(dragging, {
      lift: 0.018,
      peel: PEEL_START,
      duration: reducedMotion() ? 0 : 0.13,
      ease: 'power2.out',
      overwrite: 'auto',
      onUpdate: () => rebuild(dragging),
    });
    dragMoved = false;
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
    viewY = clamp(rotating.baseY + dy * gain, -CFG.viewYRange, CFG.viewYRange);
    return;
  }
  if (!dragging) return;
  const pointerTravel = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  if (pointerTravel > 6) dragMoved = true;
  dragging._targetPeel = clamp(PEEL_START + pointerTravel / PEEL_DISTANCE, PEEL_START, 1);
  playPeelAudio(e, dragging._targetPeel);
  if (!dragging.detached && dragging._targetPeel >= PEEL_DETACH) detachSticker(dragging);
  // Keep the camera still and map the pointer directly onto the pole. The
  // original pickup offset prevents the sticker jumping under the cursor.
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(pole, false)[0];
  if (hit) {
    let hitTheta = Math.atan2(hit.point.x, hit.point.z);
    hitTheta = closestEquivalentAngle(hitTheta, dragging._targetTheta);
    dragging._targetTheta = hitTheta + dragging._grabThetaOffset;
    dragging._targetY = clamp(
      hit.point.y + dragging._grabYOffset,
      -CFG.viewYRange,
      CFG.viewYRange
    );
  }
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
    // Empty-space tap/drag finished without opening anything — resume the
    // hint loop after a quiet beat so it doesn't fire on top of the user.
    scheduleHint(3000);
    return;
  }
  if (!dragging) return;
  const released = dragging;
  if (dragMoved) {
    released.theta = released._targetTheta;
    released.y = released._targetY;
    if (!released.detached) rebuild(released);
    savePos(released.data.id, released.theta, released.y);
  }
  else if (modalApi && modalApi.open) {
    // First sticker tap — dismiss the click-hint loop permanently.
    try { localStorage.setItem(HINT_KEY, '1'); } catch (_) {}
    stopHint();
    modalApi.open(dragging.data);
  }
  // End curl deformation before showing the curved mesh again. Keeping a
  // partly folded subdivided mesh during reattachment can make neighbouring
  // triangles self-intersect and appear as vertical image strips.
  if (released.detached) {
    released.flat.visible = false;
    released.detached = false;
    released.lift = reducedMotion() ? REST_LIFT : 0.12;
  }
  released.peel = 0;
  released._targetPeel = 0;
  released.peelEdge = null;
  rebuild(released);
  // hide the flat preview, restore the curved sticker on the cylinder
  if (released.shMesh) released.shMesh.visible = true;
  released.mesh.visible = true;
  finishPeelAudio(dragMoved);
  gsap.killTweensOf(released, 'lift,peel');
  gsap.to(released, {
    lift: REST_LIFT,
    duration: reducedMotion() ? 0 : 0.24,
    ease: 'back.out(1.35)',
    onUpdate: () => rebuild(released),
    onComplete: () => { released.peelEdge = null; },
  });
  dragging = null;
}




function updateHoverTag(e) {
  if (!tagEl) return;
  if (dragging || rotating) { hideTag(); cancelHoverFocus(); return; }
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const picked = pickStickerByAlpha();
  if (picked) {
    if (focusedSticker && focusedSticker !== picked) clearFocusedSticker();
    if (focusedSticker === picked) updateFocusedTag();
    else showTag(picked.data.name, e.clientX, e.clientY);
    scheduleHoverFocus(picked, e);
  } else if (focusedSticker && focusedPointer
    && Math.hypot(e.clientX - focusedPointer.x, e.clientY - focusedPointer.y) < 52) {
    // Camera motion can move the focused sticker away from a stationary
    // pointer. Keep its anchored label until the user deliberately moves on.
    updateFocusedTag();
  } else {
    clearFocusedSticker();
    hideTag();
    cancelHoverFocus();
  }
}
function scheduleHoverFocus(entry, event) {
  if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
  if (hoverFocusTarget === entry) return;
  cancelHoverFocus();
  hoverFocusTarget = entry;
  const pointerAtIntent = { x: event.clientX, y: event.clientY };
  hoverFocusTimer = setTimeout(() => {
    hoverFocusTimer = null;
    if (dragging || rotating || hoverFocusTarget !== entry) return;
    focusedSticker = entry;
    focusedPointer = pointerAtIntent;
    tagEl.classList.add('anchored');
    const safe = safeViewYRange();
    tweenCameraAngle(entry.theta, 480);
    if (Math.abs(entry.y) <= safe) tweenViewY(entry.y, 480);
  }, HOVER_FOCUS_DELAY);
}
function cancelHoverFocus() {
  clearTimeout(hoverFocusTimer);
  hoverFocusTimer = null;
  hoverFocusTarget = null;
}
function clearFocusedSticker() {
  focusedSticker = null;
  focusedPointer = null;
  if (tagEl) tagEl.classList.remove('anchored');
}
const _tagSurface = { pos: new THREE.Vector3(), normal: new THREE.Vector3() };
const _tagProjected = new THREE.Vector3();
function updateFocusedTag() {
  if (!focusedSticker || !tagEl) return;
  getPoleSurface(focusedSticker.theta, focusedSticker.y, _tagSurface, focusedSticker.lift + 0.04);
  _tagProjected.copy(_tagSurface.pos).project(camera);
  showTag(
    focusedSticker.data.name,
    (_tagProjected.x * 0.5 + 0.5) * container.clientWidth,
    (-_tagProjected.y * 0.5 + 0.5) * container.clientHeight
  );
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

  // One shared time uniform drives every laminate highlight. Pausing the
  // room also pauses the sheen; reduced-motion keeps it view-dependent only.
  stickerTimeUniform.value = reducedMotion() ? 0 : performance.now() * 0.001;

  syncFlatToView();
  stepHint();
  stepAppears();
  stepDragFollow();
  baseCam();
  updateFocusedTag();
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
function shortestAngleDelta(target, start) {
  let delta = target - start;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
function closestEquivalentAngle(angle, reference) {
  return reference + shortestAngleDelta(angle, reference);
}
function stepDragFollow() {
  if (!dragging || dragging._targetTheta == null) return;
  const follow = dragging._touch ? 0.34 : 0.24;
  const dTheta = shortestAngleDelta(dragging._targetTheta, dragging.theta);
  const dY = dragging._targetY - dragging.y;
  const peelGoal = dragging._targetPeel == null ? dragging.peel : dragging._targetPeel;
  const dPeel = peelGoal - dragging.peel;
  const targetLift = 0.018 + Math.max(0, peelGoal - PEEL_START) * DRAG_LIFT;
  const dLift = targetLift - dragging.lift;
  if (Math.abs(dTheta) < 0.0002 && Math.abs(dY) < 0.002
      && Math.abs(dPeel) < 0.002 && Math.abs(dLift) < 0.001) return;
  dragging.theta += dTheta * follow;
  dragging.y += dY * follow;
  dragging.peel += dPeel * (dragging._touch ? 0.30 : 0.23);
  dragging.lift += dLift * 0.20;
  if (dragging.detached) updateFlatPose(dragging);
  else rebuild(dragging);
}
/* ============ INTRO REVEAL（森林揭幕） ============ */
// 全部纹理就绪（manager 空闲）且贴纸已建好后触发一次：
// DOM 遮罩淡出（index.html 的 onReady），场景内相机环绕归位、
// 树影光斑渐亮、贴纸逐个「啪」上电线杆。
function maybeReveal() {
  if (revealed || mgrBusy || !stickersAdded || !scene) return;
  // onReadyCb 只通知页面「资源就绪」；何时揭幕由页面（loader 节奏）决定，
  // 页面再调 playReveal() 同步播放场景动画。没有回调则立即揭幕。
  if (onReadyCb) { onReadyCb(); return; }
  revealed = true;
  startReveal();
}
export function playReveal() {
  if (revealed) return;
  revealed = true;
  startReveal();
}
function startReveal() {
  resume(); // 渲染循环在白屏期间是暂停的，揭幕时恢复
  if (onReadyCb) onReadyCb();
  if (_revealPose) {
    const safe = safeViewYRange();
    tweenCameraAngle(_revealPose.angle, 1800);
    tweenViewY(clamp(_revealPose.y, -safe, safe), 1800);
  }
  // 树影光斑像阳光一样渐亮；GSAP 统一 easing 与中断覆盖。
  const t0 = performance.now();
  const FROM = 0.2, TO = 1.7;
  gsap.fromTo(poleMat.userData.goboIntensity,
    { value: FROM },
    { value: TO, duration: reducedMotion() ? 0 : 1.4,
      ease: 'power3.out', overwrite: 'auto' });
  // 贴纸错峰弹出
  stickers.forEach((s, i) => {
    if (s.appear >= 1) return;
    s._appearAt = t0 + 350 + i * 90;
  });
}
function backOut(k) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}
function stepAppears() {
  if (!revealed) return;
  const now = performance.now();
  let any = false;
  for (const s of stickers) {
    if (s._appearAt == null || s.appear >= 1) continue;
    any = true;
    const k = (now - s._appearAt) / 420;
    if (k < 0) continue;
    const v = k >= 1 ? 1 : backOut(k);
    s.appear = Math.min(1.12, Math.max(0, v));
    if (s.mesh.material.uniforms.appear) s.mesh.material.uniforms.appear.value = s.appear;
    if (s.shMesh && s.shMesh.material.uniforms.appear) s.shMesh.material.uniforms.appear.value = Math.min(1, s.appear);
    if (k >= 1) { s.appear = 1; s.mesh.material.uniforms.appear.value = 1; if (s.shMesh) s.shMesh.material.uniforms.appear.value = 1; }
  }
}
