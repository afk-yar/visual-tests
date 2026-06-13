'use strict';
/*
 * Рейкастер-лабиринт — рендер, ввод, цикл. Вся чистая логика (генерация,
 * DDA, коллизии) — в raycast.js (window.Raycast). Здесь: проекция столбцов
 * стен из перп.-расстояния, пол/потолок флор-кастингом, мини-карта, ввод.
 */
(function () {
  var R = window.Raycast;

  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d', { alpha: false });
  var hintEl = document.getElementById('hint');

  // --- Параметры мира --------------------------------------------------------
  var MAZE_COLS = 27, MAZE_ROWS = 21;
  var FOV_PLANE = 0.66;     // полудлина плоскости камеры → ~66° обзора
  var MOVE_SPEED = 3.0;     // клеток/с
  var TURN_SPEED = 2.7;     // рад/с
  var RADIUS = 0.18;        // радиус коллизии игрока
  var RENDER_SCALE = 0.7;   // внутреннее разрешение флор-каста (для скорости)

  // Палитры стен по «материалу» (1..3): тёплый кирпич, серый камень, мшистый.
  var WALL_RGB = [
    null,
    [171, 102, 78],
    [124, 132, 150],
    [108, 138, 104],
  ];
  var FLOOR_RGB = [44, 40, 34];
  var CEIL_RGB = [30, 35, 46];

  // --- Состояние -------------------------------------------------------------
  var maze, player;

  function newMaze() {
    maze = R.generateMaze(MAZE_COLS, MAZE_ROWS, Math.random, { braid: 0.18 });
    var spot = R.findOpenCell(maze, 1.5, 1.5);
    player = { x: spot.x, y: spot.y, dirX: 1, dirY: 0 };
  }
  newMaze();

  document.getElementById('regen').addEventListener('click', function () {
    newMaze();
    canvas.focus();
  });

  // --- Размер холста / внутренний буфер --------------------------------------
  // Рисуем сцену в низкоразрешающий offscreen-буфер (ImageData) и растягиваем
  // на холст — флор-кастинг per-pixel иначе слишком дорог на больших экранах.
  var W = 0, H = 0;              // CSS-пиксели холста
  var BW = 0, BH = 0;           // размер внутреннего буфера
  var buf, img;                 // offscreen canvas + его ImageData
  var bufCtx;

  function resize() {
    W = Math.max(1, canvas.clientWidth);
    H = Math.max(1, canvas.clientHeight);
    canvas.width = W;
    canvas.height = H;
    ctx.imageSmoothingEnabled = false;

    BW = Math.max(1, Math.round(W * RENDER_SCALE));
    BH = Math.max(1, Math.round(H * RENDER_SCALE));
    if (!buf) {
      buf = document.createElement('canvas');
      bufCtx = buf.getContext('2d', { alpha: false });
    }
    buf.width = BW;
    buf.height = BH;
    img = bufCtx.createImageData(BW, BH);
  }
  window.addEventListener('resize', resize);
  resize();

  // --- Ввод (слушаем на window — фокус-независимо, насколько возможно) --------
  var keys = Object.create(null);
  var focused = false;

  function onKeyDown(e) {
    keys[e.code] = true;
    // Стрелки/пробел скроллят страницу-родителя — гасим, когда холст активен.
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' ||
        e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'Space') {
      e.preventDefault();
    }
  }
  function onKeyUp(e) { keys[e.code] = false; }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // Наведение/клик по холсту в iframe — даём ему фокус, чтобы стрелки слушались
  // именно здесь. keydown ловим на window, так что WASD работает и без клика.
  function grabFocus() {
    canvas.focus();
    focused = true;
    if (hintEl) hintEl.style.visibility = 'hidden';
  }
  canvas.addEventListener('pointerenter', grabFocus);
  canvas.addEventListener('pointerdown', grabFocus);
  canvas.addEventListener('focus', function () { focused = true; if (hintEl) hintEl.style.visibility = 'hidden'; });
  canvas.addEventListener('blur', function () { focused = false; keys = Object.create(null); });
  // На старте: если страница не во фрейме без курсора — авто-фокус не мешает.
  canvas.focus();

  // --- Обновление состояния --------------------------------------------------
  function update(dt) {
    var rot = 0;
    if (keys.ArrowLeft) rot -= TURN_SPEED * dt;
    if (keys.ArrowRight) rot += TURN_SPEED * dt;
    if (rot !== 0) {
      var c = Math.cos(rot), s = Math.sin(rot);
      var ndx = player.dirX * c - player.dirY * s;
      player.dirY = player.dirX * s + player.dirY * c;
      player.dirX = ndx;
    }

    var mx = 0, my = 0;
    if (keys.KeyW) { mx += player.dirX; my += player.dirY; }
    if (keys.KeyS) { mx -= player.dirX; my -= player.dirY; }
    if (keys.KeyA) { mx += player.dirY; my -= player.dirX; }  // стрейф влево
    if (keys.KeyD) { mx -= player.dirY; my += player.dirX; }  // стрейф вправо

    var len = Math.hypot(mx, my);
    if (len > 1e-9) {
      var step = MOVE_SPEED * dt / len;
      var moved = R.moveWithCollision(maze, player.x, player.y, mx * step, my * step, RADIUS);
      player.x = moved.x;
      player.y = moved.y;
    }
  }

  // --- Рендер сцены ----------------------------------------------------------
  // Один проход на столбец буфера: каст стены, затем флор-каст пикселей пола и
  // потолка под/над столбцом стены. Всё пишем в ImageData, затем blit на холст.
  function render() {
    var data = img.data;
    var planeX = -player.dirY * FOV_PLANE;
    var planeY = player.dirX * FOV_PLANE;
    var halfH = BH / 2;

    for (var col = 0; col < BW; col++) {
      var cameraX = 2 * col / BW - 1;        // [-1, 1] по плоскости камеры
      var rayDirX = player.dirX + planeX * cameraX;
      var rayDirY = player.dirY + planeY * cameraX;

      var hit = R.castRay(maze, player.x, player.y, rayDirX, rayDirY);

      // Высота столбца стены из перп.-расстояния (коррекция рыбьего глаза).
      var perp = hit.hit ? Math.max(hit.dist, 1e-4) : 1e30;
      var lineH = BH / perp;
      var drawStart = Math.floor(halfH - lineH / 2);
      var drawEnd = Math.floor(halfH + lineH / 2);
      var wallTop = drawStart < 0 ? 0 : drawStart;
      var wallBot = drawEnd > BH ? BH : drawEnd;

      // Цвет стены: материал × сторона × затухание по дальности.
      var base = WALL_RGB[hit.cell] || WALL_RGB[2];
      var sideShade = hit.side === 1 ? 0.66 : 1.0;       // горизонт. грани темнее
      var fog = 1 / (1 + perp * perp * 0.018);           // мягкое затемнение вдаль
      var lit = sideShade * (0.18 + 0.82 * fog);
      var wr = base[0] * lit, wg = base[1] * lit, wb = base[2] * lit;

      // --- Стена ---
      var o;
      for (var y = wallTop; y < wallBot; y++) {
        o = (y * BW + col) * 4;
        data[o] = wr; data[o + 1] = wg; data[o + 2] = wb; data[o + 3] = 255;
      }

      // --- Пол и потолок (флор-кастинг) ---
      // Для строки y ниже стены экранная высота даёт расстояние до точки пола;
      // зеркально для потолка. Затем — оттенок с тем же fog по расстоянию.
      var floorWallX, floorWallY; // мировая точка у основания стены (для интерполяции)
      if (hit.side === 0) {
        floorWallX = hit.mapX + (rayDirX < 0 ? 1 : 0);
        floorWallY = player.y + (hit.hit ? hit.dist : 0) * rayDirY;
      } else {
        floorWallX = player.x + (hit.hit ? hit.dist : 0) * rayDirX;
        floorWallY = hit.mapY + (rayDirY < 0 ? 1 : 0);
      }

      var ratioBase = 0.5 * BH; // posZ камеры (на середине высоты стены)
      // Пол: от низа стены до дна экрана.
      var fStart = wallBot < 0 ? 0 : wallBot;
      for (var fy = fStart; fy < BH; fy++) {
        var rowDist = ratioBase / (fy - halfH);       // расстояние до точки пола
        var weight = rowDist / (hit.hit ? hit.dist : rowDist);
        var fx = weight * floorWallX + (1 - weight) * player.x;
        var fyw = weight * floorWallY + (1 - weight) * player.y;
        var ffog = 1 / (1 + rowDist * rowDist * 0.02);
        // лёгкая шахматная фактура пола по координате
        var tile = ((Math.floor(fx * 2) + Math.floor(fyw * 2)) & 1) ? 1.0 : 0.82;
        var fl = (0.12 + 0.88 * ffog) * tile;
        o = (fy * BW + col) * 4;
        data[o] = FLOOR_RGB[0] * fl;
        data[o + 1] = FLOOR_RGB[1] * fl;
        data[o + 2] = FLOOR_RGB[2] * fl;
        data[o + 3] = 255;

        // Потолок — зеркально (та же дистанция), однотонный с затуханием.
        var cy = BH - fy - 1;
        if (cy >= wallTop) continue; // не залезаем на стену
        var cl = 0.1 + 0.9 * ffog;
        var co = (cy * BW + col) * 4;
        data[co] = CEIL_RGB[0] * cl;
        data[co + 1] = CEIL_RGB[1] * cl;
        data[co + 2] = CEIL_RGB[2] * cl;
        data[co + 3] = 255;
      }
    }

    bufCtx.putImageData(img, 0, 0);
    ctx.drawImage(buf, 0, 0, BW, BH, 0, 0, W, H);

    drawMinimap();
  }

  // --- Мини-карта ------------------------------------------------------------
  function drawMinimap() {
    var maxCells = 21;
    var cell = Math.max(4, Math.min(8, Math.floor(180 / Math.max(maze.w, maze.h))));
    var mw = maze.w * cell, mh = maze.h * cell;
    var pad = 6;
    var ox = W - mw - 16, oy = 16;

    // подложка
    ctx.fillStyle = 'rgba(15, 17, 21, 0.82)';
    roundRect(ctx, ox - pad, oy - pad, mw + pad * 2, mh + pad * 2, 8);
    ctx.fill();
    ctx.strokeStyle = '#2a2f38';
    ctx.lineWidth = 1;
    roundRect(ctx, ox - pad, oy - pad, mw + pad * 2, mh + pad * 2, 8);
    ctx.stroke();

    // клетки
    for (var y = 0; y < maze.h; y++) {
      for (var x = 0; x < maze.w; x++) {
        var v = maze.cells[y * maze.w + x];
        ctx.fillStyle = v ? '#39414e' : '#1a1d23';
        ctx.fillRect(ox + x * cell, oy + y * cell, cell - 0.5, cell - 0.5);
      }
    }

    var px = ox + player.x * cell, py = oy + player.y * cell;
    var ang = Math.atan2(player.dirY, player.dirX);
    var halfFov = Math.atan(FOV_PLANE);

    // сектор обзора
    var rad = cell * 5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, rad, ang - halfFov, ang + halfFov);
    ctx.closePath();
    var grad = ctx.createRadialGradient(px, py, 0, px, py, rad);
    grad.addColorStop(0, 'rgba(55, 198, 217, 0.38)');
    grad.addColorStop(1, 'rgba(55, 198, 217, 0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // направление взгляда
    ctx.strokeStyle = '#37c6d9';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(ang) * rad, py + Math.sin(ang) * rad);
    ctx.stroke();

    // игрок
    ctx.fillStyle = '#37c6d9';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, cell * 0.35), 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // --- Главный цикл ----------------------------------------------------------
  var lastT = performance.now();
  function frame(now) {
    var dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
