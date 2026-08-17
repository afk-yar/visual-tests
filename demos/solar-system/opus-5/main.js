/* Солнечная система — Claude Opus 5
   Чистый Canvas 2D: кеплеровы орбиты, попиксельное освещение сфер от Солнца,
   кольца Сатурна как объёмный набор колец с тенью планеты, следы, звёздное небо.
   Без WebGL, без библиотек, без внешних ресурсов. */
(function () {
  'use strict';

  /* =========================================================== утилиты === */
  var TAU = Math.PI * 2, DEG = Math.PI / 180;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(e0, e1, x) {
    var t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return t * t * (3 - 2 * t);
  }
  function hexRGB(h) {
    var n = parseInt(h.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /* value-noise 3D — основа всех процедурных поверхностей */
  function hashi(i, j, k) {
    var n = (Math.imul(i | 0, 1597334677) ^ Math.imul(j | 0, 3812015801) ^ Math.imul(k | 0, 2870177453)) | 0;
    n = Math.imul(n ^ (n >>> 15), 2246822519);
    n = Math.imul(n ^ (n >>> 13), 3266489917);
    return ((n ^ (n >>> 16)) >>> 0) * 2.3283064365386963e-10;
  }
  function noise3(x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = x - xi, yf = y - yi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    var c000 = hashi(xi, yi, zi), c100 = hashi(xi + 1, yi, zi);
    var c010 = hashi(xi, yi + 1, zi), c110 = hashi(xi + 1, yi + 1, zi);
    var c001 = hashi(xi, yi, zi + 1), c101 = hashi(xi + 1, yi, zi + 1);
    var c011 = hashi(xi, yi + 1, zi + 1), c111 = hashi(xi + 1, yi + 1, zi + 1);
    var a0 = c000 + (c100 - c000) * u, a1 = c010 + (c110 - c010) * u;
    var b0 = c001 + (c101 - c001) * u, b1 = c011 + (c111 - c011) * u;
    var y0 = a0 + (a1 - a0) * v, y1 = b0 + (b1 - b0) * v;
    return y0 + (y1 - y0) * w;
  }
  function fbm(x, y, z, oct) {
    var s = 0, a = 0.5, f = 1, n = 0;
    for (var i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); n += a; f *= 2.07; a *= 0.5; }
    return s / n;
  }
  function ridge(x, y, z, oct) {
    var s = 0, a = 0.5, f = 1, n = 0;
    for (var i = 0; i < oct; i++) {
      var v = 1 - Math.abs(noise3(x * f, y * f, z * f) * 2 - 1);
      s += a * v * v; n += a; f *= 2.13; a *= 0.5;
    }
    return s / n;
  }

  /* ================================================ процедурные материалы */
  /* каждая функция получает нормаль в системе тела (bx,by,bz — единичная,
     by = ось вращения) и время в секундах; пишет цвет в oR/oG/oB,
     зеркальность в oSpec и собственное свечение в oEmit. */
  var oR = 0, oG = 0, oB = 0, oSpec = 0, oEmit = 0;

  function surfMercury(x, y, z) {
    var base = fbm(x * 3.0 + 5.0, y * 3.0, z * 3.0 + 2.0, 3);
    var cr = ridge(x * 15.0, y * 15.0, z * 15.0, 2);
    var maria = smoothstep(0.46, 0.30, base);
    var v = 0.50 + (base - 0.5) * 0.34 + (cr - 0.45) * 0.30 - maria * 0.14;
    v += smoothstep(0.76, 0.93, ridge(x * 6.0 + 3.3, y * 6.0, z * 6.0, 2)) * 0.13;
    v = clamp(v, 0.10, 1);
    oR = v * 1.03; oG = v * 0.97; oB = v * 0.88; oSpec = 0; oEmit = 0;
  }

  function surfVenus(x, y, z, t) {
    var w = fbm(x * 2.1 + t * 0.006, y * 3.4, z * 2.1, 3) - 0.5;
    var lat = y + w * 0.22;
    var band = Math.sin(lat * 9.0) * 0.5 + Math.sin(lat * 21.0 + 1.7) * 0.26;
    var v = 0.80 + band * 0.085 + (fbm(x * 5.5, y * 5.5, z * 5.5, 2) - 0.5) * 0.09;
    var pole = smoothstep(0.80, 0.99, Math.abs(y)) * 0.10;
    v = clamp(v - pole, 0.3, 1.12);
    oR = v * 1.0; oG = v * 0.90; oB = v * 0.66; oSpec = 0.05; oEmit = 0;
  }

  function surfEarth(x, y, z, t) {
    var cont = fbm(x * 1.85 + 3.10, y * 1.85 - 1.70, z * 1.85 + 0.40, 3);
    var det = fbm(x * 7.0, y * 7.0, z * 7.0, 2);
    var h = cont * 0.80 + det * 0.20;
    var land = h > 0.503;
    var r, g, b, sp = 0, em = 0;
    if (land) {
      var el = smoothstep(0.503, 0.70, h);
      var dry = smoothstep(0.09, 0.30, Math.abs(Math.abs(y) - 0.36)) ;
      dry = (1 - dry) * smoothstep(0.44, 0.58, det);
      r = lerp(0.13, 0.42, el); g = lerp(0.33, 0.36, el); b = lerp(0.11, 0.24, el);
      r = lerp(r, 0.62, dry * 0.85); g = lerp(g, 0.50, dry * 0.85); b = lerp(b, 0.29, dry * 0.85);
      var lights = smoothstep(0.66, 0.86, noise3(x * 26, y * 26, z * 26)) *
                   smoothstep(0.503, 0.545, h) * smoothstep(0.86, 0.55, Math.abs(y));
      em = lights * 0.85;
    } else {
      var dep = smoothstep(0.30, 0.503, h);
      r = lerp(0.012, 0.045, dep); g = lerp(0.052, 0.155, dep); b = lerp(0.145, 0.335, dep);
      sp = 0.9;
    }
    var ice = smoothstep(0.705, 0.855, Math.abs(y) + (det - 0.5) * 0.16);
    r = lerp(r, 0.93, ice); g = lerp(g, 0.95, ice); b = lerp(b, 0.98, ice);
    sp = lerp(sp, 0.35, ice);
    var cl = fbm(x * 2.55 + t * 0.010, y * 2.55 + 4.2, z * 2.55 - t * 0.006, 3);
    var cov = smoothstep(0.50, 0.67, cl) * (0.55 + 0.45 * smoothstep(0.95, 0.35, Math.abs(y)));
    r = lerp(r, 0.96, cov); g = lerp(g, 0.97, cov); b = lerp(b, 1.0, cov);
    sp *= (1 - cov * 0.92); em *= (1 - cov * 0.75);
    oR = r; oG = g; oB = b; oSpec = sp; oEmit = em;
  }

  function surfMars(x, y, z) {
    var alb = fbm(x * 2.3 + 8.1, y * 2.3, z * 2.3 - 3.4, 3);
    var det = fbm(x * 9.0, y * 9.0, z * 9.0, 3);
    var dark = smoothstep(0.56, 0.36, alb);
    var v = 0.62 + (det - 0.5) * 0.24;
    var r = v * (1.02 - dark * 0.26), g = v * (0.55 - dark * 0.12), b = v * (0.33 - dark * 0.06);
    var cap = smoothstep(0.845, 0.945, Math.abs(y) + (det - 0.5) * 0.10);
    if (y < 0) cap *= 0.75;
    r = lerp(r, 0.95, cap); g = lerp(g, 0.96, cap); b = lerp(b, 0.99, cap);
    var dust = smoothstep(0.62, 0.80, fbm(x * 3.4 + 20, y * 3.4, z * 3.4, 2)) * 0.16;
    oR = r + dust; oG = g + dust * 0.85; oB = b + dust * 0.6;
    oSpec = 0; oEmit = 0;
  }

  function surfJupiter(x, y, z, t) {
    var w1 = fbm(x * 2.4 + t * 0.004, y * 5.2, z * 2.4, 3) - 0.5;
    var w2 = fbm(x * 6.4 + 11.2, y * 12.0, z * 6.4, 2) - 0.5;
    var lat = y + w1 * 0.062 + w2 * 0.022;
    var bnd = Math.sin(lat * 16.5) * 0.5 + Math.sin(lat * 8.1 + 1.1) * 0.34 + Math.sin(lat * 30.0 + 2.4) * 0.16;
    var k = clamp(bnd * 0.5 + 0.5, 0, 1);
    var r, g, b;
    if (k < 0.42) { var u = k / 0.42; r = lerp(0.44, 0.72, u); g = lerp(0.29, 0.53, u); b = lerp(0.20, 0.36, u); }
    else { var v = (k - 0.42) / 0.58; r = lerp(0.72, 0.96, v); g = lerp(0.53, 0.90, v); b = lerp(0.36, 0.76, v); }
    var eq = smoothstep(0.22, 0.03, Math.abs(lat));
    r = lerp(r, 0.86, eq * 0.30); g = lerp(g, 0.65, eq * 0.30); b = lerp(b, 0.44, eq * 0.30);
    var pole = smoothstep(0.72, 0.99, Math.abs(y));
    r = lerp(r, 0.44, pole * 0.55); g = lerp(g, 0.40, pole * 0.55); b = lerp(b, 0.40, pole * 0.55);
    /* Большое Красное Пятно */
    var lon = Math.atan2(z, x);
    var dl = lon - 2.15; while (dl > Math.PI) dl -= TAU; while (dl < -Math.PI) dl += TAU;
    var cl = Math.sqrt(clamp(1 - y * y, 0.02, 1));
    var q = (dl * cl / 0.36) * (dl * cl / 0.36) + ((y + 0.372) / 0.088) * ((y + 0.372) / 0.088);
    if (q < 2.2) {
      var s = smoothstep(1.35, 0.25, q);
      var sw = 0.5 + 0.5 * Math.sin(Math.atan2(y + 0.372, dl * cl) * 3 + q * 5.5);
      r = lerp(r, 0.80 + sw * 0.12, s); g = lerp(g, 0.34 + sw * 0.10, s); b = lerp(b, 0.23 + sw * 0.06, s);
    }
    oR = r; oG = g; oB = b; oSpec = 0.05; oEmit = 0;
  }

  function surfSaturn(x, y, z, t) {
    var w1 = fbm(x * 2.2 + t * 0.003, y * 4.6, z * 2.2, 3) - 0.5;
    var lat = y + w1 * 0.05;
    var bnd = Math.sin(lat * 12.0) * 0.5 + Math.sin(lat * 5.5 + 0.6) * 0.32 + Math.sin(lat * 23.0) * 0.14;
    var k = clamp(bnd * 0.5 + 0.5, 0, 1);
    var r = lerp(0.72, 0.98, k), g = lerp(0.60, 0.90, k), b = lerp(0.40, 0.68, k);
    var pole = smoothstep(0.66, 0.98, Math.abs(y));
    r = lerp(r, 0.44, pole * 0.6); g = lerp(g, 0.48, pole * 0.6); b = lerp(b, 0.52, pole * 0.6);
    oR = r; oG = g; oB = b; oSpec = 0.04; oEmit = 0;
  }

  function surfUranus(x, y, z) {
    var lat = y + (fbm(x * 3.0, y * 6.0, z * 3.0, 2) - 0.5) * 0.05;
    var bnd = Math.sin(lat * 9.5) * 0.5 + Math.sin(lat * 19.0 + 1.0) * 0.2;
    var v = 0.94 + bnd * 0.035;
    var cap = smoothstep(0.62, 0.98, Math.abs(y)) * 0.09;
    oR = v * (0.62 + cap); oG = v * (0.85 + cap); oB = v * (0.90 + cap * 0.6);
    oSpec = 0.04; oEmit = 0;
  }

  function surfNeptune(x, y, z, t) {
    var w = fbm(x * 2.6 + t * 0.010, y * 5.4, z * 2.6, 3) - 0.5;
    var lat = y + w * 0.075;
    var bnd = Math.sin(lat * 10.0) * 0.5 + Math.sin(lat * 21.0 + 2.1) * 0.22;
    var v = 0.90 + bnd * 0.07;
    var r = v * 0.24, g = v * 0.40, b = v * 0.92;
    var lon = Math.atan2(z, x);
    var dl = lon + 1.05; while (dl > Math.PI) dl -= TAU; while (dl < -Math.PI) dl += TAU;
    var cl = Math.sqrt(clamp(1 - y * y, 0.02, 1));
    var q = (dl * cl / 0.30) * (dl * cl / 0.30) + ((y + 0.35) / 0.10) * ((y + 0.35) / 0.10);
    var s = smoothstep(1.3, 0.3, q);
    r = lerp(r, 0.10, s); g = lerp(g, 0.16, s); b = lerp(b, 0.46, s);
    var streak = smoothstep(0.72, 0.92, ridge(x * 4.0 + t * 0.02, y * 13.0, z * 4.0, 2)) *
                 smoothstep(0.10, 0.34, Math.abs(y)) * smoothstep(0.85, 0.5, Math.abs(y));
    r = lerp(r, 0.95, streak * 0.8); g = lerp(g, 0.97, streak * 0.8); b = lerp(b, 1.0, streak * 0.8);
    oR = r; oG = g; oB = b; oSpec = 0.06; oEmit = 0;
  }

  /* ---- фабрика «каменных/ледяных» лун -------------------------------- */
  function rocky(cA, cB, opt) {
    var a = hexRGB(cA), b = hexRGB(cB);
    opt = opt || {};
    var mf = opt.maria || 0, cf = opt.crater || 0.3, lf = opt.lines || 0, sc = opt.scale || 3.0;
    return function (x, y, z) {
      var n = fbm(x * sc + 4.3, y * sc, z * sc - 1.9, 3);
      var cr = ridge(x * 16.0, y * 16.0, z * 16.0, 2);
      var k = clamp(n * 0.72 + (cr - 0.45) * cf + 0.18, 0, 1);
      if (mf) k = lerp(k, k * 0.34, smoothstep(0.52, 0.34, n) * mf);
      var r = lerp(a[0], b[0], k), g = lerp(a[1], b[1], k), bb = lerp(a[2], b[2], k);
      if (lf) {
        var ln = smoothstep(0.80, 0.96, ridge(x * 5.2 + 7.7, y * 5.2, z * 5.2, 2));
        r = lerp(r, 0.55, ln * lf); g = lerp(g, 0.30, ln * lf); bb = lerp(bb, 0.22, ln * lf);
      }
      oR = r; oG = g; oB = bb; oSpec = opt.spec || 0; oEmit = 0;
    };
  }

  function surfIo(x, y, z) {
    var n = fbm(x * 3.4 + 2.2, y * 3.4, z * 3.4, 3);
    var d = fbm(x * 9.0, y * 9.0, z * 9.0, 2);
    var k = clamp(n * 0.7 + d * 0.3, 0, 1);
    var r = lerp(0.86, 1.0, k), g = lerp(0.60, 0.88, k), b = lerp(0.16, 0.34, k);
    var spot = smoothstep(0.70, 0.86, ridge(x * 7.0 + 5, y * 7.0, z * 7.0, 2));
    r = lerp(r, 0.45, spot * 0.7); g = lerp(g, 0.20, spot * 0.7); b = lerp(b, 0.12, spot * 0.7);
    oR = r; oG = g; oB = b; oSpec = 0; oEmit = 0;
  }

  function surfTitan(x, y, z, t) {
    var n = fbm(x * 2.2 + t * 0.004, y * 3.6, z * 2.2, 3);
    var v = 0.86 + (n - 0.5) * 0.14;
    oR = v * 1.0; oG = v * 0.68; oB = v * 0.30; oSpec = 0; oEmit = 0;
  }

  /* ============================================== Солнце (эмиссионное) === */
  function sunSurface(x, y, z, t) {
    var gran = fbm(x * 13.0 + t * 0.05, y * 13.0, z * 13.0 - t * 0.04, 3);
    var sup = fbm(x * 4.2 - t * 0.02, y * 4.2, z * 4.2, 2);
    var v = 0.80 + (gran - 0.5) * 0.42 + (sup - 0.5) * 0.30;
    var spot = smoothstep(0.68, 0.80, fbm(x * 2.6 + 31.0, y * 2.6, z * 2.6 + t * 0.006, 3));
    v -= spot * 0.55;
    var fac = smoothstep(0.72, 0.90, ridge(x * 8.0, y * 8.0, z * 8.0, 2)) * 0.22;
    return clamp(v + fac, 0.06, 1.6);
  }

  /* ================================================= параметры системы === */
  /* Радиусы орбит сжаты логарифмически: степенной закон слишком стягивает
     внутреннюю четвёрку к Солнцу — Меркурий..Марс сливались с его диском.
     log-закон разводит внутренние орбиты и поджимает внешние. */
  var ORB_K = 2.7313, ORB_S = 0.18;
  /* Размеры сжаты сильнее (показатель 0.33), чтобы Земля и Марс читались
     дисками с терминатором, а не точками. */
  var SIZE_K = 0.282, SIZE_P = 0.33;

  function orbScale(aAU) { return ORB_K * Math.log(1 + aAU / ORB_S); }
  function sizeScale(rKm) { return SIZE_K * Math.pow(rKm / 6371, SIZE_P); }

  var SUN = {
    name: 'Солнце', R: 696000, dispR: sizeScale(696000) * 0.60,
    wx: 0, wy: 0, wz: 0, isSun: true
  };

  var PLANETS = [
    { id: 'mercury', name: 'Меркурий', a: 0.3871, e: 0.2056, inc: 7.005, node: 48.331, peri: 77.456, M0: 174.79,
      T: 0.2408, R: 2440, tilt: 0.03, axn: 20, rot: 58.65, col: '#9c9287', surf: surfMercury },
    { id: 'venus', name: 'Венера', a: 0.7233, e: 0.0068, inc: 3.395, node: 76.680, peri: 131.53, M0: 50.38,
      T: 0.6152, R: 6052, tilt: 177.4, axn: 70, rot: -243.02, col: '#e6cd9a', surf: surfVenus,
      atmo: '#ffcf80', atmoK: 1.35 },
    { id: 'earth', name: 'Земля', a: 1.0000, e: 0.0167, inc: 0.0, node: -11.26, peri: 102.95, M0: -2.49,
      T: 1.0, R: 6371, tilt: 23.44, axn: 0, rot: 0.9973, col: '#4b7fc4', surf: surfEarth,
      atmo: '#79b6ff', atmoK: 1.15, specCol: '#dfeaff', specPow: 42 },
    { id: 'mars', name: 'Марс', a: 1.5237, e: 0.0934, inc: 1.850, node: 49.558, peri: 336.06, M0: 19.39,
      T: 1.8808, R: 3390, tilt: 25.19, axn: 130, rot: 1.0260, col: '#c05f37', surf: surfMars,
      atmo: '#ff9a63', atmoK: 0.55 },
    { id: 'jupiter', name: 'Юпитер', a: 5.2026, e: 0.0484, inc: 1.304, node: 100.49, peri: 14.73, M0: 19.67,
      T: 11.862, R: 69911, tilt: 3.13, axn: 250, rot: 0.4135, col: '#d5a875', surf: surfJupiter,
      atmo: '#ffd9a0', atmoK: 0.7 },
    { id: 'saturn', name: 'Сатурн', a: 9.5549, e: 0.0539, inc: 2.486, node: 113.66, peri: 92.43, M0: -42.49,
      T: 29.457, R: 58232, tilt: 26.73, axn: 34, rot: 0.4440, col: '#dcc191', surf: surfSaturn,
      atmo: '#ffe6ae', atmoK: 0.6, rings: { kind: 'saturn', inner: 1.11, outer: 2.345 } },
    { id: 'uranus', name: 'Уран', a: 19.218, e: 0.0473, inc: 0.773, node: 74.006, peri: 170.96, M0: 142.27,
      T: 84.011, R: 25362, tilt: 97.77, axn: 168, rot: -0.7183, col: '#9fdbe0', surf: surfUranus,
      atmo: '#a8ecf5', atmoK: 0.9, rings: { kind: 'uranus', inner: 1.55, outer: 2.10 } },
    { id: 'neptune', name: 'Нептун', a: 30.110, e: 0.0086, inc: 1.770, node: 131.78, peri: 44.97, M0: 259.91,
      T: 164.79, R: 24622, tilt: 28.32, axn: 300, rot: 0.6713, col: '#4a6fd6', surf: surfNeptune,
      atmo: '#7d9dff', atmoK: 0.95 }
  ];

  /* d — радиус орбиты луны в радиусах планеты (разнесены так, чтобы луна
     читалась отдельным диском, а не сливалась с лимбом планеты) */
  var MOONS = {
    earth: [{ name: 'Луна', d: 4.05, e: 0.055, inc: 16, T: 27.32, R: 1737, col: '#a9a49c',
              surf: rocky('#57565a', '#c8c3ba', { maria: 0.85, crater: 0.34, scale: 2.6 }) }],
    jupiter: [
      { name: 'Ио', d: 1.95, e: 0.004, inc: 0.5, T: 1.769, R: 1821, col: '#e0c04a', surf: surfIo },
      { name: 'Европа', d: 2.55, e: 0.009, inc: 0.7, T: 3.551, R: 1561, col: '#d8cfbc',
        surf: rocky('#b9ae9a', '#efe9dc', { crater: 0.14, lines: 0.55, scale: 2.4, spec: 0.3 }) },
      { name: 'Ганимед', d: 3.30, e: 0.001, inc: 0.3, T: 7.155, R: 2634, col: '#9d9384',
        surf: rocky('#6d6558', '#b6ab99', { maria: 0.4, crater: 0.34, lines: 0.18, scale: 3.2 }) },
      { name: 'Каллисто', d: 4.35, e: 0.007, inc: 0.4, T: 16.689, R: 2410, col: '#6e6559',
        surf: rocky('#4a443c', '#8f8577', { crater: 0.55, scale: 3.6 }) }
    ],
    saturn: [
      { name: 'Рея', d: 3.10, e: 0.001, inc: 0.4, T: 4.518, R: 764, col: '#c6c2ba',
        surf: rocky('#8e8a84', '#e3ded4', { crater: 0.5, scale: 3.4 }) },
      { name: 'Титан', d: 4.70, e: 0.029, inc: 0.4, T: 15.945, R: 2575, col: '#d09040',
        surf: surfTitan, atmo: '#ffb055', atmoK: 1.5 }
    ],
    neptune: [{ name: 'Тритон', d: 3.60, e: 0.000, inc: 157, T: -5.877, R: 1353, col: '#cfc0bb',
                surf: rocky('#9a8b86', '#e8ddd8', { crater: 0.22, scale: 3.0 }) }]
  };

  /* ------------------------------------------------ подготовка орбит --- */
  function prepOrbit(o, aWorld) {
    o.aw = aWorld;
    o.bw = aWorld * Math.sqrt(1 - o.e * o.e);
    var w = (o.peri - o.node) * DEG;
    o.cw = Math.cos(w); o.sw = Math.sin(w);
    o.cn = Math.cos(o.node * DEG); o.sn = Math.sin(o.node * DEG);
    o.ci = Math.cos(o.inc * DEG); o.si = Math.sin(o.inc * DEG);
    o.m0 = o.M0 * DEG;
    o.rate = TAU / Math.pow(Math.abs(o.T), 0.52) * (o.T < 0 ? -1 : 1);
  }

  var pos = { x: 0, y: 0, z: 0 };
  function orbitPos(o, M, out) {
    var e = o.e, E = M + e * Math.sin(M);
    for (var i = 0; i < 4; i++) {
      var d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= d; if (Math.abs(d) < 1e-9) break;
    }
    var xp = o.aw * (Math.cos(E) - e), yp = o.bw * Math.sin(E);
    var xr = xp * o.cw - yp * o.sw, yr = xp * o.sw + yp * o.cw;
    out.x = xr * o.cn - yr * o.ci * o.sn;
    out.z = xr * o.sn + yr * o.ci * o.cn;
    out.y = yr * o.si;
    return out;
  }

  var bodies = [];      /* планеты + их луны, готовые к рендеру */
  (function initBodies() {
    for (var i = 0; i < PLANETS.length; i++) {
      var p = PLANETS[i];
      prepOrbit(p, orbScale(p.a));
      p.baseR = sizeScale(p.R);
      p.spinRate = TAU / (0.50 * Math.pow(Math.abs(p.rot), 0.55)) * (p.rot < 0 ? -1 : 1);
      p.rgb = hexRGB(p.col);
      p.atmoRGB = p.atmo ? hexRGB(p.atmo) : null;
      var tl = p.tilt * DEG, an = p.axn * DEG;
      p.axX = Math.sin(tl) * Math.cos(an); p.axY = Math.cos(tl); p.axZ = Math.sin(tl) * Math.sin(an);
      var hx = Math.abs(p.axY) < 0.9 ? 0 : 1, hy = Math.abs(p.axY) < 0.9 ? 1 : 0;
      var ex = hy * p.axZ - 0 * p.axY, ey = 0 * p.axX - hx * p.axZ, ez = hx * p.axY - hy * p.axX;
      var el = Math.hypot(ex, ey, ez) || 1;
      p.e0x = ex / el; p.e0y = ey / el; p.e0z = ez / el;
      p.e1x = p.axY * p.e0z - p.axZ * p.e0y;
      p.e1y = p.axZ * p.e0x - p.axX * p.e0z;
      p.e1z = p.axX * p.e0y - p.axY * p.e0x;
      p.moons = [];
      var ms = MOONS[p.id];
      if (ms) for (var j = 0; j < ms.length; j++) {
        var m = ms[j];
        m.parent = p;
        m.baseR = sizeScale(m.R);
        m.rate = TAU / (0.115 * Math.pow(Math.abs(m.T), 0.55)) * (m.T < 0 ? -1 : 1);
        m.ph = (j * 2.3 + i) % TAU;
        m.rgb = hexRGB(m.col);
        m.atmoRGB = m.atmo ? hexRGB(m.atmo) : null;
        m.ci = Math.cos(m.inc * DEG); m.si = Math.sin(m.inc * DEG);
        m.isMoon = true;
        p.moons.push(m);
      }
      bodies.push(p);
    }
  })();

  /* --------------------------------------------- пояса малых тел ------- */
  function makeBelt(count, aMin, aMax, eMax, incMax, gaps) {
    var n = count, A = new Float32Array(n), E = new Float32Array(n), PH = new Float32Array(n),
        RT = new Float32Array(n), CN = new Float32Array(n), SN = new Float32Array(n),
        CI = new Float32Array(n), SI = new Float32Array(n), SZ = new Float32Array(n), TN = new Float32Array(n);
    var s = 12345;
    function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    var k = 0, guard = 0;
    while (k < n && guard++ < n * 40) {
      var au = aMin + rnd() * (aMax - aMin);
      if (gaps) {
        var bad = false;
        for (var g = 0; g < gaps.length; g++) if (Math.abs(au - gaps[g]) < 0.028 + rnd() * 0.020) bad = true;
        if (bad) continue;
      }
      A[k] = orbScale(au);
      E[k] = rnd() * eMax;
      PH[k] = rnd() * TAU;
      RT[k] = TAU / Math.pow(au, 0.78);
      var nd = rnd() * TAU, ic = (rnd() - 0.5) * 2 * incMax * DEG;
      CN[k] = Math.cos(nd); SN[k] = Math.sin(nd); CI[k] = Math.cos(ic); SI[k] = Math.sin(ic);
      SZ[k] = 0.55 + rnd() * rnd() * 1.5;
      TN[k] = rnd();
      k++;
    }
    return { n: k, A: A, E: E, PH: PH, RT: RT, CN: CN, SN: SN, CI: CI, SI: SI, SZ: SZ, TN: TN };
  }
  var belt = makeBelt(860, 2.06, 3.42, 0.19, 13, [2.502, 2.825, 2.958, 3.278]);
  var kuiper = makeBelt(430, 30.5, 49.0, 0.24, 24, null);

  /* -------------------------------------------------- звёздное небо ---- */
  var stars = (function () {
    var n = 1150, dx = new Float32Array(n), dy = new Float32Array(n), dz = new Float32Array(n),
        mag = new Float32Array(n), col = new Int8Array(n), ph = new Float32Array(n);
    var s = 987654321;
    function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    /* галактический пояс: наклонён к эклиптике */
    var gt = 62 * DEG, cg = Math.cos(gt), sg = Math.sin(gt);
    for (var i = 0; i < n; i++) {
      var x, y, z;
      if (i % 5 < 2) {                       /* сгущение к млечному пути */
        var lon = rnd() * TAU;
        var lat = (rnd() + rnd() + rnd() - 1.5) * 0.16;
        var cx0 = Math.cos(lat) * Math.cos(lon), cy0 = Math.sin(lat), cz0 = Math.cos(lat) * Math.sin(lon);
        x = cx0; y = cy0 * cg - cz0 * sg; z = cy0 * sg + cz0 * cg;
      } else {
        var u = rnd() * 2 - 1, th = rnd() * TAU, r = Math.sqrt(1 - u * u);
        x = r * Math.cos(th); y = u; z = r * Math.sin(th);
      }
      dx[i] = x; dy[i] = y; dz[i] = z;
      var m = rnd();
      mag[i] = 0.16 + m * m * m * 1.05;
      col[i] = (rnd() * 5) | 0;
      ph[i] = rnd() * TAU;
    }
    return { n: n, dx: dx, dy: dy, dz: dz, mag: mag, col: col, ph: ph,
             pal: ['#cfe0ff', '#eaf1ff', '#ffffff', '#ffeccf', '#ffd2ab'] };
  })();

  var milky = (function () {
    var n = 260, dx = new Float32Array(n), dy = new Float32Array(n), dz = new Float32Array(n),
        sz = new Float32Array(n), al = new Float32Array(n), tn = new Int8Array(n);
    var s = 24680135;
    function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    var gt = 62 * DEG, cg = Math.cos(gt), sg = Math.sin(gt);
    for (var i = 0; i < n; i++) {
      var lon = rnd() * TAU;
      var lat = (rnd() + rnd() - 1) * 0.13;
      var cx0 = Math.cos(lat) * Math.cos(lon), cy0 = Math.sin(lat), cz0 = Math.cos(lat) * Math.sin(lon);
      dx[i] = cx0; dy[i] = cy0 * cg - cz0 * sg; dz[i] = cy0 * sg + cz0 * cg;
      sz[i] = 0.09 + rnd() * 0.20;
      var core = Math.max(0, 1 - Math.abs(((lon / TAU) * 2 - 1)));
      al[i] = (0.035 + rnd() * 0.055) * (0.45 + 0.9 * core);
      tn[i] = (rnd() * 3) | 0;
    }
    return { n: n, dx: dx, dy: dy, dz: dz, sz: sz, al: al, tn: tn };
  })();

  /* ================================================== холст и контекст == */
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d', { alpha: false });
  var W = 1, H = 1, dpr = 1, cxs = 0, cys = 0, focal = 800;

  var spriteCv = document.createElement('canvas');
  var spriteCtx = spriteCv.getContext('2d');
  var spriteImg = null, spriteW = 0, spriteH = 0, spriteData = null;

  /* таблица гаммы: убирает 3 sqrt на каждый затенённый пиксель */
  var GAMMA = new Uint8Array(1032);
  (function () { for (var i = 0; i < 1032; i++) GAMMA[i] = Math.min(255, Math.round(Math.sqrt(Math.min(1, i / 1024)) * 255)); })();

  function ensureSprite(w, h) {
    if (w <= spriteW && h <= spriteH) return;
    spriteW = Math.min(1024, Math.max(spriteW, ((w + 63) >> 6) << 6));
    spriteH = Math.min(1024, Math.max(spriteH, ((h + 63) >> 6) << 6));
    spriteCv.width = spriteW; spriteCv.height = spriteH;
    spriteImg = spriteCtx.createImageData(spriteW, spriteH);
    spriteData = spriteImg.data;
  }
  ensureSprite(128, 128);

  var bloomA = document.createElement('canvas'), bcA = bloomA.getContext('2d');
  var bloomB = document.createElement('canvas'), bcB = bloomB.getContext('2d');
  var hasFilter = (function () {
    try { var c = document.createElement('canvas').getContext('2d'); c.filter = 'blur(2px)'; return c.filter === 'blur(2px)'; }
    catch (e) { return false; }
  })();
  var vignette = null;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = canvas.clientWidth || window.innerWidth || 1;
    var ch = canvas.clientHeight || window.innerHeight || 1;
    W = Math.max(1, Math.round(cw * dpr));
    H = Math.max(1, Math.round(ch * dpr));
    canvas.width = W; canvas.height = H;
    cxs = W * 0.5; cys = H * 0.5;
    bloomA.width = bloomB.width = Math.max(1, W >> 2);
    bloomA.height = bloomB.height = Math.max(1, H >> 2);
    var g = ctx.createRadialGradient(cxs, cys * 1.02, Math.min(W, H) * 0.30, cxs, cys, Math.max(W, H) * 0.76);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.62, 'rgba(0,0,0,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0.62)');
    vignette = g;
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) { try { new ResizeObserver(resize).observe(canvas); } catch (e) {} }
  resize();

  /* ------------------------------------------------------- спрайты ----- */
  var glowCache = {};
  function glowSprite(color, power) {
    var key = color + '|' + power;
    if (glowCache[key]) return glowCache[key];
    var S = 128, c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d');
    var img = g.createImageData(S, S), d = img.data, rgb = hexRGB(color);
    var R = S * 0.5;
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var ddx = (x + 0.5 - R) / R, ddy = (y + 0.5 - R) / R;
      var t = 1 - Math.sqrt(ddx * ddx + ddy * ddy);
      var a = t > 0 ? Math.pow(t, power) : 0;
      var o = (y * S + x) * 4;
      d[o] = rgb[0] * 255; d[o + 1] = rgb[1] * 255; d[o + 2] = rgb[2] * 255; d[o + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
    glowCache[key] = c;
    return c;
  }

  var coronaSprite = (function () {
    var S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data, R = S * 0.5;
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var ddx = (x + 0.5 - R) / R, ddy = (y + 0.5 - R) / R;
      var r = Math.sqrt(ddx * ddx + ddy * ddy), o = (y * S + x) * 4;
      if (r >= 1) { d[o + 3] = 0; continue; }
      var th = Math.atan2(ddy, ddx);
      var ray = 0.42 + 0.58 * fbm(Math.cos(th) * 3.4, Math.sin(th) * 3.4, r * 1.3, 3);
      var a = Math.pow(1 - r, 2.6) * ray;
      d[o] = 255; d[o + 1] = 214; d[o + 2] = 150; d[o + 3] = clamp(a, 0, 1) * 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  })();

  /* ================================================== камера/проекция === */
  var cam = { az: 0.86, el: 28 * DEG, dist: 24.0, fov: 1.02, breath: 0 };
  var eyeX = 0, eyeY = 0, eyeZ = 0;
  var cRx = 1, cRy = 0, cRz = 0, cUx = 0, cUy = 1, cUz = 0, cFx = 0, cFy = 0, cFz = -1;

  function updateCamera() {
    var el = clamp(cam.el + cam.breath, -1.45, 1.45);
    var ce = Math.cos(el), se = Math.sin(el);
    eyeX = cam.dist * ce * Math.sin(cam.az);
    eyeY = cam.dist * se;
    eyeZ = cam.dist * ce * Math.cos(cam.az);
    var l = Math.hypot(eyeX, eyeY, eyeZ) || 1;
    cFx = -eyeX / l; cFy = -eyeY / l; cFz = -eyeZ / l;
    var rx = -cFz, ry = 0, rz = cFx;            /* F × (0,1,0) */
    var rl = Math.hypot(rx, ry, rz) || 1;
    cRx = rx / rl; cRy = ry / rl; cRz = rz / rl;
    cUx = cRy * cFz - cRz * cFy;
    cUy = cRz * cFx - cRx * cFz;
    cUz = cRx * cFy - cRy * cFx;
    focal = (H * 0.5) / Math.tan(cam.fov * 0.5);
  }

  var pX = 0, pY = 0, pZ = 0, pS = 0, pOK = false;
  function project(x, y, z) {
    var dx = x - eyeX, dy = y - eyeY, dz = z - eyeZ;
    var vz = dx * cFx + dy * cFy + dz * cFz;
    if (vz <= 0.02) { pOK = false; pZ = vz; return false; }
    var vx = dx * cRx + dy * cRy + dz * cRz;
    var vy = dx * cUx + dy * cUy + dz * cUz;
    pS = focal / vz;
    pX = cxs + vx * pS; pY = cys - vy * pS; pZ = vz; pOK = true;
    return true;
  }
  function projectDir(x, y, z) {          /* точка на бесконечности */
    var vz = x * cFx + y * cFy + z * cFz;
    if (vz <= 0.05) { pOK = false; return false; }
    var vx = x * cRx + y * cRy + z * cRz;
    var vy = x * cUx + y * cUy + z * cUz;
    pX = cxs + vx * focal / vz; pY = cys - vy * focal / vz; pZ = vz; pOK = true;
    return true;
  }

  /* ======================================================= кольца ======= */
  var RMAX = 9000;
  var rPX = new Float32Array(RMAX), rPY = new Float32Array(RMAX),
      rPZ = new Float32Array(RMAX), rSH = new Float32Array(RMAX);
  var rRad = new Float32Array(64);
  var rN = 0, rA = 0, rLit = 1, rKind = '';

  var rgR = 0.85, rgG = 0.79, rgB = 0.66;
  function ringOpacity(kind, x) {
    var op = 0, r = 0.86, g = 0.79, b = 0.66;
    if (kind === 'saturn') {
      if (x < 1.235) { op = 0.05 * smoothstep(1.10, 1.20, x); r = 0.70; g = 0.66; b = 0.58; }
      else if (x < 1.526) { op = 0.15 + 0.12 * smoothstep(1.24, 1.52, x); r = 0.60; g = 0.56; b = 0.49; }
      else if (x < 1.950) { var u = (x - 1.526) / 0.424;
                            op = 0.74 + 0.20 * Math.sin(u * 3.1 + 0.4); r = 0.93; g = 0.86; b = 0.72; }
      else if (x < 2.025) { op = 0.05; r = 0.55; g = 0.52; b = 0.46; }
      else if (x < 2.214) { op = 0.44; r = 0.83; g = 0.77; b = 0.63; }
      else if (x < 2.226) { op = 0.03; r = 0.6; g = 0.57; b = 0.5; }
      else if (x < 2.272) { op = 0.40; r = 0.81; g = 0.75; b = 0.62; }
      else if (x < 2.318) { op = 0.015; r = 0.6; g = 0.57; b = 0.5; }
      else { op = 0.24; r = 0.92; g = 0.88; b = 0.80; }
      op *= 0.70 + 0.60 * noise3(x * 230, 3.7, 1.9);
      op *= 0.86 + 0.28 * noise3(x * 41, 1.3, 5.1);
    } else {
      var c = [1.641, 1.700, 1.752, 1.786, 1.834, 1.909, 2.006];
      var amp = [0.30, 0.24, 0.26, 0.22, 0.30, 0.34, 0.66];
      for (var i = 0; i < c.length; i++) {
        var dd = (x - c[i]) / 0.0135;
        op += amp[i] * Math.exp(-dd * dd);
      }
      r = 0.40; g = 0.41; b = 0.44;
    }
    rgR = r; rgG = g; rgB = b;
    return clamp(op, 0, 1);
  }

  function prepareRings(b, prad, planetDepth, scale) {
    var rd = b.rings;
    var spanPx = (rd.outer - rd.inner) * prad * scale;
    var majorPx = rd.outer * prad * scale * 2;
    if (majorPx < 5) { rN = 0; return; }
    var N = clamp(Math.round(spanPx / 2.2 * quality), 5, 54);
    var NA = clamp(Math.round(majorPx / 3.4 * quality), 36, 132);
    if ((N + 1) * (NA + 1) > RMAX) { NA = Math.floor(RMAX / (N + 1)) - 1; }
    rN = N + 1; rA = NA + 1; rKind = rd.kind;

    var lx = -b.wx, ly = -b.wy, lz = -b.wz;
    var ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
    var vdx = eyeX - b.wx, vdy = eyeY - b.wy, vdz = eyeZ - b.wz;
    var vl = Math.hypot(vdx, vdy, vdz) || 1; vdx /= vl; vdy /= vl; vdz /= vl;
    var cosSun = b.axX * lx + b.axY * ly + b.axZ * lz;
    var cosView = b.axX * vdx + b.axY * vdy + b.axZ * vdz;
    rLit = (cosSun * cosView > 0) ? (0.62 + 0.55 * Math.abs(cosSun)) : -(0.13 + 0.38 * Math.abs(cosSun));

    var cosStep = Math.cos(TAU / NA), sinStep = Math.sin(TAU / NA);
    for (var i = 0; i <= N; i++) {
      var rr = (rd.inner + (rd.outer - rd.inner) * (i / N)) * prad;
      rRad[i] = rr / prad;
      var ca = 1, sa = 0, base = i * rA;
      for (var j = 0; j <= NA; j++) {
        var ux = b.e0x * ca + b.e1x * sa, uy = b.e0y * ca + b.e1y * sa, uz = b.e0z * ca + b.e1z * sa;
        var wx = ux * rr, wy = uy * rr, wz = uz * rr;
        var k = base + j;
        if (project(b.wx + wx, b.wy + wy, b.wz + wz)) {
          rPX[k] = pX; rPY[k] = pY; rPZ[k] = pZ;
        } else { rPX[k] = 0; rPY[k] = 0; rPZ[k] = -1; }
        var pr = wx * lx + wy * ly + wz * lz;
        var sh = 0;
        if (pr < 0) {
          var qx = wx - pr * lx, qy = wy - pr * ly, qz = wz - pr * lz;
          sh = smoothstep(prad * 1.10, prad * 0.86, Math.hypot(qx, qy, qz));
        }
        rSH[k] = 1 - sh * 0.94;
        var nca = ca * cosStep - sa * sinStep;
        sa = ca * sinStep + sa * cosStep; ca = nca;
      }
    }
  }

  function drawRingPass(near, planetDepth) {
    if (!rN) return;
    var NA = rA - 1;
    ctx.globalCompositeOperation = 'source-over';
    for (var bi = 0; bi < rN - 1; bi++) {
      var xm = (rRad[bi] + rRad[bi + 1]) * 0.5;
      var op = ringOpacity(rKind, xm);
      if (op < 0.004) continue;
      var cr, cg, cb;
      if (rLit > 0) { cr = rgR * rLit; cg = rgG * rLit; cb = rgB * rLit; }
      else { var m = -rLit * (0.22 + 0.62 * (1 - op)); cr = rgR * m; cg = rgG * m * 0.97; cb = rgB * m * 0.94; }
      var i0 = bi * rA, i1 = (bi + 1) * rA;
      var runStart = -1, runShade = -1;
      for (var j = 0; j <= NA; j++) {
        var ok = j < NA;
        var side = 0, bucket = -1;
        if (ok) {
          var zA = rPZ[i0 + j], zB = rPZ[i0 + j + 1], zC = rPZ[i1 + j], zD = rPZ[i1 + j + 1];
          if (zA < 0 || zB < 0 || zC < 0 || zD < 0) ok = false;
          else {
            var zm = (zA + zB + zC + zD) * 0.25;
            side = zm < planetDepth ? 1 : 0;
            if (side !== (near ? 1 : 0)) ok = false;
            else bucket = Math.round((rSH[i0 + j] + rSH[i1 + j]) * 0.5 * 5);
          }
        }
        if (ok && runStart < 0) { runStart = j; runShade = bucket; }
        else if (ok && bucket !== runShade) { flushRun(i0, i1, runStart, j, runShade, cr, cg, cb, op); runStart = j; runShade = bucket; }
        else if (!ok && runStart >= 0) { flushRun(i0, i1, runStart, j, runShade, cr, cg, cb, op); runStart = -1; }
      }
      if (runStart >= 0) flushRun(i0, i1, runStart, NA, runShade, cr, cg, cb, op);
    }
  }

  function flushRun(i0, i1, j0, j1, bucket, cr, cg, cb, op) {
    if (j1 <= j0) return;
    var sh = bucket / 5;
    var a = op * (0.10 + 0.90 * sh);
    if (a < 0.004) return;
    ctx.beginPath();
    ctx.moveTo(rPX[i1 + j0], rPY[i1 + j0]);
    for (var j = j0 + 1; j <= j1; j++) ctx.lineTo(rPX[i1 + j], rPY[i1 + j]);
    for (var k = j1; k >= j0; k--) ctx.lineTo(rPX[i0 + k], rPY[i0 + k]);
    ctx.closePath();
    var m = 0.22 + 0.78 * sh;
    ctx.fillStyle = 'rgba(' + (clamp(cr * m, 0, 1) * 255 | 0) + ',' + (clamp(cg * m, 0, 1) * 255 | 0) +
                    ',' + (clamp(cb * m, 0, 1) * 255 | 0) + ',' + a.toFixed(3) + ')';
    ctx.fill();
  }

  /* Бюджет затеняемых пикселей. При сильном приближении экран занимает не
     одна планета, а сразу десяток тел, поэтому бюджет кадровый: он делится
     между крупными телами, и каждое шейдится через шаг с растяжением
     спрайта. На штатных масштабах шаг всегда 1 — полное качество. */
  var shadeBudget = 120000;
  function shadeStep(w, h) {
    var need = w * h;
    if (need <= shadeBudget) return 1;
    return Math.min(20, Math.max(1, Math.ceil(Math.sqrt(need / shadeBudget))));
  }

  /* ============================================ рендер освещённой сферы = */
  function renderSphere(o, sx, sy, R, lightMul, tsec) {
    var lx = -o.wx, ly = -o.wy, lz = -o.wz;
    var ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
    var lr = lx * cRx + ly * cRy + lz * cRz;
    var lu = lx * cUx + ly * cUy + lz * cUz;
    var lf = -(lx * cFx + ly * cFy + lz * cFz);

    /* половинный вектор для бликов */
    var hx = lx - cFx, hy = ly - cFy, hz = lz - cFz;
    var hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
    var Hx = hx * cRx + hy * cRy + hz * cRz;
    var Hy = hx * cUx + hy * cUy + hz * cUz;
    var Hz = -(hx * cFx + hy * cFy + hz * cFz);

    var par = o.isMoon ? o.parent : o;
    var spin = o.isMoon ? (o.ang + Math.PI) : o.spin;
    var cs = Math.cos(spin), sn = Math.sin(spin);
    var bxX = par.e0x * cs + par.e1x * sn, bxY = par.e0y * cs + par.e1y * sn, bxZ = par.e0z * cs + par.e1z * sn;
    var bzX = -par.e0x * sn + par.e1x * cs, bzY = -par.e0y * sn + par.e1y * cs, bzZ = -par.e0z * sn + par.e1z * cs;
    var byX = par.axX, byY = par.axY, byZ = par.axZ;

    var m00 = cRx * bxX + cRy * bxY + cRz * bxZ,
        m01 = cUx * bxX + cUy * bxY + cUz * bxZ,
        m02 = -(cFx * bxX + cFy * bxY + cFz * bxZ);
    var m10 = cRx * byX + cRy * byY + cRz * byZ,
        m11 = cUx * byX + cUy * byY + cUz * byZ,
        m12 = -(cFx * byX + cFy * byY + cFz * byZ);
    var m20 = cRx * bzX + cRy * bzY + cRz * bzZ,
        m21 = cUx * bzX + cUy * bzY + cUz * bzZ,
        m22 = -(cFx * bzX + cFy * bzY + cFz * bzZ);

    var ringOn = !!o.rings, aVx = 0, aVy = 0, aVz = 0, rin = 0, rout = 0;
    if (ringOn) {
      aVx = byX * cRx + byY * cRy + byZ * cRz;
      aVy = byX * cUx + byY * cUy + byZ * cUz;
      aVz = -(byX * cFx + byY * cFy + byZ * cFz);
      rin = o.rings.inner; rout = o.rings.outer;
    }

    var amb = o.rgb, aR = amb[0] * 0.030 + 0.006, aG = amb[1] * 0.030 + 0.008, aB = amb[2] * 0.030 + 0.014;
    var atm = o.atmoRGB, atmK = o.atmoK || 0;
    var spCol = o.specCol ? hexRGB(o.specCol) : [1, 1, 1];
    var spPow = o.specPow || 26;
    var surf = o.surf;

    var pad = 1.0;
    var x0 = Math.max(0, Math.floor(sx - R - pad)), x1 = Math.min(W, Math.ceil(sx + R + pad));
    var y0 = Math.max(0, Math.floor(sy - R - pad)), y1 = Math.min(H, Math.ceil(sy + R + pad));
    var w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    var step = shadeStep(w, h);
    var sw = Math.ceil(w / step), sh2 = Math.ceil(h / step);
    ensureSprite(sw, sh2);
    var data = spriteData, stride = spriteW * 4;
    var invR = 1 / R, dmax = 1 + 0.5 * invR, dmax2 = dmax * dmax;
    var deep = o.isMoon ? 0.025 : (surf === surfEarth ? -1 : 0.025);

    for (var jj = 0; jj < sh2; jj++) {
      var py = y0 + (jj + 0.5) * step;
      var ny = (sy - py) * invR, ny2 = ny * ny;
      var row = jj * stride;
      for (var ii = 0; ii < sw; ii++) {
        var px = x0 + (ii + 0.5) * step;
        var nx = (px - sx) * invR;
        var d2 = nx * nx + ny2;
        var oo = row + ii * 4;
        if (d2 > dmax2) { data[oo + 3] = 0; continue; }
        var dd = Math.sqrt(d2);
        var cov = dmax - dd; cov = cov * R; cov = cov > 1 ? 1 : (cov < 0 ? 0 : cov);
        var nz = 1 - d2; nz = nz > 0 ? Math.sqrt(nz) : 0;

        var ndl = nx * lr + ny * lu + nz * lf;
        var diff = ndl > 0 ? ndl : 0;
        diff = diff * diff * (3 - 2 * diff);            /* мягкий терминатор */
        diff *= lightMul;

        var r, g, b;
        if (diff <= deep) {
          r = aR; g = aG; b = aB;
        } else {
          var bx = nx * m00 + ny * m01 + nz * m02;
          var by = nx * m10 + ny * m11 + nz * m12;
          var bz = nx * m20 + ny * m21 + nz * m22;
          surf(bx, by, bz, tsec);
          var sc = diff;
          if (ringOn) {
            var den = lr * aVx + lu * aVy + lf * aVz;
            if (Math.abs(den) > 1e-4) {
              var tt = -(nx * aVx + ny * aVy + nz * aVz) / den;
              if (tt > 0) {
                var qx = nx + tt * lr, qy = ny + tt * lu, qz = nz + tt * lf;
                var rh = Math.sqrt(qx * qx + qy * qy + qz * qz);
                if (rh > rin && rh < rout) sc *= 1 - ringOpacity(o.rings.kind, rh) * 0.88;
              }
            }
          }
          r = oR * sc; g = oG * sc; b = oB * sc;
          if (oSpec > 0 && diff > 0) {
            var ndh = nx * Hx + ny * Hy + nz * Hz;
            if (ndh > 0) {
              var sp = Math.pow(ndh, spPow) * oSpec * diff * 1.25;
              r += spCol[0] * sp; g += spCol[1] * sp; b += spCol[2] * sp;
            }
          }
          r += aR; g += aG; b += aB;
          if (oEmit > 0) {
            var night = 1 - clamp(diff * 5.5, 0, 1);
            r += oEmit * night * 0.95; g += oEmit * night * 0.72; b += oEmit * night * 0.35;
          }
        }

        if (atm) {
          var fres = 1 - nz;
          var arc = fres * fres * fres * clamp(ndl * 1.25 + 0.30, 0, 1) * atmK;
          var scat = fres * fres * clamp(ndl, 0, 1) * atmK * 0.30;
          r += atm[0] * (arc * 0.85 + scat); g += atm[1] * (arc * 0.85 + scat); b += atm[2] * (arc * 0.85 + scat);
        }

        r = r > 1 ? 1 : (r < 0 ? 0 : r); g = g > 1 ? 1 : (g < 0 ? 0 : g); b = b > 1 ? 1 : (b < 0 ? 0 : b);
        data[oo] = GAMMA[(r * 1024) | 0];
        data[oo + 1] = GAMMA[(g * 1024) | 0];
        data[oo + 2] = GAMMA[(b * 1024) | 0];
        data[oo + 3] = (cov * 255) | 0;
      }
    }
    spriteCtx.putImageData(spriteImg, 0, 0, 0, 0, sw, sh2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(spriteCv, 0, 0, sw, sh2, x0, y0, sw * step, sh2 * step);
  }

  function drawTiny(o, sx, sy, R, lightMul) {
    var lx = -o.wx, ly = -o.wy, lz = -o.wz;
    var ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
    var lr = lx * cRx + ly * cRy + lz * cRz;
    var lu = lx * cUx + ly * cUy + lz * cUz;
    var lf = -(lx * cFx + ly * cFy + lz * cFz);
    var c = o.rgb, k = clamp(lf * 0.5 + 0.5, 0, 1) * lightMul;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (R < 1.1) {
      ctx.fillStyle = 'rgba(' + ((c[0] * 255 * k) | 0) + ',' + ((c[1] * 255 * k) | 0) + ',' + ((c[2] * 255 * k) | 0) + ',' + (0.55 + 0.45 * k).toFixed(2) + ')';
      ctx.fillRect(sx - R, sy - R, R * 2, R * 2);
      return;
    }
    var gx = sx + lr * R * 0.55, gy = sy - lu * R * 0.55;
    var g = ctx.createRadialGradient(gx, gy, R * 0.05, sx, sy, R * 1.15);
    var hi = clamp(0.45 + lf * 0.55, 0.05, 1) * lightMul;
    g.addColorStop(0, 'rgb(' + ((c[0] * 255 * hi) | 0) + ',' + ((c[1] * 255 * hi) | 0) + ',' + ((c[2] * 255 * hi) | 0) + ')');
    g.addColorStop(0.62, 'rgb(' + ((c[0] * 150 * hi) | 0) + ',' + ((c[1] * 150 * hi) | 0) + ',' + ((c[2] * 150 * hi) | 0) + ')');
    g.addColorStop(1, 'rgb(' + ((c[0] * 22) | 0) + ',' + ((c[1] * 22) | 0) + ',' + ((c[2] * 26) | 0) + ')');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.fill();
  }

  /* --------------------------------------------------------- Солнце ---- */
  function renderSun(sx, sy, R, tsec) {
    /* Корона поджата: прежние 15 радиусов заливали всю внутреннюю систему */
    ctx.globalCompositeOperation = 'lighter';
    var s1 = R * 7.6;
    ctx.globalAlpha = 0.17; ctx.drawImage(glowSprite('#ff8a2c', 3.0), sx - s1, sy - s1, s1 * 2, s1 * 2);
    var s2 = R * 3.3;
    ctx.globalAlpha = 0.38; ctx.drawImage(glowSprite('#ffc164', 2.4), sx - s2, sy - s2, s2 * 2, s2 * 2);
    var s3 = R * 1.68;
    ctx.globalAlpha = 0.62; ctx.drawImage(glowSprite('#fff2d2', 2.0), sx - s3, sy - s3, s3 * 2, s3 * 2);

    /* анаморфные блики — «киношный» горизонтальный росчерк */
    var fw = R * 10.5, fh = R * 0.5;
    ctx.globalAlpha = 0.14; ctx.drawImage(glowSprite('#ffd8a0', 2.2), sx - fw, sy - fh, fw * 2, fh * 2);
    ctx.globalAlpha = 0.07; ctx.drawImage(glowSprite('#cfe0ff', 2.2), sx - fh * 0.85, sy - fw * 0.5, fh * 1.7, fw);

    var s4 = R * 3.9;
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(tsec * 0.012);
    ctx.globalAlpha = 0.27; ctx.drawImage(coronaSprite, -s4, -s4, s4 * 2, s4 * 2);
    ctx.rotate(-tsec * 0.026);
    ctx.globalAlpha = 0.13; ctx.drawImage(coronaSprite, -s4 * 1.5, -s4 * 1.5, s4 * 3, s4 * 3);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (R < 1.5) return;
    var pad = 1;
    var x0 = Math.max(0, Math.floor(sx - R - pad)), x1 = Math.min(W, Math.ceil(sx + R + pad));
    var y0 = Math.max(0, Math.floor(sy - R - pad)), y1 = Math.min(H, Math.ceil(sy + R + pad));
    var w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    var step = shadeStep(w, h);
    var sw = Math.ceil(w / step), sh2 = Math.ceil(h / step);
    ensureSprite(sw, sh2);
    var data = spriteData, stride = spriteW * 4;
    var invR = 1 / R, dmax = 1 + 0.5 * invR, dmax2 = dmax * dmax;
    var sp = tsec * 0.045;
    var cs = Math.cos(sp), sn = Math.sin(sp);
    /* базис Солнца: ось Y мировая, вращение вокруг неё */
    var b0x = cs, b0y = 0, b0z = sn, b2x = -sn, b2y = 0, b2z = cs;
    var q00 = cRx * b0x + cRz * b0z, q01 = cUx * b0x + cUz * b0z, q02 = -(cFx * b0x + cFz * b0z);
    var q10 = cRy, q11 = cUy, q12 = -cFy;
    var q20 = cRx * b2x + cRz * b2z, q21 = cUx * b2x + cUz * b2z, q22 = -(cFx * b2x + cFz * b2z);

    for (var jj = 0; jj < sh2; jj++) {
      var py = y0 + (jj + 0.5) * step;
      var ny = (sy - py) * invR, ny2 = ny * ny;
      var row = jj * stride;
      for (var ii = 0; ii < sw; ii++) {
        var px = x0 + (ii + 0.5) * step;
        var nx = (px - sx) * invR;
        var d2 = nx * nx + ny2, oo = row + ii * 4;
        if (d2 > dmax2) { data[oo + 3] = 0; continue; }
        var dd = Math.sqrt(d2);
        var cov = (dmax - dd) * R; cov = cov > 1 ? 1 : (cov < 0 ? 0 : cov);
        var nz = 1 - d2; nz = nz > 0 ? Math.sqrt(nz) : 0;
        var bx = nx * q00 + ny * q01 + nz * q02;
        var by = nx * q10 + ny * q11 + nz * q12;
        var bz = nx * q20 + ny * q21 + nz * q22;
        var v = sunSurface(bx, by, bz, tsec);
        var limb = 0.42 + 0.58 * Math.pow(nz, 0.42);
        v *= limb;
        var r = clamp(v * 1.30, 0, 1), g = clamp(v * 0.94 - 0.03, 0, 1), b = clamp(v * 0.48 - 0.10, 0, 1);
        data[oo] = GAMMA[(r * 1024) | 0];
        data[oo + 1] = GAMMA[(g * 1024) | 0];
        data[oo + 2] = GAMMA[(b * 1024) | 0];
        data[oo + 3] = (cov * 255) | 0;
      }
    }
    spriteCtx.putImageData(spriteImg, 0, 0, 0, 0, sw, sh2);
    ctx.globalAlpha = 1;
    ctx.drawImage(spriteCv, 0, 0, sw, sh2, x0, y0, sw * step, sh2 * step);
  }

  /* ================================================== состояние сцены === */
  var opt = { pause: false, orbits: true, trails: true, labels: true, bloom: true, spin: true };
  var speed = 0.10, sizeBoost = 1.0;
  var simT = 0, tsec = 0, quality = 1;
  var labelQueue = [];

  function updateBodies() {
    for (var i = 0; i < PLANETS.length; i++) {
      var p = PLANETS[i];
      var M = p.m0 + p.rate * simT;
      orbitPos(p, M, pos);
      p.wx = pos.x; p.wy = pos.y; p.wz = pos.z;
      p.spin = p.spinRate * simT;
      p.dispR = p.baseR * sizeBoost;
      p.orbAng = M;
      for (var j = 0; j < p.moons.length; j++) {
        var m = p.moons[j];
        var ang = m.ph + m.rate * simT;
        m.ang = ang;
        var rr = m.d * p.dispR;
        var ca = Math.cos(ang), sa = Math.sin(ang);
        var ex = p.e0x * ca, ey = p.e0y * ca, ez = p.e0z * ca;
        var fx = (p.e1x * m.ci + p.axX * m.si) * sa;
        var fy = (p.e1y * m.ci + p.axY * m.si) * sa;
        var fz = (p.e1z * m.ci + p.axZ * m.si) * sa;
        m.wx = p.wx + (ex + fx) * rr;
        m.wy = p.wy + (ey + fy) * rr;
        m.wz = p.wz + (ez + fz) * rr;
        m.dispR = m.baseR * sizeBoost;
        /* затмение: луна в тени планеты */
        var dx = m.wx - p.wx, dy = m.wy - p.wy, dz = m.wz - p.wz;
        var lx = -p.wx, ly = -p.wy, lz = -p.wz;
        var ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
        var pr = dx * lx + dy * ly + dz * lz, sh = 0;
        if (pr < 0) {
          var qx = dx - pr * lx, qy = dy - pr * ly, qz = dz - pr * lz;
          sh = smoothstep(p.dispR * 1.25, p.dispR * 0.7, Math.hypot(qx, qy, qz));
        }
        m.light = 1 - sh * 0.97;
      }
    }
  }

  /* --------------------------------------------------- орбиты (гид) ---- */
  function precomputeOrbitPaths() {
    for (var i = 0; i < PLANETS.length; i++) {
      var p = PLANETS[i], n = 160, arr = new Float32Array(n * 3);
      for (var j = 0; j < n; j++) {
        orbitPos(p, j / n * TAU, pos);
        arr[j * 3] = pos.x; arr[j * 3 + 1] = pos.y; arr[j * 3 + 2] = pos.z;
      }
      p.path = arr; p.pathN = n;
    }
  }
  precomputeOrbitPaths();

  function drawOrbits() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = Math.max(0.7, 0.8 * dpr);
    for (var i = 0; i < PLANETS.length; i++) {
      var p = PLANETS[i], a = p.path, n = p.pathN, started = false;
      ctx.beginPath();
      for (var j = 0; j <= n; j++) {
        var k = (j % n) * 3;
        if (project(a[k], a[k + 1], a[k + 2])) {
          if (!started) { ctx.moveTo(pX, pY); started = true; } else ctx.lineTo(pX, pY);
        } else started = false;
      }
      var c = p.rgb;
      ctx.strokeStyle = 'rgba(' + ((c[0] * 255) | 0) + ',' + ((c[1] * 255) | 0) + ',' + ((c[2] * 255) | 0) + ',0.115)';
      ctx.stroke();
    }
  }

  /* След считается аналитически из той же кеплеровой орбиты — он есть уже
     на первом кадре, не «догоняет» медленные планеты и точно ложится на
     эллипс. Яркий у тела, гаснущий к хвосту. */
  var TRAIL_N = 88, TRAIL_SPAN = TAU * 0.33, TRAIL_BK = 8;
  var tpos = { x: 0, y: 0, z: 0 };
  function drawTrails() {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var i = 0; i < PLANETS.length; i++) {
      var p = PLANETS[i], c = p.rgb;
      var M1 = p.m0 + p.rate * simT;
      var span = p.rate < 0 ? -TRAIL_SPAN : TRAIL_SPAN;
      var cr = (c[0] * 210 + 45) | 0, cg = (c[1] * 210 + 45) | 0, cb = (c[2] * 210 + 50) | 0;
      for (var b = 0; b < TRAIL_BK; b++) {
        var k0 = Math.floor(b * TRAIL_N / TRAIL_BK);
        var k1 = Math.min(TRAIL_N, Math.floor((b + 1) * TRAIL_N / TRAIL_BK) + 1);
        var started = false;
        ctx.beginPath();
        for (var k = k0; k < k1; k++) {
          var t = k / (TRAIL_N - 1);
          orbitPos(p, M1 - span * (1 - t), tpos);
          if (project(tpos.x, tpos.y, tpos.z)) {
            if (!started) { ctx.moveTo(pX, pY); started = true; } else ctx.lineTo(pX, pY);
          } else started = false;
        }
        var f = (b + 1) / TRAIL_BK;
        var a = 0.035 + 0.72 * Math.pow(f, 2.3);
        ctx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + a.toFixed(3) + ')';
        ctx.lineWidth = (0.45 + 2.7 * f * f) * dpr;
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ------------------------------------------------------ фон/звёзды --- */
  function drawSky() {
    ctx.globalCompositeOperation = 'lighter';
    var tints = [glowSprite('#8ea6d8', 2.6), glowSprite('#d8c6ff', 2.6), glowSprite('#ffd9b8', 2.6)];
    var cnt = Math.round(milky.n * quality);
    for (var i = 0; i < cnt; i++) {
      if (!projectDir(milky.dx[i], milky.dy[i], milky.dz[i])) continue;
      var s = milky.sz[i] * focal / pZ;
      if (s < 2) continue;
      ctx.globalAlpha = milky.al[i];
      ctx.drawImage(tints[milky.tn[i]], pX - s, pY - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    var sn = Math.round(stars.n * quality);
    for (var c = 0; c < 5; c++) {
      ctx.fillStyle = stars.pal[c];
      for (var k = 0; k < sn; k++) {
        if (stars.col[k] !== c) continue;
        if (!projectDir(stars.dx[k], stars.dy[k], stars.dz[k])) continue;
        var m = stars.mag[k];
        var tw = 0.82 + 0.18 * Math.sin(tsec * 2.1 + stars.ph[k] * 7);
        var a = clamp(m * 0.85, 0.05, 1) * tw;
        var sz = (m > 0.85 ? 2.1 : (m > 0.5 ? 1.5 : 1.0)) * dpr;
        ctx.globalAlpha = a;
        ctx.fillRect(pX - sz * 0.5, pY - sz * 0.5, sz, sz);
        if (m > 1.02) {
          ctx.globalAlpha = a * 0.30;
          ctx.fillRect(pX - sz * 2.6, pY - dpr * 0.35, sz * 5.2, dpr * 0.7);
          ctx.fillRect(pX - dpr * 0.35, pY - sz * 2.6, dpr * 0.7, sz * 5.2);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawBelt(bl, baseAlpha, tint, maxSize) {
    var n = Math.round(bl.n * quality);
    ctx.fillStyle = tint;
    for (var i = 0; i < n; i++) {
      var M = bl.PH[i] + bl.RT[i] * simT;
      var ec = bl.E[i];
      var r = bl.A[i] * (1 - ec * Math.cos(M));
      var nu = M + 2 * ec * Math.sin(M);
      var xo = r * Math.cos(nu), yo = r * Math.sin(nu);
      var x = xo * bl.CN[i] - yo * bl.CI[i] * bl.SN[i];
      var zz = xo * bl.SN[i] + yo * bl.CI[i] * bl.CN[i];
      var y = yo * bl.SI[i];
      if (!project(x, y, zz)) continue;
      var s = clamp(bl.SZ[i] * dpr * (0.4 + focal / pZ * 0.006), 0.5, maxSize);
      ctx.globalAlpha = clamp(baseAlpha * (0.35 + bl.TN[i] * 0.9), 0.02, 0.9);
      ctx.fillRect(pX - s * 0.5, pY - s * 0.5, s, s);
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------ тела кадра --- */
  var drawList = [], areaList = [], subList = [];
  function byDepth(a, b) { return b.z - a.z; }

  function bboxArea(x, y, r) {
    if (!(r >= 4) || !isFinite(r) || !isFinite(x) || !isFinite(y)) return 0;
    var x0 = Math.max(0, Math.floor(x - r - 1)), x1 = Math.min(W, Math.ceil(x + r + 1));
    var y0 = Math.max(0, Math.floor(y - r - 1)), y1 = Math.min(H, Math.ceil(y + r + 1));
    return (x1 > x0 && y1 > y0) ? (x1 - x0) * (y1 - y0) : 0;
  }
  /* Подбираем порог B так, чтобы Σ min(площадь, B) уложилась в бюджет кадра:
     мелкие тела шейдятся целиком, крупные — через шаг. */
  function pickBudget(list, target) {
    var sum = 0, i;
    for (i = 0; i < list.length; i++) sum += list[i];
    if (sum <= target) return 130000;
    var lo = 2200, hi = 130000, mid, s;
    for (var it = 0; it < 18; it++) {
      mid = (lo + hi) * 0.5; s = 0;
      for (i = 0; i < list.length; i++) s += list[i] < mid ? list[i] : mid;
      if (s > target) hi = mid; else lo = mid;
    }
    return lo;
  }

  function renderBodies() {
    drawList.length = 0; areaList.length = 0;
    var i, j, k, q, p, m, it, o;

    if (project(0, 0, 0)) {
      var sr = SUN.dispR * Math.sqrt(sizeBoost) * pS;
      drawList.push({ z: pZ, o: SUN, x: pX, y: pY, r: sr, s: pS });
      areaList.push(bboxArea(pX, pY, sr));
    }
    for (i = 0; i < PLANETS.length; i++) {
      p = PLANETS[i];
      if (!project(p.wx, p.wy, p.wz)) {
        for (j = 0; j < p.moons.length; j++) p.moons[j].vis = false;
        continue;
      }
      var prj = p.dispR * pS;
      drawList.push({ z: pZ, o: p, x: pX, y: pY, r: prj, s: pS });
      areaList.push(bboxArea(pX, pY, prj));
      for (j = 0; j < p.moons.length; j++) {
        m = p.moons[j];
        if (!project(m.wx, m.wy, m.wz)) { m.vis = false; continue; }
        m.vis = true; m.px = pX; m.py = pY; m.pz = pZ; m.pr = m.dispR * pS;
        areaList.push(bboxArea(m.px, m.py, m.pr));
      }
    }
    shadeBudget = pickBudget(areaList, quality > 0.85 ? 130000 : 55000);
    drawList.sort(byDepth);

    for (k = 0; k < drawList.length; k++) {
      it = drawList[k]; o = it.o;
      if (o.isSun) {
        if (isFinite(it.x) && isFinite(it.y) && isFinite(it.r)) renderSun(it.x, it.y, Math.max(0.8, it.r), tsec);
        continue;
      }

      var hasRings = !!o.rings;
      if (hasRings) { prepareRings(o, o.dispR, it.z, it.s); drawRingPass(false, it.z); } else rN = 0;

      /* планета и её луны сортируются по глубине между собой */
      subList.length = 0;
      for (j = 0; j < o.moons.length; j++) {
        m = o.moons[j];
        if (m.vis) subList.push({ z: m.pz, m: m, x: m.px, y: m.py, r: m.pr });
      }
      subList.push({ z: it.z, m: null, x: it.x, y: it.y, r: it.r });
      subList.sort(byDepth);

      for (q = 0; q < subList.length; q++) {
        var s = subList[q];
        if (s.m === null) {
          drawBody(o, s.x, s.y, s.r, 1);
          if (opt.labels && s.x > -80 && s.x < W + 80 && s.y > -40 && s.y < H + 40)
            labelQueue.push({ x: s.x, y: s.y, r: s.r, t: o.name, big: true, c: o.rgb });
        } else {
          drawBody(s.m, s.x, s.y, s.r, s.m.light);
          if (opt.labels && s.r > 3.4 * dpr && s.x > -80 && s.x < W + 80 && s.y > -40 && s.y < H + 40)
            labelQueue.push({ x: s.x, y: s.y, r: s.r, t: s.m.name, big: false, c: s.m.rgb });
        }
      }
      if (hasRings) drawRingPass(true, it.z);
    }
  }

  function drawBody(o, x, y, r, lightMul) {
    /* при пролёте камеры вплотную проекция вырождается — отсекаем не-числа */
    if (!(r >= 0.35) || !isFinite(r) || !isFinite(x) || !isFinite(y)) return;
    if (o.atmoRGB && r > 2.2) {
      var g = glowSprite(o.atmo, 3.2), s = r * (1.9 + (o.atmoK || 0.6) * 0.9);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(0.10 + (o.atmoK || 0.6) * 0.10, 0, 0.32);
      ctx.drawImage(g, x - s, y - s, s * 2, s * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (r >= 4.0) renderSphere(o, x, y, r, lightMul, tsec);
    else drawTiny(o, x, y, r, lightMul);
  }

  /* Подписи разводятся по вертикали: крупные тела получают место первыми,
     остальные ищут свободный слот выше/ниже и тянут поводок к телу. */
  var LBL_OFF = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5];
  function drawLabels() {
    if (!labelQueue.length) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    labelQueue.sort(function (a, b) { return b.r - a.r; });
    var placed = [], i, q, z;
    for (i = 0; i < labelQueue.length; i++) {
      var l = labelQueue[i];
      var fs = (l.big ? 11.5 : 9.5) * dpr;
      ctx.font = '600 ' + fs.toFixed(1) + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      var tw = ctx.measureText(l.t).width;
      var bx = l.x + l.r + 7 * dpr;
      var by0 = l.y - l.r * 0.5 - 2 * dpr;
      var stepY = 13.5 * dpr, by = by0, ok = false;
      for (q = 0; q < LBL_OFF.length && !ok; q++) {
        by = clamp(by0 + LBL_OFF[q] * stepY, fs, H - fs);
        ok = true;
        for (z = 0; z < placed.length; z++) {
          var r2 = placed[z];
          if (bx < r2.x + r2.w + 7 * dpr && bx + tw + 7 * dpr > r2.x &&
              by - fs * 0.6 < r2.y + r2.h && by + fs * 0.6 > r2.y) { ok = false; break; }
        }
      }
      placed.push({ x: bx, y: by - fs * 0.6, w: tw, h: fs * 1.2 });
      l.fs = fs; l.bx = bx; l.by = by; l.tw = tw;
    }
    for (i = 0; i < labelQueue.length; i++) {
      var L = labelQueue[i];
      ctx.font = '600 ' + L.fs.toFixed(1) + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.globalAlpha = L.big ? 0.34 : 0.22;
      ctx.strokeStyle = 'rgba(198,214,242,0.7)';
      ctx.lineWidth = dpr * 0.75;
      ctx.beginPath();
      ctx.moveTo(L.x + L.r * 0.72, L.y - L.r * 0.4);
      ctx.lineTo(L.bx - 4 * dpr, L.by);
      ctx.stroke();
      ctx.globalAlpha = L.big ? 0.96 : 0.66;
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillText(L.t, L.bx + dpr, L.by + dpr);
      ctx.fillStyle = 'rgb(' + ((L.c[0] * 118 + 137) | 0) + ',' + ((L.c[1] * 118 + 137) | 0) + ',' + ((L.c[2] * 118 + 137) | 0) + ')';
      ctx.fillText(L.t, L.bx, L.by);
    }
    ctx.globalAlpha = 1;
    labelQueue.length = 0;
  }

  /* --------------------------------------------------------- постэффект */
  function postProcess() {
    if (!opt.bloom) return;
    var bw = bloomA.width, bh = bloomA.height;
    bcA.globalCompositeOperation = 'source-over';
    bcA.globalAlpha = 1;
    bcA.clearRect(0, 0, bw, bh);
    bcA.drawImage(canvas, 0, 0, W, H, 0, 0, bw, bh);
    bcB.globalCompositeOperation = 'source-over';
    bcB.globalAlpha = 1;
    bcB.clearRect(0, 0, bw, bh);
    bcB.drawImage(bloomA, 0, 0);
    bcB.globalCompositeOperation = 'multiply';
    bcB.drawImage(bloomA, 0, 0);
    bcB.globalCompositeOperation = 'source-over';
    bcA.clearRect(0, 0, bw, bh);
    if (hasFilter) bcA.filter = 'blur(3px)';
    bcA.drawImage(bloomB, 0, 0);
    if (hasFilter) bcA.filter = 'none';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bloomA, 0, 0, bw, bh, 0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ============================================================ кадр ==== */
  var last = 0, fpsAcc = 0, fpsN = 0, fpsShow = 0, lastUI = 0, frameAcc = 0, frameN = 0;
  var elEpoch = document.getElementById('epoch');
  var elFps = document.getElementById('fps');

  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    var dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;
    tsec += dt;
    if (!opt.pause) simT += dt * speed;
    if (opt.spin) {
      cam.az += dt * 0.055;
      cam.breath = Math.sin(tsec * 0.09) * 0.030;
    } else cam.breath *= 0.96;

    updateCamera();
    updateBodies();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#03050b';
    ctx.fillRect(0, 0, W, H);

    drawSky();
    drawBelt(kuiper, 0.13, '#9fb2d6', 1.6 * dpr);
    if (opt.orbits) drawOrbits();
    drawBelt(belt, 0.30, '#cbb79a', 2.2 * dpr);
    if (opt.trails) drawTrails();
    renderBodies();
    drawLabels();
    postProcess();

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    /* адаптация качества */
    frameAcc += dt; frameN++;
    if (frameN >= 45) {
      var avg = frameAcc / frameN;
      if (avg > 0.030 && quality > 0.55) quality = Math.max(0.55, quality - 0.08);
      else if (avg < 0.019 && quality < 1) quality = Math.min(1, quality + 0.05);
      frameAcc = 0; frameN = 0;
    }
    fpsAcc += dt; fpsN++;
    if (now - lastUI > 420) {
      lastUI = now;
      fpsShow = fpsN / Math.max(1e-4, fpsAcc);
      fpsAcc = 0; fpsN = 0;
      if (elFps) elFps.textContent = Math.round(fpsShow) + ' fps';
      if (elEpoch) elEpoch.textContent = 'J2000 + ' + simT.toFixed(1) + ' лет';
    }
  }

  /* ============================================================= UI ===== */
  function $(id) { return document.getElementById(id); }
  var sSpeed = $('s-speed'), sZoom = $('s-zoom'), sTilt = $('s-tilt'), sSize = $('s-size');
  var vSpeed = $('v-speed'), vZoom = $('v-zoom'), vTilt = $('v-tilt'), vSize = $('v-size');

  function speedFromSlider(v) { return 0.004 * Math.pow(150, v / 1000); }
  function sliderFromSpeed(s) { return clamp(Math.log(s / 0.004) / Math.log(150) * 1000, 0, 1000); }
  function distFromSlider(v) { return 70 * Math.pow(0.057, v / 1000); }
  function sliderFromDist(d) { return clamp(Math.log(d / 70) / Math.log(0.057) * 1000, 0, 1000); }

  function syncUI() {
    if (vSpeed) vSpeed.textContent = speed.toFixed(speed < 0.1 ? 3 : 2) + ' г/с';
    if (vZoom) vZoom.textContent = cam.dist.toFixed(1);
    if (vTilt) vTilt.textContent = Math.round(cam.el / DEG) + '°';
    if (vSize) vSize.textContent = sizeBoost.toFixed(2) + '×';
  }
  /* значения ползунков нормализуются: демка не должна ломаться ни на каком вводе */
  function num(v, def) { v = +v; return isFinite(v) ? v : def; }
  if (sSpeed) sSpeed.addEventListener('input', function () {
    speed = clamp(speedFromSlider(clamp(num(sSpeed.value, 642), 0, 1000)), 0.002, 1.2); syncUI();
  });
  if (sZoom) sZoom.addEventListener('input', function () {
    cam.dist = clamp(distFromSlider(clamp(num(sZoom.value, 374), 0, 1000)), 3.2, 70); syncUI();
  });
  if (sTilt) sTilt.addEventListener('input', function () {
    cam.el = clamp(num(sTilt.value, 28), -80, 80) * DEG; syncUI();
  });
  if (sSize) sSize.addEventListener('input', function () {
    sizeBoost = clamp(num(sSize.value, 100) / 100, 0.4, 3.0); syncUI();
  });

  var buttons = document.querySelectorAll('.btns button');
  function applyToggle(name) {
    if (name === 'reset') { resetView(); return; }
    opt[name] = !opt[name];
    refreshButtons();
  }
  function refreshButtons() {
    for (var i = 0; i < buttons.length; i++) {
      var t = buttons[i].getAttribute('data-t');
      if (t === 'reset') continue;
      var on = t === 'pause' ? opt.pause : opt[t];
      buttons[i].classList.toggle('on', !!on);
    }
  }
  for (var bi = 0; bi < buttons.length; bi++) {
    (function (btn) {
      btn.addEventListener('click', function () { applyToggle(btn.getAttribute('data-t')); btn.blur(); });
    })(buttons[bi]);
  }

  function resetView() {
    cam.az = 0.86; cam.el = 28 * DEG; cam.dist = 24.0;
    speed = 0.10; sizeBoost = 1.0;
    opt.pause = false; opt.orbits = true; opt.trails = true;
    opt.labels = true; opt.bloom = true; opt.spin = true;
    if (sSpeed) sSpeed.value = sliderFromSpeed(speed);
    if (sZoom) sZoom.value = sliderFromDist(cam.dist);
    if (sTilt) sTilt.value = 28;
    if (sSize) sSize.value = 100;
    refreshButtons(); syncUI();
  }

  /* ------------------------------------------------------- указатель --- */
  var ptrs = {}, ptrCount = 0, lastPinch = 0;
  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    ptrCount++;
    canvas.classList.add('dragging');
    if (ptrCount === 2) lastPinch = pinchDist();
  });
  function pinchDist() {
    var ks = Object.keys(ptrs);
    if (ks.length < 2) return 0;
    var a = ptrs[ks[0]], b = ptrs[ks[1]];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  canvas.addEventListener('pointermove', function (e) {
    var p = ptrs[e.pointerId];
    if (!p) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrCount >= 2) {
      var d = pinchDist();
      if (lastPinch > 0 && d > 0) {
        cam.dist = clamp(cam.dist * (lastPinch / d), 3.2, 70);
        if (sZoom) sZoom.value = sliderFromDist(cam.dist);
        syncUI();
      }
      lastPinch = d;
      return;
    }
    cam.az -= dx * 0.0055;
    cam.el = clamp(cam.el + dy * 0.0045, -80 * DEG, 80 * DEG);
    if (sTilt) sTilt.value = Math.round(cam.el / DEG);
    syncUI();
  });
  function endPtr(e) {
    if (ptrs[e.pointerId]) { delete ptrs[e.pointerId]; ptrCount = Math.max(0, ptrCount - 1); }
    if (ptrCount === 0) canvas.classList.remove('dragging');
    lastPinch = 0;
  }
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('pointerleave', endPtr);

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var k = Math.exp(clamp(e.deltaY, -180, 180) * 0.0013);
    cam.dist = clamp(cam.dist * k, 3.2, 70);
    if (sZoom) sZoom.value = sliderFromDist(cam.dist);
    syncUI();
  }, { passive: false });

  window.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if (k === ' ' || e.code === 'Space') { e.preventDefault(); applyToggle('pause'); }
    else if (k === 'o' || k === 'щ') applyToggle('orbits');
    else if (k === 't' || k === 'е') applyToggle('trails');
    else if (k === 'l' || k === 'д') applyToggle('labels');
    else if (k === 'b' || k === 'и') applyToggle('bloom');
    else if (k === 'r' || k === 'к') applyToggle('reset');
    else if (k === 'c' || k === 'с') applyToggle('spin');
    else if (k === 'arrowleft') cam.az -= 0.07;
    else if (k === 'arrowright') cam.az += 0.07;
    else if (k === 'arrowup') { cam.el = clamp(cam.el + 0.04, -80 * DEG, 80 * DEG); if (sTilt) sTilt.value = Math.round(cam.el / DEG); syncUI(); }
    else if (k === 'arrowdown') { cam.el = clamp(cam.el - 0.04, -80 * DEG, 80 * DEG); if (sTilt) sTilt.value = Math.round(cam.el / DEG); syncUI(); }
    else if (k === '+' || k === '=') { cam.dist = clamp(cam.dist * 0.9, 3.2, 70); if (sZoom) sZoom.value = sliderFromDist(cam.dist); syncUI(); }
    else if (k === '-' || k === '_') { cam.dist = clamp(cam.dist * 1.11, 3.2, 70); if (sZoom) sZoom.value = sliderFromDist(cam.dist); syncUI(); }
  });

  if (sSpeed) sSpeed.value = sliderFromSpeed(speed);
  if (sZoom) sZoom.value = sliderFromDist(cam.dist);
  refreshButtons();
  syncUI();
  requestAnimationFrame(frame);
})();
