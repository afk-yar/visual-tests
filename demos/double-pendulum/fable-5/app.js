/* Двойной маятник — отрисовка и управление. Физика — в pendulum.js (window.Pendulum). */
(function () {
  'use strict';

  var P = window.Pendulum;

  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');
  var hud = document.getElementById('hud');

  var PHYS_DT = 1 / 240;       // шаг интегрирования, с
  var TRAIL_TIME = 5;          // длительность следа, с (симуляционного времени)
  var TRAIL_EVERY = 2;         // писать точку следа раз в N физических шагов
  var GHOST_DELTA = 0.001;     // отклонение начального угла призрака, рад

  var params = { m1: 1, m2: 1, l1: 1, l2: 1, g: 9.81 };
  var initial = [Math.PI * 0.75, 0, Math.PI * 0.6, 0];

  var state, ghostState, trail, ghostTrail, simTime, running, ghostOn;
  var stepCounter = 0;

  function reset() {
    state = initial.slice();
    ghostState = [initial[0] + GHOST_DELTA, initial[1], initial[2], initial[3]];
    trail = [];
    ghostTrail = [];
    simTime = 0;
    stepCounter = 0;
  }

  reset();
  running = true;
  ghostOn = false;

  // --- Контролы ---------------------------------------------------------

  var btnRun = document.getElementById('btnRun');
  var btnReset = document.getElementById('btnReset');
  var chkGhost = document.getElementById('chkGhost');

  btnRun.addEventListener('click', function () {
    running = !running;
    btnRun.textContent = running ? '⏸ Пауза' : '▶ Пуск';
  });

  btnReset.addEventListener('click', reset);

  chkGhost.addEventListener('change', function () {
    ghostOn = chkGhost.checked;
    // Призрак стартует заново от текущего состояния с крошечным отклонением,
    // чтобы расхождение было видно с момента включения.
    ghostState = [state[0] + GHOST_DELTA, state[1], state[2], state[3]];
    ghostTrail = [];
  });

  function bindSlider(id, key) {
    var input = document.getElementById(id);
    var out = document.getElementById(id + 'v');
    function apply() {
      params[key] = parseFloat(input.value);
      out.textContent = params[key].toFixed(1);
    }
    input.addEventListener('input', apply);
    apply();
  }
  bindSlider('m1', 'm1');
  bindSlider('m2', 'm2');
  bindSlider('l1', 'l1');
  bindSlider('l2', 'l2');

  // --- Размер канваса ----------------------------------------------------

  var W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
  }
  window.addEventListener('resize', resize);
  resize();

  // --- Цикл симуляции ----------------------------------------------------

  var lastT = performance.now();
  var accum = 0;
  var fps = 0, fpsSmooth = 60;

  function frame(now) {
    var frameDt = Math.min((now - lastT) / 1000, 0.05); // защита от больших пауз вкладки
    lastT = now;
    fps = 1 / Math.max(frameDt, 1e-4);
    fpsSmooth += (fps - fpsSmooth) * 0.05;

    if (running) {
      accum += frameDt;
      while (accum >= PHYS_DT) {
        state = P.rk4Step(state, PHYS_DT, params);
        if (ghostOn) ghostState = P.rk4Step(ghostState, PHYS_DT, params);
        simTime += PHYS_DT;
        accum -= PHYS_DT;
        stepCounter++;
        if (stepCounter % TRAIL_EVERY === 0) {
          var pos = P.positions(state, params);
          trail.push({ x: pos.x2, y: pos.y2, t: simTime });
          if (ghostOn) {
            var gp = P.positions(ghostState, params);
            ghostTrail.push({ x: gp.x2, y: gp.y2, t: simTime });
          }
        }
      }
      pruneTrail(trail);
      pruneTrail(ghostTrail);
    }

    draw();
    requestAnimationFrame(frame);
  }

  function pruneTrail(arr) {
    var cutoff = simTime - TRAIL_TIME;
    while (arr.length && arr[0].t < cutoff) arr.shift();
  }

  // --- Отрисовка ---------------------------------------------------------

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var cx = W / 2;
    var cy = H * 0.38;
    var scale = Math.min(W, H) * 0.42 / (params.l1 + params.l2);

    drawTrail(ghostTrail, 'rgba(255,160,80,', scale, cx, cy);
    drawTrail(trail, 'rgba(90,200,255,', scale, cx, cy);

    if (ghostOn) drawPendulum(ghostState, scale, cx, cy, true);
    drawPendulum(state, scale, cx, cy, false);

    // Точка подвеса.
    ctx.fillStyle = '#8a93a6';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    hud.textContent =
      't = ' + simTime.toFixed(1) + ' с   ' +
      'E = ' + P.energy(state, params).toFixed(2) + ' Дж   ' +
      'FPS ≈ ' + Math.round(fpsSmooth);
  }

  function drawTrail(arr, rgbaPrefix, scale, cx, cy) {
    if (arr.length < 2) return;
    ctx.lineCap = 'round';
    for (var i = 1; i < arr.length; i++) {
      var age = (simTime - arr[i].t) / TRAIL_TIME;
      var alpha = Math.pow(1 - age, 1.6) * 0.85;
      if (alpha <= 0.01) continue;
      ctx.strokeStyle = rgbaPrefix + alpha + ')';
      ctx.lineWidth = 1 + (1 - age) * 1.6;
      ctx.beginPath();
      ctx.moveTo(cx + arr[i - 1].x * scale, cy + arr[i - 1].y * scale);
      ctx.lineTo(cx + arr[i].x * scale, cy + arr[i].y * scale);
      ctx.stroke();
    }
  }

  function drawPendulum(s, scale, cx, cy, isGhost) {
    var pos = P.positions(s, params);
    var x1 = cx + pos.x1 * scale, y1 = cy + pos.y1 * scale;
    var x2 = cx + pos.x2 * scale, y2 = cy + pos.y2 * scale;
    var alpha = isGhost ? 0.45 : 1;

    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = isGhost ? 'rgba(255,170,90,' + alpha + ')' : 'rgba(190,200,215,' + alpha + ')';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Радиус груза ~ кубический корень массы.
    var r1 = 7 * Math.cbrt(params.m1);
    var r2 = 7 * Math.cbrt(params.m2);

    ctx.fillStyle = isGhost ? 'rgba(255,170,90,' + alpha + ')' : '#e8b84b';
    ctx.beginPath();
    ctx.arc(x1, y1, r1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isGhost ? 'rgba(255,140,60,' + alpha + ')' : '#5ac8ff';
    ctx.beginPath();
    ctx.arc(x2, y2, r2, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(frame);
})();
