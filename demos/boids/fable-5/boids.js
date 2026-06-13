/*
 * Boids — чистая логика стаи без DOM.
 * Dual-mode: в браузере кладёт API в window.Boids, в node — module.exports.
 *
 * Боид: { x, y, vx, vy }. Мир тороидальный (wrap по краям).
 * Параметры: { perception, sepRadius, sepWeight, aliWeight, cohWeight,
 *              maxSpeed, minSpeed, maxForce }.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    perception: 70,
    sepRadius: 26,
    sepWeight: 1.6,
    aliWeight: 1.0,
    cohWeight: 0.8,
    maxSpeed: 170,
    minSpeed: 60,
    maxForce: 380,
  };

  // Кратчайшая разность координат на торе шириной size.
  function torusDelta(a, b, size) {
    var d = b - a;
    if (d > size / 2) d -= size;
    else if (d < -size / 2) d += size;
    return d;
  }

  /*
   * Пространственная сетка для поиска соседей за O(n).
   * Мир делится на равные клетки размером >= cellSize, точно покрывающие тор:
   * иначе укороченная граничная клетка теряет соседей через край.
   */
  function buildGrid(boids, cellSize, w, h) {
    var cols = Math.max(1, Math.floor(w / cellSize));
    var rows = Math.max(1, Math.floor(h / cellSize));
    var cellW = w / cols, cellH = h / rows;
    var map = new Map();
    for (var i = 0; i < boids.length; i++) {
      var cx = Math.min(Math.floor(boids[i].x / cellW), cols - 1);
      var cy = Math.min(Math.floor(boids[i].y / cellH), rows - 1);
      var key = cx + ',' + cy;
      var cell = map.get(key);
      if (!cell) map.set(key, cell = []);
      cell.push(i);
    }
    return { map: map, cols: cols, rows: rows, cellW: cellW, cellH: cellH };
  }

  // Индексы боидов в радиусе r от боида i (тороидальная метрика), через сетку.
  function neighborsOf(i, boids, grid, r, w, h) {
    var b = boids[i];
    var result = [];
    var rangeX = Math.ceil(r / grid.cellW);
    var rangeY = Math.ceil(r / grid.cellH);
    var bcx = Math.min(Math.floor(b.x / grid.cellW), grid.cols - 1);
    var bcy = Math.min(Math.floor(b.y / grid.cellH), grid.rows - 1);
    for (var dy = -rangeY; dy <= rangeY; dy++) {
      for (var dx = -rangeX; dx <= rangeX; dx++) {
        var cx = ((bcx + dx) % grid.cols + grid.cols) % grid.cols;
        var cy = ((bcy + dy) % grid.rows + grid.rows) % grid.rows;
        var cell = grid.map.get(cx + ',' + cy);
        if (!cell) continue;
        for (var k = 0; k < cell.length; k++) {
          var j = cell[k];
          if (j === i || result.indexOf(j) !== -1) continue;
          var ddx = torusDelta(b.x, boids[j].x, w);
          var ddy = torusDelta(b.y, boids[j].y, h);
          if (ddx * ddx + ddy * ddy <= r * r) result.push(j);
        }
      }
    }
    return result;
  }

  // Наивный поиск соседей — эталон для теста сетки.
  function neighborsNaive(i, boids, r, w, h) {
    var b = boids[i];
    var result = [];
    for (var j = 0; j < boids.length; j++) {
      if (j === i) continue;
      var dx = torusDelta(b.x, boids[j].x, w);
      var dy = torusDelta(b.y, boids[j].y, h);
      if (dx * dx + dy * dy <= r * r) result.push(j);
    }
    return result;
  }

  /*
   * Один шаг симуляции. Возвращает новый массив боидов (старый не мутирует).
   * dt — секунды.
   */
  function step(boids, params, w, h, dt) {
    var p = params;
    var cellSize = Math.max(p.perception, 8);
    var grid = buildGrid(boids, cellSize, w, h);
    var next = new Array(boids.length);

    for (var i = 0; i < boids.length; i++) {
      var b = boids[i];
      var near = neighborsOf(i, boids, grid, p.perception, w, h);

      var sepX = 0, sepY = 0;
      var aliX = 0, aliY = 0;
      var cohX = 0, cohY = 0;
      var sepN = 0;

      for (var k = 0; k < near.length; k++) {
        var o = boids[near[k]];
        var dx = torusDelta(b.x, o.x, w);
        var dy = torusDelta(b.y, o.y, h);
        var d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        // Разделение: от соседей ближе sepRadius, сильнее для близких.
        if (d < p.sepRadius) {
          sepX -= dx / d / d;
          sepY -= dy / d / d;
          sepN++;
        }
        aliX += o.vx;
        aliY += o.vy;
        cohX += dx;
        cohY += dy;
      }

      var ax = 0, ay = 0;
      if (near.length > 0) {
        // Выравнивание: к средней скорости соседей.
        aliX = aliX / near.length - b.vx;
        aliY = aliY / near.length - b.vy;
        // Сцепление: к центру масс соседей.
        cohX /= near.length;
        cohY /= near.length;
        ax = p.sepWeight * sepX * 60 + p.aliWeight * aliX + p.cohWeight * cohX;
        ay = p.sepWeight * sepY * 60 + p.aliWeight * aliY + p.cohWeight * cohY;
        var aMag = Math.sqrt(ax * ax + ay * ay);
        if (aMag > p.maxForce) {
          ax = ax / aMag * p.maxForce;
          ay = ay / aMag * p.maxForce;
        }
      }

      var vx = b.vx + ax * dt;
      var vy = b.vy + ay * dt;
      var speed = Math.sqrt(vx * vx + vy * vy) || 1e-6;
      if (speed > p.maxSpeed) { vx = vx / speed * p.maxSpeed; vy = vy / speed * p.maxSpeed; }
      if (speed < p.minSpeed) { vx = vx / speed * p.minSpeed; vy = vy / speed * p.minSpeed; }

      var x = (b.x + vx * dt) % w; if (x < 0) x += w;
      var y = (b.y + vy * dt) % h; if (y < 0) y += h;
      next[i] = { x: x, y: y, vx: vx, vy: vy };
    }
    return next;
  }

  var api = {
    DEFAULTS: DEFAULTS,
    torusDelta: torusDelta,
    buildGrid: buildGrid,
    neighborsOf: neighborsOf,
    neighborsNaive: neighborsNaive,
    step: step,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Boids = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
