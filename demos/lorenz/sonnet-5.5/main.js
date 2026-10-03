/* Система Лоренца — Canvas 2D, без внешних зависимостей.
 *
 * dx/dt = σ(y − x),  dy/dt = x(ρ − z) − y,  dz/dt = xy − βz
 * Интегрирование — RK4 с фиксированным шагом, след — кольцевой буфер точек.
 * Камера — ручная перспективная проекция (вращение вокруг оси z + лёгкое "дыхание" наклона).
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Константы                                                          */
  /* ------------------------------------------------------------------ */
  var SIGMA = 10, RHO = 28, BETA = 8 / 3;
  var DT_STEP = 0.005;        // шаг интегрирования (модельное время)
  var BASE_RATE = 2.0;        // единиц модельного времени в секунду при скорости 1x
  var MAX_STEPS = 700;        // потолок шагов интегратора за кадр
  var CAP = 12288;            // ёмкость кольцевого буфера следа (точек)
  var CZ = 25;                // центр аттрактора по z (камера смотрит сюда)
  var CAM_DIST = 160;         // расстояние до камеры в единицах системы
  var TWIN_EPS = 1e-4;        // сдвиг второй траектории ("эффект бабочки")
  var TWIN_HUE = 150;         // сдвиг оттенка второй траектории, градусы
  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* ------------------------------------------------------------------ */
  /*  Палитры: опорные точки [позиция вдоль следа, H, S, L]              */
  /*  0 = хвост (старое), 1 = голова (новое). Оттенки "развёрнуты":      */
  /*  значения >360 допустимы, нормализуются при выводе.                 */
  /* ------------------------------------------------------------------ */
  var PALETTES = [
    { name: 'Неон',   stops: [[0, 300, 85, 26], [0.30, 262, 90, 38], [0.58, 212, 95, 48], [0.82, 182, 95, 54], [1, 155, 100, 78]] },
    { name: 'Огонь',  stops: [[0, 340, 80, 22], [0.30, 372, 90, 36], [0.58, 392, 100, 47], [0.82, 410, 100, 56], [1, 420, 100, 84]] },
    { name: 'Лёд',    stops: [[0, 250, 75, 22], [0.35, 222, 85, 36], [0.65, 198, 92, 48], [0.85, 184, 95, 62], [1, 176, 70, 90]] },
    { name: 'Спектр', stops: [[0, 275, 80, 34], [0.25, 225, 90, 46], [0.50, 160, 85, 44], [0.75, 95, 85, 48], [1, 45, 100, 70]] }
  ];

  function buildLUT(p) {
    var lut = new Float32Array(256 * 3);
    var st = p.stops;
    for (var i = 0; i < 256; i++) {
      var a = i / 255, k = 0;
      while (k < st.length - 2 && a > st[k + 1][0]) k++;
      var s0 = st[k], s1 = st[k + 1];
      var u = clamp((a - s0[0]) / (s1[0] - s0[0]), 0, 1);
      lut[i * 3]     = s0[1] + (s1[1] - s0[1]) * u;
      lut[i * 3 + 1] = s0[2] + (s1[2] - s0[2]) * u;
      lut[i * 3 + 2] = s0[3] + (s1[3] - s0[3]) * u;
    }
    return lut;
  }
  var LUTS = PALETTES.map(buildLUT);
  var palIdx = 0;
  var curLUT = LUTS[0];

  /* ------------------------------------------------------------------ */
  /*  Интегратор и трассёр                                               */
  /* ------------------------------------------------------------------ */
  function rk4(s) {
    var h = DT_STEP, h2 = h * 0.5;
    var x = s.x, y = s.y, z = s.z;

    var k1x = SIGMA * (y - x);
    var k1y = x * (RHO - z) - y;
    var k1z = x * y - BETA * z;

    var x2 = x + h2 * k1x, y2 = y + h2 * k1y, z2 = z + h2 * k1z;
    var k2x = SIGMA * (y2 - x2);
    var k2y = x2 * (RHO - z2) - y2;
    var k2z = x2 * y2 - BETA * z2;

    var x3 = x + h2 * k2x, y3 = y + h2 * k2y, z3 = z + h2 * k2z;
    var k3x = SIGMA * (y3 - x3);
    var k3y = x3 * (RHO - z3) - y3;
    var k3z = x3 * y3 - BETA * z3;

    var x4 = x + h * k3x, y4 = y + h * k3y, z4 = z + h * k3z;
    var k4x = SIGMA * (y4 - x4);
    var k4y = x4 * (RHO - z4) - y4;
    var k4z = x4 * y4 - BETA * z4;

    var c = h / 6;
    s.x = x + c * (k1x + 2 * k2x + 2 * k3x + k4x);
    s.y = y + c * (k1y + 2 * k2y + 2 * k3y + k4y);
    s.z = z + c * (k1z + 2 * k2z + 2 * k3z + k4z);
  }

  function Tracer(hueShift) {
    this.x = 1; this.y = 1; this.z = 1;
    this.xs = new Float32Array(CAP);
    this.ys = new Float32Array(CAP);
    this.zs = new Float32Array(CAP);
    this.px = new Float32Array(CAP);   // проекции (переиспользуются каждый кадр)
    this.py = new Float32Array(CAP);
    this.pp = new Float32Array(CAP);   // перспективный множитель
    this.head = 0;
    this.count = 0;
    this.hueShift = hueShift;
    this.active = false;
  }
  Tracer.prototype.push = function () {
    var i = this.head;
    this.xs[i] = this.x; this.ys[i] = this.y; this.zs[i] = this.z;
    this.head = (i + 1 === CAP) ? 0 : i + 1;
    if (this.count < CAP) this.count++;
  };
  Tracer.prototype.step = function () { rk4(this); this.push(); };
  Tracer.prototype.clear = function () { this.head = 0; this.count = 0; };
  Tracer.prototype.cloneFrom = function (o, eps) {
    this.xs.set(o.xs); this.ys.set(o.ys); this.zs.set(o.zs);
    this.head = o.head; this.count = o.count;
    this.x = o.x + eps; this.y = o.y; this.z = o.z;
  };

  var A = new Tracer(0);
  var B = new Tracer(TWIN_HUE);
  var simT = 0;

  function seed(t) {
    t.x = rnd(-12, 12); t.y = rnd(-12, 12); t.z = rnd(8, 38);
  }

  function initTrajectory() {
    seed(A);
    for (var i = 0; i < 1200; i++) rk4(A);           // уходим с переходного процесса на аттрактор
    A.clear();
    for (i = 0; i < CAP; i++) A.step();              // сразу полный след — первый кадр уже красивый
    simT = 0;
  }

  function resetSim() {
    seed(A);
    A.clear();
    A.push();                                        // след растёт с нуля: видно, как точка садится на аттрактор
    if (B.active) B.cloneFrom(A, TWIN_EPS);
    simT = 0;
  }

  function setTwin(on) {
    if (on) { B.cloneFrom(A, TWIN_EPS); B.active = true; }
    else { B.active = false; }
    rDw.hidden = !on;
  }

  /* ------------------------------------------------------------------ */
  /*  DOM                                                                */
  /* ------------------------------------------------------------------ */
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d', { alpha: false });   // фон рисуем сами, непрозрачный
  var panel = document.getElementById('panel');
  var btnPause = document.getElementById('btnPause');
  var btnReset = document.getElementById('btnReset');
  var inSpeed = document.getElementById('inSpeed');
  var inTrail = document.getElementById('inTrail');
  var inRot = document.getElementById('inRot');
  var outSpeed = document.getElementById('outSpeed');
  var outTrail = document.getElementById('outTrail');
  var outRot = document.getElementById('outRot');
  var chkTwin = document.getElementById('chkTwin');
  var chkGrid = document.getElementById('chkGrid');
  var swWrap = document.getElementById('swatches');
  var rT = document.getElementById('rT');
  var rX = document.getElementById('rX');
  var rY = document.getElementById('rY');
  var rZ = document.getElementById('rZ');
  var rD = document.getElementById('rD');
  var rDw = document.getElementById('rDw');

  /* ------------------------------------------------------------------ */
  /*  Состояние UI / камеры                                              */
  /* ------------------------------------------------------------------ */
  var paused = false;
  var speed = 1;
  var trailLen = 4500;
  var rotRate = 6 * Math.PI / 180;     // рад/с
  var showGrid = true;

  // Крылья аттрактора лежат вдоль диагонали x = y: при yaw ≈ +45° камера смотрит на них ребром (узкий вид),
  // при yaw ≈ -45° — во всю ширину. Стартуем с широкого ракурса.
  var YAW0 = -0.95;
  var yaw = YAW0, pitchOff = 0, zoom = 1, camT = 0;
  var dragging = false, dragX = 0, dragY = 0;

  var dpr = 1, VW = 1, VH = 1;
  var vcx = 0, vcy = 0, vscale = 10;
  var vct = 1, vst = 0, vcp = 1, vsp = 0;

  var bg = document.createElement('canvas');
  var tmp = [0, 0, 0];

  /* ------------------------------------------------------------------ */
  /*  Фон и раскладка                                                    */
  /* ------------------------------------------------------------------ */
  function buildBg() {
    bg.width = canvas.width;
    bg.height = canvas.height;
    var b = bg.getContext('2d');
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cx = VW / 2, cy = VH * 0.45;
    var g = b.createRadialGradient(cx, cy, 0, cx, cy, Math.max(VW, VH) * 0.78);
    g.addColorStop(0, '#111c3c');
    g.addColorStop(0.55, '#070c1f');
    g.addColorStop(1, '#02030a');
    b.fillStyle = g;
    b.fillRect(0, 0, VW, VH);

    var sd = 12345;
    function rr() { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; }
    for (var i = 0; i < 150; i++) {
      var x = rr() * VW, y = rr() * VH, r = 0.2 + rr() * 1.0, al = 0.08 + rr() * 0.34;
      b.fillStyle = 'rgba(190,205,255,' + al.toFixed(2) + ')';
      b.beginPath();
      b.arc(x, y, r, 0, TAU);
      b.fill();
    }
  }

  function layoutView() {
    var pr = panel.getBoundingClientRect();
    var top = 12;
    var bottom = pr.height > 0 ? pr.top - 6 : VH - 12;
    var availH = Math.max(160, bottom - top);
    vcx = VW / 2;
    vcy = top + availH / 2;
    vscale = Math.min(availH * 0.96 / 54, VW * 0.94 / 64) * zoom;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    VW = Math.max(1, window.innerWidth);
    VH = Math.max(1, window.innerHeight);
    canvas.width = Math.round(VW * dpr);
    canvas.height = Math.round(VH * dpr);
    buildBg();
    layoutView();
  }

  /* ------------------------------------------------------------------ */
  /*  Проекция                                                           */
  /* ------------------------------------------------------------------ */
  function project(x, y, z, out) {
    var x1 = x * vct - y * vst, y1 = x * vst + y * vct, z1 = z - CZ;
    var dep = y1 * vcp - z1 * vsp, up = y1 * vsp + z1 * vcp;
    var ps = CAM_DIST / (CAM_DIST + dep);
    out[0] = vcx + vscale * x1 * ps;
    out[1] = vcy - vscale * up * ps;
    out[2] = ps;
  }

  /* ------------------------------------------------------------------ */
  /*  Отрисовка                                                          */
  /* ------------------------------------------------------------------ */
  function drawGrid() {
    var c = ctx, k, r, a;
    c.lineWidth = 1;
    for (r = 10; r <= 30; r += 10) {
      c.strokeStyle = r === 30 ? 'rgba(130,155,255,0.16)' : 'rgba(130,155,255,0.08)';
      c.beginPath();
      for (k = 0; k <= 72; k++) {
        a = k / 72 * TAU;
        project(r * Math.cos(a), r * Math.sin(a), 0, tmp);
        if (k) c.lineTo(tmp[0], tmp[1]); else c.moveTo(tmp[0], tmp[1]);
      }
      c.stroke();
    }
    c.strokeStyle = 'rgba(130,155,255,0.07)';
    c.beginPath();
    for (k = 0; k < 12; k++) {
      a = k / 12 * TAU;
      project(6 * Math.cos(a), 6 * Math.sin(a), 0, tmp);
      c.moveTo(tmp[0], tmp[1]);
      project(30 * Math.cos(a), 30 * Math.sin(a), 0, tmp);
      c.lineTo(tmp[0], tmp[1]);
    }
    c.stroke();
    c.strokeStyle = 'rgba(130,155,255,0.12)';
    c.beginPath();
    project(0, 0, 0, tmp);
    c.moveTo(tmp[0], tmp[1]);
    project(0, 0, 52, tmp);
    c.lineTo(tmp[0], tmp[1]);
    c.stroke();
  }

  function drawFixedPoints() {
    var cf = Math.sqrt(BETA * (RHO - 1)), zf = RHO - 1;
    ctx.lineWidth = 1;
    for (var sg = -1; sg <= 1; sg += 2) {
      project(sg * cf, sg * cf, zf, tmp);
      ctx.fillStyle = 'rgba(255,236,190,0.7)';
      ctx.beginPath();
      ctx.arc(tmp[0], tmp[1], 2.2 * tmp[2], 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,236,190,0.2)';
      ctx.beginPath();
      ctx.arc(tmp[0], tmp[1], 7 * tmp[2], 0, TAU);
      ctx.stroke();
    }
  }

  function drawTrail(t) {
    var vis = Math.min(t.count, trailLen);
    if (vis < 8) return;
    var xs = t.xs, ys = t.ys, zs = t.zs, px = t.px, py = t.py, pp = t.pp;
    var start = t.head - vis;
    if (start < 0) start += CAP;

    // проекция всех видимых точек, от старой к новой
    var idx = start, i;
    var sc = vscale, cx = vcx, cy = vcy, ct = vct, st = vst, cp = vcp, sp = vsp;
    for (i = 0; i < vis; i++) {
      var x = xs[idx], y = ys[idx], z = zs[idx] - CZ;
      var x1 = x * ct - y * st, y1 = x * st + y * ct;
      var dep = y1 * cp - z * sp, up = y1 * sp + z * cp;
      var ps = CAM_DIST / (CAM_DIST + dep);
      px[i] = cx + sc * x1 * ps;
      py[i] = cy - sc * up * ps;
      pp[i] = ps;
      if (++idx === CAP) idx = 0;
    }

    var lut = curLUT, hs = t.hueShift;
    var ch = Math.max(6, Math.ceil(vis / 200));       // ~200 кусков следа
    var last = vis - 1;
    for (var s = 0; s < last; s += ch) {
      var e = s + ch;
      if (e > last) e = last;
      var mid = (s + e) >> 1;
      var a = mid / last;                              // 0 — хвост, 1 — голова
      var fade = Math.pow(a, 1.4);                     // затухание следа с возрастом
      var li = (a * 255) | 0;
      var zi = start + mid;
      if (zi >= CAP) zi -= CAP;
      var h = lut[li * 3] + hs + (zs[zi] - CZ) * 0.72; // лёгкая "иризация" по высоте
      h = ((h % 360) + 360) % 360;
      var ps2 = pp[mid];
      var dm = 0.55 + 0.45 * clamp((ps2 - 0.8) * 2.5, 0, 1);   // ближе к камере — ярче

      ctx.beginPath();
      ctx.moveTo(px[s], py[s]);
      for (var k = s + 1; k <= e; k++) ctx.lineTo(px[k], py[k]);

      var hsl = h.toFixed(0) + ',' + lut[li * 3 + 1].toFixed(0) + '%,' + lut[li * 3 + 2].toFixed(0) + '%,';
      ctx.lineWidth = (3 + 5 * a) * ps2;               // мягкое свечение
      ctx.strokeStyle = 'hsla(' + hsl + (fade * dm * 0.13).toFixed(3) + ')';
      ctx.stroke();
      ctx.lineWidth = (0.8 + 1.6 * a) * ps2;           // яркое ядро
      ctx.strokeStyle = 'hsla(' + hsl + (fade * dm * 0.85).toFixed(3) + ')';
      ctx.stroke();
    }

    // голова траектории
    var hx = px[last], hy = py[last], hp = pp[last];
    var lz = zs[(t.head + CAP - 1) % CAP];
    var hh = ((lut[255 * 3] + hs + (lz - CZ) * 0.72) % 360 + 360) % 360;
    var hc = hh.toFixed(0) + ',' + lut[255 * 3 + 1].toFixed(0) + '%,' + lut[255 * 3 + 2].toFixed(0) + '%';
    var r = 16 * hp;
    var g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.2, 'hsla(' + hc + ',0.65)');
    g.addColorStop(1, 'hsla(' + hc + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, TAU);
    ctx.fill();
  }

  function render() {
    var c = ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.drawImage(bg, 0, 0, VW, VH);

    var ph = clamp(0.36 + 0.2 * Math.sin(camT * 0.07) + pitchOff, -1.45, 1.45);
    vct = Math.cos(yaw); vst = Math.sin(yaw);
    vcp = Math.cos(ph);  vsp = Math.sin(ph);

    c.lineJoin = 'round';
    c.lineCap = 'butt';
    if (showGrid) drawGrid();

    c.globalCompositeOperation = 'lighter';          // аддитивное смешение — свечение в местах скопления
    drawFixedPoints();
    drawTrail(A);
    if (B.active) drawTrail(B);
    c.globalCompositeOperation = 'source-over';
  }

  /* ------------------------------------------------------------------ */
  /*  HUD                                                                */
  /* ------------------------------------------------------------------ */
  var lastRead = -1e9;
  function updateReadout(now, force) {
    if (!force && now - lastRead < 120) return;
    lastRead = now;
    rT.textContent = simT.toFixed(1);
    rX.textContent = A.x.toFixed(2);
    rY.textContent = A.y.toFixed(2);
    rZ.textContent = A.z.toFixed(2);
    if (B.active) {
      var dx = A.x - B.x, dy = A.y - B.y, dz = A.z - B.z;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      rD.textContent = d < 0.01 ? d.toExponential(1) : d.toFixed(2);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Главный цикл                                                       */
  /* ------------------------------------------------------------------ */
  var prevT = null, acc = 0;

  function frame(now) {
    window.requestAnimationFrame(frame);
    var dt = prevT === null ? 0.016 : (now - prevT) / 1000;
    prevT = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;                        // кламп большого dt (вкладка была в фоне)

    if (window.innerWidth !== VW || window.innerHeight !== VH ||
        Math.min(window.devicePixelRatio || 1, 2) !== dpr) {
      resize();
    }

    if (!paused) {
      acc += dt * BASE_RATE * speed;
      var n = Math.floor(acc / DT_STEP);
      if (n > MAX_STEPS) { n = MAX_STEPS; acc = 0; } else { acc -= n * DT_STEP; }
      var twin = B.active;
      for (var i = 0; i < n; i++) {
        A.step();
        if (twin) B.step();
      }
      simT += n * DT_STEP;
    }

    if (!dragging) yaw += rotRate * dt;
    camT += dt;

    render();
    updateReadout(now, false);
  }

  /* ------------------------------------------------------------------ */
  /*  Управление                                                         */
  /* ------------------------------------------------------------------ */
  function setPaused(p) {
    paused = p;
    btnPause.textContent = p ? 'Пуск' : 'Пауза';
    btnPause.setAttribute('aria-pressed', p ? 'true' : 'false');
  }

  function selectPalette(i) {
    palIdx = i;
    curLUT = LUTS[i];
    for (var k = 0; k < swBtns.length; k++) {
      swBtns[k].setAttribute('aria-checked', k === i ? 'true' : 'false');
    }
  }

  function swatchGradient(p) {
    var parts = p.stops.map(function (s) {
      var h = ((s[1] % 360) + 360) % 360;
      return 'hsl(' + h + ',' + s[2] + '%,' + Math.min(90, s[3] + 10) + '%) ' + (s[0] * 100) + '%';
    });
    return 'linear-gradient(90deg,' + parts.join(',') + ')';
  }

  var swBtns = [];
  PALETTES.forEach(function (p, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw';
    b.title = p.name;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', p.name);
    b.style.background = swatchGradient(p);
    b.addEventListener('click', function () { selectPalette(i); });
    swWrap.appendChild(b);
    swBtns.push(b);
  });

  btnPause.addEventListener('click', function () { setPaused(!paused); });
  btnReset.addEventListener('click', function () { resetSim(); updateReadout(0, true); });

  inSpeed.addEventListener('input', function () {
    speed = parseFloat(inSpeed.value) || 1;
    outSpeed.textContent = speed.toFixed(2).replace(/0$/, '') + '×';
  });
  inTrail.addEventListener('input', function () {
    trailLen = clamp(parseInt(inTrail.value, 10) || 4500, 500, CAP);
    outTrail.textContent = String(trailLen);
  });
  inRot.addEventListener('input', function () {
    var d = parseFloat(inRot.value) || 0;
    rotRate = d * Math.PI / 180;
    outRot.textContent = d.toFixed(0) + '°/с';
  });
  chkTwin.addEventListener('change', function () { setTwin(chkTwin.checked); updateReadout(0, true); });
  chkGrid.addEventListener('change', function () { showGrid = chkGrid.checked; });

  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    dragX = e.clientX; dragY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    yaw += (e.clientX - dragX) * 0.006;
    pitchOff = clamp(pitchOff + (e.clientY - dragY) * 0.005, -1.0, 1.0);
    dragX = e.clientX; dragY = e.clientY;
  });
  function endDrag() { dragging = false; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0012), 0.5, 2.5);
    layoutView();
  }, { passive: false });
  canvas.addEventListener('dblclick', function () {
    pitchOff = 0; zoom = 1; yaw = YAW0;
    layoutView();
  });

  document.addEventListener('keydown', function (e) {
    var tg = e.target && e.target.tagName;
    if (tg === 'INPUT' || tg === 'BUTTON' || tg === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
    else if (e.code === 'KeyR') { resetSim(); updateReadout(0, true); }
  });

  window.addEventListener('resize', resize);

  /* ------------------------------------------------------------------ */
  /*  Старт                                                              */
  /* ------------------------------------------------------------------ */
  selectPalette(0);
  initTrajectory();
  resize();
  render();
  updateReadout(0, true);
  window.requestAnimationFrame(frame);
})();
