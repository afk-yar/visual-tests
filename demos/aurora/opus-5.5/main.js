/* Полярное сияние — Claude Opus 5.5
 * Canvas 2D, без библиотек и без WebGL.
 *
 * Занавеси сияния моделируются как изогнутые вертикальные полотна в 3D:
 * линия полотна на плоскости (X — восток, Z — к северу, км) колышется
 * бегущими волнами и закручивается в складки, нижняя кромка ~100 км,
 * верх — до 300–400 км, с поправкой на кривизну Земли. Камера смотрит
 * на север; каждое полотно рисуется тысячами аддитивных вертикальных
 * штрихов-лучей в буфер пониженного разрешения. Там, где полотно
 * разворачивается к зрителю ребром, штрихи накладываются — складки
 * вспыхивают ярче, как в настоящем сиянии. Дальше: свечение (bloom),
 * звёзды, горы, подсветка снега светом сияния, озеро с отражением. */
(function () {
  'use strict';

  /* ───────────────────────── математика ───────────────────────── */
  var DEG = Math.PI / 180;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smoothstep(a, b, x) { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
  function bump(u, c, w) { var d = (u - c) / w; return Math.exp(-d * d); }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 2D simplex-шум (Густавсон), детерминированная перестановка
  var PERM = new Uint8Array(512);
  (function () {
    var r = mulberry32(1337), p = new Uint8Array(256), i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { var j = (r() * (i + 1)) | 0, t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) PERM[i] = p[i & 255];
  })();
  var GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
  var F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;

  function noise(xin, yin) {
    var s = (xin + yin) * F2;
    var i = Math.floor(xin + s), j = Math.floor(yin + s);
    var t = (i + j) * G2;
    var x0 = xin - i + t, y0 = yin - j + t;
    var i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    var x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    var x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    var ii = i & 255, jj = j & 255, n = 0, g;
    var t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { g = PERM[ii + PERM[jj]] & 7; t0 *= t0; n += t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
    var t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { g = PERM[ii + i1 + PERM[jj + j1]] & 7; t1 *= t1; n += t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
    var t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { g = PERM[ii + 1 + PERM[jj + 1]] & 7; t2 *= t2; n += t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
    return 70 * n;
  }

  function fbm(x, y, oct) {
    var s = 0, a = 0.5, f = 1, n = 0;
    for (var o = 0; o < oct; o++) { s += a * noise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  // Маленький промежуточный буфер: холст дополняется до ≥132×132, рабочая
  // область — левый верхний угол w×h. Очень маленькие холсты браузер может
  // держать вне GPU, и тогда каждое копирование в них тянет данные из видеопамяти.
  function makeBuf(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    var c = makeCanvas(Math.max(w, 132), Math.max(h, 132));
    return { c: c, g: c.getContext('2d'), w: w, h: h };
  }

  function lerpStops(stops, t) {
    if (t <= stops[0][0]) return stops[0][1];
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], k = (t - a[0]) / (b[0] - a[0]);
        return [a[1][0] + (b[1][0] - a[1][0]) * k, a[1][1] + (b[1][1] - a[1][1]) * k, a[1][2] + (b[1][2] - a[1][2]) * k];
      }
    }
    return stops[stops.length - 1][1];
  }

  /* ───────────────────────── DOM ───────────────────────── */
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d', { alpha: false });
  var HAS_FILTER = typeof ctx.filter === 'string';

  /* ───────────── спрайты лучей (непрозрачные: цвет × яркость) ─────────────
   * Рисуются в режиме 'lighter', поэтому чёрное ничего не добавляет. */
  var SPR_H = 256;
  var G_EDGE = 241 / 256;               // доля спрайта G выше нижней кромки

  function buildSprite(fn) {
    var c = makeCanvas(2, SPR_H), g = c.getContext('2d');
    var img = g.createImageData(2, SPR_H), d = img.data;
    for (var y = 0; y < SPR_H; y++) {
      var v = fn((y + 0.5) / SPR_H);
      for (var x = 0; x < 2; x++) {
        var o = (y * 2 + x) * 4;
        d[o] = clamp(Math.round(v[0]), 0, 255);
        d[o + 1] = clamp(Math.round(v[1]), 0, 255);
        d[o + 2] = clamp(Math.round(v[2]), 0, 255);
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function scaleCol(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

  var SPR = {};
  // G — основное тело занавеси: резкая нижняя кромка, кислородная зелень 557,7 нм,
  // к верху уходит в бирюзу и гаснет
  SPR.G = buildSprite(function (u) {
    var I, a;
    if (u >= G_EDGE) {
      var b = (u - G_EDGE) / (1 - G_EDGE);
      I = 0.55 * Math.pow(1 - b, 2.2); a = 0;
    } else {
      a = (G_EDGE - u) / G_EDGE;                       // 0 — кромка, 1 — верх
      var rise = 0.55 + 0.45 * smoothstep(0, 0.03, a);
      var decay = Math.exp(-Math.max(0, a - 0.03) / 0.3);
      var top = 1 - smoothstep(0.6, 1, a);
      I = rise * decay * top * (1 + 0.25 * Math.exp(-a / 0.02));
    }
    // насыщенные тона (мало красного и синего): там, где штрихи копятся в складке,
    // зелёный упирается в предел, а красный и синий — нет, и цвет остаётся зелёно-бирюзовым
    return scaleCol(lerpStops([
      [0, [42, 255, 106]], [0.05, [26, 255, 94]], [0.2, [19, 242, 88]],
      [0.45, [16, 202, 106]], [0.75, [24, 142, 136]], [1, [44, 92, 165]]
    ], a), I);
  });
  // D — мягкое диффузное свечение вокруг нижней кромки и ниже неё: просвет между
  // дугами переходит в плавный спад яркости, а не в тёмную «полку» с ровным краем
  var D_EDGE = 0.5 / 1.9;               // доля спрайта D выше кромки
  SPR.D = buildSprite(function (u) {
    var I, k;
    if (u < D_EDGE) {                   // над кромкой слабо — там и так яркое тело занавеси
      k = (D_EDGE - u) / D_EDGE;
      I = 0.35 * Math.exp(-k * 2.4) * (1 - smoothstep(0.6, 1, k)) + 0.65 * (1 - smoothstep(0, 0.12, k));
    } else {
      k = (u - D_EDGE) / (1 - D_EDGE);
      I = Math.exp(-k * 2.1) * (1 - smoothstep(0.6, 1, k));
    }
    return scaleCol(u < D_EDGE ? [18, 205, 112] : [16, 165, 116], I);
  });
  // V — верхушки лучей: сине-фиолетовый N2+ переходит в пурпур и красный кислород 630 нм
  SPR.V = buildSprite(function (u) {
    var c = 1 - u;
    var I = smoothstep(0, 0.3, c) * Math.pow(1 - smoothstep(0.38, 1, c), 1.25);
    return scaleCol(lerpStops([
      [0, [60, 125, 255]], [0.3, [100, 85, 255]], [0.55, [155, 62, 240]],
      [0.8, [210, 55, 190]], [1, [235, 60, 140]]
    ], c), I);
  });
  // B — голубые переливы в средней части полотна
  SPR.B = buildSprite(function (u) {
    var c = 1 - u;
    var I = Math.pow(Math.sin(Math.PI * c), 1.6) * (0.75 + 0.25 * c);
    return scaleCol(lerpStops([[0, [26, 210, 235]], [0.5, [38, 165, 255]], [1, [70, 130, 255]]], c), I);
  });
  // P — розово-малиновая кайма нижней кромки (азот) при сильной активности
  SPR.P = buildSprite(function (u) {
    var c = 1 - u;
    var I = smoothstep(0, 0.22, c) * (1 - smoothstep(0.3, 1, c));
    return scaleCol(lerpStops([[0, [255, 55, 140]], [0.5, [240, 60, 170]], [1, [190, 80, 210]]], c), I);
  });
  function toBitmaps(obj, keys) {       // ImageBitmap — готовая текстура, дешевле для тысяч drawImage
    if (typeof createImageBitmap !== 'function') return;
    keys.forEach(function (k) {
      createImageBitmap(obj[k]).then(function (b) { obj[k] = b; }, function () {});
    });
  }
  toBitmaps(SPR, ['G', 'V', 'B', 'P', 'D']);

  // звёздные «блики»
  var STAR_COLS = [
    [170, 196, 255], [212, 224, 255], [255, 250, 244], [255, 238, 208], [255, 210, 165], [255, 184, 135]
  ];
  var STAR_SPR = STAR_COLS.map(function (c) {
    var s = makeCanvas(32, 32), g = s.getContext('2d');
    var gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    var rgb = c[0] + ',' + c[1] + ',' + c[2];
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.07, 'rgba(' + rgb + ',0.95)');
    gr.addColorStop(0.2, 'rgba(' + rgb + ',0.32)');
    gr.addColorStop(0.45, 'rgba(' + rgb + ',0.07)');
    gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return s;
  });
  toBitmaps(STAR_SPR, [0, 1, 2, 3, 4, 5]);

  /* ───────────────────────── состояние ───────────────────────── */
  var sim = {
    act: 1, speed: 1, paused: false,
    T: 30, Tw: 30,                    // время формы/цвета и время волн
    surges: [], surgeLevel: 0, nextSurge: 34,
    meteors: [], nextMeteor: 36
  };

  var R2INV = 1 / (2 * 6371);         // кривизна Земли: провал = d²/2R

  function curtain(o) {
    var l = Math.hypot(o.dir[0], o.dir[1]);
    o.dx = o.dir[0] / l; o.dz = o.dir[1] / l;
    o.rayPh = o.seed * 3.1;
    return o;
  }
  // Две параллельные занавеси, уходящие по диагонали к правому краю
  // горизонта (сходятся в перспективе), и дальняя дуга над горизонтом.
  var CURTAINS = [
    curtain({ idx: 0, x0: -60, z0: 430, dir: [1, 0.6], s0: -470, s1: 1400, fade: 220,
      alt: 100, hG: 120, hU: 125, bright: 1.0, w: 2.2,
      wA: 150, wK: 1 / 380, wU: 0.06, wE: 0.015, rA: 22, rK: 1 / 95, rU: 0.7,
      cA: 34, cK: 1 / 115, cU: 0.08, cE: 0.03,
      raySpd: 1.3, purple: 0.8, blue: 0.7, fringe: 1, seed: 11 }),
    curtain({ idx: 1, x0: -230, z0: 713, dir: [1, 0.6], s0: -600, s1: 1150, fade: 300,
      alt: 102, hG: 112, hU: 130, bright: 0.7, w: 2.4,
      wA: 130, wK: 1 / 420, wU: 0.05, wE: 0.013, rA: 24, rK: 1 / 100, rU: 0.55,
      cA: 36, cK: 1 / 125, cU: 0.065, cE: 0.025,
      raySpd: 1.1, purple: 0.9, blue: 0.6, fringe: 0.6, seed: 37 }),
    curtain({ idx: 2, x0: 0, z0: 1000, dir: [1, 0.03], s0: -1600, s1: 1600, fade: 450,
      alt: 105, hG: 110, hU: 120, bright: 0.5, w: 3.0,
      wA: 90, wK: 1 / 450, wU: 0.04, wE: 0.012, rA: 25, rK: 1 / 90, rU: 0.45,
      cA: 30, cK: 1 / 140, cU: 0.05, cE: 0.02,
      raySpd: 0.9, purple: 0.6, blue: 0.5, fringe: 0.3, seed: 73 })
  ];
  var INCL = 0.23;   // ctg наклонения магнитного поля (~77°): лучи веером расходятся от магнитного зенита

  /* ───────────────────────── размеры и буферы ───────────────────────── */
  var W = 0, H = 0, DPR = 1, YH = 0, F = 0, CX = 0;   // CX — главная точка камеры по x
  var BW = 0, BH = 0, RS = 0.3, RW = 0, RH = 0, LR = 0.25, LW = 0, LH = 0;
  var bufA, gA, bA, bH1, bH2, bH3, bH4, bH5;          // буфер сияния и лестница свечения 1/2…1/32
  var reflC, gR, skyC, skyLow, landC, landLow, landTop = 0, maskC, litC, gLit;
  var colChain = [];
  var geo = null, fgPath = null, fgSnowPath = null;
  var twinkles = [];
  var vignette = null, waterGrad = null, waterFresnel = null, waterShade = null, grainPat = null;
  var DETAIL_LEVELS = [1, 0.84, 0.7, 0.58, 0.48], detailIdx = 0, goodWins = 0, detail = 1;

  function ctx2d(c) { return c.getContext('2d'); }

  function setup() {
    W = Math.max(2, window.innerWidth | 0);
    H = Math.max(2, window.innerHeight | 0);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);

    YH = Math.round(H * (W >= H ? 0.64 : 0.6));      // горизонт = урез воды
    F = 0.5 * Math.max(W, 1.25 * H);                  // фокус камеры, css-px
    // в узком (портретном) кадре камера смотрит левее — туда, где занавесь ближе и выше
    CX = W / 2 + F * 0.5 * clamp((H / W - 1) / 0.6, 0, 1);

    var bs = clamp(1100 / W, 0.35, 0.6);
    BW = Math.round(W * bs); BH = Math.round(YH * bs);
    bufA = makeCanvas(BW, BH); gA = ctx2d(bufA);
    bA = { c: bufA, g: gA, w: BW, h: BH };
    bH1 = makeBuf(BW / 2, BH / 2);
    bH2 = makeBuf(BW / 4, BH / 4);
    bH3 = makeBuf(BW / 8, BH / 8);
    bH4 = makeBuf(BW / 16, BH / 16);
    bH5 = makeBuf(BW / 32, BH / 32);

    RS = clamp(560 / W, 0.22, 0.45);
    RW = Math.round(W * RS); RH = Math.round(YH * RS);
    reflC = makeCanvas(RW, RH); gR = ctx2d(reflC);

    LR = clamp(420 / W, 0.18, 0.4);
    LW = Math.round(W * LR); LH = Math.round(H * LR);
    litC = makeCanvas(LW, LH); gLit = ctx2d(litC);

    gridMul = 0;                                       // сетки отсчётов пересоберутся под новый размер
    buildColChain();
    buildGeo();
    buildFg();
    buildSky();
    buildLand();
    buildMask();
    buildGradients();
  }

  function buildColChain() {
    colChain = [];
    var w = bH4.w, h = bH4.h;
    while ((h > 1 || w > 24) && colChain.length < 12) {
      w = Math.max(Math.min(24, w), Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
      colChain.push(makeBuf(w, h));
    }
  }

  /* ───────────────────────── небо ───────────────────────── */
  var LAT = 60 * DEG, LST = 1.2 * 15 * DEG;
  // яркие звёзды северной стороны неба: [RA ч, Dec °, зв. величина, цвет]
  var BRIGHT = [
    [2.530, 89.264, 1.98, 3],   // Полярная
    [11.062, 61.751, 1.79, 4],  // Дубхе
    [11.031, 56.382, 2.37, 1],  // Мерак
    [11.897, 53.695, 2.44, 1],  // Фекда
    [12.257, 57.033, 3.31, 1],  // Мегрец
    [12.900, 55.960, 1.77, 1],  // Алиот
    [13.399, 54.925, 2.27, 1],  // Мицар
    [13.420, 54.988, 3.99, 1],  // Алькор
    [13.792, 49.313, 1.86, 0],  // Бенетнаш
    [14.845, 74.156, 2.08, 5],  // Кохаб
    [15.345, 71.834, 3.05, 1],  // Феркад
    [5.278, 45.998, 0.08, 3],   // Капелла
    [18.616, 38.784, 0.03, 0],  // Вега
    [20.690, 45.280, 1.25, 1],  // Денеб
    [0.153, 59.150, 2.28, 2],   // Каф
    [0.675, 56.537, 2.24, 4],   // Шедар
    [0.945, 60.717, 2.47, 0],   // γ Кассиопеи
    [1.430, 60.235, 2.68, 1],   // Рукбах
    [1.907, 63.670, 3.37, 1],   // Сегин
    [3.405, 49.861, 1.79, 3],   // Мирфак
    [9.525, 63.062, 3.65, 2],   // 23 Б. Медведицы
    [10.285, 42.915, 3.45, 1],  // Тания Северная
    [16.400, 61.514, 2.74, 4],  // η Дракона
    [17.943, 51.489, 2.23, 4]   // Этамин
  ];

  function projSky(raH, decD) {
    var Ha = LST - raH * 15 * DEG, d = decD * DEG;
    var e = -Math.cos(d) * Math.sin(Ha);
    var n = Math.sin(d) * Math.cos(LAT) - Math.cos(d) * Math.cos(Ha) * Math.sin(LAT);
    var u = Math.sin(d) * Math.sin(LAT) + Math.cos(d) * Math.cos(Ha) * Math.cos(LAT);
    if (n <= 0.05) return null;
    return { x: CX + F * e / n, y: YH - F * u / n };
  }

  function pickStarCol(r) {
    return r < 0.12 ? 0 : r < 0.35 ? 1 : r < 0.62 ? 2 : r < 0.82 ? 3 : r < 0.95 ? 4 : 5;
  }

  function buildSky() {
    var cw = Math.ceil(W * DPR), ch = Math.ceil(YH * DPR) + 2;
    skyC = makeCanvas(cw, ch);
    var g = ctx2d(skyC);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    var gr = g.createLinearGradient(0, 0, 0, YH);
    gr.addColorStop(0, '#010208');
    gr.addColorStop(0.42, '#030816');
    gr.addColorStop(0.76, '#071322');
    gr.addColorStop(0.93, '#0c1d2a');
    gr.addColorStop(1, '#112731');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, YH + 2);

    // Млечный Путь: мягкая полоса с тёмной пылевой прожилкой
    var ms = 4, mw = Math.ceil(W / ms), mh = Math.ceil(YH / ms);
    var mc = makeCanvas(mw, mh), mg = ctx2d(mc);
    var img = mg.createImageData(mw, mh), d = img.data;
    var x1 = W * 0.6, y1 = YH * 1.08, x2 = W * 1.04, y2 = -YH * 0.12;
    var ddx = x2 - x1, ddy = y2 - y1, len = Math.hypot(ddx, ddy), nx = -ddy / len, ny = ddx / len;
    var bw = Math.min(W, H) * 0.12;
    for (var j = 0; j < mh; j++) {
      for (var i = 0; i < mw; i++) {
        var x = (i + 0.5) * ms, y = (j + 0.5) * ms;
        var q = ((x - x1) * nx + (y - y1) * ny) / bw;
        var I = Math.exp(-q * q * 1.25);
        if (I < 0.01) continue;
        I *= 0.5 + 0.75 * fbm(x / 120, y / 120, 4);
        var rift = Math.exp(-Math.pow((q - 0.12) / 0.3, 2)) * clamp01(0.45 + 1.2 * fbm(x / 70 + 20, y / 70, 3));
        I *= 1 - 0.7 * rift;
        I *= smoothstep(0, YH * 0.3, YH - y);
        I = clamp01(I);
        var o = (j * mw + i) * 4;
        d[o] = 178; d[o + 1] = 186; d[o + 2] = 210; d[o + 3] = Math.round(I * 255 * 0.17);
      }
    }
    mg.putImageData(img, 0, 0);
    g.drawImage(mc, 0, 0, mw * ms, mh * ms);

    // звёзды: статичный фон + список мерцающих
    twinkles = [];
    var rng = mulberry32(2024);
    var n = Math.round(W * YH / 380);
    var mwStars = Math.round(n * 0.45);
    var px = 1 / DPR;
    for (var k = 0; k < n + mwStars; k++) {
      var sx = rng() * W, sy = rng() * YH;
      if (k >= n) {                       // дополнительные звёзды — гуще в полосе Млечного Пути
        var qq = ((sx - x1) * nx + (sy - y1) * ny) / bw;
        if (rng() > Math.exp(-qq * qq * 2)) continue;
      }
      var m = Math.pow(rng(), 7);          // степенной закон яркости: ярких мало
      var ext = 0.12 + 0.88 * smoothstep(0, YH * 0.4, YH - sy);  // атмосферная экстинкция
      var ci = pickStarCol(rng());
      var col = STAR_COLS[ci];
      if (m > 0.4 && twinkles.length < 110) {
        twinkles.push({ x: sx, y: sy, r: 0.55 + 1.3 * m, ci: ci, a: (0.45 + 0.55 * m) * ext,
          ph: rng() * 100, fr: 1.5 + rng() * 2.5, sc: 0.18 + 0.55 * (1 - smoothstep(0, YH * 0.5, YH - sy)) });
        continue;
      }
      var a = (0.16 + 0.84 * Math.sqrt(m)) * ext;
      var r = Math.max(px, 0.35 + 1.0 * m);
      g.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + a.toFixed(3) + ')';
      g.fillRect(sx - r * 0.5, sy - r * 0.5, r, r);
    }
    // настоящее небо (60° с. ш., вид на север): Большой Ковш и др., если попали в кадр
    for (var b = 0; b < BRIGHT.length; b++) {
      var st = BRIGHT[b], p = projSky(st[0], st[1]);
      if (!p || p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > YH - 4) continue;
      var mag = st[2];
      var bext = 0.2 + 0.8 * smoothstep(0, YH * 0.35, YH - p.y);
      twinkles.push({ x: p.x, y: p.y, r: 0.7 + Math.max(0, 3.2 - mag) * 0.42, ci: st[3],
        a: clamp01(1.05 - mag * 0.14) * bext, ph: b * 7.7, fr: 1.8 + (b % 5) * 0.4,
        sc: 0.15 + 0.5 * (1 - smoothstep(0, YH * 0.5, YH - p.y)) });
    }

    // лёгкое свечение неба у горизонта (ночное свечение атмосферы)
    var ag = g.createLinearGradient(0, YH * 0.72, 0, YH);
    ag.addColorStop(0, 'rgba(40,120,90,0)');
    ag.addColorStop(1, 'rgba(40,120,90,0.07)');
    g.fillStyle = ag;
    g.fillRect(0, YH * 0.72, W, YH * 0.28 + 2);

    skyLow = makeCanvas(RW, RH);
    ctx2d(skyLow).drawImage(skyC, 0, 0, RW, RH);
  }

  /* ───────────────────────── рельеф ───────────────────────── */
  function buildGeo() {
    var rng = mulberry32(4242);
    var step = 2, n = Math.ceil(W / step) + 2;
    var far = new Float32Array(n), near = new Float32Array(n);
    var farTop = YH, i;
    var hs = H * clamp((W / H) * 1.3, 0.55, 1);        // в узком кадре горы ниже, иначе выходят иглы
    for (i = 0; i < n; i++) {
      var u = (i * step) / W;
      var mass = Math.max(bump(u, 0.17, 0.2), 0.95 * bump(u, 0.85, 0.15), 0.4 * bump(u, 0.53, 0.09));
      var rf = 0, amp = 1, fr = 4.5, tot = 0;
      for (var o = 0; o < 6; o++) {
        var v = 1 - Math.abs(noise(u * fr + o * 3.7, 11.3 + o * 7.1));
        rf += amp * v * v; tot += amp; amp *= 0.5; fr *= 2.1;
      }
      rf /= tot;
      far[i] = YH - hs * (0.016 + 0.125 * mass * rf);
      if (far[i] < farTop) farTop = far[i];
      var nm = Math.max(bump(u, 0.3, 0.14), 0.8 * bump(u, 0.71, 0.12), 0.7 * bump(u, 0, 0.1), 0.6 * bump(u, 1, 0.08));
      near[i] = YH - hs * (0.004 + 0.032 * nm * (0.55 + 0.45 * fbm(u * 6 + 2, 5.5, 4)));
    }
    var farPath = new Path2D(), nearPath = new Path2D();
    farPath.moveTo(-2, YH + 2);
    for (i = 0; i < n; i++) farPath.lineTo(i * step, far[i]);
    farPath.lineTo(W + 2, YH + 2); farPath.closePath();
    nearPath.moveTo(-2, YH + 2);
    for (i = 0; i < n; i++) nearPath.lineTo(i * step, near[i]);
    nearPath.lineTo(W + 2, YH + 2); nearPath.closePath();

    // лес по кромке холмов и берегу: узкие двухъярусные ели
    var trees = new Path2D();
    var x = -4;
    while (x < W + 4) {
      var k = clamp(Math.round(x / step), 0, n - 1);
      var hill = YH - near[k];
      var th = H * (hill > H * 0.01 ? 0.006 + 0.012 * rng() : 0.003 + 0.007 * rng());
      var tw = th * (0.26 + 0.14 * rng());
      var yb = near[k] + 1;
      trees.moveTo(x, yb - th);
      trees.lineTo(x + tw * 0.3, yb - th * 0.46);
      trees.lineTo(x + tw * 0.12, yb - th * 0.43);
      trees.lineTo(x + tw * 0.5, yb);
      trees.lineTo(x - tw * 0.5, yb);
      trees.lineTo(x - tw * 0.12, yb - th * 0.43);
      trees.lineTo(x - tw * 0.3, yb - th * 0.46);
      trees.closePath();
      x += tw * (0.35 + rng() * 0.9) + (rng() < 0.05 ? th * 2.5 : 0);
    }

    // снег на дальнем хребте: столбцы с «кулуарами»
    var snow = [];
    for (i = 0; i < n - 1; i++) {
      var top = Math.max(far[i], far[i + 1]);
      var h = YH - top;
      if (h < hs * 0.03) continue;
      var uu = (i * step) / W;
      var strk = Math.abs(noise(uu * 150, 3.3)) * 0.8 + Math.abs(noise(uu * 420, 8.1)) * 0.5;
      var depth = h * (0.22 + 0.38 * clamp01(0.5 + fbm(uu * 28, 9.1, 3))) * smoothstep(hs * 0.03, hs * 0.06, h);
      var a = clamp01(1.05 - strk) * smoothstep(hs * 0.03, hs * 0.065, h);
      if (a > 0.02 && depth > 0.5) snow.push(i * step, top, depth, a);
    }

    geo = { step: step, far: far, near: near, farTop: farTop, farPath: farPath, nearPath: nearPath, treePath: trees, snow: snow };
  }

  function sprucePath(p, x, yb, h, rng) {
    // Силуэт северной ели: плотная масса с рваным краем. Ярусы неравного шага,
    // ветви разной длины (сгустки и просветы), кончики опущены, хвоя торчит
    // зубцами; выемки неглубокие — ствол сквозь крону не просвечивает.
    var w = h * (0.2 + 0.07 * rng());
    var top = yb - h;
    var club = rng() < 0.5 ? 0.3 + 0.4 * rng() : 0;     // «булава» у макушки, как у чёрной ели
    var bend = (rng() - 0.5) * h * 0.02;                  // лёгкий изгиб ствола
    function trunkX(f) { return x + bend * Math.sin(f * Math.PI); }
    function side(sign) {
      var pts = [], y = top + h * 0.03, ph = rng() * 20;
      while (y < yb - h * 0.035) {
        var f = (y - top) / h;
        var env = 0.5 * w * (0.05 + 0.95 * Math.pow(f, 0.85));
        env *= 1 + club * Math.exp(-Math.pow((f - 0.16) / 0.06, 2));
        var clumpy = 0.8 + 0.22 * Math.sin(f * 19 + ph) * Math.sin(f * 7.7 + ph * 0.6) + 0.35 * (rng() - 0.5);
        if (rng() < 0.07) clumpy *= 0.45;                   // выпавшая ветка — просвет
        var tip = env * clamp(clumpy, 0.3, 1.25);
        var gap = h * (0.014 + 0.026 * rng()) * (0.55 + 0.9 * f);
        var droop = gap * (0.25 + 0.6 * rng()) * (0.4 + f);
        var tx = trunkX(f), inner = 0.38 + 0.3 * rng();
        pts.push([tx + sign * tip * inner, y - gap * 0.35]);                    // основание ветви
        pts.push([tx + sign * tip * (0.62 + 0.15 * rng()), y + droop * 0.25]);  // зубец хвои
        pts.push([tx + sign * tip, y + droop]);                                 // опущенный кончик
        if (rng() < 0.45) pts.push([tx + sign * tip * (0.8 + 0.12 * rng()), y + droop + gap * 0.2]);
        pts.push([tx + sign * tip * (inner + 0.08), y + gap * 0.3 + droop * 0.4]);  // низ ветви
        y += gap;
      }
      return pts;
    }
    var R = side(1), L = side(-1), i;
    p.moveTo(trunkX(0), top - h * 0.02);
    for (i = 0; i < R.length; i++) p.lineTo(R[i][0], R[i][1]);
    p.lineTo(trunkX(1) + w * 0.04, yb + 3);
    p.lineTo(trunkX(1) - w * 0.04, yb + 3);
    for (i = L.length - 1; i >= 0; i--) p.lineTo(L[i][0], L[i][1]);
    p.closePath();
  }

  function buildFg() {
    var rng = mulberry32(9090);
    var p = new Path2D(), sn = new Path2D();
    var ref = Math.min(H, W * 0.75);
    var i, x, u, y;

    // левый каменистый берег
    var xe = Math.min(W * 0.4, H * 0.8);
    var top = [];
    for (x = -3; x <= xe + 6; x += 3) {
      u = clamp01(x / xe);
      y = H * (0.8 + 0.21 * Math.pow(u, 1.7)) + H * 0.014 * fbm(x * 0.012, 3.3, 3)
        - H * 0.022 * bump(u, 0.42, 0.045) - H * 0.012 * bump(u, 0.63, 0.035);
      top.push(x, y);
    }
    function shoreY(xx) {
      var k = clamp(Math.round((xx + 3) / 3), 0, top.length / 2 - 1);
      return top[k * 2 + 1];
    }
    p.moveTo(-3, H + 3);
    for (i = 0; i < top.length; i += 2) p.lineTo(top[i], top[i + 1]);
    p.lineTo(xe + 6, H + 3); p.closePath();
    sn.moveTo(top[0], top[1] - 0.4);
    for (i = 2; i < top.length; i += 2) sn.lineTo(top[i], top[i + 1] - 0.4);
    for (i = top.length - 2; i >= 0; i -= 2) {
      var th = H * 0.0065 * (0.4 + 0.9 * clamp01(0.5 + noise(top[i] * 0.03, 8.8)));
      sn.lineTo(top[i], top[i + 1] + th);
    }
    sn.closePath();

    // правый берег
    var xs = W - Math.min(W * 0.22, H * 0.45);
    var rt = [];
    for (x = xs - 6; x <= W + 3; x += 3) {
      u = clamp01((x - xs) / (W - xs));
      y = H * (0.945 - 0.085 * Math.pow(u, 1.3)) + H * 0.008 * fbm(x * 0.015, 6.6, 3) + H * 0.03 * (1 - smoothstep(0, 0.12, u));
      rt.push(x, y);
    }
    function shoreR(xx) {
      var k = clamp(Math.round((xx - (xs - 6)) / 3), 0, rt.length / 2 - 1);
      return rt[k * 2 + 1];
    }
    p.moveTo(xs - 6, H + 3);
    for (i = 0; i < rt.length; i += 2) p.lineTo(rt[i], rt[i + 1]);
    p.lineTo(W + 3, H + 3); p.closePath();
    sn.moveTo(rt[0], rt[1] - 0.4);
    for (i = 2; i < rt.length; i += 2) sn.lineTo(rt[i], rt[i + 1] - 0.4);
    for (i = rt.length - 2; i >= 0; i -= 2) sn.lineTo(rt[i], rt[i + 1] + H * 0.005);
    sn.closePath();

    // ели переднего плана
    var LT = [[0.036, 0.53], [0.012, 0.34], [0.088, 0.38], [0.128, 0.28], [0.168, 0.18], [0.205, 0.11], [0.236, 0.07], [0.258, 0.045]];
    for (i = 0; i < LT.length; i++) {
      x = LT[i][0] * W;
      if (x > xe * 0.92) continue;
      sprucePath(p, x, shoreY(x) + 2, LT[i][1] * ref, rng);
    }
    var RT = [[0.962, 0.24], [0.935, 0.12], [0.986, 0.16]];
    for (i = 0; i < RT.length; i++) {
      x = RT[i][0] * W;
      if (x < xs + (W - xs) * 0.15) continue;
      sprucePath(p, x, shoreR(x) + 2, RT[i][1] * ref, rng);
    }
    fgPath = p; fgSnowPath = sn;
  }

  function renderLand(g, scale, oy, mode) {
    var mask = mode === 'mask';
    g.setTransform(scale, 0, 0, scale, 0, -oy * scale);
    if (!mask) {
      var gr = g.createLinearGradient(0, geo.farTop, 0, YH);
      gr.addColorStop(0, '#101826');
      gr.addColorStop(1, '#070b12');
      g.fillStyle = gr;
    } else {
      g.fillStyle = 'rgba(255,255,255,0.16)';   // воздушная дымка перед дальним хребтом
    }
    g.fill(geo.farPath);
    var sc = mask ? '255,255,255' : '76,92,112';
    var am = mask ? 1 : 0.4;
    var s = geo.snow, st = geo.step;
    for (var i = 0; i < s.length; i += 4) {
      var x = s[i], y = s[i + 1], d = s[i + 2], a = s[i + 3] * am;
      g.fillStyle = 'rgba(' + sc + ',' + a.toFixed(3) + ')';
      g.fillRect(x, y, st, d * 0.35);
      g.fillStyle = 'rgba(' + sc + ',' + (a * 0.55).toFixed(3) + ')';
      g.fillRect(x, y + d * 0.35, st, d * 0.35);
      g.fillStyle = 'rgba(' + sc + ',' + (a * 0.2).toFixed(3) + ')';
      g.fillRect(x, y + d * 0.7, st, d * 0.3);
    }
    if (mask) g.globalCompositeOperation = 'destination-out';
    g.fillStyle = mask ? '#000' : '#03050a';
    g.fill(geo.nearPath);
    g.fill(geo.treePath);
    g.globalCompositeOperation = 'source-over';
    if (mask) {
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fill(geo.nearPath);
    }
    // дымка над водой у дальнего берега
    var mt = YH - H * 0.045;
    var mg = g.createLinearGradient(0, mt, 0, YH + 3);
    var mc = mask ? '255,255,255' : '150,178,190';
    var ma = mask ? 0.5 : 0.075;
    mg.addColorStop(0, 'rgba(' + mc + ',0)');
    mg.addColorStop(0.7, 'rgba(' + mc + ',' + (ma * 0.55) + ')');
    mg.addColorStop(0.94, 'rgba(' + mc + ',' + ma + ')');
    mg.addColorStop(1, 'rgba(' + mc + ',' + (ma * 0.4) + ')');
    g.fillStyle = mg;
    g.fillRect(0, mt, W, YH + 3 - mt);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function buildLand() {
    landTop = Math.floor(geo.farTop - 4);
    landC = makeCanvas(W * DPR, (YH + 3 - landTop) * DPR);
    renderLand(ctx2d(landC), DPR, landTop, 'color');
    landLow = makeCanvas(RW, RH);
    renderLand(ctx2d(landLow), RS, 0, 'low');
  }

  // маска поверхностей, отражающих свет сияния: снег, дымка, снег на берегу
  function buildMask() {
    maskC = makeCanvas(LW, LH);
    var g = ctx2d(maskC);
    renderLand(g, LR, 0, 'mask');
    g.setTransform(LR, 0, 0, LR, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    g.fill(fgPath);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fill(fgSnowPath);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function buildGradients() {
    var cx = W / 2, cy = H * 0.5;
    vignette = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.32, cx, cy, Math.hypot(W, H) * 0.62);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(0.65, 'rgba(0,0,0,0.22)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
    waterGrad = ctx.createLinearGradient(0, YH, 0, H);
    waterGrad.addColorStop(0, '#0a1520');
    waterGrad.addColorStop(1, '#02050a');
    // доля отражения f(q) = 0.8 − 0.5·q^0.7; поверх — цвет воды с альфой 1 − f
    waterFresnel = ctx.createLinearGradient(0, YH, 0, H);
    [0, 0.1, 0.3, 0.6, 1].forEach(function (q) {
      var a = 1 - (0.8 - 0.5 * Math.pow(q, 0.7));
      var r = Math.round(8 - 6 * q), gg = Math.round(17 - 12 * q), b = Math.round(26 - 16 * q);
      waterFresnel.addColorStop(q, 'rgba(' + r + ',' + gg + ',' + b + ',' + a.toFixed(3) + ')');
    });
    waterShade = ctx.createLinearGradient(0, YH, 0, H);
    waterShade.addColorStop(0, 'rgba(1,4,9,0)');
    waterShade.addColorStop(0.35, 'rgba(1,4,9,0.18)');
    waterShade.addColorStop(1, 'rgba(1,4,9,0.55)');
    var gc = makeCanvas(128, 128), gg = ctx2d(gc);
    var img = gg.createImageData(128, 128), rng = mulberry32(99);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 128 + (rng() + rng() - 1) * 110;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    gg.putImageData(img, 0, 0);
    grainPat = ctx.createPattern(gc, 'repeat');
  }

  /* ───────────────────────── динамика ───────────────────────── */
  function spawnSurge(strength, s0) {
    sim.surges.push({ t0: sim.T, s0: s0, strength: strength, life: 13, v: 170, wid: 130, te: 0, front: 0 });
    if (sim.surges.length > 4) sim.surges.shift();
  }

  function update(dt) {
    var sdt = sim.paused ? 0 : dt * sim.speed;
    sim.T += sdt;
    var lvl = 0;
    for (var i = sim.surges.length - 1; i >= 0; i--) {
      var u = sim.surges[i], tau = sim.T - u.t0;
      if (tau > u.life) { sim.surges.splice(i, 1); continue; }
      u.te = smoothstep(0, 1.4, tau) * (1 - smoothstep(u.life * 0.35, u.life, tau));
      u.front = u.v * Math.max(0, tau);
      lvl += u.te * u.strength;
    }
    sim.surgeLevel = Math.min(2, lvl);
    if (sim.T > sim.nextSurge) {
      spawnSurge(0.7 + 0.5 * Math.random(), -250 + Math.random() * 650);
      sim.nextSurge = sim.T + 22 + Math.random() * 20;
    }
    var a = sim.act, sl = sim.surgeLevel;
    sim.Tw += sdt * (0.55 + 0.45 * a + 0.7 * sl);
    for (var c = 0; c < CURTAINS.length; c++) {
      CURTAINS[c].rayPh += sdt * CURTAINS[c].raySpd * (0.55 + 0.45 * a + 1.6 * sl);
    }
    // метеоры
    if (sim.T > sim.nextMeteor) {
      sim.nextMeteor = sim.T + 7 + Math.random() * 16;
      var ang = (18 + Math.random() * 45) * DEG, sgn = Math.random() < 0.5 ? -1 : 1, spd = 480 + Math.random() * 520;
      sim.meteors.push({ x: W * (0.12 + 0.76 * Math.random()), y: YH * (0.04 + 0.42 * Math.random()),
        vx: sgn * Math.cos(ang) * spd, vy: Math.sin(ang) * spd, age: 0,
        life: 0.45 + Math.random() * 0.45, len: 80 + Math.random() * 100, b: 0.55 + Math.random() * 0.45 });
    }
    for (var m = sim.meteors.length - 1; m >= 0; m--) {
      sim.meteors[m].age += sdt;
      if (sim.meteors[m].age >= sim.meteors[m].life) sim.meteors.splice(m, 1);
    }
  }

  /* ───────────────────────── сияние ───────────────────────── */
  var SURGE_W = [1, 0.65, 0.4];
  var surgeBuf = [];

  function drawCurtain(c, g, env) {
    var fb = env.fb, cx = env.cx, hb = env.hb, bufW = env.bw;
    var wS = c.w * env.strokeMul;
    var T = sim.T, Tw = sim.Tw, ph = c.rayPh, seed = c.seed;
    var gain = c.bright * env.gain;
    var fringe0 = clamp01((sim.act - 0.6) * 1.2) * c.fringe;
    var sG = SPR.G, sV = SPR.V, sB = SPR.B, sP = SPR.P, sD = SPR.D;
    var nS = 0, sArr = surgeBuf;
    for (var q = 0; q < sim.surges.length; q++) {
      var su = sim.surges[q];
      var amp = su.te * su.strength * SURGE_W[c.idx];
      if (amp > 0.01) { sArr[nS++] = su.s0; sArr[nS++] = su.front; sArr[nS++] = su.wid; sArr[nS++] = amp; }
    }

    // Выборка по полотну — статичная сетка по s (не зависит от времени), иначе
    // отсчёты «плывут» от кадра к кадру и лучи мерцают. Где волна приблизила
    // полотно и шаг на экране вырос, штрих плавно расширяется.
    var grid = c.grid, lod1A = c.lod1, lod2A = c.lod2, envA = c.envA, nG = grid.length;
    var pX = 0, pZ = 0, pSx = 0;
    for (var gi = 0; gi < nG; gi++) {
      var s = grid[gi];
      var wv = c.wA * noise(s * c.wK + Tw * c.wU, seed + T * c.wE)
        + c.rA * Math.sin(s * c.rK - Tw * c.rU + seed) * (0.5 + 0.5 * noise(s * 0.004 - Tw * 0.02, seed + 40));
      var cu = c.cA * noise(s * c.cK - Tw * c.cU, seed + 20 + T * c.cE);
      var al = s + cu;
      var X = c.x0 + c.dx * al - c.dz * wv;
      var Z = c.z0 + c.dz * al + c.dx * wv;
      var ex = X - pX, ez = Z - pZ, L = Math.sqrt(ex * ex + ez * ez);
      pX = X; pZ = Z;
      var Zc = Z < 40 ? 40 : Z;
      var ppk = fb / Zc;                         // буферных пикселей на километр
      var sx = cx + X * ppk;
      var gap = Math.abs(sx - pSx);
      pSx = sx;
      if (gi === 0 || Z <= 40) continue;
      var wE = gap * 1.1 > wS ? (gap * 1.1 < 24 ? gap * 1.1 : 24) : wS;
      if (sx < -wE - 4 || sx > bufW + wE + 4) continue;
      var envS = envA[gi];
      if (envS < 0.002) continue;

      var drop = (X * X + Z * Z) * R2INV;
      // нижняя кромка плавно гуляет по высоте — без длинных идеально ровных участков
      var altB = c.alt + 6 * noise(s * 0.012, seed + 60 + T * 0.07)
        + 11 * noise(s * 0.0055 + T * 0.01, seed + 65 + T * 0.02) - drop;
      var yB = hb - altB * ppk;
      // лучи: крупные сгущения + пучки + тонкая штриховка (LOD по шагу сетки)
      var n3 = noise(s * 0.034 + ph * 0.35, seed + 95 + T * 0.07);
      var l1 = lod1A[gi], l2 = lod2A[gi];
      var n1 = l1 > 0.02 ? l1 * noise(s * 0.13 + ph, seed + 80 + T * 0.17) : 0;
      var n2 = l2 > 0.02 ? l2 * noise(s * 0.3 - ph * 1.6, seed + 90 + T * 0.3) : 0;
      var r = clamp01(0.52 + 0.24 * n1 + 0.22 * n2 + 0.3 * n3);
      var rs = clamp01(0.55 + 0.35 * n3 + 0.12 * n1);          // сглаженная яркость для верхушек
      var hG = c.hG * (0.86 + 0.22 * noise(s * 0.02 + ph * 0.25, seed + 100 + T * 0.1) + 0.1 * n1);
      var yTG = yB - hG * ppk;
      if (yTG >= hb) continue;                                  // целиком за горизонтом

      var big = 0.3 + 0.7 * clamp01(0.55 + 0.7 * noise(s * 0.0026 + T * 0.012, seed + 120 + T * 0.022));
      var sg = 0;
      for (var k = 0; k < nS; k += 4) {
        var dd = Math.abs(s - sArr[k]), fr0 = sArr[k + 1];
        var xx = (dd - fr0) / sArr[k + 2];
        var f = Math.exp(-xx * xx);
        if (dd < fr0) f += 0.3 + 0.5 * Math.exp((dd - fr0) / 260);
        sg += sArr[k + 3] * f;
      }
      if (sg > 1.6) sg = 1.6;
      var base = gain * envS * big * (1 + 0.4 * sg);
      base = base * 1.2 / (1 + 0.4 * base);            // мягкое плечо: пики сжимаются, тени — нет
      // Энергия штриха ∝ длине участка полотна L. В складке, видимой ребром,
      // штрихи ложатся друг на друга — складка ярче, но мягко (~cos^-0.2),
      // иначе накопление выжигает цвет в белый.
      var cosv = gap / Math.max(1e-3, L * ppk);
      cosv = cosv < 0.06 ? 0.06 : cosv > 1 ? 1 : cosv;
      var cosP = Math.pow(cosv, 0.8);
      var kk = Math.min(1.2, (L * ppk) / wE) * cosP;
      var a = base * (0.3 + 0.7 * r) * kk;
      if (a < 0.003) continue;

      // луч идёт вдоль силовой линии: сдвиг вбок растёт с высотой
      var lean = (X / Zc) * INCL;
      g.setTransform(1, 0, -lean, 1, lean * yB, 0);
      var x0 = sx - wE * 0.5;
      g.globalAlpha = a > 1 ? 1 : a;
      g.drawImage(sG, x0, yTG, wE, (yB - yTG) / G_EDGE);

      // верхушки, голубые переливы и кайма — плавные поля (без тонких лучей),
      // поэтому рисуются через отсчёт штрихом двойной ширины
      if ((gi & 1) === 0) {
        var aS = base * (0.3 + 0.7 * rs) * kk;
        var x2 = sx - wE, w2 = wE * 2;
        // диффузное свечение кромки (без ослабления в складке — оно и так мягкое)
        var aD = aS * 0.75;
        if (aD > 0.004) {
          var yd0 = yB - 0.5 * hG * ppk, hd = 1.9 * hG * ppk;
          g.globalAlpha = aD > 1 ? 1 : aD;
          g.drawImage(sD, x2, yd0, w2, hd);
        }
        // в складке пурпур, голубой и кайма слабеют — копится зелёный, а не белый
        aS *= cosP;
        var pf = clamp01(c.purple * (0.35 + 0.8 * noise(s * 0.003 - T * 0.03, seed + 140 + T * 0.035)) + 0.25 * sg);
        var aV = aS * pf * 0.62;
        if (aV > 0.004) {
          var hU = c.hU * (0.5 + 0.5 * clamp01(0.5 + 0.8 * noise(s * 0.012 + ph * 0.15, seed + 160 + T * 0.1))) * (0.75 + 0.35 * rs);
          var yv0 = yB - (hG + hU) * ppk, yv1 = yB - 0.3 * hG * ppk;
          g.globalAlpha = aV > 1 ? 1 : aV;
          g.drawImage(sV, x2, yv0, w2, yv1 - yv0);
        }
        var bwv = 0.5 + 0.5 * Math.sin(s * 0.028 - T * 0.8 + seed + 2.4 * noise(s * 0.004, seed + 180 + T * 0.03));
        var bf = c.blue * bwv * bwv * clamp01(0.3 + 0.9 * noise(s * 0.002 + T * 0.01, seed + 200));
        var aB = aS * bf * 0.8;
        if (aB > 0.004) {
          g.globalAlpha = aB > 1 ? 1 : aB;
          g.drawImage(sB, x2, yB - 0.95 * hG * ppk, w2, 0.87 * hG * ppk);
        }
        // азотная кайма лежит ниже зелёной кромки (~90–100 км)
        var frn = (fringe0 + 0.3 * sg) * clamp01(0.35 + 0.9 * noise(s * 0.008 - T * 0.1, seed + 220));
        var aP = aS * (frn < 0.7 ? frn : 0.7) * 0.42;   // кайма лишь подкрашивает: розовый + яркий зелёный = белёсый
        if (aP > 0.004) {
          g.globalAlpha = aP > 1 ? 1 : aP;
          g.drawImage(sP, x2, yB - 0.05 * hG * ppk, w2, 0.14 * hG * ppk);
        }
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  // статичная сетка отсчётов: шаг ~0.72 ширины штриха для номинального положения полотна
  var gridMul = 0;
  function buildGrids(strokeMul) {
    gridMul = strokeMul;
    var fb = F * BW / W;
    for (var i = 0; i < CURTAINS.length; i++) {
      var c = CURTAINS[i], wS = c.w * strokeMul, sp = wS * 0.72;
      var S = [], L1 = [], L2 = [], EN = [];
      var s = c.s0;
      while (s <= c.s1 && S.length < 12000) {
        var zn = c.z0 + c.dz * s;
        if (zn < 80) zn = 80;
        var ds = (sp * zn) / fb;
        if (ds < 0.25) ds = 0.25;
        S.push(s);
        L1.push(smoothstep(1.6, 3.0, 7.7 / ds));
        L2.push(smoothstep(1.6, 3.0, 3.3 / ds));
        EN.push(smoothstep(c.s0, c.s0 + c.fade, s) * (1 - smoothstep(c.s1 - c.fade, c.s1, s)));
        s += ds;
      }
      c.grid = new Float64Array(S);
      c.lod1 = new Float32Array(L1);
      c.lod2 = new Float32Array(L2);
      c.envA = new Float32Array(EN);
    }
  }

  function drawAurora() {
    var g = gA;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, BW, BH);
    g.globalCompositeOperation = 'lighter';
    // на больших буферах штрих чуть шире — число штрихов растёт медленнее площади
    var mul = Math.max(1, Math.sqrt(BW / 800)) / detail;
    if (mul !== gridMul) buildGrids(mul);
    // яркость растёт с активностью мягко выше 1 — сильное сияние проявляется
    // скоростью, пурпуром и каймой, а не пересветом
    var act = sim.act;
    var env = { fb: F * BW / W, cx: CX * BW / W, hb: BH, bw: BW, strokeMul: mul,
      gain: act <= 1 ? 0.25 + 0.65 * act : 0.9 + 0.3 * (act - 1) };
    for (var i = CURTAINS.length - 1; i >= 0; i--) drawCurtain(CURTAINS[i], g, env);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // копия буфера src (рабочая область) в dst с уменьшением; для дальних ступеней — с размытием
  function down(src, dst, blur, lighter) {
    var g = dst.g;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, dst.c.width, dst.c.height);
    if (blur && HAS_FILTER) g.filter = 'blur(1.2px)';
    g.drawImage(src.c, 0, 0, src.w, src.h, 0, 0, dst.w, dst.h);
    if (blur && HAS_FILTER) g.filter = 'none';
    if (lighter) {                         // удвоить яркость
      g.globalCompositeOperation = 'lighter';
      g.drawImage(src.c, 0, 0, src.w, src.h, 0, 0, dst.w, dst.h);
      g.globalCompositeOperation = 'source-over';
    }
  }
  // вывести рабочую область буфера b в прямоугольник (x, y, w, h)
  function put(g, b, x, y, w, h) { g.drawImage(b.c, 0, 0, b.w, b.h, x, y, w, h); }

  function bloom() {
    down(bA, bH1, false);
    down(bH1, bH2, false);
    down(bH2, bH3, true);
    down(bH3, bH4, true);
    down(bH4, bH5, true);
  }

  // средний цвет сияния по столбцам неба → подсветка снега и дымки
  function renderLit() {
    var src = bH4;
    for (var i = 0; i < colChain.length; i++) {
      down(src, colChain[i], false, i === colChain.length - 1);
      src = colChain[i];
    }
    gLit.globalAlpha = 1;
    gLit.globalCompositeOperation = 'copy';
    gLit.drawImage(maskC, 0, 0);
    gLit.globalCompositeOperation = 'source-in';
    put(gLit, src, 0, 0, LW, LH);
    gLit.globalCompositeOperation = 'source-over';
  }

  function buildReflSource() {
    var g = gR;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(skyLow, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.drawImage(bufA, 0, 0, RW, RH);
    g.globalAlpha = 0.6; put(g, bH2, 0, 0, RW, RH);
    g.globalAlpha = 0.6; put(g, bH3, 0, 0, RW, RH);
    g.globalAlpha = 0.5; put(g, bH4, 0, 0, RW, RH);
    g.globalAlpha = 0.5; put(g, bH5, 0, 0, RW, RH);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(landLow, 0, 0);
  }

  /* ───────────────────────── сборка кадра ───────────────────────── */
  function drawTwinkles(g) {
    var T = sim.T;
    for (var i = 0; i < twinkles.length; i++) {
      var s = twinkles[i];
      var tw = 1 + s.sc * (0.6 * noise(T * s.fr, s.ph) + 0.35 * noise(T * s.fr * 2.3, s.ph + 5));
      var a = s.a * tw;
      if (a < 0.02) continue;
      g.globalAlpha = a > 1 ? 1 : a;
      var size = s.r * 7;
      g.drawImage(STAR_SPR[s.ci], s.x - size / 2, s.y - size / 2, size, size);
    }
    g.globalAlpha = 1;
  }

  function drawMeteors(g) {
    for (var i = 0; i < sim.meteors.length; i++) {
      var m = sim.meteors[i], k = m.age / m.life;
      var hx = m.x + m.vx * m.age, hy = m.y + m.vy * m.age;
      var sp = Math.hypot(m.vx, m.vy), len = m.len * Math.min(1, k * 3 + 0.1);
      var tx = hx - (m.vx / sp) * len, ty = hy - (m.vy / sp) * len;
      var a = Math.sin(Math.PI * k) * m.b;
      var gr = g.createLinearGradient(tx, ty, hx, hy);
      gr.addColorStop(0, 'rgba(150,200,255,0)');
      gr.addColorStop(1, 'rgba(235,245,255,' + a.toFixed(3) + ')');
      g.strokeStyle = gr;
      g.lineWidth = 1.3;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(hx, hy); g.stroke();
    }
  }

  function drawWater(g) {
    g.fillStyle = waterGrad;
    g.fillRect(0, YH, W, H - YH);
    buildReflSource();
    var lake = H - YH, T = sim.T, step = 2;
    for (var y = YH; y < H; y += step) {
      var d = y - YH + step * 0.5;
      var q = d / lake;
      var ph = 1600 / (d + 4);                       // перспективное сжатие волн у горизонта
      var wv = Math.sin(ph + T * 1.3) * 0.5 + noise(ph * 0.25, T * 0.35) * 0.7
        + Math.sin(d * 0.37 + T * 2.1) * 0.25 * q;
      var amp = 0.3 + d * 0.045;
      var sh = step * RS * (1.2 + q * 2.5);
      var sy = (YH - d - wv * amp) * RS - sh * 0.5;
      sy = clamp(sy, 0, RH - sh);
      var dx = noise(ph * 0.08 + 7, T * 0.22) * (0.2 + d * 0.012);
      // полосы непрозрачные и с нахлёстом — без светлых швов; френель ниже градиентом
      g.drawImage(reflC, 0, sy, RW, sh, dx - 6, y, W + 12, step + 0.6);
    }
    g.fillStyle = waterFresnel;          // у горизонта вода отражает сильнее, у берега — слабее
    g.fillRect(0, YH, W, H - YH);
    g.fillStyle = waterShade;
    g.fillRect(0, YH, W, H - YH);
  }

  function compose() {
    var g = ctx;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.imageSmoothingEnabled = true;
    try { g.imageSmoothingQuality = 'high'; } catch (e) { /* нет — не важно */ }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(skyC, 0, 0, skyC.width / DPR, skyC.height / DPR);

    g.globalCompositeOperation = 'lighter';
    drawTwinkles(g);
    g.drawImage(bufA, 0, 0, W, YH);
    // ближнее свечение слабее (не выжигает яркие места), дальнее — шире и мягче
    g.globalAlpha = 0.32; put(g, bH2, 0, 0, W, YH);
    g.globalAlpha = 0.45; put(g, bH3, 0, 0, W, YH);
    g.globalAlpha = 0.55; put(g, bH4, 0, 0, W, YH);
    g.globalAlpha = 0.6; put(g, bH5, 0, 0, W, YH);
    g.globalAlpha = 1;
    drawMeteors(g);
    g.globalCompositeOperation = 'source-over';

    drawWater(g);
    g.drawImage(landC, 0, landTop, W, landC.height / DPR);

    g.fillStyle = '#020306';
    g.fill(fgPath);
    g.fillStyle = 'rgba(34,42,54,0.85)';
    g.fill(fgSnowPath);

    renderLit();
    g.globalCompositeOperation = 'lighter';
    var ly = landTop * LR;
    g.drawImage(litC, 0, ly, LW, LH - ly, 0, landTop, W, H - landTop);
    g.globalCompositeOperation = 'source-over';

    g.fillStyle = vignette;
    g.fillRect(0, 0, W, H);

    if (detail > 0.7 && grainPat) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      var ox = (Math.random() * 128) | 0, oy = (Math.random() * 128) | 0;
      g.globalCompositeOperation = 'overlay';
      g.globalAlpha = 0.06;
      g.translate(-ox, -oy);
      g.fillStyle = grainPat;
      g.fillRect(ox, oy, canvas.width, canvas.height);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  }

  /* ───────────────────────── цикл ───────────────────────── */
  var last = 0, perfAcc = 0, perfN = 0, fpsAcc = 0, fpsN = 0;
  var fpsEl = document.getElementById('fps');

  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    var raw = (now - last) / 1000;
    last = now;
    var dt = raw > 0.05 ? 0.05 : raw < 0 ? 0 : raw;

    if (raw > 0 && raw < 0.25) {
      perfAcc += raw; perfN++;
      fpsAcc += raw; fpsN++;
      // адаптивная детализация: ступени, с гистерезисом, чтобы не «дышать»
      if (perfAcc > 2) {
        var avg = perfAcc / perfN;
        if (avg > 0.024 && detailIdx < DETAIL_LEVELS.length - 1) { detailIdx++; goodWins = 0; }
        else if (avg < 0.0185 && detailIdx > 0 && ++goodWins >= 4) { detailIdx--; goodWins = 0; }
        detail = DETAIL_LEVELS[detailIdx];
        perfAcc = 0; perfN = 0;
      }
      if (fpsAcc > 0.5) {
        if (fpsEl) fpsEl.textContent = Math.round(fpsN / fpsAcc) + ' fps';
        fpsAcc = 0; fpsN = 0;
      }
    }

    update(dt);
    drawAurora();
    bloom();
    compose();
  }

  /* ───────────────────────── интерфейс ───────────────────────── */
  function $(id) { return document.getElementById(id); }
  var actEl = $('act'), spdEl = $('spd'), pauseEl = $('pause');

  function setPaused(p) {
    sim.paused = p;
    if (pauseEl) pauseEl.textContent = p ? 'Пуск' : 'Пауза';
  }
  function burst() { spawnSurge(1.35, 40 + (Math.random() - 0.5) * 300); }
  function toggleUI(force) {
    var hidden = typeof force === 'boolean' ? force : !document.body.classList.contains('ui-hidden');
    document.body.classList.toggle('ui-hidden', hidden);
  }

  if (actEl) actEl.addEventListener('input', function () { sim.act = +actEl.value; });
  if (spdEl) spdEl.addEventListener('input', function () { sim.speed = +spdEl.value; });
  // после клика кнопка отдаёт фокус, иначе пробел нажмёт её второй раз
  function onBtn(id, fn) {
    var el = $(id);
    if (el) el.addEventListener('click', function () { fn(); el.blur(); });
  }
  onBtn('pause', function () { setPaused(!sim.paused); });
  onBtn('burst', burst);
  onBtn('hide', function () { toggleUI(true); });
  canvas.addEventListener('click', function () {
    if (document.body.classList.contains('ui-hidden')) toggleUI(false);
  });
  window.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    if (k === ' ') { setPaused(!sim.paused); e.preventDefault(); }
    else if (k === 'b' || k === 'и') burst();
    else if (k === 'h' || k === 'р') toggleUI();
  });

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(setup, 120);
  });

  window.__aurora = sim;               // для отладки из консоли
  setup();
  requestAnimationFrame(frame);
})();
