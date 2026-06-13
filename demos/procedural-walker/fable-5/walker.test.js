'use strict';
// node demos/procedural-walker/fable-5/walker.test.js
const assert = require('node:assert');
const W = require('./walker.js');

// 1. IK: длины сегментов сохраняются для досягаемой цели.
{
  const l1 = 40, l2 = 38;
  for (const [fx, fy] of [[10, 70], [-20, 60], [30, 50], [0, 77.9]]) {
    const r = W.solveLegIK(0, 0, fx, fy, l1, l2, 1);
    const d1 = Math.hypot(r.kneeX, r.kneeY);
    const d2 = Math.hypot(r.footX - r.kneeX, r.footY - r.kneeY);
    assert.ok(Math.abs(d1 - l1) < 1e-6, `бедро ${d1} != ${l1} для цели (${fx},${fy})`);
    assert.ok(Math.abs(d2 - l2) < 1e-6, `голень ${d2} != ${l2} для цели (${fx},${fy})`);
  }
}

// 2. IK: недосягаемая цель — нога выпрямлена в сторону цели.
{
  const r = W.solveLegIK(0, 0, 0, 200, 40, 38, 1);
  const reach = Math.hypot(r.footX, r.footY);
  assert.ok(reach <= 78 + 1e-6, `стопа дальше вытянутой ноги: ${reach}`);
  // Колено практически на линии таз-стопа (угол отклонения < 0.5°).
  const cross = r.kneeX * r.footY - r.kneeY * r.footX;
  const sinAngle = Math.abs(cross) / (40 * reach);
  assert.ok(sinAngle < 0.01, `нога не прямая: отклонение sin=${sinAngle}`);
}

// 3. IK: сторона сгиба колена соответствует kneeDir.
{
  // Стопа прямо под тазом, нога согнута: колено должно уйти в +x при dir=+1.
  const fwd = W.solveLegIK(0, 0, 0, 60, 40, 38, 1);
  const back = W.solveLegIK(0, 0, 0, 60, 40, 38, -1);
  assert.ok(fwd.kneeX > 1, `колено не вперёд: ${fwd.kneeX}`);
  assert.ok(back.kneeX < -1, `колено не назад: ${back.kneeX}`);
}

// 4. Опора: стопа на земле (h=0) и движется строго равномерно.
{
  const duty = 0.6, stepLen = 80, lift = 20;
  const dx = [];
  for (let i = 0; i < 10; i++) {
    const p1 = (i / 10) * duty, p2 = ((i + 1) / 10) * duty;
    const f1 = W.footPosition(p1, duty, stepLen, lift);
    const f2 = W.footPosition(p2, duty, stepLen, lift);
    assert.strictEqual(f1.h, 0, 'стопа оторвалась в опоре');
    dx.push(f2.x - f1.x);
  }
  for (const d of dx) {
    assert.ok(Math.abs(d - dx[0]) < 1e-9, `скорость опоры неравномерна: ${dx}`);
  }
  assert.ok(dx[0] < 0, 'в опоре стопа должна ехать назад относительно таза');
}

// 5. Непрерывность траектории стопы на стыках фаз.
{
  const duty = 0.55, stepLen = 70, lift = 18;
  const eps = 1e-6;
  const a = W.footPosition(duty - eps, duty, stepLen, lift);
  const b = W.footPosition(duty + eps, duty, stepLen, lift);
  assert.ok(Math.abs(a.x - b.x) < 1e-3, `разрыв x на отрыве: ${a.x} vs ${b.x}`);
  assert.ok(b.h < 1e-3, `подъём не с нуля: ${b.h}`);
  const c = W.footPosition(1 - eps, duty, stepLen, lift);
  const d = W.footPosition(0, duty, stepLen, lift);
  assert.ok(Math.abs(c.x - d.x) < 1e-3, `разрыв x на приземлении: ${c.x} vs ${d.x}`);
  assert.ok(c.h < 1e-3, `приземление с высоты: ${c.h}`);
}

// 6. ГЛАВНОЕ — стопа в опоре неподвижна в мировой системе.
// Таз летит вперёд со скоростью v; мировая позиция стопы = v*t + foot.x(phase).
{
  for (const speed of [80, 200, 380]) {
    const g = W.gaitParams(speed);
    const worldX = (t) => {
      const phase = (t / g.T) % 1;
      return speed * t + W.footPosition(phase, g.duty, g.stepLen, g.lift).x;
    };
    // Берём моменты внутри одной фазы опоры (phase ∈ [0, duty)).
    const t0 = 0.01 * g.T, t1 = 0.3 * g.duty * g.T, t2 = 0.9 * g.duty * g.T;
    const x0 = worldX(t0), x1 = worldX(t1), x2 = worldX(t2);
    assert.ok(Math.abs(x1 - x0) < 1e-6, `стопа скользит (speed=${speed}): ${x1 - x0}`);
    assert.ok(Math.abs(x2 - x0) < 1e-6, `стопа скользит (speed=${speed}): ${x2 - x0}`);
  }
}

// 7. Характер походки меняется со скоростью: каденс растёт, опора короче.
{
  const slow = W.gaitParams(80);
  const fast = W.gaitParams(380);
  assert.ok(fast.T < slow.T, 'период не сократился');
  assert.ok(fast.duty < slow.duty, 'доля опоры не упала');
  assert.ok(fast.stepLen > slow.stepLen, 'шаг не удлинился');
  assert.ok(fast.lean > slow.lean, 'наклон не вырос');
  assert.ok(fast.duty < 0.5, 'при беге должна быть фаза полёта (duty < 0.5)');
  assert.ok(slow.duty > 0.5, 'при ходьбе фазы опоры перекрываются (duty > 0.5)');
}

console.log('walker.test.js: все тесты пройдены');
