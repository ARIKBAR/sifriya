// A wall of rounded stones drawn on a canvas, like the building's facade.
// `open`   0→1: the star-shaped gaps where four stones meet become see-through
//               (on the facade those gaps are the windows).
// `shrink` 0→1: the stones themselves shrink away and the wall is gone.
// Both spread outward from `focus` like a ripple.

const c01 = (t) => Math.min(1, Math.max(0, t));
const ease = (t) => t * t * (3 - 2 * t);
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };

export function createStoneWall(canvas, { ink = '#16140f', stone = [33, 30, 24], focus = [0.5, 0.5], columns = 13, columnsSmall = 6 } = {}) {
  const ctx = canvas.getContext('2d');
  const state = { open: 0, shrink: 0 };
  let W = 0, H = 0, cell = 0, cols = 0, rows = 0, y0 = 0, maxD = 1;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    H = canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    cols = canvas.clientWidth < 700 ? columnsSmall : columns;
    cell = W / cols;
    rows = Math.ceil(H / cell) + 1;
    y0 = (H - rows * cell) / 2;
    const fx = focus[0] * W, fy = focus[1] * H;
    maxD = Math.hypot(Math.max(fx, W - fx), Math.max(fy, H - fy));
    draw();
  }

  function draw() {
    const { open, shrink } = state;
    ctx.clearRect(0, 0, W, H);
    if (shrink >= 1) return;
    const fx = focus[0] * W, fy = focus[1] * H;
    // progress of one element, delayed by its distance from the focus
    const local = (x, y, T, S) => c01((T - (Math.hypot(x - fx, y - fy) / maxD) * S) / (1 - S));
    const rad = cell * 0.36, gap = cell * 0.018;

    // the dark behind the stones, with a round hole growing at every junction
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, W, H);
    if (open > 0 || shrink > 0) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        const x = i * cell, y = y0 + j * cell;
        const r = rad * ease(local(x, y, open, 0.55)) + cell * 0.45 * ease(local(x, y, shrink, 0.5));
        if (r > 0.5) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
      }
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // the stones
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const cx = (i + 0.5) * cell, cy = y0 + (j + 0.5) * cell;
      const s = 1 - ease(local(cx, cy, shrink, 0.5));
      if (s <= 0.01) continue;
      const k = hash(i, j) * 9, size = (cell - gap * 2) * s;
      ctx.fillStyle = `rgb(${stone[0] + k | 0},${stone[1] + k | 0},${stone[2] + k | 0})`;
      ctx.beginPath();
      ctx.roundRect(cx - size / 2, cy - size / 2, size, size, rad * s);
      ctx.fill();
    }
  }

  resize();
  addEventListener('resize', resize);
  return {
    state,
    draw,
    set(open, shrink) { state.open = open; state.shrink = shrink; draw(); },
    destroy() { removeEventListener('resize', resize); },
  };
}
