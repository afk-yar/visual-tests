/* Рейкастер-лабиринт — рендер и управление. Алгоритмы — в raycaster.js. */
(function () {
  'use strict';

  var R = window.Raycaster;

  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');

  var MAZE_W = 23, MAZE_H = 17;
  var MOVE_SPEED = 2.6;   // клеток/с
  var TURN_SPEED = 2.6;   // рад/с
  var RADIUS = 0.22;
  var FOV_PLANE = 0.66;   // длина плоскости камеры (~66°)

  var maze = R.generateMaze(MAZE_W, MAZE_H, Math.random);
  var player = { x: 1.5, y: 1.5, dirX: 1, dirY: 0 };

  // Базовые цвета типов стен (тёмный кирпич, серый камень, тёплый камень).
  var WALL_COLORS = [
    null,
    [168, 96, 76],
    [128, 134, 148],
    [164, 140, 96],
  ];

  var W = 0, H = 0;
  function resize() {
    W = Math.floor(canvas.clientWidth / 2) * 2;
    H = canvas.clientHeight;
    canvas.width = W;
    canvas.height = H;
  }
  window.addEventListener('resize', resize);
  resize();

  // --- Ввод ------------------------------------------------------------------

  var keys = {};
  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].indexOf(e.code) !== -1) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  // Клик по канвасу — фокус для клавиатуры внутри iframe.
  canvas.addEventListener('pointerdown', function () { window.focus(); });

  // --- Цикл ------------------------------------------------------------------

  var lastT = performance.now();

  function frame(now) {
    var dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function update(dt) {
    var rot = 0;
    if (keys.ArrowLeft) rot -= TURN_SPEED * dt;
    if (keys.ArrowRight) rot += TURN_SPEED * dt;
    if (rot !== 0) {
      var cos = Math.cos(rot), sin = Math.sin(rot);
      var ndx = player.dirX * cos - player.dirY * sin;
      player.dirY = player.dirX * sin + player.dirY * cos;
      player.dirX = ndx;
    }

    var mx = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) { mx += player.dirX; my += player.dirY; }
    if (keys.KeyS || keys.ArrowDown) { mx -= player.dirX; my -= player.dirY; }
    if (keys.KeyA) { mx += player.dirY; my -= player.dirX; }   // стрейф влево
    if (keys.KeyD) { mx -= player.dirY; my += player.dirX; }   // стрейф вправо

    var len = Math.hypot(mx, my);
    if (len > 1e-9) {
      mx = mx / len * MOVE_SPEED * dt;
      my = my / len * MOVE_SPEED * dt;
      var moved = R.tryMove(maze, player.x, player.y, player.x + mx, player.y + my, RADIUS);
      player.x = moved.x;
      player.y = moved.y;
    }
  }

  // --- Рендер ----------------------------------------------------------------

  function render() {
    // Потолок и пол с лёгким градиентом глубины.
    var sky = ctx.createLinearGradient(0, 0, 0, H / 2);
    sky.addColorStop(0, '#2a3140');
    sky.addColorStop(1, '#141821');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H / 2);
    var floor = ctx.createLinearGradient(0, H / 2, 0, H);
    floor.addColorStop(0, '#181410');
    floor.addColorStop(1, '#2e2820');
    ctx.fillStyle = floor;
    ctx.fillRect(0, H / 2, W, H / 2);

    var planeX = -player.dirY * FOV_PLANE;
    var planeY = player.dirX * FOV_PLANE;
    var colW = 2; // рендерим полосами по 2px — быстрее без потери вида

    for (var col = 0; col < W; col += colW) {
      var cameraX = 2 * col / W - 1;
      var hit = R.castRay(maze, player.x, player.y,
        player.dirX + planeX * cameraX, player.dirY + planeY * cameraX);
      if (!hit.wall) continue;

      var lineH = Math.min(H / hit.dist, H * 3);
      var y0 = (H - lineH) / 2;

      var base = WALL_COLORS[hit.wall];
      // Горизонтальные грани темнее — даёт объём; затемнение по дальности.
      var shade = (hit.side === 1 ? 0.72 : 1) * Math.min(1, 2.6 / (hit.dist + 0.4));
      // Тонкая вертикальная фактура от wallX.
      var texture = 0.9 + 0.1 * Math.sin(hit.wallX * Math.PI * 8);
      ctx.fillStyle = 'rgb(' +
        Math.round(base[0] * shade * texture) + ',' +
        Math.round(base[1] * shade * texture) + ',' +
        Math.round(base[2] * shade * texture) + ')';
      ctx.fillRect(col, y0, colW, lineH);
    }

    drawMinimap();
  }

  function drawMinimap() {
    var cell = 7;
    var mw = maze.w * cell, mh = maze.h * cell;
    var ox = W - mw - 14, oy = 14;

    ctx.fillStyle = 'rgba(10, 12, 18, 0.78)';
    ctx.fillRect(ox - 5, oy - 5, mw + 10, mh + 10);

    for (var y = 0; y < maze.h; y++) {
      for (var x = 0; x < maze.w; x++) {
        if (!maze.map[y * maze.w + x]) continue;
        ctx.fillStyle = '#5a6478';
        ctx.fillRect(ox + x * cell, oy + y * cell, cell - 1, cell - 1);
      }
    }

    // Сектор обзора.
    var px = ox + player.x * cell, py = oy + player.y * cell;
    var ang = Math.atan2(player.dirY, player.dirX);
    var fov = Math.atan(FOV_PLANE);
    ctx.fillStyle = 'rgba(255, 196, 64, 0.18)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, cell * 4, ang - fov, ang + fov);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffc440';
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(frame);
})();
