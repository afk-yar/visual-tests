'use strict';
const assert = require('node:assert');
const {
  raySegmentIntersect,
  castRay,
  polygonsToSegments,
  computeVisibility,
} = require('./visibility.js');

// A. Пересечение луч-отрезок: известная геометрия даёт корректную точку и t.
// Луч из (0,0) вправо (theta=0) пересекает вертикальный отрезок x=5, y∈[-2,2].
{
  const seg = { a: { x: 5, y: -2 }, b: { x: 5, y: 2 } };
  const hit = raySegmentIntersect({ x: 0, y: 0 }, 0, seg);
  assert.ok(hit, 'луч должен пересечь отрезок');
  assert.ok(Math.abs(hit.x - 5) < 1e-9, `x пересечения 5, получено ${hit.x}`);
  assert.ok(Math.abs(hit.y - 0) < 1e-9, `y пересечения 0, получено ${hit.y}`);
  assert.ok(Math.abs(hit.t - 5) < 1e-9, `t (дистанция) 5, получено ${hit.t}`);
  assert.ok(hit.u > 0 && hit.u < 1, `u внутри отрезка, получено ${hit.u}`);
}

// A'. Под углом 45°: пересечение с тем же отрезком в точке (5,5) на t=5√2.
{
  const seg = { a: { x: 5, y: -10 }, b: { x: 5, y: 10 } };
  const hit = raySegmentIntersect({ x: 0, y: 0 }, Math.PI / 4, seg);
  assert.ok(hit, 'диагональный луч должен пересечь');
  assert.ok(Math.abs(hit.x - 5) < 1e-9 && Math.abs(hit.y - 5) < 1e-9, `точка (5,5), получено (${hit.x},${hit.y})`);
  assert.ok(Math.abs(hit.t - 5 * Math.SQRT2) < 1e-9, `t=5√2, получено ${hit.t}`);
}

// B. Луч мимо отрезка → null.
// Луч вправо из (0,0), но отрезок целиком выше (y∈[3,5]) — промах.
{
  const seg = { a: { x: 5, y: 3 }, b: { x: 5, y: 5 } };
  const hit = raySegmentIntersect({ x: 0, y: 0 }, 0, seg);
  assert.strictEqual(hit, null, 'луч мимо отрезка должен вернуть null');
}

// B'. Отрезок позади источника (за спиной) — тоже null (t<0 отбрасывается).
{
  const seg = { a: { x: -5, y: -2 }, b: { x: -5, y: 2 } };
  const hit = raySegmentIntersect({ x: 0, y: 0 }, 0, seg);
  assert.strictEqual(hit, null, 'отрезок позади источника → null');
}

// B''. Параллельный луч и отрезок — null (нет единственного пересечения).
{
  const seg = { a: { x: 1, y: 0 }, b: { x: 9, y: 0 } };
  const hit = raySegmentIntersect({ x: 0, y: 0 }, 0, seg);
  assert.strictEqual(hit, null, 'параллельный отрезок → null');
}

// C. Источник внутри прямоугольной комнаты без препятствий →
//    полигон видимости совпадает с самим прямоугольником (4 угла).
{
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 80 };
  const poly = computeVisibility({ x: 50, y: 40 }, [], bounds);
  // Каждый угол комнаты должен присутствовать среди вершин контура.
  const corners = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 },
  ];
  for (const c of corners) {
    const found = poly.some((p) => Math.abs(p.x - c.x) < 1e-6 && Math.abs(p.y - c.y) < 1e-6);
    assert.ok(found, `угол комнаты (${c.x},${c.y}) должен быть в полигоне видимости`);
  }
  // Площадь контура должна равняться площади комнаты (100*80=8000).
  const area = polygonArea(poly);
  assert.ok(Math.abs(area - 8000) < 1e-6, `площадь видимости = площадь комнаты 8000, получено ${area}`);
}

// D. Препятствие между источником и точкой укорачивает луч (ближайшее пересечение).
{
  // Стена-отрезок на x=5 между источником (0,0) и дальним отрезком на x=10.
  const wall = { a: { x: 5, y: -3 }, b: { x: 5, y: 3 } };
  const far = { a: { x: 10, y: -3 }, b: { x: 10, y: 3 } };
  const segs = [wall, far];
  const hit = castRay({ x: 0, y: 0 }, 0, segs, 100);
  assert.ok(Math.abs(hit.x - 5) < 1e-9, `луч укорочен до стены x=5, получено ${hit.x}`);
  assert.ok(Math.abs(hit.t - 5) < 1e-9, `t=5 (ближайшее), получено ${hit.t}`);

  // Без стены тот же луч долетает до дальнего отрезка x=10.
  const hit2 = castRay({ x: 0, y: 0 }, 0, [far], 100);
  assert.ok(Math.abs(hit2.x - 10) < 1e-9, `без стены луч до x=10, получено ${hit2.x}`);
}

// E. polygonsToSegments: прямоугольник из 4 точек → 4 замкнутых ребра.
{
  const rect = [
    { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 },
  ];
  const segs = polygonsToSegments([rect]);
  assert.strictEqual(segs.length, 4, `4 ребра, получено ${segs.length}`);
  // Замыкающее ребро: последняя вершина → первая.
  const last = segs[3];
  assert.ok(last.a.x === 0 && last.a.y === 3 && last.b.x === 0 && last.b.y === 0, 'замыкающее ребро некорректно');
}

// F. Препятствие в комнате отбрасывает тень: за квадратом-препятствием
//    точки контура не выходят за дальнюю стену (укорачиваются на препятствии).
{
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const box = [
    { x: 60, y: 45 }, { x: 70, y: 45 }, { x: 70, y: 55 }, { x: 60, y: 55 },
  ];
  const origin = { x: 20, y: 50 };
  const poly = computeVisibility(origin, [box], bounds);
  // Должна найтись хотя бы одна вершина контура на ближней грани препятствия (x≈60).
  const onBox = poly.some((p) => Math.abs(p.x - 60) < 1e-6 && p.y >= 44 && p.y <= 56);
  assert.ok(onBox, 'контур должен касаться ближней грани препятствия (тень)');
  // Площадь освещённой области строго меньше площади пустой комнаты.
  const area = polygonArea(poly);
  assert.ok(area < 10000 - 1, `тень должна уменьшить площадь, получено ${area}`);
}

// Вспомогательное: площадь простого многоугольника (формула шнурков, модуль).
function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

console.log('Все тесты геометрии видимости пройдены.');
