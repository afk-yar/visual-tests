/*
 * Поток частиц 3D — Claude Sonnet 5.5
 *
 * Чистый Canvas 2D, без WebGL. Частицы живут в трёхмерном бездивергентном
 * поле скоростей (сумма волн с аналитическим ротором = curl-noise), а рисуются
 * программно в HDR-аккумулятор (Float32): аддитивные штрихи вместо точек,
 * экспозиционная кривая, глубинная дымка, диафрагма (боке) и двухуровневый
 * bloom. Ядро (createEngine) не трогает DOM и работает в node — см. хвост файла.
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Быстрый косинус (ошибка ~1e-3). Для поля неважно: бездивергентность
  // сохраняется точно, т.к. каждая волна — функция одной фазы k·x.
  var INV_TAU = 1 / TAU;
  function fcos(x) {
    x -= TAU * Math.floor(x * INV_TAU + 0.5);
    x += 1.5707963267948966;
    if (x > Math.PI) x -= TAU;
    var y = 1.2732395447351628 * x - 0.4052847345693511 * x * (x < 0 ? -x : x);
    return 0.225 * (y * (y < 0 ? -y : y) - y) + y;
  }

  /* ------------------------------------------------------------------ */
  /*  Палитры                                                            */
  /* ------------------------------------------------------------------ */

  var PALETTES = [
    { name: 'Неон',
      stops: [[0, [0.02, 0.22, 1.0]], [0.26, [0.0, 0.78, 1.0]], [0.48, [0.40, 0.08, 1.0]], [0.72, [1.0, 0.04, 0.46]], [1, [1.0, 0.58, 0.06]]],
      haze: [0.060, 0.065, 0.190], deep: [0.006, 0.008, 0.026], accent: '#6fc4ff' },
    { name: 'Закат',
      stops: [[0, [0.06, 0.10, 0.72]], [0.28, [0.55, 0.04, 0.62]], [0.52, [1.0, 0.06, 0.28]], [0.78, [1.0, 0.42, 0.02]], [1, [1.0, 0.80, 0.30]]],
      haze: [0.170, 0.060, 0.110], deep: [0.020, 0.006, 0.014], accent: '#ff8a5c' },
    { name: 'Аврора',
      stops: [[0, [0.06, 0.16, 0.90]], [0.28, [0.0, 0.70, 0.90]], [0.52, [0.02, 1.0, 0.45]], [0.76, [0.62, 1.0, 0.12]], [1, [1.0, 0.36, 0.95]]],
      haze: [0.030, 0.120, 0.140], deep: [0.004, 0.012, 0.018], accent: '#5bffb6' },
    { name: 'Лёд',
      stops: [[0, [0.06, 0.16, 0.85]], [0.35, [0.14, 0.55, 1.0]], [0.66, [0.55, 0.85, 1.0]], [1, [1.0, 0.94, 0.80]]],
      haze: [0.060, 0.100, 0.180], deep: [0.006, 0.010, 0.024], accent: '#bfe0ff' }
  ];

  function buildLUT(stops) {
    var lut = new Float32Array(256 * 3);
    for (var i = 0; i < 256; i++) {
      var t = i / 255, k = 0;
      while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      var t0 = stops[k][0], t1 = stops[k + 1][0];
      var c0 = stops[k][1], c1 = stops[k + 1][1];
      var u = clamp((t - t0) / (t1 - t0), 0, 1);
      lut[i * 3] = c0[0] + (c1[0] - c0[0]) * u;
      lut[i * 3 + 1] = c0[1] + (c1[1] - c0[1]) * u;
      lut[i * 3 + 2] = c0[2] + (c1[2] - c0[2]) * u;
    }
    return lut;
  }

  // Ядра размытия диафрагмы: малое — гауссово, большие — диски с кольцом (боке).
  function buildKernel(m) {
    var size = 2 * m + 1, k = new Float32Array(size * size), sum = 0, i = 0, x, y;
    for (y = -m; y <= m; y++) {
      for (x = -m; x <= m; x++) {
        var d = Math.sqrt(x * x + y * y), w;
        if (m === 1) w = Math.exp(-(d * d) / (2 * 0.72 * 0.72));
        else w = clamp(m + 0.7 - d, 0, 1) * (1 + 0.55 * (d / m) * (d / m));
        k[i++] = w; sum += w;
      }
    }
    for (i = 0; i < k.length; i++) k[i] /= sum;
    return k;
  }

  // Ящичное размытие 3-канального буфера с нулевым краем. src -> tmp -> dst.
  var colSum = new Float32Array(0);
  function boxBlur3(src, dst, tmp, w, h, rad) {
    var inv = 1 / (2 * rad + 1), x, y, i, o, row, sr, sg, sb, xa, xr;
    var w3 = w * 3;
    for (y = 0; y < h; y++) {
      row = y * w3; sr = 0; sg = 0; sb = 0;
      for (x = 0; x <= rad && x < w; x++) { o = row + x * 3; sr += src[o]; sg += src[o + 1]; sb += src[o + 2]; }
      for (x = 0; x < w; x++) {
        o = row + x * 3; tmp[o] = sr * inv; tmp[o + 1] = sg * inv; tmp[o + 2] = sb * inv;
        xa = x + rad + 1;
        if (xa < w) { o = row + xa * 3; sr += src[o]; sg += src[o + 1]; sb += src[o + 2]; }
        xr = x - rad;
        if (xr >= 0) { o = row + xr * 3; sr -= src[o]; sg -= src[o + 1]; sb -= src[o + 2]; }
      }
    }
    if (colSum.length < w3) colSum = new Float32Array(w3);
    var col = colSum, ya, yr;
    for (i = 0; i < w3; i++) col[i] = 0;
    for (y = 0; y <= rad && y < h; y++) { row = y * w3; for (i = 0; i < w3; i++) col[i] += tmp[row + i]; }
    for (y = 0; y < h; y++) {
      row = y * w3;
      for (i = 0; i < w3; i++) dst[row + i] = col[i] * inv;
      ya = y + rad + 1;
      if (ya < h) { o = ya * w3; for (i = 0; i < w3; i++) col[i] += tmp[o + i]; }
      yr = y - rad;
      if (yr >= 0) { o = yr * w3; for (i = 0; i < w3; i++) col[i] -= tmp[o + i]; }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Движок                                                             */
  /* ------------------------------------------------------------------ */

  function createEngine() {
    var MAXP = 140000;
    var P = { count: 44000, speed: 1.0, turb: 1.0, tau: 0.42, glow: 1.0, spin: 1.0 };

    /* ---------- поле скоростей на сетке ---------- */
    var Rx = 8.8, Ry = 5.2, Rz = 8.8;
    var NXG = 45, NYG = 27, NZG = 45;
    var hx = 2 * Rx / (NXG - 1), hy = 2 * Ry / (NYG - 1), hz = 2 * Rz / (NZG - 1);
    var ihx = 1 / hx, ihy = 1 / hy, ihz = 1 / hz;
    var MXG = NXG - 1.001, MYG = NYG - 1.001, MZG = NZG - 1.001;
    var NODES = NXG * NYG * NZG;
    var G0 = new Float32Array(NODES * 3), G1 = new Float32Array(NODES * 3);
    var G2 = new Float32Array(NODES * 3), GC = new Float32Array(NODES * 3);
    var KF_DT = 0.5;
    var NW = 24;
    var wTX = new Float32Array(NW * NXG), wTY = new Float32Array(NW * NYG), wTZ = new Float32Array(NW * NZG);
    var wAX = new Float32Array(NW), wAY = new Float32Array(NW), wAZ = new Float32Array(NW);
    var wOM = new Float32Array(NW), wPH0 = new Float32Array(NW), wPH = new Float64Array(NW);
    var fieldSeed = 11, kf = 0, pend = 0, Tf = 0, T = 0;

    function buildWaves(seed, turb) {
      var rnd = mulberry32(seed);
      // [число волн, kmin, kmax, амплитуда, скорость фазы]
      var spec = [[6, 0.50, 0.74, 1.0, 0.20], [8, 0.95, 1.40, 0.66, 0.34], [10, 1.9, 2.7, 0.36, 0.55]];
      var w = 0, sumsq = 0, o, n, i;
      var KX = [], KY = [], KZ = [], A = [], B = [], C = [], KM = [];
      for (o = 0; o < 3; o++) {
        var sp = spec[o];
        var ampScale = o === 0 ? 1 : (o === 1 ? 0.55 + 0.45 * turb : turb);
        for (n = 0; n < sp[0]; n++, w++) {
          var z = rnd() * 2 - 1, ph = rnd() * TAU, s = Math.sqrt(1 - z * z);
          var kx = s * Math.cos(ph), ky = z * 1.5, kz = s * Math.sin(ph); // уклон к слоистым течениям
          var kl = Math.sqrt(kx * kx + ky * ky + kz * kz); kx /= kl; ky /= kl; kz /= kl;
          var rz = rnd() * 2 - 1, rph = rnd() * TAU, rs = Math.sqrt(1 - rz * rz);
          var ax = rs * Math.cos(rph), ay = rz, az = rs * Math.sin(rph);
          var d = ax * kx + ay * ky + az * kz; ax -= d * kx; ay -= d * ky; az -= d * kz;
          var l = Math.sqrt(ax * ax + ay * ay + az * az) || 1; ax /= l; ay /= l; az /= l;
          var km = sp[1] + (sp[2] - sp[1]) * rnd();
          var amp = sp[3] * (0.7 + 0.6 * rnd()) * ampScale;
          KX.push(kx * km); KY.push(ky * km); KZ.push(kz * km); KM.push(km);
          A.push(ax * amp); B.push(ay * amp); C.push(az * amp);
          sumsq += amp * amp * 0.5;
          wOM[w] = sp[4] * (0.6 + 0.8 * rnd()) * (rnd() < 0.5 ? -1 : 1);
          wPH0[w] = rnd() * TAU;
        }
      }
      var norm = 1 / Math.sqrt(sumsq);          // rms скорости поля = 1
      for (w = 0; w < NW; w++) {
        wAX[w] = A[w] * norm; wAY[w] = B[w] * norm; wAZ[w] = C[w] * norm;
        for (i = 0; i < NXG; i++) wTX[w * NXG + i] = KX[w] * (-Rx + i * hx);
        for (i = 0; i < NYG; i++) wTY[w * NYG + i] = KY[w] * (-Ry + i * hy);
        for (i = 0; i < NZG; i++) wTZ[w * NZG + i] = KZ[w] * (-Rz + i * hz);
      }
    }

    function fillNodes(G, t, n0, n1) {
      var w, n;
      for (w = 0; w < NW; w++) wPH[w] = wOM[w] * t + wPH0[w];
      var nxy = NXG * NYG;
      for (n = n0; n < n1; n++) {
        var iz = (n / nxy) | 0, rem = n - iz * nxy, iy = (rem / NXG) | 0, ix = rem - iy * NXG;
        var vx = 0, vy = 0, vz = 0;
        for (w = 0; w < NW; w++) {
          var c = fcos(wTX[w * NXG + ix] + wTY[w * NYG + iy] + wTZ[w * NZG + iz] + wPH[w]);
          vx += c * wAX[w]; vy += c * wAY[w]; vz += c * wAZ[w];
        }
        var o = n * 3; G[o] = vx; G[o + 1] = vy; G[o + 2] = vz;
      }
    }

    function fieldInit(t) {
      Tf = t; kf = Math.floor(t / KF_DT); pend = 0;
      fillNodes(G0, kf * KF_DT, 0, NODES);
      fillNodes(G1, (kf + 1) * KF_DT, 0, NODES);
    }

    // Ключевые кадры поля считаются порциями; между ними — линейное смешивание
    // (линейная комбинация бездивергентных полей бездивергентна).
    function fieldUpdate(dtf) {
      Tf += dtf;
      var tmp, i;
      while (Tf >= (kf + 1) * KF_DT) {
        if (pend < NODES) fillNodes(G2, (kf + 2) * KF_DT, pend, NODES);
        tmp = G0; G0 = G1; G1 = G2; G2 = tmp; kf++; pend = 0;
      }
      if (pend < NODES) {
        var budget = Math.ceil(NODES * dtf / KF_DT * 1.3) + 1;
        var n1 = Math.min(NODES, pend + budget);
        fillNodes(G2, (kf + 2) * KF_DT, pend, n1); pend = n1;
      }
      var s = (Tf - kf * KF_DT) / KF_DT, m = NODES * 3;
      for (i = 0; i < m; i++) GC[i] = G0[i] + (G1[i] - G0[i]) * s;
    }

    /* ---------- эмиттеры ---------- */
    var NE = 4, P_EMIT = 0.62;
    var EM = [], EMX = [0, 0, 0, 0], EMY = [0, 0, 0, 0], EMZ = [0, 0, 0, 0];
    var EMVX = [0, 0, 0, 0], EMVY = [0, 0, 0, 0], EMVZ = [0, 0, 0, 0], EMH = [0, 0, 0, 0];
    (function () {
      var r = mulberry32(2025);
      for (var e = 0; e < NE; e++) {
        EM.push({
          cx: (r() - 0.5) * 3, cy: (r() - 0.5) * 1.2, cz: (r() - 0.5) * 3,
          rx: 3.2 + r() * 2.2, ry: 1.0 + r() * 0.9, rz: 3.2 + r() * 2.2,
          wx: 0.10 + r() * 0.12, wy: 0.13 + r() * 0.12, wz: 0.09 + r() * 0.12,
          px: r() * TAU, py: r() * TAU, pz: r() * TAU
        });
      }
    })();
    function emittersUpdate() {
      for (var e = 0; e < NE; e++) {
        var m = EM[e];
        EMX[e] = m.cx + m.rx * Math.sin(m.wx * T + m.px);
        EMY[e] = m.cy + m.ry * Math.sin(m.wy * T + m.py);
        EMZ[e] = m.cz + m.rz * Math.sin(m.wz * T + m.pz);
        EMVX[e] = m.rx * m.wx * Math.cos(m.wx * T + m.px);
        EMVY[e] = m.ry * m.wy * Math.cos(m.wy * T + m.py);
        EMVZ[e] = m.rz * m.wz * Math.cos(m.wz * T + m.pz);
        EMH[e] = clamp(0.08 + 0.28 * e + 0.05 * Math.sin(T * 0.05 + e * 1.7), 0, 1);
      }
    }

    /* ---------- частицы ---------- */
    var X = new Float32Array(MAXP), Y = new Float32Array(MAXP), Z = new Float32Array(MAXP);
    var VX = new Float32Array(MAXP), VY = new Float32Array(MAXP), VZ = new Float32Array(MAXP);
    var AGE = new Float32Array(MAXP), LIFE = new Float32Array(MAXP);
    var HUE = new Float32Array(MAXP), GAIN = new Float32Array(MAXP);
    var PSX = new Float32Array(MAXP), PSY = new Float32Array(MAXP);
    var KIND = new Uint8Array(MAXP);
    var VS = 2.4;                // единиц/с на единицу rms поля
    var SWIRL = 0.12;            // общее вращение вокруг вертикали
    var AX_E = 8.6, AY_E = 4.6;  // полуоси эллипсоида содержания

    function respawn(i, initial) {
      var r = Math.random(), e, a, b, s, rad;
      if (r < P_EMIT) {
        e = (Math.random() * NE) | 0;
        X[i] = EMX[e] + (Math.random() + Math.random() + Math.random() - 1.5) * 0.85;
        Y[i] = EMY[e] + (Math.random() + Math.random() + Math.random() - 1.5) * 0.55;
        Z[i] = EMZ[e] + (Math.random() + Math.random() + Math.random() - 1.5) * 0.85;
        VX[i] = EMVX[e] * VS * 0.4; VY[i] = EMVY[e] * VS * 0.4; VZ[i] = EMVZ[e] * VS * 0.4;
        HUE[i] = clamp(EMH[e] + (Math.random() - 0.5) * 0.10, 0, 1);
        LIFE[i] = 5.5 + Math.random() * 6.5;
        KIND[i] = e + 1;
      } else {
        a = Math.random() * 2 - 1; b = Math.random() * TAU; s = Math.sqrt(1 - a * a);
        rad = Math.pow(Math.random(), 0.42);
        X[i] = s * Math.cos(b) * rad * AX_E * 0.97;
        Y[i] = a * rad * AY_E * 0.97;
        Z[i] = s * Math.sin(b) * rad * AX_E * 0.97;
        VX[i] = 0; VY[i] = 0; VZ[i] = 0;
        HUE[i] = 0.04 + Math.random() * 0.60;
        LIFE[i] = 11 + Math.random() * 12;
        KIND[i] = 0;
      }
      AGE[i] = initial ? Math.random() * LIFE[i] : 0;
      var q = Math.random(); q *= q; q *= q; q *= q;      // редкие яркие искры
      GAIN[i] = 0.5 + 1.6 * q; if (Math.random() < 0.03) GAIN[i] *= 3;
      PSX[i] = -1e9; PSY[i] = 0;
    }

    /* ---------- камера ---------- */
    var cam = { t: 0, yaw0: 0.55, uYaw: 0, uPitch: 0, yawVel: 0, zoom: 1, mx: 0, my: 0, smx: 0, smy: 0 };
    var camX = 0, camY = 0, camZ = 12, cfx = 0, cfy = 0, cfz = -1;
    var crx = 1, cry = 0, crz = 0, cux = 0, cuy = 1, cuz = 0;
    var focal = 700, camDist = 13;
    var FOV = 0.95;

    function updateCamera(dt) {
      cam.t += dt;
      cam.uYaw += cam.yawVel * dt;
      cam.yawVel *= Math.exp(-dt * 2.2);
      var k = Math.min(1, dt * 2.5);
      cam.smx += (cam.mx - cam.smx) * k; cam.smy += (cam.my - cam.smy) * k;
      var t = cam.t;
      var yaw = cam.yaw0 + t * 0.075 * P.spin + cam.uYaw + cam.smx * 0.16;
      var pitch = clamp(0.30 + 0.12 * Math.sin(t * 0.13) + cam.uPitch - cam.smy * 0.08, -1.2, 1.35);
      var dist = 12.2 * cam.zoom * (1 + 0.07 * Math.sin(t * 0.083 + 1.0));
      var roll = 0.03 * Math.sin(t * 0.071 + 0.5);
      var tx = 0.5 * Math.sin(t * 0.047), ty = 0.25 * Math.sin(t * 0.061 + 1.3), tz = 0.4 * Math.cos(t * 0.039);
      var cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
      camX = tx + dist * cp * sy; camY = ty + dist * sp; camZ = tz + dist * cp * cy;
      cfx = -cp * sy; cfy = -sp; cfz = -cp * cy;
      var rl = Math.sqrt(cfz * cfz + cfx * cfx) || 1;
      var rx = -cfz / rl, ry = 0, rz = cfx / rl;
      var ux = ry * cfz - rz * cfy, uy = rz * cfx - rx * cfz, uz = rx * cfy - ry * cfx;
      var cr = Math.cos(roll), sr = Math.sin(roll);
      crx = rx * cr + ux * sr; cry = ry * cr + uy * sr; crz = rz * cr + uz * sr;
      cux = -rx * sr + ux * cr; cuy = -ry * sr + uy * cr; cuz = -rz * sr + uz * cr;
      camDist = dist;
    }

    /* ---------- буферы кадра ---------- */
    var W = 0, H = 0, acc = null;
    var w1 = 0, h1 = 0, w2 = 0, h2 = 0;
    var b1acc, b1a, b1b, b2acc, b2a, b2b, tmp1, tmp2;
    var imgBuf, img32, img8, b1Buf, b1_32, b1_8, b2Buf, b2_32, b2_8;
    var EXPO = 1.5, GAMMA = 0.58, LUT_N = 8192, LUT_S = 1024;
    var lut = new Uint8Array(LUT_N);
    (function () {
      for (var k = 0; k < LUT_N; k++) {
        lut[k] = Math.round(255 * Math.pow(1 - Math.exp(-EXPO * k / LUT_S), GAMMA));
      }
    })();
    var KERN = [null, buildKernel(1), buildKernel(2), buildKernel(3)];

    var fogLUT = new Float32Array(400);
    (function () {
      for (var k = 0; k < 400; k++) {
        var cz = k / 8;
        fogLUT[k] = Math.exp(-0.052 * Math.max(0, cz - 6.5));
      }
    })();

    /* ---------- задник: далёкие звёзды и боке-шары (без следов) ---------- */
    var NS = 3000, SXw = new Float32Array(NS), SYw = new Float32Array(NS), SZw = new Float32Array(NS);
    var SBr = new Float32Array(NS), SHu = new Float32Array(NS), SPh = new Float32Array(NS);
    var NO = 34;
    var OX = new Float32Array(NO), OY = new Float32Array(NO), OZ = new Float32Array(NO);
    var OVX = new Float32Array(NO), OVY = new Float32Array(NO), OVZ = new Float32Array(NO);
    var ORw = new Float32Array(NO), OAl = new Float32Array(NO), OHu = new Float32Array(NO);
    (function () {
      var r = mulberry32(77), i, a, b, s, rad;
      for (i = 0; i < NS; i++) {
        a = r() * 2 - 1; b = r() * TAU; s = Math.sqrt(1 - a * a); rad = 30 + r() * 60;
        SXw[i] = s * Math.cos(b) * rad; SYw[i] = a * rad; SZw[i] = s * Math.sin(b) * rad;
        var q = r(); SBr[i] = 0.12 + 0.88 * q * q; SHu[i] = r() * 0.7; SPh[i] = r() * TAU;
      }
      for (i = 0; i < NO; i++) {
        a = r() * 2 - 1; b = r() * TAU; s = Math.sqrt(1 - a * a); rad = 10 + r() * 14;
        OX[i] = s * Math.cos(b) * rad; OY[i] = a * rad * 0.7; OZ[i] = s * Math.sin(b) * rad;
        OVX[i] = (r() - 0.5) * 0.5; OVY[i] = (r() - 0.5) * 0.25; OVZ[i] = (r() - 0.5) * 0.5;
        ORw[i] = 0.22 + r() * 0.65; OAl[i] = 0.35 + r() * 0.65; OHu[i] = r() * 0.8;
      }
    })();

    function drawBackdrop(dt) {
      var I = img8, PAL = palCur, hw = W * 0.5, hh = H * 0.5, i, k;
      var tw = cam.t * 1.9, wm = W - 1, hm = H - 1;
      for (i = 0; i < NS; i++) {
        var dx = SXw[i] - camX, dy = SYw[i] - camY, dz = SZw[i] - camZ;
        var cz = dx * cfx + dy * cfy + dz * cfz;
        if (cz < 1) continue;
        var cx = dx * crx + dy * cry + dz * crz, cy = dx * cux + dy * cuy + dz * cuz;
        var iz = 1 / cz, sx = hw + focal * cx * iz, sy = hh - focal * cy * iz;
        if (sx < 0 || sx >= wm || sy < 0 || sy >= hm) continue;
        var v = SBr[i] * (0.7 + 0.3 * Math.sin(tw + SPh[i])) * 200;
        var pi = ((SHu[i] * 255) | 0) * 3;
        var cr = (0.5 + 0.5 * PAL[pi]) * v, cg = (0.5 + 0.5 * PAL[pi + 1]) * v, cb = (0.5 + 0.5 * PAL[pi + 2]) * v;
        var xi = sx | 0, yi = sy | 0, fx = sx - xi, fy = sy - yi;
        var q = (yi * W + xi) * 4;
        var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        I[q] += cr * w00; I[q + 1] += cg * w00; I[q + 2] += cb * w00;
        I[q + 4] += cr * w10; I[q + 5] += cg * w10; I[q + 6] += cb * w10;
        q += W * 4;
        I[q] += cr * w01; I[q + 1] += cg * w01; I[q + 2] += cb * w01;
        I[q + 4] += cr * w11; I[q + 5] += cg * w11; I[q + 6] += cb * w11;
      }
      // боке-шары: мягкие диски с ярким ободком, смещаются очень медленно
      for (k = 0; k < NO; k++) {
        OX[k] += OVX[k] * dt; OY[k] += OVY[k] * dt; OZ[k] += OVZ[k] * dt;
        if (OX[k] * OX[k] + OY[k] * OY[k] + OZ[k] * OZ[k] > 26 * 26) { OVX[k] = -OVX[k]; OVY[k] = -OVY[k]; OVZ[k] = -OVZ[k]; }
        var ex = OX[k] - camX, ey = OY[k] - camY, ez = OZ[k] - camZ;
        var ecz = ex * cfx + ey * cfy + ez * cfz;
        if (ecz < 2.5) continue;
        var ecx = ex * crx + ey * cry + ez * crz, ecy = ex * cux + ey * cuy + ez * cuz;
        var ei = 1 / ecz, ox = hw + focal * ecx * ei, oy = hh - focal * ecy * ei;
        var R = ORw[k] * focal * ei; if (R < 3) continue; if (R > 34) R = 34;
        var x0 = Math.max(0, Math.floor(ox - R)), x1 = Math.min(W - 1, Math.ceil(ox + R));
        var y0 = Math.max(0, Math.floor(oy - R)), y1 = Math.min(H - 1, Math.ceil(oy + R));
        var pj = ((OHu[k] * 255) | 0) * 3;
        var peak = 26 * OAl[k] * (1 + 3 / R) * Math.min(1, (ecz - 2.5) * 0.25);
        var or_ = PAL[pj] * peak, og = PAL[pj + 1] * peak, ob = PAL[pj + 2] * peak;
        var R2 = R * R, edgeK = 1 / (2 * R * (0.2 * R + 1));
        for (var yy = y0; yy <= y1; yy++) {
          var ddy = yy - oy, qq = (yy * W + x0) * 4;
          for (var xx = x0; xx <= x1; xx++, qq += 4) {
            var ddx = xx - ox, d2 = ddx * ddx + ddy * ddy;
            if (d2 >= R2) continue;
            var wgt = (R2 - d2) * edgeK; if (wgt > 1) wgt = 1;
            wgt *= 0.5 + 0.5 * (d2 / R2);
            I[qq] += or_ * wgt; I[qq + 1] += og * wgt; I[qq + 2] += ob * wgt;
          }
        }
      }
    }

    /* ---------- палитра (плавная смена) ---------- */
    var palLUTs = PALETTES.map(function (p) { return buildLUT(p.stops); });
    var palCur = new Float32Array(palLUTs[0]), palFrom = new Float32Array(palLUTs[0]);
    var palTo = 0, palMix = 1;
    var haze = PALETTES[0].haze.slice(), deep = PALETTES[0].deep.slice();
    var hazeFrom = haze.slice(), deepFrom = deep.slice();

    function setPalette(i) {
      palFrom.set(palCur); hazeFrom = haze.slice(); deepFrom = deep.slice();
      palTo = i; palMix = 0;
    }
    function palUpdate(dt) {
      if (palMix >= 1) return;
      palMix = Math.min(1, palMix + dt / 1.4);
      var u = palMix * palMix * (3 - 2 * palMix), tgt = palLUTs[palTo], i;
      for (i = 0; i < 768; i++) palCur[i] = palFrom[i] + (tgt[i] - palFrom[i]) * u;
      for (i = 0; i < 3; i++) {
        haze[i] = hazeFrom[i] + (PALETTES[palTo].haze[i] - hazeFrom[i]) * u;
        deep[i] = deepFrom[i] + (PALETTES[palTo].deep[i] - deepFrom[i]) * u;
      }
    }

    /* ---------- параметры качества ---------- */
    var Q = 1, nAct = 0, nPrev = 0;

    function setViewport(nw, nh) {
      W = nw; H = nh;
      acc = new Float32Array(W * H * 3);
      w1 = Math.ceil(W / 4); h1 = Math.ceil(H / 4);
      w2 = Math.ceil(W / 16); h2 = Math.ceil(H / 16);
      b1acc = new Float32Array(w1 * h1 * 3); b1a = new Float32Array(w1 * h1 * 3);
      b1b = new Float32Array(w1 * h1 * 3); tmp1 = new Float32Array(w1 * h1 * 3);
      b2acc = new Float32Array(w2 * h2 * 3); b2a = new Float32Array(w2 * h2 * 3);
      b2b = new Float32Array(w2 * h2 * 3); tmp2 = new Float32Array(w2 * h2 * 3);
      imgBuf = new ArrayBuffer(W * H * 4); img32 = new Uint32Array(imgBuf); img8 = new Uint8ClampedArray(imgBuf);
      b1Buf = new ArrayBuffer(w1 * h1 * 4); b1_32 = new Uint32Array(b1Buf); b1_8 = new Uint8ClampedArray(b1Buf);
      b2Buf = new ArrayBuffer(w2 * h2 * 4); b2_32 = new Uint32Array(b2Buf); b2_8 = new Uint8ClampedArray(b2Buf);
      for (var i = 0; i < img32.length; i++) img32[i] = 0xFF000000;
      for (i = 0; i < b1_32.length; i++) b1_32[i] = 0xFF000000;
      for (i = 0; i < b2_32.length; i++) b2_32[i] = 0xFF000000;
      for (i = 0; i < MAXP; i++) PSX[i] = -1e9;
      api.W = W; api.H = H; api.w1 = w1; api.h1 = h1; api.w2 = w2; api.h2 = h2;
      api.img8 = img8; api.img32 = img32; api.b1_8 = b1_8; api.b1_32 = b1_32; api.b2_8 = b2_8; api.b2_32 = b2_32;
      focal = 0.5 * Math.min(H, W * 0.62) / Math.tan(0.5 * FOV);
    }

    /* ---------- шаг частиц ---------- */
    var dtScale = 1, baseA = 0.05, hueShift = 0;
    var BL1 = 1.5 / 16;  // вклад частицы в bloom с поправкой на площадь пикселя

    function particles(sdt, draw) {
      var n = nAct;
      var kR = 1 - Math.exp(-sdt * 3.0);
      var Wf = W, Hf = H, hw = W * 0.5, hh = H * 0.5;
      var sx1 = w1 / W, sy1 = h1 / H;
      var invFI = 1 / 0.9, invFO = 1 / 1.6;
      var invF = 1 / camDist, dofK = 0.04 * focal;
      var PAL = palCur, A = acc;
      var vsc = 1 / (VS * 1.5);
      var ax2 = 1 / (AX_E * AX_E), ay2 = 1 / (AY_E * AY_E);
      var wm = W - 1, hm = H - 1;
      var i;

      for (i = 0; i < n; i++) {
        var age = AGE[i] + sdt;
        var life = LIFE[i];
        if (age >= life) { respawn(i, false); age = 0; life = LIFE[i]; }
        AGE[i] = age;
        var x = X[i], y = Y[i], z = Z[i];

        /* --- поле: трилинейная выборка --- */
        var gx = (x + Rx) * ihx, gy = (y + Ry) * ihy, gz = (z + Rz) * ihz;
        if (gx < 0) gx = 0; else if (gx > MXG) gx = MXG;
        if (gy < 0) gy = 0; else if (gy > MYG) gy = MYG;
        if (gz < 0) gz = 0; else if (gz > MZG) gz = MZG;
        var ix = gx | 0, iy = gy | 0, iz = gz | 0;
        var fx = gx - ix, fy = gy - iy, fz = gz - iz;
        var o = ((iz * NYG + iy) * NXG + ix) * 3;
        var oy = NXG * 3, oz = NXG * NYG * 3;
        var gx0 = 1 - fx, gy0 = 1 - fy, gz0 = 1 - fz;
        var c00 = gy0 * gz0, c10 = fy * gz0, c01 = gy0 * fz, c11 = fy * fz;
        var a000 = gx0 * c00, a100 = fx * c00, a010 = gx0 * c10, a110 = fx * c10;
        var a001 = gx0 * c01, a101 = fx * c01, a011 = gx0 * c11, a111 = fx * c11;
        var o010 = o + oy, o001 = o + oz, o011 = o + oy + oz;
        var tx = GC[o] * a000 + GC[o + 3] * a100 + GC[o010] * a010 + GC[o010 + 3] * a110 +
                 GC[o001] * a001 + GC[o001 + 3] * a101 + GC[o011] * a011 + GC[o011 + 3] * a111;
        var ty = GC[o + 1] * a000 + GC[o + 4] * a100 + GC[o010 + 1] * a010 + GC[o010 + 4] * a110 +
                 GC[o001 + 1] * a001 + GC[o001 + 4] * a101 + GC[o011 + 1] * a011 + GC[o011 + 4] * a111;
        var tz = GC[o + 2] * a000 + GC[o + 5] * a100 + GC[o010 + 2] * a010 + GC[o010 + 5] * a110 +
                 GC[o001 + 2] * a001 + GC[o001 + 5] * a101 + GC[o011 + 2] * a011 + GC[o011 + 5] * a111;

        /* --- вращение и мягкое содержание в эллипсоиде --- */
        tx += SWIRL * z; tz -= SWIRL * x;
        var rho2 = x * x * ax2 + y * y * ay2 + z * z * ax2;
        if (rho2 > 0.64) {
          var rho = Math.sqrt(rho2), f = (rho - 0.8) * 3.2;
          var ir = f / (Math.sqrt(x * x + y * y + z * z) + 1e-3);
          tx -= x * ir; ty -= y * ir * 1.6; tz -= z * ir;
        }

        /* --- инерция и интегрирование --- */
        var vx = VX[i], vy = VY[i], vz = VZ[i];
        vx += (tx * VS - vx) * kR; vy += (ty * VS - vy) * kR; vz += (tz * VS - vz) * kR;
        VX[i] = vx; VY[i] = vy; VZ[i] = vz;
        x += vx * sdt; y += vy * sdt; z += vz * sdt;
        X[i] = x; Y[i] = y; Z[i] = z;
        if (!draw) continue;

        /* --- проекция --- */
        var dx = x - camX, dy = y - camY, dz = z - camZ;
        var cz = dx * cfx + dy * cfy + dz * cfz;
        if (cz < 0.6) { PSX[i] = -1e9; continue; }
        var cx = dx * crx + dy * cry + dz * crz;
        var cy = dx * cux + dy * cuy + dz * cuz;
        var izc = 1 / cz;
        var sx = hw + focal * cx * izc, sy = hh - focal * cy * izc;
        var psx = PSX[i], psy = PSY[i];
        PSX[i] = sx; PSY[i] = sy;

        /* --- яркость --- */
        var spN = Math.sqrt(vx * vx + vy * vy + vz * vz) * vsc;
        var fade = age * invFI; var rem = (life - age) * invFO;
        if (rem < fade) fade = rem; if (fade > 1) fade = 1;
        fade = fade * fade * (3 - 2 * fade);
        var ki = (cz * 8) | 0; if (ki > 399) ki = 399;
        var a = baseA * fade * fogLUT[ki] * (0.22 + 0.95 * spN) * GAIN[i];
        if (KIND[i] === 0) a *= 0.55;
        if (cz < 3) a *= (cz - 0.6) * 0.4167;
        if (a < 1e-5) continue;

        var cc = HUE[i] + hueShift + 0.34 * (spN - 0.4) + 0.12 * clamp((16 - cz) * 0.1, -0.5, 1) + 0.12 * age / life;
        if (cc < 0) cc = 0; else if (cc > 1) cc = 1;
        var pi = ((cc * 255) | 0) * 3;
        var cr = PAL[pi], cg = PAL[pi + 1], cb = PAL[pi + 2];

        if (sx < -12 || sx > Wf + 12 || sy < -12 || sy > Hf + 12) continue;

        /* --- свечение вокруг (bloom): пиксель на 1/4 и 1/16 --- */
        var bx = (sx * sx1) | 0, by = (sy * sy1) | 0;
        if (bx >= 0 && bx < w1 && by >= 0 && by < h1) {
          var bo = (by * w1 + bx) * 3, be = a * BL1;
          b1acc[bo] += cr * be; b1acc[bo + 1] += cg * be; b1acc[bo + 2] += cb * be;
        }

        /* --- диафрагма: радиус пятна рассеяния --- */
        var rr = (invF - izc); if (rr < 0) rr = -rr; rr *= dofK;
        var m = 0;
        if (rr >= 0.6) m = rr < 1.4 ? 1 : (rr < 2.4 ? 2 : 3);

        /* --- штрих от прошлой экранной позиции (и для расфокусных тоже) --- */
        var sdx = sx - psx, sdy = sy - psy, steps = 1;
        if (psx > -1e8) {
          var spacing = m >= 2 ? m : 1.6;
          var len = Math.sqrt(sdx * sdx + sdy * sdy);
          if (len > 90) { steps = 1; sdx = 0; sdy = 0; }
          else if (len > spacing) {
            steps = Math.ceil(len / spacing); if (steps > (m ? 6 : 8)) steps = m ? 6 : 8;
          }
        }
        var g = (1 + 0.5 * (steps - 1)) / steps;
        var s, tt, px, py;
        if (m === 0) {
          var ar = cr * a * g, ag = cg * a * g, ab = cb * a * g;
          for (s = 1; s <= steps; s++) {
            tt = s / steps;
            px = psx + sdx * tt; py = psy + sdy * tt;
            if (steps === 1) { px = sx; py = sy; }
            if (px < 0 || px >= wm || py < 0 || py >= hm) continue;
            var pxi = px | 0, pyi = py | 0, ffx = px - pxi, ffy = py - pyi;
            var q = (pyi * Wf + pxi) * 3;
            var w00 = (1 - ffx) * (1 - ffy), w10 = ffx * (1 - ffy), w01 = (1 - ffx) * ffy, w11 = ffx * ffy;
            A[q] += ar * w00; A[q + 1] += ag * w00; A[q + 2] += ab * w00;
            A[q + 3] += ar * w10; A[q + 4] += ag * w10; A[q + 5] += ab * w10;
            q += Wf * 3;
            A[q] += ar * w01; A[q + 1] += ag * w01; A[q + 2] += ab * w01;
            A[q + 3] += ar * w11; A[q + 4] += ag * w11; A[q + 5] += ab * w11;
          }
        } else {
          /* расфокус: диск боке, размазанный вдоль штриха */
          var kern = KERN[m], size = 2 * m + 1;
          var bst = a * (1 + 0.3 * m) * g;
          var kr = cr * bst, kg = cg * bst, kb = cb * bst;
          for (s = 1; s <= steps; s++) {
            tt = s / steps;
            px = steps === 1 ? sx : psx + sdx * tt; py = steps === 1 ? sy : psy + sdy * tt;
            var kix = (px + 0.5) | 0, kiy = (py + 0.5) | 0;
            if (kix < m || kix >= Wf - m || kiy < m || kiy >= Hf - m) continue;
            var kk = 0;
            for (var yy = -m; yy <= m; yy++) {
              var qq = ((kiy + yy) * Wf + kix - m) * 3;
              for (var xx = 0; xx < size; xx++) {
                var kw = kern[kk++];
                A[qq] += kr * kw; A[qq + 1] += kg * kw; A[qq + 2] += kb * kw;
                qq += 3;
              }
            }
          }
        }
      }
    }

    /* ---------- тон-маппинг + затухание следов ---------- */
    function tonemap(decay, glow) {
      var A = acc, I = img32, L = lut, S = LUT_S, MK = LUT_N - 1;
      var n = W * H, j = 0, i, kr, kg, kb;
      for (i = 0; i < n; i++, j += 3) {
        var r = A[j], g = A[j + 1], b = A[j + 2];
        if (r + g + b < 1e-5) { A[j] = 0; A[j + 1] = 0; A[j + 2] = 0; I[i] = 0xFF000000; continue; }
        A[j] = r * decay; A[j + 1] = g * decay; A[j + 2] = b * decay;
        kr = (r * S) | 0; if (kr > MK) kr = MK;
        kg = (g * S) | 0; if (kg > MK) kg = MK;
        kb = (b * S) | 0; if (kb > MK) kb = MK;
        I[i] = 0xFF000000 | (L[kb] << 16) | (L[kg] << 8) | L[kr];
      }
      // bloom 1/4: размытие + тон-маппинг + затухание
      boxBlur3(b1acc, b1a, tmp1, w1, h1, 2);
      boxBlur3(b1a, b1b, tmp1, w1, h1, 2);
      var sc1 = S * glow * 1.0, m1 = w1 * h1 * 3;
      var I1 = b1_32, B = b1b, k;
      for (i = 0, j = 0; i < w1 * h1; i++, j += 3) {
        kr = (B[j] * sc1) | 0; if (kr > MK) kr = MK;
        kg = (B[j + 1] * sc1) | 0; if (kg > MK) kg = MK;
        kb = (B[j + 2] * sc1) | 0; if (kb > MK) kb = MK;
        I1[i] = 0xFF000000 | (L[kb] << 16) | (L[kg] << 8) | L[kr];
      }
      // bloom 1/16: широкая дымка = усреднение bloom 1/4 по блокам 4x4, затем размытие
      var x2, y2, xx, yy, cnt, sr, sg, sb, o2;
      for (y2 = 0; y2 < h2; y2++) {
        for (x2 = 0; x2 < w2; x2++) {
          sr = 0; sg = 0; sb = 0; cnt = 0;
          for (yy = y2 * 4; yy < y2 * 4 + 4 && yy < h1; yy++) {
            o2 = (yy * w1 + x2 * 4) * 3;
            for (xx = x2 * 4; xx < x2 * 4 + 4 && xx < w1; xx++, o2 += 3) { sr += b1acc[o2]; sg += b1acc[o2 + 1]; sb += b1acc[o2 + 2]; cnt++; }
          }
          o2 = (y2 * w2 + x2) * 3; cnt = cnt > 0 ? 1 / cnt : 0;
          b2acc[o2] = sr * cnt; b2acc[o2 + 1] = sg * cnt; b2acc[o2 + 2] = sb * cnt;
        }
      }
      boxBlur3(b2acc, b2a, tmp2, w2, h2, 2);
      boxBlur3(b2a, b2b, tmp2, w2, h2, 2);
      boxBlur3(b2b, b2a, tmp2, w2, h2, 1);
      var sc2 = S * glow * 2.7;
      var I2 = b2_32; B = b2a;
      for (i = 0, j = 0; i < w2 * h2; i++, j += 3) {
        kr = (B[j] * sc2) | 0; if (kr > MK) kr = MK;
        kg = (B[j + 1] * sc2) | 0; if (kg > MK) kg = MK;
        kb = (B[j + 2] * sc2) | 0; if (kb > MK) kb = MK;
        I2[i] = 0xFF000000 | (L[kb] << 16) | (L[kg] << 8) | L[kr];
      }
      var d1 = decay * 0.995;
      for (k = 0; k < m1; k++) { var v = b1acc[k] * d1; b1acc[k] = v < 1e-6 ? 0 : v; }
    }

    /* ---------- публичное API ---------- */
    var started = false, frameNo = 0;

    function advance(sdt, draw) {
      T += sdt;
      fieldUpdate(sdt);
      emittersUpdate();
      particles(sdt, draw);
    }

    function start() {
      T = 0; emittersUpdate();
      buildWaves(fieldSeed, P.turb);
      fieldInit(0);
      nAct = nPrev = Math.min(MAXP, P.count | 0);
      for (var i = 0; i < MAXP; i++) respawn(i, true);
      baseA = 0.05; pendingTurb = null;
      for (var s = 0; s < 52; s++) advance(0.08, false);
      for (i = 0; i < MAXP; i++) PSX[i] = -1e9;
      started = true;
    }

    var pendingTurb = null, turbStamp = 0;

    function frame(dt, freeze) {
      if (!started) start();
      frameNo++;
      if (dt > 0.05) dt = 0.05;
      updateCamera(freeze ? 0 : dt);
      palUpdate(dt);
      hueShift = 0.05 * Math.sin(cam.t * 0.07);
      // турбулентность меняем не чаще раза в 0.3 с (перестройка ключевого кадра)
      if (pendingTurb !== null && cam.t - turbStamp > 0.3) {
        buildWaves(fieldSeed, pendingTurb); pend = 0; pendingTurb = null; turbStamp = cam.t;
      }

      nAct = Math.min(MAXP, Math.round(P.count * (0.45 + 0.55 * Q)));
      if (nAct > nPrev) { for (var i = nPrev; i < nAct; i++) PSX[i] = -1e9; }
      nPrev = nAct;

      var sdt = freeze ? 0 : dt * P.speed;
      dtScale = freeze ? 1 : clamp(dt * 60, 0.25, 3);
      if (freeze) { acc.fill(0); b1acc.fill(0); }
      var ppp = nAct / (W * H), ref = 50000 / (1100 * 620);
      baseA = 0.019 * dtScale * Math.pow(ref / ppp, 0.75);
      var tA = performance.now();
      advance(sdt, true);
      var tB = performance.now();
      var decay = freeze ? 0 : Math.exp(-dt / P.tau);
      tonemap(decay, P.glow);
      drawBackdrop(sdt);
      api.tSim = tB - tA; api.tTone = performance.now() - tB;
      api.active = nAct;
    }

    function reseedFlow() {
      fieldSeed = (fieldSeed * 1664525 + 1013904223) >>> 0;
      buildWaves(fieldSeed, P.turb); pend = 0;
      for (var k = 0; k < NE; k++) { EM[k].px = Math.random() * TAU; EM[k].py = Math.random() * TAU; EM[k].pz = Math.random() * TAU; }
    }

    function setTurb(v) { P.turb = v; pendingTurb = v; }

    var api = {
      params: P, cam: cam,
      setViewport: setViewport, frame: frame, start: start,
      setPalette: setPalette, reseedFlow: reseedFlow, setTurb: setTurb,
      setQuality: function (q) { Q = clamp(q, 0, 1); },
      getQuality: function () { return Q; },
      haze: haze, deep: deep, palettes: PALETTES,
      active: 0, W: 0, H: 0, w1: 0, h1: 0, w2: 0, h2: 0
    };
    return api;
  }

  /* ------------------------------------------------------------------ */
  /*  Браузерная оболочка                                                */
  /* ------------------------------------------------------------------ */

  function boot() {
    var canvas = document.getElementById('view');
    var ctx = canvas.getContext('2d', { alpha: false });
    var eng = createEngine();

    var bufCv = document.createElement('canvas'), b1Cv = document.createElement('canvas'), b2Cv = document.createElement('canvas');
    var bufCtx = bufCv.getContext('2d'), b1Ctx = b1Cv.getContext('2d'), b2Ctx = b2Cv.getContext('2d');
    var imgData, b1Data, b2Data;
    var dispW = 0, dispH = 0;
    var RES_LEVELS = [1, 0.85, 0.72, 0.6], resLevel = 0;
    var MAXPX = 780000;       // потолок пикселей HDR-буфера
    var MAX_BACKING = 2600000; // потолок пикселей холста (поверх DPR ≤ 2)

    function layout() {
      var cssW = Math.max(1, window.innerWidth), cssH = Math.max(1, window.innerHeight);
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      dpr = Math.min(dpr, Math.max(0.5, Math.sqrt(MAX_BACKING / (cssW * cssH))));
      dispW = Math.max(2, Math.round(cssW * dpr)); dispH = Math.max(2, Math.round(cssH * dpr));
      canvas.width = dispW; canvas.height = dispH;
      var s = Math.min(1, Math.sqrt(MAXPX / (dispW * dispH))) * RES_LEVELS[resLevel];
      var W = Math.max(200, Math.round(dispW * s)), H = Math.max(120, Math.round(dispH * s));
      eng.setViewport(W, H);
      bufCv.width = W; bufCv.height = H;
      b1Cv.width = eng.w1; b1Cv.height = eng.h1;
      b2Cv.width = eng.w2; b2Cv.height = eng.h2;
      imgData = new ImageData(eng.img8, W, H);
      b1Data = new ImageData(eng.b1_8, eng.w1, eng.h1);
      b2Data = new ImageData(eng.b2_8, eng.w2, eng.h2);
    }

    /* ----- UI ----- */
    var panel = document.getElementById('panel');
    var panelToggle = document.getElementById('panelToggle');
    var sub = document.getElementById('sub');
    var btnPause = document.getElementById('btnPause');
    var paused = false, needRedraw = false, needLayout = false;

    var SL = {
      count: { fmt: function (v) { return Math.round(v / 1000) + 'k'; }, set: function (v) { eng.params.count = v; } },
      speed: { fmt: function (v) { return v.toFixed(2) + '×'; }, set: function (v) { eng.params.speed = v; } },
      turb: { fmt: function (v) { return v.toFixed(2); }, set: function (v) { eng.setTurb(v); } },
      trail: { fmt: function (v) { return v.toFixed(2) + ' с'; }, set: function (v) { eng.params.tau = v; } },
      glow: { fmt: function (v) { return v.toFixed(2); }, set: function (v) { eng.params.glow = v; } },
      spin: { fmt: function (v) { return v.toFixed(2) + '×'; }, set: function (v) { eng.params.spin = v; } }
    };
    Array.prototype.forEach.call(panel.querySelectorAll('input[type=range]'), function (inp) {
      var key = inp.getAttribute('data-key'), cfg = SL[key];
      var out = panel.querySelector('output[data-for="' + key + '"]');
      function apply() { var v = parseFloat(inp.value); cfg.set(v); out.textContent = cfg.fmt(v); inp.style.setProperty('--fill', ((v - inp.min) / (inp.max - inp.min) * 100) + '%'); }
      inp.addEventListener('input', apply);
      apply();
    });

    var swatches = panel.querySelectorAll('.pal button');
    function pickPalette(i) {
      eng.setPalette(i);
      Array.prototype.forEach.call(swatches, function (b, k) { b.classList.toggle('on', k === i); });
      document.documentElement.style.setProperty('--accent', PALETTES[i].accent);
    }
    Array.prototype.forEach.call(swatches, function (b, k) { b.addEventListener('click', function () { pickPalette(k); }); });
    pickPalette(0);

    function togglePause() {
      paused = !paused; btnPause.textContent = paused ? 'Пуск' : 'Пауза';
    }
    btnPause.addEventListener('click', togglePause);
    document.getElementById('btnFlow').addEventListener('click', function () { eng.reseedFlow(); });
    function togglePanel() { document.body.classList.toggle('nopanel'); }
    document.getElementById('btnHide').addEventListener('click', togglePanel);
    panelToggle.addEventListener('click', togglePanel);
    window.addEventListener('keydown', function (e) {
      if (e.target && e.target.tagName === 'INPUT') return;
      var k = e.key;
      if (k === ' ') { togglePause(); e.preventDefault(); }
      else if (k === 'h' || k === 'H' || k === 'р' || k === 'Р') togglePanel();
      else if (k === 'n' || k === 'N' || k === 'т' || k === 'Т') eng.reseedFlow();
      else if (k >= '1' && k <= '4') pickPalette(+k - 1);
    });

    /* ----- камера: перетаскивание, колесо, лёгкий параллакс ----- */
    var drag = null;
    canvas.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      eng.cam.yawVel = 0;
      canvas.classList.add('grab');
    });
    canvas.addEventListener('pointermove', function (e) {
      eng.cam.mx = (e.clientX / window.innerWidth - 0.5) * 2;
      eng.cam.my = (e.clientY / window.innerHeight - 0.5) * 2;
      if (!drag) return;
      var now = performance.now(), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      var dtm = Math.max(0.008, (now - drag.t) / 1000);
      eng.cam.uYaw -= dx * 0.0055;
      eng.cam.uPitch = clamp(eng.cam.uPitch + dy * 0.0045, -1.0, 1.1);
      eng.cam.yawVel += ((-dx * 0.0055 / dtm) - eng.cam.yawVel) * 0.5;
      drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
      if (paused) needRedraw = true;
    });
    function endDrag(e) {
      if (!drag) return;
      if (performance.now() - drag.t > 90) eng.cam.yawVel = 0;
      eng.cam.yawVel = clamp(eng.cam.yawVel, -2.2, 2.2);
      drag = null; canvas.classList.remove('grab');
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      eng.cam.zoom = clamp(eng.cam.zoom * Math.exp(e.deltaY * 0.0011), 0.5, 1.9);
    }, { passive: false });

    /* ----- фон: зерно плёнки ----- */
    (function () {
      var g = document.createElement('canvas'); g.width = g.height = 160;
      var gc = g.getContext('2d'), id = gc.createImageData(160, 160), d = id.data;
      for (var i = 0; i < d.length; i += 4) {
        var v = Math.random() < 0.5 ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = Math.floor(Math.random() * 26);
      }
      gc.putImageData(id, 0, 0);
      try { document.querySelector('.grain').style.backgroundImage = 'url(' + g.toDataURL('image/png') + ')'; } catch (err) { /* ignore */ }
    })();

    /* ----- цикл ----- */
    var last = performance.now(), workEMA = 8, dtEMA = 16.7, frames = 0, statT = 0, fpsShown = 60;

    function rgb(c, k) {
      return 'rgb(' + Math.round(clamp(c[0] * k, 0, 1) * 255) + ',' + Math.round(clamp(c[1] * k, 0, 1) * 255) + ',' + Math.round(clamp(c[2] * k, 0, 1) * 255) + ')';
    }

    function frame(now) {
      requestAnimationFrame(frame);
      var dt = (now - last) / 1000; last = now;
      if (!(dt > 0)) dt = 1 / 60;
      if (paused && !needRedraw) return;
      if (needLayout) { layout(); needLayout = false; }
      var dtc = Math.min(dt, 0.05);
      var t0 = performance.now();
      eng.frame(needRedraw && paused ? 1 / 60 : dtc, needRedraw && paused);
      needRedraw = false;

      bufCtx.putImageData(imgData, 0, 0);
      b1Ctx.putImageData(b1Data, 0, 0);
      b2Ctx.putImageData(b2Data, 0, 0);

      var breathe = 0.9 + 0.1 * Math.sin(now * 0.00037);
      var g = ctx.createRadialGradient(dispW * 0.5, dispH * 0.46, 0, dispW * 0.5, dispH * 0.5, Math.max(dispW, dispH) * 0.74);
      g.addColorStop(0, rgb(eng.haze, 1.15 * breathe));
      g.addColorStop(0.5, rgb(eng.haze, 0.42 * breathe));
      g.addColorStop(1, rgb(eng.deep, 1));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, dispW, dispH);
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bufCv, 0, 0, dispW, dispH);
      ctx.globalAlpha = 0.8; ctx.drawImage(b1Cv, 0, 0, dispW, dispH);
      ctx.globalAlpha = 0.9; ctx.drawImage(b2Cv, 0, 0, dispW, dispH);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

      /* адаптивное качество: по времени работы и по реальной частоте кадров */
      var work = performance.now() - t0;
      workEMA += (work - workEMA) * 0.08;
      dtEMA += (dt * 1000 - dtEMA) * 0.05;
      frames++;
      if (frames % 50 === 0 && !paused) {
        var q = eng.getQuality();
        if (workEMA > 15 || dtEMA > 26) {
          if (q > 0.01) {
            q = Math.max(0, q - (workEMA > 24 ? 0.25 : 0.12)); eng.setQuality(q);
          }
          var lv = q > 0.78 ? 0 : (q > 0.55 ? 1 : (q > 0.3 ? 2 : 3));
          if (lv !== resLevel) { resLevel = lv; needLayout = true; }
        } else if (workEMA < 9 && dtEMA < 19.5 && q < 1) {
          q = Math.min(1, q + 0.06); eng.setQuality(q);
          var lv2 = q > 0.78 ? 0 : (q > 0.55 ? 1 : (q > 0.3 ? 2 : 3));
          if (lv2 !== resLevel) { resLevel = lv2; needLayout = true; }
        }
      }
      statT += dt;
      if (statT > 0.5) {
        fpsShown = Math.round(1000 / Math.max(1, dtEMA)); statT = 0;
        sub.textContent = 'Curl-поле скоростей · ' + eng.active.toLocaleString('ru-RU') + ' частиц · ' + fpsShown + ' fps';
      }
    }

    layout();
    var rt = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { needLayout = true; needRedraw = true; }, 120);
    });
    document.addEventListener('visibilitychange', function () { last = performance.now(); });
    eng.start();
    requestAnimationFrame(function (t) { last = t; requestAnimationFrame(frame); });
  }

  /* ------------------------------------------------------------------ */

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createEngine: createEngine, PALETTES: PALETTES, fcos: fcos };
  }
  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('view')) {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
