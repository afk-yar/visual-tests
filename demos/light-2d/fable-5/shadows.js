/*
 * 2D-видимость: пересечение луч-отрезок и полигон видимости.
 * Dual-mode: в браузере кладёт API в window.Shadows, в node — module.exports.
 *
 * Сегмент: { ax, ay, bx, by }. Источник: точка (ox, oy).
 */
(function (global) {
  'use strict';

  /*
   * Пересечение луча (origin + t * dir, t > 0) с отрезком AB.
   * Возвращает t или Infinity, если пересечения нет.
   */
  function raySegment(ox, oy, dx, dy, ax, ay, bx, by) {
    var sx = bx - ax, sy = by - ay;
    var denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-12) return Infinity; // параллельны
    var t = ((ax - ox) * sy - (ay - oy) * sx) / denom;
    var u = ((ax - ox) * dy - (ay - oy) * dx) / denom;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) return t;
    return Infinity;
  }

  // Ближайшее пересечение луча со всеми сегментами.
  function castToNearest(ox, oy, dx, dy, segments) {
    var best = Infinity;
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      var t = raySegment(ox, oy, dx, dy, s.ax, s.ay, s.bx, s.by);
      if (t < best) best = t;
    }
    return best;
  }

  /*
   * Полигон видимости из точки (ox, oy).
   * Лучи пускаются к каждой вершине каждого сегмента и под ±eps от неё
   * (чтобы заглядывать «за угол»), точки сортируются по углу.
   * Сегменты должны замыкать сцену (включать рамку-границу).
   */
  function visibilityPolygon(ox, oy, segments) {
    var EPS = 1e-4;
    var angles = [];
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      var a1 = Math.atan2(s.ay - oy, s.ax - ox);
      var a2 = Math.atan2(s.by - oy, s.bx - ox);
      angles.push(a1 - EPS, a1, a1 + EPS, a2 - EPS, a2, a2 + EPS);
    }

    var points = [];
    for (var k = 0; k < angles.length; k++) {
      var dx = Math.cos(angles[k]), dy = Math.sin(angles[k]);
      var t = castToNearest(ox, oy, dx, dy, segments);
      if (t === Infinity) continue; // сцена не замкнута в этом направлении
      points.push({ x: ox + dx * t, y: oy + dy * t, angle: angles[k] });
    }
    points.sort(function (p, q) { return p.angle - q.angle; });
    return points;
  }

  // Прямоугольник -> 4 сегмента.
  function rectSegments(x, y, w, h) {
    return [
      { ax: x, ay: y, bx: x + w, by: y },
      { ax: x + w, ay: y, bx: x + w, by: y + h },
      { ax: x + w, ay: y + h, bx: x, by: y + h },
      { ax: x, ay: y + h, bx: x, by: y },
    ];
  }

  // Замкнутый многоугольник [{x,y}...] -> сегменты.
  function polySegments(pts) {
    var segs = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
    return segs;
  }

  // Точка внутри многоугольника (чётность пересечений) — для тестов.
  function pointInPolygon(x, y, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  var api = {
    raySegment: raySegment,
    castToNearest: castToNearest,
    visibilityPolygon: visibilityPolygon,
    rectSegments: rectSegments,
    polySegments: polySegments,
    pointInPolygon: pointInPolygon,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Shadows = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
