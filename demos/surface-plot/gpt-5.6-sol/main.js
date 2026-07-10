(function () {
  'use strict';

  const canvas = document.getElementById('surface');
  const ctx = canvas.getContext('2d', { alpha: false });
  const buttons = Array.from(document.querySelectorAll('.function-button'));
  const formula = document.getElementById('formula');
  const wireInput = document.getElementById('wireframe');
  const speedInput = document.getElementById('speed');
  const speedValue = document.getElementById('speedValue');
  const gridReadout = document.getElementById('gridReadout');

  const functionNames = ['ripple', 'saddle', 'gaussian'];
  const formulas = {
    ripple: 'z = sin(2.1r − 2t) · e<sup>−0.08r²</sup> / (0.7 + r)',
    saddle: 'z = 0.12 · (x² − y²)',
    gaussian: 'z = 2.9 · e<sup>−0.42r²</sup> − 0.45'
  };

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    grid: 38,
    nodes: [],
    triangles: [],
    weights: { ripple: 1, saddle: 0, gaussian: 0 },
    target: 'ripple',
    time: 0,
    orbit: -0.65,
    rotationSpeed: 0.7,
    wireframe: true,
    lastTime: performance.now()
  };

  const light = normalize3({ x: -0.42, y: 0.82, z: -0.38 });
  const colorStops = [
    [0.00, [43, 42, 132]],
    [0.27, [37, 94, 179]],
    [0.50, [34, 183, 198]],
    [0.72, [111, 224, 181]],
    [0.88, [244, 190, 104]],
    [1.00, [243, 102, 105]]
  ];

  function normalize3(v) {
    const length = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / length, y: v.y / length, z: v.z / length };
  }

  function resize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    canvas.style.width = state.width + 'px';
    canvas.style.height = state.height + 'px';
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    state.grid = state.width < 580 ? 30 : state.width < 1000 ? 34 : 38;
    gridReadout.textContent = state.grid + ' × ' + state.grid;
  }

  function sampleHeight(name, x, z, time) {
    const r2 = x * x + z * z;
    const r = Math.sqrt(r2);

    if (name === 'ripple') {
      return 2.15 * Math.sin(2.1 * r - time * 2.0) * Math.exp(-0.08 * r2) / (0.7 + r);
    }
    if (name === 'saddle') {
      return 0.12 * (x * x - z * z);
    }
    return 2.9 * Math.exp(-0.42 * r2) - 0.45;
  }

  function blendedHeight(x, z) {
    let height = 0;
    for (let i = 0; i < functionNames.length; i += 1) {
      const name = functionNames[i];
      height += state.weights[name] * sampleHeight(name, x, z, state.time);
    }
    return height;
  }

  function updateWeights(dt) {
    const response = 1 - Math.exp(-dt * 4.2);
    for (let i = 0; i < functionNames.length; i += 1) {
      const name = functionNames[i];
      const desired = name === state.target ? 1 : 0;
      state.weights[name] += (desired - state.weights[name]) * response;
    }
  }

  function project(point, cosOrbit, sinOrbit, cosPitch, sinPitch, scale, centerX, centerY) {
    const rx = point.x * cosOrbit - point.z * sinOrbit;
    const rz = point.x * sinOrbit + point.z * cosOrbit;
    const ry = point.y * cosPitch - rz * sinPitch;
    const depthOffset = point.y * sinPitch + rz * cosPitch;
    const cameraDistance = 12.8;
    const perspective = scale / (cameraDistance + depthOffset);

    return {
      x: centerX + rx * perspective,
      y: centerY - ry * perspective,
      depth: cameraDistance + depthOffset
    };
  }

  function buildGeometry() {
    const count = state.grid;
    const size = 9.6;
    const half = size / 2;
    const step = size / (count - 1);
    const rawHeights = new Float32Array(count * count);
    state.nodes.length = count * count;
    state.triangles.length = 0;

    for (let row = 0; row < count; row += 1) {
      const z = -half + row * step;
      for (let col = 0; col < count; col += 1) {
        const x = -half + col * step;
        rawHeights[row * count + col] = blendedHeight(x, z);
      }
    }

    const cosOrbit = Math.cos(state.orbit);
    const sinOrbit = Math.sin(state.orbit);
    const pitch = -0.47;
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const panelLift = state.width < 720 ? -34 : -5;
    const centerX = state.width * 0.52;
    const centerY = state.height * (state.width < 720 ? 0.47 : 0.52) + panelLift;
    const viewportScale = Math.min(state.width * 1.48, state.height * 1.72, 1250);

    for (let row = 0; row < count; row += 1) {
      const z = -half + row * step;
      for (let col = 0; col < count; col += 1) {
        const index = row * count + col;
        const x = -half + col * step;
        const left = rawHeights[row * count + Math.max(0, col - 1)];
        const right = rawHeights[row * count + Math.min(count - 1, col + 1)];
        const back = rawHeights[Math.max(0, row - 1) * count + col];
        const front = rawHeights[Math.min(count - 1, row + 1) * count + col];
        const spanX = (col === 0 || col === count - 1) ? step : step * 2;
        const spanZ = (row === 0 || row === count - 1) ? step : step * 2;
        const normal = normalize3({
          x: -(right - left) / spanX,
          y: 1,
          z: -(front - back) / spanZ
        });
        const world = { x: x, y: rawHeights[index], z: z };
        const screen = project(world, cosOrbit, sinOrbit, cosPitch, sinPitch, viewportScale, centerX, centerY);
        state.nodes[index] = { world: world, screen: screen, normal: normal };
      }
    }

    for (let row = 0; row < count - 1; row += 1) {
      for (let col = 0; col < count - 1; col += 1) {
        const a = state.nodes[row * count + col];
        const b = state.nodes[row * count + col + 1];
        const c = state.nodes[(row + 1) * count + col + 1];
        const d = state.nodes[(row + 1) * count + col];
        addTriangle(a, b, c);
        addTriangle(a, c, d);
      }
    }

    state.triangles.sort(function (one, two) { return two.depth - one.depth; });
  }

  function addTriangle(a, b, c) {
    const avgHeight = (a.world.y + b.world.y + c.world.y) / 3;
    const nx = (a.normal.x + b.normal.x + c.normal.x) / 3;
    const ny = (a.normal.y + b.normal.y + c.normal.y) / 3;
    const nz = (a.normal.z + b.normal.z + c.normal.z) / 3;
    const normal = normalize3({ x: nx, y: ny, z: nz });
    const lambert = Math.max(0, normal.x * light.x + normal.y * light.y + normal.z * light.z);
    const rim = Math.pow(1 - Math.max(0, normal.y), 2) * 0.12;
    const illumination = 0.30 + lambert * 0.75 + rim;
    const heightUnit = Math.max(0, Math.min(1, (avgHeight + 2.0) / 4.25));

    state.triangles.push({
      a: a.screen,
      b: b.screen,
      c: c.screen,
      depth: (a.screen.depth + b.screen.depth + c.screen.depth) / 3,
      fill: shadedColor(heightUnit, illumination)
    });
  }

  function shadedColor(t, illumination) {
    let lower = colorStops[0];
    let upper = colorStops[colorStops.length - 1];
    for (let i = 1; i < colorStops.length; i += 1) {
      if (t <= colorStops[i][0]) {
        lower = colorStops[i - 1];
        upper = colorStops[i];
        break;
      }
    }
    const mix = (t - lower[0]) / Math.max(0.0001, upper[0] - lower[0]);
    const rgb = [0, 1, 2].map(function (channel) {
      const base = lower[1][channel] + (upper[1][channel] - lower[1][channel]) * mix;
      return Math.round(Math.max(0, Math.min(255, base * illumination)));
    });
    return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
  }

  function drawBackground() {
    const gradient = ctx.createRadialGradient(
      state.width * 0.54, state.height * 0.43, 0,
      state.width * 0.54, state.height * 0.43, Math.max(state.width, state.height) * 0.74
    );
    gradient.addColorStop(0, '#111b31');
    gradient.addColorStop(0.42, '#0a1121');
    gradient.addColorStop(1, '#050812');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, state.width, state.height);

    const glow = ctx.createRadialGradient(
      state.width * 0.55, state.height * 0.55, 0,
      state.width * 0.55, state.height * 0.55, Math.min(state.width, state.height) * 0.55
    );
    glow.addColorStop(0, 'rgba(28, 117, 160, 0.075)');
    glow.addColorStop(1, 'rgba(7, 11, 22, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, state.width, state.height);

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#b8d4ff';
    const step = state.width < 700 ? 36 : 44;
    for (let y = 18; y < state.height; y += step) {
      for (let x = 18 + ((y / step) % 2) * 11; x < state.width; x += step) {
        ctx.fillRect(x, y, 0.7, 0.7);
      }
    }
    ctx.restore();
  }

  function drawSurface() {
    ctx.lineJoin = 'round';
    for (let i = 0; i < state.triangles.length; i += 1) {
      const tri = state.triangles[i];
      ctx.beginPath();
      ctx.moveTo(tri.a.x, tri.a.y);
      ctx.lineTo(tri.b.x, tri.b.y);
      ctx.lineTo(tri.c.x, tri.c.y);
      ctx.closePath();
      ctx.fillStyle = tri.fill;
      ctx.fill();

      if (state.wireframe) {
        ctx.strokeStyle = 'rgba(184, 240, 255, 0.105)';
        ctx.lineWidth = 0.62;
      } else {
        ctx.strokeStyle = tri.fill;
        ctx.lineWidth = 0.8;
      }
      ctx.stroke();
    }
  }

  function render(now) {
    const rawDt = (now - state.lastTime) / 1000;
    const dt = Math.min(Math.max(rawDt, 0), 0.05);
    state.lastTime = now;
    state.time += dt;
    state.orbit += dt * 0.105 * state.rotationSpeed;
    updateWeights(dt);
    drawBackground();
    buildGeometry();
    drawSurface();
    requestAnimationFrame(render);
  }

  function selectFunction(name) {
    state.target = name;
    formula.innerHTML = formulas[name];
    buttons.forEach(function (button) {
      const active = button.dataset.function === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      selectFunction(button.dataset.function);
    });
  });

  wireInput.addEventListener('change', function () {
    state.wireframe = wireInput.checked;
  });

  speedInput.addEventListener('input', function () {
    state.rotationSpeed = Number(speedInput.value);
    speedValue.value = state.rotationSpeed.toFixed(2) + '×';
  });

  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', function () {
    state.lastTime = performance.now();
  });

  resize();
  requestAnimationFrame(render);
}());
