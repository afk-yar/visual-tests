/* «Аквариум с рыбами» — Claude Fable 5
   Процедурная подводная сцена на Canvas 2D: рыбы со спинальной волновой
   анимацией, стайное поведение (боиды), каустики на дне, лучи света,
   пузырьки, водоросли, взвесь, глубинная дымка. Без внешних ресурсов. */
(() => {
'use strict';

// ---------- утилиты ----------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// кратчайшая интерполяция угла
function angleLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

// детерминированный ГПСЧ для статичных слоёв (стабилен между resize)
function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// плавный «блуждающий» шум: сумма синусов со случайными фазами
function makeWander(scale) {
  const f = [rand(0.13, 0.21), rand(0.31, 0.47), rand(0.53, 0.71)];
  const p = [rand(0, TAU), rand(0, TAU), rand(0, TAU)];
  return (t) => scale * (
    0.55 * Math.sin(f[0] * t + p[0]) +
    0.30 * Math.sin(f[1] * t + p[1]) +
    0.15 * Math.sin(f[2] * t + p[2]));
}

// цвет: подмешивание цвета воды по глубине (дымка расстояния)
const WATER_RGB = [42, 110, 122];
function hexRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function fogMix(h, k) {
  const c = hexRgb(h);
  return [
    Math.round(lerp(c[0], WATER_RGB[0], k)),
    Math.round(lerp(c[1], WATER_RGB[1], k)),
    Math.round(lerp(c[2], WATER_RGB[2], k)),
  ];
}
function fogHex(h, k) {
  const m = fogMix(h, k);
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}
function fogRgba(h, a, k) {
  const m = fogMix(h, k);
  return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
}

// замкнутый сглаженный контур через средние точки (работает и с Path2D)
function closedSmooth(path, pts) {
  const n = pts.length;
  path.moveTo((pts[0].x + pts[n - 1].x) / 2, (pts[0].y + pts[n - 1].y) / 2);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    path.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
}

// ---------- холст и состояние мира ----------
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');

let W = 0, H = 0, DPR = 1;
let FLOOR = 0;          // y песчаного дна
let time = 0;           // мировое время, с
let paused = false;
let current = 0.35;     // сила течения 0..1

// ---------- статичный фон (вода + дно + камни), пере-рендер на resize ----------
const bgCanvas = document.createElement('canvas');

function buildStatic() {
  bgCanvas.width = canvas.width;
  bgCanvas.height = canvas.height;
  const g = bgCanvas.getContext('2d');
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const srand = mulberry(20260702);
  const sr = (a, b) => a + srand() * (b - a);

  // вертикальный градиент глубины: тёплая светлая бирюза -> глубокий тёмный teal
  const wg = g.createLinearGradient(0, 0, 0, H);
  wg.addColorStop(0, '#54c2c6');
  wg.addColorStop(0.28, '#1e8fa0');
  wg.addColorStop(0.6, '#0b5266');
  wg.addColorStop(0.85, '#053343');
  wg.addColorStop(1, '#02222e');
  g.fillStyle = wg;
  g.fillRect(0, 0, W, H);

  // боковое затемнение
  const hg = g.createLinearGradient(0, 0, W, 0);
  hg.addColorStop(0, 'rgba(2,18,26,0.4)');
  hg.addColorStop(0.5, 'rgba(2,18,26,0)');
  hg.addColorStop(1, 'rgba(2,18,26,0.4)');
  g.fillStyle = hg;
  g.fillRect(0, 0, W, H);

  // дальний рельеф (силуэт рифа) над линией дна
  g.fillStyle = 'rgba(6,40,48,0.65)';
  g.beginPath();
  g.moveTo(-10, FLOOR + 16);
  const hn = 40;
  for (let i = 0; i <= hn; i++) {
    const x = (W * i) / hn;
    const hh = 26 + Math.sin(i * 0.9 + 0.7) * 18 + Math.sin(i * 2.3) * 10;
    g.lineTo(x, FLOOR + 16 - hh);
  }
  g.lineTo(W + 10, FLOOR + 16);
  g.closePath();
  g.fill();

  // песчаное дно с волнистой кромкой
  const en = 12;
  const edge = [];
  for (let i = 0; i <= en; i++) {
    edge.push({ x: (W * i) / en, y: FLOOR + 12 + Math.sin(i * 1.7 + 2) * 6 + Math.cos(i * 0.8) * 4 });
  }
  const sg = g.createLinearGradient(0, FLOOR - 20, 0, H);
  sg.addColorStop(0, '#7d6f52');
  sg.addColorStop(0.45, '#5a523e');
  sg.addColorStop(1, '#302c20');
  g.fillStyle = sg;
  g.beginPath();
  g.moveTo(-10, edge[0].y);
  for (let i = 0; i < en; i++) {
    const mx = (edge[i].x + edge[i + 1].x) / 2;
    const my = (edge[i].y + edge[i + 1].y) / 2;
    g.quadraticCurveTo(edge[i].x, edge[i].y, mx, my);
  }
  g.lineTo(W + 10, edge[en].y);
  g.lineTo(W + 10, H + 10);
  g.lineTo(-10, H + 10);
  g.closePath();
  g.fill();

  // песчинки
  const grains = Math.floor(W / 3);
  for (let i = 0; i < grains; i++) {
    const x = sr(0, W), y = sr(FLOOR + 20, H);
    g.fillStyle = srand() < 0.5 ? 'rgba(255,240,210,0.10)' : 'rgba(30,25,15,0.14)';
    g.fillRect(x, y, sr(1, 2.4), sr(1, 2));
  }

  // рябь на песке
  for (let i = 0; i < 10; i++) {
    const y = sr(FLOOR + 18, H - 6);
    g.strokeStyle = 'rgba(20,18,10,0.10)';
    g.lineWidth = sr(1, 2.5);
    g.beginPath();
    const x0 = sr(-40, W * 0.5);
    const len = sr(W * 0.2, W * 0.6);
    g.moveTo(x0, y);
    for (let k = 1; k <= 8; k++) {
      g.lineTo(x0 + (len * k) / 8, y + Math.sin(k * 1.3 + i) * 2.5);
    }
    g.stroke();
  }

  // камни (тень, потом сам камень)
  for (let i = 0; i < 7; i++) {
    const x = sr(0.04, 0.96) * W;
    const rx = sr(14, 44), ry = rx * sr(0.5, 0.75);
    const y = FLOOR + sr(6, 18);
    g.beginPath();
    g.ellipse(x, y + ry * 0.55, rx * 1.05, ry * 0.4, 0, 0, TAU);
    g.fillStyle = 'rgba(10,15,20,0.25)';
    g.fill();
    const rg = g.createRadialGradient(x - rx * 0.3, y - ry * 0.5, ry * 0.2, x, y, rx * 1.1);
    rg.addColorStop(0, '#6b6a63');
    rg.addColorStop(0.7, '#4a4a45');
    rg.addColorStop(1, '#33332f');
    g.beginPath();
    g.ellipse(x, y, rx, ry, sr(-0.15, 0.15), 0, TAU);
    g.fillStyle = rg;
    g.fill();
  }
}

// ---------- каустики: низкорезный ImageData, растянутый по дну ----------
const causCanvas = document.createElement('canvas');
const CW = 192, CH = 56;
causCanvas.width = CW;
causCanvas.height = CH;
const causCtx = causCanvas.getContext('2d');
const causImg = causCtx.createImageData(CW, CH);

function renderCaustics(t) {
  // яркая тонкая «сеточка»: гребни у нулевых линий суммы трёх синусов
  const d = causImg.data;
  const tt = t * 1.1;
  let idx = 0;
  for (let y = 0; y < CH; y++) {
    const v = y / CH;
    const fade = Math.pow(Math.sin(v * Math.PI), 0.55);
    const vv = v * 3.2;
    for (let x = 0; x < CW; x++) {
      const u = (x / CW) * 18 + tt * 0.35;
      const s1 = Math.sin(u * 1.9 + tt * 1.4 + Math.sin(vv * 2.1 - tt * 0.9) * 1.7);
      const s2 = Math.sin(vv * 2.8 - tt * 1.1 + Math.sin(u * 1.2 + tt * 0.7) * 1.9);
      const s3 = Math.sin((u + vv) * 1.6 + tt * 0.6);
      const m = (s1 + s2 + s3) * 0.3333;
      let b = 1 - Math.abs(m);
      b = b * b * b;
      b = b * b * 1.35 + Math.max(0, m) * Math.max(0, m) * 0.12;
      d[idx] = 255;
      d[idx + 1] = 244;
      d[idx + 2] = 198;
      d[idx + 3] = b * fade * 320;
      idx += 4;
    }
  }
}

function drawCaustics() {
  renderCaustics(time);
  causCtx.putImageData(causImg, 0, 0);
  const y0 = FLOOR - 6;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.95;
  ctx.drawImage(causCanvas, 0, y0, W, H - y0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.3;
  ctx.drawImage(causCanvas, 0, y0, W, H - y0);
  ctx.restore();
}

// ---------- лучи света ----------
const rays = [];

function initRays() {
  rays.length = 0;
  for (let i = 0; i < 7; i++) {
    rays.push({
      x: rand(0.08, 0.92),
      w: rand(0.06, 0.16),
      slant: rand(-0.12, 0.2),
      sway: makeWander(0.05),
      alpha: rand(0.10, 0.20),
      len: rand(0.55, 0.95),
      flick: rand(0.4, 1.1),
      ph: rand(0, TAU),
    });
  }
}

// геометрия лучей текущего кадра (для отрисовки и подсветки рыб)
let rayCache = [];

function computeRays(t) {
  rayCache = rays.map((r) => {
    const topX = r.x * W + r.sway(t) * W * 0.22;
    const slant = r.slant + r.sway(t * 0.7) * 0.5;
    const y1 = H * r.len;
    const a = r.alpha * (0.65 + 0.35 * Math.sin(t * r.flick + r.ph));
    return { topX, slant, y1, w0: r.w * W, w1: r.w * W * 2.6, a };
  });
}

// суммарная интенсивность света лучей в точке (0..~0.4)
function rayLightAt(x, y) {
  let l = 0;
  for (const c of rayCache) {
    if (y > c.y1) continue;
    const cx = c.topX + c.slant * y;
    const half = (c.w0 + (c.w1 - c.w0) * (y / c.y1)) * 0.5;
    const dx = Math.abs(x - cx);
    if (dx < half) l += c.a * (1 - dx / half) * (1 - y / c.y1);
  }
  return l;
}

function drawRays() {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const c of rayCache) {
    const bx = c.topX + c.slant * c.y1;
    const gr = ctx.createLinearGradient(c.topX, 0, bx, c.y1);
    gr.addColorStop(0, `rgba(205,242,255,${c.a})`);
    gr.addColorStop(0.35, `rgba(185,232,250,${c.a * 0.55})`);
    gr.addColorStop(1, 'rgba(185,232,250,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(c.topX - c.w0 / 2, -10);
    ctx.lineTo(c.topX + c.w0 / 2, -10);
    ctx.lineTo(bx + c.w1 / 2, c.y1);
    ctx.lineTo(bx - c.w1 / 2, c.y1);
    ctx.closePath();
    ctx.fill();
  }
  // общее тёплое свечение от поверхности
  const tg = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  tg.addColorStop(0, 'rgba(170,235,235,0.30)');
  tg.addColorStop(1, 'rgba(170,235,235,0)');
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, W, H * 0.4);
  ctx.restore();
}

// ---------- водоросли ----------
let weeds = [];

function initWeeds() {
  weeds = [];
  const groups = [[0.06, 5], [0.13, 3], [0.30, 2], [0.62, 2], [0.84, 4], [0.93, 4]];
  for (const [gx, n] of groups) {
    for (let i = 0; i < n; i++) {
      const z = Math.random() < 0.45 ? rand(0.55, 0.95) : rand(0.1, 0.5);
      weeds.push({
        xf: gx + rand(-0.035, 0.035),
        hf: rand(0.18, 0.52) * (z > 0.5 ? 1.15 : 1),
        segs: 12,
        w: rand(2.2, 4.6) * (z > 0.5 ? 1.2 : 1),
        freq: rand(0.7, 1.3),
        ph: rand(0, TAU),
        amp: rand(0.06, 0.13),
        lean: rand(-0.12, 0.12),
        z,
        c0: z > 0.5 ? `hsl(${rand(160, 190) | 0}, 35%, ${rand(8, 13) | 0}%)` : `hsl(${rand(135, 160) | 0}, 45%, ${rand(13, 20) | 0}%)`,
        c1: z > 0.5 ? `hsl(${rand(160, 190) | 0}, 30%, ${rand(20, 28) | 0}%)` : `hsl(${rand(120, 150) | 0}, 50%, ${rand(30, 42) | 0}%)`,
      });
    }
  }
  weeds.sort((a, b) => b.z - a.z);
}

function drawWeed(w) {
  const x0 = w.xf * W;
  const h = w.hf * FLOOR;
  const segs = w.segs;
  const step = h / segs;
  let x = x0, y = FLOOR + 6;
  let ang = -Math.PI / 2 + w.lean;
  const ptsL = [], ptsR = [];
  for (let i = 0; i <= segs; i++) {
    const width = w.w * (1 - (i / segs) * 0.85);
    const nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);
    ptsL.push({ x: x - nx * width, y: y - ny * width });
    ptsR.push({ x: x + nx * width, y: y + ny * width });
    const sway = Math.sin(time * w.freq + i * 0.5 + w.ph) * w.amp * (i / segs) + current * 0.7 * (i / segs);
    ang = -Math.PI / 2 + w.lean + sway;
    x += Math.cos(ang) * step;
    y += Math.sin(ang) * step;
  }
  const gr = ctx.createLinearGradient(0, FLOOR + 6, 0, FLOOR - h);
  gr.addColorStop(0, w.c0);
  gr.addColorStop(1, w.c1);
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.moveTo(ptsL[0].x, ptsL[0].y);
  for (let i = 1; i <= segs; i++) ctx.lineTo(ptsL[i].x, ptsL[i].y);
  for (let i = segs; i >= 0; i--) ctx.lineTo(ptsR[i].x, ptsR[i].y);
  ctx.closePath();
  ctx.fill();
}

function drawWeeds(back) {
  for (const w of weeds) {
    if (back !== (w.z > 0.5)) continue;
    drawWeed(w);
  }
}

// ---------- пузырьки ----------
let bubbles = [];
let emitters = [];

function initEmitters() {
  emitters = [
    { xf: 0.18, min: 0.5, max: 2.2, t: 1 },
    { xf: 0.52, min: 1.2, max: 3.5, t: 2 },
    { xf: 0.87, min: 0.4, max: 1.8, t: 0.5 },
  ];
}

function spawnBubble(x, y, r) {
  bubbles.push({
    x, y, r,
    vy: rand(26, 50),
    wob: rand(0, TAU),
    wobSp: rand(2, 4),
    wobAmp: rand(4, 10),
    a: rand(0.35, 0.75),
    dead: false,
  });
}

function burstBubbles(x, y, n) {
  for (let i = 0; i < n; i++) spawnBubble(x + rand(-3, 3), y + rand(-3, 3), rand(0.8, 1.8));
}

function updateBubbles(dt) {
  for (const e of emitters) {
    e.t -= dt;
    if (e.t <= 0) {
      e.t = rand(e.min, e.max);
      spawnBubble(e.xf * W + rand(-6, 6), FLOOR + rand(-4, 4), rand(1.2, 3.4));
      if (Math.random() < 0.12) {
        for (let i = 0; i < 4; i++) spawnBubble(e.xf * W + rand(-8, 8), FLOOR + rand(-4, 2), rand(1, 2.4));
      }
    }
  }
  for (const b of bubbles) {
    b.y -= (b.vy + b.r * 6) * dt;
    b.wob += b.wobSp * dt;
    b.x += Math.sin(b.wob) * b.wobAmp * dt * 3 + current * 22 * dt;
    b.r += dt * 0.7;
    if (b.y < 14 || b.x > W + 20) b.dead = true;
  }
  bubbles = bubbles.filter((b) => !b.dead);
  if (bubbles.length > 220) bubbles.splice(0, bubbles.length - 220);
}

function drawBubbles() {
  ctx.save();
  for (const b of bubbles) {
    ctx.globalAlpha = b.a * clamp(b.y / 120, 0.15, 1);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.strokeStyle = 'rgba(200,235,255,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const gr = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
    gr.addColorStop(0, 'rgba(220,245,255,0.5)');
    gr.addColorStop(0.7, 'rgba(190,225,250,0.06)');
    gr.addColorStop(1, 'rgba(190,225,250,0.18)');
    ctx.fillStyle = gr;
    ctx.fill();
  }
  ctx.restore();
}

// ---------- взвесь (планктон / «морской снег») ----------
let motes = [];

function initMotes() {
  motes = [];
  const n = clamp(((W * H) / 18000) | 0, 50, 150);
  for (let i = 0; i < n; i++) {
    motes.push({ x: Math.random() * W, y: Math.random() * H, z: Math.random(), ph: rand(0, TAU) });
  }
}

function updateMotes(dt) {
  for (const m of motes) {
    m.y += (3 + m.z * 7) * dt;
    m.x += (current * (4 + 14 * (1 - m.z)) + Math.sin(time * 0.6 + m.ph) * 3) * dt;
    if (m.y > H + 4) { m.y = -4; m.x = Math.random() * W; }
    if (m.x > W + 4) m.x = -4;
    else if (m.x < -4) m.x = W + 4;
  }
}

function drawMotes() {
  ctx.save();
  ctx.fillStyle = 'rgba(190,220,235,1)';
  for (const m of motes) {
    ctx.globalAlpha = 0.04 + (1 - m.z) * 0.10;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 0.5 + (1 - m.z) * 1.1, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- корм ----------
let foods = [];

function feed() {
  const cx = rand(W * 0.2, W * 0.8);
  for (let i = 0; i < 16; i++) {
    foods.push({
      x: cx + rand(-80, 80),
      y: rand(-40, -6),
      vx: rand(-5, 5),
      vy: rand(5, 15),
      sink: rand(14, 26),
      ph: rand(0, TAU),
      r: rand(1.5, 2.6),
      life: 1,
      dead: false,
    });
  }
  if (foods.length > 90) foods.splice(0, foods.length - 90);
}

function nearestFood(x, y, radius) {
  let best = null, bd = radius * radius;
  for (const f of foods) {
    if (f.dead) continue;
    const dx = f.x - x, dy = f.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = f; }
  }
  return best;
}

function updateFood(dt) {
  for (const f of foods) {
    if (f.dead) continue;
    f.vy = Math.min(f.vy + 8 * dt, f.sink);
    f.y += f.vy * dt;
    f.x += (f.vx + current * 8 + Math.sin(time * 2.3 + f.ph) * 4) * dt;
    if (f.y > FLOOR + 6) {
      f.y = FLOOR + 6;
      f.life -= dt * 0.35;
      if (f.life <= 0) f.dead = true;
    }
  }
  foods = foods.filter((f) => !f.dead);
}

function drawFood() {
  if (!foods.length) return;
  ctx.save();
  for (const f of foods) {
    const a = clamp(f.life, 0, 1) * 0.9;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#e9bd6f';
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = a * 0.35;
    ctx.fillStyle = '#fff0c8';
    ctx.beginPath();
    ctx.arc(f.x - f.r * 0.3, f.y - f.r * 0.3, f.r * 0.5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- виды рыб ----------
// profile: полутолщина тела вдоль хребта (9 сэмплов, голова -> хвост)
const SPECIES = [
  {
    id: 'koi', count: 3,
    size: [70, 95], ratio: 0.30, speed: [24, 40],
    waveAmp: 0.085, waveFreq: 4.6, zRange: [0.05, 0.5],
    profile: [0.34, 0.55, 0.64, 0.62, 0.53, 0.40, 0.27, 0.15, 0.09],
    tail: { type: 'fan', len: 0.34, spread: 0.62 },
    dorsal: 0.35, turnRate: 2.8,
    palette() {
      return pick([
        { back: '#ece5d2', belly: '#fbf7ec', fins: '#f2c8a4', finsA: 0.65, patch: '#d64518' },
        { back: '#e89417', belly: '#f6cf6e', fins: '#f2c46a', finsA: 0.6, patch: '#a9520e' },
        { back: '#d9dade', belly: '#f4f5f7', fins: '#e4e6ea', finsA: 0.55, patch: '#333a45' },
      ]);
    },
  },
  {
    id: 'angel', count: 2,
    size: [54, 66], ratio: 0.62, speed: [18, 30],
    waveAmp: 0.05, waveFreq: 3.6, zRange: [0.15, 0.6],
    profile: [0.22, 0.60, 0.92, 1.00, 0.86, 0.58, 0.34, 0.16, 0.08],
    tail: { type: 'fork', len: 0.30, spread: 0.5 },
    dorsal: 0, turnRate: 2.2, angelFins: true, stripes: [0.28, 0.48, 0.68],
    palette() {
      return pick([
        { back: '#c8cdd6', belly: '#eef1f4', fins: '#dfe4ec', finsA: 0.5, stripe: '#252b33' },
        { back: '#d8c98e', belly: '#f2ead0', fins: '#e8dcae', finsA: 0.5, stripe: '#3a3428' },
      ]);
    },
  },
  {
    id: 'tang', count: 3,
    size: [40, 52], ratio: 0.42, speed: [34, 56],
    waveAmp: 0.07, waveFreq: 5.6, zRange: [0.1, 0.65],
    profile: [0.30, 0.58, 0.74, 0.76, 0.68, 0.52, 0.33, 0.17, 0.09],
    tail: { type: 'fork', len: 0.26, spread: 0.55 },
    dorsal: 0.3, turnRate: 3.4, tangMark: true,
    palette() {
      return pick([
        { back: '#1f49d8', belly: '#4f83ea', fins: '#f7d637', finsA: 0.85, mark: '#101d4a' },
        { back: '#7a3fc2', belly: '#a56ee0', fins: '#f0b73a', finsA: 0.85, mark: '#2a1749' },
      ]);
    },
  },
  {
    id: 'neon', count: 0, schooling: true,
    size: [15, 20], ratio: 0.24, speed: [42, 70],
    waveAmp: 0.10, waveFreq: 8.5, zRange: [0.2, 0.5],
    profile: [0.26, 0.42, 0.50, 0.50, 0.44, 0.35, 0.24, 0.14, 0.08],
    tail: { type: 'fork', len: 0.30, spread: 0.5 },
    dorsal: 0.2, turnRate: 6,
    palette() {
      return { back: '#3a4a66', belly: '#cfd8de', fins: '#bcd0da', finsA: 0.5, glow: '#2af2ff', red: '#ff3344' };
    },
  },
];

const NEON_SPEC = SPECIES.find((s) => s.id === 'neon');

// ---------- стая (общий «якорь», за которым блуждают неоны) ----------
const school = {
  members: [],
  ax: 0, ay: 0,
  wx: makeWander(1), wy: makeWander(1),
  t: rand(0, 50),
};

function updateSchool(dt) {
  school.t += dt * 0.6;
  school.ax = W * 0.5 + school.wx(school.t) * W * 0.33;
  school.ay = clamp(H * 0.45 + school.wy(school.t * 1.13) * H * 0.3, 80, FLOOR - 80);
  if (foods.length) {
    school.ax = foods[0].x;
    school.ay = foods[0].y;
  }
}

// ---------- рыба ----------
let allFish = [];
let bigFish = [];

class Fish {
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.school = opts.school || null;
    this.len = rand(spec.size[0], spec.size[1]);
    this.z = rand(spec.zRange[0], spec.zRange[1]);
    if (this.school) {
      this.x = clamp((this.school.ax || W * 0.5) + rand(-70, 70), 40, W - 40);
      this.y = clamp((this.school.ay || H * 0.4) + rand(-50, 50), 80, FLOOR - 60);
    } else {
      this.x = rand(W * 0.15, W * 0.85);
      this.y = rand(H * 0.18, Math.max(H * 0.18 + 10, FLOOR - 80));
    }
    this.baseSpeed = rand(spec.speed[0], spec.speed[1]);
    this.heading = Math.random() < 0.5 ? 0 : Math.PI;
    this.vx = Math.cos(this.heading) * this.baseSpeed;
    this.vy = rand(-6, 6);
    this.flipT = Math.cos(this.heading) < 0 ? -1 : 1;
    this.phase = rand(0, TAU);
    this.finT = rand(0, TAU);
    this.tw = rand(0, 100);
    this.excited = 0;
    this.wanderX = makeWander(1);
    this.wanderY = makeWander(1);

    const pal = spec.palette();
    // ближние — сочные и чистые, дальние заметно растворяются в толще воды
    const k = Math.min(0.85, Math.pow(this.z, 1.15) * 0.9);
    this.c = {
      back: fogHex(pal.back, k),
      belly: fogHex(pal.belly, k),
      fins: fogRgba(pal.fins, pal.finsA, k),
      patch: pal.patch ? fogHex(pal.patch, k) : null,
      stripe: pal.stripe ? fogHex(pal.stripe, k) : null,
      mark: pal.mark ? fogRgba(pal.mark, 0.8, k) : null,
      glow: pal.glow ? fogRgba(pal.glow, 0.9, k * 0.5) : null,
      red: pal.red ? fogRgba(pal.red, 0.85, k) : null,
    };

    // пятна кои — фиксируются при создании, «едут» вместе с волной тела
    if (spec.id === 'koi' && this.c.patch) {
      this.marks = [];
      const mn = 2 + ((Math.random() * 2) | 0);
      for (let m = 0; m < mn; m++) {
        this.marks.push({
          i: 1 + ((Math.random() * 5) | 0),
          dx: rand(-4, 4),
          dy: rand(-0.5, 0.5) * this.len * 0.1,
          rx: this.len * rand(0.09, 0.16),
          ry: this.len * rand(0.06, 0.10),
          rot: rand(0, TAU),
        });
      }
    }
  }

  update(dt) {
    const spec = this.spec;
    this.tw += dt;
    this.finT += dt * (3.5 + Math.hypot(this.vx, this.vy) * 0.04);
    let ax = 0, ay = 0;

    if (this.school) {
      // боиды: разделение + выравнивание + сближение
      let sx = 0, sy = 0, cx = 0, cy = 0, avx = 0, avy = 0, n = 0;
      for (const o of this.school.members) {
        if (o === this) continue;
        const dx = o.x - this.x, dy = o.y - this.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 3200) continue;
        const d = Math.sqrt(d2) || 0.001;
        n++;
        cx += o.x; cy += o.y; avx += o.vx; avy += o.vy;
        if (d < 20) {
          const f = (20 - d) / 20;
          sx -= (dx / d) * f;
          sy -= (dy / d) * f;
        }
      }
      if (n) {
        ax += sx * 260 + (cx / n - this.x) * 1.1 + (avx / n - this.vx) * 2.2;
        ay += sy * 260 + (cy / n - this.y) * 1.1 + (avy / n - this.vy) * 2.2;
      }
      ax += (this.school.ax - this.x) * 0.7;
      ay += (this.school.ay - this.y) * 0.7;
      // мелочь шарахается от крупных рыб — стая обтекает их
      for (const b of bigFish) {
        const dx = this.x - b.x, dy = this.y - b.y;
        const rr = b.len * 1.5;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1;
          const f = ((rr - d) / rr) * 420;
          ax += (dx / d) * f;
          ay += (dy / d) * f;
        }
      }
    } else {
      // одиночное блуждание
      ax += this.wanderX(this.tw) * 30;
      ay += this.wanderY(this.tw) * 20;
      // мягкое разделение крупных
      for (const b of bigFish) {
        if (b === this) continue;
        const dx = this.x - b.x, dy = this.y - b.y;
        const d2 = dx * dx + dy * dy;
        const rr = (b.len + this.len) * 0.7;
        if (d2 < rr * rr && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = ((rr - d) / rr) * 60;
          ax += (dx / d) * f;
          ay += (dy / d) * f;
        }
      }
    }

    // корм: тяга к ближайшей крупице, поедание вблизи
    const sense = this.school ? 320 : 260;
    const f = nearestFood(this.x, this.y, sense);
    if (f) {
      const dx = f.x - this.x, dy = f.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const pull = this.school ? 220 : 130;
      ax += (dx / d) * pull;
      ay += (dy / d) * pull;
      this.excited = 1;
      if (d < Math.max(10, this.len * 0.4)) {
        f.dead = true;
        burstBubbles(this.x + Math.cos(this.heading) * this.len * 0.45, this.y, 2);
      }
    }
    this.excited = Math.max(0, this.excited - dt * 0.35);

    // разворот у стенок, дна и поверхности
    const mX = 70 + this.len * 0.8;
    const top = 70, bot = FLOOR - 26;
    if (this.x < mX) ax += (mX - this.x) * 2.4;
    else if (this.x > W - mX) ax -= (this.x - (W - mX)) * 2.4;
    if (this.y < top + 50) ay += (top + 50 - this.y) * 1.6;
    else if (this.y > bot - 40) ay -= (this.y - (bot - 40)) * 1.6;

    // течение
    ax += current * 10 * (0.4 + this.z);

    // интеграция + нормировка скорости к целевой
    this.vx += ax * dt;
    this.vy += ay * dt;
    const spd = Math.hypot(this.vx, this.vy) || 0.001;
    const target = this.baseSpeed * (1 + this.excited * 1.4);
    const ns = spd + (target - spd) * Math.min(1, dt * 2);
    this.vx *= ns / spd;
    this.vy *= ns / spd;
    const maxVy = ns * 0.6;
    if (this.vy > maxVy) this.vy = maxVy;
    else if (this.vy < -maxVy) this.vy = -maxVy;

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = clamp(this.x, 24, W - 24);
    this.y = clamp(this.y, top - 30, bot);

    // плавный курс + «переворот» тела при смене направления (сплющивание)
    const want = Math.atan2(this.vy, this.vx);
    this.heading = angleLerp(this.heading, want, Math.min(1, dt * spec.turnRate));
    const flipTarget = Math.cos(this.heading) < 0 ? -1 : 1;
    this.flipT += (flipTarget - this.flipT) * Math.min(1, dt * 5);

    // фаза волны тела зависит от скорости и возбуждения
    const relSpd = ns / spec.speed[1];
    this.phase += dt * spec.waveFreq * (0.5 + relSpd * 0.8 + this.excited * 0.5);
  }
}

// ---------- отрисовка рыбы ----------
function drawTail(fish, sp) {
  const spec = fish.spec, len = fish.len;
  const a = sp[sp.length - 1], b = sp[sp.length - 3];
  const dir = Math.atan2(a.y - b.y, a.x - b.x);
  const flap = Math.sin(fish.phase - 3.6) * 0.3;
  const tl = len * spec.tail.len * 1.2;
  const sprd = spec.tail.spread;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(dir + flap);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(tl * 0.5, -tl * sprd * 0.35, tl, -tl * sprd);
  if (spec.tail.type === 'fork') {
    ctx.quadraticCurveTo(tl * 0.45, 0, tl, tl * sprd);
  } else {
    ctx.quadraticCurveTo(tl * 1.15, 0, tl, tl * sprd);
  }
  ctx.quadraticCurveTo(tl * 0.5, tl * sprd * 0.35, 0, 0);
  ctx.closePath();
  ctx.fillStyle = fish.c.fins;
  ctx.fill();
  ctx.restore();
}

Fish.prototype.draw = function () {
  const spec = this.spec, len = this.len;
  const s = lerp(1, 0.5, this.z);
  const maxHw = len * spec.ratio;

  ctx.save();
  ctx.translate(this.x, this.y);
  ctx.rotate(this.heading);
  let fy = this.flipT;
  if (Math.abs(fy) < 0.12) fy = fy < 0 ? -0.12 : 0.12;
  ctx.scale(s, s * fy);
  ctx.globalAlpha = 1 - this.z * 0.5;

  // хребет: 9 точек, волна усиливается к хвосту
  const N = 9;
  const sp = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const env = 0.12 + Math.pow(u, 1.35) * 0.88;
    sp.push({
      x: len * 0.5 - u * len,
      y: Math.sin(this.phase - u * 3.6) * len * spec.waveAmp * env,
      hw: spec.profile[i] * maxHw,
    });
  }

  // хвост и плавники за телом
  drawTail(this, sp);

  if (spec.dorsal > 0) {
    const c = sp[3];
    const hD = maxHw * (0.5 + spec.dorsal) + Math.sin(this.phase - 1.2) * len * 0.03;
    ctx.beginPath();
    ctx.moveTo(sp[2].x, sp[2].y - sp[2].hw * 0.85);
    ctx.quadraticCurveTo(c.x + len * 0.05, c.y - c.hw - hD, sp[5].x, sp[5].y - sp[5].hw * 0.8);
    ctx.quadraticCurveTo(c.x, c.y - c.hw * 0.9, sp[2].x, sp[2].y - sp[2].hw * 0.85);
    ctx.closePath();
    ctx.fillStyle = this.c.fins;
    ctx.fill();
  }

  if (spec.angelFins) {
    // высокие спинной и анальный плавники скалярии (симметрично)
    const hF = maxHw * 0.9;
    const swy = Math.sin(this.phase * 0.7) * len * 0.06;
    for (const sgn of [-1, 1]) {
      const tip = { x: sp[4].x - len * 0.18 + swy, y: sp[4].y + sgn * (sp[4].hw + hF) };
      ctx.beginPath();
      ctx.moveTo(sp[1].x, sp[1].y + sgn * sp[1].hw * 0.7);
      ctx.quadraticCurveTo(sp[2].x - len * 0.02, sp[2].y + sgn * (maxHw + hF * 0.7), tip.x, tip.y);
      ctx.quadraticCurveTo(sp[4].x, sp[4].y + sgn * (sp[4].hw + maxHw * 0.15), sp[5].x, sp[5].y + sgn * sp[5].hw * 0.6);
      ctx.closePath();
      ctx.fillStyle = this.c.fins;
      ctx.fill();
    }
  }

  // тело: замкнутый сглаженный контур вокруг хребта
  const body = new Path2D();
  const pts = [];
  pts.push({ x: sp[0].x + len * 0.06, y: sp[0].y });
  for (let i = 0; i < N; i++) pts.push({ x: sp[i].x, y: sp[i].y - sp[i].hw });
  pts.push({ x: sp[N - 1].x - len * 0.02, y: sp[N - 1].y });
  for (let i = N - 1; i >= 0; i--) pts.push({ x: sp[i].x, y: sp[i].y + sp[i].hw });
  closedSmooth(body, pts);

  const grd = ctx.createLinearGradient(0, -maxHw, 0, maxHw);
  grd.addColorStop(0, this.c.back);
  grd.addColorStop(1, this.c.belly);
  ctx.fillStyle = grd;
  ctx.fill(body);
  ctx.strokeStyle = 'rgba(8,22,34,0.28)';
  ctx.lineWidth = Math.max(0.8, len * 0.012);
  ctx.stroke(body);

  // декор вида — обрезаем по контуру тела
  ctx.save();
  ctx.clip(body);
  const ga = ctx.globalAlpha;

  if (this.marks) {
    ctx.fillStyle = this.c.patch;
    for (const m of this.marks) {
      const p = sp[m.i];
      ctx.beginPath();
      ctx.ellipse(p.x + m.dx, p.y + m.dy, m.rx, m.ry, m.rot, 0, TAU);
      ctx.fill();
    }
  }

  if (spec.stripes && this.c.stripe) {
    ctx.strokeStyle = this.c.stripe;
    ctx.lineWidth = len * 0.055;
    for (const u of spec.stripes) {
      const i = Math.round(u * (N - 1));
      const p = sp[i];
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - p.hw);
      ctx.lineTo(p.x - len * 0.04, p.y + p.hw);
      ctx.stroke();
    }
  }

  if (spec.tangMark && this.c.mark) {
    ctx.globalAlpha = ga * 0.8;
    ctx.fillStyle = this.c.mark;
    ctx.beginPath();
    ctx.moveTo(sp[0].x + len * 0.04, sp[0].y - sp[0].hw * 0.4);
    for (let i = 0; i < N; i++) ctx.lineTo(sp[i].x, sp[i].y - sp[i].hw * 0.55);
    for (let i = N - 1; i >= 0; i--) ctx.lineTo(sp[i].x, sp[i].y - sp[i].hw * 1.05);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = ga;
  }

  if (spec.id === 'neon') {
    // светящаяся бирюзовая полоса + красная задняя
    ctx.lineCap = 'round';
    ctx.lineWidth = len * 0.10;
    ctx.strokeStyle = this.c.glow;
    ctx.beginPath();
    ctx.moveTo(sp[0].x, sp[0].y - sp[0].hw * 0.15);
    for (let i = 1; i < 7; i++) ctx.lineTo(sp[i].x, sp[i].y - sp[i].hw * 0.1);
    ctx.stroke();
    ctx.strokeStyle = this.c.red;
    ctx.beginPath();
    ctx.moveTo(sp[3].x, sp[3].y + sp[3].hw * 0.35);
    for (let i = 4; i < N; i++) ctx.lineTo(sp[i].x, sp[i].y + sp[i].hw * 0.3);
    ctx.stroke();
  }
  ctx.restore();

  // грудной плавник (машет)
  const pf = sp[2];
  const fl = Math.sin(this.finT) * 0.5 - 0.25;
  ctx.save();
  ctx.translate(pf.x, pf.y + pf.hw * 0.35);
  ctx.rotate(0.9 + fl);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.10, len * 0.05, len * 0.16, len * 0.16);
  ctx.quadraticCurveTo(len * 0.04, len * 0.14, 0, 0);
  ctx.closePath();
  ctx.fillStyle = this.c.fins;
  ctx.fill();
  ctx.restore();

  // глаз и жаберная дуга
  const eyeR = Math.max(1.4, len * 0.045);
  const ey = (sp[0].y * 0.4 + sp[1].y * 0.6) - maxHw * 0.18;
  ctx.beginPath();
  ctx.arc(len * 0.34, ey, eyeR, 0, TAU);
  ctx.fillStyle = '#0b1016';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(len * 0.34 + eyeR * 0.3, ey - eyeR * 0.35, eyeR * 0.35, 0, TAU);
  ctx.fillStyle = 'rgba(230,245,255,0.85)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(len * 0.24, sp[1].y, maxHw * 0.6, -1.0, 1.0);
  ctx.strokeStyle = 'rgba(10,20,30,0.18)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // подсветка рыбы, проходящей через луч света
  const lightK = rayLightAt(this.x, this.y);
  if (lightK > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(0.5, lightK * 2.2) * (1 - this.z * 0.4);
    ctx.fillStyle = 'rgba(170,225,250,1)';
    ctx.fill(body);
  }

  ctx.restore();
};

// мягкие тени крупных рыб на песке
function drawShadows() {
  ctx.save();
  ctx.fillStyle = 'rgba(5,15,25,1)';
  for (const f of bigFish) {
    const k = clamp(1 - (FLOOR - f.y) / 260, 0, 1);
    if (k <= 0) continue;
    const s = lerp(1, 0.5, f.z);
    ctx.globalAlpha = 0.22 * k * (1 - f.z * 0.5);
    ctx.beginPath();
    ctx.ellipse(f.x, FLOOR + 10 + f.z * 8, f.len * 0.55 * s * (0.6 + 0.4 * k), f.len * 0.13 * s, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- дымка, виньетка, поверхность ----------
function drawHaze() {
  // глубинная дымка снизу — плотный тёмный teal
  const g = ctx.createLinearGradient(0, H * 0.4, 0, H);
  g.addColorStop(0, 'rgba(8,50,62,0)');
  g.addColorStop(0.7, 'rgba(5,36,46,0.22)');
  g.addColorStop(1, 'rgba(3,26,34,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.4, W, H * 0.6);
  // неоднородная водная пелена: чистый центр, плотнее к краям и дали
  const r = Math.hypot(W, H) * 0.62;
  let v = ctx.createRadialGradient(W * 0.5, H * 0.38, r * 0.22, W * 0.5, H * 0.38, r);
  v.addColorStop(0, 'rgba(120,190,205,0)');
  v.addColorStop(0.55, 'rgba(90,150,170,0.06)');
  v.addColorStop(1, 'rgba(70,120,140,0.16)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  // виньетка — почти темнота в нижних углах
  v = ctx.createRadialGradient(W / 2, H * 0.34, r * 0.3, W / 2, H * 0.34, r * 1.02);
  v.addColorStop(0, 'rgba(0,12,18,0)');
  v.addColorStop(0.75, 'rgba(1,14,20,0.22)');
  v.addColorStop(1, 'rgba(0,10,16,0.62)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

function drawSurface() {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const x = (W * i) / n;
    const y = 10 + Math.sin(i * 0.9 + time * 1.6) * 4 + Math.sin(i * 0.37 - time * 0.9) * 6;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, 0);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, 26);
  g.addColorStop(0, 'rgba(210,245,255,0.45)');
  g.addColorStop(1, 'rgba(200,240,255,0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

// ---------- население аквариума ----------
let schoolSize = 34;

function setSchoolSize(n) {
  schoolSize = n;
  while (school.members.length < n) {
    const f = new Fish(NEON_SPEC, { school });
    school.members.push(f);
    allFish.push(f);
  }
  while (school.members.length > n) {
    const f = school.members.pop();
    const i = allFish.indexOf(f);
    if (i >= 0) allFish.splice(i, 1);
  }
}

function initFish() {
  allFish = [];
  bigFish = [];
  school.members.length = 0;
  for (const spec of SPECIES) {
    if (spec.schooling) continue;
    for (let i = 0; i < spec.count; i++) {
      const f = new Fish(spec);
      allFish.push(f);
      bigFish.push(f);
    }
  }
  setSchoolSize(schoolSize);
}

// ---------- resize ----------
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  FLOOR = H - Math.max(56, H * 0.12);
  buildStatic();
  initMotes();
}

// ---------- главный цикл ----------
let bubbleTimer = 2;

function update(dt) {
  updateSchool(dt);
  for (const f of allFish) f.update(dt);
  updateFood(dt);
  updateBubbles(dt);
  updateMotes(dt);
  // редкие пузырьки изо рта крупных рыб
  bubbleTimer -= dt;
  if (bubbleTimer <= 0) {
    bubbleTimer = rand(1.5, 4);
    if (bigFish.length) {
      const f = pick(bigFish);
      burstBubbles(f.x + Math.cos(f.heading) * f.len * 0.5, f.y, 1 + ((Math.random() * 2) | 0));
    }
  }
}

function render() {
  computeRays(time);     // геометрия лучей нужна и рыбам (подсветка), и drawRays
  ctx.drawImage(bgCanvas, 0, 0, W, H);
  drawCaustics();
  drawWeeds(true);       // дальние водоросли
  drawShadows();
  allFish.sort((a, b) => b.z - a.z);
  for (const f of allFish) f.draw();
  drawFood();
  drawWeeds(false);      // ближние водоросли
  drawBubbles();
  drawMotes();
  drawRays();
  drawHaze();
  drawSurface();
}

let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!paused && dt > 0) {
    time += dt;
    update(dt);
  }
  render();
}

// ---------- контролы ----------
const feedBtn = document.getElementById('feedBtn');
const pauseBtn = document.getElementById('pauseBtn');
const schoolRange = document.getElementById('schoolRange');
const schoolVal = document.getElementById('schoolVal');
const currentRange = document.getElementById('currentRange');

function setPaused(v) {
  paused = v;
  pauseBtn.textContent = v ? 'Продолжить' : 'Пауза';
}

feedBtn.addEventListener('click', () => feed());
pauseBtn.addEventListener('click', () => setPaused(!paused));
schoolRange.addEventListener('input', () => {
  const n = +schoolRange.value;
  schoolVal.textContent = n;
  setSchoolSize(n);
});
currentRange.addEventListener('input', () => {
  current = +currentRange.value / 100;
});
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPaused(!paused);
  } else if (e.code === 'KeyF') {
    feed();
  }
});
window.addEventListener('resize', resize);

// ---------- старт ----------
resize();
initRays();
initWeeds();
initEmitters();
initFish();
schoolVal.textContent = schoolRange.value;
requestAnimationFrame(frame);
})();
