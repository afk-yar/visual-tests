(function () {
  "use strict";

  const canvas = document.getElementById("terrain");
  const context = canvas.getContext("2d", { alpha: false });
  const buffer = document.createElement("canvas");
  const bufferContext = buffer.getContext("2d", { alpha: false });
  const controls = {
    cameraHeight: document.getElementById("cameraHeight"),
    drawDistance: document.getElementById("drawDistance"),
    horizon: document.getElementById("horizon")
  };
  const outputs = {
    cameraHeight: document.getElementById("cameraHeightValue"),
    drawDistance: document.getElementById("drawDistanceValue"),
    horizon: document.getElementById("horizonValue")
  };
  const telemetry = document.getElementById("telemetry");
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = reducedMotionQuery.matches;
  const settings = {
    cameraHeight: Number(controls.cameraHeight.value),
    drawDistance: Number(controls.drawDistance.value),
    horizon: Number(controls.horizon.value)
  };

  const MAP_SIZE = 512;
  const MAP_MASK = MAP_SIZE - 1;
  const MAP_AREA = MAP_SIZE * MAP_SIZE;
  const SEA_LEVEL = 25;
  const heightMap = new Float32Array(MAP_AREA);
  const waterMap = new Uint8Array(MAP_AREA);
  const colorMap = new Uint8Array(MAP_AREA * 3);
  const FOG = [164, 191, 183];
  const SKY_TOP = [7, 21, 34];
  const SKY_LOW = [82, 123, 124];

  let frameImage;
  let pixels;
  let hiddenY;
  let renderWidth = 0;
  let renderHeight = 0;
  let resizeQueued = false;
  let cameraX = 238;
  let cameraZ = 186;
  let cameraY = 120;
  let elapsed = 0;
  let previousTime = performance.now();
  let fpsTime = 0;
  let fpsFrames = 0;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function fade(value) {
    return value * value * (3 - 2 * value);
  }

  function hashGrid(x, z, period) {
    x = ((x % period) + period) % period;
    z = ((z % period) + period) % period;
    let value = Math.imul(x ^ 0x9e3779b9, 374761393);
    value = (value + Math.imul(z ^ 0x85ebca6b, 668265263)) | 0;
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  }

  function valueNoise(x, z, cellSize) {
    const gx = x / cellSize;
    const gz = z / cellSize;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const tx = fade(gx - x0);
    const tz = fade(gz - z0);
    const period = MAP_SIZE / cellSize;
    const a = hashGrid(x0, z0, period);
    const b = hashGrid(x0 + 1, z0, period);
    const c = hashGrid(x0, z0 + 1, period);
    const d = hashGrid(x0 + 1, z0 + 1, period);
    const ab = a + (b - a) * tx;
    const cd = c + (d - c) * tx;
    return ab + (cd - ab) * tz;
  }

  function fractalNoise(x, z) {
    return valueNoise(x, z, 128) * 0.43
      + valueNoise(x + 71, z - 39, 64) * 0.25
      + valueNoise(x - 113, z + 83, 32) * 0.15
      + valueNoise(x + 29, z + 157, 16) * 0.1
      + valueNoise(x - 181, z - 101, 8) * 0.07;
  }

  function buildWorld() {
    for (let z = 0; z < MAP_SIZE; z += 1) {
      for (let x = 0; x < MAP_SIZE; x += 1) {
        const index = z * MAP_SIZE + x;
        const base = fractalNoise(x, z);
        const ridgeNoise = fractalNoise(x + 147, z - 91);
        const ridge = 1 - Math.abs(ridgeNoise * 2 - 1);
        const mass = clamp((base - 0.24) / 0.62, 0, 1);
        let elevation = 7 + Math.pow(mass, 1.55) * 168;
        elevation += Math.pow(ridge, 5) * 27 * smoothstep(0.43, 0.7, base);

        if (elevation < SEA_LEVEL) {
          waterMap[index] = 1;
          heightMap[index] = SEA_LEVEL;
        } else {
          heightMap[index] = elevation;
        }
      }
    }

    for (let z = 0; z < MAP_SIZE; z += 1) {
      for (let x = 0; x < MAP_SIZE; x += 1) {
        const index = z * MAP_SIZE + x;
        const colorIndex = index * 3;
        const height = heightMap[index];
        const right = heightMap[z * MAP_SIZE + ((x + 1) & MAP_MASK)];
        const down = heightMap[((z + 1) & MAP_MASK) * MAP_SIZE + x];
        const slope = clamp((Math.abs(height - right) + Math.abs(height - down)) / 25, 0, 1);
        const detail = valueNoise(x + 31, z - 73, 8) - 0.5;
        let red;
        let green;
        let blue;

        if (waterMap[index]) {
          red = 24 + detail * 9;
          green = 71 + detail * 16;
          blue = 82 + detail * 18;
        } else if (height < 31) {
          red = 166;
          green = 151;
          blue = 91;
        } else if (height < 58) {
          red = 72 + detail * 20;
          green = 111 + detail * 25;
          blue = 66 + detail * 13;
        } else if (height < 96) {
          red = 69 + detail * 17;
          green = 91 + detail * 18;
          blue = 61 + detail * 12;
        } else if (height < 137) {
          red = 127 + detail * 22;
          green = 110 + detail * 19;
          blue = 79 + detail * 16;
        } else {
          red = 183 + detail * 15;
          green = 188 + detail * 14;
          blue = 171 + detail * 13;
        }

        const directionalLight = clamp((height - right) * 0.017 + (height - down) * 0.011, -0.18, 0.18);
        const light = waterMap[index] ? 1 : 1.04 - slope * 0.3 + directionalLight;
        colorMap[colorIndex] = clamp(Math.round(red * light), 0, 255);
        colorMap[colorIndex + 1] = clamp(Math.round(green * light), 0, 255);
        colorMap[colorIndex + 2] = clamp(Math.round(blue * light), 0, 255);
      }
    }
  }

  function sampleHeight(x, z) {
    return heightMap[((Math.floor(z) & MAP_MASK) * MAP_SIZE) + (Math.floor(x) & MAP_MASK)];
  }

  function pack(red, green, blue) {
    return (0xff000000 | (blue << 16) | (green << 8) | red) >>> 0;
  }

  function mixChannel(a, b, amount) {
    return Math.round(a + (b - a) * amount);
  }

  function resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.imageSmoothingEnabled = false;

    const quality = width < 700 ? 0.78 : 0.62;
    renderWidth = Math.min(920, Math.max(320, Math.floor(width * quality)));
    renderHeight = Math.max(240, Math.round(renderWidth * height / width));
    buffer.width = renderWidth;
    buffer.height = renderHeight;
    bufferContext.imageSmoothingEnabled = false;
    frameImage = bufferContext.createImageData(renderWidth, renderHeight);
    pixels = new Uint32Array(frameImage.data.buffer);
    hiddenY = new Int16Array(renderWidth);
  }

  function paintSky(horizonY) {
    const safeHorizon = clamp(horizonY, 1, renderHeight - 1);
    for (let y = 0; y < renderHeight; y += 1) {
      let red;
      let green;
      let blue;
      if (y <= safeHorizon) {
        const t = Math.pow(y / safeHorizon, 1.12);
        red = mixChannel(SKY_TOP[0], FOG[0], t);
        green = mixChannel(SKY_TOP[1], FOG[1], t);
        blue = mixChannel(SKY_TOP[2], FOG[2], t);
      } else {
        const t = smoothstep(safeHorizon, renderHeight, y);
        red = mixChannel(FOG[0], SKY_LOW[0], t);
        green = mixChannel(FOG[1], SKY_LOW[1], t);
        blue = mixChannel(FOG[2], SKY_LOW[2], t);
      }
      pixels.fill(pack(red, green, blue), y * renderWidth, (y + 1) * renderWidth);
    }

    const sunX = Math.round(renderWidth * 0.73);
    const sunY = Math.round(safeHorizon - renderHeight * 0.14);
    const radius = Math.max(16, Math.round(renderHeight * 0.095));
    const minY = Math.max(0, sunY - radius);
    const maxY = Math.min(renderHeight - 1, sunY + radius);
    const minX = Math.max(0, sunX - radius);
    const maxX = Math.min(renderWidth - 1, sunX + radius);
    for (let y = minY; y <= maxY; y += 1) {
      const dy = (y - sunY) / radius;
      for (let x = minX; x <= maxX; x += 1) {
        const dx = (x - sunX) / radius;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 1) {
          const glow = Math.pow(1 - distanceSquared, 3) * 0.72;
          const index = y * renderWidth + x;
          const base = pixels[index];
          pixels[index] = pack(
            mixChannel(base & 255, 255, glow),
            mixChannel((base >>> 8) & 255, 223, glow),
            mixChannel((base >>> 16) & 255, 151, glow)
          );
        }
      }
    }
  }

  function renderTerrain(heading, horizonY) {
    const forwardX = Math.cos(heading);
    const forwardZ = Math.sin(heading);
    const rightX = -forwardZ;
    const rightZ = forwardX;
    const projectionScale = renderHeight * 0.9;
    const bank = reducedMotion ? 0 : Math.sin(elapsed * 0.42) * 0.015;
    const farDistance = settings.drawDistance;
    const halfScreen = (renderWidth - 1) * 0.5;
    hiddenY.fill(renderHeight);
    let distance = 4;

    while (distance < farDistance) {
      const halfSpan = distance * 0.72;
      const centerX = cameraX + forwardX * distance;
      const centerZ = cameraZ + forwardZ * distance;
      let worldX = centerX - rightX * halfSpan;
      let worldZ = centerZ - rightZ * halfSpan;
      const worldStepX = rightX * (halfSpan * 2 / (renderWidth - 1));
      const worldStepZ = rightZ * (halfSpan * 2 / (renderWidth - 1));
      const fogAmount = smoothstep(0.3, 1, distance / farDistance);
      let occludedColumns = 0;

      for (let x = 0; x < renderWidth; x += 1) {
        const mapIndex = ((Math.floor(worldZ) & MAP_MASK) * MAP_SIZE) + (Math.floor(worldX) & MAP_MASK);
        const terrainHeight = heightMap[mapIndex];
        const columnHorizon = horizonY + (x - halfScreen) * bank;
        const projectedY = Math.floor(columnHorizon + (cameraY - terrainHeight) * projectionScale / distance);
        const previousTop = hiddenY[x];

        if (projectedY < previousTop) {
          const top = Math.max(0, projectedY);
          const bottom = Math.min(renderHeight, previousTop);
          if (top < bottom) {
            const colorIndex = mapIndex * 3;
            const color = pack(
              mixChannel(colorMap[colorIndex], FOG[0], fogAmount),
              mixChannel(colorMap[colorIndex + 1], FOG[1], fogAmount),
              mixChannel(colorMap[colorIndex + 2], FOG[2], fogAmount)
            );
            for (let y = top; y < bottom; y += 1) {
              pixels[y * renderWidth + x] = color;
            }
          }
          hiddenY[x] = Math.max(0, projectedY);
        }
        if (hiddenY[x] === 0) occludedColumns += 1;
        worldX += worldStepX;
        worldZ += worldStepZ;
      }

      if (occludedColumns === renderWidth) break;
      distance += Math.max(1, distance * 0.014);
    }
  }

  function render() {
    const motion = reducedMotion ? 0 : 1;
    const horizonY = renderHeight * settings.horizon / 100 + Math.sin(elapsed * 0.78) * 2.2 * motion;
    const heading = 0.56 + elapsed * 0.022 + Math.sin(elapsed * 0.09) * 0.24;
    paintSky(horizonY);
    renderTerrain(heading, horizonY);
    bufferContext.putImageData(frameImage, 0, 0);
    context.drawImage(buffer, 0, 0, canvas.width, canvas.height);
  }

  function update(dt) {
    const heading = 0.56 + elapsed * 0.022 + Math.sin(elapsed * 0.09) * 0.24;
    const speed = 34;
    cameraX = (cameraX + Math.cos(heading) * speed * dt + MAP_SIZE) % MAP_SIZE;
    cameraZ = (cameraZ + Math.sin(heading) * speed * dt + MAP_SIZE) % MAP_SIZE;
    const bob = reducedMotion ? 0 : Math.sin(elapsed * 0.83) * 2.6 + Math.sin(elapsed * 0.31) * 1.4;
    const targetHeight = sampleHeight(cameraX, cameraZ) + settings.cameraHeight + bob;
    cameraY += (targetHeight - cameraY) * (1 - Math.exp(-dt * 1.7));
  }

  function updateTelemetry(dt) {
    fpsTime += dt;
    fpsFrames += 1;
    if (fpsTime >= 0.5) {
      const fps = Math.round(fpsFrames / fpsTime);
      fpsTime = 0;
      fpsFrames = 0;
      telemetry.textContent = `${fps} FPS  ·  X ${Math.round(cameraX).toString().padStart(3, "0")}  Z ${Math.round(cameraZ).toString().padStart(3, "0")}`;
    }
  }

  function frame(now) {
    const dt = Math.min((now - previousTime) / 1000, 0.05);
    previousTime = now;
    elapsed += dt;
    update(dt);
    render();
    updateTelemetry(dt);
    requestAnimationFrame(frame);
  }

  function bindControl(name, suffix) {
    const input = controls[name];
    const output = outputs[name];
    input.addEventListener("input", function () {
      settings[name] = Number(input.value);
      output.value = `${input.value}${suffix}`;
      output.textContent = `${input.value}${suffix}`;
    });
  }

  function queueResize() {
    if (!resizeQueued) {
      resizeQueued = true;
      requestAnimationFrame(function () {
        resizeQueued = false;
        resize();
      });
    }
  }

  bindControl("cameraHeight", " м");
  bindControl("drawDistance", " м");
  bindControl("horizon", "%");
  window.addEventListener("resize", queueResize, { passive: true });
  document.addEventListener("visibilitychange", function () {
    previousTime = performance.now();
  });
  if (typeof reducedMotionQuery.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", function (event) {
      reducedMotion = event.matches;
    });
  }

  buildWorld();
  cameraY = sampleHeight(cameraX, cameraZ) + settings.cameraHeight;
  resize();
  telemetry.textContent = "КАРТА 512²  ·  МАРШРУТ АВТО";
  requestAnimationFrame(frame);
}());
