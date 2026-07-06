// lorenz.test.js — тесты чистой логики lorenz.js через node:assert.
// Запуск: node demos/lorenz/sonnet-5/lorenz.test.js
'use strict';

const assert = require('assert');
const Lorenz = require('./lorenz.js');

// 1) Производные в нетривиальных стационарных точках C± = (±√(β(ρ-1)), ±√(β(ρ-1)), ρ-1)
//    должны быть близки к нулю.
(function testEquilibriaCPlusMinus() {
  const { sigma, rho, beta } = Lorenz.DEFAULTS;
  const coord = Math.sqrt(beta * (rho - 1));
  const points = [
    [coord, coord, rho - 1],   // C+
    [-coord, -coord, rho - 1], // C-
  ];

  for (const [x, y, z] of points) {
    const [dx, dy, dz] = Lorenz.derivatives(x, y, z, sigma, rho, beta);
    assert.ok(Math.abs(dx) < 1e-9, `dx в стационарной точке должен быть ~0, получено ${dx}`);
    assert.ok(Math.abs(dy) < 1e-9, `dy в стационарной точке должен быть ~0, получено ${dy}`);
    assert.ok(Math.abs(dz) < 1e-9, `dz в стационарной точке должен быть ~0, получено ${dz}`);
  }
  console.log('OK: производные в C± близки к нулю');
})();

// 2) Начало координат — тоже стационарная точка (тривиальное равновесие).
(function testOriginEquilibrium() {
  const [dx, dy, dz] = Lorenz.derivatives(0, 0, 0);
  assert.strictEqual(dx, 0);
  assert.strictEqual(dy, 0);
  assert.strictEqual(dz, 0);
  console.log('OK: производные в начале координат равны нулю');
})();

// 3) Шаг RK4 при очень малом dt должен приближаться к явному методу Эйлера
//    (проверка корректности формулы взвешивания k1..k4).
(function testRK4MatchesEulerForTinyDt() {
  const state = [1, 1, 1];
  const dt = 1e-6;
  const next = Lorenz.step(state, dt);
  const [dx, dy, dz] = Lorenz.derivatives(state[0], state[1], state[2]);

  assert.ok(Math.abs(next[0] - (state[0] + dt * dx)) < 1e-9);
  assert.ok(Math.abs(next[1] - (state[1] + dt * dy)) < 1e-9);
  assert.ok(Math.abs(next[2] - (state[2] + dt * dz)) < 1e-9);
  console.log('OK: RK4 при dt→0 совпадает с методом Эйлера');
})();

// 4) Траектория за короткий интервал интегрирования остаётся ограниченной:
//    все значения конечны (не NaN/Infinity) и не выходят за разумную область
//    (классический аттрактор Лоренца укладывается примерно в |x|,|y|<~30, z в ~[0,55]).
(function testTrajectoryBoundedAndFinite() {
  let state = [0.1, 0, 0];
  const dt = 0.01;
  const steps = 5000; // 50 единиц модельного времени
  let maxAbs = 0;

  for (let i = 0; i < steps; i++) {
    state = Lorenz.step(state, dt);
    for (const v of state) {
      assert.ok(Number.isFinite(v), `состояние стало не конечным на шаге ${i}: [${state}]`);
      maxAbs = Math.max(maxAbs, Math.abs(v));
    }
  }

  assert.ok(maxAbs < 100, `траектория вышла за ожидаемую ограниченную область, maxAbs=${maxAbs}`);
  console.log(`OK: траектория ограничена и конечна за 50 ед. времени (maxAbs=${maxAbs.toFixed(3)})`);
})();

// 5) Интегрирование не сходится в фиксированную точку (аттрактор хаотичен,
//    точка продолжает двигаться, а не "замирает").
(function testTrajectoryKeepsMoving() {
  let state = [0.1, 0, 0];
  const dt = 0.01;
  for (let i = 0; i < 2000; i++) state = Lorenz.step(state, dt);
  const before = state.slice();
  for (let i = 0; i < 50; i++) state = Lorenz.step(state, dt);
  const dist = Math.hypot(state[0] - before[0], state[1] - before[1], state[2] - before[2]);
  assert.ok(dist > 1e-3, `точка должна продолжать движение по аттрактору, dist=${dist}`);
  console.log(`OK: точка продолжает двигаться по аттрактору (сдвиг за 50 шагов=${dist.toFixed(3)})`);
})();

console.log('Все тесты lorenz.js пройдены.');
