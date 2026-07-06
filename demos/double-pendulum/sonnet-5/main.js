'use strict';
(function () {
  const P = window.Pendulum;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const btnPlay = document.getElementById('btn-play');
  const btnReset = document.getElementById('btn-reset');
  const chkGhost = document.getElementById('chk-ghost');
  const energyEl = document.getElementById('energy-readout');

  const rngM1 = document.getElementById('rng-m1');
  const rngM2 = document.getElementById('rng-m2');
  const rngL1 = document.getElementById('rng-l1');
  const rngL2 = document.getElementById('rng-l2');
  const valM1 = document.getElementById('val-m1');
  const valM2 = document.getElementById('val-m2');
  const valL1 = document.getElementById('val-l1');
  const valL2 = document.getElementById('val-l2');

  // --- Физические параметры (мутируются ползунками "на лету") ---
  const params = { m1: 1, m2: 1, l1: 1, l2: 1, g: 9.81 };

  // Начальные условия: оба стержня горизонтальны, отпущены из покоя —
  // энергетически богатая, устойчиво хаотическая конфигурация.
  const TH1_0 = Math.PI / 2;
  const TH2_0 = Math.PI / 2;
  const GHOST_EPS = 1e-3; // "крошечное отклонение начального угла"

  let state = [TH1_0, TH2_0, 0, 0];
  let ghostState = [TH1_0 + GHOST_EPS, TH2_0, 0, 0];

  let running = true;
  let ghostOn = false;

  let energyBaseline = P.totalEnergy(state, params);

  const MAX_TRAIL = 650;
  const MAX_GHOST_TRAIL = 420;
  let trail = []; // { x, y } в метрах, мировые координаты нижнего груза
  let ghostTrail = [];

  function pushTrail(list, point, cap) {
    list.push(point);
    if (list.length > cap) list.shift();
  }

  function resetGhostFromCurrent() {
    ghostState = [state[0] + GHOST_EPS, state[1], state[2], state[3]];
    ghostTrail = [];
  }

  function resetSim() {
    state = [TH1_0, TH2_0, 0, 0];
    trail = [];
    energyBaseline = P.totalEnergy(state, params);
    if (ghostOn) resetGhostFromCurrent();
  }

  // --- Canvas / DPR ---
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', resize);
  resize();

  // --- UI wiring ---
  function setPlayLabel() {
    btnPlay.textContent = running ? 'Пауза' : 'Старт';
    btnPlay.classList.toggle('btn--primary', running);
  }

  btnPlay.addEventListener('click', () => {
    running = !running;
    setPlayLabel();
  });

  btnReset.addEventListener('click', () => {
    resetSim();
  });

  chkGhost.addEventListener('change', () => {
    ghostOn = chkGhost.checked;
    if (ghostOn) resetGhostFromCurrent();
  });

  function bindSlider(rng, valEl, key) {
    rng.addEventListener('input', () => {
      params[key] = parseFloat(rng.value);
      valEl.textContent = params[key].toFixed(2);
    });
  }
  bindSlider(rngM1, valM1, 'm1');
  bindSlider(rngM2, valM2, 'm2');
  bindSlider(rngL1, valL1, 'l1');
  bindSlider(rngL2, valL2, 'l2');

  setPlayLabel();

  // --- Симуляция: фиксированный физический шаг + аккумулятор ---
  const FIXED_DT = 1 / 240;
  const MAX_SUBSTEPS = 480; // защита от "спирали смерти" при неактивной вкладке
  let accumulator = 0;
  let lastTime = performance.now();

  function step(dt) {
    accumulator += dt;
    let substeps = 0;
    while (accumulator >= FIXED_DT && substeps < MAX_SUBSTEPS) {
      state = P.rk4Step(state, params, FIXED_DT);
      if (ghostOn) ghostState = P.rk4Step(ghostState, params, FIXED_DT);

      const pos = P.positions(state, params);
      pushTrail(trail, { x: pos.x2, y: pos.y2 }, MAX_TRAIL);
      if (ghostOn) {
        const gpos = P.positions(ghostState, params);
        pushTrail(ghostTrail, { x: gpos.x2, y: gpos.y2 }, MAX_GHOST_TRAIL);
      }

      accumulator -= FIXED_DT;
      substeps++;
    }
  }

  // --- Рендер ---
  function worldToScreen(x, y, pivot, scale) {
    return { sx: pivot.x + x * scale, sy: pivot.y - y * scale };
  }

  function drawBackground() {
    ctx.clearRect(0, 0, width, height);
    const g = ctx.createRadialGradient(
      width * 0.5, height * 0.36, 0,
      width * 0.5, height * 0.5, Math.max(width, height) * 0.75
    );
    g.addColorStop(0, '#171b24');
    g.addColorStop(1, '#08090c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  function drawTrail(list, scale, pivot, hue) {
    const n = list.length;
    if (n < 2) return;
    for (let i = 1; i < n; i++) {
      const p0 = list[i - 1];
      const p1 = list[i];
      const a0 = worldToScreen(p0.x, p0.y, pivot, scale);
      const a1 = worldToScreen(p1.x, p1.y, pivot, scale);
      const alpha = (i / n) * (i / n) * 0.85;
      ctx.beginPath();
      ctx.moveTo(a0.sx, a0.sy);
      ctx.lineTo(a1.sx, a1.sy);
      ctx.strokeStyle = hue(alpha);
      ctx.lineWidth = 1.6 + 1.4 * (i / n);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  function drawRod(x0, y0, x1, y1, alpha) {
    ctx.save();
    ctx.strokeStyle = `rgba(230, 238, 246, ${alpha})`;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(180, 210, 230, 0.35)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  function drawBob(x, y, r, colorA, colorB, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, colorA);
    grad.addColorStop(1, colorB);
    ctx.fillStyle = grad;
    ctx.shadowColor = colorA;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPivot(pivot) {
    ctx.save();
    ctx.fillStyle = '#0d1016';
    ctx.strokeStyle = '#7c8b9c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#37c6d9';
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    drawBackground();

    const pivot = { x: width / 2, y: height * 0.32 };
    const totalLen = params.l1 + params.l2;
    const scale = (Math.min(width, height) * 0.34) / Math.max(totalLen, 0.01);

    // след основного маятника (голубой)
    drawTrail(trail, scale, pivot, (a) => `rgba(55, 198, 217, ${a})`);
    if (ghostOn) {
      drawTrail(ghostTrail, scale, pivot, (a) => `rgba(240, 161, 61, ${a * 0.8})`);
    }

    drawPivot(pivot);

    // маятник-призрак — рисуем первым, полупрозрачным, под основным
    if (ghostOn) {
      const gp = P.positions(ghostState, params);
      const g1 = worldToScreen(gp.x1, gp.y1, pivot, scale);
      const g2 = worldToScreen(gp.x2, gp.y2, pivot, scale);
      ctx.save();
      ctx.globalAlpha = 0.55;
      drawRod(pivot.x, pivot.y, g1.sx, g1.sy, 0.55);
      drawRod(g1.sx, g1.sy, g2.sx, g2.sy, 0.55);
      ctx.restore();
      const r1g = 8 + params.m1 * 4.5;
      const r2g = 8 + params.m2 * 4.5;
      drawBob(g1.sx, g1.sy, r1g * 0.82, '#f0a13d', '#7a4712', 0.6);
      drawBob(g2.sx, g2.sy, r2g * 0.82, '#f0c96a', '#8a5a1e', 0.6);
    }

    // основной маятник
    const pos = P.positions(state, params);
    const s1 = worldToScreen(pos.x1, pos.y1, pivot, scale);
    const s2 = worldToScreen(pos.x2, pos.y2, pivot, scale);

    drawRod(pivot.x, pivot.y, s1.sx, s1.sy, 0.92);
    drawRod(s1.sx, s1.sy, s2.sx, s2.sy, 0.92);

    const r1 = 9 + params.m1 * 5.5;
    const r2 = 9 + params.m2 * 5.5;
    drawBob(s1.sx, s1.sy, r1, '#71e0ef', '#123c45', 1);
    drawBob(s2.sx, s2.sy, r2, '#8fd9a8', '#1c4a30', 1);

    // энергетический readout: дрейф нормируем не на сам baseline (он обнуляется
    // при горизонтальном старте th1=th2=90°, где PE=0 — деление на почти-ноль
    // давало бессмысленные проценты вроде -7911228755%), а на характерный
    // масштаб гравитационной энергии системы g*(m1*l1 + m2*(l1+l2)), который
    // не зависит от текущих углов и всегда положителен при реальных m,l.
    const e = P.totalEnergy(state, params);
    const energyScale = params.g * (params.m1 * params.l1 + params.m2 * (params.l1 + params.l2));
    const drift = ((e - energyBaseline) / Math.max(energyScale, 1e-6)) * 100;
    energyEl.textContent = `E: ${e.toFixed(2)} Дж · ΔE: ${drift >= 0 ? '+' : ''}${drift.toFixed(2)}%`;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05; // клампим большие dt (смена вкладки и т.п.)

    if (running) step(dt);
    draw();
  }

  requestAnimationFrame(frame);
})();
