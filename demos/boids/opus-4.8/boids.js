'use strict';

// Чистая логика стаи (boids) без DOM. Боид: { x, y, vx, vy }.
// Мир тороидальный шириной w и высотой h. Параметры params:
//   { sep, ali, coh, perception, maxSpeed } — силы трёх правил,
//   радиус восприятия и максимальная скорость.
// Dual-mode: node — module.exports; браузер (<script>) — window.Boids.

// Доля радиуса восприятия, внутри которой работает разделение.
const SEP_FRACTION = 0.5;
// Минимальная скорость как доля от максимальной — чтобы стая не замирала.
const MIN_SPEED_FRACTION = 0.35;
// Потолок ускорения за секунду (стабилизирует интегратор при больших силах).
const MAX_FORCE = 800;

// Кратчайшая знаковая разность b - a на оси-кольце длиной size.
// Возвращает значение в (-size/2, size/2]: путь через край, если он короче.
function torusDelta(a, b, size) {
  let d = b - a;
  const half = size / 2;
  if (d > half) d -= size;
  else if (d < -half) d += size;
  return d;
}

// Приведение координаты в [0, size) с учётом перехода через край.
function wrap(v, size) {
  let r = v % size;
  if (r < 0) r += size;
  return r;
}

function limit(x, y, max) {
  const m = Math.hypot(x, y);
  if (m > max && m > 0) return { x: x / m * max, y: y / m * max };
  return { x, y };
}

// Равномерная сетка, точно покрывающая тор (cellW/cellH >= cellSize).
// Дробная граничная клетка теряла бы соседей через край, поэтому делим
// ширину/высоту на целое число столбцов/строк, а не режем по cellSize.
function buildGrid(boids, cellSize, w, h) {
  const cols = Math.max(1, Math.floor(w / cellSize));
  const rows = Math.max(1, Math.floor(h / cellSize));
  const cellW = w / cols;
  const cellH = h / rows;
  const cells = new Array(cols * rows);
  for (let c = 0; c < cells.length; c++) cells[c] = [];
  for (let i = 0; i < boids.length; i++) {
    const cx = Math.min(cols - 1, Math.floor(wrap(boids[i].x, w) / cellW));
    const cy = Math.min(rows - 1, Math.floor(wrap(boids[i].y, h) / cellH));
    cells[cy * cols + cx].push(i);
  }
  return { cells, cols, rows, cellW, cellH, w, h };
}

// Индексы боидов в радиусе r от boids[i] по тороидальной метрике.
// Обходит блок клеток вокруг i, оборачивая индексы по модулю (через край).
function neighbors(i, boids, grid, r) {
  const { cells, cols, rows, cellW, cellH, w, h } = grid;
  const b = boids[i];
  const bcx = Math.min(cols - 1, Math.floor(wrap(b.x, w) / cellW));
  const bcy = Math.min(rows - 1, Math.floor(wrap(b.y, h) / cellH));
  const rangeX = Math.min(Math.floor(cols / 2), Math.ceil(r / cellW));
  const rangeY = Math.min(Math.floor(rows / 2), Math.ceil(r / cellH));
  const r2 = r * r;
  const out = [];
  for (let dy = -rangeY; dy <= rangeY; dy++) {
    const cy = ((bcy + dy) % rows + rows) % rows;
    for (let dx = -rangeX; dx <= rangeX; dx++) {
      const cx = ((bcx + dx) % cols + cols) % cols;
      const cell = cells[cy * cols + cx];
      for (let k = 0; k < cell.length; k++) {
        const j = cell[k];
        if (j === i) continue;
        const ddx = torusDelta(b.x, boids[j].x, w);
        const ddy = torusDelta(b.y, boids[j].y, h);
        if (ddx * ddx + ddy * ddy <= r2) out.push(j);
      }
    }
  }
  return out;
}

// Наивный O(n) поиск соседей — эталон корректности для сетки.
function neighborsNaive(i, boids, r, w, h) {
  const b = boids[i];
  const r2 = r * r;
  const out = [];
  for (let j = 0; j < boids.length; j++) {
    if (j === i) continue;
    const dx = torusDelta(b.x, boids[j].x, w);
    const dy = torusDelta(b.y, boids[j].y, h);
    if (dx * dx + dy * dy <= r2) out.push(j);
  }
  return out;
}

// Управляющее ускорение боида i от соседей near (массив индексов).
// Возвращает { ax, ay } — суперпозицию трёх правил с весами из params.
//   separation — отталкивание от близких (вес ~ 1/dist²);
//   alignment  — подгон скорости к средней скорости соседей;
//   cohesion   — притяжение к центру масс соседей (через тороидальные дельты).
function acceleration(i, boids, near, params) {
  const b = boids[i];
  const perc = params.perception;
  const sepR = perc * SEP_FRACTION;

  let sepX = 0, sepY = 0;
  let aliX = 0, aliY = 0;
  let cohX = 0, cohY = 0;
  let sepCount = 0;

  for (let k = 0; k < near.length; k++) {
    const o = boids[near[k]];
    const dx = torusDelta(b.x, o.x, params.w);
    const dy = torusDelta(b.y, o.y, params.h);
    const dist = Math.hypot(dx, dy) || 1e-6;
    if (dist < sepR) {
      // Чем ближе сосед, тем сильнее отталкивание (нормируем на dist²).
      sepX -= dx / (dist * dist);
      sepY -= dy / (dist * dist);
      sepCount++;
    }
    aliX += o.vx;
    aliY += o.vy;
    cohX += dx; // дельта до соседа: сумма/n даёт вектор к центру масс
    cohY += dy;
  }

  let ax = 0, ay = 0;
  const n = near.length;
  if (n > 0) {
    // Выравнивание: рулевой вектор = средняя скорость соседей - своя.
    const steerAliX = aliX / n - b.vx;
    const steerAliY = aliY / n - b.vy;
    // Сцепление: рулевой вектор к центру масс соседей.
    const steerCohX = cohX / n;
    const steerCohY = cohY / n;
    if (sepCount > 0) { sepX /= sepCount; sepY /= sepCount; }
    // Масштаб разделения подобран под единицы 1/px, чтобы веса 0..2 были
    // соизмеримы с выравниванием/сцеплением.
    ax = params.sep * sepX * 1400 + params.ali * steerAliX * 6 + params.coh * steerCohX * 4;
    ay = params.sep * sepY * 1400 + params.ali * steerAliY * 6 + params.coh * steerCohY * 4;
    const lim = limit(ax, ay, MAX_FORCE);
    ax = lim.x; ay = lim.y;
  }
  return { ax, ay };
}

// Один шаг симуляции (dt — секунды). Мутирует массив boids на месте:
// при ≥400 агентах аллокация нового массива каждый кадр — лишний мусор.
// Соседи берутся по СТАРОМУ состоянию (Map клеток построена до сдвига).
function step(boids, params, dt) {
  const cellSize = Math.max(params.perception, 8);
  const grid = buildGrid(boids, cellSize, params.w, params.h);
  const maxSpeed = params.maxSpeed;
  const minSpeed = maxSpeed * MIN_SPEED_FRACTION;
  const n = boids.length;
  const nvx = new Float64Array(n);
  const nvy = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const b = boids[i];
    const near = neighbors(i, boids, grid, params.perception);
    const { ax, ay } = acceleration(i, boids, near, params);
    let vx = b.vx + ax * dt;
    let vy = b.vy + ay * dt;
    const sp = Math.hypot(vx, vy) || 1e-6;
    if (sp > maxSpeed) { vx = vx / sp * maxSpeed; vy = vy / sp * maxSpeed; }
    else if (sp < minSpeed) { vx = vx / sp * minSpeed; vy = vy / sp * minSpeed; }
    nvx[i] = vx; nvy[i] = vy;
  }

  for (let i = 0; i < n; i++) {
    const b = boids[i];
    b.vx = nvx[i]; b.vy = nvy[i];
    b.x = wrap(b.x + b.vx * dt, params.w);
    b.y = wrap(b.y + b.vy * dt, params.h);
  }
  return boids;
}

const BoidsAPI = {
  SEP_FRACTION,
  MIN_SPEED_FRACTION,
  MAX_FORCE,
  torusDelta,
  wrap,
  limit,
  buildGrid,
  neighbors,
  neighborsNaive,
  acceleration,
  step,
};

// Dual-mode: node — экспорт; браузер (<script>) — глобал window.Boids.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BoidsAPI;
} else {
  window.Boids = BoidsAPI;
}
