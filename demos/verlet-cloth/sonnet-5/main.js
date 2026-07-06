(function () {
  'use strict';

  var verletStep = window.Cloth.verletStep;
  var satisfyConstraint = window.Cloth.satisfyConstraint;

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');

  var resetBtn = document.getElementById('resetBtn');
  var windRange = document.getElementById('windRange');
  var tearRange = document.getElementById('tearRange');

  // --- параметры симуляции -------------------------------------------------

  var GRAVITY = 640;          // px/s^2
  var DAMPING = 0.985;        // затухание скорости за шаг (сопротивление воздуха)
  var FIXED_DT = 1 / 120;     // шаг физики (сек)
  var MAX_FRAME_DT = 0.05;    // клампим большой dt (потеря фокуса вкладки и т.п.)
  var MAX_SUBSTEPS = 8;
  var CONSTRAINT_ITERATIONS = 6;

  var windStrength = parseFloat(windRange.value);
  var tearFactor = parseFloat(tearRange.value) / 100;

  // --- состояние холста -----------------------------------------------------

  var width = 0, height = 0, dpr = 1;

  function resizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // --- сетка частиц и связей ------------------------------------------------

  var particles = [];   // { x, y, px, py, pinned }
  var constraints = []; // { a, b, rest, broken } — только структурные связи (см. buildCloth)
  var hLinks = [];      // hLinks[j][i] — горизонтальная связь между колонками i и i+1 в строке j
  var vLinks = [];      // vLinks[j][i] — вертикальная связь между строками j и j+1 в колонке i
  var gridCols = 0, gridRows = 0;

  function idx(i, j) {
    return j * gridCols + i;
  }

  function buildCloth() {
    var spacing = 26;
    var cols = Math.floor(width / spacing) + 1;
    var rows = Math.floor((height * 0.72) / spacing) + 1;
    cols = Math.max(14, Math.min(cols, 34));
    rows = Math.max(10, Math.min(rows, 22));

    var startX = (width - (cols - 1) * spacing) / 2;
    var startY = Math.max(64, height * 0.10);

    gridCols = cols;
    gridRows = rows;

    particles = [];
    for (var j = 0; j < rows; j++) {
      for (var i = 0; i < cols; i++) {
        var x = startX + i * spacing;
        var y = startY + j * spacing;
        particles.push({ x: x, y: y, px: x, py: y, pinned: false });
      }
    }

    // Верхний край закреплён только в нескольких точках, а не целиком.
    var numPins = Math.max(3, Math.min(7, Math.round(cols / 6)));
    var pinCols = new Set();
    for (var k = 0; k < numPins; k++) {
      pinCols.add(Math.round((k * (cols - 1)) / (numPins - 1)));
    }
    pinCols.forEach(function (i) {
      particles[idx(i, 0)].pinned = true;
    });

    constraints = [];
    hLinks = [];
    vLinks = [];

    // Только структурные связи (горизонталь + вертикаль), БЕЗ диагоналей.
    // Диагональные (shear) связи в каждой ячейке триангулируют сетку целиком —
    // связная триангулированная сетка статически жёсткая (аналог фермы в
    // строительной механике: 4 точки + 6 расстояний = 0 внутренних степеней
    // свободы), поэтому полотно с диагоналями почти не провисает под
    // гравитацией — оно ведёт себя как жёсткая пластина, а не как ткань.
    // Одни лишь дистанционные связи по сетке не мешают изгибу (только
    // растяжению), поэтому полотно свободно провисает между точками
    // крепления, как и положено ткани/цепи.
    for (var jh = 0; jh < rows; jh++) {
      hLinks[jh] = [];
      for (var ih = 0; ih < cols - 1; ih++) {
        var ch = { a: idx(ih, jh), b: idx(ih + 1, jh), rest: spacing, broken: false };
        constraints.push(ch);
        hLinks[jh][ih] = ch;
      }
    }

    for (var jv = 0; jv < rows - 1; jv++) {
      vLinks[jv] = [];
      for (var iv = 0; iv < cols; iv++) {
        var cv = { a: idx(iv, jv), b: idx(iv, jv + 1), rest: spacing, broken: false };
        constraints.push(cv);
        vLinks[jv][iv] = cv;
      }
    }

    dragIndex = -1;
  }

  // --- взаимодействие мышью/тачем -------------------------------------------

  var dragIndex = -1;
  var pointerX = 0, pointerY = 0;

  function getPointerPos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function findNearestFree(x, y, maxDist) {
    var best = -1;
    var bestD2 = maxDist * maxDist;
    for (var k = 0; k < particles.length; k++) {
      var p = particles[k];
      if (p.pinned) continue;
      var dx = p.x - x;
      var dy = p.y - y;
      var d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = k;
      }
    }
    return best;
  }

  canvas.addEventListener('pointerdown', function (e) {
    var pos = getPointerPos(e);
    pointerX = pos.x;
    pointerY = pos.y;
    var spacing = gridCols > 1 ? (particles[idx(1, 0)].x - particles[idx(0, 0)].x) : 26;
    var found = findNearestFree(pos.x, pos.y, Math.max(46, spacing * 1.6));
    if (found >= 0) {
      dragIndex = found;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        // Захват указателя — необязательное усиление (не даёт потерять drag
        // при выходе курсора за пределы canvas); если браузер отказал
        // (например, id указателя не распознан как активный), просто
        // продолжаем без захвата — на pointerup/pointercancel/pointerleave
        // всё равно корректно отпустим точку.
      }
    }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', function (e) {
    var pos = getPointerPos(e);
    pointerX = pos.x;
    pointerY = pos.y;
  });

  function releaseDrag() {
    dragIndex = -1;
  }

  window.addEventListener('pointerup', releaseDrag);
  window.addEventListener('pointercancel', releaseDrag);
  canvas.addEventListener('pointerleave', function (e) {
    // Отпускаем только если не захвачен указатель (иначе drag за пределы canvas продолжится).
    if (dragIndex >= 0 && !canvas.hasPointerCapture(e.pointerId)) {
      releaseDrag();
    }
  });

  // --- физика ----------------------------------------------------------------

  var simTime = 0;

  function windAccel(p) {
    var nx = width > 0 ? p.x / width : 0;
    var wx = Math.sin(simTime * 0.6 + nx * 3.4) * 0.6 +
             Math.sin(simTime * 1.7 - nx * 1.1 + 2.0) * 0.35 +
             Math.sin(simTime * 0.21) * 0.5;
    var wy = Math.sin(simTime * 0.9 + nx * 2.3) * 0.12;
    return { ax: wx * windStrength, ay: wy * windStrength };
  }

  function updatePhysics(dt) {
    simTime += dt;

    if (dragIndex >= 0) {
      var dp = particles[dragIndex];
      dp.px = dp.x;
      dp.py = dp.y;
      dp.x = pointerX;
      dp.y = pointerY;
    }

    for (var k = 0; k < particles.length; k++) {
      if (k === dragIndex) continue;
      var p = particles[k];
      var w = windAccel(p);
      var res = verletStep(p, w.ax, GRAVITY + w.ay, dt, DAMPING);
      p.x = res.x;
      p.y = res.y;
      p.px = res.px;
      p.py = res.py;
    }

    for (var iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
      for (var ci = 0; ci < constraints.length; ci++) {
        var c = constraints[ci];
        if (c.broken) continue;
        var pa = particles[c.a];
        var pb = particles[c.b];
        var effA = { x: pa.x, y: pa.y, pinned: pa.pinned || c.a === dragIndex };
        var effB = { x: pb.x, y: pb.y, pinned: pb.pinned || c.b === dragIndex };
        var result = satisfyConstraint(effA, effB, c.rest, tearFactor);
        if (result.broken) {
          c.broken = true;
          continue;
        }
        if (!effA.pinned) {
          pa.x = result.p1.x;
          pa.y = result.p1.y;
        }
        if (!effB.pinned) {
          pb.x = result.p2.x;
          pb.y = result.p2.y;
        }
      }
    }
  }

  // --- рендер ------------------------------------------------------------------

  function lerpColor(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  var COLOR_RELAXED = [55, 198, 217];
  var COLOR_TENSE = [224, 95, 95];

  function render() {
    ctx.clearRect(0, 0, width, height);

    var bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#12151b');
    bg.addColorStop(1, '#0a0c10');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Заливка целых (не порванных) ячеек — лёгкая ткань-подложка.
    for (var j = 0; j < gridRows - 1; j++) {
      for (var i = 0; i < gridCols - 1; i++) {
        var h0 = hLinks[j][i], h1 = hLinks[j + 1][i], v0 = vLinks[j][i], v1 = vLinks[j][i + 1];
        if (h0.broken || h1.broken || v0.broken || v1.broken) continue;
        var p00 = particles[idx(i, j)];
        var p10 = particles[idx(i + 1, j)];
        var p11 = particles[idx(i + 1, j + 1)];
        var p01 = particles[idx(i, j + 1)];
        var shade = 0.05 + 0.10 * (j / gridRows);
        ctx.fillStyle = 'rgba(55,198,217,' + shade.toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(p00.x, p00.y);
        ctx.lineTo(p10.x, p10.y);
        ctx.lineTo(p11.x, p11.y);
        ctx.lineTo(p01.x, p01.y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Связи сетки — цвет отражает натяжение (от бирюзового к тревожно-красному у порога разрыва).
    ctx.lineCap = 'round';
    for (var ci = 0; ci < constraints.length; ci++) {
      var c = constraints[ci];
      if (c.broken) continue;
      var pa = particles[c.a];
      var pb = particles[c.b];
      var dx = pb.x - pa.x;
      var dy = pb.y - pa.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var stretch = dist / c.rest;
      var tension = Math.max(0, Math.min(1, (stretch - 1) / (tearFactor - 1)));
      var col = lerpColor(COLOR_RELAXED, COLOR_TENSE, tension);
      ctx.strokeStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.78)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // Точки закрепления.
    for (var k = 0; k < particles.length; k++) {
      var p = particles[k];
      if (!p.pinned) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#eef3f8';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(238,243,248,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Подсветка захваченной точки.
    if (dragIndex >= 0) {
      var dp = particles[dragIndex];
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#5ed7e7';
      ctx.fill();
    }
  }

  // --- цикл анимации: dt-based с клампом и фиксированным подшагом физики ----

  var lastTime = 0;
  var accumulator = 0;

  function frame(now) {
    var frameDt = (now - lastTime) / 1000;
    lastTime = now;
    if (!isFinite(frameDt) || frameDt < 0) frameDt = 0;
    frameDt = Math.min(frameDt, MAX_FRAME_DT);

    accumulator += frameDt;
    var steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      updatePhysics(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }

    render();
    requestAnimationFrame(frame);
  }

  // --- управление ---------------------------------------------------------

  resetBtn.addEventListener('click', function () {
    buildCloth();
  });

  windRange.addEventListener('input', function () {
    windStrength = parseFloat(windRange.value);
  });

  tearRange.addEventListener('input', function () {
    tearFactor = parseFloat(tearRange.value) / 100;
  });

  var resizeScheduled = false;
  window.addEventListener('resize', function () {
    if (resizeScheduled) return;
    resizeScheduled = true;
    requestAnimationFrame(function () {
      resizeScheduled = false;
      resizeCanvas();
      buildCloth();
    });
  });

  // --- инициализация --------------------------------------------------------

  resizeCanvas();
  buildCloth();
  requestAnimationFrame(function (t) {
    lastTime = t;
    requestAnimationFrame(frame);
  });
})();
