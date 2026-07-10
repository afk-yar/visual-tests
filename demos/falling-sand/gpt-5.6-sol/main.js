(function () {
  "use strict";

  const EMPTY = 0;
  const SAND = 1;
  const WATER = 2;
  const STONE = 3;
  const WOOD = 4;
  const FIRE = 5;
  const SMOKE = 6;

  const MATERIALS = { sand: SAND, water: WATER, stone: STONE, wood: WOOD, fire: FIRE, smoke: SMOKE };
  const CELL_SIZE = 5;
  const STEP = 1 / 60;
  const MAX_DT = 0.05;
  const MAX_STEPS = 4;

  const canvas = document.getElementById("world");
  const context = canvas.getContext("2d", { alpha: true });
  const buffer = document.createElement("canvas");
  const bufferContext = buffer.getContext("2d", { alpha: true });
  const materialButtons = Array.from(document.querySelectorAll(".material"));
  const brushInput = document.getElementById("brushSize");
  const brushValue = document.getElementById("brushValue");
  const pauseButton = document.getElementById("pauseButton");
  const clearButton = document.getElementById("clearButton");
  const simState = document.getElementById("simState");

  let width = 0;
  let height = 0;
  let cssWidth = 0;
  let cssHeight = 0;
  let cells = new Uint8Array(0);
  let life = new Uint8Array(0);
  let updated = new Uint8Array(0);
  let pixels = null;
  let selected = SAND;
  let brushPixels = Number(brushInput.value);
  let paused = false;
  let sweepRight = false;
  let drawing = false;
  let previousPoint = null;
  let accumulator = 0;
  let lastTime = performance.now();
  let randomState = (Date.now() ^ 0x9e3779b9) >>> 0;
  let initialised = false;

  function random() {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 4294967296;
  }

  function indexOf(x, y) {
    return x + y * width;
  }

  function inBounds(x, y) {
    return x >= 0 && x < width && y >= 0 && y < height;
  }

  function freshLife(type) {
    if (type === FIRE) return 24 + Math.floor(random() * 38);
    if (type === SMOKE) return 100 + Math.floor(random() * 145);
    return 0;
  }

  function setCell(x, y, type) {
    if (!inBounds(x, y)) return;
    const i = indexOf(x, y);
    cells[i] = type;
    life[i] = freshLife(type);
  }

  function resize() {
    cssWidth = Math.max(1, window.innerWidth);
    cssHeight = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.imageSmoothingEnabled = false;

    const nextWidth = Math.max(1, Math.ceil(cssWidth / CELL_SIZE));
    const nextHeight = Math.max(1, Math.ceil(cssHeight / CELL_SIZE));
    const nextCells = new Uint8Array(nextWidth * nextHeight);
    const nextLife = new Uint8Array(nextWidth * nextHeight);

    if (width && height) {
      const copyWidth = Math.min(width, nextWidth);
      const copyHeight = Math.min(height, nextHeight);
      const oldX = Math.floor((width - copyWidth) / 2);
      const newX = Math.floor((nextWidth - copyWidth) / 2);
      const oldY = height - copyHeight;
      const newY = nextHeight - copyHeight;

      for (let y = 0; y < copyHeight; y += 1) {
        const oldStart = oldX + (oldY + y) * width;
        const newStart = newX + (newY + y) * nextWidth;
        nextCells.set(cells.subarray(oldStart, oldStart + copyWidth), newStart);
        nextLife.set(life.subarray(oldStart, oldStart + copyWidth), newStart);
      }
    }

    width = nextWidth;
    height = nextHeight;
    cells = nextCells;
    life = nextLife;
    updated = new Uint8Array(width * height);
    buffer.width = width;
    buffer.height = height;
    pixels = bufferContext.createImageData(width, height);

    if (!initialised) {
      createOpeningScene();
      initialised = true;
    }
  }

  function createOpeningScene() {
    const floorTop = Math.max(0, height - 4);
    for (let y = floorTop; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) setCell(x, y, STONE);
    }

    const basinLeft = Math.floor(width * 0.67);
    const basinRight = Math.min(width - 3, Math.floor(width * 0.91));
    const basinBottom = height - 5;
    const basinTop = Math.max(4, basinBottom - Math.min(20, Math.floor(height * 0.18)));
    for (let y = basinTop; y <= basinBottom; y += 1) {
      setCell(basinLeft, y, STONE);
      setCell(basinRight, y, STONE);
    }
    for (let x = basinLeft; x <= basinRight; x += 1) setCell(x, basinBottom, STONE);
    for (let y = basinTop + 5; y < basinBottom; y += 1) {
      for (let x = basinLeft + 1; x < basinRight; x += 1) setCell(x, y, WATER);
    }

    const sandCenter = Math.floor(width * 0.49);
    const sandBase = height - 5;
    const pileHeight = Math.min(18, Math.floor(height * 0.16));
    for (let row = 0; row < pileHeight; row += 1) {
      const half = pileHeight - row;
      for (let x = sandCenter - half; x <= sandCenter + half; x += 1) {
        if (inBounds(x, sandBase - row)) setCell(x, sandBase - row, SAND);
      }
    }

    const woodX = Math.floor(width * 0.25);
    const woodBase = height - 5;
    for (let x = woodX - 10; x <= woodX + 10; x += 1) {
      setCell(x, woodBase - 1, WOOD);
      if (Math.abs(x - woodX) < 7) setCell(x, woodBase - 2, WOOD);
    }
    for (let y = woodBase - 8; y < woodBase - 2; y += 1) {
      setCell(woodX - 7, y, WOOD);
      setCell(woodX + 7, y, WOOD);
    }
    setCell(woodX - 1, woodBase - 3, FIRE);
    setCell(woodX, woodBase - 3, FIRE);
    setCell(woodX + 1, woodBase - 3, FIRE);
  }

  function moveCell(from, to) {
    cells[to] = cells[from];
    life[to] = life[from];
    cells[from] = EMPTY;
    life[from] = 0;
    updated[from] = 1;
    updated[to] = 1;
  }

  function swapCells(a, b) {
    const type = cells[a];
    const age = life[a];
    cells[a] = cells[b];
    life[a] = life[b];
    cells[b] = type;
    life[b] = age;
    updated[a] = 1;
    updated[b] = 1;
  }

  function canSandEnter(type) {
    return type === EMPTY || type === WATER || type === SMOKE;
  }

  function trySand(x, y, i) {
    if (y + 1 >= height) return;
    const below = indexOf(x, y + 1);
    if (canSandEnter(cells[below])) {
      if (cells[below] === WATER) swapCells(i, below);
      else moveCell(i, below);
      return;
    }

    const first = random() < 0.5 ? -1 : 1;
    for (let n = 0; n < 2; n += 1) {
      const dx = n === 0 ? first : -first;
      const nx = x + dx;
      if (!inBounds(nx, y + 1)) continue;
      const destination = indexOf(nx, y + 1);
      if (canSandEnter(cells[destination])) {
        if (cells[destination] === WATER) swapCells(i, destination);
        else moveCell(i, destination);
        return;
      }
    }
  }

  function tryWater(x, y, i) {
    if (y + 1 < height) {
      const below = indexOf(x, y + 1);
      if (cells[below] === EMPTY || cells[below] === SMOKE) {
        moveCell(i, below);
        return;
      }
    }

    const first = random() < 0.5 ? -1 : 1;
    if (y + 1 < height) {
      for (let n = 0; n < 2; n += 1) {
        const dx = n === 0 ? first : -first;
        const nx = x + dx;
        if (!inBounds(nx, y + 1)) continue;
        const destination = indexOf(nx, y + 1);
        if (cells[destination] === EMPTY || cells[destination] === SMOKE) {
          moveCell(i, destination);
          return;
        }
      }
    }

    for (let n = 0; n < 2; n += 1) {
      const dx = n === 0 ? first : -first;
      const nx = x + dx;
      if (!inBounds(nx, y)) continue;
      const destination = indexOf(nx, y);
      if (cells[destination] === EMPTY || cells[destination] === SMOKE) {
        moveCell(i, destination);
        return;
      }
    }
  }

  function trySmoke(x, y, i) {
    if (life[i] > 0) life[i] -= 1;
    if (life[i] === 0 || random() < 0.0018) {
      cells[i] = EMPTY;
      updated[i] = 1;
      return;
    }

    if (y > 0) {
      const above = indexOf(x, y - 1);
      if (cells[above] === EMPTY) {
        moveCell(i, above);
        return;
      }
    }

    const first = random() < 0.5 ? -1 : 1;
    if (y > 0) {
      for (let n = 0; n < 2; n += 1) {
        const dx = n === 0 ? first : -first;
        const nx = x + dx;
        if (!inBounds(nx, y - 1)) continue;
        const destination = indexOf(nx, y - 1);
        if (cells[destination] === EMPTY) {
          moveCell(i, destination);
          return;
        }
      }
    }

    for (let n = 0; n < 2; n += 1) {
      const dx = n === 0 ? first : -first;
      const nx = x + dx;
      if (!inBounds(nx, y)) continue;
      const destination = indexOf(nx, y);
      if (cells[destination] === EMPTY) {
        moveCell(i, destination);
        return;
      }
    }
  }

  function tryFire(x, y, i) {
    const neighbors = [];
    let touchesWater = false;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const neighbor = indexOf(nx, ny);
        if (cells[neighbor] === WOOD) neighbors.push(neighbor);
        if (cells[neighbor] === WATER) touchesWater = true;
      }
    }

    for (let n = 0; n < neighbors.length; n += 1) {
      if (random() < 0.085) {
        const target = neighbors[n];
        cells[target] = FIRE;
        life[target] = freshLife(FIRE);
        updated[target] = 1;
      }
    }

    life[i] = life[i] > (touchesWater ? 4 : 1) ? life[i] - (touchesWater ? 4 : 1) : 0;
    if (life[i] === 0) {
      cells[i] = SMOKE;
      life[i] = freshLife(SMOKE);
    }
    updated[i] = 1;
  }

  function simulate() {
    updated.fill(0);
    sweepRight = !sweepRight;

    for (let y = height - 1; y >= 0; y -= 1) {
      for (let column = 0; column < width; column += 1) {
        const x = sweepRight ? column : width - 1 - column;
        const i = indexOf(x, y);
        if (updated[i]) continue;

        const type = cells[i];
        if (type === SAND) trySand(x, y, i);
        else if (type === WATER) tryWater(x, y, i);
        else if (type === FIRE) tryFire(x, y, i);
        else if (type === SMOKE) trySmoke(x, y, i);
      }
    }
  }

  function colorCell(type, age, hash) {
    const variation = (hash % 17) - 8;
    if (type === SAND) return [226 + variation, 177 + variation, 73 + Math.floor(variation / 2), 255];
    if (type === WATER) return [49, 132 + variation, 190 + variation, 224];
    if (type === STONE) return [109 + variation, 119 + variation, 117 + variation, 255];
    if (type === WOOD) return [133 + variation, 74 + Math.floor(variation / 2), 39, 255];
    if (type === FIRE) {
      if ((hash + age) % 4 === 0) return [255, 214, 83, 255];
      return [255, 100 + (hash % 45), 43, 255];
    }
    if (type === SMOKE) {
      const shade = 126 + (hash % 30);
      return [shade, shade + 6, shade + 4, Math.min(190, 52 + age)];
    }
    return [0, 0, 0, 0];
  }

  function render() {
    const data = pixels.data;
    for (let i = 0; i < cells.length; i += 1) {
      const color = colorCell(cells[i], life[i], (i * 1103515245) >>> 16);
      const p = i * 4;
      data[p] = color[0];
      data[p + 1] = color[1];
      data[p + 2] = color[2];
      data[p + 3] = color[3];
    }
    bufferContext.putImageData(pixels, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.drawImage(buffer, 0, 0, cssWidth, cssHeight);
  }

  function paintCircle(gridX, gridY) {
    const radius = Math.max(1, brushPixels / CELL_SIZE / 2);
    const radiusSquared = radius * radius;
    const minX = Math.floor(gridX - radius);
    const maxX = Math.ceil(gridX + radius);
    const minY = Math.floor(gridY - radius);
    const maxY = Math.ceil(gridY + radius);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - gridX;
        const dy = y - gridY;
        if (dx * dx + dy * dy <= radiusSquared) setCell(x, y, selected);
      }
    }
  }

  function pointerToGrid(event) {
    return {
      x: event.clientX / cssWidth * width,
      y: event.clientY / cssHeight * height
    };
  }

  function paintLine(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const spacing = Math.max(0.75, brushPixels / CELL_SIZE * 0.22);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let step = 0; step <= steps; step += 1) {
      const amount = step / steps;
      paintCircle(from.x + dx * amount, from.y + dy * amount);
    }
  }

  function selectMaterial(type) {
    selected = type;
    materialButtons.forEach(function (button) {
      const active = MATERIALS[button.dataset.material] === type;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateBrush(value) {
    brushPixels = Math.max(6, Math.min(72, Number(value)));
    brushInput.value = String(brushPixels);
    brushValue.value = brushPixels + " px";
    brushValue.textContent = brushPixels + " px";
  }

  function setPaused(value) {
    paused = value;
    pauseButton.classList.toggle("is-active", paused);
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.querySelector("span:nth-child(2)").textContent = paused ? "Продолжить" : "Пауза";
    simState.classList.toggle("is-paused", paused);
    simState.querySelector("span").textContent = paused ? "На паузе" : "В движении";
    accumulator = 0;
  }

  function clearWorld() {
    cells.fill(EMPTY);
    life.fill(0);
  }

  canvas.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    drawing = true;
    previousPoint = pointerToGrid(event);
    paintCircle(previousPoint.x, previousPoint.y);
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", function (event) {
    if (!drawing) return;
    const point = pointerToGrid(event);
    paintLine(previousPoint, point);
    previousPoint = point;
  });

  function endDrawing(event) {
    drawing = false;
    previousPoint = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  canvas.addEventListener("pointerup", endDrawing);
  canvas.addEventListener("pointercancel", endDrawing);

  materialButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      selectMaterial(MATERIALS[button.dataset.material]);
    });
  });

  brushInput.addEventListener("input", function () { updateBrush(brushInput.value); });
  pauseButton.addEventListener("click", function () { setPaused(!paused); });
  clearButton.addEventListener("click", clearWorld);

  window.addEventListener("keydown", function (event) {
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "BUTTON")) return;
    const number = Number(event.key);
    if (number >= 1 && number <= 6) selectMaterial(number);
    else if (event.code === "Space") {
      event.preventDefault();
      setPaused(!paused);
    } else if (event.key.toLowerCase() === "c") clearWorld();
    else if (event.key === "[") updateBrush(brushPixels - 2);
    else if (event.key === "]") updateBrush(brushPixels + 2);
  });

  window.addEventListener("resize", resize);

  function frame(time) {
    const dt = Math.min(MAX_DT, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;

    if (!paused) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= STEP && steps < MAX_STEPS) {
        simulate();
        accumulator -= STEP;
        steps += 1;
      }
      if (steps === MAX_STEPS) accumulator = 0;
    }

    render();
    requestAnimationFrame(frame);
  }

  resize();
  updateBrush(brushPixels);
  requestAnimationFrame(frame);
}());
