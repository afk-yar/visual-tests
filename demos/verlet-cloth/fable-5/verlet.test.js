'use strict';
// node demos/verlet-cloth/fable-5/verlet.test.js
const assert = require('node:assert');
const V = require('./verlet.js');

// 1. Геометрия сетки: число точек и связей, закрепление верхнего ряда.
{
  const cloth = V.makeCloth(10, 6, 20, 0, 0, 3);
  assert.strictEqual(cloth.points.length, 60);
  // Горизонтальные: (10-1)*6, вертикальные: 10*(6-1).
  assert.strictEqual(cloth.constraints.length, 9 * 6 + 10 * 5);
  assert.ok(cloth.points[0].pinned, 'левый верхний угол закреплён');
  assert.ok(cloth.points[9].pinned, 'правый верхний угол закреплён');
  assert.ok(!cloth.points[10].pinned, 'второй ряд свободен');
}

// 2. Закреплённая точка не двигается ни от интегрирования, ни от связей.
{
  const cloth = V.makeCloth(2, 2, 30, 100, 100, 1);
  for (let i = 0; i < 100; i++) {
    V.integrate(cloth.points, 1 / 60, 0, 900, 0.99);
    V.solveConstraints(cloth.points, cloth.constraints, 4, 0);
  }
  assert.strictEqual(cloth.points[0].x, 100);
  assert.strictEqual(cloth.points[0].y, 100);
  assert.strictEqual(cloth.points[1].x, 130);
}

// 3. Свободная частица падает под гравитацией, путь растёт ~квадратично.
{
  const p = [{ x: 0, y: 0, px: 0, py: 0, pinned: false }];
  const dt = 1 / 60, g = 900;
  let y30 = 0;
  for (let i = 0; i < 60; i++) {
    V.integrate(p, dt, 0, g, 1);
    if (i === 29) y30 = p[0].y;
  }
  const y60 = p[0].y;
  // y(2t)/y(t) ≈ 4 для равноускоренного движения.
  const ratio = y60 / y30;
  assert.ok(ratio > 3.7 && ratio < 4.3, `падение не квадратично: ${ratio}`);
  assert.ok(y60 > 0, 'не падает вниз');
}

// 4. Связь возвращает длину к rest после релаксации.
{
  const points = [
    { x: 0, y: 0, px: 0, py: 0, pinned: false },
    { x: 50, y: 0, px: 50, py: 0, pinned: false }, // растянута: rest = 30
  ];
  const constraints = [{ a: 0, b: 1, rest: 30, broken: false }];
  V.solveConstraints(points, constraints, 20, 0);
  const d = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  assert.ok(Math.abs(d - 30) < 1e-6, `длина не вернулась к rest: ${d}`);
}

// 5. Перетянутая связь рвётся, обычная — нет.
{
  const points = [
    { x: 0, y: 0, px: 0, py: 0, pinned: true },
    { x: 100, y: 0, px: 100, py: 0, pinned: true }, // 100 > 30 * 2.5
    { x: 130, y: 0, px: 130, py: 0, pinned: true }, // 30 — точно rest
  ];
  const constraints = [
    { a: 0, b: 1, rest: 30, broken: false },
    { a: 1, b: 2, rest: 30, broken: false },
  ];
  V.solveConstraints(points, constraints, 1, 2.5);
  assert.ok(constraints[0].broken, 'перетянутая связь не порвалась');
  assert.ok(!constraints[1].broken, 'нормальная связь порвалась');
}

// 6. Стабильность: ткань под гравитацией 1000 шагов — без NaN и разлёта.
{
  const cloth = V.makeCloth(20, 12, 18, 50, 20, 4);
  for (let i = 0; i < 1000; i++) {
    V.integrate(cloth.points, 1 / 120, 0, 900, 0.99);
    V.solveConstraints(cloth.points, cloth.constraints, 3, 6);
  }
  for (const p of cloth.points) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN в позиции');
    assert.ok(Math.abs(p.x) < 2000 && Math.abs(p.y) < 2000, `разлетелась: ${p.x}, ${p.y}`);
  }
  // Ткань повисла: нижний ряд ниже верхнего.
  const top = cloth.points[0].y;
  const bottom = cloth.points[cloth.points.length - 1].y;
  assert.ok(bottom > top + 100, 'ткань не повисла под гравитацией');
}

console.log('verlet.test.js: все тесты пройдены');
