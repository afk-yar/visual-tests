'use strict';
(function () {
  // Дуал-модуль: чистые функции трёх правил boids + тороидальная геометрия.
  // В браузере кладёт API в window.Boids, в node экспортирует через module.exports.
  // Никаких побочных эффектов и обращений к DOM/времени — легко тестировать.

  // Кратчайшая разница координат по одной оси с учётом тороидального переноса
  // поля размера size (переход через край считается "коротким путём").
  function wrapDelta(d, size) {
    if (!(size > 0)) return d;
    const half = size / 2;
    let wrapped = d;
    if (wrapped > half) wrapped -= size;
    else if (wrapped < -half) wrapped += size;
    return wrapped;
  }

  // Кратчайший вектор из точки A в точку B на тороидальном поле width x height.
  function toroidalDelta(ax, ay, bx, by, width, height) {
    return {
      dx: wrapDelta(bx - ax, width),
      dy: wrapDelta(by - ay, height),
    };
  }

  // Кратчайшее расстояние между двумя точками на тороидальном поле
  // (меньше или равно наивному евклидову расстоянию без учёта переноса).
  function toroidalDistance(ax, ay, bx, by, width, height) {
    const d = toroidalDelta(ax, ay, bx, by, width, height);
    return Math.sqrt(d.dx * d.dx + d.dy * d.dy);
  }

  function vecLength(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y);
  }

  function normalize(v) {
    const len = vecLength(v);
    if (len < 1e-9) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  function limitMagnitude(v, max) {
    const len = vecLength(v);
    if (len > max && len > 0) {
      return { x: (v.x / len) * max, y: (v.y / len) * max };
    }
    return v;
  }

  // Правило РАЗДЕЛЕНИЯ (separation): направление прочь от близких соседей.
  // Вклад каждого соседа взвешен обратно пропорционально расстоянию —
  // чем ближе сосед, тем сильнее агент от него отталкивается.
  // boid — {x, y}; neighbors — массив {x, y} в радиусе восприятия.
  function separationRule(boid, neighbors, width, height) {
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      const d = toroidalDelta(boid.x, boid.y, n.x, n.y, width, height);
      const dist = Math.sqrt(d.dx * d.dx + d.dy * d.dy);
      if (dist > 1e-6) {
        sx += -d.dx / dist / dist;
        sy += -d.dy / dist / dist;
        count++;
      }
    }
    if (count === 0) return { x: 0, y: 0 };
    return { x: sx / count, y: sy / count };
  }

  // Правило ВЫРАВНИВАНИЯ (alignment): желаемое направление — средняя
  // скорость соседей. neighbors — массив {vx, vy}.
  function alignmentRule(boid, neighbors) {
    if (!neighbors.length) return { x: 0, y: 0 };
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < neighbors.length; i++) {
      vx += neighbors[i].vx;
      vy += neighbors[i].vy;
    }
    return { x: vx / neighbors.length, y: vy / neighbors.length };
  }

  // Правило СЦЕПЛЕНИЯ (cohesion): желаемое направление — к центру масс
  // соседей, вычисленному тороидально (усреднение кратчайших векторов,
  // а не сырых координат — иначе группа у края поля "разъедется").
  function cohesionRule(boid, neighbors, width, height) {
    if (!neighbors.length) return { x: 0, y: 0 };
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      const d = toroidalDelta(boid.x, boid.y, n.x, n.y, width, height);
      sx += d.dx;
      sy += d.dy;
    }
    return { x: sx / neighbors.length, y: sy / neighbors.length };
  }

  const api = {
    wrapDelta,
    toroidalDelta,
    toroidalDistance,
    normalize,
    limitMagnitude,
    separationRule,
    alignmentRule,
    cohesionRule,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.Boids = api;
  }
})();
