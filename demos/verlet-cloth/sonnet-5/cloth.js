// Дуал-mode модуль: чистая физика ткани на верлет-интегрировании.
// В браузере кладёт API в window.Cloth, в node экспортирует через module.exports.
(function (global) {
  'use strict';

  // Один шаг Верле-интегрирования одной частицы.
  // particle: { x, y, px, py, pinned } — px/py — позиция на предыдущем шаге.
  // ax, ay: ускорение (гравитация + ветер), dt: шаг времени (сек), damping: множитель затухания скорости.
  // Закреплённая частица (pinned) не двигается — но px/py подтягиваются к x/y,
  // чтобы не накапливалась "призрачная" скорость на случай будущего снятия закрепления.
  function verletStep(particle, ax, ay, dt, damping) {
    if (particle.pinned) {
      return { x: particle.x, y: particle.y, px: particle.x, py: particle.y, pinned: true };
    }
    var damp = (damping === undefined || damping === null) ? 1 : damping;
    var vx = (particle.x - particle.px) * damp;
    var vy = (particle.y - particle.py) * damp;
    var nx = particle.x + vx + ax * dt * dt;
    var ny = particle.y + vy + ay * dt * dt;
    return { x: nx, y: ny, px: particle.x, py: particle.y, pinned: false };
  }

  // Удовлетворение одного констрейнта-связи между двумя точками (метод релаксации Якобсена).
  // p1, p2: { x, y, pinned } — закреплённая точка (invMass=0) не двигается сама, но тянет партнёра.
  // restLength: целевая длина связи. tearFactor: во сколько раз связь может растянуться
  // относительно restLength, прежде чем порвётся (stretch = dist / restLength).
  // Возвращает новые координаты обеих точек и флаг broken; если flag broken=true — позиции
  // не корректируются (связь считается разорванной и в будущем не удовлетворяется).
  function satisfyConstraint(p1, p2, restLength, tearFactor) {
    var dx = p2.x - p1.x;
    var dy = p2.y - p1.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-6) dist = 1e-6;
    var stretch = dist / restLength;

    if (tearFactor != null && stretch > tearFactor) {
      return {
        p1: { x: p1.x, y: p1.y, pinned: !!p1.pinned },
        p2: { x: p2.x, y: p2.y, pinned: !!p2.pinned },
        broken: true,
        stretch: stretch
      };
    }

    var invMass1 = p1.pinned ? 0 : 1;
    var invMass2 = p2.pinned ? 0 : 1;
    var invSum = invMass1 + invMass2;

    if (invSum === 0) {
      // Обе точки закреплены — связь не может скорректироваться.
      return {
        p1: { x: p1.x, y: p1.y, pinned: true },
        p2: { x: p2.x, y: p2.y, pinned: true },
        broken: false,
        stretch: stretch
      };
    }

    var diff = (dist - restLength) / dist;
    var offsetX = dx * diff;
    var offsetY = dy * diff;

    var newP1 = p1.pinned
      ? { x: p1.x, y: p1.y, pinned: true }
      : { x: p1.x + offsetX * (invMass1 / invSum), y: p1.y + offsetY * (invMass1 / invSum), pinned: false };

    var newP2 = p2.pinned
      ? { x: p2.x, y: p2.y, pinned: true }
      : { x: p2.x - offsetX * (invMass2 / invSum), y: p2.y - offsetY * (invMass2 / invSum), pinned: false };

    return { p1: newP1, p2: newP2, broken: false, stretch: stretch };
  }

  var api = { verletStep: verletStep, satisfyConstraint: satisfyConstraint };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Cloth = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
