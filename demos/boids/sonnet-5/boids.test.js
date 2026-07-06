'use strict';
const assert = require('node:assert');
const {
  toroidalDelta,
  toroidalDistance,
  separationRule,
  alignmentRule,
  cohesionRule,
} = require('./boids.js');

// 1) Тороидальное расстояние: две точки у противоположных краёв поля должны
// оказаться "близко" через перенос — намного ближе, чем наивное евклидово
// расстояние без учёта wrap.
{
  const width = 100;
  const height = 100;
  const a = { x: 5, y: 50 };
  const b = { x: 95, y: 50 };
  const naive = Math.hypot(b.x - a.x, b.y - a.y);
  const wrapped = toroidalDistance(a.x, a.y, b.x, b.y, width, height);
  assert.ok(
    wrapped < naive,
    `тороидальное расстояние (${wrapped}) должно быть меньше наивного (${naive})`
  );
  assert.ok(Math.abs(wrapped - 10) < 1e-9, `ожидали 10, получили ${wrapped}`);
}

// 2) Тороидальный delta действительно указывает кратчайшим путём через край,
// а не "в лоб" по прямой.
{
  const d = toroidalDelta(5, 50, 95, 50, 100, 100);
  assert.ok(Math.abs(d.dx - -10) < 1e-9, `dx должен быть -10 (через край), получили ${d.dx}`);
  assert.strictEqual(d.dy, 0);
}

// 3) Разделение отталкивает: сосед почти в той же точке (перекрытие) —
// вектор разделения должен указывать прочь от него.
{
  const width = 1000;
  const height = 1000;
  const boid = { x: 500, y: 500, vx: 0, vy: 0 };
  const neighborRight = { x: 502, y: 500, vx: 0, vy: 0 };
  const steer = separationRule(boid, [neighborRight], width, height);
  assert.ok(steer.x < 0, `сосед справа -> разделение должно толкать влево (x<0), получили ${steer.x}`);
  assert.ok(Math.abs(steer.y) < 1e-9, `по Y смещения быть не должно, получили ${steer.y}`);
}

// 4) Разделение сильнее при более тесном перекрытии (обратная зависимость
// силы отталкивания от расстояния до соседа).
{
  const width = 1000;
  const height = 1000;
  const boid = { x: 500, y: 500, vx: 0, vy: 0 };
  const closeNeighbor = { x: 501, y: 500, vx: 0, vy: 0 };
  const farNeighbor = { x: 520, y: 500, vx: 0, vy: 0 };
  const steerClose = separationRule(boid, [closeNeighbor], width, height);
  const steerFar = separationRule(boid, [farNeighbor], width, height);
  assert.ok(
    Math.abs(steerClose.x) > Math.abs(steerFar.x),
    `более близкий сосед должен отталкивать сильнее: close=${steerClose.x}, far=${steerFar.x}`
  );
}

// 5) Выравнивание: желаемое направление — средняя скорость соседей.
{
  const boid = { x: 0, y: 0, vx: 0, vy: 0 };
  const neighbors = [
    { x: 10, y: 0, vx: 4, vy: 0 },
    { x: -10, y: 0, vx: 2, vy: 0 },
  ];
  const align = alignmentRule(boid, neighbors);
  assert.ok(Math.abs(align.x - 3) < 1e-9, `ожидали среднюю Vx=3, получили ${align.x}`);
  assert.ok(Math.abs(align.y) < 1e-9);
}

// 6) Сцепление: желаемое направление — к центру масс соседей, посчитанному
// тороидально (сосед "через край" не должен тянуть в противоположную сторону).
{
  const width = 100;
  const height = 100;
  const boid = { x: 95, y: 50 };
  const neighbors = [{ x: 5, y: 50 }]; // рядом через край: кратчайший путь +10 по X
  const coh = cohesionRule(boid, neighbors, width, height);
  assert.ok(Math.abs(coh.x - 10) < 1e-9, `ожидали смещение +10 через край, получили ${coh.x}`);
  assert.ok(Math.abs(coh.y) < 1e-9);
}

// 7) Без соседей в радиусе все три правила молчат (нулевой вектор) —
// агент не должен дёргаться в пустоте.
{
  const boid = { x: 50, y: 50, vx: 1, vy: -1 };
  assert.deepStrictEqual(separationRule(boid, [], 100, 100), { x: 0, y: 0 });
  assert.deepStrictEqual(alignmentRule(boid, []), { x: 0, y: 0 });
  assert.deepStrictEqual(cohesionRule(boid, [], 100, 100), { x: 0, y: 0 });
}

console.log('boids.test.js: все 7 проверок пройдены');
