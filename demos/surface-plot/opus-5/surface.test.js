/*
 * surface.test.js — численная проверка ядра.
 * Запуск: node demos/surface-plot/opus-5/surface.test.js
 *
 * Главный тест: программный растеризатор с z-буфером «догоняет» алгоритм
 * художника. Для каждого пикселя сравнивается глубина ПОСЛЕДНЕГО нарисованного
 * полигона с минимальной глубиной среди всех полигонов, накрывших пиксель.
 * Если порядок верен — они совпадают: дальний полигон никогда не ложится
 * поверх ближнего. Проверяется на всех функциях и на ракурсах вплоть до 2°
 * (вид почти с ребра).
 */
'use strict';

var assert = require('node:assert');
var S = require('./surface.js');

var RAD = Math.PI / 180;
var passed = 0;

function ok(name) { passed++; console.log('  ok  ' + name); }

/* ------------------------------------------------------------------ */
/*  1. Порядок по оси: строго по убыванию расстояния от камеры          */
/* ------------------------------------------------------------------ */
(function testAxisOrder() {
  var cases = [-12.3, -0.5, 0, 0.5, 3.7, 8, 15.5, 19.5, 30];
  var M = 20;
  var out = new Int32Array(M);
  for (var c = 0; c < cases.length; c++) {
    S.fillAxisOrder(M, cases[c], out);
    var seen = new Set();
    for (var k = 0; k < M; k++) {
      assert.ok(out[k] >= 0 && out[k] < M, 'индекс в диапазоне');
      seen.add(out[k]);
      if (k > 0) {
        var prev = Math.abs(out[k - 1] + 0.5 - cases[c]);
        var cur = Math.abs(out[k] + 0.5 - cases[c]);
        assert.ok(prev >= cur - 1e-12,
          'убывание расстояния: c=' + cases[c] + ' шаг ' + k + ' (' + prev + ' < ' + cur + ')');
      }
    }
    assert.strictEqual(seen.size, M, 'перестановка без пропусков, c=' + cases[c]);
  }
  ok('fillAxisOrder — перестановка, строго по убыванию |i+0.5−c|');
})();

/* ------------------------------------------------------------------ */
/*  2. Нормали — единичные и обращены вверх                             */
/* ------------------------------------------------------------------ */
(function testNormals() {
  var N = 33, n = N * N;
  var H = new Float32Array(n), nr = new Float32Array(n * 3);
  for (var fi = 0; fi < S.FUNCS.length; fi++) {
    S.fillHeights(S.FUNCS[fi], N, 1.7, H);
    S.computeNormals(H, N, 0.9, nr);
    for (var k = 0; k < n; k++) {
      var o = k * 3;
      var len = Math.sqrt(nr[o] * nr[o] + nr[o + 1] * nr[o + 1] + nr[o + 2] * nr[o + 2]);
      assert.ok(Math.abs(len - 1) < 1e-5, 'нормаль единичная, |n|=' + len);
      assert.ok(nr[o + 2] > 0, 'z-компонента нормали положительна');
    }
  }
  ok('computeNormals — единичные нормали, nz > 0 на всех функциях');
})();

/* ------------------------------------------------------------------ */
/*  3. Диапазон значений функций укладывается в цветовую карту          */
/* ------------------------------------------------------------------ */
(function testRanges() {
  var N = 61;
  var H = new Float32Array(N * N);
  var globalMax = 0;
  for (var fi = 0; fi < S.FUNCS.length; fi++) {
    var f = S.FUNCS[fi], mx = 0;
    for (var t = 0; t < 24; t += 0.37) {
      S.fillHeights(f, N, t, H);
      for (var k = 0; k < H.length; k++) {
        assert.ok(Number.isFinite(H[k]), f.id + ': значение конечно (t=' + t + ')');
        var a = Math.abs(H[k]);
        if (a > mx) mx = a;
      }
    }
    assert.ok(mx > 0.45, f.id + ': поле не вырождено, max|z|=' + mx.toFixed(3));
    assert.ok(mx < 1.5, f.id + ': поле в пределах карты, max|z|=' + mx.toFixed(3));
    if (mx > globalMax) globalMax = mx;
  }
  ok('поля высот конечны и лежат в пределах цветовой карты (max|z|=' + globalMax.toFixed(2) + ')');
})();

/* ------------------------------------------------------------------ */
/*  4. Главное: корректность перекрытия при любом ракурсе               */
/* ------------------------------------------------------------------ */

var W = 200, HH = 140;
var lastCell = new Int32Array(W * HH);     // какой квад закрасил пиксель последним
var lastDepth = new Float64Array(W * HH);  // ближайшая глубина этого квада в пикселе
var bestDepth = new Float64Array(W * HH);  // ближайшая глубина по всем квадам
var bestCell = new Int32Array(W * HH);
var covered = new Uint8Array(W * HH);
var curCell = 0;

/*
 * Квад рисуется в демке ОДНИМ полигоном одного цвета, поэтому взаимный
 * порядок двух его треугольников на результат не влияет: значимо только,
 * какой КВАД оказался сверху. Поэтому глубина квада в пикселе — минимум
 * по его треугольникам.
 */
function rasterTri(x0, y0, z0, x1, y1, z1, x2, y2, z2) {
  var area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!(Math.abs(area) > 1e-12)) return;
  var inv = 1 / area;
  var minx = Math.max(0, Math.ceil(Math.min(x0, x1, x2) - 0.5));
  var maxx = Math.min(W - 1, Math.floor(Math.max(x0, x1, x2) - 0.5));
  var miny = Math.max(0, Math.ceil(Math.min(y0, y1, y2) - 0.5));
  var maxy = Math.min(HH - 1, Math.floor(Math.max(y0, y1, y2) - 0.5));
  for (var py = miny; py <= maxy; py++) {
    var Y = py + 0.5;
    var row = py * W;
    for (var px = minx; px <= maxx; px++) {
      var X = px + 0.5;
      var w0 = ((x1 - X) * (y2 - Y) - (x2 - X) * (y1 - Y)) * inv;
      if (w0 < -1e-9) continue;
      var w1 = ((x2 - X) * (y0 - Y) - (x0 - X) * (y2 - Y)) * inv;
      if (w1 < -1e-9) continue;
      var w2 = 1 - w0 - w1;
      if (w2 < -1e-9) continue;
      // перспективно-корректная глубина = точное пересечение луча с плоскостью
      var z = 1 / (w0 / z0 + w1 / z1 + w2 / z2);
      var p = row + px;
      if (lastCell[p] === curCell && covered[p]) {
        if (z < lastDepth[p]) lastDepth[p] = z;
      } else {
        lastCell[p] = curCell;
        lastDepth[p] = z;
      }
      covered[p] = 1;
      if (z < bestDepth[p]) { bestDepth[p] = z; bestCell[p] = curCell; }
    }
  }
}

function occlusionCase(fn, N, t, amp, azDeg, elDeg) {
  var n = N * N;
  var H = new Float32Array(n);
  S.fillHeights(fn, N, t, H);
  var sx = new Float32Array(n), sy = new Float32Array(n), vz = new Float32Array(n);
  var cam = S.makeCamera({
    az: azDeg * RAD, el: elDeg * RAD, dist: 3.75,
    fov: 44 * RAD, w: W, h: HH, cx: W * 0.5, cy: HH * 0.455
  });
  S.projectAll(N, H, amp, cam, sx, sy, vz);

  var iO = new Int32Array(N - 1), jO = new Int32Array(N - 1);
  S.buildOrder(N, cam.px, cam.py, iO, jO);

  lastDepth.fill(0);
  bestDepth.fill(Infinity);
  covered.fill(0);
  lastCell.fill(-1);
  bestCell.fill(-1);

  var M = N - 1, drawn = 0;
  for (var a = 0; a < M; a++) {
    var i = iO[a];
    for (var b = 0; b < M; b++) {
      var j = jO[b];
      var k0 = j * N + i, k1 = k0 + 1, k3 = k0 + N, k2 = k3 + 1;
      if (vz[k0] <= 0.02 || vz[k1] <= 0.02 || vz[k2] <= 0.02 || vz[k3] <= 0.02) continue;
      curCell = j * M + i;
      drawn++;
      // та же триангуляция, что и обход контура квада в main.js
      rasterTri(sx[k0], sy[k0], vz[k0], sx[k1], sy[k1], vz[k1], sx[k2], sy[k2], vz[k2]);
      rasterTri(sx[k0], sy[k0], vz[k0], sx[k2], sy[k2], vz[k2], sx[k3], sy[k3], vz[k3]);
    }
  }

  var bad = 0, worst = 0, pix = 0, sample = null;
  for (var p = 0; p < covered.length; p++) {
    if (!covered[p]) continue;
    pix++;
    if (lastCell[p] === bestCell[p]) continue;
    var rel = (lastDepth[p] - bestDepth[p]) / bestDepth[p];
    if (rel > worst) worst = rel;
    if (rel > 1e-6) {
      bad++;
      if (!sample) {
        sample = ' пример: пиксель (' + (p % W) + ',' + ((p / W) | 0) + ') закрашен квадом ' +
          '(' + (lastCell[p] % M) + ',' + ((lastCell[p] / M) | 0) + ') на глубине ' + lastDepth[p].toFixed(4) +
          ', ближе квад (' + (bestCell[p] % M) + ',' + ((bestCell[p] / M) | 0) + ') на ' + bestDepth[p].toFixed(4);
      }
    }
  }
  return { bad: bad, worst: worst, pix: pix, drawn: drawn, cells: M * M, sample: sample || '' };
}

(function testOcclusion() {
  var N = 22, amp = 0.55;
  var els = [2, 6, 15, 35, 60, 85];
  var azs = [0, 37, 90, 143, 200, 271, 315, 359];
  var totalPix = 0, worstAll = 0, cases = 0;

  for (var fi = 0; fi < S.FUNCS.length; fi++) {
    var fn = S.FUNCS[fi];
    for (var e = 0; e < els.length; e++) {
      for (var z = 0; z < azs.length; z++) {
        var res = occlusionCase(fn, N, 1.31 + fi * 0.7, amp, azs[z], els[e]);
        assert.strictEqual(res.drawn, res.cells,
          fn.id + ': все полигоны попали в кадр (эл=' + els[e] + '°, аз=' + azs[z] + '°)');
        assert.ok(res.pix > 300,
          fn.id + ': поверхность видна (эл=' + els[e] + '°, аз=' + azs[z] + '°, пикселей ' + res.pix + ')');
        assert.strictEqual(res.bad, 0,
          fn.id + ': нарушений порядка ' + res.bad + '/' + res.pix +
          ' при эл=' + els[e] + '° аз=' + azs[z] + '°, худшее превышение глубины ' +
          (res.worst * 100).toFixed(4) + '%.' + res.sample);
        totalPix += res.pix;
        if (res.worst > worstAll) worstAll = res.worst;
        cases++;
      }
    }
  }
  ok('порядок художника: ' + cases + ' ракурсов × 5 функций, ' +
     totalPix.toLocaleString('ru-RU') + ' покрытых пикселей, ' +
     'ни одного дальнего полигона поверх ближнего (макс. отклонение ' +
     (worstAll * 100).toFixed(6) + '%)');
})();

/* ------------------------------------------------------------------ */
/*  5. Камера: ортонормированный базис, поверхность перед камерой       */
/* ------------------------------------------------------------------ */
(function testCamera() {
  for (var el = 1; el <= 85; el += 7) {
    for (var az = 0; az < 360; az += 23) {
      var c = S.makeCamera({ az: az * RAD, el: el * RAD, dist: 3.75, fov: 44 * RAD, w: 800, h: 600 });
      var dots = [
        c.fx * c.rx + c.fy * c.ry + c.fz * c.rz,
        c.fx * c.ux + c.fy * c.uy + c.fz * c.uz,
        c.rx * c.ux + c.ry * c.uy + c.rz * c.uz
      ];
      for (var d = 0; d < 3; d++) assert.ok(Math.abs(dots[d]) < 1e-9, 'базис ортогонален');
      var lens = [
        Math.hypot(c.fx, c.fy, c.fz),
        Math.hypot(c.rx, c.ry, c.rz),
        Math.hypot(c.ux, c.uy, c.uz)
      ];
      for (var l = 0; l < 3; l++) assert.ok(Math.abs(lens[l] - 1) < 1e-9, 'базис нормирован');
      assert.ok(c.uz > 0, 'верх камеры смотрит вверх (el=' + el + ')');
    }
  }
  ok('makeCamera — ортонормированный базис на всём диапазоне наклонов');
})();

/* ------------------------------------------------------------------ */
/*  6. Подгонка кадра: поверхность влезает и при этом не мельчит         */
/* ------------------------------------------------------------------ */
(function testFit() {
  var R = Math.SQRT2;
  var screens = [[1920, 1080], [1440, 900], [900, 1400], [640, 480], [1280, 360]];
  for (var s = 0; s < screens.length; s++) {
    var W = screens[s][0], Hh = screens[s][1];
    var focal = 0.5 * Math.min(W, Hh) / Math.tan(19 * RAD);
    var halfW = 0.50 * W, halfH = 0.46 * Hh;
    for (var elD = 3; elD <= 82; elD += 7) {
      for (var zm = 0.1; zm <= 0.9; zm += 0.4) {
        var d = S.fitDistance(focal, elD * RAD, R, zm, halfW, halfH);
        assert.ok(d > R + zm, 'камера снаружи габарита: d=' + d);

        // проверяем реальным проецированием углов габаритного цилиндра
        function extent(dist) {
          var cam = S.makeCamera({ az: 0, el: elD * RAD, dist: dist, fov: 38 * RAD, w: W, h: Hh });
          var mx = 0, my = 0;
          for (var a = 0; a < 360; a += 5) {
            for (var q = -1; q <= 1; q += 2) {
              var px = R * Math.cos(a * RAD) - cam.px;
              var py = R * Math.sin(a * RAD) - cam.py;
              var pz = q * zm - cam.pz;
              var Z = px * cam.fx + py * cam.fy + pz * cam.fz;
              assert.ok(Z > 0.01, 'габарит перед камерой (Z=' + Z + ')');
              var k = cam.focal / Z;
              mx = Math.max(mx, Math.abs((px * cam.rx + py * cam.ry + pz * cam.rz) * k));
              my = Math.max(my, Math.abs((px * cam.ux + py * cam.uy + pz * cam.uz) * k));
            }
          }
          return Math.max(mx / halfW, my / halfH);
        }

        var at = extent(d);
        assert.ok(at <= 1.02, 'габарит влезает в кадр: ' + at.toFixed(4) +
          ' (экран ' + W + '×' + Hh + ', эл=' + elD + '°, zmax=' + zm.toFixed(1) + ')');
        // и подгонка не «жадничает»: ближе на 6 % — уже вылезает
        if (d > R + zm + 0.31) {
          assert.ok(extent(d / 1.06) > 1.0, 'кадр подобран впритык, а не с запасом: ' +
            extent(d / 1.06).toFixed(4) + ' (эл=' + elD + '°)');
        }
      }
    }
  }
  ok('fitDistance — габарит всегда в кадре и подобран впритык (5 форматов × 12 наклонов)');
})();

/* ------------------------------------------------------------------ */
/*  7. Цветовая карта                                                   */
/* ------------------------------------------------------------------ */
(function testLUT() {
  var lut = S.makeLUT(256);
  assert.strictEqual(lut.length, 768, 'размер LUT');
  assert.deepStrictEqual([lut[0], lut[1], lut[2]], [16, 20, 66], 'нижний край карты');
  assert.deepStrictEqual([lut[765], lut[766], lut[767]], [252, 241, 218], 'верхний край карты');
  // Яркость должна расти вместе с высотой: тогда цвет не спорит с затенением.
  // Допуск 0.5 — шум округления каналов к целым (одна единица канала ≈ 0.07…0.72).
  var lum = -1, first = 0;
  for (var i = 0; i < 256; i++) {
    var o = i * 3;
    var y = 0.2126 * lut[o] + 0.7152 * lut[o + 1] + 0.0722 * lut[o + 2];
    if (i === 0) first = y;
    assert.ok(y > lum - 0.5, 'яркость карты не убывает (шаг ' + i + ', ' + y.toFixed(2) + ' после ' + lum.toFixed(2) + ')');
    lum = y;
  }
  assert.ok(lum - first > 180, 'карта покрывает широкий диапазон яркости: ' + (lum - first).toFixed(1));
  ok('makeLUT — монотонная по яркости карта из ' + S.RAMP.length + ' опорных цветов, размах ' + (lum - first).toFixed(0));
})();

console.log('\n' + passed + ' групп проверок пройдено.');
