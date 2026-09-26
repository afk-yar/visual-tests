/*
  Аналоговые настенные часы — чистый Canvas 2D, без библиотек.

  Архитектура рендера:
  • Статические слои рисуются один раз (при ресайзе / смене стиля / смене DPR) в offscreen-канвасы:
      wall  — стена с фактурой и мягкой тенью корпуса;
      clock — циферблат (печать, деления, цифры, тень от обода) + металлический обод;
      glass — френелевская кромка стекла;
      glare — блики стекла (двигаются с лёгким параллаксом за указателем);
      nut   — ось-гайка.
    Обод и гайка шейдятся попиксельно: по профилю (тор, выкружка, бусины) строится нормаль,
    отражённый луч смотрит в простую «студийную» карту окружения (потолок / стены / пол + софтбоксы).
  • Каждый кадр рисуются только стрелки: силуэт с двумя тенями (мягкая + контактная, смещение
    зависит от «высоты» стрелки над циферблатом), затем грани, освещённые в зависимости от угла.
  • Время — реальное системное (Date каждый кадр). Часовая учитывает минуты, минутная — секунды.
    Секундная: плавный sweep или тик с затухающим «пружинным» отскоком; переключение смешивается по dt.
*/
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var SQ = Math.SQRT1_2;

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d', { alpha: false });
  var hudEl = document.getElementById('hud');
  var panelEl = document.getElementById('panel');
  var subEl = document.getElementById('hud-sub');
  var metaEl = document.getElementById('hud-meta');

  // ---------------------------------------------------------------- утилиты
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function mix3(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
  function norm3(x, y, z) { var l = Math.sqrt(x * x + y * y + z * z); return [x / l, y / l, z / l]; }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function px(v) { return v.toFixed(2) + 'px '; }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash1(n) {
    var h = Math.imul(n | 0, 0x27d4eb2d) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // замкнутый по кругу 1D value-noise (t в [0,1))
  function ringNoise(t, n, seed) {
    var x = t * n, i = Math.floor(x), f = x - i;
    var a = hash1((((i % n) + n) % n) + seed * 1009);
    var b = hash1(((((i + 1) % n) + n) % n) + seed * 1009);
    f = f * f * (3 - 2 * f);
    return a + (b - a) * f;
  }

  // мягкое «плечо» вместо жёсткого клипа в белый
  function tone(v) { return v <= 0.8 ? v : 0.8 + 0.2 * (1 - Math.exp(-(v - 0.8) / 0.2)); }

  // тайл шума: белые/чёрные пиксели со случайной альфой — годится и для зерна, и (растянутый) для пятен
  function makeNoiseTile(size, seed) {
    var cv = makeCanvas(size, size), g = cv.getContext('2d');
    var img = g.createImageData(size, size), d = img.data, rnd = mulberry32(seed);
    for (var i = 0; i < size * size; i++) {
      var v = rnd() + rnd() - 1;
      var o = i * 4, c = v > 0 ? 255 : 0;
      d[o] = d[o + 1] = d[o + 2] = c;
      d[o + 3] = Math.min(255, Math.abs(v) * 300);
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
  var NOISE = makeNoiseTile(256, 1337);

  // ---------------------------------------------------------------- стили
  var THEMES = {
    classic: {
      sub: 'Хромированный обод · эмалевый циферблат · лакированные стрелки',
      wall: { base: [150, 167, 176], stripes: false, noise: 0.05, blotch: 0.035, light: 0.22, shade: 0.34 },
      cast: [0.36, 0.42],
      bezel: {
        inner: 0.86, tint: [0.93, 0.945, 0.97], rough: 0.02, lathe: 0.018, patina: 0,
        segs: [
          { t: 'torus', u0: 0.86, u1: 0.884, a: 0.9 },
          { t: 'cove', u0: 0.884, u1: 0.906, s0: 0.05, s1: 1.15 },
          { t: 'torus', u0: 0.906, u1: 1.0, a: 0.85 }
        ]
      },
      dial: 'paper', print: 'classic', hands: 'classic',
      edgeAO: 0.16, rimShadow: 0.5,
      nut: { size: 0.036, tint: [0.9, 0.915, 0.94], rough: 0.06, rot: 0.26 },
      handShadow: 0.38, glare: 1.0
    },
    vintage: {
      sub: 'Латунь с бусинами · римские цифры · воронёные стрелки Бреге',
      wall: { base: [38, 57, 47], stripes: true, noise: 0.06, blotch: 0.045, light: 0.16, shade: 0.52 },
      cast: [0.52, 0.55],
      bezel: {
        inner: 0.84, tint: [0.97, 0.75, 0.41], rough: 0.12, lathe: 0.012, patina: 0.16, gain: 1.05,
        segs: [
          { t: 'torus', u0: 0.84, u1: 0.858, a: 0.9 },
          { t: 'beads', u0: 0.858, u1: 0.892, a: 0.95 },
          { t: 'lin', u0: 0.892, u1: 0.905, s0: 0.55, s1: 0.1 },
          { t: 'torus', u0: 0.905, u1: 1.0, a: 0.72 }
        ]
      },
      dial: 'aged', print: 'railroad', hands: 'breguet',
      edgeAO: 0.3, rimShadow: 0.55,
      nut: { size: 0.034, tint: [0.96, 0.74, 0.4], rough: 0.1, rot: 0.1 },
      handShadow: 0.42, glare: 0.85
    },
    minimal: {
      sub: 'Алюминиевый обод · циферблат «санрей» · накладные индексы',
      wall: { base: [206, 205, 200], stripes: false, noise: 0.07, blotch: 0.06, light: 0.14, shade: 0.3 },
      cast: [0.34, 0.42],
      bezel: {
        inner: 0.925, tint: [0.86, 0.87, 0.885], rough: 0.26, lathe: 0.07, patina: 0, gain: 1.5,
        segs: [
          { t: 'lin', u0: 0.925, u1: 0.94, s0: 1.3, s1: 1.1 },
          { t: 'lin', u0: 0.94, u1: 0.982, s0: 0.12, s1: -0.12 },
          { t: 'cove', u0: 0.982, u1: 1.0, s0: -0.15, s1: -4.5 }
        ]
      },
      dial: 'sunburst', print: 'minimal', hands: 'minimal',
      edgeAO: 0.35, rimShadow: 0.7,
      nut: { size: 0.028, tint: [0.88, 0.89, 0.91], rough: 0.1, rot: 0.4 },
      handShadow: 0.62, glare: 1.15, glareSpot: false
    }
  };

  (function prepThemes() {
    for (var key in THEMES) {
      var t = THEMES[key];
      t.bezel.spec = mix3(t.bezel.tint, [1, 1, 1], 0.35);
      t.nut.spec = mix3(t.nut.tint, [1, 1, 1], 0.35);
      t.nut.gain = 1.2;
      t.bezel.segs.forEach(function (s) {
        if (s.t === 'beads') {
          var mid = (s.u0 + s.u1) / 2, hw = (s.u1 - s.u0) / 2;
          s.n = Math.round(TAU * mid / (2 * hw * 1.02));
        }
      });
    }
  })();

  // ---------------------------------------------------------------- состояние
  var state = { theme: 'classic', sec: 'tick' };
  var secBlend = 1;              // 1 — тик, 0 — плавный ход
  var par = { x: 0, y: 0, tx: 0, ty: 0 };
  var cssW = 0, cssH = 0, dpr = 1, W = 0, H = 0, cx = 0, cy = 0, R = 0;
  var L = null;                  // собранные слои
  var needBuild = true, resizeAt = 0, lastTs = 0;
  var fadeCv = null, fadeA = 0;
  var lastSec = -1;

  // ---------------------------------------------------------------- раскладка
  function layout() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(cssW * dpr));
    H = Math.max(1, Math.round(cssH * dpr));
    canvas.width = W;
    canvas.height = H;

    var pr = panelEl.getBoundingClientRect();
    var hr = hudEl.getBoundingClientRect();
    var bottom = Math.max(16, cssH - pr.top + 14);
    function fit(top) {
      var ah = cssH - top - bottom, aw = cssW - 32;
      return { r: Math.min(ah, aw) / 2, cy: top + ah / 2 };
    }
    var f = fit(16);
    // если корпус реально пересекается с HUD (узкое окно) — опускаем его под заголовок
    var qx = clamp(cssW / 2, hr.left, hr.right), qy = clamp(f.cy, hr.top, hr.bottom);
    var dist = Math.sqrt((cssW / 2 - qx) * (cssW / 2 - qx) + (f.cy - qy) * (f.cy - qy));
    if (dist < f.r * 0.955 + 6) {
      var f2 = fit(hr.bottom + 10);
      if (f2.r > 60) f = f2;
    }
    var rc = f.r * 0.955;
    if (rc < 40) { rc = Math.max(24, Math.min(cssW, cssH) / 2 - 8); f.cy = cssH / 2; }
    R = Math.max(20, Math.floor(rc * dpr));
    cx = Math.round((cssW / 2) * dpr);
    cy = Math.round(f.cy * dpr);
  }

  // ---------------------------------------------------------------- освещение металла
  var K1 = norm3(-0.5, -0.62, 0.6);   // основной софтбокс сверху-слева
  var K2 = norm3(0.74, -0.28, 0.6);   // заполняющий справа

  // отражённый луч -> «студийное» окружение: потолок, стены (окно слева), пол, софтбоксы
  function metalShade(nx, ny, nz, m, C) {
    var rx = 2 * nz * nx, ry = 2 * nz * ny, rz = 2 * nz * nz - 1;
    var rough = m.rough;
    var up = -ry;
    var tw = 0.025 + 0.4 * rough;
    var floor = 0.085 + 0.1 * (1 + clamp(up, -1, 0));
    var wall = 0.5 - 0.22 * rx;
    var upper = mix(wall, 0.96, smoothstep(0.1, 0.55, up));
    var base = mix(floor, upper, smoothstep(-tw, tw, up + 0.02));
    base *= 1 - 0.2 * smoothstep(0.8, 1, rz);        // тёмная зона «за зрителем»
    base = mix(base, 0.46, rough * 0.55) * (m.gain || 1);
    var s1 = rx * K1[0] + ry * K1[1] + rz * K1[2];
    var s2 = rx * K2[0] + ry * K2[1] + rz * K2[2];
    var spec = smoothstep(0.94 - 0.3 * rough, 0.98 - 0.1 * rough, s1) * (1.25 - 0.6 * rough);
    if (s1 > 0) { var q = s1 * s1; q *= q; spec += q * q * 0.28; }
    spec += smoothstep(0.965 - 0.3 * rough, 0.99 - 0.1 * rough, s2) * (0.55 - 0.25 * rough);
    var t = m.tint, sp = m.spec;
    C.r = base * t[0] + spec * sp[0];
    C.g = base * t[1] + spec * sp[1];
    C.b = base * t[2] + spec * sp[2];
  }

  // профиль обода: наклон высоты по радиусу (sr) и по дуге (st), плюс затенение канавок (ao)
  function bezelProfile(segs, u, dx, dy, Rp, P) {
    var i = 0;
    while (i < segs.length - 1 && u > segs[i].u1) i++;
    var s = segs[i];
    var uu = clamp(u, s.u0, s.u1);
    var f = (uu - s.u0) / (s.u1 - s.u0);
    P.sr = 0; P.st = 0; P.ao = 1;
    if (s.t === 'torus') {
      var t = clamp(f * 2 - 1, -0.985, 0.985);
      P.sr = -s.a * t / Math.sqrt(1 - t * t);
    } else if (s.t === 'cove') {
      P.sr = s.s0 + (s.s1 - s.s0) * f * f;
    } else if (s.t === 'lin') {
      P.sr = s.s0 + (s.s1 - s.s0) * f;
    } else if (s.t === 'beads') {
      var mid = (s.u0 + s.u1) / 2, hw = (s.u1 - s.u0) / 2;
      var ph = (Math.atan2(dy, dx) / TAU) * s.n;
      ph -= Math.round(ph);
      var ds = ph * TAU * mid / s.n, dr = uu - mid, rb = hw * 0.97;
      var qq = (dr * dr + ds * ds) / (rb * rb);
      if (qq < 1) {
        var z = Math.max(0.2, Math.sqrt(1 - qq));
        P.sr = -s.a * (dr / rb) / z;
        P.st = -s.a * (ds / rb) / z;
        P.ao = 1 - 0.3 * smoothstep(0.55, 1, qq);
      } else {
        P.ao = 0.4;
      }
    }
    for (var k = 1; k < segs.length; k++) {
      var dpx = Math.abs(u - segs[k].u0) * Rp;
      if (dpx < 2.5) P.ao *= 0.55 + 0.45 * smoothstep(0, 1.8, dpx);
    }
  }

  function renderBezel(S, Rp, bz) {
    var cv = makeCanvas(S, S), g = cv.getContext('2d');
    var img = g.createImageData(S, S), d = img.data;
    var c = S / 2;
    var innerPx = bz.inner * Rp;
    var rOut2 = (Rp + 1) * (Rp + 1);
    var rIn = Math.max(0, innerPx - 1), rIn2 = rIn * rIn;
    var segs = bz.segs;
    var P = { sr: 0, st: 0, ao: 1 };
    var C = { r: 0, g: 0, b: 0 };
    for (var y = 0; y < S; y++) {
      var dy = y + 0.5 - c, dy2 = dy * dy;
      if (dy2 > rOut2) continue;
      for (var x = 0; x < S; x++) {
        var dx = x + 0.5 - c;
        var r2 = dx * dx + dy2;
        if (r2 > rOut2 || r2 < rIn2) continue;
        var r = Math.sqrt(r2);
        var cov = clamp(Rp - r + 0.5, 0, 1) * clamp(r - innerPx + 0.5, 0, 1);
        if (cov <= 0) continue;
        var ux = dx / r, uy = dy / r;
        bezelProfile(segs, r / Rp, dx, dy, Rp, P);
        var ao = P.ao;
        ao *= 0.55 + 0.45 * smoothstep(0, 2.2, r - innerPx);   // тёмная кромка у стекла
        ao *= 0.72 + 0.28 * smoothstep(0, 2.5, Rp - r);        // и у стены
        var gx = P.sr * ux - P.st * uy, gy = P.sr * uy + P.st * ux;
        var inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        metalShade(-gx * inv, -gy * inv, inv, bz, C);
        var k = ao;
        if (bz.lathe) k *= 1 + bz.lathe * (hash1(Math.floor(r * 1.5)) - 0.5) * 2;   // токарные риски
        if (bz.patina) {
          var th = Math.atan2(dy, dx) / TAU + 0.5;
          var pn = 0.6 * ringNoise(th, 23, 1) + 0.4 * ringNoise(th, 61, 2);
          k *= 1 - bz.patina * pn;
        }
        var o = (y * S + x) * 4;
        d[o] = 255 * tone(C.r * k);
        d[o + 1] = 255 * tone(C.g * k);
        d[o + 2] = 255 * tone(C.b * k);
        d[o + 3] = 255 * cov;
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  // ---------------------------------------------------------------- текст
  function textCentered(g, text, x, y, font, color, sx) {
    g.font = font;
    g.fillStyle = color;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    var m = g.measureText(text);
    var left = m.actualBoundingBoxLeft, right = m.actualBoundingBoxRight;
    var asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
    if (!(right > 0) && !(left > 0)) { left = 0; right = m.width; }
    if (!(asc > 0)) {
      var fm = /([\d.]+)px/.exec(font);
      asc = (fm ? parseFloat(fm[1]) : 14) * 0.7;
      desc = 0;
    }
    g.save();
    g.translate(x, y);
    if (sx && sx !== 1) g.scale(sx, 1);
    g.fillText(text, (left - right) / 2, (asc - desc) / 2);
    g.restore();
  }

  function spacedText(g, text, x, y, size, font, color, spacing) {
    g.font = font;
    g.fillStyle = color;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    var m = g.measureText(text);
    var asc = m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent : size * 0.7;
    var desc = m.actualBoundingBoxDescent > 0 ? m.actualBoundingBoxDescent : 0;
    var sp = spacing * size, ws = [], total = 0, i;
    for (i = 0; i < text.length; i++) { var w = g.measureText(text[i]).width; ws.push(w); total += w; }
    total += sp * (text.length - 1);
    var pxx = x - total / 2, by = y + (asc - desc) / 2;
    for (i = 0; i < text.length; i++) { g.fillText(text[i], pxx, by); pxx += ws[i] + sp; }
  }

  // ---------------------------------------------------------------- стена
  function buildWall(th) {
    var cv = makeCanvas(W, H), g = cv.getContext('2d');
    var w = th.wall;
    g.fillStyle = rgba(w.base, 1);
    g.fillRect(0, 0, W, H);

    if (w.stripes) {                                     // обои в узкую полоску
      var p = Math.max(8, Math.round(46 * dpr));
      var x0 = (cx % p) - p - p / 4;
      for (var x = x0; x < W; x += p) {
        g.fillStyle = 'rgba(255,255,255,0.03)';
        g.fillRect(x, 0, p / 2, H);
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(x + p / 2, 0, Math.max(1, 0.8 * dpr), H);
        g.fillStyle = 'rgba(214,184,112,0.07)';
        g.fillRect(x + p * 0.75, 0, Math.max(1, 1.2 * dpr), H);
      }
    }

    g.save();                                            // фактура штукатурки: пятна + зерно
    g.imageSmoothingEnabled = true;
    var oct = [[22, w.blotch], [6, w.blotch * 0.6]];
    for (var i = 0; i < oct.length; i++) {
      g.globalAlpha = oct[i][1];
      var ts = 256 * oct[i][0] * dpr;
      for (var yy = 0; yy < H; yy += ts) for (var xx = 0; xx < W; xx += ts) g.drawImage(NOISE, xx, yy, ts, ts);
    }
    g.globalAlpha = w.noise;
    g.fillStyle = g.createPattern(NOISE, 'repeat');
    g.fillRect(0, 0, W, H);
    g.restore();

    var lx = W * 0.1, ly = -H * 0.25, lr = Math.sqrt(W * W + H * H) * 1.1;   // свет сверху-слева
    var lg = g.createRadialGradient(lx, ly, 0, lx, ly, lr);
    lg.addColorStop(0, 'rgba(255,248,235,' + w.light + ')');
    lg.addColorStop(0.4, 'rgba(255,248,235,0)');
    lg.addColorStop(0.75, 'rgba(0,0,0,' + (w.shade * 0.5) + ')');
    lg.addColorStop(1, 'rgba(0,0,0,' + w.shade + ')');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);

    g.save();                                            // тень корпуса на стене (мягкая + контактная)
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(cx, cy, R - 2, 0, TAU);
    g.shadowColor = 'rgba(0,0,0,' + th.cast[0] + ')';
    g.shadowBlur = 0.15 * R;
    g.shadowOffsetX = 0.035 * R;
    g.shadowOffsetY = 0.06 * R;
    g.fill();
    g.shadowColor = 'rgba(0,0,0,' + th.cast[1] + ')';
    g.shadowBlur = 0.025 * R;
    g.shadowOffsetX = 0.008 * R;
    g.shadowOffsetY = 0.014 * R;
    g.fill();
    g.restore();
    return cv;
  }

  // ---------------------------------------------------------------- циферблаты
  function fillDisc(g, c, D, style) {
    g.fillStyle = style;
    g.fillRect(c - D - 4, c - D - 4, 2 * D + 8, 2 * D + 8);
  }

  function grain(g, c, D, a) {
    g.save();
    g.globalAlpha = a;
    fillDisc(g, c, D, g.createPattern(NOISE, 'repeat'));
    g.restore();
  }

  function dialLight(g, c, D, a) {
    var lg = g.createLinearGradient(c - D, c - D, c + D, c + D);
    lg.addColorStop(0, 'rgba(255,255,255,' + a + ')');
    lg.addColorStop(0.5, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(0,0,0,' + a + ')');
    fillDisc(g, c, D, lg);
  }

  var DIALS = {
    paper: function (g, c, D) {
      var grd = g.createRadialGradient(c - 0.22 * D, c - 0.28 * D, 0.02 * D, c, c, 1.08 * D);
      grd.addColorStop(0, '#fdfcf8');
      grd.addColorStop(0.6, '#f4f1e9');
      grd.addColorStop(1, '#e3ded2');
      fillDisc(g, c, D, grd);
      grain(g, c, D, 0.035);
      dialLight(g, c, D, 0.04);
    },

    aged: function (g, c, D) {
      var grd = g.createRadialGradient(c - 0.15 * D, c - 0.2 * D, 0.05 * D, c, c, 1.05 * D);
      grd.addColorStop(0, '#f1e6c9');
      grd.addColorStop(0.55, '#e8d9b4');
      grd.addColorStop(0.85, '#dac597');
      grd.addColorStop(1, '#c6ab76');
      fillDisc(g, c, D, grd);
      var rnd = mulberry32(20240917), i, a, rr, x, y, s, al;
      for (i = 0; i < 20; i++) {                         // размытые пятна старения
        a = rnd() * TAU; rr = Math.sqrt(rnd()) * 0.95 * D;
        x = c + Math.cos(a) * rr; y = c + Math.sin(a) * rr;
        s = (0.03 + rnd() * 0.14) * D; al = 0.02 + rnd() * 0.05;
        var sg = g.createRadialGradient(x, y, 0, x, y, s);
        sg.addColorStop(0, 'rgba(150,100,40,' + al.toFixed(3) + ')');
        sg.addColorStop(0.6, 'rgba(150,100,40,' + (al * 0.45).toFixed(3) + ')');
        sg.addColorStop(1, 'rgba(150,100,40,0)');
        g.fillStyle = sg;
        g.fillRect(x - s, y - s, 2 * s, 2 * s);
      }
      for (i = 0; i < 120; i++) {                        // «фоксинг» — мелкие рыжие точки
        a = rnd() * TAU; rr = (0.35 + 0.65 * Math.sqrt(rnd())) * D;
        x = c + Math.cos(a) * rr; y = c + Math.sin(a) * rr;
        s = (0.0012 + rnd() * 0.0035) * D;
        g.fillStyle = 'rgba(115,72,30,' + (0.08 + rnd() * 0.22).toFixed(3) + ')';
        g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill();
      }
      grain(g, c, D, 0.075);
      dialLight(g, c, D, 0.035);
    },

    sunburst: function (g, c, D) {                       // «санрей»: радиальная сатинировка, светлая «бабочка»
      var rr = Math.ceil(D + 4), N = rr * 2;
      var cv = makeCanvas(N, N), cg = cv.getContext('2d');
      var img = cg.createImageData(N, N), d = img.data;
      var lim2 = rr * rr, fadeR = 0.12 * D;
      for (var y = 0; y < N; y++) {
        var dy = y + 0.5 - rr;
        for (var x = 0; x < N; x++) {
          var dx = x + 0.5 - rr, r2 = dx * dx + dy * dy;
          if (r2 > lim2) continue;
          var r = Math.sqrt(r2) || 1e-4;
          var td = Math.abs(SQ * (dy - dx) / r);        // |касательная · направление на свет|
          var t2 = td * td, t6 = t2 * t2 * t2;
          var th = Math.atan2(dy, dx) / TAU + 0.5;
          var line = hash1(Math.floor(th * 3000)) - 0.5;
          var fc = smoothstep(0, fadeR, r);
          var q = r / D;
          var v = (0.125 + 0.2 * t6 + 0.05 * t2) * (1 + line * 0.24 * fc) * (1 - 0.18 * q * q);
          var o = (y * N + x) * 4;
          d[o] = 255 * v * 0.93;
          d[o + 1] = 255 * v * 0.97;
          d[o + 2] = 255 * v * 1.04;
          d[o + 3] = 255;
        }
      }
      cg.putImageData(img, 0, 0);
      g.drawImage(cv, c - rr, c - rr);
      grain(g, c, D, 0.03);
    }
  };

  // ---------------------------------------------------------------- печать циферблата
  var SANS = '"Avenir Next", Avenir, "Century Gothic", Futura, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  var SERIF = '"Bodoni MT", Didot, "Baskerville Old Face", Baskerville, "Times New Roman", Georgia, serif';
  var THIN = '"Helvetica Neue", "Segoe UI Light", "Segoe UI", Roboto, Arial, sans-serif';

  function tickRect(g, c, a, w, r0, r1) {
    g.save();
    g.translate(c, c);
    g.rotate(a);
    g.fillRect(-w / 2, -r1, w, r1 - r0);
    g.restore();
  }

  var PRINTS = {
    classic: function (g, c, D) {
      var ink = 'rgba(21,23,27,0.94)', i;
      g.fillStyle = ink;
      for (i = 0; i < 60; i++) {
        var hour = i % 5 === 0;
        var w = hour ? (i % 15 === 0 ? 0.03 : 0.022) * D : 0.0075 * D;
        tickRect(g, c, i * TAU / 60, w, (hour ? 0.845 : 0.905) * D, 0.955 * D);
      }
      var font = '500 ' + px(0.165 * D) + SANS;
      for (var k = 1; k <= 12; k++) {
        var a = k * TAU / 12;
        textCentered(g, String(k), c + Math.sin(a) * 0.705 * D, c - Math.cos(a) * 0.705 * D, font, ink, 1);
      }
      spacedText(g, 'OPUS', c, c - 0.34 * D, 0.052 * D, '600 ' + px(0.052 * D) + SANS, ink, 0.32);
      spacedText(g, 'QUARTZ', c, c + 0.36 * D, 0.032 * D, '500 ' + px(0.032 * D) + SANS, 'rgba(21,23,27,0.62)', 0.45);
    },

    railroad: function (g, c, D) {
      var ink = 'rgba(40,28,18,0.92)', i;
      g.save();
      g.shadowColor = 'rgba(40,28,18,0.35)';           // лёгкое «растекание» краски
      g.shadowBlur = 0.8 * dpr;
      g.strokeStyle = ink;
      g.fillStyle = ink;
      function ring(r, w) { g.lineWidth = w; g.beginPath(); g.arc(c, c, r, 0, TAU); g.stroke(); }
      ring(0.955 * D, 0.0055 * D);
      ring(0.898 * D, 0.0045 * D);
      ring(0.655 * D, 0.0035 * D);
      for (i = 0; i < 60; i++) {
        tickRect(g, c, i * TAU / 60, (i % 5 === 0 ? 0.013 : 0.0045) * D, 0.898 * D, 0.955 * D);
      }
      var romans = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
      var font = '400 ' + px(0.19 * D) + SERIF;
      for (var k = 0; k < 12; k++) {
        g.save();
        g.translate(c, c);
        g.rotate(k * TAU / 12);
        textCentered(g, romans[k], 0, -0.772 * D, font, ink, 0.8);
        g.restore();
      }
      textCentered(g, 'Opus', c, c - 0.37 * D, 'italic 400 ' + px(0.1 * D) + SERIF, ink, 1);
      spacedText(g, 'PARIS', c, c - 0.285 * D, 0.03 * D, '400 ' + px(0.03 * D) + SERIF, ink, 0.55);
      g.restore();
    },

    minimal: function (g, c, D) {
      var i, k;
      g.fillStyle = 'rgba(214,219,225,0.55)';
      for (i = 0; i < 60; i++) {
        if (i % 5 === 0) continue;
        tickRect(g, c, i * TAU / 60, 0.0048 * D, 0.905 * D, 0.935 * D);
      }
      // накладные полированные индексы с собственной тенью
      for (k = 0; k < 12; k++) {
        var a = k * TAU / 12;
        var b = (Math.cos(a) + Math.sin(a)) * SQ;
        var bars = k === 0 ? [-0.017, 0.017] : [0];
        var w = (k === 0 ? 0.015 : 0.022) * D;
        var r0 = 0.785 * D, r1 = 0.935 * D;
        g.save();
        g.translate(c, c);
        g.rotate(a);
        for (i = 0; i < bars.length; i++) {
          var x = bars[i] * D - w / 2;
          g.shadowColor = 'rgba(0,0,0,0.7)';
          g.shadowBlur = 0.012 * D;
          g.shadowOffsetX = 0.005 * D;
          g.shadowOffsetY = 0.007 * D;
          g.fillStyle = '#d4d7db';
          g.fillRect(x, -r1, w, r1 - r0);
          g.shadowColor = 'rgba(0,0,0,0)';
          g.fillStyle = b > 0 ? 'rgba(255,255,255,' + (0.6 * b).toFixed(3) + ')' : 'rgba(0,0,0,' + (-0.4 * b).toFixed(3) + ')';
          g.fillRect(x, -r1, w / 2, r1 - r0);
          g.fillStyle = b > 0 ? 'rgba(0,0,0,' + (0.4 * b).toFixed(3) + ')' : 'rgba(255,255,255,' + (-0.6 * b).toFixed(3) + ')';
          g.fillRect(x + w / 2, -r1, w / 2, r1 - r0);
          g.fillStyle = 'rgba(255,255,255,0.35)';          // блик на торце
          g.fillRect(x, -r1, w, Math.max(1, 0.004 * D));
        }
        g.restore();
      }
      var font = '300 ' + px(0.1 * D) + THIN;
      for (k = 1; k <= 12; k++) {
        var an = k * TAU / 12;
        textCentered(g, String(k), c + Math.sin(an) * 0.64 * D, c - Math.cos(an) * 0.64 * D, font, 'rgba(226,229,234,0.88)', 1);
      }
      spacedText(g, 'OPUS', c, c - 0.3 * D, 0.04 * D, '500 ' + px(0.04 * D) + THIN, 'rgba(226,229,234,0.78)', 0.5);
      spacedText(g, 'QUARTZ', c, c + 0.3 * D, 0.028 * D, '500 ' + px(0.028 * D) + THIN, 'rgba(255,122,52,0.9)', 0.55);
    }
  };

  // тень от обода на циферблате + затемнение у края
  function dialEdge(g, c, D, th) {
    var rg = g.createRadialGradient(c, c, D * 0.8, c, c, D);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(0,0,0,' + th.edgeAO + ')');
    fillDisc(g, c, D, rg);
    g.save();
    g.beginPath();
    g.rect(c - D * 2, c - D * 2, D * 4, D * 4);
    g.moveTo(c + D, c);
    g.arc(c, c, D, TAU, 0, true);
    g.closePath();
    g.shadowColor = 'rgba(0,0,0,' + th.rimShadow + ')';
    g.shadowBlur = 0.045 * D;
    g.shadowOffsetX = 0.014 * D;
    g.shadowOffsetY = 0.02 * D;
    g.fillStyle = '#000';
    g.fill();
    g.restore();
  }

  function buildClock(th, S, Rp, D) {
    var cv = makeCanvas(S, S), g = cv.getContext('2d');
    var c = S / 2;
    g.save();
    g.beginPath();
    g.arc(c, c, D + 3, 0, TAU);
    g.clip();
    DIALS[th.dial](g, c, D, th);
    PRINTS[th.print](g, c, D, th);
    dialEdge(g, c, D, th);
    g.restore();
    g.drawImage(renderBezel(S, Rp, th.bezel), 0, 0);
    return cv;
  }

  // ---------------------------------------------------------------- стекло
  function buildGlass(th, S, D) {
    var cv = makeCanvas(S, S), g = cv.getContext('2d'), c = S / 2;
    g.beginPath();
    g.arc(c, c, D, 0, TAU);
    g.clip();
    var lin = g.createLinearGradient(c - D, c - D, c + D, c + D);
    lin.addColorStop(0, 'rgba(255,255,255,0.06)');
    lin.addColorStop(0.5, 'rgba(255,255,255,0)');
    lin.addColorStop(1, 'rgba(0,0,0,0.04)');
    g.fillStyle = lin;
    g.fillRect(0, 0, S, S);
    var rg = g.createRadialGradient(c, c, D * 0.9, c, c, D);   // толщина стекла у кромки
    rg.addColorStop(0, 'rgba(255,255,255,0)');
    rg.addColorStop(0.7, 'rgba(255,255,255,0.05)');
    rg.addColorStop(0.92, 'rgba(0,0,0,0.06)');
    rg.addColorStop(1, 'rgba(0,0,0,0.2)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    return cv;
  }

  function buildGlare(th, S, D) {
    var cv = makeCanvas(S, S), g = cv.getContext('2d'), c = S / 2, G = th.glare;
    // широкий серп отражения окна сверху-слева
    var lg = g.createLinearGradient(c - 0.75 * D, c - 0.8 * D, c - 0.05 * D, c + 0.1 * D);
    lg.addColorStop(0, 'rgba(255,255,255,' + (0.3 * G).toFixed(3) + ')');
    lg.addColorStop(0.55, 'rgba(255,255,255,' + (0.1 * G).toFixed(3) + ')');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.beginPath();
    g.arc(c, c, 0.975 * D, 0, TAU);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    var qx = c + 0.2 * D, qy = c + 0.26 * D, qr = D;
    var cg = g.createRadialGradient(qx, qy, qr * 0.86, qx, qy, qr);
    cg.addColorStop(0, 'rgba(0,0,0,1)');
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cg;
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';

    g.lineCap = 'round';
    function streak(a0, a1, r, w, alpha) {
      var p0x = c + Math.cos(a0) * r, p0y = c + Math.sin(a0) * r;
      var p1x = c + Math.cos(a1) * r, p1y = c + Math.sin(a1) * r;
      var sg = g.createLinearGradient(p0x, p0y, p1x, p1y);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,' + alpha.toFixed(3) + ')');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = sg;
      g.lineWidth = w;
      g.beginPath();
      g.arc(c, c, r, a0, a1);
      g.stroke();
    }
    streak(TAU * 0.575, TAU * 0.7, 0.93 * D, 0.014 * D, 0.55 * G);   // острый блик у кромки
    streak(TAU * 0.055, TAU * 0.18, 0.955 * D, 0.008 * D, 0.22 * G);  // слабый отсвет снизу-справа

    if (th.glareSpot !== false) {                                    // мягкое пятно (на тёмном циферблате читается как грязь — там выключено)
      var hx = c - 0.5 * D, hy = c - 0.52 * D, hr = 0.1 * D;
      var hg = g.createRadialGradient(hx, hy, 0, hx, hy, hr);
      hg.addColorStop(0, 'rgba(255,255,255,' + (0.14 * G).toFixed(3) + ')');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hg;
      g.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
    }
    return cv;
  }

  // ---------------------------------------------------------------- ось-гайка
  function buildNut(th, D) {
    var nt = th.nut;
    var Rh = nt.size * D;
    var N = Math.ceil(Rh * 2 + 6);
    if (N % 2) N++;
    var cv = makeCanvas(N, N), g = cv.getContext('2d');
    var img = g.createImageData(N, N), d = img.data;
    var c = N / 2, ap = Rh * Math.cos(Math.PI / 6);
    var rc = ap * 0.88, ra = ap * 0.34, groove = Math.max(1, ap * 0.07);
    var nrm = [];
    for (var k = 0; k < 3; k++) {
      var a = nt.rot + Math.PI / 6 + k * Math.PI / 3;
      nrm.push(Math.cos(a), Math.sin(a));
    }
    var C = { r: 0, g: 0, b: 0 };
    for (var y = 0; y < N; y++) {
      var dy = y + 0.5 - c;
      for (var x = 0; x < N; x++) {
        var dx = x + 0.5 - c;
        var hd = Math.max(Math.abs(dx * nrm[0] + dy * nrm[1]), Math.abs(dx * nrm[2] + dy * nrm[3]), Math.abs(dx * nrm[4] + dy * nrm[5])) - ap;
        var cov = clamp(0.5 - hd, 0, 1);
        if (cov <= 0) continue;
        var r = Math.sqrt(dx * dx + dy * dy) || 1e-4;
        var ux = dx / r, uy = dy / r;
        var sr, ao = 1;
        if (r < ra) {                                   // торец оси — выпуклый
          var t = Math.min(r / ra, 0.96);
          sr = -0.75 * t / Math.sqrt(1 - t * t);
        } else {
          sr = mix(0, -1.05, clamp(r - rc + 0.5, 0, 1)); // плоская грань -> фаска
        }
        var gIn = clamp(r - ra + 0.5, 0, 1), gOut = clamp(r - ra - groove + 0.5, 0, 1);
        ao *= 1 - 0.6 * gIn * (1 - gOut);               // щель резьбы вокруг оси
        ao *= 0.62 + 0.38 * smoothstep(0, 1.5, -hd);    // кромка шестигранника
        if (r > ra + groove && r < rc) ao *= 1 + 0.05 * (hash1(Math.floor(r * 2) + 77) - 0.5);
        var gx = sr * ux, gy = sr * uy;
        var inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        metalShade(-gx * inv, -gy * inv, inv, nt, C);
        var o = (y * N + x) * 4;
        d[o] = 255 * tone(C.r * ao);
        d[o + 1] = 255 * tone(C.g * ao);
        d[o + 2] = 255 * tone(C.b * ao);
        d[o + 3] = 255 * cov;
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  // ---------------------------------------------------------------- стрелки
  // Все контуры строятся по часовой стрелке (nonzero), отверстия — против.
  function addPoly(p, pts, D) {
    var n = pts.length, i;
    p.moveTo(-pts[0][1] * D, pts[0][0] * D);
    for (i = 1; i < n; i++) p.lineTo(-pts[i][1] * D, pts[i][0] * D);
    for (i = n - 1; i >= 0; i--) {
      if (i === n - 1 && pts[i][1] === 0) continue;
      p.lineTo(pts[i][1] * D, pts[i][0] * D);
    }
    p.closePath();
  }
  function addCircle(p, x, y, r, hole) {
    p.moveTo(x + r, y);
    if (hole) p.arc(x, y, r, TAU, 0, true);
    else p.arc(x, y, r, 0, TAU, false);
    p.closePath();
  }
  function addBar(p, hw, yTail, yTip) {
    p.moveTo(-hw, yTail);
    p.lineTo(-hw, yTip);
    p.arc(0, yTip, hw, Math.PI, TAU, false);
    p.lineTo(hw, yTail);
    p.arc(0, yTail, hw, 0, Math.PI, false);
    p.closePath();
  }
  function addRing(p, y, ro, ri, D) {
    addCircle(p, 0, y * D, ro * D, false);
    addCircle(p, 0, y * D, ri * D, true);
  }

  var FACET = {
    ink: { l: '255,255,255', d: '0,0,0', kl: 0.2, kd: 0.3 },
    red: { l: '255,205,195', d: '40,0,0', kl: 0.26, kd: 0.3 },
    blued: { l: '105,150,255', d: '0,0,12', kl: 0.5, kd: 0.35 }
  };

  function buildHands(th, D) {
    var hs = {}, p;
    if (th.hands === 'classic') {
      p = new Path2D();
      addPoly(p, [[0.13, 0.022], [0, 0.03], [-0.31, 0.04], [-0.53, 0]], D);
      addCircle(p, 0, 0.13 * D, 0.022 * D);
      addCircle(p, 0, 0, 0.062 * D);
      hs.hour = { path: p, color: '#141619', facet: FACET.ink, hub: 0.062 * D, hubLight: 'rgba(255,255,255,0.16)', hubRim: 'rgba(255,255,255,0.08)', h: 1 };

      p = new Path2D();
      addPoly(p, [[0.16, 0.019], [0, 0.026], [-0.62, 0.034], [-0.82, 0.021], [-0.945, 0]], D);
      addCircle(p, 0, 0.16 * D, 0.019 * D);
      addCircle(p, 0, 0, 0.052 * D);
      hs.minute = { path: p, color: '#141619', facet: FACET.ink, hub: 0.052 * D, hubLight: 'rgba(255,255,255,0.16)', hubRim: 'rgba(255,255,255,0.1)', h: 1.6 };

      p = new Path2D();
      addPoly(p, [[0.25, 0.0085], [0, 0.0085], [-0.955, 0.0035]], D);
      addCircle(p, 0, 0.18 * D, 0.042 * D);
      addCircle(p, 0, 0, 0.042 * D);
      hs.second = { path: p, color: '#c3161c', facet: FACET.red, hub: 0.042 * D, hubLight: 'rgba(255,190,180,0.3)', hubRim: 'rgba(60,0,0,0.35)', h: 2.3 };
    } else if (th.hands === 'breguet') {
      p = new Path2D();
      addPoly(p, [[0.09, 0.013], [0, 0.018], [-0.25, 0.012], [-0.3125, 0.011]], D);
      addRing(p, -0.36, 0.058, 0.037, D);
      addPoly(p, [[-0.4075, 0.018], [-0.47, 0.011], [-0.56, 0]], D);
      addCircle(p, 0, 0.09 * D, 0.018 * D);
      addCircle(p, 0, 0, 0.05 * D);
      hs.hour = { path: p, color: '#13224f', facet: FACET.blued, hub: 0.05 * D, hubLight: 'rgba(120,160,255,0.45)', hubRim: 'rgba(0,0,0,0.35)', h: 1 };

      p = new Path2D();
      addPoly(p, [[0.12, 0.011], [0, 0.014], [-0.4, 0.009], [-0.6255, 0.008]], D);
      addRing(p, -0.66, 0.042, 0.027, D);
      addPoly(p, [[-0.6945, 0.013], [-0.8, 0.0085], [-0.885, 0.005], [-0.94, 0]], D);
      addCircle(p, 0, 0.12 * D, 0.015 * D);
      addCircle(p, 0, 0, 0.042 * D);
      hs.minute = { path: p, color: '#13224f', facet: FACET.blued, hub: 0.042 * D, hubLight: 'rgba(120,160,255,0.45)', hubRim: 'rgba(0,0,0,0.35)', h: 1.6 };

      p = new Path2D();
      addPoly(p, [[0.1675, 0.0045], [0, 0.0055], [-0.952, 0.0018]], D);
      addRing(p, 0.19, 0.028, 0.017, D);
      addCircle(p, 0, 0, 0.03 * D);
      hs.second = { path: p, color: '#15254f', facet: FACET.blued, hub: 0.03 * D, hubLight: 'rgba(120,160,255,0.45)', hubRim: 'rgba(0,0,0,0.35)', h: 2.3 };
    } else {
      p = new Path2D();
      addBar(p, 0.027 * D, 0.085 * D, -0.54 * D);
      addCircle(p, 0, 0, 0.052 * D);
      hs.hour = { path: p, color: '#eceef0', facet: null, hub: 0.052 * D, hubLight: null, hubRim: 'rgba(0,0,0,0.28)', h: 1 };

      p = new Path2D();
      addBar(p, 0.018 * D, 0.11 * D, -0.91 * D);
      addCircle(p, 0, 0, 0.044 * D);
      hs.minute = { path: p, color: '#f3f4f5', facet: null, hub: 0.044 * D, hubLight: null, hubRim: 'rgba(0,0,0,0.28)', h: 1.6 };

      p = new Path2D();
      addPoly(p, [[0.24, 0.006], [-0.945, 0.004]], D);
      addBar(p, 0.013 * D, 0.24 * D, 0.12 * D);
      addCircle(p, 0, 0, 0.032 * D);
      hs.second = { path: p, color: '#ff6a1a', facet: FACET.red, hub: 0.032 * D, hubLight: 'rgba(255,220,190,0.35)', hubRim: 'rgba(90,20,0,0.35)', h: 2.3 };
    }
    return hs;
  }

  // ---------------------------------------------------------------- сборка слоёв
  function buildAll() {
    var th = THEMES[state.theme];
    var S = 2 * Math.ceil(R) + 4;
    var D = th.bezel.inner * R;
    L = {
      th: th, R: R, S: S, D: D,
      wall: buildWall(th),
      clock: buildClock(th, S, R, D),
      glass: buildGlass(th, S, D),
      glare: buildGlare(th, S, D),
      nut: buildNut(th, D),
      hands: buildHands(th, D)
    };
    needBuild = false;
  }

  // ---------------------------------------------------------------- кадр
  function drawHand(hd, ang, k) {
    var Dk = L.D * k, h = hd.h, hsA = L.th.handShadow;
    var ca = Math.cos(ang), sa = Math.sin(ang);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    if (k !== 1) ctx.scale(k, k);
    ctx.fillStyle = hd.color;
    // тени задаются в пикселях экрана (не зависят от поворота) — свет всегда сверху-слева
    ctx.shadowColor = 'rgba(0,0,0,' + (hsA * (1 - 0.1 * h)).toFixed(3) + ')';
    ctx.shadowBlur = (0.006 + 0.011 * h) * Dk;
    ctx.shadowOffsetX = 0.008 * h * Dk;
    ctx.shadowOffsetY = 0.011 * h * Dk;
    ctx.fill(hd.path);
    ctx.shadowColor = 'rgba(0,0,0,' + (hsA * 0.55).toFixed(3) + ')';
    ctx.shadowBlur = 0.004 * Dk + 1;
    ctx.shadowOffsetX = 0.0025 * h * Dk;
    ctx.shadowOffsetY = 0.0035 * h * Dk;
    ctx.fill(hd.path);
    ctx.shadowColor = 'rgba(0,0,0,0)';

    if (hd.facet) {                                     // две грани вдоль оси стрелки
      var b = (ca + sa) * SQ, f = hd.facet, big = L.D * 2;
      ctx.save();
      ctx.clip(hd.path);
      ctx.fillStyle = b >= 0 ? 'rgba(' + f.l + ',' + (b * f.kl).toFixed(3) + ')' : 'rgba(' + f.d + ',' + (-b * f.kd).toFixed(3) + ')';
      ctx.fillRect(-big, -big, big, big * 2);
      ctx.fillStyle = b >= 0 ? 'rgba(' + f.d + ',' + (b * f.kd).toFixed(3) + ')' : 'rgba(' + f.l + ',' + (-b * f.kl).toFixed(3) + ')';
      ctx.fillRect(0, -big, big, big * 2);
      ctx.restore();
    }
    if (hd.hub) {                                       // шайба-втулка
      var r = hd.hub;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fillStyle = hd.color;
      ctx.fill();
      if (hd.hubLight) {
        var lx = -SQ * ca - SQ * sa, ly = SQ * sa - SQ * ca;   // свет в локальных координатах
        var gr = ctx.createRadialGradient(lx * r * 0.5, ly * r * 0.5, 0, 0, 0, r);
        gr.addColorStop(0, hd.hubLight);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gr;
        ctx.fill();
      }
      ctx.lineWidth = Math.max(0.75, 0.0035 * L.D);
      ctx.strokeStyle = hd.hubRim;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawNut(k) {
    var n = L.nut, s = n.width * k, Dk = L.D * k, a = L.th.handShadow;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,' + (a * 0.85).toFixed(3) + ')';
    ctx.shadowBlur = 0.018 * Dk;
    ctx.shadowOffsetX = 0.012 * Dk;
    ctx.shadowOffsetY = 0.016 * Dk;
    ctx.drawImage(n, cx - s / 2, cy - s / 2, s, s);
    ctx.restore();
  }

  function drawGlass(k) {
    var S = L.S * k, x = cx - S / 2, y = cy - S / 2;
    ctx.drawImage(L.glass, x, y, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, L.D * k, 0, TAU);
    ctx.clip();
    var off = 0.028 * L.D * k;
    ctx.drawImage(L.glare, x + par.x * off, y + par.y * off, S, S);
    ctx.restore();
  }

  // затухающий «пружинный» отклик на скачок секунды: подъём ~40 мс, перелёт ~1°
  function springTick(t) {
    if (t >= 0.4) return 1;
    var wn = 85, z = 0.48, wd = wn * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * wn * t) * (Math.cos(wd * t) + (z * wn / wd) * Math.sin(wd * t));
  }

  var dateFmt = null;
  try { dateFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { dateFmt = null; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function updateMeta(now) {
    var date = dateFmt ? dateFmt.format(now) : now.toDateString();
    date = date.charAt(0).toUpperCase() + date.slice(1);
    var off = -now.getTimezoneOffset(), sign = off >= 0 ? '+' : '−', ao = Math.abs(off);
    var tz = 'UTC' + sign + Math.floor(ao / 60) + (ao % 60 ? ':' + pad2(ao % 60) : '');
    metaEl.textContent = date + ' · ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds()) + ' · ' + tz;
  }

  function checkResize(ts) {
    var d = Math.min(window.devicePixelRatio || 1, 2);
    if (window.innerWidth !== cssW || window.innerHeight !== cssH || d !== dpr) {
      layout();
      if (L) L.wall = buildWall(L.th);   // стена дешёвая — сразу; тяжёлые слои — после паузы ресайза
      needBuild = true;
      resizeAt = ts;
    }
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    var dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60;
    lastTs = ts;
    dt = clamp(dt, 0, 0.1);

    checkResize(ts);
    if (needBuild && (!L || ts - resizeAt > 140)) buildAll();

    // сглаживания по dt
    var target = state.sec === 'tick' ? 1 : 0;
    secBlend += (target - secBlend) * (1 - Math.exp(-dt * 7));
    if (Math.abs(target - secBlend) < 1e-3) secBlend = target;
    var e = 1 - Math.exp(-dt * 4);
    par.x += (par.tx - par.x) * e;
    par.y += (par.ty - par.y) * e;

    // реальное время
    var now = new Date();
    var ms = now.getMilliseconds(), s = now.getSeconds(), m = now.getMinutes(), h = now.getHours();
    var sf = s + ms / 1000;
    var mf = m + sf / 60;
    var hf = (h % 12) + mf / 60;
    var secUnits = mix(sf, s - 1 + springTick(ms / 1000), secBlend);
    var aH = hf / 12 * TAU, aM = mf / 60 * TAU, aS = secUnits / 60 * TAU;

    var k = R / L.R, S = L.S * k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(L.wall, 0, 0, W, H);
    ctx.drawImage(L.clock, cx - S / 2, cy - S / 2, S, S);
    drawHand(L.hands.hour, aH, k);
    drawHand(L.hands.minute, aM, k);
    drawHand(L.hands.second, aS, k);
    drawNut(k);
    drawGlass(k);

    if (fadeA > 0 && fadeCv) {                          // мягкая смена стиля
      var fa = fadeA * fadeA * (3 - 2 * fadeA);
      ctx.globalAlpha = fa;
      ctx.drawImage(fadeCv, 0, 0, W, H);
      ctx.globalAlpha = 1;
      fadeA = Math.max(0, fadeA - dt / 0.55);
    }

    if (s !== lastSec) { lastSec = s; updateMeta(now); }
  }

  // ---------------------------------------------------------------- управление
  function syncButtons() {
    var bs = panelEl.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      var on = b.dataset.theme ? b.dataset.theme === state.theme : b.dataset.sec === state.sec;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function setTheme(name) {
    if (!THEMES[name] || name === state.theme) return;
    if (!fadeCv || fadeCv.width !== W || fadeCv.height !== H) fadeCv = makeCanvas(W, H);
    var fg = fadeCv.getContext('2d');
    fg.clearRect(0, 0, W, H);
    fg.drawImage(canvas, 0, 0);
    fadeA = 1;
    state.theme = name;
    document.body.setAttribute('data-theme', name);
    subEl.textContent = THEMES[name].sub;
    syncButtons();
    buildAll();
  }

  function setSec(mode) {
    if (mode !== 'tick' && mode !== 'sweep') return;
    state.sec = mode;
    syncButtons();
  }

  panelEl.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('button') : null;
    if (!b) return;
    if (b.dataset.theme) setTheme(b.dataset.theme);
    if (b.dataset.sec) setSec(b.dataset.sec);
  });

  window.addEventListener('keydown', function (ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === '1') setTheme('classic');
    else if (ev.key === '2') setTheme('vintage');
    else if (ev.key === '3') setTheme('minimal');
    else if (ev.code === 'KeyS') setSec(state.sec === 'tick' ? 'sweep' : 'tick');
  });

  window.addEventListener('pointermove', function (ev) {
    if (!R) return;
    var rr = R / dpr;
    par.tx = clamp((ev.clientX - cx / dpr) / (rr * 1.6), -1, 1);
    par.ty = clamp((ev.clientY - cy / dpr) / (rr * 1.6), -1, 1);
  });
  function resetPar() { par.tx = 0; par.ty = 0; }
  document.documentElement.addEventListener('mouseleave', resetPar);
  window.addEventListener('blur', resetPar);

  // ---------------------------------------------------------------- старт
  document.body.setAttribute('data-theme', state.theme);
  subEl.textContent = THEMES[state.theme].sub;
  syncButtons();
  layout();
  buildAll();
  updateMeta(new Date());
  requestAnimationFrame(frame);
})();
