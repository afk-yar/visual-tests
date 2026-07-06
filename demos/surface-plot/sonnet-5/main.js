'use strict';
(function () {
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');

  // ---- Константы сцены -------------------------------------------------
  var DOMAIN_HALF = 2.6;      // сетка покрывает x,y в [-2.6, 2.6]
  var SEGMENTS = 48;          // число ячеек по каждой оси (узлов на 1 больше)
  var POINTS = SEGMENTS + 1;

  var ROTATE_SPEED = 0.12;    // рад/с — медленный облёт камеры
  var CAMERA_DISTANCE = 7.5;
  var CAMERA_TILT = 0.85;     // угол возвышения камеры, рад
  var FOV_FACTOR = 0.72;      // fov = FOV_FACTOR * min(cssWidth, cssHeight)
  var MAX_DT = 0.05;          // клампим большие скачки dt (сворачивание вкладки и т.п.)

  var AMBIENT = 0.32;
  var DIFFUSE = 0.78;
  var LIGHT_DIR = Surface.normalize3(0.45, 0.82, 0.35);

  var MODE_RANGES = {
    ripple: [-1.3, 1.3],
    saddle: [-2.9, 2.9],
    gaussian: [-0.15, 1.9],
  };

  var MODE_LABELS = {
    ripple: 'Рябь',
    saddle: 'Седло',
    gaussian: 'Гауссиана',
  };

  var COLOR_STOPS = [
    { t: 0.0, r: 33, g: 48, b: 110 },
    { t: 0.25, r: 30, g: 118, b: 178 },
    { t: 0.5, r: 54, g: 186, b: 150 },
    { t: 0.72, r: 231, g: 200, b: 70 },
    { t: 1.0, r: 224, g: 78, b: 68 },
  ];

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function clampIndex(i) {
    return i < 0 ? 0 : i > SEGMENTS ? SEGMENTS : i;
  }

  function idx(i, j) {
    return i * POINTS + j;
  }

  function lerpColor(t) {
    t = clamp(t, 0, 1);
    var stops = COLOR_STOPS;
    var i = 0;
    while (i < stops.length - 2 && t > stops[i + 1].t) i++;
    var a = stops[i];
    var b = stops[i + 1];
    var span = b.t - a.t || 1;
    var localT = (t - a.t) / span;
    return {
      r: a.r + (b.r - a.r) * localT,
      g: a.g + (b.g - a.g) * localT,
      b: a.b + (b.b - a.b) * localT,
    };
  }

  // ---- Состояние -----------------------------------------------------
  var state = {
    mode: 'ripple',
    wireframe: false,
    paused: false,
    time: 0,
  };

  var camera = {
    angle: -0.4,
    tilt: CAMERA_TILT,
    distance: CAMERA_DISTANCE,
    fov: 600,
    width: window.innerWidth,
    height: window.innerHeight,
  };

  // ---- Сетка координат (фиксирована, не зависит от режима) ------------
  var gx = new Float64Array(POINTS);
  var gy = new Float64Array(POINTS);
  for (var i = 0; i < POINTS; i++) {
    var v = -DOMAIN_HALF + (2 * DOMAIN_HALF * i) / SEGMENTS;
    gx[i] = v;
    gy[i] = v;
  }
  var STEP = (2 * DOMAIN_HALF) / SEGMENTS;

  var heights = new Float64Array(POINTS * POINTS);
  var nx = new Float64Array(POINTS * POINTS);
  var ny = new Float64Array(POINTS * POINTS);
  var nz = new Float64Array(POINTS * POINTS);
  var sx = new Float64Array(POINTS * POINTS);
  var sy = new Float64Array(POINTS * POINTS);
  var sd = new Float64Array(POINTS * POINTS);

  // Пул ячеек-полигонов переиспользуется каждый кадр (без переаллокации).
  var cellCount = SEGMENTS * SEGMENTS;
  var cells = new Array(cellCount);
  for (var c = 0; c < cellCount; c++) {
    cells[c] = { x0: 0, y0: 0, x1: 0, y1: 0, x2: 0, y2: 0, x3: 0, y3: 0, depth: 0, color: '#000' };
  }

  // ---- Resize (DPR-aware, потолок 2) -----------------------------------
  var cssWidth = 0;
  var cssHeight = 0;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssWidth = window.innerWidth;
    cssHeight = window.innerHeight;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    camera.width = cssWidth;
    camera.height = cssHeight;
    camera.fov = FOV_FACTOR * Math.min(cssWidth, cssHeight);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- Обновление сетки высот/нормалей/проекций ------------------------
  function updateGrid() {
    var mode = state.mode;
    var t = state.time;
    for (var i2 = 0; i2 < POINTS; i2++) {
      for (var j2 = 0; j2 < POINTS; j2++) {
        heights[idx(i2, j2)] = Surface.heightAt(mode, gx[i2], gy[j2], t);
      }
    }
    for (var i3 = 0; i3 < POINTS; i3++) {
      for (var j3 = 0; j3 < POINTS; j3++) {
        var hLeft = heights[idx(clampIndex(i3 - 1), j3)];
        var hRight = heights[idx(clampIndex(i3 + 1), j3)];
        var hDown = heights[idx(i3, clampIndex(j3 - 1))];
        var hUp = heights[idx(i3, clampIndex(j3 + 1))];
        var n = Surface.computeNormal(hLeft, hRight, hDown, hUp, STEP);
        var k = idx(i3, j3);
        nx[k] = n.x;
        ny[k] = n.y;
        nz[k] = n.z;
        var p = Surface.projectPoint(gx[i3], heights[k], gy[j3], camera);
        sx[k] = p.x;
        sy[k] = p.y;
        sd[k] = p.depth;
      }
    }
  }

  function buildCells() {
    var range = MODE_RANGES[state.mode];
    var lo = range[0];
    var hi = range[1];
    var span = hi - lo || 1;
    var ci = 0;
    for (var i = 0; i < SEGMENTS; i++) {
      for (var j = 0; j < SEGMENTS; j++) {
        var k00 = idx(i, j);
        var k10 = idx(i + 1, j);
        var k11 = idx(i + 1, j + 1);
        var k01 = idx(i, j + 1);

        var cell = cells[ci++];
        cell.x0 = sx[k00]; cell.y0 = sy[k00];
        cell.x1 = sx[k10]; cell.y1 = sy[k10];
        cell.x2 = sx[k11]; cell.y2 = sy[k11];
        cell.x3 = sx[k01]; cell.y3 = sy[k01];
        cell.depth = (sd[k00] + sd[k10] + sd[k11] + sd[k01]) * 0.25;

        var avgH = (heights[k00] + heights[k10] + heights[k11] + heights[k01]) * 0.25;
        var anx = nx[k00] + nx[k10] + nx[k11] + nx[k01];
        var any = ny[k00] + ny[k10] + ny[k11] + ny[k01];
        var anz = nz[k00] + nz[k10] + nz[k11] + nz[k01];
        var alen = Math.sqrt(anx * anx + any * any + anz * anz) || 1;
        anx /= alen; any /= alen; anz /= alen;

        var lambert = Math.max(0, anx * LIGHT_DIR.x + any * LIGHT_DIR.y + anz * LIGHT_DIR.z);
        var lightF = AMBIENT + DIFFUSE * lambert;

        var col = lerpColor((avgH - lo) / span);
        var r = clamp(Math.round(col.r * lightF), 0, 255);
        var g = clamp(Math.round(col.g * lightF), 0, 255);
        var b = clamp(Math.round(col.b * lightF), 0, 255);
        cell.color = 'rgb(' + r + ',' + g + ',' + b + ')';
      }
    }
    // Художник: от дальних к ближним (по убыванию depth рисуем первыми дальние).
    cells.sort(function (a, b) {
      return b.depth - a.depth;
    });
  }

  function drawBackground() {
    var grad = ctx.createLinearGradient(0, 0, 0, cssHeight);
    grad.addColorStop(0, '#0b1020');
    grad.addColorStop(1, '#171c30');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
  }

  function drawCells() {
    var wireframe = state.wireframe;
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      ctx.beginPath();
      ctx.moveTo(cell.x0, cell.y0);
      ctx.lineTo(cell.x1, cell.y1);
      ctx.lineTo(cell.x2, cell.y2);
      ctx.lineTo(cell.x3, cell.y3);
      ctx.closePath();
      ctx.fillStyle = cell.color;
      ctx.fill();
      if (wireframe) {
        ctx.strokeStyle = 'rgba(8,12,22,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // ---- Главный цикл -----------------------------------------------------
  var lastTs = 0;

  function frame(ts) {
    requestAnimationFrame(frame);
    var dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    dt = clamp(dt, 0, MAX_DT);

    if (!state.paused) {
      state.time += dt;
      camera.angle += ROTATE_SPEED * dt;
      var TWO_PI = Math.PI * 2;
      if (camera.angle > TWO_PI) camera.angle -= TWO_PI;
    }

    updateGrid();
    buildCells();
    drawBackground();
    drawCells();
  }
  requestAnimationFrame(frame);

  // ---- UI ----------------------------------------------------------------
  var segButtons = Array.prototype.slice.call(document.querySelectorAll('.seg'));
  segButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var mode = btn.getAttribute('data-mode');
      if (mode === state.mode) return;
      state.mode = mode;
      segButtons.forEach(function (b) {
        var active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    });
  });

  var wireBtn = document.getElementById('wireframe-btn');
  wireBtn.addEventListener('click', function () {
    state.wireframe = !state.wireframe;
    wireBtn.classList.toggle('active', state.wireframe);
    wireBtn.setAttribute('aria-pressed', state.wireframe ? 'true' : 'false');
  });

  var pauseBtn = document.getElementById('pause-btn');
  pauseBtn.addEventListener('click', function () {
    state.paused = !state.paused;
    pauseBtn.classList.toggle('active', state.paused);
    pauseBtn.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
    pauseBtn.textContent = state.paused ? 'Продолжить' : 'Пауза';
  });
})();
