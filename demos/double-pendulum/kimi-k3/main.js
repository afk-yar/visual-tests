/* Двойной маятник — Kimi K3
 * Классические уравнения движения (Lagrangian derivation),
 * интегрирование RK4 с фиксированным шагом, след нижнего груза,
 * режим «призрак» с микроскопическим отклонением начального угла.
 */
(function () {
  'use strict';

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');

  // ---------- Параметры маятника ----------
  var G = 9.81; // м/с²

  var params = {
    m1: 1.0, m2: 1.0,
    L1: 1.0, L2: 1.0
  };

  // Начальные углы (рад) и угловые скорости
  var INIT = { th1: Math.PI * 0.55, th2: Math.PI * 0.85, w1: 0, w2: 0 };
  var GHOST_EPS = 1e-4; // крошечное отклонение начального угла для призрака

  // Состояние: {th1, w1, th2, w2}
  var state = null;
  var ghost = null;
  var ghostOn = false;
  var running = true;

  // След нижнего груза
  var TRAIL_MAX = 600;
  var trail = [];
  var ghostTrail = [];

  // ---------- Уравнения движения ----------
  // state = [th1, w1, th2, w2] -> производные
  function derivs(s, m1, m2, L1, L2) {
    var th1 = s[0], w1 = s[1], th2 = s[2], w2 = s[3];
    var d = th1 - th2;
    var sd = Math.sin(d), cd = Math.cos(d);

    var den = 2 * m1 + m2 - m2 * Math.cos(2 * d); // = (2m1+m2) - m2 cos(2Δ)

    var a1 = (-G * (2 * m1 + m2) * Math.sin(th1)
              - m2 * G * Math.sin(th1 - 2 * th2)
              - 2 * sd * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * cd)) / (L1 * den);

    var a2 = (2 * sd * (w1 * w1 * L1 * (m1 + m2)
              + G * (m1 + m2) * Math.cos(th1)
              + w2 * w2 * L2 * m2 * cd)) / (L2 * den);

    return [w1, a1, w2, a2];
  }

  // RK4 шаг
  function rk4(s, dt, m1, m2, L1, L2) {
    var k1 = derivs(s, m1, m2, L1, L2);
    var s2 = new Array(4), s3 = new Array(4), s4 = new Array(4), i;
    for (i = 0; i < 4; i++) s2[i] = s[i] + k1[i] * dt * 0.5;
    var k2 = derivs(s2, m1, m2, L1, L2);
    for (i = 0; i < 4; i++) s3[i] = s[i] + k2[i] * dt * 0.5;
    var k3 = derivs(s3, m1, m2, L1, L2);
    for (i = 0; i < 4; i++) s4[i] = s[i] + k3[i] * dt;
    var k4 = derivs(s4, m1, m2, L1, L2);
    var out = new Array(4);
    for (i = 0; i < 4; i++) out[i] = s[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    return out;
  }

  // ---------- Состояние / сброс ----------
  function resetState() {
    state = [INIT.th1, INIT.w1, INIT.th2, INIT.w2];
    ghost = [INIT.th1 + GHOST_EPS, INIT.w1, INIT.th2, INIT.w2];
    trail.length = 0;
    ghostTrail.length = 0;
  }

  // ---------- Геометрия ----------
  function positions(s, originX, originY, scale) {
    var x1 = originX + params.L1 * scale * Math.sin(s[0]);
    var y1 = originY + params.L1 * scale * Math.cos(s[0]);
    var x2 = x1 + params.L2 * scale * Math.sin(s[2]);
    var y2 = y1 + params.L2 * scale * Math.cos(s[2]);
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
  }

  // ---------- Canvas / DPR ----------
  var W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function sceneScale() {
    // масштаб: вся длина (L1+L2) должна помещаться с запасом
    var total = (params.L1 + params.L2);
    return Math.min(W, H) * 0.42 / total;
  }

  // ---------- Цикл ----------
  var FIXED_DT = 1 / 480; // физический подшаг
  var acc = 0;
  var lastT = performance.now();

  function step(dt) {
    acc += dt;
    var guard = 0;
    while (acc >= FIXED_DT && guard < 2000) {
      state = rk4(state, FIXED_DT, params.m1, params.m2, params.L1, params.L2);
      if (ghostOn) {
        ghost = rk4(ghost, FIXED_DT, params.m1, params.m2, params.L1, params.L2);
      }
      acc -= FIXED_DT;
      guard++;
    }

    var scale = sceneScale();
    var ox = W / 2, oy = H * 0.38;

    var p = positions(state, ox, oy, scale);
    trail.push({ x: p.x2, y: p.y2 });
    if (trail.length > TRAIL_MAX) trail.shift();

    if (ghostOn) {
      var g = positions(ghost, ox, oy, scale);
      ghostTrail.push({ x: g.x2, y: g.y2 });
      if (ghostTrail.length > TRAIL_MAX) ghostTrail.shift();
    }
  }

  function drawTrail(t, r, gcol, b) {
    if (t.length < 2) return;
    for (var i = 1; i < t.length; i++) {
      var a = (i / t.length);
      a = a * a * 0.55; // затухание к хвосту
      ctx.strokeStyle = 'rgba(' + r + ',' + gcol + ',' + b + ',' + a.toFixed(3) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(t[i - 1].x, t[i - 1].y);
      ctx.lineTo(t[i].x, t[i].y);
      ctx.stroke();
    }
  }

  function drawPendulum(s, ox, oy, scale, opts) {
    var p = positions(s, ox, oy, scale);
    var r1 = 8 + 6 * Math.sqrt(params.m1);
    var r2 = 8 + 6 * Math.sqrt(params.m2);

    ctx.lineCap = 'round';

    // стержень 1
    ctx.strokeStyle = opts.rod;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(p.x1, p.y1);
    ctx.stroke();

    // стержень 2
    ctx.beginPath();
    ctx.moveTo(p.x1, p.y1);
    ctx.lineTo(p.x2, p.y2);
    ctx.stroke();

    // шарниры
    ctx.fillStyle = opts.joint;
    ctx.beginPath();
    ctx.arc(ox, oy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x1, p.y1, 4, 0, Math.PI * 2);
    ctx.fill();

    // груз 1
    ctx.fillStyle = opts.mass1;
    ctx.beginPath();
    ctx.arc(p.x1, p.y1, r1, 0, Math.PI * 2);
    ctx.fill();

    // груз 2
    ctx.fillStyle = opts.mass2;
    ctx.beginPath();
    ctx.arc(p.x2, p.y2, r2, 0, Math.PI * 2);
    ctx.fill();

    // блик
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(p.x2 - r2 * 0.3, p.y2 - r2 * 0.3, r2 * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    // фон
    var grad = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.5, Math.max(W, H));
    grad.addColorStop(0, '#141a28');
    grad.addColorStop(1, '#0b0e14');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    var scale = sceneScale();
    var ox = W / 2, oy = H * 0.38;

    // след призрака (под основным)
    if (ghostOn) drawTrail(ghostTrail, 255, 120, 190);
    // основной след
    drawTrail(trail, 90, 180, 255);

    // призрак
    if (ghostOn) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      drawPendulum(ghost, ox, oy, scale, {
        rod: 'rgba(255,120,190,0.7)',
        joint: 'rgba(255,160,210,0.8)',
        mass1: 'rgba(220,80,150,0.85)',
        mass2: 'rgba(255,120,190,0.85)'
      });
      ctx.restore();
    }

    // основной маятник
    drawPendulum(state, ox, oy, scale, {
      rod: 'rgba(200,215,240,0.9)',
      joint: '#aab8d4',
      mass1: '#3b82f6',
      mass2: '#8ab4ff'
    });
  }

  function frame(now) {
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.1) dt = 0.1; // кламп большого dt (свёрнутая вкладка)
    if (dt < 0) dt = 0;

    if (running) step(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- UI ----------
  var btnToggle = document.getElementById('btnToggle');
  var btnReset = document.getElementById('btnReset');
  var chkGhost = document.getElementById('chkGhost');

  btnToggle.addEventListener('click', function () {
    running = !running;
    btnToggle.textContent = running ? 'Пауза' : 'Пуск';
  });

  btnReset.addEventListener('click', function () {
    resetState();
    if (!running) {
      // перерисовать стартовую позу в паузе
      render();
    }
  });

  chkGhost.addEventListener('change', function () {
    ghostOn = chkGhost.checked;
    resetState();
  });

  function bindSlider(id, outId, key) {
    var rng = document.getElementById(id);
    var out = document.getElementById(outId);
    rng.addEventListener('input', function () {
      params[key] = parseFloat(rng.value);
      out.textContent = params[key].toFixed(2).replace(/0+$/, '').replace(/\.$/, '.0');
      resetState();
    });
  }
  bindSlider('rngM1', 'outM1', 'm1');
  bindSlider('rngM2', 'outM2', 'm2');
  bindSlider('rngL1', 'outL1', 'L1');
  bindSlider('rngL2', 'outL2', 'L2');

  // ---------- Старт ----------
  resetState();
  requestAnimationFrame(frame);
})();
