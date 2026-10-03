/* Двойной маятник — Claude Sonnet 5.5
 *
 * Часть 1 — чистая физика (dual-mode: в браузере живёт в замыкании, в node
 *           экспортируется через module.exports).
 * Часть 2 — Canvas 2D: симуляция в реальном времени, след, призрак, график
 *           расхождения, управление.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var G = 9.81;

  /* =====================================================================
   *  ФИЗИКА
   *  Углы θ1, θ2 отсчитываются от вертикали вниз. Лагранжиан
   *    T = ½(m1+m2)L1²ω1² + ½m2L2²ω2² + m2L1L2ω1ω2cos(θ1−θ2)
   *    V = −(m1+m2)gL1cosθ1 − m2gL2cosθ2
   *  Решение уравнений Эйлера–Лагранжа относительно угловых ускорений:
   * ===================================================================== */
  function derivs(t1, t2, w1, w2, P, out) {
    var m1 = P.m1, m2 = P.m2, L1 = P.L1, L2 = P.L2, g = P.g;
    var d = t1 - t2;
    var sd = Math.sin(d), cd = Math.cos(d);
    var den = 2 * m1 + m2 - m2 * Math.cos(2 * d);        // ≥ 2·m1 > 0
    out[0] = w1;
    out[1] = w2;
    out[2] = (-g * (2 * m1 + m2) * Math.sin(t1)
              - m2 * g * Math.sin(t1 - 2 * t2)
              - 2 * sd * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * cd)) / (L1 * den);
    out[3] = (2 * sd * (w1 * w1 * L1 * (m1 + m2)
              + g * (m1 + m2) * Math.cos(t1)
              + w2 * w2 * L2 * m2 * cd)) / (L2 * den);
  }

  var k1 = new Float64Array(4), k2 = new Float64Array(4),
      k3 = new Float64Array(4), k4 = new Float64Array(4);

  /* Классический Рунге–Кутта 4-го порядка, состояние s = [θ1, θ2, ω1, ω2] правится на месте. */
  function rk4(s, h, P) {
    var a = s[0], b = s[1], u = s[2], v = s[3], hh = h * 0.5;
    derivs(a, b, u, v, P, k1);
    derivs(a + hh * k1[0], b + hh * k1[1], u + hh * k1[2], v + hh * k1[3], P, k2);
    derivs(a + hh * k2[0], b + hh * k2[1], u + hh * k2[2], v + hh * k2[3], P, k3);
    derivs(a + h * k3[0], b + h * k3[1], u + h * k3[2], v + h * k3[3], P, k4);
    var h6 = h / 6;
    s[0] = a + h6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    s[1] = b + h6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    s[2] = u + h6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    s[3] = v + h6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
  }

  function energy(s, P) {
    var w1 = s[2], w2 = s[3];
    var T = 0.5 * (P.m1 + P.m2) * P.L1 * P.L1 * w1 * w1
          + 0.5 * P.m2 * P.L2 * P.L2 * w2 * w2
          + P.m2 * P.L1 * P.L2 * w1 * w2 * Math.cos(s[0] - s[1]);
    var V = -(P.m1 + P.m2) * P.g * P.L1 * Math.cos(s[0]) - P.m2 * P.g * P.L2 * Math.cos(s[1]);
    return T + V;
  }

  /* Декартовы координаты грузов (метры, ось y вниз): out = [x1, y1, x2, y2]. */
  function positions(s, P, out) {
    var x1 = P.L1 * Math.sin(s[0]), y1 = P.L1 * Math.cos(s[0]);
    out[0] = x1;
    out[1] = y1;
    out[2] = x1 + P.L2 * Math.sin(s[1]);
    out[3] = y1 + P.L2 * Math.cos(s[1]);
  }

  function tipSpeed(s, P) {
    var vx = P.L1 * Math.cos(s[0]) * s[2] + P.L2 * Math.cos(s[1]) * s[3];
    var vy = -(P.L1 * Math.sin(s[0]) * s[2] + P.L2 * Math.sin(s[1]) * s[3]);
    return Math.sqrt(vx * vx + vy * vy);
  }

  /* Свёртка угла в (−π, π]: уравнения зависят только от sin/cos комбинаций углов,
     поэтому сдвиг на 2π физику не меняет, а точность не деградирует при многих оборотах. */
  function wrap(a) { return a - TAU * Math.round(a / TAU); }

  var physics = { G: G, derivs: derivs, rk4: rk4, energy: energy, positions: positions, tipSpeed: tipSpeed, wrap: wrap };
  if (typeof module !== 'undefined' && module.exports) module.exports = physics;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  /* =====================================================================
   *  СИМУЛЯЦИЯ: состояние
   * ===================================================================== */
  var $ = function (id) { return document.getElementById(id); };
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  var MONO = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';

  var H_STEP = 0.001;        // шаг интегрирования, с (1 кГц): дрейф энергии RK4 ~5e-9 за 10 с
  var MAX_STEPS = 1200;      // защита от «спирали смерти»
  var MAX_DT = 0.05;         // кламп реального dt
  var TRAIL_EVERY = 6;       // запись точки следа каждые 6 шагов = 6 мс симуляции
  var TRAIL_CAP = 3000;      // 15 с * 166 Гц = 2500 + запас
  var DIV_EVERY = 20;        // отсчёт графика расхождения каждые 20 мс
  var LMAX = 1.4;            // максимум ползунка длины — задаёт фиксированный масштаб
  var CHART_WINDOW = 30;     // ширина окна графика, с

  var P = { m1: 1, m2: 1, L1: 1, L2: 1, g: G };
  // Начальные углы (меняются перетаскиванием). Пара подобрана сканированием: заведомо хаотичный режим —
  // при ε = 1e-3 расхождение достигает масштаба системы за ~4 с, при 1e-6 — за ~8 с.
  var init = [135 * Math.PI / 180, -120 * Math.PI / 180];

  var main = new Float64Array(4);
  var ghost = new Float64Array(4);
  var posA = new Float64Array(4);
  var posB = new Float64Array(4);

  function Trail(cap) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.v = new Float32Array(cap);
    this.t = new Float64Array(cap);
    this.head = 0;
    this.count = 0;
  }
  Trail.prototype.clear = function () { this.head = 0; this.count = 0; };
  Trail.prototype.push = function (x, y, v, t) {
    var h = this.head;
    this.x[h] = x; this.y[h] = y; this.v[h] = v; this.t[h] = t;
    this.head = (h + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  };
  var mainTrail = new Trail(TRAIL_CAP);
  var ghostTrail = new Trail(TRAIL_CAP);
  var scratch = {
    x: new Float32Array(TRAIL_CAP + 2), y: new Float32Array(TRAIL_CAP + 2),
    a: new Float32Array(TRAIL_CAP + 2), v: new Float32Array(TRAIL_CAP + 2)
  };

  var running = true, ghostOn = false, dragging = false, dragWhich = 0, ready = false;
  var simT = 0, gT = 0, acc = 0, stepCount = 0, E0 = 0;
  var eps = 1e-3, d0 = 1e-3, chartYMin = -4;
  var trailLife = 6, timeScale = 1;
  var hT = [], hD = [];

  function resetSim() {
    main[0] = init[0]; main[1] = init[1]; main[2] = 0; main[3] = 0;
    simT = 0; acc = 0; stepCount = 0;
    mainTrail.clear();
    ghostTrail.clear();
    E0 = energy(main, P);
    if (ghostOn) spawnGhost();
  }

  /* Призрак = копия оригинала в его текущем состоянии с отклонением ε по θ1. */
  function spawnGhost() {
    ghost[0] = main[0] + eps; ghost[1] = main[1]; ghost[2] = main[2]; ghost[3] = main[3];
    ghostTrail.clear();
    hT.length = 0; hD.length = 0;
    gT = 0;
    positions(main, P, posA);
    positions(ghost, P, posB);
    d0 = Math.max(Math.hypot(posA[2] - posB[2], posA[3] - posB[3]), 1e-12);
    chartYMin = Math.floor(Math.log10(d0)) - 1;
    hT.push(0); hD.push(d0);
  }

  function currentD() {
    positions(main, P, posA);
    positions(ghost, P, posB);
    return Math.hypot(posA[2] - posB[2], posA[3] - posB[3]);
  }

  function recordTrail() {
    positions(main, P, posA);
    mainTrail.push(posA[2], posA[3], tipSpeed(main, P), simT);
    if (ghostOn) {
      positions(ghost, P, posB);
      ghostTrail.push(posB[2], posB[3], tipSpeed(ghost, P), simT);
    }
  }

  function recordDiv() {
    hT.push(gT);
    hD.push(currentD());
    if (hT.length > 3000) { hT.splice(0, 1000); hD.splice(0, 1000); }
  }

  function update(dt) {
    if (!running || dragging) return;
    acc += dt * timeScale;
    var n = 0;
    while (acc >= H_STEP && n < MAX_STEPS) {
      rk4(main, H_STEP, P);
      if (ghostOn) { rk4(ghost, H_STEP, P); gT += H_STEP; }
      simT += H_STEP; acc -= H_STEP; n++; stepCount++;
      if (stepCount % TRAIL_EVERY === 0) recordTrail();
      if (ghostOn && stepCount % DIV_EVERY === 0) recordDiv();
    }
    if (n === MAX_STEPS) acc = 0;
    main[0] = wrap(main[0]); main[1] = wrap(main[1]);
    if (ghostOn) { ghost[0] = wrap(ghost[0]); ghost[1] = wrap(ghost[1]); }
  }

  /* =====================================================================
   *  ХОЛСТ, РАСКЛАДКА
   * ===================================================================== */
  var canvas = $('stage');
  var ctx = canvas.getContext('2d');
  var panel = $('panel');
  var W = 800, H = 600, dpr = 1, cx = 400, cy = 250, scale = 100, chartBox = null;

  function layout() {
    W = window.innerWidth || 800;
    H = window.innerHeight || 600;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));

    var pr = panel.getBoundingClientRect();
    var top = 14;
    var bottom = pr.height > 0 ? pr.top - 10 : H - 10;
    var availH = Math.max(120, bottom - top);
    cx = W / 2;
    cy = top + availH / 2;
    var R = Math.max(40, Math.min(W / 2 - 14, availH / 2 - 6));
    scale = R / (2 * LMAX);          // px на метр; фиксирован, чтобы длины на глаз менялись
    chartBox = W >= 600 ? { x: W - Math.min(340, Math.max(230, W * 0.28)) - 16, y: 16,
                            w: Math.min(340, Math.max(230, W * 0.28)), h: 150 } : null;
  }

  function bobRadius(m) { return Math.max(6, Math.min(34, scale * 0.075 * Math.sqrt(m))); }

  /* =====================================================================
   *  ОТРИСОВКА
   * ===================================================================== */
  function hsla(h, s, l, a) {
    return 'hsla(' + (((h % 360) + 360) % 360).toFixed(0) + ',' + s + '%,' + l.toFixed(0) + '%,' + a.toFixed(3) + ')';
  }

  var TRAIL_STYLE = {
    main:  { hue: function (s) { return 52 - 85 * s; },  alpha: 0.95, width: 2.6 },
    ghost: { hue: function (s) { return 188 + 70 * s; }, alpha: 0.8,  width: 2.2 }
  };

  /* След нижнего груза: хранится в «мировых» координатах и затухает по возрасту
     (время симуляции), цвет — по скорости груза. Рисуется корзинами по ~N сегментов
     с общим альфа-каналом: это на порядок дешевле, чем по сегменту на stroke(). */
  function drawTrail(tr, cur, st) {
    var life = trailLife;
    var n = tr.count, cap = tr.cap, m = 0, i, idx;
    var start = (tr.head - n + cap) % cap;
    var sx = scratch.x, sy = scratch.y, sa = scratch.a, sv = scratch.v;
    for (i = 0; i < n; i++) {
      idx = (start + i) % cap;
      var age = simT - tr.t[idx];
      if (age > life) continue;
      sx[m] = cx + tr.x[idx] * scale;
      sy[m] = cy + tr.y[idx] * scale;
      sa[m] = age;
      sv[m] = tr.v[idx];
      m++;
    }
    positions(cur, P, posA);
    sx[m] = cx + posA[2] * scale;
    sy[m] = cy + posA[3] * scale;
    sa[m] = 0;
    sv[m] = tipSpeed(cur, P);
    m++;
    if (m < 2) return;

    var vRef = 2.2 * Math.sqrt(G * (P.L1 + P.L2));
    var B = Math.max(1, Math.ceil((m - 1) / 90));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var pass = 0; pass < 2; pass++) {
      for (i = 0; i < m - 1; i += B) {
        var j = Math.min(i + B, m - 1);
        var mid = (i + j) >> 1;
        var f = 1 - sa[mid] / life;
        if (f <= 0) continue;
        var al = Math.pow(f, 1.7) * st.alpha;
        var s = Math.min(1, sv[mid] / vRef);
        ctx.beginPath();
        ctx.moveTo(sx[i], sy[i]);
        for (var k = i + 1; k <= j; k++) ctx.lineTo(sx[k], sy[k]);
        if (pass === 0) {
          ctx.lineWidth = st.width * 3.4 * (0.4 + 0.6 * f);
          ctx.strokeStyle = hsla(st.hue(s), 100, 58, al * 0.14);
        } else {
          ctx.lineWidth = st.width * (0.35 + 0.65 * f);
          ctx.strokeStyle = hsla(st.hue(s), 100, 52 + 14 * f, al);
        }
        ctx.stroke();
      }
    }
  }

  var BOB_MAIN = [
    { c0: '#fff3d6', c1: '#ffb347', c2: '#a8561a', glow: '255,170,70' },
    { c0: '#ffe3e3', c1: '#ff6b6b', c2: '#8e1f3a', glow: '255,100,110' }
  ];
  var BOB_GHOST = [
    { c0: '#e4fbff', c1: '#4fd8ff', c2: '#14688a', glow: '70,210,255' },
    { c0: '#e4fbff', c1: '#4fd8ff', c2: '#14688a', glow: '70,210,255' }
  ];

  function drawBob(x, y, r, c) {
    var g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.8);
    g.addColorStop(0, 'rgba(' + c.glow + ',0.34)');
    g.addColorStop(1, 'rgba(' + c.glow + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 2.8, 0, TAU); ctx.fill();

    var b = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    b.addColorStop(0, c.c0);
    b.addColorStop(0.55, c.c1);
    b.addColorStop(1, c.c2);
    ctx.fillStyle = b;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();
  }

  function drawPendulum(s, isGhost) {
    positions(s, P, posA);
    var x1 = cx + posA[0] * scale, y1 = cy + posA[1] * scale;
    var x2 = cx + posA[2] * scale, y2 = cy + posA[3] * scale;
    ctx.globalAlpha = isGhost ? 0.6 : 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.lineWidth = isGhost ? 4 : 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    ctx.lineWidth = isGhost ? 2 : 3.4;
    ctx.strokeStyle = isGhost ? 'rgba(160,230,255,0.9)' : 'rgba(226,232,255,0.95)';
    ctx.stroke();
    var set = isGhost ? BOB_GHOST : BOB_MAIN;
    drawBob(x1, y1, bobRadius(P.m1), set[0]);
    drawBob(x2, y2, bobRadius(P.m2), set[1]);
    ctx.globalAlpha = 1;
  }

  function drawPivot() {
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 64, cy); ctx.lineTo(cx + 64, cy);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, TAU);
    ctx.fillStyle = '#18214a'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#d3dbff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, TAU);
    ctx.fillStyle = '#d3dbff'; ctx.fill();
  }

  function drawGuides() {
    ctx.save();
    ctx.setLineDash([3, 9]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(150,170,255,0.16)';
    ctx.beginPath(); ctx.arc(cx, cy, (P.L1 + P.L2) * scale, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(150,170,255,0.10)';
    ctx.beginPath(); ctx.arc(cx, cy, P.L1 * scale, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + (P.L1 + P.L2) * scale); ctx.stroke();
    ctx.restore();
  }

  var SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
              '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  function sup(n) {
    return String(n).split('').map(function (c) { return SUP[c] || c; }).join('');
  }
  function decadeLabel(e) { return e === 0 ? '1' : e === 1 ? '10' : '10' + sup(e); }

  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* График расхождения нижних грузов оригинала и призрака в лог-масштабе:
     прямая линия вверх = экспоненциальный рост (показатель Ляпунова). */
  function drawChart() {
    if (!chartBox) return;
    var bx = chartBox.x, by = chartBox.y, bw = chartBox.w, bh = chartBox.h;
    ctx.save();
    roundRectPath(ctx, bx, by, bw, bh, 12);
    ctx.fillStyle = 'rgba(12,18,40,0.62)'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.stroke();

    ctx.font = '600 11px ' + FONT;
    ctx.fillStyle = '#9fb0e6';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('Расхождение грузов, м (log)', bx + 12, by + 18);

    var px = bx + 46, py = by + 28, pw = bw - 46 - 14, ph = bh - 28 - 24;
    var yMin = chartYMin, yMax = 0.8, span = yMax - yMin;   // 10^0.8 ≈ 6.3 м > максимума 2(L1+L2)
    var t1 = Math.max(CHART_WINDOW, gT), t0 = t1 - CHART_WINDOW;
    var Y = function (e) { return py + ph - (e - yMin) / span * ph; };
    var X = function (t) { return px + (t - t0) / CHART_WINDOW * pw; };

    ctx.font = '10px ' + MONO;
    ctx.textAlign = 'right';
    var step = ph / span < 16 ? 2 : 1;
    var e;
    for (e = Math.ceil(yMin); e <= yMax; e++) {
      if (step === 2 && (e & 1)) continue;
      var yy = Y(e);
      ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px + pw, yy);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.stroke();
      ctx.fillStyle = '#8391c4';
      ctx.fillText(decadeLabel(e), px - 6, yy + 3);
    }
    ctx.textAlign = 'center';
    for (var t = Math.ceil(t0 / 10) * 10; t <= t1 + 1e-9; t += 10) {
      var xx = X(t);
      ctx.beginPath(); ctx.moveTo(xx, py); ctx.lineTo(xx, py + ph);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.stroke();
      ctx.fillStyle = '#8391c4';
      ctx.fillText(t.toFixed(0) + ' с', xx, py + ph + 14);
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    ctx.beginPath();
    var started = false, lx = 0, ly = 0;
    for (var i = 0; i < hT.length; i++) {
      if (hT[i] < t0 - 0.5) continue;
      var lv = Math.log10(Math.max(hD[i], 1e-12));
      lv = Math.min(Math.max(lv, yMin), yMax);
      lx = X(hT[i]); ly = Y(lv);
      if (!started) { ctx.moveTo(lx, ly); started = true; } else ctx.lineTo(lx, ly);
    }
    ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#4fd8ff';
    ctx.stroke();
    if (started) {
      ctx.beginPath(); ctx.arc(lx, ly, 3, 0, TAU);
      ctx.fillStyle = '#e4fbff'; ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#18224d');
    bg.addColorStop(0.55, '#0b1129');
    bg.addColorStop(1, '#04060d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawGuides();

    ctx.globalCompositeOperation = 'lighter';
    if (ghostOn) drawTrail(ghostTrail, ghost, TRAIL_STYLE.ghost);
    drawTrail(mainTrail, main, TRAIL_STYLE.main);
    ctx.globalCompositeOperation = 'source-over';

    drawPivot();
    if (ghostOn) drawPendulum(ghost, true);
    drawPendulum(main, false);
    if (ghostOn) drawChart();
  }

  /* =====================================================================
   *  HUD
   * ===================================================================== */
  var sT = $('sT'), sA1 = $('sA1'), sA2 = $('sA2'), sE = $('sE'), sD = $('sD'), sDrow = $('sDrow');

  function fmtDist(d) {
    return d >= 1 ? d.toFixed(2) + ' м' : d >= 0.01 ? d.toFixed(3) + ' м' : d.toExponential(1) + ' м';
  }

  function updateHud() {
    sT.textContent = simT.toFixed(1) + ' с';
    sA1.textContent = (wrap(main[0]) * 180 / Math.PI).toFixed(1) + '°';
    sA2.textContent = (wrap(main[1]) * 180 / Math.PI).toFixed(1) + '°';
    var es = (P.m1 + P.m2) * G * (P.L1 + P.L2);
    sE.textContent = ((energy(main, P) - E0) / es).toExponential(1);
    if (ghostOn) {
      var d = currentD();
      var amp = d / d0;
      sD.textContent = fmtDist(d) + (amp > 1.5 ? '  ×' + (amp >= 100 ? Math.round(amp) : amp.toFixed(1)) : '');
    }
  }

  /* =====================================================================
   *  УПРАВЛЕНИЕ
   * ===================================================================== */
  var btnPlay = $('btnPlay'), btnReset = $('btnReset'), btnGhost = $('btnGhost');
  var icPlay = btnPlay.querySelector('.ic-play'), icPause = btnPlay.querySelector('.ic-pause');
  var playLabel = $('playLabel');

  function setRunning(v) {
    running = v;
    icPlay.style.display = v ? 'none' : '';
    icPause.style.display = v ? '' : 'none';
    playLabel.textContent = v ? 'Пауза' : 'Пуск';
    btnPlay.setAttribute('aria-label', v ? 'Пауза' : 'Пуск');
  }

  function setGhost(on) {
    ghostOn = on;
    btnGhost.setAttribute('aria-pressed', on ? 'true' : 'false');
    $('ctl_eps').classList.toggle('off', !on);
    sDrow.style.display = on ? 'contents' : 'none';
    if (on) spawnGhost();
    updateHud();
  }

  function toggleRun() { setRunning(!running); }
  function doReset() { resetSim(); updateHud(); }

  btnPlay.addEventListener('click', toggleRun);
  btnReset.addEventListener('click', doReset);
  btnGhost.addEventListener('click', function () { setGhost(!ghostOn); });

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') {
      if (e.target && e.target.closest && e.target.closest('button')) return;   // у кнопки свой клик
      e.preventDefault();
      toggleRun();
    } else if (e.code === 'KeyR') {
      doReset();
    } else if (e.code === 'KeyG') {
      setGhost(!ghostOn);
    }
  });

  function fmtEps(v) {
    var exp = Math.floor(v + 1e-9);
    var mant = Math.pow(10, v - exp);
    return mant.toFixed(1) + '×10' + sup(exp) + ' рад';
  }

  var controls = [
    { id: 'm1', phys: true, fmt: function (v) { return v.toFixed(2) + ' кг'; }, set: function (v) { P.m1 = v; } },
    { id: 'm2', phys: true, fmt: function (v) { return v.toFixed(2) + ' кг'; }, set: function (v) { P.m2 = v; } },
    { id: 'L1', phys: true, fmt: function (v) { return v.toFixed(2) + ' м'; },  set: function (v) { P.L1 = v; } },
    { id: 'L2', phys: true, fmt: function (v) { return v.toFixed(2) + ' м'; },  set: function (v) { P.L2 = v; } },
    { id: 'eps', fmt: fmtEps, set: function (v) { eps = Math.pow(10, v); if (ready && ghostOn) spawnGhost(); } },
    { id: 'trail', fmt: function (v) { return v.toFixed(1) + ' с'; }, set: function (v) { trailLife = v; } },
    { id: 'speed', fmt: function (v) { return '×' + v.toFixed(2); }, set: function (v) { timeScale = v; } }
  ];

  controls.forEach(function (def) {
    var el = $(def.id), out = $('o_' + def.id);
    var lo = parseFloat(el.min), hi = parseFloat(el.max);
    function apply() {
      var v = parseFloat(el.value);
      def.set(v);
      out.textContent = def.fmt(v);
      el.style.setProperty('--p', ((v - lo) / (hi - lo) * 100).toFixed(1) + '%');
      if (def.phys && ready) { E0 = energy(main, P); updateHud(); }   // скачок параметров — новая точка отсчёта энергии
    }
    el.addEventListener('input', apply);
    apply();
  });

  /* ---------- Перетаскивание грузов: задаёт новые начальные углы ---------- */
  function hitTest(px, py) {
    positions(main, P, posA);
    var x1 = cx + posA[0] * scale, y1 = cy + posA[1] * scale;
    var x2 = cx + posA[2] * scale, y2 = cy + posA[3] * scale;
    var d1 = Math.hypot(px - x1, py - y1), d2 = Math.hypot(px - x2, py - y2);
    var in1 = d1 <= bobRadius(P.m1) + 12, in2 = d2 <= bobRadius(P.m2) + 12;
    if (in1 && in2) return d1 < d2 ? 1 : 2;
    return in1 ? 1 : in2 ? 2 : 0;
  }

  function dragTo(px, py) {
    if (dragWhich === 1) {
      init[0] = Math.atan2(px - cx, py - cy);
    } else {
      var x1 = cx + P.L1 * Math.sin(init[0]) * scale;
      var y1 = cy + P.L1 * Math.cos(init[0]) * scale;
      init[1] = Math.atan2(px - x1, py - y1);
    }
    resetSim();
    updateHud();
  }

  canvas.addEventListener('pointerdown', function (e) {
    var hit = hitTest(e.clientX, e.clientY);
    if (!hit) return;
    dragging = true;
    dragWhich = hit;
    // перетаскиваем из текущей позы: начальные углы = текущие
    init[0] = main[0]; init[1] = main[1];
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    dragTo(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (dragging) { dragTo(e.clientX, e.clientY); return; }
    canvas.style.cursor = hitTest(e.clientX, e.clientY) ? 'grab' : 'default';
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    canvas.style.cursor = hitTest(e.clientX, e.clientY) ? 'grab' : 'default';
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /* =====================================================================
   *  ЗАПУСК
   * ===================================================================== */
  window.addEventListener('resize', layout);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(panel);

  layout();
  resetSim();
  setGhost(true);
  setRunning(true);
  ready = true;

  var last = 0, hudAcc = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!last) last = ts;
    var dt = (ts - last) / 1000;
    last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;          // кламп: после паузы вкладки не «прыгаем»
    update(dt);
    render();
    hudAcc += dt;
    if (hudAcc >= 0.1) { hudAcc = 0; updateHud(); }
  }
  requestAnimationFrame(frame);
})();
