/* =====================================================================
   Солнечная система — Canvas 2D, без библиотек и без WebGL.

   • Орбиты: кеплеровы элементы JPL (эпоха J2000) + вековой ход средней
     долготы; старт — с сегодняшней даты, положения планет реальные.
   • Оси вращения: полюса IAU (RA/Dec) → эклиптика; кольца Сатурна лежат
     в его экваториальной плоскости, поэтому их раскрытие верно по сезону.
   • Поверхности: процедурные текстуры (генерируются порциями по кадрам),
     освещение считается попиксельно в линейном цвете: ламберт, атмосфера,
     тень колец на планете и планеты на кольцах, тени лун, ночные огни,
     солнечный блик на океане.
   • Расстояния сжимаются степенью r^p (p регулируется), направления и
     наклоны орбит при этом сохраняются точно.
   ===================================================================== */
(() => {
'use strict';

// ============================================================ математика
const TAU = Math.PI * 2, DEG = Math.PI / 180, INV_TAU = 1 / TAU, INV_PI = 1 / Math.PI;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
function sstep(a, b, x) { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = a => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
function vnorm(a) { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function rotAxis(v, k, ang) { // формула Родрига, k — единичная ось
  const c = Math.cos(ang), s = Math.sin(ang), kv = vdot(k, v), kx = vcross(k, v);
  return [v[0] * c + kx[0] * s + k[0] * kv * (1 - c), v[1] * c + kx[1] * s + k[1] * kv * (1 - c), v[2] * c + kx[2] * s + k[2] * kv * (1 - c)];
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(TAU * r()); }
const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const srgb2lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function fastAtan2(y, x) {
  const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
  if (ax === 0 && ay === 0) return 0;
  let a, sw = false;
  if (ay > ax) { a = ax / ay; sw = true; } else a = ay / ax;
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (sw) r = 1.5707963267948966 - r;
  if (x < 0) r = 3.141592653589793 - r;
  return y < 0 ? -r : r;
}

// sRGB → линейный; линейный → sRGB с мягким «плечом» (киношная компрессия светов).
// Индекс LUT по корню, чтобы тёмные тона (ночная сторона) не бандились.
const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) S2L[i] = srgb2lin(i / 255);
const TN = 4096, TMAX = 6, INV_TMAX = 1 / TMAX;
const L2S = new Uint8Array(TN + 1);
for (let i = 0; i <= TN; i++) {
  const x = (i / TN) * (i / TN) * TMAX;
  const y = x < 0.7 ? x : 0.7 + 0.3 * (1 - Math.exp(-(x - 0.7) / 0.3));
  L2S[i] = Math.round(clamp(y <= 0.0031308 ? y * 12.92 : 1.055 * Math.pow(y, 1 / 2.4) - 0.055, 0, 1) * 255);
}

// ============================================================ шум
const PERM = new Uint8Array(512);
{
  const r = mulberry32(90210), p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
function grad3(h, x, y, z) {
  switch (h & 15) {
    case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
    case 4: return x + z; case 5: return -x + z; case 6: return x - z; case 7: return -x - z;
    case 8: return y + z; case 9: return -y + z; case 10: return y - z; case 11: return -y - z;
    case 12: return x + y; case 13: return -x + y; case 14: return -y + z; default: return -y - z;
  }
}
function noise3(x, y, z) {
  let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z; X &= 255; Y &= 255; Z &= 255;
  const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10), w = z * z * z * (z * (z * 6 - 15) + 10);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z, B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  const x1 = x - 1, y1 = y - 1, z1 = z - 1;
  const g000 = grad3(PERM[AA], x, y, z), g100 = grad3(PERM[BA], x1, y, z), g010 = grad3(PERM[AB], x, y1, z), g110 = grad3(PERM[BB], x1, y1, z);
  const g001 = grad3(PERM[AA + 1], x, y, z1), g101 = grad3(PERM[BA + 1], x1, y, z1), g011 = grad3(PERM[AB + 1], x, y1, z1), g111 = grad3(PERM[BB + 1], x1, y1, z1);
  const a0 = g000 + u * (g100 - g000), a1 = g010 + u * (g110 - g010), a2 = g001 + u * (g101 - g001), a3 = g011 + u * (g111 - g011);
  const b0 = a0 + v * (a1 - a0), b1 = a2 + v * (a3 - a2);
  return b0 + w * (b1 - b0);
}
// fbm: σ ≈ 0.3 (замерено), размах примерно ±1
function fbm(x, y, z, oct) { let s = 0, a = 1, f = 1; for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s; }

function hash3(i, j, k, s) {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b1) ^ Math.imul(s, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}
function hrand(h, k) { let x = Math.imul(h ^ Math.imul(k, 0x9e3779b1), 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
let WF1 = 0, WF2 = 0, WID = 0;
function worley(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let f1 = 1e9, f2 = 1e9, id = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, cz = zi + dz, h = hash3(cx, cy, cz, seed);
    const px = cx + (h & 1023) / 1024 - x, py = cy + ((h >>> 10) & 1023) / 1024 - y, pz = cz + ((h >>> 20) & 1023) / 1024 - z;
    const d = px * px + py * py + pz * pz;
    if (d < f1) { f2 = f1; f1 = d; id = h; } else if (d < f2) f2 = d;
  }
  WF1 = Math.sqrt(f1); WF2 = Math.sqrt(f2); WID = id;
}
// кратер: возвращает вариацию альбедо, а высоту рельефа кладёт в CH
// (глубина пропорциональна радиусу — склоны одинаково крутые на всех масштабах)
let CH = 0;
function craters(x, y, z, f, seed, dens) {
  CH = 0;
  worley(x * f, y * f, z * f, seed);
  if (hrand(WID, 1) > dens) return 0;
  const rad = 0.16 + 0.3 * hrand(WID, 2), t = WF1 / rad;
  if (t > 1.8) return 0;
  const sc = rad / f, rim = Math.exp(-((t - 1) * (t - 1)) / 0.02);
  if (t < 1) { CH = sc * (-0.9 * (1 - t * t) + 0.35 * rim); return -0.05 * (1 - t * t) + 0.08 * Math.exp(-((t - 0.9) * (t - 0.9)) / 0.01); }
  CH = sc * 0.35 * rim;
  return 0.045 * Math.exp(-(t - 1) * 4);
}

// ============================================================ процедурные текстуры
// Сигнатура: (x, y, z) — точка единичной сферы (y — ось полюса), lat/lon в радианах.
// o[0..2] — sRGB 0..1, у Земли ещё o[3] — океан, o[4] — ночные огни, o[5] — облака.
function makeBands(list) { return list.map(([la, h]) => [la, hex(h)]); }
function bandColor(tab, latd, o) {
  if (latd >= tab[0][0]) { const c = tab[0][1]; o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; return; }
  for (let i = 0; i < tab.length - 1; i++) {
    const a = tab[i], b = tab[i + 1];
    if (latd <= a[0] && latd >= b[0]) {
      const t = sstep(0.12, 0.88, (a[0] - latd) / (a[0] - b[0]));
      o[0] = lerp(a[1][0], b[1][0], t); o[1] = lerp(a[1][1], b[1][1], t); o[2] = lerp(a[1][2], b[1][2], t);
      return;
    }
  }
  const c = tab[tab.length - 1][1]; o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
}
const JUP = makeBands([[90, '#7c7f87'], [66, '#8f8c85'], [52, '#a99a82'], [44, '#c9b89a'], [38, '#dccbaa'], [33, '#b68b64'], [29, '#e4d4b5'],
  [24, '#9a6746'], [20, '#d7c09c'], [16, '#ecdfc6'], [12, '#a6633d'], [7, '#b87a52'], [4, '#e6d2ae'], [0, '#eadabb'], [-4, '#dcc19a'],
  [-8, '#b98458'], [-12, '#985b39'], [-18, '#a86b45'], [-21, '#e6d9c0'], [-26, '#ebe0ca'], [-30, '#b8906e'], [-35, '#e2d0b1'],
  [-41, '#c1a585'], [-50, '#b09f89'], [-62, '#958f86'], [-90, '#7a7d86']]);
const SAT = makeBands([[90, '#8c9aa5'], [78, '#a7a996'], [66, '#c4b489'], [52, '#d8c393'], [40, '#e2d0a2'], [30, '#d2b781'], [22, '#e6d5a8'],
  [14, '#dcc493'], [6, '#eee0b8'], [0, '#f0e3bd'], [-6, '#ebdbb0'], [-14, '#d5bb87'], [-22, '#e4d1a2'], [-32, '#d1b885'], [-44, '#dcc79a'],
  [-58, '#c6b18a'], [-72, '#b3a58a'], [-90, '#9d9989']]);
const NEP = makeBands([[90, '#2b4ba8'], [70, '#3152b6'], [50, '#3a60cc'], [32, '#4570dd'], [18, '#3b63d2'], [0, '#3d66d6'], [-15, '#3960cf'],
  [-28, '#3259c3'], [-45, '#4674e0'], [-65, '#3659c2'], [-90, '#2c4aa6']]);

function texSun(x, y, z, lat, lon, o) {
  worley(x * 30, y * 30, z * 30, 81);
  const gran = sstep(0.0, 0.3, WF2 - WF1); // мелкая грануляция + супергрануляция + пятнистость
  let I = 0.8 + 0.06 * gran + 0.07 * fbm(x * 11 + 3, y * 11, z * 11, 2) + 0.11 * fbm(x * 3.5 + 1, y * 3.5, z * 3.5, 3);
  for (let k = 0; k < SUN_SPOTS.length; k++) {
    const s = SUN_SPOTS[k];
    const dd = Math.acos(clamp(x * s[0] + y * s[1] + z * s[2], -1, 1)), t = dd / s[3];
    if (t < 1) I *= lerp(lerp(0.26, 0.7, sstep(0.38, 0.55, t)), 1, sstep(0.85, 1, t)) * (1 + 0.08 * noise3(x * 90, y * 90, z * 90));
    else if (t < 2.8) I *= 1 + 0.09 * Math.exp(-(t - 1.5) * (t - 1.5) * 2);
  }
  o[0] = clamp(I * 1.02, 0, 1); o[1] = I * 0.74; o[2] = I * 0.42;
}
const SUN_SPOTS = [[14, 0.6, 0.045], [-17, 2.2, 0.06], [-12, 2.37, 0.03], [21, -1.9, 0.04], [9, -2.6, 0.026], [-8, -0.7, 0.022]]
  .map(([la, lo, r]) => [Math.cos(la * DEG) * Math.cos(lo), Math.sin(la * DEG), Math.cos(la * DEG) * Math.sin(lo), r]);

function texMercury(x, y, z, lat, lon, o) {
  const n = fbm(x * 2 + 3.1, y * 2, z * 2, 4);
  let a = 0.5 + 0.1 * n + 0.04 * noise3(x * 30, y * 30, z * 30), hh = n * 0.01;
  a += craters(x, y, z, 3.0, 11, 0.75) * 0.9; hh += CH;
  a += craters(x, y, z, 7.5, 12, 0.7) * 0.7; hh += CH;
  a += craters(x, y, z, 18, 13, 0.6) * 0.45; hh += CH;
  a += craters(x, y, z, 40, 14, 0.5) * 0.3; hh += CH;
  a = clamp(a, 0.08, 1);
  o[0] = a; o[1] = a * 0.94; o[2] = a * 0.87; o[3] = hh;
}

function texVenus(x, y, z, lat, lon, o) {
  const al = Math.abs(lat), ang = al * 1.6, c = Math.cos(ang), s = Math.sin(ang);
  const xr = x * c - z * s, zr = x * s + z * c; // Y-образные «шевроны» облаков
  const n = fbm(xr * 1.5 + 2, y * 4.5, zr * 1.5, 5), n2 = fbm(x * 3 + 7, y * 8, z * 3, 3);
  const t = clamp(0.55 + n * 0.8 + n2 * 0.25, 0, 1);
  const pole = sstep(1.1, 1.45, al) * 0.4;
  o[0] = lerp(lerp(0.76, 0.96, t), 0.93, pole); o[1] = lerp(lerp(0.6, 0.9, t), 0.88, pole); o[2] = lerp(lerp(0.36, 0.72, t), 0.74, pole);
}

function texEarth(x, y, z, lat, lon, o) {
  const wx = fbm(x * 1.1 + 7.1, y * 1.1 + 1.3, z * 1.1 - 3.7, 2) * 0.5;
  const wy = fbm(x * 1.1 - 4.2, y * 1.1 + 8.6, z * 1.1 + 2.9, 2) * 0.5;
  const wz = fbm(x * 1.1 + 3.3, y * 1.1 - 6.1, z * 1.1 + 9.4, 2) * 0.5;
  const h = fbm(x * 1.5 + wx, y * 1.5 + wy, z * 1.5 + wz, 6);
  const al = Math.abs(lat) * (2 / Math.PI);
  const SEA = 0.12;
  const det = noise3(x * 22, y * 22, z * 22);
  const iceN = noise3(x * 5 + 2, y * 5, z * 5 - 1) * 0.06;
  let r, g, b, ocean = 0, lights = 0;
  if (h < SEA) {
    const dd = Math.sqrt(clamp((SEA - h) * 2.4, 0, 1));
    r = lerp(0.09, 0.012, dd); g = lerp(0.38, 0.08, dd); b = lerp(0.52, 0.23, dd);
    ocean = 1;
    const ice = sstep(0.8, 0.86, al + iceN);
    if (ice > 0) { r = lerp(r, 0.86, ice); g = lerp(g, 0.9, ice); b = lerp(b, 0.95, ice); ocean = 1 - ice; }
  } else {
    const e = h - SEA;
    const m = fbm(x * 2.3 + 31.7, y * 2.3 + 17.2, z * 2.3 - 5.1, 3);
    const band = Math.exp(-Math.pow((al - 0.28) / 0.12, 2));
    const dry = clamp(clamp(band * 1.2 - m * 2.4 - 0.35, 0, 1) + clamp(-m * 2 - 0.5, 0, 1) * 0.55, 0, 1);
    const wet = clamp(0.55 - m * 2, 0, 1);
    r = lerp(0.09, 0.34, wet); g = lerp(0.2, 0.37, wet); b = lerp(0.07, 0.15, wet);
    r = lerp(r, 0.74, dry); g = lerp(g, 0.6, dry); b = lerp(b, 0.42, dry);
    const tun = sstep(0.55, 0.72, al);
    r = lerp(r, 0.38, tun); g = lerp(g, 0.37, tun); b = lerp(b, 0.3, tun);
    const mt = sstep(0.18, 0.42, e) * 0.8;
    r = lerp(r, 0.44, mt); g = lerp(g, 0.39, mt); b = lerp(b, 0.33, mt);
    const k = 1 + det * 0.18; r *= k; g *= k; b *= k;
    const snow = Math.max(sstep(0.76, 0.83, al + iceN), sstep(0.5, 0.62, e * 0.9 + al * 0.5));
    r = lerp(r, 0.93, snow); g = lerp(g, 0.95, snow); b = lerp(b, 0.98, snow);
    if (snow < 0.3 && dry < 0.75 && al < 0.72) {
      const pop = fbm(x * 4.5 + 3.3, y * 4.5 + 1.1, z * 4.5 + 9.9, 2);
      const coast = sstep(0.08, 0.0, e);
      const spark = noise3(x * 70, y * 70, z * 70);
      lights = clamp((pop + 0.05) * 2.4 + coast * 0.5, 0, 1) * clamp(spark * 2.6 + 0.35, 0, 1) * (1 - dry) * (1 - snow) * (1 - tun * 0.6);
    }
  }
  const cw = fbm(x * 1.8 + 5.5, y * 1.8, z * 1.8 - 2.2, 2);
  const cn = fbm(x * 2.6 + cw * 1.6, y * 5.2 + cw * 1.3, z * 2.6 - cw * 1.6, 5);
  const fine = fbm(x * 11 + cw * 2, y * 17, z * 11 - cw * 2, 3); // рваные края и перистые полосы
  const bias = 0.12 * Math.exp(-Math.pow(al / 0.1, 2)) - 0.16 * Math.exp(-Math.pow((al - 0.3) / 0.1, 2)) + 0.1 * Math.exp(-Math.pow((al - 0.62) / 0.12, 2));
  o[0] = r; o[1] = g; o[2] = b; o[3] = ocean; o[4] = lights; o[5] = sstep(0.04, 0.52, cn + bias + fine * 0.2) * 0.93;
}

function texMars(x, y, z, lat, lon, o) {
  const n = fbm(x * 1.6 + 1.3, y * 1.6 - 0.4, z * 1.6 - 2.1, 6);
  const dark = sstep(0.05, 0.22, n + 0.1 * Math.sin(lat * 2.5 + 0.6));
  let r = lerp(0.78, 0.4, dark), g = lerp(0.44, 0.23, dark), b = lerp(0.25, 0.15, dark);
  const lite = sstep(-0.1, -0.35, n) * 0.55;
  r = lerp(r, 0.88, lite); g = lerp(g, 0.6, lite); b = lerp(b, 0.4, lite);
  const det = noise3(x * 14, y * 14, z * 14) + 0.5 * noise3(x * 31, y * 31, z * 31);
  const k = 1 + det * 0.16; r *= k; g *= k; b *= k;
  let hh = -n * 0.02 + det * 0.003;
  const cr = craters(x, y, z, 6, 21, 0.3) * 0.3; hh += CH * 0.8;
  r += cr; g += cr * 0.8; b += cr * 0.6;
  craters(x, y, z, 15, 22, 0.28); hh += CH * 0.6;
  const vl = lat + 0.14 + noise3(x * 9, y * 9, z * 9) * 0.02; // долины Маринер
  const vm = Math.exp(-(vl * vl) / 0.0005) * sstep(-2.0, -1.75, lon) * sstep(-0.9, -1.15, lon);
  r *= 1 - vm * 0.5; g *= 1 - vm * 0.55; b *= 1 - vm * 0.5; hh -= vm * 0.012;
  const cap = Math.max(sstep(1.28, 1.36, lat + det * 0.05), sstep(1.34, 1.42, -lat + det * 0.05));
  o[0] = lerp(r, 0.95, cap); o[1] = lerp(g, 0.94, cap); o[2] = lerp(b, 0.92, cap); o[3] = hh;
}

const JUP_OVALS = [[-40.5 * DEG, 2.5, 0.045], [-40 * DEG, -0.4, 0.035], [-41 * DEG, 0.9, 0.03], [33 * DEG, -2.1, 0.028], [-33 * DEG, -2.6, 0.03]];
function texJupiter(x, y, z, lat, lon, o) {
  const w1 = fbm(x * 1.4 + 2.2, y * 6.5, z * 1.4 - 1.7, 4);
  const w2 = noise3(x * 5.5, y * 24, z * 5.5);
  bandColor(JUP, lat / DEG + w1 * 3.6 + w2 * 1.1, o);
  const st = fbm(x * 2.6 + 11, y * 34, z * 2.6, 3), edd = noise3(x * 12 + w1 * 2, y * 30, z * 12);
  const k = 1 + st * 0.14 + edd * 0.05;
  o[0] *= k; o[1] *= k; o[2] *= k;
  // Большое красное пятно
  let dl = lon - 1.25; dl -= TAU * Math.round(dl / TAU);
  const ex = dl * Math.cos(lat) / 0.15, ey = (lat + 22.4 * DEG) / 0.07, er = Math.sqrt(ex * ex + ey * ey);
  if (er < 2.0) {
    const ang = Math.atan2(ey, ex) + 2.8 * Math.max(0, 1 - er);
    const sw = noise3(Math.cos(ang) * er * 3 + 5, Math.sin(ang) * er * 3, er * 2);
    const inside = sstep(1.0, 0.55, er), collar = Math.exp(-((er - 1.15) * (er - 1.15)) / 0.03) * 0.55;
    o[0] = lerp(o[0], 0.93, collar); o[1] = lerp(o[1], 0.88, collar); o[2] = lerp(o[2], 0.78, collar);
    o[0] = lerp(o[0], 0.76 + sw * 0.14, inside); o[1] = lerp(o[1], 0.37 + sw * 0.09, inside); o[2] = lerp(o[2], 0.25 + sw * 0.05, inside);
  }
  for (let q = 0; q < JUP_OVALS.length; q++) {
    const ov = JUP_OVALS[q];
    let d = lon - ov[1]; d -= TAU * Math.round(d / TAU);
    const ax = d * Math.cos(lat) / ov[2], ay = (lat - ov[0]) / (ov[2] * 0.6), e2 = ax * ax + ay * ay;
    if (e2 < 3) { const t = Math.exp(-e2 * 2.2); o[0] = lerp(o[0], 0.95, t); o[1] = lerp(o[1], 0.93, t); o[2] = lerp(o[2], 0.88, t); }
  }
}

function texSaturn(x, y, z, lat, lon, o) {
  const w1 = fbm(x * 1.3 + 4.4, y * 7, z * 1.3, 3);
  bandColor(SAT, lat / DEG + w1 * 1.6, o);
  const k = 1 + fbm(x * 2.2 + 3, y * 40, z * 2.2, 3) * 0.07;
  o[0] *= k; o[1] *= k; o[2] *= k;
  if (lat > 1.1) { // северный шестиугольник
    const ang = Math.atan2(z, x), rr = (Math.PI / 2 - lat) / (14 * DEG);
    const sec = Math.PI / 3, seg = (((ang % sec) + sec) % sec) - sec / 2;
    const hr = Math.cos(sec / 2) / Math.cos(seg);
    const inHex = sstep(1.04, 0.96, rr / hr) * 0.55, edge = Math.exp(-Math.pow((rr / hr - 1) / 0.05, 2)) * 0.25;
    o[0] = lerp(o[0], 0.56, inHex) + edge * 0.2; o[1] = lerp(o[1], 0.62, inHex) + edge * 0.2; o[2] = lerp(o[2], 0.66, inHex) + edge * 0.15;
  }
}

function texUranus(x, y, z, lat, lon, o) {
  const k = 1 + 0.025 * Math.sin(lat * 9) + fbm(x * 1.5, y * 10, z * 1.5, 3) * 0.03;
  const pol = sstep(0.7, 1.3, lat) * 0.4;
  o[0] = lerp(0.62, 0.82, pol) * k; o[1] = lerp(0.84, 0.93, pol) * k; o[2] = lerp(0.87, 0.93, pol) * k;
}

function texNeptune(x, y, z, lat, lon, o) {
  const w = fbm(x * 1.4 + 1, y * 6, z * 1.4, 3), latd = lat / DEG + w * 3;
  bandColor(NEP, latd, o);
  const k = 1 + fbm(x * 2 + 7, y * 26, z * 2, 3) * 0.1;
  o[0] *= k; o[1] *= k; o[2] *= k;
  let dl = lon - 2.3; dl -= TAU * Math.round(dl / TAU);
  const ex = dl * Math.cos(lat) / 0.16, ey = (lat + 20 * DEG) / 0.075, er = ex * ex + ey * ey;
  if (er < 3) { const t = Math.exp(-er * 1.8) * 0.85; o[0] = lerp(o[0], 0.11, t); o[1] = lerp(o[1], 0.18, t); o[2] = lerp(o[2], 0.45, t); }
  const q = 1 - Math.abs(noise3(x * 2.5 + 3, y * 18, z * 2.5));
  const cl = Math.pow(q, 8) * (Math.exp(-((latd + 27) * (latd + 27)) / 30) + 0.8 * Math.exp(-((latd - 33) * (latd - 33)) / 40) + 0.4 * Math.exp(-((latd + 52) * (latd + 52)) / 20));
  const c2 = clamp(cl * 1.6, 0, 0.9);
  o[0] = lerp(o[0], 0.9, c2); o[1] = lerp(o[1], 0.94, c2); o[2] = lerp(o[2], 1.0, c2);
}

const TYCHO = [Math.cos(-43 * DEG) * Math.cos(Math.PI - 0.19), Math.sin(-43 * DEG), Math.cos(-43 * DEG) * Math.sin(Math.PI - 0.19)];
function texMoon(x, y, z, lat, lon, o) {
  const near = Math.cos(lat) * Math.cos(lon - Math.PI); // lon = π смотрит на Землю
  const m = fbm(x * 1.6 + 4.1, y * 1.6 + 0.3, z * 1.6 - 2.7, 5) + 0.26 * near - 0.12;
  const mare = sstep(-0.03, 0.1, m);
  let a = lerp(0.62, 0.37, mare) + 0.05 * fbm(x * 6, y * 6, z * 6, 3), hh = -mare * 0.012;
  a += craters(x, y, z, 2.6, 31, 0.6) * (1 - mare * 0.7); hh += CH * (1 - mare * 0.6);
  a += craters(x, y, z, 6.5, 32, 0.7) * 0.8; hh += CH;
  a += craters(x, y, z, 15, 33, 0.65) * 0.5; hh += CH;
  a += craters(x, y, z, 34, 34, 0.5) * 0.3; hh += CH;
  const dd = Math.acos(clamp(x * TYCHO[0] + y * TYCHO[1] + z * TYCHO[2], -1, 1));
  a += 0.3 * Math.exp(-(dd * dd) / 0.0012) + 0.07 * Math.exp(-dd / 0.3) * (0.6 + 0.4 * noise3(x * 40, y * 40, z * 40));
  a = clamp(a, 0.05, 1);
  o[0] = a; o[1] = a * 0.97; o[2] = a * 0.93; o[3] = hh;
}

function texIo(x, y, z, lat, lon, o) {
  const n = fbm(x * 2.4 + 1.7, y * 2.4, z * 2.4 - 0.8, 5);
  let r = 0.9, g = 0.8, b = 0.4;
  const wh = sstep(0.1, 0.3, n); r = lerp(r, 0.95, wh); g = lerp(g, 0.93, wh); b = lerp(b, 0.76, wh);
  const orn = sstep(-0.1, -0.3, n); r = lerp(r, 0.82, orn); g = lerp(g, 0.5, orn); b = lerp(b, 0.2, orn);
  const pol = sstep(0.8, 1.3, Math.abs(lat)); r = lerp(r, 0.58, pol); g = lerp(g, 0.5, pol); b = lerp(b, 0.34, pol);
  worley(x * 4.5, y * 4.5, z * 4.5, 41);
  if (hrand(WID, 1) < 0.5) {
    const t = WF1 / (0.07 + 0.12 * hrand(WID, 2));
    if (t < 2.2) {
      const core = sstep(0.5, 0.2, t);
      const ring = Math.exp(-((t - 1.2) * (t - 1.2)) / 0.12) * (hrand(WID, 3) < 0.35 ? 1 : 0.35);
      r = lerp(r, 0.72, ring); g = lerp(g, 0.3, ring); b = lerp(b, 0.14, ring);
      r = lerp(r, 0.13, core); g = lerp(g, 0.09, core); b = lerp(b, 0.06, core);
    }
  }
  const k = 1 + noise3(x * 20, y * 20, z * 20) * 0.08;
  o[0] = r * k; o[1] = g * k; o[2] = b * k;
}

function texEuropa(x, y, z, lat, lon, o) {
  const mot = sstep(0.0, 0.3, fbm(x * 2 + 3, y * 2, z * 2, 5)) * 0.7;
  let r = lerp(0.88, 0.7, mot), g = lerp(0.84, 0.56, mot), b = lerp(0.76, 0.42, mot);
  const wx = noise3(x * 1.5, y * 1.5, z * 1.5) * 0.4;
  const l1 = 1 - Math.abs(noise3(x * 3.2 + wx, y * 3.2 - wx, z * 3.2 + 1.3));
  const l2 = 1 - Math.abs(noise3(x * 7.5 - 2, y * 7.5 + wx, z * 7.5));
  const ln = clamp(Math.pow(l1, 16) * 0.9 + Math.pow(l2, 22) * 0.6, 0, 1);
  r = lerp(r, 0.55, ln); g = lerp(g, 0.34, ln); b = lerp(b, 0.22, ln);
  const k = 1 + noise3(x * 25, y * 25, z * 25) * 0.05;
  o[0] = r * k; o[1] = g * k; o[2] = b * k; o[3] = ln * 0.004 - mot * 0.002; // хребты вдоль линий
}

function texGanymede(x, y, z, lat, lon, o) {
  const n = fbm(x * 1.7 + 0.5, y * 1.7, z * 1.7 + 2.2, 5);
  const br = sstep(-0.02, 0.08, n);
  const gr = 0.5 + 0.5 * Math.sin(noise3(x * 2.5, y * 2.5, z * 2.5) * 42);
  let a = lerp(0.36, 0.64 + 0.06 * gr, br), hh = gr * br * 0.004;
  a += craters(x, y, z, 7, 51, 0.5) * 0.8; hh += CH;
  a += craters(x, y, z, 16, 52, 0.4) * 0.5; hh += CH;
  a = clamp(a + sstep(1.0, 1.35, Math.abs(lat)) * 0.15, 0.05, 1);
  o[0] = a; o[1] = a * 0.93; o[2] = a * 0.84; o[3] = hh;
}

const VALHALLA = [Math.cos(15 * DEG) * Math.cos(-0.9), Math.sin(15 * DEG), Math.cos(15 * DEG) * Math.sin(-0.9)];
function texCallisto(x, y, z, lat, lon, o) {
  let a = 0.3 + 0.05 * fbm(x * 2, y * 2, z * 2, 4);
  worley(x * 13, y * 13, z * 13, 61);
  if (hrand(WID, 1) < 0.75) { const t = WF1 / (0.06 + 0.16 * hrand(WID, 2)); a += 0.42 * Math.exp(-t * t * 2.5); }
  a += craters(x, y, z, 4.5, 62, 0.6) * 0.7;
  let hh = CH;
  craters(x, y, z, 11, 63, 0.6); hh += CH;
  const vd = Math.acos(clamp(x * VALHALLA[0] + y * VALHALLA[1] + z * VALHALLA[2], -1, 1));
  const vr = Math.max(0, Math.cos(vd * 40)) * Math.exp(-vd / 0.35);
  a += 0.14 * Math.exp(-vd * vd / 0.02) + 0.05 * vr; hh += vr * 0.004;
  a = clamp(a, 0.05, 1);
  o[0] = a; o[1] = a * 0.9; o[2] = a * 0.8; o[3] = hh;
}

function texTitan(x, y, z, lat, lon, o) {
  const k = 1 + 0.04 * Math.sin(lat * 5) + 0.035 * fbm(x * 1.4, y * 5, z * 1.4, 3);
  const hood = sstep(0.8, 1.3, lat);
  o[0] = lerp(0.86, 0.66, hood) * k; o[1] = lerp(0.58, 0.44, hood) * k; o[2] = lerp(0.25, 0.22, hood) * k;
}

function texTriton(x, y, z, lat, lon, o) {
  const cap = sstep(-0.05, -0.35, lat + noise3(x * 4, y * 4, z * 4) * 0.12);
  let r = lerp(0.8, 0.95, cap), g = lerp(0.74, 0.87, cap), b = lerp(0.7, 0.83, cap);
  worley(x * 9, y * 9, z * 9, 71);
  const cant = (1 - cap) * (1 - sstep(0.0, 0.14, WF2 - WF1)) * 0.16; // «дынная корка»
  r -= cant; g -= cant; b -= cant * 0.9;
  const st = Math.pow(1 - Math.abs(noise3(x * 3 + 7, y * 14, z * 3)), 10) * cap * 0.35; // следы гейзеров
  r -= st; g -= st * 1.1; b -= st * 1.1;
  const k = 1 + noise3(x * 18, y * 18, z * 18) * 0.06;
  o[0] = r * k; o[1] = g * k; o[2] = b * k;
}

// ---------- очередь генерации: текстуры считаются порциями строк в кадре
const texQueue = [];
let texTotal = 0, texDone = 0;
const TO = new Float64Array(8);
// bump: генератор отдаёт высоту в o[3]; после генерации она превращается
// в градиент (восток, север) в каналах 3–4 — рельеф кратеров у терминатора.
const GRAD_S = 50, INV_GS = 1 / GRAD_S;
function makeTexture(w, h, ch, fn, flat, prio, bump) {
  const t = { w, h, ch, fn, prio, data: new Uint8Array(w * h * ch), row: 0, outCh: bump ? 3 : ch, hgt: bump ? new Float32Array(w * h) : null };
  const ph = new Uint8Array(ch);
  for (let c = 0; c < ch; c++) ph[c] = Math.round(clamp(flat[c] || 0, 0, 1) * 255);
  if (bump) { ph[3] = 128; ph[4] = 128; }
  t.levels = [{ w: 1, h: 1, data: ph }];
  texQueue.push(t); texTotal += w * h;
  return t;
}
function texRow(t, y) {
  const lat = (0.5 - (y + 0.5) / t.h) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
  const d = t.data, ch = t.ch, w = t.w, oc = t.outCh, hg = t.hgt;
  for (let x = 0; x < w; x++) {
    const lon = ((x + 0.5) / w) * TAU - Math.PI;
    TO.fill(0);
    t.fn(cl * Math.cos(lon), sl, cl * Math.sin(lon), lat, lon, TO);
    const p = (y * w + x) * ch;
    for (let c = 0; c < oc; c++) { const v = TO[c]; d[p + c] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0; }
    if (hg) hg[y * w + x] = TO[3];
  }
}
function finalizeBump(t) {
  const w = t.w, h = t.h, H = t.hgt, d = t.data, dth = TAU / w;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI, cl = Math.max(0.08, Math.cos(lat));
    const yn = Math.max(0, y - 1), ys = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xe = x + 1 === w ? 0 : x + 1, xw = x === 0 ? w - 1 : x - 1;
      const gx = (H[y * w + xe] - H[y * w + xw]) / (2 * dth * cl);
      const gy = (H[yn * w + x] - H[ys * w + x]) / ((ys - yn) * dth);
      const p = (y * w + x) * 5;
      d[p + 3] = clamp(Math.round(128 + gx * GRAD_S), 0, 255);
      d[p + 4] = clamp(Math.round(128 + gy * GRAD_S), 0, 255);
    }
  }
  t.hgt = null;
}
function buildMips(t) {
  const lv = [{ w: t.w, h: t.h, data: t.data }];
  let w = t.w, h = t.h, src = t.data;
  const ch = t.ch;
  while (w > 16 && h > 8) {
    const nw = w >> 1, nh = h >> 1, dst = new Uint8Array(nw * nh * ch);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const a = ((2 * y) * w + 2 * x) * ch, b = a + ch, c = a + w * ch, d = c + ch, o = (y * nw + x) * ch;
      for (let k = 0; k < ch; k++) dst[o + k] = (src[a + k] + src[b + k] + src[c + k] + src[d + k] + 2) >> 2;
    }
    lv.push({ w: nw, h: nh, data: dst });
    w = nw; h = nh; src = dst;
  }
  t.levels = lv;
}
function pumpTextures(budget) {
  const t0 = performance.now();
  while (texQueue.length) {
    const t = texQueue[0];
    texRow(t, t.row++); texDone += t.w;
    if (t.row >= t.h) { if (t.hgt) finalizeBump(t); buildMips(t); texQueue.shift(); }
    if (performance.now() - t0 > budget) break;
  }
}

// ---------- кольца: радиальный профиль прозрачности и цвета (в радиусах планеты)
function buildRing(kind) {
  const N = 1024, sat = kind === 'saturn';
  const r0 = sat ? 1.11 : 1.6, r1 = sat ? 2.36 : 2.03;
  const a = new Float32Array(N), c = new Float32Array(N * 3);
  const U_RINGS = [[1.637, 0.004], [1.652, 0.004], [1.666, 0.004], [1.75, 0.004], [1.786, 0.005], [1.834, 0.006], [1.862, 0.005], [1.886, 0.006], [2.001, 0.014]];
  for (let k = 0; k < N; k++) {
    const r = r0 + (r1 - r0) * (k + 0.5) / N;
    let al = 0, col;
    if (sat) {
      const fine = 1 + 0.35 * noise3(r * 60, 1.7, 3.1) + 0.25 * noise3(r * 260, 5.3, 0.7) + 0.15 * noise3(r * 900, 2.2, 8.8);
      if (r < 1.236) { al = 0.035; col = [0.55, 0.5, 0.45]; }                                            // D
      else if (r < 1.525) { al = (0.1 + 0.1 * sstep(1.24, 1.52, r)) * fine; col = [0.6, 0.53, 0.46]; }      // C
      else if (r < 1.95) { al = (0.74 + 0.2 * sstep(1.53, 1.72, r) - 0.1 * sstep(1.85, 1.95, r)) * fine; col = [0.93, 0.83, 0.65]; } // B
      else if (r < 2.025) { al = 0.05 + 0.05 * sstep(1.99, 2.02, r); col = [0.5, 0.46, 0.42]; }             // щель Кассини
      else if (r < 2.27) {                                                                                   // A
        al = (0.54 - 0.12 * sstep(2.1, 2.27, r)) * fine; col = [0.85, 0.77, 0.63];
        if (Math.abs(r - 2.214) < 0.0045) al *= 0.08; // щель Энке
        if (Math.abs(r - 2.263) < 0.002) al *= 0.3;   // щель Килера
      }
      else if (r > 2.318 && r < 2.332) { al = 0.35; col = [0.86, 0.8, 0.72]; }                              // F
      else col = [0.8, 0.75, 0.7];
      const cv = 1 + 0.06 * noise3(r * 40, 9.1, 2.2);
      col = [col[0] * cv, col[1] * cv, col[2] * cv * 0.98];
    } else {
      for (const [rc, wd] of U_RINGS) { const d = Math.abs(r - rc) / wd; if (d < 1) al = Math.max(al, (rc > 2 ? 0.42 : 0.22) * (1 - d * d)); }
      col = [0.62, 0.64, 0.68];
    }
    a[k] = clamp(al, 0, 0.97);
    c[k * 3] = srgb2lin(clamp(col[0], 0, 1)); c[k * 3 + 1] = srgb2lin(clamp(col[1], 0, 1)); c[k * 3 + 2] = srgb2lin(clamp(col[2], 0, 1));
  }
  const blur = rad => {
    const na = new Float32Array(N), nc = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      let sa = 0, s0 = 0, s1 = 0, s2 = 0, n = 0;
      for (let q = Math.max(0, k - rad); q <= Math.min(N - 1, k + rad); q++) { sa += a[q]; s0 += c[q * 3]; s1 += c[q * 3 + 1]; s2 += c[q * 3 + 2]; n++; }
      na[k] = sa / n; nc[k * 3] = s0 / n; nc[k * 3 + 1] = s1 / n; nc[k * 3 + 2] = s2 / n;
    }
    return { a: na, c: nc };
  };
  const lvR = [0, 2, 4, 8, 16, 32]; // уровни предфильтрации профиля под размер пикселя
  return { r0, r1, N, lvR, lv: lvR.map(rd => (rd ? blur(rd) : { a, c })) };
}

// ============================================================ Canvas и спрайты
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d', { alpha: false });
let W = 1, H = 1, dpr = 1;
const sky = document.createElement('canvas'), skx = sky.getContext('2d');

function radialSprite(size, stops) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return c;
}
function makeCorona() {
  const S = 400, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), img = x.createImageData(S, S), d = img.data, RM = 4.2, h = S / 2;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = (i + 0.5 - h) / h * RM, dy = (j + 0.5 - h) / h * RM, r = Math.sqrt(dx * dx + dy * dy);
    if (r < 0.97 || r > RM) continue;
    const ca = dx / r, sa = dy / r;
    const st = 0.3 + 0.7 * Math.pow(clamp(0.5 + 0.9 * noise3(ca * 1.9 + 3, sa * 1.9, 0.4), 0, 1), 2.5);
    const fine = 0.7 + 0.3 * (0.5 + 0.5 * noise3(ca * 16, sa * 16, r * 0.35));
    let I = st * fine * Math.exp(-(r - 1) * 1.25) * 0.8 + 0.55 * Math.exp(-(r - 1) * 5.5);
    I *= sstep(0.97, 1.03, r) * (1 - sstep(RM * 0.72, RM, r));
    const p = (j * S + i) * 4;
    d[p] = 255; d[p + 1] = 226; d[p + 2] = 186; d[p + 3] = clamp(I * 255, 0, 255);
  }
  x.putImageData(img, 0, 0);
  return c;
}
const SPR = {};
function buildSprites() {
  SPR.glow = radialSprite(256, [[0, 'rgba(255,248,232,1)'], [0.1, 'rgba(255,230,175,0.9)'], [0.17, 'rgba(255,196,120,0.5)'], [0.3, 'rgba(255,150,70,0.2)'], [0.55, 'rgba(255,110,40,0.06)'], [1, 'rgba(255,90,30,0)']]);
  SPR.haze = radialSprite(256, [[0, 'rgba(255,190,120,0.5)'], [0.12, 'rgba(255,160,90,0.2)'], [0.4, 'rgba(200,110,70,0.05)'], [1, 'rgba(120,60,40,0)']]);
  SPR.mwWarm = radialSprite(64, [[0, 'rgba(246,222,196,1)'], [0.5, 'rgba(240,212,186,0.35)'], [1, 'rgba(235,205,180,0)']]);
  SPR.mwCool = radialSprite(64, [[0, 'rgba(172,192,255,1)'], [0.5, 'rgba(160,180,255,0.35)'], [1, 'rgba(150,170,255,0)']]);
  SPR.mwNeutral = radialSprite(64, [[0, 'rgba(226,226,240,1)'], [0.5, 'rgba(220,220,240,0.35)'], [1, 'rgba(220,220,240,0)']]);
  SPR.mwRose = radialSprite(64, [[0, 'rgba(255,150,170,1)'], [0.5, 'rgba(240,130,160,0.3)'], [1, 'rgba(220,120,150,0)']]);
  SPR.dust = radialSprite(64, [[0, 'rgba(0,0,0,1)'], [0.55, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']]);
  SPR.star = radialSprite(32, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.55)'], [0.45, 'rgba(255,255,255,0.1)'], [1, 'rgba(255,255,255,0)']]);
  SPR.streak = radialSprite(128, [[0, 'rgba(180,205,255,0.9)'], [0.25, 'rgba(120,160,255,0.28)'], [1, 'rgba(80,120,255,0)']]);
  SPR.ion = radialSprite(64, [[0, 'rgba(150,196,255,0.95)'], [0.45, 'rgba(110,160,255,0.32)'], [1, 'rgba(90,140,255,0)']]);
  SPR.dustTail = radialSprite(64, [[0, 'rgba(255,238,205,0.95)'], [0.45, 'rgba(255,225,180,0.3)'], [1, 'rgba(255,215,170,0)']]);
  SPR.coma = radialSprite(128, [[0, 'rgba(240,252,255,1)'], [0.1, 'rgba(200,238,255,0.75)'], [0.35, 'rgba(120,200,235,0.2)'], [1, 'rgba(80,160,200,0)']]);
  SPR.corona = makeCorona();
  const ghost = (r, g, b, ring) => radialSprite(128, ring
    ? [[0, `rgba(${r},${g},${b},0.05)`], [0.72, `rgba(${r},${g},${b},0.12)`], [0.88, `rgba(${r},${g},${b},0.55)`], [0.95, `rgba(${r},${g},${b},0.15)`], [1, `rgba(${r},${g},${b},0)`]]
    : [[0, `rgba(${r},${g},${b},0.9)`], [0.6, `rgba(${r},${g},${b},0.5)`], [0.9, `rgba(${r},${g},${b},0.2)`], [1, `rgba(${r},${g},${b},0)`]]);
  SPR.ghosts = [
    { k: 0.32, r: 0.028, a: 0.11, s: ghost(255, 200, 140, false) },
    { k: 0.58, r: 0.055, a: 0.06, s: ghost(140, 255, 190, false) },
    { k: 0.86, r: 0.018, a: 0.14, s: ghost(150, 190, 255, false) },
    { k: 1.18, r: 0.1, a: 0.07, s: ghost(190, 150, 255, true) },
    { k: 1.52, r: 0.042, a: 0.08, s: ghost(255, 170, 110, false) },
    { k: 1.95, r: 0.15, a: 0.05, s: ghost(120, 170, 255, true) },
  ];
}

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  sky.width = Math.max(1, Math.ceil(W / 4)); sky.height = Math.max(1, Math.ceil(H / 4));
}

// ============================================================ системы координат
// Мир: X = x эклиптики, Y = z эклиптики (север), Z = −y эклиптики (правая тройка).
const OBL = 23.4392911 * DEG;
function raDecToWorld(ra, dec) {
  ra *= DEG; dec *= DEG;
  const x = Math.cos(dec) * Math.cos(ra), y = Math.cos(dec) * Math.sin(ra), z = Math.sin(dec);
  const ey = y * Math.cos(OBL) + z * Math.sin(OBL), ez = -y * Math.sin(OBL) + z * Math.cos(OBL);
  return vnorm([x, ez, -ey]);
}
const GZ = raDecToWorld(192.859, 27.128); // северный полюс Галактики
const GX = (() => { const g = raDecToWorld(266.405, -28.936); return vnorm(vsub(g, vmul(GZ, vdot(g, GZ)))); })(); // центр Галактики
const GY = vcross(GZ, GX);
function galDir(l, b) {
  const cb = Math.cos(b), cl = Math.cos(l) * cb, sl = Math.sin(l) * cb, sb = Math.sin(b);
  return [GX[0] * cl + GY[0] * sl + GZ[0] * sb, GX[1] * cl + GY[1] * sl + GZ[1] * sb, GX[2] * cl + GY[2] * sl + GZ[2] * sb];
}

// ---------- сжатие расстояний: r' = K·r^p, направления сохраняются
let P_EXP = 0.5, KS = 1, BODY_K = 1, SUN_R = 4.8;
const REF_MERC = 100 * Math.pow(0.387 / 30.07, 0.55);
function setDistanceExp(p) {
  P_EXP = p;
  KS = 100 / Math.pow(30.07, p);
  BODY_K = clamp(Math.pow(KS * Math.pow(0.387, p) / REF_MERC, 0.7), 0.15, 1.5);
  SUN_R = 0.6 * KS * Math.pow(0.3075, p);
}
function toDisp(x, y, z, out) {
  const r = Math.sqrt(x * x + y * y + z * z), k = r > 1e-12 ? KS * Math.pow(r, P_EXP - 1) : 0;
  out[0] = x * k; out[1] = z * k; out[2] = -y * k;
  return out;
}

// ============================================================ эфемериды
const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
const GAUSS_K = 0.01720209895; // рад/сут при a в а.е.
function orbitBasis(iDeg, OmDeg, omDeg) {
  const i = iDeg * DEG, O = OmDeg * DEG, w = omDeg * DEG;
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  return {
    Px: cw * cO - sw * sO * ci, Py: cw * sO + sw * cO * ci, Pz: sw * si,
    Qx: -sw * cO - cw * sO * ci, Qy: -sw * sO + cw * cO * ci, Qz: cw * si,
  };
}
function kepler(M, e) {
  M %= TAU; if (M > Math.PI) M -= TAU; else if (M < -Math.PI) M += TAU;
  let E = M + 0.85 * e * (Math.sin(M) >= 0 ? 1 : -1);
  for (let k = 0; k < 12; k++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-10) break; }
  return E;
}
function elemPos(el, M, out) { // гелиоцентрические эклиптические координаты, а.е.
  const E = kepler(M, el.e), x = el.a * (Math.cos(E) - el.e), y = el.b * Math.sin(E);
  out[0] = x * el.Px + y * el.Qx; out[1] = x * el.Py + y * el.Qy; out[2] = x * el.Pz + y * el.Qz;
  return out;
}

// ---------- параметры шейдинга
const SH = {
  sun: { emit: 2.4 },
  rock: { wrap: 0, limb: 0, amb: 0.004 },
  venus: { wrap: 0.1, limb: 0.3, amb: 0.004, atm: { c: [1.0, 0.78, 0.42], rim: 0.9, halo: 0.55, ext: 1.075, tw: 0.22 } },
  earth: { wrap: 0.03, limb: 0, amb: 0.003, earth: true, atm: { c: [0.22, 0.48, 1.0], rim: 1.25, halo: 0.85, ext: 1.075, tw: 0.06 } },
  mars: { wrap: 0.02, limb: 0.05, amb: 0.004, atm: { c: [0.95, 0.55, 0.32], rim: 0.35, halo: 0.22, ext: 1.04, tw: 0.08 } },
  jupiter: { wrap: 0.1, limb: 0.42, amb: 0.0012, soft: true, atm: { c: [0.9, 0.78, 0.6], rim: 0.25, halo: 0.16, ext: 1.03, tw: 0 } },
  saturn: { wrap: 0.12, limb: 0.4, amb: 0.004, atm: { c: [0.9, 0.82, 0.58], rim: 0.22, halo: 0.14, ext: 1.03, tw: 0 } },
  uranus: { wrap: 0.08, limb: 0.35, amb: 0.002, soft: true, atm: { c: [0.45, 0.85, 0.95], rim: 0.5, halo: 0.32, ext: 1.045, tw: 0 } },
  neptune: { wrap: 0.08, limb: 0.35, amb: 0.002, soft: true, atm: { c: [0.28, 0.5, 1.0], rim: 0.6, halo: 0.38, ext: 1.045, tw: 0 } },
  titan: { wrap: 0.12, limb: 0.25, amb: 0.004, atm: { c: [1.0, 0.58, 0.22], rim: 1.0, halo: 0.75, ext: 1.12, tw: 0.2 } },
};

const PLANET_DEFS = [
  { id: 'mercury', name: 'Меркурий', a: 0.38709927, e: 0.20563593, i: 7.00497902, L: 252.2503235, Ld: 149472.67411175, wb: 77.45779628, O: 48.33076593,
    rKm: 2440, rot: 58.6462, ra: 281.01, dec: 61.45, flat: '#9c9189', trail: '200,190,180', tex: [512, 256, texMercury], shade: 'rock', prio: 7, bump: 0.55,
    type: 'планета земной группы', info: [['Период', '88,0 сут'], ['Сутки', '58,6 сут'], ['Наклон оси', '0,03°'], ['Радиус', '2 440 км']] },
  { id: 'venus', name: 'Венера', a: 0.72333566, e: 0.00677672, i: 3.39467605, L: 181.9790995, Ld: 58517.81538729, wb: 131.60246718, O: 76.67984255,
    rKm: 6052, rot: -243.025, ra: 272.76, dec: 67.16, flat: '#e0c995', trail: '240,212,150', tex: [512, 256, texVenus], shade: 'venus', prio: 6,
    type: 'планета земной группы', info: [['Период', '224,7 сут'], ['Сутки', '243 сут, обратное'], ['Наклон оси', '177,4°'], ['Радиус', '6 052 км']] },
  { id: 'earth', name: 'Земля', a: 1.00000261, e: 0.01671123, i: -0.00001531, L: 100.46457166, Ld: 35999.37244981, wb: 102.93768193, O: 0,
    rKm: 6371, rot: 0.99727, ra: 0, dec: 90, flat: '#4d78a8', trail: '120,180,255', tex: [1024, 512, texEarth], shade: 'earth', prio: 1,
    type: 'планета земной группы', info: [['Период', '365,26 сут'], ['Сутки', '23 ч 56 мин'], ['Наклон оси', '23,44°'], ['Радиус', '6 371 км']] },
  { id: 'mars', name: 'Марс', a: 1.52371034, e: 0.0933941, i: 1.84969142, L: -4.55343205, Ld: 19140.30268499, wb: -23.94362959, O: 49.55953891,
    rKm: 3390, rot: 1.02596, ra: 317.68, dec: 52.89, flat: '#b5603b', trail: '255,140,95', tex: [512, 256, texMars], shade: 'mars', prio: 4, bump: 0.32,
    type: 'планета земной группы', info: [['Период', '687,0 сут'], ['Сутки', '24 ч 37 мин'], ['Наклон оси', '25,19°'], ['Радиус', '3 390 км']] },
  { id: 'jupiter', name: 'Юпитер', a: 5.202887, e: 0.04838624, i: 1.30439695, L: 34.39644051, Ld: 3034.74612775, wb: 14.72847983, O: 100.47390909,
    rKm: 69911, rot: 0.41354, ra: 268.057, dec: 64.495, flat: '#cdb08c', trail: '232,192,148', tex: [1024, 512, texJupiter], shade: 'jupiter', prio: 3,
    type: 'газовый гигант', info: [['Период', '11,86 года'], ['Сутки', '9 ч 56 мин'], ['Наклон оси', '3,13°'], ['Радиус', '69 911 км']] },
  { id: 'saturn', name: 'Сатурн', a: 9.53667594, e: 0.05386179, i: 2.48599187, L: 49.95424423, Ld: 1222.49362201, wb: 92.59887831, O: 113.66242448,
    rKm: 58232, rot: 0.44401, ra: 40.589, dec: 83.537, flat: '#dcc796', trail: '242,218,165', tex: [512, 256, texSaturn], shade: 'saturn', prio: 2, ring: 'saturn',
    type: 'газовый гигант', info: [['Период', '29,46 года'], ['Сутки', '10 ч 33 мин'], ['Наклон оси', '26,73°'], ['Радиус', '58 232 км']] },
  { id: 'uranus', name: 'Уран', a: 19.18916464, e: 0.04725744, i: 0.77263783, L: 313.23810451, Ld: 428.48202785, wb: 170.9542763, O: 74.01692503,
    rKm: 25362, rot: -0.71833, ra: 257.311, dec: -15.175, flat: '#a5d8de', trail: '160,230,238', tex: [256, 128, texUranus], shade: 'uranus', prio: 8, ring: 'uranus',
    type: 'ледяной гигант', info: [['Период', '84,0 года'], ['Сутки', '17 ч 14 мин, обратное'], ['Наклон оси', '97,77°'], ['Радиус', '25 362 км']] },
  { id: 'neptune', name: 'Нептун', a: 30.06992276, e: 0.00859048, i: 1.77004347, L: -55.12002969, Ld: 218.45945325, wb: 44.96476227, O: 131.78422574,
    rKm: 24622, rot: 0.67125, ra: 299.36, dec: 43.46, flat: '#3d64d0', trail: '115,150,255', tex: [512, 256, texNeptune], shade: 'neptune', prio: 8,
    type: 'ледяной гигант', info: [['Период', '164,8 года'], ['Сутки', '16 ч 07 мин'], ['Наклон оси', '28,32°'], ['Радиус', '24 622 км']] },
];
// k — радиус орбиты в радиусах планеты (сжат, порядок и резонанс периодов сохранены)
const MOON_DEFS = [
  { id: 'moon', name: 'Луна', parent: 'earth', rKm: 1737, P: 27.3217, k: 3.5, plane: 'ecl', inc: 5.145, flat: '#9f9a92', tex: [512, 256, texMoon], prio: 5, bump: 0.55, aKm: '384 400 км' },
  { id: 'io', name: 'Ио', parent: 'jupiter', rKm: 1822, P: 1.769, k: 2.05, plane: 'eq', inc: 0.05, flat: '#dcc668', tex: [256, 128, texIo], prio: 9, aKm: '421 700 км' },
  { id: 'europa', name: 'Европа', parent: 'jupiter', rKm: 1561, P: 3.551, k: 2.6, plane: 'eq', inc: 0.47, flat: '#d2c4ae', tex: [256, 128, texEuropa], prio: 9, bump: 0.3, aKm: '671 000 км' },
  { id: 'ganymede', name: 'Ганимед', parent: 'jupiter', rKm: 2634, P: 7.155, k: 3.35, plane: 'eq', inc: 0.2, flat: '#8d857a', tex: [256, 128, texGanymede], prio: 9, bump: 0.4, aKm: '1 070 400 км' },
  { id: 'callisto', name: 'Каллисто', parent: 'jupiter', rKm: 2410, P: 16.689, k: 4.4, plane: 'eq', inc: 0.28, flat: '#5a5047', tex: [256, 128, texCallisto], prio: 9, bump: 0.45, aKm: '1 882 700 км' },
  { id: 'titan', name: 'Титан', parent: 'saturn', rKm: 2575, P: 15.945, k: 3.75, plane: 'eq', inc: 0.35, flat: '#d4953f', tex: [256, 128, texTitan], prio: 9, shade: 'titan', aKm: '1 221 870 км' },
  { id: 'triton', name: 'Тритон', parent: 'neptune', rKm: 1353, P: 5.877, k: 3.1, plane: 'eq', inc: 157, flat: '#d6c3b6', tex: [256, 128, texTriton], prio: 9, aKm: '354 760 км', retro: true },
];

function setAxes(b, pole) {
  b.pole = vnorm(pole);
  let A = vcross([0, 1, 0], b.pole);
  if (vlen(A) < 1e-6) A = [1, 0, 0];
  b.axA = vnorm(A);
  b.axB = vcross(b.pole, b.axA);
}
function makeBody(def) {
  const b = Object.assign({
    pos: [0, 0, 0], R: 1, rAU: 1, M: 0, spinFrac: 0, eclipse: 1, lc: [1, 1, 1], umbra: [0.02, 0.02, 0.025],
    sx: 0, sy: 0, sr: 0, cz: 0, vis: false, phase: 1,
    cv: null, cx: null, img: null, u32: null, buf: 0, moons: [], ring: null, cloudFrac: 0,
    pole: [0, 1, 0], axA: [1, 0, 0], axB: [0, 0, -1],
  }, def);
  b.flatRGB = hex(def.flat);
  b.shade = SH[def.shade || 'rock'];
  b.bumpK = def.bump || 0;
  const ch = b.shade.earth ? 6 : b.bumpK ? 5 : 3;
  const flat = ch === 6 ? [b.flatRGB[0], b.flatRGB[1], b.flatRGB[2], 1, 0, 0.3] : b.flatRGB;
  b.tex = makeTexture(def.tex[0], def.tex[1], ch, def.tex[2], flat, def.prio, !!b.bumpK);
  if (def.ra != null) setAxes(b, raDecToWorld(def.ra, def.dec));
  b.label = def.name.toUpperCase();
  return b;
}

const sun = makeBody({ id: 'sun', name: 'Солнце', kind: 'sun', rKm: 696000, rot: 25.38, ra: 286.13, dec: 63.87, flat: '#ffd9a0', tex: [1024, 512, texSun], shade: 'sun', prio: 0,
  type: 'звезда класса G2V', info: [['Радиус', '696 000 км'], ['Вращение', '25,4 сут (экватор)'], ['Поверхность', '5 772 K'], ['Масса', '333 000 M⊕']] });
const planets = PLANET_DEFS.map(d => {
  const b = makeBody(Object.assign({ kind: 'planet' }, d));
  b.el = Object.assign(orbitBasis(d.i, d.O, d.wb - d.O), { a: d.a, e: d.e, b: d.a * Math.sqrt(1 - d.e * d.e) });
  if (d.ring) b.ring = buildRing(d.ring);
  b.periodD = 365.25 * Math.pow(d.a, 1.5);
  return b;
});
const byId = {};
for (const p of planets) byId[p.id] = p;
const earth = byId.earth;

const moonRng = mulberry32(2026);
const moons = MOON_DEFS.map(d => {
  const par = byId[d.parent];
  const m = makeBody(Object.assign({ kind: 'moon', type: `спутник: ${par.name}` }, d));
  m.parent = par; par.moons.push(m);
  let n;
  if (d.plane === 'ecl') n = [0, Math.cos(d.inc * DEG), Math.sin(d.inc * DEG)];
  else n = rotAxis(par.pole, par.axA, d.inc * DEG);
  n = vnorm(n);
  let e1 = vcross(n, [0, 0, 1]); if (vlen(e1) < 1e-4) e1 = vcross(n, [1, 0, 0]);
  e1 = vnorm(e1);
  m.e1 = e1; m.e2 = vcross(n, e1);
  m.pole = n; m.axA = e1; m.axB = m.e2; // приливный захват: ось = нормаль орбиты
  m.th0 = moonRng() * TAU;
  if (d.id === 'moon') m.umbra = [0.16, 0.045, 0.02]; // «кровавая» Луна в тени Земли
  m.info = [['Период', `${String(d.P).replace('.', ',')} сут${d.retro ? ', обратное' : ''}`], ['Орбита', d.aKm], ['Радиус', `${d.rKm.toLocaleString('ru-RU')} км`]];
  return m;
});

// ---------- комета 2P/Энке (перигелий 22.10.2023, следующий — в начале 2027)
const comet = {
  id: 'comet', name: 'Комета Энке', kind: 'comet', label: 'КОМЕТА ЭНКЕ', flat: '#bfe6ff', flatRGB: hex('#bfe6ff'), type: 'короткопериодическая комета',
  el: Object.assign(orbitBasis(11.78, 334.57, 186.55), { a: 2.2154, e: 0.8483, b: 2.2154 * Math.sqrt(1 - 0.8483 * 0.8483) }),
  n: GAUSS_K / Math.pow(2.2154, 1.5), Tp: (Date.UTC(2023, 9, 22) - J2000) / 864e5,
  pos: [0, 0, 0], prev: [0, 0, 0], vdir: [1, 0, 0], rAU: 3, act: 0, R: 0.3,
  sx: 0, sy: 0, sr: 0, cz: 0, vis: false,
  info: [['Период', '3,30 года'], ['Перигелий', '0,336 а.е.'], ['Наклон орбиты', '11,8°'], ['Ядро', '≈4,8 км']],
  fil: [],
};
{
  const r = mulberry32(99);
  for (let i = 0; i < 70; i++) comet.fil.push({ t: 0.05 + 0.95 * r(), o: gauss(r), s: 0.5 + r() * 1.5, p: r() * TAU, len: 0.7 + r() * 0.4 });
}

// приоритет генерации текстур: сначала то, что видно крупно
texQueue.sort((a, b) => a.prio - b.prio);

// ---------- орбиты (точки в а.е. и в отображаемых координатах)
const ORBIT_N = 256;
function makeOrbitArrays(o, el) {
  o.orbitAU = new Float64Array(ORBIT_N * 3); o.orbitD = new Float32Array(ORBIT_N * 3);
  for (let k = 0; k < ORBIT_N; k++) {
    const E = (k / ORBIT_N) * TAU, x = el.a * (Math.cos(E) - el.e), y = el.b * Math.sin(E);
    o.orbitAU[k * 3] = x * el.Px + y * el.Qx; o.orbitAU[k * 3 + 1] = x * el.Py + y * el.Qy; o.orbitAU[k * 3 + 2] = x * el.Pz + y * el.Qz;
  }
}
for (const p of planets) makeOrbitArrays(p, p.el);
makeOrbitArrays(comet, comet.el);

function applyScale() {
  sun.R = SUN_R;
  const t = [0, 0, 0];
  for (const p of planets) p.R = BODY_K * 0.6 * Math.pow(p.rKm / 6371, 0.6);
  for (const m of moons) { m.R = BODY_K * 0.6 * Math.pow(m.rKm / 6371, 0.6); m.dist = m.k * m.parent.R; }
  for (const o of [...planets, comet]) {
    for (let k = 0; k < ORBIT_N; k++) {
      toDisp(o.orbitAU[k * 3], o.orbitAU[k * 3 + 1], o.orbitAU[k * 3 + 2], t);
      o.orbitD[k * 3] = t[0]; o.orbitD[k * 3 + 1] = t[1]; o.orbitD[k * 3 + 2] = t[2];
    }
  }
}

// ---------- пояса: главный пояс (с люками Кирквуда), троянцы Юпитера, пояс Койпера
function makeBelt(n, seed, gen) {
  const r = mulberry32(seed);
  const B = { n, a: new Float32Array(n), e: new Float32Array(n), b: new Float32Array(n), nm: new Float64Array(n), M0: new Float64Array(n), pq: new Float32Array(n * 6) };
  for (let i = 0; i < n; i++) {
    const g = gen(r);
    const bs = orbitBasis(g.i, g.O, g.w);
    B.a[i] = g.a; B.e[i] = g.e; B.b[i] = g.a * Math.sqrt(1 - g.e * g.e);
    B.nm[i] = g.nm != null ? g.nm : GAUSS_K / Math.pow(g.a, 1.5);
    B.M0[i] = g.M0;
    B.pq.set([bs.Px, bs.Py, bs.Pz, bs.Qx, bs.Qy, bs.Qz], i * 6);
  }
  return B;
}
const KIRKWOOD = [[2.502, 0.035], [2.825, 0.022], [2.958, 0.018], [3.279, 0.03]];
const beltMain = makeBelt(2600, 11, r => {
  let a;
  for (;;) {
    a = 2.12 + Math.pow(r(), 0.9) * 1.2;
    let bad = false;
    for (const [c, w] of KIRKWOOD) if (Math.abs(a - c) < w && r() < 0.92) bad = true;
    if (!bad) break;
  }
  return { a, e: Math.min(0.3, Math.abs(gauss(r)) * 0.08), i: Math.abs(gauss(r)) * 7, O: r() * 360, w: r() * 360, M0: r() * TAU };
});
const JUP_N = TAU / (36525 * 360 / 3034.74612775);
const beltTrojans = makeBelt(560, 12, r => {
  const side = r() < 0.5 ? 60 : -60;
  const w = r() * 360, O = r() * 360;
  const L0 = 34.39644051 + side + gauss(r) * 9;
  return { a: 5.2029 + gauss(r) * 0.04, e: Math.abs(gauss(r)) * 0.05, i: Math.abs(gauss(r)) * 11, O, w: w - O, M0: (L0 - w) * DEG, nm: JUP_N };
});
const beltKuiper = makeBelt(1100, 13, r => {
  const k = r();
  if (k < 0.3) return { a: 39.4 + gauss(r) * 0.15, e: 0.1 + r() * 0.2, i: Math.abs(gauss(r)) * 12, O: r() * 360, w: r() * 360, M0: r() * TAU };
  return { a: 42 + r() * 5.5, e: Math.abs(gauss(r)) * 0.05, i: Math.abs(gauss(r)) * (k < 0.7 ? 3 : 14), O: r() * 360, w: r() * 360, M0: r() * TAU };
});

// ---------- звёздное небо и Млечный Путь
const STAR_N = 5200;
const starDir = new Float32Array(STAR_N * 3);
let starBuckets = [], brightStars = [];
const MW = [], DUST = [];
function buildSky() {
  const r = mulberry32(4242);
  const colors = ['170,196,255', '214,226,255', '255,250,242', '255,236,206', '255,210,166', '255,184,150'];
  const cw = [0.1, 0.22, 0.3, 0.2, 0.12, 0.06];
  const lists = [];
  for (let k = 0; k < 24; k++) lists.push([]);
  for (let i = 0; i < STAR_N; i++) {
    let d;
    if (r() < 0.38) d = galDir(r() * TAU, gauss(r) * 0.11);
    else { const u = r() * 2 - 1, th = r() * TAU, q = Math.sqrt(1 - u * u); d = [q * Math.cos(th), u, q * Math.sin(th)]; }
    starDir[i * 3] = d[0]; starDir[i * 3 + 1] = d[1]; starDir[i * 3 + 2] = d[2];
    const m = Math.pow(r(), 3.2);
    let cr = r(), ci = 0;
    while (ci < 5 && cr > cw[ci]) { cr -= cw[ci]; ci++; }
    const bi = m < 0.08 ? 0 : m < 0.25 ? 1 : m < 0.55 ? 2 : 3;
    lists[ci * 4 + bi].push(i);
    if (m > 0.8) brightStars.push({ i, col: colors[ci], m });
  }
  const alphas = [0.3, 0.52, 0.78, 1], sizes = [0.8, 1.0, 1.25, 1.6];
  starBuckets = lists.map((l, k) => ({ idx: Int32Array.from(l), style: `rgba(${colors[k >> 2]},${alphas[k & 3]})`, size: sizes[k & 3] }));
  const rs = mulberry32(777);
  for (let k = 0; k < 760; k++) {
    let l = (rs() * 2 - 1) * Math.PI;
    if (rs() < 0.45) l = gauss(rs) * 0.7;
    const core = Math.exp(-(l * l) / 0.5);
    const b = gauss(rs) * (0.05 + 0.09 * core);
    const size = (0.03 + 0.085 * rs()) * (1 + core * 0.5);
    const a = (0.012 + 0.022 * rs()) * (0.5 + 0.9 * core);
    const q = rs();
    const spr = core > 0.5 ? (q < 0.6 ? SPR.mwWarm : q < 0.9 ? SPR.mwNeutral : SPR.mwRose) : (q < 0.55 ? SPR.mwCool : q < 0.95 ? SPR.mwNeutral : SPR.mwRose);
    MW.push({ d: galDir(l, b), size, a, spr });
  }
  for (let k = 0; k < 260; k++) { // пылевые прожилки Великого Разлома
    const l = gauss(rs) * 0.95 + 0.25, b = 0.012 + gauss(rs) * 0.022;
    DUST.push({ d: galDir(l, b), size: 0.014 + 0.032 * rs(), a: 0.1 + 0.14 * rs() });
  }
}

// ============================================================ камера
const cam = { yaw: 2.35, pitch: 0.34, dist: 900, distT: 210, fov: 40 * DEG, target: [0, 0, 0], pos: [0, 0, 0] };
let CP0 = 0, CP1 = 0, CP2 = 0, CR0 = 1, CR1 = 0, CR2 = 0, CU0 = 0, CU1 = 1, CU2 = 0, CF0 = 0, CF1 = 0, CF2 = -1, FOC = 1, HW = 0.5, HH = 0.5;
let camR = [1, 0, 0], camU = [0, 1, 0], camF = [0, 0, -1];
const NEAR = 0.05, MAX_D = 900;
const solids = [sun, ...planets, ...moons];
let focus = sun, focusFrom = [0, 0, 0], focusT = 1, intro = true, focusDistFrom = 210, focusBump = 0;
let heroAnim = false, yawFrom = 0, yawTo = 0, pitchFrom = 0, pitchTo = 0, heroPrev = 0;
let relYaw = 0, refPrev = null, orbitDir = 1;
const FOCUS_DUR = 2.2;
const wrapPi = a => a - TAU * Math.round(a / TAU);

// «Геройский» ракурс при фокусе: планета дневной стороной (фаза ~3/4), Солнце за камерой,
// кольца раскрыты и освещены, хвост кометы — сбоку. Угол считается ОТНОСИТЕЛЬНО Солнца
// и пересчитывается каждый кадр, поэтому держится и при ускоренном времени.
function heroAngles(b) {
  if (b.kind === 'sun') return [cam.yaw, 0.34];
  const p = b.pos, sunYaw = Math.atan2(-p[0], -p[2]);
  if (b.kind === 'comet') return [sunYaw + 0.95, 0.3];
  if (b.ring) {
    const P = b.pole, L = vnorm(vmul(p, -1)), s = vdot(L, P) >= 0 ? 1 : -1;
    let y = Math.atan2(P[0] * s, P[2] * s);
    let d = sunYaw - y; d -= TAU * Math.round(d / TAU);
    y += Math.sign(d) * Math.min(Math.abs(d), 0.6);
    return [y, (P[1] * s >= 0 ? 1 : -1) * 0.42];
  }
  return [sunYaw + 0.6, 0.28];
}

function focusMin(b) {
  if (b.kind === 'sun') return SUN_R * 2.3;
  if (b.kind === 'comet') return 1.5 * BODY_K;
  return b.R * (b.ring ? 3.0 : 1.9);
}
function focusDist(b) {
  if (b.kind === 'sun') return 210;
  if (b.kind === 'comet') return 26 * Math.max(0.4, BODY_K);
  if (b.kind === 'moon') return b.R * 9;
  let d = b.R * (b.ring ? 8.5 : 6.5);
  for (const m of b.moons) d = Math.max(d, m.dist * 2.3);
  return d;
}
function clampDist(d) { return clamp(d, focusMin(focus), MAX_D); }

function updateCamera(dt) {
  const ramp = sstep(2.5, 5.5, time - lastInteract);
  const moving = focusT < 1;
  focusT = Math.min(1, focusT + dt / FOCUS_DUR);
  const e = focusT < 0.5 ? 4 * focusT * focusT * focusT : 1 - Math.pow(-2 * focusT + 2, 3) / 2;
  if (focus.kind === 'sun') {
    if (autoRot && !dragging) cam.yaw += dt * 0.026 * ramp; // общий план: медленный облёт по кругу
    if (moving && heroAnim) cam.pitch = lerp(pitchFrom, pitchTo, e);
  } else if (moving) {
    if (heroAnim) { // цель ракурса едет вместе с направлением на Солнце
      const hy = heroAngles(focus)[0];
      yawTo += wrapPi(hy - heroPrev); heroPrev = hy;
      cam.yaw = lerp(yawFrom, yawTo, e); cam.pitch = lerp(pitchFrom, pitchTo, e);
    }
    refPrev = null;
  } else {
    // после перелёта камера «сопровождает» тело относительно Солнца: дневная сторона
    // остаётся в кадре при любой скорости времени; облёт — медленное покачивание в
    // освещённом секторе, а не полный круг (иначе через минуту смотрим в ночь и на Солнце)
    const ref = heroAngles(focus)[0];
    relYaw = wrapPi(cam.yaw - (refPrev === null ? ref : refPrev)); // учитывает перетаскивание мышью
    if (autoRot && !dragging) {
      const LIM = focus.kind === 'comet' ? 0.4 : focus.ring ? 0.5 : 0.6;
      if (relYaw > LIM) orbitDir = -1; else if (relYaw < -LIM) orbitDir = 1;
      relYaw += orbitDir * dt * 0.045 * ramp;
    }
    cam.yaw = ref + relYaw; refPrev = ref;
  }
  const fp = focus.pos;
  cam.target = [lerp(focusFrom[0], fp[0], e), lerp(focusFrom[1], fp[1], e), lerp(focusFrom[2], fp[2], e)];
  cam.distT = clampDist(cam.distT);
  if (moving) {
    // перелёт: дистанция идёт по той же кривой, что и цель, с отъездом на середине пути
    cam.dist = Math.exp(lerp(Math.log(focusDistFrom), Math.log(cam.distT), e) + focusBump * Math.sin(Math.PI * e));
  } else {
    const k = 1 - Math.exp(-dt * (intro ? 0.95 : 3.2));
    cam.dist = Math.exp(lerp(Math.log(cam.dist), Math.log(cam.distT), k));
  }
  if (intro && Math.abs(cam.dist / cam.distT - 1) < 0.01) intro = false;
  const pitch = clamp(cam.pitch + 0.03 * Math.sin(time * 0.07), -1.5, 1.5);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const off = [cp * Math.sin(cam.yaw), sp, cp * Math.cos(cam.yaw)];
  let pos = [cam.target[0] + off[0] * cam.dist, cam.target[1] + off[1] * cam.dist, cam.target[2] + off[2] * cam.dist];
  // камера не должна оказаться внутри Солнца или планеты
  for (const b of solids) {
    const d = vsub(pos, b.pos), l = vlen(d), lim = b.R * 1.2 + NEAR;
    if (l < lim) pos = l > 1e-9 ? [b.pos[0] + d[0] * lim / l, b.pos[1] + d[1] * lim / l, b.pos[2] + d[2] * lim / l] : [b.pos[0], b.pos[1] + lim, b.pos[2]];
  }
  cam.pos = pos;
  camF = vnorm(vsub(cam.target, pos));
  camR = vcross(camF, [0, 1, 0]);
  if (vlen(camR) < 1e-6) camR = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
  camR = vnorm(camR);
  camU = vcross(camR, camF);
  CP0 = cam.pos[0]; CP1 = cam.pos[1]; CP2 = cam.pos[2];
  CR0 = camR[0]; CR1 = camR[1]; CR2 = camR[2];
  CU0 = camU[0]; CU1 = camU[1]; CU2 = camU[2];
  CF0 = camF[0]; CF1 = camF[1]; CF2 = camF[2];
  FOC = 0.5 * Math.min(H, W / 1.2) / Math.tan(cam.fov / 2);
  HW = W / 2; HH = H * 0.46; // оптический центр чуть выше — под панелью управления
}

// ============================================================ время и мир
let simDay = (Date.now() - J2000) / 864e5, moonDay = simDay, spinDay = simDay;
let speed = 6, paused = false, cloudT = 0, time = 0;
const tmpA = [0, 0, 0], tmpB = [0, 0, 0];

function updateWorld() {
  const T = simDay / 36525;
  for (const p of planets) {
    p.M = (p.L + p.Ld * T - p.wb) * DEG;
    elemPos(p.el, p.M, tmpA);
    p.rAU = Math.sqrt(tmpA[0] * tmpA[0] + tmpA[1] * tmpA[1] + tmpA[2] * tmpA[2]);
    toDisp(tmpA[0], tmpA[1], tmpA[2], p.pos);
    p.spinFrac = spinDay / p.rot;
  }
  sun.spinFrac = spinDay / 25.38;
  for (const m of moons) {
    const th = m.th0 + TAU * moonDay / m.P, P = m.parent.pos, d = m.dist, c = Math.cos(th), s = Math.sin(th);
    m.th = th;
    m.pos[0] = P[0] + d * (c * m.e1[0] + s * m.e2[0]);
    m.pos[1] = P[1] + d * (c * m.e1[1] + s * m.e2[1]);
    m.pos[2] = P[2] + d * (c * m.e1[2] + s * m.e2[2]);
    m.spinFrac = th * INV_TAU;
    m.rAU = m.parent.rAU;
    const toSun = vnorm(vmul(m.pos, -1)), dd = vsub(m.parent.pos, m.pos), t = vdot(dd, toSun);
    let ecl = 1;
    if (t > 0) ecl = sstep(m.parent.R * 0.82, m.parent.R * 1.1, Math.sqrt(Math.max(0, vdot(dd, dd) - t * t)));
    m.eclipse = ecl;
    for (let q = 0; q < 3; q++) m.lc[q] = lerp(m.umbra[q], 1, ecl);
  }
  earth.cloudFrac = cloudT * 0.0035;
  // комета
  const Mc = comet.n * (simDay - comet.Tp);
  elemPos(comet.el, Mc, tmpA);
  comet.rAU = Math.sqrt(tmpA[0] * tmpA[0] + tmpA[1] * tmpA[1] + tmpA[2] * tmpA[2]);
  toDisp(tmpA[0], tmpA[1], tmpA[2], comet.pos);
  elemPos(comet.el, Mc - comet.n * 3, tmpB);
  toDisp(tmpB[0], tmpB[1], tmpB[2], comet.prev);
  comet.vdir = vnorm(vsub(comet.pos, comet.prev));
  comet.act = clamp(Math.pow(1.5 / comet.rAU, 1.6) - 0.3, 0, 5);
  comet.R = (0.35 + 0.9 * Math.sqrt(comet.act)) * BODY_K * 0.5;
}

// ============================================================ проекция
function projectBody(b) {
  const dx = b.pos[0] - CP0, dy = b.pos[1] - CP1, dz = b.pos[2] - CP2;
  const z = dx * CF0 + dy * CF1 + dz * CF2;
  if (z <= Math.max(NEAR, b.R * 1.05)) { b.vis = false; b.cz = z; return; }
  b.cz = z;
  b.sx = HW + (dx * CR0 + dy * CR1 + dz * CR2) * FOC / z;
  b.sy = HH - (dx * CU0 + dy * CU1 + dz * CU2) * FOC / z;
  b.sr = b.R * FOC / z;
  const ext = b.sr * (b.ring ? b.ring.r1 : 1.15) + 3;
  b.vis = b.sx > -ext && b.sx < W + ext && b.sy > -ext && b.sy < H + ext;
  if (b.kind !== 'sun' && b.kind !== 'comet') { // фаза: доля освещённого диска
    const l = vnorm(vmul(b.pos, -1)), v = vnorm([-dx, -dy, -dz]);
    b.phase = 0.5 + 0.5 * vdot(l, v);
  }
}

// ============================================================ попиксельный рендер сферы
const CAP_R = 240;
let quality = 1;
const MAXM = 4;
const mX = new Float64Array(MAXM), mY = new Float64Array(MAXM), mZ = new Float64Array(MAXM), mRr = new Float64Array(MAXM);

let sphereMs = 0; // JS-время попиксельных циклов за кадр (без растеризации canvas)
function renderSphere(b) {
  const Rdev = b.sr * dpr, ring = b.ring, sh = b.shade, atm = sh.atm || null;
  const ext = ring ? ring.r1 : atm ? atm.ext : 1;
  const pr = Math.max(1.5, Math.min(Rdev, CAP_R * quality));
  const size = Math.min(2048, Math.ceil(2 * ext * pr) + 4);
  const half = size * 0.5, scale = Rdev / pr;
  const ox = b.sx * dpr - half * scale, oy = b.sy * dpr - half * scale;
  const i0 = Math.max(0, Math.floor(-ox / scale)), i1 = Math.min(size, Math.ceil((canvas.width - ox) / scale));
  const j0 = Math.max(0, Math.floor(-oy / scale)), j1 = Math.min(size, Math.ceil((canvas.height - oy) / scale));
  if (i0 >= i1 || j0 >= j1) return;
  if (!b.cv) { b.cv = document.createElement('canvas'); b.cx = b.cv.getContext('2d'); }
  if (b.buf < size) {
    const s = Math.ceil(size / 64) * 64;
    b.cv.width = s; b.cv.height = s;
    b.img = b.cx.createImageData(s, s); b.u32 = new Uint32Array(b.img.data.buffer); b.buf = s;
  }
  const u32 = b.u32, stride = b.buf;

  // локальный базис вида: x — вправо по экрану, y — вниз, z — к камере
  const D = vnorm([b.pos[0] - CP0, b.pos[1] - CP1, b.pos[2] - CP2]);
  let Rv = vcross(D, camU);
  if (vlen(Rv) < 1e-6) Rv = camR.slice();
  Rv = vnorm(Rv);
  const Uv = vcross(Rv, D);
  const loc = w => [vdot(w, Rv), -vdot(w, Uv), -vdot(w, D)];
  const A = loc(b.axA), Bq = loc(b.axB), Pl = loc(b.pole);
  const Ax = A[0], Ay = A[1], Az = A[2], Bx = Bq[0], By = Bq[1], Bz = Bq[2], Px = Pl[0], Py = Pl[1], Pz = Pl[2];

  const emissive = b.kind === 'sun';
  let Lx = 0, Ly = 0, Lz = 1, IR = 1, IG = 1, IB = 1;
  if (!emissive) {
    const Ll = loc(vnorm(vmul(b.pos, -1)));
    Lx = Ll[0]; Ly = Ll[1]; Lz = Ll[2];
    const I = 1.4 * Math.pow(Math.max(0.3, b.rAU), -0.12);
    IR = I * b.lc[0]; IG = I * b.lc[1]; IB = I * b.lc[2];
  }
  const emit = sh.emit || 0;
  const LbA = Lx * Ax + Ly * Ay + Lz * Az, LbB = Lx * Bx + Ly * By + Lz * Bz, LbP = Lx * Px + Ly * Py + Lz * Pz;

  // текстура и уровень мипмапа
  const tex = b.tex, levels = tex.levels, ch = tex.ch;
  let lvl = 0;
  if (levels.length > 1) lvl = clamp(Math.floor(Math.log2(Math.max(1, levels[0].w / (TAU * pr))) + 0.25), 0, levels.length - 1);
  const TL = levels[lvl], td = TL.data, tw = TL.w, th = TL.h;
  const bil = lvl === 0 && levels.length > 1 && levels[0].w / (TAU * pr) < 1.4;
  const bumpK = b.bumpK || 0;
  const spin = b.spinFrac - Math.floor(b.spinFrac);

  // кольца
  let ringOK = false, rA = null, rC = null, rr0 = 0, rr02 = 0, rr12 = 0, rKs = 0, invPz = 0, invLP = 0, ringFace = true, sqrtLP = 0, rNm1 = 0;
  if (ring) {
    rKs = ring.N / (ring.r1 - ring.r0);
    const need = 0.5 * rKs / (pr * Math.sqrt(Math.max(0.04, Math.abs(Pz)))); // ширина пикселя в бинах профиля
    let li = 0;
    while (li < ring.lv.length - 1 && ring.lvR[li] < need) li++;
    const prof = ring.lv[li];
    rA = prof.a; rC = prof.c; rr0 = ring.r0; rr02 = rr0 * rr0; rr12 = ring.r1 * ring.r1; rNm1 = ring.N - 1;
    ringOK = Math.abs(Pz) > 0.002;
    invPz = ringOK ? 1 / Pz : 0;
    const LP = Lx * Px + Ly * Py + Lz * Pz; // синус высоты Солнца над плоскостью колец
    sqrtLP = Math.sqrt(Math.abs(LP));
    ringFace = (LP > 0) === (Pz > 0);
    invLP = Math.abs(LP) > 1e-4 ? 1 / LP : 0;
  }
  // луны, способные отбросить тень на диск
  let nm = 0;
  if (!emissive) for (const m of b.moons) {
    if (nm >= MAXM) break;
    const rel = loc(vmul(vsub(m.pos, b.pos), 1 / b.R));
    if (rel[0] * Lx + rel[1] * Ly + rel[2] * Lz <= 0) continue; // луна не между планетой и Солнцем
    mX[nm] = rel[0]; mY[nm] = rel[1]; mZ[nm] = rel[2]; mRr[nm] = m.R / b.R; nm++;
  }

  const wrap = sh.wrap || 0, invW = 1 / (1 + wrap), limb = sh.limb || 0, amb = sh.amb != null ? sh.amb : 0.004;
  const aR = atm ? atm.c[0] : 0, aG = atm ? atm.c[1] : 0, aB = atm ? atm.c[2] : 0;
  const aRim = atm ? atm.rim : 0, aHalo = atm ? atm.halo : 0, aExt = atm ? atm.ext : 1, aTw = atm ? atm.tw : 0;
  const fwd = atm ? Math.pow(Math.max(0, -Lz), 5) * 2.2 : 0; // рассеяние вперёд при контровом свете
  const soft = !!sh.soft; // газовые гиганты: плавный спад освещённости к терминатору (≈ cos^1.5)
  // отражённый свет планеты на ночной стороне луны («пепельный свет» Луны)
  let psK = 0, PSx = 0, PSy = 0, PSz = 0, psR = 1, psG = 1, psB = 1;
  if (b.kind === 'moon') {
    const par = b.parent, toPar = vnorm(vsub(par.pos, b.pos)), pl = loc(toPar);
    PSx = pl[0]; PSy = pl[1]; PSz = pl[2];
    const litFrac = 0.5 - 0.5 * vdot(vnorm(vmul(par.pos, -1)), toPar); // освещённая доля диска планеты, видимая с луны
    psK = (par.id === 'earth' ? 0.09 : 0.05) * litFrac;
    const tint = par.id === 'earth' ? [0.8, 0.92, 1.12] : par.id === 'neptune' ? [0.8, 0.92, 1.15] : [1.05, 0.96, 0.82];
    psR = tint[0]; psG = tint[1]; psB = tint[2];
  }
  const isEarth = !!sh.earth;
  let Hx = Lx, Hy = Ly, Hz = Lz + 1;
  { const hl = Math.sqrt(Hx * Hx + Hy * Hy + Hz * Hz) || 1; Hx /= hl; Hy /= hl; Hz /= hl; }
  const cloud = b.cloudFrac - Math.floor(b.cloudFrac);
  const IAv = (IR + IG + IB) / 3;

  const inv = 1 / pr, edge = 1 + 1.2 * inv, edge2 = edge * edge;
  const outerR = atm ? Math.max(edge, aExt) : edge, outer2 = outerR * outerR, aExt2 = aExt * aExt;
  const k2 = invPz * invPz, qa = 1 + Px * Px * k2;

  const tLoop = performance.now();
  for (let j = j0; j < j1; j++) {
    const v = (j + 0.5 - half) * inv, v2 = v * v, row = j * stride;
    u32.fill(0, row + i0, row + i1);
    // горизонтальный отрезок строки, где есть диск/гало/кольцо
    let ua = 1e9, ub = -1e9;
    if (v2 < outer2) { const w = Math.sqrt(outer2 - v2); ua = -w; ub = w; }
    if (ringOK) {
      const qb = 2 * Px * Py * v * k2, qc = v2 * (1 + Py * Py * k2) - rr12, disc = qb * qb - 4 * qa * qc;
      if (disc > 0) { const sq = Math.sqrt(disc), u1 = (-qb - sq) / (2 * qa), u2 = (-qb + sq) / (2 * qa); if (u1 < ua) ua = u1; if (u2 > ub) ub = u2; }
    }
    if (ua > ub) continue;
    let ia = Math.floor(ua * pr + half - 1), ib = Math.ceil(ub * pr + half + 1);
    if (ia < i0) ia = i0;
    if (ib > i1) ib = i1;

    for (let i = ia; i < ib; i++) {
      const u = (i + 0.5 - half) * inv, r2 = u * u + v2;
      let cr = 0, cg = 0, cb = 0, ca = 0;
      // --- кольцо
      let rgA = 0, rgR = 0, rgG = 0, rgB = 0, ringZ = 0;
      if (ringOK) {
        const z = -(u * Px + v * Py) * invPz, q2 = r2 + z * z;
        if (q2 > rr02 && q2 < rr12) {
          let k = ((Math.sqrt(q2) - rr0) * rKs) | 0; if (k > rNm1) k = rNm1;
          const al = rA[k];
          if (al > 0.003) {
            const bq = u * Lx + v * Ly + z * Lz;
            let lit = 1;
            if (bq < 0) { const pp = q2 - bq * bq; if (pp < 1.12) lit = 0.035 + 0.965 * sstep(0.94, 1.05, Math.sqrt(pp)); } // тень планеты на кольцах
            const face = ringFace ? 0.28 + 0.72 * sqrtLP : (0.05 + 0.9 * (1 - al)) * sqrtLP;
            const e = face * lit;
            rgA = al; rgR = rC[k * 3] * (e * IR + 0.003); rgG = rC[k * 3 + 1] * (e * IG + 0.003); rgB = rC[k * 3 + 2] * (e * IB + 0.004); ringZ = z;
          }
        }
      }
      if (rgA > 0 && ringZ < 0) { cr = rgR * rgA; cg = rgG * rgA; cb = rgB * rgA; ca = rgA; }

      // --- диск
      if (r2 < edge2) {
        const r = Math.sqrt(r2);
        let cov = (1 - r) * pr + 0.5; if (cov > 1) cov = 1;
        if (cov > 0) {
          let nu = u, nv = v, s;
          if (r2 >= 0.9999) { const kk = 0.99995 / r; nu *= kk; nv *= kk; s = 0.01; } else s = Math.sqrt(1 - r2);
          const nA = nu * Ax + nv * Ay + s * Az, nB = nu * Bx + nv * By + s * Bz;
          let nP = nu * Px + nv * Py + s * Pz; if (nP > 1) nP = 1; else if (nP < -1) nP = -1;
          const lon = fastAtan2(nB, nA), lat = fastAtan2(nP, Math.sqrt(1 - nP * nP));
          let tx = lon * INV_TAU + 0.5 - spin; tx -= Math.floor(tx);
          let ti, ar, ag, ab, gX = 0, gY = 0, sy0, sy1, swy;
          if (bil) { // билинейная выборка в линейном цвете (крупный план)
            const fx = tx * tw - 0.5; let x0 = Math.floor(fx); const wx = fx - x0; if (x0 < 0) x0 += tw; const x1 = x0 + 1 >= tw ? 0 : x0 + 1;
            const fy = (0.5 - lat * INV_PI) * th - 0.5; let y0 = Math.floor(fy); swy = fy - y0; if (y0 < 0) { y0 = 0; swy = 0; } const y1 = y0 + 1 >= th ? th - 1 : y0 + 1;
            sy0 = y0; sy1 = y1;
            const i00 = (y0 * tw + x0) * ch, i10 = (y0 * tw + x1) * ch, i01 = (y1 * tw + x0) * ch, i11 = (y1 * tw + x1) * ch;
            const w00 = (1 - wx) * (1 - swy), w10 = wx * (1 - swy), w01 = (1 - wx) * swy, w11 = wx * swy;
            ar = S2L[td[i00]] * w00 + S2L[td[i10]] * w10 + S2L[td[i01]] * w01 + S2L[td[i11]] * w11;
            ag = S2L[td[i00 + 1]] * w00 + S2L[td[i10 + 1]] * w10 + S2L[td[i01 + 1]] * w01 + S2L[td[i11 + 1]] * w11;
            ab = S2L[td[i00 + 2]] * w00 + S2L[td[i10 + 2]] * w10 + S2L[td[i01 + 2]] * w01 + S2L[td[i11 + 2]] * w11;
            if (bumpK) {
              gX = (td[i00 + 3] * w00 + td[i10 + 3] * w10 + td[i01 + 3] * w01 + td[i11 + 3] * w11 - 128) * INV_GS;
              gY = (td[i00 + 4] * w00 + td[i10 + 4] * w10 + td[i01 + 4] * w01 + td[i11 + 4] * w11 - 128) * INV_GS;
            }
            ti = wx < 0.5 ? (swy < 0.5 ? i00 : i01) : (swy < 0.5 ? i10 : i11);
          } else {
            let xi = (tx * tw) | 0; if (xi >= tw) xi = tw - 1;
            let yi = ((0.5 - lat * INV_PI) * th) | 0; if (yi < 0) yi = 0; else if (yi >= th) yi = th - 1;
            sy0 = sy1 = yi; swy = 0;
            ti = (yi * tw + xi) * ch;
            ar = S2L[td[ti]]; ag = S2L[td[ti + 1]]; ab = S2L[td[ti + 2]];
            if (bumpK) { gX = (td[ti + 3] - 128) * INV_GS; gY = (td[ti + 4] - 128) * INV_GS; }
          }
          let pR, pG, pB;
          if (emissive) {
            const m1 = 1 - s, ld = 1 - 0.5 * m1 - 0.12 * m1 * m1, e = emit * ld;
            pR = ar * e; pG = ag * e * (0.9 + 0.1 * s); pB = ab * e * (0.75 + 0.25 * s);
          } else {
            let ndl = nu * Lx + nv * Ly + s * Lz;
            if (bumpK && (gX !== 0 || gY !== 0)) { // рельеф: n' = n − k·∇h в касательной плоскости (восток, север)
              const rho = Math.sqrt(nA * nA + nB * nB) + 1e-6, ir = 1 / rho;
              const eL = (nA * LbB - nB * LbA) * ir, nL = rho * LbP - nP * (nA * LbA + nB * LbB) * ir;
              const bumped = ndl - bumpK * (gX * eL + gY * nL);
              ndl = ndl > -0.05 ? bumped : ndl;
            }
            let dif = (ndl + wrap) * invW; if (dif < 0) dif = 0;
            if (soft) dif *= Math.sqrt(dif);
            let shd = 1;
            if (dif > 0) {
              if (ringOK && invLP !== 0) { // тень колец на планете
                const t = -nP * invLP;
                if (t > 0) {
                  const h2 = 1 + 2 * t * ndl + t * t;
                  if (h2 > rr02 && h2 < rr12) { let k = ((Math.sqrt(h2) - rr0) * rKs) | 0; if (k > rNm1) k = rNm1; shd *= 1 - 0.88 * rA[k]; }
                }
              }
              for (let q = 0; q < nm; q++) { // тени лун
                const dx = mX[q] - nu, dy = mY[q] - nv, dz = mZ[q] - s, t = dx * Lx + dy * Ly + dz * Lz;
                if (t > 0) { const pp = dx * dx + dy * dy + dz * dz - t * t, rm = mRr[q]; if (pp < rm * rm * 1.6) shd *= sstep(0.7, 1.25, Math.sqrt(pp) / rm); }
              }
            }
            let oc = 0, li = 0, cl = 0;
            if (isEarth) {
              oc = td[ti + 3] * (1 / 255); li = td[ti + 4] * (1 / 255);
              let cx2 = tx + cloud; cx2 -= Math.floor(cx2);
              if (bil) {
                const fx = cx2 * tw - 0.5; let x0 = Math.floor(fx); const wx = fx - x0; if (x0 < 0) x0 += tw; const x1 = x0 + 1 >= tw ? 0 : x0 + 1;
                const r0 = sy0 * tw, r1 = sy1 * tw;
                cl = ((td[(r0 + x0) * ch + 5] * (1 - wx) + td[(r0 + x1) * ch + 5] * wx) * (1 - swy) + (td[(r1 + x0) * ch + 5] * (1 - wx) + td[(r1 + x1) * ch + 5] * wx) * swy) * (1 / 255);
              } else {
                let xc = (cx2 * tw) | 0; if (xc >= tw) xc = tw - 1;
                cl = td[(sy0 * tw + xc) * ch + 5] * (1 / 255);
              }
              ar = ar * (1 - cl) + 0.78 * cl; ag = ag * (1 - cl) + 0.8 * cl; ab = ab * (1 - cl) + 0.84 * cl;
            }
            let kd = dif * shd;
            if (limb > 0) kd *= 1 - limb + limb * Math.sqrt(s);
            pR = ar * (kd * IR + amb); pG = ag * (kd * IG + amb); pB = ab * (kd * IB + amb * 1.4);
            if (psK > 0) { const pl = nu * PSx + nv * PSy + s * PSz; if (pl > 0) { const q = pl * psK; pR += ar * q * psR; pG += ag * q * psG; pB += ab * q * psB; } }
            if (isEarth) {
              if (oc > 0 && dif > 0) { // солнечный блик на океане
                const nh = nu * Hx + nv * Hy + s * Hz;
                if (nh > 0.7) { const sp = oc * (1 - cl * 0.85) * shd * IAv * (Math.pow(nh, 90) * 0.85 + Math.pow(nh, 14) * 0.11); pR += sp; pG += sp * 0.92; pB += sp * 0.8; }
              }
              if (li > 0) { // ночные огни городов
                const night = sstep(0.1, -0.16, ndl);
                if (night > 0) { const q = li * li * night * (1 - cl * 0.8) * 0.95; pR += q; pG += q * 0.62; pB += q * 0.28; }
              }
            }
            if (atm) {
              const f = 1 - s, rim = f * f * f * aRim;
              let lf = ndl * 1.3 + 0.4; lf = lf < 0 ? 0 : lf > 1 ? 1 : lf;
              const add = rim * (lf + fwd) * IAv;
              pR += aR * add; pG += aG * add; pB += aB * add;
              if (aTw > 0) { const d = (ndl - 0.02) * 13, tw2 = Math.exp(-d * d) * aTw * IAv; pR += tw2 * 0.3; pG += tw2 * 0.11; pB += tw2 * 0.025; }
            }
          }
          cr = cr * (1 - cov) + pR * cov; cg = cg * (1 - cov) + pG * cov; cb = cb * (1 - cov) + pB * cov; ca = ca * (1 - cov) + cov;
        }
      }
      // --- гало атмосферы за лимбом
      if (atm && r2 > 1 && r2 < aExt2) {
        const r = Math.sqrt(r2), d = (r - 1) / (aExt - 1);
        const fall = (1 - d) * (1 - d) * Math.exp(-d * 2.5);
        let lf = (u * Lx + v * Ly) / r * 0.9 + 0.3; if (lf < 0) lf = 0;
        let hA = fall * aHalo * (lf + fwd * 1.5) * IAv;
        if (hA > 0.002) { if (hA > 1) hA = 1; cr += aR * hA; cg += aG * hA; cb += aB * hA; ca += hA * (1 - ca); }
      }
      // --- ближняя половина кольца поверх всего
      if (rgA > 0 && ringZ >= 0) { cr = cr * (1 - rgA) + rgR * rgA; cg = cg * (1 - rgA) + rgG * rgA; cb = cb * (1 - rgA) + rgB * rgA; ca = ca * (1 - rgA) + rgA; }

      if (ca <= 0.003) continue;
      if (ca > 1) ca = 1;
      const ic = 1 / ca;
      let lr = cr * ic * INV_TMAX, lg = cg * ic * INV_TMAX, lb = cb * ic * INV_TMAX;
      lr = lr >= 1 ? 1 : lr <= 0 ? 0 : lr; lg = lg >= 1 ? 1 : lg <= 0 ? 0 : lg; lb = lb >= 1 ? 1 : lb <= 0 ? 0 : lb;
      u32[row + i] = (((ca * 255 + 0.5) | 0) << 24) | (L2S[(Math.sqrt(lb) * TN) | 0] << 16) | (L2S[(Math.sqrt(lg) * TN) | 0] << 8) | L2S[(Math.sqrt(lr) * TN) | 0];
    }
  }
  sphereMs += performance.now() - tLoop;
  b.cx.clearRect(i0 - 2, j0 - 2, i1 - i0 + 4, j1 - j0 + 4); // с каймой: билинейное масштабирование не зацепит старые пиксели
  b.cx.putImageData(b.img, 0, 0, i0, j0, i1 - i0, j1 - j0);
  ctx.drawImage(b.cv, i0, j0, i1 - i0, j1 - j0, (ox + i0 * scale) / dpr, (oy + j0 * scale) / dpr, (i1 - i0) * scale / dpr, (j1 - j0) * scale / dpr);
}

// ============================================================ отрисовка сцены
function drawSpr(s, x, y, r, a) { ctx.globalAlpha = a > 1 ? 1 : a; ctx.drawImage(s, x - r, y - r, r * 2, r * 2); }

function drawSky() {
  const sw = sky.width, shh = sky.height, f = FOC * sw / W, hw = sw / 2, hh = shh / 2;
  skx.globalCompositeOperation = 'source-over';
  skx.globalAlpha = 1;
  skx.fillStyle = '#020309';
  skx.fillRect(0, 0, sw, shh);
  skx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < MW.length; k++) {
    const bl = MW[k], d = bl.d, z = d[0] * CF0 + d[1] * CF1 + d[2] * CF2;
    if (z < 0.15) continue;
    const r = bl.size * f / z, sx = hw + (d[0] * CR0 + d[1] * CR1 + d[2] * CR2) * f / z, sy = hh - (d[0] * CU0 + d[1] * CU1 + d[2] * CU2) * f / z;
    if (sx < -r || sx > sw + r || sy < -r || sy > shh + r) continue;
    skx.globalAlpha = bl.a;
    skx.drawImage(bl.spr, sx - r, sy - r, r * 2, r * 2);
  }
  skx.globalCompositeOperation = 'source-over';
  for (let k = 0; k < DUST.length; k++) {
    const bl = DUST[k], d = bl.d, z = d[0] * CF0 + d[1] * CF1 + d[2] * CF2;
    if (z < 0.15) continue;
    const r = bl.size * f / z, sx = hw + (d[0] * CR0 + d[1] * CR1 + d[2] * CR2) * f / z, sy = hh - (d[0] * CU0 + d[1] * CU1 + d[2] * CU2) * f / z;
    if (sx < -r || sx > sw + r || sy < -r || sy > shh + r) continue;
    skx.globalAlpha = bl.a;
    skx.drawImage(SPR.dust, sx - r, sy - r, r * 2, r * 2);
  }
  if (sun.cz > 0) { // широкий солнечный ореол — в четвертьразмерном слое неба (дёшево)
    const R = Math.max(sun.sr, 2.2), big = clamp(45 / R, 0.22, 1), hr = Math.min(R * 30, (W + H) * 0.9) * sw / W;
    skx.globalCompositeOperation = 'lighter';
    skx.globalAlpha = 0.3 * Math.pow(big, 0.9);
    skx.drawImage(SPR.haze, sun.sx * sw / W - hr, sun.sy * sw / W - hr, hr * 2, hr * 2);
    skx.globalCompositeOperation = 'source-over';
  }
  skx.globalAlpha = 1;
  ctx.globalAlpha = 1;
  ctx.drawImage(sky, 0, 0, W, H);
}

function drawStars() {
  for (let q = 0; q < starBuckets.length; q++) {
    const bk = starBuckets[q], idx = bk.idx, s = bk.size, hs = s / 2;
    ctx.beginPath();
    for (let n = 0; n < idx.length; n++) {
      const i3 = idx[n] * 3, x = starDir[i3], y = starDir[i3 + 1], z0 = starDir[i3 + 2];
      const z = x * CF0 + y * CF1 + z0 * CF2;
      if (z < 0.05) continue;
      const sx = HW + (x * CR0 + y * CR1 + z0 * CR2) * FOC / z, sy = HH - (x * CU0 + y * CU1 + z0 * CU2) * FOC / z;
      if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
      ctx.rect(sx - hs, sy - hs, s, s);
    }
    ctx.fillStyle = bk.style;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const st of brightStars) {
    const i3 = st.i * 3, x = starDir[i3], y = starDir[i3 + 1], z0 = starDir[i3 + 2];
    const z = x * CF0 + y * CF1 + z0 * CF2;
    if (z < 0.05) continue;
    const sx = HW + (x * CR0 + y * CR1 + z0 * CR2) * FOC / z, sy = HH - (x * CU0 + y * CU1 + z0 * CU2) * FOC / z;
    if (sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8) continue;
    drawSpr(SPR.star, sx, sy, 2.5 + st.m * 3.5, 0.35 + st.m * 0.4);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawBelt(B, rgb, alphas, sizeK) {
  const d = simDay, n = B.n, pe = P_EXP - 1, ks = KS;
  for (let bk = 0; bk < 3; bk++) {
    ctx.beginPath();
    for (let i = bk; i < n; i += 3) {
      const M = B.M0[i] + B.nm[i] * d, e = B.e[i];
      const E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
      const xo = B.a[i] * (Math.cos(E) - e), yo = B.b[i] * Math.sin(E), o = i * 6, pq = B.pq;
      const ex = xo * pq[o] + yo * pq[o + 3], ey = xo * pq[o + 1] + yo * pq[o + 4], ez = xo * pq[o + 2] + yo * pq[o + 5];
      const k = ks * Math.pow(Math.sqrt(ex * ex + ey * ey + ez * ez), pe);
      const dx = ex * k - CP0, dy = ez * k - CP1, dz = -ey * k - CP2;
      const z = dx * CF0 + dy * CF1 + dz * CF2;
      if (z < 0.5) continue;
      const sx = HW + (dx * CR0 + dy * CR1 + dz * CR2) * FOC / z, sy = HH - (dx * CU0 + dy * CU1 + dz * CU2) * FOC / z;
      if (sx < -2 || sx > W + 2 || sy < -2 || sy > H + 2) continue;
      let s = sizeK * FOC / z; s = s < 0.7 ? 0.7 : s > 2.4 ? 2.4 : s;
      ctx.rect(sx - s * 0.5, sy - s * 0.5, s, s);
    }
    ctx.fillStyle = `rgba(${rgb},${alphas[bk]})`;
    ctx.fill();
  }
}

// полилиния в мировых координатах с отсечением по ближней плоскости
function pathPoly(pts, start, count, closed) {
  let pen = false, px = 0, py = 0, pz = 0;
  const total = closed ? count + 1 : count;
  for (let k = 0; k < total; k++) {
    const i3 = (start + (k % count)) * 3;
    const dx = pts[i3] - CP0, dy = pts[i3 + 1] - CP1, dz = pts[i3 + 2] - CP2;
    const x = dx * CR0 + dy * CR1 + dz * CR2, y = dx * CU0 + dy * CU1 + dz * CU2, z = dx * CF0 + dy * CF1 + dz * CF2;
    if (k > 0) {
      if (pz > NEAR && z > NEAR) {
        if (!pen) { ctx.moveTo(HW + px * FOC / pz, HH - py * FOC / pz); pen = true; }
        ctx.lineTo(HW + x * FOC / z, HH - y * FOC / z);
      } else if (pz > NEAR) {
        const t = (pz - NEAR) / (pz - z), cx = px + (x - px) * t, cy = py + (y - py) * t;
        if (!pen) ctx.moveTo(HW + px * FOC / pz, HH - py * FOC / pz);
        ctx.lineTo(HW + cx * FOC / NEAR, HH - cy * FOC / NEAR);
        pen = false;
      } else if (z > NEAR) {
        const t = (NEAR - pz) / (z - pz), cx = px + (x - px) * t, cy = py + (y - py) * t;
        ctx.moveTo(HW + cx * FOC / NEAR, HH - cy * FOC / NEAR);
        ctx.lineTo(HW + x * FOC / z, HH - y * FOC / z);
        pen = true;
      } else pen = false;
    }
    px = x; py = y; pz = z;
  }
}

const TRAIL_N = 64;
const trailBuf = new Float32Array(TRAIL_N * 3);
const circBuf = new Float32Array(97 * 3);
function strokeTrail(buf, n, rgb, a0, w0) {
  const BANDS = 8, per = (n - 1) / BANDS;
  for (let bn = 0; bn < BANDS; bn++) {
    const s = Math.round(bn * per), e = Math.round((bn + 1) * per);
    const f = 1 - (bn + 0.5) / BANDS, a = a0 * f * f;
    ctx.beginPath();
    pathPoly(buf, s, e - s + 1, false);
    ctx.lineWidth = w0 * 3.4 * (0.5 + 0.5 * f); ctx.strokeStyle = `rgba(${rgb},${(a * 0.15).toFixed(4)})`; ctx.stroke();
    ctx.lineWidth = w0 * (0.3 + 0.7 * f); ctx.strokeStyle = `rgba(${rgb},${a.toFixed(4)})`; ctx.stroke();
  }
}
function moonArc(m, th0, th1, n, buf) {
  const P = m.parent.pos, d = m.dist;
  for (let k = 0; k < n; k++) {
    const th = th0 + (th1 - th0) * k / (n - 1), c = Math.cos(th), s = Math.sin(th);
    buf[k * 3] = P[0] + d * (c * m.e1[0] + s * m.e2[0]);
    buf[k * 3 + 1] = P[1] + d * (c * m.e1[1] + s * m.e2[1]);
    buf[k * 3 + 2] = P[2] + d * (c * m.e1[2] + s * m.e2[2]);
  }
}
function moonOrbitPx(m) { return m.parent.cz > 0 ? m.dist * FOC / m.parent.cz : 0; }

function drawOrbits(a) {
  ctx.lineWidth = 1;
  const own = focus.kind === 'moon' ? focus.parent : focus;
  for (const p of planets) {
    const k = focus.kind === 'sun' || p === own ? 1 : 0.4;
    ctx.beginPath(); pathPoly(p.orbitD, 0, ORBIT_N, true);
    ctx.strokeStyle = `rgba(${p.trail},${(0.17 * a * k).toFixed(4)})`; ctx.stroke();
  }
  ctx.setLineDash([3, 5]);
  ctx.beginPath(); pathPoly(comet.orbitD, 0, ORBIT_N, true);
  ctx.strokeStyle = `rgba(170,220,255,${(0.12 * a).toFixed(4)})`; ctx.stroke();
  ctx.setLineDash([]);
  for (const m of moons) {
    const px = moonOrbitPx(m);
    if (px < 10 || m.parent.cz <= 0) continue;
    moonArc(m, 0, TAU, 97, circBuf);
    ctx.beginPath(); pathPoly(circBuf, 0, 97, false);
    ctx.strokeStyle = `rgba(200,212,238,${(clamp((px - 10) / 40, 0, 1) * 0.16 * a).toFixed(4)})`; ctx.stroke();
  }
}

function drawTrails(a) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const p of planets) {
    const span = 1.15;
    for (let k = 0; k < TRAIL_N; k++) {
      elemPos(p.el, p.M - span * k / (TRAIL_N - 1), tmpA);
      toDisp(tmpA[0], tmpA[1], tmpA[2], tmpB);
      trailBuf[k * 3] = tmpB[0]; trailBuf[k * 3 + 1] = tmpB[1]; trailBuf[k * 3 + 2] = tmpB[2];
    }
    strokeTrail(trailBuf, TRAIL_N, p.trail, 0.8 * a, 1.7);
  }
  for (const m of moons) {
    const px = moonOrbitPx(m);
    if (px < 8) continue;
    moonArc(m, m.th, m.th - 2.3, 40, trailBuf);
    strokeTrail(trailBuf, 40, '215,225,245', clamp((px - 8) / 30, 0, 1) * 0.6 * a, 1.3);
  }
  ctx.lineCap = 'butt';
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function worldSprite(spr, x, y, z, rWorld, a) {
  const dx = x - CP0, dy = y - CP1, dz = z - CP2, cz = dx * CF0 + dy * CF1 + dz * CF2;
  if (cz < NEAR * 4) return;
  const sx = HW + (dx * CR0 + dy * CR1 + dz * CR2) * FOC / cz, sy = HH - (dx * CU0 + dy * CU1 + dz * CU2) * FOC / cz;
  let r = rWorld * FOC / cz;
  if (r < 0.9) { a *= r / 0.9; r = 0.9; }
  if (a < 0.003 || sx + r < 0 || sx - r > W || sy + r < 0 || sy - r > H) return;
  ctx.globalAlpha = a > 1 ? 1 : a;
  ctx.drawImage(spr, sx - r, sy - r, r * 2, r * 2);
}

function drawComet() {
  const c = comet, P = c.pos, act = c.act, sc = BODY_K;
  ctx.globalCompositeOperation = 'lighter';
  if (act > 0.01) {
    const Ad = vnorm(P), Vd = c.vdir, aK = Math.min(1, act * 0.8);
    const Lt = 6.5 * Math.pow(act, 0.85) * sc, Ld = Lt * 0.8;
    const side = vnorm(vcross(Ad, camF));
    for (let k = 1; k <= 52; k++) {
      const t = k / 52;
      worldSprite(SPR.dustTail,
        P[0] + Ad[0] * Ld * t - Vd[0] * Ld * 0.55 * t * t, P[1] + Ad[1] * Ld * t - Vd[1] * Ld * 0.55 * t * t, P[2] + Ad[2] * Ld * t - Vd[2] * Ld * 0.55 * t * t,
        (0.16 + 1.5 * t) * sc * (0.6 + 0.4 * aK), 0.13 * aK * Math.pow(1 - t, 1.5));
      const w = Math.sin(time * 1.7 + t * 11) * 0.035 * t * Lt;
      worldSprite(SPR.ion,
        P[0] + Ad[0] * Lt * t + side[0] * w, P[1] + Ad[1] * Lt * t + side[1] * w, P[2] + Ad[2] * Lt * t + side[2] * w,
        (0.1 + 0.45 * t) * sc, 0.16 * aK * Math.pow(1 - t, 1.2));
    }
    for (const f of c.fil) { // волокна ионного хвоста
      const t = f.t, L = Lt * f.len * t;
      const off = f.o * t * t * Lt * 0.13 + Math.sin(time * f.s + f.p) * 0.02 * Lt * t;
      worldSprite(SPR.ion, P[0] + Ad[0] * L + side[0] * off, P[1] + Ad[1] * L + side[1] * off, P[2] + Ad[2] * L + side[2] * off,
        0.06 * sc * (1 + t), 0.09 * aK * (1 - t));
    }
  }
  worldSprite(SPR.coma, P[0], P[1], P[2], (0.3 + 0.9 * Math.sqrt(act)) * sc, 0.5 + 0.45 * Math.min(1, act));
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawSun(b) {
  if (b.sr * dpr >= 1.5) renderSphere(b);
  const R = Math.max(b.sr, 2.2);
  const big = clamp(45 / R, 0.22, 1); // крупное Солнце на экране: ореол относительно меньше и тусклее
  ctx.globalCompositeOperation = 'lighter';
  drawSpr(SPR.glow, b.sx, b.sy, R * (1.5 + 4.6 * big), 0.85 * (0.35 + 0.65 * big));
  ctx.save();
  ctx.translate(b.sx, b.sy);
  ctx.rotate(time * 0.006);
  ctx.globalAlpha = 0.75 * (0.55 + 0.45 * big); ctx.drawImage(SPR.corona, -R * 4.2, -R * 4.2, R * 8.4, R * 8.4);
  ctx.rotate(1.3 - time * 0.014);
  ctx.globalAlpha = 0.4 * (0.55 + 0.45 * big); ctx.drawImage(SPR.corona, -R * 4.2, -R * 4.2, R * 8.4, R * 8.4);
  ctx.restore();
  drawSpr(SPR.glow, b.sx, b.sy, R * 2.4, 0.5 * big);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawBody(b) {
  if (b.kind === 'sun') { drawSun(b); return; }
  const rd = b.sr * dpr, c = b.flatRGB, ph = b.phase * Math.min(1, b.eclipse + 0.1);
  if (rd < 1.5) {
    const k = 0.25 + 0.75 * ph;
    ctx.fillStyle = `rgba(${(c[0] * 255 * k) | 0},${(c[1] * 255 * k) | 0},${(c[2] * 255 * k) | 0},1)`;
    ctx.beginPath(); ctx.arc(b.sx, b.sy, Math.max(0.7, b.sr), 0, TAU); ctx.fill();
  } else renderSphere(b);
  if (b.sr < 7) { // искра: планеты читаются как яркие точки в общем плане
    if (!b.glint) b.glint = radialSprite(32, [[0, `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},1)`], [0.3, `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},0.3)`], [1, 'rgba(0,0,0,0)']]);
    ctx.globalCompositeOperation = 'lighter';
    drawSpr(b.glint, b.sx, b.sy, 4 + b.sr * 2.2, (b.kind === 'moon' ? 0.22 : 0.42) * (0.3 + 0.7 * ph) * (1 - b.sr / 7));
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

function sunVisibility() {
  if (!sun.vis || sun.cz <= 0) return 0;
  const m = Math.min(sun.sx / W, 1 - sun.sx / W, sun.sy / H, 1 - sun.sy / H);
  let v = sstep(-0.08, 0.06, m);
  const Rs = Math.max(sun.sr, 1);
  for (const b of drawList) {
    if (b === sun || b.kind === 'comet' || !b.vis || b.cz >= sun.cz) continue;
    const d = Math.hypot(b.sx - sun.sx, b.sy - sun.sy);
    if (d < b.sr + Rs) {
      const ov = clamp((b.sr + Rs - d) / (2 * Math.min(b.sr, Rs)), 0, 1) * Math.min(1, (b.sr * b.sr) / (Rs * Rs));
      v *= 1 - ov;
    }
  }
  return v * clamp(1.35 - sun.sr / (0.22 * Math.min(W, H)), 0.25, 1);
}
function drawFlare(v) {
  if (v < 0.01) return;
  const m = Math.min(W, H), dx = HW - sun.sx, dy = HH - sun.sy;
  ctx.globalCompositeOperation = 'lighter';
  ctx.save();
  ctx.translate(sun.sx, sun.sy); ctx.scale(1, 0.016);
  ctx.globalAlpha = 0.32 * v;
  ctx.drawImage(SPR.streak, -m * 0.75, -m * 0.75, m * 1.5, m * 1.5);
  ctx.restore();
  for (const g of SPR.ghosts) drawSpr(g.s, sun.sx + dx * g.k, sun.sy + dy * g.k, g.r * m, g.a * v);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawLabels(a) {
  if (a < 0.02) return;
  ctx.font = '600 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const hasLS = 'letterSpacing' in ctx;
  if (hasLS) ctx.letterSpacing = '1.3px';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 5; // читаемость на фоне солнечного ореола
  const BIG = 30; // крупное на экране тело подписывается по центру над диском, без выноски
  // диски, которые подписи не должны закрывать (у Солнца — вместе с ярким ореолом)
  const disks = [];
  for (const o of solids) {
    if (!o.vis) continue;
    const r = o === sun ? Math.max(o.sr, 2) * 1.5 + 8 : o.ring ? o.sr * o.ring.r1 + 3 : Math.max(o.sr, 1.5) + 4;
    disks.push({ x: o.sx, y: o.sy, r, o });
  }
  const placed = [];
  const free = (x0, y0, x1, y1, self) => {
    if (x0 < 6 || x1 > W - 6 || y0 < 6 || y1 > H - 6) return false;
    for (const p of placed) if (x0 < p[2] && x1 > p[0] && y0 < p[3] && y1 > p[1]) return false;
    for (const d of disks) {
      if (d.o === self && self.sr > BIG) continue;
      const cx = clamp(d.x, x0, x1), cy = clamp(d.y, y0, y1), dx = cx - d.x, dy = cy - d.y;
      if (dx * dx + dy * dy < d.r * d.r) return false;
    }
    return true;
  };
  const hidden = b => { // тело за диском Солнца или планеты — без подписи
    for (const o of labelOccl) {
      if (o === b || !o.vis || o.cz >= b.cz) continue;
      const dx = o.sx - b.sx, dy = o.sy - b.sy;
      if (dx * dx + dy * dy < o.sr * o.sr) return true;
    }
    return false;
  };
  const list = [focus, earth, byId.jupiter, byId.saturn, byId.mars, byId.venus, byId.mercury, byId.uranus, byId.neptune, comet, ...moons];
  const seen = new Set();
  for (const b of list) {
    if (seen.has(b)) continue;
    seen.add(b);
    if (!b.vis || b.kind === 'sun') continue;
    // спутники подписываем только в фокусе их системы, когда планета крупная
    if (b.kind === 'moon' && !(focus === b || (focus === b.parent && b.parent.sr > BIG))) continue;
    if (b.kind === 'comet' && b !== focus && b.act < 0.05) continue; // неактивная комета — просто точка
    if (hidden(b)) continue;
    const w = ctx.measureText(b.label).width;
    const al = a * (b.kind === 'moon' ? 0.72 : 0.92);
    const style = b === focus ? `rgba(255,198,135,${al.toFixed(3)})` : `rgba(232,238,252,${al.toFixed(3)})`;
    const lineStyle = `rgba(200,215,255,${(0.34 * al).toFixed(3)})`;

    if (b.sr > BIG) {
      if (b.sx < 0 || b.sx > W) continue;
      let ext = b.sr;
      if (b.ring) { const ny = vdot(b.pole, camU); ext = Math.max(ext, b.sr * b.ring.r1 * Math.sqrt(Math.max(0, 1 - ny * ny))); }
      for (const side of [-1, 1]) { // над телом, иначе под ним
        const y = b.sy + side * (ext + 16), x0 = b.sx - w / 2 - 4, x1 = b.sx + w / 2 + 4;
        if (!free(x0, y - 8, x1, y + 8, b)) continue;
        placed.push([x0, y - 8, x1, y + 8]);
        ctx.strokeStyle = lineStyle; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(b.sx, y - side * 8); ctx.lineTo(b.sx, b.sy + side * (ext + 3)); ctx.stroke();
        ctx.fillStyle = style; ctx.textAlign = 'center';
        ctx.fillText(b.label, b.sx, y);
        break;
      }
      continue;
    }

    // мелкое тело: выноска от края диска; 6 направлений × 2 длины, первое свободное место
    const r = Math.max(b.sr, 1.5);
    let done = false;
    for (let lvl = 0; lvl < 2 && !done; lvl++) {
      const gap = 10 + lvl * 20;
      for (let c = 0; c < 6 && !done; c++) {
        const hx = c % 2 === 0 ? 1 : -1, vy = c < 2 ? -1 : c < 4 ? 1 : 0;
        const k = vy === 0 ? 1 : 0.72;
        const ax = b.sx + hx * r * k, ay = b.sy + vy * r * k;
        const lx = ax + hx * gap, ly = ay + vy * gap * 0.75;
        const x0 = hx > 0 ? lx - 2 : lx - w - 6, x1 = hx > 0 ? lx + w + 6 : lx + 2;
        if (!free(x0, ly - 8, x1, ly + 8, b)) continue;
        placed.push([x0, ly - 8, x1, ly + 8]);
        ctx.strokeStyle = lineStyle; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ax + hx * 1.5, ay + vy * 1.5); ctx.lineTo(lx, ly); ctx.stroke();
        ctx.fillStyle = style; ctx.textAlign = hx > 0 ? 'left' : 'right';
        ctx.fillText(b.label, lx + hx * 3, ly);
        done = true;
      }
    }
  }
  if (hasLS) ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
  ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)';
}

let drawList = [];
const labelOccl = [sun, ...planets];
let orbitsA = 1, trailsA = 1, labelsA = 1, showOrbits = true, showTrails = true, showLabels = true, autoRot = true;
function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  projectBody(sun);
  drawSky();
  drawStars();

  for (const p of planets) projectBody(p);
  for (const m of moons) projectBody(m);
  projectBody(comet);

  drawBelt(beltKuiper, '150,172,215', [0.1, 0.17, 0.26], 0.1 * Math.max(0.5, BODY_K));
  drawBelt(beltMain, '198,180,152', [0.2, 0.34, 0.52], 0.07 * Math.max(0.4, BODY_K));
  drawBelt(beltTrojans, '188,172,152', [0.16, 0.28, 0.42], 0.07 * Math.max(0.4, BODY_K));

  if (orbitsA > 0.01) drawOrbits(orbitsA);
  if (trailsA > 0.01) drawTrails(trailsA);
  drawComet();

  drawList = [sun, ...planets, ...moons];
  drawList.sort((a, b) => b.cz - a.cz);
  for (const b of drawList) if (b.vis) drawBody(b);

  drawFlare(sunVisibility());
  ctx.globalAlpha = 1;
  drawLabels(labelsA); // виньетка — CSS-слоем поверх canvas
}

// ============================================================ интерфейс
const $ = id => document.getElementById(id);
const FOCUSABLE = [sun, ...planets, comet];
const chipsEl = $('chips');
for (const b of FOCUSABLE) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'chip';
  const dot = document.createElement('i'); dot.style.setProperty('--c', b.flat);
  btn.appendChild(dot); btn.appendChild(document.createTextNode(b.name));
  btn.addEventListener('click', () => setFocus(b));
  chipsEl.appendChild(btn);
  b.chip = btn;
}
const zoomEl = $('zoom'), speedEl = $('speed'), distEl = $('dist');
const fmt = (x, d) => x.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
function zoomRange() { return [Math.log(focusMin(focus)), Math.log(MAX_D)]; }
function syncZoom() {
  const [a, b] = zoomRange();
  zoomEl.value = String(Math.round(clamp((Math.log(cam.distT) - a) / (b - a), 0, 1) * 1000));
  $('zoomOut').textContent = cam.distT >= 100 ? fmt(cam.distT, 0) : fmt(cam.distT, cam.distT >= 10 ? 1 : 2);
}
zoomEl.addEventListener('input', () => {
  const [a, b] = zoomRange();
  cam.distT = Math.exp(lerp(a, b, zoomEl.value / 1000));
  intro = false; lastInteract = time;
  syncZoom();
});
function fmtSpeed(s) {
  if (s < 1) return `${fmt(s * 24, s * 24 < 10 ? 1 : 0)} ч/с`;
  if (s < 60) return `${fmt(s, s < 10 ? 1 : 0)} сут/с`;
  return `${fmt(s / 30.44, 1)} мес/с`;
}
function readSpeed() { speed = Math.pow(10, -1.3 + 3.6 * speedEl.value / 1000); $('speedOut').textContent = fmtSpeed(speed); rateDirty = true; }
speedEl.addEventListener('input', readSpeed);
function readDist() {
  const p = 1 - 0.6 * distEl.value / 1000;
  setDistanceExp(p); applyScale();
  $('distOut').textContent = p > 0.985 ? 'реальные' : `r^${fmt(p, 2)}`;
  cam.distT = clampDist(cam.distT); syncZoom();
}
distEl.addEventListener('input', readDist);
let rateDirty = true;
for (const btn of document.querySelectorAll('.tg')) {
  btn.addEventListener('click', () => {
    const t = btn.dataset.t;
    if (t === 'orbits') showOrbits = !showOrbits;
    else if (t === 'trails') showTrails = !showTrails;
    else if (t === 'labels') showLabels = !showLabels;
    else if (t === 'rotate') { autoRot = !autoRot; lastInteract = time - 10; }
    else if (t === 'pause') paused = !paused;
    syncToggles();
  });
}
function syncToggles() {
  const st = { orbits: showOrbits, trails: showTrails, labels: showLabels, rotate: autoRot, pause: paused };
  for (const btn of document.querySelectorAll('.tg')) btn.classList.toggle('on', !!st[btn.dataset.t]);
  rateDirty = true;
}

function setFocus(b) {
  if (!b) return;
  if (b === focus && focusT < 1) return; // повторный клик во время перелёта не обрывает его
  focusFrom = cam.target.slice();
  focusDistFrom = cam.dist;
  focusT = focus === b && b.kind === 'sun' ? 1 : 0; // повторный клик по планете — вернуть выигрышный ракурс
  focus = b;
  cam.distT = clampDist(focusDist(b));
  const sep = vlen(vsub(b.pos, cam.target));
  focusBump = Math.max(0, Math.log(Math.max(1e-3, sep * 0.9)) - Math.max(Math.log(focusDistFrom), Math.log(cam.distT)));
  if (focusT < 1) {
    const [hy, hp] = heroAngles(b);
    yawFrom = cam.yaw; pitchFrom = cam.pitch;
    yawTo = yawFrom + wrapPi(hy - yawFrom); pitchTo = hp; heroPrev = hy;
    heroAnim = true; refPrev = null; orbitDir = 1;
  }
  intro = false; lastInteract = time;
  for (const f of FOCUSABLE) f.chip.classList.toggle('on', f === b);
  syncZoom();
  updateCard();
}

const cardEl = $('card');
function updateCard() {
  const b = focus;
  let rows = [];
  if (b.kind === 'planet') {
    const v = 29.7847 * Math.sqrt(Math.max(0, 2 / b.rAU - 1 / b.el.a));
    rows = [['До Солнца', `${fmt(b.rAU, 3)} а.е.`], ['Скорость', `${fmt(v, 1)} км/с`], ...b.info];
  } else if (b.kind === 'comet') {
    const v = 29.7847 * Math.sqrt(Math.max(0, 2 / b.rAU - 1 / b.el.a));
    rows = [['До Солнца', `${fmt(b.rAU, 3)} а.е.`], ['Скорость', `${fmt(v, 1)} км/с`], ...b.info];
  } else rows = b.info || [];
  cardEl.innerHTML = `<div class="card-h"><i style="--c:${b.flat}"></i><div><b>${b.name}</b><span>${b.type}</span></div></div>` +
    `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
let lastDateKey = '';
function updateHud() {
  const d = new Date(J2000 + simDay * 864e5);
  const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  if (key !== lastDateKey) { lastDateKey = key; $('date').textContent = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} г.`; }
  if (rateDirty) {
    rateDirty = false;
    $('rate').textContent = paused ? 'пауза' : `${fmtSpeed(speed)} · год Земли за ${fmt(365.25 / speed, 365.25 / speed < 10 ? 1 : 0)} с`;
    // честная оговорка: луны и суточное вращение ограничены по скорости, иначе мелькают
    const slow = speed / 0.4;
    $('slow').textContent = !paused && slow > 1.05 ? `луны замедлены ×${fmt(slow, slow < 10 ? 1 : 0)}` : '';
  }
  const gen = $('gen');
  if (texQueue.length) gen.textContent = `рельеф поверхностей ${Math.round(100 * texDone / texTotal)}%`;
  else if (gen.textContent) gen.textContent = '';
}

// ---------- мышь, касания, клавиатура
const pointers = new Map();
let dragging = false, moved = 0, pinchD = 0, lastInteract = -10;
const pinchDist = () => { const p = [...pointers.values()]; return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };
canvas.addEventListener('pointerdown', e => {
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* нет захвата — не критично */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) moved = 0;
  heroAnim = false;
  dragging = true; canvas.classList.add('dragging');
  pinchD = pointers.size === 2 ? pinchDist() : 0;
  lastInteract = time;
});
canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1) {
    cam.yaw -= dx * 0.0055;
    cam.pitch = clamp(cam.pitch + dy * 0.0045, -1.45, 1.45);
    moved += Math.abs(dx) + Math.abs(dy);
  } else if (pointers.size === 2) {
    const d = pinchDist();
    if (pinchD > 0 && d > 0) { cam.distT = clampDist(cam.distT * pinchD / d); syncZoom(); intro = false; }
    pinchD = d; moved += 10;
  }
  lastInteract = time;
});
function pointerEnd(e) {
  if (!pointers.has(e.pointerId)) return;
  if (pointers.size === 1 && moved < 6 && e.type === 'pointerup') pick(e.clientX, e.clientY);
  pointers.delete(e.pointerId);
  if (pointers.size === 0) { dragging = false; canvas.classList.remove('dragging'); }
  pinchD = pointers.size === 2 ? pinchDist() : 0;
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cam.distT = clampDist(cam.distT * Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0012)));
  intro = false; lastInteract = time;
  syncZoom();
}, { passive: false });
function pick(x, y) {
  let best = null, bd = 1e9;
  for (const b of [sun, ...planets, ...moons, comet]) {
    if (!b.vis) continue;
    const d = Math.hypot(b.sx - x, b.sy - y), lim = Math.max(b.sr * (b.ring ? 1.7 : 1) + 6, 14);
    if (d < lim && d - (b.kind === 'moon' ? 4 : 0) < bd) { bd = d; best = b; }
  }
  if (best) setFocus(best);
}
window.addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || (e.target.tagName === 'BUTTON' && e.code === 'Space'))) return;
  if (e.code === 'Space') { paused = !paused; syncToggles(); e.preventDefault(); }
  else if (e.key >= '0' && e.key <= '9') setFocus(FOCUSABLE[+e.key]);
  else if (e.key === 'Escape') setFocus(sun);
});
window.addEventListener('resize', resize);

// ============================================================ цикл
let last = performance.now(), frameMs = 8, hudT = 0, cardT = 0, firstFrames = 0;
function loop(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;
  time += dt;
  if (texQueue.length) pumpTextures(firstFrames < 2 ? 40 : 11);
  firstFrames++;
  if (!paused) {
    simDay += dt * speed;
    moonDay += dt * Math.min(speed, 0.4);  // луны и суточное вращение ограничены по скорости,
    spinDay += dt * Math.min(speed, 0.05); // иначе при ускорении времени превращаются в стробоскоп
    cloudT += dt;
  }
  const ease = 1 - Math.exp(-dt * 6);
  orbitsA = lerp(orbitsA, showOrbits ? 1 : 0, ease);
  trailsA = lerp(trailsA, showTrails ? 1 : 0, ease);
  labelsA = lerp(labelsA, showLabels ? 1 : 0, ease);

  updateWorld();
  updateCamera(dt);
  sphereMs = 0;
  render();
  // адаптивное разрешение попиксельных сфер: держим их JS-стоимость в бюджете кадра
  frameMs = lerp(frameMs, sphereMs, 0.1);
  if (frameMs > 12) quality = Math.max(0.45, quality - 0.02);
  else if (frameMs < 7.5) quality = Math.min(1, quality + 0.01);

  hudT += dt; cardT += dt;
  if (hudT > 0.1) { hudT = 0; updateHud(); }
  if (cardT > 0.3) { cardT = 0; updateCard(); if (intro) syncZoom(); }
  requestAnimationFrame(loop);
}

// ============================================================ старт
resize();
buildSprites();
buildSky();
readDist();
readSpeed();
syncToggles();
setFocus(sun);
cam.dist = 900; intro = true; cam.distT = 210;
syncZoom();
updateHud();
requestAnimationFrame(loop);
})();
