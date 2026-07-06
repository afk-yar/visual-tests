'use strict';
const assert = require('node:assert');
const R = require('./render3d.js');

// ---- fovToFocal: 90° по вертикали => tan(45°)=1 => focal = height/2 ----
{
  const focal = R.fovToFocal(Math.PI / 2, 800);
  assert.ok(Math.abs(focal - 400) < 1e-9, `focal ожидался 400, получили ${focal}`);
}

// ---- basisFromYawPitch(0,0): тождественный базис ----
{
  const b = R.basisFromYawPitch(0, 0);
  assert.ok(Math.abs(b.forward.x - 0) < 1e-9 && Math.abs(b.forward.y - 0) < 1e-9 && Math.abs(b.forward.z - 1) < 1e-9);
  assert.ok(Math.abs(b.right.x - 1) < 1e-9 && Math.abs(b.right.y - 0) < 1e-9 && Math.abs(b.right.z - 0) < 1e-9);
  assert.ok(Math.abs(b.up.x - 0) < 1e-9 && Math.abs(b.up.y - 1) < 1e-9 && Math.abs(b.up.z - 0) < 1e-9);
}

// ---- basisFromYawPitch(90°,0): камера смотрит вдоль мировой +X ----
{
  const b = R.basisFromYawPitch(Math.PI / 2, 0);
  assert.ok(Math.abs(b.forward.x - 1) < 1e-9 && Math.abs(b.forward.y - 0) < 1e-9 && Math.abs(b.forward.z - 0) < 1e-9);
  assert.ok(Math.abs(b.right.x - 0) < 1e-9 && Math.abs(b.right.y - 0) < 1e-9 && Math.abs(b.right.z + 1) < 1e-9);
  assert.ok(Math.abs(b.up.x - 0) < 1e-9 && Math.abs(b.up.y - 1) < 1e-9 && Math.abs(b.up.z - 0) < 1e-9);
}

// ---- worldToCamera: перенос + тождественный базис ----
{
  const basis = R.basisFromYawPitch(0, 0);
  const p1 = R.worldToCamera({ x: 5, y: 2, z: 10 }, { x: 0, y: 0, z: 0 }, basis);
  assert.equal(p1.x, 5); assert.equal(p1.y, 2); assert.equal(p1.z, 10);

  const p2 = R.worldToCamera({ x: 5, y: 2, z: 10 }, { x: 1, y: 1, z: 1 }, basis);
  assert.equal(p2.x, 4); assert.equal(p2.y, 1); assert.equal(p2.z, 9);
}

// ---- project: известная точка в системе координат камеры ----
{
  // focal=400, width=800,height=600 (центр экрана 400,300)
  const p = R.project({ x: 100, y: 50, z: 200 }, 400, 800, 600);
  assert.ok(Math.abs(p.scale - 2) < 1e-9, `scale ожидался 2, получили ${p.scale}`);
  assert.ok(Math.abs(p.x - 600) < 1e-9, `x ожидался 600, получили ${p.x}`);
  assert.ok(Math.abs(p.y - 200) < 1e-9, `y ожидался 200, получили ${p.y}`);
  assert.equal(p.depth, 200);
  assert.equal(p.behind, false);

  // точка за спиной камеры (z<=0) должна помечаться behind
  const behind = R.project({ x: 0, y: 0, z: -5 }, 400, 800, 600);
  assert.equal(behind.behind, true);
}

// ---- projectPoint: полный пайплайн мир -> камера -> экран ----
{
  const camera = {
    position: { x: 0, y: 0, z: -500 },
    basis: R.basisFromYawPitch(0, 0),
  };
  const focal = R.fovToFocal(Math.PI / 2, 600); // = 300
  const params = { focal, width: 800, height: 600 };
  const proj = R.projectPoint({ x: 100, y: 50, z: -300 }, camera, params);
  // camera-space: dx=100, dy=50, dz = -300-(-500) = 200 => scale = 300/200 = 1.5
  assert.ok(Math.abs(proj.scale - 1.5) < 1e-9, `scale ожидался 1.5, получили ${proj.scale}`);
  assert.ok(Math.abs(proj.x - 550) < 1e-9, `x ожидался 550, получили ${proj.x}`);
  assert.ok(Math.abs(proj.y - 225) < 1e-9, `y ожидался 225, получили ${proj.y}`);
  assert.equal(proj.depth, 200);
}

// ---- sortByDepthDesc: дальние объекты идут первыми (рисуются первыми) ----
{
  const items = [
    { id: 'a', depth: 50 },
    { id: 'b', depth: 200 },
    { id: 'c', depth: 10 },
    { id: 'd', depth: 120 },
  ];
  const sorted = R.sortByDepthDesc(items, (o) => o.depth);
  assert.deepEqual(sorted.map((o) => o.id), ['b', 'd', 'a', 'c']);
  // исходный массив не мутирован
  assert.equal(items[0].id, 'a');
  // первый элемент — самый дальний, последний — самый ближний
  assert.equal(sorted[0].depth, 200);
  assert.equal(sorted[sorted.length - 1].depth, 10);
}

// ---- базовая проверка векторной алгебры, используемой в main.js ----
{
  const n = R.normalize({ x: 3, y: 0, z: 4 });
  assert.ok(Math.abs(n.x - 0.6) < 1e-9 && Math.abs(n.z - 0.8) < 1e-9);
  const c = R.cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  assert.equal(c.x, 0); assert.equal(c.y, 0); assert.equal(c.z, 1);
}

console.log('Тесты render3d (проекция + сортировка по глубине) пройдены.');
