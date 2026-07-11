(() => {
  "use strict";

  const canvas = document.getElementById("renderCanvas");
  const ctx = canvas.getContext("2d");
  const layerCanvas = document.createElement("canvas");
  const layerCtx = layerCanvas.getContext("2d");

  const faceStat = document.getElementById("faceStat");
  const fpsStat = document.getElementById("fpsStat");
  const speedRange = document.getElementById("speedRange");
  const speedValue = document.getElementById("speedValue");
  const pauseButton = document.getElementById("pauseButton");
  const pauseIcon = document.getElementById("pauseIcon");

  const state = {
    width: 0, height: 0, dpr: 1, renderMode: "fill", shading: "flat", speed: 0.42, paused: false,
    rotationX: -0.28, rotationY: 0.45, imageData: null, pixels: null, depth: null,
    lastTime: 0, fpsTime: 0, fpsFrames: 0
  };

  const geometry = buildTorus(28, 18, 1.5, 0.62);
  const lightPosition = [-3.5, -2.5, 4.2];
  const cameraZ = 5.3;

  function mat4Identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }

  function mat4Translation(x, y, z) {
    const out = mat4Identity();
    out[12] = x; out[13] = y; out[14] = z;
    return out;
  }

  function mat4RotationX(angle) {
    const c = Math.cos(angle); const s = Math.sin(angle);
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  }

  function mat4RotationY(angle) {
    const c = Math.cos(angle); const s = Math.sin(angle);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }

  function mat4Perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    return new Float32Array([
      f / aspect, 0, 0, 0, 0, f, 0, 0,
      0, 0, far / (far - near), 1, 0, 0, (-near * far) / (far - near), 0
    ]);
  }

  function transformPoint(matrix, x, y, z, w) {
    return [
      matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
      matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
      matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
      matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w
    ];
  }

  function normalize(x, y, z) {
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  function buildTorus(ringCount, sideCount, majorRadius, minorRadius) {
    const vertices = [];
    const faces = [];
    for (let ring = 0; ring < ringCount; ring += 1) {
      const u = (ring / ringCount) * Math.PI * 2;
      const cosU = Math.cos(u); const sinU = Math.sin(u);
      for (let side = 0; side < sideCount; side += 1) {
        const v = (side / sideCount) * Math.PI * 2;
        const cosV = Math.cos(v); const sinV = Math.sin(v);
        const radius = majorRadius + minorRadius * cosV;
        vertices.push({
          position: [radius * cosU, minorRadius * sinV, radius * sinU],
          normal: [cosU * cosV, sinV, sinU * cosV]
        });
      }
    }
    for (let ring = 0; ring < ringCount; ring += 1) {
      const nextRing = (ring + 1) % ringCount;
      for (let side = 0; side < sideCount; side += 1) {
        const nextSide = (side + 1) % sideCount;
        const a = ring * sideCount + side;
        const b = nextRing * sideCount + side;
        const c = nextRing * sideCount + nextSide;
        const d = ring * sideCount + nextSide;
        faces.push([a, c, b], [a, d, c]);
      }
    }
    return { vertices, faces };
  }

  function shadePoint(position, normal) {
    const lightVector = [lightPosition[0] - position[0], lightPosition[1] - position[1], lightPosition[2] - position[2]];
    const distance = Math.hypot(lightVector[0], lightVector[1], lightVector[2]) || 1;
    const lightDirection = [lightVector[0] / distance, lightVector[1] / distance, lightVector[2] / distance];
    const diffuse = Math.max(0, dot(normal, lightDirection));
    const viewDirection = normalize(-position[0], -position[1], cameraZ - position[2]);
    const halfway = normalize(lightDirection[0] + viewDirection[0], lightDirection[1] + viewDirection[1], lightDirection[2] + viewDirection[2]);
    const specular = Math.pow(Math.max(0, dot(normal, halfway)), 36);
    const attenuation = 1 / (1 + distance * 0.055 + distance * distance * 0.014);
    return Math.min(1, 0.13 + diffuse * 0.98 * attenuation + specular * 0.42);
  }

  function baseColor(faceIndex) {
    const variation = Math.sin(faceIndex * 0.37) * 8;
    return [Math.max(35, Math.round(67 + variation)), Math.min(245, Math.round(209 + variation * 0.55)), Math.min(238, Math.round(193 + variation * 0.7))];
  }

  function packColor(r, g, b) {
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }

  function edge(ax, ay, bx, by, px, py) {
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  }

  function rasterizeTriangle(a, b, c, color, intensityA, intensityB, intensityC, writeColor) {
    const area = edge(a.x, a.y, b.x, b.y, c.x, c.y);
    if (area <= 0) return;
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(state.width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(state.height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    const inverseArea = 1 / area;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5; const py = y + 0.5;
        const weightA = edge(b.x, b.y, c.x, c.y, px, py) * inverseArea;
        const weightB = edge(c.x, c.y, a.x, a.y, px, py) * inverseArea;
        const weightC = 1 - weightA - weightB;
        if (weightA < -0.0001 || weightB < -0.0001 || weightC < -0.0001) continue;
        const inverseZ = weightA * a.inverseZ + weightB * b.inverseZ + weightC * c.inverseZ;
        const index = y * state.width + x;
        if (inverseZ <= state.depth[index]) continue;
        state.depth[index] = inverseZ;
        if (writeColor) {
          const intensity = (weightA * intensityA * a.inverseZ + weightB * intensityB * b.inverseZ + weightC * intensityC * c.inverseZ) / inverseZ;
          const light = Math.max(0, Math.min(1.16, intensity));
          state.pixels[index] = packColor(Math.min(255, Math.round(color[0] * light + 4)), Math.min(255, Math.round(color[1] * light + 4)), Math.min(255, Math.round(color[2] * light + 4)));
        }
      }
    }
  }

  function rasterizeLine(a, b, color) {
    const distance = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    const steps = Math.max(1, Math.ceil(distance * 1.35));
    const wireColor = packColor(color[0], color[1], color[2]);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      if (x < 0 || x >= state.width || y < 0 || y >= state.height) continue;
      const inverseZ = a.inverseZ + (b.inverseZ - a.inverseZ) * t;
      const index = y * state.width + x;
      if (inverseZ + 0.0025 < state.depth[index]) continue;
      state.pixels[index] = wireColor;
    }
  }

  function resize() {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = Math.max(1, Math.floor(window.innerWidth * state.dpr));
    state.height = Math.max(1, Math.floor(window.innerHeight * state.dpr));
    canvas.width = state.width; canvas.height = state.height;
    layerCanvas.width = state.width; layerCanvas.height = state.height;
    state.imageData = layerCtx.createImageData(state.width, state.height);
    state.pixels = new Uint32Array(state.imageData.data.buffer);
    state.depth = new Float32Array(state.width * state.height);
    ctx.imageSmoothingEnabled = true;
  }

  function render() {
    const model = mat4Multiply(mat4RotationY(state.rotationY), mat4RotationX(state.rotationX));
    const view = mat4Translation(0, 0, cameraZ);
    const projection = mat4Perspective(Math.PI / 3.1, state.width / state.height, 0.1, 100);
    const viewModel = mat4Multiply(view, model);
    const mvp = mat4Multiply(projection, viewModel);
    const projected = [];

    for (const vertex of geometry.vertices) {
      const world = transformPoint(model, vertex.position[0], vertex.position[1], vertex.position[2], 1);
      const viewPoint = transformPoint(view, world[0], world[1], world[2], 1);
      const clip = transformPoint(mvp, vertex.position[0], vertex.position[1], vertex.position[2], 1);
      const ndcX = clip[0] / clip[3]; const ndcY = clip[1] / clip[3];
      const worldNormal = normalize(
        model[0] * vertex.normal[0] + model[4] * vertex.normal[1] + model[8] * vertex.normal[2],
        model[1] * vertex.normal[0] + model[5] * vertex.normal[1] + model[9] * vertex.normal[2],
        model[2] * vertex.normal[0] + model[6] * vertex.normal[1] + model[10] * vertex.normal[2]
      );
      projected.push({
        x: (ndcX * 0.5 + 0.5) * state.width, y: (1 - (ndcY * 0.5 + 0.5)) * state.height,
        inverseZ: 1 / Math.max(0.1, viewPoint[2]),
        world: [world[0], world[1], world[2]], normal: worldNormal,
        intensity: shadePoint([world[0], world[1], world[2]], worldNormal)
      });
    }

    state.pixels.fill(0); state.depth.fill(0);
    const visibleFaces = []; const visibleEdges = new Map();
    geometry.faces.forEach((face, faceIndex) => {
      const a = projected[face[0]]; const b = projected[face[1]]; const c = projected[face[2]];
      const area = edge(a.x, a.y, b.x, b.y, c.x, c.y);
      if (area <= 0) return;
      const ab = [b.world[0] - a.world[0], b.world[1] - a.world[1], b.world[2] - a.world[2]];
      const ac = [c.world[0] - a.world[0], c.world[1] - a.world[1], c.world[2] - a.world[2]];
      const faceNormal = normalize(...cross(ab, ac));
      const center = [(a.world[0] + b.world[0] + c.world[0]) / 3, (a.world[1] + b.world[1] + c.world[1]) / 3, (a.world[2] + b.world[2] + c.world[2]) / 3];
      const flatIntensity = shadePoint(center, faceNormal);
      visibleFaces.push({ a, b, c, flatIntensity, faceIndex });
      const edges = [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]];
      for (const pair of edges) {
        const key = pair[0] < pair[1] ? `${pair[0]}-${pair[1]}` : `${pair[1]}-${pair[0]}`;
        if (!visibleEdges.has(key)) visibleEdges.set(key, [projected[pair[0]], projected[pair[1]]]);
      }
    });

    for (const face of visibleFaces) {
      const intensity = state.shading === "smooth" ? [face.a.intensity, face.b.intensity, face.c.intensity] : [face.flatIntensity, face.flatIntensity, face.flatIntensity];
      rasterizeTriangle(face.a, face.b, face.c, baseColor(face.faceIndex), intensity[0], intensity[1], intensity[2], state.renderMode === "fill");
    }
    if (state.renderMode === "wire") {
      for (const pair of visibleEdges.values()) rasterizeLine(pair[0], pair[1], [110, 239, 211]);
    }

    layerCtx.putImageData(state.imageData, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);
    const glow = ctx.createRadialGradient(state.width * 0.5, state.height * 0.47, 0, state.width * 0.5, state.height * 0.47, Math.min(state.width, state.height) * 0.38);
    glow.addColorStop(0, "rgba(74, 207, 185, 0.095)");
    glow.addColorStop(0.55, "rgba(25, 107, 111, 0.025)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, state.width, state.height);
    ctx.drawImage(layerCanvas, 0, 0);
    faceStat.textContent = `${visibleFaces.length} / ${geometry.faces.length}`;
  }

  function loop(now) {
    if (!state.lastTime) state.lastTime = now;
    const dt = Math.min(0.05, Math.max(0, (now - state.lastTime) / 1000));
    state.lastTime = now;
    if (!state.paused) {
      state.rotationY += dt * state.speed * 0.82;
      state.rotationX += dt * state.speed * 0.34;
    }
    render();
    state.fpsFrames += 1;
    if (now - state.fpsTime > 500) {
      const fps = Math.round((state.fpsFrames * 1000) / Math.max(1, now - state.fpsTime));
      state.fpsFrames = 0; state.fpsTime = now; fpsStat.textContent = String(fps).padStart(2, "0");
    }
    window.requestAnimationFrame(loop);
  }

  function setSegment(group, value) {
    const key = group === "render-mode" ? "renderMode" : group;
    document.querySelectorAll(`[data-${group}]`).forEach((button) => {
      const active = button.dataset[key] === value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  document.querySelectorAll("[data-render-mode]").forEach((button) => {
    button.addEventListener("click", () => { state.renderMode = button.dataset.renderMode; setSegment("render-mode", state.renderMode); });
  });
  document.querySelectorAll("[data-shading]").forEach((button) => {
    button.addEventListener("click", () => { state.shading = button.dataset.shading; setSegment("shading", state.shading); });
  });
  speedRange.addEventListener("input", () => {
    state.speed = Number(speedRange.value); speedValue.textContent = `${state.speed.toFixed(2)}×`;
  });
  pauseButton.addEventListener("click", () => {
    state.paused = !state.paused;
    pauseButton.classList.toggle("is-paused", state.paused);
    pauseButton.setAttribute("aria-pressed", String(state.paused));
    pauseButton.setAttribute("aria-label", state.paused ? "Продолжить вращение" : "Поставить вращение на паузу");
    pauseIcon.textContent = state.paused ? "▶" : "Ⅱ";
  });

  window.addEventListener("resize", resize, { passive: true });
  resize(); speedValue.textContent = `${state.speed.toFixed(2)}×`;
  requestAnimationFrame(loop);
})();
