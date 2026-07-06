'use strict';

const assert = require('node:assert');
const A = require('./automaton.js');

function makeGrid(width, height, fill) {
  const g = A.createGrid(width, height);
  if (fill) {
    for (const [x, y, type] of fill) {
      g.cell[A.indexOf(width, x, y)] = type;
    }
  }
  return g;
}

function typeAt(grid, width, x, y) {
  return grid.cell[A.indexOf(width, x, y)];
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

// 1. Базовое правило: песок над пустой клеткой падает вниз за один шаг.
test('sand falls into empty cell below in one tick', () => {
  const w = 3, h = 3;
  const g = makeGrid(w, h, [[1, 0, A.SAND]]);
  const next = A.step(g, { rand: () => 0.5, frame: 0 });
  assert.strictEqual(typeAt(next, w, 1, 0), A.EMPTY, 'исходная клетка должна опустеть');
  assert.strictEqual(typeAt(next, w, 1, 1), A.SAND, 'песок должен оказаться этажом ниже');
});

// 2. Песок тонет в воде — меняется местами с водой прямо под собой,
// перемещение на одну клетку за тик (без телепортации). Воду обкладываем
// камнем со всех сторон, кроме верха, — иначе она сама утечёт по диагонали
// или вбок раньше, чем сверху подоспеет песок (это отдельное, тоже честное
// поведение правила растекания, но не то, что проверяет этот тест).
test('sand sinks through water directly below (single-cell swap)', () => {
  const w = 3, h = 3;
  const g = makeGrid(w, h, [
    [1, 0, A.SAND],
    [1, 1, A.WATER],
    [0, 1, A.STONE], [2, 1, A.STONE],
    [0, 2, A.STONE], [1, 2, A.STONE], [2, 2, A.STONE]
  ]);
  const next = A.step(g, { rand: () => 0.5, frame: 0 });
  assert.strictEqual(typeAt(next, w, 1, 0), A.WATER, 'вода поднимается на место песка');
  assert.strictEqual(typeAt(next, w, 1, 1), A.SAND, 'песок опускается на место воды');
});

// 3. Тай-брейк decideSandMove решает переданный rand(), а не жёстко
// закодированное предпочтение одной из сторон.
test('decideSandMove tie-break is driven by rand(), not a hardcoded direction', () => {
  const left = A.decideSandMove(A.STONE, A.EMPTY, A.EMPTY, () => 0.1);
  const right = A.decideSandMove(A.STONE, A.EMPTY, A.EMPTY, () => 0.9);
  assert.deepStrictEqual(left, { dx: -1, dy: 1, swapWith: A.EMPTY });
  assert.deepStrictEqual(right, { dx: 1, dy: 1, swapWith: A.EMPTY });
});

// 4. Честность симметрии (пример из спецификации задачи): конфликт двух
// РАЗНЫХ источников за одну и ту же целевую клетку решается очерёдностью
// обхода (чередуется по чётности frame), а не постоянным приоритетом левой
// или правой стороны.
test('scan-direction alternation prevents a constant left/right winner on contention', () => {
  const w = 3, h = 3;
  const build = () => makeGrid(w, h, [
    [0, 0, A.SAND], [2, 0, A.SAND],
    [0, 1, A.STONE], [2, 1, A.STONE]
    // (1,1) остаётся EMPTY — единственная свободная клетка, на которую
    // претендуют обе песчинки по диагонали.
  ]);

  const evenFrame = A.step(build(), { rand: () => 0.5, frame: 0 }); // обход слева направо
  const oddFrame = A.step(build(), { rand: () => 0.5, frame: 1 }); // обход справа налево

  // Чётный кадр: первым по ходу обхода оказывается левый источник — и
  // именно он занимает спорную клетку.
  assert.strictEqual(typeAt(evenFrame, w, 0, 0), A.EMPTY);
  assert.strictEqual(typeAt(evenFrame, w, 2, 0), A.SAND);
  assert.strictEqual(typeAt(evenFrame, w, 1, 1), A.SAND);

  // Нечётный кадр: обход идёт справа налево — побеждает правый источник.
  assert.strictEqual(typeAt(oddFrame, w, 2, 0), A.EMPTY);
  assert.strictEqual(typeAt(oddFrame, w, 0, 0), A.SAND);
  assert.strictEqual(typeAt(oddFrame, w, 1, 1), A.SAND);

  // Итог: победитель спора зависит от порядка обхода, а не от того, что
  // источник расположен слева или справа — постоянного смещения нет.
});

// 5. Зеркально симметричная раскладка при зеркальной склонности rand даёт
// зеркальный результат — прямая проверка отсутствия скрытой асимметрии в
// правиле растекания воды.
test('mirrored symmetric setup with mirrored rand bias produces a mirrored result', () => {
  const w = 5, h = 3;
  const layout = [
    [2, 0, A.WATER],
    [0, 1, A.STONE], [1, 1, A.STONE], [2, 1, A.STONE], [3, 1, A.STONE], [4, 1, A.STONE]
  ];
  // rand() < 0.5 => decideWaterMove выбирает «левую» из двух равнозначных опций.
  const next = A.step(makeGrid(w, h, layout), { rand: () => 0.1, frame: 0 });
  // rand() >= 0.5 => симметрично выбирается «правая» опция.
  const nextMirroredRand = A.step(makeGrid(w, h, layout), { rand: () => 0.9, frame: 0 });

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const a = typeAt(next, w, x, y);
      const b = typeAt(nextMirroredRand, w, w - 1 - x, y);
      assert.strictEqual(a, b, `клетка (${x},${y}) не совпадает с зеркальной (${w - 1 - x},${y})`);
    }
  }
});

// 6. Камень неподвижен независимо от соседей.
test('stone never moves', () => {
  const w = 3, h = 3;
  const g = makeGrid(w, h, [[1, 1, A.STONE]]);
  const next = A.step(g, { rand: () => 0.5, frame: 0 });
  assert.strictEqual(typeAt(next, w, 1, 1), A.STONE);
});

// 7. Огонь поджигает соседнее дерево.
test('fire ignites adjacent wood', () => {
  const w = 3, h = 3;
  const g = makeGrid(w, h, [[1, 1, A.WOOD], [1, 0, A.FIRE]]);
  g.life[A.indexOf(w, 1, 0)] = A.FIRE_LIFE;
  const next = A.step(g, { rand: () => 0, frame: 0 }); // rand=0 всегда проходит проверку шанса
  assert.strictEqual(typeAt(next, w, 1, 1), A.FIRE, 'дерево рядом с огнём должно воспламениться');
});

// 8. Огонь, у которого истёк срок жизни, гаснет дымом.
test('fire turns into smoke once its life runs out', () => {
  const w = 3, h = 3;
  const g = makeGrid(w, h, [[1, 1, A.FIRE]]);
  g.life[A.indexOf(w, 1, 1)] = 1;
  const next = A.step(g, { rand: () => 0.99, frame: 0 });
  assert.strictEqual(typeAt(next, w, 1, 1), A.SMOKE);
});

// 9. Дым поднимается вверх, а по истечении жизни тает (клетка становится пустой).
test('smoke rises and eventually dissipates', () => {
  const w = 3, h = 3;
  const g = makeGrid(w, h, [[1, 1, A.SMOKE]]);
  g.life[A.indexOf(w, 1, 1)] = A.SMOKE_LIFE;
  const risen = A.step(g, { rand: () => 0.5, frame: 0 });
  assert.strictEqual(typeAt(risen, w, 1, 0), A.SMOKE, 'дым должен подняться на клетку выше');
  assert.strictEqual(typeAt(risen, w, 1, 1), A.EMPTY);

  const g2 = makeGrid(w, h, [[1, 1, A.SMOKE]]);
  g2.life[A.indexOf(w, 1, 1)] = 1;
  const faded = A.step(g2, { rand: () => 0.5, frame: 0 });
  assert.strictEqual(typeAt(faded, w, 1, 0), A.EMPTY);
  assert.strictEqual(typeAt(faded, w, 1, 1), A.EMPTY);
});

console.log(`\n${passed} test(s) passed`);
