/* Солнечная система — Claude Sonnet 5.5
   Canvas 2D, без библиотек. Собственная 3D-проекция, попиксельное освещение шаров
   (процедурные текстуры, ночная сторона, кольца, тени колец и лун), кеплеровы орбиты. */
(function () {
'use strict';

/* ───────────── математика ───────────── */
const PI = Math.PI, TAU = PI * 2, INV2PI = 1 / TAU, INVPI = 1 / PI;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const D2R = PI / 180;

/* ───────────── шум ───────────── */
let NSEED = 0;
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(NSEED, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  fz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash3(ix, iy, iz), b = hash3(ix + 1, iy, iz), c = hash3(ix, iy + 1, iz), d = hash3(ix + 1, iy + 1, iz);
  const e = hash3(ix, iy, iz + 1), f = hash3(ix + 1, iy, iz + 1), g = hash3(ix, iy + 1, iz + 1), h = hash3(ix + 1, iy + 1, iz + 1);
  const x1 = a + (b - a) * fx, x2 = c + (d - c) * fx, x3 = e + (f - e) * fx, x4 = g + (h - g) * fx;
  const y1 = x1 + (x2 - x1) * fy, y2 = x3 + (x4 - x3) * fy;
  return y1 + (y2 - y1) * fz;
}
function fbm(x, y, z, oct) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x, y, z); n += a;
    x = x * 2.03 + 11.7; y = y * 2.03 + 3.1; z = z * 2.03 + 7.3; a *= 0.5;
  }
  return s / n;
}
/* кратеры: чаша + валик; возвращает высоту примерно в [-0.9, 0.55] */
function craters(x, y, z, f, off) {
  x *= f; y *= f; z *= f;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const sv = NSEED; NSEED += off;
  let best = 9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const cx = ix + a, cy = iy + b, cz = iz + c;
    if (hash3(cx, cy, cz) < 0.5) continue;
    const px = cx + hash3(cx + 17, cy, cz), py = cy + hash3(cx, cy + 31, cz), pz = cz + hash3(cx, cy, cz + 53);
    const dx = x - px, dy = y - py, dz = z - pz;
    const r = 0.16 + 0.34 * hash3(cx + 5, cy + 9, cz + 13);
    const dd = Math.sqrt(dx * dx + dy * dy + dz * dz) / r;
    if (dd < best) best = dd;
  }
  NSEED = sv;
  if (best < 1) return -(1 - best * best) * 0.85;
  if (best < 1.5) { const q = (best - 1.04) / 0.14; return 0.55 * Math.exp(-q * q); }
  return 0;
}
/* ячеистый шум: расстояние до ближайшей точки (0..~1) */
function worley(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let m = 9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const cx = ix + a, cy = iy + b, cz = iz + c;
    const dx = x - (cx + hash3(cx + 17, cy, cz)), dy = y - (cy + hash3(cx, cy + 31, cz)), dz = z - (cz + hash3(cx, cy, cz + 53));
    const d = dx * dx + dy * dy + dz * dz;
    if (d < m) m = d;
  }
  return Math.sqrt(m);
}

/* ───────────── палитры и текстуры ───────────── */
let CR = 0, CG = 0, CB = 0, CA = 255;
function ramp(st, t) {            // st: [t,r,g,b, t,r,g,b, ...]
  const n = st.length;
  if (t <= st[0]) { CR = st[1]; CG = st[2]; CB = st[3]; return; }
  for (let i = 4; i < n; i += 4) {
    if (t <= st[i]) {
      const k = (t - st[i - 4]) / (st[i] - st[i - 4]);
      CR = st[i - 3] + (st[i + 1] - st[i - 3]) * k;
      CG = st[i - 2] + (st[i + 2] - st[i - 2]) * k;
      CB = st[i - 1] + (st[i + 3] - st[i - 1]) * k;
      return;
    }
  }
  CR = st[n - 3]; CG = st[n - 2]; CB = st[n - 1];
}
function mixc(r, g, b, k) { CR += (r - CR) * k; CG += (g - CG) * k; CB += (b - CB) * k; }

const TEX = {};
const TEXQ = [];
function fillRow(q, d, j) {
  const w = q.w, h = q.h, ch = q.ch, fn = q.fn;
  NSEED = q.seed;
  const lat = (0.5 - (j + 0.5) / h) * PI, cl = Math.cos(lat), sl = Math.sin(lat);
  for (let i = 0; i < w; i++) {
    const lon = ((i + 0.5) / w - 0.5) * TAU;
    const x = cl * Math.sin(lon), z = cl * Math.cos(lon);
    const o = (j * w + i) * ch;
    if (ch === 1) d[o] = fn(x, sl, z, lat, lon) * 255;
    else {
      CA = 255; fn(x, sl, z, lat, lon);
      d[o] = CR * 255; d[o + 1] = CG * 255; d[o + 2] = CB * 255; d[o + 3] = CA;
    }
  }
}
function buildTex(q) {
  const d = new Uint8ClampedArray(q.w * q.h * q.ch);
  for (let j = 0; j < q.h; j++) fillRow(q, d, j);
  return { w: q.w, h: q.h, ch: q.ch, d };
}
function queueTex(name, w, h, seed, ch, fn) { TEXQ.push({ name, w, h, seed, ch, fn }); }
let TJ = null;                    // текущая сборка текстуры (по строкам, в бюджет кадра)
function stepTex(budgetMs) {
  const t0 = performance.now();
  while (performance.now() - t0 < budgetMs) {
    if (!TJ) {
      const q = TEXQ.shift();
      if (!q) return;
      TJ = { q, j: 0, d: new Uint8ClampedArray(q.w * q.h * q.ch) };
    }
    fillRow(TJ.q, TJ.d, TJ.j);
    if (++TJ.j >= TJ.q.h) { TEX[TJ.q.name] = { w: TJ.q.w, h: TJ.q.h, ch: TJ.q.ch, d: TJ.d }; TJ = null; }
  }
}
function flatTex(r, g, b) { return { w: 1, h: 1, ch: 4, d: new Uint8ClampedArray([r * 255, g * 255, b * 255, 255]) }; }

/* ── Солнце: гранулы + пятна (яркость 0..1) ── */
const SPOTS = [[0.7, 0.3, 0.055], [0.95, 0.25, 0.03], [-1.9, -0.28, 0.06], [-2.2, -0.32, 0.03], [2.5, 0.2, 0.04], [-0.4, -0.22, 0.035]]
  .map(s => [Math.cos(s[1]) * Math.sin(s[0]), Math.sin(s[1]), Math.cos(s[1]) * Math.cos(s[0]), s[2]]);
queueTex('sun1', 256, 128, 11, 1, (x, y, z) => {
  let g = 1 - smooth(0.0, 0.9, worley(x * 13 + 3, y * 13, z * 13));
  g = g * 0.5 + 0.5 * fbm(x * 3, y * 3, z * 3, 4);
  for (let i = 0; i < SPOTS.length; i++) {
    const s = SPOTS[i], d = Math.acos(clamp(x * s[0] + y * s[1] + z * s[2], -1, 1)) / s[3];
    g -= Math.exp(-d * d * 0.35) * 0.45 + Math.exp(-d * d * 1.6) * 0.5;
  }
  return clamp(g, 0, 1);
});
queueTex('sun2', 256, 128, 12, 1, (x, y, z) => {
  const g = 1 - smooth(0.0, 0.95, worley(x * 31 + 1, y * 31, z * 31));
  return clamp(g * 0.6 + 0.4 * fbm(x * 8, y * 8, z * 8, 4), 0, 1);
});

/* ── Земля ── */
const E_T = 0.545;
function earthElev(x, y, z) { return fbm(x * 1.6 + 3.1, y * 1.6, z * 1.6, 6) * 0.86 + 0.14 * fbm(x * 6, y * 6, z * 6, 3); }
queueTex('earth', 384, 192, 41, 4, (x, y, z) => {
  const e = earthElev(x, y, z), lat = Math.abs(y), n = fbm(x * 9, y * 9, z * 9, 3);
  if (e < E_T) {
    ramp([0, .01, .05, .19, .55, .03, .13, .36, .88, .08, .34, .52, 1, .20, .58, .62], smooth(E_T - 0.11, E_T, e));
    CA = 255;
  } else {
    const m = fbm(x * 3 + 7, y * 3, z * 3, 4), h = (e - E_T) / (1 - E_T);
    CR = .66; CG = .57; CB = .37;
    mixc(.12, .30, .11, smooth(0.30, 0.47, m) * smooth(0.95, 0.35, lat * 1.3));
    mixc(.07, .22, .09, smooth(0.55, 0.7, fbm(x * 7 + 2, y * 7, z * 7, 3)) * smooth(0.3, 0.5, m) * 0.7);
    mixc(.30, .36, .20, smooth(0.4, 0.8, lat) * .6);
    mixc(.52, .47, .42, smooth(0.35, 0.8, h + (n - .5) * .3) * .8);
    CA = 0;
  }
  const cap = smooth(0.86 + 0.05 * n, 0.92 + 0.05 * n, lat);
  if (cap > 0) { mixc(.94, .96, 1, cap); CA = 255 * (1 - cap) + 60 * cap; }
});
queueTex('earthCloud', 256, 128, 47, 1, (x, y, z) => {
  const w = fbm(x * 2, y * 3, z * 2, 3);
  const n = fbm(x * 2.3 + w * 1.3, y * 4.6 + w, z * 2.3 + w * 1.3, 6);
  return smooth(0.5 - 0.05 * Math.cos(y * 12), 0.74, n);
});
queueTex('earthLights', 384, 192, 41, 1, (x, y, z) => {
  const e = earthElev(x, y, z);
  if (e < E_T) return 0;
  const cl = smooth(0.5, 0.72, fbm(x * 4 + 1, y * 4, z * 4, 4)), sp = smooth(0.6, 0.8, fbm(x * 24, y * 24, z * 24, 3));
  return cl * sp * (1 - smooth(0.6, 0.86, Math.abs(y))) * (e < E_T + 0.07 ? 1.4 : 0.8);
});

/* ── Газовые гиганты ── */
queueTex('saturn', 256, 128, 71, 4, (x, y, z) => {
  const w = fbm(x * 3, y * 7, z * 3, 4) - 0.5, s = y + w * 0.05;
  const b = Math.sin(s * 24) * 0.45 + Math.sin(s * 11 + 1) * 0.4 + w * 0.9;
  ramp([-1, .60, .48, .30, -0.2, .75, .63, .41, .3, .88, .77, .55, 1, .95, .88, .70], b);
  mixc(.55, .60, .62, smooth(.8, 1, Math.abs(y)) * .45);
});
queueTex('jupiter', 384, 192, 61, 4, (x, y, z, lat, lon) => {
  const w = fbm(x * 3.5, y * 8, z * 3.5, 5) - 0.5, w2 = fbm(x * 9, y * 18, z * 9, 3) - 0.5;
  const s = y + w * 0.11 + w2 * 0.025;
  const b = Math.sin(s * 20) * 0.5 + Math.sin(s * 47 + 1.3) * 0.25 + Math.sin(s * 9 + 0.5) * 0.35 + w * 1.1;
  ramp([-1.0, .40, .24, .15, -0.35, .62, .38, .22, 0.1, .82, .64, .42, 0.55, .93, .84, .68, 1.0, .97, .93, .85], b);
  const cl = Math.cos(lat);
  let gx = (lon - 1.1) * cl / 0.30, gy = (y + 0.36) / 0.10, g2 = gx * gx + gy * gy;
  if (g2 < 3) {
    const n2 = fbm(x * 10, y * 14, z * 10, 3), q = Math.sqrt(g2) - 1.2;
    mixc(.95, .88, .78, Math.exp(-q * q / 0.04) * 0.45);
    mixc(.76 + (n2 - .5) * .2, .27 + (n2 - .5) * .1, .16, (1 - smooth(0.45, 1.5, g2)) * 0.95);
  }
  const ov = [[-0.6, -0.38, 0.13], [2.4, 0.27, 0.1], [-2.3, 0.33, 0.09]];
  for (let i = 0; i < 3; i++) {
    gx = (lon - ov[i][0]) * cl / ov[i][2]; gy = (y - ov[i][1]) / (ov[i][2] * 0.55);
    mixc(.96, .93, .86, (1 - smooth(0.3, 1, gx * gx + gy * gy)) * 0.6);
  }
});
queueTex('uranus', 128, 64, 81, 4, (x, y, z) => {
  const n = fbm(x * 2, y * 4, z * 2, 3), b = 0.5 + 0.5 * Math.sin(y * 13 + n * 3);
  ramp([0, .50, .78, .84, 1, .70, .91, .94], n * 0.5 + b * 0.35 + smooth(0.5, 1, Math.abs(y)) * 0.25);
});
queueTex('neptune', 192, 96, 91, 4, (x, y, z, lat, lon) => {
  const n = fbm(x * 2, y * 5, z * 2, 4), b = 0.5 + 0.5 * Math.sin(y * 17 + n * 4);
  ramp([0, .06, .15, .52, .6, .12, .29, .78, 1, .30, .52, .92], n * 0.55 + b * 0.35);
  mixc(.88, .94, 1, smooth(.68, .8, fbm(x * 3 + 3, y * 18, z * 3, 4)) * 0.75);
  const gx = (lon - 0.5) * Math.cos(lat) / 0.28, gy = (y + 0.3) / 0.12;
  mixc(.03, .07, .28, (1 - smooth(0.3, 1, gx * gx + gy * gy)) * 0.8);
});

/* ── Каменные тела и луны ── */
function rocky(cfg) {
  return (x, y, z) => {
    const n = fbm(x * cfg.s, y * cfg.s, z * cfg.s, 5);
    const c = (craters(x, y, z, cfg.cf, 1) + 0.6 * craters(x, y, z, cfg.cf * 2.4, 2) + 0.4 * craters(x, y, z, cfg.cf * 5.5, 3)) * cfg.ca;
    let s = clamp(0.5 + (n - 0.5) * cfg.nv + c, 0, 1);
    if (cfg.maria) s *= 1 - 0.45 * smooth(0.5, 0.6, fbm(x * 1.5 + 9, y * 1.5, z * 1.5, 4));
    ramp(cfg.ramp, s);
    if (cfg.fn) cfg.fn(x, y, z, n);
  };
}
queueTex('mars', 320, 160, 51, 4, (x, y, z) => {
  const n = fbm(x * 3, y * 3, z * 3, 5), big = fbm(x * 1.3 + 5, y * 1.3, z * 1.3, 4);
  const c = craters(x, y, z, 6, 1) * 0.12 + craters(x, y, z, 16, 2) * 0.08;
  ramp([0, .42, .20, .12, .5, .74, .40, .22, 1, .88, .60, .38], clamp(n * 1.1 - 0.05 + c, 0, 1));
  mixc(.22, .12, .09, smooth(0.52, 0.62, big) * 0.65);
  mixc(.96, .96, .98, smooth(.87 + 0.05 * n, .93 + 0.05 * n, Math.abs(y)));
});
queueTex('venus', 256, 128, 31, 4, (x, y, z) => {
  const w = fbm(x * 2, y * 5, z * 2, 4);
  const t = fbm(x * 1.6 + w * 1.4, y * 4 + w * 1.1, z * 1.6 + w * 1.4, 5), b = 0.5 + 0.5 * Math.sin(y * 9 + w * 5);
  ramp([0, .62, .46, .24, .45, .82, .68, .42, .75, .94, .84, .58, 1, .99, .95, .78], clamp((t - 0.5) * 1.7 + 0.5 + (b - 0.5) * 0.3, 0, 1));
});
queueTex('mercury', 320, 160, 21, 4, rocky({ s: 3, cf: 5, ca: 0.55, nv: 0.9, ramp: [0, .16, .15, .15, .5, .42, .39, .36, 1, .80, .75, .69] }));
queueTex('moon', 160, 80, 101, 4, rocky({ s: 2, cf: 4, ca: 0.5, nv: 0.8, maria: true, ramp: [0, .14, .14, .15, .5, .46, .46, .47, 1, .84, .83, .80] }));
queueTex('callisto', 160, 80, 102, 4, rocky({ s: 3, cf: 7, ca: 0.6, nv: 0.7, ramp: [0, .12, .10, .09, .5, .30, .26, .22, 1, .66, .61, .55] }));
queueTex('ganymede', 160, 80, 103, 4, rocky({ s: 2.5, cf: 4, ca: 0.4, nv: 1.0, ramp: [0, .22, .19, .16, .5, .46, .41, .35, 1, .78, .74, .68],
  fn: (x, y, z) => mixc(.75, .72, .66, smooth(.55, .62, fbm(x * 3 + 4, y * 3, z * 3, 4)) * .5) }));
queueTex('rhea', 128, 64, 104, 4, rocky({ s: 3, cf: 5, ca: 0.5, nv: 0.5, ramp: [0, .35, .35, .36, .6, .66, .66, .66, 1, .92, .92, .92] }));
queueTex('titania', 128, 64, 105, 4, rocky({ s: 3, cf: 5, ca: 0.45, nv: 0.8, ramp: [0, .20, .18, .17, .5, .47, .42, .40, 1, .76, .71, .67] }));
queueTex('oberon', 128, 64, 106, 4, rocky({ s: 3, cf: 6, ca: 0.5, nv: 0.8, ramp: [0, .14, .12, .12, .5, .38, .34, .33, 1, .66, .62, .60] }));
queueTex('enceladus', 128, 64, 107, 4, rocky({ s: 3, cf: 6, ca: 0.15, nv: 0.3, ramp: [0, .82, .86, .90, .5, .94, .96, .98, 1, 1, 1, 1],
  fn: (x, y, z) => { if (Math.abs(fbm(x * 6, y * 6, z * 6, 3) - 0.5) < 0.025) mixc(.55, .70, .86, .7); } }));
queueTex('io', 160, 80, 108, 4, (x, y, z) => {
  const n = fbm(x * 3, y * 3, z * 3, 5), sp = worley(x * 7, y * 7, z * 7);
  ramp([0, .95, .88, .42, .45, .94, .78, .30, .7, .85, .45, .16, 1, .95, .95, .85], n);
  mixc(.80, .30, .10, smooth(0.32, 0.16, sp) * 0.4);
  mixc(.05, .03, .03, smooth(0.16, 0.07, sp));
});
queueTex('europa', 160, 80, 109, 4, (x, y, z) => {
  ramp([0, .78, .74, .66, 1, .95, .93, .88], fbm(x * 4, y * 4, z * 4, 4));
  mixc(.60, .42, .30, smooth(.55, .72, fbm(x * 2 + 5, y * 2, z * 2, 3)) * 0.5);
  const l = Math.abs(fbm(x * 5, y * 5, z * 5, 4) - 0.5) + Math.abs(fbm(x * 9 + 3, y * 9, z * 9, 3) - 0.5) * 0.6;
  if (l < 0.04) mixc(.42, .26, .17, 1 - l / 0.04);
});
queueTex('titan', 128, 64, 110, 4, (x, y, z) => {
  const n = fbm(x * 2, y * 4, z * 2, 4);
  ramp([0, .70, .45, .15, .5, .86, .63, .26, 1, .93, .75, .42], n * 0.8 + 0.1 * Math.sin(y * 10));
  mixc(.50, .32, .10, smooth(.65, 1, y) * 0.45);
});
queueTex('triton', 128, 64, 111, 4, (x, y, z) => {
  const c = worley(x * 8, y * 8, z * 8), n = fbm(x * 3, y * 3, z * 3, 4);
  ramp([0, .60, .54, .52, 1, .94, .89, .87], clamp(n * 0.6 + c * 0.5, 0, 1));
  mixc(.96, .82, .80, smooth(-0.1, -0.7, y) * 0.5);
  mixc(.30, .24, .24, smooth(.62, .7, fbm(x * 5, y * 14, z * 5, 3)) * 0.5);
});
const TEXTOTAL = TEXQ.length;

/* ───────────── данные: элементы орбит J2000, физика, луны ───────────── */
const mapAU = a => 3 + 24 * Math.pow(a, 0.6);      // сжатие расстояний (внутренняя система раздвинута): форма эллипса сохраняется
const SUN_R = 5.6;
const PLANETS = [
  { name: 'Меркурий', a: 0.38709927, e: 0.20563593, I: 7.00497902, L: 252.25032350, w: 77.45779628, O: 48.33076593,
    R: 1.6, tilt: 0.03, az: 0.3, spin: 45, tex: 'mercury', wrap: 0.05, trail: [200, 190, 175], fk: 6.5 },
  { name: 'Венера', a: 0.72333566, e: 0.00677672, I: 3.39467605, L: 181.97909950, w: 131.60246718, O: 76.67984255,
    R: 2.7, tilt: 3, az: 1.2, spin: -80, tex: 'venus', wrap: 0.5, atm: [1, .85, .5, .05, .9], trail: [245, 205, 130], fk: 6.5 },
  { name: 'Земля', a: 1.00000261, e: 0.01671123, I: 0.00005, L: 100.46457166, w: 102.93768193, O: 0,
    R: 2.8, tilt: 23.4, az: 0.5, spin: 14, tex: 'earth', wrap: 0.08, earth: true, atm: [.35, .6, 1, .07, 1.3], trail: [110, 170, 255], fk: 9,
    moons: [{ name: 'Луна', tex: 'moon', a: 5.2, r: 0.3, P: 9, inc: 5.1, node: 1.1, ph: 0.4, ref: 'ecl' }] },
  { name: 'Марс', a: 1.52371034, e: 0.09339410, I: 1.84969142, L: -4.55343205, w: -23.94362959, O: 49.55953891,
    R: 2.1, tilt: 25.2, az: 2.1, spin: 14.5, tex: 'mars', wrap: 0.06, atm: [.95, .62, .42, .03, .5], trail: [255, 130, 90], fk: 6.5 },
  { name: 'Юпитер', a: 5.20288700, e: 0.04838624, I: 1.30439695, L: 34.39644051, w: 14.72847983, O: 100.47390909,
    R: 7, tilt: 3.1, az: 0.7, spin: 6, tex: 'jupiter', wrap: 0.22, atm: [.95, .78, .55, .02, .3], trail: [240, 180, 120], fk: 9,
    moons: [{ name: 'Ио', tex: 'io', a: 2.5, r: 0.13, P: 4.5, inc: 0, node: 0, ph: 0.2 },
            { name: 'Европа', tex: 'europa', a: 3.3, r: 0.11, P: 7, inc: 0, node: 0, ph: 2.1 },
            { name: 'Ганимед', tex: 'ganymede', a: 4.3, r: 0.19, P: 11, inc: 0, node: 0, ph: 4.0 },
            { name: 'Каллисто', tex: 'callisto', a: 5.6, r: 0.17, P: 19, inc: 0, node: 0, ph: 5.3 }] },
  { name: 'Сатурн', a: 9.53667594, e: 0.05386179, I: 2.48599187, L: 49.95424423, w: 92.59887831, O: 113.66242448,
    R: 6, tilt: 26.7, az: 4.0, spin: 7.5, tex: 'saturn', wrap: 0.2, atm: [.95, .85, .6, .02, .3], trail: [240, 215, 150], fk: 8.5, rings: 'saturn',
    moons: [{ name: 'Энцелад', tex: 'enceladus', a: 2.75, r: 0.05, P: 5.5, inc: 0, node: 0, ph: 1.0 },
            { name: 'Рея', tex: 'rhea', a: 3.6, r: 0.08, P: 11, inc: 0, node: 0, ph: 3.2 },
            { name: 'Титан', tex: 'titan', a: 4.8, r: 0.16, P: 20, inc: 0, node: 0, ph: 5.0, atm: true }] },
  { name: 'Уран', a: 19.18916464, e: 0.04725744, I: 0.77263783, L: 313.23810451, w: 170.95427630, O: 74.01692503,
    R: 3.8, tilt: 97.8, az: 1.0, spin: -12, tex: 'uranus', wrap: 0.25, atm: [.6, .92, .96, .03, .55], trail: [150, 235, 245], fk: 9, rings: 'uranus',
    moons: [{ name: 'Титания', tex: 'titania', a: 3.2, r: 0.1, P: 14, inc: 0, node: 0, ph: 0.5 },
            { name: 'Оберон', tex: 'oberon', a: 4.2, r: 0.095, P: 20, inc: 0, node: 0, ph: 3.6 }] },
  { name: 'Нептун', a: 30.06992276, e: 0.00859048, I: 1.77004347, L: -55.12002969, w: 44.96476227, O: 131.78422574,
    R: 3.7, tilt: 28.3, az: 5.0, spin: 9, tex: 'neptune', wrap: 0.25, atm: [.3, .5, 1, .03, .8], trail: [90, 130, 255], fk: 9,
    moons: [{ name: 'Тритон', tex: 'triton', a: 3.4, r: 0.12, P: -13, inc: 22, node: 0.8, ph: 2.0 }] }
];
const SUN = { name: 'Солнце', R: SUN_R };

const v3 = {
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
};
function planeBasis(n) {
  let e1 = v3.cross(n, [0, 0, 1]);
  if (Math.hypot(e1[0], e1[1], e1[2]) < 1e-3) e1 = [1, 0, 0];
  e1 = v3.norm(e1);
  return [e1, v3.cross(n, e1)];
}
const NEAR = 0.5;
const ORBIT_SEG = 180;
function setupOrbit(p) {
  const I = p.I * D2R, O = p.O * D2R, w = (p.w - p.O) * D2R;
  p.n = TAU / Math.pow(p.a, 1.5);                       // рад/год
  p.M0 = (p.L - p.w) * D2R;
  p.k = mapAU(p.a) / p.a;
  p.b = Math.sqrt(1 - p.e * p.e);
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), cI = Math.cos(I), sI = Math.sin(I);
  const P = [cO * cw - sO * sw * cI, sO * cw + cO * sw * cI, sw * sI];
  const Q = [-cO * sw - sO * cw * cI, -sO * sw + cO * cw * cI, cw * sI];
  p.P = [P[0], P[2], -P[1]]; p.Q = [Q[0], Q[2], -Q[1]];  // эклиптика -> мир (Y вверх)
  p.pos = [0, 0, 0];
}
/* комета типа Галлея: ретроградная, очень вытянутая; проходит перигелий вскоре после старта */
const COMET = { name: 'Комета', a: 18, e: 0.935, I: 162, O: 58, w: 111, L: 111, R: 0.5, trail: [170, 215, 255], trailSpan: 0.35, vel: [1, 0, 0], sz: 0, sx: 0, sy: 0 };
setupOrbit(COMET);
PLANETS.forEach((p, idx) => {
  p.idx = idx;
  setupOrbit(p);
  const t = p.tilt * D2R;
  p.pole = [Math.sin(t) * Math.cos(p.az), Math.cos(t), Math.sin(t) * Math.sin(p.az)];
  const bs = planeBasis(p.pole); p.e1 = bs[0]; p.e2 = bs[1];
  p.A = mapAU(p.a);
  p.period = Math.pow(p.a, 1.5);
  p.spinAng = p.idx * 1.7; p.cloudAng = 0;
  // эллипс орбиты (мировые координаты)
  p.orbit = new Float32Array((ORBIT_SEG + 1) * 3);
  for (let i = 0; i <= ORBIT_SEG; i++) {
    const E = i / ORBIT_SEG * TAU, xp = p.a * (Math.cos(E) - p.e) * p.k, yp = p.a * p.b * Math.sin(E) * p.k;
    p.orbit[i * 3] = p.P[0] * xp + p.Q[0] * yp; p.orbit[i * 3 + 1] = p.P[1] * xp + p.Q[1] * yp; p.orbit[i * 3 + 2] = p.P[2] * xp + p.Q[2] * yp;
  }
  (p.moons || []).forEach(m => {
    const nrm = m.ref === 'ecl' ? [0, 1, 0] : p.pole, b2 = planeBasis(nrm);
    const nd = m.node, id = m.inc * D2R;
    const u2 = [b2[0][0] * Math.cos(nd) + b2[1][0] * Math.sin(nd), b2[0][1] * Math.cos(nd) + b2[1][1] * Math.sin(nd), b2[0][2] * Math.cos(nd) + b2[1][2] * Math.sin(nd)];
    const v2 = [-b2[0][0] * Math.sin(nd) + b2[1][0] * Math.cos(nd), -b2[0][1] * Math.sin(nd) + b2[1][1] * Math.cos(nd), -b2[0][2] * Math.sin(nd) + b2[1][2] * Math.cos(nd)];
    m.u = u2;
    m.v = [v2[0] * Math.cos(id) + nrm[0] * Math.sin(id), v2[1] * Math.cos(id) + nrm[1] * Math.sin(id), v2[2] * Math.cos(id) + nrm[2] * Math.sin(id)];
    m.ang = m.ph; m.rel = [0, 0, 0]; m.parent = p;
    m.spinAng = 0;
  });
});

/* уравнение Кеплера -> положение планеты (мир, единицы сцены) */
function planetPos(p, T, out) {
  let M = (p.M0 + p.n * T) % TAU; if (M < 0) M += TAU;
  const hi = p.e > 0.8;
  let E = hi ? PI : M + p.e * Math.sin(M);
  for (let i = hi ? 16 : 4; i > 0; i--) E -= (E - p.e * Math.sin(E) - M) / (1 - p.e * Math.cos(E));
  const xp = p.a * (Math.cos(E) - p.e) * p.k, yp = p.a * p.b * Math.sin(E) * p.k;
  out[0] = p.P[0] * xp + p.Q[0] * yp; out[1] = p.P[1] * xp + p.Q[1] * yp; out[2] = p.P[2] * xp + p.Q[2] * yp;
}
function moonRel(m, ang, out) {
  const r = m.a * m.parent.R, c = Math.cos(ang) * r, s = Math.sin(ang) * r;
  out[0] = m.u[0] * c + m.v[0] * s; out[1] = m.u[1] * c + m.v[1] * s; out[2] = m.u[2] * c + m.v[2] * s;
}

/* ───────────── кольца: радиальные профили ───────────── */
const RING_N = 1024, RING_MIP = 5;
function makeRing(rin, rout, fn) {
  const R = { rin, rout, n: RING_N, al: new Float32Array(RING_N), cr: new Float32Array(RING_N), cg: new Float32Array(RING_N), cb: new Float32Array(RING_N) };
  NSEED = 777;
  for (let i = 0; i < RING_N; i++) {
    const r = rin + (rout - rin) * (i + 0.5) / RING_N;
    CR = .8; CG = .75; CB = .65;
    R.al[i] = clamp(fn(r), 0, 1);
    R.cr[i] = CR; R.cg[i] = CG; R.cb[i] = CB;
  }
  // мипы профиля: пиксель экрана усредняет много радиальных отсчётов — без них кольца дают «лесенку» и муар
  R.m = [{ al: R.al, cr: R.cr, cg: R.cg, cb: R.cb }];
  for (let L = 1; L <= RING_MIP; L++) {
    const p = R.m[L - 1], n = RING_N >> L;
    const q = { al: new Float32Array(n), cr: new Float32Array(n), cg: new Float32Array(n), cb: new Float32Array(n) };
    for (let i = 0; i < n; i++) {
      const a0 = p.al[2 * i], a1 = p.al[2 * i + 1], s = a0 + a1;
      q.al[i] = s * 0.5;
      const w0 = s > 1e-6 ? a0 / s : 0.5, w1 = 1 - w0;
      q.cr[i] = p.cr[2 * i] * w0 + p.cr[2 * i + 1] * w1; q.cg[i] = p.cg[2 * i] * w0 + p.cg[2 * i + 1] * w1; q.cb[i] = p.cb[2 * i] * w0 + p.cb[2 * i + 1] * w1;
    }
    R.m.push(q);
  }
  return R;
}
const RINGS = {
  saturn: makeRing(1.24, 2.27, r => {
    const n = vnoise(r * 150, 3.3, 0), n2 = vnoise(r * 520, 9.1, 0), n3 = vnoise(r * 40, 1.7, 0);
    const fine = 0.78 + 0.45 * (n - 0.5) + 0.3 * (n2 - 0.5);
    const cC = smooth(1.24, 1.3, r) * (1 - smooth(1.5, 1.54, r)) * (0.13 + 0.12 * n3) * fine;
    const cB = smooth(1.5, 1.6, r) * (1 - smooth(1.93, 1.96, r)) * (0.5 + 0.45 * smooth(1.58, 1.8, r)) * (0.85 + 0.5 * (n - 0.5)) * (0.9 + 0.4 * (n3 - 0.5));
    const gap = Math.exp(-Math.pow((r - 2.215) / 0.006, 2));
    const cA = smooth(2.02, 2.05, r) * (1 - smooth(2.255, 2.27, r)) * (0.52 + 0.28 * (n3 - 0.5)) * fine * (1 - 0.92 * gap);
    const cas = smooth(1.93, 1.96, r) * (1 - smooth(2.0, 2.03, r)) * 0.06;
    ramp([0, .38, .33, .28, .3, .62, .55, .45, .5, .90, .82, .68, .78, .84, .76, .62, 1, .78, .72, .60], smooth(1.24, 2.27, r));
    if (r > 1.96 && r < 2.03) mixc(.25, .22, .2, .6);
    CR *= .85 + .3 * n; CG *= .85 + .3 * n; CB *= .85 + .3 * n;
    return cC + cB + cA + cas;
  }),
  uranus: makeRing(1.55, 2.1, r => {
    const rr = [[1.64, .004, .25], [1.65, .004, .22], [1.67, .004, .22], [1.75, .004, .2], [1.79, .005, .28], [1.90, .005, .3], [1.95, .006, .35], [2.0, .012, .65]];
    let a = 0.006; CR = .40; CG = .46; CB = .52;
    for (let i = 0; i < rr.length; i++) a += rr[i][2] * 0.55 * Math.exp(-Math.pow((r - rr[i][0]) / rr[i][1], 2));
    return a;
  })
};

/* ───────────── вид и камера ───────────── */
const V = { cx: 0, cy: 0, cz: 0, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: -1, foc: 800, w2: 400, h2: 300 };
let PX = 0, PY = 0, PZ = 0;
function project(x, y, z) {
  const dx = x - V.cx, dy = y - V.cy, dz = z - V.cz;
  PZ = dx * V.fx + dy * V.fy + dz * V.fz;
  if (PZ < NEAR) return false;
  const k = V.foc / PZ;
  PX = V.w2 + (dx * V.rx + dy * V.ry + dz * V.rz) * k;
  PY = V.h2 - (dx * V.ux + dy * V.uy + dz * V.uz) * k;
  return true;
}
const cam = { yaw: 0.55, pitch: 0.6, dist: 300, tx: 0, ty: 0, tz: 0 };
function updateView(VW, VH) {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
  V.cx = cam.tx + cam.dist * sy * cp; V.cy = cam.ty + cam.dist * sp; V.cz = cam.tz + cam.dist * cy * cp;
  let fx = cam.tx - V.cx, fy = cam.ty - V.cy, fz = cam.tz - V.cz; const fl = Math.hypot(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;
  let rx = fy * 0 - fz * 1, ry = fz * 0 - fx * 0, rz = fx * 1 - fy * 0;      // fwd x up(0,1,0)
  const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
  V.fx = fx; V.fy = fy; V.fz = fz; V.rx = rx; V.ry = ry; V.rz = rz;
  V.ux = ry * fz - rz * fy; V.uy = rz * fx - rx * fz; V.uz = rx * fy - ry * fx;
  V.w2 = VW / 2; V.h2 = VH / 2; V.foc = (VH / 2) / Math.tan(21 * D2R);
}

/* ───────────── попиксельный шейдер шара ───────────── */
let SR = 0, SG = 0, SB = 0, SA = 0;
function samp4(t, u, v) {
  const w = t.w, h = t.h, d = t.d;
  const fx = u * w - 0.5, fy = v * h - 0.5;
  let x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  let x1 = x0 + 1, y1 = y0 + 1;
  x0 = ((x0 % w) + w) % w; x1 = ((x1 % w) + w) % w;
  y0 = y0 < 0 ? 0 : y0 >= h ? h - 1 : y0; y1 = y1 < 0 ? 0 : y1 >= h ? h - 1 : y1;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  const w00 = (1 - tx) * (1 - ty) / 255, w10 = tx * (1 - ty) / 255, w01 = (1 - tx) * ty / 255, w11 = tx * ty / 255;
  SR = d[i00] * w00 + d[i10] * w10 + d[i01] * w01 + d[i11] * w11;
  SG = d[i00 + 1] * w00 + d[i10 + 1] * w10 + d[i01 + 1] * w01 + d[i11 + 1] * w11;
  SB = d[i00 + 2] * w00 + d[i10 + 2] * w10 + d[i01 + 2] * w01 + d[i11 + 2] * w11;
  SA = d[i00 + 3] * w00 + d[i10 + 3] * w10 + d[i01 + 3] * w01 + d[i11 + 3] * w11;
}
function samp1(t, u, v) {
  const w = t.w, h = t.h, d = t.d;
  const fx = u * w - 0.5, fy = v * h - 0.5;
  let x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  let x1 = x0 + 1, y1 = y0 + 1;
  x0 = ((x0 % w) + w) % w; x1 = ((x1 % w) + w) % w;
  y0 = y0 < 0 ? 0 : y0 >= h ? h - 1 : y0; y1 = y1 < 0 ? 0 : y1 >= h ? h - 1 : y1;
  return ((d[y0 * w + x0] * (1 - tx) + d[y0 * w + x1] * tx) * (1 - ty) + (d[y1 * w + x0] * (1 - tx) + d[y1 * w + x1] * tx) * ty) / 255;
}
const tmap = x => Math.sqrt(1 - Math.exp(-x * 1.7));

/* S: lx,ly,lz — направление на Солнце; pv* — полюс; x*,z* — оси тела (всё в базисе камеры: право, верх, к зрителю) */
function shadeBody(S, img, N) {
  const data = img.data, ext = S.ext, inv = 2 * ext / N;
  const lx = S.lx, ly = S.ly, lz = S.lz, pxv = S.pvx, pyv = S.pvy, pzv = S.pvz;
  const xx = S.xx, xy = S.xy, xz = S.xz, zx = S.zx, zy = S.zy, zz = S.zz;
  const tex = S.tex, cloud = S.cloud, lights = S.lights, wrap = S.wrap, sunI = S.sunI, atm = S.atm;
  const ring = S.ring, rin = ring ? ring.rin : 0, rout = ring ? ring.rout : 0;
  const rnl = pxv * lx + pyv * ly + pzv * lz, mc = S.mcount, msh = S.msh;
  const haloW = atm ? atm[3] : 0, limbK = S.limbK || 0, cloudShift = S.cloudShift || 0, twi = S.twi === undefined ? 1 : S.twi;
  let hx = lx, hy = ly, hz = lz + 1; const hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
  const ringOK = ring && Math.abs(pzv) > 0.03;
  const mips = ring ? ring.m : null, rspan = rout - rin, rN = ring ? RING_N / rspan : 0, ringCv = Math.abs(pzv);
  for (let j = 0; j < N; j++) {
    const b = -((j + 0.5) / N * 2 - 1) * ext;
    for (let i = 0; i < N; i++) {
      const a = ((i + 0.5) / N * 2 - 1) * ext;
      const r2 = a * a + b * b, o = (j * N + i) * 4, rr = Math.sqrt(r2);
      let sr = 0, sg = 0, sb = 0, sa = 0, zS = -9;
      if (rr < 1 + inv) {
        const sc = rr > 0.996 ? 0.996 / rr : 1, as = a * sc, bs = b * sc;
        const nz = Math.sqrt(Math.max(0, 1 - as * as - bs * bs));
        if (rr < 1 + inv * 0.5) zS = nz;
        sa = clamp((1 - rr) / inv + 0.5, 0, 1);
        const ndl = as * lx + bs * ly + nz * lz;
        const by = as * pxv + bs * pyv + nz * pzv, bx = as * xx + bs * xy + nz * xz, bz = as * zx + bs * zy + nz * zz;
        const u = Math.atan2(bx, bz) * INV2PI + 0.5, v = 0.5 - Math.asin(by > 1 ? 1 : by < -1 ? -1 : by) * INVPI;
        samp4(tex, u, v);
        let alr = SR * SR, alg = SG * SG, alb = SB * SB;
        const spm = S.spec ? SA : 0;
        let cl = 0, sp = spm;
        if (cloud) {
          cl = samp1(cloud, u + cloudShift, v);
          const k = cl * 0.93; alr += (0.88 - alr) * k; alg += (0.90 - alg) * k; alb += (0.93 - alb) * k; sp = spm * (1 - cl);
        }
        let sh = 1;
        if (ring && Math.abs(rnl) > 1e-3) {
          const t = -(as * pxv + bs * pyv + nz * pzv) / rnl;
          if (t > 0) {
            const qx = as + t * lx, qy = bs + t * ly, qz = nz + t * lz, rho = Math.sqrt(qx * qx + qy * qy + qz * qz);
            if (rho > rin && rho < rout) {
              sh *= 1 - 0.88 * mips[2].al[((rho - rin) / rspan * (RING_N >> 2)) | 0];
            }
          }
        }
        for (let m = 0; m < mc; m++) {
          const wx = msh[m * 4] - as, wy = msh[m * 4 + 1] - bs, wz = msh[m * 4 + 2] - nz, mr = msh[m * 4 + 3];
          const s = wx * lx + wy * ly + wz * lz;
          if (s > 0) {
            const d2 = wx * wx + wy * wy + wz * wz - s * s;
            if (d2 < mr * mr * 2.6) sh *= 1 - 0.93 * (1 - smooth(mr * 0.5, mr * 1.25, Math.sqrt(d2 > 0 ? d2 : 0)));
          }
        }
        let d = (ndl + wrap) / (1 + wrap); d = d < 0 ? 0 : d > 1 ? 1 : d;
        if (wrap > 0.15) d = d * 0.35 + 0.65 * d * d * (3 - 2 * d);
        d *= sh * sunI;
        const lk = limbK ? 1 - limbK * (1 - Math.sqrt(nz)) : 1;
        let lr = alr * (d + 0.012) * lk, lg = alg * (d + 0.014) * lk * 0.97, lb = alb * (d + 0.022) * lk * 0.93;
        if (sp > 0.02 && ndl > 0) {
          const hd = as * hx + bs * hy + nz * hz;
          if (hd > 0.93) { const q = Math.pow(hd, 260) * sp * sh * 0.8; lr += q; lg += q * 0.97; lb += q * 0.95; }
        }
        if (lights && ndl < 0.15) {
          const night = smooth(0.15, -0.1, ndl);
          if (night > 0) {
            const ll = samp1(lights, u, v) * night * (1 - cl * 0.85);
            lr += ll * 1.8; lg += ll * 1.2; lb += ll * 0.5;
          }
        }
        if (atm) {
          const rim = Math.pow(1 - nz, 2.5), sc2 = rim * atm[4] * smooth(-0.3, 0.5, ndl) * sunI * 0.6;
          lr += atm[0] * sc2; lg += atm[1] * sc2; lb += atm[2] * sc2;
          const q = (ndl - 0.04) / 0.14, tw = Math.exp(-q * q) * rim * atm[4] * 0.3 * twi;
          lr += 0.95 * tw; lg += 0.42 * tw; lb += 0.16 * tw;
        }
        sr = tmap(lr) * 255; sg = tmap(lg) * 255; sb = tmap(lb) * 255;
      } else if (rr < 1 + haloW) {
        const q = 1 - (rr - 1) / haloW, sd = smooth(-0.5, 0.65, (a * lx + b * ly) / rr);
        sa = clamp(q * q * q * atm[4] * 0.6 * sd, 0, 1);
        sr = tmap(atm[0] * sunI * 1.3) * 255; sg = tmap(atm[1] * sunI * 1.3) * 255; sb = tmap(atm[2] * sunI * 1.3) * 255;
      }
      if (ringOK) {
        const zr = -(pxv * a + pyv * b) / pzv, rho = Math.sqrt(r2 + zr * zr);
        if (rho > rin && rho < rout) {
          // фильтрация профиля по размеру пикселя в радиальном направлении (мип-уровни)
          const t01 = (rho - rin) / rspan, gx = a - zr * pxv / pzv, gy = b - zr * pyv / pzv;
          const dr = Math.sqrt(gx * gx + gy * gy) / rho * inv * rN * 1.3;
          let lv = dr > 1 ? Math.log2(dr) : 0; if (lv > RING_MIP) lv = RING_MIP;
          const l0 = lv | 0, fr = lv - l0, l1 = l0 < RING_MIP ? l0 + 1 : l0, M0 = mips[l0], M1 = mips[l1];
          const k0 = (t01 * (RING_N >> l0)) | 0, k1 = (t01 * (RING_N >> l1)) | 0, f0 = 1 - fr;
          const al0 = M0.al[k0] * f0 + M1.al[k1] * fr;
          if (al0 > 0.003) {
            const cr_ = M0.cr[k0] * f0 + M1.cr[k1] * fr, cg_ = M0.cg[k0] * f0 + M1.cg[k1] * fr, cb_ = M0.cb[k0] * f0 + M1.cb[k1] * fr;
            const ra = 1 - Math.pow(1 - al0, 1 / (ringCv < 0.2 ? 0.2 : ringCv));
            const sdot = a * lx + b * ly + zr * lz;
            let lf = pzv * rnl > 0 ? 1 : 0.22 + 0.55 * (1 - al0);
            if (sdot < 0) { const pp = Math.sqrt(Math.max(0, rho * rho - sdot * sdot)); lf *= 0.03 + 0.97 * smooth(0.9, 1.03, pp); }
            const e = sunI * lf * 1.05;
            const rr_ = tmap(cr_ * cr_ * e + 0.004) * 255, rg_ = tmap(cg_ * cg_ * e * 0.98 + 0.004) * 255, rb_ = tmap(cb_ * cb_ * e * 0.95 + 0.005) * 255;
            if (zr > zS) {        // кольцо перед шаром (или шара нет)
              const oa = ra + sa * (1 - ra);
              sr = (rr_ * ra + sr * sa * (1 - ra)) / oa; sg = (rg_ * ra + sg * sa * (1 - ra)) / oa; sb = (rb_ * ra + sb * sa * (1 - ra)) / oa; sa = oa;
            } else if (sa < 1) {  // кольцо за шаром — просвечивает через сглаженный край диска
              const oa = sa + ra * (1 - sa);
              sr = (sr * sa + rr_ * ra * (1 - sa)) / oa; sg = (sg * sa + rg_ * ra * (1 - sa)) / oa; sb = (sb * sa + rb_ * ra * (1 - sa)) / oa; sa = oa;
            }
          }
        }
      }
      data[o] = sr; data[o + 1] = sg; data[o + 2] = sb; data[o + 3] = sa * 255;
    }
  }
}

/* Солнце: самосвечение, потемнение к краю, бегущие гранулы */
const SUNRAMP = [0, .35, .06, .0, .25, .85, .30, .04, .55, 1, .62, .16, .8, 1, .85, .46, 1, 1, .97, .82];
function shadeSun(S, img, N) {
  const data = img.data, inv = 2 / N, t1 = TEX.sun1, t2 = TEX.sun2;
  const pxv = S.pvx, pyv = S.pvy, pzv = S.pvz, xx = S.xx, xy = S.xy, xz = S.xz, zx = S.zx, zy = S.zy, zz = S.zz;
  const ts = S.time;
  for (let j = 0; j < N; j++) {
    const b = -((j + 0.5) / N * 2 - 1);
    for (let i = 0; i < N; i++) {
      const a = ((i + 0.5) / N * 2 - 1), o = (j * N + i) * 4, rr = Math.sqrt(a * a + b * b);
      if (rr >= 1 + inv) { data[o + 3] = 0; continue; }
      const sc = rr > 0.996 ? 0.996 / rr : 1, as = a * sc, bs = b * sc, nz = Math.sqrt(Math.max(0, 1 - as * as - bs * bs));
      const by = as * pxv + bs * pyv + nz * pzv, bx = as * xx + bs * xy + nz * xz, bz = as * zx + bs * zy + nz * zz;
      const ang = Math.atan2(bx, bz) * INV2PI + 0.5, v = 0.5 - Math.asin(by > 1 ? 1 : by < -1 ? -1 : by) * INVPI;
      const g = samp1(t1, ang, v) * 0.6 + samp1(t2, ang * 1 - ts * 0.012, v) * 0.4;
      const limb = 0.3 + 0.7 * Math.pow(nz, 0.55);
      ramp(SUNRAMP, clamp((g * 0.8 + 0.28) * limb * 1.12, 0, 1));
      const k = 1 + 0.2 * Math.pow(nz, 3);
      data[o] = CR * 255 * k; data[o + 1] = CG * 255 * k; data[o + 2] = CB * 255 * k;
      data[o + 3] = clamp((1 - rr) / inv + 0.5, 0, 1) * 255;
    }
  }
}

/* ───────────── приложение: состояние ───────────── */
const app = {
  cvs: null, ctx: null, DPR: 1, VW: 800, VH: 600, time: 0,
  T: 0, speed: 1, paused: false, zoom: 1, camSpeed: 1,
  orbits: true, trails: true, labels: true, belts: true, tour: false,
  quality: 1, ema: 16, frame: 0, pitchHold: 0
};
const YPS = 1 / 16;                      // лет сцены в секунду при скорости 1 (год Земли = 16 с)
const J2000 = Date.UTC(2000, 0, 1, 12);
app.T = (Date.now() - J2000) / (365.25 * 86400000);   // стартуем с реального положения планет «сегодня»

let seedState = 1234567;
function rand() {
  seedState = (seedState + 0x6D2B79F5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const gauss = () => (rand() + rand() + rand() + rand() - 2) * 1.2;

/* ───────────── небо: звёзды и Млечный Путь ───────────── */
const STAR_COL = [[175, 200, 255], [255, 255, 255], [255, 240, 205], [255, 195, 150]];
const STARS = [], MW = [], SKY = { glowW: null, glowB: null, glowO: null, ray: null, dust: null };
function initSkyData() {
  for (let i = 0; i < 3600; i++) {
    const z = rand() * 2 - 1, a = rand() * TAU, r = Math.sqrt(1 - z * z), c = rand(), m = Math.pow(rand(), 3);
    STARS.push({ x: r * Math.cos(a), y: z, z: r * Math.sin(a), k: c < 0.22 ? 0 : c < 0.62 ? 1 : c < 0.88 ? 2 : 3,
      s: 0.7 + m * 1.6, a: 0.35 + 0.65 * m, ph: rand() * TAU, fr: 0.6 + rand() * 2.2, m });
  }
  STARS.sort((p, q) => p.k - q.k);
  const g = v3.norm([0.35, 0.82, 0.45]), bs = planeBasis(g);
  NSEED = 5;
  for (let i = 0; i < 620; i++) {
    const l = rand() * TAU, core = Math.exp(-Math.pow(Math.atan2(Math.sin(l), Math.cos(l)), 2) / 0.9);
    const clump = vnoise(l * 3.1, 2.2, 0);
    if (rand() > 0.3 + 0.7 * clump) { i--; continue; }
    const lat = gauss() * 0.15 * (1 - 0.35 * core), cl = Math.cos(lat), sl = Math.sin(lat);
    const dx = cl * Math.cos(l), dy = cl * Math.sin(l);
    MW.push({ x: dx * bs[0][0] + dy * bs[1][0] + sl * g[0], y: dx * bs[0][1] + dy * bs[1][1] + sl * g[1], z: dx * bs[0][2] + dy * bs[1][2] + sl * g[2],
      rad: 0.05 + rand() * 0.09 + core * 0.04, a: (0.03 + rand() * 0.05) * (0.6 + 1.1 * core) * (0.6 + 0.8 * clump), warm: rand() < 0.35 + 0.4 * core, dark: false });
  }
  for (let i = 0; i < 70; i++) {
    const l = rand() * TAU, lat = gauss() * 0.06, cl = Math.cos(lat), sl = Math.sin(lat), dx = cl * Math.cos(l), dy = cl * Math.sin(l);
    MW.push({ x: dx * bs[0][0] + dy * bs[1][0] + sl * g[0], y: dx * bs[0][1] + dy * bs[1][1] + sl * g[1], z: dx * bs[0][2] + dy * bs[1][2] + sl * g[2],
      rad: 0.04 + rand() * 0.06, a: 0.09 + rand() * 0.1, warm: false, dark: true });
  }
}
function makeGlow(sz, r, g, b, pw) {
  const c = document.createElement('canvas'); c.width = c.height = sz;
  const x = c.getContext('2d'), gr = x.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
  const n = 10;
  for (let i = 0; i <= n; i++) { const t = i / n; gr.addColorStop(t, `rgba(${r},${g},${b},${Math.pow(1 - t, pw).toFixed(4)})`); }
  x.fillStyle = gr; x.fillRect(0, 0, sz, sz);
  return c;
}
function initSkyGfx() {
  SKY.glowW = makeGlow(128, 255, 255, 255, 2.2);
  SKY.glowB = makeGlow(128, 170, 195, 255, 2.0);
  SKY.glowO = makeGlow(128, 255, 190, 130, 2.0);
  SKY.dust = makeGlow(64, 0, 0, 0, 1.4);
  const c = document.createElement('canvas'); c.width = 256; c.height = 32; const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, 'rgba(255,225,170,0.95)'); gr.addColorStop(0.12, 'rgba(255,190,110,0.5)'); gr.addColorStop(1, 'rgba(255,140,60,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 256, 32);
  x.globalCompositeOperation = 'destination-in';
  const vg = x.createLinearGradient(0, 0, 0, 32);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.5, 'rgba(0,0,0,1)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = vg; x.fillRect(0, 0, 256, 32);
  SKY.ray = c;
}
function drawSky(ctx, t) {
  const VW = app.VW, VH = app.VH, DPR = app.DPR;
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.fillStyle = '#02030a'; ctx.fillRect(0, 0, VW, VH);
  let g = ctx.createRadialGradient(VW * 0.2, VH * 0.18, 0, VW * 0.2, VH * 0.18, VW * 0.65);
  g.addColorStop(0, 'rgba(70,40,110,0.22)'); g.addColorStop(1, 'rgba(70,40,110,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
  g = ctx.createRadialGradient(VW * 0.85, VH * 0.85, 0, VW * 0.85, VH * 0.85, VW * 0.7);
  g.addColorStop(0, 'rgba(20,70,100,0.2)'); g.addColorStop(1, 'rgba(20,70,100,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
  const foc = V.foc, w2 = V.w2, h2 = V.h2;
  // Млечный Путь
  for (let pass = 0; pass < 2; pass++) {
    ctx.globalCompositeOperation = pass ? 'source-over' : 'lighter';
    const stepMW = app.quality < 0.6 ? 2 : 1;      // на слабом железе рисуем вдвое меньше облаков Млечного Пути
    for (let i = 0; i < MW.length; i += stepMW) {
      const p = MW[i];
      if (p.dark !== (pass === 1)) continue;
      const x = p.x * V.rx + p.y * V.ry + p.z * V.rz, y = p.x * V.ux + p.y * V.uy + p.z * V.uz, z = p.x * V.fx + p.y * V.fy + p.z * V.fz;
      if (z < 0.08) continue;
      const sx = w2 + foc * x / z, sy = h2 - foc * y / z, sz = p.rad * foc * 2 / Math.max(z, 0.35);
      if (sx < -sz || sx > VW + sz || sy < -sz || sy > VH + sz) continue;
      ctx.globalAlpha = Math.min(1, p.a * stepMW);
      ctx.drawImage(pass ? SKY.dust : (p.warm ? SKY.glowO : SKY.glowB), sx - sz / 2, sy - sz / 2, sz, sz);
    }
  }
  // звёзды
  ctx.globalCompositeOperation = 'lighter';
  let lastK = -1;
  for (let i = 0; i < STARS.length; i++) {
    const s = STARS[i];
    const z = s.x * V.fx + s.y * V.fy + s.z * V.fz;
    if (z < 0.05) continue;
    const sx = w2 + foc * (s.x * V.rx + s.y * V.ry + s.z * V.rz) / z, sy = h2 - foc * (s.x * V.ux + s.y * V.uy + s.z * V.uz) / z;
    if (sx < 0 || sx > VW || sy < 0 || sy > VH) continue;
    if (s.k !== lastK) { lastK = s.k; const c = STAR_COL[s.k]; ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; }
    const tw = 0.82 + 0.18 * Math.sin(t * s.fr + s.ph), sz = s.s * DPR * (0.8 + 0.4 * (s.m > 0.5));
    ctx.globalAlpha = s.a * tw;
    ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
    if (s.m > 0.62) {
      const gs = sz * 7; ctx.globalAlpha = s.a * tw * 0.35;
      ctx.drawImage(s.k === 0 ? SKY.glowB : s.k >= 2 ? SKY.glowO : SKY.glowW, sx - gs / 2, sy - gs / 2, gs, gs);
    }
  }
  ctx.globalAlpha = 1;
}

/* ───────────── пояса: астероиды, троянцы, Койпера ───────────── */
function makeBelt(n, a0, a1, eMax, incMax, size, fills, opt) {
  const B = { n, size, fills, th0: new Float32Array(n), sp: new Float32Array(n), r: new Float32Array(n), e: new Float32Array(n), w: new Float32Array(n),
    inc: new Float32Array(n), node: new Float32Array(n), sx: new Float32Array(n), sy: new Float32Array(n), sz: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    let aAU = a0 + (a1 - a0) * Math.pow(rand(), opt && opt.pw || 1);
    B.r[i] = mapAU(aAU); B.sp[i] = opt && opt.lockSp ? opt.lockSp : TAU / Math.pow(aAU, 1.5);
    B.th0[i] = opt && opt.lead !== undefined ? opt.lead + gauss() * 0.16 : rand() * TAU;
    B.e[i] = rand() * eMax; B.w[i] = rand() * TAU; B.inc[i] = (rand() - 0.3) * incMax; B.node[i] = rand() * TAU;
  }
  return B;
}
let BELTS = null;
function initBelts() {
  const jup = PLANETS[4], jl = jup.L * D2R;
  BELTS = {
    main: makeBelt(1500, 2.1, 3.3, 0.16, 0.22, 1.5, ['rgba(200,175,150,0.5)', 'rgba(170,150,130,0.4)', 'rgba(235,215,190,0.65)']),
    tro1: makeBelt(110, 5.0, 5.4, 0.05, 0.25, 1.6, ['rgba(180,160,140,0.6)', 'rgba(150,135,120,0.5)', 'rgba(220,200,175,0.7)'], { lead: jl + PI / 3, lockSp: jup.n }),
    tro2: makeBelt(110, 5.0, 5.4, 0.05, 0.25, 1.6, ['rgba(180,160,140,0.6)', 'rgba(150,135,120,0.5)', 'rgba(220,200,175,0.7)'], { lead: jl - PI / 3, lockSp: jup.n }),
    kuiper: makeBelt(1100, 36, 52, 0.12, 0.45, 1.5, ['rgba(140,170,210,0.32)', 'rgba(120,150,190,0.25)', 'rgba(180,205,235,0.4)'])
  };
}
function beltProject(B, T) {
  for (let i = 0; i < B.n; i++) {
    const th = B.th0[i] + B.sp[i] * T, r = B.r[i] * (1 - B.e[i] * Math.cos(th - B.w[i]));
    if (project(r * Math.cos(th), r * B.inc[i] * Math.sin(th - B.node[i]), -r * Math.sin(th))) { B.sx[i] = PX; B.sy[i] = PY; B.sz[i] = PZ; } else B.sz[i] = 0;
  }
}
function beltDraw(ctx, B, zSun, near) {
  const DPR = app.DPR;
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = B.fills[k];
    for (let i = k; i < B.n; i += 3) {
      const z = B.sz[i];
      if (z === 0 || (z < zSun) !== near) continue;
      const s = clamp(B.size * DPR * Math.sqrt(260 / z) * 0.8, 0.8 * DPR, 2.3 * DPR);
      ctx.fillRect(B.sx[i] - s / 2, B.sy[i] - s / 2, s, s);
    }
  }
}

/* ───────────── орбиты и следы ───────────── */
function orbitsProject() {
  for (const p of PLANETS) {
    if (!p.osx) { p.osx = new Float32Array(ORBIT_SEG + 1); p.osy = new Float32Array(ORBIT_SEG + 1); p.osz = new Float32Array(ORBIT_SEG + 1); }
    for (let i = 0; i <= ORBIT_SEG; i++) {
      if (project(p.orbit[i * 3], p.orbit[i * 3 + 1], p.orbit[i * 3 + 2])) { p.osx[i] = PX; p.osy[i] = PY; p.osz[i] = PZ; } else p.osz[i] = 0;
    }
  }
}
function drawOrbits(ctx, near, zSun, focusIdx) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = Math.max(1, app.DPR * 0.9);
  for (const p of PLANETS) {
    const c = p.trail, al = p.idx === focusIdx ? 0.4 : 0.15;
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${al})`;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < ORBIT_SEG; i++) {
      const z0 = p.osz[i], z1 = p.osz[i + 1];
      if (z0 === 0 || z1 === 0 || (((z0 + z1) * 0.5 < zSun) !== near)) { pen = false; continue; }
      if (!pen) { ctx.moveTo(p.osx[i], p.osy[i]); pen = true; }
      ctx.lineTo(p.osx[i + 1], p.osy[i + 1]);
    }
    ctx.stroke();
  }
}
const TR_N = 72, trX = new Float32Array(TR_N + 1), trY = new Float32Array(TR_N + 1), TMP3 = [0, 0, 0], TMP4 = [0, 0, 0];
function strokeFading(ctx, n, rgb, aMax, w0, w1) {
  const G = 7, per = n / G;
  for (let g = 0; g < G; g++) {
    const i0 = Math.floor(g * per), i1 = Math.min(n, Math.floor((g + 1) * per) + 1);
    const f = 1 - (g + 0.5) / G, al = aMax * f * f;
    ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${al.toFixed(3)})`;
    ctx.lineWidth = lerp(w0, w1, g / G);
    ctx.beginPath(); let pen = false;
    for (let i = i0; i < i1; i++) {
      if (trX[i] !== trX[i]) { pen = false; continue; }
      if (!pen) { ctx.moveTo(trX[i], trY[i]); pen = true; } else ctx.lineTo(trX[i], trY[i]);
    }
    ctx.stroke();
  }
}
function drawTrail(ctx, p) {
  const span = p.trailSpan || 2.0, dT = span / p.n / TR_N, DPR = app.DPR;
  for (let j = 0; j <= TR_N; j++) {
    planetPos(p, app.T - j * dT, TMP3);
    if (project(TMP3[0], TMP3[1], TMP3[2])) { trX[j] = PX; trY[j] = PY; } else trX[j] = NaN;
  }
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  strokeFading(ctx, TR_N + 1, p.trail, 0.16, 5.5 * DPR, 2 * DPR);
  strokeFading(ctx, TR_N + 1, p.trail, 0.85, 1.9 * DPR, 0.5 * DPR);
}
function drawMoonTrail(ctx, m) {
  const p = m.parent, sgn = m.P > 0 ? 1 : -1, N = 40, DPR = app.DPR;
  for (let j = 0; j <= N; j++) {
    moonRel(m, m.ang - sgn * j * 0.035, TMP4);
    if (project(p.pos[0] + TMP4[0], p.pos[1] + TMP4[1], p.pos[2] + TMP4[2])) { trX[j] = PX; trY[j] = PY; } else trX[j] = NaN;
  }
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  strokeFading(ctx, N + 1, [210, 215, 230], 0.5, 1.3 * DPR, 0.5 * DPR);
}

/* ───────────── спрайты шаров ───────────── */
const LEVELS = [24, 32, 48, 64, 96, 128, 160, 192, 256, 320, 384, 448, 512, 640];
function pickLevel(n, cap) {
  let best = LEVELS[0];
  for (let i = 0; i < LEVELS.length; i++) { const L = LEVELS[i]; if (L > cap) break; best = L; if (L >= n) break; }
  return best;
}
function ensureSprite(body, need, cap) {
  let s = body.spr;
  if (s && need <= s.N * 1.15 && need >= s.N * 0.6 && s.N <= cap) return s;
  const N = pickLevel(need, cap);
  if (s && s.N === N) return s;
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const c = cv.getContext('2d');
  return (body.spr = { N, cv, c, img: c.createImageData(N, N), fresh: false });
}
let TVX = 0, TVY = 0, TVZ = 0;
function viewComps(x, y, z) {
  TVX = x * V.rx + y * V.ry + z * V.rz; TVY = x * V.ux + y * V.uy + z * V.uz; TVZ = -(x * V.fx + y * V.fy + z * V.fz);
}
const SP = { msh: new Float32Array(16), mcount: 0 };
function setAxes(pole, Xa, Za) {
  viewComps(pole[0], pole[1], pole[2]); SP.pvx = TVX; SP.pvy = TVY; SP.pvz = TVZ;
  viewComps(Xa[0], Xa[1], Xa[2]); SP.xx = TVX; SP.xy = TVY; SP.xz = TVZ;
  viewComps(Za[0], Za[1], Za[2]); SP.zx = TVX; SP.zy = TVY; SP.zz = TVZ;
}
const AXA = [0, 0, 0], AXZ = [0, 0, 0];
function spinAxes(p, th) {
  const c = Math.cos(th), s = Math.sin(th), e1 = p.e1, e2 = p.e2;
  AXA[0] = c * e1[0] + s * e2[0]; AXA[1] = c * e1[1] + s * e2[1]; AXA[2] = c * e1[2] + s * e2[2];
  AXZ[0] = s * e1[0] - c * e2[0]; AXZ[1] = s * e1[1] - c * e2[1]; AXZ[2] = s * e1[2] - c * e2[2];
}
function renderSphere(ctx, body, cx, cy, Rpx, ext, cap, isSun) {
  // разрешение спрайта = экранному размеру (в device-пикселях, DPR уже учтён); при просадке fps падает не ниже 70% —
  // дальше экономим не разрешением, а частотой перерасчёта освещения (кадр можно переиспользовать)
  const need = 2 * ext * Rpx * (0.7 + 0.3 * app.quality);
  const s = ensureSprite(body, Math.max(need, 16), cap), N = s.N;
  SP.ext = ext;
  const stale = app.quality < 0.45 ? 3 : app.quality < 0.8 ? 2 : 1;
  if (!(stale > 1 && N >= 128 && s.fresh && ((app.frame + body.sid) % stale))) {
    if (isSun) shadeSun(SP, s.img, N); else shadeBody(SP, s.img, N);
    s.c.putImageData(s.img, 0, 0); s.fresh = true;
  }
  const half = ext * Rpx;
  if (N >= 96) ctx.imageSmoothingQuality = 'high';       // крупные спрайты — аккуратная фильтрация при масштабировании
  ctx.drawImage(s.cv, cx - half, cy - half, half * 2, half * 2);
  ctx.imageSmoothingQuality = 'low';
}
function drawDot(ctx, x, y, r, col, k) {
  const DPR = app.DPR;
  ctx.globalCompositeOperation = 'lighter';
  const gs = Math.max(r * 7, 10 * DPR);
  ctx.globalAlpha = 0.5 * k; ctx.drawImage(col.glow, x - gs / 2, y - gs / 2, gs, gs);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = col.css; ctx.beginPath(); ctx.arc(x, y, Math.max(r, 0.8 * DPR), 0, TAU); ctx.fill();
}
const _sd = [0, 0, 0];
function sunDirView(pos) {
  const d = Math.hypot(pos[0], pos[1], pos[2]) || 1;
  viewComps(-pos[0] / d, -pos[1] / d, -pos[2] / d); SP.lx = TVX; SP.ly = TVY; SP.lz = TVZ;
  return d;
}
function drawPlanet(ctx, p) {
  const DPR = app.DPR, rpx = p.rpx;
  ctx.globalCompositeOperation = 'source-over';
  if (rpx < 40 * DPR) {   // мягкое гало, чтобы планеты читались на обзоре
    const gs = Math.max(rpx * 5, 12 * DPR) * (1 + (p.rings ? 0.6 : 0));
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3 * (1 - rpx / (40 * DPR));
    ctx.drawImage(p.glow, p.sx - gs / 2, p.sy - gs / 2, gs, gs); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  if (rpx < 1.5 * DPR) { drawDot(ctx, p.sx, p.sy, rpx, p.dot, 0.7); return; }
  const dist = sunDirView(p.pos);
  SP.sunI = clamp(1.7 * Math.sqrt(27 / dist), 0.85, 2.4);
  spinAxes(p, p.spinAng); setAxes(p.pole, AXA, AXZ);
  SP.tex = TEX[p.tex] || p.flat; SP.cloud = p.earth ? (TEX.earthCloud || null) : null; SP.lights = p.earth ? (TEX.earthLights || null) : null;
  SP.ring = p.rings ? RINGS[p.rings] : null; SP.atm = p.atm || null; SP.wrap = p.wrap; SP.limbK = p.limb || 0; SP.cloudShift = p.cloudAng * INV2PI;
  SP.spec = !!p.earth; SP.twi = p.twi;
  const ms = p.moons || [];
  SP.mcount = ms.length;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    viewComps(m.rel[0] / p.R, m.rel[1] / p.R, m.rel[2] / p.R);
    SP.msh[i * 4] = TVX; SP.msh[i * 4 + 1] = TVY; SP.msh[i * 4 + 2] = TVZ; SP.msh[i * 4 + 3] = m.r;
  }
  const ext = p.rings ? RINGS[p.rings].rout * 1.04 : (p.atm ? 1 + p.atm[3] + 0.02 : 1.02);
  renderSphere(ctx, p, p.sx, p.sy, rpx, ext, p.rings === 'saturn' ? 640 : 384, false);
}
function drawMoon(ctx, m) {
  const DPR = app.DPR, rpx = m.rpx, p = m.parent;
  ctx.globalCompositeOperation = 'source-over';
  if (rpx < 1.3 * DPR) { if (rpx > 0.12) drawDot(ctx, m.sx, m.sy, rpx, m.dot, 0.35); return; }
  const dist = sunDirView(m.wpos);
  let sunI = clamp(1.7 * Math.sqrt(27 / dist), 0.85, 2.4);
  // затмение: луна в тени планеты
  const rx = m.rel[0], ry = m.rel[1], rz = m.rel[2], lx = -m.wpos[0] / dist, ly = -m.wpos[1] / dist, lz = -m.wpos[2] / dist;
  const s = rx * lx + ry * ly + rz * lz;
  if (s < 0) {
    const px = rx - s * lx, py = ry - s * ly, pz = rz - s * lz, pr = Math.sqrt(px * px + py * py + pz * pz);
    sunI *= 0.03 + 0.97 * smooth(p.R * 0.9, p.R * 1.12, pr);
  }
  SP.sunI = sunI;
  const mp = v3.cross(m.u, m.v), ca = Math.cos(m.ang), sa = Math.sin(m.ang);
  AXZ[0] = -(ca * m.u[0] + sa * m.v[0]); AXZ[1] = -(ca * m.u[1] + sa * m.v[1]); AXZ[2] = -(ca * m.u[2] + sa * m.v[2]);
  const Xa = v3.cross(mp, AXZ);
  setAxes(mp, Xa, AXZ);
  SP.tex = TEX[m.tex] || m.flat; SP.cloud = null; SP.lights = null; SP.ring = null; SP.atm = m.atm ? [.95, .6, .25, .05, .8] : null;
  SP.wrap = 0.04; SP.limbK = m.atm ? 0.3 : 0; SP.cloudShift = 0; SP.mcount = 0; SP.spec = false; SP.twi = 0.3;
  renderSphere(ctx, m, m.sx, m.sy, rpx, m.atm ? 1.08 : 1.02, 128, false);
}

/* ───────────── комета: ядро, кома, ионный и пылевой хвосты (от Солнца) ───────────── */
const CP = [0, 0, 0];
function tailPoints(c, away, vel, len, curve, n) {
  for (let j = 0; j <= n; j++) {
    const t = j / n;
    const x = c.pos[0] + away[0] * len * t - vel[0] * curve * t * t, y = c.pos[1] + away[1] * len * t - vel[1] * curve * t * t, z = c.pos[2] + away[2] * len * t - vel[2] * curve * t * t;
    if (project(x, y, z)) { trX[j] = PX; trY[j] = PY; } else trX[j] = NaN;
  }
}
function drawComet(ctx) {
  const c = COMET, DPR = app.DPR, dist = Math.hypot(c.pos[0], c.pos[1], c.pos[2]) || 1;
  const act = clamp(24 / dist, 0.2, 2.8), away = [c.pos[0] / dist, c.pos[1] / dist, c.pos[2] / dist], vel = v3.norm(c.vel);
  const len = 44 * act;
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  tailPoints(c, away, vel, len * 0.8, len * 0.38, 30);                  // пылевой хвост — изогнут против движения
  strokeFading(ctx, 31, [255, 222, 165], 0.1 * Math.min(act, 1.6), 20 * DPR, 3 * DPR);
  strokeFading(ctx, 31, [255, 232, 190], 0.32 * Math.min(act, 1.6), 6 * DPR, 1 * DPR);
  tailPoints(c, away, vel, len, 0, 30);                                  // ионный хвост — прямой, голубой
  strokeFading(ctx, 31, [120, 185, 255], 0.12 * Math.min(act, 1.6), 12 * DPR, 2 * DPR);
  strokeFading(ctx, 31, [170, 215, 255], 0.5 * Math.min(act, 1.6), 3.4 * DPR, 0.6 * DPR);
  const cs = Math.max(V.foc * 2.4 * act / c.sz, 12 * DPR);
  ctx.globalAlpha = 0.8; ctx.drawImage(SKY.glowB, c.sx - cs, c.sy - cs, cs * 2, cs * 2);
  const ns = Math.max(V.foc * 0.9 / c.sz, 5 * DPR);
  ctx.globalAlpha = 1; ctx.drawImage(SKY.glowW, c.sx - ns, c.sy - ns, ns * 2, ns * 2);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(c.sx, c.sy, Math.max(1.1 * DPR, V.foc * 0.28 / c.sz), 0, TAU); ctx.fill();
}

/* ───────────── Солнце: поверхность, корона, лучи, протуберанцы ───────────── */
function fillClipped(ctx, x, y, w) {      // квадрат со стороной w, обрезанный по холсту (градиент задан в абсолютных координатах)
  const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(app.VW, x + w), y1 = Math.min(app.VH, y + w);
  if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}
function drawSun(ctx, sx, sy, Rpx, t) {
  const DPR = app.DPR;
  // дальняя корона и общий отсвет (аддитивно)
  ctx.globalCompositeOperation = 'lighter';
  // на обзоре (Солнце мелкое) ореол уже и слабее — иначе он засвечивает внутренние орбиты и планеты
  const sm = clamp(Rpx / 70, 0, 1), kg = 0.4 + 0.6 * sm;
  let R = Rpx * (4.2 + 4.8 * sm);
  let g = ctx.createRadialGradient(sx, sy, Rpx * 0.8, sx, sy, R);
  g.addColorStop(0, `rgba(255,170,80,${(0.5 * kg).toFixed(3)})`); g.addColorStop(0.1, `rgba(255,130,50,${(0.22 * kg).toFixed(3)})`);
  g.addColorStop(0.35, `rgba(255,90,30,${(0.06 * kg).toFixed(3)})`); g.addColorStop(1, 'rgba(255,60,20,0)');
  ctx.fillStyle = g; fillClipped(ctx, sx - R, sy - R, R * 2);
  R = Rpx * (1.9 + 0.7 * sm);
  g = ctx.createRadialGradient(sx, sy, Rpx * 0.9, sx, sy, R);
  g.addColorStop(0, `rgba(255,235,185,${(0.75 * kg).toFixed(3)})`); g.addColorStop(0.3, `rgba(255,190,110,${(0.32 * kg).toFixed(3)})`); g.addColorStop(1, 'rgba(255,140,60,0)');
  ctx.fillStyle = g; fillClipped(ctx, sx - R, sy - R, R * 2);
  // лучи
  for (let k = 0; k < 26; k++) {
    const h1 = Math.sin(k * 12.9898) * 43758.5453, rr = h1 - Math.floor(h1);
    const ang = k * TAU / 26 + rr * 0.3 + t * (0.012 + rr * 0.01);
    const pulse = 0.5 + 0.5 * Math.sin(t * (0.5 + rr) + k * 1.7);
    const len = Rpx * (1.6 + 2.6 * rr * (0.55 + 0.45 * pulse)), hh = Rpx * (0.05 + 0.07 * rr);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
    ctx.globalAlpha = (0.16 + 0.2 * pulse * rr) * (0.55 + 0.45 * sm);
    ctx.drawImage(SKY.ray, Rpx * 0.85, -hh / 2, len, hh);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // поверхность
  ctx.globalCompositeOperation = 'source-over';
  SP.time = t; SP.mcount = 0;
  const th = t * 0.1, c = Math.cos(th), s = Math.sin(th);
  const pole = SUNPOLE, e1 = SUNE1, e2 = SUNE2;
  AXA[0] = c * e1[0] + s * e2[0]; AXA[1] = c * e1[1] + s * e2[1]; AXA[2] = c * e1[2] + s * e2[2];
  AXZ[0] = s * e1[0] - c * e2[0]; AXZ[1] = s * e1[1] - c * e2[1]; AXZ[2] = s * e1[2] - c * e2[2];
  setAxes(pole, AXA, AXZ);
  renderSphere(ctx, SUN, sx, sy, Rpx, 1, 320, true);
  // протуберанцы
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const life = ((t * 0.07 + i * 0.173) % 1), env = Math.sin(life * PI), idx = Math.floor(t * 0.07 + i * 0.173);
    const hs = Math.sin((idx * 7 + i) * 78.233) * 43758.5453, hr = hs - Math.floor(hs);
    const a0 = (i * 1.1 + hr * 4) + t * 0.01, da = 0.14 + 0.2 * hr, hgt = 0.35 + 0.7 * hr;
    const x0 = sx + Math.cos(a0) * Rpx * 0.97, y0 = sy + Math.sin(a0) * Rpx * 0.97;
    const x1 = sx + Math.cos(a0 + da) * Rpx * 0.97, y1 = sy + Math.sin(a0 + da) * Rpx * 0.97;
    const am = a0 + da / 2, rc = Rpx * (1 + 1.5 * hgt * env), qx = sx + Math.cos(am) * rc, qy = sy + Math.sin(am) * rc;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(qx, qy, x1, y1);
    ctx.strokeStyle = `rgba(255,80,30,${0.1 * env})`; ctx.lineWidth = Rpx * 0.07; ctx.stroke();
    ctx.strokeStyle = `rgba(255,150,70,${0.3 * env})`; ctx.lineWidth = Rpx * 0.025; ctx.stroke();
    ctx.strokeStyle = `rgba(255,235,180,${0.55 * env})`; ctx.lineWidth = Math.max(1, Rpx * 0.008); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}
const SUNPOLE = v3.norm([0.12, 1, 0.05]);
const SUNE1 = planeBasis(SUNPOLE)[0], SUNE2 = planeBasis(SUNPOLE)[1];

/* ───────────── блик объектива, подписи, bloom, виньетка ───────────── */
function drawFlare(ctx, sx, sy, Rpx) {
  const VW = app.VW, VH = app.VH;
  const dxc = VW / 2 - sx, dyc = VH / 2 - sy;
  const off = Math.hypot(sx - VW / 2, sy - VH / 2) / (0.5 * Math.hypot(VW, VH));
  if (sx < -VW * 0.3 || sx > VW * 1.3 || sy < -VH * 0.3 || sy > VH * 1.3) return;
  const vis = clamp(1.05 - off * 0.75, 0.12, 1) * clamp(Rpx / 14, 0.35, 1) * (0.55 + 0.45 * clamp(Rpx / 70, 0, 1));
  ctx.globalCompositeOperation = 'lighter';
  // анаморфная полоса
  ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.02);
  ctx.globalAlpha = 0.32 * vis; ctx.drawImage(SKY.glowB, -VW * 0.5, -VW * 0.5, VW, VW);
  ctx.globalAlpha = 0.4 * vis; ctx.scale(0.35, 1); ctx.drawImage(SKY.glowO, -VW * 0.5, -VW * 0.5, VW, VW);
  ctx.restore();
  // «призраки»
  const gh = [[0.35, 0.10, 'O', 0.12], [0.62, 0.17, 'B', 0.07], [1.0, 0.07, 'W', 0.1], [1.35, 0.26, 'B', 0.06], [1.8, 0.12, 'O', 0.09]];
  for (let i = 0; i < gh.length; i++) {
    const gx = sx + dxc * gh[i][0], gy = sy + dyc * gh[i][0], gs = gh[i][1] * VH * 2;
    ctx.globalAlpha = gh[i][3] * vis;
    ctx.drawImage(gh[i][2] === 'O' ? SKY.glowO : gh[i][2] === 'B' ? SKY.glowB : SKY.glowW, gx - gs / 2, gy - gs / 2, gs, gs);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
/* подписи: у диска с учётом экранного радиуса; кандидаты размещаются жадно по приоритету (фокус, крупные, ближние),
   перекрывающиеся и попадающие под панель/HUD — сдвигаются на другую сторону или скрываются */
const LBL = [], PLACED = [], OBST = [];
const LDIR = [[0.7071, -0.7071], [0.7071, 0.7071], [-0.7071, -0.7071], [-0.7071, 0.7071], [0, -1], [0, 1], [1, 0], [-1, 0]];
function measureObstacles() {
  OBST.length = 0;
  if (typeof document === 'undefined' || !document.querySelector) return;
  const DPR = app.DPR;
  ['.panel', '.info', '.date'].forEach(sel => {
    const e = document.querySelector(sel);
    if (!e) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) OBST.push([r.left * DPR - 6, r.top * DPR - 6, r.right * DPR + 6, r.bottom * DPR + 6]);
  });
}
function pushLabel(x, y, r, text, size, alpha, pri) { LBL.push({ x, y, r, t: text, size, a: alpha, pri }); }
function hitsRect(R, A, pad) { return !(R[2] + pad < A[0] || R[0] - pad > A[2] || R[3] + pad < A[1] || R[1] - pad > A[3]); }
function drawLabels(ctx, focusIdx, sunVisible, sunPx) {
  const DPR = app.DPR, VW = app.VW, VH = app.VH;
  LBL.length = 0; PLACED.length = 0;
  if (sunVisible) pushLabel(sunPx[0], sunPx[1], sunPx[2], 'Солнце', 12, 0.9, sunPx[2] + (focusIdx === -2 ? 1e5 : 20));
  if (COMET.sz) pushLabel(COMET.sx, COMET.sy, 4 * DPR, 'Комета', 11, 0.7, 2);
  for (const p of PLANETS) {
    if (p.sz === 0) continue;
    const foc = p.idx === focusIdx;
    pushLabel(p.sx, p.sy, p.rpx, p.name, foc ? 14 : 12, foc ? 1 : 0.88, p.rpx * (p.rings ? 1.5 : 1) + (foc ? 1e6 : 0));
    if (foc && p.moons) for (const m of p.moons) if (m.sz > 0) pushLabel(m.sx, m.sy, Math.max(m.rpx, 3 * DPR), m.name, 11, 0.75, 1e3 + m.rpx);
  }
  LBL.sort((a, b) => b.pri - a.pri);
  ctx.globalCompositeOperation = 'source-over'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
  const gap = 8 * DPR, pad = 3 * DPR;
  for (let i = 0; i < LBL.length; i++) {
    const L = LBL[i];
    if (L.x < -L.r || L.x > VW + L.r || L.y < -L.r || L.y > VH + L.r) continue;
    ctx.font = `${L.size * DPR}px "Segoe UI", system-ui, sans-serif`;
    const w = ctx.measureText(L.t).width, h = L.size * DPR * 1.3;
    let done = false;
    for (let step = 0; step < 3 && !done; step++) {
      for (let k = 0; k < LDIR.length && !done; k++) {
        const dx = LDIR[k][0], dy = LDIR[k][1], d = L.r + gap + step * 16 * DPR;
        const ax = L.x + dx * d, ay = L.y + dy * d;
        const x0 = dx > 0.3 ? ax : dx < -0.3 ? ax - w : ax - w / 2, y0 = dy < -0.3 ? ay - h : dy > 0.3 ? ay : ay - h / 2;
        const R = [x0, y0, x0 + w, y0 + h];
        if (R[0] < 6 * DPR || R[2] > VW - 6 * DPR || R[1] < 6 * DPR || R[3] > VH - 6 * DPR) continue;
        let bad = false;
        for (let j = 0; j < PLACED.length && !bad; j++) if (hitsRect(R, PLACED[j], pad)) bad = true;
        for (let j = 0; j < OBST.length && !bad; j++) if (hitsRect(R, OBST[j], 0)) bad = true;
        if (bad) continue;
        PLACED.push(R); done = true;
        ctx.globalAlpha = L.a * 0.45; ctx.strokeStyle = '#cfe0ff'; ctx.lineWidth = DPR;
        ctx.beginPath(); ctx.moveTo(L.x + dx * (L.r + 2 * DPR), L.y + dy * (L.r + 2 * DPR)); ctx.lineTo(ax - dx * 1.5 * DPR, ay - dy * 1.5 * DPR); ctx.stroke();
        ctx.globalAlpha = L.a; ctx.lineWidth = 3 * DPR; ctx.strokeStyle = 'rgba(3,6,16,0.8)'; ctx.strokeText(L.t, x0, y0 + h / 2);
        ctx.fillStyle = '#eaf1ff'; ctx.fillText(L.t, x0, y0 + h / 2);
      }
    }
  }
  ctx.globalAlpha = 1;
}
const BLOOM = { cv: null, c: null, ok: false };
function initBloom() {
  try {
    BLOOM.cv = document.createElement('canvas'); BLOOM.c = BLOOM.cv.getContext('2d');
    BLOOM.c.filter = 'blur(1px)';
    BLOOM.ok = BLOOM.c.filter === 'blur(1px)';
  } catch (e) { BLOOM.ok = false; }
}
function resizeBloom() {
  if (!BLOOM.cv) return;
  BLOOM.cv.width = Math.max(64, Math.round(app.VW / 5)); BLOOM.cv.height = Math.max(40, Math.round(app.VH / 5));
}
function postFX(ctx) {
  const VW = app.VW, VH = app.VH;
  if (BLOOM.ok && app.quality > 0.5) {
    const b = BLOOM.c;
    b.globalCompositeOperation = 'copy'; b.filter = 'brightness(1.1) contrast(1.8) blur(2px)';
    b.drawImage(app.cvs, 0, 0, BLOOM.cv.width, BLOOM.cv.height); b.filter = 'none';
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
    ctx.drawImage(BLOOM.cv, 0, 0, VW, VH);
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
  const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.35, VW / 2, VH / 2, Math.hypot(VW, VH) * 0.58);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,6,0.62)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
}

/* ───────────── мир, камера, кино-тур ───────────── */
const PITCH = [0.3, 0.3, 0.27, 0.3, 0.2, 0.3, 0.34, 0.3];   // удобный наклон камеры для каждой планеты
const focus = { id: -1, u: 1, dur: 2.8, fx: 0, fy: 0, fz: 0, fd: 300 };
let pitchBase = 0.6, pitchTarget = 0.6;
const drag = { active: false, x: 0, y: 0, moved: 0 };
const ease = u => u * u * u * (u * (u * 6 - 15) + 10);
const SHOTS = [[-1, 9], [-2, 7], [2, 14], [3, 8], [4, 15], [5, 16], [6, 10], [7, 10], [1, 8], [0, 8]];
const tour = { i: 0, t: 0 };
let uiHooks = { onFocus: null };

function aspectK() { return Math.max(1, 1.45 / (app.VW / app.VH)); }
function fitDist() { const foc = (app.VH / 2) / Math.tan(21 * D2R); return Math.max(120, foc * 150 / (0.46 * app.VW)); }   // в кадр целиком — до орбиты Урана, Нептун уходит за край (масштаб — слайдером)
function baseDist(id) {
  if (id === -1) return fitDist();
  if (id === -2) return SUN_R * 6.4 * aspectK();
  return PLANETS[id].fk * PLANETS[id].R * aspectK();
}
function minDist(id) { return id === -1 ? 50 : (id === -2 ? SUN_R : PLANETS[id].R) * 1.9; }
function focusPos(out) {
  if (focus.id >= 0) { const p = PLANETS[focus.id].pos; out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; } else { out[0] = out[1] = out[2] = 0; }
}
function setFocus(id, fromTour) {
  if (!fromTour && app.tour) { app.tour = false; if (uiHooks.onTour) uiHooks.onTour(); }
  focus.id = id; focus.u = 0; focus.fx = cam.tx; focus.fy = cam.ty; focus.fz = cam.tz; focus.fd = cam.dist;
  pitchTarget = id >= 0 ? PITCH[id] : id === -2 ? 0.22 : 0.6;
  if (uiHooks.onFocus) uiHooks.onFocus(id);
}
function startTour() { app.tour = true; tour.i = 0; tour.t = 0; setFocus(SHOTS[0][0], true); }

/* наклон камеры, при котором плоскость колец раскрыта на elev рад (иначе кольца схлопываются в линию) */
function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
function ringPitch(p, elev) {
  const A = p.pole[1], B = Math.sin(cam.yaw) * p.pole[0] + Math.cos(cam.yaw) * p.pole[2];
  const R = Math.hypot(A, B), C = Math.sin(elev);
  if (R < 1e-3 || Math.abs(C / R) > 1) return 0.3;
  const th = Math.atan2(B, A), s = Math.asin(C / R);
  const c1 = wrapPi(s - th), c2 = wrapPi(PI - s - th);
  const ok1 = c1 > -0.05 && c1 < 1.15, ok2 = c2 > -0.05 && c2 < 1.15;
  if (ok1 && ok2) return Math.abs(c1 - pitchBase) < Math.abs(c2 - pitchBase) ? c1 : c2;
  if (ok1) return c1;
  if (ok2) return c2;
  return clamp(c1, -0.05, 1.15);
}
const FP = [0, 0, 0];
function stepCamera(dt) {
  const fp = focus.id >= 0 ? PLANETS[focus.id] : null;
  if (fp && fp.rings === 'saturn' && app.time > app.pitchHold && !drag.active) pitchTarget = ringPitch(fp, 0.42);
  if (app.tour) {
    tour.t += dt;
    if (tour.t > SHOTS[tour.i][1]) { tour.t = 0; tour.i = (tour.i + 1) % SHOTS.length; setFocus(SHOTS[tour.i][0], true); }
  }
  if (!drag.active) cam.yaw += dt * 0.05 * app.camSpeed;
  pitchBase += (pitchTarget - pitchBase) * (1 - Math.exp(-dt * 1.6));
  cam.pitch = clamp(pitchBase + 0.06 * Math.sin(app.time * 0.09) * Math.min(1, app.camSpeed), -1.45, 1.45);
  app.zoomS += (app.zoom - app.zoomS) * (1 - Math.exp(-dt * 8));
  const want = Math.max(minDist(focus.id), baseDist(focus.id) / app.zoomS);
  focusPos(FP);
  if (focus.u < 1) {
    focus.u = Math.min(1, focus.u + dt / focus.dur);
    const e = ease(focus.u);
    cam.tx = lerp(focus.fx, FP[0], e); cam.ty = lerp(focus.fy, FP[1], e); cam.tz = lerp(focus.fz, FP[2], e);
    cam.dist = Math.exp(lerp(Math.log(focus.fd), Math.log(want), e));
  } else {
    cam.tx = FP[0]; cam.ty = FP[1]; cam.tz = FP[2];
    cam.dist += (want - cam.dist) * (1 - Math.exp(-dt * 6));
  }
}
function stepWorld(dt) {
  const sp = app.paused ? 0 : app.speed;
  app.T += dt * sp * YPS;
  const ss = Math.min(sp, 3);
  planetPos(COMET, app.T, COMET.pos); planetPos(COMET, app.T + 0.01, CP);
  COMET.vel[0] = CP[0] - COMET.pos[0]; COMET.vel[1] = CP[1] - COMET.pos[1]; COMET.vel[2] = CP[2] - COMET.pos[2];
  for (const p of PLANETS) {
    planetPos(p, app.T, p.pos);
    p.spinAng += dt * ss * TAU / p.spin; p.cloudAng += dt * ss * 0.025;
    for (const m of (p.moons || [])) {
      m.ang += dt * ss * TAU / m.P; moonRel(m, m.ang, m.rel);
      m.wpos[0] = p.pos[0] + m.rel[0]; m.wpos[1] = p.pos[1] + m.rel[1]; m.wpos[2] = p.pos[2] + m.rel[2];
    }
  }
}

/* ───────────── кадр ───────────── */
const ITEMS = [], SUNIT = { z: 0, k: 0 }, NEARIT = { z: 0, k: 3 }, COMETIT = { z: 0, k: 4 };
const SUNS = { x: 0, y: 0, r: 0, ok: false };
function renderFrame() {
  const ctx = app.ctx, DPR = app.DPR, VW = app.VW, VH = app.VH;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
  updateView(VW, VH);
  drawSky(ctx, app.time);
  const sunOK = project(0, 0, 0), zSun = sunOK ? PZ : 0;
  SUNS.ok = sunOK;
  ITEMS.length = 0;
  if (sunOK) { SUNS.x = PX; SUNS.y = PY; SUNS.r = V.foc * SUN_R / PZ; SUNIT.z = PZ; ITEMS.push(SUNIT); }
  NEARIT.z = zSun - 0.001; ITEMS.push(NEARIT);
  if (project(COMET.pos[0], COMET.pos[1], COMET.pos[2])) { COMET.sx = PX; COMET.sy = PY; COMET.sz = PZ; COMETIT.z = PZ; ITEMS.push(COMETIT); } else COMET.sz = 0;
  for (const p of PLANETS) {
    if (project(p.pos[0], p.pos[1], p.pos[2])) {
      p.sx = PX; p.sy = PY; p.sz = PZ; p.rpx = V.foc * p.R / PZ; p.item.z = PZ; ITEMS.push(p.item);
    } else p.sz = 0;
    for (const m of (p.moons || [])) {
      if (project(m.wpos[0], m.wpos[1], m.wpos[2])) {
        m.sx = PX; m.sy = PY; m.sz = PZ; m.rpx = V.foc * m.r * p.R / PZ; m.item.z = PZ; ITEMS.push(m.item);
      } else m.sz = 0;
    }
  }
  ITEMS.sort((a, b) => b.z - a.z);
  if (app.orbits) { orbitsProject(); drawOrbits(ctx, false, zSun, focus.id); }
  const belts = app.belts ? [BELTS.main, BELTS.tro1, BELTS.tro2, BELTS.kuiper] : [];
  for (const b of belts) beltProject(b, app.T);
  for (const b of belts) beltDraw(ctx, b, zSun, false);
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < ITEMS.length; i++) {
    const it = ITEMS[i];
    if (it.k === 0) {
      if (SUNS.x > -SUNS.r * 10 && SUNS.x < VW + SUNS.r * 10 && SUNS.y > -SUNS.r * 10 && SUNS.y < VH + SUNS.r * 10) drawSun(ctx, SUNS.x, SUNS.y, SUNS.r, app.time);
    } else if (it.k === 3) {
      if (app.orbits) drawOrbits(ctx, true, zSun, focus.id);
      for (const b of belts) beltDraw(ctx, b, zSun, true);
    } else if (it.k === 4) {
      if (app.trails) drawTrail(ctx, COMET);
      drawComet(ctx);
    } else if (it.k === 1) {
      const p = it.o;
      if (app.trails) drawTrail(ctx, p);
      const mg = p.rpx * (p.rings ? 3 : 1.6) + 8;
      if (p.sx > -mg && p.sx < VW + mg && p.sy > -mg && p.sy < VH + mg) drawPlanet(ctx, p);
    } else {
      const m = it.o, mg = m.rpx * 2 + 8;
      if (app.trails && m.parent.rpx > 38 * DPR) drawMoonTrail(ctx, m);
      if (m.sx > -mg && m.sx < VW + mg && m.sy > -mg && m.sy < VH + mg) drawMoon(ctx, m);
    }
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  if (sunOK) drawFlare(ctx, SUNS.x, SUNS.y, SUNS.r);
  postFX(ctx);
  if (app.labels) drawLabels(ctx, focus.id, sunOK, [SUNS.x, SUNS.y, SUNS.r]);   // после блума: подписи чёткие, не тонут в ореоле
}

/* ───────────── интерфейс ───────────── */
const FACTS = {
  '-1': ['Обзор системы', 'Орбиты — настоящие эллипсы с реальными наклонами и эксцентриситетами, расстояния сжаты (≈ a^0,6), размеры планет увеличены. Положения — на сегодняшнюю дату.'],
  '-2': ['Солнце', 'Звезда: гранулы, пятна, протуберанцы и корона. Единственный источник света — у каждой планеты своя ночная сторона.'],
  0: ['Меркурий', 'Самый вытянутый эллипс (e = 0,21) и самый быстрый год — 88 суток. Лишён атмосферы, покрыт кратерами.'],
  1: ['Венера', 'Вращается «задом наперёд». Плотная атмосфера размывает терминатор и светится по краю.'],
  2: ['Земля', 'Облака, океаны с бликом и огни городов на ночной стороне. Луна уходит в тень планеты — лунное затмение.'],
  3: ['Марс', 'Ржавая пустыня, тёмные базальтовые области и полярные шапки.'],
  4: ['Юпитер', 'Полосы облаков и Большое красное пятно. Тени Ио, Европы, Ганимеда и Каллисто падают на диск.'],
  5: ['Сатурн', 'Кольца C, B, A со щелями Кассини и Энке; тень планеты на кольцах и тень колец на шаре.'],
  6: ['Уран', 'Ось наклонена на 98°: планета «катится» по орбите, а тонкие кольца стоят почти вертикально.'],
  7: ['Нептун', 'Тёмно-синий шар с белыми перистыми облаками. Тритон летит против вращения планеты.']
};
const $ = id => document.getElementById(id);
function fmtYears(y) { return y < 1 ? (y * 365.25).toFixed(0) + ' сут' : y < 10 ? y.toFixed(2).replace('.', ',') + ' г' : y.toFixed(1).replace('.', ',') + ' г'; }
function updateInfo(id) {
  const f = FACTS[id];
  let st = '';
  if (id >= 0) {
    const p = PLANETS[id];
    st = `<span>${p.a.toFixed(2).replace('.', ',')} а.е.</span><span>год ${fmtYears(p.period)}</span><span>орбита ${p.I.toFixed(1).replace('.', ',')}°</span>` +
      (p.moons ? `<span>спутников на сцене: ${p.moons.length}</span>` : '');
  }
  $('infoName').textContent = f[0]; $('infoText').textContent = f[1]; $('infoStats').innerHTML = st;
  document.querySelectorAll('#chips button').forEach(b => b.classList.toggle('on', +b.dataset.id === id));
  measureObstacles();
}
function buildUI() {
  const chips = $('chips');
  const list = [[-1, 'Обзор'], [-2, 'Солнце']].concat(PLANETS.map(p => [p.idx, p.name]));
  list.forEach(([id, name]) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.dataset.id = id;
    b.addEventListener('click', () => setFocus(id)); chips.appendChild(b);
  });
  const bind = (id, vid, fn, fmt) => {
    const el = $(id), out = $(vid);
    const on = () => { const v = +el.value / 100; fn(v); out.textContent = fmt(v); };
    el.addEventListener('input', on); on();
  };
  bind('zoom', 'zoomV', v => { app.zoom = Math.pow(2, v); }, v => '×' + Math.pow(2, v).toFixed(2).replace('.', ','));
  bind('speed', 'speedV', v => { app.speed = Math.pow(2, v); }, v => '×' + Math.pow(2, v).toFixed(2).replace('.', ','));
  bind('camspd', 'camV', v => { app.camSpeed = v; }, v => v.toFixed(1).replace('.', ',') + '×');
  document.querySelectorAll('[data-t]').forEach(b => {
    const k = b.dataset.t;
    b.classList.toggle('on', !!app[k]);
    b.addEventListener('click', () => { app[k] = !app[k]; b.classList.toggle('on', app[k]); });
  });
  const pause = $('pause');
  pause.addEventListener('click', () => { app.paused = !app.paused; pause.classList.toggle('on', app.paused); pause.textContent = app.paused ? '▶ Пуск' : '❚❚ Пауза'; });
  const tb = $('tour');
  uiHooks.onTour = () => tb.classList.toggle('on', app.tour);
  tb.addEventListener('click', () => { if (app.tour) { app.tour = false; } else startTour(); tb.classList.toggle('on', app.tour); });
  uiHooks.onFocus = updateInfo;
  updateInfo(-1);
}
function pick(x, y) {
  const DPR = app.DPR; x *= DPR; y *= DPR;
  let best = -3, bd = 1e9;
  for (const p of PLANETS) {
    if (!p.sz) continue;
    const d = Math.hypot(p.sx - x, p.sy - y), thr = Math.max(p.rpx * (p.rings ? 2 : 1.3), 16 * DPR);
    if (d < thr && d < bd) { bd = d; best = p.idx; }
  }
  if (best === -3 && SUNS.ok && Math.hypot(SUNS.x - x, SUNS.y - y) < Math.max(SUNS.r * 1.1, 16 * DPR)) best = -2;
  if (best !== -3) setFocus(best);
}
function bindInput() {
  const c = app.cvs;
  c.addEventListener('pointerdown', e => {
    drag.active = true; drag.x = e.clientX; drag.y = e.clientY; drag.moved = 0;
    try { c.setPointerCapture(e.pointerId); } catch (err) { /* sandbox */ }
  });
  c.addEventListener('pointermove', e => {
    if (!drag.active) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    cam.yaw -= dx * 0.006; pitchBase = clamp(pitchBase + dy * 0.005, -1.3, 1.4); pitchTarget = pitchBase; app.pitchHold = app.time + 6;
  });
  const up = e => {
    if (!drag.active) return;
    drag.active = false;
    if (drag.moved < 6) { const r = c.getBoundingClientRect(); pick(e.clientX - r.left, e.clientY - r.top); }
  };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', () => { drag.active = false; });
  c.addEventListener('wheel', e => {
    e.preventDefault();
    const z = $('zoom'), v = clamp(+z.value + (e.deltaY < 0 ? 12 : -12), +z.min, +z.max);
    z.value = v; z.dispatchEvent(new Event('input'));
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); $('pause').click(); }
    else if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') $('tour').click();
    else if (e.key >= '1' && e.key <= '8') setFocus(+e.key - 1);
    else if (e.key === '0') setFocus(-1);
    else if (e.key === '9') setFocus(-2);
  });
}
function resize() {
  const c = app.cvs, w = window.innerWidth, h = window.innerHeight;
  app.DPR = Math.min(window.devicePixelRatio || 1, 2);
  app.VW = Math.max(2, Math.floor(w * app.DPR)); app.VH = Math.max(2, Math.floor(h * app.DPR));
  c.width = app.VW; c.height = app.VH;
  resizeBloom(); measureObstacles();
}

/* ───────────── цикл ───────────── */
let lastTs = 0, dateAcc = 0;
function drawLoading() {
  const ctx = app.ctx, DPR = app.DPR, W = app.VW, H = app.VH;
  const done = TEXTOTAL - TEXQ.length - (TJ ? 1 : 0), core = 12, k = clamp(done / core, 0, 1);
  ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#02030a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(200,215,255,0.75)'; ctx.font = `${14 * DPR}px "Segoe UI", system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Зажигаем Солнце и рисуем планеты…', W / 2, H / 2 - 14 * DPR); ctx.textAlign = 'start';
  const bw = 220 * DPR, bx = W / 2 - bw / 2, by = H / 2 + 8 * DPR;
  ctx.fillStyle = 'rgba(160,185,255,0.16)'; ctx.fillRect(bx, by, bw, 3 * DPR);
  ctx.fillStyle = 'rgba(255,178,87,0.9)'; ctx.fillRect(bx, by, bw * k, 3 * DPR);
}
function frame(ts) {
  requestAnimationFrame(frame);
  let raw = ts - lastTs; lastTs = ts;
  if (!(raw > 0) || raw > 500) raw = 16.7;
  const dt = Math.min(raw, 50) / 1000;
  if (!TEX.mercury) { stepTex(30); drawLoading(); return; }   // сначала Солнце и все планеты (последняя в очереди — Меркурий); луны достроятся фоном
  stepTex(app.frame < 60 ? 6 : 3.5);
  app.time += dt; app.frame++;
  stepWorld(dt); stepCamera(dt);
  renderFrame();
  app.ema += (Math.min(raw, 80) - app.ema) * 0.06;
  if (app.ema > 24) app.quality = Math.max(0.3, app.quality * 0.985);
  else if (app.ema < 15.5) app.quality = Math.min(1, app.quality * 1.01);
  dateAcc += dt;
  if (dateAcc > 0.2) {
    dateAcc = 0;
    const d = new Date(J2000 + app.T * 365.25 * 86400000);
    $('date').textContent = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
}
function init() {
  app.cvs = $('scene'); app.ctx = app.cvs.getContext('2d', { alpha: false });
  initSkyData(); initSkyGfx(); initBelts(); initBloom();
  PLANETS.forEach(p => {
    const c = p.trail, lm = [0, 0.3, 0, 0, 0.3, 0.3, 0.2, 0.25];
    p.sid = p.idx + 1; p.item = { z: 0, k: 1, o: p }; p.limb = lm[p.idx]; p.twi = (p.tex === 'earth' || p.tex === 'mars' || p.tex === 'venus') ? 1 : 0.15; p.rpx = 0; p.sx = p.sy = p.sz = 0;
    p.flat = flatTex(c[0] / 255 * 0.8, c[1] / 255 * 0.8, c[2] / 255 * 0.8);
    p.glow = makeGlow(64, c[0], c[1], c[2], 2); p.dot = { glow: p.glow, css: `rgb(${c[0]},${c[1]},${c[2]})` };
    (p.moons || []).forEach((m, k) => {
      m.sid = 20 + p.idx * 4 + k; m.item = { z: 0, k: 2, o: m }; m.flat = flatTex(0.6, 0.6, 0.6);
      m.dot = { glow: SKY.glowW, css: 'rgb(215,215,220)' }; m.wpos = [0, 0, 0]; m.sx = m.sy = m.sz = 0; m.rpx = 0;
    });
  });
  SUN.sid = 0; app.zoomS = 1;
  COMET.M0 = -0.3 - COMET.n * app.T;       // старт: за 0,3 рад до перигелия
  resize(); window.addEventListener('resize', resize);
  buildUI(); bindInput();
  stepWorld(0);
  cam.yaw = 0.35; focus.id = -1; focus.u = 0; focus.dur = 6; focus.fx = focus.fy = focus.fz = 0; focus.fd = baseDist(-1) * 2.4; cam.dist = focus.fd;
  requestAnimationFrame(frame);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TEX, TEXQ, buildTex, shadeBody, shadeSun, PLANETS, SUN, RINGS, SP, V, cam, updateView, setAxes, spinAxes, AXA, AXZ,
    sunDirView, viewComps, app, planetPos, moonRel, flatTex, stepWorld, project, makeGlow, focus, setFocus, startTour, baseDist, BELTS: () => BELTS };
}
if (typeof document !== 'undefined' && document.getElementById('scene')) init();
})();
