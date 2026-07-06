'use strict';
(function () {
  var V = window.Voxel;

  // ------------------------- Канвасы и DPR -------------------------
  // Видимый канвас рендерится в полное разрешение под DPR (потолок 2).
  // Сама сцена, однако, считается в меньший внутренний буфер (как
  // оригинальный VoxelSpace/Comanche при 320x200) и растягивается на
  // видимый канвас через drawImage со сглаживанием — это и быстро, и даёт
  // узнаваемую лёгкую дымку старого воксельного рендера.
  var display = document.getElementById('scene');
  var displayCtx = display.getContext('2d');
  var buffer = document.getElementById('buffer');
  var bufferCtx = buffer.getContext('2d');

  var DPR_CAP = 2;
  var INTERNAL_SCALE = 2.4;
  var BUF_W_MIN = 380, BUF_W_MAX = 760;

  var bufW = 480, bufH = 300, imageData = null, pixels = null;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    var cssW = window.innerWidth, cssH = window.innerHeight;
    display.width = Math.max(1, Math.round(cssW * dpr));
    display.height = Math.max(1, Math.round(cssH * dpr));

    bufW = Math.max(BUF_W_MIN, Math.min(BUF_W_MAX, Math.round(display.width / INTERNAL_SCALE)));
    bufH = Math.max(140, Math.round(bufW * display.height / display.width));

    buffer.width = bufW;
    buffer.height = bufH;
    imageData = bufferCtx.createImageData(bufW, bufH);
    pixels = imageData.data;

    displayCtx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in displayCtx) displayCtx.imageSmoothingQuality = 'high';
  }
  window.addEventListener('resize', resize);
  resize();

  // ------------------------- Карта высот -------------------------
  var MAP_N = 1024;          // сторона сетки карты высот
  var WORLD_CELL = 2;        // 1 ячейка карты = 2 мировых юнита (шире охват без роста сетки)
  var MAX_HEIGHT = 820;
  var TILE_SPAN = MAP_N * WORLD_CELL;    // 2048 мировых юнитов на сторону
  var TILE_CENTER = TILE_SPAN / 2;       // 1024 — камера летает вокруг центра плитки

  var map = null;
  var seed = 1337;

  function buildMap(useSeed) {
    var n = MAP_N;
    var heights = new Float32Array(n * n);
    var cr = new Uint8ClampedArray(n * n);
    var cg = new Uint8ClampedArray(n * n);
    var cb = new Uint8ClampedArray(n * n);
    var opts = { scale: 0.006, octaves: 5, power: 1.4, maxHeight: MAX_HEIGHT };
    for (var j = 0; j < n; j++) {
      var wz = j * WORLD_CELL;
      var row = j * n;
      for (var i = 0; i < n; i++) {
        var wx = i * WORLD_CELL;
        var h = V.heightAt(wx, wz, useSeed, opts);
        heights[row + i] = h;
        var c = V.colorAt(h, MAX_HEIGHT);
        cr[row + i] = c.r; cg[row + i] = c.g; cb[row + i] = c.b;
      }
    }
    return { heights: heights, r: cr, g: cg, b: cb };
  }

  // Карта не тайлится бесконечно — индексы клампятся к краю плитки. Полёт
  // держится в центральной области (см. pathPosition), а дальний туман
  // всегда достигает почти полной непрозрачности задолго до границы
  // плитки, поэтому клампинг на краю визуально не проявляется.
  function sampleIndex(wx, wz) {
    var i = (wx / WORLD_CELL) | 0;
    var j = (wz / WORLD_CELL) | 0;
    if (i < 0) i = 0; else if (i >= MAP_N) i = MAP_N - 1;
    if (j < 0) j = 0; else if (j >= MAP_N) j = MAP_N - 1;
    return j * MAP_N + i;
  }

  // ------------------------- Полёт камеры -------------------------
  // Камера летит непрерывно по замкнутой лиссажу-подобной траектории
  // вокруг центра плитки — обзор всегда меняется, но полёт никогда не
  // уходит к краю сгенерированной карты. Угол курса берётся из
  // аналитической производной траектории, поэтому нос всегда направлен
  // по вектору движения (без рысканья).
  function pathPosition(t) {
    var x = TILE_CENTER + 260 * Math.sin(t * 0.055) + 95 * Math.sin(t * 0.13 + 1.1);
    var z = TILE_CENTER + 190 * Math.sin(t * 0.048 + 0.6) + 115 * Math.sin(t * 0.10 + 2.4);
    return { x: x, z: z };
  }
  function pathVelocity(t) {
    var vx = 260 * 0.055 * Math.cos(t * 0.055) + 95 * 0.13 * Math.cos(t * 0.13 + 1.1);
    var vz = 190 * 0.048 * Math.cos(t * 0.048 + 0.6) + 115 * 0.10 * Math.cos(t * 0.10 + 2.4);
    return { vx: vx, vz: vz };
  }

  // Терраин-фоллоуинг смотрит не только "прямо под собой", а на самую
  // высокую точку рельефа в ближайшие LOOKAHEAD_SECONDS ПО КУРСУ (путь
  // камеры известен аналитически — pathPosition(t), поэтому "взгляд
  // вперёд" — это просто те же самые сэмплы карты чуть дальше по
  // времени, без догадок о направлении). Это даёт камере время заранее
  // начать набор высоты перед резким склоном, а не наткнуться на него.
  var LOOKAHEAD_SECONDS = 1.6;
  var LOOKAHEAD_SAMPLES = 8;

  function terrainAheadMax(t) {
    var maxH = -Infinity;
    for (var k = 0; k <= LOOKAHEAD_SAMPLES; k++) {
      var p = pathPosition(t + (LOOKAHEAD_SECONDS * k) / LOOKAHEAD_SAMPLES);
      var h = map.heights[sampleIndex(p.x, p.z)];
      if (h > maxH) maxH = h;
    }
    return maxH;
  }

  var flightTime = 0;
  var paused = false;
  var smoothedGround = 0;
  var groundInit = false;
  var MIN_HARD_CLEARANCE = 22; // абсолютный пол клиренса — ниже него камера не окажется никогда

  // ------------------------- Параметры UI -------------------------
  var params = {
    clearance: 170,     // высота камеры над рельефом
    drawDistance: 600,  // дальность отрисовки
    horizonFrac: 0.42   // положение линии горизонта (доля высоты экрана)
  };

  // ------------------------- Небо и туман -------------------------
  var SKY_TOP = { r: 116, g: 172, b: 226 };
  var SKY_HORIZON = { r: 214, g: 224, b: 226 };
  var FOG_NEAR_FRAC = 0.12; // туман начинает проявляться с этой доли дальности отрисовки

  function fogAmount(z, drawDistance) {
    var start = drawDistance * FOG_NEAR_FRAC;
    if (z <= start) return 0;
    var t = (z - start) / (drawDistance - start);
    if (t > 1) t = 1;
    return t * t * (3 - 2 * t); // smoothstep
  }

  function paintSky(horizonRow) {
    var hr = horizonRow;
    if (hr < 0) hr = 0; else if (hr > bufH) hr = bufH;
    for (var y = 0; y < bufH; y++) {
      var t = hr > 0 ? Math.min(1, y / hr) : 1;
      var r = SKY_TOP.r + (SKY_HORIZON.r - SKY_TOP.r) * t;
      var g = SKY_TOP.g + (SKY_HORIZON.g - SKY_TOP.g) * t;
      var b = SKY_TOP.b + (SKY_HORIZON.b - SKY_TOP.b) * t;
      var rowOff = y * bufW * 4;
      for (var x = 0; x < bufW; x++) {
        var o = rowOff + x * 4;
        pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b; pixels[o + 3] = 255;
      }
    }
  }

  // ------------------------- Рендер кадра -------------------------
  var HALF_FOV = 34 * Math.PI / 180; // ~68° по горизонтали

  function renderFrame(camera) {
    var horizonRow = params.horizonFrac * bufH;
    paintSky(horizonRow);

    var ybuffer = new Float32Array(bufW).fill(bufH);
    var scaleHeight = bufH * 1.15;
    var camProj = { height: camera.height, horizonY: horizonRow, scaleHeight: scaleHeight };

    var sinPhi = Math.sin(camera.angle), cosPhi = Math.cos(camera.angle);
    var rx = -sinPhi, rz = cosPhi; // направление "вправо" от курса камеры
    var tanHalfFov = Math.tan(HALF_FOV);

    var drawDistance = params.drawDistance;
    var heights = map.heights, cr = map.r, cg = map.g, cb = map.b;

    var z = 1.0, dz = 1.0;
    while (z < drawDistance) {
      var fx = camera.x + cosPhi * z;
      var fz = camera.z + sinPhi * z;
      var spread = z * tanHalfFov;
      var lx = fx - rx * spread, lz = fz - rz * spread;
      var rxp = fx + rx * spread, rzp = fz + rz * spread;
      var stepX = (rxp - lx) / bufW, stepZ = (rzp - lz) / bufW;
      var sx = lx, sz = lz;

      var fog = fogAmount(z, drawDistance);
      var fr = SKY_HORIZON.r, fgc = SKY_HORIZON.g, fb = SKY_HORIZON.b;

      for (var col = 0; col < bufW; col++) {
        var idx = sampleIndex(sx, sz);
        var terrainH = heights[idx];
        var screenY = V.projectHeight(terrainH, z, camProj);
        if (screenY < 0) screenY = 0;
        var bottom = ybuffer[col];
        if (screenY < bottom) {
          var r = cr[idx], g = cg[idx], b = cb[idx];
          if (fog > 0) {
            r = r + (fr - r) * fog;
            g = g + (fgc - g) * fog;
            b = b + (fb - b) * fog;
          }
          var top = screenY | 0;
          var bot = bottom | 0;
          for (var y = top; y < bot; y++) {
            var o = (y * bufW + col) * 4;
            pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b; pixels[o + 3] = 255;
          }
          ybuffer[col] = screenY;
        }
        sx += stepX; sz += stepZ;
      }

      z += dz;
      dz += 0.02; // шаг растёт с дальностью (меньше семплов там, где и так туман)
    }

    bufferCtx.putImageData(imageData, 0, 0);
    displayCtx.clearRect(0, 0, display.width, display.height);
    displayCtx.drawImage(buffer, 0, 0, bufW, bufH, 0, 0, display.width, display.height);
  }

  // ------------------------- UI -------------------------
  var fpsEl = document.getElementById('fps');
  var seedEl = document.getElementById('seedval');
  var elHeight = document.getElementById('ctrl-height');
  var elHeightOut = document.getElementById('ctrl-height-out');
  var elDist = document.getElementById('ctrl-distance');
  var elDistOut = document.getElementById('ctrl-distance-out');
  var elHorizon = document.getElementById('ctrl-horizon');
  var elHorizonOut = document.getElementById('ctrl-horizon-out');
  var btnPause = document.getElementById('btn-pause');
  var btnRegen = document.getElementById('btn-regen');

  function syncOutputs() {
    elHeightOut.textContent = params.clearance;
    elDistOut.textContent = params.drawDistance;
    elHorizonOut.textContent = Math.round(params.horizonFrac * 100) + '%';
  }

  elHeight.addEventListener('input', function () {
    params.clearance = parseFloat(elHeight.value);
    syncOutputs();
  });
  elDist.addEventListener('input', function () {
    params.drawDistance = parseFloat(elDist.value);
    syncOutputs();
  });
  elHorizon.addEventListener('input', function () {
    params.horizonFrac = parseFloat(elHorizon.value) / 100;
    syncOutputs();
  });
  btnPause.addEventListener('click', function () {
    paused = !paused;
    btnPause.textContent = paused ? 'Полёт' : 'Пауза';
  });
  btnRegen.addEventListener('click', function () {
    regenerate(Math.floor(Math.random() * 1e9));
  });

  syncOutputs();

  function regenerate(newSeed) {
    seed = newSeed;
    map = buildMap(seed);
    groundInit = false;
    seedEl.textContent = String(seed);
  }

  // ------------------------- Главный цикл -------------------------
  var lastTime = null;
  var fpsSmoothed = 60;

  function frame(now) {
    if (lastTime === null) lastTime = now;
    var dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.1) dt = 0.1; // клампим большие dt (смена вкладки, лаги)
    if (dt > 0) fpsSmoothed += (1 / dt - fpsSmoothed) * 0.08;

    if (!paused) flightTime += dt;

    var pos = pathPosition(flightTime);
    var vel = pathVelocity(flightTime);
    var angle = Math.atan2(vel.vz, vel.vx);

    // Цель для сглаживания — не высота точки под текущей позицией, а
    // максимум рельефа впереди по курсу (см. terrainAheadMax): камера
    // начинает набирать высоту заранее, до подъёма, а не в момент, когда
    // уже оказалась над резко поднявшимся склоном.
    var aheadMax = terrainAheadMax(flightTime);
    if (!groundInit) { smoothedGround = aheadMax; groundInit = true; }
    var followK = Math.min(1, dt * 3.5);
    smoothedGround += (aheadMax - smoothedGround) * followK;

    var bob = Math.sin(flightTime * 0.9) * 3;
    var targetHeight = smoothedGround + params.clearance + bob;

    // Жёсткая гарантия (не полагается на сглаживание): камера никогда не
    // окажется ближе MIN_HARD_CLEARANCE к самой высокой точке рельефа в
    // ближайшие LOOKAHEAD_SECONDS по курсу, даже если фильтр выше отстал
    // от резкого набора высоты. Пересчитывается заново каждый кадр от
    // текущего flightTime — не зависит от накопленного состояния.
    var minSafeHeight = aheadMax + MIN_HARD_CLEARANCE;

    var camera = {
      x: pos.x,
      z: pos.z,
      angle: angle,
      height: Math.max(targetHeight, minSafeHeight)
    };

    renderFrame(camera);
    fpsEl.textContent = Math.round(fpsSmoothed) + ' fps';

    requestAnimationFrame(frame);
  }

  regenerate(seed);
  requestAnimationFrame(frame);
})();
