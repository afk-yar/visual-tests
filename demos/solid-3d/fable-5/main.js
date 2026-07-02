/* «3D-тело (софт-рендер)» — Claude Fable 5
 *
 * Программный конвейер без WebGL и библиотек:
 *   модель (тор) → матрицы поворота (Ry·Rx) → камера → перспективная проекция
 *   → отсечение нелицевых граней (знак площади на экране) → растеризация
 *   треугольников по полуплоскостям с z-буфером (1/z) → точечный источник света
 *   (Ламберт + Блинн-Фонг, мягкое затухание) + ambient и слабый fill-свет от
 *   камеры, плоское или гладкое (Гуро) затенение. Растр считается на CPU в ImageData.
 */
(function () {
  'use strict';

  // ---------- DOM ----------
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var statsEl = document.getElementById('stats');
  var groupShadeEl = document.getElementById('groupShade');

  // ---------- Константы ----------
  var DPR_CAP = 2;                    // потолок devicePixelRatio
  var MAX_PIXELS = 2200000;           // потолок буфера софт-растеризации (CPU)
  var FOV = 55 * Math.PI / 180;       // вертикальный угол обзора
  var DIST = 3.6;                     // расстояние от камеры до центра тела
  var R_MAJ = 1.0, R_MIN = 0.42;      // радиусы тора

  var AMBIENT = 0.22;                 // фоновая составляющая: тень не проваливается в черноту
  var K_DIFF = 1.15, DIFF_MAX = 1.15; // диффузная составляющая и её потолок
  var K_SPEC = 0.85, SHININESS = 42;  // блик Блинна-Фонга
  var ATT_K = 0.035;                  // мягкое затухание точечного света: 1/(1+k·d²)
  var K_FILL = 0.15;                  // слабый заполняющий свет со стороны камеры (без блика)
  var FILL_LEN = Math.sqrt(0.3 * 0.3 + 0.45 * 0.45 + 0.85 * 0.85);
  var FILL_X = 0.3 / FILL_LEN, FILL_Y = 0.45 / FILL_LEN, FILL_Z = 0.85 / FILL_LEN;
  var BASE_R = 236, BASE_G = 188, BASE_B = 152; // базовый цвет — светлая бронза

  var EDGE_EPS = -1e-3;               // допуск покрытия пикселя (против «дырок» на рёбрах)
  var NB = 8;                         // корзин глубины для каркаса
  var DETAILS = [[24, 12], [48, 24], [72, 36]]; // сегменты тора: большой × малый

  var state = { mode: 'fill', shading: 'gouraud', speed: 1 };

  // ---------- Сетка тора ----------
  var posArr, nrmArr, idxArr, vertCount, triCount;
  var viewP, viewN, sxA, syA, izA, vdA, vsA;

  function buildTorus(segMaj, segMin) {
    vertCount = segMaj * segMin;
    triCount = vertCount * 2;
    posArr = new Float32Array(vertCount * 3);
    nrmArr = new Float32Array(vertCount * 3);
    idxArr = new Uint32Array(triCount * 3);

    var p = 0;
    for (var i = 0; i < segMaj; i++) {
      var th = i / segMaj * Math.PI * 2;
      var ct = Math.cos(th), st = Math.sin(th);
      for (var j = 0; j < segMin; j++) {
        var ph = j / segMin * Math.PI * 2;
        var cp = Math.cos(ph), sp = Math.sin(ph);
        var s = R_MAJ + R_MIN * cp;
        // тор вокруг оси Y; аналитическая нормаль — для честного Гуро
        posArr[p] = s * ct; posArr[p + 1] = R_MIN * sp; posArr[p + 2] = s * st;
        nrmArr[p] = cp * ct; nrmArr[p + 1] = sp;        nrmArr[p + 2] = cp * st;
        p += 3;
      }
    }
    // Обход (θ, затем φ) даёт cross(T_θ, T_φ) = −n, поэтому вершины в порядке
    // (a, c, b)/(a, d, c) — чтобы cross(v1−v0, v2−v0) смотрел наружу (CCW снаружи).
    var k = 0;
    for (i = 0; i < segMaj; i++) {
      var i2 = (i + 1) % segMaj;
      for (j = 0; j < segMin; j++) {
        var j2 = (j + 1) % segMin;
        var a = i * segMin + j, b = i2 * segMin + j;
        var c = i2 * segMin + j2, d = i * segMin + j2;
        idxArr[k++] = a; idxArr[k++] = c; idxArr[k++] = b;
        idxArr[k++] = a; idxArr[k++] = d; idxArr[k++] = c;
      }
    }

    viewP = new Float32Array(vertCount * 3); // позиции в пространстве камеры
    viewN = new Float32Array(vertCount * 3); // нормали в пространстве камеры
    sxA = new Float32Array(vertCount);       // экранные X
    syA = new Float32Array(vertCount);       // экранные Y
    izA = new Float32Array(vertCount);       // 1/глубина (для z-буфера)
    vdA = new Float32Array(vertCount);       // диффуз на вершину (Гуро)
    vsA = new Float32Array(vertCount);       // блик на вершину (Гуро)
  }

  // ---------- Матрицы поворота (3×3, по строкам) ----------
  function rotXMat(a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [1, 0, 0, 0, c, -s, 0, s, c];
  }
  function rotYMat(a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [c, 0, s, 0, 1, 0, -s, 0, c];
  }
  function mat3Mul(A, B) {
    var C = new Array(9);
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        C[3 * r + c] = A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c];
      }
    }
    return C;
  }

  // ---------- Целевые буферы ----------
  var cssW = 0, cssH = 0, dpr = 1;
  var cw = 0, chh = 0;   // размер canvas в device px
  var rW = 0, rH = 0;    // размер буфера софт-растеризации
  var off = document.createElement('canvas');
  var offCtx = off.getContext('2d');
  var img = null, px32 = null, zb = null;

  function resize() {
    cssW = window.innerWidth; cssH = window.innerHeight;
    dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    cw = Math.max(1, Math.round(cssW * dpr));
    chh = Math.max(1, Math.round(cssH * dpr));
    canvas.width = cw; canvas.height = chh;
    var sc = Math.min(1, Math.sqrt(MAX_PIXELS / (cw * chh)));
    rW = Math.max(1, Math.floor(cw * sc));
    rH = Math.max(1, Math.floor(chh * sc));
    off.width = rW; off.height = rH;
    img = offCtx.createImageData(rW, rH);
    px32 = new Uint32Array(img.data.buffer);
    zb = new Float32Array(rW * rH);
  }

  // ---------- Освещение точечным источником ----------
  // Пишет результат в shadeD/shadeS (диффуз с ambient; блик отдельно).
  var shadeD = 0, shadeS = 0;
  function shadePoint(px, py, pz, nx, ny, nz, Lx, Ly, Lz) {
    var dx = Lx - px, dy = Ly - py, dz = Lz - pz;
    var d2 = dx * dx + dy * dy + dz * dz;
    var dl = Math.sqrt(d2), inv = 1 / dl;
    var ndl = (nx * dx + ny * dy + nz * dz) * inv;
    if (ndl < 0) ndl = 0;
    var att = 1 / (1 + ATT_K * d2);
    // fill-свет от камеры (чуть сверху-справа): силуэт читается,
    // даже когда ключевой точечный свет уходит за тело
    var nfill = nx * FILL_X + ny * FILL_Y + nz * FILL_Z;
    if (nfill < 0) nfill = 0;
    var dif = AMBIENT + K_DIFF * ndl * att + K_FILL * nfill;
    if (dif > DIFF_MAX) dif = DIFF_MAX;
    var spc = 0;
    if (ndl > 0) {
      // Блинн: полувектор между направлением на свет и на камеру (камера в нуле)
      var vl = Math.sqrt(px * px + py * py + pz * pz);
      var ivl = 1 / vl;
      var hx = dx * inv - px * ivl;
      var hy = dy * inv - py * ivl;
      var hz = dz * inv - pz * ivl;
      var hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
      if (hl > 1e-6) {
        var ndh = (nx * hx + ny * hy + nz * hz) / hl;
        if (ndh < 0) ndh = 0;
        spc = K_SPEC * Math.pow(ndh, SHININESS) * att;
        if (spc > 1) spc = 1;
      }
    }
    shadeD = dif; shadeS = spc;
  }

  // ---------- Растеризация треугольника с z-буфером ----------
  // Полуплоскости с инкрементальными рёберными функциями; атрибуты (1/z, диффуз,
  // блик) интерполируются аффинно. Вершины передаются с ПОЛОЖИТЕЛЬНОЙ площадью.
  function rasterTri(i0, i1, i2, d0, d1, d2, s0, s1, s2) {
    var x0 = sxA[i0], y0 = syA[i0], z0 = izA[i0];
    var x1 = sxA[i1], y1 = syA[i1], z1 = izA[i1];
    var x2 = sxA[i2], y2 = syA[i2], z2 = izA[i2];

    var area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    if (area < 1e-2) return;

    var minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2);
    var minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
    var pxMin = Math.max(0, Math.floor(minX));
    var pxMax = Math.min(rW - 1, Math.ceil(maxX));
    var pyMin = Math.max(0, Math.floor(minY));
    var pyMax = Math.min(rH - 1, Math.ceil(maxY));
    if (pxMax < pxMin || pyMax < pyMin) return;

    // Рёберные функции: w0 — ребро v1→v2, w1 — v2→v0, w2 — v0→v1.
    var ax0 = y1 - y2, ay0 = x2 - x1;
    var ax1 = y2 - y0, ay1 = x0 - x2;
    var ax2 = y0 - y1, ay2 = x1 - x0;

    var spx = pxMin + 0.5, spy = pyMin + 0.5; // центр стартового пикселя
    var w0r = (x2 - x1) * (spy - y1) - (y2 - y1) * (spx - x1);
    var w1r = (x0 - x2) * (spy - y2) - (y0 - y2) * (spx - x2);
    var w2r = (x1 - x0) * (spy - y0) - (y1 - y0) * (spx - x0);

    var invA = 1 / area;
    var dzx = (ax0 * z0 + ax1 * z1 + ax2 * z2) * invA;
    var dzy = (ay0 * z0 + ay1 * z1 + ay2 * z2) * invA;
    var izr = (w0r * z0 + w1r * z1 + w2r * z2) * invA;
    var ddx = (ax0 * d0 + ax1 * d1 + ax2 * d2) * invA;
    var ddy = (ay0 * d0 + ay1 * d1 + ay2 * d2) * invA;
    var dr = (w0r * d0 + w1r * d1 + w2r * d2) * invA;
    var dsx = (ax0 * s0 + ax1 * s1 + ax2 * s2) * invA;
    var dsy = (ay0 * s0 + ay1 * s1 + ay2 * s2) * invA;
    var sr = (w0r * s0 + w1r * s1 + w2r * s2) * invA;

    var buf = px32, depth = zb, W = rW;
    var rowIdx = pyMin * W;
    for (var py = pyMin; py <= pyMax; py++) {
      var w0 = w0r, w1 = w1r, w2 = w2r;
      var z = izr, d = dr, s = sr;
      var idx = rowIdx + pxMin;
      for (var px = pxMin; px <= pxMax; px++) {
        if (w0 >= EDGE_EPS && w1 >= EDGE_EPS && w2 >= EDGE_EPS && z > depth[idx]) {
          depth[idx] = z;
          var rr = BASE_R * d + 255 * s;
          var gg = BASE_G * d + 255 * s;
          var bb = BASE_B * d + 255 * s;
          if (rr > 255) rr = 255;
          if (gg > 255) gg = 255;
          if (bb > 255) bb = 255;
          buf[idx] = 0xff000000 | ((bb | 0) << 16) | ((gg | 0) << 8) | (rr | 0);
        }
        w0 += ax0; w1 += ax1; w2 += ax2;
        z += dzx; d += ddx; s += dsx;
        idx++;
      }
      w0r += ay0; w1r += ay1; w2r += ay2;
      izr += dzy; dr += ddy; sr += dsy;
      rowIdx += W;
    }
  }

  // ---------- Каркас: рёбра с батчингом по глубине ----------
  var wireBuckets = [];
  for (var wb = 0; wb < NB; wb++) wireBuckets.push([]);
  var edgeSet = new Set();

  function addWireEdge(a, b, izMin, izScale) {
    var key = a < b ? a * 65536 + b : b * 65536 + a;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    var bi = (((izA[a] + izA[b]) * 0.5 - izMin) * izScale) | 0;
    if (bi < 0) bi = 0; else if (bi > NB - 1) bi = NB - 1;
    wireBuckets[bi].push(sxA[a], syA[a], sxA[b], syA[b]);
  }

  // ---------- Маркер источника света ----------
  function drawLightMarker(x, y) {
    var r = 26 * dpr;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,244,214,0.9)');
    g.addColorStop(0.3, 'rgba(255,220,160,0.32)');
    g.addColorStop(1, 'rgba(255,210,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff7e0';
    ctx.beginPath(); ctx.arc(x, y, 3.2 * dpr, 0, Math.PI * 2); ctx.fill();
  }

  // ---------- Главный цикл ----------
  var lastT = 0;
  var rotA = 1.05, rotB = 0.35; // углы вокруг X и Y
  var lightT = 0.7;             // фаза орбиты света (своя, не зависит от слайдера)
  var fpsEma = 60, statAcc = 1;

  function frame(now) {
    requestAnimationFrame(frame);
    var t = now * 0.001;
    var dt = t - lastT; lastT = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1; // кламп большого dt (возврат из фоновой вкладки)
    if (dt > 0) fpsEma += (1 / dt - fpsEma) * 0.08;

    // медленное автоматическое вращение по двум осям
    rotA += 0.31 * state.speed * dt;
    rotB += 0.47 * state.speed * dt;
    lightT += 0.45 * dt;

    var M = mat3Mul(rotYMat(rotB), rotXMat(rotA));
    var m00 = M[0], m01 = M[1], m02 = M[2];
    var m10 = M[3], m11 = M[4], m12 = M[5];
    var m20 = M[6], m21 = M[7], m22 = M[8];

    var fillMode = state.mode === 'fill';
    var tw = fillMode ? rW : cw, th = fillMode ? rH : chh;
    var cx = tw * 0.5, cy = th * 0.5;
    var focal = 0.5 * Math.min(tw, th) / Math.tan(FOV * 0.5);

    // точечный источник кружит вокруг тела (в пространстве камеры)
    var Lx = 2.2 * Math.cos(lightT);
    var Ly = 1.15 + 0.5 * Math.sin(lightT * 0.71);
    var Lz = -DIST + 2.1 * Math.sin(lightT);

    var needVL = fillMode && state.shading === 'gouraud';

    // --- вершинный этап: поворот, проекция, при Гуро — свет на вершину ---
    var izMin = Infinity, izMax = -Infinity;
    for (var v = 0, o = 0; v < vertCount; v++, o += 3) {
      var px = posArr[o], py = posArr[o + 1], pz = posArr[o + 2];
      var vx = m00 * px + m01 * py + m02 * pz;
      var vy = m10 * px + m11 * py + m12 * pz;
      var vz = m20 * px + m21 * py + m22 * pz - DIST; // камера в нуле, смотрит вдоль −Z
      var wz = -vz, iz = 1 / wz;
      viewP[o] = vx; viewP[o + 1] = vy; viewP[o + 2] = vz;
      var nx0 = nrmArr[o], ny0 = nrmArr[o + 1], nz0 = nrmArr[o + 2];
      var nx = m00 * nx0 + m01 * ny0 + m02 * nz0;
      var ny = m10 * nx0 + m11 * ny0 + m12 * nz0;
      var nz = m20 * nx0 + m21 * ny0 + m22 * nz0;
      viewN[o] = nx; viewN[o + 1] = ny; viewN[o + 2] = nz;
      sxA[v] = cx + focal * vx * iz;
      syA[v] = cy - focal * vy * iz;
      izA[v] = iz;
      if (iz < izMin) izMin = iz;
      if (iz > izMax) izMax = iz;
      if (needVL) {
        shadePoint(vx, vy, vz, nx, ny, nz, Lx, Ly, Lz);
        vdA[v] = shadeD; vsA[v] = shadeS;
      }
    }

    var drawn = 0;
    var q, ti, i0, i1, i2, x0, y0, x1, y1, x2, y2, areaS;

    if (fillMode) {
      // --- заливка с z-буфером ---
      px32.fill(0);
      zb.fill(0);
      var flat = state.shading === 'flat';
      for (ti = 0, q = 0; ti < triCount; ti++, q += 3) {
        i0 = idxArr[q]; i1 = idxArr[q + 1]; i2 = idxArr[q + 2];
        x0 = sxA[i0]; y0 = syA[i0];
        x1 = sxA[i1]; y1 = syA[i1];
        x2 = sxA[i2]; y2 = syA[i2];
        // backface culling: лицевые грани после y-флипа экрана имеют area < 0
        areaS = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
        if (areaS >= -0.05) continue;
        drawn++;
        if (flat) {
          // нормаль грани и центроид в пространстве камеры → один цвет на грань
          var a0 = i0 * 3, a1 = i1 * 3, a2 = i2 * 3;
          var p0x = viewP[a0], p0y = viewP[a0 + 1], p0z = viewP[a0 + 2];
          var p1x = viewP[a1], p1y = viewP[a1 + 1], p1z = viewP[a1 + 2];
          var p2x = viewP[a2], p2y = viewP[a2 + 1], p2z = viewP[a2 + 2];
          var e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
          var e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;
          var fnx = e1y * e2z - e1z * e2y;
          var fny = e1z * e2x - e1x * e2z;
          var fnz = e1x * e2y - e1y * e2x;
          var fl = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz);
          if (fl > 1e-9) { fnx /= fl; fny /= fl; fnz /= fl; }
          shadePoint(
            (p0x + p1x + p2x) / 3, (p0y + p1y + p2y) / 3, (p0z + p1z + p2z) / 3,
            fnx, fny, fnz, Lx, Ly, Lz
          );
          // порядок (i0, i2, i1) делает экранную площадь положительной
          rasterTri(i0, i2, i1, shadeD, shadeD, shadeD, shadeS, shadeS, shadeS);
        } else {
          rasterTri(i0, i2, i1, vdA[i0], vdA[i2], vdA[i1], vsA[i0], vsA[i2], vsA[i1]);
        }
      }
      offCtx.putImageData(img, 0, 0);
      ctx.clearRect(0, 0, cw, chh);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, rW, rH, 0, 0, cw, chh);
    } else {
      // --- каркас: только лицевые грани, рёбра без дублей, глубина → яркость ---
      ctx.clearRect(0, 0, cw, chh);
      edgeSet.clear();
      for (var bi = 0; bi < NB; bi++) wireBuckets[bi].length = 0;
      var izScale = NB / Math.max(1e-9, izMax - izMin);
      for (ti = 0, q = 0; ti < triCount; ti++, q += 3) {
        i0 = idxArr[q]; i1 = idxArr[q + 1]; i2 = idxArr[q + 2];
        x0 = sxA[i0]; y0 = syA[i0];
        x1 = sxA[i1]; y1 = syA[i1];
        x2 = sxA[i2]; y2 = syA[i2];
        areaS = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
        if (areaS >= -0.05) continue;
        drawn++;
        addWireEdge(i0, i1, izMin, izScale);
        addWireEdge(i1, i2, izMin, izScale);
        addWireEdge(i2, i0, izMin, izScale);
      }
      for (bi = 0; bi < NB; bi++) { // от дальних к ближним
        var segs = wireBuckets[bi];
        if (!segs.length) continue;
        var f = bi / (NB - 1);
        ctx.strokeStyle = 'rgba(126,212,255,' + (0.1 + 0.85 * f * f).toFixed(3) + ')';
        ctx.lineWidth = (0.55 + 1.05 * f) * dpr;
        ctx.beginPath();
        for (var si = 0; si < segs.length; si += 4) {
          ctx.moveTo(segs[si], segs[si + 1]);
          ctx.lineTo(segs[si + 2], segs[si + 3]);
        }
        ctx.stroke();
      }
    }

    // --- маркер источника света (в заливке — с проверкой по z-буферу) ---
    var mwz = -Lz;
    if (mwz > 0.25) {
      var msx = cx + focal * Lx / mwz;
      var msy = cy - focal * Ly / mwz;
      if (fillMode) {
        var ix = msx | 0, iy = msy | 0;
        if (ix >= 0 && iy >= 0 && ix < rW && iy < rH && 1 / mwz >= zb[iy * rW + ix]) {
          var sk = cw / rW;
          drawLightMarker(msx * sk, msy * sk);
        }
      } else if (msx > -60 && msx < cw + 60 && msy > -60 && msy < chh + 60) {
        drawLightMarker(msx, msy);
      }
    }

    // --- статистика ---
    statAcc += dt;
    if (statAcc >= 0.25) {
      statAcc = 0;
      statsEl.textContent = 'треугольников: ' + triCount +
        ' · видимых: ' + drawn + ' · ' + Math.round(fpsEma) + ' fps';
    }
  }

  // ---------- Управление ----------
  function bindSeg(id, fn) {
    var el = document.getElementById(id);
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn || btn.classList.contains('active')) return;
      var all = el.querySelectorAll('button');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === btn);
      fn(btn.dataset.v);
    });
  }

  bindSeg('segMode', function (v) {
    state.mode = v;
    groupShadeEl.classList.toggle('disabled', v === 'wire');
  });
  bindSeg('segShade', function (v) { state.shading = v; });
  bindSeg('segDetail', function (v) {
    var d = DETAILS[Number(v)] || DETAILS[1];
    buildTorus(d[0], d[1]);
  });
  document.getElementById('speed').addEventListener('input', function (e) {
    state.speed = parseFloat(e.target.value) || 0;
  });

  // ручной доворот мышью/пальцем (авто-вращение продолжается)
  var dragging = false, dragX = 0, dragY = 0;
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true; dragX = e.clientX; dragY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    rotB += (e.clientX - dragX) * 0.005;
    rotA += (e.clientY - dragY) * 0.005;
    dragX = e.clientX; dragY = e.clientY;
  });
  function endDrag() { dragging = false; canvas.style.cursor = ''; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------- Старт ----------
  window.addEventListener('resize', resize);
  buildTorus(DETAILS[1][0], DETAILS[1][1]);
  resize();
  requestAnimationFrame(frame);
})();
