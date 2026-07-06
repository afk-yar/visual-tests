'use strict';
// Клеточный автомат «падающий песок» — чистая логика правил, без DOM/canvas.
// Дуал-mode: в браузере кладёт API в window.Automaton, в node — module.exports.
(function (root) {
  var EMPTY = 0;
  var SAND = 1;
  var WATER = 2;
  var STONE = 3;
  var WOOD = 4;
  var FIRE = 5;
  var SMOKE = 6;

  var MATERIALS = [
    { id: SAND, name: 'sand', label: 'Песок', color: '#d9b35c' },
    { id: WATER, name: 'water', label: 'Вода', color: '#3d8bd6' },
    { id: STONE, name: 'stone', label: 'Камень', color: '#8a8f98' },
    { id: WOOD, name: 'wood', label: 'Дерево', color: '#8a5a34' },
    { id: FIRE, name: 'fire', label: 'Огонь', color: '#e2601f' },
    { id: SMOKE, name: 'smoke', label: 'Дым', color: '#6b7280' },
    { id: EMPTY, name: 'empty', label: 'Ластик', color: 'transparent' }
  ];

  var FIRE_LIFE = 45;
  var SMOKE_LIFE = 90;
  var IGNITE_CHANCE = 0.1;
  var FIRE_WATER_EXTRA_DECAY = 8;

  function createGrid(width, height) {
    return {
      width: width,
      height: height,
      cell: new Uint8Array(width * height),
      life: new Uint8Array(width * height)
    };
  }

  function indexOf(width, x, y) {
    return y * width + x;
  }

  // Чтение клетки с учётом границ мира: за пределами поля — «камень» (стена),
  // это не даёт веществам утекать/телепортироваться за край и не создаёт
  // разницы в поведении у левой и правой стенки.
  function readCell(cell, width, height, x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return STONE;
    return cell[indexOf(width, x, y)];
  }

  function neighbors8(cell, width, height, x, y) {
    return [
      readCell(cell, width, height, x - 1, y - 1), readCell(cell, width, height, x, y - 1), readCell(cell, width, height, x + 1, y - 1),
      readCell(cell, width, height, x - 1, y), readCell(cell, width, height, x + 1, y),
      readCell(cell, width, height, x - 1, y + 1), readCell(cell, width, height, x, y + 1), readCell(cell, width, height, x + 1, y + 1)
    ];
  }

  // ---- Чистые функции решений для ОДНОЙ клетки (никаких побочных эффектов) ----
  // Каждая функция получает уже прочитанные типы соседей и функцию rand() —
  // вся «случайность»/переключение передаётся снаружи, поэтому функции легко
  // тестировать детерминированно.

  // Песок: падает вниз; если под ним вода — тонет в ней (обмен местами на
  // один шаг, без телепортации); если внизу упор — сыплется по диагонали,
  // а при двух равнозначных диагоналях сторону выбирает rand(), а не жёстко
  // закодированное предпочтение «сначала налево» или «сначала направо».
  function decideSandMove(below, belowLeft, belowRight, rand) {
    if (below === EMPTY) return { dx: 0, dy: 1, swapWith: EMPTY };
    if (below === WATER) return { dx: 0, dy: 1, swapWith: WATER };
    var leftOpen = belowLeft === EMPTY;
    var rightOpen = belowRight === EMPTY;
    if (leftOpen && rightOpen) {
      return rand() < 0.5 ? { dx: -1, dy: 1, swapWith: EMPTY } : { dx: 1, dy: 1, swapWith: EMPTY };
    }
    if (leftOpen) return { dx: -1, dy: 1, swapWith: EMPTY };
    if (rightOpen) return { dx: 1, dy: 1, swapWith: EMPTY };
    return null;
  }

  // Вода: сперва падает, при блокировке — стекает по диагонали, а если и это
  // невозможно — растекается в стороны. Все тройные тай-брейки решаются
  // симметрично через rand().
  function decideWaterMove(below, belowLeft, belowRight, left, right, rand) {
    if (below === EMPTY) return { dx: 0, dy: 1 };
    var dLeftOpen = belowLeft === EMPTY;
    var dRightOpen = belowRight === EMPTY;
    if (dLeftOpen && dRightOpen) return rand() < 0.5 ? { dx: -1, dy: 1 } : { dx: 1, dy: 1 };
    if (dLeftOpen) return { dx: -1, dy: 1 };
    if (dRightOpen) return { dx: 1, dy: 1 };
    var leftOpen = left === EMPTY;
    var rightOpen = right === EMPTY;
    if (leftOpen && rightOpen) return rand() < 0.5 ? { dx: -1, dy: 0 } : { dx: 1, dy: 0 };
    if (leftOpen) return { dx: -1, dy: 0 };
    if (rightOpen) return { dx: 1, dy: 0 };
    return null;
  }

  // Дым: поднимается вверх, при блокировке — по диагонали вверх; та же
  // симметричная тай-брейк логика, что и у песка/воды.
  function decideSmokeMove(above, aboveLeft, aboveRight, rand) {
    if (above === EMPTY) return { dx: 0, dy: -1 };
    var leftOpen = aboveLeft === EMPTY;
    var rightOpen = aboveRight === EMPTY;
    if (leftOpen && rightOpen) return rand() < 0.5 ? { dx: -1, dy: -1 } : { dx: 1, dy: -1 };
    if (leftOpen) return { dx: -1, dy: -1 };
    if (rightOpen) return { dx: 1, dy: -1 };
    return null;
  }

  function shouldIgnite(hasAdjacentFire, rand, chance) {
    return !!hasAdjacentFire && rand() < (chance == null ? IGNITE_CHANCE : chance);
  }

  function decayFireLife(life, hasAdjacentWater) {
    var decay = 1 + (hasAdjacentWater ? FIRE_WATER_EXTRA_DECAY : 0);
    return life - decay;
  }

  function decaySmokeLife(life) {
    return life - 1;
  }

  // ---- Полный шаг симуляции ----
  // Каждое вещество за один тик перемещается максимум на одну клетку —
  // это и есть отсутствие телепортаций. Плавность движения на экране
  // достигается за счёт нескольких тиков за кадр (см. main.js), а не за
  // счёт прыжков через несколько клеток внутри одного тика.
  //
  // Честность влево/вправо обеспечена так:
  //  1) Тай-брейки между двумя равнозначными направлениями (обе диагонали
  //     свободны, обе стороны свободны) решает переданный rand(), а не
  //     жёстко закодированный порядок проверки.
  //  2) Порядок обхода клеток по x чередуется по чётности frame (слева
  //     направо / справа налево). Это влияет на то, кто из ДВУХ РАЗНЫХ
  //     источников выигрывает спор за одну и ту же целевую клетку — и раз
  //     направление обхода чередуется, победитель тоже чередуется, а не
  //     всегда один и тот же (см. automaton.test.js).
  function step(grid, options) {
    var width = grid.width, height = grid.height;
    var cell = grid.cell, life = grid.life;
    var opts = options || {};
    var rand = opts.rand || Math.random;
    var frame = opts.frame || 0;
    var len = width * height;

    var nextCell = new Uint8Array(cell);
    var nextLife = new Uint8Array(life);
    var settled = new Uint8Array(len); // 1 = итоговое значение клетки в этом тике уже зафиксировано

    var leftToRight = frame % 2 === 0;
    var xsOrder = new Array(width);
    if (leftToRight) {
      for (var i = 0; i < width; i++) xsOrder[i] = i;
    } else {
      for (var i2 = 0; i2 < width; i2++) xsOrder[i2] = width - 1 - i2;
    }

    function tryMove(x, y, move, sourceType, becomesAtSource) {
      var nx = x + move.dx, ny = y + move.dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) return false;
      var destIdx = indexOf(width, nx, ny);
      if (settled[destIdx]) return false;
      var srcIdx = indexOf(width, x, y);
      nextCell[destIdx] = sourceType;
      nextLife[destIdx] = 0;
      settled[destIdx] = 1;
      nextCell[srcIdx] = becomesAtSource;
      nextLife[srcIdx] = 0;
      settled[srcIdx] = 1;
      return true;
    }

    // Pass 1: гравитация — песок и вода. Снизу вверх (низ определяет, кто из
    // верхних соседей вообще может упасть в этом тике).
    for (var y1 = height - 1; y1 >= 0; y1--) {
      for (var xi = 0; xi < width; xi++) {
        var x1 = xsOrder[xi];
        var idx1 = indexOf(width, x1, y1);
        if (settled[idx1]) continue;
        var t1 = cell[idx1];
        if (t1 === SAND) {
          var below = readCell(cell, width, height, x1, y1 + 1);
          var belowLeft = readCell(cell, width, height, x1 - 1, y1 + 1);
          var belowRight = readCell(cell, width, height, x1 + 1, y1 + 1);
          var move = decideSandMove(below, belowLeft, belowRight, rand);
          if (move) tryMove(x1, y1, move, SAND, move.swapWith === WATER ? WATER : EMPTY);
        } else if (t1 === WATER) {
          var wBelow = readCell(cell, width, height, x1, y1 + 1);
          var wBelowLeft = readCell(cell, width, height, x1 - 1, y1 + 1);
          var wBelowRight = readCell(cell, width, height, x1 + 1, y1 + 1);
          var wLeft = readCell(cell, width, height, x1 - 1, y1);
          var wRight = readCell(cell, width, height, x1 + 1, y1);
          var wMove = decideWaterMove(wBelow, wBelowLeft, wBelowRight, wLeft, wRight, rand);
          if (wMove) tryMove(x1, y1, wMove, WATER, EMPTY);
        }
      }
    }

    // Pass 2: плавучесть — дым. Сверху вниз (цель дыма — меньший y, значит
    // «пункт назначения» обрабатывается раньше источника).
    for (var y2 = 0; y2 < height; y2++) {
      for (var xj = 0; xj < width; xj++) {
        var x2 = xsOrder[xj];
        var idx2 = indexOf(width, x2, y2);
        if (settled[idx2]) continue;
        if (cell[idx2] !== SMOKE) continue;
        var newLife = decaySmokeLife(life[idx2]);
        var above = readCell(cell, width, height, x2, y2 - 1);
        var aboveLeft = readCell(cell, width, height, x2 - 1, y2 - 1);
        var aboveRight = readCell(cell, width, height, x2 + 1, y2 - 1);
        var sMove = decideSmokeMove(above, aboveLeft, aboveRight, rand);
        if (newLife <= 0) {
          if (sMove) {
            var nx = x2 + sMove.dx, ny = y2 + sMove.dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              var destIdx = indexOf(width, nx, ny);
              if (!settled[destIdx]) {
                nextCell[destIdx] = EMPTY; nextLife[destIdx] = 0; settled[destIdx] = 1;
              }
            }
          }
          nextCell[idx2] = EMPTY; nextLife[idx2] = 0; settled[idx2] = 1;
        } else if (sMove) {
          var moved = tryMove(x2, y2, sMove, SMOKE, EMPTY);
          if (moved) {
            var destIdx2 = indexOf(width, x2 + sMove.dx, y2 + sMove.dy);
            nextLife[destIdx2] = newLife;
          } else {
            nextLife[idx2] = newLife;
          }
        } else {
          nextLife[idx2] = newLife;
        }
      }
    }

    // Pass 3: превращения на месте (без перемещения) — огонь угасает и
    // поджигает соседнее дерево. Дерево и огонь никогда не были целью
    // перемещений в Pass 1/2 (в prev-состоянии они не EMPTY/WATER), поэтому
    // их можно безопасно обработать здесь, читая только исходную `cell`.
    for (var idx3 = 0; idx3 < len; idx3++) {
      var t3 = cell[idx3];
      if (t3 === FIRE) {
        var x3 = idx3 % width, y3 = (idx3 / width) | 0;
        var hasWater = neighbors8(cell, width, height, x3, y3).indexOf(WATER) !== -1;
        var fl = decayFireLife(life[idx3], hasWater);
        if (fl <= 0) {
          nextCell[idx3] = SMOKE;
          nextLife[idx3] = SMOKE_LIFE;
        } else {
          nextLife[idx3] = fl;
        }
      } else if (t3 === WOOD) {
        var x3b = idx3 % width, y3b = (idx3 / width) | 0;
        var hasFire = neighbors8(cell, width, height, x3b, y3b).indexOf(FIRE) !== -1;
        if (shouldIgnite(hasFire, rand, IGNITE_CHANCE)) {
          nextCell[idx3] = FIRE;
          nextLife[idx3] = FIRE_LIFE;
        }
      }
    }

    return { width: width, height: height, cell: nextCell, life: nextLife };
  }

  var api = {
    EMPTY: EMPTY, SAND: SAND, WATER: WATER, STONE: STONE, WOOD: WOOD, FIRE: FIRE, SMOKE: SMOKE,
    MATERIALS: MATERIALS,
    FIRE_LIFE: FIRE_LIFE, SMOKE_LIFE: SMOKE_LIFE, IGNITE_CHANCE: IGNITE_CHANCE,
    createGrid: createGrid,
    indexOf: indexOf,
    readCell: readCell,
    neighbors8: neighbors8,
    decideSandMove: decideSandMove,
    decideWaterMove: decideWaterMove,
    decideSmokeMove: decideSmokeMove,
    shouldIgnite: shouldIgnite,
    decayFireLife: decayFireLife,
    decaySmokeLife: decaySmokeLife,
    step: step
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Automaton = api;
  }
})(typeof window !== 'undefined' ? window : this);
