'use strict';
(function () {
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');

  // ---------------- state ----------------
  var W = 0, H = 0, CX = 0, CY = 0, DPR = 1;
  var zoom = 1, speed = 1, paused = false;
  var showTrails = true, showLabels = true, autoSpin = true;
  var yaw = 0.6, pitch = 0.5;
  var simDays = 0;
  var FOCAL = 950;
  var DAYS_PER_SEC = 12;
  var SUN_R = 42;
  var D2R = Math.PI / 180;
  var TWO_PI = Math.PI * 2;

  // ---------------- helpers ----------------
  function hexToRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function lighten(rgb, f) {
    return [Math.min(255, rgb[0] * f + 18), Math.min(255, rgb[1] * f + 18), Math.min(255, rgb[2] * f + 18)];
  }
  function rgba(rgb, a) { return 'rgba(' + (rgb[0] | 0) + ',' + (rgb[1] | 0) + ',' + (rgb[2] | 0) + ',' + a + ')'; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // ---------------- planet data ----------------
  // a — AU, e — эксцентриситет, inc/node/peri — градусы, period — земные сутки
  var PLANETS = [
    { name: 'Меркурий', a: 0.387, e: 0.2056, inc: 7.00, node: 48.3, peri: 29.1, period: 87.97, size: 2.6, c1: '#c9bbaa', c2: '#6b5f53', M0: 2.1 },
    { name: 'Венера',   a: 0.723, e: 0.0068, inc: 3.39, node: 76.7, peri: 54.9, period: 224.7, size: 5.2, c1: '#f0d9a0', c2: '#96683a', M0: 4.4 },
    { name: 'Земля',    a: 1.000, e: 0.0167, inc: 0.00, node: 0.0,  peri: 114.2, period: 365.25, size: 5.6, c1: '#6fb1e8', c2: '#173e6e', M0: 1.2, cap: true,
      moons: [{ name: 'Луна', d: 15, size: 1.6, period: 27.32, inc: 5.1, c1: '#cfcfcf', c2: '#6a6a6a' }] },
    { name: 'Марс',     a: 1.524, e: 0.0934, inc: 1.85, node: 49.6, peri: 286.5, period: 686.98, size: 4.0, c1: '#e08a55', c2: '#6f3418', M0: 5.9, cap: true },
    { name: 'Юпитер',   a: 5.203, e: 0.0489, inc: 1.30, node: 100.5, peri: 273.9, period: 4332.6, size: 16, c1: '#e0bd92', c2: '#7a4f2e', M0: 0.6, gas: true, spot: true,
      bands: ['#c9a06e', '#e8d3ae', '#b3814f', '#ecdabb', '#c1905c', '#e0c49a', '#b98a58'],
      moons: [
        { name: 'Ио',       d: 24, size: 1.4, period: 1.77,  inc: 0.05, c1: '#e8d27a', c2: '#8a6f2e' },
        { name: 'Европа',   d: 29, size: 1.2, period: 3.55,  inc: 0.47, c1: '#e2d8c4', c2: '#7d7466' },
        { name: 'Ганимед',  d: 36, size: 1.9, period: 7.15,  inc: 0.20, c1: '#b8b09c', c2: '#5f594c' },
        { name: 'Каллисто', d: 46, size: 1.7, period: 16.69, inc: 0.28, c1: '#97917f', c2: '#4a463c' }
      ] },
    { name: 'Сатурн',   a: 9.537, e: 0.0565, inc: 2.49, node: 113.7, peri: 339.4, period: 10759, size: 13.5, c1: '#ecd9a8', c2: '#8f6f35', M0: 3.3, gas: true, rings: true,
      bands: ['#dcc693', '#efdfae', '#d0b980', '#e8d6a4', '#d8c48e'],
      moons: [{ name: 'Титан', d: 40, size: 1.8, period: 15.95, inc: 0.35, c1: '#e0b45f', c2: '#7d5a1e' }] },
    { name: 'Уран',     a: 19.19, e: 0.0457, inc: 0.77, node: 74.0,  peri: 96.9,  period: 30687, size: 9, c1: '#b8e6ea', c2: '#3f7f8a', M0: 2.8 },
    { name: 'Нептун',   a: 30.07, e: 0.0097, inc: 1.77, node: 131.8, peri: 273.2, period: 60190, size: 8.6, c1: '#6f92e8', c2: '#1d2f6e', M0: 5.0 }
  ];

  function initBody(b) {
    b.rgb1 = hexToRgb(b.c1);
    b.rgb2 = hexToRgb(b.c2);
    b.rgbL = lighten(b.rgb1, 1.25);
  }

  PLANETS.forEach(function (p) {
    p.inc *= D2R; p.node *= D2R; p.peri *= D2R;
    p.trail = [];
    p.pos = { x: 0, y: 0, z: 0 };
    initBody(p);
    (p.moons || []).forEach(function (m) {
      m.inc *= D2R;
      m.M0 = Math.random() * TWO_PI;
      m.pos = { x: 0, y: 0, z: 0 };
      initBody(m);
    });
  });

  // ---------------- orbital math ----------------
  // сжатие расстояний: порядок и пропорции сохранены, система помещается на экран
  function compress(r) { return 26 + 60 * Math.pow(r, 0.62); }

  function keplerE(M, e) {
    var E = M, k;
    for (k = 0; k < 5; k++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    return E;
  }

  function orbitPos(p, days) {
    var M = (p.M0 + TWO_PI * days / p.period) % TWO_PI;
    var E = keplerE(M, p.e);
    var nu = 2 * Math.atan2(Math.sqrt(1 + p.e) * Math.sin(E / 2), Math.sqrt(1 - p.e) * Math.cos(E / 2));
    var r = compress(p.a * (1 - p.e * Math.cos(E)));
    var u = p.peri + nu;
    var cu = Math.cos(u), su = Math.sin(u);
    var cO = Math.cos(p.node), sO = Math.sin(p.node);
    var ci = Math.cos(p.inc), si = Math.sin(p.inc);
    p.pos.x = r * (cO * cu - sO * su * ci);
    p.pos.y = r * (su * si);
    p.pos.z = r * (sO * cu + cO * su * ci);
  }

  // статичная 3D-линия орбиты (строится один раз)
  function buildOrbitPath(p) {
    var pts = [], k, nu, r, u, cu, su;
    var cO = Math.cos(p.node), sO = Math.sin(p.node);
    var ci = Math.cos(p.inc), si = Math.sin(p.inc);
    for (k = 0; k <= 140; k++) {
      nu = k / 140 * TWO_PI;
      r = compress(p.a * (1 - p.e * p.e) / (1 + p.e * Math.cos(nu)));
      u = p.peri + nu;
      cu = Math.cos(u); su = Math.sin(u);
      pts.push({
        x: r * (cO * cu - sO * su * ci),
        y: r * (su * si),
        z: r * (sO * cu + cO * su * ci)
      });
    }
    p.orbitPts = pts;
  }
  PLANETS.forEach(buildOrbitPath);

  // ---------------- projection ----------------
  function project(x, y, z) {
    var cyw = Math.cos(yaw), syw = Math.sin(yaw);
    var x1 = x * cyw + z * syw;
    var z1 = -x * syw + z * cyw;
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var y2 = y * cp - z1 * sp;
    var z2 = y * sp + z1 * cp;
    var persp = FOCAL / (FOCAL + z2);
    return { x: CX + x1 * persp * zoom, y: CY - y2 * persp * zoom, s: persp * zoom, depth: z2 };
  }

  // ---------------- stars & asteroids ----------------
  var STARS = [];
  (function () {
    var i, t, ph, r;
    for (i = 0; i < 430; i++) {
      t = Math.random() * TWO_PI;
      ph = Math.acos(2 * Math.random() - 1);
      r = 1;
      STARS.push({
        x: r * Math.sin(ph) * Math.cos(t),
        y: r * Math.cos(ph),
        z: r * Math.sin(ph) * Math.sin(t),
        size: 0.4 + Math.random() * 1.2,
        base: 0.25 + Math.random() * 0.6,
        phase: Math.random() * TWO_PI,
        freq: 0.4 + Math.random() * 1.6,
        tint: Math.random()
      });
    }
  })();

  var ASTEROIDS = [];
  (function () {
    var i, a;
    for (i = 0; i < 250; i++) {
      a = 2.05 + Math.random() * 1.35;
      ASTEROIDS.push({
        a: a,
        e: Math.random() * 0.16,
        inc: (Math.random() - 0.5) * 14 * D2R,
        ang: Math.random() * TWO_PI,
        rate: TWO_PI / (Math.pow(a, 1.5) * 365.25)
      });
    }
  })();

  // ---------------- background (pre-rendered) ----------------
  var bgCanvas = null, vgCanvas = null;

  function buildBackground() {
    var i, g, b, v;
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = Math.max(1, Math.round(W * DPR));
    bgCanvas.height = Math.max(1, Math.round(H * DPR));
    b = bgCanvas.getContext('2d');
    b.scale(DPR, DPR);

    g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05070f');
    g.addColorStop(0.5, '#070a16');
    g.addColorStop(1, '#04050c');
    b.fillStyle = g;
    b.fillRect(0, 0, W, H);

    var blobs = [
      { x: 0.20, y: 0.30, r: 0.45, c: '64,60,140',  a: 0.10 },
      { x: 0.75, y: 0.65, r: 0.50, c: '30,80,120',  a: 0.09 },
      { x: 0.55, y: 0.15, r: 0.35, c: '120,60,110', a: 0.07 },
      { x: 0.35, y: 0.80, r: 0.40, c: '40,60,120',  a: 0.08 },
      { x: 0.85, y: 0.25, r: 0.30, c: '90,50,130',  a: 0.06 },
      { x: 0.10, y: 0.70, r: 0.35, c: '20,70,110',  a: 0.07 },
      { x: 0.50, y: 0.50, r: 0.28, c: '70,50,20',   a: 0.05 }
    ];
    for (i = 0; i < blobs.length; i++) {
      var bl = blobs[i];
      g = b.createRadialGradient(bl.x * W, bl.y * H, 0, bl.x * W, bl.y * H, bl.r * Math.max(W, H));
      g.addColorStop(0, 'rgba(' + bl.c + ',' + bl.a + ')');
      g.addColorStop(1, 'rgba(' + bl.c + ',0)');
      b.fillStyle = g;
      b.fillRect(0, 0, W, H);
    }

    vgCanvas = document.createElement('canvas');
    vgCanvas.width = Math.max(1, Math.round(W * DPR));
    vgCanvas.height = Math.max(1, Math.round(H * DPR));
    v = vgCanvas.getContext('2d');
    v.scale(DPR, DPR);
    g = v.createRadialGradient(CX, CY, Math.min(W, H) * 0.35, CX, CY, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(1,2,8,0.62)');
    v.fillStyle = g;
    v.fillRect(0, 0, W, H);
  }

  // ---------------- resize ----------------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CX = W / 2;
    CY = H / 2;
    buildBackground();
  }

  // ---------------- drawing ----------------
  function drawStars(tsec) {
    var i, s, cyw = Math.cos(yaw), syw = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var scaleS = Math.max(W, H) * 0.75;
    for (i = 0; i < STARS.length; i++) {
      s = STARS[i];
      var x1 = s.x * cyw + s.z * syw;
      var z1 = -s.x * syw + s.z * cyw;
      var y2 = s.y * cp - z1 * sp;
      var z2 = s.y * sp + z1 * cp;
      var persp = 1 / (1.55 + z2 * 0.55);
      var sx = CX + x1 * persp * scaleS;
      var sy = CY - y2 * persp * scaleS;
      if (sx < -4 || sx > W + 4 || sy < -4 || sy > H + 4) continue;
      var a = s.base * (0.7 + 0.3 * Math.sin(tsec * s.freq + s.phase));
      ctx.fillStyle = s.tint < 0.15 ? 'rgba(190,210,255,' + a + ')'
                    : s.tint < 0.3 ? 'rgba(255,230,190,' + a + ')'
                    : 'rgba(235,240,255,' + a + ')';
      ctx.beginPath();
      ctx.arc(sx, sy, s.size * persp, 0, TWO_PI);
      ctx.fill();
    }
  }

  function drawOrbits() {
    var i, k, p, q;
    ctx.lineWidth = 1;
    for (i = 0; i < PLANETS.length; i++) {
      p = PLANETS[i];
      ctx.strokeStyle = 'rgba(148,168,208,0.16)';
      ctx.beginPath();
      for (k = 0; k < p.orbitPts.length; k++) {
        q = project(p.orbitPts[k].x, p.orbitPts[k].y, p.orbitPts[k].z);
        if (k === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
    }
  }

  function drawAsteroids() {
    var i, a, r, x, y, z, q;
    ctx.fillStyle = 'rgba(203,184,154,0.4)';
    for (i = 0; i < ASTEROIDS.length; i++) {
      a = ASTEROIDS[i];
      r = compress(a.a * (1 - a.e * Math.cos(a.ang)));
      x = r * Math.cos(a.ang);
      y = r * Math.sin(a.ang) * Math.sin(a.inc);
      z = r * Math.sin(a.ang) * Math.cos(a.inc);
      q = project(x, y, z);
      if (q.x < -2 || q.x > W + 2 || q.y < -2 || q.y > H + 2) continue;
      ctx.fillRect(q.x, q.y, 1.2 * q.s, 1.2 * q.s);
    }
  }

  function drawTrail(p) {
    var tr = p.trail, n = tr.length, i, t;
    if (n < 2) return;
    var prev = project(tr[0].x, tr[0].y, tr[0].z);
    for (i = 1; i < n; i++) {
      var cur = project(tr[i].x, tr[i].y, tr[i].z);
      t = i / n;
      ctx.strokeStyle = rgba(p.rgb1, t * t * 0.5);
      ctx.lineWidth = 0.4 + t * 1.2;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      prev = cur;
    }
  }

  function drawSun(P, tsec) {
    var R = SUN_R * P.s;
    var flick = 1 + 0.035 * Math.sin(tsec * 1.7) + 0.02 * Math.sin(tsec * 3.1 + 1.3);
    var g;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    g = ctx.createRadialGradient(P.x, P.y, R * 0.4, P.x, P.y, R * 4.4 * flick);
    g.addColorStop(0, 'rgba(255,200,90,0.5)');
    g.addColorStop(0.3, 'rgba(255,150,50,0.16)');
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(P.x, P.y, R * 4.4 * flick, 0, TWO_PI);
    ctx.fill();

    g = ctx.createRadialGradient(P.x, P.y, R * 0.85, P.x, P.y, R * 2.1 * flick);
    g.addColorStop(0, 'rgba(255,232,170,0.55)');
    g.addColorStop(0.55, 'rgba(255,160,60,0.14)');
    g.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(P.x, P.y, R * 2.1 * flick, 0, TWO_PI);
    ctx.fill();

    // блики-«призраки» вдоль оси солнце — центр кадра
    var vx = CX - P.x, vy = CY - P.y;
    var ghosts = [
      { t: 0.45, r: 11, a: 0.05, c: '160,190,255' },
      { t: 0.8,  r: 6,  a: 0.08, c: '255,220,160' },
      { t: 1.35, r: 17, a: 0.04, c: '180,200,255' }
    ];
    var gi;
    for (gi = 0; gi < ghosts.length; gi++) {
      var gh = ghosts[gi];
      var gx = P.x + vx * gh.t, gy = P.y + vy * gh.t;
      if (gx < -30 || gx > W + 30 || gy < -30 || gy > H + 30) continue;
      g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gh.r * P.s);
      g.addColorStop(0, 'rgba(' + gh.c + ',' + gh.a + ')');
      g.addColorStop(1, 'rgba(' + gh.c + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(gx, gy, gh.r * P.s, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();

    g = ctx.createRadialGradient(P.x - R * 0.22, P.y - R * 0.22, R * 0.08, P.x, P.y, R);
    g.addColorStop(0, '#fffbe8');
    g.addColorStop(0.5, '#ffd76a');
    g.addColorStop(1, '#ff9a3c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(P.x, P.y, R, 0, TWO_PI);
    ctx.fill();
  }

  // освещённый диск: дневная сторона к Солнцу, ночная — в глубокой тени
  // midDraw (если задан) рисуется между базовым диском и ночной тенью
  function litDisc(b, P, r, dx, dy, nightStrength, midDraw) {
    var g = ctx.createRadialGradient(P.x + dx * r * 0.45, P.y + dy * r * 0.45, r * 0.08, P.x, P.y, r);
    g.addColorStop(0, rgba(b.rgbL, 1));
    g.addColorStop(0.55, rgba(b.rgb1, 1));
    g.addColorStop(1, rgba(b.rgb2, 1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(P.x, P.y, r, 0, TWO_PI);
    ctx.fill();

    if (midDraw) midDraw();

    ctx.save();
    ctx.beginPath();
    ctx.arc(P.x, P.y, r, 0, TWO_PI);
    ctx.clip();
    g = ctx.createLinearGradient(P.x + dx * r, P.y + dy * r, P.x - dx * r, P.y - dy * r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.03)');
    g.addColorStop(0.68, 'rgba(3,6,16,' + (0.55 * nightStrength) + ')');
    g.addColorStop(1, 'rgba(2,4,14,' + (0.94 * nightStrength) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(P.x - r - 1, P.y - r - 1, 2 * r + 2, 2 * r + 2);
    ctx.restore();

    // тонкая освещённая кромка со стороны Солнца
    ctx.strokeStyle = 'rgba(255,242,205,0.28)';
    ctx.lineWidth = Math.max(0.6, r * 0.06);
    ctx.beginPath();
    ctx.arc(P.x, P.y, r * 0.97, Math.atan2(dy, dx) - 1.15, Math.atan2(dy, dx) + 1.15);
    ctx.stroke();
  }

  var RING_TILT = 26.7 * D2R;
  var RING_NODE = 40 * D2R;
  var ringTmp = { x: 0, y: 0, z: 0 };

  function ringPoint(center, rad, ang) {
    var cx1 = Math.cos(ang) * rad;
    var sz1 = Math.sin(ang) * rad;
    var y = -sz1 * Math.sin(RING_TILT);
    var z = sz1 * Math.cos(RING_TILT);
    var x = cx1 * Math.cos(RING_NODE) + z * Math.sin(RING_NODE);
    var z2 = -cx1 * Math.sin(RING_NODE) + z * Math.cos(RING_NODE);
    ringTmp.x = center.x + x;
    ringTmp.y = center.y + y;
    ringTmp.z = center.z + z2;
  }

  function drawRings(p, P, back) {
    var S = 64, k, rad, alpha, q, pen;
    for (rad = 1.24; rad <= 2.29; rad += 0.055) {
      if (rad > 1.94 && rad < 2.05) continue; // щель Кассини
      alpha = rad < 1.53 ? 0.15 : (rad < 1.95 ? 0.5 : 0.32);
      ctx.strokeStyle = 'rgba(216,198,154,' + alpha + ')';
      ctx.lineWidth = Math.max(0.7, p.size * P.s * 0.05);
      ctx.beginPath();
      pen = false;
      for (k = 0; k <= S; k++) {
        ringPoint(p.pos, rad * p.size, k / S * TWO_PI);
        q = project(ringTmp.x, ringTmp.y, ringTmp.z);
        if ((q.depth >= P.depth) === back) {
          if (!pen) { ctx.moveTo(q.x, q.y); pen = true; } else ctx.lineTo(q.x, q.y);
        } else {
          pen = false;
        }
      }
      ctx.stroke();
    }
  }

  function drawBands(p, P, r) {
    if (!p.bands) return;
    var n = p.bands.length, i;
    ctx.save();
    ctx.beginPath();
    ctx.arc(P.x, P.y, r, 0, TWO_PI);
    ctx.clip();
    ctx.globalAlpha = 0.26;
    for (i = 0; i < n; i++) {
      ctx.fillStyle = p.bands[i];
      ctx.fillRect(P.x - r, P.y - r + (2 * r * i / n), 2 * r, 2 * r / n + 1);
    }
    ctx.globalAlpha = 1;
    if (p.spot) {
      ctx.fillStyle = 'rgba(194,84,58,0.7)';
      ctx.beginPath();
      ctx.ellipse(P.x + r * 0.32, P.y + r * 0.22, r * 0.3, r * 0.17, 0.3, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPlanet(p, P, sunP) {
    var r = Math.max(0.8, p.size * P.s);
    var dx = sunP.x - P.x, dy = sunP.y - P.y;
    var dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;

    if (p.rings) drawRings(p, P, true);

    // атмосферное свечение
    var g = ctx.createRadialGradient(P.x, P.y, r * 0.6, P.x, P.y, r * 2.1);
    g.addColorStop(0, rgba(p.rgb1, 0.16));
    g.addColorStop(1, rgba(p.rgb1, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(P.x, P.y, r * 2.1, 0, TWO_PI);
    ctx.fill();

    litDisc(p, P, r, dx, dy, 1, p.gas ? function () { drawBands(p, P, r); } : null);
    if (p.cap && r > 2.5) {
      ctx.fillStyle = 'rgba(240,246,255,0.5)';
      ctx.beginPath();
      ctx.arc(P.x, P.y - r * 0.78, r * 0.3, 0, TWO_PI);
      ctx.fill();
    }

    if (p.rings) drawRings(p, P, false);
  }

  function drawMoon(m, P, sunP) {
    var r = Math.max(0.6, m.size * P.s);
    var dx = sunP.x - P.x, dy = sunP.y - P.y;
    var dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    litDisc(m, P, r, dx, dy, 0.95);
  }

  function drawLabels(items) {
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    var i, it, r;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (it.kind !== 'planet') continue;
      r = it.obj.size * it.P.s;
      if (r < 1.2) continue;
      ctx.fillStyle = 'rgba(222,230,246,0.78)';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4;
      ctx.fillText(it.obj.name, it.P.x + r + 7, it.P.y - r - 4);
      ctx.shadowBlur = 0;
    }
  }

  // ---------------- frame ----------------
  var items = [];

  function render(tsec) {
    var i, p, q;

    ctx.drawImage(bgCanvas, 0, 0, W, H);
    drawStars(tsec);
    drawOrbits();
    drawAsteroids();

    // позиции планет и лун
    for (i = 0; i < PLANETS.length; i++) {
      p = PLANETS[i];
      orbitPos(p, simDays);
      if (!paused && speed > 0) {
        var last = p.trail[p.trail.length - 1];
        if (!last || Math.hypot(p.pos.x - last.x, p.pos.y - last.y, p.pos.z - last.z) > 2.5) {
          p.trail.push({ x: p.pos.x, y: p.pos.y, z: p.pos.z });
          if (p.trail.length > 110) p.trail.shift();
        }
      }
    }

    if (showTrails) {
      for (i = 0; i < PLANETS.length; i++) drawTrail(PLANETS[i]);
    }

    // сборка и сортировка по глубине (дальние — первыми)
    var sunP = project(0, 0, 0);
    items.length = 0;
    items.push({ kind: 'sun', P: sunP });
    for (i = 0; i < PLANETS.length; i++) {
      p = PLANETS[i];
      items.push({ kind: 'planet', obj: p, P: project(p.pos.x, p.pos.y, p.pos.z) });
      var moons = p.moons || [];
      for (var mi = 0; mi < moons.length; mi++) {
        var m = moons[mi];
        var ang = m.M0 + TWO_PI * simDays / m.period;
        m.pos.x = p.pos.x + m.d * Math.cos(ang);
        m.pos.y = p.pos.y + m.d * Math.sin(ang) * Math.sin(m.inc);
        m.pos.z = p.pos.z + m.d * Math.sin(ang) * Math.cos(m.inc);
        items.push({ kind: 'moon', obj: m, P: project(m.pos.x, m.pos.y, m.pos.z) });
      }
    }
    items.sort(function (a, b) { return b.P.depth - a.P.depth; });

    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind === 'sun') drawSun(it.P, tsec);
      else if (it.kind === 'planet') drawPlanet(it.obj, it.P, sunP);
      else drawMoon(it.obj, it.P, sunP);
    }

    if (showLabels) drawLabels(items);

    ctx.drawImage(vgCanvas, 0, 0, W, H);
  }

  var lastT = performance.now();
  var hudCounter = 0;
  var dayLabel = document.getElementById('dayLabel');

  function frame(now) {
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;

    if (!paused) simDays += dt * speed * DAYS_PER_SEC;
    if (autoSpin) yaw += dt * 0.035;

    render(now / 1000);

    hudCounter++;
    if (hudCounter % 12 === 0) {
      dayLabel.textContent = 'День ' + Math.floor(simDays).toLocaleString('ru-RU');
    }
    requestAnimationFrame(frame);
  }

  // ---------------- controls ----------------
  var zoomSlider = document.getElementById('zoom');
  var speedSlider = document.getElementById('speed');
  var pauseBtn = document.getElementById('pause');

  zoomSlider.addEventListener('input', function () { zoom = parseFloat(zoomSlider.value); });
  speedSlider.addEventListener('input', function () { speed = parseFloat(speedSlider.value); });
  document.getElementById('trails').addEventListener('change', function (e) { showTrails = e.target.checked; });
  document.getElementById('labels').addEventListener('change', function (e) { showLabels = e.target.checked; });
  document.getElementById('spin').addEventListener('change', function (e) { autoSpin = e.target.checked; });

  function togglePause() {
    paused = !paused;
    pauseBtn.textContent = paused ? 'Пуск' : 'Пауза';
  }
  pauseBtn.addEventListener('click', togglePause);
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      togglePause();
    }
  });

  window.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoom = clamp(zoom * Math.exp(-e.deltaY * 0.001), 0.35, 2.6);
    zoomSlider.value = String(zoom);
  }, { passive: false });

  var dragging = false, lastPX = 0, lastPY = 0;
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastPX = e.clientX;
    lastPY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    yaw += (e.clientX - lastPX) * 0.005;
    pitch = clamp(pitch + (e.clientY - lastPY) * 0.004, 0.08, 1.35);
    lastPX = e.clientX;
    lastPY = e.clientY;
  });
  canvas.addEventListener('pointerup', function () { dragging = false; });
  canvas.addEventListener('pointercancel', function () { dragging = false; });

  // ---------------- start ----------------
  window.addEventListener('resize', resize);
  resize();
  // первичные позиции — чтобы первый кадр уже был осмысленным
  PLANETS.forEach(function (p) { orbitPos(p, simDays); });
  requestAnimationFrame(frame);
})();
