'use strict';
// node demos/lorenz/fable-5/lorenz.test.js
const assert = require('node:assert');
const L = require('./lorenz.js');

const p = L.CLASSIC;

// 1. Классические параметры.
{
  assert.strictEqual(p.sigma, 10);
  assert.strictEqual(p.rho, 28);
  assert.ok(Math.abs(p.beta - 8 / 3) < 1e-15);
}

// 2. Неподвижные точки: производные в них равны нулю.
{
  for (const fp of L.fixedPoints(p)) {
    const d = L.derivatives(fp, p);
    for (const v of d) {
      assert.ok(Math.abs(v) < 1e-12, `производная не нулевая в ${fp}: ${d}`);
    }
  }
}

// 3. Траектория остаётся ограниченной (аттрактор компактен).
{
  let s = [1, 1, 1];
  const dt = 0.005;
  for (let i = 0; i < 40000; i++) { // 200 единиц времени
    s = L.rk4Step(s, dt, p);
    assert.ok(Math.abs(s[0]) < 100 && Math.abs(s[1]) < 100 && s[2] > -5 && s[2] < 100,
      `траектория ушла: ${s} на шаге ${i}`);
  }
}

// 4. Порядок сходимости RK4 ≈ 4: ошибка падает ~в 16 раз при половинном шаге.
{
  const t = 1, s0 = [1, 1, 1];
  function integrate(dt) {
    let s = s0;
    const n = Math.round(t / dt);
    for (let i = 0; i < n; i++) s = L.rk4Step(s, dt, p);
    return s;
  }
  const ref = integrate(0.0005); // почти точное решение
  const err = (s) => Math.hypot(s[0] - ref[0], s[1] - ref[1], s[2] - ref[2]);
  const e1 = err(integrate(0.02));
  const e2 = err(integrate(0.01));
  const ratio = e1 / e2;
  assert.ok(ratio > 8 && ratio < 40, `порядок сходимости не похож на 4-й: ratio=${ratio}`);
}

// 5. Чувствительность к начальным условиям (хаос).
{
  let a = [1, 1, 1];
  let b = [1 + 1e-9, 1, 1];
  const dt = 0.005;
  for (let i = 0; i < 8000; i++) { // 40 единиц времени
    a = L.rk4Step(a, dt, p);
    b = L.rk4Step(b, dt, p);
  }
  const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  assert.ok(dist > 0.1, `траектории не разошлись: ${dist}`);
}

console.log('lorenz.test.js: все тесты пройдены');
