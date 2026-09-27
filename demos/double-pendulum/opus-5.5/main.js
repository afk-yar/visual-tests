/*
 * Двойной маятник — Claude Opus 5.5
 *
 * Модель: две точечные массы m1, m2 на невесомых жёстких стержнях L1, L2,
 * идеальные шарниры, без трения. Углы θ1, θ2 отсчитываются от вертикали вниз:
 * x = L·sinθ, y = L·cosθ (ось y направлена вниз — как на экране).
 *
 * Уравнения движения (Эйлер — Лагранж для L = T − V), Δ = θ1 − θ2,
 * D = 2m1 + m2 − m2·cos 2Δ:
 *   θ1'' = [−g(2m1+m2)·sinθ1 − m2·g·sin(θ1−2θ2) − 2·sinΔ·m2·(ω2²L2 + ω1²L1·cosΔ)] / (L1·D)
 *   θ2'' = [2·sinΔ·(ω1²L1(m1+m2) + g(m1+m2)·cosθ1 + ω2²L2·m2·cosΔ)] / (L2·D)
 *
 * Интегратор — классический RK4 с фиксированным шагом 0,2 мс. Время симуляции
 * идёт вровень с настенным (реальное время); большой кадровый dt клампится.
 *
 * Файл dual-mode: в браузере запускает демку, в node отдаёт физику через
 * module.exports (для проверки уравнений и сохранения энергии).
 */
(function () {
  'use strict';

  var G = 9.81;
  var TAU = Math.PI * 2;

  /* ---------------- Физика (чистые функции) ---------------- */

  // s = [θ1, ω1, θ2, ω2]; out = ds/dt
  function deriv(s, p, out) {
    var t1 = s[0], w1 = s[1], t2 = s[2], w2 = s[3];
    var m1 = p.m1, m2 = p.m2, L1 = p.L1, L2 = p.L2, g = p.g;
    var d = t1 - t2, sd = Math.sin(d), cd = Math.cos(d);
    var den = 2 * m1 + m2 - m2 * Math.cos(2 * d); // = 2m1 + 2m2·sin²Δ > 0
    out[0] = w1;
    out[1] = (-g * (2 * m1 + m2) * Math.sin(t1)
      - m2 * g * Math.sin(t1 - 2 * t2)
      - 2 * sd * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * cd)) / (L1 * den);
    out[2] = w2;
    out[3] = (2 * sd * (w1 * w1 * L1 * (m1 + m2)
      + g * (m1 + m2) * Math.cos(t1)
      + w2 * w2 * L2 * m2 * cd)) / (L2 * den);
  }

  function makeScratch() {
    return {
      k1: new Float64Array(4), k2: new Float64Array(4),
      k3: new Float64Array(4), k4: new Float64Array(4),
      tmp: new Float64Array(4)
    };
  }

  // Один шаг классического Рунге — Кутты 4-го порядка (на месте).
  function rk4Step(s, p, h, S) {
    var k1 = S.k1, k2 = S.k2, k3 = S.k3, k4 = S.k4, t = S.tmp, i;
    deriv(s, p, k1);
    for (i = 0; i < 4; i++) t[i] = s[i] + 0.5 * h * k1[i];
    deriv(t, p, k2);
    for (i = 0; i < 4; i++) t[i] = s[i] + 0.5 * h * k2[i];
    deriv(t, p, k3);
    for (i = 0; i < 4; i++) t[i] = s[i] + h * k3[i];
    deriv(t, p, k4);
    for (i = 0; i < 4; i++) s[i] += h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }

  // Полная механическая энергия (потенциал отсчитывается от уровня шарнира).
  function energy(s, p) {
    var t1 = s[0], w1 = s[1], t2 = s[2], w2 = s[3];
    var L1 = p.L1, L2 = p.L2;
    var T = 0.5 * p.m1 * L1 * L1 * w1 * w1
      + 0.5 * p.m2 * (L1 * L1 * w1 * w1 + L2 * L2 * w2 * w2
        + 2 * L1 * L2 * w1 * w2 * Math.cos(t1 - t2));
    var V = -(p.m1 + p.m2) * p.g * L1 * Math.cos(t1) - p.m2 * p.g * L2 * Math.cos(t2);
    return T + V;
  }

  function wrapPi(a) {
    a = a % TAU;
    if (a > Math.PI) a -= TAU;
    else if (a <= -Math.PI) a += TAU;
    return a;
  }

  // Расстояние между двумя состояниями в фазовом пространстве:
  // углы — в радианах, скорости приведены к углам через τ = √(L̄/g).
  function phaseDist(a, b, p) {
    var tau2 = 0.5 * (p.L1 + p.L2) / p.g;
    var d1 = wrapPi(a[0] - b[0]), d2 = wrapPi(a[2] - b[2]);
    var e1 = a[1] - b[1], e2 = a[3] - b[3];
    return Math.sqrt(d1 * d1 + d2 * d2 + tau2 * (e1 * e1 + e2 * e2));
  }

  /* ---------------- Кольцевой буфер ---------------- */

  function makeRing(cap) {
    return { x: new Float64Array(cap), y: new Float64Array(cap), t: new Float64Array(cap), cap: cap, start: 0, n: 0 };
  }
  function ringPush(r, x, y, t) {
    var i;
    if (r.n < r.cap) { i = (r.start + r.n) % r.cap; r.n++; }
    else { i = r.start; r.start = (r.start + 1) % r.cap; }
    r.x[i] = x; r.y[i] = y; r.t[i] = t;
  }
  function ringPrune(r, minT) {
    while (r.n > 0 && r.t[r.start] < minT) { r.start = (r.start + 1) % r.cap; r.n--; }
  }
  function ringClear(r) { r.start = 0; r.n = 0; }

  /* ---------------- Форматирование ---------------- */

  var SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  function sup(n) {
    var s = String(n), o = '';
    for (var i = 0; i < s.length; i++) o += SUP[s[i]] || s[i];
    return o;
  }
  function fix(v, n) {
    var s = v.toFixed(n);
    if (/^-0(,|\.|$)/.test(s) && Math.abs(v) < 0.5 * Math.pow(10, -n)) s = s.slice(1);
    return s.replace('.', ',').replace('-', '−');
  }
  function sci(x) {
    if (!(x > 0)) return '0';
    var e = Math.floor(Math.log10(x)), m = x / Math.pow(10, e);
    if (m >= 9.95) { m /= 10; e++; }
    if (e >= -2 && e <= 1) return fix(x, e >= 0 ? 2 : (e === -1 ? 3 : 4));
    return fix(m, 1) + '·10' + sup(e);
  }

  /* ---------------- Браузер ---------------- */

  function boot() {
    var H = 0.0002;            // шаг интегратора, с (5 кГц)
    var TRAIL_DT = 1 / 360;    // дискретизация следа, с (время симуляции)
    var DIV_DT = 1 / 30;       // дискретизация графика расхождения, с
    var MAX_FRAME = 0.05;      // кламп большого кадрового dt, с
    var TRAIL_MAX = 12;        // максимум длины следа, с
    var DIV_WINDOW = 60;       // окно графика расхождения, с
    var MONO = 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace';

    function $(id) { return document.getElementById(id); }
    var canvas = $('scene'), ctx = canvas.getContext('2d');
    var chart = $('chart'), cctx = chart.getContext('2d');
    var bgCanvas = document.createElement('canvas'), bgCtx = bgCanvas.getContext('2d');
    var panel = $('panel'), topBar = $('top'), card = $('chaos');
    var playBtn = $('play'), playLbl = $('playLbl'), ghostBtn = $('ghostBtn');
    var stT = $('stT'), stA = $('stA'), stB = $('stB'), stE = $('stE');
    var dVal = $('dVal'), dSep = $('dSep'), epsLbl = $('epsLbl');

    var P = { m1: 1, m2: 1, L1: 1, L2: 1, g: G };
    var init = { t1: 125 * Math.PI / 180, t2: 172 * Math.PI / 180 };
    var main = new Float64Array(4), ghost = new Float64Array(4);
    var scratch = makeScratch();

    var running = true, ghostOn = true, epsExp = -6, trailSec = 5;
    var simT = 0, acc = 0, nextTrail = 0, nextDiv = 0;
    var ghostT0 = 0, sepTime = -1, lastD = 1e-6;
    var E0 = 0, Escale = 1;
    var drag = null;

    var trailCap = Math.ceil(TRAIL_MAX / TRAIL_DT) + 64;
    var trailA = makeRing(trailCap), trailB = makeRing(trailCap);
    var divRing = makeRing(Math.ceil(DIV_WINDOW / DIV_DT) + 256);
    var tx = new Float32Array(trailCap + 2), ty = new Float32Array(trailCap + 2), ta = new Float32Array(trailCap + 2);
    var pos = new Float64Array(4), pos2 = new Float64Array(4);

    // Геометрия экрана
    var W = 0, Hh = 0, dpr = 1, cx = 0, cy = 0, R = 100, scale = 1, uiK = 1, areaTop = 0, areaBot = 0;
    var chartW = 0, chartH = 0;

    // Палитры следа: f = 1 — голова, f = 0 — хвост
    var PAL_MAIN = { stops: [[0, 150, 40, 125], [0.45, 255, 118, 58], [1, 255, 232, 178]], a: 0.95, glow: [255, 150, 70] };
    var PAL_GHOST = { stops: [[0, 70, 80, 235], [0.5, 60, 190, 255], [1, 190, 248, 255]], a: 0.8, glow: [80, 200, 255] };

    /* ---- состояние ---- */

    function bobPos(s, out) {
      var x1 = P.L1 * Math.sin(s[0]), y1 = P.L1 * Math.cos(s[0]);
      out[0] = x1; out[1] = y1;
      out[2] = x1 + P.L2 * Math.sin(s[2]); out[3] = y1 + P.L2 * Math.cos(s[2]);
      return out;
    }
    function bobR(m) { return uiK * 10.5 * Math.cbrt(m); }
    function eps() { return Math.pow(10, epsExp); }

    function resetEnergy() {
      E0 = energy(main, P);
      Escale = (P.m1 + P.m2) * P.g * P.L1 + P.m2 * P.g * P.L2;
    }

    function recordTrail() {
      bobPos(main, pos); ringPush(trailA, pos[2], pos[3], simT);
      if (ghostOn) { bobPos(ghost, pos2); ringPush(trailB, pos2[2], pos2[3], simT); }
    }

    function recordDiv() {
      var d = phaseDist(main, ghost, P), tau = simT - ghostT0;
      lastD = d;
      ringPush(divRing, tau, Math.log10(Math.max(d, 1e-16)), tau);
      ringPrune(divRing, tau - DIV_WINDOW - 2);
      if (sepTime < 0) {
        bobPos(main, pos); bobPos(ghost, pos2);
        var dx = pos[2] - pos2[2], dy = pos[3] - pos2[3];
        // «видимо разошлись» — нижние грузы дальше 10 % от полной длины маятника
        if (Math.sqrt(dx * dx + dy * dy) > 0.1 * (P.L1 + P.L2)) sepTime = tau;
      }
    }

    function respawnGhost() {
      ghost.set(main); ghost[0] += eps();
      ghostT0 = simT; sepTime = -1; lastD = eps();
      ringClear(divRing); ringClear(trailB);
      if (ghostOn) recordDiv();
      nextDiv = simT + DIV_DT;
    }

    function reset() {
      if (drag) return;
      main[0] = init.t1; main[1] = 0; main[2] = init.t2; main[3] = 0;
      simT = 0; acc = 0; nextTrail = 0;
      ringClear(trailA); ringClear(trailB);
      respawnGhost(); resetEnergy(); updateStats();
    }

    function advance(dt) {
      acc += dt;
      while (acc >= H) {
        acc -= H;
        rk4Step(main, P, H, scratch);
        if (ghostOn) rk4Step(ghost, P, H, scratch);
        simT += H;
        if (simT >= nextTrail) { nextTrail += TRAIL_DT; if (nextTrail <= simT) nextTrail = simT + TRAIL_DT; recordTrail(); }
        if (ghostOn && simT >= nextDiv) { nextDiv += DIV_DT; if (nextDiv <= simT) nextDiv = simT + DIV_DT; recordDiv(); }
      }
      ringPrune(trailA, simT - trailSec);
      ringPrune(trailB, simT - trailSec);
    }

    /* ---- раскладка ---- */

    function targetScale() {
      return Math.max(10, (R - bobR(Math.max(P.m1, P.m2)) - 4) / (P.L1 + P.L2));
    }

    function layout() {
      W = window.innerWidth; Hh = window.innerHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hh * dpr);

      var pr = panel.getBoundingClientRect();
      areaBot = pr.top - 10;
      areaTop = 10;
      if (W < 760) areaTop = topBar.getBoundingClientRect().bottom + 6;
      if (areaBot - areaTop < 180) areaTop = Math.max(10, areaBot - 180);
      cx = W / 2; cy = (areaTop + areaBot) / 2;
      R = Math.max(60, Math.min(W / 2 - 14, (areaBot - areaTop) / 2));
      uiK = Math.max(0.72, Math.min(1.2, R / 300));
      scale = targetScale();

      if (!card.hidden) {
        chartW = chart.clientWidth; chartH = chart.clientHeight;
        chart.width = Math.round(chartW * dpr); chart.height = Math.round(chartH * dpr);
      }
      paintBg();
    }

    function paintBg() {
      bgCanvas.width = canvas.width; bgCanvas.height = canvas.height;
      var b = bgCtx;
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.fillStyle = '#05070c'; b.fillRect(0, 0, W, Hh);
      var g = b.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, Hh) * 0.75);
      g.addColorStop(0, 'rgba(36,50,88,0.55)');
      g.addColorStop(0.45, 'rgba(18,26,50,0.32)');
      g.addColorStop(1, 'rgba(5,7,12,0)');
      b.fillStyle = g; b.fillRect(0, 0, W, Hh);
      // точечная сетка, привязанная к шарниру
      var step = 28, ox = ((cx % step) + step) % step, oy = ((cy % step) + step) % step;
      b.fillStyle = 'rgba(150,170,215,0.11)';
      for (var y = oy; y < Hh; y += step) for (var x = ox; x < W; x += step) b.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
      var v = b.createRadialGradient(W / 2, Hh / 2, Math.min(W, Hh) * 0.3, W / 2, Hh / 2, Math.max(W, Hh) * 0.78);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
      b.fillStyle = v; b.fillRect(0, 0, W, Hh);
    }

    /* ---- рисование сцены ---- */

    function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'; }
    function palCol(pal, f, a) {
      var s = pal.stops, i = 1;
      while (i < s.length - 1 && f > s[i][0]) i++;
      var p0 = s[i - 1], p1 = s[i], k = (f - p0[0]) / (p1[0] - p0[0]);
      if (k < 0) k = 0; else if (k > 1) k = 1;
      return 'rgba(' + Math.round(p0[1] + (p1[1] - p0[1]) * k) + ',' + Math.round(p0[2] + (p1[2] - p0[2]) * k) + ',' +
        Math.round(p0[3] + (p1[3] - p0[3]) * k) + ',' + a.toFixed(3) + ')';
    }

    function glow(x, y, r, c, a) {
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }

    function drawGuides() {
      var r1 = P.L1 * scale, rr = (P.L1 + P.L2) * scale;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(160,180,225,0.07)';
      ctx.beginPath(); ctx.arc(cx, cy, r1, 0, TAU); ctx.stroke();
      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = 'rgba(160,180,225,0.11)';
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + rr); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      for (var i = 0; i < 36; i++) {
        var a = i * TAU / 36, len = (i % 3 === 0) ? 8 : 3.5, s = Math.sin(a), c = Math.cos(a);
        ctx.moveTo(cx + s * (rr + 5), cy + c * (rr + 5));
        ctx.lineTo(cx + s * (rr + 5 + len), cy + c * (rr + 5 + len));
      }
      ctx.strokeStyle = 'rgba(160,180,225,0.16)'; ctx.stroke();
    }

    function drawTrail(r, hx, hy, pal, glowA, coreW) {
      var T = trailSec, m = 0, i, j, k, idx, age, f;
      for (i = 0; i < r.n; i++) {
        idx = (r.start + i) % r.cap;
        age = simT - r.t[idx];
        if (age > T || age < 0) continue;
        tx[m] = cx + r.x[idx] * scale; ty[m] = cy + r.y[idx] * scale; ta[m] = age; m++;
      }
      tx[m] = cx + hx * scale; ty[m] = cy + hy * scale; ta[m] = 0; m++;
      if (m < 2) return;
      var K = 10;
      ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
      if (glowA > 0) {
        ctx.globalCompositeOperation = 'lighter';
        for (i = 0; i < m - 1; i += K) {
          j = Math.min(i + K, m - 1);
          f = 1 - 0.5 * (ta[i] + ta[j]) / T;
          if (f <= 0.02) continue;
          ctx.beginPath(); ctx.moveTo(tx[i], ty[i]);
          for (k = i + 1; k <= j; k++) ctx.lineTo(tx[k], ty[k]);
          ctx.strokeStyle = rgba(pal.glow, glowA * f * f);
          ctx.lineWidth = (3 + 9 * f) * uiK;
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      for (i = 0; i < m - 1; i += K) {
        j = Math.min(i + K, m - 1);
        f = 1 - 0.5 * (ta[i] + ta[j]) / T;
        if (f <= 0.01) continue;
        ctx.beginPath(); ctx.moveTo(tx[i], ty[i]);
        for (k = i + 1; k <= j; k++) ctx.lineTo(tx[k], ty[k]);
        ctx.strokeStyle = palCol(pal, f, pal.a * Math.pow(f, 1.3));
        ctx.lineWidth = (0.5 + coreW * f) * uiK;
        ctx.stroke();
      }
    }

    function sphere(x, y, r, c0, c1, c2) {
      var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r);
      g.addColorStop(0, c0); g.addColorStop(0.55, c1); g.addColorStop(1, c2);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
    }

    function drawPendulum(s, isGhost) {
      bobPos(s, pos);
      var x1 = cx + pos[0] * scale, y1 = cy + pos[1] * scale;
      var x2 = cx + pos[2] * scale, y2 = cy + pos[3] * scale;
      var r1 = bobR(P.m1), r2 = bobR(P.m2);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (isGhost) {
        ctx.strokeStyle = 'rgba(95,225,255,0.55)'; ctx.lineWidth = 1.8 * uiK;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
        glow(x2, y2, r2 * 3, [95, 225, 255], 0.22);
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(150,236,255,0.9)';
        ctx.fillStyle = 'rgba(16,52,72,0.6)';
        ctx.beginPath(); ctx.arc(x1, y1, r1, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(x2, y2, r2, 0, TAU); ctx.fill(); ctx.stroke();
        return;
      }
      // тень-подложка стержней, чтобы они читались поверх следа
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 6.5 * uiK;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(232,238,248,0.95)'; ctx.lineWidth = 2.6 * uiK;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      glow(x2, y2, r2 * 3.4, [255, 160, 70], 0.3);
      glow(x1, y1, r1 * 2.2, [170, 190, 230], 0.1);
      ctx.globalCompositeOperation = 'source-over';
      sphere(x1, y1, r1, '#f6f8fc', '#aab5c8', '#465066');
      sphere(x2, y2, r2, '#fff3db', '#ffab4a', '#ae4c19');
      // ось шарнира на первом грузе
      ctx.beginPath(); ctx.arc(x1, y1, 2.3 * uiK, 0, TAU);
      ctx.fillStyle = 'rgba(18,22,32,0.85)'; ctx.fill();
    }

    function drawPivot() {
      ctx.globalCompositeOperation = 'lighter';
      glow(cx, cy, 22 * uiK, [170, 190, 255], 0.12);
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath(); ctx.arc(cx, cy, 5.5 * uiK, 0, TAU);
      ctx.fillStyle = '#0c111c'; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(235,240,250,0.85)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 1.8 * uiK, 0, TAU);
      ctx.fillStyle = 'rgba(235,240,250,0.95)'; ctx.fill();
    }

    function drawScaleBar() {
      var m = 1, px = scale;
      if (px > 170) { m = 0.5; px = 0.5 * scale; }
      if (px < 36) { m = 2; px = 2 * scale; }
      var x0 = 18, y0 = Math.round(areaBot - 12) + 0.5;
      ctx.strokeStyle = 'rgba(190,200,222,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 4);
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + px, y0);
      ctx.moveTo(x0 + px, y0 - 4); ctx.lineTo(x0 + px, y0 + 4);
      ctx.stroke();
      ctx.fillStyle = 'rgba(190,200,222,0.7)';
      ctx.font = '11px ' + MONO; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(fix(m, m < 1 ? 1 : 0) + ' м', x0 + px + 8, y0);
    }

    function render() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(bgCanvas, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGuides();
      bobPos(main, pos);
      var hx = pos[2], hy = pos[3];
      if (ghostOn) {
        bobPos(ghost, pos2);
        drawTrail(trailB, pos2[2], pos2[3], PAL_GHOST, 0.06, 1.5);
      }
      drawTrail(trailA, hx, hy, PAL_MAIN, 0.11, 2.5);
      if (ghostOn) drawPendulum(ghost, true);
      drawPendulum(main, false);
      drawPivot();
      drawScaleBar();
    }

    /* ---- график расхождения ---- */

    function drawChart() {
      if (!chartW || !chartH) return;
      var c = cctx, w = chartW, h = chartH;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      var l = 32, r = 6, t = 6, b = 15;
      var pw = w - l - r, ph = h - t - b;
      var lo = epsExp - 1, hi = 1, span = hi - lo;
      var tau = simT - ghostT0;
      var xMax = Math.max(20, tau), xMin = Math.max(0, xMax - DIV_WINDOW);
      var sx = pw / (xMax - xMin), sy = ph / span;
      var e, y, i;

      c.font = '9px ' + MONO; c.textBaseline = 'middle'; c.textAlign = 'right'; c.lineWidth = 1;
      var stepE = Math.max(1, Math.ceil(span / 4));
      for (e = hi; e >= lo; e--) {
        y = Math.round(t + (hi - e) * sy) + 0.5;
        var major = (hi - e) % stepE === 0;
        c.strokeStyle = major ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.035)';
        c.beginPath(); c.moveTo(l, y); c.lineTo(l + pw, y); c.stroke();
        if (major) { c.fillStyle = 'rgba(170,182,205,0.8)'; c.fillText('10' + sup(e), l - 5, y); }
      }
      c.textBaseline = 'alphabetic'; c.fillStyle = 'rgba(170,182,205,0.6)';
      c.textAlign = 'left'; c.fillText(fix(xMin, 0) + ' с', l, h - 2);
      c.textAlign = 'right'; c.fillText(fix(xMax, 0) + ' с', l + pw, h - 2);

      // уровень ε
      y = Math.round(t + (hi - epsExp) * sy) + 0.5;
      c.setLineDash([2, 3]); c.strokeStyle = 'rgba(95,225,255,0.35)';
      c.beginPath(); c.moveTo(l, y); c.lineTo(l + pw, y); c.stroke();
      // момент видимого расхождения
      if (sepTime >= 0 && sepTime >= xMin) {
        var xs = Math.round(l + (sepTime - xMin) * sx) + 0.5;
        c.strokeStyle = 'rgba(255,178,77,0.75)';
        c.beginPath(); c.moveTo(xs, t); c.lineTo(xs, t + ph); c.stroke();
      }
      c.setLineDash([]);

      var n = divRing.n;
      if (n < 1) return;
      var line = new Path2D(), first = true, fx = 0, lx = 0, ly = 0;
      for (i = 0; i < n; i++) {
        var idx = (divRing.start + i) % divRing.cap, tt = divRing.x[idx];
        if (tt < xMin) continue;
        var v = divRing.y[idx];
        if (v < lo) v = lo; else if (v > hi) v = hi;
        lx = l + (tt - xMin) * sx; ly = t + (hi - v) * sy;
        if (first) { line.moveTo(lx, ly); fx = lx; first = false; } else line.lineTo(lx, ly);
      }
      if (first) return;
      var area = new Path2D(line);
      area.lineTo(lx, t + ph); area.lineTo(fx, t + ph); area.closePath();
      var g = c.createLinearGradient(0, t, 0, t + ph);
      g.addColorStop(0, 'rgba(95,225,255,0.30)'); g.addColorStop(1, 'rgba(95,225,255,0)');
      c.fillStyle = g; c.fill(area);
      c.strokeStyle = '#5fe1ff'; c.lineWidth = 1.4; c.lineJoin = 'round'; c.stroke(line);
      c.beginPath(); c.arc(lx, ly, 2.4, 0, TAU); c.fillStyle = '#e8fbff'; c.fill();
    }

    /* ---- HUD ---- */

    function fmtDeg(a) { return fix(wrapPi(a) * 180 / Math.PI, 1) + '°'; }

    function updateStats() {
      stT.textContent = fix(simT, 2) + ' с';
      stA.textContent = fmtDeg(main[0]);
      stB.textContent = fmtDeg(main[2]);
      stE.textContent = sci(Math.abs(energy(main, P) - E0) / Escale);
      if (ghostOn) {
        dVal.textContent = sci(lastD);
        if (sepTime >= 0) { dSep.textContent = 'разошлись через ' + fix(sepTime, 1) + ' с'; dSep.className = 'sep-yes'; }
        else { dSep.textContent = 'пока совпадают'; dSep.className = ''; }
      }
    }

    /* ---- управление ---- */

    function setRunning(v) {
      running = v;
      playBtn.classList.toggle('is-paused', !v);
      playLbl.textContent = v ? 'Пауза' : 'Пуск';
    }

    function setGhost(on) {
      ghostOn = on;
      ghostBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      card.hidden = !on;
      if (on) respawnGhost(); else ringClear(trailB);
      layout();
      updateStats();
    }

    playBtn.addEventListener('click', function () { setRunning(!running); });
    $('reset').addEventListener('click', reset);
    ghostBtn.addEventListener('click', function () { setGhost(!ghostOn); });

    function bindRange(id, show, apply) {
      var el = $(id), out = $(id + 'Out');
      var min = parseFloat(el.min), max = parseFloat(el.max);
      function upd() {
        var v = parseFloat(el.value);
        out.textContent = show(v);
        el.style.setProperty('--p', ((v - min) / (max - min) * 100).toFixed(2) + '%');
        apply(v);
      }
      el.addEventListener('input', upd);
      upd();
    }
    function clearTrails() { ringClear(trailA); ringClear(trailB); }

    bindRange('m1', function (v) { return fix(v, 1) + ' кг'; }, function (v) { P.m1 = v; resetEnergy(); });
    bindRange('m2', function (v) { return fix(v, 1) + ' кг'; }, function (v) { P.m2 = v; resetEnergy(); });
    bindRange('L1', function (v) { return fix(v, 2) + ' м'; }, function (v) { P.L1 = v; clearTrails(); resetEnergy(); });
    bindRange('L2', function (v) { return fix(v, 2) + ' м'; }, function (v) { P.L2 = v; clearTrails(); resetEnergy(); });
    bindRange('trail', function (v) { return fix(v, 1) + ' с'; }, function (v) { trailSec = v; });
    bindRange('eps', function (v) { return '10' + sup(v) + ' рад'; }, function (v) {
      epsExp = v; epsLbl.textContent = '10' + sup(v);
      if (ghostOn) respawnGhost();
    });

    // Перетаскивание грузов: задаёт новое начальное положение (скорости = 0)
    function hitTest(x, y) {
      bobPos(main, pos);
      var x1 = cx + pos[0] * scale, y1 = cy + pos[1] * scale;
      var x2 = cx + pos[2] * scale, y2 = cy + pos[3] * scale;
      var d1 = Math.hypot(x - x1, y - y1), d2 = Math.hypot(x - x2, y - y2);
      var h1 = bobR(P.m1) + 12, h2 = bobR(P.m2) + 12;
      if (d2 <= h2 && (d2 <= d1 || d1 > h1)) return 2;
      if (d1 <= h1) return 1;
      return 0;
    }
    function dragTo(x, y) {
      var wx = (x - cx) / scale, wy = (y - cy) / scale;
      if (drag.which === 1) main[0] = Math.atan2(wx, wy);
      else { bobPos(main, pos); main[2] = Math.atan2(wx - pos[0], wy - pos[1]); }
      main[1] = 0; main[3] = 0;
      ghost.set(main); ghost[0] += eps();
    }
    canvas.addEventListener('pointerdown', function (e) {
      if (drag) return;
      var h = hitTest(e.clientX, e.clientY);
      if (!h) return;
      drag = { which: h, id: e.pointerId };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* нет захвата — не критично */ }
      canvas.style.cursor = 'grabbing';
      clearTrails();
      dragTo(e.clientX, e.clientY);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (drag) { if (e.pointerId === drag.id) dragTo(e.clientX, e.clientY); return; }
      canvas.style.cursor = hitTest(e.clientX, e.clientY) ? 'grab' : 'default';
    });
    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      canvas.style.cursor = 'grab';
      init.t1 = main[0]; init.t2 = main[2];
      reset();
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    window.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var tag = e.target && e.target.tagName;
      if (e.code === 'Space') {
        if (tag === 'BUTTON') return; // кнопка сама обработает пробел
        e.preventDefault(); setRunning(!running);
      } else if (e.code === 'KeyR') {
        reset();
      } else if (e.code === 'KeyG') {
        setGhost(!ghostOn);
      }
    });

    window.addEventListener('resize', layout);
    if (typeof ResizeObserver === 'function') {
      var ro = new ResizeObserver(function () { layout(); });
      ro.observe(panel); ro.observe(topBar);
    }

    /* ---- цикл ---- */

    var last = performance.now(), statAcc = 1;
    function frame(now) {
      var dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0)) dt = 0;
      if (dt > MAX_FRAME) dt = MAX_FRAME;
      if (running && !drag) advance(dt);
      scale += (targetScale() - scale) * (1 - Math.exp(-dt * 12));
      render();
      if (ghostOn) drawChart();
      statAcc += dt;
      if (statAcc >= 0.1) { statAcc = 0; updateStats(); }
      requestAnimationFrame(frame);
    }

    layout();
    reset();
    setRunning(true);
    requestAnimationFrame(frame);
  }

  var api = {
    G: G, deriv: deriv, rk4Step: rk4Step, makeScratch: makeScratch,
    energy: energy, phaseDist: phaseDist, wrapPi: wrapPi, sci: sci, fix: fix
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof document !== 'undefined') boot();
})();
