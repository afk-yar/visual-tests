'use strict';
(function () {
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var regenBtn = document.getElementById('regen-btn');

  var DPR_CAP = 2;
  var dpr = 1;

  // ---- параметры мира -------------------------------------------------
  var MAZE_COLS = 12; // логические клетки лабиринта по X
  var MAZE_ROWS = 9;  // логические клетки лабиринта по Y
  var FOV = (72 * Math.PI) / 180;
  var PLANE_LEN = Math.tan(FOV / 2);

  var MOVE_SPEED = 2.6;   // юнитов/сек, вперёд-назад
  var STRAFE_SPEED = 2.3; // юнитов/сек, стрейф
  var ROT_SPEED = 2.4;    // рад/сек, поворот стрелками
  var PLAYER_RADIUS = 0.22;

  var WALL_COLOR_A = [178, 92, 70];  // тёплый (кирпич)
  var WALL_COLOR_B = [92, 122, 142]; // холодный (камень)
  var CEIL_BASE = [40, 45, 58];
  var FLOOR_BASE = [52, 54, 60];

  var maze = null; // { grid, width, height }
  var player = { x: 1.5, y: 1.5, dirX: 1, dirY: 0, planeX: 0, planeY: PLANE_LEN };

  var keys = Object.create(null);
  var lastTime = null;

  // ---- утилиты ----------------------------------------------------------
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function mixColor(rgb, factor) {
    factor = clamp(factor, 0, 1);
    var r = (rgb[0] * factor) | 0;
    var g = (rgb[1] * factor) | 0;
    var b = (rgb[2] * factor) | 0;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function randomSeed() {
    return (Math.random() * 0xffffffff) >>> 0;
  }

  // ---- лабиринт и игрок ---------------------------------------------------
  function spawnMaze() {
    var rng = window.Maze.mulberry32(randomSeed());
    maze = window.Maze.generateMaze(MAZE_COLS, MAZE_ROWS, rng);
    // старт всегда в центре первой комнаты (клетка (0,0) -> координата сетки 1.5,1.5)
    player.x = 1.5;
    player.y = 1.5;
    player.dirX = 1;
    player.dirY = 0;
    player.planeX = 0;
    player.planeY = PLANE_LEN;
  }

  function rotatePlayer(angle) {
    var cosA = Math.cos(angle);
    var sinA = Math.sin(angle);
    var dx = player.dirX;
    var dy = player.dirY;
    player.dirX = dx * cosA - dy * sinA;
    player.dirY = dx * sinA + dy * cosA;
    var px = player.planeX;
    var py = player.planeY;
    player.planeX = px * cosA - py * sinA;
    player.planeY = px * sinA + py * cosA;
  }

  function isBlocked(x, y) {
    return window.Maze.isWallCell(maze.grid, maze.width, maze.height, Math.floor(x), Math.floor(y));
  }

  // Проверка "коробкой" вокруг игрока (радиус PLAYER_RADIUS), чтобы не
  // проваливаться в стену углом при движении по диагонали.
  function canStandAt(x, y) {
    var r = PLAYER_RADIUS;
    return (
      !isBlocked(x - r, y - r) &&
      !isBlocked(x + r, y - r) &&
      !isBlocked(x - r, y + r) &&
      !isBlocked(x + r, y + r)
    );
  }

  // Раздельная проверка по осям X и Y даёт скольжение вдоль стен: если по
  // диагонали путь заблокирован, игрок всё равно продолжит двигаться вдоль
  // свободной оси, а не "прилипнет" намертво.
  function tryMove(dx, dy) {
    if (dx !== 0 && canStandAt(player.x + dx, player.y)) player.x += dx;
    if (dy !== 0 && canStandAt(player.x, player.y + dy)) player.y += dy;
  }

  function updateMovement(dt) {
    var forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    var strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    var rot = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);

    var dx = 0;
    var dy = 0;
    if (forward !== 0) {
      dx += player.dirX * forward * MOVE_SPEED * dt;
      dy += player.dirY * forward * MOVE_SPEED * dt;
    }
    if (strafe !== 0) {
      var planeLen = Math.hypot(player.planeX, player.planeY) || 1;
      var rightX = player.planeX / planeLen;
      var rightY = player.planeY / planeLen;
      dx += rightX * strafe * STRAFE_SPEED * dt;
      dy += rightY * strafe * STRAFE_SPEED * dt;
    }
    if (dx !== 0 || dy !== 0) tryMove(dx, dy);

    if (rot !== 0) rotatePlayer(rot * ROT_SPEED * dt);
  }

  // ---- рендер -------------------------------------------------------------
  function drawBackground(W, H) {
    var horizon = H / 2;
    var bandsCeil = 18;
    var bandsFloor = 18;

    for (var i = 0; i < bandsCeil; i++) {
      var t = i / (bandsCeil - 1);
      var y0 = Math.floor((horizon * i) / bandsCeil);
      var y1 = Math.floor((horizon * (i + 1)) / bandsCeil);
      var factor = lerp(0.82, 0.26, t); // ярче у верхнего края, темнее к горизонту (дальше)
      ctx.fillStyle = mixColor(CEIL_BASE, factor);
      ctx.fillRect(0, y0, W, y1 - y0 + 1);
    }

    for (var j = 0; j < bandsFloor; j++) {
      var tf = j / (bandsFloor - 1);
      var fy0 = Math.floor(horizon + ((H - horizon) * j) / bandsFloor);
      var fy1 = Math.floor(horizon + ((H - horizon) * (j + 1)) / bandsFloor);
      var ffactor = lerp(0.24, 0.92, tf); // темнее у горизонта (дальше), ярче внизу (ближе)
      ctx.fillStyle = mixColor(FLOOR_BASE, ffactor);
      ctx.fillRect(0, fy0, W, fy1 - fy0 + 1);
    }
  }

  function drawWalls(W, H) {
    var fogDist = Math.hypot(maze.width, maze.height) * 0.6;

    for (var x = 0; x < W; x++) {
      var cameraX = (2 * x) / W - 1;
      var rayDirX = player.dirX + player.planeX * cameraX;
      var rayDirY = player.dirY + player.planeY * cameraX;

      var hit = window.Maze.castRay(maze.grid, maze.width, maze.height, player.x, player.y, rayDirX, rayDirY);
      if (!hit) continue; // карта всегда окружена стенами, но подстрахуемся

      var dist = Math.max(hit.dist, 1e-4);
      var lineHeight = Math.floor(H / dist);
      var drawStart = Math.max(0, ((-lineHeight / 2 + H / 2) | 0));
      var drawEnd = Math.min(H - 1, ((lineHeight / 2 + H / 2) | 0));

      var parity = (hit.mapX + hit.mapY) & 1;
      var base = parity ? WALL_COLOR_A : WALL_COLOR_B;
      var sideShade = hit.side === 1 ? 0.72 : 1.0; // грани по Y чуть темнее — классическое Wolfenstein-затенение
      var fog = clamp(1 - dist / fogDist, 0.14, 1);

      ctx.fillStyle = mixColor(base, sideShade * fog);
      ctx.fillRect(x, drawStart, 1, drawEnd - drawStart + 1);
    }
  }

  function drawMinimap(W, H) {
    var margin = 14 * dpr;
    var maxDim = 190 * dpr;
    var cell = clamp(maxDim / Math.max(maze.width, maze.height), 3 * dpr, 9 * dpr);
    var mapW = maze.width * cell;
    var mapH = maze.height * cell;
    var ox = W - margin - mapW;
    var oy = margin;

    ctx.save();

    ctx.fillStyle = 'rgba(9,11,15,0.58)';
    roundRectPath(ctx, ox - 8 * dpr, oy - 8 * dpr, mapW + 16 * dpr, mapH + 16 * dpr, 9 * dpr);
    ctx.fill();

    for (var gy = 0; gy < maze.height; gy++) {
      for (var gx = 0; gx < maze.width; gx++) {
        var isWall = maze.grid[gy * maze.width + gx] === 1;
        ctx.fillStyle = isWall ? 'rgba(230,236,244,0.16)' : 'rgba(230,236,244,0.035)';
        ctx.fillRect(ox + gx * cell, oy + gy * cell, cell - 1, cell - 1);
      }
    }

    var px = ox + player.x * cell;
    var py = oy + player.y * cell;
    var sectorLen = 2.4; // условная длина луча сектора обзора, в юнитах карты
    var leftDirX = player.dirX - player.planeX;
    var leftDirY = player.dirY - player.planeY;
    var rightDirX = player.dirX + player.planeX;
    var rightDirY = player.dirY + player.planeY;

    ctx.strokeStyle = 'rgba(58,214,217,0.9)';
    ctx.lineWidth = Math.max(1, 1.2 * dpr);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + leftDirX * sectorLen * cell, py + leftDirY * sectorLen * cell);
    ctx.moveTo(px, py);
    ctx.lineTo(px + rightDirX * sectorLen * cell, py + rightDirY * sectorLen * cell);
    ctx.stroke();

    ctx.fillStyle = '#3ad6d9';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, 2.3 * dpr), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function render() {
    var W = canvas.width;
    var H = canvas.height;
    drawBackground(W, H);
    drawWalls(W, H);
    drawMinimap(W, H);
  }

  // ---- цикл кадра, ресайз, ввод -------------------------------------------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  }

  function frame(ts) {
    if (lastTime === null) lastTime = ts;
    var dt = (ts - lastTime) / 1000;
    lastTime = ts;
    if (dt > 0.05) dt = 0.05; // клампим большой dt (сворачивание вкладки и т.п.)

    updateMovement(dt);
    render();

    requestAnimationFrame(frame);
  }

  var NAV_KEYS = {
    ArrowLeft: true,
    ArrowRight: true,
    ArrowUp: true,
    ArrowDown: true,
    KeyW: true,
    KeyA: true,
    KeyS: true,
    KeyD: true,
    Space: true,
  };

  window.addEventListener('keydown', function (e) {
    if (NAV_KEYS[e.code]) e.preventDefault();
    keys[e.code] = true;
  });
  window.addEventListener('keyup', function (e) {
    keys[e.code] = false;
  });
  window.addEventListener('blur', function () {
    keys = Object.create(null);
  });
  canvas.addEventListener('pointerdown', function () {
    canvas.focus();
  });
  window.addEventListener('resize', resize);
  regenBtn.addEventListener('click', function () {
    spawnMaze();
  });

  resize();
  spawnMaze();
  canvas.focus();
  requestAnimationFrame(frame);
})();
