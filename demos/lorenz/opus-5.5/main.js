/*
 * Аттрактор Лоренца — Claude Opus 5.5
 * Canvas 2D (без WebGL). Интегрирование RK4 с фиксированным шагом, кольцевой
 * буфер 3D-точек, перспективная проекция с медленно вращающейся камерой,
 * затухающий след с градиентом по «возрасту» точки и глубинным затенением,
 * мягкое свечение через пирамиду даунсэмплинга.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  /* ---------------- модель ---------------- */
  var SIGMA = 10, RHO = 28, BETA = 8 / 3;
  var STEP = 0.002;                          // шаг RK4, модельное время
  var TRAIL_MAX = 80;                        // макс. длина следа, ед. времени
  var CAP = Math.ceil(TRAIL_MAX / STEP) + 8; // ёмкость кольцевого буфера
  var MAX_STEPS_PER_FRAME = 4000;

  /* ---------------- сцена ---------------- */
  var CZ = 23.5;          // высота точки, на которую смотрит камера
  var FLOOR_Z = -1.5;     // «пол» — плоскость проекции XY
  var DIST = 125;         // дистанция камеры (ед. модели)
  var DEPTH_R = 30;       // полуразмах глубины для затенения
  var AGE_B = 64;         // градаций цвета/прозрачности по возрасту
  var DEPTH_B = 6;        // градаций по глубине
  var SHADOW_B = 12;
  var ROT_SPEED = 0.1;    // рад/с — полный оборот ≈ 63 с
  var YAW0 = -0.42, PITCH0 = 0.27;
  var ZOOM_MIN = 0.45, ZOOM_MAX = 2.8;
  var BLOOM_GAIN = [0.5, 0.8, 1.15];         // вклад уровней 1/4, 1/8, 1/16
  var SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

  var PALETTES = [
    { name: 'Закат', stops: [[0, '#4a2fd8'], [0.3, '#9a37dc'], [0.55, '#ff4f93'], [0.75, '#ff8840'], [0.9, '#ffd166'], [1, '#fff7e2']] },
    { name: 'Аврора', stops: [[0, '#2a3bd0'], [0.3, '#1f8ee6'], [0.55, '#17d2b2'], [0.76, '#86f07c'], [0.91, '#e6ff9e'], [1, '#f6fff0']] },
    { name: 'Спектр', stops: [[0, '#6b2cff'], [0.2, '#3160ff'], [0.37, '#19c2ea'], [0.53, '#33e08a'], [0.68, '#e5e23b'], [0.82, '#ff8a2b'], [0.93, '#ff4271'], [1, '#ffe4ee']] },
    { name: 'Лёд', stops: [[0, '#2b2e96'], [0.35, '#3e62e6'], [0.62, '#4fb8ff'], [0.84, '#aeeaff'], [1, '#ffffff']] }
  ];

  /* ---------------- утилиты ---------------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hex(h) {
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')'; }
  function samplePalette(p, t) {
    var s = p.stops, i;
    if (t <= s[0][0]) return s[0][2].slice();
    for (i = 1; i < s.length; i++) {
      if (t <= s[i][0]) {
        var a = s[i - 1], b = s[i], f = (t - a[0]) / (b[0] - a[0]);
        return [
          a[2][0] + (b[2][0] - a[2][0]) * f,
          a[2][1] + (b[2][1] - a[2][1]) * f,
          a[2][2] + (b[2][2] - a[2][2]) * f
        ];
      }
    }
    return s[s.length - 1][2].slice();
  }
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  PALETTES.forEach(function (p) { p.stops.forEach(function (s) { s[2] = hex(s[1]); }); });

  /* ---------------- состояние модели ---------------- */
  var buf = new Float32Array(CAP * 3);
  var head = 0, count = 0;
  var X = 1, Y = 1, Z = 1, T = 0;

  function rk4() {
    var h = STEP, x = X, y = Y, z = Z;
    var ax = SIGMA * (y - x), ay = x * (RHO - z) - y, az = x * y - BETA * z;
    var x1 = x + 0.5 * h * ax, y1 = y + 0.5 * h * ay, z1 = z + 0.5 * h * az;
    var bx = SIGMA * (y1 - x1), by = x1 * (RHO - z1) - y1, bz = x1 * y1 - BETA * z1;
    var x2 = x + 0.5 * h * bx, y2 = y + 0.5 * h * by, z2 = z + 0.5 * h * bz;
    var kx = SIGMA * (y2 - x2), ky = x2 * (RHO - z2) - y2, kz = x2 * y2 - BETA * z2;
    var x3 = x + h * kx, y3 = y + h * ky, z3 = z + h * kz;
    var dx = SIGMA * (y3 - x3), dy = x3 * (RHO - z3) - y3, dz = x3 * y3 - BETA * z3;
    X = x + h / 6 * (ax + 2 * bx + 2 * kx + dx);
    Y = y + h / 6 * (ay + 2 * by + 2 * ky + dy);
    Z = z + h / 6 * (az + 2 * bz + 2 * kz + dz);
    T += h;
  }
  function record() {
    var o = head * 3;
    buf[o] = X; buf[o + 1] = Y; buf[o + 2] = Z;
    if (++head === CAP) head = 0;
    if (count < CAP) count++;
  }
  function advance(n, rec) {
    for (var i = 0; i < n; i++) { rk4(); if (rec) record(); }
  }

  /* ---------------- DOM / холсты ---------------- */
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  function mk() { return document.createElement('canvas'); }
  var bgC = mk(), bgX = bgC.getContext('2d');       // фон (перерисовывается при resize/палитре)
  var trC = mk(), trX = trC.getContext('2d');       // слой следа
  var glowC = mk();                                 // спрайт свечения «головы»
  var bl = [mk(), mk(), mk(), mk()];                // 1/2, 1/4, 1/8, 1/16
  var blX = bl.map(function (c) { return c.getContext('2d'); });
  // Размытые копии уровней 1/4, 1/8, 1/16. Растягивать на весь кадр можно только
  // размытый уровень: «сырой» уровень после бокс-даунсэмпла хранит резкие тексели
  // (тонкая линия → один яркий тексель рядом с тёмным), и билинейное растяжение
  // в 8–16 раз превращает их в сетку квадратов — пятна-«шахматку» в ореоле.
  var gl = [mk(), mk(), mk()];
  var glX = gl.map(function (c) { return c.getContext('2d'); });
  var tmpC = [mk(), mk(), mk()];                    // для запасного размытия
  var tmpX = tmpC.map(function (c) { return c.getContext('2d'); });
  var HAS_FILTER = typeof CanvasRenderingContext2D !== 'undefined' &&
    'filter' in CanvasRenderingContext2D.prototype;
  var BLOOM_SIGMA = [2, 2.5, 2.5];                  // σ размытия в текселях своего уровня

  var readout = document.getElementById('readout');
  var btnPlay = document.getElementById('btnPlay');
  var btnRotate = document.getElementById('btnRotate');
  var btnPalette = document.getElementById('btnPalette');
  var btnReset = document.getElementById('btnReset');
  var speedIn = document.getElementById('speed');
  var speedOut = document.getElementById('speedOut');
  var trailIn = document.getElementById('trail');
  var trailOut = document.getElementById('trailOut');
  var swatch = document.getElementById('swatch');
  var palName = document.getElementById('palName');

  var W = 1, VH = 1, DPR = 1, cx = 0, cy = 0, unitBase = 1;

  /* ---------------- проекционные буферы ---------------- */
  var PX = new Float32Array(CAP), PY = new Float32Array(CAP), PD = new Float32Array(CAP);
  var FX = new Float32Array(CAP), FY = new Float32Array(CAP);
  var SD = new Uint8Array(CAP);
  var CUE = new Float32Array(DEPTH_B), PERSP = new Float32Array(DEPTH_B);
  (function () {
    for (var d = 0; d < DEPTH_B; d++) {
      var dn = (d + 0.5) / DEPTH_B;                 // 0 — ближе к камере
      CUE[d] = 1.22 - 0.8 * dn;
      PERSP[d] = DIST / (DIST + (dn * 2 - 1) * DEPTH_R);
    }
  })();

  /* ---------------- настройки / камера ---------------- */
  var speed = 1, trailT = 24, running = true, autoRotate = true, paletteIdx = 0;
  var cam = { yaw: YAW0, pitch: PITCH0, zoom: 1 };
  var rotVel = ROT_SPEED, bobPhase = 0, dragging = false, easing = false, zoomW = 1;
  var V = { cyw: 1, syw: 0, cp: 1, sp: 0, unit: 1 };
  var P = { x: 0, y: 0, s: 1 };

  function project(x, y, z) {
    z -= CZ;
    var a = x * V.cyw - y * V.syw, b = x * V.syw + y * V.cyw;
    var d = b * V.cp - z * V.sp, u = b * V.sp + z * V.cp;
    var s = DIST / (DIST + d);
    P.x = cx + a * s * V.unit; P.y = cy - u * s * V.unit; P.s = s;
    return P;
  }

  /* ---------------- палитра ---------------- */
  var LUT = new Array(AGE_B);
  var PAL = { head: [255, 255, 255], hot: [255, 200, 120], mid: [255, 80, 150], low: [120, 60, 220] };
  var shadowStyle = '#888';

  function computePalette() {
    var p = PALETTES[paletteIdx];
    for (var k = 0; k < AGE_B; k++) LUT[k] = rgb(samplePalette(p, (k + 0.5) / AGE_B));
    PAL.head = samplePalette(p, 0.97);
    PAL.hot = samplePalette(p, 0.82);
    PAL.mid = samplePalette(p, 0.5);
    PAL.low = samplePalette(p, 0.3);
    shadowStyle = rgb(PAL.mid);

    var S = 128, g = glowC.getContext('2d');
    glowC.width = S; glowC.height = S;
    var rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.07, rgba(PAL.head, 0.95));
    rg.addColorStop(0.22, rgba(PAL.hot, 0.42));
    rg.addColorStop(0.5, rgba(PAL.hot, 0.1));
    rg.addColorStop(1, rgba(PAL.hot, 0));
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
  }

  function applyPaletteUI() {
    var p = PALETTES[paletteIdx];
    var root = document.documentElement.style;
    root.setProperty('--accent', rgb(PAL.hot));
    root.setProperty('--accent-soft', rgba(PAL.hot, 0.2));
    root.setProperty('--accent-line', rgba(PAL.hot, 0.45));
    swatch.style.background = 'linear-gradient(90deg,' + p.stops.map(function (s) {
      return s[1] + ' ' + Math.round(s[0] * 100) + '%';
    }).join(',') + ')';
    palName.textContent = p.name;
  }

  /* ---------------- фон ---------------- */
  function drawBackground() {
    var w = canvas.width, h = canvas.height, g = bgX;
    bgC.width = w; bgC.height = h;
    var R = Math.sqrt(w * w + h * h);

    var base = g.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, R * 0.62);
    base.addColorStop(0, '#11132c');
    base.addColorStop(0.45, '#080919');
    base.addColorStop(1, '#020207');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    var tint = g.createRadialGradient(w * 0.5, h * 0.47, 0, w * 0.5, h * 0.47, Math.min(w, h) * 0.6);
    tint.addColorStop(0, rgba(PAL.mid, 0.09));
    tint.addColorStop(1, rgba(PAL.mid, 0));
    g.fillStyle = tint;
    g.fillRect(0, 0, w, h);

    var rnd = mulberry32(1337);
    var n = Math.round((w * h) / (DPR * DPR) / 4200);
    for (var i = 0; i < n; i++) {
      var x = rnd() * w, y = rnd() * h;
      var r = (0.35 + Math.pow(rnd(), 3) * 1.0) * DPR;
      var a = 0.1 + Math.pow(rnd(), 2.2) * 0.5;
      g.fillStyle = (rnd() < 0.3 ? 'rgba(200,215,255,' : 'rgba(255,255,255,') + a.toFixed(3) + ')';
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }

    var vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, R * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  }

  /* ---------------- размеры ---------------- */
  function resize() {
    W = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    VH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    var pw = Math.max(1, Math.round(W * DPR)), ph = Math.max(1, Math.round(VH * DPR));
    canvas.width = pw; canvas.height = ph;
    trC.width = pw; trC.height = ph;
    var sw = pw, sh = ph;
    for (var i = 0; i < bl.length; i++) {
      sw = Math.max(1, Math.ceil(sw / 2)); sh = Math.max(1, Math.ceil(sh / 2));
      bl[i].width = sw; bl[i].height = sh;
      if (i > 0) {
        gl[i - 1].width = sw; gl[i - 1].height = sh;
        tmpC[i - 1].width = sw; tmpC[i - 1].height = sh;
      }
    }
    cx = W * 0.5;
    cy = VH * 0.5;
    unitBase = Math.min(W / 64, VH / 68);
    drawBackground();
  }

  /* ---------------- проекция следа ---------------- */
  function projectTrail(N) {
    var cyw = V.cyw, syw = V.syw, cp = V.cp, sp = V.sp, k = V.unit * DIST;
    var zf = FLOOR_Z - CZ, zfs = zf * sp, zfc = zf * cp;
    var idx = head - N; if (idx < 0) idx += CAP;
    var j;
    for (j = 0; j < N; j++) {
      var o = idx * 3;
      var x = buf[o], y = buf[o + 1], z = buf[o + 2] - CZ;
      var a = x * cyw - y * syw, b = x * syw + y * cyw;
      var d = b * cp - z * sp, u = b * sp + z * cp;
      var s = k / (DIST + d);
      PX[j] = cx + a * s; PY[j] = cy - u * s; PD[j] = d;
      var df = b * cp - zfs, uf = b * sp + zfc, sf = k / (DIST + df);
      FX[j] = cx + a * sf; FY[j] = cy - uf * sf;
      if (++idx === CAP) idx = 0;
    }
    var inv = DEPTH_B / (2 * DEPTH_R), top = DEPTH_B - 1;
    for (j = 0; j < N - 1; j++) {
      var q = ((PD[j] + PD[j + 1]) * 0.5 + DEPTH_R) * inv;
      SD[j] = q <= 0 ? 0 : (q >= top ? top : q | 0);
    }
  }

  // Разбивает сегменты [0, segs) на прогоны одного «возрастного» ведра.
  function ageRuns(segs, L, B, cb) {
    var kPrev = -1, i0 = 0;
    for (var i = 0; i < segs; i++) {
      var t = 1 - (segs - i - 0.5) / L;
      var k = (t * B) | 0;
      if (k >= B) k = B - 1; else if (k < 0) k = 0;
      if (k !== kPrev) {
        if (kPrev >= 0) cb(kPrev, i0, i);
        kPrev = k; i0 = i;
      }
    }
    if (kPrev >= 0) cb(kPrev, i0, segs);
  }

  function trailRun(k, i0, i1) {
    var t = (k + 0.5) / AGE_B;
    var aAge = 0.92 * Math.pow(t, 1.8);
    if (aAge < 0.005) return;
    var wAge = (0.45 + 1.6 * Math.pow(t, 2.4)) * zoomW;
    var dmin = DEPTH_B, dmax = -1, i, d;
    for (i = i0; i < i1; i++) { d = SD[i]; if (d < dmin) dmin = d; if (d > dmax) dmax = d; }
    trX.strokeStyle = LUT[k];
    for (d = dmin; d <= dmax; d++) {
      var open = false, any = false;
      trX.beginPath();
      for (i = i0; i < i1; i++) {
        if (SD[i] === d) {
          if (!open) { trX.moveTo(PX[i], PY[i]); open = true; }
          trX.lineTo(PX[i + 1], PY[i + 1]);
          any = true;
        } else open = false;
      }
      if (!any) continue;
      trX.globalAlpha = Math.min(1, aAge * CUE[d]);
      trX.lineWidth = wAge * PERSP[d];
      trX.stroke();
    }
  }

  function shadowRun(k, i0, i1) {
    var t = (k + 0.5) / SHADOW_B;
    var a = 0.13 * Math.pow(t, 1.6);
    if (a < 0.004) return;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(FX[i0], FY[i0]);
    for (var i = i0 + 1; i <= i1; i++) ctx.lineTo(FX[i], FY[i]);
    ctx.stroke();
  }

  function drawHead(N) {
    var j = N - 1;
    var s = DIST / (DIST + PD[j]) * zoomW;
    var R = 30 * s;
    trX.globalAlpha = 0.95;
    trX.drawImage(glowC, PX[j] - R, PY[j] - R, R * 2, R * 2);
    trX.globalAlpha = 1;
    trX.fillStyle = '#ffffff';
    trX.beginPath();
    trX.arc(PX[j], PY[j], 1.9 * s, 0, TAU);
    trX.fill();
  }

  function drawFloor() {
    var g = ctx, zf = FLOOR_Z, n = 120, r, k, p;
    g.globalAlpha = 1;
    g.lineWidth = 1;
    g.lineJoin = 'round';
    for (r = 6; r <= 30; r += 6) {
      g.beginPath();
      for (k = 0; k <= n; k++) {
        var a = k / n * TAU;
        p = project(r * Math.cos(a), r * Math.sin(a), zf);
        if (k === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
      }
      g.strokeStyle = 'rgba(160,172,255,' + (0.11 - r * 0.0022).toFixed(3) + ')';
      g.stroke();
    }
    g.beginPath();
    for (k = 0; k < 12; k++) {
      var a2 = k / 12 * TAU, c = Math.cos(a2), s = Math.sin(a2);
      p = project(3 * c, 3 * s, zf); g.moveTo(p.x, p.y);
      p = project(30 * c, 30 * s, zf); g.lineTo(p.x, p.y);
    }
    g.strokeStyle = 'rgba(160,172,255,0.045)';
    g.stroke();
  }

  function drawMarkers() {
    var q = Math.sqrt(BETA * (RHO - 1));
    var pts = [[q, q, 'C⁺'], [-q, -q, 'C⁻']];
    var g = ctx;
    g.globalAlpha = 1;
    g.font = '500 11px ' + SANS;
    g.textBaseline = 'alphabetic';
    for (var i = 0; i < pts.length; i++) {
      var p = project(pts[i][0], pts[i][1], RHO - 1);
      var px = p.x, py = p.y, s = p.s;
      var f = project(pts[i][0], pts[i][1], FLOOR_Z);
      g.setLineDash([2, 4]);
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(200,210,255,0.16)';
      g.beginPath(); g.moveTo(px, py); g.lineTo(f.x, f.y); g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(200,210,255,0.28)';
      g.beginPath(); g.arc(f.x, f.y, 1.6, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(235,238,255,0.5)';
      g.beginPath(); g.arc(px, py, 3.2 * s, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(235,238,255,0.5)';
      g.fillText(pts[i][2], px + 7, py - 6);
    }
  }

  // Проход Kawase: 4 выборки со сдвигом ±o по диагонали; билинейная выборка
  // на полутекселе усредняет блок 2×2, в сумме — гладкое ядро-«шатёр».
  function kawasePass(src, g, dst, o) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, dst.width, dst.height);
    g.imageSmoothingEnabled = true;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.25;
    g.drawImage(src, -o, -o);
    g.drawImage(src, o, -o);
    g.drawImage(src, -o, o);
    g.drawImage(src, o, o);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // Размывает уровень bl[i+1] в gl[i] на его собственном разрешении.
  function blurLevel(i) {
    var src = bl[i + 1], dst = gl[i], g = glX[i];
    if (HAS_FILTER) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, dst.width, dst.height);
      g.filter = 'blur(' + BLOOM_SIGMA[i] + 'px)';
      g.drawImage(src, 0, 0);
      g.filter = 'none';
    } else {
      kawasePass(src, tmpX[i], tmpC[i], 0.5);
      kawasePass(tmpC[i], g, dst, 1.5);
    }
  }

  function drawGain(img, gain, w, h) {
    while (gain > 0.001) {
      ctx.globalAlpha = Math.min(1, gain);
      ctx.drawImage(img, 0, 0, w, h);
      gain -= 1;
    }
  }

  /* ---------------- кадр ---------------- */
  function render() {
    var pw = canvas.width, ph = canvas.height;
    var pitch = clamp(cam.pitch + 0.055 * Math.sin(bobPhase), -0.25, 1.35);
    V.cyw = Math.cos(cam.yaw); V.syw = Math.sin(cam.yaw);
    V.cp = Math.cos(pitch); V.sp = Math.sin(pitch);
    V.unit = unitBase * cam.zoom;
    zoomW = Math.sqrt(cam.zoom);

    // затухание считается по фактической длине следа: хвост гаснет плавно
    // и сразу после сброса, пока история ещё короче заданной
    var N = Math.min(count, Math.max(2, Math.round(trailT / STEP)));
    var L = Math.max(2, N);
    if (N > 0) projectTrail(N);

    // слой следа (аддитивно)
    trX.setTransform(1, 0, 0, 1, 0, 0);
    trX.globalCompositeOperation = 'source-over';
    trX.globalAlpha = 1;
    trX.clearRect(0, 0, pw, ph);
    trX.setTransform(DPR, 0, 0, DPR, 0, 0);
    trX.globalCompositeOperation = 'lighter';
    trX.lineCap = 'butt';
    trX.lineJoin = 'round';
    if (N > 1) ageRuns(N - 1, L, AGE_B, trailRun);
    if (N > 0) drawHead(N);
    trX.globalCompositeOperation = 'source-over';
    trX.globalAlpha = 1;

    // пирамида для свечения
    var src = trC;
    for (var i = 0; i < bl.length; i++) {
      var g = blX[i], c = bl[i];
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(src, 0, 0, c.width, c.height);
      src = c;
    }
    blurLevel(0);
    blurLevel(1);
    blurLevel(2);

    // сборка кадра
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(bgC, 0, 0);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawFloor();
    if (N > 1) {
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'butt';
      ctx.strokeStyle = shadowStyle;
      ageRuns(N - 1, L, SHADOW_B, shadowRun);
      ctx.globalAlpha = 1;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawGain(gl[2], BLOOM_GAIN[2], pw, ph);
    drawGain(gl[1], BLOOM_GAIN[1], pw, ph);
    drawGain(gl[0], BLOOM_GAIN[0], pw, ph);
    ctx.imageSmoothingQuality = 'low';
    ctx.globalAlpha = 1;
    ctx.drawImage(trC, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawMarkers();
  }

  /* ---------------- HUD ---------------- */
  function fmt(v, width) {
    var s = Math.abs(v).toFixed(2).replace('.', ',');
    s = (v < 0 ? '−' : '') + s;
    while (s.length < width) s = ' ' + s;
    return s;
  }
  var hudAcc = 1;
  function updateHud(dt) {
    hudAcc += dt;
    if (hudAcc < 0.1) return;
    hudAcc = 0;
    readout.textContent = 't ' + fmt(T, 7) + '   x ' + fmt(X, 6) + '   y ' + fmt(Y, 6) + '   z ' + fmt(Z, 6) +
      (running ? '' : '   · пауза');
  }

  /* ---------------- цикл ---------------- */
  var last = performance.now(), acc = 0;
  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;

    if (running) {
      acc += dt * speed;
      var n = Math.floor(acc / STEP);
      if (n > MAX_STEPS_PER_FRAME) { n = MAX_STEPS_PER_FRAME; acc = 0; } else acc -= n * STEP;
      advance(n, true);
    }

    var target = (autoRotate && !dragging) ? ROT_SPEED : 0;
    rotVel += (target - rotVel) * Math.min(1, dt * 1.6);
    cam.yaw += rotVel * dt;
    bobPhase += dt * 0.16 * (rotVel / ROT_SPEED);

    if (easing) {
      var e = Math.min(1, dt * 4);
      cam.pitch += (PITCH0 - cam.pitch) * e;
      cam.zoom += (1 - cam.zoom) * e;
      if (Math.abs(cam.pitch - PITCH0) < 1e-3 && Math.abs(cam.zoom - 1) < 1e-3) {
        cam.pitch = PITCH0; cam.zoom = 1; easing = false;
      }
    }

    render();
    updateHud(dt);
    requestAnimationFrame(frame);
  }

  /* ---------------- управление ---------------- */
  function setFill(input) {
    var p = (input.value - input.min) / (input.max - input.min) * 100;
    input.style.setProperty('--p', p.toFixed(1) + '%');
  }
  function setRunning(v) {
    running = v;
    btnPlay.classList.toggle('paused', !running);
    btnPlay.setAttribute('aria-label', running ? 'Пауза' : 'Продолжить');
    btnPlay.title = running ? 'Пауза (пробел)' : 'Продолжить (пробел)';
    hudAcc = 1;
  }
  function resetTrajectory() {
    X = (Math.random() * 2 - 1) * 12;
    Y = (Math.random() * 2 - 1) * 12;
    Z = 8 + Math.random() * 30;
    T = 0; head = 0; count = 0; acc = 0;
    record();
    hudAcc = 1;
  }

  btnPlay.addEventListener('click', function () { setRunning(!running); });
  btnRotate.addEventListener('click', function () {
    autoRotate = !autoRotate;
    btnRotate.classList.toggle('on', autoRotate);
    btnRotate.setAttribute('aria-pressed', String(autoRotate));
  });
  btnPalette.addEventListener('click', function () {
    paletteIdx = (paletteIdx + 1) % PALETTES.length;
    computePalette();
    applyPaletteUI();
    drawBackground();
  });
  btnReset.addEventListener('click', resetTrajectory);

  speedIn.addEventListener('input', function () {
    speed = +speedIn.value;
    speedOut.textContent = speed.toFixed(2).replace('.', ',') + '×';
    setFill(speedIn);
  });
  trailIn.addEventListener('input', function () {
    trailT = +trailIn.value;
    trailOut.textContent = trailT + ' ед.';
    setFill(trailIn);
  });

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' && !(e.target && /^(INPUT|BUTTON)$/.test(e.target.tagName))) {
      e.preventDefault();
      setRunning(!running);
    }
  });

  // вращение мышью / пальцем, щипок — масштаб
  var ptrs = {}, nPtr = 0, pinch0 = 0, zoom0 = 1;
  function pinchDist() {
    var ids = Object.keys(ptrs);
    if (ids.length < 2) return 0;
    var a = ptrs[ids[0]], b = ptrs[ids[1]];
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }
  canvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    if (!ptrs[e.pointerId]) nPtr++;
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    dragging = true; easing = false;
    canvas.classList.add('dragging');
    if (nPtr === 2) { pinch0 = pinchDist(); zoom0 = cam.zoom; }
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = ptrs[e.pointerId];
    if (!p) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (nPtr === 1) {
      cam.yaw += dx * 0.0065;
      cam.pitch = clamp(cam.pitch + dy * 0.005, -0.2, 1.3);
    } else if (nPtr === 2 && pinch0 > 0) {
      cam.zoom = clamp(zoom0 * pinchDist() / pinch0, ZOOM_MIN, ZOOM_MAX);
    }
  });
  function pointerEnd(e) {
    if (!ptrs[e.pointerId]) return;
    delete ptrs[e.pointerId];
    nPtr--;
    if (nPtr <= 0) {
      nPtr = 0; dragging = false;
      canvas.classList.remove('dragging');
    } else if (nPtr === 1) {
      pinch0 = 0;
    }
  }
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    cam.zoom = clamp(cam.zoom * Math.exp(-dy * 0.0012), ZOOM_MIN, ZOOM_MAX);
    easing = false;
  }, { passive: false });
  canvas.addEventListener('dblclick', function () { easing = true; });

  window.addEventListener('resize', resize);

  /* ---------------- старт ---------------- */
  computePalette();
  resize();
  applyPaletteUI();
  setFill(speedIn);
  setFill(trailIn);

  // выходим на аттрактор и заполняем след заранее: первый кадр уже показывает форму
  // (рождение траектории с нуля видно по кнопке «Сброс»)
  advance(2000, false);
  advance(Math.round(trailT / STEP), true);

  requestAnimationFrame(function (now) { last = now; requestAnimationFrame(frame); });
})();
