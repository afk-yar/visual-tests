'use strict';
(function () {

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d', { alpha: false });

  var W = 0, H = 0, CX = 0, CY = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    CX = W * 0.5;
    CY = H * 0.48;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.lineCap = 'round';
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, W, H);
  }
  window.addEventListener('resize', resize);

  // ---------------- Perlin noise (classic improved) ----------------
  var perm = new Uint8Array(512);
  (function () {
    var p = new Uint8Array(256), i, j, t;
    var seed = 20240815;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { j = (rnd() * (i + 1)) | 0; t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function grad(h, x, y, z) {
    h &= 15;
    var u = h < 8 ? x : y;
    var v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  function noise3(x, y, z) {
    var X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    var u = fade(x), v = fade(y), w = fade(z);
    var A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    var B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    var g = grad, P = perm;
    var x1, x2, y1, y2;
    x1 = (g(P[AA], x, y, z) + (g(P[BA], x - 1, y, z) - g(P[AA], x, y, z)) * u);
    x2 = (g(P[AB], x, y - 1, z) + (g(P[BB], x - 1, y - 1, z) - g(P[AB], x, y - 1, z)) * u);
    y1 = x1 + (x2 - x1) * v;
    x1 = (g(P[AA + 1], x, y, z - 1) + (g(P[BA + 1], x - 1, y, z - 1) - g(P[AA + 1], x, y, z - 1)) * u);
    x2 = (g(P[AB + 1], x, y - 1, z - 1) + (g(P[BB + 1], x - 1, y - 1, z - 1) - g(P[AB + 1], x, y - 1, z - 1)) * u);
    y2 = x1 + (x2 - x1) * v;
    return y1 + (y2 - y1) * w;
  }

  // ---------------- Velocity field ----------------
  // Divergence-free flow: v = grad(A) x grad(B) from two Perlin scalar
  // fields, precomputed on a coarse grid and trilinearly interpolated.
  var GN = 18;                 // grid nodes per axis
  var GB = 72;                 // grid half-extent (world units)
  var GCELL = (2 * GB) / (GN - 1);
  var INV_CELL = 1 / GCELL;
  var NOISE_S = 0.0115;
  var FD_E = 2.0;
  var gridV = new Float32Array(GN * GN * GN * 3);

  function buildGrid(t) {
    var tt = t * 0.055;
    var e = FD_E * NOISE_S;
    var i = 0, ix, iy, iz, x, y, z, xs, ys, zs;
    var maxM = 1e-9;
    for (iz = 0; iz < GN; iz++) {
      z = -GB + iz * GCELL; zs = z * NOISE_S + tt;
      for (iy = 0; iy < GN; iy++) {
        y = -GB + iy * GCELL; ys = y * NOISE_S;
        for (ix = 0; ix < GN; ix++) {
          x = -GB + ix * GCELL; xs = x * NOISE_S;
          var a0 = noise3(xs, ys, zs);
          var ax = noise3(xs + e, ys, zs) - a0;
          var ay = noise3(xs, ys + e, zs) - a0;
          var az = noise3(xs, ys, zs + e) - a0;
          var b0 = noise3(xs + 37.2, ys + 17.9, zs + 51.3);
          var bx = noise3(xs + e + 37.2, ys + 17.9, zs + 51.3) - b0;
          var by = noise3(xs + 37.2, ys + e + 17.9, zs + 51.3) - b0;
          var bz = noise3(xs + 37.2, ys + 17.9, zs + e + 51.3) - b0;
          var vx = ay * bz - az * by;
          var vy = az * bx - ax * bz;
          var vz = ax * by - ay * bx;
          gridV[i] = vx; gridV[i + 1] = vy; gridV[i + 2] = vz;
          var m = vx * vx + vy * vy + vz * vz;
          if (m > maxM) maxM = m;
          i += 3;
        }
      }
    }
    var inv = 1 / Math.sqrt(maxM);
    for (i = 0; i < gridV.length; i++) gridV[i] *= inv;
  }

  // ---------------- Particles ----------------
  var MAX = 80000;
  var RB = 62;                 // cloud kill radius
  var RB2 = RB * RB;
  var SWIRL = 0.10;

  var pxs = new Float32Array(MAX);
  var pys = new Float32Array(MAX);
  var pzs = new Float32Array(MAX);
  var life = new Float32Array(MAX);
  var spx = new Float32Array(MAX);
  var spy = new Float32Array(MAX);
  var onScreen = new Uint8Array(MAX);

  var count = 26000;
  var speedMul = 1.0;
  var persistence = 0.86;
  var colorMode = 'speed';

  function respawn(i) {
    var r = RB * 0.92 * Math.cbrt(Math.random());
    var th = Math.random() * 6.28318530718;
    var ph = Math.acos(2 * Math.random() - 1);
    pxs[i] = r * Math.sin(ph) * Math.cos(th);
    pys[i] = r * Math.cos(ph) * 0.8;
    pzs[i] = r * Math.sin(ph) * Math.sin(th);
    life[i] = 4 + Math.random() * 9;
    onScreen[i] = 0;
  }

  function respawnAll() {
    for (var i = 0; i < count; i++) respawn(i);
  }

  // ---------------- Render buckets (hue x depth) ----------------
  var HUES = 8, DEPS = 3, NB = HUES * DEPS;
  var segs = [];
  for (var bi = 0; bi < NB; bi++) segs.push(new Float32Array(MAX * 4));
  var counts = new Uint32Array(NB);
  var styles = new Array(NB);
  var lwidths = new Array(NB);
  var depAlpha = [0.52, 0.30, 0.14];
  var depLight = [64, 56, 46];
  var depWidth = [1.5, 1.05, 0.7];

  function rebuildStyles() {
    var sat = colorMode === 'nebula' ? 85 : 95;
    for (var h = 0; h < HUES; h++) {
      var hueC = (h + 0.5) * (360 / HUES);
      for (var d = 0; d < DEPS; d++) {
        styles[h * DEPS + d] = 'hsla(' + hueC.toFixed(1) + ',' + sat + '%,' +
          depLight[d] + '%,' + depAlpha[d] + ')';
        lwidths[h * DEPS + d] = depWidth[d];
      }
    }
  }

  // ---------------- Haze sprites ----------------
  function makeSprite(hue) {
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var g = c.getContext('2d');
    var gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'hsla(' + hue + ',90%,62%,0.5)');
    gr.addColorStop(0.35, 'hsla(' + hue + ',90%,56%,0.16)');
    gr.addColorStop(1, 'hsla(' + hue + ',90%,50%,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    return c;
  }
  var sprites = [makeSprite(218), makeSprite(288), makeSprite(36)];
  var blobs = [];
  (function () {
    for (var i = 0; i < 8; i++) {
      blobs.push({
        x: (Math.random() * 2 - 1) * 55,
        y: (Math.random() * 2 - 1) * 34,
        z: (Math.random() * 2 - 1) * 55,
        size: 60 + Math.random() * 110,
        spr: (Math.random() * sprites.length) | 0,
        alpha: 0.045 + Math.random() * 0.05,
        ph: Math.random() * 6.283
      });
    }
    // bright core
    blobs.push({ x: 0, y: 0, z: 0, size: 170, spr: 0, alpha: 0.075, ph: 0 });
  })();

  // ---------------- UI ----------------
  var $ = function (id) { return document.getElementById(id); };
  var statsEl = $('stats');
  var paused = false;

  function fmt(n) { return n.toLocaleString('ru-RU'); }

  $('count').addEventListener('input', function () {
    count = +this.value;
    $('countVal').textContent = fmt(count);
    respawnAll();
  });
  $('speed').addEventListener('input', function () {
    speedMul = +this.value;
    $('speedVal').textContent = speedMul.toFixed(2);
  });
  $('trail').addEventListener('input', function () {
    persistence = +this.value;
    $('trailVal').textContent = persistence.toFixed(2);
  });
  $('colorMode').addEventListener('change', function () {
    colorMode = this.value;
    rebuildStyles();
  });
  $('pause').addEventListener('click', function () {
    paused = !paused;
    this.textContent = paused ? 'Продолжить' : 'Пауза';
  });

  // ---------------- Main loop ----------------
  var last = performance.now();
  var simT = 0, frame = 0;
  var fpsEMA = 60, statT = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    var rawDt = (now - last) / 1000;
    last = now;
    if (rawDt > 0) fpsEMA = fpsEMA * 0.95 + Math.min(1 / rawDt, 240) * 0.05;
    if (paused) return;

    var dt = rawDt;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;
    simT += dt;
    frame++;

    // camera: slow orbit + breathing distance + gentle pitch sway
    var yaw = simT * 0.10;
    var pitch = 0.30 + Math.sin(simT * 0.07) * 0.12;
    var camDist = 152 + Math.sin(simT * 0.045) * 12;
    var cyA = Math.cos(yaw), syA = Math.sin(yaw);
    var cpA = Math.cos(pitch), spA = Math.sin(pitch);
    var focal = Math.min(W, H) * 1.05;

    // refresh velocity field every other frame
    if ((frame & 1) === 0) buildGrid(simT);

    // trail fade (framerate-independent)
    ctx.globalCompositeOperation = 'source-over';
    var fadeA = 1 - Math.pow(persistence, dt * 60);
    ctx.fillStyle = 'rgba(4,6,12,' + fadeA.toFixed(4) + ')';
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'lighter';

    // haze blobs
    var bi2, bl;
    for (bi2 = 0; bi2 < blobs.length; bi2++) {
      bl = blobs[bi2];
      var bxw = bl.x + Math.sin(simT * 0.05 + bl.ph) * 8;
      var bzw = bl.z + Math.cos(simT * 0.04 + bl.ph * 1.7) * 8;
      var x1 = bxw * cyA + bzw * syA;
      var z1 = -bxw * syA + bzw * cyA;
      var y1 = bl.y * cpA - z1 * spA;
      var z2 = bl.y * spA + z1 * cpA + camDist;
      if (z2 < 20) continue;
      var f = focal / z2;
      var s = bl.size * f;
      ctx.globalAlpha = bl.alpha;
      ctx.drawImage(sprites[bl.spr], CX + x1 * f - s * 0.5, CY - y1 * f - s * 0.5, s, s);
    }
    ctx.globalAlpha = 1;

    // particles: integrate + project + collect streak segments
    var bs = 26 * speedMul;
    var i, x, y, z;
    for (i = 0; i < count; i++) {
      x = pxs[i]; y = pys[i]; z = pzs[i];

      var gx = (x + GB) * INV_CELL;
      var gy = (y + GB) * INV_CELL;
      var gz = (z + GB) * INV_CELL;
      if (gx < 0) gx = 0; else if (gx > GN - 1.001) gx = GN - 1.001;
      if (gy < 0) gy = 0; else if (gy > GN - 1.001) gy = GN - 1.001;
      if (gz < 0) gz = 0; else if (gz > GN - 1.001) gz = GN - 1.001;
      var x0 = gx | 0, y0 = gy | 0, z0 = gz | 0;
      var fx = gx - x0, fy = gy - y0, fz = gz - z0;
      var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
      var w01 = (1 - fx) * fy, w11 = fx * fy;
      var b000 = ((z0 * GN + y0) * GN + x0) * 3;
      var b100 = b000 + 3, b010 = b000 + GN * 3, b110 = b010 + 3;
      var b001 = b000 + GN * GN * 3, b101 = b001 + 3, b011 = b001 + GN * 3, b111 = b011 + 3;
      var ifz = 1 - fz;
      var vx = (gridV[b000] * w00 + gridV[b100] * w10 + gridV[b010] * w01 + gridV[b110] * w11) * ifz
             + (gridV[b001] * w00 + gridV[b101] * w10 + gridV[b011] * w01 + gridV[b111] * w11) * fz;
      var vy = (gridV[b000 + 1] * w00 + gridV[b100 + 1] * w10 + gridV[b010 + 1] * w01 + gridV[b110 + 1] * w11) * ifz
             + (gridV[b001 + 1] * w00 + gridV[b101 + 1] * w10 + gridV[b011 + 1] * w01 + gridV[b111 + 1] * w11) * fz;
      var vz = (gridV[b000 + 2] * w00 + gridV[b100 + 2] * w10 + gridV[b010 + 2] * w01 + gridV[b110 + 2] * w11) * ifz
             + (gridV[b001 + 2] * w00 + gridV[b101 + 2] * w10 + gridV[b011 + 2] * w01 + gridV[b111 + 2] * w11) * fz;

      var wx = vx * bs - z * SWIRL;
      var wy = vy * bs;
      var wz = vz * bs + x * SWIRL;

      x += wx * dt; y += wy * dt; z += wz * dt;

      life[i] -= dt;
      var r2 = x * x + y * y * 1.4 + z * z;
      if (life[i] <= 0 || r2 > RB2) {
        respawn(i);
        x = pxs[i]; y = pys[i]; z = pzs[i];
      } else {
        pxs[i] = x; pys[i] = y; pzs[i] = z;
      }

      // camera transform
      x1 = x * cyA + z * syA;
      z1 = -x * syA + z * cyA;
      y1 = y * cpA - z1 * spA;
      z2 = y * spA + z1 * cpA + camDist;
      if (z2 < 14) { onScreen[i] = 0; continue; }
      f = focal / z2;
      var sx = CX + x1 * f;
      var sy2 = CY - y1 * f;
      if (sx < -60 || sx > W + 60 || sy2 < -60 || sy2 > H + 60) { onScreen[i] = 0; continue; }

      var depthN = (z2 - 60) * 0.0042;
      if (depthN < 0) depthN = 0; else if (depthN > 1) depthN = 1;
      var speedN = Math.sqrt(wx * wx + wy * wy + wz * wz) * 0.022;
      if (speedN > 1) speedN = 1;

      var hue;
      if (colorMode === 'speed') hue = 212 + speedN * 148;
      else if (colorMode === 'depth') hue = 28 + depthN * 188;
      else hue = ((Math.atan2(z, x) * 57.29578 + simT * 9) % 360 + 360) % 360;

      var hi = (hue * (HUES / 360)) | 0;
      if (hi >= HUES) hi = HUES - 1;
      var di = (depthN * DEPS) | 0;
      if (di >= DEPS) di = DEPS - 1;
      var b = hi * DEPS + di;

      if (onScreen[i]) {
        var c4 = counts[b] * 4;
        var arr = segs[b];
        arr[c4] = spx[i]; arr[c4 + 1] = spy[i];
        arr[c4 + 2] = sx; arr[c4 + 3] = sy2;
        counts[b]++;
      }
      spx[i] = sx; spy[i] = sy2;
      onScreen[i] = 1;
    }

    // stroke buckets
    for (b = 0; b < NB; b++) {
      var cnt = counts[b];
      if (!cnt) continue;
      ctx.strokeStyle = styles[b];
      ctx.lineWidth = lwidths[b];
      ctx.beginPath();
      arr = segs[b];
      for (var k = 0; k < cnt; k++) {
        var o = k * 4;
        ctx.moveTo(arr[o], arr[o + 1]);
        ctx.lineTo(arr[o + 2], arr[o + 3]);
      }
      ctx.stroke();
      counts[b] = 0;
    }

    // stats
    statT += dt;
    if (statT > 0.5) {
      statT = 0;
      statsEl.textContent = fmt(count) + ' частиц · ' + Math.round(fpsEMA) + ' fps';
    }
  }

  // ---------------- Init ----------------
  resize();
  rebuildStyles();
  buildGrid(0);
  respawnAll();
  requestAnimationFrame(loop);
})();
