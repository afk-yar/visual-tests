'use strict';
const assert = require('assert');
const { mulberry32, generateMaze, floodFill, castRay } = require('./maze.js');

// --- Тест 1: связность сгенерированного лабиринта -------------------------
// Для нескольких сидов и размеров: flood-fill из стартовой клетки должен
// достичь ВСЕХ клеток-полов на карте (DFS backtracker строит остовное
// дерево по построению, поэтому лабиринт обязан быть полностью связным).
for (const seed of [1, 42, 12345, 999]) {
  for (const [cols, rows] of [
    [3, 3],
    [5, 5],
    [8, 6],
    [14, 10],
  ]) {
    const rng = mulberry32(seed);
    const { grid, width, height } = generateMaze(cols, rows, rng);

    let totalFloor = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === 0) totalFloor++;
    }

    const { count } = floodFill(grid, width, height, 1, 1);
    assert.strictEqual(
      count,
      totalFloor,
      `лабиринт не полностью связный: seed=${seed}, size=${cols}x${rows}, ` +
        `достижимо ${count} из ${totalFloor} клеток-полов`
    );
  }
}
console.log('OK: generateMaze создаёт полностью связный лабиринт для всех проверенных сидов/размеров');

// --- Тест 2: DDA вдоль +X (ручной пример) ----------------------------------
// Карта 5x5: рамка — стены, во внутренней строке y=2 открыты столбцы x=1..3.
// Игрок в центре коридора (1.5, 2.5), смотрит вдоль +X. Луч обязан упереться
// в столб-рамку на mapX=4 (side=0, X-стена), перпендикулярное расстояние
// 4 - 1.5 = 2.5.
{
  const width = 5;
  const height = 5;
  const grid = new Uint8Array(width * height).fill(1);
  for (let x = 1; x <= 3; x++) grid[2 * width + x] = 0;

  const hit = castRay(grid, width, height, 1.5, 2.5, 1, 0);
  assert.ok(hit, 'ожидалось попадание луча в стену');
  assert.strictEqual(hit.mapX, 4, 'ожидалась стена в столбце 4 (рамка)');
  assert.strictEqual(hit.mapY, 2);
  assert.strictEqual(hit.side, 0, 'луч вдоль X должен попасть в X-стену (side=0)');
  assert.ok(Math.abs(hit.dist - 2.5) < 1e-9, `ожидалось расстояние 2.5, получено ${hit.dist}`);
}
console.log('OK: castRay вдоль +X совпадает с ручным расчётом (dist=2.5, side=0)');

// --- Тест 3: DDA вдоль -X (ручной пример, обратное направление) ------------
// Та же карта. Игрок там же (1.5, 2.5), смотрит вдоль -X. Ближняя грань
// стены-рамки на mapX=0 находится в x=1, значит расстояние 1.5 - 1 = 0.5.
{
  const width = 5;
  const height = 5;
  const grid = new Uint8Array(width * height).fill(1);
  for (let x = 1; x <= 3; x++) grid[2 * width + x] = 0;

  const hit = castRay(grid, width, height, 1.5, 2.5, -1, 0);
  assert.ok(hit, 'ожидалось попадание луча в стену');
  assert.strictEqual(hit.mapX, 0, 'ожидалась стена в столбце 0 (рамка)');
  assert.strictEqual(hit.side, 0);
  assert.ok(Math.abs(hit.dist - 0.5) < 1e-9, `ожидалось расстояние 0.5, получено ${hit.dist}`);
}
console.log('OK: castRay вдоль -X совпадает с ручным расчётом (dist=0.5, side=0)');

// --- Тест 4: DDA вдоль +Y (ручной пример, проверка side=1) ------------------
// Карта 5x5: рамка — стены, открыт столбец x=2 для y=1..3. Игрок в центре
// коридора (2.5, 1.5), смотрит вдоль +Y. Луч обязан упереться в рамку на
// mapY=4 (side=1, Y-стена), расстояние 4 - 1.5 = 2.5.
{
  const width = 5;
  const height = 5;
  const grid = new Uint8Array(width * height).fill(1);
  for (let y = 1; y <= 3; y++) grid[y * width + 2] = 0;

  const hit = castRay(grid, width, height, 2.5, 1.5, 0, 1);
  assert.ok(hit, 'ожидалось попадание луча в стену');
  assert.strictEqual(hit.mapY, 4, 'ожидалась стена в строке 4 (рамка)');
  assert.strictEqual(hit.side, 1, 'луч вдоль Y должен попасть в Y-стену (side=1)');
  assert.ok(Math.abs(hit.dist - 2.5) < 1e-9, `ожидалось расстояние 2.5, получено ${hit.dist}`);
}
console.log('OK: castRay вдоль +Y совпадает с ручным расчётом (dist=2.5, side=1)');

console.log('Все тесты maze.js пройдены.');
