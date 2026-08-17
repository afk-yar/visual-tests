/* 3D-аквариум — Claude Opus 5
 * Canvas 2D, без библиотек и WebGL. Собственный 3D-конвейер:
 * камера с базисом → перспективная проекция → сортировка по глубине (алгоритм
 * художника) → шейдинг с туманом. Рыбы — трёхмерные тела из колец сечений,
 * поэтому разворот к камере даёт честное укорочение, а не просто масштаб.
 *
 * Файл двухрежимный: в браузере запускает демку, в node экспортирует чистую
 * математику и построение кадра (headless-проверки перекрытия и укорочения).
 */
'use strict';

var AQUARIUM = (function () {

/* ══════════════════════════ математика ══════════════════════════ */

var TAU = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }

function makeRng(seed) {
  var s = (seed >>> 0) || 0x9e3779b9;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

function hash1(i, seed) {
  var h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise1(x, seed) {
  var i = Math.floor(x), f = x - i;
  var a = hash1(i, seed), b = hash1(i + 1, seed);
  return a + (b - a) * smoothstep(f);
}
function fbm1(x, seed) {
  return noise1(x, seed) * 0.6 +
         noise1(x * 2.13 + 11.7, seed + 7) * 0.28 +
         noise1(x * 4.31 + 5.1, seed + 17) * 0.12;
}

/* 2D value-noise — крупные пятна тона песка (частота низкая, чтобы сетка дна
 * не превращалась в шахматку при выборке по вершинам) */
function hash2(ix, iz, seed) {
  var h = (Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^
           Math.imul(seed | 0, 1274126177)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise2(x, z, seed) {
  var ix = Math.floor(x), iz = Math.floor(z);
  var fx = smoothstep(x - ix), fz = smoothstep(z - iz);
  var a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  var c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  var t0 = a + (b - a) * fx, t1 = c + (d - c) * fx;
  return t0 + (t1 - t0) * fz;
}
function fbm2(x, z, seed) {
  return vnoise2(x, z, seed) * 0.58 +
         vnoise2(x * 2.07 + 3.1, z * 2.07 - 1.7, seed + 11) * 0.28 +
         vnoise2(x * 4.13 - 5.3, z * 4.13 + 2.9, seed + 23) * 0.14;
}

/* ── цвет ── */
function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function mul3(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
/* Осветление с сохранением тона: множитель подрезается так, чтобы самый ярный
 * канал не улетал за 246. Без этого светлые виды (скалярия, кои) и жёлтый
 * хирург выбивались в белое и теряли цвет. */
function lift(a, k) {
  var m = a[0] > a[1] ? a[0] : a[1];
  if (a[2] > m) m = a[2];
  m *= k;
  if (m > 246) k *= 246 / m;
  return [a[0] * k, a[1] * k, a[2] * k];
}
function ch(v) { v = v < 0 ? 0 : (v > 255 ? 255 : v); return (v + 0.5) | 0; }
function css(c, a) {
  if (a === undefined || a >= 1) return 'rgb(' + ch(c[0]) + ',' + ch(c[1]) + ',' + ch(c[2]) + ')';
  return 'rgba(' + ch(c[0]) + ',' + ch(c[1]) + ',' + ch(c[2]) + ',' + (a < 0 ? 0 : a).toFixed(3) + ')';
}

/* ══════════════════════════ камера ══════════════════════════ */

function makeCamera() {
  return {
    px: 0, py: 4, pz: 14, tx: 0, ty: 3.5, tz: 0,
    fov: 0.92, roll: 0,
    focal: 1, cx: 0, cy: 0, w: 1, h: 1,
    fx: 0, fy: 0, fz: -1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0
  };
}

/* пересчёт ортонормированного базиса + фокусного расстояния */
function updateCamera(cam, w, h) {
  var fx = cam.tx - cam.px, fy = cam.ty - cam.py, fz = cam.tz - cam.pz;
  var l = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  fx /= l; fy /= l; fz /= l;

  /* right = normalize(cross(forward, worldUp)) */
  var rx = fy * 0 - fz * 1, ry = fz * 0 - fx * 0, rz = fx * 1 - fy * 0;
  var rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (rl < 1e-6) { rx = 1; ry = 0; rz = 0; rl = 1; }
  rx /= rl; ry /= rl; rz /= rl;

  /* up = cross(right, forward) */
  var ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;

  if (cam.roll) {
    var c = Math.cos(cam.roll), s = Math.sin(cam.roll);
    var nrx = rx * c + ux * s, nry = ry * c + uy * s, nrz = rz * c + uz * s;
    ux = ux * c - rx * s; uy = uy * c - ry * s; uz = uz * c - rz * s;
    rx = nrx; ry = nry; rz = nrz;
  }

  cam.fx = fx; cam.fy = fy; cam.fz = fz;
  cam.rx = rx; cam.ry = ry; cam.rz = rz;
  cam.ux = ux; cam.uy = uy; cam.uz = uz;
  cam.w = w; cam.h = h;
  cam.cx = w * 0.5; cam.cy = h * 0.5;
  cam.focal = (h * 0.5) / Math.tan(cam.fov * 0.5);
  return cam;
}

var NEAR = 0.12;

/* Перспективная проекция точки мира в экран.
 * o.z — глубина в пространстве камеры, o.s — масштабный коэффициент focal/z. */
function project(cam, x, y, z, o) {
  var dx = x - cam.px, dy = y - cam.py, dz = z - cam.pz;
  var cz = dx * cam.fx + dy * cam.fy + dz * cam.fz;
  o.z = cz;
  if (cz < NEAR) { o.ok = false; o.s = 0; o.x = 0; o.y = 0; return o; }
  var s = cam.focal / cz;
  o.x = cam.cx + (dx * cam.rx + dy * cam.ry + dz * cam.rz) * s;
  o.y = cam.cy - (dx * cam.ux + dy * cam.uy + dz * cam.uz) * s;
  o.s = s; o.ok = true;
  return o;
}
function newP() { return { x: 0, y: 0, z: 0, s: 0, ok: false }; }

/* ══════════════════════════ сцена: константы ══════════════════════════ */

var TANK = { hx: 6.7, hz: 4.6, y0: 0, y1: 7.3 };

var WATER = [
  [0.00, [8, 26, 33]],
  [0.30, [11, 47, 63]],
  [0.62, [19, 85, 104]],
  [0.86, [38, 126, 143]],
  [1.00, [64, 158, 168]]
];
function waterAt(y) {
  var t = clamp((y - TANK.y0) / (TANK.y1 - TANK.y0), 0, 1);
  for (var i = 1; i < WATER.length; i++) {
    if (t <= WATER[i][0]) {
      var a = WATER[i - 1], b = WATER[i];
      var k = (t - a[0]) / (b[0] - a[0] || 1);
      return mix3(a[1], b[1], k);
    }
  }
  return WATER[WATER.length - 1][1].slice();
}

/* Каустика: интерференция трёх модулированных волн, «остриё» через степень. */
function causticField(x, z, t) {
  var a = Math.sin(x * 1.02 + Math.sin(z * 0.55 + t * 0.50) * 1.9 + t * 0.62);
  var b = Math.sin(z * 0.94 + Math.sin(x * 0.62 - t * 0.44) * 1.7 - t * 0.51);
  var c = Math.sin(x * 0.58 + z * 0.71 + Math.sin((x - z) * 0.40 + t * 0.33) * 1.25 + t * 0.28);
  var m = (a + b + c) * 0.3333333;
  var r = 1 - (m < 0 ? -m : m);
  r *= r; r *= r; r = r * r * r;              /* ^6 — тонкие яркие жилы */
  var env = 0.55 + 0.45 * Math.sin(x * 0.21 - z * 0.17 + t * 0.19);
  return r * (0.45 + 0.55 * env);
}

/* Мягкое световое поле дна — очень низкая частота (длина волны ~13 ед.),
 * поэтому выборка по вершинам сетки не даёт скачков между клетками.
 * Резкие «жилы» каустики рисуются отдельно, кривыми лентами. */
function causticSoft(x, z, t) {
  var a = Math.sin(x * 0.46 + Math.sin(z * 0.30 + t * 0.21) * 1.1 + t * 0.17);
  var b = Math.sin(z * 0.39 - Math.sin(x * 0.26 - t * 0.18) * 0.9 - t * 0.13);
  return clamp(0.5 + 0.25 * (a + b), 0, 1);
}

/* рельеф песчаного дна */
function floorY(x, z) {
  return 0.17 * Math.sin(x * 0.42 + 1.1) * Math.cos(z * 0.36 - 0.4) +
         0.10 * Math.sin(x * 0.83 - z * 0.61 + 2.2) +
         0.05 * Math.sin((x + z) * 1.27);
}

/* аналитический градиент рельефа — гладкий ламберт без фасеток по клеткам */
var _fgrad = { dx: 0, dz: 0 };
function floorGrad(x, z, o) {
  var p1 = x * 0.42 + 1.1, p2 = z * 0.36 - 0.4;
  var p3 = x * 0.83 - z * 0.61 + 2.2, p4 = (x + z) * 1.27;
  var s1 = Math.sin(p1), c1 = Math.cos(p1);
  var s2 = Math.sin(p2), c2 = Math.cos(p2);
  var c3 = Math.cos(p3), c4 = Math.cos(p4);
  o.dx = 0.0714 * c1 * c2 + 0.083 * c3 + 0.0635 * c4;
  o.dz = -0.0612 * s1 * s2 - 0.061 * c3 + 0.0635 * c4;
  return o;
}

var SAND_A = [126, 108, 82];
var SAND_B = [198, 180, 148];
var CAUS_COL = [186, 240, 255];

var LIGHT = (function () {
  var lx = 0.20, ly = 1, lz = -0.16;
  var l = Math.sqrt(lx * lx + ly * ly + lz * lz);
  return { x: lx / l, y: ly / l, z: lz / l };
})();

/* ══════════════════════════ виды рыб ══════════════════════════ */

/* depth/width — полу-размеры относительно длины; disc — «дискообразность». */
var SPECIES = [
  {
    id: 'tetra', label: 'неоновая тетра', count: 16,
    len: 0.56, lenVar: 0.14, depth: 0.30, width: 0.105, disc: 0.10, discS: 0.34, discW: 0.34,
    fullness: 0.85, cruise: 1.5, force: 3.6, waveAmp: 0.075, waveK: 1.05, beat: 5.0,
    school: 1.0, sepR: 0.55, prefY: 4.3, spreadY: 1.9,
    back: [24, 52, 96], mid: [96, 152, 190], belly: [205, 222, 232],
    fin: [162, 214, 240], finA: 0.40,
    stripes: [
      { kind: 'lat', a0: 0.26, a1: 0.46, s0: 0.08, s1: 0.86, col: [86, 232, 255], alpha: 0.92, glow: 1 },
      { kind: 'lat', a0: 0.56, a1: 0.84, s0: 0.44, s1: 0.99, col: [236, 62, 60], alpha: 0.88 }
    ],
    tail: { type: 'fork', span: 0.30, len: 0.30 },
    dorsal: { s0: 0.40, s1: 0.58, h: 0.60 },
    anal: { s0: 0.58, s1: 0.82, h: 0.45 },
    pect: { s: 0.27, len: 0.20, flap: 7.0 },
    eye: { s: 0.115, up: 0.22, r: 0.075, iris: [16, 22, 30] }
  },
  {
    id: 'danio', label: 'данио', count: 11,
    len: 0.50, lenVar: 0.13, depth: 0.245, width: 0.095, disc: 0.0, discS: 0.4, discW: 0.4,
    fullness: 0.92, cruise: 1.85, force: 4.2, waveAmp: 0.085, waveK: 1.25, beat: 5.8,
    school: 1.15, sepR: 0.48, prefY: 5.4, spreadY: 1.5,
    back: [58, 74, 60], mid: [186, 178, 132], belly: [232, 228, 206],
    fin: [206, 208, 170], finA: 0.36,
    stripes: [
      { kind: 'lat', a0: 0.34, a1: 0.45, s0: 0.10, s1: 1.00, col: [30, 46, 70], alpha: 0.75 },
      { kind: 'lat', a0: 0.53, a1: 0.63, s0: 0.10, s1: 1.00, col: [40, 60, 84], alpha: 0.6 },
      { kind: 'lat', a0: 0.45, a1: 0.53, s0: 0.10, s1: 1.00, col: [246, 214, 132], alpha: 0.55 }
    ],
    tail: { type: 'fork', span: 0.26, len: 0.28 },
    dorsal: { s0: 0.44, s1: 0.62, h: 0.52 },
    anal: { s0: 0.60, s1: 0.84, h: 0.42 },
    pect: { s: 0.26, len: 0.19, flap: 8.0 },
    eye: { s: 0.11, up: 0.20, r: 0.07, iris: [18, 20, 26] }
  },
  {
    id: 'clown', label: 'клоун', count: 4,
    len: 0.82, lenVar: 0.12, depth: 0.34, width: 0.145, disc: 0.55, discS: 0.33, discW: 0.30,
    fullness: 0.78, cruise: 0.95, force: 2.6, waveAmp: 0.055, waveK: 0.9, beat: 3.6,
    school: 0.25, sepR: 1.1, prefY: 2.6, spreadY: 1.5,
    back: [186, 66, 10], mid: [242, 122, 26], belly: [252, 178, 96],
    fin: [252, 156, 60], finA: 0.72, finEdge: [22, 24, 32],
    stripes: [
      { kind: 'vert', s0: 0.10, s1: 0.20, col: [252, 250, 244], alpha: 0.95, edge: [26, 26, 34] },
      { kind: 'vert', s0: 0.40, s1: 0.52, col: [252, 250, 244], alpha: 0.95, edge: [26, 26, 34] },
      { kind: 'vert', s0: 0.80, s1: 0.88, col: [250, 246, 240], alpha: 0.9, edge: [26, 26, 34] }
    ],
    tail: { type: 'fan', span: 0.30, len: 0.26 },
    dorsal: { s0: 0.18, s1: 0.62, h: 0.42 },
    anal: { s0: 0.62, s1: 0.84, h: 0.40 },
    pect: { s: 0.30, len: 0.26, flap: 5.6 },
    eye: { s: 0.10, up: 0.20, r: 0.085, iris: [12, 14, 20] }
  },
  {
    id: 'angel', label: 'скалярия', count: 3,
    len: 1.02, lenVar: 0.14, depth: 0.30, width: 0.075, disc: 1.65, discS: 0.40, discW: 0.30,
    fullness: 0.72, cruise: 0.62, force: 1.9, waveAmp: 0.040, waveK: 0.75, beat: 2.5,
    school: 0.18, sepR: 1.5, prefY: 3.9, spreadY: 1.7,
    back: [52, 58, 70], mid: [180, 182, 176], belly: [238, 238, 230],
    fin: [226, 218, 194], finA: 0.50,
    stripes: [
      { kind: 'vert', s0: 0.06, s1: 0.15, col: [26, 30, 40], alpha: 0.78 },
      { kind: 'vert', s0: 0.34, s1: 0.44, col: [26, 30, 40], alpha: 0.82 },
      { kind: 'vert', s0: 0.66, s1: 0.74, col: [26, 30, 40], alpha: 0.68 }
    ],
    tail: { type: 'veil', span: 0.44, len: 0.52 },
    dorsal: { s0: 0.14, s1: 0.68, h: 1.55, filament: 1 },
    anal: { s0: 0.42, s1: 0.90, h: 1.35, filament: 1 },
    pect: { s: 0.30, len: 0.30, flap: 3.4 },
    pelvic: { s: 0.40, len: 1.35 },
    eye: { s: 0.09, up: 0.16, r: 0.06, iris: [180, 60, 40] }
  },
  {
    id: 'tang', label: 'жёлтый хирург', count: 3,
    len: 0.88, lenVar: 0.10, depth: 0.30, width: 0.085, disc: 0.95, discS: 0.38, discW: 0.34,
    fullness: 0.74, cruise: 0.95, force: 2.5, waveAmp: 0.050, waveK: 0.85, beat: 3.2,
    school: 0.35, sepR: 1.2, prefY: 3.2, spreadY: 1.8,
    back: [214, 148, 8], mid: [250, 206, 34], belly: [254, 236, 140],
    fin: [252, 216, 60], finA: 0.6,
    stripes: [{ kind: 'lat', a0: 0.05, a1: 0.16, s0: 0.20, s1: 0.95, col: [255, 246, 190], alpha: 0.4 }],
    tail: { type: 'lyre', span: 0.30, len: 0.28 },
    dorsal: { s0: 0.14, s1: 0.70, h: 0.62 },
    anal: { s0: 0.48, s1: 0.86, h: 0.55 },
    pect: { s: 0.32, len: 0.28, flap: 4.6 },
    eye: { s: 0.095, up: 0.22, r: 0.075, iris: [20, 18, 14] }
  },
  {
    id: 'koi', label: 'кои', count: 2,
    len: 1.62, lenVar: 0.16, depth: 0.235, width: 0.155, disc: 0.30, discS: 0.30, discW: 0.34,
    fullness: 0.88, cruise: 0.66, force: 1.7, waveAmp: 0.055, waveK: 0.8, beat: 2.1,
    school: 0.1, sepR: 2.0, prefY: 2.3, spreadY: 1.4,
    back: [206, 198, 186], mid: [242, 238, 230], belly: [252, 250, 246],
    fin: [246, 228, 206], finA: 0.56,
    stripes: [
      { kind: 'vert', s0: 0.05, s1: 0.26, col: [236, 108, 30], alpha: 0.9 },
      { kind: 'vert', s0: 0.44, s1: 0.60, col: [232, 96, 26], alpha: 0.85 },
      { kind: 'vert', s0: 0.70, s1: 0.82, col: [46, 44, 52], alpha: 0.55 }
    ],
    tail: { type: 'veil', span: 0.34, len: 0.46 },
    dorsal: { s0: 0.32, s1: 0.66, h: 0.42 },
    anal: { s0: 0.70, s1: 0.88, h: 0.34 },
    pect: { s: 0.28, len: 0.30, flap: 3.0 },
    eye: { s: 0.085, up: 0.16, r: 0.055, iris: [24, 20, 18] }
  }
];

/* профиль тела: полу-высота и полу-ширина в долях длины */
function bodyShape(s, fullness) {
  var a = Math.pow(Math.sin(Math.PI * Math.pow(clamp(s, 0, 1), 0.62)), fullness);
  return a * 0.94 + 0.055 * (1 - s * 0.86);
}
function halfH(sp, s) {
  var d = (s - sp.discS) / sp.discW;
  return bodyShape(s, sp.fullness) * (1 + sp.disc * Math.exp(-d * d)) * sp.depth;
}
function halfW(sp, s) {
  return bodyShape(s, sp.fullness) * sp.width;
}

/* ══════════════════════════ мир ══════════════════════════ */

function makeWorld(seed) {
  var rnd = makeRng(seed || 20260816);
  var w = {
    t: 0, rnd: rnd,
    fish: [], schools: [], bubbles: [], snow: [], weeds: [], rocks: [], shafts: [],
    env: { fog: 1, light: 1, caustics: 1, rays: 1 },
    _items: [], _pool: [], _np: 0
  };

  /* стаи (у стайных видов — общая блуждающая цель) */
  for (var si = 0; si < SPECIES.length; si++) {
    w.schools.push({
      x: (rnd() - 0.5) * TANK.hx, y: SPECIES[si].prefY, z: (rnd() - 0.5) * TANK.hz,
      seed: (rnd() * 1e6) | 0, cx: 0, cy: 0, cz: 0, vx: 0, vy: 0, vz: 0, n: 0
    });
  }

  for (var k = 0; k < SPECIES.length; k++) {
    var sp = SPECIES[k];
    for (var i = 0; i < sp.count; i++) {
      var a = rnd() * TAU;
      var f = {
        sp: sp, school: k,
        x: (rnd() * 2 - 1) * (TANK.hx - 1.3),
        y: clamp(sp.prefY + (rnd() * 2 - 1) * sp.spreadY, 0.9, TANK.y1 - 0.9),
        z: (rnd() * 2 - 1) * (TANK.hz - 1.0),
        vx: Math.cos(a) * sp.cruise, vy: (rnd() - 0.5) * 0.1, vz: Math.sin(a) * sp.cruise,
        len: sp.len * (1 + (rnd() * 2 - 1) * sp.lenVar),
        seed: (rnd() * 1e6) | 0,
        beatPh: rnd() * TAU, flapPh: rnd() * TAU, roll: 0, rollV: 0,
        hue: (rnd() * 2 - 1),
        speed: sp.cruise,
        geo: null
      };
      w.fish.push(f);
    }
  }

  /* пузырьки: два источника + рассеянные */
  for (var b = 0; b < 96; b++) {
    var emit = b % 3 !== 2;
    w.bubbles.push(makeBubble(rnd, emit ? (b % 3) : -1, true));
  }
  /* взвесь («морской снег») */
  for (var n = 0; n < 150; n++) {
    w.snow.push({
      x: (rnd() * 2 - 1) * TANK.hx, y: rnd() * TANK.y1, z: (rnd() * 2 - 1) * TANK.hz,
      r: 0.008 + rnd() * 0.022, ph: rnd() * TAU, sp: 0.02 + rnd() * 0.05
    });
  }

  /* камни */
  var rockSpots = [[-4.5, -2.6], [-3.1, -1.2], [4.6, -2.2], [3.3, 1.0], [0.4, -3.3], [-1.6, 2.5], [5.4, 0.4]];
  for (var ri = 0; ri < rockSpots.length; ri++) {
    var rx = rockSpots[ri][0], rz = rockSpots[ri][1];
    var rr = 0.42 + rnd() * 0.62;
    var jag = [];
    for (var j = 0; j < 14; j++) jag.push(0.72 + rnd() * 0.42);
    w.rocks.push({
      x: rx, y: floorY(rx, rz), z: rz,
      r: rr, hy: rr * (0.5 + rnd() * 0.35), jag: jag,
      tint: 0.72 + rnd() * 0.5
    });
  }

  /* водоросли: кусты по 4–7 лент */
  var bushes = [[-5.6, -3.2], [-4.0, 1.6], [-2.2, -3.6], [0.9, -3.9], [2.4, -1.9],
                [4.9, -3.4], [5.9, 1.2], [3.9, 2.6], [-5.9, 2.9], [-0.8, 2.9], [1.9, 3.4]];
  for (var bi = 0; bi < bushes.length; bi++) {
    var bx = bushes[bi][0], bz = bushes[bi][1];
    var nb = 4 + ((rnd() * 4) | 0);
    var hue = rnd();
    for (var q = 0; q < nb; q++) {
      var ang = rnd() * TAU, rad = rnd() * 0.55;
      var px = bx + Math.cos(ang) * rad, pz = bz + Math.sin(ang) * rad;
      var ax = rnd() * Math.PI;
      w.weeds.push({
        x: clamp(px, -TANK.hx + 0.2, TANK.hx - 0.2), z: clamp(pz, -TANK.hz + 0.2, TANK.hz - 0.2),
        y: floorY(px, pz),
        h: 1.1 + rnd() * 2.5, wid: 0.055 + rnd() * 0.085,
        ax: Math.cos(ax), az: Math.sin(ax),
        ph: rnd() * TAU, sw: 0.16 + rnd() * 0.26, freq: 0.42 + rnd() * 0.4,
        lean: (rnd() * 2 - 1) * 0.35,
        col: mix3([26, 78, 52], [92, 124, 46], hue * 0.75 + rnd() * 0.25),
        tip: 0.5 + rnd() * 0.5
      });
    }
  }

  /* песчинки: постоянные мировые точки фактуры дна (размер и плотность на
   * экране задаёт сама перспектива) */
  var GN = 78, GM = 46;
  var grain = { n: GN * GM, x: [], z: [], b: [], s: [] };
  for (var gj = 0; gj < GM; gj++) {
    for (var gi = 0; gi < GN; gi++) {
      var ux = (gi + 0.04 + rnd() * 0.92) / GN, uz = (gj + 0.04 + rnd() * 0.92) / GM;
      grain.x.push(-TANK.hx + 2 * TANK.hx * ux);
      grain.z.push(-TANK.hz + 2 * TANK.hz * uz);
      grain.b.push(rnd());
      grain.s.push(0.011 + rnd() * rnd() * 0.052);
    }
  }
  w.grain = grain;

  /* каустика на дне: волнистые пересекающиеся жилы (вдоль X и вдоль Z) */
  w.caust = [];
  var NC0 = 9, NC1 = 7;
  for (var cl = 0; cl < NC0 + NC1; cl++) {
    var cax = cl < NC0 ? 0 : 1;
    var ci = cax === 0 ? cl : cl - NC0, cn = cax === 0 ? NC0 : NC1;
    var cross = cax === 0 ? TANK.hz : TANK.hx;
    var base = -cross * 0.92 + 2 * cross * 0.92 * ((ci + 0.5) / cn) + (rnd() - 0.5) * 0.45;
    var room = clamp((cross - Math.abs(base)) / 1.5, 0.3, 1);
    w.caust.push({
      axis: cax, c: base,
      a1: (0.42 + rnd() * 0.55) * room, k1: 0.30 + rnd() * 0.26,
      s1: (rnd() < 0.5 ? -1 : 1) * (0.05 + rnd() * 0.11), p1: rnd() * TAU,
      a2: (0.13 + rnd() * 0.26) * room, k2: 0.70 + rnd() * 0.75,
      s2: (rnd() < 0.5 ? -1 : 1) * (0.09 + rnd() * 0.15), p2: rnd() * TAU,
      dr: (0.25 + rnd() * 0.45) * room, ds: 0.05 + rnd() * 0.09, dp: rnd() * TAU,
      wid: 0.075 + rnd() * 0.10, br: 0.55 + rnd() * 0.70,
      fk: 1.2 + rnd() * 2.4, fs: 0.20 + rnd() * 0.50, fp: rnd() * TAU
    });
  }

  /* объёмные лучи сверху */
  for (var s2 = 0; s2 < 7; s2++) {
    w.shafts.push({
      x: (rnd() * 2 - 1) * (TANK.hx - 0.6),
      z: (rnd() * 2 - 1) * (TANK.hz - 0.5),
      dx: (rnd() * 2 - 1) * 0.16, dz: (rnd() * 2 - 1) * 0.13,
      w0: 0.26 + rnd() * 0.34, w1: 1.0 + rnd() * 1.5,
      ph: rnd() * TAU, sp: 0.09 + rnd() * 0.14,
      pow: 0.55 + rnd() * 0.65
    });
  }
  return w;
}

function makeBubble(rnd, emitter, spread) {
  var e = emitter >= 0 ? BUBBLE_EMIT[emitter] : null;
  var b = {
    e: emitter,
    x: e ? e[0] + (rnd() - 0.5) * 0.30 : (rnd() * 2 - 1) * (TANK.hx - 0.4),
    z: e ? e[1] + (rnd() - 0.5) * 0.30 : (rnd() * 2 - 1) * (TANK.hz - 0.4),
    y: spread ? rnd() * TANK.y1 : (e ? e[2] : 0.3 + rnd() * 0.5),
    r: 0.018 + rnd() * (emitter >= 0 ? 0.055 : 0.075),
    v: 0, ph: rnd() * TAU, wob: 0.05 + rnd() * 0.13
  };
  b.v = 0.55 + b.r * 9 + rnd() * 0.35;
  return b;
}
var BUBBLE_EMIT = [[-3.35, -1.35, 0.35], [3.45, 0.85, 0.30]];

/* ══════════════════════════ симуляция ══════════════════════════ */

function stepWorld(w, dt) {
  w.t += dt;
  var t = w.t;
  var i, f, sp;

  /* центроиды стай */
  for (i = 0; i < w.schools.length; i++) {
    var sc = w.schools[i];
    sc.cx = 0; sc.cy = 0; sc.cz = 0; sc.vx = 0; sc.vy = 0; sc.vz = 0; sc.n = 0;
  }
  for (i = 0; i < w.fish.length; i++) {
    f = w.fish[i];
    var s0 = w.schools[f.school];
    s0.cx += f.x; s0.cy += f.y; s0.cz += f.z;
    s0.vx += f.vx; s0.vy += f.vy; s0.vz += f.vz; s0.n++;
  }
  for (i = 0; i < w.schools.length; i++) {
    var s1 = w.schools[i];
    if (s1.n) { s1.cx /= s1.n; s1.cy /= s1.n; s1.cz /= s1.n; s1.vx /= s1.n; s1.vy /= s1.n; s1.vz /= s1.n; }
    /* блуждающая цель стаи */
    var sd = s1.seed;
    s1.x = (fbm1(t * 0.055 + sd * 0.013, sd) * 2 - 1) * (TANK.hx - 1.5);
    s1.z = (fbm1(t * 0.048 + 31 + sd * 0.013, sd + 5) * 2 - 1) * (TANK.hz - 1.2);
    s1.y = clamp(SPECIES[i].prefY + (fbm1(t * 0.041 + 71 + sd * 0.013, sd + 9) * 2 - 1) * SPECIES[i].spreadY,
                 1.0, TANK.y1 - 1.0);
  }

  for (i = 0; i < w.fish.length; i++) {
    f = w.fish[i]; sp = f.sp;
    var sch = w.schools[f.school];

    var vx = f.vx, vy = f.vy, vz = f.vz;
    var sp0 = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1e-4;
    var dxu = vx / sp0, dyu = vy / sp0, dzu = vz / sp0;

    /* 1. блуждание — гладкий шум поверх текущего курса */
    var n1 = fbm1(t * 0.19 + f.seed * 0.017, f.seed) - 0.5;
    var n2 = fbm1(t * 0.15 + 37 + f.seed * 0.017, f.seed + 71) - 0.5;
    var n3 = fbm1(t * 0.13 + 83 + f.seed * 0.017, f.seed + 131) - 0.5;
    var ddx = dxu + n1 * 1.7, ddy = dyu * 0.6 + n2 * 0.55, ddz = dzu + n3 * 1.7;

    /* 2. стайность */
    if (sp.school > 0.2 && sch.n > 1) {
      var kco = sp.school * 0.55;
      ddx += (sch.x - f.x) * 0.06 * kco + (sch.cx - f.x) * 0.10 * kco;
      ddy += (sch.y - f.y) * 0.09 * kco + (sch.cy - f.y) * 0.12 * kco;
      ddz += (sch.z - f.z) * 0.06 * kco + (sch.cz - f.z) * 0.10 * kco;
      var al = sp.school * 0.5;
      ddx += sch.vx * al; ddy += sch.vy * al * 0.5; ddz += sch.vz * al;
    }

    /* 3. расталкивание соседей своего вида */
    var sepR = sp.sepR, sepR2 = sepR * sepR;
    for (var j = 0; j < w.fish.length; j++) {
      if (j === i) continue;
      var o = w.fish[j];
      if (o.school !== f.school && o.sp.len < 1.2) continue;
      var ox = f.x - o.x, oy = f.y - o.y, oz = f.z - o.z;
      var d2 = ox * ox + oy * oy + oz * oz;
      var rr = (o.sp.len > 1.2 && o.school !== f.school) ? 2.6 : sepR;
      if (d2 < rr * rr && d2 > 1e-5) {
        var inv = 1 / Math.sqrt(d2);
        var kk = (rr * inv - 1) * (o.school !== f.school ? 2.4 : 1.5);
        ddx += ox * inv * kk; ddy += oy * inv * kk * 0.7; ddz += oz * inv * kk;
      } else if (d2 <= 1e-5) { ddx += 0.3; }
      if (d2 > sepR2 * 36 && o.school === f.school) continue;
    }

    /* 4. развороты у стеклянных стенок */
    var M = 1.55;
    var pen;
    pen = (TANK.hx - M) - f.x; if (pen < 0) ddx -= (pen / M) * (pen / M) * 8 * Math.sign(1);
    pen = f.x + (TANK.hx - M);  if (pen < 0) ddx += (pen / M) * (pen / M) * 8;
    pen = (TANK.hz - M) - f.z; if (pen < 0) ddz -= (pen / M) * (pen / M) * 8;
    pen = f.z + (TANK.hz - M);  if (pen < 0) ddz += (pen / M) * (pen / M) * 8;
    var My = 1.15;
    pen = (TANK.y1 - My) - f.y; if (pen < 0) ddy -= (pen / My) * (pen / My) * 9;
    pen = f.y - (TANK.y0 + My + floorY(f.x, f.z)); if (pen < 0) ddy -= (pen / My) * (pen / My) * 9;

    /* 5. предпочитаемый горизонт */
    ddy += (sp.prefY - f.y) * 0.10;

    var dl = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) || 1;
    ddx /= dl; ddy /= dl; ddz /= dl;

    /* желаемая скорость: чуть быстрее при большом повороте не даём — наоборот, тормозим */
    var align = dxu * ddx + dyu * ddy + dzu * ddz;
    var want = sp.cruise * (0.62 + 0.48 * clamp(align, 0, 1)) *
               (0.85 + 0.3 * fbm1(t * 0.09 + f.seed * 0.031, f.seed + 3));

    var ax = (ddx * want - vx), ay = (ddy * want - vy), az = (ddz * want - vz);
    var al2 = Math.sqrt(ax * ax + ay * ay + az * az);
    var maxF = sp.force;
    if (al2 > maxF) { var kf = maxF / al2; ax *= kf; ay *= kf; az *= kf; }

    vx += ax * dt; vy += ay * dt; vz += az * dt;

    /* рыбы не «свечкой»: гасим вертикаль */
    var hs = Math.sqrt(vx * vx + vz * vz);
    if (Math.abs(vy) > hs * 0.62) vy = Math.sign(vy) * hs * 0.62;

    var v = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1e-4;
    var vmin = sp.cruise * 0.34, vmax = sp.cruise * 1.75;
    if (v < vmin) { var k1 = vmin / v; vx *= k1; vy *= k1; vz *= k1; v = vmin; }
    else if (v > vmax) { var k2 = vmax / v; vx *= k2; vy *= k2; vz *= k2; v = vmax; }

    /* крен в поворот: боковая составляющая ускорения */
    var rgx = vy * 0 - vz * 1, rgz = vx * 1;       /* cross(v, up) в плоскости XZ */
    var rgl = Math.sqrt(rgx * rgx + rgz * rgz) || 1;
    var latA = (ax * rgx + az * rgz) / rgl;
    var targetRoll = clamp(-latA * 0.16, -0.55, 0.55);
    f.rollV += (targetRoll - f.roll) * 9 * dt;
    f.rollV *= Math.pow(0.02, dt);
    f.roll += f.rollV * dt;

    f.vx = vx; f.vy = vy; f.vz = vz; f.speed = v;
    f.x += vx * dt; f.y += vy * dt; f.z += vz * dt;

    /* жёсткая страховка объёма */
    var lim = TANK.hx - 0.28;
    if (f.x > lim) { f.x = lim; if (f.vx > 0) f.vx = -f.vx * 0.35; }
    if (f.x < -lim) { f.x = -lim; if (f.vx < 0) f.vx = -f.vx * 0.35; }
    var limz = TANK.hz - 0.28;
    if (f.z > limz) { f.z = limz; if (f.vz > 0) f.vz = -f.vz * 0.35; }
    if (f.z < -limz) { f.z = -limz; if (f.vz < 0) f.vz = -f.vz * 0.35; }
    var fy = floorY(f.x, f.z) + 0.42;
    if (f.y < fy) { f.y = fy; if (f.vy < 0) f.vy = -f.vy * 0.4; }
    if (f.y > TANK.y1 - 0.42) { f.y = TANK.y1 - 0.42; if (f.vy > 0) f.vy = -f.vy * 0.4; }

    /* фазы анимации: частота хвоста растёт со скоростью */
    f.beatPh += dt * sp.beat * (0.45 + 0.75 * (v / sp.cruise));
    f.flapPh += dt * sp.pect.flap * (0.6 + 0.5 * (v / sp.cruise));
    if (f.beatPh > 1e6) f.beatPh -= 1e6;
    if (f.flapPh > 1e6) f.flapPh -= 1e6;
  }

  /* пузырьки */
  for (i = 0; i < w.bubbles.length; i++) {
    var bb = w.bubbles[i];
    bb.y += bb.v * dt;
    bb.ph += dt * (1.6 + bb.r * 12);
    if (bb.y > TANK.y1 - 0.05) {
      var nb2 = makeBubble(w.rnd, bb.e, false);
      bb.x = nb2.x; bb.y = nb2.y; bb.z = nb2.z; bb.r = nb2.r; bb.v = nb2.v; bb.ph = nb2.ph; bb.wob = nb2.wob;
    }
  }
  /* взвесь */
  for (i = 0; i < w.snow.length; i++) {
    var sn = w.snow[i];
    sn.y -= sn.sp * dt * 0.35;
    sn.ph += dt * 0.5;
    if (sn.y < 0.05) sn.y = TANK.y1 - 0.05;
  }
}

/* ══════════════════════════ построение кадра ══════════════════════════ */

function pushItem(w, kind, z, geo) {
  var it;
  if (w._np < w._pool.length) { it = w._pool[w._np]; }
  else { it = { kind: '', z: 0, geo: null }; w._pool.push(it); }
  w._np++;
  it.kind = kind; it.z = z; it.geo = geo;
  w._items.push(it);
  return it;
}

var _p = newP(), _p2 = newP(), _p3 = newP();

/* --- геометрия рыбы: кольца сечений → экранный силуэт --- */
function buildFishGeo(f, cam, env) {
  var sp = f.sp, L = f.len;

  project(cam, f.x, f.y, f.z, _p);
  if (!_p.ok || _p.z > 60) return null;
  var scr = L * _p.s;                                   /* примерный размер в px */
  if (_p.x < -scr * 2.2 || _p.x > cam.w + scr * 2.2 ||
      _p.y < -scr * 2.4 || _p.y > cam.h + scr * 2.4) return null;

  var lod = scr < 24 ? 0 : (scr < 78 ? 1 : 2);
  var RN = lod === 0 ? 7 : (lod === 1 ? 11 : 17);
  /* MS кратно 4: по двум точкам кольца (a=0 и a=π/2) восстанавливаем
   * проекцию сечения аналитически, см. ниже */
  var MS = lod === 0 ? 8 : (lod === 1 ? 8 : 12);

  var g = f.geo;
  if (!g) {
    g = f.geo = {
      f: f, lod: 0, RN: 0, MS: 0,
      topX: [], topY: [], botX: [], botY: [],
      spX: [], spY: [], ringX: [], ringY: [],
      hhs: [], fins: [], eye: null,
      z: 0, fog: 0, cx: 0, cy: 0, s: 0, cull: false,
      lit: 1, caus: 0, upx: 0, upy: 0, dnx: 0, dny: 0, axisLen: 0
    };
  }
  g.lod = lod; g.RN = RN; g.MS = MS;
  g.z = _p.z; g.cx = _p.x; g.cy = _p.y; g.s = _p.s;
  g.scr = scr;
  g.marks = scr >= 14;        /* рисунок на теле держим и в дальнем плане */

  /* локальный базис рыбы */
  var vx = f.vx, vy = f.vy, vz = f.vz;
  var vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
  var Fx = vx / vl, Fy = vy / vl, Fz = vz / vl;
  var Rx = Fy * 0 - Fz * 1, Ry = Fz * 0 - Fx * 0, Rz = Fx * 1 - Fy * 0;
  var rl = Math.sqrt(Rx * Rx + Ry * Ry + Rz * Rz);
  if (rl < 1e-5) { Rx = 1; Ry = 0; Rz = 0; rl = 1; }
  Rx /= rl; Ry /= rl; Rz /= rl;
  var Ux = Ry * Fz - Rz * Fy, Uy = Rz * Fx - Rx * Fz, Uz = Rx * Fy - Ry * Fx;
  var cr = Math.cos(f.roll), sr = Math.sin(f.roll);
  var nRx = Rx * cr + Ux * sr, nRy = Ry * cr + Uy * sr, nRz = Rz * cr + Uz * sr;
  Ux = Ux * cr - Rx * sr; Uy = Uy * cr - Ry * sr; Uz = Uz * cr - Rz * sr;
  Rx = nRx; Ry = nRy; Rz = nRz;
  g.Fx = Fx; g.Fy = Fy; g.Fz = Fz; g.Rx = Rx; g.Ry = Ry; g.Rz = Rz; g.Ux = Ux; g.Uy = Uy; g.Uz = Uz;

  var amp = sp.waveAmp * L * (0.6 + 0.55 * (f.speed / sp.cruise));
  var ph = f.beatPh;
  var wk = sp.waveK;

  function waveAt(s) {
    return amp * (0.04 + 0.96 * s * s * (1.2 - 0.2 * s)) * Math.sin(TAU * wk * s - ph);
  }

  var topX = g.topX, topY = g.topY, botX = g.botX, botY = g.botY;
  var spX = g.spX, spY = g.spY, ringX = g.ringX, ringY = g.ringY, hhs = g.hhs;
  topX.length = RN; topY.length = RN; botX.length = RN; botY.length = RN;
  spX.length = RN; spY.length = RN; hhs.length = RN;
  ringX.length = RN * MS; ringY.length = RN * MS;

  var i, jj;
  var hMax = 0;
  /* мировые позиции осевых точек и колец */
  for (i = 0; i < RN; i++) {
    var s = i / (RN - 1);
    var lx = (0.5 - s) * L;
    var lz = waveAt(s);
    /* наклон сечения по касательной к изогнутой оси */
    var ds = 0.02;
    var s2 = clamp(s + ds, 0, 1), s1 = clamp(s - ds, 0, 1);
    var dlz = waveAt(s2) - waveAt(s1);
    var dlx = (s1 - s2) * L;
    var tl = Math.sqrt(dlx * dlx + dlz * dlz) || 1;
    var tX = dlx / tl, tZ = dlz / tl;            /* касательная (к хвосту) */
    var latX = -tZ, latZ = tX;                   /* поперечная ось сечения */

    var hh = halfH(sp, s) * L, ww = halfW(sp, s) * L;
    hhs[i] = hh;
    if (hh > hMax) hMax = hh;

    var wx = f.x + lx * Fx + lz * Rx;
    var wy = f.y + lx * Fy + lz * Ry;
    var wz = f.z + lx * Fz + lz * Rz;
    project(cam, wx, wy, wz, _p2);
    spX[i] = _p2.x; spY[i] = _p2.y;

    for (jj = 0; jj < MS; jj++) {
      var a = jj / MS * TAU;
      var ca = Math.cos(a), sa = Math.sin(a);
      var ox = lx + ww * ca * latX, oz = lz + ww * ca * latZ, oy = hh * sa;
      var px = f.x + ox * Fx + oy * Ux + oz * Rx;
      var py = f.y + ox * Fy + oy * Uy + oz * Ry;
      var pz = f.z + ox * Fz + oy * Uz + oz * Rz;
      project(cam, px, py, pz, _p3);
      ringX[i * MS + jj] = _p3.x; ringY[i * MS + jj] = _p3.y;
    }
  }
  g.hMax = hMax;

  /* экранная ось тела */
  var axdx = spX[RN - 1] - spX[0], axdy = spY[RN - 1] - spY[0];
  var axl = Math.sqrt(axdx * axdx + axdy * axdy);
  g.axisLen = axl;
  var gnx, gny;
  if (axl > 1e-3) { gnx = -axdy / axl; gny = axdx / axl; } else { gnx = 0; gny = 1; }

  /* Кромки силуэта: проекция кольца — эллипс c + cos(a)·P + sin(a)·Q, значит
   * смещение поперёк оси d(a) = A·cos a + B·sin a — чистая синусоида. Крайняя
   * точка берётся аналитически (a = atan2(B, A)), а не как ближайшая вершина
   * многоугольника: кромка выходит гладкой и не «дёргается» по вершинам. */
  var qOff = MS >> 2;
  for (i = 0; i < RN; i++) {
    var ia = i > 0 ? i - 1 : 0, ib = i < RN - 1 ? i + 1 : RN - 1;
    var ddx = spX[ib] - spX[ia], ddy = spY[ib] - spY[ia];
    var dl2 = Math.sqrt(ddx * ddx + ddy * ddy);
    var nx, ny;
    if (dl2 > 0.6) { nx = -ddy / dl2; ny = ddx / dl2; } else { nx = gnx; ny = gny; }
    /* нормаль держим по одну сторону от общей оси: иначе на сильно
     * укороченных ракурсах кромки «спина/брюхо» меняются местами и контур
     * ломается зигзагом */
    if (nx * gnx + ny * gny < 0) { nx = -nx; ny = -ny; }
    var bi = i * MS;
    var Px = ringX[bi] - spX[i], Py = ringY[bi] - spY[i];
    var Qx = ringX[bi + qOff] - spX[i], Qy = ringY[bi + qOff] - spY[i];
    var A = Px * nx + Py * ny, B = Qx * nx + Qy * ny;
    var R = Math.sqrt(A * A + B * B);
    var ca, sa;
    if (R < 1e-9) { ca = 0; sa = 1; } else { ca = A / R; sa = B / R; }
    var ex = ca * Px + sa * Qx, ey = ca * Py + sa * Qy;
    topX[i] = spX[i] + ex; topY[i] = spY[i] + ey;
    botX[i] = spX[i] - ex; botY[i] = spY[i] - ey;
  }

  /* освещение: сверху + мерцание каустики, глубинный туман */
  var cau = env.caustics ? causticField(f.x, f.z + f.y * 0.55, env.ct) : 0;
  var depthK = Math.exp(-(TANK.y1 - f.y) * 0.16);
  g.caus = cau * depthK * env.light;
  g.lit = (0.42 + 0.58 * clamp(Uy * 0.5 + 0.5, 0, 1)) * (0.72 + 0.5 * (f.y / TANK.y1)) * env.light;
  g.fog = fogAt(_p.z, env);
  g.fogCol = waterAt(f.y);

  /* экранные направления «спина / брюхо» — для градиента */
  project(cam, f.x + Ux * hMax, f.y + Uy * hMax, f.z + Uz * hMax, _p2);
  g.upx = _p2.x; g.upy = _p2.y;
  project(cam, f.x - Ux * hMax, f.y - Uy * hMax, f.z - Uz * hMax, _p3);
  g.dnx = _p3.x; g.dny = _p3.y;

  /* плавники */
  g.fins.length = 0;
  buildFins(g, f, sp, cam, L, amp, ph, wk, waveAt);

  /* глаз со стороны камеры */
  var es = sp.eye.s;
  var elx = (0.5 - es) * L, elz = waveAt(es);
  var ehh = halfH(sp, es) * L, eww = halfW(sp, es) * L;
  var side = ((f.x - cam.px) * Rx + (f.y - cam.py) * Ry + (f.z - cam.pz) * Rz) < 0 ? 1 : -1;
  var ex = elx, ey = ehh * sp.eye.up / Math.max(sp.depth, 0.02) * sp.depth * 1.6, ez = elz + side * eww * 0.72;
  ey = ehh * 0.42;
  var wx2 = f.x + ex * Fx + ey * Ux + ez * Rx;
  var wy2 = f.y + ex * Fy + ey * Uy + ez * Ry;
  var wz2 = f.z + ex * Fz + ey * Uz + ez * Rz;
  project(cam, wx2, wy2, wz2, _p2);
  if (!g.eye) g.eye = { x: 0, y: 0, r: 0, ok: false };
  g.eye.x = _p2.x; g.eye.y = _p2.y;
  /* глаз мелкий: 0.72 от прежнего радиуса — без «мультяшной» пуговицы */
  g.eye.r = Math.max(0.55, sp.eye.r * L * _p2.s * 0.72);
  g.eye.ok = _p2.ok;
  g.eyeIris = sp.eye.iris;

  return g;
}

/* Плавники — плоские 3D-полигоны в системе рыбы (честно укорачиваются). */
function buildFins(g, f, sp, cam, L, amp, ph, wk, waveAt) {
  var Fx = g.Fx, Fy = g.Fy, Fz = g.Fz, Rx = g.Rx, Ry = g.Ry, Rz = g.Rz, Ux = g.Ux, Uy = g.Uy, Uz = g.Uz;
  var lod = g.lod;

  function emit(pts3, kind, alpha, col, tipFade) {
    var n = pts3.length / 3;
    var xs = new Array(n), ys = new Array(n);
    var zsum = 0, ok = 0;
    for (var i = 0; i < n; i++) {
      var lx = pts3[i * 3], ly = pts3[i * 3 + 1], lz = pts3[i * 3 + 2];
      var wx = f.x + lx * Fx + ly * Ux + lz * Rx;
      var wy = f.y + lx * Fy + ly * Uy + lz * Ry;
      var wz = f.z + lx * Fz + ly * Uz + lz * Rz;
      project(cam, wx, wy, wz, _p3);
      xs[i] = _p3.x; ys[i] = _p3.y; zsum += _p3.z; if (_p3.ok) ok++;
    }
    if (!ok) return;
    g.fins.push({ xs: xs, ys: ys, z: zsum / n, kind: kind, alpha: alpha, col: col, fade: tipFade });
  }

  /* — хвост — */
  var tl = sp.tail, s1 = 1;
  var baseX = (0.5 - s1) * L, baseZ = waveAt(1);
  var d1 = waveAt(1) - waveAt(0.96), d0 = -0.04 * L;
  var tlen = Math.sqrt(d0 * d0 + d1 * d1) || 1;
  var bX = d0 / tlen, bZ = d1 / tlen;         /* «назад» вдоль оси */
  var lX = -bZ, lZ = bX;                       /* поперечная */
  var TL = tl.len * L, SPN = tl.span * L;
  var swp = 0.55 * amp * 3.2;

  function tp(u, v) {                          /* u — вдоль, v — по вертикали */
    var sw = swp * Math.sin(ph - u * wk * 2.4 + 0.9) * (u * u);
    return [baseX + bX * (u * TL) + lX * sw, v * SPN, baseZ + bZ * (u * TL) + lZ * sw];
  }
  function tailPoly(list) {
    var out = [];
    for (var i = 0; i < list.length; i += 2) {
      var q = tp(list[i], list[i + 1]);
      out.push(q[0], q[1], q[2]);
    }
    return out;
  }
  var shape;
  if (tl.type === 'fork') {
    shape = [0, 0.14, 0.55, 0.72, 1.0, 1.0, 0.52, 0.14, 1.0, -1.0, 0.55, -0.72, 0, -0.14];
  } else if (tl.type === 'fan') {
    shape = [0, 0.16, 0.55, 0.78, 0.92, 0.66, 1.05, 0.0, 0.92, -0.66, 0.55, -0.78, 0, -0.16];
  } else if (tl.type === 'lyre') {
    shape = [0, 0.15, 0.62, 0.85, 1.12, 1.05, 0.60, 0.22, 1.12, -1.05, 0.62, -0.85, 0, -0.15];
  } else { /* veil */
    shape = [0, 0.18, 0.42, 0.72, 0.95, 1.30, 1.35, 1.05, 0.74, 0.22, 1.35, -1.05, 0.95, -1.30, 0.42, -0.72, 0, -0.18];
  }
  emit(tailPoly(shape), 'tail', sp.finA, sp.fin, 1);

  /* — спинной и анальный — */
  function ridge(cfg, sign) {
    if (!cfg) return;
    var N = lod === 0 ? 4 : 7;
    var up = [], dn = [];
    for (var i = 0; i <= N; i++) {
      var q = i / N;
      var s = lerp(cfg.s0, cfg.s1, q);
      var lx = (0.5 - s) * L, lz = waveAt(s);
      var hh = halfH(sp, s) * L * sign;
      var prof = Math.sin(Math.PI * Math.pow(q, cfg.filament ? 0.62 : 0.85));
      if (cfg.filament) prof = Math.max(prof, 0) * (1 + 1.5 * Math.pow(q, 3));
      var hgt = cfg.h * L * sp.depth * prof * sign;
      var sway = amp * 1.1 * Math.sin(ph - s * wk * TAU * 0.5) * s * s;
      up.push(lx - 0.06 * L * q, hh + hgt, lz + sway * 0.6);
      dn.push(lx, hh * 0.92, lz);
    }
    var poly = up.slice();
    for (var k = dn.length - 3; k >= 0; k -= 3) poly.push(dn[k], dn[k + 1], dn[k + 2]);
    emit(poly, 'ridge', sp.finA * 0.85, sp.fin, 1);
  }
  ridge(sp.dorsal, 1);
  ridge(sp.anal, -1);

  /* — грудные (парные, машут) — */
  if (lod > 0) {
    var ps = sp.pect.s;
    var plx = (0.5 - ps) * L, plz = waveAt(ps);
    var phh = halfH(sp, ps) * L, pww = halfW(sp, ps) * L;
    for (var sgn = -1; sgn <= 1; sgn += 2) {
      var flap = Math.sin(f.flapPh + (sgn > 0 ? 0 : Math.PI * 0.85)) * 0.55;
      var FL = sp.pect.len * L;
      var pts = [];
      var N2 = 5;
      for (var i2 = 0; i2 <= N2; i2++) {
        var q2 = i2 / N2;
        var a2 = lerp(-0.25, 1.15, q2);
        var rr = FL * (0.55 + 0.45 * Math.sin(Math.PI * q2));
        var outw = Math.cos(a2) * rr, back = -Math.sin(a2) * rr;
        pts.push(plx + back * 0.9,
                 -phh * 0.18 + outw * Math.sin(flap) * -0.85,
                 plz + sgn * (pww * 0.8 + outw * Math.cos(flap) * 0.9));
      }
      pts.push(plx, -phh * 0.12, plz + sgn * pww * 0.7);
      emit(pts, 'pect', sp.finA * 0.8, sp.fin, 1);
    }
  }

  /* — брюшные нити (скалярия) — */
  if (sp.pelvic && lod > 0) {
    var vs = sp.pelvic.s;
    var vlx = (0.5 - vs) * L, vlz = waveAt(vs);
    var vhh = halfH(sp, vs) * L;
    for (var sg2 = -1; sg2 <= 1; sg2 += 2) {
      var pts2 = [];
      var LEN = sp.pelvic.len * L;
      for (var i3 = 0; i3 <= 5; i3++) {
        var q3 = i3 / 5;
        var bend = Math.sin(f.flapPh * 0.35 + q3 * 2.2 + sg2) * 0.12 * LEN;
        pts2.push(vlx - q3 * 0.16 * L + bend * 0.3,
                  -vhh - q3 * LEN,
                  vlz + sg2 * (0.05 * L * (1 - q3)) + bend * 0.5);
      }
      for (var i4 = 5; i4 >= 0; i4--) {
        var q4 = i4 / 5;
        var bend2 = Math.sin(f.flapPh * 0.35 + q4 * 2.2 + sg2) * 0.12 * LEN;
        var wdt = 0.055 * L * (1 - q4 * 0.85);
        pts2.push(vlx - q4 * 0.16 * L + bend2 * 0.3 + wdt,
                  -vhh - q4 * LEN,
                  vlz + sg2 * (0.05 * L * (1 - q4)) + bend2 * 0.5);
      }
      emit(pts2, 'ridge', sp.finA * 0.7, sp.fin, 1);
    }
  }
}

function fogAt(z, env) {
  var d = z - 3.2;
  if (d < 0) d = 0;
  return 1 - Math.exp(-d * 0.088 * env.fog);
}

/* --- сборка и сортировка всего кадра --- */
function buildFrame(w, cam) {
  var env = w.env;
  env.ct = w.t;
  var items = w._items;
  items.length = 0; w._np = 0;

  var i, g;
  for (i = 0; i < w.fish.length; i++) {
    g = buildFishGeo(w.fish[i], cam, env);
    if (g) pushItem(w, 'fish', g.z, g);
  }

  /* водоросли */
  for (i = 0; i < w.weeds.length; i++) {
    g = buildWeedGeo(w.weeds[i], cam, w.t, env);
    if (g) pushItem(w, 'weed', g.z, g);
  }
  /* камни */
  for (i = 0; i < w.rocks.length; i++) {
    var rk = w.rocks[i];
    project(cam, rk.x, rk.y + rk.hy * 0.4, rk.z, _p);
    if (!_p.ok) continue;
    rk._x = _p.x; rk._y = _p.y; rk._s = _p.s; rk._z = _p.z; rk._fog = fogAt(_p.z, env);
    pushItem(w, 'rock', _p.z + 0.35, rk);
  }
  /* пузырьки */
  for (i = 0; i < w.bubbles.length; i++) {
    var b = w.bubbles[i];
    var bx = b.x + Math.sin(b.ph) * b.wob, bz = b.z + Math.cos(b.ph * 0.83) * b.wob;
    project(cam, bx, b.y, bz, _p);
    if (!_p.ok) continue;
    var br = b.r * _p.s;
    if (_p.x < -br - 4 || _p.x > cam.w + br + 4 || _p.y < -br - 4 || _p.y > cam.h + br + 4) continue;
    b._x = _p.x; b._y = _p.y; b._r = br; b._fog = fogAt(_p.z, env); b._y3 = b.y;
    pushItem(w, 'bubble', _p.z, b);
  }
  /* взвесь */
  for (i = 0; i < w.snow.length; i++) {
    var sn = w.snow[i];
    project(cam, sn.x + Math.sin(sn.ph) * 0.12, sn.y, sn.z + Math.cos(sn.ph * 0.7) * 0.12, _p);
    if (!_p.ok) continue;
    if (_p.x < 0 || _p.x > cam.w || _p.y < 0 || _p.y > cam.h) continue;
    sn._x = _p.x; sn._y = _p.y; sn._r = Math.max(0.35, sn.r * _p.s); sn._fog = fogAt(_p.z, env);
    pushItem(w, 'snow', _p.z, sn);
  }
  /* лучи */
  if (env.rays) {
    for (i = 0; i < w.shafts.length; i++) {
      g = buildShaftGeo(w.shafts[i], cam, w.t, env);
      if (g) pushItem(w, 'shaft', g.z, g);
    }
  }

  items.sort(byDepth);
  return items;
}
function byDepth(a, b) { return b.z - a.z; }

function buildWeedGeo(wd, cam, t, env) {
  var N = 9;
  var g = wd._g || (wd._g = { lx: [], ly: [], rx: [], ry: [], z: 0, fog: 0, col: null, top: 0 });
  var lx = g.lx, ly = g.ly, rx = g.rx, ry = g.ry;
  lx.length = N + 1; ly.length = N + 1; rx.length = N + 1; ry.length = N + 1;
  var zsum = 0, any = false;
  for (var i = 0; i <= N; i++) {
    var q = i / N;
    var sway = wd.sw * q * q * (Math.sin(t * wd.freq + wd.ph + q * 1.6) * 0.75 +
                                Math.sin(t * wd.freq * 1.7 + wd.ph * 1.3 + q * 2.9) * 0.25);
    var lean = wd.lean * q * q;
    var px = wd.x + (sway + lean) * wd.az;
    var pz = wd.z - (sway + lean) * wd.ax;
    var py = wd.y + q * wd.h;
    var hw = wd.wid * (1 - q * 0.72) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, q * 1.35 + 0.12)));
    project(cam, px + wd.ax * hw, py, pz + wd.az * hw, _p);
    lx[i] = _p.x; ly[i] = _p.y; if (_p.ok) any = true;
    project(cam, px - wd.ax * hw, py, pz - wd.az * hw, _p2);
    rx[i] = _p2.x; ry[i] = _p2.y;
    zsum += _p.z;
    if (i === N) { g.top = _p.z; }
  }
  if (!any) return null;
  project(cam, wd.x, wd.y + wd.h * 0.45, wd.z, _p);
  if (!_p.ok) return null;
  g.z = _p.z;
  g.fog = fogAt(_p.z, env);
  var cau = env.caustics ? causticField(wd.x, wd.z + (wd.y + wd.h * 0.5) * 0.55, t) : 0;
  g.lit = (0.5 + 0.5 * clamp((wd.y + wd.h * 0.5) / TANK.y1, 0, 1)) * env.light;
  g.caus = cau * env.light;
  g.wd = wd;
  return g;
}

function buildShaftGeo(sh, cam, t, env) {
  var drift = Math.sin(t * sh.sp + sh.ph) * 0.55;
  var x0 = sh.x + drift, z0 = sh.z + Math.cos(t * sh.sp * 0.8 + sh.ph) * 0.4;
  var top = TANK.y1 + 0.15;
  var len = TANK.y1 + 0.2;
  var bx = x0 + sh.dx * len, bz = z0 + sh.dz * len;
  /* биллборд вокруг вертикали: горизонтальная ось, перпендикулярная взгляду */
  var ax = -cam.fz, az = cam.fx;
  var al = Math.sqrt(ax * ax + az * az) || 1;
  ax /= al; az /= al;

  project(cam, x0, top, z0, _p);
  if (!_p.ok) return null;
  project(cam, bx, -0.2, bz, _p2);

  var g = sh._g || (sh._g = { q: [], z: 0 });
  g.tx = _p.x; g.ty = _p.y; g.bx = _p2.x; g.by = _p2.y;
  g.z = _p.z * 0.5 + _p2.z * 0.5;
  var q = g.q; q.length = 0;
  for (var layer = 0; layer < 3; layer++) {
    var k = [1, 0.55, 0.24][layer];
    var w0 = sh.w0 * k, w1 = sh.w1 * k;
    project(cam, x0 - ax * w0, top, z0 - az * w0, _p);
    var a1x = _p.x, a1y = _p.y;
    project(cam, x0 + ax * w0, top, z0 + az * w0, _p);
    var a2x = _p.x, a2y = _p.y;
    project(cam, bx + ax * w1, -0.2, bz + az * w1, _p);
    var b2x = _p.x, b2y = _p.y;
    project(cam, bx - ax * w1, -0.2, bz - az * w1, _p);
    var b1x = _p.x, b1y = _p.y;
    q.push(a1x, a1y, a2x, a2y, b2x, b2y, b1x, b1y);
  }
  var flick = 0.72 + 0.28 * Math.sin(t * 0.7 + sh.ph * 1.7) * Math.sin(t * 0.31 + sh.ph);
  g.alpha = sh.pow * flick * env.light * (env.rays ? 1 : 0);
  g.fogK = 1 - fogAt(g.z, env) * 0.35;
  return g;
}

/* ══════════════════════════ гладкие контуры ══════════════════════════ */

/* Catmull-Rom → кубическая Безье. Длина касательной подрезается по длине
 * сегмента: на неравномерных точках (нос, основание хвоста) нет петель. */
function crSeg(ctx, x0, y0, x1, y1, x2, y2, x3, y3) {
  var t1x = (x2 - x0) / 6, t1y = (y2 - y0) / 6;
  var t2x = (x3 - x1) / 6, t2y = (y3 - y1) / 6;
  var sx = x2 - x1, sy = y2 - y1;
  var lim = Math.sqrt(sx * sx + sy * sy) * 0.42;
  var l1 = Math.sqrt(t1x * t1x + t1y * t1y);
  if (l1 > lim) { var k1 = l1 > 1e-9 ? lim / l1 : 0; t1x *= k1; t1y *= k1; }
  var l2 = Math.sqrt(t2x * t2x + t2y * t2y);
  if (l2 > lim) { var k2 = l2 > 1e-9 ? lim / l2 : 0; t2x *= k2; t2y *= k2; }
  ctx.bezierCurveTo(x1 + t1x, y1 + t1y, x2 - t2x, y2 - t2y, x2, y2);
}

/* замкнутый гладкий контур по точкам; smooth=false — ломаная (мелкий LOD,
 * где кривые уже неразличимы, а путь дешевле) */
function crPathLoop(ctx, xs, ys, n, smooth) {
  if (n < 3 || smooth === false) {
    if (n < 2) return;
    ctx.moveTo(xs[0], ys[0]);
    for (var k = 1; k < n; k++) ctx.lineTo(xs[k], ys[k]);
    return;
  }
  ctx.moveTo(xs[0], ys[0]);
  for (var i = 0; i < n; i++) {
    var i0 = i === 0 ? n - 1 : i - 1;
    var i2 = i + 1 === n ? 0 : i + 1;
    var i3 = i2 + 1 === n ? 0 : i2 + 1;
    crSeg(ctx, xs[i0], ys[i0], xs[i], ys[i], xs[i2], ys[i2], xs[i3], ys[i3]);
  }
}

/* незамкнутая гладкая кривая по точкам */
function crPathOpen(ctx, xs, ys, n, smooth) {
  if (n < 2) return;
  ctx.moveTo(xs[0], ys[0]);
  if (n === 2 || smooth === false) {
    for (var k = 1; k < n; k++) ctx.lineTo(xs[k], ys[k]);
    return;
  }
  for (var i = 0; i < n - 1; i++) {
    var i0 = i > 0 ? i - 1 : 0;
    var i3 = i + 2 < n ? i + 2 : n - 1;
    crSeg(ctx, xs[i0], ys[i0], xs[i], ys[i], xs[i + 1], ys[i + 1], xs[i3], ys[i3]);
  }
}

function pushPt(xs, ys, n, x, y) {
  if (n > 0) {
    var dx = x - xs[n - 1], dy = y - ys[n - 1];
    if (dx * dx + dy * dy < 0.09) return n;
  }
  xs[n] = x; ys[n] = y;
  return n + 1;
}

var _bx = [], _by = [], _sx = [], _sy = [], _ept = { x: 0, y: 0 };

/* контур тела как замкнутый список точек (спина вперёд, брюхо назад) */
function bodyLoop(g) {
  var RN = g.RN, n = 0, i;
  for (i = 0; i < RN; i++) n = pushPt(_bx, _by, n, g.topX[i], g.topY[i]);
  for (i = RN - 1; i >= 0; i--) n = pushPt(_bx, _by, n, g.botX[i], g.botY[i]);
  return n;
}

/* точка на силуэте: s — доля длины (0 — нос), a — поперёк (0 — спина, 1 — брюхо) */
function edgeAt(g, s, a, o) {
  var RN = g.RN;
  var fi = clamp(s, 0, 1) * (RN - 1);
  var i0 = Math.floor(fi);
  if (i0 > RN - 2) i0 = RN - 2;
  if (i0 < 0) i0 = 0;
  var k = fi - i0;
  var tx = g.topX[i0] + (g.topX[i0 + 1] - g.topX[i0]) * k;
  var ty = g.topY[i0] + (g.topY[i0 + 1] - g.topY[i0]) * k;
  var bx = g.botX[i0] + (g.botX[i0 + 1] - g.botX[i0]) * k;
  var by = g.botY[i0] + (g.botY[i0 + 1] - g.botY[i0]) * k;
  o.x = tx + (bx - tx) * a;
  o.y = ty + (by - ty) * a;
  return o;
}

/* ══════════════════════════ отрисовка ══════════════════════════ */

var DRAW = {};

DRAW.fish = function (ctx, g, env) {
  var f = g.f, sp = f.sp, RN = g.RN, MS = g.MS;
  var fog = g.fog, fc = g.fogCol;
  /* Помутнение по глубине ограничено снизу: даже самая дальняя рыба сохраняет
   * свой цвет и читаемый силуэт, а не выцветает в серый призрак. */
  var fogB = fog > 0.44 ? 0.44 : fog;
  var fogS = fog > 0.50 ? 0.50 : fog;
  var lit = g.lit + g.caus * 0.5;

  var back = mix3(lift(sp.back, 0.55 + 0.75 * lit), fc, fogB);
  var mid = mix3(lift(sp.mid, 0.55 + 0.8 * lit), fc, fogB);
  var belly = mix3(lift(sp.belly, 0.6 + 0.75 * lit), fc, fogB);

  /* дальние плавники (за телом) */
  var fi;
  for (fi = 0; fi < g.fins.length; fi++) if (g.fins[fi].z > g.z) drawFin(ctx, g, g.fins[fi], fogB, fc, lit);

  /* тело: гладкий контур (Catmull-Rom по кромкам) + кольца сечений
   * (объединение даёт верный силуэт в любом ракурсе) */
  var nb = bodyLoop(g);
  var sm = g.lod > 0;                 /* мельче 24 px кривые уже неразличимы */
  var i;
  ctx.beginPath();
  crPathLoop(ctx, _bx, _by, nb, sm);
  ctx.closePath();
  var step = g.lod === 2 ? 1 : (g.lod === 1 ? 2 : 3);
  for (i = 0; i < RN; i += step) addRing(ctx, g, i, MS);
  if ((RN - 1) % step !== 0) addRing(ctx, g, RN - 1, MS);

  var gx0 = g.upx, gy0 = g.upy, gx1 = g.dnx, gy1 = g.dny;
  var gl = Math.sqrt((gx1 - gx0) * (gx1 - gx0) + (gy1 - gy0) * (gy1 - gy0));
  var grd;
  if (gl > 1.5) {
    grd = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    grd.addColorStop(0, css(mul3(back, 0.86)));
    grd.addColorStop(0.34, css(back));
    grd.addColorStop(0.62, css(mid));
    grd.addColorStop(1, css(belly));
  } else {
    var rr = Math.max(2, g.hMax * g.s);
    grd = ctx.createRadialGradient(g.cx - rr * 0.25, g.cy - rr * 0.3, rr * 0.1, g.cx, g.cy, rr * 1.15);
    grd.addColorStop(0, css(mix3(mid, belly, 0.5)));
    grd.addColorStop(1, css(back));
  }
  ctx.fillStyle = grd;
  ctx.fill();

  if (g.marks) {
    /* Полосы и пятна — гладкие замкнутые кривые, построенные в системе
     * силуэта (s вдоль тела, a поперёк), поэтому они идут по форме тела и
     * изгибаются вместе с волной, а не штрихуют его прямыми. */
    var pt = _ept;
    for (var st = 0; st < sp.stripes.length; st++) {
      var s = sp.stripes[st];
      var col = mix3(lift(s.col, 0.5 + 0.8 * lit), fc, fogS * 0.9);
      var n2 = 0, K, qi, aq, sq;
      if (s.kind === 'lat') {
        K = g.lod === 2 ? 12 : 8;
        for (qi = 0; qi <= K; qi++) {
          sq = lerp(s.s0, s.s1, qi / K);
          aq = Math.sin(Math.PI * Math.pow(qi / K, 0.72));
          edgeAt(g, sq, lerp(0.5, s.a0, aq), pt);
          n2 = pushPt(_sx, _sy, n2, pt.x, pt.y);
        }
        for (qi = K; qi >= 0; qi--) {
          sq = lerp(s.s0, s.s1, qi / K);
          aq = Math.sin(Math.PI * Math.pow(qi / K, 0.72));
          edgeAt(g, sq, lerp(0.5, s.a1, aq), pt);
          n2 = pushPt(_sx, _sy, n2, pt.x, pt.y);
        }
      } else {
        /* перевязь: середина идёт по s, полоса наклонена и мягко расширяется */
        K = g.lod === 2 ? 9 : 6;
        var halfS = (s.s1 - s.s0) * 0.5, midS = (s.s0 + s.s1) * 0.5;
        for (qi = 0; qi <= K; qi++) {
          aq = 0.014 + 0.972 * (qi / K);
          sq = midS + halfS * 0.62 * Math.cos(Math.PI * aq) -
               halfS * (1 + 0.22 * Math.sin(Math.PI * aq));
          edgeAt(g, sq, aq, pt);
          n2 = pushPt(_sx, _sy, n2, pt.x, pt.y);
        }
        for (qi = K; qi >= 0; qi--) {
          aq = 0.014 + 0.972 * (qi / K);
          sq = midS + halfS * 0.62 * Math.cos(Math.PI * aq) +
               halfS * (1 + 0.22 * Math.sin(Math.PI * aq));
          edgeAt(g, sq, aq, pt);
          n2 = pushPt(_sx, _sy, n2, pt.x, pt.y);
        }
      }
      if (n2 < 3) continue;
      ctx.beginPath();
      crPathLoop(ctx, _sx, _sy, n2, sm);
      ctx.closePath();
      ctx.fillStyle = css(col, s.alpha * (1 - fogS * 0.25));
      ctx.fill();
      if (s.edge && g.lod === 2) {
        ctx.strokeStyle = css(mix3(s.edge, fc, fogS), 0.45 * (1 - fogS));
        ctx.lineWidth = Math.max(0.5, g.s * f.len * 0.013);
        ctx.stroke();
      }
      if (s.glow && g.lod === 2) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = css(col, 0.26 * (1 - fog));
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    /* блик по хребту */
    if (g.lod === 2 && gl > 2) {
      var sx = lerp(g.upx, g.dnx, 0.22), sy = lerp(g.upy, g.dny, 0.22);
      var sg = ctx.createLinearGradient(g.upx, g.upy, lerp(g.upx, g.dnx, 0.62), lerp(g.upy, g.dny, 0.62));
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.45, 'rgba(232,252,255,' + (0.24 * (1 - fog) * (0.5 + g.caus)).toFixed(3) + ')');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.beginPath();
      crPathLoop(ctx, _bx, _by, nb, sm);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = sg;
      ctx.fillRect(Math.min(g.upx, g.dnx) - 40, Math.min(g.upy, g.dny) - 40,
                   Math.abs(g.upx - g.dnx) + 80, Math.abs(g.upy - g.dny) + 80);
      ctx.restore();
      void sx; void sy;
    }
  }

  /* мягкая светлая кромка спины — читаемость силуэта на дальнем плане */
  if (g.marks) {
    ctx.beginPath();
    crPathOpen(ctx, g.topX, g.topY, RN, sm);
    ctx.strokeStyle = css(mix3([225, 248, 255], fc, fogB), 0.22 * (1 - fogB) * (0.4 + lit));
    ctx.lineWidth = Math.max(0.5, g.s * f.len * 0.012);
    ctx.stroke();
  }

  /* ближние плавники */
  for (fi = 0; fi < g.fins.length; fi++) if (g.fins[fi].z <= g.z) drawFin(ctx, g, g.fins[fi], fogB, fc, lit);

  /* глаз: тёмная радужка, узкая кромка в тон тела, крошечный блик */
  if (g.eye.ok && g.eye.r > 0.55) {
    var er = g.eye.r;
    var iris = mix3(mul3(g.eyeIris, 0.85), fc, fogB * 0.5);
    ctx.beginPath();
    ctx.arc(g.eye.x, g.eye.y, er, 0, TAU);
    ctx.fillStyle = css(mix3(mul3(mid, 0.6), fc, fogB * 0.8), 0.85);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(g.eye.x, g.eye.y, er * 0.8, 0, TAU);
    ctx.fillStyle = css(iris);
    ctx.fill();
    if (er > 1.5) {
      ctx.beginPath();
      ctx.arc(g.eye.x, g.eye.y, er * 0.42, 0, TAU);
      ctx.fillStyle = css(mul3(iris, 0.32), 0.92);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(g.eye.x - er * 0.28, g.eye.y - er * 0.32, er * 0.2, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.5 * (1 - fogB)).toFixed(3) + ')';
      ctx.fill();
    }
  }
};

function addRing(ctx, g, i, MS) {
  var b = i * MS;
  /* нормализуем обход, чтобы объединение по nonzero не давало дыр */
  var area = 0;
  for (var j = 0; j < MS; j++) {
    var k = (j + 1) % MS;
    area += g.ringX[b + j] * g.ringY[b + k] - g.ringX[b + k] * g.ringY[b + j];
  }
  if (area >= 0) {
    ctx.moveTo(g.ringX[b], g.ringY[b]);
    for (var j2 = 1; j2 < MS; j2++) ctx.lineTo(g.ringX[b + j2], g.ringY[b + j2]);
  } else {
    ctx.moveTo(g.ringX[b + MS - 1], g.ringY[b + MS - 1]);
    for (var j3 = MS - 2; j3 >= 0; j3--) ctx.lineTo(g.ringX[b + j3], g.ringY[b + j3]);
  }
  ctx.closePath();
}

function drawFin(ctx, g, fin, fog, fc, lit) {
  var n = fin.xs.length, i;
  if (n < 3) return;
  /* кромка плавника — гладкая кривая, без гранёных углов */
  ctx.beginPath();
  crPathLoop(ctx, fin.xs, fin.ys, n, g.lod > 0);
  ctx.closePath();
  var col = mix3(lift(fin.col, 0.55 + 0.8 * lit), fc, fog);
  var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (i = 0; i < n; i++) {
    if (fin.xs[i] < minx) minx = fin.xs[i];
    if (fin.xs[i] > maxx) maxx = fin.xs[i];
    if (fin.ys[i] < miny) miny = fin.ys[i];
    if (fin.ys[i] > maxy) maxy = fin.ys[i];
  }
  var a = fin.alpha * (1 - fog * 0.35);
  if (maxx - minx > 2 || maxy - miny > 2) {
    var gr = ctx.createLinearGradient(fin.xs[0], fin.ys[0], (minx + maxx) * 0.5, (miny + maxy) * 0.5);
    gr.addColorStop(0, css(col, a * 1.25));
    gr.addColorStop(1, css(col, a * 0.42));
    ctx.fillStyle = gr;
  } else {
    ctx.fillStyle = css(col, a);
  }
  ctx.fill();
  if (g.lod === 2) {
    ctx.strokeStyle = css(mix3([240, 252, 255], fc, fog), a * 0.55);
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
}

DRAW.weed = function (ctx, g, env) {
  var wd = g.wd, lx = g.lx, ly = g.ly, rx = g.rx, ry = g.ry, N = lx.length - 1;
  var fog = g.fog;
  var base = mix3(mul3(wd.col, 0.35 + 0.5 * g.lit), waterAt(wd.y), fog);
  var tip = mix3(mul3(wd.col, (0.8 + 0.9 * g.lit + g.caus * 0.9)), waterAt(wd.y + wd.h), fog * 0.92);
  ctx.beginPath();
  ctx.moveTo(lx[0], ly[0]);
  for (var i = 1; i <= N; i++) ctx.lineTo(lx[i], ly[i]);
  for (i = N; i >= 0; i--) ctx.lineTo(rx[i], ry[i]);
  ctx.closePath();
  var gr = ctx.createLinearGradient((lx[0] + rx[0]) * 0.5, (ly[0] + ry[0]) * 0.5,
                                    (lx[N] + rx[N]) * 0.5, (ly[N] + ry[N]) * 0.5);
  gr.addColorStop(0, css(mul3(base, 0.55)));
  gr.addColorStop(0.45, css(base));
  gr.addColorStop(1, css(tip));
  ctx.fillStyle = gr;
  ctx.fill();
  /* светящаяся кромка */
  ctx.beginPath();
  ctx.moveTo(lx[0], ly[0]);
  for (i = 1; i <= N; i++) ctx.lineTo(lx[i], ly[i]);
  ctx.strokeStyle = css(mix3([170, 240, 200], waterAt(wd.y + wd.h), fog), 0.20 * (1 - fog) * (0.4 + g.caus));
  ctx.lineWidth = 1;
  ctx.stroke();
};

DRAW.rock = function (ctx, rk, env) {
  var s = rk._s, fog = rk._fog;
  var R = rk.r * s, H = rk.hy * s;
  if (R < 0.6) return;
  var base = mix3(mul3([64, 62, 66], rk.tint), waterAt(rk.y + rk.hy), fog);
  ctx.beginPath();
  var n = rk.jag.length;
  for (var i = 0; i <= n; i++) {
    var a = Math.PI + (i / n) * Math.PI;         /* верхний купол */
    var j = rk.jag[i % n];
    var px = rk._x + Math.cos(a) * R * j;
    var py = rk._y - Math.sin(a) * H * j * -1;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.lineTo(rk._x + R, rk._y + H * 0.55);
  ctx.lineTo(rk._x - R, rk._y + H * 0.55);
  ctx.closePath();
  var gr = ctx.createLinearGradient(rk._x - R * 0.4, rk._y - H, rk._x + R * 0.3, rk._y + H * 0.6);
  gr.addColorStop(0, css(mul3(base, 1.5)));
  gr.addColorStop(0.5, css(base));
  gr.addColorStop(1, css(mul3(base, 0.45)));
  ctx.fillStyle = gr;
  ctx.fill();
};

DRAW.bubble = function (ctx, b, env) {
  var r = b._r, fog = b._fog;
  if (r < 0.55) {
    ctx.fillStyle = 'rgba(200,240,255,' + (0.30 * (1 - fog)).toFixed(3) + ')';
    ctx.fillRect(b._x - 0.5, b._y - 0.5, 1.2, 1.2);
    return;
  }
  var a = (1 - fog * 0.55);
  ctx.beginPath();
  ctx.arc(b._x, b._y, r, 0, TAU);
  var gr = ctx.createRadialGradient(b._x - r * 0.3, b._y - r * 0.35, r * 0.05, b._x, b._y, r);
  gr.addColorStop(0, 'rgba(226,250,255,' + (0.20 * a).toFixed(3) + ')');
  gr.addColorStop(0.62, 'rgba(150,220,244,' + (0.07 * a).toFixed(3) + ')');
  gr.addColorStop(0.88, 'rgba(190,240,255,' + (0.30 * a).toFixed(3) + ')');
  gr.addColorStop(1, 'rgba(236,254,255,' + (0.62 * a).toFixed(3) + ')');
  ctx.fillStyle = gr;
  ctx.fill();
  if (r > 2.2) {
    ctx.beginPath();
    ctx.arc(b._x - r * 0.32, b._y - r * 0.36, r * 0.20, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.75 * a).toFixed(3) + ')';
    ctx.fill();
  }
};

DRAW.snow = function (ctx, sn, env) {
  var a = 0.30 * (1 - sn._fog * 0.8);
  if (a < 0.012) return;
  ctx.fillStyle = 'rgba(198,232,244,' + a.toFixed(3) + ')';
  var r = sn._r;
  ctx.fillRect(sn._x - r, sn._y - r, r * 2, r * 2);
};

DRAW.shaft = function (ctx, g, env) {
  if (g.alpha <= 0.001) return;
  ctx.globalCompositeOperation = 'lighter';
  var q = g.q;
  for (var layer = 0; layer < 3; layer++) {
    var o = layer * 8;
    var gr = ctx.createLinearGradient(g.tx, g.ty, g.bx, g.by);
    var a = g.alpha * [0.10, 0.13, 0.17][layer] * g.fogK;
    gr.addColorStop(0, 'rgba(190,246,255,' + (a * 1.5).toFixed(3) + ')');
    gr.addColorStop(0.28, 'rgba(150,228,250,' + (a * 0.9).toFixed(3) + ')');
    gr.addColorStop(0.72, 'rgba(96,190,220,' + (a * 0.34).toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(60,150,190,0)');
    ctx.beginPath();
    ctx.moveTo(q[o], q[o + 1]);
    ctx.lineTo(q[o + 2], q[o + 3]);
    ctx.lineTo(q[o + 4], q[o + 5]);
    ctx.lineTo(q[o + 6], q[o + 7]);
    ctx.closePath();
    ctx.fillStyle = gr;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
};

/* ── фон, дно, поверхность, стекло ── */

function drawBackdrop(ctx, cam, w, env) {
  project(cam, 0, TANK.y1 + 1.5, 0, _p);
  project(cam, 0, TANK.y0 - 1.0, 0, _p2);
  var y0 = _p.ok ? _p.y : -cam.h * 0.4;
  var y1 = _p2.ok ? _p2.y : cam.h * 1.4;
  if (Math.abs(y1 - y0) < 4) { y0 = 0; y1 = cam.h; }
  var gr = ctx.createLinearGradient(0, y0, 0, y1);
  var topc = mix3(waterAt(TANK.y1), [120, 200, 205], 0.22);
  gr.addColorStop(0, css(mul3(topc, 1.0)));
  gr.addColorStop(0.30, css(waterAt(TANK.y1 * 0.72)));
  gr.addColorStop(0.66, css(waterAt(TANK.y1 * 0.34)));
  gr.addColorStop(1, css(mul3(waterAt(TANK.y0), 0.78)));
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, cam.w, cam.h);

  /* мягкое свечение сверху — рассеянный свет от поверхности */
  var cxp = cam.w * 0.5, cyp = y0;
  var rg = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, cam.h * 1.05);
  rg.addColorStop(0, 'rgba(150,232,238,' + (0.20 * env.light).toFixed(3) + ')');
  rg.addColorStop(0.5, 'rgba(90,180,200,' + (0.06 * env.light).toFixed(3) + ')');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, cam.w, cam.h);
}

/* Дно. Тон считается ПО ВЕРШИНАМ сетки (гладкий аналитический ламберт +
 * низкочастотные пятна песка), клетка заливается средним по четырём углам —
 * поэтому соседние клетки почти не различаются и решётки не видно. Резкая
 * каустика из заливки убрана: она рисуется отдельно, кривыми лентами. */
function drawFloor(ctx, cam, w, env, q) {
  var NX = Math.max(12, Math.round(30 * q)), NZ = Math.max(9, Math.round(23 * q));
  var gx = w._fgx || (w._fgx = []), gy = w._fgy || (w._fgy = []), gw = w._fgw || (w._fgw = []);
  var cr = w._fcr || (w._fcr = []), cg = w._fcg || (w._fcg = []), cb = w._fcb || (w._fcb = []);
  var need = (NX + 1) * (NZ + 1);
  gx.length = need; gy.length = need; gw.length = need;
  cr.length = need; cg.length = need; cb.length = need;
  var i, j, idx = 0;
  var X0 = -TANK.hx, X1 = TANK.hx, Z0 = -TANK.hz, Z1 = TANK.hz;
  var t = w.t, deep = waterAt(0.25), gd = _fgrad;
  for (j = 0; j <= NZ; j++) {
    var z = Z0 + (Z1 - Z0) * (j / NZ);
    for (i = 0; i <= NX; i++) {
      var x = X0 + (X1 - X0) * (i / NX);
      var y = floorY(x, z);
      project(cam, x, y, z, _p);
      gx[idx] = _p.x; gy[idx] = _p.y; gw[idx] = _p.z;

      floorGrad(x, z, gd);
      var nl = Math.sqrt(gd.dx * gd.dx + 1 + gd.dz * gd.dz);
      var lam = (-gd.dx * LIGHT.x + LIGHT.y - gd.dz * LIGHT.z) / nl;
      if (lam < 0) lam = 0;
      var tone = clamp(fbm2(x * 0.25 + 4.3, z * 0.25 - 2.1, 3157) * 1.4 - 0.2, 0, 1);
      var soft = env.caustics ? causticSoft(x, z, t) : 0.35;
      var col = mul3(mix3(SAND_A, SAND_B, tone), 0.34 + 0.70 * lam * env.light);
      col = mix3(col, CAUS_COL, 0.15 * soft * env.light);
      col = mix3(col, deep, fogAt(_p.z, env));
      cr[idx] = col[0]; cg[idx] = col[1]; cb[idx] = col[2];
      idx++;
    }
  }

  var jStep = cam.pz >= 0 ? 1 : -1, iStep = cam.px >= 0 ? 1 : -1;
  for (j = jStep > 0 ? 0 : NZ - 1; jStep > 0 ? j < NZ : j >= 0; j += jStep) {
    for (i = iStep > 0 ? 0 : NX - 1; iStep > 0 ? i < NX : i >= 0; i += iStep) {
      var a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
      if (gw[a] < NEAR && gw[b] < NEAR && gw[c] < NEAR && gw[d] < NEAR) continue;
      var cxq = (gx[a] + gx[b] + gx[c] + gx[d]) * 0.25;
      var cyq = (gy[a] + gy[b] + gy[c] + gy[d]) * 0.25;
      if (cxq < -60 || cxq > cam.w + 60 || cyq < -60 || cyq > cam.h + 60) continue;

      ctx.beginPath();
      /* лёгкое расширение — против швов антиалиасинга */
      var k = 1.05;
      ctx.moveTo(cxq + (gx[a] - cxq) * k, cyq + (gy[a] - cyq) * k);
      ctx.lineTo(cxq + (gx[b] - cxq) * k, cyq + (gy[b] - cyq) * k);
      ctx.lineTo(cxq + (gx[d] - cxq) * k, cyq + (gy[d] - cyq) * k);
      ctx.lineTo(cxq + (gx[c] - cxq) * k, cyq + (gy[c] - cyq) * k);
      ctx.closePath();
      ctx.fillStyle = 'rgb(' + ch((cr[a] + cr[b] + cr[c] + cr[d]) * 0.25) + ',' +
                               ch((cg[a] + cg[b] + cg[c] + cg[d]) * 0.25) + ',' +
                               ch((cb[a] + cb[b] + cb[c] + cb[d]) * 0.25) + ')';
      ctx.fill();
    }
  }
}

/* Мелкая фактура песка: постоянные мировые точки, размер и плотность на экране
 * даёт перспектива. Точки группируются по яркости и полосе глубины, каждая
 * группа — один path и один fill. */
function drawSandGrain(ctx, cam, w, env, q) {
  var gr = w.grain;
  if (!gr) return;
  var bk = w._gbk;
  if (!bk) { bk = w._gbk = []; for (var b0 = 0; b0 < 6; b0++) bk.push({ n: 0, v: [] }); }
  var k;
  for (k = 0; k < 6; k++) bk[k].n = 0;
  var stride = q < 0.62 ? 3 : (q < 0.85 ? 2 : 1);
  for (var i = 0; i < gr.n; i += stride) {
    var x = gr.x[i], z = gr.z[i];
    project(cam, x, floorY(x, z), z, _p);
    if (!_p.ok) continue;
    if (_p.x < -3 || _p.x > cam.w + 3 || _p.y < -3 || _p.y > cam.h + 3) continue;
    var fog = fogAt(_p.z, env);
    if (fog > 0.9) continue;
    var e = bk[(fog < 0.4 ? 0 : (fog < 0.68 ? 1 : 2)) * 2 + (gr.b[i] < 0.52 ? 0 : 1)];
    var sz = gr.s[i] * _p.s;
    if (sz < 0.55) sz = 0.55; else if (sz > 3.4) sz = 3.4;
    var m = e.n * 3, v = e.v;
    v[m] = _p.x - sz * 0.5; v[m + 1] = _p.y - sz * 0.5; v[m + 2] = sz;
    e.n++;
  }
  var alph = [0.21, 0.14, 0.08];
  for (k = 0; k < 6; k++) {
    var e2 = bk[k];
    if (!e2.n) continue;
    var light = (k & 1) === 1;
    var a = alph[k >> 1] * (1 + 0.18 * (stride - 1)) * (light ? 1 : 0.85) * env.light;
    ctx.fillStyle = css(light ? GRAIN_L : GRAIN_D, a);
    ctx.beginPath();
    var vv = e2.v;
    for (var m2 = 0; m2 < e2.n; m2++) {
      var o = m2 * 3;
      ctx.rect(vv[o], vv[o + 1], vv[o + 2], vv[o + 2]);
    }
    ctx.fill();
  }
}
var GRAIN_L = [234, 220, 190];
var GRAIN_D = [66, 54, 40];

/* Каустика дна: волнистые пересекающиеся жилы. Каждая — лента в мировых
 * координатах (ширина честно укорачивается перспективой), три вложенных
 * прохода дают мягкое гало и яркое ядро, мерцание — градиент вдоль жилы. */
function drawFloorCaustics(ctx, cam, w, env, q) {
  if (!env.caustics || !w.caust) return;
  var t = w.t, NS = q < 0.78 ? 14 : 22;
  var cxs = w._ccx || (w._ccx = []), cys = w._ccy || (w._ccy = []);
  var lxs = w._clx || (w._clx = []), lys = w._cly || (w._cly = []);
  var rxs = w._crx || (w._crx = []), rys = w._cry || (w._cry = []);
  var fgs = w._cfg || (w._cfg = []);
  var i;
  ctx.globalCompositeOperation = 'lighter';
  for (var li = 0; li < w.caust.length; li++) {
    var L = w.caust[li];
    var span = L.axis === 0 ? TANK.hx : TANK.hz;
    var cross = L.axis === 0 ? TANK.hz : TANK.hx;
    var cc = L.c + Math.sin(t * L.ds + L.dp) * L.dr;
    var vis = 0, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (i = 0; i <= NS; i++) {
      var u = i / NS;
      var pu = -span + 2 * span * u;
      var f1 = pu * L.k1 + t * L.s1 + L.p1, f2 = pu * L.k2 - t * L.s2 + L.p2;
      var off = L.a1 * Math.sin(f1) + L.a2 * Math.sin(f2);
      var doff = L.a1 * L.k1 * Math.cos(f1) + L.a2 * L.k2 * Math.cos(f2);
      var pv = clamp(cc + off, -cross + 0.05, cross - 0.05);
      var x = L.axis === 0 ? pu : pv, z = L.axis === 0 ? pv : pu;
      var tx = L.axis === 0 ? 1 : doff, tz = L.axis === 0 ? doff : 1;
      var tl = Math.sqrt(tx * tx + tz * tz) || 1;
      var nx = -tz / tl, nz = tx / tl;
      var hw = L.wid * (0.62 + 0.5 * Math.sin(u * 7.3 + t * 0.42 + L.fp));
      project(cam, x, floorY(x, z), z, _p);
      cxs[i] = _p.x; cys[i] = _p.y; fgs[i] = fogAt(_p.z, env);
      if (_p.ok) {
        vis++;
        if (_p.x < minx) minx = _p.x;
        if (_p.x > maxx) maxx = _p.x;
        if (_p.y < miny) miny = _p.y;
        if (_p.y > maxy) maxy = _p.y;
      }
      var ax = x + nx * hw, az = z + nz * hw;
      project(cam, ax, floorY(ax, az), az, _p2);
      lxs[i] = _p2.x; lys[i] = _p2.y;
      var bxq = x - nx * hw, bzq = z - nz * hw;
      project(cam, bxq, floorY(bxq, bzq), bzq, _p3);
      rxs[i] = _p3.x; rys[i] = _p3.y;
    }
    if (!vis) continue;
    if (maxx < -30 || minx > cam.w + 30 || maxy < -30 || miny > cam.h + 30) continue;

    var grd = ctx.createLinearGradient(cxs[0], cys[0], cxs[NS], cys[NS]);
    for (var st = 0; st <= 4; st++) {
      var iu = Math.round(st * NS / 4), uu = iu / NS;
      var fl = 0.28 + 0.90 * (0.5 + 0.5 * Math.sin(uu * L.fk * TAU + t * L.fs * 2.1 + L.fp)) *
                             (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(uu * L.fk * 1.7 * TAU - t * L.fs * 1.3)));
      var aa = clamp(L.br * fl * (1 - fgs[iu]) * env.light, 0, 1);
      grd.addColorStop(st / 4, 'rgba(198,246,255,' + aa.toFixed(3) + ')');
    }
    ctx.fillStyle = grd;
    for (var pass = 0; pass < 3; pass++) {
      var kw = CAUS_W[pass];
      ctx.globalAlpha = CAUS_A[pass];
      ctx.beginPath();
      ctx.moveTo(cxs[0] + (lxs[0] - cxs[0]) * kw, cys[0] + (lys[0] - cys[0]) * kw);
      for (i = 1; i <= NS; i++) ctx.lineTo(cxs[i] + (lxs[i] - cxs[i]) * kw, cys[i] + (lys[i] - cys[i]) * kw);
      for (i = NS; i >= 0; i--) ctx.lineTo(cxs[i] + (rxs[i] - cxs[i]) * kw, cys[i] + (rys[i] - cys[i]) * kw);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
}
var CAUS_W = [1, 0.58, 0.26];
var CAUS_A = [0.075, 0.12, 0.185];

function drawSurface(ctx, cam, w, env, q) {
  var NX = Math.max(10, Math.round(22 * q)), NZ = Math.max(8, Math.round(16 * q));
  var t = w.t;
  var gx = [], gy = [], gz = [];
  var i, j, idx = 0;
  for (j = 0; j <= NZ; j++) {
    var z = -TANK.hz + 2 * TANK.hz * (j / NZ);
    for (i = 0; i <= NX; i++) {
      var x = -TANK.hx + 2 * TANK.hx * (i / NX);
      var ripple = Math.sin(x * 1.4 + t * 1.3) * 0.045 + Math.sin(z * 1.15 - t * 1.05) * 0.04
                 + Math.sin((x + z) * 0.9 + t * 0.7) * 0.03;
      project(cam, x, TANK.y1 + ripple, z, _p);
      gx[idx] = _p.x; gy[idx] = _p.y; gz[idx] = _p.z; idx++;
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (j = 0; j < NZ; j++) {
    for (i = 0; i < NX; i++) {
      var a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
      if (gz[a] < NEAR || gz[d] < NEAR) continue;
      var cx = (gx[a] + gx[b] + gx[c] + gx[d]) * 0.25;
      var cy = (gy[a] + gy[b] + gy[c] + gy[d]) * 0.25;
      if (cx < -50 || cx > cam.w + 50 || cy < -50 || cy > cam.h + 50) continue;
      var wx = -TANK.hx + 2 * TANK.hx * ((i + 0.5) / NX);
      var wz = -TANK.hz + 2 * TANK.hz * ((j + 0.5) / NZ);
      var shim = env.caustics ? causticField(wx * 1.3, wz * 1.3, t * 1.25 + 4.1) : 0.2;
      var base = 0.055 + 0.30 * shim;
      var fog = fogAt(gz[a], env);
      var al = base * (1 - fog * 0.5) * env.light;
      if (al < 0.006) continue;
      ctx.beginPath();
      var k = 1.06;
      ctx.moveTo(cx + (gx[a] - cx) * k, cy + (gy[a] - cy) * k);
      ctx.lineTo(cx + (gx[b] - cx) * k, cy + (gy[b] - cy) * k);
      ctx.lineTo(cx + (gx[d] - cx) * k, cy + (gy[d] - cy) * k);
      ctx.lineTo(cx + (gx[c] - cx) * k, cy + (gy[c] - cy) * k);
      ctx.closePath();
      ctx.fillStyle = 'rgba(178,238,246,' + al.toFixed(3) + ')';
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* рёбра стеклянного объёма */
var BOX_E = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7]
];
function boxCorner(k) {
  return [(k & 1) ? TANK.hx : -TANK.hx, (k & 2) ? TANK.y1 : TANK.y0, (k & 4) ? TANK.hz : -TANK.hz];
}
function drawGlass(ctx, cam, env, near) {
  var pts = [], zs = [];
  for (var k = 0; k < 8; k++) {
    var c = boxCorner(k);
    project(cam, c[0], c[1], c[2], _p);
    pts.push(_p.x, _p.y); zs.push(_p.z);
  }
  var cz = 0;
  for (k = 0; k < 8; k++) cz += zs[k];
  cz /= 8;
  ctx.lineCap = 'round';
  for (var e = 0; e < BOX_E.length; e++) {
    var a = BOX_E[e][0], b = BOX_E[e][1];
    if (zs[a] < NEAR || zs[b] < NEAR) continue;
    var mz = (zs[a] + zs[b]) * 0.5;
    var isNear = mz < cz;
    if (isNear !== near) continue;
    var fog = fogAt(mz, env);
    var al = (near ? 0.30 : 0.17) * (1 - fog * 0.65);
    ctx.beginPath();
    ctx.moveTo(pts[a * 2], pts[a * 2 + 1]);
    ctx.lineTo(pts[b * 2], pts[b * 2 + 1]);
    ctx.strokeStyle = 'rgba(184,240,255,' + al.toFixed(3) + ')';
    ctx.lineWidth = near ? 1.5 : 1;
    ctx.stroke();
    if (near) {
      ctx.strokeStyle = 'rgba(220,250,255,' + (al * 0.35).toFixed(3) + ')';
      ctx.lineWidth = 4.5;
      ctx.stroke();
    }
  }
}

function drawReflections(ctx, cam, t, env) {
  var W = cam.w, H = cam.h;
  ctx.globalCompositeOperation = 'lighter';
  /* косые блики на переднем стекле */
  for (var i = 0; i < 3; i++) {
    var ph = t * 0.045 + i * 2.1;
    var x0 = W * (0.12 + 0.30 * i) + Math.sin(ph) * W * 0.06 - cam.px * 6;
    var g = ctx.createLinearGradient(x0, 0, x0 + W * 0.30, H);
    var a = (0.030 + 0.016 * Math.sin(t * 0.23 + i)) * env.light;
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.42, 'rgba(214,246,255,' + a.toFixed(3) + ')');
    g.addColorStop(0.55, 'rgba(232,252,255,' + (a * 1.5).toFixed(3) + ')');
    g.addColorStop(0.68, 'rgba(214,246,255,' + a.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = 'source-over';

  /* виньетка + холодный низ */
  var vg = ctx.createRadialGradient(W * 0.5, H * 0.44, Math.min(W, H) * 0.22,
                                    W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.62, 'rgba(2,12,20,0.16)');
  vg.addColorStop(1, 'rgba(1,7,13,0.62)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

/* ══════════════════════════ рендер кадра ══════════════════════════ */

function renderScene(ctx, w, cam, quality) {
  var env = w.env;
  drawBackdrop(ctx, cam, w, env);
  drawGlass(ctx, cam, env, false);
  drawSurface(ctx, cam, w, env, quality);
  drawFloor(ctx, cam, w, env, quality);
  drawSandGrain(ctx, cam, w, env, quality);
  drawFloorCaustics(ctx, cam, w, env, quality);

  var items = buildFrame(w, cam);
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    DRAW[it.kind](ctx, it.geo, env);
  }
  drawGlass(ctx, cam, env, true);
  drawReflections(ctx, cam, w.t, env);
  return items.length;
}

/* ══════════════════════════ камера-облёт ══════════════════════════ */

function orbitCamera(cam, t, ui) {
  var az = 0.52 * Math.sin(t * 0.052) + 0.16 * Math.sin(t * 0.0181 + 1.3) + ui.az;
  var el = 0.135 + 0.085 * Math.sin(t * 0.0385 + 0.7) + ui.el;
  el = clamp(el, -0.28, 0.62);
  var dist = (11.0 + 0.85 * Math.sin(t * 0.0243)) * ui.zoom;
  var ty = 3.55 + 0.35 * Math.sin(t * 0.031 + 2.1);
  cam.tx = 0.35 * Math.sin(t * 0.023);
  cam.ty = ty;
  cam.tz = 0;
  var ce = Math.cos(el);
  cam.px = cam.tx + Math.sin(az) * ce * dist;
  cam.py = cam.ty + Math.sin(el) * dist;
  cam.pz = cam.tz + Math.cos(az) * ce * dist;
  cam.roll = 0.016 * Math.sin(t * 0.041 + 0.4);
  cam.fov = 0.92;
  return cam;
}

/* ══════════════════════════ браузерная обвязка ══════════════════════════ */

function boot() {
  var canvas = document.getElementById('scene');
  if (!canvas) return;
  var ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  var world = makeWorld(20260816);
  var cam = makeCamera();

  var ui = {
    time: 1, orbit: 1, fog: 1, light: 1,
    paused: false, rays: true, caustics: true, bloom: true,
    az: 0, el: 0, zoom: 1
  };
  var quality = 1, renderScale = 1, dprCap = 2;
  var cssW = 0, cssH = 0, dpr = 1;

  /* — bloom — */
  var gA = document.createElement('canvas'), gAc = gA.getContext('2d');
  var gB = document.createElement('canvas'), gBc = gB.getContext('2d');
  var filterOK = !!gAc && typeof gAc.filter === 'string';

  function resize() {
    var w = Math.max(1, canvas.clientWidth || window.innerWidth || 1);
    var h = Math.max(1, canvas.clientHeight || window.innerHeight || 1);
    var d = Math.min(dprCap, window.devicePixelRatio || 1);
    if (w === cssW && h === cssH && d === dpr) return;
    cssW = w; cssH = h; dpr = d;
    var sc = d * renderScale;
    canvas.width = Math.max(1, Math.round(w * sc));
    canvas.height = Math.max(1, Math.round(h * sc));
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    gA.width = Math.max(16, Math.round(canvas.width / 4));
    gA.height = Math.max(16, Math.round(canvas.height / 4));
    gB.width = gA.width; gB.height = gA.height;
  }

  /* — управление — */
  function bindSlider(id, valId, map, set) {
    var el = document.getElementById(id), lab = document.getElementById(valId);
    if (!el) return;
    var upd = function () {
      var v = map(parseFloat(el.value));
      set(v);
      if (lab) lab.textContent = v.toFixed(2) + '×';
    };
    el.addEventListener('input', upd);
    upd();
  }
  bindSlider('sTime', 'vTime', function (v) { return v / 100; }, function (v) { ui.time = v; });
  bindSlider('sOrbit', 'vOrbit', function (v) { return v / 100; }, function (v) { ui.orbit = v; });
  bindSlider('sFog', 'vFog', function (v) { return v / 100; }, function (v) { ui.fog = v; });
  bindSlider('sLight', 'vLight', function (v) { return v / 100; }, function (v) { ui.light = v; });

  function bindToggle(id, key, invert) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function () {
      ui[key] = !ui[key];
      var on = invert ? ui[key] : ui[key];
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  bindToggle('bPause', 'paused');
  bindToggle('bRays', 'rays');
  bindToggle('bCaus', 'caustics');
  bindToggle('bBloom', 'bloom');

  /* мышь: обзор и зум */
  var drag = false, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', function (e) {
    drag = true; lx = e.clientX; ly = e.clientY;
    canvas.classList.add('dragging');
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) {} }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    ui.az = clamp(ui.az - (e.clientX - lx) * 0.0042, -1.15, 1.15);
    ui.el = clamp(ui.el + (e.clientY - ly) * 0.0032, -0.4, 0.45);
    lx = e.clientX; ly = e.clientY;
  });
  function endDrag() { drag = false; canvas.classList.remove('dragging'); }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', endDrag);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    ui.zoom = clamp(ui.zoom * (1 + (e.deltaY > 0 ? 0.08 : -0.08)), 0.62, 1.7);
  }, { passive: false });
  window.addEventListener('keydown', function (e) {
    var tg = e.target;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'BUTTON')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      ui.paused = !ui.paused;
      var bp = document.getElementById('bPause');
      if (bp) { bp.classList.toggle('on', ui.paused); bp.setAttribute('aria-pressed', ui.paused ? 'true' : 'false'); }
    }
  });
  window.addEventListener('resize', resize);

  /* — цикл — */
  var last = 0, camT = 0, ema = 16, fpsAcc = 0, fpsN = 0, fpsT = 0, objN = 0;
  var fpsEl = document.getElementById('fps'), cntEl = document.getElementById('cnt');

  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    var raw = (now - last) / 1000;
    last = now;
    var dt = clamp(raw, 0, 0.05);

    resize();
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : now;

    var sdt = ui.paused ? 0 : dt * ui.time;
    camT += ui.paused ? 0 : dt * ui.orbit;
    if (sdt > 0) stepWorld(world, sdt);

    world.env.fog = ui.fog;
    world.env.light = ui.light;
    world.env.caustics = ui.caustics ? 1 : 0;
    world.env.rays = ui.rays ? 1 : 0;

    orbitCamera(cam, camT, ui);
    updateCamera(cam, cssW, cssH);

    ctx.save();
    objN = renderScene(ctx, world, cam, quality);
    ctx.restore();

    if (ui.bloom && gAc && gBc) {
      gAc.globalCompositeOperation = 'copy';
      gAc.filter = 'none';
      gAc.drawImage(canvas, 0, 0, gA.width, gA.height);
      gBc.globalCompositeOperation = 'copy';
      gBc.filter = 'none';
      gBc.drawImage(gA, 0, 0);
      gAc.globalCompositeOperation = 'multiply';
      gAc.drawImage(gB, 0, 0);
      if (filterOK) {
        gBc.filter = 'blur(2.6px)';
        gBc.globalCompositeOperation = 'copy';
        gBc.drawImage(gA, 0, 0);
        gBc.filter = 'none';
      } else {
        gBc.globalCompositeOperation = 'copy';
        gBc.drawImage(gA, 0, 0);
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.42;
      ctx.drawImage(gB, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    /* адаптивное качество */
    var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : now;
    ema = ema * 0.92 + (t1 - t0) * 0.08;
    if (ema > 21 && quality > 0.55) quality -= 0.012;
    else if (ema < 12 && quality < 1) quality = Math.min(1, quality + 0.006);
    if (ema > 34 && dprCap > 1.25) { dprCap = 1.25; cssW = 0; resize(); }

    fpsAcc += raw; fpsN++;
    if (now - fpsT > 500) {
      fpsT = now;
      if (fpsEl && fpsN) fpsEl.textContent = String(Math.round(fpsN / Math.max(1e-4, fpsAcc)));
      if (cntEl) cntEl.textContent = 'рыб: ' + world.fish.length + ' · объектов в сортировке: ' + objN;
      fpsAcc = 0; fpsN = 0;
    }
  }

  resize();
  /* один шаг «прогрева», чтобы первый кадр уже был живым */
  for (var pw = 0; pw < 90; pw++) stepWorld(world, 1 / 30);
  requestAnimationFrame(frame);
}

/* ══════════════════════════ экспорт ══════════════════════════ */

var API = {
  TANK: TANK, SPECIES: SPECIES,
  makeCamera: makeCamera, updateCamera: updateCamera, project: project, newP: newP,
  makeWorld: makeWorld, stepWorld: stepWorld, buildFrame: buildFrame,
  buildFishGeo: buildFishGeo, orbitCamera: orbitCamera, renderScene: renderScene,
  causticField: causticField, causticSoft: causticSoft, floorY: floorY,
  floorGrad: floorGrad, fbm2: fbm2, edgeAt: edgeAt, waterAt: waterAt,
  halfH: halfH, halfW: halfW, fogAt: fogAt, boot: boot
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
return API;

})();
if (typeof window !== 'undefined') window.AQUARIUM = AQUARIUM;
