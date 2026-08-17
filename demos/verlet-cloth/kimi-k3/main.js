'use strict';

(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');

  const windSlider = document.getElementById('wind');
  const gravSlider = document.getElementById('grav');
  const resetBtn = document.getElementById('reset');

  // --- View / DPR ---
  let vw = 0, vh = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build(); // перестраиваем ткань под новый размер
  }

  // --- Cloth state ---
  const SPACING = 14;          // px между частицами
  const ITERATIONS = 3;        // проходы релаксации констрейнтов
  const TEAR_FACTOR = 3.2;     // разрыв при растяжении связи > TEAR_FACTOR * rest
  const DAMPING = 0.985;

  let pts = [];      // {x, y, px, py, pin}
  let cons = [];     // {a, b, rest, alive}
  let cols = 0, rows = 0, originX = 0, originY = 0;

  function idx(cx, cy) { return cy * cols + cx; }

  function build() {
    pts.length = 0;
    cons.length = 0;

    cols = Math.max(8, Math.floor(vw * 0.72 / SPACING));
    rows = Math.max(8, Math.floor(vh * 0.5 / SPACING));

    originX = (vw - (cols - 1) * SPACING) / 2;
    originY = Math.max(40, vh * 0.09);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = originX + x * SPACING;
        const py = originY + y * SPACING;
        pts.push({ x: px, y: py, px, py, pin: false });
      }
    }

    // закрепляем верхний край в нескольких точках
    const pinCount = Math.max(3, Math.floor(cols / 8));
    for (let i = 0; i < pinCount; i++) {
      const x = Math.round((cols - 1) * (i / (pinCount - 1)));
      pts[idx(x, 0)].pin = true;
    }

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (x < cols - 1) cons.push({ a: idx(x, y), b: idx(x + 1, y), rest: SPACING, alive: true });
        if (y < rows - 1) cons.push({ a: idx(x, y), b: idx(x, y + 1), rest: SPACING, alive: true });
      }
    }
  }

  // --- Input: grab & drag ---
  let mouseX = 0, mouseY = 0;
  let grabbed = -1;
  const GRAB_RADIUS = 26;

  function toLocal(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  canvas.addEventListener('pointerdown', (e) => {
    [mouseX, mouseY] = toLocal(e);
    let best = -1, bestD = GRAB_RADIUS * GRAB_RADIUS;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].pin) continue;
      const dx = pts[i].x - mouseX, dy = pts[i].y - mouseY;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      grabbed = best;
      canvas.classList.add('grabbing');
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    [mouseX, mouseY] = toLocal(e);
  });

  function release() {
    grabbed = -1;
    canvas.classList.remove('grabbing');
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  resetBtn.addEventListener('click', build);

  // --- Physics ---
  let time = 0;

  function step(dt) {
    time += dt;
    const windAmt = parseFloat(windSlider.value);
    const gravAmt = parseFloat(gravSlider.value);

    const g = 900 * gravAmt; // px/s^2
    // лёгкий переменный ветер: сумма синусов по времени и высоте
    const windBase = windAmt * 260;

    const dt2 = dt * dt;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.pin) continue;
      if (i === grabbed) {
        p.x = p.px = mouseX;
        p.y = p.py = mouseY;
        continue;
      }
      const w = windBase * (0.55 + 0.45 * Math.sin(time * 0.9 + p.y * 0.008)
                            + 0.3 * Math.sin(time * 2.3 + p.x * 0.005));
      const vx = (p.x - p.px) * DAMPING;
      const vy = (p.y - p.py) * DAMPING;
      p.px = p.x;
      p.py = p.y;
      p.x += vx + w * dt2;
      p.y += vy + g * dt2;
    }

    // релаксация констрейнтов + разрыв
    for (let it = 0; it < ITERATIONS; it++) {
      for (let i = 0; i < cons.length; i++) {
        const c = cons[i];
        if (!c.alive) continue;
        const a = pts[c.a], b = pts[c.b];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d === 0) d = 1e-6;
        if (d > c.rest * TEAR_FACTOR) { c.alive = false; continue; }
        const diff = (d - c.rest) / d;
        const aFixed = a.pin || c.a === grabbed;
        const bFixed = b.pin || c.b === grabbed;
        if (aFixed && bFixed) continue;
        const k = 0.5 * diff;
        if (aFixed) {
          b.x -= dx * diff; b.y -= dy * diff;
        } else if (bFixed) {
          a.x += dx * diff; a.y += dy * diff;
        } else {
          a.x += dx * k; a.y += dy * k;
          b.x -= dx * k; b.y -= dy * k;
        }
      }
    }
  }

  // --- Render ---
  const BG_TOP = '#0b0e14', BG_BOT = '#141b2b';

  function draw() {
    const grad = ctx.createLinearGradient(0, 0, 0, vh);
    grad.addColorStop(0, BG_TOP);
    grad.addColorStop(1, BG_BOT);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, vh);

    // связи, оттенок зависит от растяжения
    ctx.lineWidth = 1;
    for (let i = 0; i < cons.length; i++) {
      const c = cons[i];
      if (!c.alive) continue;
      const a = pts[c.a], b = pts[c.b];
      const dx = b.x - a.x, dy = b.y - a.y;
      const stretch = Math.sqrt(dx * dx + dy * dy) / c.rest; // 1 = покой
      const t = Math.min(1, Math.max(0, (stretch - 0.8) / (TEAR_FACTOR - 0.8)));
      // от спокойного сине-серого к тревожному красному
      const r = Math.round(96 + t * 159);
      const gch = Math.round(140 - t * 60);
      const bl = Math.round(220 - t * 140);
      ctx.strokeStyle = `rgba(${r},${gch},${bl},0.9)`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // закреплённые точки
    ctx.fillStyle = '#ffd166';
    for (let i = 0; i < cols; i++) {
      if (pts[i].pin) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // маркер захваченной точки
    if (grabbed >= 0) {
      const p = pts[grabbed];
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // --- Loop ---
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 1 / 30) dt = 1 / 30; // кламп большого dt
    if (dt > 0) {
      // физика с фиксированным подшагом для стабильности
      const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / sub;
      for (let s = 0; s < sub; s++) step(h);
    }
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
