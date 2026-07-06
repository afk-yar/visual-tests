// visibility.js — геометрическое ядро 2D-полигона видимости.
// Dual-mode: в браузере кладёт API в window.Visibility, в Node — module.exports
// (см. конвенцию в CLAUDE.md репозитория, аналогично assets/shell.js).
//
// Алгоритм: для каждой вершины препятствий бросаем три луча — angle-eps,
// angle, angle+eps (малое угловое смещение, чтобы "заглянуть" за угол и
// найти границу тени за препятствием). Для каждого луча ищем ближайшее
// пересечение со всеми отрезками сцены (стены + рёбра препятствий).
// Итоговые точки сортируем по углу — получившийся звёздчатый (star-shaped
// относительно источника) полигон и есть полигон видимости.
(function (root) {
  'use strict';

  var ANGLE_EPS = 0.00035; // малое угловое смещение (~0.02°)

  // Приводит угол к диапазону (-PI, PI].
  function normalizeAngle(angle) {
    var a = angle;
    var twoPi = Math.PI * 2;
    while (a <= -Math.PI) a += twoPi;
    while (a > Math.PI) a -= twoPi;
    return a;
  }

  // Пересечение луча origin + t*dir (t >= 0) с отрезком [segStart, segEnd]
  // (параметр вдоль отрезка u в [0,1]). Возвращает {t, u, x, y} либо null.
  function raySegmentIntersection(origin, dir, segStart, segEnd) {
    var rx = dir.x, ry = dir.y;
    var sx = segEnd.x - segStart.x, sy = segEnd.y - segStart.y;
    var rxs = rx * sy - ry * sx;

    if (Math.abs(rxs) < 1e-12) return null; // луч и отрезок параллельны/коллинеарны

    var qpx = segStart.x - origin.x, qpy = segStart.y - origin.y;
    var t = (qpx * sy - qpy * sx) / rxs;
    var u = (qpx * ry - qpy * rx) / rxs;

    var EPS = 1e-9;
    if (t >= -EPS && u >= -EPS && u <= 1 + EPS) {
      return { t: t, u: u, x: origin.x + rx * t, y: origin.y + ry * t };
    }
    return null;
  }

  // Превращает замкнутый многоугольник (массив вершин) в список отрезков.
  function segmentsFromPolygon(points) {
    var segs = [];
    for (var i = 0; i < points.length; i++) {
      var a = points[i];
      var b = points[(i + 1) % points.length];
      segs.push({ a: a, b: b });
    }
    return segs;
  }

  // Бросает луч под заданным углом из origin, возвращает ближайшее (по t)
  // пересечение среди всех segments. Если ничего не найдено — точку на
  // расстоянии maxDist вдоль луча (страховка; при включённых границах сцены
  // как отрезках такого не должно происходить).
  function castRay(origin, angle, segments, maxDist) {
    var dir = { x: Math.cos(angle), y: Math.sin(angle) };
    var closest = null;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var hit = raySegmentIntersection(origin, dir, seg.a, seg.b);
      if (hit && hit.t >= 0 && (!closest || hit.t < closest.t)) {
        closest = hit;
      }
    }
    if (!closest) {
      closest = { t: maxDist, u: null, x: origin.x + dir.x * maxDist, y: origin.y + dir.y * maxDist };
    }
    closest.angle = angle;
    return closest;
  }

  // Собирает набор углов для трассировки: для каждой уникальной (по
  // направлению от origin) вершины сегментов — три угла angle-eps, angle,
  // angle+eps.
  function buildAngles(origin, segments) {
    var seen = Object.create(null);
    var angles = [];
    for (var i = 0; i < segments.length; i++) {
      var verts = [segments[i].a, segments[i].b];
      for (var j = 0; j < verts.length; j++) {
        var v = verts[j];
        var raw = Math.atan2(v.y - origin.y, v.x - origin.x);
        var key = Math.round(raw * 1e6);
        if (seen[key]) continue;
        seen[key] = true;
        angles.push(normalizeAngle(raw - ANGLE_EPS));
        angles.push(raw);
        angles.push(normalizeAngle(raw + ANGLE_EPS));
      }
    }
    return angles;
  }

  // Строит полигон видимости из точки origin для набора отрезков сцены.
  // Возвращает массив точек {x, y, t, u, angle}, отсортированный по углу
  // по возрастанию — готовый контур для заливки (origin остаётся внутри,
  // соединение точек по порядку даёт корректный звёздчатый полигон).
  function computeVisibilityPolygon(origin, segments, maxDist) {
    var dist = maxDist || 10000;
    var angles = buildAngles(origin, segments);
    var points = new Array(angles.length);
    for (var i = 0; i < angles.length; i++) {
      points[i] = castRay(origin, angles[i], segments, dist);
    }
    points.sort(function (p1, p2) { return p1.angle - p2.angle; });
    return points;
  }

  var api = {
    ANGLE_EPS: ANGLE_EPS,
    normalizeAngle: normalizeAngle,
    raySegmentIntersection: raySegmentIntersection,
    segmentsFromPolygon: segmentsFromPolygon,
    castRay: castRay,
    buildAngles: buildAngles,
    computeVisibilityPolygon: computeVisibilityPolygon
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Visibility = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
