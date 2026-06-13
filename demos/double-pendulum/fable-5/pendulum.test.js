'use strict';
// node demos/double-pendulum/fable-5/pendulum.test.js
const assert = require('node:assert');
const P = require('./pendulum.js');

const params = { m1: 1, m2: 1, l1: 1, l2: 1, g: 9.81 };

function run(s, dt, steps, p) {
  for (let i = 0; i < steps; i++) s = P.rk4Step(s, dt, p);
  return s;
}

// 1. Сохранение энергии на хаотической траектории (нет трения → E = const).
{
  const s0 = [2.0, 0, 2.5, 0];
  const e0 = P.energy(s0, params);
  let s = s0;
  const dt = 0.0005;
  let maxDrift = 0;
  for (let i = 0; i < 20000; i++) { // 10 секунд
    s = P.rk4Step(s, dt, params);
    maxDrift = Math.max(maxDrift, Math.abs(P.energy(s, params) - e0));
  }
  const scale = (params.m1 + params.m2) * params.g * (params.l1 + params.l2);
  assert.ok(maxDrift / scale < 1e-6,
    `дрейф энергии слишком велик: ${maxDrift / scale}`);
}

// 2. Положение равновесия устойчиво: из (0,0,0,0) маятник не двигается.
{
  const s = run([0, 0, 0, 0], 0.001, 1000, params);
  for (const v of s) assert.ok(Math.abs(v) < 1e-12, `равновесие нарушено: ${s}`);
}

// 3. Зеркальная симметрия: отражённые начальные условия дают отражённую траекторию.
{
  const a = run([1.1, 0.3, -0.7, -0.2], 0.001, 5000, params);
  const b = run([-1.1, -0.3, 0.7, 0.2], 0.001, 5000, params);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(a[i] + b[i]) < 1e-9, `асимметрия в компоненте ${i}`);
  }
}

// 4. Чувствительность к начальным условиям (хаос): крошечное отклонение растёт на порядки.
{
  const eps = 1e-8;
  let a = [Math.PI / 2, 0, Math.PI / 2, 0];
  let b = [Math.PI / 2 + eps, 0, Math.PI / 2, 0];
  const dt = 0.001;
  for (let i = 0; i < 20000; i++) { // 20 секунд
    a = P.rk4Step(a, dt, params);
    b = P.rk4Step(b, dt, params);
  }
  const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);
  assert.ok(dist > 1e-3, `траектории не разошлись: dist=${dist}`);
}

// 5. Геометрия: positions согласованы с углами и длинами.
{
  const pos = P.positions([Math.PI / 2, 0, Math.PI, 0], { m1: 1, m2: 1, l1: 2, l2: 1.5, g: 9.81 });
  assert.ok(Math.abs(pos.x1 - 2) < 1e-12);
  assert.ok(Math.abs(pos.y1 - 0) < 1e-12);
  assert.ok(Math.abs(pos.x2 - 2) < 1e-12);
  assert.ok(Math.abs(pos.y2 - (-1.5)) < 1e-12);
}

console.log('pendulum.test.js: все тесты пройдены');
