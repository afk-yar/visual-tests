/* 2D-свет и тени — Claude Opus 5
   Полигон видимости: лучи к вершинам препятствий (±ε), пересечения луч-отрезок,
   сортировка по углу. Canvas 2D, без сборки и внешних ресурсов. */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var EPS_ANGLE = 0.00035;

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d', { alpha: false });

  var statsEl = document.getElementById('stats');
  var cbDebug = document.getElementById('cbDebug');
  var cbAuto = document.getElementById('cbAuto');
  var cbSoft = document.getElementById('cbSoft');
  var rgRadius = document.getElementById('rgRadius');
  var rgPower = document.getElementById('rgPower');
  var rgHue = document.getElementById('rgHue');
  var outRadius = document.getElementById('outRadius');
  var outPower = document.getElementById('outPower');
  var outHue = document.getElementById('outHue');
  var btnScene = document.getElementById('btnScene');

  var W = 1, H = 1, MIN = 1, DPR = 1;

  var bgCanvas = document.createElement('canvas');
  var noiseCanvas = makeNoise(128);

  var seed = 20260816;
  var descriptors = buildDescriptors(seed);

  var polys = [];   // [[{x,y}...], ...]
  var segs = [];    // {ax,ay,bx,by}
  var edges = [];   // {ax,ay,bx,by,nx,ny}
  var verts = [];   // уникальные опорные вершины (углы для лучей)

  var light = { x: 0, y: 0 };
  var aim = { x: 0, y: 0 };
  var manual = false;
  var lastPointer = -1e9;
  var haveAim = false;

  var t0 = now();
  var prev = t0;
  var frames = 0, fpsMark = t0, fps = 0, statMark = 0;
  var lastPolyCount = 0, lastSamples = 1;

  function now() { return performance.now() / 1000; }

  /* ---------------- ГСЧ и описание сцены ---------------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Препятствия задаются в нормированных координатах, чтобы сцена
  // переживала resize без пересоздания.
  function buildDescriptors(s) {
    var rng = mulberry32(s);
    var list = [];
    var REF = 1.55; // условное соотношение сторон для проверки перекрытий
    var want = 8, guard = 0;

    while (list.length < want && guard++ < 1200) {
      var wall = rng() < 0.3;
      var r = wall ? 0.10 + rng() * 0.07 : 0.048 + rng() * 0.068;
      var cx = 0.11 + rng() * 0.78;
      var cy = 0.15 + rng() * 0.70;

      var ok = true;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        var dx = (cx - o.cx) * REF, dy = cy - o.cy;
        if (Math.sqrt(dx * dx + dy * dy) < (r + o.r) * 1.2 + 0.035) { ok = false; break; }
      }
      if (!ok) continue;

      var n = 4, star = false, elong = 1;
      if (wall) {
        n = 4; elong = 0.10 + rng() * 0.13;
      } else {
        var k = rng();
        if (k < 0.22) n = 3;
        else if (k < 0.44) { n = 4; elong = 0.5 + rng() * 0.45; }
        else if (k < 0.66) n = 5;
        else if (k < 0.84) n = 6;
        else { n = 5; star = true; }
      }

      var count = star ? n * 2 : n;
      var rad = [], ang = [];
      for (var j = 0; j < count; j++) {
        rad.push(0.84 + rng() * 0.32);
        ang.push((rng() - 0.5) * 0.20);
      }

      list.push({
        cx: cx, cy: cy, r: r, star: star, elong: elong,
        rot: rng() * TAU, rad: rad, ang: ang
      });
    }
    return list;
  }

  /* ---------------- Геометрия сцены в пикселях ---------------- */

  function rebuildGeometry() {
    polys = [];
    for (var i = 0; i < descriptors.length; i++) {
      polys.push(makePolygon(descriptors[i]));
    }

    segs = [];
    edges = [];
    verts = [];

    // рамка мира: лучи всегда во что-то упираются
    var b = 0.5;
    pushSegment(b, b, W - b, b);
    pushSegment(W - b, b, W - b, H - b);
    pushSegment(W - b, H - b, b, H - b);
    pushSegment(b, H - b, b, b);
    verts.push({ x: b + 1, y: b + 1 }, { x: W - b - 1, y: b + 1 },
               { x: W - b - 1, y: H - b - 1 }, { x: b + 1, y: H - b - 1 });

    for (var p = 0; p < polys.length; p++) {
      var poly = polys[p];
      var area = 0;
      for (var a = 0, z = poly.length - 1; a < poly.length; z = a++) {
        area += poly[z].x * poly[a].y - poly[a].x * poly[z].y;
      }
      var ccw = area > 0;

      for (var e = 0; e < poly.length; e++) {
        var A = poly[e], B = poly[(e + 1) % poly.length];
        pushSegment(A.x, A.y, B.x, B.y);
        var dx = B.x - A.x, dy = B.y - A.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var nx = ccw ? dy / len : -dy / len;
        var ny = ccw ? -dx / len : dx / len;
        edges.push({ ax: A.x, ay: A.y, bx: B.x, by: B.y, nx: nx, ny: ny });
        verts.push({ x: A.x, y: A.y });
      }
    }
  }

  function pushSegment(ax, ay, bx, by) {
    segs.push({ ax: ax, ay: ay, bx: bx, by: by });
  }

  function makePolygon(s) {
    var count = s.rad.length;
    var cx = s.cx * W, cy = s.cy * H, R = s.r * MIN;
    var ca = Math.cos(s.rot), sa = Math.sin(s.rot);
    var pts = [];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (var j = 0; j < count; j++) {
      var a = (j / count) * TAU + s.ang[j];
      var rr = R * s.rad[j] * (s.star && (j % 2 === 1) ? 0.46 : 1);
      var lx = Math.cos(a) * rr;
      var ly = Math.sin(a) * rr * s.elong;
      var x = cx + lx * ca - ly * sa;
      var y = cy + lx * sa + ly * ca;
      pts.push({ x: x, y: y });
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }

    // втянуть фигуру внутрь кадра, если вылезла за рамку
    var pad = 16;
    var ox = 0, oy = 0;
    if (minX < pad) ox = pad - minX;
    if (maxX + ox > W - pad) ox -= (maxX + ox) - (W - pad);
    if (minX + ox < pad) ox = (W - (minX + maxX)) / 2;
    if (minY < pad) oy = pad - minY;
    if (maxY + oy > H - pad) oy -= (maxY + oy) - (H - pad);
    if (minY + oy < pad) oy = (H - (minY + maxY)) / 2;

    if (ox || oy) {
      for (var k = 0; k < pts.length; k++) { pts[k].x += ox; pts[k].y += oy; }
    }
    return pts;
  }

  /* ---------------- Полигон видимости ---------------- */

  // Ближайшее пересечение луча (lx,ly)+t*(dx,dy) со всеми отрезками сцены.
  function castRay(lx, ly, dx, dy, maxT) {
    var best = maxT;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      var sx = s.bx - s.ax, sy = s.by - s.ay;
      var den = dx * sy - dy * sx;
      if (den < 1e-12 && den > -1e-12) continue; // параллельны
      var qx = s.ax - lx, qy = s.ay - ly;
      var t = (qx * sy - qy * sx) / den;
      if (t <= 1e-6 || t >= best) continue;
      var u = (qx * dy - qy * dx) / den;
      if (u < 0 || u > 1) continue;
      best = t;
    }
    return best;
  }

  function visibilityPolygon(lx, ly) {
    var maxT = Math.max(W, H) * 2;
    var out = [];
    for (var i = 0; i < verts.length; i++) {
      var base = Math.atan2(verts[i].y - ly, verts[i].x - lx);
      for (var k = -1; k <= 1; k++) {
        var a = base + k * EPS_ANGLE;
        var dx = Math.cos(a), dy = Math.sin(a);
        var t = castRay(lx, ly, dx, dy, maxT);
        out.push({ x: lx + dx * t, y: ly + dy * t, a: a });
      }
    }
    out.sort(function (p, q) { return p.a - q.a; });
    return out;
  }

  // Виден ли отрезок света до точки (без учёта касания в самой точке).
  function isVisible(lx, ly, px, py) {
    var dx = px - lx, dy = py - ly;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      var sx = s.bx - s.ax, sy = s.by - s.ay;
      var den = dx * sy - dy * sx;
      if (den < 1e-12 && den > -1e-12) continue;
      var qx = s.ax - lx, qy = s.ay - ly;
      var t = (qx * sy - qy * sx) / den;
      if (t <= 1e-4 || t >= 0.9985) continue;
      var u = (qx * dy - qy * dx) / den;
      if (u < 0 || u > 1) continue;
      return false;
    }
    return true;
  }

  /* ---------------- Источник не должен попадать внутрь препятствия --------- */

  function pointInPoly(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function pushOutside(pt) {
    for (var pass = 0; pass < 2; pass++) {
      var moved = false;
      for (var p = 0; p < polys.length; p++) {
        var poly = polys[p];
        if (!pointInPoly(pt.x, pt.y, poly)) continue;
        var bestD = Infinity, bx = pt.x, by = pt.y;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          var ax = poly[j].x, ay = poly[j].y;
          var ex = poly[i].x - ax, ey = poly[i].y - ay;
          var l2 = ex * ex + ey * ey || 1;
          var u = ((pt.x - ax) * ex + (pt.y - ay) * ey) / l2;
          u = u < 0 ? 0 : (u > 1 ? 1 : u);
          var qx = ax + ex * u, qy = ay + ey * u;
          var d = (qx - pt.x) * (qx - pt.x) + (qy - pt.y) * (qy - pt.y);
          if (d < bestD) { bestD = d; bx = qx; by = qy; }
        }
        var dx = bx - pt.x, dy = by - pt.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-4) { dx = 1; dy = 0; len = 1; }
        pt.x = bx + (dx / len) * 6;
        pt.y = by + (dy / len) * 6;
        moved = true;
      }
      if (!moved) break;
    }
    pt.x = Math.max(8, Math.min(W - 8, pt.x));
    pt.y = Math.max(8, Math.min(H - 8, pt.y));
    return pt;
  }

  /* ---------------- Фон ---------------- */

  function makeNoise(size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var img = g.createImageData(size, size);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var v = (Math.random() * 255) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 22;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function gridPath(c, w, h, step) {
    c.beginPath();
    for (var x = step; x < w; x += step) { c.moveTo((x | 0) + 0.5, 0); c.lineTo((x | 0) + 0.5, h); }
    for (var y = step; y < h; y += step) { c.moveTo(0, (y | 0) + 0.5); c.lineTo(w, (y | 0) + 0.5); }
  }

  var GRID = 48;

  function buildBackground() {
    bgCanvas.width = Math.max(1, Math.round(W * DPR));
    bgCanvas.height = Math.max(1, Math.round(H * DPR));
    var b = bgCanvas.getContext('2d');
    b.setTransform(DPR, 0, 0, DPR, 0, 0);

    var g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0d17');
    g.addColorStop(1, '#04050b');
    b.fillStyle = g;
    b.fillRect(0, 0, W, H);

    var rg = b.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, Math.max(W, H) * 0.8);
    rg.addColorStop(0, 'rgba(46, 68, 122, 0.30)');
    rg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    b.fillStyle = rg;
    b.fillRect(0, 0, W, H);

    gridPath(b, W, H, GRID);
    b.strokeStyle = 'rgba(150, 185, 255, 0.055)';
    b.lineWidth = 1;
    b.stroke();

    var pat = b.createPattern(noiseCanvas, 'repeat');
    if (pat) {
      b.globalAlpha = 0.5;
      b.fillStyle = pat;
      b.fillRect(0, 0, W, H);
      b.globalAlpha = 1;
    }

    var vg = b.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32,
                                    W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.60)');
    b.fillStyle = vg;
    b.fillRect(0, 0, W, H);
  }

  /* ---------------- Отрисовка ---------------- */

  function tracePoly(c, poly) {
    c.beginPath();
    c.moveTo(poly[0].x, poly[0].y);
    for (var i = 1; i < poly.length; i++) c.lineTo(poly[i].x, poly[i].y);
    c.closePath();
  }

  function lightGradient(x, y, R, hue, power, alphaScale) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, R);
    var k = power * alphaScale;
    g.addColorStop(0.00, 'hsla(' + hue + ', 100%, 93%, ' + (0.95 * k) + ')');
    g.addColorStop(0.06, 'hsla(' + hue + ', 96%, 80%, ' + (0.72 * k) + ')');
    g.addColorStop(0.22, 'hsla(' + hue + ', 90%, 64%, ' + (0.36 * k) + ')');
    g.addColorStop(0.52, 'hsla(' + (hue + 6) + ', 84%, 52%, ' + (0.14 * k) + ')');
    g.addColorStop(0.80, 'hsla(' + (hue + 12) + ', 80%, 46%, ' + (0.04 * k) + ')');
    g.addColorStop(1.00, 'hsla(' + (hue + 12) + ', 80%, 44%, 0)');
    return g;
  }

  function render(time) {
    var hue = +rgHue.value;
    var power = +rgPower.value / 100;
    var R = (+rgRadius.value / 100) * MIN * 1.15;
    var soft = cbSoft.checked;
    var debug = cbDebug.checked;

    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(bgCanvas, 0, 0, W, H);

    // источники: центр + кольцо сэмплов для полутени
    var samples = [{ x: light.x, y: light.y }];
    if (soft) {
      var sr = Math.max(6, MIN * 0.011);
      for (var s = 0; s < 4; s++) {
        var a = (s / 4) * TAU + 0.6;
        samples.push(pushOutside({ x: light.x + Math.cos(a) * sr, y: light.y + Math.sin(a) * sr }));
      }
    }
    lastSamples = samples.length;

    var centerPoly = null;
    var alphaScale = 1 / samples.length;

    for (var k = 0; k < samples.length; k++) {
      var sp = samples[k];
      var poly = visibilityPolygon(sp.x, sp.y);
      if (k === 0) { centerPoly = poly; lastPolyCount = poly.length; }
      if (poly.length < 3) continue;

      ctx.save();
      tracePoly(ctx, poly);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = lightGradient(sp.x, sp.y, R, hue, power, alphaScale);
      ctx.fillRect(sp.x - R, sp.y - R, R * 2, R * 2);
      ctx.restore();
    }

    // фактура пола проступает только в освещённой зоне
    if (centerPoly && centerPoly.length > 2) {
      ctx.save();
      tracePoly(ctx, centerPoly);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      gridPath(ctx, W, H, GRID);
      ctx.strokeStyle = 'hsla(' + hue + ', 70%, 70%, 0.055)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // ореол вокруг источника
      var gr = Math.min(R * 0.5, MIN * 0.16);
      var gg = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, gr);
      gg.addColorStop(0, 'hsla(' + hue + ', 100%, 96%, ' + (0.55 * power) + ')');
      gg.addColorStop(0.25, 'hsla(' + hue + ', 98%, 82%, ' + (0.18 * power) + ')');
      gg.addColorStop(1, 'hsla(' + hue + ', 95%, 70%, 0)');
      ctx.fillStyle = gg;
      ctx.fillRect(light.x - gr, light.y - gr, gr * 2, gr * 2);
      ctx.restore();
    }

    // препятствия поверх света + подсветка обращённых к лампе рёбер
    ctx.globalCompositeOperation = 'source-over';
    for (var p = 0; p < polys.length; p++) {
      tracePoly(ctx, polys[p]);
      ctx.fillStyle = '#070910';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 150, 210, 0.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    drawRims(hue, power, R);

    // сама лампа
    ctx.globalCompositeOperation = 'lighter';
    var cr = 16;
    var cg = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, cr);
    cg.addColorStop(0, 'rgba(255,255,255,0.95)');
    cg.addColorStop(0.35, 'hsla(' + hue + ', 100%, 80%, 0.45)');
    cg.addColorStop(1, 'hsla(' + hue + ', 100%, 70%, 0)');
    ctx.fillStyle = cg;
    ctx.fillRect(light.x - cr, light.y - cr, cr * 2, cr * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.arc(light.x, light.y, 3, 0, TAU);
    ctx.fillStyle = 'rgba(255,253,246,0.98)';
    ctx.fill();

    if (debug && centerPoly) drawDebug(centerPoly);
  }

  function drawRims(hue, power, R) {
    ctx.lineCap = 'round';
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      var dx = e.bx - e.ax, dy = e.by - e.ay;
      var i0 = rimAt(e, e.ax + dx * 0.02, e.ay + dy * 0.02, R);
      var i1 = rimAt(e, e.ax + dx * 0.5, e.ay + dy * 0.5, R);
      var i2 = rimAt(e, e.ax + dx * 0.98, e.ay + dy * 0.98, R);
      if (i0 + i1 + i2 < 0.01) continue;

      var g = ctx.createLinearGradient(e.ax, e.ay, e.bx, e.by);
      var m = power;
      g.addColorStop(0, 'hsla(' + hue + ', 100%, 82%, ' + (0.85 * i0 * m) + ')');
      g.addColorStop(0.5, 'hsla(' + hue + ', 100%, 82%, ' + (0.85 * i1 * m) + ')');
      g.addColorStop(1, 'hsla(' + hue + ', 100%, 82%, ' + (0.85 * i2 * m) + ')');

      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = g;
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.30;
      ctx.beginPath();
      ctx.moveTo(e.ax, e.ay); ctx.lineTo(e.bx, e.by);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(e.ax, e.ay); ctx.lineTo(e.bx, e.by);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  function rimAt(e, px, py, R) {
    var dx = light.x - px, dy = light.y - py;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var ndl = (e.nx * dx + e.ny * dy) / d;
    if (ndl <= 0.02) return 0;
    var fall = 1 - d / R;
    if (fall <= 0) return 0;
    fall = fall * fall;
    if (!isVisible(light.x, light.y, px, py)) return 0;
    return ndl * fall;
  }

  function drawDebug(poly) {
    ctx.globalCompositeOperation = 'source-over';

    ctx.beginPath();
    for (var i = 0; i < poly.length; i++) {
      ctx.moveTo(light.x, light.y);
      ctx.lineTo(poly[i].x, poly[i].y);
    }
    ctx.strokeStyle = 'rgba(120, 205, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    tracePoly(ctx, poly);
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    for (var k = 0; k < poly.length; k++) {
      ctx.moveTo(poly[k].x + 1.7, poly[k].y);
      ctx.arc(poly[k].x, poly[k].y, 1.7, 0, TAU);
    }
    ctx.fillStyle = 'rgba(150, 235, 255, 0.85)';
    ctx.fill();

    ctx.beginPath();
    for (var p = 0; p < polys.length; p++) {
      var pl = polys[p];
      for (var v = 0; v < pl.length; v++) {
        ctx.moveTo(pl[v].x + 3.6, pl[v].y);
        ctx.arc(pl[v].x, pl[v].y, 3.6, 0, TAU);
      }
    }
    ctx.fillStyle = 'rgba(255, 96, 150, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 220, 235, 0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* ---------------- Движение источника ---------------- */

  function autoPos(t) {
    var x = W * (0.5 + 0.28 * Math.sin(t * 0.21 - 0.5) + 0.09 * Math.sin(t * 0.53 + 0.9));
    var y = H * (0.42 + 0.20 * Math.sin(t * 0.27 + 0.3) + 0.08 * Math.sin(t * 0.13 - 1.2));
    return { x: x, y: y };
  }

  function updateLight(t, dt) {
    var autoOn = cbAuto.checked;
    if (manual && autoOn && t - lastPointer > 4) manual = false;

    var goal;
    if (!manual && autoOn) {
      goal = autoPos(t);
    } else if (haveAim) {
      goal = { x: aim.x, y: aim.y };
    } else {
      goal = autoPos(t);
    }
    pushOutside(goal);

    var k = 1 - Math.exp(-9 * dt);
    light.x += (goal.x - light.x) * k;
    light.y += (goal.y - light.y) * k;
    pushOutside(light);
  }

  /* ---------------- Цикл ---------------- */

  function frame() {
    var t = now();
    var dt = Math.min(0.05, Math.max(0.0005, t - prev));
    prev = t;
    var elapsed = t - t0;

    updateLight(elapsed, dt);
    render(elapsed);

    frames++;
    if (t - fpsMark >= 0.5) {
      fps = Math.round(frames / (t - fpsMark));
      frames = 0; fpsMark = t;
    }
    if (t - statMark >= 0.25) {
      statMark = t;
      statsEl.textContent =
        'вершин: ' + verts.length +
        ' · лучей: ' + (verts.length * 3 * lastSamples) +
        ' · отрезков: ' + segs.length +
        ' · точек полигона: ' + lastPolyCount +
        ' · ' + fps + ' fps';
    }

    requestAnimationFrame(frame);
  }

  /* ---------------- Размеры и события ---------------- */

  function resize() {
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    MIN = Math.min(W, H);
    DPR = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    buildBackground();
    rebuildGeometry();

    if (light.x === 0 && light.y === 0) {
      var p = autoPos(0);
      light.x = p.x; light.y = p.y;
    }
    pushOutside(light);
  }

  function overPanel(e) {
    var t = e.target;
    return !!(t && t.closest && t.closest('.panel'));
  }

  function onPointer(e) {
    if (overPanel(e)) return; // возня с ползунками не должна дёргать лампу
    aim.x = e.clientX;
    aim.y = e.clientY;
    haveAim = true;
    manual = true;
    lastPointer = now() - t0;
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });

  window.addEventListener('keydown', function (e) {
    if (e.code === 'KeyD') { cbDebug.checked = !cbDebug.checked; }
    else if (e.code === 'KeyA') {
      cbAuto.checked = !cbAuto.checked;
      cbAuto.dispatchEvent(new Event('change'));
    }
    else if (e.code === 'KeyS') { cbSoft.checked = !cbSoft.checked; }
    else if (e.code === 'KeyR') { newScene(); }
    else return;
    e.preventDefault();
  });

  function newScene() {
    seed = (Math.random() * 1e9) | 0;
    descriptors = buildDescriptors(seed);
    rebuildGeometry();
    pushOutside(light);
  }

  btnScene.addEventListener('click', newScene);

  function syncOutputs() {
    outRadius.textContent = rgRadius.value + '%';
    outPower.textContent = rgPower.value + '%';
    outHue.textContent = rgHue.value + '°';
  }
  rgRadius.addEventListener('input', syncOutputs);
  rgPower.addEventListener('input', syncOutputs);
  rgHue.addEventListener('input', syncOutputs);
  cbAuto.addEventListener('change', function () {
    if (cbAuto.checked) {
      manual = false;
    } else {
      manual = true;
      if (!haveAim) { aim.x = light.x; aim.y = light.y; haveAim = true; }
    }
  });

  syncOutputs();
  resize();
  requestAnimationFrame(frame);
})();
