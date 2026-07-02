/* «Солнечная система» — Claude Fable 5.
   Canvas 2D, собственная 3D-проекция, кеплеровы эллиптические орбиты,
   терминатор день/ночь, кольца Сатурна с корректным перекрытием,
   затухающие следы, кинематографичный облёт камеры. Без библиотек. */
(() => {
'use strict';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

// ---------------------------------------------------------------- канвас
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.max(1, Math.round(W * DPR));
  canvas.height = Math.max(1, Math.round(H * DPR));
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- камера
const cam = {
  yaw: 0.85, pitch: 0.42,
  dist: 1200, zoom: 0.75,
  auto: true, spin: 0.03,       // рад/с автооблёта
  vyaw: 0, vpitch: 0,           // инерция после перетаскивания
  t: 0
};
// коэффициенты поворота, обновляются раз в кадр
let cy = 1, sy = 0, cp = 1, sp = 0, F = 1;

function updateCamFrame() {
  const bob = cam.auto ? Math.sin(cam.t * 0.11) * 0.02 : 0; // лёгкое «дыхание»
  cy = Math.cos(cam.yaw); sy = Math.sin(cam.yaw);
  cp = Math.cos(cam.pitch + bob); sp = Math.sin(cam.pitch + bob);
  F = Math.min(W, H) * 1.55 * cam.zoom;
}

// мировые координаты -> камера (x вправо, y вверх, z к наблюдателю)
function toCam(x, y, z, out) {
  const x1 = x * cy - z * sy;
  const z1 = x * sy + z * cy;
  out.x = x1;
  out.y = y * cp - z1 * sp;
  out.z = y * sp + z1 * cp;
  return out;
}
// камера -> экран; d = глубина (больше = дальше)
function project(c, out) {
  const d = cam.dist - c.z;
  const s = F / Math.max(d, 60);
  out.x = W / 2 + c.x * s;
  out.y = H / 2 - c.y * s;
  out.d = d;
  out.s = s;
  return out;
}

// ---------------------------------------------------------------- данные
// a — большая полуось (условные ед.), e — эксцентриситет, i/O/w — градусы,
// T — период в земных годах, r — визуальный радиус, tilt — наклон оси.
const YEAR = 18; // секунд симуляции на 1 земной год при скорости ×1

const PLANETS = [
  { name: 'Меркурий', a: 62,  e: 0.206, i: 7.00, O: 48,  w: 29,  T: 0.241, M0: 2.9,
    r: 2.3, tilt: 0,    type: 'rock', col: ['#d8cdbd', '#93887a', '#463f35'], trail: '#b3a894' },
  { name: 'Венера',   a: 86,  e: 0.007, i: 3.39, O: 76,  w: 55,  T: 0.615, M0: 0.8,
    r: 3.5, tilt: 177,  type: 'rock', col: ['#fff0c8', '#e7b463', '#7d5324'], trail: '#ecc17c',
    atmo: 'rgba(255,224,160,0.55)' },
  { name: 'Земля',    a: 112, e: 0.017, i: 0.00, O: 0,   w: 102, T: 1.0,   M0: 5.5,
    r: 3.7, tilt: 23.4, type: 'rock', col: ['#cfeaff', '#3f8fe0', '#0e3168'], trail: '#6fb1ff',
    atmo: 'rgba(110,180,255,0.6)',
    moons: [
      { name: 'Луна', a: 9.2, Ts: 6.0, r: 1.15, i: 12, ph: 1.2, col: ['#efefef', '#9d9d9d', '#3f3f3f'] }
    ] },
  { name: 'Марс',     a: 140, e: 0.093, i: 1.85, O: 49,  w: 286, T: 1.881, M0: 4.1,
    r: 2.9, tilt: 25,   type: 'rock', col: ['#ffc296', '#d96f3c', '#5f2a12'], trail: '#f08a5a' },
  { name: 'Юпитер',   a: 205, e: 0.048, i: 1.30, O: 100, w: 274, T: 11.86, M0: 1.7,
    r: 11.5, tilt: 3,   type: 'gas', trail: '#e8c9a0',
    col: ['#f6e6c6', '#d3a878', '#6d4c30'],
    bands: [['#f2e2bf', 0], ['#d9b48a', 0.15], ['#f6ead0', 0.28], ['#c1804f', 0.40],
            ['#ecd9b4', 0.50], ['#b5744a', 0.62], ['#ead6ae', 0.74], ['#c79c6b', 0.88], ['#8d6a49', 1]],
    moons: [
      { name: 'Ио',       a: 16.5, Ts: 3.4,  r: 1.0,  i: 3, ph: 0.4, col: ['#fff4b0', '#e0c050', '#6d5a1c'] },
      { name: 'Европа',   a: 20.5, Ts: 5.1,  r: 0.95, i: 5, ph: 2.6, col: ['#f4f0e6', '#c9b9a0', '#5c5244'] },
      { name: 'Ганимед',  a: 25.5, Ts: 7.4,  r: 1.35, i: 2, ph: 4.4, col: ['#dcd2c2', '#a09078', '#463c30'] },
      { name: 'Каллисто', a: 31.0, Ts: 10.5, r: 1.25, i: 6, ph: 5.6, col: ['#c9bfae', '#8b7d66', '#3a332a'] }
    ] },
  { name: 'Сатурн',   a: 262, e: 0.056, i: 2.49, O: 114, w: 339, T: 29.45, M0: 0.35,
    r: 9.8, tilt: 26.7, type: 'gas', trail: '#e6d3a3',
    col: ['#f4e3bb', '#d9b985', '#77592f'],
    bands: [['#f3e2ba', 0], ['#e3c896', 0.22], ['#f5e7c4', 0.4], ['#d3b27e', 0.56],
            ['#eddcb2', 0.72], ['#c6a26c', 0.9], ['#94714a', 1]],
    ring: {
      bands: [
        { r1: 11.6, r2: 13.1, col: '169,150,122', al: 0.30 },  // кольцо C
        { r1: 13.5, r2: 17.4, col: '232,214,178', al: 0.88 },  // кольцо B
        { r1: 18.2, r2: 21.0, col: '213,193,156', al: 0.55 }   // кольцо A
      ]
    },
    moons: [
      { name: 'Титан', a: 27.5, Ts: 8.6, r: 1.3, i: 6, ph: 3.1, col: ['#ffe3a3', '#d8aa55', '#6a4d1e'] }
    ] },
  { name: 'Уран',     a: 318, e: 0.046, i: 0.77, O: 74,  w: 97,  T: 84.0,  M0: 3.6,
    r: 6.0, tilt: 98,   type: 'gas', trail: '#9fe6e0',
    col: ['#d9fbf8', '#7fd4cd', '#2a6f6f'],
    bands: [['#cef5f1', 0], ['#a4e2dc', 0.35], ['#c6efe9', 0.6], ['#83cdc7', 1]] },
  { name: 'Нептун',   a: 368, e: 0.010, i: 1.77, O: 131, w: 273, T: 164.8, M0: 5.0,
    r: 5.8, tilt: 28,   type: 'gas', trail: '#7fa3ff',
    col: ['#cfe0ff', '#4f7fe8', '#16307a'],
    bands: [['#a9c4ff', 0], ['#6f95ef', 0.3], ['#9cbafc', 0.55], ['#4a6fd6', 0.8], ['#7e9df2', 1]] }
];

const SUN = { name: 'Солнце', r: 25 };

// прекомпьют: P/Q-векторы ориентации орбиты (эклиптика -> мир: x=X, z=Y, y=Z)
for (const p of PLANETS) {
  const i = p.i * D2R, O = p.O * D2R, w = p.w * D2R;
  const ci = Math.cos(i), si = Math.sin(i);
  const cO = Math.cos(O), sO = Math.sin(O);
  const cw = Math.cos(w), sw = Math.sin(w);
  p.Px = cw * cO - sw * sO * ci; p.Py = cw * sO + sw * cO * ci; p.Pz = sw * si;
  p.Qx = -sw * cO - cw * sO * ci; p.Qy = -sw * sO + cw * cO * ci; p.Qz = cw * si;
  const tl = p.tilt * D2R; // ось вращения планеты в мире (фиксирована)
  p.axis = { x: Math.sin(tl), y: Math.cos(tl), z: 0 };
  p.pos = { x: 0, y: 0, z: 0 };
  p.trailPts = [];
  p.lastS = 0;
}

function kepler(M, e) {
  M %= TAU; if (M < 0) M += TAU;
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 6; k++) {
    const f = E - e * Math.sin(E) - M;
    E -= f / (1 - e * Math.cos(E));
  }
  return E;
}

// положение планеты в мире на момент tY (земные годы)
function planetPosAt(p, tY, out) {
  const M = TAU * (tY / p.T) + p.M0;
  const E = kepler(M, p.e);
  const xo = p.a * (Math.cos(E) - p.e);
  const yo = p.a * Math.sqrt(1 - p.e * p.e) * Math.sin(E);
  out.x = p.Px * xo + p.Qx * yo;
  out.z = p.Py * xo + p.Qy * yo;
  out.y = p.Pz * xo + p.Qz * yo;
  return out;
}

// статичные линии орбит (160 точек по эксцентрической аномалии)
for (const p of PLANETS) {
  const pts = [];
  for (let k = 0; k < 160; k++) {
    const E = TAU * k / 160;
    const xo = p.a * (Math.cos(E) - p.e);
    const yo = p.a * Math.sqrt(1 - p.e * p.e) * Math.sin(E);
    pts.push({
      x: p.Px * xo + p.Qx * yo,
      z: p.Py * xo + p.Qy * yo,
      y: p.Pz * xo + p.Qz * yo
    });
  }
  p.orbitPts = pts;
}

// ---------------------------------------------------------------- небо
// звёзды и пылевая полоса Млечного Пути — направления на небесной сфере,
// проецируются тем же поворотом камеры (честный 3D-параллакс)
function randDir() {
  // равномерно по сфере
  const u = Math.random() * 2 - 1;
  const ph = Math.random() * TAU;
  const s = Math.sqrt(1 - u * u);
  return { x: s * Math.cos(ph), y: u, z: s * Math.sin(ph) };
}
const STAR_COLS = ['#ffffff', '#ffffff', '#cfe0ff', '#ffeccc', '#ffd6a8', '#b8ccff'];
const stars = [];
for (let k = 0; k < 900; k++) {
  const d = randDir();
  stars.push({
    d,
    r: 0.4 + Math.pow(Math.random(), 3) * 1.6,
    a: 0.25 + Math.random() * 0.75,
    c: STAR_COLS[(Math.random() * STAR_COLS.length) | 0],
    tw: Math.random() < 0.35 ? (1 + Math.random() * 2) : 0, // частота мерцания
    phT: Math.random() * TAU
  });
}
// полоса «пыли»: точки возле большого круга с нормалью bn
const bn = { x: 0.42, y: 0.86, z: 0.28 };
{ const l = Math.hypot(bn.x, bn.y, bn.z); bn.x /= l; bn.y /= l; bn.z /= l; }
const dust = [];
for (let k = 0; k < 240; k++) {
  let d = randDir();
  // прижимаем к плоскости полосы
  const dot = d.x * bn.x + d.y * bn.y + d.z * bn.z;
  d = { x: d.x - bn.x * dot * 0.92, y: d.y - bn.y * dot * 0.92, z: d.z - bn.z * dot * 0.92 };
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  d.x /= l; d.y /= l; d.z /= l;
  dust.push({
    d,
    sz: 26 + Math.random() * 70,
    a: 0.015 + Math.random() * 0.035,
    warm: Math.random() < 0.35
  });
}
// спрайты для пыли (пре-рендер, дёшево в кадре)
function makeBlob(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, color);
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  return c;
}
const blobCool = makeBlob('rgba(150,180,255,1)');
const blobWarm = makeBlob('rgba(255,220,180,1)');

const skyP = { x: 0, y: 0, z: 0 };
function drawSky(t) {
  const f = Math.min(W, H) * 0.85;
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < dust.length; k++) {
    const s = dust[k];
    toCam(s.d.x, s.d.y, s.d.z, skyP);
    if (skyP.z < 0.18) continue;
    const sx = W / 2 + (skyP.x / skyP.z) * f;
    const sxOut = sx < -90 || sx > W + 90;
    const sy = H / 2 - (skyP.y / skyP.z) * f;
    if (sxOut || sy < -90 || sy > H + 90) continue;
    ctx.globalAlpha = s.a;
    ctx.drawImage(s.warm ? blobWarm : blobCool, sx - s.sz / 2, sy - s.sz / 2, s.sz, s.sz);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (let k = 0; k < stars.length; k++) {
    const s = stars[k];
    toCam(s.d.x, s.d.y, s.d.z, skyP);
    if (skyP.z < 0.18) continue;
    const sx = W / 2 + (skyP.x / skyP.z) * f;
    const sy = H / 2 - (skyP.y / skyP.z) * f;
    if (sx < -4 || sx > W + 4 || sy < -4 || sy > H + 4) continue;
    let a = s.a;
    if (s.tw) a *= 0.72 + 0.28 * Math.sin(t * s.tw + s.phT);
    ctx.globalAlpha = a;
    ctx.fillStyle = s.c;
    if (s.r > 1.1) {
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillRect(sx - s.r, sy - s.r, s.r * 2, s.r * 2);
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- следы
const TRAIL_N = 240;   // выборок на полный оборот
const TRAIL_FRAC = 0.5; // хвост = половина орбиты

function initTrails() {
  const tmp = { x: 0, y: 0, z: 0 };
  for (const p of PLANETS) {
    p.trailPts.length = 0;
    const dtY = p.T / TRAIL_N;
    const n = Math.round(TRAIL_N * TRAIL_FRAC);
    for (let k = n; k >= 1; k--) {
      const t = -k * dtY;
      planetPosAt(p, t, tmp);
      p.trailPts.push({ x: tmp.x, y: tmp.y, z: tmp.z, t });
    }
    p.lastS = 0;
  }
}
initTrails();

function updateTrails(simY) {
  const tmp = { x: 0, y: 0, z: 0 };
  for (const p of PLANETS) {
    const dtY = p.T / TRAIL_N;
    let guard = 0;
    while (p.lastS + dtY <= simY && guard < 12) {
      p.lastS += dtY;
      planetPosAt(p, p.lastS, tmp);
      p.trailPts.push({ x: tmp.x, y: tmp.y, z: tmp.z, t: p.lastS });
      guard++;
    }
    if (guard >= 12) p.lastS = simY; // очень высокая скорость — догоняем скачком
    const maxAge = p.T * TRAIL_FRAC;
    while (p.trailPts.length && p.trailPts[0].t < simY - maxAge) p.trailPts.shift();
    while (p.trailPts.length > TRAIL_N) p.trailPts.shift();
  }
}

const tc = { x: 0, y: 0, z: 0 }, tp = { x: 0, y: 0, d: 0, s: 0 };
function drawTrails(simY) {
  ctx.lineCap = 'round';
  for (const p of PLANETS) {
    const pts = p.trailPts;
    if (pts.length < 2) continue;
    const maxAge = p.T * TRAIL_FRAC;
    // экранные координаты
    const sx = [], sy = [], ok = [];
    for (let k = 0; k < pts.length; k++) {
      toCam(pts[k].x, pts[k].y, pts[k].z, tc);
      project(tc, tp);
      sx.push(tp.x); sy.push(tp.y); ok.push(tp.d > 80);
    }
    // сегменты группами по 5 с общей прозрачностью
    const G = 5;
    for (let k = 0; k < pts.length - 1; k += G) {
      const end = Math.min(k + G, pts.length - 1);
      const age = simY - pts[Math.min(k + (G >> 1), pts.length - 1)].t;
      const a = clamp(1 - age / maxAge, 0, 1);
      if (a <= 0.01) continue;
      ctx.strokeStyle = p.trail;
      ctx.globalAlpha = a * a * 0.55;
      ctx.lineWidth = 0.8 + a * 1.3;
      ctx.beginPath();
      let started = false;
      for (let m = k; m <= end; m++) {
        if (!ok[m]) { started = false; continue; }
        if (!started) { ctx.moveTo(sx[m], sy[m]); started = true; }
        else ctx.lineTo(sx[m], sy[m]);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawOrbits() {
  ctx.strokeStyle = 'rgba(150,175,235,0.55)';
  ctx.lineWidth = 0.7;
  for (const p of PLANETS) {
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    let started = false;
    for (let k = 0; k <= p.orbitPts.length; k++) {
      const q = p.orbitPts[k % p.orbitPts.length];
      toCam(q.x, q.y, q.z, tc);
      project(tc, tp);
      if (tp.d <= 80) { started = false; continue; }
      if (!started) { ctx.moveTo(tp.x, tp.y); started = true; }
      else ctx.lineTo(tp.x, tp.y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- тела
// b: {r, col, type, bands?, atmo?, axis?}; px,py — экран; rpx — радиус в px;
// L — единичный вектор «тело -> Солнце» в координатах камеры (z — к зрителю)
const axC = { x: 0, y: 0, z: 0 };
function drawBody(b, px, py, rpx, L) {
  if (rpx < 0.8) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = b.col[1];
    ctx.beginPath();
    ctx.arc(px, py, Math.max(rpx, 0.45), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  const lx = L.x, ly = -L.y, lz = L.z; // экранное направление на Солнце
  const litX = px + lx * rpx, litY = py + ly * rpx;

  // атмосферное гало
  if (b.atmo && rpx > 2) {
    const ga = ctx.createRadialGradient(px, py, rpx * 0.55, px, py, rpx * 1.55);
    ga.addColorStop(0, 'rgba(0,0,0,0)');
    ga.addColorStop(0.62, b.atmo);
    ga.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 + 0.5 * Math.max(0, lz);
    ctx.fillStyle = ga;
    ctx.beginPath();
    ctx.arc(px, py, rpx * 1.55, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // базовый диск
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, rpx, 0, TAU);
  ctx.clip();
  if (b.bands && rpx > 2.5) {
    // газовый гигант: полосы вдоль оси вращения
    toCam(b.axis.x, b.axis.y, b.axis.z, axC);
    let ax = axC.x, ay = -axC.y;
    const al = Math.hypot(ax, ay);
    if (al < 0.05) { ax = 0; ay = -1; } else { ax /= al; ay /= al; }
    const g = ctx.createLinearGradient(px - ax * rpx, py - ay * rpx, px + ax * rpx, py + ay * rpx);
    for (const st of b.bands) g.addColorStop(st[1], st[0]);
    ctx.fillStyle = g;
    ctx.fillRect(px - rpx, py - rpx, rpx * 2, rpx * 2);
    // потемнение лимба
    const gl = ctx.createRadialGradient(px, py, rpx * 0.55, px, py, rpx);
    gl.addColorStop(0, 'rgba(8,10,22,0)');
    gl.addColorStop(1, 'rgba(8,10,22,0.42)');
    ctx.fillStyle = gl;
    ctx.fillRect(px - rpx, py - rpx, rpx * 2, rpx * 2);
  } else {
    // каменная планета / луна: сдвинутый к свету градиент
    const gx = px + lx * rpx * 0.4, gy = py + ly * rpx * 0.4;
    const g = ctx.createRadialGradient(gx, gy, rpx * 0.1, px, py, rpx);
    g.addColorStop(0, b.col[0]);
    g.addColorStop(0.62, b.col[1]);
    g.addColorStop(1, b.col[2]);
    ctx.fillStyle = g;
    ctx.fillRect(px - rpx, py - rpx, rpx * 2, rpx * 2);
  }

  // терминатор: ночная сторона (центр градиента — освещённая точка лимба)
  const mid = clamp(0.5 + lz * 0.48, 0.02, 0.98);
  const gt = ctx.createRadialGradient(litX, litY, 0, litX, litY, rpx * 2.05);
  gt.addColorStop(0, 'rgba(6,9,22,0)');
  gt.addColorStop(clamp(mid - 0.17, 0, 1), 'rgba(6,9,22,0)');
  gt.addColorStop(clamp(mid + 0.06, 0, 1), 'rgba(5,7,18,0.83)');
  gt.addColorStop(1, 'rgba(3,4,12,0.96)');
  ctx.fillStyle = gt;
  ctx.fillRect(px - rpx, py - rpx, rpx * 2, rpx * 2);

  // дневной отблеск
  const hi = Math.max(0, 0.2 + 0.8 * lz);
  if (hi > 0.02) {
    const gh = ctx.createRadialGradient(litX, litY, 0, litX, litY, rpx * 1.45);
    gh.addColorStop(0, 'rgba(255,250,235,' + (0.28 * hi).toFixed(3) + ')');
    gh.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gh;
    ctx.fillRect(px - rpx, py - rpx, rpx * 2, rpx * 2);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

// ---------------------------------------------------------------- кольца
const rc = { x: 0, y: 0, z: 0 }, rp = { x: 0, y: 0, d: 0, s: 0 };
const RING_SEG = 72;

// строит экранный контур окружности радиуса R в плоскости колец
function ringLoop(p, R) {
  const u = { x: p.axis.y, y: -p.axis.x, z: 0 }; // ⊥ оси, единичный (axis.z = 0)
  const v = { x: 0, y: 0, z: -1 };
  const pts = [];
  for (let k = 0; k < RING_SEG; k++) {
    const th = TAU * k / RING_SEG;
    const ct = Math.cos(th), st = Math.sin(th);
    const wx = p.pos.x + (u.x * ct + v.x * st) * R;
    const wy = p.pos.y + (u.y * ct + v.y * st) * R;
    const wz = p.pos.z + (u.z * ct + v.z * st) * R;
    toCam(wx, wy, wz, rc);
    project(rc, rp);
    pts.push(rp.x, rp.y, rc.z); // x, y, zКам
  }
  return pts;
}

function ringPath(outer, inner) {
  const path = new Path2D();
  path.moveTo(outer[0], outer[1]);
  for (let k = 1; k < RING_SEG; k++) path.lineTo(outer[k * 3], outer[k * 3 + 1]);
  path.closePath();
  path.moveTo(inner[0], inner[1]);
  for (let k = RING_SEG - 1; k >= 1; k--) path.lineTo(inner[k * 3], inner[k * 3 + 1]);
  path.closePath();
  return path;
}

// рисует половину колец: front=true — ближнюю к зрителю, иначе дальнюю
function drawRingHalf(p, planetScr, planetCamZ, paths, alphas, cols, front) {
  // направление линии раздела: точки кольца с zКам == z планеты
  const u = { x: p.axis.y, y: -p.axis.x, z: 0 };
  toCam(u.x, u.y, u.z, rc);
  const A = rc.z;
  toCam(0, 0, -1, rc);
  const B = rc.z;
  const th0 = Math.atan2(-A, B);
  // экранное направление раздела
  const R0 = p.ring.bands[1].r2;
  const c0 = Math.cos(th0), s0 = Math.sin(th0);
  const dwx = (u.x * c0) * R0, dwy = (u.y * c0) * R0, dwz = (u.z * c0 - s0) * R0;
  toCam(p.pos.x + dwx, p.pos.y + dwy, p.pos.z + dwz, rc);
  project(rc, rp);
  const dx = rp.x - planetScr.x, dy = rp.y - planetScr.y;
  const phi = Math.atan2(dy, dx);
  // передняя точка (zКам больше, чем у планеты)
  let thF = th0 + Math.PI / 2;
  if (A * Math.cos(thF) + B * Math.sin(thF) < 0) thF = th0 - Math.PI / 2;
  const cf = Math.cos(thF), sf = Math.sin(thF);
  toCam(p.pos.x + u.x * cf * R0, p.pos.y + u.y * cf * R0, p.pos.z + (u.z * cf - sf) * R0, rc);
  project(rc, rp);
  const nfx = rp.x - planetScr.x, nfy = rp.y - planetScr.y;
  const localY = -Math.sin(phi) * nfx + Math.cos(phi) * nfy; // сторона «переда»
  const wantPos = front ? (localY > 0) : (localY <= 0);

  ctx.save();
  ctx.translate(planetScr.x, planetScr.y);
  ctx.rotate(phi);
  ctx.beginPath();
  const BIG = Math.max(W, H) * 2;
  if (wantPos) ctx.rect(-BIG, -0.5, BIG * 2, BIG);
  else ctx.rect(-BIG, -BIG, BIG * 2, BIG + 0.5);
  ctx.clip();
  ctx.rotate(-phi);
  ctx.translate(-planetScr.x, -planetScr.y);
  for (let k = 0; k < paths.length; k++) {
    ctx.globalAlpha = alphas[k];
    ctx.fillStyle = cols[k];
    ctx.fill(paths[k], 'evenodd');
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// подготовка данных колец на кадр
function buildRings(p) {
  // освещённость: угол между осью (нормалью колец) и направлением на Солнце
  const dl = Math.hypot(p.pos.x, p.pos.y, p.pos.z) || 1;
  const dot = Math.abs((p.axis.x * -p.pos.x + p.axis.y * -p.pos.y + p.axis.z * -p.pos.z) / dl);
  const lf = 0.4 + 0.6 * dot;
  const paths = [], alphas = [], cols = [];
  for (const band of p.ring.bands) {
    const outer = ringLoop(p, band.r2);
    const inner = ringLoop(p, band.r1);
    paths.push(ringPath(outer, inner));
    alphas.push(band.al * (0.55 + 0.45 * lf));
    cols.push('rgba(' + band.col + ',' + (0.72 * lf + 0.28).toFixed(3) + ')');
  }
  return { paths, alphas, cols };
}

// ---------------------------------------------------------------- Солнце
function drawSun(px, py, s, t) {
  const r = Math.max(SUN.r * s, 6) * (1 + 0.015 * Math.sin(t * 2.3) + 0.008 * Math.sin(t * 5.7));
  ctx.globalCompositeOperation = 'lighter';
  // дальняя корона
  let g = ctx.createRadialGradient(px, py, 0, px, py, r * 9);
  g.addColorStop(0, 'rgba(255,150,60,0.18)');
  g.addColorStop(0.35, 'rgba(255,120,45,0.05)');
  g.addColorStop(1, 'rgba(255,100,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(px, py, r * 9, 0, TAU); ctx.fill();
  // средняя корона (слегка «дышит»)
  const r2 = r * (3.1 + 0.25 * Math.sin(t * 0.9));
  g = ctx.createRadialGradient(px, py, 0, px, py, r2);
  g.addColorStop(0, 'rgba(255,200,110,0.5)');
  g.addColorStop(0.55, 'rgba(255,160,70,0.12)');
  g.addColorStop(1, 'rgba(255,140,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(px, py, r2, 0, TAU); ctx.fill();
  // горизонтальный кинематографичный блик
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(6.5, 0.55);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
  g.addColorStop(0, 'rgba(255,210,140,0.14)');
  g.addColorStop(1, 'rgba(255,210,140,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, TAU); ctx.fill();
  ctx.restore();
  // ядро
  g = ctx.createRadialGradient(px, py, 0, px, py, r * 1.15);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.38, '#fff6d5');
  g.addColorStop(0.72, '#ffc866');
  g.addColorStop(1, 'rgba(255,150,50,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(px, py, r * 1.15, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------- кадр
for (const p of PLANETS) {
  p.camc = { x: 0, y: 0, z: 0 };
  p.scr = { x: 0, y: 0, d: 0, s: 0 };
  if (p.moons) for (const m of p.moons) {
    m.pos = { x: 0, y: 0, z: 0 };
    m.camc = { x: 0, y: 0, z: 0 };
    m.scr = { x: 0, y: 0, d: 0, s: 0 };
  }
}
const sunC = { x: 0, y: 0, z: 0 }, sunS = { x: 0, y: 0, d: 0, s: 0 };

const ui = { trails: true, orbits: true, labels: true };
let running = true, speed = 1, simT = 0;

function lightOf(camc, out) {
  const inv = 1 / (Math.hypot(camc.x, camc.y, camc.z) || 1);
  out.x = -camc.x * inv; out.y = -camc.y * inv; out.z = -camc.z * inv;
  return out;
}

function makeBodyDraw(b, scr, camc, rpx) {
  return () => {
    const l = lightOf(camc, { x: 0, y: 0, z: 0 });
    if (b.ring && rpx > 2.2) {
      const R = buildRings(b);
      drawRingHalf(b, scr, camc.z, R.paths, R.alphas, R.cols, false);
      drawBody(b, scr.x, scr.y, rpx, l);
      drawRingHalf(b, scr, camc.z, R.paths, R.alphas, R.cols, true);
    } else {
      drawBody(b, scr.x, scr.y, rpx, l);
    }
  };
}

function drawLabels() {
  ctx.font = '500 11px system-ui, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  if (sunS.d > 70) {
    ctx.fillStyle = 'rgba(255,220,160,0.85)';
    ctx.fillText(SUN.name, sunS.x + SUN.r * sunS.s * 0.75 + 8, sunS.y - SUN.r * sunS.s * 0.55);
  }
  ctx.fillStyle = 'rgba(200,216,248,0.82)';
  for (const p of PLANETS) {
    if (p.scr.d <= 70) continue;
    const rpx = p.r * p.scr.s;
    const lx = p.scr.x + rpx + 7, ly = p.scr.y - rpx - 4;
    if (lx < -60 || lx > W + 10 || ly < -10 || ly > H + 10) continue;
    ctx.fillText(p.name, lx, ly);
  }
  ctx.font = '400 10px system-ui, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(185,200,235,0.5)';
  for (const p of PLANETS) {
    if (!p.moons) continue;
    for (const m of p.moons) {
      if (m.scr.d <= 70) continue;
      const mr = m.r * m.scr.s;
      if (mr < 1.35) continue;
      ctx.fillText(m.name, m.scr.x + mr + 5, m.scr.y - mr - 3);
    }
  }
}

function render(t, simY) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#070a16');
  bg.addColorStop(0.5, '#04060d');
  bg.addColorStop(1, '#020308');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  drawSky(t);

  // позиции всех тел
  for (const p of PLANETS) {
    planetPosAt(p, simY, p.pos);
    toCam(p.pos.x, p.pos.y, p.pos.z, p.camc);
    project(p.camc, p.scr);
    if (p.moons) for (const m of p.moons) {
      const th = TAU * (simT / m.Ts) + m.ph;
      const ir = m.i * D2R;
      m.pos.x = p.pos.x + Math.cos(th) * m.a;
      m.pos.z = p.pos.z + Math.sin(th) * m.a * Math.cos(ir);
      m.pos.y = p.pos.y + Math.sin(th) * m.a * Math.sin(ir);
      toCam(m.pos.x, m.pos.y, m.pos.z, m.camc);
      project(m.camc, m.scr);
    }
  }

  if (ui.orbits) drawOrbits();
  if (ui.trails) drawTrails(simY);

  // сортировка по глубине: дальние раньше
  const items = [];
  toCam(0, 0, 0, sunC);
  project(sunC, sunS);
  if (sunS.d > 70) items.push({ d: sunS.d, f: () => drawSun(sunS.x, sunS.y, sunS.s, t) });

  for (const p of PLANETS) {
    if (p.scr.d > 70) {
      const rpx = p.r * p.scr.s;
      const marg = (p.ring ? rpx * 2.6 : rpx * 1.8) + 60;
      if (p.scr.x > -marg && p.scr.x < W + marg && p.scr.y > -marg && p.scr.y < H + marg) {
        items.push({ d: p.scr.d, f: makeBodyDraw(p, p.scr, p.camc, rpx) });
      }
    }
    if (p.moons) for (const m of p.moons) {
      if (m.scr.d <= 70) continue;
      const mr = m.r * m.scr.s;
      if (m.scr.x < -60 || m.scr.x > W + 60 || m.scr.y < -60 || m.scr.y > H + 60) continue;
      items.push({ d: m.scr.d, f: makeBodyDraw(m, m.scr, m.camc, mr) });
    }
  }
  items.sort((a, b) => b.d - a.d);
  for (const it of items) it.f();

  if (ui.labels) drawLabels();
}

// ---------------------------------------------------------------- цикл
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt < 0) dt = 0;
  if (dt > 0.05) dt = 0.05; // кламп большого dt (сон вкладки и т.п.)

  cam.t += dt;
  if (running) simT += dt * speed;
  if (cam.auto && !dragging) cam.yaw += cam.spin * dt;
  if (!dragging) {
    cam.yaw += cam.vyaw;
    cam.pitch = clamp(cam.pitch + cam.vpitch, -1.35, 1.35);
    const damp = Math.exp(-dt * 2.4);
    cam.vyaw *= damp;
    cam.vpitch *= damp;
  }
  updateCamFrame();

  const simY = simT / YEAR;
  updateTrails(simY);
  render(cam.t, simY);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- UI
const $ = id => document.getElementById(id);

const btnPause = $('btnPause');
btnPause.addEventListener('click', () => {
  running = !running;
  btnPause.textContent = running ? '⏸ Пауза' : '▶ Пуск';
});

const speedEl = $('speed'), speedVal = $('speedVal');
function fmtSpeed(s) {
  return '×' + (s >= 10 ? Math.round(s) : s >= 1 ? s.toFixed(1) : s.toFixed(2));
}
speedEl.addEventListener('input', () => {
  speed = Math.pow(10, parseFloat(speedEl.value));
  speedVal.textContent = fmtSpeed(speed);
});

const zoomEl = $('zoom'), zoomVal = $('zoomVal');
function syncZoomUI() {
  zoomEl.value = cam.zoom.toFixed(2);
  zoomVal.textContent = '×' + cam.zoom.toFixed(2);
}
zoomEl.addEventListener('input', () => {
  cam.zoom = parseFloat(zoomEl.value);
  zoomVal.textContent = '×' + cam.zoom.toFixed(2);
});

function bindChip(id, get, set) {
  const el = $(id);
  el.addEventListener('click', () => {
    set(!get());
    el.classList.toggle('on', get());
  });
}
bindChip('tglTrails', () => ui.trails, v => { ui.trails = v; });
bindChip('tglOrbits', () => ui.orbits, v => { ui.orbits = v; });
bindChip('tglLabels', () => ui.labels, v => { ui.labels = v; });
bindChip('tglSpin', () => cam.auto, v => { cam.auto = v; });

// перетаскивание и колесо
let dragging = false, px0 = 0, py0 = 0;
canvas.addEventListener('pointerdown', e => {
  dragging = true;
  canvas.classList.add('dragging');
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
  px0 = e.clientX; py0 = e.clientY;
  cam.vyaw = 0; cam.vpitch = 0;
});
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - px0, dy = e.clientY - py0;
  px0 = e.clientX; py0 = e.clientY;
  cam.yaw += dx * 0.005;
  cam.pitch = clamp(cam.pitch + dy * 0.004, -1.35, 1.35);
  cam.vyaw = dx * 0.005;
  cam.vpitch = dy * 0.004;
});
const endDrag = () => { dragging = false; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cam.zoom = clamp(cam.zoom * Math.exp(-e.deltaY * 0.0011), 0.3, 3.5);
  syncZoomUI();
}, { passive: false });

syncZoomUI();
requestAnimationFrame(frame);
})();
