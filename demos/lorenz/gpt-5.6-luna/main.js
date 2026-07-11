(function () {
  "use strict";

  const canvas = document.getElementById("lorenzCanvas");
  const ctx = canvas.getContext("2d", { alpha: true });
  const pauseButton = document.getElementById("pauseButton");
  const resetButton = document.getElementById("resetButton");
  const speedRange = document.getElementById("speedRange");
  const trailRange = document.getElementById("trailRange");
  const speedValue = document.getElementById("speedValue");
  const trailValue = document.getElementById("trailValue");

  const SIGMA = 10;
  const RHO = 28;
  const BETA = 8 / 3;
  const STEP = 0.006;
  const MAX_TRAIL = 5200;
  const DPR_LIMIT = 2;
  const TAU = Math.PI * 2;

  let width = 1;
  let height = 1;
  let dpr = 1;
  let running = true;
  let accumulator = 0;
  let cameraAngle = -0.42;
  let state = { x: 0.11, y: 0, z: 0 };
  let trail = [];
  let speed = Number(speedRange.value);
  let trailRatio = Number(trailRange.value) / 100;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function derivatives(point) {
    return {
      x: SIGMA * (point.y - point.x),
      y: point.x * (RHO - point.z) - point.y,
      z: point.x * point.y - BETA * point.z
    };
  }

  function integrate(point, dt) {
    const k1 = derivatives(point);
    const p2 = { x: point.x + k1.x * dt / 2, y: point.y + k1.y * dt / 2, z: point.z + k1.z * dt / 2 };
    const k2 = derivatives(p2);
    const p3 = { x: point.x + k2.x * dt / 2, y: point.y + k2.y * dt / 2, z: point.z + k2.z * dt / 2 };
    const k3 = derivatives(p3);
    const p4 = { x: point.x + k3.x * dt, y: point.y + k3.y * dt, z: point.z + k3.z * dt };
    const k4 = derivatives(p4);

    return {
      x: point.x + dt * (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6,
      y: point.y + dt * (k1.y + 2 * k2.y + 2 * k3.y + k4.y) / 6,
      z: point.z + dt * (k1.z + 2 * k2.z + 2 * k3.z + k4.z) / 6
    };
  }

  function addPoint(point) {
    trail.push({ x: point.x, y: point.y, z: point.z });
    if (trail.length > MAX_TRAIL) trail.shift();
  }

  function reset() {
    state = { x: 0.11, y: 0, z: 0 };
    trail = [];
    accumulator = 0;
    for (let i = 0; i < 100; i += 1) state = integrate(state, STEP);
    for (let i = 0; i < 1500; i += 1) {
      state = integrate(state, STEP);
      addPoint(state);
    }
  }

  function project(point) {
    const cos = Math.cos(cameraAngle);
    const sin = Math.sin(cameraAngle);
    const rotatedX = point.x * cos - point.y * sin;
    const depth = point.x * sin + point.y * cos;
    const vertical = (point.z - 24) * 0.9 - depth * 0.14;
    const scale = Math.min(width, height) * 0.0152;
    const perspective = 1 / (1 + depth * 0.0024);
    return {
      x: width * 0.54 + rotatedX * scale * perspective,
      y: height * 0.54 - vertical * scale * perspective,
      perspective: perspective
    };
  }

  function colorAt(t, alpha) {
    return "hsla(" + (185 + t * 115) + ", 95%, " + (64 - t * 7) + "%, " + alpha + ")";
  }

  function drawGlow() {
    const gradient = ctx.createRadialGradient(width * 0.52, height * 0.53, 0, width * 0.52, height * 0.53, Math.min(width, height) * 0.48);
    gradient.addColorStop(0, "rgba(66, 85, 210, 0.12)");
    gradient.addColorStop(0.42, "rgba(37, 109, 173, 0.045)");
    gradient.addColorStop(1, "rgba(5, 7, 19, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function drawTrail() {
    const visibleCount = Math.max(120, Math.floor(trail.length * trailRatio));
    const start = trail.length - visibleCount;
    const projected = [];
    for (let i = start; i < trail.length; i += 1) projected.push(project(trail[i]));

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let pass = 0; pass < 2; pass += 1) {
      ctx.beginPath();
      for (let i = 1; i < projected.length; i += 1) {
        if (i === 1) ctx.moveTo(projected[i - 1].x, projected[i - 1].y);
        ctx.lineTo(projected[i].x, projected[i].y);
      }
      ctx.lineWidth = pass === 0 ? 7 : 1.15;
      ctx.strokeStyle = pass === 0 ? "rgba(89, 177, 255, 0.045)" : "rgba(123, 214, 255, 0.1)";
      ctx.stroke();
    }

    for (let i = 1; i < projected.length; i += 1) {
      const previous = projected[i - 1];
      const point = projected[i];
      const t = i / (projected.length - 1);
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(point.x, point.y);
      ctx.lineWidth = 0.45 + t * 1.3;
      ctx.strokeStyle = colorAt(t, (0.08 + t * 0.8) * point.perspective);
      ctx.stroke();
    }

    if (projected.length > 0) {
      const tip = projected[projected.length - 1];
      const tipGlow = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 17);
      tipGlow.addColorStop(0, "rgba(235, 255, 255, 0.9)");
      tipGlow.addColorStop(0.2, "rgba(107, 239, 255, 0.55)");
      tipGlow.addColorStop(1, "rgba(107, 239, 255, 0)");
      ctx.fillStyle = tipGlow;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 17, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(235, 255, 255, 0.95)";
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 1.7, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFrame() {
    ctx.clearRect(0, 0, width, height);
    drawGlow();
    drawTrail();
  }

  function update(dt) {
    if (!running) return;
    accumulator += Math.min(dt, 0.05) * speed;
    let steps = 0;
    while (accumulator >= STEP && steps < 20) {
      state = integrate(state, STEP);
      addPoint(state);
      accumulator -= STEP;
      steps += 1;
    }
    cameraAngle += dt * 0.055;
  }

  function frame(now) {
    const dt = Math.min((now - frame.lastTime) / 1000, 0.05);
    frame.lastTime = now;
    update(dt);
    drawFrame();
    requestAnimationFrame(frame);
  }
  frame.lastTime = performance.now();

  function togglePause() {
    running = !running;
    pauseButton.setAttribute("aria-pressed", String(!running));
    pauseButton.setAttribute("aria-label", running ? "Пауза" : "Продолжить");
    pauseButton.innerHTML = running
      ? '<span class="pause-icon" aria-hidden="true"><i></i><i></i></span>'
      : '<span class="play-icon" aria-hidden="true"></span>';
  }

  speedRange.addEventListener("input", function () {
    speed = Number(speedRange.value);
    speedValue.textContent = speed.toFixed(1) + "×";
  });

  trailRange.addEventListener("input", function () {
    trailRatio = Number(trailRange.value) / 100;
    trailValue.textContent = trailRange.value + "%";
  });

  pauseButton.addEventListener("click", togglePause);
  resetButton.addEventListener("click", reset);
  window.addEventListener("resize", resize, { passive: true });

  resize();
  reset();
  requestAnimationFrame(frame);
}());

