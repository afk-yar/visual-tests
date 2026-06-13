'use strict';
// Софт-растеризатор: z-буфер, плоское и Гуро-затенение, backface culling.
// Dual-mode: window.Renderer / module.exports.
(function (root) {
  const Geo = (typeof module !== 'undefined' && module.exports)
    ? require('./geometry.js')
    : root.Geo;

  // Освещение по Фонгу для одной точки/нормали → коэффициент яркости (0..~1.4).
  // lightPos и точка — в координатах вида (после поворота). Камера в (0,0,0).
  function shade(point, normal, lightPos, opts) {
    const L = Geo.normalize(Geo.sub(lightPos, point));
    let diff = Geo.dot(normal, L);
    if (diff < 0) diff = 0;
    // Зеркальный блик (Блинна–Фонга): half между светом и взглядом.
    const V = Geo.normalize(Geo.scale(point, -1)); // к камере
    const H = Geo.normalize(Geo.add(L, V));
    let spec = Geo.dot(normal, H);
    spec = spec > 0 ? Math.pow(spec, opts.shininess) : 0;
    // Полусферический заполняющий свет: верхняя сторона мягко подсвечена,
    // чтобы тело не уходило в чёрную тень даже спиной к основному источнику.
    const fillK = opts.fill ? opts.fill * (0.5 + 0.5 * normal[1]) : 0;
    return opts.ambient + fillK + opts.diffuse * diff + opts.specular * spec;
  }

  function applyColor(base, k) {
    return [
      Math.min(255, base[0] * k),
      Math.min(255, base[1] * k),
      Math.min(255, base[2] * k),
    ];
  }

  // Растеризация одного треугольника в z-буфер.
  // p0..p2 — { x, y, z } (экран + глубина). При smooth — c0..c2 цвета вершин.
  // При flat — flatColor единый. Глубина: меньше z = ближе (перекрывает).
  function rasterize(buf, W, H, p0, p1, p2, smooth, c0, c1, c2, flatColor) {
    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
    if (minX > maxX || minY > maxY) return;

    // Площадь (знаковая) для барицентрики.
    const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
    if (area === 0) return;
    const invArea = 1 / area;

    const data = buf.color, zb = buf.depth;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        // Барицентрические координаты.
        let w0 = ((p1.x - px) * (p2.y - py) - (p2.x - px) * (p1.y - py)) * invArea;
        let w1 = ((p2.x - px) * (p0.y - py) - (p0.x - px) * (p2.y - py)) * invArea;
        let w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // Интерполяция глубины.
        const z = w0 * p0.z + w1 * p1.z + w2 * p2.z;
        const di = y * W + x;
        if (z >= zb[di]) continue; // дальше уже нарисованного — пропуск
        zb[di] = z;
        let r, g, b;
        if (smooth) {
          r = w0 * c0[0] + w1 * c1[0] + w2 * c2[0];
          g = w0 * c0[1] + w1 * c1[1] + w2 * c2[1];
          b = w0 * c0[2] + w1 * c1[2] + w2 * c2[2];
        } else {
          r = flatColor[0]; g = flatColor[1]; b = flatColor[2];
        }
        const pi = di * 4;
        data[pi] = r; data[pi + 1] = g; data[pi + 2] = b; data[pi + 3] = 255;
      }
    }
  }

  // Полный кадр. mesh — из Geo.build*; rot — матрица 3x3 (поворот по 2 осям);
  // возвращает { drawn, culled } для тестов/диагностики.
  function renderMesh(buf, W, H, mesh, rot, opts) {
    const cam = {
      camDist: opts.camDist, focal: opts.focal,
      cx: W / 2, cy: H / 2,
    };
    // Свет задан в мире; повернём его вместе со сценой для устойчивости бликов.
    const lightPos = Geo.matVec(rot, opts.lightPos);

    // 1. Трансформ вершин + проекция.
    const n = mesh.positions.length;
    const view = new Array(n);     // позиции в координатах вида
    const vnorm = new Array(n);    // повёрнутые нормали вершин
    const proj = new Array(n);     // экранные проекции
    const vcol = new Array(n);     // цвета вершин (для Гуро)
    const smooth = opts.smooth;
    for (let i = 0; i < n; i++) {
      const p = Geo.matVec(rot, mesh.positions[i]);
      view[i] = p;
      proj[i] = Geo.project(p, cam);
      if (smooth) {
        const nrm = Geo.matVec(rot, mesh.vertexNormals[i]);
        vnorm[i] = nrm;
        const k = shade(p, nrm, lightPos, opts);
        vcol[i] = applyColor(opts.baseColor, k);
      }
    }

    let drawn = 0, culled = 0;
    const faces = mesh.faces;
    for (let fi = 0; fi < faces.length; fi++) {
      const f = faces[fi];
      const a = proj[f[0]], b = proj[f[1]], c = proj[f[2]];
      // 2. Backface culling в экранном пространстве (знак площади).
      // CCW при взгляде = лицевая. Y экрана инвертирован → лицевая даёт area<0.
      const screenArea = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      if (screenArea >= 0) { culled++; continue; }
      // Отсечь грани за/в плоскости камеры.
      if (a.z <= 0.01 || b.z <= 0.01 || c.z <= 0.01) { culled++; continue; }

      if (smooth) {
        rasterize(buf, W, H, a, b, c, true,
          vcol[f[0]], vcol[f[1]], vcol[f[2]], null);
      } else {
        // Плоское: одна нормаль грани, цвет в центроиде.
        const fn = Geo.matVec(rot, mesh.faceNormals[fi]);
        const centroid = Geo.scale(
          Geo.add(Geo.add(view[f[0]], view[f[1]]), view[f[2]]), 1 / 3);
        const k = shade(centroid, fn, lightPos, opts);
        rasterize(buf, W, H, a, b, c, false, null, null, null,
          applyColor(opts.baseColor, k));
      }
      drawn++;
    }
    return { drawn, culled };
  }

  const API = { shade, applyColor, rasterize, renderMesh };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Renderer = API;
})(typeof window !== 'undefined' ? window : globalThis);
