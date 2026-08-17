/* =====================================================================
   3D-тело: софт-рендер на Canvas 2D — Claude Opus 5

   Конвейер целиком написан руками, без WebGL и без библиотек:
     1. меш (тор / трилистный узел / геосфера) с нормалями вершин;
     2. матрица поворота 3x3 по двум осям, перевод в камерное пространство;
     3. перспективная проекция (деление на z), запоминаем w = 1/z;
     4. отсечение нелицевых граней по знаку dot(Nгр, Cгр) в камерном пространстве;
     5. растеризация треугольников в ImageData краевыми функциями в
        фиксированной точке 1/16 px + правило «top-left» (герметично: каждый
        пиксель покрыт ровно один раз, результат не зависит от порядка граней);
     6. z-буфер по w = 1/z с перспективно-корректной интерполяцией яркости;
     7. точечный источник: диффуз + Блинн-спекуляр + затухание, плоское
        затенение (одна яркость на грань) и гладкое по Гуро (интерполяция
        яркости вершин попиксельно).
   Каркас рисуется линиями с тем же z-тестом — получается честное удаление
   невидимых линий.

   Файл dual-mode: в браузере сам поднимает сцену, в node экспортирует ядро
   через module.exports (для headless-проверки глубины).
   ===================================================================== */
'use strict';

(function (global) {

var TAU = Math.PI * 2;

/* ===================== 0. Упаковка цвета ===================== */

var LITTLE_ENDIAN = (function () {
  var b = new ArrayBuffer(4);
  new Uint32Array(b)[0] = 1;
  return new Uint8Array(b)[0] === 1;
})();

function packColor(r, g, b) {
  return LITTLE_ENDIAN
    ? (((255 << 24) | (b << 16) | (g << 8) | r) >>> 0)
    : (((r << 24) | (g << 16) | (b << 8) | 255) >>> 0);
}

/* ===================== 1. Палитры и LUT ======================
   Яркость (0..1) отображается в цвет по 256-элементной таблице.
   Это и быстро (одна выборка на пиксель), и даёт художественный градиент
   вместо плоского серого. */

var PALETTES = {
  copper: {
    name: 'Медь', accent: '#f0a35e', glow: [214, 118, 62],
    stops: [[0.00, 12, 9, 17], [0.16, 45, 19, 43], [0.36, 122, 44, 57],
            [0.56, 196, 92, 44], [0.76, 243, 174, 100], [1.00, 255, 247, 229]]
  },
  ice: {
    name: 'Лёд', accent: '#6fd6ee', glow: [72, 158, 208],
    stops: [[0.00, 8, 12, 22], [0.16, 17, 39, 72], [0.36, 27, 87, 129],
            [0.56, 63, 158, 190], [0.76, 151, 222, 240], [1.00, 255, 255, 255]]
  },
  spectrum: {
    name: 'Спектр', accent: '#c86bff', glow: [150, 74, 214],
    stops: [[0.00, 10, 7, 21], [0.16, 47, 17, 87], [0.36, 116, 30, 141],
            [0.56, 212, 62, 111], [0.76, 255, 158, 84], [1.00, 255, 250, 216]]
  }
};

/* LUT: packed-цвета (для растеризатора) + байтовые компоненты (для линий) */
function buildLUT(stops) {
  var u32 = new Uint32Array(256);
  var rgb = new Uint8Array(256 * 3);
  for (var i = 0; i < 256; i++) {
    var t = i / 255, s = 0;
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
    var a = stops[s], b = stops[s + 1];
    var f = (t - a[0]) / (b[0] - a[0] || 1);
    if (f < 0) f = 0; else if (f > 1) f = 1;
    f = f * f * (3 - 2 * f);                       // сглаживание стыка стопов
    var r = (a[1] + (b[1] - a[1]) * f) | 0;
    var g = (a[2] + (b[2] - a[2]) * f) | 0;
    var c = (a[3] + (b[3] - a[3]) * f) | 0;
    u32[i] = packColor(r, g, c);
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = c;
  }
  return { u32: u32, rgb: rgb };
}

/* ===================== 2. Геометрия ===================== */

/* Список уникальных рёбер + для каждого — до двух смежных граней.
   Нужен для каркаса: линия рисуется один раз, а её яркость в плоском режиме
   берётся от смежных граней. */
function buildEdgeFaces(tris, wire) {
  var m1 = new Map(), m2 = new Map();
  var nt = tris.length / 3, i, e, a, b, key;
  for (i = 0; i < nt; i++) {
    for (e = 0; e < 3; e++) {
      a = tris[i * 3 + e];
      b = tris[i * 3 + (e + 1) % 3];
      key = a < b ? a * 1e7 + b : b * 1e7 + a;
      if (m1.has(key)) { if (!m2.has(key)) m2.set(key, i); }
      else m1.set(key, i);
    }
  }
  var ef = new Int32Array(wire.length);
  for (i = 0; i < wire.length; i += 2) {
    a = wire[i]; b = wire[i + 1];
    key = a < b ? a * 1e7 + b : b * 1e7 + a;
    ef[i] = m1.has(key) ? m1.get(key) : -1;
    ef[i + 1] = m2.has(key) ? m2.get(key) : -1;
  }
  return ef;
}

/* Центрирование по bbox и нормировка габарита к targetR. */
function finalizeMesh(pos, nrm, tris, wire, targetR) {
  var n = pos.length / 3, i, o;
  var mnx = Infinity, mny = Infinity, mnz = Infinity;
  var mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (i = 0; i < n; i++) {
    o = i * 3;
    if (pos[o] < mnx) mnx = pos[o]; if (pos[o] > mxx) mxx = pos[o];
    if (pos[o + 1] < mny) mny = pos[o + 1]; if (pos[o + 1] > mxy) mxy = pos[o + 1];
    if (pos[o + 2] < mnz) mnz = pos[o + 2]; if (pos[o + 2] > mxz) mxz = pos[o + 2];
  }
  var cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = (mnz + mxz) / 2;
  var maxr2 = 0;
  for (i = 0; i < n; i++) {
    o = i * 3;
    var x = pos[o] - cx, y = pos[o + 1] - cy, z = pos[o + 2] - cz;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    var r2 = x * x + y * y + z * z;
    if (r2 > maxr2) maxr2 = r2;
  }
  var s = targetR / Math.sqrt(maxr2);
  for (i = 0; i < n * 3; i++) pos[i] *= s;
  return {
    pos: new Float32Array(pos),
    nrm: new Float32Array(nrm),
    tris: tris,
    wire: wire,
    edgeFaces: buildEdgeFaces(tris, wire),
    vcount: n,
    tcount: tris.length / 3,
    radius: targetR
  };
}

/* Труба вдоль замкнутой кривой.
   Кадр переносится параллельно (rotation-minimising frame), остаточный
   поворот на замыкании равномерно распределяется — шва и скрутки нет.
   Нормаль поверхности = радиальное направление кольца (точно для трубы
   постоянного радиуса). */
function buildTube(curve, nu, nv, tubeR, targetR) {
  var i, j, o, l;
  var C = new Float64Array(nu * 3), T = new Float64Array(nu * 3);
  for (i = 0; i < nu; i++) {
    var p = curve(TAU * i / nu);
    C[i * 3] = p[0]; C[i * 3 + 1] = p[1]; C[i * 3 + 2] = p[2];
  }
  for (i = 0; i < nu; i++) {
    var a = ((i + nu - 1) % nu) * 3, b = ((i + 1) % nu) * 3;
    var tx = C[b] - C[a], ty = C[b + 1] - C[a + 1], tz = C[b + 2] - C[a + 2];
    l = 1 / Math.sqrt(tx * tx + ty * ty + tz * tz);
    T[i * 3] = tx * l; T[i * 3 + 1] = ty * l; T[i * 3 + 2] = tz * l;
  }
  var N = new Float64Array(nu * 3), B = new Float64Array(nu * 3);
  // затравка: любой вектор, ортогональный T[0]
  var t0x = T[0], t0y = T[1], t0z = T[2];
  var ax = Math.abs(t0x) < 0.9 ? 1 : 0, ay = Math.abs(t0x) < 0.9 ? 0 : 1;
  var nx = t0y * 0 - t0z * ay, ny = t0z * ax - t0x * 0, nz = t0x * ay - t0y * ax;
  l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
  N[0] = nx * l; N[1] = ny * l; N[2] = nz * l;
  for (i = 1; i < nu; i++) {
    var px = N[(i - 1) * 3], py = N[(i - 1) * 3 + 1], pz = N[(i - 1) * 3 + 2];
    var qx = T[i * 3], qy = T[i * 3 + 1], qz = T[i * 3 + 2];
    var d = px * qx + py * qy + pz * qz;
    var vx = px - qx * d, vy = py - qy * d, vz = pz - qz * d;
    l = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz);
    N[i * 3] = vx * l; N[i * 3 + 1] = vy * l; N[i * 3 + 2] = vz * l;
  }
  for (i = 0; i < nu; i++) {
    o = i * 3;
    B[o] = T[o + 1] * N[o + 2] - T[o + 2] * N[o + 1];
    B[o + 1] = T[o + 2] * N[o] - T[o] * N[o + 2];
    B[o + 2] = T[o] * N[o + 1] - T[o + 1] * N[o];
  }
  // остаточный угол при замыкании петли
  var e = (nu - 1) * 3;
  var lx = N[e], ly = N[e + 1], lz = N[e + 2];
  var d0 = lx * T[0] + ly * T[1] + lz * T[2];
  lx -= T[0] * d0; ly -= T[1] * d0; lz -= T[2] * d0;
  l = 1 / Math.sqrt(lx * lx + ly * ly + lz * lz);
  lx *= l; ly *= l; lz *= l;
  var resid = Math.atan2(lx * B[0] + ly * B[1] + lz * B[2],
                         lx * N[0] + ly * N[1] + lz * N[2]);

  var V = nu * nv;
  var pos = new Float64Array(V * 3), nrm = new Float32Array(V * 3);
  for (i = 0; i < nu; i++) {
    var tw = -resid * i / nu;
    var no = i * 3;
    for (j = 0; j < nv; j++) {
      var th = TAU * j / nv + tw, cs = Math.cos(th), sn = Math.sin(th);
      var dx = cs * N[no] + sn * B[no];
      var dy = cs * N[no + 1] + sn * B[no + 1];
      var dz = cs * N[no + 2] + sn * B[no + 2];
      var k = (i * nv + j) * 3;
      pos[k] = C[no] + tubeR * dx;
      pos[k + 1] = C[no + 1] + tubeR * dy;
      pos[k + 2] = C[no + 2] + tubeR * dz;
      nrm[k] = dx; nrm[k + 1] = dy; nrm[k + 2] = dz;
    }
  }
  // индексы: (a,d,c) и (a,c,b) — обход против часовой при взгляде снаружи
  var tris = new Uint32Array(nu * nv * 6);
  var wire = new Uint32Array(nu * nv * 4);
  var ti = 0, wi = 0;
  for (i = 0; i < nu; i++) {
    var i2 = (i + 1) % nu;
    for (j = 0; j < nv; j++) {
      var j2 = (j + 1) % nv;
      var A = i * nv + j, Bv = i2 * nv + j, Cv = i2 * nv + j2, Dv = i * nv + j2;
      tris[ti++] = A; tris[ti++] = Dv; tris[ti++] = Cv;
      tris[ti++] = A; tris[ti++] = Cv; tris[ti++] = Bv;
      wire[wi++] = A; wire[wi++] = Bv;      // вдоль кривой
      wire[wi++] = A; wire[wi++] = Dv;      // вокруг трубы
    }
  }
  return finalizeMesh(pos, nrm, tris, wire, targetR);
}

function circleCurve(R) {
  return function (t) { return [R * Math.cos(t), 0, R * Math.sin(t)]; };
}
function trefoilCurve() {
  return function (t) {
    return [Math.sin(t) + 2 * Math.sin(2 * t),
            Math.cos(t) - 2 * Math.cos(2 * t),
            -Math.sin(3 * t)];
  };
}

/* Геосфера: икосаэдр с рекурсивным дроблением рёбер, вершины на сфере.
   Выпуклый многогранник с 20*4^sub гранями. */
function buildIcosphere(sub, targetR) {
  var t = (1 + Math.sqrt(5)) / 2;
  var raw = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
             [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
             [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  var vs = [];
  for (var i = 0; i < raw.length; i++) {
    var v = raw[i], l = 1 / Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    vs.push(v[0] * l, v[1] * l, v[2] * l);
  }
  var faces = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
               1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
               3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
               4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];

  for (var s = 0; s < sub; s++) {
    var next = [], cache = new Map();
    var mid = function (a, b) {
      var key = a < b ? a * 1e7 + b : b * 1e7 + a;
      var got = cache.get(key);
      if (got !== undefined) return got;
      var ax = (vs[a * 3] + vs[b * 3]) / 2;
      var ay = (vs[a * 3 + 1] + vs[b * 3 + 1]) / 2;
      var az = (vs[a * 3 + 2] + vs[b * 3 + 2]) / 2;
      var l = 1 / Math.sqrt(ax * ax + ay * ay + az * az);
      var idx = vs.length / 3;
      vs.push(ax * l, ay * l, az * l);
      cache.set(key, idx);
      return idx;
    };
    for (i = 0; i < faces.length; i += 3) {
      var a = faces[i], b = faces[i + 1], c = faces[i + 2];
      var ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }

  var n = vs.length / 3;
  var pos = new Float64Array(n * 3), nrm = new Float32Array(n * 3);
  for (i = 0; i < n * 3; i++) { pos[i] = vs[i]; nrm[i] = vs[i]; }
  var tris = new Uint32Array(faces);
  // уникальные рёбра
  var seen = new Set(), wl = [];
  for (i = 0; i < faces.length; i += 3) {
    for (var e = 0; e < 3; e++) {
      var p = faces[i + e], q = faces[i + (e + 1) % 3];
      var key = p < q ? p * 1e7 + q : q * 1e7 + p;
      if (!seen.has(key)) { seen.add(key); wl.push(p, q); }
    }
  }
  return finalizeMesh(pos, nrm, tris, new Uint32Array(wl), targetR);
}

var MESH_SPECS = {
  torus:  function (R) { return buildTube(circleCurve(1.0), 76, 26, 0.42, R); },
  knot:   function (R) { return buildTube(trefoilCurve(), 160, 14, 0.62, R); },
  sphere: function (R) { return buildIcosphere(3, R); }
};

/* ===================== 3. Освещение =====================
   Точечный источник в камерном пространстве. Возвращает скаляр яркости
   0..1, который дальше превращается в цвет по LUT. */

var _Lx = 0, _Ly = 0, _Lz = 0;
var K_AMB = 0.095, K_DIF = 0.54, K_SPC = 0.45, K_RIM = 0.15, ATT = 10;

function shade(px, py, pz, nx, ny, nz) {
  var ldx = _Lx - px, ldy = _Ly - py, ldz = _Lz - pz;
  var d2 = ldx * ldx + ldy * ldy + ldz * ldz;
  var inv = 1 / Math.sqrt(d2);
  ldx *= inv; ldy *= inv; ldz *= inv;

  var iv = 1 / Math.sqrt(px * px + py * py + pz * pz);
  var vx = -px * iv, vy = -py * iv, vz = -pz * iv;

  var att = ATT * 2 / (ATT + d2);
  var t = K_AMB + K_AMB * 0.7 * (0.5 + 0.5 * ny);      // полусферический ambient

  var ndl = nx * ldx + ny * ldy + nz * ldz;
  if (ndl > 0) {
    t += K_DIF * ndl * att;
    var hx = ldx + vx, hy = ldy + vy, hz = ldz + vz;
    var hl = 1 / Math.sqrt(hx * hx + hy * hy + hz * hz);
    var ndh = (nx * hx + ny * hy + nz * hz) * hl;
    if (ndh > 0) {
      var sp = ndh; sp *= sp; sp *= sp; sp *= sp; sp *= sp; sp *= sp;  // ^32
      t += K_SPC * sp * att;
    }
  }
  var ndv = nx * vx + ny * vy + nz * vz;
  if (ndv < 0) ndv = -ndv;
  var rim = 1 - ndv; rim = rim * rim * rim;
  t += K_RIM * rim;

  return t < 0 ? 0 : (t > 1 ? 1 : t);
}

/* ===================== 4. Растеризатор =====================
   Координаты снапятся в фиксированную точку 1/16 пикселя, краевые функции
   целочисленные (точны в double), правило «top-left» отдаёт каждый пиксель
   ровно одному треугольнику. Итог: нет щелей на стыках, нет двойной
   отрисовки и результат не зависит от порядка граней — z-буфер честный. */

var SUB = 16, HALF = 8;

function topLeftBias(dx, dy) {           // 0 — ребро включается при E==0
  return (dy < 0 || (dy === 0 && dx > 0)) ? 0 : 1;
}

/* Заливка постоянным цветом (плоское затенение). */
function rasterFlat(u32, zb, W, H, x0, y0, w0, x1, y1, w1, x2, y2, w2, color) {
  var X0 = Math.round(x0 * SUB), Y0 = Math.round(y0 * SUB);
  var X1 = Math.round(x1 * SUB), Y1 = Math.round(y1 * SUB);
  var X2 = Math.round(x2 * SUB), Y2 = Math.round(y2 * SUB);
  var area = (X1 - X0) * (Y2 - Y0) - (Y1 - Y0) * (X2 - X0);
  if (area === 0) return;
  if (area < 0) {                                  // приводим к одной ориентации
    var tx = X1; X1 = X2; X2 = tx;
    var ty = Y1; Y1 = Y2; Y2 = ty;
    var tw = w1; w1 = w2; w2 = tw;
    area = -area;
  }
  var minX = X0 < X1 ? (X0 < X2 ? X0 : X2) : (X1 < X2 ? X1 : X2);
  var maxX = X0 > X1 ? (X0 > X2 ? X0 : X2) : (X1 > X2 ? X1 : X2);
  var minY = Y0 < Y1 ? (Y0 < Y2 ? Y0 : Y2) : (Y1 < Y2 ? Y1 : Y2);
  var maxY = Y0 > Y1 ? (Y0 > Y2 ? Y0 : Y2) : (Y1 > Y2 ? Y1 : Y2);
  var px0 = Math.ceil((minX - HALF) / SUB), px1 = Math.floor((maxX - HALF) / SUB);
  var py0 = Math.ceil((minY - HALF) / SUB), py1 = Math.floor((maxY - HALF) / SUB);
  if (px0 < 0) px0 = 0; if (py0 < 0) py0 = 0;
  if (px1 > W - 1) px1 = W - 1; if (py1 > H - 1) py1 = H - 1;
  if (px0 > px1 || py0 > py1) return;

  var d01x = X1 - X0, d01y = Y1 - Y0;
  var d12x = X2 - X1, d12y = Y2 - Y1;
  var d20x = X0 - X2, d20y = Y0 - Y2;
  var b0 = topLeftBias(d01x, d01y);
  var b1 = topLeftBias(d12x, d12y);
  var b2 = topLeftBias(d20x, d20y);

  var PX = px0 * SUB + HALF, PY = py0 * SUB + HALF;
  var r0 = d01x * (PY - Y0) - d01y * (PX - X0);
  var r1 = d12x * (PY - Y1) - d12y * (PX - X1);
  var r2 = d20x * (PY - Y2) - d20y * (PX - X2);
  var s0x = -d01y * SUB, s0y = d01x * SUB;
  var s1x = -d12y * SUB, s1y = d12x * SUB;
  var s2x = -d20y * SUB, s2y = d20x * SUB;

  var ia = 1 / area;
  // вес вершины 0 ~ r1, вершины 1 ~ r2, вершины 2 ~ r0
  var wsx = (s1x * w0 + s2x * w1 + s0x * w2) * ia;

  for (var py = py0; py <= py1; py++) {
    var e0 = r0, e1 = r1, e2 = r2;
    var w = (e1 * w0 + e2 * w1 + e0 * w2) * ia;
    var idx = py * W + px0;
    for (var px = px0; px <= px1; px++) {
      if (e0 >= b0 && e1 >= b1 && e2 >= b2 && w > zb[idx]) {
        zb[idx] = w;
        u32[idx] = color;
      }
      e0 += s0x; e1 += s1x; e2 += s2x; w += wsx; idx++;
    }
    r0 += s0y; r1 += s1y; r2 += s2y;
  }
}

/* Заливка с интерполяцией яркости (Гуро), перспективно-корректной. */
function rasterSmooth(u32, zb, W, H, lut,
                      x0, y0, w0, i0, x1, y1, w1, i1, x2, y2, w2, i2) {
  var X0 = Math.round(x0 * SUB), Y0 = Math.round(y0 * SUB);
  var X1 = Math.round(x1 * SUB), Y1 = Math.round(y1 * SUB);
  var X2 = Math.round(x2 * SUB), Y2 = Math.round(y2 * SUB);
  var area = (X1 - X0) * (Y2 - Y0) - (Y1 - Y0) * (X2 - X0);
  if (area === 0) return;
  if (area < 0) {
    var t;
    t = X1; X1 = X2; X2 = t;
    t = Y1; Y1 = Y2; Y2 = t;
    t = w1; w1 = w2; w2 = t;
    t = i1; i1 = i2; i2 = t;
    area = -area;
  }
  var minX = X0 < X1 ? (X0 < X2 ? X0 : X2) : (X1 < X2 ? X1 : X2);
  var maxX = X0 > X1 ? (X0 > X2 ? X0 : X2) : (X1 > X2 ? X1 : X2);
  var minY = Y0 < Y1 ? (Y0 < Y2 ? Y0 : Y2) : (Y1 < Y2 ? Y1 : Y2);
  var maxY = Y0 > Y1 ? (Y0 > Y2 ? Y0 : Y2) : (Y1 > Y2 ? Y1 : Y2);
  var px0 = Math.ceil((minX - HALF) / SUB), px1 = Math.floor((maxX - HALF) / SUB);
  var py0 = Math.ceil((minY - HALF) / SUB), py1 = Math.floor((maxY - HALF) / SUB);
  if (px0 < 0) px0 = 0; if (py0 < 0) py0 = 0;
  if (px1 > W - 1) px1 = W - 1; if (py1 > H - 1) py1 = H - 1;
  if (px0 > px1 || py0 > py1) return;

  var d01x = X1 - X0, d01y = Y1 - Y0;
  var d12x = X2 - X1, d12y = Y2 - Y1;
  var d20x = X0 - X2, d20y = Y0 - Y2;
  var b0 = topLeftBias(d01x, d01y);
  var b1 = topLeftBias(d12x, d12y);
  var b2 = topLeftBias(d20x, d20y);

  var PX = px0 * SUB + HALF, PY = py0 * SUB + HALF;
  var r0 = d01x * (PY - Y0) - d01y * (PX - X0);
  var r1 = d12x * (PY - Y1) - d12y * (PX - X1);
  var r2 = d20x * (PY - Y2) - d20y * (PX - X2);
  var s0x = -d01y * SUB, s0y = d01x * SUB;
  var s1x = -d12y * SUB, s1y = d12x * SUB;
  var s2x = -d20y * SUB, s2y = d20x * SUB;

  var ia = 1 / area;
  var q0 = i0 * w0, q1 = i1 * w1, q2 = i2 * w2;      // яркость * w
  var wsx = (s1x * w0 + s2x * w1 + s0x * w2) * ia;
  var qsx = (s1x * q0 + s2x * q1 + s0x * q2) * ia;

  for (var py = py0; py <= py1; py++) {
    var e0 = r0, e1 = r1, e2 = r2;
    var w = (e1 * w0 + e2 * w1 + e0 * w2) * ia;
    var q = (e1 * q0 + e2 * q1 + e0 * q2) * ia;
    var idx = py * W + px0;
    for (var px = px0; px <= px1; px++) {
      if (e0 >= b0 && e1 >= b1 && e2 >= b2 && w > zb[idx]) {
        zb[idx] = w;
        var ci = (q / w) * 255 | 0;                  // деление = перспект. коррекция
        u32[idx] = lut[ci < 0 ? 0 : (ci > 255 ? 255 : ci)];
      }
      e0 += s0x; e1 += s1x; e2 += s2x; w += wsx; q += qsx; idx++;
    }
    r0 += s0y; r1 += s1y; r2 += s2y;
  }
}

/* Только глубина — предпроход для каркаса (удаление невидимых линий). */
function rasterDepth(zb, W, H, x0, y0, w0, x1, y1, w1, x2, y2, w2) {
  var X0 = Math.round(x0 * SUB), Y0 = Math.round(y0 * SUB);
  var X1 = Math.round(x1 * SUB), Y1 = Math.round(y1 * SUB);
  var X2 = Math.round(x2 * SUB), Y2 = Math.round(y2 * SUB);
  var area = (X1 - X0) * (Y2 - Y0) - (Y1 - Y0) * (X2 - X0);
  if (area === 0) return;
  if (area < 0) {
    var t;
    t = X1; X1 = X2; X2 = t;
    t = Y1; Y1 = Y2; Y2 = t;
    t = w1; w1 = w2; w2 = t;
    area = -area;
  }
  var minX = X0 < X1 ? (X0 < X2 ? X0 : X2) : (X1 < X2 ? X1 : X2);
  var maxX = X0 > X1 ? (X0 > X2 ? X0 : X2) : (X1 > X2 ? X1 : X2);
  var minY = Y0 < Y1 ? (Y0 < Y2 ? Y0 : Y2) : (Y1 < Y2 ? Y1 : Y2);
  var maxY = Y0 > Y1 ? (Y0 > Y2 ? Y0 : Y2) : (Y1 > Y2 ? Y1 : Y2);
  var px0 = Math.ceil((minX - HALF) / SUB), px1 = Math.floor((maxX - HALF) / SUB);
  var py0 = Math.ceil((minY - HALF) / SUB), py1 = Math.floor((maxY - HALF) / SUB);
  if (px0 < 0) px0 = 0; if (py0 < 0) py0 = 0;
  if (px1 > W - 1) px1 = W - 1; if (py1 > H - 1) py1 = H - 1;
  if (px0 > px1 || py0 > py1) return;

  var d01x = X1 - X0, d01y = Y1 - Y0;
  var d12x = X2 - X1, d12y = Y2 - Y1;
  var d20x = X0 - X2, d20y = Y0 - Y2;
  var b0 = topLeftBias(d01x, d01y);
  var b1 = topLeftBias(d12x, d12y);
  var b2 = topLeftBias(d20x, d20y);

  var PX = px0 * SUB + HALF, PY = py0 * SUB + HALF;
  var r0 = d01x * (PY - Y0) - d01y * (PX - X0);
  var r1 = d12x * (PY - Y1) - d12y * (PX - X1);
  var r2 = d20x * (PY - Y2) - d20y * (PX - X2);
  var s0x = -d01y * SUB, s0y = d01x * SUB;
  var s1x = -d12y * SUB, s1y = d12x * SUB;
  var s2x = -d20y * SUB, s2y = d20x * SUB;

  var ia = 1 / area;
  var wsx = (s1x * w0 + s2x * w1 + s0x * w2) * ia;

  for (var py = py0; py <= py1; py++) {
    var e0 = r0, e1 = r1, e2 = r2;
    var w = (e1 * w0 + e2 * w1 + e0 * w2) * ia;
    var idx = py * W + px0;
    for (var px = px0; px <= px1; px++) {
      if (e0 >= b0 && e1 >= b1 && e2 >= b2 && w > zb[idx]) zb[idx] = w;
      e0 += s0x; e1 += s1x; e2 += s2x; w += wsx; idx++;
    }
    r0 += s0y; r1 += s1y; r2 += s2y;
  }
}

/* Пиксель линии: z-тест + альфа-смешивание. */
function plotPx(u8, zb, W, H, x, y, w, r, g, b, a) {
  if (a <= 0.004 || x < 0 || y < 0 || x >= W || y >= H) return;
  var idx = y * W + x;
  if (w <= zb[idx]) return;
  if (a > 0.5) zb[idx] = w;
  var p = idx * 4, ia = 1 - a;
  u8[p] = u8[p] * ia + r * a;
  u8[p + 1] = u8[p + 1] * ia + g * a;
  u8[p + 2] = u8[p + 2] * ia + b * a;
}

/* Отрезок со сглаживанием и тем же z-буфером (смещение по глубине,
   чтобы ребро побеждало собственную грань, но не побеждало ближние). */
function drawLine(u8, zb, W, H, x0, y0, w0, i0, x1, y1, w1, i1,
                  lutRGB, cr, cg, cb, alpha) {
  var dx = x1 - x0, dy = y1 - y0;
  var adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
  var n = Math.ceil(adx > ady ? adx : ady);
  if (n < 1) n = 1;
  if (n > 6000) return;
  var inv = 1 / n, steep = ady > adx;
  var q0 = i0 * w0, q1 = i1 * w1;
  var r = cr, g = cg, b = cb;
  for (var s = 0; s <= n; s++) {
    var t = s * inv;
    var x = x0 + dx * t, y = y0 + dy * t;
    var w = w0 + (w1 - w0) * t;
    if (lutRGB) {
      var ci = ((q0 + (q1 - q0) * t) / w) * 255 | 0;
      if (ci < 0) ci = 0; else if (ci > 255) ci = 255;
      r = lutRGB[ci * 3]; g = lutRGB[ci * 3 + 1]; b = lutRGB[ci * 3 + 2];
    }
    var wb = w * 1.0035;
    if (steep) {
      var xf = Math.floor(x), fr = x - xf, yi = Math.round(y);
      plotPx(u8, zb, W, H, xf, yi, wb, r, g, b, alpha * (1 - fr));
      plotPx(u8, zb, W, H, xf + 1, yi, wb, r, g, b, alpha * fr);
    } else {
      var yf = Math.floor(y), fr2 = y - yf, xi = Math.round(x);
      plotPx(u8, zb, W, H, xi, yf, wb, r, g, b, alpha * (1 - fr2));
      plotPx(u8, zb, W, H, xi, yf + 1, wb, r, g, b, alpha * fr2);
    }
  }
}

/* ===================== 5. Рендерер ===================== */

var FOCAL = 2.45, LIGHT_R = 2.8, LIGHT_H = 1.9;

function Renderer() {
  this.W = 0; this.H = 0;
  this.buf = null; this.u8 = null; this.u32 = null;
  this.zb = null; this.bg = null;
  this.mat = new Float64Array(9);
  this.vcap = 0; this.tcap = 0;
  this.light = { x: 0, y: 0, r: 0, vis: 0 };
}

Renderer.prototype.setSize = function (w, h) {
  w = Math.max(2, w | 0); h = Math.max(2, h | 0);
  if (w === this.W && h === this.H) return false;
  this.W = w; this.H = h;
  var n = w * h;
  this.buf = new ArrayBuffer(n * 4);
  this.u8 = new Uint8ClampedArray(this.buf);
  this.u32 = new Uint32Array(this.buf);
  this.zb = new Float32Array(n);
  this.bg = new Uint32Array(n);
  return true;
};

/* Фон считается один раз на изменение размера/палитры. */
Renderer.prototype.buildBackground = function (glow) {
  var W = this.W, H = this.H, bg = this.bg;
  var cx = W * 0.5, cy = H * 0.45;
  var R = Math.max(W, H) * 0.66;
  var gr = glow[0], gg = glow[1], gb = glow[2];
  for (var y = 0; y < H; y++) {
    var dy = (y - cy) / R;
    for (var x = 0; x < W; x++) {
      var dx = (x - cx) / R;
      var d = Math.sqrt(dx * dx + dy * dy);
      var t = 1 - (d < 1 ? d : 1); t *= t;
      var vig = 1 - 0.5 * (d < 1.15 ? d / 1.15 : 1);
      var n = ((x * 7 + y * 13) % 3) - 1;            // дизеринг против полос
      var r = (9 + gr * 0.22 * t) * vig + n;
      var g = (10 + gg * 0.22 * t) * vig + n;
      var b = (16 + gb * 0.22 * t) * vig + n;
      bg[y * W + x] = packColor(r < 0 ? 0 : r | 0, g < 0 ? 0 : g | 0, b < 0 ? 0 : b | 0);
    }
  }
};

Renderer.prototype.ensureScratch = function (nv, nt) {
  if (nv > this.vcap) {
    this.vcap = nv;
    this.vx = new Float32Array(nv); this.vy = new Float32Array(nv); this.vz = new Float32Array(nv);
    this.sx = new Float32Array(nv); this.sy = new Float32Array(nv); this.sw = new Float32Array(nv);
    this.vi = new Float32Array(nv);
  }
  if (nt > this.tcap) { this.tcap = nt; this.fi = new Float32Array(nt); }
};

/* S = {mesh, ax, ay, camD, lut, mode:'wire'|'fill'|'both', smooth, lightAz} */
Renderer.prototype.render = function (S) {
  var W = this.W, H = this.H;
  var u32 = this.u32, u8 = this.u8, zb = this.zb;
  u32.set(this.bg);
  zb.fill(0);

  var mesh = S.mesh, nv = mesh.vcount, nt = mesh.tcount;
  this.ensureScratch(nv, nt);
  var vx = this.vx, vy = this.vy, vz = this.vz;
  var sx = this.sx, sy = this.sy, sw = this.sw, vi = this.vi, fi = this.fi;
  var pos = mesh.pos, nrm = mesh.nrm, tris = mesh.tris;

  // R = Ry(ay) * Rx(ax)
  var ca = Math.cos(S.ax), sa = Math.sin(S.ax);
  var cb = Math.cos(S.ay), sb = Math.sin(S.ay);
  var m0 = cb, m1 = sb * sa, m2 = sb * ca;
  var m3 = 0, m4 = ca, m5 = -sa;
  var m6 = -sb, m7 = cb * sa, m8 = cb * ca;

  var D = S.camD;
  var k = 0.5 * (W < H ? W : H) * FOCAL, cx = W * 0.5, cy = H * 0.5;
  _Lx = Math.cos(S.lightAz) * LIGHT_R;
  _Ly = LIGHT_H;
  _Lz = D + Math.sin(S.lightAz) * LIGHT_R;

  var smooth = S.smooth, mode = S.mode, lut = S.lut;
  var i, o;

  /* --- вершинный проход: поворот, камера, перспектива, яркость --- */
  for (i = 0; i < nv; i++) {
    o = i * 3;
    var X = pos[o], Y = pos[o + 1], Z = pos[o + 2];
    var xv = m0 * X + m1 * Y + m2 * Z;
    var yv = m3 * X + m4 * Y + m5 * Z;
    var zv = m6 * X + m7 * Y + m8 * Z + D;
    vx[i] = xv; vy[i] = yv; vz[i] = zv;
    var w = zv > 1e-3 ? 1 / zv : 1e3;
    sw[i] = w; sx[i] = cx + xv * k * w; sy[i] = cy - yv * k * w;
    if (smooth) {
      var nX = nrm[o], nY = nrm[o + 1], nZ = nrm[o + 2];
      vi[i] = shade(xv, yv, zv,
                    m0 * nX + m1 * nY + m2 * nZ,
                    m3 * nX + m4 * nY + m5 * nZ,
                    m6 * nX + m7 * nY + m8 * nZ);
    }
  }

  /* --- граневой проход: отсечение нелицевых + растеризация --- */
  var needAllFaces = (mode !== 'fill') && !smooth;
  var drawn = 0;
  for (var t = 0; t < nt; t++) {
    var a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    var ax0 = vx[a], ay0 = vy[a], az0 = vz[a];
    var e1x = vx[b] - ax0, e1y = vy[b] - ay0, e1z = vz[b] - az0;
    var e2x = vx[c] - ax0, e2y = vy[c] - ay0, e2z = vz[c] - az0;
    var fnx = e1y * e2z - e1z * e2y;
    var fny = e1z * e2x - e1x * e2z;
    var fnz = e1x * e2y - e1y * e2x;
    var ccx = (ax0 + vx[b] + vx[c]) / 3;
    var ccy = (ay0 + vy[b] + vy[c]) / 3;
    var ccz = (az0 + vz[b] + vz[c]) / 3;
    // лицевая, если нормаль смотрит на камеру: dot(N, C - eye) < 0, eye = 0
    var front = (fnx * ccx + fny * ccy + fnz * ccz) < 0;

    if (!smooth && (front || needAllFaces)) {
      var fl = 1 / Math.sqrt(fnx * fnx + fny * fny + fnz * fnz);
      if (!front) fl = -fl;                       // нелицевую освещаем двусторонне
      fi[t] = shade(ccx, ccy, ccz, fnx * fl, fny * fl, fnz * fl);
    }
    if (!front) continue;
    drawn++;

    if (mode === 'wire') {
      rasterDepth(zb, W, H, sx[a], sy[a], sw[a], sx[b], sy[b], sw[b], sx[c], sy[c], sw[c]);
    } else if (smooth) {
      rasterSmooth(u32, zb, W, H, lut.u32,
                   sx[a], sy[a], sw[a], vi[a],
                   sx[b], sy[b], sw[b], vi[b],
                   sx[c], sy[c], sw[c], vi[c]);
    } else {
      var ci = fi[t] * 255 | 0;
      rasterFlat(u32, zb, W, H,
                 sx[a], sy[a], sw[a], sx[b], sy[b], sw[b], sx[c], sy[c], sw[c],
                 lut.u32[ci < 0 ? 0 : (ci > 255 ? 255 : ci)]);
    }
  }

  /* --- рёбра: тот же z-буфер => невидимые линии отсекаются --- */
  if (mode !== 'fill') {
    var wire = mesh.wire, ef = mesh.edgeFaces;
    var wireLut = (mode === 'wire') ? lut.rgb : null;
    var alpha = (mode === 'wire') ? 0.95 : 0.44;
    var dr = lut.rgb[9], dg = lut.rgb[10], db = lut.rgb[11];
    for (i = 0; i < wire.length; i += 2) {
      var p = wire[i], q = wire[i + 1];
      var i0, i1;
      if (smooth) { i0 = vi[p]; i1 = vi[q]; }
      else {
        var f0 = ef[i], f1 = ef[i + 1];
        if (f0 >= 0 && f1 >= 0) i0 = (fi[f0] + fi[f1]) * 0.5;
        else if (f0 >= 0) i0 = fi[f0];
        else if (f1 >= 0) i0 = fi[f1];
        else i0 = 0.15;
        i1 = i0;
      }
      drawLine(u8, zb, W, H,
               sx[p], sy[p], sw[p], i0,
               sx[q], sy[q], sw[q], i1,
               wireLut, dr, dg, db, alpha);
    }
  }

  /* --- маркер источника света (виден, если ближе поверхности) --- */
  var L = this.light;
  L.vis = 0;
  if (_Lz > 0.15) {
    var lw = 1 / _Lz;
    var lx = cx + _Lx * k * lw, ly = cy - _Ly * k * lw;
    if (lx > -60 && ly > -60 && lx < W + 60 && ly < H + 60) {
      var vis = 0, cnt = 0;
      for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
          var qx = (lx + ox * 3) | 0, qy = (ly + oy * 3) | 0;
          if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
          cnt++;
          if (lw > zb[qy * W + qx]) vis++;
        }
      }
      L.x = lx; L.y = ly;
      L.r = Math.min(64, Math.max(7, k * 0.075 * lw));
      L.vis = cnt ? vis / cnt : 0;
    }
  }

  return { drawn: drawn, total: nt, light: L };
};

/* ===================== 6. Сцена в браузере ===================== */

function boot() {
  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  var elFps = document.getElementById('s-fps');
  var elTri = document.getElementById('s-tri');
  var elBuf = document.getElementById('s-buf');
  var elLight = document.getElementById('light');
  var elSpeed = document.getElementById('speed');
  var elPause = document.getElementById('pause');
  var panel = document.getElementById('panel');

  var renderer = new Renderer();
  var meshes = {};
  var palKey = 'copper';
  var lut = buildLUT(PALETTES[palKey].stops);

  var state = {
    model: 'torus',
    mode: 'fill',
    smooth: true,
    ax: 0.56, ay: 0.72,
    camD: 4.4,
    lightAz: 225 * Math.PI / 180,
    speed: 1,
    paused: false
  };

  function mesh() {
    if (!meshes[state.model]) meshes[state.model] = MESH_SPECS[state.model](1.35);
    return meshes[state.model];
  }

  /* ---- размер буфера: бюджет пикселей + адаптация под фактический fps ---- */
  var quality = 1, imgData = null, imgCopy = false;

  function budget() {
    return (state.mode === 'wire' ? 3.2e6 : 2.4e6) * quality;
  }

  function layout() {
    var cw = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 320);
    var ch = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 240);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var s = Math.min(dpr, Math.sqrt(budget() / (cw * ch)));
    if (s < 0.5) s = 0.5;
    var w = Math.round(cw * s), h = Math.round(ch * s);
    if (renderer.setSize(w, h)) {
      canvas.width = renderer.W;
      canvas.height = renderer.H;
      renderer.buildBackground(PALETTES[palKey].glow);
      imgData = null;
      statDirty = true;
    }
  }

  function ensureImage() {
    if (imgData && imgData.width === renderer.W && imgData.height === renderer.H) return;
    try {
      imgData = new ImageData(renderer.u8, renderer.W, renderer.H);
      imgCopy = false;
    } catch (e) {
      imgData = ctx.createImageData(renderer.W, renderer.H);
      imgCopy = true;
    }
  }

  /* ---- элементы управления ---- */
  function setSeg(ctl, value) {
    var grp = panel.querySelector('.grp[data-ctl="' + ctl + '"]');
    if (!grp) return;
    var btns = grp.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-v') === value;
      btns[i].classList.toggle('on', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function apply(ctl, value) {
    if (ctl === 'model') state.model = value;
    else if (ctl === 'mode') { state.mode = value; layout(); }
    else if (ctl === 'shade') state.smooth = (value === 'smooth');
    else if (ctl === 'pal') {
      palKey = value;
      lut = buildLUT(PALETTES[palKey].stops);
      renderer.buildBackground(PALETTES[palKey].glow);
      document.documentElement.style.setProperty('--accent', PALETTES[palKey].accent);
    }
    setSeg(ctl, value);
    statDirty = true;
  }

  panel.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('button[data-v]') : null;
    if (!btn) return;
    var grp = btn.parentNode.parentNode;
    apply(grp.getAttribute('data-ctl'), btn.getAttribute('data-v'));
  });

  elLight.addEventListener('input', function () {
    state.lightAz = (+elLight.value) * Math.PI / 180;
  });
  elSpeed.addEventListener('input', function () {
    state.speed = (+elSpeed.value) / 100;
  });

  function togglePause() {
    state.paused = !state.paused;
    elPause.textContent = state.paused ? 'Продолжить' : 'Пауза';
    elPause.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
  }
  elPause.addEventListener('click', togglePause);

  window.addEventListener('keydown', function (ev) {
    if (ev.code === 'Space') { ev.preventDefault(); togglePause(); }
  });

  /* ---- мышь/тач: поворот и приближение ---- */
  var dragging = false, lastX = 0, lastY = 0, pid = null;
  canvas.addEventListener('pointerdown', function (ev) {
    dragging = true; pid = ev.pointerId;
    lastX = ev.clientX; lastY = ev.clientY;
    canvas.classList.add('drag');
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(pid); } catch (e) {} }
  });
  canvas.addEventListener('pointermove', function (ev) {
    if (!dragging) return;
    var s = 0.0075;
    state.ay += (ev.clientX - lastX) * s;
    state.ax += (ev.clientY - lastY) * s;
    if (state.ax > 1.4) state.ax = 1.4; else if (state.ax < -1.4) state.ax = -1.4;
    lastX = ev.clientX; lastY = ev.clientY;
  });
  function endDrag() { dragging = false; canvas.classList.remove('drag'); }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);

  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var d = ev.deltaY > 0 ? 1.08 : 1 / 1.08;
    state.camD = Math.min(9, Math.max(2.7, state.camD * d));
  }, { passive: false });

  window.addEventListener('resize', function () { layout(); });

  /* ---- цикл ---- */
  var prev = 0, fpsEma = 60, frameEma = 16, adaptCount = 0, statDirty = true, statT = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!prev) prev = now;
    var dt = (now - prev) / 1000;
    prev = now;
    if (dt > 0.05) dt = 0.05;                        // клампим большой шаг
    if (dt < 0) dt = 0;

    if (!state.paused && !dragging) {
      state.ax += 0.19 * state.speed * dt;
      state.ay += 0.31 * state.speed * dt;
      if (state.ax > TAU) state.ax -= TAU;
      if (state.ay > TAU) state.ay -= TAU;
    }

    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var r = renderer.render({
      mesh: mesh(), ax: state.ax, ay: state.ay, camD: state.camD,
      lut: lut, mode: state.mode, smooth: state.smooth, lightAz: state.lightAz
    });
    ensureImage();
    if (imgCopy) imgData.data.set(renderer.u8);
    ctx.putImageData(imgData, 0, 0);

    // ореол источника света
    var L = r.light;
    if (L.vis > 0) {
      var g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
      var a = L.vis;
      g.addColorStop(0, 'rgba(255,252,242,' + (0.95 * a) + ')');
      g.addColorStop(0.22, 'rgba(255,236,200,' + (0.45 * a) + ')');
      g.addColorStop(1, 'rgba(255,196,120,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(L.x, L.y, L.r, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    frameEma += ((t1 - t0) - frameEma) * 0.08;
    if (dt > 0) fpsEma += (1 / dt - fpsEma) * 0.08;

    // адаптация разрешения буфера под нагрузку
    if (++adaptCount >= 45) {
      adaptCount = 0;
      var q = quality;
      if (frameEma > 22 && quality > 0.42) quality *= 0.84;
      else if (frameEma < 11 && quality < 1) quality = Math.min(1, quality * 1.14);
      if (Math.abs(quality - q) > 1e-3) layout();
    }

    statT += dt;
    if (statT > 0.25 || statDirty) {
      statT = 0; statDirty = false;
      elFps.textContent = Math.round(fpsEma);
      elTri.textContent = fmt(r.drawn) + ' / ' + fmt(r.total);
      elBuf.textContent = renderer.W + '×' + renderer.H;
    }
  }

  function fmt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  document.documentElement.style.setProperty('--accent', PALETTES[palKey].accent);
  layout();
  requestAnimationFrame(frame);
}

/* ===================== 7. Экспорт / старт ===================== */

var API = {
  Renderer: Renderer, buildLUT: buildLUT, PALETTES: PALETTES,
  MESH_SPECS: MESH_SPECS, buildTube: buildTube, buildIcosphere: buildIcosphere,
  circleCurve: circleCurve, trefoilCurve: trefoilCurve,
  packColor: packColor, shade: shade, FOCAL: FOCAL,
  setLight: function (x, y, z) { _Lx = x; _Ly = y; _Lz = z; }
};

if (global) global.SOLID3D = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
