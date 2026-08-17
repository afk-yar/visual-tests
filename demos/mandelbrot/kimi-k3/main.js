'use strict';

(function () {
  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d');

  var elZoom = document.getElementById('stat-zoom');
  var elRe = document.getElementById('stat-re');
  var elIm = document.getElementById('stat-im');
  var elIter = document.getElementById('stat-iter');

  // ---------- Палитры (косинусные, t -> rgb) ----------
  // Формат: [a, b, c, d] для каждого канала: col = a + b*cos(2π(c*t + d))
  var PALETTES = [
    { name: 'Глубина', a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.00, 0.10, 0.20] },
    { name: 'Закат',   a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.00, 0.15, 0.35] },
    { name: 'Небула',  a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 0.7], d: [0.80, 0.55, 0.20] },
    { name: 'Изумруд', a: [0.4, 0.6, 0.5], b: [0.4, 0.4, 0.5], c: [1.0, 1.0, 1.0], d: [0.30, 0.50, 0.65] }
  ];
  var paletteIndex = 0;

  // Лутап палитры: 1024 цвета, чтобы не считать косинусы на пиксель
  var LUT_SIZE = 1024;
  var lut = new Uint8Array(LUT_SIZE * 3);

  function buildLut() {
    var p = PALETTES[paletteIndex];
    for (var i = 0; i < LUT_SIZE; i++) {
      var t = i / LUT_SIZE;
      for (var ch = 0; ch < 3; ch++) {
        var v = p.a[ch] + p.b[ch] * Math.cos(6.28318530718 * (p.c[ch] * t + p.d[ch]));
        lut[i * 3 + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
  }
  buildLut();

  // ---------- Состояние вида ----------
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0;            // размеры буфера в пикселях
  var cx = -0.6, cy = 0;       // центр в координатах плоскости
  var scale = 0;               // пикселей на единицу плоскости
  var baseScale = 0;           // scale при зуме ×1

  var maxIter = 200;
  var BAILOUT2 = 1 << 16;      // |z|^2 > 65536 — для гладкой раскраски

  // ---------- Прогрессивный рендер ----------
  var imgData = null;
  var renderRow = 0;           // следующая строка для отрисовки
  var rendering = false;

  function computeMaxIter() {
    var zoom = scale / baseScale;
    var it = Math.round(120 + 90 * Math.log2(Math.max(1, zoom)));
    return Math.max(120, Math.min(5000, it));
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(canvas.clientWidth * DPR));
    var h = Math.max(1, Math.round(canvas.clientHeight * DPR));
    if (w === W && h === H && scale > 0) return;
    var keepScale = scale > 0 ? scale / Math.min(W, H) : 0;
    W = w; H = h;
    canvas.width = W;
    canvas.height = H;
    if (keepScale > 0) {
      scale = keepScale * Math.min(W, H);
    } else {
      baseScale = Math.min(W, H) / 2.6; // весь диаметр множества помещается
      scale = baseScale;
    }
    requestRender();
  }

  function requestRender() {
    maxIter = computeMaxIter();
    imgData = ctx.createImageData(W, H);
    renderRow = 0;
    rendering = true;
  }

  // Рендер пачки строк за кадр (с бюджетом по времени)
  function renderChunk() {
    if (!rendering) return;
    var data = imgData.data;
    var t0 = performance.now();
    var invScale = 1 / scale;
    var halfW = W / 2, halfH = H / 2;

    while (renderRow < H) {
      var y = renderRow;
      var ci = cy + (y - halfH) * invScale;
      var rowOff = y * W * 4;

      for (var x = 0; x < W; x++) {
        var cr = cx + (x - halfW) * invScale;
        var zr = 0, zi = 0;
        var zr2 = 0, zi2 = 0;
        var iter = 0;

        // Быстрая проверка: главная кардиоида и первый бульб
        var q = (cr - 0.25) * (cr - 0.25) + ci * ci;
        var inSet = q * (q + (cr - 0.25)) <= 0.25 * ci * ci ||
                    (cr + 1) * (cr + 1) + ci * ci <= 0.0625;

        if (!inSet) {
          while (iter < maxIter && zr2 + zi2 <= BAILOUT2) {
            zi = 2 * zr * zi + ci;
            zr = zr2 - zi2 + cr;
            zr2 = zr * zr;
            zi2 = zi * zi;
            iter++;
          }
        } else {
          iter = maxIter;
        }

        var off = rowOff + x * 4;
        if (iter >= maxIter) {
          // Внутри множества — почти чёрный с холодным оттенком
          data[off] = 4;
          data[off + 1] = 5;
          data[off + 2] = 12;
        } else {
          // Плавная (smooth) раскраска
          var mag = zr2 + zi2;
          var nu = Math.log(0.5 * Math.log(mag)) / Math.LN2;
          var mu = iter + 1 - nu;
          // t в [0,1): несколько оборотов палитры на диапазон итераций
          var t = mu * 0.03;
          t = t - Math.floor(t);
          var idx = Math.floor(t * LUT_SIZE) * 3;
          data[off] = lut[idx];
          data[off + 1] = lut[idx + 1];
          data[off + 2] = lut[idx + 2];
        }
        data[off + 3] = 255;
      }

      renderRow++;
      // Бюджет ~14 мс на кадр, остальное — в следующий rAF
      if (performance.now() - t0 > 14 && renderRow < H) break;
    }

    // Отрисовываем только готовые строки
    ctx.putImageData(imgData, 0, 0, 0, 0, W, renderRow);

    if (renderRow >= H) {
      rendering = false;
    }
  }

  // ---------- HUD ----------
  function fmt(v) {
    var a = Math.abs(v);
    var s = a >= 1e-4 && a < 1e12 ? v.toPrecision(9) : v.toExponential(3);
    // убрать хвостовые нули
    if (s.indexOf('.') !== -1 && s.indexOf('e') === -1) {
      s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    return s.replace('-', '−');
  }

  function updateHud() {
    var zoom = scale / baseScale;
    var zs;
    if (zoom >= 1e6) zs = '×' + zoom.toExponential(2);
    else if (zoom >= 100) zs = '×' + Math.round(zoom).toLocaleString('ru-RU');
    else zs = '×' + zoom.toFixed(zoom >= 10 ? 1 : 2);
    elZoom.textContent = zs;
    elRe.textContent = fmt(cx);
    elIm.textContent = fmt(cy);
    elIter.textContent = String(maxIter);
  }

  // ---------- Интерактив ----------
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var px = (e.clientX - rect.left) * DPR;
    var py = (e.clientY - rect.top) * DPR;
    // Точка плоскости под курсором
    var wr = cx + (px - W / 2) / scale;
    var wi = cy + (py - H / 2) / scale;
    var factor = Math.exp(-e.deltaY * 0.0018);
    scale *= factor;
    if (scale < baseScale * 0.2) scale = baseScale * 0.2;
    // Курсор остаётся над той же точкой
    cx = wr - (px - W / 2) / scale;
    cy = wi - (py - H / 2) / scale;
    requestRender();
  }, { passive: false });

  var dragging = false, lastX = 0, lastY = 0;

  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = (e.clientX - lastX) * DPR;
    var dy = (e.clientY - lastY) * DPR;
    lastX = e.clientX;
    lastY = e.clientY;
    cx -= dx / scale;
    cy -= dy / scale;
    requestRender();
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('dragging');
    if (e && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  document.getElementById('btn-reset').addEventListener('click', function () {
    cx = -0.6;
    cy = 0;
    scale = baseScale;
    requestRender();
  });

  document.getElementById('btn-palette').addEventListener('click', function () {
    paletteIndex = (paletteIndex + 1) % PALETTES.length;
    buildLut();
    requestRender();
  });

  window.addEventListener('resize', resize);

  // ---------- Главный цикл ----------
  var lastT = performance.now();
  function frame(now) {
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.1) dt = 0.1; // кламп большого dt (возврат из фоновой вкладки)
    // dt не влияет на рендер напрямую — перерисовка бюджетируется по времени,
    // но оставляем его для будущей плавной анимации вида
    void dt;

    renderChunk();
    updateHud();
    requestAnimationFrame(frame);
  }

  resize();          // первичная инициализация размеров и вида
  requestRender();   // гарантированный рендер первого кадра
  requestAnimationFrame(frame);
})();
