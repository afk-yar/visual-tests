'use strict';
// node demos/boids/fable-5/boids.test.js
const assert = require('node:assert');
const B = require('./boids.js');

const W = 800, H = 600;

// Детерминированный ГПСЧ для воспроизводимости.
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function params(overrides) {
  return Object.assign({}, B.DEFAULTS, overrides);
}

// 1. Тороидальная разность: кратчайший путь через край.
{
  assert.strictEqual(B.torusDelta(10, 790, 800), -20, 'через левый край');
  assert.strictEqual(B.torusDelta(790, 10, 800), 20, 'через правый край');
  assert.strictEqual(B.torusDelta(100, 300, 800), 200, 'обычный случай');
}

// 2. Сетка находит тех же соседей, что и наивный перебор.
{
  const rnd = lcg(42);
  const boids = [];
  for (let i = 0; i < 300; i++) {
    boids.push({ x: rnd() * W, y: rnd() * H, vx: rnd() * 100 - 50, vy: rnd() * 100 - 50 });
  }
  const r = 70;
  const grid = B.buildGrid(boids, r, W, H);
  for (let i = 0; i < boids.length; i += 7) {
    const a = B.neighborsOf(i, boids, grid, r, W, H).sort((x, y) => x - y);
    const b = B.neighborsNaive(i, boids, r, W, H).sort((x, y) => x - y);
    assert.deepStrictEqual(a, b, `соседи различаются для боида ${i}`);
  }
}

// 3. Далёкие боиды не влияют друг на друга.
{
  const boids = [
    { x: 100, y: 100, vx: 100, vy: 0 },
    { x: 400, y: 300, vx: -100, vy: 0 },
  ];
  const next = B.step(boids, params({}), W, H, 0.016);
  assert.strictEqual(next[0].vx, 100, 'скорость изменилась без соседей');
  assert.strictEqual(next[0].vy, 0);
}

// 4. Разделение: два близких боида расталкиваются.
{
  const boids = [
    { x: 400, y: 300, vx: 0, vy: 100 },
    { x: 410, y: 300, vx: 0, vy: 100 },
  ];
  const p = params({ aliWeight: 0, cohWeight: 0, minSpeed: 0 });
  let cur = boids;
  for (let i = 0; i < 30; i++) cur = B.step(cur, p, W, H, 0.016);
  const d0 = Math.abs(B.torusDelta(boids[0].x, boids[1].x, W));
  const d1 = Math.abs(B.torusDelta(cur[0].x, cur[1].x, W));
  assert.ok(d1 > d0, `не растолкнулись: ${d0} -> ${d1}`);
}

// 5. Выравнивание: направления скоростей сближаются.
{
  const boids = [
    { x: 390, y: 300, vx: 100, vy: 50 },
    { x: 430, y: 300, vx: 100, vy: -50 },
  ];
  const p = params({ sepWeight: 0, cohWeight: 0, sepRadius: 0 });
  let cur = boids;
  for (let i = 0; i < 60; i++) cur = B.step(cur, p, W, H, 0.016);
  const angle = (b) => Math.atan2(b.vy, b.vx);
  const before = Math.abs(angle(boids[0]) - angle(boids[1]));
  const after = Math.abs(angle(cur[0]) - angle(cur[1]));
  assert.ok(after < before * 0.5, `направления не сблизились: ${before} -> ${after}`);
}

// 6. Сцепление: боиды сближаются.
{
  const boids = [
    { x: 370, y: 300, vx: 0, vy: 80 },
    { x: 430, y: 300, vx: 0, vy: 80 },
  ];
  const p = params({ sepWeight: 0, aliWeight: 0, sepRadius: 0, minSpeed: 0 });
  let cur = boids;
  for (let i = 0; i < 40; i++) cur = B.step(cur, p, W, H, 0.016);
  const d0 = Math.abs(B.torusDelta(boids[0].x, boids[1].x, W));
  const d1 = Math.abs(B.torusDelta(cur[0].x, cur[1].x, W));
  assert.ok(d1 < d0, `не сблизились: ${d0} -> ${d1}`);
}

// 7. Скорость всегда в пределах [minSpeed, maxSpeed]; координаты в мире.
{
  const rnd = lcg(7);
  let boids = [];
  for (let i = 0; i < 200; i++) {
    boids.push({ x: rnd() * W, y: rnd() * H, vx: rnd() * 400 - 200, vy: rnd() * 400 - 200 });
  }
  const p = params({});
  for (let t = 0; t < 120; t++) boids = B.step(boids, p, W, H, 0.016);
  for (const b of boids) {
    const s = Math.hypot(b.vx, b.vy);
    assert.ok(s <= p.maxSpeed + 1e-9, `скорость выше предела: ${s}`);
    assert.ok(s >= p.minSpeed - 1e-9, `скорость ниже предела: ${s}`);
    assert.ok(b.x >= 0 && b.x < W && b.y >= 0 && b.y < H, `вышел из мира: ${b.x}, ${b.y}`);
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.vx), 'NaN в состоянии');
  }
}

console.log('boids.test.js: все тесты пройдены');
