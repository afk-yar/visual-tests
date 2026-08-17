/* Полярное сияние — Claude Opus 5
 * Canvas 2D. Занавеси считаются в низкоразрешающем float-буфере
 * (аддитивное накопление + тон-мэппинг), затем апскейлятся с блумом.
 * Ни WebGL, ни воркеров, ни внешних ресурсов.
 */
(function () {
  'use strict';

  /* ============================ утилиты ============================ */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function smoothstep(a, b, x) {
    var t = (x - a) / (b - a);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* периодический 1D value-noise с C2-интерполяцией */
  var NSIZE = 1024, NMASK = 1023;
  var noiseTab = new Float32Array(NSIZE);
  (function () {
    var r = mulberry32(20260816);
    for (var i = 0; i < NSIZE; i++) noiseTab[i] = r() * 2 - 1;
  })();

  function nz(x) {
    x = x % NSIZE; if (x < 0) x += NSIZE;
    var i = x | 0, f = x - i;
    var a = noiseTab[i], b = noiseTab[(i + 1) & NMASK];
    var u = f * f * f * (f * (f * 6 - 15) + 10);
    return a + (b - a) * u;
  }

  /* «хребтовый» шум 0..1 с острыми пиками — для гор */
  function rid(x) { var v = nz(x); return 1 - (v < 0 ? -v : v); }

  /* ============================ холсты ============================ */

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d', { alpha: false });

  var W = 0, H = 0, DPR = 1;
  var horizonY = 0, skyH = 0, waterH = 0;

  var bufW = 0, bufH = 0;
  var auroraCv = document.createElement('canvas');
  var actx = auroraCv.getContext('2d');
  var reflCv = document.createElement('canvas');
  var rctx = reflCv.getContext('2d');
  /* две ступени даунсэмпла зеркальной копии = размытие для воды */
  var reflHalf = document.createElement('canvas');
  var rhctx = reflHalf.getContext('2d');
  var reflBlur = document.createElement('canvas');
  var rbctx = reflBlur.getContext('2d');
  /* маска перекрытия: занавесь гасит звёзды за собой */
  var occCv = document.createElement('canvas');
  var octx = occCv.getContext('2d');
  var occData = null, occBuf = null;
  var bloomA = document.createElement('canvas');
  var bactx = bloomA.getContext('2d');
  var bloomB = document.createElement('canvas');
  var bbctx = bloomB.getContext('2d');
  var starCv = document.createElement('canvas');

  var imgData = null, imgBuf = null, acc = null;

  var skyGrad = null, waterGrad = null, vignGrad = null;
  var grainPat = null;

  /* спрайт свечения для звёзд / метеора */
  var glowSprite = document.createElement('canvas');
  glowSprite.width = glowSprite.height = 64;
  (function () {
    var g = glowSprite.getContext('2d');
    var rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0.00, 'rgba(255,255,255,1)');
    rg.addColorStop(0.18, 'rgba(255,255,255,0.52)');
    rg.addColorStop(0.45, 'rgba(255,255,255,0.13)');
    rg.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
  })();

  /* ============================ тон-мэппинг ============================ */

  var TN = 4096, TMAX = 4.0, TSC = TN / TMAX;
  var TONE = new Uint8Array(TN);
  (function () {
    var wp2 = 16.0; /* whitepoint^2 */
    for (var i = 0; i < TN; i++) {
      var x = i / TSC;
      var y = x * (1 + x / wp2) / (1 + x);
      if (y > 1) y = 1;
      TONE[i] = Math.round(255 * Math.pow(y, 0.88));
    }
  })();

  /* ============================ палитра занавеси ============================ */
  /* t = 0 — нижняя кромка (розовый кант + плотный зелёный),
     t → 1 — верх (голубой → фиолет → пурпур)                       */
  var STOPS = new Float32Array([
    0.000, 1.00, 0.40, 0.50,
    0.028, 0.42, 1.00, 0.55,
    0.110, 0.16, 1.00, 0.42,
    0.300, 0.13, 0.90, 0.66,
    0.460, 0.22, 0.66, 1.00,
    0.640, 0.50, 0.36, 1.00,
    0.830, 0.75, 0.26, 0.94,
    1.000, 0.58, 0.18, 0.66
  ]);
  var NSTOP = 8;
  var rampOut = new Float32Array(3);

  function rampAt(tc) {
    var j = 0;
    while (j < NSTOP - 2 && tc > STOPS[(j + 1) * 4]) j++;
    var i0 = j * 4, i1 = (j + 1) * 4;
    var t0 = STOPS[i0], t1 = STOPS[i1];
    var f = (tc - t0) / (t1 - t0);
    if (f < 0) f = 0; else if (f > 1) f = 1;
    f = f * f * (3 - 2 * f);
    rampOut[0] = STOPS[i0 + 1] + (STOPS[i1 + 1] - STOPS[i0 + 1]) * f;
    rampOut[1] = STOPS[i0 + 2] + (STOPS[i1 + 2] - STOPS[i0 + 2]) * f;
    rampOut[2] = STOPS[i0 + 3] + (STOPS[i1 + 3] - STOPS[i0 + 3]) * f;
  }

  /* вес лучевой модуляции по высоте: внизу лучи резкие, вверху растворяются */
  var RAYW = new Float32Array(256);
  (function () {
    for (var i = 0; i < 256; i++) RAYW[i] = Math.exp(-(i / 255) * 2.3);
  })();

  /* мягкий подсвет под нижней кромкой */
  var GN = 6, GW = new Float32Array(GN);
  var GR = 0.55, GG = 1.0, GB = 0.64;

  function buildGlowSkirt() {
    GN = Math.max(3, Math.round(bufH * 0.038));
    GW = new Float32Array(GN);
    for (var i = 0; i < GN; i++) GW[i] = 0.28 * Math.exp(-i / (GN * 0.38));
  }

  /* ============================ занавеси ============================ */

  function makeCurtain(p) {
    p.lutR = new Float32Array(256);
    p.lutG = new Float32Array(256);
    p.lutB = new Float32Array(256);
    return p;
  }

  /* порядок = приоритет: слайдер «Занавеси» берёт первые N */
  var curtains = [
    makeCurtain({ x0: -0.12, x1: 0.88, scale: 2.6, yb: 0.73, h: 0.58, wob: 0.100, alpha: 1.05, shear: -0.085, rayF: 0.95, drift: 0.016, phase: 27.3, hueMul: 1.00 }),
    makeCurtain({ x0: 0.40, x1: 1.35, scale: 2.1, yb: 0.68, h: 0.54, wob: 0.090, alpha: 0.90, shear: 0.100, rayF: 0.80, drift: -0.012, phase: 41.9, hueMul: 0.90 }),
    makeCurtain({ x0: 0.18, x1: 1.22, scale: 3.4, yb: 0.79, h: 0.52, wob: 0.062, alpha: 0.86, shear: 0.060, rayF: 1.15, drift: -0.021, phase: 13.7, hueMul: 1.10 }),
    makeCurtain({ x0: -0.18, x1: 0.72, scale: 5.0, yb: 0.90, h: 0.30, wob: 0.038, alpha: 0.58, shear: -0.050, rayF: 1.70, drift: 0.028, phase: 0.6, hueMul: 1.25 }),
    makeCurtain({ x0: 0.58, x1: 1.50, scale: 3.0, yb: 0.75, h: 0.48, wob: 0.070, alpha: 0.74, shear: -0.110, rayF: 1.25, drift: -0.018, phase: 71.5, hueMul: 0.95 }),
    makeCurtain({ x0: -0.32, x1: 0.46, scale: 4.2, yb: 0.85, h: 0.38, wob: 0.055, alpha: 0.66, shear: 0.115, rayF: 1.45, drift: 0.024, phase: 58.1, hueMul: 1.15 })
  ];
  (function () {
    var r = mulberry32(5150);
    for (var i = 0; i < curtains.length; i++) {
      var c = curtains[i];
      c.o1 = r() * 900; c.o2 = r() * 900; c.o3 = r() * 900;
      c.o4 = r() * 900; c.o5 = r() * 900; c.o6 = r() * 900;
      c.d1 = 0.05 + r() * 0.07; c.d2 = -(0.05 + r() * 0.09);
      c.d3 = 0.03 + r() * 0.05; c.d4 = (r() < 0.5 ? -1 : 1) * (0.10 + r() * 0.14);
      c.d5 = (r() < 0.5 ? -1 : 1) * (0.05 + r() * 0.08);
      c.d6 = (r() < 0.5 ? -1 : 1) * (0.08 + r() * 0.12);
      c.fade = 0.16;
    }
  })();

  function buildLUT(c, gamma) {
    var lr = c.lutR, lg = c.lutG, lb = c.lutB;
    var g = gamma * c.hueMul;
    if (g < 0.35) g = 0.35;
    for (var i = 0; i < 256; i++) {
      var t = i / 255;
      var rise = 1 - Math.exp(-t * 44);                       /* резкая нижняя кромка */
      var body = 0.88 * Math.exp(-t * 5.2) + 0.46 * Math.exp(-t * 0.85);
      var t2 = t * t;
      var cut = 1 - t2 * t2;                                   /* уход в ноль наверху */
      var p = rise * body * cut;
      var tc = Math.pow(t, g);
      if (tc > 1) tc = 1;
      rampAt(tc);
      lr[i] = rampOut[0] * p;
      lg[i] = rampOut[1] * p;
      lb[i] = rampOut[2] * p;
    }
  }

  /* ============================ состояние UI ============================ */

  var ui = { intensity: 1.0, speed: 1.0, count: 4, hue: 0.42, bloom: true, paused: false };
  var T = 0, curAct = 1;

  /* ============================ размеры ============================ */

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    var cw = Math.max(1, window.innerWidth);
    var ch = Math.max(1, window.innerHeight);

    canvas.width = Math.round(cw * DPR);
    canvas.height = Math.round(ch * DPR);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';

    W = cw; H = ch;
    /* берег ниже середины кадра: главный герой — небо */
    horizonY = Math.round(H * 0.705);
    skyH = Math.max(40, horizonY);
    waterH = Math.max(20, H - horizonY);

    /* анизотропный буфер: по X грубее (лучи широкие), по Y точнее (кромка резкая) */
    bufW = clamp(Math.round(W * 0.30), 220, 460);
    bufH = clamp(Math.round(skyH * 0.46), 130, 300);

    auroraCv.width = bufW; auroraCv.height = bufH;
    reflCv.width = bufW; reflCv.height = bufH;
    occCv.width = bufW; occCv.height = bufH;
    reflHalf.width = Math.max(24, Math.round(bufW * 0.72));
    reflHalf.height = Math.max(18, Math.round(bufH * 0.58));
    reflBlur.width = Math.max(16, Math.round(bufW * 0.52));
    reflBlur.height = Math.max(12, Math.round(bufH * 0.32));
    bloomA.width = Math.max(8, Math.round(bufW / 5));
    bloomA.height = Math.max(6, Math.round(bufH / 5));
    bloomB.width = Math.max(4, Math.round(bufW / 14));
    bloomB.height = Math.max(3, Math.round(bufH / 14));

    var smooth = [actx, rctx, rhctx, rbctx, bactx, bbctx, octx];
    for (var si = 0; si < smooth.length; si++) {
      smooth[si].imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in smooth[si]) smooth[si].imageSmoothingQuality = 'high';
    }

    imgData = actx.createImageData(bufW, bufH);
    imgBuf = imgData.data;
    for (var i = 3; i < imgBuf.length; i += 4) imgBuf[i] = 255;

    /* маска перекрытия: цвет ≈ ночное небо, альфа = яркость сияния */
    occData = octx.createImageData(bufW, bufH);
    occBuf = occData.data;
    for (var k = 0; k < occBuf.length; k += 4) {
      occBuf[k] = 1; occBuf[k + 1] = 3; occBuf[k + 2] = 9;
    }

    acc = new Float32Array(bufW * bufH * 3);

    buildGlowSkirt();
    buildGradients();
    buildStars();
    buildTerrain();
    if (!grainPat) buildGrain();
  }

  function buildGradients() {
    skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0.00, '#02030a');
    skyGrad.addColorStop(0.38, '#050a17');
    skyGrad.addColorStop(0.74, '#071427');
    skyGrad.addColorStop(1.00, '#0a1c30');

    waterGrad = ctx.createLinearGradient(0, horizonY, 0, H);
    waterGrad.addColorStop(0.00, '#081a2b');
    waterGrad.addColorStop(0.30, '#04101d');
    waterGrad.addColorStop(1.00, '#01050c');

    var r = Math.max(W, H) * 0.78;
    vignGrad = ctx.createRadialGradient(W * 0.5, H * 0.44, r * 0.22, W * 0.5, H * 0.44, r);
    vignGrad.addColorStop(0.00, 'rgba(0,0,0,0)');
    vignGrad.addColorStop(0.62, 'rgba(0,0,0,0.16)');
    vignGrad.addColorStop(1.00, 'rgba(0,0,0,0.62)');
  }

  function buildGrain() {
    var gc = document.createElement('canvas');
    gc.width = gc.height = 128;
    var g = gc.getContext('2d');
    var id = g.createImageData(128, 128);
    var d = id.data, rnd = mulberry32(4242);
    for (var i = 0; i < 128 * 128; i++) {
      var v = rnd();
      var a = v > 0.84 ? Math.round((v - 0.84) / 0.16 * 190) : 0;
      var o = i * 4;
      d[o] = 235; d[o + 1] = 245; d[o + 2] = 255; d[o + 3] = a;
    }
    g.putImageData(id, 0, 0);
    grainPat = ctx.createPattern(gc, 'repeat');
  }

  /* ============================ звёзды ============================ */

  var twinkles = [];
  var shoot = null, shootTimer = 4.5;

  function buildStars() {
    var sw = Math.max(1, Math.round(W * DPR));
    var sh = Math.max(1, Math.round(skyH * DPR));
    starCv.width = sw; starCv.height = sh;
    var g = starCv.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, W, skyH);
    g.globalCompositeOperation = 'lighter';

    var rnd = mulberry32(90210);
    var i, x, y, r, a;

    /* млечный путь — мягкая диагональная полоса */
    var mwx = W * 0.74, mwy = skyH * 0.06, ang = -1.12;
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var span = Math.max(W, skyH) * 1.5;
    for (i = 0; i < 240; i++) {
      var along = (rnd() - 0.5) * 2 * span;
      var across = (rnd() + rnd() + rnd() - 1.5) * skyH * 0.17;
      x = mwx + ca * along - sa * across;
      y = mwy + sa * along + ca * across;
      r = 45 + rnd() * 175;
      a = 0.030 * (0.35 + rnd() * 0.65);
      var rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(148,172,224,' + a.toFixed(4) + ')');
      rg.addColorStop(1, 'rgba(148,172,224,0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
    }

    /* звёзды — точечные: сетка снапится на физический пиксель, чтобы точка
       была резкой, а не размытым кружком; крупных «шаров» нет вообще */
    twinkles.length = 0;
    var q = 1 / DPR;
    var count = clamp(Math.round(W * skyH / 620), 500, 3400);
    for (i = 0; i < count; i++) {
      x = rnd() * W; y = rnd() * skyH;
      if (rnd() < (y / skyH) * 0.62) continue;          /* у горизонта реже — дымка */

      var m = rnd(), br, sz;
      if (m < 0.885) {                                  /* основная масса — 1 px */
        sz = 0.9; br = 0.10 + Math.pow(rnd(), 1.7) * 0.44;
      } else if (m < 0.984) {                           /* заметные — 1–2 px */
        sz = 1.3; br = 0.42 + rnd() * 0.33;
      } else {                                          /* редкие яркие */
        sz = 1.9; br = 0.80 + rnd() * 0.20;
      }
      var w = Math.max(1, Math.round(sz * DPR)) * q;
      var px = Math.round(x * DPR) * q, py = Math.round(y * DPR) * q;

      var ct = rnd();
      var col = ct < 0.46 ? '226,234,255'
        : (ct < 0.72 ? '176,200,255'
          : (ct < 0.90 ? '255,236,212' : '255,204,176'));

      g.fillStyle = 'rgba(' + col + ',' + br.toFixed(3) + ')';
      g.fillRect(px, py, w, w);

      if (sz > 1.5) {
        /* у ярких — крошечный ореол и микро-крест: читается как звезда */
        var hr = 2.5;
        var rg2 = g.createRadialGradient(px, py, 0, px, py, hr);
        rg2.addColorStop(0.00, 'rgba(' + col + ',' + (br * 0.20).toFixed(3) + ')');
        rg2.addColorStop(0.45, 'rgba(' + col + ',' + (br * 0.06).toFixed(3) + ')');
        rg2.addColorStop(1.00, 'rgba(' + col + ',0)');
        g.fillStyle = rg2;
        g.beginPath(); g.arc(px, py, hr, 0, 6.2832); g.fill();

        var cw = Math.max(1, Math.round(DPR)) * q;
        g.fillStyle = 'rgba(' + col + ',' + (br * 0.18).toFixed(3) + ')';
        g.fillRect(px - 1.7, py, 3.4 + cw, cw);
        g.fillRect(px, py - 1.7, cw, 3.4 + cw);

        if (twinkles.length < 80) {
          twinkles.push({ x: px, y: py, r: sz, ph: rnd() * 6.2832, sp: 0.5 + rnd() * 1.9 });
        }
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  function drawStars() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(starCv, 0, 0, W, skyH);

    /* мерцание: резкая точка + микро-свечение, без боке */
    ctx.globalCompositeOperation = 'lighter';
    var cw = Math.max(1, Math.round(DPR)) / DPR;
    for (var i = 0; i < twinkles.length; i++) {
      var s = twinkles[i];
      var f = 0.5 + 0.5 * Math.sin(T * s.sp + s.ph);
      var rr = s.r * (0.8 + 0.7 * f);
      ctx.globalAlpha = 0.05 + 0.15 * f * f;
      ctx.drawImage(glowSprite, s.x - rr, s.y - rr, rr * 2, rr * 2);
      ctx.globalAlpha = 0.10 + 0.28 * f;
      ctx.fillStyle = '#eaf2ff';
      ctx.fillRect(s.x, s.y, cw, cw);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function updateShoot(dt) {
    if (shoot) {
      shoot.t += dt;
      shoot.x += shoot.vx * dt;
      shoot.y += shoot.vy * dt;
      if (shoot.t > shoot.life) shoot = null;
      return;
    }
    shootTimer -= dt;
    if (shootTimer <= 0) {
      shootTimer = 8 + Math.random() * 16;
      var ang = 0.35 + Math.random() * 0.5;
      var sp = (W * 0.42) * (0.75 + Math.random() * 0.6);
      var dir = Math.random() < 0.5 ? 1 : -1;
      shoot = {
        x: dir > 0 ? -W * 0.06 + Math.random() * W * 0.4 : W * 0.66 + Math.random() * W * 0.4,
        y: skyH * (0.04 + Math.random() * 0.4),
        vx: dir * Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp * 0.55,
        life: 0.55 + Math.random() * 0.5,
        t: 0
      };
    }
  }

  function drawShoot() {
    if (!shoot) return;
    var k = shoot.t / shoot.life;
    var fade = Math.sin(Math.PI * clamp(k, 0, 1));
    if (fade <= 0.01) return;
    var tail = 0.16;
    var x2 = shoot.x - shoot.vx * tail, y2 = shoot.y - shoot.vy * tail;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var lg = ctx.createLinearGradient(shoot.x, shoot.y, x2, y2);
    lg.addColorStop(0, 'rgba(255,255,255,' + (0.85 * fade).toFixed(3) + ')');
    lg.addColorStop(0.35, 'rgba(190,225,255,' + (0.32 * fade).toFixed(3) + ')');
    lg.addColorStop(1, 'rgba(160,200,255,0)');
    ctx.strokeStyle = lg;
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(x2, y2); ctx.stroke();
    var rr = 9 * fade + 3;
    ctx.globalAlpha = 0.75 * fade;
    ctx.drawImage(glowSprite, shoot.x - rr, shoot.y - rr, rr * 2, rr * 2);
    ctx.restore();
  }

  /* ============================ ландшафт ============================ */

  var ridges = [], treePath = null, REFC = 0.90;

  function makeRidge(def) {
    var step = 4, n = Math.ceil(W / step) + 2;
    var ys = new Float32Array(n), i, x, u, v;
    for (i = 0; i < n; i++) {
      x = i * step;
      u = x * def.freq + def.seed;
      v = 0.55 * rid(u) + 0.27 * rid(u * 2.13 + 11.1) + 0.12 * rid(u * 4.7 + 31.3) + 0.06 * rid(u * 9.1 + 57.7);
      v = Math.pow(clamp(v, 0, 1), def.sharp);
      ys[i] = def.base - v * def.amp;
    }

    var fill = new Path2D(), line = new Path2D(), mirror = new Path2D();
    fill.moveTo(-6, ys[0]);
    line.moveTo(-6, ys[0]);
    mirror.moveTo(-6, horizonY + (horizonY - ys[0]) * REFC);
    for (i = 1; i < n; i++) {
      x = i * step;
      fill.lineTo(x, ys[i]);
      line.lineTo(x, ys[i]);
      mirror.lineTo(x, horizonY + (horizonY - ys[i]) * REFC);
    }
    fill.lineTo(W + 6, ys[n - 1]);
    fill.lineTo(W + 6, horizonY + 2);
    fill.lineTo(-6, horizonY + 2);
    fill.closePath();

    mirror.lineTo(W + 6, horizonY + (horizonY - ys[n - 1]) * REFC);
    mirror.lineTo(W + 6, horizonY - 1);
    mirror.lineTo(-6, horizonY - 1);
    mirror.closePath();

    var g = ctx.createLinearGradient(0, def.base - def.amp * 1.05, 0, horizonY + 2);
    g.addColorStop(0, def.top);
    g.addColorStop(1, def.bottom);

    return { fill: fill, line: line, mirror: mirror, grad: g, rim: def.rim, rimCol: def.rimCol };
  }

  function conifer(p, x, by, w, h) {
    var tiers = 4, k, frac, yb2, yt, hw;
    for (k = 0; k < tiers; k++) {
      frac = k / (tiers - 1);
      yb2 = by - h * (0.18 + 0.62 * frac);
      yt = yb2 - h * 0.36;
      hw = w * 0.5 * (1 - 0.66 * frac);
      p.moveTo(x - hw, yb2); p.lineTo(x, yt); p.lineTo(x + hw, yb2); p.closePath();
    }
    p.moveTo(x - w * 0.06, by);
    p.lineTo(x - w * 0.06, by - h * 0.30);
    p.lineTo(x + w * 0.06, by - h * 0.30);
    p.lineTo(x + w * 0.06, by);
    p.closePath();
  }

  function shoreY(x) {
    return H - H * 0.028 - rid(x * 0.010 + 5.5) * H * 0.020;
  }

  function buildTrees() {
    var p = new Path2D();
    var step = 6, n = Math.ceil(W / step) + 2, i, x;
    p.moveTo(-8, shoreY(0));
    for (i = 1; i < n; i++) { x = i * step; p.lineTo(x, shoreY(x)); }
    p.lineTo(W + 8, shoreY(W));
    p.lineTo(W + 8, H + 8);
    p.lineTo(-8, H + 8);
    p.closePath();

    var rnd = mulberry32(31337);
    x = -26;
    while (x < W + 26) {
      var e = Math.pow(Math.abs(2 * x / W - 1), 1.7);
      var hgt = H * (0.030 + 0.155 * e * (0.45 + rnd() * 0.85));
      var wdt = hgt * (0.30 + rnd() * 0.15);
      conifer(p, x, shoreY(clamp(x, 0, W)) + 5, wdt, hgt);
      x += wdt * (0.5 + rnd() * 0.85);
    }
    treePath = p;
  }

  function buildTerrain() {
    /* амплитуды привязаны к H, а не к skyH: силуэт гор сохраняет прежний
       абсолютный размер при опущенной линии берега */
    ridges = [
      makeRidge({
        base: horizonY + 2, amp: H * 0.146, freq: 0.00215, seed: 4.1, sharp: 1.30,
        top: '#101f33', bottom: '#04090f', rim: 0.26, rimCol: '150,255,208'
      }),
      makeRidge({
        base: horizonY + 2, amp: H * 0.114, freq: 0.0042, seed: 91.7, sharp: 1.15,
        top: '#070f1c', bottom: '#020509', rim: 0.16, rimCol: '130,220,255'
      }),
      makeRidge({
        base: horizonY + 3, amp: H * 0.061, freq: 0.0078, seed: 155.3, sharp: 1.0,
        top: '#03070d', bottom: '#010306', rim: 0.10, rimCol: '175,255,228'
      })
    ];
    buildTrees();
  }

  function drawRidges() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    for (var i = 0; i < ridges.length; i++) {
      var r = ridges[i];
      ctx.fillStyle = r.grad;
      ctx.fill(r.fill);
      /* контровой ободок от сияния */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(' + r.rimCol + ',' + (r.rim * curAct * 0.75).toFixed(3) + ')';
      ctx.lineWidth = 1.15;
      ctx.stroke(r.line);
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 3.6;
      ctx.stroke(r.line);
      ctx.restore();
    }
  }

  function drawReflectedRidges() {
    ctx.globalCompositeOperation = 'source-over';
    for (var i = 0; i < ridges.length; i++) {
      ctx.globalAlpha = 0.90;
      ctx.fillStyle = i === 0 ? '#040a12' : '#02060c';
      ctx.fill(ridges[i].mirror);
    }
    ctx.globalAlpha = 1;
  }

  /* ============================ рендер сияния ============================ */

  function drawCurtain(c, gI) {
    var lr = c.lutR, lg = c.lutG, lb = c.lutB;
    var invW = 1 / bufW;
    var sh = c.shear;
    var xDrift = 0.05 * Math.sin(T * 0.031 + c.phase * 0.1);
    var x0 = c.x0 + xDrift, x1 = c.x1 + xDrift, fd = c.fade;
    var ybase = c.yb * bufH, hbase = c.h * bufH, wob = c.wob * bufH;
    var lastRow = bufH - 1, lastCol = bufW - 1;

    for (var i = 0; i < bufW; i++) {
      var u = i * invW;
      if (u < x0 - fd || u > x1 + fd) continue;
      var env = smoothstep(x0 - fd, x0 + fd, u) * (1 - smoothstep(x1 - fd, x1 + fd, u));
      if (env <= 0.002) continue;

      var s = u * c.scale + c.phase + T * c.drift;
      var f1 = nz(s * 0.90 + c.o1 + T * c.d1);
      var f2 = nz(s * 2.35 + c.o2 + T * c.d2);
      var f3 = nz(s * 0.55 + c.o3 + T * c.d3);

      /* складки: яркие полосы там, где лист повёрнут ребром — и они бегут вдоль ленты */
      var br = 0.30 + 0.70 * Math.pow(0.5 + 0.5 * Math.sin(s * 2.1 + f1 * 3.2 + T * c.d4), 1.7);
      br *= 0.55 + 0.45 * (0.5 + 0.5 * f2);

      var base = env * br * c.alpha * gI;
      if (base < 0.004) continue;

      var yb = ybase - (f1 * 0.60 + f2 * 0.28) * wob;
      var h = hbase * (0.62 + 0.50 * (0.5 + 0.5 * f3)) * (0.82 + 0.35 * br);
      if (h < 6) continue;

      /* лучевая структура вдоль магнитных линий */
      var rs = s * c.rayF;
      var rn = 0.5
        + 0.30 * nz(rs * 11.0 + c.o4 + T * c.d5)
        + 0.24 * nz(rs * 26.0 + c.o5 + T * c.d6)
        + 0.11 * nz(rs * 54.0 + c.o6);
      if (rn < 0) rn = 0; else if (rn > 1) rn = 1;
      /* куб + смещение: между лучами почти провал, на гребнях — яркие всплески */
      var rayAmt = base * (rn * rn * rn * 3.4 - 0.62);

      var y, dy, a, r, g, b, xf, xi, fr, w0, w1, o;

      /* мягкий подсвет НИЖЕ кромки (y растёт вниз) */
      var gy0 = Math.floor(yb) + 1; if (gy0 < 0) gy0 = 0;
      var gy1 = Math.floor(yb + GN); if (gy1 > lastRow) gy1 = lastRow;
      for (y = gy0; y <= gy1; y++) {
        dy = y - yb;
        var gi = dy | 0;
        if (gi >= GN) continue;
        a = base * GW[gi];
        r = a * GR; g = a * GG; b = a * GB;
        xf = i - sh * dy;
        if (xf < 0 || xf >= lastCol) continue;
        xi = xf | 0; fr = xf - xi; w0 = 1 - fr; w1 = fr;
        o = (y * bufW + xi) * 3;
        acc[o] += r * w0; acc[o + 1] += g * w0; acc[o + 2] += b * w0;
        acc[o + 3] += r * w1; acc[o + 4] += g * w1; acc[o + 5] += b * w1;
      }

      /* тело занавеси: от кромки yb ВВЕРХ на высоту h */
      var my1 = Math.floor(yb); if (my1 > lastRow) my1 = lastRow;
      var my0 = Math.ceil(yb - h); if (my0 < 0) my0 = 0;
      if (my1 < my0) continue;
      var step = 255 / h;
      dy = yb - my1;                       /* >= 0, растёт при движении вверх */
      var tv = dy * step;
      xf = i + sh * dy;
      for (y = my1; y >= my0; y--, tv += step, xf += sh) {
        var idx = tv | 0;
        if (idx > 255) idx = 255; else if (idx < 0) idx = 0;
        a = base + rayAmt * RAYW[idx];
        r = a * lr[idx]; g = a * lg[idx]; b = a * lb[idx];
        if (xf < 0 || xf >= lastCol) continue;
        xi = xf | 0; fr = xf - xi; w0 = 1 - fr; w1 = fr;
        o = (y * bufW + xi) * 3;
        acc[o] += r * w0; acc[o + 1] += g * w0; acc[o + 2] += b * w0;
        acc[o + 3] += r * w1; acc[o + 4] += g * w1; acc[o + 5] += b * w1;
      }
    }
  }

  function renderAurora() {
    acc.fill(0);

    var act = 0.78 + 0.22 * Math.sin(T * 0.117) + 0.20 * nz(T * 0.23 + 5.5);
    curAct = clamp(act, 0.42, 1.30);

    var gI = ui.intensity * curAct;
    var gamma = 1.45 - ui.hue * 1.05;
    var n = clamp(ui.count, 1, curtains.length);

    for (var ci = 0; ci < n; ci++) {
      var c = curtains[ci];
      buildLUT(c, gamma * (1 + 0.10 * Math.sin(T * 0.07 + c.phase)));
      drawCurtain(c, gI);
    }

    /* тон-мэппинг накопленного HDR-буфера + маска перекрытия звёзд */
    var d = imgBuf, od = occBuf, np = bufW * bufH, v, cr, cg, cb, mx;
    for (var p = 0, o = 0, q = 0; p < np; p++, o += 3, q += 4) {
      v = acc[o]; cr = v < TMAX ? TONE[(v * TSC) | 0] : 255;
      v = acc[o + 1]; cg = v < TMAX ? TONE[(v * TSC) | 0] : 255;
      v = acc[o + 2]; cb = v < TMAX ? TONE[(v * TSC) | 0] : 255;
      d[q] = cr; d[q + 1] = cg; d[q + 2] = cb;
      mx = cr > cg ? cr : cg; if (cb > mx) mx = cb;
      od[q + 3] = mx * 1.8;                  /* Uint8Clamped сам обрежет по 255 */
    }
    actx.putImageData(imgData, 0, 0);
    octx.putImageData(occData, 0, 0);

    /* блум: двухступенчатый даунсэмпл */
    bactx.globalAlpha = 1;
    bactx.globalCompositeOperation = 'source-over';
    bactx.drawImage(auroraCv, 0, 0, bloomA.width, bloomA.height);
    bbctx.globalAlpha = 1;
    bbctx.globalCompositeOperation = 'source-over';
    bbctx.drawImage(bloomA, 0, 0, bloomB.width, bloomB.height);

    /* зеркальная копия для отражения — сразу с подмешанным блумом (вода мягче неба) */
    rctx.setTransform(1, 0, 0, -1, 0, bufH);
    rctx.globalCompositeOperation = 'source-over';
    rctx.globalAlpha = 1;
    rctx.drawImage(auroraCv, 0, 0, bufW, bufH);
    rctx.globalCompositeOperation = 'lighter';
    rctx.globalAlpha = 0.55;
    rctx.drawImage(bloomA, 0, 0, bufW, bufH);
    rctx.globalAlpha = 1;
    rctx.globalCompositeOperation = 'source-over';
    rctx.setTransform(1, 0, 0, 1, 0, 0);

    /* мягкий источник для воды: два даунсэмпла = размытие по вертикали,
       чтобы в отражении не читались дискретные строки */
    rhctx.globalAlpha = 1;
    rhctx.globalCompositeOperation = 'source-over';
    rhctx.drawImage(reflCv, 0, 0, reflHalf.width, reflHalf.height);
    rbctx.globalAlpha = 1;
    rbctx.globalCompositeOperation = 'source-over';
    rbctx.drawImage(reflHalf, 0, 0, reflBlur.width, reflBlur.height);
  }

  /* ============================ вода ============================ */

  function drawWater() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, horizonY, W, waterH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizonY, W, waterH);
    ctx.clip();

    /* отражение звёзд — только общее свечение, точки в воде не различимы */
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.10;
    ctx.save();
    ctx.translate(0, horizonY);
    ctx.scale(1, -REFC);
    ctx.drawImage(starCv, 0, -skyH, W, skyH);
    ctx.restore();

    /* отражение сияния: размытый источник + широко перекрывающиеся полосы
       с плавным дрожанием фазы — швов между строками нет */
    var maxDepth = Math.min(waterH, skyH * REFC);
    var RBH = reflBlur.height, RBW = reflBlur.width;
    var srcPerD = RBH / (REFC * skyH);      /* строк источника на 1 px глубины */
    /* шаг stepD, полоса вдвое шире шага → каждый пиксель воды накрыт РОВНО
       двумя полосами (крайние клампятся): нет ни швов, ни ярких стыков */
    var NS = 26, stepD = maxDepth / NS, overD = stepD * 0.5;
    var pad = 30;

    for (var k = -1; k <= NS; k++) {
      var dA = (k - 0.5) * stepD, dB = (k + 1.5) * stepD;
      if (dA < 0) dA = 0;
      if (dB > maxDepth) dB = maxDepth;
      if (dB - dA < 0.25) continue;

      var sy = dA * srcPerD, shh = (dB - dA) * srcPerD;
      if (sy + shh > RBH) shh = RBH - sy;
      if (shh <= 0.05) continue;

      var dm = (dA + dB) * 0.5;
      var a = 0.22 * Math.exp(-dm / (maxDepth * 1.05));
      if (a < 0.004) continue;

      /* амплитуда дрожания растёт с удалением от берега */
      var wobf = 1 + (dm / maxDepth) * 1.8;
      var xo = (Math.sin(dm * 0.021 + T * 1.15) * 2.4
        + Math.sin(dm * 0.0075 - T * 0.62) * 4.1) * wobf;
      if (xo > pad) xo = pad; else if (xo < -pad) xo = -pad;

      ctx.globalAlpha = a;
      ctx.drawImage(reflBlur, 0, sy, RBW, shh,
        xo - pad, horizonY + dA, W + pad * 2, dB - dA);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    drawReflectedRidges();

    /* редкие мягкие блики на ряби (концы растворяются в градиенте) */
    ctx.globalCompositeOperation = 'lighter';
    for (var m = 0; m < 16; m++) {
      var ff = (m + 0.5) / 16;
      var yy = horizonY + Math.pow(ff, 1.55) * waterH;
      var ph = Math.sin(yy * 0.21 + T * 1.1 + m * 2.3);
      if (ph < 0.78) continue;
      var wgl = W * (0.06 + 0.12 * ((m * 37) % 10) / 10);
      var xx = ((m * 137.5) % 100) / 100 * W + Math.sin(T * 0.5 + m) * 34;
      var am = (ph - 0.78) * 0.42 * curAct;
      var lgm = ctx.createLinearGradient(xx - wgl * 0.5, 0, xx + wgl * 0.5, 0);
      lgm.addColorStop(0.00, 'rgba(150,240,205,0)');
      lgm.addColorStop(0.50, 'rgba(150,240,205,' + am.toFixed(3) + ')');
      lgm.addColorStop(1.00, 'rgba(150,240,205,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = lgm;
      ctx.fillRect(xx - wgl * 0.5, yy, wgl, 1 + ff * 1.3);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    /* затухание отражения с удалением от берега */
    var dg = ctx.createLinearGradient(0, horizonY, 0, H);
    dg.addColorStop(0.00, 'rgba(1,4,10,0)');
    dg.addColorStop(0.30, 'rgba(1,4,10,0.28)');
    dg.addColorStop(0.68, 'rgba(1,4,10,0.62)');
    dg.addColorStop(1.00, 'rgba(0,2,6,0.92)');
    ctx.fillStyle = dg;
    ctx.fillRect(0, horizonY, W, waterH);

    ctx.restore();
  }

  /* ============================ кадр ============================ */

  var last = 0;

  function frame(now) {
    var dt = last ? (now - last) / 1000 : 0.016;
    last = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;

    if (!ui.paused) {
      T += dt * ui.speed;
      updateShoot(dt * (ui.speed > 0.05 ? 1 : 0));
    }

    renderAurora();

    /* небо */
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, horizonY);

    drawStars();

    /* приземный airglow */
    var hg = ctx.createLinearGradient(0, horizonY - skyH * 0.26, 0, horizonY + 2);
    hg.addColorStop(0, 'rgba(40,120,110,0)');
    hg.addColorStop(1, 'rgba(58,150,128,' + (0.13 * curAct).toFixed(3) + ')');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hg;
    ctx.fillRect(0, horizonY - skyH * 0.26, W, skyH * 0.26 + 2);

    /* занавесь стоит ПЕРЕД звёздами: гасим фон по её яркости */
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.95;
    ctx.drawImage(occCv, 0, 0, bufW, bufH, 0, 0, W, horizonY);

    /* занавеси */
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.drawImage(auroraCv, 0, 0, bufW, bufH, 0, 0, W, horizonY);

    if (ui.bloom) {
      ctx.globalAlpha = 0.30;
      ctx.drawImage(bloomA, 0, 0, bloomA.width, bloomA.height, -W * 0.012, -horizonY * 0.015, W * 1.024, horizonY * 1.03);
      ctx.globalAlpha = 0.34;
      ctx.drawImage(bloomB, 0, 0, bloomB.width, bloomB.height, -W * 0.045, -horizonY * 0.055, W * 1.09, horizonY * 1.11);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    drawShoot();      /* метеор ниже сияния — рисуем поверх занавесей */

    drawWater();
    drawRidges();

    /* передний план — берег и ели */
    ctx.fillStyle = '#010306';
    ctx.fill(treePath);

    /* пост: виньетка + зерно */
    ctx.fillStyle = vignGrad;
    ctx.fillRect(0, 0, W, H);

    if (grainPat) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.040;
      var gx = ((Math.sin(T * 91.7) * 0.5 + 0.5) * 128) | 0;
      var gy = ((Math.sin(T * 57.3 + 2.1) * 0.5 + 0.5) * 128) | 0;
      ctx.translate(-gx, -gy);
      ctx.fillStyle = grainPat;
      ctx.fillRect(gx, gy, W, H);
      ctx.restore();
    }

    requestAnimationFrame(frame);
  }

  /* ============================ управление ============================ */

  function bindRange(id, valId, apply) {
    var el = document.getElementById(id);
    var out = document.getElementById(valId);
    if (!el) return;
    var upd = function () { apply(parseFloat(el.value), out); };
    el.addEventListener('input', upd);
    upd();
  }

  bindRange('sIntensity', 'vIntensity', function (v, out) {
    ui.intensity = v / 100;
    if (out) out.textContent = ui.intensity.toFixed(2);
  });
  bindRange('sSpeed', 'vSpeed', function (v, out) {
    ui.speed = v / 100;
    if (out) out.textContent = ui.speed.toFixed(2);
  });
  bindRange('sCount', 'vCount', function (v, out) {
    ui.count = Math.round(v);
    if (out) out.textContent = String(ui.count);
  });
  bindRange('sHue', 'vHue', function (v, out) {
    ui.hue = v / 100;
    if (out) out.textContent = 'пурпур ' + Math.round(v) + '%';
  });

  var bPause = document.getElementById('bPause');
  if (bPause) {
    bPause.addEventListener('click', function () {
      ui.paused = !ui.paused;
      bPause.classList.toggle('on', ui.paused);
      bPause.textContent = ui.paused ? 'Пуск' : 'Пауза';
    });
  }
  var bBloom = document.getElementById('bBloom');
  if (bBloom) {
    bBloom.addEventListener('click', function () {
      ui.bloom = !ui.bloom;
      bBloom.classList.toggle('on', ui.bloom);
    });
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  resize();
  requestAnimationFrame(frame);
})();
