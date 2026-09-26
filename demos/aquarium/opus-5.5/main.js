/* Аквариум с рыбами — Claude Opus 5.5
   Canvas 2D, без библиотек. Слои: толща воды -> дальние гряды -> песок + каустики ->
   камни / водоросли / рыбы (сортировка по глубине) -> лучи -> пузырьки, взвесь -> дымка, виньетка. */
(function () {
'use strict';

// ---------------------------------------------------------------- базовые утилиты
const cv = document.getElementById('scene');
const ctx = cv.getContext('2d', { alpha: false });
const TAU = Math.PI * 2, PI = Math.PI;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const rgba = (c, a) => 'rgba(' + clamp(c[0] | 0, 0, 255) + ',' + clamp(c[1] | 0, 0, 255) + ',' +
  clamp(c[2] | 0, 0, 255) + ',' + (a === undefined ? 1 : clamp(a, 0, 1).toFixed(3)) + ')';
function angDiff(a, b) { let d = a - b; while (d > PI) d -= TAU; while (d < -PI) d += TAU; return d; }
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// гладкий «шум» из синусов — для блуждания
function wob(t, ph) { return Math.sin(t + ph) * 0.55 + Math.sin(t * 2.17 + ph * 1.7) * 0.3 + Math.sin(t * 4.31 + ph * 0.63) * 0.15; }

// ---------------------------------------------------------------- состояние
const S = { light: 1, current: 0.6, paused: false };
let W = 1, H = 1, DPR = 1, RS = 1, qual = 1;   // RS — фактический масштаб рендера
let VS = 1;                                     // масштаб объектов относительно экрана ~820px
let time = 0;
const SUN_U = 0.63;                             // где над поверхностью «солнце»
const DEPTH = 650;                              // глубина сцены в мировых px для z∈[0,1]

// палитра толщи воды по нормированной высоте (0 — поверхность, 1 — низ кадра)
const WSTOPS = [
  [0.00, [118, 204, 214]],
  [0.10, [54, 152, 174]],
  [0.38, [22, 98, 130]],
  [0.72, [9, 52, 82]],
  [1.00, [4, 27, 47]],
];
function waterAt(v) {
  v = clamp(v, 0, 1);
  for (let i = 1; i < WSTOPS.length; i++) {
    if (v <= WSTOPS[i][0]) {                // сглаженная интерполяция — без изломов (полос Маха)
      const a = WSTOPS[i - 1], b = WSTOPS[i];
      const t = (v - a[0]) / (b[0] - a[0]);
      return mixc(a[1], b[1], t * t * (3 - 2 * t));
    }
  }
  return WSTOPS[WSTOPS.length - 1][1];
}

// ---------------------------------------------------------------- геометрия сцены
// z: 0 — у стекла (ближе к зрителю), 1 — у задней стенки
function floorEdge(x) {            // дальний край песка (экранный y)
  const u = x / W;
  return H * (0.735 + 0.021 * Math.sin(u * 5.1 + 1.3) + 0.011 * Math.sin(u * 13.7 + 0.4) + 0.005 * Math.sin(u * 31 + 2));
}
function groundY(x, z) { return lerp(H * 1.03, floorEdge(x) + 2, z); }
function zScale(z) { return (1 - 0.6 * z) * VS; }
function fogAmt(z) { return 0.05 + 0.7 * Math.pow(clamp(z, 0, 1), 1.15); }
function fogCol(y) { const c = waterAt(y / H); return [c[0] + 6, c[1] + 12, c[2] + 12]; }
let yHor = 0, floorTopMin = 0;

// ================================================================ статичный фон
let bgCanvas = null, sandPath = null;

function ridgeY(L, x, ph) {
  const u = x / W;
  const base = H * (0.55 + L * 0.055), amp = H * (0.085 - L * 0.018);
  const n = Math.sin(u * 3.1 + ph[0]) * 0.5 + Math.sin(u * 7.3 + ph[1]) * 0.28 +
    Math.sin(u * 17.2 + ph[2]) * 0.12 + Math.abs(Math.sin(u * 41 + ph[0])) * 0.1;
  return base - amp * (0.55 + 0.5 * n);
}

function buildBackground() {
  const c = mkCanvas(W * RS, H * RS), g = c.getContext('2d');
  g.setTransform(RS, 0, 0, RS, 0, 0);
  const R = mulberry(11);

  // 1) толща воды
  let gr = g.createLinearGradient(0, 0, 0, H);
  for (let i = 0; i <= 32; i++) gr.addColorStop(i / 32, rgba(waterAt(i / 32)));
  g.fillStyle = gr; g.fillRect(0, 0, W, H);

  // 2) свечение со стороны солнца
  const sx = SUN_U * W;
  gr = g.createRadialGradient(sx, -H * 0.25, 0, sx, -H * 0.25, H * 1.25);
  gr.addColorStop(0, 'rgba(220,252,250,0.55)');
  gr.addColorStop(0.28, 'rgba(150,225,232,0.22)');
  gr.addColorStop(0.65, 'rgba(60,150,180,0.06)');
  gr.addColorStop(1, 'rgba(40,120,160,0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);

  // 3) дальние гряды и силуэты зарослей — рисуются в низком разрешении (мягкие края при
  //    увеличении) и по вертикали растворяются в цвете воды: без «картонных кулис».
  const DS = 9;
  const rc = mkCanvas(W / DS, H / DS), rg = rc.getContext('2d');
  rg.setTransform(1 / DS, 0, 0, 1 / DS, 0, 0);
  for (let L = 0; L < 3; L++) {
    const ph = [R() * 10, R() * 10, R() * 10];
    const yb = H * (0.55 + L * 0.055), amp = H * (0.085 - L * 0.018);
    const col = mixc(waterAt(yb / H), [3, 24, 40], 0.1 + L * 0.1);
    const a = 0.3 + L * 0.14;
    const fg = rg.createLinearGradient(0, yb - amp * 1.25, 0, yb + H * 0.06);
    fg.addColorStop(0, rgba(col, 0));
    fg.addColorStop(0.45, rgba(col, a * 0.45));
    fg.addColorStop(1, rgba(col, a));
    rg.fillStyle = fg;
    rg.beginPath(); rg.moveTo(0, H);
    for (let x = 0; x <= W + 12; x += 12) rg.lineTo(x, ridgeY(L, x, ph));
    rg.lineTo(W, H); rg.closePath(); rg.fill();
    // силуэты водорослей на гряде — тоже с растворением кверху
    rg.lineCap = 'round';
    const n = 12 + L * 7;
    for (let i = 0; i < n; i++) {
      const x = R() * W, y = ridgeY(L, x, ph) + 6;
      const h = H * (0.03 + R() * 0.06) * (1 + L * 0.3), bend = (R() - 0.5) * h * 0.6;
      const sg = rg.createLinearGradient(0, y - h, 0, y);
      sg.addColorStop(0, rgba(col, 0)); sg.addColorStop(1, rgba(col, a * 0.8));
      rg.strokeStyle = sg;
      const blades = 2 + (R() * 4) | 0;
      for (let b = 0; b < blades; b++) {
        const dx = (R() - 0.5) * 14;
        rg.lineWidth = (3 + R() * 4) * (0.7 + L * 0.3);
        rg.beginPath(); rg.moveTo(x + dx, y);
        rg.quadraticCurveTo(x + dx + bend * 0.3, y - h * 0.6, x + dx + bend + (R() - 0.5) * 12, y - h * (0.7 + R() * 0.5));
        rg.stroke();
      }
    }
  }
  // двухступенчатое увеличение — ближе к гауссову размытию, чем один билинейный шаг
  const mid = mkCanvas(W / 3, H / 3), mg = mid.getContext('2d');
  mg.imageSmoothingEnabled = true; mg.imageSmoothingQuality = 'high';
  mg.drawImage(rc, 0, 0, mid.width, mid.height);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(mid, 0, 0, W, H);
  // лёгкая дымка поверх гряд
  gr = g.createLinearGradient(0, H * 0.35, 0, H * 0.8);
  const fc = fogCol(H * 0.55);
  gr.addColorStop(0, rgba(fc, 0)); gr.addColorStop(0.55, rgba(fc, 0.28)); gr.addColorStop(1, rgba(fc, 0));
  g.fillStyle = gr; g.fillRect(0, 0, W, H);

  // 4) песок
  floorTopMin = H;
  const sp = new Path2D();
  sp.moveTo(-4, H + 4);
  for (let x = -4; x <= W + 8; x += 5) { const y = floorEdge(x); sp.lineTo(x, y); if (y < floorTopMin) floorTopMin = y; }
  sp.lineTo(W + 8, H + 4); sp.closePath();
  sandPath = sp;
  let avgEdge = 0; for (let i = 0; i <= 20; i++) avgEdge += floorEdge(W * i / 20); avgEdge /= 21;
  yHor = H * 1.03 - (H * 1.03 - avgEdge) / 0.6;

  gr = g.createLinearGradient(0, floorTopMin, 0, H);
  gr.addColorStop(0, rgba(mixc(fogCol(floorTopMin), [110, 128, 112], 0.25)));
  gr.addColorStop(0.22, 'rgb(84,110,104)');
  gr.addColorStop(0.55, 'rgb(122,122,100)');
  gr.addColorStop(1, 'rgb(156,138,102)');
  g.fillStyle = gr; g.fill(sp);

  g.save(); g.clip(sp);
  // песчаная рябь
  for (let i = 0; i < 64; i++) {
    const z = 1 - (i + R()) / 64;
    const zs = zScale(z), ph = R() * TAU, ph2 = R() * TAU, fa = fogAmt(z);
    const pts = [];
    for (let x = -10; x <= W + 10; x += 6) {
      pts.push(x, groundY(x, z) + Math.sin(x * 0.018 / zs + ph) * 2.2 * zs + Math.sin(x * 0.047 / zs + ph2) * 1.1 * zs);
    }
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      const off = k ? 1.7 * zs : 0;
      for (let j = 0; j < pts.length; j += 2) (j ? g.lineTo : g.moveTo).call(g, pts[j], pts[j + 1] + off);
      g.lineWidth = 1.5 * zs;
      g.strokeStyle = k ? rgba([30, 26, 18], 0.08 * (1 - fa)) : rgba([255, 236, 190], 0.07 * (1 - fa));
      g.stroke();
    }
  }
  // крупинки
  const nSpeck = Math.min(14000, W * H * 0.0045) | 0;
  const SPC = [[236, 222, 186], [60, 52, 40], [150, 104, 70], [200, 200, 190], [95, 110, 100]];
  for (let i = 0; i < nSpeck; i++) {
    const z = Math.pow(R(), 0.75), x = R() * W, zs = zScale(z);
    const y = groundY(x, z) + (R() - 0.5) * 6 * zs;
    const col = mixc(SPC[(R() * SPC.length) | 0], fogCol(y), fogAmt(z) * 0.9);
    g.fillStyle = rgba(col, 0.15 + R() * 0.3);
    const r = (0.35 + R() * 1.1) * zs;
    g.fillRect(x - r, y - r * 0.6, r * 2, r * 1.2);
  }
  // галька
  for (let i = 0; i < 110; i++) {
    const z = Math.pow(R(), 1.6), x = R() * W, zs = zScale(z);
    const y = groundY(x, z) - zs;
    const r = (1.8 + R() * R() * 7) * zs, e = 0.45 + R() * 0.25;
    const base = [[120, 112, 98], [150, 140, 120], [92, 88, 82], [170, 150, 118]][(R() * 4) | 0];
    const f = fogAmt(z), fcol = fogCol(y);
    g.fillStyle = rgba([10, 12, 10], 0.25 * (1 - f));
    g.beginPath(); g.ellipse(x + r * 0.25, y + r * e * 0.55, r * 1.1, r * e * 0.7, 0, 0, TAU); g.fill();
    const pg = g.createLinearGradient(x, y - r * e, x, y + r * e);
    pg.addColorStop(0, rgba(mixc(mulc(base, 1.35), fcol, f)));
    pg.addColorStop(1, rgba(mixc(mulc(base, 0.6), fcol, f)));
    g.fillStyle = pg;
    g.beginPath(); g.ellipse(x, y, r, r * e, (R() - 0.5) * 0.4, 0, TAU); g.fill();
  }
  g.restore();

  // размытие дальнего края дна дымкой
  gr = g.createLinearGradient(0, floorTopMin - H * 0.05, 0, floorTopMin + H * 0.12);
  const fe = fogCol(floorTopMin);
  gr.addColorStop(0, rgba(fe, 0)); gr.addColorStop(0.35, rgba(fe, 0.45)); gr.addColorStop(1, rgba(fe, 0));
  g.fillStyle = gr; g.fillRect(0, floorTopMin - H * 0.05, W, H * 0.17);
  bgCanvas = c;
}

// ================================================================ спрайты
let raySprite, bubbleSprite, dotSprite, shadowSprite, grainCanvas;

function buildSprites() {
  // луч: гауссов профиль по ширине, затухание по длине
  {
    const w = 64, h = 256; raySprite = mkCanvas(w, h);
    const g = raySprite.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1), fall = Math.pow(1 - v, 1.5) * smooth(0, 0.03, v);
      for (let x = 0; x < w; x++) {
        const u = ((x + 0.5) / w) * 2 - 1;
        const a = Math.exp(-u * u * 4.5) * (1 - u * u) * fall;
        const i = (y * w + x) * 4;
        d[i] = 218; d[i + 1] = 248; d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
  }
  // пузырёк
  {
    bubbleSprite = mkCanvas(64, 64);
    const g = bubbleSprite.getContext('2d');
    g.translate(32, 32);
    let rg = g.createRadialGradient(0, 0, 0, 0, 0, 30);
    rg.addColorStop(0, 'rgba(170,230,250,0.05)');
    rg.addColorStop(0.7, 'rgba(185,238,255,0.10)');
    rg.addColorStop(0.88, 'rgba(220,250,255,0.50)');
    rg.addColorStop(0.96, 'rgba(245,255,255,0.90)');
    rg.addColorStop(1, 'rgba(245,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 30, 0, TAU); g.fill();
    rg = g.createRadialGradient(-10, -11, 0, -10, -11, 9);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.5, 'rgba(255,255,255,0.45)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(-10, -11, 9, 0, TAU); g.fill();
    rg = g.createRadialGradient(10, 13, 0, 10, 13, 8);
    rg.addColorStop(0, 'rgba(220,250,255,0.4)'); rg.addColorStop(1, 'rgba(220,250,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(10, 13, 8, 0, TAU); g.fill();
  }
  // мягкая точка
  {
    dotSprite = mkCanvas(32, 32);
    const g = dotSprite.getContext('2d');
    const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.35, 'rgba(255,255,255,0.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
  }
  // тень на дне
  {
    shadowSprite = mkCanvas(64, 64);
    const g = shadowSprite.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(0,10,12,0.9)'); rg.addColorStop(0.5, 'rgba(0,10,12,0.45)'); rg.addColorStop(1, 'rgba(0,10,12,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  }
  // плёночное зерно
  {
    grainCanvas = mkCanvas(128, 128);
    const g = grainCanvas.getContext('2d'), img = g.createImageData(128, 128), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }
}

// ================================================================ камни (спрайты с запечённой дымкой)
const ROCK_DEFS = [
  { u: 0.17, z: 0.34, w: 250, h: 150, seed: 3, moss: 0.8 },
  { u: 0.27, z: 0.58, w: 150, h: 96, seed: 7, moss: 0.5 },
  { u: 0.08, z: 0.72, w: 130, h: 70, seed: 12, moss: 0.4 },
  { u: 0.79, z: 0.46, w: 205, h: 122, seed: 21, moss: 0.7 },
  { u: 0.88, z: 0.22, w: 140, h: 78, seed: 5, moss: 0.3 },
  { u: 0.59, z: 0.86, w: 96, h: 52, seed: 33, moss: 0.5 },
  { u: 0.46, z: 0.12, w: 70, h: 36, seed: 41, moss: 0.2 },
];
let rocks = [];

function makeRock(def) {
  const R = mulberry(def.seed * 97 + 1);
  const sc = zScale(def.z), w = def.w * sc, h = def.h * sc;
  const cw = w * 1.5, ch = h * 1.45;
  const c = mkCanvas(cw * RS, ch * RS), g = c.getContext('2d');
  g.setTransform(RS, 0, 0, RS, 0, 0);
  const cx = cw / 2, by = ch * 0.8;          // by — линия контакта с песком
  const x0 = def.u * W, yb = groundY(x0, def.z) + h * 0.06;
  const f = fogAmt(def.z), fcol = fogCol(yb - h * 0.5);
  // контактная тень
  let rg = g.createRadialGradient(cx, by, 0, cx, by, w * 0.62);
  rg.addColorStop(0, 'rgba(0,8,10,0.5)'); rg.addColorStop(1, 'rgba(0,8,10,0)');
  g.save(); g.translate(cx, by); g.scale(1, 0.22); g.translate(-cx, -by);
  g.fillStyle = rg; g.beginPath(); g.arc(cx, by, w * 0.62, 0, TAU); g.fill(); g.restore();
  // силуэт
  const ph = [R() * TAU, R() * TAU, R() * TAU], pts = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU;
    const rr = 1 + 0.1 * Math.sin(3 * a + ph[0]) + 0.06 * Math.sin(5 * a + ph[1]) + 0.035 * Math.sin(11 * a + ph[2]);
    let px = Math.cos(a) * w * 0.5 * rr, py = Math.sin(a) * h * 0.62 * rr;
    if (py > 0) py *= 0.3;
    pts.push(cx + px, by - h * 0.12 + py);
  }
  const path = new Path2D();
  path.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
  path.closePath();
  const base = [[96, 100, 96], [104, 98, 88], [88, 94, 100]][def.seed % 3];
  rg = g.createRadialGradient(cx - w * 0.14, by - h * 0.85, h * 0.05, cx, by - h * 0.3, w * 0.62);
  rg.addColorStop(0, rgba(mixc(mulc(base, 1.75), fcol, f)));
  rg.addColorStop(0.45, rgba(mixc(base, fcol, f)));
  rg.addColorStop(1, rgba(mixc(mulc(base, 0.32), fcol, f * 0.8)));
  g.fillStyle = rg; g.fill(path);
  g.save(); g.clip(path);
  // фактура: пятна и трещины
  for (let i = 0; i < 260; i++) {
    const x = cx + (R() - 0.5) * w, y = by - R() * h * 1.1;
    const r = (0.5 + R() * 2.4) * sc;
    g.fillStyle = rgba(R() < 0.5 ? [20, 22, 22] : [210, 210, 196], (0.05 + R() * 0.1) * (1 - f));
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    let x = cx + (R() - 0.5) * w * 0.7, y = by - h * (0.2 + R() * 0.7);
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (R() - 0.5) * 16 * sc; y += R() * 12 * sc; g.lineTo(x, y); }
    g.strokeStyle = rgba([12, 14, 14], 0.25 * (1 - f)); g.lineWidth = 1.1 * sc; g.stroke();
  }
  // мох на верхушке
  const mossN = (def.moss * 220) | 0;
  for (let i = 0; i < mossN; i++) {
    const idx = 36 + ((R() * 36) | 0), a = (idx / 72) * TAU;   // верхняя половина контура
    const px = pts[idx * 2], py = pts[idx * 2 + 1];
    if (Math.sin(a) > -0.25) continue;
    const x = px + (R() - 0.5) * 10 * sc, y = py + R() * 12 * sc;
    const col = mixc([[70, 120, 50], [96, 140, 58], [52, 96, 46]][(R() * 3) | 0], fcol, f);
    g.fillStyle = rgba(col, 0.35 + R() * 0.4);
    g.beginPath(); g.arc(x, y, (0.8 + R() * 2.4) * sc, 0, TAU); g.fill();
  }
  // окклюзия у основания
  const og = g.createLinearGradient(0, by - h * 0.35, 0, by + 2);
  og.addColorStop(0, 'rgba(0,10,14,0)'); og.addColorStop(1, rgba([0, 10, 14], 0.45 * (1 - f * 0.5)));
  g.fillStyle = og; g.fillRect(0, 0, cw, ch);
  g.restore();
  // контровой свет сверху
  g.save(); g.clip(path);
  g.strokeStyle = rgba([200, 245, 240], 0.3 * (1 - f)); g.lineWidth = 2.2 * sc;
  g.translate(0, 2 * sc); g.stroke(path);
  g.restore();
  return { kind: 'rock', z: def.z, canvas: c, x: x0 - cx, y: yb - by, w: cw, h: ch, cx: x0, top: yb - h * 1.05, hw: w * 0.5 };
}

function buildRocks() { rocks = ROCK_DEFS.map(makeRock); }
function drawRock(r) { ctx.drawImage(r.canvas, r.x, r.y, r.w, r.h); }

// ================================================================ каустики
// Бесшовная процедурная текстура (итеративное искажение поля синусов) считается каждый кадр
// в 128×128 через таблицу синусов, затем проецируется с перспективой на дно и на поверхность.
const CS = 128, CM = CS - 1;
const LN = 4096, LM = LN - 1, LK = LN / TAU, LQ = LN >> 2;
const SINT = new Float32Array(LN);
for (let i = 0; i < LN; i++) SINT[i] = Math.sin(i / LK);
const cField = new Float32Array(CS * CS);

function computeCaustics(t) {
  const T0 = t * -2.5, T1 = t * -0.75, T2 = t * (1 - 3.5 / 3), T3 = t * 0.125;
  const TT = [T0, T1, T2, T3];
  const iK = 1 / 1.24, step = TAU / CS;
  let k = 0;
  for (let y = 0; y < CS; y++) {
    const py = y * step - 250;
    for (let x = 0; x < CS; x++) {
      const px = x * step - 250;
      let ix = px, iy = py, c = 1;
      for (let n = 0; n < 4; n++) {
        const tn = TT[n];
        const nx = px + SINT[((tn - ix) * LK + LQ) & LM] + SINT[((tn + iy) * LK) & LM];
        const ny = py + SINT[((tn - iy) * LK) & LM] + SINT[((tn + ix) * LK + LQ) & LM];
        ix = nx; iy = ny;
        const s = SINT[((ix + tn) * LK) & LM], co = SINT[((iy + tn) * LK + LQ) & LM];
        c += Math.abs(s * co) * iK / Math.sqrt(s * s + co * co + 1e-4);
      }
      c *= 0.25;
      let v = 1.17 - Math.pow(c, 1.4);
      if (v < 0) v = 0;
      v *= v; v *= v; v *= v;
      cField[k++] = v;
    }
  }
}

function causticAt(x, z) {                     // дешёвая выборка для подсветки рыб
  const tx = (x * 0.09) & CM, ty = ((z * 90 + 17) | 0) & CM;
  return cField[ty * CS + tx];
}

let floorBuf = null, floorImg = null, floorFW = 0, floorFH = 0, floorY0 = 0, floorStep = 2.5;
let surfBuf = null, surfImg = null, surfFW = 0, surfFH = 0, surfStep = 3, surfH = 100;

function buildCausticBuffers() {
  floorStep = clamp(W / 720, 1.4, 3.2) / Math.max(qual, 0.5);
  floorY0 = floorTopMin - 2;
  floorFW = Math.ceil(W / floorStep) + 2; floorFH = Math.ceil((H - floorY0) / floorStep) + 2;
  floorBuf = mkCanvas(floorFW, floorFH);
  floorImg = floorBuf.getContext('2d').createImageData(floorFW, floorFH);
  surfH = H * 0.14;
  surfStep = clamp(W / 560, 1.6, 3.6) / Math.max(qual, 0.5);
  surfFW = Math.ceil(W / surfStep) + 2; surfFH = Math.ceil(surfH / surfStep) + 2;
  surfBuf = mkCanvas(surfFW, surfFH);
  surfImg = surfBuf.getContext('2d').createImageData(surfFW, surfFH);
}

let colSpot = new Float32Array(1), colA = new Float32Array(1), colC = new Float32Array(1), colS = new Float32Array(1);
function renderFloorCaustics() {
  const d = floorImg.data, fw = floorFW, fh = floorFH, st = floorStep;
  const A = 5 / H, F = 0.78 * H, G = F / A;
  const cx = W * 0.5, sunX = SUN_U * W, tw = time * 0.23, Lk = S.light;
  if (colSpot.length !== fw) { colSpot = new Float32Array(fw); colA = new Float32Array(fw); colC = new Float32Array(fw); colS = new Float32Array(fw); }
  for (let i = 0; i < fw; i++) {             // всё, что зависит только от столбца
    const x = i * st, dx = (x - sunX) / W;
    colSpot[i] = 0.4 + 0.8 * Math.exp(-dx * dx * 5);
    colA[i] = Math.sin(x * 0.0041 + tw);
    colC[i] = Math.cos(x * 0.0013); colS[i] = Math.sin(x * 0.0013);
  }
  let k = 0;
  for (let j = 0; j < fh; j++) {
    const y = floorY0 + j * st;
    const u = Math.max(y - yHor, H * 0.03);
    const inv = 1 / (A * u), ty = -G / u;
    const near = clamp((y - floorTopMin) / (H - floorTopMin), 0, 1);
    const rowA = (0.22 + 0.78 * Math.pow(near, 0.75)) * Lk * 165;
    const fy0 = Math.floor(ty), ay = ty - fy0;
    const r0 = (fy0 & CM) * CS, r1 = ((fy0 + 1) & CM) * CS;
    const by = y * 0.012 - tw * 1.3, sb = Math.sin(by), cb = Math.cos(by);
    for (let i = 0; i < fw; i++) {
      const spot = colSpot[i];
      const cloud = 0.74 + 0.26 * colA[i] * (sb * colC[i] + cb * colS[i]);
      const tx = (i * st - cx) * inv + 65536;
      const fx0 = tx | 0, ax = tx - fx0;
      const xi = fx0 & CM, xj = (fx0 + 1) & CM;
      const a = cField[r0 + xi], b = cField[r0 + xj], c = cField[r1 + xi], e = cField[r1 + xj];
      const top = a + (b - a) * ax, bot = c + (e - c) * ax;
      let v = top + (bot - top) * ay - 0.1;
      const vr = cField[r0 + ((fx0 + 2) & CM)] - 0.1, vb = cField[r0 + ((fx0 - 1) & CM)] - 0.1;
      const m = rowA * spot * cloud;
      if (v < 0) v = 0;
      d[k] = (v * 0.65 + (vr > 0 ? vr : 0) * 0.35) * m;
      d[k + 1] = v * 0.97 * m;
      d[k + 2] = (v * 0.6 + (vb > 0 ? vb : 0) * 0.4) * 0.84 * m;
      d[k + 3] = 255;
      k += 4;
    }
  }
  floorBuf.getContext('2d').putImageData(floorImg, 0, 0);
}

let surfSpot = new Float32Array(1);
function renderSurface() {
  const d = surfImg.data, fw = surfFW, fh = surfFH, st = surfStep;
  const A = 17.6 / H, F = 0.375 * H, G = F / A;
  const cx = W * 0.5, sunX = SUN_U * W, Lk = S.light, drift = time * 2.2;
  const spots =surfSpot.length === fw ? surfSpot : (surfSpot = new Float32Array(fw));
  for (let i = 0; i < fw; i++) { const dx = (i * st - sunX) / W; spots[i] = 0.35 + 0.9 * Math.exp(-dx * dx * 3.5); }
  let k = 0;
  for (let j = 0; j < fh; j++) {
    const y = j * st;
    const u = Math.max(surfH * 1.3 - y, surfH * 0.2);
    const inv = 1 / (A * u), ty = G / u + drift * 0.3;
    const fade = Math.pow(clamp(1 - y / surfH, 0, 1), 1.6);
    const fy0 = Math.floor(ty), ay = ty - fy0;
    const r0 = (fy0 & CM) * CS, r1 = ((fy0 + 1) & CM) * CS;
    for (let i = 0; i < fw; i++) {
      const spot = spots[i];
      const tx = (i * st - cx) * inv + drift + 65536;
      const fx0 = tx | 0, ax = tx - fx0;
      const xi = fx0 & CM, xj = (fx0 + 1) & CM;
      const a = cField[r0 + xi], b = cField[r0 + xj], c = cField[r1 + xi], e = cField[r1 + xj];
      const top = a + (b - a) * ax, bot = c + (e - c) * ax;
      let v = top + (bot - top) * ay;
      v = (0.16 + v * 1.1) * fade * spot * Lk * 150;
      d[k] = v * 0.82; d[k + 1] = v * 0.97; d[k + 2] = v; d[k + 3] = 255;
      k += 4;
    }
  }
  surfBuf.getContext('2d').putImageData(surfImg, 0, 0);
}

function drawFloorCaustics() {
  ctx.save();
  ctx.clip(sandPath);
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(floorBuf, 0, floorY0, floorFW * floorStep, floorFH * floorStep);
  ctx.restore();
}

function drawSurface() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(surfBuf, 0, 0, surfFW * surfStep, surfFH * surfStep);
  // яркая кромка поверхности и «окно Снеллиуса» над солнцем
  const sx = SUN_U * W;
  let g = ctx.createLinearGradient(0, 0, 0, surfH * 0.55);
  g.addColorStop(0, rgba([190, 240, 245], 0.28 * S.light)); g.addColorStop(1, 'rgba(190,240,245,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, surfH * 0.55);
  g = ctx.createRadialGradient(sx, -H * 0.02, 0, sx, -H * 0.02, W * 0.28);
  g.addColorStop(0, rgba([255, 255, 240], 0.42 * S.light)); g.addColorStop(0.4, rgba([200, 245, 250], 0.12 * S.light)); g.addColorStop(1, 'rgba(200,245,250,0)');
  ctx.fillStyle = g; ctx.fillRect(sx - W * 0.3, 0, W * 0.6, W * 0.3);   // прямоугольник целиком вмещает градиент — без обреза
  ctx.restore();
}

// ================================================================ растения
let plants = [];
const PX = new Float32Array(64), PY = new Float32Array(64), PA = new Float32Array(64);
const LX = new Float32Array(64), LY = new Float32Array(64), RX = new Float32Array(64), RY = new Float32Array(64);

function genPlants() {
  const R = mulberry(2024), P = [];
  const add = (type, u, z, o) => P.push(Object.assign({ kind: 'plant', type, u, z, ph: R() * TAU, sp: 0.8 + R() * 0.5, curl: 0, tw: 2 + R() * 3 }, o));
  function ribbons(u0, u1, z0, z1, n, len0, len1, o) {
    for (let i = 0; i < n; i++) {
      add('ribbon', lerp(u0, u1, R()), lerp(z0, z1, R()), Object.assign({
        len: lerp(len0, len1, R()), wid: 6 + R() * 5, seg: 14, lean: (R() - 0.5) * 0.5,
        curl: (R() - 0.5) * 0.5, pal: 0,
      }, o || {}));
    }
  }
  function sword(u, z, n, big) {
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      add('sword', u + (R() - 0.5) * 0.008, z + (R() - 0.5) * 0.02, {
        len: (90 + R() * 80) * big * (1 - Math.abs(t - 0.5) * 0.5), wid: (24 + R() * 12) * big, seg: 10,
        lean: (t - 0.5) * 1.9 + (R() - 0.5) * 0.2, curl: (t - 0.5) * 0.9, pal: 1,
      });
    }
  }
  function stems(u, z, n) {
    for (let i = 0; i < n; i++) {
      add('stem', u + (R() - 0.5) * 0.035, z + (R() - 0.5) * 0.05, {
        len: 150 + R() * 170, seg: 18, lean: (R() - 0.5) * 0.35, curl: (R() - 0.5) * 0.3, leaf: 13 + R() * 6, pal: 2,
      });
    }
  }
  ribbons(0.5, 0.64, 0.86, 0.97, 12, 170, 330);          // дальний фон
  ribbons(0.11, 0.25, 0.44, 0.56, 14, 230, 470);         // за левым камнем
  ribbons(0.7, 0.86, 0.54, 0.66, 15, 220, 440);          // справа
  stems(0.38, 0.64, 7);
  stems(0.92, 0.5, 6);
  sword(0.305, 0.3, 9, 1.15);
  sword(0.69, 0.33, 8, 1.0);
  sword(0.53, 0.72, 6, 0.7);
  for (let i = 0; i < 9; i++) {                           // кустики травы
    const u = 0.05 + R() * 0.9, z = 0.12 + R() * 0.78;
    ribbons(u - 0.012, u + 0.012, z, z + 0.02, 5, 36, 90, { wid: 3 + R() * 2.5, seg: 8 });
  }
  // передний план — тёмные крупные ленты по краям кадра
  ribbons(-0.01, 0.06, 0.0, 0.05, 6, 420, 700, { wid: 16, pal: 3 });
  ribbons(0.94, 1.01, 0.0, 0.04, 5, 360, 640, { wid: 15, pal: 3 });
  plants = P;
}

const PAL = [
  [[28, 62, 34], [68, 128, 52], [150, 192, 84]],    // валлиснерия
  [[26, 74, 40], [64, 142, 60], [118, 178, 76]],    // эхинодорус
  [[54, 110, 46], [150, 110, 50], [206, 78, 54]],   // стеблевые (к верху краснеют)
  [[8, 26, 24], [16, 50, 40], [40, 88, 60]],        // передний план — полусилуэт
];

function preparePlants() {
  for (const p of plants) {
    const sc = zScale(p.z), x0 = p.u * W, y0 = groundY(x0, p.z) + 4 * sc;
    const ymid = y0 - p.len * sc * 0.5;
    const f = p.pal === 3 ? 0.04 : fogAmt(p.z), fc = fogCol(ymid);
    const pal = PAL[p.pal];
    p.cols = pal.map(c => rgba(mixc(c, fc, f)));
    p.rib = rgba(mixc([190, 230, 150], fc, f), 0.28 * (1 - f));
    if (p.type === 'stem') {
      p.leafCols = [];
      for (let i = 0; i <= p.seg; i++) {
        const s = i / p.seg;
        const c = s < 0.5 ? mixc(pal[0], pal[1], s * 2) : mixc(pal[1], pal[2], (s - 0.5) * 2);
        p.leafCols.push(rgba(mixc(mulc(c, 1.1), fc, f), 0.92));
      }
      p.stemCol = rgba(mixc([60, 90, 40], fc, f));
    }
  }
}

function plantSpine(p, x0, y0, sc) {
  const n = p.seg, segL = (p.len * sc) / n, cur = S.current;
  let x = x0, y = y0;
  PX[0] = x; PY[0] = y;
  const t = time * p.sp;
  for (let i = 1; i <= n; i++) {
    const s = i / n;
    const sway = cur * (0.1 + s * 1.05) * (0.3 * Math.sin(t * 0.8 - s * 2.2 + p.ph + x0 * 0.004) +
      0.12 * Math.sin(t * 1.9 - s * 3.7 + p.ph * 1.3)) + cur * 0.12 * s * s;
    const ang = -PI / 2 + p.lean * (0.35 + 0.65 * s) + p.curl * s * s + sway;
    x += Math.cos(ang) * segL; y += Math.sin(ang) * segL;
    PX[i] = x; PY[i] = y; PA[i] = ang;
  }
  PA[0] = PA[1];
}

function smoothPoly(xs, ys, n, start) {       // сглаженная полилиния через середины отрезков
  if (start) ctx.moveTo(xs[0], ys[0]); else ctx.lineTo(xs[0], ys[0]);
  for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) * 0.5, (ys[i] + ys[i + 1]) * 0.5);
  ctx.lineTo(xs[n - 1], ys[n - 1]);
}

function drawPlant(p) {
  const sc = zScale(p.z), x0 = p.u * W, y0 = groundY(x0, p.z) + 4 * sc;
  plantSpine(p, x0, y0, sc);
  const n = p.seg;
  if (p.type === 'stem') { drawStem(p, sc); return; }
  const cur = S.current;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    let w;
    if (p.type === 'ribbon') {
      w = p.wid * sc * (1 - 0.45 * s) * (0.28 + 0.72 * Math.abs(Math.cos(s * p.tw + time * 0.35 * (0.3 + cur) + p.ph)));
      if (s > 0.8) w *= (1 - s) / 0.2;
    } else {
      w = p.wid * sc * Math.pow(Math.sin(PI * clamp(s * 0.94 + 0.06, 0, 1)), 0.75);
    }
    const nx = Math.cos(PA[i] + PI / 2) * w * 0.5, ny = Math.sin(PA[i] + PI / 2) * w * 0.5;
    LX[i] = PX[i] + nx; LY[i] = PY[i] + ny;
    RX[n - i] = PX[i] - nx; RY[n - i] = PY[i] - ny;
  }
  const g = ctx.createLinearGradient(x0, y0, PX[n], PY[n]);
  g.addColorStop(0, p.cols[0]); g.addColorStop(0.45, p.cols[1]); g.addColorStop(1, p.cols[2]);
  ctx.fillStyle = g;
  ctx.beginPath();
  smoothPoly(LX, LY, n + 1, true);
  smoothPoly(RX, RY, n + 1, false);
  ctx.closePath();
  ctx.fill();
  if (p.type === 'sword' || p.wid * sc > 9) {       // центральная жилка
    ctx.beginPath(); smoothPoly(PX, PY, n, true);
    ctx.strokeStyle = p.rib; ctx.lineWidth = Math.max(0.6, 1.3 * sc); ctx.stroke();
  }
}

function drawStem(p, sc) {
  const n = p.seg;
  ctx.beginPath(); smoothPoly(PX, PY, n + 1, true);
  ctx.strokeStyle = p.stemCol; ctx.lineWidth = Math.max(0.8, 2.2 * sc); ctx.lineCap = 'round'; ctx.stroke();
  const cur = S.current;
  for (let i = 2; i <= n; i++) {
    const s = i / n, ll = p.leaf * sc * (1 - 0.4 * s);
    const spread = 1.1 - 0.35 * s + Math.sin(time * 2.1 + i * 0.7 + p.ph) * 0.07 * (0.3 + cur);
    ctx.fillStyle = p.leafCols[i];
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const a = PA[i] + side * spread;
      const cx = PX[i] + Math.cos(a) * ll * 0.5, cy = PY[i] + Math.sin(a) * ll * 0.5;
      ctx.moveTo(cx + Math.cos(a) * ll * 0.5, cy + Math.sin(a) * ll * 0.5);
      ctx.ellipse(cx, cy, ll * 0.5, ll * 0.17, a, 0, TAU);
    }
    ctx.fill();
  }
}

// ================================================================ виды рыб
// Длины и высоты — в долях длины тела L. Профиль спины/брюха: h(s)=H·sin(π·s^pk)^pb, s — от носа к хвостовому стеблю.
const SPECIES = {
  tetra: {   // неон: стайка
    len: 31, hT: 0.125, hB: 0.12, pk: 0.62, pb: 0.72, ped: 0.045, seg: 7,
    speed: 88, turn: 4.4, beat: 5.2, amp: 0.1, kw: 5.2, zr: [0.1, 0.85],
    back: [60, 84, 82], side: [150, 176, 188], belly: [226, 222, 214], fin: [210, 226, 236], finA: 0.22,
    eyeS: 0.12, eyeV: -0.12, eyeR: 0.052, eyeCol: [190, 200, 200],
    tail: 'fork', tailL: 0.25, tailS: 0.13,
    dorsal: { a: 0.42, b: 0.54, h: 0.13, sw: 0.07 }, anal: { a: 0.58, b: 0.8, h: 0.07, sw: 0.04 },
    pect: 0.12, simple: true, band: [0.22, 0.62],
  },
  angel: {   // скалярия
    len: 135, hT: 0.36, hB: 0.36, pk: 0.8, pb: 0.85, ped: 0.06, seg: 11,
    speed: 46, turn: 1.7, beat: 1.4, amp: 0.075, kw: 4.2, zr: [0.06, 0.62],
    back: [150, 152, 150], side: [216, 220, 218], belly: [236, 234, 226], fin: [214, 220, 222], finA: 0.42,
    eyeS: 0.12, eyeV: -0.18, eyeR: 0.045, eyeCol: [196, 70, 50],
    tail: 'lyre', tailL: 0.4, tailS: 0.3,
    dorsal: { a: 0.26, b: 0.62, h: 0.66, sw: 0.36 }, anal: { a: 0.34, b: 0.66, h: 0.68, sw: 0.34 },
    filament: 0.95, pect: 0.16, band: [0.22, 0.56], scales: 1,
  },
  discus: {  // дискус
    len: 118, hT: 0.43, hB: 0.43, pk: 0.9, pb: 0.55, ped: 0.07, seg: 11,
    speed: 38, turn: 1.5, beat: 1.6, amp: 0.05, kw: 4.0, zr: [0.08, 0.7],
    back: [150, 58, 30], side: [228, 116, 46], belly: [238, 154, 74], fin: [206, 96, 46], finA: 0.72,
    eyeS: 0.13, eyeV: -0.2, eyeR: 0.05, eyeCol: [214, 56, 40],
    tail: 'fan', tailL: 0.2, tailS: 0.16,
    dorsal: { a: 0.2, b: 0.97, h: 0.11, sw: 0.03 }, anal: { a: 0.34, b: 0.97, h: 0.11, sw: 0.03 },
    pect: 0.14, band: [0.3, 0.62],
  },
  gourami: { // золотой гурами
    len: 105, hT: 0.2, hB: 0.19, pk: 0.75, pb: 0.75, ped: 0.07, seg: 10,
    speed: 58, turn: 2.2, beat: 2.2, amp: 0.085, kw: 4.8, zr: [0.06, 0.66],
    back: [150, 106, 34], side: [234, 190, 72], belly: [250, 230, 164], fin: [232, 176, 76], finA: 0.5,
    eyeS: 0.12, eyeV: -0.15, eyeR: 0.05, eyeCol: [200, 120, 50],
    tail: 'fan', tailL: 0.27, tailS: 0.2,
    dorsal: { a: 0.55, b: 0.8, h: 0.14, sw: 0.1 }, anal: { a: 0.34, b: 0.92, h: 0.16, sw: 0.1 },
    filament: 0.8, pect: 0.14, band: [0.14, 0.42], scales: 1,
  },
  cory: {    // коридорас «панда»
    len: 50, hT: 0.2, hB: 0.13, pk: 0.55, pb: 0.6, ped: 0.07, seg: 8,
    speed: 58, turn: 3.2, beat: 5.5, amp: 0.07, kw: 5.0, zr: [0.1, 0.75],
    back: [184, 178, 166], side: [228, 222, 210], belly: [238, 234, 224], fin: [206, 202, 192], finA: 0.35,
    eyeS: 0.13, eyeV: -0.3, eyeR: 0.05, eyeCol: [150, 150, 140],
    tail: 'fork', tailL: 0.25, tailS: 0.14,
    dorsal: { a: 0.25, b: 0.4, h: 0.24, sw: 0.07 }, anal: { a: 0.7, b: 0.8, h: 0.06, sw: 0.03 },
    pect: 0.16, band: [0.9, 1.0],
  },
};
for (const k in SPECIES) {              // профиль тела на узлах позвоночника
  const sp = SPECIES[k], n = sp.seg;
  sp.PT = new Float32Array(n + 1); sp.PB = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const s = i / n, q = Math.pow(s, 6);
    const base = Math.pow(Math.max(0, Math.sin(PI * Math.pow(s, sp.pk))), sp.pb);
    sp.PT[i] = sp.hT * base * (1 - q) + sp.ped * q;
    sp.PB[i] = sp.hB * base * (1 - q) + sp.ped * q;
  }
}

let fishes = [], food = [];
const schools = [];

class Fish {
  constructor(kind, school) {
    const sp = SPECIES[kind];
    this.kind = kind; this.sp = sp; this.school = school || null;
    this.size = rnd(0.86, 1.14) * (kind === 'tetra' ? rnd(0.9, 1.08) : 1);
    this.z = school ? clamp(school.gz + rnd(-0.12, 0.12), 0.04, 0.95) : rnd(sp.zr[0], sp.zr[1]);
    this.x = school ? school.gx + rnd(-90, 90) : rnd(0.12, 0.88) * W;
    const band = sp.band;
    this.y = school ? school.gy + rnd(-50, 50) : rnd(band[0], band[1]) * H;
    this.yaw = Math.random() < 0.5 ? rnd(-0.3, 0.3) : PI + rnd(-0.3, 0.3);
    this.pitch = 0; this.yawRate = 0; this.turnSide = 0;
    this.v = sp.speed * rnd(0.5, 0.9);
    this.phase = rnd(0, TAU); this.pph = rnd(0, TAU);
    this.seed = rnd(0, 100);
    this.goal = null; this.goalT = 0;
    this.rest = 0; this.restT = rnd(1, 4);   // для коридораса
    this.gulp = 0;
    this.tint = rnd(0.92, 1.08);
    this.dots = [];
    if (kind === 'gourami' || kind === 'cory') {
      const R = mulberry((this.seed * 1000) | 0);
      const n = kind === 'gourami' ? 34 : 16;
      for (let i = 0; i < n; i++) this.dots.push(0.2 + R() * 0.75, (R() - 0.5) * 1.5, (kind === 'gourami' ? 0.011 : 0.014) + R() * 0.01);
    }
    if (kind === 'cory') this.y = groundY(this.x, this.z) - 20;
  }

  halfH() { return this.sp.hT * this.sp.len * this.size * zScale(this.z); }
  lenPx() { return this.sp.len * this.size * zScale(this.z); }

  bounds() {                           // по габариту с плавниками и нитями
    const sp = this.sp, zs = zScale(this.z), Lp = this.lenPx();
    const up = (sp.hT + sp.dorsal.h * 0.7) * Lp;
    const down = (sp.hB + sp.anal.h * 0.7 + (sp.filament ? sp.filament * 0.45 : 0)) * Lp;
    const yMin = surfH * 0.75 + up;
    const yMax = this.kind === 'cory' ? groundY(this.x, this.z) - this.halfH() * 0.72 : groundY(this.x, this.z) - down - 4 * zs;
    const xm = 30 * VS + Lp * 0.55;
    return { xMin: xm, xMax: W - xm, yMin, yMax: Math.max(yMin + 10, yMax) };
  }

  pickGoal() {
    const sp = this.sp, b = this.bounds();
    let x = rnd(0.08, 0.92) * W;
    if (Math.random() < 0.65) x = this.x < W / 2 ? rnd(0.55, 0.93) * W : rnd(0.07, 0.45) * W;
    const z = clamp(lerp(this.z, rnd(sp.zr[0], sp.zr[1]), 0.8), 0.05, 0.93);
    let y = rnd(sp.band[0], sp.band[1]) * H;
    if (this.kind === 'cory') y = groundY(x, z) - this.halfH() * 1.2;
    this.goal = { x, y: clamp(y, b.yMin, b.yMax), z };
    this.goalT = rnd(6, 14);
  }

  update(dt) {
    const sp = this.sp, zs = zScale(this.z), b = this.bounds();
    let dx = 0, dy = 0, dz = 0, speedK = 1;

    // цель: корм рядом > стая/своя цель
    let tgt = null, best = 1e9;
    for (const fd of food) {
      if (fd.eaten || fd.y < surfH * 0.4) continue;
      const ddx = fd.x - this.x, ddy = fd.y - this.y, ddz = (fd.z - this.z) * DEPTH * zs;
      const d = ddx * ddx + ddy * ddy + ddz * ddz;
      if (d < best && d < Math.pow(300 * zs, 2) && this.kind !== 'cory' || (this.kind === 'cory' && fd.landed && d < best)) { best = d; tgt = fd; }
    }
    if (tgt) {
      const mx = this.x + Math.cos(this.yaw) * sp.len * this.size * zs * 0.5;
      const ex = tgt.x - mx, ey = tgt.y - this.y, ez = (tgt.z - this.z) * DEPTH;
      const d = Math.hypot(ex / zs, ey / zs, ez) + 1e-3;
      dx += (ex / zs) / d * 2.2; dy += (ey / zs) / d * 2.2; dz += ez / d * 2.2;
      speedK = 1.55;
      if (d < 9 + sp.len * this.size * 0.12) { tgt.eaten = true; this.gulp = 1; }
    } else if (this.school) {
      const g = this.school;
      const ex = g.gx - this.x, ey = g.gy - this.y, ez = (g.gz - this.z) * DEPTH;
      const d = Math.hypot(ex / zs, ey / zs, ez) + 1e-3;
      dx += (ex / zs) / d * 0.55; dy += (ey / zs) / d * 0.55; dz += ez / d * 0.55;
    } else {
      this.goalT -= dt;
      if (!this.goal || this.goalT <= 0) this.pickGoal();
      const g = this.goal;
      const ex = g.x - this.x, ey = g.y - this.y, ez = (g.z - this.z) * DEPTH;
      const d = Math.hypot(ex / zs, ey / zs, ez) + 1e-3;
      if (d < 40) this.pickGoal();
      dx += (ex / zs) / d; dy += (ey / zs) / d * 0.8; dz += ez / d;
    }

    // стая: разделение, выравнивание, сплочённость
    if (this.school) {
      let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0, cnt = 0;
      const sepR = sp.len * 2.1, nbR = sp.len * 6;
      for (const o of this.school.members) {
        if (o === this) continue;
        const ox = (o.x - this.x) / zs, oy = (o.y - this.y) / zs, oz = (o.z - this.z) * DEPTH;
        const d2 = ox * ox + oy * oy + oz * oz;
        if (d2 > nbR * nbR) continue;
        const d = Math.sqrt(d2) + 1e-3;
        if (d < sepR) { const k = (sepR - d) / sepR / d; sx -= ox * k; sy -= oy * k; sz -= oz * k; }
        const cp = Math.cos(o.pitch);
        ax += Math.cos(o.yaw) * cp; ay += Math.sin(o.pitch); az += Math.sin(o.yaw) * cp;
        cx += ox; cy += oy; cz += oz; cnt++;
      }
      if (cnt) {
        const cl = Math.hypot(cx, cy, cz) + 1e-3;
        dx += ax / cnt * 1.0 + cx / cl * 0.3 + sx * 2.6;
        dy += ay / cnt * 1.0 + cy / cl * 0.3 + sy * 2.6;
        dz += az / cnt * 1.0 + cz / cl * 0.3 + sz * 2.6;
      }
    }

    // блуждание
    const tw = time * 0.35 + this.seed;
    dy += wob(tw, 1.3) * 0.18; dz += wob(tw * 0.8, 4.1) * 0.25;

    // стенки аквариума: мягкое отталкивание — рыба разворачивается заранее
    const m = 150 * VS + this.lenPx() * 0.6;
    if (this.x < b.xMin + m) dx += Math.pow(1 - (this.x - b.xMin) / m, 2) * 4;
    if (this.x > b.xMax - m) dx -= Math.pow(1 - (b.xMax - this.x) / m, 2) * 4;
    const my = 60 * VS;
    if (this.y < b.yMin + my) dy += (1 - (this.y - b.yMin) / my) * 2.5;
    if (this.y > b.yMax - my && this.kind !== 'cory') dy -= (1 - (b.yMax - this.y) / my) * 2.5;
    if (this.z < 0.07) dz += (0.07 - this.z) * 20;
    if (this.z > 0.9) dz -= (this.z - 0.9) * 14;

    // коридорас: короткие перебежки по дну и паузы
    if (this.kind === 'cory') {
      this.restT -= dt;
      if (this.restT <= 0) { this.rest = this.rest ? 0 : 1; this.restT = this.rest ? rnd(1.2, 3.5) : rnd(0.8, 2.2); }
      if (this.rest && !tgt) speedK = 0.05;
      dy += (groundY(this.x, this.z) - this.halfH() * 1.25 - this.y) / zs * 0.05;
    }

    // желаемые курс и тангаж
    const yawD = Math.atan2(dz, dx);
    const pitchD = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.62, 0.62);
    let dYaw = angDiff(yawD, this.yaw);
    if (Math.abs(dYaw) > 2.5) {
      if (!this.turnSide) this.turnSide = (this.z > 0.5 ? -1 : 1) * (Math.cos(this.yaw) >= 0 ? 1 : -1);
      dYaw = this.turnSide * Math.abs(dYaw);
    } else if (Math.abs(dYaw) < 1.2) this.turnSide = 0;
    const maxR = sp.turn * (tgt ? 1.4 : 1);
    const rate = clamp(dYaw * 2.4, -maxR, maxR);
    this.yawRate = lerp(this.yawRate, rate, 1 - Math.exp(-dt * 5));
    this.yaw = angDiff(this.yaw + this.yawRate * dt, 0);
    this.pitch = lerp(this.pitch, pitchD * (Math.abs(dYaw) > 1.5 ? 0.4 : 1), 1 - Math.exp(-dt * 2.2));

    // скорость
    const turnSlow = 1 - 0.35 * clamp(Math.abs(this.yawRate) / sp.turn, 0, 1);
    const vT = sp.speed * (0.78 + 0.3 * wob(time * 0.27, this.seed * 3)) * speedK * turnSlow;
    this.v = lerp(this.v, Math.max(vT, 0), 1 - Math.exp(-dt * (speedK > 1 ? 2.5 : 1.2)));

    // движение
    const cp = Math.cos(this.pitch);
    this.x += this.v * Math.cos(this.yaw) * cp * zs * dt;
    this.y += this.v * Math.sin(this.pitch) * zs * dt;
    this.z += (this.v * Math.sin(this.yaw) * cp * dt) / DEPTH;
    this.z = clamp(this.z, 0.02, 0.97);
    const b2 = this.bounds();
    this.y = clamp(this.y, b2.yMin - 20, b2.yMax);
    this.x = clamp(this.x, -60, W + 60);

    // ритм хвоста и грудных плавников
    const beat = sp.beat * (0.3 + 0.7 * clamp(this.v / sp.speed, 0, 1.6) + Math.abs(this.yawRate) * 0.18);
    this.phase += dt * TAU * beat;
    this.pph += dt * TAU * (1.1 + sp.beat * 0.45);
    this.gulp = Math.max(0, this.gulp - dt * 2.5);
  }
}

function updateSchools(dt) {
  for (const s of schools) {
    s.t -= dt;
    let mx = 0, my = 0, mz = 0;
    for (const f of s.members) { mx += f.x; my += f.y; mz += f.z; }
    const n = s.members.length || 1;
    mx /= n; my /= n; mz /= n;
    const d = Math.hypot(mx - s.gx, my - s.gy);
    if (s.t <= 0 || d < 70 * VS) {
      s.gx = mx < W / 2 ? rnd(0.58, 0.9) * W : rnd(0.1, 0.42) * W;
      s.gy = rnd(0.2, 0.56) * H;
      s.gz = rnd(0.15, 0.8);
      s.t = rnd(7, 13);
    }
  }
}

function spawnFish() {
  fishes = []; schools.length = 0;
  const school = { gx: W * 0.35, gy: H * 0.42, gz: 0.45, t: 6, members: [] };
  schools.push(school);
  const nTetra = W * H > 1.2e6 ? 38 : 30;
  for (let i = 0; i < nTetra; i++) { const f = new Fish('tetra', school); school.members.push(f); fishes.push(f); }
  for (let i = 0; i < 4; i++) fishes.push(new Fish('angel'));
  for (let i = 0; i < 3; i++) fishes.push(new Fish('discus'));
  for (let i = 0; i < 3; i++) fishes.push(new Fish('gourami'));
  for (let i = 0; i < 4; i++) fishes.push(new Fish('cory'));
}

// ================================================================ отрисовка рыбы
// Позвоночник считается в «экранно-локальных» координатах в долях L: боковая волна проецируется
// и в экранную вертикаль (камера чуть выше рыбы), и в горизонталь при повороте (yaw) — поэтому
// разворот читается как настоящий поворот корпуса через ракурс «в лоб».
const SX = new Float32Array(16), SY = new Float32Array(16), NX = new Float32Array(16), NY = new Float32Array(16);
const TXa = new Float32Array(16), TYa = new Float32Array(16), BXa = new Float32Array(16), BYa = new Float32Array(16);
let _x = 0, _y = 0, _nx = 0, _ny = 0, CN = 1, CPT = null, CPB = null;

function bp(s, v) {                 // точка тела: s — вдоль (0 нос .. 1 стебель), v — -1 спина .. +1 брюхо
  const fi = clamp(s, 0, 1.3) * CN;
  let i0 = Math.floor(fi); if (i0 > CN - 1) i0 = CN - 1;
  const fr = fi - i0, fc = fr > 1 ? 1 : fr;
  const px = SX[i0] + (SX[i0 + 1] - SX[i0]) * fr, py = SY[i0] + (SY[i0 + 1] - SY[i0]) * fr;
  _nx = NX[i0] + (NX[i0 + 1] - NX[i0]) * fc; _ny = NY[i0] + (NY[i0 + 1] - NY[i0]) * fc;
  const h = v < 0 ? CPT[i0] + (CPT[i0 + 1] - CPT[i0]) * fc : CPB[i0] + (CPB[i0 + 1] - CPB[i0]) * fc;
  _x = px - _nx * v * h; _y = py - _ny * v * h;
}
function polyBP(s0, s1, v, steps, vf) {
  for (let k = 0; k <= steps; k++) {
    const s = s0 + (s1 - s0) * (k / steps);
    bp(s, vf ? vf(s, v) : v);
    if (k) ctx.lineTo(_x, _y); else ctx.moveTo(_x, _y);
  }
}

let FA = 0, FC = [0, 0, 0];
const col = (c, a) => rgba(mixc(c, FC, FA), a === undefined ? 1 : a);

function drawFin(f, fin, top, color, alpha, rays) {
  const n = CN, sg = top ? -1 : 1;
  bp(fin.a, sg); const ax = _x, ay = _y;
  bp(fin.b, sg); const bx = _x, by = _y;
  const st = fin.b + fin.sw;
  bp(Math.min(st, 1), sg);
  let tx = _x, ty = _y;
  if (st > 1) { tx += (SX[n] - SX[n - 1]) * n * (st - 1); ty += (SY[n] - SY[n - 1]) * n * (st - 1); }
  const ox = top ? _nx : -_nx, oy = top ? _ny : -_ny;
  const fl = Math.sin(f.phase * 0.5 + st * 3 + f.seed) * 0.07 * fin.h;
  const px = tx + ox * fin.h + (bx - ax) * fl, py = ty + oy * fin.h + (by - ay) * fl;
  const c1x = ax + ox * fin.h * 1.05 + (px - ax) * 0.15, c1y = ay + oy * fin.h * 1.05 + (py - ay) * 0.15;
  const c2x = bx + (px - bx) * 0.55 + ox * fin.h * 0.08, c2y = by + (py - by) * 0.55 + oy * fin.h * 0.08;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo(c1x, c1y, px, py);
  ctx.quadraticCurveTo(c2x, c2y, bx, by);
  ctx.closePath();
  const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5;
  const g = ctx.createLinearGradient(mx, my, px, py);
  g.addColorStop(0, col(color, alpha)); g.addColorStop(1, col(color, alpha * 0.35));
  ctx.fillStyle = g; ctx.fill();
  if (rays) {
    ctx.beginPath();
    for (let k = 1; k < 7; k++) {
      const t = k / 7;
      const qx = ax + (bx - ax) * t, qy = ay + (by - ay) * t;
      let ex, ey;
      if (t < 0.5) { const u = t * 2, w = 1 - u; ex = w * w * ax + 2 * w * u * c1x + u * u * px; ey = w * w * ay + 2 * w * u * c1y + u * u * py; }
      else { const u = (t - 0.5) * 2, w = 1 - u; ex = w * w * px + 2 * w * u * c2x + u * u * bx; ey = w * w * py + 2 * w * u * c2y + u * u * by; }
      ctx.moveTo(qx, qy); ctx.lineTo(qx + (ex - qx) * 0.96, qy + (ey - qy) * 0.96);
    }
    ctx.strokeStyle = col(mulc(color, 0.6), alpha * 0.45); ctx.lineWidth = 0.008; ctx.stroke();
  }
}

function drawTail(f, A, bend, acs) {
  const sp = f.sp, n = CN;
  const ex = (SX[n] - SX[n - 1]) * n, ey = (SY[n] - SY[n - 1]) * n;
  const nx = NX[n], ny = NY[n];
  const slope = A * (1.68 * Math.sin(sp.kw - f.phase) + sp.kw * Math.cos(sp.kw - f.phase)) + 2 * bend;
  const tA = Math.atan(slope * 1.3);
  const L = sp.tailL * (0.35 + 0.65 * Math.cos(tA)), Sv = sp.tailS;
  const lag = Math.sin(sp.kw * 1.35 - f.phase) * A * 0.9;
  const px = SX[n], py = SY[n], ph = sp.ped * 1.05;
  const P = (a, b) => { _x = px + ex * L * a + nx * (Sv * b + lag * a); _y = py + ey * L * a + ny * (Sv * b + lag * a); };
  ctx.beginPath();
  ctx.moveTo(px + nx * ph, py + ny * ph);
  let pts;
  if (sp.tail === 'fan') {
    pts = [[0.35, 1.0, 0.95, 0.85], [1.2, 0, 0.95, -0.85], [0.35, -1.0, 0, 0]];
  } else if (sp.tail === 'lyre') {
    pts = [[0.3, 0.85, 1.12, 1.3], [0.56, 0.42, 0.44, 0], [0.56, -0.42, 1.12, -1.3], [0.3, -0.85, 0, 0]];
  } else {
    pts = [[0.4, 0.6, 1.0, 1.0], [0.72, 0.26, 0.5, 0], [0.72, -0.26, 1.0, -1.0], [0.4, -0.6, 0, 0]];
  }
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    P(q[0], q[1]); const cx = _x, cy = _y;
    if (i === pts.length - 1) { _x = px - nx * ph; _y = py - ny * ph; } else P(q[2], q[3]);
    ctx.quadraticCurveTo(cx, cy, _x, _y);
  }
  ctx.closePath();
  P(1, 0);
  const g = ctx.createLinearGradient(px, py, _x, _y);
  const shine = 1 + 0.25 * Math.sin(tA);
  g.addColorStop(0, col(mulc(sp.fin, shine), Math.min(1, sp.finA * 1.25)));
  g.addColorStop(1, col(mulc(sp.fin, shine * 0.9), sp.finA * 0.5));
  ctx.fillStyle = g; ctx.fill();
  if (!sp.simple) {
    ctx.beginPath();
    for (let k = -3; k <= 3; k++) {
      const b = k / 3;
      const reach = sp.tail === 'fan' ? 0.95 * Math.sqrt(1 - b * b * 0.5) : (0.55 + 0.45 * Math.abs(b));
      ctx.moveTo(px, py); P(reach, b * (sp.tail === 'fan' ? 0.85 : 0.95)); ctx.lineTo(_x, _y);
    }
    ctx.strokeStyle = col(mulc(sp.fin, 0.55), sp.finA * 0.5); ctx.lineWidth = 0.008; ctx.stroke();
  }
  if (sp.tail === 'lyre') {           // тёмная оторочка лиры скалярии
    ctx.beginPath(); P(0.3, 0.85); const c1x = _x, c1y = _y; P(1.12, 1.3);
    ctx.moveTo(px + nx * ph, py + ny * ph); ctx.quadraticCurveTo(c1x, c1y, _x, _y);
    P(0.3, -0.85); const c2x = _x, c2y = _y; P(1.12, -1.3);
    ctx.moveTo(px - nx * ph, py - ny * ph); ctx.quadraticCurveTo(c2x, c2y, _x, _y);
    ctx.strokeStyle = col([30, 32, 36], 0.55); ctx.lineWidth = 0.02; ctx.stroke();
  }
}

function drawFilaments(f, acs, facing) {
  const sp = f.sp;
  for (let k = 0; k < 2; k++) {
    bp(0.3 + k * 0.03, 0.92);
    const sx = _x, sy = _y;
    const len = sp.filament * (1 - k * 0.12);
    const sw = Math.sin(f.phase * 0.33 + k * 0.8 + f.seed) * 0.07 * len;
    const bx = -facing * acs;
    const cx = sx + bx * len * 0.08 + sw * 0.5, cy = sy + len * 0.42;
    const ex = sx + bx * len * 0.5 + sw, ey = sy + len * 0.78;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.strokeStyle = col(sp.fin, 0.55); ctx.lineWidth = f.kind === 'angel' ? 0.016 : 0.011; ctx.lineCap = 'round'; ctx.stroke();
  }
}

function drawPattern(f, acs, facing) {
  const k = f.kind;
  if (k === 'tetra') {
    ctx.beginPath(); polyBP(0.46, 1.0, 0.05, 5); bp(1.05, 1.4); ctx.lineTo(_x, _y); bp(0.46, 1.4); ctx.lineTo(_x, _y); ctx.closePath();
    ctx.fillStyle = col([216, 36, 50], 0.9); ctx.fill();
    const hue = 0.5 + 0.5 * Math.sin(f.yaw * 2.3 + f.x * 0.004 + time * 0.7 + f.seed);
    const neon = mixc([40, 236, 255], [70, 116, 255], hue);
    ctx.beginPath(); polyBP(0.1, 0.86, -0.22, 6);
    ctx.lineCap = 'round';
    ctx.strokeStyle = col(neon, 0.35); ctx.lineWidth = 0.15; ctx.stroke();
    ctx.strokeStyle = col(mixc(neon, [255, 255, 255], 0.3), 0.95); ctx.lineWidth = 0.055; ctx.stroke();
  } else if (k === 'angel') {
    ctx.fillStyle = col([222, 196, 128], 0.22);
    bp(0.12, -0.55); ctx.beginPath(); ctx.ellipse(_x, _y, 0.16 * acs, 0.14, 0, 0, TAU); ctx.fill();
    const B = [[0.12, 0.065], [0.42, 0.1], [0.7, 0.075], [0.94, 0.05]];
    ctx.fillStyle = col([24, 26, 30], 0.84);
    for (const b of B) {
      ctx.beginPath();
      bp(b[0] - b[1] / 2 + 0.03, -1.5); ctx.moveTo(_x, _y);
      bp(b[0] + b[1] / 2 + 0.03, -1.5); ctx.lineTo(_x, _y);
      bp(b[0] + b[1] / 2 - 0.03, 1.5); ctx.lineTo(_x, _y);
      bp(b[0] - b[1] / 2 - 0.03, 1.5); ctx.lineTo(_x, _y);
      ctx.fill();
    }
  } else if (k === 'discus') {
    ctx.fillStyle = col([96, 30, 18], 0.14);
    for (let j = 0; j < 8; j++) {
      const c = 0.12 + j * 0.115;
      ctx.beginPath(); bp(c - 0.02, -1.5); ctx.moveTo(_x, _y); bp(c + 0.02, -1.5); ctx.lineTo(_x, _y);
      bp(c + 0.02, 1.5); ctx.lineTo(_x, _y); bp(c - 0.02, 1.5); ctx.lineTo(_x, _y); ctx.fill();
    }
    ctx.lineWidth = 0.021; ctx.lineCap = 'round';
    ctx.strokeStyle = col([74, 204, 216], 0.72);
    ctx.beginPath();
    for (let j = -4; j <= 4; j++) polyBP(0.03, 1.0, j * 0.215, 18, (s, v) => v + 0.05 * Math.sin(s * 19 + j * 1.9 + f.seed));
    ctx.stroke();
  } else if (k === 'gourami') {
    ctx.beginPath(); polyBP(0.16, 0.95, 0.02, 8);
    ctx.strokeStyle = col([120, 74, 20], 0.26); ctx.lineWidth = 0.05; ctx.stroke();
    bp(0.2, 0.6); ctx.fillStyle = col([244, 120, 40], 0.35);
    ctx.beginPath(); ctx.ellipse(_x, _y, 0.12 * acs, 0.09, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = col([255, 250, 232], 0.55);
    ctx.beginPath();
    for (let i = 0; i < f.dots.length; i += 3) { bp(f.dots[i], f.dots[i + 1] * 0.8); ctx.moveTo(_x + f.dots[i + 2], _y); ctx.arc(_x, _y, f.dots[i + 2], 0, TAU); }
    ctx.fill();
  } else if (k === 'cory') {
    ctx.fillStyle = col([58, 54, 48], 0.4);
    ctx.beginPath();
    for (let i = 0; i < f.dots.length; i += 3) { bp(f.dots[i], f.dots[i + 1] * 0.7); ctx.moveTo(_x + f.dots[i + 2], _y); ctx.arc(_x, _y, f.dots[i + 2], 0, TAU); }
    ctx.fill();
    ctx.fillStyle = col([30, 30, 32], 0.9);
    bp(0.13, -0.3); ctx.beginPath(); ctx.ellipse(_x, _y, 0.085 * Math.max(acs, 0.5), 0.14, 0, 0, TAU); ctx.fill();
    bp(0.92, -0.15); ctx.beginPath(); ctx.ellipse(_x, _y, 0.06 * Math.max(acs, 0.5), 0.1, 0, 0, TAU); ctx.fill();
  }
}

function drawScales(f, acs, facing) {  // чешуя: дуги, выпуклые к хвосту, в шахматном порядке
  const sp = f.sp, cols = 24, rows = 10, r = 0.022;
  const rx = r * Math.max(acs, 0.35), ry = r * 0.85, a0 = facing > 0 ? PI * 0.5 : -PI * 0.5;
  ctx.beginPath();
  for (let i = 0; i < cols; i++) {
    const s = 0.2 + ((i + 0.5) / cols) * 0.76;
    for (let j = 0; j < rows; j++) {
      const v = -0.88 + ((j + (i & 1) * 0.5) / rows) * 1.76;
      bp(s, v);
      ctx.moveTo(_x + Math.cos(a0) * rx, _y + Math.sin(a0) * ry);
      ctx.ellipse(_x, _y, rx, ry, 0, a0, a0 + PI);
    }
  }
  ctx.strokeStyle = col(mulc(sp.side, 0.5), 0.2); ctx.lineWidth = 0.0055; ctx.stroke();
}

function drawFish(f) {
  const sp = f.sp, n = sp.seg, zs = zScale(f.z);
  const Lpx = sp.len * f.size * zs;
  if (f.x < -Lpx * 1.5 || f.x > W + Lpx * 1.5) return;
  FA = fogAmt(f.z); FC = fogCol(f.y);
  CN = n; CPT = sp.PT; CPB = sp.PB;
  const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
  const facing = cy >= 0 ? 1 : -1, acs = Math.max(Math.abs(cy), 0.26), cs = facing * acs;
  const spd = clamp(f.v / sp.speed, 0, 1.6);
  const A = sp.amp * (0.45 + 0.6 * spd) + Math.min(Math.abs(f.yawRate) * 0.015, 0.05);
  const bend = clamp(-f.yawRate * 0.09, -0.28, 0.28);
  for (let i = 0; i <= n; i++) {
    const s = i / n, env = 0.16 + 0.84 * s * s;
    const lat = A * env * Math.sin(sp.kw * s - f.phase) + bend * s * s;
    SX[i] = (0.5 - s) * cs - lat * sy * 0.9;
    SY[i] = lat * 0.34 * acs;
  }
  for (let i = 0; i <= n; i++) {
    const i0 = i > 0 ? i - 1 : 0, i1 = i < n ? i + 1 : n;
    let tx = SX[i1] - SX[i0], ty = SY[i1] - SY[i0];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    let nx = -ty, ny = tx; if (ny > 0) { nx = -nx; ny = -ny; }
    NX[i] = nx; NY[i] = ny;
    TXa[i] = SX[i] + nx * sp.PT[i]; TYa[i] = SY[i] + ny * sp.PT[i];
    BXa[i] = SX[i] - nx * sp.PB[i]; BYa[i] = SY[i] - ny * sp.PB[i];
  }

  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.pitch * facing);
  ctx.scale(Lpx, Lpx);

  // плавники позади корпуса
  const finCol = sp.fin;
  drawFin(f, sp.dorsal, true, f.kind === 'cory' ? [36, 36, 40] : finCol, f.kind === 'cory' ? 0.8 : sp.finA, !sp.simple);
  drawFin(f, sp.anal, false, finCol, sp.finA, !sp.simple);
  drawTail(f, A, bend, acs);
  if (sp.filament) drawFilaments(f, acs, facing);

  // корпус
  const body = new Path2D();
  body.moveTo(SX[0], SY[0]);
  for (let i = 1; i < n; i++) body.quadraticCurveTo(TXa[i], TYa[i], (TXa[i] + TXa[i + 1]) * 0.5, (TYa[i] + TYa[i + 1]) * 0.5);
  body.lineTo(TXa[n], TYa[n]);
  body.lineTo(BXa[n], BYa[n]);
  for (let i = n - 1; i > 0; i--) body.quadraticCurveTo(BXa[i], BYa[i], (BXa[i] + BXa[i - 1]) * 0.5, (BYa[i] + BYa[i - 1]) * 0.5);
  body.closePath();
  const g = ctx.createLinearGradient(0, -sp.hT, 0, sp.hB);
  g.addColorStop(0, col(mulc(sp.back, f.tint)));
  g.addColorStop(0.42, col(mulc(sp.side, f.tint)));
  g.addColorStop(0.8, col(sp.belly));
  g.addColorStop(1, col(mulc(sp.belly, 0.7)));
  ctx.fillStyle = g; ctx.fill(body);

  ctx.save();
  ctx.clip(body);
  drawPattern(f, acs, facing);
  if (sp.scales && FA < 0.6) drawScales(f, acs, facing);
  if (!sp.simple) {                   // объём: затемнение к носу и хвосту
    const hg = ctx.createLinearGradient(SX[0], 0, SX[n], 0);
    hg.addColorStop(0, 'rgba(0,12,16,0.18)'); hg.addColorStop(0.28, 'rgba(0,12,16,0)');
    hg.addColorStop(0.7, 'rgba(0,12,16,0)'); hg.addColorStop(1, 'rgba(0,12,16,0.22)');
    ctx.fillStyle = hg; ctx.fillRect(-1, -1, 2, 2);
  }
  // блик по спине + подсветка каустиками
  const caus = clamp(causticAt(f.x, f.z) * 1.2, 0, 1);
  const lit = (0.1 + 0.4 * caus) * (1 - FA) * S.light;
  ctx.beginPath(); polyBP(0.08, 0.82, -0.52, 7);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(235,252,255,' + (lit * 0.8).toFixed(3) + ')'; ctx.lineWidth = sp.hT * (sp.simple ? 0.3 : 0.16); ctx.stroke();
  ctx.beginPath(); polyBP(0.02, 1.0, -1, 8);
  ctx.strokeStyle = 'rgba(190,240,250,' + (0.35 * (1 - FA) * S.light).toFixed(3) + ')'; ctx.lineWidth = 0.03; ctx.stroke();
  ctx.restore();

  // жаберная крышка, глаз, рот
  const gS = sp.eyeS + (sp.simple ? 0.1 : 0.12);
  ctx.beginPath(); bp(gS, -0.7); ctx.moveTo(_x, _y); bp(gS + 0.06, 0.05); const qx = _x, qy = _y; bp(gS, 0.8);
  ctx.quadraticCurveTo(qx, qy, _x, _y);
  ctx.strokeStyle = col([20, 24, 26], 0.24); ctx.lineWidth = 0.013; ctx.stroke();
  bp(sp.eyeS, sp.eyeV);
  const ex = _x, ey = _y, r = sp.eyeR, rx = r * Math.max(acs, 0.5);
  ctx.fillStyle = col([16, 18, 20], 0.9); ctx.beginPath(); ctx.ellipse(ex, ey, rx * 1.15, r * 1.15, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = col(sp.eyeCol); ctx.beginPath(); ctx.ellipse(ex, ey, rx, r, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = col([6, 6, 8]); ctx.beginPath(); ctx.ellipse(ex + facing * rx * 0.1, ey, rx * 0.6, r * 0.6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * (1 - FA * 0.8)).toFixed(3) + ')';
  ctx.beginPath(); ctx.ellipse(ex + facing * rx * 0.3, ey - r * 0.38, rx * 0.24, r * 0.24, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(SX[0], SY[0]); bp(0.04 + f.gulp * 0.02, 0.2 + f.gulp * 0.3); ctx.lineTo(_x, _y);
  ctx.strokeStyle = col([30, 20, 20], 0.4); ctx.lineWidth = 0.012; ctx.stroke();
  if (f.kind === 'cory') {            // усики
    ctx.beginPath();
    for (let k = 0; k < 2; k++) {
      bp(0.02, 0.35); ctx.moveTo(_x, _y);
      ctx.quadraticCurveTo(_x + facing * acs * 0.04, _y + 0.08, _x + facing * acs * (0.02 + k * 0.03), _y + 0.12 + k * 0.02);
    }
    ctx.strokeStyle = col([214, 204, 186], 0.75); ctx.lineWidth = 0.012; ctx.stroke();
  }

  // ближний грудной плавник
  {
    bp(sp.eyeS + 0.15, 0.25);
    const bx = _x, by = _y;
    const ang = 0.45 + 0.4 * Math.sin(f.pph);
    const dx = -facing * Math.cos(ang) * Math.max(acs, 0.45), dy = Math.sin(ang);
    const len = sp.pect * (0.9 + 0.15 * Math.sin(f.pph + 1.2));
    const tx = bx + dx * len, ty = by + dy * len, pw = len * 0.3;
    ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + dx * len * 0.5 - dy * pw, by + dy * len * 0.5 + dx * pw, tx, ty);
    ctx.quadraticCurveTo(bx + dx * len * 0.5 + dy * pw, by + dy * len * 0.5 - dx * pw, bx, by);
    ctx.fillStyle = col(mulc(sp.fin, 1.05), Math.min(1, sp.finA * 1.1)); ctx.fill();
  }
  ctx.restore();
}

function drawFishShadow(f) {
  const zs = zScale(f.z), gy = groundY(f.x, f.z);
  if (gy > H + 10) return;
  const h = gy - f.y;
  const k = 1 - clamp(h / (H * 0.55), 0, 1);
  const a = 0.32 * k * k * (1 - fogAmt(f.z) * 0.7) * clamp(S.light, 0.2, 1.2);
  if (a < 0.01) return;
  const w = f.sp.len * f.size * zs * (1.2 + (1 - k) * 0.8);
  const x = f.x + (f.x - SUN_U * W) * 0.04 * (1 - k);
  ctx.globalAlpha = a;
  ctx.drawImage(shadowSprite, x - w * 0.5, gy - w * 0.1, w, w * 0.2);
  ctx.globalAlpha = 1;
}

// ================================================================ пузырьки
const EMITTERS = [
  { u: 0.236, z: 0.5, rate: 7, acc: 0 },     // из-за левого камня
  { u: 0.815, z: 0.43, rate: 4.5, acc: 0 },  // справа
  { u: 0.5, z: 0.25, rate: 0, acc: 0 },      // случайные со дна
];
let bubbles = [];
const bubbleGroups = EMITTERS.map((e, i) => ({ kind: 'bubbles', z: e.z, idx: i }));

function updateBubbles(dt) {
  EMITTERS.forEach((e, i) => {
    if (i === 2) {
      if (Math.random() < dt * 1.3) {
        const z = rnd(0.1, 0.9), x = rnd(0.05, 0.95) * W;
        bubbles.push(newBubble(x, groundY(x, z) - 3, z, rnd(1, 2.4), 2));
      }
      return;
    }
    const burst = 0.35 + 1.1 * Math.max(0, Math.sin(time * 0.55 + i * 2.3)) + 0.3 * Math.sin(time * 3.1 + i);
    e.acc += dt * e.rate * Math.max(0.1, burst);
    while (e.acc > 1) {
      e.acc -= 1;
      const zs = zScale(e.z), x = e.u * W + rnd(-5, 5) * zs;
      bubbles.push(newBubble(x, groundY(e.u * W, e.z) - 6 * zs, e.z + rnd(-0.02, 0.02), Math.random() < 0.15 ? rnd(3.2, 5.2) : rnd(1.1, 3), i));
    }
  });
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i], zs = zScale(b.z);
    b.age += dt;
    b.y -= (32 + b.r * 15) * zs * dt * Math.min(1, b.age * 3);
    b.x0 += S.current * 14 * zs * dt;
    b.x = b.x0 + Math.sin(b.age * b.w + b.ph) * b.r * 1.3 * zs;
    if (b.y < surfH * 0.1) bubbles.splice(i, 1);
  }
}
function newBubble(x, y, z, r, g) { return { x, x0: x, y, y0: y, z, r, g, ph: rnd(0, TAU), w: rnd(4, 8), age: 0 }; }

function drawBubbleGroup(gi) {
  for (const b of bubbles) {
    if (b.g !== gi) continue;
    const zs = zScale(b.z);
    const grow = 1 + (b.y0 - b.y) / H * 0.35;
    const r = b.r * zs * grow;
    const wob = b.r > 3 ? 1 + 0.1 * Math.sin(b.age * 11 + b.ph) : 1;
    ctx.globalAlpha = clamp(0.95 - fogAmt(b.z) * 0.6, 0.2, 1) * Math.min(1, b.age * 4);
    ctx.drawImage(bubbleSprite, b.x - r * wob, b.y - r / wob, r * 2 * wob, r * 2 / wob);
  }
  ctx.globalAlpha = 1;
}

// ================================================================ взвесь (морской снег) и боке
let motes = [];
function initMotes() {
  motes = [];
  const n = Math.min(260, (W * H) / 9000) | 0;
  for (let i = 0; i < n; i++) motes.push({ x: rnd(0, W), y: rnd(0, H), z: rnd(0, 1), s: rnd(0.5, 1.7), ph: rnd(0, 100), vy: rnd(-2, 7), bok: false });
  for (let i = 0; i < 16; i++) motes.push({ x: rnd(0, W), y: rnd(0, H), z: 0, s: rnd(7, 24), ph: rnd(0, 100), vy: rnd(-4, 5), bok: true });
}
function updateMotes(dt) {
  for (const m of motes) {
    const zs = m.bok ? 1.6 * VS : zScale(m.z);
    m.x += (S.current * 16 + wob(time * 0.21, m.ph) * 7) * zs * dt;
    m.y += (m.vy + wob(time * 0.17, m.ph * 1.7) * 5) * zs * dt;
    if (m.x > W + 30) m.x -= W + 60; else if (m.x < -30) m.x += W + 60;
    if (m.y > H + 30) m.y -= H + 60; else if (m.y < -30) m.y += H + 60;
  }
}
function drawMotes() {
  ctx.globalCompositeOperation = 'lighter';
  const sunX = SUN_U * W;
  for (const m of motes) {
    if (m.bok) {
      ctx.globalAlpha = (0.035 + 0.03 * Math.sin(time * 0.5 + m.ph)) * (0.5 + 0.5 * S.light);
      ctx.drawImage(dotSprite, m.x - m.s, m.y - m.s, m.s * 2, m.s * 2);
      continue;
    }
    const zs = zScale(m.z), s = m.s * zs * 1.6;
    const dx = (m.x - sunX) / W;
    const lit = (0.35 + 0.65 * (1 - m.y / H)) * (0.5 + 0.8 * Math.exp(-dx * dx * 6)) * S.light;
    const tw = 0.75 + 0.25 * Math.sin(time * 1.7 + m.ph * 3);
    ctx.globalAlpha = clamp(0.5 * lit * tw * (1 - fogAmt(m.z) * 0.6), 0, 1);
    ctx.drawImage(dotSprite, m.x - s, m.y - s, s * 2, s * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ================================================================ корм
const FOODC = [[206, 92, 48], [226, 172, 72], [132, 150, 62], [190, 60, 44]];
function dropFood(x, y) {
  const n = 12 + ((Math.random() * 6) | 0);
  for (let i = 0; i < n; i++) {
    food.push({
      x: x + rnd(-28, 28), y: Math.max(y, surfH * 0.55) + rnd(-12, 12), z: clamp(rnd(0.15, 0.75), 0, 1),
      vy: rnd(12, 24), rot: rnd(0, TAU), vr: rnd(-2.5, 2.5), s: rnd(2, 3.8), c: FOODC[(Math.random() * FOODC.length) | 0],
      landed: false, life: 16, eaten: false,
    });
  }
}
function updateFood(dt) {
  for (let i = food.length - 1; i >= 0; i--) {
    const f = food[i], zs = zScale(f.z);
    if (f.eaten) { food.splice(i, 1); continue; }
    if (!f.landed) {
      f.y += f.vy * zs * dt * (1 + 0.35 * Math.sin(time * 2.2 + f.rot));
      f.x += (Math.sin(time * 1.3 + f.rot * 3) * 9 + S.current * 8) * zs * dt;
      f.rot += f.vr * dt;
      const gy = groundY(f.x, f.z) - 2 * zs;
      if (f.y >= gy) { f.y = gy; f.landed = true; }
    } else {
      f.life -= dt;
      if (f.life <= 0) food.splice(i, 1);
    }
  }
}
function drawFood() {
  for (const f of food) {
    const zs = zScale(f.z), s = f.s * zs;
    ctx.save();
    ctx.translate(f.x, f.y); ctx.rotate(f.rot);
    ctx.globalAlpha = f.landed ? clamp(f.life / 3, 0, 1) : 1;
    ctx.fillStyle = rgba(mixc(f.c, fogCol(f.y), fogAmt(f.z)));
    ctx.beginPath(); ctx.moveTo(-s, -s * 0.4); ctx.lineTo(s * 0.7, -s * 0.6); ctx.lineTo(s, s * 0.3); ctx.lineTo(-s * 0.5, s * 0.6); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// ================================================================ лучи света
let rays = [];
function initRays() {
  const R = mulberry(99);
  rays = [];
  for (let i = 0; i < 12; i++) {
    const u = SUN_U + (R() - 0.5) * 1.05;
    rays.push({ u, w: 40 + R() * 150, ph: R() * TAU, sp: 0.6 + R() * 0.8, len: 0.75 + R() * 0.4, k: 0.55 + 0.45 * Math.exp(-Math.pow((u - SUN_U) * 2.2, 2)) });
  }
  rays.push({ u: SUN_U, w: 520, ph: 1, sp: 0.3, len: 1.0, k: 0.45, wide: true });
}
function drawRays() {
  const sunX = SUN_U * W, sunY = -H * 1.1, L = S.light;
  if (L <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const r of rays) {
    const x0 = r.u * W + Math.sin(time * 0.06 * r.sp + r.ph) * W * 0.025;
    const dx = x0 - sunX, dy = -sunY, dl = Math.hypot(dx, dy);
    const phi = Math.atan2(-dx / dl, dy / dl);
    const pulse = (0.5 + 0.5 * Math.sin(time * 0.33 * r.sp + r.ph)) * (0.65 + 0.35 * Math.sin(time * 0.91 * r.sp + r.ph * 2.1));
    const a = (r.wide ? 0.08 : 0.045 + 0.13 * pulse) * r.k * L;
    const w = r.w * VS * (r.wide ? 1 : 0.85 + 0.3 * Math.sin(time * 0.2 * r.sp + r.ph));
    ctx.setTransform(RS, 0, 0, RS, 0, 0);
    ctx.translate(x0, -8); ctx.rotate(phi);
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.drawImage(raySprite, -w / 2, 0, w, H * r.len * 1.05);
  }
  ctx.restore();
}

// ================================================================ пост-обработка: дымка, виньетка, зерно
function drawPost() {
  // мутная дымка: рассеянный свет в толще
  let g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(120,200,210,0.05)');
  g.addColorStop(0.45, 'rgba(60,150,170,0.09)');
  g.addColorStop(0.8, 'rgba(20,80,100,0.05)');
  g.addColorStop(1, 'rgba(6,30,44,0.12)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // виньетка
  const R = Math.hypot(W, H) * 0.5;
  g = ctx.createRadialGradient(W * 0.54, H * 0.42, R * 0.35, W * 0.5, H * 0.5, R * 1.08);
  g.addColorStop(0, 'rgba(0,10,18,0)');
  g.addColorStop(0.6, 'rgba(0,10,18,0.28)');
  g.addColorStop(1, 'rgba(0,8,16,0.7)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // плёночное зерно
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.05;
  const pat = ctx.createPattern(grainCanvas, 'repeat');
  const ox = (Math.random() * 128) | 0, oy = (Math.random() * 128) | 0;
  ctx.translate(-ox, -oy);
  ctx.fillStyle = pat; ctx.fillRect(0, 0, cv.width + 128, cv.height + 128);
  ctx.restore();
}

// ================================================================ кадр
const items = [];
function render() {
  ctx.setTransform(RS, 0, 0, RS, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bgCanvas, 0, 0, W, H);
  drawSurface();
  drawFloorCaustics();
  for (const f of fishes) drawFishShadow(f);

  items.length = 0;
  for (const r of rocks) items.push(r);
  for (const p of plants) items.push(p);
  for (const f of fishes) items.push(f);
  for (const b of bubbleGroups) items.push(b);
  items.sort((a, b) => b.z - a.z);
  for (const it of items) {
    if (it.kind === 'rock') drawRock(it);
    else if (it.kind === 'plant') drawPlant(it);
    else if (it.kind === 'bubbles') drawBubbleGroup(it.idx);
    else drawFish(it);
  }
  drawFood();
  drawRays();
  drawMotes();
  drawPost();
}

function update(dt) {
  updateSchools(dt);
  for (const f of fishes) f.update(dt);
  updateBubbles(dt);
  updateMotes(dt);
  updateFood(dt);
}

// ---------------------------------------------------------------- размер и качество
function resize() {
  W = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 800);
  H = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 600);
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  RS = DPR * qual;
  cv.width = Math.round(W * RS); cv.height = Math.round(H * RS);
  VS = clamp(Math.min(W * 0.72, H) / 820, 0.55, 1.6);
  buildBackground();
  buildRocks();
  preparePlants();
  buildCausticBuffers();
}

let perfAcc = 0, perfN = 0, perfT = 0, downgrades = 0;
function adaptQuality(work, dt) {
  perfAcc += work; perfN++; perfT += dt;
  if (perfT < 3) return;
  const avg = perfAcc / perfN;
  perfAcc = 0; perfN = 0; perfT = 0;
  if (avg > 19 && qual > 0.62) { qual = Math.max(0.62, qual * 0.84); downgrades++; resize(); }
  else if (avg < 6 && qual < 1 && downgrades < 3) { qual = Math.min(1, qual / 0.84); resize(); }
}

// ---------------------------------------------------------------- цикл
let last = performance.now(), needCaustic = true;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.05) dt = 0.05;
  const t0 = performance.now();
  if (!S.paused) { time += dt; update(dt); needCaustic = true; }
  if (needCaustic) { computeCaustics(time * 0.42 + 23); needCaustic = false; }
  renderFloorCaustics();
  renderSurface();
  render();
  if (!S.paused) adaptQuality(performance.now() - t0, dt);
}

// ---------------------------------------------------------------- интерфейс
const $ = (id) => document.getElementById(id);
$('feed').addEventListener('click', () => dropFood(rnd(0.28, 0.72) * W, surfH * 0.7));
$('light').addEventListener('input', (e) => { S.light = e.target.value / 100; });
$('current').addEventListener('input', (e) => { S.current = e.target.value / 100; });
const pauseBtn = $('pause');
function togglePause() { S.paused = !S.paused; pauseBtn.textContent = S.paused ? 'Дальше' : 'Пауза'; last = performance.now(); }
pauseBtn.addEventListener('click', togglePause);
cv.addEventListener('pointerdown', (e) => { dropFood(e.clientX, e.clientY); });
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); togglePause(); } });
let rsT = 0;
window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(resize, 120); });
S.light = $('light').value / 100;
S.current = $('current').value / 100;

// ---------------------------------------------------------------- старт
buildSprites();
genPlants();
resize();
spawnFish();
initMotes();
initRays();
for (let i = 0; i < 150; i++) { time += 1 / 30; update(1 / 30); }   // прогрев: стая успевает собраться
requestAnimationFrame((t) => { last = t; frame(t); });
})();
