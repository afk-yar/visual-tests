/* Воксельный ландшафт — Claude Sonnet 5.5
 *
 * Классический VoxelSpace (Comanche): карта высот + карта цвета, рендер по
 * вертикальным столбцам экрана «спереди назад» с буфером горизонта (ybuf).
 * Ядро (генерация карты, рендер, параметры неба) не зависит от DOM и
 * экспортируется в node для тестов; браузерная часть — ниже, в startApp().
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Константы и утилиты                                                */
  /* ------------------------------------------------------------------ */
  const MAP_BITS = 10;
  const N = 1 << MAP_BITS;           // сторона карты (тор: бесшовно по обеим осям)
  const MASK = N - 1;
  const SEA = 20;                    // уровень воды в мировых единицах
  const SUN_AZ = Math.PI / 4;        // азимут солнца в координатах карты (+x,+y)
  const SUN_EL_BAKE = 0.62;          // высота солнца для запечённого света (рад)
  const TAN_HALF = Math.tan(38 * Math.PI / 180); // половина горизонтального FOV
  const TAU = Math.PI * 2;

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function wrapPi(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SIN256 = new Float32Array(256);
  for (let i = 0; i < 256; i++) SIN256[i] = Math.pow(Math.max(0, Math.sin(i / 256 * TAU)), 20);

  /* ------------------------------------------------------------------ */
  /*  Процедурный рельеф                                                 */
  /* ------------------------------------------------------------------ */

  // Бесшовный шум Перлина: один октав, прибавляется в out.
  function addPerlin(out, cells, amp, rnd, ridged) {
    const g = new Float32Array(cells * cells * 2);
    for (let i = 0; i < cells * cells; i++) {
      const a = rnd() * TAU;
      g[2 * i] = Math.cos(a);
      g[2 * i + 1] = Math.sin(a);
    }
    const cm = cells - 1, step = cells / N;
    const xi0 = new Int32Array(N), xi1 = new Int32Array(N);
    const fxs = new Float32Array(N), uxs = new Float32Array(N);
    for (let x = 0; x < N; x++) {
      const u = x * step, i0 = Math.floor(u), f = u - i0;
      xi0[x] = i0 & cm; xi1[x] = (i0 + 1) & cm;
      fxs[x] = f; uxs[x] = f * f * f * (f * (f * 6 - 15) + 10);
    }
    const SC = amp * 1.4142;
    for (let y = 0; y < N; y++) {
      const v = y * step, j0 = Math.floor(v), fy = v - j0;
      const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      const r0 = (j0 & cm) * cells, r1 = ((j0 + 1) & cm) * cells;
      const fy1 = fy - 1, row = y << MAP_BITS;
      for (let x = 0; x < N; x++) {
        const f = fxs[x], f1 = f - 1;
        const a0 = (r0 + xi0[x]) * 2, a1 = (r0 + xi1[x]) * 2;
        const b0 = (r1 + xi0[x]) * 2, b1 = (r1 + xi1[x]) * 2;
        const n00 = g[a0] * f + g[a0 + 1] * fy;
        const n10 = g[a1] * f1 + g[a1 + 1] * fy;
        const n01 = g[b0] * f + g[b0 + 1] * fy1;
        const n11 = g[b1] * f1 + g[b1 + 1] * fy1;
        const ux = uxs[x];
        const p = n00 + (n10 - n00) * ux, q = n01 + (n11 - n01) * ux;
        let val = p + (q - p) * uy;
        if (ridged) {
          val = 1 - Math.abs(val * 1.4142);
          val *= val;
          out[row + x] += amp * val;
        } else {
          out[row + x] += val * SC;
        }
      }
    }
  }

  function fieldFbm(cellsList, ampList, rnd, ridged) {
    const out = new Float32Array(N * N);
    let nrm = 0;
    for (let k = 0; k < cellsList.length; k++) {
      addPerlin(out, cellsList[k], ampList[k], rnd, ridged);
      nrm += ampList[k];
    }
    return { data: out, norm: nrm };
  }

  function percentiles(arr, ps) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const B = 4096, hist = new Uint32Array(B), sc = (B - 1) / (mx - mn);
    for (let i = 0; i < arr.length; i++) hist[((arr[i] - mn) * sc) | 0]++;
    const res = [];
    let acc = 0, bin = 0;
    for (let k = 0; k < ps.length; k++) {
      const target = ps[k] * arr.length;
      while (bin < B && acc + hist[bin] < target) { acc += hist[bin]; bin++; }
      res.push(mn + bin / sc);
    }
    return { values: res, min: mn, max: mx };
  }

  /**
   * Генерация карт высот и цвета (1024x1024, бесшовные).
   * height — Float32 (мировые единицы), color — Uint32 ABGR,
   * альфа-байт цвета = «фаза блика» для воды (0 = суша).
   */
  function generateTerrain(seed) {
    const NN = N * N;
    const rnd = mulberry32(seed >>> 0);

    // 1. Сырое поле высот: fBm + гребни в горных областях + континентальный фон
    const A = fieldFbm([4, 8, 16, 32, 64, 128], [1, 0.52, 0.27, 0.14, 0.073, 0.038], rnd, false);
    const B = fieldFbm([4, 8, 16, 32], [1, 0.46, 0.2, 0.09], rnd, true);
    const Mk = fieldFbm([2, 4], [1, 0.6], rnd, false);
    const ia = 1 / A.norm, ib = 1 / B.norm, im = 1 / 1.6;
    const V = new Float32Array(NN);
    for (let i = 0; i < NN; i++) {
      const a = A.data[i] * ia * 0.5 + 0.5;
      const b = B.data[i] * ib;
      const mk = Mk.data[i] * im * 0.5 + 0.5;
      V[i] = 0.58 * a + 0.62 * b * smoothstep(0.42, 0.68, mk) + 0.20 * mk;
    }

    // 2. Влажность, мелкая фактура, шум крон деревьев
    const Mo = fieldFbm([4, 8, 16], [1, 0.6, 0.3], rnd, false);
    const Dt = fieldFbm([64, 128, 256], [1, 0.6, 0.4], rnd, false);
    const Tn = fieldFbm([128, 256], [1, 1], rnd, false);
    const imo = 1 / 1.9, idt = 1 / 2.0, itn = 1 / 2.0;

    // 3. Нормировка по перцентилям: уровень моря и высота пиков не зависят от seed
    const pc = percentiles(V, [0.27, 0.997]);
    const vSea = pc.values[0], vTop = pc.values[1], vMin = pc.min;
    const HL = 138;
    const hb = new Float32Array(NN);    // базовая высота (без крон)
    const tLand = new Float32Array(NN); // относительная высота суши 0..1.3
    for (let i = 0; i < NN; i++) {
      const v = V[i];
      if (v <= vSea) { hb[i] = SEA; tLand[i] = 0; continue; }
      const t = Math.min(1.3, (v - vSea) / (vTop - vSea));
      tLand[i] = t;
      hb[i] = SEA + HL * Math.pow(t, 1.38);
    }

    // 4. Леса: маска + крона (воксельные «деревья»)
    const Hf = new Float32Array(NN);
    const forest = new Uint8Array(NN);
    for (let y = 0; y < N; y++) {
      const ym = ((y - 1) & MASK) << MAP_BITS, yp = ((y + 1) & MASK) << MAP_BITS, row = y << MAP_BITS;
      for (let x = 0; x < N; x++) {
        const i = row | x;
        const t = tLand[i];
        if (t <= 0.01) { Hf[i] = hb[i]; continue; }
        const dx = (hb[row | ((x + 1) & MASK)] - hb[row | ((x - 1) & MASK)]) * 0.5;
        const dy = (hb[yp | x] - hb[ym | x]) * 0.5;
        const sl = Math.sqrt(dx * dx + dy * dy);
        const mo = Mo.data[i] * imo * 0.5 + 0.5;
        const fm = smoothstep(0.50, 0.60, mo) * smoothstep(0.02, 0.08, t) *
                   (1 - smoothstep(0.40, 0.60, t)) * (1 - smoothstep(0.55, 0.95, sl));
        forest[i] = (fm * 255) | 0;
        const tn = clamp((Tn.data[i] * itn * 0.5 + 0.5) * 1.5 - 0.25, 0, 1);
        Hf[i] = hb[i] + fm * (2.0 + 4.6 * tn);
      }
    }

    // 5. Тени от солнца: проход «плоскости тени» по диагонали (свет с +x,+y)
    const Sh = new Float32Array(Hf);
    const drop = Math.SQRT2 * Math.tan(SUN_EL_BAKE);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = N - 1; y >= 0; y--) {
        const rowN = ((y + 1) & MASK) << MAP_BITS, row = y << MAP_BITS;
        for (let x = N - 1; x >= 0; x--) {
          const i = row | x;
          const s = Sh[rowN | ((x + 1) & MASK)] - drop;
          Sh[i] = s > Hf[i] ? s : Hf[i];
        }
      }
    }

    // 6. Освещение, окклюзия и цвет
    const color = new Uint32Array(NN);
    const LX = Math.cos(SUN_EL_BAKE) * Math.cos(SUN_AZ);
    const LY = Math.cos(SUN_EL_BAKE) * Math.sin(SUN_AZ);
    const LZ = Math.sin(SUN_EL_BAKE);

    for (let y = 0; y < N; y++) {
      const row = y << MAP_BITS;
      const ym = ((y - 1) & MASK) << MAP_BITS, yp = ((y + 1) & MASK) << MAP_BITS;
      const y3m = ((y - 3) & MASK) << MAP_BITS, y3p = ((y + 3) & MASK) << MAP_BITS;
      for (let x = 0; x < N; x++) {
        const i = row | x;
        const xm = (x - 1) & MASK, xp = (x + 1) & MASK;
        const hC = Hf[i];

        // нормаль и свет
        const dx = (Hf[row | xp] - Hf[row | xm]) * 0.5;
        const dy = (Hf[yp | x] - Hf[ym | x]) * 0.5;
        const nl = 1 / Math.sqrt(dx * dx + dy * dy + 1);
        const diff = Math.max(0, (-dx * LX - dy * LY + LZ) * nl);
        const dep = Sh[i] - hC;
        const lit = 1 - smoothstep(0, 6.5, dep);
        const direct = diff * lit;
        const avg = (Hf[row | ((x + 3) & MASK)] + Hf[row | ((x - 3) & MASK)] + Hf[y3p | x] + Hf[y3m | x]) * 0.25;
        const ao = 1 + clamp((hC - avg) * 0.05, -0.30, 0.08);
        const amb = 0.62 + 0.38 * nl;
        const lr = (0.385 * amb + 0.86 * direct * 1.10) * ao;
        const lg = (0.425 * amb + 0.86 * direct * 1.00) * ao;
        const lb = (0.545 * amb + 0.86 * direct * 0.86) * ao;

        let r, g, b, alpha = 0;
        const t = tLand[i];
        const dn = Dt.data[i] * idt;           // -1..1
        if (t <= 0.0) {
          // вода: от бирюзовой мели к глубокой синеве
          const d = clamp((vSea - V[i]) / (vSea - vMin), 0, 1);
          const k = smoothstep(0.0, 0.50, d);
          r = lerp(96, 16, k); g = lerp(180, 66, k); b = lerp(186, 128, k);
          const sp = 1 + dn * 0.05;
          r *= sp; g *= sp; b *= sp;
          let hs = Math.imul(i ^ (i >>> 15), 0x2c1b3c6d); hs = Math.imul(hs ^ (hs >>> 12), 0x297a2d39); hs ^= hs >>> 15;
          alpha = 1 + ((hs >>> 0) % 255);
        } else {
          const sl = Math.sqrt(
            Math.pow((hb[row | xp] - hb[row | xm]) * 0.5, 2) +
            Math.pow((hb[yp | x] - hb[ym | x]) * 0.5, 2));
          const mo = Mo.data[i] * imo * 0.5 + 0.5;
          // трава: от сухой к насыщенной по влажности
          const gl = smoothstep(0.30, 0.58, mo);
          r = lerp(150, 70, gl); g = lerp(156, 128, gl); b = lerp(84, 50, gl);
          const sp = 1 + dn * 0.10;
          r *= sp; g *= sp; b *= sp;
          // лес
          const fw = forest[i] / 255;
          if (fw > 0) {
            const tv = 1 + (Tn.data[i] * itn) * 0.28;
            r = lerp(r, 30 * tv, fw); g = lerp(g, 72 * tv, fw); b = lerp(b, 38 * tv, fw);
          }
          // пляж
          const sandW = 1 - smoothstep(0.010, 0.050, t + dn * 0.012);
          r = lerp(r, 218, sandW); g = lerp(g, 200, sandW); b = lerp(b, 150, sandW);
          // альпийский пояс
          const alpW = smoothstep(0.34, 0.58, t + dn * 0.04);
          r = lerp(r, 116, alpW); g = lerp(g, 124, alpW); b = lerp(b, 82, alpW);
          // камень: крутые склоны и высота
          const strata = 1 + 0.07 * Math.sin(hC * 0.55 + dn * 2.0);
          const rockW = Math.max(smoothstep(0.62, 1.10, sl), smoothstep(0.66, 0.94, t + dn * 0.03) * 0.85);
          r = lerp(r, 128 * strata, rockW); g = lerp(g, 118 * strata, rockW); b = lerp(b, 108 * strata, rockW);
          // снег
          const snowW = smoothstep(0.80 + dn * 0.05, 0.94 + dn * 0.05, t) * (1 - smoothstep(0.95, 1.6, sl));
          r = lerp(r, 246, snowW); g = lerp(g, 249, snowW); b = lerp(b, 253, snowW);
        }

        r = r * lr; g = g * lg; b = b * lb;
        r = r > 255 ? 255 : r < 0 ? 0 : r;
        g = g > 255 ? 255 : g < 0 ? 0 : g;
        b = b > 255 ? 255 : b < 0 ? 0 : b;
        color[i] = ((alpha << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
      }
    }

    function groundAt(px, py) {
      px = ((px % N) + N) % N; py = ((py % N) + N) % N;
      const ix = px | 0, iy = py | 0, fx = px - ix, fy = py - iy;
      const x1 = (ix + 1) & MASK, y0 = iy << MAP_BITS, y1 = ((iy + 1) & MASK) << MAP_BITS;
      const h00 = Hf[y0 | ix], h10 = Hf[y0 | x1], h01 = Hf[y1 | ix], h11 = Hf[y1 | x1];
      const ha = h00 + (h10 - h00) * fx, hbb = h01 + (h11 - h01) * fx;
      return ha + (hbb - ha) * fy;
    }

    return { height: Hf, color: color, groundAt: groundAt, seaLevel: SEA, seed: seed };
  }

  /* ------------------------------------------------------------------ */
  /*  Небо: ключевые кадры суток                                         */
  /* ------------------------------------------------------------------ */
  // [час, zen(3), mid(3), hor(3), tint(3), cloudLit(3), cloudShade(3), stars, cloudAlpha]
  const KEYS = [
    [0.0,  5, 9, 26,    13, 24, 56,    30, 46, 88,     0.40, 0.48, 0.76,   62, 78, 124,    20, 28, 58,     1.00, 0.55],
    [4.6,  16, 24, 60,  46, 52, 98,    112, 92, 124,   0.50, 0.52, 0.72,   132, 112, 152,  50, 50, 92,     0.55, 0.70],
    [6.2,  58, 92, 160, 176, 130, 150, 252, 170, 118,  1.00, 0.76, 0.58,   255, 198, 152,  150, 100, 132,  0.00, 0.85],
    [8.2,  46, 108, 196, 118, 168, 226, 214, 224, 236, 1.00, 0.94, 0.84,   255, 250, 244,  172, 186, 210,  0.00, 0.90],
    [12.2, 28, 88, 188, 92, 152, 226,  186, 214, 238,  1.00, 1.00, 1.00,   255, 255, 255,  164, 186, 216,  0.00, 0.92],
    [15.8, 34, 92, 184, 112, 164, 224, 206, 222, 236,  1.00, 0.97, 0.90,   255, 252, 246,  168, 184, 212,  0.00, 0.92],
    [17.4, 46, 86, 170, 170, 152, 196, 250, 196, 140,  1.00, 0.88, 0.72,   255, 226, 190,  160, 140, 172,  0.00, 0.90],
    [18.3, 46, 64, 140, 190, 112, 128, 255, 140, 76,   1.00, 0.70, 0.48,   255, 170, 120,  122, 80, 122,   0.00, 0.90],
    [19.4, 20, 26, 72,  84, 60, 112,   186, 96, 104,   0.62, 0.50, 0.64,   152, 100, 132,  60, 48, 94,     0.35, 0.75],
    [21.0, 7, 11, 30,   15, 27, 60,    32, 48, 92,     0.40, 0.48, 0.76,   62, 78, 124,    20, 28, 58,     0.95, 0.58],
    [24.0, 5, 9, 26,    13, 24, 56,    30, 46, 88,     0.40, 0.48, 0.76,   62, 78, 124,    20, 28, 58,     1.00, 0.55]
  ];

  function skyState(hour) {
    hour = ((hour % 24) + 24) % 24;
    let k = 0;
    while (k < KEYS.length - 2 && hour >= KEYS[k + 1][0]) k++;
    const a = KEYS[k], b = KEYS[k + 1];
    const t = smoothstep(0, 1, (hour - a[0]) / (b[0] - a[0]));
    const m = new Array(21);
    for (let i = 1; i < 21; i++) m[i] = lerp(a[i], b[i], t);

    const sunEl = 0.92 * Math.sin(Math.PI * (hour - 6.1) / 12.2);
    const moonEl = -sunEl;
    const hi = smoothstep(0.05, 0.60, sunEl);
    const sunCol = [255, lerp(146, 247, hi), lerp(68, 222, hi)];
    const moonCol = [226, 233, 252];

    // яркость и ширина свечения вокруг солнца у горизонта
    const sunVis = smoothstep(-0.30, -0.03, sunEl);
    const sunK = (0.22 + 0.78 * (1 - smoothstep(0.0, 0.5, sunEl))) * sunVis;
    const sunSig = 0.32 + 0.36 * (1 - smoothstep(0, 0.7, Math.max(sunEl, 0)));
    const moonK = 0.42 * smoothstep(0.0, 0.25, moonEl);

    // блики на воде
    const gSun = smoothstep(-0.02, 0.25, sunEl) * (0.35 + 0.65 * (1 - smoothstep(0.2, 0.8, sunEl)));
    const gMoon = smoothstep(0.05, 0.4, moonEl) * 0.28;
    const useSun = gSun >= gMoon;
    const gc = useSun ? sunCol : moonCol;

    return {
      hour: hour,
      zen: [m[1], m[2], m[3]], mid: [m[4], m[5], m[6]], hor: [m[7], m[8], m[9]],
      tint: [m[10], m[11], m[12]],
      cloudLit: [m[13], m[14], m[15]], cloudShade: [m[16], m[17], m[18]],
      stars: m[19], cloudA: m[20],
      sunEl: sunEl, moonEl: moonEl, sunCol: sunCol, moonCol: moonCol,
      sunK: sunK, sunSig: sunSig, moonK: moonK,
      glint: Math.max(gSun, gMoon), glintCol: [gc[0] / 255, gc[1] / 255, gc[2] / 255]
    };
  }

  // Цвет тумана/горизонта в направлении азимута az (учитывает свечение солнца и луны).
  function fogAt(sky, az, out) {
    const ds = wrapPi(az - SUN_AZ);
    const dm = wrapPi(az - SUN_AZ - Math.PI);
    const es = Math.max(sky.sunEl, 0);
    const em = Math.max(sky.moonEl, 0);
    const gs = sky.sunK * Math.exp(-es * es / 0.35) * Math.exp(-ds * ds / (sky.sunSig * sky.sunSig));
    const gm = sky.moonK * Math.exp(-em * em / 0.35) * Math.exp(-dm * dm / 0.25);
    let r = sky.hor[0] + sky.sunCol[0] * gs * 0.50 + sky.moonCol[0] * gm * 0.22;
    let g = sky.hor[1] + sky.sunCol[1] * gs * 0.50 + sky.moonCol[1] * gm * 0.22;
    let b = sky.hor[2] + sky.sunCol[2] * gs * 0.50 + sky.moonCol[2] * gm * 0.22;
    out[0] = r > 255 ? 255 : r;
    out[1] = g > 255 ? 255 : g;
    out[2] = b > 255 ? 255 : b;
  }

  /* ------------------------------------------------------------------ */
  /*  Рендер VoxelSpace                                                  */
  /* ------------------------------------------------------------------ */

  // Буфер транспонирован: пиксель (столбец i, строка y) лежит в buf[i*H + y],
  // поэтому заливка вертикального отрезка идёт по непрерывной памяти.
  function createTarget(W, H, buf) {
    return {
      W: W, H: H,
      buf: buf || new Uint32Array(W * H),
      ybuf: new Int32Array(W),
      shear: new Float32Array(W),
      fogR: new Int32Array(W), fogG: new Int32Array(W), fogB: new Int32Array(W),
      glow: new Float32Array(W)
    };
  }

  const _tmp = [0, 0, 0];
  function fillFogColumns(T, phi, sky) {
    const f = T.W * 0.5 / TAN_HALF;
    for (let i = 0; i < T.W; i++) {
      const th = Math.atan((i + 0.5 - T.W * 0.5) / f);
      fogAt(sky, phi + th, _tmp);
      T.fogR[i] = _tmp[0] | 0; T.fogG[i] = _tmp[1] | 0; T.fogB[i] = _tmp[2] | 0;
      const ds = wrapPi(phi + th - SUN_AZ);
      T.glow[i] = 0.35 + 0.65 * Math.exp(-ds * ds / 0.45);
    }
  }

  /**
   * cam: {x, y, z, phi, horizon (px буфера), slope (крен: сдвиг горизонта на столбец), dist, ground}
   * par: {tint[3], glint, glintCol[3], time}
   */
  function renderTerrain(T, terr, cam, par) {
    const W = T.W, H = T.H, buf = T.buf, ybuf = T.ybuf, shear = T.shear;
    const fogR = T.fogR, fogG = T.fogG, fogB = T.fogB;
    const hmap = terr.height, cmap = terr.color;
    buf.fill(0);
    ybuf.fill(H);

    const f = W * 0.5 / TAN_HALF;               // фокусное расстояние в пикселях буфера
    const cs = Math.cos(cam.phi), sn = Math.sin(cam.phi);
    const Fx = cs, Fy = sn, Rx = -sn, Ry = cs;  // вперёд и вправо
    const OFF = 8192;                           // чтобы координаты были положительными
    const px0 = cam.x + OFF, py0 = cam.y + OFF;
    const camZ = cam.z, dist = cam.dist, horizon = cam.horizon, half = W * 0.5;
    for (let i = 0; i < W; i++) shear[i] = (i + 0.5 - half) * cam.slope;

    // Масштабируем зоны билинейной выборки под ширину буфера
    const wk = W / 640;
    const ZC = 120 * wk, ZH = 185 * wk, ZG = 620;
    const kStep = clamp(0.0078 / wk, 0.0045, 0.0125);

    const Hb = Math.max(24, H - horizon + Math.abs(cam.slope) * half);
    let z = Math.max(1, 0.35 * Math.max(4, camZ - cam.ground) * f / Hb);

    const tr = par.tint[0] * 256, tg = par.tint[1] * 256, tb = par.tint[2] * 256;
    const tOff = (par.time * 70) | 0;
    const gc0 = par.glintCol[0], gc1 = par.glintCol[1], gc2 = par.glintCol[2];
    let open = W;

    while (z < dist && open > 0) {
      const tt = z / dist;
      let fg = (1 - Math.exp(-3.0 * Math.pow(tt, 1.5))) / 0.95;
      if (fg > 1) fg = 1;
      const F256 = (fg * 256) | 0;
      const keep = 1 - fg;
      const ar = (tr * keep) | 0, ag = (tg * keep) | 0, ab = (tb * keep) | 0;
      const invz = f / z;
      const span = z * TAN_HALF;
      const sxs = Rx * 2 * span / W, sys = Ry * 2 * span / W;
      let sx = px0 + Fx * z - Rx * span + sxs * 0.5;
      let sy = py0 + Fy * z - Ry * span + sys * 0.5;
      const bilH = z < ZH, bilC = z < ZC;
      const gs = z < ZG ? par.glint * keep * keep * 115 : 0;

      for (let i = 0; i < W; i++, sx += sxs, sy += sys) {
        const yb = ybuf[i];
        if (yb <= 0) continue;
        const ix = sx | 0, iy = sy | 0;
        const xa = ix & MASK, ya = (iy & MASK) << MAP_BITS;
        const i00 = ya | xa;
        let h, fx = 0, fy = 0, i10 = 0, i01 = 0, i11 = 0;
        if (bilH) {
          fx = sx - ix; fy = sy - iy;
          const xb = (ix + 1) & MASK, yc = ((iy + 1) & MASK) << MAP_BITS;
          i10 = ya | xb; i01 = yc | xa; i11 = yc | xb;
          const h00 = hmap[i00], h01 = hmap[i01];
          const ha = h00 + (hmap[i10] - h00) * fx;
          const hbb = h01 + (hmap[i11] - h01) * fx;
          h = ha + (hbb - ha) * fy;
        } else {
          h = hmap[i00];
        }
        const top = ((camZ - h) * invz + horizon + shear[i]) | 0;
        if (top >= yb) continue;

        let r, g, b;
        const c0 = cmap[i00];
        if (bilC) {
          const c1 = cmap[i10], c2 = cmap[i01], c3 = cmap[i11];
          const w11 = (fx * fy * 256) | 0, w10 = (fx * (1 - fy) * 256) | 0, w01 = ((1 - fx) * fy * 256) | 0;
          const w00 = 256 - w10 - w01 - w11;
          r = ((c0 & 255) * w00 + (c1 & 255) * w10 + (c2 & 255) * w01 + (c3 & 255) * w11) >> 8;
          g = (((c0 >>> 8) & 255) * w00 + ((c1 >>> 8) & 255) * w10 + ((c2 >>> 8) & 255) * w01 + ((c3 >>> 8) & 255) * w11) >> 8;
          b = (((c0 >>> 16) & 255) * w00 + ((c1 >>> 16) & 255) * w10 + ((c2 >>> 16) & 255) * w01 + ((c3 >>> 16) & 255) * w11) >> 8;
        } else {
          r = c0 & 255; g = (c0 >>> 8) & 255; b = (c0 >>> 16) & 255;
        }
        // освещение суток + туман (цвет тумана зависит от азимута столбца)
        r = (r * ar + fogR[i] * F256) >> 8;
        g = (g * ag + fogG[i] * F256) >> 8;
        b = (b * ab + fogB[i] * F256) >> 8;

        // блики на воде
        const ph = c0 >>> 24;
        if (ph !== 0 && gs > 0) {
          const sv = SIN256[(ph + tOff) & 255];
          if (sv > 0.02) {
            const q = sv * gs * T.glow[i];
            r += q * gc0; g += q * gc1; b += q * gc2;
            if (r > 255) r = 255;
            if (g > 255) g = 255;
            if (b > 255) b = 255;
          }
        }

        const col = 0xFF000000 | (b << 16) | (g << 8) | r;
        const y0 = top < 0 ? 0 : top;
        const base = i * H;
        if (yb - y0 > 14) buf.fill(col, base + y0, base + yb);
        else for (let y = y0; y < yb; y++) buf[base + y] = col;
        ybuf[i] = y0;
        if (y0 === 0) open--;
      }
      z += 0.30 + z * kStep;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Экспорт для node                                                   */
  /* ------------------------------------------------------------------ */
  const API = {
    MAP: N, SEA: SEA, SUN_AZ: SUN_AZ, TAN_HALF: TAN_HALF,
    generateTerrain: generateTerrain, createTarget: createTarget,
    renderTerrain: renderTerrain, fillFogColumns: fillFogColumns,
    skyState: skyState, fogAt: fogAt, wrapPi: wrapPi, mulberry32: mulberry32
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  /* ------------------------------------------------------------------ */
  /*  Браузерная часть                                                   */
  /* ------------------------------------------------------------------ */
  if (typeof document === 'undefined') return;

  function startApp() {
    const doc = document;
    const $ = function (id) { return doc.getElementById(id); };
    const canvas = $('view');
    const ctx = canvas.getContext('2d', { alpha: false });
    const bufCanvas = doc.createElement('canvas');
    const bctx = bufCanvas.getContext('2d');

    const HW = 96, HH = 48;                      // полоса дымки у горизонта
    const hzCanvas = doc.createElement('canvas');
    hzCanvas.width = HW; hzCanvas.height = HH + 1;
    const hctx = hzCanvas.getContext('2d');
    const hzImg = hctx.createImageData(HW, HH + 1);

    const LEVELS = [320, 448, 576, 704, 832, 960, 1152];
    const AUTO_MIN = 2, AUTO_MAX = 6;
    const QUALITY_CYCLE = ['auto', 1, 3, 6];
    const QUALITY_NAME = { auto: 'авто', 1: 'низкое', 3: 'среднее', 6: 'высокое' };

    const S = {
      alt: 52, dist: 950, hor: 0.45, speed: 1,
      hour: 17.5, timeFlow: false, paused: false,
      q: 'auto', seed: 90417
    };
    let autoIdx = 4;
    let terrain = null;
    let dpr = 1, CW = 2, CH = 2, Wb = 2, Hb = 2, sxk = 1, syk = 1;
    let img = null, target = null;
    let dirty = true, simTime = 0, loading = true;

    // камера
    const cam = { x: 100, y: 450, phi: 0.8, z: 90, vz: 0, s: 0, bank: 0, pitch: 0, ground: 30, steer: 0 };
    const PH = [0.7, 2.9, 5.1];
    function curvature(s) {
      return 0.00035 + 0.0030 * Math.sin(0.0031 * s + PH[0]) +
             0.0022 * Math.sin(0.0072 * s + PH[1]) +
             0.0012 * Math.sin(0.0151 * s + PH[2]);
    }

    /* ---------- облака и звёзды ---------- */
    const SPR_W = 240, SPR_H = 104, SPR_N = 5;
    const sprites = [];
    for (let i = 0; i < SPR_N; i++) {
      const c = doc.createElement('canvas'); c.width = SPR_W; c.height = SPR_H; sprites.push(c);
    }
    let spriteHour = -99;

    function rgb(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }
    function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(3) + ')'; }
    function mix(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

    function makeSprites(sky) {
      for (let n = 0; n < SPR_N; n++) {
        const g = sprites[n].getContext('2d');
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, SPR_W, SPR_H);
        const rnd = mulberry32(777 + n * 131);
        const puffs = [];
        const cnt = 12 + ((rnd() * 5) | 0);
        for (let i = 0; i < cnt; i++) {
          const u = (i + rnd() * 0.8) / cnt;
          const px = 26 + u * (SPR_W - 52);
          const bump = Math.sin(Math.PI * u);
          const r = 13 + bump * 20 * (0.55 + rnd() * 0.7);
          const py = SPR_H - 22 - r * (0.35 + rnd() * 0.5) - bump * 8 * rnd();
          puffs.push({ x: px, y: py, r: r });
        }
        // тень (снизу) и свет (сверху)
        for (let i = 0; i < puffs.length; i++) {
          const p = puffs[i];
          const cy = p.y + p.r * 0.28;
          const gr = g.createRadialGradient(p.x, cy, 0, p.x, cy, p.r);
          gr.addColorStop(0, rgba(sky.cloudShade, 0.60));
          gr.addColorStop(0.6, rgba(sky.cloudShade, 0.30));
          gr.addColorStop(1, rgba(sky.cloudShade, 0));
          g.fillStyle = gr;
          g.beginPath(); g.arc(p.x, cy, p.r, 0, TAU); g.fill();
        }
        for (let i = 0; i < puffs.length; i++) {
          const p = puffs[i];
          const cx = p.x - p.r * 0.08, cy = p.y - p.r * 0.30;
          const gr = g.createRadialGradient(cx, cy, 0, cx, cy, p.r * 0.95);
          gr.addColorStop(0, rgba(sky.cloudLit, 0.96));
          gr.addColorStop(0.55, rgba(sky.cloudLit, 0.72));
          gr.addColorStop(1, rgba(sky.cloudLit, 0));
          g.fillStyle = gr;
          g.beginPath(); g.arc(cx, cy, p.r * 0.95, 0, TAU); g.fill();
        }
        // плоское основание
        g.globalCompositeOperation = 'destination-out';
        const fb = g.createLinearGradient(0, SPR_H - 40, 0, SPR_H - 12);
        fb.addColorStop(0, 'rgba(0,0,0,0)');
        fb.addColorStop(1, 'rgba(0,0,0,1)');
        g.fillStyle = fb;
        g.fillRect(0, SPR_H - 40, SPR_W, 40);
        g.globalCompositeOperation = 'source-over';
      }
      spriteHour = sky.hour;
    }

    const clouds = [];
    {
      const rnd = mulberry32(4242);
      for (let i = 0; i < 40; i++) {
        const el = 0.035 + 0.62 * Math.pow(rnd(), 1.5);
        clouds.push({
          az: rnd() * TAU, el: el, sp: (rnd() * SPR_N) | 0,
          size: 300 + rnd() * 480, drift: 0.0016 + rnd() * 0.0034
        });
      }
    }
    const stars = [];
    {
      const rnd = mulberry32(31337);
      for (let i = 0; i < 320; i++) {
        stars.push({ az: rnd() * TAU, el: Math.asin(rnd() * 0.97), m: 0.15 + 0.85 * Math.pow(rnd(), 2.5), ph: rnd() * TAU });
      }
    }

    /* ---------- размеры и буферы ---------- */
    function currentLevel() { return S.q === 'auto' ? autoIdx : S.q; }

    function setTarget() {
      Wb = Math.max(160, Math.min(LEVELS[currentLevel()], CW));
      Hb = Math.max(90, Math.round(Wb * CH / CW));
      bufCanvas.width = Hb; bufCanvas.height = Wb;     // транспонированный буфер
      img = bctx.createImageData(Hb, Wb);
      target = createTarget(Wb, Hb, new Uint32Array(img.data.buffer));
      sxk = CW / Wb; syk = CH / Hb;
      dirty = true;
    }

    function resize() {
      dpr = Math.min(root.devicePixelRatio || 1, 2);
      CW = Math.max(2, Math.round(root.innerWidth * dpr));
      CH = Math.max(2, Math.round(root.innerHeight * dpr));
      canvas.width = CW; canvas.height = CH;
      setTarget();
    }

    /* ---------- обновление камеры ---------- */
    function update(dt) {
      simTime += dt;
      if (S.timeFlow) {
        S.hour = (S.hour + dt * 24 / 160) % 24;
        syncTimeUI();
      }
      const v = 46 * S.speed;
      const ds = v * dt;
      cam.s += ds;
      // обход гор: отворачиваем в сторону, где по курсу меньше рельефа выше полёта
      const zRef = 100;
      let oc = 0, ol = 0, orr = 0;
      for (let q = 0.4; q <= 1.0001; q += 0.3) {
        const dd = 240 * q;
        oc = Math.max(oc, terrain.groundAt(cam.x + Math.cos(cam.phi) * dd, cam.y + Math.sin(cam.phi) * dd) - zRef);
        ol = Math.max(ol, terrain.groundAt(cam.x + Math.cos(cam.phi - 0.5) * dd, cam.y + Math.sin(cam.phi - 0.5) * dd) - zRef);
        orr = Math.max(orr, terrain.groundAt(cam.x + Math.cos(cam.phi + 0.5) * dd, cam.y + Math.sin(cam.phi + 0.5) * dd) - zRef);
      }
      oc = clamp(oc, 0, 110); ol = clamp(ol, 0, 110); orr = clamp(orr, 0, 110);
      const kb = curvature(cam.s);
      let ks = (ol - orr) * 0.00007;
      if (oc > 30 && Math.abs(ol - orr) < 25) ks += (kb >= 0 ? 1 : -1) * oc * 0.00004;
      cam.steer += (ks - cam.steer) * (1 - Math.exp(-ds / 60));
      const k = clamp(kb + cam.steer, -0.012, 0.012);
      cam.phi += k * ds;
      cam.x = (((cam.x + Math.cos(cam.phi) * ds) % N) + N) % N;
      cam.y = (((cam.y + Math.sin(cam.phi) * ds) % N) + N) % N;

      // высота: огибаем рельеф с упреждением, подъём и спуск ограничены по скорости
      const fx = Math.cos(cam.phi), fy = Math.sin(cam.phi);
      const la = Math.max(1, S.speed * 0.9);
      const g0 = terrain.groundAt(cam.x, cam.y);
      let maxG = g0;
      const ds4 = [14, 32, 56, 86, 124, 170, 230];
      for (let i = 0; i < ds4.length; i++) {
        const d = ds4[i] * la;
        const gg = terrain.groundAt(cam.x + fx * d, cam.y + fy * d) - d * 0.10;
        if (gg > maxG) maxG = gg;
      }
      const floorZ = Math.max(g0, terrain.groundAt(cam.x + fx * 8, cam.y + fy * 8)) + 5;
      const tgtZ = maxG + S.alt;
      const spd = Math.max(0.7, S.speed);
      const desired = clamp((tgtZ - cam.z) * 0.9, -24 * spd, 32 * spd);
      cam.vz += (desired - cam.vz) * (1 - Math.exp(-dt * 2.4));
      cam.z += cam.vz * dt;
      if (cam.z < floorZ) { cam.z = floorZ; if (cam.vz < 0) cam.vz = 0; }
      cam.ground = g0;

      // крен по повороту и тангаж по набору высоты
      const omega = k * v;
      const tb = clamp(omega * 0.5, -0.17, 0.17);
      cam.bank += (tb - cam.bank) * (1 - Math.exp(-dt * 2.5));
      const tp = clamp(cam.vz * 0.0011, -0.04, 0.04) + 0.010 * Math.sin(simTime * 0.41);
      cam.pitch += (tp - cam.pitch) * (1 - Math.exp(-dt * 2.0));
    }

    /* ---------- небо (Canvas 2D, полное разрешение) ---------- */
    function drawBody(fd, el, az, rad, col, glowA, glowR, moon) {
      const th = wrapPi(az - cam.phi);
      if (Math.abs(th) > 1.35) return;
      const ct = Math.cos(th);
      const x = fd * Math.tan(th);
      const y = -fd * Math.tan(el) / ct;
      if (glowA > 0.004) {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, glowR);
        gr.addColorStop(0, rgba(col, glowA));
        gr.addColorStop(0.16, rgba(col, glowA * 0.46));
        gr.addColorStop(0.5, rgba(col, glowA * 0.12));
        gr.addColorStop(1, rgba(col, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = gr;
        ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (el < -0.08) return;
      const gd = ctx.createRadialGradient(x, y, 0, x, y, rad * 1.08);
      if (moon) {
        gd.addColorStop(0, rgba([240, 244, 255], 1));
        gd.addColorStop(0.92, rgba(col, 1));
        gd.addColorStop(1, rgba(col, 0));
      } else {
        gd.addColorStop(0, rgba(mix(col, [255, 255, 255], 0.75), 1));
        gd.addColorStop(0.72, rgba(col, 1));
        gd.addColorStop(0.94, rgba(col, 0.96));
        gd.addColorStop(1, rgba(col, 0));
      }
      ctx.fillStyle = gd;
      ctx.beginPath(); ctx.arc(x, y, rad * 1.08, 0, TAU); ctx.fill();
      if (moon) {
        ctx.fillStyle = 'rgba(120,134,170,0.16)';
        const cr = [[-0.30, -0.18, 0.26], [0.22, 0.10, 0.20], [-0.05, 0.38, 0.16], [0.34, -0.34, 0.12]];
        for (let i = 0; i < cr.length; i++) {
          ctx.beginPath(); ctx.arc(x + cr[i][0] * rad, y + cr[i][1] * rad, cr[i][2] * rad, 0, TAU); ctx.fill();
        }
      }
    }

    function buildHaze(w, fd, sky) {
      const d = hzImg.data;
      for (let j = 0; j < HW; j++) {
        const xx = (-1 + 2 * (j + 0.5) / HW) * w;
        const th = Math.atan(xx / fd);
        fogAt(sky, cam.phi + th, _tmp);
        for (let r = 0; r <= HH; r++) {
          const o = (r * HW + j) * 4;
          let a;
          if (r === HH) a = 255;
          else { const u = r / (HH - 1); a = Math.pow(u, 1.7) * 255; }
          d[o] = _tmp[0]; d[o + 1] = _tmp[1]; d[o + 2] = _tmp[2]; d[o + 3] = a;
        }
      }
      hctx.putImageData(hzImg, 0, 0);
    }

    function drawSky(sky, hy, roll) {
      const w = CW, h = CH;
      const fd = (w * 0.5) / TAN_HALF;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      ctx.translate(w * 0.5, hy);
      ctx.rotate(roll);

      const L = h * 0.72;
      const g = ctx.createLinearGradient(0, -L, 0, 0);
      g.addColorStop(0, rgb(sky.zen));
      g.addColorStop(0.5, rgb(sky.mid));
      g.addColorStop(0.84, rgb(mix(sky.mid, sky.hor, 0.62)));
      g.addColorStop(1, rgb(sky.hor));
      ctx.fillStyle = g;
      ctx.fillRect(-w * 1.5, -h * 3, w * 3, h * 3);
      ctx.fillStyle = rgb(sky.hor);
      ctx.fillRect(-w * 1.5, 0, w * 3, h * 3);

      // всё, что выше линии горизонта
      ctx.save();
      ctx.beginPath(); ctx.rect(-w * 1.5, -h * 3, w * 3, h * 3); ctx.clip();

      if (sky.stars > 0.02) {
        const px = Math.max(1, Math.round(dpr));
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          const th = wrapPi(s.az - cam.phi);
          if (Math.abs(th) > 1.3) continue;
          const y = -fd * Math.tan(s.el) / Math.cos(th);
          if (y < -h * 1.6) continue;
          const x = fd * Math.tan(th);
          const a = sky.stars * s.m * (0.78 + 0.22 * Math.sin(simTime * 2.6 + s.ph)) * smoothstep(0.02, 0.16, s.el);
          if (a < 0.03) continue;
          ctx.fillStyle = 'rgba(235,242,255,' + a.toFixed(3) + ')';
          const sz = s.m > 0.7 ? px * 2 : px;
          ctx.fillRect(x, y, sz, sz);
        }
      }

      // солнце
      const sunBig = 1 + 0.28 * (1 - smoothstep(0, 0.4, Math.max(sky.sunEl, 0)));
      drawBody(fd, sky.sunEl, SUN_AZ, fd * 0.036 * sunBig, sky.sunCol,
        (0.30 + 0.55 * (1 - smoothstep(0, 0.6, Math.max(sky.sunEl, 0)))) * smoothstep(-0.30, -0.03, sky.sunEl),
        fd * (0.5 + 0.55 * sky.sunSig), false);
      // луна
      drawBody(fd, sky.moonEl, SUN_AZ + Math.PI, fd * 0.030, sky.moonCol,
        0.30 * smoothstep(0.0, 0.25, sky.moonEl), fd * 0.42, true);

      // облака
      const ca = sky.cloudA;
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        const th = wrapPi(c.az + simTime * c.drift - cam.phi);
        if (Math.abs(th) > 1.25) continue;
        const ct = Math.cos(th);
        const x = fd * Math.tan(th);
        const y = -fd * Math.tan(c.el) / ct;
        const sw = c.size * (fd / 1000) * (0.5 + 1.25 * c.el);
        const sq = 0.50 + 0.50 * Math.min(1, c.el / 0.45);
        const sh = sw * (SPR_H / SPR_W) * sq;
        if (x + sw < -w * 1.1 || x - sw > w * 1.1 || y + sh < -h * 1.6) continue;
        const a = ca * smoothstep(0.015, 0.12, c.el);
        if (a < 0.02) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(sprites[c.sp], x - sw * 0.5, y - sh * 0.6, sw, sh);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // полоса дымки: плавно вводит цвет тумана (с отсветом солнца) в небо у горизонта
      buildHaze(w, fd, sky);
      ctx.imageSmoothingEnabled = true;
      const hb = h * 0.27;
      ctx.drawImage(hzCanvas, 0, 0, HW, HH, -w, -hb, w * 2, hb);
      ctx.drawImage(hzCanvas, 0, HH, HW, 1, -w, 0, w * 2, h * 2);
      ctx.restore();
    }

    /* ---------- кадр ---------- */
    let lastSky = null;
    function render() {
      const sky = skyState(S.hour);
      lastSky = sky;
      if (Math.abs(sky.hour - spriteHour) > 0.05 || spriteHour < -50) makeSprites(sky);

      const horFrac = clamp(S.hor + cam.pitch, 0.12, 0.88);
      const horPx = horFrac * Hb;
      const slope = -Math.tan(cam.bank);

      fillFogColumns(target, cam.phi, sky);
      renderTerrain(target, terrain, {
        x: cam.x, y: cam.y, z: cam.z, phi: cam.phi,
        horizon: horPx, slope: slope, dist: S.dist, ground: cam.ground
      }, { tint: sky.tint, glint: sky.glint, glintCol: sky.glintCol, time: simTime });
      bctx.putImageData(img, 0, 0);

      drawSky(sky, horPx * syk, Math.atan(slope));

      ctx.setTransform(0, syk, sxk, 0, 0, 0);       // транспонирующий вывод буфера
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(bufCanvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* ---------- интерфейс ---------- */
    const el = {
      alt: $('alt'), dist: $('dist'), hor: $('hor'), speed: $('speed'), hour: $('hour'),
      oAlt: $('o-alt'), oDist: $('o-dist'), oHor: $('o-hor'), oSpeed: $('o-speed'), oHour: $('o-hour'),
      bPause: $('btn-pause'), bTime: $('btn-time'), bNew: $('btn-new'), bQ: $('btn-q'),
      stat: $('stat'), loading: $('loading')
    };
    function fmtHour(h) {
      const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60);
      return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    }
    function syncTimeUI() {
      el.oHour.textContent = fmtHour(S.hour);
      if (Math.abs(parseFloat(el.hour.value) - S.hour) > 0.02) el.hour.value = S.hour.toFixed(2);
    }
    function syncUI() {
      el.oAlt.textContent = Math.round(S.alt) + ' м';
      el.oDist.textContent = Math.round(S.dist) + ' м';
      el.oHor.textContent = Math.round(S.hor * 100) + '%';
      el.oSpeed.textContent = '×' + S.speed.toFixed(1);
      syncTimeUI();
      el.bPause.textContent = S.paused ? 'Продолжить' : 'Пауза';
      el.bPause.classList.toggle('on', S.paused);
      el.bTime.classList.toggle('on', S.timeFlow);
      el.bQ.textContent = 'Качество: ' + QUALITY_NAME[S.q];
    }
    function bindRange(input, key, scale) {
      input.addEventListener('input', function () {
        S[key] = parseFloat(input.value) * (scale || 1);
        syncUI(); dirty = true;
      });
    }
    el.alt.value = S.alt; el.dist.value = S.dist; el.hor.value = Math.round(S.hor * 100);
    el.speed.value = S.speed; el.hour.value = S.hour;
    bindRange(el.alt, 'alt'); bindRange(el.dist, 'dist'); bindRange(el.hor, 'hor', 0.01);
    bindRange(el.speed, 'speed'); bindRange(el.hour, 'hour');
    el.hour.addEventListener('input', function () { S.timeFlow = false; syncUI(); });

    function togglePause() { S.paused = !S.paused; syncUI(); dirty = true; }
    el.bPause.addEventListener('click', togglePause);
    el.bTime.addEventListener('click', function () { S.timeFlow = !S.timeFlow; syncUI(); dirty = true; });
    el.bQ.addEventListener('click', function () {
      const k = QUALITY_CYCLE.indexOf(S.q);
      S.q = QUALITY_CYCLE[(k + 1) % QUALITY_CYCLE.length];
      setTarget(); syncUI();
    });
    el.bNew.addEventListener('click', function () {
      S.seed = (Math.random() * 1e9) | 0;
      rebuild();
    });
    doc.addEventListener('keydown', function (e) {
      if (e.code === 'Space' && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); togglePause(); }
    });
    root.addEventListener('resize', resize);

    function rebuild() {
      loading = true;
      el.loading.classList.add('show');
      root.setTimeout(function () {
        terrain = generateTerrain(S.seed);
        cam.z = terrain.groundAt(cam.x, cam.y) + S.alt; cam.vz = 0;
        loading = false; dirty = true;
        el.loading.classList.remove('show');
      }, 40);
    }

    /* ---------- главный цикл ---------- */
    let last = 0, accT = 0, accN = 0, fpsT = 0, fpsN = 0, goodStreak = 0, lastDown = -1e9, warmUntil = 0;
    function frame(now) {
      root.requestAnimationFrame(frame);
      if (!last) { last = now; warmUntil = now + 2500; }
      const raw = now - last; last = now;
      if (loading || !terrain) return;
      const dt = Math.min(0.05, raw / 1000);
      const running = !S.paused;
      if (running) update(dt);
      if (!running && !dirty) return;
      dirty = false;
      render();

      if (running && raw < 250) {
        accT += raw; accN++; fpsT += raw; fpsN++;
        if (accN >= 40) {
          const avg = accT / accN; accT = 0; accN = 0;
          if (S.q === 'auto' && now > warmUntil) {
            if (avg > 27 && autoIdx > AUTO_MIN) { autoIdx--; setTarget(); lastDown = now; goodStreak = 0; }
            else if (avg < 18.5) {
              goodStreak++;
              if (goodStreak >= 4 && autoIdx < AUTO_MAX && now - lastDown > 15000) { autoIdx++; setTarget(); goodStreak = 0; }
            } else goodStreak = 0;
          }
        }
        if (fpsT >= 500) {
          el.stat.textContent = Math.round(1000 * fpsN / fpsT) + ' к/с · ' + Wb + '×' + Hb;
          fpsT = 0; fpsN = 0;
        }
      }
    }

    resize();
    syncUI();
    rebuild();
    root.requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp);
  else startApp();
})(typeof window !== 'undefined' ? window : globalThis);
