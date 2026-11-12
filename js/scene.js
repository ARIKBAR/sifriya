import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
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
   (level-2 plan and the long section), checked against aerial photographs
   and fitted to the real footprint on the map: 1 unit ≈ 8.9 m, and north
   points to (x, z) ≈ (-0.75, -0.66).
   Plan: close to a triangle, on a triangular plot. Four facades with sharp
   corners: the long side on Ruppin (A→B, +z, faces south-west), the short
   southern tip facing the Israel Museum (B→C), the long back on Kaplan (C→D)
   and the north end next to the Ministry of Finance (D→A).
   As the architects describe it, the east, west and north facades curve
   gently inward in plan and the south one is straight; both narrow ends are
   raised and the concave roof dips between them. In aerial photographs the
   north end is the higher of the two.
   ========================================================================== */
const Q = [
  { p: [-8.5, 2.4], h: 3.45, r: 0.12 },  // A  Ruppin side, north end
  { p: [6.3, 2.8], h: 2.45, r: 0.16 },   // B  Ruppin side, south end
  { p: [8.8, 0.0], h: 2.75, r: 0.1 },    // C  the southern tip
  { p: [-3.7, -4.5], h: 3.95, r: 0.06 }, // D  the peak (north end, at the back)
];
const SAG = [0.75, 0.05, 0.85, 0.1];     // sag of each roof edge   A→B, B→C, C→D, D→A
const BOW = [0.32, 0, 0.55, 0.2];        // inward curve of each facade in plan (the south one is straight)
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

// the base the building stands on: a round piece of the city (see the SITE block below)
const SITE = { x: 3, z: -4, r: 30, street: -0.06, plinth: 1.1 };
const FOG = [26, 150];
const DOF = { aperture: 0.00044, maxblur: 0.0026 };   // blur radius per unit of distance, and its limit (fractions of the frame width)

// The scene is drawn into its own multisampled buffer and copied from there into the composer,
// so only this one pass pays for anti-aliasing and every later pass works on plain buffers.
class SceneMsaaPass extends Pass {
  constructor(scene, camera, samples) {
    super();
    this.scene = scene; this.camera = camera; this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.target.texture } }, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D( tDiffuse, vUv ); }',
    }));
  }
  setSize(w, h) { this.target.setSize(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.target.dispose(); this.quad.dispose(); }
}

// Depth of field in one pass. It reads the depth the occlusion pass has already drawn, leaves
// the sharp zone untouched and spends its samples only where the picture is out of focus.
const DofShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, focus: { value: 12 }, range: { value: 5 },
    aperture: { value: 0 }, maxblur: { value: DOF.maxblur }, near: { value: 0.05 }, far: { value: 500 }, aspect: { value: 1 },
    texel: { value: new THREE.Vector2(0.001, 0.001) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
  fragmentShader: `
    #include <common>
    #include <packing>
    uniform sampler2D tDiffuse; uniform sampler2D tDepth;
    uniform float focus; uniform float range; uniform float aperture; uniform float maxblur; uniform float near; uniform float far; uniform float aspect;
    uniform vec2 texel;
    varying vec2 vUv;
    const int TAPS = 14;
    // how far outside the sharp zone the surface at uv lies (viewZ is negative in front of the camera)
    float away( vec2 uv ) { return max( 0.0, abs( focus + perspectiveDepthToViewZ( texture2D( tDepth, uv ).x, near, far ) ) - range ); }
    void main() {
      // the depth is coarser than the picture, so take the sharpest of the neighbours: an outline of
      // something in focus must never be smeared, a thin rim of sharp background behind it does no harm
      float d = min( away( vUv ), min( min( away( vUv + texel ), away( vUv - texel ) ), min( away( vUv + vec2( texel.x, -texel.y ) ), away( vUv + vec2( -texel.x, texel.y ) ) ) ) );
      float r = min( d * aperture, maxblur );
      vec4 c = texture2D( tDiffuse, vUv );
      if ( r > 0.0003 ) {
        // a spiral of samples, turned by a different angle at every pixel so that no pattern shows
        float turn = 6.2831853 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
        for ( int i = 1; i < TAPS; i ++ ) {
          float t = float( i );
          float a = t * 2.39996323 + turn;
          c += texture2D( tDiffuse, vUv + vec2( cos( a ), sin( a ) * aspect ) * ( r * sqrt( t / float( TAPS ) ) ) );
        }
        c /= float( TAPS );
      }
      gl_FragColor = c;
    }`,
};

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
  let DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(DPR);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;       // nothing that casts a shadow ever moves
  renderer.shadowMap.needsUpdate = true;

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
  scene.fog = new THREE.Fog(0xe9e7e2, FOG[0], FOG[1]);

  // ---------- light: an afternoon sun from the west, over the whole base
  const small = Math.min(innerWidth, innerHeight) < 700;
  const hemi = new THREE.HemisphereLight(0xdfe8f3, 0x8c7f69, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
  sun.target.position.set(SITE.x, 0, SITE.z);
  sun.position.copy(sun.target.position).addScaledVector(new THREE.Vector3(-12, 18, 12).normalize(), 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 2048 : 4096, small ? 2048 : 4096);
  Object.assign(sun.shadow.camera, { left: -SITE.r - 1, right: SITE.r + 1, top: SITE.r + 1, bottom: -SITE.r - 1, near: 20, far: 110 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);
  // evening: warm light from the glazed floors falls on the ground around the building
  const lamps = [[-3.6, -0.6], [1.6, 0.3], [5.6, 0.7]].map(([x, z]) => {
    const l = new THREE.PointLight(0xffc48a, 0, 12, 1.7);
    l.position.set(x, 0.6, z);
    scene.add(l);
    return l;
  });

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
    if (p.y > 1.9 && p.x > -2.2) return true;       // Ruppin side, the southern half
    if (p.x > 6.2) return true;                      // the southern tip
    if (p.y < 0 && p.x > 3.2) return true;           // the back, near the tip
    return false;
  };
  const maxTex = renderer.capabilities.maxTextureSize;
  const ppu =Math.min(small ? 100 : 180, Math.floor(Math.min(maxTex, 8192) / P));
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
      idx.push(a, b, a + 1, a + 1, b, b + 1);       // facing outward: the depth and occlusion passes draw front faces only
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
      idx.push(a, a + 1, b, b, a + 1, b + 1);       // facing up
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
    for (let i = 0; i < inner.length; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
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

  /* ==========================================================================
     SITE — a round piece of the real city around the building, made the way a
     card model is made: the streets one layer down, the plots, a thinner card
     for planted ground, plain blocks for the neighbours. The plan comes from
     OpenStreetMap, fitted to the model (tools/site_data.py); the soft shading
     on it is baked, once for the base and once for the library itself, so the
     library's own shadow can arrive together with the building.
     ========================================================================== */
  const site = new THREE.Group();
  scene.add(site);
  const siteU = {
    tAo: { value: null }, tLib: { value: null }, uLib: { value: new THREE.Vector4(0, 0, 1, 1) },
    uAo: { value: 0.9 }, uLibAo: { value: 0 },
  };
  const floorMat = new THREE.MeshBasicMaterial({ color: 0xe3e0d9 });
  {
    // the studio floor the base stands on, with the soft shadow of the base on it
    const y0 = SITE.street - SITE.plinth;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(600, 96), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(SITE.x, y0, SITE.z);
    site.add(floor);
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const c = cv.getContext('2d'), g = c.createRadialGradient(256, 256, 256 * 0.5, 256, 256, 256);
    g.addColorStop(0, 'rgba(52,47,40,.6)'); g.addColorStop(0.16, 'rgba(52,47,40,.42)'); g.addColorStop(0.45, 'rgba(52,47,40,.14)'); g.addColorStop(1, 'rgba(52,47,40,0)');
    c.fillStyle = g; c.fillRect(0, 0, 512, 512);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(SITE.r * 1.9, 96), new THREE.MeshBasicMaterial({ map: tex(cv, true, THREE.ClampToEdgeWrapping), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(SITE.x, y0 + 0.01, SITE.z);
    site.add(shadow);
    // the base itself: a thick disc of stacked boards
    const lc = document.createElement('canvas'); lc.width = 4; lc.height = 256;
    const l = lc.getContext('2d'), nL = 9;
    for (let i = 0; i < nL; i++) {
      l.fillStyle = i % 2 ? '#d7d1c5' : '#cec8bb'; l.fillRect(0, (i * 256) / nL, 4, 256 / nL + 1);
      l.fillStyle = 'rgba(96,88,74,.4)'; l.fillRect(0, (i * 256) / nL, 4, 1.4);
    }
    const side = new THREE.Mesh(new THREE.CylinderGeometry(SITE.r, SITE.r, SITE.plinth, 256, 1, true), new THREE.MeshStandardMaterial({ map: tex(lc, true, THREE.ClampToEdgeWrapping), roughness: 0.95 }));
    side.position.set(SITE.x, SITE.street - SITE.plinth / 2, SITE.z);
    side.receiveShadow = true;
    site.add(side);
  }
  // fine paper grain, so the cards keep a surface when the camera is close to them
  const grain = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const c = cv.getContext('2d'), im = c.createImageData(256, 256);
    for (let i = 0; i < im.data.length; i += 4) { const v = 128 + (rnd() - 0.5) * 150; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    c.putImageData(im, 0, 0);
    const t = tex(cv, false);
    t.repeat.set(170, 170);
    return t;
  })();
  // planted ground: a fine, even scatter of dots, as on a landscape plan. It tiles, so it stays
  // crisp next to the camera, where the drawn plan itself is stretched thin.
  const DOT_TILE = 6;
  const dots = (() => {
    const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d'), k = S / DOT_TILE, n = Math.round(S / (0.15 * k));
    c.fillStyle = '#000'; c.fillRect(0, 0, S, S);
    c.fillStyle = '#fff';
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i + 0.5 + rr(-0.4, 0.4)) * (S / n), y = (j + 0.5 + rr(-0.4, 0.4)) * (S / n), r = rr(0.024, 0.044) * k;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { c.beginPath(); c.arc(x + ox, y + oy, r, 0, Math.PI * 2); c.fill(); }
    }
    const t = tex(cv, false);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  })();
  const smallTex = small || maxTex < 4096;
  const loadTex = (url, srgb) => new Promise((res, rej) => new THREE.TextureLoader().load(url, (t) => {
    t.flipY = false;                     // the images are drawn x to the right, z downward
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    res(t);
  }, undefined, rej));
  Promise.all([
    fetch('assets/site/site.json').then((r) => r.json()),
    loadTex(`assets/site/plan${smallTex ? '-2k' : ''}.jpg`, true),
    loadTex('assets/site/ao.jpg', false),
    loadTex('assets/site/ao-lib.jpg', false),
  ]).then(([d, plan, ao, aoLib]) => {
    const q = d.q, T = d.tex, lv = d.levels;
    const acc = () => ({ pos: [], nor: [], uv: [], col: [], idx: [] });
    const put = (A, x, y, z, nx, ny, nz, c) => { A.pos.push(x, y, z); A.nor.push(nx, ny, nz); A.uv.push((x - T.x0) / T.size, (z - T.z0) / T.size); A.col.push(c, c, c); };
    const addTop = (A, L, y, c = 1) => {
      const o = A.pos.length / 3;
      for (let k = 0; k < L.v.length; k += 2) put(A, L.v[k] / q, y, L.v[k + 1] / q, 0, 1, 0, c);
      for (const i of L.i) A.idx.push(o + i);
    };
    // vertical faces along every ring; the inside of a ring is on its left, so its right is outside
    const addWalls = (A, L, ys, cs) => {
      for (const ring of L.r) for (let k = 0; k < ring.length; k++) {
        const a = ring[k] * 2, b = ring[(k + 1) % ring.length] * 2;
        const ax = L.v[a] / q, az = L.v[a + 1] / q, bx = L.v[b] / q, bz = L.v[b + 1] / q;
        const len = Math.hypot(bx - ax, bz - az) || 1, nx = (bz - az) / len, nz = -(bx - ax) / len;
        const o = A.pos.length / 3;
        ys.forEach((y, j) => { put(A, ax, y, az, nx, 0, nz, cs[j]); put(A, bx, y, bz, nx, 0, nz, cs[j]); });
        for (let j = 0; j < ys.length - 1; j++) { const p = o + j * 2; A.idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
      }
    };
    const geo = (A, col) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(A.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(A.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2));
      if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(A.col, 3));
      g.setIndex(A.idx);
      return g;
    };

    // the three levels of the ground share the drawn plan and the baked shading
    siteU.tAo.value = ao; siteU.tLib.value = aoLib;
    siteU.uLib.value.set((T.lib[0] - T.x0) / T.size, (T.lib[1] - T.z0) / T.size, T.lib[2] / T.size, T.lib[3] / T.size);
    const dotTint = new THREE.Color(d.pal.dot).convertSRGBToLinear();
    const greenLin = new THREE.Color(d.pal.green).convertSRGBToLinear();
    dotTint.setRGB(dotTint.r / greenLin.r, dotTint.g / greenLin.g, dotTint.b / greenLin.b);
    const groundMat = (planted) => {
      const m = new THREE.MeshStandardMaterial({ map: plan, roughness: 0.96, metalness: 0, envMapIntensity: 0.2, bumpMap: grain, bumpScale: 0.35 });
      const own = { tDots: { value: dots }, uDots: { value: planted ? 1 : 0 }, uDotRep: { value: T.size / DOT_TILE }, uDotTint: { value: dotTint } };
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, siteU, own);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform sampler2D tAo; uniform sampler2D tLib; uniform vec4 uLib; uniform float uAo; uniform float uLibAo;
            uniform sampler2D tDots; uniform float uDots; uniform float uDotRep; uniform vec3 uDotTint;`)
          .replace('#include <map_fragment>', `#include <map_fragment>
            float siteAo = texture2D( tAo, vMapUv ).r;
            float libAo = texture2D( tLib, clamp( ( vMapUv - uLib.xy ) / uLib.zw, 0.0, 1.0 ) ).r;
            // two sizes of dot: the fine one reads next to the camera, the larger one from further away
            float dot2 = max( texture2D( tDots, vMapUv * uDotRep ).r * 0.5, texture2D( tDots, vMapUv * uDotRep * 4.0 ).r * 0.6 );
            diffuseColor.rgb *= mix( vec3( 1.0 ), uDotTint, dot2 * uDots );
            diffuseColor.rgb *= mix( 1.0, siteAo, uAo ) * mix( 1.0, libAo, uLibAo );`);
      };
      return m;
    };
    const G = acc();
    addTop(G, d.street, lv.street); addTop(G, d.plate, lv.plate);
    const ground = new THREE.Mesh(geo(G), groundMat(false));
    const P = acc();
    addTop(P, d.green, lv.green);
    const planted = new THREE.Mesh(geo(P), groundMat(true));
    ground.receiveShadow = planted.receiveShadow = true;
    // the cut edges of the cards
    const E = acc();
    addWalls(E, d.plate, [lv.street - 0.004, lv.plate], [1, 1]);
    addWalls(E, d.green, [lv.plate - 0.004, lv.green], [1, 1]);
    const edges = new THREE.Mesh(geo(E), new THREE.MeshStandardMaterial({ color: d.pal.edge, roughness: 0.96, envMapIntensity: 0.2 }));
    edges.receiveShadow = true;
    // the neighbours: plain blocks, a little darker towards the ground
    const B = acc();
    for (const b of d.bld) {
      addWalls(B, b, [0, Math.min(0.5, b.h * 0.4), b.h], [0.78, 0.95, 1]);
      addTop(B, b, b.h);
    }
    const blocks = new THREE.Mesh(geo(B, true), new THREE.MeshStandardMaterial({ color: d.pal.block, vertexColors: true, roughness: 0.92, envMapIntensity: 0.25 }));
    blocks.castShadow = blocks.receiveShadow = true;
    // a plain disc just under the street level, so no hairline between two cards ever shows the floor
    const under = new THREE.Mesh(new THREE.CircleGeometry(SITE.r - 0.01, 256), new THREE.MeshStandardMaterial({ color: d.pal.street, roughness: 1 }));
    under.rotation.x = -Math.PI / 2; under.position.set(SITE.x, lv.street - 0.006, SITE.z);
    site.add(ground, planted, edges, blocks, under);
    renderer.shadowMap.needsUpdate = true;
    // names, set in the page's own typeface and laid flat on the model like lettering on a base
    const letter = () => {
      for (const L of d.labels) {
        const px = 150, cv = document.createElement('canvas'), c = cv.getContext('2d');
        const font = `400 ${px}px Hadassah, David, serif`;
        c.font = font; c.letterSpacing = '0.14em';
        const w = Math.ceil(c.measureText(L.t).width + px * 0.6);
        cv.width = w; cv.height = Math.ceil(px * 1.5);
        c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
        c.font = font; c.letterSpacing = '0.14em'; c.direction = 'rtl'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = '#fff'; c.fillText(L.t, cv.width / 2, cv.height / 2);
        const t = tex(cv, false, THREE.ClampToEdgeWrapping);
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        const m = new THREE.Mesh(new THREE.PlaneGeometry((L.s * cv.width) / px, (L.s * cv.height) / px), new THREE.MeshStandardMaterial({
          color: 0x3b362e, alphaMap: t, transparent: true, opacity: 0.62, depthWrite: false, roughness: 1,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        }));
        m.geometry.rotateX(-Math.PI / 2);
        m.position.set(L.x, L.y + 0.008, L.z);
        m.rotation.y = -THREE.MathUtils.degToRad(L.a);
        m.receiveShadow = true;
        site.add(m);
      }
    };
    (document.fonts ? document.fonts.load('400 150px Hadassah', 'אבג').then(letter, letter) : Promise.resolve().then(letter));
    renderer.compile(scene, camera);
  }).catch((err) => console.warn('site model off', err));

  // ---------- post
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(DPR);
  composer.addPass(small ? new RenderPass(scene, camera) : new SceneMsaaPass(scene, camera, DPR > 1.4 ? 2 : 4));
  // ambient occlusion grounds the model the way a photographed maquette is grounded (desktop only)
  let bokeh = null, gtao = null;
  if (!small) {
    gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
    gtao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 10, distanceFallOff: 1, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 10 });
    composer.addPass(gtao);
    // a shallow depth of field, as when a model is photographed from close by: the building
    // stays sharp (a zone of ±range around the focus), the base softens before and behind it
    bokeh = new ShaderPass(DofShader);
    bokeh.uniforms.tDepth.value = gtao.depthTexture;
    bokeh.uniforms.near.value = camera.near; bokeh.uniforms.far.value = camera.far;
    composer.addPass(bokeh);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.4, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // the soft passes do not need every pixel: occlusion is computed at half size, the glow at a quarter
  const sizePost = () => {
    composer.setPixelRatio(DPR);
    composer.setSize(innerWidth, innerHeight);
    const w = Math.round((innerWidth * DPR) / 2), h = Math.round((innerHeight * DPR) / 2);
    if (gtao) gtao.setSize(w, h);
    if (bokeh) { bokeh.uniforms.aspect.value = innerWidth / innerHeight; bokeh.uniforms.texel.value.set(1 / w, 1 / h); }
    bloom.setSize(w, h);
  };
  sizePost();
  // if the machine cannot keep up, give up the costliest refinements one at a time
  const perf = { t: 0, n: 0, skip: 90, step: 0 };
  const degrade = () => {
    perf.step++;
    if (perf.step === 1 && bokeh) bokeh.enabled = false;
    else if (perf.step <= 2 && gtao) { gtao.enabled = false; perf.step = 2; }
    else if (perf.step <= 3 && DPR > 1) { DPR = 1; renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight, false); sizePost(); perf.step = 3; }
  };

  // ---------- state
  let target = sample(TRACKS.monolith, 0);
  const cur = { cam: target.cam.clone(), look: target.look.clone(), fov: 34, shell: 0, wire: 1, night: 0.05, under: 0 };
  let intro = 0, introStart = -1;
  const mouse = new THREE.Vector2(), mouseS = new THREE.Vector2();
  addEventListener('pointermove', (e) => { mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1); });

  const C = {
    day: { top: new THREE.Color('#c9cdd0'), mid: new THREE.Color('#ebe9e4'), bot: new THREE.Color('#e3e0d9'), fog: new THREE.Color('#ebe9e4') },
    dusk: { top: new THREE.Color('#7c8396'), mid: new THREE.Color('#d2bfae'), bot: new THREE.Color('#a59c92'), fog: new THREE.Color('#d2bfae') },
    night: { top: new THREE.Color('#050912'), mid: new THREE.Color('#1c2334'), bot: new THREE.Color('#13151b'), fog: new THREE.Color('#1c2334') },
    under: { top: new THREE.Color('#070707'), mid: new THREE.Color('#0d0c0b'), bot: new THREE.Color('#070707'), fog: new THREE.Color('#0b0a09') },
  };
  const tmp = new THREE.Color(), sunDay = new THREE.Color('#fff1dc'), sunNight = new THREE.Color('#8ea6d8');
  const mix3 = (k, n, u) => (n < 0.5 ? tmp.copy(C.day[k]).lerp(C.dusk[k], smooth(n * 2)) : tmp.copy(C.dusk[k]).lerp(C.night[k], smooth(n * 2 - 1))).lerp(C.under[k], u);

  // hotspots
  const hotEls = [];
  const HOTS = [
    { p: new THREE.Vector3(2.2, 0.55, 2.1), t: 'קומות הזכוכית' },
    { p: new THREE.Vector3(Q[3].p[0], Q[3].h, Q[3].p[1]), t: 'הקצה הצפוני, מול משרד האוצר' },
    { p: new THREE.Vector3(OCULUS.x, roofY(OCULUS.x, OCULUS.z), OCULUS.z), t: 'צוהר וטבעת סולארית' },
    { p: new THREE.Vector3(4.4, 1.72, 2.63), t: 'חלונות בעומק האבן' },   // on the Ruppin side, clear of the chapter card
  ];
  let hotIdx = -1;
  const hotLayer = document.querySelector('.hotspots');
  if (hotLayer) HOTS.forEach((h) => {
    const el = document.createElement('div');
    el.className = 'hot';
    el.innerHTML = `<span class="hot__dot"></span><span class="hot__txt">${h.t}</span>`;
    hotLayer.appendChild(el); hotEls.push(el);
  });

  const anchors = [];
  let active = false, last = performance.now(), time = 0;
  const v3 = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
  const BOX = Q.flatMap((q) => [new THREE.Vector3(q.p[0], 0, q.p[1]), new THREE.Vector3(q.p[0], q.h, q.p[1])]);

  function frame(now) {
    requestAnimationFrame(frame);
    const raw = now - last;
    const dt = Math.min(0.05, raw / 1000); last = now; time += dt;
    if (!active) return;
    if (raw < 120 && perf.step < 3 && document.visibilityState === 'visible') {
      if (perf.skip > 0) perf.skip--;
      else { perf.t += raw; if (++perf.n === 120) { if (perf.t / perf.n > 24) degrade(); perf.t = perf.n = 0; } }
    }
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
    scene.fog.near = lerp(FOG[0], 8, cur.under); scene.fog.far = lerp(FOG[1], 60, cur.under);
    floorMat.color.copy(mix3('bot', n, cur.under));
    siteU.uLibAo.value = shell * 0.78;
    const glow = smooth(clamp01((n - 0.2) / 0.8)) * shell;
    lamps.forEach((l) => { l.intensity = 22 * glow; });
    if (bokeh) {
      // focus on the building as a whole: its nearest and farthest corners bound the sharp zone
      camera.getWorldDirection(fwd);
      let zn = 1e9, zf = -1e9;
      for (const p of BOX) { const z = v3.copy(p).sub(camera.position).dot(fwd); zn = Math.min(zn, z); zf = Math.max(zf, z); }
      bokeh.uniforms.focus.value = (zn + zf) / 2;
      bokeh.uniforms.range.value = (zf - zn) / 2 + 0.5;
      bokeh.uniforms.aperture.value = DOF.aperture * shell;      // no blur while the building is still a line drawing
    }
    sun.intensity = lerp(3.0, 0.03, n) * (1 - cur.under);
    sun.color.copy(sunDay).lerp(sunNight, n);
    hemi.intensity = lerp(1.0, 0.09, n) * (1 - cur.under * 0.7);
    scene.environmentIntensity = lerp(0.35, 0.02, n);
    renderer.toneMappingExposure = lerp(1.0, 0.95, n);
    bloom.strength = lerp(0, 0.75, smooth(clamp01((Math.max(n, cur.under) - 0.06) / 0.94)));
    bloom.enabled = bloom.strength > 0.004;          // by day there is nothing to glow, and the pass is not run

    // hotspots
    hotEls.forEach((el, i) => {
      const on = i === hotIdx && cur.under < 0.1 && shell > 0.9;
      el.classList.toggle('is-on', on);
      if (!on) return;
      v3.copy(HOTS[i].p).project(camera);
      el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * innerWidth - 6}px, ${(-v3.y * 0.5 + 0.5) * innerHeight - 6}px)`;
    });
    // elements pinned to a window of the model, shown only while that facade faces the camera
    for (const a of anchors) {
      const vis = shell > 0.9 && cur.under < 0.1 && v3.copy(camera.position).sub(a.p).dot(a.n) > 0;
      if (vis) {
        v3.copy(a.p).project(camera);
        a.x = (v3.x * 0.5 + 0.5) * innerWidth; a.y = (-v3.y * 0.5 + 0.5) * innerHeight;
        a.el.style.transform = `translate3d(${a.x.toFixed(1)}px,${a.y.toFixed(1)}px,0)`;
        // the window's size on screen: a model window is about 0.06 units wide
        v3.copy(a.p).addScaledVector(right, a.r).project(camera);
        a.el.style.setProperty('--rx', `${Math.max(2, Math.abs((v3.x * 0.5 + 0.5) * innerWidth - a.x)).toFixed(1)}px`);
        a.el.style.setProperty('--ry', `${Math.max(2, Math.abs((v3.x * 0.5 + 0.5) * innerWidth - a.x) * 1.1).toFixed(1)}px`);
      }
      if (vis !== a.vis) { a.vis = vis; a.el.classList.toggle('is-away', !vis); }
    }

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
    sizePost();
  });

  renderer.compile(scene, camera);

  return {
    debug: () => ({ cur, target, cam: camera.position.clone(), lamps, bloom, bokeh, gtao, siteU, sun, hemi, scene, camera, renderer, site, composer, perf, setIntro(v) { intro = v; introStart = -1; } }),
    playIntro() { if (introStart < 0 && intro < 1) introStart = performance.now(); },
    skipIntro() { intro = 1; introStart = -1; },
    set(track, p) { target = sample(TRACKS[track], clamp01(p)); },
    jump() { cur.cam.copy(target.cam); cur.look.copy(target.look); for (const key of ['shell', 'wire', 'night', 'under']) cur[key] = target[key]; },
    setHot(i) { hotIdx = i; if (i < 0) hotEls.forEach((el) => el.classList.remove('is-on')); },
    // pin an element to point p on the facade with outward normal n; returns its live screen position
    anchor(el, p, n, r = 0.032) {
      const a = { el, p: new THREE.Vector3(...p), n: new THREE.Vector3(...n), r, vis: false, x: -1e4, y: -1e4 };
      el.classList.add('is-away');
      anchors.push(a);
      return a;
    },
    setActive(v) {
      active = v;
      if (v) last = performance.now();
      else {
        hotEls.forEach((el) => el.classList.remove('is-on'));
        anchors.forEach((a) => { a.vis = false; a.el.classList.add('is-away'); });
      }
    },
  };
}
