'use strict';
(function () {
  const Boids = window.Boids;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const NUM_BOIDS = 500;
  // Базовая величина силы (px/s^2); слайдер силы правила её масштабирует.
  const BASE_FORCE = 600;
  // Клампы для dt (сек): не даём анимации "прыгать" после паузы вкладки.
  const DT_MAX = 0.05;

  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  let worldW = window.innerWidth;
  let worldH = window.innerHeight;

  function resize() {
    worldW = window.innerWidth;
    worldH = window.innerHeight;
    canvas.width = Math.max(1, Math.round(worldW * DPR));
    canvas.height = Math.max(1, Math.round(worldH * DPR));
    canvas.style.width = worldW + 'px';
    canvas.style.height = worldH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- Параметры, управляемые ползунками ----
  const params = { sep: 1.5, ali: 1.0, coh: 1.0, radius: 80, speed: 160 };

  function bindSlider(id, outId, key, format) {
    const el = document.getElementById(id);
    const out = document.getElementById(outId);
    function apply() {
      const v = parseFloat(el.value);
      params[key] = v;
      out.textContent = format ? format(v) : String(v);
    }
    el.addEventListener('input', apply);
    apply();
  }

  bindSlider('sep', 'sepVal', 'sep', (v) => v.toFixed(1));
  bindSlider('ali', 'aliVal', 'ali', (v) => v.toFixed(1));
  bindSlider('coh', 'cohVal', 'coh', (v) => v.toFixed(1));
  bindSlider('radius', 'radiusVal', 'radius', (v) => Math.round(v));
  bindSlider('speed', 'speedVal', 'speed', (v) => Math.round(v));

  // ---- Агенты ----
  let boids = [];
  const accelX = new Float32Array(NUM_BOIDS);
  const accelY = new Float32Array(NUM_BOIDS);

  function spawnBoids() {
    boids = [];
    for (let i = 0; i < NUM_BOIDS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = params.speed * (0.35 + Math.random() * 0.4);
      boids.push({
        x: Math.random() * worldW,
        y: Math.random() * worldH,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      });
    }
    watchedIndex = 0;
  }

  let watchedIndex = 0;
  let watchedNeighbors = [];

  // ---- Пространственная сетка (uniform grid) для поиска соседей за O(n) ----
  // Без неё поиск соседей у всех агентов — O(n^2): при 500 агентах это
  // 250 000 сравнений на кадр. Сетка с ячейкой >= радиуса восприятия сводит
  // поиск к скану своей и 8 соседних ячеек (тороидально, с обёрткой по
  // модулю), что даёт на порядок меньше сравнений и держит 60 fps даже
  // при увеличении числа агентов или радиуса.
  let gridCols = 1;
  let gridRows = 1;
  let gridCellSize = 80;
  let grid = [[]];
  const visitedScratch = new Int32Array(9);

  function updateGridDims(radius) {
    gridCellSize = Math.max(radius, 8);
    const cols = Math.max(1, Math.ceil(worldW / gridCellSize));
    const rows = Math.max(1, Math.ceil(worldH / gridCellSize));
    if (cols !== gridCols || rows !== gridRows || grid.length !== cols * rows) {
      gridCols = cols;
      gridRows = rows;
      grid = new Array(gridCols * gridRows);
      for (let i = 0; i < grid.length; i++) grid[i] = [];
    }
  }

  function clearGrid() {
    for (let i = 0; i < grid.length; i++) grid[i].length = 0;
  }

  function cellOf(x, y) {
    let cx = Math.floor(x / gridCellSize);
    let cy = Math.floor(y / gridCellSize);
    if (cx >= gridCols) cx = gridCols - 1;
    if (cx < 0) cx = 0;
    if (cy >= gridRows) cy = gridRows - 1;
    if (cy < 0) cy = 0;
    return cy * gridCols + cx;
  }

  function rebuildGrid() {
    clearGrid();
    for (let i = 0; i < boids.length; i++) {
      const b = boids[i];
      grid[cellOf(b.x, b.y)].push(i);
    }
  }

  // Соседи агента i в радиусе radius. Сканирует свою + 8 соседних ячеек
  // сетки, тороидально оборачивая индексы по модулю gridCols/gridRows.
  // Дедуплицирует ячейки (важно при малом числе ячеек по одной из осей,
  // когда соседние индексы совпадают из-за обёртки).
  function queryNeighbors(i, radius) {
    const b = boids[i];
    const cx = Math.min(gridCols - 1, Math.max(0, Math.floor(b.x / gridCellSize)));
    const cy = Math.min(gridRows - 1, Math.max(0, Math.floor(b.y / gridCellSize)));
    const result = [];
    let visitedCount = 0;
    for (let oy = -1; oy <= 1; oy++) {
      const ncy = ((cy + oy) % gridRows + gridRows) % gridRows;
      for (let ox = -1; ox <= 1; ox++) {
        const ncx = ((cx + ox) % gridCols + gridCols) % gridCols;
        const cellIdx = ncy * gridCols + ncx;
        let already = false;
        for (let v = 0; v < visitedCount; v++) {
          if (visitedScratch[v] === cellIdx) { already = true; break; }
        }
        if (already) continue;
        visitedScratch[visitedCount++] = cellIdx;
        const bucket = grid[cellIdx];
        for (let k = 0; k < bucket.length; k++) {
          const j = bucket[k];
          if (j === i) continue;
          const other = boids[j];
          const dist = Boids.toroidalDistance(b.x, b.y, other.x, other.y, worldW, worldH);
          if (dist <= radius) result.push(other);
        }
      }
    }
    return result;
  }

  function addSteering(accum, desiredVec, maxForce, boid) {
    if (maxForce <= 0) return;
    const dir = Boids.normalize(desiredVec);
    if (dir.x === 0 && dir.y === 0) return;
    const desiredVel = { x: dir.x * params.speed, y: dir.y * params.speed };
    const steer = Boids.limitMagnitude(
      { x: desiredVel.x - boid.vx, y: desiredVel.y - boid.vy },
      maxForce
    );
    accum.x += steer.x;
    accum.y += steer.y;
  }

  function step(dt) {
    const radius = params.radius;

    // Фаза 1: сетка по текущим (старым) позициям, силы считаем для всех
    // агентов от одного и того же "снимка" мира — иначе порядок обхода
    // массива влиял бы на результат (классическая ошибка boids).
    updateGridDims(radius);
    rebuildGrid();

    for (let i = 0; i < boids.length; i++) {
      const b = boids[i];
      const neighbors = queryNeighbors(i, radius);

      const sepVec = Boids.separationRule(b, neighbors, worldW, worldH);
      const aliVec = Boids.alignmentRule(b, neighbors);
      const cohVec = Boids.cohesionRule(b, neighbors, worldW, worldH);

      const steer = { x: 0, y: 0 };
      addSteering(steer, sepVec, params.sep * BASE_FORCE, b);
      addSteering(steer, aliVec, params.ali * BASE_FORCE, b);
      addSteering(steer, cohVec, params.coh * BASE_FORCE, b);

      accelX[i] = steer.x;
      accelY[i] = steer.y;
    }

    // Фаза 2: применяем силы и двигаем всех разом.
    for (let i = 0; i < boids.length; i++) {
      const b = boids[i];
      b.vx += accelX[i] * dt;
      b.vy += accelY[i] * dt;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > params.speed && speed > 0) {
        b.vx = (b.vx / speed) * params.speed;
        b.vy = (b.vy / speed) * params.speed;
      }
      b.x = ((b.x + b.vx * dt) % worldW + worldW) % worldW;
      b.y = ((b.y + b.vy * dt) % worldH + worldH) % worldH;
    }

    // Фаза 3: пересобрать сетку по новым позициям и снять "снимок" соседей
    // наблюдаемого агента именно для того состояния, которое будет отрисовано.
    rebuildGrid();
    watchedNeighbors = queryNeighbors(watchedIndex, radius);
  }

  function drawBoid(b, isWatched, isNeighbor) {
    const angle = Math.atan2(b.vy, b.vx);
    const size = isWatched ? 11 : 6;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.6, size * 0.55);
    ctx.lineTo(-size * 0.6, -size * 0.55);
    ctx.closePath();
    ctx.fillStyle = isWatched ? '#ff6b57' : isNeighbor ? '#ffd26e' : 'rgba(205,218,232,0.82)';
    ctx.fill();
    if (isWatched) {
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    ctx.fillStyle = '#11141a';
    ctx.fillRect(0, 0, worldW, worldH);

    const watched = boids[watchedIndex];

    // Радиус восприятия наблюдаемого агента.
    ctx.beginPath();
    ctx.arc(watched.x, watched.y, params.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(55,198,217,0.08)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(94,215,231,0.55)';
    ctx.stroke();

    // Линии к соседям, которых наблюдаемый агент реально видит сейчас
    // (кратчайший тороидальный путь — не напрямик через весь экран).
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,210,110,0.55)';
    for (let i = 0; i < watchedNeighbors.length; i++) {
      const n = watchedNeighbors[i];
      const d = Boids.toroidalDelta(watched.x, watched.y, n.x, n.y, worldW, worldH);
      ctx.beginPath();
      ctx.moveTo(watched.x, watched.y);
      ctx.lineTo(watched.x + d.dx, watched.y + d.dy);
      ctx.stroke();
    }

    const neighborSet = new Set(watchedNeighbors);
    for (let i = 0; i < boids.length; i++) {
      const b = boids[i];
      const isWatched = i === watchedIndex;
      drawBoid(b, isWatched, !isWatched && neighborSet.has(b));
    }
  }

  // Клик/тап по полю — выбрать ближайшего агента как наблюдаемого.
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < boids.length; i++) {
      const d = Boids.toroidalDistance(x, y, boids[i].x, boids[i].y, worldW, worldH);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0) watchedIndex = best;
  });

  document.getElementById('reshuffle').addEventListener('click', spawnBoids);

  spawnBoids();

  let lastTime = null;
  function frame(now) {
    if (lastTime === null) {
      lastTime = now;
      requestAnimationFrame(frame);
      return;
    }
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, DT_MAX);

    step(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
