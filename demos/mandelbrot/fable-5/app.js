/* Мандельброт — канвас, прогрессивный рендер, зум и панорамирование.
 * Математика — в mandelbrot.js (window.Mandelbrot). */
(function () {
  'use strict';

  var M = window.Mandelbrot;

  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');
  var hud = document.getElementById('hud');
  var btnReset = document.getElementById('btnReset');

  var W = 0, H = 0;
  var img = null;

  var BASE_SCALE = 0;      // масштаб исходного вида — для вычисления зума
  var view = null;

  function homeView() {
    // Вписать область re в [-2.5, 1], im в [-1.25, 1.25].
    var scale = Math.max(3.5 / W, 2.5 / H);
    return { cx: -0.75, cy: 0, scale: scale };
  }

  function resize() {
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W;
    canvas.height = H;
    img = ctx.createImageData(W, H);
    if (!view) {
      view = homeView();
      BASE_SCALE = view.scale;
    }
    requestRender();
  }

  // --- Прогрессивный рендер ---------------------------------------------
  // Сначала быстрый черновой проход крупными блоками, затем точный —
  // построчно, порциями, чтобы не блокировать ввод. Новый ввод отменяет
  // текущий проход (поколение рендера увеличивается).

  var generation = 0;
  var renderStart = 0;

  function requestRender() {
    generation++;
    var gen = generation;
    var maxIter = M.maxIterForZoom(BASE_SCALE / view.scale);

    renderStart = performance.now();
    renderCoarse(maxIter);
    updateHud(maxIter, true);

    var row = 0;
    function fineChunk() {
      if (gen !== generation) return; // вид изменился — проход устарел
      var deadline = performance.now() + 12;
      while (row < H && performance.now() < deadline) {
        renderRow(row, maxIter);
        row++;
      }
      ctx.putImageData(img, 0, 0);
      if (row < H) {
        requestAnimationFrame(fineChunk);
      } else {
        updateHud(maxIter, false);
      }
    }
    requestAnimationFrame(fineChunk);
  }

  function renderCoarse(maxIter) {
    var step = 6;
    var d = img.data;
    for (var y = 0; y < H; y += step) {
      for (var x = 0; x < W; x += step) {
        var c = M.screenToComplex(x + step / 2, y + step / 2, view, W, H);
        var rgb = colorAt(c.re, c.im, maxIter);
        for (var yy = y; yy < Math.min(y + step, H); yy++) {
          var base = (yy * W + x) * 4;
          for (var xx = x; xx < Math.min(x + step, W); xx++) {
            d[base] = rgb[0]; d[base + 1] = rgb[1]; d[base + 2] = rgb[2]; d[base + 3] = 255;
            base += 4;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function renderRow(y, maxIter) {
    var d = img.data;
    var base = y * W * 4;
    for (var x = 0; x < W; x++) {
      var c = M.screenToComplex(x, y, view, W, H);
      var rgb = colorAt(c.re, c.im, maxIter);
      d[base] = rgb[0]; d[base + 1] = rgb[1]; d[base + 2] = rgb[2]; d[base + 3] = 255;
      base += 4;
    }
  }

  var BLACK = [8, 4, 12];
  function colorAt(re, im, maxIter) {
    var mu = M.escapeTime(re, im, maxIter);
    return mu < 0 ? BLACK : M.colorFromMu(mu);
  }

  function updateHud(maxIter, partial) {
    var zoom = BASE_SCALE / view.scale;
    var zoomStr = zoom >= 1e6 ? zoom.toExponential(2) : zoom.toFixed(2);
    var ms = Math.round(performance.now() - renderStart);
    hud.textContent =
      'зум ×' + zoomStr +
      '   центр ' + view.cx.toFixed(12) + ' ' + (view.cy >= 0 ? '+' : '−') +
      ' ' + Math.abs(view.cy).toFixed(12) + 'i' +
      '   итераций ' + maxIter +
      (partial ? '   …' : '   ' + ms + ' мс');
  }

  // --- Ввод ----------------------------------------------------------------

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var factor = Math.pow(1.0015, e.deltaY); // плавный зум, deltaY<0 — приближение
    view = M.zoomAt(view, e.offsetX, e.offsetY, factor, W, H);
    requestRender();
  }, { passive: false });

  var dragging = false, lastX = 0, lastY = 0;

  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastX;
    var dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    view = M.panBy(view, dx, dy);
    requestRender();
  });

  canvas.addEventListener('pointerup', function (e) {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });

  btnReset.addEventListener('click', function () {
    view = homeView();
    BASE_SCALE = view.scale;
    requestRender();
  });

  window.addEventListener('resize', resize);
  resize();
})();
