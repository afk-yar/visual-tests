# visual-tests Playground — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать статичный (без сборки) полигон для сравнения визуальных решений разных LLM: оболочка master–detail (задачи слева, переключатель моделей справа, iframe с решением, спойлер промпта) + первая демка «двойной маятник» как решение Opus 4.8.

**Architecture:** Чистый HTML/CSS/JS. Оболочка `index.html` рендерит сайдбар и переключатель моделей из реестра `manifest.js` и грузит решение в `<iframe>`. Каждое решение — самодостаточная папка `demos/<task>/<model-slug>/`. Тестируемая чистая логика (физика, маршрутизация) вынесена в dual-mode модули и проверяется через `node *.test.js` (встроенный `assert`, без npm). UI — через Playwright MCP.

**Tech Stack:** Vanilla HTML5/CSS/Canvas 2D; RK4-интегратор; Node (только dev-time тесты, `node:assert`); Python `http.server` + Playwright MCP для проверки UI.

**Визуальный эталон оболочки:** `docs/superpowers/mockup-shell.html` (принят пользователем). Его `<style>` переносится в `assets/shell.css`.

---

## Структура файлов

```
visual-tests/
  index.html                                  ← Task 3: оболочка
  manifest.js                                 ← Task 3: реестр задач/решений
  assets/
    shell.css                                 ← Task 3: стили (из эталона)
    shell.js                                  ← Task 3: рендер + dual-mode resolveActiveSelection
    shell.test.js                             ← Task 3: node-тест маршрутизации
  demos/double-pendulum/opus-4.8/
    index.html                                ← Task 2: страница решения
    style.css                                 ← Task 2
    pendulum.js                               ← Task 1: чистая физика (dual-mode)
    pendulum.test.js                          ← Task 1: node-тесты физики
    app.js                                    ← Task 2: canvas-рендер + UI
  CLAUDE.md                                    ← Task 4
  README.md                                   ← Task 4
```

Порядок: Task 1 (физика) → Task 2 (демка) → Task 3 (оболочка) → Task 4 (доки). Каждая задача завершается коммитом.

Серверный префикс для всех Playwright-проверок (один раз поднять в фоне, корень — папка проекта):
```
python -m http.server 8000 --directory "E:/_Проекты/pet/visual-tests"
```

---

## Task 1: Ядро физики двойного маятника (TDD через node)

**Files:**
- Create: `demos/double-pendulum/opus-4.8/pendulum.js`
- Test: `demos/double-pendulum/opus-4.8/pendulum.test.js`

- [ ] **Step 1: Написать падающий тест-файл**

Создать `demos/double-pendulum/opus-4.8/pendulum.test.js`:

```js
'use strict';
const assert = require('node:assert');
const { accelerations, rk4Step, totalEnergy, bobPositions } = require('./pendulum.js');

const P = { m1: 1, m2: 1, L1: 1, L2: 1, g: 9.81 };

// A. Равновесие: вертикаль в покое → нулевые угловые ускорения.
{
  const { a1, a2 } = accelerations({ th1: 0, th2: 0, w1: 0, w2: 0 }, P);
  assert.ok(Math.abs(a1) < 1e-12, `a1 в покое должно быть 0, получено ${a1}`);
  assert.ok(Math.abs(a2) < 1e-12, `a2 в покое должно быть 0, получено ${a2}`);
}

// B. Редукция к простому маятнику: m2=0 → a1 = -g*sin(th1)/L1 (аналитика).
{
  const Ps = { m1: 1, m2: 0, L1: 2, L2: 1, g: 9.81 };
  const th1 = 0.7;
  const { a1 } = accelerations({ th1, th2: 0.3, w1: 0, w2: 0 }, Ps);
  const expected = -9.81 * Math.sin(th1) / 2;
  assert.ok(Math.abs(a1 - expected) < 1e-9, `простой маятник: ожидали ${expected}, получили ${a1}`);
}

// C. Геометрия позиций грузов (пивот в нуле, y вниз).
{
  const down = bobPositions({ th1: 0, th2: 0 }, P);
  assert.ok(Math.abs(down.x1) < 1e-12 && Math.abs(down.y1 - 1) < 1e-12, `вниз b1: ${JSON.stringify(down)}`);
  assert.ok(Math.abs(down.x2) < 1e-12 && Math.abs(down.y2 - 2) < 1e-12, `вниз b2: ${JSON.stringify(down)}`);
  const flat = bobPositions({ th1: Math.PI / 2, th2: Math.PI / 2 }, P);
  assert.ok(Math.abs(flat.x1 - 1) < 1e-12 && Math.abs(flat.y1) < 1e-12, `гориз b1: ${JSON.stringify(flat)}`);
  assert.ok(Math.abs(flat.x2 - 2) < 1e-12 && Math.abs(flat.y2) < 1e-12, `гориз b2: ${JSON.stringify(flat)}`);
}

// D. Сохранение энергии под RK4: дрейф за 10 c < 0.5 %.
{
  let s = { th1: 2.0944, th2: 2.0944, w1: 0, w2: 0 }; // ~120°, 120°
  const E0 = totalEnergy(s, P);
  const dt = 0.005;
  for (let i = 0; i < 2000; i++) s = rk4Step(s, P, dt);
  const E1 = totalEnergy(s, P);
  const drift = Math.abs(E1 - E0) / Math.abs(E0);
  assert.ok(drift < 5e-3, `дрейф энергии слишком велик: ${drift}`);
  console.log(`дрейф энергии за 10 c: ${(drift * 100).toFixed(4)} %`);
}

console.log('Все тесты физики пройдены.');
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node "E:/_Проекты/pet/visual-tests/demos/double-pendulum/opus-4.8/pendulum.test.js"`
Expected: FAIL — `Cannot find module './pendulum.js'`.

- [ ] **Step 3: Реализовать `pendulum.js`**

Создать `demos/double-pendulum/opus-4.8/pendulum.js`:

```js
'use strict';

// Угловые ускорения (каноника, myPhysicsLab). s={th1,th2,w1,w2}, p={m1,m2,L1,L2,g}.
function accelerations(s, p) {
  const { th1, th2, w1, w2 } = s;
  const { m1, m2, L1, L2, g } = p;
  const d = th1 - th2;
  const denom = 2 * m1 + m2 - m2 * Math.cos(2 * th1 - 2 * th2);
  const a1 = (
    -g * (2 * m1 + m2) * Math.sin(th1)
    - m2 * g * Math.sin(th1 - 2 * th2)
    - 2 * Math.sin(d) * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * Math.cos(d))
  ) / (L1 * denom);
  const a2 = (
    2 * Math.sin(d) * (
      w1 * w1 * L1 * (m1 + m2)
      + g * (m1 + m2) * Math.cos(th1)
      + w2 * w2 * L2 * m2 * Math.cos(d)
    )
  ) / (L2 * denom);
  return { a1, a2 };
}

// Производная состояния для интегратора.
function derivative(s, p) {
  const { a1, a2 } = accelerations(s, p);
  return { th1: s.w1, th2: s.w2, w1: a1, w2: a2 };
}

function addScaled(s, ds, h) {
  return {
    th1: s.th1 + ds.th1 * h,
    th2: s.th2 + ds.th2 * h,
    w1: s.w1 + ds.w1 * h,
    w2: s.w2 + ds.w2 * h,
  };
}

// Один шаг RK4.
function rk4Step(s, p, dt) {
  const k1 = derivative(s, p);
  const k2 = derivative(addScaled(s, k1, dt / 2), p);
  const k3 = derivative(addScaled(s, k2, dt / 2), p);
  const k4 = derivative(addScaled(s, k3, dt), p);
  return {
    th1: s.th1 + dt / 6 * (k1.th1 + 2 * k2.th1 + 2 * k3.th1 + k4.th1),
    th2: s.th2 + dt / 6 * (k1.th2 + 2 * k2.th2 + 2 * k3.th2 + k4.th2),
    w1: s.w1 + dt / 6 * (k1.w1 + 2 * k2.w1 + 2 * k3.w1 + k4.w1),
    w2: s.w2 + dt / 6 * (k1.w2 + 2 * k2.w2 + 2 * k3.w2 + k4.w2),
  };
}

// Полная механическая энергия (для контроля стабильности).
function totalEnergy(s, p) {
  const { th1, th2, w1, w2 } = s;
  const { m1, m2, L1, L2, g } = p;
  const ke = 0.5 * m1 * L1 * L1 * w1 * w1
    + 0.5 * m2 * (L1 * L1 * w1 * w1 + L2 * L2 * w2 * w2
      + 2 * L1 * L2 * w1 * w2 * Math.cos(th1 - th2));
  const pe = -(m1 + m2) * g * L1 * Math.cos(th1) - m2 * g * L2 * Math.cos(th2);
  return ke + pe;
}

// Координаты грузов, пивот в (0,0), y вниз. Масштаб/смещение — в рендерере.
function bobPositions(s, p) {
  const { th1, th2 } = s;
  const { L1, L2 } = p;
  const x1 = L1 * Math.sin(th1);
  const y1 = L1 * Math.cos(th1);
  const x2 = x1 + L2 * Math.sin(th2);
  const y2 = y1 + L2 * Math.cos(th2);
  return { x1, y1, x2, y2 };
}

const PendulumAPI = { accelerations, derivative, rk4Step, totalEnergy, bobPositions };

// Dual-mode: node — экспорт; браузер (<script>) — глобал window.Pendulum.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PendulumAPI;
} else {
  window.Pendulum = PendulumAPI;
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node "E:/_Проекты/pet/visual-tests/demos/double-pendulum/opus-4.8/pendulum.test.js"`
Expected: PASS — печатает «дрейф энергии за 10 c: 0.00xx %» и «Все тесты физики пройдены.» (дрейф заметно меньше 0.5 %).

- [ ] **Step 5: Коммит**

```bash
git -C "E:/_Проекты/pet/visual-tests" add demos/double-pendulum/opus-4.8/pendulum.js demos/double-pendulum/opus-4.8/pendulum.test.js
git -C "E:/_Проекты/pet/visual-tests" commit -m "feat(pendulum): ядро физики двойного маятника + node-тесты

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Страница демки маятника (canvas-рендер + UI)

**Files:**
- Create: `demos/double-pendulum/opus-4.8/index.html`
- Create: `demos/double-pendulum/opus-4.8/style.css`
- Create: `demos/double-pendulum/opus-4.8/app.js`

Зависит от `window.Pendulum` (Task 1). Проверка — Playwright MCP (DOM/canvas не юнит-тестируем).

- [ ] **Step 1: Создать `index.html`**

`demos/double-pendulum/opus-4.8/index.html`:

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Двойной маятник — Opus 4.8</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="wrap">
    <canvas id="stage"></canvas>
    <div class="panel">
      <button id="playPause" type="button">Пауза</button>
      <button id="reset" type="button">Сброс</button>
      <button id="ghost" type="button">Призрак δθ=1e-4</button>
      <label>m₁ <input id="m1" type="range" min="0.2" max="3" step="0.1" value="1"></label>
      <label>m₂ <input id="m2" type="range" min="0.2" max="3" step="0.1" value="1"></label>
      <label>L₁ <input id="L1" type="range" min="0.3" max="1.5" step="0.05" value="1"></label>
      <label>L₂ <input id="L2" type="range" min="0.3" max="1.5" step="0.05" value="1"></label>
    </div>
  </div>
  <script src="pendulum.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Создать `style.css`**

`demos/double-pendulum/opus-4.8/style.css`:

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: #0f1115;
  color: #e8e8ec;
  font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
}
.wrap { display: flex; flex-direction: column; height: 100vh; }
#stage { flex: 1 1 auto; width: 100%; display: block; }
.panel {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  background: #16181d;
  border-top: 1px solid #2a2f38;
}
.panel button {
  padding: 7px 14px;
  color: #e8e8ec;
  background: #232833;
  border: 1px solid #38404e;
  border-radius: 7px;
  cursor: pointer;
  font-size: 14px;
}
.panel button:hover { background: #2c3340; }
.panel button.on { background: #1f6f7d; border-color: #37c6d9; }
.panel label { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: #aeb8c7; }
.panel input[type="range"] { width: 110px; }
```

- [ ] **Step 3: Создать `app.js`**

`demos/double-pendulum/opus-4.8/app.js`:

```js
'use strict';
(function () {
  const { rk4Step, bobPositions } = window.Pendulum;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const els = {
    playPause: document.getElementById('playPause'),
    reset: document.getElementById('reset'),
    ghost: document.getElementById('ghost'),
    m1: document.getElementById('m1'),
    m2: document.getElementById('m2'),
    L1: document.getElementById('L1'),
    L2: document.getElementById('L2'),
  };

  const DEFAULTS = { th1: 2.0944, th2: 2.0944, w1: 0, w2: 0 }; // 120°, 120°
  const DT = 0.005;        // фиксированный шаг физики, c
  const MAX_FRAME = 0.05;  // максимум отыгрываемого времени за кадр
  const TRAIL_MAX = 600;

  let params = readParams();
  let state = { ...DEFAULTS };
  let ghostState = null;
  let trail = [];
  let running = true;
  let acc = 0;
  let lastT = null;

  function readParams() {
    return {
      m1: parseFloat(els.m1.value),
      m2: parseFloat(els.m2.value),
      L1: parseFloat(els.L1.value),
      L2: parseFloat(els.L2.value),
      g: 9.81,
    };
  }

  function resetSim() {
    state = { ...DEFAULTS };
    ghostState = els.ghost.classList.contains('on')
      ? { ...DEFAULTS, th1: DEFAULTS.th1 + 1e-4 }
      : null;
    trail = [];
    acc = 0;
    lastT = null;
  }

  els.playPause.addEventListener('click', () => {
    running = !running;
    els.playPause.textContent = running ? 'Пауза' : 'Пуск';
    lastT = null;
  });
  els.reset.addEventListener('click', resetSim);
  els.ghost.addEventListener('click', () => {
    els.ghost.classList.toggle('on');
    ghostState = els.ghost.classList.contains('on')
      ? { ...state, th1: state.th1 + 1e-4 }
      : null;
  });
  for (const id of ['m1', 'm2', 'L1', 'L2']) {
    els[id].addEventListener('input', () => { params = readParams(); });
  }

  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', fitCanvas);

  function advance(dtReal) {
    acc += Math.min(dtReal, MAX_FRAME);
    while (acc >= DT) {
      state = rk4Step(state, params, DT);
      if (ghostState) ghostState = rk4Step(ghostState, params, DT);
      acc -= DT;
    }
    const p = bobPositions(state, params);
    trail.push({ x: p.x2, y: p.y2 });
    if (trail.length > TRAIL_MAX) trail.shift();
  }

  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

  function drawPendulum(s, toPx, pivotX, pivotY, color) {
    const pos = bobPositions(s, params);
    const b1 = toPx({ x: pos.x1, y: pos.y1 });
    const b2 = toPx({ x: pos.x2, y: pos.y2 });
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY); ctx.lineTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y);
    ctx.stroke();
    ctx.fillStyle = color;
    circle(b1.x, b1.y, 4 + params.m1 * 4);
    circle(b2.x, b2.y, 4 + params.m2 * 4);
  }

  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const pivotX = w / 2, pivotY = h * 0.33;
    const reach = params.L1 + params.L2;
    const scale = Math.min(w, h) * 0.42 / reach;
    const toPx = (pt) => ({ x: pivotX + pt.x * scale, y: pivotY + pt.y * scale });

    if (trail.length > 1) {
      ctx.lineWidth = 2;
      for (let i = 1; i < trail.length; i++) {
        const a = toPx(trail[i - 1]), b = toPx(trail[i]);
        ctx.strokeStyle = `rgba(55,198,217,${(i / trail.length) * 0.6})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    if (ghostState) drawPendulum(ghostState, toPx, pivotX, pivotY, 'rgba(240,201,106,0.55)');
    drawPendulum(state, toPx, pivotX, pivotY, '#e8e8ec');
    ctx.fillStyle = '#7f8a99';
    circle(pivotX, pivotY, 4);
    requestAnimationFrame(frame);
  }

  function frame(t) {
    if (running) {
      if (lastT != null) advance((t - lastT) / 1000);
      lastT = t;
    }
    draw();
  }

  fitCanvas();
  resetSim();
  requestAnimationFrame(frame);
})();
```

- [ ] **Step 4: Проверить standalone через Playwright MCP**

Сервер уже поднят (см. шапку). Действия:
1. `browser_navigate` → `http://localhost:8000/demos/double-pendulum/opus-4.8/index.html`
2. `browser_console_messages` → ошибок быть не должно (favicon 404 — допустимо).
3. `browser_take_screenshot` (filename `.playwright-mcp/dp-1.png`) — виден двухзвенный маятник: пивот сверху по центру, два стержня, два груза.
4. `browser_wait_for` ~1.5 c, затем `browser_take_screenshot` (`.playwright-mcp/dp-2.png`).
Expected: на втором кадре поза маятника изменилась и появился бирюзовый след нижнего груза — анимация идёт.

- [ ] **Step 5: Коммит**

```bash
git -C "E:/_Проекты/pet/visual-tests" add demos/double-pendulum/opus-4.8/index.html demos/double-pendulum/opus-4.8/style.css demos/double-pendulum/opus-4.8/app.js
git -C "E:/_Проекты/pet/visual-tests" commit -m "feat(pendulum): страница демки — canvas-рендер, управление, призрак

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Оболочка (сайдбар + переключатель моделей + iframe + спойлер)

**Files:**
- Create: `manifest.js`
- Create: `assets/shell.js`
- Create: `assets/shell.test.js`
- Create: `assets/shell.css` (из эталона `docs/superpowers/mockup-shell.html`)
- Create: `index.html`

- [ ] **Step 1: Написать падающий тест маршрутизации**

`assets/shell.test.js`:

```js
'use strict';
const assert = require('node:assert');
const { resolveActiveSelection } = require('./shell.js');

const tasks = [
  { id: 'dp', solutions: [{ slug: 'opus' }, { slug: 'gpt5' }] },
  { id: 'knight', solutions: [{ slug: 'opus' }] },
];

let r = resolveActiveSelection(tasks, '');               // дефолт: 1-я задача, 1-е решение
assert.equal(r.task.id, 'dp'); assert.equal(r.solution.slug, 'opus');

r = resolveActiveSelection(tasks, '#dp/gpt5');           // явные задача+модель
assert.equal(r.task.id, 'dp'); assert.equal(r.solution.slug, 'gpt5');

r = resolveActiveSelection(tasks, '#knight');            // только задача → её 1-е решение
assert.equal(r.task.id, 'knight'); assert.equal(r.solution.slug, 'opus');

r = resolveActiveSelection(tasks, '#dp/nope');           // неизвестная модель → 1-е решение задачи
assert.equal(r.task.id, 'dp'); assert.equal(r.solution.slug, 'opus');

r = resolveActiveSelection(tasks, '#zzz');               // неизвестная задача → 1-я задача
assert.equal(r.task.id, 'dp');

assert.equal(resolveActiveSelection([], '#x'), null);    // пустой реестр → null

console.log('Тесты маршрутизации оболочки пройдены.');
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node "E:/_Проекты/pet/visual-tests/assets/shell.test.js"`
Expected: FAIL — `Cannot find module './shell.js'`.

- [ ] **Step 3: Реализовать `shell.js`**

`assets/shell.js`:

```js
'use strict';
(function () {
  // Чистая маршрутизация. hash вида "#<taskId>" или "#<taskId>/<slug>".
  // Возвращает { task, solution } с дефолтами или null, если задач нет.
  function resolveActiveSelection(tasks, hash) {
    const raw = (hash || '').replace(/^#/, '');
    const slash = raw.indexOf('/');
    const taskId = slash === -1 ? raw : raw.slice(0, slash);
    const slug = slash === -1 ? '' : raw.slice(slash + 1);
    const task = tasks.find((t) => t.id === taskId) || tasks[0] || null;
    if (!task) return null;
    const solution = task.solutions.find((s) => s.slug === slug) || task.solutions[0] || null;
    return { task, solution };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { resolveActiveSelection };
    return;
  }

  const tasks = (typeof window !== 'undefined' && window.TASKS) || [];
  const listEl = document.getElementById('task-list');
  const switchEl = document.getElementById('model-switch');
  const frameEl = document.getElementById('stage');
  const labelEl = document.getElementById('frame-label');
  const promptEl = document.getElementById('prompt-text');

  function render() {
    const sel = resolveActiveSelection(tasks, location.hash);

    listEl.innerHTML = '';
    for (const t of tasks) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'task-link' + (sel && t.id === sel.task.id ? ' active' : '');
      a.href = '#' + t.id;
      const name = document.createElement('span');
      name.className = 'task-name';
      name.textContent = t.title;
      const tags = document.createElement('span');
      tags.className = 'task-tags';
      tags.textContent = (t.tags || []).join(' · ');
      a.appendChild(name);
      a.appendChild(tags);
      li.appendChild(a);
      listEl.appendChild(li);
    }

    switchEl.innerHTML = '';
    if (!sel) return;
    for (const s of sel.task.solutions) {
      const seg = document.createElement('a');
      seg.className = 'segment' + (s.slug === sel.solution.slug ? ' active' : '');
      seg.href = '#' + sel.task.id + '/' + s.slug;
      seg.textContent = s.model;
      switchEl.appendChild(seg);
    }
    frameEl.src = sel.solution.dir + 'index.html';
    labelEl.textContent = sel.solution.dir;
    promptEl.textContent = sel.task.prompt;
  }

  window.addEventListener('hashchange', render);
  render();
})();
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node "E:/_Проекты/pet/visual-tests/assets/shell.test.js"`
Expected: PASS — «Тесты маршрутизации оболочки пройдены.»

- [ ] **Step 5: Создать `manifest.js`**

`manifest.js`:

```js
window.TASKS = [
  {
    id: 'double-pendulum',
    title: 'Двойной маятник',
    tags: ['физика', 'canvas', 'хаос'],
    prompt: 'Отобрази в HTML5 физику двойного маятника: два стержня, два точечных груза на шарнирах, корректные уравнения движения и численное интегрирование, реальное время. Добавь затухающий след нижнего груза, управление пуском/паузой и сбросом, ползунки масс и длин, и режим «призрак» с крошечным отклонением начального угла для демонстрации чувствительности к начальным условиям (хаос).',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/double-pendulum/opus-4.8/' },
    ],
  },
];
```

- [ ] **Step 6: Создать `assets/shell.css` из эталона**

Скопировать содержимое блока `<style>…</style>` из `docs/superpowers/mockup-shell.html` в `assets/shell.css` (без тегов `<style>`). Затем применить ровно две правки:

1. Удалить правило `.pendulum-art { … }` (декоративный SVG в оболочке не нужен) и вместо него добавить правило для реального iframe:

```css
.frame {
  position: absolute;
  inset: 42px 0 0;
  width: 100%;
  height: calc(100% - 42px);
  border: 0;
  background: var(--panel-3);
  display: block;
}
```

2. В правиле `.prompt-panel summary` оставить `cursor: default;` как в эталоне — но добавить интерактивность спойлеру не требуется (нативный `<details>` уже работает); правку не делаем. (Пункт-напоминание: класс-имена в `shell.js` уже совпадают с эталоном — `task-link/task-name/task-tags/active`, `segments/segment/active`, `model-toolbar/model-label`, `viewer/iframe-chrome/frame-label`, `prompt-panel`.)

- [ ] **Step 7: Создать оболочку `index.html`**

`index.html`:

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>visual-tests — полигон визуальных задач</title>
  <link rel="stylesheet" href="assets/shell.css">
</head>
<body>
  <div class="app">
    <aside class="sidebar" aria-label="Список визуальных задач">
      <header class="brand">
        <h1 class="brand-title">visual-tests</h1>
        <div class="brand-subtitle">полигон визуальных задач</div>
      </header>
      <nav aria-label="Задачи">
        <ul class="task-list" id="task-list"></ul>
      </nav>
    </aside>
    <main class="main">
      <section class="model-toolbar" aria-label="Выбор модели">
        <div class="model-label">Модель:</div>
        <div class="segments" id="model-switch" role="tablist" aria-label="Модели"></div>
      </section>
      <section class="viewer" aria-label="Результат модели">
        <div class="iframe-chrome" aria-hidden="true">
          <span class="chrome-dot"></span>
          <span class="chrome-dot"></span>
          <span class="chrome-dot"></span>
        </div>
        <div class="frame-label" id="frame-label"></div>
        <iframe class="frame" id="stage" title="Решение модели"></iframe>
      </section>
      <details class="prompt-panel" id="prompt-box" open>
        <summary>Промпт задачи</summary>
        <pre id="prompt-text"></pre>
      </details>
    </main>
  </div>
  <script src="manifest.js"></script>
  <script src="assets/shell.js"></script>
</body>
</html>
```

- [ ] **Step 8: Проверить оболочку через Playwright MCP**

1. `browser_navigate` → `http://localhost:8000/index.html`
2. `browser_console_messages` → без ошибок (favicon — допустимо).
3. `browser_take_screenshot` (`.playwright-mcp/shell-1.png`): слева пункт «Двойной маятник» активен; вверху сегмент «Claude Opus 4.8» активен; в области просмотра внутри iframe крутится маятник; снизу спойлер с текстом промпта. Сверить вид с эталоном `mockup-shell.html`.
4. `browser_navigate` → `http://localhost:8000/index.html#double-pendulum/opus-4.8` — состояние то же (дип-линк работает).

Expected: визуально совпадает с эталоном, в iframe — живая демка, промпт виден.

- [ ] **Step 9: Коммит**

```bash
git -C "E:/_Проекты/pet/visual-tests" add index.html manifest.js assets/shell.js assets/shell.test.js assets/shell.css
git -C "E:/_Проекты/pet/visual-tests" commit -m "feat(shell): оболочка с переключателем моделей, iframe и спойлером промпта

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Документация проекта (CLAUDE.md + README.md)

**Files:**
- Create: `CLAUDE.md`
- Create: `README.md`

- [ ] **Step 1: Создать `CLAUDE.md`**

`CLAUDE.md`:

```markdown
# visual-tests — полигон визуальных задач

Полигон для сравнения визуальных возможностей разных LLM. Одной задаче дают
несколько моделей; их решения (самодостаточные HTML-демки) собраны в одну
витрину с переключателем моделей.

## Стек
Чистый статичный HTML/CSS/JS, **без сборки** (нет npm/Node/бандлера в рантайме).
Node используется только как dev-time раннер тестов (`node:assert`, без npm).

## Конвенции
- Задача = папка `demos/<task>/` + объект в `manifest.js` (с общим `prompt` и
  списком `solutions`).
- Решение модели = подпапка `demos/<task>/<model-slug>/index.html` +
  запись в `solutions[]` соответствующей задачи.
- Реестр `manifest.js` подключается как `<script>` (кладёт `window.TASKS`),
  а **не** через `fetch` — иначе сломается `file://`.
- Демки не используют ES-module-импорты и `fetch` локальных файлов
  (совместимость с `file://`).
- Тестируемая чистая логика — в dual-mode модулях: в браузере кладут API в
  глобал, в node экспортируют через `module.exports` (см. `pendulum.js`,
  `assets/shell.js`).

## Как смотреть
- Двойной клик по `index.html` (`file://`), либо
- `python -m http.server 8000` → `http://localhost:8000/index.html`
  (сервер нужен для Playwright-проверок).

## Как тестировать
- Чистая логика: `node demos/<task>/<model>/*.test.js`, `node assets/shell.test.js`.
- UI/canvas: Playwright MCP (навигация на localhost, скриншот, проверка консоли).

## Визуальный эталон оболочки
`docs/superpowers/mockup-shell.html` — утверждённый дизайн; `assets/shell.css`
выведен из него.
```

- [ ] **Step 2: Создать `README.md`**

`README.md`:

```markdown
# visual-tests

Полигон для сравнения визуальных решений разных LLM. Слева — список задач,
справа — переключатель моделей и результат выбранной модели в iframe, снизу —
исходный промпт.

## Запуск
Двойной клик по `index.html`, либо локальный сервер:

```
python -m http.server 8000
```
и открыть `http://localhost:8000/index.html`.

## Добавить решение
1. Положить самодостаточную демку в `demos/<task>/<model-slug>/index.html`.
2. Дописать запись в `solutions[]` нужной задачи в `manifest.js`.

## Добавить задачу
Создать `demos/<task>/…` и добавить объект задачи в `manifest.js`
(`id`, `title`, `tags`, `prompt`, `solutions`).

## Тесты
- `node demos/double-pendulum/opus-4.8/pendulum.test.js`
- `node assets/shell.test.js`
```

- [ ] **Step 3: Коммит**

```bash
git -C "E:/_Проекты/pet/visual-tests" add CLAUDE.md README.md
git -C "E:/_Проекты/pet/visual-tests" commit -m "docs: CLAUDE.md и README с конвенциями проекта

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Финальный push**

```bash
git -C "E:/_Проекты/pet/visual-tests" push
```

---

## Самопроверка плана (выполнена при написании)

- **Покрытие спеки:** стек/файл-режим → Task 4 + конвенции в коде; модель данных
  (solutions) → manifest.js + shell.js (Task 3); A (оболочка, переключатель,
  хеш, спойлер) → Task 3; B (структура, добавление) → структура файлов + Task 4;
  C (физика/RK4/рендер/призрак) → Task 1 + Task 2; D (CLAUDE.md) → Task 4;
  тестирование → node-тесты в Task 1/3 + Playwright в Task 2/3; визуальный эталон
  → Task 3 Step 6/8.
- **Без заглушек:** весь код приведён целиком; `shell.css` берётся из
  закоммиченного эталона с двумя явными правками (не заглушка — конкретный файл).
- **Согласованность типов:** `state {th1,th2,w1,w2}`, `params {m1,m2,L1,L2,g}`,
  `bobPositions→{x1,y1,x2,y2}`, `accelerations→{a1,a2}`,
  `resolveActiveSelection→{task,solution}|null`, `window.Pendulum`,
  `window.TASKS` — имена совпадают во всех задачах. Класс-имена разметки
  `shell.js` совпадают с CSS-эталоном.
```

