/*
 * Множество Мандельброта — чистая математика без DOM.
 * Dual-mode: в браузере кладёт API в window.Mandelbrot, в node — module.exports.
 *
 * Вид (view): { cx, cy, scale } — центр на комплексной плоскости и
 * масштаб (единиц плоскости на один пиксель).
 */
(function (global) {
  'use strict';

  var ESCAPE_R2 = 65536; // радиус ухода 256 — большой ради гладкой раскраски

  /*
   * Гладкое (continuous) число итераций для точки c = (cx, cy).
   * Возвращает -1, если точка принадлежит множеству (не ушла за maxIter).
   */
  function escapeTime(cx, cy, maxIter) {
    // Быстрый выход для главной кардиоиды и круга периода 2.
    var xq = cx - 0.25;
    var q = xq * xq + cy * cy;
    if (q * (q + xq) <= 0.25 * cy * cy) return -1;
    var xp = cx + 1;
    if (xp * xp + cy * cy <= 0.0625) return -1;

    var x = 0, y = 0, x2 = 0, y2 = 0, i = 0;
    while (i < maxIter && x2 + y2 <= ESCAPE_R2) {
      y = 2 * x * y + cy;
      x = x2 - y2 + cx;
      x2 = x * x;
      y2 = y * y;
      i++;
    }
    if (i >= maxIter) return -1;
    // Гладкая поправка: mu = i + 1 - log2(log|z|)
    var logZn = Math.log(x2 + y2) / 2;
    var nu = Math.log(logZn / Math.LN2) / Math.LN2;
    return i + 1 - nu;
  }

  // Пиксель -> точка комплексной плоскости (мнимая ось направлена вверх).
  function screenToComplex(px, py, view, w, h) {
    return {
      re: view.cx + (px - w / 2) * view.scale,
      im: view.cy - (py - h / 2) * view.scale,
    };
  }

  /*
   * Зум с центрированием на курсоре: точка плоскости под пикселем (px, py)
   * остаётся под тем же пикселем. factor < 1 — приближение.
   */
  function zoomAt(view, px, py, factor, w, h) {
    var c = screenToComplex(px, py, view, w, h);
    var ns = view.scale * factor;
    return {
      cx: c.re - (px - w / 2) * ns,
      cy: c.im + (py - h / 2) * ns,
      scale: ns,
    };
  }

  // Сдвиг вида на (dx, dy) пикселей (перетаскивание).
  function panBy(view, dx, dy) {
    return {
      cx: view.cx - dx * view.scale,
      cy: view.cy + dy * view.scale,
      scale: view.scale,
    };
  }

  // Глубина итераций растёт с зумом (zoom = во сколько раз приближено).
  function maxIterForZoom(zoom) {
    var z = Math.max(zoom, 1);
    return Math.min(4000, Math.round(128 + 96 * Math.log2(z)));
  }

  /*
   * Косинусная палитра (по мотивам Иньиго Килеса): mu -> [r, g, b] 0..255.
   * sqrt сжимает динамический диапазон, чтобы и края, и глубина были выразительны.
   */
  function colorFromMu(mu) {
    var t = Math.sqrt(mu) * 0.22;
    var r = 0.5 + 0.5 * Math.cos(6.28318 * (t + 0.263));
    var g = 0.5 + 0.5 * Math.cos(6.28318 * (t + 0.416));
    var b = 0.5 + 0.5 * Math.cos(6.28318 * (t + 0.557));
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  var api = {
    escapeTime: escapeTime,
    screenToComplex: screenToComplex,
    zoomAt: zoomAt,
    panBy: panBy,
    maxIterForZoom: maxIterForZoom,
    colorFromMu: colorFromMu,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Mandelbrot = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
