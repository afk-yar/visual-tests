'use strict';
/*
 * Raycast — чистая логика псевдо-3D лабиринта, без DOM. Dual-mode:
 * браузер → window.Raycast, node → module.exports (см. pendulum.js).
 *
 * Карта: { w, h, cells:Uint8Array(w*h) }, индекс = y*w + x.
 *   0 — проход, >0 — стена (значение = «материал» для оттенка).
 * Система координат мира — клеточная: целая часть = индекс клетки,
 * дробная — позиция внутри клетки [0,1). y растёт вниз.
 */
(function (root) {

  // ---- Генерация связного лабиринта ----------------------------------------
  //
  // Рандомизированный Прим на «толстой» сетке: проходимые клетки — нечётные
  // координаты, стены между ними «прорубаются». Алгоритм поддерживает фронтир
  // из стен, соседних с уже включённым деревом, и каждый раз прорубает
  // случайную из них к новой клетке. Результат — идеальный лабиринт (дерево):
  // связный, без циклов. Затем опционально пробиваем braid-проходы, убирая
  // часть тупиков, — связности это не ломает (только добавляет циклы).

  function idx(maze, x, y) { return y * maze.w + x; }

  function inBounds(maze, x, y) {
    return x >= 0 && x < maze.w && y >= 0 && y < maze.h;
  }

  function generateMaze(cols, rows, rng, opts) {
    rng = rng || Math.random;
    opts = opts || {};
    // Размеры приводим к нечётным — нужна рамка стен и сетка проходов.
    var w = cols % 2 === 0 ? cols + 1 : cols;
    var h = rows % 2 === 0 ? rows + 1 : rows;
    var cells = new Uint8Array(w * h);
    cells.fill(1); // всё — стена, прорубаем проходы

    var maze = { w: w, h: h, cells: cells };

    var startX = 1, startY = 1;
    cells[idx(maze, startX, startY)] = 0;

    // Фронтир: стены-перемычки между деревом и не включённой клеткой.
    // Элемент = [wallX, wallY, cellX, cellY] — стена и клетка за ней.
    var frontier = [];
    function pushFrontier(cx, cy) {
      var dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]];
      for (var i = 0; i < 4; i++) {
        var nx = cx + dirs[i][0], ny = cy + dirs[i][1];
        if (nx < 1 || nx >= w - 1 || ny < 1 || ny >= h - 1) continue;
        if (cells[idx(maze, nx, ny)] === 0) continue; // уже в дереве
        frontier.push([cx + dirs[i][0] / 2, cy + dirs[i][1] / 2, nx, ny]);
      }
    }
    pushFrontier(startX, startY);

    while (frontier.length) {
      var pick = Math.floor(rng() * frontier.length);
      var f = frontier[pick];
      frontier[pick] = frontier[frontier.length - 1];
      frontier.pop();

      var wx = f[0], wy = f[1], cx = f[2], cy = f[3];
      if (cells[idx(maze, cx, cy)] === 0) continue; // клетка уже включена

      cells[idx(maze, wx, wy)] = 0; // прорубаем перемычку
      cells[idx(maze, cx, cy)] = 0; // включаем клетку
      pushFrontier(cx, cy);
    }

    // Braid: с вероятностью braid убираем тупики, прорубая случайную стену.
    // Добавляет петли (интереснее для прогулки), связность сохраняется.
    var braid = opts.braid == null ? 0 : opts.braid;
    if (braid > 0) braidMaze(maze, rng, braid);

    // Материалы стен — детерминированно по координате, для разных оттенков.
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = idx(maze, x, y);
        if (cells[i]) cells[i] = 1 + ((x * 73856093 ^ y * 19349663) >>> 0) % 3;
      }
    }
    return maze;
  }

  function braidMaze(maze, rng, prob) {
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var y = 1; y < maze.h - 1; y++) {
      for (var x = 1; x < maze.w - 1; x++) {
        if (maze.cells[idx(maze, x, y)] !== 0) continue;
        // Тупик: ровно один открытый сосед.
        var open = [], walls = [];
        for (var d = 0; d < 4; d++) {
          var nx = x + dirs[d][0], ny = y + dirs[d][1];
          if (!inBounds(maze, nx, ny)) continue;
          if (maze.cells[idx(maze, nx, ny)] === 0) open.push(d);
          else if (nx > 0 && nx < maze.w - 1 && ny > 0 && ny < maze.h - 1) walls.push(d);
        }
        if (open.length === 1 && walls.length && rng() < prob) {
          var pick = walls[Math.floor(rng() * walls.length)];
          maze.cells[idx(maze, x + dirs[pick][0], y + dirs[pick][1])] = 0;
        }
      }
    }
  }

  // ---- Опрос карты ----------------------------------------------------------

  // Значение клетки в мировой точке (x,y). За границей — сплошная стена.
  function cellAt(maze, x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    if (!inBounds(maze, xi, yi)) return 1;
    return maze.cells[idx(maze, xi, yi)];
  }

  function isWall(maze, x, y) { return cellAt(maze, x, y) !== 0; }

  // Поиск стартовой проходимой клетки рядом с заданной (или первой свободной).
  function findOpenCell(maze, preferX, preferY) {
    if (preferX != null && cellAt(maze, preferX, preferY) === 0) {
      return { x: Math.floor(preferX) + 0.5, y: Math.floor(preferY) + 0.5 };
    }
    for (var y = 1; y < maze.h - 1; y++) {
      for (var x = 1; x < maze.w - 1; x++) {
        if (maze.cells[idx(maze, x, y)] === 0) return { x: x + 0.5, y: y + 0.5 };
      }
    }
    return { x: 1.5, y: 1.5 };
  }

  // ---- DDA-рейкаст ----------------------------------------------------------
  //
  // Цифровой дифференциальный анализатор по сетке (Amanatides–Woo / Lode V.).
  // Возвращает ПЕРПЕНДИКУЛЯРНОЕ расстояние до стены — проекцию на направление
  // взгляда камеры, а не евклидову длину луча. Именно перп.-расстояние убирает
  // «рыбий глаз»: высота столбца ∝ 1/perpDist, и плоская стена даёт ровную
  // линию по центральным лучам (см. raycast.test.js).
  //
  //   side: 0 — луч вошёл в стену через вертикальную грань (стена «вдоль Y»),
  //         1 — через горизонтальную грань (стена «вдоль X»).
  //   wallX — координата попадания вдоль грани [0,1), для текстур.
  function castRay(maze, posX, posY, dirX, dirY) {
    var mapX = Math.floor(posX), mapY = Math.floor(posY);

    // Длина луча при пересечении одной клеточной линии по X / по Y.
    var deltaX = dirX === 0 ? Infinity : Math.abs(1 / dirX);
    var deltaY = dirY === 0 ? Infinity : Math.abs(1 / dirY);

    var stepX, stepY, sideDistX, sideDistY;
    if (dirX < 0) { stepX = -1; sideDistX = (posX - mapX) * deltaX; }
    else { stepX = 1; sideDistX = (mapX + 1 - posX) * deltaX; }
    if (dirY < 0) { stepY = -1; sideDistY = (posY - mapY) * deltaY; }
    else { stepY = 1; sideDistY = (mapY + 1 - posY) * deltaY; }

    var side = 0;
    var guard = 2 * (maze.w + maze.h) + 4; // верхняя граница числа шагов
    while (guard-- > 0) {
      if (sideDistX < sideDistY) { sideDistX += deltaX; mapX += stepX; side = 0; }
      else { sideDistY += deltaY; mapY += stepY; side = 1; }

      if (!inBounds(maze, mapX, mapY)) break; // вышли за карту — нет стены
      var cell = maze.cells[idx(maze, mapX, mapY)];
      if (cell !== 0) {
        // perpDist = пройденное расстояние до пересечённой грани.
        var perpDist = side === 0 ? sideDistX - deltaX : sideDistY - deltaY;
        var wallX = side === 0 ? posY + perpDist * dirY : posX + perpDist * dirX;
        wallX -= Math.floor(wallX);
        return {
          dist: perpDist,
          side: side,
          cell: cell,
          wallX: wallX,
          mapX: mapX,
          mapY: mapY,
          hit: true,
        };
      }
    }
    return { dist: Infinity, side: 0, cell: 0, wallX: 0, mapX: -1, mapY: -1, hit: false };
  }

  // ---- Движение с коллизиями и скольжением ----------------------------------
  //
  // Оси решаются независимо: упор в стену по X не отменяет движение по Y и
  // наоборот — это и есть скольжение вдоль стены. Игрок — окружность радиуса
  // radius; проверяем четыре угла его AABB, чтобы он не «въезжал» в угол клетки.

  function circleBlocked(maze, x, y, r) {
    return isWall(maze, x - r, y - r) || isWall(maze, x + r, y - r) ||
           isWall(maze, x - r, y + r) || isWall(maze, x + r, y + r);
  }

  function moveWithCollision(maze, x, y, dx, dy, radius) {
    var r = radius == null ? 0.2 : radius;
    var nx = x, ny = y;
    // По X: двигаемся, только если новая X-позиция (при текущей Y) свободна.
    if (!circleBlocked(maze, x + dx, y, r)) nx = x + dx;
    // По Y: при уже принятой nx, чтобы скольжение в углу было корректным.
    if (!circleBlocked(maze, nx, y + dy, r)) ny = y + dy;
    return { x: nx, y: ny };
  }

  // ---- Связность (для тестов) ----------------------------------------------
  //
  // BFS из первой свободной клетки достигает всех проходимых клеток?
  function isConnected(maze) {
    var total = 0, start = -1;
    for (var i = 0; i < maze.cells.length; i++) {
      if (maze.cells[i] === 0) { total++; if (start < 0) start = i; }
    }
    if (start < 0) return true; // нет проходов — тривиально

    var seen = new Uint8Array(maze.cells.length);
    var queue = [start];
    seen[start] = 1;
    var visited = 0;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (queue.length) {
      var c = queue.pop();
      visited++;
      var cx = c % maze.w, cy = (c - cx) / maze.w;
      for (var d = 0; d < 4; d++) {
        var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
        if (!inBounds(maze, nx, ny)) continue;
        var ni = ny * maze.w + nx;
        if (seen[ni] || maze.cells[ni] !== 0) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    return visited === total;
  }

  var API = {
    generateMaze: generateMaze,
    cellAt: cellAt,
    isWall: isWall,
    findOpenCell: findOpenCell,
    castRay: castRay,
    moveWithCollision: moveWithCollision,
    isConnected: isConnected,
  };

  // Dual-mode: node — экспорт; браузер (<script>) — глобал window.Raycast.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.Raycast = API;
  }
})(typeof window !== 'undefined' ? window : globalThis);
