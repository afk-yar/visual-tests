'use strict';
// node demos/falling-sand/fable-5/sand.test.js
const assert = require('node:assert');
const S = require('./sand.js');

function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function run(g, steps, rng) {
  const moved = new Uint8Array(g.w * g.h);
  for (let i = 0; i < steps; i++) S.step(g, rng, moved, i % 2 === 1);
}

// 1. Песчинка падает ровно на одну клетку за шаг.
{
  const g = S.makeGrid(9, 9);
  S.set(g, 4, 0, S.SAND);
  const moved = new Uint8Array(81);
  S.step(g, lcg(1), moved, false);
  assert.strictEqual(S.get(g, 4, 0), S.EMPTY);
  assert.strictEqual(S.get(g, 4, 1), S.SAND);
  S.step(g, lcg(1), moved, true);
  assert.strictEqual(S.get(g, 4, 2), S.SAND, 'второй шаг — ещё на клетку ниже');
}

// 2. Песок на дне неподвижен; на песчаном столбике соскальзывает вбок.
{
  const g = S.makeGrid(9, 9);
  S.set(g, 4, 8, S.SAND);   // на дне
  S.set(g, 4, 7, S.SAND);
  S.set(g, 4, 6, S.SAND);   // столбик из трёх
  run(g, 30, lcg(2));
  assert.strictEqual(S.count(g, S.SAND), 3, 'песок исчез или размножился');
  // Столбик высоты 3 рассыпается: максимум 2 этажа при основании 2+.
  let maxH = 0;
  for (let x = 0; x < 9; x++) {
    let hCol = 0;
    for (let y = 0; y < 9; y++) if (S.get(g, x, y) === S.SAND) hCol++;
    maxH = Math.max(maxH, hCol);
  }
  assert.ok(maxH <= 2, `столбик не рассыпался: высота ${maxH}`);
}

// 3. Вода растекается по дну в обе стороны.
{
  const g = S.makeGrid(21, 6);
  for (let i = 0; i < 5; i++) S.set(g, 10, i, S.WATER); // столб воды в центре
  run(g, 120, lcg(3));
  assert.strictEqual(S.count(g, S.WATER), 5, 'вода исчезла или размножилась');
  let minX = 99, maxX = -1;
  for (let x = 0; x < 21; x++) {
    if (S.get(g, x, 5) === S.WATER) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  }
  assert.ok(maxX - minX >= 3, `вода не растеклась: [${minX}, ${maxX}]`);
  assert.ok(minX < 10 && maxX > 10, 'растеклась только в одну сторону');
}

// 4. Песок тонет в воде (плотнее).
{
  const g = S.makeGrid(5, 8);
  S.set(g, 2, 7, S.WATER);
  S.set(g, 2, 6, S.WATER);
  S.set(g, 2, 2, S.SAND);
  run(g, 40, lcg(4));
  // Песок должен оказаться ниже обеих клеток воды.
  let sandY = -1;
  const waterYs = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) {
    if (S.get(g, x, y) === S.SAND) sandY = y;
    if (S.get(g, x, y) === S.WATER) waterYs.push(y);
  }
  assert.strictEqual(sandY, 7, `песок не утонул: y=${sandY}`);
  assert.ok(waterYs.every((y) => y < 7) === false || sandY === 7, 'вода под песком');
}

// 5. Камень неподвижен, вода стоит на камне.
{
  const g = S.makeGrid(7, 7);
  S.set(g, 3, 4, S.STONE);
  S.set(g, 3, 2, S.WATER);
  run(g, 10, lcg(5));
  assert.strictEqual(S.get(g, 3, 4), S.STONE, 'камень сместился');
  assert.strictEqual(S.count(g, S.WATER), 1, 'вода исчезла');
}

// 6. Огонь поджигает дерево и со временем гаснет в дым/пустоту.
{
  const g = S.makeGrid(7, 7);
  for (let x = 1; x <= 5; x++) S.set(g, x, 5, S.WOOD);
  S.set(g, 3, 4, S.FIRE);
  run(g, 400, lcg(6));
  assert.strictEqual(S.count(g, S.WOOD), 0, 'дерево не сгорело');
  assert.strictEqual(S.count(g, S.FIRE), 0, 'огонь не погас за 400 шагов');
}

// 7. Дым поднимается и растворяется.
{
  const g = S.makeGrid(7, 12);
  S.set(g, 3, 10, S.SMOKE);
  const moved = new Uint8Array(7 * 12);
  const rng = lcg(7);
  S.step(g, rng, moved, false);
  let smokeY = -1;
  for (let y = 0; y < 12; y++) for (let x = 0; x < 7; x++) {
    if (S.get(g, x, y) === S.SMOKE) smokeY = y;
  }
  assert.ok(smokeY === -1 || smokeY <= 10, 'дым опустился');
  run(g, 500, rng);
  assert.strictEqual(S.count(g, S.SMOKE), 0, 'дым не растворился');
}

// 8. Сохранение песка: 60 песчинок в закрытом сосуде после 300 шагов.
{
  const g = S.makeGrid(20, 20);
  const rng = lcg(8);
  let placed = 0;
  while (placed < 60) {
    const x = Math.floor(rng() * 20), y = Math.floor(rng() * 10);
    if (S.get(g, x, y) === S.EMPTY) { S.set(g, x, y, S.SAND); placed++; }
  }
  run(g, 300, rng);
  assert.strictEqual(S.count(g, S.SAND), 60, 'песок не сохранился');
}

console.log('sand.test.js: все тесты пройдены');
