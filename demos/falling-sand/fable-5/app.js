/* Падающий песок — рендер и кисть. Автомат — в sand.js (window.Sand). */
(function () {
  'use strict';

  var S = window.Sand;

  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');
  var hud = document.getElementById('hud');

  var CELL = 4; // пикселей на клетку

  // Палитра: базовый цвет + вариация для живости.
  var COLORS = {};
  COLORS[S.EMPTY] = [14, 16, 22];
  COLORS[S.SAND] = [216, 178, 100];
  COLORS[S.WATER] = [64, 120, 210];
  COLORS[S.STONE] = [110, 115, 126];
  COLORS[S.WOOD] = [122, 84, 52];
  COLORS[S.FIRE] = [240, 120, 40];
  COLORS[S.SMOKE] = [120, 120, 130];

  var grid, moved, img, variation;
  var W = 0, H = 0;
  var flip = false;
  var paused = false;

  function init() {
    W = Math.floor(canvas.clientWidth / CELL);
    H = Math.floor(canvas.clientHeight / CELL);
    canvas.width = W;
    canvas.height = H;
    canvas.style.imageRendering = 'pixelated';
    grid = S.makeGrid(W, H);
    moved = new Uint8Array(W * H);
    img = ctx.createImageData(W, H);
    // Шум яркости фиксирован за клеткой — песок не «кипит».
    variation = new Float32Array(W * H);
    for (var i = 0; i < variation.length; i++) variation[i] = 0.85 + Math.random() * 0.3;
    scene();
  }

  // Стартовая сцена: каменные полки и деревянный домик.
  function scene() {
    for (var x = Math.floor(W * 0.1); x < W * 0.45; x++) {
      S.set(grid, x, Math.floor(H * 0.4), S.STONE);
    }
    for (var x2 = Math.floor(W * 0.55); x2 < W * 0.92; x2++) {
      S.set(grid, x2, Math.floor(H * 0.62), S.STONE);
    }
    var bx = Math.floor(W * 0.66), by = Math.floor(H * 0.62);
    for (var t = 0; t < 12; t++) {
      S.set(grid, bx + t, by - 1, S.WOOD);
      S.set(grid, bx + t, by - 9, S.WOOD);
      S.set(grid, bx, by - 1 - t % 9, S.WOOD);
      S.set(grid, bx + 11, by - 1 - t % 9, S.WOOD);
    }
  }

  init();
  window.addEventListener('resize', init);

  // --- Кисть ---------------------------------------------------------------

  var material = S.SAND;
  var brushSize = 4;
  var painting = false;
  var paintPos = { x: 0, y: 0 };

  document.querySelectorAll('[data-mat]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      material = parseInt(btn.dataset.mat, 10);
      document.querySelectorAll('[data-mat]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    });
  });

  var sizeInput = document.getElementById('size');
  sizeInput.addEventListener('input', function () {
    brushSize = parseInt(sizeInput.value, 10);
    document.getElementById('sizev').textContent = brushSize;
  });

  document.getElementById('btnClear').addEventListener('click', function () {
    grid.cells.fill(S.EMPTY);
  });
  document.getElementById('btnScene').addEventListener('click', function () {
    grid.cells.fill(S.EMPTY);
    scene();
  });
  var btnPause = document.getElementById('btnPause');
  btnPause.addEventListener('click', function () {
    paused = !paused;
    btnPause.textContent = paused ? '▶ Пуск' : '⏸ Пауза';
  });

  canvas.addEventListener('pointerdown', function (e) {
    painting = true;
    trackPaint(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', trackPaint);
  canvas.addEventListener('pointerup', function () { painting = false; });

  function trackPaint(e) {
    var rect = canvas.getBoundingClientRect();
    paintPos.x = Math.floor((e.clientX - rect.left) / rect.width * W);
    paintPos.y = Math.floor((e.clientY - rect.top) / rect.height * H);
  }

  function paint() {
    if (!painting) return;
    var r = brushSize;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        // Кисть с прорехами — естественнее для сыпучих.
        if (material !== S.STONE && material !== S.WOOD && Math.random() < 0.35) continue;
        var x = paintPos.x + dx, y = paintPos.y + dy;
        if (material === S.EMPTY || S.get(grid, x, y) === S.EMPTY ||
            material === S.FIRE && S.get(grid, x, y) === S.WOOD) {
          S.set(grid, x, y, material);
        }
      }
    }
  }

  // --- Цикл ----------------------------------------------------------------

  function frame() {
    paint();
    if (!paused) {
      flip = !flip;
      S.step(grid, Math.random, moved, flip);
    }
    render();
    requestAnimationFrame(frame);
  }

  function render() {
    var d = img.data;
    var cells = grid.cells;
    for (var i = 0; i < cells.length; i++) {
      var c = COLORS[cells[i]];
      var v = cells[i] === S.EMPTY ? 1 : variation[i];
      // Огонь мерцает.
      if (cells[i] === S.FIRE) v = 0.8 + Math.random() * 0.5;
      d[i * 4] = c[0] * v;
      d[i * 4 + 1] = c[1] * v;
      d[i * 4 + 2] = c[2] * v;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  requestAnimationFrame(frame);
})();
