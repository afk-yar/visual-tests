'use strict';

// Клеточный автомат «падающий песок».
// Сетка — плоский Uint8Array длины w*h, индекс = y*w + x.
// Логика шага чистая и детерминированная при фиксированном rng/parity —
// поэтому тестируется в node без canvas (dual-mode внизу файла).

// Идентификаторы веществ.
const EMPTY = 0;
const SAND = 1;
const WATER = 2;
const STONE = 3;
const WOOD = 4;
const FIRE = 5;
const SMOKE = 6;

// Подвижность для «утопления»: песок плотнее воды и тонет в ней.
// Камень/дерево — твёрдые, сквозь них ничего не проваливается.
function isFluid(v) { return v === WATER; }              // через что песок может тонуть
function isSolidBlock(v) { return v === STONE || v === WOOD; }

// Создать сетку.
function createGrid(w, h) {
  return {
    w, h,
    cells: new Uint8Array(w * h),
    // life — счётчик «жизни» для огня/дыма (0 = не используется).
    life: new Uint8Array(w * h),
    // parity чередует направление обхода по X между кадрами (анти-асимметрия).
    parity: 0,
    // moved помечает клетки, уже сдвинутые на этом шаге, чтобы не двигать дважды.
    moved: new Uint8Array(w * h),
  };
}

function idx(g, x, y) { return y * g.w + x; }
function inBounds(g, x, y) { return x >= 0 && x < g.w && y >= 0 && y < g.h; }

function get(g, x, y) {
  if (!inBounds(g, x, y)) return STONE; // за границей — как стена (ничего не утекает)
  return g.cells[idx(g, x, y)];
}

function setCell(g, x, y, v, life) {
  if (!inBounds(g, x, y)) return;
  const i = idx(g, x, y);
  g.cells[i] = v;
  g.life[i] = life || 0;
}

// Поменять две клетки местами (перемещение без телепортации — только соседи).
function swap(g, ax, ay, bx, by) {
  const ia = idx(g, ax, ay), ib = idx(g, bx, by);
  const tv = g.cells[ia]; g.cells[ia] = g.cells[ib]; g.cells[ib] = tv;
  const tl = g.life[ia]; g.life[ia] = g.life[ib]; g.life[ib] = tl;
  g.moved[ia] = 1; g.moved[ib] = 1;
}

// Детерминируемый ГПСЧ (xorshift32), чтобы тесты были воспроизводимы.
function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

// ---- Правила отдельных веществ ----------------------------------------

// Песок: вниз; если занято — диагональ вниз (с честным выбором стороны);
// тонет в воде (меняется местами с водой под собой/по диагонали).
function stepSand(g, x, y, rng, dir) {
  const below = get(g, x, y + 1);
  if (below === EMPTY || below === SMOKE) { swap(g, x, y, x, y + 1); return; }
  if (below === WATER) { swap(g, x, y, x, y + 1); return; } // тонет в воде

  // Диагонали вниз. dir задаёт первичную сторону; при равной доступности —
  // выбор рандомизируется, иначе берём ту, что свободна.
  const dl = canSandFall(g, x - 1, y + 1);
  const dr = canSandFall(g, x + 1, y + 1);
  if (dl && dr) {
    const left = rng() < 0.5;
    swap(g, x, y, x + (left ? -1 : 1), y + 1);
  } else if (dl && dir < 0) {
    swap(g, x, y, x - 1, y + 1);
  } else if (dr && dir > 0) {
    swap(g, x, y, x + 1, y + 1);
  } else if (dl) {
    swap(g, x, y, x - 1, y + 1);
  } else if (dr) {
    swap(g, x, y, x + 1, y + 1);
  }
}
function canSandFall(g, x, y) {
  const v = get(g, x, y);
  return v === EMPTY || v === WATER || v === SMOKE;
}

// Вода: вниз; иначе вниз-вбок; иначе растекается вбок по горизонтали.
function stepWater(g, x, y, rng, dir) {
  const below = get(g, x, y + 1);
  if (below === EMPTY) { swap(g, x, y, x, y + 1); return; }

  const dl = get(g, x - 1, y + 1) === EMPTY;
  const dr = get(g, x + 1, y + 1) === EMPTY;
  if (dl && dr) {
    swap(g, x, y, x + (rng() < 0.5 ? -1 : 1), y + 1); return;
  } else if (dl && dir < 0) { swap(g, x, y, x - 1, y + 1); return; }
  else if (dr && dir > 0) { swap(g, x, y, x + 1, y + 1); return; }
  else if (dl) { swap(g, x, y, x - 1, y + 1); return; }
  else if (dr) { swap(g, x, y, x + 1, y + 1); return; }

  // Горизонтальное растекание (по соседям — без телепортации).
  const l = get(g, x - 1, y) === EMPTY;
  const r = get(g, x + 1, y) === EMPTY;
  if (l && r) { swap(g, x, y, x + (rng() < 0.5 ? -1 : 1), y); }
  else if (l && dir < 0) { swap(g, x, y, x - 1, y); }
  else if (r && dir > 0) { swap(g, x, y, x + 1, y); }
  else if (l) { swap(g, x, y, x - 1, y); }
  else if (r) { swap(g, x, y, x + 1, y); }
}

// Огонь: поджигает соседнее дерево; имеет ограниченную жизнь; гаснет дымом.
function stepFire(g, x, y, rng) {
  // Поджечь соседнее дерево (4-связность + диагонали).
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (get(g, x + dx, y + dy) === WOOD) {
        // Шанс воспламенения, чтобы фронт горения шёл постепенно.
        if (rng() < 0.35) setCell(g, x + dx, y + dy, FIRE, 30 + Math.floor(rng() * 20));
      }
    }
  }
  // Вода тушит огонь.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (get(g, x + dx, y + dy) === WATER) {
        setCell(g, x, y, SMOKE, 60 + Math.floor(rng() * 40));
        return;
      }
    }
  }
  // Старение: огонь живёт life шагов, затем превращается в дым.
  const i = idx(g, x, y);
  if (g.life[i] <= 1) {
    setCell(g, x, y, SMOKE, 60 + Math.floor(rng() * 40));
  } else {
    g.life[i] -= 1;
  }
}

// Дым: поднимается вверх (и вбок), со временем тает в пустоту.
function stepSmoke(g, x, y, rng, dir) {
  const i = idx(g, x, y);
  // Растворение.
  if (g.life[i] <= 1) { setCell(g, x, y, EMPTY, 0); return; }
  g.life[i] -= 1;

  const up = get(g, x, y - 1);
  if (up === EMPTY) { swap(g, x, y, x, y - 1); return; }

  const ul = get(g, x - 1, y - 1) === EMPTY;
  const ur = get(g, x + 1, y - 1) === EMPTY;
  if (ul && ur) { swap(g, x, y, x + (rng() < 0.5 ? -1 : 1), y - 1); return; }
  else if (ul && dir < 0) { swap(g, x, y, x - 1, y - 1); return; }
  else if (ur && dir > 0) { swap(g, x, y, x + 1, y - 1); return; }
  else if (ul) { swap(g, x, y, x - 1, y - 1); return; }
  else if (ur) { swap(g, x, y, x + 1, y - 1); return; }

  // Иначе слегка дрейфует вбок.
  const l = get(g, x - 1, y) === EMPTY;
  const r = get(g, x + 1, y) === EMPTY;
  if (l && r) { swap(g, x, y, x + (rng() < 0.5 ? -1 : 1), y); }
  else if (l && dir < 0) { swap(g, x, y, x - 1, y); }
  else if (r && dir > 0) { swap(g, x, y, x + 1, y); }
}

// ---- Один шаг автомата ------------------------------------------------

// Обход снизу вверх (падающие вещества), направление по X чередуется (parity).
// rng — функция; по умолчанию создаётся из счётчика шагов для воспроизводимости.
function step(g, rng) {
  rng = rng || makeRng((g.parity + 1) * 2654435761);
  g.moved.fill(0);

  // dir: -1 — сначала левая сторона, +1 — сначала правая. Чередуется по кадрам.
  const dir = g.parity % 2 === 0 ? -1 : 1;

  for (let y = g.h - 1; y >= 0; y--) {
    // Чётность строки тоже учитываем, чтобы убрать предпочтение одной стороны.
    const ltr = (g.parity + y) % 2 === 0;
    if (ltr) {
      for (let x = 0; x < g.w; x++) processCell(g, x, y, rng, dir);
    } else {
      for (let x = g.w - 1; x >= 0; x--) processCell(g, x, y, rng, dir);
    }
  }

  g.parity = (g.parity + 1) & 0xffff;
}

function processCell(g, x, y, rng, dir) {
  const i = idx(g, x, y);
  if (g.moved[i]) return;          // уже двигали на этом шаге
  const v = g.cells[i];
  switch (v) {
    case SAND: stepSand(g, x, y, rng, dir); break;
    case WATER: stepWater(g, x, y, rng, dir); break;
    case FIRE: stepFire(g, x, y, rng); break;
    case SMOKE: stepSmoke(g, x, y, rng, dir); break;
    // STONE, WOOD, EMPTY — неподвижны / ничего не делают.
    default: break;
  }
}

// Рисование кистью (круг радиуса r) указанным веществом.
function paint(g, cx, cy, r, material) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx, y = cy + dy;
      if (!inBounds(g, x, y)) continue;
      // Не затираем дерево водой/песком при «дорисовке»? — нет, кисть пишет всё.
      let life = 0;
      if (material === FIRE) life = 35;
      else if (material === SMOKE) life = 80;
      setCell(g, x, y, material, life);
    }
  }
}

function clear(g) {
  g.cells.fill(EMPTY);
  g.life.fill(0);
}

const SandAPI = {
  EMPTY, SAND, WATER, STONE, WOOD, FIRE, SMOKE,
  createGrid, step, paint, clear,
  get, setCell, makeRng, idx, inBounds,
};

// Dual-mode: node — экспорт; браузер (<script>) — глобал window.Sand.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SandAPI;
} else {
  window.Sand = SandAPI;
}
