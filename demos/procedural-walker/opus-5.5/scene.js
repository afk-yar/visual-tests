/* scene.js — мир: небо, горы, поле с параллаксом, дорожка с метражом, следы.
 * Глубина задаётся коэффициентом k (1 — плоскость человечка): экранный сдвиг и размер
 * объекта ~ k, основание лежит на kY(k) — перспектива пинхол-камеры на высоте глаз. */
(function (root) {
  'use strict';

  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return x - Math.floor(x); }
  function h2(a, b) { return hash(a * 57.13 + b * 131.71); }

  var V = { W: 1, H: 1, ppm: 100, groundY: 0, horizonY: 0, baseX: 0, lift: 2 };
  var skyGrad = null, fieldGrad = null, hazeGrad = null, stars = [];

  function kY(k) { return V.horizonY + (V.groundY - V.horizonY) * k; }
  function kX(X, cam, k) { return V.baseX + (X - cam) * V.ppm * k; }

  function layout(ctx, W, H) {
    V.W = W; V.H = H;
    V.ppm = Math.max(46, Math.min(H * 0.235, W * 0.25));
    V.groundY = Math.round(Math.min(H * 0.72, H - 150));
    if (V.groundY < H * 0.58) V.groundY = Math.round(H * 0.62);
    V.horizonY = V.groundY - 1.15 * V.ppm;          // камера на высоте ~1.15 м
    V.baseX = Math.round(W * (W < 700 ? 0.44 : 0.40));
    V.lift = Math.max(1.5, 0.02 * V.ppm);           // половина толщины стопы: подошва на земле

    skyGrad = ctx.createLinearGradient(0, 0, 0, V.horizonY);
    skyGrad.addColorStop(0, '#060a1d');
    skyGrad.addColorStop(0.45, '#121845');
    skyGrad.addColorStop(0.78, '#2c2c66');
    skyGrad.addColorStop(0.93, '#5e4377');
    skyGrad.addColorStop(1, '#a05c70');

    fieldGrad = ctx.createLinearGradient(0, V.horizonY, 0, H);
    fieldGrad.addColorStop(0, '#2b2452');
    var gpos = Math.min(0.98, (V.groundY - V.horizonY) / Math.max(1, H - V.horizonY));
    fieldGrad.addColorStop(gpos * 0.5, '#1a1840');
    fieldGrad.addColorStop(gpos, '#121331');
    fieldGrad.addColorStop(1, '#06071a');

    hazeGrad = ctx.createLinearGradient(0, V.horizonY - 40, 0, V.horizonY + 30);
    hazeGrad.addColorStop(0, 'rgba(170,96,120,0)');
    hazeGrad.addColorStop(0.55, 'rgba(170,96,120,0.22)');
    hazeGrad.addColorStop(1, 'rgba(170,96,120,0)');

    if (!stars.length) {
      for (var i = 0; i < 170; i++) {
        stars.push({ x: hash(i * 3.1), y: Math.pow(hash(i * 7.7 + 1), 1.35),
          s: 0.6 + 1.4 * Math.pow(hash(i * 1.3 + 5), 3), a: 0.25 + 0.6 * hash(i * 9.1 + 2),
          w: 0.6 + 2.4 * hash(i * 4.4 + 3), p: hash(i * 2.2 + 7) * 6.283 });
      }
    }
  }

  function drawSky(ctx, t) {
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, V.W, V.horizonY + 2);
    var sh = V.horizonY * 0.92;
    ctx.fillStyle = '#e8ebff';
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var y = st.y * sh;
      var fade = 1 - y / sh;
      ctx.globalAlpha = st.a * fade * (0.62 + 0.38 * Math.sin(t * st.w + st.p));
      ctx.fillRect(st.x * V.W, y, st.s, st.s);
    }
    ctx.globalAlpha = 1;

    // луна
    var r = Math.max(13, Math.min(34, Math.min(V.W, V.H) * 0.034));
    var mx = V.W * 0.66, my = Math.max(r * 2.2, V.horizonY * 0.36);
    var gl = ctx.createRadialGradient(mx, my, r * 0.6, mx, my, r * 8);
    gl.addColorStop(0, 'rgba(190,200,255,0.22)');
    gl.addColorStop(1, 'rgba(190,200,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(mx - r * 8, my - r * 8, r * 16, r * 16);
    ctx.fillStyle = '#eceeff';
    ctx.beginPath(); ctx.arc(mx, my, r, 0, 6.2832); ctx.fill();
    ctx.fillStyle = 'rgba(150,158,210,0.28)';
    ctx.beginPath(); ctx.arc(mx - r * 0.3, my - r * 0.2, r * 0.22, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + r * 0.35, my + r * 0.3, r * 0.15, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + r * 0.1, my - r * 0.45, r * 0.1, 0, 6.2832); ctx.fill();
  }

  function ridge(ctx, cam, k, amp, sc, seed, color) {
    var off = cam * V.ppm * k, step = 5, base = V.horizonY + 1;
    ctx.beginPath();
    ctx.moveTo(-step, base + 4);
    for (var x = -step; x <= V.W + step; x += step) {
      var u = (x - V.baseX + off) / sc;
      var n = 0.5 * Math.sin(u + seed) + 0.3 * Math.sin(u * 2.3 + seed * 1.9) + 0.2 * Math.sin(u * 5.1 + seed * 3.1);
      var pk = 1 - Math.abs(Math.sin(u * 0.61 + seed * 0.7));
      ctx.lineTo(x, base - amp * (0.3 + 0.42 * (0.5 + 0.5 * n) + 0.28 * pk * pk));
    }
    ctx.lineTo(V.W + step, base + 4);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Ряд объектов на глубине k: fn(screenX, baseY, scale, rnd, index)
  function row(cam, k, spacing, seed, fn) {
    var sc = V.ppm * k;
    var x0 = cam + (-V.baseX) / sc - spacing * 2;
    var x1 = cam + (V.W - V.baseX) / sc + spacing;
    for (var i = Math.floor(x0 / spacing); i <= Math.ceil(x1 / spacing); i++) {
      var r = h2(i, seed);
      var X = (i + r * 0.8) * spacing;
      fn(kX(X, cam, k), kY(k), sc, r, i);
    }
  }

  function drawTreeLine(ctx, cam) {
    var k = 0.1;
    ctx.fillStyle = '#12123a';
    row(cam, k, 3.4, 11, function (x, y, sc, r, i) {
      if (h2(i, 17) > 0.88) return;   // просветы в лесополосе
      var h = (3.2 + 3.4 * h2(i, 3)) * sc, w = (1.6 + 1.2 * h2(i, 5)) * sc;
      if (r < 0.62) {                  // ель
        ctx.beginPath();
        ctx.moveTo(x, y - h);
        ctx.lineTo(x + w * 0.5, y - h * 0.08);
        ctx.lineTo(x - w * 0.5, y - h * 0.08);
        ctx.closePath(); ctx.fill();
        ctx.fillRect(x - sc * 0.12, y - h * 0.1, sc * 0.24, h * 0.1 + 1);
      } else {                         // лиственное
        ctx.fillRect(x - sc * 0.14, y - h * 0.5, sc * 0.28, h * 0.5 + 1);
        ctx.beginPath(); ctx.arc(x, y - h * 0.62, w * 0.55, 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.arc(x - w * 0.3, y - h * 0.5, w * 0.36, 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.arc(x + w * 0.32, y - h * 0.52, w * 0.34, 0, 6.2832); ctx.fill();
      }
    });
  }

  function drawField(ctx) {
    ctx.fillStyle = fieldGrad;
    ctx.fillRect(0, V.horizonY, V.W, V.H - V.horizonY);
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, V.horizonY - 40, V.W, 70);
  }

  var TUFT_K = [0.18, 0.24, 0.31, 0.39, 0.48, 0.58, 0.69, 0.8];
  function drawTufts(ctx, cam, kMin, kMax) {
    ctx.lineCap = 'round';
    var ks = TUFT_K;
    for (var j = 0; j < ks.length; j++) {
      var k = ks[j];
      if (k < kMin || k >= kMax) continue;
      ctx.strokeStyle = 'rgba(150,150,225,' + (0.16 + 0.14 * (1 - k)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, 0.012 * V.ppm * k);
      ctx.beginPath();
      row(cam, k, 1.7, 40 + j, function (x, y, sc, r, i) {
        if (r > 0.78) return;
        var h = (0.07 + 0.16 * h2(i, j + 90)) * sc;
        var dy = (h2(i, j + 60) - 0.5) * 0.05 * sc;
        ctx.moveTo(x, y + dy); ctx.lineTo(x - h * 0.35, y + dy - h);
        ctx.moveTo(x, y + dy); ctx.lineTo(x + h * 0.05, y + dy - h * 1.2);
        ctx.moveTo(x, y + dy); ctx.lineTo(x + h * 0.4, y + dy - h * 0.85);
      });
      ctx.stroke();
    }
  }

  function drawLamps(ctx, cam) {
    var k = 0.35;
    row(cam, k, 16, 77, function (x, y, sc) {
      if (x < -sc * 3 || x > V.W + sc * 3) return;
      var hgt = 3.8 * sc, top = y - hgt;
      // световое пятно на земле
      ctx.save(); ctx.translate(x + sc * 0.5, y); ctx.scale(1, 0.22);
      var pool = ctx.createRadialGradient(0, 0, 0, 0, 0, sc * 2.4);
      pool.addColorStop(0, 'rgba(255,190,120,0.22)');
      pool.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = pool;
      ctx.beginPath(); ctx.arc(0, 0, sc * 2.4, 0, 6.2832); ctx.fill();
      ctx.restore();
      // столб
      ctx.strokeStyle = '#0b0c24'; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, sc * 0.09);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, top + sc * 0.2);
      ctx.quadraticCurveTo(x, top, x + sc * 0.5, top + sc * 0.05); ctx.stroke();
      // фонарь и ореол
      var lx = x + sc * 0.5, ly = top + sc * 0.16;
      var g = ctx.createRadialGradient(lx, ly, 0, lx, ly, sc * 1.6);
      g.addColorStop(0, 'rgba(255,214,150,0.55)');
      g.addColorStop(0.25, 'rgba(255,180,110,0.18)');
      g.addColorStop(1, 'rgba(255,180,110,0)');
      ctx.fillStyle = g;
      ctx.fillRect(lx - sc * 1.6, ly - sc * 1.6, sc * 3.2, sc * 3.2);
      ctx.fillStyle = '#ffe2b0';
      ctx.beginPath(); ctx.arc(lx, ly, Math.max(1.5, sc * 0.08), 0, 6.2832); ctx.fill();
    });
  }

  function drawLane(ctx, cam) {
    var k0 = 0.88, k1 = 1.12, y0 = kY(k0), y1 = kY(k1);
    ctx.fillStyle = '#1c1e45';
    ctx.fillRect(0, y0, V.W, y1 - y0);
    ctx.fillStyle = 'rgba(150,160,240,0.22)';
    ctx.fillRect(0, y0 - 1, V.W, 1.5);
    ctx.fillStyle = 'rgba(0,0,10,0.35)';
    ctx.fillRect(0, y1, V.W, 2);

    var xa = cam + (-V.baseX) / (V.ppm * k1) - 1, xb = cam + (V.W - V.baseX) / (V.ppm * k0) + 1;
    var i, X;
    // метры: радиальные штрихи, сходящиеся к точке схода
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(140,150,230,0.2)';
    ctx.beginPath();
    for (i = Math.floor(xa * 2); i <= Math.ceil(xb * 2); i++) {
      X = i / 2;
      if (i % 2 === 0) {
        ctx.moveTo(kX(X, cam, k0), y0); ctx.lineTo(kX(X, cam, k1), y1);
      } else {
        ctx.moveTo(kX(X, cam, 1.07), kY(1.07)); ctx.lineTo(kX(X, cam, k1), y1);
      }
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(175,185,255,0.42)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (i = Math.floor(xa / 5); i <= Math.ceil(xb / 5); i++) {
      X = i * 5;
      ctx.moveTo(kX(X, cam, k0 - 0.02), kY(k0 - 0.02)); ctx.lineTo(kX(X, cam, k1 + 0.02), kY(k1 + 0.02));
    }
    ctx.stroke();
    // подписи дистанции
    var fs = Math.round(Math.max(10, Math.min(13, V.ppm * 0.065)));
    ctx.font = '600 ' + fs + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(170,178,240,0.55)';
    var ky = k1 + 0.05;
    for (i = Math.max(0, Math.floor(xa / 5)); i <= Math.ceil(xb / 5); i++) {
      X = i * 5;
      ctx.fillText(X + ' м', kX(X, cam, ky), kY(ky));
    }
  }

  function drawPrints(ctx, walker) {
    var cam = walker.s, fl = Gait.BODY.footLen, prints = walker.prints, t = walker.time;
    for (var i = 0; i < prints.length; i++) {
      var p = prints[i], age = t - p.t;
      var a = 0.34 * Math.max(0, 1 - age / 7);
      if (a <= 0.005) continue;
      var cx = kX(p.x + fl * 0.5, cam, 1);
      if (cx < -60 || cx > V.W + 60) continue;
      var cy = V.groundY + (p.leg === 0 ? 3.5 : -2.5);
      ctx.fillStyle = p.leg === 0 ? 'rgba(120,225,255,' + a.toFixed(3) + ')' : 'rgba(255,190,120,' + (a * 0.8).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(cx, cy, fl * 0.5 * V.ppm * 0.95, Math.max(1.5, V.ppm * 0.011), 0, 0, 6.2832);
      ctx.fill();
    }
  }

  function drawForeground(ctx, cam) {
    var ks = [1.24, 1.42, 1.64, 1.9, 2.2, 2.6];
    ctx.lineCap = 'round';
    for (var j = 0; j < ks.length; j++) {
      var k = ks[j];
      if (kY(k) > V.H + 30) break;
      ctx.strokeStyle = 'rgba(4,5,16,0.9)';
      ctx.fillStyle = 'rgba(40,42,90,0.55)';
      ctx.lineWidth = Math.max(1.2, 0.014 * V.ppm * k);
      ctx.beginPath();
      var pebbles = [];
      row(cam, k, 1.3, 200 + j, function (x, y, sc, r, i) {
        var h = (0.05 + 0.08 * h2(i, j + 300)) * sc;
        if (r < 0.55) {
          ctx.moveTo(x, y); ctx.lineTo(x - h * 0.4, y - h);
          ctx.moveTo(x, y); ctx.lineTo(x + h * 0.1, y - h * 1.25);
          ctx.moveTo(x, y); ctx.lineTo(x + h * 0.45, y - h * 0.8);
        } else if (r > 0.8) {
          pebbles.push(x, y, (0.03 + 0.03 * h2(i, 9)) * sc);
        }
      });
      ctx.stroke();
      for (var q = 0; q < pebbles.length; q += 3) {
        ctx.beginPath();
        ctx.ellipse(pebbles[q], pebbles[q + 1], pebbles[q + 2] * 1.6, pebbles[q + 2] * 0.7, 0, 0, 6.2832);
        ctx.fill();
      }
    }
  }

  function drawBack(ctx, walker, t) {
    var cam = walker.s;
    drawSky(ctx, t);
    ridge(ctx, cam, 0.012, Math.min(V.H * 0.2, 1.1 * V.ppm), 120, 1.3, '#231f4f');
    ridge(ctx, cam, 0.035, Math.min(V.H * 0.12, 0.62 * V.ppm), 80, 4.1, '#191740');
    drawField(ctx);
    drawTreeLine(ctx, cam);
    drawTufts(ctx, cam, 0, 0.35);
    drawLamps(ctx, cam);
    drawTufts(ctx, cam, 0.35, 1);
    drawLane(ctx, cam);
    drawPrints(ctx, walker);
  }

  var api = { V: V, layout: layout, drawBack: drawBack, drawForeground: drawForeground, kX: kX, kY: kY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.World = api;
})(typeof window !== 'undefined' ? window : this);
