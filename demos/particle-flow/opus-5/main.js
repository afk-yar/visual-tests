/* Поток частиц 3D — Claude Opus 5
 *
 * Canvas 2D, без WebGL. Конвейер кадра:
 *   1. curl-noise поле скоростей считается на 3D-сетке 32^3 и обновляется
 *      скользящим фронтом (амортизированно, ~260 ячеек за кадр);
 *   2. десятки тысяч частиц интегрируются по этому полю + аналитический
 *      дифференциальный вихрь (спиральные рукава) и мягкое кубическое
 *      удержание в объёме «раздутого» диска (полутолщина растёт с радиусом);
 *   3. частица рисуется не точкой, а непрерывным штрихом от прошлой позиции
 *      к новой: subsplat'ы с шагом ~1.35 px, суммарная светимость делится
 *      на их число (сохранение потока) — быстрый поток не выжигает пиксель;
 *   4. штрихи аддитивно билинейно копятся в HDR-буфер Float32 (R,G,B),
 *      буфер между кадрами затухает — это следы;
 *   5. HDR -> hue-preserving тонемап Рейнхарда (бесконечный мягкий шолдер,
 *      клиппинга нет: множитель берётся по max-каналу, плюс лёгкое
 *      обесцвечивание ядра) -> sRGB LUT + дизер -> ImageData; попутно
 *      строится лог-гистограмма кадра;
 *   6. авто-экспозиция: верхний процентиль гистограммы удерживается на
 *      целевом уровне (множитель веса сплата) — ядро не уходит в заливку;
 *   7. фон, многоуровневый bloom (цепочка уменьшений) и виньетка —
 *      композитятся на GPU через drawImage/'lighter'.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var LE = (function () {
    var b = new ArrayBuffer(4);
    new Uint32Array(b)[0] = 1;
    return new Uint8Array(b)[0] === 1;
  })();

  /* ==================================================================
     Perlin noise 3D
     ================================================================== */
  var perm = new Uint16Array(512);
  var GR = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
  ]);

  var rndSeed = 20260816;
  function srnd() {
    rndSeed = (rndSeed * 1664525 + 1013904223) | 0;
    return ((rndSeed >>> 8) & 0xFFFFFF) / 16777216;
  }
  function seedPerm() {
    var p = new Uint8Array(256), i, j, t;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {
      j = (srnd() * (i + 1)) | 0;
      t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
  }

  function gr(h, x, y, z) {
    var i = (h % 12) * 3;
    return GR[i] * x + GR[i + 1] * y + GR[i + 2] * z;
  }

  function noise3(x, y, z) {
    var Xi = Math.floor(x), Yi = Math.floor(y), Zi = Math.floor(z);
    var xf = x - Xi, yf = y - Yi, zf = z - Zi;
    var X = Xi & 255, Y = Yi & 255, Z = Zi & 255;
    var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    var v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    var w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    var A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    var B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    var x1 = xf - 1, y1 = yf - 1, z1 = zf - 1;
    var n000 = gr(perm[AA], xf, yf, zf), n100 = gr(perm[BA], x1, yf, zf);
    var n010 = gr(perm[AB], xf, y1, zf), n110 = gr(perm[BB], x1, y1, zf);
    var n001 = gr(perm[AA + 1], xf, yf, z1), n101 = gr(perm[BA + 1], x1, yf, z1);
    var n011 = gr(perm[AB + 1], xf, y1, z1), n111 = gr(perm[BB + 1], x1, y1, z1);
    var a = n000 + u * (n100 - n000), b = n010 + u * (n110 - n010);
    var c = n001 + u * (n101 - n001), d = n011 + u * (n111 - n011);
    var e = a + v * (b - a), f = c + v * (d - c);
    return e + w * (f - e);
  }

  /* ==================================================================
     Векторный потенциал и его ротор (curl noise)
     ================================================================== */
  var POT = [0, 0, 0, 19.73, -7.31, 4.17, -11.24, 15.62, 23.98];
  var NF = 1.42;
  var ptime = 0;

  function pot(x, y, z, k) {
    var ox = POT[k] + ptime * 0.085;
    var oy = POT[k + 1] - ptime * 0.062;
    var oz = POT[k + 2] + ptime * 0.117;
    var s = noise3(x * NF + ox, y * NF + oy, z * NF + oz);
    s += 0.50 * noise3(x * (NF * 2.13) + ox * 1.7 + 5.2,
                       y * (NF * 2.13) + oy * 1.7 - 3.1,
                       z * (NF * 2.13) + oz * 1.7 + 8.8);
    s += 0.25 * noise3(x * (NF * 4.31) + ox * 2.9 - 6.4,
                       y * (NF * 4.31) + oy * 2.9 + 11.3,
                       z * (NF * 4.31) + oz * 2.9 - 2.7);
    return s;
  }

  var cvx = 0, cvy = 0, cvz = 0;
  var CE = 0.058, CI = 1 / (2 * 0.058);

  function curlAt(x, y, z) {
    var a1 = pot(x, y + CE, z, 6), a0 = pot(x, y - CE, z, 6);
    var b1 = pot(x, y, z + CE, 3), b0 = pot(x, y, z - CE, 3);
    cvx = ((a1 - a0) - (b1 - b0)) * CI;
    var c1 = pot(x, y, z + CE, 0), c0 = pot(x, y, z - CE, 0);
    var d1 = pot(x + CE, y, z, 6), d0 = pot(x - CE, y, z, 6);
    cvy = ((c1 - c0) - (d1 - d0)) * CI;
    var e1 = pot(x + CE, y, z, 3), e0 = pot(x - CE, y, z, 3);
    var f1 = pot(x, y + CE, z, 0), f0 = pot(x, y - CE, z, 0);
    cvz = ((e1 - e0) - (f1 - f0)) * CI;
  }

  /* сетка поля: 32^3 узлов, шаг 4 float (x,y,z,—) для выравнивания */
  var GN = 32, GCELLS = GN * GN * GN;
  var FSTEP = 2 / (GN - 1);
  var field = new Float32Array(GCELLS * 4);
  var curlNorm = 1;
  var rollIdx = 0;
  var ROLL_PER_FRAME = 170;

  function buildFieldFull() {
    var sum = 0, idx, o;
    for (idx = 0; idx < GCELLS; idx++) {
      curlAt((idx & 31) * FSTEP - 1, ((idx >> 5) & 31) * FSTEP - 1, ((idx >> 10) & 31) * FSTEP - 1);
      o = idx << 2;
      field[o] = cvx; field[o + 1] = cvy; field[o + 2] = cvz;
      sum += Math.sqrt(cvx * cvx + cvy * cvy + cvz * cvz);
    }
    var mean = sum / GCELLS;
    curlNorm = mean > 1e-6 ? 1 / mean : 1;
    for (idx = 0; idx < GCELLS; idx++) {
      o = idx << 2;
      field[o] *= curlNorm; field[o + 1] *= curlNorm; field[o + 2] *= curlNorm;
    }
    rollIdx = 0;
  }

  function rollField(cells) {
    for (var k = 0; k < cells; k++) {
      var idx = rollIdx;
      curlAt((idx & 31) * FSTEP - 1, ((idx >> 5) & 31) * FSTEP - 1, ((idx >> 10) & 31) * FSTEP - 1);
      var o = idx << 2;
      field[o] = cvx * curlNorm; field[o + 1] = cvy * curlNorm; field[o + 2] = cvz * curlNorm;
      rollIdx = (idx + 1) & 32767;
    }
  }

  /* ==================================================================
     Частицы
     ================================================================== */
  var MAXP = 90000;
  var pX = new Float32Array(MAXP), pY = new Float32Array(MAXP), pZ = new Float32Array(MAXP);
  var vX = new Float32Array(MAXP), vY = new Float32Array(MAXP), vZ = new Float32Array(MAXP);
  var pAge = new Float32Array(MAXP), pLife = new Float32Array(MAXP), pBri = new Float32Array(MAXP);
  var count = 40000;
  /* при смене числа частиц суммарная светимость меняется мягко,
     а не линейно — иначе ползунок «Частицы» работает как экспозиция */
  var countGain = 1;
  function updCountGain() { countGain = Math.pow(40000 / count, 0.65); }

  var FIELD_W = 0.34;   // вклад curl-поля
  var SWIRL = 0.82;     // дифференциальное вращение диска
  var FLAT = 0.12;      // лёгкий крен к плоскости диска (без схлопывания)
  var VY_W = 0.88;      // вертикальный вклад поля
  var TH0 = 0.155, THR = 0.28;              // полутолщина диска: TH0 + THR*r
  var THW = 0.42, VWALL = 1.30;             // мягкая кубическая стенка по высоте
  var RW = 0.76, RWD = 0.46, WALL = 1.05;   // мягкая кубическая стенка по радиусу
  var CORE_R = 0.15, CORE_PUSH = 0.42;      // расталкивание от оси вращения
  var flowSpeed = 1.0;

  function computeVel(i, x, y, z) {
    /* трилинейная выборка поля */
    var gx = (x + 1) * 15.5, gy = (y + 1) * 15.5, gz = (z + 1) * 15.5;
    if (gx < 0) gx = 0; else if (gx > 30.999) gx = 30.999;
    if (gy < 0) gy = 0; else if (gy > 30.999) gy = 30.999;
    if (gz < 0) gz = 0; else if (gz > 30.999) gz = 30.999;
    var ix = gx | 0, iy = gy | 0, iz = gz | 0;
    var tx = gx - ix, ty = gy - iy, tz = gz - iz;
    var sx = 1 - tx, sy = 1 - ty, sz = 1 - tz;
    var w000 = sx * sy * sz, w100 = tx * sy * sz, w010 = sx * ty * sz, w110 = tx * ty * sz;
    var w001 = sx * sy * tz, w101 = tx * sy * tz, w011 = sx * ty * tz, w111 = tx * ty * tz;
    var f = field;
    var o0 = (((iz << 5) | iy) << 5 | ix) << 2;
    var o1 = o0 + 4, o2 = o0 + 128, o3 = o0 + 132;
    var o4 = o0 + 4096, o5 = o0 + 4100, o6 = o0 + 4224, o7 = o0 + 4228;
    var ax = f[o0] * w000 + f[o1] * w100 + f[o2] * w010 + f[o3] * w110 +
             f[o4] * w001 + f[o5] * w101 + f[o6] * w011 + f[o7] * w111;
    var ay = f[o0 + 1] * w000 + f[o1 + 1] * w100 + f[o2 + 1] * w010 + f[o3 + 1] * w110 +
             f[o4 + 1] * w001 + f[o5 + 1] * w101 + f[o6 + 1] * w011 + f[o7 + 1] * w111;
    var az = f[o0 + 2] * w000 + f[o1 + 2] * w100 + f[o2 + 2] * w010 + f[o3 + 2] * w110 +
             f[o4 + 2] * w001 + f[o5 + 2] * w101 + f[o6 + 2] * w011 + f[o7 + 2] * w111;

    var ux = ax * FIELD_W, uy = ay * (FIELD_W * VY_W), uz = az * FIELD_W;

    /* дифференциальное вращение: центр крутится быстрее -> спиральные рукава */
    var r = Math.sqrt(x * x + z * z) + 1e-5;
    var om = SWIRL / (0.30 + r * 1.15);
    ux -= z * om; uz += x * om;

    /* радиальное удержание: кубический спад — на старте стенки градиент
       нулевой, поэтому у неё не собирается пик плотности; равновесие
       достигается далеко (r ~ 1.05), в разряжённом гало */
    if (r > RW) {
      var dr = (r - RW) / RWD;
      var q = dr * dr * dr * WALL / r;
      ux -= x * q; uz -= z * q;
    } else if (r < CORE_R) {
      /* мягкое расталкивание от оси: без него спиральный поток свивается
         в одно ядро и выжигает центр кадра */
      var dc = (CORE_R - r) / CORE_R;
      var qc = dc * dc * CORE_PUSH / r;
      ux += x * qc; uz += z * qc;
    }

    /* вертикально: внутри «раздутого» диска частица свободна (плотность
       размазана по объёму), кубическая стенка включается только за его
       границей — вместо жёсткого сплющивания в светящуюся плоскость */
    uy -= y * FLAT;
    var hz = TH0 + THR * r;
    var ya = y < 0 ? -y : y;
    if (ya > hz) {
      var dy = (ya - hz) / THW;
      var qv = dy * dy * dy * VWALL;
      uy -= (y > 0 ? qv : -qv);
    }

    vX[i] = ux * flowSpeed;
    vY[i] = uy * flowSpeed;
    vZ[i] = uz * flowSpeed;
  }

  function respawn(i) {
    var ang = Math.random() * TAU;
    /* почти площадно-равномерно внутри удерживаемой зоны: частицы не
       засеваются снаружи стенки, поэтому их не сносит в общее ядро */
    var rr = 0.11 + Math.pow(Math.random(), 0.62) * 0.68;
    var x = Math.cos(ang) * rr, z = Math.sin(ang) * rr;
    var y = (Math.random() + Math.random() - 1) * (TH0 + THR * rr) * 1.15;
    pX[i] = x; pY[i] = y; pZ[i] = z;
    pAge[i] = 0;
    pLife[i] = 3.5 + Math.random() * 8.5;
    var b = Math.random();
    pBri[i] = 0.38 + b * b * 1.75;
    computeVel(i, x, y, z);
  }

  function initParticles(a, b) {
    for (var i = a; i < b; i++) {
      respawn(i);
      pAge[i] = Math.random() * pLife[i] * 0.92;
    }
  }

  /* ==================================================================
     Палитры (линейный свет)
     ================================================================== */
  var PALETTES = [
    { name: 'Туманность', stops: [
      [0.00, '#0d1445'], [0.17, '#1c3fb4'], [0.34, '#2589e2'], [0.50, '#43d4ef'],
      [0.63, '#a6f2f2'], [0.74, '#ffd089'], [0.86, '#ff9a3c'], [1.00, '#fff0d2']] },
    { name: 'Магма', stops: [
      [0.00, '#2a0b3e'], [0.20, '#6d1250'], [0.40, '#bd2f36'],
      [0.60, '#f2661c'], [0.78, '#ffb03a'], [0.90, '#ffe07a'], [1.00, '#fff6dc']] },
    { name: 'Изумруд', stops: [
      [0.00, '#08204c'], [0.20, '#0a5a72'], [0.42, '#12a37a'], [0.60, '#3ddc93'],
      [0.74, '#a9f5c4'], [0.86, '#ffe9a0'], [1.00, '#fffbe8']] }
  ];
  var palIndex = 0;
  var pal = new Float32Array(256 * 4);
  var GAIN = 0.085;

  function hexLin(h) {
    var n = parseInt(h.slice(1), 16);
    return [
      Math.pow(((n >> 16) & 255) / 255, 2.2),
      Math.pow(((n >> 8) & 255) / 255, 2.2),
      Math.pow((n & 255) / 255, 2.2)
    ];
  }

  function buildPalette(idx) {
    palIndex = idx;
    var stops = PALETTES[idx].stops;
    var lin = [], i;
    for (i = 0; i < stops.length; i++) lin.push(hexLin(stops[i][1]));
    var k = 0;
    for (i = 0; i < 256; i++) {
      var t = i / 255;
      while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      var t0 = stops[k][0], t1 = stops[k + 1][0];
      var f = (t - t0) / (t1 - t0 || 1);
      if (f < 0) f = 0; else if (f > 1) f = 1;
      var ca = lin[k], cb = lin[k + 1], o = i << 2;
      pal[o] = (ca[0] + (cb[0] - ca[0]) * f) * GAIN;
      pal[o + 1] = (ca[1] + (cb[1] - ca[1]) * f) * GAIN;
      pal[o + 2] = (ca[2] + (cb[2] - ca[2]) * f) * GAIN;
    }
  }

  /* глубина -> множители цвета (воздушная перспектива + затухание) */
  var dLUT = new Float32Array(64 * 4);
  (function buildDepth() {
    for (var i = 0; i < 64; i++) {
      var d = i / 63;
      var b = 1.40 * Math.pow(1 - d, 1.30) + 0.11;
      var o = i << 2;
      dLUT[o] = b * (1 - 0.44 * d);
      dLUT[o + 1] = b * (1 - 0.17 * d);
      dLUT[o + 2] = b * (1 + 0.26 * d);
    }
  })();

  /* ------------------------------------------------------------------
     Тонемап: hue-preserving плёночная кривая с коленом.
     До колена (HDR = TONE_K) — почти линейный степенной отклик: середина
     тонов не «молочная», струи внутри ядра читаются. Выше колена —
     алгебраический шолдер, который асимптотически идёт к 1 и никогда её
     не достигает: клиппинга нет, в пересвете остаются и структура, и цвет
     (множитель берётся по max-каналу, отношения каналов сохраняются).
     FL[k*2] — множитель, FL[k*2+1] — «белая» добавка (обесцвечивание).
     Индекс k: 0..2047 — HDR 0..4 (шаг 1/512), 2048..4095 — 4..68 (шаг 1/32).
     Шаг верхнего сегмента мелкий намеренно: у колена кривая ещё крутая, на
     грубой сетке в ядре пошли бы концентрические полосы (постеризация).
     ------------------------------------------------------------------ */
  var FL = new Float32Array(4096 * 2);
  var HB = new Uint8Array(4096);      // индекс тонемапа -> корзина лог-гистограммы
  var encLUT = new Uint8Array(4096);  // линейный свет [0..1] -> sRGB 0..255
  var bucketM = new Float32Array(64); // корзина -> характерный HDR-уровень
  var hist = new Uint32Array(64);
  var litCount = 0;
  var DESAT = 0.42;
  var TONE_K = 4.0;      // HDR-уровень колена
  var TONE_A = 0.80;     // линейный свет в колене (~231 в sRGB)
  var TONE_P = 0.85;     // наклон до колена
  var ACC_EPS = 1.6e-4;  // ниже — пиксель невидим, аккумулятор обнуляем
  var MET_MIN = 8e-3;    // «здесь кадр виден» — порог для замера экспозиции
  var HOT_X = 4.0;       // целевой HDR-уровень верхнего процентиля
  var gain = 1.0;        // авто-экспозиция (входит в вес сплата)
  var expBias = 1.15;

  function buildTone() {
    var k, m, tv, d, o, b, y, s, v, u;
    var sB = TONE_A * TONE_P / (1 - TONE_A);   // стык: наклон непрерывен
    for (k = 0; k < 4096; k++) {
      m = k < 2048 ? (k + 0.5) / 512 : 4 + ((k - 2048) + 0.5) / 32;
      u = m / TONE_K;
      tv = u <= 1 ? TONE_A * Math.pow(u, TONE_P)
                  : 1 - (1 - TONE_A) / (1 + sB * (u - 1));
      d = DESAT * tv * tv * tv;
      o = k << 1;
      FL[o] = tv * (1 - d) / m;
      FL[o + 1] = tv * d;
      b = ((Math.log(m) / Math.LN2 + 10) * 3) | 0;   // 3 корзины на октаву
      HB[k] = b < 0 ? 0 : (b > 62 ? 62 : b);
    }
    for (k = 0; k < 4096; k++) {
      y = k / 4095;
      s = y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
      v = Math.round(s * 255);
      encLUT[k] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }
    for (b = 0; b < 63; b++) bucketM[b] = Math.pow(2, (b + 0.5) / 3 - 10);
    bucketM[63] = 2048;
  }

  /* Авто-экспозиция: держим верхние 0.5% видимой площади на уровне HOT_X.
     Конвейер линеен по gain, поэтому rate=1 — это точное одношаговое
     решение (используется при калибровке на старте). */
  function adaptExposure(rate) {
    if (litCount < 150) return;
    var need = litCount * 0.005, s = 0, b, lvl = 0;
    for (b = 63; b >= 0; b--) {
      s += hist[b];
      if (s >= need) { lvl = bucketM[b]; break; }
    }
    if (!(lvl > 0)) return;
    var ratio = HOT_X / lvl;
    if (rate < 1) {
      if (ratio > 0.88 && ratio < 1.14) return;   // мёртвая зона — без мерцания
      if (ratio > 6) ratio = 6; else if (ratio < 0.17) ratio = 0.17;
      ratio = Math.pow(ratio, rate);
    } else {
      if (ratio > 40) ratio = 40; else if (ratio < 0.025) ratio = 0.025;
    }
    gain = clamp(gain * ratio, 0.02, 60);
  }

  /* дизер-таблица (заодно даёт лёгкое «зерно плёнки») */
  var NTAB = 4096;
  var noiseTab = new Float32Array(NTAB);
  (function () {
    for (var i = 0; i < NTAB; i++) noiseTab[i] = (Math.random() - 0.5) * 0.0036;
  })();

  /* ==================================================================
     Холсты и буферы
     ================================================================== */
  var view = document.getElementById('view');
  var vctx = view.getContext('2d', { alpha: false });

  var accCv = document.createElement('canvas');
  var accCtx = accCv.getContext('2d', { alpha: false });

  function mkLayer() {
    var cv = document.createElement('canvas');
    return { cv: cv, ctx: cv.getContext('2d'), w: 2, h: 2 };
  }
  function sizeLayer(l, w, h) {
    l.w = Math.max(2, w | 0); l.h = Math.max(2, h | 0);
    l.cv.width = l.w; l.cv.height = l.h;
    l.ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in l.ctx) l.ctx.imageSmoothingQuality = 'high';
  }
  var L1 = mkLayer(), L2 = mkLayer(), L3 = mkLayer(), LS = mkLayer(), LB = mkLayer();

  var W = 2, H = 2, W3 = 6, Wm1 = 1, Hm1 = 1;
  var VW = 2, VH = 2, cssW = 2, cssH = 2;
  var acc = new Float32Array(12);
  var imgData = null, out32 = null;
  var focal = 1, cxp = 1, cyp = 1;
  var bgGrad = null, ambGrad = null, vigGrad = null;

  /* целевое число пикселей внутреннего HDR-буфера: «ср.» — почти нативное
     разрешение окна (апскейл ~1.17x), «выс.» — 1:1 без апскейла */
  var QUALITY = [340000, 760000, 1250000];
  var QNAME = ['низк.', 'ср.', 'выс.'];
  var qIndex = 1;
  var adaptHold = 0;   // после resize аккумулятор пуст — не даём экспозиции дёрнуться

  function buildGradients() {
    var cx = VW * 0.5, cy = VH * 0.52;
    var R = Math.sqrt(VW * VW + VH * VH) * 0.62;
    var g = vctx.createRadialGradient(cx, cy * 0.92, 0, cx, cy, R);
    g.addColorStop(0, '#0a1020');
    g.addColorStop(0.42, '#060a14');
    g.addColorStop(1, '#010206');
    bgGrad = g;

    var a = vctx.createRadialGradient(VW * 0.34, VH * 0.34, 0, VW * 0.34, VH * 0.34, R * 0.85);
    a.addColorStop(0, 'rgba(30,58,124,0.20)');
    a.addColorStop(0.5, 'rgba(20,38,86,0.08)');
    a.addColorStop(1, 'rgba(0,0,0,0)');
    ambGrad = a;

    var v = vctx.createRadialGradient(cx, cy, Math.min(VW, VH) * 0.20, cx, cy, R * 1.02);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.55, 'rgba(0,0,0,0.16)');
    v.addColorStop(1, 'rgba(0,0,0,0.72)');
    vigGrad = v;
  }

  var pendingResize = false;

  function resize() {
    pendingResize = false;
    var cw = window.innerWidth || document.documentElement.clientWidth || 900;
    var ch = window.innerHeight || document.documentElement.clientHeight || 600;
    cw = Math.max(180, cw | 0); ch = Math.max(160, ch | 0);
    cssW = cw; cssH = ch;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var vw = Math.round(cw * dpr), vh = Math.round(ch * dpr);
    var maxV = 2.6e6;
    if (vw * vh > maxV) {
      var kk = Math.sqrt(maxV / (vw * vh));
      vw = Math.round(vw * kk); vh = Math.round(vh * kk);
    }
    VW = Math.max(2, vw); VH = Math.max(2, vh);
    view.width = VW; view.height = VH;
    view.style.width = cw + 'px';
    view.style.height = ch + 'px';

    var s = Math.sqrt(QUALITY[qIndex] / (cw * ch));
    if (s > 1) s = 1; else if (s < 0.2) s = 0.2;
    W = Math.max(96, Math.round(cw * s));
    H = Math.max(72, Math.round(ch * s));
    W3 = W * 3; Wm1 = W - 1.002; Hm1 = H - 1.002;

    accCv.width = W; accCv.height = H;
    imgData = accCtx.createImageData(W, H);
    out32 = new Uint32Array(imgData.data.buffer);
    out32.fill(LE ? 0xFF000000 : 0x000000FF);
    acc = new Float32Array(W * H * 3);

    sizeLayer(L1, W >> 1, H >> 1);
    sizeLayer(L2, W >> 2, H >> 2);
    sizeLayer(L3, W >> 3, H >> 3);
    sizeLayer(LS, W >> 5, H >> 2);
    sizeLayer(LB, W >> 2, H >> 2);

    /* крупный кадр: диск занимает ~4/5 ширины (было ~1/3) */
    focal = Math.min(H * 1.50, W * 0.95);
    cxp = W * 0.5; cyp = H * 0.52;
    adaptHold = 18;

    vctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in vctx) vctx.imageSmoothingQuality = 'high';
    buildGradients();

    if (resEl) resEl.textContent = W + '×' + H;
  }

  /* ==================================================================
     Камера
     ================================================================== */
  var yaw = 0.55, pitchBase = 0.30, pitch = 0.30, camBase = 2.50, camDist = 2.50;
  var cosYaw = 1, sinYaw = 0, cosPitch = 1, sinPitch = 0;
  var depthOff = 1.15, depthScale = 1 / 2.7;
  var elapsed = 0, orbit = true;

  function updateCamera(dt) {
    elapsed += dt;
    if (orbit) yaw += dt * 0.078;
    if (yaw > 1e6) yaw -= 1e6;
    pitch = pitchBase + Math.sin(elapsed * 0.13) * 0.085 + Math.sin(elapsed * 0.047) * 0.05;
    camDist = camBase + Math.sin(elapsed * 0.061) * 0.13;
    cosYaw = Math.cos(yaw); sinYaw = Math.sin(yaw);
    cosPitch = Math.cos(pitch); sinPitch = Math.sin(pitch);
    depthOff = camDist - 1.35;
  }

  /* ==================================================================
     Симуляция + аддитивный сплат
     ================================================================== */
  var frameNo = 0;

  function simulate(pdt, dtN, doSplat) {
    var n = count, i;
    if (pdt > 0) {
      for (i = frameNo % 3; i < n; i += 3) computeVel(i, pX[i], pY[i], pZ[i]);
    }
    if (!doSplat) {
      for (i = 0; i < n; i++) {
        var x0 = pX[i] + vX[i] * pdt, y0 = pY[i] + vY[i] * pdt, z0 = pZ[i] + vZ[i] * pdt;
        var a0 = pAge[i] + pdt;
        if (a0 >= pLife[i] || x0 * x0 + z0 * z0 > 3.4 || y0 * y0 > 1.8) { respawn(i); continue; }
        pX[i] = x0; pY[i] = y0; pZ[i] = z0; pAge[i] = a0;
      }
      return;
    }

    var A = acc, P = pal, DL = dLUT;
    var cy_ = cosYaw, sy_ = sinYaw, cp_ = cosPitch, sp_ = sinPitch;
    var cd = camDist, fo = focal, ox = cxp, oy = cyp;
    var dOff = depthOff, dSc = depthScale;
    var invFlow = 1 / (flowSpeed > 0.01 ? flowSpeed : 0.01);
    var dtNg = dtN * countGain * gain;
    var w = W, wm = Wm1, hm = Hm1, w3 = W3;

    for (i = 0; i < n; i++) {
      var ux = vX[i], uy = vY[i], uz = vZ[i];
      var qx = pX[i], qy = pY[i], qz = pZ[i];        // позиция на прошлом кадре
      var x = qx + ux * pdt, y = qy + uy * pdt, z = qz + uz * pdt;
      var age = pAge[i] + pdt;
      var rad2 = x * x + z * z;
      if (age >= pLife[i] || rad2 > 3.4 || y * y > 1.8) {
        respawn(i);
        x = pX[i]; y = pY[i]; z = pZ[i]; age = 0;
        ux = vX[i]; uy = vY[i]; uz = vZ[i];
        rad2 = x * x + z * z;
        qx = x; qy = y; qz = z;   // новая частица: без штриха-телепорта
      } else {
        pX[i] = x; pY[i] = y; pZ[i] = z; pAge[i] = age;
      }

      /* проекция новой позиции */
      var rx = x * cy_ + z * sy_;
      var rz = z * cy_ - x * sy_;
      var ry = y * cp_ - rz * sp_;
      var zc = y * sp_ + rz * cp_ + cd;
      if (zc < 0.40) continue;
      var inv = fo / zc;
      var s1x = ox + rx * inv, s1y = oy - ry * inv;

      /* проекция прошлой позиции: штрих рисуется по отрезку, а не точкой,
         иначе за кадр частица перескакивает несколько пикселей и след
         читается пунктиром */
      var s0x = s1x, s0y = s1y;
      if (pdt > 0) {
        var rx0 = qx * cy_ + qz * sy_;
        var rz0 = qz * cy_ - qx * sy_;
        var ry0 = qy * cp_ - rz0 * sp_;
        var zc0 = qy * sp_ + rz0 * cp_ + cd;
        if (zc0 > 0.40) {
          var inv0 = fo / zc0;
          s0x = ox + rx0 * inv0; s0y = oy - ry0 * inv0;
        }
      }

      /* отрезок целиком за кадром — дальше не считаем */
      if ((s1x < 0 && s0x < 0) || (s1x > wm && s0x > wm) ||
          (s1y < 0 && s0y < 0) || (s1y > hm && s0y > hm)) continue;

      var dxs = s1x - s0x, dys = s1y - s0y;
      var ns = 1, seg = dxs * dxs + dys * dys;
      if (seg > 0.4) {
        seg = Math.sqrt(seg);
        if (seg > 96) {                   // пролёт у камеры — не тянем кляксу
          dxs = 0; dys = 0; s0x = s1x; s0y = s1y;
        } else {
          ns = ((seg * 0.74) | 0) + 1;    // шаг ~1.35 px — штрих непрерывный
          if (ns > 12) ns = 12;
        }
      }

      /* огибающая жизни */
      var lf = pLife[i];
      var fin = age * 3.2; if (fin > 1) fin = 1;
      var fout = (lf - age) * 0.75; if (fout > 1) fout = 1;

      /* цвет: нормированная скорость + близость к ядру + разброс по частицам */
      var spd = (Math.sqrt(ux * ux + uy * uy + uz * uz) * invFlow - 0.25) * 1.4;
      if (spd < 0) spd = 0; else if (spd > 1) spd = 1;
      var core = 1.12 - rad2 * 1.25;
      if (core < 0) core = 0; else if (core > 1) core = 1;
      var ci = 0.06 + spd * 0.40 + core * 0.72 + (pBri[i] - 1) * 0.05;
      var pi = (ci * 255) | 0;
      if (pi < 0) pi = 0; else if (pi > 255) pi = 255;
      pi <<= 2;

      var dd = (zc - dOff) * dSc;
      if (dd < 0) dd = 0; else if (dd > 0.999) dd = 0.999;
      var dj = ((dd * 64) | 0) << 2;

      /* светимость делится на число subsplat'ов: поток сохраняется, и
         быстрая (значит длинная) струя не выжигает отдельный пиксель */
      var invn = 1 / ns;
      var wgt = fin * fout * pBri[i] * dtNg * invn;
      var rr = P[pi] * DL[dj] * wgt;
      var gg = P[pi + 1] * DL[dj + 1] * wgt;
      var bb = P[pi + 2] * DL[dj + 2] * wgt;

      /* билинейный аддитивный сплат вдоль отрезка */
      var cxs = s0x + dxs * invn * 0.5, cys = s0y + dys * invn * 0.5;
      var stx = dxs * invn, sty = dys * invn;
      for (var sp = 0; sp < ns; sp++, cxs += stx, cys += sty) {
        if (!(cxs >= 0 && cxs <= wm && cys >= 0 && cys <= hm)) continue;
        var xi = cxs | 0, yi = cys | 0;
        var fx = cxs - xi, fy = cys - yi;
        var gx0 = 1 - fx, gy0 = 1 - fy;
        var a00 = gx0 * gy0, a10 = fx * gy0, a01 = gx0 * fy, a11 = fx * fy;
        var o = (yi * w + xi) * 3;
        A[o] += rr * a00; A[o + 1] += gg * a00; A[o + 2] += bb * a00;
        A[o + 3] += rr * a10; A[o + 4] += gg * a10; A[o + 5] += bb * a10;
        o += w3;
        A[o] += rr * a01; A[o + 1] += gg * a01; A[o + 2] += bb * a01;
        A[o + 3] += rr * a11; A[o + 4] += gg * a11; A[o + 5] += bb * a11;
      }
    }
  }

  /* ==================================================================
     HDR -> ImageData (тонемап, дизер, затухание следов)
     ================================================================== */
  function composite(decay) {
    var A = acc, D = out32, N = W * H, i = 0, p = 0, b;
    var F = FL, EN = encLUT, HBv = HB, HS = hist, lit = 0;
    var NT = noiseTab, no = (frameNo * 977) & (NTAB - 1);
    var le = LE, eps = ACC_EPS, met = MET_MIN;
    var blank = le ? 0xFF000000 : 0x000000FF;
    for (b = 0; b < 64; b++) HS[b] = 0;
    for (; p < N; p++, i += 3) {
      var r = A[i], g = A[i + 1], bl = A[i + 2];
      var m = r > g ? r : g; if (bl > m) m = bl;
      if (m < eps) {
        /* m === 0 значит пиксель был погашен ещё на прошлом кадре: и
           аккумулятор, и вывод там уже нулевые. Не трогаем — 2/3 кадра
           это фон, лишние записи гоняют по шине мегабайты каждый кадр */
        if (m !== 0) { A[i] = 0; A[i + 1] = 0; A[i + 2] = 0; D[p] = blank; }
        continue;
      }
      /* индекс тонемапа по max-каналу (двухсегментный: тонкий низ, грубый верх) */
      var k = m < 4 ? (m * 512) | 0 : (m < 68 ? 2048 + (((m - 4) * 32) | 0) : 4095);
      if (m > met) { HS[HBv[k]]++; lit++; }
      var o = k << 1, f = F[o], wa = F[o + 1];
      var nz = NT[(p * 61 + no) & (NTAB - 1)];
      var ri = ((r * f + wa + nz) * 4095) | 0; if (ri < 0) ri = 0; else if (ri > 4095) ri = 4095;
      var gi = ((g * f + wa + nz) * 4095) | 0; if (gi < 0) gi = 0; else if (gi > 4095) gi = 4095;
      var bi = ((bl * f + wa + nz) * 4095) | 0; if (bi < 0) bi = 0; else if (bi > 4095) bi = 4095;
      D[p] = LE
        ? (0xFF000000 | (EN[bi] << 16) | (EN[gi] << 8) | EN[ri])
        : ((EN[ri] << 24) | (EN[gi] << 16) | (EN[bi] << 8) | 255);
      A[i] = r * decay; A[i + 1] = g * decay; A[i + 2] = bl * decay;
    }
    litCount = lit;
    accCtx.putImageData(imgData, 0, 0);
  }

  /* тот же замер без вывода — только для калибровки экспозиции на старте */
  function measureAcc(decay) {
    var A = acc, N = W * H, i = 0, p = 0, lit = 0, b;
    var HBv = HB, HS = hist;
    for (b = 0; b < 64; b++) HS[b] = 0;
    for (; p < N; p++, i += 3) {
      var r = A[i], g = A[i + 1], bl = A[i + 2];
      var m = r > g ? r : g; if (bl > m) m = bl;
      if (m < ACC_EPS) { A[i] = 0; A[i + 1] = 0; A[i + 2] = 0; continue; }
      if (m > MET_MIN) {
        HS[HBv[m < 4 ? (m * 512) | 0 : (m < 68 ? 2048 + (((m - 4) * 32) | 0) : 4095)]]++;
        lit++;
      }
      A[i] = r * decay; A[i + 1] = g * decay; A[i + 2] = bl * decay;
    }
    litCount = lit;
  }

  /* ==================================================================
     Композит на экран: фон + свечение + bloom + виньетка
     ================================================================== */
  var bloom = 1.0;

  function present() {
    var g = vctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = bgGrad;
    g.fillRect(0, 0, VW, VH);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = ambGrad;
    g.fillRect(0, 0, VW, VH);

    g.drawImage(accCv, 0, 0, VW, VH);

    if (bloom > 0.004) {
      var c;
      c = L1.ctx; c.globalCompositeOperation = 'copy'; c.globalAlpha = 1;
      c.drawImage(accCv, 0, 0, L1.w, L1.h);
      c = L2.ctx; c.globalCompositeOperation = 'copy'; c.globalAlpha = 1;
      c.drawImage(L1.cv, 0, 0, L2.w, L2.h);
      c = L3.ctx; c.globalCompositeOperation = 'copy'; c.globalAlpha = 1;
      c.drawImage(L2.cv, 0, 0, L3.w, L3.h);
      c = LS.ctx; c.globalCompositeOperation = 'copy'; c.globalAlpha = 1;
      c.drawImage(L2.cv, 0, 0, LS.w, LS.h);

      c = LB.ctx;
      c.globalCompositeOperation = 'copy'; c.globalAlpha = 1;
      c.drawImage(L1.cv, 0, 0, LB.w, LB.h);
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.85; c.drawImage(L2.cv, 0, 0, LB.w, LB.h);
      c.globalAlpha = 0.95; c.drawImage(L3.cv, 0, 0, LB.w, LB.h);
      c.globalAlpha = 0.55; c.drawImage(LS.cv, 0, 0, LB.w, LB.h);
      c.globalAlpha = 1;

      g.globalAlpha = 0.30 * bloom;
      g.drawImage(LB.cv, 0, 0, VW, VH);
      g.globalAlpha = 1;
    }

    g.globalCompositeOperation = 'source-over';
    g.fillStyle = vigGrad;
    g.fillRect(0, 0, VW, VH);
  }

  /* ==================================================================
     UI
     ================================================================== */
  var pcEl = document.getElementById('v-particles');
  var fpsEl = document.getElementById('v-fps');
  var resEl = document.getElementById('v-res');

  function fmt(n) {
    var s = String(n | 0), out = '', c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c % 3 === 0 && i > 0) out = ' ' + out;
    }
    return out;
  }

  var trail = 0.89, paused = false;
  var fpsEMA = 60, lastHud = 0;
  var qBtn = null, lowFrames = 0, autoDrops = 0;

  function bindRange(id, outId, apply, format) {
    var el = document.getElementById(id), out = document.getElementById(outId);
    if (!el) return;
    function upd() {
      var v = parseFloat(el.value);
      apply(v);
      if (out) out.textContent = format(v);
    }
    el.addEventListener('input', upd);
    upd();
  }

  function bindUI() {
    bindRange('s-count', 'o-count', function (v) {
      var nc = clamp(v | 0, 1000, MAXP);
      count = nc;
      updCountGain();
      if (pcEl) pcEl.textContent = fmt(nc);
    }, function (v) { return fmt(v); });

    bindRange('s-flow', 'o-flow', function (v) { flowSpeed = v / 100; },
      function (v) { return (v / 100).toFixed(2); });

    /* ползунок задаёт цель авто-экспозиции: где стоит верхний процентиль */
    bindRange('s-exp', 'o-exp', function (v) { expBias = v / 100; HOT_X = 3.48 * expBias; },
      function (v) { return (v / 100).toFixed(2); });

    bindRange('s-trail', 'o-trail', function (v) { trail = v / 100; },
      function (v) { return (v / 100).toFixed(2); });

    bindRange('s-bloom', 'o-bloom', function (v) { bloom = v / 100; },
      function (v) { return (v / 100).toFixed(2); });

    var bPause = document.getElementById('b-pause');
    var bPal = document.getElementById('b-pal');
    var bOrb = document.getElementById('b-orbit');
    var bQ = document.getElementById('b-quality');
    var bRes = document.getElementById('b-reset');

    if (bPause) bPause.addEventListener('click', function () {
      paused = !paused;
      bPause.textContent = paused ? 'Пуск' : 'Пауза';
      bPause.className = paused ? 'off' : '';
    });
    if (bPal) {
      bPal.textContent = PALETTES[palIndex].name;
      bPal.addEventListener('click', function () {
        buildPalette((palIndex + 1) % PALETTES.length);
        bPal.textContent = PALETTES[palIndex].name;
      });
    }
    if (bOrb) bOrb.addEventListener('click', function () {
      orbit = !orbit;
      bOrb.textContent = 'Облёт: ' + (orbit ? 'вкл' : 'выкл');
      bOrb.className = orbit ? '' : 'off';
    });
    qBtn = bQ;
    if (bQ) {
      bQ.textContent = 'Чёткость: ' + QNAME[qIndex];
      bQ.addEventListener('click', function () {
        qIndex = (qIndex + 1) % QUALITY.length;
        autoDrops = 2;                 // пользователь выбрал сам — не понижаем автоматом
        bQ.textContent = 'Чёткость: ' + QNAME[qIndex];
        resize();
      });
    }
    if (bRes) bRes.addEventListener('click', restart);

    /* мышь / тач */
    var dragging = false, lastX = 0, lastY = 0, pid = -1;
    view.addEventListener('pointerdown', function (e) {
      dragging = true; pid = e.pointerId; lastX = e.clientX; lastY = e.clientY;
      view.classList.add('dragging');
      if (view.setPointerCapture) { try { view.setPointerCapture(pid); } catch (err) { /* нет захвата — не критично */ } }
    });
    view.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      yaw -= (e.clientX - lastX) * 0.0055;
      pitchBase = clamp(pitchBase + (e.clientY - lastY) * 0.0042, -1.32, 1.32);
      lastX = e.clientX; lastY = e.clientY;
    });
    function endDrag() {
      dragging = false;
      view.classList.remove('dragging');
    }
    view.addEventListener('pointerup', endDrag);
    view.addEventListener('pointercancel', endDrag);
    window.addEventListener('blur', endDrag);

    view.addEventListener('wheel', function (e) {
      e.preventDefault();
      camBase = clamp(camBase * (1 + (e.deltaY > 0 ? 0.09 : -0.09)), 1.5, 6.5);
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      var c = e.code;
      if (c === 'Space') { e.preventDefault(); if (bPause) bPause.click(); }
      else if (c === 'KeyH') document.body.classList.toggle('clean');
      else if (c === 'KeyP') { if (bPal) bPal.click(); }
      else if (c === 'KeyO') { if (bOrb) bOrb.click(); }
      else if (c === 'KeyR') restart();
    });

    window.addEventListener('resize', function () { pendingResize = true; });
    if (window.matchMedia) {
      try {
        var mq = window.matchMedia('(resolution: 1dppx)');
        if (mq.addEventListener) mq.addEventListener('change', function () { pendingResize = true; });
      } catch (err) { /* необязательная оптимизация */ }
    }
  }

  function restart() {
    rndSeed = (Date.now() & 0x7FFFFFFF) | 1;
    seedPerm();
    ptime = 0;
    buildFieldFull();
    initParticles(0, MAXP);
    acc.fill(0);
    if (out32) out32.fill(LE ? 0xFF000000 : 0x000000FF);   // composite гасит пиксели лениво
    yaw = 0.55; pitchBase = 0.30; camBase = 2.50; elapsed = 0;
    updateCamera(0);
    warmup(18);
    calibrate();
  }

  function warmup(steps) {
    for (var s = 0; s < steps; s++) {
      ptime += 0.05 * 0.35;
      frameNo++;
      simulate(0.05, 1, false);
    }
  }

  /* Калибровка экспозиции до первого показанного кадра: доводим аккумулятор
     до установившегося состояния и решаем gain одним шагом (конвейер линеен
     по gain). Два круга — второй уточняет по обновившейся площади кадра. */
  function calibrate() {
    var dt = 1 / 60, dc = trail, r, s;
    for (r = 0; r < 2; r++) {
      acc.fill(0);
      for (s = 0; s < 18; s++) {
        frameNo++;
        ptime += dt * 0.35;
        updateCamera(dt);
        simulate(dt, 1, true);
        measureAcc(dc);
      }
      adaptExposure(1);
    }
    adaptHold = 0;
  }

  /* ==================================================================
     Главный цикл
     ================================================================== */
  var lastTime = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!lastTime) lastTime = now;
    var raw = (now - lastTime) / 1000;
    lastTime = now;
    if (!(raw > 0)) raw = 1 / 60;
    if (raw > 0.25) raw = 1 / 60;
    var dt = raw > 0.05 ? 0.05 : raw;

    if (pendingResize) resize();

    fpsEMA += (1 / raw - fpsEMA) * 0.09;
    if (now - lastHud > 260) {
      lastHud = now;
      if (fpsEl) fpsEl.textContent = String(Math.round(fpsEMA));
    }

    /* страховка для слабой машины: держим не ниже ~30 fps */
    if (fpsEMA < 33 && !paused) lowFrames++; else lowFrames = 0;
    if (lowFrames > 150 && qIndex > 0 && autoDrops < 2) {
      autoDrops++; qIndex--; lowFrames = 0;
      if (qBtn) qBtn.textContent = 'Чёткость: ' + QNAME[qIndex];
      resize();
    }

    frameNo++;
    var dtN = dt * 60;
    if (dtN < 0.25) dtN = 0.25; else if (dtN > 3) dtN = 3;

    if (paused) {
      updateCamera(0);
      simulate(0, dtN, true);
    } else {
      ptime += dt * 0.35;
      rollField(ROLL_PER_FRAME);
      updateCamera(dt);
      simulate(dt, dtN, true);
    }

    composite(Math.pow(trail, dtN));
    if (adaptHold > 0) adaptHold--; else adaptExposure(0.05);
    present();
  }

  /* ==================================================================
     Старт
     ================================================================== */
  seedPerm();
  buildFieldFull();
  buildPalette(0);
  buildTone();
  resize();
  bindUI();
  initParticles(0, MAXP);
  updateCamera(0);
  warmup(18);
  calibrate();
  if (pcEl) pcEl.textContent = fmt(count);
  requestAnimationFrame(frame);
})();
