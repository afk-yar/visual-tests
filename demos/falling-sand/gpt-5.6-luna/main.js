(function () {
  'use strict';

  const canvas = document.getElementById('sandbox');
  const ctx = canvas.getContext('2d');
  const selectedName = document.getElementById('selectedName');
  const particleCount = document.getElementById('particleCount');
  const brushSize = document.getElementById('brushSize');
  const brushValue = document.getElementById('brushValue');
  const pauseButton = document.getElementById('pauseButton');
  const pauseLabel = document.getElementById('pauseLabel');
  const pauseIcon = document.getElementById('pauseIcon');
  const clearButton = document.getElementById('clearButton');
  const materialButtons = Array.from(document.querySelectorAll('.material'));

  const EMPTY = 0, SAND = 1, WATER = 2, STONE = 3, WOOD = 4, FIRE = 5, SMOKE = 6;
  const CELL_SIZE = 5;
  const STEP = 1 / 60;
  const names = { sand: 'Песок', water: 'Вода', stone: 'Камень', wood: 'Дерево', fire: 'Огонь', smoke: 'Дым' };
  const values = { sand: SAND, water: WATER, stone: STONE, wood: WOOD, fire: FIRE, smoke: SMOKE };
  const palette = { [SAND]: '#e8bd67', [WATER]: '#459bdc', [STONE]: '#78859b', [WOOD]: '#a96742', [FIRE]: '#f36f49', [SMOKE]: '#7f8aa0' };

  let dpr = 1, viewWidth = 0, viewHeight = 0, cols = 0, rows = 0;
  let cells = new Uint8Array(0), ages = new Uint16Array(0), updated = new Uint32Array(0);
  let tick = 0, selected = SAND, selectedKey = 'sand', brush = 6, paused = false;
  let painting = false, lastPoint = null, accumulator = 0, lastTime = performance.now();

  function resize() {
    const oldCols = cols, oldRows = rows, oldCells = cells, oldAges = ages;
    viewWidth = window.innerWidth; viewHeight = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewWidth * dpr); canvas.height = Math.floor(viewHeight * dpr);
    cols = Math.max(1, Math.floor(viewWidth / CELL_SIZE)); rows = Math.max(1, Math.floor(viewHeight / CELL_SIZE));
    cells = new Uint8Array(cols * rows); ages = new Uint16Array(cols * rows); updated = new Uint32Array(cols * rows);
    if (oldCols && oldRows) {
      const copyCols = Math.min(cols, oldCols), copyRows = Math.min(rows, oldRows);
      const sourceX = Math.floor((oldCols - copyCols) / 2), targetX = Math.floor((cols - copyCols) / 2);
      const sourceY = Math.floor((oldRows - copyRows) / 2), targetY = Math.floor((rows - copyRows) / 2);
      for (let y = 0; y < copyRows; y++) {
        const from = (sourceY + y) * oldCols + sourceX, to = (targetY + y) * cols + targetX;
        cells.set(oldCells.subarray(from, from + copyCols), to); ages.set(oldAges.subarray(from, from + copyCols), to);
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function hash(x, y, frame) {
    let n = (x * 374761393 + y * 668265263 + frame * 69069) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function index(x, y) { return y * cols + x; }
  function inside(x, y) { return x >= 0 && x < cols && y >= 0 && y < rows; }

  function move(fromX, fromY, toX, toY, swap) {
    const from = index(fromX, fromY), to = index(toX, toY);
    const oldType = cells[from], oldAge = ages[from];
    if (swap) { cells[from] = cells[to]; ages[from] = ages[to]; }
    else { cells[from] = EMPTY; ages[from] = 0; }
    cells[to] = oldType; ages[to] = oldAge; updated[from] = tick; updated[to] = tick;
  }

  function trySolidMove(x, y, type) {
    const from = index(x, y), belowY = y + 1;
    if (belowY < rows) {
      const below = index(x, belowY), belowType = cells[below];
      if (belowType === EMPTY) { move(x, y, x, belowY, false); return true; }
      if (type === SAND && belowType === WATER) { move(x, y, x, belowY, true); return true; }
      if (type === WATER && belowType === FIRE) {
        cells[below] = WATER; ages[below] = 0; cells[from] = EMPTY; ages[from] = 0; updated[from] = tick; updated[below] = tick; return true;
      }
    }
    const first = hash(x, y, tick) < .5 ? -1 : 1;
    const dirs = [first, -first];
    for (let i = 0; i < 2; i++) {
      const nx = x + dirs[i], ny = y + 1;
      if (!inside(nx, ny)) continue;
      const target = index(nx, ny);
      if (cells[target] === EMPTY) { move(x, y, nx, ny, false); return true; }
      if (type === SAND && cells[target] === WATER) { move(x, y, nx, ny, true); return true; }
      if (type === WATER && cells[target] === FIRE) {
        cells[target] = WATER; ages[target] = 0; cells[index(x, y)] = EMPTY; ages[index(x, y)] = 0; updated[index(x, y)] = tick; updated[target] = tick; return true;
      }
    }
    if (type === WATER) {
      const sideFirst = hash(x + 19, y, tick) < .5 ? -1 : 1;
      const sideDirs = [sideFirst, -sideFirst];
      for (let i = 0; i < 2; i++) {
        const nx = x + sideDirs[i];
        if (!inside(nx, y)) continue;
        const target = index(nx, y);
        if (cells[target] === EMPTY) { move(x, y, nx, y, false); return true; }
      }
    }
    return false;
  }

  function updateSolids() {
    const scanRight = (tick & 1) === 0;
    for (let y = rows - 1; y >= 0; y--) {
      for (let step = 0; step < cols; step++) {
        const x = scanRight ? step : cols - 1 - step, at = index(x, y);
        if (updated[at] === tick) continue;
        const type = cells[at];
        if (type === SAND || type === WATER) trySolidMove(x, y, type); else if (type !== FIRE && type !== SMOKE) updated[at] = tick;
      }
    }
  }

  function igniteNearby(x, y) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      const at = index(nx, ny);
      if (cells[at] === WOOD && hash(nx, ny, tick) < .34) { cells[at] = FIRE; ages[at] = 0; }
    }
  }

  function updateGas() {
    const scanRight = (tick & 1) === 1;
    for (let y = 0; y < rows; y++) for (let step = 0; step < cols; step++) {
      const x = scanRight ? step : cols - 1 - step, at = index(x, y);
      if (updated[at] === tick) continue;
      const type = cells[at];
      if (type !== FIRE && type !== SMOKE) continue;
      ages[at]++;
      if (type === FIRE) {
        igniteNearby(x, y);
        if (ages[at] > 24 + Math.floor(hash(x, y, tick) * 34)) { cells[at] = SMOKE; ages[at] = 0; updated[at] = tick; continue; }
        const up = y - 1;
        if (up >= 0 && cells[index(x, up)] === EMPTY && hash(x, y, tick + 7) < .58) move(x, y, x, up, false);
        else updated[at] = tick;
      } else {
        if (ages[at] > 42 + Math.floor(hash(x, y, tick) * 65)) { cells[at] = EMPTY; ages[at] = 0; updated[at] = tick; continue; }
        const up = y - 1, dir = hash(x, y, tick + 11) < .5 ? -1 : 1;
        if (up >= 0 && cells[index(x, up)] === EMPTY && hash(x, y, tick + 17) < .78) move(x, y, x, up, false);
        else if (inside(x + dir, up) && cells[index(x + dir, up)] === EMPTY) move(x, y, x + dir, up, false);
        else updated[at] = tick;
      }
    }
  }

  function stepSimulation() { tick++; updateSolids(); updateGas(); }

  function paintAt(clientX, clientY) {
    const cx = Math.floor(clientX / CELL_SIZE), cy = Math.floor(clientY / CELL_SIZE);
    const radius = Math.max(0, Math.floor((brush - 1) / 2));
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > (radius + .45) * (radius + .45)) continue;
      const x = cx + dx, y = cy + dy;
      if (!inside(x, y)) continue;
      const at = index(x, y); cells[at] = selected; ages[at] = selected === FIRE || selected === SMOKE ? Math.floor(hash(x, y, tick) * 5) : 0;
    }
  }
  function paintLine(from, to) {
    if (!from) { paintAt(to.x, to.y); return; }
    const distance = Math.hypot(to.x - from.x, to.y - from.y), points = Math.max(1, Math.ceil(distance / Math.max(2, CELL_SIZE * .65)));
    for (let i = 1; i <= points; i++) { const t = i / points; paintAt(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t); }
  }

  function render() {
    const gradient = ctx.createLinearGradient(0, 0, 0, viewHeight);
    gradient.addColorStop(0, '#0b1020'); gradient.addColorStop(.58, '#0a1020'); gradient.addColorStop(1, '#080c18');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, viewWidth, viewHeight);
    const glow = ctx.createRadialGradient(viewWidth * .7, viewHeight * .35, 0, viewWidth * .7, viewHeight * .35, viewWidth * .65);
    glow.addColorStop(0, 'rgba(50, 83, 160, .10)'); glow.addColorStop(1, 'rgba(50, 83, 160, 0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, viewWidth, viewHeight);
    let liveCount = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const at = index(x, y), type = cells[at];
      if (type === EMPTY) continue;
      liveCount++;
      const px = x * CELL_SIZE, py = y * CELL_SIZE;
      ctx.fillStyle = palette[type];
      if (type === FIRE) {
        ctx.globalAlpha = .82 + hash(x, y, tick) * .18; ctx.fillRect(px, py, CELL_SIZE + .5, CELL_SIZE + .5);
        ctx.fillStyle = '#ffd166'; ctx.globalAlpha = .45; ctx.fillRect(px + 1, py + 1, 2, 2); ctx.globalAlpha = 1;
      } else if (type === SMOKE) {
        ctx.globalAlpha = Math.max(.12, .58 - ages[at] * .004); ctx.fillRect(px, py, CELL_SIZE + .5, CELL_SIZE + .5); ctx.globalAlpha = 1;
      } else {
        ctx.fillRect(px, py, CELL_SIZE + .45, CELL_SIZE + .45);
        if (type === WATER) { ctx.fillStyle = 'rgba(181, 228, 255, .18)'; ctx.fillRect(px, py, CELL_SIZE + .45, 1); }
      }
    }
    particleCount.textContent = liveCount.toLocaleString('ru-RU');
  }

  function animationFrame(now) {
    const dt = Math.min(.05, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
    if (!paused) { accumulator += dt; while (accumulator >= STEP) { stepSimulation(); accumulator -= STEP; } }
    render(); requestAnimationFrame(animationFrame);
  }
  function selectMaterial(key) {
    selectedKey = key; selected = values[key]; selectedName.textContent = names[key];
    materialButtons.forEach((button) => button.classList.toggle('is-selected', button.dataset.material === key));
  }

  materialButtons.forEach((button) => button.addEventListener('click', () => selectMaterial(button.dataset.material)));
  brushSize.addEventListener('input', () => { brush = Number(brushSize.value); brushValue.textContent = brush; });
  pauseButton.addEventListener('click', () => { paused = !paused; pauseLabel.textContent = paused ? 'Продолжить' : 'Пауза'; pauseIcon.textContent = paused ? '▶' : 'Ⅱ'; pauseButton.setAttribute('aria-pressed', String(paused)); });
  clearButton.addEventListener('click', () => { cells.fill(EMPTY); ages.fill(0); updated.fill(0); accumulator = 0; });
  canvas.addEventListener('pointerdown', (event) => { painting = true; canvas.setPointerCapture(event.pointerId); lastPoint = { x: event.clientX, y: event.clientY }; paintLine(null, lastPoint); });
  canvas.addEventListener('pointermove', (event) => { if (!painting) return; const point = { x: event.clientX, y: event.clientY }; paintLine(lastPoint, point); lastPoint = point; });
  const stopPainting = () => { painting = false; lastPoint = null; };
  canvas.addEventListener('pointerup', stopPainting); canvas.addEventListener('pointercancel', stopPainting); canvas.addEventListener('pointerleave', () => { if (!painting) lastPoint = null; });
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', (event) => {
    const key = { '1': 'sand', '2': 'water', '3': 'stone', '4': 'wood', '5': 'fire', '6': 'smoke' }[event.key];
    if (key) selectMaterial(key);
    if (event.code === 'Space' && event.target === document.body) { event.preventDefault(); pauseButton.click(); }
  });
  resize(); selectMaterial(selectedKey); requestAnimationFrame(animationFrame);
}());


