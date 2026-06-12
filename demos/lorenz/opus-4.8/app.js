// Lorenz attractor — real-time canvas 2D renderer with manual 3D projection.
(function () {
  'use strict';

  var L = window.Lorenz;
  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');

  // ---- View / sizing -------------------------------------------------------
  var W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- Simulation state ----------------------------------------------------
  var DT = 0.005;             // integration step
  var START = [0.1, 0, 0];    // initial point near (0.1, 0, 0)

  var point = START.slice();
  var trail = [];             // ring of recent world points {x,y,z}
  var maxTrail = 3000;        // bounded — set from slider
  var head = 0;               // ring write index
  var filled = 0;             // how many slots are valid

  function resetSim() {
    point = START.slice();
    trail = [];
    head = 0;
    filled = 0;
    yaw = 0;
    // Warm-up: step onto the attractor so the opening frames already look
    // like the butterfly instead of a lonely point crawling out of origin.
    for (var i = 0; i < 1500; i++) {
      point = L.rk4Step(point, DT);
      pushTrail(point);
    }
  }

  function pushTrail(p) {
    var slot = { x: p[0], y: p[1], z: p[2] };
    if (filled < maxTrail) {
      trail.push(slot);
      filled++;
      head = filled % maxTrail;
    } else {
      trail[head] = slot;
      head = (head + 1) % maxTrail;
    }
  }

  // Iterate the ring oldest -> newest, calling fn(slot, ageFraction)
  // where ageFraction goes 0 (oldest) .. 1 (newest).
  function eachTrail(fn) {
    if (filled === 0) return;
    var n = filled;
    var startIdx = filled < maxTrail ? 0 : head; // oldest
    for (var i = 0; i < n; i++) {
      var idx = (startIdx + i) % n;
      fn(trail[idx], n > 1 ? i / (n - 1) : 1);
    }
  }

  // ---- Camera --------------------------------------------------------------
  var yaw = 0;               // start broad-side: widest, classic butterfly
  var tilt = 0.42;           // gentle downward look (~24°) — classic butterfly
  var spinEnabled = true;
  var SPIN_RATE = 0.18;       // rad/s — slow auto-rotation

  function autoScale() {
    // Fit the attractor (~half-width 25 in x/y, height ~25 in z) into view.
    var s = Math.min(W, H) / 60;
    return Math.max(2.4, s);
  }

  // ---- Color: smooth gradient along the trajectory -------------------------
  // HSL sweep cyan -> blue -> violet -> magenta, matching the polygon accent.
  function gradientColor(t, alpha) {
    var hue = 188 + t * 130;          // 188 (cyan) .. 318 (magenta)
    var light = 52 + Math.sin(t * Math.PI) * 12;
    return 'hsla(' + hue.toFixed(1) + ', 92%, ' + light.toFixed(1) + '%, ' + alpha + ')';
  }

  // ---- Controls ------------------------------------------------------------
  var running = true;
  var speedMul = 1;

  var btnPlay = document.getElementById('playPause');
  var btnReset = document.getElementById('reset');
  var btnSpin = document.getElementById('spin');
  var speedInput = document.getElementById('speed');
  var trailInput = document.getElementById('trail');

  btnPlay.addEventListener('click', function () {
    running = !running;
    btnPlay.textContent = running ? 'Пауза' : 'Старт';
  });
  btnReset.addEventListener('click', function () {
    resetSim();
  });
  btnSpin.addEventListener('click', function () {
    spinEnabled = !spinEnabled;
    btnSpin.classList.toggle('on', spinEnabled);
  });
  speedInput.addEventListener('input', function () {
    speedMul = parseFloat(speedInput.value);
  });
  trailInput.addEventListener('input', function () {
    var next = parseInt(trailInput.value, 10);
    // Rebuild the ring at the new length, keeping the most recent points.
    var ordered = [];
    eachTrail(function (slot) { ordered.push(slot); });
    if (ordered.length > next) ordered = ordered.slice(ordered.length - next);
    maxTrail = next;
    trail = ordered.slice();
    filled = trail.length;
    head = filled % maxTrail;
  });

  // ---- Main loop (FPS-independent via fixed-dt accumulator) -----------------
  var last = performance.now();
  var acc = 0;
  var SUBSTEP = DT;                 // sim seconds advanced per integration step
  var MAX_STEPS_PER_FRAME = 600;    // guard against spiral-of-death

  resetSim();

  function frame(now) {
    var elapsed = Math.min((now - last) / 1000, 0.05); // clamp tab-switch gaps
    last = now;

    if (running) {
      acc += elapsed * speedMul;
      var steps = Math.floor(acc / SUBSTEP);
      if (steps > MAX_STEPS_PER_FRAME) steps = MAX_STEPS_PER_FRAME;
      acc -= steps * SUBSTEP;
      for (var i = 0; i < steps; i++) {
        point = L.rk4Step(point, DT);
        pushTrail(point);
      }
    }

    if (spinEnabled) {
      yaw += SPIN_RATE * elapsed;
      if (yaw > Math.PI * 2) yaw -= Math.PI * 2;
    }

    render();
    requestAnimationFrame(frame);
  }

  // ---- Render --------------------------------------------------------------
  function render() {
    // Trailing fade for motion blur / glow accumulation.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(8, 10, 15, 0.32)';
    ctx.fillRect(0, 0, W, H);

    if (filled < 2) return;

    var scale = autoScale();
    var opts = { yaw: yaw, tilt: tilt, scale: scale, cx: W / 2, cy: H / 2 };

    // Project all points once.
    var pts = new Array(filled);
    var k = 0;
    eachTrail(function (slot, t) {
      var pr = L.project([slot.x, slot.y, slot.z], opts);
      pts[k++] = { x: pr.x, y: pr.y, depth: pr.depth, t: t };
    });

    // Depth range for fog/size cues.
    var minD = Infinity, maxD = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].depth < minD) minD = pts[i].depth;
      if (pts[i].depth > maxD) maxD = pts[i].depth;
    }
    var span = (maxD - minD) || 1;

    // Additive glow pass for the luminous ribbon.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (var j = 1; j < pts.length; j++) {
      var a = pts[j - 1];
      var b = pts[j];

      // Age-based opacity: older points fade out (damped trail).
      var age = b.t;
      var ageAlpha = Math.pow(age, 1.6);          // newest brightest
      if (ageAlpha < 0.01) continue;

      // Depth shading: nearer = brighter & thicker.
      var dn = (b.depth - minD) / span;           // 0 far .. 1 near
      var depthAlpha = 0.35 + 0.65 * dn;
      var alpha = ageAlpha * depthAlpha;

      var width = (0.5 + 2.4 * dn) * (0.5 + age);

      ctx.strokeStyle = gradientColor(b.t, (alpha * 0.85).toFixed(3));
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Bright moving head with a soft halo.
    var headPt = pts[pts.length - 1];
    if (headPt) {
      ctx.fillStyle = gradientColor(1, '0.95');
      ctx.beginPath();
      ctx.arc(headPt.x, headPt.y, 3.0, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = 'lighter';
      var glow = ctx.createRadialGradient(headPt.x, headPt.y, 0, headPt.x, headPt.y, 22);
      glow.addColorStop(0, 'rgba(140, 235, 255, 0.55)');
      glow.addColorStop(1, 'rgba(140, 235, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(headPt.x, headPt.y, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  requestAnimationFrame(frame);
})();
