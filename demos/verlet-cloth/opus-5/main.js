'use strict';
/* Ткань на верлет-интегрировании — Claude Opus 5.
   Чистый Canvas 2D: 3D-сетка частиц (x, y, z) + связи-констрейнты,
   ортo-перспективная проекция и попиксельная закраска четырёхугольников
   по нормалям — фолды и складки читаются светом, а не обводкой. */
(function () {
  var cv = document.getElementById('cv');
  if (!cv) return;
  var ctx = cv.getContext('2d', { alpha: false });
  if (!ctx) return;
  var byId = function (id) { return document.getElementById(id); };

  /* ================= параметры ================= */
  var P = { grav: 1500, wind: 520, iters: 5, tear: 2.1, dens: 36, pins: 5 };
  var paused = false, pinsOn = true;
  var mode = 2; // 0 — ткань, 1 — сетка, 2 — ткань + сетка
  var MODE_NAMES = ['Вид: ткань', 'Вид: сетка', 'Вид: ткань + сетка'];

  var W = 1, H = 1, DPR = 1, CX = 0.5, CY = 0.5;
  var FOCAL = 1000;          // «фокусное» для лёгкой перспективы, CSS-px
  var ZLIM = FOCAL * 0.62;   // потолок вылета по z
  var DRAG = 0.9965;         // сопротивление среды (за шаг)
  var FIXED = 1 / 120;       // фиксированный шаг физики
  var MAXSTEPS = 4;
  var BEND_K = 0.14;         // жёсткость на изгиб (слабая)
  var EXPAND = 0.6;          // раздувание квада, чтобы не было щелей между заливками

  /* ================= состояние сетки ================= */
  var cols = 0, rows = 0, N = 0, spacing = 20, originX = 0, originY = 0;
  var px, py, pz, ox, oy, oz;          // позиции и «предыдущие» позиции (верлет)
  var pin, ph;                          // закрепление, фазовый сдвиг для турбулентности
  var vnx, vny, vnz;                    // нормали в вершинах (для света и ветра)
  var snx, sny, snz;                    // буфер сглаживания нормалей
  var sxA, syA;                         // экранные координаты после проекции
  var cA, cB, alive;                    // структурные связи
  var nH = 0, nV = 0, nStruct = 0, aliveCount = 0;
  var bA, bB, bS1, bS2, nBend = 0;      // связи на изгиб + их «опорные» структурные
  var qz, qOrder = [];                  // глубина квадов и порядок отрисовки
  var simTime = 0, settle = 0;          // settle — мягкий старт (гравитация вводится плавно)

  /* захват мышью */
  var gIdx = null, gN = 0;              // «горсть» ткани, зажатая курсором
  var gPrim = -1, gPX = 0, gPY = 0, gPIK = 1;
  var ptrDown = false, ptrCut = false, hasPtr = false;
  var mx = 0, my = 0, pmx = 0, pmy = 0;
  var CUT_R = 13;

  // радиус «горсти»: 1.8 ячейки, но в разумных экранных пределах
  function grabRadius() {
    var r = spacing * 1.8;
    return r < 24 ? 24 : (r > 52 ? 52 : r);
  }

  /* ветер (для индикатора) */
  var wdx = 0, wdy = 0, wdz = 1, wmag = 0;

  /* ================= палитра и шкала освещённости =================
     Цвет квада берётся из ОДНОМЕРНОЙ шкалы «базовый тон × освещённость»,
     выше единицы — плавный уход в пересвет. Шаг шкалы ≈ 1 единица RGB,
     поэтому соседние квады не щёлкают ступенями и мозаика не возникает.
     Никакого «переплетения» из чередующихся тонов: клетчатый узор на
     почти плоском полотне читается ровно как шум, а не как ткань. */
  var SHADE_MAX = 2.1, SHADE_N = 512;
  var SHADE_K = (SHADE_N - 1) / SHADE_MAX;
  var FABRIC = [92, 134, 208];    // лицо
  var LINING = [70, 78, 128];     // изнанка
  var HILIGHT = [240, 247, 255];  // куда уходит пересвет
  function buildShades(base) {
    var arr = new Array(SHADE_N);
    for (var i = 0; i < SHADE_N; i++) {
      var s = i / (SHADE_N - 1) * SHADE_MAX, r, g, b;
      if (s <= 1) { r = base[0] * s; g = base[1] * s; b = base[2] * s; }
      else {
        var k = (s - 1) / (SHADE_MAX - 1);
        r = base[0] + (HILIGHT[0] - base[0]) * k;
        g = base[1] + (HILIGHT[1] - base[1]) * k;
        b = base[2] + (HILIGHT[2] - base[2]) * k;
      }
      arr[i] = 'rgb(' + (r + 0.5 | 0) + ',' + (g + 0.5 | 0) + ',' + (b + 0.5 | 0) + ')';
    }
    return arr;
  }
  var SHADE_FRONT = buildShades(FABRIC), SHADE_BACK = buildShades(LINING);

  /* свет */
  var LX = -0.44, LY = -0.60, LZ = 0.67;
  (function () { var l = Math.sqrt(LX * LX + LY * LY + LZ * LZ); LX /= l; LY /= l; LZ /= l; })();
  var HX = LX, HY = LY, HZ = LZ + 1;
  (function () { var l = Math.sqrt(HX * HX + HY * HY + HZ * HZ); HX /= l; HY /= l; HZ /= l; })();

  /* цвета линий сетки: от спокойных к «раскалённым» */
  var MESH_SOFT = ['rgba(198,220,255,0.10)', 'rgba(206,228,255,0.17)', 'rgba(255,214,150,0.30)', 'rgba(255,168,96,0.52)', 'rgba(255,108,72,0.80)'];
  var MESH_HARD = ['rgba(150,196,255,0.34)', 'rgba(178,216,255,0.52)', 'rgba(255,214,150,0.66)', 'rgba(255,168,96,0.82)', 'rgba(255,108,72,0.95)'];
  var MESH_W = [1, 1, 1.1, 1.3, 1.6];
  var segs = [[], [], [], [], []];

  var bgGrad = null, vigGrad = null;

  /* ================= построение ================= */
  function layout() {
    var availW = W * 0.80;
    var availH = H * 0.60;
    spacing = Math.min(availW / (cols - 1), availH / (rows - 1));
    if (!(spacing > 1)) spacing = 1;
    originX = W * 0.5 - spacing * (cols - 1) * 0.5;
    originY = Math.max(H * 0.13, 62);
  }

  function build() {
    cols = Math.max(6, P.dens | 0);
    rows = Math.max(5, Math.round(cols * 0.70));
    N = cols * rows;
    layout();

    px = new Float32Array(N); py = new Float32Array(N); pz = new Float32Array(N);
    ox = new Float32Array(N); oy = new Float32Array(N); oz = new Float32Array(N);
    pin = new Uint8Array(N); ph = new Float32Array(N);
    vnx = new Float32Array(N); vny = new Float32Array(N); vnz = new Float32Array(N);
    snx = new Float32Array(N); sny = new Float32Array(N); snz = new Float32Array(N);
    sxA = new Float32Array(N); syA = new Float32Array(N);
    gIdx = new Int32Array(N);
    gN = 0; gPrim = -1;

    for (var j = 0; j < rows; j++) {
      for (var i = 0; i < cols; i++) {
        var k = j * cols + i;
        var x = originX + i * spacing;
        var y = originY + j * spacing;
        var z = Math.sin(i * 0.55) * 1.6 + Math.cos(j * 0.42) * 1.2;
        px[k] = ox[k] = x; py[k] = oy[k] = y; pz[k] = oz[k] = z;
        vnz[k] = 1;
        // фаза турбулентности связная по пространству: порыв идёт волной по
        // полотну. Случайная фаза на узел дёргала бы соседей вразнобой — это
        // давало рябь в нормалях и, как следствие, крап в затенении.
        ph[k] = i * 0.42 + j * 0.31;
      }
    }

    nH = (cols - 1) * rows;
    nV = cols * (rows - 1);
    nStruct = nH + nV;
    cA = new Int32Array(nStruct); cB = new Int32Array(nStruct);
    alive = new Uint8Array(nStruct); alive.fill(1);
    aliveCount = nStruct;
    for (j = 0; j < rows; j++) {
      for (i = 0; i < cols - 1; i++) { var kh = j * (cols - 1) + i; cA[kh] = j * cols + i; cB[kh] = j * cols + i + 1; }
    }
    for (j = 0; j < rows - 1; j++) {
      for (i = 0; i < cols; i++) { var kv = nH + j * cols + i; cA[kv] = j * cols + i; cB[kv] = (j + 1) * cols + i; }
    }

    nBend = (cols - 2) * rows + cols * (rows - 2);
    if (nBend < 0) nBend = 0;
    bA = new Int32Array(nBend); bB = new Int32Array(nBend); bS1 = new Int32Array(nBend); bS2 = new Int32Array(nBend);
    var t = 0;
    for (j = 0; j < rows; j++) {
      for (i = 0; i < cols - 2; i++) {
        bA[t] = j * cols + i; bB[t] = j * cols + i + 2;
        bS1[t] = j * (cols - 1) + i; bS2[t] = j * (cols - 1) + i + 1; t++;
      }
    }
    for (j = 0; j < rows - 2; j++) {
      for (i = 0; i < cols; i++) {
        bA[t] = j * cols + i; bB[t] = (j + 2) * cols + i;
        bS1[t] = nH + j * cols + i; bS2[t] = nH + (j + 1) * cols + i; t++;
      }
    }
    nBend = t;

    qz = new Float32Array((cols - 1) * (rows - 1));
    qOrder.length = 0;
    settle = 0;
    pinsOn = true;
    applyPins();
  }

  function applyPins() {
    if (!pin) return;
    pin.fill(0);
    if (pinsOn) {
      var n = Math.max(2, Math.min(P.pins | 0, cols));
      for (var k = 0; k < n; k++) {
        // крепление — прищепка на два узла: одиночный узел собирал бы на себе
        // всё натяжение и отрывался бы от карниза при первой же тяге
        var i = Math.round(k * (cols - 1) / (n - 1));
        pin[i] = 1;
        pin[i < cols - 1 ? i + 1 : i - 1] = 1;
      }
    }
    for (var q = 0; q < gN; q++) pin[gIdx[q]] = 1;  // горсть, зажатая курсором
  }

  /* ================= физика ================= */
  function step(dt) {
    var dt2 = dt * dt;
    // мягкий старт: плоская ткань не «падает рывком» и не рвёт себя на первом кадре
    if (settle < 1) { settle += dt / 0.6; if (settle > 1) settle = 1; }
    var ease = settle * settle * (3 - 2 * settle);
    var g = P.grav * ease;

    var wa = 0.62 * Math.sin(simTime * 0.31) + 0.30 * Math.sin(simTime * 0.73 + 1.3);
    var ax0 = Math.sin(wa) * 1.45, ay0 = 0.12 * Math.sin(simTime * 0.9), az0 = Math.cos(wa);
    var wl = Math.sqrt(ax0 * ax0 + ay0 * ay0 + az0 * az0);
    wdx = ax0 / wl; wdy = ay0 / wl; wdz = az0 / wl;
    var gust = 0.58 + 0.42 * Math.sin(simTime * 0.8) + 0.16 * Math.sin(simTime * 1.93 + 2.1);
    if (gust < 0.08) gust = 0.08;
    wmag = P.wind * gust * ease;

    var maxDisp = spacing * 0.9;
    for (var p = 0; p < N; p++) {
      if (pin[p]) continue;
      var facing = vnx[p] * wdx + vny[p] * wdy + vnz[p] * wdz;
      if (facing < 0) facing = -facing;
      var puff = wmag * (0.30 + 0.70 * facing) * (0.78 + 0.22 * Math.sin(simTime * 2.4 + ph[p]));
      var ax = wdx * puff, ay = g + wdy * puff, az = wdz * puff;

      var vx = (px[p] - ox[p]) * DRAG, vy = (py[p] - oy[p]) * DRAG, vz = (pz[p] - oz[p]) * DRAG;
      if (vx > maxDisp) vx = maxDisp; else if (vx < -maxDisp) vx = -maxDisp;
      if (vy > maxDisp) vy = maxDisp; else if (vy < -maxDisp) vy = -maxDisp;
      if (vz > maxDisp) vz = maxDisp; else if (vz < -maxDisp) vz = -maxDisp;

      ox[p] = px[p]; oy[p] = py[p]; oz[p] = pz[p];
      px[p] += vx + ax * dt2;
      py[p] += vy + ay * dt2;
      var nz = pz[p] + vz + az * dt2;
      if (nz > ZLIM) nz = ZLIM; else if (nz < -ZLIM) nz = -ZLIM;
      pz[p] = nz;
    }

    // горсть ведёт ткань как временное крепление: солвер видит её и разносит
    // натяжение по полотну — рвётся то, что реально не дотягивается
    grabHandle();

    // чем длиннее висящая колонка, тем больше проходов нужно Гауссу-Зейделю,
    // иначе плотная сетка «резинит» под своим весом
    var it = P.iters | 0;
    var itEff = Math.round(it * rows / 24);
    if (itEff < it) itEff = it; else if (itEff > 20) itEff = 20;
    // чередуем направление обхода — сходится симметричнее
    for (var q = 0; q < itEff; q++) solveStruct(spacing, (q & 1) === 1);
    solveBend(spacing * 2);
    var tl = spacing * P.tear;
    tearPass(tl * tl);
  }

  // разрыв считаем ПОСЛЕ релаксации: длина связи здесь — честная мера натяжения,
  // а не разовый выброс от интегрирования
  function tearPass(lim2) {
    for (var k = 0; k < nStruct; k++) {
      if (!alive[k]) continue;
      var a = cA[k], b = cB[k];
      var dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
      if (dx * dx + dy * dy + dz * dz > lim2) { alive[k] = 0; aliveCount--; }
    }
  }

  function solveStruct(rest, rev) {
    for (var n = 0; n < nStruct; n++) {
      var k = rev ? nStruct - 1 - n : n;
      if (!alive[k]) continue;
      var a = cA[k], b = cB[k];
      var dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1e-10) continue;
      var d = Math.sqrt(d2);
      var f = (d - rest) / d * 0.5;
      var mxx = dx * f, myy = dy * f, mzz = dz * f;
      var pa = pin[a], pb = pin[b];
      if (pa) {
        if (pb) continue;
        px[b] -= mxx * 2; py[b] -= myy * 2; pz[b] -= mzz * 2;
      } else if (pb) {
        px[a] += mxx * 2; py[a] += myy * 2; pz[a] += mzz * 2;
      } else {
        px[a] += mxx; py[a] += myy; pz[a] += mzz;
        px[b] -= mxx; py[b] -= myy; pz[b] -= mzz;
      }
    }
  }

  function solveBend(rest) {
    for (var k = 0; k < nBend; k++) {
      if (!alive[bS1[k]] || !alive[bS2[k]]) continue;
      var a = bA[k], b = bB[k];
      var dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1e-10) continue;
      var d = Math.sqrt(d2);
      var f = (d - rest) / d * 0.5 * BEND_K;
      var mxx = dx * f, myy = dy * f, mzz = dz * f;
      var pa = pin[a], pb = pin[b];
      if (pa) {
        if (pb) continue;
        px[b] -= mxx * 2; py[b] -= myy * 2; pz[b] -= mzz * 2;
      } else if (pb) {
        px[a] += mxx * 2; py[a] += myy * 2; pz[a] += mzz * 2;
      } else {
        px[a] += mxx; py[a] += myy; pz[a] += mzz;
        px[b] -= mxx; py[b] -= myy; pz[b] -= mzz;
      }
    }
  }

  // «горсть»: зажатые узлы едут за курсором как одно целое, с ограничением
  // скорости. Нагрузка размазана по краю горсти, а не висит на одном узле —
  // поэтому обычная тяга ткань не дырявит, а рывок за пределы досягаемости рвёт.
  function grabHandle() {
    if (gPrim < 0 || !pin || !gN) return;
    var lim = spacing * 1.1;
    // масштаб проекции заморожен на момент захвата: иначе колыхание по z
    // само по себе таскало бы цель
    var dx = CX + (mx - CX) * gPIK + gPX - px[gPrim];
    var dy = CY + (my - CY) * gPIK + gPY - py[gPrim];
    if (dx > lim) dx = lim; else if (dx < -lim) dx = -lim;
    if (dy > lim) dy = lim; else if (dy < -lim) dy = -lim;
    for (var q = 0; q < gN; q++) {
      var p = gIdx[q];
      px[p] += dx; py[p] += dy;
      // держим осмысленную скорость: при отпускании ткань улетает, а не замирает
      ox[p] = px[p] - dx * 0.55; oy[p] = py[p] - dy * 0.55; oz[p] = pz[p];
    }
  }

  /* ================= отрисовка ================= */
  function makeBackground() {
    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0e1524');
    bgGrad.addColorStop(0.55, '#0a0e19');
    bgGrad.addColorStop(1, '#05070d');
    var r = Math.max(W, H) * 0.8;
    vigGrad = ctx.createRadialGradient(W * 0.5, H * 0.36, r * 0.12, W * 0.5, H * 0.42, r);
    vigGrad.addColorStop(0, 'rgba(70,120,190,0.16)');
    vigGrad.addColorStop(0.45, 'rgba(30,50,90,0.05)');
    vigGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
  }

  var EX = 0, EY = 0;
  function expand(x, y, cx, cy) {
    var dx = x - cx, dy = y - cy, l = Math.sqrt(dx * dx + dy * dy);
    if (l < 0.0001) { EX = x; EY = y; return; }
    var f = (l + EXPAND) / l;
    EX = cx + dx * f; EY = cy + dy * f;
  }

  // Сглаживание поля нормалей по связным соседям (через разрыв не мажем).
  // На почти плоском полотне нормали шумят вокруг одного направления —
  // без этого шаг заливки между соседними квадами читается как крап.
  function smoothNormals(passes) {
    var cw1 = cols - 1;
    for (var it = 0; it < passes; it++) {
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          var p = j * cols + i, q;
          var ax = vnx[p] * 1.6, ay = vny[p] * 1.6, az = vnz[p] * 1.6;
          if (i > 0 && alive[j * cw1 + i - 1]) { q = p - 1; ax += vnx[q]; ay += vny[q]; az += vnz[q]; }
          if (i < cw1 && alive[j * cw1 + i]) { q = p + 1; ax += vnx[q]; ay += vny[q]; az += vnz[q]; }
          if (j > 0 && alive[nH + (j - 1) * cols + i]) { q = p - cols; ax += vnx[q]; ay += vny[q]; az += vnz[q]; }
          if (j < rows - 1 && alive[nH + j * cols + i]) { q = p + cols; ax += vnx[q]; ay += vny[q]; az += vnz[q]; }
          var l = Math.sqrt(ax * ax + ay * ay + az * az);
          if (l < 1e-6) { snx[p] = 0; sny[p] = 0; snz[p] = 1; }
          else { snx[p] = ax / l; sny[p] = ay / l; snz[p] = az / l; }
        }
      }
      var t = vnx; vnx = snx; snx = t;
      t = vny; vny = sny; sny = t;
      t = vnz; vnz = snz; snz = t;
    }
  }

  function render() {
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = vigGrad; ctx.fillRect(0, 0, W, H);
    if (!N) return;

    /* проекция */
    var p, i, j;
    for (p = 0; p < N; p++) {
      var k = FOCAL / (FOCAL - pz[p]);
      sxA[p] = CX + (px[p] - CX) * k;
      syA[p] = CY + (py[p] - CY) * k;
    }

    /* нормали в вершинах */
    vnx.fill(0); vny.fill(0); vnz.fill(0);
    var cw = cols - 1, rw = rows - 1;
    for (j = 0; j < rw; j++) {
      for (i = 0; i < cw; i++) {
        var a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
        if (!alive[j * cw + i] || !alive[(j + 1) * cw + i] || !alive[nH + j * cols + i] || !alive[nH + j * cols + i + 1]) continue;
        var ux = px[d] - px[a], uy = py[d] - py[a], uz = pz[d] - pz[a];
        var vx = px[c] - px[b], vy = py[c] - py[b], vz = pz[c] - pz[b];
        var fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        var fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
        if (fl < 1e-8) continue;
        fx /= fl; fy /= fl; fz /= fl;
        vnx[a] += fx; vny[a] += fy; vnz[a] += fz;
        vnx[b] += fx; vny[b] += fy; vnz[b] += fz;
        vnx[c] += fx; vny[c] += fy; vnz[c] += fz;
        vnx[d] += fx; vny[d] += fy; vnz[d] += fz;
      }
    }
    for (p = 0; p < N; p++) {
      var nl = Math.sqrt(vnx[p] * vnx[p] + vny[p] * vny[p] + vnz[p] * vnz[p]);
      if (nl < 1e-6) { vnx[p] = 0; vny[p] = 0; vnz[p] = 1; }
      else { vnx[p] /= nl; vny[p] /= nl; vnz[p] /= nl; }
    }
    smoothNormals(3);

    /* ---- заливка ткани ---- */
    if (mode !== 1) {
      qOrder.length = 0;
      for (j = 0; j < rw; j++) {
        for (i = 0; i < cw; i++) {
          if (!alive[j * cw + i] || !alive[(j + 1) * cw + i] || !alive[nH + j * cols + i] || !alive[nH + j * cols + i + 1]) continue;
          var q = j * cw + i, a0 = j * cols + i;
          qz[q] = (pz[a0] + pz[a0 + 1] + pz[a0 + cols] + pz[a0 + cols + 1]) * 0.25;
          qOrder.push(q);
        }
      }
      qOrder.sort(function (u, v) { return qz[u] - qz[v]; });

      var bandDiv = rw > 0 ? rw : 1;
      for (var t = 0, tn = qOrder.length; t < tn; t++) {
        var qq = qOrder[t];
        i = qq % cw; j = (qq / cw) | 0;
        var A = j * cols + i, B = A + 1, C = A + cols, D = C + 1;

        var nx = vnx[A] + vnx[B] + vnx[C] + vnx[D];
        var ny = vny[A] + vny[B] + vny[C] + vny[D];
        var nz = vnz[A] + vnz[B] + vnz[C] + vnz[D];
        var ln = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (ln < 1e-6) { nx = 0; ny = 0; nz = 1; } else { nx /= ln; ny /= ln; nz /= ln; }

        var back = nz < 0;
        if (back) { nx = -nx; ny = -ny; nz = -nz; }

        // полуламберт: свет затухает плавно, без резкой границы терминатора,
        // из-за которой соседние квады на изгибе прыгали через ступень
        var dif = (nx * LX + ny * LY + nz * LZ) * 0.5 + 0.5;
        if (dif < 0) dif = 0;
        dif *= dif;
        var rim = 1 - nz; rim = rim * rim * rim * 0.12;
        var zq = qz[qq] / 240; if (zq > 1) zq = 1; else if (zq < -1) zq = -1;
        // мягкий вертикальный градиент: сверху светлее, к подолу глубже
        var shade = (0.30 + 0.78 * dif + rim) * (1.04 - 0.12 * (j / bandDiv)) * (0.97 + 0.06 * zq);
        if (back) shade *= 0.80;

        // широкий мягкий блик (степень 10 вместо 26): на полотне это пятно
        // света с плавным краем, а не точечная вспышка, скачущая по квадам
        var ndh = nx * HX + ny * HY + nz * HZ;
        if (ndh > 0) {
          var h2 = ndh * ndh, h4 = h2 * h2;
          shade += h4 * h4 * h2 * (back ? 0.06 : 0.28);
        }

        var si = shade * SHADE_K | 0;
        if (si < 0) si = 0; else if (si >= SHADE_N) si = SHADE_N - 1;

        var x0 = sxA[A], y0 = syA[A], x1 = sxA[B], y1 = syA[B], x2 = sxA[D], y2 = syA[D], x3 = sxA[C], y3 = syA[C];
        var mcx = (x0 + x1 + x2 + x3) * 0.25, mcy = (y0 + y1 + y2 + y3) * 0.25;
        ctx.beginPath();
        expand(x0, y0, mcx, mcy); ctx.moveTo(EX, EY);
        expand(x1, y1, mcx, mcy); ctx.lineTo(EX, EY);
        expand(x2, y2, mcx, mcy); ctx.lineTo(EX, EY);
        expand(x3, y3, mcx, mcy); ctx.lineTo(EX, EY);
        ctx.closePath();
        ctx.fillStyle = (back ? SHADE_BACK : SHADE_FRONT)[si];
        ctx.fill();
      }
    }

    /* ---- линии сетки ---- */
    if (mode !== 0) {
      var pal = mode === 1 ? MESH_HARD : MESH_SOFT;
      var s0 = segs[0], s1 = segs[1], s2 = segs[2], s3 = segs[3], s4 = segs[4];
      s0.length = 0; s1.length = 0; s2.length = 0; s3.length = 0; s4.length = 0;
      var span = P.tear - 1; if (span < 0.05) span = 0.05;
      for (var m = 0; m < nStruct; m++) {
        if (!alive[m]) continue;
        var aa = cA[m], bb = cB[m];
        var ddx = px[bb] - px[aa], ddy = py[bb] - py[aa], ddz = pz[bb] - pz[aa];
        var dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        var r = (dd / spacing - 1) / span;
        var bi = (r * 5) | 0;
        if (bi < 0) bi = 0; else if (bi > 4) bi = 4;
        var arr = segs[bi];
        arr.push(sxA[aa], syA[aa], sxA[bb], syA[bb]);
      }
      ctx.lineCap = 'round';
      for (var g = 0; g < 5; g++) {
        var ar = segs[g];
        if (!ar.length) continue;
        ctx.beginPath();
        for (var u = 0; u < ar.length; u += 4) { ctx.moveTo(ar[u], ar[u + 1]); ctx.lineTo(ar[u + 2], ar[u + 3]); }
        ctx.strokeStyle = pal[g];
        ctx.lineWidth = MESH_W[g];
        ctx.stroke();
      }
    }

    /* ---- крепления: прищепка на паре узлов ---- */
    if (pinsOn) {
      var pn = Math.max(2, Math.min(P.pins | 0, cols));
      ctx.lineCap = 'round';
      for (var pk = 0; pk < pn; pk++) {
        var i0 = Math.round(pk * (cols - 1) / (pn - 1));
        var i1 = i0 < cols - 1 ? i0 + 1 : i0 - 1;
        var ax1 = sxA[i0], ay1 = syA[i0], ax2 = sxA[i1], ay2 = syA[i1];
        ctx.beginPath(); ctx.moveTo(ax1, ay1); ctx.lineTo(ax2, ay2);
        ctx.lineWidth = 11; ctx.strokeStyle = 'rgba(140,190,255,0.15)'; ctx.stroke();
        ctx.lineWidth = 5.2; ctx.strokeStyle = 'rgba(232,242,255,0.92)'; ctx.stroke();
        ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(96,150,225,0.85)'; ctx.stroke();
      }
    }

    /* ---- курсор ---- */
    if (hasPtr) {
      ctx.beginPath(); ctx.arc(mx, my, ptrCut ? CUT_R : grabRadius(), 0, 6.2831853);
      ctx.strokeStyle = ptrCut ? 'rgba(255,120,90,0.75)' : (ptrDown ? 'rgba(190,225,255,0.55)' : 'rgba(190,225,255,0.22)');
      ctx.lineWidth = ptrCut ? 1.6 : 1.2;
      ctx.stroke();
      ctx.beginPath(); ctx.arc(mx, my, 1.8, 0, 6.2831853);
      ctx.fillStyle = ptrCut ? 'rgba(255,140,110,0.9)' : 'rgba(220,236,255,0.7)';
      ctx.fill();
    }

    drawWindDial();
  }

  function drawWindDial() {
    var r = 26, cx = W - r - 24, cy = r + 24;
    if (cx < 60) return;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2831853);
    ctx.fillStyle = 'rgba(12,18,30,0.5)'; ctx.fill();
    ctx.strokeStyle = 'rgba(150,185,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    var amp = P.wind > 0 ? Math.min(1, wmag / 1400) : 0;
    var len = 6 + amp * (r - 9);
    var ax = wdx, az = wdz, al = Math.sqrt(ax * ax + az * az) || 1;
    ax /= al; az /= al;
    var tipx = cx + ax * len, tipy = cy + az * len;
    ctx.beginPath(); ctx.moveTo(cx - ax * len * 0.5, cy - az * len * 0.5); ctx.lineTo(tipx, tipy);
    ctx.strokeStyle = 'rgba(126,200,255,' + (0.35 + 0.55 * amp).toFixed(2) + ')';
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tipx, tipy);
    ctx.lineTo(tipx - ax * 7 + az * 4.5, tipy - az * 7 - ax * 4.5);
    ctx.lineTo(tipx - ax * 7 - az * 4.5, tipy - az * 7 + ax * 4.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(140,210,255,' + (0.4 + 0.55 * amp).toFixed(2) + ')';
    ctx.fill();
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(180,205,240,0.6)';
    ctx.fillText('ВЕТЕР', cx, cy + r + 12);
    ctx.textAlign = 'left';
  }

  /* ================= ввод ================= */
  function pointerPos(e) {
    var r = cv.getBoundingClientRect();
    mx = e.clientX - r.left;
    my = e.clientY - r.top;
  }

  function startGrab() {
    gN = 0; gPrim = -1;
    if (!N) return;
    var r = grabRadius();
    var best = -1, bestD = 1e9, p;
    for (p = 0; p < N; p++) {
      if (pin[p]) continue;
      var dx = sxA[p] - mx, dy = syA[p] - my;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best < 0 || bestD > r * r * 2.6) return;   // мимо ткани
    gPrim = best;
    gPIK = (FOCAL - pz[best]) / FOCAL;
    gPX = px[best] - (CX + (mx - CX) * gPIK);
    gPY = py[best] - (CY + (my - CY) * gPIK);
    // горсть набираем в мировых координатах вокруг ближайшего узла
    var bx = px[best], by = py[best], bz = pz[best], r2 = r * r;
    for (p = 0; p < N; p++) {
      if (pin[p]) continue;
      var wx = px[p] - bx, wy = py[p] - by, wz = pz[p] - bz;
      if (wx * wx + wy * wy + wz * wz <= r2) { gIdx[gN++] = p; pin[p] = 1; }
    }
  }

  function distSeg(x, y, x1, y1, x2, y2) {
    var vx = x2 - x1, vy = y2 - y1;
    var l2 = vx * vx + vy * vy;
    var t = l2 > 1e-9 ? ((x - x1) * vx + (y - y1) * vy) / l2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var dx = x - (x1 + vx * t), dy = y - (y1 + vy * t);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function cutAt() {
    if (!N) return;
    for (var k = 0; k < nStruct; k++) {
      if (!alive[k]) continue;
      var a = cA[k], b = cB[k];
      var mxx = (sxA[a] + sxA[b]) * 0.5, myy = (syA[a] + syA[b]) * 0.5;
      if (distSeg(mxx, myy, pmx, pmy, mx, my) < CUT_R) { alive[k] = 0; aliveCount--; }
    }
  }

  cv.addEventListener('pointerdown', function (e) {
    pointerPos(e); pmx = mx; pmy = my;
    hasPtr = true; ptrDown = true;
    ptrCut = (e.button === 2) || e.shiftKey;
    if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
    if (ptrCut) cutAt(); else startGrab();
    e.preventDefault();
  });

  cv.addEventListener('pointermove', function (e) {
    pmx = mx; pmy = my;
    pointerPos(e);
    hasPtr = true;
    if (ptrDown && ptrCut) cutAt();
  });

  function endPointer() {
    ptrDown = false; ptrCut = false;
    if (gPrim >= 0 || gN) { gN = 0; gPrim = -1; applyPins(); }
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('pointerleave', function () { hasPtr = false; endPointer(); });
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  window.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|BUTTON|SELECT|TEXTAREA/.test(e.target.tagName || '')) return;
    var k = e.key;
    if (k === 'r' || k === 'R' || k === 'к' || k === 'К') { build(); e.preventDefault(); }
    else if (k === ' ') { paused = !paused; syncPause(); e.preventDefault(); }
    else if (k === 'g' || k === 'G' || k === 'п' || k === 'П') { cycleMode(); e.preventDefault(); }
  });

  /* ================= UI ================= */
  var elStats = byId('stats');
  function bindRange(id, out, key, fmt, onChange) {
    var el = byId(id), lab = byId(out);
    if (!el) return;
    var apply = function () {
      P[key] = parseFloat(el.value);
      if (lab) lab.textContent = fmt(P[key]);
      if (onChange) onChange();
    };
    el.addEventListener('input', apply);
    apply();
  }
  bindRange('grav', 'vGrav', 'grav', function (v) { return String(v | 0); });
  bindRange('wind', 'vWind', 'wind', function (v) { return String(v | 0); });
  bindRange('iter', 'vIter', 'iters', function (v) { return String(v | 0); });
  bindRange('tear', 'vTear', 'tear', function (v) { return v.toFixed(2) + '×'; });
  bindRange('pins', 'vPins', 'pins', function (v) { return String(v | 0); }, function () { pinsOn = true; applyPins(); });

  var densLabel = byId('vDens'), densEl = byId('dens');
  if (densEl) {
    densEl.addEventListener('input', function () {
      P.dens = parseFloat(densEl.value) | 0;
      build();
      if (densLabel) densLabel.textContent = cols + '×' + rows;
    });
  }

  var bPause = byId('bPause');
  function syncPause() { if (bPause) bPause.textContent = paused ? 'Продолжить' : 'Пауза'; }
  if (bPause) bPause.addEventListener('click', function () { paused = !paused; syncPause(); bPause.blur(); });

  var bReset = byId('bReset');
  if (bReset) bReset.addEventListener('click', function () { build(); bReset.blur(); });

  var bDrop = byId('bDrop');
  if (bDrop) bDrop.addEventListener('click', function () { pinsOn = false; applyPins(); bDrop.blur(); });

  var bMode = byId('bMode');
  function cycleMode() { mode = (mode + 1) % 3; if (bMode) bMode.textContent = MODE_NAMES[mode]; }
  if (bMode) { bMode.textContent = MODE_NAMES[mode]; bMode.addEventListener('click', function () { cycleMode(); bMode.blur(); }); }

  /* ================= resize ================= */
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    H = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    CX = W * 0.5; CY = H * 0.5;
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.lineJoin = 'round';
    makeBackground();

    if (!px) { build(); if (densLabel) densLabel.textContent = cols + '×' + rows; return; }
    var oldSp = spacing, oldX = originX, oldY = originY;
    layout();
    var s = spacing / oldSp;
    if (!isFinite(s) || s <= 0) s = 1;
    for (var p = 0; p < N; p++) {
      px[p] = originX + (px[p] - oldX) * s; py[p] = originY + (py[p] - oldY) * s; pz[p] *= s;
      ox[p] = originX + (ox[p] - oldX) * s; oy[p] = originY + (oy[p] - oldY) * s; oz[p] *= s;
    }
    gPX *= s; gPY *= s;   // смещение захвата живёт в тех же координатах
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  /* ================= цикл ================= */
  var last = 0, acc = 0, frames = 0, fpsT = 0, fps = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!last) last = ts;
    var dt = (ts - last) / 1000;
    last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;           // кламп большого dt (свёрнутая вкладка)

    if (!paused) {
      acc += dt;
      var steps = 0;
      while (acc >= FIXED && steps < MAXSTEPS) { simTime += FIXED; step(FIXED); acc -= FIXED; steps++; }
      if (acc > FIXED * MAXSTEPS) acc = 0;
    } else {
      acc = 0;
    }

    render();

    frames++;
    fpsT += dt;
    if (fpsT >= 0.5) {
      fps = Math.round(frames / fpsT);
      frames = 0; fpsT = 0;
      if (elStats) elStats.textContent = 'частиц ' + N + ' · связей ' + aliveCount + '/' + nStruct + ' · ' + fps + ' fps';
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { last = 0; acc = 0; }
  });

  resize();
  syncPause();
  requestAnimationFrame(frame);
})();
