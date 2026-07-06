// Тесты чистой логики углов стрелок. Запуск: node clock.test.js
const assert = require('node:assert');
const { computeAngles, angleDelta, normalizeDeg, easeOutBack } = require('./clock.js');

function closeTo(actual, expected, eps, msg) {
  assert.ok(
    Math.abs(angleDelta(actual, expected)) < eps,
    `${msg}: ожидали ~${expected}, получили ${actual}`
  );
}

// 3:00:00 — часовая ровно на "3" (90° от вертикали), минутная на "12" (0°).
{
  const a = computeAngles(3, 0, 0, 0);
  closeTo(a.hourDeg, 90, 1e-9, '3:00:00 hourDeg');
  closeTo(a.minuteDeg, 0, 1e-9, '3:00:00 minuteDeg');
  closeTo(a.secondDeg, 0, 1e-9, '3:00:00 secondDeg');
}

// 3:30:00 — часовая ровно между 3 и 4, то есть 90° + половина часового
// шага (30°) = 105°. Минутная — на "6" (180°).
{
  const a = computeAngles(3, 30, 0, 0);
  closeTo(a.hourDeg, 105, 1e-9, '3:30:00 hourDeg');
  closeTo(a.minuteDeg, 180, 1e-9, '3:30:00 minuteDeg');
}

// 9:15:00 — минутная на "3" (90°), часовая = (9 + 15/60)/12*360 = 277.5°.
{
  const a = computeAngles(9, 15, 0, 0);
  closeTo(a.minuteDeg, 90, 1e-9, '9:15:00 minuteDeg');
  closeTo(a.hourDeg, 277.5, 1e-9, '9:15:00 hourDeg');
}

// 12:00:00 (и по модулю 12 часов) — обе стрелки на 0°.
{
  const a = computeAngles(12, 0, 0, 0);
  closeTo(a.hourDeg, 0, 1e-9, '12:00:00 hourDeg');
  closeTo(a.minuteDeg, 0, 1e-9, '12:00:00 minuteDeg');
}

// Секундная стрелка: 45 секунд -> 270°.
{
  const a = computeAngles(0, 0, 45, 0);
  closeTo(a.secondDeg, 270, 1e-9, '0:00:45 secondDeg');
}

// Минутная стрелка непрерывно учитывает секунды: за полминуты (30с)
// минутная стрелка проходит ПОЛОВИНУ минутного деления (3° из 6°),
// а не стоит на месте до следующей полной минуты.
{
  const base = computeAngles(4, 10, 0, 0).minuteDeg;
  const withSeconds = computeAngles(4, 10, 30, 0).minuteDeg;
  closeTo(withSeconds - base, 3, 1e-9, 'minuteDeg учитывает секунды (полминуты = 3°)');
}

// Часовая стрелка непрерывно учитывает минуты: за полчаса часовая
// стрелка проходит половину часового деления (15° из 30°).
{
  const base = computeAngles(5, 0, 0, 0).hourDeg;
  const withMinutes = computeAngles(5, 30, 0, 0).hourDeg;
  closeTo(withMinutes - base, 15, 1e-9, 'hourDeg учитывает минуты (полчаса = 15°)');
}

// Непрерывность: маленькое изменение времени даёт маленькое изменение
// угла, а не скачок — проверяем в нескольких точках, включая переход
// через границу минуты/часа (секунды 59->0, минуты 59->0).
{
  const points = [
    [6, 15, 30, 0],
    [11, 59, 59, 900], // почти конец 12-го часа
    [0, 0, 0, 50],
    [2, 59, 59, 990] // почти переход в 3:00:00
  ];
  const dtMs = 20; // маленький шаг времени

  for (const [h, m, s, ms] of points) {
    const a1 = computeAngles(h, m, s, ms);

    let totalMs = ms + dtMs;
    let s2 = s + Math.floor(totalMs / 1000);
    const ms2 = totalMs % 1000;
    let m2 = m + Math.floor(s2 / 60);
    s2 = s2 % 60;
    let h2 = h + Math.floor(m2 / 60);
    m2 = m2 % 60;

    const a2 = computeAngles(h2, m2, s2, ms2);

    const dHour = Math.abs(angleDelta(a2.hourDeg, a1.hourDeg));
    const dMinute = Math.abs(angleDelta(a2.minuteDeg, a1.minuteDeg));
    const dSecond = Math.abs(angleDelta(a2.secondDeg, a1.secondDeg));

    assert.ok(dHour < 0.01, `hourDeg скачок при ${h}:${m}:${s}.${ms}: delta=${dHour}`);
    assert.ok(dMinute < 0.5, `minuteDeg скачок при ${h}:${m}:${s}.${ms}: delta=${dMinute}`);
    assert.ok(dSecond < 8, `secondDeg скачок при ${h}:${m}:${s}.${ms}: delta=${dSecond}`);
  }
}

// Углы всегда нормализованы в [0, 360).
{
  const a = computeAngles(23, 59, 59, 999);
  for (const key of ['hourDeg', 'minuteDeg', 'secondDeg']) {
    assert.ok(a[key] >= 0 && a[key] < 360, `${key} вне диапазона [0,360): ${a[key]}`);
  }
}

// normalizeDeg и easeOutBack — вспомогательные функции для рендера тика.
{
  assert.strictEqual(normalizeDeg(-30), 330);
  assert.strictEqual(normalizeDeg(390), 30);
  assert.ok(Math.abs(easeOutBack(0)) < 1e-9, 'easeOutBack(0) ~ 0');
  assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-9, 'easeOutBack(1) ~ 1');
  assert.ok(easeOutBack(0.9) > 1, 'easeOutBack даёт лёгкий перелёт (overshoot) перед 1');
}

console.log('OK: все проверки clock.js прошли');
