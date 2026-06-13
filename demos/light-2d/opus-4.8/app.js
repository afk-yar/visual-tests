'use strict';
(function () {
  const { computeVisibility, polygonsToSegments, collectVertices } = window.Visibility;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const debugEl = document.getElementById('debug');
  const hintEl = document.querySelector('.panel .hint');

  // Логические размеры сцены (CSS-пиксели). Обновляются при ресайзе.
  let W = 0, H = 0;

  // Источник света — следует за курсором. Старт по центру.
  const light = { x: 0, y: 0 };

  let debug = false;
  let obstacles = [];   // массив полигонов; каждый — массив {x,y}
  let bounds = null;    // рамка-периметр сцены

  // --- Построение сцены: рамка + набор многоугольников-препятствий ---------
  function buildScene() {
    bounds = { minX: 0, minY: 0, maxX: W, maxY: H };
    const u = Math.min(W, H);

    // Препятствия в долях экрана, чтобы сцена масштабировалась.
    const defs = [
      // треугольник
      [[0.16, 0.30], [0.30, 0.22], [0.27, 0.46]],
      // прямоугольник под наклоном (через 4 вершины)
      [[0.62, 0.16], [0.80, 0.22], [0.76, 0.36], [0.58, 0.30]],
      // L-образный (вогнутый) полигон
      [[0.44, 0.58], [0.60, 0.58], [0.60, 0.66], [0.52, 0.66],
       [0.52, 0.84], [0.44, 0.84]],
      // шестиугольник
      hexagon(0.82, 0.70, 0.10),
      // маленький ромб
      [[0.20, 0.74], [0.28, 0.68], [0.36, 0.74], [0.28, 0.80]],
    ];

    obstacles = defs.map((poly) => poly.map(([fx, fy]) => ({
      x: fx * W,
      y: fy * H,
    })));
  }

  function hexagon(cx, cy, r) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + i * Math.PI / 3;
      pts.push([cx + Math.cos(a) * r * (H / W), cy + Math.sin(a) * r]);
    }
    return pts;
  }

  // --- Канвас / DPR ---------------------------------------------------------
  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (light.x === 0 && light.y === 0) { light.x = W / 2; light.y = H / 2; }
    buildScene();
  }
  window.addEventListener('resize', fitCanvas);

  // --- Ввод -----------------------------------------------------------------
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    light.x = clamp(e.clientX - rect.left, bounds.minX + 0.5, bounds.maxX - 0.5);
    light.y = clamp(e.clientY - rect.top, bounds.minY + 0.5, bounds.maxY - 0.5);
  });
  debugEl.addEventListener('change', () => { debug = debugEl.checked; });

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // --- Рендер ---------------------------------------------------------------
  function draw() {
    // Фон-сцена.
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, W, H);

    // Полигон видимости из положения источника.
    const poly = computeVisibility(light, obstacles, bounds, 1e-4);

    // 1) Освещённая область: clip по полигону видимости + радиальный градиент.
    if (poly.length >= 3) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.clip();

      const reach = Math.hypot(W, H);
      const grad = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, reach * 0.75);
      grad.addColorStop(0.00, 'rgba(255, 244, 214, 0.95)');
      grad.addColorStop(0.12, 'rgba(255, 214, 150, 0.72)');
      grad.addColorStop(0.34, 'rgba(247, 170, 96, 0.34)');
      grad.addColorStop(0.62, 'rgba(210, 120, 70, 0.12)');
      grad.addColorStop(1.00, 'rgba(120, 70, 50, 0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // 2) Препятствия — светлые полигоны поверх тьмы (и поверх заливки).
    drawObstacles();

    // 3) Мягкое свечение вокруг источника (additive).
    drawGlow();

    // 4) Отладка: лучи и вершины.
    if (debug) drawDebug(poly);

    // 5) Сам источник.
    drawSource();

    requestAnimationFrame(draw);
  }

  function drawObstacles() {
    ctx.lineJoin = 'round';
    for (const poly of obstacles) {
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fillStyle = '#262b34';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#3a4453';
      ctx.stroke();
    }
  }

  function drawGlow() {
    const r = Math.min(W, H) * 0.18;
    const g = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, r);
    g.addColorStop(0, 'rgba(255, 248, 224, 0.55)');
    g.addColorStop(0.4, 'rgba(255, 224, 170, 0.22)');
    g.addColorStop(1, 'rgba(255, 224, 170, 0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(light.x, light.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSource() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255, 252, 240, 0.95)';
    ctx.beginPath();
    ctx.arc(light.x, light.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 240, 200, 0.5)';
    ctx.beginPath();
    ctx.arc(light.x, light.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawDebug(poly) {
    // Лучи источник → вершины контура.
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(55, 198, 217, 0.32)';
    ctx.beginPath();
    for (const p of poly) {
      ctx.moveTo(light.x, light.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // Контур полигона видимости.
    if (poly.length >= 2) {
      ctx.strokeStyle = 'rgba(55, 198, 217, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.stroke();
    }

    // Вершины препятствий (цели лучей).
    ctx.fillStyle = '#37c6d9';
    for (const v of collectVertices(obstacles)) {
      ctx.beginPath();
      ctx.arc(v.x, v.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Точки контура (попадания лучей).
    ctx.fillStyle = 'rgba(255, 224, 170, 0.9)';
    for (const p of poly) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Старт ----------------------------------------------------------------
  fitCanvas();
  // Подсказка о числе лучей (3 на вершину, включая углы рамки).
  const rayCount = (collectVertices(obstacles).length + 4) * 3;
  if (hintEl) hintEl.textContent = `Свет следует за курсором · ${rayCount} лучей`;
  requestAnimationFrame(draw);
})();
