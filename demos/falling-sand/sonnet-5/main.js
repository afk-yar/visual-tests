'use strict';
(function () {
  var A = window.Automaton;

  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d', { alpha: false });
  var off = document.createElement('canvas');
  var offCtx = off.getContext('2d');

  var DPR_CAP = 2;
  var TARGET_CELLS = 26000; // держим размер сетки в разумных пределах на любом экране

  var MATERIAL_TO_ID = {
    empty: A.EMPTY, sand: A.SAND, water: A.WATER, stone: A.STONE,
    wood: A.WOOD, fire: A.FIRE, smoke: A.SMOKE
  };

  var BASE_COLOR = {};
  BASE_COLOR[A.EMPTY] = [13, 15, 19];
  BASE_COLOR[A.SAND] = [217, 179, 92];
  BASE_COLOR[A.WATER] = [55, 125, 199];
  BASE_COLOR[A.STONE] = [123, 129, 138];
  BASE_COLOR[A.WOOD] = [130, 84, 49];

  var state = {
    grid: null,
    cellSize: 6,
    cols: 0,
    rows: 0,
    material: 'sand',
    brushRadius: 3,
    paused: false,
    frame: 0,
    pointerDown: false,
    lastGX: null,
    lastGY: null,
    imageData: null
  };

  // Быстрый детерминированный хэш для лёгкой зернистости песка/камня —
  // чисто косметическая деталь рендера, не влияет на симуляцию.
  function hash2(x, y) {
    var h = (x * 374761393 + y * 668265263) ^ (x * 2246822519);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  function setupGrid(preserve) {
    var cssW = Math.max(1, window.innerWidth);
    var cssH = Math.max(1, window.innerHeight);
    var cellSize = Math.max(4, Math.round(Math.sqrt((cssW * cssH) / TARGET_CELLS)));
    var cols = Math.max(20, Math.floor(cssW / cellSize));
    var rows = Math.max(15, Math.floor(cssH / cellSize));

    var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    off.width = cols;
    off.height = rows;
    offCtx.imageSmoothingEnabled = false;
    ctx.imageSmoothingEnabled = false;

    var oldGrid = state.grid;
    var oldCols = state.cols, oldRows = state.rows;

    state.cellSize = cellSize;
    state.cols = cols;
    state.rows = rows;
    state.grid = A.createGrid(cols, rows);
    state.imageData = offCtx.createImageData(cols, rows);

    if (preserve && oldGrid) {
      var copyCols = Math.min(cols, oldCols);
      var copyRows = Math.min(rows, oldRows);
      for (var y = 0; y < copyRows; y++) {
        for (var x = 0; x < copyCols; x++) {
          var srcIdx = A.indexOf(oldCols, x, y);
          var dstIdx = A.indexOf(cols, x, y);
          state.grid.cell[dstIdx] = oldGrid.cell[srcIdx];
          state.grid.life[dstIdx] = oldGrid.life[srcIdx];
        }
      }
    } else {
      seedFloor();
    }
  }

  function seedFloor() {
    var cols = state.cols, rows = state.rows;
    var floorY = rows - Math.max(2, Math.round(rows * 0.06));
    for (var x = 0; x < cols; x++) {
      for (var y = floorY; y < rows; y++) {
        state.grid.cell[A.indexOf(cols, x, y)] = A.STONE;
      }
    }
  }

  function clientToGrid(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var cssX = clientX - rect.left;
    var cssY = clientY - rect.top;
    var gx = Math.floor((cssX / rect.width) * state.cols);
    var gy = Math.floor((cssY / rect.height) * state.rows);
    return { x: gx, y: gy };
  }

  function paintDisk(gx, gy, radius, materialId) {
    var grid = state.grid;
    var r2 = radius * radius;
    for (var dy = -radius; dy <= radius; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        var x = gx + dx, y = gy + dy;
        if (x < 0 || x >= state.cols || y < 0 || y >= state.rows) continue;
        var idx = A.indexOf(state.cols, x, y);
        grid.cell[idx] = materialId;
        grid.life[idx] = materialId === A.FIRE ? A.FIRE_LIFE : (materialId === A.SMOKE ? A.SMOKE_LIFE : 0);
      }
    }
  }

  function paintLine(x0, y0, x1, y1, radius, materialId) {
    var dx = x1 - x0, dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.6)));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      paintDisk(Math.round(x0 + dx * t), Math.round(y0 + dy * t), radius, materialId);
    }
  }

  function onPointerDown(e) {
    state.pointerDown = true;
    var g = clientToGrid(e.clientX, e.clientY);
    state.lastGX = g.x;
    state.lastGY = g.y;
    paintDisk(g.x, g.y, state.brushRadius, MATERIAL_TO_ID[state.material]);
  }

  function onPointerMove(e) {
    if (!state.pointerDown) return;
    var g = clientToGrid(e.clientX, e.clientY);
    if (state.lastGX === null) {
      paintDisk(g.x, g.y, state.brushRadius, MATERIAL_TO_ID[state.material]);
    } else {
      paintLine(state.lastGX, state.lastGY, g.x, g.y, state.brushRadius, MATERIAL_TO_ID[state.material]);
    }
    state.lastGX = g.x;
    state.lastGY = g.y;
  }

  function onPointerUp() {
    state.pointerDown = false;
    state.lastGX = null;
    state.lastGY = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  var materialsEl = document.getElementById('materials');
  materialsEl.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.mat-btn') : null;
    if (!btn) return;
    state.material = btn.getAttribute('data-material');
    var all = materialsEl.querySelectorAll('.mat-btn');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
    btn.classList.add('active');
  });

  var brushInput = document.getElementById('brush-size');
  var brushValue = document.getElementById('brush-size-value');
  brushInput.addEventListener('input', function () {
    state.brushRadius = parseInt(brushInput.value, 10);
    brushValue.textContent = String(state.brushRadius);
  });

  var pauseBtn = document.getElementById('btn-pause');
  pauseBtn.addEventListener('click', function () {
    state.paused = !state.paused;
    pauseBtn.textContent = state.paused ? 'Играть' : 'Пауза';
  });

  var clearBtn = document.getElementById('btn-clear');
  clearBtn.addEventListener('click', function () {
    state.grid = A.createGrid(state.cols, state.rows);
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { setupGrid(true); }, 120);
  });

  function render() {
    var grid = state.grid;
    var data = state.imageData.data;
    var cell = grid.cell, life = grid.life;
    var cols = state.cols, rows = state.rows;
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var idx = y * cols + x;
        var t = cell[idx];
        var r, g, b, a = 255;
        if (t === A.FIRE) {
          var lf = Math.max(0, Math.min(1, life[idx] / A.FIRE_LIFE));
          r = 235;
          g = Math.round(70 + 140 * lf);
          b = Math.round(24 * lf);
        } else if (t === A.SMOKE) {
          var ls = Math.max(0, Math.min(1, life[idx] / A.SMOKE_LIFE));
          var v = 60 + Math.round(40 * (1 - ls));
          r = v; g = v; b = v + 6;
          a = Math.round(50 + 150 * ls);
        } else {
          var c = BASE_COLOR[t] || BASE_COLOR[A.EMPTY];
          var jitter = (t === A.SAND || t === A.STONE) ? Math.round((hash2(x, y) - 0.5) * 20) : 0;
          r = c[0] + jitter;
          g = c[1] + jitter;
          b = c[2] + jitter;
        }
        var p = idx * 4;
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = a;
      }
    }
    offCtx.putImageData(state.imageData, 0, 0);
    ctx.drawImage(off, 0, 0, cols, rows, 0, 0, canvas.width, canvas.height);
  }

  var TICK_MS = 1000 / 60;
  var MAX_STEPS_PER_FRAME = 4; // защита от «спирали смерти» при большом dt
  var acc = 0;
  var lastTime = null;

  function loop(now) {
    if (lastTime === null) lastTime = now;
    var dt = now - lastTime;
    lastTime = now;
    if (dt > 250) dt = 250; // клампим большие скачки (смена вкладки, лаги)

    if (!state.paused) {
      acc += dt;
      var steps = 0;
      while (acc >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
        state.grid = A.step(state.grid, { rand: Math.random, frame: state.frame++ });
        acc -= TICK_MS;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) acc = 0;
    }

    render();
    requestAnimationFrame(loop);
  }

  setupGrid(false);
  requestAnimationFrame(loop);
})();
