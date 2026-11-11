// The site's aperture: the four-pointed gap that is left where four rounded
// stones meet. On the facade those gaps are the windows.

// Outline points of the star, tips at distance R along the axes.
function starPoints(cx, cy, R, n = 9) {
  const pts = [];
  const arcs = [
    (t) => [R - R * Math.sin(t), R - R * Math.cos(t)],   // (R,0) → (0,R)
    (t) => [-R + R * Math.cos(t), R - R * Math.sin(t)],  // (0,R) → (-R,0)
    (t) => [-R + R * Math.sin(t), -R + R * Math.cos(t)], // (-R,0) → (0,-R)
    (t) => [R - R * Math.cos(t), -R + R * Math.sin(t)],  // (0,-R) → (R,0)
  ];
  for (const f of arcs) for (let k = 0; k < n; k++) {
    const [x, y] = f((k / n) * Math.PI / 2);
    pts.push([cx + x, cy + y]);
  }
  return pts;
}

// CSS clip-path for a star centred at (cx, cy) px with tip distance R px
export function starClip(cx, cy, R) {
  return `polygon(${starPoints(cx, cy, Math.max(0.01, R)).map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})`;
}

// The smallest R at which a star centred at (cx, cy) covers a w × h box
export function starCover(cx, cy, w, h) {
  const a = Math.max(cx, w - cx), b = Math.max(cy, h - cy);
  return a + b + Math.sqrt(2 * a * b) + 2;
}

// SVG path data for the same shape (for inline icons / the cursor)
export function starPathD(R, cx = R, cy = R) {
  // four circular arcs, each bulging toward the centre
  return `M${cx + R},${cy} A${R},${R} 0 0 0 ${cx},${cy + R} A${R},${R} 0 0 0 ${cx - R},${cy} A${R},${R} 0 0 0 ${cx},${cy - R} A${R},${R} 0 0 0 ${cx + R},${cy} Z`;
}

// Reveal an element through a growing star. Returns a setter p ∈ [0,1].
export function starReveal(el, { cx = 0.5, cy = 0.5, from = 0 } = {}) {
  let w = 0, h = 0, R = 0;
  const measure = () => { w = el.offsetWidth; h = el.offsetHeight; R = starCover(cx * w, cy * h, w, h); };
  measure();
  addEventListener('resize', measure);
  return (p) => {
    if (!w) measure();
    el.style.clipPath = p >= 0.999 ? 'none' : starClip(cx * w, cy * h, from * Math.min(w, h) + (R - from * Math.min(w, h)) * p);
  };
}
