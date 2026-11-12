// "How the building is made": the Blender model assembles itself as you scroll.
// Steps: glass floors → stone mass → roof → oculus → windows → evening.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const c01 = (t) => Math.min(1, Math.max(0, t));
const ease = (t) => 1 - Math.pow(1 - c01(t), 3);
const span = (p, a, b) => ease((p - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;

export function createBuild(canvas, { url = 'assets/model/nli.glb' } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const day = new THREE.Color('#e7e3da'), night = new THREE.Color('#141824');
  scene.background = day.clone();
  scene.fog = new THREE.Fog(day.clone(), 420, 900);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
  const hemi = new THREE.HemisphereLight(0xeef2f7, 0x8a7f6c, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  sun.position.set(-160, 220, 140);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 700 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const parts = {};
  let ready = false, progress = 0, active = false, dirty = true;

  // where each part comes from, and when (fractions of the section's scroll)
  const STEPS = {
    columns:        { from: [0, -14, 0], at: [0.02, 0.14] },
    glass_floor:    { from: [0, -14, 0], at: [0.04, 0.18] },
    stone_mass:     { from: [0, 70, 0],  at: [0.18, 0.4] },
    roof:           { from: [0, 46, 0],  at: [0.36, 0.54] },
    solar_ring:     { from: [0, 30, 0],  at: [0.52, 0.66] },
    oculus_glass:   { from: [0, 30, 0],  at: [0.56, 0.68] },
    skylight_small: { from: [0, 30, 0],  at: [0.56, 0.68] },
    windows:        { from: [0, 0, 0],   at: [0.68, 0.8] },
  };
  let winMat = null, glassMat = null;

  new GLTFLoader().load(url, (gltf) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.name.replace(/_\d+$/, '');
      o.castShadow = name !== 'ground';
      o.receiveShadow = true;
      o.material = o.material.clone();
      o.material.transparent = name in STEPS;
      parts[name] = o;
      o.userData.base = o.position.clone();
      if (o.material.name === 'window_glass') winMat = o.material;
      if (o.material.name === 'glass_floor') glassMat = o.material;
    });
    if (winMat) { winMat.emissive = new THREE.Color('#ffc983'); winMat.emissiveIntensity = 0; }
    if (glassMat) { glassMat.emissive = new THREE.Color('#ffd9a6'); glassMat.emissiveMap = glassMat.map; glassMat.emissiveIntensity = 0; }
    scene.add(gltf.scene);
    ready = true; dirty = true;
  });

  function apply(p) {
    for (const [name, s] of Object.entries(STEPS)) {
      const o = parts[name];
      if (!o) continue;
      const t = span(p, s.at[0], s.at[1]);
      o.visible = t > 0.001;
      o.position.set(o.userData.base.x + s.from[0] * (1 - t), o.userData.base.y + s.from[1] * (1 - t), o.userData.base.z + s.from[2] * (1 - t));
      o.material.opacity = name === 'windows' ? t : Math.min(1, t * 1.6);
      o.material.depthWrite = o.material.opacity > 0.98;
    }
    // evening: the light goes down, the windows and the glass floors light up
    const n = span(p, 0.84, 0.98);
    scene.background.copy(day).lerp(night, n);
    scene.fog.color.copy(scene.background);
    sun.intensity = lerp(3.2, 0.05, n);
    hemi.intensity = lerp(1.1, 0.15, n);
    scene.environmentIntensity = lerp(0.5, 0.05, n);
    if (winMat) winMat.emissiveIntensity = lerp(0, 3.2, n);
    if (glassMat) glassMat.emissiveIntensity = lerp(0, 0.9, n);
    // a slow, small orbit: about 40 degrees across the whole section
    const a = lerp(-0.95, -0.3, p);
    const r = lerp(300, 270, p);
    camera.position.set(Math.sin(a) * r, lerp(150, 110, p), Math.cos(a) * r);
    camera.lookAt(10, 14, 0);
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the whole building in frame on tall screens
    camera.fov = w / h < 1 ? 30 * Math.min(1.9, 1 / (w / h) * 0.95) : 30;
    // the text card sits on the right on wide screens: move the building into the left part of the frame
    if (w / h >= 1) camera.setViewOffset(w, h, w * 0.08, 0, w, h); else camera.setViewOffset(w, h, 0, h * 0.16, w, h);
    camera.updateProjectionMatrix();
    dirty = true;
  }
  resize();
  addEventListener('resize', resize);

  const tick = () => {
    requestAnimationFrame(tick);
    if (!active || !ready || !dirty) return;
    dirty = false;
    apply(progress);
    renderer.render(scene, camera);
  };
  requestAnimationFrame(tick);

  return {
    set(p) { progress = p; dirty = true; },
    setActive(v) { active = v; dirty = true; },
  };
}
