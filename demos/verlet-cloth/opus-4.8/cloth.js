'use strict';

// Ткань на верлет-интегрировании — чистая физика, без DOM.
// Dual-mode: браузер → window.Cloth, node → module.exports (см. pendulum.js).
//
// Частица: { x, y, ox, oy, pinned }  — ox,oy = позиция на прошлом шаге.
// Связь:   { a, b, rest, broken }    — индексы частиц + длина покоя.

// Один шаг верле для частицы: x' = x + (x - ox)*damping + a*dt².
// Закреплённая частица не двигается. Скорость неявна (через x - ox).
function integrateParticle(p, ax, ay, dt, damping) {
  if (p.pinned) { p.ox = p.x; p.oy = p.y; return; }
  const vx = (p.x - p.ox) * damping;
  const vy = (p.y - p.oy) * damping;
  p.ox = p.x;
  p.oy = p.y;
  p.x += vx + ax * dt * dt;
  p.y += vy + ay * dt * dt;
}

// Прогон верле по всем частицам с общим ускорением (gx, gy).
function integrate(points, gx, gy, dt, damping) {
  for (let i = 0; i < points.length; i++) {
    integrateParticle(points[i], gx, gy, dt, damping);
  }
}

// Решение одной дистанц-связи: сдвигает обе частицы к rest-длине.
// Возвращает strain = dist / rest (>1 — растянута, <1 — сжата).
// Вес закреплённой частицы = 0, поэтому весь сдвиг берёт свободная.
function solveConstraint(c, points) {
  const pa = points[c.a];
  const pb = points[c.b];
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const dist = Math.hypot(dx, dy) || 1e-9;
  const strain = dist / c.rest;
  const wa = pa.pinned ? 0 : 1;
  const wb = pb.pinned ? 0 : 1;
  const wSum = wa + wb;
  if (wSum === 0) return strain;
  const diff = (dist - c.rest) / dist;
  const ox = (dx * diff) / wSum;
  const oy = (dy * diff) / wSum;
  if (wa) { pa.x += ox; pa.y += oy; }
  if (wb) { pb.x -= ox; pb.y -= oy; }
  return strain;
}

// Связь рвётся, когда растяжение превышает порог: dist > rest * tearFactor.
// Проверка по «сырой» длине ДО коррекции — порог сравнивается с фактом кадра.
function shouldTear(c, points, tearFactor) {
  if (c.broken) return false;
  const pa = points[c.a];
  const pb = points[c.b];
  const dist = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  return dist > c.rest * tearFactor;
}

// Релаксация: iterations проходов по связям. Сначала отрываем перетянутые,
// потом стягиваем оставшиеся. Больше проходов — жёстче ткань.
function solveConstraints(points, constraints, iterations, tearFactor) {
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < constraints.length; i++) {
      const c = constraints[i];
      if (c.broken) continue;
      if (tearFactor > 0 && shouldTear(c, points, tearFactor)) {
        c.broken = true;
        continue;
      }
      solveConstraint(c, points);
    }
  }
}

// Сетка cols×rows с шагом spacing, левый верхний угол в (x0,y0).
// pinEvery — каждая n-я частица верхнего ряда закреплена (углы — всегда).
function makeCloth(cols, rows, spacing, x0, y0, pinEvery) {
  const points = [];
  const constraints = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * spacing;
      const y = y0 + r * spacing;
      const pinned = r === 0 && (c % pinEvery === 0 || c === cols - 1);
      points.push({ x, y, ox: x, oy: y, pinned });
      const i = r * cols + c;
      if (c > 0) constraints.push({ a: i - 1, b: i, rest: spacing, broken: false });
      if (r > 0) constraints.push({ a: i - cols, b: i, rest: spacing, broken: false });
    }
  }
  return { points, constraints, cols, rows, spacing };
}

const ClothAPI = {
  integrateParticle,
  integrate,
  solveConstraint,
  shouldTear,
  solveConstraints,
  makeCloth,
};

// Dual-mode: node — экспорт; браузер (<script>) — глобал window.Cloth.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ClothAPI;
} else {
  window.Cloth = ClothAPI;
}
