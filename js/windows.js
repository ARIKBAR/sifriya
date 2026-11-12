// Seven of the building's star-shaped windows are hidden in the photographs and on the
// model. Each one lights when it is found and tells one fact about the building. When all
// are lit, the photograph of the building at the end of the page lights up and the visitor
// can make a reader's card. Progress is kept in this browser only.
import { starPathD } from './aperture.js';

const { gsap, ScrollTrigger } = window;
const KEY = 'nli-windows-v1';
const TOUCH = matchMedia('(hover: none), (pointer: coarse)').matches;
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// at.img: the photograph; nat: its size; pt: the centre of a real window in it; r: half the
// window's width and height (fractions of the photograph). at.model: a point on a window of
// the 3D model, with the facade's outward normal. Facts were checked against the sources in
// ANALYSIS.md.
const WINS = [
  { id: 'site', ch: '01', name: 'המקום', hint: 'בצילום של הקצה הדרומי',
    at: { img: 'img[src$="end.jpg"]', nat: [2400, 1600], pt: [0.7245, 0.4635], r: [0.0125, 0.0135] },
    go: { wide: ['#site', 0.8], narrow: '.site__fig--b' },
    fact: 'המגרש יורד בכ־8 מטרים מרחוב קפלן אל שדרות רופין, ולכן הכניסה מצד קפלן מוגבהת.' },
  { id: 'base', ch: '02', name: 'המבנה', hint: 'על המודל, מעל קומות הזכוכית',
    at: { model: [0.508, 1.7, 2.343], n: [-0.027, 0, 1] },
    go: { all: ['#monolith', 0.07] },
    fact: 'קומות הזכוכית הן חמש תיבות במסגרות עץ. ביניהן עומדות "רגליים" אטומות, ובתוכן מדרגות, מעליות ותשתיות, ועליהן נשענת מסת האבן.' },
  { id: 'south', ch: '02', name: 'המבנה', hint: 'על המודל, בערב, בקצה הדרומי',
    at: { model: [7.55, 1.7, 1.4], n: [0.746, 0, 0.666] },
    go: { all: ['#monolith', 0.97] },
    fact: 'בוויטרינה הדרומית, מתחת למסת האבן, נמצאים האודיטוריום, ובו 480 מקומות, והמסעדה.' },
  { id: 'torch', ch: '03', name: 'האבן', hint: 'בקיר החשוך, באור הפנס',
    at: { img: '.torch__base', nat: [2400, 1660], pt: [0.4175, 0.5005], r: [0.023, 0.0245] },
    go: { all: '.torch' },
    fact: 'על קיר האבן שליד הכניסה כתוב "הבניין על שם דוד ורות גוטסמן". כ־85% מעלות הבנייה באו מתורמים, ובראשם יד הנדיב ומשפחת גוטסמן.' },
  { id: 'joints', ch: '03', name: 'האבן', hint: 'בשרטוט האבנים',
    at: { joints: true },
    go: { all: '.joints__cv' },
    fact: 'כ־250 החלונות שבאבן יושבים במסגרות של אלומיניום יצוק. את החלונות ואת הצוהר שבגג ביצעה אותה חברה, אלום אשת.' },
  { id: 'dusk', ch: '06', name: 'אור', hint: 'בשורת החלונות, בין החלונות המוארים',
    at: { img: '.light__img', nat: [1600, 900], pt: [0.571, 0.605], r: [0.007, 0.01] },
    go: { all: '.light__hero' },
    fact: 'מיכה אולמן יצר גם את "הספרייה" בכיכר בבל בברלין: חלון בריצוף הכיכר, ומתחתיו חדר של מדפים ריקים, לזכר שריפת הספרים ב־1933.' },
  { id: 'tl', ch: '08', name: 'במספרים', hint: 'בצילום משנת 2022',
    at: { img: 'img[src$="tl-2022.jpg"]', nat: [1600, 1200], pt: [0.682, 0.464], r: [0.0115, 0.0135] },
    go: { timeline: 'img[src$="tl-2022.jpg"]' },
    fact: 'בתוכנית שהוצגה ב־2014 הבניין היה אמור להיפתח ב־2019. מועד הפתיחה נדחה כמה פעמים, עד 2023.' },
];

// where each found window lights the photograph at the end of the page, right to left along
// the band of lit windows (fractions of dusk-facade.jpg)
const END = { nat: [1600, 1067], pos: [0.66, 0.5] };
const SPOTS = [[0.84, 0.515], [0.785, 0.51], [0.73, 0.5], [0.67, 0.49], [0.61, 0.48], [0.55, 0.475], [0.49, 0.47]];
const COUNT = { 5: 'חמישה', 6: 'שישה', 7: 'שבעה' };
const COUNT_F = { 5: 'חמשת', 6: 'ששת', 7: 'שבעת' };

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.lit)) return { intro: false, name: '', ...s };
  } catch (err) { /* private mode or blocked storage: start fresh */ }
  return { lit: [], intro: false, name: '' };
}
function save(st) {
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (err) { /* the game still works for this visit */ }
}

// "בפרק 03" / "בפרקים 02 ו־06" / "בפרקים 01, 02 ו־06"
function chapters(chs) {
  if (chs.length === 1) return `בפרק ${chs[0]}`;
  return `בפרקים ${chs.slice(0, -1).join(', ')} ו־${chs[chs.length - 1]}`;
}

// a photograph shown with object-fit: cover, possibly scaled or moved by a transform
function photoPlace(at, el) {
  const img = $(at.img);
  if (!img) return null;
  const host = img.parentElement;
  host.appendChild(el);
  const [nw, nh] = at.nat, [u, v] = at.pt, [ru, rv] = at.r, [ox, oy] = at.pos || [0.5, 0.5];
  return {
    host,
    at() {
      const W = img.offsetWidth, H = img.offsetHeight;
      if (!W || !H) return null;
      const r = img.getBoundingClientRect(), h = host.getBoundingClientRect();
      const s = Math.max(W / nw, H / nh), kx = r.width / W, ky = r.height / H;
      const x = r.left - h.left + ((W - nw * s) * ox + u * nw * s) * kx;
      const y = r.top - h.top + ((H - nh * s) * oy + v * nh * s) * ky;
      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      el.style.setProperty('--rx', `${Math.max(2.5, ru * nw * s * kx).toFixed(1)}px`);
      el.style.setProperty('--ry', `${Math.max(2.5, rv * nh * s * ky).toFixed(1)}px`);
      const sx = h.left + x, sy = h.top + y;
      return sx > h.left && sx < h.right && sy > h.top && sy < h.bottom ? [sx, sy] : null;
    },
  };
}

// one of the gaps of the stone drawing in chapter 03 (same grid as main.js draws)
function jointsPlace(el) {
  const cv = $('.joints__cv');
  if (!cv) return null;
  const host = cv.parentElement;
  host.appendChild(el);
  return {
    host: cv,
    at() {
      const cw = cv.clientWidth, chh = cv.clientHeight;
      if (!cw) return null;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const W = Math.round(cw * dpr), H = Math.round(chh * dpr), n = innerWidth < 700 ? 6 : 8;
      const cell = W / n, x0 = (W % cell) / 2 - cell / 2, y0 = (H % cell) / 2 - cell / 2;
      const i = Math.max(1, Math.round(n * 0.3)), j = Math.max(1, Math.round((H * 0.42 - y0) / cell));
      const k = cw / W;
      const r = cv.getBoundingClientRect(), h = host.getBoundingClientRect();
      const x = r.left - h.left + (x0 + i * cell) * k, y = r.top - h.top + (y0 + j * cell) * k;
      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      el.style.setProperty('--rx', `${(cell * k * 0.4).toFixed(1)}px`);
      el.style.setProperty('--ry', `${(cell * k * 0.4).toFixed(1)}px`);
      return [h.left + x, h.top + y];
    },
  };
}

/* ------------------------------------------------------------ the reader's card */
function drawCard(cv, name, total, date) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);
  c.save();
  c.beginPath(); c.roundRect(0, 0, W, H, 36); c.clip();
  c.fillStyle = '#16140f'; c.fillRect(0, 0, W, H);

  // the wall at night: rounded stones, and the windows found lit in the gaps between them
  const WW = 520, cell = 104, gap = cell * 0.035, rad = cell * 0.36;
  const x0 = -cell * 0.35, y0 = -cell * 0.62;
  const LIT = [[2, 3], [4, 3], [1, 4], [3, 4], [5, 4], [2, 5], [4, 5]].slice(0, total);
  const glow = (x, y, s, a) => {
    const g = c.createRadialGradient(x, y, 0, x, y, s);
    g.addColorStop(0, `rgba(255,238,200,${a})`); g.addColorStop(0.35, `rgba(255,196,118,${a * 0.92})`); g.addColorStop(1, 'rgba(210,130,60,0)');
    c.fillStyle = g; c.fillRect(x - s, y - s, s * 2, s * 2);
  };
  c.save();
  c.beginPath(); c.rect(0, 0, WW, H); c.clip();
  c.fillStyle = '#100e0b'; c.fillRect(0, 0, WW, H);
  for (const [i, j] of LIT) glow(x0 + i * cell, y0 + j * cell, cell * 0.6, 1);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let j = 0; j * cell + y0 < H + cell; j++) for (let i = 0; i * cell + x0 < WW + cell; i++) {
    const t = rnd();
    c.fillStyle = `rgb(${108 + t * 26 | 0},${100 + t * 24 | 0},${86 + t * 22 | 0})`;
    c.beginPath(); c.roundRect(x0 + i * cell + gap, y0 + j * cell + gap, cell - gap * 2, cell - gap * 2, rad); c.fill();
  }
  // the light falls a little on the stone around each window
  c.globalCompositeOperation = 'lighter';
  for (const [i, j] of LIT) glow(x0 + i * cell, y0 + j * cell, cell * 1.05, 0.2);
  c.globalCompositeOperation = 'source-over';
  const fade = c.createLinearGradient(WW - 150, 0, WW, 0);
  fade.addColorStop(0, 'rgba(22,20,15,0)'); fade.addColorStop(1, 'rgba(22,20,15,1)');
  c.fillStyle = fade; c.fillRect(WW - 150, 0, 150, H);
  c.restore();

  // the text, set from the right
  const X = W - 72;
  c.direction = 'rtl'; c.textAlign = 'right'; c.textBaseline = 'alphabetic';
  c.fillStyle = 'rgba(237,231,219,.62)'; c.font = '400 30px Hadassah, serif';
  c.fillText('סיור בבניין הספרייה הלאומית', X, 122);
  c.fillStyle = '#ede7db'; c.font = '300 106px Hadassah, serif';
  c.fillText('כרטיס קורא', X, 256);
  const nm = name || 'השם שלכם';
  let fs = 70;
  c.font = `400 ${fs}px Hadassah, serif`;
  while (fs > 30 && c.measureText(nm).width > X - WW - 40) { fs -= 2; c.font = `400 ${fs}px Hadassah, serif`; }
  c.fillStyle = name ? '#f2d29e' : 'rgba(242,210,158,.35)';
  c.fillText(nm, X, 388);
  // a row of lit windows, and the count
  for (let k = 0; k < total; k++) {
    const R = 11, cx = X - R - k * 31, cy = 455;
    c.save();
    c.shadowColor = 'rgba(255,186,100,.9)'; c.shadowBlur = 12;
    c.fillStyle = '#ffd08f'; c.fill(new Path2D(starPathD(R, cx, cy)));
    c.restore();
  }
  c.fillStyle = 'rgba(237,231,219,.82)'; c.font = '400 29px Hadassah, serif';
  c.fillText(`${total} מתוך ${total} חלונות דולקים`, X - total * 31 - 14, 466);
  c.fillStyle = 'rgba(237,231,219,.18)'; c.fillRect(WW + 40, 566, X - WW - 40, 2);
  c.fillStyle = 'rgba(237,231,219,.7)'; c.font = '400 29px Hadassah, serif';
  c.fillText(`ירושלים · ${date}`, X, 628);
  c.fillStyle = 'rgba(237,231,219,.46)'; c.font = '400 24px Hadassah, serif';
  c.fillText('מזכרת מהסיור באתר, לא כרטיס של הספרייה', X, 676);
  c.restore();
  c.strokeStyle = 'rgba(237,231,219,.2)'; c.lineWidth = 2;
  c.beginPath(); c.roundRect(1, 1, W - 2, H - 2, 35); c.stroke();
}

/* ------------------------------------------------------------ the game */
export function initWindows({ scene, scrollTo, closeMenu = () => {} }) {
  const st = load();
  const list = WINS.filter((w) => !w.at.model || (scene && scene.anchor));
  const total = list.length;
  st.lit = st.lit.filter((id, i, a) => a.indexOf(id) === i && list.some((w) => w.id === id));
  const isLit = (w) => st.lit.includes(w.id);

  const nav = $('.nav'), strip = $('.wins'), row = $('.wins__row'), panel = $('#wins-panel');
  const plist = $('.wpanel__list'), layer = $('.hw-layer');
  $$('.wins__of').forEach((el) => (el.textContent = total));
  panel.setAttribute('data-lenis-prevent', '');
  $('.wpanel__intro').textContent = `${COUNT[total]} מהחלונות של הבניין מסתתרים בצילומים ובמודל שלאורך הסיור. חלון נסתר מנצנץ מדי פעם, ולחיצה עליו מדליקה אותו.`;

  const starIcons = (host) => { host.innerHTML = list.map((w, i) => `<i style="--i:${i}"><b></b></i>`).join(''); return $$('i', host); };
  const stars = starIcons(row), endStars = starIcons($('.lit__stars'));
  plist.innerHTML = list.map((w, i) => `<li><button type="button" data-i="${i}"><i class="wstar"><b></b></i><span>${w.ch}</span><span class="wpanel__row"><b>${w.name}</b><span class="wpanel__t"></span></span></button></li>`).join('');

  // ---------- the hidden windows
  const items = list.map((w, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'hw';
    el.setAttribute('aria-label', 'חלון נסתר');
    el.innerHTML = '<i class="hw__glow"></i><i class="hw__star"></i>';
    el.style.setProperty('--d', `${((1.2 + i * 2.3) % 8).toFixed(1)}s`);   // the glints take turns
    const it = { w, i, el, p: null, near: 0, inView: false, loc: null, a: null };
    if (w.at.model) { layer.appendChild(el); it.a = scene.anchor(el, w.at.model, w.at.n); }
    else it.loc = w.at.joints ? jointsPlace(el) : photoPlace(w.at, el);
    el.addEventListener('click', () => light(it));
    return it;
  });
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    items.forEach((it) => { if (it.loc && it.loc.host === e.target) it.inView = e.isIntersecting; });
  }), { rootMargin: '120px 0px' });
  items.forEach((it) => it.loc && io.observe(it.loc.host));

  let px = -1e4, py = -1e4;
  if (!TOUCH) addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; }, { passive: true });
  gsap.ticker.add(() => {
    for (const it of items) {
      if (it.a) it.p = it.a.vis ? [it.a.x, it.a.y] : null;
      else if (it.loc && it.inView) it.p = it.loc.at();
      else it.p = null;
      if (TOUCH || isLit(it.w)) continue;
      // warmer as the pointer comes closer
      const near = it.p ? Math.max(0, Math.min(1, 1 - (Math.hypot(px - it.p[0], py - it.p[1]) - 30) / 190)) : 0;
      if (Math.abs(near - it.near) > 0.015 || (near === 0 && it.near !== 0)) {
        it.near = near;
        it.el.style.setProperty('--near', near.toFixed(3));
      }
    }
  });

  // ---------- the message under the bar
  const T = { el: $('.wtoast'), n: $('.wtoast__n'), t: $('.wtoast__t'), more: $('.wtoast__more'), go: $('.wtoast__go'), timer: 0, y: 0 };
  const hideToast = () => {
    clearTimeout(T.timer);
    if (T.el.hidden) return;
    gsap.to(T.el, { y: -10, opacity: 0, duration: RM ? 0 : 0.35, ease: 'power2.in', onComplete: () => { T.el.hidden = true; } });
  };
  const toast = ({ n, t, more = '', go = null, label = '', ms = 9000, stay = false }) => {
    T.stay = stay;
    T.n.textContent = n; T.t.textContent = t; T.more.textContent = more;
    T.go.hidden = !go;
    T.go.textContent = label;
    T.go.onclick = go ? () => { hideToast(); go(); } : null;
    gsap.killTweensOf(T.el);
    T.el.hidden = false;
    gsap.fromTo(T.el, { y: -14, opacity: 0 }, { y: 0, opacity: 1, duration: RM ? 0 : 0.7, ease: 'expo.out' });
    clearTimeout(T.timer);
    T.timer = setTimeout(hideToast, ms);
    T.y = scrollY;
  };
  $('.wtoast__x').addEventListener('click', hideToast);
  T.el.addEventListener('pointerenter', () => clearTimeout(T.timer));
  T.el.addEventListener('pointerleave', () => { clearTimeout(T.timer); T.timer = setTimeout(hideToast, 4000); });
  addEventListener('scroll', () => { if (!T.el.hidden && !T.stay && Math.abs(scrollY - T.y) > innerHeight * 1.2) hideToast(); }, { passive: true });

  // ---------- the panel of windows
  const setPanel = (open) => {
    if (open === nav.classList.contains('is-wins')) return;
    nav.classList.toggle('is-wins', open);
    strip.setAttribute('aria-expanded', open);
    if (open) {
      closeMenu();
      hideToast();
      if (!RM) gsap.fromTo($$('li', plist), { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'expo.out', stagger: 0.035, delay: 0.12 });
    }
  };
  strip.addEventListener('click', () => setPanel(!nav.classList.contains('is-wins')));
  $('.nav__menu').addEventListener('click', () => setPanel(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') setPanel(false); });
  document.addEventListener('pointerdown', (e) => { if (nav.classList.contains('is-wins') && !nav.contains(e.target)) setPanel(false); });
  plist.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setPanel(false);
    goTo(list[+b.dataset.i]);
  });
  $('.wpanel__end').addEventListener('click', () => { setPanel(false); scrollTo('#lit'); });
  {
    const reset = $('.wpanel__reset');
    let armed = 0;
    reset.addEventListener('click', () => {
      if (!st.lit.length) return;
      if (!armed) {
        reset.textContent = 'לחיצה נוספת תכבה את כולם';
        armed = setTimeout(() => { armed = 0; reset.textContent = 'לכבות את כל החלונות'; }, 3500);
        return;
      }
      clearTimeout(armed); armed = 0;
      reset.textContent = 'לכבות את כל החלונות';
      st.lit = [];
      save(st);
      end.reset();
      sync();
    });
  }

  function goTo(w) {
    const g = w.go;
    if (g.timeline) return goTimeline($(g.timeline));
    const spec = g.all || (innerWidth > 860 ? g.wide : g.narrow);
    if (Array.isArray(spec)) {
      const el = $(spec[0]);
      if (!el) return;
      scrollTo(el.getBoundingClientRect().top + scrollY + spec[1] * (el.offsetHeight - innerHeight));
      return;
    }
    const el = $(spec);
    if (!el) return;
    const r = el.getBoundingClientRect();
    scrollTo(Math.max(0, r.top + scrollY + r.height / 2 - innerHeight / 2));
  }
  // the timeline is pinned and moves sideways: find the scroll position that centres the photograph
  function goTimeline(img) {
    const tlEl = $('.timeline'), track = $('.timeline__track');
    const tr = ScrollTrigger.getAll().find((s) => s.trigger === tlEl && s.pin);
    const item = img && img.closest('.tl');
    if (!tr || !item) { scrollTo('#numbers'); return; }
    const dist = Math.max(1, track.scrollWidth - innerWidth);
    const xNow = +gsap.getProperty(track, 'x') || 0;
    const r = item.getBoundingClientRect();
    const c0 = r.left + r.width / 2 - xNow;
    const p = Math.min(1, Math.max(0, (innerWidth / 2 - c0) / dist));
    scrollTo(tr.start + p * (tr.end - tr.start));
  }

  // ---------- lighting a window
  function light(it) {
    const { w } = it;
    if (isLit(w)) {
      toast({ n: `חלון דולק · ${w.ch} ${w.name}`, t: w.fact });
      return;
    }
    st.lit.push(w.id);
    st.intro = true;
    save(st);
    it.el.classList.add('is-pop');
    setTimeout(() => it.el.classList.remove('is-pop'), 1800);
    sync(it.i);
    const n = st.lit.length;
    if (n >= total) {
      const r = $('#lit').getBoundingClientRect(), here = r.top < innerHeight && r.bottom > 0;
      toast({
        n: `חלון ${n} מתוך ${total} · ${w.ch} ${w.name}`, t: w.fact,
        more: here ? 'כל החלונות דולקים.' : 'כל החלונות דולקים. בסוף הדף הבניין מואר, ומחכה לכם כרטיס קורא.',
        go: here ? null : () => scrollTo('#lit'), label: 'לבניין בערב', ms: 16000,
      });
      strip.classList.remove('is-wave'); void strip.offsetWidth; strip.classList.add('is-wave');
    } else {
      toast({ n: `חלון ${n} מתוך ${total} · ${w.ch} ${w.name}`, t: w.fact, ms: 10000 });
    }
  }

  // ---------- the end of the page: the building in the evening
  const end = (() => {
    const sec = $('#lit'), on = $('.lit__on'), layers = $$('.lit__on');
    const title = $('.lit__title'), body = $('.lit__body'), card = $('.card');
    const alpha = items.map((it) => ({ a: isLit(it.w) ? 1 : 0 })), all = { a: 0 };
    let played = false;
    const mask = () => {
      const W = on.offsetWidth, H = on.offsetHeight;
      if (!W || !H) return;
      // the photograph's object-position changes with the layout (see style.css)
      const op = getComputedStyle(on).objectPosition.split(' ').map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : 0.5));
      const [px0, py0] = op.length === 2 && op.every(isFinite) ? op : END.pos;
      const [nw, nh] = END.nat, s = Math.max(W / nw, H / nh);
      const ox = (W - nw * s) * px0, oy = (H - nh * s) * py0;
      const rx = 0.05 * nw * s, ry = 0.12 * nh * s;
      const spots = alpha.map(({ a }, i) => {
        const [u, v] = SPOTS[i % SPOTS.length];
        return `radial-gradient(${rx.toFixed(0)}px ${ry.toFixed(0)}px at ${(ox + u * nw * s).toFixed(0)}px ${(oy + v * nh * s).toFixed(0)}px, rgba(0,0,0,${a.toFixed(3)}), rgba(0,0,0,${(a * 0.55).toFixed(3)}) 55%, rgba(0,0,0,0))`;
      });
      spots.push(`linear-gradient(rgba(0,0,0,${all.a.toFixed(3)}),rgba(0,0,0,${all.a.toFixed(3)}))`);
      const m = spots.join(',');
      layers.forEach((el) => { el.style.webkitMaskImage = m; el.style.maskImage = m; });
    };
    addEventListener('resize', mask);

    const copy = () => {
      const n = st.lit.length;
      if (n >= total) {
        title.textContent = 'כל החלונות דולקים';
        body.textContent = `${COUNT_F[total]} החלונות שמצאתם מאירים עכשיו את החזית. כתבו שם, ונכין לכם כרטיס קורא: מזכרת מהסיור בבניין.`;
      } else {
        title.textContent = `${COUNT[total]} חלונות`;
        const left = [...new Set(items.filter((it) => !isLit(it.w)).map((it) => it.w.ch))];
        body.textContent = n === 0
          ? `לבניין יש כ־250 חלונות. ${COUNT[total]} מהם מסתתרים בצילומים ובמודל שלאורך הסיור, וכל חלון שמדליקים מאיר כאן חלק מהחזית. כשכולם דולקים, מחכה כאן כרטיס קורא.`
          : `כל חלון שמדליקים מאיר כאן חלק מהחזית. החלונות שנותרו מסתתרים ${chapters(left)}.`;
      }
    };

    // the last window lights the whole front, once the visitor is here to see it
    const playDone = (instant) => {
      if (played) return;
      played = true;
      sec.classList.add('is-done');
      card.hidden = false;
      cardApi.draw();
      ScrollTrigger.refresh();
      if (instant || RM) { all.a = 1; mask(); return; }
      gsap.to(all, { a: 1, duration: 2.6, ease: 'power2.inOut', delay: 0.3, onUpdate: mask });
      gsap.from(card, { opacity: 0, y: 40, duration: 1.4, ease: 'expo.out', delay: 1.2 });
    };
    ScrollTrigger.create({ trigger: sec, start: 'top 55%', onEnter: () => st.lit.length >= total && playDone(false) });

    return {
      update(fresh) {
        copy();
        if (fresh >= 0) gsap.to(alpha[fresh], { a: 1, duration: RM ? 0 : 1.6, ease: 'power2.out', onUpdate: mask });
        else { items.forEach((it, i) => { alpha[i].a = isLit(it.w) ? 1 : 0; }); mask(); }
        if (st.lit.length >= total) {
          const r = sec.getBoundingClientRect();
          if (fresh < 0) playDone(true);                                   // already complete on arrival
          else if (r.top < innerHeight * 0.55 && r.bottom > 0) playDone(false);
        }
      },
      reset() {
        played = false; all.a = 0;
        sec.classList.remove('is-done');
        gsap.killTweensOf(all); alpha.forEach((o) => gsap.killTweensOf(o));
        card.hidden = true;
        ScrollTrigger.refresh();
      },
    };
  })();

  // ---------- the card
  const cardApi = (() => {
    const cv = $('.card__cv'), input = $('.card__input'), form = $('.card__form'), share = $('.card__share');
    const date = new Date().toLocaleDateString('he-IL');
    input.value = st.name || '';
    const draw = () => drawCard(cv, input.value.trim(), total, date);
    if (document.fonts) Promise.all([document.fonts.load('300 106px Hadassah'), document.fonts.load('400 70px Hadassah')]).then(draw, draw);
    input.addEventListener('input', () => { st.name = input.value.trim(); save(st); draw(); });
    const png = () => new Promise((res) => { draw(); cv.toBlob(res, 'image/png'); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      const blob = await png();
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'reader-card.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
    try {
      if (navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' })] })) {
        share.hidden = false;
        share.addEventListener('click', async () => {
          if (!input.value.trim()) { input.focus(); return; }
          const blob = await png();
          try { await navigator.share({ files: [new File([blob], 'reader-card.png', { type: 'image/png' })], title: 'כרטיס קורא' }); } catch (err) { /* closed by the visitor */ }
        });
      }
    } catch (err) { /* no sharing here */ }
    return { draw };
  })();

  $('.lit__open').addEventListener('click', () => setPanel(true));

  // ---------- everything that shows the count
  function sync(fresh = -1) {
    const n = st.lit.length;
    $$('.wins__n').forEach((el) => (el.textContent = n));
    items.forEach((it, i) => {
      const on = isLit(it.w);
      it.el.classList.toggle('is-lit', on);
      if (on) it.el.style.removeProperty('--near');
      stars[i].classList.toggle('is-lit', on);
      endStars[i].classList.toggle('is-lit', on);
      const li = plist.children[i];
      li.classList.toggle('is-lit', on);
      $('.wpanel__t', li).textContent = on ? it.w.fact : it.w.hint;
    });
    if (fresh >= 0) { const s = stars[fresh]; s.classList.remove('is-new'); void s.offsetWidth; s.classList.add('is-new'); }
    strip.setAttribute('aria-label', `חלונות: ${n} מתוך ${total} דולקים`);
    $('.wpanel__end').textContent = n >= total ? 'לבניין המואר ולכרטיס' : 'לבניין בערב';
    end.update(fresh);
  }
  sync();

  return {
    // after the loader: on a first visit, once the tour starts moving (so the message does not
    // cover the opening title), say what the stars in the bar are
    ready() {
      if (st.intro || st.lit.length) return;
      const show = () => {
        if (st.intro) return;
        st.intro = true;
        save(st);
        removeEventListener('scroll', onScroll);
        if (nav.classList.contains('is-open') || nav.classList.contains('is-wins')) return;
        strip.classList.add('is-hint');
        setTimeout(() => strip.classList.remove('is-hint'), 5200);
        toast({
          n: `${COUNT[total]} חלונות`,
          t: `${COUNT[total]} מהחלונות של הבניין מסתתרים בצילומים ובמודל שלאורך הסיור. חלון נסתר מנצנץ מדי פעם, ולחיצה עליו מדליקה אותו.`,
          go: () => setPanel(true), label: 'איפה לחפש', ms: 13000, stay: true,
        });
      };
      const onScroll = () => { if (scrollY > innerHeight * 0.3) show(); };
      addEventListener('scroll', onScroll, { passive: true });
    },
    closePanel: () => setPanel(false),
  };
}
