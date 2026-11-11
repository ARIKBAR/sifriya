// A real photograph made to move in depth.
// The depth map (near = bright) displaces the texture lookup, so near things
// shift more than far things when the pointer moves or the page scrolls.
// Used for the hero and for a few full-bleed photographs further down.

const VS = `
attribute vec2 p;
varying vec2 vUv;
void main(){ vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;

const FS = `
precision highp float;
uniform sampler2D img, dep;
uniform vec2 res, imgSize, pt, anchor, center;   // pt = smoothed pointer, -1..1
uniform float scroll, zoom, focus, strength, lift, fade;
uniform vec3 ink;
varying vec2 vUv;

vec2 cover(vec2 uv){
  float rs = res.x / res.y, ri = imgSize.x / imgSize.y;
  vec2 s = rs > ri ? vec2(1., ri / rs) : vec2(rs / ri, 1.);
  return uv * s + (1. - s) * anchor;
}
void main(){
  vec2 uv = vUv;
  uv.y = 1. - uv.y;
  uv = (uv - center) / zoom + center;     // dolly toward a point of the frame
  uv.y += scroll * lift;
  vec2 c = cover(uv);
  float d = texture2D(dep, c).r - focus;   // signed distance from the focal plane
  vec2 off = vec2(pt.x, -pt.y) * strength * d + vec2(0., scroll * .05 * d);
  vec3 col = texture2D(img, clamp(c - off, 0., 1.)).rgb;
  gl_FragColor = vec4(mix(col, ink, fade), 1.);
}`;

const TOUCH = matchMedia('(hover: none), (pointer: coarse)').matches;

export function createDepthPhoto(canvas, {
  src, depth, imgSize,
  anchor = [0.5, 0.5],      // which part of the photo stays in view when it is cropped
  focus = 0.42,             // depth value that does not move
  strength = 0.016,         // pointer parallax
  lift = 0.035,             // vertical drift with scroll
  zoomFrom = 1.06, zoomScroll = 0.12,
  center = [0.5, 0.5],      // screen point the zoom heads for
  ink = [22 / 255, 20 / 255, 15 / 255],
} = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('no webgl');
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = {};
  for (const n of ['img', 'dep', 'res', 'imgSize', 'pt', 'anchor', 'center', 'scroll', 'zoom', 'focus', 'strength', 'lift', 'fade', 'ink']) u[n] = gl.getUniformLocation(prog, n);

  const texture = (unit, image) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
  };
  const load = (s) => new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = s; });

  const st = { pt: [0, 0], tg: [0, 0], scroll: 0, zoom: zoomFrom, zoomT: zoomFrom, extra: 1, fade: 0, running: true, ready: false };
  addEventListener('pointermove', (e) => { st.tg = [(e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1]; });

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  addEventListener('resize', resize);

  let t0 = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    if (!st.ready || !st.running) return;
    const dt = Math.min(0.05, (now - t0) / 1000); t0 = now;
    if (TOUCH) { const t = now / 1000; st.tg = [Math.sin(t * 0.25) * 0.6, Math.cos(t * 0.19) * 0.35]; }
    const k = 1 - Math.pow(0.08, dt); // slow, soft follow
    st.pt[0] += (st.tg[0] - st.pt[0]) * k;
    st.pt[1] += (st.tg[1] - st.pt[1]) * k;
    st.zoom += (st.zoomT - st.zoom) * (1 - Math.pow(0.02, dt));
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform2f(u.pt, st.pt[0], st.pt[1]);
    gl.uniform1f(u.scroll, st.scroll);
    gl.uniform1f(u.zoom, st.zoom * st.extra);
    gl.uniform1f(u.fade, st.fade);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const ready = Promise.all([load(src), load(depth)]).then(([a, b]) => {
    resize();
    texture(0, a); texture(1, b);
    gl.uniform1i(u.img, 0); gl.uniform1i(u.dep, 1);
    gl.uniform2f(u.imgSize, imgSize[0], imgSize[1]);
    gl.uniform2f(u.anchor, anchor[0], anchor[1]);
    gl.uniform2f(u.center, center[0], center[1]);
    gl.uniform1f(u.focus, focus);
    gl.uniform1f(u.strength, strength);
    gl.uniform1f(u.lift, lift);
    gl.uniform3f(u.ink, ink[0], ink[1], ink[2]);
    st.ready = true;
    canvas.classList.add('is-ready');
    requestAnimationFrame(frame);
  });

  return {
    ready,
    setScroll(p) { st.scroll = p; st.zoomT = zoomFrom + p * zoomScroll; },
    setDive(extra, fade = 0) { st.extra = extra; st.fade = fade; },   // extra zoom toward `center`, fade to ink
    setCenter(x, y) { if (st.ready) gl.uniform2f(u.center, x, y); },
    intro() { st.zoom = zoomFrom + 0.1; st.zoomT = zoomFrom; },
    setRunning(v) { st.running = v; if (v) t0 = performance.now(); },
  };
}
