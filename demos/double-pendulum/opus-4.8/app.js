'use strict';
(function () {
  const { rk4Step, bobPositions } = window.Pendulum;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const els = {
    playPause: document.getElementById('playPause'),
    reset: document.getElementById('reset'),
    ghost: document.getElementById('ghost'),
    m1: document.getElementById('m1'),
    m2: document.getElementById('m2'),
    L1: document.getElementById('L1'),
    L2: document.getElementById('L2'),
  };

  const DEFAULTS = { th1: 2.0944, th2: 2.0944, w1: 0, w2: 0 }; // 120°, 120°
  const DT = 0.005;        // фиксированный шаг физики, c
  const MAX_FRAME = 0.05;  // максимум отыгрываемого времени за кадр
  const TRAIL_MAX = 600;

  let params = readParams();
  let state = { ...DEFAULTS };
  let ghostState = null;
  let trail = [];
  let running = true;
  let acc = 0;
  let lastT = null;

  function readParams() {
    return {
      m1: parseFloat(els.m1.value),
      m2: parseFloat(els.m2.value),
      L1: parseFloat(els.L1.value),
      L2: parseFloat(els.L2.value),
      g: 9.81,
    };
  }

  function resetSim() {
    state = { ...DEFAULTS };
    ghostState = els.ghost.classList.contains('on')
      ? { ...DEFAULTS, th1: DEFAULTS.th1 + 1e-4 }
      : null;
    trail = [];
    acc = 0;
    lastT = null;
  }

  els.playPause.addEventListener('click', () => {
    running = !running;
    els.playPause.textContent = running ? 'Пауза' : 'Пуск';
    lastT = null;
  });
  els.reset.addEventListener('click', resetSim);
  els.ghost.addEventListener('click', () => {
    els.ghost.classList.toggle('on');
    ghostState = els.ghost.classList.contains('on')
      ? { ...state, th1: state.th1 + 1e-4 }
      : null;
  });
  for (const id of ['m1', 'm2', 'L1', 'L2']) {
    els[id].addEventListener('input', () => { params = readParams(); });
  }

  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', fitCanvas);

  function advance(dtReal) {
    acc += Math.min(dtReal, MAX_FRAME);
    while (acc >= DT) {
      state = rk4Step(state, params, DT);
      if (ghostState) ghostState = rk4Step(ghostState, params, DT);
      acc -= DT;
    }
    const p = bobPositions(state, params);
    trail.push({ x: p.x2, y: p.y2 });
    if (trail.length > TRAIL_MAX) trail.shift();
  }

  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

  function drawPendulum(s, toPx, pivotX, pivotY, color) {
    const pos = bobPositions(s, params);
    const b1 = toPx({ x: pos.x1, y: pos.y1 });
    const b2 = toPx({ x: pos.x2, y: pos.y2 });
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY); ctx.lineTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y);
    ctx.stroke();
    ctx.fillStyle = color;
    circle(b1.x, b1.y, 4 + params.m1 * 4);
    circle(b2.x, b2.y, 4 + params.m2 * 4);
  }

  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const pivotX = w / 2, pivotY = h * 0.33;
    const reach = params.L1 + params.L2;
    const scale = Math.min(w, h) * 0.42 / reach;
    const toPx = (pt) => ({ x: pivotX + pt.x * scale, y: pivotY + pt.y * scale });

    if (trail.length > 1) {
      ctx.lineWidth = 2;
      for (let i = 1; i < trail.length; i++) {
        const a = toPx(trail[i - 1]), b = toPx(trail[i]);
        ctx.strokeStyle = `rgba(55,198,217,${(i / trail.length) * 0.6})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    if (ghostState) drawPendulum(ghostState, toPx, pivotX, pivotY, 'rgba(240,201,106,0.55)');
    drawPendulum(state, toPx, pivotX, pivotY, '#e8e8ec');
    ctx.fillStyle = '#7f8a99';
    circle(pivotX, pivotY, 4);
    requestAnimationFrame(frame);
  }

  function frame(t) {
    if (running) {
      if (lastT != null) advance((t - lastT) / 1000);
      lastT = t;
    }
    draw();
  }

  fitCanvas();
  resetSim();
  requestAnimationFrame(frame);
})();
