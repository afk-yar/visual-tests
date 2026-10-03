/* Полярное сияние — Claude Sonnet 5.5
 *
 * Canvas 2D, без библиотек.
 *
 * Занавесы сияния — это не рисованные градиенты, а ленты в 3D: у каждой есть
 * кривая на «земле» Z(u,t) (глубина), которая колышется бегущими волнами.
 * Лента сэмплируется ~1300 точками; каждая точка проецируется в экран и рисуется
 * тонкой вертикальной полоской (спрайт-палитра «низ яркий и розовый → зелёный →
 * голубой → фиолетовый → тьма») с аддитивным смешиванием. Там, где лента
 * в проекции складывается ребром к зрителю, полоски копятся и дают яркие
 * складки — как в настоящем сиянии. Лучи — шум по длине ленты, дрейфующий и
 * «дышащий». Поверх — пирамида размытий (bloom), звёзды с мерцанием и вращением
 * неба, Млечный Путь, метеоры, силуэт гор и леса, озеро с отражением.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { return (r() + r() + r() + r() - 2) * 1.732; }

  /* ---------- периодические таблицы шума (1D, значения 0..1) ---------- */
  function makeTable(N, cells, weights, rnd, spread) {
    var tab = new Float32Array(N), o, i;
    for (o = 0; o < cells.length; o++) {
      var c = cells[o], vals = new Float32Array(c);
      for (i = 0; i < c; i++) vals[i] = rnd();
      var wgt = weights[o];
      for (i = 0; i < N; i++) {
        var p = i / N * c, i0 = Math.floor(p), fr = p - i0;
        var a = vals[i0 % c], b = vals[(i0 + 1) % c];
        var s = fr * fr * (3 - 2 * fr);
        tab[i] += (a + (b - a) * s - 0.5) * wgt;
      }
    }
    var mean = 0, v = 0;
    for (i = 0; i < N; i++) mean += tab[i];
    mean /= N;
    for (i = 0; i < N; i++) { var d = tab[i] - mean; v += d * d; }
    var sd = Math.sqrt(v / N) || 1;
    for (i = 0; i < N; i++) tab[i] = clamp(0.5 + (tab[i] - mean) / sd * spread, 0, 1);
    return tab;
  }
  function sampleTable(tab, x) {
    var N = tab.length;
    var p = (x - Math.floor(x)) * N;
    var i0 = p | 0, f = p - i0;
    var a = tab[i0], b = tab[i0 + 1 === N ? 0 : i0 + 1];
    return a + (b - a) * f;
  }

  var TAB_A = makeTable(4096, [7, 19, 47, 113, 271], [1, 0.85, 0.65, 0.5, 0.15], rng32(11), 0.22);
  var TAB_B = makeTable(4096, [5, 17, 53, 131, 307], [1, 0.8, 0.7, 0.5, 0.14], rng32(23), 0.22);
  // мерцание яркости — только крупнее ~15 px, иначе шаг полосок даёт мелкую «сетку»
  var TAB_F = makeTable(2048, [9, 23, 57], [1, 0.7, 0.4], rng32(37), 0.22);
  var TAB_H = makeTable(1024, [3, 7, 15], [1, 0.6, 0.3], rng32(5), 0.26);

  /* ---------- палитра: «спектр» m (0 изумруд → 1 багрянец) × высота u ---------- */
  var RAMP_H = 256, RAMP_M = 32;
  var ANCH = [
    // 0: изумруд — розовая кромка, белёсо-зелёный пик, зелёный, бирюза, синий, фиолет
    [[0, 255, 70, 140], [0.025, 190, 255, 200], [0.08, 105, 255, 130], [0.22, 70, 250, 112],
     [0.40, 50, 238, 145], [0.55, 40, 200, 210], [0.72, 70, 140, 240], [0.88, 140, 70, 220], [1, 110, 40, 180]],
    // 1: лёд — циан/лазурь
    [[0, 255, 110, 200], [0.03, 170, 255, 245], [0.12, 60, 235, 255], [0.35, 50, 170, 255],
     [0.60, 90, 110, 250], [0.85, 150, 80, 235], [1, 110, 50, 190]],
    // 2: пурпур
    [[0, 255, 90, 170], [0.04, 255, 160, 225], [0.12, 240, 70, 200], [0.35, 190, 60, 235],
     [0.60, 130, 60, 235], [0.85, 90, 70, 210], [1, 70, 50, 170]],
    // 3: багрянец (высотное красное)
    [[0, 255, 70, 120], [0.05, 255, 110, 150], [0.20, 255, 50, 100], [0.50, 230, 40, 130],
     [0.80, 170, 50, 200], [1, 110, 40, 170]]
  ];
  function anchorAt(set, u, o) {
    var i = 0;
    while (i < set.length - 2 && u > set[i + 1][0]) i++;
    var a = set[i], b = set[i + 1], t = clamp((u - a[0]) / (b[0] - a[0]), 0, 1);
    o[0] = a[1] + (b[1] - a[1]) * t;
    o[1] = a[2] + (b[2] - a[2]) * t;
    o[2] = a[3] + (b[3] - a[3]) * t;
  }
  // яркость по высоте занавеса. kind 0 — резкий нижний край с горячей кромкой (ближние занавесы),
  // 1 — чуть смягчённый, 2 — размытое основание без кромки (дальняя дымка: у неё нет «контура»)
  function profile(u, kind) {
    var rise, hot, dec;
    if (kind === 2) { rise = smooth(0, 0.34, u); hot = 0; dec = 1.35 * Math.exp(-1.9 * u); }
    else if (kind === 1) { rise = 0.2 + 0.8 * smooth(0, 0.1, u); hot = 0.12 * Math.exp(-u / 0.03) * smooth(0, 0.01, u); dec = Math.exp(-2.6 * u); }
    else { rise = 0.5 + 0.5 * smooth(0, 0.018, u); hot = 0.3 * Math.exp(-u / 0.02) * smooth(0, 0.006, u); dec = Math.exp(-2.6 * u); }
    var base = rise * dec * (1 - smooth(0.4, 0.95, u));
    var d = (u - 0.7) / 0.2;
    var bump = 0.12 * Math.exp(-d * d) * (1 - smooth(0.85, 1, u));
    return base + hot + bump * (kind === 2 ? rise : 1);
  }
  var _c1 = [0, 0, 0], _c2 = [0, 0, 0];
  function rampColor(m, u, out, kind) {
    var x = clamp(m, 0, 1) * 3, k = Math.min(2, Math.floor(x)), fr = x - k;
    anchorAt(ANCH[k], u, _c1);
    anchorAt(ANCH[k + 1], u, _c2);
    var p = profile(u, kind || 0);
    out[0] = lerp(_c1[0], _c2[0], fr) * p;
    out[1] = lerp(_c1[1], _c2[1], fr) * p;
    out[2] = lerp(_c1[2], _c2[2], fr) * p;
  }

  /* ---------- ленты сияния ---------- */
  function rib(o) {
    o.pwInv = 1 / o.pw;
    return o;
  }
  var RIBBONS = [
    // 0: главный изумрудный занавес — близко, с крупными складками и резким нижним краем
    rib({ zc: 255, a0: 98, len: 175, arch: 0.16, tilt: -0.13, w: [0.12, 0.12, 0.02], f: [1.05, 3.1, 6.4], om: [0.21, -0.34, 0.58],
          ph: [0.4, 1.9, 4.1], pa: 0.05, pw: 0.15, pv: 0.055, po: 0.0, hue: [0.0, 0.2], gain: 1.15, rs: 1.0,
          d: [0.006, 0.009], o: [0.10, 0.55, 0.30, 0.70], hs: 1.0, hd: 0.004, ef: [0.9, 1.7], eo: [0.11, 0.17],
          kind: 0, rlo: 0.2, rfl: 0.12 }),
    // 1: бирюзово-голубая дымка среднего плана: почти плоское основание, размытый низ, выраженные лучи
    rib({ zc: 450, a0: 84, len: 75, arch: 0.07, tilt: -0.04, w: [0.06, 0.035, 0.012], f: [1.15, 2.9, 7.4], om: [-0.17, 0.29, -0.5],
          ph: [2.2, 0.7, 5.0], pa: 0.025, pw: 0.19, pv: -0.045, po: 1.1, hue: [0.22, 0.55], gain: 0.95, rs: 1.07,
          d: [-0.005, 0.011], o: [0.41, 0.12, 0.80, 0.25], hs: 1.2, hd: -0.003, ef: [1.1, 2.1], eo: [-0.13, 0.19],
          kind: 2, rlo: 0.3, rfl: 0.04 }),
    // 2: второй зелёный занавес чуть дальше, нижняя кромка мягче
    rib({ zc: 320, a0: 100, len: 150, arch: 0.10, tilt: 0.16, w: [0.10, 0.09, 0.016], f: [0.72, 2.5, 5.4], om: [0.15, -0.26, 0.4],
          ph: [3.3, 4.4, 1.2], pa: 0.04, pw: 0.16, pv: 0.04, po: 2.0, hue: [0.0, 0.5], gain: 0.85, rs: 0.93,
          d: [0.008, -0.007], o: [0.66, 0.33, 0.05, 0.50], hs: 0.9, hd: 0.005, ef: [0.8, 1.5], eo: [0.09, -0.15],
          kind: 1, rlo: 0.2, rfl: 0.1 }),
    // 3: дальняя пурпурная дымка у горизонта
    rib({ zc: 640, a0: 72, len: 70, arch: 0.08, tilt: -0.04, w: [0.045, 0.03, 0.01], f: [1.0, 2.6, 6.6], om: [0.14, 0.27, -0.45],
          ph: [5.0, 2.5, 0.9], pa: 0.02, pw: 0.2, pv: -0.05, po: 0.6, hue: [0.5, 0.9], gain: 1.0, rs: 1.13,
          d: [0.005, 0.01], o: [0.23, 0.88, 0.61, 0.15], hs: 1.4, hd: 0.003, ef: [1.2, 2.4], eo: [0.12, 0.2],
          kind: 2, rlo: 0.3, rfl: 0.04 }),
    // 4: высотное багровое мерцание
    rib({ zc: 840, a0: 130, len: 70, arch: 0.08, tilt: 0.03, w: [0.045, 0.03, 0.01], f: [0.9, 2.2, 5.5], om: [-0.12, 0.2, 0.35],
          ph: [1.4, 3.8, 2.6], pa: 0.02, pw: 0.25, pv: 0.035, po: 2.7, hue: [0.78, 1.0], gain: 0.5, rs: 0.87,
          d: [-0.004, 0.008], o: [0.77, 0.04, 0.39, 0.92], hs: 1.0, hd: 0.002, ef: [0.7, 1.4], eo: [0.1, -0.12],
          kind: 2, rlo: 0.3, rfl: 0.04 })
  ];

  function makeOut(cap) {
    return {
      cap: cap, n: 0, sumA: 0, sumAM: 0,
      sx: new Float32Array(cap), yt: new Float32Array(cap), yb: new Float32Array(cap),
      w: new Float32Array(cap), al: new Float32Array(cap), ray: new Float32Array(cap),
      mi: new Uint8Array(cap)
    };
  }

  /* g: {W, hz, f, cx, sA, Wa}   c: {gain, act, lenMul, density, palLo, palHi, palMix}
     Результат — массивы полосок в координатах буфера сияния. */
  function computeRibbon(rb, T, c, g, o) {
    var N = Math.min(o.cap, Math.ceil(g.Wa * 1.4 * c.density));
    var zc = rb.zc, f = g.f, cx = g.cx, hz = g.hz, sA = g.sA, act = c.act;
    var Xmax = zc * (0.5 * g.W / f) * 1.75;
    var TW = T * 1.5;
    var p0 = rb.ph[0] + rb.om[0] * TW, p1 = rb.ph[1] + rb.om[1] * TW, p2 = rb.ph[2] + rb.om[2] * TW;
    var uP = (((TW * rb.pv + rb.po) % 3.4) + 3.4) % 3.4 - 1.7;
    var lo = lerp(rb.hue[0], c.palLo, c.palMix), hi = lerp(rb.hue[1], c.palHi, c.palMix);
    var sx = o.sx, yt = o.yt, yb = o.yb, al = o.al, mi = o.mi, ray = o.ray, ww = o.w;
    var sumA = 0, sumAM = 0, i, kOff = rb.kind * RAMP_M;
    var sw = 1 / (N - 1);
    for (i = 0; i < N; i++) {
      var u = -1 + 2 * i * sw, t01 = u * 0.5 + 0.5;
      // форма ленты по глубине: арка + наклон + бегущие волны + одиночный «накат»
      var zf = 1 + rb.arch * u * u + rb.tilt * u +
        act * (rb.w[0] * Math.sin(TAU * rb.f[0] * u + p0) +
               rb.w[1] * Math.sin(TAU * rb.f[1] * u + p1) +
               rb.w[2] * Math.sin(TAU * rb.f[2] * u + p2));
      var dp = (u - uP) * rb.pwInv;
      zf -= rb.pa * act * Math.exp(-dp * dp);
      if (zf < 0.5) zf = 0.5;
      var Z = zc * zf;
      sx[i] = (cx + f * (u * Xmax) / Z) * sA;

      // лучи: две таблицы шума, дрейфующие в разные стороны (интерференция = «живость»)
      var r1 = sampleTable(TAB_A, t01 * rb.rs + T * rb.d[0] * 1.6 + rb.o[0]);
      var r2 = sampleTable(TAB_B, t01 * rb.rs * 1.37 - T * rb.d[1] * 1.6 + rb.o[1]);
      var rn = smooth(rb.rlo, 0.82, 0.58 * r1 + 0.42 * r2);
      var fl = sampleTable(TAB_F, t01 * rb.rs + T * 0.012 + rb.o[2]);
      var hn = sampleTable(TAB_H, t01 * rb.hs + T * rb.hd + rb.o[3]);
      var e1 = 0.5 + 0.5 * Math.sin(TAU * rb.ef[0] * u + T * rb.eo[0] + rb.ph[2]);
      var e2 = 0.5 + 0.5 * Math.sin(TAU * rb.ef[1] * u - T * rb.eo[1] + rb.ph[0] * 2.3);
      var envl = 0.1 + 0.9 * smooth(0.12, 0.88, 0.55 * e1 + 0.45 * e2);

      // высота: нижний кромка колышется, длина луча зависит от шума
      var a0 = rb.a0 + act * (5.5 * Math.sin(TAU * 1.3 * u + T * 0.4 + rb.ph[1]) + 3 * Math.sin(TAU * 3.1 * u - T * 0.6));
      var len = rb.len * c.lenMul * (0.42 + 0.58 * rn) * (0.75 + 0.5 * envl);
      yb[i] = (hz - f * a0 / Z) * sA;
      yt[i] = (hz - f * (a0 + len) / Z) * sA;

      var edge = smooth(1.0, 0.86, Math.abs(u));
      var breath = 0.9 + 0.1 * Math.sin(T * 1.3 + u * 11 + rb.ph[0]);
      var A = rb.gain * c.gain * (rb.rfl + (1 - rb.rfl) * rn) * (0.8 + 0.4 * fl) * envl * breath * Math.sqrt(400 / Z) * edge;
      al[i] = A;
      ray[i] = rn * envl;
      var m = lerp(lo, hi, hn);
      mi[i] = Math.round(clamp(m, 0, 1) * (RAMP_M - 1)) + kOff;
      sumA += A; sumAM += A * m;
    }
    // ширина полоски по шагу в экране; ребром к зрителю — много перекрытий = яркая складка
    for (i = 0; i < N; i++) {
      var pa = i > 0 ? sx[i - 1] : sx[i], pb = i < N - 1 ? sx[i + 1] : sx[i];
      var d = Math.abs(pb - pa) * ((i === 0 || i === N - 1) ? 1 : 0.5);
      // ширина кратна шагу (покрытие ровно ×2) — без муара между шагом полосок и сеткой пикселей;
      // у складок (малый d) ширина фиксирована, и перекрытия по-прежнему копят яркость
      var wNew = Math.max(1.2, d * 2), wOld = Math.max(1.6, d * 1.15);
      ww[i] = wNew;
      al[i] *= (wOld / wNew) * Math.min(1, 1.4 * d);
    }
    o.n = N; o.sumA = sumA; o.sumAM = sumAM;
  }

  function energyAt(T) {
    return 1.0 + 0.14 * Math.sin(T * 0.113 + 1.0) + 0.1 * Math.sin(T * 0.071 + 2.3) + 0.07 * Math.sin(T * 0.29 + 0.4);
  }

  var Core = {
    energyAt: energyAt,
    RAMP_H: RAMP_H, RAMP_M: RAMP_M, RIBBONS: RIBBONS, rampColor: rampColor, profile: profile,
    computeRibbon: computeRibbon, makeOut: makeOut, makeTable: makeTable, sampleTable: sampleTable,
    smooth: smooth, clamp: clamp, lerp: lerp, rng32: rng32
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  /* =====================================================================
   *                       БРАУЗЕРНАЯ ЧАСТЬ
   * ===================================================================== */
  var canvas = document.getElementById('sky');
  var ctx = canvas.getContext('2d', { alpha: false });
  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }

  var W = 0, H = 0, S = 1, hz = 0, Hw = 0;
  var scene, sctx, skyBg, land, fore, mw, A, actx, bloom = [], glo = [], gA, gAx, mwL, mwX, mwFade, flip, fctx, fHalf = [], FH = 0, FM = 14;
  var Wa = 0, Ha = 0, sA = 1;
  var ramps = buildRamps();
  var glowSpr = [];
  var poleX = 0, poleY = 0;
  var cabin = { x: 0, y: 0 };
  var vig = null, grainPat = null, waterGrad = null;
  var quality = 0;
  var QA = [0.5, 0.42, 0.34], QD = [1, 0.8, 0.62];
  var out = makeOut(2600);

  var ctrl = { bright: 1, speed: 1, paused: false, pal: 'auto' };
  var PALS = {
    auto: { lo: 0, hi: 1, mix: 0 },
    emerald: { lo: 0.0, hi: 0.2, mix: 1 },
    violet: { lo: 0.62, hi: 0.95, mix: 1 },
    ice: { lo: 0.28, hi: 0.5, mix: 1 }
  };
  var palCur = { lo: 0, hi: 1, mix: 0 };
  var glow = { m: 0.12, r: 90, g: 255, b: 150, e: 0.7 };

  function buildRamps() {
    var c = document.createElement('canvas');
    var CW = RAMP_M * 3;
    c.width = CW; c.height = RAMP_H;
    var x = c.getContext('2d');
    var img = x.createImageData(CW, RAMP_H), col = [0, 0, 0];
    for (var m = 0; m < CW; m++) {
      for (var j = 0; j < RAMP_H; j++) {
        var u = 1 - j / (RAMP_H - 1);
        rampColor((m % RAMP_M) / (RAMP_M - 1), u, col, (m / RAMP_M) | 0);
        var k = (j * CW + m) * 4;
        img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  /* ---------- звёзды ---------- */
  var STAR_COL = ['rgb(185,205,255)', 'rgb(255,255,255)', 'rgb(255,240,210)', 'rgb(255,205,170)'];
  var STAR_RGB = [[185, 205, 255], [255, 255, 255], [255, 240, 210], [255, 205, 170]];
  var st = { n: 0, x: null, y: null, b: null, s: null, f: null, p: null, a: null, start: [0, 0, 0, 0, 0] };
  var bs = { n: 0, x: null, y: null, b: null, s: null, f: null, p: null, c: null };
  var BAND = { beta: -0.6, d0: 0.42, amp: 0.08 };
  function bandPoint(s) {
    var cb = Math.cos(BAND.beta), sb = Math.sin(BAND.beta);
    var nx = -sb, ny = cb;
    var off = BAND.d0 + BAND.amp * Math.sin(s * 2.1 + 1);
    return [nx * off + cb * s, ny * off + sb * s, nx, ny];
  }
  function genStars() {
    var rnd = rng32(777), list = [], blist = [], i, Rm = 1.5;
    function color() { var q = rnd(); return q < 0.38 ? 0 : q < 0.68 ? 1 : q < 0.88 ? 2 : 3; }
    function add(x, y, band) {
      if (rnd() < (band ? 0.006 : 0.012)) {
        blist.push({ x: x, y: y, b: 0.75 + 0.25 * rnd(), s: 1.4 + 1.6 * rnd(), f: 1.2 + 2.8 * rnd(), p: rnd() * TAU, c: color() });
        return;
      }
      var mag = Math.pow(rnd(), band ? 3.0 : 2.3);
      list.push({ x: x, y: y, b: 0.1 + 0.8 * mag, s: 0.8 + 0.85 * mag + (mag > 0.8 ? 0.4 : 0),
                  f: 1.5 + 4.5 * rnd(), p: rnd() * TAU, a: 0.12 + 0.3 * mag, c: color() });
    }
    for (i = 0; i < 4300; i++) {
      var r = Rm * Math.sqrt(rnd()), a = rnd() * TAU;
      add(r * Math.cos(a), r * Math.sin(a), false);
    }
    for (i = 0; i < 2300; i++) {
      var s = (rnd() * 2 - 1) * 1.5, bp = bandPoint(s), off = gauss(rnd) * 0.05;
      add(bp[0] + bp[2] * off, bp[1] + bp[3] * off, true);
    }
    list.sort(function (p, q) { return p.c - q.c; });
    var n = list.length;
    st.n = n; st.x = new Float32Array(n); st.y = new Float32Array(n); st.b = new Float32Array(n); st.s = new Float32Array(n);
    st.f = new Float32Array(n); st.p = new Float32Array(n); st.a = new Float32Array(n);
    var k = 0;
    st.start = [0, 0, 0, 0, n];
    for (i = 0; i < n; i++) {
      var q = list[i];
      while (k < q.c) { k++; st.start[k] = i; }
      st.x[i] = q.x; st.y[i] = q.y; st.b[i] = q.b; st.s[i] = q.s; st.f[i] = q.f; st.p[i] = q.p; st.a[i] = q.a;
    }
    while (k < 3) { k++; st.start[k] = n; }
    st.start[4] = n;
    var bn = blist.length;
    bs.n = bn; bs.x = new Float32Array(bn); bs.y = new Float32Array(bn); bs.b = new Float32Array(bn); bs.s = new Float32Array(bn);
    bs.f = new Float32Array(bn); bs.p = new Float32Array(bn); bs.c = new Uint8Array(bn);
    for (i = 0; i < bn; i++) {
      var o = blist[i];
      bs.x[i] = o.x; bs.y[i] = o.y; bs.b[i] = o.b; bs.s[i] = o.s; bs.f[i] = o.f; bs.p[i] = o.p; bs.c[i] = o.c;
    }
  }
  function buildGlowSprites() {
    for (var k = 0; k < 4; k++) {
      var c = mk(64, 64), x = c.getContext('2d'), rgb = STAR_RGB[k];
      var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      var cs = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
      g.addColorStop(0, 'rgba(' + cs + ',1)');
      g.addColorStop(0.12, 'rgba(' + cs + ',0.6)');
      g.addColorStop(0.35, 'rgba(' + cs + ',0.14)');
      g.addColorStop(1, 'rgba(' + cs + ',0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      glowSpr.push(c);
    }
  }
  function buildMilkyWay() {
    var D = 1024, per = D / 3; // 3 «высоты экрана» на всю сторону
    mw = mk(D, D);
    var c = mw.getContext('2d'), rnd = rng32(31), i;
    function blob(x, y, r, rgb, a, op) {
      var g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
      g.addColorStop(1, 'rgba(' + rgb + ',0)');
      c.globalCompositeOperation = op || 'lighter';
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // узкая, еле заметная полоса (раньше была широким светлым «облаком» и читалась как холмы над горами)
    for (i = 0; i < 280; i++) {
      var s = (rnd() * 2 - 1) * 1.45, bp = bandPoint(s);
      var w = gauss(rnd) * 0.035 * (1 - 0.3 * Math.abs(s / 1.5));
      var x = D / 2 + (bp[0] + bp[2] * w) * per, y = D / 2 + (bp[1] + bp[3] * w) * per;
      blob(x, y, (10 + 24 * rnd()), '150,172,225', 0.013 + 0.01 * rnd());
    }
    for (i = 0; i < 40; i++) { // тёплое ядро
      var s2 = gauss(rnd) * 0.14 - 0.1, bp2 = bandPoint(s2), w2 = gauss(rnd) * 0.03;
      blob(D / 2 + (bp2[0] + bp2[2] * w2) * per, D / 2 + (bp2[1] + bp2[3] * w2) * per, 12 + 26 * rnd(), '255,214,170', 0.02);
    }
    for (i = 0; i < 46; i++) { // пылевые полосы
      var s3 = (rnd() * 2 - 1) * 1.2, bp3 = bandPoint(s3), w3 = gauss(rnd) * 0.014;
      blob(D / 2 + (bp3[0] + bp3[2] * w3) * per, D / 2 + (bp3[1] + bp3[3] * w3) * per, 8 + 18 * rnd(), '0,0,0', 0.14, 'destination-out');
    }
    c.globalCompositeOperation = 'source-over';
  }

  /* ---------- метеоры ---------- */
  var meteors = [], meteorTimer = 9;
  function spawnMeteor() {
    var dir = Math.random() < 0.5 ? 1 : -1;
    var ang = 0.3 + Math.random() * 0.35;
    meteors.push({
      x: W * (0.12 + 0.76 * Math.random()), y: H * (0.04 + 0.26 * Math.random()),
      dx: dir * Math.cos(ang), dy: Math.sin(ang),
      dist: H * (0.28 + 0.2 * Math.random()), tail: H * (0.1 + 0.08 * Math.random()),
      t: 0, dur: 0.55 + 0.35 * Math.random()
    });
  }
  function updateMeteors(dt) {
    meteorTimer -= dt;
    if (meteorTimer <= 0 && meteors.length < 2) { spawnMeteor(); meteorTimer = 7 + Math.random() * 15; }
    for (var i = meteors.length - 1; i >= 0; i--) {
      meteors[i].t += dt;
      if (meteors[i].t > meteors[i].dur) meteors.splice(i, 1);
    }
  }
  function drawMeteors(c) {
    c.globalCompositeOperation = 'lighter';
    for (var i = 0; i < meteors.length; i++) {
      var m = meteors[i], p = m.t / m.dur;
      var ease = 1 - Math.pow(1 - p, 1.6);
      var hd = m.dist * ease, tl = Math.max(0, hd - m.tail);
      var hx = m.x + m.dx * hd, hy = m.y + m.dy * hd, tx = m.x + m.dx * tl, ty = m.y + m.dy * tl;
      var a = Math.pow(Math.sin(Math.PI * p), 0.7);
      var g = c.createLinearGradient(tx, ty, hx, hy);
      g.addColorStop(0, 'rgba(160,220,255,0)');
      g.addColorStop(1, 'rgba(235,248,255,' + (0.9 * a).toFixed(3) + ')');
      c.globalAlpha = 1;
      c.strokeStyle = g; c.lineWidth = 1.4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(tx, ty); c.lineTo(hx, hy); c.stroke();
      c.globalAlpha = a * 0.8;
      c.drawImage(glowSpr[0], hx - 7, hy - 7, 14, 14);
    }
    c.globalAlpha = 1;
  }

  /* ---------- ландшафт ---------- */
  function drawPine(c, x, base, h, w, rnd, dx, dy) {
    var T = 7 + ((rnd() * 4) | 0), i, tipY = base - h;
    c.beginPath();
    c.moveTo(x + dx, tipY + dy);
    var side, pts = [];
    for (side = 1; side >= -1; side -= 2) {
      for (i = 1; i <= T; i++) {
        var t = i / T, yy = tipY + t * h * 0.93;
        var hw = w * 0.5 * (0.2 + 0.8 * t) * (0.86 + 0.28 * rnd());
        var droop = h / T * (0.35 + 0.2 * rnd());
        pts.push([x + side * hw, yy + droop * 0.4]);
        pts.push([x + side * hw * 0.5, yy - droop * 0.08]);
      }
      if (side === 1) {
        for (i = 0; i < pts.length; i++) c.lineTo(pts[i][0] + dx, pts[i][1] + dy);
        c.lineTo(x + w * 0.07 + dx, base - h * 0.07 + dy);
        c.lineTo(x + w * 0.07 + dx, base + 2 + dy);
        c.lineTo(x - w * 0.07 + dx, base + 2 + dy);
        c.lineTo(x - w * 0.07 + dx, base - h * 0.07 + dy);
        pts = [];
      } else {
        for (i = pts.length - 1; i >= 0; i--) c.lineTo(pts[i][0] + dx, pts[i][1] + dy);
      }
    }
    c.closePath();
    c.fill();
  }

  function buildLand() {
    land = mk(W * S, hz * S);
    var c = land.getContext('2d');
    c.setTransform(S, 0, 0, S, 0, 0);
    var rnd = rng32(2024), x, i;
    var xs = Math.ceil(W) + 1;
    var asp = clamp(W / H * 1.2, 0.5, 1), HM = Math.min(H, W * 1.1);

    // дальний хребет: острые пики + грани, освещённые зеленоватым небом
    var tabFar = makeTable(2048, [3, 7, 16, 41], [1, 0.5, 0.24, 0.1], rng32(41), 0.25);
    var yFar = new Float32Array(xs), minY = hz;
    for (x = 0; x < xs; x++) {
      var v = sampleTable(tabFar, x / W * asp);
      var val = Math.pow(1 - Math.abs(2 * v - 1), 1.4);
      yFar[x] = hz - HM * (0.045 + 0.115 * val);
      if (yFar[x] < minY) minY = yFar[x];
    }
    var gF = c.createLinearGradient(0, minY, 0, hz);
    gF.addColorStop(0, '#0c2431'); gF.addColorStop(0.55, '#07161f'); gF.addColorStop(1, '#040d14');
    c.fillStyle = gF;
    c.beginPath(); c.moveTo(0, hz);
    for (x = 0; x < xs; x++) c.lineTo(x, yFar[x]);
    c.lineTo(xs, hz); c.closePath(); c.fill();
    for (x = 2; x < xs - 2; x++) {
      var sl = yFar[x + 2] - yFar[x - 2], hh = hz - yFar[x];
      if (sl < 0) { // склон смотрит влево-вверх: подсветка
        var al = clamp(-sl / 5, 0, 1) * 0.2;
        c.fillStyle = 'rgba(95,175,190,' + (al / 2).toFixed(3) + ')';
        c.fillRect(x, yFar[x], 1.1, hh * 0.22); c.fillRect(x, yFar[x], 1.1, hh * 0.45);
      } else {
        var ad = clamp(sl / 5, 0, 1) * 0.34;
        c.fillStyle = 'rgba(0,3,6,' + (ad / 2).toFixed(3) + ')';
        c.fillRect(x, yFar[x], 1.1, hh * 0.3); c.fillRect(x, yFar[x], 1.1, hh * 0.6);
      }
    }
    c.strokeStyle = 'rgba(150,215,215,0.2)'; c.lineWidth = 1;
    c.beginPath();
    for (x = 0; x < xs; x++) { if (x === 0) c.moveTo(x, yFar[x] + 0.5); else c.lineTo(x, yFar[x] + 0.5); }
    c.stroke();

    // средние холмы
    var tabMid = makeTable(2048, [4, 9, 21], [1, 0.45, 0.2], rng32(53), 0.25);
    var gM = c.createLinearGradient(0, hz - HM * 0.1, 0, hz);
    gM.addColorStop(0, '#061019'); gM.addColorStop(1, '#02070c');
    c.fillStyle = gM;
    c.beginPath(); c.moveTo(0, hz);
    var yMid = new Float32Array(xs);
    for (x = 0; x < xs; x++) {
      yMid[x] = hz - HM * (0.02 + 0.055 * Math.pow(sampleTable(tabMid, x / W * asp + 0.3), 1.3));
      c.lineTo(x, yMid[x]);
    }
    c.lineTo(xs, hz); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(120,200,200,0.1)';
    c.beginPath();
    for (x = 0; x < xs; x++) { if (x === 0) c.moveTo(x, yMid[x] + 0.5); else c.lineTo(x, yMid[x] + 0.5); }
    c.stroke();

    // кромка леса на дальнем берегу
    var tabDen = makeTable(1024, [5, 13, 29], [1, 0.6, 0.3], rng32(67), 0.28);
    c.fillStyle = '#020609';
    c.beginPath(); c.moveTo(0, hz); c.lineTo(0, hz - 2);
    var tx;
    for (x = 0; x < xs; x += 4) c.lineTo(x, hz - 3 - 0.012 * H * sampleTable(tabDen, x / W));
    c.lineTo(xs, hz); c.closePath(); c.fill();
    for (tx = -8; tx < W + 8; tx += 3 + rnd() * 5) {
      var dens = sampleTable(tabDen, tx / W + 0.17);
      if (dens < 0.3 && rnd() < 0.7) continue;
      var ph = H * (0.016 + 0.034 * dens) * (0.6 + 0.7 * rnd());
      drawPine(c, tx, hz + 1, ph, ph * 0.34, rnd, 0, 0);
    }

    // домик с тёплым окном на дальнем берегу
    var cw = H * 0.05, ch = H * 0.026, cxp = W * 0.715, cyp = hz - 1;
    c.fillStyle = '#010305';
    c.beginPath();
    c.moveTo(cxp - cw / 2, cyp); c.lineTo(cxp - cw / 2, cyp - ch);
    c.lineTo(cxp, cyp - ch - H * 0.02); c.lineTo(cxp + cw / 2, cyp - ch);
    c.lineTo(cxp + cw / 2, cyp); c.closePath(); c.fill();
    c.fillRect(cxp + cw * 0.18, cyp - ch - H * 0.026, cw * 0.07, H * 0.02);
    c.fillStyle = 'rgb(255,186,96)';
    var wsz = Math.max(2, H * 0.0058);
    c.fillRect(cxp - cw * 0.22, cyp - ch * 0.66, wsz, wsz);
    cabin.x = cxp - cw * 0.22 + wsz / 2; cabin.y = cyp - ch * 0.66 + wsz / 2;
  }

  function buildFore() {
    fore = mk(W * S, H * S);
    var c = fore.getContext('2d');
    c.setTransform(S, 0, 0, S, 0, 0);
    var rnd = rng32(99), x, i;
    var U = Math.min(H, W * 0.62);
    var tabN = makeTable(512, [9, 31], [1, 0.5], rng32(71), 0.25);
    function bankH(xx) {
      var l = 0.17 * Math.exp(-Math.pow(xx / (0.2 * W), 1.7));
      var r = 0.1 * Math.exp(-Math.pow((W - xx) / (0.16 * W), 1.7));
      return H * (0.014 + Math.max(l, r)) + H * 0.006 * (sampleTable(tabN, xx / W) - 0.5) * 2;
    }
    // сосны переднего плана: сначала рим-подсветка (сдвиг), затем чёрный силуэт
    var pines = [
      [0.035, 0.52], [0.088, 0.36], [0.145, 0.235], [0.19, 0.14],
      [0.958, 0.40], [0.905, 0.27], [0.862, 0.16]
    ];
    for (var pass = 0; pass < 2; pass++) {
      var r2 = rng32(1234);
      c.fillStyle = pass === 0 ? 'rgba(70,150,150,0.34)' : '#010204';
      for (i = 0; i < pines.length; i++) {
        var px = pines[i][0] * W, ph = pines[i][1] * U, base = H - bankH(px) + 3;
        if (pass === 0) drawPine(c, px, base, ph, ph * 0.3, r2, -1.4, -0.9);
        else drawPine(c, px, base, ph, ph * 0.3, r2, 0, 0);
      }
    }
    // берега
    var g = c.createLinearGradient(0, H - H * 0.2, 0, H);
    g.addColorStop(0, '#030609'); g.addColorStop(1, '#000102');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, H + 2);
    for (x = 0; x <= W; x += 3) c.lineTo(x, H - bankH(x));
    c.lineTo(W, H + 2); c.closePath(); c.fill();
    // трава и камыш по кромке
    c.fillStyle = '#010204';
    for (x = 0; x < W; x += 2 + rnd() * 3) {
      var by = H - bankH(x), edgeW = Math.exp(-Math.pow(Math.min(x, W - x) / (0.22 * W), 1.2));
      var len = (4 + rnd() * (10 + 26 * edgeW)) * (0.6 + 0.6 * rnd());
      c.beginPath();
      c.moveTo(x - 1, by + 1); c.lineTo(x + (rnd() - 0.5) * 5, by - len); c.lineTo(x + 1.6, by + 1);
      c.closePath(); c.fill();
    }
  }

  /* ---------- размеры и статические слои ---------- */
  function allocAurora() {
    sA = Math.min(S, 1.2) * QA[quality];
    Wa = Math.ceil(W * sA); Ha = Math.ceil(hz * sA);
    A = mk(Wa, Ha); actx = A.getContext('2d');
    bloom = [];
    var w = Wa, h = Ha;
    for (var k = 0; k < 4; k++) {
      w = Math.max(2, Math.ceil(w / 2)); h = Math.max(2, Math.ceil(h / 2));
      var bc = mk(w, h);
      bloom.push({ c: bc, x: bc.getContext('2d') });
    }
    // свечение собирается ступенями ×2 (1/16 → 1/8 → 1/4 → 1/2 → полный буфер):
    // один большой билинейный апскейл даёт ромбовидную «сетку» из ячеек низкого разрешения
    glo = [];
    for (var j = 0; j < 3; j++) {
      var gc = mk(bloom[j].c.width, bloom[j].c.height);
      glo.push({ c: gc, x: gc.getContext('2d') });
    }
    gA = mk(Wa, Ha); gAx = gA.getContext('2d');
  }

  function buildSkyBg() {
    skyBg = mk(W * S, hz * S);
    var c = skyBg.getContext('2d');
    c.setTransform(S, 0, 0, S, 0, 0);
    var g = c.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, '#01030a'); g.addColorStop(0.25, '#030818'); g.addColorStop(0.55, '#06122a');
    g.addColorStop(0.8, '#081b30'); g.addColorStop(0.94, '#0a2634'); g.addColorStop(1, '#0c3034');
    c.fillStyle = g; c.fillRect(0, 0, W, hz);
  }

  function resize() {
    var nw = Math.max(320, window.innerWidth || 800), nh = Math.max(240, window.innerHeight || 600);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    dpr = Math.max(0.75, Math.min(dpr, Math.sqrt(4.4e6 / (nw * nh))));
    W = nw; H = nh; S = dpr;
    canvas.width = Math.round(W * S); canvas.height = Math.round(H * S);
    var hzDev = Math.round(H * S * 0.72);
    hz = hzDev / S; Hw = H - hz;
    scene = mk(W * S, hz * S); sctx = scene.getContext('2d');
    FH = Math.min(hz, Hw * 1.95 + 10);
    flip = mk((W + FM * 2) * S, FH * S); fctx = flip.getContext('2d');
    fHalf = [];
    var fw = flip.width, fh = flip.height;
    for (var k = 0; k < 3; k++) {
      fw = Math.max(2, Math.ceil(fw / 2)); fh = Math.max(2, Math.ceil(fh / 2));
      var fc = mk(fw, fh);
      fHalf.push({ c: fc, x: fc.getContext('2d') });
    }
    poleX = W * 0.56; poleY = hz * 0.1;
    mwL = mk(W * S * 0.5, hz * S * 0.5); mwX = mwL.getContext('2d');
    mwFade = mwX.createLinearGradient(0, 0, 0, mwL.height);
    mwFade.addColorStop(0, 'rgba(0,0,0,0)'); mwFade.addColorStop(0.35, 'rgba(0,0,0,0)');
    mwFade.addColorStop(0.9, 'rgba(0,0,0,1)'); mwFade.addColorStop(1, 'rgba(0,0,0,1)');
    allocAurora();
    buildSkyBg(); buildLand(); buildFore();
    waterGrad = ctx.createLinearGradient(0, hz, 0, H);
    waterGrad.addColorStop(0, 'rgba(2,9,15,0.12)');
    waterGrad.addColorStop(0.5, 'rgba(1,5,9,0.28)');
    waterGrad.addColorStop(1, 'rgba(0,2,4,0.52)');
    var rr = Math.hypot(W, H) * 0.5;
    vig = ctx.createRadialGradient(W / 2, H * 0.48, rr * 0.45, W / 2, H * 0.48, rr * 1.02);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  }

  function buildGrain() {
    var c = mk(256, 256), x = c.getContext('2d'), img = x.createImageData(256, 256), rnd = rng32(8);
    for (var i = 0; i < 256 * 256; i++) {
      var v = rnd() * 255;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    grainPat = ctx.createPattern(c, 'repeat');
  }

  /* ---------- энергия, вспышки (суббури) ---------- */
  var burstT = 99, burst = 0, nextBurst = 24;
  function triggerBurst() { if (burst < 0.25) { burstT = 0; nextBurst = 38 + Math.random() * 40; } }

  /* ---------- рисование ---------- */
  var cc = { gain: 0.5, act: 1, lenMul: 1, density: 1, palLo: 0, palHi: 1, palMix: 0 };
  var gg = { W: 0, hz: 0, f: 0, cx: 0, sA: 1, Wa: 0 };

  function drawAurora(T, E) {
    actx.setTransform(1, 0, 0, 1, 0, 0);
    actx.globalCompositeOperation = 'source-over';
    actx.globalAlpha = 1;
    actx.fillStyle = '#000'; actx.fillRect(0, 0, Wa, Ha);
    actx.globalCompositeOperation = 'lighter';
    gg.W = W; gg.hz = hz; gg.f = 0.75 * H; gg.cx = W * 0.5; gg.sA = sA; gg.Wa = Wa;
    cc.gain = 0.47 * ctrl.bright * (E + 0.55 * burst);
    cc.act = 1 + 0.5 * burst;
    cc.lenMul = 1 + 0.3 * burst;
    cc.density = QD[quality];
    cc.palLo = palCur.lo; cc.palHi = palCur.hi; cc.palMix = palCur.mix;
    var sumA = 0, sumAM = 0;
    for (var k = 0; k < RIBBONS.length; k++) {
      computeRibbon(RIBBONS[k], T, cc, gg, out);
      sumA += out.sumA; sumAM += out.sumAM;
      var shafts = RIBBONS[k].kind !== 2;
      var n = out.n, sx = out.sx, yt = out.yt, yb = out.yb, w = out.w, al = out.al, mi = out.mi, ray = out.ray;
      for (var i = 0; i < n; i++) {
        var x = sx[i], ww = w[i], a = al[i], top = yt[i], bot = yb[i], h = bot - top;
        if (a < 0.01 || h < 1.5 || x < -ww || x > Wa + ww || bot < 0) continue;
        actx.globalAlpha = a > 1 ? 1 : a;
        actx.drawImage(ramps, mi[i], 0, 1, RAMP_H, x - ww * 0.5, top, ww, h);
        if (shafts && i % 3 === 0) { // высокие столбы света над яркими лучами
          // каждая 3-я полоска шириной в 3 шага: покрытие ровно ×1 — никакого периодического узора
          var ga = a * 0.3 * smooth(0.4, 0.9, ray[i]);
          if (ga > 0.008) {
            actx.globalAlpha = ga > 1 ? 1 : ga;
            var h2 = h * 1.9;
            actx.drawImage(ramps, mi[i], 0, 1, RAMP_H, x - ww * 0.75, bot - h2, ww * 1.5, h2);
          }
        }
      }
    }
    actx.globalAlpha = 1;
    // средний «цвет сияния» — для дымки у горизонта, бликов на воде
    var mAvg = sumA > 1e-4 ? sumAM / sumA : 0.12;
    glow.m += (mAvg - glow.m) * 0.04;
    glow.e += (clamp(sumA / 900, 0, 1.4) - glow.e) * 0.05;
    var col = [0, 0, 0];
    rampColor(glow.m, 0.1, col);
    var mx = Math.max(col[0], col[1], col[2], 1);
    glow.r = col[0] / mx * 255; glow.g = col[1] / mx * 255; glow.b = col[2] / mx * 255;
    // пирамида размытий
    var prev = A;
    for (var b = 0; b < bloom.length; b++) {
      bloom[b].x.globalCompositeOperation = 'copy';
      bloom[b].x.drawImage(prev, 0, 0, bloom[b].c.width, bloom[b].c.height);
      prev = bloom[b].c;
    }
    glowUp(glo[2].x, bloom[2].c, bloom[3].c, glo[2].c);
    glowUp(glo[1].x, bloom[1].c, glo[2].c, glo[1].c);
    glowUp(glo[0].x, null, glo[1].c, glo[0].c);
    glowUp(gAx, null, glo[0].c, gA);
  }
  // dst = base (если есть) + upscale(src ×2) — каждый шаг билинейный и ровно вдвое
  function glowUp(x, base, src, dstCanvas) {
    x.imageSmoothingEnabled = true;
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'copy';
    if (base) {
      x.drawImage(base, 0, 0);
      x.globalCompositeOperation = 'lighter';
    }
    x.drawImage(src, 0, 0, dstCanvas.width, dstCanvas.height);
  }

  function drawStars(c, T) {
    var rot = T * 0.005, cs = Math.cos(rot), sn = Math.sin(rot), i, k;
    c.globalCompositeOperation = 'source-over';
    for (k = 0; k < 4; k++) {
      c.fillStyle = STAR_COL[k];
      var e = st.start[k + 1];
      for (i = st.start[k]; i < e; i++) {
        var x0 = st.x[i] * H, y0 = st.y[i] * H;
        var x = poleX + x0 * cs - y0 * sn, y = poleY + x0 * sn + y0 * cs;
        if (x < -3 || x > W + 3 || y < -3 || y > hz - 1) continue;
        var ext = smooth(hz, hz - 0.2 * H, y);
        var a = st.b[i] * (1 + st.a[i] * Math.sin(T * st.f[i] + st.p[i])) * ext;
        if (a < 0.03) continue;
        c.globalAlpha = a > 1 ? 1 : a;
        var s = st.s[i];
        c.fillRect(x - s * 0.5, y - s * 0.5, s, s);
      }
    }
    // яркие звёзды: ореол, мерцание, лучики
    c.globalCompositeOperation = 'lighter';
    for (i = 0; i < bs.n; i++) {
      var bx = bs.x[i] * H, by = bs.y[i] * H;
      var x2 = poleX + bx * cs - by * sn, y2 = poleY + bx * sn + by * cs;
      if (x2 < -20 || x2 > W + 20 || y2 < -20 || y2 > hz - 2) continue;
      var ex = smooth(hz, hz - 0.2 * H, y2);
      var tw = 0.78 + 0.22 * Math.sin(T * bs.f[i] + bs.p[i]) + 0.08 * Math.sin(T * bs.f[i] * 2.7 + bs.p[i] * 1.9);
      var aa = bs.b[i] * tw * ex;
      var r = bs.s[i] * (5 + 5 * tw);
      c.globalAlpha = clamp(aa * 0.55, 0, 1);
      c.drawImage(glowSpr[bs.c[i]], x2 - r, y2 - r, r * 2, r * 2);
      c.globalAlpha = clamp(aa, 0, 1);
      c.fillStyle = '#fff';
      var core = bs.s[i] * 0.55 + 0.5;
      c.fillRect(x2 - core * 0.5, y2 - core * 0.5, core, core);
      if (bs.s[i] > 2.3) {
        var L = bs.s[i] * 4.5 * tw;
        c.globalAlpha = clamp(aa * 0.28, 0, 1);
        c.fillRect(x2 - L, y2 - 0.35, L * 2, 0.7);
        c.fillRect(x2 - 0.35, y2 - L, 0.7, L * 2);
      }
    }
    c.globalAlpha = 1;
  }

  function drawScene(T, dt) {
    var c = sctx;
    c.setTransform(S, 0, 0, S, 0, 0);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    c.drawImage(skyBg, 0, 0, W, hz);
    // Млечный Путь вращается вместе с небом
    var rot = T * 0.005, ms = S * 0.5;
    mwX.setTransform(1, 0, 0, 1, 0, 0);
    mwX.globalCompositeOperation = 'copy'; mwX.globalAlpha = 1;
    mwX.fillStyle = 'rgba(0,0,0,0)'; mwX.fillRect(0, 0, mwL.width, mwL.height);
    mwX.globalCompositeOperation = 'source-over';
    mwX.setTransform(ms, 0, 0, ms, 0, 0);
    mwX.translate(poleX, poleY); mwX.rotate(rot);
    mwX.drawImage(mw, -1.5 * H, -1.5 * H, 3 * H, 3 * H);
    mwX.setTransform(1, 0, 0, 1, 0, 0);
    mwX.globalCompositeOperation = 'destination-out';
    mwX.fillStyle = mwFade; mwX.fillRect(0, 0, mwL.width, mwL.height);
    c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1;
    c.drawImage(mwL, 0, 0, W, hz);
    c.globalAlpha = 1;
    drawStars(c, T);
    // сияние + свечение
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 1; c.drawImage(A, 0, 0, W, hz);
    c.globalAlpha = 0.24; c.drawImage(gA, 0, 0, W, hz);
    c.globalAlpha = 1;
    drawMeteors(c);
    // горы и лес
    c.globalCompositeOperation = 'source-over';
    c.drawImage(land, 0, 0, W, hz);
    // дымка у горизонта, окрашенная сиянием
    var hh = H * 0.1;
    var gr = c.createLinearGradient(0, hz - hh, 0, hz);
    var ha = 0.03 + 0.1 * clamp(glow.e, 0, 1.2);
    var gc = Math.round(glow.r * 0.55) + ',' + Math.round(glow.g * 0.8) + ',' + Math.round(glow.b * 0.8);
    gr.addColorStop(0, 'rgba(' + gc + ',0)');
    gr.addColorStop(1, 'rgba(' + gc + ',' + ha.toFixed(3) + ')');
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = gr; c.fillRect(0, hz - hh, W, hh);
    // тёплое окно домика
    var fl = 0.82 + 0.1 * Math.sin(T * 7.3) + 0.06 * Math.sin(T * 13.1 + 1) + 0.04 * Math.sin(T * 23 + 2);
    var wr = H * 0.034;
    var wg = c.createRadialGradient(cabin.x, cabin.y, 0, cabin.x, cabin.y, wr);
    wg.addColorStop(0, 'rgba(255,190,100,' + (0.75 * fl).toFixed(3) + ')');
    wg.addColorStop(0.25, 'rgba(255,150,60,' + (0.22 * fl).toFixed(3) + ')');
    wg.addColorStop(1, 'rgba(255,120,40,0)');
    c.fillStyle = wg; c.fillRect(cabin.x - wr, cabin.y - wr, wr * 2, wr * 2);
    c.globalCompositeOperation = 'source-over';
  }

  /* ---------- вода: зеркало с рябью по строкам ---------- */
  var rowGeo = new Float32Array(0);
  var glints = (function () {
    var r = rng32(404), a = [];
    for (var i = 0; i < 70; i++) a.push({ x: r(), q: Math.pow(r(), 1.7), l: 6 + r() * 38, p: r() * TAU, f: 0.6 + r() * 2.2 });
    return a;
  })();

  function drawWater(T) {
    var i, j;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.globalCompositeOperation = 'copy';
    fctx.globalAlpha = 1;
    fctx.setTransform(S, 0, 0, -S, FM * S, hz * S);
    fctx.drawImage(scene, 0, 0, W, hz);
    fctx.globalCompositeOperation = 'source-over';
    fctx.drawImage(scene, 0, 0, 1, scene.height, -FM, 0, FM, hz);
    fctx.drawImage(scene, scene.width - 1, 0, 1, scene.height, W, 0, FM, hz);

    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = '#02070c'; ctx.fillRect(0, hz, W, Hw + 1);

    // геометрия строк: небо слегка «сжато» в воду, чтобы в отражение попадал низ сияния
    var rowH = 3 / S, n = Math.ceil(Hw / rowH);
    if (rowGeo.length < n * 5) rowGeo = new Float32Array(n * 5);
    for (j = 0; j < n; j++) {
      var r = (j + 0.5) * rowH, q = r / Hw;
      var amp = 0.6 + 4.2 * Math.pow(q, 1.1);
      var ph = Math.sqrt(r) * 2.6;
      rowGeo[j * 5] = (FM + amp * (Math.sin(ph + T * 1.55) + 0.55 * Math.sin(ph * 2.3 - T * 2.1 + 1.3) + 0.3 * Math.sin(r * 0.11 + T * 0.7))) * S; // sx
      rowGeo[j * 5 + 1] = (r + 0.8 * r * q) * S;                  // sy
      rowGeo[j * 5 + 2] = rowH * (1 + 1.6 * q) * S;                // sh
      rowGeo[j * 5 + 3] = 0.74 + 0.26 * Math.sin(ph * 1.7 + T * 1.1 + 2.0); // полосы яркости
      rowGeo[j * 5 + 4] = q;
    }
    // проход 1: отражение с рябью, затем затемнение глубиной
    for (j = 0; j < n; j++) {
      ctx.globalAlpha = rowGeo[j * 5 + 3] * (0.82 - 0.3 * rowGeo[j * 5 + 4]);
      ctx.drawImage(flip, rowGeo[j * 5], rowGeo[j * 5 + 1], W * S, rowGeo[j * 5 + 2], 0, hz + j * rowH, W, rowH);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = waterGrad; ctx.fillRect(0, hz, W, Hw + 1);
    // проход 2 (аддитивный, уже после затемнения): яркие места — полосы сияния — читаются в воде сочно
    ctx.globalCompositeOperation = 'lighter';
    for (j = 0; j < n; j++) {
      ctx.globalAlpha = rowGeo[j * 5 + 3] * 0.7 * (1 - 0.3 * rowGeo[j * 5 + 4]);
      ctx.drawImage(flip, rowGeo[j * 5], rowGeo[j * 5 + 1], W * S, rowGeo[j * 5 + 2], 0, hz + j * rowH, W, rowH);
    }
    ctx.globalAlpha = 1;

    // мягкая (размытая) копия отражения — свечение в воде
    var prev = flip;
    for (i = 0; i < fHalf.length; i++) {
      fHalf[i].x.globalCompositeOperation = 'copy';
      fHalf[i].x.drawImage(prev, 0, 0, fHalf[i].c.width, fHalf[i].c.height);
      prev = fHalf[i].c;
    }
    var f3 = fHalf[2].c;
    var srcH = Math.min(f3.height, f3.height * (Hw * 1.8 / FH));
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.4;
    ctx.drawImage(f3, 0, 0, f3.width, srcH, -FM, hz, W + FM * 2, Hw);

    // блики: короткие горизонтальные штрихи цвета сияния
    ctx.fillStyle = 'rgb(' + Math.round(glow.r) + ',' + Math.round(glow.g) + ',' + Math.round(glow.b) + ')';
    for (i = 0; i < glints.length; i++) {
      var g = glints[i];
      var a = 0.5 + 0.5 * Math.sin(T * g.f + g.p);
      a = a * a * 0.2 * (0.35 + glow.e) * (1 - 0.6 * g.q);
      if (a < 0.01) continue;
      ctx.globalAlpha = a;
      var gx = g.x * W + Math.sin(T * 0.3 + g.p) * 8;
      ctx.fillRect(gx, hz + 1 + g.q * Hw * 0.95, g.l * (0.5 + g.q), 1.1 + g.q * 0.8);
    }
    ctx.globalAlpha = 1;
    // линия берега: тонкий светлый шов по горизонту
    var sg = ctx.createLinearGradient(0, hz - 2, 0, hz + 5);
    var sc = Math.round(glow.r * 0.5) + ',' + Math.round(glow.g * 0.75) + ',' + Math.round(glow.b * 0.75);
    sg.addColorStop(0, 'rgba(' + sc + ',0)');
    sg.addColorStop(0.35, 'rgba(' + sc + ',' + (0.1 + 0.12 * clamp(glow.e, 0, 1.2)).toFixed(3) + ')');
    sg.addColorStop(1, 'rgba(' + sc + ',0)');
    ctx.fillStyle = sg; ctx.fillRect(0, hz - 2, W, 7);
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFrame(T, dt) {
    var E = energyAt(T);
    drawAurora(T, E);
    drawScene(T, dt);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.drawImage(scene, 0, 0, W, hz);
    drawWater(T);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.drawImage(fore, 0, 0, W, H);
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
    // плёночное зерно (заодно дитерит тёмные градиенты)
    if (grainPat) {
      ctx.setTransform(1, 0, 0, 1, (Math.random() * 256) | 0, (Math.random() * 256) | 0);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.016;
      ctx.fillStyle = grainPat;
      ctx.fillRect(-256, -256, canvas.width + 512, canvas.height + 512);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(S, 0, 0, S, 0, 0);
    }
  }

  /* ---------- главный цикл ---------- */
  var T = 40, last = 0, perfAcc = 0, perfN = 0, started = false;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    var raw = (now - last) / 1000; last = now;
    var dt = clamp(raw, 0, 0.05);
    if (raw > 0 && raw < 0.25) { perfAcc += raw; perfN++; }
    if (perfN >= 90) {
      if (perfAcc / perfN > 0.024 && quality < 2) { quality++; allocAurora(); }
      perfAcc = 0; perfN = 0;
    }
    var sdt = ctrl.paused ? 0 : dt * ctrl.speed * 1.25;
    T += sdt;
    // палитра: плавный переход к пресету
    var pt = PALS[ctrl.pal], k = 1 - Math.exp(-dt * 2);
    palCur.lo += (pt.lo - palCur.lo) * k; palCur.hi += (pt.hi - palCur.hi) * k; palCur.mix += (pt.mix - palCur.mix) * k;
    // суббури
    burstT += sdt; nextBurst -= sdt;
    var x = burstT / 1.6;
    burst = x * Math.exp(1 - x);
    if (nextBurst <= 0) triggerBurst();
    if (!ctrl.paused) updateMeteors(dt * ctrl.speed);
    drawFrame(T, dt);
  }

  /* ---------- UI ---------- */
  function $(id) { return document.getElementById(id); }
  function wireUI() {
    var bp = $('bPause'), rb = $('rBright'), rs = $('rSpeed'), bf = $('bFlash');
    if (bp) bp.addEventListener('click', function () {
      ctrl.paused = !ctrl.paused; bp.textContent = ctrl.paused ? 'Пуск' : 'Пауза';
    });
    if (rb) rb.addEventListener('input', function () { ctrl.bright = rb.value / 100; });
    if (rs) rs.addEventListener('input', function () { ctrl.speed = rs.value / 100; });
    if (bf) bf.addEventListener('click', triggerBurst);
    var btns = document.querySelectorAll('[data-pal]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        ctrl.pal = this.getAttribute('data-pal');
        for (var j = 0; j < btns.length; j++) btns[j].classList.toggle('on', btns[j] === this);
      });
    }
    window.addEventListener('keydown', function (e) {
      var tg = e.target && e.target.tagName;
      if (tg === 'BUTTON' || tg === 'INPUT') return;
      if (e.code === 'Space' && bp) { e.preventDefault(); bp.click(); }
    });
  }

  genStars(); buildGlowSprites(); buildMilkyWay(); resize(); buildGrain(); wireUI();
  var rzT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rzT); rzT = setTimeout(function () { resize(); buildGrain(); }, 60);
  });
  requestAnimationFrame(frame);
})();
