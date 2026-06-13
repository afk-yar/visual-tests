'use strict';
const assert = require('node:assert');
const {
  torusDelta, wrap, limit, neighbors, neighborsNaive, buildGrid,
  acceleration, step, SEP_FRACTION, MIN_SPEED_FRACTION,
} = require('./boids.js');

const W = 1000, H = 800;

// A. Тороидальная дельта берёт кратчайший путь через край.
{
  // Точки у противоположных краёв: «прямой» путь 900, через край — 100.
  assert.strictEqual(torusDelta(950, 50, W), 100, 'дельта вправо через правый край = +100');
  assert.strictEqual(torusDelta(50, 950, W), -100, 'дельта влево через левый край = -100');
  // Внутри без обёртки — обычная разность.
  assert.strictEqual(torusDelta(100, 300, W), 200, 'внутри домена — обычная разность');
  // Ровно половина — берётся положительная ветвь, |delta| <= size/2.
  assert.ok(Math.abs(torusDelta(0, H / 2, H)) === H / 2, 'граница ровно size/2');
}

// B. Разделение отталкивает от близкого соседа (ускорение направлено ОТ него).
{
  const boids = [
    { x: 500, y: 400, vx: 0, vy: 0 },
    { x: 510, y: 400, vx: 0, vy: 0 }, // сосед справа, очень близко
  ];
  const params = { sep: 1, ali: 0, coh: 0, perception: 100, maxSpeed: 200, w: W, h: H };
  const { ax, ay } = acceleration(0, boids, [1], params);
  assert.ok(ax < 0, `разделение должно толкать влево (от соседа справа), ax=${ax}`);
  assert.ok(Math.abs(ay) < 1e-9, `по вертикали отталкивания нет, ay=${ay}`);

  // Чем ближе сосед, тем сильнее отталкивание.
  const far = [{ x: 500, y: 400, vx: 0, vy: 0 }, { x: 540, y: 400, vx: 0, vy: 0 }];
  const aFar = acceleration(0, far, [1], params);
  assert.ok(Math.abs(ax) > Math.abs(aFar.ax), 'ближний сосед отталкивает сильнее дальнего');

  // Разделение работает только внутри доли SEP_FRACTION радиуса восприятия.
  const sepR = params.perception * SEP_FRACTION; // 50
  const outside = [{ x: 500, y: 400, vx: 0, vy: 0 }, { x: 500 + sepR + 5, y: 400, vx: 0, vy: 0 }];
  const aOut = acceleration(0, outside, [1], params);
  assert.ok(Math.abs(aOut.ax) < 1e-9, 'за пределами sepRadius разделения нет');
}

// C. Выравнивание тянет скорость к средней скорости соседей.
{
  // Сам стоит; два соседа летят вправо со скоростью 100 → рулёж вправо.
  const boids = [
    { x: 500, y: 400, vx: 0, vy: 0 },
    { x: 480, y: 400, vx: 100, vy: 0 },
    { x: 520, y: 400, vx: 100, vy: 0 },
  ];
  const params = { sep: 0, ali: 1, coh: 0, perception: 100, maxSpeed: 200, w: W, h: H };
  const { ax, ay } = acceleration(0, boids, [1, 2], params);
  assert.ok(ax > 0, `выравнивание тянет к средней скорости соседей (вправо), ax=${ax}`);
  assert.ok(Math.abs(ay) < 1e-9, `средняя вертикальная скорость соседей = 0, ay=${ay}`);

  // Если уже летит со средней скоростью соседей — рулёж нулевой.
  const matched = [
    { x: 500, y: 400, vx: 100, vy: 0 },
    { x: 480, y: 400, vx: 100, vy: 0 },
    { x: 520, y: 400, vx: 100, vy: 0 },
  ];
  const aMatched = acceleration(0, matched, [1, 2], params);
  assert.ok(Math.abs(aMatched.ax) < 1e-9 && Math.abs(aMatched.ay) < 1e-9,
    'совпал со средней скоростью — выравнивание не рулит');
}

// C2. Сцепление тянет к центру масс соседей (через тороидальную дельту, в т.ч. за краем).
{
  // Сосед у левого края, сам у правого: центр масс «короче» через край → тянет вправо.
  const boids = [
    { x: 990, y: 400, vx: 0, vy: 0 },
    { x: 10, y: 400, vx: 0, vy: 0 },
  ];
  const params = { sep: 0, ali: 0, coh: 1, perception: 100, maxSpeed: 200, w: W, h: H };
  const { ax } = acceleration(0, boids, [1], params);
  assert.ok(ax > 0, `сцепление через правый край тянет вправо (короткий путь), ax=${ax}`);
}

// D. Ограничение скорости: после шага |v| не превышает maxSpeed.
{
  const boids = [];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 500; i++) {
    boids.push({ x: rnd() * W, y: rnd() * H, vx: (rnd() - 0.5) * 600, vy: (rnd() - 0.5) * 600 });
  }
  const params = { sep: 1.5, ali: 1, coh: 1, perception: 60, maxSpeed: 180, w: W, h: H };
  const minSpeed = params.maxSpeed * MIN_SPEED_FRACTION;
  for (let f = 0; f < 30; f++) step(boids, params, 1 / 60);
  for (const b of boids) {
    const sp = Math.hypot(b.vx, b.vy);
    assert.ok(sp <= params.maxSpeed + 1e-6, `скорость превысила max: ${sp} > ${params.maxSpeed}`);
    assert.ok(sp >= minSpeed - 1e-6, `скорость ниже min: ${sp} < ${minSpeed}`);
    // E. После шага все агенты внутри тора [0,w)×[0,h) (wrap через края).
    assert.ok(b.x >= 0 && b.x < W && b.y >= 0 && b.y < H,
      `агент вне тора: (${b.x}, ${b.y})`);
  }
}

// F. Сетка соседей эквивалентна наивному поиску, включая обёртку через края.
{
  const boids = [];
  let seed = 777;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 300; i++) {
    boids.push({ x: rnd() * W, y: rnd() * H, vx: 0, vy: 0 });
  }
  const r = 70;
  const grid = buildGrid(boids, Math.max(r, 8), W, H);
  let checked = 0, crossEdge = 0;
  for (let i = 0; i < boids.length; i++) {
    const a = neighbors(i, boids, grid, r).slice().sort((p, q) => p - q);
    const want = neighborsNaive(i, boids, r, W, H).slice().sort((p, q) => p - q);
    assert.deepStrictEqual(a, want, `сетка != наив для боида ${i}`);
    checked++;
    // Считаем боидов у края для подтверждения, что wrap реально проверен.
    if (boids[i].x < r || boids[i].x > W - r || boids[i].y < r || boids[i].y > H - r) crossEdge++;
  }
  assert.ok(crossEdge > 0, 'тест должен включать приграничные боиды (проверка wrap)');
  console.log(`сетка == наив для ${checked} боидов (${crossEdge} приграничных)`);
}

// G. limit() обрезает вектор до max, не трогая направление.
{
  const r = limit(30, 40, 25); // |(30,40)|=50 → масштаб 0.5
  assert.ok(Math.abs(Math.hypot(r.x, r.y) - 25) < 1e-9, 'limit обрезает модуль до max');
  assert.ok(Math.abs(r.x / r.y - 30 / 40) < 1e-9, 'limit сохраняет направление');
  const keep = limit(3, 4, 100); // короче max — не трогаем
  assert.deepStrictEqual(keep, { x: 3, y: 4 }, 'короткий вектор не масштабируется');
}

// H. wrap() приводит координату в [0, size) с обоих направлений.
{
  assert.strictEqual(wrap(-10, 100), 90, 'отрицательная обёртка');
  assert.strictEqual(wrap(110, 100), 10, 'обёртка за правый край');
  assert.strictEqual(wrap(100, 100), 0, 'ровно size → 0');
  assert.strictEqual(wrap(50, 100), 50, 'внутри домена без изменений');
}

console.log('Все тесты boids пройдены.');
