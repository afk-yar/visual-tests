'use strict';
const assert = require('node:assert');
const { accelerations, rk4Step, totalEnergy, bobPositions } = require('./pendulum.js');

const P = { m1: 1, m2: 1, L1: 1, L2: 1, g: 9.81 };

// A. Равновесие: вертикаль в покое → нулевые угловые ускорения.
{
  const { a1, a2 } = accelerations({ th1: 0, th2: 0, w1: 0, w2: 0 }, P);
  assert.ok(Math.abs(a1) < 1e-12, `a1 в покое должно быть 0, получено ${a1}`);
  assert.ok(Math.abs(a2) < 1e-12, `a2 в покое должно быть 0, получено ${a2}`);
}

// B. Редукция к простому маятнику: m2=0 → a1 = -g*sin(th1)/L1 (аналитика).
{
  const Ps = { m1: 1, m2: 0, L1: 2, L2: 1, g: 9.81 };
  const th1 = 0.7;
  const { a1 } = accelerations({ th1, th2: 0.3, w1: 0, w2: 0 }, Ps);
  const expected = -9.81 * Math.sin(th1) / 2;
  assert.ok(Math.abs(a1 - expected) < 1e-9, `простой маятник: ожидали ${expected}, получили ${a1}`);
}

// C. Геометрия позиций грузов (пивот в нуле, y вниз).
{
  const down = bobPositions({ th1: 0, th2: 0 }, P);
  assert.ok(Math.abs(down.x1) < 1e-12 && Math.abs(down.y1 - 1) < 1e-12, `вниз b1: ${JSON.stringify(down)}`);
  assert.ok(Math.abs(down.x2) < 1e-12 && Math.abs(down.y2 - 2) < 1e-12, `вниз b2: ${JSON.stringify(down)}`);
  const flat = bobPositions({ th1: Math.PI / 2, th2: Math.PI / 2 }, P);
  assert.ok(Math.abs(flat.x1 - 1) < 1e-12 && Math.abs(flat.y1) < 1e-12, `гориз b1: ${JSON.stringify(flat)}`);
  assert.ok(Math.abs(flat.x2 - 2) < 1e-12 && Math.abs(flat.y2) < 1e-12, `гориз b2: ${JSON.stringify(flat)}`);
}

// D. Сохранение энергии под RK4: дрейф за 10 c < 0.5 %.
{
  let s = { th1: 2.0944, th2: 2.0944, w1: 0, w2: 0 }; // ~120°, 120°
  const E0 = totalEnergy(s, P);
  const dt = 0.005;
  for (let i = 0; i < 2000; i++) s = rk4Step(s, P, dt);
  const E1 = totalEnergy(s, P);
  const drift = Math.abs(E1 - E0) / Math.abs(E0);
  assert.ok(drift < 5e-3, `дрейф энергии слишком велик: ${drift}`);
  console.log(`дрейф энергии за 10 c: ${(drift * 100).toFixed(4)} %`);
}

console.log('Все тесты физики пройдены.');
