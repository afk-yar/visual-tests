'use strict';

var assert = require('assert');
var Visibility = require('./visibility.js');

var scenarios = 0;

// --- raySegmentIntersection: попадание в известный отрезок-стену ---
(function testBasicHit() {
  scenarios++;
  var origin = { x: 0, y: 0 };
  var dir = { x: 1, y: 0 }; // угол 0, вправо
  var wallA = { x: 10, y: -5 };
  var wallB = { x: 10, y: 5 };

  var hit = Visibility.raySegmentIntersection(origin, dir, wallA, wallB);
  assert.ok(hit, 'луч должен попасть в стену x=10');
  assert.ok(Math.abs(hit.t - 10) < 1e-9, 't должен быть 10, получено ' + hit.t);
  assert.ok(Math.abs(hit.u - 0.5) < 1e-9, 'u должен быть 0.5, получено ' + hit.u);
  assert.ok(Math.abs(hit.x - 10) < 1e-9, 'x пересечения должен быть 10');
  assert.ok(Math.abs(hit.y - 0) < 1e-9, 'y пересечения должен быть 0');
})();

// --- параллельный луч мимо стены ---
(function testParallelMiss() {
  scenarios++;
  var origin = { x: 0, y: 0 };
  var dir = { x: 0, y: 1 }; // вертикально вниз; стена тоже вертикальна -> параллельно
  var wallA = { x: 10, y: -5 };
  var wallB = { x: 10, y: 5 };
  var hit = Visibility.raySegmentIntersection(origin, dir, wallA, wallB);
  assert.strictEqual(hit, null, 'параллельный луч не должен пересекать стену');
})();

// --- пересечение "позади" источника луча (t < 0) ---
(function testBehindMiss() {
  scenarios++;
  var origin = { x: 0, y: 0 };
  var dir = { x: -1, y: 0 }; // луч смотрит влево, стена справа
  var wallA = { x: 10, y: -5 };
  var wallB = { x: 10, y: 5 };
  var hit = Visibility.raySegmentIntersection(origin, dir, wallA, wallB);
  assert.strictEqual(hit, null, 'пересечение позади источника луча должно отбрасываться (t<0)');
})();

// --- линия луча пересекает прямую отрезка, но вне диапазона u ---
(function testOutOfSegmentRange() {
  scenarios++;
  var origin = { x: 0, y: 0 };
  var dir = { x: 1, y: 0 };
  var wallA = { x: 10, y: 3 };
  var wallB = { x: 10, y: 5 }; // отрезок не пересекает y=0
  var hit = Visibility.raySegmentIntersection(origin, dir, wallA, wallB);
  assert.strictEqual(hit, null, 'при u вне [0,1] пересечения быть не должно');
})();

// --- ближайшее из нескольких препятствий на одном направлении ---
(function testClosestOfMany() {
  scenarios++;
  var origin = { x: 0, y: 0 };
  var segments = [
    { a: { x: -2, y: -1 }, b: { x: -2, y: 1 } },    // ближняя стенка слева, t=2
    { a: { x: -10, y: -10 }, b: { x: -10, y: 10 } } // дальняя граница слева, t=10
  ];
  var hit = Visibility.castRay(origin, Math.PI, segments, 1000); // угол 180°, влево
  assert.ok(Math.abs(hit.x - (-2)) < 1e-9, 'должна попасться ближняя стенка, а не дальняя граница');
  assert.ok(Math.abs(hit.y - 0) < 1e-9);
  assert.ok(Math.abs(hit.t - 2) < 1e-9, 't должен быть 2 (расстояние до ближней стенки)');
})();

// --- нормализация угла через границу +-π ---
(function testNormalizeAngleWrap() {
  scenarios++;
  var input = Math.PI + 0.2;
  var expected = -(Math.PI - 0.2);
  var result = Visibility.normalizeAngle(input);
  assert.ok(Math.abs(result - expected) < 1e-9, 'угол должен корректно перейти через границу π');
})();

// --- полигон видимости: пустой квадрат — сортировка по углу и геометрия границ ---
(function testVisibilityPolygonSortedAndBounded() {
  scenarios++;
  var origin = { x: 0, y: 0 };
  var square = [
    { x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }
  ];
  var segments = Visibility.segmentsFromPolygon(square);
  var points = Visibility.computeVisibilityPolygon(origin, segments, 1000);

  assert.ok(points.length > 0, 'полигон видимости должен содержать точки');

  for (var i = 1; i < points.length; i++) {
    assert.ok(
      points[i].angle >= points[i - 1].angle - 1e-9,
      'точки должны быть отсортированы по углу по возрастанию (индекс ' + i + ')'
    );
  }

  var boundHalf = 10 + 1e-6;
  for (var k = 0; k < points.length; k++) {
    var p = points[k];
    assert.ok(
      Math.abs(p.x) <= boundHalf && Math.abs(p.y) <= boundHalf,
      'все точки полигона должны лежать внутри границ квадрата'
    );
    var onBoundary = Math.abs(Math.abs(p.x) - 10) < 1e-6 || Math.abs(Math.abs(p.y) - 10) < 1e-6;
    assert.ok(onBoundary, 'без препятствий внутри все лучи должны упираться в границу квадрата');
  }

  // без препятствий внутри первая точка (по возрастанию угла) должна быть у
  // нижнего-левого угла (-135°), последняя — у верхнего-левого (135°)
  assert.ok(Math.abs(points[0].angle - (-3 * Math.PI / 4)) < 0.01, 'первый угол ~ -135°');
  assert.ok(Math.abs(points[points.length - 1].angle - (3 * Math.PI / 4)) < 0.01, 'последний угол ~ 135°');
})();

// --- полигон видимости с препятствием: точное геометрическое перекрытие ---
(function testVisibilityPolygonWithObstacle() {
  scenarios++;
  var origin = { x: 0, y: 0 };
  var square = [
    { x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }
  ];
  // узкая стена-препятствие перед источником: x=2, y от -1 до 1;
  // её угловой диапазон от origin — примерно +-26.57° (atan2(1,2))
  var wall = [
    { a: { x: 2, y: -1 }, b: { x: 2, y: 1 } }
  ];
  var segments = Visibility.segmentsFromPolygon(square).concat(wall);

  // луч "в лоб" препятствию (угол 0) должен упереться в стену на x=2,
  // а не долететь до дальней границы квадрата на x=10
  var hitCenter = Visibility.castRay(origin, 0, segments, 1000);
  assert.ok(Math.abs(hitCenter.x - 2) < 1e-9, 'луч вдоль оси X должен упереться в стену x=2');
  assert.ok(Math.abs(hitCenter.y - 0) < 1e-9);
  assert.ok(Math.abs(hitCenter.t - 2) < 1e-9);

  // луч под 45° проходит мимо узкой стены (её угловой диапазон уже +-45°)
  // и долетает точно до дальнего угла квадрата (10,10)
  var hitCorner = Visibility.castRay(origin, Math.PI / 4, segments, 1000);
  assert.ok(Math.abs(hitCorner.x - 10) < 1e-9, 'луч под 45° должен долететь до границы x=10');
  assert.ok(Math.abs(hitCorner.y - 10) < 1e-9, 'луч под 45° должен долететь до угла границы (10,10)');

  // полный полигон видимости должен проходить точно через обе вершины стены
  // (сэмплируются "сырым" углом без смещения — попадание должно быть точным)
  var points = Visibility.computeVisibilityPolygon(origin, segments, 1000);
  var hitsWallTop = points.some(function (p) { return Math.abs(p.x - 2) < 1e-6 && Math.abs(p.y - 1) < 1e-6; });
  var hitsWallBottom = points.some(function (p) { return Math.abs(p.x - 2) < 1e-6 && Math.abs(p.y - (-1)) < 1e-6; });
  assert.ok(hitsWallTop && hitsWallBottom, 'полигон видимости должен точно проходить через обе вершины стены');
})();

console.log('visibility.test.js: все проверки пройдены (' + scenarios + ' сценариев)');
