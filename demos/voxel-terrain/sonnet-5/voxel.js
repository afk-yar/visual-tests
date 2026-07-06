'use strict';
// ---------------------------------------------------------------------
// Voxel-terrain: детерминированная генерация карты высот по шуму и
// проекция высоты рельефа в экранную координату столбца (алгоритм в духе
// VoxelSpace/Comanche). Dual-mode модуль: в браузере кладёт API в
// window.Voxel, в node экспортирует через module.exports — используется
// в voxel.test.js для юнит-тестов чистых функций (без DOM, без
// Math.random внутри самой функции высоты).
// ---------------------------------------------------------------------
(function () {
  // 32-битный целочисленный хэш точки решётки (детерминирован от ix, iy,
  // seed). Math.imul держит все умножения в 32 битах, поэтому нет потери
  // точности double при больших координатах — важно для устойчивого
  // детерминизма.
  function hash2D(ix, iy, seed) {
    var h = (ix | 0) ^ Math.imul(iy | 0, 0x27d4eb2d);
    h = Math.imul(h ^ (seed | 0), 0x165667b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296; // [0, 1)
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // Билинейный value-noise на целочисленной решётке, сглаженный smoothstep.
  function valueNoise2D(x, y, seed) {
    var x0 = Math.floor(x);
    var y0 = Math.floor(y);
    var sx = smoothstep(x - x0);
    var sy = smoothstep(y - y0);
    var n00 = hash2D(x0, y0, seed);
    var n10 = hash2D(x0 + 1, y0, seed);
    var n01 = hash2D(x0, y0 + 1, seed);
    var n11 = hash2D(x0 + 1, y0 + 1, seed);
    var nx0 = lerp(n00, n10, sx);
    var nx1 = lerp(n01, n11, sx);
    return lerp(nx0, nx1, sy); // [0, 1)
  }

  // Фрактальная сумма октав value-noise (fBm), нормирована в [0, 1).
  function fbm2D(x, y, seed, octaves, lacunarity, gain) {
    octaves = octaves || 5;
    lacunarity = lacunarity || 2;
    gain = gain || 0.5;
    var amp = 1;
    var freq = 1;
    var sum = 0;
    var norm = 0;
    for (var i = 0; i < octaves; i++) {
      sum += valueNoise2D(x * freq, y * freq, (seed + i * 1013) | 0) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  // Высота рельефа в мировой точке (x, y). Чистая и детерминированная:
  // одинаковый (x, y, seed, opts) всегда даёт одинаковый результат — без
  // Math.random внутри функции, поэтому тестируема.
  //   opts: { scale, octaves, power, maxHeight }
  function heightAt(x, y, seed, opts) {
    opts = opts || {};
    var scale = opts.scale !== undefined ? opts.scale : 0.006;
    var octaves = opts.octaves !== undefined ? opts.octaves : 5;
    var power = opts.power !== undefined ? opts.power : 1.4;
    var maxHeight = opts.maxHeight !== undefined ? opts.maxHeight : 900;
    var n = clamp(fbm2D(x * scale, y * scale, (seed || 0) | 0, octaves), 0, 1);
    return Math.pow(n, power) * maxHeight;
  }

  // Карта цвета по высоте: вода → мелководье → пляж → трава → скала →
  // снег, со сглаженной интерполяцией между полосами.
  var PALETTE = [
    { t: 0.00, c: [23, 54, 97] },    // глубокая вода
    { t: 0.16, c: [45, 100, 148] },  // мелководье
    { t: 0.20, c: [199, 186, 137] }, // пляж
    { t: 0.28, c: [95, 138, 66] },   // низкая трава
    { t: 0.50, c: [66, 107, 51] },   // трава
    { t: 0.68, c: [104, 92, 79] },   // скала
    { t: 0.85, c: [138, 130, 122] }, // светлая скала
    { t: 1.00, c: [246, 248, 250] }  // снег
  ];

  function colorAt(height, maxHeight) {
    maxHeight = maxHeight || 900;
    var t = clamp(height / maxHeight, 0, 1);
    var i = 0;
    while (i < PALETTE.length - 2 && t > PALETTE[i + 1].t) i++;
    var a = PALETTE[i];
    var b = PALETTE[i + 1];
    var span = b.t - a.t || 1;
    var local = smoothstep(clamp((t - a.t) / span, 0, 1));
    return {
      r: lerp(a.c[0], b.c[0], local),
      g: lerp(a.c[1], b.c[1], local),
      b: lerp(a.c[2], b.c[2], local)
    };
  }

  // Проекция высоты рельефа в экранную Y-координату столбца — сердце
  // рендера в стиле VoxelSpace/Comanche. Точка ровно на уровне камеры
  // проецируется точно на линию горизонта независимо от дистанции;
  // точки выше камеры уходят экранно вверх, ниже — вниз; с ростом
  // дистанции проекция стягивается к горизонту (перспектива).
  //   camera: { height, horizonY, scaleHeight }
  function projectHeight(terrainHeight, distance, camera) {
    var d = distance > 1e-4 ? distance : 1e-4;
    return camera.horizonY - ((terrainHeight - camera.height) / d) * camera.scaleHeight;
  }

  var api = {
    hash2D: hash2D,
    smoothstep: smoothstep,
    lerp: lerp,
    valueNoise2D: valueNoise2D,
    fbm2D: fbm2D,
    heightAt: heightAt,
    colorAt: colorAt,
    projectHeight: projectHeight
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.Voxel = api;
  }
})();
