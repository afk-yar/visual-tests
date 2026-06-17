(function () {
  "use strict";

  var canvas = document.getElementById("aquarium");
  var ctx = canvas.getContext("2d", { alpha: false });
  var pauseButton = document.getElementById("pause");
  var energyInput = document.getElementById("energy");
  var hazeInput = document.getElementById("haze");

  var W = 1;
  var H = 1;
  var DPR = 1;
  var bottomY = 1;
  var paused = false;
  var lastTime = 0;
  var simTime = 0;
  var energy = 1;
  var hazeAmount = 0.82;

  var fish = [];
  var bubbles = [];
  var plants = [];
  var motes = [];
  var stones = [];
  var noiseCanvas = document.createElement("canvas");
  var noiseCtx = noiseCanvas.getContext("2d");

  function mulberry32(seed) {
    return function () {
      var t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var rand = mulberry32(5255);

  function rnd(a, b) {
    return a + (b - a) * rand();
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function softNoise(x) {
    return Math.sin(x * 1.7) * 0.54 + Math.sin(x * 2.93 + 1.4) * 0.28 + Math.sin(x * 5.11 + 3.2) * 0.18;
  }

  function makeNoise() {
    noiseCanvas.width = 192;
    noiseCanvas.height = 192;
    var img = noiseCtx.createImageData(noiseCanvas.width, noiseCanvas.height);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 105 + Math.floor(rand() * 95);
      img.data[i] = v;
      img.data[i + 1] = v + 8;
      img.data[i + 2] = v + 14;
      img.data[i + 3] = 28 + Math.floor(rand() * 42);
    }
    noiseCtx.putImageData(img, 0, 0);
  }

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    bottomY = H * 0.79;
    buildScene();
  }

  function buildScene() {
    fish = [];
    bubbles = [];
    plants = [];
    motes = [];
    stones = [];

    var schoolCx = W * 0.56;
    var schoolCy = H * 0.42;
    var species = [
      {
        kind: "gold",
        count: 4,
        len: [92, 142],
        speed: [28, 48],
        body: ["#ffb13d", "#f07420", "#fff0a3"],
        accent: "#9b3014",
        fin: "rgba(255,158,70,0.56)",
        stripe: null
      },
      {
        kind: "blue",
        count: 3,
        len: [84, 124],
        speed: [24, 40],
        body: ["#3ad7f7", "#126dbd", "#d7fbff"],
        accent: "#083566",
        fin: "rgba(79,219,255,0.46)",
        stripe: "#ffe15b"
      },
      {
        kind: "angel",
        count: 3,
        len: [72, 108],
        speed: [18, 32],
        body: ["#ece6bd", "#8cb7c4", "#ffffff"],
        accent: "#1b3a44",
        fin: "rgba(232,239,207,0.38)",
        stripe: "#24383d"
      },
      {
        kind: "silver",
        count: 4,
        len: [60, 92],
        speed: [30, 56],
        body: ["#d9f5f8", "#6eb0b9", "#ffffff"],
        accent: "#285b67",
        fin: "rgba(205,247,255,0.34)",
        stripe: "#f5ffb6"
      }
    ];

    species.forEach(function (s) {
      for (var i = 0; i < s.count; i++) {
        addFish(s, rnd(W * 0.14, W * 0.86), rnd(H * 0.18, bottomY - 70), false);
      }
    });

    for (var n = 0; n < Math.max(22, Math.floor(W * H / 42000)); n++) {
      var small = {
        kind: "neon",
        count: 1,
        len: [34, 48],
        speed: [45, 78],
        body: ["#58f8ff", "#1e77c9", "#fff9d8"],
        accent: "#101c3a",
        fin: "rgba(95,235,255,0.28)",
        stripe: "#ff4d5f"
      };
      addFish(small, schoolCx + rnd(-95, 95), schoolCy + rnd(-55, 55), true);
    }

    for (var b = 0; b < Math.max(46, Math.floor(W / 16)); b++) {
      bubbles.push({
        x: rnd(20, W - 20),
        y: rnd(0, H),
        r: rnd(1.1, 5.5),
        vy: rnd(18, 64),
        phase: rnd(0, 100),
        alpha: rnd(0.28, 0.72),
        cluster: rand() < 0.45 ? rnd(W * 0.05, W * 0.94) : null
      });
    }

    var plantCount = Math.max(22, Math.floor(W / 42));
    for (var p = 0; p < plantCount; p++) {
      plants.push({
        x: rnd(8, W - 8),
        y: bottomY + rnd(18, H * 0.18),
        h: rnd(H * 0.10, H * 0.27),
        blades: Math.floor(rnd(3, 8)),
        hue: rnd(112, 172),
        phase: rnd(0, 100),
        thick: rnd(1.4, 4.2)
      });
    }

    for (var m = 0; m < Math.max(140, Math.floor(W * H / 6600)); m++) {
      motes.push({
        x: rnd(0, W),
        y: rnd(0, H),
        r: rnd(0.35, 1.75),
        alpha: rnd(0.05, 0.22),
        drift: rnd(-4, 7),
        depth: rnd(0.35, 1)
      });
    }

    for (var r = 0; r < Math.max(10, Math.floor(W / 120)); r++) {
      stones.push({
        x: rnd(0, W),
        y: rnd(bottomY + H * 0.08, H + 20),
        w: rnd(34, 130),
        h: rnd(13, 48),
        c: rnd(0, 1)
      });
    }
  }

  function addFish(s, x, y, schooling) {
    var len = rnd(s.len[0], s.len[1]);
    var angle = rnd(-Math.PI, Math.PI);
    fish.push({
      kind: s.kind,
      x: x,
      y: y,
      px: x,
      py: y,
      vx: Math.cos(angle),
      vy: Math.sin(angle) * 0.55,
      angle: angle,
      targetAngle: angle,
      speed: rnd(s.speed[0], s.speed[1]),
      len: len,
      bodyH: len * (s.kind === "angel" ? rnd(0.36, 0.46) : rnd(0.22, 0.31)),
      phase: rnd(0, Math.PI * 2),
      seed: rnd(0, 1000),
      turn: rnd(1.2, 2.4),
      schooling: schooling,
      body: s.body,
      accent: s.accent,
      fin: s.fin,
      stripe: s.stripe,
      layer: rnd(0.68, 1.08),
      nervous: schooling ? rnd(1.1, 1.8) : rnd(0.45, 0.95)
    });
  }

  function drawBackground(t) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#6cd8df");
    g.addColorStop(0.2, "#267ea3");
    g.addColorStop(0.55, "#10506d");
    g.addColorStop(1, "#092735");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (var i = 0; i < 7; i++) {
      var x = W * (0.08 + i * 0.15) + Math.sin(t * 0.19 + i * 1.7) * W * 0.045;
      var topW = W * rndCached(i, 0.018, 0.055);
      var botW = W * rndCached(i + 99, 0.10, 0.22);
      var ray = ctx.createLinearGradient(0, 0, 0, H * 0.72);
      ray.addColorStop(0, "rgba(213,255,246,0.16)");
      ray.addColorStop(0.55, "rgba(178,245,234,0.055)");
      ray.addColorStop(1, "rgba(178,245,234,0)");
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(x - topW, -20);
      ctx.lineTo(x + topW, -20);
      ctx.lineTo(x + botW + Math.sin(t * 0.1 + i) * 18, bottomY + 20);
      ctx.lineTo(x - botW + Math.cos(t * 0.12 + i) * 18, bottomY + 20);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    drawSurfaceRipples(t);
    drawDistantShapes(t);
    drawSand(t);
    drawCaustics(t);
  }

  var cachedRnd = [];
  function rndCached(i, a, b) {
    if (cachedRnd[i] === undefined) cachedRnd[i] = rnd(a, b);
    return cachedRnd[i];
  }

  function drawSurfaceRipples(t) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (var y = 16; y < H * 0.22; y += 18) {
      ctx.strokeStyle = "rgba(219,255,250," + (0.05 * (1 - y / (H * 0.25))).toFixed(3) + ")";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var x = -10; x <= W + 10; x += 22) {
        var yy = y + Math.sin(x * 0.023 + t * 1.4 + y * 0.07) * 3 + Math.sin(x * 0.047 - t * 0.7) * 1.7;
        if (x < 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDistantShapes(t) {
    ctx.save();
    ctx.globalAlpha = 0.11;
    ctx.fillStyle = "#0c3140";
    for (var i = 0; i < 8; i++) {
      var x = (i * W / 7 + Math.sin(t * 0.03 + i) * 18) % (W + 180) - 90;
      var y = H * (0.18 + 0.07 * (i % 4));
      var s = 20 + (i % 3) * 12;
      ctx.beginPath();
      ctx.ellipse(x, y, s * 1.8, s * 0.35, Math.sin(i) * 0.2, 0, Math.PI * 2);
      ctx.moveTo(x - s * 1.7, y);
      ctx.lineTo(x - s * 2.4, y - s * 0.42);
      ctx.lineTo(x - s * 2.25, y + s * 0.42);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSand(t) {
    ctx.save();
    var g = ctx.createLinearGradient(0, bottomY - 12, 0, H);
    g.addColorStop(0, "#c8b37a");
    g.addColorStop(0.45, "#a88752");
    g.addColorStop(1, "#6d5635");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, bottomY);
    for (var x = 0; x <= W + 18; x += 18) {
      var y = bottomY + Math.sin(x * 0.018 + t * 0.28) * 6 + Math.sin(x * 0.041 - t * 0.19) * 3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#f7e2a7";
    for (var i = 0; i < 420; i++) {
      var sx = (i * 73) % Math.max(W, 1);
      var sy = bottomY + 9 + ((i * 47) % Math.max(H - bottomY, 1));
      ctx.fillRect(sx, sy, 1, 1);
    }
    ctx.globalAlpha = 1;

    stones.forEach(function (s) {
      var rg = ctx.createRadialGradient(s.x - s.w * 0.2, s.y - s.h * 0.55, 2, s.x, s.y, s.w);
      rg.addColorStop(0, s.c > 0.5 ? "#9b8f79" : "#5e7b77");
      rg.addColorStop(1, s.c > 0.5 ? "#4e4034" : "#233b3e");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.w, s.h, rndCached(Math.floor(s.x + s.y), -0.2, 0.2), Math.PI, Math.PI * 2);
      ctx.lineTo(s.x + s.w, s.y + s.h * 0.4);
      ctx.lineTo(s.x - s.w, s.y + s.h * 0.5);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }

  function drawCaustics(t) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bottomY - 14, W, H - bottomY + 14);
    ctx.clip();
    ctx.globalCompositeOperation = "screen";
    for (var row = 0; row < 14; row++) {
      var y = bottomY + row * 22 + Math.sin(t * 0.9 + row) * 4;
      ctx.strokeStyle = "rgba(255,247,190," + (0.085 - row * 0.003).toFixed(3) + ")";
      ctx.lineWidth = 1.2 + Math.sin(t + row) * 0.4;
      ctx.beginPath();
      for (var x = -30; x <= W + 30; x += 12) {
        var yy = y + Math.sin(x * 0.031 + t * 1.5 + row * 0.8) * 5 + Math.sin(x * 0.071 - t * 1.1) * 2.5;
        if (x === -30) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    for (var col = 0; col < 18; col++) {
      var x0 = col * W / 17 + Math.sin(t * 0.55 + col) * 17;
      var cg = ctx.createRadialGradient(x0, bottomY + 70, 4, x0, bottomY + 70, 96);
      cg.addColorStop(0, "rgba(255,247,190,0.055)");
      cg.addColorStop(1, "rgba(255,247,190,0)");
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(x0, bottomY + 65 + Math.sin(t + col) * 18, 96, 18, Math.sin(col) * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function updateFish(dt, t) {
    var school = { x: 0, y: 0, vx: 0, vy: 0, n: 0 };
    fish.forEach(function (f) {
      if (f.schooling) {
        school.x += f.x;
        school.y += f.y;
        school.vx += f.vx;
        school.vy += f.vy;
        school.n++;
      }
    });
    if (school.n) {
      school.x /= school.n;
      school.y /= school.n;
      school.vx /= school.n;
      school.vy /= school.n;
    }

    fish.forEach(function (f) {
      f.px = f.x;
      f.py = f.y;
      var ax = Math.cos(f.angle);
      var ay = Math.sin(f.angle);
      var wx = softNoise(t * 0.21 + f.seed) * 0.75;
      var wy = softNoise(t * 0.17 + f.seed * 1.9) * 0.54;

      if (f.schooling && school.n) {
        var dx = school.x - f.x;
        var dy = school.y - f.y;
        var d = Math.max(1, Math.hypot(dx, dy));
        var commonX = Math.cos(t * 0.17 + 1.6) * 0.8 + Math.sin(t * 0.09) * 0.55;
        var commonY = Math.sin(t * 0.13 + 0.4) * 0.38;
        wx += dx / d * 1.35 + school.vx * 0.8 + commonX;
        wy += dy / d * 1.35 + school.vy * 0.75 + commonY;

        fish.forEach(function (o) {
          if (o === f || !o.schooling) return;
          var sx = f.x - o.x;
          var sy = f.y - o.y;
          var sd = Math.hypot(sx, sy);
          if (sd > 0 && sd < 24) {
            wx += sx / sd * (24 - sd) * 0.08;
            wy += sy / sd * (24 - sd) * 0.08;
          }
        });
      }

      var margin = f.len * 0.85 + 18;
      if (f.x < margin) wx += (margin - f.x) / margin * 4.4;
      if (f.x > W - margin) wx -= (f.x - (W - margin)) / margin * 4.4;
      if (f.y < H * 0.08 + margin * 0.28) wy += 1.8;
      if (f.y > bottomY - margin * 0.45) wy -= 2.8;

      var target = Math.atan2(ay * 1.6 + wy, ax * 1.6 + wx);
      f.targetAngle = target;
      var diff = wrapAngle(f.targetAngle - f.angle);
      f.angle += clamp(diff, -f.turn * dt, f.turn * dt);
      f.angle += Math.sin(t * 0.8 + f.seed) * 0.018 * dt;

      var speedPulse = 1 + Math.sin(t * (0.6 + f.nervous * 0.12) + f.seed) * 0.12;
      var sp = f.speed * speedPulse * energy;
      f.vx = Math.cos(f.angle);
      f.vy = Math.sin(f.angle) * 0.86;
      f.x += f.vx * sp * dt;
      f.y += f.vy * sp * dt;
      f.y += Math.sin(t * 1.3 + f.seed) * 2.2 * dt;
      f.phase += dt * (5.2 + sp / Math.max(26, f.len) * 3.2) * f.nervous * energy;
    });
  }

  function updateAmbient(dt, t) {
    bubbles.forEach(function (b) {
      var baseX = b.cluster === null ? b.x : b.cluster;
      b.y -= b.vy * dt * energy;
      b.x += Math.sin(t * 1.7 + b.phase + b.y * 0.025) * 14 * dt;
      if (b.cluster !== null) b.x += (baseX - b.x) * 0.25 * dt;
      if (b.y < -18) {
        b.y = H + rnd(8, 170);
        b.x = b.cluster === null ? rnd(20, W - 20) : b.cluster + rnd(-18, 18);
        b.r = rnd(1.1, 5.7);
        b.vy = rnd(18, 68);
      }
    });

    motes.forEach(function (m) {
      m.x += (m.drift + Math.sin(t * 0.31 + m.y * 0.01) * 5) * dt * m.depth;
      m.y += Math.sin(t * 0.2 + m.x * 0.011) * dt * 4;
      if (m.x > W + 4) m.x = -4;
      if (m.x < -4) m.x = W + 4;
    });
  }

  function drawPlants(t) {
    ctx.save();
    ctx.lineCap = "round";
    plants.sort(function (a, b) { return a.y - b.y; });
    plants.forEach(function (p) {
      for (var i = 0; i < p.blades; i++) {
        var off = (i - p.blades / 2) * 4.2;
        var h = p.h * rndCached(Math.floor(p.x * 3 + i), 0.72, 1.18);
        var sway = Math.sin(t * 0.9 + p.phase + i * 0.8) * (10 + h * 0.055);
        var x0 = p.x + off;
        var y0 = p.y;
        var x1 = x0 + sway * 0.25;
        var y1 = y0 - h * 0.38;
        var x2 = x0 + sway;
        var y2 = y0 - h;
        var alpha = clamp(0.35 + (p.y - bottomY) / Math.max(1, H - bottomY) * 0.4, 0.28, 0.74);
        ctx.strokeStyle = "hsla(" + p.hue.toFixed(0) + ", 48%, " + (26 + i % 3 * 7) + "%, " + alpha.toFixed(3) + ")";
        ctx.lineWidth = p.thick * (1 - i / (p.blades * 1.8));
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(x1, y1, x2, y2);
        ctx.stroke();
        if (i % 2 === 0) {
          ctx.fillStyle = "hsla(" + (p.hue + 13).toFixed(0) + ", 48%, 38%, 0.32)";
          ctx.beginPath();
          ctx.ellipse(x1 + sway * 0.12, y1, 5.5, 13, Math.atan2(y2 - y0, x2 - x0), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    ctx.restore();
  }

  function fishPath(f, t) {
    var L = f.len;
    var Hh = f.bodyH;
    var amp = L * (f.schooling ? 0.035 : 0.027) + Math.abs(wrapAngle(f.targetAngle - f.angle)) * L * 0.025;
    var top = [];
    var bottom = [];
    var centers = [];
    for (var i = 0; i <= 18; i++) {
      var s = i / 18;
      var x = -L * 0.5 + s * L;
      var wave = Math.sin(f.phase + s * Math.PI * 2.05) * amp * Math.pow(1 - s, 0.72);
      var camber = Math.sin((s - 0.12) * Math.PI) * Hh * 0.025;
      var y = wave + camber;
      var profile = Math.pow(Math.sin(Math.PI * s), 0.64);
      var headBulge = Math.exp(-Math.pow((s - 0.78) / 0.2, 2)) * 0.32;
      var w = Hh * (0.10 + profile * 0.78 + headBulge);
      if (s < 0.09) w *= s / 0.09;
      if (s > 0.93) w *= (1 - s) / 0.07;

      var ds = 0.02;
      var s2 = clamp(s + ds, 0, 1);
      var wave2 = Math.sin(f.phase + s2 * Math.PI * 2.05) * amp * Math.pow(1 - s2, 0.72);
      var x2 = -L * 0.5 + s2 * L;
      var y2 = wave2 + Math.sin((s2 - 0.12) * Math.PI) * Hh * 0.025;
      var tx = x2 - x;
      var ty = y2 - y;
      var dl = Math.max(0.001, Math.hypot(tx, ty));
      var nx = -ty / dl;
      var ny = tx / dl;
      centers.push({ x: x, y: y, w: w, s: s });
      top.push({ x: x + nx * w, y: y + ny * w });
      bottom.push({ x: x - nx * w, y: y - ny * w });
    }
    return { top: top, bottom: bottom, centers: centers };
  }

  function drawFish(f, t) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    var scale = 0.88 + f.layer * 0.12;
    ctx.scale(scale, scale);

    var p = fishPath(f, t);
    var centers = p.centers;
    var tail = centers[0];
    var head = centers[centers.length - 1];
    var L = f.len;
    var Hh = f.bodyH;
    var tailBeat = Math.sin(f.phase) * (Hh * 0.58);
    var tailSweep = Math.cos(f.phase) * 0.18;

    ctx.save();
    ctx.globalAlpha = 0.44;
    ctx.fillStyle = f.fin;
    ctx.beginPath();
    ctx.moveTo(tail.x + Hh * 0.05, tail.y);
    ctx.quadraticCurveTo(tail.x - L * 0.16, tail.y - Hh * 0.8 + tailBeat * 0.34, tail.x - L * 0.31, tail.y - Hh * 0.43 + tailBeat);
    ctx.quadraticCurveTo(tail.x - L * 0.15, tail.y + tailBeat * 0.14, tail.x - L * 0.31, tail.y + Hh * 0.43 + tailBeat);
    ctx.quadraticCurveTo(tail.x - L * 0.16, tail.y + Hh * 0.8 + tailBeat * 0.34, tail.x + Hh * 0.05, tail.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    var grad = ctx.createLinearGradient(-L * 0.44, -Hh, L * 0.5, Hh);
    grad.addColorStop(0, f.body[1]);
    grad.addColorStop(0.43, f.body[0]);
    grad.addColorStop(0.72, f.body[2]);
    grad.addColorStop(1, f.body[1]);
    ctx.fillStyle = grad;
    ctx.beginPath();
    p.top.forEach(function (pt, i) {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    for (var i = p.bottom.length - 1; i >= 0; i--) ctx.lineTo(p.bottom[i].x, p.bottom[i].y);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    var shine = ctx.createLinearGradient(-L * 0.25, -Hh, L * 0.48, Hh * 0.15);
    shine.addColorStop(0, "rgba(255,255,255,0)");
    shine.addColorStop(0.45, "rgba(255,255,255,0.16)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.ellipse(L * 0.12, -Hh * 0.18, L * 0.33, Hh * 0.35, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(0,34,43,0.18)";
    ctx.lineWidth = Math.max(0.7, L * 0.012);
    ctx.stroke();

    drawSpeciesMarks(f, L, Hh);
    drawFins(f, L, Hh, t);
    drawHeadDetails(f, L, Hh);

    ctx.restore();
  }

  function drawSpeciesMarks(f, L, Hh) {
    ctx.save();
    ctx.globalAlpha = f.schooling ? 0.95 : 0.68;
    if (f.kind === "neon") {
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1.4, Hh * 0.18);
      ctx.strokeStyle = "#77fff7";
      ctx.beginPath();
      ctx.moveTo(-L * 0.3, -Hh * 0.12);
      ctx.quadraticCurveTo(0, -Hh * 0.2, L * 0.34, -Hh * 0.1);
      ctx.stroke();
      ctx.strokeStyle = f.stripe;
      ctx.lineWidth = Math.max(1.2, Hh * 0.14);
      ctx.beginPath();
      ctx.moveTo(-L * 0.26, Hh * 0.16);
      ctx.quadraticCurveTo(0, Hh * 0.22, L * 0.22, Hh * 0.17);
      ctx.stroke();
    } else if (f.kind === "angel") {
      ctx.strokeStyle = "rgba(15,38,42,0.48)";
      ctx.lineWidth = L * 0.035;
      [-0.19, 0.05, 0.28].forEach(function (x) {
        ctx.beginPath();
        ctx.moveTo(L * x, -Hh * 0.78);
        ctx.quadraticCurveTo(L * (x + 0.04), 0, L * (x - 0.02), Hh * 0.78);
        ctx.stroke();
      });
    } else if (f.kind === "blue") {
      ctx.strokeStyle = "rgba(255,227,88,0.86)";
      ctx.lineWidth = Hh * 0.17;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-L * 0.2, Hh * 0.02);
      ctx.quadraticCurveTo(L * 0.04, -Hh * 0.17, L * 0.31, -Hh * 0.08);
      ctx.stroke();
      ctx.strokeStyle = "rgba(1,28,67,0.44)";
      ctx.lineWidth = Hh * 0.11;
      ctx.beginPath();
      ctx.moveTo(-L * 0.33, -Hh * 0.06);
      ctx.quadraticCurveTo(-L * 0.06, Hh * 0.1, L * 0.18, Hh * 0.08);
      ctx.stroke();
    } else if (f.kind === "gold") {
      ctx.strokeStyle = "rgba(139,43,16,0.25)";
      ctx.lineWidth = 1.2;
      for (var i = 0; i < 5; i++) {
        var x = -L * 0.18 + i * L * 0.09;
        ctx.beginPath();
        ctx.moveTo(x, -Hh * 0.45);
        ctx.quadraticCurveTo(x + L * 0.02, 0, x - L * 0.01, Hh * 0.42);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = f.stripe;
      ctx.lineWidth = Hh * 0.08;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-L * 0.28, -Hh * 0.02);
      ctx.quadraticCurveTo(L * 0.05, -Hh * 0.12, L * 0.33, -Hh * 0.02);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFins(f, L, Hh, t) {
    var flap = Math.sin(f.phase * 0.74 + 0.8);
    ctx.save();
    ctx.fillStyle = f.fin;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 0.8;

    var dorsal = f.kind === "angel" ? 1.55 : 0.82;
    ctx.beginPath();
    ctx.moveTo(-L * 0.18, -Hh * 0.66);
    ctx.quadraticCurveTo(L * 0.02, -Hh * dorsal - Math.abs(flap) * Hh * 0.12, L * 0.25, -Hh * 0.49);
    ctx.quadraticCurveTo(L * 0.04, -Hh * 0.38, -L * 0.18, -Hh * 0.66);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-L * 0.08, Hh * 0.58);
    ctx.quadraticCurveTo(L * 0.06, Hh * (f.kind === "angel" ? 1.75 : 0.9) + Math.abs(flap) * Hh * 0.1, L * 0.24, Hh * 0.45);
    ctx.quadraticCurveTo(L * 0.02, Hh * 0.32, -L * 0.08, Hh * 0.58);
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = 0.52;
    ctx.beginPath();
    ctx.ellipse(L * 0.18, Hh * 0.25, L * 0.13, Hh * 0.11, 0.7 + flap * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(L * 0.2, -Hh * 0.24, L * 0.1, Hh * 0.075, -0.65 - flap * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHeadDetails(f, L, Hh) {
    ctx.save();
    var eyeX = L * 0.34;
    var eyeY = -Hh * 0.2;
    ctx.fillStyle = "rgba(255,255,245,0.92)";
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, Math.max(1.6, Hh * 0.115), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#071015";
    ctx.beginPath();
    ctx.arc(eyeX + Hh * 0.025, eyeY, Math.max(0.8, Hh * 0.055), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,34,43,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(L * 0.25, 0, Hh * 0.46, -0.92, 0.82);
    ctx.stroke();
    ctx.restore();
  }

  function drawBubbles(t) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    bubbles.forEach(function (b) {
      var alpha = b.alpha * clamp(1 - b.y / (H + 30), 0.15, 1);
      ctx.strokeStyle = "rgba(217,255,255," + alpha.toFixed(3) + ")";
      ctx.lineWidth = Math.max(0.8, b.r * 0.22);
      ctx.beginPath();
      ctx.arc(b.x + Math.sin(t * 2 + b.phase) * 2, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255," + (alpha * 0.55).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.28, b.y - b.r * 0.28, Math.max(0.55, b.r * 0.18), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawMotes(t) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    motes.forEach(function (m) {
      ctx.fillStyle = "rgba(208,244,231," + m.alpha.toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * m.depth, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawHaze(t) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.13 * hazeAmount;
    var scale = Math.max(W / noiseCanvas.width, H / noiseCanvas.height) * 1.15;
    var ox = Math.sin(t * 0.021) * 80 - 60;
    var oy = Math.cos(t * 0.017) * 50 - 40;
    ctx.drawImage(noiseCanvas, ox, oy, noiseCanvas.width * scale, noiseCanvas.height * scale);
    ctx.globalAlpha = 0.11 * hazeAmount;
    ctx.drawImage(noiseCanvas, ox + noiseCanvas.width * scale, oy, noiseCanvas.width * scale, noiseCanvas.height * scale);
    ctx.globalCompositeOperation = "source-over";
    var fog = ctx.createLinearGradient(0, 0, W, H);
    fog.addColorStop(0, "rgba(195,241,229," + (0.1 * hazeAmount).toFixed(3) + ")");
    fog.addColorStop(0.45, "rgba(64,161,160," + (0.055 * hazeAmount).toFixed(3) + ")");
    fog.addColorStop(1, "rgba(7,33,42," + (0.18 * hazeAmount).toFixed(3) + ")");
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawVignette() {
    ctx.save();
    var g = ctx.createRadialGradient(W * 0.52, H * 0.38, Math.min(W, H) * 0.18, W * 0.52, H * 0.45, Math.max(W, H) * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.72, "rgba(0,20,29,0.12)");
    g.addColorStop(1, "rgba(0,8,15,0.52)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!lastTime) lastTime = now;
    var dt = clamp((now - lastTime) / 1000, 0, 0.04);
    lastTime = now;
    if (paused) dt = 0;
    simTime += dt;

    energy = parseFloat(energyInput.value);
    hazeAmount = parseFloat(hazeInput.value);

    updateFish(dt, simTime);
    updateAmbient(dt, simTime);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackground(simTime);
    drawPlants(simTime);
    drawMotes(simTime);

    fish.sort(function (a, b) {
      return (a.y + a.layer * 30) - (b.y + b.layer * 30);
    });
    fish.forEach(function (f) {
      ctx.globalAlpha = clamp(0.76 + f.layer * 0.22, 0.74, 1);
      drawFish(f, simTime);
    });
    ctx.globalAlpha = 1;

    drawBubbles(simTime);
    drawHaze(simTime);
    drawVignette();
  }

  pauseButton.addEventListener("click", function () {
    paused = !paused;
    pauseButton.textContent = paused ? "Продолжить" : "Пауза";
  });

  window.addEventListener("resize", resize);
  makeNoise();
  resize();
  requestAnimationFrame(frame);
})();
