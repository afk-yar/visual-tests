/* 3D-поверхность z = f(x,y) — софт-рендер на 2D canvas, без библиотек.
   Конвейер: сетка узлов → высоты → нормали в узлах → поворот камеры →
   перспективная проекция → освещение по Ламберту → цвет по высоте →
   сортировка квадов по глубине (алгоритм художника). Каркас опционально. */
(function () {
  'use strict';

  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d', { alpha: false });

  // ── Параметры мира ──────────────────────────────────────────────
  var DOMAIN = 6.0;           // x,y ∈ [-DOMAIN, DOMAIN]
  var N = 64;                 // число узлов по стороне (управляется ползунком)
  var Z_SCALE = 2.2;          // вертикальный масштаб поверхности
  var time = 0;               // время анимации
  var camAngle = 0.7;         // азимут камеры (медленно вращается)
  var camElev = 0.62;         // наклон камеры (≈35°)
  var camDist = 17.5;         // дистанция камеры до центра
  var FOV = 2.1;              // фокусное расстояние проекции

  var running = true;
  var spinning = true;
  var showWire = false;
  var speed = 1.0;
  var fnKey = 'ripple';

  // ── Функции z = f(x,y,t) ────────────────────────────────────────
  // Возвращают высоту в точке. Все ограничены примерно [-1, 1].
  var FUNCS = {
    // Затухающая концентрическая рябь от центрального возмущения.
    ripple: function (x, y, t) {
      var r = Math.sqrt(x * x + y * y);
      var rr = r + 0.0001;
      var decay = Math.exp(-0.18 * r);
      return decay * Math.sin(rr - t * 2.4) / (0.6 + 0.5 * rr);
    },
    // Гиперболический параболоид (седло), мягко колышется во времени.
    saddle: function (x, y, t) {
      var s = 0.85 + 0.15 * Math.sin(t * 0.8);
      return s * (x * x - y * y) / (DOMAIN * DOMAIN) * 1.9;
    },
    // Гауссиан-холм с пульсирующей шириной + два малых спутника.
    gauss: function (x, y, t) {
      var w = 2.2 + 0.6 * Math.sin(t * 0.9);
      var main = Math.exp(-((x * x + y * y) / (w * w)));
      var dx = x - 2.6, dy = y - 2.0;
      var dx2 = x + 2.8, dy2 = y + 2.4;
      var a = 0.45 * Math.exp(-((dx * dx + dy * dy) / 1.4));
      var b = 0.40 * Math.exp(-((dx2 * dx2 + dy2 * dy2) / 1.7));
      return main + a + b - 0.15;
    },
    // Интерференция бегущих плоских волн (двумерная "рябь моря").
    waves: function (x, y, t) {
      var a = Math.sin(0.9 * x + t * 1.6);
      var b = Math.sin(0.8 * y - t * 1.2);
      var c = Math.sin(0.55 * (x + y) + t * 0.9);
      return (a + b + 0.8 * c) / 2.8;
    }
  };

  var EQ_TEXT = {
    ripple: 'z = e^(−0.18r)·sin(r − t)/r,&nbsp; r = √(x² + y²)',
    saddle: 'z = (x² − y²) / k&nbsp; — гиперболический параболоид',
    gauss:  'z = e^(−(x²+y²)/w²)&nbsp; — гауссиана (+2 спутника)',
    waves:  'z = sin(ax+t) + sin(by−t) + sin(c(x+y))'
  };

  function f(x, y, t) { return FUNCS[fnKey](x, y, t); }

  // ── Геометрия: буферы узлов ─────────────────────────────────────
  // Раскладка вершинных атрибутов в плоских массивах для скорости.
  var vx, vy, vz;        // позиции узлов в мире
  var nx, ny, nz;        // нормали в узлах
  var px, py, pdepth;    // экранные координаты + глубина (вид. простр.)
  var pcull;             // флаг: вершина перед камерой
  var count = 0;

  function allocBuffers(n) {
    var total = n * n;
    vx = new Float32Array(total); vy = new Float32Array(total); vz = new Float32Array(total);
    nx = new Float32Array(total); ny = new Float32Array(total); nz = new Float32Array(total);
    px = new Float32Array(total); py = new Float32Array(total);
    pdepth = new Float32Array(total); pcull = new Uint8Array(total);
    count = total;
  }
  allocBuffers(N);

  // Список квадов (по два треугольника на квад при отрисовке не нужен —
  // рисуем сам четырёхугольник как полигон). Храним индексы 4 углов
  // и ключ глубины для сортировки.
  var quads = null;
  function allocQuads(n) {
    var qn = (n - 1) * (n - 1);
    quads = new Int32Array(qn * 4);
    var k = 0;
    for (var j = 0; j < n - 1; j++) {
      for (var i = 0; i < n - 1; i++) {
        var a = j * n + i;
        quads[k] = a;
        quads[k + 1] = a + 1;
        quads[k + 2] = a + n + 1;
        quads[k + 3] = a + n;
        k += 4;
      }
    }
  }
  allocQuads(N);

  // Индексы сортировки квадов (переупорядочиваются каждый кадр).
  var qOrder = null, qKey = null;
  function allocOrder(n) {
    var qn = (n - 1) * (n - 1);
    qOrder = new Int32Array(qn);
    qKey = new Float32Array(qn);
    for (var i = 0; i < qn; i++) qOrder[i] = i;
  }
  allocOrder(N);

  // ── Цветовая карта по высоте (тёплая «термальная» палитра) ──────
  // Контрольные точки: дно (тёмно-синий) → циан → зелёный → жёлтый → красный → белый гребень.
  var STOPS = [
    [0.00, 18, 22, 60],
    [0.18, 26, 78, 150],
    [0.38, 32, 168, 168],
    [0.55, 70, 200, 120],
    [0.72, 230, 200, 70],
    [0.88, 232, 110, 60],
    [1.00, 250, 240, 230]
  ];
  function colormap(t, out) {
    if (t < 0) t = 0; else if (t > 1) t = 1;
    for (var i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i];
        var f2 = (t - a[0]) / (b[0] - a[0] || 1);
        out[0] = a[1] + (b[1] - a[1]) * f2;
        out[1] = a[2] + (b[2] - a[2]) * f2;
        out[2] = a[3] + (b[3] - a[3]) * f2;
        return;
      }
    }
    out[0] = STOPS[6][1]; out[1] = STOPS[6][2]; out[2] = STOPS[6][3];
  }

  // ── Источник света (направленный) ──────────────────────────────
  var LX = 0.40, LY = 0.45, LZ = 0.80;
  (function normLight() {
    var m = Math.sqrt(LX * LX + LY * LY + LZ * LZ);
    LX /= m; LY /= m; LZ /= m;
  })();

  // ── Камера: матрица поворота (азимут вокруг Z, наклон вокруг X) ──
  var r00, r01, r02, r10, r11, r12, r20, r21, r22, camZ;
  function buildCamera() {
    var ca = Math.cos(camAngle), sa = Math.sin(camAngle);
    var ce = Math.cos(camElev), se = Math.sin(camElev);
    // Сначала поворот вокруг оси Z (азимут), затем наклон вокруг X (элевация).
    // Итоговая матрица переводит мир в систему камеры (камера смотрит вдоль -Z').
    r00 = ca;        r01 = -sa;       r02 = 0;
    r10 = ce * sa;   r11 = ce * ca;   r12 = -se;
    r20 = se * sa;   r21 = se * ca;   r22 = ce;
    camZ = camDist;
  }

  // ── Сборка геометрии для текущего кадра ─────────────────────────
  var zMin = 0, zMax = 1;
  function buildSurface() {
    var n = N;
    var step = (2 * DOMAIN) / (n - 1);
    var idx = 0;
    var lo = Infinity, hi = -Infinity;
    // позиции + высоты
    for (var j = 0; j < n; j++) {
      var wy = -DOMAIN + j * step;
      for (var i = 0; i < n; i++) {
        var wx = -DOMAIN + i * step;
        var h = f(wx, wy, time) * Z_SCALE;
        vx[idx] = wx; vy[idx] = wy; vz[idx] = h;
        if (h < lo) lo = h; if (h > hi) hi = h;
        idx++;
      }
    }
    zMin = lo; zMax = hi;

    // нормали в узлах через центральные разности высот поля.
    // Касательные: Tx = (1,0,dz/dx), Ty = (0,1,dz/dy); n = Tx × Ty = (-dz/dx, -dz/dy, 1).
    for (var jj = 0; jj < n; jj++) {
      for (var ii = 0; ii < n; ii++) {
        var c = jj * n + ii;
        var il = ii > 0 ? c - 1 : c;
        var ir = ii < n - 1 ? c + 1 : c;
        var jd = jj > 0 ? c - n : c;
        var ju = jj < n - 1 ? c + n : c;
        var dzx = (vz[ir] - vz[il]) / ((ir === c || il === c ? 1 : 2) * step);
        var dzy = (vz[ju] - vz[jd]) / ((ju === c || jd === c ? 1 : 2) * step);
        var ax = -dzx, ay = -dzy, az = 1.0;
        var inv = 1.0 / Math.sqrt(ax * ax + ay * ay + az * az);
        nx[c] = ax * inv; ny[c] = ay * inv; nz[c] = az * inv;
      }
    }
  }

  // ── Проекция узлов в экран ──────────────────────────────────────
  var cx2 = 0, cy2 = 0, scale = 1;
  function projectAll() {
    var n2 = count;
    for (var i = 0; i < n2; i++) {
      var x = vx[i], y = vy[i], z = vz[i];
      // в систему камеры
      var ex = r00 * x + r01 * y + r02 * z;
      var ey = r10 * x + r11 * y + r12 * z;
      var ez = r20 * x + r21 * y + r22 * z;
      // камера на расстоянии camZ вдоль +Z мира относительно центра:
      // глубина растёт от камеры. depth = camZ - ez.
      var depth = camZ - ez;
      pdepth[i] = depth;
      if (depth > 0.05) {
        var k = (FOV * scale) / depth;
        px[i] = cx2 + ex * k;
        py[i] = cy2 - ey * k;
        pcull[i] = 1;
      } else {
        pcull[i] = 0;
      }
    }
  }

  // ── Освещение узла → итоговый цвет (Ламберт + амбиент) ──────────
  var col = [0, 0, 0];
  var AMBIENT = 0.28;
  function shadeVertex(i, hNorm, out) {
    var d = nx[i] * LX + ny[i] * LY + nz[i] * LZ;
    if (d < 0) d = -d * 0.35;             // обратная сторона — слабая подсветка
    var lit = AMBIENT + (1 - AMBIENT) * d;
    colormap(hNorm, col);
    out[0] = col[0] * lit;
    out[1] = col[1] * lit;
    out[2] = col[2] * lit;
  }

  // ── Отрисовка кадра ─────────────────────────────────────────────
  var c0 = [0, 0, 0], c1 = [0, 0, 0], c2 = [0, 0, 0], c3 = [0, 0, 0];
  function render() {
    var w = canvas.width, h = canvas.height;
    // фон-градиент
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#10141d');
    g.addColorStop(1, '#070a10');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    var n = N;
    var qn = (n - 1) * (n - 1);
    var zr = (zMax - zMin) || 1;

    // ключи глубины квадов = средняя глубина 4 углов; сортировка дальние→ближние
    for (var qi = 0; qi < qn; qi++) {
      var b = qi * 4;
      var i0 = quads[b], i1 = quads[b + 1], i2 = quads[b + 2], i3 = quads[b + 3];
      qKey[qi] = pdepth[i0] + pdepth[i1] + pdepth[i2] + pdepth[i3];
      qOrder[qi] = qi;
    }
    sortOrder(qOrder, qKey, qn);

    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;

    for (var o = 0; o < qn; o++) {
      var q = qOrder[o] * 4;
      var a0 = quads[q], a1 = quads[q + 1], a2 = quads[q + 2], a3 = quads[q + 3];
      if (!pcull[a0] || !pcull[a1] || !pcull[a2] || !pcull[a3]) continue;

      var X0 = px[a0], Y0 = py[a0];
      var X1 = px[a1], Y1 = py[a1];
      var X2 = px[a2], Y2 = py[a2];
      var X3 = px[a3], Y3 = py[a3];

      // средний цвет квада: затенение 4 узлов, усреднённое (быстрый Гуро-подобный фон)
      var hn0 = (vz[a0] - zMin) / zr;
      var hn1 = (vz[a1] - zMin) / zr;
      var hn2 = (vz[a2] - zMin) / zr;
      var hn3 = (vz[a3] - zMin) / zr;
      shadeVertex(a0, hn0, c0);
      shadeVertex(a1, hn1, c1);
      shadeVertex(a2, hn2, c2);
      shadeVertex(a3, hn3, c3);
      var rr = (c0[0] + c1[0] + c2[0] + c3[0]) * 0.25;
      var gg = (c0[1] + c1[1] + c2[1] + c3[1]) * 0.25;
      var bb = (c0[2] + c1[2] + c2[2] + c3[2]) * 0.25;
      var fill = 'rgb(' + (rr | 0) + ',' + (gg | 0) + ',' + (bb | 0) + ')';

      ctx.beginPath();
      ctx.moveTo(X0, Y0);
      ctx.lineTo(X1, Y1);
      ctx.lineTo(X2, Y2);
      ctx.lineTo(X3, Y3);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (showWire) {
        ctx.strokeStyle = 'rgba(8,12,18,0.55)';
        ctx.stroke();
      } else {
        // тонкая заливочная окантовка того же цвета убирает швы анти-алиасинга
        ctx.strokeStyle = fill;
        ctx.stroke();
      }
    }
  }

  // Сортировка вставками по убыванию ключа (дальние сначала).
  // Для типичных N сетка почти отсортирована между кадрами →
  // вставочная сортировка эффективна; используем её как стабильный «painter».
  function sortOrder(order, key, len) {
    for (var i = 1; i < len; i++) {
      var oi = order[i];
      var ki = key[oi];
      var j = i - 1;
      while (j >= 0 && key[order[j]] < ki) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = oi;
    }
  }

  // ── Цикл анимации ───────────────────────────────────────────────
  var lastTs = 0;
  function frame(ts) {
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    if (running) time += dt * speed;
    if (spinning) camAngle += dt * 0.18;     // медленное вращение камеры

    buildCamera();
    buildSurface();
    projectAll();
    render();
    requestAnimationFrame(frame);
  }

  // ── Размер canvas под контейнер (iframe любого размера) ─────────
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth || window.innerWidth;
    var h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    cx2 = canvas.width / 2;
    cy2 = canvas.height / 2;
    // масштаб проекции от меньшей стороны, чтобы поверхность всегда влезала
    scale = Math.min(canvas.width, canvas.height) * 0.62;
  }
  window.addEventListener('resize', resize);
  resize();

  // ── Управление ──────────────────────────────────────────────────
  function rebuildGrid(n) {
    N = n;
    allocBuffers(n);
    allocQuads(n);
    allocOrder(n);
  }

  document.getElementById('funcs').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    fnKey = btn.getAttribute('data-fn');
    var kids = this.querySelectorAll('button');
    for (var i = 0; i < kids.length; i++) kids[i].classList.toggle('on', kids[i] === btn);
    document.getElementById('eq').innerHTML = EQ_TEXT[fnKey];
    if (fnKey === 'ripple') time = 0;        // рябь начинается с импульса в центре
  });

  var playBtn = document.getElementById('playPause');
  playBtn.addEventListener('click', function () {
    running = !running;
    this.textContent = running ? 'Пауза' : 'Старт';
    this.classList.toggle('on', !running);
  });

  var spinBtn = document.getElementById('spin');
  spinBtn.addEventListener('click', function () {
    spinning = !spinning;
    this.classList.toggle('on', spinning);
  });

  var wireBtn = document.getElementById('wire');
  wireBtn.addEventListener('click', function () {
    showWire = !showWire;
    this.classList.toggle('on', showWire);
  });

  document.getElementById('grid').addEventListener('input', function () {
    rebuildGrid(parseInt(this.value, 10));
  });

  document.getElementById('speed').addEventListener('input', function () {
    speed = parseFloat(this.value);
  });

  // Перетаскивание мышью/тачем — ручное вращение и наклон камеры.
  var dragging = false, lastX = 0, lastY = 0;
  function pointerDown(x, y) { dragging = true; lastX = x; lastY = y; spinning = false; spinBtn.classList.remove('on'); }
  function pointerMove(x, y) {
    if (!dragging) return;
    camAngle += (x - lastX) * 0.006;
    camElev += (y - lastY) * 0.005;
    if (camElev < 0.08) camElev = 0.08;
    if (camElev > 1.45) camElev = 1.45;
    lastX = x; lastY = y;
  }
  function pointerUp() { dragging = false; }

  canvas.addEventListener('mousedown', function (e) { pointerDown(e.clientX, e.clientY); });
  window.addEventListener('mousemove', function (e) { pointerMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup', pointerUp);
  canvas.addEventListener('touchstart', function (e) {
    if (e.touches.length) { pointerDown(e.touches[0].clientX, e.touches[0].clientY); }
  }, { passive: true });
  canvas.addEventListener('touchmove', function (e) {
    if (e.touches.length) { pointerMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
  }, { passive: false });
  canvas.addEventListener('touchend', pointerUp);

  // Колесо — приближение/отдаление камеры.
  canvas.addEventListener('wheel', function (e) {
    camDist += e.deltaY * 0.01;
    if (camDist < 9) camDist = 9;
    if (camDist > 34) camDist = 34;
    e.preventDefault();
  }, { passive: false });

  requestAnimationFrame(frame);
})();
