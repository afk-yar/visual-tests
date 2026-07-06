'use strict';
const assert = require('node:assert');
const { smoothNoise, curtainShape } = require('./wave.js');

// Детерминированность: одинаковые входы -> одинаковый выход.
assert.strictEqual(smoothNoise(123.4, 5.6, 2), smoothNoise(123.4, 5.6, 2));
assert.strictEqual(
  JSON.stringify(curtainShape(10, 1, 0)),
  JSON.stringify(curtainShape(10, 1, 0))
);

// Ограниченность: сумма амплитуд слагаемых (0.5+0.3+0.2=1), значит |noise| <= 1
// при любых x, t — это важно для рендера (альфа/высота столбика не должны улетать за диапазон).
for (let i = 0; i < 2000; i++) {
  const x = (Math.random() - 0.5) * 20000;
  const t = (Math.random() - 0.5) * 2000;
  const n = smoothNoise(x, t, 1);
  assert.ok(n >= -1.0001 && n <= 1.0001, `noise вышел за диапазон: ${n}`);
}

// Непрерывность по x: маленький шаг не даёт скачка и не даёт NaN/Infinity —
// без этого столбики занавеса «дёргались» бы на канвасе вместо плавного колыхания.
let prev = smoothNoise(0, 0, 0);
for (let x = 0.1; x <= 50; x += 0.1) {
  const cur = smoothNoise(x, 0, 0);
  assert.ok(Number.isFinite(cur), `не число у x=${x}`);
  assert.ok(Math.abs(cur - prev) < 0.05, `слишком резкий скачок у x=${x}: ${prev} -> ${cur}`);
  prev = cur;
}

// Непрерывность по t (то же самое, но по времени — важно для плавности анимации кадр к кадру).
prev = smoothNoise(500, 0, 0);
for (let t = 0.01; t <= 5; t += 0.01) {
  const cur = smoothNoise(500, t, 0);
  assert.ok(Number.isFinite(cur));
  assert.ok(Math.abs(cur - prev) < 0.05, `слишком резкий скачок по времени у t=${t}`);
  prev = cur;
}

// curtainShape: все три компоненты в диапазоне и конечны; forma реагирует на время (живость),
// но не на месте (детерминизм) — иначе занавес либо был бы статичным, либо хаотичным.
const a = curtainShape(300, 10, 0);
const b = curtainShape(300, 10.5, 0);
for (const key of ['drift', 'height', 'flicker']) {
  assert.ok(Number.isFinite(a[key]) && a[key] >= -1.0001 && a[key] <= 1.0001, `curtainShape.${key} вне диапазона`);
}
assert.notStrictEqual(a.flicker, b.flicker, 'flicker должен меняться во времени (иначе анимация мертва)');

// Разные seed (разные слои-занавесы) должны давать разную форму в одной и той же точке —
// иначе несколько слоёв аврора-занавеса выглядели бы как один слой, наложенный сам на себя.
const layer1 = curtainShape(700, 3, 0);
const layer2 = curtainShape(700, 3, 41.7);
assert.notStrictEqual(layer1.height, layer2.height, 'разные слои не должны совпадать по форме');

console.log('Тесты формы занавеса полярного сияния пройдены.');
