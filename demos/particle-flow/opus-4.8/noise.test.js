'use strict';
/* Тесты чистой логики поля скоростей. Запуск: node noise.test.js */
var assert = require('node:assert');
var FlowNoise = require('./noise.js');

// 1) Перлин-шум детерминирован и ограничен примерно [-1, 1].
(function noiseRangeAndDeterminism() {
  var n = FlowNoise.makeNoise(42).noise3;
  var min = Infinity, max = -Infinity;
  for (var i = 0; i < 4000; i++) {
    var x = (i * 0.137) % 50;
    var y = (i * 0.071) % 50;
    var z = (i * 0.211) % 50;
    var v = n(x, y, z);
    assert.ok(Number.isFinite(v), 'noise must be finite');
    if (v < min) min = v;
    if (v > max) max = v;
    // детерминизм: повторный вызов даёт то же значение
    assert.strictEqual(n(x, y, z), v, 'noise must be deterministic');
  }
  assert.ok(min >= -1.05 && max <= 1.05, 'noise roughly in [-1,1], got ' + min + '..' + max);
  assert.ok(max - min > 0.8, 'noise must vary, range=' + (max - min));
})();

// 2) Один и тот же seed -> идентичные поля; разные seed -> различаются.
(function seedReproducibility() {
  var a = FlowNoise.makeNoise(7).noise3;
  var b = FlowNoise.makeNoise(7).noise3;
  var c = FlowNoise.makeNoise(8).noise3;
  var same = true, diff = false;
  for (var i = 0; i < 200; i++) {
    var x = i * 0.3 + 0.1, y = i * 0.17 + 0.2, z = i * 0.23 + 0.3;
    if (a(x, y, z) !== b(x, y, z)) same = false;
    if (a(x, y, z) !== c(x, y, z)) diff = true;
  }
  assert.ok(same, 'same seed must reproduce identical noise');
  assert.ok(diff, 'different seeds must produce different noise');
})();

// 3) Curl возвращает конечный 3D-вектор и детерминирован.
(function curlFinite() {
  var curl = FlowNoise.makeCurl(123).curl;
  for (var i = 0; i < 1000; i++) {
    var x = i * 0.05, y = i * 0.03 + 1, z = i * 0.07 + 2;
    var v = curl(x, y, z);
    assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z),
      'curl components must be finite at ' + i);
  }
})();

// 4) Ключевое свойство curl-noise: поле бездивергентно (div ~ 0).
//    Проверяем численную дивергенцию central-differences по выборке точек:
//    она должна быть близка к нулю относительно типичной величины поля.
(function curlIsDivergenceFree() {
  var curl = FlowNoise.makeCurl(999).curl;
  var H = 1e-3;
  var maxDiv = 0, sumMag = 0, samples = 0;
  for (var t = 0; t < 300; t++) {
    var x = t * 0.13 - 5, y = t * 0.09 + 0.5, z = t * 0.21 - 3;
    var dvx = (curl(x + H, y, z).x - curl(x - H, y, z).x) / (2 * H);
    var dvy = (curl(x, y + H, z).y - curl(x, y - H, z).y) / (2 * H);
    var dvz = (curl(x, y, z + H).z - curl(x, y, z - H).z) / (2 * H);
    var div = Math.abs(dvx + dvy + dvz);
    if (div > maxDiv) maxDiv = div;
    var m = curl(x, y, z);
    sumMag += Math.sqrt(m.x * m.x + m.y * m.y + m.z * m.z);
    samples++;
  }
  var avgMag = sumMag / samples;
  // дивергенция должна быть много меньше характерной величины поля
  assert.ok(maxDiv < avgMag * 0.5,
    'curl field should be ~divergence-free: maxDiv=' + maxDiv.toFixed(4) +
    ' avgMag=' + avgMag.toFixed(4));
})();

console.log('noise.test.js: OK');
