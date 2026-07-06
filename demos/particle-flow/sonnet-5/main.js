'use strict';
(function () {
  var field = window.ParticleField;

  // ---------------------------------------------------------------------
  // Конфигурация сцены
  // ---------------------------------------------------------------------
  var CONFIG = {
    BOX: 78,                 // половина стороны куба, в котором тороидально живут частицы
    CAM_DIST: 250,           // расстояние камеры от центра сцены (мир. единицы)
    CAM_Y: 14,               // базовая высота камеры
    ROT_SPEED: 0.045,        // рад/сек — медленное вращение сцены вокруг Y (~140 c/оборот)
    TILT_AMP: 0.10,          // рад — амплитуда лёгкого покачивания по X
    TILT_SPEED: 0.11,
    BOB_AMP: 6,              // мир. единицы — амплитуда вертикального дрейфа камеры
    BOB_SPEED: 0.17,
    NEAR_CLIP: 40,           // защитный порог перед проекцией (не должен срабатывать в норме)
    FOG_SPAN: 1.3,           // множитель BOX для диапазона тумана вокруг CAM_DIST
    FLOW_SPEED: 34,          // масштаб «сырого» поля curl → мир.единицы/сек
    BUCKET_COUNT: 24,
    STREAK_ALPHA: 0.55,
    STREAK_WIDTH: 1.15,
    SPRITE_ALPHA: 0.9,
    SPRITE_STRIDE: 4,        // доля частиц с «искрой»-спрайтом поверх штриха: 1 из N
    DOT_BASE_SIZE: 3.2,
    DIM_CUTOFF: 0.10,        // ниже этой яркости частицу не рисуем (туман скрывает)
    ARRAY_CAPACITY: 60000,
    TIERS: [6000, 10000, 16000, 24000, 32000, 42000, 54000],
    START_TIER: 4,
    NUM_STARS: 260,
    FADE_RGB: [7, 9, 16],
    FADE_ALPHA: 0.15
  };

  var FIELD_MAX_SPEED = (field && field.FIELD_MAX_SPEED) || 1;
  var MAX_PARTICLE_SPEED = CONFIG.FLOW_SPEED * FIELD_MAX_SPEED;

  // ---------------------------------------------------------------------
  // DOM / canvas
  // ---------------------------------------------------------------------
  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d', { alpha: false });

  var particlesRange = document.getElementById('particlesRange');
  var particlesValue = document.getElementById('particlesValue');
  var autoToggle = document.getElementById('autoToggle');
  var rotRange = document.getElementById('rotRange');
  var rotValue = document.getElementById('rotValue');
  var pauseBtn = document.getElementById('pauseBtn');
  var statsLine = document.getElementById('statsLine');

  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var width = 0, height = 0, centerX = 0, centerY = 0, focalPx = 0;

  function resize() {
    var cssW = window.innerWidth;
    var cssH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.round(cssW * dpr));
    height = Math.max(1, Math.round(cssH * dpr));
    canvas.width = width;
    canvas.height = height;
    centerX = width / 2;
    centerY = height / 2;
    focalPx = Math.min(width, height) * 1.15;
    // Полная непрозрачная заливка сразу — чтобы не было вспышки прозрачности
    // до первого кадра рендера (canvas создаётся с alpha:false, но контент
    // изначально не определён до первой отрисовки).
    ctx.fillStyle = 'rgb(' + CONFIG.FADE_RGB.join(',') + ')';
    ctx.fillRect(0, 0, width, height);
  }

  // ---------------------------------------------------------------------
  // Цветовая шкала: холодный медленный поток -> тёплый/белый быстрый.
  // Используется и для штрихов (по скорости), и для спрайтов-искр.
  // ---------------------------------------------------------------------
  var COLOR_STOPS = [
    { t: 0.00, rgb: [80, 110, 235] },
    { t: 0.35, rgb: [70, 210, 235] },
    { t: 0.65, rgb: [255, 200, 90] },
    { t: 1.00, rgb: [255, 255, 255] }
  ];

  function colorForT(t) {
    t = Math.max(0, Math.min(1, t));
    for (var i = 0; i < COLOR_STOPS.length - 1; i++) {
      var a = COLOR_STOPS[i], b = COLOR_STOPS[i + 1];
      if (t >= a.t && t <= b.t) {
        var span = b.t - a.t || 1;
        var f = (t - a.t) / span;
        return [
          Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f),
          Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f),
          Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f)
        ];
      }
    }
    return COLOR_STOPS[COLOR_STOPS.length - 1].rgb;
  }

  var bucketRGB = [];
  var bucketStreakStyle = [];
  var bucketSprite = [];

  function makeDotSprite(rgb) {
    var size = 48;
    var off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    var octx = off.getContext('2d');
    var r = size / 2;
    var grad = octx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.32, 'rgba(' + rgb.join(',') + ',0.85)');
    grad.addColorStop(1, 'rgba(' + rgb.join(',') + ',0)');
    octx.fillStyle = grad;
    octx.fillRect(0, 0, size, size);
    return off;
  }

  for (var bi = 0; bi < CONFIG.BUCKET_COUNT; bi++) {
    var tt = bi / (CONFIG.BUCKET_COUNT - 1);
    var rgb = colorForT(tt);
    bucketRGB.push(rgb);
    bucketStreakStyle.push('rgba(' + rgb.join(',') + ',' + CONFIG.STREAK_ALPHA + ')');
    bucketSprite.push(makeDotSprite(rgb));
  }

  // ---------------------------------------------------------------------
  // Частицы (типизированные массивы, аллоцированы один раз на максимум).
  // ---------------------------------------------------------------------
  var N = CONFIG.ARRAY_CAPACITY;
  var posX = new Float32Array(N);
  var posY = new Float32Array(N);
  var posZ = new Float32Array(N);
  var seed = new Float32Array(N);
  var prevSX = new Float32Array(N);
  var prevSY = new Float32Array(N);
  var prevValid = new Uint8Array(N);

  (function initParticles() {
    var B = CONFIG.BOX;
    for (var i = 0; i < N; i++) {
      posX[i] = (Math.random() * 2 - 1) * B;
      posY[i] = (Math.random() * 2 - 1) * B;
      posZ[i] = (Math.random() * 2 - 1) * B;
      seed[i] = Math.random();
      prevValid[i] = 0;
    }
  })();

  var activeCount = CONFIG.TIERS[CONFIG.START_TIER];

  // ---------------------------------------------------------------------
  // Звёздное поле — статичный дальний фон, вращается вместе со сценой.
  // ---------------------------------------------------------------------
  var starX = new Float32Array(CONFIG.NUM_STARS);
  var starY = new Float32Array(CONFIG.NUM_STARS);
  var starZ = new Float32Array(CONFIG.NUM_STARS);
  var starAlpha = new Float32Array(CONFIG.NUM_STARS);
  var starSize = new Float32Array(CONFIG.NUM_STARS);
  (function initStars() {
    for (var i = 0; i < CONFIG.NUM_STARS; i++) {
      var theta = Math.random() * Math.PI * 2;
      var phi = Math.acos(2 * Math.random() - 1);
      var radius = 340 + Math.random() * 300;
      starX[i] = radius * Math.sin(phi) * Math.cos(theta);
      starY[i] = radius * Math.cos(phi) * 0.6; // немного приплюснуто по вертикали
      starZ[i] = radius * Math.sin(phi) * Math.sin(theta);
      starAlpha[i] = 0.12 + Math.random() * 0.45;
      starSize[i] = 0.6 + Math.random() * 1.1;
    }
  })();

  // ---------------------------------------------------------------------
  // Управление
  // ---------------------------------------------------------------------
  var paused = false;
  var autoAdjust = true;
  var rotMultiplier = 1;

  if (particlesRange) {
    particlesRange.min = String(CONFIG.TIERS[0]);
    particlesRange.max = String(CONFIG.ARRAY_CAPACITY);
    particlesRange.step = '1000';
    particlesRange.value = String(activeCount);
    particlesRange.addEventListener('input', function () {
      activeCount = Math.max(500, Math.min(CONFIG.ARRAY_CAPACITY, parseInt(particlesRange.value, 10) || activeCount));
      autoAdjust = false;
      if (autoToggle) autoToggle.checked = false;
      updateStatsLabels();
    });
  }
  if (autoToggle) {
    autoToggle.checked = true;
    autoToggle.addEventListener('change', function () {
      autoAdjust = !!autoToggle.checked;
    });
  }
  if (rotRange) {
    rotRange.min = '0';
    rotRange.max = '200';
    rotRange.value = '100';
    rotRange.addEventListener('input', function () {
      rotMultiplier = (parseInt(rotRange.value, 10) || 100) / 100;
      if (rotValue) rotValue.textContent = rotMultiplier.toFixed(1) + '×';
    });
  }
  if (pauseBtn) {
    pauseBtn.addEventListener('click', function () {
      paused = !paused;
      pauseBtn.textContent = paused ? 'Продолжить' : 'Пауза';
      pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    });
  }

  function updateStatsLabels() {
    if (particlesValue) particlesValue.textContent = activeCount.toLocaleString('ru-RU');
    if (particlesRange && document.activeElement !== particlesRange) {
      particlesRange.value = String(activeCount);
    }
  }
  updateStatsLabels();

  // ---------------------------------------------------------------------
  // Адаптивная плотность частиц по замеряемой нагрузке кадра.
  // ---------------------------------------------------------------------
  var frameWorkEma = 8;
  var ADAPT_CHECK_FRAMES = 90;
  var adaptCooldown = ADAPT_CHECK_FRAMES; // не подстраиваться, пока не прогреется JIT
  var HIGH_MS = 14, LOW_MS = 7;

  function tierIndexNear(value) {
    var idx = 0;
    for (var i = 0; i < CONFIG.TIERS.length; i++) {
      if (CONFIG.TIERS[i] <= value) idx = i;
    }
    return idx;
  }

  function adaptQuality() {
    if (!autoAdjust) return;
    adaptCooldown--;
    if (adaptCooldown > 0) return;
    adaptCooldown = ADAPT_CHECK_FRAMES;
    var idx = tierIndexNear(activeCount);
    if (frameWorkEma > HIGH_MS && idx > 0) {
      activeCount = CONFIG.TIERS[idx - 1];
      updateStatsLabels();
    } else if (frameWorkEma < LOW_MS && idx < CONFIG.TIERS.length - 1) {
      activeCount = CONFIG.TIERS[idx + 1];
      updateStatsLabels();
    }
  }

  // ---------------------------------------------------------------------
  // Проекция: сцена вращается вокруг Y (+ лёгкий наклон/дрейф), камера
  // неподвижна на оси Z и смотрит в начало координат. Эквивалентно орбите
  // камеры вокруг сцены, но не требует полной матрицы вида.
  // ---------------------------------------------------------------------
  function project(x, y, z, cosT, sinT, cosP, sinP, camY, out) {
    var x1 = x * cosT + z * sinT;
    var z1 = -x * sinT + z * cosT;
    var y1 = y;

    var y2 = y1 * cosP - z1 * sinP;
    var z2 = y1 * sinP + z1 * cosP;
    var x2 = x1;

    var cxp = x2;
    var cyp = y2 - camY;
    var depth = CONFIG.CAM_DIST - z2;

    if (depth <= CONFIG.NEAR_CLIP) {
      out.visible = false;
      return out;
    }
    var scale = focalPx / depth;
    out.visible = true;
    out.x = centerX + cxp * scale;
    out.y = centerY - cyp * scale;
    out.scale = scale;
    out.depth = depth;
    return out;
  }

  var fogNear = CONFIG.CAM_DIST - CONFIG.BOX * CONFIG.FOG_SPAN;
  var fogFar = CONFIG.CAM_DIST + CONFIG.BOX * CONFIG.FOG_SPAN;

  // ---------------------------------------------------------------------
  // Основной цикл
  // ---------------------------------------------------------------------
  var simTime = 0;
  var lastNow = null;
  var fpsEma = 60;
  var statsFrameCounter = 0;

  var proj = { visible: false, x: 0, y: 0, scale: 0, depth: 0 };
  var streakPaths = [];
  var streakNonEmpty = [];
  for (var pi = 0; pi < CONFIG.BUCKET_COUNT; pi++) {
    streakPaths.push(null);
    streakNonEmpty.push(false);
  }
  var spriteQueues = [];
  for (var si = 0; si < CONFIG.BUCKET_COUNT; si++) spriteQueues.push([]);

  function frame(now) {
    if (lastNow === null) lastNow = now;
    var dtReal = (now - lastNow) / 1000;
    lastNow = now;
    if (!Number.isFinite(dtReal) || dtReal < 0) dtReal = 0;
    dtReal = Math.min(dtReal, 0.05); // клампим большие dt (переключение вкладки и т.п.)

    if (paused) {
      requestAnimationFrame(frame);
      return;
    }

    var workStart = performance.now();

    simTime += dtReal;
    var dt = dtReal;

    var theta = simTime * CONFIG.ROT_SPEED * rotMultiplier;
    var tiltPhase = Math.sin(simTime * CONFIG.TILT_SPEED) * CONFIG.TILT_AMP;
    var camY = CONFIG.CAM_Y + Math.sin(simTime * CONFIG.BOB_SPEED) * CONFIG.BOB_AMP;
    var cosT = Math.cos(theta), sinT = Math.sin(theta);
    var cosP = Math.cos(tiltPhase), sinP = Math.sin(tiltPhase);

    // 1) Затухающая заливка (туман + след).
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(' + CONFIG.FADE_RGB.join(',') + ',' + CONFIG.FADE_ALPHA + ')';
    ctx.fillRect(0, 0, width, height);

    // 2) Звёзды — статичный дальний фон.
    ctx.fillStyle = '#dce6ff';
    for (var s = 0; s < CONFIG.NUM_STARS; s++) {
      project(starX[s], starY[s], starZ[s], cosT, sinT, cosP, sinP, camY * 0.15, proj);
      if (!proj.visible) continue;
      ctx.globalAlpha = starAlpha[s];
      var ss = starSize[s] * Math.max(0.4, proj.scale * 0.35);
      ctx.fillRect(proj.x - ss / 2, proj.y - ss / 2, ss, ss);
    }
    ctx.globalAlpha = 1;

    // 3) Частицы: интеграция по curl-полю + проекция + бакетирование по цвету.
    ctx.globalCompositeOperation = 'lighter';
    for (var b = 0; b < CONFIG.BUCKET_COUNT; b++) {
      streakPaths[b] = new Path2D();
      streakNonEmpty[b] = false;
      spriteQueues[b].length = 0;
    }

    var B = CONFIG.BOX, B2 = B * 2;
    var spriteStride = CONFIG.SPRITE_STRIDE;

    for (var i = 0; i < activeCount; i++) {
      var x = posX[i], y = posY[i], z = posZ[i];
      var v = field.curlVelocity(x, y, z, simTime);
      var vx = v.vx * CONFIG.FLOW_SPEED, vy = v.vy * CONFIG.FLOW_SPEED, vz = v.vz * CONFIG.FLOW_SPEED;

      x += vx * dt; y += vy * dt; z += vz * dt;

      var wrapped = false;
      if (x > B) { x -= B2; wrapped = true; } else if (x < -B) { x += B2; wrapped = true; }
      if (y > B) { y -= B2; wrapped = true; } else if (y < -B) { y += B2; wrapped = true; }
      if (z > B) { z -= B2; wrapped = true; } else if (z < -B) { z += B2; wrapped = true; }

      posX[i] = x; posY[i] = y; posZ[i] = z;

      project(x, y, z, cosT, sinT, cosP, sinP, camY, proj);

      if (!proj.visible) {
        prevValid[i] = 0;
        continue;
      }

      var depthFrac = (proj.depth - fogNear) / (fogFar - fogNear);
      depthFrac = depthFrac < 0 ? 0 : (depthFrac > 1 ? 1 : depthFrac);
      var brightness = 1 - depthFrac * 0.82;

      if (brightness < CONFIG.DIM_CUTOFF) {
        prevValid[i] = 0;
        continue;
      }

      var speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      var tSpeed = speed / MAX_PARTICLE_SPEED;
      if (tSpeed > 1) tSpeed = 1;
      var bucket = (tSpeed * (CONFIG.BUCKET_COUNT - 1) + 0.5) | 0;

      if (prevValid[i] && !wrapped) {
        streakPaths[bucket].moveTo(prevSX[i], prevSY[i]);
        streakPaths[bucket].lineTo(proj.x, proj.y);
        streakNonEmpty[bucket] = true;
      }

      if ((i % spriteStride) === 0 && brightness > 0.22) {
        var size = CONFIG.DOT_BASE_SIZE * dpr * Math.max(0.35, Math.min(2.2, proj.scale * 0.55)) * (0.7 + seed[i] * 0.6);
        spriteQueues[bucket].push(proj.x, proj.y, size, brightness);
      }

      prevSX[i] = proj.x;
      prevSY[i] = proj.y;
      prevValid[i] = 1;
    }

    for (var bs = 0; bs < CONFIG.BUCKET_COUNT; bs++) {
      if (!streakNonEmpty[bs]) continue;
      ctx.strokeStyle = bucketStreakStyle[bs];
      ctx.lineWidth = CONFIG.STREAK_WIDTH * dpr;
      ctx.lineCap = 'round';
      ctx.stroke(streakPaths[bs]);
    }

    for (var bd = 0; bd < CONFIG.BUCKET_COUNT; bd++) {
      var q = spriteQueues[bd];
      if (q.length === 0) continue;
      var sprite = bucketSprite[bd];
      for (var qi = 0; qi < q.length; qi += 4) {
        var qx = q[qi], qy = q[qi + 1], qsize = q[qi + 2], qbright = q[qi + 3];
        ctx.globalAlpha = CONFIG.SPRITE_ALPHA * qbright;
        ctx.drawImage(sprite, qx - qsize / 2, qy - qsize / 2, qsize, qsize);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // 4) Замер нагрузки для адаптивной плотности.
    var workMs = performance.now() - workStart;
    frameWorkEma = frameWorkEma * 0.9 + workMs * 0.1;
    fpsEma = fpsEma * 0.92 + (dtReal > 0 ? 1 / dtReal : fpsEma) * 0.08;
    adaptQuality();

    statsFrameCounter++;
    if (statsFrameCounter % 15 === 0 && statsLine) {
      statsLine.textContent = Math.round(fpsEma) + ' fps · ' + activeCount.toLocaleString('ru-RU') + ' частиц · ' + workMs.toFixed(1) + ' мс/кадр';
    }

    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
