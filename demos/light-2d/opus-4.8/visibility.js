'use strict';

// Чистая геометрия полигона видимости. Без рендера, без DOM.
// Соглашения: точка — {x, y}; отрезок — {a:{x,y}, b:{x,y}}.

const EPS = 1e-9;

// Пересечение луча из точки origin в направлении угла theta с отрезком [a,b].
// Луч: P = origin + t * dir, t >= 0. Отрезок: Q = a + u * (b-a), 0 <= u <= 1.
// Возвращает { x, y, t, u } для ближайшей по t валидной точки, иначе null.
function raySegmentIntersect(origin, theta, seg) {
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  const ax = seg.a.x, ay = seg.a.y;
  const bx = seg.b.x, by = seg.b.y;
  const sx = bx - ax;
  const sy = by - ay;

  // Решаем origin + t*dir = a + u*s.
  // [ dx  -sx ] [t]   [ ax - origin.x ]
  // [ dy  -sy ] [u] = [ ay - origin.y ]
  const denom = dx * (-sy) - dy * (-sx); // = -dx*sy + dy*sx
  if (Math.abs(denom) < EPS) return null; // параллельны/вырождены

  const rx = ax - origin.x;
  const ry = ay - origin.y;
  const t = (rx * (-sy) - ry * (-sx)) / denom;
  const u = (dx * ry - dy * rx) / denom;

  if (t < EPS) return null;            // пересечение позади/в самой точке
  if (u < -EPS || u > 1 + EPS) return null; // вне тела отрезка

  return { x: origin.x + t * dx, y: origin.y + t * dy, t, u };
}

// Ближайшее пересечение луча (угол theta) со всем набором отрезков.
// Возвращает {x, y, t, ...} ближайшей точки. Если ничего не задело —
// точка на дистанции maxDist (для открытых сцен), иначе null при maxDist<=0.
function castRay(origin, theta, segments, maxDist) {
  let best = null;
  for (let i = 0; i < segments.length; i++) {
    const hit = raySegmentIntersect(origin, theta, segments[i]);
    if (hit && (best === null || hit.t < best.t)) best = hit;
  }
  if (best) return best;
  if (maxDist && maxDist > 0) {
    return {
      x: origin.x + Math.cos(theta) * maxDist,
      y: origin.y + Math.sin(theta) * maxDist,
      t: maxDist,
      u: -1,
    };
  }
  return null;
}

// Развернуть набор полигонов (каждый — массив точек) в плоский список отрезков.
// Полигоны считаются замкнутыми (последняя вершина соединяется с первой).
function polygonsToSegments(polygons) {
  const segs = [];
  for (const poly of polygons) {
    const n = poly.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      segs.push({ a: poly[i], b: poly[(i + 1) % n] });
    }
  }
  return segs;
}

// Собрать множество углов лучей: к каждой вершине + малые угловые смещения ±ε,
// чтобы луч мог «обогнуть» вершину и достать до фона/дальних рёбер.
function collectRayAngles(origin, vertices, eps) {
  const e = eps == null ? 1e-4 : eps;
  const angles = [];
  for (const v of vertices) {
    const base = Math.atan2(v.y - origin.y, v.x - origin.x);
    angles.push(base - e, base, base + e);
  }
  return angles;
}

// Уникальные вершины из набора полигонов (плюс опционально углы рамки).
function collectVertices(polygons) {
  const out = [];
  for (const poly of polygons) for (const p of poly) out.push(p);
  return out;
}

// Построить полигон видимости из точки origin.
// polygons — препятствия; bounds — {minX,minY,maxX,maxY} ограничивающая рамка
// (например стены комнаты), включается как полигон-периметр.
// Возвращает массив точек контура освещённой области, отсортированный по углу (CCW).
function computeVisibility(origin, polygons, bounds, eps) {
  const allPolys = polygons.slice();
  let frame = null;
  if (bounds) {
    frame = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ];
    allPolys.push(frame);
  }

  const segments = polygonsToSegments(allPolys);
  const vertices = collectVertices(allPolys);
  const angles = collectRayAngles(origin, vertices, eps);

  // Дальность для лучей, ушедших мимо всего (открытая сцена без рамки).
  let maxDist = 0;
  if (bounds) {
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    maxDist = Math.hypot(w, h) * 2;
  } else {
    for (const v of vertices) {
      maxDist = Math.max(maxDist, Math.hypot(v.x - origin.x, v.y - origin.y));
    }
    maxDist = maxDist * 2 + 1;
  }

  const pts = [];
  for (const theta of angles) {
    const hit = castRay(origin, theta, segments, maxDist);
    if (hit) pts.push({ x: hit.x, y: hit.y, angle: Math.atan2(hit.y - origin.y, hit.x - origin.x) });
  }

  pts.sort((p, q) => p.angle - q.angle);

  // Убрать дубли-вершины подряд (одинаковая координата под близкими углами).
  const result = [];
  for (const p of pts) {
    const last = result[result.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    result.push(p);
  }
  return result;
}

const VisibilityAPI = {
  raySegmentIntersect,
  castRay,
  polygonsToSegments,
  collectVertices,
  collectRayAngles,
  computeVisibility,
  EPS,
};

// Dual-mode: node — экспорт; браузер (<script>) — глобал window.Visibility.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VisibilityAPI;
} else {
  window.Visibility = VisibilityAPI;
}
