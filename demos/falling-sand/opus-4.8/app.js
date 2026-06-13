'use strict';
(function () {
  const S = window.Sand;
  const { EMPTY, SAND, WATER, STONE, WOOD, FIRE, SMOKE } = S;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const els = {
    materials: document.getElementById('materials'),
    size: document.getElementById('size'),
    sizeOut: document.getElementById('sizeOut'),
    playPause: document.getElementById('playPause'),
    clear: document.getElementById('clear'),
  };

  const CELL = 4;          // размер клетки в CSS-пикселях
  let grid = null;         // S.createGrid(...)
  let dpr = 1;
  let running = true;
  let material = SAND;
  let brush = parseInt(els.size.value, 10);

  // Палитра рендера. Для песка/воды/дерева/дыма — лёгкий джиттер по клетке,
  // чтобы поверхность не выглядела плоской заливкой.
  const BASE = {
    [SAND]:  [0xd9, 0xb6, 0x5f],
    [WATER]: [0x3f, 0x7f, 0xd6],
    [STONE]: [0x6f, 0x76, 0x82],
    [WOOD]:  [0x7c, 0x5a, 0x33],
    [SMOKE]: [0x7a, 0x80, 0x8c],
  };

  // Предрассчитанный фон холста.
  const BG = [0x0a, 0x0c, 0x10];

  let imageData = null;
  let pixels = null;

  function buildGrid() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const w = Math.max(1, Math.floor(cssW / CELL));
    const h = Math.max(1, Math.floor(cssH / CELL));

    // Бэкинговый буфер ровно в клетках (рисуем 1px на клетку, затем масштабируем).
    canvas.width = w;
    canvas.height = h;
    canvas.style.imageRendering = 'pixelated';

    const old = grid;
    grid = S.createGrid(w, h);
    // Перенос старого содержимого (с привязкой к нижнему краю — естественно для «осадка»).
    if (old) {
      const dy = h - old.h;
      for (let y = 0; y < old.h; y++) {
        for (let x = 0; x < old.w; x++) {
          if (x >= w) continue;
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          const i = S.idx(old, x, y);
          S.setCell(grid, x, ny, old.cells[i], old.life[i]);
        }
      }
    }
    imageData = ctx.createImageData(w, h);
    pixels = imageData.data;
  }

  // ---- Кисть ------------------------------------------------------------
  let drawing = false;
  let lastCell = null;

  function eventToCell(e) {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * grid.w;
    const py = (e.clientY - rect.top) / rect.height * grid.h;
    return { x: Math.floor(px), y: Math.floor(py) };
  }

  function stamp(cx, cy) {
    S.paint(grid, cx, cy, brush, material);
  }

  // Рисуем по линии между двумя точками, чтобы быстрые движения не разрывались.
  function stampLine(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const steps = Math.max(1, Math.round(Math.hypot(dx, dy)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stamp(Math.round(a.x + dx * t), Math.round(a.y + dy * t));
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    const c = eventToCell(e);
    stamp(c.x, c.y);
    lastCell = c;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const c = eventToCell(e);
    if (lastCell) stampLine(lastCell, c); else stamp(c.x, c.y);
    lastCell = c;
  });
  function endStroke(e) {
    drawing = false;
    lastCell = null;
    if (e && e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', () => { /* capture держит stroke */ });

  // ---- Панель -----------------------------------------------------------
  els.materials.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mat]');
    if (!btn) return;
    material = parseInt(btn.dataset.mat, 10);
    for (const b of els.materials.querySelectorAll('button')) b.classList.remove('on');
    btn.classList.add('on');
  });
  els.size.addEventListener('input', () => {
    brush = parseInt(els.size.value, 10);
    els.sizeOut.textContent = brush;
  });
  els.playPause.addEventListener('click', () => {
    running = !running;
    els.playPause.textContent = running ? 'Пауза' : 'Пуск';
    els.playPause.classList.toggle('on', !running);
  });
  els.clear.addEventListener('click', () => { S.clear(grid); render(); });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); els.playPause.click(); }
    else if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') els.clear.click();
    const map = { '1': SAND, '2': WATER, '3': STONE, '4': WOOD, '5': FIRE, '6': SMOKE, '0': EMPTY };
    if (e.key in map) {
      const btn = els.materials.querySelector(`button[data-mat="${e.key === '0' ? 0 : map[e.key]}"]`);
      if (btn) btn.click();
    }
  });

  // ---- Рендер -----------------------------------------------------------
  // Детерминированный джиттер по координате (без хранения шума на клетку).
  function jitter(x, y) {
    let n = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
    n = (n ^ (n >> 13)) * 1274126177;
    n = (n ^ (n >> 16)) >>> 0;
    return (n & 0xff) / 255;          // 0..1
  }

  function render() {
    const w = grid.w, h = grid.h;
    const cells = grid.cells;
    const life = grid.life;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = cells[i];
        const p = i * 4;
        let r, g, b;
        if (v === EMPTY) {
          r = BG[0]; g = BG[1]; b = BG[2];
        } else if (v === FIRE) {
          // Огонь мерцает от жёлто-белого к оранжево-красному по «жизни» + джиттеру.
          const t = Math.min(1, life[i] / 35);
          const j = jitter(x, y) * 0.4;
          r = 255;
          g = Math.round(90 + t * 130 + j * 60);
          b = Math.round(20 + j * 40);
        } else {
          const base = BASE[v];
          let shade = 1;
          if (v === SAND || v === WOOD) shade = 0.85 + jitter(x, y) * 0.30;
          else if (v === WATER) shade = 0.80 + jitter(x, y) * 0.25;
          else if (v === SMOKE) {
            // Дым тускнеет к концу жизни.
            const t = Math.min(1, life[i] / 80);
            shade = (0.6 + jitter(x, y) * 0.25) * (0.4 + 0.6 * t);
          } else if (v === STONE) shade = 0.9 + jitter(x, y) * 0.15;
          r = Math.min(255, Math.round(base[0] * shade));
          g = Math.min(255, Math.round(base[1] * shade));
          b = Math.min(255, Math.round(base[2] * shade));
        }
        pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; pixels[p + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // ---- Цикл -------------------------------------------------------------
  let stepAcc = 0;
  let lastT = null;
  const STEP_MS = 1000 / 60; // целевая частота шага автомата

  function frame(t) {
    if (lastT == null) lastT = t;
    const dt = t - lastT;
    lastT = t;
    if (running) {
      stepAcc += dt;
      // не более нескольких шагов за кадр (защита от «спирали смерти»)
      let n = 0;
      while (stepAcc >= STEP_MS && n < 4) { S.step(grid); stepAcc -= STEP_MS; n++; }
      if (stepAcc > STEP_MS * 4) stepAcc = 0;
    }
    render();
    requestAnimationFrame(frame);
  }

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(buildGrid);
  });

  buildGrid();
  // Небольшая стартовая сцена, чтобы витрина не была пустой.
  (function seed() {
    const w = grid.w, h = grid.h;
    for (let x = Math.floor(w * 0.15); x < Math.floor(w * 0.45); x++) {
      S.setCell(grid, x, h - 6, STONE, 0);
    }
    for (let x = Math.floor(w * 0.55); x < Math.floor(w * 0.85); x++) {
      for (let y = h - 10; y < h - 4; y++) S.setCell(grid, x, y, WOOD, 0);
    }
    for (let x = Math.floor(w * 0.20); x < Math.floor(w * 0.40); x++) {
      for (let y = 2; y < 6; y++) S.setCell(grid, x, y, SAND, 0);
    }
  })();
  requestAnimationFrame(frame);
})();
