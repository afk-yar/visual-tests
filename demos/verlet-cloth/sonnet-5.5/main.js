/* Ткань на верлет-интегрировании.
 *
 * Сетка частиц в 3D (x, y, z) со связями-констрейнтами: структурные (по сторонам
 * ячейки) и сдвиговые (по диагоналям). Интегрирование позиционное (верлет), связи
 * решаются итеративно по Гауссу-Зейделю, шаг фиксированный (1/180 с), кадры
 * накапливают время в аккумуляторе. Ветер действует как давление воздуха на
 * каждую ячейку: сила пропорциональна проекции скорости ветра (относительно
 * самой ткани) на нормаль ячейки. Рисуется Canvas 2D: перспективная проекция,
 * освещение по нормалям вершин (Гуро), узор шотландки в материальных координатах
 * ткани. Полотно растеризуется программно (треугольники + z-буфер) в буфер
 * ImageData и выводится одним drawImage; тень на стене, карниз и HUD рисуются
 * обычными средствами Canvas 2D.
 */
(function () {
  'use strict';

  /* ---------------- константы ---------------- */
  var F = 900;                  // фокусное расстояние камеры (ед. мира)
  var H = 1 / 180;              // фиксированный шаг симуляции, с
  var MAX_STEPS = 6;            // потолок шагов за кадр (защита от «спирали смерти»)
  var ITER = 9;                 // итераций решателя связей на шаг
  var WORLD_H = 760;            // высота мира (ширина зависит от пропорций окна)
  var ZMIN = -450, ZMAX = 300;  // коридор по глубине: к камере / к стене
  var WALL_Z = 360;             // плоскость стены (для тени)
  var G0 = 1100;                // гравитация, ед./с^2
  var DAMP = 0.9992;            // вязкое затухание за шаг
  var K_AIR = 1.5;              // коэффициент давления воздуха, 1/с
  var WIND0 = 300;              // базовая скорость ветра, ед./с
  var GATHER = 0.80;            // «сборка»: расстояние между креплениями / длина ткани
  var K_SHEAR = 0.6;            // жёсткость сдвиговых связей
  var PICK = 44;                // радиус подбора частицы курсором, px
  var CUT_R = 5;                // радиус ножа, px
  var SH_SCALE = 0.2;           // масштаб буфера тени (мягкость за счёт апскейла)
  var VMAX_K = 0.3;             // потолок скорости частицы: доля ячейки за шаг (гасит «катапульту»)
  var PATCH_SPEED = 3500;       // потолок скорости захваченного участка, px/с
  var TS = 8;                   // отсчётов таблицы узора на ячейку
  var RS_MIN = 0.5;             // границы масштаба растеризации полотна
  var HEADER_ROWS = 3;          // сколько верхних рядов образуют усиленную ленту
  var HEADER_K = 1.9;           // во сколько раз лента прочнее остальной ткани

  // свет: направление «от поверхности к источнику» (источник спереди-сверху-слева)
  var LX = -0.40, LY = -0.60, LZ = -0.70;
  var ll = Math.sqrt(LX * LX + LY * LY + LZ * LZ);
  LX /= ll; LY /= ll; LZ /= ll;
  // полувектор для блика (камера смотрит вдоль +z, вектор к камере = (0,0,-1))
  var HX = LX, HY = LY, HZ = LZ - 1;
  var hl = Math.sqrt(HX * HX + HY * HY + HZ * HZ);
  HX /= hl; HY /= hl; HZ /= hl;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------------- DOM ---------------- */
  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d', { alpha: false });
  var elStats = document.getElementById('stats');
  var elReset = document.getElementById('reset');

  /* ---------------- настройки UI ---------------- */
  var ui = { wind: 1, gravity: 1, tear: 1.9, pins: 6, view: 'cloth', tool: 'grab' };

  /* ---------------- вид (мир -> экран) ---------------- */
  var view = { w: 1280, h: 720, dpr: 1, k: 1, ox: 0, oy: 0 };

  /* ---------------- состояние ткани ---------------- */
  var WW = 1350, WH = WORLD_H;
  var cols = 0, rows = 0, L = 14, N = 0, Q = 0, CN = 0;
  var X, Y, Z, PX, PY, PZ, FX, FY, FZ, INV, HELD, PINNED, DEG;
  var SX, SY, SS, SHX, SHY;                    // экранные координаты частиц
  var CA, CB, CR, CK, CT, CLIVE, CM2;          // связи (CM2: квадрат множителя порога разрыва)
  var QE, QD;                                  // ячейки: 4 стороны, диагональ A-C
  var TRI, nTri;                               // список живых треугольников
  var NX, NY, NZ, RX, RY, AA1, AA2, AA3, AA4, STR, STC;   // атрибуты вершин
  var texHR, texHG, texHB, texVR, texVG, texVB;           // таблицы узора по осям
  var WVT = new Float32Array([1.025, 1, 0.975, 1]);       // мелкий «твил»
  var ceilY = 0;                               // потолок: выше карниза ткань не взлетает
  var pinCols = [];
  var totalStruct = 0, tornStruct = 0;
  var simT = 0;

  /* ---------------- палитра шотландки ---------------- */
  var C_RED = [206, 50, 62], C_NAVY = [38, 62, 138], C_GOLD = [244, 204, 104], C_CREAM = [242, 230, 200];
  function bandColor(idx) {
    var m = idx % 20;
    if (m < 9) return C_RED;
    if (m === 9) return C_GOLD;
    if (m < 12) return C_RED;
    if (m < 17) return C_NAVY;
    if (m === 17) return C_RED;
    if (m === 18) return C_CREAM;
    return C_RED;
  }

  /* ================================================================
   *  Построение ткани
   * ================================================================ */
  function build() {
    releaseGrab();
    var vw = window.innerWidth || 1280, vh = window.innerHeight || 720;
    WH = WORLD_H;
    WW = WH * clamp(vw / vh, 0.5, 2.4);
    var hc = 0.62 * WH;                                  // высота ткани в покое
    var wc = Math.min(0.84 * WW, 1.8 * hc);              // ширина ткани в покое
    cols = clamp(Math.floor(wc / 14) + 1, 24, 72);
    L = wc / (cols - 1);
    rows = clamp(Math.floor(hc / L) + 1, 14, 46);
    N = cols * rows;
    Q = (cols - 1) * (rows - 1);

    X = new Float64Array(N); Y = new Float64Array(N); Z = new Float64Array(N);
    PX = new Float64Array(N); PY = new Float64Array(N); PZ = new Float64Array(N);
    FX = new Float64Array(N); FY = new Float64Array(N); FZ = new Float64Array(N);
    SX = new Float64Array(N); SY = new Float64Array(N); SS = new Float64Array(N);
    SHX = new Float64Array(N); SHY = new Float64Array(N);
    INV = new Float32Array(N).fill(1);
    HELD = new Uint8Array(N); PINNED = new Uint8Array(N);
    DEG = new Int16Array(N);

    // крепления: «зажимы» по две соседние частицы верхнего ряда
    var np = clamp(ui.pins | 0, 2, Math.max(2, Math.floor(cols / 3)));
    pinCols = [];
    for (var k = 0; k < np; k++) pinCols.push(Math.round(k * (cols - 2) / (np - 1)));

    // начальная форма: ткань «собрана» между креплениями (шире, чем расстояние
    // между ними), поэтому складывается вертикальными складками
    var gx = GATHER * L;
    var x0 = (WW - gx * (cols - 1)) / 2, y0 = 0.155 * WH;
    ceilY = y0 - 12;
    var c0 = pinCols[0] + 0.5, c1 = pinCols[np - 1] + 0.5;
    function pleatZ(i, j) {
      if (i <= c0 || i >= c1) return 0;
      var s = 0;
      while (s < np - 2 && i > pinCols[s + 1] + 0.5) s++;
      var a = pinCols[s] + 0.5, b = pinCols[s + 1] + 0.5;
      var t = (i - a) / (b - a);
      var amp = Math.min(0.25 * (b - a) * gx, 70);
      return (s % 2 ? -1 : 1) * amp * Math.sin(Math.PI * t) * (1 - 0.25 * j / (rows - 1));
    }
    for (var j = 0; j < rows; j++) {
      for (var i = 0; i < cols; i++) {
        var p = j * cols + i;
        X[p] = x0 + i * gx;
        Y[p] = y0 + j * L;
        Z[p] = pleatZ(i, j) + (Math.random() - 0.5) * 0.8;
        PX[p] = X[p]; PY[p] = Y[p]; PZ[p] = Z[p];
      }
    }
    for (k = 0; k < np; k++) {
      PINNED[pinCols[k]] = 1; PINNED[pinCols[k] + 1] = 1;
      INV[pinCols[k]] = 0; INV[pinCols[k] + 1] = 0;
    }

    // связи
    var nh = (cols - 1) * rows, nv = cols * (rows - 1), ns = 2 * Q;
    CN = nh + nv + ns;
    CA = new Int32Array(CN); CB = new Int32Array(CN);
    CR = new Float64Array(CN); CK = new Float32Array(CN);
    CT = new Uint8Array(CN); CLIVE = new Uint8Array(CN).fill(1);
    CM2 = new Float32Array(CN).fill(1);
    var HI = new Int32Array(nh), VI = new Int32Array(nv);
    QD = new Int32Array(Q);
    var cc = 0;
    function addC(a, b, kind, rest, stiff) {
      CA[cc] = a; CB[cc] = b; CR[cc] = rest; CK[cc] = stiff; CT[cc] = kind;
      // вшитая лента вверху (как у штор) прочнее: ткань рвётся у курсора, а не у крючков
      if (Math.min((a / cols) | 0, (b / cols) | 0) < HEADER_ROWS) CM2[cc] = HEADER_K * HEADER_K;
      DEG[a]++; DEG[b]++;
      cc++;
    }
    var diag = L * Math.SQRT2;
    for (j = 0; j < rows; j++) {
      for (i = 0; i < cols; i++) {
        var a0 = j * cols + i;
        if (i < cols - 1) { HI[j * (cols - 1) + i] = cc; addC(a0, a0 + 1, 1, L, 1); }
        if (j < rows - 1) { VI[j * cols + i] = cc; addC(a0, a0 + cols, 1, L, 1); }
        if (i < cols - 1 && j < rows - 1) {
          QD[j * (cols - 1) + i] = cc;
          addC(a0, a0 + cols + 1, 0, diag, K_SHEAR);
          addC(a0 + 1, a0 + cols, 0, diag, K_SHEAR);
        }
      }
    }
    totalStruct = nh + nv;
    tornStruct = 0;

    // ячейки: 4 структурные связи (верх, низ, лево, право)
    QE = new Int32Array(4 * Q);
    var q = 0;
    for (j = 0; j < rows - 1; j++) {
      for (i = 0; i < cols - 1; i++, q++) {
        QE[4 * q] = HI[j * (cols - 1) + i];
        QE[4 * q + 1] = HI[(j + 1) * (cols - 1) + i];
        QE[4 * q + 2] = VI[j * cols + i];
        QE[4 * q + 3] = VI[j * cols + i + 1];
      }
    }

    // буферы рендера: треугольники, нормали и атрибуты вершин
    TRI = new Int32Array(6 * Q); nTri = 0;
    NX = new Float64Array(N); NY = new Float64Array(N); NZ = new Float64Array(N);
    RX = new Float64Array(N); RY = new Float64Array(N);
    AA1 = new Float32Array(N); AA2 = new Float32Array(N);
    AA3 = new Float32Array(N); AA4 = new Float32Array(N);
    STR = new Float32Array(N); STC = new Float32Array(N);
    buildTextures();
  }

  // Таблицы узора шотландки вдоль каждой оси: цвет полосы на отсчёт (TS отсчётов на
  // ячейку), границы полос размыты, значения уже поделены пополам (сумма двух осей
  // даёт среднее). Узор привязан к материальным координатам ткани и тянется вместе с ней.
  function buildTextures() {
    var lenU = cols * TS + 4, lenV = rows * TS + 4;
    texHR = new Float32Array(lenU); texHG = new Float32Array(lenU); texHB = new Float32Array(lenU);
    texVR = new Float32Array(lenV); texVG = new Float32Array(lenV); texVB = new Float32Array(lenV);
    fillAxis(texHR, texHG, texHB, lenU, 0);
    fillAxis(texVR, texVG, texVB, lenV, 5);
  }
  function fillAxis(tr, tg, tb, len, off) {
    var i, c;
    for (i = 0; i < len; i++) {
      c = bandColor(((i / TS) | 0) + off);
      tr[i] = c[0] * 0.5; tg[i] = c[1] * 0.5; tb[i] = c[2] * 0.5;
    }
    blurAxis(tr, len); blurAxis(tg, len); blurAxis(tb, len);
  }
  function blurAxis(a, len) {
    var tmp = new Float32Array(len), i, k, s, idx;
    for (i = 0; i < len; i++) {
      s = 0;
      for (k = -1; k <= 1; k++) {
        idx = i + k; idx = idx < 0 ? 0 : (idx >= len ? len - 1 : idx);
        s += a[idx];
      }
      tmp[i] = s / 3;
    }
    a.set(tmp);
  }

  function killC(c, count) {
    if (!CLIVE[c]) return;
    CLIVE[c] = 0;
    DEG[CA[c]]--; DEG[CB[c]]--;
    if (count && CT[c]) tornStruct++;
  }

  /* ================================================================
   *  Физика
   * ================================================================ */
  // Аэродинамика: давление воздуха на ячейку по нормали. Считается раз за кадр.
  function computeForces(t) {
    FX.fill(0); FY.fill(0); FZ.fill(0);
    var amp = WIND0 * ui.wind;
    var a0 = L * L, invH = 1 / H;
    var q = 0;
    for (var j = 0; j < rows - 1; j++) {
      for (var i = 0; i < cols - 1; i++, q++) {
        var e = q * 4;
        if (!(CLIVE[QE[e]] && CLIVE[QE[e + 1]] && CLIVE[QE[e + 2]] && CLIVE[QE[e + 3]])) continue;
        var a = j * cols + i, b = a + 1, d = a + cols, c = d + 1;
        var d1x = X[c] - X[a], d1y = Y[c] - Y[a], d1z = Z[c] - Z[a];
        var d2x = X[d] - X[b], d2y = Y[d] - Y[b], d2z = Z[d] - Z[b];
        var nx = d1y * d2z - d1z * d2y;
        var ny = d1z * d2x - d1x * d2z;
        var nz = d1x * d2y - d1y * d2x;
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nl < 1e-6) continue;
        var inl = 1 / nl, ux = nx * inl, uy = ny * inl, uz = nz * inl;

        // порывистый ветер: бегущая по ткани фаза
        var xc = (X[a] + X[c]) * 0.5, yc = (Y[a] + Y[c]) * 0.5;
        var ph = t - xc * 0.0045 + yc * 0.0016;
        var gz = (Math.sin(ph * 0.9) + 0.6 * Math.sin(ph * 1.7 + 1.3) + 0.35 * Math.sin(ph * 3.1 + 0.5)) * 0.513;
        var gxw = (Math.sin(ph * 0.7 + 2.1) + 0.5 * Math.sin(ph * 1.9)) * 0.667;
        var wx = amp * 0.45 * gxw;
        var wy = amp * 0.08 * Math.sin(ph * 1.3 + 0.7);
        var wz = amp * (0.85 * gz - 0.1);

        var vx = ((X[a] - PX[a]) + (X[b] - PX[b]) + (X[c] - PX[c]) + (X[d] - PX[d])) * 0.25 * invH;
        var vy = ((Y[a] - PY[a]) + (Y[b] - PY[b]) + (Y[c] - PY[c]) + (Y[d] - PY[d])) * 0.25 * invH;
        var vz = ((Z[a] - PZ[a]) + (Z[b] - PZ[b]) + (Z[c] - PZ[c]) + (Z[d] - PZ[d])) * 0.25 * invH;
        var un = (wx - vx) * ux + (wy - vy) * uy + (wz - vz) * uz;
        var area = nl / (2 * a0);
        if (area > 3) area = 3;
        var f = K_AIR * un * area * 0.25;
        var fx = f * ux, fy = f * uy, fz = f * uz;
        FX[a] += fx; FY[a] += fy; FZ[a] += fz;
        FX[b] += fx; FY[b] += fy; FZ[b] += fz;
        FX[c] += fx; FY[c] += fy; FZ[c] += fz;
        FX[d] += fx; FY[d] += fy; FZ[d] += fz;
      }
    }
  }

  function integrate(h) {
    var h2 = h * h, g = G0 * ui.gravity;
    var vmax = VMAX_K * L, vmax2 = vmax * vmax;
    for (var i = 0; i < N; i++) {
      if (INV[i] === 0) continue;
      var x = X[i], y = Y[i], z = Z[i];
      var vx = (x - PX[i]) * DAMP, vy = (y - PY[i]) * DAMP, vz = (z - PZ[i]) * DAMP;
      // Потолок скорости: растянутая ткань после отпускания/разрыва не «выстреливает»,
      // накопленная в связях деформация возвращается плавно
      var s2 = vx * vx + vy * vy + vz * vz;
      if (s2 > vmax2) { var f = vmax / Math.sqrt(s2); vx *= f; vy *= f; vz *= f; }
      PX[i] = x; PY[i] = y; PZ[i] = z;
      X[i] = x + vx + FX[i] * h2;
      var ny = y + vy + (FY[i] + g) * h2;
      Y[i] = ny < ceilY ? ceilY : ny;
      var nz = z + vz + FZ[i] * h2;
      Z[i] = nz < ZMIN ? ZMIN : (nz > ZMAX ? ZMAX : nz);
    }
  }

  // Итеративное решение дистанционных связей (Гаусс-Зейдель, сверху вниз)
  function solve() {
    for (var it = 0; it < ITER; it++) {
      for (var c = 0; c < CN; c++) {
        if (!CLIVE[c]) continue;
        var a = CA[c], b = CB[c];
        var ia = INV[a], ib = INV[b];
        var w = ia + ib;
        if (w === 0) continue;
        var dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a];
        var d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-12) continue;
        var d = Math.sqrt(d2);
        var k = CK[c] * (d - CR[c]) / (d * w);
        var ka = k * ia, kb = k * ib;
        X[a] += dx * ka; Y[a] += dy * ka; Z[a] += dz * ka;
        X[b] -= dx * kb; Y[b] -= dy * kb; Z[b] -= dz * kb;
      }
    }
  }

  // Разрыв: связь, растянутая сильнее порога после решения, удаляется
  function tearCheck() {
    var f2 = ui.tear * ui.tear;
    for (var c = 0; c < CN; c++) {
      if (!CLIVE[c]) continue;
      var a = CA[c], b = CB[c];
      var dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a];
      var r = CR[c];
      if (dx * dx + dy * dy + dz * dz > r * r * f2 * CM2[c]) killC(c, true);
    }
  }

  // Улетевшие за экран куски отключаем, чтобы не тратить на них время
  function cull() {
    if (!tornStruct) return;
    var lim = WH * 1.7, i;
    for (var c = 0; c < CN; c++) {
      if (CLIVE[c] && Y[CA[c]] > lim && Y[CB[c]] > lim) killC(c, false);
    }
    for (i = 0; i < N; i++) {
      if (DEG[i] === 0 && INV[i] !== 0 && Y[i] > lim) {
        INV[i] = 0; PX[i] = X[i]; PY[i] = Y[i]; PZ[i] = Z[i];
      }
    }
  }

  function step(h) {
    updateHeld(h);
    integrate(h);
    solve();
    tearCheck();
    simT += h;
  }

  /* ================================================================
   *  Мышь: захват и нож
   * ================================================================ */
  var ptr = { x: 0, y: 0, down: false, id: null, inside: false };
  var grab = { active: false, idx: [], ox: [], oy: [], z: [], gx: 0, gy: 0 };
  var trail = [];
  var cutPrev = null;

  function startGrab(px, py) {
    var best = -1, bd = PICK * PICK, i;
    for (i = 0; i < N; i++) {
      if (DEG[i] === 0) continue;
      var dx = SX[i] - px, dy = SY[i] - py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return false;
    var cell = L * view.k * SS[best];
    var R = clamp(1.25 * cell + 6, 16, 34), R2 = R * R;
    var bx = SX[best], by = SY[best];
    grab.idx.length = 0; grab.ox.length = 0; grab.oy.length = 0; grab.z.length = 0;
    for (i = 0; i < N; i++) {
      if (DEG[i] === 0 || PINNED[i]) continue;
      var ex = SX[i] - bx, ey = SY[i] - by;
      if (ex * ex + ey * ey <= R2) {
        grab.idx.push(i);
        grab.ox.push(SX[i] - px); grab.oy.push(SY[i] - py);
        grab.z.push(Z[i]);
      }
    }
    if (!grab.idx.length) return false;
    for (i = 0; i < grab.idx.length; i++) { HELD[grab.idx[i]] = 1; INV[grab.idx[i]] = 0; }
    grab.gx = px; grab.gy = py;
    grab.active = true;
    return true;
  }

  function releaseGrab() {
    if (!grab.active) return;
    for (var i = 0; i < grab.idx.length; i++) {
      var p = grab.idx[i];
      HELD[p] = 0;
      if (!PINNED[p]) INV[p] = 1;    // скорость последнего шага сохраняется: «бросок»
    }
    grab.active = false;
  }

  // Захваченный участок следует за курсором (экранная точка -> мир на своей глубине)
  function updateHeld(h) {
    if (!grab.active) return;
    // Точка захвата догоняет курсор почти мгновенно (постоянная времени 8 мс), но не
    // быстрее PATCH_SPEED: резкий рывок мыши не телепортирует участок и не рвёт всё сразу
    var mdx = ptr.x - grab.gx, mdy = ptr.y - grab.gy;
    var dist = Math.sqrt(mdx * mdx + mdy * mdy);
    if (dist > 1e-6) {
      var mv = dist * (1 - Math.exp(-h / 0.008)), cap = PATCH_SPEED * h;
      if (mv > cap) mv = cap;
      grab.gx += mdx / dist * mv;
      grab.gy += mdy / dist * mv;
    }
    var cx = WW * 0.5, cy = WH * 0.5, k = view.k;
    for (var n = 0; n < grab.idx.length; n++) {
      var i = grab.idx[n];
      var sxw = (grab.gx + grab.ox[n] - view.ox) / k;
      var syw = (grab.gy + grab.oy[n] - view.oy) / k;
      var z = grab.z[n];
      var s = F / (F + z);
      PX[i] = X[i]; PY[i] = Y[i]; PZ[i] = Z[i];
      X[i] = cx + (sxw - cx) / s;
      Y[i] = cy + (syw - cy) / s;
      Z[i] = z;
    }
  }

  function ptSeg2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = 0;
    if (l2 > 1e-9) { t = ((px - ax) * dx + (py - ay) * dy) / l2; t = t < 0 ? 0 : (t > 1 ? 1 : t); }
    var ex = ax + dx * t - px, ey = ay + dy * t - py;
    return ex * ex + ey * ey;
  }
  function segCross(p0x, p0y, p1x, p1y, a0x, a0y, a1x, a1y) {
    var d1x = p1x - p0x, d1y = p1y - p0y, d2x = a1x - a0x, d2y = a1y - a0y;
    var den = d1x * d2y - d1y * d2x;
    if (den === 0) return false;
    var sx = a0x - p0x, sy = a0y - p0y;
    var t = (sx * d2y - sy * d2x) / den, u = (sx * d1y - sy * d1x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  // Нож: удаляет все связи, чей экранный отрезок задевает путь курсора
  function cutSegment(x0, y0, x1, y1) {
    var r = CUT_R, r2 = r * r;
    var minx = Math.min(x0, x1) - r, maxx = Math.max(x0, x1) + r;
    var miny = Math.min(y0, y1) - r, maxy = Math.max(y0, y1) + r;
    for (var c = 0; c < CN; c++) {
      if (!CLIVE[c]) continue;
      var a = CA[c], b = CB[c];
      var ax = SX[a], ay = SY[a], bx = SX[b], by = SY[b];
      if ((ax < minx && bx < minx) || (ax > maxx && bx > maxx) ||
          (ay < miny && by < miny) || (ay > maxy && by > maxy)) continue;
      if (segCross(x0, y0, x1, y1, ax, ay, bx, by) ||
          ptSeg2(x0, y0, ax, ay, bx, by) < r2 || ptSeg2(x1, y1, ax, ay, bx, by) < r2 ||
          ptSeg2(ax, ay, x0, y0, x1, y1) < r2 || ptSeg2(bx, by, x0, y0, x1, y1) < r2) {
        killC(c, true);
      }
    }
  }

  function nearCloth(px, py) {
    var bd = PICK * PICK;
    for (var i = 0; i < N; i++) {
      if (DEG[i] === 0) continue;
      var dx = SX[i] - px, dy = SY[i] - py;
      if (dx * dx + dy * dy < bd) return true;
    }
    return false;
  }

  function setPointer(e) {
    ptr.x = e.clientX; ptr.y = e.clientY;
  }
  function updateCursor() {
    var cur;
    if (ui.tool === 'cut') cur = 'crosshair';
    else if (grab.active) cur = 'grabbing';
    else cur = ptr.inside && nearCloth(ptr.x, ptr.y) ? 'grab' : 'default';
    if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (ptr.down) return;
    ptr.down = true; ptr.id = e.pointerId; ptr.inside = true;
    setPointer(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    if (ui.tool === 'grab') {
      startGrab(ptr.x, ptr.y);
    } else {
      cutPrev = { x: ptr.x, y: ptr.y };
      cutSegment(ptr.x, ptr.y, ptr.x, ptr.y);
      trail.push({ x: ptr.x, y: ptr.y, t: performance.now() });
    }
    updateCursor();
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    ptr.inside = true;
    setPointer(e);
    if (ptr.down && e.pointerId === ptr.id && ui.tool === 'cut' && cutPrev) {
      cutSegment(cutPrev.x, cutPrev.y, ptr.x, ptr.y);
      trail.push({ x: ptr.x, y: ptr.y, t: performance.now() });
      cutPrev = { x: ptr.x, y: ptr.y };
    }
    if (!ptr.down) updateCursor();
  });
  function endPointer(e) {
    if (!ptr.down || (e && e.pointerId !== ptr.id)) return;
    ptr.down = false; ptr.id = null; cutPrev = null;
    releaseGrab();
    updateCursor();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', function () { ptr.inside = false; if (!ptr.down) updateCursor(); });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ================================================================
   *  Отрисовка
   * ================================================================ */
  var bgGrad = null, shCanvas = null, shCtx = null;
  var RAMP = [[44, 78, 196], [28, 176, 206], [246, 206, 64], [236, 58, 48]];
  var cr = 0, cg = 0, cb = 0;
  function rampColor(t) {
    var p = t * 3, i = p | 0;
    if (i >= 3) { i = 2; p = 3; }
    var f = p - i, a = RAMP[i], b = RAMP[i + 1];
    cr = a[0] + (b[0] - a[0]) * f;
    cg = a[1] + (b[1] - a[1]) * f;
    cb = a[2] + (b[2] - a[2]) * f;
  }

  function resize() {
    var w = window.innerWidth || 1280, h = window.innerHeight || 720;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    view.w = w; view.h = h; view.dpr = dpr;
    view.k = Math.min(w / WW, h / WH);
    view.ox = (w - WW * view.k) / 2;
    view.oy = (h - WH * view.k) / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.34, 0, w * 0.5, h * 0.34, Math.max(w, h) * 0.85);
    bgGrad.addColorStop(0, '#363d60');
    bgGrad.addColorStop(0.5, '#1b2034');
    bgGrad.addColorStop(1, '#080a12');

    shCanvas = shCanvas || document.createElement('canvas');
    shCanvas.width = Math.max(2, Math.ceil(w * SH_SCALE));
    shCanvas.height = Math.max(2, Math.ceil(h * SH_SCALE));
    shCtx = shCanvas.getContext('2d');

    // буфер полотна: на обычных экранах чуть ниже CSS-разрешения (мягкие края),
    // на плотных экранах 1:1; дальше масштаб подстраивается под скорость машины
    rsBase = view.dpr > 1.25 ? 1 : 0.85;
    rs = rs ? Math.min(rs, rsBase) : rsBase;
    allocRaster();
  }

  function project() {
    var k = view.k, ox = view.ox, oy = view.oy, cx = WW * 0.5, cy = WH * 0.5;
    for (var i = 0; i < N; i++) {
      var s = F / (F + Z[i]);
      SS[i] = s;
      SX[i] = ox + (cx + (X[i] - cx) * s) * k;
      SY[i] = oy + (cy + (Y[i] - cy) * s) * k;
    }
  }

  // Мягкая тень ткани на стене: рисуется в маленький буфер, апскейл даёт размытие
  function drawShadow() {
    var w = shCanvas.width, h = shCanvas.height, sc = SH_SCALE;
    shCtx.setTransform(1, 0, 0, 1, 0, 0);
    shCtx.clearRect(0, 0, w, h);
    // тень падает вправо-вниз; чем ближе к камере кусок ткани, тем дальше его тень.
    // Проекция тени без перспективного сжатия: иначе она уменьшается и прячется за тканью.
    var k = view.k, i;
    for (i = 0; i < N; i++) {
      if (DEG[i] === 0) continue;
      var dz = WALL_Z - Z[i];
      SHX[i] = (view.ox + (X[i] + 0.14 * dz) * k) * sc;
      SHY[i] = (view.oy + (Y[i] + 0.17 * dz) * k) * sc;
    }
    shCtx.fillStyle = '#000';
    shCtx.beginPath();
    for (var t = 0; t < nTri; t++) {
      var a = TRI[3 * t], b = TRI[3 * t + 1], c = TRI[3 * t + 2];
      // единая ориентация обхода, чтобы перекрытия не вычитались в заливке
      var s = (SHX[b] - SHX[a]) * (SHY[c] - SHY[a]) - (SHY[b] - SHY[a]) * (SHX[c] - SHX[a]);
      shCtx.moveTo(SHX[a], SHY[a]);
      if (s >= 0) { shCtx.lineTo(SHX[b], SHY[b]); shCtx.lineTo(SHX[c], SHY[c]); }
      else { shCtx.lineTo(SHX[c], SHY[c]); shCtx.lineTo(SHX[b], SHY[b]); }
      shCtx.closePath();
    }
    shCtx.fill();
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(shCanvas, 0, 0, view.w, view.h);
    ctx.restore();
  }

  // Карниз и крючки (до ткани)
  function drawRod() {
    var k = view.k, np = pinCols.length;
    var i0 = pinCols[0], i1 = pinCols[np - 1] + 1;
    var xa = SX[i0] - 38 * k, xb = SX[i1] + 38 * k, y = SY[i0] - 13 * k;
    ctx.save();
    ctx.lineCap = 'round';
    var g = ctx.createLinearGradient(0, y - 4 * k, 0, y + 4 * k);
    g.addColorStop(0, '#f1dca3'); g.addColorStop(0.5, '#b8975a'); g.addColorStop(1, '#6d5528');
    ctx.strokeStyle = g;
    ctx.lineWidth = 6 * k;
    ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke();
    ctx.fillStyle = '#d6bb7d';
    ctx.beginPath(); ctx.arc(xa - 2 * k, y, 6.5 * k, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(xb + 2 * k, y, 6.5 * k, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = '#a8894f';
    ctx.lineWidth = Math.max(1.2, 1.8 * k);
    for (var s = 0; s < np; s++) {
      var p = pinCols[s], xm = (SX[p] + SX[p + 1]) * 0.5;
      ctx.beginPath(); ctx.moveTo(xm, y); ctx.lineTo(xm, SY[p]); ctx.stroke();
    }
    ctx.restore();
  }

  // Зажимы поверх ткани
  function drawClips() {
    var k = view.k, np = pinCols.length;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#cdae63';
    ctx.strokeStyle = '#6f5a2b';
    ctx.lineWidth = Math.max(1, 1.2 * k);
    for (var s = 0; s < np; s++) {
      var p = pinCols[s];
      var x1 = SX[p] - 4.5 * k, x2 = SX[p + 1] + 4.5 * k, y1 = SY[p] - 6 * k;
      ctx.beginPath();
      ctx.rect(x1, y1, x2 - x1, 15 * k);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------- программная растеризация полотна ---------------- */
  var rCanvas = null, rCtx = null, rImg = null, rBuf = null, zBuf = null;
  var rw = 0, rh = 0, rs = 0, rsBase = 0.85, rMs = 0, rTick = 0, rWarm = 0;

  function allocRaster() {
    rw = Math.max(2, Math.ceil(view.w * rs));
    rh = Math.max(2, Math.ceil(view.h * rs));
    rCanvas = rCanvas || document.createElement('canvas');
    rCanvas.width = rw; rCanvas.height = rh;
    rCtx = rCanvas.getContext('2d');
    rImg = rCtx.createImageData(rw, rh);
    rBuf = new Uint32Array(rImg.data.buffer);
    zBuf = new Float32Array(rw * rh);
  }

  // Подбор масштаба растеризации под скорость машины (раз в ~0.75 с, с гистерезисом)
  function adaptRaster(ms) {
    rMs = rMs ? rMs * 0.9 + ms * 0.1 : ms;
    if (rWarm < 90) { rWarm++; return; }
    if (++rTick < 45) return;
    rTick = 0;
    if (rMs > 8 && rs > RS_MIN + 1e-6) { rs = Math.max(RS_MIN, rs - 0.1); rMs = 0; allocRaster(); }
    else if (rMs < 3.5 && rs < rsBase - 1e-6) { rs = Math.min(rsBase, rs + 0.05); rMs = 0; allocRaster(); }
  }

  function addNormal(a, b, c) {
    var e1x = X[b] - X[a], e1y = Y[b] - Y[a], e1z = Z[b] - Z[a];
    var e2x = X[c] - X[a], e2y = Y[c] - Y[a], e2z = Z[c] - Z[a];
    var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    NX[a] += nx; NY[a] += ny; NZ[a] += nz;
    NX[b] += nx; NY[b] += ny; NZ[b] += nz;
    NX[c] += nx; NY[c] += ny; NZ[c] += nz;
  }

  // Подготовка сетки: живые треугольники, нормали вершин (сумма площадных нормалей
  // смежных треугольников), освещение и атрибуты в вершинах
  function buildMesh(stress) {
    var i, j, q = 0, n = 0, a, b, c, d;
    NX.fill(0); NY.fill(0); NZ.fill(0);
    for (j = 0; j < rows - 1; j++) {
      for (i = 0; i < cols - 1; i++, q++) {
        if (!CLIVE[QD[q]]) continue;
        var e = q * 4;
        a = j * cols + i; b = a + 1; d = a + cols; c = d + 1;
        if (CLIVE[QE[e]] && CLIVE[QE[e + 3]]) {            // A-B-C: верх, право
          TRI[n++] = a; TRI[n++] = b; TRI[n++] = c;
          addNormal(a, b, c);
        }
        if (CLIVE[QE[e + 1]] && CLIVE[QE[e + 2]]) {        // A-C-D: низ, лево
          TRI[n++] = a; TRI[n++] = c; TRI[n++] = d;
          addNormal(a, c, d);
        }
      }
    }
    nTri = n / 3;

    var tearSpan = Math.max(0.05, ui.tear - 1);
    if (stress) {
      STR.fill(0); STC.fill(0);
      for (var cI = 0; cI < CN; cI++) {
        if (!CLIVE[cI] || !CT[cI]) continue;
        var ca = CA[cI], cb2 = CB[cI];
        var r = Math.sqrt((X[cb2] - X[ca]) * (X[cb2] - X[ca]) + (Y[cb2] - Y[ca]) * (Y[cb2] - Y[ca]) +
                          (Z[cb2] - Z[ca]) * (Z[cb2] - Z[ca])) / CR[cI];
        STR[ca] += r; STR[cb2] += r; STC[ca]++; STC[cb2]++;
      }
    }

    for (j = 0; j < rows; j++) {
      for (i = 0; i < cols; i++) {
        var p = j * cols + i;
        var nx = NX[p], ny = NY[p], nz = NZ[p];
        var nl = nx * nx + ny * ny + nz * nz;
        if (nl < 1e-12) continue;                          // вершина не входит в треугольники
        nl = Math.sqrt(nl);
        nx /= nl; ny /= nl; nz /= nl;
        var back = false;
        if (nz > 0) { nx = -nx; ny = -ny; nz = -nz; } else back = true;   // нормаль к камере
        var hf = (nx * LX + ny * LY + nz * LZ) * 0.5 + 0.5;
        var lum = 0.36 + 0.92 * hf * hf;
        var ndh = nx * HX + ny * HY + nz * HZ;
        var spec = 0;
        if (ndh > 0) { var s2 = ndh * ndh, s4 = s2 * s2; spec = s4 * s4 * 0.1; }
        var fog = clamp((Z[p] + 150) / 450, 0, 1);
        lum *= 1 - 0.18 * fog;
        if (back) { lum *= 0.78; spec *= 0.5; }

        RX[p] = SX[p] * rs; RY[p] = SY[p] * rs;
        if (stress) {
          var ratio = STC[p] > 0 ? STR[p] / STC[p] : 1;
          rampColor(Math.pow(clamp((ratio - 1) / tearSpan, 0, 1), 0.4));
          var lf = 0.55 + 0.45 * lum;
          AA1[p] = spec * 140; AA2[p] = cr * lf; AA3[p] = cg * lf; AA4[p] = cb * lf;
        } else {
          AA1[p] = lum; AA2[p] = spec * 255; AA3[p] = i * TS; AA4[p] = j * TS;
        }
      }
    }
  }

  // Растеризация треугольника: построчная заливка, атрибуты линейно по плоскости,
  // z-буфер по масштабу перспективы (он линеен в экранных координатах)
  function rasterTri(ia, ib, ic, stress) {
    var t;
    if (RY[ia] > RY[ib]) { t = ia; ia = ib; ib = t; }
    if (RY[ib] > RY[ic]) { t = ib; ib = ic; ic = t; }
    if (RY[ia] > RY[ib]) { t = ia; ia = ib; ib = t; }
    var x0 = RX[ia], y0 = RY[ia], x1 = RX[ib], y1 = RY[ib], x2 = RX[ic], y2 = RY[ic];
    var ys = Math.ceil(y0 - 0.5), ye = Math.floor(y2 - 0.5);
    if (ys < 0) ys = 0;
    if (ye > rh - 1) ye = rh - 1;
    if (ys > ye) return;
    var dy02 = y2 - y0;
    var D = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (dy02 < 1e-9 || (D > -1e-6 && D < 1e-6)) return;
    var invD = 1 / D;
    var gy0 = y1 - y2, gy1 = y2 - y0, gx0 = x2 - x1, gx1 = x0 - x2;
    var da, db;
    da = SS[ia] - SS[ic]; db = SS[ib] - SS[ic];
    var zx = (gy0 * da + gy1 * db) * invD, zy = (gx0 * da + gx1 * db) * invD, zr = SS[ic];
    da = AA1[ia] - AA1[ic]; db = AA1[ib] - AA1[ic];
    var b1x = (gy0 * da + gy1 * db) * invD, b1y = (gx0 * da + gx1 * db) * invD, b1r = AA1[ic];
    da = AA2[ia] - AA2[ic]; db = AA2[ib] - AA2[ic];
    var b2x = (gy0 * da + gy1 * db) * invD, b2y = (gx0 * da + gx1 * db) * invD, b2r = AA2[ic];
    da = AA3[ia] - AA3[ic]; db = AA3[ib] - AA3[ic];
    var b3x = (gy0 * da + gy1 * db) * invD, b3y = (gx0 * da + gx1 * db) * invD, b3r = AA3[ic];
    da = AA4[ia] - AA4[ic]; db = AA4[ib] - AA4[ic];
    var b4x = (gy0 * da + gy1 * db) * invD, b4y = (gx0 * da + gx1 * db) * invD, b4r = AA4[ic];
    var d01 = y1 - y0, d12 = y2 - y1;

    for (var y = ys; y <= ye; y++) {
      var yy = y + 0.5;
      var xl = x0 + (x2 - x0) * (yy - y0) / dy02, xr;
      if (yy < y1) xr = d01 > 1e-9 ? x0 + (x1 - x0) * (yy - y0) / d01 : x1;
      else xr = d12 > 1e-9 ? x1 + (x2 - x1) * (yy - y1) / d12 : x1;
      var xa = xl < xr ? xl : xr, xb = xl < xr ? xr : xl;
      var xs = Math.ceil(xa - 0.5), xe = Math.floor(xb - 0.5);
      if (xs < 0) xs = 0;
      if (xe > rw - 1) xe = rw - 1;
      if (xs > xe) continue;
      var px = xs + 0.5 - x2, py = yy - y2;
      var z = zr + zx * px + zy * py;
      var v1 = b1r + b1x * px + b1y * py, v2 = b2r + b2x * px + b2y * py;
      var v3 = b3r + b3x * px + b3y * py, v4 = b4r + b4x * px + b4y * py;
      var p = y * rw + xs, x, r, g, b;
      if (!stress) {
        // v1 = освещённость, v2 = блик, v3/v4 = координаты узора (u, v)
        for (x = xs; x <= xe; x++, p++) {
          if (z > zBuf[p]) {
            zBuf[p] = z;
            var ui_ = v3 | 0, vi_ = v4 | 0;
            var f = v1 * WVT[(ui_ + vi_) & 3];
            r = (texHR[ui_] + texVR[vi_]) * f + v2;
            g = (texHG[ui_] + texVG[vi_]) * f + v2;
            b = (texHB[ui_] + texVB[vi_]) * f + v2;
            rBuf[p] = 0xFF000000 | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
          }
          z += zx; v1 += b1x; v2 += b2x; v3 += b3x; v4 += b4x;
        }
      } else {
        // v1 = блик, v2/v3/v4 = цвет (уже с освещением)
        for (x = xs; x <= xe; x++, p++) {
          if (z > zBuf[p]) {
            zBuf[p] = z;
            r = v2 + v1; g = v3 + v1; b = v4 + v1;
            rBuf[p] = 0xFF000000 | ((b > 255 ? 255 : (b < 0 ? 0 : b)) << 16) |
                      ((g > 255 ? 255 : (g < 0 ? 0 : g)) << 8) | (r > 255 ? 255 : (r < 0 ? 0 : r));
          }
          z += zx; v1 += b1x; v2 += b2x; v3 += b3x; v4 += b4x;
        }
      }
    }
  }

  // Полотно целиком: растеризация в ImageData и вывод одним drawImage
  function drawCloth(stress) {
    var t0 = performance.now();
    rBuf.fill(0);
    zBuf.fill(0);
    for (var t = 0; t < nTri; t++) rasterTri(TRI[3 * t], TRI[3 * t + 1], TRI[3 * t + 2], stress);
    rCtx.putImageData(rImg, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(rCanvas, 0, 0, rw, rh, 0, 0, view.w, view.h);
    ctx.restore();
    adaptRaster(performance.now() - t0);
  }

  // Каркас: три прохода по глубине (дальше = тусклее)
  function drawWire() {
    var styles = ['rgba(86,140,200,0.62)', 'rgba(124,198,244,0.82)', 'rgba(205,240,255,0.96)'];
    ctx.save();
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    for (var pass = 0; pass < 3; pass++) {
      ctx.strokeStyle = styles[pass];
      ctx.beginPath();
      for (var c = 0; c < CN; c++) {
        if (!CLIVE[c] || !CT[c]) continue;
        var a = CA[c], b = CB[c];
        var z = (Z[a] + Z[b]) * 0.5;
        var bucket = z > 60 ? 0 : (z > -60 ? 1 : 2);
        if (bucket !== pass) continue;
        ctx.moveTo(SX[a], SY[a]); ctx.lineTo(SX[b], SY[b]);
      }
      ctx.stroke();
    }
    // узлы креплений
    ctx.fillStyle = '#f4d58a';
    for (var s = 0; s < pinCols.length; s++) {
      var p = pinCols[s];
      ctx.beginPath(); ctx.arc(SX[p], SY[p], 3, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.arc(SX[p + 1], SY[p + 1], 3, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }

  function drawOverlay(now) {
    ctx.save();
    if (grab.active) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(grab.gx, grab.gy, 15, 0, 6.2832); ctx.fill(); ctx.stroke();
    }
    // след ножа
    while (trail.length && now - trail[0].t > 320) trail.shift();
    if (trail.length > 1) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (var i = 1; i < trail.length; i++) {
        var age = (now - trail[i].t) / 320;
        ctx.strokeStyle = 'rgba(255,240,210,' + (0.9 * (1 - age)).toFixed(3) + ')';
        ctx.lineWidth = 2.2 * (1 - age * 0.6);
        ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y); ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function render(now) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, view.w, view.h);
    project();
    if (ui.view === 'wire') {
      drawRod();
      drawWire();
    } else {
      var stress = ui.view === 'stress';
      buildMesh(stress);
      drawShadow();
      drawRod();
      drawCloth(stress);
      drawClips();
    }
    drawOverlay(now);
  }

  /* ================================================================
   *  UI
   * ================================================================ */
  function bindRange(id, key, fmt, onCommit) {
    var el = document.getElementById(id), out = document.getElementById(id + '-out');
    function show() { out.textContent = fmt(+el.value); }
    el.addEventListener('input', function () { ui[key] = +el.value; show(); });
    if (onCommit) el.addEventListener('change', onCommit);
    ui[key] = +el.value; show();
  }
  function fmt1(v) { return v.toFixed(1); }

  function fullReset() {
    build();
    resize();
    trail.length = 0;
  }

  bindRange('wind', 'wind', fmt1);
  bindRange('gravity', 'gravity', fmt1);
  bindRange('tear', 'tear', function (v) { return '×' + v.toFixed(1); });
  bindRange('pins', 'pins', function (v) { return String(v | 0); }, fullReset);

  var segs = document.querySelectorAll('.seg');
  Array.prototype.forEach.call(segs, function (seg) {
    var key = seg.getAttribute('data-key');
    var btns = seg.querySelectorAll('button');
    Array.prototype.forEach.call(btns, function (btn) {
      btn.addEventListener('click', function () {
        ui[key] = btn.getAttribute('data-value');
        Array.prototype.forEach.call(btns, function (o) {
          o.setAttribute('aria-pressed', o === btn ? 'true' : 'false');
        });
        updateCursor();
      });
    });
  });

  elReset.addEventListener('click', function () { fullReset(); elReset.blur(); });
  window.addEventListener('keydown', function (e) {
    if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && !e.altKey) fullReset();
  });
  // Окно изменилось: масштаб подстраивается сам; если пропорции окна сильно другие
  // и ткань ещё цела, пересобираем её под новые пропорции
  window.addEventListener('resize', function () {
    var w = window.innerWidth || 1280, h = window.innerHeight || 720;
    if (!tornStruct && !grab.active && Math.abs(Math.log((w / h) / (WW / WH))) > 0.25) fullReset();
    else resize();
  });

  /* ================================================================
   *  Главный цикл
   * ================================================================ */
  var lastTs = 0, acc = 0, frames = 0, fpsAcc = 0, fpsFrames = 0, fps = 60, cullTick = 0;

  function updateStats() {
    var intact = totalStruct - tornStruct;
    elStats.textContent = 'Нитей цело: ' + intact + ' из ' + totalStruct +
      ' · порвано: ' + tornStruct + ' · ' + fps + ' к/с';
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    var dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 1 / 60;                 // вернулись из фоновой вкладки
    if (dt > MAX_STEPS * H) dt = MAX_STEPS * H;
    acc += dt;

    if (acc >= H) {
      computeForces(simT);
      var steps = 0;
      while (acc >= H && steps < MAX_STEPS) { step(H); acc -= H; steps++; }
      if (acc > 2 * H) acc = 2 * H;
    }

    if (++cullTick >= 20) { cullTick = 0; cull(); }
    render(ts);
    if (!ptr.down) updateCursor();

    frames++;
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) {
      fps = Math.round(fpsFrames / fpsAcc);
      fpsAcc = 0; fpsFrames = 0;
      updateStats();
    }
  }

  build();
  resize();
  updateStats();
  requestAnimationFrame(frame);

  // для headless-проверки в node (в браузере module не определён)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ui: ui,
      step: step,
      build: build,
      raster: function () { return { rs: rs, ms: rMs, w: rw, h: rh, tris: nTri }; },
      state: function () {
        return {
          X: X, Y: Y, Z: Z, SX: SX, SY: SY, CA: CA, CB: CB, CR: CR, CT: CT, CLIVE: CLIVE,
          N: N, CN: CN, cols: cols, rows: rows, L: L, WW: WW, WH: WH, view: view,
          torn: tornStruct, total: totalStruct, pinCols: pinCols, grab: grab
        };
      }
    };
  }
})();
