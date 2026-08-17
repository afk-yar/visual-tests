/* Система Лоренца — Claude Opus 5
   Canvas 2D, без внешних зависимостей. RK4-интегрирование, 3D-проекция с
   перспективой, аддитивная отрисовка ленты с градиентом вдоль траектории. */
(function () {
  'use strict';

  var canvas = document.getElementById('scene');
  var ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
  if (!ctx) return;

  // ---------------------------------------------------------------- константы
  var SIGMA = 10;
  var BETA = 8 / 3;
  var STEP = 0.005;          // шаг интегрирования в модельном времени
  var MAX_TRAIL = 4200;      // ёмкость кольцевого буфера
  var TRACES = 3;            // число близких стартов
  var FOCAL = 165;           // фокусное расстояние в мировых единицах
  var SPIN_BASE = 0.157;     // рад/с при множителе 1 (оборот ~40 с)

  var params = { rho: 28, speed: 1, trail: 1200, spin: 1, glow: true };
  var paused = false;

  // камера
  var yaw = 0.55, tilt = 0.27, zoom = 1;

  // ------------------------------------------------------------------ палитра
  // Единая шкала цвета вдоль траектории: [позиция, r, g, b], хвост (0) → голова (1).
  // Основная работа цвета приходится на видимую часть следа (t ≳ 0.3).
  var MASTER = [
    [0.00, 10, 8, 34],
    [0.30, 46, 30, 122],
    [0.50, 52, 86, 224],
    [0.68, 40, 196, 236],
    [0.82, 112, 240, 190],
    [0.92, 255, 206, 120],
    [1.00, 255, 250, 240]
  ];
  // Нити различаются лишь лёгким сдвигом оттенка/яркости [r, g, b, яркость],
  // а не собственным цветом: носитель цвета — градиент по ходу траектории.
  var TINTS = [
    [1.00, 1.00, 1.00, 1.00],
    [1.10, 0.96, 0.86, 0.97],
    [0.88, 0.98, 1.12, 1.00]
  ];
  var LUT_SIZE = 160;

  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : Math.round(v)); }

  function buildLut(stops, tint) {
    var lut = new Uint8Array(LUT_SIZE * 3);
    var k = tint[3];
    for (var i = 0; i < LUT_SIZE; i++) {
      var t = i / (LUT_SIZE - 1);
      var a = stops[0], b = stops[stops.length - 1];
      for (var j = 0; j < stops.length - 1; j++) {
        if (t >= stops[j][0] && t <= stops[j + 1][0]) { a = stops[j]; b = stops[j + 1]; break; }
      }
      var span = b[0] - a[0];
      var f = span > 1e-6 ? (t - a[0]) / span : 0;
      if (f < 0) f = 0; else if (f > 1) f = 1;
      f = f * f * (3 - 2 * f);
      lut[i * 3] = clamp255((a[1] + (b[1] - a[1]) * f) * tint[0] * k);
      lut[i * 3 + 1] = clamp255((a[2] + (b[2] - a[2]) * f) * tint[1] * k);
      lut[i * 3 + 2] = clamp255((a[3] + (b[3] - a[3]) * f) * tint[2] * k);
    }
    return lut;
  }
  var LUTS = [buildLut(MASTER, TINTS[0]), buildLut(MASTER, TINTS[1]), buildLut(MASTER, TINTS[2])];

  // ---------------------------------------------------------------- состояние
  function makeTrace(i) {
    return {
      x: 0, y: 0, z: 0,
      buf: new Float32Array(MAX_TRAIL * 3),
      sx: new Float32Array(MAX_TRAIL),
      sy: new Float32Array(MAX_TRAIL),
      sd: new Float32Array(MAX_TRAIL),
      head: 0, n: 0, sn: 0,
      lut: LUTS[i % LUTS.length]
    };
  }
  var traces = [];
  for (var ti = 0; ti < TRACES; ti++) traces.push(makeTrace(ti));

  var simTime = 0;
  var acc = 0;

  // ---------------------------------------------------------- интегрирование
  var st = { x: 0, y: 0, z: 0 };
  function stepRK4(s, h) {
    var rho = params.rho;
    var x = s.x, y = s.y, z = s.z;

    var k1x = SIGMA * (y - x), k1y = x * (rho - z) - y, k1z = x * y - BETA * z;
    var ax = x + 0.5 * h * k1x, ay = y + 0.5 * h * k1y, az = z + 0.5 * h * k1z;

    var k2x = SIGMA * (ay - ax), k2y = ax * (rho - az) - ay, k2z = ax * ay - BETA * az;
    var bx = x + 0.5 * h * k2x, by = y + 0.5 * h * k2y, bz = z + 0.5 * h * k2z;

    var k3x = SIGMA * (by - bx), k3y = bx * (rho - bz) - by, k3z = bx * by - BETA * bz;
    var cx0 = x + h * k3x, cy0 = y + h * k3y, cz0 = z + h * k3z;

    var k4x = SIGMA * (cy0 - cx0), k4y = cx0 * (rho - cz0) - cy0, k4z = cx0 * cy0 - BETA * cz0;

    s.x = x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    s.y = y + (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
    s.z = z + (h / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
  }

  function push(tr) {
    var h = tr.head * 3;
    tr.buf[h] = tr.x; tr.buf[h + 1] = tr.y; tr.buf[h + 2] = tr.z;
    tr.head = (tr.head + 1) % MAX_TRAIL;
    if (tr.n < MAX_TRAIL) tr.n++;
  }

  function resetTraces() {
    st.x = -9 + Math.random() * 18;
    st.y = -11 + Math.random() * 22;
    st.z = 8 + Math.random() * 30;
    for (var k = 0; k < 1200; k++) stepRK4(st, STEP);   // выход на аттрактор
    if (!isFinite(st.x) || !isFinite(st.y) || !isFinite(st.z)) { st.x = 1; st.y = 1; st.z = 20; }

    for (var i = 0; i < TRACES; i++) {
      var tr = traces[i];
      tr.x = st.x + (i - 1) * 9e-4;      // почти одинаковые старты
      tr.y = st.y - (i - 1) * 7e-4;
      tr.z = st.z;
      tr.head = 0; tr.n = 0; tr.sn = 0;
    }
    simTime = 0;
    acc = 0;
  }

  // -------------------------------------------------------------- размер/фон
  var dpr = 1, cssW = 0, cssH = 0, cx = 0, cy = 0, scale = 1, bg = null;

  function resize() {
    var w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    var h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    var d = Math.min(2, window.devicePixelRatio || 1);
    var budget = 5.2e6;                                   // потолок по числу пикселей
    if (w * h * d * d > budget) d = Math.max(1, Math.sqrt(budget / (w * h)));
    if (w === cssW && h === cssH && d === dpr) return;
    cssW = w; cssH = h; dpr = d;
    canvas.width = Math.max(1, Math.round(w * d));
    canvas.height = Math.max(1, Math.round(h * d));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    cx = w * 0.5;
    cy = h * 0.46;                                        // запас снизу под панель
    bg = ctx.createRadialGradient(cx, h * 0.42, 0, cx, h * 0.42, Math.max(w, h) * 0.78);
    bg.addColorStop(0, '#0e1424');
    bg.addColorStop(0.5, '#080b15');
    bg.addColorStop(1, '#03040a');
    updateScale();
  }

  function updateScale() {
    var span = 30 + 1.35 * Math.max(0, params.rho - 28);   // аттрактор растёт вместе с ρ
    scale = Math.min(cssW / (2.0 * span), cssH / (1.9 * span));
  }

  // ------------------------------------------------------------------ камера
  var cosY = 1, sinY = 0, cosT = 1, sinT = 0, centerZ = 27;
  function updateCamera() {
    cosY = Math.cos(yaw); sinY = Math.sin(yaw);
    cosT = Math.cos(tilt); sinT = Math.sin(tilt);
    centerZ = Math.max(1, params.rho - 1);
  }

  var pr = { x: 0, y: 0, s: 1 };
  function project(x, y, z) {
    var wx = x;                 // мировая X
    var wy = z - centerZ;       // мировая «вверх»
    var wz = y;                 // мировая «в глубину»
    var rx = wx * cosY + wz * sinY;
    var rz = wz * cosY - wx * sinY;
    var uy = wy * cosT - rz * sinT;
    var dz = wy * sinT + rz * cosT;
    var s = FOCAL / Math.max(20, FOCAL + dz) * zoom;
    pr.x = cx + rx * s * scale;
    pr.y = cy - uy * s * scale;
    pr.s = s;
    return pr;
  }

  // ------------------------------------------------------------------ отрисовка
  function transformTrace(tr) {
    var n = Math.min(tr.n, params.trail | 0);
    tr.sn = n;
    if (n < 2) return;
    var start = (tr.head - n + MAX_TRAIL) % MAX_TRAIL;
    var buf = tr.buf, sx = tr.sx, sy = tr.sy, sd = tr.sd;
    for (var k = 0; k < n; k++) {
      var idx = start + k;
      if (idx >= MAX_TRAIL) idx -= MAX_TRAIL;
      var b = idx * 3;
      var wx = buf[b], wy = buf[b + 2] - centerZ, wz = buf[b + 1];
      var rx = wx * cosY + wz * sinY;
      var rz = wz * cosY - wx * sinY;
      var uy = wy * cosT - rz * sinT;
      var dz = wy * sinT + rz * cosT;
      var s = FOCAL / Math.max(20, FOCAL + dz) * zoom;
      sx[k] = cx + rx * s * scale;
      sy[k] = cy - uy * s * scale;
      sd[k] = s;
    }
  }

  function strokeTrace(tr, widthMul, alphaMul, maxGroups) {
    var n = tr.sn;
    if (n < 2) return;
    var sx = tr.sx, sy = tr.sy, sd = tr.sd, lut = tr.lut;
    var groups = Math.max(12, Math.min(maxGroups, Math.round(n / 14)));
    var per = n / groups;
    var inv = 1 / (n - 1);

    for (var g = 0; g < groups; g++) {
      var i0 = Math.floor(g * per);
      var i1 = g === groups - 1 ? n - 1 : Math.min(n - 1, Math.floor((g + 1) * per));
      if (i1 <= i0) continue;

      var t = (i0 + i1) * 0.5 * inv;                       // возраст: 0 хвост, 1 голова
      var fade = 0.05 + 0.95 * Math.pow(t, 1.55);          // затухание следа
      var depth = (sd[i0] + sd[i1]) * 0.5;
      var df = (depth / zoom - 0.80) / 0.5;                // 0 — далеко, 1 — близко
      if (df < 0) df = 0; else if (df > 1) df = 1;

      var a = alphaMul * fade * (0.45 + 0.75 * df);
      if (a <= 0.004) continue;
      if (a > 1) a = 1;

      var ci = (t * (LUT_SIZE - 1)) | 0;
      if (ci < 0) ci = 0; else if (ci > LUT_SIZE - 1) ci = LUT_SIZE - 1;
      var c = ci * 3;

      ctx.strokeStyle = 'rgba(' + lut[c] + ',' + lut[c + 1] + ',' + lut[c + 2] + ',' + a.toFixed(3) + ')';
      ctx.lineWidth = widthMul * (0.45 + 2.1 * Math.pow(t, 1.7)) * (0.7 + 0.6 * df);

      ctx.beginPath();
      ctx.moveTo(sx[i0], sy[i0]);
      for (var i = i0 + 1; i <= i1; i++) ctx.lineTo(sx[i], sy[i]);
      ctx.stroke();
    }
  }

  function drawHead(tr) {
    var n = tr.sn;
    if (n < 2) return;
    var i = n - 1;
    var x = tr.sx[i], y = tr.sy[i], s = tr.sd[i] / zoom;
    var r = Math.max(6, 13 * s * (0.6 + 0.5 * zoom));
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.22, 'rgba(214,238,255,0.55)');
    g.addColorStop(1, 'rgba(120,190,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFixedPoints() {
    var q = Math.sqrt(Math.max(0, BETA * (params.rho - 1)));
    ctx.lineWidth = 1;
    for (var s = -1; s <= 1; s += 2) {
      var p = project(s * q, s * q, params.rho - 1);
      var r = 4.5 * p.s;
      ctx.strokeStyle = 'rgba(150,196,255,0.20)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(190,220,255,0.30)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = bg || '#03040a';
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    drawFixedPoints();

    var i;
    for (i = 0; i < traces.length; i++) transformTrace(traces[i]);

    ctx.globalCompositeOperation = 'lighter';
    if (params.glow) {
      for (i = 0; i < traces.length; i++) strokeTrace(traces[i], 6.5, 0.05, 34);
      for (i = 0; i < traces.length; i++) strokeTrace(traces[i], 2.6, 0.10, 52);
    }
    for (i = 0; i < traces.length; i++) strokeTrace(traces[i], 1, 0.95, 120);
    for (i = 0; i < traces.length; i++) drawHead(traces[i]);

    ctx.globalCompositeOperation = 'source-over';
  }

  // --------------------------------------------------------------------- цикл
  var last = 0, statAcc = 1;

  function frame(now) {
    var t = now * 0.001;
    var dt = last ? t - last : 0.016;
    last = t;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;      // кламп большого dt (вкладка была скрыта)

    resize();
    yaw += SPIN_BASE * params.spin * dt;
    if (yaw > Math.PI * 2) yaw -= Math.PI * 2;
    updateCamera();

    if (!paused) {
      acc += dt * params.speed;
      var steps = Math.floor(acc / STEP);
      if (steps > 800) { steps = 800; acc = 0; } else { acc -= steps * STEP; }
      for (var s = 0; s < steps; s++) {
        for (var i = 0; i < traces.length; i++) {
          var tr = traces[i];
          st.x = tr.x; st.y = tr.y; st.z = tr.z;
          stepRK4(st, STEP);
          if (!isFinite(st.x) || !isFinite(st.y) || !isFinite(st.z)) {
            st.x = 1; st.y = 1; st.z = params.rho - 1;
            tr.head = 0; tr.n = 0;
          }
          tr.x = st.x; tr.y = st.y; tr.z = st.z;
          push(tr);
        }
        simTime += STEP;
      }
    }

    render();

    statAcc += dt;
    if (statAcc > 0.2) {
      statAcc = 0;
      var pts = 0;
      for (var j = 0; j < traces.length; j++) pts += traces[j].sn;
      setText(el.statTime, 't = ' + simTime.toFixed(1));
      setText(el.statPts, pts.toLocaleString('ru-RU') + ' точек');
    }

    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ элементы
  function $(id) { return document.getElementById(id); }
  function setText(node, s) { if (node) node.textContent = s; }
  function on(node, ev, fn, opt) { if (node) node.addEventListener(ev, fn, opt); }

  var el = {
    rhoOut: $('rhoOut'), rhoOut2: $('rhoOut2'),
    statTime: $('statTime'), statPts: $('statPts'),
    speed: $('speed'), speedOut: $('speedOut'),
    trail: $('trail'), trailOut: $('trailOut'),
    spin: $('spin'), spinOut: $('spinOut'),
    rho: $('rho'),
    btnPause: $('btnPause'), btnReset: $('btnReset'), btnGlow: $('btnGlow')
  };

  function syncLabels() {
    setText(el.speedOut, params.speed.toFixed(2) + '×');
    setText(el.trailOut, String(params.trail));
    setText(el.spinOut, params.spin.toFixed(2) + '×');
    setText(el.rhoOut, params.rho.toFixed(1));
    setText(el.rhoOut2, params.rho.toFixed(1));
  }

  on(el.speed, 'input', function () { params.speed = parseFloat(this.value) || 1; syncLabels(); });
  on(el.trail, 'input', function () { params.trail = parseInt(this.value, 10) || 1400; syncLabels(); });
  on(el.spin, 'input', function () { params.spin = parseFloat(this.value) || 0; syncLabels(); });
  on(el.rho, 'input', function () {
    params.rho = parseFloat(this.value) || 28;
    updateScale(); syncLabels();
  });

  function togglePause() {
    paused = !paused;
    setText(el.btnPause, paused ? 'Продолжить' : 'Пауза');
    if (el.btnPause) el.btnPause.classList.toggle('on', paused);
  }
  function toggleGlow() {
    params.glow = !params.glow;
    if (el.btnGlow) {
      el.btnGlow.classList.toggle('on', params.glow);
      el.btnGlow.setAttribute('aria-pressed', params.glow ? 'true' : 'false');
    }
  }
  function doReset() {
    resetTraces();
    yaw = 0.55; tilt = 0.27; zoom = 1;
    updateCamera();
  }

  on(el.btnPause, 'click', togglePause);
  on(el.btnGlow, 'click', toggleGlow);
  on(el.btnReset, 'click', doReset);

  on(window, 'keydown', function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var code = e.code || '';
    if (code === 'Space') { e.preventDefault(); togglePause(); }
    else if (code === 'KeyR') doReset();
    else if (code === 'KeyG') toggleGlow();
  });

  // ------------------------------------------------------------ мышь / касание
  var dragging = false, lastX = 0, lastY = 0, pid = null;

  on(canvas, 'pointerdown', function (e) {
    dragging = true; lastX = e.clientX; lastY = e.clientY; pid = e.pointerId;
    canvas.classList.add('dragging');
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(pid); } catch (err) { /* нет захвата — не критично */ } }
  });
  on(canvas, 'pointermove', function (e) {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.006;
    tilt += (e.clientY - lastY) * 0.005;
    if (tilt > 1.25) tilt = 1.25; else if (tilt < -1.25) tilt = -1.25;
    lastX = e.clientX; lastY = e.clientY;
    updateCamera();
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('dragging');
    if (pid !== null && canvas.releasePointerCapture) {
      try { canvas.releasePointerCapture(pid); } catch (err) { /* уже отпущен */ }
    }
    pid = null;
  }
  on(canvas, 'pointerup', endDrag);
  on(canvas, 'pointercancel', endDrag);
  on(window, 'blur', endDrag);

  on(canvas, 'wheel', function (e) {
    e.preventDefault();
    var k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.02 : 0.0011));
    zoom *= k;
    if (zoom < 0.45) zoom = 0.45; else if (zoom > 3.2) zoom = 3.2;
  }, { passive: false });

  // ------------------------------------------------------------------- запуск
  syncLabels();
  resize();
  updateCamera();
  resetTraces();
  requestAnimationFrame(frame);
})();
