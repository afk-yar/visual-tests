(function () {
  'use strict';

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');

  var P = Lorenz.DEFAULTS; // { sigma: 10, rho: 28, beta: 8/3 }

  // Центр вращения — вокруг известного стационарного уровня z = rho - 1,
  // вокруг которого симметрично "накручены" оба крыла бабочки Лоренца.
  var centerX = 0, centerY = 0, centerZ = P.rho - 1;

  var width = 0, height = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- Состояние симуляции ----
  function initialState() {
    return [0.1, 0, 0];
  }

  var state = initialState();
  var trail = [];        // массив [x, y, z] — недавняя история траектории
  var maxTrail = 2200;

  var simSpeed = 1;      // множитель скорости модельного времени
  var paused = false;

  // ---- Камера ----
  var theta = 0.6;             // азимут (вращается автоматически)
  var phi = 0.35;              // угол наклона (elevation)
  var autoRotateSpeed = 0.12;  // рад/с — медленное автовращение

  var dragging = false;
  var lastPX = 0, lastPY = 0;

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastPX = e.clientX;
    lastPY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastPX;
    var dy = e.clientY - lastPY;
    lastPX = e.clientX;
    lastPY = e.clientY;
    theta += dx * 0.005;
    phi = clamp(phi - dy * 0.005, -1.45, 1.45);
  });
  window.addEventListener('pointerup', function () { dragging = false; });
  window.addEventListener('pointercancel', function () { dragging = false; });

  // ---- Панель управления ----
  var btnPause = document.getElementById('btn-pause');
  var btnReset = document.getElementById('btn-reset');
  var rngSpeed = document.getElementById('rng-speed');
  var rngTrail = document.getElementById('rng-trail');

  btnPause.addEventListener('click', function () {
    paused = !paused;
    btnPause.textContent = paused ? '►' : '⏸';
    btnPause.title = paused ? 'Продолжить' : 'Пауза';
  });

  btnReset.addEventListener('click', function () {
    state = initialState();
    trail = [];
    theta = 0.6;
    phi = 0.35;
  });

  rngSpeed.addEventListener('input', function () {
    simSpeed = parseFloat(rngSpeed.value);
  });

  rngTrail.addEventListener('input', function () {
    maxTrail = parseInt(rngTrail.value, 10);
    while (trail.length > maxTrail) trail.shift();
  });

  // ---- Шаг симуляции с фиксированным подшагом (стабильность RK4 не зависит от fps) ----
  var FIXED_SIM_STEP = 0.006; // модельное время на один RK4-подшаг

  function advanceSimulation(dtReal) {
    var simTime = dtReal * simSpeed;
    if (simTime <= 0) return;
    var steps = Math.max(1, Math.ceil(simTime / FIXED_SIM_STEP));
    var stepDt = simTime / steps;
    for (var i = 0; i < steps; i++) {
      state = Lorenz.step(state, stepDt, P);
      trail.push([state[0], state[1], state[2]]);
    }
    if (trail.length > maxTrail) {
      trail.splice(0, trail.length - maxTrail);
    }
  }

  // ---- Проекция 3D -> 2D (вращение вокруг Y на theta, наклон вокруг X на phi, перспектива) ----
  var projX = new Float32Array(0);
  var projY = new Float32Array(0);

  function projectTrail() {
    var n = trail.length;
    if (projX.length < n) {
      projX = new Float32Array(n * 2);
      projY = new Float32Array(n * 2);
    }

    var cosT = Math.cos(theta), sinT = Math.sin(theta);
    var cosP = Math.cos(phi), sinP = Math.sin(phi);
    var base = Math.min(width, height);
    var scale = base * 0.011;
    var camDist = base * 0.9;
    var minDenom = camDist * 0.25;

    for (var i = 0; i < n; i++) {
      var p = trail[i];
      var cx = p[0] - centerX;
      var cy = p[1] - centerY;
      var cz = p[2] - centerZ;

      // вращение вокруг вертикальной оси Y (азимут)
      var x1 = cx * cosT + cz * sinT;
      var z1 = -cx * sinT + cz * cosT;

      // наклон камеры вокруг оси X (elevation)
      var y2 = cy * cosP - z1 * sinP;
      var z2 = cy * sinP + z1 * cosP;
      var x2 = x1;

      var sx2 = x2 * scale, sy2 = y2 * scale, sz2 = z2 * scale;
      var denom = camDist + sz2;
      if (denom < minDenom) denom = minDenom;
      var f = camDist / denom;

      projX[i] = width / 2 + sx2 * f;
      projY[i] = height / 2 - sy2 * f;
    }
    return n;
  }

  // ---- Отрисовка ----
  var SEGMENTS = 56;      // число цветовых "бакетов" вдоль следа (перф. вместо посегментной заливки)
  var HUE_START = 210;    // холодный синий — старая часть следа
  var HUE_SPAN = 160;     // ...через фиолетовый/пурпурный к тёплому красно-оранжевому (без прохода через зелёный)

  function draw() {
    ctx.fillStyle = '#05060b';
    ctx.fillRect(0, 0, width, height);

    var n = projectTrail();
    if (n < 2) return;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (var s = 0; s < SEGMENTS; s++) {
      var i0 = Math.floor((s * (n - 1)) / SEGMENTS);
      var i1 = Math.floor(((s + 1) * (n - 1)) / SEGMENTS);
      if (i1 <= i0) continue;

      var frac = (i0 + i1) / 2 / (n - 1); // 0 = самый старый (хвост), 1 = текущий (голова)
      var hue = (HUE_START + frac * HUE_SPAN) % 360;
      var light = 46 + frac * 22;
      var alpha = Math.pow(frac, 0.7);

      ctx.beginPath();
      ctx.moveTo(projX[i0], projY[i0]);
      for (var i = i0 + 1; i <= i1; i++) ctx.lineTo(projX[i], projY[i]);
      ctx.strokeStyle = 'hsla(' + hue.toFixed(1) + ', 85%, ' + light.toFixed(1) + '%, ' + alpha.toFixed(3) + ')';
      ctx.lineWidth = 1 + frac * 1.8;
      ctx.stroke();
    }

    // светящаяся "голова" траектории — текущее положение точки
    var hx = projX[n - 1], hy = projY[n - 1];
    var glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 14);
    glow.addColorStop(0, 'rgba(255, 246, 220, 0.95)');
    glow.addColorStop(1, 'rgba(255, 246, 220, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(hx, hy, 14, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Главный цикл (dt-based, с клампом большого dt) ----
  var lastT = 0;

  function frame(now) {
    if (!lastT) lastT = now;
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05); // защита от больших скачков (смена вкладки и т.п.)

    if (!paused) {
      if (!dragging) theta += dt * autoRotateSpeed;
      advanceSimulation(dt);
    }

    draw();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
