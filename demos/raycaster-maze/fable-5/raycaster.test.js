'use strict';
// node demos/raycaster-maze/fable-5/raycaster.test.js
const assert = require('node:assert');
const R = require('./raycaster.js');

function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// Комната 5x5: периметр — стены, внутри пусто.
function room() {
  const w = 5, h = 5;
  const map = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) map[y * w + x] = 1;
  }
  return { map, w, h };
}

// 1. Луч вправо из центра комнаты попадает в стену x=4 на дистанции 1.5.
{
  const hit = R.castRay(room(), 2.5, 2.5, 1, 0);
  assert.strictEqual(hit.mapX, 4);
  assert.strictEqual(hit.side, 0, 'вертикальная грань');
  assert.ok(Math.abs(hit.dist - 1.5) < 1e-9, `дистанция: ${hit.dist}`);
}

// 2. Луч вниз — горизонтальная грань, дистанция 1.5.
{
  const hit = R.castRay(room(), 2.5, 2.5, 0, 1);
  assert.strictEqual(hit.mapY, 4);
  assert.strictEqual(hit.side, 1);
  assert.ok(Math.abs(hit.dist - 1.5) < 1e-9, `дистанция: ${hit.dist}`);
}

// 3. Нет «рыбьего глаза»: плоская стена перед камерой даёт одинаковую
// перпендикулярную дистанцию по всем столбцам экрана.
{
  const maze = room();
  const posX = 2.5, posY = 2.5;
  const dirX = 0, dirY = 1;       // смотрим на стену y=4
  const planeX = 0.66, planeY = 0;
  const dists = [];
  for (let col = 0; col <= 20; col++) {
    const cameraX = (col / 10) - 1; // [-1, 1]
    const hit = R.castRay(maze, posX, posY, dirX + planeX * cameraX, dirY + planeY * cameraX);
    if (hit.mapY === 4) dists.push(hit.dist); // столбцы, попавшие в эту стену
  }
  assert.ok(dists.length >= 15, 'мало лучей попало в стену');
  for (const d of dists) {
    assert.ok(Math.abs(d - 1.5) < 1e-9, `fisheye: перпендикулярная дистанция ${d} != 1.5`);
  }
}

// 4. wallX: луч вправо чуть ниже центра клетки попадает в нужную точку стены.
{
  const hit = R.castRay(room(), 2.5, 2.25, 1, 0);
  assert.ok(Math.abs(hit.wallX - 0.25) < 1e-9, `wallX: ${hit.wallX}`);
}

// 5. Лабиринт: связный, периметр — стены, проходы существуют.
{
  for (const seed of [1, 7, 42]) {
    const maze = R.generateMaze(21, 15, lcg(seed));
    assert.ok(R.isFullyConnected(maze), `лабиринт seed=${seed} несвязный`);
    for (let x = 0; x < maze.w; x++) {
      assert.ok(maze.map[x] > 0 && maze.map[(maze.h - 1) * maze.w + x] > 0, 'дыра в периметре');
    }
    let open = 0;
    for (const v of maze.map) if (v === 0) open++;
    assert.ok(open > maze.w * maze.h * 0.2, 'слишком мало проходов');
  }
}

// 6. Коллизии: сквозь стену не пройти, вдоль стены — скольжение.
{
  const maze = room();
  // Движение вправо в стену x=4 из (3.7, 2.5): упор (радиус 0.2 => x <= 3.8).
  const m1 = R.tryMove(maze, 3.7, 2.5, 3.95, 2.5, 0.2);
  assert.ok(m1.x <= 3.8 + 1e-9, `прошёл сквозь стену: ${m1.x}`);
  // Диагональ в угол: y-компонента проходит, x упирается.
  const m2 = R.tryMove(maze, 3.7, 2.5, 3.95, 2.2, 0.2);
  assert.strictEqual(m2.x, 3.7, 'x должен упереться');
  assert.ok(Math.abs(m2.y - 2.2) < 1e-9, `скольжение по y не сработало: ${m2.y}`);
}

console.log('raycaster.test.js: все тесты пройдены');
