(function () {
  'use strict';

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  const faceCountEl = document.getElementById('faceCount');
  const fpsEl = document.getElementById('fps');
  const ui = {
    fill: document.getElementById('fillMode'),
    wire: document.getElementById('wireMode'),
    flat: document.getElementById('flatShade'),
    smooth: document.getElementById('smoothShade')
  };

  const state = { display: 'fill', shading: 'smooth' };
  const TAU = Math.PI * 2;
  const U_SEGMENTS = 40;
  const V_SEGMENTS = 20;
  const MAJOR_RADIUS = 1.42;
  const MINOR_RADIUS = 0.57;
  const CAMERA_DISTANCE = 5.65;
  const LIGHT = [-3.4, 3.8, 1.25];

  let dpr = 1;
  let focalLength = 1;
  let regionSize = 1;
  let regionX = 0;
  let regionY = 0;
  let frameImage = null;
  let pixels = null;
  let zBuffer = null;
  let angleX = 0.78;
  let angleY = -0.32;
  let previousTime = 0;
  let fpsTime = 0;
  let fpsFrames = 0;

  function createTorus() {
    const count = U_SEGMENTS * V_SEGMENTS;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const baseColors = new Float32Array(count * 3);
    const faces = new Uint16Array(U_SEGMENTS * V_SEGMENTS * 6);
    let p = 0;

    for (let u = 0; u < U_SEGMENTS; u++) {
      const au = u / U_SEGMENTS * TAU;
      const cu = Math.cos(au);
      const su = Math.sin(au);
      for (let v = 0; v < V_SEGMENTS; v++) {
        const av = v / V_SEGMENTS * TAU;
        const cv = Math.cos(av);
        const sv = Math.sin(av);
        const ring = MAJOR_RADIUS + MINOR_RADIUS * cv;
        const i = (u * V_SEGMENTS + v) * 3;

        positions[i] = ring * cu;
        positions[i + 1] = MINOR_RADIUS * sv;
        positions[i + 2] = ring * su;
        normals[i] = cv * cu;
        normals[i + 1] = sv;
        normals[i + 2] = cv * su;

        const tint = 0.5 + 0.5 * sv;
        baseColors[i] = 52 + 35 * tint;
        baseColors[i + 1] = 112 + 46 * tint;
        baseColors[i + 2] = 198 + 42 * tint;
      }
    }

    for (let u = 0; u < U_SEGMENTS; u++) {
      const un = (u + 1) % U_SEGMENTS;
      for (let v = 0; v < V_SEGMENTS; v++) {
        const vn = (v + 1) % V_SEGMENTS;
        const a = u * V_SEGMENTS + v;
        const b = un * V_SEGMENTS + v;
        const c = un * V_SEGMENTS + vn;
        const d = u * V_SEGMENTS + vn;
        faces[p++] = a; faces[p++] = d; faces[p++] = c;
        faces[p++] = a; faces[p++] = c; faces[p++] = b;
      }
    }
    return { count, positions, normals, baseColors, faces };
  }

  const mesh = createTorus();
  const transformed = new Float32Array(mesh.count * 3);
  const transformedNormals = new Float32Array(mesh.count * 3);
  const projectedX = new Float32Array(mesh.count);
  const projectedY = new Float32Array(mesh.count);
  const inverseZ = new Float32Array(mesh.count);
  const vertexColors = new Float32Array(mesh.count * 3);
  const visibleFaces = [];

  function rotationX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [1, 0, 0, 0, c, -s, 0, s, c];
  }

  function rotationY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [c, 0, s, 0, 1, 0, -s, 0, c];
  }

  function multiplyMat3(a, b) {
    const out = new Float32Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        out[r * 3 + c] =
          a[r * 3] * b[c] +
          a[r * 3 + 1] * b[c + 3] +
          a[r * 3 + 2] * b[c + 6];
      }
    }
    return out;
  }

  function normalize3(x, y, z) {
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
  }

  function shade(nx, ny, nz, px, py, pz, br, bg, bb) {
    let lx = LIGHT[0] - px;
    let ly = LIGHT[1] - py;
    let lz = LIGHT[2] - pz;
    const lightDistance = Math.hypot(lx, ly, lz) || 1;
    lx /= lightDistance; ly /= lightDistance; lz /= lightDistance;

    let vx = -px, vy = -py, vz = -pz;
    const viewDistance = Math.hypot(vx, vy, vz) || 1;
    vx /= viewDistance; vy /= viewDistance; vz /= viewDistance;

    let hx = lx + vx, hy = ly + vy, hz = lz + vz;
    const halfDistance = Math.hypot(hx, hy, hz) || 1;
    hx /= halfDistance; hy /= halfDistance; hz /= halfDistance;

    const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz);
    const attenuation = 1 / (1 + lightDistance * lightDistance * 0.026);
    const specular = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), 34) * attenuation;
    const light = 0.17 + 1.08 * diffuse * attenuation;

    return [
      Math.min(255, br * light + 150 * specular),
      Math.min(255, bg * light + 215 * specular),
      Math.min(255, bb * light + 255 * specular)
    ];
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
    focalLength = Math.min(canvas.width, canvas.height) * 0.72;
    regionSize = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) * 0.94));
    regionX = Math.floor((canvas.width - regionSize) * 0.5);
    regionY = Math.floor((canvas.height - regionSize) * 0.5);
    frameImage = ctx.createImageData(regionSize, regionSize);
    pixels = frameImage.data;
    zBuffer = new Float32Array(regionSize * regionSize);
  }

  function transformMesh(matrix) {
    const centerX = canvas.width * 0.5;
    const centerY = canvas.height * 0.5;
    const p = mesh.positions;
    const n = mesh.normals;
    const b = mesh.baseColors;

    for (let i = 0; i < mesh.count; i++) {
      const k = i * 3;
      const x = p[k], y = p[k + 1], z = p[k + 2];
      const nx = n[k], ny = n[k + 1], nz = n[k + 2];
      const tx = matrix[0] * x + matrix[1] * y + matrix[2] * z;
      const ty = matrix[3] * x + matrix[4] * y + matrix[5] * z;
      const tz = matrix[6] * x + matrix[7] * y + matrix[8] * z + CAMERA_DISTANCE;
      const tnx = matrix[0] * nx + matrix[1] * ny + matrix[2] * nz;
      const tny = matrix[3] * nx + matrix[4] * ny + matrix[5] * nz;
      const tnz = matrix[6] * nx + matrix[7] * ny + matrix[8] * nz;

      transformed[k] = tx; transformed[k + 1] = ty; transformed[k + 2] = tz;
      transformedNormals[k] = tnx;
      transformedNormals[k + 1] = tny;
      transformedNormals[k + 2] = tnz;
      inverseZ[i] = 1 / tz;
      projectedX[i] = centerX + focalLength * tx / tz;
      projectedY[i] = centerY - focalLength * ty / tz;

      const color = shade(tnx, tny, tnz, tx, ty, tz, b[k], b[k + 1], b[k + 2]);
      vertexColors[k] = color[0];
      vertexColors[k + 1] = color[1];
      vertexColors[k + 2] = color[2];
    }
  }

  function collectVisibleFaces() {
    visibleFaces.length = 0;
    const f = mesh.faces;
    const p = transformed;

    for (let i = 0; i < f.length; i += 3) {
      const ia = f[i], ib = f[i + 1], ic = f[i + 2];
      const a = ia * 3, b = ib * 3, c = ic * 3;
      const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
      const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
      let nx = aby * acz - abz * acy;
      let ny = abz * acx - abx * acz;
      let nz = abx * acy - aby * acx;
      const normal = normalize3(nx, ny, nz);
      nx = normal[0]; ny = normal[1]; nz = normal[2];
      const cx = (p[a] + p[b] + p[c]) / 3;
      const cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
      const cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;

      if (nx * cx + ny * cy + nz * cz < 0) {
        const base = mesh.baseColors;
        const flatColor = shade(
          nx, ny, nz, cx, cy, cz,
          (base[a] + base[b] + base[c]) / 3,
          (base[a + 1] + base[b + 1] + base[c + 1]) / 3,
          (base[a + 2] + base[b + 2] + base[c + 2]) / 3
        );
        visibleFaces.push({ ia, ib, ic, flatColor });
      }
    }
  }

  function orient(ax, ay, bx, by, px, py) {
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  }

  function rasterTriangle(face, depthOnly) {
    const ia = face.ia, ib = face.ib, ic = face.ic;
    const x0 = projectedX[ia] - regionX, y0 = projectedY[ia] - regionY;
    const x1 = projectedX[ib] - regionX, y1 = projectedY[ib] - regionY;
    const x2 = projectedX[ic] - regionX, y2 = projectedY[ic] - regionY;
    let area = orient(x0, y0, x1, y1, x2, y2);
    if (Math.abs(area) < 0.0001) return;
    const sign = area < 0 ? -1 : 1;
    area *= sign;

    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(regionSize - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(regionSize - 1, Math.ceil(Math.max(y0, y1, y2)));
    const iz0 = inverseZ[ia], iz1 = inverseZ[ib], iz2 = inverseZ[ic];
    const smooth = state.shading === 'smooth';
    const ca = ia * 3, cb = ib * 3, cc = ic * 3;

    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      const row = y * regionSize;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = orient(x1, y1, x2, y2, px, py) * sign;
        const w1 = orient(x2, y2, x0, y0, px, py) * sign;
        const w2 = orient(x0, y0, x1, y1, px, py) * sign;
        if (w0 < -0.00001 || w1 < -0.00001 || w2 < -0.00001) continue;

        const l0 = w0 / area, l1 = w1 / area, l2 = w2 / area;
        const depth = l0 * iz0 + l1 * iz1 + l2 * iz2;
        const index = row + x;
        if (depth <= zBuffer[index]) continue;
        zBuffer[index] = depth;
        if (depthOnly) continue;

        let r, g, blue;
        if (smooth) {
          r = l0 * vertexColors[ca] + l1 * vertexColors[cb] + l2 * vertexColors[cc];
          g = l0 * vertexColors[ca + 1] + l1 * vertexColors[cb + 1] + l2 * vertexColors[cc + 1];
          blue = l0 * vertexColors[ca + 2] + l1 * vertexColors[cb + 2] + l2 * vertexColors[cc + 2];
        } else {
          r = face.flatColor[0];
          g = face.flatColor[1];
          blue = face.flatColor[2];
        }
        const q = index * 4;
        pixels[q] = r;
        pixels[q + 1] = g;
        pixels[q + 2] = blue;
        pixels[q + 3] = 255;
      }
    }
  }

  function rasterLine(a, b, faceColor) {
    const x0 = projectedX[a] - regionX, y0 = projectedY[a] - regionY;
    const x1 = projectedX[b] - regionX, y1 = projectedY[b] - regionY;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    const radius = dpr > 1.35 ? 1 : 0;
    const smooth = state.shading === 'smooth';
    const ak = a * 3, bk = b * 3;

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      const depth = inverseZ[a] + (inverseZ[b] - inverseZ[a]) * t;
      let r, g, blue;
      if (smooth) {
        r = vertexColors[ak] + (vertexColors[bk] - vertexColors[ak]) * t;
        g = vertexColors[ak + 1] + (vertexColors[bk + 1] - vertexColors[ak + 1]) * t;
        blue = vertexColors[ak + 2] + (vertexColors[bk + 2] - vertexColors[ak + 2]) * t;
      } else {
        r = faceColor[0]; g = faceColor[1]; blue = faceColor[2];
      }
      r = Math.min(255, r * 1.18 + 30);
      g = Math.min(255, g * 1.18 + 38);
      blue = Math.min(255, blue * 1.16 + 46);

      for (let oy = -radius; oy <= radius; oy++) {
        const py = y + oy;
        if (py < 0 || py >= regionSize) continue;
        for (let ox = -radius; ox <= radius; ox++) {
          if (radius && Math.abs(ox) + Math.abs(oy) > 1) continue;
          const px = x + ox;
          if (px < 0 || px >= regionSize) continue;
          const index = py * regionSize + px;
          if (depth + 0.0012 < zBuffer[index]) continue;
          const q = index * 4;
          pixels[q] = r;
          pixels[q + 1] = g;
          pixels[q + 2] = blue;
          pixels[q + 3] = 245;
        }
      }
    }
  }

  function render() {
    pixels.fill(0);
    zBuffer.fill(0);
    const matrix = multiplyMat3(rotationX(angleX), rotationY(angleY));
    transformMesh(matrix);
    collectVisibleFaces();

    if (state.display === 'fill') {
      for (let i = 0; i < visibleFaces.length; i++) rasterTriangle(visibleFaces[i], false);
    } else {
      for (let i = 0; i < visibleFaces.length; i++) rasterTriangle(visibleFaces[i], true);
      for (let i = 0; i < visibleFaces.length; i++) {
        const face = visibleFaces[i];
        rasterLine(face.ia, face.ib, face.flatColor);
        rasterLine(face.ib, face.ic, face.flatColor);
        rasterLine(face.ic, face.ia, face.flatColor);
      }
    }

    ctx.putImageData(frameImage, regionX, regionY);
  }

  function setPair(first, second, selected) {
    const firstSelected = selected === first;
    first.classList.toggle('active', firstSelected);
    second.classList.toggle('active', !firstSelected);
    first.setAttribute('aria-checked', String(firstSelected));
    second.setAttribute('aria-checked', String(!firstSelected));
  }

  ui.fill.addEventListener('click', function () {
    state.display = 'fill';
    setPair(ui.fill, ui.wire, ui.fill);
  });
  ui.wire.addEventListener('click', function () {
    state.display = 'wire';
    setPair(ui.fill, ui.wire, ui.wire);
  });
  ui.flat.addEventListener('click', function () {
    state.shading = 'flat';
    setPair(ui.flat, ui.smooth, ui.flat);
  });
  ui.smooth.addEventListener('click', function () {
    state.shading = 'smooth';
    setPair(ui.flat, ui.smooth, ui.smooth);
  });

  window.addEventListener('keydown', function (event) {
    if (event.key.toLowerCase() === 'w') {
      state.display = state.display === 'fill' ? 'wire' : 'fill';
      setPair(ui.fill, ui.wire, state.display === 'fill' ? ui.fill : ui.wire);
    }
    if (event.key.toLowerCase() === 's') {
      state.shading = state.shading === 'flat' ? 'smooth' : 'flat';
      setPair(ui.flat, ui.smooth, state.shading === 'flat' ? ui.flat : ui.smooth);
    }
  });

  window.addEventListener('resize', resize, { passive: true });

  function animate(now) {
    const dt = previousTime ? Math.min((now - previousTime) / 1000, 0.05) : 0;
    previousTime = now;
    angleX = (angleX + dt * 0.19) % TAU;
    angleY = (angleY + dt * 0.27) % TAU;
    render();

    fpsFrames++;
    if (now - fpsTime > 500) {
      const fps = Math.round(fpsFrames * 1000 / Math.max(1, now - fpsTime));
      fpsEl.textContent = fps + ' FPS';
      faceCountEl.textContent = visibleFaces.length + ' граней';
      fpsFrames = 0;
      fpsTime = now;
    }
    requestAnimationFrame(animate);
  }

  resize();
  requestAnimationFrame(animate);
}());
