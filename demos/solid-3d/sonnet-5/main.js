'use strict';
(function () {
  const R3 = window.Render3D;

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: false });

  const btnFill = document.getElementById('btn-fill');
  const btnShade = document.getElementById('btn-shade');

  // ---------------------------------------------------------------------
  // Состояние переключателей
  // ---------------------------------------------------------------------
  const state = {
    wireframe: false,
    smooth: true,
  };

  function updateButtons() {
    btnFill.textContent = state.wireframe ? 'Заливка' : 'Каркас';
    btnFill.setAttribute('aria-pressed', String(state.wireframe));
    btnShade.textContent = state.smooth ? 'Плоское затенение' : 'Гладкое (Гуро)';
    btnShade.setAttribute('aria-pressed', String(!state.smooth));
    btnShade.disabled = state.wireframe;
    btnShade.classList.toggle('is-disabled', state.wireframe);
  }

  btnFill.addEventListener('click', () => {
    state.wireframe = !state.wireframe;
    updateButtons();
  });
  btnShade.addEventListener('click', () => {
    if (state.wireframe) return;
    state.smooth = !state.smooth;
    updateButtons();
  });
  updateButtons();

  // ---------------------------------------------------------------------
  // Геометрия: икосфера (подразделённый икосаэдр), радиус модели = 1.
  // Нормаль вершины сферы, центрированной в начале координат, совпадает
  // с нормализованной позицией вершины — считать отдельно не нужно.
  // ---------------------------------------------------------------------
  function buildIcosphere(subdivisions) {
    const t = (1 + Math.sqrt(5)) / 2;

    function norm(x, y, z) {
      const len = Math.sqrt(x * x + y * y + z * z);
      return { x: x / len, y: y / len, z: z / len };
    }

    let vertices = [
      norm(-1, t, 0), norm(1, t, 0), norm(-1, -t, 0), norm(1, -t, 0),
      norm(0, -1, t), norm(0, 1, t), norm(0, -1, -t), norm(0, 1, -t),
      norm(t, 0, -1), norm(t, 0, 1), norm(-t, 0, -1), norm(-t, 0, 1),
    ];

    let faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];

    const midCache = new Map();
    function midpoint(i1, i2) {
      const key = i1 < i2 ? i1 + '_' + i2 : i2 + '_' + i1;
      const cached = midCache.get(key);
      if (cached !== undefined) return cached;
      const a = vertices[i1], b = vertices[i2];
      const m = norm((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      vertices.push(m);
      const idx = vertices.length - 1;
      midCache.set(key, idx);
      return idx;
    }

    for (let s = 0; s < subdivisions; s++) {
      const next = [];
      for (const [a, b, c] of faces) {
        const ab = midpoint(a, b);
        const bc = midpoint(b, c);
        const ca = midpoint(c, a);
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = next;
    }

    return { vertices, faces };
  }

  const geometry = buildIcosphere(2); // 20 * 4^2 = 320 треугольников
  const vertexCount = geometry.vertices.length;

  // ---------------------------------------------------------------------
  // Сцена: объект, камера, точечный источник света (все величины — в
  // абстрактных единицах, где радиус объекта = 1; это позволяет не
  // завязываться на конкретное разрешение canvas).
  // ---------------------------------------------------------------------
  const CAMERA_DISTANCE = 3.6; // расстояние от камеры до центра объекта (радиус объекта = 1)
  const FOV = Math.PI / 4.4;   // вертикальный угол обзора камеры

  const lightPos = { x: -2.1, y: 1.7, z: 1.0 }; // в системе координат камеры
  const baseColor = { r: 96, g: 178, b: 232 };
  const AMBIENT = 0.16;
  const DIFFUSE = 0.92;
  const SPEC = 0.55;
  const SPEC_POWER = 28;

  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  // Освещение по Ламберту + блик Блинна-Фонга в точке pos с нормалью normal.
  // pos и lightScaled должны быть в одной системе единиц (в пиксельном
  // масштабе кадра, см. scaleFit в render()) — иначе точечный источник
  // "схлопнется" в почти-фонарик у камеры относительно масштаба объекта.
  function shadeAt(pos, normal, lightScaled) {
    const toLight = R3.sub(lightScaled, pos);
    const dist = R3.length(toLight);
    const lightDir = dist > 1e-9 ? R3.scale(toLight, 1 / dist) : { x: 0, y: 0, z: 1 };
    const ndotl = Math.max(0, R3.dot(normal, lightDir));

    const viewDir = R3.normalize(R3.scale(pos, -1));
    const halfVec = R3.normalize(R3.add(lightDir, viewDir));
    const spec = Math.pow(Math.max(0, R3.dot(normal, halfVec)), SPEC_POWER);

    const intensity = AMBIENT + DIFFUSE * ndotl;
    const specAdd = SPEC * spec * 255;

    return {
      r: clamp255(baseColor.r * intensity + specAdd),
      g: clamp255(baseColor.g * intensity + specAdd),
      b: clamp255(baseColor.b * intensity + specAdd),
    };
  }

  // ---------------------------------------------------------------------
  // Растеризация: буфер кадра (packed RGBA) + z-буфер (invZ, per-pixel).
  // ---------------------------------------------------------------------
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0, height = 0;
  let imageData = null;
  let pixels32 = null; // Uint32Array-вид поверх imageData.data.buffer
  let zbuffer = null;

  // Небольшой scratch-буфер для упаковки RGB(A) в нативный порядок байт
  // платформы — чтобы не гадать little/big endian руками.
  const packBuf = new ArrayBuffer(4);
  const packBytes = new Uint8ClampedArray(packBuf);
  const packView = new Uint32Array(packBuf);
  function packColor(r, g, b) {
    packBytes[0] = r; packBytes[1] = g; packBytes[2] = b; packBytes[3] = 255;
    return packView[0];
  }

  const BG_COLOR = packColor(10, 12, 20);

  function resize() {
    width = Math.max(1, Math.floor(window.innerWidth * dpr));
    height = Math.max(1, Math.floor(window.innerHeight * dpr));
    canvas.width = width;
    canvas.height = height;
    imageData = ctx.createImageData(width, height);
    pixels32 = new Uint32Array(imageData.data.buffer);
    zbuffer = new Float32Array(width * height);
  }
  window.addEventListener('resize', resize);
  resize();

  function edge(a, b, px, py) {
    return (px - a.x) * (b.y - a.y) - (py - a.y) * (b.x - a.x);
  }

  // Растеризация одного треугольника с перспективно-корректной
  // интерполяцией цвета и z-буфером по invZ (больше invZ => ближе к камере).
  function rasterizeTriangle(p0, p1, p2, c0, c1, c2) {
    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
    if (minX > maxX || minY > maxY) return;

    const area = edge(p0, p1, p2.x, p2.y);
    if (Math.abs(area) < 1e-9) return;
    const invArea = 1 / area;

    const r0z = c0.r * p0.invZ, g0z = c0.g * p0.invZ, b0z = c0.b * p0.invZ;
    const r1z = c1.r * p1.invZ, g1z = c1.g * p1.invZ, b1z = c1.b * p1.invZ;
    const r2z = c2.r * p2.invZ, g2z = c2.g * p2.invZ, b2z = c2.b * p2.invZ;

    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      let rowOffset = y * width;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = edge(p1, p2, px, py);
        const w1 = edge(p2, p0, px, py);
        const w2 = edge(p0, p1, px, py);
        const inside = (w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0);
        if (!inside) continue;

        const l0 = w0 * invArea, l1 = w1 * invArea, l2 = w2 * invArea;
        const invZ = l0 * p0.invZ + l1 * p1.invZ + l2 * p2.invZ;
        const idx = rowOffset + x;
        if (invZ <= zbuffer[idx]) continue;
        zbuffer[idx] = invZ;

        const z = 1 / invZ;
        const r = clamp255(z * (l0 * r0z + l1 * r1z + l2 * r2z));
        const g = clamp255(z * (l0 * g0z + l1 * g1z + l2 * g2z));
        const b = clamp255(z * (l0 * b0z + l1 * b1z + l2 * b2z));
        pixels32[idx] = packColor(r | 0, g | 0, b | 0);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Основной цикл: dt-based анимация с клампом большого dt.
  // ---------------------------------------------------------------------
  let angleX = 0.4;
  let angleY = 0;
  let lastTs = null;

  const camera = { width: 0, height: 0, fov: FOV };
  const cameraOrigin = { x: 0, y: 0, z: 0 };

  const viewVerts = new Array(vertexCount);
  const screenPts = new Array(vertexCount);
  const vertColors = new Array(vertexCount);

  function render() {
    camera.width = width;
    camera.height = height;
    // project() масштабирует по camera.height (вертикальный FOV). На узких
    // (портретных) вьюпортах это давало бы обрезку сферы по бокам — сужаем
    // эффективный FOV пропорционально height/minDim, чтобы объект всегда
    // помещался по меньшей стороне вьюпорта независимо от соотношения сторон.
    const minDim = Math.min(width, height);
    camera.fov = 2 * Math.atan(Math.tan(FOV / 2) * (height / minDim));

    const scaleFit = minDim * 0.30; // масштаб объекта в пикселях
    const matrix = R3.createRotationMatrix(angleX, angleY);

    // Точечный источник пересчитан в те же пиксельные единицы, что и
    // вершины объекта (см. комментарий у shadeAt).
    const lightScaled = { x: lightPos.x * scaleFit, y: lightPos.y * scaleFit, z: lightPos.z * scaleFit };

    // Трансформация вершин и нормалей в пространство камеры + проекция.
    for (let i = 0; i < vertexCount; i++) {
      const rotated = R3.applyMatrix(matrix, geometry.vertices[i]);
      const view = {
        x: rotated.x * scaleFit,
        y: rotated.y * scaleFit,
        z: rotated.z * scaleFit + CAMERA_DISTANCE * scaleFit,
      };
      viewVerts[i] = view;
      screenPts[i] = R3.project(view, camera);
      if (state.smooth) {
        vertColors[i] = shadeAt(view, rotated, lightScaled);
      }
    }

    // Очистка кадра и z-буфера.
    pixels32.fill(BG_COLOR);
    zbuffer.fill(0);

    if (state.wireframe) {
      ctx.putImageData(imageData, 0, 0);
      ctx.strokeStyle = 'rgba(140, 200, 255, 0.9)';
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      for (const face of geometry.faces) {
        const [ia, ib, ic] = face;
        if (!R3.isFrontFace(viewVerts[ia], viewVerts[ib], viewVerts[ic], cameraOrigin)) continue;
        const a = screenPts[ia], b = screenPts[ib], c = screenPts[ic];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
      }
      ctx.stroke();
      return;
    }

    for (const face of geometry.faces) {
      const [ia, ib, ic] = face;
      const va = viewVerts[ia], vb = viewVerts[ib], vc = viewVerts[ic];
      if (!R3.isFrontFace(va, vb, vc, cameraOrigin)) continue;

      const pa = screenPts[ia], pb = screenPts[ib], pc = screenPts[ic];

      if (state.smooth) {
        rasterizeTriangle(pa, pb, pc, vertColors[ia], vertColors[ib], vertColors[ic]);
      } else {
        // Плоское затенение: единая нормаль и единый цвет на грань,
        // освещение считается в центроиде грани (в пространстве камеры,
        // масштаб света пересчитан в те же единицы, что и вершины).
        const faceNormal = R3.normalize(R3.computeNormal(va, vb, vc));
        const centroid = {
          x: (va.x + vb.x + vc.x) / 3,
          y: (va.y + vb.y + vc.y) / 3,
          z: (va.z + vb.z + vc.z) / 3,
        };
        const flat = shadeAt(centroid, faceNormal, lightScaled);
        rasterizeTriangle(pa, pb, pc, flat, flat, flat);
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  function frame(ts) {
    if (lastTs == null) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    dt = Math.min(dt, 0.05); // кламп большого dt (смена вкладки и т.п.)

    angleY += dt * 0.24;
    angleX += dt * 0.13;

    render();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
