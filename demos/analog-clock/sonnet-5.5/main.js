/* Аналоговые часы — Claude Sonnet 5.5.
   Canvas 2D, без библиотек. Статичный слой (стена, корпус, циферблат) кэшируется
   в offscreen-canvas и перерисовывается только при ресайзе, смене стиля и смене даты;
   каждый кадр рисуются стрелки с мягкими тенями, ось-гайка и блики стекла. */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  // направление на источник света (экранные координаты: вверх и влево)
  var LX = -0.62, LY = -0.78;

  var SERIF = '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif';
  var SANS = '"Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, sans-serif';
  var ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  var DAYS = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  var MONTHS = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];

  /* ================= чистая логика (тестируется в node) ================= */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // Единичный скачок секундной стрелки: система 2-го порядка с недодемпфированием.
  // g — затухание, w — частота; перерегулирование exp(-pi*g/w) ~ 15 %, первый пик ~63 мс.
  function tickStep(t) {
    var g = 30, w = 50;
    return 1 - Math.exp(-g * t) * (Math.cos(w * t) + (g / w) * Math.sin(w * t));
  }

  // Угол секундной стрелки (градусы) в режиме тика: на границе секунды стрелка
  // «прыгает» на 6° с лёгким отскоком и замирает.
  function tickAngle(s) {
    var n = Math.floor(s);
    return (n - 1) * 6 + 6 * tickStep(s - n);
  }

  // Углы стрелок (градусы по часовой от 12 часов). s — дробные секунды.
  // Часовая учитывает минуты и секунды, минутная — секунды: движение непрерывное.
  function handAngles(h, m, s, tick) {
    return {
      hour: (((h % 12) * 3600 + m * 60 + s) / 43200) * 360,
      minute: ((m * 60 + s) / 3600) * 360,
      second: tick ? tickAngle(s) : s * 6
    };
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hex2rgb(h) {
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    var A = hex2rgb(a), B = hex2rgb(b);
    return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * t) + ',' +
      Math.round(A[1] + (B[1] - A[1]) * t) + ',' +
      Math.round(A[2] + (B[2] - A[2]) * t) + ')';
  }

  // Полуширина профиля стрелки на расстоянии d от оси (линейная интерполяция).
  function halfWidthAt(prof, d) {
    for (var i = 0; i < prof.length - 1; i++) {
      var d0 = prof[i][0], d1 = prof[i + 1][0];
      if (d >= d0 && d <= d1) {
        var k = d1 === d0 ? 0 : (d - d0) / (d1 - d0);
        return prof[i][1] + (prof[i + 1][1] - prof[i][1]) * k;
      }
    }
    return 0;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /* ======================= стили (палитры) ======================= */

  var STEEL = ['#cfd4da', '#7d848c', '#aeb4bb', '#f5f7f9', '#9aa1a9', '#656b73', '#b6bbc2', '#fbfcfd'];
  var BRASS = ['#d9b66a', '#8a6422', '#c19a4b', '#f6dd9a', '#a67c31', '#6e4d17', '#c8a25a', '#fbe8b3'];
  var GRAPH = ['#5a5e66', '#2a2c31', '#41444b', '#8b909a', '#3a3d43', '#1b1c20', '#4a4d54', '#9aa0aa'];

  // Профиль стрелки: [d, w] — d вдоль стрелки от оси (минус = хвост), w — полуширина; всё в долях R.
  var THEMES = {
    classic: {
      wall: ['#d8d2c5', '#8a8474'], grain: 0.32,
      metal: STEEL,
      dial: ['#fdfaf2', '#e5ddc9'], dialEdge: 0.13, patina: 0,
      ink: '#18181b', brand: '#2d2d31', dateBg: '#fffef9', dateInk: '#1d1d20',
      font: SERIF, numerals: 'arabic', numWeight: 'normal', numSize: 0.155, numRadius: 0.635,
      brandFont: SERIF, brandWeight: 'bold',
      ticks: { rOut: 0.855, rMin: 0.82, rHour: 0.775, wMin: 0.0055, wHour: 0.02, trackOut: true, trackIn: false },
      hour: { profile: [[-0.14, 0.020], [0.0, 0.034], [0.10, 0.038], [0.52, 0]], light: '#5a5b61', dark: '#0e0e11' },
      minute: { profile: [[-0.16, 0.014], [0.0, 0.024], [0.10, 0.027], [0.80, 0]], light: '#5a5b61', dark: '#0e0e11' },
      second: { color: '#d0271c', disc: null },
      nut: { light: '#f4f6f8', dark: '#656b73' }
    },
    vintage: {
      wall: ['#46665b', '#1b2a26'], grain: 0.38,
      metal: BRASS,
      dial: ['#f4e8c8', '#d6c294'], dialEdge: 0.28, patina: 420,
      ink: '#2a1b10', brand: '#3b2818', dateBg: '#f8efd6', dateInk: '#2a1b10',
      font: SERIF, numerals: 'roman', numWeight: 'bold', numSize: 0.105, numRadius: 0.64,
      brandFont: SERIF, brandWeight: 'bold',
      ticks: { rOut: 0.855, rMin: 0.82, rHour: 0.775, wMin: 0.0042, wHour: 0.016, trackOut: true, trackIn: true },
      hour: { profile: [[-0.14, 0.016], [0.0, 0.018], [0.15, 0.018], [0.24, 0.050], [0.34, 0.056], [0.52, 0]], light: '#6a5240', dark: '#140d08' },
      minute: { profile: [[-0.16, 0.010], [0.0, 0.013], [0.50, 0.013], [0.58, 0.032], [0.80, 0]], light: '#6a5240', dark: '#140d08' },
      second: { color: '#a31e15', disc: null },
      nut: { light: '#f6dd9a', dark: '#6e4d17' }
    },
    graphite: {
      wall: ['#363a42', '#0f1013'], grain: 0.4,
      metal: GRAPH,
      dial: ['#202227', '#0e0f11'], dialEdge: 0.28, patina: 0,
      ink: '#eeeeea', brand: '#8f949c', dateBg: '#08090a', dateInk: '#e8e8e4',
      font: SANS, numerals: 'arabic', numWeight: '500', numSize: 0.12, numRadius: 0.645,
      brandFont: SANS, brandWeight: 'bold',
      ticks: { rOut: 0.86, rMin: 0.83, rHour: 0.76, wMin: 0.005, wHour: 0.026, trackOut: false, trackIn: false },
      hour: { profile: [[-0.12, 0.026], [0.46, 0.026], [0.54, 0]], light: '#d4d8dd', dark: '#7d838b', inset: { from: 0.08, to: 0.47, k: 0.5 } },
      minute: { profile: [[-0.14, 0.018], [0.74, 0.018], [0.83, 0]], light: '#d4d8dd', dark: '#7d838b', inset: { from: 0.08, to: 0.75, k: 0.5 } },
      second: { color: '#ff6b1a', disc: { d: 0.66, r: 0.03 } },
      nut: { light: '#a9afb8', dark: '#2c2f35' },
      lume: '#dff5c6'
    }
  };

  var NEEDLE = [[-0.08, 0.0055], [0.0, 0.0055], [0.88, 0.0022], [0.90, 0]];

  // Тени стрелок: чем выше стрелка над циферблатом — тем длиннее и мягче тень.
  var SHADOW = {
    hour: { soft: { dx: 0.014, dy: 0.022, blur: 0.030, a: 0.30 }, tight: { dx: 0.004, dy: 0.007, blur: 0.008, a: 0.36 } },
    minute: { soft: { dx: 0.022, dy: 0.034, blur: 0.040, a: 0.28 }, tight: { dx: 0.006, dy: 0.010, blur: 0.010, a: 0.30 } },
    second: { soft: { dx: 0.034, dy: 0.052, blur: 0.050, a: 0.24 }, tight: { dx: 0.010, dy: 0.016, blur: 0.014, a: 0.26 } },
    nut: { soft: { dx: 0.012, dy: 0.018, blur: 0.020, a: 0.45 } }
  };

  /* ======================= примитивы рисования ======================= */

  function castShadow(c, g, s) {
    c.shadowColor = 'rgba(0,0,0,' + s.a + ')';
    c.shadowOffsetX = s.dx * g.R * g.dpr;   // смещение и размытие теней не зависят от
    c.shadowOffsetY = s.dy * g.R * g.dpr;   // трансформации, поэтому пересчитываем в device px
    c.shadowBlur = s.blur * g.R * g.dpr;
  }

  function noShadow(c) {
    c.shadowColor = 'rgba(0,0,0,0)';
    c.shadowBlur = 0;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 0;
  }

  function circlePath(c, x, y, r) {
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
  }

  // Кольцо r0..r1 (внутренний контур — обратным обходом, чтобы получилась дыра).
  function annulusPath(c, x, y, r0, r1) {
    c.beginPath();
    c.moveTo(x + r1, y);
    c.arc(x, y, r1, 0, TAU);
    c.moveTo(x + r0, y);
    c.arc(x, y, r0, 0, TAU, true);
  }

  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // Металл: коническый градиент с чередованием бликов и теней.
  function metalGradient(c, cx, cy, R, stops, rotate) {
    var n = stops.length, i, grad;
    if (typeof c.createConicGradient === 'function') {
      grad = c.createConicGradient(-Math.PI / 2 + rotate, cx, cy);
      for (i = 0; i < n; i++) grad.addColorStop(i / n, stops[i]);
      grad.addColorStop(1, stops[0]);
    } else {
      grad = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      grad.addColorStop(0, stops[7]);
      grad.addColorStop(0.5, stops[2]);
      grad.addColorStop(1, stops[3]);
    }
    return grad;
  }

  // Текст с трекингом, центрированный по ширине; baseline считаем от высоты прописных.
  function spacedText(c, txt, cx, cy, spacing, size) {
    var widths = [], total = 0, i;
    for (i = 0; i < txt.length; i++) {
      var w = c.measureText(txt.charAt(i)).width;
      widths.push(w);
      total += w;
    }
    total += spacing * (txt.length - 1);
    var x = cx - total / 2;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    for (i = 0; i < txt.length; i++) {
      c.fillText(txt.charAt(i), x, cy + size * 0.35);
      x += widths[i] + spacing;
    }
  }

  var noiseTile = null;
  function getNoise() {
    if (noiseTile) return noiseTile;
    var size = 160, cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var x = cv.getContext('2d');
    var img = x.createImageData(size, size), rnd = mulberry32(5), i;
    for (i = 0; i < size * size; i++) {
      var v = 128 + Math.round((rnd() - 0.5) * 110);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    noiseTile = cv;
    return cv;
  }

  /* ======================= статичный слой ======================= */

  function drawWall(c, g, th) {
    var w = g.w, h = g.h, i;
    var gr = c.createRadialGradient(w * 0.42, h * 0.34, 0, w * 0.5, h * 0.5, Math.sqrt(w * w + h * h) * 0.62);
    gr.addColorStop(0, th.wall[0]);
    gr.addColorStop(1, th.wall[1]);
    c.fillStyle = gr;
    c.fillRect(0, 0, w, h);

    // мягкие пятна — неровная окраска штукатурки
    var rnd = mulberry32(11);
    for (i = 0; i < 70; i++) {
      var x = rnd() * w, y = rnd() * h, r = 60 + rnd() * 220, light = rnd() < 0.5;
      var bl = c.createRadialGradient(x, y, 0, x, y, r);
      bl.addColorStop(0, light ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)');
      bl.addColorStop(1, light ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0)');
      c.fillStyle = bl;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // зерно
    c.save();
    c.globalCompositeOperation = 'overlay';
    c.globalAlpha = th.grain;
    c.fillStyle = c.createPattern(getNoise(), 'repeat');
    c.fillRect(0, 0, w, h);
    c.restore();
  }

  function drawWallShadow(c, g) {
    var R = g.R;
    c.save();
    c.fillStyle = '#000';
    castShadow(c, g, { dx: 0.05, dy: 0.09, blur: 0.17, a: 0.5 });
    circlePath(c, g.cx, g.cy, R);
    c.fill();
    castShadow(c, g, { dx: 0.012, dy: 0.02, blur: 0.026, a: 0.55 });
    circlePath(c, g.cx, g.cy, R);
    c.fill();
    c.restore();
  }

  function drawBezel(c, g, th) {
    var cx = g.cx, cy = g.cy, R = g.R, i;

    // литое кольцо корпуса
    circlePath(c, cx, cy, R);
    c.fillStyle = metalGradient(c, cx, cy, R, th.metal, 0);
    c.fill();

    // шлифовка — концентрические волоски
    c.save();
    annulusPath(c, cx, cy, R * 0.905, R * 0.996);
    c.clip();
    var rnd = mulberry32(7);
    for (i = 0; i < 180; i++) {
      var r = R * (0.905 + rnd() * 0.09), a = rnd();
      c.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,' + (a * 0.17).toFixed(3) + ')' : 'rgba(0,0,0,' + (a * 0.15).toFixed(3) + ')';
      c.lineWidth = 0.4 + rnd() * 0.8;
      circlePath(c, cx, cy, r);
      c.stroke();
    }
    c.restore();

    // выпуклый профиль обода: тень у кромок, блик посередине
    annulusPath(c, cx, cy, R * 0.905, R * 0.996);
    var tor = c.createRadialGradient(cx, cy, R * 0.905, cx, cy, R * 0.996);
    tor.addColorStop(0, 'rgba(0,0,0,0.32)');
    tor.addColorStop(0.22, 'rgba(0,0,0,0)');
    tor.addColorStop(0.55, 'rgba(255,255,255,0.17)');
    tor.addColorStop(0.82, 'rgba(0,0,0,0)');
    tor.addColorStop(1, 'rgba(0,0,0,0.34)');
    c.fillStyle = tor;
    c.fill();

    // внешняя фаска: светлая нить и тёмная кромка
    c.lineWidth = Math.max(1, R * 0.005);
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    circlePath(c, cx, cy, R * 0.99);
    c.stroke();
    c.lineWidth = Math.max(1, R * 0.004);
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    circlePath(c, cx, cy, R - c.lineWidth / 2);
    c.stroke();

    // внутренняя стенка (освещена с противоположной стороны) и посадочная канавка под стекло
    annulusPath(c, cx, cy, R * 0.878, R * 0.905);
    c.fillStyle = metalGradient(c, cx, cy, R, th.metal, Math.PI);
    c.fill();
    annulusPath(c, cx, cy, R * 0.878, R * 0.905);
    c.fillStyle = 'rgba(0,0,0,0.38)';
    c.fill();
    c.lineWidth = Math.max(1, R * 0.003);
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    circlePath(c, cx, cy, R * 0.905);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    circlePath(c, cx, cy, R * 0.9);
    c.stroke();
  }

  function drawPatina(c, g, th) {
    var rnd = mulberry32(23), R = g.R, rd = R * 0.885, i;
    c.save();
    circlePath(c, g.cx, g.cy, rd);
    c.clip();
    for (i = 0; i < 8; i++) {
      var a = rnd() * TAU, rr = Math.sqrt(rnd()) * rd * 0.9;
      var x = g.cx + Math.cos(a) * rr, y = g.cy + Math.sin(a) * rr, r = R * (0.12 + rnd() * 0.25);
      var bl = c.createRadialGradient(x, y, 0, x, y, r);
      bl.addColorStop(0, 'rgba(140,100,40,0.07)');
      bl.addColorStop(1, 'rgba(140,100,40,0)');
      c.fillStyle = bl;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (i = 0; i < th.patina; i++) {
      var b = rnd() * TAU, q = Math.sqrt(rnd()) * rd * 0.98;
      c.fillStyle = 'rgba(100,70,30,' + (0.04 + rnd() * 0.1).toFixed(3) + ')';
      circlePath(c, g.cx + Math.cos(b) * q, g.cy + Math.sin(b) * q, 0.3 + rnd() * 0.9);
      c.fill();
    }
    c.restore();
  }

  function drawTicks(c, g, th) {
    var R = g.R, tk = th.ticks, i;
    c.save();
    c.translate(g.cx, g.cy);
    c.strokeStyle = th.ink;
    c.lineCap = 'butt';
    if (tk.trackOut) {
      c.lineWidth = R * 0.0045;
      circlePath(c, 0, 0, R * tk.rOut);
      c.stroke();
    }
    if (tk.trackIn) {
      c.lineWidth = R * 0.0045;
      circlePath(c, 0, 0, R * tk.rMin);
      c.stroke();
    }
    for (i = 0; i < 60; i++) {
      var a = i * TAU / 60, sx = Math.sin(a), sy = -Math.cos(a);
      var hour = i % 5 === 0;
      var r0 = R * (hour ? tk.rHour : tk.rMin), r1 = R * tk.rOut;
      c.lineWidth = R * (hour ? tk.wHour : tk.wMin);
      c.beginPath();
      c.moveTo(sx * r0, sy * r0);
      c.lineTo(sx * r1, sy * r1);
      c.stroke();
    }
    c.restore();
  }

  function drawNumerals(c, g, th) {
    var R = g.R, size = R * th.numSize, n;
    c.font = th.numWeight + ' ' + size.toFixed(2) + 'px ' + th.font;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = th.ink;
    for (n = 1; n <= 12; n++) {
      var txt = th.numerals === 'roman' ? ROMAN[n - 1] : String(n);
      var a = n * TAU / 12;
      var x = g.cx + Math.sin(a) * R * th.numRadius;
      var y = g.cy - Math.cos(a) * R * th.numRadius;
      var m = c.measureText(txt);
      var abl = m.actualBoundingBoxLeft, abr = m.actualBoundingBoxRight;
      var asc = m.actualBoundingBoxAscent, dsc = m.actualBoundingBoxDescent;
      if (typeof abl !== 'number') { abl = 0; abr = m.width; asc = size * 0.7; dsc = 0; }
      // центрируем по фактическому «чернильному» прямоугольнику глифов
      c.fillText(txt, x - (abr - abl) / 2, y + (asc - dsc) / 2);
    }
  }

  function drawBrand(c, g, th) {
    var R = g.R;
    c.fillStyle = th.brand;
    var s1 = R * 0.056;
    c.font = th.brandWeight + ' ' + s1.toFixed(2) + 'px ' + th.brandFont;
    spacedText(c, 'SONNET', g.cx, g.cy - R * 0.30, R * 0.026, s1);
    var s2 = R * 0.027;
    c.font = 'normal ' + s2.toFixed(2) + 'px ' + th.brandFont;
    spacedText(c, 'CLAUDE  ·  5.5', g.cx, g.cy - R * 0.225, R * 0.013, s2);
  }

  function drawDateWindow(c, g, th, d) {
    var R = g.R, w = R * 0.30, h = R * 0.082;
    var x = g.cx - w / 2, y = g.cy + R * 0.30 - h / 2;
    roundRectPath(c, x, y, w, h, R * 0.012);
    c.fillStyle = th.dateBg;
    c.fill();
    // «утопленность» окошка
    var sh = c.createLinearGradient(0, y, 0, y + h);
    sh.addColorStop(0, 'rgba(0,0,0,0.22)');
    sh.addColorStop(0.45, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(255,255,255,0.08)');
    roundRectPath(c, x, y, w, h, R * 0.012);
    c.fillStyle = sh;
    c.fill();
    c.lineWidth = Math.max(0.8, R * 0.0035);
    c.strokeStyle = th.ink;
    roundRectPath(c, x, y, w, h, R * 0.012);
    c.stroke();
    var size = R * 0.05;
    c.font = 'bold ' + size.toFixed(2) + 'px ' + th.brandFont;
    c.fillStyle = th.dateInk;
    spacedText(c, DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()], g.cx, y + h / 2, R * 0.006, size);
  }

  function drawDial(c, g, th, d) {
    var cx = g.cx, cy = g.cy, R = g.R, rd = R * 0.885;

    // эмаль
    var gr = c.createRadialGradient(cx - R * 0.16, cy - R * 0.2, 0, cx, cy, rd);
    gr.addColorStop(0, th.dial[0]);
    gr.addColorStop(1, th.dial[1]);
    circlePath(c, cx, cy, rd);
    c.fillStyle = gr;
    c.fill();

    if (th.patina) drawPatina(c, g, th);

    // печать: деления, цифры, надписи, окошко даты
    drawTicks(c, g, th);
    drawNumerals(c, g, th);
    drawBrand(c, g, th);
    drawDateWindow(c, g, th, d);

    // циферблат утоплен в корпус: общее затемнение к краю
    var eg = c.createRadialGradient(cx, cy, rd * 0.78, cx, cy, rd);
    eg.addColorStop(0, 'rgba(0,0,0,0)');
    eg.addColorStop(1, 'rgba(0,0,0,' + th.dialEdge + ')');
    circlePath(c, cx, cy, rd);
    c.fillStyle = eg;
    c.fill();

    // внутренняя тень от обода: свет сверху-слева, поэтому тень ложится сверху-слева
    c.save();
    circlePath(c, cx, cy, rd);
    c.clip();
    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = R * 0.07 * g.dpr;
    c.shadowOffsetX = R * 0.02 * g.dpr;
    c.shadowOffsetY = R * 0.03 * g.dpr;
    c.beginPath();
    c.rect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
    c.moveTo(cx + rd, cy);
    c.arc(cx, cy, rd, 0, TAU, true);
    c.fillStyle = '#000';
    c.fill();
    c.restore();
  }

  /* ======================= динамический слой ======================= */

  function silhouetteSub(c, prof, R) {
    var i, n = prof.length;
    c.moveTo(prof[0][1] * R, -prof[0][0] * R);
    for (i = 1; i < n; i++) c.lineTo(prof[i][1] * R, -prof[i][0] * R);
    for (i = n - 1; i >= 0; i--) c.lineTo(-prof[i][1] * R, -prof[i][0] * R);
    c.closePath();
  }

  function facetPath(c, prof, R, side) {
    var i, n = prof.length;
    c.beginPath();
    c.moveTo(0, -prof[0][0] * R);
    for (i = 0; i < n; i++) c.lineTo(side * prof[i][1] * R, -prof[i][0] * R);
    c.lineTo(0, -prof[n - 1][0] * R);
    c.closePath();
  }

  function rectSub(c, x0, x1, y0, y1) {
    // обход против часовой на экране — как у силуэта иглы, чтобы пересечения не давали дыр
    c.moveTo(x1, y1);
    c.lineTo(x1, y0);
    c.lineTo(x0, y0);
    c.lineTo(x0, y1);
    c.closePath();
  }

  // Часовая и минутная: двухгранные («дофин») стрелки. Яркость граней зависит от
  // ориентации стрелки относительно источника света, поэтому блики бегут при вращении.
  function drawHand(c, g, th, spec, deg, sh) {
    var R = g.R, rad = deg * Math.PI / 180, prof = spec.profile;
    var dot = Math.cos(rad) * LX + Math.sin(rad) * LY;   // нормаль правой грани · свет
    var tR = clamp(0.5 + 0.6 * dot, 0, 1), tL = clamp(0.5 - 0.6 * dot, 0, 1);

    c.save();
    c.translate(g.cx, g.cy);
    c.rotate(rad);

    // тень: заливаем непрозрачный силуэт, чтобы граням не удваивать тень
    c.fillStyle = spec.dark;
    c.beginPath(); silhouetteSub(c, prof, R);
    castShadow(c, g, sh.soft);
    c.fill();
    c.beginPath(); silhouetteSub(c, prof, R);
    castShadow(c, g, sh.tight);
    c.fill();
    noShadow(c);

    facetPath(c, prof, R, 1);
    c.fillStyle = mix(spec.dark, spec.light, tR);
    c.fill();
    facetPath(c, prof, R, -1);
    c.fillStyle = mix(spec.dark, spec.light, tL);
    c.fill();

    // светящаяся вставка (люм) — у стиля «Графит»
    if (spec.inset && th.lume) {
      var k = spec.inset, steps = 14, i, d, w;
      c.beginPath();
      for (i = 0; i <= steps; i++) {
        d = k.from + (k.to - k.from) * i / steps;
        w = halfWidthAt(prof, d) * k.k;
        if (i === 0) c.moveTo(w * R, -d * R); else c.lineTo(w * R, -d * R);
      }
      for (i = steps; i >= 0; i--) {
        d = k.from + (k.to - k.from) * i / steps;
        w = halfWidthAt(prof, d) * k.k;
        c.lineTo(-w * R, -d * R);
      }
      c.closePath();
      c.fillStyle = th.lume;
      c.fill();
    }

    // тонкий контур для чёткости силуэта
    c.beginPath(); silhouetteSub(c, prof, R);
    c.lineWidth = 0.6;
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(0,0,0,0.38)';
    c.stroke();
    c.restore();
  }

  function secondPath(c, sp, R) {
    c.beginPath();
    silhouetteSub(c, NEEDLE, R);
    rectSub(c, -0.013 * R, 0.013 * R, 0.07 * R, 0.27 * R);   // противовес на хвосте
    if (sp.disc) {
      var y = -sp.disc.d * R, r = sp.disc.r * R;
      c.moveTo(r, y);
      c.arc(0, y, r, 0, TAU, true);
    }
  }

  function drawSecond(c, g, th, deg) {
    var R = g.R, sp = th.second;
    c.save();
    c.translate(g.cx, g.cy);
    c.rotate(deg * Math.PI / 180);
    c.fillStyle = sp.color;
    secondPath(c, sp, R);
    castShadow(c, g, SHADOW.second.soft);
    c.fill();
    secondPath(c, sp, R);
    castShadow(c, g, SHADOW.second.tight);
    c.fill();
    noShadow(c);
    c.restore();
  }

  // Ось-гайка: шайба, шестигранная гайка (грани по свету) и выпуклый колпачок.
  function drawNut(c, g, th) {
    var R = g.R, k;
    c.save();
    c.translate(g.cx, g.cy);

    var wr = R * 0.056;
    var wg = c.createRadialGradient(-R * 0.02, -R * 0.02, R * 0.005, 0, 0, wr);
    wg.addColorStop(0, mix(th.nut.light, '#ffffff', 0.3));
    wg.addColorStop(1, th.nut.dark);
    castShadow(c, g, SHADOW.nut.soft);
    circlePath(c, 0, 0, wr);
    c.fillStyle = wg;
    c.fill();
    noShadow(c);
    c.lineWidth = Math.max(0.6, R * 0.0025);
    c.strokeStyle = 'rgba(0,0,0,0.38)';
    c.stroke();

    var hr = R * 0.042;
    for (k = 0; k < 6; k++) {
      var a0 = k * Math.PI / 3 + Math.PI / 6, a1 = a0 + Math.PI / 3, m = (a0 + a1) / 2;
      var t = clamp(0.5 + 0.55 * (Math.cos(m) * LX + Math.sin(m) * LY), 0, 1);
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(a0) * hr, Math.sin(a0) * hr);
      c.lineTo(Math.cos(a1) * hr, Math.sin(a1) * hr);
      c.closePath();
      c.fillStyle = mix(th.nut.dark, th.nut.light, t);
      c.fill();
      c.lineWidth = 0.5;
      c.strokeStyle = c.fillStyle;
      c.stroke();
    }
    c.beginPath();
    for (k = 0; k < 6; k++) {
      var a = k * Math.PI / 3 + Math.PI / 6;
      if (k === 0) c.moveTo(Math.cos(a) * hr, Math.sin(a) * hr); else c.lineTo(Math.cos(a) * hr, Math.sin(a) * hr);
    }
    c.closePath();
    c.lineWidth = Math.max(0.6, R * 0.0022);
    c.strokeStyle = 'rgba(0,0,0,0.4)';
    c.stroke();

    var col = th.second.color, cr = R * 0.026;
    var cg = c.createRadialGradient(-cr * 0.4, -cr * 0.45, cr * 0.1, 0, 0, cr * 1.1);
    cg.addColorStop(0, mix(col, '#ffffff', 0.55));
    cg.addColorStop(0.5, col);
    cg.addColorStop(1, mix(col, '#000000', 0.5));
    circlePath(c, 0, 0, cr);
    c.fillStyle = cg;
    c.fill();
    c.lineWidth = 0.6;
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.stroke();
    circlePath(c, -cr * 0.35, -cr * 0.4, cr * 0.2);
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.fill();
    c.restore();
  }

  // Полумесяц: область круга (x,y,r) минус такой же круг, сдвинутый на (dx,dy).
  function crescent(c, x, y, r, dx, dy, fill) {
    c.save();
    circlePath(c, x, y, r);
    c.clip();
    c.beginPath();
    c.rect(x - r * 1.5, y - r * 1.5, r * 3, r * 3);
    c.moveTo(x + dx + r, y + dy);
    c.arc(x + dx, y + dy, r, 0, TAU, true);
    c.fillStyle = fill;
    c.fill();
    c.restore();
  }

  // Стекло: купол, два полумесяца-отражения и диагональная полоса «окна».
  // gx, gy в [-1..1] смещают блики вслед за указателем (параллакс).
  function drawGlass(c, g, gx, gy) {
    var cx = g.cx, cy = g.cy, R = g.R, rd = R * 0.885;
    var ox = gx * R * 0.07, oy = gy * R * 0.06;

    c.save();
    circlePath(c, cx, cy, rd);
    c.clip();

    var hx = cx - R * 0.36 + ox, hy = cy - R * 0.40 + oy;
    var dome = c.createRadialGradient(hx, hy, 0, hx, hy, R * 1.05);
    dome.addColorStop(0, 'rgba(255,255,255,0.20)');
    dome.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    dome.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = dome;
    c.fillRect(cx - rd, cy - rd, rd * 2, rd * 2);

    var g1 = c.createLinearGradient(cx - R * 0.62 + ox, cy - R * 0.7 + oy, cx - R * 0.05, cy - R * 0.05);
    g1.addColorStop(0, 'rgba(255,255,255,0.46)');
    g1.addColorStop(1, 'rgba(255,255,255,0)');
    crescent(c, cx + ox * 0.5, cy + oy * 0.5, rd * 0.94, R * 0.05, R * 0.066, g1);

    var g2 = c.createLinearGradient(cx + R * 0.6 - ox, cy + R * 0.7 - oy, cx + R * 0.05, cy + R * 0.05);
    g2.addColorStop(0, 'rgba(255,255,255,0.15)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    crescent(c, cx - ox * 0.5, cy - oy * 0.5, rd * 0.94, -R * 0.04, -R * 0.05, g2);

    c.save();
    c.translate(cx + ox * 1.5, cy + oy * 1.5);
    c.rotate(-0.62);
    var bg = c.createLinearGradient(0, -R * 0.78, 0, -R * 0.12);
    bg.addColorStop(0, 'rgba(255,255,255,0)');
    bg.addColorStop(0.55, 'rgba(255,255,255,0.07)');
    bg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = bg;
    c.fillRect(-R, -R * 0.78, R * 2, R * 0.66);
    c.restore();

    c.restore();

    c.lineWidth = Math.max(1, R * 0.004);
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    circlePath(c, cx, cy, rd - c.lineWidth / 2);
    c.stroke();
  }

  /* ======================= приложение ======================= */

  function init() {
    var canvas = document.getElementById('clock');
    var ctx = canvas.getContext('2d');
    var layer = document.createElement('canvas');
    var lctx = layer.getContext('2d');
    var hudTime = document.getElementById('hud-time');
    var hudDate = document.getElementById('hud-date');
    var panel = document.querySelector('.panel');

    var state = { tick: true, theme: 'classic' };
    var geo = { w: 0, h: 0, dpr: 1, cx: 0, cy: 0, R: 100 };
    var dirty = true, builtDay = -1, lastSec = -1, lastDay = -1;
    var ptx = 0, pty = 0, ptAt = -1e9, gx = 0, gy = 0, lastTs = 0;

    // необязательные параметры в адресе: ?theme=vintage&second=sweep
    var q = '';
    try { q = (window.location.search || '') + '&' + (window.location.hash || '').replace(/^#/, ''); } catch (e) { q = ''; }
    var mt = /[?&]theme=(classic|vintage|graphite)\b/.exec(q);
    if (mt) state.theme = mt[1];
    var ms = /[?&]second=(tick|sweep)\b/.exec(q);
    if (ms) state.tick = ms[1] === 'tick';

    function syncUi() {
      document.documentElement.setAttribute('data-theme', state.theme);
      var btns = panel ? panel.querySelectorAll('button') : [], i;
      for (i = 0; i < btns.length; i++) {
        var b = btns[i], grp = b.parentNode.getAttribute('data-group'), val = b.getAttribute('data-value');
        var on = grp === 'theme' ? val === state.theme : (val === 'tick') === state.tick;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    function resize() {
      var w = Math.max(1, window.innerWidth || 1), h = Math.max(1, window.innerHeight || 1);
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      if (w === geo.w && h === geo.h && dpr === geo.dpr) return;
      geo.w = w; geo.h = h; geo.dpr = dpr;
      canvas.width = layer.width = Math.max(1, Math.round(w * dpr));
      canvas.height = layer.height = Math.max(1, Math.round(h * dpr));
      var reserve = w < 560 ? 124 : 84;   // место под HUD сверху и панель снизу
      var m = Math.min(w, h);
      var R = Math.min(w / 2 - 16, h / 2 - reserve);
      R = Math.min(Math.max(R, m * 0.34), m * 0.48);
      geo.R = R; geo.cx = w / 2; geo.cy = h / 2;
      dirty = true;
    }

    function dayKey(d) { return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate(); }

    function buildStatic(d) {
      var th = THEMES[state.theme];
      lctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
      lctx.clearRect(0, 0, geo.w, geo.h);
      drawWall(lctx, geo, th);
      drawWallShadow(lctx, geo);
      drawBezel(lctx, geo, th);
      drawDial(lctx, geo, th, d);
      builtDay = dayKey(d);
      dirty = false;
    }

    function updateHud(d) {
      var s = d.getSeconds();
      if (s !== lastSec) {
        lastSec = s;
        hudTime.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(s);
      }
      var dk = dayKey(d);
      if (dk !== lastDay) {
        lastDay = dk;
        var txt = '';
        try { txt = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { txt = ''; }
        hudDate.textContent = txt;
      }
    }

    function frame(ts) {
      window.requestAnimationFrame(frame);
      var dt = lastTs ? Math.min(0.05, Math.max(0, (ts - lastTs) / 1000)) : 0.016;
      lastTs = ts;

      resize();
      var d = new Date();
      if (dirty || dayKey(d) !== builtDay) buildStatic(d);

      // блики стекла плавно следуют за указателем, в покое — лёгкий дрейф
      var t = ts / 1000, active = ts - ptAt < 6000;
      var tx = active ? ptx : 0.35 * Math.sin(t * 0.35);
      var ty = active ? pty : 0.25 * Math.cos(t * 0.27);
      var k = 1 - Math.exp(-dt * 5);
      gx += (tx - gx) * k;
      gy += (ty - gy) * k;

      var th = THEMES[state.theme];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
      ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);

      var s = d.getSeconds() + d.getMilliseconds() / 1000;
      var a = handAngles(d.getHours(), d.getMinutes(), s, state.tick);
      drawHand(ctx, geo, th, th.hour, a.hour, SHADOW.hour);
      drawHand(ctx, geo, th, th.minute, a.minute, SHADOW.minute);
      drawSecond(ctx, geo, th, a.second);
      drawNut(ctx, geo, th);
      drawGlass(ctx, geo, gx, gy);

      updateHud(d);
    }

    window.addEventListener('pointermove', function (e) {
      ptx = clamp((e.clientX / geo.w - 0.5) * 2, -1, 1);
      pty = clamp((e.clientY / geo.h - 0.5) * 2, -1, 1);
      ptAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }, { passive: true });

    if (panel) {
      panel.addEventListener('click', function (e) {
        var b = e.target;
        while (b && b !== panel && b.tagName !== 'BUTTON') b = b.parentNode;
        if (!b || b === panel) return;
        var grp = b.parentNode.getAttribute('data-group'), val = b.getAttribute('data-value');
        if (grp === 'second') state.tick = val === 'tick';
        else if (grp === 'theme' && THEMES[val]) { state.theme = val; dirty = true; }
        syncUi();
      });
    }

    syncUi();
    resize();
    window.requestAnimationFrame(frame);
  }

  var api = { tickStep: tickStep, tickAngle: tickAngle, handAngles: handAngles, halfWidthAt: halfWidthAt, mix: mix };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && typeof window !== 'undefined') init();
})();
