'use strict';

const assert = require('node:assert');
const { verletStep, satisfyConstraint } = require('./cloth.js');

// --- verletStep ---------------------------------------------------------

// Закреплённая частица не двигается, px/py подтягиваются к текущей позиции.
{
  const p = { x: 10, y: 20, px: 9, py: 20, pinned: true };
  const next = verletStep(p, 0, 900, 1 / 60, 0.99);
  assert.strictEqual(next.x, 10);
  assert.strictEqual(next.y, 20);
  assert.strictEqual(next.px, 10);
  assert.strictEqual(next.py, 20);
  assert.strictEqual(next.pinned, true);
  console.log('OK verletStep: закреплённая частица остаётся на месте');
}

// Свободная частица движется по формуле Верле: x' = x + (x - px)*damping + ax*dt^2.
{
  const p = { x: 0, y: 0, px: -1, py: 0, pinned: false }; // скорость по x = 1/шаг
  const dt = 1 / 60;
  const ax = 0;
  const ay = 100;
  const damping = 1;
  const next = verletStep(p, ax, ay, dt, damping);
  const expectedX = p.x + (p.x - p.px) * damping + ax * dt * dt;
  const expectedY = p.y + (p.y - p.py) * damping + ay * dt * dt;
  assert.ok(Math.abs(next.x - expectedX) < 1e-9, `x: expected ${expectedX}, got ${next.x}`);
  assert.ok(Math.abs(next.y - expectedY) < 1e-9, `y: expected ${expectedY}, got ${next.y}`);
  assert.strictEqual(next.px, 0);
  assert.strictEqual(next.py, 0);
  assert.strictEqual(next.pinned, false);
  console.log('OK verletStep: свободная частица интегрируется по формуле Верле (гравитация + перенос скорости)');
}

// Затухание (damping < 1) гасит перенесённую скорость.
{
  const p = { x: 10, y: 0, px: 0, py: 0, pinned: false }; // скорость по x = 10/шаг
  const next = verletStep(p, 0, 0, 1, 0.9);
  assert.ok(Math.abs(next.x - 19) < 1e-9, `expected x=19 (10 + 10*0.9), got ${next.x}`);
  console.log('OK verletStep: damping уменьшает перенос скорости между шагами');
}

// --- satisfyConstraint ---------------------------------------------------

// Растянутая связь между двумя свободными точками стягивается ровно к restLength.
{
  const p1 = { x: 0, y: 0, pinned: false };
  const p2 = { x: 20, y: 0, pinned: false };
  const result = satisfyConstraint(p1, p2, 10, 100);
  const dx = result.p2.x - result.p1.x;
  const dy = result.p2.y - result.p1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  assert.ok(Math.abs(dist - 10) < 1e-9, `expected dist ~10, got ${dist}`);
  assert.strictEqual(result.broken, false);
  console.log('OK satisfyConstraint: растянутая пара свободных точек стягивается к restLength');
}

// Если один конец закреплён — двигается только свободный, дистанция всё равно приходит к restLength.
{
  const p1 = { x: 0, y: 0, pinned: true };
  const p2 = { x: 30, y: 0, pinned: false };
  const result = satisfyConstraint(p1, p2, 10, 100);
  assert.strictEqual(result.p1.x, 0);
  assert.strictEqual(result.p1.y, 0);
  const dist = Math.abs(result.p2.x - result.p1.x);
  assert.ok(Math.abs(dist - 10) < 1e-9, `expected dist ~10, got ${dist}`);
  console.log('OK satisfyConstraint: закреплённый конец неподвижен, свободный подтягивается к restLength');
}

// Сжатая связь (короче restLength) раздвигается обратно к restLength.
{
  const p1 = { x: 0, y: 0, pinned: false };
  const p2 = { x: 4, y: 0, pinned: false };
  const result = satisfyConstraint(p1, p2, 10, 100);
  const dist = Math.abs(result.p2.x - result.p1.x);
  assert.ok(Math.abs(dist - 10) < 1e-9, `expected dist ~10, got ${dist}`);
  console.log('OK satisfyConstraint: сжатая связь раздвигается обратно к restLength');
}

// Растяжение сверх порога помечает связь разорванной, позиции не меняются.
{
  const p1 = { x: 0, y: 0, pinned: false };
  const p2 = { x: 20, y: 0, pinned: false };
  const restLength = 10;
  const tearFactor = 1.5; // рвётся при dist > 15
  const result = satisfyConstraint(p1, p2, restLength, tearFactor);
  assert.strictEqual(result.broken, true);
  assert.strictEqual(result.p1.x, 0);
  assert.strictEqual(result.p2.x, 20);
  console.log('OK satisfyConstraint: разрыв связи при растяжении сверх порога, позиции не корректируются');
}

// Растяжение чуть ниже порога связь не рвёт и продолжает стягивать к restLength.
{
  const p1 = { x: 0, y: 0, pinned: false };
  const p2 = { x: 14, y: 0, pinned: false };
  const restLength = 10;
  const tearFactor = 1.5; // порог разрыва — dist > 15, 14 не рвёт
  const result = satisfyConstraint(p1, p2, restLength, tearFactor);
  assert.strictEqual(result.broken, false);
  const dist = Math.abs(result.p2.x - result.p1.x);
  assert.ok(Math.abs(dist - 10) < 1e-9, `expected dist ~10, got ${dist}`);
  console.log('OK satisfyConstraint: растяжение ниже порога не рвёт связь');
}

console.log('Все тесты cloth.js пройдены.');
