/* 3D-аквариум — Claude Opus 5.5
   Чистый Canvas 2D без библиотек и WebGL: ручная перспективная проекция,
   алгоритм художника, объёмный туман, каустики, лучи, живые рыбы. */
(() => {
'use strict';

// ════════════ утилиты ════════════
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const c255 = (v) => (v > 255 ? 255 : v < 0 ? 0 : v | 0);
const rgb = (r, g, b) => 'rgb(' + c255(r) + ',' + c255(g) + ',' + c255(b) + ')';
const rgba = (r, g, b, a) => 'rgba(' + c255(r) + ',' + c255(g) + ',' + c255(b) + ',' + clamp(a, 0, 1).toFixed(3) + ')';
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RND = mulberry(0x5eed2026);
const rand = (a, b) => a + (b - a) * RND();
const pick = (arr) => arr[(RND() * arr.length) | 0];

// ── 3D-векторы ──
const V = (x, y, z) => ({ x, y, z });
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, k) => V(a.x * k, a.y * k, a.z * k);
const madd = (a, b, k) => V(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
const norm = (a) => { const l = len(a) || 1; return V(a.x / l, a.y / l, a.z / l); };
const vlerp = (a, b, t) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

// ── быстрый синус по таблице (для каустик) ──
const SN = 4096, SMASK = SN - 1, SK = SN / TAU;
const SIN_T = new Float32Array(SN);
for (let i = 0; i < SN; i++) SIN_T[i] = Math.sin(i / SK);
const fsin = (x) => SIN_T[((x * SK) | 0) & SMASK];
const fcos = (x) => SIN_T[((x * SK + SN / 4) | 0) & SMASK];

// ── value-noise ──
const PERM = new Uint8Array(512);
{
  const p = [];
  for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) { const j = (RND() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const HV = new Float32Array(256);
for (let i = 0; i < 256; i++) HV[i] = RND();
function vnoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smooth(x - xi), v = smooth(y - yi);
  const X = xi & 255, Y = yi & 255;
  const a = HV[PERM[PERM[X] + Y]], b = HV[PERM[PERM[X + 1] + Y]];
  const c = HV[PERM[PERM[X] + Y + 1]], d = HV[PERM[PERM[X + 1] + Y + 1]];
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  const h = (a, b, c) => HV[PERM[PERM[PERM[a] + b] + c]];
  const x00 = lerp(h(X, Y, Z), h(X + 1, Y, Z), u);
  const x10 = lerp(h(X, Y + 1, Z), h(X + 1, Y + 1, Z), u);
  const x01 = lerp(h(X, Y, Z + 1), h(X + 1, Y, Z + 1), u);
  const x11 = lerp(h(X, Y + 1, Z + 1), h(X + 1, Y + 1, Z + 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
function fbm2(x, y, oct) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// ════════════ мир ════════════
// Объём воды: x ∈ [-TW, TW], y ∈ [0, TH] (y — вверх), z ∈ [-TD, TD]; камера снаружи, со стороны +z.
const TW = 10, TH = 9, TD = 6;
const floorY = (z) => 0.35 + ((TD - z) / (2 * TD)) * 1.75;   // песок поднимается к задней стенке
const LIGHT = norm(V(0.22, -1, 0.12));                      // направление света (сверху)
const TOLIGHT = mul(LIGHT, -1);
const UPW = V(0, 1, 0);

const S = { fog: 0.058, light: 1, orbit: true, paused: false };

// ════════════ холст ════════════
const cv = document.getElementById('scene');
const ctx = cv.getContext('2d', { alpha: false });
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
let DPR = 1, WW = 1, HH = 1, qScale = 1;
const glow1 = mk(1, 1), g1 = glow1.getContext('2d');
const glow2 = mk(1, 1), g2 = glow2.getContext('2d');
function resize() {
  const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
  let d = Math.min(2, window.devicePixelRatio || 1) * qScale;
  const maxPix = 3.8e6;
  if (w * h * d * d > maxPix) d = Math.sqrt(maxPix / (w * h));
  DPR = d; WW = Math.max(1, Math.round(w * d)); HH = Math.max(1, Math.round(h * d));
  cv.width = WW; cv.height = HH;
  glow1.width = Math.max(1, WW >> 2); glow1.height = Math.max(1, HH >> 2);
  glow2.width = Math.max(1, WW >> 4); glow2.height = Math.max(1, HH >> 4);
}
window.addEventListener('resize', resize);
resize();

// ════════════ камера ════════════
const cam = { pos: V(0, 6, 24), fwd: V(0, 0, -1), right: V(1, 0, 0), up: V(0, 1, 0), f: 1000, cx: 0, cy: 0, yaw: 0 };
const camCtl = { autoT: 0, dragYaw: 0, dragH: 0, zoom: 0 };
const CAM_R = 24.5;
function updateCamera(t) {
  const a = camCtl.autoT;
  const yaw = 0.34 * Math.sin(a * 0.055) + 0.07 * Math.sin(a * 0.143 + 1.3) + camCtl.dragYaw;
  const r = CAM_R + 1.6 * Math.sin(a * 0.041 + 0.7) + camCtl.zoom;
  const hy = 6.0 + 0.9 * Math.sin(a * 0.071 + 2.1) + camCtl.dragH;
  // «ручная» микротряска оператора
  const jx = 0.05 * Math.sin(t * 0.83) + 0.03 * Math.sin(t * 1.91 + 0.4);
  const jy = 0.04 * Math.sin(t * 0.67 + 1.2) + 0.02 * Math.sin(t * 2.3);
  cam.yaw = yaw;
  cam.pos = V(r * Math.sin(yaw) + jx, hy + jy, r * Math.cos(yaw));
  const tgt = V(0.7 * Math.sin(a * 0.047), 4.3 + 0.3 * Math.sin(a * 0.063), -0.5);
  const fwd = norm(sub(tgt, cam.pos));
  const right = norm(cross(fwd, UPW));
  const up = cross(right, fwd);
  const roll = 0.012 * Math.sin(a * 0.09) + 0.003 * Math.sin(t * 0.7);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  cam.fwd = fwd;
  cam.right = V(right.x * cr + up.x * sr, right.y * cr + up.y * sr, right.z * cr + up.z * sr);
  cam.up = V(up.x * cr - right.x * sr, up.y * cr - right.y * sr, up.z * cr - right.z * sr);
  // фокусное расстояние: передняя стенка вписана в экран
  const dist = CAM_R - TD;
  const fitW = WW * 0.97 * dist / (2 * TW), fitH = HH * 0.86 * dist / TH;
  cam.f = Math.max(Math.min(fitW, fitH), fitH * 0.55);
  cam.cx = WW * 0.5; cam.cy = HH * 0.5;
}

// перспективная проекция точки: экранные x,y, масштаб s = f/z и глубина z
function proj(p) {
  const dx = p.x - cam.pos.x, dy = p.y - cam.pos.y, dz = p.z - cam.pos.z;
  const F = cam.fwd, R = cam.right, U = cam.up;
  let z = dx * F.x + dy * F.y + dz * F.z;
  if (z < 0.05) z = 0.05;
  const x = dx * R.x + dy * R.y + dz * R.z;
  const y = dx * U.x + dy * U.y + dz * U.z;
  const s = cam.f / z;
  return { x: cam.cx + x * s, y: cam.cy - y * s, s, z, px: x / z, py: y / z };
}
// проекция малого вектора v, приложенного в точке с проекцией P (якобиан перспективы)
function projVec(P, v) {
  const F = cam.fwd, R = cam.right, U = cam.up;
  const vx = v.x * R.x + v.y * R.y + v.z * R.z;
  const vy = v.x * U.x + v.y * U.y + v.z * U.z;
  const vz = v.x * F.x + v.y * F.y + v.z * F.z;
  return { x: P.s * (vx - P.px * vz), y: -P.s * (vy - P.py * vz) };
}

// ════════════ вода: туман, цвет глубины, освещённость ════════════
// путь луча зрения внутри воды: от входа в стеклянный объём до точки
function waterDist(p) {
  const o = cam.pos;
  const dx = p.x - o.x, dy = p.y - o.y, dz = p.z - o.z;
  let t0 = 0;
  if (dx !== 0) { const a = (-TW - o.x) / dx, b = (TW - o.x) / dx; t0 = Math.max(t0, Math.min(a, b)); }
  if (dy !== 0) { const a = (-1 - o.y) / dy, b = (TH - o.y) / dy; t0 = Math.max(t0, Math.min(a, b)); }
  if (dz !== 0) { const a = (-TD - o.z) / dz, b = (TD - o.z) / dz; t0 = Math.max(t0, Math.min(a, b)); }
  if (t0 > 1) t0 = 1;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * (1 - t0);
}
const fogOf = (p) => 1 - Math.exp(-S.fog * waterDist(p));
const WATER_TOP = [70, 174, 188], WATER_MID = [22, 104, 138], WATER_DEEP = [7, 42, 74];
function waterCol(y) {
  const t = clamp(1 - y / TH, 0, 1);
  return t < 0.5 ? mix3(WATER_TOP, WATER_MID, t * 2) : mix3(WATER_MID, WATER_DEEP, (t - 0.5) * 2);
}
// среда в точке: f — туман, l — освещённость по глубине, ar/ag — поглощение красного/зелёного, fc — цвет воды
function envAt(p) {
  const t = clamp(p.y / TH, 0, 1);
  return { f: fogOf(p), l: 0.46 + 0.54 * Math.pow(t, 0.85), ar: 0.6 + 0.4 * t, ag: 0.85 + 0.15 * t,
           fc: waterCol(lerp(p.y, cam.pos.y, 0.3)) };
}
// итоговый цвет поверхности: собственный цвет c, множитель света k
function col(c, k, E, a) {
  const m = k * E.l * (1 - E.f), f = E.f;
  const r = c[0] * E.ar * m + E.fc[0] * f, g = c[1] * E.ag * m + E.fc[1] * f, b = c[2] * m + E.fc[2] * f;
  return a === undefined ? rgb(r, g, b) : rgba(r, g, b, a);
}
// «сырой» цвет — только поглощение; свет и туман потом накладываются одной заливкой overlayOf
function raw(c, k, E, a) {
  const r = c[0] * E.ar * k, g = c[1] * E.ag * k, b = c[2] * k;
  return a === undefined ? rgb(r, g, b) : rgba(r, g, b, a);
}
function overlayOf(E) {
  const a = 1 - E.l * (1 - E.f);
  if (a < 0.004) return null;
  return rgba(E.fc[0] * E.f / a, E.fc[1] * E.f / a, E.fc[2] * E.f / a, a);
}

// ════════════ текстуры ════════════
// Дно — плоскость, текстура в мировых координатах: x → столбцы, z (от задней стенки) → строки.
const PPU = 44;
const FTW = Math.round(2 * TW * PPU), FTH = Math.round(2 * TD * PPU);
const sandCv = mk(FTW, FTH), sandCtx = sandCv.getContext('2d');
const floorCv = mk(FTW, FTH), fctx = floorCv.getContext('2d');

function buildSand() {
  const img = sandCtx.createImageData(FTW, FTH), d = img.data;
  for (let j = 0; j < FTH; j++) {
    const wz = -TD + (j / FTH) * 2 * TD;
    for (let i = 0; i < FTW; i++) {
      const wx = -TW + (i / FTW) * 2 * TW;
      const n1 = fbm2(wx * 0.32 + 11, wz * 0.32 + 5, 4);
      const n2 = vnoise2(wx * 7 + 3, wz * 7 + 9);
      const n3 = vnoise2(wx * 23 + 7, wz * 23 + 1);
      const warp = fbm2(wx * 0.6 + 2, wz * 0.6, 2);
      const rp = 0.5 + 0.5 * Math.sin(wz * 4.6 + wx * 0.9 + warp * 7);   // рябь песка
      const k = 0.8 + (n1 - 0.5) * 0.42 + (n2 - 0.5) * 0.12 + (n3 - 0.5) * 0.2 + (rp * rp * rp - 0.25) * 0.15;
      let r = 224 * k, g = 202 * k, b = 160 * k;
      if (n3 > 0.8) { r *= 0.72; g *= 0.71; b *= 0.72; } else if (n3 < 0.16) { r += 16; g += 15; b += 12; }
      const o = (j * FTW + i) * 4;
      d[o] = c255(r); d[o + 1] = c255(g); d[o + 2] = c255(b); d[o + 3] = 255;
    }
  }
  sandCtx.putImageData(img, 0, 0);
  // камешки и обломки ракушек
  const tones = [[160, 150, 135], [196, 186, 166], [118, 108, 98], [212, 198, 178], [150, 128, 116], [176, 160, 150], [92, 88, 84]];
  for (let n = 0; n < 440; n++) {
    const x = rand(0, FTW), y = rand(0, FTH);
    const r = rand(1.2, 4.2) * (RND() < 0.12 ? 2.3 : 1);
    const tn = pick(tones), ang = rand(0, TAU), el = rand(0.55, 0.95);
    sandCtx.fillStyle = 'rgba(70,52,34,0.28)';
    sandCtx.beginPath(); sandCtx.ellipse(x + r * 0.3, y + r * 0.45, r * 1.15, r * el * 1.1, ang, 0, TAU); sandCtx.fill();
    const gr = sandCtx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
    gr.addColorStop(0, rgb(tn[0] + 50, tn[1] + 50, tn[2] + 48));
    gr.addColorStop(1, rgb(tn[0] * 0.66, tn[1] * 0.66, tn[2] * 0.66));
    sandCtx.fillStyle = gr;
    sandCtx.beginPath(); sandCtx.ellipse(x, y, r, r * el, ang, 0, TAU); sandCtx.fill();
  }
  // на глубине вода съедает красный: песок холоднее
  sandCtx.globalCompositeOperation = 'multiply';
  sandCtx.fillStyle = 'rgb(200,228,255)'; sandCtx.fillRect(0, 0, FTW, FTH);
  sandCtx.globalCompositeOperation = 'source-over';
}
buildSand();

// ── каустики: бесшовный тайл, пересчитывается каждый кадр ──
const CT = 112, CT_WORLD = 4.2;
const caustCv = mk(CT, CT), caustCtx = caustCv.getContext('2d');
const caustImg = caustCtx.createImageData(CT, CT);
const caustBuf = new Float32Array(CT * CT);
const CPX = new Float32Array(CT);
for (let i = 0; i < CT; i++) CPX[i] = (i / CT) * TAU - 250;
function updateCaustics(time) {
  const d = caustImg.data, IT = 4, inten = 0.005;
  const tt = [];
  for (let n = 0; n < IT; n++) tt.push(time * (1 - 3.5 / (n + 1)));
  let q = 0, o = 0;
  for (let j = 0; j < CT; j++) {
    const py = CPX[j];
    for (let i = 0; i < CT; i++) {
      const px = CPX[i];
      let ix = px, iy = py, c = 1;
      for (let n = 0; n < IT; n++) {
        const t = tt[n];
        const nx = px + fcos(t - ix) + fsin(t + iy);
        const ny = py + fsin(t - iy) + fcos(t + ix);
        ix = nx; iy = ny;
        let sx = fsin(ix + t), cy = fcos(iy + t);
        if (sx > -1e-4 && sx < 1e-4) sx = 1e-4;
        if (cy > -1e-4 && cy < 1e-4) cy = 1e-4;
        const a = px * inten / sx, b = py * inten / cy;
        c += 1 / Math.sqrt(a * a + b * b);
      }
      c = 1.17 - Math.pow(c / IT, 1.4);
      let v = Math.pow(Math.abs(c), 8) * 1.5;
      if (v > 1) v = 1;
      caustBuf[q++] = v;
      d[o] = 205; d[o + 1] = 248; d[o + 2] = 255; d[o + 3] = v * 255; o += 4;
    }
  }
  caustCtx.putImageData(caustImg, 0, 0);
}
function causticAt(x, z) {
  let u = ((x + TW) / CT_WORLD) % 1, v = ((z + TD) / CT_WORLD) % 1;
  if (u < 0) u += 1; if (v < 0) v += 1;
  return caustBuf[((v * CT) | 0) * CT + ((u * CT) | 0)];
}
// слой каустик для дна (полуразрешение) и маски: крупные пятна + видимость сквозь туман
const clCv = mk(FTW >> 1, FTH >> 1), clCtx = clCv.getContext('2d');
const maskBase = mk(FTW >> 3, FTH >> 3), maskCv = mk(FTW >> 3, FTH >> 3), maskCtx = maskCv.getContext('2d');
{
  const c = maskBase.getContext('2d'), w = maskBase.width, h = maskBase.height;
  const img = c.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const n = fbm2(i * 0.09 + 3, j * 0.09 + 7, 3);
    img.data[(j * w + i) * 4 + 3] = c255(255 * clamp(0.25 + (n - 0.3) * 1.6, 0.2, 1));
  }
  c.putImageData(img, 0, 0);
}
// туман/свет поверх дна и поверхности: маленькие текстуры, растягиваемые с билинейной фильтрацией
const FGW = 40, FGH = 24;
const ffCv = mk(FGW, FGH), ffCtx = ffCv.getContext('2d'), ffImg = ffCtx.createImageData(FGW, FGH);
const visCv = mk(FGW, FGH), visCtx = visCv.getContext('2d'), visImg = visCtx.createImageData(FGW, FGH);
const SFW = 240, SFH = 144;
const sfCv = mk(SFW, SFH), sfCtx = sfCv.getContext('2d');
const SGW = 24, SGH = 14;
const sgCv = mk(SGW, SGH), sgCtx = sgCv.getContext('2d'), sgImg = sgCtx.createImageData(SGW, SGH);
function updateFogTex(img, vimg, gw, gh, worldAt, kLight) {
  const d = img.data, vd = vimg ? vimg.data : null;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const p = worldAt((i + 0.5) / gw, (j + 0.5) / gh);
    const E = envAt(p);
    const l = Math.min(1, E.l * kLight);
    const a = clamp(1 - l * (1 - E.f), 0.002, 1);
    const o = (j * gw + i) * 4;
    d[o] = c255(E.fc[0] * E.f / a); d[o + 1] = c255(E.fc[1] * E.f / a); d[o + 2] = c255(E.fc[2] * E.f / a); d[o + 3] = c255(a * 255);
    if (vd) { vd[o] = vd[o + 1] = vd[o + 2] = 255; vd[o + 3] = c255((1 - E.f) * 255 * (0.55 + 0.45 * E.l)); }
  }
}

// ── спрайты ──
const bubSpr = mk(64, 64);
{
  const c = bubSpr.getContext('2d');
  let g = c.createRadialGradient(32, 32, 10, 32, 32, 31);
  g.addColorStop(0, 'rgba(200,245,255,0.05)'); g.addColorStop(0.72, 'rgba(200,245,255,0.14)');
  g.addColorStop(0.9, 'rgba(230,252,255,0.75)'); g.addColorStop(1, 'rgba(230,252,255,0)');
  c.fillStyle = g; c.beginPath(); c.arc(32, 32, 31, 0, TAU); c.fill();
  g = c.createRadialGradient(22, 21, 0, 22, 21, 9);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.beginPath(); c.arc(22, 21, 9, 0, TAU); c.fill();
  g = c.createRadialGradient(41, 44, 0, 41, 44, 6);
  g.addColorStop(0, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.beginPath(); c.arc(41, 44, 6, 0, TAU); c.fill();
}
const dotSpr = mk(32, 32);
{
  const c = dotSpr.getContext('2d');
  const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(225,245,240,1)'); g.addColorStop(0.35, 'rgba(210,240,235,0.45)'); g.addColorStop(1, 'rgba(200,235,230,0)');
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
}
const shadowSpr = mk(64, 64);
{
  const c = shadowSpr.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(10,22,30,1)'); g.addColorStop(0.45, 'rgba(10,22,30,0.55)'); g.addColorStop(1, 'rgba(10,22,30,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
}

// ════════════ камни (настоящие 3D-сетки) ════════════
function icosphere(subdiv) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => norm(V(v[0], v[1], v[2])));
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map(), nf = [];
    const mid = (a, b) => {
      const key = a < b ? a * 4096 + b : b * 4096 + a;
      let i = cache.get(key);
      if (i === undefined) { i = verts.length; verts.push(norm(vlerp(verts[a], verts[b], 0.5))); cache.set(key, i); }
      return i;
    };
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  return { verts, faces };
}
const ROCK_PAL = [
  [[122, 112, 100], [150, 140, 124], [170, 86, 128]],
  [[112, 106, 98], [142, 132, 120], [196, 112, 88]],
  [[104, 100, 104], [136, 128, 130], [150, 84, 150]],
];
const rocks = [];
function makeRock(cx, cz, r, sy, subdiv, pal) {
  const { verts, faces } = icosphere(subdiv);
  const seed = rand(0, 60);
  const base = V(cx, floorY(cz) - 0.12 * r, cz);
  const vs = verts.map((v) => {
    const n1 = vnoise3(v.x * 1.3 + seed, v.y * 1.3 + seed * 0.7, v.z * 1.3);
    const n2 = vnoise3(v.x * 3.1 + seed, v.y * 3.1, v.z * 3.1 + seed);
    const k = 0.72 + 0.5 * n1 + 0.16 * n2;
    let y = v.y * r * k * sy;
    if (y < -0.1 * r) y = -0.1 * r + (y + 0.1 * r) * 0.25;
    return V(base.x + v.x * r * k, base.y + y + 0.1 * r, base.z + v.z * r * k);
  });
  const fs = faces.map(([a, b, c]) => {
    const A = vs[a], B = vs[b], C = vs[c];
    let n = norm(cross(sub(B, A), sub(C, A)));
    const cen = V((A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3, (A.z + B.z + C.z) / 3);
    if (dot(n, add(add(verts[a], verts[b]), verts[c])) < 0) n = mul(n, -1);
    const q = vnoise3(cen.x * 1.7 + seed, cen.y * 1.7, cen.z * 1.7);
    const q2 = vnoise3(cen.x * 5 + 3, cen.y * 5 + seed, cen.z * 5);
    let c0 = mix3(pal[0], pal[1], q2);
    if (q > 0.6) c0 = mix3(c0, pal[2], smooth(clamp((q - 0.6) / 0.16, 0, 1)));      // коралловые водоросли
    if (n.y > 0.5) c0 = mix3(c0, [88, 116, 70], clamp((n.y - 0.5) * 1.3 * q2, 0, 0.8)); // зелёный налёт сверху
    const rad = len(sub(cen, V(base.x, cen.y, base.z))) / r;
    const ao = clamp(0.62 + 0.45 * (rad - 0.5), 0.6, 1.05);                          // впадины темнее
    return { a, b, c, n, cen, col: c0, ao };
  });
  let top = vs[0];
  for (const v of vs) if (v.y > top.y) top = v;
  const rock = { vs, fs, base, r, sy, top, center: V(base.x, base.y + r * sy * 0.45, base.z), P: null };
  rocks.push(rock);
  return rock;
}
makeRock(-5.6, -3.0, 2.3, 0.85, 2, ROCK_PAL[0]);
makeRock(-3.8, -4.1, 1.5, 0.9, 2, ROCK_PAL[2]);
makeRock(-7.0, -1.5, 1.15, 0.8, 1, ROCK_PAL[1]);
makeRock(-4.4, -1.4, 0.75, 0.75, 1, ROCK_PAL[0]);
const rockB = makeRock(5.3, -1.3, 1.8, 0.8, 2, ROCK_PAL[1]);
makeRock(6.8, -2.6, 1.3, 1.0, 2, ROCK_PAL[0]);
makeRock(4.2, 0.1, 0.8, 0.7, 1, ROCK_PAL[2]);
makeRock(-7.8, 3.4, 0.9, 0.7, 1, ROCK_PAL[1]);
makeRock(8.3, -4.6, 1.5, 1.05, 2, ROCK_PAL[2]);
makeRock(1.2, 2.3, 0.55, 0.7, 1, ROCK_PAL[0]);
const obstacles = rocks.map((r) => ({ c: r.center, r: r.r * 1.05 * Math.max(1, r.sy) }));

// актиния на вершине камня — дом для рыб-клоунов
const anemone = (() => {
  const c = V(rockB.top.x, rockB.top.y - 0.06, rockB.top.z);
  const tents = [];
  for (let i = 0; i < 64; i++) {
    const a = rand(0, TAU), rr = Math.sqrt(RND()) * 0.6;
    const off = V(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    tents.push({ b: add(c, off), dir: norm(V(off.x * 1.7, 1, off.z * 1.7)), len: rand(0.45, 0.85), ph: rand(0, TAU) });
  }
  return { c, tents, home: add(c, V(0, 0.9, 0)) };
})();

// ════════════ водоросли ════════════
const KELP = [[74, 118, 44], [96, 140, 52], [58, 112, 70], [128, 138, 48], [124, 76, 50]];
const GRASS = [[90, 152, 70], [70, 132, 60], [112, 162, 80]];
const weeds = [];
function addClump(x, z, n, hMin, hMax, pal, wid, spread, segs) {
  for (let i = 0; i < n; i++) {
    const bx = clamp(x + rand(-spread, spread), -TW + 0.3, TW - 0.3), bz = clamp(z + rand(-spread, spread) * 0.8, -TD + 0.3, TD - 0.3);
    const base = V(bx, floorY(bz) - 0.05, bz);
    const h = Math.min(rand(hMin, hMax), TH - 0.45 - base.y);
    weeds.push({ base, h, w: wid * rand(0.75, 1.25), segs, ph: rand(0, TAU), tw: rand(-2.6, 2.6), rot: rand(0, TAU),
                 col: pick(pal), sway: rand(0.45, 0.85) * (segs > 6 ? 1 : 0.35), P: null });
  }
}
addClump(-8.6, -5.0, 7, 5.0, 7.4, KELP, 0.24, 0.8, 14);
addClump(-2.2, -5.1, 6, 4.5, 6.8, KELP, 0.22, 0.8, 14);
addClump(2.0, -4.9, 5, 3.5, 6.0, KELP, 0.2, 0.7, 14);
addClump(7.0, -5.3, 5, 4.5, 6.8, KELP, 0.24, 0.7, 14);
addClump(8.7, 3.9, 5, 2.8, 4.8, KELP, 0.22, 0.6, 12);
addClump(-4.2, 4.3, 4, 2.0, 3.4, KELP, 0.2, 0.6, 10);
addClump(2.7, 1.1, 4, 1.4, 2.6, KELP, 0.16, 0.5, 9);
addClump(-0.6, 4.7, 16, 0.5, 1.2, GRASS, 0.045, 0.9, 5);
addClump(5.6, 3.5, 12, 0.5, 1.0, GRASS, 0.045, 0.7, 5);
addClump(-6.3, 1.1, 12, 0.5, 1.3, GRASS, 0.05, 0.8, 5);
addClump(0.5, -2.6, 10, 0.6, 1.4, GRASS, 0.05, 0.8, 5);

// контактные тени камней и водорослей запекаются в песок
(function bakeContact() {
  const sx = -LIGHT.x / LIGHT.y, sz = -LIGHT.z / LIGHT.y;
  for (const r of rocks) {
    const hgt = r.top.y - r.base.y;
    for (const [ox, oz, k, a] of [[0, 0, 1.35, 0.55], [sx * hgt * 0.5, sz * hgt * 0.5, 1.2, 0.35]]) {
      const x = (r.base.x + ox + TW) * PPU, y = (r.base.z + oz + TD) * PPU, rr = r.r * k * PPU;
      const g = sandCtx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, rgba(40, 32, 22, a)); g.addColorStop(0.6, rgba(40, 32, 22, a * 0.45)); g.addColorStop(1, 'rgba(40,32,22,0)');
      sandCtx.fillStyle = g; sandCtx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
  }
  for (const w of weeds) {
    const x = (w.base.x + TW) * PPU, y = (w.base.z + TD) * PPU, rr = (w.segs > 6 ? 0.45 : 0.18) * PPU;
    const g = sandCtx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, 'rgba(40,40,20,0.35)'); g.addColorStop(1, 'rgba(40,40,20,0)');
    sandCtx.fillStyle = g; sandCtx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
})();

// ════════════ пузырьки, взвесь, лучи ════════════
const bubbles = [];
const emitters = [
  { x: 3.9, z: -4.7, rate: 13, acc: 0 },
  { x: -8.7, z: -3.5, rate: 8, acc: 0 },
];
function spawnBubble(x, y, z, big) {
  if (bubbles.length > 280) return;
  bubbles.push({ x, y, z, r: big ? rand(0.09, 0.16) : rand(0.03, 0.09), vy: rand(0.2, 0.6),
                 ph: rand(0, TAU), wob: rand(0.08, 0.25), fr: rand(2.2, 4.5), P: null });
}
function updateBubbles(dt, t) {
  for (const e of emitters) {
    e.acc += dt * e.rate * (0.7 + 0.6 * Math.max(0, Math.sin(t * 0.5 + e.x)));
    while (e.acc > 1) { e.acc -= 1; spawnBubble(e.x + rand(-0.08, 0.08), floorY(e.z) + 0.1, e.z + rand(-0.08, 0.08), RND() < 0.25); }
  }
  if (RND() < dt * 1.6) {       // одиночные пузырьки из песка и из камней
    const r = pick(rocks);
    if (RND() < 0.5) spawnBubble(r.top.x, r.top.y, r.top.z, false);
    else { const z = rand(-TD + 1, TD - 1); spawnBubble(rand(-TW + 1, TW - 1), floorY(z) + 0.05, z, false); }
  }
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    const vt = 1.1 + b.r * 9;
    b.vy += (vt - b.vy) * Math.min(1, dt * 2.5);
    b.y += b.vy * dt;
    b.x += Math.cos(t * b.fr + b.ph) * b.wob * dt * 3;
    b.z += Math.sin(t * b.fr * 0.8 + b.ph) * b.wob * dt * 2.4;
    b.r *= 1 + dt * 0.025;
    if (b.y > TH - b.r * 0.5) bubbles.splice(i, 1);
  }
}
const motes = [];
for (let i = 0; i < 260; i++) {
  motes.push({ x: rand(-TW, TW), y: rand(0.5, TH - 0.2), z: rand(-TD, TD), s: rand(0.012, 0.04),
               ph: rand(0, TAU), sp: rand(0.5, 1.5), P: null });
}
function updateMotes(dt, t) {
  const cur = 0.05 * Math.sin(t * 0.21);
  for (const m of motes) {
    m.x += (Math.sin(t * 0.2 * m.sp + m.ph) * 0.06 + cur) * dt;
    m.y += (Math.sin(t * 0.13 * m.sp + m.ph * 2) * 0.04 - 0.012) * dt;
    m.z += Math.cos(t * 0.17 * m.sp + m.ph) * 0.05 * dt;
    if (m.x > TW) m.x -= 2 * TW; else if (m.x < -TW) m.x += 2 * TW;
    if (m.z > TD) m.z -= 2 * TD; else if (m.z < -TD) m.z += 2 * TD;
    if (m.y < floorY(m.z) + 0.1) m.y = TH - 0.3; else if (m.y > TH - 0.1) m.y = floorY(m.z) + 0.2;
  }
}
const rays = [];
for (let i = 0; i < 11; i++) {
  const wide = i < 3;
  rays.push({ x: rand(-8.5, 7.5), z: rand(-5, 3.8), w: wide ? rand(1.8, 2.8) : rand(0.35, 1.2),
              a: wide ? rand(0.35, 0.5) : rand(0.6, 1), ph: rand(0, TAU), sp: rand(0.25, 0.6), P: null });
}

// ════════════ виды рыб ════════════
// хвостовые плавники: точки (u — назад, 0..1; v — вверх, -1..1)
const TAILS = {
  fork:   [[0, 0.32], [0.45, 0.7], [1, 1], [0.8, 0.55], [0.5, 0.06], [0.5, -0.06], [0.8, -0.55], [1, -1], [0.45, -0.7], [0, -0.32]],
  lyre:   [[0, 0.3], [0.5, 0.72], [1.3, 1.18], [0.75, 0.45], [0.45, 0.05], [0.45, -0.05], [0.75, -0.45], [1.3, -1.18], [0.5, -0.72], [0, -0.3]],
  lunate: [[0, 0.3], [0.45, 0.72], [1, 1.05], [0.78, 0.45], [0.68, 0], [0.78, -0.45], [1, -1.05], [0.45, -0.72], [0, -0.3]],
  round:  [[0, 0.36], [0.4, 0.82], [0.78, 0.9], [1, 0.5], [1.06, 0], [1, -0.5], [0.78, -0.9], [0.4, -0.82], [0, -0.36]],
};
// L — длина тела; h, w — полувысота и полутолщина (доли L); sm — место наибольшей высоты
const SPECIES = [
  { id: 'chromis', L: 0.62, h: 0.165, w: 0.085, sm: 0.36, nose: 0.55, ped: 0.32,
    back: [36, 104, 150], flank: [86, 190, 214], belly: [196, 236, 240], fin: [120, 206, 228], finA: 0.5,
    tail: 'fork', tailL: 0.34, tailH: 0.27, dorsal: [0.24, 0.8, 0.13, 'spiny'], anal: [0.56, 0.82, 0.1, 'soft'],
    pect: 0.2, eye: 0.058, eyeS: 0.1, iris: [70, 96, 96], spec: 0.8, waves: 0.9,
    speed: 1.9, freq: 3.4, amp: 0.085, turn: 3.4, wander: 1.0, yr: [0.3, 0.85], count: 26, school: 0 },
  { id: 'anthias', L: 0.72, h: 0.16, w: 0.075, sm: 0.37, nose: 0.6, ped: 0.28,
    back: [226, 84, 118], flank: [248, 128, 128], belly: [255, 190, 168], fin: [255, 130, 158], finA: 0.58,
    tail: 'lyre', tailL: 0.42, tailH: 0.32, dorsal: [0.2, 0.8, 0.12, 'soft'], anal: [0.56, 0.8, 0.1, 'soft'],
    pect: 0.2, eye: 0.06, eyeS: 0.1, iris: [200, 60, 120], spec: 0.7, waves: 0.9, cheek: [250, 214, 90],
    speed: 1.7, freq: 3.1, amp: 0.085, turn: 3.2, wander: 1.0, yr: [0.4, 0.95], count: 14, school: 1 },
  { id: 'clown', L: 1.0, h: 0.2, w: 0.11, sm: 0.38, nose: 0.45, ped: 0.42,
    back: [226, 88, 12], flank: [255, 120, 22], belly: [255, 160, 64], fin: [255, 118, 24], finA: 0.92, finEdge: [18, 10, 6],
    tail: 'round', tailL: 0.27, tailH: 0.21, dorsal: [0.2, 0.8, 0.13, 'notch'], anal: [0.58, 0.82, 0.12, 'round'],
    pect: 0.21, eye: 0.072, eyeS: 0.1, iris: [236, 120, 30], spec: 0.9, waves: 0.8,
    bands: [[0.17, 0.085], [0.48, 0.11], [0.84, 0.055]],
    speed: 0.95, freq: 4.4, amp: 0.1, turn: 4.2, wander: 2.2, yr: [0.1, 0.6], count: 3, home: true },
  { id: 'ytang', L: 1.45, h: 0.34, w: 0.07, sm: 0.42, nose: 0.85, ped: 0.22,
    back: [240, 190, 8], flank: [255, 214, 28], belly: [255, 230, 100], fin: [255, 204, 20], finA: 0.93,
    tail: 'lunate', tailL: 0.24, tailH: 0.3, dorsal: [0.22, 0.9, 0.17, 'round'], anal: [0.46, 0.9, 0.15, 'round'],
    pect: 0.14, eye: 0.05, eyeS: 0.13, iris: [40, 40, 30], spec: 0.8, waves: 0.75, spot: [0.87, 0.0, 0.035],
    speed: 1.25, freq: 2.3, amp: 0.07, turn: 2.6, wander: 1.2, yr: [0.25, 0.85], count: 3 },
  { id: 'btang', L: 1.7, h: 0.28, w: 0.08, sm: 0.4, nose: 0.7, ped: 0.24,
    back: [22, 52, 168], flank: [36, 98, 226], belly: [78, 146, 236], fin: [30, 76, 196], finA: 0.93, finEdge: [6, 10, 30],
    tail: 'lunate', tailL: 0.26, tailH: 0.3, tailCol: [255, 204, 34], dorsal: [0.2, 0.88, 0.11, 'round'], anal: [0.45, 0.88, 0.09, 'round'],
    pect: 0.16, eye: 0.05, eyeS: 0.12, iris: [20, 30, 60], spec: 1.0, waves: 0.75, palette: true,
    speed: 1.35, freq: 2.1, amp: 0.07, turn: 2.4, wander: 1.1, yr: [0.25, 0.8], count: 2 },
  { id: 'emperor', L: 2.2, h: 0.3, w: 0.1, sm: 0.4, nose: 0.55, ped: 0.36,
    back: [16, 28, 100], flank: [26, 48, 138], belly: [34, 62, 156], fin: [22, 38, 118], finA: 0.95, finEdge: [120, 180, 255],
    tail: 'round', tailL: 0.22, tailH: 0.25, tailCol: [255, 188, 24], dorsal: [0.3, 0.95, 0.13, 'trail'], anal: [0.5, 0.95, 0.11, 'trail'],
    pect: 0.15, eye: 0.045, eyeS: 0.12, iris: [20, 20, 30], spec: 0.9, waves: 0.7, stripes: true,
    speed: 1.0, freq: 1.5, amp: 0.065, turn: 2.0, wander: 0.9, yr: [0.3, 0.8], count: 2 },
];
// профиль тела вдоль хребта: s = 0 (нос) … 1 (хвостовой стебель) → доля максимальной высоты
function prof(sp, s) {
  const m = sp.sm;
  if (s < m) { const t = s / m; return Math.pow(1 - (1 - t) * (1 - t), sp.nose); }
  const t = (s - m) / (1 - m);
  return 1 - (1 - sp.ped) * smooth(t);
}
// профиль высоты спинного/анального плавника, q = 0..1 вдоль основания
function finProf(style, q) {
  switch (style) {
    case 'spiny': return (q < 0.25 ? q / 0.25 : 1 - 0.45 * (q - 0.25) / 0.75) * (q > 0.94 ? (1 - q) / 0.06 : 1);
    case 'round': return Math.pow(Math.max(0, Math.sin(Math.PI * q)), 0.55);
    case 'trail': return (0.35 + 0.65 * Math.pow(q, 1.3)) * (q > 0.9 ? Math.max(0, (1 - q) / 0.1) : 1) * Math.min(1, q / 0.06);
    case 'notch': return (0.62 + 0.38 * Math.sin(Math.PI * q)) * (1 - 0.55 * Math.exp(-Math.pow((q - 0.42) / 0.07, 2))) *
                         Math.min(1, q / 0.08, (1 - q) / 0.08);
    default: return Math.pow(Math.max(0, Math.sin(Math.PI * q)), 0.6) * (1 - 0.25 * q);
  }
}

// ════════════ рыбы: поведение ════════════
const fishes = [];
const schools = [
  { members: [], target: V(-3, 5.5, 1), a: rand(0, TAU), b: rand(0, TAU), c: rand(0, TAU), k: 1.0 },
  { members: [], target: V(3, 6, -1), a: rand(0, TAU), b: rand(0, TAU), c: rand(0, TAU), k: 0.8 },
];
function updateSchools(t) {
  for (const s of schools) {
    s.target = V(6.6 * Math.sin(t * 0.085 * s.k + s.a), 5.6 + 1.8 * Math.sin(t * 0.13 * s.k + s.b), 3.3 * Math.sin(t * 0.11 * s.k + s.c));
  }
}
function spawnFish(sp) {
  const school = sp.school !== undefined ? schools[sp.school] : null;
  const L = sp.L * rand(0.86, 1.14);
  let pos = null;
  for (let tries = 0; tries < 40; tries++) {
    if (school) pos = add(school.target, V(rand(-1.8, 1.8), rand(-0.9, 0.9), rand(-1.6, 1.6)));
    else if (sp.home) pos = add(anemone.home, V(rand(-1.4, 1.4), rand(-0.2, 1.0), rand(-1.4, 1.4)));
    else pos = V(rand(-TW + 2.5, TW - 2.5), rand(3.2, TH - 1.6), rand(-TD + 1.8, TD - 1.8));
    if (!obstacles.some((o) => len(sub(pos, o.c)) < o.r + 0.4)) break;
  }
  pos.x = clamp(pos.x, -TW + 1, TW - 1); pos.z = clamp(pos.z, -TD + 1, TD - 1);
  pos.y = clamp(pos.y, floorY(pos.z) + 0.8, TH - 0.8);
  const th = rand(0, TAU), dir = V(Math.sin(th), 0, Math.cos(th));
  const f = { sp, L, pos, vel: mul(dir, sp.speed * 0.8), fwd: dir, up: UPW, side: cross(dir, UPW),
              theta: th, phase: rand(0, TAU), turn: 0, bank: 0, ampNow: sp.amp, seed: rand(0, 100), wr: rand(0.7, 1.3),
              burst: 0, burstT: rand(2, 12), spMul: rand(0.85, 1.15), school, pectPh: rand(0, TAU) };
  fishes.push(f);
  if (school) school.members.push(f);
}
updateSchools(0);
for (const sp of SPECIES) for (let i = 0; i < sp.count; i++) spawnFish(sp);
// крупных рисуем позже в списке одинаковой глубины — порядок создания не важен, сортировка по дальности

const sq = (d) => (d > 0 ? d * d : 0);
function updateFish(f, dt, t) {
  const sp = f.sp, L = f.L, p = f.pos, v = f.vel;
  const cruise = sp.speed * f.spMul * (1 + 0.8 * f.burst);
  // 1) блуждание: желаемый курс плавно дрейфует относительно текущего
  const hv = Math.atan2(v.x, v.z);
  f.theta += angDiff(hv, f.theta) * Math.min(1, dt * 1.5);
  f.theta += (Math.sin(t * 0.41 * f.wr + f.seed) + 0.7 * Math.sin(t * 1.07 * f.wr + f.seed * 2.3)) * dt * 0.75 * sp.wander;
  const pitch = 0.3 * Math.sin(t * 0.27 * f.wr + f.seed * 3.7) + 0.12 * Math.sin(t * 0.71 + f.seed);
  const cp = Math.cos(pitch), wW = f.school ? 0.35 : 1.1;
  let ax = (Math.sin(f.theta) * cp * cruise - v.x) * wW;
  let ay = (Math.sin(pitch) * cruise * 0.45 - v.y) * wW;
  let az = (Math.cos(f.theta) * cp * cruise - v.z) * wW;
  // 2) избегание: стекло, дно, поверхность, камни
  let bx = 0, by = 0, bz = 0;
  const m = 1.2 + L * 0.8, K = 9;
  bx -= K * sq((p.x - (TW - m)) / m); bx += K * sq((-TW + m - p.x) / m);
  bz -= K * sq((p.z - (TD - m)) / m); bz += K * sq((-TD + m - p.z) / m);
  const yMin = floorY(p.z) + 0.3 + sp.h * L * 1.4, yMax = TH - 0.35 - sp.h * L * 1.2;
  const b0 = lerp(yMin, yMax, sp.yr[0]), b1 = lerp(yMin, yMax, sp.yr[1]);
  if (p.y < b0) by += (b0 - p.y) * 1.2; else if (p.y > b1) by -= (p.y - b1) * 1.2;
  by += K * sq((yMin + 0.8 - p.y) / 0.8); by -= K * sq((p.y - (yMax - 0.6)) / 0.6);
  const la = 1.0 + L * 0.3, lim = 0.4 + L * 0.5;              // упреждение: где будем через ~секунду
  const qx = p.x + v.x * la, qz = p.z + v.z * la;
  if (qx > TW - lim) bx -= (qx - (TW - lim)) * 2.5; else if (qx < -TW + lim) bx += (-TW + lim - qx) * 2.5;
  if (qz > TD - lim) bz -= (qz - (TD - lim)) * 2.5; else if (qz < -TD + lim) bz += (-TD + lim - qz) * 2.5;
  for (const o of obstacles) {
    const dx = p.x - o.c.x, dy = p.y - o.c.y, dz = p.z - o.c.z;
    const din = o.r + 0.6 + L * 0.8, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > din * din) continue;
    const d = Math.sqrt(d2) || 1e-3, k = 8 * sq((din - d) / (din - o.r * 0.8));
    bx += dx / d * k; by += dy / d * k + k * 0.3; bz += dz / d * k;
  }
  // уклоняющее ускорение переводим в поворот, чтобы рыба не «сдавала назад»
  const spd0 = Math.hypot(v.x, v.y, v.z) || 1e-3;
  const ux = v.x / spd0, uy = v.y / spd0, uz = v.z / spd0;
  const along = bx * ux + by * uy + bz * uz;
  let px = bx - ux * along, py = by - uy * along, pz = bz - uz * along;
  const bl = Math.hypot(bx, by, bz), pl = Math.hypot(px, py, pz);
  if (along < 0 && pl < 0.5 * bl) {
    let sx = -uz, sz = ux;
    if (-p.x * sx - p.z * sz < 0) { sx = -sx; sz = -sz; }  // поворачиваем в сторону центра
    px += sx * bl * 0.9; pz += sz * bl * 0.9;
  }
  ax += px + ux * along * 0.35; ay += py + uy * along * 0.35; az += pz + uz * along * 0.35;
  // 3) стая: сплочённость, выравнивание, разделение + общий ориентир
  if (f.school) {
    let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0, n = 0, sx = 0, sy = 0, sz = 0;
    const R2 = 2.6 * 2.6, sepR = L * 1.35;
    for (const o of f.school.members) {
      if (o === f) continue;
      const dx = o.pos.x - p.x, dy = o.pos.y - p.y, dz = o.pos.z - p.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R2) continue;
      n++; cx += dx; cy += dy; cz += dz; vx += o.vel.x; vy += o.vel.y; vz += o.vel.z;
      if (d2 < sepR * sepR) { const d = Math.sqrt(d2) || 1e-3, k = (sepR - d) / sepR / d; sx -= dx * k; sy -= dy * k; sz -= dz * k; }
    }
    if (n) {
      ax += cx / n * 0.9 + (vx / n - v.x) * 1.4; ay += cy / n * 0.9 + (vy / n - v.y) * 1.4; az += cz / n * 0.9 + (vz / n - v.z) * 1.4;
    }
    ax += sx * 6; ay += sy * 6; az += sz * 6;
    const T = f.school.target, tx = T.x - p.x, ty = T.y - p.y, tz = T.z - p.z;
    const td = Math.hypot(tx, ty, tz) || 1, tk = Math.min(1.3, td * 0.25) * 1.2;
    ax += tx / td * tk; ay += ty / td * tk; az += tz / td * tk;
  }
  // клоуны держатся у актинии
  if (sp.home) {
    const h = anemone.home, dx = h.x - p.x, dy = h.y - p.y, dz = h.z - p.z, d = Math.hypot(dx, dy, dz) || 1;
    if (d > 1.3) { const k = (d - 1.3) * 1.1; ax += dx / d * k; ay += dy / d * k; az += dz / d * k; }
  }
  // крупные рыбы расходятся друг с другом
  if (L > 0.9) {
    for (const o of fishes) {
      if (o === f || o.L < 0.9) continue;
      const dx = p.x - o.pos.x, dy = p.y - o.pos.y, dz = p.z - o.pos.z, rr = (L + o.L) * 0.75, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-3, k = 3 * (rr - d) / rr / d; ax += dx * k; ay += dy * k * 0.6; az += dz * k; }
    }
  }
  // 4) интегрирование
  const al = Math.hypot(ax, ay, az), amax = 3.5 + 2.2 / (L + 0.3);
  if (al > amax) { ax *= amax / al; ay *= amax / al; az *= amax / al; }
  v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
  const hz = Math.hypot(v.x, v.z), vyMax = 0.45 * hz + 0.12;
  v.y = clamp(v.y, -vyMax, vyMax);
  let spd = Math.hypot(v.x, v.y, v.z);
  const vmin = cruise * 0.35, vmax = cruise * 1.6;
  if (spd < vmin) {
    if (spd < 1e-4) { v.x = f.fwd.x * vmin; v.y = 0; v.z = f.fwd.z * vmin; } else { const k = vmin / spd; v.x *= k; v.y *= k; v.z *= k; }
  } else if (spd > vmax) { const k = vmax / spd; v.x *= k; v.y *= k; v.z *= k; }
  p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
  const hx = TW - 0.3 - L * 0.35, hzz = TD - 0.3 - L * 0.35;
  if (p.x > hx) { p.x = hx; v.x = Math.min(v.x, 0); } else if (p.x < -hx) { p.x = -hx; v.x = Math.max(v.x, 0); }
  if (p.z > hzz) { p.z = hzz; v.z = Math.min(v.z, 0); } else if (p.z < -hzz) { p.z = -hzz; v.z = Math.max(v.z, 0); }
  const yl = floorY(p.z) + 0.25 + sp.h * L, yh = TH - 0.25 - sp.h * L;
  if (p.y < yl) { p.y = yl; v.y = Math.max(v.y, 0); } else if (p.y > yh) { p.y = yh; v.y = Math.min(v.y, 0); }
  // 5) ориентация: корпус догоняет вектор скорости, крен в повороте
  spd = Math.hypot(v.x, v.y, v.z) || 1e-3;
  const tf = V(v.x / spd, v.y / spd, v.z / spd);
  const kt = 1 - Math.exp(-dt * sp.turn);
  let nf = vlerp(f.fwd, tf, kt);
  nf = len(nf) < 1e-3 ? tf : norm(nf);
  const turnRate = dot(sub(nf, f.fwd), f.side) / Math.max(dt, 1e-4);
  f.turn = lerp(f.turn, clamp(turnRate, -4, 4), 1 - Math.exp(-dt * 6));
  f.fwd = nf;
  const up0 = norm(madd(UPW, nf, -nf.y)), side0 = cross(nf, up0);
  f.bank = lerp(f.bank, clamp(f.turn * 0.22, -0.5, 0.5), 1 - Math.exp(-dt * 3));
  const cb = Math.cos(f.bank), sb = Math.sin(f.bank);
  f.up = norm(V(up0.x * cb + side0.x * sb, up0.y * cb + side0.y * sb, up0.z * cb + side0.z * sb));
  f.side = cross(nf, f.up);
  // 6) ритм плавания: частота и амплитуда волны тела зависят от скорости и поворота
  const ratio = spd / sp.speed;
  f.phase += dt * TAU * sp.freq * (0.45 + 0.55 * ratio + Math.min(1, Math.abs(f.turn)) * 0.35);
  f.ampNow = lerp(f.ampNow, sp.amp * (0.55 + 0.45 * Math.min(1.6, ratio)) + Math.min(0.04, Math.abs(f.turn) * 0.02), 1 - Math.exp(-dt * 3));
  f.pectPh += dt * (3 + 3 * Math.min(1, Math.abs(f.turn)) + Math.max(0, 1 - ratio) * 5);
  f.burstT -= dt;
  if (f.burstT < 0) { f.burst = 1; f.burstT = rand(5, 16); }
  f.burst = Math.max(0, f.burst - dt * 0.7);
}

// ════════════ рыбы: отрисовка ════════════
// Тело — цепочка эллипсоидов вдоль изгибающегося хребта. Каждый эллипсоид честно проецируется
// в эллипс (якобиан перспективы + разложение Холецкого), их объединение даёт силуэт при любом ракурсе.
const SPN = 16;
const FR = [];
for (let i = 0; i <= SPN; i++) FR.push({ p: null, t: null, u: null, s: null, P: null });
function buildFrames(f) {
  const L = f.L, A = f.ampNow * L, kw = f.sp.waves * TAU;
  const bend = clamp(f.turn * 0.13, -0.4, 0.4) * L * 1.3;
  for (let k = 0; k <= SPN; k++) {
    const s = k / SPN, env = 0.1 + 0.9 * s * s;
    const lat = A * env * Math.sin(f.phase - s * kw) + bend * (s - 0.35) * (s - 0.35);   // бегущая волна + изгиб в повороте
    const xl = (0.36 - s) * L;
    FR[k].p = V(f.pos.x + f.fwd.x * xl + f.side.x * lat, f.pos.y + f.fwd.y * xl + f.side.y * lat, f.pos.z + f.fwd.z * xl + f.side.z * lat);
  }
  for (let k = 0; k <= SPN; k++) {
    const a = FR[Math.max(0, k - 1)].p, b = FR[Math.min(SPN, k + 1)].p;
    const t = norm(sub(a, b));
    const u = norm(madd(f.up, t, -dot(f.up, t)));
    FR[k].t = t; FR[k].u = u; FR[k].s = cross(t, u);
    FR[k].P = proj(FR[k].p);
  }
}
function frameAt(s) {
  const x = clamp(s, 0, 1) * SPN, i = Math.min(SPN - 1, x | 0), q = x - i, a = FR[i], b = FR[i + 1];
  return { p: vlerp(a.p, b.p, q), t: norm(vlerp(a.t, b.t, q)), u: norm(vlerp(a.u, b.u, q)), s: norm(vlerp(a.s, b.s, q)) };
}
const halfH = (f, s) => f.sp.h * f.L * prof(f.sp, s);
const halfW = (f, s) => f.sp.w * f.L * Math.pow(prof(f.sp, s), 0.85);

function bodyPath(f, lod) {
  const step = lod ? 2 : 1, seg = f.L / SPN;
  ctx.beginPath();
  for (let k = 0; k <= SPN; k += step) {
    const s = k / SPN, F = FR[k], P = F.P;
    const h = Math.max(0.004, halfH(f, s)), w = Math.max(0.003, halfW(f, s));
    const a = seg * step * (k === 0 ? 0.55 : 0.95);
    const A1 = projVec(P, mul(F.t, a)), A2 = projVec(P, mul(F.u, h)), A3 = projVec(P, mul(F.s, w));
    const s11 = A1.x * A1.x + A2.x * A2.x + A3.x * A3.x;
    const s12 = A1.x * A1.y + A2.x * A2.y + A3.x * A3.y;
    const s22 = A1.y * A1.y + A2.y * A2.y + A3.y * A3.y;
    const l11 = Math.sqrt(s11) || 1e-3, l21 = s12 / l11, l22 = Math.sqrt(Math.max(1e-6, s22 - l21 * l21));
    ctx.setTransform(l11, l21, 0, l22, P.x, P.y);
    ctx.moveTo(1, 0); ctx.arc(0, 0, 1, 0, TAU);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
// освещение поперёк тела: аналитически по сечению-эллипсу (Ламберт + блик + затемнение к силуэту)
function bodyGradient(f, sg, toCam, causB, E) {
  const sp = f.sp, L = f.L;
  const km = Math.round(sp.sm * SPN), F = FR[km], Pm = F.P;
  const tp = projVec(Pm, F.t), upS = projVec(Pm, F.u);
  let nx = -tp.y, ny = tp.x, nl = Math.hypot(nx, ny);
  if (nl < 0.3 * Pm.s) { nx = upS.x; ny = upS.y; nl = Math.hypot(nx, ny) || 1; }
  nx /= nl; ny /= nl;
  if (nx * upS.x + ny * upS.y < 0) { nx = -nx; ny = -ny; }
  const sd = mul(F.s, sg), sS = projVec(Pm, sd);
  const hM = sp.h * L, wM = sp.w * L;
  const Aq = hM * (upS.x * nx + upS.y * ny), Bq = wM * (sS.x * nx + sS.y * ny);
  const Eh = Math.hypot(Aq, Bq) + 0.5;
  const cu = dot(F.u, toCam), cs = Math.max(0, dot(sd, toCam));
  const thc = Math.atan2(cu / hM, cs / wM);
  const hv = norm(add(TOLIGHT, toCam));
  const stops = [];
  for (let i = 0; i <= 10; i++) {
    const th = thc - Math.PI / 2 + Math.PI * i / 10, sn = Math.sin(th), cn = Math.cos(th);
    const o = Aq * sn + Bq * cn;
    const n3 = norm(V(F.u.x * sn / hM + sd.x * cn / wM, F.u.y * sn / hM + sd.y * cn / wM, F.u.z * sn / hM + sd.z * cn / wM));
    const lam = Math.max(0, dot(n3, TOLIGHT)), fac = Math.max(0, dot(n3, toCam));
    const spec = Math.pow(Math.max(0, dot(n3, hv)), 24) * sp.spec * causB;
    const c = sn > 0 ? mix3(sp.flank, sp.back, smooth(Math.min(1, sn * 1.15))) : mix3(sp.flank, sp.belly, smooth(Math.min(1, -sn * 1.2)));
    const k = (0.36 + 0.8 * lam * causB) * (0.56 + 0.44 * Math.sqrt(fac));
    stops.push([clamp(0.5 - 0.5 * o / Eh, 0, 1), (c[0] * k + 230 * spec) * E.ar, (c[1] * k + 245 * spec) * E.ag, c[2] * k + 255 * spec]);
  }
  stops.sort((a, b) => a[0] - b[0]);
  const g = ctx.createLinearGradient(Pm.x + nx * Eh, Pm.y + ny * Eh, Pm.x - nx * Eh, Pm.y - ny * Eh);
  for (const s of stops) g.addColorStop(s[0], rgb(s[1], s[2], s[3]));
  return { g, Pm, nx, ny, Eh };
}

// точка поверхности на видимом боку: s — вдоль тела, v — высота сечения (-1 брюхо … 1 спина)
function sidePt(f, s, v, sg) {
  const F = frameAt(s), h = halfH(f, s), w = halfW(f, s);
  return add(add(F.p, mul(F.u, h * v)), mul(F.s, sg * w * Math.sqrt(Math.max(0, 1 - v * v))));
}
// видимая полудуга сечения — для поперечных полос
function ringPts(f, s, sg, toCam, n) {
  const F = frameAt(s), h = halfH(f, s) * 1.04 + 1e-3, w = halfW(f, s) * 1.04 + 1e-3, sd = mul(F.s, sg);
  const thc = Math.atan2(dot(F.u, toCam) / h, Math.max(0, dot(sd, toCam)) / w);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const th = thc - 1.8 + 3.6 * i / n;
    out.push(add(add(F.p, mul(F.u, h * Math.sin(th))), mul(sd, w * Math.cos(th))));
  }
  return out;
}
function surfFacing(f, s, v, sg, toCam) {
  const F = frameAt(s), h = halfH(f, s) + 1e-3, w = halfW(f, s) + 1e-3, cn = Math.sqrt(Math.max(0, 1 - v * v));
  return dot(norm(V(F.u.x * v / h + F.s.x * sg * cn / w, F.u.y * v / h + F.s.y * sg * cn / w, F.u.z * v / h + F.s.z * sg * cn / w)), toCam);
}
function strokeP(pts3, width, style) {
  ctx.beginPath();
  for (let i = 0; i < pts3.length; i++) { const P = proj(pts3[i]); if (i) ctx.lineTo(P.x, P.y); else ctx.moveTo(P.x, P.y); }
  ctx.lineWidth = Math.max(0.5, width); ctx.strokeStyle = style; ctx.stroke();
}
function drawDisc(f, s, v, r, sg, style) {
  const F = frameAt(s), P = proj(sidePt(f, s, v, sg));
  const a1 = projVec(P, mul(F.t, r * f.L)), a2 = projVec(P, mul(F.u, r * f.L));
  ctx.setTransform(a1.x, a1.y, a2.x, a2.y, P.x, P.y);
  ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = style; ctx.fill();
}
function drawPatterns(f, sg, toCam, E, Pc) {
  const sp = f.sp, px = Pc.s * f.L;
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  if (sp.bands) for (const [s, bw] of sp.bands) {              // клоун: белые полосы с чёрной каймой
    const r = ringPts(f, s, sg, toCam, 14);
    strokeP(r, (bw + 0.04) * px, raw([14, 8, 6], 1, E));
    strokeP(r, bw * px, raw([250, 250, 246], 1, E));
  }
  if (sp.palette) {                                               // голубой хирург: чёрная «палитра»
    const A = [], B = [];
    for (let i = 0; i <= 14; i++) { const q = i / 14; A.push(sidePt(f, lerp(0.1, 0.93, q), 0.52 + 0.14 * q - 0.12 * Math.sin(Math.PI * q), sg)); }
    for (let i = 0; i <= 12; i++) { const q = i / 12; B.push(sidePt(f, lerp(0.3, 0.86, q), 0.5 - 0.78 * Math.sin(Math.PI * q), sg)); }
    const c = raw([8, 14, 40], 1, E);
    strokeP(A, 0.17 * px, c); strokeP(B, 0.09 * px, c);
  }
  if (sp.stripes) {                                               // императорский ангел: жёлтые продольные линии и маска
    const c = raw([255, 212, 60], 1, E);
    for (let j = 0; j < 7; j++) {
      const v0 = -0.66 + j * 0.2;
      if (surfFacing(f, 0.55, v0, sg, toCam) < 0.02) continue;
      const pts = [];
      for (let i = 0; i <= 10; i++) { const s = lerp(0.26, 0.94, i / 10); pts.push(sidePt(f, s, clamp(v0 + 0.2 * (s - 0.26), -0.95, 0.95), sg)); }
      strokeP(pts, 0.024 * px, c);
    }
    strokeP(ringPts(f, 0.12, sg, toCam, 12), 0.085 * px, raw([10, 12, 24], 1, E));
    strokeP(ringPts(f, 0.2, sg, toCam, 12), 0.028 * px, raw([150, 205, 255], 1, E));
  }
  if (sp.cheek) {
    const pts = [];
    for (let i = 0; i <= 6; i++) { const q = i / 6; pts.push(sidePt(f, lerp(0.07, 0.22, q), lerp(-0.05, -0.62, q), sg)); }
    strokeP(pts, 0.028 * px, raw(sp.cheek, 1, E));
  }
  if (sp.spot) drawDisc(f, sp.spot[0], sp.spot[1], sp.spot[2], sg, raw([250, 250, 240], 1, E));
}
function drawEye(f, sgn, toCam, E) {
  const sp = f.sp, s = sp.eyeS, F = frameAt(s);
  const nrm = norm(madd(mul(F.s, sgn), F.t, 0.3)), fac = dot(nrm, toCam);
  if (fac < 0.04) return;
  const p = add(add(F.p, mul(F.u, halfH(f, s) * 0.2)), mul(F.s, sgn * halfW(f, s) * 0.95));
  const P = proj(p), r = sp.eye * f.L, rpx = r * P.s;
  if (rpx < 0.7) return;
  const a1 = projVec(P, mul(F.t, r)), a2 = projVec(P, mul(F.u, r));
  ctx.setTransform(a1.x, a1.y, a2.x, a2.y, P.x, P.y);
  ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = raw(sp.iris, 1.1, E); ctx.fill();
  ctx.setTransform(a1.x, a1.y, a2.x, a2.y, P.x, P.y);
  ctx.beginPath(); ctx.arc(0.1, 0, 0.62, 0, TAU);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgb(5,7,10)'; ctx.fill();
  if (rpx > 1.6) {
    ctx.fillStyle = rgba(255, 255, 255, 0.85 * fac);
    ctx.beginPath(); ctx.arc(P.x - rpx * 0.28, P.y - rpx * 0.34, Math.max(0.5, rpx * 0.24), 0, TAU); ctx.fill();
  }
}

// ── плавники: плоские перепонки в 3D, честно укорачиваются при повороте ──
function tailPts(f) {
  const sp = f.sp, L = f.L, F = frameAt(0.97);
  const tl = sp.tailL * L, th = sp.tailH * L, hp = sp.h * sp.ped * L * 1.05;
  const flex = f.ampNow * L * 1.6 * Math.sin(f.phase - sp.waves * TAU * 1.1 - 0.6);   // хвост запаздывает за волной
  const pts = [];
  for (const [u, vv] of TAILS[sp.tail]) {
    const vh = u < 0.02 ? Math.sign(vv) * hp : vv * th, lat = flex * u * u;
    pts.push(V(F.p.x - F.t.x * u * tl + F.u.x * vh + F.s.x * lat,
               F.p.y - F.t.y * u * tl + F.u.y * vh + F.s.y * lat,
               F.p.z - F.t.z * u * tl + F.u.z * vh + F.s.z * lat));
  }
  return { pts, base: F.p, mid: madd(F.p, F.t, -tl * 0.5), tip: madd(F.p, F.t, -tl) };
}
function finPts(f, spec, dir, t) {
  const [s0, s1, hgt, style] = spec, sp = f.sp, L = f.L, K = 9;
  const sweep = style === 'trail' ? 0.8 : style === 'spiny' ? 0.3 : 0.42;
  const base = [], top = [];
  for (let i = 0; i <= K; i++) {
    const q = i / K, s = lerp(s0, s1, q), F = frameAt(s);
    const hb = halfH(f, s) * 0.86, H = finProf(style, q) * hgt * L;
    const fl = Math.sin(t * 3.1 + f.seed + q * 4.5 - f.phase * 0.5) * 0.12 * H;
    const b = madd(F.p, F.u, dir * hb);
    base.push(b);
    top.push(V(b.x + F.u.x * dir * H - F.t.x * H * sweep + F.s.x * fl,
               b.y + F.u.y * dir * H - F.t.y * H * sweep + F.s.y * fl,
               b.z + F.u.z * dir * H - F.t.z * H * sweep + F.s.z * fl));
  }
  return base.concat(top.reverse());
}
function finPath(pts3) {
  const n = pts3.length, P = pts3.map(proj);
  ctx.beginPath();
  ctx.moveTo((P[n - 1].x + P[0].x) / 2, (P[n - 1].y + P[0].y) / 2);
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2); }
  ctx.closePath();
  return P;
}
function drawTail(f, T, E, finK, lod) {
  const sp = f.sp, c = sp.tailCol || sp.fin;
  const P = finPath(T.pts), pb = proj(T.base), pt = proj(T.tip);
  const g = ctx.createLinearGradient(pb.x, pb.y, pt.x, pt.y);
  g.addColorStop(0, col(c, finK * 0.95, E, sp.finA));
  g.addColorStop(1, col(mix3(c, [255, 255, 255], 0.18), finK * 1.1, E, sp.finA * 0.7));
  ctx.fillStyle = g; ctx.fill();
  if (lod) return;
  if (sp.finEdge) { ctx.strokeStyle = col(sp.finEdge, 1, E, 0.7); ctx.lineWidth = Math.max(0.6, 0.014 * f.L * pb.s); ctx.stroke(); }
  ctx.beginPath();
  for (let i = 1; i < P.length - 1; i++) { ctx.moveTo(pb.x, pb.y); ctx.lineTo(lerp(pb.x, P[i].x, 0.94), lerp(pb.y, P[i].y, 0.94)); }
  ctx.strokeStyle = rgba(0, 0, 0, 0.13 * (1 - E.f)); ctx.lineWidth = Math.max(0.5, 0.006 * f.L * pb.s); ctx.stroke();
}
function drawMidFin(f, pts3, E, finK, lod) {
  const sp = f.sp, P = finPath(pts3);
  ctx.fillStyle = col(sp.fin, finK, E, sp.finA * 0.95); ctx.fill();
  if (lod) return;
  const lw = Math.max(0.6, 0.012 * f.L * P[0].s);
  if (sp.finEdge) { ctx.strokeStyle = col(sp.finEdge, 1, E, 0.6); ctx.lineWidth = lw; ctx.stroke(); }
  const K = pts3.length / 2 - 1;
  ctx.beginPath();
  for (let i = 1; i < K; i++) { const a = P[i], b = P[2 * K + 1 - i]; ctx.moveTo(a.x, a.y); ctx.lineTo(lerp(a.x, b.x, 0.9), lerp(a.y, b.y, 0.9)); }
  ctx.strokeStyle = rgba(0, 0, 0, 0.1 * (1 - E.f)); ctx.lineWidth = lw * 0.6; ctx.stroke();
}
function drawPect(f, sgn, E, toCam) {
  const sp = f.sp, L = f.L, F = frameAt(0.27);
  const A = add(add(F.p, mul(F.s, sgn * halfW(f, 0.27) * 0.8)), mul(F.u, -halfH(f, 0.27) * 0.3));
  const pl = sp.pect * L, ang = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(f.pectPh + (sgn > 0 ? 0 : 0.7)));
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const dir = V(-F.t.x * ca + F.s.x * sgn * sa, -F.t.y * ca + F.s.y * sgn * sa, -F.t.z * ca + F.s.z * sgn * sa);
  const pts = [A, madd(madd(A, dir, pl * 0.95), F.u, pl * 0.3), madd(A, dir, pl * 1.08), madd(madd(A, dir, pl * 0.8), F.u, -pl * 0.28)];
  const k = 0.6 + 0.55 * Math.abs(dot(norm(cross(dir, F.u)), toCam));
  finPath(pts);
  ctx.fillStyle = col(sp.fin, k, E, sp.finA * 0.8); ctx.fill();
}

function drawBody(f, E, sg, toCam, causB, lod, Pc) {
  const sp = f.sp, L = f.L;
  ctx.save();
  bodyPath(f, lod);
  const G = bodyGradient(f, sg, toCam, causB, E);
  ctx.fillStyle = G.g; ctx.fill();
  ctx.clip();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let k = 0; k <= SPN; k += 2) { const P = FR[k].P; if (P.x < x0) x0 = P.x; if (P.x > x1) x1 = P.x; if (P.y < y0) y0 = P.y; if (P.y > y1) y1 = P.y; }
  const pad = sp.h * L * Pc.s * 1.7 + 2;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  if (!lod) {
    drawPatterns(f, sg, toCam, E, Pc);
    const rg = ctx.createLinearGradient(G.Pm.x + G.nx * G.Eh, G.Pm.y + G.ny * G.Eh, G.Pm.x - G.nx * G.Eh, G.Pm.y - G.ny * G.Eh);
    rg.addColorStop(0, 'rgba(0,0,0,0.26)'); rg.addColorStop(0.2, 'rgba(0,0,0,0)');
    rg.addColorStop(0.8, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = rg; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (surfFacing(f, 0.4, 0.55, sg, toCam) > 0.1) {          // влажный блик вдоль спины
      const pts = [];
      for (let i = 0; i <= 8; i++) pts.push(sidePt(f, lerp(0.1, 0.78, i / 8), 0.55, sg));
      ctx.lineCap = 'round';
      strokeP(pts, 0.045 * L * Pc.s, rgba(255, 255, 255, 0.12 * sp.spec * causB));
    }
  } else if (sp.bands) drawPatterns(f, sg, toCam, E, Pc);
  drawEye(f, 1, toCam, E); drawEye(f, -1, toCam, E);
  const ov = overlayOf(E);
  if (ov) { ctx.fillStyle = ov; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
  ctx.restore();
}
function drawFish(f, t) {
  const sp = f.sp;
  const Pc = proj(f.pos), lenPx = f.L * Pc.s;
  if (lenPx < 1.2) return;
  const lod = lenPx < 34 ? 1 : 0;
  buildFrames(f);
  const E = envAt(f.pos);
  const toCam = norm(sub(cam.pos, f.pos));
  const sg = dot(f.side, toCam) >= 0 ? 1 : -1;
  const finK = 0.62 + 0.5 * Math.abs(dot(f.side, toCam));
  const causB = 1 + 0.6 * S.light * causticAt(f.pos.x, f.pos.z) * clamp(f.pos.y / TH, 0.25, 1);
  const cu = dot(f.up, toCam);
  const tail = tailPts(f);
  // алгоритм художника внутри рыбы: то, что дальше тела, — до него, то, что ближе, — после.
  // Пороги вместо знака, чтобы плавники не «мигали» порядком, когда рыба стоит боком.
  const tailBehind = dot(f.fwd, toCam) > -0.25, dFront = cu > 0.3, aFront = cu < -0.3;
  const dors = finPts(f, sp.dorsal, 1, simT), anal = finPts(f, sp.anal, -1, simT);
  if (!lod) drawPect(f, -sg, E, toCam);
  if (tailBehind) drawTail(f, tail, E, finK, lod);
  if (!dFront) drawMidFin(f, dors, E, finK, lod);
  if (!aFront) drawMidFin(f, anal, E, finK, lod);
  drawBody(f, E, sg, toCam, causB, lod, Pc);
  if (dFront) drawMidFin(f, dors, E, finK, lod);
  if (aFront) drawMidFin(f, anal, E, finK, lod);
  if (!tailBehind) drawTail(f, tail, E, finK, lod);
  if (!lod) drawPect(f, sg, E, toCam);
}

// ════════════ плоскости с текстурой: аффинные треугольники ════════════
function tri(img, p0, p1, p2, u0, v0, u1, v1, u2, v2, iw, ih) {
  const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
  if (Math.abs(den) < 1e-9) return;
  const cx = (p0.x + p1.x + p2.x) / 3, cy = (p0.y + p1.y + p2.y) / 3;
  ctx.save();
  ctx.beginPath();
  // клип чуть раздут наружу, чтобы между треугольниками не было щелей
  let dx = p0.x - cx, dy = p0.y - cy, l = Math.hypot(dx, dy) || 1;
  ctx.moveTo(p0.x + dx / l * 0.9, p0.y + dy / l * 0.9);
  dx = p1.x - cx; dy = p1.y - cy; l = Math.hypot(dx, dy) || 1;
  ctx.lineTo(p1.x + dx / l * 0.9, p1.y + dy / l * 0.9);
  dx = p2.x - cx; dy = p2.y - cy; l = Math.hypot(dx, dy) || 1;
  ctx.lineTo(p2.x + dx / l * 0.9, p2.y + dy / l * 0.9);
  ctx.closePath();
  ctx.clip();
  const a = ((p1.x - p0.x) * (v2 - v0) - (p2.x - p0.x) * (v1 - v0)) / den;
  const b = ((p1.y - p0.y) * (v2 - v0) - (p2.y - p0.y) * (v1 - v0)) / den;
  const c = ((p2.x - p0.x) * (u1 - u0) - (p1.x - p0.x) * (u2 - u0)) / den;
  const d = ((p2.y - p0.y) * (u1 - u0) - (p1.y - p0.y) * (u2 - u0)) / den;
  ctx.setTransform(a, b, c, d, p0.x - a * u0 - c * v0, p0.y - b * u0 - d * v0);
  const su = Math.max(0, Math.min(u0, u1, u2) - 2), sv = Math.max(0, Math.min(v0, v1, v2) - 2);
  const eu = Math.min(iw, Math.max(u0, u1, u2) + 2), ev = Math.min(ih, Math.max(v0, v1, v2) + 2);
  ctx.drawImage(img, su, sv, eu - su, ev - sv, su, sv, eu - su, ev - sv);
  ctx.restore();
}
function mapPlane(img, iw, ih, P3, nx, nz) {
  const pts = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) pts.push(proj(P3(i / nx, j / nz)));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = pts[j * (nx + 1) + i], b = pts[j * (nx + 1) + i + 1];
    const c = pts[(j + 1) * (nx + 1) + i], d = pts[(j + 1) * (nx + 1) + i + 1];
    const u0 = i / nx * iw, u1 = (i + 1) / nx * iw, v0 = j / nz * ih, v1 = (j + 1) / nz * ih;
    tri(img, a, b, c, u0, v0, u1, v0, u0, v1, iw, ih);
    tri(img, b, d, c, u1, v0, u1, v1, u0, v1, iw, ih);
  }
}
const floorP3 = (u, v) => { const z = -TD + v * 2 * TD; return V(-TW + u * 2 * TW, floorY(z), z); };
const surfP3 = (u, v) => V(-TW + u * 2 * TW, TH, -TD + v * 2 * TD);

// ── сборка текстуры дна на кадр: песок → тени рыб → свет/туман → каустики ──
function composeFloor(t) {
  updateFogTex(ffImg, visImg, FGW, FGH, floorP3, 1.55);
  ffCtx.putImageData(ffImg, 0, 0); visCtx.putImageData(visImg, 0, 0);
  maskCtx.globalCompositeOperation = 'copy'; maskCtx.drawImage(maskBase, 0, 0);
  maskCtx.globalCompositeOperation = 'destination-in'; maskCtx.drawImage(visCv, 0, 0, maskCv.width, maskCv.height);
  maskCtx.globalCompositeOperation = 'source-over';
  const cw = clCv.width, ch = clCv.height, sc = CT_WORLD * (PPU / 2) / CT;
  clCtx.globalCompositeOperation = 'copy'; clCtx.globalAlpha = 1;
  let pat = clCtx.createPattern(caustCv, 'repeat');
  pat.setTransform(new DOMMatrix([sc, 0, 0, sc, 0, 0]));
  clCtx.fillStyle = pat; clCtx.fillRect(0, 0, cw, ch);
  clCtx.globalCompositeOperation = 'lighter'; clCtx.globalAlpha = 0.55;
  const s2 = sc * 1.47, an = 0.62, ca = Math.cos(an) * s2, sa = Math.sin(an) * s2;
  pat = clCtx.createPattern(caustCv, 'repeat');
  pat.setTransform(new DOMMatrix([ca, sa, -sa, ca, t * 3.1, t * 1.7]));
  clCtx.fillStyle = pat; clCtx.fillRect(0, 0, cw, ch);
  clCtx.globalAlpha = 1; clCtx.globalCompositeOperation = 'destination-in';
  clCtx.drawImage(maskCv, 0, 0, cw, ch);
  clCtx.globalCompositeOperation = 'source-over';

  fctx.globalCompositeOperation = 'source-over'; fctx.globalAlpha = 1;
  fctx.drawImage(sandCv, 0, 0);
  const sx = -LIGHT.x / LIGHT.y, sz = -LIGHT.z / LIGHT.y;
  for (const f of fishes) {
    const hgt = Math.max(0, f.pos.y - floorY(f.pos.z)), blur = 1 + hgt * 0.32;
    const x = (f.pos.x + sx * hgt + TW) * PPU, y = (f.pos.z + sz * hgt + TD) * PPU;
    const lw = f.L * PPU * 1.15 * blur, lh = f.L * PPU * (f.sp.w * 2.4 + 0.1) * blur * 1.4;
    const a2 = Math.atan2(f.fwd.z, f.fwd.x), c = Math.cos(a2), s = Math.sin(a2);
    fctx.globalAlpha = clamp(0.5 / Math.pow(blur, 1.4), 0.05, 0.5) * Math.min(1, S.light + 0.2);
    fctx.setTransform(c, s, -s, c, x, y);
    fctx.drawImage(shadowSpr, -lw / 2, -lh / 2, lw, lh);
  }
  fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.globalAlpha = 1;
  fctx.drawImage(ffCv, 0, 0, FTW, FTH);
  fctx.globalCompositeOperation = 'lighter'; fctx.globalAlpha = Math.min(1, 0.85 * S.light);
  fctx.drawImage(clCv, 0, 0, FTW, FTH);
  fctx.globalCompositeOperation = 'source-over'; fctx.globalAlpha = 1;
}
// поверхность воды снизу: светлая рябь
function composeSurface(t) {
  updateFogTex(sgImg, null, SGW, SGH, surfP3, 1);
  sgCtx.putImageData(sgImg, 0, 0);
  sfCtx.globalCompositeOperation = 'source-over'; sfCtx.globalAlpha = 1;
  const g = sfCtx.createLinearGradient(0, 0, 0, SFH);
  g.addColorStop(0, '#3f9fb0'); g.addColorStop(1, '#68c4cf');
  sfCtx.fillStyle = g; sfCtx.fillRect(0, 0, SFW, SFH);
  const sc = 5.5 * (SFW / (2 * TW)) / CT;
  sfCtx.globalCompositeOperation = 'lighter'; sfCtx.globalAlpha = Math.min(1, 0.6 * S.light + 0.15);
  let pat = sfCtx.createPattern(caustCv, 'repeat');
  pat.setTransform(new DOMMatrix([sc, 0, 0, sc, -t * 2, t * 1.2]));
  sfCtx.fillStyle = pat; sfCtx.fillRect(0, 0, SFW, SFH);
  sfCtx.globalAlpha *= 0.6;
  const s2 = sc * 1.6, ca = Math.cos(1.1) * s2, sa = Math.sin(1.1) * s2;
  pat = sfCtx.createPattern(caustCv, 'repeat');
  pat.setTransform(new DOMMatrix([ca, sa, -sa, ca, t * 3, -t]));
  sfCtx.fillStyle = pat; sfCtx.fillRect(0, 0, SFW, SFH);
  sfCtx.globalCompositeOperation = 'source-over'; sfCtx.globalAlpha = 1;
  sfCtx.drawImage(sgCv, 0, 0, SFW, SFH);
}

// ════════════ отрисовка среды ════════════
function quadPath(ps) {
  ctx.beginPath(); ctx.moveTo(ps[0].x, ps[0].y);
  for (let i = 1; i < ps.length; i++) ctx.lineTo(ps[i].x, ps[i].y);
  ctx.closePath();
}
function hull(ps) {
  const p = ps.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
function drawRoom() {
  let g = ctx.createLinearGradient(0, 0, 0, HH);
  g.addColorStop(0, '#03080c'); g.addColorStop(0.6, '#050d13'); g.addColorStop(1, '#020406');
  ctx.fillStyle = g; ctx.fillRect(0, 0, WW, HH);
  const c = proj(V(0, TH * 0.5, TD)), R = Math.max(WW, HH) * 0.8;
  g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
  g.addColorStop(0, 'rgba(40,150,170,0.24)'); g.addColorStop(0.45, 'rgba(20,90,110,0.09)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, WW, HH);
}
const WALL_BACK = [16, 54, 78], WALL_SIDE = [30, 100, 120];
function drawWalls() {
  const cp = cam.pos;
  quadPath([V(-TW, 0, -TD), V(TW, 0, -TD), V(TW, TH, -TD), V(-TW, TH, -TD)].map(proj));
  const a = proj(V(0, TH, -TD)), b = proj(V(0, 1.5, -TD));
  let g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  g.addColorStop(0, col(WALL_BACK, 1.15, envAt(V(0, TH - 0.3, -TD))));
  g.addColorStop(1, col(WALL_BACK, 0.8, envAt(V(0, 1.5, -TD))));
  ctx.fillStyle = g; ctx.fill();
  for (const sx of [-1, 1]) {
    const x = sx * TW;
    if (sx * (cp.x - x) >= 0) continue;           // эту стенку видим снаружи — она прозрачна
    quadPath([V(x, 0, TD), V(x, 0, -TD), V(x, TH, -TD), V(x, TH, TD)].map(proj));
    const pn = proj(V(x, TH * 0.5, TD)), pf = proj(V(x, TH * 0.5, -TD));
    g = ctx.createLinearGradient(pn.x, pn.y, pf.x, pf.y);
    g.addColorStop(0, col(WALL_SIDE, 0.85, envAt(V(x, TH * 0.5, TD - 0.2))));
    g.addColorStop(1, col(WALL_SIDE, 0.85, envAt(V(x, TH * 0.5, -TD))));
    ctx.fillStyle = g; ctx.fill();
    const pt = proj(V(x, TH, 0)), pb = proj(V(x, 0, 0));
    g = ctx.createLinearGradient(pt.x, pt.y, pb.x, pb.y);
    g.addColorStop(0, 'rgba(140,225,240,0.08)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,8,16,0.3)');
    ctx.fillStyle = g; ctx.fill();
  }
}
function drawBackEdges() {
  ctx.lineWidth = Math.max(1, 1.2 * DPR); ctx.lineCap = 'round';
  const seg = (p, q, al) => {
    const A = proj(p), B = proj(q);
    ctx.strokeStyle = col([190, 250, 240], 1, envAt(vlerp(p, q, 0.5)), al);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  };
  seg(V(-TW, floorY(-TD), -TD), V(-TW, TH, -TD), 0.35);
  seg(V(TW, floorY(-TD), -TD), V(TW, TH, -TD), 0.35);
  seg(V(-TW, TH, -TD), V(TW, TH, -TD), 0.3);
  if (cam.pos.x > -TW) seg(V(-TW, TH, -TD), V(-TW, TH, TD), 0.2);
  if (cam.pos.x < TW) seg(V(TW, TH, -TD), V(TW, TH, TD), 0.2);
  seg(V(-TW, floorY(TD), TD), V(-TW, floorY(-TD), -TD), 0.18);
  seg(V(TW, floorY(TD), TD), V(TW, floorY(-TD), -TD), 0.18);
}
function drawHaze() {
  const cs = [];
  for (const x of [-TW, TW]) for (const y of [0, TH]) for (const z of [-TD, TD]) cs.push(proj(V(x, y, z)));
  const h = hull(cs);
  ctx.save();
  quadPath(h); ctx.clip();
  const top = proj(V(0, TH, -TD)), bot = proj(V(0, 0, TD));
  const g = ctx.createLinearGradient(0, top.y, 0, bot.y);
  g.addColorStop(0, rgba(150, 232, 242, 0.13 * Math.min(1.3, S.light)));
  g.addColorStop(0.35, 'rgba(120,210,230,0.03)');
  g.addColorStop(1, 'rgba(0,10,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, WW, HH);
  ctx.restore();
}
const RAYL = [[1, 0.3], [0.64, 0.35], [0.3, 0.45]];
function drawRay(r, t) {
  const top = V(r.x + 0.6 * Math.sin(t * 0.06 + r.ph), TH, r.z);
  const bot = madd(top, LIGHT, (TH - floorY(r.z)) / -LIGHT.y);
  const pt = proj(top), pb = proj(bot);
  const dx = pb.x - pt.x, dy = pb.y - pt.y, dl = Math.hypot(dx, dy) || 1, nx = -dy / dl, ny = dx / dl;
  const wT = r.w * pt.s * 0.5, wB = r.w * 1.7 * pb.s * 0.5;
  const fl = 0.55 + 0.45 * Math.sin(t * r.sp + r.ph) * Math.sin(t * r.sp * 0.37 + r.ph * 2.3);
  const I = r.a * fl * S.light * (1 - 0.5 * fogOf(vlerp(top, bot, 0.4))) * 0.2;
  if (I < 0.003) return;
  ctx.globalCompositeOperation = 'lighter';
  for (const [wk, ak] of RAYL) {
    const g = ctx.createLinearGradient(pt.x, pt.y, pb.x, pb.y);
    g.addColorStop(0, rgba(170, 236, 255, I * ak)); g.addColorStop(0.5, rgba(140, 215, 240, I * ak * 0.45)); g.addColorStop(1, 'rgba(120,200,230,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(pt.x + nx * wT * wk, pt.y + ny * wT * wk); ctx.lineTo(pb.x + nx * wB * wk, pb.y + ny * wB * wk);
    ctx.lineTo(pb.x - nx * wB * wk, pb.y - ny * wB * wk); ctx.lineTo(pt.x - nx * wT * wk, pt.y - ny * wT * wk);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
function drawRock(r, t) {
  const P = r.vs.map(proj), vis = [];
  for (const f of r.fs) {
    if (dot(f.n, sub(cam.pos, f.cen)) <= 0) continue;          // отсечение задних граней
    f.z = (P[f.a].z + P[f.b].z + P[f.c].z) / 3;
    vis.push(f);
  }
  vis.sort((a, b) => b.z - a.z);
  const E = envAt(r.center);
  ctx.lineJoin = 'round'; ctx.lineWidth = 1;
  for (const f of vis) {
    const lam = Math.max(0, dot(f.n, TOLIGHT));
    const cz = f.n.y > 0 ? causticAt(f.cen.x, f.cen.z) * f.n.y * S.light : 0;
    E.l = 0.46 + 0.54 * Math.pow(clamp(f.cen.y / TH, 0, 1), 0.85);
    const c = col(f.col, (0.3 + 0.85 * lam + 0.75 * cz) * f.ao, E);
    const a = P[f.a], b = P[f.b], d = P[f.c];
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(d.x, d.y); ctx.closePath();
    ctx.fillStyle = c; ctx.strokeStyle = c; ctx.fill(); ctx.stroke();
  }
  if (r === rockB) drawAnemone(t);
}
function drawAnemone(t) {
  const E = envAt(anemone.c), list = [];
  for (const tn of anemone.tents) {
    const sw = 0.2 * tn.len;
    const off = V(Math.sin(t * 1.3 + tn.ph) * sw + 0.08 * Math.sin(t * 0.5), 0, Math.cos(t * 1.1 + tn.ph * 1.3) * sw);
    const tip = add(madd(tn.b, tn.dir, tn.len), off), mid = add(madd(tn.b, tn.dir, tn.len * 0.55), mul(off, 0.35));
    list.push({ B: proj(tn.b), M: proj(mid), T: proj(tip) });
  }
  list.sort((a, b) => b.T.z - a.T.z);
  const pc = proj(anemone.c);
  ctx.fillStyle = col([120, 60, 90], 0.8, E);
  ctx.beginPath(); ctx.ellipse(pc.x, pc.y, 0.7 * pc.s, 0.25 * pc.s, 0, 0, TAU); ctx.fill();
  const body = col([214, 132, 176], 1, E), tipc = col([255, 226, 238], 1.2, E);
  ctx.lineCap = 'round';
  for (const q of list) {
    ctx.strokeStyle = body; ctx.lineWidth = Math.max(0.8, 0.085 * q.B.s);
    ctx.beginPath(); ctx.moveTo(q.B.x, q.B.y); ctx.quadraticCurveTo(q.M.x, q.M.y, q.T.x, q.T.y); ctx.stroke();
    ctx.fillStyle = tipc; ctx.beginPath(); ctx.arc(q.T.x, q.T.y, Math.max(0.7, 0.055 * q.T.s), 0, TAU); ctx.fill();
  }
}
function drawWeed(w, t) {
  const n = w.segs, L = [], R = [], C = [], kelp = n > 6;
  const cur = 0.25 * Math.sin(t * 0.3) + 0.1 * Math.sin(t * 0.77 + w.base.x * 0.3);
  let facing = 0.5;
  for (let k = 0; k <= n; k++) {
    const s = k / n, bend = Math.pow(s, 1.5) * w.sway;
    const dx = bend * (Math.sin(t * 0.8 + w.ph + s * 2.4) + 0.35 * Math.sin(t * 1.9 + w.ph * 1.7 + s * 5)) + cur * s * s * (kelp ? 1.4 : 0.4);
    const dz = bend * 0.7 * (Math.cos(t * 0.65 + w.ph * 1.3 + s * 2.0) + 0.3 * Math.sin(t * 2.2 + s * 4));
    const c = V(w.base.x + dx, w.base.y + s * w.h, w.base.z + dz);
    const ang = w.rot + w.tw * s + 0.35 * Math.sin(t * 0.9 + w.ph + s * 3);
    const wd = w.w * (1 - Math.pow(s, 3) * 0.92) * (0.35 + 0.65 * Math.min(1, s / 0.08 + 0.001));
    const wv = V(Math.cos(ang) * wd, 0, Math.sin(ang) * wd);
    C.push(proj(c)); L.push(proj(add(c, wv))); R.push(proj(sub(c, wv)));
    if (k === n >> 1) facing = Math.abs(dot(V(-Math.sin(ang), 0, Math.cos(ang)), norm(sub(cam.pos, c))));
  }
  ctx.beginPath(); ctx.moveTo(L[0].x, L[0].y);
  for (let k = 1; k <= n; k++) ctx.lineTo(L[k].x, L[k].y);
  for (let k = n; k >= 0; k--) ctx.lineTo(R[k].x, R[k].y);
  ctx.closePath();
  const kf = 0.6 + 0.5 * facing;
  const g = ctx.createLinearGradient(C[0].x, C[0].y, C[n].x, C[n].y);
  g.addColorStop(0, col(w.col, 0.55 * kf, envAt(w.base)));
  g.addColorStop(0.55, col(w.col, kf, envAt(V(w.base.x, w.base.y + w.h * 0.55, w.base.z))));
  g.addColorStop(1, col(mix3(w.col, [200, 230, 120], 0.3), 1.25 * kf, envAt(V(w.base.x, w.base.y + w.h, w.base.z))));
  ctx.fillStyle = g; ctx.fill();
  if (kelp && C[0].s * w.w > 3) {
    ctx.beginPath(); ctx.moveTo(C[0].x, C[0].y);
    for (let k = 1; k <= n; k++) ctx.lineTo(C[k].x, C[k].y);
    ctx.strokeStyle = col(mix3(w.col, [20, 30, 10], 0.5), 0.8, envAt(w.base), 0.45);
    ctx.lineWidth = Math.max(0.6, 0.02 * C[0].s); ctx.lineCap = 'round'; ctx.stroke();
  }
}
function drawBubble(b) {
  const P = b.P, rp = b.r * P.s;
  if (rp < 0.5) return;
  ctx.globalAlpha = (1 - 0.85 * fogOf(b)) * 0.95;
  ctx.drawImage(bubSpr, P.x - rp, P.y - rp, rp * 2, rp * 2);
  ctx.globalAlpha = 1;             // не протекать в следующие по глубине объекты
}
function drawMote(m) {
  const P = m.P, sz = Math.max(0.8 * DPR, m.s * P.s * 2.2);
  ctx.globalAlpha = clamp(0.5 * (1 - 0.9 * fogOf(m)) * Math.min(1, m.s * P.s * 1.5 + 0.3), 0, 0.6);
  ctx.drawImage(dotSpr, P.x - sz, P.y - sz, sz * 2, sz * 2);
  ctx.globalAlpha = 1;
}

// ════════════ корпус аквариума, стекло, тумба ════════════
function boxFaces(x0, x1, y0, y1, z0, z1, skip) {
  const f = [
    { n: V(0, 0, 1), q: [V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1)] },
    { n: V(0, 0, -1), q: [V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0)] },
    { n: V(1, 0, 0), q: [V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1)] },
    { n: V(-1, 0, 0), q: [V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0)] },
    { n: V(0, 1, 0), q: [V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0)] },
    { n: V(0, -1, 0), q: [V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1)] },
  ];
  return f.filter((_, i) => !skip.includes(i));
}
function drawBox(faces, style) {
  for (const f of faces) {
    if (dot(f.n, sub(cam.pos, f.q[0])) <= 0) continue;
    const P = f.q.map(proj);
    quadPath(P);
    ctx.fillStyle = style(f, P); ctx.fill();
  }
}
const vgrad = (P, stops) => {
  const g = ctx.createLinearGradient(0, Math.min(P[2].y, P[3].y), 0, Math.max(P[0].y, P[1].y));
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
};
const standFaces = boxFaces(-TW - 0.45, TW + 0.45, -7.5, -0.3, -TD - 0.45, TD + 0.45, []);
const trimFaces = boxFaces(-TW - 0.14, TW + 0.14, -0.35, 0.55, -TD - 0.14, TD + 0.14, [4, 5]);
const lidFaces = boxFaces(-TW - 0.2, TW + 0.2, TH - 0.34, TH + 0.62, -TD - 0.2, TD + 0.2, [5]);
const standStyle = (f, P) => (f.n.y > 0.5 ? '#0b161a' : Math.abs(f.n.x) > 0.5
  ? vgrad(P, [[0, '#0b1518'], [0.25, '#060b0d'], [1, '#020304']])
  : vgrad(P, [[0, '#17282e'], [0.2, '#0a1417'], [1, '#020304']]));
const trimStyle = (f, P) => vgrad(P, [[0, '#1d2e33'], [0.35, '#070a0b'], [1, '#030405']]);
const lidStyle = (f, P) => (f.n.y > 0.5 ? '#0a0f11' : vgrad(P, [[0, '#0b1113'], [0.75, '#121b1f'], [1, '#22343a']]));

function drawGlass() {
  const fc = [V(-TW, 0, TD), V(TW, 0, TD), V(TW, TH, TD), V(-TW, TH, TD)].map(proj);
  const x0 = Math.min(fc[0].x, fc[3].x), x1 = Math.max(fc[1].x, fc[2].x);
  const y0 = Math.min(fc[2].y, fc[3].y), y1 = Math.max(fc[0].y, fc[1].y);
  const w = x1 - x0, cy = (y0 + y1) / 2;
  ctx.save();
  quadPath(fc); ctx.clip();
  ctx.globalCompositeOperation = 'screen';
  // блики «гуляют» по стеклу против движения камеры — отражение, а не рисунок на стекле
  const band = (cx, bw, al) => {
    const ux = 1 / Math.hypot(1, 0.42), uy = 0.42 * ux;
    const g = ctx.createLinearGradient(cx - ux * bw, cy - uy * bw, cx + ux * bw, cy + uy * bw);
    g.addColorStop(0, 'rgba(200,240,255,0)'); g.addColorStop(0.38, rgba(200, 240, 255, al * 0.25));
    g.addColorStop(0.5, rgba(215, 248, 255, al)); g.addColorStop(0.6, rgba(200, 240, 255, al * 0.35)); g.addColorStop(1, 'rgba(200,240,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x0, y0, w, y1 - y0);
  };
  const yw = cam.yaw;
  band(x0 + w * (0.26 - yw * 0.9), w * 0.13, 0.08);
  band(x0 + w * (0.41 - yw * 0.9), w * 0.028, 0.07);
  band(x0 + w * (0.83 - yw * 0.6), w * 0.08, 0.045);
  const g = ctx.createLinearGradient(0, y0, 0, y0 + (y1 - y0) * 0.14);
  g.addColorStop(0, rgba(170, 232, 255, 0.12 * (0.5 + 0.5 * Math.min(1.3, S.light)))); g.addColorStop(1, 'rgba(170,232,255,0)');
  ctx.fillStyle = g; ctx.fillRect(x0, y0, w, y1 - y0);
  ctx.restore();
  // рёбра стекла: торец толстого стекла светится зелёным
  ctx.lineCap = 'butt';
  for (const x of [-TW, TW]) {
    const a = proj(V(x, 0.5, TD)), b = proj(V(x, TH - 0.3, TD)), inset = -Math.sign(x) * 0.05 * a.s;
    ctx.strokeStyle = 'rgba(0,16,20,0.5)'; ctx.lineWidth = Math.max(1, 0.14 * a.s);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(170,255,235,0.3)'; ctx.lineWidth = Math.max(1, 0.05 * a.s);
    ctx.beginPath(); ctx.moveTo(a.x + inset, a.y); ctx.lineTo(b.x + inset, b.y); ctx.stroke();
  }
}
function drawLED() {
  const a = proj(V(-TW - 0.1, TH - 0.34, TD + 0.2)), b = proj(V(TW + 0.1, TH - 0.34, TD + 0.2));
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  const k = 0.4 + 0.6 * Math.min(1.3, S.light);
  for (const [w, al] of [[14, 0.05], [5, 0.14], [1.6, 0.55]]) {
    ctx.strokeStyle = rgba(170, 235, 255, al * k); ctx.lineWidth = w * DPR;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}
// ── постобработка: мягкое свечение ярких мест (x⁴ как порог) и виньетка ──
function post() {
  g1.globalCompositeOperation = 'copy'; g1.drawImage(cv, 0, 0, glow1.width, glow1.height);
  g2.globalCompositeOperation = 'copy'; g2.drawImage(glow1, 0, 0, glow2.width, glow2.height);
  g2.globalCompositeOperation = 'multiply'; g2.drawImage(glow2, 0, 0); g2.drawImage(glow2, 0, 0);
  g2.globalCompositeOperation = 'source-over';
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.6;
  ctx.drawImage(glow2, 0, 0, WW, HH);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const vg = ctx.createRadialGradient(WW / 2, HH * 0.48, Math.min(WW, HH) * 0.35, WW / 2, HH * 0.48, Math.hypot(WW, HH) * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, WW, HH);
}

// ════════════ кадр ════════════
let simT = 0;
const items = [];
function render() {
  const t = simT;
  updateCamera(t);
  updateCaustics(t * 0.42 + 23);
  composeFloor(t);
  const seeSurf = cam.pos.y < TH;
  if (seeSurf) composeSurface(t);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  drawRoom();
  drawBox(standFaces, standStyle);
  drawWalls();
  if (seeSurf) mapPlane(sfCv, SFW, SFH, surfP3, 6, 4);
  mapPlane(floorCv, FTW, FTH, floorP3, 10, 8);
  drawBackEdges();
  drawHaze();
  // алгоритм художника: всё содержимое объёма сортируется по дальности от камеры
  items.length = 0;
  for (const r of rocks) items.push({ z: proj(r.center).z, k: 0, o: r });
  for (const w of weeds) items.push({ z: proj(w.base).z, k: 1, o: w });
  for (const f of fishes) items.push({ z: proj(f.pos).z, k: 2, o: f });
  for (const b of bubbles) { b.P = proj(b); items.push({ z: b.P.z, k: 3, o: b }); }
  for (const m of motes) { m.P = proj(m); items.push({ z: m.P.z, k: 4, o: m }); }
  for (const r of rays) items.push({ z: proj(V(r.x, TH * 0.55, r.z)).z, k: 5, o: r });
  items.sort((a, b) => b.z - a.z);
  for (const it of items) {
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';   // каждый объект — непрозрачный с чистого состояния
    switch (it.k) {
      case 0: drawRock(it.o, t); break;
      case 1: drawWeed(it.o, t); break;
      case 2: drawFish(it.o, t); break;
      case 3: drawBubble(it.o); break;
      case 4: drawMote(it.o); break;
      default: drawRay(it.o, t);
    }
  }
  ctx.globalAlpha = 1;
  drawGlass();
  drawBox(trimFaces, trimStyle);
  drawBox(lidFaces, lidStyle);
  drawLED();
  post();
}

// ════════════ управление ════════════
const $ = (id) => document.getElementById(id);
const bP = $('btnPause'), bO = $('btnOrbit');
bP.addEventListener('click', () => { S.paused = !S.paused; bP.textContent = S.paused ? 'Пуск' : 'Пауза'; bP.classList.toggle('on', S.paused); });
bO.addEventListener('click', () => { S.orbit = !S.orbit; bO.classList.toggle('on', S.orbit); });
$('rngFog').addEventListener('input', (e) => { S.fog = +e.target.value; });
$('rngLight').addEventListener('input', (e) => { S.light = +e.target.value; });
let drag = null;
cv.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY }; cv.classList.add('drag');
  try { cv.setPointerCapture(e.pointerId); } catch (_) { /* нет захвата — не страшно */ }
});
cv.addEventListener('pointermove', (e) => {
  if (!drag) return;
  camCtl.dragYaw = clamp(camCtl.dragYaw - (e.clientX - drag.x) * 0.004, -0.75, 0.75);
  camCtl.dragH = clamp(camCtl.dragH + (e.clientY - drag.y) * 0.012, -3.5, 1.4);
  drag.x = e.clientX; drag.y = e.clientY;
});
const endDrag = () => { drag = null; cv.classList.remove('drag'); };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('wheel', (e) => { e.preventDefault(); camCtl.zoom = clamp(camCtl.zoom + e.deltaY * 0.01, -7, 10); }, { passive: false });
cv.addEventListener('dblclick', () => { camCtl.dragYaw = 0; camCtl.dragH = 0; camCtl.zoom = 0; });
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); bP.click(); } });

// ════════════ цикл ════════════
let last = performance.now(), perfAcc = 0, perfN = 0, perfSkip = 60;
function frame(now) {
  const rawDt = Math.max(0, (now - last) / 1000);
  last = now;
  const dt = Math.min(rawDt, 0.05);                 // кламп большого шага (вкладка в фоне и т.п.)
  if (!S.paused) {
    simT += dt;
    if (S.orbit) camCtl.autoT += dt;
    updateSchools(simT);
    for (const f of fishes) updateFish(f, dt, simT);
    updateBubbles(dt, simT);
    updateMotes(dt, simT);
  }
  render();
  // адаптивное разрешение: если кадр стабильно тяжёлый — снижаем плотность пикселей
  if (perfSkip > 0) perfSkip--;
  else if (rawDt < 0.25) {
    perfAcc += rawDt; perfN++;
    if (perfN >= 90) {
      if (perfAcc / perfN > 0.03 && qScale > 0.5) { qScale *= 0.85; resize(); perfSkip = 60; }
      perfAcc = 0; perfN = 0;
    }
  }
  requestAnimationFrame(frame);
}
// короткий разгон симуляции, чтобы стая успела собраться до первого кадра
for (let i = 0; i < 90; i++) {
  simT += 1 / 60;
  updateSchools(simT);
  for (const f of fishes) updateFish(f, 1 / 60, simT);
  updateBubbles(1 / 60, simT);
}
requestAnimationFrame(frame);
})();
