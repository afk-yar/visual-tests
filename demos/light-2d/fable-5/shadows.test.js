'use strict';
// node demos/light-2d/fable-5/shadows.test.js
const assert = require('node:assert');
const Sh = require('./shadows.js');

// 1. Пересечение луч-отрезок: базовые случаи.
{
  // Луч вправо из (0,0), вертикальный отрезок x=5, y от -1 до 1.
  const t = Sh.raySegment(0, 0, 1, 0, 5, -1, 5, 1);
  assert.ok(Math.abs(t - 5) < 1e-9, `t=${t}`);
  // Отрезок позади луча.
  assert.strictEqual(Sh.raySegment(0, 0, 1, 0, -5, -1, -5, 1), Infinity);
  // Луч мимо отрезка.
  assert.strictEqual(Sh.raySegment(0, 0, 1, 0, 5, 1, 5, 3), Infinity);
  // Параллельные.
  assert.strictEqual(Sh.raySegment(0, 0, 1, 0, 1, 1, 5, 1), Infinity);
}

// 2. castToNearest выбирает ближайший из нескольких сегментов.
{
  const segs = [
    { ax: 10, ay: -5, bx: 10, by: 5 },
    { ax: 4, ay: -5, bx: 4, by: 5 },
    { ax: 7, ay: -5, bx: 7, by: 5 },
  ];
  const t = Sh.castToNearest(0, 0, 1, 0, segs);
  assert.ok(Math.abs(t - 4) < 1e-9, `ближайший t=${t}`);
}

// 3. Пустая сцена (только рамка): полигон видимости накрывает почти всю рамку.
{
  const border = Sh.rectSegments(0, 0, 100, 100);
  const poly = Sh.visibilityPolygon(50, 50, border);
  assert.ok(poly.length >= 8, `мало точек: ${poly.length}`);
  for (const p of poly) {
    const onBorder = Math.abs(p.x) < 1e-6 || Math.abs(p.x - 100) < 1e-6 ||
                     Math.abs(p.y) < 1e-6 || Math.abs(p.y - 100) < 1e-6;
    assert.ok(onBorder, `точка не на рамке: ${p.x}, ${p.y}`);
  }
  // Углы рамки видимы из центра пустой сцены.
  for (const corner of [[0, 0], [100, 0], [100, 100], [0, 100]]) {
    const found = poly.some((p) => Math.hypot(p.x - corner[0], p.y - corner[1]) < 0.1);
    assert.ok(found, `угол ${corner} не виден`);
  }
}

// 4. Точка за препятствием не входит в полигон видимости, сбоку — входит.
{
  const segments = Sh.rectSegments(0, 0, 100, 100)
    .concat(Sh.rectSegments(40, 40, 20, 20)); // квадрат в центре
  const poly = Sh.visibilityPolygon(50, 10, segments); // источник сверху
  const pts = poly.map((p) => ({ x: p.x, y: p.y }));
  assert.ok(!Sh.pointInPolygon(50, 90, pts), 'точка за квадратом видима — ошибка');
  assert.ok(Sh.pointInPolygon(10, 50, pts), 'точка сбоку должна быть видима');
  assert.ok(Sh.pointInPolygon(50, 30, pts), 'точка перед квадратом должна быть видима');
}

// 5. pointInPolygon: квадрат.
{
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.ok(Sh.pointInPolygon(5, 5, sq));
  assert.ok(!Sh.pointInPolygon(15, 5, sq));
}

// 6. polySegments замыкает контур.
{
  const segs = Sh.polySegments([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }]);
  assert.strictEqual(segs.length, 3);
  assert.strictEqual(segs[2].bx, 0, 'последний сегмент должен вернуться в начало');
  assert.strictEqual(segs[2].by, 0);
}

console.log('shadows.test.js: все тесты пройдены');
