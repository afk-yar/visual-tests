'use strict';
// node demos/mandelbrot/fable-5/mandelbrot.test.js
const assert = require('node:assert');
const M = require('./mandelbrot.js');

// 1. Точки внутри множества не уходят на бесконечность.
{
  assert.strictEqual(M.escapeTime(0, 0, 500), -1, 'c=0 внутри множества');
  assert.strictEqual(M.escapeTime(-1, 0, 500), -1, 'c=-1 внутри множества');
  assert.strictEqual(M.escapeTime(-1.75, 0, 2000), -1, 'c=-1.75 на главной антенне');
}

// 2. Точки снаружи уходят быстро, mu растёт по мере приближения к границе.
{
  const far = M.escapeTime(2, 2, 500);
  assert.ok(far >= 0 && far < 5, `далёкая точка должна уйти быстро: ${far}`);
  const near = M.escapeTime(-0.75, 0.11, 500); // около щели между кардиоидой и кругом
  assert.ok(near > far, `ближе к границе итераций больше: ${near} > ${far}`);
}

// 3. Гладкое значение в разумной окрестности целого счётчика итераций.
{
  const mu = M.escapeTime(0.5, 0.5, 500);
  assert.ok(mu >= 0 && Number.isFinite(mu), `mu конечно: ${mu}`);
  assert.ok(Math.abs(mu - Math.round(mu)) <= 1, 'дробная часть в пределах одной итерации');
}

// 4. Инвариант зума: точка плоскости под курсором не двигается.
{
  const view = { cx: -0.5, cy: 0, scale: 0.005 };
  const w = 800, h = 600, px = 123, py = 456;
  const before = M.screenToComplex(px, py, view, w, h);
  const zoomed = M.zoomAt(view, px, py, 1 / 1.5, w, h);
  const after = M.screenToComplex(px, py, zoomed, w, h);
  assert.ok(Math.abs(before.re - after.re) < 1e-12, 're сместилось');
  assert.ok(Math.abs(before.im - after.im) < 1e-12, 'im сместилось');
  assert.ok(Math.abs(zoomed.scale - view.scale / 1.5) < 1e-15, 'масштаб неверный');
}

// 5. Панорамирование: сдвиг на dx пикселей сдвигает центр ровно на dx*scale.
{
  const view = { cx: 0.1, cy: 0.2, scale: 0.01 };
  const moved = M.panBy(view, 50, -30);
  assert.ok(Math.abs(moved.cx - (0.1 - 0.5)) < 1e-12);
  assert.ok(Math.abs(moved.cy - (0.2 - 0.3)) < 1e-12);
}

// 6. Глубина итераций монотонно растёт с зумом и ограничена.
{
  const a = M.maxIterForZoom(1);
  const b = M.maxIterForZoom(1000);
  const c = M.maxIterForZoom(1e12);
  assert.ok(a >= 100, `базовая глубина мала: ${a}`);
  assert.ok(b > a && c > b, 'глубина не растёт с зумом');
  assert.ok(c <= 4000, 'глубина не ограничена');
}

// 7. Палитра возвращает валидный RGB.
{
  for (const mu of [0, 1, 10, 100, 3999]) {
    const rgb = M.colorFromMu(mu);
    for (const ch of rgb) {
      assert.ok(Number.isInteger(ch) && ch >= 0 && ch <= 255, `канал вне диапазона: ${rgb}`);
    }
  }
}

console.log('mandelbrot.test.js: все тесты пройдены');
