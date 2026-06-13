'use strict';
// Запуск: node demos/raycaster-maze/opus-4.8/raycast.test.js
const assert = require('node:assert');
const R = require('./raycast.js');

// Детерминированный ГПСЧ (LCG, glibc-константы) — стабильные сиды для тестов.
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// Тестовая «комната» 5x5: периметр — стены, внутри пусто.
function room() {
  const w = 5, h = 5;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) cells[y * w + x] = 1;
  }
  return { w, h, cells };
}

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); passed++; }

// === A. Генерация: лабиринт связный (BFS достигает всех проходимых клеток) ===
{
  for (const seed of [1, 2, 7, 42, 1337, 99999]) {
    const maze = R.generateMaze(25, 19, lcg(seed));
    ok(R.isConnected(maze), `seed=${seed}: лабиринт несвязный`);
  }
  // С braid-петлями связность тоже обязана сохраняться.
  for (const seed of [3, 11, 77]) {
    const maze = R.generateMaze(25, 19, lcg(seed), { braid: 0.5 });
    ok(R.isConnected(maze), `seed=${seed} (braid): лабиринт несвязный`);
  }
}

// === A2. Размеры нечётные, рамка сплошная, проходов достаточно ===============
{
  const maze = R.generateMaze(20, 14, lcg(5)); // чётные → должны вырасти до нечётных
  eq(maze.w % 2, 1, 'ширина должна быть нечётной');
  eq(maze.h % 2, 1, 'высота должна быть нечётной');
  for (let x = 0; x < maze.w; x++) {
    ok(maze.cells[x] > 0, `дыра в верхней рамке x=${x}`);
    ok(maze.cells[(maze.h - 1) * maze.w + x] > 0, `дыра в нижней рамке x=${x}`);
  }
  for (let y = 0; y < maze.h; y++) {
    ok(maze.cells[y * maze.w] > 0, `дыра в левой рамке y=${y}`);
    ok(maze.cells[y * maze.w + maze.w - 1] > 0, `дыра в правой рамке y=${y}`);
  }
  let open = 0;
  for (const v of maze.cells) if (v === 0) open++;
  ok(open > maze.w * maze.h * 0.2, `слишком мало проходов: ${open}`);
}

// === B. DDA: расстояние и сторона из известной точки/сетки ===================
{
  // Луч строго вправо из центра (2.5,2.5) → стена x=4, перп.-дист 1.5, side=0.
  const hX = R.castRay(room(), 2.5, 2.5, 1, 0);
  eq(hX.mapX, 4, 'луч вправо: mapX');
  eq(hX.side, 0, 'луч вправо: вертикальная грань (side=0)');
  ok(Math.abs(hX.dist - 1.5) < 1e-12, `луч вправо: dist=${hX.dist}, ждали 1.5`);

  // Луч строго вниз → стена y=4, перп.-дист 1.5, side=1.
  const hY = R.castRay(room(), 2.5, 2.5, 0, 1);
  eq(hY.mapY, 4, 'луч вниз: mapY');
  eq(hY.side, 1, 'луч вниз: горизонтальная грань (side=1)');
  ok(Math.abs(hY.dist - 1.5) < 1e-12, `луч вниз: dist=${hY.dist}, ждали 1.5`);

  // Луч влево → стена x=0, дист = 2.5 (от 2.5 до грани x=1).
  const hL = R.castRay(room(), 2.5, 2.5, -1, 0);
  eq(hL.mapX, 0, 'луч влево: mapX');
  eq(hL.side, 0, 'луч влево: side=0');
  ok(Math.abs(hL.dist - 1.5) < 1e-12, `луч влево: dist=${hL.dist}, ждали 1.5`);

  // Из несимметричной точки: вправо из (1.25, 2.5) → стена x=4, дист 2.75.
  const hA = R.castRay(room(), 1.25, 2.5, 1, 0);
  eq(hA.mapX, 4, 'несимм. луч: mapX');
  ok(Math.abs(hA.dist - 2.75) < 1e-12, `несимм. луч: dist=${hA.dist}, ждали 2.75`);
}

// === B2. wallX — точка попадания вдоль грани ================================
{
  // Луч вправо из (2.5, 2.25): в грань x=4 попадает на y≈2.25 → wallX=0.25.
  const h = R.castRay(room(), 2.5, 2.25, 1, 0);
  ok(Math.abs(h.wallX - 0.25) < 1e-12, `wallX=${h.wallX}, ждали 0.25`);
}

// === C. Перп.-расстояние убирает «рыбий глаз» ===============================
//
// Плоская стена перед камерой. Веер лучей через плоскость камеры. Все лучи,
// попавшие в эту стену, должны дать ОДИНАКОВОЕ перп.-расстояние (1.5) — иначе
// был бы «рыбий глаз» (по краям расстояние росло бы, стена «выгибалась» бы).
{
  const maze = room();
  const posX = 2.5, posY = 2.5;
  const dirX = 0, dirY = 1;          // взгляд вниз, на стену y=4
  const planeX = 0.66, planeY = 0;   // плоскость камеры перпендикулярна взгляду
  const dists = [];
  for (let col = 0; col <= 40; col++) {
    const cameraX = 2 * col / 40 - 1;  // [-1, 1]
    const h = R.castRay(maze, posX, posY,
      dirX + planeX * cameraX, dirY + planeY * cameraX);
    if (h.mapY === 4) dists.push(h.dist);
  }
  ok(dists.length >= 25, `мало лучей попало в стену: ${dists.length}`);
  for (const d of dists) {
    ok(Math.abs(d - 1.5) < 1e-12, `рыбий глаз: перп.-дист ${d} != 1.5`);
  }
  // Контроль: евклидова длина по краям БЫЛА БЫ больше — подтверждает, что
  // ровный perpDist получен именно проекцией, а не случайно.
  const edge = R.castRay(maze, posX, posY, planeX, dirY); // cameraX=1
  const euclid = Math.hypot(planeX, dirY) * edge.dist; // длина луча по гипотенузе
  ok(euclid > 1.5 + 1e-6, `евклидова длина ${euclid} должна быть > 1.5`);
}

// === D. Коллизии со скольжением — сквозь стену не проходим ===================
{
  const maze = room();
  const r = 0.2;

  // Прямо в стену x=4 из (3.6,2.5) на dx=+0.6: X упирается (центр <= 3.8).
  const m1 = R.moveWithCollision(maze, 3.6, 2.5, 0.6, 0, r);
  ok(m1.x <= 3.8 + 1e-9, `прошёл сквозь стену по X: x=${m1.x}`);
  ok(Math.abs(m1.x - 3.6) < 1e-12, `X не должен был сдвинуться: x=${m1.x}`);

  // Диагональ в угол: dx упирается в стену x=4, dy свободно → скольжение по Y.
  const m2 = R.moveWithCollision(maze, 3.6, 2.5, 0.6, -0.3, r);
  ok(Math.abs(m2.x - 3.6) < 1e-12, `X должен упереться: x=${m2.x}`);
  ok(Math.abs(m2.y - 2.2) < 1e-12, `скольжение по Y не сработало: y=${m2.y}`);

  // Свободное движение в открытом пространстве проходит целиком.
  const m3 = R.moveWithCollision(maze, 2.5, 2.5, 0.1, 0.05, r);
  ok(Math.abs(m3.x - 2.6) < 1e-12 && Math.abs(m3.y - 2.55) < 1e-12,
    `свободное движение искажено: ${JSON.stringify(m3)}`);

  // Радиус не даёт «въехать» углом в стену: подход к y=4 ограничен y<=3.8.
  const m4 = R.moveWithCollision(maze, 2.5, 3.6, 0, 0.6, r);
  ok(m4.y <= 3.8 + 1e-9, `угол въехал в стену по Y: y=${m4.y}`);
}

// === E. На сгенерированном лабиринте: игрок стартует НЕ в стене ==============
{
  const maze = R.generateMaze(25, 19, lcg(2024));
  const start = R.findOpenCell(maze, 1.5, 1.5);
  ok(!R.isWall(maze, start.x, start.y), `старт в стене: ${JSON.stringify(start)}`);
  // Луч в любую сторону из старта рано или поздно встречает стену (карта замкнута).
  const h = R.castRay(maze, start.x, start.y, 1, 0.0001);
  ok(h.hit, 'луч из старта обязан встретить стену в замкнутой карте');
  ok(h.dist > 0 && h.dist < Infinity, `аномальная дистанция: ${h.dist}`);
}

console.log(`raycast.test.js: все ${passed} проверок пройдены.`);
