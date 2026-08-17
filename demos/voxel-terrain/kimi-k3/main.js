/* Воксельный ландшафт — VoxelSpace/Comanche-стиль на чистом canvas.
   Рендер по вертикальным столбцам в низкоразрешённый буфер, затем апскейл. */
(function () {
  'use strict';

  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d');

  var ui = {
    alt: document.getElementById('alt'),
    dist: document.getElementById('dist'),
    hor: document.getElementById('hor'),
    altVal: document.getElementById('altVal'),
    distVal: document.getElementById('distVal'),
    horVal: document.getElementById('horVal'),
    fps: document.getElementById('fps')
  };

  var params = { alt: 90, dist: 700, hor: 0.42 };

  function bindRange(input, out, fmt, apply) {
    function on() {
      var v = parseFloat(input.value);
      out.textContent = fmt(v);
      apply(v);
    }
    input.addEventListener('input', on);
    on();
  }
  bindRange(ui.alt, ui.altVal, function (v) { return String(v | 0); }, function (v) { params.alt = v; });
  bindRange(ui.dist, ui.distVal, function (v) { return String(v | 0); }, function (v) { params.dist = v; });
  bindRange(ui.hor, ui.horVal, function (v) { return (v | 0) + '%'; }, function (v) { params.hor = v / 100; });

  /* ---------- Процедурная карта ---------- */

  var MAP = 1024, MASK = MAP - 1;
  var heightMap = new Uint8Array(MAP * MAP);
  var colorMap = new Uint32Array(MAP * MAP); // ABGR (little-endian RGBA)

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var perm = new Uint8Array(512);
  (function () {
    var rnd = mulberry32(1337);
    var p = new Uint8Array(256);
    var i, j, t;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {
      j = (rnd() * (i + 1)) | 0;
      t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();

  function lattice(ix, iy) {
    return perm[(perm[ix & 255] + iy) & 255] / 255;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  // Значащий шум с билинейной интерполяцией и явным периодом в ячейках
  // решётки — карта стыкуется по краям при любом целом period.
  function pvnoise(x, y, period) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var x0 = ((ix % period) + period) % period;
    var y0 = ((iy % period) + period) % period;
    var x1 = (x0 + 1) % period;
    var y1 = (y0 + 1) % period;
    var a = lattice(x0, y0), b = lattice(x1, y0);
    var c = lattice(x0, y1), d = lattice(x1, y1);
    var u = smooth(fx), v = smooth(fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // fBm: октавы с 4..128 ячейками на карту 1024 → формы рельефа 256..8 ед.
  var OCTAVE_CELLS = [4, 8, 16, 32, 64, 128];
  function fbm(x, y) {
    var sum = 0, amp = 0.55, norm = 0, i, c;
    for (i = 0; i < OCTAVE_CELLS.length; i++) {
      c = OCTAVE_CELLS[i];
      sum += pvnoise(x * c / MAP, y * c / MAP, c) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  }

  var PALETTE = [
    [0.00, 88, 138, 76],   // низины — зелень
    [0.32, 74, 118, 60],   // лес
    [0.50, 116, 128, 70],  // сухие травы
    [0.64, 128, 112, 92],  // скалы
    [0.78, 148, 146, 140], // камень
    [0.90, 228, 236, 242], // снег
    [1.00, 246, 249, 251]
  ];

  function paletteColor(e) {
    var i = 1;
    while (i < PALETTE.length - 1 && e > PALETTE[i][0]) i++;
    var p0 = PALETTE[i - 1], p1 = PALETTE[i];
    var t = (e - p0[0]) / (p1[0] - p0[0]);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return [
      p0[1] + (p1[1] - p0[1]) * t,
      p0[2] + (p1[2] - p0[2]) * t,
      p0[3] + (p1[3] - p0[3]) * t
    ];
  }

  (function buildMap() {
    var x, y, idx, e;
    for (y = 0; y < MAP; y++) {
      for (x = 0; x < MAP; x++) {
        e = fbm(x, y);
        // хребтовая добавка для выразительного рельефа (8 ячеек на карту)
        var r = 1 - Math.abs(2 * pvnoise(x * 8 / MAP, y * 8 / MAP, 8) - 1);
        e = e * 0.82 + r * r * 0.18;
        e = Math.pow(e, 1.35);
        if (e < 0) e = 0; else if (e > 1) e = 1;
        heightMap[y * MAP + x] = (e * 255) | 0;
      }
    }
    // карта цвета: высота + затенение по уклону + микрошум
    for (y = 0; y < MAP; y++) {
      for (x = 0; x < MAP; x++) {
        idx = y * MAP + x;
        var hL = heightMap[y * MAP + ((x - 1) & MASK)];
        var hR = heightMap[y * MAP + ((x + 1) & MASK)];
        var hU = heightMap[((y - 1) & MASK) * MAP + x];
        var hD = heightMap[((y + 1) & MASK) * MAP + x];
        var shade = 1 + ((hL - hR) + (hU - hD)) * 0.010;
        if (shade < 0.55) shade = 0.55; else if (shade > 1.4) shade = 1.4;
        var vary = 0.92 + lattice(x, y) * 0.16;
        e = heightMap[idx] / 255;
        var c = paletteColor(e);
        var rr = c[0] * shade * vary;
        var gg = c[1] * shade * vary;
        var bb = c[2] * shade * vary;
        if (rr > 255) rr = 255; if (gg > 255) gg = 255; if (bb > 255) bb = 255;
        colorMap[idx] = (0xff000000 | ((bb | 0) << 16) | ((gg | 0) << 8) | (rr | 0)) >>> 0;
      }
    }
  })();

  /* ---------- Буфер кадра ---------- */

  var bufCanvas = document.createElement('canvas');
  var bufCtx = bufCanvas.getContext('2d');
  var bufW = 0, bufH = 0;
  var img = null, pix32 = null;
  var pixScale = 3; // адаптивный даунскейл буфера
  var dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    bufW = Math.max(160, Math.min(680, Math.round(canvas.width / pixScale)));
    bufH = Math.max(100, Math.min(420, Math.round(canvas.height / pixScale)));
    bufCanvas.width = bufW;
    bufCanvas.height = bufH;
    img = bufCtx.createImageData(bufW, bufH);
    pix32 = new Uint32Array(img.data.buffer);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---------- Цвета неба / тумана ---------- */

  var SKY_TOP = [96, 138, 196];
  var SKY_HOR = [205, 220, 234];
  var FOG = SKY_HOR;

  function packRGB(r, g, b) {
    return (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
  }

  /* ---------- Камера ---------- */

  var camX = 512, camY = 512, camAngle = 0.8;
  var camHeight = 200; // сглаженная высота
  var time = 0;

  function terrainAt(x, y) {
    return heightMap[((y | 0) & MASK) * MAP + ((x | 0) & MASK)];
  }

  /* ---------- Рендер ---------- */

  var FOV = 1.35; // рад

  function renderFrame() {
    var W = bufW, H = bufH;
    var horizonY = Math.round(H * params.hor);
    var focal = H * 1.15;
    var dist = params.dist;

    // небо: вертикальный градиент к горизонту
    var y, x, t, c;
    for (y = 0; y < H; y++) {
      t = y / (H - 1);
      var band = Math.exp(-Math.pow((t - params.hor) * 4.2, 2)) * 18; // лёгкая дымка у горизонта
      var r = SKY_TOP[0] + (SKY_HOR[0] - SKY_TOP[0]) * t + band;
      var g = SKY_TOP[1] + (SKY_HOR[1] - SKY_TOP[1]) * t + band;
      var b = SKY_TOP[2] + (SKY_HOR[2] - SKY_TOP[2]) * t + band;
      if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
      c = packRGB(r, g, b);
      var row = y * W;
      for (x = 0; x < W; x++) pix32[row + x] = c;
    }

    var sinA = Math.sin(camAngle), cosA = Math.cos(camAngle);
    var fogR = FOG[0], fogG = FOG[1], fogB = FOG[2];

    for (x = 0; x < W; x++) {
      // угол луча столбца внутри FOV
      var rel = (x / W - 0.5) * FOV;
      var dxr = sinA * Math.cos(rel) + cosA * Math.sin(rel);
      var dyr = cosA * Math.cos(rel) - sinA * Math.sin(rel);
      // компенсация «рыбьего глаза»: плоская глубина z*cos(rel)
      var invDepthCorr = focal / Math.cos(rel);

      var yMax = H; // нижняя граница уже отрисованного в столбце
      var z = 1, dz = 1;
      while (z < dist) {
        var mx = camX + dxr * z;
        var my = camY + dyr * z;
        var idx = ((my | 0) & MASK) * MAP + ((mx | 0) & MASK);
        var h = heightMap[idx];
        // земля ниже камеры проецируется НИЖЕ горизонта (y растёт вниз)
        var sy = horizonY + (camHeight - h) * invDepthCorr / z;
        if (sy < yMax) {
          var f = z / dist; // туман по дальности
          var col = colorMap[idx];
          var inv = 1 - f;
          var rr = ((col & 255) * inv + fogR * f) | 0;
          var gg = (((col >>> 8) & 255) * inv + fogG * f) | 0;
          var bb = (((col >>> 16) & 255) * inv + fogB * f) | 0;
          c = (0xff000000 | (bb << 16) | (gg << 8) | rr) >>> 0;
          var top = sy < 0 ? 0 : sy | 0;
          for (var yy = top; yy < yMax; yy++) pix32[yy * W + x] = c;
          yMax = top;
          if (yMax <= 0) break;
        }
        z += dz;
        dz = 1 + z * 0.006; // шаг растёт с расстоянием
      }
    }

    bufCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bufCanvas, 0, 0, canvas.width, canvas.height);
  }

  /* ---------- Цикл ---------- */

  var last = performance.now();
  var fpsAcc = 0, fpsCnt = 0, fpsTimer = 0;

  function tick(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // кламп большого dt
    if (dt < 0) dt = 0;
    time += dt;

    // непрерывный полёт над ландшафтом
    var speed = 72;
    camAngle += (0.30 * Math.sin(time * 0.11) + 0.05) * dt;
    camX += Math.sin(camAngle) * speed * dt;
    camY += Math.cos(camAngle) * speed * dt;
    if (camX >= MAP || camX < 0) camX = ((camX % MAP) + MAP) % MAP;
    if (camY >= MAP || camY < 0) camY = ((camY % MAP) + MAP) % MAP;

    // высота камеры плавно следует за рельефом + заданная высота
    var targetH = terrainAt(camX, camY) + params.alt;
    camHeight += (targetH - camHeight) * Math.min(1, dt * 3.5);

    renderFrame();

    // FPS + адаптация качества
    fpsAcc += dt; fpsCnt++; fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      var avg = fpsAcc / fpsCnt;
      ui.fps.textContent = Math.round(1 / Math.max(avg, 1e-4)) + ' fps';
      if (avg > 0.024 && pixScale < 6) { pixScale += 0.5; resize(); }
      else if (avg < 0.013 && pixScale > 2.5) { pixScale -= 0.5; resize(); }
      fpsAcc = 0; fpsCnt = 0; fpsTimer = 0;
    }

    requestAnimationFrame(tick);
  }

  renderFrame(); // первый кадр сразу
  requestAnimationFrame(tick);
})();
