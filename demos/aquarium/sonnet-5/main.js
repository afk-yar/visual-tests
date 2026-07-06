'use strict';
(function () {
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var Fish = window.Fish;
  if (!Fish) {
    console.error('fish.js не загрузился: window.Fish отсутствует');
    return;
  }

  // ---------- утилиты ----------
  function rr(a, b) { return a + Math.random() * (b - a); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  function turnToward(cur, target, maxDelta) {
    var diff = wrapAngle(target - cur);
    if (diff > maxDelta) diff = maxDelta;
    if (diff < -maxDelta) diff = -maxDelta;
    return cur + diff;
  }
  function hexToRgb(hex) {
    var v = parseInt(hex.replace('#', ''), 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }
  function mixRgb(c1, c2, k) {
    return {
      r: Math.round(lerp(c1.r, c2.r, k)),
      g: Math.round(lerp(c1.g, c2.g, k)),
      b: Math.round(lerp(c1.b, c2.b, k)),
    };
  }
  function rgbToStr(c, a) {
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (a === undefined ? 1 : a) + ')';
  }

  var FOG_RGB = hexToRgb('#123244');

  // ---------- состояние сцены/времени ----------
  var W = 0, H = 0, DPR = 1;
  var t = 0;
  var paused = false;
  var currentMul = 1;
  var lastTs = null;

  var fishes = [];
  var foods = [];
  var bubbles = [];

  var scene = {
    sandBase: 0,
    sandSeedA: rr(0, 1000),
    sandSeedB: rr(0, 1000),
    swimTop: 0,
    swimBottom: 0,
    pebbles: [],
    rocks: [],
    weeds: [],
    rays: [],
    caustics: [],
    bubbleEmitters: [],
  };

  // ================== ВИДЫ РЫБ ==================

  function drawAngelPattern(c, spine, sp) {
    var stripeSs = [0.22, 0.44, 0.66, 0.85];
    c.save();
    c.strokeStyle = rgbToStr(sp._edge, 0.4);
    c.lineWidth = sp.bodyLength * 0.035;
    c.lineCap = 'round';
    for (var k = 0; k < stripeSs.length; k++) {
      var idx = Math.round(stripeSs[k] * (spine.length - 1));
      var p = spine[idx];
      c.beginPath();
      c.moveTo(p.x, p.y - p.w * 0.46);
      c.lineTo(p.x, p.y + p.w * 0.46);
      c.stroke();
    }
    c.restore();
  }

  function drawClownBands(c, spine, sp) {
    var bands = [[0.08, 0.2], [0.4, 0.52], [0.68, 0.8]];
    c.save();
    for (var k = 0; k < bands.length; k++) {
      var i0 = Math.round(bands[k][0] * (spine.length - 1));
      var i1 = Math.round(bands[k][1] * (spine.length - 1));
      c.beginPath();
      c.moveTo(spine[i0].x, spine[i0].y - spine[i0].w * 0.5);
      for (var i = i0; i <= i1; i++) c.lineTo(spine[i].x, spine[i].y - spine[i].w * 0.5);
      for (var i2 = i1; i2 >= i0; i2--) c.lineTo(spine[i2].x, spine[i2].y + spine[i2].w * 0.5);
      c.closePath();
      c.fillStyle = rgbToStr(sp._band, 0.94);
      c.fill();
      c.strokeStyle = rgbToStr(sp._bandEdge, 0.85);
      c.lineWidth = Math.max(0.6, sp.bodyLength * 0.02);
      c.stroke();
    }
    c.restore();
  }

  function drawTetraStripe(c, spine, sp) {
    c.save();
    c.lineCap = 'round';
    var n = spine.length - 1;
    c.strokeStyle = rgbToStr(sp._stripe, 0.95);
    c.lineWidth = Math.max(0.7, sp.bodyHeight * 0.18);
    c.beginPath();
    var i0 = Math.round(0.06 * n), i1 = Math.round(0.72 * n);
    c.moveTo(spine[i0].x, spine[i0].y - spine[i0].w * 0.08);
    for (var i = i0; i <= i1; i++) c.lineTo(spine[i].x, spine[i].y - spine[i].w * 0.08);
    c.stroke();

    c.strokeStyle = rgbToStr(sp._stripe2, 0.9);
    c.lineWidth = Math.max(0.6, sp.bodyHeight * 0.15);
    c.beginPath();
    var j0 = Math.round(0.55 * n), j1 = Math.round(0.95 * n);
    c.moveTo(spine[j0].x, spine[j0].y + spine[j0].w * 0.02);
    for (var j = j0; j <= j1; j++) c.lineTo(spine[j].x, spine[j].y + spine[j].w * 0.02);
    c.stroke();
    c.restore();
  }

  var SPECIES = [
    {
      key: 'angel',
      count: 2,
      schooling: false,
      bodyLength: 122,
      bodyHeight: 92,
      waveAmp: 9,
      waveFreq: 0.85,
      headBias: 0.24,
      peakS: 0.3,
      tailBaseS: 0.82,
      tailMinRatio: 0.22,
      segments: 22,
      baseSpeed: 32,
      speedVar: 9,
      maxTurnRate: 1.5,
      wanderForce: 9,
      wallForce: 240,
      tailBaseFreq: 1.9,
      tailSize: 0.55,
      z: 0.85,
      colorTop: '#e7f4f9',
      colorMid: '#93c3d8',
      colorBelly: '#f2e6ae',
      colorEdge: '#18262f',
      colorAccent: '#ffd873',
      finColor: 'rgba(255,214,130,0.5)',
      pattern: drawAngelPattern,
      dorsal: { i0: 0.12, i1: 0.9, extra: 0.62 },
      anal: { i0: 0.16, i1: 0.82, extra: 0.48 },
    },
    {
      key: 'clown',
      count: 5,
      schooling: false,
      bodyLength: 60,
      bodyHeight: 34,
      waveAmp: 7,
      waveFreq: 1.15,
      headBias: 0.16,
      peakS: 0.36,
      tailBaseS: 0.85,
      tailMinRatio: 0.22,
      segments: 18,
      baseSpeed: 46,
      speedVar: 14,
      maxTurnRate: 2.5,
      wanderForce: 15,
      wallForce: 300,
      tailBaseFreq: 3.0,
      tailSize: 0.4,
      z: 0.65,
      colorTop: '#ff8c40',
      colorMid: '#ff7422',
      colorBelly: '#ffb670',
      colorEdge: '#241407',
      colorBand: '#fbf6ea',
      colorBandEdge: '#241407',
      finColor: 'rgba(255,150,90,0.85)',
      pattern: drawClownBands,
      dorsal: { i0: 0.24, i1: 0.62, extra: 0.3 },
      anal: null,
    },
    {
      key: 'tetra',
      count: 16,
      schooling: true,
      bodyLength: 24,
      bodyHeight: 9,
      waveAmp: 3.2,
      waveFreq: 1.5,
      headBias: 0.1,
      peakS: 0.34,
      tailBaseS: 0.84,
      tailMinRatio: 0.2,
      segments: 12,
      baseSpeed: 58,
      speedVar: 20,
      maxTurnRate: 3.4,
      wanderForce: 24,
      wallForce: 340,
      tailBaseFreq: 4.4,
      tailSize: 0.6,
      z: 0.45,
      sepR: 30,
      neighborR: 85,
      sepWeight: 150,
      alignWeight: 1.2,
      cohWeight: 1.0,
      colorTop: '#26445f',
      colorMid: '#3f7aa8',
      colorBelly: '#bfd9ea',
      colorEdge: '#101f2a',
      colorStripe: '#4be8ff',
      colorStripe2: '#ff4d5e',
      finColor: 'rgba(190,225,240,0.65)',
      pattern: drawTetraStripe,
      dorsal: { i0: 0.3, i1: 0.58, extra: 0.26 },
      anal: null,
    },
  ];

  function prepareSpecies() {
    for (var i = 0; i < SPECIES.length; i++) {
      var sp = SPECIES[i];
      var fog = clamp(1 - sp.z, 0, 1) * 0.35;
      sp._top = mixRgb(hexToRgb(sp.colorTop), FOG_RGB, fog);
      sp._mid = mixRgb(hexToRgb(sp.colorMid), FOG_RGB, fog);
      sp._belly = mixRgb(hexToRgb(sp.colorBelly), FOG_RGB, fog);
      sp._edge = mixRgb(hexToRgb(sp.colorEdge || sp.colorMid), FOG_RGB, fog);
      if (sp.colorBand) sp._band = mixRgb(hexToRgb(sp.colorBand), FOG_RGB, fog);
      if (sp.colorBandEdge) sp._bandEdge = mixRgb(hexToRgb(sp.colorBandEdge), FOG_RGB, fog);
      if (sp.colorStripe) sp._stripe = mixRgb(hexToRgb(sp.colorStripe), FOG_RGB, fog);
      if (sp.colorStripe2) sp._stripe2 = mixRgb(hexToRgb(sp.colorStripe2), FOG_RGB, fog);
    }
  }

  function createFishes() {
    fishes = [];
    for (var si = 0; si < SPECIES.length; si++) {
      var sp = SPECIES[si];
      for (var i = 0; i < sp.count; i++) {
        var speed = rr(sp.baseSpeed - sp.speedVar * 0.4, sp.baseSpeed + sp.speedVar);
        var ang = rr(-Math.PI, Math.PI);
        fishes.push({
          sp: sp,
          x: rr(W * 0.15, W * 0.85),
          y: rr(scene.swimTop + 20, scene.swimBottom - 20),
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          heading: ang,
          phase: rr(0, Math.PI * 2),
          wanderAngle: rr(-Math.PI, Math.PI),
          scale: rr(0.88, 1.15),
          flapPhase: rr(0, Math.PI * 2),
          finFreq: rr(2.6, 3.6),
        });
      }
    }
  }

  // ================== ЦИКЛ ОБНОВЛЕНИЯ ==================

  function nearestFood(x, y, maxDist) {
    var best = null, bestD = maxDist;
    for (var i = 0; i < foods.length; i++) {
      var fo = foods[i];
      var d = Math.hypot(fo.x - x, fo.y - y);
      if (d < bestD) { bestD = d; best = fo; }
    }
    return best;
  }

  function updateFish(f, dt) {
    var sp = f.sp;
    var ax = 0, ay = 0;

    f.wanderAngle += rr(-1, 1) * 1.6 * dt;
    ax += Math.cos(f.wanderAngle) * sp.wanderForce;
    ay += Math.sin(f.wanderAngle) * sp.wanderForce * 0.6;

    var m = Math.max(40, sp.bodyLength * 0.55);
    if (f.x < m) { var k1 = (m - f.x) / m; ax += k1 * k1 * sp.wallForce; }
    if (f.x > W - m) { var k2 = (f.x - (W - m)) / m; ax -= k2 * k2 * sp.wallForce; }
    var vm = m * 0.5;
    if (f.y < scene.swimTop + vm) { var k3 = (scene.swimTop + vm - f.y) / vm; ay += k3 * k3 * sp.wallForce; }
    if (f.y > scene.swimBottom - vm) { var k4 = (f.y - (scene.swimBottom - vm)) / vm; ay -= k4 * k4 * sp.wallForce; }

    if (sp.schooling) {
      var sumVX = 0, sumVY = 0, sumX = 0, sumY = 0, n = 0, sepX = 0, sepY = 0;
      for (var j = 0; j < fishes.length; j++) {
        var o = fishes[j];
        if (o === f || o.sp !== sp) continue;
        var dx = f.x - o.x, dy = f.y - o.y;
        var d2 = dx * dx + dy * dy;
        if (d2 > sp.neighborR * sp.neighborR) continue;
        var d = Math.sqrt(d2) || 0.0001;
        sumVX += o.vx; sumVY += o.vy; sumX += o.x; sumY += o.y; n++;
        if (d < sp.sepR) {
          var push = (sp.sepR - d) / sp.sepR;
          sepX += (dx / d) * push;
          sepY += (dy / d) * push;
        }
      }
      if (n > 0) {
        ax += (sumVX / n - f.vx) * sp.alignWeight;
        ay += (sumVY / n - f.vy) * sp.alignWeight;
        ax += (sumX / n - f.x) * sp.cohWeight * 0.02;
        ay += (sumY / n - f.y) * sp.cohWeight * 0.02;
      }
      ax += sepX * sp.sepWeight;
      ay += sepY * sp.sepWeight;
    }

    var fd = nearestFood(f.x, f.y, 260);
    if (fd) {
      var fdx = fd.x - f.x, fdy = fd.y - f.y, fdd = Math.hypot(fdx, fdy) || 0.0001;
      ax += (fdx / fdd) * 220;
      ay += (fdy / fdd) * 220;
    }

    f.vx += ax * dt;
    f.vy += ay * dt;

    var speed = Math.hypot(f.vx, f.vy);
    var maxSp = sp.baseSpeed + sp.speedVar;
    var minSp = Math.max(6, sp.baseSpeed - sp.speedVar);
    if (speed > maxSp) {
      f.vx = f.vx / speed * maxSp;
      f.vy = f.vy / speed * maxSp;
    } else if (speed > 0.0001 && speed < minSp) {
      f.vx = f.vx / speed * minSp;
      f.vy = f.vy / speed * minSp;
    } else if (speed <= 0.0001) {
      f.vx = Math.cos(f.heading) * minSp;
      f.vy = Math.sin(f.heading) * minSp;
    }

    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.x = clamp(f.x, 4, W - 4);
    f.y = clamp(f.y, 4, H - 4);

    var targetHeading = Math.atan2(f.vy, f.vx);
    f.heading = turnToward(f.heading, targetHeading, sp.maxTurnRate * dt);

    var speedRatio = clamp(Math.hypot(f.vx, f.vy) / sp.baseSpeed, 0, 1.6);
    f.phase += Fish.tailBeatRate(speedRatio, sp.tailBaseFreq) * Math.PI * 2 * dt;
    f.flapPhase += f.finFreq * dt * (0.6 + speedRatio * 0.8);
  }

  function spawnFood(x, y) {
    foods.push({ x: x, y: Math.max(y, scene.swimTop + 6), vy: rr(14, 22), r: rr(2.4, 4) });
  }
  function spawnFoodBurst(x, y) {
    var n = 3 + Math.floor(Math.random() * 3);
    for (var i = 0; i < n; i++) spawnFood(x + rr(-18, 18), y + rr(-6, 10));
  }
  function updateFoods(dt) {
    for (var i = foods.length - 1; i >= 0; i--) {
      var fo = foods[i];
      fo.y += fo.vy * dt;
      var eaten = false;
      for (var j = 0; j < fishes.length; j++) {
        if (Math.hypot(fishes[j].x - fo.x, fishes[j].y - fo.y) < fishes[j].sp.bodyLength * 0.3) { eaten = true; break; }
      }
      if (eaten || fo.y > scene.sandBase - 2) foods.splice(i, 1);
    }
  }

  function makeBubble(randomStart) {
    var emitter = scene.bubbleEmitters.length ? scene.bubbleEmitters[Math.floor(Math.random() * scene.bubbleEmitters.length)] : { x: W * 0.5 };
    return {
      baseX: emitter.x + rr(-14, 14),
      y: randomStart ? rr(scene.sandBase - 60, scene.sandBase + 10) : scene.sandBase + rr(0, 16),
      r: rr(1.4, 4.2),
      speed: rr(16, 34),
      wobbleAmp: rr(3, 10),
      wobbleFreq: rr(0.5, 1.3),
      phase: rr(0, Math.PI * 2),
    };
  }
  function initBubbles() {
    bubbles = [];
    for (var i = 0; i < 26; i++) bubbles.push(makeBubble(true));
  }
  function updateBubbles(dt) {
    for (var i = 0; i < bubbles.length; i++) {
      bubbles[i].y -= bubbles[i].speed * dt;
      if (bubbles[i].y < -12) bubbles[i] = makeBubble(false);
    }
  }

  // ================== ОТРИСОВКА: СРЕДА ==================

  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e3f52');
    g.addColorStop(0.4, '#0a2c3d');
    g.addColorStop(0.75, '#061c2b');
    g.addColorStop(1, '#030d16');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawGodRays() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var bottomY = H * 0.72;
    for (var i = 0; i < scene.rays.length; i++) {
      var r = scene.rays[i];
      var sway = Math.sin(t * r.swaySpeed + r.phase) * r.swayAmp;
      var ang = r.angle + sway;
      var topHW = r.width * 0.15;
      var botHW = r.width * 0.5;
      var shiftX = Math.tan(ang) * bottomY;
      var topCX = r.x;
      var botCX = r.x + shiftX;
      ctx.beginPath();
      ctx.moveTo(topCX - topHW, 0);
      ctx.lineTo(topCX + topHW, 0);
      ctx.lineTo(botCX + botHW, bottomY);
      ctx.lineTo(botCX - botHW, bottomY);
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, 0, 0, bottomY);
      grad.addColorStop(0, 'rgba(255,255,255,' + r.alpha + ')');
      grad.addColorStop(0.55, 'rgba(200,240,250,' + (r.alpha * 0.35) + ')');
      grad.addColorStop(1, 'rgba(200,240,250,0)');
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.restore();
  }

  function sandY(x) {
    return scene.sandBase + Math.sin(x * 0.018 + scene.sandSeedA) * 7 + Math.sin(x * 0.006 + scene.sandSeedB) * 11;
  }

  function drawRock(cx, baseY, w, h) {
    ctx.save();
    var grad = ctx.createLinearGradient(cx - w / 2, baseY - h, cx + w / 2, baseY);
    grad.addColorStop(0, '#5b6470');
    grad.addColorStop(1, '#262c33');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, baseY + 6);
    ctx.quadraticCurveTo(cx - w / 2, baseY - h, cx - w * 0.15, baseY - h * 1.08);
    ctx.quadraticCurveTo(cx + w * 0.2, baseY - h * 1.05, cx + w / 2, baseY - h * 0.3);
    ctx.quadraticCurveTo(cx + w * 0.4, baseY + 8, cx - w / 2, baseY + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawSandAndCaustics() {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-2, sandY(-2));
    for (var i = 0; i < scene.sandPoints.length; i++) {
      var x = scene.sandPoints[i];
      ctx.lineTo(x, sandY(x));
    }
    ctx.lineTo(W + 2, H + 2);
    ctx.lineTo(-2, H + 2);
    ctx.closePath();

    var sandGrad = ctx.createLinearGradient(0, scene.sandBase - 14, 0, H);
    sandGrad.addColorStop(0, '#d8c187');
    sandGrad.addColorStop(0.35, '#b89a5f');
    sandGrad.addColorStop(1, '#5b4527');
    ctx.fillStyle = sandGrad;
    ctx.fill();
    ctx.clip();

    ctx.globalCompositeOperation = 'lighter';
    for (var ci = 0; ci < scene.caustics.length; ci++) {
      var cc = scene.caustics[ci];
      var cx = cc.fx * W + Math.sin(t * cc.speedX + cc.phX) * cc.ampX;
      var cy = scene.sandBase + cc.fy * (H - scene.sandBase) * 0.6 + Math.sin(t * cc.speedY + cc.phY) * cc.ampY;
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cc.r);
      g.addColorStop(0, 'rgba(255,255,240,0.22)');
      g.addColorStop(0.5, 'rgba(255,255,230,0.08)');
      g.addColorStop(1, 'rgba(255,255,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, cc.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    for (var pi = 0; pi < scene.pebbles.length; pi++) {
      var p = scene.pebbles[pi];
      var py = sandY(p.x) + p.dy;
      var shade = 130 + p.shade;
      ctx.fillStyle = 'rgba(' + shade + ',' + (shade - 14) + ',' + (shade - 40) + ',0.55)';
      ctx.beginPath();
      ctx.ellipse(p.x, py, p.r * 1.6, p.r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    for (var ri = 0; ri < scene.rocks.length; ri++) {
      var rk = scene.rocks[ri];
      drawRock(rk.x, sandY(rk.x), rk.w, rk.h);
    }
  }

  function drawWeed(w) {
    var baseX = w.x, baseY = sandY(w.x) + 2;
    var pts = [{ x: baseX, y: baseY }];
    for (var i = 1; i <= w.segs; i++) {
      var k = i / w.segs;
      var ang = Math.sin(t * w.speed - i * 0.5 + w.phase) * w.sway * k * k;
      var prev = pts[i - 1];
      pts.push({ x: prev.x + Math.sin(ang) * w.segLen, y: prev.y - Math.cos(ang) * w.segLen });
    }

    var leftPts = [], rightPts = [];
    for (var j = 0; j < pts.length; j++) {
      var kk = j / w.segs;
      var width = w.width * (1 - kk) * 0.9 + 1;
      var nx = 1, ny = 0;
      if (j === 0) {
        var dx0 = pts[1].x - pts[0].x, dy0 = pts[1].y - pts[0].y;
        var len0 = Math.hypot(dx0, dy0) || 1;
        nx = -dy0 / len0; ny = dx0 / len0;
      } else if (j === pts.length - 1) {
        var dx1 = pts[j].x - pts[j - 1].x, dy1 = pts[j].y - pts[j - 1].y;
        var len1 = Math.hypot(dx1, dy1) || 1;
        nx = -dy1 / len1; ny = dx1 / len1;
      } else {
        var dx2 = pts[j + 1].x - pts[j - 1].x, dy2 = pts[j + 1].y - pts[j - 1].y;
        var len2 = Math.hypot(dx2, dy2) || 1;
        nx = -dy2 / len2; ny = dx2 / len2;
      }
      leftPts.push({ x: pts[j].x + nx * width / 2, y: pts[j].y + ny * width / 2 });
      rightPts.push({ x: pts[j].x - nx * width / 2, y: pts[j].y - ny * width / 2 });
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(leftPts[0].x, leftPts[0].y);
    for (var l = 1; l < leftPts.length; l++) ctx.lineTo(leftPts[l].x, leftPts[l].y);
    for (var r = rightPts.length - 1; r >= 0; r--) ctx.lineTo(rightPts[r].x, rightPts[r].y);
    ctx.closePath();
    var grad = ctx.createLinearGradient(baseX, baseY, baseX, pts[pts.length - 1].y);
    grad.addColorStop(0, 'rgba(18,66,40,0.85)');
    grad.addColorStop(1, 'rgba(96,168,74,0.55)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  function drawWeeds() {
    for (var i = 0; i < scene.weeds.length; i++) drawWeed(scene.weeds[i]);
  }

  function drawFoods() {
    for (var i = 0; i < foods.length; i++) {
      var fo = foods[i];
      ctx.beginPath();
      ctx.fillStyle = '#caa15a';
      ctx.arc(fo.x, fo.y, fo.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBubbles() {
    for (var i = 0; i < bubbles.length; i++) {
      var b = bubbles[i];
      var x = b.baseX + Math.sin(t * b.wobbleFreq + b.phase) * b.wobbleAmp;
      var fadeIn = clamp((scene.sandBase - b.y) / 50, 0, 1);
      var fadeOut = clamp(b.y / (H * 0.12), 0, 1);
      var alpha = 0.5 * Math.min(fadeIn, fadeOut);
      if (alpha <= 0.01) continue;
      var grad = ctx.createRadialGradient(x - b.r * 0.3, b.y - b.r * 0.3, 0.2, x, b.y, b.r);
      grad.addColorStop(0, 'rgba(255,255,255,' + (alpha * 0.9) + ')');
      grad.addColorStop(1, 'rgba(210,240,250,' + (alpha * 0.12) + ')');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,' + (alpha * 0.5) + ')';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  function drawFog() {
    ctx.save();
    var vg = ctx.createRadialGradient(W * 0.5, H * 0.42, H * 0.15, W * 0.5, H * 0.5, H * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,4,8,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'screen';
    for (var i = 0; i < 3; i++) {
      var hx = ((W * (0.2 + 0.3 * i) + Math.sin(t * 0.03 + i * 2) * W * 0.15) % W + W) % W;
      var hy = H * (0.3 + 0.2 * i) + Math.sin(t * 0.02 + i) * H * 0.08;
      var g = ctx.createRadialGradient(hx, hy, 0, hx, hy, H * 0.35);
      g.addColorStop(0, 'rgba(180,210,220,0.035)');
      g.addColorStop(1, 'rgba(180,210,220,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // ================== ОТРИСОВКА: РЫБЫ ==================

  function drawFinBlade(x, y, angle, len, wid) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.5, wid * 0.55, len, wid * 0.12);
    ctx.quadraticCurveTo(len * 0.55, -wid * 0.15, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPectoralFins(f, spine, sp) {
    var idx = Math.round(0.24 * (spine.length - 1));
    var base = spine[idx];
    var flap = Math.sin(f.flapPhase);
    var len = sp.bodyLength * 0.26;
    var wid = len * 0.5;
    var ang = 0.45 + flap * 0.35;
    ctx.save();
    ctx.fillStyle = sp.finColor;
    drawFinBlade(base.x, base.y + base.w * 0.22, ang, len, wid);
    ctx.restore();
  }

  function drawFinRibbon(spine, i0Frac, i1Frac, side, maxExtra, color) {
    var n = spine.length - 1;
    var i0 = Math.round(i0Frac * n), i1 = Math.round(i1Frac * n);
    if (i1 <= i0) return;
    ctx.beginPath();
    var p0 = spine[i0];
    ctx.moveTo(p0.x, p0.y + side * p0.w / 2);
    for (var i = i0; i <= i1; i++) {
      var p = spine[i];
      var k = (i - i0) / (i1 - i0);
      var extra = maxExtra * Math.sin(Math.PI * k);
      ctx.lineTo(p.x, p.y + side * (p.w / 2 + extra));
    }
    var p1 = spine[i1];
    ctx.lineTo(p1.x, p1.y + side * p1.w / 2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawTailFin(f, spine, sp) {
    var n = spine.length - 1;
    var tip = spine[n];
    var prev = spine[n - 1];
    var tanAngle = Math.atan2(tip.y - prev.y, tip.x - prev.x);
    var flutter = Math.sin(f.phase * 1.0 + Math.PI * 0.15) * 0.2;
    var size = sp.bodyLength * sp.tailSize;
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(tanAngle + flutter);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(size * 0.55, -size * 0.4, size, -size * 0.55);
    ctx.quadraticCurveTo(size * 0.6, -size * 0.05, size * 0.62, 0);
    ctx.quadraticCurveTo(size * 0.6, size * 0.05, size, size * 0.55);
    ctx.quadraticCurveTo(size * 0.55, size * 0.4, 0, 0);
    ctx.closePath();
    ctx.fillStyle = sp.finColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.6;
    for (var r = -2; r <= 2; r++) {
      ctx.beginPath();
      ctx.moveTo(size * 0.15, 0);
      ctx.lineTo(size * 0.95, r * size * 0.16);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEye(spine, sp) {
    var idx = Math.round(0.05 * (spine.length - 1));
    var p = spine[idx] || spine[0];
    var ex = p.x - sp.bodyLength * 0.015;
    var ey = p.y - p.w * 0.16;
    var r = Math.max(1, sp.bodyHeight * 0.085);
    ctx.beginPath();
    ctx.fillStyle = '#0b1014';
    ctx.arc(ex, ey, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.arc(ex - r * 0.32, ey - r * 0.32, r * 0.36, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFish(f) {
    var sp = f.sp;
    var bob = Math.sin(t * 1.3 + f.phase * 0.3) * sp.bodyHeight * 0.02;
    ctx.save();
    ctx.translate(f.x, f.y + bob);
    ctx.rotate(f.heading);
    ctx.scale(f.scale, f.scale);

    var spine = Fish.buildSpine({
      segments: sp.segments,
      bodyLength: sp.bodyLength,
      bodyHeight: sp.bodyHeight,
      amplitude: sp.waveAmp,
      frequency: sp.waveFreq,
      headBias: sp.headBias,
      peakS: sp.peakS,
      tailBaseS: sp.tailBaseS,
      tailMinRatio: sp.tailMinRatio,
    }, f.phase);

    drawPectoralFins(f, spine, sp);

    ctx.beginPath();
    ctx.moveTo(spine[0].x, spine[0].y - spine[0].w / 2);
    for (var i = 1; i < spine.length; i++) ctx.lineTo(spine[i].x, spine[i].y - spine[i].w / 2);
    for (var j = spine.length - 1; j >= 0; j--) ctx.lineTo(spine[j].x, spine[j].y + spine[j].w / 2);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, -sp.bodyHeight / 2, 0, sp.bodyHeight / 2);
    grad.addColorStop(0, rgbToStr(sp._top, 0.97));
    grad.addColorStop(0.55, rgbToStr(sp._mid, 0.97));
    grad.addColorStop(1, rgbToStr(sp._belly, 0.93));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = Math.max(0.6, sp.bodyLength * 0.01);
    ctx.strokeStyle = rgbToStr(sp._edge, 0.55);
    ctx.stroke();

    if (sp.pattern) sp.pattern(ctx, spine, sp);
    if (sp.dorsal) drawFinRibbon(spine, sp.dorsal.i0, sp.dorsal.i1, -1, sp.dorsal.extra * sp.bodyHeight, sp.finColor);
    if (sp.anal) drawFinRibbon(spine, sp.anal.i0, sp.anal.i1, 1, sp.anal.extra * sp.bodyHeight, sp.finColor);

    drawTailFin(f, spine, sp);
    drawEye(spine, sp);

    ctx.restore();
  }

  // ================== КОМПОНОВКА/РЕСАЙЗ ==================

  function layoutFishBounds() {
    scene.swimTop = H * 0.08;
    scene.swimBottom = scene.sandBase - 22;
    if (scene.swimBottom < scene.swimTop + 40) scene.swimBottom = scene.swimTop + 40;
    for (var i = 0; i < fishes.length; i++) {
      fishes[i].x = clamp(fishes[i].x, 10, W - 10);
      fishes[i].y = clamp(fishes[i].y, scene.swimTop + 4, scene.swimBottom - 4);
    }
  }

  function layoutScene() {
    scene.sandBase = H * 0.86;

    scene.sandPoints = [];
    var step = 24;
    for (var x = -step; x <= W + step; x += step) scene.sandPoints.push(x);

    scene.pebbles = [];
    var pebbleCount = Math.max(10, Math.round(W / 26));
    for (var i = 0; i < pebbleCount; i++) {
      scene.pebbles.push({ x: rr(0, W), dy: rr(4, 26), r: rr(1.2, 3.4), shade: rr(-24, 20) });
    }

    scene.rocks = [];
    var rockCount = W > 640 ? 3 : 2;
    for (var ri = 0; ri < rockCount; ri++) {
      scene.rocks.push({ x: (ri + 0.5) * (W / rockCount) + rr(-40, 40), w: rr(70, 130), h: rr(30, 52) });
    }

    scene.weeds = [];
    var weedCount = Math.max(6, Math.round(W / 130));
    for (var wi = 0; wi < weedCount; wi++) {
      scene.weeds.push({
        x: rr(20, W - 20),
        segs: 10,
        segLen: rr(13, 20),
        sway: rr(0.35, 0.6),
        speed: rr(0.5, 0.9),
        phase: rr(0, Math.PI * 2),
        width: rr(7, 13),
      });
    }

    scene.rays = [];
    var rayCount = 5;
    for (var gi = 0; gi < rayCount; gi++) {
      scene.rays.push({
        x: (gi + 0.5) / rayCount * W + rr(-40, 40),
        width: rr(70, 150),
        angle: rr(-0.18, 0.18),
        swaySpeed: rr(0.05, 0.11),
        swayAmp: rr(0.05, 0.12),
        phase: rr(0, Math.PI * 2),
        alpha: rr(0.05, 0.11),
      });
    }

    scene.caustics = [];
    for (var ci = 0; ci < 9; ci++) {
      scene.caustics.push({
        fx: rr(0, 1), ampX: rr(30, 90), speedX: rr(0.15, 0.4), phX: rr(0, Math.PI * 2),
        fy: rr(0.25, 0.85), ampY: rr(6, 16), speedY: rr(0.2, 0.5), phY: rr(0, Math.PI * 2),
        r: rr(30, 70),
      });
    }

    scene.bubbleEmitters = [];
    var emitterCount = 3;
    for (var bi = 0; bi < emitterCount; bi++) {
      scene.bubbleEmitters.push({ x: (bi + 0.5) / emitterCount * W + rr(-60, 60) });
    }

    layoutFishBounds();
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * DPR));
    canvas.height = Math.max(1, Math.round(H * DPR));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layoutScene();
  }

  // ================== ЦИКЛ РЕНДЕРА ==================

  function update(dt) {
    updateFoods(dt);
    updateBubbles(dt);
    for (var i = 0; i < fishes.length; i++) updateFish(fishes[i], dt);
  }

  function render() {
    drawBackground();
    drawGodRays();
    drawSandAndCaustics();
    drawWeeds();

    var order = fishes.slice().sort(function (a, b) { return a.sp.z - b.sp.z; });
    for (var i = 0; i < order.length; i++) drawFish(order[i]);

    drawFoods();
    drawBubbles();
    drawFog();
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (lastTs === null) lastTs = ts;
    var rawDt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (!isFinite(rawDt) || rawDt < 0) rawDt = 0;
    rawDt = Math.min(rawDt, 0.05);
    var dt = paused ? 0 : rawDt * currentMul;
    t += dt;
    update(dt);
    render();
  }

  // ================== ВВОД ==================

  function bindInput() {
    canvas.addEventListener('pointerdown', function (e) {
      var rect = canvas.getBoundingClientRect();
      spawnFoodBurst(e.clientX - rect.left, e.clientY - rect.top);
    });

    var btnFeed = document.getElementById('btn-feed');
    if (btnFeed) {
      btnFeed.addEventListener('click', function () {
        spawnFoodBurst(W * 0.5 + rr(-60, 60), scene.swimTop + 10);
      });
    }

    var btnPause = document.getElementById('btn-pause');
    if (btnPause) {
      btnPause.addEventListener('click', function () {
        paused = !paused;
        btnPause.textContent = paused ? 'Играть' : 'Пауза';
        btnPause.classList.toggle('is-active', paused);
        btnPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
      });
    }

    var ctrlCurrent = document.getElementById('ctrl-current');
    if (ctrlCurrent) {
      ctrlCurrent.addEventListener('input', function (e) {
        var v = parseFloat(e.target.value);
        currentMul = isFinite(v) ? v : 1;
      });
    }

    window.addEventListener('resize', resize);
  }

  // ================== ИНИЦИАЛИЗАЦИЯ ==================

  function init() {
    prepareSpecies();
    resize();
    createFishes();
    initBubbles();
    bindInput();
    requestAnimationFrame(frame);
  }

  init();
})();
