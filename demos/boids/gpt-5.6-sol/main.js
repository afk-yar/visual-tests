(function () {
  "use strict";

  const canvas = document.getElementById("world");
  const ctx = canvas.getContext("2d", { alpha: false });
  const BOID_COUNT = 520;
  const TAU = Math.PI * 2;

  const x = new Float32Array(BOID_COUNT);
  const y = new Float32Array(BOID_COUNT);
  const vx = new Float32Array(BOID_COUNT);
  const vy = new Float32Array(BOID_COUNT);
  const nextVX = new Float32Array(BOID_COUNT);
  const nextVY = new Float32Array(BOID_COUNT);
  const visible = new Uint8Array(BOID_COUNT);

  const controls = {
    separation: document.getElementById("separation"),
    alignment: document.getElementById("alignment"),
    cohesion: document.getElementById("cohesion"),
    perception: document.getElementById("perception"),
    maxSpeed: document.getElementById("maxSpeed")
  };

  const outputs = {
    separation: document.getElementById("separationValue"),
    alignment: document.getElementById("alignmentValue"),
    cohesion: document.getElementById("cohesionValue"),
    perception: document.getElementById("perceptionValue"),
    maxSpeed: document.getElementById("maxSpeedValue")
  };

  const fpsElement = document.getElementById("fps");
  const neighborElement = document.getElementById("neighborCount");
  const pauseButton = document.getElementById("pauseButton");

  let width = 1;
  let height = 1;
  let dpr = 1;
  let background = "#06100d";
  let selected = 0;
  let neighborCount = 0;
  let paused = false;
  let resizePending = true;
  let initialized = false;
  let lastTime = performance.now();
  let fpsClock = lastTime;
  let frameCounter = 0;

  let gridCols = 0;
  let gridRows = 0;
  let cellWidth = 1;
  let cellHeight = 1;
  let buckets = [];
  let visitedCells = new Int32Array(0);
  let visitStamp = 1;
  let steerResultX = 0;
  let steerResultY = 0;

  const parameters = {
    separation: 1.55,
    alignment: 1,
    cohesion: 0.8,
    perception: 88,
    maxSpeed: 96
  };

  function randomizeBoids() {
    for (let i = 0; i < BOID_COUNT; i += 1) {
      const angle = Math.random() * TAU;
      const speed = parameters.maxSpeed * (0.48 + Math.random() * 0.42);
      x[i] = Math.random() * width;
      y[i] = Math.random() * height;
      vx[i] = Math.cos(angle) * speed;
      vy[i] = Math.sin(angle) * speed;
    }
  }

  function resizeCanvas() {
    const oldWidth = width;
    const oldHeight = height;
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const gradient = ctx.createRadialGradient(
      width * 0.55,
      height * 0.45,
      0,
      width * 0.55,
      height * 0.45,
      Math.max(width, height) * 0.8
    );
    gradient.addColorStop(0, "#10231b");
    gradient.addColorStop(0.52, "#091712");
    gradient.addColorStop(1, "#050c0a");
    background = gradient;

    if (!initialized) {
      randomizeBoids();
      initialized = true;
    } else {
      const scaleX = width / oldWidth;
      const scaleY = height / oldHeight;
      for (let i = 0; i < BOID_COUNT; i += 1) {
        x[i] *= scaleX;
        y[i] *= scaleY;
      }
    }

    gridCols = 0;
    gridRows = 0;
    resizePending = false;
  }

  function ensureGrid() {
    const radius = parameters.perception;
    const cols = Math.max(1, Math.floor(width / radius));
    const rows = Math.max(1, Math.floor(height / radius));

    if (cols !== gridCols || rows !== gridRows) {
      gridCols = cols;
      gridRows = rows;
      buckets = Array.from({ length: cols * rows }, function () { return []; });
      visitedCells = new Int32Array(cols * rows);
      visitStamp = 1;
    }

    cellWidth = width / gridCols;
    cellHeight = height / gridRows;
    for (let i = 0; i < buckets.length; i += 1) {
      buckets[i].length = 0;
    }

    for (let i = 0; i < BOID_COUNT; i += 1) {
      const column = Math.min(gridCols - 1, Math.floor(x[i] / cellWidth));
      const row = Math.min(gridRows - 1, Math.floor(y[i] / cellHeight));
      buckets[row * gridCols + column].push(i);
    }
  }

  function wrappedDelta(delta, size) {
    if (delta > size * 0.5) return delta - size;
    if (delta < -size * 0.5) return delta + size;
    return delta;
  }

  function calculateSteer(targetX, targetY, currentX, currentY, maxSpeed, maxForce) {
    const magnitude = Math.hypot(targetX, targetY);
    if (magnitude < 0.0001) {
      steerResultX = 0;
      steerResultY = 0;
      return;
    }

    steerResultX = targetX / magnitude * maxSpeed - currentX;
    steerResultY = targetY / magnitude * maxSpeed - currentY;
    const steerMagnitude = Math.hypot(steerResultX, steerResultY);
    if (steerMagnitude > maxForce) {
      steerResultX = steerResultX / steerMagnitude * maxForce;
      steerResultY = steerResultY / steerMagnitude * maxForce;
    }
  }

  function update(dt) {
    ensureGrid();

    const radius = parameters.perception;
    const radiusSquared = radius * radius;
    const separationRadiusSquared = Math.pow(Math.min(42, radius * 0.44), 2);
    const maxSpeed = parameters.maxSpeed;
    const maxForce = 36;
    const maxAcceleration = 92;

    for (let i = 0; i < BOID_COUNT; i += 1) {
      const column = Math.min(gridCols - 1, Math.floor(x[i] / cellWidth));
      const row = Math.min(gridRows - 1, Math.floor(y[i] / cellHeight));
      let separationX = 0;
      let separationY = 0;
      let alignmentX = 0;
      let alignmentY = 0;
      let cohesionX = 0;
      let cohesionY = 0;
      let separationCount = 0;
      let flockCount = 0;

      const stamp = visitStamp;
      visitStamp += 1;
      if (visitStamp >= 2147483647) {
        visitedCells.fill(0);
        visitStamp = 1;
      }

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const gridY = (row + offsetY + gridRows) % gridRows;
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const gridX = (column + offsetX + gridCols) % gridCols;
          const cellIndex = gridY * gridCols + gridX;
          if (visitedCells[cellIndex] === stamp) continue;
          visitedCells[cellIndex] = stamp;

          const bucket = buckets[cellIndex];
          for (let b = 0; b < bucket.length; b += 1) {
            const other = bucket[b];
            if (other === i) continue;

            const dx = wrappedDelta(x[other] - x[i], width);
            const dy = wrappedDelta(y[other] - y[i], height);
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared <= 0 || distanceSquared > radiusSquared) continue;

            alignmentX += vx[other];
            alignmentY += vy[other];
            cohesionX += dx;
            cohesionY += dy;
            flockCount += 1;

            if (distanceSquared < separationRadiusSquared) {
              const inverse = 1 / Math.max(distanceSquared, 9);
              separationX -= dx * inverse;
              separationY -= dy * inverse;
              separationCount += 1;
            }
          }
        }
      }

      let accelerationX = 0;
      let accelerationY = 0;

      if (separationCount > 0) {
        calculateSteer(separationX, separationY, vx[i], vy[i], maxSpeed, maxForce);
        accelerationX += steerResultX * parameters.separation;
        accelerationY += steerResultY * parameters.separation;
      }

      if (flockCount > 0) {
        calculateSteer(
          alignmentX / flockCount,
          alignmentY / flockCount,
          vx[i],
          vy[i],
          maxSpeed,
          maxForce
        );
        accelerationX += steerResultX * parameters.alignment;
        accelerationY += steerResultY * parameters.alignment;

        calculateSteer(
          cohesionX / flockCount,
          cohesionY / flockCount,
          vx[i],
          vy[i],
          maxSpeed,
          maxForce
        );
        accelerationX += steerResultX * parameters.cohesion;
        accelerationY += steerResultY * parameters.cohesion;
      }

      const accelerationMagnitude = Math.hypot(accelerationX, accelerationY);
      if (accelerationMagnitude > maxAcceleration) {
        accelerationX = accelerationX / accelerationMagnitude * maxAcceleration;
        accelerationY = accelerationY / accelerationMagnitude * maxAcceleration;
      }

      let updatedVX = vx[i] + accelerationX * dt;
      let updatedVY = vy[i] + accelerationY * dt;
      const speed = Math.hypot(updatedVX, updatedVY);
      const minimumSpeed = maxSpeed * 0.24;

      if (speed > maxSpeed) {
        updatedVX = updatedVX / speed * maxSpeed;
        updatedVY = updatedVY / speed * maxSpeed;
      } else if (speed < minimumSpeed && speed > 0.0001) {
        updatedVX = updatedVX / speed * minimumSpeed;
        updatedVY = updatedVY / speed * minimumSpeed;
      }

      nextVX[i] = updatedVX;
      nextVY[i] = updatedVY;
    }

    for (let i = 0; i < BOID_COUNT; i += 1) {
      vx[i] = nextVX[i];
      vy[i] = nextVY[i];
      x[i] = (x[i] + vx[i] * dt + width) % width;
      y[i] = (y[i] + vy[i] * dt + height) % height;
    }
  }

  function findVisibleNeighbors() {
    visible.fill(0);
    neighborCount = 0;
    const radiusSquared = parameters.perception * parameters.perception;

    for (let i = 0; i < BOID_COUNT; i += 1) {
      if (i === selected) continue;
      const dx = wrappedDelta(x[i] - x[selected], width);
      const dy = wrappedDelta(y[i] - y[selected], height);
      if (dx * dx + dy * dy <= radiusSquared) {
        visible[i] = 1;
        neighborCount += 1;
      }
    }
  }

  function traceBoid(index, size) {
    const speed = Math.hypot(vx[index], vy[index]) || 1;
    const directionX = vx[index] / speed;
    const directionY = vy[index] / speed;
    const normalX = -directionY;
    const normalY = directionX;
    const px = x[index];
    const py = y[index];

    ctx.moveTo(px + directionX * size, py + directionY * size);
    ctx.lineTo(
      px - directionX * size * 0.72 + normalX * size * 0.48,
      py - directionY * size * 0.72 + normalY * size * 0.48
    );
    ctx.lineTo(px - directionX * size * 0.32, py - directionY * size * 0.32);
    ctx.lineTo(
      px - directionX * size * 0.72 - normalX * size * 0.48,
      py - directionY * size * 0.72 - normalY * size * 0.48
    );
    ctx.closePath();
  }

  function drawToroidalCircle() {
    const radius = parameters.perception;
    ctx.beginPath();
    for (let offsetX = -width; offsetX <= width; offsetX += width) {
      for (let offsetY = -height; offsetY <= height; offsetY += height) {
        const centerX = x[selected] + offsetX;
        const centerY = y[selected] + offsetY;
        if (centerX < -radius || centerX > width + radius || centerY < -radius || centerY > height + radius) continue;
        ctx.moveTo(centerX + radius, centerY);
        ctx.arc(centerX, centerY, radius, 0, TAU);
      }
    }
    ctx.fillStyle = "rgba(215, 255, 87, 0.035)";
    ctx.fill();
    ctx.setLineDash([4, 7]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(215, 255, 87, 0.38)";
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawNeighborLinks() {
    ctx.beginPath();
    for (let i = 0; i < BOID_COUNT; i += 1) {
      if (!visible[i]) continue;
      const dx = wrappedDelta(x[i] - x[selected], width);
      const dy = wrappedDelta(y[i] - y[selected], height);
      for (let offsetX = -width; offsetX <= width; offsetX += width) {
        for (let offsetY = -height; offsetY <= height; offsetY += height) {
          const startX = x[selected] + offsetX;
          const startY = y[selected] + offsetY;
          ctx.moveTo(startX, startY);
          ctx.lineTo(startX + dx, startY + dy);
        }
      }
    }
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = "rgba(85, 230, 211, 0.16)";
    ctx.stroke();
  }

  function render() {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    drawToroidalCircle();
    drawNeighborLinks();

    ctx.beginPath();
    for (let i = 0; i < BOID_COUNT; i += 1) {
      if (i !== selected && !visible[i]) traceBoid(i, 5.4);
    }
    ctx.fillStyle = "rgba(186, 216, 201, 0.66)";
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < BOID_COUNT; i += 1) {
      if (visible[i]) traceBoid(i, 6.2);
    }
    ctx.fillStyle = "rgba(85, 230, 211, 0.98)";
    ctx.shadowColor = "rgba(85, 230, 211, 0.7)";
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    traceBoid(selected, 9.5);
    ctx.fillStyle = "#d7ff57";
    ctx.shadowColor = "rgba(215, 255, 87, 0.9)";
    ctx.shadowBlur = 15;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(x[selected], y[selected], 13, 0, TAU);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(215, 255, 87, 0.62)";
    ctx.stroke();
  }

  function updateRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const percent = (Number(input.value) - min) / (max - min) * 100;
    input.style.setProperty("--fill", percent + "%");
  }

  function syncControl(name) {
    const input = controls[name];
    const value = Number(input.value);
    parameters[name] = value;
    updateRangeFill(input);

    if (name === "perception") {
      outputs[name].value = Math.round(value) + " px";
    } else if (name === "maxSpeed") {
      outputs[name].value = Math.round(value) + " px/с";
    } else {
      outputs[name].value = value.toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
  }

  function setPaused(value) {
    paused = value;
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.textContent = paused ? "Продолжить" : "Пауза";
    lastTime = performance.now();
  }

  Object.keys(controls).forEach(function (name) {
    controls[name].addEventListener("input", function () { syncControl(name); });
    syncControl(name);
  });

  pauseButton.addEventListener("click", function () { setPaused(!paused); });

  window.addEventListener("keydown", function (event) {
    if (event.code === "Space" && event.target.tagName !== "INPUT" && event.target.tagName !== "BUTTON") {
      event.preventDefault();
      setPaused(!paused);
    }
  });

  canvas.addEventListener("pointerdown", function (event) {
    const clickX = event.clientX;
    const clickY = event.clientY;
    let closest = selected;
    let closestDistance = Infinity;

    for (let i = 0; i < BOID_COUNT; i += 1) {
      const dx = x[i] - clickX;
      const dy = y[i] - clickY;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < closestDistance) {
        closestDistance = distanceSquared;
        closest = i;
      }
    }
    selected = closest;
    findVisibleNeighbors();
    neighborElement.textContent = String(neighborCount);
  });

  window.addEventListener("resize", function () { resizePending = true; }, { passive: true });

  function frame(now) {
    if (resizePending) resizeCanvas();
    const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.05);
    lastTime = now;

    if (!paused) update(dt);
    findVisibleNeighbors();
    render();

    frameCounter += 1;
    if (now - fpsClock >= 500) {
      const measuredFps = Math.round(frameCounter * 1000 / (now - fpsClock));
      fpsElement.textContent = String(measuredFps);
      neighborElement.textContent = String(neighborCount);
      frameCounter = 0;
      fpsClock = now;
    }

    requestAnimationFrame(frame);
  }

  resizeCanvas();
  requestAnimationFrame(frame);
}());
