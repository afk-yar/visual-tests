/* 3D-тело (софт-рендер) — Claude Sonnet 5.5
 *
 * Мини-конвейер, написанный вручную (Canvas 2D, без WebGL и библиотек):
 *   1. сетка тела (тор / торический узел / икосаэдр) с исходящими наружу нормалями;
 *   2. матрицы 4x4: поворот X/Y, перенос, перспективная проекция, деление на w, viewport;
 *   3. отсечение нелицевых граней (backface culling) по нормали в системе камеры;
 *   4. растеризация треугольников в буфер пикселей с z-буфером по 1/w
 *      (1/w линейна в экранном пространстве, поэтому глубина корректна);
 *   5. освещение точечным источником (Ламберт + Блинн-Фонг + мягкое затухание):
 *      плоское — один цвет на грань, Гуро — цвет в вершинах и интерполяция по грани;
 *   6. каркас: рёбра рисуются антиалиасными линиями с тестом глубины
 *      (скрытые линии удаляются по z-буферу, по желанию остаются бледными).
 *
 * Модуль двойной: в браузере поднимает интерфейс, в node экспортирует чистую логику
 * конвейера через module.exports.
 */
(function () {
  'use strict';

  /* ===================================================================
   * 0. Константы сцены
   * =================================================================== */
  const TAU = Math.PI * 2;
  const MESH_RADIUS = 1.5;                 // радиус описанной сферы любого тела
  const CAM_DIST = 5.0;                    // расстояние от камеры до центра тела
  const FIT = 0.96;                        // какую долю NDC-квадрата занимает описанная сфера
  const TAN_ALPHA = MESH_RADIUS / Math.sqrt(CAM_DIST * CAM_DIST - MESH_RADIUS * MESH_RADIUS);
  const FOV_Y = 2 * Math.atan(TAN_ALPHA / FIT);   // угол обзора подобран под размер тела

  /* ===================================================================
   * 1. Матрицы 4x4 (column-major: элемент (строка r, столбец c) = m[c*4 + r])
   * =================================================================== */
  const _tmp16 = new Float64Array(16);
  const mat4 = {
    create() {
      const m = new Float64Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      return m;
    },
    // out = a * b (допускает out === a или out === b)
    mul(out, a, b) {
      const t = _tmp16;
      for (let c = 0; c < 4; c++) {
        const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
        for (let r = 0; r < 4; r++) {
          t[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
        }
      }
      out.set(t);
      return out;
    },
    rotX(out, a) {
      const c = Math.cos(a), s = Math.sin(a);
      out.fill(0);
      out[0] = 1; out[5] = c; out[6] = s; out[9] = -s; out[10] = c; out[15] = 1;
      return out;
    },
    rotY(out, a) {
      const c = Math.cos(a), s = Math.sin(a);
      out.fill(0);
      out[0] = c; out[2] = -s; out[5] = 1; out[8] = s; out[10] = c; out[15] = 1;
      return out;
    },
    translation(out, x, y, z) {
      out.fill(0);
      out[0] = out[5] = out[10] = out[15] = 1;
      out[12] = x; out[13] = y; out[14] = z;
      return out;
    },
    // классическая перспективная матрица (камера смотрит вдоль -Z, clip.w = -z_eye)
    perspective(out, fovY, aspect, near, far) {
      const t = 1 / Math.tan(fovY / 2);
      out.fill(0);
      out[0] = t / aspect;
      out[5] = t;
      out[10] = (far + near) / (near - far);
      out[11] = -1;
      out[14] = 2 * far * near / (near - far);
      return out;
    }
  };

  /* ===================================================================
   * 2. Сетки
   *    mesh = { pos, nor, tri, ne, eA, eB, eF0, eF1, + буферы кадра }
   *    eF0/eF1 — соседние грани ребра (для отсечения рёбер и цвета линий)
   * =================================================================== */
  function finishMesh(name, pos, nor, tri, edges) {
    const nv = pos.length / 3, nt = tri.length / 3;

    // нормируем размер: описанная сфера радиуса MESH_RADIUS
    let rmax = 0;
    for (let i = 0; i < nv; i++) {
      const r = Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      if (r > rmax) rmax = r;
    }
    const k = MESH_RADIUS / rmax;
    for (let i = 0; i < pos.length; i++) pos[i] *= k;

    // ориентация граней: нормаль грани (b-a)x(c-a) должна смотреть туда же,
    // куда усреднённая нормаль вершин (т.е. наружу); иначе меняем порядок вершин
    for (let t = 0; t < nt; t++) {
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const rx = nor[a] + nor[b] + nor[c], ry = nor[a + 1] + nor[b + 1] + nor[c + 1], rz = nor[a + 2] + nor[b + 2] + nor[c + 2];
      if (nx * rx + ny * ry + nz * rz < 0) {
        const tmp = tri[t * 3 + 1];
        tri[t * 3 + 1] = tri[t * 3 + 2];
        tri[t * 3 + 2] = tmp;
      }
    }

    const ne = edges.eA.length;
    return {
      name, nv, nt, ne,
      pos, nor, tri,
      eA: edges.eA, eB: edges.eB, eF0: edges.eF0, eF1: edges.eF1,
      // буферы кадра (чтобы не аллоцировать в цикле отрисовки)
      ex: new Float64Array(nv), ey: new Float64Array(nv), ez: new Float64Array(nv),
      enx: new Float64Array(nv), eny: new Float64Array(nv), enz: new Float64Array(nv),
      sx: new Float64Array(nv), sy: new Float64Array(nv), sw: new Float64Array(nv),
      vr: new Float32Array(nv), vg: new Float32Array(nv), vb: new Float32Array(nv),
      front: new Uint8Array(nt),
      fr: new Float32Array(nt), fg: new Float32Array(nt), fb: new Float32Array(nt),
      fcol: new Int32Array(nt)
    };
  }

  // параметрическая сетка nu x nv, замкнутая по обоим направлениям (тор, узел)
  function buildGrid(name, nu, nv, fill) {
    const NV = nu * nv;
    const pos = new Float64Array(NV * 3), nor = new Float64Array(NV * 3);
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        fill(TAU * i / nu, TAU * j / nv, pos, nor, (i * nv + j) * 3);
      }
    }
    const vi = (i, j) => (((i % nu) + nu) % nu) * nv + (((j % nv) + nv) % nv);
    const qi = vi;                                   // индекс квадрата совпадает с индексом его угла (i,j)
    const tri = new Uint32Array(nu * nv * 6);
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const q = qi(i, j);
        const a = vi(i, j), b = vi(i + 1, j), c = vi(i + 1, j + 1), d = vi(i, j + 1);
        tri.set([a, b, c], (2 * q) * 3);             // грань 2q:   (a,b,c)
        tri.set([a, c, d], (2 * q + 1) * 3);         // грань 2q+1: (a,c,d)
      }
    }
    // рёбра сетки (без диагоналей квадратов)
    const ne = NV * 2;
    const eA = new Uint32Array(ne), eB = new Uint32Array(ne);
    const eF0 = new Int32Array(ne), eF1 = new Int32Array(ne);
    let e = 0;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        // вдоль u: (i,j)->(i+1,j): ребро ab квадрата (i,j) и cd нижнего квадрата (i,j-1)
        eA[e] = vi(i, j); eB[e] = vi(i + 1, j);
        eF0[e] = 2 * qi(i, j); eF1[e] = 2 * qi(i, j - 1) + 1; e++;
        // вдоль v: (i,j)->(i,j+1): ребро da квадрата (i,j) и bc левого квадрата (i-1,j)
        eA[e] = vi(i, j); eB[e] = vi(i, j + 1);
        eF0[e] = 2 * qi(i, j) + 1; eF1[e] = 2 * qi(i - 1, j); e++;
      }
    }
    return finishMesh(name, pos, nor, tri, { eA, eB, eF0, eF1 });
  }

  function buildTorus(nu, nv) {
    const R = 1.0, r = 0.46;
    return buildGrid('torus', nu, nv, (u, v, pos, nor, o) => {
      const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
      pos[o] = (R + r * cv) * cu;
      pos[o + 1] = (R + r * cv) * su;
      pos[o + 2] = r * sv;
      nor[o] = cv * cu; nor[o + 1] = cv * su; nor[o + 2] = sv;
    });
  }

  // торический узел (2,3) — трёхлистник; трубка строится по кадру Френе
  function knotCurve(u, o) {
    const k = 2 + Math.cos(3 * u);
    o[0] = k * Math.cos(2 * u);
    o[1] = k * Math.sin(2 * u);
    o[2] = Math.sin(3 * u);
  }
  function buildKnot(nu, nv) {
    const rt = 0.52;                                  // радиус трубки (до нормировки)
    const h = 1e-3;
    const p0 = [0, 0, 0], p1 = [0, 0, 0], pc = [0, 0, 0];
    return buildGrid('knot', nu, nv, (u, v, pos, nor, o) => {
      knotCurve(u - h, p0); knotCurve(u + h, p1); knotCurve(u, pc);
      let tx = p1[0] - p0[0], ty = p1[1] - p0[1], tz = p1[2] - p0[2];
      const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
      let ax = p1[0] + p0[0] - 2 * pc[0], ay = p1[1] + p0[1] - 2 * pc[1], az = p1[2] + p0[2] - 2 * pc[2];
      const at = ax * tx + ay * ty + az * tz;
      ax -= at * tx; ay -= at * ty; az -= at * tz;
      const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;      // N
      const bx = ty * az - tz * ay, by = tz * ax - tx * az, bz = tx * ay - ty * ax; // B = T x N
      const cv = Math.cos(v), sv = Math.sin(v);
      const nx = cv * ax + sv * bx, ny = cv * ay + sv * by, nz = cv * az + sv * bz;
      pos[o] = pc[0] + rt * nx; pos[o + 1] = pc[1] + rt * ny; pos[o + 2] = pc[2] + rt * nz;
      nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
    });
  }

  // икосаэдр; level>0 — геодезическое деление (каждая грань на 4, вершины на сферу)
  function buildIco(level) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
    ].map((v) => {
      const l = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / l, v[1] / l, v[2] / l];
    });
    let faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ];
    for (let s = 0; s < level; s++) {
      const cache = new Map();
      const mid = (a, b) => {
        const key = a < b ? a * 100000 + b : b * 100000 + a;
        let m = cache.get(key);
        if (m === undefined) {
          const va = verts[a], vb = verts[b];
          const x = va[0] + vb[0], y = va[1] + vb[1], z = va[2] + vb[2];
          const l = Math.hypot(x, y, z);
          verts.push([x / l, y / l, z / l]);
          m = verts.length - 1;
          cache.set(key, m);
        }
        return m;
      };
      const nf = [];
      for (const f of faces) {
        const ab = mid(f[0], f[1]), bc = mid(f[1], f[2]), ca = mid(f[2], f[0]);
        nf.push([f[0], ab, ca], [f[1], bc, ab], [f[2], ca, bc], [ab, bc, ca]);
      }
      faces = nf;
    }
    const nv = verts.length, nt = faces.length;
    const pos = new Float64Array(nv * 3), nor = new Float64Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      pos.set(verts[i], i * 3);
      nor.set(verts[i], i * 3);               // нормаль вершины сферы = направление от центра
    }
    const tri = new Uint32Array(nt * 3);
    for (let i = 0; i < nt; i++) tri.set(faces[i], i * 3);

    // уникальные рёбра с соседними гранями
    const map = new Map();
    const A = [], B = [], F0 = [], F1 = [];
    for (let f = 0; f < nt; f++) {
      for (let k = 0; k < 3; k++) {
        const a = tri[f * 3 + k], b = tri[f * 3 + (k + 1) % 3];
        const key = a < b ? a * nv + b : b * nv + a;
        const ei = map.get(key);
        if (ei === undefined) {
          map.set(key, A.length);
          A.push(Math.min(a, b)); B.push(Math.max(a, b)); F0.push(f); F1.push(-1);
        } else {
          F1[ei] = f;
        }
      }
    }
    return finishMesh('ico', pos, nor, tri, {
      eA: Uint32Array.from(A), eB: Uint32Array.from(B),
      eF0: Int32Array.from(F0), eF1: Int32Array.from(F1)
    });
  }

  const TORUS_LEVELS = [[14, 7], [22, 11], [32, 16], [48, 24], [72, 36]];
  const KNOT_LEVELS = [[48, 6], [80, 8], [128, 10], [192, 12], [288, 16]];

  function buildMesh(shape, detail) {
    const d = Math.max(1, Math.min(5, detail | 0)) - 1;
    if (shape === 'knot') return buildKnot(KNOT_LEVELS[d][0], KNOT_LEVELS[d][1]);
    if (shape === 'ico') return buildIco(d);
    return buildTorus(TORUS_LEVELS[d][0], TORUS_LEVELS[d][1]);
  }

  /* ===================================================================
   * 3. Цель рисования: буфер пикселей RGBA (Uint32, little-endian) + z-буфер (1/w)
   * =================================================================== */
  let BW = 0, BH = 0, PX = null, ZB = null;

  function createTarget(w, h, buffer) {
    buffer = buffer || new ArrayBuffer(w * h * 4);
    PX = new Uint32Array(buffer);
    ZB = new Float32Array(w * h);
    BW = w; BH = h;
    return { w, h, px: PX, zb: ZB, buffer };
  }

  /* ===================================================================
   * 4. Освещение: точечный источник, Ламберт + Блинн-Фонг, полусферический ambient
   * =================================================================== */
  const ALB_R = 0.80, ALB_G = 0.17, ALB_B = 0.09;          // «коралл» (линейное пространство)
  const LC_R = 1.0, LC_G = 0.94, LC_B = 0.82;              // тёплый свет
  const SKY_R = 0.30, SKY_G = 0.38, SKY_B = 0.66;
  const GND_R = 0.11, GND_G = 0.08, GND_B = 0.17;
  const AMB_K = 0.62, LIGHT_I = 1.25, SPEC_K = 0.75, ATT_K = 0.045;

  const GAMMA = new Float32Array(4096);
  for (let i = 0; i < 4096; i++) GAMMA[i] = 255 * Math.pow(i / 4095, 1 / 2.2);
  const toSRGB = (c) => (c <= 0 ? 0 : c >= 1 ? 255 : GAMMA[(c * 4095) | 0]);

  let LX = 0, LY = 0, LZ = 0;      // положение света (система камеры)
  let LR = 0, LG = 0, LB = 0;      // результат lightAt, 0..255

  function lightAt(px, py, pz, nx, ny, nz) {
    let lx = LX - px, ly = LY - py, lz = LZ - pz;
    const d2 = lx * lx + ly * ly + lz * lz;
    const id = 1 / Math.sqrt(d2);
    lx *= id; ly *= id; lz *= id;
    const ndl = nx * lx + ny * ly + nz * lz;

    const hemi = 0.5 + 0.5 * ny;
    const ar = (GND_R + (SKY_R - GND_R) * hemi) * AMB_K;
    const ag = (GND_G + (SKY_G - GND_G) * hemi) * AMB_K;
    const ab = (GND_B + (SKY_B - GND_B) * hemi) * AMB_K;

    let diff = 0, spec = 0;
    if (ndl > 0) {
      const att = LIGHT_I / (1 + ATT_K * d2);              // затухание с расстоянием
      diff = ndl * att;
      // Блинн-Фонг: половинный вектор между направлением на свет и на камеру (камера в нуле)
      const vl = 1 / Math.sqrt(px * px + py * py + pz * pz);
      const hx = lx - px * vl, hy = ly - py * vl, hz = lz - pz * vl;
      const hl = 1 / (Math.sqrt(hx * hx + hy * hy + hz * hz) + 1e-9);
      const ndh = (nx * hx + ny * hy + nz * hz) * hl;
      if (ndh > 0) {
        let s = ndh;
        s *= s; s *= s; s *= s; s *= s; s *= s;              // ndh^32
        spec = s * att * SPEC_K;
      }
    }
    LR = toSRGB(ALB_R * (ar + LC_R * diff) + LC_R * spec);
    LG = toSRGB(ALB_G * (ag + LC_G * diff) + LC_G * spec);
    LB = toSRGB(ALB_B * (ab + LC_B * diff) + LC_B * spec);
  }

  /* ===================================================================
   * 5. Растеризатор треугольников
   *    kind: 0 — только глубина, 1 — плоский цвет, 2 — Гуро
   *    Покрытие: центр пикселя внутри треугольника; рёбра считаются всегда от
   *    нижнего по y конца => соседние грани делят пиксели без щелей и перекрытий.
   *    Атрибуты (1/w, r, g, b) линейны в экранном пространстве => плоскости.
   *    bias: полигональное смещение глубины (нужно, чтобы линии каркаса
   *    проходили тест глубины на собственной поверхности).
   * =================================================================== */
  function rasterTri(kind, x0, y0, w0, x1, y1, w1, x2, y2, w2,
                     r0, g0, b0, r1, g1, b1, r2, g2, b2, flat, bias) {
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area > -1e-9 && area < 1e-9) return;
    const inv = 1 / area;

    // вершины по возрастанию y
    let ax = x0, ay = y0, bx = x1, by = y1, cx = x2, cy = y2, t;
    if (ay > by) { t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; }
    if (by > cy) { t = bx; bx = cx; cx = t; t = by; by = cy; cy = t; }
    if (ay > by) { t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; }

    let yStart = Math.ceil(ay - 0.5), yEnd = Math.ceil(cy - 0.5) - 1;
    if (yStart < 0) yStart = 0;
    if (yEnd > BH - 1) yEnd = BH - 1;
    if (yStart > yEnd) return;

    const dx10 = x1 - x0, dx20 = x2 - x0, dy10 = y1 - y0, dy20 = y2 - y0;
    const dwdx = ((w1 - w0) * dy20 - (w2 - w0) * dy10) * inv;
    const dwdy = ((w2 - w0) * dx10 - (w1 - w0) * dx20) * inv;
    const woff = bias ? (Math.abs(dwdx) + Math.abs(dwdy)) + w0 * 6e-4 : 0;

    let drdx = 0, drdy = 0, dgdx = 0, dgdy = 0, dbdx = 0, dbdy = 0;
    if (kind === 2) {
      drdx = ((r1 - r0) * dy20 - (r2 - r0) * dy10) * inv;
      drdy = ((r2 - r0) * dx10 - (r1 - r0) * dx20) * inv;
      dgdx = ((g1 - g0) * dy20 - (g2 - g0) * dy10) * inv;
      dgdy = ((g2 - g0) * dx10 - (g1 - g0) * dx20) * inv;
      dbdx = ((b1 - b0) * dy20 - (b2 - b0) * dy10) * inv;
      dbdy = ((b2 - b0) * dx10 - (b1 - b0) * dx20) * inv;
    }

    const dxL = (cx - ax) / (cy - ay);
    const dxA = by > ay ? (bx - ax) / (by - ay) : 0;
    const dxB = cy > by ? (cx - bx) / (cy - by) : 0;
    const zb = ZB, px = PX, bw = BW;

    for (let y = yStart; y <= yEnd; y++) {
      const yc = y + 0.5;
      const xl = ax + (yc - ay) * dxL;
      const xs2 = yc < by ? ax + (yc - ay) * dxA : bx + (yc - by) * dxB;
      let xs, xe;
      if (xl < xs2) { xs = Math.ceil(xl - 0.5); xe = Math.ceil(xs2 - 0.5) - 1; }
      else { xs = Math.ceil(xs2 - 0.5); xe = Math.ceil(xl - 0.5) - 1; }
      if (xs < 0) xs = 0;
      if (xe > bw - 1) xe = bw - 1;
      if (xs > xe) continue;

      const ox = xs + 0.5 - x0, oy = yc - y0;
      let w = w0 + dwdx * ox + dwdy * oy - woff;
      let idx = y * bw + xs;

      if (kind === 2) {
        let r = r0 + drdx * ox + drdy * oy;
        let g = g0 + dgdx * ox + dgdy * oy;
        let b = b0 + dbdx * ox + dbdy * oy;
        for (let x = xs; x <= xe; x++, idx++) {
          if (w > zb[idx]) {
            zb[idx] = w;
            px[idx] = 0xFF000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
          }
          w += dwdx; r += drdx; g += dgdx; b += dbdx;
        }
      } else if (kind === 1) {
        for (let x = xs; x <= xe; x++, idx++) {
          if (w > zb[idx]) { zb[idx] = w; px[idx] = flat; }
          w += dwdx;
        }
      } else {
        for (let x = xs; x <= xe; x++, idx++) {
          if (w > zb[idx]) zb[idx] = w;
          w += dwdx;
        }
      }
    }
  }

  /* ===================================================================
   * 6. Антиалиасные линии с тестом глубины (каркас)
   * =================================================================== */
  function blendPx(idx, r, g, b, a) {
    const d = PX[idx], da = d >>> 24;
    if (da === 0) {
      PX[idx] = ((((a * 255) + 0.5) | 0) << 24) | (((b + 0.5) | 0) << 16) | (((g + 0.5) | 0) << 8) | ((r + 0.5) | 0);
    } else {
      const dr = d & 255, dg = (d >>> 8) & 255, db = (d >>> 16) & 255;
      if (da === 255) {
        PX[idx] = 0xFF000000 |
          (((db + (b - db) * a + 0.5) | 0) << 16) |
          (((dg + (g - dg) * a + 0.5) | 0) << 8) |
          ((dr + (r - dr) * a + 0.5) | 0);
      } else {
        const dA = da / 255, oA = a + dA * (1 - a);
        const k1 = a / oA, k2 = dA * (1 - a) / oA;
        PX[idx] = ((((oA * 255) + 0.5) | 0) << 24) |
          (((b * k1 + db * k2 + 0.5) | 0) << 16) |
          (((g * k1 + dg * k2 + 0.5) | 0) << 8) |
          ((r * k1 + dr * k2 + 0.5) | 0);
      }
    }
  }

  const XRAY_R = 150, XRAY_G = 168, XRAY_B = 235, XRAY_A = 0.22;

  // visible=false — линия целиком позади поверхности (рисуем только бледный «рентген»)
  function drawLine(ax, ay, aw, ar, ag, ab, bx, by, bw_, br, bg, bb, alpha, lw, xray, visibleOk) {
    ax -= 0.5; ay -= 0.5; bx -= 0.5; by -= 0.5;     // центр пикселя -> целые координаты
    const dx = bx - ax, dy = by - ay;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < 1e-6 && ady < 1e-6) return;
    const steep = ady > adx;

    // нормализуем: идём по главной оси от меньшего к большему
    let m0, m1, n0, n1;
    let w0 = aw, w1 = bw_, r0 = ar, g0 = ag, b0 = ab, r1 = br, g1 = bg, b1 = bb;
    if (steep) { m0 = ay; m1 = by; n0 = ax; n1 = bx; } else { m0 = ax; m1 = bx; n0 = ay; n1 = by; }
    if (m0 > m1) {
      let t;
      t = m0; m0 = m1; m1 = t; t = n0; n0 = n1; n1 = t;
      t = w0; w0 = w1; w1 = t; t = r0; r0 = r1; r1 = t; t = g0; g0 = g1; g1 = t; t = b0; b0 = b1; b1 = t;
    }
    const majLen = m1 - m0;
    const len = Math.hypot(dx, dy);
    const cosT = majLen / len;
    const hw = lw * 0.5;
    const reach = (hw + 0.5) / cosT;

    const mStart = Math.round(m0), mEnd = Math.round(m1);
    const zb = ZB, bw = BW, bh = BH;
    for (let m = mStart; m <= mEnd; m++) {
      let t = majLen > 1e-9 ? (m - m0) / majLen : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const nc = n0 + (n1 - n0) * t;
      const w = w0 + (w1 - w0) * t;
      const jmin = Math.ceil(nc - reach), jmax = Math.floor(nc + reach);
      for (let j = jmin; j <= jmax; j++) {
        let cov = hw + 0.5 - Math.abs(j - nc) * cosT;
        if (cov <= 0) continue;
        if (cov > 1) cov = 1;
        const x = steep ? j : m, y = steep ? m : j;
        if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
        const idx = y * bw + x;
        if (visibleOk && w >= zb[idx]) {
          blendPx(idx, r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t, cov * alpha);
        } else if (xray) {
          blendPx(idx, XRAY_R, XRAY_G, XRAY_B, cov * XRAY_A);
        }
      }
    }
  }

  /* ===================================================================
   * 7. Кадр: матрицы -> вершины -> свет -> грани (culling + z-буфер) -> линии
   * =================================================================== */
  const M_RX = mat4.create(), M_RY = mat4.create(), M_T1 = mat4.create();
  const M_TR = mat4.create(), M_MV = mat4.create(), M_P = mat4.create();
  const frameInfo = { nt: 0, visible: 0, lightX: 0, lightY: 0, lightIw: 0 };

  const wireBoost = (v) => Math.min(255, 96 + v * 0.74);   // линии читаются и на тёмной стороне

  function renderFrame(p) {
    const m = p.mesh;
    const W = BW, H = BH;
    PX.fill(0);
    ZB.fill(0);

    // --- матрицы: MV = T * Rx * Ry, P = перспектива ---
    mat4.rotX(M_RX, p.angX);
    mat4.rotY(M_RY, p.angY);
    mat4.mul(M_T1, M_RX, M_RY);
    mat4.translation(M_TR, 0, 0, -CAM_DIST);
    mat4.mul(M_MV, M_TR, M_T1);
    mat4.perspective(M_P, FOV_Y, 1, 0.5, 60);
    const mv = M_MV, pm = M_P;

    // --- точечный источник на орбите вокруг тела (система камеры) ---
    const la = p.lightAngle;
    LX = 4.2 * Math.cos(la);
    LY = 1.3 + 0.9 * Math.sin(0.7 * la + 1.0);
    LZ = -CAM_DIST + 0.8 + 2.6 * Math.sin(la);

    const smooth = p.shading === 'smooth';
    const mode = p.mode;                       // 'fill' | 'wire' | 'both'
    const drawFill = mode !== 'wire';
    const drawWire = mode !== 'fill';

    // --- вершинный этап: модель -> камера -> clip -> NDC -> экран; свет (Гуро) ---
    const pos = m.pos, nor = m.nor;
    const ex = m.ex, ey = m.ey, ez = m.ez, enx = m.enx, eny = m.eny, enz = m.enz;
    const sx = m.sx, sy = m.sy, sw = m.sw, vr = m.vr, vg = m.vg, vb = m.vb;
    for (let i = 0, j = 0; i < m.nv; i++, j += 3) {
      const x = pos[j], y = pos[j + 1], z = pos[j + 2];
      const exv = mv[0] * x + mv[4] * y + mv[8] * z + mv[12];
      const eyv = mv[1] * x + mv[5] * y + mv[9] * z + mv[13];
      const ezv = mv[2] * x + mv[6] * y + mv[10] * z + mv[14];
      ex[i] = exv; ey[i] = eyv; ez[i] = ezv;
      const nx0 = nor[j], ny0 = nor[j + 1], nz0 = nor[j + 2];
      const nx = mv[0] * nx0 + mv[4] * ny0 + mv[8] * nz0;
      const ny = mv[1] * nx0 + mv[5] * ny0 + mv[9] * nz0;
      const nz = mv[2] * nx0 + mv[6] * ny0 + mv[10] * nz0;
      enx[i] = nx; eny[i] = ny; enz[i] = nz;

      const cxv = pm[0] * exv + pm[4] * eyv + pm[8] * ezv + pm[12];
      const cyv = pm[1] * exv + pm[5] * eyv + pm[9] * ezv + pm[13];
      const cwv = pm[3] * exv + pm[7] * eyv + pm[11] * ezv + pm[15];
      const iw = 1 / cwv;
      sx[i] = (cxv * iw * 0.5 + 0.5) * W;
      sy[i] = (0.5 - cyv * iw * 0.5) * H;
      sw[i] = iw;

      if (smooth) {
        lightAt(exv, eyv, ezv, nx, ny, nz);
        vr[i] = LR; vg[i] = LG; vb[i] = LB;
      }
    }

    // --- гранный этап: отсечение нелицевых, свет (плоский), z-буфер ---
    const tri = m.tri, front = m.front, fr = m.fr, fg = m.fg, fb = m.fb, fcol = m.fcol;
    const kind = drawFill ? (smooth ? 2 : 1) : 0;
    const bias = drawWire;
    let visible = 0;
    for (let t = 0; t < m.nt; t++) {
      const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
      const e1x = ex[b] - ex[a], e1y = ey[b] - ey[a], e1z = ez[b] - ez[a];
      const e2x = ex[c] - ex[a], e2y = ey[c] - ey[a], e2z = ez[c] - ez[a];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      // нормаль смотрит от камеры (камера в нуле) => грань нелицевая
      if (nx * ex[a] + ny * ey[a] + nz * ez[a] >= 0) { front[t] = 0; continue; }
      front[t] = 1;
      visible++;

      let flat = 0;
      if (!smooth) {
        const il = 1 / Math.hypot(nx, ny, nz);
        lightAt((ex[a] + ex[b] + ex[c]) / 3, (ey[a] + ey[b] + ey[c]) / 3, (ez[a] + ez[b] + ez[c]) / 3,
          nx * il, ny * il, nz * il);
        fr[t] = LR; fg[t] = LG; fb[t] = LB;
        flat = 0xFF000000 | ((LB | 0) << 16) | ((LG | 0) << 8) | (LR | 0);
        fcol[t] = flat;
      }
      rasterTri(kind,
        sx[a], sy[a], sw[a], sx[b], sy[b], sw[b], sx[c], sy[c], sw[c],
        vr[a], vg[a], vb[a], vr[b], vg[b], vb[b], vr[c], vg[c], vb[c], flat, bias);
    }

    // --- каркас: рёбра с тестом глубины по z-буферу ---
    if (drawWire) {
      const xray = !!p.xray && mode === 'wire';
      const lw = p.lineWidth || 1.4;
      const eA = m.eA, eB = m.eB, eF0 = m.eF0, eF1 = m.eF1;
      for (let e = 0; e < m.ne; e++) {
        const f0 = eF0[e], f1 = eF1[e];
        const fr0 = front[f0] === 1, fr1 = f1 >= 0 && front[f1] === 1;
        const anyFront = fr0 || fr1;
        if (!anyFront && !xray) continue;
        const a = eA[e], b = eB[e];
        let r0, g0, b0, r1, g1, b1, alpha;
        if (mode === 'both') {
          r0 = r1 = 255; g0 = g1 = 246; b0 = b1 = 236; alpha = 0.3;
        } else if (!anyFront) {
          r0 = r1 = g0 = g1 = b0 = b1 = 0; alpha = 1;
        } else if (smooth) {
          r0 = wireBoost(vr[a]); g0 = wireBoost(vg[a]); b0 = wireBoost(vb[a]);
          r1 = wireBoost(vr[b]); g1 = wireBoost(vg[b]); b1 = wireBoost(vb[b]);
          alpha = 1;
        } else {
          const f = fr0 ? f0 : f1;
          r0 = r1 = wireBoost(fr[f]); g0 = g1 = wireBoost(fg[f]); b0 = b1 = wireBoost(fb[f]);
          alpha = 1;
        }
        drawLine(sx[a], sy[a], sw[a], r0, g0, b0, sx[b], sy[b], sw[b], r1, g1, b1,
          alpha, lw, xray, anyFront);
      }
    }

    // --- положение источника в NDC (для спрайта поверх/под телом) ---
    const lcx = pm[0] * LX + pm[4] * LY + pm[8] * LZ + pm[12];
    const lcy = pm[1] * LX + pm[5] * LY + pm[9] * LZ + pm[13];
    const lcw = pm[3] * LX + pm[7] * LY + pm[11] * LZ + pm[15];
    frameInfo.nt = m.nt;
    frameInfo.visible = visible;
    frameInfo.lightX = lcx / lcw;
    frameInfo.lightY = lcy / lcw;
    frameInfo.lightIw = 1 / lcw;
    return frameInfo;
  }

  /* ===================================================================
   * 8. Экспорт для node-тестов
   * =================================================================== */
  const api = {
    mat4, buildMesh, createTarget, renderFrame,
    consts: { CAM_DIST, MESH_RADIUS, FOV_Y, FIT }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  /* ===================================================================
   * 9. Интерфейс (только в браузере)
   * =================================================================== */
  if (typeof document === 'undefined') return;

  const MAX_PIX = 1.25e6;               // потолок размера буфера рендера (пикселей)
  const SUPERSAMPLE = 2;                // желаемое превышение буфера над экранным размером
  const BASE_AX = 0.31, BASE_AY = 0.47; // рад/с: медленное вращение по двум осям

  const $ = (id) => document.getElementById(id);
  const canvas = $('view');
  const ctx = canvas.getContext('2d');
  const panel = $('panel'), hud = $('hud');
  const statsEl = $('stats'), detailOut = $('detailOut');
  const buf = document.createElement('canvas');
  const bctx = buf.getContext('2d');

  const state = {
    mode: 'fill', shading: 'smooth', shape: 'torus', detail: 3,
    speed: 1, xray: false, paused: false,
    angX: 0.95, angY: 0.55, lightA: 0.7
  };

  // --- сетки: кэш по (тело, детализация) ---
  const meshCache = new Map();
  let mesh = null;
  function getMesh() {
    const key = state.shape + ':' + state.detail;
    let mm = meshCache.get(key);
    if (!mm) {
      if (meshCache.size > 10) meshCache.clear();
      mm = buildMesh(state.shape, state.detail);
      meshCache.set(key, mm);
    }
    mesh = mm;
    detailOut.textContent = String(mm.nt);
    return mm;
  }

  // --- раскладка и размеры ---
  const L = { W: 0, H: 0, dpr: 1, cx: 0, cy: 0, S: 0, top: 0, bottom: 0 };
  let quality = 1;                       // множитель разрешения буфера (адаптивный)
  let target = null, imageData = null;

  function layout() {
    const W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pr = panel.getBoundingClientRect();
    let top = 0;
    if (W < 720) top = hud.getBoundingClientRect().bottom;
    const bottom = Math.max(top + 120, pr.top - 8);
    const availH = bottom - top;
    const minDim = Math.min(W, availH);
    const sil = 0.5 * minDim * 0.9;      // экранный радиус описанной сферы
    L.W = W; L.H = H; L.dpr = dpr;
    L.cx = W / 2; L.cy = top + availH / 2;
    L.S = (sil / FIT) * 2;               // сторона квадрата буфера, CSS px
    L.top = top; L.bottom = bottom;
  }

  function resize() {
    layout();
    const cw = Math.round(L.W * L.dpr), ch = Math.round(L.H * L.dpr);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
  }

  function ensureTarget() {
    const devSide = Math.max(32, Math.round(L.S * L.dpr));
    // суперсэмплинг: где хватает бюджета, рисуем до 2x от экранного размера
    // и сглаживаем силуэт при сжатии в drawImage
    let side = Math.min(devSide * SUPERSAMPLE, Math.sqrt(MAX_PIX)) * quality;
    side = Math.max(96, Math.round(side / 8) * 8);
    if (!target || target.w !== side) {
      buf.width = side; buf.height = side;
      imageData = bctx.createImageData(side, side);
      target = createTarget(side, side, imageData.data.buffer);
    }
    return devSide;
  }

  // --- спрайт источника света ---
  function glow(x, y, r) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,250,232,1)');
    g.addColorStop(0.18, 'rgba(255,236,190,0.85)');
    g.addColorStop(0.45, 'rgba(255,196,120,0.28)');
    g.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  // --- адаптация разрешения ---
  let emaMs = 8, frameCount = 0;
  function adapt(ms) {
    emaMs += (ms - emaMs) * 0.1;
    if (++frameCount % 40 !== 0) return;
    if (emaMs > 14 && quality > 0.34) quality = Math.max(0.34, quality * 0.85);
    else if (emaMs < 6.5 && quality < 1) quality = Math.min(1, quality * 1.08);
  }

  function draw() {
    const t0 = performance.now();
    const m = getMeshCached();
    const devSide = ensureTarget();
    const info = renderFrame({
      mesh: m, angX: state.angX, angY: state.angY, lightAngle: state.lightA,
      mode: state.mode, shading: state.shading, xray: state.xray,
      lineWidth: Math.max(1.25, 1.35 * target.w / devSide)    // ~1.35 экранного пикселя
    });
    bctx.putImageData(imageData, 0, 0);

    const dpr = L.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // мягкое гало за телом
    const ccx = L.cx * dpr, ccy = L.cy * dpr, gr = L.S * dpr * 0.62;
    const halo = ctx.createRadialGradient(ccx, ccy, gr * 0.1, ccx, ccy, gr);
    halo.addColorStop(0, 'rgba(120,140,255,0.16)');
    halo.addColorStop(1, 'rgba(120,140,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // положение источника на экране и тест глубины по z-буферу тела
    const lx = (L.cx + info.lightX * L.S / 2) * dpr;
    const ly = (L.cy - info.lightY * L.S / 2) * dpr;
    const lr = Math.min(70 * dpr, Math.max(7 * dpr, 20 * (L.S / 700) * dpr * (CAM_DIST * info.lightIw)));
    let behind = false;
    const bx = Math.floor((info.lightX * 0.5 + 0.5) * target.w);
    const by = Math.floor((0.5 - info.lightY * 0.5) * target.h);
    if (bx >= 0 && by >= 0 && bx < target.w && by < target.h) {
      behind = target.zb[by * target.w + bx] > info.lightIw;
    }
    ctx.globalCompositeOperation = 'lighter';
    if (behind) glow(lx, ly, lr);
    ctx.globalCompositeOperation = 'source-over';

    const dx = Math.round(ccx - devSide / 2), dy = Math.round(ccy - devSide / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(buf, dx, dy, devSide, devSide);

    if (!behind) {
      ctx.globalCompositeOperation = 'lighter';
      glow(lx, ly, lr);
      ctx.globalCompositeOperation = 'source-over';
    }

    lastInfo = info;
    adapt(performance.now() - t0);
  }

  function getMeshCached() { return mesh || getMesh(); }

  // --- цикл ---
  let lastT = 0, dragging = false, lastInfo = null;
  let fpsAcc = 0, fpsFrames = 0, fpsShown = 0, statT = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = lastT ? (now - lastT) / 1000 : 1 / 60;
    lastT = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.05);                       // кламп больших dt

    if (window.innerWidth !== L.W || window.innerHeight !== L.H ||
        Math.min(window.devicePixelRatio || 1, 2) !== L.dpr) resize();

    if (!state.paused && !dragging) {
      state.angX += BASE_AX * state.speed * dt;
      state.angY += BASE_AY * state.speed * dt;
      state.lightA += 0.55 * dt;
    }
    draw();

    fpsAcc += dt; fpsFrames++;
    statT += dt;
    if (statT >= 0.4) {
      fpsShown = fpsFrames / fpsAcc;
      fpsAcc = 0; fpsFrames = 0; statT = 0;
      if (lastInfo) {
        statsEl.textContent =
          'граней ' + lastInfo.nt + ' · лицевых ' + lastInfo.visible +
          ' · отсечено ' + (lastInfo.nt - lastInfo.visible) +
          ' · буфер ' + target.w + '×' + target.h +
          ' · ' + Math.round(fpsShown) + ' fps';
      }
    }
  }

  // --- управление ---
  function syncSeg(seg) {
    const key = seg.dataset.key;
    seg.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.v === state[key] ? 'true' : 'false');
    });
  }
  function syncXray() {
    const on = state.mode === 'wire';
    $('xray').disabled = !on;
    $('xrayLabel').classList.toggle('off', !on);
  }

  panel.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const key = seg.dataset.key;
      state[key] = btn.dataset.v;
      syncSeg(seg);
      if (key === 'shape') getMesh();
      if (key === 'mode') syncXray();
    });
  });

  $('detail').addEventListener('input', (e) => {
    state.detail = parseInt(e.target.value, 10) || 3;
    getMesh();
  });
  $('speed').addEventListener('input', (e) => { state.speed = parseFloat(e.target.value) || 0; });
  $('xray').addEventListener('change', (e) => { state.xray = e.target.checked; });

  const pauseBtn = $('pause');
  function setPaused(v) {
    state.paused = v;
    pauseBtn.textContent = v ? 'Пуск' : 'Пауза';
  }
  pauseBtn.addEventListener('click', () => setPaused(!state.paused));
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      setPaused(!state.paused);
    }
  });

  // вращение мышью / пальцем
  let px0 = 0, py0 = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; px0 = e.clientX; py0 = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* iframe */ }
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    state.angY += (e.clientX - px0) * 0.01;
    state.angX += (e.clientY - py0) * 0.01;
    px0 = e.clientX; py0 = e.clientY;
  });
  const endDrag = () => { dragging = false; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  window.addEventListener('resize', resize);
  window.addEventListener('load', resize);

  getMesh();
  syncXray();
  resize();
  requestAnimationFrame(frame);
})();
