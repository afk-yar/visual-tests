'use strict';
/*
 * Поток частиц 3D — Opus 4.8
 *
 * Десятки тысяч частиц, переносимых трёхмерным curl-noise полем скоростей.
 * Рендер-конвейер:
 *   1. HDR-аккумулятор (Float32Array, по 3 канала RGB на пиксель).
 *   2. Каждый кадр буфер умножается на (1 - trailFade) — это даёт
 *      затухающие следы и общую дымку без тысяч fillRect.
 *   3. Каждая частица "размазывается" (additive splat 2x2 с глубинным
 *      весом) прямо в HDR-буфер — настоящее аддитивное свечение.
 *   4. Один проход тон-маппинга буфера -> ImageData -> putImageData.
 *
 * Камера: перспективная проекция + медленное авто-вращение по двум осям.
 * Цвет: смесь палитры по скорости и по глубине.
 */
(function () {
  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d', { alpha: false });
  var statEl = document.getElementById('stat');

  // ── Управление ────────────────────────────────────────────────────────
  var ui = {
    playPause: document.getElementById('playPause'),
    spin: document.getElementById('spin'),
    palette: document.getElementById('palette'),
    count: document.getElementById('count'),
    flow: document.getElementById('flow'),
    trail: document.getElementById('trail'),
    glow: document.getElementById('glow')
  };

  var state = {
    running: true,
    spinning: true,
    paletteIndex: 0,
    flow: parseFloat(ui.flow.value),
    trailFade: parseFloat(ui.trail.value),
    glow: parseFloat(ui.glow.value)
  };

  // ── Поле скоростей ────────────────────────────────────────────────────
  var field = FlowNoise.makeCurl(20260613);

  // ── Геометрия мира ────────────────────────────────────────────────────
  // Частицы живут внутри куба со стороной ~2*BOUND вокруг начала координат.
  var BOUND = 2.6;
  var NOISE_SCALE = 0.42;   // масштаб координат при выборке поля
  var FIELD_DRIFT = 0.045;  // медленный дрейф поля во времени (4-е измерение через смещение)

  // ── Частицы (типизированные массивы) ─────────────────────────────────
  var MAX = 90000;
  var px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  var vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
  var life = new Float32Array(MAX);
  var seedR = 1234567;
  var count = parseInt(ui.count.value, 10);

  function rnd() {
    // быстрый детерминированный xorshift в [0,1)
    seedR ^= seedR << 13; seedR ^= seedR >>> 17; seedR ^= seedR << 5;
    return ((seedR >>> 0) % 1000000) / 1000000;
  }

  function spawn(i) {
    // Распределяем частицы в шаре для более плотного и кинематографичного ядра.
    var r = BOUND * Math.cbrt(rnd());
    var th = rnd() * Math.PI * 2;
    var ph = Math.acos(2 * rnd() - 1);
    var sp = Math.sin(ph);
    px[i] = r * sp * Math.cos(th);
    py[i] = r * sp * Math.sin(th);
    pz[i] = r * Math.cos(ph);
    vx[i] = vy[i] = vz[i] = 0;
    life[i] = 0.4 + rnd() * 2.2; // секунды жизни до респавна
  }

  function initParticles() {
    for (var i = 0; i < MAX; i++) spawn(i);
  }
  initParticles();

  // ── Камера ────────────────────────────────────────────────────────────
  var cam = { yaw: 0.4, pitch: -0.22, dist: 7.4, fov: 1.0 };

  // ── HDR-буфер и вывод ────────────────────────────────────────────────
  var W = 0, H = 0, dpr = 1;
  var acc = null;          // Float32Array, 3 канала на пиксель
  var img = null;          // ImageData
  var imgData = null;      // Uint8ClampedArray
  var halfW = 0, halfH = 0, focal = 0;

  function resize() {
    var rect = canvas.getBoundingClientRect();
    // Ограничиваем внутреннее разрешение ради FPS при больших размерах iframe.
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var cssW = Math.max(1, rect.width || window.innerWidth);
    var cssH = Math.max(1, rect.height || window.innerHeight);
    var targetW = Math.round(cssW * dpr);
    var targetH = Math.round(cssH * dpr);
    // Потолок по числу пикселей, чтобы тяжёлые экраны не роняли частоту.
    var MAXPIX = 2200000;
    var pix = targetW * targetH;
    if (pix > MAXPIX) {
      var s = Math.sqrt(MAXPIX / pix);
      targetW = Math.round(targetW * s);
      targetH = Math.round(targetH * s);
    }
    W = targetW; H = targetH;
    canvas.width = W; canvas.height = H;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    halfW = W * 0.5; halfH = H * 0.5;
    focal = halfH / Math.tan(cam.fov * 0.5);
    acc = new Float32Array(W * H * 3);
    img = ctx.createImageData(W, H);
    imgData = img.data;
  }

  window.addEventListener('resize', resize);
  resize();

  // ── Палитры (по 3 контрольные точки: low/mid/high) ───────────────────
  // Каждый цвет в линейном [0..1]; интерполяция в updateColors().
  var palettes = [
    { // Ион — голубой -> бирюзовый -> белёсо-розовый
      name: 'Ион',
      a: [0.04, 0.10, 0.42], b: [0.10, 0.72, 0.95], c: [1.00, 0.78, 0.92]
    },
    { // Магма — фиолет -> малиновый -> золото
      name: 'Магма',
      a: [0.18, 0.04, 0.30], b: [0.95, 0.18, 0.42], c: [1.00, 0.86, 0.45]
    },
    { // Аврора — индиго -> изумруд -> лайм
      name: 'Аврора',
      a: [0.06, 0.06, 0.36], b: [0.10, 0.85, 0.55], c: [0.80, 1.00, 0.55]
    }
  ];

  // ── Цвет частицы: смесь по скорости (t) и по глубине (d, дальше -> темнее/холоднее)
  function blendColor(pal, t, out) {
    // двухсегментная интерполяция a->b->c
    var r, g, b;
    if (t < 0.5) {
      var u = t * 2;
      r = pal.a[0] + (pal.b[0] - pal.a[0]) * u;
      g = pal.a[1] + (pal.b[1] - pal.a[1]) * u;
      b = pal.a[2] + (pal.b[2] - pal.a[2]) * u;
    } else {
      var u2 = (t - 0.5) * 2;
      r = pal.b[0] + (pal.c[0] - pal.b[0]) * u2;
      g = pal.b[1] + (pal.c[1] - pal.b[1]) * u2;
      b = pal.b[2] + (pal.c[2] - pal.b[2]) * u2;
    }
    out[0] = r; out[1] = g; out[2] = b;
  }

  var colTmp = [0, 0, 0];

  // ── Симуляция + рендер одного кадра ──────────────────────────────────
  var lastT = performance.now();
  var fps = 60, fpsT = lastT, fpsCount = 0;
  var simTime = 0;

  function frame(now) {
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05; // защита от больших скачков (вкладка ушла в фон)

    if (state.running) {
      simTime += dt;
      step(dt);
    }
    render();

    // FPS-счётчик
    fpsCount++;
    if (now - fpsT > 500) {
      fps = Math.round((fpsCount * 1000) / (now - fpsT));
      fpsT = now; fpsCount = 0;
      statEl.textContent = count.toLocaleString('ru-RU') + ' частиц · ' + fps + ' fps';
    }
    requestAnimationFrame(frame);
  }

  // Физика: продвигаем частицы вдоль curl-noise поля.
  function step(dt) {
    if (state.spinning) {
      cam.yaw += dt * 0.085;
      cam.pitch = -0.22 + Math.sin(simTime * 0.13) * 0.12;
    }

    var sc = NOISE_SCALE;
    var drift = simTime * FIELD_DRIFT;
    var speed = state.flow * 1.35;
    var damp = Math.pow(0.0008, dt); // вязкость: плавное перетекание потоков
    var b2 = BOUND;

    for (var i = 0; i < count; i++) {
      // выборка поля в координатах частицы (с дрейфом по z как 4-е измерение)
      var v = field.curl(px[i] * sc, py[i] * sc, pz[i] * sc + drift);

      // целевая скорость от поля + лёгкий вихрь к центру для собранности
      var tvx = v.x * speed;
      var tvy = v.y * speed;
      var tvz = v.z * speed;

      // инерция: скорость плавно тянется к полю -> мягкие, текучие траектории
      vx[i] = vx[i] * damp + tvx * (1 - damp);
      vy[i] = vy[i] * damp + tvy * (1 - damp);
      vz[i] = vz[i] * damp + tvz * (1 - damp);

      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      pz[i] += vz[i] * dt;

      // жизнь / респавн: ограничивает время жизни и держит плотность ядра
      life[i] -= dt;
      var rr = px[i] * px[i] + py[i] * py[i] + pz[i] * pz[i];
      if (life[i] <= 0 || rr > b2 * b2 * 1.55) {
        spawn(i);
      }
    }
  }

  // Проекция + аддитивный splat в HDR-буфер, затем тон-маппинг.
  function render() {
    // 1) затухание буфера (следы + дымка)
    var fade = 1 - state.trailFade;
    var n = acc.length;
    var k;
    // лёгкая дымка: к чёрному, но не в ноль — оставляет призрачный шлейф
    for (k = 0; k < n; k++) acc[k] *= fade;

    // 2) матрица камеры (yaw вокруг Y, pitch вокруг X)
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var dist = cam.dist;
    var f = focal;
    var pal = palettes[state.paletteIndex];
    var glow = state.glow;

    var c = count;
    // глубинный диапазон для нормировки цвета/яркости
    var nearZ = dist - BOUND * 1.6;
    var farZ = dist + BOUND * 1.6;
    var invDepth = 1 / (farZ - nearZ);

    for (var i = 0; i < c; i++) {
      var X = px[i], Y = py[i], Z = pz[i];

      // вращение yaw (вокруг Y)
      var x1 = X * cy + Z * sy;
      var z1 = -X * sy + Z * cy;
      // вращение pitch (вокруг X)
      var y2 = Y * cp - z1 * sp;
      var z2 = Y * sp + z1 * cp;

      var zc = z2 + dist; // в координатах камеры (вперёд +Z)
      if (zc < 0.25) continue; // за камерой / слишком близко

      var inv = f / zc;
      var sxp = halfW + x1 * inv;
      var syp = halfH - y2 * inv;
      if (sxp < 0 || sxp >= W || syp < 0 || syp >= H) continue;

      // глубинный фактор: 0 (далеко) .. 1 (близко)
      var depth = 1 - (zc - nearZ) * invDepth;
      if (depth < 0) depth = 0; else if (depth > 1) depth = 1;

      // скорость частицы -> яркость и положение в палитре
      var s2 = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i];
      var sp01 = s2 / (s2 + 1.1); // 0..1, сатурируется
      // цвет: палитра по скорости, чуть сдвинута глубиной
      var t = sp01 * 0.72 + depth * 0.28;
      if (t > 1) t = 1;
      blendColor(pal, t, colTmp);

      // яркость: ближние и быстрые частицы ярче; общий множитель glow
      var bright = glow * (0.16 + sp01 * 0.55) * (0.45 + depth * 0.95);
      // близкие частицы крупнее -> splat 2x2 с весами; дальние -> точка
      var rr = colTmp[0] * bright;
      var gg = colTmp[1] * bright;
      var bb = colTmp[2] * bright;

      var ix = sxp | 0;
      var iy = syp | 0;
      var base = (iy * W + ix) * 3;
      acc[base] += rr; acc[base + 1] += gg; acc[base + 2] += bb;

      // мягкий ореол у близких частиц (subpixel-распределение в 2x2)
      if (depth > 0.55) {
        var fx = sxp - ix, fy = syp - iy;
        var halo = 0.5 + (depth - 0.55) * 0.9;
        if (ix + 1 < W) {
          var b1 = base + 3, w1 = fx * halo;
          acc[b1] += rr * w1; acc[b1 + 1] += gg * w1; acc[b1 + 2] += bb * w1;
        }
        if (iy + 1 < H) {
          var b2 = base + W * 3, w2 = fy * halo;
          acc[b2] += rr * w2; acc[b2 + 1] += gg * w2; acc[b2 + 2] += bb * w2;
        }
        if (ix + 1 < W && iy + 1 < H) {
          var b3 = base + W * 3 + 3, w3 = fx * fy * halo;
          acc[b3] += rr * w3; acc[b3 + 1] += gg * w3; acc[b3 + 2] += bb * w3;
        }
      }
    }

    toneMap();
    ctx.putImageData(img, 0, 0);
  }

  // Тон-маппинг HDR-буфера в 8-бит RGBA с фильмическим сжатием и виньеткой.
  function toneMap() {
    var d = imgData;
    var a = acc;
    var w = W, h = H;
    var cx = halfW, cy = halfH;
    var invR2 = 1 / (cx * cx + cy * cy);
    var p = 0, j = 0;
    // лёгкий холодный фон-градиент (космическая дымка)
    for (var y = 0; y < h; y++) {
      var dy = y - cy;
      for (var x = 0; x < w; x++) {
        var r = a[j], g = a[j + 1], b = a[j + 2];

        // фильмическое сжатие (Reinhard-расширенный): r/(1+r) с подъёмом
        r = r / (1 + r);
        g = g / (1 + g);
        b = b / (1 + b);

        // виньетка: затемнение к краям
        var dx = x - cx;
        var vig = 1 - (dx * dx + dy * dy) * invR2 * 0.55;

        // фоновое свечение центра (мягкая дымка) добавляет глубину сцене
        var bgr = (1 - (dx * dx + dy * dy) * invR2) * 0.018;

        var R = (r * vig + bgr * 0.4) * 255;
        var G = (g * vig + bgr * 0.6) * 255;
        var B = (b * vig + bgr * 1.0) * 255;

        if (R > 255) R = 255; if (G > 255) G = 255; if (B > 255) B = 255;
        d[p] = R; d[p + 1] = G; d[p + 2] = B; d[p + 3] = 255;
        p += 4; j += 3;
      }
    }
  }

  // ── Обработчики UI ────────────────────────────────────────────────────
  ui.playPause.addEventListener('click', function () {
    state.running = !state.running;
    ui.playPause.textContent = state.running ? 'Пауза' : 'Запуск';
    lastT = performance.now();
  });
  ui.spin.addEventListener('click', function () {
    state.spinning = !state.spinning;
    ui.spin.classList.toggle('on', state.spinning);
  });
  ui.palette.addEventListener('click', function () {
    state.paletteIndex = (state.paletteIndex + 1) % palettes.length;
  });
  ui.count.addEventListener('input', function () {
    var nv = parseInt(ui.count.value, 10);
    if (nv > count) { for (var i = count; i < nv; i++) spawn(i); }
    count = nv;
  });
  ui.flow.addEventListener('input', function () { state.flow = parseFloat(ui.flow.value); });
  ui.trail.addEventListener('input', function () { state.trailFade = parseFloat(ui.trail.value); });
  ui.glow.addEventListener('input', function () { state.glow = parseFloat(ui.glow.value); });

  // лёгкая интерактивность: перетаскивание мышью слегка крутит камеру
  var dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    cam.yaw += (e.clientX - lastX) * 0.005;
    cam.pitch += (e.clientY - lastY) * 0.005;
    if (cam.pitch > 1.3) cam.pitch = 1.3;
    if (cam.pitch < -1.3) cam.pitch = -1.3;
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('pointerup', function () { dragging = false; });

  requestAnimationFrame(frame);
})();
