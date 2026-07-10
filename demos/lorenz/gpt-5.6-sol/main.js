(function () {
  "use strict";

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d", { alpha: false });
  const timeOutput = document.getElementById("sim-time");
  const countOutput = document.getElementById("point-count");
  const pauseButton = document.getElementById("pause-button");
  const pauseIcon = pauseButton.querySelector(".button-icon");
  const pauseLabel = pauseButton.querySelector(".button-label");
  const resetButton = document.getElementById("reset-button");

  const SIGMA = 10;
  const RHO = 28;
  const BETA = 8 / 3;
  const INTEGRATION_STEP = 0.005;
  const SIMULATION_SPEED = 2.15;
  const MAX_TRAIL_POINTS = 3600;
  const WARMUP_STEPS = 1400;
  const INITIAL_TRAIL_STEPS = 2100;
  const COLOR_BUCKETS = 72;

  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let state = { x: 0.1, y: 0, z: 0 };
  let trail = [];
  let simulationTime = 0;
  let accumulator = 0;
  let lastFrameTime = 0;
  let lastTelemetryUpdate = 0;
  let paused = false;
  let yawOffset = 0;
  let pitchOffset = 0;
  let zoom = 1;
  let dragStart = null;
  let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function derivatives(point) {
    return {
      x: SIGMA * (point.y - point.x),
      y: point.x * (RHO - point.z) - point.y,
      z: point.x * point.y - BETA * point.z
    };
  }

  function rk4(point, dt) {
    const k1 = derivatives(point);
    const k2 = derivatives({
      x: point.x + k1.x * dt * 0.5,
      y: point.y + k1.y * dt * 0.5,
      z: point.z + k1.z * dt * 0.5
    });
    const k3 = derivatives({
      x: point.x + k2.x * dt * 0.5,
      y: point.y + k2.y * dt * 0.5,
      z: point.z + k2.z * dt * 0.5
    });
    const k4 = derivatives({
      x: point.x + k3.x * dt,
      y: point.y + k3.y * dt,
      z: point.z + k3.z * dt
    });

    return {
      x: point.x + dt * (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6,
      y: point.y + dt * (k1.y + 2 * k2.y + 2 * k3.y + k4.y) / 6,
      z: point.z + dt * (k1.z + 2 * k2.z + 2 * k3.z + k4.z) / 6
    };
  }

  function advance(recordPoint) {
    state = rk4(state, INTEGRATION_STEP);
    simulationTime += INTEGRATION_STEP;

    if (recordPoint) {
      trail.push({ x: state.x, y: state.y, z: state.z });
      if (trail.length > MAX_TRAIL_POINTS) {
        trail.splice(0, trail.length - MAX_TRAIL_POINTS);
      }
    }
  }

  function resetSimulation() {
    state = { x: 0.1, y: 0, z: 0 };
    trail = [];
    simulationTime = 0;
    accumulator = 0;

    for (let i = 0; i < WARMUP_STEPS; i += 1) {
      advance(false);
    }
    for (let i = 0; i < INITIAL_TRAIL_STEPS; i += 1) {
      advance(true);
    }
    updateTelemetry(true);
  }

  function resize() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function project(point, yaw, pitch) {
    const modelX = point.x;
    const modelY = point.z - 25;
    const modelZ = point.y;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const rotatedX = modelX * cosYaw + modelZ * sinYaw;
    const yawDepth = -modelX * sinYaw + modelZ * cosYaw;
    const rotatedY = modelY * cosPitch - yawDepth * sinPitch;
    const depth = modelY * sinPitch + yawDepth * cosPitch;
    const cameraDistance = 92;
    const perspective = cameraDistance / (cameraDistance - depth);
    const scale = Math.min(width, height) / 68 * zoom;
    const centerX = width * 0.5;
    const centerY = height * (width < 680 ? 0.47 : 0.54);

    return {
      x: centerX + rotatedX * scale * perspective,
      y: centerY - rotatedY * scale * perspective,
      perspective: perspective
    };
  }

  function drawBackground(now) {
    const gradient = ctx.createRadialGradient(
      width * 0.52, height * 0.5, 0,
      width * 0.52, height * 0.5, Math.max(width, height) * 0.76
    );
    gradient.addColorStop(0, "#0b1830");
    gradient.addColorStop(0.42, "#07101f");
    gradient.addColorStop(1, "#02050c");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const pulse = reducedMotion ? 0.035 : 0.035 + Math.sin(now * 0.00022) * 0.009;
    const halo = ctx.createRadialGradient(
      width * 0.5, height * 0.52, 4,
      width * 0.5, height * 0.52, Math.min(width, height) * 0.48
    );
    halo.addColorStop(0, "rgba(67, 211, 255, " + pulse + ")");
    halo.addColorStop(0.55, "rgba(128, 86, 255, 0.018)");
    halo.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.fillStyle = "#a7dfff";
    const spacing = Math.max(44, Math.min(width, height) / 13);
    const drift = reducedMotion ? 0 : (now * 0.0025) % spacing;

    for (let y = spacing * 0.5; y < height; y += spacing) {
      for (let x = spacing * 0.5; x < width; x += spacing) {
        const hash = Math.sin(x * 19.17 + y * 7.13) * 43758.5453;
        const random = hash - Math.floor(hash);
        if (random > 0.68) {
          ctx.globalAlpha = 0.035 + random * 0.08;
          ctx.fillRect((x + drift * 0.18) % width, y, 1, 1);
        }
      }
    }
    ctx.restore();
  }

  function drawOrbitGuide(yaw, pitch) {
    const guidePoints = [];
    for (let i = 0; i <= 96; i += 1) {
      const angle = i / 96 * Math.PI * 2;
      guidePoints.push(project({
        x: Math.cos(angle) * 27,
        y: Math.sin(angle) * 27,
        z: 1.5
      }, yaw, pitch));
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(guidePoints[0].x, guidePoints[0].y);
    for (let i = 1; i < guidePoints.length; i += 1) {
      ctx.lineTo(guidePoints[i].x, guidePoints[i].y);
    }
    ctx.strokeStyle = "rgba(128, 204, 244, 0.055)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 8]);
    ctx.stroke();
    ctx.restore();
  }

  function trailColor(t, alpha) {
    const hue = 194 + t * 126;
    const saturation = 92 - t * 8;
    const lightness = 62 + Math.sin(t * Math.PI) * 10;
    return "hsla(" + hue + ", " + saturation + "%, " + lightness + "%, " + alpha + ")";
  }

  function drawTrail(now, yaw, pitch) {
    if (trail.length < 2) {
      return;
    }

    const projected = new Array(trail.length);
    for (let i = 0; i < trail.length; i += 1) {
      projected[i] = project(trail[i], yaw, pitch);
    }

    const bucketSize = Math.max(1, Math.ceil((trail.length - 1) / COLOR_BUCKETS));
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "lighter";

    for (let bucket = 0; bucket < COLOR_BUCKETS; bucket += 1) {
      const start = bucket * bucketSize;
      if (start >= trail.length - 1) {
        break;
      }
      const end = Math.min(trail.length - 1, (bucket + 1) * bucketSize);
      const t = end / (trail.length - 1);
      const fade = Math.pow(t, 1.8);

      ctx.beginPath();
      ctx.moveTo(projected[start].x, projected[start].y);
      for (let i = start + 1; i <= end; i += 1) {
        ctx.lineTo(projected[i].x, projected[i].y);
      }
      ctx.strokeStyle = trailColor(t, 0.055 + fade * 0.16);
      ctx.lineWidth = 5 + fade * 5;
      ctx.stroke();
    }

    for (let bucket = 0; bucket < COLOR_BUCKETS; bucket += 1) {
      const start = bucket * bucketSize;
      if (start >= trail.length - 1) {
        break;
      }
      const end = Math.min(trail.length - 1, (bucket + 1) * bucketSize);
      const t = end / (trail.length - 1);
      const fade = Math.pow(t, 1.35);

      ctx.beginPath();
      ctx.moveTo(projected[start].x, projected[start].y);
      for (let i = start + 1; i <= end; i += 1) {
        ctx.lineTo(projected[i].x, projected[i].y);
      }
      ctx.strokeStyle = trailColor(t, 0.08 + fade * 0.84);
      ctx.lineWidth = (0.45 + fade * 1.5) * projected[end].perspective;
      ctx.stroke();
    }

    const head = projected[projected.length - 1];
    const headPulse = reducedMotion ? 1 : 1 + Math.sin(now * 0.006) * 0.16;
    const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 17 * headPulse);
    glow.addColorStop(0, "rgba(255, 235, 251, 0.98)");
    glow.addColorStop(0.12, "rgba(255, 123, 211, 0.8)");
    glow.addColorStop(0.48, "rgba(194, 75, 255, 0.2)");
    glow.addColorStop(1, "rgba(150, 70, 255, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 17 * headPulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function updateTelemetry(force) {
    const now = performance.now();
    if (!force && now - lastTelemetryUpdate < 180) {
      return;
    }
    lastTelemetryUpdate = now;
    timeOutput.textContent = simulationTime.toFixed(2);
    countOutput.textContent = String(trail.length);
  }

  function setPaused(nextPaused) {
    paused = nextPaused;
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseIcon.textContent = paused ? "▶" : "Ⅱ";
    pauseLabel.textContent = paused ? "Продолжить" : "Пауза";
  }

  function animate(now) {
    const rawDelta = lastFrameTime ? (now - lastFrameTime) / 1000 : 0;
    const delta = Math.min(Math.max(rawDelta, 0), 0.05);
    lastFrameTime = now;

    if (!paused) {
      accumulator += delta * SIMULATION_SPEED;
      while (accumulator >= INTEGRATION_STEP) {
        advance(true);
        accumulator -= INTEGRATION_STEP;
      }
    }

    const autoYaw = reducedMotion ? 0.55 : now * 0.000065;
    const autoPitch = reducedMotion ? -0.12 : -0.13 + Math.sin(now * 0.00017) * 0.055;
    const yaw = autoYaw + yawOffset;
    const pitch = Math.max(-0.72, Math.min(0.62, autoPitch + pitchOffset));

    drawBackground(now);
    drawOrbitGuide(yaw, pitch);
    drawTrail(now, yaw, pitch);
    updateTelemetry(false);
    requestAnimationFrame(animate);
  }

  pauseButton.addEventListener("click", function () {
    setPaused(!paused);
  });

  resetButton.addEventListener("click", function () {
    resetSimulation();
  });

  canvas.addEventListener("pointerdown", function (event) {
    canvas.setPointerCapture(event.pointerId);
    dragStart = {
      x: event.clientX,
      y: event.clientY,
      yaw: yawOffset,
      pitch: pitchOffset
    };
  });

  canvas.addEventListener("pointermove", function (event) {
    if (!dragStart) {
      return;
    }
    yawOffset = dragStart.yaw + (event.clientX - dragStart.x) * 0.006;
    pitchOffset = Math.max(-0.58, Math.min(0.58,
      dragStart.pitch + (event.clientY - dragStart.y) * 0.005
    ));
  });

  function finishDrag(event) {
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    dragStart = null;
  }

  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);

  canvas.addEventListener("wheel", function (event) {
    event.preventDefault();
    zoom = Math.max(0.62, Math.min(1.65, zoom * Math.exp(-event.deltaY * 0.001)));
  }, { passive: false });

  window.addEventListener("keydown", function (event) {
    if (event.code === "Space") {
      event.preventDefault();
      setPaused(!paused);
    } else if (event.key.toLowerCase() === "r") {
      resetSimulation();
    }
  });

  window.addEventListener("resize", resize);
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", function (event) {
    reducedMotion = event.matches;
  });

  resize();
  resetSimulation();
  requestAnimationFrame(animate);
}());
