/* «Поток частиц 3D» — Claude Fable 5
 *
 * Десятки тысяч частиц в трёхмерном дивергентно-свободном поле скоростей
 * (ротор шумового векторного потенциала — curl-noise) на Canvas 2D.
 *
 * Ключевые приёмы:
 *  - поле = curl(Ψ), Ψ — 3 октавы периодического value-noise на решётке 40³;
 *    два независимых поля медленно морфируются друг в друга + дрейф домена
 *    → «плавное перетекание потоков» без пересчёта шума в кадре;
 *  - трилинейная выборка поля, инерция частиц, жизненный цикл с fade-in/out;
 *  - яркость частицы лепится локальной скоростью поля (перцентильная нормировка
 *    по фактическому распределению |v|): медленные зоны — едва заметная пыль,
 *    быстрые струи — светящиеся «жилы» → крупная структура и негативное
 *    пространство; респаун смещён в быстрые области (rejection sampling);
 *  - перспективная проекция, туман по глубине, гауссово растворение к краям;
 *  - аддитивный рендер (composite 'lighter') с батчингом по цвету:
 *    counting sort частиц по «ведру» цвет×яркость → минимум смен fillStyle;
 *  - накопительный canvas со шлейфами (полупрозрачная заливка фоном);
 *  - дешёвый двухуровневый bloom: даунскейл 1/4 и 1/16 → апскейл 'lighter';
 *  - медленная орбита камеры + ручной обзор мышью и зум колесом.
 */
(function () {
  'use strict';

  // ---------- Константы ----------
  var MAX_P = 80000;              // максимум частиц (typed arrays выделяются один раз)
  var N = 40;                     // размер решётки поля
  var N3 = N * N * N;
  var VSCALE = 0.085;             // средняя скорость потока, доли домена в секунду
  var NHUE = 12, NINT = 7;        // квантование цвета: оттенок × яркость
  var NB = NHUE * NINT;
  var STAR_N = 360;               // фоновые «звёзды» для глубины
  var STAR_G = STAR_N / 3;
  var MIX_PERIOD = 47;            // период морфинга полей, с

  var params = {
    count: 30000,
    flow: 1,
    trails: 0.55,
    glow: 0.8,
    bySpeed: true,
    paused: false
  };

  // ---------- Утилиты ----------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function fmt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function hash3(x, y, z, s) {
    var h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) +
             Math.imul(z, 1440662683) + Math.imul(s, 974711)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Периодический value-noise: решётка из f узлов, координаты в [0,1)
  function pnoise(x, y, z, f, seed) {
    var u = x * f, v = y * f, w = z * f;
    var i = u | 0, j = v | 0, k = w | 0;
    var fx = u - i, fy = v - j, fz = w - k;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    fz = fz * fz * (3 - 2 * fz);
    var i1 = i + 1; if (i1 === f) i1 = 0;
    var j1 = j + 1; if (j1 === f) j1 = 0;
    var k1 = k + 1; if (k1 === f) k1 = 0;
    var n000 = hash3(i, j, k, seed),  n100 = hash3(i1, j, k, seed);
    var n010 = hash3(i, j1, k, seed), n110 = hash3(i1, j1, k, seed);
    var n001 = hash3(i, j, k1, seed), n101 = hash3(i1, j, k1, seed);
    var n011 = hash3(i, j1, k1, seed), n111 = hash3(i1, j1, k1, seed);
    var nx00 = n000 + (n100 - n000) * fx;
    var nx10 = n010 + (n110 - n010) * fx;
    var nx01 = n001 + (n101 - n001) * fx;
    var nx11 = n011 + (n111 - n011) * fx;
    var ny0 = nx00 + (nx10 - nx00) * fy;
    var ny1 = nx01 + (nx11 - nx01) * fy;
    return (ny0 + (ny1 - ny0) * fz) * 2 - 1;
  }

  // ---------- Поле скоростей: v = curl(Ψ) на периодической решётке ----------
  function makeField(seed) {
    var psi = new Float32Array(N3 * 3);
    var idx = 0;
    var i, j, k, c;
    for (i = 0; i < N; i++) {
      var x = i / N;
      for (j = 0; j < N; j++) {
        var y = j / N;
        for (k = 0; k < N; k++, idx += 3) {
          var z = k / N;
          for (c = 0; c < 3; c++) {
            var s = seed + c * 131;
            psi[idx + c] =
              pnoise(x, y, z, 3, s) +
              0.5 * pnoise(x, y, z, 6, s + 17) +
              0.25 * pnoise(x, y, z, 12, s + 29);
          }
        }
      }
    }
    var fld = new Float32Array(N3 * 3);
    for (i = 0; i < N; i++) {
      var ip = (i + 1) % N, im = (i + N - 1) % N;
      for (j = 0; j < N; j++) {
        var jp = (j + 1) % N, jm = (j + N - 1) % N;
        for (k = 0; k < N; k++) {
          var kp = (k + 1) % N, km = (k + N - 1) % N;
          // v = ∇×Ψ (центральные разности; общий множитель уходит в нормировку)
          var vx = (psi[((i * N + jp) * N + k) * 3 + 2] - psi[((i * N + jm) * N + k) * 3 + 2]) -
                   (psi[((i * N + j) * N + kp) * 3 + 1] - psi[((i * N + j) * N + km) * 3 + 1]);
          var vy = (psi[((i * N + j) * N + kp) * 3]     - psi[((i * N + j) * N + km) * 3]) -
                   (psi[((ip * N + j) * N + k) * 3 + 2] - psi[((im * N + j) * N + k) * 3 + 2]);
          var vz = (psi[((ip * N + j) * N + k) * 3 + 1] - psi[((im * N + j) * N + k) * 3 + 1]) -
                   (psi[((i * N + jp) * N + k) * 3]     - psi[((i * N + jm) * N + k) * 3]);
          var o = ((i * N + j) * N + k) * 3;
          fld[o] = vx; fld[o + 1] = vy; fld[o + 2] = vz;
        }
      }
    }
    // нормировка: средняя |v| = 1
    var sum = 0;
    for (i = 0; i < N3; i++) {
      var a = fld[i * 3], b = fld[i * 3 + 1], d = fld[i * 3 + 2];
      sum += Math.sqrt(a * a + b * b + d * d);
    }
    var scale = N3 / Math.max(sum, 1e-9);
    for (i = 0; i < fld.length; i++) fld[i] *= scale;
    return fld;
  }

  var fieldA = makeField(1);
  var fieldB = makeField(7777);
  var fieldM = new Float32Array(N3 * 3);
  var mixLast = -1;

  // Фактическое распределение |v| по узлам обоих полей → перцентили для
  // нормировки цвета и яркости (иначе верх палитры никогда не достигается).
  var PCT = (function () {
    var mg = new Float32Array(N3 * 2);
    for (var i = 0; i < N3; i++) {
      var ax = fieldA[i * 3], ay = fieldA[i * 3 + 1], az = fieldA[i * 3 + 2];
      mg[i] = Math.sqrt(ax * ax + ay * ay + az * az);
      var bx = fieldB[i * 3], by = fieldB[i * 3 + 1], bz = fieldB[i * 3 + 2];
      mg[N3 + i] = Math.sqrt(bx * bx + by * by + bz * bz);
    }
    mg.sort();
    function q(p) { return mg[Math.min(mg.length - 1, (mg.length * p) | 0)]; }
    return { p05: q(0.05), p40: q(0.4), p50: q(0.5), p80: q(0.8), p90: q(0.9) };
  })();
  var RESP_T2 = PCT.p50 * PCT.p50; // порог смещения респауна в быстрые зоны

  function mixFields(m) {
    var a = fieldA, b = fieldB, M = fieldM;
    var i;
    for (i = 0; i < M.length; i++) M[i] = a[i] + (b[i] - a[i]) * m;
    // перенормировка средней |v| к 1: морфинг не гасит ни яркость, ни палитру
    var sum = 0;
    for (i = 0; i < N3; i++) {
      var vx = M[i * 3], vy = M[i * 3 + 1], vz = M[i * 3 + 2];
      sum += Math.sqrt(vx * vx + vy * vy + vz * vz);
    }
    var s = N3 / Math.max(sum, 1e-9);
    for (i = 0; i < M.length; i++) M[i] *= s;
  }
  mixFields(0);
  mixLast = 0;

  // ---------- Палитры (яркость вшита в цвет — для аддитивного смешения) ----------
  function ramp(stops, t) {
    var i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    var a = stops[i], b = stops[i + 1];
    var u = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
    return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
  }

  var speedStops = [           // медленно → быстро: индиго → лазурь → циан → золото
    [0.00, 12, 28, 92],
    [0.30, 24, 90, 200],
    [0.55, 46, 178, 228],
    [0.78, 168, 230, 215],
    [0.92, 255, 210, 150],
    [1.00, 255, 176, 108]
  ];
  var depthStops = [           // далеко → близко: холод → тепло (воздушная перспектива)
    [0.00, 30, 46, 140],
    [0.45, 70, 130, 224],
    [0.75, 190, 205, 230],
    [1.00, 255, 196, 130]
  ];

  function buildPalette(stops) {
    var arr = new Array(NB);
    for (var h = 0; h < NHUE; h++) {
      var c = ramp(stops, (h + 0.5) / NHUE);
      for (var q = 0; q < NINT; q++) {
        var k = Math.pow((q + 1) / NINT, 0.85);
        arr[h * NINT + q] = 'rgb(' + Math.round(c[0] * k) + ',' +
          Math.round(c[1] * k) + ',' + Math.round(c[2] * k) + ')';
      }
    }
    return arr;
  }
  var palSpeed = buildPalette(speedStops);
  var palDepth = buildPalette(depthStops);

  // ---------- Частицы ----------
  var PX = new Float32Array(MAX_P), PY = new Float32Array(MAX_P), PZ = new Float32Array(MAX_P);
  var VX = new Float32Array(MAX_P), VY = new Float32Array(MAX_P), VZ = new Float32Array(MAX_P);
  var LF = new Float32Array(MAX_P), LM = new Float32Array(MAX_P), JT = new Float32Array(MAX_P);

  for (var pi = 0; pi < MAX_P; pi++) {
    PX[pi] = Math.random(); PY[pi] = Math.random(); PZ[pi] = Math.random();
    LM[pi] = 7 + Math.random() * 9;
    LF[pi] = Math.random() * LM[pi];        // возрастá рассинхронизированы
    JT[pi] = 0.65 + Math.random() * 0.55;   // индивидуальная яркость
  }

  // Экранные scratch-буферы и counting sort по вёдрам цвета
  var SX = new Float32Array(MAX_P), SY = new Float32Array(MAX_P), SS = new Float32Array(MAX_P);
  var KEY = new Uint8Array(MAX_P);
  var ORD = new Int32Array(MAX_P);
  var counts = new Int32Array(NB), starts = new Int32Array(NB);

  // ---------- Фоновые звёзды (сфера за пределами куба потока) ----------
  var starW = new Float32Array(STAR_N * 3);
  var starCols = ['rgb(24,32,54)', 'rgb(44,58,94)', 'rgb(78,98,148)'];
  for (var si = 0; si < STAR_N; si++) {
    var th = Math.random() * Math.PI * 2;
    var ph = Math.acos(Math.random() * 2 - 1);
    var rr = 2.6 + Math.random() * 2.6;
    starW[si * 3]     = rr * Math.sin(ph) * Math.cos(th);
    starW[si * 3 + 1] = rr * Math.cos(ph);
    starW[si * 3 + 2] = rr * Math.sin(ph) * Math.sin(th);
  }

  // ---------- Canvas-пайплайн ----------
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d', { alpha: false });
  var trail = document.createElement('canvas');
  var tctx = trail.getContext('2d', { alpha: false });
  var blm1 = document.createElement('canvas');
  var b1ctx = blm1.getContext('2d', { alpha: false });
  var blm2 = document.createElement('canvas');
  var b2ctx = blm2.getContext('2d', { alpha: false });

  var W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = canvas.clientWidth || window.innerWidth;
    var ch = canvas.clientHeight || window.innerHeight;
    W = Math.max(1, Math.round(cw * dpr));
    H = Math.max(1, Math.round(ch * dpr));
    canvas.width = W; canvas.height = H;
    trail.width = W; trail.height = H;
    blm1.width = Math.max(8, Math.round(W / 4));
    blm1.height = Math.max(8, Math.round(H / 4));
    blm2.width = Math.max(4, Math.round(W / 16));
    blm2.height = Math.max(4, Math.round(H / 16));
    tctx.fillStyle = 'rgb(5,8,14)';
    tctx.fillRect(0, 0, W, H);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Камера и взаимодействие ----------
  var uYaw = 0, uPitch = 0, tUYaw = 0, tUPitch = 0;
  var camDist = 3.9, tDist = 3.9; // камера дальше: край облака не упирается в кадр
  var dragging = false, lastPX = 0, lastPY = 0;

  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastPX = e.clientX; lastPY = e.clientY;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    tUYaw += (e.clientX - lastPX) * 0.005;
    tUPitch = clamp(tUPitch + (e.clientY - lastPY) * 0.004, -1.45, 0.85);
    lastPX = e.clientX; lastPY = e.clientY;
  });
  window.addEventListener('pointerup', function () { dragging = false; });
  window.addEventListener('pointercancel', function () { dragging = false; });

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    tDist = clamp(tDist * Math.exp(e.deltaY * 0.0009), 2.4, 6.0);
  }, { passive: false });

  // ---------- Панель управления ----------
  var statsEl = document.getElementById('stats');
  var btnPause = document.getElementById('btn-pause');
  var btnSpeed = document.getElementById('btn-speed');
  var btnDepth = document.getElementById('btn-depth');

  function bindRange(id, outId, apply) {
    var inp = document.getElementById(id);
    var out = document.getElementById(outId);
    inp.addEventListener('input', function () {
      apply(parseFloat(inp.value), out);
    });
    apply(parseFloat(inp.value), out);
  }
  bindRange('ctl-count', 'out-count', function (v, out) {
    params.count = v | 0;
    out.textContent = fmt(params.count);
  });
  bindRange('ctl-flow', 'out-flow', function (v, out) {
    params.flow = v;
    out.textContent = '×' + v.toFixed(2);
  });
  bindRange('ctl-trails', 'out-trails', function (v, out) {
    params.trails = v;
    out.textContent = Math.round(v * 100) + '%';
  });
  bindRange('ctl-glow', 'out-glow', function (v, out) {
    params.glow = v;
    out.textContent = Math.round(v * 100) + '%';
  });

  function setMode(bySpeed) {
    params.bySpeed = bySpeed;
    btnSpeed.classList.toggle('active', bySpeed);
    btnDepth.classList.toggle('active', !bySpeed);
  }
  btnSpeed.addEventListener('click', function () { setMode(true); });
  btnDepth.addEventListener('click', function () { setMode(false); });

  function setPaused(p) {
    params.paused = p;
    btnPause.textContent = p ? '▶ Продолжить' : '⏸ Пауза';
  }
  btnPause.addEventListener('click', function () { setPaused(!params.paused); });
  document.addEventListener('keydown', function (e) {
    if (e.code !== 'Space') return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT') return;
    e.preventDefault();
    setPaused(!params.paused);
  });

  // ---------- Главный цикл ----------
  var last = performance.now();
  var simT = 0;                 // время симуляции (замирает на паузе)
  var ox = 0, oz = 0;           // дрейф домена поля
  var fps = 60, statsClock = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = (now - last) / 1000;
    last = now;
    if (dt <= 0) dt = 0.001;
    if (dt > 0.05) dt = 0.05;   // кламп больших пауз (фон, лаги)
    fps += (1 / dt - fps) * 0.05;

    var dts = params.paused ? 0 : dt;
    simT += dts;

    // морфинг полей + дрейф домена
    if (dts > 0) {
      var m = 0.5 - 0.5 * Math.cos(simT * (2 * Math.PI / MIX_PERIOD));
      if (Math.abs(m - mixLast) > 0.0015) { mixFields(m); mixLast = m; }
      oz += dts * 0.012; if (oz >= 1) oz -= 1;
      ox += dts * 0.005; if (ox >= 1) ox -= 1;
    }

    // камера: медленная орбита + ручной обзор
    var kCam = 1 - Math.exp(-dt * 5);
    uYaw += (tUYaw - uYaw) * kCam;
    uPitch += (tUPitch - uPitch) * kCam;
    camDist += (tDist - camDist) * (1 - Math.exp(-dt * 3));
    var yaw = 0.6 + simT * 0.05 + uYaw;
    var pitch = clamp(0.3 + Math.sin(simT * 0.09) * 0.12 + uPitch, -1.25, 1.25);
    var camD = camDist + Math.sin(simT * 0.06 + 1) * 0.12;

    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var cx = W * 0.5, cyy = H * 0.5;
    var focal = Math.min(W, H) * 1.15;
    var dNear = camD - 1.75, invRange = 1 / 3.5;

    var count = params.count;
    var vs = VSCALE * params.flow;
    var inert = 1 - Math.exp(-dt * 3.2);
    var invVs = 1.12 / Math.max(vs, 1e-6); // |v| частицы → единицы поля (1.12 компенсирует лаг инерции)
    // цвет: p05..~p97 (растяжка за p90) — золото достаётся только экстремальным струям,
    // иначе яркая выборка (яркость и цвет растут от одной скорости) вся уходит в тёплое
    var cLo = PCT.p05, cInv = 1 / Math.max((PCT.p90 - PCT.p05) * 1.35, 1e-6);
    var bLo = PCT.p40, bInv = 1 / Math.max(PCT.p80 - PCT.p40, 1e-6); // яркость: p40..p80
    var bySpeed = params.bySpeed;
    var Mf = fieldM;

    // --- обновление + проекция ---
    var vis = 0;
    for (var i = 0; i < count; i++) {
      var x = PX[i], y = PY[i], z = PZ[i];

      if (dts > 0) {
        // координаты в решётке (с дрейфом домена), трилинейная выборка поля
        var gx = x + ox; gx -= gx | 0; gx *= N;
        var gy = y * N;
        var gz = z + oz; gz -= gz | 0; gz *= N;
        var i0 = gx | 0, j0 = gy | 0, k0 = gz | 0;
        var fx = gx - i0, fy = gy - j0, fz = gz - k0;
        var i1 = i0 + 1; if (i1 >= N) i1 = 0;
        var j1 = j0 + 1; if (j1 >= N) j1 = 0;
        var k1 = k0 + 1; if (k1 >= N) k1 = 0;
        var r00 = (i0 * N + j0) * N, r01 = (i0 * N + j1) * N;
        var r10 = (i1 * N + j0) * N, r11 = (i1 * N + j1) * N;
        var c000 = (r00 + k0) * 3, c001 = (r00 + k1) * 3;
        var c010 = (r01 + k0) * 3, c011 = (r01 + k1) * 3;
        var c100 = (r10 + k0) * 3, c101 = (r10 + k1) * 3;
        var c110 = (r11 + k0) * 3, c111 = (r11 + k1) * 3;
        var gx1 = 1 - fx, gy1 = 1 - fy, gz1 = 1 - fz;
        var w000 = gx1 * gy1 * gz1, w001 = gx1 * gy1 * fz;
        var w010 = gx1 * fy * gz1,  w011 = gx1 * fy * fz;
        var w100 = fx * gy1 * gz1,  w101 = fx * gy1 * fz;
        var w110 = fx * fy * gz1,   w111 = fx * fy * fz;

        var fvx = Mf[c000] * w000 + Mf[c001] * w001 + Mf[c010] * w010 + Mf[c011] * w011 +
                  Mf[c100] * w100 + Mf[c101] * w101 + Mf[c110] * w110 + Mf[c111] * w111;
        var fvy = Mf[c000 + 1] * w000 + Mf[c001 + 1] * w001 + Mf[c010 + 1] * w010 + Mf[c011 + 1] * w011 +
                  Mf[c100 + 1] * w100 + Mf[c101 + 1] * w101 + Mf[c110 + 1] * w110 + Mf[c111 + 1] * w111;
        var fvz = Mf[c000 + 2] * w000 + Mf[c001 + 2] * w001 + Mf[c010 + 2] * w010 + Mf[c011 + 2] * w011 +
                  Mf[c100 + 2] * w100 + Mf[c101 + 2] * w101 + Mf[c110 + 2] * w110 + Mf[c111 + 2] * w111;

        // инерция → шелковистое перетекание
        var nvx = VX[i] + (fvx * vs - VX[i]) * inert;
        var nvy = VY[i] + (fvy * vs - VY[i]) * inert;
        var nvz = VZ[i] + (fvz * vs - VZ[i]) * inert;
        x += nvx * dt; y += nvy * dt; z += nvz * dt;
        if (x >= 1) x -= 1; else if (x < 0) x += 1;
        if (y >= 1) y -= 1; else if (y < 0) y += 1;
        if (z >= 1) z -= 1; else if (z < 0) z += 1;

        var lf = LF[i] - dt;
        if (lf <= 0) {
          // респаун со смещением в быстрые области поля (rejection sampling)
          var tries = 4;
          do {
            x = Math.random(); y = Math.random(); z = Math.random();
            var ri = ((((x * N) | 0) * N + ((y * N) | 0)) * N + ((z * N) | 0)) * 3;
            var rvx = Mf[ri], rvy = Mf[ri + 1], rvz = Mf[ri + 2];
          } while (rvx * rvx + rvy * rvy + rvz * rvz < RESP_T2 && --tries > 0);
          lf = LM[i];
          nvx = 0; nvy = 0; nvz = 0;
        }
        PX[i] = x; PY[i] = y; PZ[i] = z;
        VX[i] = nvx; VY[i] = nvy; VZ[i] = nvz;
        LF[i] = lf;
      }

      // мировые координаты [-1,1]
      var wx = x * 2 - 1, wy = y * 2 - 1, wz = z * 2 - 1;

      // мягкое гауссово растворение к краям — без читаемого контура «шара»
      var r2 = wx * wx + wy * wy + wz * wz;
      var edge = Math.exp(-r2 * 0.8);

      // поворот (орбита yaw + наклон pitch) и перспектива
      var x1 = cy * wx + sy * wz;
      var z1 = cy * wz - sy * wx;
      var y2 = cp * wy - sp * z1;
      var z2 = sp * wy + cp * z1;
      var zc = z2 + camD;
      if (zc < 0.3) continue;
      var per = focal / zc;
      var sxp = cx + x1 * per;
      if (sxp < -8 || sxp > W + 8) continue;
      var syp = cyy - y2 * per;
      if (syp < -8 || syp > H + 8) continue;

      // глубина → туман; жизнь → плавное появление/угасание
      var dn = (zc - dNear) * invRange;
      if (dn < 0) dn = 0; else if (dn > 1) dn = 1;
      var lifeA = (LM[i] - LF[i]) * 1.5;
      var lo = LF[i] * 0.9;
      if (lo < lifeA) lifeA = lo;
      if (lifeA > 1) lifeA = 1;

      // яркость лепится локальной скоростью: медленные зоны — едва заметная
      // пыль, быстрые струи — светящиеся жилы → структура и негативное пространство
      var pvx = VX[i], pvy = VY[i], pvz = VZ[i];
      var s01 = Math.sqrt(pvx * pvx + pvy * pvy + pvz * pvz) * invVs;
      var vf = (s01 - bLo) * bInv;
      if (vf < 0) vf = 0; else if (vf > 1) vf = 1;
      vf = 0.07 + 0.93 * vf * Math.sqrt(vf);

      var inten = lifeA * (1 - dn * 0.65) * edge * JT[i] * vf;
      if (inten <= 0.012) continue;
      if (inten > 1) inten = 1;

      var ht;
      if (bySpeed) {
        ht = (s01 - cLo) * cInv;
        if (ht < 0) ht = 0; else if (ht > 1) ht = 1;
      } else {
        ht = 1 - dn;
      }
      var hIdx = (ht * NHUE) | 0; if (hIdx >= NHUE) hIdx = NHUE - 1;
      var qIdx = (inten * NINT) | 0; if (qIdx >= NINT) qIdx = NINT - 1;

      var sz = per * 0.0075;
      if (sz < 0.9) sz = 0.9; else if (sz > 3.2) sz = 3.2;

      KEY[vis] = hIdx * NINT + qIdx;
      SX[vis] = sxp; SY[vis] = syp; SS[vis] = sz;
      vis++;
    }

    // --- counting sort по вёдрам цвета ---
    counts.fill(0);
    var v;
    for (v = 0; v < vis; v++) counts[KEY[v]]++;
    var acc = 0;
    for (var b = 0; b < NB; b++) { starts[b] = acc; acc += counts[b]; }
    for (v = 0; v < vis; v++) ORD[starts[KEY[v]]++] = v;

    // --- шлейфы: затухание к цвету фона ---
    var fadeRate = 1.5 + (1 - params.trails) * 12;
    var fa = 1 - Math.exp(-dt * fadeRate);
    tctx.globalCompositeOperation = 'source-over';
    tctx.fillStyle = 'rgba(5,8,14,' + fa.toFixed(4) + ')';
    tctx.fillRect(0, 0, W, H);

    // --- аддитивный рендер ---
    tctx.globalCompositeOperation = 'lighter';

    // фоновые звёзды (3 группы яркости — 3 смены fillStyle)
    for (var g = 0; g < 3; g++) {
      tctx.fillStyle = starCols[g];
      for (var s2 = g * STAR_G; s2 < (g + 1) * STAR_G; s2++) {
        var swx = starW[s2 * 3], swy = starW[s2 * 3 + 1], swz = starW[s2 * 3 + 2];
        var sx1 = cy * swx + sy * swz;
        var sz1 = cy * swz - sy * swx;
        var sy2 = cp * swy - sp * sz1;
        var sz2 = sp * swy + cp * sz1;
        var szc = sz2 + camD;
        if (szc < 0.5) continue;
        var sper = focal / szc;
        var ssx = cx + sx1 * sper;
        if (ssx < 0 || ssx > W) continue;
        var ssy = cyy - sy2 * sper;
        if (ssy < 0 || ssy > H) continue;
        var sss = sper * 0.003;
        if (sss < 1) sss = 1; else if (sss > 2) sss = 2;
        tctx.fillRect(ssx, ssy, sss, sss);
      }
    }

    // частицы: пакетами по цвету
    var pal = bySpeed ? palSpeed : palDepth;
    var ptr = 0;
    for (b = 0; b < NB; b++) {
      var n = counts[b];
      if (n === 0) continue;
      tctx.fillStyle = pal[b];
      for (var e2 = 0; e2 < n; e2++) {
        var vi = ORD[ptr++];
        var s3 = SS[vi];
        tctx.fillRect(SX[vi] - s3 * 0.5, SY[vi] - s3 * 0.5, s3, s3);
      }
    }

    // --- вывод: базовый слой + дешёвый bloom (даунскейл → апскейл) ---
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(trail, 0, 0);
    if (params.glow > 0.01) {
      b1ctx.drawImage(trail, 0, 0, blm1.width, blm1.height);
      b2ctx.drawImage(blm1, 0, 0, blm2.width, blm2.height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, params.glow * 0.55);
      ctx.drawImage(blm1, 0, 0, W, H);
      ctx.globalAlpha = Math.min(1, params.glow * 0.4);
      ctx.drawImage(blm2, 0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // --- статистика ---
    statsClock += dt;
    if (statsClock > 0.5) {
      statsClock = 0;
      statsEl.textContent = Math.round(fps) + ' FPS · ' + fmt(count) +
        ' частиц' + (params.paused ? ' · пауза' : '');
    }
  }

  requestAnimationFrame(frame);
})();
