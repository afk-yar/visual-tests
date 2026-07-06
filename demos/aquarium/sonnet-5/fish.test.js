'use strict';
const assert = require('node:assert');
const {
  envelope,
  bodyWave,
  widthProfile,
  buildSpine,
  tailBeatRate,
} = require('./fish.js');

const EPS = 1e-9;

// --- bodyWave: детерминированность (чистая функция, без скрытого состояния) ---
{
  const a = bodyWave(0.6, 1.234, { amplitude: 2, frequency: 1.3, headBias: 0.1 });
  const b = bodyWave(0.6, 1.234, { amplitude: 2, frequency: 1.3, headBias: 0.1 });
  assert.strictEqual(a, b, 'bodyWave должна быть чистой: одинаковые входы -> одинаковый выход');
}

// --- bodyWave: периодичность по фазе (полный оборот 2π возвращает то же смещение) ---
{
  const opts = { amplitude: 1.7, frequency: 1.4, headBias: 0.15 };
  for (const s of [0, 0.05, 0.25, 0.5, 0.75, 1]) {
    for (const phase of [0, 0.8, 2.1, 5.5]) {
      const v1 = bodyWave(s, phase, opts);
      const v2 = bodyWave(s, phase + 2 * Math.PI, opts);
      assert.ok(
        Math.abs(v1 - v2) < 1e-9,
        `bodyWave(s=${s}, phase=${phase}) должна повторяться через 2π: ${v1} vs ${v2}`
      );
    }
  }
}

// --- bodyWave: голова почти неподвижна (envelope(0) === 0 при headBias > 0) ---
{
  const opts = { amplitude: 3, frequency: 1.2, headBias: 0.12 };
  for (const phase of [0, 1, 3.3, 6.28]) {
    // сравнение через === (не assert.strictEqual/Object.is), т.к. envelope(0)=0
    // умноженная на sin(...) может дать -0, что математически равно нулю
    assert.ok(bodyWave(0, phase, opts) === 0, 'у головы (s=0) боковое смещение должно быть нулевым');
  }
}

// --- envelope: монотонно неубывающая огибающая амплитуды от головы к хвосту ---
{
  const headBias = 0.12;
  let prev = -Infinity;
  for (let s = 0; s <= 1.0001; s += 0.02) {
    const e = envelope(Math.min(s, 1), headBias);
    assert.ok(e >= prev - EPS, `envelope должна быть неубывающей: envelope(${s.toFixed(2)})=${e} < prev=${prev}`);
    assert.ok(e >= -EPS && e <= 1 + EPS, 'envelope должна лежать в [0,1]');
    prev = e;
  }
  assert.strictEqual(envelope(0, headBias), 0, 'у самой головы огибающая должна быть 0');
  assert.ok(Math.abs(envelope(1, headBias) - 1) < EPS, 'у самого хвоста огибающая должна достигать 1');
}

// --- widthProfile: неотрицательна, растёт к плечам, затем сужается к хвостовому стеблю ---
{
  const opts = { peakS: 0.32, tailBaseS: 0.86, tailMinRatio: 0.16 };
  const samples = [];
  for (let s = 0; s <= 1.0001; s += 0.02) {
    const w = widthProfile(Math.min(s, 1), opts);
    assert.ok(w >= -EPS, 'ширина тела не должна быть отрицательной');
    samples.push(w);
  }
  const peakIdx = Math.round(opts.peakS / 0.02);
  // до пика — неубывающая
  for (let i = 1; i <= peakIdx; i++) {
    assert.ok(samples[i] >= samples[i - 1] - EPS, 'профиль ширины должен нарастать к плечам');
  }
  // после пика — невозрастающая (до плато хвостового стебля)
  const tailBaseIdx = Math.round(opts.tailBaseS / 0.02);
  for (let i = peakIdx + 1; i <= tailBaseIdx; i++) {
    assert.ok(samples[i] <= samples[i - 1] + EPS, 'профиль ширины должен сужаться к хвостовому стеблю');
  }
  assert.ok(Math.abs(widthProfile(1, opts) - opts.tailMinRatio) < EPS, 'у самого хвоста — ширина стебля tailMinRatio');
}

// --- buildSpine: правильная геометрия (число точек, голова/хвост по x, конечные значения) ---
{
  const cfg = { segments: 20, bodyLength: 10, bodyHeight: 2, frequency: 1.2, headBias: 0.1 };
  const spine = buildSpine(cfg, 0.4);
  assert.strictEqual(spine.length, 21, 'buildSpine должна вернуть segments+1 точек');
  assert.ok(Math.abs(spine[0].x - 5) < EPS, 'первая точка (голова) должна быть на x=+bodyLength/2');
  assert.ok(Math.abs(spine[spine.length - 1].x - -5) < EPS, 'последняя точка (хвост) должна быть на x=-bodyLength/2');
  for (const p of spine) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.w), 'все координаты хребта должны быть конечными числами');
    assert.ok(p.w >= -EPS, 'ширина в каждой точке хребта неотрицательна');
  }
  // x монотонно убывает от головы к хвосту
  for (let i = 1; i < spine.length; i++) {
    assert.ok(spine[i].x < spine[i - 1].x, 'x вдоль хребта должен монотонно убывать от головы к хвосту');
  }
}

// --- buildSpine: детерминированность при одинаковой фазе ---
{
  const cfg = { segments: 12, bodyLength: 4, bodyHeight: 1 };
  const s1 = buildSpine(cfg, 2.5);
  const s2 = buildSpine(cfg, 2.5);
  assert.deepStrictEqual(s1, s2, 'buildSpine должна быть детерминированной при одинаковой фазе/конфиге');
}

// --- tailBeatRate: монотонно растёт со скоростью, не равна нулю в покое ---
{
  const baseFreq = 2;
  let prev = tailBeatRate(0, baseFreq);
  assert.ok(prev > 0, 'в покое хвост всё ещё слегка подрагивает (rate > 0)');
  for (const r of [0.25, 0.5, 0.75, 1, 1.5]) {
    const rate = tailBeatRate(r, baseFreq);
    assert.ok(rate > prev, 'tailBeatRate должна монотонно расти со скоростью');
    prev = rate;
  }
  assert.strictEqual(tailBeatRate(-5, baseFreq), tailBeatRate(0, baseFreq), 'отрицательная скорость клампится к 0');
}

console.log('Тесты кинематики рыбы (fish.js) пройдены.');
