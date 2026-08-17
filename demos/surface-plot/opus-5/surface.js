/*
 * surface.js — чистая математика 3D-графика z = f(x, y).
 * Dual-mode: в браузере кладёт API в window.Surface, в node — module.exports.
 *
 * Ключевая вещь — порядок отрисовки (алгоритм художника).
 * Поверхность однозначна над плоскостью XY (высотное поле), поэтому вдоль
 * любого луча из камеры индексная координата ячейки удаляется от индекса
 * камеры монотонно. Значит достаточно отсортировать ряды по |i + 0.5 - ci|
 * и столбцы по |j + 0.5 - cj| (по убыванию) и обойти их вложенным циклом:
 * если ячейка B закрыта ячейкой A, то у B оба ранга не больше — она рисуется
 * раньше. Это точно при ЛЮБОМ ракурсе, включая вид почти с ребра.
 */
;(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = api;
  } else {
    root.Surface = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function smoothstep(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  /* ------------------------------------------------------------------ */
  /*  Поля высот. Домен u, v ∈ [-1, 1]; значения нормированы к ~[-1, 1]. */
  /*  prep(t) считает всё, что не зависит от узла (тригонометрию по t).  */
  /* ------------------------------------------------------------------ */

  var FUNCS = [
    {
      id: 'ripple',
      label: 'Рябь',
      formula: 'z = sin(k·r − ω·t) / (1 + a·k·r)',
      hint: 'затухающая круговая волна от точечного возмущения',
      prep: function (t) { return { p: t * 2.45 }; },
      f: function (u, v, p) {
        var s = Math.sqrt(u * u + v * v) * 9.4;
        return Math.sin(s - p.p) / (1 + 0.24 * s);
      }
    },
    {
      id: 'saddle',
      label: 'Седло',
      formula: 'z = c(t)·(x′² − y′²), оси вращаются',
      hint: 'гиперболический параболоид, оси медленно поворачиваются',
      prep: function (t) {
        var a = t * 0.31;
        return { c: Math.cos(a), s: Math.sin(a), k: 0.66 * (0.76 + 0.24 * Math.sin(t * 0.63)) };
      },
      f: function (u, v, p) {
        var uu = u * p.c - v * p.s;
        var vv = u * p.s + v * p.c;
        return p.k * (uu * uu - vv * vv);
      }
    },
    {
      id: 'gauss',
      label: 'Гауссианы',
      formula: 'z = Σ Aᵢ · exp(−|r − cᵢ(t)|² / 2σᵢ²)',
      hint: 'три блуждающих гауссовых горба, средний — впадина',
      prep: function (t) {
        return {
          x1: 0.44 * Math.cos(t * 0.53), y1: 0.44 * Math.sin(t * 0.53),
          x2: 0.56 * Math.cos(2.1 - t * 0.37), y2: 0.56 * Math.sin(2.1 - t * 0.37),
          x3: 0.30 * Math.cos(4.0 + t * 0.74), y3: 0.30 * Math.sin(4.0 + t * 0.74)
        };
      },
      f: function (u, v, p) {
        var dx = u - p.x1, dy = v - p.y1;
        var z = 0.95 * Math.exp(-(dx * dx + dy * dy) * 5.56);
        dx = u - p.x2; dy = v - p.y2;
        z -= 0.72 * Math.exp(-(dx * dx + dy * dy) * 8.68);
        dx = u - p.x3; dy = v - p.y3;
        z += 0.58 * Math.exp(-(dx * dx + dy * dy) * 12.5);
        return z;
      }
    },
    {
      id: 'interf',
      label: 'Интерференция',
      formula: 'z = ½[sin(k·r₁ − ωt) + sin(k·r₂ − ωt)] · env(r)',
      hint: 'два когерентных источника: полосы усиления и гашения',
      prep: function (t) { return { p: t * 2.6 }; },
      f: function (u, v, p) {
        var ax = u - 0.46, bx = u + 0.46;
        var r1 = Math.sqrt(ax * ax + v * v);
        var r2 = Math.sqrt(bx * bx + v * v);
        var env = 0.40 + 0.60 * Math.exp(-1.25 * Math.sqrt(u * u + v * v));
        return 0.5 * (Math.sin(r1 * 11.5 - p.p) + Math.sin(r2 * 11.5 - p.p)) * env;
      }
    },
    {
      id: 'dunes',
      label: 'Дюны',
      formula: 'z = Σ sin(kᵢ·x + φᵢ(y, t))',
      hint: 'наложение бегущих волн с модуляцией фазы',
      prep: function (t) { return { t: t }; },
      f: function (u, v, p) {
        var t = p.t;
        var z = 0.54 * Math.sin(3.2 * u + 0.85 * Math.sin(1.75 * v + 0.42 * t) - 0.72 * t);
        z += 0.32 * Math.sin(4.8 * v - 0.53 * t + 1.3);
        z += 0.19 * Math.sin(4.53 * (u + v) + 0.95 * t);
        return z;
      }
    }
  ];

  function funcById(id) {
    for (var i = 0; i < FUNCS.length; i++) if (FUNCS[i].id === id) return FUNCS[i];
    return null;
  }

  /** Заполняет сетку высот N×N значениями fn в момент t. */
  function fillHeights(fn, N, t, out) {
    var p = fn.prep ? fn.prep(t) : { t: t };
    var f = fn.f;
    var step = 2 / (N - 1);
    var k = 0;
    for (var j = 0; j < N; j++) {
      var v = -1 + step * j;
      for (var i = 0; i < N; i++) out[k++] = f(-1 + step * i, v, p);
    }
    return out;
  }

  /** Наибольшее |z| по сетке — размах для цветовой карты и подгонки кадра. */
  function maxAbs(H, n) {
    var m = 0;
    for (var k = 0; k < n; k++) {
      var a = H[k] < 0 ? -H[k] : H[k];
      if (a > m) m = a;
    }
    return m;
  }

  /** Линейная смесь двух полей (переход между функциями). */
  function blendHeights(a, b, m, out, n) {
    for (var k = 0; k < n; k++) out[k] = a[k] + (b[k] - a[k]) * m;
    return out;
  }

  /**
   * Нормали в узлах: центральные разности по сетке высот,
   * n = normalize(-∂z/∂x, -∂z/∂y, 1). На границах — односторонние.
   */
  function computeNormals(H, N, amp, out) {
    var step = 2 / (N - 1);
    for (var j = 0; j < N; j++) {
      var jm = j > 0, jp = j < N - 1;
      var dy = (jm ? step : 0) + (jp ? step : 0);
      for (var i = 0; i < N; i++) {
        var k = j * N + i;
        var im = i > 0, ip = i < N - 1;
        var dx = (im ? step : 0) + (ip ? step : 0);
        var gx = (H[ip ? k + 1 : k] - H[im ? k - 1 : k]) * amp / dx;
        var gy = (H[jp ? k + N : k] - H[jm ? k - N : k]) * amp / dy;
        var inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        var o = k * 3;
        out[o] = -gx * inv;
        out[o + 1] = -gy * inv;
        out[o + 2] = inv;
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  Камера и проекция                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Орбитальная камера вокруг (0, 0, 0), мировой «верх» = +Z.
   * opt: { az, el, dist, fov, w, h, cx, cy }
   */
  function makeCamera(opt) {
    var d = opt.dist;
    var ce = Math.cos(opt.el), se = Math.sin(opt.el);
    var px = d * ce * Math.cos(opt.az);
    var py = d * ce * Math.sin(opt.az);
    var pz = d * se;

    var fx = -px, fy = -py, fz = -pz;
    var fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;

    // right = normalize(cross(forward, worldUp)), worldUp = (0, 0, 1)
    var rx = fy, ry = -fx, rz = 0;
    var rl = Math.sqrt(rx * rx + ry * ry);
    if (rl < 1e-8) { rx = 1; ry = 0; rl = 1; }
    rx /= rl; ry /= rl;

    // up = cross(right, forward)
    var ux = ry * fz - rz * fy;
    var uy = rz * fx - rx * fz;
    var uz = rx * fy - ry * fx;

    var focal = 0.5 * Math.min(opt.w, opt.h) / Math.tan(opt.fov * 0.5);

    return {
      px: px, py: py, pz: pz, dist: d,
      fx: fx, fy: fy, fz: fz,
      rx: rx, ry: ry, rz: rz,
      ux: ux, uy: uy, uz: uz,
      focal: focal,
      cx: opt.cx !== undefined ? opt.cx : opt.w * 0.5,
      cy: opt.cy !== undefined ? opt.cy : opt.h * 0.5
    };
  }

  /**
   * Наименьшая дистанция камеры, при которой габарит поверхности целиком
   * влезает в halfW × halfH (в пикселях от центра кадра).
   *
   * Габарит — цилиндр радиуса R высотой 2·zmax: его экранный размер не зависит
   * от азимута, поэтому при вращении кадр не «дышит». Экранный размер убывает
   * по дистанции монотонно, значит дихотомия даёт точный ответ — в отличие от
   * аналитической оценки, она честно учитывает перспективное увеличение
   * ближнего края (именно он вылезает за кадр при малом наклоне).
   */
  function fitDistance(focal, el, R, zmax, halfW, halfH) {
    var se = Math.sin(el), ce = Math.cos(el);
    var SEG = 32;
    var cosT = fitDistance._c || (fitDistance._c = []);
    var sinT = fitDistance._s || (fitDistance._s = []);
    if (cosT.length !== SEG) {
      cosT.length = sinT.length = 0;
      for (var s = 0; s < SEG; s++) {
        cosT.push(Math.cos(s * 2 * Math.PI / SEG));
        sinT.push(Math.sin(s * 2 * Math.PI / SEG));
      }
    }

    // Камера условно в азимуте 0: pos = (d·ce, 0, d·se);
    // f = (−ce, 0, −se), right = (0, 1, 0), up = (−se, 0, ce).
    function overflow(d) {
      var mx = 0, my = 0;
      for (var s = 0; s < SEG; s++) {
        var wx = R * cosT[s] - d * ce;
        var wy = R * sinT[s];
        for (var q = -1; q <= 1; q += 2) {
          var wz = q * zmax - d * se;
          var Z = -wx * ce - wz * se;
          if (Z < 0.02) Z = 0.02;
          var k = focal / Z;
          var ax = wy * k; if (ax < 0) ax = -ax;
          var ay = (-wx * se + wz * ce) * k; if (ay < 0) ay = -ay;
          if (ax > mx) mx = ax;
          if (ay > my) my = ay;
        }
      }
      var a = mx / halfW, b = my / halfH;
      return a > b ? a : b;
    }

    var lo = R + zmax + 0.3;                 // ближе нельзя: камера внутри габарита
    if (overflow(lo) <= 1) return lo;
    var hi = lo;
    for (var g = 0; g < 24 && overflow(hi) > 1; g++) hi *= 1.5;
    for (var it = 0; it < 22; it++) {
      var mid = (lo + hi) * 0.5;
      if (overflow(mid) > 1) lo = mid; else hi = mid;
    }
    return hi;
  }

  /** Проецирует все узлы сетки: экранные sx, sy и глубина в камере vz. */
  function projectAll(N, H, amp, cam, sx, sy, vz) {
    var step = 2 / (N - 1);
    var k = 0;
    for (var j = 0; j < N; j++) {
      var y = -1 + step * j;
      for (var i = 0; i < N; i++, k++) {
        var dx = (-1 + step * i) - cam.px;
        var dy = y - cam.py;
        var dz = H[k] * amp - cam.pz;
        var Z = dx * cam.fx + dy * cam.fy + dz * cam.fz;
        var X = dx * cam.rx + dy * cam.ry + dz * cam.rz;
        var Y = dx * cam.ux + dy * cam.uy + dz * cam.uz;
        vz[k] = Z;
        var q = Z > 1e-5 ? cam.focal / Z : 0;
        sx[k] = cam.cx + X * q;
        sy[k] = cam.cy - Y * q;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Порядок отрисовки (алгоритм художника)                             */
  /* ------------------------------------------------------------------ */

  /**
   * Индексы 0..M-1 по убыванию |i + 0.5 - c|.
   * Функция расстояния — «галочка», максимум всегда на одном из концов,
   * поэтому обычный двухуказательный проход даёт точный порядок за O(M).
   */
  function fillAxisOrder(M, c, out) {
    var lo = 0, hi = M - 1, k = 0;
    while (lo <= hi) {
      if (Math.abs(lo + 0.5 - c) >= Math.abs(hi + 0.5 - c)) out[k++] = lo++;
      else out[k++] = hi--;
    }
    return out;
  }

  /** Порядок рядов/столбцов ячеек для камеры с мировыми координатами camX, camY. */
  function buildOrder(N, camX, camY, iOrder, jOrder) {
    var M = N - 1;
    var scale = (N - 1) / 2;
    fillAxisOrder(M, (camX + 1) * scale, iOrder);
    fillAxisOrder(M, (camY + 1) * scale, jOrder);
  }

  /* ------------------------------------------------------------------ */
  /*  Цветовая карта по высоте                                           */
  /* ------------------------------------------------------------------ */

  // Монотонная по светлоте карта (как viridis, но с тёплой вершиной):
  // высота читается и по тону, и по яркости, поэтому не спорит с затенением.
  var RAMP = [
    [0.00, 16, 20, 66],
    [0.13, 26, 54, 128],
    [0.27, 26, 104, 158],
    [0.41, 30, 150, 156],
    [0.54, 62, 184, 136],
    [0.68, 138, 206, 108],
    [0.82, 216, 212, 110],
    [0.92, 240, 214, 146],
    [1.00, 252, 241, 218]
  ];

  function makeLUT(n) {
    var lut = new Uint8Array(n * 3);
    var seg = 0;
    for (var i = 0; i < n; i++) {
      var t = n > 1 ? i / (n - 1) : 0;
      while (seg < RAMP.length - 2 && t > RAMP[seg + 1][0]) seg++;
      var a = RAMP[seg], b = RAMP[seg + 1];
      var k = (t - a[0]) / (b[0] - a[0]);
      if (k < 0) k = 0; else if (k > 1) k = 1;
      k = k * k * (3 - 2 * k);
      var o = i * 3;
      lut[o] = Math.round(a[1] + (b[1] - a[1]) * k);
      lut[o + 1] = Math.round(a[2] + (b[2] - a[2]) * k);
      lut[o + 2] = Math.round(a[3] + (b[3] - a[3]) * k);
    }
    return lut;
  }

  return {
    FUNCS: FUNCS,
    funcById: funcById,
    clamp: clamp,
    smoothstep: smoothstep,
    fillHeights: fillHeights,
    maxAbs: maxAbs,
    blendHeights: blendHeights,
    computeNormals: computeNormals,
    makeCamera: makeCamera,
    fitDistance: fitDistance,
    projectAll: projectAll,
    buildOrder: buildOrder,
    fillAxisOrder: fillAxisOrder,
    RAMP: RAMP,
    makeLUT: makeLUT
  };
}));
