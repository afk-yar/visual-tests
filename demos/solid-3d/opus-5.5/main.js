/* 3D-тело (софт-рендер) — Claude Opus 5.5
 *
 * Весь конвейер считается на CPU, без WebGL и без библиотек:
 *
 *   модель (вписана в единичную сферу)
 *     → поворот M = U·Rx(ax)·Ry(ay)       (матрицы 3×3; U — поворот мышью)
 *     → вид: сдвиг на −CAM_D по z          (камера в начале координат, смотрит в −z)
 *     → отсечение нелицевых граней:        грань лицевая, если n·c < 0 (c — центроид в пространстве вида)
 *     → освещение точечным источником:     Ламберт + Блинн-Фонг, затухание P / (1 + k·d²)
 *          плоское — один расчёт на грань (в центроиде по нормали грани)
 *          Гуро    — расчёт в вершинах по сглаженным нормалям, интерполяция по пикселям
 *     → перспективная проекция:            x' = cx + f·x/(−z),  y' = cy − f·y/(−z)
 *     → сортировка граней спереди назад    (ранний отказ по глубине — меньше лишней заливки)
 *     → растеризация по строкам + z-буфер по 1/z (линейна в экранном пространстве → перспективно-корректна)
 *     → ImageData → offscreen-canvas → drawImage на экран.
 *
 * Каркас рисуется в тот же буфер антиалиасными линиями с проверкой по z-буферу:
 * видимые рёбра яркие, закрытые — тусклые (скрытые линии).
 */
(function () {
  'use strict';

  // ═════════════════════════ параметры сцены ═════════════════════════
  const CAM_D = 4.0;             // расстояние от камеры до центра тела (радиус тела = 1)
  const PIX_BUDGET = 2.4e6;      // потолок пикселей внутреннего буфера
  const DEPTH_BIAS = 0.004;      // относительный допуск depth-теста для рёбер каркаса
  const IZ_NEAR = 1 / (CAM_D - 1), IZ_FAR = 1 / (CAM_D + 1);
  const IZ_INV = 1 / (IZ_NEAR - IZ_FAR);

  const LIGHT_COL = [1.0, 0.93, 0.82];     // тёплый белый
  const LIGHT_POWER = 1.8;
  const LIGHT_K = 0.1;                     // затухание 1 / (1 + k·d²)
  const LIGHT_ORBIT = 1.8;                 // радиус орбиты источника вокруг тела
  const AMB_SKY = [0.1, 0.125, 0.2];       // полусферический «фон»: сверху холодный
  const AMB_GND = [0.07, 0.05, 0.04];      // снизу тёплый и тёмный

  // ═════════════════ тон-маппинг: линейный свет → sRGB (таблица) ═════════════════
  const LUT_SCALE = 1024, LUT_SIZE = 4096, LUT_MAX = LUT_SIZE - 1;
  const LUT = new Uint8Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const x = (i / LUT_SCALE) * 0.9;                                    // экспозиция
    let t = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);   // ACES (аппроксимация)
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    LUT[i] = Math.round(255 * Math.pow(t, 1 / 2.2));
  }
  const lin = (c) => Math.pow(c / 255, 2.2);

  // ═════════════════════════ геометрия ═════════════════════════
  /* pos   — координаты вершин (xyz подряд)
   * hints — для каждой вершины «внутренняя» точка (центр трубки / центр сферы):
   *         по ней ориентируем все грани наружу, не полагаясь на ручной порядок обхода
   * tris  — индексы треугольников, wire — рёбра каркаса (без диагоналей квадов) */
  function finalizeMesh(pos, hints, tris, wire) {
    const nv = pos.length / 3, nt = tris.length / 3, ne = wire.length / 2;

    // вписываем в единичную сферу
    let maxR = 0;
    for (let k = 0; k < pos.length; k += 3) {
      const r = Math.sqrt(pos[k] * pos[k] + pos[k + 1] * pos[k + 1] + pos[k + 2] * pos[k + 2]);
      if (r > maxR) maxR = r;
    }
    const s = 1 / maxR;
    for (let k = 0; k < pos.length; k++) { pos[k] *= s; hints[k] *= s; }

    const fn = new Float64Array(nt * 3);   // нормали граней
    const fc = new Float64Array(nt * 3);   // центроиды граней
    const fd = new Float64Array(nt);       // n·c — для дешёвого теста лицевости
    const vn = new Float64Array(nv * 3);   // сглаженные нормали вершин

    for (let t = 0; t < nt; t++) {
      const k = 3 * t;
      const a = tris[k], b = tris[k + 1], c = tris[k + 2];
      const A = 3 * a, B = 3 * b, C = 3 * c;
      const e1x = pos[B] - pos[A], e1y = pos[B + 1] - pos[A + 1], e1z = pos[B + 2] - pos[A + 2];
      const e2x = pos[C] - pos[A], e2y = pos[C + 1] - pos[A + 1], e2z = pos[C + 2] - pos[A + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const mx = (pos[A] + pos[B] + pos[C]) / 3;
      const my = (pos[A + 1] + pos[B + 1] + pos[C + 1]) / 3;
      const mz = (pos[A + 2] + pos[B + 2] + pos[C + 2]) / 3;
      const ox = mx - (hints[A] + hints[B] + hints[C]) / 3;
      const oy = my - (hints[A + 1] + hints[B + 1] + hints[C + 1]) / 3;
      const oz = mz - (hints[A + 2] + hints[B + 2] + hints[C + 2]) / 3;
      if (nx * ox + ny * oy + nz * oz < 0) {        // нормаль смотрит внутрь — меняем обход
        tris[k + 1] = c; tris[k + 2] = b;
        nx = -nx; ny = -ny; nz = -nz;
      }
      // ненормированная нормаль ∝ площади — взвешенное усреднение в вершинах
      vn[A] += nx; vn[A + 1] += ny; vn[A + 2] += nz;
      vn[B] += nx; vn[B + 1] += ny; vn[B + 2] += nz;
      vn[C] += nx; vn[C + 1] += ny; vn[C + 2] += nz;
      const il = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      fn[k] = nx * il; fn[k + 1] = ny * il; fn[k + 2] = nz * il;
      fc[k] = mx; fc[k + 1] = my; fc[k + 2] = mz;
      fd[t] = fn[k] * mx + fn[k + 1] * my + fn[k + 2] * mz;
    }
    for (let k = 0; k < vn.length; k += 3) {
      const il = 1 / (Math.sqrt(vn[k] * vn[k] + vn[k + 1] * vn[k + 1] + vn[k + 2] * vn[k + 2]) || 1);
      vn[k] *= il; vn[k + 1] *= il; vn[k + 2] *= il;
    }

    // смежность «ребро каркаса → две грани» (для отсечения рёбер в режиме каркаса)
    const map = new Map();
    const ekey = (u, v) => (u < v ? u * 65536 + v : v * 65536 + u);
    for (let t = 0; t < nt; t++) {
      const k = 3 * t;
      for (let e = 0; e < 3; e++) {
        const key = ekey(tris[k + e], tris[k + (e + 1) % 3]);
        const list = map.get(key);
        if (list) list.push(t); else map.set(key, [t]);
      }
    }
    const edgeF = new Int32Array(ne * 2).fill(-1);
    for (let e = 0; e < ne; e++) {
      const list = map.get(ekey(wire[2 * e], wire[2 * e + 1]));
      if (list) {
        edgeF[2 * e] = list[0];
        if (list.length > 1) edgeF[2 * e + 1] = list[1];
      }
    }
    return { nv, nt, ne, pos, tris, wire, fn, fc, fd, vn, edgeF };
  }

  // сетка nu×nv, замкнутая по обоим направлениям (тор, трубка узла)
  function gridTopology(pos, hints, nu, nv) {
    const tris = new Uint32Array(nu * nv * 6);
    const wire = new Uint32Array(nu * nv * 4);
    let t = 0, w = 0;
    for (let i = 0; i < nu; i++) {
      const i1 = (i + 1) % nu;
      for (let j = 0; j < nv; j++) {
        const j1 = (j + 1) % nv;
        const a = i * nv + j, b = i1 * nv + j, c = i1 * nv + j1, d = i * nv + j1;
        tris[t++] = a; tris[t++] = b; tris[t++] = c;
        tris[t++] = a; tris[t++] = c; tris[t++] = d;
        wire[w++] = a; wire[w++] = b;
        wire[w++] = a; wire[w++] = d;
      }
    }
    return finalizeMesh(pos, hints, tris, wire);
  }

  function buildTorus(R, r, nu, nv) {
    const n = nu * nv;
    const pos = new Float64Array(n * 3), hints = new Float64Array(n * 3);
    for (let i = 0; i < nu; i++) {
      const u = (i / nu) * Math.PI * 2, cu = Math.cos(u), su = Math.sin(u);
      for (let j = 0; j < nv; j++) {
        const v = (j / nv) * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v);
        const k = (i * nv + j) * 3;
        pos[k] = (R + r * cv) * cu; pos[k + 1] = (R + r * cv) * su; pos[k + 2] = r * sv;
        hints[k] = R * cu; hints[k + 1] = R * su; hints[k + 2] = 0;
      }
    }
    return gridTopology(pos, hints, nu, nv);
  }

  // торический узел (p,q): трубка вокруг кривой, репер «T, (P+Q), B»
  function buildKnot(p, q, nu, nv, tube) {
    const n = nu * nv;
    const pos = new Float64Array(n * 3), hints = new Float64Array(n * 3);
    const P = [0, 0, 0], Q = [0, 0, 0];
    const curve = (u, o) => {
      const qu = (q / p) * u, rr = (2 + Math.cos(qu)) * 0.5;
      o[0] = rr * Math.cos(u); o[1] = rr * Math.sin(u); o[2] = Math.sin(qu) * 0.5;
    };
    for (let i = 0; i < nu; i++) {
      const u = (i / nu) * p * Math.PI * 2;
      curve(u, P); curve(u + 0.01, Q);
      const Tx = Q[0] - P[0], Ty = Q[1] - P[1], Tz = Q[2] - P[2];
      let Nx = Q[0] + P[0], Ny = Q[1] + P[1], Nz = Q[2] + P[2];
      let Bx = Ty * Nz - Tz * Ny, By = Tz * Nx - Tx * Nz, Bz = Tx * Ny - Ty * Nx;
      Nx = By * Tz - Bz * Ty; Ny = Bz * Tx - Bx * Tz; Nz = Bx * Ty - By * Tx;
      const ib = 1 / Math.sqrt(Bx * Bx + By * By + Bz * Bz);
      const inn = 1 / Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz);
      Bx *= ib; By *= ib; Bz *= ib; Nx *= inn; Ny *= inn; Nz *= inn;
      for (let j = 0; j < nv; j++) {
        const v = (j / nv) * Math.PI * 2;
        const cx = -tube * Math.cos(v), cy = tube * Math.sin(v);
        const k = (i * nv + j) * 3;
        pos[k] = P[0] + cx * Nx + cy * Bx;
        pos[k + 1] = P[1] + cx * Ny + cy * By;
        pos[k + 2] = P[2] + cx * Nz + cy * Bz;
        hints[k] = P[0]; hints[k + 1] = P[1]; hints[k + 2] = P[2];
      }
    }
    return gridTopology(pos, hints, nu, nv);
  }

  // икосфера: икосаэдр, level раз делим грани на 4 и выталкиваем на сферу
  function buildIcosphere(level) {
    const g = (1 + Math.sqrt(5)) / 2;
    const V = [];
    const add = (x, y, z) => {
      const l = Math.sqrt(x * x + y * y + z * z);
      V.push(x / l, y / l, z / l);
      return V.length / 3 - 1;
    };
    [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g],
     [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]]
      .forEach((p) => add(p[0], p[1], p[2]));
    let F = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
      3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
    for (let l = 0; l < level; l++) {
      const cache = new Map();
      const mid = (a, b) => {
        const key = a < b ? a * 100000 + b : b * 100000 + a;
        let m = cache.get(key);
        if (m === undefined) {
          m = add((V[3 * a] + V[3 * b]) / 2, (V[3 * a + 1] + V[3 * b + 1]) / 2, (V[3 * a + 2] + V[3 * b + 2]) / 2);
          cache.set(key, m);
        }
        return m;
      };
      const NF = [];
      for (let i = 0; i < F.length; i += 3) {
        const a = F[i], b = F[i + 1], c = F[i + 2];
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        NF.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
      }
      F = NF;
    }
    const seen = new Set(), W = [];
    for (let i = 0; i < F.length; i += 3) {
      for (let e = 0; e < 3; e++) {
        const u = F[i + e], v = F[i + (e + 1) % 3];
        const key = u < v ? u * 65536 + v : v * 65536 + u;
        if (!seen.has(key)) { seen.add(key); W.push(u, v); }
      }
    }
    return finalizeMesh(new Float64Array(V), new Float64Array(V.length), new Uint32Array(F), new Uint32Array(W));
  }

  const OBJECTS = {
    torus:  { label: 'Тор',        make: () => buildTorus(1, 0.42, 64, 28),    albedo: [238, 118, 70],  ks: 0.5,  shin: 26 },
    knot:   { label: 'Узел (2,3)', make: () => buildKnot(2, 3, 200, 16, 0.27), albedo: [64, 200, 182],  ks: 0.55, shin: 22 },
    sphere: { label: 'Икосфера',   make: () => buildIcosphere(3),               albedo: [196, 190, 178], ks: 0.5,  shin: 30 },
  };

  // ═════════════════════════ состояние ═════════════════════════
  const state = { mode: 'fill', shading: 'gouraud', obj: 'torus', cull: true, speed: 1, paused: false };

  let mesh = null, objDef = null;
  const MAT = { r: 1, g: 1, b: 1, ks: 0.5, shin: 24 };
  // рабочие массивы под текущий меш
  let VX, VY, VZ, SX, SY, IZ, CR, CG, CB, FRONT, FCOL, KEYS;

  function useObject(key) {
    objDef = OBJECTS[key];
    if (!objDef.mesh) objDef.mesh = objDef.make();
    mesh = objDef.mesh;
    MAT.r = lin(objDef.albedo[0]); MAT.g = lin(objDef.albedo[1]); MAT.b = lin(objDef.albedo[2]);
    MAT.ks = objDef.ks; MAT.shin = objDef.shin;
    const nv = mesh.nv, nt = mesh.nt;
    VX = new Float64Array(nv); VY = new Float64Array(nv); VZ = new Float64Array(nv);
    SX = new Float64Array(nv); SY = new Float64Array(nv); IZ = new Float64Array(nv);
    CR = new Float64Array(nv); CG = new Float64Array(nv); CB = new Float64Array(nv);
    FRONT = new Uint8Array(nt); FCOL = new Int32Array(nt); KEYS = new Float64Array(nt);
  }

  // ═════════════════════════ буферы и раскладка ═════════════════════════
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');
  const panel = document.getElementById('panel');
  const hud = document.getElementById('hud');

  let BW = 0, BH = 0, IMG = null, PX = null, ZB = null;
  const BOX = new Int32Array(4);      // что нарисовано в этом кадре (x0,y0,x1,y1)
  const PREV = new Int32Array(4);     // что было нарисовано в прошлом кадре
  let SS = 1;                         // пикселей буфера на CSS-пиксель
  let BC = 0, FB = 1;                 // центр буфера и фокусное расстояние (в пикселях буфера)
  let DPR = 1, lastDpr = 0;
  let DEST_X = 0, DEST_Y = 0, DEST_S = 1, R_CSS = 100;

  function allocBuffer(side) {
    BW = BH = side;
    off.width = side; off.height = side;
    IMG = octx.createImageData(side, side);
    PX = new Uint32Array(IMG.data.buffer);
    ZB = new Float32Array(side * side);
    PREV[0] = side; PREV[1] = side; PREV[2] = 0; PREV[3] = 0;
  }

  function layout() {
    const W = window.innerWidth, H = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    lastDpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(W * DPR));
    canvas.height = Math.max(1, Math.round(H * DPR));

    const pr = panel.getBoundingClientRect();
    const hr = hud.getBoundingClientRect();
    const narrow = W < 760;
    const top = narrow ? hr.bottom + 8 : 18;
    const bottom = (pr.top > 0 ? pr.top : H) - 12;
    const availH = Math.max(140, bottom - top);
    R_CSS = Math.max(60, Math.min(W * 0.5 - 16, availH * 0.5) * 0.92);
    const cxCss = W / 2, cyCss = top + availH / 2;

    const halfCss = R_CSS + 4;                 // запас под толщину линий каркаса
    const ss = Math.min(2, Math.sqrt(PIX_BUDGET) / (2 * halfCss));
    const side = Math.ceil(2 * halfCss * ss);
    if (side !== BW) allocBuffer(side);
    SS = ss;
    BC = side / 2;
    FB = R_CSS * ss * Math.sqrt(CAM_D * CAM_D - 1);   // проекция единичной сферы = R_CSS
    DEST_S = (side * DPR) / ss;
    DEST_X = Math.round(cxCss * DPR - DEST_S / 2);
    DEST_Y = Math.round(cyCss * DPR - DEST_S / 2);
  }

  function clearBox(b) {
    const x0 = Math.max(0, b[0]), y0 = Math.max(0, b[1]);
    const x1 = Math.min(BW, b[2]), y1 = Math.min(BH, b[3]);
    if (x1 <= x0 || y1 <= y0) return;
    for (let y = y0; y < y1; y++) {
      const o = y * BW;
      PX.fill(0, o + x0, o + x1);
      ZB.fill(0, o + x0, o + x1);
    }
  }

  // ═════════════════════════ освещение ═════════════════════════
  const LP = new Float64Array(3);    // позиция источника (пространство вида)
  const SH = new Float64Array(3);    // результат shade() — линейный RGB

  function shade(px, py, pz, nx, ny, nz) {
    let lx = LP[0] - px, ly = LP[1] - py, lz = LP[2] - pz;
    const d2 = lx * lx + ly * ly + lz * lz;
    const il = 1 / Math.sqrt(d2);
    lx *= il; ly *= il; lz *= il;
    const ndl = nx * lx + ny * ly + nz * lz;
    let diff = 0, spec = 0;
    if (ndl > 0) {
      const att = LIGHT_POWER / (1 + LIGHT_K * d2);
      diff = ndl * att;
      const iv = 1 / Math.sqrt(px * px + py * py + pz * pz);   // на камеру: −p/|p|
      const hx = lx - px * iv, hy = ly - py * iv, hz = lz - pz * iv;
      const ndh = (nx * hx + ny * hy + nz * hz) / Math.sqrt(hx * hx + hy * hy + hz * hz);
      if (ndh > 0) spec = Math.pow(ndh, MAT.shin) * MAT.ks * att * (ndl < 0.25 ? ndl * 4 : 1);
    }
    const h = 0.5 + 0.5 * ny;
    SH[0] = MAT.r * (AMB_GND[0] + (AMB_SKY[0] - AMB_GND[0]) * h + LIGHT_COL[0] * diff) + LIGHT_COL[0] * spec;
    SH[1] = MAT.g * (AMB_GND[1] + (AMB_SKY[1] - AMB_GND[1]) * h + LIGHT_COL[1] * diff) + LIGHT_COL[1] * spec;
    SH[2] = MAT.b * (AMB_GND[2] + (AMB_SKY[2] - AMB_GND[2]) * h + LIGHT_COL[2] * diff) + LIGHT_COL[2] * spec;
  }

  function packSH() {
    let r = (SH[0] * LUT_SCALE) | 0, g = (SH[1] * LUT_SCALE) | 0, b = (SH[2] * LUT_SCALE) | 0;
    if (r > LUT_MAX) r = LUT_MAX; if (g > LUT_MAX) g = LUT_MAX; if (b > LUT_MAX) b = LUT_MAX;
    return 0xFF000000 | (LUT[b] << 16) | (LUT[g] << 8) | LUT[r];
  }

  // ═════════════════════════ растеризатор ═════════════════════════
  /* kind: 0 — только глубина, 1 — плоская заливка цветом flatCol, 2 — Гуро.
   * Атрибуты — плоскостные градиенты по экрану; для Гуро интерполируем c·(1/z) и 1/z
   * и делим попиксельно (перспективно-корректно). Правило заполнения — «центр пикселя
   * в [left, right)» и «строка в [top, bottom)»: общие рёбра без щелей и без двойной заливки. */
  function rasterTri(a, b, c, kind, flatCol) {
    const x0 = SX[a], y0 = SY[a], x1 = SX[b], y1 = SY[b], x2 = SX[c], y2 = SY[c];
    const dx1 = x1 - x0, dy1 = y1 - y0, dx2 = x2 - x0, dy2 = y2 - y0;
    const det = dx1 * dy2 - dx2 * dy1;
    if (det > -1e-12 && det < 1e-12) return 0;
    const id = 1 / det;
    const z0 = IZ[a], z1 = IZ[b], z2 = IZ[c];
    const zdx = ((z1 - z0) * dy2 - (z2 - z0) * dy1) * id;
    const zdy = ((z2 - z0) * dx1 - (z1 - z0) * dx2) * id;

    // сортировка вершин по y (только для обхода строк)
    let tx = x0, ty = y0, mx = x1, my = y1, bx = x2, by = y2, s;
    if (ty > my) { s = tx; tx = mx; mx = s; s = ty; ty = my; my = s; }
    if (my > by) { s = mx; mx = bx; bx = s; s = my; my = by; by = s; }
    if (ty > my) { s = tx; tx = mx; mx = s; s = ty; ty = my; my = s; }

    const W = BW;
    let yS = Math.ceil(ty - 0.5), yE = Math.ceil(by - 0.5);
    if (yS < 0) yS = 0;
    if (yE > BH) yE = BH;
    if (yS >= yE) return 0;

    let minX = tx < mx ? tx : mx; if (bx < minX) minX = bx;
    let maxX = tx > mx ? tx : mx; if (bx > maxX) maxX = bx;
    minX = Math.floor(minX); maxX = Math.ceil(maxX) + 1;
    if (minX < BOX[0]) BOX[0] = minX;
    if (maxX > BOX[2]) BOX[2] = maxX;
    if (yS < BOX[1]) BOX[1] = yS;
    if (yE > BOX[3]) BOX[3] = yE;

    const sL = (bx - tx) / (by - ty);
    const sT = my > ty ? (mx - tx) / (my - ty) : 0;
    const sB = by > my ? (bx - mx) / (by - my) : 0;

    let r0 = 0, g0 = 0, b0 = 0, rdx = 0, rdy = 0, gdx = 0, gdy = 0, bdx = 0, bdy = 0;
    if (kind === 2) {
      const ra = CR[a] * z0, rb = CR[b] * z1, rc = CR[c] * z2;
      const ga = CG[a] * z0, gb = CG[b] * z1, gc = CG[c] * z2;
      const ba = CB[a] * z0, bb = CB[b] * z1, bc = CB[c] * z2;
      rdx = ((rb - ra) * dy2 - (rc - ra) * dy1) * id; rdy = ((rc - ra) * dx1 - (rb - ra) * dx2) * id;
      gdx = ((gb - ga) * dy2 - (gc - ga) * dy1) * id; gdy = ((gc - ga) * dx1 - (gb - ga) * dx2) * id;
      bdx = ((bb - ba) * dy2 - (bc - ba) * dy1) * id; bdy = ((bc - ba) * dx1 - (bb - ba) * dx2) * id;
      r0 = ra; g0 = ga; b0 = ba;
    }

    const zbuf = ZB, pix = PX, lut = LUT;
    let count = 0;
    for (let y = yS; y < yE; y++) {
      const py = y + 0.5;
      const xl = tx + (py - ty) * sL;
      const xr = py < my ? tx + (py - ty) * sT : mx + (py - my) * sB;
      let xa, xb;
      if (xl < xr) { xa = Math.ceil(xl - 0.5); xb = Math.ceil(xr - 0.5); }
      else { xa = Math.ceil(xr - 0.5); xb = Math.ceil(xl - 0.5); }
      if (xa < 0) xa = 0;
      if (xb > W) xb = W;
      if (xa >= xb) continue;
      count += xb - xa;
      const fx = xa + 0.5 - x0, fy = py - y0;
      let z = z0 + zdx * fx + zdy * fy;
      let i = y * W + xa;
      const end = y * W + xb;
      if (kind === 0) {
        for (; i < end; i++, z += zdx) if (z > zbuf[i]) zbuf[i] = z;
      } else if (kind === 1) {
        for (; i < end; i++, z += zdx) if (z > zbuf[i]) { zbuf[i] = z; pix[i] = flatCol; }
      } else {
        let r = r0 + rdx * fx + rdy * fy, g = g0 + gdx * fx + gdy * fy, bl = b0 + bdx * fx + bdy * fy;
        for (; i < end; i++) {
          if (z > zbuf[i]) {
            zbuf[i] = z;
            const w = 1 / z;
            let ri = (r * w) | 0, gi = (g * w) | 0, bi = (bl * w) | 0;
            if (ri > LUT_MAX) ri = LUT_MAX; else if (ri < 0) ri = 0;
            if (gi > LUT_MAX) gi = LUT_MAX; else if (gi < 0) gi = 0;
            if (bi > LUT_MAX) bi = LUT_MAX; else if (bi < 0) bi = 0;
            pix[i] = 0xFF000000 | (lut[bi] << 16) | (lut[gi] << 8) | lut[ri];
          }
          z += zdx; r += rdx; g += gdx; bl += bdx;
        }
      }
    }
    return count;
  }

  // смешивание «поверх» в непремультиплицированный RGBA
  function blend(i, r, g, b, a) {
    const d = PX[i];
    const da = (d >>> 24) * (1 / 255);
    if (da <= 0) {
      PX[i] = (((a * 255 + 0.5) | 0) << 24) | (b << 16) | (g << 8) | r;
      return;
    }
    const k = da * (1 - a);
    const oa = a + k, inv = 1 / oa;
    const nr = (r * a + (d & 255) * k) * inv;
    const ng = (g * a + ((d >>> 8) & 255) * k) * inv;
    const nb = (b * a + ((d >>> 16) & 255) * k) * inv;
    PX[i] = (((oa * 255 + 0.5) | 0) << 24) | (((nb + 0.5) | 0) << 16) | (((ng + 0.5) | 0) << 8) | ((nr + 0.5) | 0);
  }

  // стиль линий каркаса
  let LS_HW = 1, LS_AV = 1, LS_AH = 0, LS_CUE = false;
  let LS_VR = 0, LS_VG = 0, LS_VB = 0, LS_HR = 0, LS_HG = 0, LS_HB = 0;

  /* Антиалиасная линия заданной толщины (обобщённый Ву) с depth-тестом по z-буферу.
   * Глубина 1/z линейно интерполируется вдоль ребра; тест — по пикселю под центром линии. */
  function drawLine(x0, y0, z0, x1, y1, z1) {
    const W = BW, H = BH, zbuf = ZB;
    const pad = LS_HW * 1.5 + 2;
    const bx0 = Math.floor((x0 < x1 ? x0 : x1) - pad), bx1 = Math.ceil((x0 > x1 ? x0 : x1) + pad);
    const by0 = Math.floor((y0 < y1 ? y0 : y1) - pad), by1 = Math.ceil((y0 > y1 ? y0 : y1) + pad);
    if (bx0 < BOX[0]) BOX[0] = bx0;
    if (by0 < BOX[1]) BOX[1] = by0;
    if (bx1 > BOX[2]) BOX[2] = bx1;
    if (by1 > BOX[3]) BOX[3] = by1;

    x0 -= 0.5; y0 -= 0.5; x1 -= 0.5; y1 -= 0.5;          // центры пикселей → целые координаты
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    let t;
    if (steep) { t = x0; x0 = y0; y0 = t; t = x1; x1 = y1; y1 = t; }
    if (x0 > x1) { t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; t = z0; z0 = z1; z1 = t; }
    const dx = x1 - x0;
    const grad = dx > 1e-9 ? (y1 - y0) / dx : 0;
    const zg = dx > 1e-9 ? (z1 - z0) / dx : 0;
    const hwv = LS_HW * Math.sqrt(1 + grad * grad);        // полутолщина по вертикали
    const covMax = hwv * 2 < 1 ? hwv * 2 : 1;
    const reach = Math.ceil(hwv + 0.5);
    const xs = Math.round(x0), xe = Math.round(x1);
    for (let x = xs; x <= xe; x++) {
      const u = x - x0;
      const yc = y0 + grad * u, z = z0 + zg * u;
      const yi = Math.round(yc);
      const sx = steep ? yi : x, sy = steep ? x : yi;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const zb = zbuf[sy * W + sx];
      const vis = zb === 0 || z * (1 + DEPTH_BIAS) >= zb;
      let a = vis ? LS_AV : LS_AH;
      if (a <= 0) continue;
      if (LS_CUE) {
        let c = (z - IZ_FAR) * IZ_INV;
        c = c < 0 ? 0 : c > 1 ? 1 : c;
        a *= vis ? 0.35 + 0.65 * c : 0.6 + 0.4 * c;
      }
      const r = vis ? LS_VR : LS_HR, g = vis ? LS_VG : LS_HG, b = vis ? LS_VB : LS_HB;
      for (let k = yi - reach; k <= yi + reach; k++) {
        let cov = hwv + 0.5 - Math.abs(k - yc);
        if (cov <= 0) continue;
        if (cov > covMax) cov = covMax;
        const qx = steep ? k : x, qy = steep ? x : k;
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        blend(qy * W + qx, r, g, b, a * cov);
      }
    }
  }

  // ═════════════════════════ кадр ═════════════════════════
  const M = new Float64Array(9);
  const U = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const RX = new Float64Array(9), RY = new Float64Array(9), TMP = new Float64Array(9);

  function setRx(o, a) {
    const c = Math.cos(a), s = Math.sin(a);
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = c; o[5] = -s; o[6] = 0; o[7] = s; o[8] = c;
  }
  function setRy(o, a) {
    const c = Math.cos(a), s = Math.sin(a);
    o[0] = c; o[1] = 0; o[2] = s; o[3] = 0; o[4] = 1; o[5] = 0; o[6] = -s; o[7] = 0; o[8] = c;
  }
  function mul3(A, B, O) {        // O = A·B (O может совпадать с A или B)
    const a0 = A[0], a1 = A[1], a2 = A[2], a3 = A[3], a4 = A[4], a5 = A[5], a6 = A[6], a7 = A[7], a8 = A[8];
    const b0 = B[0], b1 = B[1], b2 = B[2], b3 = B[3], b4 = B[4], b5 = B[5], b6 = B[6], b7 = B[7], b8 = B[8];
    O[0] = a0 * b0 + a1 * b3 + a2 * b6; O[1] = a0 * b1 + a1 * b4 + a2 * b7; O[2] = a0 * b2 + a1 * b5 + a2 * b8;
    O[3] = a3 * b0 + a4 * b3 + a5 * b6; O[4] = a3 * b1 + a4 * b4 + a5 * b7; O[5] = a3 * b2 + a4 * b5 + a5 * b8;
    O[6] = a6 * b0 + a7 * b3 + a8 * b6; O[7] = a6 * b1 + a7 * b4 + a8 * b7; O[8] = a6 * b2 + a7 * b5 + a8 * b8;
  }
  function orthonormalize(R) {    // Грам — Шмидт по строкам, чтобы накопленный поворот не «поплыл»
    let l = Math.hypot(R[0], R[1], R[2]);
    R[0] /= l; R[1] /= l; R[2] /= l;
    const d = R[3] * R[0] + R[4] * R[1] + R[5] * R[2];
    R[3] -= d * R[0]; R[4] -= d * R[1]; R[5] -= d * R[2];
    l = Math.hypot(R[3], R[4], R[5]);
    R[3] /= l; R[4] /= l; R[5] /= l;
    R[6] = R[1] * R[5] - R[2] * R[4];
    R[7] = R[2] * R[3] - R[0] * R[5];
    R[8] = R[0] * R[4] - R[1] * R[3];
  }
  function rotateUser(yaw, pitch) {
    setRx(RX, pitch); mul3(RX, U, U);
    setRy(RY, yaw); mul3(RY, U, U);
    orthonormalize(U);
  }

  const stat = { nt: 0, front: 0, draw: 0, pixels: 0 };

  function renderScene() {
    const m = mesh;
    const pos = m.pos, vn = m.vn, fn = m.fn, fc = m.fc, fd = m.fd, tris = m.tris;
    const nv = m.nv, nt = m.nt;
    const m0 = M[0], m1 = M[1], m2 = M[2], m3 = M[3], m4 = M[4], m5 = M[5], m6 = M[6], m7 = M[7], m8 = M[8];
    const F = FB, C = BC, D = CAM_D;

    // 1) вершины: модель → вид → экран (перспективное деление)
    for (let i = 0, k = 0; i < nv; i++, k += 3) {
      const x = pos[k], y = pos[k + 1], z = pos[k + 2];
      const vx = m0 * x + m1 * y + m2 * z;
      const vy = m3 * x + m4 * y + m5 * z;
      const vz = m6 * x + m7 * y + m8 * z - D;
      VX[i] = vx; VY[i] = vy; VZ[i] = vz;
      const iz = -1 / vz;
      IZ[i] = iz;
      SX[i] = C + F * vx * iz;
      SY[i] = C - F * vy * iz;
    }

    // 2) отсечение нелицевых: n'·c' = n·c − D·n'z  (поворот сохраняет скалярное произведение)
    //    + ключи сортировки спереди назад: (дальность × 65536 + индекс грани)
    const cull = state.cull;
    const zMin = -D - 1;
    let nDraw = 0, nFront = 0;
    for (let t = 0, k = 0; t < nt; t++, k += 3) {
      const nzv = m6 * fn[k] + m7 * fn[k + 1] + m8 * fn[k + 2];
      const front = fd[t] - D * nzv < 0;
      FRONT[t] = front ? 1 : 0;
      if (front) nFront++;
      if (front || !cull) {
        const cz = m6 * fc[k] + m7 * fc[k + 1] + m8 * fc[k + 2] - D;
        const q = Math.round((cz - zMin) * 8000);    // 0…16000, больше — ближе
        KEYS[nDraw++] = (20000 - q) * 65536 + t;
      }
    }
    const keys = KEYS.subarray(0, nDraw);
    keys.sort();

    // 3) освещение
    const fill = state.mode !== 'wire';
    const smooth = state.shading === 'gouraud';
    if (fill && smooth) {
      for (let i = 0, k = 0; i < nv; i++, k += 3) {
        const nx = m0 * vn[k] + m1 * vn[k + 1] + m2 * vn[k + 2];
        const ny = m3 * vn[k] + m4 * vn[k + 1] + m5 * vn[k + 2];
        const nz = m6 * vn[k] + m7 * vn[k + 1] + m8 * vn[k + 2];
        shade(VX[i], VY[i], VZ[i], nx, ny, nz);
        CR[i] = SH[0] * LUT_SCALE; CG[i] = SH[1] * LUT_SCALE; CB[i] = SH[2] * LUT_SCALE;
      }
    } else if (fill) {
      for (let s = 0; s < nDraw; s++) {
        const t = keys[s] & 0xFFFF, k = 3 * t;
        const nx = m0 * fn[k] + m1 * fn[k + 1] + m2 * fn[k + 2];
        const ny = m3 * fn[k] + m4 * fn[k + 1] + m5 * fn[k + 2];
        const nz = m6 * fn[k] + m7 * fn[k + 1] + m8 * fn[k + 2];
        const cx = m0 * fc[k] + m1 * fc[k + 1] + m2 * fc[k + 2];
        const cy = m3 * fc[k] + m4 * fc[k + 1] + m5 * fc[k + 2];
        const cz = m6 * fc[k] + m7 * fc[k + 1] + m8 * fc[k + 2] - D;
        shade(cx, cy, cz, nx, ny, nz);
        FCOL[t] = packSH();
      }
    }

    // 4) растеризация с z-буфером
    clearBox(PREV);
    BOX[0] = BW; BOX[1] = BH; BOX[2] = 0; BOX[3] = 0;
    const kind = !fill ? 0 : smooth ? 2 : 1;
    let pixels = 0;
    for (let s = 0; s < nDraw; s++) {
      const t = keys[s] & 0xFFFF, k = 3 * t;
      pixels += rasterTri(tris[k], tris[k + 1], tris[k + 2], kind, FCOL[t]);
    }

    // 5) каркас поверх, с тестом по тому же z-буферу
    if (state.mode !== 'fill') {
      if (state.mode === 'wire') {
        LS_HW = 0.55 * SS; LS_AV = 1; LS_AH = 0.26; LS_CUE = true;
        LS_VR = 150; LS_VG = 222; LS_VB = 255;
        LS_HR = 120; LS_HG = 138; LS_HB = 210;
      } else {
        LS_HW = 0.42 * SS; LS_AV = 0.34; LS_AH = 0; LS_CUE = false;
        LS_VR = 12; LS_VG = 16; LS_VB = 26;
        LS_HR = 0; LS_HG = 0; LS_HB = 0;
      }
      const wire = m.wire, ef = m.edgeF, ne = m.ne;
      for (let e = 0; e < ne; e++) {
        const f0 = ef[2 * e], f1 = ef[2 * e + 1];
        // с отсечением: ребро, у которого обе грани нелицевые, не рисуем вовсе
        if (cull && !(f0 >= 0 && FRONT[f0]) && !(f1 >= 0 && FRONT[f1])) continue;
        const a = wire[2 * e], b = wire[2 * e + 1];
        drawLine(SX[a], SY[a], IZ[a], SX[b], SY[b], IZ[b]);
      }
    }

    stat.nt = nt; stat.front = nFront; stat.draw = nDraw; stat.pixels = pixels;
  }

  function updateLight(t) {
    const phi = -0.35 + 0.8 * Math.sin(t * 0.21);          // гуляет слева направо по передней полусфере
    const el = 0.28 + 0.08 * Math.sin(t * 0.29 + 1.1);     // чуть выше тела
    const ce = Math.cos(el);
    LP[0] = LIGHT_ORBIT * Math.sin(phi) * ce;
    LP[1] = LIGHT_ORBIT * Math.sin(el);
    LP[2] = LIGHT_ORBIT * Math.cos(phi) * ce - CAM_D;
  }

  function drawShadow() {
    const r = R_CSS * DPR;
    const cx = DEST_X + DEST_S / 2, cy = DEST_Y + DEST_S / 2 + r * 1.04;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.13);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.8);
    g.addColorStop(0, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLightGizmo() {
    const lz = LP[2];
    if (lz > -0.2) return;
    const liz = -1 / lz;
    const bx = BC + FB * LP[0] * liz, by = BC - FB * LP[1] * liz;
    // источник за телом? — проверяем по z-буферу
    let occluded = false;
    const ix = Math.floor(bx), iy = Math.floor(by);
    if (ix >= 0 && iy >= 0 && ix < BW && iy < BH) occluded = ZB[iy * BW + ix] > liz;
    const k = DEST_S / BW;
    const gx = DEST_X + bx * k, gy = DEST_Y + by * k;
    const vis = occluded ? 0.2 : 1;
    const R = 28 * DPR * liz * 2.6;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, R);
    g.addColorStop(0, 'rgba(255,238,205,' + 0.9 * vis + ')');
    g.addColorStop(0.16, 'rgba(255,205,150,' + 0.38 * vis + ')');
    g.addColorStop(0.5, 'rgba(255,170,110,' + 0.08 * vis + ')');
    g.addColorStop(1, 'rgba(255,160,100,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(gx, gy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,252,244,' + vis + ')';
    ctx.beginPath();
    ctx.arc(gx, gy, 3.2 * DPR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,226,196,' + 0.55 * vis + ')';
    ctx.font = (11 * DPR) + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('точечный свет', gx + 10 * DPR, gy - 9 * DPR);
  }

  function present() {
    // в offscreen кладём только изменившийся прямоугольник: прошлый кадр ∪ текущий
    const x0 = Math.max(0, Math.min(PREV[0], BOX[0])), y0 = Math.max(0, Math.min(PREV[1], BOX[1]));
    const x1 = Math.min(BW, Math.max(PREV[2], BOX[2])), y1 = Math.min(BH, Math.max(PREV[3], BOX[3]));
    if (x1 > x0 && y1 > y0) octx.putImageData(IMG, 0, 0, x0, y0, x1 - x0, y1 - y0);
    PREV[0] = BOX[0]; PREV[1] = BOX[1]; PREV[2] = BOX[2]; PREV[3] = BOX[3];

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawShadow();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, DEST_X, DEST_Y, DEST_S, DEST_S);
    drawLightGizmo();
  }

  // ═════════════════════════ интерфейс ═════════════════════════
  const st1 = document.getElementById('st1');
  const st2 = document.getElementById('st2');
  const cullBtn = document.getElementById('cull');
  const pauseBtn = document.getElementById('pause');
  const shadeGroup = document.getElementById('g-shade');
  const spd = document.getElementById('spd');
  const spdv = document.getElementById('spdv');
  const segs = Array.prototype.slice.call(document.querySelectorAll('.seg'));
  const fmt = (n) => n.toLocaleString('ru-RU');

  function syncUI() {
    segs.forEach((seg) => {
      const key = seg.dataset.key;
      Array.prototype.forEach.call(seg.querySelectorAll('button'), (b) => {
        const on = b.dataset.v === state[key];
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
    cullBtn.classList.toggle('on', state.cull);
    cullBtn.setAttribute('aria-pressed', state.cull ? 'true' : 'false');
    shadeGroup.classList.toggle('off', state.mode === 'wire');
    document.body.classList.toggle('paused', state.paused);
    pauseBtn.setAttribute('aria-label', state.paused ? 'Продолжить' : 'Пауза');
    pauseBtn.title = state.paused ? 'Продолжить (Пробел)' : 'Пауза (Пробел)';
    spdv.textContent = state.speed.toFixed(2) + '×';
    spd.style.setProperty('--p', (state.speed / 3) * 100 + '%');
  }

  function setState(key, v) {
    if (state[key] === v) return;
    state[key] = v;
    if (key === 'obj') useObject(v);
    syncUI();
  }

  segs.forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) setState(seg.dataset.key, b.dataset.v);
    });
  });
  cullBtn.addEventListener('click', () => { state.cull = !state.cull; syncUI(); });
  pauseBtn.addEventListener('click', () => { state.paused = !state.paused; syncUI(); });
  spd.addEventListener('input', () => { state.speed = +spd.value; syncUI(); });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const modes = ['fill', 'wire', 'both'];
    switch (e.code) {
      case 'KeyW': setState('mode', modes[(modes.indexOf(state.mode) + 1) % 3]); break;
      case 'KeyS': setState('shading', state.shading === 'flat' ? 'gouraud' : 'flat'); break;
      case 'KeyC': state.cull = !state.cull; syncUI(); break;
      case 'Digit1': case 'Numpad1': setState('obj', 'torus'); break;
      case 'Digit2': case 'Numpad2': setState('obj', 'knot'); break;
      case 'Digit3': case 'Numpad3': setState('obj', 'sphere'); break;
      case 'Space':
        if (e.target && e.target.tagName === 'BUTTON') return;   // пробел на кнопке — её собственный клик
        e.preventDefault(); state.paused = !state.paused; syncUI(); break;
      default: return;
    }
  });

  // вращение мышью / пальцем, с инерцией
  let dragging = false, lastPX = 0, lastPY = 0, lastMoveT = 0;
  let pendX = 0, pendY = 0, velX = 0, velY = 0;
  const DRAG_K = 0.0085;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastPX = e.clientX; lastPY = e.clientY;
    velX = velY = 0; pendX = pendY = 0; lastMoveT = performance.now();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* нет захвата — не страшно */ }
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    pendX += (e.clientX - lastPX) * DRAG_K;
    pendY += (e.clientY - lastPY) * DRAG_K;
    lastPX = e.clientX; lastPY = e.clientY; lastMoveT = performance.now();
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('dragging');
    if (performance.now() - lastMoveT > 90) velX = velY = 0;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);

  window.addEventListener('resize', layout);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => layout());
    ro.observe(panel);
    ro.observe(hud);
  }

  // ═════════════════════════ цикл ═════════════════════════
  let ax = 0.55, ay = 0.35, lightT = 0;
  let last = performance.now(), statT = 1, msAvg = 0;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    if ((window.devicePixelRatio || 1) !== lastDpr) layout();

    if (!state.paused) {
      ax += dt * 0.21 * state.speed;
      ay += dt * 0.33 * state.speed;
      lightT += dt;
    }
    if (dragging) {
      if (pendX || pendY) rotateUser(pendX, pendY);
      if (dt > 0) {
        velX = velX * 0.5 + (pendX / dt) * 0.5;
        velY = velY * 0.5 + (pendY / dt) * 0.5;
        const vm = Math.hypot(velX, velY);
        if (vm > 6) { velX *= 6 / vm; velY *= 6 / vm; }
      }
      pendX = pendY = 0;
    } else if (Math.abs(velX) + Math.abs(velY) > 1e-3) {
      rotateUser(velX * dt, velY * dt);
      const d = Math.exp(-3.2 * dt);
      velX *= d; velY *= d;
    }

    setRx(RX, ax); setRy(RY, ay);
    mul3(RX, RY, TMP);
    mul3(U, TMP, M);
    updateLight(lightT);

    const t0 = performance.now();
    renderScene();
    present();
    const ms = performance.now() - t0;
    msAvg = msAvg ? msAvg * 0.9 + ms * 0.1 : ms;

    statT += dt;
    if (statT > 0.25) {
      statT = 0;
      st1.textContent = objDef.label + ': ' + fmt(stat.nt) + ' треуг. · лицевых ' + fmt(stat.front);
      st2.textContent = 'в растр ' + fmt(stat.draw) + ' · ' + (stat.pixels / 1e6).toFixed(2) +
        ' Мпикс · ' + msAvg.toFixed(1) + ' мс/кадр';
    }
    requestAnimationFrame(frame);
  }

  useObject(state.obj);
  syncUI();
  layout();
  requestAnimationFrame(frame);
})();
