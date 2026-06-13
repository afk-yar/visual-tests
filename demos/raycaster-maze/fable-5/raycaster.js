/*
 * Рейкастер — чистая логика без DOM: генерация лабиринта, DDA-каст луча,
 * движение с коллизиями. Dual-mode: window.Raycaster / module.exports.
 *
 * Карта: Uint8Array w*h, 0 — проход, >0 — стена (значение = тип стены).
 */
(function (global) {
  'use strict';

  /*
   * Лабиринт «recursive backtracker» на нечётной сетке.
   * rng — () => [0,1). Гарантирует связность всех проходов.
   */
  function generateMaze(w, h, rng) {
    if (w % 2 === 0) w--;
    if (h % 2 === 0) h--;
    var map = new Uint8Array(w * h);
    for (var i = 0; i < map.length; i++) map[i] = 1;

    var stack = [[1, 1]];
    map[1 * w + 1] = 0;
    while (stack.length) {
      var cur = stack[stack.length - 1];
      var x = cur[0], y = cur[1];
      var dirs = shuffle([[2, 0], [-2, 0], [0, 2], [0, -2]], rng);
      var carved = false;
      for (var k = 0; k < 4; k++) {
        var nx = x + dirs[k][0], ny = y + dirs[k][1];
        if (nx < 1 || nx >= w - 1 || ny < 1 || ny >= h - 1) continue;
        if (map[ny * w + nx] === 0) continue;
        map[ny * w + nx] = 0;
        map[(y + dirs[k][1] / 2) * w + (x + dirs[k][0] / 2)] = 0;
        stack.push([nx, ny]);
        carved = true;
        break;
      }
      if (!carved) stack.pop();
    }

    // Разные типы стен (оттенки) — детерминированно по координате.
    for (var yy = 0; yy < h; yy++) {
      for (var xx = 0; xx < w; xx++) {
        if (map[yy * w + xx]) map[yy * w + xx] = 1 + ((xx * 7 + yy * 13) % 3);
      }
    }
    return { map: map, w: w, h: h };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function isWall(maze, x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || xi >= maze.w || yi < 0 || yi >= maze.h) return 1;
    return maze.map[yi * maze.w + xi];
  }

  /*
   * DDA-каст (по Lode Vandevenne). Возвращает перпендикулярную дистанцию
   * до стены — она уже свободна от «рыбьего глаза», cos-коррекция не нужна.
   * side: 0 — пересечена вертикальная грань (стена вдоль y), 1 — горизонтальная.
   * wallX: точка попадания вдоль стены [0,1) — для текстурирования.
   */
  function castRay(maze, posX, posY, rayDirX, rayDirY) {
    var mapX = Math.floor(posX), mapY = Math.floor(posY);
    var deltaX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
    var deltaY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);
    var stepX, stepY, sideX, sideY;

    if (rayDirX < 0) { stepX = -1; sideX = (posX - mapX) * deltaX; }
    else { stepX = 1; sideX = (mapX + 1 - posX) * deltaX; }
    if (rayDirY < 0) { stepY = -1; sideY = (posY - mapY) * deltaY; }
    else { stepY = 1; sideY = (mapY + 1 - posY) * deltaY; }

    var side = 0;
    for (var guard = 0; guard < 4096; guard++) {
      if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
      else { sideY += deltaY; mapY += stepY; side = 1; }
      if (mapX < 0 || mapX >= maze.w || mapY < 0 || mapY >= maze.h) break;
      if (maze.map[mapY * maze.w + mapX]) {
        var perpDist = side === 0 ? sideX - deltaX : sideY - deltaY;
        var wallX = side === 0
          ? posY + perpDist * rayDirY
          : posX + perpDist * rayDirX;
        wallX -= Math.floor(wallX);
        return {
          dist: perpDist,
          side: side,
          wall: maze.map[mapY * maze.w + mapX],
          wallX: wallX,
          mapX: mapX,
          mapY: mapY,
        };
      }
    }
    return { dist: 1e30, side: 0, wall: 0, wallX: 0, mapX: -1, mapY: -1 };
  }

  /*
   * Движение с коллизиями и скольжением: оси проверяются раздельно,
   * упор в стену по одной оси не блокирует движение по другой.
   * radius — отступ от стен.
   */
  function tryMove(maze, x, y, nx, ny, radius) {
    var rx = nx, ry = y;
    if (blocked(maze, nx, y, radius)) rx = x;
    if (blocked(maze, rx, ny, radius)) ry = y;
    else ry = ny;
    return { x: rx, y: ry };
  }

  function blocked(maze, x, y, r) {
    return isWall(maze, x - r, y - r) || isWall(maze, x + r, y - r) ||
           isWall(maze, x - r, y + r) || isWall(maze, x + r, y + r);
  }

  // Все ли проходы достижимы из (1,1) — проверка связности для тестов.
  function isFullyConnected(maze) {
    var seen = new Uint8Array(maze.w * maze.h);
    var queue = [[1, 1]];
    seen[maze.w + 1] = 1;
    var visited = 0;
    while (queue.length) {
      var c = queue.pop();
      visited++;
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var k = 0; k < 4; k++) {
        var nx = c[0] + dirs[k][0], ny = c[1] + dirs[k][1];
        var idx = ny * maze.w + nx;
        if (nx < 0 || nx >= maze.w || ny < 0 || ny >= maze.h) continue;
        if (seen[idx] || maze.map[idx]) continue;
        seen[idx] = 1;
        queue.push([nx, ny]);
      }
    }
    var total = 0;
    for (var i = 0; i < maze.map.length; i++) if (maze.map[i] === 0) total++;
    return visited === total;
  }

  var api = {
    generateMaze: generateMaze,
    castRay: castRay,
    tryMove: tryMove,
    isWall: isWall,
    isFullyConnected: isFullyConnected,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Raycaster = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
