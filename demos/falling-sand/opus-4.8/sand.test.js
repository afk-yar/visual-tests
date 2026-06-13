'use strict';
const assert = require('node:assert');
const S = require('./sand.js');
const { EMPTY, SAND, WATER, STONE, WOOD, FIRE, SMOKE } = S;

// Хелпер: построить сетку и проставить клетки из «карты» строк.
// Символы: '.'=пусто 's'=песок 'w'=вода '#'=камень 'T'=дерево 'f'=огонь 'o'=дым
function build(rows) {
  const h = rows.length, w = rows[0].length;
  const g = S.createGrid(w, h);
  const map = { '.': EMPTY, s: SAND, w: WATER, '#': STONE, T: WOOD, f: FIRE, o: SMOKE };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = map[rows[y][x]];
      S.setCell(g, x, y, v, v === FIRE ? 30 : v === SMOKE ? 80 : 0);
    }
  }
  return g;
}
function find(g, v) {
  const out = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (g.cells[S.idx(g, x, y)] === v) out.push({ x, y });
  }
  return out;
}
function count(g, v) { return find(g, v).length; }
// Фиксированный rng для воспроизводимости тестов.
const rng = S.makeRng(12345);

// A. Песок падает вниз в пустоту (без исчезновения — сохранение массы).
{
  const g = build([
    '.s.',
    '...',
    '...',
  ]);
  S.step(g, rng);
  assert.strictEqual(count(g, SAND), 1, 'песчинка не должна исчезнуть');
  assert.strictEqual(g.cells[S.idx(g, 1, 1)], SAND, 'песок должен опуститься на 1 клетку');
  assert.strictEqual(g.cells[S.idx(g, 1, 0)], EMPTY, 'верхняя клетка освободилась');
}

// B. Песок соскальзывает по диагонали на горке (под ним занято, сбоку-снизу пусто).
{
  const g = build([
    '.s.',
    '.#.',
    '...',
  ]);
  S.step(g, rng);
  assert.strictEqual(count(g, SAND), 1, 'песок не исчезает при соскальзывании');
  const p = find(g, SAND)[0];
  assert.strictEqual(p.y, 1, 'песок сместился на ряд ниже по диагонали');
  assert.ok(p.x === 0 || p.x === 2, `песок ушёл вбок-вниз, x=${p.x}`);
}

// C. Песок тонет в воде: меняется местами (вода всплывает наверх).
{
  const g = build([
    's',
    'w',
  ]);
  S.step(g, rng);
  assert.strictEqual(g.cells[S.idx(g, 0, 1)], SAND, 'песок опустился под воду');
  assert.strictEqual(g.cells[S.idx(g, 0, 0)], WATER, 'вода всплыла наверх (обмен, не исчезновение)');
  assert.strictEqual(count(g, SAND), 1);
  assert.strictEqual(count(g, WATER), 1);
}

// D. Камень неподвижен и непроницаем.
{
  const g = build([
    '#',
    '.',
  ]);
  S.step(g, rng);
  assert.strictEqual(g.cells[S.idx(g, 0, 0)], STONE, 'камень остался на месте');
  assert.strictEqual(g.cells[S.idx(g, 0, 1)], EMPTY);
}

// E. Огонь поджигает соседнее дерево.
{
  const g = build([
    'fT',
    '..',
  ]);
  // За несколько шагов дерево должно загореться (вероятностный фронт).
  let ignited = false;
  for (let i = 0; i < 40 && !ignited; i++) {
    S.step(g, rng);
    if (count(g, FIRE) >= 1 && g.cells[S.idx(g, 1, 0)] === FIRE) ignited = true;
  }
  assert.ok(ignited, 'дерево по соседству должно загореться от огня');
}

// F. Огонь со временем гаснет дымом.
{
  const g = build(['f']);
  let becameSmoke = false;
  for (let i = 0; i < 60 && !becameSmoke; i++) {
    S.step(g, rng);
    if (g.cells[S.idx(g, 0, 0)] === SMOKE || count(g, SMOKE) > 0) becameSmoke = true;
  }
  assert.ok(becameSmoke, 'огонь без топлива должен погаснуть, оставив дым');
}

// G. Дым поднимается вверх.
{
  const g = build([
    '.',
    '.',
    'o',
  ]);
  S.step(g, rng);
  const p = find(g, SMOKE)[0];
  assert.ok(p && p.y < 2, `дым должен подняться выше начального ряда, y=${p && p.y}`);
}

// H. Дым со временем тает (исчезает в пустоту).
{
  const g = build(['o']);
  // life дыма ограничен; за достаточно шагов он растворится.
  for (let i = 0; i < 200; i++) S.step(g, rng);
  assert.strictEqual(count(g, SMOKE), 0, 'дым должен полностью раствориться');
}

// I. Сохранение массы при простом падении в закрытом столбце.
{
  const g = build([
    's',
    's',
    '.',
    '.',
  ]);
  for (let i = 0; i < 10; i++) S.step(g, rng);
  assert.strictEqual(count(g, SAND), 2, 'число песчинок не меняется при падении');
  // Должны осесть на дно (две нижние клетки).
  assert.strictEqual(g.cells[S.idx(g, 0, 3)], SAND);
  assert.strictEqual(g.cells[S.idx(g, 0, 2)], SAND);
}

// J. Честность: нет систематического сноса в одну сторону.
// Роняем одну песчинку с вершины симметричной ямы много раз — суммарный
// дрейф влево/вправо должен быть близок к нулю (parity + rng чередование).
{
  let sumX = 0, trials = 200;
  for (let t = 0; t < trials; t++) {
    const g = S.createGrid(9, 9);
    // Плоское дно, песчинка ровно по центру над дном.
    for (let x = 0; x < 9; x++) S.setCell(g, x, 8, STONE, 0);
    S.setCell(g, 4, 0, SAND, 0);
    const r = S.makeRng(1000 + t); // разные сиды, но детерминированно
    for (let i = 0; i < 30; i++) S.step(g, r);
    const p = find(g, SAND)[0];
    sumX += (p.x - 4);
  }
  const meanDrift = sumX / trials;
  assert.ok(Math.abs(meanDrift) < 0.35, `средний дрейф вбок должен быть ~0, получено ${meanDrift}`);
  console.log(`средний боковой дрейф песчинки: ${meanDrift.toFixed(4)} (по ${trials} прогонам)`);
}

// K. Кисть рисует круг и не выходит за границы.
{
  const g = S.createGrid(10, 10);
  S.paint(g, 5, 5, 2, WOOD);
  assert.ok(count(g, WOOD) > 0, 'кисть должна что-то нарисовать');
  assert.strictEqual(g.cells[S.idx(g, 5, 5)], WOOD, 'центр кисти закрашен');
  // Угол круга радиуса 2 (dx=2,dy=2 -> 8 > 4) закрашиваться не должен.
  assert.strictEqual(g.cells[S.idx(g, 7, 7)], EMPTY, 'кисть круглая, а не квадратная');
}

// L. Очистка обнуляет всё поле.
{
  const g = build(['ss', 'ww']);
  S.clear(g);
  assert.strictEqual(count(g, EMPTY), 4, 'после очистки поле пустое');
}

console.log('Все тесты автомата пройдены.');
