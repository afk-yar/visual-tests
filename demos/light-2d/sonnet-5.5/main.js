/* 2D-свет и тени — Claude Sonnet 5.5
 *
 * Полигон видимости строится геометрически точно:
 *   1. из источника выпускаются лучи к каждой вершине (препятствия + углы экрана),
 *      каждый — в трёх вариантах: угол -ε, 0, +ε;
 *   2. для каждого луча берётся ближайшее пересечение луч–отрезок;
 *   3. точки пересечения сортируются по углу — получается замкнутый полигон.
 *
 * Мягкие тени — усреднение полигонов видимости от точек внутри диска малого
 * радиуса (источник конечного размера). Радиус 0 даёт один жёсткий полигон.
 *
 * Чистый Canvas 2D, без сборки и внешних ресурсов; работает через file://.
 * Геометрия экспортируется через module.exports (для проверки в node).
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var EPS = 3e-4;        // угловое смещение лучей, рад
  var LIT_BIAS = 4;      // на сколько px подсвеченная область заходит в грань препятствия
  var PUSH = 2.5;        // на сколько px источник выталкивается из препятствия

  /* =====================================================================
   *  ГЕОМЕТРИЯ (чистые функции)
   * ===================================================================== */

  // Ближайшее пересечение луча P + t*D (|D| = 1, t > 0) с набором отрезков.
  // segs — плоский массив [ax, ay, bx, by, ...]. Возвращает t (= расстояние) или Infinity.
  function castRay(px, py, dx, dy, segs) {
    var best = Infinity;
    for (var i = 0; i < segs.length; i += 4) {
      var ax = segs[i], ay = segs[i + 1];
      var ex = segs[i + 2] - ax, ey = segs[i + 3] - ay;
      var den = dx * ey - dy * ex;                 // D x E
      if (den > -1e-12 && den < 1e-12) continue;   // луч параллелен отрезку
      var wx = ax - px, wy = ay - py;
      var t = (wx * ey - wy * ex) / den;           // параметр вдоль луча
      if (t <= 1e-7 || t >= best) continue;
      var u = (wx * dy - wy * dx) / den;           // параметр вдоль отрезка
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      best = t;
    }
    return best;
  }

  function wrapAngle(a) {
    if (a > Math.PI) return a - TAU;
    if (a <= -Math.PI) return a + TAU;
    return a;
  }

  // Полигон видимости из точки (lx, ly).
  // verts — плоский массив всех вершин, segs — все отрезки (включая рамку экрана).
  // Возвращает { pts: [{a, x, y, dx, dy, t, k, vi}], visible: Uint8Array } —
  // точки отсортированы по углу, visible[i] = 1, если вершина i видна напрямую.
  function computeVisibility(lx, ly, segs, verts, eps) {
    var n = verts.length >> 1;
    var pts = [];
    var visible = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var vx = verts[2 * i], vy = verts[2 * i + 1];
      var base = Math.atan2(vy - ly, vx - lx);
      var dist = Math.sqrt((vx - lx) * (vx - lx) + (vy - ly) * (vy - ly));
      for (var k = -1; k <= 1; k++) {
        var a = wrapAngle(base + k * eps);
        var dx = Math.cos(a), dy = Math.sin(a);
        var t = castRay(lx, ly, dx, dy, segs);
        if (t === Infinity) continue;
        if (k === 0 && t >= dist - 0.75) visible[i] = 1;
        pts.push({ a: a, x: lx + dx * t, y: ly + dy * t, dx: dx, dy: dy, t: t, k: k, vi: i });
      }
    }
    pts.sort(function (p, q) { return p.a - q.a; });
    return { pts: pts, visible: visible };
  }

  // Отрезки и вершины сцены: рёбра всех многоугольников + рамка [0,w]x[0,h].
  function buildSegments(polys, w, h) {
    var nv = 0, i, j, nxt;
    for (i = 0; i < polys.length; i++) nv += polys[i].length >> 1;
    var segs = new Float64Array((nv + 4) * 4);
    var verts = new Float64Array((nv + 4) * 2);
    var s = 0, v = 0;
    for (i = 0; i < polys.length; i++) {
      var p = polys[i], n = p.length >> 1;
      for (j = 0; j < n; j++) {
        nxt = (j + 1) % n;
        segs[s++] = p[2 * j]; segs[s++] = p[2 * j + 1];
        segs[s++] = p[2 * nxt]; segs[s++] = p[2 * nxt + 1];
        verts[v++] = p[2 * j]; verts[v++] = p[2 * j + 1];
      }
    }
    var C = [0, 0, w, 0, w, h, 0, h];
    for (j = 0; j < 4; j++) {
      nxt = (j + 1) % 4;
      segs[s++] = C[2 * j]; segs[s++] = C[2 * j + 1];
      segs[s++] = C[2 * nxt]; segs[s++] = C[2 * nxt + 1];
      verts[v++] = C[2 * j]; verts[v++] = C[2 * j + 1];
    }
    return { segs: segs, verts: verts, nObs: nv, nSegs: nv + 4 };
  }

  function pointInPoly(x, y, poly) {
    var inside = false, n = poly.length >> 1;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = poly[2 * i], yi = poly[2 * i + 1], xj = poly[2 * j], yj = poly[2 * j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function nearestOnPoly(x, y, poly) {
    var n = poly.length >> 1, best = Infinity, bx = x, by = y;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var ax = poly[2 * i], ay = poly[2 * i + 1];
      var ex = poly[2 * j] - ax, ey = poly[2 * j + 1] - ay;
      var l2 = ex * ex + ey * ey;
      var t = l2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / l2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var qx = ax + ex * t, qy = ay + ey * t;
      var d = (x - qx) * (x - qx) + (y - qy) * (y - qy);
      if (d < best) { best = d; bx = qx; by = qy; }
    }
    return { x: bx, y: by, d2: best };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function insideAny(x, y, polys) {
    for (var i = 0; i < polys.length; i++) if (pointInPoly(x, y, polys[i])) return true;
    return false;
  }

  // Источник не должен оказаться внутри препятствия — выталкиваем к ближайшей грани.
  function resolveLight(x, y, polys, w, h) {
    for (var it = 0; it < 4; it++) {
      var moved = false;
      for (var i = 0; i < polys.length; i++) {
        var poly = polys[i];
        if (!pointInPoly(x, y, poly)) continue;
        var q = nearestOnPoly(x, y, poly);
        var dx = q.x - x, dy = q.y - y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-6) {                    // точно на ребре — уводим от центра фигуры
          var cx = 0, cy = 0, n = poly.length >> 1;
          for (var j = 0; j < n; j++) { cx += poly[2 * j]; cy += poly[2 * j + 1]; }
          dx = x - cx / n; dy = y - cy / n; d = Math.sqrt(dx * dx + dy * dy) || 1;
        }
        x = q.x + dx / d * PUSH;
        y = q.y + dy / d * PUSH;
        moved = true;
      }
      x = clamp(x, 3, w - 3);
      y = clamp(y, 3, h - 3);
      if (!moved) break;
    }
    return [x, y];
  }

  var Geo = {
    EPS: EPS,
    castRay: castRay,
    computeVisibility: computeVisibility,
    buildSegments: buildSegments,
    pointInPoly: pointInPoly,
    nearestOnPoly: nearestOnPoly,
    resolveLight: resolveLight
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Geo;
  if (typeof document === 'undefined') return;

  /* =====================================================================
   *  СЦЕНА: препятствия
   * ===================================================================== */

  function ngon(n, r, rot) {
    var p = [];
    for (var i = 0; i < n; i++) {
      var a = rot + i * TAU / n;
      p.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    return p;
  }
  function starPts(n, ro, ri, rot) {
    var p = [];
    for (var i = 0; i < n * 2; i++) {
      var a = rot + i * Math.PI / n, r = (i & 1) ? ri : ro;
      p.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    return p;
  }

  // Координаты центров — доли viewport, формы — в px при высоте сцены 900.
  var SHAPES = [
    { fx: 0.20, fy: 0.40, spin:  0.20, ph: 0.3, pts: ngon(6, 72, 0) },                                  // шестиугольник
    { fx: 0.40, fy: 0.20, spin: -0.30, ph: 1.0, pts: ngon(3, 70, -Math.PI / 2) },                       // треугольник
    { fx: 0.60, fy: 0.38, spin:  0.16, ph: 0.0, pts: starPts(5, 98, 42, -Math.PI / 2) },                // звезда (вогнутая)
    { fx: 0.79, fy: 0.24, spin: -0.22, ph: 0.6, pts: ngon(4, 62, Math.PI / 4) },                        // квадрат
    { fx: 0.93, fy: 0.14, spin:  0.25, ph: 2.0, pts: [-55, -34, 55, -34, 38, 34, -38, 34] },            // трапеция
    { fx: 0.88, fy: 0.60, spin: -0.18, ph: 0.4, pts: [-60, -70, -10, -70, -10, 20, 60, 20, 60, 70, -60, 70] }, // Г-образная
    { fx: 0.40, fy: 0.52, spin:  0.12, ph: 0.2, pts: [-20, -62, 20, -62, 20, -20, 62, -20, 62, 20, 20, 20, 20, 62, -20, 62, -20, 20, -62, 20, -62, -20, -20, -20] }, // крест
    { fx: 0.52, fy: 0.74, spin:  0.10, ph: 0.15, pts: [-125, -9, 125, -9, 125, 9, -125, 9] },           // тонкая стена
    { fx: 0.27, fy: 0.70, spin: -0.20, ph: 0.8, pts: ngon(5, 66, -Math.PI / 2) },                       // пятиугольник
    { fx: 0.70, fy: 0.76, spin:  0.18, ph: 0.5, pts: [-56, -48, -16, -48, 56, 0, -16, 48, -56, 48, -16, 0] }, // шеврон (вогнутый)
    { fx: 0.09, fy: 0.74, spin:  0.30, ph: 0.9, pts: ngon(4, 48, 0) },                                  // ромб
    { fx: 0.72, fy: 0.50, spin: -0.40, ph: 1.4, pts: ngon(3, 34, Math.PI / 2) }                         // малая колонна
  ];

  var LIGHT_COLORS = {
    '#ffc27a': [255, 194, 122],
    '#7fc4ff': [127, 196, 255],
    '#ff7fc8': [255, 127, 200],
    '#8dffb0': [141, 255, 176]
  };

  /* =====================================================================
   *  СОСТОЯНИЕ И ХОЛСТЫ
   * ===================================================================== */

  var MAX_PIXELS = 5.2e6;
  var $ = function (id) { return document.getElementById(id); };

  var canvas = $('scene');
  var mctx = canvas.getContext('2d', { alpha: false });

  function makeLayer(alpha) {
    var c = document.createElement('canvas');
    return { c: c, x: c.getContext('2d', { alpha: alpha }) };
  }
  var floorDim = makeLayer(false);      // тёмный пол (статика)
  var floorBright = makeLayer(false);   // освещённый пол (статика)
  var bright = makeLayer(false);        // освещённая сцена: пол + препятствия (каждый кадр)
  var light = makeLayer(true);          // маска света -> освещённая сцена

  var reduceMotion = false;
  try { reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* noop */ }
  if (reduceMotion) $('spin').checked = false;

  var st = {
    w: 0, h: 0, s: 1, kx: 1, ky: 1,
    cw: 0, ch: 0,
    lx: 0, ly: 0,              // позиция источника (после сглаживания и выталкивания)
    tx: 0, ty: 0,              // цель — курсор
    autoAfter: 0,              // с этого момента источник блуждает сам
    autoT: 0,
    first: true,
    sim: 0,                    // время вращения препятствий
    spin: $('spin').checked,
    debug: false,
    range: +$('range').value,
    soft: +$('soft').value,
    rgb: LIGHT_COLORS['#ffc27a'],
    quality: 1, slow: 0, fast: 0,
    polys: SHAPES.map(function () { return null; }),
    geo: null, vis: null, samples: [], R: 800, nSamples: 1
  };

  function T(ctx) { ctx.setTransform(st.kx, 0, 0, st.ky, 0, 0); }
  function I(ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); }

  /* =====================================================================
   *  ПОЛ (рисуется один раз на ресайз)
   * ===================================================================== */

  function paintFloor(ctx, isBright) {
    var w = st.w, h = st.h, s = st.s, g, x, y, i;
    T(ctx);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (isBright) {
      g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#6c7590');
      g.addColorStop(1, '#4b536b');
    } else {
      g = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.sqrt(w * w + h * h) * 0.55);
      g.addColorStop(0, '#10162a');
      g.addColorStop(1, '#04060c');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    var cell = Math.max(36, Math.round(56 * s));

    // шашки
    ctx.fillStyle = isBright ? 'rgba(255,255,255,0.05)' : 'rgba(130,150,255,0.028)';
    var rx, ry;
    for (y = 0, ry = 0; y < h; y += cell, ry++) {
      for (x = 0, rx = 0; x < w; x += cell, rx++) {
        if ((rx + ry) & 1) ctx.fillRect(x, y, cell, cell);
      }
    }

    // сетка: тонкая и крупная (каждая 4-я)
    ctx.lineWidth = 1;
    for (var pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0
        ? (isBright ? 'rgba(255,255,255,0.09)' : 'rgba(120,150,255,0.07)')
        : (isBright ? 'rgba(255,255,255,0.15)' : 'rgba(130,160,255,0.11)');
      ctx.beginPath();
      for (x = 0, i = 0; x <= w; x += cell, i++) {
        if ((pass === 1) !== (i % 4 === 0)) continue;
        ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h);
      }
      for (y = 0, i = 0; y <= h; y += cell, i++) {
        if ((pass === 1) !== (i % 4 === 0)) continue;
        ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5);
      }
      ctx.stroke();
    }

    // заклёпки на пересечениях крупной сетки
    ctx.fillStyle = isBright ? 'rgba(255,255,255,0.16)' : 'rgba(130,160,255,0.12)';
    ctx.beginPath();
    for (y = 0, ry = 0; y <= h; y += cell, ry++) {
      for (x = 0, rx = 0; x <= w; x += cell, rx++) {
        if (rx % 4 === 0 && ry % 4 === 0) { ctx.moveTo(x + 2.4, y); ctx.arc(x, y, 2.4, 0, TAU); }
      }
    }
    ctx.fill();

    // зернистость камня (одинаковые точки на обоих полах)
    var seed = 20241003;
    function rnd() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
    var count = Math.round(w * h / 420);
    var buckets = [[], [], []];
    for (i = 0; i < count; i++) {
      var px = rnd() * w, py = rnd() * h, b = (rnd() * 3) | 0;
      buckets[b].push(px, py);
    }
    var alphas = isBright ? [0.035, 0.06, 0.09] : [0.02, 0.035, 0.05];
    for (var q = 0; q < 3; q++) {
      ctx.fillStyle = (isBright ? 'rgba(255,255,255,' : 'rgba(150,170,255,') + alphas[q] + ')';
      ctx.beginPath();
      var arr = buckets[q];
      for (i = 0; i < arr.length; i += 2) ctx.rect(arr[i], arr[i + 1], 1.3, 1.3);
      ctx.fill();
    }
  }

  function resize() {
    var oldW = st.w, oldH = st.h;
    var w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    var raw = Math.min(window.devicePixelRatio || 1, 2);
    var dpr = Math.max(1, Math.min(raw, Math.sqrt(MAX_PIXELS / (w * h))));
    var cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr));

    st.w = w; st.h = h; st.cw = cw; st.ch = ch;
    st.kx = cw / w; st.ky = ch / h;
    st.s = Math.max(0.35, Math.min(w, h) / 900);

    [canvas, floorDim.c, floorBright.c, bright.c, light.c].forEach(function (c) {
      c.width = cw; c.height = ch;
    });
    paintFloor(floorDim.x, false);
    paintFloor(floorBright.x, true);

    if (oldW > 0) {                       // сохранить положение источника при изменении размера
      var fx = w / oldW, fy = h / oldH;
      st.lx *= fx; st.ly *= fy; st.tx *= fx; st.ty *= fy;
    }
  }

  /* =====================================================================
   *  ОБНОВЛЕНИЕ
   * ===================================================================== */

  function placeShape(shape, cx, cy, s, ang, out) {
    var n = shape.pts.length;
    if (!out || out.length !== n) out = new Float64Array(n);
    var c = Math.cos(ang), sn = Math.sin(ang);
    for (var i = 0; i < n; i += 2) {
      var x = shape.pts[i] * s, y = shape.pts[i + 1] * s;
      out[i] = cx + x * c - y * sn;
      out[i + 1] = cy + x * sn + y * c;
    }
    return out;
  }

  // Точки на диске радиуса r вокруг источника (центр — всегда первым).
  function samplePositions(lx, ly, r, n) {
    var out = [[lx, ly]];
    if (n <= 1 || r < 0.3) return out;
    var golden = 2.399963229728653, m = n - 1;
    for (var i = 0; i < m; i++) {
      var rr = r * Math.sqrt((i + 0.5) / m);
      var a = i * golden + 0.7;
      var x = clamp(lx + Math.cos(a) * rr, 2, st.w - 2);
      var y = clamp(ly + Math.sin(a) * rr, 2, st.h - 2);
      if (insideAny(x, y, st.polys)) continue;      // точка внутри препятствия не светит
      out.push([x, y]);
    }
    return out;
  }

  function update(dt) {
    var w = st.w, h = st.h, s = st.s, i;

    if (st.spin) st.sim += dt;
    for (i = 0; i < SHAPES.length; i++) {
      var sh = SHAPES[i];
      st.polys[i] = placeShape(sh, sh.fx * w, sh.fy * h, s, sh.ph + sh.spin * st.sim, st.polys[i]);
    }
    st.geo = buildSegments(st.polys, w, h);

    // цель: курсор или автономный маршрут (пока курсора нет)
    var tx = st.tx, ty = st.ty;
    if (performance.now() >= st.autoAfter) {
      st.autoT += dt;
      tx = w * (0.5 + 0.40 * Math.sin(0.42 * st.autoT - 0.52));
      ty = h * (0.46 + 0.34 * Math.sin(0.67 * st.autoT));
    }
    if (st.first) { st.lx = tx; st.ly = ty; st.first = false; }
    var k = 1 - Math.exp(-dt / 0.05);
    st.lx += (tx - st.lx) * k;
    st.ly += (ty - st.ly) * k;
    var p = resolveLight(clamp(st.lx, 3, w - 3), clamp(st.ly, 3, h - 3), st.polys, w, h);
    st.lx = p[0]; st.ly = p[1];

    st.R = st.range / 100 * Math.min(w, h);

    // точный полигон видимости из центра источника
    st.vis = computeVisibility(st.lx, st.ly, st.geo.segs, st.geo.verts, EPS);

    // источник конечного размера -> мягкие тени
    var r = st.soft * s;
    var n = r < 0.3 ? 1 : Math.max(6, Math.round(10 * st.quality));
    st.samples = samplePositions(st.lx, st.ly, r, n);
    st.nSamples = st.samples.length;
    st.samplePolys = [st.vis.pts];
    for (i = 1; i < st.samples.length; i++) {
      st.samplePolys.push(computeVisibility(st.samples[i][0], st.samples[i][1], st.geo.segs, st.geo.verts, EPS).pts);
    }
  }

  /* =====================================================================
   *  ОТРИСОВКА
   * ===================================================================== */

  var FALL = [];
  (function () {
    for (var i = 0; i <= 12; i++) {
      var x = i / 12, v = 1 - x * x;
      FALL.push([x, v * v]);            // гладкий спад: (1 - x^2)^2, нулевой наклон на краю
    }
  })();

  function lightGradient(ctx, x, y, R, scale) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, R);
    for (var i = 0; i < FALL.length; i++) {
      g.addColorStop(FALL[i][0], 'rgba(255,255,255,' + (FALL[i][1] * scale).toFixed(4) + ')');
    }
    return g;
  }

  function traceVis(ctx, pts, bias) {
    var n = pts.length;
    if (!n) return;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var p = pts[i];
      var x = p.x + p.dx * bias, y = p.y + p.dy * bias;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawObstacles(ctx, fill, stroke, lw) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    for (var i = 0; i < st.polys.length; i++) {
      var p = st.polys[i];
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (var j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  function render() {
    var lx = st.lx, ly = st.ly, R = st.R, s = st.s, c = st.rgb;
    var pr = st.polys;
    if (!pr[0]) return;

    // 1. тёмная сцена
    I(mctx);
    mctx.globalCompositeOperation = 'source-over';
    mctx.globalAlpha = 1;
    mctx.drawImage(floorDim.c, 0, 0);
    T(mctx);
    drawObstacles(mctx, '#171d32', 'rgba(150,170,235,0.30)', 1.5);

    // 2. освещённая сцена (то, что откроет свет)
    I(bright.x);
    bright.x.drawImage(floorBright.c, 0, 0);
    T(bright.x);
    drawObstacles(bright.x, '#ece4d2', 'rgba(255,248,228,0.95)', 2);

    // 3. маска света: сумма полигонов видимости с радиальным спадом
    var L = light.x;
    I(L);
    L.globalCompositeOperation = 'source-over';
    L.clearRect(0, 0, st.cw, st.ch);
    T(L);
    L.globalCompositeOperation = 'lighter';
    var n = st.samplePolys.length, scale = 1 / n;
    for (var i = 0; i < n; i++) {
      var sp = st.samples[i];
      traceVis(L, st.samplePolys[i], LIT_BIAS);
      L.fillStyle = lightGradient(L, sp[0], sp[1], R, scale);
      L.fill();
    }
    // маска -> освещённая сцена; затем тонировка цветом света
    I(L);
    L.globalCompositeOperation = 'source-in';
    L.drawImage(bright.c, 0, 0);
    L.globalCompositeOperation = 'source-atop';
    L.globalAlpha = 0.45;
    L.fillStyle = rgba(c, 1);
    L.fillRect(0, 0, st.cw, st.ch);
    L.globalAlpha = 1;
    L.globalCompositeOperation = 'source-over';

    I(mctx);
    mctx.drawImage(light.c, 0, 0);

    // 4. свечение вокруг источника
    T(mctx);
    mctx.globalCompositeOperation = 'lighter';

    // широкое мягкое свечение — ограничено полигоном видимости, не просвечивает сквозь стены
    mctx.save();
    traceVis(mctx, st.vis.pts, 0);
    mctx.clip();
    var bloomR = Math.max(240 * s, R * 0.3), g;
    g = mctx.createRadialGradient(lx, ly, 0, lx, ly, bloomR);
    g.addColorStop(0, rgba(c, 0.36));
    g.addColorStop(0.2, rgba(c, 0.20));
    g.addColorStop(0.5, rgba(c, 0.07));
    g.addColorStop(1, rgba(c, 0));
    mctx.fillStyle = g;
    mctx.fillRect(lx - bloomR, ly - bloomR, bloomR * 2, bloomR * 2);
    var washR = R * 0.85;
    g = mctx.createRadialGradient(lx, ly, 0, lx, ly, washR);
    g.addColorStop(0, rgba(c, 0.10));
    g.addColorStop(1, rgba(c, 0));
    mctx.fillStyle = g;
    mctx.fillRect(lx - washR, ly - washR, washR * 2, washR * 2);
    mctx.restore();

    // ядро — горячее, не ограничено (сама лампа)
    var coreR = 38 * s;
    g = mctx.createRadialGradient(lx, ly, 0, lx, ly, coreR);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.22, rgba(c, 0.60));
    g.addColorStop(0.6, rgba(c, 0.15));
    g.addColorStop(1, rgba(c, 0));
    mctx.fillStyle = g;
    mctx.beginPath();
    mctx.arc(lx, ly, coreR, 0, TAU);
    mctx.fill();

    mctx.globalCompositeOperation = 'source-over';
    mctx.fillStyle = '#fffdf6';
    mctx.beginPath();
    mctx.arc(lx, ly, Math.max(3.2, 5 * s), 0, TAU);
    mctx.fill();

    // 5. отладка
    if (st.debug) drawDebug(mctx);
  }

  function drawDebug(ctx) {
    var lx = st.lx, ly = st.ly, pts = st.vis.pts, vis = st.vis.visible;
    var verts = st.geo.verts, nObs = st.geo.nObs;
    var i, p, q;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';

    // заливка полигона видимости
    traceVis(ctx, pts, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();

    // лучи: -ε, +ε, затем центральный (поверх)
    var kinds = [-1, 1, 0];
    var cols = ['rgba(110,200,255,0.40)', 'rgba(255,130,190,0.40)', 'rgba(255,226,120,0.60)'];
    ctx.lineWidth = 1;
    for (q = 0; q < 3; q++) {
      ctx.beginPath();
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        if (p.k !== kinds[q]) continue;
        ctx.moveTo(lx, ly);
        ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = cols[q];
      ctx.stroke();
    }

    // контур полигона
    traceVis(ctx, pts, 0);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();

    // точки пересечения
    ctx.beginPath();
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      var r = p.k === 0 ? 2.4 : 1.6;
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, TAU);
    }
    ctx.fillStyle = 'rgba(110,255,215,0.9)';
    ctx.fill();

    // вершины препятствий: видимые — залитые, скрытые — полые
    ctx.beginPath();
    for (i = 0; i < nObs; i++) {
      if (!vis[i]) continue;
      ctx.moveTo(verts[2 * i] + 4.2, verts[2 * i + 1]);
      ctx.arc(verts[2 * i], verts[2 * i + 1], 4.2, 0, TAU);
    }
    ctx.fillStyle = '#ffd84d';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(20,16,0,0.85)';
    ctx.stroke();

    ctx.beginPath();
    for (i = 0; i < nObs; i++) {
      if (vis[i]) continue;
      ctx.moveTo(verts[2 * i] + 3.4, verts[2 * i + 1]);
      ctx.arc(verts[2 * i], verts[2 * i + 1], 3.4, 0, TAU);
    }
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(175,185,215,0.75)';
    ctx.stroke();

    // перекрестие в точке источника
    ctx.beginPath();
    ctx.moveTo(lx - 12, ly); ctx.lineTo(lx + 12, ly);
    ctx.moveTo(lx, ly - 12); ctx.lineTo(lx, ly + 12);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    ctx.restore();
  }

  /* =====================================================================
   *  УПРАВЛЕНИЕ
   * ===================================================================== */

  function onPointer(e) {
    st.autoAfter = Infinity;
    if (e.target && e.target.closest && e.target.closest('.panel')) return;
    st.tx = e.clientX; st.ty = e.clientY;
  }
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });
  function onRelease(e) {
    if (e.pointerType === 'touch') st.autoAfter = performance.now() + 6000;
  }
  window.addEventListener('pointerup', onRelease, { passive: true });
  window.addEventListener('pointercancel', onRelease, { passive: true });
  window.addEventListener('mouseout', function (e) {
    if (!e.relatedTarget) st.autoAfter = performance.now() + 1800;   // курсор покинул окно
  }, { passive: true });

  var statsEl = $('stats');
  function setDebug(on) {
    st.debug = on;
    statsEl.classList.toggle('on', on);
    if (!on) statsEl.textContent = '';
  }
  $('debug').addEventListener('change', function (e) { setDebug(e.target.checked); });
  $('spin').addEventListener('change', function (e) { st.spin = e.target.checked; });
  $('range').addEventListener('input', function (e) { st.range = +e.target.value; });
  $('soft').addEventListener('input', function (e) {
    st.soft = +e.target.value;
    $('softOut').textContent = e.target.value;
  });

  var swatches = Array.prototype.slice.call(document.querySelectorAll('.sw'));
  swatches.forEach(function (b) {
    b.addEventListener('click', function () {
      swatches.forEach(function (o) { o.setAttribute('aria-checked', o === b ? 'true' : 'false'); });
      st.rgb = LIGHT_COLORS[b.getAttribute('data-color')] || st.rgb;
    });
  });

  window.addEventListener('keydown', function (e) {
    if (e.target && e.target.closest && e.target.closest('input,button')) return;
    if (e.code === 'KeyD') {
      var d = $('debug'); d.checked = !d.checked; setDebug(d.checked);
    } else if (e.code === 'Space') {
      var sp = $('spin'); sp.checked = !sp.checked; st.spin = sp.checked;
      e.preventDefault();
    }
  });

  window.addEventListener('resize', resize);

  /* =====================================================================
   *  ЦИКЛ
   * ===================================================================== */

  var last = 0, statsAt = 0;

  // Адаптация числа сэмплов тени: считаем только «медленные, но живые» кадры,
  // редкие кадры (фоновая вкладка, троттлинг) за нагрузку не принимаются.
  function adapt(raw) {
    if (raw > 0.02 && raw < 0.1) { st.slow++; st.fast = 0; }
    else if (raw < 0.0185) { st.fast++; st.slow = 0; }
    if (st.slow > 24) { st.quality = Math.max(0.6, st.quality - 0.1); st.slow = 0; }
    if (st.fast > 150) { st.quality = Math.min(1, st.quality + 0.1); st.fast = 0; }
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    var raw = last ? (ts - last) / 1000 : 0.016;
    last = ts;
    var dt = Math.min(Math.max(raw, 0), 0.05);
    adapt(raw);
    if (window.innerWidth !== st.w || window.innerHeight !== st.h) resize();
    update(dt);
    render();
    if (st.debug && ts - statsAt > 250) {
      statsAt = ts;
      statsEl.textContent =
        'вершин ' + st.geo.verts.length / 2 + ' · отрезков ' + st.geo.nSegs +
        ' · лучей ' + st.vis.pts.length + ' · ε = ' + EPS + ' рад' +
        (st.nSamples > 1 ? ' · источников тени ' + st.nSamples : '');
    }
  }

  resize();
  st.tx = st.w * 0.30; st.ty = st.h * 0.46;
  requestAnimationFrame(frame);
})();
