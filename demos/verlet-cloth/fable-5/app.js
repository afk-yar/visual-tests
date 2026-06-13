/* Ткань — отрисовка и взаимодействие. Физика — в verlet.js (window.Verlet). */
(function () {
  'use strict';

  var V = window.Verlet;

  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');
  var hud = document.getElementById('hud');

  var GRAVITY = 1100;
  var DAMPING = 0.995;
  var ITERATIONS = 4;
  var TEAR = 4.5;          // связь рвётся при растяжении в 4.5 раза
  var GRAB_RADIUS = 28;

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

  var cloth;
  function reset() {
    var cols = 42, rows = 26;
    var spacing = Math.min(W * 0.8 / (cols - 1), 16);
    var x0 = (W - spacing * (cols - 1)) / 2;
    cloth = V.makeCloth(cols, rows, spacing, x0, 40, 6);
  }
  reset();
  document.getElementById('btnReset').addEventListener('click', reset);

  // --- Мышь: захват ближайшей точки и перетаскивание ---------------------

  var grabbed = -1;
  var mouse = { x: 0, y: 0 };

  canvas.addEventListener('pointerdown', function (e) {
    mouse.x = e.offsetX; mouse.y = e.offsetY;
    var best = -1, bestD = GRAB_RADIUS * GRAB_RADIUS;
    for (var i = 0; i < cloth.points.length; i++) {
      var p = cloth.points[i];
      var d = (p.x - mouse.x) * (p.x - mouse.x) + (p.y - mouse.y) * (p.y - mouse.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    grabbed = best;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', function (e) {
    mouse.x = e.offsetX; mouse.y = e.offsetY;
  });

  canvas.addEventListener('pointerup', function (e) {
    grabbed = -1;
    canvas.releasePointerCapture(e.pointerId);
  });

  // --- Цикл ----------------------------------------------------------------

  var lastT = performance.now();
  var windPhase = 0;

  function frame(now) {
    var dt = Math.min((now - lastT) / 1000, 0.033);
    lastT = now;
    windPhase += dt;

    // Лёгкий переменный ветер.
    var wind = Math.sin(windPhase * 0.7) * 28 + Math.sin(windPhase * 1.9) * 16;

    var sub = 2;
    for (var s = 0; s < sub; s++) {
      V.integrate(cloth.points, dt / sub, wind, GRAVITY, DAMPING);
      if (grabbed >= 0 && !cloth.points[grabbed].pinned) {
        var gp = cloth.points[grabbed];
        gp.x = mouse.x; gp.y = mouse.y;
        gp.px = mouse.x; gp.py = mouse.y;
      }
      V.solveConstraints(cloth.points, cloth.constraints, ITERATIONS, TEAR);
    }

    draw();
    requestAnimationFrame(frame);
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#10131b';
    ctx.fillRect(0, 0, W, H);

    var alive = 0;
    ctx.lineWidth = 1;
    for (var i = 0; i < cloth.constraints.length; i++) {
      var c = cloth.constraints[i];
      if (c.broken) continue;
      alive++;
      var pa = cloth.points[c.a], pb = cloth.points[c.b];
      var dx = pb.x - pa.x, dy = pb.y - pa.y;
      var strain = Math.min(Math.max(Math.hypot(dx, dy) / c.rest - 1, 0) / (TEAR - 1), 1);
      // Напряжённые связи теплеют: голубой -> янтарный.
      ctx.strokeStyle = 'hsl(' + (200 - strain * 160) + ', 75%, ' + (62 + strain * 12) + '%)';
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // Закреплённые точки.
    ctx.fillStyle = '#e8b84b';
    for (var k = 0; k < cloth.points.length; k++) {
      if (!cloth.points[k].pinned) continue;
      ctx.beginPath();
      ctx.arc(cloth.points[k].x, cloth.points[k].y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (grabbed >= 0) {
      var g = cloth.points[grabbed];
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(g.x, g.y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    hud.textContent = 'связей: ' + alive + ' / ' + cloth.constraints.length +
      '   тяните мышью; сильное растяжение рвёт ткань';
  }

  requestAnimationFrame(frame);
})();
