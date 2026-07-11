(function () {
  'use strict';

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  const GRAVITY = 9.81;
  const FIXED_STEP = 1 / 240;
  const MAX_FRAME_DT = 0.05;
  const TRAIL_LIFE = 2.7;
  const ui = {
    toggleButton: document.getElementById('toggleButton'), toggleText: document.getElementById('toggleText'), toggleIcon: document.getElementById('toggleIcon'), resetButton: document.getElementById('resetButton'), ghostToggle: document.getElementById('ghostToggle'), modeLabel: document.getElementById('modeLabel'), timeValue: document.getElementById('timeValue'), statusValue: document.getElementById('statusValue'), mass1: document.getElementById('mass1'), mass2: document.getElementById('mass2'), length1: document.getElementById('length1'), length2: document.getElementById('length2'), mass1Value: document.getElementById('mass1Value'), mass2Value: document.getElementById('mass2Value'), length1Value: document.getElementById('length1Value'), length2Value: document.getElementById('length2Value')
  };
  const params = { mass1: 1, mass2: 1, length1: 1, length2: 1 };
  const initial = { theta1: 1.05, theta2: 1.42, omega1: 0, omega2: 0 };
  let primary = makeState(initial);
  let ghost = makeState({ theta1: initial.theta1, theta2: initial.theta2 + 0.001, omega1: 0, omega2: 0 });
  let running = false;
  let elapsed = 0;
  let accumulator = 0;
  let lastFrame = performance.now();
  let lastTrailSample = 0;
  let trail = [];
  let width = 0;
  let height = 0;
  let dpr = 1;

  function makeState(values) { return { theta1: values.theta1, theta2: values.theta2, omega1: values.omega1, omega2: values.omega2 }; }

  function derivatives(state) {
    const m1 = params.mass1;
    const m2 = params.mass2;
    const l1 = params.length1;
    const l2 = params.length2;
    const delta = state.theta1 - state.theta2;
    const denominator = 2 * m1 + m2 - m2 * Math.cos(2 * delta);
    const omega1Dot = (-GRAVITY * (2 * m1 + m2) * Math.sin(state.theta1) - m2 * GRAVITY * Math.sin(state.theta1 - 2 * state.theta2) - 2 * m2 * Math.sin(delta) * (state.omega2 * state.omega2 * l2 + state.omega1 * state.omega1 * l1 * Math.cos(delta))) / (l1 * denominator);
    const omega2Dot = (2 * Math.sin(delta) * (state.omega1 * state.omega1 * l1 * (m1 + m2) + GRAVITY * (m1 + m2) * Math.cos(state.theta1) + state.omega2 * state.omega2 * l2 * m2 * Math.cos(delta))) / (l2 * denominator);
    return { theta1: state.omega1, theta2: state.omega2, omega1: omega1Dot, omega2: omega2Dot };
  }

  function addState(a, b, factor) { return { theta1: a.theta1 + b.theta1 * factor, theta2: a.theta2 + b.theta2 * factor, omega1: a.omega1 + b.omega1 * factor, omega2: a.omega2 + b.omega2 * factor }; }

  function rk4Step(state, step) {
    const k1 = derivatives(state);
    const k2 = derivatives(addState(state, k1, step / 2));
    const k3 = derivatives(addState(state, k2, step / 2));
    const k4 = derivatives(addState(state, k3, step));
    return { theta1: state.theta1 + step * (k1.theta1 + 2 * k2.theta1 + 2 * k3.theta1 + k4.theta1) / 6, theta2: state.theta2 + step * (k1.theta2 + 2 * k2.theta2 + 2 * k3.theta2 + k4.theta2) / 6, omega1: state.omega1 + step * (k1.omega1 + 2 * k2.omega1 + 2 * k3.omega1 + k4.omega1) / 6, omega2: state.omega2 + step * (k1.omega2 + 2 * k2.omega2 + 2 * k3.omega2 + k4.omega2) / 6 };
  }

  function reset() {
    primary = makeState(initial);
    ghost = makeState({ theta1: initial.theta1, theta2: initial.theta2 + 0.001, omega1: 0, omega2: 0 });
    elapsed = 0;
    accumulator = 0;
    trail = [];
    lastTrailSample = 0;
    updateReadout();
  }

  function setRunning(next) {
    running = next;
    ui.toggleText.textContent = running ? 'Пауза' : 'Запустить';
    ui.toggleIcon.textContent = running ? 'Ⅱ' : '▶';
    ui.statusValue.textContent = running ? 'РАБОТАЕТ' : 'ПАУЗА';
    ui.modeLabel.textContent = running ? 'СИМУЛЯЦИЯ · LIVE' : 'СИМУЛЯЦИЯ';
    ui.statusValue.style.color = running ? 'var(--orange)' : 'var(--acid)';
  }

  function updateReadout() {
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toFixed(1).padStart(4, '0');
    ui.timeValue.textContent = minutes + ':' + seconds;
  }

  function updateParams() {
    params.mass1 = Number(ui.mass1.value);
    params.mass2 = Number(ui.mass2.value);
    params.length1 = Number(ui.length1.value);
    params.length2 = Number(ui.length2.value);
    ui.mass1Value.textContent = params.mass1.toFixed(2) + ' кг';
    ui.mass2Value.textContent = params.mass2.toFixed(2) + ' кг';
    ui.length1Value.textContent = params.length1.toFixed(2) + ' м';
    ui.length2Value.textContent = params.length2.toFixed(2) + ' м';
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getGeometry(state) {
    const scale = Math.min(width * 0.24, height * 0.34) / (params.length1 + params.length2);
    const origin = { x: width * 0.5, y: Math.max(112, height * 0.24) };
    const joint = { x: origin.x + Math.sin(state.theta1) * params.length1 * scale, y: origin.y + Math.cos(state.theta1) * params.length1 * scale };
    const weight = { x: joint.x + Math.sin(state.theta2) * params.length2 * scale, y: joint.y + Math.cos(state.theta2) * params.length2 * scale };
    return { origin, joint, weight };
  }

  function drawBackground(now) {
    const gradient = ctx.createRadialGradient(width * .54, height * .32, 0, width * .54, height * .36, Math.max(width, height) * .76);
    gradient.addColorStop(0, '#263333');
    gradient.addColorStop(.42, '#172021');
    gradient.addColorStop(1, '#0c1112');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.globalAlpha = .08;
    ctx.strokeStyle = '#e7ff51';
    ctx.lineWidth = 1;
    const spacing = 48;
    const drift = (now * .005) % spacing;
    for (let x = -height; x < width + height; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x + drift, 0);
      ctx.lineTo(x + height + drift, height);
      ctx.stroke();
    }
    ctx.restore();
    const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .24, width / 2, height / 2, Math.max(width, height) * .75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,.38)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  function drawTrail(now) {
    if (trail.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < trail.length; i += 1) {
      const age = (now - trail[i].time) / 1000;
      const alpha = Math.max(0, 1 - age / TRAIL_LIFE) * .55;
      if (alpha <= 0) continue;
      ctx.strokeStyle = 'rgba(231, 255, 81, ' + alpha + ')';
      ctx.lineWidth = 1.5 + (1 - age / TRAIL_LIFE) * 1.5;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGhost(geometry) {
    ctx.save();
    ctx.setLineDash([4, 7]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 118, 89, .48)';
    ctx.beginPath();
    ctx.moveTo(geometry.origin.x, geometry.origin.y);
    ctx.lineTo(geometry.joint.x, geometry.joint.y);
    ctx.lineTo(geometry.weight.x, geometry.weight.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff7659';
    ctx.beginPath();
    ctx.arc(geometry.weight.x, geometry.weight.y, 5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawJoint(x, y, radius, color) {
    ctx.fillStyle = 'rgba(0, 0, 0, .4)';
    ctx.beginPath(); ctx.arc(x + 2, y + 3, radius + 2, 0, TAU); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath(); ctx.arc(x - radius * .28, y - radius * .32, radius * .25, 0, TAU); ctx.fill();
  }

  function drawWeight(x, y, radius, color) {
    ctx.fillStyle = 'rgba(0, 0, 0, .48)';
    ctx.beginPath(); ctx.arc(x + 3, y + 4, radius + 3, 0, TAU); ctx.fill();
    const ball = ctx.createRadialGradient(x - radius * .35, y - radius * .4, 1, x, y, radius);
    ball.addColorStop(0, '#fbffd6'); ball.addColorStop(.22, color); ball.addColorStop(1, '#aebc26');
    ctx.fillStyle = ball;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.stroke();
  }

  function drawPendulum(geometry) {
    const origin = geometry.origin; const joint = geometry.joint; const weight = geometry.weight;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0, 0, 0, .32)'; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(joint.x, joint.y); ctx.lineTo(weight.x, weight.y); ctx.stroke();
    ctx.strokeStyle = '#deded1'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(joint.x, joint.y); ctx.lineTo(weight.x, weight.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, .7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(origin.x - 1, origin.y); ctx.lineTo(joint.x - 1, joint.y); ctx.lineTo(weight.x - 1, weight.y); ctx.stroke();
    drawJoint(origin.x, origin.y, 7, '#e7ff51'); drawJoint(joint.x, joint.y, 10, '#f4f1e8'); drawWeight(weight.x, weight.y, 15, '#e7ff51');
    ctx.restore();
  }

  function drawAnnotations(geometry) {
    ctx.save();
    ctx.fillStyle = 'rgba(244, 241, 232, .48)';
    ctx.font = '10px "SFMono-Regular", Consolas, monospace';
    ctx.fillText('PIVOT / A', geometry.origin.x + 14, geometry.origin.y - 14);
    ctx.fillText('JOINT / B', geometry.joint.x + 14, geometry.joint.y - 13);
    ctx.fillStyle = 'rgba(231, 255, 81, .78)';
    ctx.fillText('m₂', geometry.weight.x + 21, geometry.weight.y + 4);
    ctx.restore();
  }

  function draw(now) {
    drawBackground(now);
    const geometry = getGeometry(primary);
    drawTrail(now);
    if (ui.ghostToggle.checked) drawGhost(getGeometry(ghost));
    drawPendulum(geometry);
    if (width > 650 && height > 450) drawAnnotations(geometry);
  }

  function stepSimulation(dt, now) {
    accumulator += dt;
    let iterations = 0;
    while (accumulator >= FIXED_STEP && iterations < 20) {
      primary = rk4Step(primary, FIXED_STEP);
      ghost = rk4Step(ghost, FIXED_STEP);
      elapsed += FIXED_STEP;
      accumulator -= FIXED_STEP;
      iterations += 1;
    }
    if (now - lastTrailSample > 16) {
      const point = getGeometry(primary).weight;
      trail.push({ x: point.x, y: point.y, time: now });
      lastTrailSample = now;
    }
    const cutoff = now - TRAIL_LIFE * 1000;
    while (trail.length && trail[0].time < cutoff) trail.shift();
    updateReadout();
  }

  function frame(now) {
    const rawDt = (now - lastFrame) / 1000;
    const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);
    lastFrame = now;
    if (running) stepSimulation(dt, now);
    draw(now);
    requestAnimationFrame(frame);
  }

  [ui.mass1, ui.mass2, ui.length1, ui.length2].forEach(function (input) { input.addEventListener('input', updateParams); });
  ui.toggleButton.addEventListener('click', function () { setRunning(!running); });
  ui.resetButton.addEventListener('click', function () { reset(); setRunning(false); });
  window.addEventListener('resize', resize, { passive: true });
  updateParams(); resize(); setRunning(false); requestAnimationFrame(frame);
}());
