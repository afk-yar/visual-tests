'use strict';
// Дуал-mode модуль: генерация связного лабиринта (DFS backtracker) + DDA-рейкастинг.
// В браузере кладёт API в window.Maze, в node экспортирует через module.exports.
(function () {
  // Детерминированный PRNG (mulberry32) — нужен для воспроизводимых тестов.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Генерация лабиринта DFS backtracker'ом на решётке cols x rows логических
  // клеток. Возвращает "толстую" карту grid[width*height] (1 = стена, 0 = пол),
  // где width = cols*2+1, height = rows*2+1: между соседними клетками-комнатами
  // (нечётные координаты) есть отдельная клетка-стена/проём (чётная координата).
  // Такое представление удобно для DDA-рейкастинга по целочисленной сетке.
  function generateMaze(cols, rows, rng) {
    rng = rng || Math.random;
    const width = cols * 2 + 1;
    const height = rows * 2 + 1;
    const grid = new Uint8Array(width * height).fill(1);

    const visited = new Uint8Array(cols * rows);
    const cellIndex = (cx, cy) => cy * cols + cx;
    const carveRoom = (cx, cy) => {
      grid[(cy * 2 + 1) * width + (cx * 2 + 1)] = 0;
    };

    carveRoom(0, 0);
    visited[cellIndex(0, 0)] = 1;
    const stack = [[0, 0]];

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];

      // Перемешиваем порядок соседей (Fisher-Yates) детерминированным rng.
      const order = dirs.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
      }

      let moved = false;
      for (let k = 0; k < order.length; k++) {
        const dx = order[k][0];
        const dy = order[k][1];
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (visited[cellIndex(nx, ny)]) continue;

        // Прорубаем стену между (cx,cy) и (nx,ny).
        const wx = cx * 2 + 1 + dx;
        const wy = cy * 2 + 1 + dy;
        grid[wy * width + wx] = 0;
        carveRoom(nx, ny);
        visited[cellIndex(nx, ny)] = 1;
        stack.push([nx, ny]);
        moved = true;
        break;
      }

      if (!moved) stack.pop();
    }

    return { grid, width, height };
  }

  // Стена ли клетка (cx,cy)? За пределами карты — всегда стена.
  function isWallCell(grid, width, height, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) return true;
    return grid[cy * width + cx] === 1;
  }

  // Заливка (flood fill) 4-связностью от клетки (startX,startY) в координатах
  // сетки. Используется тестом связности: количество достижимых "полов" должно
  // совпасть с общим количеством "полов" на карте.
  function floodFill(grid, width, height, startX, startY) {
    const visited = new Uint8Array(width * height);
    if (isWallCell(grid, width, height, startX, startY)) {
      return { count: 0, visited };
    }
    const stack = [[startX, startY]];
    visited[startY * width + startX] = 1;
    let count = 0;
    while (stack.length) {
      const p = stack.pop();
      const x = p[0];
      const y = p[1];
      count++;
      const neighbors = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (let i = 0; i < neighbors.length; i++) {
        const nx = neighbors[i][0];
        const ny = neighbors[i][1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const idx = ny * width + nx;
        if (visited[idx]) continue;
        if (grid[idx] === 1) continue;
        visited[idx] = 1;
        stack.push([nx, ny]);
      }
    }
    return { count, visited };
  }

  // DDA-рейкастинг (алгоритм Lodev/Wolfenstein): бросает луч из точки
  // (posX,posY) в направлении (dirX,dirY) по целочисленной сетке grid и
  // возвращает перпендикулярное (не эвклидово!) расстояние до первой стены —
  // именно перпендикулярное расстояние устраняет эффект "рыбьего глаза".
  // Возвращает null, если стена не найдена за maxSteps шагов.
  function castRay(grid, width, height, posX, posY, dirX, dirY, maxSteps) {
    maxSteps = maxSteps || (width + height) * 2;

    let mapX = Math.floor(posX);
    let mapY = Math.floor(posY);

    const deltaDistX = dirX === 0 ? Infinity : Math.abs(1 / dirX);
    const deltaDistY = dirY === 0 ? Infinity : Math.abs(1 / dirY);

    let stepX, stepY, sideDistX, sideDistY;
    if (dirX < 0) {
      stepX = -1;
      sideDistX = (posX - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1 - posX) * deltaDistX;
    }
    if (dirY < 0) {
      stepY = -1;
      sideDistY = (posY - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1 - posY) * deltaDistY;
    }

    let side = 0;
    let hit = false;
    for (let i = 0; i < maxSteps; i++) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }
      if (isWallCell(grid, width, height, mapX, mapY)) {
        hit = true;
        break;
      }
    }
    if (!hit) return null;

    const perpDist =
      side === 0
        ? (mapX - posX + (1 - stepX) / 2) / dirX
        : (mapY - posY + (1 - stepY) / 2) / dirY;

    return { dist: Math.abs(perpDist), side, mapX, mapY };
  }

  const api = { mulberry32, generateMaze, isWallCell, floodFill, castRay };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.Maze = api;
  }
})();
