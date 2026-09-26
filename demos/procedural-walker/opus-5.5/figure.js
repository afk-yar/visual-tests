/* figure.js — отрисовка человечка и оверлеев (траектории, диаграмма фаз). */
(function (root) {
  'use strict';

  var NEAR = '#f6f4ff', FAR = '#8a8fcb';
  var C_NEAR = '#6fe3ff', C_FAR = '#ffb870', C_HIP = '#c9adff';
  var C_DOUBLE = '#9f8cff', C_FLIGHT = '#ff7d9c';

  function sx(V, x) { return V.baseX + x * V.ppm; }
  function sy(V, y) { return V.groundY - V.lift - y * V.ppm; }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawShadows(ctx, walker, V) {
    var legs = walker.legs, y = walker.pose.pelvisY, ppm = V.ppm, gy = V.groundY + 1;
    var a0 = legs[0].ik, a1 = legs[1].ik;
    var cx = sx(V, (a0.ax + a1.ax) * 0.3 + 0.02);
    var rx = (Math.abs(a0.ax - a1.ax) * 0.5 + 0.28) * ppm;
    var alpha = 0.3 * Math.max(0.4, Math.min(1.2, 1 - (y - 0.9) * 3));
    ctx.save();
    ctx.translate(cx, gy); ctx.scale(1, 0.12);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(0,0,8,' + alpha.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(0,0,8,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.2832); ctx.fill();
    ctx.restore();
    // контактные тени стоп — темнеют по мере приближения к земле
    for (var i = 0; i < 2; i++) {
      var f = legs[i].foot, low = Math.min(f.hy, f.ty);
      var a = 0.45 * Math.max(0, 1 - low / 0.25);
      if (a < 0.01) continue;
      var fx = sx(V, (f.hx + f.tx) * 0.5), fr = (Math.abs(f.tx - f.hx) * 0.5 + 0.03) * ppm;
      ctx.fillStyle = 'rgba(0,0,10,' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(fx, gy, fr, Math.max(1.2, ppm * 0.012), 0, 0, 6.2832); ctx.fill();
    }
  }

  function drawLeg(ctx, leg, pelvisY, V, color, w) {
    var ik = leg.ik, f = leg.foot;
    var ox = ik.ax - f.ax, oy = ik.ay - f.ay;   // стопа следует за фактически достигнутым голеностопом
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(sx(V, leg.hipX), sy(V, pelvisY));
    ctx.lineTo(sx(V, ik.kx), sy(V, ik.ky));
    ctx.lineTo(sx(V, ik.ax), sy(V, ik.ay));
    ctx.stroke();
    ctx.lineWidth = w * 0.78;
    ctx.beginPath();
    ctx.moveTo(sx(V, ik.ax), sy(V, ik.ay));
    ctx.lineTo(sx(V, f.hx + ox), sy(V, f.hy + oy));
    ctx.lineTo(sx(V, f.tx + ox), sy(V, f.ty + oy));
    ctx.stroke();
  }

  function drawArm(ctx, arm, V, color, w) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(sx(V, arm.shx), sy(V, arm.shy));
    ctx.lineTo(sx(V, arm.ex), sy(V, arm.ey));
    ctx.lineTo(sx(V, arm.hx), sy(V, arm.hy));
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(sx(V, arm.hx), sy(V, arm.hy), w * 0.62, 0, 6.2832); ctx.fill();
  }

  function drawFigure(ctx, walker, V, dpr) {
    var B = Gait.BODY, pose = walker.pose, legs = walker.legs, arms = walker.arms, ppm = V.ppm;
    var wLeg = Math.max(3, 0.05 * ppm), wArm = Math.max(2.5, 0.041 * ppm), wTorso = Math.max(4, 0.068 * ppm);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // дальняя сторона — приглушённая, без свечения
    drawArm(ctx, arms[1], V, FAR, wArm * 0.92);
    drawLeg(ctx, legs[1], pose.pelvisY, V, FAR, wLeg * 0.92);

    ctx.save();
    ctx.shadowColor = 'rgba(150,170,255,0.55)';
    ctx.shadowBlur = 12 * dpr;
    // корпус: таз → плечи, шея, голова
    var px = sx(V, 0), py = sy(V, pose.pelvisY);
    var shx = sx(V, pose.sx), shy = sy(V, pose.sy);
    ctx.strokeStyle = NEAR; ctx.lineWidth = wTorso;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px + (shx - px) * 0.5 - wTorso * 0.35, (py + shy) * 0.5, shx, shy);
    ctx.stroke();
    var hx = sx(V, pose.headX), hy = sy(V, pose.headY), hr = B.headR * ppm;
    ctx.lineWidth = wArm;
    ctx.beginPath();
    ctx.moveTo(shx, shy);
    ctx.lineTo(shx + (hx - shx) * 0.55, shy + (hy - shy) * 0.55);
    ctx.stroke();
    ctx.fillStyle = NEAR;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 6.2832); ctx.fill();
    drawLeg(ctx, legs[0], pose.pelvisY, V, NEAR, wLeg);
    ctx.restore();

    // глаз — показывает направление взгляда
    var ex = hx + hr * 0.5 * Math.cos(pose.headTilt) + hr * 0.05, ey = hy - hr * 0.12;
    ctx.fillStyle = '#2d3170';
    ctx.beginPath(); ctx.arc(ex, ey, Math.max(1.2, hr * 0.13), 0, 6.2832); ctx.fill();

    ctx.save();
    ctx.shadowColor = 'rgba(150,170,255,0.5)';
    ctx.shadowBlur = 10 * dpr;
    drawArm(ctx, arms[0], V, NEAR, wArm);
    ctx.restore();
  }

  function fadePolyline(ctx, pts, color, width, headAlpha) {
    var n = pts.length;
    if (n < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    var chunk = 4;
    for (var j = 0; j < n - 1; j += chunk) {
      ctx.globalAlpha = headAlpha * Math.pow((j + chunk) / n, 1.4);
      ctx.beginPath();
      ctx.moveTo(pts[j][0], pts[j][1]);
      for (var q = j + 1; q <= Math.min(n - 1, j + chunk); q++) ctx.lineTo(pts[q][0], pts[q][1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawTraj(ctx, walker, V) {
    var i, tr = walker.trail, ht = walker.hipTrail, cam = walker.s;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var hp = [];
    for (i = 0; i < ht.length; i++) hp.push([V.baseX + (ht[i].x - cam) * V.ppm, sy(V, ht[i].y)]);
    fadePolyline(ctx, hp, C_HIP, 2, 0.9);
    var p0 = [], p1 = [];
    for (i = 0; i < tr.length; i++) {
      p0.push([sx(V, tr[i].x0), sy(V, tr[i].y0)]);
      p1.push([sx(V, tr[i].x1), sy(V, tr[i].y1)]);
    }
    fadePolyline(ctx, p1, C_FAR, 2, 0.75);
    fadePolyline(ctx, p0, C_NEAR, 2.2, 0.95);
  }

  // Точки опоры поверх фигуры: пятка/носок, вокруг которых идёт перекат
  function drawContacts(ctx, walker, V) {
    for (var i = 0; i < 2; i++) {
      var leg = walker.legs[i];
      if (!leg.stance) continue;
      var f = leg.foot, onToe = f.th < 0;
      var cx = sx(V, onToe ? f.tx : f.hx), cy = V.groundY;
      var col = i === 0 ? C_NEAR : C_FAR;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(cx, cy, 2.8, 0, 6.2832); ctx.fill();
    }
  }

  var FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  // Подобрать кегль, чтобы текст уместился в maxW
  function fitFont(ctx, text, maxW, size, weight) {
    var s = size;
    ctx.font = weight + ' ' + s + 'px ' + FONT;
    while (s > 7.5 && ctx.measureText(text).width > maxW) {
      s -= 0.5;
      ctx.font = weight + ' ' + s + 'px ' + FONT;
    }
  }

  // Узкий экран: панель в правой половине (HUD занимает левую), всё в пределах рамки
  function drawPhasesNarrow(ctx, walker, V) {
    var P = walker.P, legs = walker.legs;
    var w = Math.max(140, Math.min(V.W * 0.5 - 14, 260));
    var x = V.W - w - 8, y = 8, h = 118, pad = 10, inner = w - pad * 2;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = 'rgba(14,16,44,0.62)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();

    var nStance = (legs[0].stance ? 1 : 0) + (legs[1].stance ? 1 : 0);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    var title = 'Фазы цикла';
    fitFont(ctx, title, inner, 11.5, '600');
    ctx.fillStyle = 'rgba(235,236,255,0.92)';
    ctx.fillText(title, x + pad, y + 14);
    var state = nStance === 2 ? 'двойная опора' : (nStance === 0 ? 'полёт' : 'одиночная опора');
    fitFont(ctx, state, inner, 10.5, '600');
    ctx.fillStyle = nStance === 2 ? C_DOUBLE : (nStance === 0 ? C_FLIGHT : 'rgba(235,236,255,0.7)');
    ctx.fillText(state, x + pad, y + 29);

    var lw = 42, bx = x + pad + lw, bw = inner - lw, bh = 8;
    var rows = [y + 46, y + 60];
    var names = ['ближн.', 'дальн.'], cols = [C_NEAR, C_FAR];
    for (var i = 0; i < 2; i++) {
      var ry = rows[i];
      fitFont(ctx, names[i], lw - 5, 10, '500');
      ctx.fillStyle = 'rgba(220,222,255,0.72)';
      ctx.fillText(names[i], x + pad, ry);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(bx, ry - bh / 2, bw, bh);
      ctx.fillStyle = cols[i];
      var a = i * 0.5, b = a + P.beta;
      ctx.fillRect(bx + a * bw, ry - bh / 2, (Math.min(b, 1) - a) * bw, bh);
      if (b > 1) ctx.fillRect(bx, ry - bh / 2, (b - 1) * bw, bh);
    }
    var sy0 = y + 70, sh = 6;
    var cuts = [0, 1, P.beta, 0.5, (0.5 + P.beta) % 1].sort(function (p, q) { return p - q; });
    for (var c = 0; c < cuts.length - 1; c++) {
      var s0 = cuts[c], s1 = cuts[c + 1];
      if (s1 - s0 < 1e-4) continue;
      var m = (s0 + s1) / 2, cnt = 0;
      if (m < P.beta) cnt++;
      if ((m + 0.5) % 1 < P.beta) cnt++;
      ctx.fillStyle = cnt === 2 ? C_DOUBLE : (cnt === 0 ? C_FLIGHT : 'rgba(255,255,255,0.16)');
      ctx.fillRect(bx + s0 * bw, sy0, (s1 - s0) * bw, sh);
    }
    fitFont(ctx, 'опора', lw - 5, 10, '500');
    ctx.fillStyle = 'rgba(220,222,255,0.6)';
    ctx.fillText('опора', x + pad, sy0 + sh / 2);
    var cx = bx + walker.phase * bw;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, rows[0] - bh); ctx.lineTo(cx, sy0 + sh + 3); ctx.stroke();

    // подпись — две строки на всю ширину панели
    var l1 = 'опора ' + Math.round(P.beta * 100) + ' % цикла';
    var l2 = P.beta > 0.5 ? 'двойная опора ' + Math.round((2 * P.beta - 1) * 100) + ' %'
      : 'полёт ' + Math.round((1 - 2 * P.beta) * 100) + ' %';
    ctx.fillStyle = 'rgba(210,212,250,0.6)';
    fitFont(ctx, l1, inner, 10, '500');
    ctx.fillText(l1, x + pad, y + 92);
    fitFont(ctx, l2, inner, 10, '500');
    ctx.fillText(l2, x + pad, y + 105);
  }

  function drawPhases(ctx, walker, V) {
    if (V.W < 640) { drawPhasesNarrow(ctx, walker, V); return; }
    var P = walker.P, legs = walker.legs;
    var narrow = false;
    var w = narrow ? Math.max(150, V.W * 0.44) : Math.min(320, Math.max(230, V.W * 0.24));
    var h = narrow ? 92 : 104, x = V.W - w - (narrow ? 10 : 18), y = narrow ? 10 : 18;
    roundRect(ctx, x, y, w, h, 12);
    ctx.fillStyle = 'rgba(14,16,44,0.62)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();

    var nStance = (legs[0].stance ? 1 : 0) + (legs[1].stance ? 1 : 0);
    var fs = narrow ? 10 : 11;
    ctx.textBaseline = 'middle';
    ctx.font = '600 ' + (fs + 1) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(235,236,255,0.92)'; ctx.textAlign = 'left';
    ctx.fillText('Фазы цикла', x + 12, y + 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = nStance === 2 ? C_DOUBLE : (nStance === 0 ? C_FLIGHT : 'rgba(235,236,255,0.7)');
    ctx.fillText(nStance === 2 ? 'двойная опора' : (nStance === 0 ? 'полёт' : 'одиночная опора'), x + w - 12, y + 16);

    var lw = narrow ? 50 : 62, bx = x + lw, bw = w - lw - 12, bh = narrow ? 9 : 11;
    var rows = [y + (narrow ? 34 : 38), y + (narrow ? 50 : 56)];
    ctx.font = '500 ' + fs + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    var names = ['ближняя', 'дальняя'], cols = [C_NEAR, C_FAR];
    for (var i = 0; i < 2; i++) {
      var ry = rows[i];
      ctx.fillStyle = 'rgba(220,222,255,0.72)';
      ctx.fillText(names[i], x + 12, ry);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(bx, ry - bh / 2, bw, bh);
      ctx.fillStyle = cols[i];
      var a = i * 0.5, b = a + P.beta;
      ctx.fillRect(bx + a * bw, ry - bh / 2, (Math.min(b, 1) - a) * bw, bh);
      if (b > 1) ctx.fillRect(bx, ry - bh / 2, (b - 1) * bw, bh);
    }
    // полоса типа опоры
    var sy0 = y + (narrow ? 64 : 72), sh = narrow ? 6 : 7;
    var cuts = [0, 1, P.beta, 0.5, (0.5 + P.beta) % 1].sort(function (p, q) { return p - q; });
    for (var c = 0; c < cuts.length - 1; c++) {
      var s0 = cuts[c], s1 = cuts[c + 1];
      if (s1 - s0 < 1e-4) continue;
      var m = (s0 + s1) / 2, cnt = 0;
      if (m < P.beta) cnt++;
      var m1 = (m + 0.5) % 1; if (m1 < P.beta) cnt++;
      ctx.fillStyle = cnt === 2 ? C_DOUBLE : (cnt === 0 ? C_FLIGHT : 'rgba(255,255,255,0.16)');
      ctx.fillRect(bx + s0 * bw, sy0, (s1 - s0) * bw, sh);
    }
    ctx.fillStyle = 'rgba(220,222,255,0.6)';
    ctx.fillText('опора', x + 12, sy0 + sh / 2);
    // курсор фазы
    var cx = bx + walker.phase * bw;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, rows[0] - bh); ctx.lineTo(cx, sy0 + sh + 3); ctx.stroke();
    // подпись снизу
    ctx.font = '500 ' + (fs - 1) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(210,212,250,0.55)';
    ctx.textAlign = 'left';
    var ly = y + h - (narrow ? 10 : 12);
    var msg = P.beta > 0.5 ? 'двойная опора ' + Math.round((2 * P.beta - 1) * 100) + ' %'
      : 'полёт ' + Math.round((1 - 2 * P.beta) * 100) + ' %';
    ctx.fillText('опора ' + Math.round(P.beta * 100) + ' % цикла · ' + msg, bx, ly);
  }

  var api = { drawShadows: drawShadows, drawFigure: drawFigure, drawTraj: drawTraj,
    drawContacts: drawContacts, drawPhases: drawPhases };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Figure = api;
})(typeof window !== 'undefined' ? window : this);
