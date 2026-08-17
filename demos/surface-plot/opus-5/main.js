/* main.js — рендер 3D-поверхности на Canvas 2D. */
(function () {
  'use strict';

  var S = window.Surface;
  var RAD = Math.PI / 180;
  var FOV = 38 * RAD;
  var EL_MIN = 3 * RAD, EL_MAX = 82 * RAD;
  var ZOOM_MIN = 0.6, ZOOM_MAX = 1.7;

  var HEX = new Array(256);
  for (var _h = 0; _h < 256; _h++) HEX[_h] = (_h < 16 ? '0' : '') + _h.toString(16);

  function $(id) { return document.getElementById(id); }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

  var canvas = $('scene');
  var ctx = canvas.getContext('2d', { alpha: false });

  var ui = {
    funcs: $('funcs'),
    fn: $('m-fn'), formula: $('m-formula'), hint: $('m-hint'),
    quads: $('m-quads'), fps: $('m-fps'),
    sElev: $('s-elev'), vElev: $('v-elev'),
    sSpin: $('s-spin'), vSpin: $('v-spin'),
    sFlow: $('s-flow'), vFlow: $('v-flow'),
    sAmp: $('s-amp'), vAmp: $('v-amp'),
    sGrid: $('s-grid'), vGrid: $('v-grid'),
    bWire: $('b-wire'), bPause: $('b-pause'), bReset: $('b-reset')
  };

  var st = {
    fnIndex: 0, prevIndex: 0, morph: 1,
    N: 72, amp: 0.42,
    elev: 27 * RAD, az: -0.78, zoom: 1,
    spin: 1, flow: 1,
    wire: false, paused: false,
    time: 0, dt: 1 / 60, span: 1, gridLocked: false
  };

  var view = { w: 0, h: 0, dpr: 1 };
  var bgLin = null, bgGlow = null, vign = null;
  var LUTN = 256;
  var LUT = S.makeLUT(LUTN);
  var G = null;

  /* ------------------------------------------------------------------ */
  /*  Буферы сетки                                                       */
  /* ------------------------------------------------------------------ */

  function allocGrid(N) {
    var n = N * N;
    G = {
      N: N,
      hA: new Float32Array(n),
      hB: new Float32Array(n),
      hMix: new Float32Array(n),
      nrm: new Float32Array(n * 3),
      sx: new Float32Array(n),
      sy: new Float32Array(n),
      vz: new Float32Array(n),
      iOrder: new Int32Array(N - 1),
      jOrder: new Int32Array(N - 1)
    };
    var q = (N - 1) * (N - 1);
    ui.quads.textContent = String(q).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function setGrid(N, fromUser) {
    N = Math.round(clamp(N, 16, 220));
    if (fromUser) st.gridLocked = true;
    if (G && G.N === N) return;
    st.N = N;
    allocGrid(N);
    ui.vGrid.textContent = String(N);
    if (ui.sGrid.value !== String(N)) ui.sGrid.value = String(N);
  }

  /* ------------------------------------------------------------------ */
  /*  Размер холста и фоновые градиенты                                  */
  /* ------------------------------------------------------------------ */

  function buildBackdrops(w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#101827');
    g.addColorStop(0.52, '#090f1a');
    g.addColorStop(1, '#04070d');
    bgLin = g;

    var cx = w * 0.5, cy = h * 0.44;
    var rad = Math.max(w, h) * 0.62;
    var gl = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    gl.addColorStop(0, 'rgba(70, 124, 196, 0.24)');
    gl.addColorStop(0.55, 'rgba(48, 86, 148, 0.08)');
    gl.addColorStop(1, 'rgba(0, 0, 0, 0)');
    bgGlow = gl;

    var vg = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.28, cx, cy, Math.max(w, h) * 0.78);
    vg.addColorStop(0, 'rgba(3, 6, 12, 0)');
    vg.addColorStop(1, 'rgba(3, 6, 12, 0.62)');
    vign = vg;
  }

  function resize() {
    var w = canvas.clientWidth || window.innerWidth || 1;
    var h = canvas.clientHeight || window.innerHeight || 1;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === view.w && h === view.h && dpr === view.dpr) return;
    view.w = w; view.h = h; view.dpr = dpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    buildBackdrops(w, h);
  }

  /* ------------------------------------------------------------------ */
  /*  Отрисовка                                                          */
  /* ------------------------------------------------------------------ */

  function drawSurface(cam, H, invSpan) {
    var N = G.N, M = N - 1;
    var sx = G.sx, sy = G.sy, vz = G.vz, nrm = G.nrm;
    var iO = G.iOrder, jO = G.jOrder;
    var amp = st.amp, step = 2 / (N - 1);

    // Направление на камеру (усреднённое) — для света в мировых осях.
    var ex = -cam.fx, ey = -cam.fy, ez = -cam.fz;

    // Ключевой свет: сверху-слева относительно камеры.
    var l1x = 0.58 * ex + 0.74 * cam.ux - 0.44 * cam.rx;
    var l1y = 0.58 * ey + 0.74 * cam.uy - 0.44 * cam.ry;
    var l1z = 0.58 * ez + 0.74 * cam.uz - 0.44 * cam.rz;
    var li = 1 / Math.sqrt(l1x * l1x + l1y * l1y + l1z * l1z);
    l1x *= li; l1y *= li; l1z *= li;

    // Заполняющий холодный свет снизу-справа.
    var l2x = 0.30 * ex - 0.66 * cam.ux + 0.62 * cam.rx;
    var l2y = 0.30 * ey - 0.66 * cam.uy + 0.62 * cam.ry;
    var l2z = 0.30 * ez - 0.66 * cam.uz + 0.62 * cam.rz;
    li = 1 / Math.sqrt(l2x * l2x + l2y * l2y + l2z * l2z);
    l2x *= li; l2y *= li; l2z *= li;

    var AMB = 0.22, KEY = 0.88, BOUNCE = 0.36;
    var fogA = cam.dist - 1.55, fogB = cam.dist + 1.85, fogK = 1 / (fogB - fogA);
    var FR = 13, FG = 20, FB = 34;

    var wire = st.wire;
    ctx.lineJoin = 'round';
    ctx.lineWidth = wire ? 0.7 : 1;

    for (var a = 0; a < M; a++) {
      var i = iO[a];
      var xw = -1 + step * (i + 0.5);
      for (var b = 0; b < M; b++) {
        var j = jO[b];
        var k0 = j * N + i, k1 = k0 + 1, k3 = k0 + N, k2 = k3 + 1;

        var z0 = vz[k0], z1 = vz[k1], z2 = vz[k2], z3 = vz[k3];
        if (z0 <= 0.02 || z1 <= 0.02 || z2 <= 0.02 || z3 <= 0.02) continue;

        // --- нормаль грани = среднее нормалей четырёх узлов ---
        var o0 = k0 * 3, o1 = k1 * 3, o2 = k2 * 3, o3 = k3 * 3;
        var nx = (nrm[o0] + nrm[o1] + nrm[o2] + nrm[o3]) * 0.25;
        var ny = (nrm[o0 + 1] + nrm[o1 + 1] + nrm[o2 + 1] + nrm[o3 + 1]) * 0.25;
        var nz = (nrm[o0 + 2] + nrm[o1 + 2] + nrm[o2 + 2] + nrm[o3 + 2]) * 0.25;
        var nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + 1e-12);
        nx *= nl; ny *= nl; nz *= nl;

        // --- взгляд из центра грани ---
        var hAvg = (H[k0] + H[k1] + H[k2] + H[k3]) * 0.25;
        var vx = cam.px - xw;
        var vy = cam.py - (-1 + step * (j + 0.5));
        var vv = cam.pz - hAvg * amp;
        var vi = 1 / Math.sqrt(vx * vx + vy * vy + vv * vv);
        vx *= vi; vy *= vi; vv *= vi;

        // двусторонняя заливка: нормаль всегда к зрителю
        if (nx * vx + ny * vy + nz * vv < 0) { nx = -nx; ny = -ny; nz = -nz; }

        var dk = nx * l1x + ny * l1y + nz * l1z;
        var d1 = dk > 0 ? dk : 0;
        // «отражённый» свет с изнанки: обратная сторона листа не проваливается
        // в чёрное и сохраняет цвет высоты
        var d3 = dk < 0 ? -dk : 0;
        var d2 = nx * l2x + ny * l2y + nz * l2z; if (d2 < 0) d2 = 0;

        // блик Блинна — Фонга, показатель 32
        var hx = l1x + vx, hy = l1y + vy, hz = l1z + vv;
        var hn = 1 / Math.sqrt(hx * hx + hy * hy + hz * hz);
        var sp = (nx * hx + ny * hy + nz * hz) * hn; if (sp < 0) sp = 0;
        sp *= sp; sp *= sp; sp *= sp; sp *= sp; sp *= sp;
        sp *= 0.5 * d1;

        // --- цвет по высоте (нормировка на сглаженный размах поля) ---
        var tt = hAvg * invSpan + 0.5;
        var ci = (tt <= 0 ? 0 : (tt >= 1 ? LUTN - 1 : (tt * (LUTN - 1)) | 0)) * 3;
        var lit = AMB + KEY * d1 + BOUNCE * d3;
        var r = LUT[ci] * lit + d2 * 15 + sp * 235;
        var g = LUT[ci + 1] * lit + d2 * 23 + sp * 242;
        var bl = LUT[ci + 2] * lit + d2 * 42 + sp * 252;

        // --- дымка по глубине ---
        var ft = ((z0 + z1 + z2 + z3) * 0.25 - fogA) * fogK;
        if (ft > 0) {
          if (ft > 1) ft = 1;
          ft = ft * ft * (3 - 2 * ft) * 0.32;
          r += (FR - r) * ft; g += (FG - g) * ft; bl += (FB - bl) * ft;
        }

        var ri = r < 0 ? 0 : (r > 255 ? 255 : r) | 0;
        var gi = g < 0 ? 0 : (g > 255 ? 255 : g) | 0;
        var bi = bl < 0 ? 0 : (bl > 255 ? 255 : bl) | 0;
        var col = '#' + HEX[ri] + HEX[gi] + HEX[bi];

        ctx.beginPath();
        ctx.moveTo(sx[k0], sy[k0]);
        ctx.lineTo(sx[k1], sy[k1]);
        ctx.lineTo(sx[k2], sy[k2]);
        ctx.lineTo(sx[k3], sy[k3]);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();

        // Обводка тем же цветом заклеивает щели между соседними квадами;
        // в режиме каркаса — притемнённая, работает как сетка с корректным
        // удалением невидимых линий (рисуется в том же порядке художника).
        ctx.strokeStyle = wire
          ? '#' + HEX[(ri * 0.34) | 0] + HEX[(gi * 0.34) | 0] + HEX[(bi * 0.42) | 0]
          : col;
        ctx.stroke();
      }
    }
  }

  function render() {
    var w = view.w, h = view.h;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = bgLin; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = bgGlow; ctx.fillRect(0, 0, w, h);

    var N = G.N, n = N * N;
    var fnNew = S.FUNCS[st.fnIndex];
    var H;
    S.fillHeights(fnNew, N, st.time, G.hB);
    if (st.morph < 1) {
      S.fillHeights(S.FUNCS[st.prevIndex], N, st.time, G.hA);
      S.blendHeights(G.hA, G.hB, S.smoothstep(st.morph), G.hMix, n);
      H = G.hMix;
    } else {
      H = G.hB;
    }

    S.computeNormals(H, N, st.amp, G.nrm);

    // Размах поля: сглаживаем во времени, иначе цвет и кадр будут дёргаться.
    var span = Math.max(0.28, S.maxAbs(H, n));
    var lag = 1 - Math.exp(-st.dt / 0.45);
    st.span += (span - st.span) * lag;

    // Кадр подгоняется под наклон и текущий размах: при виде сверху габарит
    // шире, при виде с ребра — выше, и камера отъезжает ровно настолько.
    var zmax = st.span * st.amp;
    var focal = 0.5 * Math.min(w, h) / Math.tan(FOV * 0.5);
    var fit = S.fitDistance(focal, st.elev, Math.SQRT2, zmax, 0.50 * w, 0.46 * h);
    var dist = Math.max(fit / st.zoom, Math.SQRT2 + zmax + 0.3);

    var cam = S.makeCamera({
      az: st.az, el: st.elev, dist: dist,
      fov: FOV, w: w, h: h, cx: w * 0.5, cy: h * 0.44
    });

    S.projectAll(N, H, st.amp, cam, G.sx, G.sy, G.vz);
    S.buildOrder(N, cam.px, cam.py, G.iOrder, G.jOrder);
    drawSurface(cam, H, 0.5 / st.span);

    ctx.fillStyle = vign; ctx.fillRect(0, 0, w, h);
  }

  /* ------------------------------------------------------------------ */
  /*  Цикл                                                               */
  /* ------------------------------------------------------------------ */

  var last = 0, acc = 0, frames = 0, drops = 0;

  function loop(now) {
    window.requestAnimationFrame(loop);
    if (!last) last = now;
    var dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    st.dt = dt;

    if (!st.paused) {
      st.time += dt * st.flow;
      st.az += dt * st.spin * 0.26;
      if (st.az > Math.PI * 4) st.az -= Math.PI * 4;
      else if (st.az < -Math.PI * 4) st.az += Math.PI * 4;
    }
    if (st.morph < 1) st.morph = Math.min(1, st.morph + dt / 0.6);

    resize();
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    render();
    var t1 = (window.performance && performance.now) ? performance.now() : Date.now();

    acc += (t1 - t0);
    frames++;
    if (frames >= 30) {
      var avg = acc / frames;
      ui.fps.textContent = avg.toFixed(1) + ' мс · ' + Math.round(1000 / Math.max(avg, 1)) + ' к/с';
      acc = 0; frames = 0;
      // Мягкая авто-деградация сетки на слабом железе (пока пользователь
      // не тронул ползунок «Сетка» — тогда решает он).
      if (!st.gridLocked && drops < 3 && avg > 26 && st.N > 44) {
        drops++;
        setGrid(st.N - 14, false);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Интерфейс                                                          */
  /* ------------------------------------------------------------------ */

  function syncFunc() {
    var f = S.FUNCS[st.fnIndex];
    ui.fn.textContent = f.label;
    ui.formula.textContent = f.formula;
    ui.formula.title = f.formula;
    ui.hint.textContent = f.hint;
    var kids = ui.funcs.children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].setAttribute('aria-pressed', i === st.fnIndex ? 'true' : 'false');
    }
  }

  function setFunc(idx) {
    if (idx < 0 || idx >= S.FUNCS.length || idx === st.fnIndex) return;
    st.prevIndex = st.fnIndex;
    st.fnIndex = idx;
    st.morph = 0;
    syncFunc();
  }

  S.FUNCS.forEach(function (f, idx) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sgb';
    b.textContent = f.label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { setFunc(idx); });
    ui.funcs.appendChild(b);
  });

  function setElev(rad) {
    st.elev = clamp(rad, EL_MIN, EL_MAX);
    var deg = Math.round(st.elev / RAD);
    ui.vElev.textContent = deg + '°';
    if (ui.sElev.value !== String(deg)) ui.sElev.value = String(deg);
  }

  ui.sElev.addEventListener('input', function () { setElev(parseFloat(ui.sElev.value) * RAD); });
  ui.sSpin.addEventListener('input', function () {
    st.spin = parseFloat(ui.sSpin.value) / 100;
    ui.vSpin.textContent = st.spin.toFixed(1) + '×';
  });
  ui.sFlow.addEventListener('input', function () {
    st.flow = parseFloat(ui.sFlow.value) / 100;
    ui.vFlow.textContent = st.flow.toFixed(1) + '×';
  });
  ui.sAmp.addEventListener('input', function () {
    st.amp = parseFloat(ui.sAmp.value) / 100;
    ui.vAmp.textContent = st.amp.toFixed(2);
  });
  ui.sGrid.addEventListener('input', function () { setGrid(parseFloat(ui.sGrid.value), true); });

  ui.bWire.addEventListener('click', function () {
    st.wire = !st.wire;
    ui.bWire.setAttribute('aria-pressed', st.wire ? 'true' : 'false');
  });
  ui.bPause.addEventListener('click', function () {
    st.paused = !st.paused;
    ui.bPause.setAttribute('aria-pressed', st.paused ? 'true' : 'false');
  });
  ui.bReset.addEventListener('click', function () {
    st.az = -0.78; st.zoom = 1;
    setElev(27 * RAD);
  });

  /* --- орбита мышью / пальцем --- */
  var drag = null;
  canvas.addEventListener('pointerdown', function (e) {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* нестрашно */ } }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    st.az -= (e.clientX - drag.x) * 0.0062;
    setElev(st.elev - (e.clientY - drag.y) * 0.0045);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  function endDrag(e) {
    if (drag && e.pointerId === drag.id) drag = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var d = e.deltaY * (e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 320 : 1));
    st.zoom = clamp(st.zoom * Math.exp(-d * 0.0013), ZOOM_MIN, ZOOM_MAX);
  }, { passive: false });

  /* --- клавиатура --- */
  window.addEventListener('keydown', function (e) {
    var tn = e.target && e.target.tagName;
    if (tn === 'INPUT' || tn === 'BUTTON' || tn === 'SELECT' || tn === 'TEXTAREA') return;
    var k = e.key;
    if (k >= '1' && k <= '9') { setFunc(k.charCodeAt(0) - 49); return; }
    var lk = typeof k === 'string' ? k.toLowerCase() : '';
    if (lk === 'w' || lk === 'ц') { e.preventDefault(); ui.bWire.click(); }
    else if (k === ' ' || lk === 'spacebar') { e.preventDefault(); ui.bPause.click(); }
    else if (lk === 'r' || lk === 'к') { e.preventDefault(); ui.bReset.click(); }
  });

  if (window.ResizeObserver) {
    try { new window.ResizeObserver(resize).observe(canvas); } catch (err) { /* нестрашно */ }
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  /* --- старт --- */
  setGrid(st.N, false);
  syncFunc();
  setElev(st.elev);
  ui.vSpin.textContent = st.spin.toFixed(1) + '×';
  ui.vFlow.textContent = st.flow.toFixed(1) + '×';
  ui.vAmp.textContent = st.amp.toFixed(2);
  resize();
  window.requestAnimationFrame(loop);
})();
