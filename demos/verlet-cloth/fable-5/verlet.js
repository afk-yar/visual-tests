/*
 * Ткань на верлет-интегрировании — чистая физика без DOM.
 * Dual-mode: в браузере кладёт API в window.Verlet, в node — module.exports.
 *
 * Частица: { x, y, px, py, pinned } (px, py — позиция на прошлом шаге).
 * Связь:   { a, b, rest, broken } (индексы частиц и длина покоя).
 */
(function (global) {
  'use strict';

  /*
   * Сетка ткани cols x rows с шагом spacing, левый верхний угол в (x0, y0).
   * pinEvery — каждая n-я точка верхнего ряда закреплена (всегда включая углы).
   */
  function makeCloth(cols, rows, spacing, x0, y0, pinEvery) {
    var points = [];
    var constraints = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var x = x0 + c * spacing;
        var y = y0 + r * spacing;
        points.push({
          x: x, y: y, px: x, py: y,
          pinned: r === 0 && (c % pinEvery === 0 || c === cols - 1),
        });
        var i = r * cols + c;
        if (c > 0) constraints.push({ a: i - 1, b: i, rest: spacing, broken: false });
        if (r > 0) constraints.push({ a: i - cols, b: i, rest: spacing, broken: false });
      }
    }
    return { points: points, constraints: constraints, cols: cols, rows: rows };
  }

  // Шаг Верле: инерция + внешнее ускорение (gx, gy), затухание damping.
  function integrate(points, dt, gx, gy, damping) {
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (p.pinned) { p.px = p.x; p.py = p.y; continue; }
      var nx = p.x + (p.x - p.px) * damping + gx * dt * dt;
      var ny = p.y + (p.y - p.py) * damping + gy * dt * dt;
      p.px = p.x; p.py = p.y;
      p.x = nx; p.y = ny;
    }
  }

  /*
   * Релаксация связей. Связь длиннее rest * tearFactor рвётся (broken = true).
   * iterations — число проходов: больше — жёстче ткань.
   */
  function solveConstraints(points, constraints, iterations, tearFactor) {
    for (var it = 0; it < iterations; it++) {
      for (var i = 0; i < constraints.length; i++) {
        var c = constraints[i];
        if (c.broken) continue;
        var pa = points[c.a], pb = points[c.b];
        var dx = pb.x - pa.x, dy = pb.y - pa.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1e-9;
        if (tearFactor > 0 && dist > c.rest * tearFactor) {
          c.broken = true;
          continue;
        }
        var diff = (dist - c.rest) / dist;
        var wa = pa.pinned ? 0 : 1;
        var wb = pb.pinned ? 0 : 1;
        var wSum = wa + wb;
        if (wSum === 0) continue;
        var ox = dx * diff / wSum, oy = dy * diff / wSum;
        if (wa) { pa.x += ox * wa; pa.y += oy * wa; }
        if (wb) { pb.x -= ox * wb; pb.y -= oy * wb; }
      }
    }
  }

  var api = {
    makeCloth: makeCloth,
    integrate: integrate,
    solveConstraints: solveConstraints,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Verlet = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
