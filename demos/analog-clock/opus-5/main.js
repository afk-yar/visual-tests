/* Настенные часы — Canvas 2D, без библиотек. Claude Opus 5. */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  /* ================= чистая математика времени =================
     Углы в радианах, 0 = «12 часов», рост по часовой стрелке.
     Часовая учитывает минуты/секунды, минутная — секунды/миллисекунды.
     mode: 'sweep' — непрерывный ход секундной, 'tick' — механический
     скачок раз в секунду с лёгким отскоком (easeOutBack).            */
  function timeAngles(now, mode) {
    var ms = now.getMilliseconds();
    var sec = now.getSeconds() + ms / 1000;         // 0..60
    var min = now.getMinutes() + sec / 60;          // 0..60
    var hr = (now.getHours() % 12) + min / 60;      // 0..12

    var secondAngle;
    if (mode === 'tick') {
      var whole = Math.floor(sec);
      var frac = sec - whole;
      var dur = 0.11;                                // длительность скачка, с
      var p = frac >= dur ? 1 : frac / dur;
      var c = 1.9;                                   // сила отскока
      var q = p - 1;
      var e = 1 + (c + 1) * q * q * q + c * q * q;   // easeOutBack: e(0)=0, e(1)=1
      secondAngle = (whole + (e - 1)) * TAU / 60;    // в начале секунды — ещё на прошлом делении
    } else {
      secondAngle = sec * TAU / 60;
    }

    return {
      hour: hr * TAU / 12,
      minute: min * TAU / 60,
      second: secondAngle
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { timeAngles: timeAngles, TAU: TAU };
  }
  if (typeof document === 'undefined') { return; }   // node-режим: только математика

  /* ================= стили циферблата ================= */
  var STEEL = [
    [0.00, '#565e69'], [0.05, '#c7cfd8'], [0.11, '#79818b'], [0.17, '#eaeff4'],
    [0.25, '#8d959f'], [0.33, '#4a515b'], [0.42, '#b9c1ca'], [0.50, '#6f7781'],
    [0.58, '#dde4ea'], [0.66, '#828a94'], [0.75, '#474e58'], [0.83, '#cdd5dd'],
    [0.90, '#767e88'], [0.96, '#e3e9ef'], [1.00, '#565e69']
  ];
  var BRASS = [
    [0.00, '#6a5223'], [0.05, '#d9bd7c'], [0.11, '#8d7134'], [0.17, '#f3e3b4'],
    [0.25, '#9a7d3c'], [0.33, '#5c4620'], [0.42, '#c9ad6b'], [0.50, '#7d6329'],
    [0.58, '#eddaa4'], [0.66, '#8b6f32'], [0.75, '#54401d'], [0.83, '#dcc487'],
    [0.90, '#836a2e'], [0.96, '#e8d59c'], [1.00, '#6a5223']
  ];
  var GRAPHITE = [
    [0.00, '#2b3038'], [0.05, '#6d757f'], [0.11, '#383e46'], [0.17, '#8d959f'],
    [0.25, '#41474f'], [0.33, '#23272e'], [0.42, '#616872'], [0.50, '#343a42'],
    [0.58, '#7d858f'], [0.66, '#3d434b'], [0.75, '#20242a'], [0.83, '#6a717b'],
    [0.90, '#383e46'], [0.96, '#828a94'], [1.00, '#2b3038']
  ];

  var STYLES = {
    classic: {
      metal: STEEL,
      wall: ['#1b2028', '#0a0c10'],
      wallGlow: 'rgba(126, 146, 178, 0.16)',
      face: ['#ffffff', '#f7f4ee', '#e2dcd0'],
      texture: 'concentric',
      textureColor: 'rgba(90, 82, 66, 0.05)',
      ink: '#1a1e25',
      minor: 'rgba(40, 46, 56, 0.62)',
      ring: 'rgba(60, 62, 66, 0.30)',
      numerals: 'arabic',
      numFont: '600 {s}px Georgia, "Times New Roman", "Droid Serif", serif',
      numRadius: 0.685,
      numSize: 0.125,
      numUpright: true,
      hand: 'dauphine',
      handA: '#151a22',
      handB: '#38414f',
      second: '#b8342a',
      secondLight: '#e0574a',
      nut: STEEL,
      grain: 0.05,
      patina: 0,
      brand: 'CHRONOS',
      brandSub: 'ATELIER',
      brandColor: 'rgba(32, 36, 44, 0.72)',
      glass: 0.13
    },
    minimal: {
      metal: GRAPHITE,
      wall: ['#15171b', '#07080a'],
      wallGlow: 'rgba(150, 160, 180, 0.10)',
      face: ['#31363d', '#23272d', '#14171b'],
      texture: 'sunburst',
      textureColor: 'rgba(255, 255, 255, 0.032)',
      ink: '#eef2f7',
      minor: 'rgba(232, 238, 246, 0.42)',
      ring: 'rgba(255, 255, 255, 0.12)',
      numerals: 'arabic',
      numFont: '200 {s}px "Helvetica Neue", Arial, "Segoe UI", system-ui, sans-serif',
      numRadius: 0.70,
      numSize: 0.115,
      numUpright: true,
      hand: 'baton',
      handA: '#f4f7fb',
      handB: '#c3cad4',
      second: '#f0873a',
      secondLight: '#ffb372',
      nut: GRAPHITE,
      grain: 0.045,
      patina: 0,
      brand: 'MERIDIAN',
      brandSub: '24 · MM',
      brandColor: 'rgba(232, 238, 246, 0.45)',
      glass: 0.10
    },
    vintage: {
      metal: BRASS,
      wall: ['#241d16', '#0c0907'],
      wallGlow: 'rgba(214, 168, 104, 0.15)',
      face: ['#f6ecd2', '#ecdcb8', '#cdb887'],
      texture: 'concentric',
      textureColor: 'rgba(112, 84, 40, 0.055)',
      ink: '#38281a',
      minor: 'rgba(70, 50, 30, 0.62)',
      ring: 'rgba(92, 68, 38, 0.34)',
      numerals: 'roman',
      numFont: '500 {s}px "Times New Roman", Georgia, serif',
      numRadius: 0.715,
      numSize: 0.115,
      numUpright: false,
      hand: 'spade',
      handA: '#2c1f14',
      handB: '#55402a',
      second: '#8f2f22',
      secondLight: '#bd5340',
      nut: BRASS,
      grain: 0.075,
      patina: 1,
      brand: 'HORLOGERIE',
      brandSub: 'PARIS',
      brandColor: 'rgba(60, 44, 26, 0.66)',
      glass: 0.11
    }
  };

  var ROMAN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

  /* ================= служебное ================= */
  function mulberry(seed) {
    return function () {
      seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var canvas = document.getElementById('clock');
  var mainCtx = canvas ? canvas.getContext('2d') : null;
  var digitalEl = document.getElementById('digital');
  if (!canvas || !mainCtx) { return; }

  var ctx = mainCtx;        // активный контекст: экран либо офскрин-слой статики
  var state = { sweep: 'sweep', style: 'classic' };
  var dpr = 1, W = 1, H = 1, cx = 0, cy = 0, R = 10;

  /* мелкое зерно (шум) — источник строится один раз */
  var grainSrc = (function buildGrain() {
    var n = 128, c = document.createElement('canvas');
    c.width = n; c.height = n;
    var g = c.getContext('2d');
    var img = g.createImageData(n, n);
    var rnd = mulberry(20260817);
    for (var i = 0; i < n * n; i++) {
      var v = rnd();
      var o = i * 4;
      if (v < 0.5) { img.data[o] = 0; img.data[o + 1] = 0; img.data[o + 2] = 0; }
      else { img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; }
      img.data[o + 3] = Math.floor(rnd() * 96);
    }
    g.putImageData(img, 0, 0);
    return c;
  })();

  var grainCache = [];
  function grainFor(c) {
    for (var i = 0; i < grainCache.length; i++) {
      if (grainCache[i][0] === c) { return grainCache[i][1]; }
    }
    var p = null;
    try { p = c.createPattern(grainSrc, 'repeat'); } catch (e) { p = null; }
    grainCache.push([c, p]);
    return p;
  }

  /* пятна патины (единичные координаты, фиксированы) */
  var PATINA = (function () {
    var rnd = mulberry(777), out = [], i;
    for (i = 0; i < 16; i++) {
      var a = rnd() * TAU, rr = 0.12 + rnd() * 0.72;
      out.push({
        x: Math.cos(a) * rr,
        y: Math.sin(a) * rr,
        r: 0.05 + rnd() * 0.16,
        a: 0.03 + rnd() * 0.05
      });
    }
    return out;
  })();

  function conic(stops, rot) {
    var g;
    if (ctx.createConicGradient) {
      g = ctx.createConicGradient(rot || -Math.PI / 2, 0, 0);
    } else {
      g = ctx.createLinearGradient(-R, -R, R, R);
    }
    for (var i = 0; i < stops.length; i++) { g.addColorStop(stops[i][0], stops[i][1]); }
    return g;
  }

  function ring(r1, r2) {
    ctx.beginPath();
    ctx.arc(0, 0, r1, 0, TAU);
    ctx.arc(0, 0, r2, 0, TAU, true);
  }

  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function shadow(blur, ox, oy, color) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur * dpr;        // тени не масштабируются трансформом
    ctx.shadowOffsetX = ox * dpr;
    ctx.shadowOffsetY = oy * dpr;
  }
  function noShadow() {
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  }

  /* ================= размеры ================= */
  function metrics() {
    var de = document.documentElement || {};
    return {
      d: Math.min(2, window.devicePixelRatio || 1),
      w: Math.max(1, window.innerWidth || de.clientWidth || 320),
      h: Math.max(1, window.innerHeight || de.clientHeight || 320)
    };
  }

  /* страховка от пропущенного resize и от смены DPR (перенос окна на другой монитор) */
  function syncSize() {
    var m = metrics();
    if (m.d !== dpr || m.w !== W || m.h !== H) { resize(); }
  }

  function resize() {
    var m = metrics();
    dpr = m.d; W = m.w; H = m.h;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    layout();
  }

  function layout() {
    var top = Math.min(62, H * 0.15);        // место под HUD
    var bottom = Math.min(104, H * 0.20);    // место под панель
    var availH = Math.max(60, H - top - bottom);
    var availW = Math.max(60, W - 44);
    R = Math.max(38, Math.min(availW, availH) / 2);
    cx = W / 2;
    cy = top + availH / 2;
  }

  /* ================= фон-стена ================= */
  function drawWall(st) {
    var g = ctx.createLinearGradient(0, 0, W * 0.25, H);
    g.addColorStop(0, st.wall[0]);
    g.addColorStop(1, st.wall[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var rg = ctx.createRadialGradient(W * 0.26, H * 0.14, 0, W * 0.26, H * 0.14, Math.max(W, H) * 0.95);
    rg.addColorStop(0, st.wallGlow);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    var vg = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, Math.max(W, H) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    var gp = grainFor(ctx);
    if (gp) {
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = gp;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /* ================= падающая тень корпуса ================= */
  function drawCast() {
    ctx.save();
    ctx.translate(R * 0.035, R * 0.075);
    var g = ctx.createRadialGradient(0, 0, R * 0.7, 0, 0, R * 1.22);
    g.addColorStop(0, 'rgba(0,0,0,0.50)');
    g.addColorStop(0.62, 'rgba(0,0,0,0.30)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.22, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ================= металлический обод ================= */
  function drawBezel(st) {
    // внешняя кромка корпуса
    ctx.fillStyle = conic(st.metal, -Math.PI / 2);
    ring(R, R * 0.895);
    ctx.fill();

    // тёмная фаска по внешнему краю
    var og = ctx.createRadialGradient(0, 0, R * 0.965, 0, 0, R);
    og.addColorStop(0, 'rgba(0,0,0,0)');
    og.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = og;
    ring(R, R * 0.955);
    ctx.fill();

    // мягкий объём обода: свет сверху-слева, тень снизу-справа
    var lg = ctx.createLinearGradient(-R * 0.7, -R * 0.7, R * 0.7, R * 0.7);
    lg.addColorStop(0, 'rgba(255,255,255,0.30)');
    lg.addColorStop(0.34, 'rgba(255,255,255,0.05)');
    lg.addColorStop(0.62, 'rgba(0,0,0,0.14)');
    lg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = lg;
    ring(R * 0.998, R * 0.895);
    ctx.fill();

    // внутренняя фаска (спуск к циферблату)
    ctx.fillStyle = conic(st.metal, Math.PI / 2);
    ring(R * 0.9, R * 0.878);
    ctx.fill();
    var ig = ctx.createLinearGradient(-R * 0.6, -R * 0.6, R * 0.6, R * 0.6);
    ig.addColorStop(0, 'rgba(0,0,0,0.40)');
    ig.addColorStop(0.5, 'rgba(255,255,255,0.10)');
    ig.addColorStop(1, 'rgba(255,255,255,0.34)');
    ctx.fillStyle = ig;
    ring(R * 0.9, R * 0.878);
    ctx.fill();

    // зеркальные блики на ободе
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = R * 0.052;
    var arcs = [[-2.55, -1.85, 0.34], [0.62, 1.22, 0.20], [-0.95, -0.62, 0.14]];
    for (var i = 0; i < arcs.length; i++) {
      var a0 = arcs[i][0], a1 = arcs[i][1], al = arcs[i][2];
      var rr = R * 0.945;
      var sg = ctx.createLinearGradient(
        Math.cos(a0) * rr, Math.sin(a0) * rr,
        Math.cos(a1) * rr, Math.sin(a1) * rr
      );
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,' + al + ')');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = sg;
      ctx.beginPath();
      ctx.arc(0, 0, rr, a0, a1);
      ctx.stroke();
    }
    ctx.restore();

    // тонкая тёмная линия примыкания стекла к циферблату
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(0.7, R * 0.004);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.878, 0, TAU);
    ctx.stroke();
  }

  /* ================= циферблат ================= */
  function drawFace(st) {
    var rf = R * 0.878;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, rf, 0, TAU);
    ctx.clip();

    var g = ctx.createRadialGradient(-rf * 0.28, -rf * 0.34, rf * 0.05, 0, 0, rf * 1.12);
    g.addColorStop(0, st.face[0]);
    g.addColorStop(0.55, st.face[1]);
    g.addColorStop(1, st.face[2]);
    ctx.fillStyle = g;
    ctx.fillRect(-rf, -rf, rf * 2, rf * 2);

    // фактура
    ctx.save();
    if (st.texture === 'sunburst') {
      ctx.strokeStyle = st.textureColor;
      ctx.lineWidth = Math.max(0.5, rf * 0.004);
      for (var i = 0; i < 180; i++) {
        var a = i * TAU / 180;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * rf * 0.06, Math.sin(a) * rf * 0.06);
        ctx.lineTo(Math.cos(a) * rf, Math.sin(a) * rf);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = st.textureColor;
      ctx.lineWidth = Math.max(0.5, rf * 0.0035);
      for (var k = 4; k < 60; k += 2) {
        ctx.beginPath();
        ctx.arc(0, 0, rf * (k / 60), 0, TAU);
        ctx.stroke();
      }
    }
    ctx.restore();

    // патина
    if (st.patina) {
      for (var p = 0; p < PATINA.length; p++) {
        var s = PATINA[p];
        var pg = ctx.createRadialGradient(s.x * rf, s.y * rf, 0, s.x * rf, s.y * rf, s.r * rf);
        pg.addColorStop(0, 'rgba(122, 92, 44,' + s.a + ')');
        pg.addColorStop(1, 'rgba(122, 92, 44,0)');
        ctx.fillStyle = pg;
        ctx.fillRect(-rf, -rf, rf * 2, rf * 2);
      }
    }

    // зерно
    var gp = grainFor(ctx);
    if (gp && st.grain) {
      ctx.save();
      ctx.globalAlpha = st.grain;
      ctx.fillStyle = gp;
      ctx.fillRect(-rf, -rf, rf * 2, rf * 2);
      ctx.restore();
    }

    // тень от обода на циферблат
    var sg = ctx.createRadialGradient(0, 0, rf * 0.80, 0, 0, rf);
    sg.addColorStop(0, 'rgba(0,0,0,0)');
    sg.addColorStop(0.72, 'rgba(0,0,0,0.10)');
    sg.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = sg;
    ctx.fillRect(-rf, -rf, rf * 2, rf * 2);

    // косой свет по циферблату
    var wg = ctx.createLinearGradient(-rf, -rf, rf * 0.6, rf);
    wg.addColorStop(0, 'rgba(255,255,255,0.16)');
    wg.addColorStop(0.45, 'rgba(255,255,255,0.02)');
    wg.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = wg;
    ctx.fillRect(-rf, -rf, rf * 2, rf * 2);

    ctx.restore();
  }

  /* ================= деления ================= */
  function drawTicks(st) {
    ctx.save();
    ctx.strokeStyle = st.ring;
    ctx.lineWidth = Math.max(0.6, R * 0.0035);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.858, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.775, 0, TAU);
    ctx.stroke();

    for (var i = 0; i < 60; i++) {
      var isHour = (i % 5) === 0;
      ctx.save();
      ctx.rotate(i * TAU / 60);
      if (isHour) {
        var w = R * 0.023, r0 = R * 0.778, r1 = R * 0.852;
        ctx.fillStyle = st.ink;
        roundRectPath(-w / 2, -r1, w, r1 - r0, w * 0.32);
        ctx.fill();
      } else {
        var w2 = Math.max(0.9, R * 0.0075), ra = R * 0.818, rb = R * 0.852;
        ctx.fillStyle = st.minor;
        ctx.fillRect(-w2 / 2, -rb, w2, rb - ra);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /* ================= числа ================= */
  function drawNumerals(st) {
    var size = R * st.numSize;
    ctx.save();
    ctx.fillStyle = st.ink;
    ctx.font = st.numFont.replace('{s}', size.toFixed(2));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var rr = R * st.numRadius;

    for (var i = 0; i < 12; i++) {
      var label = st.numerals === 'roman' ? ROMAN[i] : String(i === 0 ? 12 : i);
      var a = i * TAU / 12;
      ctx.save();
      if (st.numUpright) {
        ctx.translate(Math.sin(a) * rr, -Math.cos(a) * rr);
      } else {
        ctx.rotate(a);
        ctx.translate(0, -rr);
      }
      // мягкое тиснение цифр
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(label, 0, Math.max(0.6, R * 0.0035));
      ctx.fillStyle = st.ink;
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ================= бренд ================= */
  function drawBrand(st) {
    ctx.save();
    ctx.fillStyle = st.brandColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var s1 = R * 0.052;
    ctx.font = '600 ' + s1.toFixed(2) + 'px Georgia, "Times New Roman", serif';
    var letters = st.brand.split(''), i, total = 0, sp = s1 * 0.28;
    for (i = 0; i < letters.length; i++) { total += ctx.measureText(letters[i]).width + sp; }
    total -= sp;
    var x = -total / 2, y = -R * 0.36;
    for (i = 0; i < letters.length; i++) {
      var wl = ctx.measureText(letters[i]).width;
      ctx.fillText(letters[i], x + wl / 2, y);
      x += wl + sp;
    }

    var s2 = R * 0.033;
    ctx.font = '400 ' + s2.toFixed(2) + 'px Georgia, "Times New Roman", serif';
    ctx.globalAlpha = 0.72;
    ctx.fillText(st.brandSub, 0, y + s1 * 1.15);
    ctx.globalAlpha = 1;

    ctx.font = '400 ' + (R * 0.031).toFixed(2) + 'px "Segoe UI", Arial, sans-serif';
    ctx.fillText(state.sweep === 'tick' ? 'QUARTZ' : 'SWEEP', 0, R * 0.44);
    ctx.restore();
  }

  /* ================= стрелки ================= */
  function handPath(kind, len, w, tail) {
    if (kind === 'baton') {
      roundRectPath(-w / 2, -len, w, len + tail, w * 0.42);
      return;
    }
    if (kind === 'spade') {
      ctx.beginPath();
      ctx.moveTo(-w * 0.30, tail);
      ctx.lineTo(w * 0.30, tail);
      ctx.lineTo(w * 0.26, -len * 0.55);
      ctx.quadraticCurveTo(w * 1.05, -len * 0.64, w * 0.62, -len * 0.80);
      ctx.quadraticCurveTo(w * 0.22, -len * 0.93, 0, -len);
      ctx.quadraticCurveTo(-w * 0.22, -len * 0.93, -w * 0.62, -len * 0.80);
      ctx.quadraticCurveTo(-w * 1.05, -len * 0.64, -w * 0.26, -len * 0.55);
      ctx.closePath();
      return;
    }
    // dauphine — граненый ромб
    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.lineTo(w * 0.5, -len * 0.60);
    ctx.lineTo(w * 0.30, tail * 0.4);
    ctx.lineTo(w * 0.34, tail);
    ctx.lineTo(-w * 0.34, tail);
    ctx.lineTo(-w * 0.30, tail * 0.4);
    ctx.lineTo(-w * 0.5, -len * 0.60);
    ctx.closePath();
  }

  function paintHand(angle, st, len, w, tail, blur) {
    ctx.save();
    ctx.rotate(angle);
    shadow(blur, R * 0.014, R * 0.026, 'rgba(0,0,0,0.42)');
    var g = ctx.createLinearGradient(-w * 0.6, 0, w * 0.6, 0);
    g.addColorStop(0, st.handA);
    g.addColorStop(0.42, st.handB);
    g.addColorStop(0.52, st.handA);
    g.addColorStop(1, st.handA);
    ctx.fillStyle = g;
    handPath(st.hand, len, w, tail);
    ctx.fill();
    noShadow();
    // тонкая световая кромка
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(0.5, R * 0.003);
    ctx.stroke();
    ctx.restore();
  }

  function drawSecond(angle, st) {
    ctx.save();
    ctx.rotate(angle);
    shadow(R * 0.05, R * 0.018, R * 0.032, 'rgba(0,0,0,0.34)');
    var w = Math.max(1.1, R * 0.0125);
    var len = R * 0.845, tail = R * 0.215;
    var g = ctx.createLinearGradient(-w, 0, w, 0);
    g.addColorStop(0, st.second);
    g.addColorStop(0.45, st.secondLight);
    g.addColorStop(1, st.second);
    ctx.fillStyle = g;
    roundRectPath(-w / 2, -len, w, len + tail, w * 0.5);
    ctx.fill();
    // противовес
    ctx.beginPath();
    ctx.arc(0, tail * 0.72, R * 0.036, 0, TAU);
    ctx.fill();
    // утолщение у оси
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.019, 0, TAU);
    ctx.fill();
    noShadow();
    ctx.restore();
  }

  /* ================= ось-гайка ================= */
  function drawNut(st) {
    var r = R * 0.036;
    ctx.save();
    shadow(R * 0.035, R * 0.008, R * 0.014, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = conic(st.nut, -Math.PI / 2);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    noShadow();

    var g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    ctx.fillStyle = 'rgba(20,22,26,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.34, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(0.5, R * 0.0025);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  /* ================= стекло ================= */
  function drawGlass(st) {
    var rf = R * 0.878;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, rf, 0, TAU);
    ctx.clip();

    // основной блик от источника сверху-слева
    var g = ctx.createRadialGradient(-rf * 0.42, -rf * 0.52, 0, -rf * 0.42, -rf * 0.52, rf * 1.25);
    g.addColorStop(0, 'rgba(255,255,255,' + st.glass + ')');
    g.addColorStop(0.34, 'rgba(255,255,255,' + (st.glass * 0.30).toFixed(3) + ')');
    g.addColorStop(0.62, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-rf, -rf, rf * 2, rf * 2);

    // отражение окна — наклонная полоса
    ctx.save();
    ctx.rotate(-0.44);
    var bg = ctx.createLinearGradient(0, -rf * 0.72, 0, -rf * 0.18);
    bg.addColorStop(0, 'rgba(255,255,255,0)');
    bg.addColorStop(0.42, 'rgba(255,255,255,0.085)');
    bg.addColorStop(0.58, 'rgba(255,255,255,0.055)');
    bg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(-rf * 1.2, -rf * 0.72, rf * 2.4, rf * 0.54);
    ctx.restore();

    // слабый контрблик снизу-справа
    var g2 = ctx.createRadialGradient(rf * 0.46, rf * 0.56, 0, rf * 0.46, rf * 0.56, rf * 0.78);
    g2.addColorStop(0, 'rgba(255,255,255,0.05)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(-rf, -rf, rf * 2, rf * 2);

    // внутреннее кольцо-отражение стекла в оправе
    ctx.lineWidth = Math.max(0.8, R * 0.008);
    var rg = ctx.createLinearGradient(-rf, -rf, rf, rf);
    rg.addColorStop(0, 'rgba(255,255,255,0.32)');
    rg.addColorStop(0.45, 'rgba(255,255,255,0.02)');
    rg.addColorStop(1, 'rgba(255,255,255,0.14)');
    ctx.strokeStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, rf * 0.995, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  /* ================= HUD ================= */
  var lastHudSec = -1;
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function updateHud(now) {
    var s = now.getSeconds();
    if (s === lastHudSec || !digitalEl) { return; }
    lastHudSec = s;
    digitalEl.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(s);
  }

  /* ================= статичный слой (стена + корпус + циферблат) =================
     Всё неподвижное рисуется в офскрин-канвас и переиспользуется, пока не
     изменились стиль, размер окна или DPR. Каждый кадр остаётся только
     блит + стрелки + гайка + стекло.                                      */
  var staticCv = null, staticCtx = null, staticKey = '';

  function ensureStatic(st) {
    var key = [state.style, state.sweep, canvas.width, canvas.height,
      Math.round(R * 8), Math.round(cx), Math.round(cy)].join('|');
    if (staticCv && staticKey === key) { return; }

    if (!staticCv) {
      staticCv = document.createElement('canvas');
      staticCtx = staticCv.getContext('2d');
      if (!staticCtx) { staticCv = null; return; }
    }
    if (staticCv.width !== canvas.width || staticCv.height !== canvas.height) {
      staticCv.width = canvas.width;
      staticCv.height = canvas.height;
    }

    var prev = ctx;
    ctx = staticCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, staticCv.width, staticCv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    noShadow();
    drawWall(st);
    ctx.save();
    ctx.translate(cx, cy);
    drawCast();
    drawBezel(st);
    drawFace(st);
    drawTicks(st);
    drawNumerals(st);
    drawBrand(st);
    ctx.restore();
    ctx = prev;
    staticKey = key;
  }

  /* ================= кадр ================= */
  function frame() {
    var st = STYLES[state.style] || STYLES.classic;
    var now = new Date();
    var a = timeAngles(now, state.sweep);

    ctx = mainCtx;
    syncSize();
    ensureStatic(st);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    noShadow();
    if (staticCv) {
      ctx.drawImage(staticCv, 0, 0);          // 1:1 по девайс-пикселям
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // страховка, если офскрин недоступен
      drawWall(st);
      ctx.save(); ctx.translate(cx, cy);
      drawCast(); drawBezel(st); drawFace(st); drawTicks(st); drawNumerals(st); drawBrand(st);
      ctx.restore();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(cx, cy);
    paintHand(a.hour, st, R * 0.50, R * 0.062, R * 0.115, R * 0.055);
    paintHand(a.minute, st, R * 0.775, R * 0.045, R * 0.135, R * 0.065);
    drawSecond(a.second, st);
    drawNut(st);
    drawGlass(st);
    ctx.restore();

    updateHud(now);
    requestAnimationFrame(frame);
  }

  /* ================= управление ================= */
  function bindGroup(id, key) {
    var box = document.getElementById(id);
    if (!box) { return; }
    var btns = box.getElementsByTagName('button');
    box.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== box && String(t.tagName).toLowerCase() !== 'button') { t = t.parentNode; }
      if (!t || t === box) { return; }
      var v = t.getAttribute('data-v');
      if (!v) { return; }
      state[key] = v;
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].getAttribute('data-v') === v) { btns[i].className = 'on'; }
        else { btns[i].className = ''; }
      }
    });
  }

  bindGroup('grp-sweep', 'sweep');
  bindGroup('grp-style', 'style');

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  resize();
  requestAnimationFrame(frame);
})();
