'use strict';
(function () {
  const { step, neighbors, buildGrid, torusDelta } = window.Boids;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const hud = document.getElementById('hud');
  const els = {
    reset: document.getElementById('reset'),
    highlight: document.getElementById('highlight'),
    sep: document.getElementById('sep'),
    ali: document.getElementById('ali'),
    coh: document.getElementById('coh'),
    perception: document.getElementById('perception'),
    maxSpeed: document.getElementById('maxSpeed'),
    count: document.getElementById('count'),
  };
  const SLIDERS = ['sep', 'ali', 'coh', 'perception', 'maxSpeed', 'count'];

  // Логический мир в CSS-пикселях канваса (он же тороидальный домен).
  let world = { w: 800, h: 600 };
  let boids = [];
  let params = readParams();
  let highlightOn = true;
  let highlightIdx = 0;
  let lastT = null;
  // Сглаженный FPS для HUD.
  let fps = 0;

  function readParams() {
    return {
      sep: parseFloat(els.sep.value),
      ali: parseFloat(els.ali.value),
      coh: parseFloat(els.coh.value),
      perception: parseFloat(els.perception.value),
      maxSpeed: parseFloat(els.maxSpeed.value),
      w: world.w,
      h: world.h,
    };
  }

  function syncOutputs() {
    for (const id of SLIDERS) {
      const out = document.getElementById(id + 'v');
      if (out) out.textContent = els[id].value;
    }
  }

  // Случайная скорость заданного модуля в произвольном направлении.
  function randomVel(speed) {
    const a = Math.random() * Math.PI * 2;
    return { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
  }

  function spawn(n) {
    const sp = params.maxSpeed * 0.6;
    const arr = [];
    for (let i = 0; i < n; i++) {
      const v = randomVel(sp);
      arr.push({ x: Math.random() * world.w, y: Math.random() * world.h, vx: v.vx, vy: v.vy });
    }
    boids = arr;
    highlightIdx = 0;
  }

  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    world.w = Math.max(1, Math.round(rect.width));
    world.h = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(world.w * dpr);
    canvas.height = Math.round(world.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    params.w = world.w;
    params.h = world.h;
    // Удержим уже живущих агентов внутри нового домена.
    for (const b of boids) {
      b.x = ((b.x % world.w) + world.w) % world.w;
      b.y = ((b.y % world.h) + world.h) % world.h;
    }
  }
  window.addEventListener('resize', fitCanvas);

  els.reset.addEventListener('click', () => spawn(parseInt(els.count.value, 10)));
  els.highlight.addEventListener('click', () => {
    highlightOn = !highlightOn;
    els.highlight.classList.toggle('on', highlightOn);
  });
  for (const id of ['sep', 'ali', 'coh', 'perception', 'maxSpeed']) {
    els[id].addEventListener('input', () => { params = readParams(); syncOutputs(); });
  }
  els.count.addEventListener('input', () => {
    syncOutputs();
    const target = parseInt(els.count.value, 10);
    if (target > boids.length) {
      const sp = params.maxSpeed * 0.6;
      while (boids.length < target) {
        const v = randomVel(sp);
        boids.push({ x: Math.random() * world.w, y: Math.random() * world.h, vx: v.vx, vy: v.vy });
      }
    } else if (target < boids.length) {
      boids.length = target;
      if (highlightIdx >= boids.length) highlightIdx = 0;
    }
  });
  // Клик по холсту переносит подсветку на ближайшего агента.
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < boids.length; i++) {
      const dx = torusDelta(boids[i].x, mx, world.w);
      const dy = torusDelta(boids[i].y, my, world.h);
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) highlightIdx = best;
  });

  // Треугольник-агент, ориентированный по вектору скорости.
  function drawBoid(b, size, fill) {
    const ang = Math.atan2(b.vy, b.vx);
    const cos = Math.cos(ang), sin = Math.sin(ang);
    ctx.beginPath();
    ctx.moveTo(b.x + cos * size, b.y + sin * size);
    ctx.lineTo(b.x + cos * -size * 0.6 - sin * size * 0.55, b.y + sin * -size * 0.6 + cos * size * 0.55);
    ctx.lineTo(b.x + cos * -size * 0.6 + sin * size * 0.55, b.y + sin * -size * 0.6 - cos * size * 0.55);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // Линия между двумя точками по кратчайшему тороидальному пути (через край,
  // если он короче) — иначе связь к соседу за краем рисуется через весь экран.
  function torusLine(ax, ay, bx, by) {
    const dx = torusDelta(ax, bx, world.w);
    const dy = torusDelta(ay, by, world.h);
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + dx, ay + dy);
  }

  function draw() {
    ctx.clearRect(0, 0, world.w, world.h);

    // Подсветка: радиус восприятия и видимые соседи рисуем ПОД стаей.
    let seen = [];
    if (highlightOn && boids.length) {
      const h = boids[highlightIdx];
      const grid = buildGrid(boids, Math.max(params.perception, 8), world.w, world.h);
      seen = neighbors(highlightIdx, boids, grid, params.perception);

      // Круг восприятия. Рисуем со сдвигами по тору, чтобы у края
      // он показывался завёрнутым (как его реально «видит» агент).
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(55,198,217,0.55)';
      ctx.fillStyle = 'rgba(55,198,217,0.07)';
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          ctx.beginPath();
          ctx.arc(h.x + ox * world.w, h.y + oy * world.h, params.perception, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      // Связи к видимым соседям (по кратчайшему пути).
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(55,198,217,0.35)';
      ctx.beginPath();
      for (let k = 0; k < seen.length; k++) {
        const o = boids[seen[k]];
        torusLine(h.x, h.y, o.x, o.y);
      }
      ctx.stroke();
    }

    // Множество видимых соседей — для подкраски (Set из индексов).
    const seenSet = highlightOn ? new Set(seen) : null;

    // Сама стая.
    for (let i = 0; i < boids.length; i++) {
      if (highlightOn && i === highlightIdx) continue; // подсвеченного — поверх всех
      const seenNow = seenSet && seenSet.has(i);
      drawBoid(boids[i], seenNow ? 6 : 4.5, seenNow ? '#9fe9f2' : '#aeb8c7');
    }
    if (highlightOn && boids.length) {
      const h = boids[highlightIdx];
      drawBoid(h, 8, '#37c6d9');
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1f6f7d';
      ctx.beginPath();
      ctx.arc(h.x, h.y, 11, 0, Math.PI * 2);
      ctx.stroke();
    }

    hud.innerHTML =
      'агентов: <b>' + boids.length + '</b>   fps: <b>' + Math.round(fps) + '</b>\n' +
      (highlightOn
        ? 'подсвечен #' + highlightIdx + ' видит соседей: <b>' + seen.length + '</b>'
        : 'подсветка выключена');
  }

  function frame(t) {
    if (lastT == null) lastT = t;
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.05) dt = 0.05;       // не отыгрываем большие провалы кадров
    if (dt > 0) {
      fps = fps ? fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;
      step(boids, params, dt);
    }
    draw();
    requestAnimationFrame(frame);
  }

  fitCanvas();
  syncOutputs();
  spawn(parseInt(els.count.value, 10));
  requestAnimationFrame(frame);
})();
