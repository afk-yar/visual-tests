/*
 * «Падающий песок» — клеточный автомат, чистая логика без DOM.
 * Dual-mode: в браузере кладёт API в window.Sand, в node — module.exports.
 *
 * Поле — Uint8Array размером w*h, индекс = y*w + x. y растёт вниз.
 * rng — функция () => [0,1) (в тестах детерминированная).
 */
(function (global) {
  'use strict';

  var EMPTY = 0, SAND = 1, WATER = 2, STONE = 3, WOOD = 4, FIRE = 5, SMOKE = 6;

  // Вероятности поведения огня/дыма за один шаг.
  var FIRE_DIE = 0.03;     // огонь гаснет (в дым)
  var FIRE_SPREAD = 0.25;  // поджигает соседнее дерево
  var SMOKE_FADE = 0.025;  // дым растворяется
  var SMOKE_DRIFT = 0.4;   // дым уходит вбок, а не вверх

  function makeGrid(w, h) {
    return { w: w, h: h, cells: new Uint8Array(w * h) };
  }

  function get(g, x, y) {
    if (x < 0 || x >= g.w || y < 0 || y >= g.h) return STONE; // границы — стены
    return g.cells[y * g.w + x];
  }

  function set(g, x, y, v) {
    if (x < 0 || x >= g.w || y < 0 || y >= g.h) return;
    g.cells[y * g.w + x] = v;
  }

  function swap(g, x1, y1, x2, y2) {
    var i = y1 * g.w + x1, j = y2 * g.w + x2;
    var t = g.cells[i];
    g.cells[i] = g.cells[j];
    g.cells[j] = t;
  }

  /*
   * Один шаг автомата. moved — рабочий буфер (Uint8Array той же длины),
   * чтобы клетка не делала два хода за шаг. flip — чередование порядка
   * обхода по x между шагами, убирает систематический перекос влево/вправо.
   */
  function step(g, rng, moved, flip) {
    var w = g.w, h = g.h, cells = g.cells;
    moved.fill(0);

    // Снизу вверх — падающие вещества (песок, вода) и огонь.
    for (var y = h - 1; y >= 0; y--) {
      var x0 = flip ? w - 1 : 0, dxDir = flip ? -1 : 1;
      for (var k = 0, x = x0; k < w; k++, x += dxDir) {
        var i = y * w + x;
        if (moved[i]) continue;
        var v = cells[i];

        if (v === SAND) {
          stepSand(g, x, y, rng, moved);
        } else if (v === WATER) {
          stepWater(g, x, y, rng, moved);
        } else if (v === FIRE) {
          stepFire(g, x, y, rng, moved);
        }
      }
    }

    // Сверху вниз — поднимающийся дым.
    for (var y2 = 0; y2 < h; y2++) {
      var x02 = flip ? w - 1 : 0, dxDir2 = flip ? -1 : 1;
      for (var k2 = 0, x2 = x02; k2 < w; k2++, x2 += dxDir2) {
        var i2 = y2 * w + x2;
        if (moved[i2]) continue;
        if (cells[i2] === SMOKE) stepSmoke(g, x2, y2, rng, moved);
      }
    }
  }

  function markMoved(g, moved, x, y) {
    moved[y * g.w + x] = 1;
  }

  function stepSand(g, x, y, rng, moved) {
    var below = get(g, x, y + 1);
    if (below === EMPTY || below === WATER || below === SMOKE) {
      swap(g, x, y, x, y + 1); // сквозь воду и дым песок тонет
      markMoved(g, moved, x, y + 1);
      return;
    }
    var dir = rng() < 0.5 ? -1 : 1;
    var d1 = get(g, x + dir, y + 1), s1 = get(g, x + dir, y);
    if ((d1 === EMPTY || d1 === WATER) && s1 === EMPTY) {
      swap(g, x, y, x + dir, y + 1);
      markMoved(g, moved, x + dir, y + 1);
      return;
    }
    var d2 = get(g, x - dir, y + 1), s2 = get(g, x - dir, y);
    if ((d2 === EMPTY || d2 === WATER) && s2 === EMPTY) {
      swap(g, x, y, x - dir, y + 1);
      markMoved(g, moved, x - dir, y + 1);
    }
  }

  function stepWater(g, x, y, rng, moved) {
    if (get(g, x, y + 1) === EMPTY) {
      swap(g, x, y, x, y + 1);
      markMoved(g, moved, x, y + 1);
      return;
    }
    var dir = rng() < 0.5 ? -1 : 1;
    if (get(g, x + dir, y + 1) === EMPTY) {
      swap(g, x, y, x + dir, y + 1);
      markMoved(g, moved, x + dir, y + 1);
      return;
    }
    if (get(g, x - dir, y + 1) === EMPTY) {
      swap(g, x, y, x - dir, y + 1);
      markMoved(g, moved, x - dir, y + 1);
      return;
    }
    if (get(g, x + dir, y) === EMPTY) {
      swap(g, x, y, x + dir, y);
      markMoved(g, moved, x + dir, y);
      return;
    }
    if (get(g, x - dir, y) === EMPTY) {
      swap(g, x, y, x - dir, y);
      markMoved(g, moved, x - dir, y);
    }
  }

  function stepFire(g, x, y, rng, moved) {
    // Поджигаем соседнее дерево.
    var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (var k = 0; k < 4; k++) {
      var nx = x + dirs[k][0], ny = y + dirs[k][1];
      if (get(g, nx, ny) === WOOD && rng() < FIRE_SPREAD) {
        set(g, nx, ny, FIRE);
        markMoved(g, moved, nx, ny);
      }
    }
    // Гаснем в дым.
    if (rng() < FIRE_DIE) {
      set(g, x, y, SMOKE);
      markMoved(g, moved, x, y);
    }
  }

  function stepSmoke(g, x, y, rng, moved) {
    if (rng() < SMOKE_FADE) {
      set(g, x, y, EMPTY);
      return;
    }
    var dir = rng() < 0.5 ? -1 : 1;
    if (get(g, x, y - 1) === EMPTY && rng() > SMOKE_DRIFT) {
      swap(g, x, y, x, y - 1);
      markMoved(g, moved, x, y - 1);
      return;
    }
    if (get(g, x + dir, y - 1) === EMPTY) {
      swap(g, x, y, x + dir, y - 1);
      markMoved(g, moved, x + dir, y - 1);
      return;
    }
    if (get(g, x + dir, y) === EMPTY) {
      swap(g, x, y, x + dir, y);
      markMoved(g, moved, x + dir, y);
    }
  }

  // Количество клеток данного вещества (для тестов сохранения).
  function count(g, v) {
    var n = 0;
    for (var i = 0; i < g.cells.length; i++) if (g.cells[i] === v) n++;
    return n;
  }

  var api = {
    EMPTY: EMPTY, SAND: SAND, WATER: WATER, STONE: STONE,
    WOOD: WOOD, FIRE: FIRE, SMOKE: SMOKE,
    makeGrid: makeGrid,
    get: get,
    set: set,
    step: step,
    count: count,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Sand = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
