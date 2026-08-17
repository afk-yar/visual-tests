/* ===========================================================
   Аквариум с рыбами — Claude Opus 5
   Canvas 2D, без библиотек, без WebGL.
   =========================================================== */
'use strict';
(function () {

  /* ---------------- утилиты ---------------- */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = t => t * t * (3 - 2 * t);

  let _seed = 20260816;
  function rnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
  function rr(a, b) { return a + (b - a) * rnd(); }
  function ri(a, b) { return Math.floor(a + (b - a + 1) * rnd()); }

  // быстрый синус по таблице (каустика, волны тела)
  const SN = 4096, SINT = new Float32Array(SN);
  for (let i = 0; i < SN; i++) SINT[i] = Math.sin(i / SN * TAU);
  const SK = SN / TAU;
  function fsin(x) { return SINT[((x * SK) | 0) & (SN - 1)]; }

  // мягкий шум для блуждания
  function h1(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
  function vn(x) { const i = Math.floor(x), f = x - i; return lerp(h1(i), h1(i + 1), sstep(f)); }
  function fbm(x) { return vn(x) * 0.56 + vn(x * 2.13 + 11.3) * 0.29 + vn(x * 4.7 + 5.1) * 0.15; }

  const cs = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function angDiff(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }

  /* ---------------- холст ---------------- */
  const cv = document.getElementById('scene');
  const ctx = cv.getContext('2d', { alpha: false });
  let W = 1, H = 1, DPR = 1, DPRCAP = 2;

  // проекция глубины: sc(z) — перспективный масштаб, HOR — линия схода, FY — высота камеры над дном
  let HOR = 0, FY = 0, CX = 0;
  const scaleAt = z => 1 / (0.55 + 1.9 * z);
  const floorYAt = z => HOR + FY * scaleAt(z);

  /* ---------------- цвет воды ---------------- */
  const WATER = [
    [0.00, [56, 146, 156]],
    [0.12, [32, 112, 134]],
    [0.32, [16, 78, 106]],
    [0.56, [10, 54, 80]],
    [0.80, [9, 42, 63]],
    [1.00, [12, 39, 55]]
  ];
  function waterAt(f) {
    f = clamp(f, 0, 1);
    for (let i = 1; i < WATER.length; i++) {
      if (f <= WATER[i][0]) {
        const a = WATER[i - 1], b = WATER[i];
        const t = (f - a[0]) / (b[0] - a[0] || 1);
        return mixc(a[1], b[1], t);
      }
    }
    return WATER[WATER.length - 1][1];
  }

  /* ---------------- настройки ---------------- */
  const cfg = { fish: 1, light: 1, haze: 1, flow: 1, paused: false };
  const quality = { blur: true, causticStep: 1, snow: 1 };

  /* ---------------- каустика ---------------- */
  function causticAt(x, y, t) {
    const s = (y - HOR) / FY;
    if (s <= 0.14) return 0;
    const wd = 1 / s;
    const wx = (x - CX) / (s * H);
    const p = wx * 24, q = wd * 10, dr = t * 0.5;
    const w = fsin(p * 0.9 + q * 0.14 + dr)
      + fsin(q * 1.02 - p * 0.22 - dr * 0.83)
      + fsin((p + q) * 0.61 + dr * 1.21)
      + fsin((p - q) * 0.77 - dr * 0.62);
    let v = 1 - Math.abs(w) * 0.5; if (v < 0) v = 0;
    v *= v; v *= v;
    const w2 = fsin(p * 2.05 + q * 0.42 - dr * 1.4)
      + fsin(q * 2.3 + p * 0.5 + dr * 1.08)
      + fsin((p + q) * 1.55 - dr * 0.9);
    let v2 = 1 - Math.abs(w2) * 0.63; if (v2 < 0) v2 = 0;
    v2 = v2 * v2 * v2;
    return v * 0.9 + v2 * 0.32;
  }

  const caus = { cv: null, ctx: null, img: null, buf: null, w: 200, h: 76, y0: 0, ready: false, tick: 0 };
  function initCaustics() {
    if (!caus.cv) {
      caus.cv = document.createElement('canvas');
      caus.cv.width = caus.w; caus.cv.height = caus.h;
      caus.ctx = caus.cv.getContext('2d');
    }
    caus.img = caus.ctx.createImageData(caus.w, caus.h);
    caus.buf = new Uint32Array(caus.img.data.buffer);
    caus.ready = true;
  }
  function updateCaustics(t) {
    if (!caus.ready) return;
    const y0 = HOR + FY * 0.16, y1 = H * 1.02;
    caus.y0 = y0; caus.y1 = y1;
    const buf = caus.buf, cw = caus.w, ch = caus.h;
    let i = 0;
    for (let j = 0; j < ch; j++) {
      const sy = y0 + (j + 0.5) / ch * (y1 - y0);
      // вертикальный набор яркости: у горизонта каустика тонет в дымке
      const fade = clamp((sy - y0) / (H * 0.13), 0, 1);
      const fade2 = fade * fade * (0.55 + 0.45 * fade);
      for (let k = 0; k < cw; k++, i++) {
        const sx = (k + 0.5) / cw * W;
        let v = causticAt(sx, sy, t) * fade2;
        if (v <= 0.004) { buf[i] = 0; continue; }
        if (v > 1) v = 1;
        const a = (v * 235) | 0;
        buf[i] = (a << 24) | (196 << 16) | (240 << 8) | 255; // ABGR: тёплый белый
      }
    }
    caus.ctx.putImageData(caus.img, 0, 0);
  }

  /* ---------------- текстуры ---------------- */
  let texRay = null, texRay2 = null, texDot = null, texWarm = null, sandPat = null;

  function makeRayTex(w, h, coreSoft, tailStop) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const lg = g.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5 - coreSoft, 'rgba(255,255,255,0.55)');
    lg.addColorStop(0.5, 'rgba(255,255,255,1)');
    lg.addColorStop(0.5 + coreSoft, 'rgba(255,255,255,0.55)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
    const vg = g.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, 'rgba(0,0,0,1)');
    vg.addColorStop(0.30, 'rgba(0,0,0,0.72)');
    vg.addColorStop(tailStop, 'rgba(0,0,0,0.28)');
    vg.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    return c;
  }
  function makeDotTex(size, col) {
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    rg.addColorStop(0, cs(col, 1));
    rg.addColorStop(0.35, cs(col, 0.42));
    rg.addColorStop(0.7, cs(col, 0.09));
    rg.addColorStop(1, cs(col, 0));
    g.fillStyle = rg; g.fillRect(0, 0, size, size);
    return c;
  }
  function makeSandPattern() {
    const s = 128;
    const c = document.createElement('canvas'); c.width = s; c.height = s;
    const g = c.getContext('2d');
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 1900; i++) {
      const x = rnd() * s, y = rnd() * s, r = rr(0.35, 1.15);
      const l = rnd();
      g.fillStyle = l > 0.5
        ? 'rgba(255,244,214,' + (0.05 + rnd() * 0.16).toFixed(3) + ')'
        : 'rgba(24,20,14,' + (0.04 + rnd() * 0.13).toFixed(3) + ')';
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    return c;
  }

  /* ---------------- профили тел ---------------- */
  function mkProfile(raw, height) {
    let m = 0;
    for (let i = 0; i <= 64; i++) { const v = raw(i / 64); if (v > m) m = v; }
    const k = height / (m || 1);
    return u => raw(clamp(u, 0, 1)) * k;
  }
  const P_SLIM = u => Math.pow(u, 0.42) * Math.pow(1 - u * 0.93, 0.72);
  const P_SLIM_B = u => Math.pow(u, 0.36) * Math.pow(1 - u * 0.94, 0.82);
  const P_OVAL = u => Math.pow(u, 0.30) * Math.pow(1 - u * 0.95, 0.52);
  const P_OVAL_B = u => Math.pow(u, 0.27) * Math.pow(1 - u * 0.96, 0.62);
  const P_DISC = u => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.60)), 0.52) * (1 - 0.42 * u);
  const P_DISC_B = u => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.52)), 0.58) * (1 - 0.46 * u);
  const P_LONG = u => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.42)), 0.30) * (1 - 0.70 * u);
  const P_LONG_B = u => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.40)), 0.34) * (1 - 0.74 * u);

  const TAILS = {
    fork: [[0, 0.24], [0.44, 0.64], [1, 1.0], [0.60, 0.10], [1, -1.0], [0.44, -0.64], [0, -0.24]],
    deep: [[0, 0.20], [0.52, 0.72], [1, 1.02], [0.42, 0.05], [1, -1.02], [0.52, -0.72], [0, -0.20]],
    fan: [[0, 0.32], [0.42, 0.88], [0.84, 1.0], [1.0, 0.48], [1.06, 0], [1.0, -0.48], [0.84, -1.0], [0.42, -0.88], [0, -0.32]],
    lyre: [[0, 0.26], [0.5, 0.72], [1.0, 1.02], [0.78, 0.60], [0.30, 0.06], [0.78, -0.60], [1.0, -1.02], [0.5, -0.72], [0, -0.26]],
    veil: [[0, 0.30], [0.33, 0.86], [0.70, 1.0], [1.0, 0.74], [1.14, 0.26], [1.06, -0.22], [0.82, -0.70], [0.46, -0.96], [0.13, -0.62], [0, -0.30]],
    round: [[0, 0.34], [0.4, 0.92], [0.9, 0.72], [1.0, 0], [0.9, -0.72], [0.4, -0.92], [0, -0.34]]
  };

  /* ---------------- виды рыб ---------------- */
  const SPECIES = {};
  function defSpecies() {
    SPECIES.angel = {
      key: 'angel', len: 128, thick: 0.050, pivot: 0.44,
      top: mkProfile(P_DISC, 0.47), bot: mkProfile(P_DISC_B, 0.45),
      back: [206, 178, 112], mid: [238, 232, 214], belly: [252, 250, 244],
      finCol: [236, 226, 196], finA: 0.36, rayA: 0.20,
      amp: 0.030, waveK: 0.85, beat: 1.05, speed: 30, turn: 0.55, turnRate: 1.0,
      eye: { u: 0.115, b: 0.30, r: 0.055, iris: [40, 42, 52], ring: [214, 152, 60] },
      dorsal: { u0: 0.16, u1: 0.90, h: 0.92, shape: t => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.60)), 0.72), fil: 0.85 },
      anal: { u0: 0.30, u1: 0.94, h: 0.86, shape: t => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.70), fil: 0.75 },
      pelvic: { u: 0.35, len: 1.05, n: 2 },
      pect: { u: 0.28, b: -0.10, len: 0.20, h: 0.16, beat: 1.9 },
      tail: { pts: TAILS.lyre, len: 0.44, h: 0.46 },
      pattern: [
        { t: 'vband', u: 0.115, w: 0.052, slant: 0.05, col: [34, 38, 50], a: 0.68 },
        { t: 'vband', u: 0.40, w: 0.058, slant: 0.06, col: [34, 38, 50], a: 0.62 },
        { t: 'vband', u: 0.68, w: 0.050, slant: 0.05, col: [34, 38, 50], a: 0.55 },
        { t: 'vband', u: 0.93, w: 0.036, slant: 0.03, col: [34, 38, 50], a: 0.40 },
        { t: 'band', u0: 0.05, u1: 1.0, b0: 0.55, b1: 1.02, col: [222, 168, 74], a: 0.42 }
      ]
    };

    SPECIES.neon = {
      key: 'neon', len: 46, thick: 0.052, pivot: 0.45,
      top: mkProfile(P_SLIM, 0.165), bot: mkProfile(P_SLIM_B, 0.155),
      back: [26, 54, 86], mid: [150, 186, 200], belly: [232, 240, 244],
      finCol: [196, 226, 236], finA: 0.20, rayA: 0.12,
      amp: 0.085, waveK: 0.95, beat: 2.6, speed: 62, turn: 1.5, turnRate: 2.6,
      eye: { u: 0.13, b: 0.34, r: 0.075, iris: [22, 26, 34], ring: [186, 216, 224] },
      dorsal: { u0: 0.44, u1: 0.66, h: 0.16, shape: t => Math.sin(Math.PI * t) },
      anal: { u0: 0.62, u1: 0.86, h: 0.10, shape: t => Math.sin(Math.PI * t) },
      pect: { u: 0.26, b: -0.05, len: 0.13, h: 0.09, beat: 3.4 },
      tail: { pts: TAILS.fork, len: 0.30, h: 0.26 },
      pattern: [
        { t: 'band', u0: 0.10, u1: 0.99, b0: -0.10, b1: 0.52, col: [72, 216, 240], col2: [130, 244, 250], a: 0.85, glow: 1 },
        { t: 'band', u0: 0.50, u1: 1.0, b0: -0.95, b1: -0.05, col: [226, 62, 54], col2: [242, 118, 78], a: 0.82 }
      ],
      school: true
    };

    SPECIES.clown = {
      key: 'clown', len: 92, thick: 0.115, pivot: 0.44,
      top: mkProfile(P_OVAL, 0.315), bot: mkProfile(P_OVAL_B, 0.300),
      back: [212, 92, 24], mid: [246, 136, 40], belly: [252, 186, 104],
      finCol: [248, 148, 52], finA: 0.72, rayA: 0.22,
      amp: 0.052, waveK: 0.80, beat: 1.5, speed: 40, turn: 0.9, turnRate: 1.7,
      eye: { u: 0.135, b: 0.30, r: 0.070, iris: [26, 24, 30], ring: [250, 236, 210] },
      dorsal: {
        u0: 0.22, u1: 0.84, h: 0.24, edge: [28, 26, 34],
        shape: t => Math.max(0.18, 0.72 + 0.34 * Math.sin(Math.PI * t) - 0.42 * Math.exp(-Math.pow((t - 0.44) / 0.10, 2)))
      },
      anal: { u0: 0.62, u1: 0.90, h: 0.20, shape: t => Math.sin(Math.PI * t), edge: [28, 26, 34] },
      pect: { u: 0.30, b: -0.02, len: 0.24, h: 0.20, beat: 3.1 },
      pelvic: { u: 0.36, len: 0.30, n: 1, w: 0.06 },
      tail: { pts: TAILS.round, len: 0.30, h: 0.34, edge: [28, 26, 34] },
      pattern: [
        { t: 'vband', u: 0.215, w: 0.062, slant: 0.05, col: [26, 24, 32], a: 0.85 },
        { t: 'vband', u: 0.215, w: 0.040, slant: 0.05, col: [250, 250, 246], a: 0.96 },
        { t: 'vband', u: 0.505, w: 0.086, slant: -0.10, col: [26, 24, 32], a: 0.85, bow: 0.10 },
        { t: 'vband', u: 0.505, w: 0.062, slant: -0.10, col: [250, 250, 246], a: 0.96, bow: 0.10 },
        { t: 'vband', u: 0.845, w: 0.052, slant: 0.04, col: [26, 24, 32], a: 0.85 },
        { t: 'vband', u: 0.845, w: 0.032, slant: 0.04, col: [250, 250, 246], a: 0.96 }
      ]
    };

    SPECIES.idol = {
      key: 'idol', len: 104, thick: 0.052, pivot: 0.44,
      top: mkProfile(u => P_DISC(u) * (1 - 0.10 * u), 0.46), bot: mkProfile(P_DISC_B, 0.40),
      back: [244, 242, 232], mid: [250, 248, 240], belly: [252, 251, 246],
      finCol: [242, 206, 92], finA: 0.62, rayA: 0.20,
      amp: 0.042, waveK: 0.82, beat: 1.25, speed: 34, turn: 0.7, turnRate: 1.2,
      eye: { u: 0.125, b: 0.34, r: 0.052, iris: [24, 22, 28], ring: [246, 240, 226] },
      dorsal: { u0: 0.18, u1: 0.88, h: 0.62, shape: t => Math.pow(1 - t, 0.85) * (0.35 + 0.65 * Math.pow(1 - t, 0.4)), streamer: 1.55 },
      anal: { u0: 0.46, u1: 0.92, h: 0.34, shape: t => Math.sin(Math.PI * Math.pow(t, 0.8)) },
      pect: { u: 0.30, b: -0.06, len: 0.18, h: 0.14, beat: 2.4 },
      pelvic: { u: 0.36, len: 0.42, n: 1, w: 0.05 },
      tail: { pts: TAILS.fan, len: 0.26, h: 0.26 },
      pattern: [
        { t: 'vband', u: 0.17, w: 0.11, slant: 0.10, col: [26, 26, 34], a: 0.90 },
        { t: 'vband', u: 0.58, w: 0.13, slant: 0.09, col: [26, 26, 34], a: 0.90 },
        { t: 'band', u0: 0.72, u1: 1.0, b0: -1.0, b1: 1.0, col: [246, 200, 62], a: 0.86 },
        { t: 'band', u0: 0.0, u1: 0.10, b0: -1.0, b1: 0.2, col: [244, 204, 78], a: 0.7 }
      ]
    };

    SPECIES.veil = {
      key: 'veil', len: 86, thick: 0.090, pivot: 0.42,
      top: mkProfile(P_OVAL, 0.255), bot: mkProfile(P_OVAL_B, 0.245),
      back: [96, 60, 168], mid: [148, 96, 206], belly: [92, 190, 206],
      finCol: [156, 122, 226], finA: 0.34, rayA: 0.22,
      amp: 0.062, waveK: 0.90, beat: 1.15, speed: 26, turn: 0.7, turnRate: 1.15,
      eye: { u: 0.13, b: 0.30, r: 0.070, iris: [24, 22, 32], ring: [214, 190, 240] },
      dorsal: { u0: 0.34, u1: 0.98, h: 0.52, shape: t => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.45)), 0.62), ripple: 1.6 },
      anal: { u0: 0.52, u1: 1.0, h: 0.46, shape: t => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.5)), 0.6), ripple: 1.6 },
      pect: { u: 0.28, b: -0.04, len: 0.20, h: 0.16, beat: 2.6 },
      tail: { pts: TAILS.veil, len: 0.86, h: 0.56, ripple: 2.2 },
      pattern: [
        { t: 'band', u0: 0.0, u1: 1.0, b0: -0.35, b1: -1.0, col: [64, 186, 200], col2: [120, 226, 214], a: 0.55 },
        { t: 'band', u0: 0.30, u1: 1.0, b0: 0.2, b1: 1.0, col: [188, 118, 232], a: 0.35 }
      ]
    };

    SPECIES.arrow = {
      key: 'arrow', len: 148, thick: 0.055, pivot: 0.46,
      top: mkProfile(P_LONG, 0.088), bot: mkProfile(P_LONG_B, 0.082),
      back: [26, 74, 88], mid: [176, 202, 210], belly: [238, 244, 246],
      finCol: [190, 214, 220], finA: 0.26, rayA: 0.14,
      amp: 0.115, waveK: 1.45, beat: 1.9, speed: 74, turn: 0.8, turnRate: 1.5,
      eye: { u: 0.085, b: 0.42, r: 0.036, iris: [22, 26, 34], ring: [226, 214, 150] },
      dorsal: { u0: 0.66, u1: 0.86, h: 0.13, shape: t => Math.sin(Math.PI * t) },
      anal: { u0: 0.70, u1: 0.90, h: 0.11, shape: t => Math.sin(Math.PI * t) },
      pect: { u: 0.22, b: -0.02, len: 0.14, h: 0.08, beat: 2.2 },
      tail: { pts: TAILS.deep, len: 0.28, h: 0.28 },
      pattern: [
        { t: 'band', u0: 0.08, u1: 1.0, b0: 0.05, b1: 0.55, col: [230, 202, 96], a: 0.55 },
        { t: 'band', u0: 0.0, u1: 1.0, b0: 0.6, b1: 1.05, col: [22, 66, 84], a: 0.5 }
      ]
    };
  }

  /* ---------------- рыба ---------------- */
  let fishes = [];
  let schoolTarget = { x: 0, y: 0, z: 0.5, t: 0 };

  function Fish(sp, wx, wy, z) {
    this.sp = sp;
    this.wx = wx; this.wy = wy; this.z = z;
    this.sc = scaleAt(z);
    this.x = CX + wx * this.sc; this.y = HOR + wy * this.sc;
    this.yaw = rr(0, TAU); this.pitch = 0; this.roll = 0;
    this.yawRate = 0;
    this.spd = sp.speed * rr(0.8, 1.1);
    this.phase = rr(0, TAU);
    this.amp = sp.amp; this.bend = 0;
    this.pecPh = rr(0, TAU);
    this.sizeVar = rr(0.86, 1.16);
    this.len = sp.len * this.sizeVar;
    this.seed = rnd() * 100;
    this.wt = rr(0, 40);
    this.urg = 0;
    this.mouth = 0;
    this.bubbleT = rr(2, 16);
    this.lightSm = 0;
  }

  function speciesCounts(mult) {
    return {
      neon: Math.round(16 * mult),
      angel: Math.round(3 * mult),
      clown: Math.round(3 * mult),
      idol: Math.round(2 * mult),
      veil: Math.round(2 * mult),
      arrow: Math.round(3 * mult)
    };
  }

  function spawnFish(sp) {
    const z = sp.school ? rr(0.30, 0.72) : rr(0.10, 0.92);
    const s = scaleAt(z);
    const wx = (rr(0.08, 0.92) * W - CX) / s;
    const yTop = H * 0.10, yBot = floorYAt(z) - sp.len * s * 0.45;
    const wy = (rr(yTop, Math.max(yTop + 10, yBot)) - HOR) / s;
    return new Fish(sp, wx, wy, z);
  }

  function rebuildFish() {
    const want = speciesCounts(cfg.fish);
    for (const k in want) {
      const have = fishes.filter(f => f.sp.key === k);
      const n = want[k];
      if (have.length < n) {
        for (let i = have.length; i < n; i++) fishes.push(spawnFish(SPECIES[k]));
      } else if (have.length > n) {
        for (let i = n; i < have.length; i++) {
          const idx = fishes.indexOf(have[i]);
          if (idx >= 0) fishes.splice(idx, 1);
        }
      }
    }
  }

  /* ---------------- растения / камни ---------------- */
  let plants = [], rocks = [], farReef = [], emitters = [];

  function makePlant(kind, wx, z, h, hue, strands) {
    return {
      kind, wx, z, h, hue, strands,
      lean: rr(-0.22, 0.22),
      sway: rr(0.26, 0.5),
      freq: rr(0.45, 0.85),
      phase: rr(0, TAU),
      push: 0, pushV: 0,
      seed: rnd() * 100
    };
  }

  function buildScenery() {
    plants = []; rocks = []; farReef = []; emitters = [];
    _seed = 987654321;

    // дальний риф — тёмные силуэты у гребня дюны
    for (let i = 0; i < 9; i++) {
      const x = (i + rr(0.1, 0.9)) / 9 * W;
      farReef.push({ x, w: rr(60, 200), h: rr(16, 54), s: rnd() * 10 });
    }

    // дальние заросли
    for (let i = 0; i < 8; i++) {
      const z = rr(0.72, 0.95), s = scaleAt(z);
      const wx = ((i + rr(0.15, 0.85)) / 8 * W - CX) / s;
      plants.push(makePlant(rnd() < 0.5 ? 'ribbon' : 'bush', wx, z, H * rr(0.28, 0.46), rr(-0.1, 0.14), ri(5, 9)));
    }
    // средний план
    const midX = [0.06, 0.19, 0.37, 0.58, 0.74, 0.9];
    for (let i = 0; i < midX.length; i++) {
      const z = rr(0.42, 0.66), s = scaleAt(z);
      const wx = ((midX[i] + rr(-0.03, 0.03)) * W - CX) / s;
      plants.push(makePlant(i % 3 === 1 ? 'broad' : 'ribbon', wx, z, H * rr(0.22, 0.36), rr(-0.06, 0.16), ri(4, 8)));
    }
    // передний план — крупные тёмные кулисы
    const nearX = [-0.02, 0.28, 1.02];
    for (let i = 0; i < nearX.length; i++) {
      const z = rr(0.07, 0.17), s = scaleAt(z);
      const wx = (nearX[i] * W - CX) / s;
      plants.push(makePlant(i === 1 ? 'bush' : 'ribbon', wx, z, H * rr(0.30, 0.44), rr(-0.05, 0.05), ri(5, 9)));
    }

    // камни
    const rockDef = [[0.14, 0.55], [0.47, 0.72], [0.66, 0.48], [0.86, 0.62], [0.30, 0.25], [0.94, 0.20]];
    for (let i = 0; i < rockDef.length; i++) {
      const z = rockDef[i][1] + rr(-0.05, 0.05), s = scaleAt(z);
      const wx = (rockDef[i][0] * W - CX) / s;
      const shape = [];
      const n = 11, rad = H * rr(0.035, 0.075);
      for (let k = 0; k < n; k++) {
        const a = k / n * TAU;
        const rr_ = rad * (0.72 + 0.42 * fbm(k * 0.9 + i * 13.3)) * (1 - 0.34 * Math.abs(Math.sin(a)) * (a > Math.PI ? 1 : 0.2));
        shape.push([Math.cos(a) * rr_ * 1.35, -Math.abs(Math.sin(a)) * rr_ * (a < Math.PI ? 1 : 0.12)]);
      }
      rocks.push({ wx, z, shape, hue: rr(-0.1, 0.1) });
    }

    // источники пузырей
    emitters.push({ wx: (W * 0.20 - CX) / scaleAt(0.55), z: 0.55, t: 0, rate: rr(0.35, 0.6) });
    emitters.push({ wx: (W * 0.72 - CX) / scaleAt(0.40), z: 0.40, t: 0, rate: rr(0.5, 0.9) });
    emitters.push({ wx: (W * 0.44 - CX) / scaleAt(0.80), z: 0.80, t: 0, rate: rr(0.25, 0.45) });
  }

  /* ---------------- пузыри, взвесь, корм ---------------- */
  let bubbles = [], snow = [], food = [], puffs = [];

  function addBubble(x, y, z, r, vy) {
    if (bubbles.length > 260) return;
    bubbles.push({ x, y, z, r, vy: vy || rr(26, 46), ph: rr(0, TAU), w: rr(3, 9), a: 1 });
  }
  function buildSnow() {
    snow = [];
    const n = Math.round(150 * quality.snow);
    for (let i = 0; i < n; i++) {
      snow.push({
        x: rnd() * W, y: rnd() * H, z: rr(0.02, 1),
        r: rr(0.6, 2.6), a: rr(0.10, 0.5), ph: rr(0, TAU), vy: rr(-4, 7), vx: rr(-5, 5)
      });
    }
  }
  function dropFood(x, y) {
    for (let i = 0; i < 16; i++) {
      food.push({
        x: x + rr(-26, 26), y: y + rr(-16, 16), z: rr(0.2, 0.8),
        vx: rr(-8, 8), vy: rr(4, 16), ph: rr(0, TAU), r: rr(1.6, 3.4), life: 26, eaten: false
      });
    }
  }

  /* ---------------- лучи света ---------------- */
  let rays = [];
  function buildRays() {
    rays = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      rays.push({
        x0: (i + rr(0.15, 0.85)) / n * W,
        drift: rr(-0.06, 0.06),
        tilt: rr(-0.30, 0.30),
        w: rr(0.055, 0.16) * W,
        h: rr(0.78, 1.12) * H,
        a: rr(0.35, 1),
        ph: rr(0, TAU),
        sp: rr(0.13, 0.30),
        tex: i % 2
      });
    }
  }
  function rayX(r, t) { return r.x0 + fsin(t * r.sp + r.ph) * r.drift * W; }
  function lightAt(x, y, t) {
    let s = 0;
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i];
      const rx = rayX(r, t) + y * Math.tan(r.tilt);
      const d = (x - rx) / (r.w * 0.62);
      const q = 1 - Math.min(1, d * d);
      if (q > 0) s += q * q * r.a;
    }
    return s * clamp(1 - y / (H * 1.3), 0.12, 1) * cfg.light;
  }

  /* ---------------- фон / вода ---------------- */
  let waterGrad = null, sandGrad = null, dune = null;

  function buildGradients() {
    waterGrad = ctx.createLinearGradient(0, 0, 0, H);
    for (let i = 0; i < WATER.length; i++) waterGrad.addColorStop(WATER[i][0], cs(WATER[i][1], 1));

    const y0 = HOR + FY * 0.155;
    sandGrad = ctx.createLinearGradient(0, y0, 0, H * 1.04);
    sandGrad.addColorStop(0, 'rgb(20,58,74)');
    sandGrad.addColorStop(0.16, 'rgb(38,72,80)');
    sandGrad.addColorStop(0.42, 'rgb(78,92,84)');
    sandGrad.addColorStop(0.72, 'rgb(120,110,88)');
    sandGrad.addColorStop(1, 'rgb(154,136,102)');

    // линия дюн
    dune = [];
    const y0d = HOR + FY * 0.155;
    for (let x = -20; x <= W + 20; x += 14) {
      const y = y0d
        + Math.sin(x * 0.0042 + 1.1) * H * 0.011
        + Math.sin(x * 0.0113 + 3.7) * H * 0.006
        + Math.sin(x * 0.0019 - 0.6) * H * 0.017;
      dune.push([x, y]);
    }
  }

  function sandPath() {
    const p = new Path2D();
    p.moveTo(-20, H + 40);
    for (let i = 0; i < dune.length; i++) p.lineTo(dune[i][0], dune[i][1]);
    p.lineTo(W + 20, H + 40);
    p.closePath();
    return p;
  }

  /* ---------------- рисование: вода и дно ---------------- */
  function drawWater() {
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, 0, W, H);
    // светлое пятно у поверхности
    const g = ctx.createRadialGradient(W * 0.42, -H * 0.18, 0, W * 0.42, -H * 0.18, H * 0.95);
    g.addColorStop(0, 'rgba(160,246,255,' + (0.26 * cfg.light).toFixed(3) + ')');
    g.addColorStop(0.45, 'rgba(96,200,220,' + (0.09 * cfg.light).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(96,200,220,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.75);
  }

  function drawFarReef(t) {
    ctx.save();
    const base = HOR + FY * 0.157;
    for (let i = 0; i < farReef.length; i++) {
      const r = farReef[i];
      const col = mixc(waterAt(base / H), [8, 32, 44], 0.42 * cfg.haze + 0.24);
      ctx.fillStyle = cs(col, 0.75);
      ctx.beginPath();
      ctx.moveTo(r.x - r.w * 0.5, base + 6);
      for (let k = 0; k <= 10; k++) {
        const u = k / 10;
        const hh = r.h * Math.pow(Math.sin(Math.PI * u), 0.7) * (0.7 + 0.5 * fbm(u * 3 + r.s));
        ctx.lineTo(r.x - r.w * 0.5 + u * r.w, base + 6 - hh);
      }
      ctx.lineTo(r.x + r.w * 0.5, base + 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSand(t) {
    const sp = sandPath();
    ctx.save();
    ctx.clip(sp);
    ctx.fillStyle = sandGrad;
    ctx.fillRect(0, HOR, W, H - HOR + 40);

    // рябь песка — сгущается к горизонту (перспектива)
    ctx.lineCap = 'round';
    for (let i = 0; i < 34; i++) {
      const u = i / 33;
      const s = lerp(0.155, 1.75, Math.pow(u, 2.3));
      const y = HOR + FY * s;
      if (y > H + 30) break;
      const a = clamp((s - 0.16) * 1.5, 0, 1) * 0.16;
      ctx.beginPath();
      for (let x = -10; x <= W + 10; x += 26) {
        const yy = y + Math.sin(x * 0.011 + i * 1.7) * (2 + 7 * s) + Math.sin(x * 0.004 - i) * (3 + 5 * s);
        if (x < 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.lineWidth = Math.max(0.7, 1.6 * s);
      ctx.strokeStyle = 'rgba(255,238,200,' + a.toFixed(3) + ')';
      ctx.stroke();
      ctx.translate(0, ctx.lineWidth * 1.1);
      ctx.strokeStyle = 'rgba(26,30,26,' + (a * 0.85).toFixed(3) + ')';
      ctx.stroke();
      ctx.translate(0, -ctx.lineWidth * 1.1);
    }

    // зерно
    if (sandPat) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = sandPat;
      ctx.fillRect(0, HOR, W, H - HOR + 40);
      ctx.globalAlpha = 1;
    }

    // каустика
    if (caus.ready && cfg.light > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(0.62 * cfg.light, 0, 1);
      ctx.drawImage(caus.cv, 0, caus.y0, W, caus.y1 - caus.y0);
      ctx.globalAlpha = clamp(0.28 * cfg.light, 0, 1);
      ctx.drawImage(caus.cv, -W * 0.03, caus.y0 - H * 0.02, W * 1.06, (caus.y1 - caus.y0) * 1.07);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // световые пятна от лучей на дне
    if (texWarm && cfg.light > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < rays.length; i++) {
        const r = rays[i];
        const yb = H * 0.86;
        const x = rayX(r, t) + yb * Math.tan(r.tilt);
        const w = r.w * 2.3, h = r.w * 0.62;
        ctx.globalAlpha = clamp(0.16 * r.a * cfg.light, 0, 1);
        ctx.drawImage(texWarm, x - w / 2, yb - h / 2, w, h);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // притемнение к горизонту (дымка над дном)
    const hz = ctx.createLinearGradient(0, HOR + FY * 0.14, 0, HOR + FY * 0.62);
    const wc = waterAt((HOR + FY * 0.2) / H);
    hz.addColorStop(0, cs(wc, clamp(0.92 * cfg.haze, 0, 1)));
    hz.addColorStop(1, cs(wc, 0));
    ctx.fillStyle = hz;
    ctx.fillRect(0, HOR, W, FY * 0.7);

    ctx.restore();
  }

  function drawShadows(t) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < fishes.length; i++) {
      const f = fishes[i];
      const fy = floorYAt(f.z);
      if (fy > H + 60 || fy < HOR) continue;
      const dh = (fy - f.y) / (H * 0.34);
      if (dh > 1.5 || dh < 0) continue;
      const a = clamp((1 - dh / 1.5) * 0.30, 0, 0.3) * clamp(cfg.light, 0, 1);
      if (a < 0.01) continue;
      const L = f.len * f.sc;
      const w = L * (0.30 + 0.55 * Math.abs(Math.cos(f.yaw))) * (1 + dh * 0.5);
      const h = w * 0.24;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(28,42,44,1)';
      ctx.beginPath();
      ctx.ellipse(f.x + dh * 12, fy, w, h, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ---------------- лента (общий помощник) ---------------- */
  function ribbon(pts, w0, w1) {
    const n = pts.length;
    const p = new Path2D();
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n - 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const w = lerp(w0, w1, n > 1 ? i / (n - 1) : 0);
      L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
      R.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
    }
    p.moveTo(L[0][0], L[0][1]);
    for (let i = 1; i < n; i++) p.lineTo(L[i][0], L[i][1]);
    for (let i = n - 1; i >= 0; i--) p.lineTo(R[i][0], R[i][1]);
    p.closePath();
    return p;
  }

  /* ---------------- гладкие контуры (Catmull-Rom → кубический Безье) ----------------
     Силуэты рыб строятся по опорным точкам, которые гнёт волна тела; чтобы контур
     не читался как низкополигональная модель, между точками ставим кубические кривые. */
  function dedupeSeq(pts, closed) {
    const n = pts.length;
    let need = false;
    for (let i = 1; i < n; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      if (dx * dx + dy * dy < 1e-6) { need = true; break; }
    }
    if (!need && closed && n > 1) {
      const dx = pts[0][0] - pts[n - 1][0], dy = pts[0][1] - pts[n - 1][1];
      if (dx * dx + dy * dy < 1e-6) need = true;
    }
    if (!need) return pts;
    const out = [pts[0]];
    for (let i = 1; i < n; i++) {
      const q = out[out.length - 1];
      const dx = pts[i][0] - q[0], dy = pts[i][1] - q[1];
      if (dx * dx + dy * dy >= 1e-6) out.push(pts[i]);
    }
    if (closed && out.length > 3) {
      const dx = out[0][0] - out[out.length - 1][0], dy = out[0][1] - out[out.length - 1][1];
      if (dx * dx + dy * dy < 1e-6) out.pop();
    }
    return out;
  }

  // замкнутый гладкий контур
  function crClosed(pts, tens) {
    const q = dedupeSeq(pts, true);
    const n = q.length;
    const p = new Path2D();
    if (n < 3) {
      if (n > 0) {
        p.moveTo(q[0][0], q[0][1]);
        for (let i = 1; i < n; i++) p.lineTo(q[i][0], q[i][1]);
        p.closePath();
      }
      return p;
    }
    const k = (tens === undefined ? 0.5 : tens) / 3;
    p.moveTo(q[0][0], q[0][1]);
    for (let i = 0; i < n; i++) {
      const a = q[(i - 1 + n) % n], b = q[i], c = q[(i + 1) % n], d = q[(i + 2) % n];
      p.bezierCurveTo(
        b[0] + (c[0] - a[0]) * k, b[1] + (c[1] - a[1]) * k,
        c[0] - (d[0] - b[0]) * k, c[1] - (d[1] - b[1]) * k,
        c[0], c[1]);
    }
    p.closePath();
    return p;
  }

  // открытая гладкая линия (концы «зажаты»)
  function crOpen(pts, tens) {
    const q = dedupeSeq(pts, false);
    const n = q.length;
    const p = new Path2D();
    if (n < 2) return p;
    p.moveTo(q[0][0], q[0][1]);
    if (n === 2) { p.lineTo(q[1][0], q[1][1]); return p; }
    const k = (tens === undefined ? 0.5 : tens) / 3;
    for (let i = 0; i < n - 1; i++) {
      const a = q[i > 0 ? i - 1 : 0], b = q[i], c = q[i + 1], d = q[i + 2 < n ? i + 2 : n - 1];
      p.bezierCurveTo(
        b[0] + (c[0] - a[0]) * k, b[1] + (c[1] - a[1]) * k,
        c[0] - (d[0] - b[0]) * k, c[1] - (d[1] - b[1]) * k,
        c[0], c[1]);
    }
    return p;
  }

  // лента с гладкой кромкой (нити, вымпелы, брюшные плавники)
  function ribbonSmooth(pts, w0, w1) {
    const n = pts.length;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n - 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const w = lerp(w0, w1, n > 1 ? i / (n - 1) : 0);
      L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
      R.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
    }
    for (let i = n - 1; i >= 0; i--) L.push(R[i]);
    return crClosed(L, 0.42);
  }

  /* ---------------- растения ---------------- */
  function drawPlant(pl, t) {
    const s = scaleAt(pl.z);
    const bx = CX + pl.wx * s, by = HOR + FY * s + 3;
    const h = pl.h * s;
    if (bx < -H * 0.5 || bx > W + H * 0.5) return;
    const fogT = clamp(pl.z * 0.92, 0, 1) * cfg.haze;
    const fog = waterAt(clamp((by - h * 0.5) / H, 0, 1));
    const cur = fsin(t * 0.21) * 0.6 + fsin(t * 0.13 + 2.1) * 0.4;

    const nStr = pl.strands;
    for (let k = 0; k < nStr; k++) {
      const kk = k / Math.max(1, nStr - 1) - 0.5;
      const segs = pl.kind === 'broad' ? 9 : 12;
      const sh = h * (0.55 + 0.45 * (1 - Math.abs(kk) * 1.2)) * (0.78 + 0.44 * h1(pl.seed + k * 3.7));
      const ox = kk * h * 0.22 + (h1(pl.seed + k) - 0.5) * h * 0.12;
      const strandPh = k * 0.9 + h1(pl.seed + k * 5.1) * 4;
      let ang = -Math.PI / 2 + pl.lean + kk * 0.55;
      let x = bx + ox, y = by;
      const pts = [[x, y]];
      for (let i = 1; i <= segs; i++) {
        const tt = i / segs;
        const a = ang
          + pl.sway * (0.18 + tt * tt * 1.5) * fsin(t * pl.freq * TAU * 0.16 + pl.phase + strandPh - i * 0.52)
          + cur * 0.22 * tt * tt
          + pl.push * tt * tt * 1.6;
        const seg = sh / segs;
        x += Math.cos(a) * seg; y += Math.sin(a) * seg;
        pts.push([x, y]);
      }

      let w0, w1, base, tip;
      if (pl.kind === 'broad') {
        w0 = h * 0.045; w1 = h * 0.008;
        base = [18 + pl.hue * 40, 62, 46]; tip = [66 + pl.hue * 60, 138, 78];
      } else if (pl.kind === 'bush') {
        w0 = h * 0.014; w1 = h * 0.004;
        base = [14, 52, 44]; tip = [58 + pl.hue * 50, 132, 96];
      } else {
        w0 = h * 0.028; w1 = h * 0.006;
        base = [14, 56, 48]; tip = [72 + pl.hue * 60, 150, 92];
      }
      const path = ribbon(pts, w0, w1);
      const g = ctx.createLinearGradient(bx, by, pts[segs][0], pts[segs][1]);
      g.addColorStop(0, cs(mixc(mixc(base, [4, 16, 20], 0.45), fog, fogT), 0.96));
      g.addColorStop(0.55, cs(mixc(mixc(base, tip, 0.55), fog, fogT * 0.92), 0.95));
      g.addColorStop(1, cs(mixc(tip, fog, fogT * 0.85), 0.9));
      ctx.fillStyle = g;
      ctx.fill(path);

      // светлая жилка
      if (pl.kind !== 'bush') {
        ctx.strokeStyle = cs(mixc(mixc(tip, [220, 255, 210], 0.35), fog, fogT), 0.16);
        ctx.lineWidth = Math.max(0.5, w0 * 0.30);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
    }
  }

  function drawRock(rk, t) {
    const s = scaleAt(rk.z);
    const bx = CX + rk.wx * s, by = HOR + FY * s;
    const fogT = clamp(rk.z * 0.9, 0, 1) * cfg.haze;
    const fog = waterAt(clamp(by / H, 0, 1));
    const sh = rk.shape;
    const p = new Path2D();
    p.moveTo(bx + sh[0][0] * s, by + sh[0][1] * s);
    for (let i = 1; i < sh.length; i++) p.lineTo(bx + sh[i][0] * s, by + sh[i][1] * s);
    p.closePath();
    // контактная тень
    ctx.fillStyle = 'rgba(20,34,36,0.30)';
    ctx.beginPath();
    ctx.ellipse(bx, by + 2 * s, 42 * s * 1.5, 9 * s, 0, 0, TAU);
    ctx.fill();

    let top = [104, 104, 96], bot = [30, 40, 44];
    top = mixc(top, [140, 128, 96], 0.35 + rk.hue);
    const g = ctx.createLinearGradient(bx - 20 * s, by - 60 * s, bx + 20 * s, by);
    g.addColorStop(0, cs(mixc(top, fog, fogT), 1));
    g.addColorStop(0.6, cs(mixc(mixc(top, bot, 0.6), fog, fogT), 1));
    g.addColorStop(1, cs(mixc(bot, fog, fogT * 0.8), 1));
    ctx.fillStyle = g;
    ctx.fill(p);
    // блик сверху
    ctx.save();
    ctx.clip(p);
    ctx.globalCompositeOperation = 'lighter';
    const cvv = causticAt(bx, by - 20 * s, t) * clamp(cfg.light, 0, 1.4);
    const g2 = ctx.createLinearGradient(bx, by - 70 * s, bx, by - 10 * s);
    g2.addColorStop(0, 'rgba(255,238,196,' + (0.16 + cvv * 0.30).toFixed(3) + ')');
    g2.addColorStop(1, 'rgba(255,238,196,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(bx - 90 * s, by - 90 * s, 180 * s, 90 * s);
    ctx.restore();
  }

  /* ---------------- рыба: отрисовка ---------------- */
  function drawFish(f, t) {
    const sp = f.sp;
    const L = f.len * f.sc;
    if (f.x < -L * 2.2 || f.x > W + L * 2.2 || f.y < -L * 2 || f.y > H + L * 2) return;

    const ct = Math.cos(f.yaw), st = Math.sin(f.yaw);
    let csn = ct;
    if (Math.abs(csn) < 0.11) csn = csn < 0 ? -0.11 : 0.11;
    const cp = Math.cos(f.pitch), sp_ = Math.sin(f.pitch);
    const F0 = cp * csn, F1 = -sp_;
    const U0 = -sp_ * csn, U1 = -cp;
    const X0 = -st;
    const cr = Math.cos(f.roll), sr = Math.sin(f.roll);
    const px = f.x, py = f.y, piv = sp.pivot;

    function P(a, b, c) {
      const b2 = b * cr - c * sr, c2 = b * sr + c * cr;
      const aa = a - piv;
      return [px + L * (aa * F0 + b2 * U0 + c2 * X0), py + L * (aa * F1 + b2 * U1)];
    }
    const amp = f.amp, wk = sp.waveK, ph = f.phase, bend = f.bend;
    function wv(a) {
      const ac = a < 0 ? 0 : (a > 1.9 ? 1.9 : a);
      let e = 0.03 + 0.97 * Math.pow(ac, 1.7);
      if (e > 2.1) e = 2.1;
      return amp * fsin(TAU * wk * ac - ph) * e + bend * Math.pow(ac, 1.35);
    }
    function PW(a, b, c) { return P(a, b, wv(a) + (c || 0)); }

    // ---- цвета с учётом дымки.
    // Дымка ограничена снизу: даже самая дальняя рыба сохраняет свой цвет и силуэт,
    // иначе далёкие особи вырождались в серые полупрозрачные пятна.
    // (поверх ещё ложатся общие завесы дымки fogWash — потому потолок низкий)
    const FOG_MAX = 0.40;
    const fogT = Math.min(FOG_MAX, clamp(Math.pow(f.z, 0.9) * 0.38, 0, 1) * clamp(cfg.haze, 0, 1.2));
    const fog = waterAt(clamp(f.y / H, 0, 1));
    const cBack = mixc(sp.back, fog, fogT);
    const cMid = mixc(sp.mid, fog, fogT);
    const cBelly = mixc(sp.belly, fog, fogT);
    const cFin = mixc(sp.finCol, fog, fogT);
    const broad = Math.abs(ct);

    ctx.save();
    ctx.globalAlpha = clamp(1 - f.z * 0.10 * clamp(cfg.haze, 0, 1.2), 0.68, 1);
    if (quality.blur && f.z > 0.78) {
      ctx.filter = 'blur(' + (0.35 + (f.z - 0.78) * 4.2).toFixed(2) + 'px)';
    }

    /* ---- хвост: гладкая лопасть с мягкой волнистой кромкой ---- */
    const tl = sp.tail.len, thh = sp.tail.h, rip = sp.tail.ripple || 0.8;
    const tp = sp.tail.pts, tPts = [];
    for (let i = 0; i < tp.length; i++) {
      const s0 = tp[i][0];
      const a = 1 + s0 * tl;
      // волнистость кромки: у основания нулевая, к краю растёт
      const ew = 1 + 0.085 * fsin(ph * 1.3 + s0 * 7.2 + i * 2.1) * Math.min(1, s0 * 2.4);
      const extra = fsin(ph * 1.05 + s0 * 3.4) * 0.018 * s0 * rip;
      tPts.push(PW(a, tp[i][1] * thh * ew, extra));
    }
    const tailPath = crClosed(tPts, 0.42);
    const tailA = sp.finA * (0.6 + 0.4 * broad);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // мягкий ореол под перепонкой — кромка «растворяется» в воде
    ctx.lineWidth = Math.max(0.8, L * 0.024);
    ctx.strokeStyle = cs(cFin, tailA * 0.26);
    ctx.stroke(tailPath);
    // перепонка: плотнее у основания, прозрачнее к краю
    const tBase0 = PW(1, 0, 0), tTip0 = PW(1 + tl, 0, 0);
    if (Math.abs(tTip0[0] - tBase0[0]) + Math.abs(tTip0[1] - tBase0[1]) > 0.6) {
      const tg = ctx.createLinearGradient(tBase0[0], tBase0[1], tTip0[0], tTip0[1]);
      tg.addColorStop(0, cs(cFin, clamp(tailA * 1.25, 0, 1)));
      tg.addColorStop(0.55, cs(cFin, tailA * 0.95));
      tg.addColorStop(1, cs(cFin, tailA * 0.42));
      ctx.fillStyle = tg;
    } else {
      ctx.fillStyle = cs(cFin, tailA);
    }
    ctx.fill(tailPath);
    if (sp.tail.edge) {
      ctx.strokeStyle = cs(mixc(sp.tail.edge, fog, fogT), 0.52);
      ctx.lineWidth = Math.max(0.6, L * 0.0095);
      ctx.stroke(tailPath);
    }
    // лучи плавника
    const tBase = PW(1, 0, 0);
    ctx.strokeStyle = cs(mixc(cFin, [255, 255, 255], 0.35), sp.rayA);
    ctx.lineWidth = Math.max(0.5, L * 0.008);
    ctx.beginPath();
    for (let i = 1; i < tp.length - 1; i++) {
      if (tp[i][0] < 0.4) continue;
      ctx.moveTo(tBase[0], tBase[1]);
      ctx.lineTo(tPts[i][0], tPts[i][1]);
    }
    ctx.stroke();

    /* ---- спинной / анальный ---- */
    drawVFin(sp.dorsal, 1);
    drawVFin(sp.anal, -1);

    function drawVFin(d, sign) {
      if (!d) return;
      const n = L < 42 ? 8 : (L < 96 ? 11 : 14), outer = [], base = [];
      const rp = d.ripple || 1;
      for (let i = 0; i <= n; i++) {
        const tt = i / n, u = lerp(d.u0, d.u1, tt);
        const hb = sign > 0 ? sp.top(u) : -sp.bot(u);
        // волнистая кромка: гребёнка гаснет у корня плавника
        const ew = 1 + 0.09 * fsin(ph * 1.25 + tt * 10.5 + (sign > 0 ? 0 : 2.3)) * Math.sin(Math.PI * clamp(tt, 0, 1));
        // галтель у корня: плавник выходит из спины/брюха плавно, а не ступенькой
        const fl = Math.min(
          d.streamer ? 1 : Math.min(1, Math.pow(tt / 0.09, 0.6)),
          Math.min(1, Math.pow((1 - tt) / 0.09, 0.6)));
        const hh = d.h * d.shape(tt) * (sign > 0 ? 1 : -1) * ew * fl;
        const flut = fsin(ph * 1.2 + tt * 2.8 + (sign > 0 ? 0 : 1.7)) * 0.03 * Math.abs(hh) * rp;
        outer.push(PW(u, hb + hh, flut));
        base.push(PW(u, hb * 0.96, 0));
      }
      const pts = outer.concat(base.slice().reverse());
      const finPath = crClosed(pts, 0.4);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // мягкая кромка
      ctx.lineWidth = Math.max(0.7, L * 0.019);
      ctx.strokeStyle = cs(cFin, sp.finA * 0.24);
      ctx.stroke(finPath);
      // перепонка: плотная у корня, прозрачная у края
      const um = lerp(d.u0, d.u1, 0.5);
      const hbm = sign > 0 ? sp.top(um) : -sp.bot(um);
      const hhm = d.h * d.shape(0.5) * (sign > 0 ? 1 : -1);
      const gA0 = PW(um, hbm, 0), gB0 = PW(um, hbm + hhm * 1.1, 0);
      if (Math.abs(gB0[0] - gA0[0]) + Math.abs(gB0[1] - gA0[1]) > 0.6) {
        const fg = ctx.createLinearGradient(gA0[0], gA0[1], gB0[0], gB0[1]);
        fg.addColorStop(0, cs(cFin, clamp(sp.finA * 1.22, 0, 1)));
        fg.addColorStop(0.6, cs(cFin, sp.finA * 0.92));
        fg.addColorStop(1, cs(cFin, sp.finA * 0.40));
        ctx.fillStyle = fg;
      } else {
        ctx.fillStyle = cs(cFin, sp.finA);
      }
      ctx.fill(finPath);
      if (d.edge) {
        ctx.strokeStyle = cs(mixc(d.edge, fog, fogT), 0.5);
        ctx.lineWidth = Math.max(0.6, L * 0.0095);
        ctx.stroke(crOpen(outer, 0.4));
      }
      // лучи
      ctx.strokeStyle = cs(mixc(cFin, [255, 255, 255], 0.3), sp.rayA * 0.9);
      ctx.lineWidth = Math.max(0.45, L * 0.006);
      ctx.beginPath();
      for (let i = 1; i <= n; i += 2) {
        ctx.moveTo(base[i][0], base[i][1]);
        ctx.lineTo(outer[i][0], outer[i][1]);
      }
      ctx.stroke();

      // длинная нить с заднего края
      if (d.fil) {
        const fp = [];
        for (let i = 0; i <= 7; i++) {
          const tt = i / 7;
          const u = d.u1 + tt * d.fil * 0.55;
          const hb = (sign > 0 ? sp.top(d.u1) : -sp.bot(d.u1));
          const hh = (d.h * d.shape(1) + d.fil * 0.55 * (sign > 0 ? 1 : -1) * 0.35) * (1 - tt * 0.15);
          const wob = fsin(ph * 0.9 - tt * 2.6) * 0.055 * tt;
          fp.push(PW(u, hb + hh * (sign > 0 ? 1 : 1) * (0.9 + tt * 0.55), wob));
        }
        ctx.fillStyle = cs(cFin, sp.finA * 0.85);
        ctx.fill(ribbonSmooth(fp, L * 0.022, L * 0.004));
      }
      // белый вымпел (идол)
      if (d.streamer) {
        const fp = [];
        const u0 = d.u0 + 0.02;
        const bTop = sp.top(u0) + d.h * d.shape(0);
        for (let i = 0; i <= 9; i++) {
          const tt = i / 9;
          const a = u0 - tt * d.streamer * 0.62;
          const b = bTop + tt * d.streamer * 0.42;
          const wob = fsin(ph * 0.8 - tt * 3.1) * 0.09 * tt;
          fp.push(P(a, b - tt * tt * 0.30, wv(u0) + wob));
        }
        ctx.fillStyle = cs(mixc([250, 250, 244], fog, fogT), 0.72);
        ctx.fill(ribbonSmooth(fp, L * 0.026, L * 0.005));
      }
    }

    /* ---- брюшные нити ---- */
    if (sp.pelvic) {
      const pv = sp.pelvic;
      for (let k = 0; k < pv.n; k++) {
        const side = pv.n > 1 ? (k === 0 ? 1 : -1) : 0;
        const fp = [];
        for (let i = 0; i <= 7; i++) {
          const tt = i / 7;
          const a = pv.u - tt * 0.10;
          const b = -sp.bot(pv.u) - tt * pv.len;
          const wob = fsin(ph * 0.95 - tt * 2.4 + k * 1.4) * 0.06 * tt + side * sp.thick * 0.8;
          fp.push(P(a, b, wv(pv.u) + wob));
        }
        ctx.fillStyle = cs(cFin, (sp.finA + 0.15) * 0.9);
        ctx.fill(ribbonSmooth(fp, L * (pv.w || 0.018), L * 0.004));
      }
    }

    /* ---- грудные плавники (дальний) ---- */
    const nearSide = ct >= 0 ? -1 : 1;
    if (sp.pect) drawPect(-nearSide);

    function drawPect(side) {
      const pc = sp.pect;
      const beat = fsin(f.pecPh + t * pc.beat * TAU);
      const b0 = pc.b;
      const sw = 0.55 + 0.45 * beat;
      const zz = side * sp.thick;
      const wob = fsin(ph * 1.4 + f.pecPh) * 0.055;
      const base1 = PW(pc.u, b0 + pc.h * 0.35, zz * 0.85);
      const base2 = PW(pc.u + 0.05, b0 - pc.h * 0.15, zz * 0.85);
      // округлая лопасть: передняя кромка + два края перепонки
      const lead = PW(pc.u - pc.len * (0.20 + 0.22 * sw), b0 + pc.h * (0.16 - 0.30 * sw), zz * (1.0 + 1.5 * sw));
      const tip1 = PW(pc.u - pc.len * (0.35 + 0.35 * sw), b0 - pc.h * (0.2 + 0.9 * sw) * (1 + wob), zz * (1.0 + 2.6 * sw));
      const tipM = PW(pc.u - pc.len * (0.27 + 0.30 * sw), b0 - pc.h * (0.48 + 0.72 * sw) * (1 - wob * 0.6), zz * (0.95 + 2.3 * sw));
      const tip2 = PW(pc.u - pc.len * (0.15 + 0.25 * sw), b0 - pc.h * (0.7 + 0.5 * sw), zz * (0.8 + 2.0 * sw));
      const pts = [base1, lead, tip1, tipM, tip2, base2];
      const path = crClosed(pts, 0.42);
      const aMul = (side === nearSide ? 1 : 0.72);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.6, L * 0.014);
      ctx.strokeStyle = cs(cFin, (sp.finA + 0.16) * aMul * 0.26);
      ctx.stroke(path);
      if (Math.abs(tipM[0] - base1[0]) + Math.abs(tipM[1] - base1[1]) > 0.6) {
        const pg = ctx.createLinearGradient(base1[0], base1[1], tipM[0], tipM[1]);
        pg.addColorStop(0, cs(cFin, clamp((sp.finA + 0.20) * aMul, 0, 1)));
        pg.addColorStop(1, cs(cFin, (sp.finA + 0.10) * aMul * 0.42));
        ctx.fillStyle = pg;
      } else {
        ctx.fillStyle = cs(cFin, (sp.finA + 0.16) * aMul);
      }
      ctx.fill(path);
      ctx.strokeStyle = cs(mixc(cFin, [255, 255, 255], 0.3), sp.rayA * 0.85);
      ctx.lineWidth = Math.max(0.4, L * 0.005);
      ctx.beginPath();
      ctx.moveTo(base1[0], base1[1]); ctx.lineTo(tip1[0], tip1[1]);
      ctx.moveTo(base1[0], base1[1]); ctx.lineTo(tipM[0], tipM[1]);
      ctx.moveTo(base1[0], base1[1]); ctx.lineTo(tip2[0], tip2[1]);
      ctx.stroke();
    }

    /* ---- тело: гладкий контур по опорным точкам волны ----
       Косинусная развёртка u сгущает выборку у морды и у хвостового стебля —
       там кривизна профиля максимальна и полигональность была заметнее всего. */
    const N = L < 42 ? 16 : (L < 96 ? 24 : 30), top = [], bot = [];
    for (let i = 0; i <= N; i++) {
      const u = 0.5 - 0.5 * Math.cos(Math.PI * (i / N));
      const w = wv(u);
      top.push(P(u, sp.top(u), w));
      bot.push(P(u, -sp.bot(u), w));
    }
    // замкнутый обвод: спина вперёд, брюхо назад; переход в хвост скругляется
    const outline = top.slice();
    for (let i = N; i >= 0; i--) outline.push(bot[i]);
    const body = crClosed(outline, 0.45);

    const gA = P(0.45, sp.top(0.45) * 1.02, wv(0.45));
    const gB = P(0.45, -sp.bot(0.45) * 1.02, wv(0.45));
    const bg = ctx.createLinearGradient(gA[0], gA[1], gB[0], gB[1]);
    bg.addColorStop(0, cs(mixc(cBack, [0, 0, 0], 0.18), 1));
    bg.addColorStop(0.30, cs(cBack, 1));
    bg.addColorStop(0.62, cs(cMid, 1));
    bg.addColorStop(0.90, cs(cBelly, 1));
    bg.addColorStop(1, cs(mixc(cBelly, [255, 255, 255], 0.25), 1));
    ctx.fillStyle = bg;
    ctx.fill(body);

    ctx.save();
    ctx.clip(body);

    // узоры
    const pat = sp.pattern;
    if (pat) for (let i = 0; i < pat.length; i++) drawPattern(pat[i]);

    function drawPattern(pt) {
      if (pt.t === 'vband') {
        const u = pt.u, w = pt.w, sl = pt.slant || 0, bw = pt.bow || 0;
        const q = [];
        for (let k = 0; k <= 4; k++) {
          const tt = k / 4;
          const b = lerp(sp.top(u) * 1.15, -sp.bot(u) * 1.15, tt);
          const uu = u + sl * (tt - 0.5) * 2 + bw * Math.sin(Math.PI * tt);
          q.push(PW(uu - w, b, 0));
        }
        for (let k = 4; k >= 0; k--) {
          const tt = k / 4;
          const b = lerp(sp.top(u) * 1.15, -sp.bot(u) * 1.15, tt);
          const uu = u + sl * (tt - 0.5) * 2 + bw * Math.sin(Math.PI * tt);
          q.push(PW(uu + w, b, 0));
        }
        ctx.fillStyle = cs(mixc(pt.col, fog, fogT * 0.75), pt.a);
        ctx.fill(crClosed(q, 0.34));
      } else if (pt.t === 'band') {
        const q = [], q2 = [];
        const M = 8;
        for (let k = 0; k <= M; k++) {
          const tt = k / M, u = lerp(pt.u0, pt.u1, tt);
          const hT = sp.top(u), hB = sp.bot(u);
          const f0 = pt.b0, f1 = pt.b1;
          const y0 = f0 >= 0 ? hT * f0 : -hB * (-f0);
          const y1 = f1 >= 0 ? hT * f1 : -hB * (-f1);
          q.push(PW(u, y1, 0));
          q2.push(PW(u, y0, 0));
        }
        const pts = q.concat(q2.reverse());
        const bandPath = crClosed(pts, 0.34);
        if (pt.col2) {
          const a0 = PW(pt.u0, 0, 0), a1 = PW(pt.u1, 0, 0);
          const g = ctx.createLinearGradient(a0[0], a0[1], a1[0], a1[1]);
          g.addColorStop(0, cs(mixc(pt.col, fog, fogT * 0.7), pt.a * 0.8));
          g.addColorStop(0.5, cs(mixc(pt.col2, fog, fogT * 0.6), pt.a));
          g.addColorStop(1, cs(mixc(pt.col, fog, fogT * 0.7), pt.a * 0.85));
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = cs(mixc(pt.col, fog, fogT * 0.7), pt.a);
        }
        ctx.fill(bandPath);
        if (pt.glow) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = cs(mixc(pt.col2 || pt.col, [255, 255, 255], 0.4), 0.20 + 0.4 * broad);
          ctx.fill(bandPath);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    }

    // блик по спине + свет луча/каустики
    const lum = f.lightSm;
    ctx.globalCompositeOperation = 'lighter';
    const sA = P(0.42, sp.top(0.42) * 1.25, wv(0.42));
    const sB = P(0.42, -sp.bot(0.42) * 0.1, wv(0.42));
    const sg = ctx.createLinearGradient(sA[0], sA[1], sB[0], sB[1]);
    const sheen = (0.10 + 0.28 * lum) * (0.35 + 0.65 * broad);
    sg.addColorStop(0, 'rgba(210,246,255,' + (sheen * 0.55).toFixed(3) + ')');
    sg.addColorStop(0.35, 'rgba(255,246,220,' + sheen.toFixed(3) + ')');
    sg.addColorStop(1, 'rgba(255,246,220,0)');
    ctx.fillStyle = sg;
    ctx.fill(body);
    ctx.globalCompositeOperation = 'source-over';

    // подбрюшье в тени
    const shA = P(0.45, -sp.bot(0.45) * 1.15, wv(0.45));
    const shB = P(0.45, -sp.bot(0.45) * 0.15, wv(0.45));
    const shg = ctx.createLinearGradient(shA[0], shA[1], shB[0], shB[1]);
    shg.addColorStop(0, 'rgba(8,26,38,0.28)');
    shg.addColorStop(1, 'rgba(8,26,38,0)');
    ctx.fillStyle = shg;
    ctx.fill(body);

    ctx.restore();

    // контур: тёмный низ / светлый верх — по гладким кривым
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.6, L * 0.008);
    ctx.strokeStyle = 'rgba(6,22,32,0.34)';
    ctx.stroke(crOpen(bot, 0.45));
    ctx.strokeStyle = 'rgba(226,248,255,' + (0.10 + 0.22 * lum).toFixed(3) + ')';
    ctx.stroke(crOpen(top, 0.45));

    /* ---- жаберная крышка ---- */
    const gill = [];
    for (let i = 0; i <= 5; i++) {
      const tt = i / 5;
      const b = lerp(sp.top(0.22) * 0.92, -sp.bot(0.24) * 0.9, tt);
      const uu = 0.245 - 0.045 * Math.sin(Math.PI * tt);
      gill.push(PW(uu, b, nearSide * sp.thick * 0.5));
    }
    ctx.strokeStyle = 'rgba(10,30,40,0.20)';
    ctx.lineWidth = Math.max(0.5, L * 0.007);
    ctx.stroke(crOpen(gill, 0.45));

    /* ---- рот ---- */
    const mo = f.mouth * 0.035;
    const m1 = PW(0.012, sp.top(0.03) * 0.15 + mo * 0.5, nearSide * sp.thick * 0.35);
    const mc = PW(0.048, -sp.bot(0.06) * 0.10 - mo * 0.35, nearSide * sp.thick * 0.35);
    const m2 = PW(0.085, -sp.bot(0.10) * 0.30 - mo, nearSide * sp.thick * 0.35);
    ctx.strokeStyle = 'rgba(12,20,28,0.5)';
    ctx.lineWidth = Math.max(0.6, L * 0.009);
    ctx.beginPath();
    ctx.moveTo(m1[0], m1[1]);
    ctx.quadraticCurveTo(mc[0], mc[1], m2[0], m2[1]);
    ctx.stroke();

    /* ---- глаз: тёмная радужка, тонкое светлое кольцо, мелкий блик ---- */
    const ey = sp.eye;
    const ec = PW(ey.u, sp.top(ey.u) * ey.b, nearSide * sp.thick * 0.9);
    const er = Math.max(0.9, L * ey.r * 0.72);
    const irisC = mixc(ey.iris, fog, fogT * 0.35);
    // глазница
    ctx.fillStyle = cs(mixc(irisC, [0, 0, 0], 0.30), 0.92);
    ctx.beginPath(); ctx.ellipse(ec[0], ec[1], er * 1.10, er * 1.02, 0, 0, TAU); ctx.fill();
    // радужка с объёмом
    const ig = ctx.createRadialGradient(ec[0] - er * 0.24, ec[1] - er * 0.28, er * 0.06, ec[0], ec[1], er);
    ig.addColorStop(0, cs(mixc(irisC, [128, 158, 176], 0.42), 1));
    ig.addColorStop(0.58, cs(irisC, 1));
    ig.addColorStop(1, cs(mixc(irisC, [0, 0, 0], 0.45), 1));
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.ellipse(ec[0], ec[1], er * 0.90, er * 0.90, 0, 0, TAU); ctx.fill();
    // зрачок
    ctx.fillStyle = 'rgba(5,8,12,0.9)';
    ctx.beginPath(); ctx.arc(ec[0], ec[1], er * 0.40, 0, TAU); ctx.fill();
    // тонкое светлое кольцо по краю
    ctx.strokeStyle = cs(mixc(ey.ring, fog, fogT * 0.5), 0.55);
    ctx.lineWidth = Math.max(0.4, er * 0.16);
    ctx.beginPath(); ctx.ellipse(ec[0], ec[1], er * 0.99, er * 0.92, 0, 0, TAU); ctx.stroke();
    // маленький блик
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(ec[0] - er * 0.32, ec[1] - er * 0.34, er * 0.19, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(150,220,255,0.35)';
    ctx.beginPath(); ctx.arc(ec[0] + er * 0.30, ec[1] + er * 0.26, er * 0.11, 0, TAU); ctx.fill();

    /* ---- ближний грудной ---- */
    if (sp.pect) drawPect(nearSide);

    ctx.filter = 'none';
    ctx.restore();
  }

  /* ---------------- лучи, пузыри, взвесь ---------------- */
  function drawRays(t, front) {
    if (cfg.light <= 0.01 || !texRay) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i];
      const x = rayX(r, t);
      const breathe = 0.82 + 0.28 * fsin(t * 0.37 + r.ph * 1.7);
      const w = r.w * breathe;
      const a = clamp((front ? 0.16 : 0.11) * r.a * cfg.light * (0.75 + 0.35 * fsin(t * 0.23 + r.ph)), 0, 1);
      if (a < 0.004) continue;
      ctx.globalAlpha = a;
      ctx.save();
      ctx.translate(x, -H * 0.06);
      ctx.rotate(r.tilt);
      const tex = r.tex ? texRay2 : texRay;
      ctx.drawImage(tex, -w * 1.6, 0, w * 3.2, r.h * 1.15);
      ctx.globalAlpha = a * 0.85;
      ctx.drawImage(tex, -w * 0.55, 0, w * 1.1, r.h * 0.95);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawBubbles(t) {
    ctx.save();
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      const s = scaleAt(b.z);
      const r = b.r * s;
      if (r < 0.4) continue;
      const a = b.a * clamp(1 - b.z * 0.4 * cfg.haze, 0.2, 1);
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU);
      ctx.fillStyle = 'rgba(180,232,244,0.055)'; ctx.fill();
      ctx.lineWidth = Math.max(0.5, r * 0.20);
      ctx.strokeStyle = 'rgba(206,242,250,0.34)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.92, TAU * 0.08, TAU * 0.42);
      ctx.lineWidth = Math.max(0.5, r * 0.17);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.stroke();
      if (r > 1.6) {
        ctx.beginPath(); ctx.arc(b.x - r * 0.33, b.y - r * 0.36, r * 0.22, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawSnow(near) {
    if (!texDot) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < snow.length; i++) {
      const p = snow[i];
      const isNear = p.z < 0.16;
      if (isNear !== near) continue;
      const s = scaleAt(p.z);
      const r = p.r * s * (isNear ? 4.5 : 1.6);
      ctx.globalAlpha = clamp(p.a * (isNear ? 0.30 : 0.65) * clamp(1 - p.z * 0.4, 0.2, 1), 0, 1);
      ctx.drawImage(texDot, p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawFood() {
    ctx.save();
    for (let i = 0; i < food.length; i++) {
      const p = food[i];
      const s = scaleAt(p.z);
      const r = p.r * s;
      ctx.globalAlpha = clamp(p.life / 5, 0, 1) * 0.9;
      ctx.fillStyle = 'rgba(226,168,88,0.9)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * (1 + 0.4 * Math.sin(p.ph)), r * 0.55, p.ph, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPuffs() {
    if (!texDot) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      const r = p.r * (1 + (1 - p.life / p.max) * 2.4);
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * 0.25;
      ctx.drawImage(texDot, p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawSurface(t) {
    const h = H * 0.16;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(190,252,255,' + (0.22 * cfg.light).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(190,252,255,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, h);
    // блики на изнанке поверхности
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const yb = H * (0.012 + i * 0.019);
      ctx.beginPath();
      for (let x = -20; x <= W + 20; x += 22) {
        const y = yb + fsin(x * 0.006 + t * (0.5 + i * 0.13) + i * 2) * H * 0.010
          + fsin(x * 0.017 - t * 0.7 + i) * H * 0.005;
        if (x < 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineWidth = (1.4 + i * 0.5) * (H / 800 + 0.6);
      ctx.strokeStyle = 'rgba(214,252,255,' + (0.10 * cfg.light * (1 - i * 0.15)).toFixed(3) + ')';
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGrade() {
    // виньетка
    const g = ctx.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.28, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.62, 'rgba(2,14,22,0.16)');
    g.addColorStop(1, 'rgba(1,9,16,0.56)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // лёгкая холодная подложка по краям + тёплый верх
    const g2 = ctx.createLinearGradient(0, 0, 0, H);
    g2.addColorStop(0, 'rgba(150,236,246,0.055)');
    g2.addColorStop(0.5, 'rgba(0,0,0,0)');
    g2.addColorStop(1, 'rgba(28,60,46,0.07)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
  }

  function fogWash(strength) {
    if (cfg.haze <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = clamp(strength * cfg.haze, 0, 1);
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ---------------- симуляция ---------------- */
  let simTime = 0;

  function stepSim(dt, t) {
    // ---- школа: общий аттрактор
    schoolTarget.t += dt;
    const stz = 0.5 + 0.32 * (fbm(schoolTarget.t * 0.06 + 5) - 0.5) * 2;
    schoolTarget.z = clamp(stz, 0.18, 0.85);
    const stsc = scaleAt(schoolTarget.z);
    schoolTarget.x = W * (0.5 + 0.42 * (fbm(schoolTarget.t * 0.045) - 0.5) * 2);
    schoolTarget.y = lerp(H * 0.18, floorYAt(schoolTarget.z) - 60 * stsc, 0.35 + 0.5 * fbm(schoolTarget.t * 0.05 + 20));

    // ---- рыбы
    for (let i = 0; i < fishes.length; i++) {
      const f = fishes[i];
      f.wt += dt;
      const sp = f.sp;
      f.sc = scaleAt(f.z);
      f.x = CX + f.wx * f.sc;
      f.y = HOR + f.wy * f.sc;

      let dx = Math.cos(f.yaw), dy = Math.sin(f.pitch), dz = Math.sin(f.yaw);
      let wgt = 0.85;

      // блуждание
      const n1 = fbm(f.seed * 3.1 + f.wt * 0.19) - 0.5;
      const n2 = fbm(f.seed * 7.3 + 40 + f.wt * 0.15) - 0.5;
      const n3 = fbm(f.seed * 11.7 + 80 + f.wt * 0.11) - 0.5;
      const wyaw = f.yaw + n1 * sp.turn * 2.4;
      dx += Math.cos(wyaw) * 0.9; dz += Math.sin(wyaw) * 0.9;
      dy += n2 * 0.55;
      wgt += 0.9;

      // стая
      if (sp.school) {
        let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0, cxs = 0, cys = 0, czs = 0, cnt = 0;
        for (let j = 0; j < fishes.length; j++) {
          if (j === i) continue;
          const o = fishes[j];
          if (!o.sp.school) continue;
          const ddx = o.x - f.x, ddy = o.y - f.y, ddz = (o.z - f.z) * 420;
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 > 34000 || d2 < 0.01) continue;
          const d = Math.sqrt(d2);
          cnt++;
          cxs += ddx; cys += ddy; czs += (o.z - f.z);
          ax += Math.cos(o.yaw); ay += Math.sin(o.pitch); az += Math.sin(o.yaw);
          if (d < 46) { const k = (46 - d) / 46 / (d + 1); sx -= ddx * k * 8; sy -= ddy * k * 8; sz -= (o.z - f.z) * k * 8; }
        }
        if (cnt > 0) {
          dx += (cxs / cnt) * 0.020 + ax / cnt * 1.1 + sx * 0.12;
          dy += -(cys / cnt) * 0.020 - ay / cnt * 0.5 - sy * 0.10;
          dz += (czs / cnt) * 2.4 + az / cnt * 1.1 + sz * 2.0;
          wgt += 2.0;
        }
        // тяга к общей цели школы
        const tdx = schoolTarget.x - f.x, tdy = schoolTarget.y - f.y, tdz = schoolTarget.z - f.z;
        dx += clamp(tdx * 0.006, -1.4, 1.4);
        dy += clamp(-tdy * 0.006, -1.0, 1.0);
        dz += clamp(tdz * 2.6, -1.4, 1.4);
        wgt += 1.0;
      }

      // корм
      f.urg = Math.max(0, f.urg - dt * 0.55);
      let best = -1, bestD = 1e9;
      for (let j = 0; j < food.length; j++) {
        const p = food[j];
        if (p.eaten) continue;
        const ddx = p.x - f.x, ddy = p.y - f.y, ddz = (p.z - f.z) * 400;
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 < bestD && d2 < 190000) { bestD = d2; best = j; }
      }
      if (best >= 0) {
        const p = food[best];
        const d = Math.sqrt(bestD) || 1;
        dx += (p.x - f.x) / d * 3.2;
        dy += -(p.y - f.y) / d * 2.4;
        dz += (p.z - f.z) * 3.2;
        wgt += 3.0;
        f.urg = Math.min(1, f.urg + dt * 2.2);
        if (d < f.len * f.sc * 0.42) {
          p.eaten = true; p.life = 0;
          f.mouth = 1;
          puffs.push({ x: p.x, y: p.y, r: 6 * f.sc, life: 0.5, max: 0.5 });
        }
      }

      // стенки: экран + глубина + дно/поверхность
      const mx = W * 0.13;
      if (f.x < mx) { const k = (1 - f.x / mx); dx += k * 4.5; wgt += k * 3; }
      if (f.x > W - mx) { const k = (1 - (W - f.x) / mx); dx -= k * 4.5; wgt += k * 3; }
      const topY = H * 0.09, botY = floorYAt(f.z) - f.len * f.sc * 0.42;
      if (f.y < topY) { const k = clamp((topY - f.y) / (H * 0.12), 0, 1.6); dy -= k * 3.2; wgt += k * 2.4; }
      if (f.y > botY) { const k = clamp((f.y - botY) / (H * 0.12), 0, 1.6); dy += k * 3.6; wgt += k * 2.6; }
      if (f.z < 0.10) { const k = (0.10 - f.z) * 12; dz += k * 2.4; wgt += k; }
      if (f.z > 0.90) { const k = (f.z - 0.90) * 12; dz -= k * 2.4; wgt += k; }

      // желаемое направление
      const hl = Math.hypot(dx, dz) || 0.0001;
      const desYaw = Math.atan2(dz, dx);
      const desPitch = clamp(Math.atan2(dy, hl), -0.42, 0.42);

      const dyaw = angDiff(desYaw, f.yaw);
      const maxTurn = sp.turnRate * (0.7 + 1.4 * f.urg);
      const targetRate = clamp(dyaw * 2.6, -maxTurn, maxTurn);
      const kk = 1 - Math.exp(-dt * 4.5);
      f.yawRate += (targetRate - f.yawRate) * kk;
      f.yaw += f.yawRate * dt;
      if (f.yaw > Math.PI) f.yaw -= TAU; else if (f.yaw < -Math.PI) f.yaw += TAU;
      f.pitch += clamp(angDiff(desPitch, f.pitch) * 2.0, -1.2, 1.2) * dt;
      f.pitch = clamp(f.pitch, -0.5, 0.5);

      // крен в повороте
      const rollT = clamp(f.yawRate * 0.42, -0.45, 0.45) * (0.35 + 0.65 * Math.abs(Math.cos(f.yaw)))
        + fsin(f.wt * 0.5 + f.seed) * 0.045;
      f.roll += (rollT - f.roll) * (1 - Math.exp(-dt * 3.2));

      // скорость
      const tgtSpd = sp.speed * (0.82 + 0.28 * (n3 + 0.5)) * cfg.flow * (1 + 1.5 * f.urg);
      f.spd += (tgtSpd - f.spd) * (1 - Math.exp(-dt * 1.6));

      const cpp = Math.cos(f.pitch);
      f.wx += f.spd * cpp * Math.cos(f.yaw) * dt;
      f.wy -= f.spd * Math.sin(f.pitch) * dt;
      f.z += f.spd * cpp * Math.sin(f.yaw) * dt * 0.00055;
      f.z = clamp(f.z, 0.05, 0.95);
      f.sc = scaleAt(f.z);
      f.x = CX + f.wx * f.sc;
      f.y = HOR + f.wy * f.sc;

      // жёсткая страховка от улёта за кадр
      if (f.x < -W * 0.35) { f.wx = (-W * 0.35 - CX) / f.sc; }
      if (f.x > W * 1.35) { f.wx = (W * 1.35 - CX) / f.sc; }
      if (f.y < -H * 0.2) f.wy = (-H * 0.2 - HOR) / f.sc;
      if (f.y > floorYAt(f.z) + 10) f.wy = (floorYAt(f.z) + 10 - HOR) / f.sc;

      // анимация
      const rel = clamp(f.spd / (sp.speed * cfg.flow || 1), 0.35, 2.2);
      f.phase += TAU * sp.beat * (0.5 + 0.72 * rel) * dt;
      if (f.phase > TAU * 1024) f.phase -= TAU * 1024;
      f.amp = sp.amp * (0.72 + 0.42 * rel) + Math.min(0.05, Math.abs(f.yawRate) * 0.018);
      f.bend += (clamp(-f.yawRate * 0.16, -0.14, 0.14) - f.bend) * (1 - Math.exp(-dt * 4));
      f.mouth *= Math.exp(-dt * 2.6);
      if (rnd() < dt * 0.35 && f.mouth < 0.2) f.mouth = 0.5;
      f.lightSm += (clamp(lightAt(f.x, f.y, t) * 0.45 + causticAt(f.x, f.y, t) * 0.5 * clamp(cfg.light, 0, 1.5), 0, 1.2) - f.lightSm) * (1 - Math.exp(-dt * 4));

      // редкие пузырьки изо рта
      f.bubbleT -= dt;
      if (f.bubbleT <= 0) {
        f.bubbleT = rr(6, 26);
        const bp = [f.x + Math.cos(f.yaw) * f.len * f.sc * 0.5, f.y - f.len * f.sc * 0.05];
        addBubble(bp[0], bp[1], f.z, rr(1.2, 2.6) * 1.4, rr(20, 34));
      }
    }

    // ---- пузыри
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      const s = scaleAt(b.z);
      b.ph += dt * 2.2;
      b.y -= b.vy * s * dt * (0.8 + b.r * 0.04);
      b.x += Math.sin(b.ph) * b.w * s * dt * 2.2;
      if (b.y < H * 0.10) b.a -= dt * 1.6;
      if (b.y < -20 || b.a <= 0) bubbles.splice(i, 1);
    }
    for (let i = 0; i < emitters.length; i++) {
      const e = emitters[i];
      e.t -= dt;
      if (e.t <= 0) {
        e.t = e.rate * rr(0.5, 1.6);
        const s = scaleAt(e.z);
        addBubble(CX + e.wx * s + rr(-6, 6) * s, floorYAt(e.z) - 4 * s, e.z, rr(1.4, 4.6), rr(24, 44));
      }
    }

    // ---- взвесь
    for (let i = 0; i < snow.length; i++) {
      const p = snow[i];
      const s = scaleAt(p.z);
      p.ph += dt * 0.6;
      p.x += (p.vx + Math.sin(p.ph) * 4) * s * dt;
      p.y += (p.vy + Math.cos(p.ph * 0.7) * 3) * s * dt;
      if (p.x < -20) p.x = W + 20; else if (p.x > W + 20) p.x = -20;
      if (p.y < -20) p.y = H + 20; else if (p.y > H + 20) p.y = -20;
    }

    // ---- корм
    for (let i = food.length - 1; i >= 0; i--) {
      const p = food[i];
      p.life -= dt;
      if (p.eaten || p.life <= 0) { food.splice(i, 1); continue; }
      const s = scaleAt(p.z);
      p.ph += dt * 1.6;
      p.x += (p.vx + Math.sin(p.ph) * 9) * s * dt;
      p.y += p.vy * s * dt;
      p.vy = Math.min(p.vy + dt * 3, 20);
      if (p.y > floorYAt(p.z) - 2) { p.y = floorYAt(p.z) - 2; p.vy = 0; }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      puffs[i].life -= dt;
      if (puffs[i].life <= 0) puffs.splice(i, 1);
    }

    // ---- растения: отклик на течение и рыб
    for (let i = 0; i < plants.length; i++) {
      const pl = plants[i];
      const s = scaleAt(pl.z);
      const bx = CX + pl.wx * s, by = HOR + FY * s;
      let force = 0;
      for (let j = 0; j < fishes.length; j++) {
        const f = fishes[j];
        if (Math.abs(f.z - pl.z) > 0.22) continue;
        const dxp = f.x - bx, dyp = f.y - (by - pl.h * s * 0.5);
        const d2 = dxp * dxp + dyp * dyp;
        const rad = pl.h * s * 0.55;
        if (d2 < rad * rad) {
          const d = Math.sqrt(d2) || 1;
          force += (1 - d / rad) * Math.cos(f.yaw) * (f.spd / 60) * 0.5;
        }
      }
      pl.pushV += (force - pl.push * 3.2) * dt * 9;
      pl.pushV *= Math.exp(-dt * 2.4);
      pl.push += pl.pushV * dt;
      pl.push = clamp(pl.push, -0.55, 0.55);
    }
  }

  /* ---------------- кадр ---------------- */
  const drawList = [];
  function renderFrame(t) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';

    drawWater();
    drawRays(t, false);
    drawFarReef(t);
    drawSand(t);
    drawShadows(t);

    // единый список по глубине
    drawList.length = 0;
    for (let i = 0; i < plants.length; i++) drawList.push({ z: plants[i].z, k: 0, o: plants[i] });
    for (let i = 0; i < rocks.length; i++) drawList.push({ z: rocks[i].z + 0.001, k: 1, o: rocks[i] });
    for (let i = 0; i < fishes.length; i++) drawList.push({ z: fishes[i].z, k: 2, o: fishes[i] });
    drawList.sort((a, b) => b.z - a.z);

    let f1 = false, f2 = false;
    for (let i = 0; i < drawList.length; i++) {
      const d = drawList[i];
      if (!f1 && d.z < 0.62) { fogWash(0.30); f1 = true; }
      if (!f2 && d.z < 0.30) { fogWash(0.16); f2 = true; }
      if (d.k === 0) drawPlant(d.o, t);
      else if (d.k === 1) drawRock(d.o, t);
      else drawFish(d.o, t);
    }
    if (!f1) fogWash(0.30);
    if (!f2) fogWash(0.16);

    drawFood();
    drawPuffs();
    drawSnow(false);
    drawRays(t, true);
    drawBubbles(t);
    drawSurface(t);
    drawSnow(true);
    drawGrade();
  }

  /* ---------------- размеры ---------------- */
  function resize() {
    const w = Math.max(320, window.innerWidth | 0);
    const h = Math.max(240, window.innerHeight | 0);
    let dpr = Math.min(window.devicePixelRatio || 1, DPRCAP);
    if (w * h * dpr * dpr > 4.6e6) dpr = Math.max(1, Math.sqrt(4.6e6 / (w * h)));
    DPR = dpr;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    W = w; H = h; CX = W * 0.5;
    HOR = H * 0.585; FY = H * 0.2555;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    buildGradients();
    buildScenery();
    buildRays();
    buildSnow();
    initCaustics();
    texRay = makeRayTex(96, 512, 0.22, 0.72);
    texRay2 = makeRayTex(96, 512, 0.36, 0.62);
    texDot = makeDotTex(64, [214, 244, 252]);
    texWarm = makeDotTex(64, [255, 232, 176]);
    if (!sandPat) {
      const pc = makeSandPattern();
      sandPat = ctx.createPattern(pc, 'repeat');
    }
  }

  /* ---------------- управление ---------------- */
  function bindUI() {
    const el = id => document.getElementById(id);
    const pairs = [
      ['sFish', 'vFish', v => { cfg.fish = v; rebuildFish(); }],
      ['sLight', 'vLight', v => { cfg.light = v; }],
      ['sHaze', 'vHaze', v => { cfg.haze = v; }],
      ['sFlow', 'vFlow', v => { cfg.flow = v; }]
    ];
    for (let i = 0; i < pairs.length; i++) {
      const s = el(pairs[i][0]), o = el(pairs[i][1]), fn = pairs[i][2];
      if (!s) continue;
      const upd = () => {
        const v = parseFloat(s.value);
        fn(v);
        if (o) o.textContent = '×' + v.toFixed(1);
      };
      s.addEventListener('input', upd);
      upd();
    }
    const bf = el('bFeed');
    if (bf) bf.addEventListener('click', () => dropFood(rr(W * 0.25, W * 0.75), H * 0.16));
    const bp = el('bPause');
    if (bp) bp.addEventListener('click', () => {
      cfg.paused = !cfg.paused;
      bp.textContent = cfg.paused ? 'Пуск' : 'Пауза';
      bp.classList.toggle('on', cfg.paused);
    });
    cv.addEventListener('pointerdown', e => {
      const r = cv.getBoundingClientRect();
      dropFood(e.clientX - r.left, e.clientY - r.top);
    });
    window.addEventListener('keydown', e => {
      if (e.code === 'Space') { e.preventDefault(); if (bp) bp.click(); }
      else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') { if (bf) bf.click(); }
    });
    window.addEventListener('resize', () => { resize(); });
  }

  /* ---------------- цикл ---------------- */
  let last = 0, acc = 0, frames = 0, degraded = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    if (!last) last = now;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;

    if (!cfg.paused) {
      simTime += dt;
      stepSim(dt, simTime);
      caus.tick++;
      if (caus.tick % quality.causticStep === 0) updateCaustics(simTime);
    }
    renderFrame(simTime);

    // адаптивное качество
    acc += dt; frames++;
    if (frames >= 70) {
      const avg = acc / frames;
      acc = 0; frames = 0;
      if (avg > 0.026 && degraded < 3) {
        degraded++;
        if (degraded === 1) quality.blur = false;
        else if (degraded === 2) quality.causticStep = 2;
        else if (degraded === 3) { DPRCAP = 1.25; resize(); }
      }
    }
  }

  /* ---------------- старт ---------------- */
  function init() {
    defSpecies();
    resize();
    rebuildFish();
    bindUI();
    // «прогрев» сцены — чтобы первый кадр был уже живым
    for (let i = 0; i < 150; i++) { simTime += 1 / 30; stepSim(1 / 30, simTime); }
    updateCaustics(simTime);
    requestAnimationFrame(loop);
  }

  init();
})();
