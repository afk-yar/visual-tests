'use strict';
// Дуал-mode модуль: чистые функции 3D-конвейера софт-рендера.
// В браузере кладёт API в window.Render3D, в node — через module.exports.
// Все функции чистые (без побочных эффектов, без обращения к DOM/canvas) —
// это именно то, что тестируется в render3d.test.js через node:assert.
(function (global) {
  // ---------- векторная алгебра ----------
  function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  function scale(a, k) {
    return { x: a.x * k, y: a.y * k, z: a.z * k };
  }

  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function length(a) {
    return Math.sqrt(dot(a, a));
  }

  function normalize(a) {
    const len = length(a);
    if (len < 1e-12) return { x: 0, y: 0, z: 0 };
    return { x: a.x / len, y: a.y / len, z: a.z / len };
  }

  // ---------- матрица поворота ----------
  // Композиция Ry(angleY) * Rx(angleX): вершина сперва поворачивается
  // вокруг оси X, затем результат — вокруг оси Y. Матрица 3x3 хранится
  // как плоский массив из 9 чисел в row-major порядке.
  function createRotationMatrix(angleX, angleY) {
    const cx = Math.cos(angleX);
    const sx = Math.sin(angleX);
    const cy = Math.cos(angleY);
    const sy = Math.sin(angleY);
    return [
      cy, sy * sx, sy * cx,
      0, cx, -sx,
      -sy, cy * sx, cy * cx,
    ];
  }

  function applyMatrix(m, v) {
    return {
      x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
      y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
      z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
    };
  }

  // Удобный шорткат: поворот вершины сразу по двум осям матрицей поворота.
  function rotateVertex(v, angleX, angleY) {
    return applyMatrix(createRotationMatrix(angleX, angleY), v);
  }

  // ---------- перспективная проекция ----------
  // v — вершина в системе координат камеры (камера в начале координат,
  // смотрит вдоль +z). camera = { width, height, fov } — fov в радианах
  // (вертикальный угол обзора). Возвращает экранные координаты x,y (в
  // пикселях canvas) и invZ = 1/z — обратную глубину для z-буфера и
  // перспективно-корректной интерполяции атрибутов.
  function project(v, camera) {
    const focal = (camera.height / 2) / Math.tan(camera.fov / 2);
    const invZ = 1 / v.z;
    return {
      x: camera.width / 2 + v.x * focal * invZ,
      y: camera.height / 2 - v.y * focal * invZ,
      invZ: invZ,
    };
  }

  // ---------- нормаль грани и backface culling ----------
  // Геометрическая нормаль треугольника (не нормализована по длине для
  // скорости — знак и направление уже корректны для culling; нормализуем
  // отдельно там, где нужна единичная длина для освещения).
  function computeNormal(v0, v1, v2) {
    return cross(sub(v1, v0), sub(v2, v0));
  }

  // Грань лицевая, если её нормаль направлена в сторону камеры, т.е. угол
  // между нормалью и вектором "к камере" из центра грани острый
  // (dot > 0). cameraPos — позиция камеры в той же системе координат,
  // что и вершины треугольника (обычно {x:0,y:0,z:0} в camera space).
  function isFrontFace(v0, v1, v2, cameraPos) {
    const normal = computeNormal(v0, v1, v2);
    const centroid = {
      x: (v0.x + v1.x + v2.x) / 3,
      y: (v0.y + v1.y + v2.y) / 3,
      z: (v0.z + v1.z + v2.z) / 3,
    };
    const toCamera = sub(cameraPos, centroid);
    return dot(normal, toCamera) > 0;
  }

  const api = {
    sub, add, scale, cross, dot, length, normalize,
    createRotationMatrix, applyMatrix, rotateVertex,
    project, computeNormal, isFrontFace,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  global.Render3D = api;
})(typeof window !== 'undefined' ? window : this);
