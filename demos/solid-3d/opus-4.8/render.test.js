'use strict';
const assert = require('node:assert');
const Geo = require('./geometry.js');
const Renderer = require('./renderer.js');

// ── Линейная алгебра ────────────────────────────────────────────────────────
{
  const v = Geo.matVec(Geo.rotZ(Math.PI / 2), [1, 0, 0]);
  assert.ok(Math.abs(v[0]) < 1e-9 && Math.abs(v[1] - 1) < 1e-9, 'rotZ 90° поворачивает X→Y');
  const n = Geo.normalize([3, 0, 4]);
  assert.ok(Math.abs(Geo.length(n) - 1) < 1e-12, 'normalize даёт единичный вектор');
  const c = Geo.cross([1, 0, 0], [0, 1, 0]);
  assert.deepStrictEqual(c, [0, 0, 1], 'cross(X,Y)=Z');
}

// ── Перспектива: дальше → меньше ────────────────────────────────────────────
{
  const cam = { camDist: 5, focal: 100, cx: 0, cy: 0 };
  // Камера в +Z, объект на -Z. Меньшая v[2] = дальше → больше depth z.
  const near = Geo.project([1, 0, 0], cam);    // depth = 5
  const far = Geo.project([1, 0, -2], cam);    // depth = 3 — это ближе к камере
  assert.ok(far.z < near.z, 'точка с меньшим z-видом ближе к камере (меньше depth)');
  assert.ok(far.x > near.x, 'ближняя к камере точка проецируется дальше от центра');
}

// ── Меши: непустые, нормали единичные ───────────────────────────────────────
{
  const torus = Geo.buildTorus(1, 0.4, 16, 8);
  assert.strictEqual(torus.positions.length, 16 * 8, 'тор: верное число вершин');
  assert.strictEqual(torus.faces.length, 16 * 8 * 2, 'тор: 2 треугольника на квад');
  for (const nrm of torus.vertexNormals)
    assert.ok(Math.abs(Geo.length(nrm) - 1) < 1e-9, 'нормаль вершины тора единична');

  const sph = Geo.buildIcosphere(1, 2);
  assert.strictEqual(sph.faces.length, 20 * 4 * 4, 'икосфера: 20*4^subdiv граней');
  for (const p of sph.positions)
    assert.ok(Math.abs(Geo.length(p) - 1) < 1e-9, 'вершина икосферы на сфере R=1');

  const cube = Geo.buildCube(2);
  assert.ok(cube.faces.length > 0 && cube.positions.length > 0, 'куб непуст');
}

// ── Backface culling: задняя грань отсекается ───────────────────────────────
{
  // Один треугольник, направленный от камеры (по часовой в экране) — отсекается.
  const mesh = {
    positions: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]],
    faces: [[0, 1, 2]],        // лицевой
    vertexNormals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
    faceNormals: [[0, 0, 1]],
  };
  const W = 40, H = 40;
  const opts = {
    camDist: 4, focal: 60, lightPos: [0, 0, 5], baseColor: [200, 200, 200],
    ambient: 0.2, diffuse: 0.8, specular: 0, shininess: 8, smooth: false,
  };
  const buf = { color: new Uint8ClampedArray(W * H * 4), depth: new Float32Array(W * H) };
  buf.depth.fill(Infinity);
  const front = Renderer.renderMesh(buf, W, H, mesh, Geo.rotY(0), opts);
  assert.strictEqual(front.drawn, 1, 'лицевая грань рисуется');
  assert.strictEqual(front.culled, 0, 'лицевая грань не отсекается');

  // Та же грань с обратным порядком вершин → задняя → culled.
  const back = { ...mesh, faces: [[0, 2, 1]], faceNormals: [[0, 0, -1]] };
  buf.depth.fill(Infinity);
  const r2 = Renderer.renderMesh(buf, W, H, back, Geo.rotY(0), opts);
  assert.strictEqual(r2.drawn, 0, 'задняя грань не рисуется');
  assert.strictEqual(r2.culled, 1, 'задняя грань отсечена backface culling');
}

// ── Z-буфер: ближний треугольник перекрывает дальний, без артефактов ────────
{
  const W = 20, H = 20;
  const opts = {
    camDist: 4, focal: 40, lightPos: [0, 0, 5], baseColor: [255, 255, 255],
    ambient: 1, diffuse: 0, specular: 0, shininess: 8, smooth: false,
  };
  const buf = { color: new Uint8ClampedArray(W * H * 4), depth: new Float32Array(W * H) };
  buf.depth.fill(Infinity);

  // Камера в +Z смотрит на объект; depth = worldZ + camDist, меньше = ближе.
  // Значит квад с worldZ=-1 (depth 3) БЛИЖЕ, чем с worldZ=+1 (depth 5).
  const FAR_Z = 1, NEAR_Z = -1;
  const quad = (z) => ({
    positions: [[-1, -1, z], [1, -1, z], [1, 1, z], [-1, 1, z]],
    faces: [[0, 1, 2], [0, 2, 3]],
    vertexNormals: [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
    faceNormals: [[0, 0, 1], [0, 0, 1]],
  });
  // Рисуем СНАЧАЛА ближний (красный), потом дальний (синий).
  // z-буфер обязан сохранить ближний независимо от порядка рисования.
  opts.baseColor = [255, 0, 0];
  Renderer.renderMesh(buf, W, H, quad(NEAR_Z), Geo.rotY(0), opts);
  const ci = (10 * W + 10) * 4;
  const nearDepth = buf.depth[10 * W + 10];
  opts.baseColor = [0, 0, 255];
  Renderer.renderMesh(buf, W, H, quad(FAR_Z), Geo.rotY(0), opts);
  assert.ok(Math.abs(buf.depth[10 * W + 10] - nearDepth) < 1e-6,
    'z-буфер не перезаписан дальним квадом — глубина корректна');
  assert.strictEqual(buf.color[ci], 255, 'в центре остался ближний (красный), не дальний');
  assert.strictEqual(buf.color[ci + 2], 0, 'синий дальний не пробился сквозь z-буфер');
}

// ── Освещение: фронтальная нормаль ярче боковой ─────────────────────────────
{
  const opts = { ambient: 0.1, diffuse: 1, specular: 0, shininess: 8 };
  const light = [0, 0, 10];
  const front = Renderer.shade([0, 0, 0], [0, 0, 1], light, opts);
  const side = Renderer.shade([0, 0, 0], [1, 0, 0], light, opts);
  assert.ok(front > side, 'нормаль к свету ярче нормали вбок');
  assert.ok(side <= opts.ambient + 1e-9, 'боковая/обратная — только ambient (без fill)');
}

// ── Заполняющий полусферический свет: верх не уходит в чёрную тень ───────────
{
  const light = [0, 0, 10];
  const opts = { ambient: 0.3, diffuse: 0.85, fill: 0.18, specular: 0, shininess: 8 };
  // Нормаль вверх (+Y), спиной к основному свету (нет diffuse) — но fill её лифтит.
  const up = Renderer.shade([0, 0, 0], [0, 1, 0], light, opts);
  const downAway = Renderer.shade([0, 0, 0], [0, -1, 0], light, opts);
  assert.ok(up > opts.ambient + 1e-6, 'верхняя грань подсвечена fill-светом выше ambient');
  assert.ok(up > downAway, 'верх ярче низа за счёт полусферического fill');
  assert.ok(Math.abs(downAway - opts.ambient) < 1e-9, 'нижняя грань: только ambient (fill=0)');
}

console.log('OK: все проверки софт-рендера пройдены');
