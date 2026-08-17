/* Вращающийся земной шар — Kimi K3.
   Полностью процедурно: карта суши/океана/облаков/огней генерируется
   сферическим fBm-шумом (бесшовно, т.к. шум трёхмерный), сфера рендерится
   попиксельно в offscreen-canvas пониженного разрешения и масштабируется.
   Ключевая оптимизация: наклон оси постоянен, поэтому для каждого пикселя
   диска заранее считаются (u0, v) текстурные координаты и нормаль —
   за кадр меняется только сдвиг долготы от вращения. */
(function () {
  'use strict';

  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d');
  var off = document.createElement('canvas');
  var offCtx = off.getContext('2d');

  var TILT = 23.5 * Math.PI / 180;   // боковой крен оси
  var TILT2 = 10 * Math.PI / 180;    // лёгкий крен в глубину
  var TWO_PI = Math.PI * 2;

  // ---------- состояние ----------
  var W = 0, H = 0, DPR = 1;
  var cx = 0, cy = 0;          // центр глобуса (CSS px)
  var displayR = 100;          // радиус глобуса на экране (CSS px)
  var R = 100;                 // внутренний радиус рендера (offscreen px)
  var stars = [];
  var bgGrad = null, vignGrad = null;

  var spin = 0.7;              // текущий угол вращения, рад
  var cloudDrift = 0;          // дополнительный дрейф облаков, рад
  var speed = 1;
  var paused = false;
  var showClouds = true;
  var showLights = true;

  var sunAz = -2.45;           // азимут солнца на экране (0 = вправо)
  var sunZ = 0.55;             // насколько солнце направлено на зрителя
  var sunX = 0, sunY = 0, sunZc = 1;

  function updateSun() {
    var r = Math.sqrt(Math.max(0, 1 - sunZ * sunZ));
    sunX = Math.cos(sunAz) * r;
    sunY = Math.sin(sunAz) * r;
    sunZc = sunZ;
  }
  updateSun();

  // ---------- шум ----------
  var perm = new Uint8Array(512);
  (function () {
    var p = new Uint8Array(256), i, j, t;
    var s = 20240815;
    function rnd() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { j = (rnd() * (i + 1)) | 0; t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();

  function h3(x, y, z) {
    return perm[(x + perm[(y + perm[z & 255]) & 255]) & 255] * (1 / 255);
  }

  function vnoise(x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = x - xi, yf = y - yi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf);
    var v = yf * yf * (3 - 2 * yf);
    var w = zf * zf * (3 - 2 * zf);
    var x0 = xi & 255, y0 = yi & 255, z0 = zi & 255;
    var x1 = (xi + 1) & 255, y1 = (yi + 1) & 255, z1 = (zi + 1) & 255;
    var c00 = h3(x0, y0, z0) + (h3(x1, y0, z0) - h3(x0, y0, z0)) * u;
    var c10 = h3(x0, y1, z0) + (h3(x1, y1, z0) - h3(x0, y1, z0)) * u;
    var c01 = h3(x0, y0, z1) + (h3(x1, y0, z1) - h3(x0, y0, z1)) * u;
    var c11 = h3(x0, y1, z1) + (h3(x1, y1, z1) - h3(x0, y1, z1)) * u;
    var c0 = c00 + (c10 - c00) * v;
    var c1 = c01 + (c11 - c01) * v;
    return c0 + (c1 - c0) * w;
  }

  function fbm(x, y, z, oct) {
    var amp = 0.5, f = 1, sum = 0, norm = 0;
    for (var i = 0; i < oct; i++) {
      sum += amp * vnoise(x * f, y * f, z * f);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  }

  function sstep(a, b, x) {
    var t = (x - a) / (b - a);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // ---------- карта (эквидистанционная проекция) ----------
  var MW = 1024, MH = 512;
  var surfR = new Uint8Array(MW * MH);
  var surfG = new Uint8Array(MW * MH);
  var surfB = new Uint8Array(MW * MH);
  var specA = new Uint8Array(MW * MH);   // сила солнечного блика (океан)
  var lightA = new Uint8Array(MW * MH);  // огни городов
  var cloudA = new Uint8Array(MW * MH);  // облака

  function generateMap() {
    var SEA = 0.5; // уровень моря в нормированном шуме
    for (var y = 0; y < MH; y++) {
      var lat = (0.5 - (y + 0.5) / MH) * Math.PI; // +90° сверху
      var cl = Math.cos(lat), sl = Math.sin(lat);
      var absLat = Math.abs(lat);
      var row = y * MW;
      for (var x = 0; x < MW; x++) {
        var lon = ((x + 0.5) / MW) * TWO_PI;
        var dx = cl * Math.sin(lon), dy = sl, dz = cl * Math.cos(lon);
        var i = row + x;

        // --- рельеф: континентальные массы + деталь ---
        var h = fbm(dx * 2.1 + 13.7, dy * 2.1 + 5.2, dz * 2.1 - 3.1, 5);
        // слегка подчёркиваем крупные массивы
        h = SEA + (h - SEA) * 1.35;
        var detail = vnoise(dx * 11 + 3.3, dy * 11 - 7.7, dz * 11 + 1.1) - 0.5;

        // --- облака (два масштаба + вихревые полосы) ---
        var c1 = fbm(dx * 1.7 + 41.2, dy * 1.7 - 8.8, dz * 1.7 + 17.5, 3);
        var c2 = fbm(dx * 4.6 - 9.4, dy * 4.6 + 22.1, dz * 4.6 - 5.5, 2);
        var swirl = 0.5 + 0.5 * Math.sin(lat * 3.1 + c1 * 5.0);
        var clv = c1 * 0.62 + c2 * 0.24 + swirl * 0.14;
        cloudA[i] = sstep(0.52, 0.74, clv) * 235;

        var r, g, b;
        if (h > SEA) {
          // --- суша ---
          var e = clamp01((h - SEA) * 3.2);            // высота 0..1
          var e2 = e * e;
          var desertW = Math.exp(-Math.pow((absLat - 0.46) / 0.26, 2)) * (1 - e * 0.55);
          var coldW = sstep(0.82, 1.18, absLat + detail * 0.35);
          var rockW = sstep(0.4, 0.75, e2);
          var snowW = Math.max(coldW, sstep(0.78, 0.95, e2 + detail * 0.1));

          // базовый зелёный -> пустыня
          r = 74 + (191 - 74) * desertW;
          g = 112 + (172 - 112) * desertW;
          b = 58 + (118 - 58) * desertW;
          // -> скалы
          r += (128 - r) * rockW; g += (108 - g) * rockW; b += (92 - b) * rockW;
          // теневая сторона рельефа по высоте
          var sh = 0.72 + 0.5 * e;
          r *= sh; g *= sh; b *= sh;
          // -> снег
          r += (238 - r) * snowW; g += (243 - g) * snowW; b += (248 - b) * snowW;
          // вариации
          r += detail * 34; g += detail * 30; b += detail * 24;

          specA[i] = 0;

          // огни городов: кластеры на суше, вне пустынь и льдов
          var pop = fbm(dx * 3.4 - 27.3, dy * 3.4 + 14.9, dz * 3.4 + 8.2, 3);
          var li = sstep(0.56, 0.66, pop) * (1 - desertW * 0.85) * (1 - coldW) * (1 - snowW);
          // чуть ярче в умеренных широтах
          li *= 0.45 + 0.55 * Math.exp(-Math.pow((absLat - 0.7) / 0.55, 2));
          lightA[i] = clamp01(li) * 255;
        } else {
          // --- океан ---
          var depth = clamp01((SEA - h) * 6.5);
          r = 26 + (5 - 26) * depth;
          g = 88 + (24 - 88) * depth;
          b = 112 + (56 - 112) * depth;
          r += detail * 12; g += detail * 14; b += detail * 14;
          specA[i] = 225;
          lightA[i] = 0;
          // морской лёд у полюсов
          var ice = sstep(1.18, 1.34, absLat + detail * 0.3);
          if (ice > 0) {
            r += (226 - r) * ice; g += (236 - g) * ice; b += (244 - b) * ice;
            specA[i] = 225 * (1 - ice);
          }
        }
        surfR[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        surfG[i] = g < 0 ? 0 : g > 255 ? 255 : g;
        surfB[i] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
    }
  }

  // ---------- геометрия диска ----------
  var pxCount = 0;
  var pxOff = null;   // Int32: смещение в ImageData.data
  var pxU = null;     // Float32: базовая u-координата в текселях
  var pxRow = null;   // Int32: y * MW (строка текстуры)
  var pxNX = null, pxNY = null, pxNZ = null; // нормали (view space)
  var img = null;

  function buildGeometry() {
    var size = R * 2;
    off.width = size;
    off.height = size;
    img = offCtx.createImageData(size, size);

    var cap = size * size;
    pxOff = new Int32Array(cap);
    pxU = new Float32Array(cap);
    pxRow = new Int32Array(cap);
    pxNX = new Float32Array(cap);
    pxNY = new Float32Array(cap);
    pxNZ = new Float32Array(cap);

    var cosT = Math.cos(TILT), sinT = Math.sin(TILT);
    var cosT2 = Math.cos(TILT2), sinT2 = Math.sin(TILT2);
    var n = 0;
    for (var py = 0; py < size; py++) {
      var dy = (py - R + 0.5) / R;
      for (var px = 0; px < size; px++) {
        var dx = (px - R + 0.5) / R;
        var rr = dx * dx + dy * dy;
        if (rr > 1) continue;
        var nz = Math.sqrt(1 - rr);
        // нормаль в view space (y вниз)
        pxNX[n] = dx; pxNY[n] = dy; pxNZ[n] = nz;
        // переводим в систему тела: y вверх, снимаем наклон оси b = Rx(-T2)·Rz(-T)·v
        var vx = dx, vy = -dy, vz = nz;
        var x1 = vx * cosT + vy * sinT;
        var y1 = -vx * sinT + vy * cosT;
        var by = y1 * cosT2 + vz * sinT2;      // вдоль оси вращения
        var bz = -y1 * sinT2 + vz * cosT2;
        var bx = x1;
        // вращение вокруг оси — просто сдвиг долготы, считаем при spin=0
        var latS = Math.asin(by < -1 ? -1 : by > 1 ? 1 : by);
        var v = (0.5 - latS / Math.PI) * MH;
        var row = Math.floor(v);
        if (row < 0) row = 0; else if (row >= MH) row = MH - 1;
        var lon = Math.atan2(bx, bz); // 0 на «гринвиче»
        var u = (lon / TWO_PI + 0.5) * MW;
        pxU[n] = u;
        pxRow[n] = row * MW;
        pxOff[n] = (py * size + px) * 4;
        n++;
      }
    }
    pxCount = n;
  }

  // ---------- звёзды и фон ----------
  function buildBackdrop() {
    stars.length = 0;
    var count = Math.min(560, Math.round(W * H / 4200));
    var s = 987654321;
    function rnd() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
    for (var i = 0; i < count; i++) {
      var t = rnd();
      var col = t < 0.12 ? '191,214,255' : t < 0.24 ? '255,230,200' : '235,240,255';
      stars.push({
        x: rnd() * W,
        y: rnd() * H,
        r: 0.4 + rnd() * rnd() * 1.5,
        a: 0.25 + rnd() * 0.65,
        f: 0.4 + rnd() * 2.2,
        p: rnd() * TWO_PI,
        c: col
      });
    }
    bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
    bgGrad.addColorStop(0, '#0a1020');
    bgGrad.addColorStop(0.55, '#050914');
    bgGrad.addColorStop(1, '#01020a');
    vignGrad = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.35, cx, cy, Math.max(W, H) * 0.78);
    vignGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vignGrad.addColorStop(1, 'rgba(0,0,0,0.42)');
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    cx = W / 2;
    cy = H / 2 - H * 0.015;
    displayR = Math.min(W, H) * 0.345;
    R = Math.max(150, Math.min(300, Math.round(displayR)));
    buildGeometry();
    buildBackdrop();
  }

  // ---------- рендер глобуса ----------
  function renderGlobe() {
    var data = img.data;
    var spinTex = (spin / TWO_PI) * MW;
    spinTex -= Math.floor(spinTex / MW) * MW;
    var cloudTex = spinTex + (cloudDrift / TWO_PI) * MW;

    var sx = sunX, sy = sunY, sz = sunZc;
    var cloudsOn = showClouds ? 1 : 0;
    var lightsOn = showLights ? 1 : 0;

    var nX = pxNX, nY = pxNY, nZ = pxNZ;
    var uA = pxU, rowA = pxRow, offA = pxOff;
    var sR = surfR, sG = surfG, sB = surfB;
    var spA = specA, ltA = lightA, clA = cloudA;

    for (var i = 0; i < pxCount; i++) {
      // --- выборка текстуры (линейная интерполяция по долготе) ---
      var u = uA[i] + spinTex;
      u -= Math.floor(u / MW) * MW;
      var x0 = u | 0;
      var fx = u - x0;
      var x1 = x0 + 1; if (x1 >= MW) x1 = 0;
      var row = rowA[i];
      var i0 = row + x0, i1 = row + x1;
      var g0 = 1 - fx;

      var r = sR[i0] * g0 + sR[i1] * fx;
      var g = sG[i0] * g0 + sG[i1] * fx;
      var b = sB[i0] * g0 + sB[i1] * fx;
      var spec = (spA[i0] * g0 + spA[i1] * fx) * (1 / 255);
      var lit = (ltA[i0] * g0 + ltA[i1] * fx) * (1 / 255);

      // --- освещение ---
      var nx = nX[i], ny = nY[i], nz = nZ[i];
      var d = nx * sx + ny * sy + nz * sz;
      var day = sstep(-0.09, 0.26, d);       // мягкий терминатор
      var dpos = d > 0 ? d : 0;

      // тень от облаков на поверхности
      var ca = 0;
      if (cloudsOn) {
        var uc = u + cloudTex - spinTex;
        uc -= Math.floor(uc / MW) * MW;
        var cx0 = uc | 0;
        var cfx = uc - cx0;
        var cx1 = cx0 + 1; if (cx1 >= MW) cx1 = 0;
        ca = (clA[row + cx0] * (1 - cfx) + clA[row + cx1] * cfx) * (1 / 255);
      }

      // дневная/ночная яркость поверхности
      var surfL = 0.035 + day * (0.18 + 0.9 * dpos);
      var dark = 1 - ca * 0.38 * day;        // тень облаков
      r = r * surfL * dark;
      g = g * surfL * dark;
      b = b * surfL * dark;
      // ночная сторона чуть синеватая (отражённый свет)
      var night = 1 - day;
      b += 6 * night;

      // солнечный блик на океане
      if (spec > 0.01 && d > 0.05) {
        var rv = 2 * d * nz - sz;            // отражение · взгляд
        if (rv > 0) {
          var gl = Math.pow(rv, 48) * spec * day * 1.6;
          r += 255 * gl; g += 226 * gl; b += 178 * gl;
        }
      }

      // огни городов на ночной стороне
      if (lightsOn && lit > 0.003) {
        var lw = lit * night * sstep(-0.3, -0.02, -d) * 1.25;
        r += 255 * lw; g += 186 * lw; b += 112 * lw;
      }

      // облака
      if (ca > 0.003) {
        var cl2 = 0.1 + day * (0.22 + 0.78 * dpos);
        var cr2 = 225 * cl2, cg2 = 232 * cl2, cb2 = 245 * cl2;
        var a = ca * 0.92;
        var ia = 1 - a;
        r = r * ia + cr2 * a;
        g = g * ia + cg2 * a;
        b = b * ia + cb2 * a;
      }

      // атмосферное свечение у лимба
      var rim = 1 - nz;
      rim = rim * rim * rim;
      var atI = rim * (0.16 + 0.84 * day);
      r += 52 * atI; g += 118 * atI; b += 225 * atI;

      var o = offA[i];
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);
  }

  // ---------- сцена ----------
  function drawScene(t) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // звёзды
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var tw = 0.55 + 0.45 * Math.sin(t * st.f + st.p);
      ctx.globalAlpha = st.a * tw;
      ctx.fillStyle = 'rgb(' + st.c + ')';
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // тёплое свечение в направлении солнца
    var sgx = cx + Math.cos(sunAz) * displayR * 1.32;
    var sgy = cy + Math.sin(sunAz) * displayR * 1.32;
    var sgr = displayR * 0.95;
    var sg = ctx.createRadialGradient(sgx, sgy, 0, sgx, sgy, sgr);
    sg.addColorStop(0, 'rgba(255,238,196,0.5)');
    sg.addColorStop(0.35, 'rgba(255,214,150,0.16)');
    sg.addColorStop(1, 'rgba(255,200,130,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sgx - sgr, sgy - sgr, sgr * 2, sgr * 2);

    // атмосферный ореол вокруг диска
    var hr = displayR * 1.16;
    var hg = ctx.createRadialGradient(cx, cy, displayR * 0.86, cx, cy, hr);
    hg.addColorStop(0, 'rgba(90,150,255,0)');
    hg.addColorStop(0.62, 'rgba(96,156,255,0.22)');
    hg.addColorStop(1, 'rgba(96,156,255,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(cx - hr, cy - hr, hr * 2, hr * 2);

    // сам глобус
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, off.width, off.height,
      cx - displayR, cy - displayR, displayR * 2, displayR * 2);

    // виньетка
    ctx.fillStyle = vignGrad;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- цикл ----------
  var last = 0;
  function frame(now) {
    if (!last) last = now;
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;   // кламп большого dt
    if (dt < 0) dt = 0;

    if (!paused) {
      spin += dt * 0.14 * speed;
      cloudDrift += dt * 0.022 * speed;
    }
    renderGlobe();
    drawScene(now / 1000);
    requestAnimationFrame(frame);
  }

  // ---------- управление ----------
  function sunFromPointer(e) {
    var dx = e.clientX - cx, dy = e.clientY - cy;
    if (dx * dx + dy * dy < 1) { dx = 1; dy = 0; }
    sunAz = Math.atan2(dy, dx);
    var dist = Math.sqrt(dx * dx + dy * dy);
    sunZ = Math.max(0, Math.min(0.92, 1 - dist / (displayR * 2.4)));
    updateSun();
  }

  var dragging = false;
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
    sunFromPointer(e);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (dragging) sunFromPointer(e);
  });
  canvas.addEventListener('pointerup', function () {
    dragging = false;
    canvas.classList.remove('dragging');
  });
  canvas.addEventListener('pointercancel', function () {
    dragging = false;
    canvas.classList.remove('dragging');
  });

  document.getElementById('speed').addEventListener('input', function (e) {
    speed = parseFloat(e.target.value);
  });
  document.getElementById('pause').addEventListener('click', function (e) {
    paused = !paused;
    e.target.textContent = paused ? 'Пуск' : 'Пауза';
  });
  document.getElementById('clouds').addEventListener('change', function (e) {
    showClouds = e.target.checked;
  });
  document.getElementById('lights').addEventListener('change', function (e) {
    showLights = e.target.checked;
  });

  window.addEventListener('resize', resize);

  // ---------- запуск ----------
  generateMap();
  resize();
  requestAnimationFrame(frame);
})();
