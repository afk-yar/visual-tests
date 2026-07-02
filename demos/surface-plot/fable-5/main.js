/*
 * «3D-поверхность функции» — Claude Fable 5
 *
 * Анимированный 3D-график z = f(x, y, t) на canvas 2D без библиотек:
 *  - сетка узлов N×N, высоты вычисляются каждый кадр;
 *  - нормали в узлах через конечные разности, освещение по Ламберту;
 *  - цветовая карта по высоте (LUT на 256 записей);
 *  - перспективная проекция, медленное автовращение камеры;
 *  - алгоритм художника: сортировка квадов по средней глубине;
 *  - каркас опционально поверх заливки.
 */
(function () {
  'use strict';

  /* ---------- canvas и DPR ---------- */

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * DPR));
    canvas.height = Math.max(1, Math.round(H * DPR));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---------- сетка узлов ---------- */

  var N = 64;                     // узлов по стороне
  var NQ = N - 1;                 // квадов по стороне
  var QN = NQ * NQ;               // всего квадов
  var SPREAD = 1.3;               // полуразмер сетки в мировых координатах
  var STEP = (2 * SPREAD) / (N - 1); // мировой шаг между узлами

  var gx = new Float32Array(N);   // нормированные координаты узлов [-1..1]
  for (var gi = 0; gi < N; gi++) gx[gi] = -1 + (2 * gi) / (N - 1);

  var hgt = new Float32Array(N * N);   // мировая высота узла (с учётом масштаба)
  var shade = new Float32Array(N * N); // ламбертовская освещённость узла
  var px = new Float32Array(N * N);    // экранный x
  var py = new Float32Array(N * N);    // экранный y
  var pd = new Float32Array(N * N);    // глубина
  var qDepth = new Float32Array(QN);   // суммарная глубина квада
  var order = new Array(QN);           // порядок отрисовки
  for (var qi = 0; qi < QN; qi++) order[qi] = qi;

  /* ---------- цветовая карта по высоте ---------- */

  var LUT = (function () {
    var stops = [
      [0.00, 10, 18, 62],    // глубокий синий
      [0.22, 27, 80, 164],   // синий
      [0.44, 26, 166, 177],  // бирюзовый
      [0.62, 122, 204, 110], // зелёный
      [0.80, 243, 201, 77],  // жёлтый
      [1.00, 242, 116, 53]   // оранжевый
    ];
    var lut = new Uint8ClampedArray(256 * 3);
    for (var i = 0; i < 256; i++) {
      var t = i / 255;
      var j = 0;
      while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
      var a = stops[j], b = stops[j + 1];
      var u = (t - a[0]) / (b[0] - a[0]);
      if (u < 0) u = 0;
      if (u > 1) u = 1;
      lut[i * 3] = a[1] + (b[1] - a[1]) * u;
      lut[i * 3 + 1] = a[2] + (b[2] - a[2]) * u;
      lut[i * 3 + 2] = a[3] + (b[3] - a[3]) * u;
    }
    return lut;
  })();

  /* ---------- источник света (мировой, нормированный) ---------- */

  var LX = -0.45, LY = 0.55, LZ = 0.72;
  (function () {
    var il = 1 / Math.sqrt(LX * LX + LY * LY + LZ * LZ);
    LX *= il; LY *= il; LZ *= il;
  })();
  var AMBIENT = 0.34, DIFFUSE = 0.78;

  /* ---------- функции поверхности ---------- */
  /* make(t) возвращает f(x, y) для текущего момента времени; x, y ∈ [-1..1]. */

  var FUNCS = {
    ripple: {
      formula: 'z = 0.55·sin(11r − 3t) / (1 + 7r)',
      make: function (t) {
        var ph = 3 * t;
        return function (x, y) {
          var r = Math.sqrt(x * x + y * y);
          return 0.55 * Math.sin(11 * r - ph) / (1 + 7 * r);
        };
      }
    },
    waves: {
      formula: 'z = Σᵢ 0.3·sin(10rᵢ − 2.6t) / (1 + 4rᵢ) — два блуждающих источника',
      make: function (t) {
        var ph = 2.6 * t;
        var x1 = 0.55 * Math.sin(0.42 * t), y1 = 0.55 * Math.cos(0.35 * t + 0.8);
        var x2 = 0.60 * Math.cos(0.30 * t + 2.1), y2 = 0.60 * Math.sin(0.47 * t + 3.9);
        return function (x, y) {
          var dx1 = x - x1, dy1 = y - y1;
          var r1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
          var dx2 = x - x2, dy2 = y - y2;
          var r2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
          return 0.3 * Math.sin(10 * r1 - ph) / (1 + 4 * r1) +
                 0.3 * Math.sin(10 * r2 - ph) / (1 + 4 * r2);
        };
      }
    },
    saddle: {
      formula: 'z = a(t)·(u² − v²) — оси седла медленно вращаются',
      make: function (t) {
        var ang = 0.35 * t;
        var ca = Math.cos(ang), sa = Math.sin(ang);
        var amp = 0.5 * (0.8 + 0.2 * Math.sin(0.9 * t));
        return function (x, y) {
          var u = x * ca + y * sa;
          var v = y * ca - x * sa;
          return amp * (u * u - v * v);
        };
      }
    },
    gauss: {
      formula: 'z = 0.8·e^(−|p−c(t)|²/2σ²) − 0.35·e^(−|p+c(t)|²/2σ₂²) — пик блуждает, σ дышит',
      make: function (t) {
        var cx = 0.5 * Math.sin(0.7 * t), cy = 0.5 * Math.sin(0.53 * t + 1.2);
        var sig = 0.30 * (1 + 0.22 * Math.sin(0.8 * t));
        var k1 = 1 / (2 * sig * sig);
        var k2 = 1 / (2 * 0.38 * 0.38);
        return function (x, y) {
          var dx = x - cx, dy = y - cy;
          var ex = x + cx, ey = y + cy;
          return 0.8 * Math.exp(-(dx * dx + dy * dy) * k1) -
                 0.35 * Math.exp(-(ex * ex + ey * ey) * k2);
        };
      }
    }
  };
  var FN_KEYS = ['ripple', 'waves', 'saddle', 'gauss'];

  /* ---------- состояние ---------- */

  var state = {
    fn: 'ripple',
    time: 0,
    speed: 1,
    heightScale: 1,
    wire: false,
    spin: true,
    yaw: 0.7,
    pitch: 0.58,
    dist: 3.6
  };

  /* ---------- вычисление поля высот ---------- */

  var zMinRaw = 0, zMaxRaw = 0;

  function computeField(t) {
    var f = FUNCS[state.fn].make(t);
    var hs = state.heightScale;
    var mn = Infinity, mx = -Infinity;
    var k = 0;
    for (var r = 0; r < N; r++) {
      var y = gx[r];
      for (var c = 0; c < N; c++, k++) {
        var z = f(gx[c], y) * hs;
        hgt[k] = z;
        if (z < mn) mn = z;
        if (z > mx) mx = z;
      }
    }
    zMinRaw = mn;
    zMaxRaw = mx;
  }

  /* ---------- нормали в узлах + освещение по Ламберту ---------- */

  function computeShade() {
    var inv2 = 1 / (2 * STEP), inv1 = 1 / STEP;
    var k = 0;
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++, k++) {
        var dzdx = c === 0 ? (hgt[k + 1] - hgt[k]) * inv1
                 : c === N - 1 ? (hgt[k] - hgt[k - 1]) * inv1
                 : (hgt[k + 1] - hgt[k - 1]) * inv2;
        var dzdy = r === 0 ? (hgt[k + N] - hgt[k]) * inv1
                 : r === N - 1 ? (hgt[k] - hgt[k - N]) * inv1
                 : (hgt[k + N] - hgt[k - N]) * inv2;
        /* нормаль поверхности z = f(x,y): (−fx, −fy, 1) до нормировки */
        var il = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        var d = (-dzdx * LX - dzdy * LY + LZ) * il;
        shade[k] = AMBIENT + DIFFUSE * (d > 0 ? d : 0);
      }
    }
  }

  /* ---------- проекция: орбитальная камера ---------- */

  function project() {
    var cyw = Math.cos(state.yaw), syw = Math.sin(state.yaw);
    var cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    var focal = Math.min(W, H) * 0.92;
    var cx = W * 0.5, cyc = H * 0.52;
    var dist = state.dist;
    var k = 0;
    for (var r = 0; r < N; r++) {
      var wy = gx[r] * SPREAD;
      for (var c = 0; c < N; c++, k++) {
        var wx = gx[c] * SPREAD;
        var wz = hgt[k];
        /* поворот вокруг вертикальной оси (yaw) */
        var x1 = wx * cyw - wy * syw;
        var y1 = wx * syw + wy * cyw;
        /* наклон камеры (pitch) вокруг экранной горизонтали */
        var y2 = y1 * cp - wz * sp;
        var z2 = y1 * sp + wz * cp;
        var depth = dist + y2;
        var s = focal / (depth < 0.25 ? 0.25 : depth);
        px[k] = cx + x1 * s;
        py[k] = cyc - z2 * s;
        pd[k] = depth;
      }
    }
  }

  /* ---------- сглаженный диапазон высот для цветовой карты ---------- */

  var dispMin = -1, dispMax = 1, rangeInit = false;

  function updateRange(dt) {
    if (!rangeInit) {
      dispMin = zMinRaw;
      dispMax = zMaxRaw;
      rangeInit = true;
      return;
    }
    var a = Math.min(1, dt * 3);
    dispMin += (zMinRaw - dispMin) * a;
    dispMax += (zMaxRaw - dispMax) * a;
  }

  /* ---------- отрисовка: алгоритм художника ---------- */

  function draw() {
    ctx.clearRect(0, 0, W, H);

    for (var q = 0; q < QN; q++) {
      var qr = (q / NQ) | 0, qc = q - qr * NQ;
      var qi = qr * N + qc;
      qDepth[q] = pd[qi] + pd[qi + 1] + pd[qi + N] + pd[qi + N + 1];
    }
    order.sort(function (a, b) { return qDepth[b] - qDepth[a]; });

    var invRange = 255 / Math.max(1e-6, dispMax - dispMin);
    var wire = state.wire;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;

    for (var k = 0; k < QN; k++) {
      q = order[k];
      qr = (q / NQ) | 0;
      qc = q - qr * NQ;
      var ia = qr * N + qc;
      var ib = ia + 1;
      var ic = ia + N;
      var id = ia + N + 1;

      var zAvg = (hgt[ia] + hgt[ib] + hgt[ic] + hgt[id]) * 0.25;
      var ti = (zAvg - dispMin) * invRange;
      var ci = ti < 0 ? 0 : ti > 255 ? 255 : ti | 0;
      var li = (shade[ia] + shade[ib] + shade[ic] + shade[id]) * 0.25;

      var o = ci * 3;
      var R = LUT[o] * li;     if (R > 255) R = 255;
      var G = LUT[o + 1] * li; if (G > 255) G = 255;
      var B = LUT[o + 2] * li; if (B > 255) B = 255;
      var fill = 'rgb(' + (R | 0) + ',' + (G | 0) + ',' + (B | 0) + ')';

      ctx.beginPath();
      ctx.moveTo(px[ia], py[ia]);
      ctx.lineTo(px[ib], py[ib]);
      ctx.lineTo(px[id], py[id]);
      ctx.lineTo(px[ic], py[ic]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      /* обводка тем же цветом закрывает щели между квадами;
         при включённом каркасе — затемнённая линия поверх заливки */
      ctx.strokeStyle = wire
        ? 'rgb(' + ((R * 0.35 + 6) | 0) + ',' + ((G * 0.35 + 8) | 0) + ',' + ((B * 0.35 + 14) | 0) + ')'
        : fill;
      ctx.stroke();
    }
  }

  /* ---------- главный цикл ---------- */

  var last = performance.now();

  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // кламп большого dt (фон/троттлинг)
    if (dt < 0) dt = 0;

    state.time += dt * state.speed;
    if (state.spin && !dragging) state.yaw += dt * 0.16;

    computeField(state.time);
    computeShade();
    project();
    updateRange(dt);
    draw();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- управление камерой ---------- */

  var dragging = false, lastX = 0, lastY = 0;

  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* необязательно */ }
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    state.yaw += (e.clientX - lastX) * 0.006;
    state.pitch += (e.clientY - lastY) * 0.005;
    if (state.pitch < 0.12) state.pitch = 0.12;
    if (state.pitch > 1.35) state.pitch = 1.35;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  ['pointerup', 'pointercancel'].forEach(function (ev) {
    canvas.addEventListener(ev, function () { dragging = false; });
  });

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    state.dist *= Math.exp(e.deltaY * 0.0012);
    if (state.dist < 2.6) state.dist = 2.6;
    if (state.dist > 7.5) state.dist = 7.5;
  }, { passive: false });

  /* ---------- панель управления ---------- */

  var formulaEl = document.getElementById('formula');
  var fnButtons = document.querySelectorAll('#fnGroup button');

  function setFunction(key) {
    if (!FUNCS[key] || key === state.fn) return;
    state.fn = key;
    rangeInit = false; // диапазон цветов подстроится мгновенно, без переходного мусора
    for (var i = 0; i < fnButtons.length; i++) {
      var active = fnButtons[i].getAttribute('data-fn') === key;
      fnButtons[i].classList.toggle('active', active);
      fnButtons[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    formulaEl.textContent = FUNCS[key].formula;
  }

  for (var bi = 0; bi < fnButtons.length; bi++) {
    fnButtons[bi].addEventListener('click', function () {
      setFunction(this.getAttribute('data-fn'));
    });
  }
  formulaEl.textContent = FUNCS[state.fn].formula;

  document.getElementById('speed').addEventListener('input', function () {
    state.speed = parseFloat(this.value);
  });
  document.getElementById('heightScale').addEventListener('input', function () {
    state.heightScale = parseFloat(this.value);
  });
  document.getElementById('wire').addEventListener('input', function () {
    state.wire = this.checked;
  });
  document.getElementById('spin').addEventListener('input', function () {
    state.spin = this.checked;
  });

  /* клавиши 1–4 переключают функции */
  window.addEventListener('keydown', function (e) {
    var idx = ['1', '2', '3', '4'].indexOf(e.key);
    if (idx >= 0) setFunction(FN_KEYS[idx]);
  });
})();
