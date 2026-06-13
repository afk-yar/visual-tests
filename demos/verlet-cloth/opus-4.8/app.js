'use strict';
(function () {
  const { makeCloth, integrate, solveConstraints } = window.Cloth;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const els = {
    reset: document.getElementById('reset'),
    wind: document.getElementById('wind'),
    dots: document.getElementById('dots'),
    windStr: document.getElementById('windStr'),
    tear: document.getElementById('tear'),
    grab: document.getElementById('grab'),
  };

  // Параметры симуляции.
  const COLS = 46;          // частиц по горизонтали
  const ROWS = 30;          // частиц по вертикали
  const PIN_EVERY = 6;      // каждая n-я частица верхнего ряда закреплена
  const GRAVITY = 1400;     // px/с² вниз
  const DAMPING = 0.99;     // затухание скорости (воздух)
  const DT = 1 / 60;        // фиксированный шаг физики, с
  const MAX_FRAME = 0.05;   // максимум отыгрываемого времени за кадр
  const ITERATIONS = 5;     // проходов релаксации констрейнтов за шаг

  let cloth = null;
  let spacing = 0;          // шаг сетки в пикселях (зависит от размера холста)
  let acc = 0;
  let lastT = null;
  let windPhase = 0;

  // Мышь.
  const mouse = { x: 0, y: 0, px: 0, py: 0, down: false, idx: -1 };

  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Создаёт ткань по текущему размеру холста: вписываем сетку с отступами сверху.
  function buildCloth() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const marginX = w * 0.12;
    const usable = w - marginX * 2;
    spacing = Math.max(8, usable / (COLS - 1));
    const x0 = (w - spacing * (COLS - 1)) / 2;
    const y0 = Math.max(24, h * 0.08);
    cloth = makeCloth(COLS, ROWS, spacing, x0, y0, PIN_EVERY);
  }

  function resetSim() {
    buildCloth();
    acc = 0;
    lastT = null;
    windPhase = 0;
    mouse.idx = -1;
    mouse.down = false;
    canvas.classList.remove('grabbing');
  }

  els.reset.addEventListener('click', resetSim);
  els.wind.addEventListener('click', () => els.wind.classList.toggle('on'));
  els.dots.addEventListener('click', () => els.dots.classList.toggle('on'));

  window.addEventListener('resize', () => { fitCanvas(); resetSim(); });

  // --- Ввод мышью / касанием -------------------------------------------------
  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  // Ближайшая свободная частица в радиусе захвата.
  function grabNearest(x, y) {
    const radius = parseFloat(els.grab.value);
    let best = -1, bestD2 = radius * radius;
    const pts = cloth.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.pinned) continue;
      const dx = p.x - x, dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    return best;
  }

  function onDown(e) {
    const pos = pointerPos(e);
    mouse.x = mouse.px = pos.x;
    mouse.y = mouse.py = pos.y;
    mouse.down = true;
    mouse.idx = grabNearest(pos.x, pos.y);
    canvas.classList.add('grabbing');
    e.preventDefault();
  }
  function onMove(e) {
    const pos = pointerPos(e);
    mouse.x = pos.x;
    mouse.y = pos.y;
    if (mouse.down) e.preventDefault();
  }
  function onUp() {
    mouse.down = false;
    mouse.idx = -1;
    canvas.classList.remove('grabbing');
  }

  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp);

  // --- Физика ----------------------------------------------------------------
  function step(dt) {
    // Лёгкий переменный ветер: сумма двух синусоид по фазе времени.
    windPhase += dt;
    let wind = 0;
    if (els.wind.classList.contains('on')) {
      const k = parseFloat(els.windStr.value);
      wind = (Math.sin(windPhase * 1.3) * 0.6 + Math.sin(windPhase * 0.37 + 1.1) * 0.4) * 900 * k;
    }

    integrate(cloth.points, wind, GRAVITY, dt, DAMPING);

    // Тянем схваченную частицу к курсору (после интегрирования, до релаксации).
    if (mouse.down && mouse.idx >= 0) {
      const p = cloth.points[mouse.idx];
      p.x = mouse.x;
      p.y = mouse.y;
      p.ox = mouse.px;
      p.oy = mouse.py;
    }

    const tearFactor = parseFloat(els.tear.value);
    solveConstraints(cloth.points, cloth.constraints, ITERATIONS, tearFactor);

    mouse.px = mouse.x;
    mouse.py = mouse.y;
  }

  function advance(dtReal) {
    acc += Math.min(dtReal, MAX_FRAME);
    while (acc >= DT) {
      step(DT);
      acc -= DT;
    }
  }

  // --- Рендер ----------------------------------------------------------------
  // Цвет связи по растяжению: спокойная бирюза → жёлтый → красный у предела.
  function strainColor(strain, tearFactor) {
    const t = Math.min(1, Math.max(0, (strain - 1) / Math.max(0.001, tearFactor - 1)));
    if (t < 0.5) {
      const u = t / 0.5;                       // бирюза → жёлтый
      const r = Math.round(55 + (240 - 55) * u);
      const g = Math.round(198 + (201 - 198) * u);
      const b = Math.round(217 + (106 - 217) * u);
      return `rgba(${r},${g},${b},0.85)`;
    }
    const u = (t - 0.5) / 0.5;                  // жёлтый → красный
    const r = Math.round(240 + (235 - 240) * u);
    const g = Math.round(201 + (74 - 201) * u);
    const b = Math.round(106 + (74 - 106) * u);
    return `rgba(${r},${g},${b},0.9)`;
  }

  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const pts = cloth.points;
    const cons = cloth.constraints;
    const tearFactor = parseFloat(els.tear.value);
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';

    for (let i = 0; i < cons.length; i++) {
      const c = cons[i];
      if (c.broken) continue;
      const pa = pts[c.a], pb = pts[c.b];
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const dist = Math.hypot(dx, dy) || 1e-9;
      ctx.strokeStyle = strainColor(dist / c.rest, tearFactor);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // Закреплённые точки — всегда видимы; остальные узлы — по кнопке «Точки».
    const showDots = els.dots.classList.contains('on');
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.pinned) {
        ctx.fillStyle = '#37c6d9';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (showDots) {
        ctx.fillStyle = 'rgba(174,184,199,0.5)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Подсветка радиуса захвата при наведении.
    if (mouse.down && mouse.idx >= 0) {
      const p = pts[mouse.idx];
      ctx.strokeStyle = 'rgba(55,198,217,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function frame(t) {
    if (lastT != null) advance((t - lastT) / 1000);
    lastT = t;
    draw();
    requestAnimationFrame(frame);
  }

  fitCanvas();
  resetSim();
  requestAnimationFrame(frame);
})();
