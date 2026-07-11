(() => {
  "use strict";

  const canvas = document.getElementById("surfaceCanvas");
  const ctx = canvas.getContext("2d");
  const functionSelect = document.getElementById("functionSelect");
  const speedRange = document.getElementById("speedRange");
  const lightRange = document.getElementById("lightRange");
  const wireToggle = document.getElementById("wireToggle");
  const pauseButton = document.getElementById("pauseButton");
  const pauseLabel = document.getElementById("pauseLabel");
  const speedValue = document.getElementById("speedValue");
  const lightValue = document.getElementById("lightValue");
  const functionDescription = document.getElementById("functionDescription");
  const modeMetric = document.getElementById("modeMetric");
  const meshMetric = document.getElementById("meshMetric");

  const GRID = 42;
  const EXTENT = 5.3;
  const PI2 = Math.PI * 2;
  const palette = [[28, 49, 135], [36, 104, 194], [51, 194, 217], [168, 238, 186], [237, 231, 124], [255, 159, 80]];
  const state = { width: 0, height: 0, dpr: 1, time: 0, lastTime: 0, paused: false, speed: 1, lightElevation: 42, wireframe: true, mode: "ripple", yaw: -0.66, pitch: 0.9 };
  const nodes = Array.from({ length: GRID * GRID }, () => ({ x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, sx: 0, sy: 0, depth: 0 }));
  const polygons = [];

  const descriptions = {
    ripple: "Затухающая рябь — волна расходится от центра и постепенно затихает.",
    saddle: "Гиперболический параболоид — две оси изгибаются в противоположных направлениях.",
    gaussian: "Гауссиана — мягкий пик с плавным спадом к краям поверхности."
  };
  const labels = { ripple: "РЯБЬ", saddle: "СЕДЛО", gaussian: "ГАУСС" };

  function resize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  function calculateHeight(x, y, time) {
    const r = Math.sqrt(x * x + y * y);
    if (state.mode === "saddle") return (x * x - y * y) * 0.095;
    if (state.mode === "gaussian") return Math.exp(-(r * r) * 0.28) * 2.9 - 0.35;
    const safeR = r < 0.001 ? 0.001 : r;
    return (Math.sin(r * 3.5 - time * 2.4) / (1 + r * 0.48)) * 1.28;
  }

  function calculateSurface() {
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let row = 0; row < GRID; row += 1) {
      for (let col = 0; col < GRID; col += 1) {
        const node = nodes[row * GRID + col];
        node.x = (col / (GRID - 1) - 0.5) * EXTENT * 2;
        node.y = (row / (GRID - 1) - 0.5) * EXTENT * 2;
        node.z = calculateHeight(node.x, node.y, state.time);
        minZ = Math.min(minZ, node.z);
        maxZ = Math.max(maxZ, node.z);
      }
    }
    for (let row = 0; row < GRID; row += 1) {
      for (let col = 0; col < GRID; col += 1) {
        const node = nodes[row * GRID + col];
        const left = nodes[row * GRID + Math.max(0, col - 1)];
        const right = nodes[row * GRID + Math.min(GRID - 1, col + 1)];
        const up = nodes[Math.max(0, row - 1) * GRID + col];
        const down = nodes[Math.min(GRID - 1, row + 1) * GRID + col];
        node.nx = -(right.z - left.z);
        node.ny = -(down.z - up.z);
        node.nz = 2;
        const normalLength = Math.hypot(node.nx, node.ny, node.nz);
        node.nx /= normalLength;
        node.ny /= normalLength;
        node.nz /= normalLength;
      }
    }
    return { minZ, maxZ };
  }

  function project(node) {
    const cy = Math.cos(state.yaw); const sy = Math.sin(state.yaw);
    const cp = Math.cos(state.pitch); const sp = Math.sin(state.pitch);
    const yawX = node.x * cy - node.y * sy;
    const yawDepth = node.x * sy + node.y * cy;
    const screenY = node.y * cp - yawDepth * sp - node.z * 0.7;
    const depth = node.y * sp + yawDepth * cp + node.z * 0.22;
    const perspective = 570 / (17 - depth);
    node.sx = state.width * 0.54 + yawX * perspective;
    node.sy = state.height * 0.47 + screenY * perspective;
    node.depth = depth;
  }

  function colorFor(value, minZ, maxZ, light) {
    const amount = Math.max(0, Math.min(1, (value - minZ) / Math.max(0.001, maxZ - minZ)));
    const scaled = amount * (palette.length - 1);
    const index = Math.min(palette.length - 2, Math.floor(scaled));
    const mix = scaled - index;
    const base = palette[index]; const next = palette[index + 1];
    const lift = 0.76 + light * 0.34;
    const r = Math.min(255, Math.round((base[0] + (next[0] - base[0]) * mix) * lift));
    const g = Math.min(255, Math.round((base[1] + (next[1] - base[1]) * mix) * lift));
    const b = Math.min(255, Math.round((base[2] + (next[2] - base[2]) * mix) * lift));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function drawBackground() {
    const gradient = ctx.createRadialGradient(state.width * 0.54, state.height * 0.42, 0, state.width * 0.54, state.height * 0.42, Math.max(state.width, state.height) * 0.72);
    gradient.addColorStop(0, "rgba(16, 42, 73, 0.52)");
    gradient.addColorStop(0.55, "rgba(7, 18, 32, 0.35)");
    gradient.addColorStop(1, "rgba(3, 8, 15, 0.75)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.strokeStyle = "rgba(117, 193, 219, 0.055)";
    ctx.lineWidth = 1;
    const spacing = Math.max(34, Math.min(66, state.width / 23));
    for (let x = (state.width * 0.54) % spacing; x < state.width; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, state.height); ctx.stroke();
    }
    for (let y = 0; y < state.height; y += spacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(state.width, y); ctx.stroke();
    }
  }

  function drawSurface(bounds) {
    const lightAzimuth = -0.8;
    const elevation = state.lightElevation * Math.PI / 180;
    const light = { x: Math.cos(lightAzimuth) * Math.cos(elevation), y: Math.sin(lightAzimuth) * Math.cos(elevation), z: Math.sin(elevation) };
    polygons.length = 0;
    for (let row = 0; row < GRID - 1; row += 1) {
      for (let col = 0; col < GRID - 1; col += 1) {
        const a = nodes[row * GRID + col];
        const b = nodes[row * GRID + col + 1];
        const c = nodes[(row + 1) * GRID + col + 1];
        const d = nodes[(row + 1) * GRID + col];
        const normalX = (a.nx + b.nx + c.nx + d.nx) * 0.25;
        const normalY = (a.ny + b.ny + c.ny + d.ny) * 0.25;
        const normalZ = (a.nz + b.nz + c.nz + d.nz) * 0.25;
        const lambert = Math.max(0.08, normalX * light.x + normalY * light.y + normalZ * light.z);
        polygons.push({
          points: [a, b, c, d],
          depth: (a.depth + b.depth + c.depth + d.depth) * 0.25,
          color: colorFor((a.z + b.z + c.z + d.z) * 0.25, bounds.minZ, bounds.maxZ, lambert),
          light: lambert
        });
      }
    }
    polygons.sort((first, second) => first.depth - second.depth);
    ctx.lineJoin = "round";
    for (const polygon of polygons) {
      const points = polygon.points;
      ctx.beginPath();
      ctx.moveTo(points[0].sx, points[0].sy);
      for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].sx, points[index].sy);
      ctx.closePath();
      ctx.fillStyle = polygon.color;
      ctx.fill();
      if (state.wireframe) {
        ctx.strokeStyle = `rgba(214, 250, 247, ${0.12 + polygon.light * 0.16})`;
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }
    }
  }

  function drawAxes() {
    const origin = { x: 0, y: 0, z: -1.4, sx: 0, sy: 0, depth: 0 };
    const xAxis = { x: 1.75, y: 0, z: -1.4, sx: 0, sy: 0, depth: 0 };
    const yAxis = { x: 0, y: 1.75, z: -1.4, sx: 0, sy: 0, depth: 0 };
    project(origin); project(xAxis); project(yAxis);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(177, 214, 231, 0.42)";
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(origin.sx, origin.sy); ctx.lineTo(xAxis.sx, xAxis.sy);
    ctx.moveTo(origin.sx, origin.sy); ctx.lineTo(yAxis.sx, yAxis.sy);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(212, 234, 242, 0.64)";
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.fillText("X", xAxis.sx + 7, xAxis.sy + 3);
    ctx.fillText("Y", yAxis.sx + 7, yAxis.sy + 3);
  }

  function render() {
    drawBackground();
    const bounds = calculateSurface();
    for (const node of nodes) project(node);
    drawSurface(bounds);
    drawAxes();
  }

  function frame(now) {
    const elapsed = state.lastTime ? Math.min((now - state.lastTime) / 1000, 0.05) : 0;
    state.lastTime = now;
    if (!state.paused) {
      state.time += elapsed * state.speed;
      state.yaw = (state.yaw + elapsed * 0.11) % PI2;
    }
    render();
    window.requestAnimationFrame(frame);
  }

  function updateMode() {
    state.mode = functionSelect.value;
    functionDescription.textContent = descriptions[state.mode];
    modeMetric.textContent = labels[state.mode];
  }

  function updateSpeed() {
    state.speed = Number(speedRange.value);
    speedValue.textContent = `${state.speed.toFixed(1)}×`;
  }

  function updateLight() {
    state.lightElevation = Number(lightRange.value);
    lightValue.textContent = `${state.lightElevation}°`;
  }

  function togglePause() {
    state.paused = !state.paused;
    pauseButton.setAttribute("aria-pressed", String(state.paused));
    pauseLabel.textContent = state.paused ? "Продолжить" : "Пауза";
    pauseButton.querySelector(".pause-glyph").textContent = state.paused ? "▶" : "Ⅱ";
  }

  function setup() {
    meshMetric.textContent = `${GRID} × ${GRID}`;
    functionSelect.addEventListener("change", updateMode);
    speedRange.addEventListener("input", updateSpeed);
    lightRange.addEventListener("input", updateLight);
    wireToggle.addEventListener("change", () => { state.wireframe = wireToggle.checked; });
    pauseButton.addEventListener("click", togglePause);
    window.addEventListener("resize", resize, { passive: true });
    resize();
    updateMode();
    updateSpeed();
    updateLight();
    window.requestAnimationFrame(frame);
  }

  setup();
})();
