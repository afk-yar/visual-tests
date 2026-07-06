'use strict';
const assert = require('node:assert');
const { curlVelocity, FIELD_MAX_SPEED } = require('./field.js');

// 1) Детерминированность: одинаковые координаты+время -> одинаковый вектор.
{
  const a = curlVelocity(3.14, -7.2, 12.05, 8.5);
  const b = curlVelocity(3.14, -7.2, 12.05, 8.5);
  assert.strictEqual(a.vx, b.vx, 'vx должен быть детерминирован');
  assert.strictEqual(a.vy, b.vy, 'vy должен быть детерминирован');
  assert.strictEqual(a.vz, b.vz, 'vz должен быть детерминирован');
}

// 1b) Детерминированность при чередовании с другими вызовами (нет скрытого
// мутируемого состояния между вызовами).
{
  const before = curlVelocity(1, 1, 1, 0);
  curlVelocity(999, -123, 42, 77); // "посторонний" вызов между
  const after = curlVelocity(1, 1, 1, 0);
  assert.deepStrictEqual(after, before, 'вызов не должен иметь побочных эффектов на другие точки');
}

// 2) Разные входы обычно дают разные векторы (поле не константа/не вырождено).
{
  const p1 = curlVelocity(0, 0, 0, 0);
  const p2 = curlVelocity(10, -4, 6, 2.3);
  const differs = p1.vx !== p2.vx || p1.vy !== p2.vy || p1.vz !== p2.vz;
  assert.ok(differs, 'поле не должно быть константным для разных точек');
}

// 3) Ограниченность модуля скорости: перебираем сетку точек в разумном
// диапазоне координат и времени, сверяем с аналитической границей FIELD_MAX_SPEED
// (см. вывод границы в field.js), с небольшим запасом на погрешность округления.
{
  assert.ok(Number.isFinite(FIELD_MAX_SPEED) && FIELD_MAX_SPEED > 0,
    'FIELD_MAX_SPEED должен быть конечным положительным числом');

  let maxSeen = 0;
  const coords = [-90, -45, -10, -1, 0, 1, 7.5, 22, 45, 89.9];
  const times = [0, 3.7, 15, 62.4, 240];

  for (const x of coords) {
    for (const y of coords) {
      for (const z of coords) {
        for (const t of times) {
          const v = curlVelocity(x, y, z, t);
          assert.ok(Number.isFinite(v.vx) && Number.isFinite(v.vy) && Number.isFinite(v.vz),
            `NaN/Infinity в точке (${x},${y},${z},${t})`);
          const mag = Math.sqrt(v.vx * v.vx + v.vy * v.vy + v.vz * v.vz);
          maxSeen = Math.max(maxSeen, mag);
          assert.ok(mag <= FIELD_MAX_SPEED + 1e-9,
            `|v|=${mag} превысил аналитическую границу ${FIELD_MAX_SPEED} в точке (${x},${y},${z},${t})`);
        }
      }
    }
  }

  // Граница не должна быть тривиально завышенной "на всякий случай" —
  // хотя бы какая-то выборка должна приближаться к ней по порядку величины.
  assert.ok(maxSeen > FIELD_MAX_SPEED * 0.2,
    `граница выглядит подозрительно рыхлой: maxSeen=${maxSeen}, FIELD_MAX_SPEED=${FIELD_MAX_SPEED}`);

  console.log(`ok: maxSeen=${maxSeen.toFixed(4)}, FIELD_MAX_SPEED=${FIELD_MAX_SPEED.toFixed(4)}`);
}

console.log('field.test.js: all assertions passed');
