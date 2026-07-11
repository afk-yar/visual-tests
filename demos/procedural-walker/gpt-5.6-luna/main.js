(() => {
  "use strict";

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const speedInput = document.getElementById("speed");
  const speedOutput = document.getElementById("speed-output");
  const gaitMode = document.getElementById("gait-mode");
  const phaseStatus = document.getElementById("phase-status");
  const pauseButton = document.getElementById("pause-button");
  const pauseLabel = document.getElementById("pause-label");

  const TAU = Math.PI * 2;
  const colors = { ink: "#f4f7eb", warm: "#ff9d7a", warmLight: "#ffd0a9", lime: "#c9f36b", aqua: "#79d6c0" };
  const state = {
    width: window.innerWidth, height: window.innerHeight, dpr: 1, elapsed: 0, travel: 0, cycle: 0,
    targetSpeed: Number(speedInput.value) / 100, speed: Number(speedInput.value) / 100,
    paused: false, lastTime: 0, stars: []
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, amount) => a + (b - a) * amount;
  const smoothStep = (value) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
  const easeInOut = (value) => { const t = clamp(value, 0, 1); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

  function makeStars() {
    let seed = 928371;
    const count = Math.ceil((state.width * state.height) / 16500);
    state.stars = [];
    for (let index = 0; index < count; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const x = (seed / 4294967296) * state.width;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const y = (seed / 4294967296) * state.height * 0.63;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const radius = 0.5 + (seed / 4294967296) * 1.35;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const alpha = 0.12 + (seed / 4294967296) * 0.35;
      state.stars.push({ x, y, radius, alpha });
    }
  }

  function resize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    makeStars();
  }

  function getGait() {
    const intensity = smoothStep(state.speed);
    return {
      intensity,
      cadence: lerp(0.72, 2.18, intensity),
      stride: lerp(38, 104, intensity),
      support: lerp(0.64, 0.48, intensity),
      stepHeight: lerp(8, 25, intensity),
      lean: lerp(0.012, 0.14, intensity)
    };
  }

  function groundY() { return Math.min(state.height * 0.78, state.height - 72); }

  function footPose(phaseOffset, gait, anchorX, ground) {
    const shiftedCycle = state.cycle - phaseOffset;
    const contactIndex = Math.floor(shiftedCycle + 0.000001);
    const localPhase = shiftedCycle - contactIndex;
    const contactTime = contactIndex + phaseOffset;
    const contactWorldX = contactTime * gait.stride;
    const nextWorldX = contactWorldX + gait.stride;
    const swing = localPhase > gait.support;
    let worldX = contactWorldX;
    let lift = 0;

    if (swing) {
      const transfer = (localPhase - gait.support) / (1 - gait.support);
      worldX = lerp(contactWorldX, nextWorldX, easeInOut(transfer));
      lift = Math.sin(transfer * Math.PI) * gait.stepHeight;
    }
    return { x: anchorX + worldX - state.travel, y: ground - lift, worldX, localPhase, swing };
  }

  function solveIK(hip, foot, upperLength, lowerLength, bendDirection) {
    const dx = foot.x - hip.x;
    const dy = foot.y - hip.y;
    const distance = Math.max(0.001, Math.hypot(dx, dy));
    const reach = clamp(distance, Math.abs(upperLength - lowerLength) + 0.001, upperLength + lowerLength - 0.001);
    const baseAngle = Math.atan2(dy, dx);
    const cosine = clamp((upperLength * upperLength + reach * reach - lowerLength * lowerLength) / (2 * upperLength * reach), -1, 1);
    const kneeAngle = baseAngle + Math.acos(cosine) * bendDirection;
    return { knee: { x: hip.x + Math.cos(kneeAngle) * upperLength, y: hip.y + Math.sin(kneeAngle) * upperLength }, ankle: foot };
  }

  function drawLine(points, color, width, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
    ctx.stroke(); ctx.restore();
  }

  function drawBackground(gait, ground) {
    const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
    gradient.addColorStop(0, "#091421"); gradient.addColorStop(0.58, "#0d1c28"); gradient.addColorStop(1, "#101d27");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, state.width, state.height);

    const glow = ctx.createRadialGradient(state.width * 0.51, ground - state.height * 0.09, 0, state.width * 0.51, ground - state.height * 0.09, state.width * 0.62);
    glow.addColorStop(0, "rgba(100, 183, 164, 0.17)"); glow.addColorStop(0.5, "rgba(71, 126, 125, 0.055)"); glow.addColorStop(1, "rgba(8, 17, 27, 0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, state.width, state.height);

    ctx.save();
    for (const star of state.stars) {
      const pulse = 0.82 + Math.sin(state.elapsed * 0.5 + star.x) * 0.18;
      ctx.globalAlpha = star.alpha * pulse; ctx.fillStyle = star.radius > 1.35 ? colors.aqua : "#b7d7d0";
      ctx.beginPath(); ctx.arc(star.x, star.y, star.radius, 0, TAU); ctx.fill();
    }
    ctx.restore();

    const horizon = ground - 5;
    const horizonGradient = ctx.createLinearGradient(0, horizon - 80, 0, horizon + 40);
    horizonGradient.addColorStop(0, "rgba(13, 34, 42, 0)"); horizonGradient.addColorStop(1, "rgba(80, 164, 148, 0.13)");
    ctx.fillStyle = horizonGradient; ctx.fillRect(0, horizon - 80, state.width, 120);
    ctx.save(); ctx.strokeStyle = "rgba(107, 188, 174, 0.13)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, horizon); ctx.lineTo(state.width, horizon); ctx.stroke(); ctx.restore();
    drawGround(gait, ground);
  }

  function drawGround(gait, ground) {
    const spacing = Math.max(46, gait.stride * 0.78);
    const offset = mod(state.travel, spacing);
    const depth = Math.max(150, state.height - ground);
    ctx.save();
    for (let index = -2; index < state.width / spacing + 3; index += 1) {
      const x = index * spacing - offset;
      const segment = 20 + mod(index * 17, 28);
      const alpha = 0.12 + (1 - Math.min(1, Math.abs(x - state.width * 0.5) / state.width)) * 0.1;
      ctx.strokeStyle = `rgba(107, 188, 174, ${alpha})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, ground + 8); ctx.lineTo(x + segment, ground + 8); ctx.stroke();
      ctx.strokeStyle = "rgba(107, 188, 174, 0.055)"; ctx.beginPath(); ctx.moveTo(x + segment * 0.4, ground + 8); ctx.lineTo(x + segment * 0.4 - 18, ground + depth * 0.52); ctx.stroke();
    }
    const baseGradient = ctx.createLinearGradient(0, ground, 0, state.height);
    baseGradient.addColorStop(0, "rgba(35, 75, 76, 0.12)"); baseGradient.addColorStop(1, "rgba(9, 19, 28, 0.02)");
    ctx.fillStyle = baseGradient; ctx.fillRect(0, ground + 10, state.width, state.height - ground); ctx.restore();
  }

  function drawFootMarker(foot, ground, color, isSwing) {
    ctx.save(); ctx.globalAlpha = isSwing ? 0.18 : 0.42; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(foot.x - 11, ground + 8); ctx.lineTo(foot.x + 11, ground + 8); ctx.stroke(); ctx.restore();
  }

  function drawCharacter(gait, ground) {
    const anchorX = state.width * 0.5;
    const figureScale = clamp(Math.min(state.width / 900, state.height / 690), 0.58, 1.12);
    const phase = state.cycle * TAU;
    const bob = Math.sin(phase * 2 + 0.35) * lerp(1.6, 4.4, gait.intensity) * figureScale;
    const sway = Math.sin(phase + 0.7) * lerp(1.5, 4.8, gait.intensity) * figureScale;
    const hip = { x: anchorX + sway, y: ground - 118 * figureScale + bob };
    const torsoLength = 77 * figureScale;
    const torsoAngle = Math.sin(phase + 0.18) * 0.018 + gait.lean;
    const chest = { x: hip.x + Math.sin(torsoAngle) * torsoLength, y: hip.y - Math.cos(torsoAngle) * torsoLength };
    const neck = { x: chest.x + Math.sin(torsoAngle) * 9 * figureScale, y: chest.y - Math.cos(torsoAngle) * 9 * figureScale };
    const head = { x: neck.x + Math.sin(torsoAngle) * 18 * figureScale, y: neck.y - Math.cos(torsoAngle) * 18 * figureScale };
    const leftFoot = footPose(0, gait, anchorX, ground);
    const rightFoot = footPose(0.5, gait, anchorX, ground);
    const leftLeg = solveIK(hip, leftFoot, 68 * figureScale, 68 * figureScale, -1);
    const rightLeg = solveIK(hip, rightFoot, 68 * figureScale, 68 * figureScale, -1);

    const armSwing = Math.sin(phase + 0.15);
    const shoulderSpan = 26 * figureScale;
    const leftShoulder = { x: chest.x - Math.cos(torsoAngle) * shoulderSpan, y: chest.y - Math.sin(torsoAngle) * shoulderSpan };
    const rightShoulder = { x: chest.x + Math.cos(torsoAngle) * shoulderSpan, y: chest.y + Math.sin(torsoAngle) * shoulderSpan };
    const armLength = 43 * figureScale;
    const leftHand = { x: leftShoulder.x + (18 - armSwing * 30) * figureScale, y: leftShoulder.y + (armLength * 1.65 + Math.abs(armSwing) * 3) * figureScale };
    const rightHand = { x: rightShoulder.x + (18 + armSwing * 30) * figureScale, y: rightShoulder.y + (armLength * 1.65 + Math.abs(armSwing) * 3) * figureScale };
    const leftArm = solveIK(leftShoulder, leftHand, armLength, armLength, 1);
    const rightArm = solveIK(rightShoulder, rightHand, armLength, armLength, -1);

    drawFootMarker(leftFoot, ground, colors.warm, leftFoot.swing); drawFootMarker(rightFoot, ground, colors.aqua, rightFoot.swing);
    ctx.save();
    ctx.fillStyle = "rgba(2, 10, 16, 0.38)"; ctx.filter = "blur(7px)";
    ctx.beginPath(); ctx.ellipse(leftFoot.x, ground + 10, 25 * figureScale, 5 * figureScale, 0, 0, TAU); ctx.ellipse(rightFoot.x, ground + 10, 25 * figureScale, 5 * figureScale, 0, 0, TAU); ctx.fill(); ctx.restore();

    drawLine([hip, rightLeg.knee, rightLeg.ankle], "#587b79", 7 * figureScale, 0.95);
    drawLine([hip, leftLeg.knee, leftLeg.ankle], colors.warm, 7 * figureScale);
    drawLine([rightLeg.ankle, { x: rightLeg.ankle.x + 13 * figureScale, y: rightLeg.ankle.y }], "#86aaa0", 5 * figureScale, 0.9);
    drawLine([leftLeg.ankle, { x: leftLeg.ankle.x + 13 * figureScale, y: leftLeg.ankle.y }], colors.warmLight, 5 * figureScale);
    drawLine([rightShoulder, rightArm.knee, rightArm.ankle], "#5f9890", 6 * figureScale, 0.93);
    drawLine([leftShoulder, leftArm.knee, leftArm.ankle], colors.warm, 6 * figureScale, 0.95);

    ctx.save(); ctx.strokeStyle = colors.ink; ctx.lineWidth = 9 * figureScale; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(chest.x, chest.y); ctx.stroke();
    ctx.strokeStyle = "rgba(255, 208, 169, 0.6)"; ctx.lineWidth = 3 * figureScale; ctx.beginPath(); ctx.moveTo(hip.x - 2 * figureScale, hip.y - 3 * figureScale); ctx.lineTo(chest.x - 2 * figureScale, chest.y + 2 * figureScale); ctx.stroke(); ctx.restore();

    ctx.save(); ctx.fillStyle = "#162331"; ctx.strokeStyle = colors.ink; ctx.lineWidth = 5 * figureScale; ctx.beginPath(); ctx.arc(head.x, head.y, 19 * figureScale, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = colors.warmLight; ctx.beginPath(); ctx.arc(head.x + 6 * figureScale, head.y - 3 * figureScale, 2.2 * figureScale, 0, TAU); ctx.fill(); ctx.restore();
    ctx.save(); ctx.fillStyle = colors.warmLight; ctx.beginPath(); ctx.arc(leftArm.ankle.x, leftArm.ankle.y, 4.2 * figureScale, 0, TAU); ctx.arc(rightArm.ankle.x, rightArm.ankle.y, 4.2 * figureScale, 0, TAU); ctx.fill(); ctx.restore();
    drawPhaseBadge(leftFoot, rightFoot, figureScale);
  }

  function drawPhaseBadge(leftFoot, rightFoot, scale) {
    const active = leftFoot.swing === rightFoot.swing ? leftFoot : (leftFoot.swing ? leftFoot : rightFoot);
    const label = active.swing ? "TRANSFER" : "SUPPORT";
    const x = active.x + (active.x < state.width * 0.5 ? -78 : 20) * scale;
    const y = active.y - 27 * scale;
    ctx.save(); ctx.globalAlpha = 0.68; ctx.fillStyle = "rgba(10, 21, 30, 0.74)"; ctx.strokeStyle = active.swing ? "rgba(255, 157, 122, 0.38)" : "rgba(201, 243, 107, 0.38)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y - 12 * scale, 58 * scale, 18 * scale, 9 * scale); ctx.fill(); ctx.stroke();
    ctx.fillStyle = active.swing ? colors.warm : colors.lime; ctx.font = `700 ${8 * scale}px Inter, ui-sans-serif, system-ui, sans-serif`; ctx.fillText(label, x + 9 * scale, y); ctx.restore();
  }

  function render() {
    const gait = getGait();
    const ground = groundY();
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    drawBackground(gait, ground); drawCharacter(gait, ground);
  }

  function updateReadout() {
    const percentage = Math.round(state.targetSpeed * 100);
    const gait = getGait();
    const mode = percentage < 24 ? "Очень медленно" : percentage < 51 ? "Спокойная ходьба" : percentage < 76 ? "Уверенная ходьба" : "Лёгкий бег";
    const leftLocal = state.cycle - Math.floor(state.cycle);
    speedOutput.textContent = `${percentage}%`; gaitMode.textContent = mode; phaseStatus.textContent = leftLocal <= gait.support ? "опора" : "перенос";
    speedInput.style.setProperty("--range-progress", `${percentage}%`);
  }

  function togglePause() {
    state.paused = !state.paused;
    pauseButton.classList.toggle("is-paused", state.paused); pauseButton.setAttribute("aria-pressed", String(state.paused)); pauseLabel.textContent = state.paused ? "Продолжить" : "Пауза";
  }

  function tick(timestamp) {
    if (!state.lastTime) state.lastTime = timestamp;
    const dt = clamp((timestamp - state.lastTime) / 1000, 0, 0.05);
    state.lastTime = timestamp;
    const smoothing = 1 - Math.exp(-dt * 7);
    state.speed += (state.targetSpeed - state.speed) * smoothing;
    if (!state.paused) {
      const gait = getGait(); state.elapsed += dt; state.cycle += dt * gait.cadence; state.travel += dt * gait.cadence * gait.stride;
    }
    updateReadout(); render(); window.requestAnimationFrame(tick);
  }

  speedInput.addEventListener("input", () => { state.targetSpeed = Number(speedInput.value) / 100; updateReadout(); });
  pauseButton.addEventListener("click", togglePause);
  window.addEventListener("keydown", (event) => { if (event.code === "Space" && event.target === document.body) { event.preventDefault(); togglePause(); } });
  window.addEventListener("resize", resize, { passive: true });
  resize(); updateReadout(); window.requestAnimationFrame(tick);
})();
