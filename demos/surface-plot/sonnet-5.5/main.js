/*
 * 3D-поверхность функции z = f(x, y, t) — Canvas 2D, без библиотек.
 *
 * Конвейер кадра:
 *   1. высоты h в узлах сетки (N+1)×(N+1) по выбранной функции (с плавным морфингом при смене);
 *   2. нормали в узлах — конечные разности по высотам, затем освещение по Ламберту в узлах;
 *   3. перспективная проекция узлов (орбитальная камера, медленное вращение);
 *   4. сортировка полигонов по глубине (сортировка подсчётом, O(n)) и отрисовка дальними вперёд —
 *      алгоритм художника; цвет полигона = цветовая карта по высоте × освещённость узлов;
 *   5. опционально каркас поверх заливки (скрытые линии отсекаются самим порядком отрисовки).
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  function $(id) { return document.getElementById(id); }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  /* ================================================================
   * 1. Функции. Вход: (u, v) ∈ [−1, 1]² (нормированная область) и время t.
   *    Выход: безразмерная высота h. lo/hi — ФИКСИРОВАННЫЙ диапазон цветовой карты
   *    (чтобы цвет не «плавал» от кадра к кадру).
   * ================================================================ */
  var FUNCS = [
    {
      name: 'Рябь',
      formula: 'z = sin(r − t) / r ,   r = √(x² + y²)',
      lo: -0.8, hi: 0.8,
      f: function (u, v, t) {
        var x = u * 8, y = v * 8;
        // r слегка «смягчён», чтобы в центре не было бесконечного пика
        var a = 1.25 * Math.sqrt(x * x + y * y + 0.09);
        return Math.sin(a - 2.6 * t) / Math.sqrt(1 + 0.12 * a * a);
      }
    },
    {
      name: 'Седло',
      formula: 'z = x² − y²   (оси седла вращаются и «дышат»)',
      lo: -1.4, hi: 1.4,
      f: function (u, v, t) {
        var th = 0.32 * t, c = Math.cos(th), s = Math.sin(th);
        var x = u * c + v * s, y = -u * s + v * c;
        var breath = 0.78 + 0.22 * Math.sin(0.9 * t);
        return 0.8 * breath * (x * x - y * y);
      }
    },
    {
      name: 'Гауссиана',
      formula: 'z = e^(−(x² + y²) / 2σ²) ,  σ пульсирует, рядом орбитальный пик',
      lo: -0.85, hi: 1.3,
      f: function (u, v, t) {
        var s1 = 0.36 + 0.08 * Math.sin(0.9 * t);
        var dx = u - 0.10 * Math.cos(0.5 * t), dy = v - 0.10 * Math.sin(0.7 * t);
        var g1 = Math.exp(-(dx * dx + dy * dy) / (2 * s1 * s1));
        var s2 = 0.20 + 0.04 * Math.sin(1.7 * t);
        var ex = u - 0.70 * Math.cos(0.6 * t), ey = v - 0.50 * Math.sin(0.6 * t);
        var g2 = Math.exp(-(ex * ex + ey * ey) / (2 * s2 * s2));
        return 2.1 * (g1 + 0.55 * g2) - 0.85;
      }
    },
    {
      name: 'Интерференция',
      formula: 'z = sin(r₁ − t)/r₁ + sin(r₂ − t)/r₂ ,  два вращающихся источника',
      lo: -1.0, hi: 1.0,
      f: function (u, v, t) {
        var x = u * 8, y = v * 8;
        var ang = 0.35 * t;
        var sx = 3.0 * Math.cos(ang), sy = 3.0 * Math.sin(ang);
        var dx1 = x - sx, dy1 = y - sy, dx2 = x + sx, dy2 = y + sy;
        var a1 = 1.4 * Math.sqrt(dx1 * dx1 + dy1 * dy1 + 0.09);
        var a2 = 1.4 * Math.sqrt(dx2 * dx2 + dy2 * dy2 + 0.09);
        var ph = 2.6 * t;
        return 0.8 * (Math.sin(a1 - ph) / Math.sqrt(1 + 0.12 * a1 * a1) +
                      Math.sin(a2 - ph) / Math.sqrt(1 + 0.12 * a2 * a2));
      }
    },
    {
      name: 'Решётка',
      formula: 'z = sin(x + t) · cos(y − t)   (бегущая «яичная коробка»)',
      lo: -0.9, hi: 0.9,
      f: function (u, v, t) {
        return 0.9 * Math.sin(6.2 * u + 1.3 * t) * Math.cos(6.2 * v - 0.9 * t);
      }
    }
  ];

  /* ================================================================
   * 2. Цветовые карты (таблица 256 цветов).
   * ================================================================ */
  var PALETTES = [
    { name: 'Спектр', stops: [[0, '#2d1b8e'], [0.2, '#2b6fe0'], [0.4, '#17c1c9'], [0.55, '#4be37a'], [0.7, '#d4e93a'], [0.85, '#fba02b'], [1, '#e8362a']] },
    { name: 'Viridis', stops: [[0, '#46105f'], [0.25, '#3b528b'], [0.5, '#21918c'], [0.75, '#5ec962'], [1, '#fde725']] },
    { name: 'Magma', stops: [[0, '#2b115f'], [0.25, '#721f81'], [0.5, '#c03a76'], [0.75, '#fc8961'], [1, '#fcfdbf']] },
    { name: 'Coolwarm', stops: [[0, '#3b4cc0'], [0.25, '#8db0fe'], [0.5, '#dddcdc'], [0.75, '#f4987a'], [1, '#b40426']] }
  ];
  var LUT = new Uint8Array(256 * 3);

  function hexRGB(h) {
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
  }
  function buildLUT(p) {
    var st = PALETTES[p].stops.map(function (s) { return { at: s[0], rgb: hexRGB(s[1]) }; });
    for (var i = 0; i < 256; i++) {
      var s = i / 255, k = 1;
      while (k < st.length - 1 && s > st[k].at) k++;
      var a = st[k - 1], b = st[k];
      var w = clamp((s - a.at) / (b.at - a.at), 0, 1);
      for (var c = 0; c < 3; c++) LUT[i * 3 + c] = Math.round(a.rgb[c] + (b.rgb[c] - a.rgb[c]) * w);
    }
  }

  /* ================================================================
   * 3. Состояние
   * ================================================================ */
  var state = { fn: 0, mode: 1, pal: 0, speed: 1, amp: 1, grid: 60, paused: false, spin: true };
  var cam = { az: 0.6, el: 0.6, zoom: 1 };
  var ZMIN = 0.55, ZMAX = 2.0;

  var simT = 0.8;          // время анимации функции
  var camT = 0;            // время для лёгкого покачивания камеры
  var bobAmt = 1;          // 0..1 — плавное включение покачивания
  var morph = 1;           // 0..1 — прогресс перехода между функциями
  var snapLo = -1, snapHi = 1, curLo = -1, curHi = 1;

  var HSCALE = 0.4;        // мировая высота при h = 1 и «Высота» = 1×
  var ZFLOOR = -0.9, ZTOP = 0.9;   // пол и верх «клетки» вокруг графика
  var FIT_R = 1.68;        // радиус сферы, которую камера вписывает в экран
  var FOV = 36 * Math.PI / 180;
  var AMB = 0.30;          // фоновая освещённость

  // направление на источник света (мировые координаты, z вверх)
  var LA = -0.5, LE = 0.84;
  var Lx = Math.cos(LE) * Math.cos(LA), Ly = Math.cos(LE) * Math.sin(LA), Lz = Math.sin(LE);
  var BG = [15, 24, 44];   // цвет дымки (чуть светлее фона)

  /* ================================================================
   * 4. Сетка (буферы пересоздаются при смене разрешения)
   * ================================================================ */
  var N = 0, V = 0;
  var grid, HR, HSnap, Zw, TT, INT, SX, SY, SD, keys, order, bk;
  var DEPTH_BUCKETS = 4096;
  var cnt = new Int32Array(DEPTH_BUCKETS + 1);

  function allocMesh(n) {
    N = Math.max(8, n | 0);
    V = N + 1;
    var nv = V * V, nq = N * N;
    grid = new Float32Array(V);
    for (var i = 0; i < V; i++) grid[i] = -1 + 2 * i / N;
    HR = new Float32Array(nv);      // высоты h (после морфинга) — они же снимок при смене функции
    HSnap = new Float32Array(nv);   // снимок «откуда морфим»
    Zw = new Float32Array(nv);      // мировая высота z
    TT = new Float32Array(nv);      // параметр цветовой карты 0..1
    INT = new Float32Array(nv);     // освещённость узла по Ламберту
    SX = new Float32Array(nv);
    SY = new Float32Array(nv);
    SD = new Float32Array(nv);      // глубина узла в системе камеры
    keys = new Float32Array(nq);    // глубина полигона
    order = new Uint32Array(nq);    // порядок отрисовки (дальние первыми)
    bk = new Uint16Array(nq);
    morph = 1;                      // не морфим из свежевыделенных нулей
  }

  function updateSurface(t) {
    var fn = FUNCS[state.fn], f = fn.f;
    var m = morph < 1 ? smooth(morph) : 1;
    var lo = m < 1 ? snapLo + (fn.lo - snapLo) * m : fn.lo;
    var hi = m < 1 ? snapHi + (fn.hi - snapHi) * m : fn.hi;
    curLo = lo; curHi = hi;
    var inv = 1 / (hi - lo);
    var zs = HSCALE * state.amp;
    var i, j, idx;

    for (j = 0; j < V; j++) {
      var v = grid[j], row = j * V;
      for (i = 0; i < V; i++) {
        idx = row + i;
        var h = f(grid[i], v, t);
        if (m < 1) { var hp = HSnap[idx]; h = hp + (h - hp) * m; }
        HR[idx] = h;
        Zw[idx] = h * zs;
        var tt = (h - lo) * inv;
        TT[idx] = tt < 0 ? 0 : (tt > 1 ? 1 : tt);
      }
    }

    // нормали в узлах (конечные разности, на краях — односторонние) и закон Ламберта
    var dx = 2 / N;
    for (j = 0; j < V; j++) {
      var jm = j > 0 ? j - 1 : j, jp = j < N ? j + 1 : j;
      var ry = (jp - jm) * dx;
      for (i = 0; i < V; i++) {
        var im = i > 0 ? i - 1 : i, ip = i < N ? i + 1 : i;
        var gx = (Zw[j * V + ip] - Zw[j * V + im]) / ((ip - im) * dx);
        var gy = (Zw[jp * V + i] - Zw[jm * V + i]) / ry;
        var il = 1 / Math.sqrt(gx * gx + gy * gy + 1);       // нормаль = (−gx, −gy, 1) · il
        var ndl = (Lz - gx * Lx - gy * Ly) * il;
        INT[j * V + i] = AMB + (1 - AMB) * (ndl > 0 ? ndl : 0);
      }
    }
  }

  /* ================================================================
   * 5. Камера и проекция
   * ================================================================ */
  var W = 0, H = 0, DPR = 1, panelTop = 0;
  var _sa = 0, _ca = 1, _se = 0, _ce = 1, _cs = 0, _ss = 0, _fx = 0, _fy = 0, _fz = 0;
  var _dist = 5, _focal = 600, _cx = 0, _cy = 0;
  var pX = 0, pY = 0, pD = 0;

  function setupCamera() {
    var el = clamp(cam.el + 0.05 * bobAmt * Math.sin(camT * 0.31), 0.1, 1.45);
    var az = cam.az;
    _sa = Math.sin(az); _ca = Math.cos(az);
    _se = Math.sin(el); _ce = Math.cos(el);
    _cs = _ca * _se; _ss = _sa * _se;
    _fx = -_ce * _ca; _fy = -_ce * _sa; _fz = -_se;       // направление взгляда (на начало координат)
    _dist = FIT_R / Math.sin(FOV / 2) / cam.zoom;
    var avail = Math.max(200, panelTop - 36);      // свободная высота над панелью управления
    var S = Math.max(160, Math.min(W, avail));
    _focal = 0.5 * S / Math.tan(FOV / 2);
    _cx = W * 0.5;
    _cy = avail * 0.5 + 12;
  }

  // перспективная проекция точки мира → экран (результат в pX, pY, pD)
  function proj(x, y, z) {
    var xv = -_sa * x + _ca * y;                           // вправо
    var yv = -_cs * x - _ss * y + _ce * z;                 // вверх
    var zv = _fx * x + _fy * y + _fz * z + _dist;          // глубина вдоль взгляда
    if (zv < 0.05) zv = 0.05;
    var k = _focal / zv;
    pX = _cx + xv * k;
    pY = _cy - yv * k;
    pD = zv;
  }

  /* ================================================================
   * 6. Отрисовка
   * ================================================================ */
  var canvas = $('view');
  var ctx = canvas.getContext('2d', { alpha: false });
  var bgGrad = null;
  var panel = $('panel');

  function measurePanel() {
    var r = panel.getBoundingClientRect();
    panelTop = r.top > 0 ? r.top : H;
  }

  function syncSize() {
    var de = document.documentElement;
    var w = Math.max(1, window.innerWidth || de.clientWidth || 1);
    var h = Math.max(1, window.innerHeight || de.clientHeight || 1);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === W && h === H && dpr === DPR) return;
    W = w; H = h; DPR = dpr;
    canvas.width = Math.max(1, Math.round(W * DPR));
    canvas.height = Math.max(1, Math.round(H * DPR));
    bgGrad = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
    bgGrad.addColorStop(0, '#16223f');
    bgGrad.addColorStop(1, '#070b15');
    measurePanel();
  }

  function drawFloor() {
    var m, g;
    // подложка
    proj(-1, -1, ZFLOOR); var x0 = pX, y0 = pY;
    proj(1, -1, ZFLOOR); var x1 = pX, y1 = pY;
    proj(1, 1, ZFLOOR); var x2 = pX, y2 = pY;
    proj(-1, 1, ZFLOOR); var x3 = pX, y3 = pY;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath();
    ctx.fillStyle = 'rgba(120, 150, 255, 0.045)';
    ctx.fill();

    // линии сетки пола
    ctx.beginPath();
    for (m = 1; m < 8; m++) {
      g = -1 + m * 0.25;
      proj(-1, g, ZFLOOR); ctx.moveTo(pX, pY); proj(1, g, ZFLOOR); ctx.lineTo(pX, pY);
      proj(g, -1, ZFLOOR); ctx.moveTo(pX, pY); proj(g, 1, ZFLOOR); ctx.lineTo(pX, pY);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(160, 190, 255, 0.10)';
    ctx.stroke();

    // контур пола
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath();
    ctx.strokeStyle = 'rgba(160, 190, 255, 0.30)';
    ctx.stroke();
  }

  var CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  var cornerDepth = [0, 0, 0, 0];

  function sortCorners() {
    for (var c = 0; c < 4; c++) { proj(CORNERS[c][0], CORNERS[c][1], 0); cornerDepth[c] = pD; }
    // порог между «дальними» и «ближними» стойками — медиана глубин
    var s = cornerDepth.slice().sort(function (a, b) { return a - b; });
    return (s[1] + s[2]) * 0.5;
  }

  // стойки «клетки»: дальние рисуем до поверхности, ближние — после
  function drawPosts(near, split) {
    ctx.beginPath();
    for (var c = 0; c < 4; c++) {
      if ((cornerDepth[c] < split) !== near) continue;
      proj(CORNERS[c][0], CORNERS[c][1], ZFLOOR); ctx.moveTo(pX, pY);
      proj(CORNERS[c][0], CORNERS[c][1], ZTOP); ctx.lineTo(pX, pY);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(160, 190, 255, 0.22)';
    ctx.stroke();
  }

  var FILL_DARK = '#0b1121';

  function drawSurface() {
    var i, j, q;
    var nq = N * N;

    // --- проекция узлов ---
    for (j = 0; j < V; j++) {
      var py = grid[j], row = j * V;
      for (i = 0; i < V; i++) {
        var idx = row + i;
        proj(grid[i], py, Zw[idx]);
        SX[idx] = pX; SY[idx] = pY; SD[idx] = pD;
      }
    }

    // --- глубина полигонов + сортировка подсчётом (дальние первыми) ---
    var kmin = 1e9, kmax = -1e9;
    for (j = 0; j < N; j++) {
      for (i = 0; i < N; i++) {
        var a0 = j * V + i;
        var d = (SD[a0] + SD[a0 + 1] + SD[a0 + V] + SD[a0 + V + 1]) * 0.25;
        q = j * N + i;
        keys[q] = d;
        if (d < kmin) kmin = d;
        if (d > kmax) kmax = d;
      }
    }
    var sc = (DEPTH_BUCKETS - 1) / Math.max(kmax - kmin, 1e-6);
    cnt.fill(0);
    for (q = 0; q < nq; q++) {
      var b = ((kmax - keys[q]) * sc) | 0;
      bk[q] = b;
      cnt[b + 1]++;
    }
    for (q = 0; q < DEPTH_BUCKETS; q++) cnt[q + 1] += cnt[q];
    for (q = 0; q < nq; q++) order[cnt[bk[q]]++] = q;

    // --- рисуем дальние → ближние ---
    var mode = state.mode;
    var fogNear = _dist - 1.6, fogInv = 1 / 3.2;
    ctx.lineJoin = 'round';
    ctx.lineWidth = mode === 1 ? 0.7 : 1;

    for (var n = 0; n < nq; n++) {
      q = order[n];
      j = (q / N) | 0;
      i = q - j * N;
      var a = j * V + i, bb = a + 1, c = bb + V, dd = a + V;

      var tt = (TT[a] + TT[bb] + TT[c] + TT[dd]) * 0.25;
      var li = (INT[a] + INT[bb] + INT[c] + INT[dd]) * 0.25;
      var o = ((tt * 255 + 0.5) | 0) * 3;
      var fg = clamp((keys[q] - fogNear) * fogInv, 0, 1) * 0.30;   // дальние полигоны тонут в дымке

      var lk = mode === 2 ? 0.55 + 0.45 * li : li;
      var r = LUT[o] * lk, g = LUT[o + 1] * lk, bl = LUT[o + 2] * lk;
      r += (BG[0] - r) * fg; g += (BG[1] - g) * fg; bl += (BG[2] - bl) * fg;
      r |= 0; g |= 0; bl |= 0;

      ctx.beginPath();
      ctx.moveTo(SX[a], SY[a]);
      ctx.lineTo(SX[bb], SY[bb]);
      ctx.lineTo(SX[c], SY[c]);
      ctx.lineTo(SX[dd], SY[dd]);
      ctx.closePath();

      if (mode === 0) {
        // заливка; обводка тем же цветом закрывает щели антиалиасинга между полигонами
        var col = 'rgb(' + r + ',' + g + ',' + bl + ')';
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        ctx.fill();
        ctx.stroke();
      } else if (mode === 1) {
        // заливка + каркас: линия — оттенок цвета грани (темнее на светлом, светлее на тёмном)
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + bl + ')';
        ctx.fill();
        var lum = 0.3 * r + 0.59 * g + 0.11 * bl;
        if (lum > 120) {
          ctx.strokeStyle = 'rgb(' + ((r * 0.55) | 0) + ',' + ((g * 0.55) | 0) + ',' + ((bl * 0.55) | 0) + ')';
        } else {
          ctx.strokeStyle = 'rgb(' + ((r + (255 - r) * 0.30) | 0) + ',' + ((g + (255 - g) * 0.30) | 0) + ',' + ((bl + (255 - bl) * 0.30) | 0) + ')';
        }
        ctx.stroke();
      } else {
        // только каркас: тёмная заливка скрывает линии дальних граней
        ctx.fillStyle = FILL_DARK;
        ctx.fill();
        ctx.strokeStyle = 'rgb(' + r + ',' + g + ',' + bl + ')';
        ctx.stroke();
      }
    }
  }

  // экранный указатель осей в правом верхнем углу
  function drawGizmo() {
    var ox = W - 52, oy = 60, L = 30;
    var axes = [
      [-_sa, _ca * _se, '#ff8095', 'x'],
      [_ca, _sa * _se, '#7ef0a8', 'y'],
      [0, -_ce, '#7cb8ff', 'z']
    ];
    ctx.beginPath();
    ctx.arc(ox, oy, L + 12, 0, TAU);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var k = 0; k < axes.length; k++) {
      var ax = axes[k], ex = ox + ax[0] * L, ey = oy + ax[1] * L;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = ax[2];
      ctx.stroke();
      ctx.fillStyle = ax[2];
      ctx.fillText(ax[3], ox + ax[0] * (L + 9), oy + ax[1] * (L + 9));
    }
    ctx.lineCap = 'butt';
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    setupCamera();
    updateSurface(simT);

    drawFloor();
    var split = sortCorners();
    drawPosts(false, split);
    drawSurface();
    drawPosts(true, split);
    drawGizmo();
  }

  /* ================================================================
   * 7. Цикл анимации
   * ================================================================ */
  var statsEl = $('stats');
  var lastNow = null;
  var statAcc = 0, statFrames = 0, statWork = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    var t0 = performance.now();

    var dt = lastNow === null ? 1 / 60 : (now - lastNow) / 1000;
    lastNow = now;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.05) dt = 0.05;                       // кламп больших пауз (вкладка в фоне)

    syncSize();
    if (!state.paused) simT += dt * state.speed;
    camT += dt;
    bobAmt += ((state.spin ? 1 : 0) - bobAmt) * Math.min(1, dt * 3);
    if (state.spin && pointers.size === 0) cam.az += dt * 0.15;
    if (morph < 1) morph = Math.min(1, morph + dt / 0.9);

    render();

    statWork += performance.now() - t0;
    statFrames++;
    statAcc += dt;
    if (statAcc >= 0.5) {
      var fps = Math.round(statFrames / statAcc);
      statsEl.textContent = N + '×' + N + ' · ' + (N * N) + ' полигонов · ' + fps + ' к/с · ' +
        (statWork / statFrames).toFixed(1) + ' мс/кадр';
      statAcc = 0; statFrames = 0; statWork = 0;
      measurePanel();
    }
  }

  /* ================================================================
   * 8. Ввод: орбита мышью/пальцем, масштаб колесом и щипком
   * ================================================================ */
  var pointers = new Map();
  var pinchStart = 0, pinchZoom = 1;

  function pinchDist() {
    var pts = [];
    pointers.forEach(function (p) { pts.push(p); });
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  canvas.addEventListener('pointerdown', function (e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    if (pointers.size === 2) { pinchStart = pinchDist() || 1; pinchZoom = cam.zoom; }
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 1) {
      cam.az -= (e.clientX - p.x) * 0.007;
      cam.el = clamp(cam.el + (e.clientY - p.y) * 0.006, 0.1, 1.45);
      p.x = e.clientX; p.y = e.clientY;
    } else {
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 2) cam.zoom = clamp(pinchZoom * pinchDist() / pinchStart, ZMIN, ZMAX);
    }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) canvas.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    cam.zoom = clamp(cam.zoom * Math.exp(-e.deltaY * 0.0012), ZMIN, ZMAX);
  }, { passive: false });

  /* ================================================================
   * 9. Панель управления
   * ================================================================ */
  var formulaEl = $('formula');

  // сегментная кнопочная группа; возвращает функцию обновления «нажатого» состояния
  function segment(container, labels, get, set) {
    var btns = labels.map(function (label, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', function () { set(i); });
      container.appendChild(b);
      return b;
    });
    function refresh() {
      btns.forEach(function (b, i) { b.setAttribute('aria-pressed', i === get() ? 'true' : 'false'); });
    }
    refresh();
    return refresh;
  }

  function selectFn(i) {
    i = clamp(i, 0, FUNCS.length - 1);
    if (i === state.fn) return;
    HSnap.set(HR);                  // старая форма (даже недоморфленная) — отправная точка перехода
    snapLo = curLo; snapHi = curHi;
    morph = 0;
    state.fn = i;
    formulaEl.textContent = FUNCS[i].formula;
    refreshFn();
  }
  function selectMode(i) { state.mode = i; refreshMode(); }

  var refreshFn = segment($('fnSeg'), FUNCS.map(function (f) { return f.name; }),
    function () { return state.fn; }, selectFn);
  var refreshMode = segment($('modeSeg'), ['Заливка', 'Заливка + каркас', 'Каркас'],
    function () { return state.mode; }, selectMode);

  // палитры — кнопки-образцы с градиентом
  var swBtns = [];
  function refreshPal() {
    swBtns.forEach(function (b, i) { b.setAttribute('aria-pressed', i === state.pal ? 'true' : 'false'); });
  }
  function selectPal(i) {
    state.pal = (i + PALETTES.length) % PALETTES.length;
    buildLUT(state.pal);
    refreshPal();
  }
  PALETTES.forEach(function (p, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw';
    b.title = 'Цветовая карта: ' + p.name;
    b.setAttribute('aria-label', 'Цветовая карта ' + p.name);
    b.style.background = 'linear-gradient(90deg,' +
      p.stops.map(function (s) { return s[1] + ' ' + Math.round(s[0] * 100) + '%'; }).join(',') + ')';
    b.addEventListener('click', function () { selectPal(i); });
    $('palSeg').appendChild(b);
    swBtns.push(b);
  });

  function bindRange(id, outId, fmt, apply) {
    var el = $(id), out = $(outId);
    function upd() {
      var v = parseFloat(el.value);
      out.textContent = fmt(v);
      apply(v);
    }
    el.addEventListener('input', upd);
    upd();
  }
  bindRange('speed', 'speedOut', function (v) { return v.toFixed(1) + '×'; }, function (v) { state.speed = v; });
  bindRange('amp', 'ampOut', function (v) { return v.toFixed(1) + '×'; }, function (v) { state.amp = v; });
  bindRange('grid', 'gridOut', function (v) { return v + '×' + v; }, function (v) {
    state.grid = v;
    if (v !== N) allocMesh(v);
  });

  var pauseBtn = $('pauseBtn'), spinBtn = $('spinBtn');
  function setPaused(p) {
    state.paused = p;
    pauseBtn.textContent = p ? 'Пуск' : 'Пауза';
    pauseBtn.setAttribute('aria-pressed', p ? 'true' : 'false');
  }
  function setSpin(s) {
    state.spin = s;
    spinBtn.setAttribute('aria-pressed', s ? 'true' : 'false');
  }
  pauseBtn.addEventListener('click', function () { setPaused(!state.paused); });
  spinBtn.addEventListener('click', function () { setSpin(!state.spin); });

  // клавиши: 1–5 функция, W режим, P палитра, R вращение, пробел пауза
  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    var onControl = e.target && (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT');
    if (/^[1-9]$/.test(k) && +k <= FUNCS.length) selectFn(+k - 1);
    else if (k === 'w' || k === 'W' || k === 'ц' || k === 'Ц') selectMode((state.mode + 1) % 3);
    else if (k === 'p' || k === 'P' || k === 'з' || k === 'З') selectPal(state.pal + 1);
    else if (k === 'r' || k === 'R' || k === 'к' || k === 'К') setSpin(!state.spin);
    else if (k === ' ' && !onControl) { e.preventDefault(); setPaused(!state.paused); }
  });

  /* ================================================================
   * 10. Старт
   * ================================================================ */
  buildLUT(state.pal);
  refreshPal();
  formulaEl.textContent = FUNCS[state.fn].formula;
  syncSize();
  requestAnimationFrame(frame);
})();
