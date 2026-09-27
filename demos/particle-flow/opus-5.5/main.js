/* Поток частиц 3D — Claude Opus 5.5
 *
 * Canvas 2D без WebGL: вся картинка считается программно во float-буферах.
 *   Поле скоростей: curl-noise (сетка 40³, плавный морфинг между ключевыми кадрами)
 *                   + сферический вихрь Хилла (фонтан через ось, возврат по краям)
 *                   + закрутка вокруг вертикальной оси.
 *   Частицы: «чернильные» струи от блуждающих эмиттеров, заполняющий объём, дальняя пыль.
 *   Рендер: HDR-накопление штрихов (motion blur) с экспоненциальным затуханием следов,
 *           дымка и расфокус в четвертьразрешении с диффузией, двухуровневое свечение,
 *           атмосферная перспектива, автоэкспозиция, тональная кривая ACES, зерно, виньетка.
 */
(function () {
  'use strict';

  /* ═════════════════════════ утилиты ═════════════════════════ */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  const rnd = Math.random;
  function gauss() {
    let u = rnd();
    if (u < 1e-9) u = 1e-9;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * rnd());
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ═════════════════════════ шум Перлина ═════════════════════════ */
  const PERM = new Uint8Array(512);
  (function () {
    const r = mulberry32(0x2f6b1d3);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  })();
  function grad(h, x, y, z) {
    h &= 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  function noise3(x, y, z) {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const P = PERM;
    const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z;
    const B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
    const x1 = x - 1, y1 = y - 1, z1 = z - 1;
    const n000 = grad(P[AA], x, y, z), n100 = grad(P[BA], x1, y, z);
    const n010 = grad(P[AB], x, y1, z), n110 = grad(P[BB], x1, y1, z);
    const n001 = grad(P[AA + 1], x, y, z1), n101 = grad(P[BA + 1], x1, y, z1);
    const n011 = grad(P[AB + 1], x, y1, z1), n111 = grad(P[BB + 1], x1, y1, z1);
    const a0 = n000 + u * (n100 - n000), a1 = n010 + u * (n110 - n010);
    const a2 = n001 + u * (n101 - n001), a3 = n011 + u * (n111 - n011);
    const b0 = a0 + v * (a1 - a0), b1 = a2 + v * (a3 - a2);
    return b0 + w * (b1 - b0);
  }
  function fbm(x, y, z) {
    return noise3(x, y, z) + 0.45 * noise3(x * 2.03 + 3.1, y * 2.03 - 1.7, z * 2.03 + 8.3);
  }

  /* ═════════════════════════ настройки ═════════════════════════ */
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const PIXEL_BUDGET = coarse ? 520000 : 900000;   // пикселей во внутреннем HDR-буфере
  const MAX_P = 160000;
  const K_DUST = 0, K_STREAM = 1, K_FILL = 2;

  const SPEED_0 = 0.1, SPEED_K = 2.0;   // скорость → позиция в палитре
  const COC_K = 1.25;         // сила расфокуса вне плоскости фокуса
  const HAZE_K = 0.14;        // доля энергии каждой частицы, уходящая в дымку
  const HAZE_GAIN = 0.075;    // масштаб дымки (≈1/16 — сохранение энергии при 4× даунсэмпле)
  const HAZE_TAU = 0.9;       // с, память дымки
  const BLOOM_S = 0.16, BLOOM_W = 0.22;  // узкое и широкое свечение
  const DUST_GAIN = 6;       // пылинка одна на свой пиксель — ей нужна своя яркость
  const EXPO_KEY = 0.36;      // автоэкспозиция: «энергетическая медиана» кадра → средние тона
  const FOG_R = 0.09, FOG_G = 0.14, FOG_B = 0.32;  // цвет атмосферной перспективы (линейный)

  let paletteIdx = 0, colorMode = 0, turbUser = 1, trailTau = 0.5;
  let autoRotate = true, paused = false;
  let targetCount = coarse ? 30000 : 60000;
  let activeCount = 0;
  let simTime = 0;

  /* ═════════════════════════ палитры ═════════════════════════ */
  const PALETTES = [
    { accent: '#ff8a4c', stops: [[0, '#1c2270'], [0.22, '#3a2bb0'], [0.42, '#8a30c0'], [0.6, '#e2437e'], [0.78, '#ff8a3c'], [1, '#ffe6b0']] },
    { accent: '#5ff0b4', stops: [[0, '#0b2a66'], [0.28, '#0f62b0'], [0.5, '#12b8b8'], [0.72, '#5ef0a0'], [0.88, '#d4ff9e'], [1, '#f6fff2']] },
    { accent: '#ff9a50', stops: [[0, '#0c2c78'], [0.3, '#2186e0'], [0.46, '#a8e0ff'], [0.55, '#ffe0b8'], [0.72, '#ff7a2a'], [0.88, '#ff3d1e'], [1, '#fff2c8']] },
  ];
  const PAL_N = 256;
  const PR = new Float32Array(PAL_N), PG = new Float32Array(PAL_N), PB = new Float32Array(PAL_N);
  const palLum = (t) => 0.11 + 0.62 * Math.pow(t, 1.15);
  const PL = new Float32Array(PAL_N);   // целевая яркость палитры — чтобы яркость пыли не зависела от цвета
  for (let i = 0; i < PAL_N; i++) PL[i] = palLum(i / (PAL_N - 1));
  const DUST_PI = 56;
  function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function hexToLin(h) {
    const n = parseInt(h.slice(1), 16);
    return [srgbToLin(((n >> 16) & 255) / 255), srgbToLin(((n >> 8) & 255) / 255), srgbToLin((n & 255) / 255)];
  }
  function buildPalette(idx) {
    const st = PALETTES[idx].stops.map((s) => [s[0], hexToLin(s[1])]);
    for (let i = 0; i < PAL_N; i++) {
      const t = i / (PAL_N - 1);
      let k = 0;
      while (k < st.length - 2 && t > st[k + 1][0]) k++;
      const a = st[k], b = st[k + 1];
      const u = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
      const r = a[1][0] + (b[1][0] - a[1][0]) * u;
      const g = a[1][1] + (b[1][1] - a[1][1]) * u;
      const bl = a[1][2] + (b[1][2] - a[1][2]) * u;
      // яркость растёт с «температурой», но холодные тона не проваливаются в черноту
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl + 1e-4;
      const want = palLum(t);
      const s = Math.pow(want / lum, 0.72);
      PR[i] = r * s; PG[i] = g * s; PB[i] = bl * s;
    }
  }

  /* ═════════════════════════ тональная кривая ═════════════════════════ */
  const TM_N = 16384, TM_MAX = 16, TM_SCALE = TM_N / TM_MAX;
  const TM = new Uint8Array(TM_N);
  for (let i = 0; i < TM_N; i++) {
    const x = i / TM_SCALE;
    let a = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);   // ACES (Нарковиц)
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    const v = a <= 0.0031308 ? 12.92 * a : 1.055 * Math.pow(a, 1 / 2.4) - 0.055;
    TM[i] = Math.round(v * 255);
  }

  /* ═════════════════════════ поле скоростей ═════════════════════════ */
  const GN = 40, GL = 1.45, GSTEP = (2 * GL) / (GN - 1), GINV = 1 / GSTEP;
  const GCELLS = GN * GN * GN, GLEN = GCELLS * 3, GSY = GN * 3, GSZ = GN * GN * 3, GMAX = GN - 1 - 1e-4;
  const NOISE_F = 1.05, KEY_PERIOD = 4.5, DUST_GS = 0.4;
  const pot = new Float32Array(GLEN);
  let keyA = new Float32Array(GLEN), keyB = new Float32Array(GLEN), keyC = new Float32Array(GLEN);
  const vel = new Float32Array(GLEN);
  let fieldNorm = 1, keyPhase = 0, bKey = 2, bPot = 0, bCurl = 0;

  // векторный потенциал ψ; у края объёма ослабляется, чтобы шум не выносил частицы наружу
  function potentialCell(c, key) {
    const i = c % GN, j = ((c / GN) | 0) % GN, k = (c / (GN * GN)) | 0;
    const x = -GL + i * GSTEP, y = -GL + j * GSTEP, z = -GL + k * GSTEP;
    const r = Math.sqrt(x * x + y * y + z * z);
    const att = 1 - 0.75 * smooth01((r - 0.95) / 0.5);
    const qx = x * NOISE_F, qy = y * NOISE_F, qz = z * NOISE_F, s = key * 0.55;
    const o = c * 3;
    pot[o] = att * fbm(qx + 11.3 + 0.6 * s, qy + 2.1 + 0.8 * s, qz + 5.7);
    pot[o + 1] = att * fbm(qx - 7.9 - 0.8 * s, qy + 31.7, qz - 3.3 + 0.6 * s);
    pot[o + 2] = att * fbm(qx + 19.1, qy - 23.5 - 0.6 * s, qz + 13.9 + 0.8 * s);
  }
  // скорость = rot ψ (центральные разности) — поле бездивергентно, частицы не слипаются в стоки
  function curlCell(c, out) {
    const i = c % GN, j = ((c / GN) | 0) % GN, k = (c / (GN * GN)) | 0;
    const ip = i < GN - 1 ? i + 1 : i, im = i > 0 ? i - 1 : i;
    const jp = j < GN - 1 ? j + 1 : j, jm = j > 0 ? j - 1 : j;
    const kp = k < GN - 1 ? k + 1 : k, km = k > 0 ? k - 1 : k;
    const ix = 1 / ((ip - im) * GSTEP), iy = 1 / ((jp - jm) * GSTEP), iz = 1 / ((kp - km) * GSTEP);
    const row = (k * GN + j) * GN;
    const xp = (row + ip) * 3, xm = (row + im) * 3;
    const yp = ((k * GN + jp) * GN + i) * 3, ym = ((k * GN + jm) * GN + i) * 3;
    const zp = ((kp * GN + j) * GN + i) * 3, zm = ((km * GN + j) * GN + i) * 3;
    const P = pot;
    const dzdy = (P[yp + 2] - P[ym + 2]) * iy, dydz = (P[zp + 1] - P[zm + 1]) * iz;
    const dxdz = (P[zp] - P[zm]) * iz, dzdx = (P[xp + 2] - P[xm + 2]) * ix;
    const dydx = (P[xp + 1] - P[xm + 1]) * ix, dxdy = (P[yp] - P[ym]) * iy;
    const o = c * 3;
    out[o] = (dzdy - dydz) * fieldNorm;
    out[o + 1] = (dxdz - dzdx) * fieldNorm;
    out[o + 2] = (dydx - dxdy) * fieldNorm;
  }
  function buildKeySync(key, out) {
    for (let c = 0; c < GCELLS; c++) potentialCell(c, key);
    for (let c = 0; c < GCELLS; c++) curlCell(c, out);
  }
  function blendField() {
    const s = smooth01(keyPhase), a = keyA, b = keyB, v = vel;
    for (let q = 0; q < GLEN; q++) v[q] = a[q] + (b[q] - a[q]) * s;
  }
  function initField() {
    fieldNorm = 1;
    buildKeySync(0, keyA);
    let s2 = 0, n = 0;
    for (let c = 0; c < GCELLS; c++) {
      const i = c % GN, j = ((c / GN) | 0) % GN, k = (c / (GN * GN)) | 0;
      const x = -GL + i * GSTEP, y = -GL + j * GSTEP, z = -GL + k * GSTEP;
      if (x * x + y * y + z * z < 1) {
        const o = c * 3;
        s2 += keyA[o] * keyA[o] + keyA[o + 1] * keyA[o + 1] + keyA[o + 2] * keyA[o + 2];
        n++;
      }
    }
    fieldNorm = n > 0 && s2 > 0 ? 1 / Math.sqrt(s2 / n) : 1;
    for (let q = 0; q < GLEN; q++) keyA[q] *= fieldNorm;
    buildKeySync(1, keyB);
    keyPhase = 0; bKey = 2; bPot = 0; bCurl = 0;
    blendField();
  }
  // следующий ключевой кадр строится понемногу каждый кадр — без рывков
  function updateField(simDt) {
    if (simDt <= 0) return;
    keyPhase += simDt / KEY_PERIOD;
    const potTarget = Math.min(GCELLS, Math.ceil(GCELLS * keyPhase / 0.75));
    while (bPot < potTarget) potentialCell(bPot++, bKey);
    if (bPot >= GCELLS) {
      const ct = Math.min(GCELLS, Math.ceil(GCELLS * (keyPhase - 0.75) / 0.15));
      while (bCurl < ct) curlCell(bCurl++, keyC);
    }
    if (keyPhase >= 1) {
      while (bPot < GCELLS) potentialCell(bPot++, bKey);
      while (bCurl < GCELLS) curlCell(bCurl++, keyC);
      const t = keyA; keyA = keyB; keyB = keyC; keyC = t;
      bKey++; bPot = 0; bCurl = 0;
      keyPhase -= 1;
      if (keyPhase >= 1) keyPhase = 0;
    }
    blendField();
  }

  /* ═════════════════════════ эмиттеры струй ═════════════════════════ */
  const NE = 6;
  const EX = new Float32Array(NE), EY = new Float32Array(NE), EZ = new Float32Array(NE);
  const EH = [-0.1, -0.05, 0, 0.05, 0.09, 0.13];            // оттенок струи
  const EW = [0.071, -0.093, 0.058, -0.064, 0.105, -0.047], EP = [0, 1.05, 2.09, 3.14, 4.19, 5.24];
  const EV = [0.083, 0.061, 0.117, 0.074, 0.097, 0.052], EQ = [0.3, 2.2, 4.1, 1.1, 5.4, 3.3];
  function updateEmitters(t) {
    for (let e = 0; e < NE; e++) {
      const az = t * EW[e] + EP[e];
      const el = -0.3 + 0.6 * Math.sin(t * EV[e] + EQ[e]);
      const rr = 0.6 + 0.18 * Math.sin(t * 0.05 * (e + 1) + e * 1.7);
      const ce = Math.cos(el);
      EX[e] = rr * ce * Math.cos(az); EY[e] = rr * Math.sin(el); EZ[e] = rr * ce * Math.sin(az);
    }
  }

  /* ═════════════════════════ частицы ═════════════════════════ */
  const px = new Float32Array(MAX_P), py = new Float32Array(MAX_P), pz = new Float32Array(MAX_P);
  const age = new Float32Array(MAX_P), life = new Float32Array(MAX_P), bri = new Float32Array(MAX_P);
  const tj = new Float32Array(MAX_P), spd = new Float32Array(MAX_P);
  const sxp = new Float32Array(MAX_P), syp = new Float32Array(MAX_P);
  const kind = new Uint8Array(MAX_P), pv = new Uint8Array(MAX_P);
  // вид частицы зависит от индекса: любая «первая N» выборка сохраняет пропорции
  for (let i = 0; i < MAX_P; i++) { const m = i % 50; kind[i] = m < 3 ? K_DUST : m < 36 ? K_STREAM : K_FILL; }

  function spawnFill(i) {
    let x, y, z;
    do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 0.96);
    px[i] = x; py[i] = y; pz[i] = z;
    life[i] = 5 + rnd() * 9;
    bri[i] = 0.25 + 0.3 * rnd();
    tj[i] = (rnd() - 0.5) * 0.12;
  }
  function spawnStream(i) {
    const e = (rnd() * NE) | 0;
    px[i] = EX[e] + gauss() * 0.035; py[i] = EY[e] + gauss() * 0.035; pz[i] = EZ[e] + gauss() * 0.035;
    life[i] = 4.5 + rnd() * 6.5;
    const u = rnd();   // тяжёлый хвост яркости: фон из тусклых нитей, поверх — яркие линии и искры
    bri[i] = u < 0.025 ? 5 + 3 * rnd() : u < 0.22 ? 1 + 1 * rnd() : 0.3 + 0.4 * rnd();
    tj[i] = EH[e] + (rnd() - 0.5) * 0.07;
  }
  function spawnDust(i) {
    const r0 = 1.25, r1 = 3.6;
    const rr = Math.cbrt(r0 * r0 * r0 + rnd() * (r1 * r1 * r1 - r0 * r0 * r0));
    const cz = rnd() * 2 - 1, ph = rnd() * 6.283185307179586, sz = Math.sqrt(1 - cz * cz);
    px[i] = rr * sz * Math.cos(ph); py[i] = rr * cz; pz[i] = rr * sz * Math.sin(ph);
    life[i] = 10 + rnd() * 12;
    bri[i] = 0.5 + 1.1 * rnd();
    tj[i] = (rnd() - 0.5) * 0.18;
  }
  function respawn(i) {
    const k = kind[i];
    if (k === K_STREAM) spawnStream(i); else if (k === K_FILL) spawnFill(i); else spawnDust(i);
    age[i] = 0; pv[i] = 0; spd[i] = 0.3;
  }
  // добавленные частицы рождаются рядом с уже живущими — без вспышки у эмиттеров
  function spawnClone(i, pool) {
    respawn(i);
    const k = kind[i];
    for (let t = 0; t < 16; t++) {
      const j = (rnd() * pool) | 0;
      if (kind[j] !== k) continue;
      px[i] = px[j] + gauss() * 0.012; py[i] = py[j] + gauss() * 0.012; pz[i] = pz[j] + gauss() * 0.012;
      spd[i] = spd[j]; tj[i] = tj[j];
      return;
    }
  }
  function setActive(n) {
    n = clamp(Math.round(n), 2000, MAX_P);
    if (n > activeCount) {
      const pool = activeCount;
      for (let i = activeCount; i < n; i++) { if (pool > 2000) spawnClone(i, pool); else respawn(i); }
    }
    activeCount = n;
  }
  const PREWARM = 7;
  function initParticles(n) {
    for (let i = 0; i < n; i++) {
      respawn(i);
      if (kind[i] === K_STREAM) {
        // стартуем равномерно в объёме и быстро «перерождаемся» у эмиттеров во время прогрева
        let x, y, z;
        do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 0.96);
        px[i] = x; py[i] = y; pz[i] = z;
        age[i] = Math.max(0, life[i] - rnd() * PREWARM * 1.1);
      } else {
        age[i] = rnd() * life[i];
      }
    }
    activeCount = n;
  }

  /* ═════════════════════════ камера ═════════════════════════ */
  const cam = {
    yaw: 0.6, pitchOff: 0, zoom: 1, zoomTarget: 1, yawVel: 0, pitchVel: 0, t: 0,
    x: 0, y: 0, z: 3, fx: 0, fy: 0, fz: -1, rx: 1, rz: 0, ux: 0, uy: 1, uz: 0, dist: 3.35,
  };
  let dragging = false;
  function updateCamera(dt) {
    let moving = dragging;
    if (!paused) {
      cam.t += dt;
      if (autoRotate) cam.yaw += dt * 0.075;
    }
    if (!dragging && (Math.abs(cam.yawVel) > 1e-3 || Math.abs(cam.pitchVel) > 1e-3)) {
      cam.yaw += cam.yawVel * dt;
      cam.pitchOff = clamp(cam.pitchOff + cam.pitchVel * dt, -1.1, 1.1);
      const k = Math.exp(-dt * 3.5);
      cam.yawVel *= k; cam.pitchVel *= k;
      moving = true;
    }
    const dz = cam.zoomTarget - cam.zoom;
    if (Math.abs(dz) > 1e-4) { cam.zoom += dz * (1 - Math.exp(-dt * 8)); moving = true; }

    const pitch = clamp(0.3 + 0.1 * Math.sin(cam.t * 0.06) + cam.pitchOff, -1.3, 1.3);
    const dist = 3.35 * cam.zoom * (1 + 0.035 * Math.sin(cam.t * 0.045));
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    cam.x = dist * cp * sy; cam.y = dist * sp; cam.z = dist * cp * cy;
    cam.fx = -cam.x / dist; cam.fy = -cam.y / dist; cam.fz = -cam.z / dist;
    const rl = Math.hypot(cam.fz, cam.fx) || 1;
    cam.rx = -cam.fz / rl; cam.rz = cam.fx / rl;                   // right = F × up
    cam.ux = -cam.rz * cam.fy;                                       // up = right × F
    cam.uy = cam.rz * cam.fx - cam.rx * cam.fz;
    cam.uz = cam.rx * cam.fy;
    cam.dist = dist;
    return moving;
  }

  /* ═════════════════════════ холст и буферы ═════════════════════════ */
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d', { alpha: false });
  const sCanvas = document.createElement('canvas');
  const sctx = sCanvas.getContext('2d');
  let DW = 1, DH = 1, W = 64, H = 64, QW = 16, QH = 16, focal = 100;
  const gCanvas = document.createElement('canvas');
  const gctx = gCanvas.getContext('2d');
  let acc, dCur, dLast, bS, bW, tmpQ, hz, img, out32, gImg, gOut32;
  let bgGrad = null, vignGrad = null, grainPattern = null;
  let needsRedraw = true;

  function resize() {
    const cw = Math.max(1, window.innerWidth || 1), ch = Math.max(1, window.innerHeight || 1);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    DW = Math.max(1, Math.round(cw * dpr)); DH = Math.max(1, Math.round(ch * dpr));
    canvas.width = DW; canvas.height = DH;
    const sc = Math.min(dpr, Math.sqrt(PIXEL_BUDGET / (cw * ch)));
    W = Math.max(64, Math.round((cw * sc) / 4) * 4);
    H = Math.max(64, Math.round((ch * sc) / 4) * 4);
    QW = W >> 2; QH = H >> 2;
    const qn = QW * QH * 3;
    acc = new Float32Array(W * H * 3);
    dCur = new Float32Array(qn); dLast = new Float32Array(qn);
    bS = new Float32Array(qn); bW = new Float32Array(qn); tmpQ = new Float32Array(qn);
    hz = new Float32Array(qn);
    sCanvas.width = W; sCanvas.height = H;
    img = sctx.createImageData(W, H);
    out32 = new Uint32Array(img.data.buffer);
    gCanvas.width = QW; gCanvas.height = QH;
    gImg = gctx.createImageData(QW, QH);
    gOut32 = new Uint32Array(gImg.data.buffer);
    focal = Math.min(W, H) * 1.06;

    const cx = DW * 0.5, cyy = DH * 0.485, R = Math.hypot(DW, DH) * 0.5;
    bgGrad = ctx.createRadialGradient(cx, cyy, 0, cx, cyy, R);
    bgGrad.addColorStop(0, '#0c1128');
    bgGrad.addColorStop(0.5, '#060917');
    bgGrad.addColorStop(1, '#010207');
    vignGrad = ctx.createRadialGradient(cx, cyy, R * 0.42, cx, cyy, R * 1.05);
    vignGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vignGrad.addColorStop(1, 'rgba(0,0,0,0.62)');
    pv.fill(0);
    needsRedraw = true;
  }

  function makeGrain() {
    const g = document.createElement('canvas');
    g.width = g.height = 128;
    const gc = g.getContext('2d');
    const gi = gc.createImageData(128, 128);
    const d = gi.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = clamp(128 + gauss() * 42, 0, 255) | 0;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    gc.putImageData(gi, 0, 0);
    grainPattern = ctx.createPattern(g, 'repeat');
  }

  /* ═════════════════════════ симуляция + растеризация ═════════════════════════ */
  function simulate(simDt, frameDt, render) {
    updateEmitters(simTime);
    const n = activeCount, V = vel, t = simTime;
    const turb = turbUser * 0.22 * (0.85 + 0.3 * Math.sin(t * 0.071 + 1.3));
    const hill = 1.5 * 0.21 * (1 + 0.25 * Math.sin(t * 0.13 + 0.7));
    const swirl = 0.42 * (0.75 + 0.25 * Math.sin(t * 0.05 + 0.4));
    const dTurb = 0.1 * (0.6 + 0.4 * turbUser), dSwirl = 0.035;
    const spdK = Math.min(1, simDt * 3);

    const cX = cam.x, cY = cam.y, cZ = cam.z, fX = cam.fx, fY = cam.fy, fZ = cam.fz;
    const rX = cam.rx, rZ = cam.rz, uX = cam.ux, uY = cam.uy, uZ = cam.uz, fD = cam.dist;
    const foc = focal, ox = W * 0.5, oy = H * 0.485;
    const wLim = W - 1.001, hLim = H - 1.001;
    const A = acc, Z = hz, w3 = W * 3, Wd = W, QWd = QW, QHd = QH;
    const dec = Math.exp(-frameDt / trailTau);
    const headE = 1.5 * (1 - dec);          // «голова» неподвижной частицы ≈ 1.5× яркости штриха
    const byDepth = colorMode === 1;
    const fogNear = fD - 0.6, fogInv = 1 / 2.6;

    for (let i = 0; i < n; i++) {
      let x = px[i], y = py[i], z = pz[i];
      const kd = kind[i];
      let a = age[i];

      if (simDt > 0) {
        // ── трилинейная выборка curl-поля ──
        const isDust = kd === K_DUST;
        let gx = isDust ? x * DUST_GS : x, gy = isDust ? y * DUST_GS : y, gz = isDust ? z * DUST_GS : z;
        gx = (gx + GL) * GINV; gx = gx < 0 ? 0 : gx > GMAX ? GMAX : gx;
        gy = (gy + GL) * GINV; gy = gy < 0 ? 0 : gy > GMAX ? GMAX : gy;
        gz = (gz + GL) * GINV; gz = gz < 0 ? 0 : gz > GMAX ? GMAX : gz;
        const ix = gx | 0, iy = gy | 0, iz = gz | 0;
        const fx = gx - ix, fy = gy - iy, fz = gz - iz;
        const b0 = ((iz * GN + iy) * GN + ix) * 3, b1 = b0 + GSY, b2 = b0 + GSZ, b3 = b2 + GSY;
        let p0 = V[b0] + (V[b0 + 3] - V[b0]) * fx, p1 = V[b1] + (V[b1 + 3] - V[b1]) * fx;
        let p2 = V[b2] + (V[b2 + 3] - V[b2]) * fx, p3 = V[b3] + (V[b3 + 3] - V[b3]) * fx;
        p0 += (p1 - p0) * fy; p2 += (p3 - p2) * fy;
        const nx = p0 + (p2 - p0) * fz;
        p0 = V[b0 + 1] + (V[b0 + 4] - V[b0 + 1]) * fx; p1 = V[b1 + 1] + (V[b1 + 4] - V[b1 + 1]) * fx;
        p2 = V[b2 + 1] + (V[b2 + 4] - V[b2 + 1]) * fx; p3 = V[b3 + 1] + (V[b3 + 4] - V[b3 + 1]) * fx;
        p0 += (p1 - p0) * fy; p2 += (p3 - p2) * fy;
        const ny = p0 + (p2 - p0) * fz;
        p0 = V[b0 + 2] + (V[b0 + 5] - V[b0 + 2]) * fx; p1 = V[b1 + 2] + (V[b1 + 5] - V[b1 + 2]) * fx;
        p2 = V[b2 + 2] + (V[b2 + 5] - V[b2 + 2]) * fx; p3 = V[b3 + 2] + (V[b3 + 5] - V[b3 + 2]) * fx;
        p0 += (p1 - p0) * fy; p2 += (p3 - p2) * fy;
        const nz = p0 + (p2 - p0) * fz;

        let vx, vy, vz;
        if (isDust) {
          vx = nx * dTurb - z * dSwirl; vy = ny * dTurb * 0.6; vz = nz * dTurb + x * dSwirl;
        } else {
          // вихрь Хилла: подъём по оси, растекание сверху, возврат по краям сферы
          const r2 = x * x + z * z, y2 = y * y, d2 = r2 + y2;
          let hx = hill * y * x, hy = hill * (1 - 2 * r2 - y2), hz = hill * y * z;
          const sw = swirl * (0.8 + 0.35 * y);
          let wx = -z * sw, wz = x * sw;
          vx = nx * turb; vy = ny * turb; vz = nz * turb;
          if (d2 > 1) {
            const d = Math.sqrt(d2), f = Math.exp((1 - d2) * 3), pull = ((d - 1) * 1.8) / d;
            hx *= f; hy *= f; hz *= f; wx *= f; wz *= f;
            vx -= x * pull; vy -= y * pull; vz -= z * pull;
          }
          vx += hx + wx; vy += hy; vz += hz + wz;
        }
        x += vx * simDt; y += vy * simDt; z += vz * simDt;
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        spd[i] += (sp - spd[i]) * spdK;
        a += simDt;
        const dd = x * x + y * y + z * z;
        if (a > life[i] || dd > (isDust ? 16 : 3.4)) {
          respawn(i);
          x = px[i]; y = py[i]; z = pz[i]; a = 0;
        } else {
          px[i] = x; py[i] = y; pz[i] = z; age[i] = a;
        }
      }
      if (!render) continue;

      // ── проекция ──
      const qx = x - cX, qy = y - cY, qz = z - cZ;
      const zc = qx * fX + qy * fY + qz * fZ;
      if (zc < 0.2) { pv[i] = 0; continue; }
      const inv = foc / zc;
      const sx = ox + (qx * rX + qz * rZ) * inv;
      const sy = oy - (qx * uX + qy * uY + qz * uZ) * inv;

      let env = a * 1.7; if (env > 1) env = 1;
      const rem = (life[i] - a) * 0.75; if (rem < env) env = rem;
      if (env <= 0.002) { pv[i] = 0; continue; }

      // ── цвет: скорость или глубина, плюс атмосферная перспектива ──
      const isDust = kd === K_DUST;
      const ci = byDepth ? 0.5 + (fD - zc) * 0.42 + tj[i] * 0.5
        : isDust ? 0.22 + tj[i] * 1.5 : (spd[i] - SPEED_0) * SPEED_K + tj[i];
      let pi = (ci * 255) | 0; pi = pi < 0 ? 0 : pi > 255 ? 255 : pi;
      // быстрые («горячие») частицы ещё и ярче; одиночные пылинки — отдельная яркость
      const heat = isDust ? (DUST_GAIN * PL[DUST_PI]) / PL[pi] : 0.55 + pi * (0.9 / 255);
      let fog = (zc - fogNear) * fogInv; fog = fog < 0 ? 0 : fog > 1 ? 1 : fog;
      const fm = fog * 0.6;
      const cr = PR[pi] + (FOG_R - PR[pi]) * fm, cg = PG[pi] + (FOG_G - PG[pi]) * fm, cb = PB[pi] + (FOG_B - PB[pi]) * fm;
      let dg = fD / zc; dg = dg > 4 ? 2 : Math.sqrt(dg);
      const near = zc < 1.1 ? smooth01((zc - 0.25) / 0.85) : 1;   // у самой камеры — гасим
      const e = bri[i] * env * (1 - 0.6 * fog) * dg * heat * near;
      // ── глубина резкости: часть энергии уходит в размытый слой ──
      const cf = ((zc - fD) / zc) * COC_K;
      const sharp = 1 / (1 + cf * cf);

      let x0 = sx, y0 = sy, len = 0;
      if (pv[i] === 1) {
        x0 = sxp[i]; y0 = syp[i];
        const ddx = sx - x0, ddy = sy - y0;
        len = Math.sqrt(ddx * ddx + ddy * ddy);
        if (len > 160) { len = 0; x0 = sx; y0 = sy; }
      }
      sxp[i] = sx; syp[i] = sy; pv[i] = 1;
      const eT = e * (len + headE);

      // резкий штрих: энергия на пиксель длины постоянна → честный motion blur
      const es = eT * sharp;
      if (es > 1e-6) {
        const ns = len > 1 ? Math.ceil(len) : 1;
        const per = es / ns, er = cr * per, eg = cg * per, eb = cb * per;
        const sdx = (sx - x0) / ns, sdy = (sy - y0) / ns;
        let qx2 = x0 + sdx, qy2 = y0 + sdy;
        for (let k = 0; k < ns; k++, qx2 += sdx, qy2 += sdy) {
          if (qx2 < 0 || qy2 < 0 || qx2 >= wLim || qy2 >= hLim) continue;
          const jx = qx2 | 0, jy = qy2 | 0, ux = qx2 - jx, uy = qy2 - jy;
          const w11 = ux * uy, w10 = ux - w11, w01 = uy - w11, w00 = 1 - ux - uy + w11;
          let o = (jy * Wd + jx) * 3;
          A[o] += er * w00; A[o + 1] += eg * w00; A[o + 2] += eb * w00;
          A[o + 3] += er * w10; A[o + 4] += eg * w10; A[o + 5] += eb * w10;
          o += w3;
          A[o] += er * w01; A[o + 1] += eg * w01; A[o + 2] += eb * w01;
          A[o + 3] += er * w11; A[o + 4] += eg * w11; A[o + 5] += eb * w11;
        }
      }
      // дымка + расфокус (четвертьразрешение)
      const eh = eT * (HAZE_K + (1 - sharp)) * HAZE_GAIN;
      if (eh > 1e-6) {
        const nh = len > 4 ? Math.ceil(len * 0.25) : 1;
        const per = eh / nh, er = cr * per, eg = cg * per, eb = cb * per;
        const hdx = ((sx - x0) * 0.25) / nh, hdy = ((sy - y0) * 0.25) / nh;
        let hx = x0 * 0.25 + hdx, hy = y0 * 0.25 + hdy;
        for (let k = 0; k < nh; k++, hx += hdx, hy += hdy) {
          if (hx < 0 || hy < 0 || hx >= QWd || hy >= QHd) continue;
          const o = ((hy | 0) * QWd + (hx | 0)) * 3;
          Z[o] += er; Z[o + 1] += eg; Z[o + 2] += eb;
        }
      }
    }
  }

  /* ═════════════════════════ постобработка ═════════════════════════ */
  function blurH(s, d, w, h, r) {
    const inv = 1 / (2 * r + 1), wm = w - 1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 3;
      let sr = 0, sg = 0, sb = 0;
      for (let k = -r; k <= r; k++) {
        const o = row + (k < 0 ? 0 : k > wm ? wm : k) * 3;
        sr += s[o]; sg += s[o + 1]; sb += s[o + 2];
      }
      for (let x = 0; x < w; x++) {
        const o = row + x * 3;
        d[o] = sr * inv; d[o + 1] = sg * inv; d[o + 2] = sb * inv;
        const xa = x + r + 1, xb = x - r;
        const ia = row + (xa > wm ? wm : xa) * 3, ib = row + (xb < 0 ? 0 : xb) * 3;
        sr += s[ia] - s[ib]; sg += s[ia + 1] - s[ib + 1]; sb += s[ia + 2] - s[ib + 2];
      }
    }
  }
  function blurV(s, d, w, h, r) {
    const inv = 1 / (2 * r + 1), hm = h - 1, st = w * 3;
    for (let x = 0; x < w; x++) {
      const col = x * 3;
      let sr = 0, sg = 0, sb = 0;
      for (let k = -r; k <= r; k++) {
        const o = col + (k < 0 ? 0 : k > hm ? hm : k) * st;
        sr += s[o]; sg += s[o + 1]; sb += s[o + 2];
      }
      for (let y = 0; y < h; y++) {
        const o = col + y * st;
        d[o] = sr * inv; d[o + 1] = sg * inv; d[o + 2] = sb * inv;
        const ya = y + r + 1, yb = y - r;
        const ia = col + (ya > hm ? hm : ya) * st, ib = col + (yb < 0 ? 0 : yb) * st;
        sr += s[ia] - s[ib]; sg += s[ia + 1] - s[ib + 1]; sb += s[ia + 2] - s[ib + 2];
      }
    }
  }
  function boxBlur(src, dst, tmp, w, h, r, iters) {
    let s = src;
    for (let it = 0; it < iters; it++) { blurH(s, tmp, w, h, r); blurV(tmp, dst, w, h, r); s = dst; }
  }

  let exposure = 1, logExp = 0, expoInit = false;
  const HB = 90, hist = new Float64Array(HB);
  // уровень, выше которого лежит половина всей световой энергии кадра, — устойчив к пустому фону
  function updateExposure(dt) {
    hist.fill(0);
    let nz = 0, tot = 0;
    const D = dLast, n = QW * QH * 3;
    for (let j = 0; j < n; j += 6) {
      const l = (D[j] * 0.2126 + D[j + 1] * 0.7152 + D[j + 2] * 0.0722) * 0.0625;
      if (l > 1e-5) {
        let b = ((Math.log2(l) + 16) * 3) | 0;
        b = b < 0 ? 0 : b > HB - 1 ? HB - 1 : b;
        hist[b] += l; tot += l; nz++;
      }
    }
    if (nz < 40) return;
    const want = tot * 0.5;
    let c = 0, b = HB - 1;
    for (; b > 0; b--) { c += hist[b]; if (c >= want) break; }
    const lv = Math.pow(2, (b + 0.5) / 3 - 16);
    const lt = Math.log(clamp(EXPO_KEY / lv, 0.02, 400));
    if (!expoInit) { logExp = lt; expoInit = true; }
    else logExp += (lt - logExp) * (1 - Math.exp(-dt / 0.9));
    exposure = Math.exp(logExp);
  }

  function postProcess(dt) {
    // 1) резкий слой: HDR-следы → ACES → пиксели; попутно даунсэмпл 4×4 и затухание следов
    const dec = Math.exp(-dt / trailTau);
    const exS = exposure * TM_SCALE, top = TM_N - 1, T = TM;
    const Ac = acc, O = out32, Dn = dCur, w = W, qw3 = QW * 3;
    const BLACK = 0xff000000 | 0;
    const cut = 3 / exS;          // ниже этого уровня пиксель всё равно чёрный — хвосты не храним
    Dn.fill(0);
    for (let y = 0; y < H; y++) {
      const dRow = (y >> 2) * qw3;
      let i = y * w, j = i * 3;
      for (let x = 0; x < w; x++, i++, j += 3) {
        const ar = Ac[j], ag = Ac[j + 1], ab = Ac[j + 2];
        if (ar + ag + ab < cut) {
          O[i] = BLACK;
          if (ar !== 0 || ag !== 0 || ab !== 0) { Ac[j] = 0; Ac[j + 1] = 0; Ac[j + 2] = 0; }
          continue;
        }
        const d = dRow + (x >> 2) * 3;
        Dn[d] += ar; Dn[d + 1] += ag; Dn[d + 2] += ab;
        Ac[j] = ar * dec; Ac[j + 1] = ag * dec; Ac[j + 2] = ab * dec;
        let ir = (ar * exS) | 0, ig = (ag * exS) | 0, ib = (ab * exS) | 0;
        if (ir > top) ir = top;
        if (ig > top) ig = top;
        if (ib > top) ib = top;
        O[i] = BLACK | (T[ib] << 16) | (T[ig] << 8) | T[ir];
      }
    }
    sctx.putImageData(img, 0, 0);

    // 2) свечение (узкое + широкое) и дымка в четвертьразрешении
    boxBlur(Dn, bS, tmpQ, QW, QH, 2, 1);
    boxBlur(bS, bW, tmpQ, QW, QH, 7, 1);
    boxBlur(hz, hz, tmpQ, QW, QH, 1, 1);
    const hd = Math.exp(-dt / HAZE_TAU), ks = BLOOM_S / 16, kw = BLOOM_W / 16;
    const G = gOut32, Hz = hz, S = bS, Wb = bW, qn = QW * QH;
    for (let p = 0, j = 0; p < qn; p++, j += 3) {
      let h0 = Hz[j] * hd, h1 = Hz[j + 1] * hd, h2 = Hz[j + 2] * hd;
      if (h0 + h1 + h2 < 1e-6) { h0 = 0; h1 = 0; h2 = 0; }
      Hz[j] = h0; Hz[j + 1] = h1; Hz[j + 2] = h2;
      let ir = ((S[j] * ks + Wb[j] * kw + h0) * exS) | 0;
      let ig = ((S[j + 1] * ks + Wb[j + 1] * kw + h1) * exS) | 0;
      let ib = ((S[j + 2] * ks + Wb[j + 2] * kw + h2) * exS) | 0;
      if (ir > top) ir = top;
      if (ig > top) ig = top;
      if (ib > top) ib = top;
      G[p] = BLACK | (T[ib] << 16) | (T[ig] << 8) | T[ir];
    }
    gctx.putImageData(gImg, 0, 0);
    const t = dLast; dLast = dCur; dCur = t;
  }

  function composite() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, DW, DH);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sCanvas, 0, 0, DW, DH);
    // свечение складывается «экраном» — близко к сложению в HDR до тональной кривой
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(gCanvas, 0, 0, DW, DH);
    if (grainPattern) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.11;
      const gx = (rnd() * 128) | 0, gy = (rnd() * 128) | 0;
      ctx.setTransform(1, 0, 0, 1, -gx, -gy);
      ctx.fillStyle = grainPattern;
      ctx.fillRect(gx, gy, DW, DH);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = vignGrad;
    ctx.fillRect(0, 0, DW, DH);
  }

  /* ═════════════════════════ интерфейс ═════════════════════════ */
  const $ = (id) => document.getElementById(id);
  const ui = {
    stats: $('stats'), pause: $('btnPause'), cam: $('btnCam'),
    rTurb: $('rTurb'), oTurb: $('oTurb'), rTrail: $('rTrail'), oTrail: $('oTrail'),
    rCount: $('rCount'), oCount: $('oCount'),
  };
  const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
  const tauFromSlider = (v) => 0.06 * Math.pow(20, v);
  const sliderFromTau = (t) => Math.log(t / 0.06) / Math.log(20);

  function bindSeg(id, fn) {
    const el = $(id);
    const btns = Array.prototype.slice.call(el.querySelectorAll('button'));
    const set = (v) => btns.forEach((b) => b.classList.toggle('on', +b.dataset.v === v));
    btns.forEach((b) => b.addEventListener('click', () => { const v = +b.dataset.v; set(v); fn(v); }));
    return set;
  }
  function applyPalette(i) {
    paletteIdx = i;
    buildPalette(i);
    document.documentElement.style.setProperty('--accent', PALETTES[i].accent);
    needsRedraw = true;
  }
  const setPalSeg = bindSeg('segPal', applyPalette);
  const setColorSeg = bindSeg('segColor', (v) => { colorMode = v; needsRedraw = true; });

  function syncLabels() {
    ui.oTurb.textContent = '×' + turbUser.toFixed(2);
    ui.oTrail.textContent = trailTau.toFixed(2) + ' с';
    ui.oCount.textContent = fmtInt(targetCount);
  }
  ui.rTurb.value = String(turbUser);
  ui.rTrail.value = sliderFromTau(trailTau).toFixed(2);
  ui.rCount.value = String(targetCount);
  ui.rTurb.addEventListener('input', () => { turbUser = +ui.rTurb.value; syncLabels(); });
  ui.rTrail.addEventListener('input', () => { trailTau = tauFromSlider(+ui.rTrail.value); syncLabels(); });
  ui.rCount.addEventListener('input', () => {
    targetCount = +ui.rCount.value;
    if (activeCount > targetCount) activeCount = targetCount; else setActive(targetCount);
    syncLabels();
  });
  function setPaused(p) {
    paused = p;
    ui.pause.textContent = p ? 'Пуск' : 'Пауза';
    ui.pause.classList.toggle('on', p);
  }
  ui.pause.addEventListener('click', () => setPaused(!paused));
  ui.cam.addEventListener('click', () => { autoRotate = !autoRotate; ui.cam.classList.toggle('on', autoRotate); });

  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT' && e.code !== 'Space') return;
    if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
    else if (e.code === 'KeyH') document.body.classList.toggle('ui-off');
    else if (e.code === 'KeyC') { colorMode = 1 - colorMode; setColorSeg(colorMode); needsRedraw = true; }
    else if (e.code === 'KeyP') { const i = (paletteIdx + 1) % PALETTES.length; applyPalette(i); setPalSeg(i); }
    else if (e.code === 'KeyR') { cam.zoomTarget = 1; cam.pitchOff = 0; cam.yawVel = 0; cam.pitchVel = 0; }
  });

  // вращение камеры мышью / пальцем, инерция, зум колесом
  let lastX = 0, lastY = 0, lastMoveT = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY; lastMoveT = performance.now();
    cam.yawVel = 0; cam.pitchVel = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* не критично */ }
    canvas.classList.add('grabbing');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const now = performance.now(), dtm = Math.max(8, now - lastMoveT) / 1000;
    lastMoveT = now;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    const dyaw = -dx * 0.0055, dpit = dy * 0.0045;
    cam.yaw += dyaw;
    cam.pitchOff = clamp(cam.pitchOff + dpit, -1.1, 1.1);
    cam.yawVel = cam.yawVel * 0.5 + (dyaw / dtm) * 0.5;
    cam.pitchVel = cam.pitchVel * 0.5 + (dpit / dtm) * 0.5;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (performance.now() - lastMoveT > 90) { cam.yawVel = 0; cam.pitchVel = 0; }
    canvas.classList.remove('grabbing');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    cam.zoomTarget = clamp(cam.zoomTarget * Math.exp(dy * 0.001), 0.55, 1.8);
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { cam.zoomTarget = 1; cam.pitchOff = 0; cam.yawVel = 0; cam.pitchVel = 0; });
  window.addEventListener('resize', resize);

  /* ═════════════════════════ цикл ═════════════════════════ */
  let lastT = 0, runTime = 0, workAvg = 10, govT = 0, fpsFrames = 0, fpsT = 0;
  function governor(work, dt) {
    workAvg += (work - workAvg) * 0.1;
    govT += dt;
    if (govT < 0.5 || runTime < 2) return;
    govT = 0;
    if (workAvg > 20 && activeCount > targetCount * 0.25) setActive(Math.max(targetCount * 0.25, activeCount * 0.86));
    else if (workAvg < 12 && activeCount < targetCount) setActive(Math.min(targetCount, activeCount * 1.1 + 1500));
  }

  function frame(now) {
    requestAnimationFrame(frame);
    let raw = lastT ? (now - lastT) / 1000 : 1 / 60;
    lastT = now;
    if (!(raw > 0)) raw = 1 / 60;
    const dt = raw > 0.05 ? 0.05 : raw;      // кламп большого шага (вкладка в фоне, лаг)
    runTime += dt;

    if (raw < 1) { fpsFrames++; fpsT += raw; }
    if (fpsT >= 0.5) {
      ui.stats.textContent = Math.round(fpsFrames / fpsT) + ' fps · ' + fmtInt(activeCount) + ' частиц';
      fpsFrames = 0; fpsT = 0;
    }

    const moving = updateCamera(dt);
    if (paused && !moving && !needsRedraw) return;
    needsRedraw = false;

    const simDt = paused ? 0 : dt;
    const t0 = performance.now();
    if (simDt > 0) { simTime += simDt; updateField(simDt); }
    simulate(simDt, dt, true);
    postProcess(dt);
    updateExposure(dt);
    governor(performance.now() - t0, dt);
    composite();
  }

  /* ═════════════════════════ старт ═════════════════════════ */
  applyPalette(0);
  syncLabels();
  initField();
  resize();
  makeGrain();
  updateCamera(0);
  initParticles(targetCount);
  // прогрев: струи успевают развиться до первого кадра
  for (let s = 0; s < PREWARM / 0.1; s++) {
    simTime += 0.1;
    updateField(0.1);
    simulate(0.1, 0.1, false);
  }
  requestAnimationFrame(frame);
})();
