'use strict';

/* Рейкастер-лабиринт — Kimi K3
 * Псевдо-3D в стиле Wolfenstein 3D: процедурный связный лабиринт,
 * DDA-рейкастинг по сетке, перспектива без «рыбьего глаза»,
 * мини-карта с сектором обзора, коллизии со скольжением.
 */

(function () {
  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d');

  // ---------- Параметры ----------
  var MAZE_CELLS = 13;          // лабиринт 13x13 клеток -> сетка 27x27
  var GRID = MAZE_CELLS * 2 + 1;
  var FOV = Math.PI / 3;        // 60 градусов
  var PLANE_LEN = Math.tan(FOV / 2);
  var MOVE_SPEED = 3.2;         // клеток/сек
  var ROT_SPEED = 2.4;          // рад/сек
  var PLAYER_RADIUS = 0.22;
  var MAX_DIST = 24;            // дальность тумана
  var MAX_DT = 0.05;            // кламп большого dt

  var map = [];                 // map[y][x]: 1 — стена, 0 — пусто
  var player = { x: 1.5, y: 1.5, dir: 0, planeX: 0, planeY: 0 };
  var keys = Object.create(null);

  // ---------- Генерация лабиринта (recursive backtracker) ----------
  function generateMaze() {
    var y, x;
    map = [];
    for (y = 0; y < GRID; y++) {
      var row = [];
      for (x = 0; x < GRID; x++) row.push(1);
      map.push(row);
    }

    var stack = [[0, 0]];
    var visited = [];
    for (y = 0; y < MAZE_CELLS; y++) {
      var vrow = [];
      for (x = 0; x < MAZE_CELLS; x++) vrow.push(false);
      visited.push(vrow);
    }
    visited[0][0] = true;
    map[1][1] = 0;

    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (stack.length > 0) {
      var cur = stack[stack.length - 1];
      var cx = cur[0], cy = cur[1];
      var options = [];
      for (var i = 0; i < 4; i++) {
        var nx = cx + dirs[i][0];
        var ny = cy + dirs[i][1];
        if (nx >= 0 && ny >= 0 && nx < MAZE_CELLS && ny < MAZE_CELLS && !visited[ny][nx]) {
          options.push([nx, ny]);
        }
      }
      if (options.length === 0) {
        stack.pop();
        continue;
      }
      var next = options[(Math.random() * options.length) | 0];
      // сносим стену между текущей и следующей клеткой
      map[cy * 2 + 1 + (next[1] - cy)][cx * 2 + 1 + (next[0] - cx)] = 0;
      map[next[1] * 2 + 1][next[0] * 2 + 1] = 0;
      visited[next[1]][next[0]] = true;
      stack.push(next);
    }

    // несколько случайных проходов, чтобы были петли
    var extra = (MAZE_CELLS * MAZE_CELLS * 0.12) | 0;
    for (var k = 0; k < extra; k++) {
      var wx = 1 + ((Math.random() * (GRID - 2)) | 0);
      var wy = 1 + ((Math.random() * (GRID - 2)) | 0);
      if (map[wy][wx] === 1) {
        var horiz = map[wy][wx - 1] === 0 && map[wy][wx + 1] === 0;
        var vert = map[wy - 1][wx] === 0 && map[wy + 1][wx] === 0;
        if (horiz || vert) map[wy][wx] = 0;
      }
    }
  }

  function setPlayerDir(angle) {
    player.dir = angle;
    // plane перпендикулярен направлению взгляда — корректная перспектива без «рыбьего глаза»
    player.planeX = -Math.sin(angle) * PLANE_LEN;
    player.planeY = Math.cos(angle) * PLANE_LEN;
  }

  function resetPlayer() {
    player.x = 1.5;
    player.y = 1.5;
    setPlayerDir(0); // смотрим в +X
  }

  // ---------- Размеры / DPR ----------
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

  // ---------- Управление ----------
  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (e.code.indexOf('Arrow') === 0 || e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', function (e) {
    keys[e.code] = false;
  });
  window.addEventListener('blur', function () {
    keys = Object.create(null);
  });

  var regenBtn = document.getElementById('regen');
  if (regenBtn) {
    regenBtn.addEventListener('click', function () {
      generateMaze();
      resetPlayer();
    });
  }

  // ---------- Коллизии со скольжением ----------
  function isWall(x, y) {
    var gx = x | 0, gy = y | 0;
    if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return true;
    return map[gy][gx] === 1;
  }

  function collides(x, y) {
    var r = PLAYER_RADIUS;
    return isWall(x - r, y - r) || isWall(x + r, y - r) ||
           isWall(x - r, y + r) || isWall(x + r, y + r);
  }

  function movePlayer(dt) {
    var rot = 0;
    if (keys.ArrowLeft) rot -= 1;
    if (keys.ArrowRight) rot += 1;
    if (rot !== 0) setPlayerDir(player.dir + rot * ROT_SPEED * dt);

    var fwd = 0, strafe = 0;
    if (keys.KeyW) fwd += 1;
    if (keys.KeyS) fwd -= 1;
    if (keys.KeyD) strafe += 1;
    if (keys.KeyA) strafe -= 1;
    if (fwd === 0 && strafe === 0) return;

    var len = Math.hypot(fwd, strafe);
    fwd /= len;
    strafe /= len;

    var dx = Math.cos(player.dir), dy = Math.sin(player.dir);
    var step = MOVE_SPEED * dt;
    var mx = (dx * fwd - dy * strafe) * step;
    var my = (dy * fwd + dx * strafe) * step;

    // скольжение: двигаем по осям независимо
    if (!collides(player.x + mx, player.y)) player.x += mx;
    if (!collides(player.x, player.y + my)) player.y += my;
  }

  // ---------- Рейкастинг (DDA) ----------
  function castRay(rayDirX, rayDirY) {
    var mapX = player.x | 0;
    var mapY = player.y | 0;

    var deltaDistX = (rayDirX === 0) ? 1e30 : Math.abs(1 / rayDirX);
    var deltaDistY = (rayDirY === 0) ? 1e30 : Math.abs(1 / rayDirY);

    var stepX, stepY, sideDistX, sideDistY;
    if (rayDirX < 0) {
      stepX = -1;
      sideDistX = (player.x - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1 - player.x) * deltaDistX;
    }
    if (rayDirY < 0) {
      stepY = -1;
      sideDistY = (player.y - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1 - player.y) * deltaDistY;
    }

    var side = 0;
    var hit = false;
    var guard = 0;
    while (!hit && guard < 128) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }
      if (mapX < 0 || mapY < 0 || mapX >= GRID || mapY >= GRID || map[mapY][mapX] === 1) hit = true;
      guard++;
    }

    // перпендикулярная дистанция — исправляет «рыбий глаз»
    var perpDist = (side === 0) ? (sideDistX - deltaDistX) : (sideDistY - deltaDistY);
    if (perpDist <= 0) perpDist = 1e-4;
    return { dist: perpDist, side: side, mapX: mapX, mapY: mapY };
  }

  // ---------- Рендер ----------
  function hash(x, y) {
    var h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) | 0;
    h = (h * 1274126177) | 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }

  function render() {
    // потолок
    var skyGrad = ctx.createLinearGradient(0, 0, 0, H / 2);
    skyGrad.addColorStop(0, '#10131d');
    skyGrad.addColorStop(1, '#232a40');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H / 2);

    // пол
    var floorGrad = ctx.createLinearGradient(0, H / 2, 0, H);
    floorGrad.addColorStop(0, '#2c2620');
    floorGrad.addColorStop(1, '#0d0b09');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, H / 2, W, H / 2);

    var dirX = Math.cos(player.dir);
    var dirY = Math.sin(player.dir);

    for (var x = 0; x < W; x++) {
      var cameraX = 2 * x / W - 1;
      var rayDirX = dirX + player.planeX * cameraX;
      var rayDirY = dirY + player.planeY * cameraX;

      var ray = castRay(rayDirX, rayDirY);
      var lineH = H / ray.dist;
      var drawStart = (H - lineH) / 2;
      if (drawStart < 0) drawStart = 0;
      var drawEnd = (H + lineH) / 2;
      if (drawEnd > H) drawEnd = H;

      // базовый цвет с лёгкой вариацией по клетке
      var tint = hash(ray.mapX, ray.mapY);
      var r = 150 + tint * 60;
      var g = 90 + tint * 40;
      var b = 70 + tint * 30;

      // сторона: вертикальные грани (N/S) темнее
      var shade = (ray.side === 1) ? 0.62 : 1.0;
      // затемнение по дальности
      var fog = Math.max(0, 1 - ray.dist / MAX_DIST);
      fog = fog * fog * (3 - 2 * fog); // smoothstep
      shade *= 0.15 + 0.85 * fog;

      ctx.fillStyle = 'rgb(' + ((r * shade) | 0) + ',' + ((g * shade) | 0) + ',' + ((b * shade) | 0) + ')';
      ctx.fillRect(x, drawStart, 1, drawEnd - drawStart);
    }

    renderMinimap();
  }

  // ---------- Мини-карта ----------
  function renderMinimap() {
    var scale = Math.min(6, Math.max(3, Math.floor(Math.min(W, H) / 90)));
    var size = GRID * scale;
    var ox = W - size - 16;
    var oy = 16;

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(8, 10, 16, 0.72)';
    ctx.fillRect(ox - 4, oy - 4, size + 8, size + 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(ox - 4.5, oy - 4.5, size + 9, size + 9);

    // стены
    ctx.fillStyle = '#5a6b8c';
    for (var y = 0; y < GRID; y++) {
      for (var x = 0; x < GRID; x++) {
        if (map[y][x] === 1) ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }

    // сектор обзора
    var px = ox + player.x * scale;
    var py = oy + player.y * scale;
    var fovR = 5.5 * scale;
    ctx.fillStyle = 'rgba(120, 190, 255, 0.18)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, fovR, player.dir - FOV / 2, player.dir + FOV / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 190, 255, 0.5)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(player.dir - FOV / 2) * fovR, py + Math.sin(player.dir - FOV / 2) * fovR);
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(player.dir + FOV / 2) * fovR, py + Math.sin(player.dir + FOV / 2) * fovR);
    ctx.stroke();

    // игрок
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, scale * 0.4), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ---------- Главный цикл ----------
  var lastTime = 0;

  function frame(t) {
    var dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > MAX_DT) dt = MAX_DT;
    if (dt < 0) dt = 0;

    movePlayer(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Старт ----------
  generateMaze();
  resetPlayer();
  resize();
  requestAnimationFrame(frame);
})();
