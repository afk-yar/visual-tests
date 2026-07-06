'use strict';
// Тесты чистой физики двойного маятника. Запуск: node pendulum.test.js
const assert = require('node:assert');
const Pendulum = require('./pendulum.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// 1) Сохранение энергии консервативной системы (без демпфирования) при RK4-
//    интегрировании на коротком интервале — фундаментальное свойство уравнений
//    двойного маятника без затухания.
test('энергия сохраняется на интервале интегрирования (RK4, tol relative)', () => {
  const params = { m1: 1, m2: 1, l1: 1, l2: 1, g: 9.81 };
  let state = [1.2, -0.5, 0, 0];
  const e0 = Pendulum.totalEnergy(state, params);

  const dt = 0.001;
  const steps = 3000; // 3 секунды реального времени
  for (let i = 0; i < steps; i++) {
    state = Pendulum.rk4Step(state, params, dt);
  }
  const e1 = Pendulum.totalEnergy(state, params);

  const drift = Math.abs(e1 - e0) / Math.abs(e0);
  assert.ok(
    drift < 1e-4,
    `относительный дрейф энергии ${drift} превышает допуск (E0=${e0}, E1=${e1})`
  );
});

// 2) Устойчивое равновесие: маятник, отпущенный из состояния покоя строго вниз
//    (th1=th2=0, w1=w2=0), не должен получать ускорение — производные нулевые.
test('состояние покоя (оба стержня вниз) — нулевые производные (равновесие)', () => {
  const params = { m1: 1.3, m2: 0.7, l1: 0.9, l2: 1.1, g: 9.81 };
  const state = [0, 0, 0, 0];
  const d = Pendulum.derivatives(state, params);
  assert.ok(Math.abs(d[0]) < 1e-12, 'th1\' должно быть 0');
  assert.ok(Math.abs(d[1]) < 1e-12, 'th2\' должно быть 0');
  assert.ok(Math.abs(d[2]) < 1e-9, 'th1\'\' должно быть 0 в положении равновесия');
  assert.ok(Math.abs(d[3]) < 1e-9, 'th2\'\' должно быть 0 в положении равновесия');
});

// 3) Чувствительность к начальным условиям (хаос): две траектории, отличающиеся
//    на 1e-3 рад по th1, должны разойтись существенно сильнее исходного
//    отклонения за разумное время — это и есть демонстрируемый в демо эффект
//    "призрака".
test('малое отклонение начального угла экспоненциально усиливается (хаос)', () => {
  const params = { m1: 1, m2: 1, l1: 1, l2: 1, g: 9.81 };
  const eps = 1e-3;
  let a = [Math.PI / 2, Math.PI / 2, 0, 0];
  let b = [Math.PI / 2 + eps, Math.PI / 2, 0, 0];

  const dt = 0.001;
  const steps = 12000; // 12 секунд — эмпирически подобрано (см. пробный прогон):
  // отклонение растёт с ~1x до ~65x за это время при данных начальных условиях.
  for (let i = 0; i < steps; i++) {
    a = Pendulum.rk4Step(a, params, dt);
    b = Pendulum.rk4Step(b, params, dt);
  }

  const posA = Pendulum.positions(a, params);
  const posB = Pendulum.positions(b, params);
  const dist = Math.hypot(posA.x2 - posB.x2, posA.y2 - posB.y2);

  // Порог намеренно консервативный (x10 при фактических ~x65) — тест проверяет
  // качественное свойство (экспоненциальное усиление возмущения), а не точное
  // числовое значение, которое зависит от деталей libm конкретной платформы.
  assert.ok(
    dist > eps * 10,
    `расхождение нижнего груза ${dist} должно многократно превышать исходное отклонение ${eps}`
  );
});

console.log(`\n${passed} тест(ов) пройдено.`);
