'use strict';

var assert = require('assert');
var M = require('./mandelbrot.js');

// 1. Точка (0,0) принадлежит множеству Мандельброта — не убегает за bailout
//    в разумное число итераций.
(function testOriginIsInSet() {
  var maxIter = 500;
  var res = M.iterate(0, 0, maxIter);
  assert.strictEqual(res.escaped, false, '(0,0) не должна убегать — она в множестве');
  assert.strictEqual(res.iter, maxIter, '(0,0) должна дойти до maxIter без escape');
  assert.strictEqual(res.smooth, maxIter, 'smooth для точки в множестве равен maxIter');
})();

// 2. Точка (2,2) убегает почти сразу (далеко за пределами множества |c|<=2).
(function testFarPointEscapesFast() {
  var maxIter = 500;
  var res = M.iterate(2, 2, maxIter);
  assert.strictEqual(res.escaped, true, '(2,2) должна убежать за bailout-радиус');
  assert.ok(res.iter <= 10, 'ожидали escape за пару итераций, получили ' + res.iter);
  assert.ok(isFinite(res.smooth), 'smooth должен быть конечным числом');
  assert.ok(res.smooth > 0, 'smooth должен быть положительным');
})();

// Доп. проверка: точка внутри главной кардиоиды (быстрый путь) тоже "в множестве".
(function testMainCardioidFastPath() {
  var res = M.iterate(-0.5, 0, 300);
  assert.strictEqual(res.escaped, false, '(-0.5,0) внутри главной кардиоиды');
  assert.strictEqual(res.iter, 300);
})();

// Доп. проверка: точка чуть за пределами множества убегает, smooth конечен и разумен.
(function testBoundaryPointSmoothValue() {
  var res = M.iterate(-1.3, 0.1, 1000);
  assert.strictEqual(res.escaped, true);
  assert.ok(res.smooth >= 0 && res.smooth < 1000);
})();

// 3. screenToComplex / complexToScreen — взаимно обратные преобразования (round-trip).
(function testScreenComplexRoundTrip() {
  var view = { centerX: -0.6, centerY: 0.13, scale: 0.0021, width: 1024, height: 768 };
  var samples = [[0, 0], [512, 384], [1023, 0], [200, 700], [777, 111], [1024, 768]];
  samples.forEach(function (p) {
    var complex = M.screenToComplex(p[0], p[1], view);
    var back = M.complexToScreen(complex.x, complex.y, view);
    assert.ok(Math.abs(back.x - p[0]) < 1e-9, 'round-trip x разошёлся для ' + p);
    assert.ok(Math.abs(back.y - p[1]) < 1e-9, 'round-trip y разошёлся для ' + p);
  });
})();

// Доп. проверка round-trip в другую сторону: комплекс → экран → комплекс.
(function testComplexScreenRoundTrip() {
  var view = { centerX: 0.1, centerY: -0.75, scale: 5e-6, width: 1600, height: 900 };
  var points = [[0.1, -0.75], [0.100002, -0.749998], [0.0998, -0.7502]];
  points.forEach(function (c) {
    var screen = M.complexToScreen(c[0], c[1], view);
    var back = M.screenToComplex(screen.x, screen.y, view);
    assert.ok(Math.abs(back.x - c[0]) < 1e-12, 'round-trip re разошёлся для ' + c);
    assert.ok(Math.abs(back.y - c[1]) < 1e-12, 'round-trip im разошёлся для ' + c);
  });
})();

// 4. Бюджет итераций растёт с глубиной зума и остаётся в разумных пределах.
(function testIterationsGrowWithZoom() {
  var baseScale = 0.002;
  var atZoom1 = M.iterationsForScale(baseScale, baseScale);
  var atZoom1000 = M.iterationsForScale(baseScale / 1000, baseScale);
  var atZoomHuge = M.iterationsForScale(baseScale / 1e12, baseScale);
  assert.ok(atZoom1000 > atZoom1, 'бюджет итераций должен расти при увеличении зума');
  assert.ok(atZoomHuge > atZoom1000, 'бюджет итераций должен продолжать расти на глубоком зуме');
  assert.ok(atZoomHuge <= 5000, 'бюджет итераций должен быть ограничен ради производительности');
})();

console.log('mandelbrot.test.js: все проверки пройдены.');
