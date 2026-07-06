(function () {
  'use strict';

  var M = window.Mandelbrot;

  var canvas = document.getElementById('fractal');
  var ctx = canvas.getContext('2d', { alpha: false });

  var hudZoomEl = document.getElementById('hud-zoom');
  var hudReEl = document.getElementById('hud-re');
  var hudImEl = document.getElementById('hud-im');
  var hudIterEl = document.getElementById('hud-iter');
  var resetBtn = document.getElementById('reset-btn');
  var paletteBtn = document.getElementById('palette-btn');

  var DPR_CAP = 2;
  var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);

  // Начальный вид: главная кардиоида и левая бульба целиком в кадре.
  var INITIAL_CENTER_X = -0.5;
  var INITIAL_CENTER_Y = 0;
  var INITIAL_SPAN = 3.2; // ширина видимой области в единицах комплексной плоскости

  var view = { centerX: INITIAL_CENTER_X, centerY: INITIAL_CENTER_Y, scale: 1, width: 0, height: 0 };
  var baseScale = 1;

  // Ограничения масштаба: не даём уходить за пределы точности double и не даём
  // отдалиться сильно дальше начального вида.
  var MIN_SCALE = 3e-15;
  var MAX_SCALE_FACTOR = 3; // во сколько раз можно отдалиться от базового масштаба

  // Красивые палитры на основе косинусного градиента (техника Iñigo Quilez):
  // color(t) = a + b*cos(2*PI*(c*t + d)). Каждая даёт бесшовный циклический цвет.
  var PALETTES = [
    { a: [0.50, 0.45, 0.55], b: [0.50, 0.45, 0.50], c: [1.0, 1.0, 1.0], d: [0.00, 0.18, 0.35] }, // электрик-синий/пурпур/золото
    { a: [0.55, 0.45, 0.40], b: [0.45, 0.45, 0.45], c: [1.5, 1.2, 0.9], d: [0.10, 0.35, 0.55] }, // огненный
    { a: [0.50, 0.50, 0.50], b: [0.50, 0.50, 0.50], c: [1.0, 1.0, 1.0], d: [0.30, 0.55, 0.70] }, // изумруд/бирюза
    { a: [0.50, 0.50, 0.50], b: [0.50, 0.50, 0.50], c: [1.0, 0.7, 0.4], d: [0.00, 0.15, 0.20] }  // мягкая радуга
  ];
  var paletteIndex = 0;

  var renderGeneration = 0;
  var settleTimer = null;

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function paletteColor(t, pal, out) {
    var twoPi = Math.PI * 2;
    out[0] = clamp(Math.round((pal.a[0] + pal.b[0] * Math.cos(twoPi * (pal.c[0] * t + pal.d[0]))) * 255), 0, 255);
    out[1] = clamp(Math.round((pal.a[1] + pal.b[1] * Math.cos(twoPi * (pal.c[1] * t + pal.d[1]))) * 255), 0, 255);
    out[2] = clamp(Math.round((pal.a[2] + pal.b[2] * Math.cos(twoPi * (pal.c[2] * t + pal.d[2]))) * 255), 0, 255);
    return out;
  }

  var colorScratch = [0, 0, 0];
  var COLOR_FREQ = 0.045; // период цикла палитры ~22 итерации — не зависит от maxIter,
                           // поэтому плотность колец остаётся одинаковой на любом зуме

  function colorFor(res, maxIter, pal) {
    if (!res.escaped) {
      return [4, 5, 10]; // почти чёрный для точек внутри множества
    }
    // t линеен по непрерывному (smooth) числу итераций — отсюда плавные бесшовные
    // кольца цвета вокруг границы множества вместо резких полос по целым iter.
    var t = res.smooth * COLOR_FREQ;
    return paletteColor(t, pal, colorScratch);
  }

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    var cssW = window.innerWidth;
    var cssH = window.innerHeight;
    var newW = Math.max(1, Math.round(cssW * dpr));
    var newH = Math.max(1, Math.round(cssH * dpr));
    var first = view.width === 0;

    canvas.width = newW;
    canvas.height = newH;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    view.width = newW;
    view.height = newH;

    if (first) {
      view.scale = INITIAL_SPAN / newW;
      baseScale = view.scale;
    }
    // Первую отрисовку делаем сразу в полном качестве; последующие resize
    // (например, при изменении размера окна) — быстрым превью с досчётом.
    scheduleRender(!first);
  }

  function resetView() {
    view.centerX = INITIAL_CENTER_X;
    view.centerY = INITIAL_CENTER_Y;
    view.scale = INITIAL_SPAN / view.width;
    baseScale = view.scale;
    scheduleRender(false);
  }

  function formatZoom(zoom) {
    if (zoom < 1000) {
      return zoom.toFixed(zoom < 10 ? 2 : 1) + '×';
    }
    return zoom.toExponential(2).replace('+', '') + '×';
  }

  function formatCoord(v, zoom) {
    var decimals = clamp(Math.round(6 + Math.log10(Math.max(zoom, 1))), 6, 15);
    return v.toFixed(decimals);
  }

  function updateHud(maxIter) {
    var zoom = baseScale / view.scale;
    hudZoomEl.textContent = formatZoom(zoom);
    hudReEl.textContent = formatCoord(view.centerX, zoom);
    hudImEl.textContent = formatCoord(view.centerY, zoom);
    hudIterEl.textContent = String(maxIter);
  }

  // Прогрессивный рендер: считаем построчными блоками через requestAnimationFrame,
  // чтобы не блокировать поток на глубоком зуме, и рисуем каждый блок сразу —
  // получается приятная заливка сверху вниз. Если за время рендера пришёл новый
  // запрос (смена вида), текущий проход бросается (проверка renderGeneration).
  function renderProgressive(step) {
    var generation = ++renderGeneration;
    var w = view.width;
    var h = view.height;
    if (w <= 0 || h <= 0) return;

    var maxIter = M.iterationsForScale(view.scale, baseScale);
    var pal = PALETTES[paletteIndex];

    step = step || 1;
    // Целимся в ~60000 вычислений iterate() на один чанк/кадр — компромисс
    // между отзывчивостью (не блокировать поток) и числом кадров до готовой картинки.
    var samplesPerChunk = 60000;
    var samplesPerRow = Math.max(1, Math.floor(w / step));
    var effectiveRows = Math.max(1, Math.round(samplesPerChunk / samplesPerRow));
    var rowsPerChunk = effectiveRows * step;
    var y = 0;

    function chunk() {
      if (generation !== renderGeneration) return;

      var yEnd = Math.min(h, y + rowsPerChunk);
      var chunkH = yEnd - y;
      var imgData = ctx.createImageData(w, chunkH);
      var data = imgData.data;

      for (var yy = 0; yy < chunkH; yy += step) {
        var absY = y + yy;
        for (var xx = 0; xx < w; xx += step) {
          var c = M.screenToComplex(xx, absY, view);
          var res = M.iterate(c.x, c.y, maxIter);
          var rgb = colorFor(res, maxIter, pal);

          var maxByy = Math.min(step, chunkH - yy);
          var maxBxx = Math.min(step, w - xx);
          for (var byy = 0; byy < maxByy; byy++) {
            var rowOff = (yy + byy) * w;
            for (var bxx = 0; bxx < maxBxx; bxx++) {
              var idx = (rowOff + xx + bxx) * 4;
              data[idx] = rgb[0];
              data[idx + 1] = rgb[1];
              data[idx + 2] = rgb[2];
              data[idx + 3] = 255;
            }
          }
        }
      }

      if (generation !== renderGeneration) return;
      ctx.putImageData(imgData, 0, y);

      y = yEnd;
      if (y < h) {
        requestAnimationFrame(chunk);
      } else {
        updateHud(maxIter);
      }
    }

    chunk();
  }

  // Во время активного взаимодействия (drag/wheel) рендерим в пониженном
  // разрешении для отзывчивости, а после короткой паузы — полным качеством.
  function scheduleRender(interactive) {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    renderProgressive(interactive ? 3 : 1);
    if (interactive) {
      settleTimer = setTimeout(function () {
        settleTimer = null;
        renderProgressive(1);
      }, 140);
    }
  }

  // --- Взаимодействие: зум колесом мыши с центрированием на курсоре ---
  function devicePos(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = devicePos(e.clientX, e.clientY);
    var before = M.screenToComplex(p.x, p.y, view);

    // deltaY < 0 (колесо вверх/от себя) должно приближать: тогда factor < 1
    // и view.scale (единиц плоскости на пиксель — шире вид = дальше) уменьшается.
    var factor = Math.pow(1.0016, e.deltaY);
    var newScale = view.scale * factor;
    newScale = clamp(newScale, MIN_SCALE, baseScale * MAX_SCALE_FACTOR);
    view.scale = newScale;

    var after = M.screenToComplex(p.x, p.y, view);
    view.centerX += before.x - after.x;
    view.centerY += before.y - after.y;

    scheduleRender(true);
  }, { passive: false });

  // --- Панорамирование перетаскиванием (мышь и тач через Pointer Events) ---
  var dragging = false;
  var lastX = 0;
  var lastY = 0;

  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dxCss = e.clientX - lastX;
    var dyCss = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    var dxDev = dxCss * (canvas.width / canvas.getBoundingClientRect().width);
    var dyDev = dyCss * (canvas.height / canvas.getBoundingClientRect().height);

    view.centerX -= dxDev * view.scale;
    view.centerY -= dyDev * view.scale;

    scheduleRender(true);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('dragging');
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    scheduleRender(false);
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  resetBtn.addEventListener('click', function () {
    resetView();
  });

  paletteBtn.addEventListener('click', function () {
    paletteIndex = (paletteIndex + 1) % PALETTES.length;
    scheduleRender(false);
  });

  window.addEventListener('resize', resizeCanvas);

  resizeCanvas();
})();
