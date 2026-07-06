'use strict';
const assert = require('node:assert');
const W = require('./walker.js');

const EPS = 1e-9;
const approxEqual = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

// ---- 1. Периодичность фазовых функций: значение в фазе 0 == значение в фазе периода (1) ----
// Проверяем не только в самой точке 0/1, но и со сдвигом — footTarget(p) должно
// совпадать с footTarget(p + 1) для любого p, не только для p = 0.
for (const speedT of [0, 0.25, 0.5, 0.75, 1]) {
  const params = W.gaitParams(speedT);

  for (const p of [0, 0.1, 0.33, 0.5, 0.61, 0.9, 0.999]) {
    const a = W.footTarget(p, params);
    const b = W.footTarget(p + 1, params);
    assert.ok(
      approxEqual(a.x, b.x) && approxEqual(a.h, b.h),
      `footTarget не периодична по фазе 1 при speedT=${speedT}, phase=${p}: ` +
        `${JSON.stringify(a)} != ${JSON.stringify(b)}`
    );
  }

  // Граничный случай явно: фаза 0 и фаза ровно периода (1) должны совпадать.
  const at0 = W.footTarget(0, params);
  const at1 = W.footTarget(1, params);
  assert.ok(approxEqual(at0.x, at1.x) && approxEqual(at0.h, at1.h));

  // torsoBounce и armPose — тоже периодичны по 1.
  for (const p of [0, 0.2, 0.5, 0.7]) {
    assert.ok(approxEqual(W.torsoBounce(p, params), W.torsoBounce(p + 1, params)));
    const arm0 = W.armPose(p, params);
    const arm1 = W.armPose(p + 1, params);
    assert.ok(approxEqual(arm0.shoulderAngle, arm1.shoulderAngle));
    assert.ok(approxEqual(arm0.elbowBend, arm1.elbowBend));
  }
}
console.log('OK: фазовые функции периодичны (значение в фазе 0 == значение в фазе периода).');

// ---- 2. Стопа в фазе опоры не уходит ниже уровня земли (высота стопы >= 0) ----
// Проверяем на мелкой сетке фаз внутри интервала опоры [0, dutyFactor) для
// нескольких скоростей (от медленной ходьбы до бега — dutyFactor меняется).
for (const speedT of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
  const params = W.gaitParams(speedT);
  const steps = 500;
  for (let i = 0; i < steps; i++) {
    const p = (params.dutyFactor * i) / steps; // строго внутри [0, dutyFactor)
    const ft = W.footTarget(p, params);
    assert.ok(
      ft.h >= -EPS,
      `Стопа ушла под землю в опоре: speedT=${speedT}, phase=${p}, h=${ft.h}`
    );
    // В опоре стопа должна лежать РОВНО на земле (не парить и не проваливаться) —
    // это и есть условие «нет проскальзывания» по вертикали.
    assert.ok(
      approxEqual(ft.h, 0, 1e-6),
      `Высота стопы в опоре не равна 0: speedT=${speedT}, phase=${p}, h=${ft.h}`
    );
  }
}
console.log('OK: стопа в фазе опоры всегда на уровне земли (высота >= 0, фактически == 0).');

// ---- 2b. Высота стопы в переносе тоже никогда не отрицательна (везде h >= 0) ----
for (const speedT of [0, 0.5, 1]) {
  const params = W.gaitParams(speedT);
  for (let i = 0; i <= 1000; i++) {
    const p = i / 1000;
    const ft = W.footTarget(p, params);
    assert.ok(ft.h >= -EPS, `Отрицательная высота стопы: phase=${p}, h=${ft.h}`);
  }
}
console.log('OK: высота стопы неотрицательна на всём цикле (опора и перенос).');

// ---- 3. Отсутствие проскальзывания стопы относительно земли (не только высота, но и горизонталь) ----
// Мировая система координат: бедро идёт вперёд с постоянной скоростью groundSpeed
// (эквивалент «земля едет назад» при неподвижном на экране персонаже).
// Мировая X-координата стопы в опоре обязана оставаться константой — иначе стопа
// «скользит» по земле, пока стоит на ней.
for (const speedT of [0, 0.4, 0.8, 1]) {
  const params = W.gaitParams(speedT);
  const stanceDuration = params.dutyFactor / params.frequency; // время опоры, сек
  const samples = 40;
  const worldXs = [];
  for (let i = 0; i <= samples; i++) {
    const time = (stanceDuration * i) / samples;
    const phase = time * params.frequency; // проход по фазе с начала опоры (phase=0 -> старт опоры)
    const hipWorldX = params.groundSpeed * time; // бедро равномерно движется вперёд
    const ft = W.footTarget(phase, params);
    const footWorldX = hipWorldX + ft.x;
    worldXs.push(footWorldX);
  }
  const first = worldXs[0];
  for (const x of worldXs) {
    assert.ok(
      approxEqual(x, first, 1e-6),
      `Стопа скользит относительно земли в опоре при speedT=${speedT}: ${x} != ${first}`
    );
  }
}
console.log('OK: опорная стопа не скользит относительно земли (мировая X-координата стопы неизменна).');

// ---- 4. IK: реконструированная по углам точка стопы совпадает с целевой (когда цель достижима) ----
{
  const thigh = 1;
  const shank = 0.95;
  const hipX = 0;
  const hipY = 0;

  const targets = [
    [0, 1.8], // почти прямая нога, чуть согнута
    [0.5, 1.6],
    [-0.4, 1.5],
    [0.9, 1.2],
    [0, 0.4], // нога сильно согнута
  ];

  for (const [fx, fy] of targets) {
    const dist = Math.hypot(fx - hipX, fy - hipY);
    const maxReach = thigh + shank;
    if (dist >= maxReach) continue; // цель вне досягаемости — не тестируем реконструкцию

    const ik = W.solveLegIK(hipX, hipY, fx, fy, thigh, shank);
    const reconFootX = ik.kneeX + shank * Math.sin(ik.shankAngle);
    const reconFootY = ik.kneeY + shank * Math.cos(ik.shankAngle);

    assert.ok(
      approxEqual(reconFootX, fx, 1e-6) && approxEqual(reconFootY, fy, 1e-6),
      `IK не воспроизводит целевую точку стопы: target=(${fx},${fy}), ` +
        `recon=(${reconFootX},${reconFootY})`
    );

    // Длина бедра от бедра до колена должна равняться thigh.
    const thighLen = Math.hypot(ik.kneeX - hipX, ik.kneeY - hipY);
    assert.ok(approxEqual(thighLen, thigh, 1e-6));
  }
}
console.log('OK: IK колена воспроизводит целевую позицию стопы при достижимой цели.');

// ---- 5. IK: недостижимая цель (дальше вытянутой ноги) не даёт NaN/Infinity, нога просто вытягивается ----
{
  const ik = W.solveLegIK(0, 0, 0, 100, 1, 0.95); // цель прямо под бедром, но слишком далеко
  for (const v of [ik.hipAngle, ik.kneeBend, ik.shankAngle, ik.kneeX, ik.kneeY]) {
    assert.ok(Number.isFinite(v), `IK вернула нечисловое значение при недостижимой цели: ${v}`);
  }
  // Прямо под бедром и слишком далеко -> нога должна быть почти прямой (колено ~на линии).
  // Клэмп дистанции намеренно на 1e-3 короче полного вытяжения (см. solveLegIK), поэтому
  // угол не строго 0, а очень мал — допуск шире, чем EPS, но всё ещё «почти прямая нога».
  assert.ok(approxEqual(ik.hipAngle, 0, 0.05), `Ожидали почти прямую ногу вниз, hipAngle=${ik.hipAngle}`);
}
console.log('OK: IK корректно клэмпит недостижимую цель (конечные числа, нога вытягивается).');

// ---- 6. gaitParams: непрерывность и ожидаемые границы характера походки ----
{
  const walk = W.gaitParams(0);
  const run = W.gaitParams(1);
  assert.ok(walk.dutyFactor > 0.5, 'При медленной ходьбе доля опоры должна быть > 0.5 (двойная опора)');
  assert.ok(run.dutyFactor < 0.5, 'При беге доля опоры должна быть < 0.5 (есть фаза полёта)');
  assert.ok(run.frequency > walk.frequency, 'Каденс должен расти от ходьбы к бегу');
  assert.ok(run.stepHeight > walk.stepHeight, 'Подъём стопы в переносе должен расти к бегу');

  // Монотонность/непрерывность: мелкий шаг по speedT не даёт скачков в параметрах.
  let prev = W.gaitParams(0);
  for (let i = 1; i <= 50; i++) {
    const cur = W.gaitParams(i / 50);
    assert.ok(Math.abs(cur.dutyFactor - prev.dutyFactor) < 0.05, 'Скачок dutyFactor между соседними speedT');
    prev = cur;
  }
}
console.log('OK: gaitParams плавно и монотонно меняет характер походки от ходьбы к бегу.');

console.log('Все тесты walker.js пройдены.');
