/* 2D-свет и тени — полигон видимости (Claude Opus 5.5)
 *
 * Алгоритм на каждый кадр:
 *   1. Все рёбра препятствий + рамка экрана -> список отрезков.
 *   2. Для каждой вершины: угол a = atan2(v - L); три луча под углами a-ε, a, a+ε.
 *   3. Каждый луч пересекается со всеми отрезками (параметрически), берётся ближайшее t > 0.
 *   4. Точки пересечения сортируются по углу луча -> звёздный полигон видимости.
 *   5. Полигон -> маска в буфере света, умножается на радиальный градиент,
 *      затем буфер света умножается на текстуру пола; сверху — свечение источника.
 */
(function () {
  'use strict';

  // ───────── DOM ─────────
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var hudEl = document.getElementById('hud');
  var panelEl = document.getElementById('panel');
  var statsEl = document.getElementById('stats');
  var debugEl = document.getElementById('debug');
  var spinEl = document.getElementById('spin');
  var radiusEl = document.getElementById('radius');
  var radiusOut = document.getElementById('radiusOut');
  var softEl = document.getElementById('soft');
  var softOut = document.getElementById('softOut');
  var swatchesEl = document.getElementById('swatches');
  var shuffleEl = document.getElementById('shuffle');

  var lightCv = document.createElement('canvas');   // буфер освещённости
  var lctx = lightCv.getContext('2d');
  var floorCv = document.createElement('canvas');   // пререндер пола
  var fctx = floorCv.getContext('2d');

  // ───────── Константы ─────────
  var EPS = 1e-4;            // угловое смещение соседних лучей, рад
  var U_TOL = 1e-7;          // допуск параметра u на концах отрезка
  var AMBIENT = 'rgb(24,28,42)';
  var SOFT_SAMPLES = 12;     // выборок источника при мягкой тени
  var WHITE = [255, 255, 255];
  var SHAPE_COUNT = 11;
  var TYPES = ['rect', 'tri', 'hex', 'star', 'L', 'cross', 'U', 'wall', 'blob', 'pent', 'wall', 'rect'];

  var W = 1, H = 1, DPR = 1;
  var state = {
    debug: false,
    spin: false,
    radius: 800,
    soft: 0,
    color: [255, 184, 110],
    seed: 7,
    auto: true
  };

  var shapes = [];     // { cx, cy, r, rot, omega, local:[[x,y]], world:[[x,y]] }
  var segs = [];       // плоский массив: ax, ay, bx, by, ...
  var verts = [];      // плоский массив: x, y, ...
  var mainHits = [];   // отсортированные точки полигона видимости для центра источника
  var light = { x: 0, y: 0 };
  var target = { x: 0, y: 0 };
  var pointer = { active: false, lastTime: -1e9 };
  var time = 0, autoT = 0, lastNow = 0;
  var noiseCv = null;
  var lastStats = '';

  // ───────── Утилиты ─────────
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function rgba(c, a) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a.toFixed(4) + ')';
  }

  function rgbScaled(c, k) {
    return 'rgb(' + Math.round(c[0] * k) + ',' + Math.round(c[1] * k) + ',' + Math.round(c[2] * k) + ')';
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ───────── Формы препятствий (локальные координаты, затем нормировка к радиусу r) ─────────
  function regular(n, phase) {
    var p = [];
    for (var i = 0; i < n; i++) {
      var a = phase + i * Math.PI * 2 / n;
      p.push([Math.cos(a), Math.sin(a)]);
    }
    return p;
  }

  var MAKERS = {
    rect: function (rng) { var h = 0.34 + rng() * 0.36; return [[-1, -h], [1, -h], [1, h], [-1, h]]; },
    tri: function (rng) { return regular(3, rng() * Math.PI * 2); },
    hex: function () { return regular(6, 0); },
    pent: function () { return regular(5, -Math.PI / 2); },
    star: function (rng) {
      var p = [], inner = 0.44 + rng() * 0.1;
      for (var i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? inner : 1;
        p.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      return p;
    },
    L: function () { return [[-1, -1], [-0.25, -1], [-0.25, 0.35], [1, 0.35], [1, 1], [-1, 1]]; },
    cross: function () {
      var t = 0.32;
      return [[-t, -1], [t, -1], [t, -t], [1, -t], [1, t], [t, t], [t, 1], [-t, 1], [-t, t], [-1, t], [-1, -t], [-t, -t]];
    },
    U: function () { return [[-1, -1], [-0.55, -1], [-0.55, 0.45], [0.55, 0.45], [0.55, -1], [1, -1], [1, 1], [-1, 1]]; },
    wall: function () { return [[-1, -0.085], [1, -0.085], [1, 0.085], [-1, 0.085]]; },
    blob: function (rng) {
      var n = 5 + Math.floor(rng() * 3), p = [];
      for (var i = 0; i < n; i++) {
        var a = (i + 0.2 + rng() * 0.6) / n * Math.PI * 2, rr = 0.8 + rng() * 0.2;
        p.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      return p;
    }
  };

  function fitTo(pts, r) {
    var m = 0;
    for (var i = 0; i < pts.length; i++) m = Math.max(m, Math.hypot(pts[i][0], pts[i][1]));
    var k = r / m;
    return pts.map(function (q) { return [q[0] * k, q[1] * k]; });
  }

  function rectOf(el) {
    var b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  }

  function fits(cx, cy, r, gap, rects) {
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      if (Math.hypot(cx - s.cx, cy - s.cy) < r + s.r + gap) return false;
    }
    for (var j = 0; j < rects.length; j++) {
      var q = rects[j];
      var nx = clamp(cx, q.left, q.right), ny = clamp(cy, q.top, q.bottom);
      if (Math.hypot(cx - nx, cy - ny) < r + 14) return false;
    }
    return true;
  }

  function buildScene() {
    var rng = mulberry32(state.seed * 9301 + 49297);
    shapes = [];
    var unit = Math.sqrt(W * H);
    var gap = Math.max(22, unit * 0.04);
    var excl = [rectOf(hudEl), rectOf(panelEl)];
    var types = shuffle(TYPES.slice(), rng);

    for (var tries = 0; shapes.length < SHAPE_COUNT && tries < 3000; tries++) {
      var type = types[shapes.length % types.length];
      var shrink = tries > 1500 ? 0.72 : 1;
      var r = unit * (0.048 + rng() * 0.032) * (type === 'wall' ? 1.6 : 1) * shrink;
      var m = r + 14;
      if (W - 2 * m < 8 || H - 2 * m < 8) continue;
      var cx = m + rng() * (W - 2 * m);
      var cy = m + rng() * (H - 2 * m);
      if (!fits(cx, cy, r, gap, excl)) continue;
      var local = fitTo(MAKERS[type](rng), r);
      shapes.push({
        type: type, cx: cx, cy: cy, r: r,
        rot: rng() * Math.PI * 2,
        omega: (rng() < 0.5 ? -1 : 1) * (0.12 + rng() * 0.22),
        local: local,
        world: local.map(function () { return [0, 0]; })
      });
    }
    updateWorld();
  }

  function addLoop(pts) {
    var n = pts.length;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      segs.push(a[0], a[1], b[0], b[1]);
      verts.push(a[0], a[1]);
    }
  }

  function updateWorld() {
    segs.length = 0;
    verts.length = 0;
    addLoop([[0, 0], [W, 0], [W, H], [0, H]]);          // рамка экрана — тоже препятствие
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i], c = Math.cos(s.rot), sn = Math.sin(s.rot);
      for (var j = 0; j < s.local.length; j++) {
        var p = s.local[j], q = s.world[j];
        q[0] = s.cx + p[0] * c - p[1] * sn;
        q[1] = s.cy + p[0] * sn + p[1] * c;
      }
      addLoop(s.world);
    }
  }

  // ───────── Геометрия ─────────
  // Луч O + t·d (|d| = 1) против отрезка A + u·s:  t = (q×s)/(d×s),  u = (q×d)/(d×s),  q = A − O.
  function castRay(ox, oy, dx, dy) {
    var best = Infinity;
    for (var i = 0, n = segs.length; i < n; i += 4) {
      var ax = segs[i], ay = segs[i + 1];
      var sx = segs[i + 2] - ax, sy = segs[i + 3] - ay;
      var den = dx * sy - dy * sx;
      if (den > -1e-12 && den < 1e-12) continue;       // параллельны
      var qx = ax - ox, qy = ay - oy;
      var t = (qx * sy - qy * sx) / den;
      if (t <= 1e-9 || t >= best) continue;
      var u = (qx * dy - qy * dx) / den;
      if (u < -U_TOL || u > 1 + U_TOL) continue;
      best = t;
    }
    return best;
  }

  function byAngle(p, q) { return p.a - q.a; }

  function visibility(ox, oy) {
    var hits = [];
    for (var i = 0, n = verts.length; i < n; i += 2) {
      var vx = verts[i] - ox, vy = verts[i + 1] - oy;
      if (vx * vx + vy * vy < 1e-10) continue;
      var base = Math.atan2(vy, vx);
      for (var k = -1; k <= 1; k++) {
        var a = base + k * EPS;
        var dx = Math.cos(a), dy = Math.sin(a);
        var t = castRay(ox, oy, dx, dy);
        if (t < Infinity) hits.push({ a: a, x: ox + dx * t, y: oy + dy * t, k: k });
      }
    }
    hits.sort(byAngle);
    return hits;
  }

  function inside(x, y, pts) {
    var c = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  // Источник не может находиться внутри препятствия: выталкиваем к ближайшей точке контура.
  function pushOut(p) {
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      var ddx = p.x - s.cx, ddy = p.y - s.cy;
      if (ddx * ddx + ddy * ddy > (s.r + 2) * (s.r + 2)) continue;
      if (!inside(p.x, p.y, s.world)) continue;
      var w = s.world, n = w.length, best = Infinity, bx = 0, by = 0, nx = 0, ny = 0;
      for (var j = 0; j < n; j++) {
        var a = w[j], b = w[(j + 1) % n];
        var ex = b[0] - a[0], ey = b[1] - a[1];
        var tt = clamp(((p.x - a[0]) * ex + (p.y - a[1]) * ey) / (ex * ex + ey * ey), 0, 1);
        var qx = a[0] + ex * tt, qy = a[1] + ey * tt;
        var d2 = (qx - p.x) * (qx - p.x) + (qy - p.y) * (qy - p.y);
        if (d2 < best) { best = d2; bx = qx; by = qy; nx = ey; ny = -ex; }
      }
      var d = Math.sqrt(best), ux, uy;
      if (d > 1e-6) {
        ux = (bx - p.x) / d; uy = (by - p.y) / d;
      } else {
        var nl = Math.hypot(nx, ny) || 1;
        ux = nx / nl; uy = ny / nl;
        if (inside(bx + ux * 2, by + uy * 2, w)) { ux = -ux; uy = -uy; }
      }
      p.x = bx + ux * 2;
      p.y = by + uy * 2;
    }
  }

  function clampLight(p) {
    p.x = clamp(p.x, 2, W - 2);
    p.y = clamp(p.y, 2, H - 2);
  }

  // Выборки по диску источника (спираль Фогеля) для мягкой полутени.
  function samplePositions() {
    var pts = [[light.x, light.y]];
    if (state.soft <= 0) return pts;
    var n = SOFT_SAMPLES - 1, ga = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < n; i++) {
      var rr = state.soft * Math.sqrt((i + 0.5) / n), a = i * ga;
      var dx = Math.cos(a), dy = Math.sin(a);
      // выборка не должна «перепрыгнуть» через стенку
      var t = castRay(light.x, light.y, dx, dy);
      var d = Math.min(rr, Math.max(0, t - 1.5));
      pts.push([light.x + dx * d, light.y + dy * d]);
    }
    return pts;
  }

  function autoPath(t) {
    return {
      x: W * (0.5 + 0.34 * Math.sin(t * 0.37 + 2.84)),
      y: H * (0.5 + 0.30 * Math.sin(t * 0.53 + 3.31))
    };
  }

  // ───────── Пол (пререндер на ресайзе) ─────────
  function makeNoise() {
    var n = document.createElement('canvas');
    n.width = n.height = 160;
    var g = n.getContext('2d');
    var img = g.createImageData(160, 160), d = img.data, rng = mulberry32(4242);
    for (var i = 0; i < d.length; i += 4) {
      var v = 128 + (rng() - 0.5) * 70;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return n;
  }

  function buildFloor() {
    var f = fctx, rng = mulberry32(1337);
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;
    f.fillStyle = '#3a3d46';
    f.fillRect(0, 0, floorCv.width, floorCv.height);
    f.setTransform(DPR, 0, 0, DPR, 0, 0);

    var T = 54;
    var ox = (W % T) / 2 - T, oy = (H % T) / 2 - T;
    for (var y = oy; y < H + T; y += T) {
      for (var x = ox; x < W + T; x += T) {
        var v = 128 + (rng() - 0.5) * 26;
        f.fillStyle = 'rgb(' + (v | 0) + ',' + ((v + 2) | 0) + ',' + ((v + 7) | 0) + ')';
        f.fillRect(x + 1, y + 1, T - 2, T - 2);
        f.fillStyle = 'rgba(255,255,255,0.08)';
        f.fillRect(x + 1, y + 1, T - 2, 1);
        f.fillRect(x + 1, y + 1, 1, T - 2);
        f.fillStyle = 'rgba(0,0,0,0.14)';
        f.fillRect(x + 1, y + T - 2, T - 2, 1);
        f.fillRect(x + T - 2, y + 1, 1, T - 2);
      }
    }

    // крупные пятна — «живой» камень
    for (var i = 0; i < 18; i++) {
      var px = rng() * W, py = rng() * H, r = 120 + rng() * 320;
      var g = f.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, rng() < 0.6 ? 'rgba(12,10,8,0.11)' : 'rgba(255,250,240,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = g;
      f.fillRect(px - r, py - r, r * 2, r * 2);
    }

    // мелкое зерно
    if (!noiseCv) noiseCv = makeNoise();
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'overlay';
    f.globalAlpha = 0.45;
    f.fillStyle = f.createPattern(noiseCv, 'repeat');
    f.fillRect(0, 0, floorCv.width, floorCv.height);
    f.globalAlpha = 1;
    f.globalCompositeOperation = 'source-over';
  }

  // ───────── Рендер ─────────
  function tracePoly(g, hits) {
    g.moveTo(hits[0].x, hits[0].y);
    for (var i = 1; i < hits.length; i++) g.lineTo(hits[i].x, hits[i].y);
    g.closePath();
  }

  function traceShapes(g) {
    for (var i = 0; i < shapes.length; i++) {
      var w = shapes[i].world;
      g.moveTo(w[0][0], w[0][1]);
      for (var j = 1; j < w.length; j++) g.lineTo(w[j][0], w[j][1]);
      g.closePath();
    }
  }

  function falloff(g, x, y, R, c) {
    var gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, rgbScaled(mix(c, WHITE, 0.45), 1));
    gr.addColorStop(0.06, rgbScaled(mix(c, WHITE, 0.22), 0.94));
    gr.addColorStop(0.2, rgbScaled(c, 0.68));
    gr.addColorStop(0.42, rgbScaled(c, 0.37));
    gr.addColorStop(0.68, rgbScaled(c, 0.14));
    gr.addColorStop(0.88, rgbScaled(c, 0.035));
    gr.addColorStop(1, 'rgb(0,0,0)');
    return gr;
  }

  function render() {
    var c = state.color, R = state.radius;
    var samples = samplePositions();
    mainHits = visibility(light.x, light.y);

    // 1) Буфер света: маска видимости (1/N на выборку) × радиальный градиент + эмбиент.
    var L = lctx;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.globalCompositeOperation = 'source-over';
    L.fillStyle = '#000';
    L.fillRect(0, 0, lightCv.width, lightCv.height);
    L.setTransform(DPR, 0, 0, DPR, 0, 0);
    L.globalCompositeOperation = 'lighter';
    L.fillStyle = 'rgba(255,255,255,' + (1 / samples.length).toFixed(4) + ')';
    for (var i = 0; i < samples.length; i++) {
      var hits = i === 0 ? mainHits : visibility(samples[i][0], samples[i][1]);
      if (hits.length < 3) continue;
      L.beginPath();
      tracePoly(L, hits);
      L.fill();
    }
    L.globalCompositeOperation = 'multiply';
    L.fillStyle = falloff(L, light.x, light.y, R, c);
    L.fillRect(0, 0, W, H);
    L.globalCompositeOperation = 'lighter';
    L.fillStyle = AMBIENT;
    L.fillRect(0, 0, W, H);
    L.globalCompositeOperation = 'source-over';

    // 2) Пол × свет + лёгкая «дымка» света поверх.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(floorCv, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(lightCv, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.2;
    ctx.drawImage(lightCv, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // 3) Препятствия, контровой свет на освещённых рёбрах.
    drawObstacles(c, R);

    // 4) Свечение источника, отладка.
    drawGlow(c);
    if (state.debug) drawDebug(samples);
  }

  function drawObstacles(c, R) {
    if (!shapes.length) return;
    ctx.lineJoin = 'round';

    // контактная тень (AO)
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 26 * DPR;
    ctx.fillStyle = '#171a23';
    ctx.beginPath();
    traceShapes(ctx);
    ctx.fill();
    ctx.restore();

    // верхняя грань: лёгкий оттенок света
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var tint = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, R * 0.75);
    tint.addColorStop(0, rgba(c, 0.13));
    tint.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = tint;
    ctx.beginPath();
    traceShapes(ctx);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.075)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    traceShapes(ctx);
    ctx.stroke();

    // контровой свет: обводка рёбер, обрезанная полигоном видимости,
    // поэтому светятся ровно те участки рёбер, что видны источнику
    if (mainHits.length < 3) return;
    ctx.save();
    ctx.beginPath();
    tracePoly(ctx, mainHits);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    var rim = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, R);
    rim.addColorStop(0, rgba(mix(c, WHITE, 0.55), 1));
    rim.addColorStop(0.35, rgba(c, 0.75));
    rim.addColorStop(1, rgba(c, 0));
    ctx.strokeStyle = rim;
    ctx.beginPath();
    traceShapes(ctx);
    ctx.lineWidth = 3.2;
    ctx.stroke();
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.restore();
  }

  function drawGlow(c) {
    var x = light.x, y = light.y;
    var breathe = 1 + 0.035 * Math.sin(time * 2.1) + 0.015 * Math.sin(time * 5.3);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    var r1 = 120 * breathe;
    var g1 = ctx.createRadialGradient(x, y, 0, x, y, r1);
    g1.addColorStop(0, rgba(c, 0.5));
    g1.addColorStop(0.16, rgba(c, 0.26));
    g1.addColorStop(0.45, rgba(c, 0.07));
    g1.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g1;
    ctx.fillRect(x - r1, y - r1, r1 * 2, r1 * 2);

    var r2 = 18;
    var g2 = ctx.createRadialGradient(x, y, 0, x, y, r2);
    g2.addColorStop(0, 'rgba(255,255,255,1)');
    g2.addColorStop(0.3, rgba(mix(c, WHITE, 0.65), 0.9));
    g2.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g2;
    ctx.fillRect(x - r2, y - r2, r2 * 2, r2 * 2);

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawDebug(samples) {
    var hits = mainHits, x = light.x, y = light.y, i, h;
    ctx.save();
    ctx.lineWidth = 1;

    // лучи ±ε (под центральными)
    ctx.beginPath();
    for (i = 0; i < hits.length; i++) {
      h = hits[i];
      if (h.k === 0) continue;
      ctx.moveTo(x, y); ctx.lineTo(h.x, h.y);
    }
    ctx.strokeStyle = 'rgba(255,110,190,0.42)';
    ctx.stroke();

    // центральные лучи — ровно в вершину (или до заслоняющего ребра)
    ctx.beginPath();
    for (i = 0; i < hits.length; i++) {
      h = hits[i];
      if (h.k !== 0) continue;
      ctx.moveTo(x, y); ctx.lineTo(h.x, h.y);
    }
    ctx.strokeStyle = 'rgba(110,220,255,0.62)';
    ctx.stroke();

    // контур полигона видимости
    if (hits.length >= 3) {
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      tracePoly(ctx, hits);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // точки пересечения, цвет — порядковый номер после сортировки по углу
    var n = Math.max(1, hits.length - 1);
    for (i = 0; i < hits.length; i++) {
      h = hits[i];
      ctx.fillStyle = 'hsl(' + Math.round(i / n * 320) + ',95%,64%)';
      ctx.beginPath();
      ctx.arc(h.x, h.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // вершины препятствий — ромбы
    ctx.beginPath();
    var s = 4.6;
    for (i = 0; i < verts.length; i += 2) {
      var vx = verts[i], vy = verts[i + 1];
      ctx.moveTo(vx, vy - s); ctx.lineTo(vx + s, vy); ctx.lineTo(vx, vy + s); ctx.lineTo(vx - s, vy); ctx.closePath();
    }
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.stroke();
    ctx.fillStyle = '#ffd35a';
    ctx.fill();

    // выборки мягкой тени
    if (samples.length > 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (i = 1; i < samples.length; i++) {
        ctx.moveTo(samples[i][0] + 1.8, samples[i][1]);
        ctx.arc(samples[i][0], samples[i][1], 1.8, 0, Math.PI * 2);
      }
      ctx.stroke();
    }

    // перекрестие источника
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(x - 11, y); ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 4, y); ctx.lineTo(x + 11, y);
    ctx.moveTo(x, y - 11); ctx.lineTo(x, y - 4);
    ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 11);
    ctx.stroke();
    ctx.restore();
  }

  // ───────── Состояние / цикл ─────────
  function update(dt) {
    if (state.spin) {
      for (var i = 0; i < shapes.length; i++) shapes[i].rot += shapes[i].omega * dt;
    }
    updateWorld();

    var auto = !pointer.active && time - pointer.lastTime > 1.2;
    var tx, ty, rate;
    if (auto) {
      autoT += dt;
      var p = autoPath(autoT);
      tx = p.x; ty = p.y; rate = 2.4;
    } else {
      tx = target.x; ty = target.y; rate = 18;
    }
    var k = 1 - Math.exp(-rate * dt);
    light.x += (tx - light.x) * k;
    light.y += (ty - light.y) * k;
    clampLight(light);
    pushOut(light);
    clampLight(light);
    state.auto = auto;
  }

  function updateStats() {
    var s = 'вершин ' + (verts.length / 2) +
      ' · лучей ' + mainHits.length +
      ' · отрезков ' + (segs.length / 4) +
      ' · ε = 10⁻⁴ рад';
    if (state.soft > 0) s += ' · выборок ' + SOFT_SAMPLES;
    s += state.auto ? ' · автопилот' : ' · курсор';
    if (s !== lastStats) { statsEl.textContent = s; lastStats = s; }
  }

  function frame(now) {
    var dt = lastNow ? (now - lastNow) / 1000 : 0;
    lastNow = now;
    if (!(dt >= 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    time += dt;
    update(dt);
    render();
    updateStats();
    requestAnimationFrame(frame);
  }

  function resize() {
    var fx = W > 1 ? light.x / W : 0.5, fy = H > 1 ? light.y / H : 0.5;
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    DPR = Math.min(2, window.devicePixelRatio || 1);
    var pw = Math.max(1, Math.round(W * DPR)), ph = Math.max(1, Math.round(H * DPR));
    canvas.width = pw; canvas.height = ph;
    lightCv.width = pw; lightCv.height = ph;
    floorCv.width = pw; floorCv.height = ph;
    buildFloor();
    buildScene();
    light.x = fx * W; light.y = fy * H;
    clampLight(light);
    pushOut(light);
  }

  // ───────── Управление ─────────
  function setFill(el) {
    var p = (el.value - el.min) / (el.max - el.min) * 100;
    el.style.setProperty('--p', p.toFixed(1) + '%');
  }

  function syncControls() {
    state.radius = +radiusEl.value;
    state.soft = +softEl.value;
    radiusOut.textContent = state.radius + ' px';
    softOut.textContent = state.soft === 0 ? 'резкая' : state.soft + ' px';
    setFill(radiusEl);
    setFill(softEl);
  }

  function setDebug(on) {
    state.debug = on;
    debugEl.checked = on;
    document.body.classList.toggle('is-debug', on);
  }

  function setSpin(on) {
    state.spin = on;
    spinEl.checked = on;
  }

  function newScene() {
    state.seed = (Math.random() * 1e9) | 0;
    buildScene();
    pushOut(light);
  }

  function setColor(btn) {
    var parts = btn.getAttribute('data-c').split(',').map(Number);
    state.color = parts;
    document.documentElement.style.setProperty('--accent', 'rgb(' + parts.join(',') + ')');
    var all = swatchesEl.querySelectorAll('.swatch');
    for (var i = 0; i < all.length; i++) {
      var on = all[i] === btn;
      all[i].classList.toggle('active', on);
      all[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  debugEl.addEventListener('change', function () { setDebug(debugEl.checked); });
  spinEl.addEventListener('change', function () { setSpin(spinEl.checked); });
  radiusEl.addEventListener('input', syncControls);
  softEl.addEventListener('input', syncControls);
  shuffleEl.addEventListener('click', newScene);
  swatchesEl.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.swatch') : null;
    if (b) setColor(b);
  });

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyD') setDebug(!state.debug);
    else if (e.code === 'KeyR') setSpin(!state.spin);
    else if (e.code === 'KeyN') newScene();
  });

  function onPointer(e) {
    if (panelEl.contains(e.target)) return;
    target.x = e.clientX;
    target.y = e.clientY;
    pointer.active = true;
    pointer.lastTime = time;
  }
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });
  window.addEventListener('pointerout', function (e) {
    if (!e.relatedTarget && e.pointerType !== 'touch') pointer.active = false;
  });
  window.addEventListener('blur', function () { pointer.active = false; });
  window.addEventListener('resize', resize);

  // ───────── Старт ─────────
  W = Math.max(1, window.innerWidth);
  H = Math.max(1, window.innerHeight);
  radiusEl.value = Math.round(clamp(Math.max(W, H) * 0.6, 320, 1400) / 10) * 10;
  syncControls();
  resize();
  var p0 = autoPath(0);
  light.x = p0.x; light.y = p0.y;
  clampLight(light);
  pushOut(light);
  requestAnimationFrame(frame);
})();
