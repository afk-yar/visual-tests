'use strict';
const assert = require('node:assert');
const R = require('./render3d.js');

// 1) Поворот матрицей: 90° вокруг оси Y переводит (1,0,0) в (0,0,-1).
{
  const v = R.rotateVertex({ x: 1, y: 0, z: 0 }, 0, Math.PI / 2);
  assert.ok(Math.abs(v.x - 0) < 1e-9, 'x после поворота вокруг Y');
  assert.ok(Math.abs(v.y - 0) < 1e-9, 'y после поворота вокруг Y');
  assert.ok(Math.abs(v.z - -1) < 1e-9, 'z после поворота вокруг Y');
}

// 2) Поворот матрицей: 90° вокруг оси X переводит (0,1,0) в (0,0,1).
{
  const v = R.rotateVertex({ x: 0, y: 1, z: 0 }, Math.PI / 2, 0);
  assert.ok(Math.abs(v.x - 0) < 1e-9, 'x после поворота вокруг X');
  assert.ok(Math.abs(v.y - 0) < 1e-9, 'y после поворота вокруг X');
  assert.ok(Math.abs(v.z - 1) < 1e-9, 'z после поворота вокруг X');
}

// 3) Комбинированный поворот по двум осям — сверка с ручной композицией
//    Ry(angleY) * Rx(angleX), применённой как две последовательные функции.
{
  function rotateXOnly(v, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
  }
  function rotateYOnly(v, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
  }
  const v0 = { x: 0.4, y: -0.7, z: 1.1 };
  const ax = 0.35, ay = -0.8;
  const expected = rotateYOnly(rotateXOnly(v0, ax), ay);
  const got = R.rotateVertex(v0, ax, ay);
  assert.ok(Math.abs(got.x - expected.x) < 1e-9, 'x комбинированного поворота');
  assert.ok(Math.abs(got.y - expected.y) < 1e-9, 'y комбинированного поворота');
  assert.ok(Math.abs(got.z - expected.z) < 1e-9, 'z комбинированного поворота');
}

// 4) Перспективная проекция известной вершины при известных параметрах камеры.
//    fov = 90° => tan(fov/2) = 1 => focal = height/2.
{
  const camera = { width: 200, height: 200, fov: Math.PI / 2 };

  const center = R.project({ x: 0, y: 0, z: 10 }, camera);
  assert.ok(Math.abs(center.x - 100) < 1e-9, 'вершина по центру оси проецируется в центр экрана (x)');
  assert.ok(Math.abs(center.y - 100) < 1e-9, 'вершина по центру оси проецируется в центр экрана (y)');
  assert.ok(Math.abs(center.invZ - 0.1) < 1e-9, 'invZ = 1/z');

  const offset = R.project({ x: 1, y: 0, z: 10 }, camera);
  // focal = 100, invZ = 0.1 => смещение по x = 1 * 100 * 0.1 = 10 px
  assert.ok(Math.abs(offset.x - 110) < 1e-9, 'смещение по x пропорционально focal*invZ');
  assert.ok(Math.abs(offset.y - 100) < 1e-9, 'y не меняется при смещении по x');

  const closer = R.project({ x: 1, y: 0, z: 5 }, camera);
  // при вдвое меньшем z экранное смещение вдвое больше (перспектива)
  assert.ok(Math.abs(closer.x - 120) < 1e-9, 'более близкая вершина проецируется дальше от центра');
}

// 5) Backface culling: грань с нормалью, направленной от камеры, — нелицевая;
//    грань с нормалью, направленной к камере, — лицевая. Камера в начале
//    координат, треугольник лежит в плоскости z = 5 (перед камерой).
{
  const cameraPos = { x: 0, y: 0, z: 0 };

  // Обход v0->v1->v2 даёт нормаль (0,0,1) — направлена от камеры вглубь сцены.
  const away = R.isFrontFace(
    { x: 0, y: 0, z: 5 }, { x: 1, y: 0, z: 5 }, { x: 0, y: 1, z: 5 },
    cameraPos
  );
  assert.equal(away, false, 'нормаль от камеры => нелицевая грань');

  // Обратный обход той же плоскости даёт нормаль (0,0,-1) — к камере.
  const toward = R.isFrontFace(
    { x: 0, y: 0, z: 5 }, { x: 0, y: 1, z: 5 }, { x: 1, y: 0, z: 5 },
    cameraPos
  );
  assert.equal(toward, true, 'нормаль к камере => лицевая грань');
}

// 6) computeNormal возвращает вектор, коллинеарный ожидаемому, с верным знаком.
{
  const n = R.computeNormal({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  const nn = R.normalize(n);
  assert.ok(Math.abs(nn.x - 0) < 1e-9);
  assert.ok(Math.abs(nn.y - 0) < 1e-9);
  assert.ok(Math.abs(nn.z - 1) < 1e-9);
}

console.log('Тесты 3D-конвейера (render3d.js) пройдены.');
