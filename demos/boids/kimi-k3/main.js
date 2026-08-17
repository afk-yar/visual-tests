'use strict';

(function () {
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');

  // --- Параметры (управляются ползунками) ---
  var params = {
    separation: 1.5,
    alignment: 1.0,
    cohesion: 1.0,
    radius: 50,      // радиус восприятия
    maxSpeed: 180    // пикс/с
  };

  var BOID_COUNT = 500;
  var MAX_FORCE = 900;       // ограничение рулевого ускорения
  var HIGHLIGHT_INDEX = 0;   // подсвеченный агент

  // --- Ползунки ---
  function bind(id, key, valId, digits) {
    var el = document.getElementById(id);
    var out = document.getElementById(valId);
    el.addEventListener('input', function () {
      params[key] = parseFloat(el.value);
      out.textContent = params[key].toFixed(digits);
    });
  }
  bind('sep', 'separation', 'v-sep', 2);
  bind('ali', 'alignment', 'v-ali', 2);
  bind('coh', 'cohesion', 'v-coh', 2);
  bind('rad', 'radius', 'v-rad', 0);
  bind('spd', 'maxSpeed', 'v-spd', 0);

  // --- Размеры / DPR ---
  var W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // --- Агенты ---
  var boids = [];
  function rand(a, b) { return a + Math.random() * (b - a); }
  for (var i = 0; i < BOID_COUNT; i++) {
    var ang = rand(0, Math.PI * 2);
    var spd = rand(60, params.maxSpeed * 0.8);
    boids.push({
      x: rand(0, W),
      y: rand(0, H),
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      isNeighbor: false
    });
  }

  // --- Тороидальная дельта ---
  function dxTorus(a, b, size) {
    var d = a - b;
    if (d > size / 2) d -= size;
    else if (d < -size / 2) d += size;
    return d;
  }

  // --- Пространственная сетка для поиска соседей ---
  var cellSize = 64;
  var cols = 1, rows = 1;
  var grid = []; // массив массивов индексов

  function buildGrid() {
    cellSize = Math.max(16, params.radius);
    cols = Math.max(1, Math.ceil(W / cellSize));
    rows = Math.max(1, Math.ceil(H / cellSize));
    var total = cols * rows;
    if (grid.length !== total) {
      grid = new Array(total);
      for (var g = 0; g < total; g++) grid[g] = [];
    } else {
      for (var g2 = 0; g2 < total; g2++) grid[g2].length = 0;
    }
    for (var i = 0; i < boids.length; i++) {
      var b = boids[i];
      var cx = ((b.x / cellSize) | 0) % cols; if (cx < 0) cx += cols;
      var cy = ((b.y / cellSize) | 0) % rows; if (cy < 0) cy += rows;
      grid[cy * cols + cx].push(i);
    }
  }

  // --- Физика ---
  function update(dt) {
    var r = params.radius;
    var r2 = r * r;
    var maxSpd = params.maxSpeed;

    buildGrid();

    for (var i = 0; i < boids.length; i++) {
      var b = boids[i];
      b.isNeighbor = false;

      var sepX = 0, sepY = 0;
      var aliX = 0, aliY = 0;
      var cohX = 0, cohY = 0;
      var count = 0;

      var cx = ((b.x / cellSize) | 0) % cols; if (cx < 0) cx += cols;
      var cy = ((b.y / cellSize) | 0) % rows; if (cy < 0) cy += rows;

      // соседние ячейки сетки с тороидальным переходом
      for (var gy = -1; gy <= 1; gy++) {
        var ry = (cy + gy + rows) % rows;
        for (var gx = -1; gx <= 1; gx++) {
          var rx = (cx + gx + cols) % cols;
          var cell = grid[ry * cols + rx];
          for (var k = 0; k < cell.length; k++) {
            var j = cell[k];
            if (j === i) continue;
            var o = boids[j];
            var dx = dxTorus(o.x, b.x, W);
            var dy = dxTorus(o.y, b.y, H);
            var d2 = dx * dx + dy * dy;
            if (d2 > r2 || d2 === 0) continue;

            count++;
            aliX += o.vx; aliY += o.vy;
            cohX += dx; cohY += dy;
            var inv = 1 / Math.max(d2, 0.01);
            sepX -= dx * inv; sepY -= dy * inv;
            if (i === HIGHLIGHT_INDEX) o.isNeighbor = true;
          }
        }
      }

      var ax = 0, ay = 0;

      if (count > 0) {
        // выравнивание: тянуться к средней скорости соседей
        ax += (aliX / count - b.vx) * params.alignment;
        ay += (aliY / count - b.vy) * params.alignment;
        // сцепление: тянуться к центру масс соседей
        ax += (cohX / count) * params.cohesion * 2.0;
        ay += (cohY / count) * params.cohesion * 2.0;
        // разделение
        ax += sepX * params.separation * 2200;
        ay += sepY * params.separation * 2200;
      }

      var f = Math.hypot(ax, ay);
      if (f > MAX_FORCE) { ax = ax / f * MAX_FORCE; ay = ay / f * MAX_FORCE; }

      b.vx += ax * dt;
      b.vy += ay * dt;

      var s = Math.hypot(b.vx, b.vy);
      if (s > maxSpd) { b.vx = b.vx / s * maxSpd; b.vy = b.vy / s * maxSpd; }
      else if (s < maxSpd * 0.25 && s > 0.001) {
        var t = maxSpd * 0.25 / s;
        b.vx *= t; b.vy *= t;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // тороидальный мир
      if (b.x < 0) b.x += W; else if (b.x >= W) b.x -= W;
      if (b.y < 0) b.y += H; else if (b.y >= H) b.y -= H;
    }
  }

  // --- Рендер ---
  function drawBoid(b, size) {
    var ang = Math.atan2(b.vy, b.vx);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.7, size * 0.55);
    ctx.lineTo(-size * 0.35, 0);
    ctx.lineTo(-size * 0.7, -size * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function render() {
    // лёгкое затухание следа
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, W, H);

    var hero = boids[HIGHLIGHT_INDEX];

    // радиус восприятия подсвеченного агента
    ctx.beginPath();
    ctx.arc(hero.x, hero.y, params.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 200, 60, 0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 200, 60, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // линии к видимым соседям
    ctx.strokeStyle = 'rgba(255, 200, 60, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < boids.length; i++) {
      var n = boids[i];
      if (!n.isNeighbor) continue;
      var dx = dxTorus(n.x, hero.x, W);
      var dy = dxTorus(n.y, hero.y, H);
      ctx.moveTo(hero.x, hero.y);
      ctx.lineTo(hero.x + dx, hero.y + dy);
    }
    ctx.stroke();

    // обычные агенты
    ctx.fillStyle = 'rgba(120, 190, 255, 0.85)';
    for (var i2 = 0; i2 < boids.length; i2++) {
      var b = boids[i2];
      if (i2 === HIGHLIGHT_INDEX || b.isNeighbor) continue;
      drawBoid(b, 6);
    }

    // соседи подсвеченного
    ctx.fillStyle = 'rgba(255, 214, 100, 0.95)';
    for (var i3 = 0; i3 < boids.length; i3++) {
      if (boids[i3].isNeighbor) drawBoid(boids[i3], 6.5);
    }

    // сам подсвеченный агент
    ctx.fillStyle = '#ff5d3b';
    drawBoid(hero, 9);
  }

  // --- Цикл ---
  var last = performance.now();
  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // кламп большого dt
    if (dt > 0) update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
