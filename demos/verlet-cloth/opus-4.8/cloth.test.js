'use strict';
const assert = require('node:assert');
const {
  integrateParticle,
  solveConstraint,
  shouldTear,
  solveConstraints,
  makeCloth,
} = require('./cloth.js');

// A. Верлет без скорости сохраняет покой: x == ox и нулевое ускорение → стоит.
{
  const p = { x: 5, y: 7, ox: 5, oy: 7, pinned: false };
  integrateParticle(p, 0, 0, 0.1, 1);
  assert.ok(Math.abs(p.x - 5) < 1e-12 && Math.abs(p.y - 7) < 1e-12,
    `покой не сохранён: ${JSON.stringify(p)}`);
}

// B. Верлет корректно применяет ускорение за два шага.
// Из покоя за шаг dt смещение = a*dt². За второй шаг скорость (x-ox)=a*dt²
// переносится + ещё a*dt² → суммарно 3*a*dt² от старта. Точная аналитика верле.
{
  const a = 4, dt = 0.5, damping = 1;
  const p = { x: 0, y: 0, ox: 0, oy: 0, pinned: false };
  integrateParticle(p, a, 0, dt, damping);          // шаг 1
  assert.ok(Math.abs(p.x - a * dt * dt) < 1e-12,
    `шаг 1: ожидали ${a * dt * dt}, получили ${p.x}`);
  integrateParticle(p, a, 0, dt, damping);          // шаг 2
  assert.ok(Math.abs(p.x - 3 * a * dt * dt) < 1e-12,
    `шаг 2: ожидали ${3 * a * dt * dt}, получили ${p.x}`);
}

// C. Решение констрейнта сближает две частицы к rest-длине.
{
  const points = [
    { x: 0, y: 0, ox: 0, oy: 0, pinned: false },
    { x: 30, y: 0, ox: 30, oy: 0, pinned: false }, // dist=30, rest=10
  ];
  const c = { a: 0, b: 1, rest: 10, broken: false };
  const before = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  for (let i = 0; i < 8; i++) solveConstraint(c, points);
  const after = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  assert.ok(after < before, `связь должна сближать: было ${before}, стало ${after}`);
  assert.ok(Math.abs(after - 10) < 1e-9, `должна сойтись к rest=10, стало ${after}`);
}

// D. Закреплённая частица не двигается при решении констрейнта (весь сдвиг — свободной).
{
  const points = [
    { x: 0, y: 0, ox: 0, oy: 0, pinned: true },
    { x: 25, y: 0, ox: 25, oy: 0, pinned: false },
  ];
  const c = { a: 0, b: 1, rest: 10, broken: false };
  solveConstraint(c, points);
  assert.ok(points[0].x === 0 && points[0].y === 0,
    `pinned-частица сдвинулась: ${JSON.stringify(points[0])}`);
  assert.ok(points[1].x < 25, `свободная частица должна была подтянуться: ${points[1].x}`);
}

// E. Закреплённая частица не двигается и при интегрировании (даже под гравитацией).
{
  const p = { x: 3, y: 9, ox: 3, oy: 9, pinned: true };
  integrateParticle(p, 0, 1000, 0.1, 1);
  assert.ok(p.x === 3 && p.y === 9, `pinned сдвинулась интегратором: ${JSON.stringify(p)}`);
}

// F. Порог разрыва: рвётся выше порога, не рвётся ниже.
{
  const tear = 2.0; // рвём при растяжении > 2× rest
  // Ниже порога: dist=15, rest=10 → strain=1.5 < 2 → не рвётся.
  const below = [
    { x: 0, y: 0, ox: 0, oy: 0, pinned: true },
    { x: 15, y: 0, ox: 15, oy: 0, pinned: false },
  ];
  const cBelow = { a: 0, b: 1, rest: 10, broken: false };
  assert.ok(!shouldTear(cBelow, below, tear), 'связь под порогом не должна рваться');

  // Выше порога: dist=25, rest=10 → strain=2.5 > 2 → рвётся.
  const above = [
    { x: 0, y: 0, ox: 0, oy: 0, pinned: true },
    { x: 25, y: 0, ox: 25, oy: 0, pinned: false },
  ];
  const cAbove = { a: 0, b: 1, rest: 10, broken: false };
  assert.ok(shouldTear(cAbove, above, tear), 'связь над порогом должна рваться');
}

// G. solveConstraints помечает перетянутую связь broken и не трогает целую.
{
  const cloth = makeCloth(2, 1, 10, 0, 0, 1); // две частицы, одна связь rest=10
  // Растащим свободную частицу далеко (верхний ряд: индекс 0 закреплён, 1 свободен).
  cloth.points[1].x = 60; // dist=60, strain=6
  solveConstraints(cloth.points, cloth.constraints, 3, 2.0);
  assert.ok(cloth.constraints[0].broken, 'перетянутая связь должна быть помечена broken');
}

// H. Сетка: закреплён только верхний ряд (углы включительно), внутренние ряды свободны.
{
  const cloth = makeCloth(5, 4, 10, 0, 0, 2);
  assert.ok(cloth.points[0].pinned, 'левый верхний угол должен быть закреплён');
  assert.ok(cloth.points[4].pinned, 'правый верхний угол должен быть закреплён');
  // нижний ряд — все свободны
  for (let c = 0; c < 5; c++) {
    assert.ok(!cloth.points[3 * 5 + c].pinned, `нижняя частица ${c} не должна быть закреплена`);
  }
  // число связей: горизонтальные (cols-1)*rows + вертикальные cols*(rows-1)
  const expected = (5 - 1) * 4 + 5 * (4 - 1);
  assert.strictEqual(cloth.constraints.length, expected,
    `связей должно быть ${expected}, получено ${cloth.constraints.length}`);
}

console.log('Все тесты ткани пройдены.');
