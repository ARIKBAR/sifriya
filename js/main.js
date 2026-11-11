import { createScene } from './scene.js';
import { createDepthPhoto } from './depth.js';
import { createStoneWall } from './stones.js';
import { starReveal } from './aperture.js';

const { gsap, ScrollTrigger, Lenis } = window;
gsap.registerPlugin(ScrollTrigger);

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH = matchMedia('(hover: none), (pointer: coarse)').matches;
const WIDE = matchMedia('(min-width: 861px)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const lerp = (a, b, t) => a + (b - a) * t;
const c01 = (t) => Math.min(1, Math.max(0, t));

// where a point of a photo lands on screen when the photo is fitted with object-fit: cover
const coverPoint = (W, H, nat, pos, pt) => {
  const s = Math.max(W / nat[0], H / nat[1]);
  return [(W - nat[0] * s) * pos[0] + pt[0] * nat[0] * s, (H - nat[1] * s) * pos[1] + pt[1] * nat[1] * s];
};

/* ------------------------------------------------------------ smooth scroll */
let lenis = null;
if (!RM) {
  lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9, touchMultiplier: 1.3 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  lenis.stop();
}
const scrollTo = (target, opts = {}) => {
  if (lenis) lenis.scrollTo(target, { duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 3), ...opts });
  else if (typeof target === 'number') window.scrollTo(0, target);
  else document.querySelector(target)?.scrollIntoView();
};

/* ------------------------------------------------------------ text splitting */
function splitChars(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.textContent = '';
  const chars = [];
  words.forEach((w, i) => {
    const m = document.createElement('span');
    m.className = 'split-m';
    [...w].forEach((ch) => { const c = document.createElement('span'); c.className = 'split-c'; c.textContent = ch; m.appendChild(c); chars.push(c); });
    el.appendChild(m);
    if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
  });
  return chars;
}
function splitWords(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.textContent = '';
  return words.map((w, i) => {
    const s = document.createElement('span');
    s.className = 'w'; s.textContent = w;
    el.appendChild(s);
    if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    return s;
  });
}
const splitMap = new Map();
$$('[data-split]').forEach((el) => splitMap.set(el, splitChars(el)));

/* ------------------------------------------------------------ the star aperture
   Images open through the gap between four rounded stones — the building's window. */
function starIn(el, { trigger = el, start = 'top 82%', duration = 1.7, ...opts } = {}) {
  if (RM || !el) return;
  const set = starReveal(el, opts), o = { p: 0 };
  set(0);
  gsap.to(o, { p: 1, duration, ease: 'power3.inOut', onUpdate: () => set(o.p), scrollTrigger: { trigger, start, toggleActions: 'play none none reverse' } });
}

/* ------------------------------------------------------------ hero (photo in depth) */
let hero = null;
try {
  hero = createDepthPhoto($('.hero__gl'), { src: 'assets/img/hero.jpg', depth: 'assets/img/hero-depth.jpg', imgSize: [2560, 1440], anchor: [0.42, 0.5] });
  hero.ready.catch(() => {});
} catch (err) { console.warn('hero depth effect off', err); }

/* ------------------------------------------------------------ 3D */
let scene = null;
try {
  scene = createScene($('.gl'));
  window.__scene = scene;
} catch (err) {
  console.warn('WebGL unavailable, falling back to images', err);
  document.body.classList.add('no-gl');
}

/* ------------------------------------------------------------ loader
   A wall of the building's stones. The hero first shows through the star-shaped
   gaps between them, then the stones shrink away. */
const loader = $('.loader');
const num = $('.loader__num'), line = $('.loader__line i');
const count = { v: 0 };
const setCount = () => { num.textContent = Math.round(count.v); line.style.transform = `scaleX(${count.v / 100})`; };
const preTween = gsap.to(count, { v: 85, duration: 1.8, ease: 'power2.inOut', onUpdate: setCount });
const ready = Promise.all([
  document.fonts ? document.fonts.ready : Promise.resolve(),
  hero ? hero.ready.catch(() => {}) : Promise.resolve(),
  new Promise((r) => setTimeout(r, RM ? 200 : 1200)),
]);
let wall = null;
if (!RM) {
  try { wall = createStoneWall($('.loader__wall'), { focus: [0.42, 0.6] }); loader.classList.add('has-wall'); } catch (err) { wall = null; }
}
ready.then(() => {
  preTween.kill();
  const tl = gsap.timeline()
    .to(count, { v: 100, duration: 0.5, ease: 'power3.out', onUpdate: setCount })
    .to('.loader__inner', { opacity: 0, duration: 0.45, ease: 'power2.in' }, '+=0.1');
  if (wall) {
    tl.to(wall.state, { open: 1, duration: 1.2, ease: 'power1.inOut', onUpdate: wall.draw })
      .add(() => { hero && hero.intro(); heroIn(); }, '-=0.15')
      .to(wall.state, { shrink: 1, duration: 1.5, ease: 'power2.inOut', onUpdate: wall.draw }, '-=0.15');
  } else {
    tl.add(() => { hero && hero.intro(); heroIn(); })
      .to(loader, { opacity: 0, duration: 0.9, ease: 'power2.inOut' }, '-=0.1');
  }
  tl.add(() => {
    wall && wall.destroy();
    loader.remove();
    document.body.classList.remove('is-loading');
    lenis && lenis.start();
    ScrollTrigger.refresh();
  });
});

function heroIn() {
  const chars = $$('.hero__title .split-c');
  gsap.from(chars, { yPercent: 105, duration: 1.4, ease: 'expo.out', stagger: 0.035, delay: 0.1 });
  gsap.from('.hero__top > *, .hero__bottom > *, .nav__pill', { y: 18, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.07, delay: 0.5 });
}

ScrollTrigger.create({
  trigger: '#hero', start: 'top top', end: 'bottom top',
  onUpdate: (s) => hero && hero.setScroll(s.progress),
  onToggle: (s) => hero && hero.setRunning(s.isActive),
});
gsap.to('.hero__title, .hero__bottom, .hero__top', { yPercent: -18, opacity: 0, ease: 'none', scrollTrigger: { trigger: '#hero', start: 'top top', end: '80% top', scrub: true } });

/* ------------------------------------------------------------ 3D ↔ scroll */
{
  const gl = $('.gl'), el = $('#monolith');
  const prog = ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom', onUpdate: (s) => scene && scene.set('monolith', s.progress) });
  ScrollTrigger.create({
    trigger: el, start: 'top bottom', end: 'bottom top',
    onToggle: (s) => {
      if (s.isActive && scene) {
        // cut, don't fly: the camera starts exactly where the section wants it
        scene.set('monolith', prog.progress);
        scene.jump();
        scene.playIntro();
      }
      scene && scene.setActive(s.isActive);
      gl.classList.toggle('is-on', s.isActive);
    },
  });
}

/* ------------------------------------------------------------ site */
{
  const words = splitWords($('.site__p'));
  if (WIDE && !RM) {
    const tl = gsap.timeline({ scrollTrigger: { trigger: '.site', start: 'top top', end: 'bottom bottom', scrub: 0.5 } });
    tl.fromTo(words, { opacity: 0.14 }, { opacity: 1, stagger: 0.1, duration: 0.6, ease: 'none' }, 0);
    const D = Math.max(tl.duration(), 1);
    tl.fromTo('.site__fig--a', { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: D * 0.45, ease: 'power2.out' }, 0)
      .fromTo('.site__fig--a img', { scale: 1.2 }, { scale: 1, duration: D, ease: 'none' }, 0)
      .fromTo('.site__fig--b', { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: D * 0.45, ease: 'power2.out' }, D * 0.4)
      .fromTo('.site__fig--b img', { scale: 1.25 }, { scale: 1, duration: D * 0.6, ease: 'none' }, D * 0.4);
  } else {
    gsap.from('.site__fig', { clipPath: 'inset(100% 0% 0% 0%)', duration: 1.4, ease: 'expo.out', stagger: 0.15, scrollTrigger: { trigger: '.site__media', start: 'top 80%' } });
  }
}

/* ------------------------------------------------------------ 3D chapters */
{
  const chaps = $$('.chap');
  const countEl = $('.stage__count b'), bar = $('.stage__bar i');
  let curI = -1;
  const show = (i) => {
    if (i === curI) return;
    const prev = chaps[curI];
    if (prev) gsap.to(prev, { opacity: 0, y: -16, duration: 0.45, ease: 'power2.in', onComplete: () => gsap.set(prev, { visibility: 'hidden' }) });
    gsap.fromTo(chaps[i], { visibility: 'visible', opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.9, delay: prev ? 0.3 : 0, ease: 'expo.out' });
    countEl.textContent = String(i + 1).padStart(2, '0');
    curI = i;
    scene && scene.setHot(i);
  };
  const sync = (s) => {
    const p = s.progress;
    show(p < 0.23 ? 0 : p < 0.53 ? 1 : p < 0.8 ? 2 : 3);
    bar.style.transform = `scaleY(${p})`;
  };
  ScrollTrigger.create({
    trigger: '#monolith', start: 'top top', end: 'bottom bottom',
    onUpdate: sync, onEnter: sync,
    onLeave: () => scene && scene.setHot(-1),
    onLeaveBack: () => scene && scene.setHot(-1),
    onEnterBack: (s) => { sync(s); scene && scene.setHot(curI); },
  });
  if (RM) chaps.forEach((c) => gsap.set(c, { opacity: 1, visibility: 'visible' }));
  // the rail text sits on a sky that turns dark at the end
  ScrollTrigger.create({ trigger: '#monolith', start: '82% bottom', end: 'bottom top', toggleClass: { targets: '.stage', className: 'is-night' } });
}

/* ------------------------------------------------------------ titles + paragraphs */
$$('.big-title, .light__title').forEach((el) => {
  const chars = splitMap.get(el);
  if (!chars) return;
  gsap.from(chars, { yPercent: 105, duration: 1.3, ease: 'expo.out', stagger: 0.03, scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none reverse' } });
});
$$('.facade__lead, .joints__head, .light__copy > *, .ucard > :not(figure), .foot__grid > *').forEach((el) => {
  gsap.from(el, { y: 30, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
});
$$('.ucard__fig, .joints__fig').forEach((el) => starIn(el));
if (!RM) $$('.light__fig').forEach((el) => gsap.from(el, { clipPath: 'inset(14% 14% 14% 14% round 24px)', duration: 1.5, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 80%', toggleActions: 'play none none reverse' } }));
if (!RM) gsap.from('.light__fig2', { y: 60, opacity: 0, duration: 1.3, ease: 'expo.out', scrollTrigger: { trigger: '.light__fig2', start: 'top 92%', toggleActions: 'play none none reverse' } });

/* ------------------------------------------------------------ counters */
const fmt = (n) => Math.round(n).toLocaleString('en-US');
function runCounter(el) {
  if (el.dataset.done) return;
  el.dataset.done = 1;
  const o = { v: 0 }, to = +el.dataset.count;
  gsap.to(o, { v: to, duration: 1.6, ease: 'power3.out', onUpdate: () => (el.textContent = fmt(o.v)) });
}
$$('.odo').forEach((el) => {
  if (el.closest('.triptych')) return;
  ScrollTrigger.create({ trigger: el, start: 'top 90%', onEnter: () => runCounter(el) });
});

/* ------------------------------------------------------------ facade torch */
{
  const torch = $('.torch');
  const st = { x: 0.5, y: 0.5, r: 0 }, tg = { x: 0.5, y: 0.5, r: 0 };
  let inView = false;
  torch.addEventListener('pointermove', (e) => {
    const b = torch.getBoundingClientRect();
    tg.x = (e.clientX - b.left) / b.width; tg.y = (e.clientY - b.top) / b.height; tg.r = Math.min(320, b.width * 0.3);
  });
  torch.addEventListener('pointerleave', () => { tg.r = 0; });
  ScrollTrigger.create({ trigger: torch, start: 'top bottom', end: 'bottom top', onToggle: (s) => (inView = s.isActive) });
  gsap.ticker.add((t) => {
    if (!inView) return;
    if (TOUCH) { tg.x = 0.5 + Math.sin(t * 0.35) * 0.3; tg.y = 0.5 + Math.cos(t * 0.27) * 0.22; tg.r = 200; }
    st.x += (tg.x - st.x) * 0.1; st.y += (tg.y - st.y) * 0.1; st.r += (tg.r - st.r) * 0.08;
    torch.style.setProperty('--x', `${st.x * 100}%`);
    torch.style.setProperty('--y', `${st.y * 100}%`);
    torch.style.setProperty('--r', `${st.r}px`);
  });
  gsap.fromTo('.torch img', { scale: 1.12 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: torch, start: 'top bottom', end: 'bottom top', scrub: true } });
}

/* ------------------------------------------------------------ joints: how a window is made */
{
  const cv = $('.joints__cv');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, cell = 0, cols = 0, rows = 0, val = [], shade = [];
  const p = { x: -1e4, y: -1e4 };
  let inView = false;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.width = Math.round(cv.clientWidth * dpr);
    H = cv.height = Math.round(cv.clientHeight * dpr);
    cell = W / (innerWidth < 700 ? 6 : 8);
    cols = Math.ceil(W / cell) + 1; rows = Math.ceil(H / cell) + 1;
    val = new Array(cols * rows).fill(0);
    shade = Array.from({ length: cols * rows }, () => Math.random());
  };
  resize();
  addEventListener('resize', resize);
  cv.addEventListener('pointermove', (e) => { const b = cv.getBoundingClientRect(); p.x = (e.clientX - b.left) * (W / b.width); p.y = (e.clientY - b.top) * (H / b.height); });
  cv.addEventListener('pointerleave', () => { p.x = p.y = -1e4; });
  ScrollTrigger.create({ trigger: cv, start: 'top bottom', end: 'bottom top', onToggle: (s) => (inView = s.isActive) });
  gsap.ticker.add((t) => {
    if (!inView) return;
    if (TOUCH) { p.x = W * (0.5 + Math.sin(t * 0.5) * 0.38); p.y = H * (0.5 + Math.sin(t * 0.37) * 0.32); }
    const x0 = (W % cell) / 2 - cell / 2, y0 = (H % cell) / 2 - cell / 2, R = cell * 1.5;
    ctx.fillStyle = '#2a261f'; ctx.fillRect(0, 0, W, H);
    // the gaps (behind the stones)
    for (let j = 1; j < rows; j++) for (let i = 1; i < cols; i++) {
      const k = j * cols + i, jx = x0 + i * cell, jy = y0 + j * cell;
      const tgt = Math.max(0, 1 - Math.hypot(jx - p.x, jy - p.y) / R);
      val[k] = tgt > val[k] ? val[k] + (tgt - val[k]) * 0.25 : val[k] * 0.985;
      const v = val[k];
      if (v < 0.01) continue;
      const s = cell * 0.5;
      const g = ctx.createRadialGradient(jx, jy, 0, jx, jy, s);
      g.addColorStop(0, `rgba(255,226,170,${v})`); g.addColorStop(0.35, `rgba(255,190,110,${v * 0.9})`); g.addColorStop(1, 'rgba(200,130,60,0)');
      ctx.fillStyle = g; ctx.fillRect(jx - s, jy - s, s * 2, s * 2);
    }
    // the stones
    const gap = cell * 0.03, rad = cell * 0.36;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const sh = shade[j * cols + i];
      ctx.fillStyle = `rgb(${214 + sh * 18 | 0},${203 + sh * 18 | 0},${180 + sh * 18 | 0})`;
      ctx.beginPath(); ctx.roundRect(x0 + i * cell + gap, y0 + j * cell + gap, cell - gap * 2, cell - gap * 2, rad); ctx.fill();
    }
  });
}

/* ------------------------------------------------------------ reading hall */
gsap.fromTo('.well__fig img', { scale: 1.16 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '#well', start: 'top bottom', end: 'bottom bottom', scrub: true } });
gsap.from('.well__body', { opacity: 0, y: 24, ease: 'none', scrollTrigger: { trigger: '#well', start: 'top top', end: '20% top', scrub: true } });

/* ------------------------------------------------------------ triptych zoom */
{
  const tl = gsap.timeline({ scrollTrigger: { trigger: '.triptych', start: 'top top', end: 'bottom bottom', scrub: 0.6,
    onUpdate: (s) => { if (s.progress > 0.62) $$('.triptych .odo').forEach(runCounter); } } });
  tl.to('.tri--center', { width: '100vw', height: '100vh', ease: 'power2.inOut', duration: 1 }, 0)
    .fromTo('.tri--center img', { scale: 1.15 }, { scale: 1, ease: 'none', duration: 1 }, 0)
    .to('.tri--r', { xPercent: 40, opacity: 0, ease: 'power2.in', duration: 0.7 }, 0)
    .to('.tri--l', { xPercent: -40, opacity: 0, ease: 'power2.in', duration: 0.7 }, 0)
    .to('.triptych__cap', { opacity: 1, duration: 0.3 }, 0.7)
    .from('.triptych__cap p', { y: 30, stagger: 0.1, duration: 0.3 }, 0.7);
}

/* ------------------------------------------------------------ descent: through the eye of the stair
   1. a circle opens from the stair's central void until the photo fills the screen
   2. hold, caption
   3. the scroll dives into the void: the photo grows around it and the dark circle swallows the screen */
if (!RM) {
  const view = $('.descent__view'), img = $('.descent__img'), dark = $('.descent__dark');
  const rings = $$('.descent__rings circle');
  const NAT = [2112, 1968], VOID = [0.495, 0.505], POS = [0.5, 0.5]; // photo size, void centre in the photo, object-position
  const st = { open: 0, dive: 0 };
  let vx = 0, vy = 0, R = 0, r0 = 0;
  const render = () => {
    const o = st.open, d = st.dive;
    const ap = lerp(r0, R, o);
    view.style.clipPath = o >= 0.999 ? 'none' : `circle(${ap}px at ${vx}px ${vy}px)`;
    img.style.transform = `rotate(${lerp(-8, 0, o) + 10 * d}deg) scale(${lerp(1.28, 1, o) * (1 + 6.5 * d * d)})`;
    const dk = R * 1.12 * Math.pow(c01((d - 0.22) / 0.78), 1.5);
    dark.style.background = dk < 1 ? 'none' : `radial-gradient(circle at ${vx}px ${vy}px, #16140f 0, #16140f ${(dk * 0.86).toFixed(1)}px, rgba(22,20,15,0) ${dk.toFixed(1)}px)`;
    rings.forEach((c, i) => {
      let r, a;
      if (d <= 0) { r = ap * (1 + 0.1 * (i + 1)) + 10 * (i + 1); a = 0.5 * Math.pow(1 - o, 1.4); }   // ripples ahead of the opening
      else { r = R * Math.pow(c01((d - 0.22 + 0.075 * (i + 1)) / 0.78), 1.5); a = 0.42 * c01(d * 6) * (1 - d); } // …and ahead of the dark
      c.setAttribute('r', r.toFixed(1));
      c.style.opacity = a.toFixed(3);
    });
  };
  const measure = () => {
    const W = innerWidth, H = innerHeight;
    [vx, vy] = coverPoint(W, H, NAT, POS, VOID);
    R = Math.hypot(Math.max(vx, W - vx), Math.max(vy, H - vy)) + 4;
    r0 = Math.min(W, H) * 0.16;
    img.style.transformOrigin = `${vx}px ${vy}px`;
    rings.forEach((c) => { c.setAttribute('cx', vx); c.setAttribute('cy', vy); });
    render();
  };
  measure();
  addEventListener('resize', measure);
  gsap.timeline({ scrollTrigger: { trigger: '#descent', start: 'top top', end: 'bottom bottom', scrub: 0.5 }, onUpdate: render })
    .to(st, { open: 1, duration: 0.3, ease: 'power2.inOut' }, 0)
    .to('.descent__cap', { opacity: 1, duration: 0.06 }, 0.3)
    .to('.descent__cap', { opacity: 0, duration: 0.06 }, 0.5)
    .to(st, { dive: 1, duration: 0.44, ease: 'power1.in' }, 0.54)
    .to({}, { duration: 0.02 }); // hold on black
}

/* ------------------------------------------------------------ the store: arrive out of the dark, then travel down the aisle */
{
  const img = $('.store__img');
  const NAT = [1707, 2560], VP = [0.5, 0.17], POS = [0.5, 0.07]; // photo size, vanishing point, object-position
  const place = () => { const [x, y] = coverPoint(innerWidth, innerHeight, NAT, POS, VP); img.style.transformOrigin = `${x}px ${y}px`; };
  place();
  addEventListener('resize', place);
  if (!RM) {
    gsap.fromTo('.store__fig', { opacity: 0 }, { opacity: 1, ease: 'none', scrollTrigger: { trigger: '#vault', start: 'top 55%', end: 'top top', scrub: true } });
    gsap.fromTo(img, { scale: 1 }, { scale: 1.7, ease: 'none', scrollTrigger: { trigger: '#vault', start: 'top bottom', end: 'bottom bottom', scrub: 0.5 } });
    gsap.fromTo('.store__text', { opacity: 0, y: 30 }, { opacity: 1, y: 0, ease: 'none', scrollTrigger: { trigger: '#vault', start: 'top 25%', end: 'top top', scrub: true } });
  }
  gsap.to('.vault__stats li', { opacity: 1, y: 0, stagger: 0.1, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '#vault', start: '10% top', toggleActions: 'play none none reverse' } });
}

/* ------------------------------------------------------------ light */
gsap.fromTo('.light__img', { yPercent: -6, scale: 1.08 }, { yPercent: 6, scale: 1, ease: 'none', scrollTrigger: { trigger: '.light__hero', start: 'top bottom', end: 'bottom top', scrub: true } });
$$('.light__fig img').forEach((im) => gsap.fromTo(im, { yPercent: -10 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: im.parentNode, start: 'top bottom', end: 'bottom top', scrub: true } }));

/* ------------------------------------------------------------ spaces: a list; the photograph opens through the star */
{
  const rows = $$('.space'), stage = $('.spaces__stage');
  if (stage && WIDE) {
    const layers = rows.map((li, i) => {
      const img = li.querySelector('img').cloneNode();
      img.removeAttribute('loading');
      stage.appendChild(img);
      const set = starReveal(img);
      set(i === 0 ? 1 : 0);
      return { img, set, o: { p: i === 0 ? 1 : 0 } };
    });
    let cur = 0, z = 1;
    const show = (i) => {
      if (i === cur) return;
      rows[cur].classList.remove('is-on');
      rows[i].classList.add('is-on');
      const L = layers[i];
      L.img.style.zIndex = ++z;
      gsap.killTweensOf(L.o);
      L.o.p = 0; L.set(0);
      gsap.to(L.o, { p: 1, duration: RM ? 0 : 1.1, ease: 'power3.inOut', onUpdate: () => L.set(L.o.p) });
      if (!RM) gsap.fromTo(L.img, { scale: 1.12 }, { scale: 1, duration: 1.4, ease: 'power3.out' });
      cur = i;
    };
    rows.forEach((li, i) => {
      li.addEventListener('pointerenter', () => show(i));
      li.querySelector('button').addEventListener('focus', () => show(i));
      li.querySelector('button').addEventListener('click', () => show(i));
    });
  }
}

/* ------------------------------------------------------------ timeline (horizontal, with photographs) */
{
  const tlEl = $('.timeline'), track = $('.timeline__track'), items = $$('.tl');
  const imgs = items.map((it) => it.querySelector('img'));
  const dist = () => Math.max(0, track.scrollWidth - innerWidth);
  const update = (p) => {
    $('.timeline__line i').style.transform = `scaleX(${p})`;
    items.forEach((it, i) => {
      const b = it.getBoundingClientRect();
      it.classList.toggle('is-on', b.right > innerWidth * 0.12 && b.left < innerWidth * 0.88);
      // each photograph drifts a little inside its frame as it crosses the screen
      if (imgs[i] && !RM) imgs[i].style.transform = `translate3d(${(-7 * Math.max(-1, Math.min(1, (b.left + b.width / 2 - innerWidth / 2) / innerWidth))).toFixed(2)}%,0,0)`;
    });
  };
  gsap.to(track, {
    x: () => dist(), ease: 'none',
    // driven by the tween itself, so the items are measured where the (smoothed) track really is
    onUpdate() { update(this.progress()); },
    scrollTrigger: { trigger: tlEl, start: 'top top', end: () => `+=${dist() + innerHeight * 0.5}`, pin: true, scrub: 0.5, invalidateOnRefresh: true, onRefresh: (s) => update(s.progress) },
  });
}
$('.foot__top').addEventListener('click', () => scrollTo(0, { duration: 2.2 }));

/* ------------------------------------------------------------ chapter indicator */
{
  const n = $('.chapter-ind__num'), nm = $('.chapter-ind__name'), bar = $('.chapter-ind__bar i');
  // found by position on every scroll, so jumps and the pinned timeline cannot leave it stale
  const secs = $$('[data-chapter]');
  const pick = () => {
    const mid = innerHeight / 2;
    let found = secs[0];
    for (const s of secs) { if (s.getBoundingClientRect().top <= mid) found = s; else break; }
    if (n.textContent === found.dataset.chapter) return;
    n.textContent = found.dataset.chapter; nm.textContent = found.dataset.name;
    gsap.fromTo([n, nm], { opacity: 0 }, { opacity: 1, duration: 0.5 });
  };
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (s) => { bar.style.transform = `scaleX(${s.progress})`; pick(); } });
}

/* ------------------------------------------------------------ nav + menu */
{
  const nav = $('.nav'), btn = $('.nav__menu');
  const links = $$('.menu a b');
  const toggle = (open) => {
    nav.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open);
    if (open) gsap.fromTo(links, { yPercent: 100 }, { yPercent: 0, duration: 0.9, ease: 'expo.out', stagger: 0.04, delay: 0.12 });
  };
  btn.addEventListener('click', () => toggle(!nav.classList.contains('is-open')));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
  $$('[data-scroll]').forEach((a) => a.addEventListener('click', (e) => {
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('#')) return;
    e.preventDefault();
    toggle(false);
    scrollTo(href === '#hero' ? 0 : href);
  }));
}

/* ------------------------------------------------------------ cursor: the star between four stones */
if (!TOUCH) {
  const cur = $('.cursor'), star = $('.cursor__star');
  const sx = gsap.quickSetter(star, 'x', 'px'), sy = gsap.quickSetter(star, 'y', 'px');
  cur.classList.add('is-hidden');
  addEventListener('pointermove', (e) => { sx(e.clientX); sy(e.clientY); cur.classList.remove('is-hidden'); });
  document.addEventListener('pointerleave', () => cur.classList.add('is-hidden'));
  document.addEventListener('pointerover', (e) => cur.classList.toggle('is-link', !!e.target.closest('a, button, [data-hover]')));
  addEventListener('pointerdown', () => cur.classList.add('is-down'));
  addEventListener('pointerup', () => cur.classList.remove('is-down'));
}

// triggers were created section by section, not strictly top to bottom; sort them so
// everything below the pinned timeline is measured after its pin spacing exists
ScrollTrigger.sort();
addEventListener('load', () => { ScrollTrigger.sort(); ScrollTrigger.refresh(); });
