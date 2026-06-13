'use strict';
// Чистая геометрия и линейная алгебра мини-конвейера.
// Dual-mode: в браузере кладёт API в window.Geo, в node — module.exports.
(function (root) {
  // ── Векторы ──────────────────────────────────────────────────────────────
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }
  function length(a) { return Math.hypot(a[0], a[1], a[2]); }
  function normalize(a) {
    const L = length(a) || 1;
    return [a[0] / L, a[1] / L, a[2] / L];
  }

  // ── Матрицы поворота 3x3 (по строкам) ─────────────────────────────────────
  function rotX(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [[1, 0, 0], [0, c, -s], [0, s, c]];
  }
  function rotY(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  }
  function rotZ(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
  }
  function matMul(A, B) {
    const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        R[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    return R;
  }
  function matVec(M, v) {
    return [
      M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
      M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
      M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
    ];
  }

  // ── Перспективная проекция ────────────────────────────────────────────────
  // Камера в начале координат, смотрит вдоль +Z; объект сдвинут на camDist.
  // Возвращает экранные координаты (px) и глубину для z-буфера.
  function project(v, opts) {
    const z = v[2] + opts.camDist;        // расстояние до камеры по оси Z
    const f = opts.focal;                  // фокус (px на единицу при z=1)
    const invZ = 1 / z;
    return {
      x: opts.cx + v[0] * f * invZ,
      y: opts.cy - v[1] * f * invZ,        // экранный Y вниз
      z: z,                                 // глубина для z-буфера (больше = дальше)
      invZ: invZ,
    };
  }

  // ── Генерация тора ────────────────────────────────────────────────────────
  // R — большой радиус, r — малый. segU вдоль кольца, segV вокруг трубки.
  // Гладкие нормали в вершинах считаются аналитически.
  function buildTorus(R, r, segU, segV) {
    const positions = [], normals = [];
    for (let i = 0; i < segU; i++) {
      const u = (i / segU) * Math.PI * 2;
      const cu = Math.cos(u), su = Math.sin(u);
      for (let j = 0; j < segV; j++) {
        const vv = (j / segV) * Math.PI * 2;
        const cv = Math.cos(vv), sv = Math.sin(vv);
        const x = (R + r * cv) * cu;
        const y = (R + r * cv) * su;
        const z = r * sv;
        positions.push([x, y, z]);
        // Нормаль = направление от центра трубки к точке.
        normals.push(normalize([cv * cu, cv * su, sv]));
      }
    }
    const faces = [];
    const idx = (i, j) => (i % segU) * segV + (j % segV);
    for (let i = 0; i < segU; i++) {
      for (let j = 0; j < segV; j++) {
        const a = idx(i, j), b = idx(i + 1, j);
        const c = idx(i + 1, j + 1), d = idx(i, j + 1);
        faces.push([a, b, c]);
        faces.push([a, c, d]);
      }
    }
    return finalizeMesh(positions, faces, normals);
  }

  // ── Икосфера (подразделённый икосаэдр) ────────────────────────────────────
  function buildIcosphere(radius, subdiv) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map(normalize);
    let faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const cache = new Map();
    function midpoint(i, j) {
      const key = i < j ? i + ',' + j : j + ',' + i;
      if (cache.has(key)) return cache.get(key);
      const m = normalize(scale(add(verts[i], verts[j]), 0.5));
      const k = verts.length;
      verts.push(m);
      cache.set(key, k);
      return k;
    }
    for (let s = 0; s < subdiv; s++) {
      const next = [];
      for (const [a, b, c] of faces) {
        const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = next;
    }
    const positions = verts.map((v) => scale(v, radius));
    const normals = verts.map((v) => v.slice()); // единичные = нормали сферы
    return finalizeMesh(positions, faces, normals);
  }

  // ── Куб со скруглённой тесселяцией граней (много треугольников) ────────────
  function buildCube(size) {
    const positions = [], normals = [], faces = [];
    const dirs = [
      { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
      { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
      { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
      { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
      { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
      { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    ];
    const seg = 6, h = size / 2;
    for (const d of dirs) {
      const base = positions.length;
      for (let i = 0; i <= seg; i++) {
        for (let j = 0; j <= seg; j++) {
          const a = (i / seg) * 2 - 1, b = (j / seg) * 2 - 1;
          const p = add(add(scale(d.n, h), scale(d.u, a * h)), scale(d.v, b * h));
          positions.push(p);
          normals.push(d.n.slice());
        }
      }
      for (let i = 0; i < seg; i++) {
        for (let j = 0; j < seg; j++) {
          const row = seg + 1;
          const p0 = base + i * row + j;
          const p1 = p0 + 1, p2 = p0 + row, p3 = p2 + 1;
          faces.push([p0, p2, p1]);
          faces.push([p1, p2, p3]);
        }
      }
    }
    return finalizeMesh(positions, faces, normals);
  }

  // Достроить меш: гарантировать массивы нормалей граней.
  function finalizeMesh(positions, faces, vertexNormals) {
    const faceNormals = faces.map((f) => {
      const n = cross(sub(positions[f[1]], positions[f[0]]),
                      sub(positions[f[2]], positions[f[0]]));
      return normalize(n);
    });
    return { positions, faces, vertexNormals, faceNormals };
  }

  const API = {
    sub, add, scale, dot, cross, length, normalize,
    rotX, rotY, rotZ, matMul, matVec, project,
    buildTorus, buildIcosphere, buildCube, finalizeMesh,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Geo = API;
})(typeof window !== 'undefined' ? window : globalThis);
