// Dual-mode module: чистая математика множества Мандельброта.
// В браузере кладёт API в window.Mandelbrot, в node экспортирует через module.exports.
(function (root) {
  'use strict';

  var LOG2 = Math.log(2);
  var DEFAULT_BAILOUT = 1 << 16; // радиус^2 = 65536 (радиус 256) — большой bailout даёт более гладкую continuous-раскраску
  var DEFAULT_MAX_ITER = 500;

  /**
   * Escape-time итерация точки c = cx + cy*i для z(n+1) = z(n)^2 + c, z(0) = 0.
   * Возвращает:
   *   escaped  — true, если точка покинула bailout-радиус до исчерпания maxIter
   *   iter     — целое число выполненных итераций
   *   smooth   — непрерывное (continuous/smooth) число итераций для плавной раскраски;
   *              для точек, оставшихся в множестве, равно maxIter.
   *
   * Быстрые проверки на попадание в главную кардиоиду и в бульбу периода 2 избавляют
   * от полного прогона maxIter итераций для самой большой чёрной области множества.
   */
  function iterate(cx, cy, maxIter, bailout) {
    maxIter = maxIter == null ? DEFAULT_MAX_ITER : maxIter;
    bailout = bailout == null ? DEFAULT_BAILOUT : bailout;

    // Главная кардиоида: q*(q + (x - 1/4)) < 1/4 * y^2, где q = (x - 1/4)^2 + y^2.
    var xq = cx - 0.25;
    var q = xq * xq + cy * cy;
    if (q * (q + xq) < 0.25 * cy * cy) {
      return { escaped: false, iter: maxIter, smooth: maxIter };
    }
    // Бульба периода 2: (x + 1)^2 + y^2 < 1/16.
    var xp1 = cx + 1;
    if (xp1 * xp1 + cy * cy < 0.0625) {
      return { escaped: false, iter: maxIter, smooth: maxIter };
    }

    var x = 0, y = 0, x2 = 0, y2 = 0;
    var iter = 0;
    while (x2 + y2 <= bailout && iter < maxIter) {
      y = 2 * x * y + cy;
      x = x2 - y2 + cx;
      x2 = x * x;
      y2 = y * y;
      iter++;
    }

    if (iter >= maxIter) {
      return { escaped: false, iter: iter, smooth: maxIter };
    }

    // Continuous/smooth iteration count (нормированный логарифм модуля).
    var logZn = Math.log(x2 + y2) / 2;
    var nu = Math.log(logZn / LOG2) / LOG2;
    var smooth = iter + 1 - nu;
    return { escaped: true, iter: iter, smooth: smooth };
  }

  /**
   * Экранные координаты (пиксели устройства) → точка комплексной плоскости.
   * view = { centerX, centerY, scale, width, height }
   *   centerX/centerY — комплексная точка в центре экрана
   *   scale            — единиц комплексной плоскости на один пиксель
   *   width/height     — размер холста в пикселях
   */
  function screenToComplex(px, py, view) {
    return {
      x: view.centerX + (px - view.width / 2) * view.scale,
      y: view.centerY + (py - view.height / 2) * view.scale
    };
  }

  /** Обратное преобразование: точка комплексной плоскости → экранные координаты. */
  function complexToScreen(x, y, view) {
    return {
      x: (x - view.centerX) / view.scale + view.width / 2,
      y: (y - view.centerY) / view.scale + view.height / 2
    };
  }

  /**
   * Бюджет итераций растёт с глубиной зума, чтобы детали не "замыливались" при
   * увеличении. scale — текущий масштаб (единиц/пиксель), baseScale — масштаб
   * при zoom=1 (начальный вид).
   */
  function iterationsForScale(scale, baseScale, opts) {
    opts = opts || {};
    var base = opts.base != null ? opts.base : 100;
    var factor = opts.factor != null ? opts.factor : 55;
    var cap = opts.cap != null ? opts.cap : 2000;
    var zoom = baseScale / scale;
    var extra = zoom > 1 ? factor * Math.log2(zoom) : 0;
    return Math.min(cap, Math.round(base + extra));
  }

  var api = {
    iterate: iterate,
    screenToComplex: screenToComplex,
    complexToScreen: complexToScreen,
    iterationsForScale: iterationsForScale,
    DEFAULT_BAILOUT: DEFAULT_BAILOUT
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Mandelbrot = api;
  }
})(typeof window !== 'undefined' ? window : this);
