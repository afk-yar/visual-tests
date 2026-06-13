'use strict';
// node demos/procedural-walker/opus-4.8/gait.test.js
const assert = require('node:assert');
const G = require('./gait.js');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }

// 1. IK: для достижимой цели длины звеньев сохраняются точно.
{
  const l1 = 46, l2 = 42;
  const targets = [[10, 70], [-25, 60], [35, 50], [0, 80], [-40, 30], [40, 40]];
  for (const [tx, ty] of targets) {
    const r = G.solveIK(0, 0, tx, ty, l1, l2, 1);
    const d1 = Math.hypot(r.jointX, r.jointY);
    const d2 = Math.hypot(r.endX - r.jointX, r.endY - r.jointY);
    ok(Math.abs(d1 - l1) < 1e-6, `|корень→сустав|=${d1} ≠ ${l1} для цели (${tx},${ty})`);
    ok(Math.abs(d2 - l2) < 1e-6, `|сустав→конец|=${d2} ≠ ${l2} для цели (${tx},${ty})`);
    // Конец совпал с целью (цель достижима).
    ok(Math.hypot(r.endX - tx, r.endY - ty) < 1e-6, `конец не на цели (${tx},${ty})`);
  }
}

// 2. IK: недостижимая цель (дальше l1+l2) — нога вытянута строго к цели.
{
  const l1 = 46, l2 = 42, reachMax = l1 + l2;
  for (const [tx, ty] of [[0, 200], [150, 0], [100, 100]]) {
    const r = G.solveIK(0, 0, tx, ty, l1, l2, 1);
    const reach = Math.hypot(r.endX, r.endY);
    ok(reach <= reachMax + 1e-6 && reach > reachMax - 1e-3,
      `конец не на максимуме вытяжения: ${reach} vs ${reachMax}`);
    // Сустав на линии корень→цель (нога прямая): синус отклонения ~ 0.
    const cross = r.jointX * ty - r.jointY * tx;
    const sinDev = Math.abs(cross) / (l1 * Math.hypot(tx, ty));
    ok(sinDev < 1e-3, `нога не выпрямлена к цели: sinDev=${sinDev}`);
    // И конец смотрит в ту же сторону, что и цель.
    const dot = r.endX * tx + r.endY * ty;
    ok(dot > 0, `конец вытянут в противоположную от цели сторону`);
  }
}

// 3. IK: сустав гнётся в анатомически верную сторону по знаку bend.
{
  // Цель прямо под корнем, нога согнута → сустав уходит в +x при bend=+1,
  // в -x при bend=-1, симметрично.
  const fwd = G.solveIK(0, 0, 0, 70, 46, 42, 1);
  const back = G.solveIK(0, 0, 0, 70, 46, 42, -1);
  ok(fwd.jointX > 1, `колено не вперёд при bend=+1: ${fwd.jointX}`);
  ok(back.jointX < -1, `колено не назад при bend=-1: ${back.jointX}`);
  ok(Math.abs(fwd.jointX + back.jointX) < 1e-9, `сгиб несимметричен: ${fwd.jointX}, ${back.jointX}`);
  ok(Math.abs(fwd.jointY - back.jointY) < 1e-9, `высота сустава различается при ±bend`);
}

// 4. Фаза опоры: стопа на земле (h=0) и едет строго равномерно назад.
{
  const duty = 0.6, stepLen = 90, lift = 24;
  const samples = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const f = G.footPosition((i / N) * duty * 0.999, duty, stepLen, lift);
    assert.strictEqual(f.h, 0, 'стопа оторвалась от земли в фазе опоры');
    samples.push(f.x);
  }
  const dx0 = samples[1] - samples[0];
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i] - samples[i - 1];
    ok(Math.abs(d - dx0) < 1e-9, `скорость опоры неравномерна: шаг ${d} vs ${dx0}`);
  }
  ok(dx0 < 0, 'в опоре стопа должна ехать назад относительно таза');
  passed += N + 1;
}

// 5. ГЛАВНОЕ: стопа в фазе опоры НЕ скользит относительно земли.
//    Земля и стопа в мире смещаются на -speed*t; таз стоит по x.
//    Мировая x стопы = footX(phase) (таз в нуле), мировая x земли = -speed*t.
//    Требование: footX(phase) едет назад ровно со скоростью земли (-speed),
//    т.е. их разность (положение стопы ОТНОСИТЕЛЬНО земли) постоянна.
{
  for (const speed of [60, 140, 260, 400]) {
    const g = G.gaitParams(speed);
    // Скорость прокрутки земли = speed (px/с) влево.
    const footWorld = (t) => {
      const phase = (t / g.T) % 1;
      return G.footPosition(phase, g.duty, g.stepLen, g.lift).x; // таз в x=0
    };
    const groundWorld = (t) => -speed * t;
    const footRelGround = (t) => footWorld(t) - groundWorld(t);

    // Несколько моментов строго внутри одной фазы опоры phase ∈ [0,duty).
    const ts = [0.02, 0.25, 0.5, 0.75, 0.98].map((f) => f * g.duty * g.T);
    const ref = footRelGround(ts[0]);
    for (const t of ts) {
      const drift = Math.abs(footRelGround(t) - ref);
      ok(drift < 1e-6, `проскальзывание стопы по земле speed=${speed}: drift=${drift}`);
    }
    // И прямая проверка: мгновенная горизонтальная скорость стопы = -speed.
    const dt = 1e-4;
    const t0 = 0.4 * g.duty * g.T;
    const vFoot = (footWorld(t0 + dt) - footWorld(t0 - dt)) / (2 * dt);
    ok(Math.abs(vFoot - (-speed)) < 1e-3,
      `скорость стопы в опоре ${vFoot} ≠ -${speed}`);
  }
}

// 6. Левая и правая ноги в противофазе (сдвиг ровно на полпериода).
{
  const duty = 0.6, stepLen = 90, lift = 24;
  for (const ph of [0.0, 0.13, 0.37, 0.62, 0.81]) {
    const left = G.footPosition(ph, duty, stepLen, lift);
    const right = G.footPosition(ph + 0.5, duty, stepLen, lift);
    const rightAlt = G.footPosition((ph + 0.5) % 1, duty, stepLen, lift);
    ok(Math.abs(right.x - rightAlt.x) < 1e-12 && Math.abs(right.h - rightAlt.h) < 1e-12,
      'противофаза должна быть периодична по 1');
    // В типичной ходьбе (duty>0.5) одновременно обе ноги не в переносе:
    // хотя бы одна на земле (двойная опора), что и даёт устойчивость.
    if (duty > 0.5) {
      ok(left.h === 0 || right.h === 0, `обе стопы в воздухе при duty>0.5, ph=${ph}`);
    }
  }
}

// 7. Непрерывность траектории стопы на стыках фаз (нет рывка/телепорта).
{
  const duty = 0.55, stepLen = 80, lift = 22, eps = 1e-6;
  const a = G.footPosition(duty - eps, duty, stepLen, lift);
  const b = G.footPosition(duty + eps, duty, stepLen, lift);
  ok(Math.abs(a.x - b.x) < 1e-3, `разрыв x при отрыве: ${a.x} vs ${b.x}`);
  ok(a.h === 0 && b.h < 1e-3, `подъём не от нуля: a.h=${a.h}, b.h=${b.h}`);
  const c = G.footPosition(1 - eps, duty, stepLen, lift);
  const d = G.footPosition(0, duty, stepLen, lift);
  ok(Math.abs(c.x - d.x) < 1e-3, `разрыв x при приземлении: ${c.x} vs ${d.x}`);
  ok(c.h < 1e-3 && d.h === 0, `приземление с высоты: c.h=${c.h}`);
}

// 8. Характер походки плавно меняется со скоростью: ходьба → бег.
{
  const slow = G.gaitParams(60);
  const mid = G.gaitParams(200);
  const fast = G.gaitParams(400);
  ok(fast.T < mid.T && mid.T < slow.T, 'период должен монотонно падать');
  ok(fast.duty < mid.duty && mid.duty < slow.duty, 'доля опоры должна падать');
  ok(fast.stepLen > slow.stepLen, 'шаг должен удлиняться');
  ok(fast.lean > slow.lean, 'наклон корпуса должен расти');
  ok(fast.bounce > slow.bounce, 'вертикальное качание должно расти');
  ok(slow.duty > 0.5, 'медленная ходьба: фазы опоры перекрываются (duty>0.5)');
  ok(fast.duty < 0.5, 'бег: должна быть фаза полёта (duty<0.5)');
  // Инвариант отсутствия проскальзывания должен держаться на всех скоростях.
  for (const sp of [60, 200, 400]) {
    const g = G.gaitParams(sp);
    ok(Math.abs(g.stepLen - sp * g.T * g.duty) < 1e-9,
      `нарушен инвариант stepLen=speed*T*duty при speed=${sp}`);
  }
}

console.log(`gait.test.js: все тесты пройдены (${passed} проверок)`);
