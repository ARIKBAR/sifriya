import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// seeded random so the facade is the same on every load
let _seed = 11;
const rnd = () => ((_seed = (_seed * 16807) % 2147483647) - 1) / 2147483646;
const rr = (a, b) => a + (b - a) * rnd();

/* ==========================================================================
   MASSING — traced from Herzog & de Meuron's published plans and sections
   (level-2 plan and the long section), checked against aerial photographs.
   1 unit ≈ 8.8 m. +z faces the street, the long west facade.
   Plan: close to a triangle, on a triangular plot. Four facades with sharp
   corners: the long street side (A→B), the short north end (B→C), the long
   back (C→D) and the straight south facade (D→A), which is the highest part.
   Three facades curve gently inward in plan. The roof is concave: it dips
   between the raised south end and the slightly raised north tip.
   ========================================================================== */
const Q = [
  { p: [-8.5, 2.4], h: 3.45, r: 0.12 },  // A  street side, south end
  { p: [6.3, 2.8], h: 2.45, r: 0.16 },   // B  street side, north end
  { p: [8.8, 0.0], h: 2.75, r: 0.1 },    // C  the north tip
  { p: [-3.7, -4.5], h: 3.95, r: 0.06 }, // D  the peak (south end, at the back)
];
const SAG = [0.75, 0.05, 0.85, 0.1];     // sag of each roof edge   A→B, B→C, C→D, D→A
const BOW = [0.32, 0.06, 0.55, 0];       // inward curve of each facade in plan (the south one is straight)
const GH = 1.05;                          // the two glazed ground floors under the stone mass
const OCULUS = { x: -1.3, z: -0.25, r: 2.25, glass: 1.4 }; // skylight inside a ring of PV modules
const SKY_LIGHT = { x: 5.5, z: 0.75, r: 0.26 };

const V2 = (a) => new THREE.Vector2(a[0], a[1]);
const EDGES = Q.map((q, i) => ({ a: V2(q.p), b: V2(Q[(i + 1) % 4].p), ha: q.h, hb: Q[(i + 1) % 4].h, sag: SAG[i] }));

// height of edge i at parameter t
const edgeY = (e, t) => lerp(e.ha, e.hb, t) - e.sag * Math.sin(Math.PI * t);

// roof height anywhere inside the plan: a Coons patch stretched between the
// four sagging edges (so the middle sags with them), plus a slight extra dish.
// (x,z) → (u,v) by inverting the bilinear map of the quad A-B-C-D.
const [qA, qB, qC, qD] = Q.map((q) => q.p);
function invBilinear(x, z) {
  let u = 0.5, v = 0.5;
  for (let it = 0; it < 12; it++) {
    const px = (1 - u) * (1 - v) * qA[0] + u * (1 - v) * qB[0] + u * v * qC[0] + (1 - u) * v * qD[0];
    const pz = (1 - u) * (1 - v) * qA[1] + u * (1 - v) * qB[1] + u * v * qC[1] + (1 - u) * v * qD[1];
    const xu = (1 - v) * (qB[0] - qA[0]) + v * (qC[0] - qD[0]), zu = (1 - v) * (qB[1] - qA[1]) + v * (qC[1] - qD[1]);
    const xv = (1 - u) * (qD[0] - qA[0]) + u * (qC[0] - qB[0]), zv = (1 - u) * (qD[1] - qA[1]) + u * (qC[1] - qB[1]);
    const det = xu * zv - xv * zu, ex = x - px, ez = z - pz;
    u += (ex * zv - ez * xv) / det; v += (xu * ez - zu * ex) / det;
  }
  return [clamp01(u), clamp01(v)];
}
function roofY(x, z) {
  const [u, v] = invBilinear(x, z);
  const [AB, BC, CD, DA] = EDGES;
  const bot = edgeY(AB, u), top = edgeY(CD, 1 - u), left = edgeY(DA, 1 - v), right = edgeY(BC, v);
  const corners = (1 - u) * (1 - v) * Q[0].h + u * (1 - v) * Q[1].h + u * v * Q[2].h + (1 - u) * v * Q[3].h;
  return (1 - v) * bot + v * top + (1 - u) * left + u * right - corners - 0.3 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
}

// outline with (barely) filleted corners and gently bowed facades, resampled evenly
function outline(N = 360) {
  const pts = [];
  const mid = new THREE.Vector2();
  Q.forEach((q) => mid.add(V2(q.p)));
  mid.multiplyScalar(0.25);
  for (let i = 0; i < 4; i++) {
    const prev = V2(Q[(i + 3) % 4].p), cur = V2(Q[i].p), next = V2(Q[(i + 1) % 4].p);
    const r = Q[i].r;
    const a = cur.clone().add(prev.clone().sub(cur).setLength(r));
    const b = cur.clone().add(next.clone().sub(cur).setLength(r));
    for (let k = 0; k <= 8; k++) { // quadratic bezier fillet
      const t = k / 8, u = 1 - t;
      pts.push(new THREE.Vector2(u * u * a.x + 2 * u * t * cur.x + t * t * b.x, u * u * a.y + 2 * u * t * cur.y + t * t * b.y));
    }
    const nextA = next.clone().add(cur.clone().sub(next).setLength(Q[(i + 1) % 4].r));
    const L = b.distanceTo(nextA), n = Math.max(2, Math.round(L * 6));
    // inward normal of this facade
    const nrm = new THREE.Vector2(-(nextA.y - b.y), nextA.x - b.x).normalize();
    if (nrm.dot(mid.clone().sub(b)) < 0) nrm.negate();
    for (let k = 1; k < n; k++) pts.push(b.clone().lerp(nextA, k / n).addScaledVector(nrm, BOW[i] * Math.sin(Math.PI * k / n)));
  }
  const seg = [0];
  for (let i = 1; i <= pts.length; i++) seg.push(seg[i - 1] + pts[i - 1].distanceTo(pts[i % pts.length]));
  const P = seg[seg.length - 1];
  const res = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const d = (i / N) * P;
    while (seg[j + 1] < d) j++;
    const t = (d - seg[j]) / (seg[j + 1] - seg[j] || 1);
    res.push(pts[j].clone().lerp(pts[(j + 1) % pts.length], t));
  }
  const c = new THREE.Vector2();
  res.forEach((p) => c.add(p));
  c.divideScalar(N);
  return { pts: res, c, P };
}

/* ==========================================================================
   FACADE — rounded limestone blocks. Where four rounded corners meet they
   leave a four-pointed gap; along one band of the facade those gaps are
   glazed, and those are the windows.
   ========================================================================== */
function facadeCanvases(P, ppu, TEXH, inBand) {
  const W = Math.round(P * ppu), H = Math.round(TEXH * ppu);
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const col = mk(), emi = mk(), bmp = mk();
  const c = col.getContext('2d'), e = emi.getContext('2d'), b = bmp.getContext('2d');
  c.fillStyle = '#a99d88'; c.fillRect(0, 0, W, H);       // concrete in the joints
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  b.fillStyle = '#1a1a1a'; b.fillRect(0, 0, W, H);

  const sh = 0.1 * ppu;                // course height in px
  const yOf = (wy) => H - (wy - GH) * ppu; // world height → canvas y
  const BAND = [1.5, 1.5 + sh / ppu * 4]; // four courses, three lines of windows
  const stoneFill = () => {
    const t = rnd();
    return `rgb(${lerp(222, 238, t) | 0},${lerp(212, 229, t) | 0},${lerp(190, 210, t) | 0})`;
  };
  const block = (x, y, w, h, r) => {
    c.fillStyle = stoneFill(); c.beginPath(); c.roundRect(x, y, w, h, r); c.fill();
    // a little tooling texture
    for (let k = 0; k < w * h / 90; k++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '130,118,98' : '255,252,244'},${rr(0.05, 0.16)})`; c.fillRect(x + rr(2, w - 2), y + rr(2, h - 2), rr(0.6, 1.8), rr(0.6, 1.8)); }
    const g = 150 + rnd() * 60 | 0;
    b.fillStyle = `rgb(${g},${g},${g})`; b.beginPath(); b.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r); b.fill();
  };

  // courses from the bottom of the stone mass upward
  let wy = GH;
  while (wy < GH + TEXH) {
    const y1 = yOf(wy), y0 = y1 - sh;
    const band = wy >= BAND[0] - 1e-6 && wy < BAND[1] - 1e-6;
    if (band) {
      // aligned square-ish blocks with large radii; gaps at the corner meetings
      const cell = sh;
      // glass first, for the whole course (it sits behind the stones)
      if (wy + sh / ppu < BAND[1] - 1e-6) for (let x = 0; x < W; x += cell) {
        const u = x / W;
        if (!inBand(u) || !inBand((x + cell) / W) || rnd() > 0.62 + 0.3 * Math.sin(u * 61.0)) continue;
        const s = cell * 0.62, jx = x + cell, jy = y0;
        c.fillStyle = '#20262c'; c.fillRect(jx - s / 2, jy - s / 2, s, s);
        e.fillStyle = rnd() < 0.82 ? '#ffcf8f' : '#3a2a16'; e.fillRect(jx - s / 2, jy - s / 2, s, s);
        b.fillStyle = '#000'; b.fillRect(jx - s / 2, jy - s / 2, s, s);
      }
      for (let x = 0; x < W; x += cell) {
        block(x + 0.8, y0 + 0.8, cell - 1.6, sh - 1.6, inBand(x / W) ? cell * 0.44 : sh * 0.3);
      }
    } else {
      // running courses of mixed lengths
      let x = -rr(0, sh * 2);
      while (x < W) {
        const w = sh * [1, 1.35, 1.7, 2.1][(rnd() * 4) | 0];
        block(x + 0.9, y0 + 0.9, w - 1.8, sh - 1.8, sh * 0.32);
        x += w;
      }
    }
    wy += sh / ppu;
  }
  return { col, emi, bmp };
}

function roofCanvas(bb, ppu) {
  const W = Math.round((bb.x1 - bb.x0) * ppu), H = Math.round((bb.z1 - bb.z0) * ppu);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const em = document.createElement('canvas'); em.width = W; em.height = H;
  const c = cv.getContext('2d'), e = em.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const X = (x) => (x - bb.x0) * ppu, Z = (z) => (z - bb.z0) * ppu;
  c.fillStyle = '#ddd3c1'; c.fillRect(0, 0, W, H);
  // paving of the same rounded stone, laid flat
  const t = 0.16 * ppu;
  for (let y = 0; y < H; y += t) for (let x = (y / t) % 2 ? -t / 2 : 0; x < W; x += t * 1.4) {
    const k = rnd();
    c.fillStyle = `rgb(${lerp(214, 232, k) | 0},${lerp(205, 223, k) | 0},${lerp(186, 204, k) | 0})`;
    c.beginPath(); c.roundRect(x + 1, y + 1, t * 1.4 - 2, t - 2, t * 0.3); c.fill();
  }
  // the oculus: a round skylight inside a dark ring of photovoltaic modules
  const ox = X(OCULUS.x), oz = Z(OCULUS.z), R = OCULUS.r * ppu, Rg = OCULUS.glass * ppu;
  c.save(); c.beginPath(); c.arc(ox, oz, R, 0, Math.PI * 2); c.clip();
  c.fillStyle = '#121a26'; c.fillRect(ox - R, oz - R, R * 2, R * 2);
  c.strokeStyle = 'rgba(150,175,205,.2)'; c.lineWidth = 1;
  const cell = 0.15 * ppu;
  for (let x = ox - R; x < ox + R; x += cell * 1.7) { c.beginPath(); c.moveTo(x, oz - R); c.lineTo(x, oz + R); c.stroke(); }
  for (let y = oz - R; y < oz + R; y += cell) { c.beginPath(); c.moveTo(ox - R, y); c.lineTo(ox + R, y); c.stroke(); }
  // the glass itself, a little lighter, with its glazing bars
  const g = c.createRadialGradient(ox - Rg * 0.35, oz - Rg * 0.35, Rg * 0.1, ox, oz, Rg);
  g.addColorStop(0, '#54708e'); g.addColorStop(1, '#2a3d53');
  c.fillStyle = g; c.beginPath(); c.arc(ox, oz, Rg, 0, Math.PI * 2); c.fill();
  c.save(); c.beginPath(); c.arc(ox, oz, Rg, 0, Math.PI * 2); c.clip();
  c.strokeStyle = 'rgba(16,24,36,.55)'; c.lineWidth = 0.02 * ppu;
  for (let x = ox - Rg; x < ox + Rg; x += Rg / 4) { c.beginPath(); c.moveTo(x, oz - Rg); c.lineTo(x + Rg * 0.25, oz + Rg); c.stroke(); }
  c.restore();
  c.restore();
  c.strokeStyle = '#8f877a'; c.lineWidth = 0.04 * ppu; c.beginPath(); c.arc(ox, oz, R, 0, Math.PI * 2); c.stroke();
  // light from the reading hall below, seen at night
  const ge = e.createRadialGradient(ox, oz, 0, ox, oz, Rg);
  ge.addColorStop(0, 'rgba(255,214,160,.75)'); ge.addColorStop(0.8, 'rgba(255,214,160,.5)'); ge.addColorStop(1, 'rgba(255,214,160,0)');
  e.fillStyle = ge; e.beginPath(); e.arc(ox, oz, Rg, 0, Math.PI * 2); e.fill();
  // small round skylight near the narrow end
  const sx = X(SKY_LIGHT.x), sz = Z(SKY_LIGHT.z), sr = SKY_LIGHT.r * ppu;
  c.fillStyle = '#b8b2a6'; c.beginPath(); c.arc(sx, sz, sr, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#3d4650'; c.beginPath(); c.arc(sx, sz, sr * 0.72, 0, Math.PI * 2); c.fill();
  e.fillStyle = '#ffd7a0'; e.beginPath(); e.arc(sx, sz, sr * 0.72, 0, Math.PI * 2); e.fill();
  return { cv, em };
}

function glassCanvas(W = 1024, H = 128) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const em = document.createElement('canvas'); em.width = W; em.height = H;
  const c = cv.getContext('2d'), e = em.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#59636b'); g.addColorStop(0.5, '#2b3237'); g.addColorStop(1, '#1d2125');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  // warm interior: shelving, ceiling lights
  for (let i = 0; i < 70; i++) {
    const x = rr(0, W), w = rr(10, 40), y = rr(H * 0.42, H * 0.7), h = rr(10, H * 0.32);
    e.fillStyle = `rgba(255,${rr(170, 210) | 0},120,${rr(0.25, 0.6)})`; e.fillRect(x, y, w, h);
  }
  e.fillStyle = 'rgba(255,225,180,.75)'; for (let x = 6; x < W; x += 22) e.fillRect(x, H * 0.12, 8, 2);
  // mullions + transom
  c.fillStyle = '#b9b1a2'; e.fillStyle = '#000';
  for (let x = 0; x < W; x += 64) { c.fillRect(x, 0, 4, H); e.fillRect(x, 0, 4, H); }
  c.fillRect(0, 0, W, 5); c.fillRect(0, H * 0.1, W, 2);
  return { cv, em };
}

function groundCanvas(S = 2048) {
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.fillStyle = '#d6cfc1'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    c.fillStyle = `rgba(${rnd() < 0.5 ? '118,106,86' : '246,240,228'},${rr(0.03, 0.1)})`;
    c.fillRect(rr(0, S), rr(0, S), rr(1, 5), rr(1, 5));
  }
  return cv;
}

function tex(cv, srgb = true, wrap = THREE.RepeatWrapping) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = wrap;
  return t;
}

/* ==========================================================================
   CAMERA — few keyframes, held still while a chapter is read, moved along a
   smooth spline between chapters. The look target barely moves, so the
   building never swings across the screen.
   ========================================================================== */
const K = (at, cam, look, o = {}) => ({ at, cam: new THREE.Vector3(...cam), look: new THREE.Vector3(...look), fov: 34, shell: 1, wire: 0, night: 0.05, under: 0, ...o });
const TRACKS = {
  monolith: [
    K(0.0, [5.6, 0.85, 12.6], [1.9, 1.25, 1.4]),
    K(0.14, [4.6, 0.95, 13.0], [1.7, 1.3, 1.3]),
    K(0.32, [-9.5, 2.3, 17.5], [-0.6, 1.75, -0.4]),
    K(0.44, [-10.6, 2.7, 16.9], [-0.6, 1.8, -0.5]),
    K(0.62, [-4.4, 12.6, 15.6], [0.1, 1.5, -0.7]),
    K(0.72, [-2.6, 13.2, 15.0], [0.4, 1.5, -0.7]),
    K(0.9, [17.4, 3.3, 11.6], [5.0, 1.7, 0.8], { night: 0.75 }),
    K(1.0, [18.0, 2.8, 10.4], [5.2, 1.65, 0.8], { night: 1 }),
  ],
};
for (const tr of Object.values(TRACKS)) {
  tr.camCurve = new THREE.CatmullRomCurve3(tr.map((k) => k.cam), false, 'centripetal');
  tr.lookCurve = new THREE.CatmullRomCurve3(tr.map((k) => k.look), false, 'centripetal');
}

function sample(track, p) {
  const n = track.length - 1;
  let i = 0;
  while (i < n - 1 && p > track[i + 1].at) i++;
  const a = track[i], b = track[i + 1];
  const tl = clamp01((p - a.at) / (b.at - a.at));
  const t = lerp(tl, smooth(tl), 0.7);
  const u = (i + t) / n;
  return {
    cam: track.camCurve.getPoint(u), look: track.lookCurve.getPoint(u),
    fov: lerp(a.fov, b.fov, t), shell: lerp(a.shell, b.shell, t), wire: lerp(a.wire, b.wire, t),
    night: lerp(a.night, b.night, t), under: lerp(a.under, b.under, t),
  };
}

/* ========================================================================== */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const DPR = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(DPR);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.05, 500);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  // ---------- sky
  const skyU = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bot: { value: new THREE.Color() } };
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(300, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h>0. ? mix(mid, top, pow(clamp(h*1.6,0.,1.),.7)) : mix(mid, bot, clamp(-h*5.,0.,1.)); gl_FragColor = vec4(c,1.); }',
    })
  ));
  scene.fog = new THREE.Fog(0xd5dbe0, 40, 160);

  // ---------- light: a high Jerusalem sun from the south-west
  const hemi = new THREE.HemisphereLight(0xdfe8f3, 0x8c7f69, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
  sun.position.set(-12, 18, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // ---------- building
  const { pts, c, P } = outline(360);
  const N = pts.length;
  const building = new THREE.Group();
  scene.add(building);
  const fadeMats = [];

  // which parts of the perimeter carry the band of windows
  const arc = [0];
  for (let i = 1; i <= N; i++) arc.push(arc[i - 1] + pts[i - 1].distanceTo(pts[i % N]));
  const bandAt = (u) => {
    const i = Math.min(N - 1, Math.floor(u * N));
    const p = pts[i];
    if (p.y > 1.9 && p.x > -2.2) return true;       // street side, the northern half
    if (p.x > 6.2) return true;                      // the north end
    if (p.y < 0 && p.x > 3.2) return true;           // the back, near the north tip
    return false;
  };
  const maxTex = renderer.capabilities.maxTextureSize;
  const small = Math.min(innerWidth, innerHeight) < 700;
  const ppu = Math.min(small ? 100 : 180, Math.floor(Math.min(maxTex, 8192) / P));
  const TEXH = 3.0;
  const fac = facadeCanvases(P, ppu, TEXH, bandAt);
  const clampT = (cv, s) => tex(cv, s, THREE.ClampToEdgeWrapping);
  const stoneMat = new THREE.MeshStandardMaterial({
    map: clampT(fac.col), emissiveMap: clampT(fac.emi), bumpMap: clampT(fac.bmp, false), bumpScale: 1.4,
    emissive: new THREE.Color(0xffc27a), emissiveIntensity: 0, roughness: 0.86, metalness: 0,
    transparent: true, side: THREE.DoubleSide, envMapIntensity: 0.4,
  });
  fadeMats.push(stoneMat);
  // walls
  {
    const M = 20, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const p = pts[i % N], top = roofY(p.x, p.y);
      for (let j = 0; j <= M; j++) {
        const y = lerp(GH, top, j / M);
        pos.push(p.x, y, p.y);
        uv.push(arc[i] / P, (y - GH) / TEXH);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j, b = (i + 1) * (M + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const walls = new THREE.Mesh(g, stoneMat);
    walls.castShadow = walls.receiveShadow = true;
    building.add(walls);
  }
  // roof (saddle) — radial mesh from the centroid, height from roofY
  const bb = { x0: -9.2, x1: 9.4, z0: -5.0, z1: 3.4 };
  const rc = roofCanvas(bb, 130);
  const roofMat = new THREE.MeshStandardMaterial({ map: tex(rc.cv), emissiveMap: tex(rc.em), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.82, transparent: true, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  fadeMats.push(roofMat);
  {
    const S = 30, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const p = pts[i % N];
      for (let j = 0; j <= S; j++) {
        const s = Math.pow(j / S, 0.85);
        const x = lerp(c.x, p.x, s), z = lerp(c.y, p.y, s);
        pos.push(x, j === S ? roofY(p.x, p.y) : roofY(x, z), z);
        uv.push((x - bb.x0) / (bb.x1 - bb.x0), 1 - (z - bb.z0) / (bb.z1 - bb.z0));
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < S; j++) {
      const a = i * (S + 1) + j, b = (i + 1) * (S + 1) + j;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const roof = new THREE.Mesh(g, roofMat);
    roof.castShadow = roof.receiveShadow = true;
    building.add(roof);
  }
  // soffit
  const soffitMat = new THREE.MeshStandardMaterial({ color: 0xd8cfbf, roughness: 0.9, transparent: true, side: THREE.DoubleSide });
  fadeMats.push(soffitMat);
  {
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map((p) => p.clone())), 1);
    g.rotateX(Math.PI / 2);
    g.translate(0, GH, 0);
    const m = new THREE.Mesh(g, soffitMat);
    m.receiveShadow = true;
    building.add(m);
  }
  // recessed glass ground floor + stone-clad piers
  const inner = (() => {
    // the glazed floors are much smaller than the stone mass: it cantilevers far beyond them at both ends
    let q = pts.filter((_, i) => i % 3 === 0).map((p) => new THREE.Vector2(c.x + (p.x - c.x) * 0.76 + 0.5, c.y + (p.y - c.y) * 0.84));
    for (let it = 0; it < 3; it++) { // chaikin, rounds off the tips
      const o = [];
      for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; o.push(a.clone().lerp(b, 0.25), a.clone().lerp(b, 0.75)); }
      q = o;
    }
    return q;
  })();
  const gl = glassCanvas();
  const glassTex = tex(gl.cv), glassEm = tex(gl.em);
  const glassMat = new THREE.MeshStandardMaterial({ map: glassTex, emissiveMap: glassEm, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.08, metalness: 0.1, envMapIntensity: 1.2 });
  {
    const pos = [], uv = [], idx = [];
    let L = 0;
    for (let i = 0; i <= inner.length; i++) {
      const p = inner[i % inner.length];
      if (i) L += p.distanceTo(inner[i - 1]);
      pos.push(p.x, 0, p.y, p.x, GH, p.y);
      uv.push(L / 6, 0, L / 6, 1);
    }
    for (let i = 0; i < inner.length; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    glassMat.side = THREE.DoubleSide;
    building.add(new THREE.Mesh(g, glassMat));
    glassTex.wrapT = glassEm.wrapT = THREE.ClampToEdgeWrapping;
  }
  const pierMat = new THREE.MeshStandardMaterial({ color: 0xe0d6c3, roughness: 0.85, transparent: true });
  fadeMats.push(pierMat);
  {
    let acc = 0;
    for (let i = 1; i < inner.length; i++) {
      acc += inner[i].distanceTo(inner[i - 1]);
      if (acc < 1.55) continue;
      acc = 0;
      const p = inner[i], q = inner[(i + 1) % inner.length];
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.26, GH, 0.2), pierMat);
      m.position.set(p.x, GH / 2, p.y);
      m.rotation.y = -Math.atan2(q.y - p.y, q.x - p.x);
      m.castShadow = m.receiveShadow = true;
      building.add(m);
    }
  }
  // the floor inside the glass (so shadows read under the overhang)
  {
    const g = new THREE.ShapeGeometry(new THREE.Shape(inner), 1);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8d8170, roughness: 1, side: THREE.DoubleSide }));
    m.position.y = 0.01; m.receiveShadow = true;
    building.add(m);
  }

  // line drawing (the intro "sketch" state)
  const lineMat = new THREE.LineBasicMaterial({ color: 0x2b2722, transparent: true, opacity: 0, depthWrite: false });
  {
    const v = [];
    const seg = (a, b) => v.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const V = (p, y) => new THREE.Vector3(p.x, y, p.y);
    for (let i = 0; i < N; i++) {
      const p = pts[i], q = pts[(i + 1) % N];
      seg(V(p, GH), V(q, GH));
      seg(V(p, roofY(p.x, p.y)), V(q, roofY(q.x, q.y)));
      if (i % 18 === 0) seg(V(p, GH), V(p, roofY(p.x, p.y)));
      for (const s of [0.35, 0.7]) {
        const a = c.clone().lerp(p, s), b = c.clone().lerp(q, s);
        seg(V(a, roofY(a.x, a.y)), V(b, roofY(b.x, b.y)));
      }
    }
    for (let i = 0; i < inner.length; i++) { const p = inner[i], q = inner[(i + 1) % inner.length]; seg(V(p, 0.02), V(q, 0.02)); }
    for (let k = 0; k < 64; k++) { // oculus
      const a = (k / 64) * Math.PI * 2, b = ((k + 1) / 64) * Math.PI * 2;
      const pa = new THREE.Vector2(OCULUS.x + Math.cos(a) * OCULUS.r, OCULUS.z + Math.sin(a) * OCULUS.r);
      const pb = new THREE.Vector2(OCULUS.x + Math.cos(b) * OCULUS.r, OCULUS.z + Math.sin(b) * OCULUS.r);
      seg(V(pa, roofY(pa.x, pa.y) + 0.01), V(pb, roofY(pb.x, pb.y) + 0.01));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    building.add(new THREE.LineSegments(g, lineMat));
  }

  // ---------- site, kept abstract like an architect's model: pale ground, the street, pale trees
  const groundTex = tex(groundCanvas());
  groundTex.repeat.set(60, 60);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(300, 72), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.96 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const site = new THREE.Group();
  scene.add(site);
  {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(240, 2.2), new THREE.MeshStandardMaterial({ color: 0xbab2a3, roughness: 0.95 }));
    road.rotation.x = -Math.PI / 2; road.rotation.z = -0.03; road.position.set(0, 0.005, 6.4);
    road.receiveShadow = true;
    site.add(road);
    const nT = 120;
    const cyp = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: 0xcdc6b7, roughness: 1 }), nT);
    const pine = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 2), new THREE.MeshStandardMaterial({ color: 0xd3ccbd, roughness: 1 }), nT);
    cyp.castShadow = pine.castShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    let ic = 0, ip = 0, guard = 0;
    const inside = (x, z) => x > -9.9 && x < 10.1 && z > -5.7 && z < 4.0;
    while ((ic < nT || ip < nT) && guard++ < 8000) {
      const x = rr(-34, 34), z = rr(-28, 3);
      if (inside(x, z)) continue;
      if (x > 9.8 && z > -7) continue;               // keep the view of the north end clear
      q.setFromEuler(new THREE.Euler(0, rr(0, 6.28), 0));
      if (rnd() < 0.5 && ic < nT) {
        const h = rr(0.8, 1.5);
        m.compose(new THREE.Vector3(x, h * 0.22 * 2.8, z), q, new THREE.Vector3(0.75, h * 2.8, 0.75)); cyp.setMatrixAt(ic++, m);
      } else if (ip < nT) {
        const k = rr(0.5, 1.0);
        m.compose(new THREE.Vector3(x, 0.55 * k + 0.35, z), q, new THREE.Vector3(k * 1.15, k * 0.75, k * 1.15)); pine.setMatrixAt(ip++, m);
      }
    }
    cyp.count = ic; pine.count = ip;
    site.add(cyp, pine);
  }

  // ---------- post
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(DPR);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  // ambient occlusion grounds the model the way a photographed maquette is grounded (desktop only)
  if (!small) {
    const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
    gtao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    composer.addPass(gtao);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.4, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- state
  let target = sample(TRACKS.monolith, 0);
  const cur = { cam: target.cam.clone(), look: target.look.clone(), fov: 34, shell: 0, wire: 1, night: 0.05, under: 0 };
  let intro = 0, introStart = -1;
  const mouse = new THREE.Vector2(), mouseS = new THREE.Vector2();
  addEventListener('pointermove', (e) => { mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1); });

  const C = {
    day: { top: new THREE.Color('#9fb4c9'), mid: new THREE.Color('#e6e6e2'), bot: new THREE.Color('#d6cfc1'), fog: new THREE.Color('#e1e0db') },
    night: { top: new THREE.Color('#050a17'), mid: new THREE.Color('#2a3550'), bot: new THREE.Color('#12141a'), fog: new THREE.Color('#1c2232') },
    under: { top: new THREE.Color('#070707'), mid: new THREE.Color('#0d0c0b'), bot: new THREE.Color('#070707'), fog: new THREE.Color('#0b0a09') },
  };
  const tmp = new THREE.Color(), sunDay = new THREE.Color('#fff1dc'), sunNight = new THREE.Color('#8ea6d8');
  const mix3 = (k, n, u) => tmp.copy(C.day[k]).lerp(C.night[k], n).lerp(C.under[k], u);

  // hotspots
  const hotEls = [];
  const HOTS = [
    { p: new THREE.Vector3(2.2, 0.55, 2.1), t: 'קומות הזכוכית' },
    { p: new THREE.Vector3(Q[3].p[0], Q[3].h, Q[3].p[1]), t: 'הקצה הדרומי, החלק הגבוה' },
    { p: new THREE.Vector3(OCULUS.x, roofY(OCULUS.x, OCULUS.z), OCULUS.z), t: 'צוהר וטבעת סולארית' },
    { p: new THREE.Vector3(7.55, 1.72, 1.4), t: 'חלונות בעומק האבן' },
  ];
  let hotIdx = -1;
  const hotLayer = document.querySelector('.hotspots');
  if (hotLayer) HOTS.forEach((h) => {
    const el = document.createElement('div');
    el.className = 'hot';
    el.innerHTML = `<span class="hot__dot"></span><span class="hot__txt">${h.t}</span>`;
    hotLayer.appendChild(el); hotEls.push(el);
  });

  let active = false, last = performance.now(), time = 0;
  const v3 = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
    if (!active) return;
    if (introStart >= 0) intro = clamp01((now - introStart) / 2600);
    // soft follow: the camera trails the scroll position by ~0.25 s
    const k = 1 - Math.pow(0.012, dt);
    cur.cam.lerp(target.cam, k); cur.look.lerp(target.look, k);
    cur.fov = lerp(cur.fov, target.fov, k);
    for (const key of ['shell', 'wire', 'night', 'under']) cur[key] = lerp(cur[key], target[key], k);
    mouseS.lerp(mouse, 1 - Math.pow(0.1, dt));
    const shell = cur.shell * smooth(clamp01((intro - 0.3) / 0.7));
    const wire = Math.max(cur.wire, 1 - smooth(clamp01((intro - 0.4) / 0.6)));

    // camera (pulled back on portrait screens so the building still fits)
    const asp = innerWidth / innerHeight;
    const distF = asp < 1.2 ? lerp(1, Math.min(2.1, Math.pow(1.2 / asp, 0.8)), 1 - cur.under * 0.7) : 1;
    v3.copy(cur.cam).sub(cur.look).multiplyScalar(distF).add(cur.look);
    camera.position.copy(v3);
    camera.lookAt(cur.look);
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    const amp = 0.16 * (1 - cur.under * 0.5);
    camera.position.addScaledVector(right, mouseS.x * amp).addScaledVector(up, -mouseS.y * amp * 0.5);
    camera.lookAt(cur.look);
    if (Math.abs(camera.fov - cur.fov) > 0.01) { camera.fov = cur.fov; camera.updateProjectionMatrix(); }

    // materials
    fadeMats.forEach((m) => { m.opacity = shell; m.depthWrite = shell > 0.98; });
    glassMat.opacity = Math.max(shell, 0.2); glassMat.transparent = shell < 0.98;
    lineMat.opacity = wire * 0.7;
    const n = cur.night;
    stoneMat.emissiveIntensity = lerp(0, 2.2, smooth(clamp01((n - 0.25) / 0.75)));
    roofMat.emissiveIntensity = lerp(0, 0.22, n);
    glassMat.emissiveIntensity = lerp(0.18, 1.4, n);

    // world colours
    skyU.top.value.copy(mix3('top', n, cur.under));
    skyU.mid.value.copy(mix3('mid', n, cur.under));
    skyU.bot.value.copy(mix3('bot', n, cur.under));
    scene.fog.color.copy(mix3('fog', n, cur.under));
    scene.fog.near = lerp(40, 8, cur.under); scene.fog.far = lerp(160, 60, cur.under);
    sun.intensity = lerp(3.0, 0.03, n) * (1 - cur.under);
    sun.color.copy(sunDay).lerp(sunNight, n);
    hemi.intensity = lerp(1.0, 0.09, n) * (1 - cur.under * 0.7);
    scene.environmentIntensity = lerp(0.35, 0.02, n);
    renderer.toneMappingExposure = lerp(1.0, 0.95, n);
    bloom.strength = lerp(0.12, 0.75, Math.max(n, cur.under));

    // hotspots
    hotEls.forEach((el, i) => {
      const on = i === hotIdx && cur.under < 0.1 && shell > 0.9;
      el.classList.toggle('is-on', on);
      if (!on) return;
      v3.copy(HOTS[i].p).project(camera);
      el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * innerWidth - 6}px, ${(-v3.y * 0.5 + 0.5) * innerHeight - 6}px)`;
    });

    composer.render();
  }
  requestAnimationFrame(frame);

  // on portrait screens the chapter card covers the lower half, so frame the building higher
  const frameOffset = () => {
    if (innerWidth / innerHeight < 0.9) camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.16, innerWidth, innerHeight);
    else camera.clearViewOffset();
  };
  frameOffset();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; frameOffset(); camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
  });

  renderer.compile(scene, camera);

  return {
    debug: () => ({ cur, target, cam: camera.position.clone() }),
    playIntro() { if (introStart < 0 && intro < 1) introStart = performance.now(); },
    skipIntro() { intro = 1; introStart = -1; },
    set(track, p) { target = sample(TRACKS[track], clamp01(p)); },
    jump() { cur.cam.copy(target.cam); cur.look.copy(target.look); for (const key of ['shell', 'wire', 'night', 'under']) cur[key] = target[key]; },
    setHot(i) { hotIdx = i; if (i < 0) hotEls.forEach((el) => el.classList.remove('is-on')); },
    setActive(v) {
      active = v;
      if (v) last = performance.now();
      else hotEls.forEach((el) => el.classList.remove('is-on'));
    },
  };
}
