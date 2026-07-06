'use strict';
const assert = require('node:assert');
const { orbitPosition, solveKeplerEquation, normalizeAngle } = require('./orbits.js');

function dist(p, q) {
  const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// --- Набор правдоподобных орбитальных элементов (приближённо как у реальных планет) ---
const MERCURY = { a: 0.387, e: 0.2056, periodDays: 87.97, inclinationDeg: 7.0, ascNodeDeg: 48.3, argPeriapsisDeg: 29.1, phase0Deg: 10 };
const EARTH   = { a: 1.0,   e: 0.0167, periodDays: 365.25, inclinationDeg: 0.0, ascNodeDeg: 0,    argPeriapsisDeg: 114.2, phase0Deg: 200 };
const MARS    = { a: 1.524, e: 0.0934, periodDays: 686.98, inclinationDeg: 1.85, ascNodeDeg: 49.6, argPeriapsisDeg: 286.5, phase0Deg: 55 };
const JUPITER = { a: 5.204, e: 0.0489, periodDays: 4332.6, inclinationDeg: 1.30, ascNodeDeg: 100.5, argPeriapsisDeg: 273.9, phase0Deg: 300 };

const BODIES = [MERCURY, EARTH, MARS, JUPITER];

// 1. Период обращения: положение в момент t совпадает с положением в t + T.
for (const body of BODIES) {
  for (const t of [0, 1, 33.3, body.periodDays * 0.37, -12.5]) {
    const p1 = orbitPosition(body, t);
    const p2 = orbitPosition(body, t + body.periodDays);
    const gap = dist(p1, p2);
    assert.ok(
      gap < 1e-6,
      `период не соблюдается для a=${body.a}: |p(t)-p(t+T)| = ${gap} при t=${t}`
    );
  }
}
console.log('OK: период обращения соблюдается для всех тестовых тел.');

// 2. Перигелий/афелий: при фазе 0 в t=0 — перигелий (r минимально, = a(1-e)),
//    в t=T/2 — афелий (r максимально, = a(1+e)).
for (const body of BODIES) {
  const b0 = Object.assign({}, body, { phase0Deg: 0 });
  const perihelion = orbitPosition(b0, 0);
  const aphelion = orbitPosition(b0, b0.periodDays / 2);

  const expectedPeri = b0.a * (1 - b0.e);
  const expectedApo = b0.a * (1 + b0.e);

  assert.ok(
    Math.abs(perihelion.r - expectedPeri) < 1e-9,
    `перигелий: ожидали r=${expectedPeri}, получили ${perihelion.r}`
  );
  assert.ok(
    Math.abs(aphelion.r - expectedApo) < 1e-9,
    `афелий: ожидали r=${expectedApo}, получили ${aphelion.r}`
  );

  // И это действительно экстремумы: r в любой другой момент между 0 и T лежит между ними.
  for (const frac of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
    const mid = orbitPosition(b0, b0.periodDays * frac);
    assert.ok(
      mid.r >= expectedPeri - 1e-9 && mid.r <= expectedApo + 1e-9,
      `r(t=${frac}*T)=${mid.r} вышел за пределы [${expectedPeri}, ${expectedApo}]`
    );
  }
}
console.log('OK: перигелий и афелий соответствуют ожидаемым экстремумам расстояния.');

// 3. Круговая орбита (e=0): расстояние от фокуса постоянно и равно a в любой момент.
const circular = { a: 2.5, e: 0, periodDays: 100, inclinationDeg: 15, ascNodeDeg: 40, argPeriapsisDeg: 0, phase0Deg: 77 };
for (const t of [0, 7, 23.4, 99.9, 250]) {
  const p = orbitPosition(circular, t);
  assert.ok(Math.abs(p.r - circular.a) < 1e-9, `круговая орбита: r=${p.r} != a=${circular.a} при t=${t}`);
}
console.log('OK: круговая орбита сохраняет постоянный радиус.');

// 4. Наклон орбиты: при inclinationDeg=0 движение строго в плоскости z=0,
//    при inclinationDeg>0 тело выходит из плоскости (z != 0 хотя бы где-то).
const flat = { a: 1, e: 0.3, periodDays: 50, inclinationDeg: 0, ascNodeDeg: 20, argPeriapsisDeg: 10, phase0Deg: 0 };
const tilted = Object.assign({}, flat, { inclinationDeg: 30 });
let maxAbsZFlat = 0;
let maxAbsZTilted = 0;
for (let i = 0; i <= 20; i++) {
  const t = (flat.periodDays * i) / 20;
  maxAbsZFlat = Math.max(maxAbsZFlat, Math.abs(orbitPosition(flat, t).z));
  maxAbsZTilted = Math.max(maxAbsZTilted, Math.abs(orbitPosition(tilted, t).z));
}
assert.ok(maxAbsZFlat < 1e-9, `orbit без наклона должна лежать в z=0, а maxAbsZFlat=${maxAbsZFlat}`);
assert.ok(maxAbsZTilted > 0.1, `наклонная орбита должна выходить из плоскости, а maxAbsZTilted=${maxAbsZTilted}`);
console.log('OK: наклон орбиты корректно выводит тело из опорной плоскости.');

// 5. Уравнение Кеплера: базовые проверки решателя.
assert.ok(Math.abs(solveKeplerEquation(0, 0.5) - 0) < 1e-9, 'M=0 должно давать E=0');
assert.ok(Math.abs(solveKeplerEquation(Math.PI, 0.6) - Math.PI) < 1e-9, 'M=π должно давать E=π (sin(π)=0)');
assert.equal(normalizeAngle(-Math.PI / 2).toFixed(6), (1.5 * Math.PI).toFixed(6));

console.log('Все тесты orbits.js пройдены.');
