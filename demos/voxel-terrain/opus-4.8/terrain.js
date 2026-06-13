/*
 * terrain.js — процедурная карта высот + карта цвета для VoxelSpace-рендера.
 *
 * Heightmap: value-noise (хешированная решётка + smoothstep-интерполяция),
 * собранный в фрактальный шум (fBm) из нескольких октав. Карта тороидально
 * замкнута (wrap по обеим осям), чтобы камера могла лететь бесконечно без швов.
 *
 * Colormap: высота + наклон → биом (вода, песок, трава, лес, скала, снег),
 * с лёгким затенением по локальному наклону для рельефности.
 *
 * Dual-mode: в браузере кладёт TerrainGen в window, в node — в module.exports.
 */
(function (root) {
  'use strict';

  // ── Детерминированный ГПСЧ (mulberry32) ──
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smoothstep(t) { return t * t * (3 - 2 * t); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ── Value-noise на тороидальной решётке размера N×N ──
  // Возвращает функцию (x, y) -> [0..1], плавную и бесшовно замкнутую.
  function makeValueNoise(N, rand) {
    const grid = new Float32Array(N * N);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    return function (x, y) {
      // координаты решётки (wrap)
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = smoothstep(x - xi), fy = smoothstep(y - yi);
      const x0 = ((xi % N) + N) % N, y0 = ((yi % N) + N) % N;
      const x1 = (x0 + 1) % N, y1 = (y0 + 1) % N;
      const v00 = grid[y0 * N + x0], v10 = grid[y0 * N + x1];
      const v01 = grid[y1 * N + x0], v11 = grid[y1 * N + x1];
      const top = lerp(v00, v10, fx);
      const bot = lerp(v01, v11, fx);
      return lerp(top, bot, fy);
    };
  }

  /*
   * Генерирует тороидально замкнутую карту высот и цвета размера size×size.
   * size должен быть степенью двойки (для дешёвого wrap по &(size-1)).
   *
   * Возвращает { size, height: Uint8Array, color: Uint32Array }.
   * color упакован как 0xAABBGGRR (little-endian RGBA — порядок для ImageData).
   */
  function generate(size, seed) {
    size = size || 1024;
    seed = (seed === undefined) ? 1337 : (seed | 0);
    const rand = mulberry32(seed);

    // Несколько октав value-noise на тороидальных решётках.
    // Базовая решётка делит карту так, что период кратен size → бесшовно.
    const octaves = [
      { cells: 8,  amp: 1.00 },
      { cells: 16, amp: 0.50 },
      { cells: 32, amp: 0.26 },
      { cells: 64, amp: 0.13 },
      { cells: 128, amp: 0.07 },
    ];
    const noises = octaves.map(o => ({
      n: makeValueNoise(o.cells, mulberry32(seed * 2654435761 + o.cells)),
      cells: o.cells,
      amp: o.amp,
    }));
    let ampSum = 0;
    for (const o of octaves) ampSum += o.amp;

    const height = new Uint8Array(size * size);
    const color = new Uint32Array(size * size);

    // Параметры рельефа.
    const SEA = 78;           // уровень воды (в единицах высоты 0..255)
    const ridge = 0.62;       // доля «гребневого» шума для горных хребтов

    // Первый проход: высоты.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let h = 0;
        for (const o of noises) {
          const u = (x / size) * o.cells;
          const v = (y / size) * o.cells;
          h += o.n(u, v) * o.amp;
        }
        h /= ampSum; // 0..1

        // Гребневой шум: добавляет острые горные хребты.
        const r = 1 - Math.abs(2 * h - 1);
        let e = lerp(h, r * r, ridge);

        // Перераспределение: больше равнин/воды снизу, резкие пики сверху.
        e = Math.pow(clamp(e, 0, 1), 1.65);

        height[y * size + x] = clamp(Math.round(e * 255), 0, 255);
      }
    }

    // Второй проход: цвет с затенением по наклону.
    const mask = size - 1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        const h = height[idx];

        // Наклон по соседям (тороидальный sample).
        const hl = height[y * size + ((x - 1) & mask)];
        const hr = height[y * size + ((x + 1) & mask)];
        const hu = height[((y - 1) & mask) * size + x];
        const hd = height[((y + 1) & mask) * size + x];
        const slope = (Math.abs(hr - hl) + Math.abs(hd - hu)) * 0.5; // ~0..255

        let r, g, b;
        if (h < SEA) {
          // Вода: глубина → от тёмно-синего к бирюзовому у берега.
          const depth = (SEA - h) / SEA; // 0 у берега .. 1 в глубине
          r = lerp(40, 8, depth);
          g = lerp(120, 36, depth);
          b = lerp(150, 70, depth);
          // блик у самой кромки
          if (depth < 0.10) { r += 30; g += 30; b += 25; }
        } else {
          const t = (h - SEA) / (255 - SEA); // 0..1 над водой
          if (t < 0.04) {
            // песчаный пляж
            r = 196; g = 178; b = 128;
          } else if (t < 0.40) {
            // трава: ниже сочнее, выше суше
            const k = t / 0.40;
            r = lerp(70, 116, k);
            g = lerp(120, 132, k);
            b = lerp(56, 70, k);
          } else if (t < 0.62) {
            // лес / тёмная зелень
            const k = (t - 0.40) / 0.22;
            r = lerp(58, 78, k);
            g = lerp(96, 86, k);
            b = lerp(52, 58, k);
          } else if (t < 0.82) {
            // скалы
            const k = (t - 0.62) / 0.20;
            r = lerp(104, 138, k);
            g = lerp(98, 132, k);
            b = lerp(92, 128, k);
          } else {
            // снег
            const k = (t - 0.82) / 0.18;
            r = lerp(214, 250, k);
            g = lerp(220, 252, k);
            b = lerp(228, 255, k);
          }
          // крутые склоны темнее и «каменистее»
          const steep = clamp(slope / 26, 0, 1);
          if (h >= SEA && t >= 0.04) {
            r = lerp(r, r * 0.6 + 60, steep * 0.7);
            g = lerp(g, g * 0.6 + 54, steep * 0.7);
            b = lerp(b, b * 0.6 + 52, steep * 0.7);
          }
        }

        // Псевдо-освещение: северо-западный «солнечный» уклон подсвечивает,
        // юго-восточный затемняет — даёт объём холмам.
        const light = clamp(((hl - hr) + (hu - hd)) / 64, -1, 1);
        const shade = 1 + light * 0.18;
        r = clamp(r * shade, 0, 255);
        g = clamp(g * shade, 0, 255);
        b = clamp(b * shade, 0, 255);

        color[idx] = (255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r);
      }
    }

    return { size: size, height: height, color: color, sea: SEA };
  }

  const TerrainGen = { generate: generate, mulberry32: mulberry32, makeValueNoise: makeValueNoise };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TerrainGen;
  } else {
    root.TerrainGen = TerrainGen;
  }
})(typeof window !== 'undefined' ? window : this);
