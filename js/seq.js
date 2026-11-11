// Scroll-scrubbed image sequences on one canvas.
// Each chapter is a short camera move (a folder of numbered JPEG frames).
// Progress 0..1 is split evenly between the chapters; the last part of each
// chapter cross-fades into the first frame of the next.

export function createSequence(canvas, chapters, { fade = 0.12 } = {}) {
  const ctx = canvas.getContext('2d');
  const sets = chapters.map((c) => ({ ...c, imgs: new Array(c.count), loaded: 0, started: false }));
  let progress = 0, dirty = true, W = 0, H = 0;

  const src = (c, i) => `${c.dir}/${String(i + 1).padStart(3, '0')}.jpg`;
  // load a chapter: first a sparse pass (every 8th frame) so scrubbing works at once, then fill in
  function load(k) {
    const c = sets[k];
    if (!c || c.started) return;
    c.started = true;
    const order = [];
    for (let s = 8; s >= 1; s = s / 2) for (let i = 0; i < c.count; i += s) if (!order.includes(i)) order.push(i);
    let next = 0;
    const pump = () => {
      if (next >= order.length) return;
      const i = order[next++];
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => { c.imgs[i] = im; c.loaded++; dirty = true; pump(); };
      im.onerror = pump;
      im.src = src(c, i);
    };
    for (let n = 0; n < 4; n++) pump(); // four requests at a time
  }

  // nearest frame that has arrived
  function frame(c, i) {
    if (c.imgs[i]) return c.imgs[i];
    for (let d = 1; d < c.count; d++) {
      if (c.imgs[i - d]) return c.imgs[i - d];
      if (c.imgs[i + d]) return c.imgs[i + d];
    }
    return null;
  }

  function cover(im, alpha) {
    if (!im) return;
    const s = Math.max(W / im.naturalWidth, H / im.naturalHeight);
    const w = im.naturalWidth * s, h = im.naturalHeight * s;
    ctx.globalAlpha = alpha;
    ctx.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
    ctx.globalAlpha = 1;
  }

  function draw() {
    if (!dirty) return;
    dirty = false;
    const n = sets.length;
    const x = Math.min(progress * n, n - 1e-6);
    const k = Math.floor(x), t = x - k;
    const c = sets[k];
    // within the chapter the move runs over the first (1 - fade); the rest is the hand-over
    const tt = Math.min(1, t / (1 - fade));
    ctx.fillStyle = '#16140f';
    ctx.fillRect(0, 0, W, H);
    cover(frame(c, Math.round(tt * (c.count - 1))), 1);
    if (t > 1 - fade && sets[k + 1]) {
      const a = (t - (1 - fade)) / fade;
      cover(frame(sets[k + 1], 0), a * a * (3 - 2 * a));
    }
    // keep the current, next and previous chapters loading
    load(k); load(k + 1); if (k > 0) load(k - 1);
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.width = Math.round(canvas.clientWidth * dpr);
    H = canvas.height = Math.round(canvas.clientHeight * dpr);
    dirty = true;
  }
  resize();
  addEventListener('resize', resize);
  load(0);

  const tick = () => { draw(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);

  return {
    set(p) { if (p !== progress) { progress = p; dirty = true; } },
    preload() { load(0); load(1); },
  };
}
