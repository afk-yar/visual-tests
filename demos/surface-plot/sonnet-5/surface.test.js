'use strict';
const assert = require('node:assert');
const Surface = require('./surface.js');

const EPS = 1e-9;
const EPS_LOOSE = 1e-4;

// ---- heightAt: рябь (ripple) -----------------------------------------------
// r = sqrt(3^2+4^2) = 5 (пифагорова тройка, чтобы r считался без погрешности).
{
  const x = 3, y = 4, t = 0;
  const r = Math.sqrt(x * x + y * y);
  assert.strictEqual(r, 5);
  const expected =
    (Surface.RIPPLE.amplitude * Math.sin(r * Surface.RIPPLE.k - t * Surface.RIPPLE.speed)) /
    (r * Surface.RIPPLE.k + 1);
  const actual = Surface.heightAt('ripple', x, y, t);
  assert.ok(Math.abs(actual - expected) < EPS, `ripple(3,4,0): ${actual} !== ${expected}`);
}
// вторая точка, t != 0, r=0 (центр) — проверяем, что нет NaN/Infinity и формула сходится.
{
  const x = 0, y = 0, t = 2.5;
  const r = 0;
  const expected =
    (Surface.RIPPLE.amplitude * Math.sin(r * Surface.RIPPLE.k - t * Surface.RIPPLE.speed)) /
    (r * Surface.RIPPLE.k + 1);
  const actual = Surface.heightAt('ripple', x, y, t);
  assert.ok(Number.isFinite(actual), 'ripple в центре должна быть конечной величиной');
  assert.ok(Math.abs(actual - expected) < EPS, `ripple(0,0,2.5): ${actual} !== ${expected}`);
}

// ---- heightAt: седло (saddle) ----------------------------------------------
// t=0 => пульсация = 1, значение точное: scale*(x^2-y^2).
{
  const x = 2, y = 1, t = 0;
  const expected = Surface.SADDLE.scale * (x * x - y * y);
  const actual = Surface.heightAt('saddle', x, y, t);
  assert.ok(Math.abs(actual - expected) < EPS, `saddle(2,1,0): ${actual} !== ${expected}`);
}
// t != 0 — проверяем член пульсации.
{
  const x = 2, y = 1, t = 1.3;
  const base = Surface.SADDLE.scale * (x * x - y * y);
  const pulse = 1 + Surface.SADDLE.pulseAmplitude * Math.sin(t * Surface.SADDLE.pulseSpeed);
  const expected = base * pulse;
  const actual = Surface.heightAt('saddle', x, y, t);
  assert.ok(Math.abs(actual - expected) < EPS, `saddle(2,1,1.3): ${actual} !== ${expected}`);
}
// антисимметрия по диагонали: saddle(x,y) === -saddle(y,x) при t=0.
{
  const t = 0;
  const a = Surface.heightAt('saddle', 2, 1, t);
  const b = Surface.heightAt('saddle', 1, 2, t);
  assert.ok(Math.abs(a + b) < EPS, 'saddle(2,1) должно быть = -saddle(1,2) при t=0');
}

// ---- heightAt: гауссиана (gaussian) ----------------------------------------
// В центре (0,0) при t=0 пульсация=1, exp(0)=1 => значение равно амплитуде ровно.
{
  const actual = Surface.heightAt('gaussian', 0, 0, 0);
  assert.ok(
    Math.abs(actual - Surface.GAUSSIAN.amplitude) < EPS,
    `gaussian(0,0,0): ${actual} !== ${Surface.GAUSSIAN.amplitude}`
  );
}
// произвольная точка с ненулевым t.
{
  const x = 0.6, y = -0.3, t = 0.8;
  const r2 = x * x + y * y;
  const base = Surface.GAUSSIAN.amplitude * Math.exp(-r2 / (2 * Surface.GAUSSIAN.sigma * Surface.GAUSSIAN.sigma));
  const pulse = 1 + Surface.GAUSSIAN.pulseAmplitude * Math.sin(t * Surface.GAUSSIAN.pulseSpeed);
  const expected = base * pulse;
  const actual = Surface.heightAt('gaussian', x, y, t);
  assert.ok(Math.abs(actual - expected) < EPS, `gaussian(0.6,-0.3,0.8): ${actual} !== ${expected}`);
}

// ---- heightAt: неизвестный режим бросает ошибку ----------------------------
assert.throws(() => Surface.heightAt('unknown', 0, 0, 0), /неизвестный режим/);

// ---- computeNormal: синтетический случай без heightAt (ручная проверка) ---
// hLeft=1, hRight=3, hDown=2, hUp=2, step=0.5
// dz/dx = (3-1)/(2*0.5) = 2 ; dz/dy = (2-2)/(2*0.5) = 0
// нормаль (ненормированная) = (-2, 0, 1), длина = sqrt(5)
{
  const n = Surface.computeNormal(1, 3, 2, 2, 0.5);
  const len = Math.sqrt(5);
  assert.ok(Math.abs(n.x - -2 / len) < EPS, `normal.x: ${n.x}`);
  assert.ok(Math.abs(n.y - 0) < EPS, `normal.y: ${n.y}`);
  assert.ok(Math.abs(n.z - 1 / len) < EPS, `normal.z: ${n.z}`);
  const mag = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
  assert.ok(Math.abs(mag - 1) < EPS, 'нормаль должна быть единичной');
}

// ---- computeNormal: седло — центральная разность ТОЧНА для квадратичной функции
// h(x,y) = scale*(x^2 - y^2). dz/dx = 2*scale*x (точно), dz/dy = -2*scale*y (точно) —
// для параболы центральная разность не содержит погрешности усечения.
{
  const x = 1, y = 0.5, t = 0, step = 0.01;
  const hLeft = Surface.heightAt('saddle', x - step, y, t);
  const hRight = Surface.heightAt('saddle', x + step, y, t);
  const hDown = Surface.heightAt('saddle', x, y - step, t);
  const hUp = Surface.heightAt('saddle', x, y + step, t);
  const n = Surface.computeNormal(hLeft, hRight, hDown, hUp, step);

  const dzdx = 2 * Surface.SADDLE.scale * x;
  const dzdy = -2 * Surface.SADDLE.scale * y;
  const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
  const expected = { x: -dzdx / len, y: -dzdy / len, z: 1 / len };

  assert.ok(Math.abs(n.x - expected.x) < EPS, `saddle normal.x: ${n.x} !== ${expected.x}`);
  assert.ok(Math.abs(n.y - expected.y) < EPS, `saddle normal.y: ${n.y} !== ${expected.y}`);
  assert.ok(Math.abs(n.z - expected.z) < EPS, `saddle normal.z: ${n.z} !== ${expected.z}`);
}

// ---- computeNormal: гауссиана — приближение конечной разностью с допуском ---
{
  const x = 0.3, y = -0.2, t = 0.5, step = 0.0005;
  const hLeft = Surface.heightAt('gaussian', x - step, y, t);
  const hRight = Surface.heightAt('gaussian', x + step, y, t);
  const hDown = Surface.heightAt('gaussian', x, y - step, t);
  const hUp = Surface.heightAt('gaussian', x, y + step, t);
  const n = Surface.computeNormal(hLeft, hRight, hDown, hUp, step);

  const r2 = x * x + y * y;
  const sigma2 = Surface.GAUSSIAN.sigma * Surface.GAUSSIAN.sigma;
  const base = Surface.GAUSSIAN.amplitude * Math.exp(-r2 / (2 * sigma2));
  const pulse = 1 + Surface.GAUSSIAN.pulseAmplitude * Math.sin(t * Surface.GAUSSIAN.pulseSpeed);
  // dz/dx = base*(-x/sigma^2)*pulse ; dz/dy аналогично по y.
  const dzdx = base * (-x / sigma2) * pulse;
  const dzdy = base * (-y / sigma2) * pulse;
  const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
  const expected = { x: -dzdx / len, y: -dzdy / len, z: 1 / len };

  assert.ok(Math.abs(n.x - expected.x) < EPS_LOOSE, `gaussian normal.x: ${n.x} !== ${expected.x}`);
  assert.ok(Math.abs(n.y - expected.y) < EPS_LOOSE, `gaussian normal.y: ${n.y} !== ${expected.y}`);
  assert.ok(Math.abs(n.z - expected.z) < EPS_LOOSE, `gaussian normal.z: ${n.z} !== ${expected.z}`);
}

// ---- projectPoint: A — камера без поворота и без наклона (тождественная) ---
// точка (1,0,0), camera={angle:0, tilt:0, distance:5, fov:500, width:800, height:600}
// scale = 500/(5+0) = 100 ; sx = 400+1*100=500 ; sy=300-0=300 ; depth=0
{
  const camera = { angle: 0, tilt: 0, distance: 5, fov: 500, width: 800, height: 600 };
  const p = Surface.projectPoint(1, 0, 0, camera);
  assert.ok(Math.abs(p.x - 500) < EPS, `A.x: ${p.x}`);
  assert.ok(Math.abs(p.y - 300) < EPS, `A.y: ${p.y}`);
  assert.ok(Math.abs(p.depth - 0) < EPS, `A.depth: ${p.depth}`);
}

// ---- projectPoint: B — поворот камеры на 90° переносит X в глубину (Z) ------
// точка (1,0,0), angle=PI/2, tilt=0 => x1≈0, z1=1 => depth=1, sx≈400 (центр)
{
  const camera = { angle: Math.PI / 2, tilt: 0, distance: 5, fov: 500, width: 800, height: 600 };
  const p = Surface.projectPoint(1, 0, 0, camera);
  assert.ok(Math.abs(p.x - 400) < 1e-6, `B.x: ${p.x}`);
  assert.ok(Math.abs(p.y - 300) < EPS, `B.y: ${p.y}`);
  assert.ok(Math.abs(p.depth - 1) < EPS, `B.depth: ${p.depth}`);
}

// ---- projectPoint: C — наклон камеры 60° поднимает высоту в глубину ---------
// точка (0,2,0) [высота=2], angle=0, tilt=PI/3 (60°): cos60=0.5, sin60=sqrt(3)/2
// y2 = 2*0.5 - 0 = 1 ; z2 = 2*(sqrt(3)/2) + 0 = sqrt(3)
// denom = 5+sqrt(3) ; scale = 500/denom ; sy = 300 - 1*scale ; sx=400
{
  const camera = { angle: 0, tilt: Math.PI / 3, distance: 5, fov: 500, width: 800, height: 600 };
  const p = Surface.projectPoint(0, 2, 0, camera);
  const z2 = Math.sqrt(3);
  const scale = 500 / (5 + z2);
  const expectedY = 300 - 1 * scale;
  assert.ok(Math.abs(p.x - 400) < EPS, `C.x: ${p.x}`);
  assert.ok(Math.abs(p.y - expectedY) < 1e-6, `C.y: ${p.y} !== ${expectedY}`);
  assert.ok(Math.abs(p.depth - z2) < 1e-9, `C.depth: ${p.depth} !== ${z2}`);
}

console.log('Тесты surface.js (высота/нормаль/проекция) пройдены.');
