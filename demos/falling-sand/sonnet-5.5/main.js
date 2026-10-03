/* Падающий песок — клеточный автомат на Canvas 2D. Claude Sonnet 5.5.

   Устройство:
   1. Ядро (createWorld) — чистая логика без DOM: сетка клеток в четырёх Uint8Array
      (вид, «жизнь», вариант цвета, штамп шага). Модуль двойного назначения: в браузере
      работает как есть, в node экспортируется через module.exports (для проверок).
   2. Рендер — ImageData размером с сетку, масштабируется на canvas без сглаживания;
      свечение огня — размытая копия «горячих» клеток поверх, режим 'lighter'.
   3. Ввод — pointer events, кисть кругом с интерполяцией мазка.

   Честность симуляции:
   - за шаг клетка двигается не больше чем на одну клетку по вертикали (вода — ещё
     и по свободному горизонтальному пути, клетка за клеткой, без прыжков через
     препятствия); каждая частица обрабатывается ровно один раз за шаг (штамп);
   - порядок обхода строки (слева направо / справа налево) выбирается случайно для
     каждой строки каждого шага, выбор диагонали и направления растекания — случайный,
     поэтому левого/правого перекоса нет;
   - диагональный ход запрещён, если боковая клетка занята жёстким веществом
     (камень, дерево, горящее дерево) — тонкие диагональные стенки не протекают;
   - обмен местами (песок тонет в воде, вода и песок вытесняют газ) — всегда
     между соседними клетками, вещество сохраняется. */
(function () {
  'use strict';

  /* ======================= 1. Ядро симуляции ======================= */

  const EMPTY = 0, SAND = 1, WATER = 2, STONE = 3, WOOD = 4, FIRE = 5, SMOKE = 6, BURN = 7;

  // Свойства по виду вещества
  const PASS = new Uint8Array(8);   // тяжёлое (песок, вода) может занять клетку: пусто или газ
  PASS[EMPTY] = PASS[FIRE] = PASS[SMOKE] = 1;
  const GAS = new Uint8Array(8);
  GAS[FIRE] = GAS[SMOKE] = 1;
  const RIGID = new Uint8Array(8);  // жёсткое: не даёт протиснуться по диагонали
  RIGID[STONE] = RIGID[WOOD] = RIGID[BURN] = 1;

  // Параметры физики
  const DISP = 5;            // на сколько клеток вода растекается за шаг (по свободному пути)
  const P_SINK = 0.5;        // песок тонет в воде вертикально
  const P_SINK_DIAG = 0.3;   // ... и по диагонали
  const P_IGN_FIRE = 0.18;   // огонь поджигает соседнее дерево, за шаг
  const P_IGN_BURN = 0.10;   // горящее дерево пытается поджечь одного из 8 соседей
  const P_EMIT = 0.10;       // горящее дерево выпускает язык пламени вверх
  const P_BURN_DECAY = 0.30; // горящее дерево тратит «жизнь» не каждый шаг
  const P_DOUSE = 0.5;       // вода у случайной из 4 сторон гасит горящее дерево
  const P_EVAP = 0.06;       // вода, потушившая огонь, иногда превращается в пар
  const P_FIRE_SMOKE = 0.5;  // умирающий огонь оставляет дым

  function createWorld(w, h, seed) {
    const n = w * h;
    const T = new Uint8Array(n);   // вид вещества
    const L = new Uint8Array(n);   // «жизнь» (огонь, дым, горящее дерево)
    const V = new Uint8Array(n);   // вариант цвета (зерно)
    const U = new Uint8Array(n);   // штамп шага: клетка уже обработана
    // зерно перемешиваем: у xorshift слабые первые значения при «маленьком» зерне
    let rs = (seed >>> 0) + 0x9e3779b9;
    rs = Math.imul(rs ^ (rs >>> 16), 0x85ebca6b);
    rs = Math.imul(rs ^ (rs >>> 13), 0xc2b2ae35);
    rs = (rs ^ (rs >>> 16)) | 0;
    if (rs === 0) rs = 0x9e3779b9;
    let tick = 0, stamp = 1;

    function rnd() {
      rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5;
      return rs >>> 0;
    }
    function chance(p) { return (rnd() >>> 8) < p * 16777216; }

    function setCell(i, t) {
      T[i] = t; V[i] = rnd() & 255; U[i] = 0;
      switch (t) {
        case FIRE:  L[i] = 24 + (rnd() % 24); break;
        case SMOKE: L[i] = 120 + (rnd() % 120); break;
        case BURN:  L[i] = 150 + (rnd() % 100); break;
        default:    L[i] = 0;
      }
    }
    function erase(i) { T[i] = EMPTY; L[i] = 0; }

    function move(i, j) {          // j свободна
      T[j] = T[i]; L[j] = L[i]; V[j] = V[i]; U[j] = stamp;
      T[i] = EMPTY; L[i] = 0;
    }
    function swap(i, j) {          // обмен соседних клеток
      const t = T[i], l = L[i], v = V[i];
      T[i] = T[j]; L[i] = L[j]; V[i] = V[j];
      T[j] = t;    L[j] = l;    V[j] = v;
      U[i] = stamp; U[j] = stamp;
    }
    function shift(i, j) { if (T[j] === EMPTY) move(i, j); else swap(i, j); }

    // сосед по направлению d: 0 вверх, 1 вниз, 2 влево, 3 вправо; -1 если за краем
    function nb(i, x, y, d) {
      switch (d) {
        case 0: return y > 0 ? i - w : -1;
        case 1: return y < h - 1 ? i + w : -1;
        case 2: return x > 0 ? i - 1 : -1;
        default: return x < w - 1 ? i + 1 : -1;
      }
    }

    function ignite(j) { T[j] = BURN; L[j] = 150 + (rnd() % 100); U[j] = stamp; }

    /* ---- песок ---- */
    function stepSand(i, x, y) {
      if (y >= h - 1) return;
      const b = i + w;
      const tb = T[b];
      if (PASS[tb] === 1) { shift(i, b); return; }
      if (tb === WATER && chance(P_SINK)) { swap(i, b); return; }
      const first = (rnd() & 1) ? 1 : -1;
      for (let a = 0; a < 2; a++) {
        const dx = a === 0 ? first : -first;
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        if (RIGID[T[i + dx]] === 1) continue;
        const j = b + dx, tj = T[j];
        if (PASS[tj] === 1) { shift(i, j); return; }
        if (tj === WATER && chance(P_SINK_DIAG)) { swap(i, j); return; }
      }
    }

    /* ---- вода ---- */
    function stepWater(i, x, y) {
      if (y < h - 1) {
        const b = i + w;
        if (PASS[T[b]] === 1) { shift(i, b); return; }
        const first = (rnd() & 1) ? 1 : -1;
        for (let a = 0; a < 2; a++) {
          const dx = a === 0 ? first : -first;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (RIGID[T[i + dx]] === 1) continue;
          const j = b + dx;
          if (PASS[T[j]] === 1) { shift(i, j); return; }
        }
      }
      // растекание: идём по свободному пути, предпочитаем клетку, под которой пустота
      let dir = (rnd() & 1) ? 1 : -1;
      for (let a = 0; a < 2; a++, dir = -dir) {
        let free = 0, drop = 0;
        for (let s = 1; s <= DISP; s++) {
          const nx = x + dir * s;
          if (nx < 0 || nx >= w) break;
          const j = i + dir * s;
          if (PASS[T[j]] !== 1) break;
          free = s;
          if (y < h - 1 && PASS[T[j + w]] === 1) { drop = s; break; }
        }
        if (free > 0) {
          const s = drop > 0 ? drop : 1 + (rnd() % free);
          shift(i, i + dir * s);
          return;
        }
      }
    }

    /* ---- огонь ---- */
    function stepFire(i, x, y) {
      // вода рядом: огонь гаснет, оставляя пар (дым)
      let wet = false;
      for (let d = 0; d < 4; d++) {
        const j = nb(i, x, y, d);
        if (j >= 0 && T[j] === WATER) { wet = true; break; }
      }
      if (wet) {
        T[i] = SMOKE; L[i] = 150 + (rnd() % 90);
        if (chance(P_EVAP)) {
          const e = nb(i, x, y, rnd() & 3);
          if (e >= 0 && T[e] === WATER) { T[e] = SMOKE; L[e] = 150 + (rnd() % 90); U[e] = stamp; }
        }
        return;
      }
      // поджиг дерева
      for (let d = 0; d < 4; d++) {
        const j = nb(i, x, y, d);
        if (j >= 0 && T[j] === WOOD && chance(P_IGN_FIRE)) ignite(j);
      }
      // жизнь
      const life = L[i];
      if (life === 0) {
        if (chance(P_FIRE_SMOKE)) { T[i] = SMOKE; L[i] = 100 + (rnd() % 120); }
        else { T[i] = EMPTY; L[i] = 0; }
        return;
      }
      L[i] = life - 1;
      // движение: язык пламени тянется вверх, колеблется в стороны;
      // рядом с топливом огонь задерживается и успевает его поджечь
      const r = rnd();
      for (let d = 0; d < 4; d++) {
        const j = nb(i, x, y, d);
        if (j >= 0 && (T[j] === WOOD || T[j] === BURN)) {
          if ((r & 0xf00) < 0xb00) return;      // ~69%: остаться на месте
          break;
        }
      }
      const k = r & 7;
      const side = (r & 8) ? 1 : -1;
      if (y > 0 && k < 4) {                       // 50%: прямо вверх
        const j = i - w, tj = T[j];
        if (tj === EMPTY) { move(i, j); return; }
        if (tj === SMOKE) { swap(i, j); return; }
      }
      if (y > 0 && k < 6) {                       // ещё 25%: вверх по диагонали
        for (let a = 0; a < 2; a++) {
          const dx = a === 0 ? side : -side;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = i - w + dx, tj = T[j];
          if (tj === EMPTY) { move(i, j); return; }
          if (tj === SMOKE) { swap(i, j); return; }
        }
      }
      for (let a = 0; a < 2; a++) {               // иначе (или если путь вверх закрыт) — вбок
        const dx = a === 0 ? side : -side;
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const j = i + dx;
        if (T[j] === EMPTY) { move(i, j); return; }
      }
    }

    /* ---- дым ---- */
    function stepSmoke(i, x, y) {
      const life = L[i];
      if (life === 0) { T[i] = EMPTY; return; }
      if ((rnd() & 1) === 0) L[i] = life - 1;
      if ((rnd() & 1) === 0) return;             // дым неторопливый
      const r = rnd();
      if (y > 0 && (r & 7) < 5) {
        const j = i - w, tj = T[j];
        if (tj === EMPTY) { move(i, j); return; }
        if (tj === WATER && chance(0.3)) { swap(i, j); return; }  // пузырь всплывает
      }
      const side = (r & 8) ? 1 : -1;
      if (y > 0) {
        for (let a = 0; a < 2; a++) {
          const dx = a === 0 ? side : -side;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (RIGID[T[i + dx]] === 1) continue;
          const j = i - w + dx;
          if (T[j] === EMPTY) { move(i, j); return; }
        }
      }
      for (let a = 0; a < 2; a++) {
        const dx = a === 0 ? side : -side;
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const j = i + dx;
        if (T[j] === EMPTY) { move(i, j); return; }
      }
    }

    /* ---- горящее дерево ---- */
    function stepBurn(i, x, y) {
      // вода рядом может потушить: пробуем одного случайного соседа (без перекоса по сторонам)
      {
        const j = nb(i, x, y, rnd() & 3);
        if (j >= 0 && T[j] === WATER && chance(P_DOUSE)) {
          T[i] = WOOD; L[i] = 0;
          if (chance(0.3)) { T[j] = SMOKE; L[j] = 150 + (rnd() % 90); U[j] = stamp; }
          return;
        }
      }
      const life = L[i];
      if (life === 0) {            // прогорело
        const r = rnd() % 10;
        if (r < 5) { T[i] = SMOKE; L[i] = 140 + (rnd() % 100); }
        else if (r < 7) { T[i] = FIRE; L[i] = 10 + (rnd() % 15); }
        else { T[i] = EMPTY; L[i] = 0; }
        return;
      }
      if (chance(P_BURN_DECAY)) L[i] = life - 1;
      // огонь перекидывается на соседнее дерево
      if (chance(P_IGN_BURN)) {
        const dx = (rnd() % 3) - 1, dy = (rnd() % 3) - 1;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const j = ny * w + nx;
          if (T[j] === WOOD) ignite(j);
        }
      }
      // язык пламени вверх
      if (y > 0 && chance(P_EMIT)) {
        const nx = x + (rnd() % 3) - 1;
        if (nx >= 0 && nx < w) {
          const j = (y - 1) * w + nx;
          if (T[j] === EMPTY) {
            T[j] = FIRE; L[j] = 14 + (rnd() % 20); V[j] = rnd() & 255; U[j] = stamp;
          }
        }
      }
    }

    /* ---- один шаг симуляции ---- */
    function step() {
      stamp = (tick & 1) + 1;
      tick++;
      for (let y = h - 1; y >= 0; y--) {
        const row = y * w;
        const fwd = (rnd() & 1) === 0;
        for (let k = 0; k < w; k++) {
          const x = fwd ? k : w - 1 - k;
          const i = row + x;
          const t = T[i];
          if (t === EMPTY || t === STONE || t === WOOD) continue;
          if (U[i] === stamp) continue;
          U[i] = stamp;
          switch (t) {
            case SAND:  stepSand(i, x, y); break;
            case WATER: stepWater(i, x, y); break;
            case FIRE:  stepFire(i, x, y); break;
            case SMOKE: stepSmoke(i, x, y); break;
            case BURN:  stepBurn(i, x, y); break;
          }
        }
      }
    }

    /* ---- кисть: круг радиуса rad; type === EMPTY — ластик ---- */
    function paint(cx, cy, rad, type, density) {
      const lim = rad * rad + rad + 0.25;
      for (let dy = -rad; dy <= rad; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= h) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy > lim) continue;
          const x = cx + dx;
          if (x < 0 || x >= w) continue;
          const i = y * w + x;
          if (type === EMPTY) { erase(i); continue; }
          const cur = T[i];
          if (cur !== EMPTY && GAS[cur] !== 1) continue;
          if (density < 1 && !chance(density)) continue;
          setCell(i, type);
        }
      }
    }

    function clear() { T.fill(0); L.fill(0); V.fill(0); U.fill(0); }

    return { w, h, T, L, V, U, step, paint, setCell, erase, clear, rnd, chance };
  }

  /* ---- демонстрационная сцена (масштабируется по размеру сетки) ---- */
  function buildScene(wd) {
    const w = wd.w, h = wd.h, T = wd.T;
    wd.clear();
    const th = Math.max(2, Math.round(h / 70));
    const put = (x, y, t) => { if (x >= 0 && y >= 0 && x < w && y < h) wd.setCell(y * w + x, t); };
    const rect = (x0, y0, x1, y1, t) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, t);
    };
    const fillFree = (x0, x1, y, t) => {            // только в пустые клетки
      if (y < 0 || y >= h) return;
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
        if (T[y * w + x] === EMPTY) wd.setCell(y * w + x, t);
      }
    };
    const disc = (cx, cy, r, t) => {
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r + r * 0.5) put(cx + x, cy + y, t);
      }
    };
    const thick = (x0, y0, x1, y1, t, tk) => {      // линия квадратной кистью
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let k = 0; k <= n; k++) {
        const x = Math.round(x0 + (x1 - x0) * k / n), y = Math.round(y0 + (y1 - y0) * k / n);
        rect(x, y, x + tk - 1, y + tk - 1, t);
      }
    };
    const fy = h - 1;

    // 1. Каменная чаша с водой слева
    const bx0 = Math.round(w * 0.05), bx1 = Math.round(w * 0.30);
    const bh = Math.round(h * 0.30);
    rect(bx0, fy - bh, bx0 + th - 1, fy, STONE);
    rect(bx1 - th + 1, fy - bh, bx1, fy, STONE);
    rect(bx0, fy - th + 1, bx1, fy, STONE);
    rect(bx0 + th, fy - th - Math.round(bh * 0.55) + 1, bx1 - th, fy - th, WATER);

    // 2. Каменная воронка с песком по центру
    const cx = Math.round(w * 0.47);
    const y0 = Math.round(h * 0.12), y1 = Math.round(h * 0.36);
    const half = Math.round(Math.min(w * 0.11, h * 0.24));
    const gap = 2;                                    // горло шириной 2*gap+1 = 5 клеток
    const xlTop = cx - half, xlNeck = cx - gap - th;
    const xrTop = cx + half, xrNeck = cx + gap + 1;
    thick(xlTop, y0, xlNeck, y1, STONE, th);
    thick(xrTop, y0, xrNeck, y1, STONE, th);
    for (let y = y0 + 2; y <= y1 + 1; y++) {
      const t = (y - y0) / (y1 - y0);
      const xl = Math.round(xlTop + (xlNeck - xlTop) * t) + th;
      const xr = Math.round(xrTop + (xrNeck - xrTop) * t) - 1;
      fillFree(xl, xr, y, SAND);
    }

    // 3. Деревянный домик справа
    const hx0 = Math.round(w * 0.66);
    const hw = Math.min(Math.round(w * 0.26), Math.round(h * 0.55));
    const hx1 = hx0 + hw;
    const wallH = Math.round(h * 0.22), tw = Math.max(2, th - 1);
    const yt = fy - wallH;
    rect(hx0, yt, hx0 + tw - 1, fy, WOOD);
    rect(hx1 - tw + 1, yt, hx1, fy, WOOD);
    rect(hx0, fy - tw + 1, hx1, fy, WOOD);
    rect(hx0, yt, hx1, yt + tw - 1, WOOD);
    const midY = fy - Math.round(wallH * 0.5);
    rect(hx0, midY, hx1 - Math.round(hw * 0.25), midY + tw - 1, WOOD);
    const mx = (hx0 + hx1) >> 1, roofH = Math.round(hw * 0.42);
    thick(hx0 - 3, yt, mx, yt - roofH, WOOD, tw);
    thick(hx1 + 3 - tw + 1, yt, mx - tw + 1, yt - roofH, WOOD, tw);
    // деревянная полка над чашей и воронкой
    const px0 = Math.round(w * 0.58);
    rect(px0, Math.round(h * 0.52), px0 + Math.round(w * 0.06), Math.round(h * 0.52) + tw - 1, WOOD);

    // 4. Падающие комки: песок над чашей, вода над крышей
    const r1 = Math.max(3, Math.round(Math.min(w, h) * 0.045));
    disc(Math.round((bx0 + bx1) / 2), Math.round(h * 0.08), r1, SAND);
    disc(mx + Math.round(hw * 0.12), Math.round(h * 0.10), Math.max(3, r1 - 1), WATER);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createWorld, buildScene, EMPTY, SAND, WATER, STONE, WOOD, FIRE, SMOKE, BURN };
  }
  if (typeof document === 'undefined') return;

  /* ======================= 2. Рендер и ввод (DOM) ======================= */

  const TAU = Math.PI * 2;
  const STEPS_PER_SEC = 120;     // фиксированная частота шагов симуляции
  const MAX_STEPS = 4;           // потолок шагов за кадр (защита от «спирали смерти»)

  const $ = (id) => document.getElementById(id);
  const canvas = $('view');
  const ctx = canvas.getContext('2d', { alpha: false });
  const panel = $('panel');
  const sizeInput = $('size'), sizeOut = $('sizeOut');
  const btnPause = $('pause'), btnClear = $('clear'), btnScene = $('scene');
  const pauseLabel = $('pauseLabel'), pausedBadge = $('pausedBadge'), statEl = $('stat');

  // вещества кисти: порядок = горячие клавиши 1..7
  const MATS = [
    { id: 'sand',   type: SAND,  density: 0.35, ring: '#f1d58f' },
    { id: 'water',  type: WATER, density: 0.35, ring: '#7cc4f6' },
    { id: 'stone',  type: STONE, density: 1,    ring: '#aab1bd' },
    { id: 'wood',   type: WOOD,  density: 1,    ring: '#c48a52' },
    { id: 'fire',   type: FIRE,  density: 0.30, ring: '#ffb04a' },
    { id: 'smoke',  type: SMOKE, density: 0.12, ring: '#cfd4de' },
    { id: 'eraser', type: EMPTY, density: 1,    ring: '#ffffff' }
  ];
  const matButtons = Array.prototype.slice.call(document.querySelectorAll('[data-mat]'));

  let world = null;
  let cd = 4;                    // размер клетки в device-пикселях
  let dpr = 1;
  let matIndex = 0, brush = 6;
  let paused = false;
  let userTouched = false;       // пользователь что-то нарисовал/очистил: мир не пересобираем на ресайзе
  let seedCounter = (Date.now() ^ 0x5bd1e995) >>> 0;
  let bgGrad = null;
  const pointer = { inside: false, down: false, erase: false, gx: 0, gy: 0, lx: -1, ly: -1 };

  /* ---------- палитры ---------- */
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
  function pack(r, g, b, a) { return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; }

  function ramp(keys, n) {       // keys: [[позиция, [r,g,b], альфа]]
    const R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n), A = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let k = 0;
      while (k < keys.length - 2 && i > keys[k + 1][0]) k++;
      const a = keys[k], b = keys[k + 1];
      const t = Math.max(0, Math.min(1, (i - a[0]) / (b[0] - a[0])));
      R[i] = a[1][0] + (b[1][0] - a[1][0]) * t;
      G[i] = a[1][1] + (b[1][1] - a[1][1]) * t;
      B[i] = a[1][2] + (b[1][2] - a[1][2]) * t;
      A[i] = a[2] + (b[2] - a[2]) * t;
    }
    return { R, G, B, A };
  }

  const sandPal = new Uint32Array(256), sandLit = new Uint32Array(256);
  const stonePal = new Uint32Array(256), stoneLit = new Uint32Array(256);
  const woodPal = new Uint32Array(160);                    // (x%5)<<4 | v&15, +80 — освещённая кромка
  const firePal = new Uint32Array(64), fireGlow = new Uint32Array(64);
  const burnPal = new Uint32Array(256);
  const smokeA = new Uint8Array(256);
  const wr = new Uint8Array(64), wg = new Uint8Array(64), wb = new Uint8Array(64);
  const SHIM = new Int8Array(64);
  const SPARK = pack(255, 214, 100, 255);
  const BURN_GLOW = pack(110, 40, 8, 255);

  (function buildPalettes() {
    const sandTones = [[226, 190, 112], [214, 176, 98], [233, 201, 128], [204, 165, 90]];
    for (let v = 0; v < 256; v++) {
      const t = sandTones[v >> 6], j = (v & 15) - 8;
      sandPal[v] = pack(clamp255(t[0] + j), clamp255(t[1] + j), clamp255(t[2] + j * 0.8), 255);
      sandLit[v] = pack(clamp255(t[0] + j + 24), clamp255(t[1] + j + 24), clamp255(t[2] + j * 0.8 + 20), 255);

      const s = 112 + ((v & 31) - 16) - ((v & 0x38) === 0 ? 16 : 0);
      stonePal[v] = pack(clamp255(s), clamp255(s + 6), clamp255(s + 16), 255);
      stoneLit[v] = pack(clamp255(s + 20), clamp255(s + 26), clamp255(s + 34), 255);
    }
    const woodTones = [[140, 90, 46], [158, 105, 56], [132, 84, 42], [150, 98, 52], [166, 113, 62]];
    for (let c = 0; c < 5; c++) {
      for (let k = 0; k < 16; k++) {
        const t = woodTones[c], j = k - 8;
        woodPal[(c << 4) | k] = pack(clamp255(t[0] + j), clamp255(t[1] + j), clamp255(t[2] + j * 0.7), 255);
        woodPal[80 + ((c << 4) | k)] = pack(clamp255(t[0] + j + 22), clamp255(t[1] + j + 20), clamp255(t[2] + j * 0.7 + 14), 255);
      }
    }
    const f = ramp([
      [0, [110, 20, 10], 0], [5, [160, 30, 10], 150], [12, [225, 65, 14], 240],
      [24, [255, 135, 30], 255], [40, [255, 205, 80], 255], [63, [255, 245, 190], 255]
    ], 64);
    for (let i = 0; i < 64; i++) {
      firePal[i] = pack(f.R[i], f.G[i], f.B[i], f.A[i]);
      const k = Math.min(1, i / 30);
      fireGlow[i] = pack(255 * k, 112 * k, 26 * k, 255);
    }
    const b = ramp([
      [0, [58, 22, 12], 255], [60, [150, 45, 12], 255], [140, [235, 95, 20], 255], [255, [255, 150, 40], 255]
    ], 256);
    for (let i = 0; i < 256; i++) burnPal[i] = pack(b.R[i], b.G[i], b.B[i], 255);
    for (let i = 0; i < 256; i++) smokeA[i] = Math.round(Math.min(1, i / 180) * 0.62 * 255);
    for (let d = 0; d < 64; d++) {          // вода темнеет с глубиной
      const t = Math.min(1, d / 40);
      wr[d] = 88 + (18 - 88) * t; wg[d] = 176 + (52 - 176) * t; wb[d] = 240 + (132 - 240) * t;
    }
    for (let i = 0; i < 64; i++) SHIM[i] = Math.round(Math.sin(i / 64 * TAU) * 5);
  })();

  function hash3(x, y, f) {
    let hh = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(f, 1103515245);
    hh = Math.imul(hh ^ (hh >>> 13), 1274126177);
    return (hh ^ (hh >>> 16)) >>> 0;
  }

  /* ---------- буферы рендера ---------- */
  let wc, wctx, img, px;              // мир W x H
  let gcv, gctx, gimg, gpx;           // слой свечения W x H
  let g2, g2ctx, g4, g4ctx;           // уменьшенные копии для размытия
  let colDepth;
  let glowDirty = false;
  let frameNo = 0;

  function allocRender(w, h) {
    wc = document.createElement('canvas'); wc.width = w; wc.height = h;
    wctx = wc.getContext('2d');
    img = wctx.createImageData(w, h); px = new Uint32Array(img.data.buffer);
    gcv = document.createElement('canvas'); gcv.width = w; gcv.height = h;
    gctx = gcv.getContext('2d');
    gimg = gctx.createImageData(w, h); gpx = new Uint32Array(gimg.data.buffer);
    g2 = document.createElement('canvas'); g2.width = Math.max(1, Math.ceil(w / 2)); g2.height = Math.max(1, Math.ceil(h / 2));
    g2ctx = g2.getContext('2d');
    g4 = document.createElement('canvas'); g4.width = Math.max(1, Math.ceil(w / 4)); g4.height = Math.max(1, Math.ceil(h / 4));
    g4ctx = g4.getContext('2d');
    colDepth = new Uint16Array(w);
    glowDirty = false;
  }

  let lastCount = 0;

  function renderWorld() {
    const w = world.w, h = world.h, T = world.T, L = world.L, V = world.V;
    const fr = frameNo++;
    colDepth.fill(0);
    if (glowDirty) { gpx.fill(0); glowDirty = false; }
    let cnt = 0, hot = 0;

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const t = T[i];
        if (t === EMPTY) { px[i] = 0; colDepth[x] = 0; continue; }
        cnt++;
        const v = V[i];
        const af = y === 0 || PASS[T[i - w]] === 1;      // над клеткой пусто или газ: освещённая кромка
        if (t !== WATER) colDepth[x] = 0;
        switch (t) {
          case SAND:
            px[i] = af ? sandLit[v] : sandPal[v];
            break;
          case WATER: {
            const d = ++colDepth[x];
            const di = d > 64 ? 63 : d - 1;
            let r = wr[di], g = wg[di], b = wb[di];
            if (af) { r += 34; g += 36; b += 16; }
            const s = (v & 7) - 3 + SHIM[(x * 2 + y * 3 + (fr >> 1)) & 63];
            px[i] = 0xff000000 | (clamp255(b + s) << 16) | (clamp255(g + s) << 8) | clamp255(r + s);
            break;
          }
          case STONE:
            px[i] = af ? stoneLit[v] : stonePal[v];
            break;
          case WOOD:
            px[i] = woodPal[(((x % 5) << 4) | (v & 15)) + (af ? 80 : 0)];
            break;
          case FIRE: {
            const hh = hash3(x, y, fr);
            let idx = L[i] + ((hh & 7) - 3);
            idx = idx < 0 ? 0 : idx > 63 ? 63 : idx;
            px[i] = firePal[idx];
            gpx[i] = fireGlow[idx];
            hot++;
            break;
          }
          case BURN: {
            const hh = hash3(x, y, fr >> 1);
            let idx = L[i] + (hh & 63) - 28;
            if ((v & 3) === 0) idx -= 45;
            idx = idx < 0 ? 0 : idx > 255 ? 255 : idx;
            px[i] = ((hh & 63) === 0) ? SPARK : burnPal[idx];
            gpx[i] = BURN_GLOW;
            hot++;
            break;
          }
          case SMOKE: {
            const a = smokeA[L[i]], c = 122 + (v & 31);
            px[i] = (a << 24) | ((c + 6) << 16) | (c << 8) | c;
            break;
          }
        }
      }
    }
    lastCount = cnt;
    wctx.putImageData(img, 0, 0);

    const W = w * cd, H = h * cd;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(wc, 0, 0, w, h, 0, 0, W, H);

    if (hot > 0) {                          // свечение: уменьшаем вдвое и вчетверо, растягиваем обратно
      glowDirty = true;
      gctx.putImageData(gimg, 0, 0);
      g2ctx.clearRect(0, 0, g2.width, g2.height);
      g2ctx.imageSmoothingEnabled = true;
      g2ctx.drawImage(gcv, 0, 0, w, h, 0, 0, g2.width, g2.height);
      g4ctx.clearRect(0, 0, g4.width, g4.height);
      g4ctx.imageSmoothingEnabled = true;
      g4ctx.drawImage(g2, 0, 0, g2.width, g2.height, 0, 0, g4.width, g4.height);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.3;
      ctx.drawImage(g2, 0, 0, g2.width, g2.height, 0, 0, W, H);
      ctx.globalAlpha = 0.8;
      ctx.drawImage(g4, 0, 0, g4.width, g4.height, 0, 0, W, H);
      ctx.restore();
    }
  }

  function drawFrame() {
    const cw = canvas.width, ch = canvas.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = bgGrad || '#0a0e1c';
    ctx.fillRect(0, 0, cw, ch);

    renderWorld();

    // земля под миром (за стеклянной панелью)
    const wy = world.h * cd;
    if (wy < ch) {
      ctx.fillStyle = '#070a14';
      ctx.fillRect(0, wy, cw, ch - wy);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, wy, cw, Math.max(1, Math.round(dpr)));
    }

    // кольцо кисти
    if (pointer.inside) {
      const rad = brush - 1;
      const R = (rad + 0.5) * cd;
      const px0 = (pointer.gx + 0.5) * cd, py0 = (pointer.gy + 0.5) * cd;
      const erase = pointer.erase || MATS[matIndex].type === EMPTY;
      ctx.lineWidth = Math.max(1, dpr);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.arc(px0, py0, R + ctx.lineWidth, 0, TAU); ctx.stroke();
      ctx.strokeStyle = pointer.erase ? '#ffffff' : MATS[matIndex].ring;
      if (erase) ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.beginPath(); ctx.arc(px0, py0, R, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(px0 - dpr, py0 - dpr, 2 * dpr, 2 * dpr);
    }
  }

  /* ---------- раскладка и размеры ---------- */
  function pickCssCell(vw, vh) {
    return Math.max(3, Math.min(6, Math.round(Math.sqrt(vw * vh) / 360)));
  }

  function newWorld(nw, nh) {
    world = createWorld(nw, nh, seedCounter = (seedCounter + 0x9e3779b9) >>> 0);
    allocRender(nw, nh);
  }

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight);
    const cw = Math.max(1, Math.round(vw * dpr)), ch = Math.max(1, Math.round(vh * dpr));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }

    // мир занимает всё, что выше панели; ниже — «земля» под стеклом
    let bottomCss = vh;
    const pr = panel.getBoundingClientRect();
    if (pr.height > 0 && pr.top > vh * 0.4) bottomCss = Math.max(60, pr.top - 10);
    const bottomDev = Math.round(bottomCss * dpr);

    let wantCell = Math.max(2, Math.round(pickCssCell(vw, vh) * dpr));
    if (!world || !userTouched) {
      // нетронутый мир можно пересобрать под новый размер клетки
      while ((cw / wantCell) * (bottomDev / wantCell) > 260000) wantCell++;
    } else {
      wantCell = cd;
    }
    const nw = Math.max(24, Math.floor(cw / wantCell));
    const nh = Math.max(24, Math.floor(bottomDev / wantCell));

    if (!world) {
      cd = wantCell; newWorld(nw, nh); buildScene(world);
    } else if (!userTouched) {
      if (wantCell !== cd || nw !== world.w || nh !== world.h) {
        cd = wantCell; newWorld(nw, nh); buildScene(world);
      }
    } else if (nw !== world.w || nh !== world.h) {
      // мир с рисунками: сохраняем содержимое, якорь — левый нижний угол
      const old = world;
      newWorld(nw, nh);
      const cols = Math.min(old.w, nw), off = old.h - nh;
      for (let y = 0; y < nh; y++) {
        const oy = y + off;
        if (oy < 0 || oy >= old.h) continue;
        const a = oy * old.w, b = y * nw;
        world.T.set(old.T.subarray(a, a + cols), b);
        world.L.set(old.L.subarray(a, a + cols), b);
        world.V.set(old.V.subarray(a, a + cols), b);
      }
    }
    pointer.gx = Math.min(pointer.gx, world.w - 1);
    pointer.gy = Math.min(pointer.gy, world.h - 1);

    bgGrad = ctx.createLinearGradient(0, 0, 0, world.h * cd);
    bgGrad.addColorStop(0, '#1b2340');
    bgGrad.addColorStop(0.55, '#121831');
    bgGrad.addColorStop(1, '#0b0f1f');
  }

  /* ---------- кисть и ввод ---------- */
  function applyBrush() {
    if (!pointer.down || !world) return;
    const mat = pointer.erase ? MATS[MATS.length - 1] : MATS[matIndex];
    const rad = brush - 1;
    const spacing = Math.max(1, rad * 0.5);
    const x1 = pointer.gx, y1 = pointer.gy;
    if (pointer.lx < 0) {
      world.paint(x1, y1, rad, mat.type, mat.density);
    } else {
      const x0 = pointer.lx, y0 = pointer.ly;
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(dist / spacing));
      for (let k = 1; k <= n; k++) {
        world.paint(Math.round(x0 + (x1 - x0) * k / n), Math.round(y0 + (y1 - y0) * k / n),
          rad, mat.type, mat.density);
      }
    }
    pointer.lx = x1; pointer.ly = y1;
  }

  function updatePointer(e) {
    if (!world) return;
    const sx = canvas.width / Math.max(1, window.innerWidth);
    const sy = canvas.height / Math.max(1, window.innerHeight);
    pointer.gx = Math.max(0, Math.min(world.w - 1, Math.floor(e.clientX * sx / cd)));
    pointer.gy = Math.max(0, Math.min(world.h - 1, Math.floor(e.clientY * sy / cd)));
    pointer.inside = true;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* не критично */ }
    pointer.down = true;
    pointer.erase = e.button === 2;
    pointer.lx = -1;
    userTouched = true;
    updatePointer(e);
  });
  canvas.addEventListener('pointermove', updatePointer);
  function pointerEnd(e) {
    pointer.down = false;
    pointer.lx = -1;
    if (e.pointerType && e.pointerType !== 'mouse') pointer.inside = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* не критично */ }
  }
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('pointerleave', () => { if (!pointer.down) pointer.inside = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------- панель ---------- */
  function selectMat(i) {
    matIndex = Math.max(0, Math.min(MATS.length - 1, i));
    matButtons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.mat === MATS[matIndex].id ? 'true' : 'false'));
  }
  function setBrush(v) {
    brush = Math.max(1, Math.min(20, v | 0));
    sizeInput.value = String(brush);
    sizeOut.textContent = String(brush);
  }
  function setPaused(p) {
    paused = p;
    btnPause.classList.toggle('is-paused', paused);
    btnPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pauseLabel.textContent = paused ? 'Продолжить' : 'Пауза';
    pausedBadge.hidden = !paused;
  }
  function clearAll() { world.clear(); userTouched = true; }
  function loadScene() { buildScene(world); userTouched = false; layout(); }

  function afterMouseClick(e) { if (e.detail > 0) e.currentTarget.blur(); }
  matButtons.forEach((b, i) => {
    b.addEventListener('click', (e) => { selectMat(i); afterMouseClick(e); });
  });
  sizeInput.addEventListener('input', () => setBrush(+sizeInput.value));
  btnPause.addEventListener('click', (e) => { setPaused(!paused); afterMouseClick(e); });
  btnClear.addEventListener('click', (e) => { clearAll(); afterMouseClick(e); });
  btnScene.addEventListener('click', (e) => { loadScene(); afterMouseClick(e); });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    switch (e.code) {
      case 'Space':
        if (tag === 'BUTTON') return;            // у кнопки свой нативный клик по пробелу
        e.preventDefault(); setPaused(!paused); break;
      case 'KeyC': clearAll(); break;
      case 'KeyR': loadScene(); break;
      case 'BracketLeft': setBrush(brush - 1); break;
      case 'BracketRight': setBrush(brush + 1); break;
      default:
        if (/^(Digit|Numpad)[1-7]$/.test(e.code)) selectMat(parseInt(e.code.slice(-1), 10) - 1);
    }
  });

  /* ---------- главный цикл ---------- */
  let last = 0, acc = 0, fpsAvg = 60, statTimer = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.05) dt = 0.05;                    // кламп большого dt (вкладка была скрыта и т.п.)
    fpsAvg += (1 / dt - fpsAvg) * 0.05;

    applyBrush();
    if (!paused) {
      acc += dt * STEPS_PER_SEC;
      let n = Math.floor(acc);
      acc -= n;
      if (n > MAX_STEPS) n = MAX_STEPS;
      for (let s = 0; s < n; s++) world.step();
    }
    drawFrame();

    statTimer += dt;
    if (statTimer > 0.3) {
      statTimer = 0;
      statEl.textContent = 'частиц: ' + lastCount.toLocaleString('ru-RU') + ' · ' + Math.round(fpsAvg) + ' fps';
    }
  }

  layout();
  setBrush(brush);
  selectMat(0);
  window.addEventListener('resize', layout);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(panel);
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
})();
