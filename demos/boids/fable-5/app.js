/* Boids — отрисовка и управление. Логика стаи — в boids.js (window.Boids). */
(function () {
  'use strict';

  var B = window.Boids;

  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');
  var hud = document.getElementById('hud');

  var COUNT = 450;
  var params = Object.assign({}, B.DEFAULTS);

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

  var boids = [];
  function spawn() {
    boids = [];
    for (var i = 0; i < COUNT; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = params.minSpeed + Math.random() * (params.maxSpeed - params.minSpeed);
      boids.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
      });
    }
  }
  spawn();

  document.getElementById('btnReset').addEventListener('click', spawn);

  function bindSlider(id, key, fmt) {
    var input = document.getElementById(id);
    var out = document.getElementById(id + 'v');
    function apply() {
      params[key] = parseFloat(input.value);
      out.textContent = fmt ? fmt(params[key]) : params[key];
    }
    input.addEventListener('input', apply);
    apply();
  }
  bindSlider('sep', 'sepWeight', function (v) { return v.toFixed(1); });
  bindSlider('ali', 'aliWeight', function (v) { return v.toFixed(1); });
  bindSlider('coh', 'cohWeight', function (v) { return v.toFixed(1); });
  bindSlider('per', 'perception', function (v) { return Math.round(v); });
  bindSlider('spd', 'maxSpeed', function (v) { return Math.round(v); });

  var lastT = performance.now();
  var fpsSmooth = 60;

  function frame(now) {
    var dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    fpsSmooth += (1 / Math.max(dt, 1e-4) - fpsSmooth) * 0.05;

    boids = B.step(boids, params, W, H, dt);
    draw();
    requestAnimationFrame(frame);
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#0c1018';
    ctx.fillRect(0, 0, W, H);

    // Подсвеченный агент: радиус восприятия и связи с видимыми соседями.
    var hero = boids[0];
    var grid = B.buildGrid(boids, Math.max(params.perception, 8), W, H);
    var seen = B.neighborsOf(0, boids, grid, params.perception, W, H);

    ctx.beginPath();
    ctx.arc(hero.x, hero.y, params.perception, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 196, 64, 0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 196, 64, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 196, 64, 0.25)';
    for (var k = 0; k < seen.length; k++) {
      var o = boids[seen[k]];
      // Линию через край тора не тянем — пропускаем дальних визуально.
      if (Math.abs(o.x - hero.x) > params.perception + 1 ||
          Math.abs(o.y - hero.y) > params.perception + 1) continue;
      ctx.beginPath();
      ctx.moveTo(hero.x, hero.y);
      ctx.lineTo(o.x, o.y);
      ctx.stroke();
    }

    // Стая: треугольники, повёрнутые по скорости, цвет по направлению.
    for (var i = 0; i < boids.length; i++) {
      var b = boids[i];
      var ang = Math.atan2(b.vy, b.vx);
      var hue = (ang * 180 / Math.PI + 360) % 360;
      drawBoid(b.x, b.y, ang,
        i === 0 ? '#ffc440' : 'hsl(' + hue + ', 60%, 62%)',
        i === 0 ? 7 : 5,
        seen.indexOf(i) !== -1);
    }

    hud.textContent = boids.length + ' агентов   FPS ≈ ' + Math.round(fpsSmooth);
  }

  function drawBoid(x, y, ang, color, size, highlighted) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(size * 1.6, 0);
    ctx.lineTo(-size, size * 0.7);
    ctx.lineTo(-size * 0.55, 0);
    ctx.lineTo(-size, -size * 0.7);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = highlighted ? 1 : 0.88;
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  requestAnimationFrame(frame);
})();
