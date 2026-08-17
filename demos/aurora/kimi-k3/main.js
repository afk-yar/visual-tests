(() => {
  'use strict';

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');

  const ui = {
    intensity: document.getElementById('intensity'),
    speed: document.getElementById('speed'),
    meteors: document.getElementById('meteors'),
  };

  let W = 0;
  let H = 0;
  let DPR = 1;
  let horizon = 0;      // y-координата линии горизонта
  let waterH = 0;       // высота водной глади

  let stars = [];
  let ridgeFar = [];
  let ridgeNear = [];
  let refl = null;      // offscreen-холст для отражения
  let rctx = null;

  // ---------- утилиты ----------

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function hash(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  function noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return hash(i) * (1 - u) + hash(i + 1) * u;
  }

  function fbm(x) {
    return noise1(x) * 0.62 + noise1(x * 2.17 + 5.2) * 0.38;
  }

  // ---------- вертикальный спрайт-градиент ленты ----------

  function makeSprite(stops) {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    for (const [pos, col] of stops) grad.addColorStop(pos, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 256);
    return c;
  }

  const sprites = {
    green: makeSprite([
      [0.00, 'rgba(150, 90, 255, 0)'],
      [0.28, 'rgba(120, 110, 255, 0.045)'],
      [0.52, 'rgba(70, 225, 255, 0.10)'],
      [0.74, 'rgba(70, 255, 170, 0.34)'],
      [0.90, 'rgba(130, 255, 195, 0.72)'],
      [1.00, 'rgba(225, 255, 238, 0.92)'],
    ]),
    purple: makeSprite([
      [0.00, 'rgba(255, 120, 220, 0)'],
      [0.30, 'rgba(220, 110, 255, 0.07)'],
      [0.58, 'rgba(170, 100, 255, 0.16)'],
      [0.80, 'rgba(120, 190, 255, 0.30)'],
      [0.93, 'rgba(150, 240, 255, 0.60)'],
      [1.00, 'rgba(235, 250, 255, 0.80)'],
    ]),
    cyan: makeSprite([
      [0.00, 'rgba(90, 140, 255, 0)'],
      [0.32, 'rgba(90, 200, 255, 0.06)'],
      [0.60, 'rgba(60, 240, 230, 0.15)'],
      [0.82, 'rgba(90, 255, 210, 0.36)'],
      [0.94, 'rgba(160, 255, 225, 0.68)'],
      [1.00, 'rgba(230, 255, 245, 0.85)'],
    ]),
  };

  // Занавеси сияния: baseY/height — доли от высоты неба (horizon)
  const curtains = [
    { sprite: sprites.green,  baseY: 0.74, height: 0.62, speed: 1.00, phase: 0.0, seed: 1.3,  scale: 1.00, amp: 42, glow: 0.055 },
    { sprite: sprites.purple, baseY: 0.66, height: 0.52, speed: 0.72, phase: 2.1, seed: 7.9,  scale: 0.72, amp: 30, glow: 0.045 },
    { sprite: sprites.cyan,   baseY: 0.80, height: 0.44, speed: 1.28, phase: 4.4, seed: 13.7, scale: 1.45, amp: 26, glow: 0.040 },
    { sprite: sprites.green,  baseY: 0.58, height: 0.40, speed: 0.55, phase: 6.2, seed: 21.1, scale: 0.55, amp: 22, glow: 0.035 },
  ];

  // ---------- генерация статики при ресайзе ----------

  function buildStars() {
    stars = [];
    const count = Math.round((W * horizon) / 5200);
    for (let i = 0; i < count; i++) {
      const big = Math.random() < 0.06;
      stars.push({
        x: Math.random() * W,
        y: Math.random() * horizon * 0.96,
        r: big ? 1.1 + Math.random() * 1.1 : 0.3 + Math.random() * 0.9,
        phase: Math.random() * Math.PI * 2,
        tw: 0.4 + Math.random() * 2.2,
        big,
        warm: Math.random() < 0.18,
      });
    }
  }

  function buildRidges() {
    ridgeFar = [];
    ridgeNear = [];
    const step = 8;
    for (let x = 0; x <= W + step; x += step) {
      const n1 = fbm(x * 0.0016 + 40.0) * 0.7 + fbm(x * 0.006 + 90.0) * 0.3;
      const n2 = fbm(x * 0.003 + 200.0) * 0.65 + fbm(x * 0.011 + 300.0) * 0.35;
      ridgeFar.push([x, horizon - n1 * horizon * 0.34 - horizon * 0.02]);
      ridgeNear.push([x, horizon - n2 * horizon * 0.16]);
    }
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(window.innerWidth));
    H = Math.max(1, Math.round(window.innerHeight));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    horizon = Math.round(H * 0.62);
    waterH = H - horizon;
    refl = document.createElement('canvas');
    refl.width = Math.max(1, Math.round(W * DPR));
    refl.height = Math.max(1, Math.round(waterH * DPR));
    rctx = refl.getContext('2d');
    rctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildStars();
    buildRidges();
  }

  // ---------- форма занавеса ----------

  function edgeY(c, x, t) {
    const s1 = Math.sin(x * 0.0016 * c.scale + t * 0.34 + c.phase);
    const s2 = Math.sin(x * 0.0043 * c.scale - t * 0.21 + c.phase * 2.7);
    const n = fbm(x * 0.0022 * c.scale + t * 0.06 + c.seed);
    return c.baseY * horizon + s1 * c.amp + s2 * c.amp * 0.45 + (n - 0.5) * c.amp * 1.7;
  }

  function curtainHeight(c, x, t) {
    const n = fbm(x * 0.0031 * c.scale + t * 0.12 + c.seed * 7.0);
    const s = 0.5 + 0.5 * Math.sin(x * 0.0009 * c.scale + t * 0.16 + c.phase);
    return c.height * horizon * (0.45 + 0.55 * n) * (0.75 + 0.5 * s);
  }

  function rayIntensity(c, x, t) {
    const n = fbm(x * 0.016 * c.scale - t * 0.30 + c.seed * 3.0);
    const r = Math.pow(clamp(n * 1.5 - 0.25, 0, 1), 3.2);
    return r * 2.4;
  }

  // ---------- отрисовка ----------

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0.0, '#010109');
    g.addColorStop(0.45, '#050a22');
    g.addColorStop(0.8, '#0b1638');
    g.addColorStop(1.0, '#12224a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizon + 1);

    // слабое свечение у горизонта
    const hg = ctx.createRadialGradient(W * 0.5, horizon, 0, W * 0.5, horizon, W * 0.55);
    hg.addColorStop(0, 'rgba(70, 110, 190, 0.14)');
    hg.addColorStop(1, 'rgba(70, 110, 190, 0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, W, horizon + 1);
  }

  function drawStars(time) {
    ctx.save();
    for (const s of stars) {
      const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(time * s.tw + s.phase));
      ctx.globalAlpha = a * (s.big ? 1 : 0.8);
      ctx.fillStyle = s.warm ? '#ffe9c8' : '#dfe9ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      if (s.big) {
        ctx.globalAlpha = a * 0.35;
        ctx.fillRect(s.x - s.r * 4, s.y - 0.5, s.r * 8, 1);
        ctx.fillRect(s.x - 0.5, s.y - s.r * 4, 1, s.r * 8);
      }
    }
    ctx.restore();
  }

  const meteors = [];
  let nextMeteor = 2.5;

  function drawMeteors(time, dt) {
    if (ui.meteors.checked && time > nextMeteor) {
      nextMeteor = time + 3 + Math.random() * 7;
      meteors.push({
        x: W * (0.15 + Math.random() * 0.7),
        y: horizon * (0.05 + Math.random() * 0.3),
        vx: (Math.random() < 0.5 ? -1 : 1) * (260 + Math.random() * 320),
        vy: 140 + Math.random() * 160,
        life: 0,
        ttl: 0.7 + Math.random() * 0.5,
      });
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.life += dt;
      if (m.life > m.ttl) { meteors.splice(i, 1); continue; }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const k = 1 - m.life / m.ttl;
      const tx = m.x - m.vx * 0.12;
      const ty = m.y - m.vy * 0.12;
      const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, 'rgba(255,255,255,' + (0.9 * k) + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
  }

  function drawAurora(time, intensity) {
    const step = Math.max(3, Math.round(W / 520));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const c of curtains) {
      const t = time * c.speed;
      const pulse = 0.7 + 0.3 * Math.sin(t * 0.45 + c.phase * 1.3);

      // широкое атмосферное свечение за занавесом
      const cx = W * (0.5 + 0.22 * Math.sin(c.phase + t * 0.05));
      const cy = c.baseY * horizon - c.height * horizon * 0.35;
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.42);
      gr.addColorStop(0, 'rgba(70, 255, 180, ' + (c.glow * pulse * intensity) + ')');
      gr.addColorStop(1, 'rgba(70, 255, 180, 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, horizon);

      for (let x = 0; x <= W; x += step) {
        const bottom = edgeY(c, x, t);
        const hgt = curtainHeight(c, x, t);
        const ray = rayIntensity(c, x, t);
        const body = 0.06 + 0.10 * fbm(x * 0.004 * c.scale + t * 0.1 + c.seed);
        const a = clamp((body + ray) * pulse * intensity, 0, 1);
        if (a < 0.004) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(c.sprite, x - 1, bottom - hgt, step + 2, hgt);
      }
    }
    ctx.restore();
  }

  function traceRidge(points) {
    ctx.beginPath();
    ctx.moveTo(-4, horizon + 2);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(W + 4, horizon + 2);
    ctx.closePath();
  }

  function drawLandscape() {
    // дальний хребет
    traceRidge(ridgeFar);
    ctx.fillStyle = '#0a1226';
    ctx.fill();

    // ближний хребет
    traceRidge(ridgeNear);
    ctx.fillStyle = '#04070f';
    ctx.fill();

    // холодный отблеск сияния на гребне ближнего хребта
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    for (let i = 0; i < ridgeNear.length; i++) {
      const [x, y] = ridgeNear[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(110, 255, 190, 0.05)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawWater(time, intensity) {
    // тёмная вода
    const g = ctx.createLinearGradient(0, horizon, 0, H);
    g.addColorStop(0, '#081226');
    g.addColorStop(0.4, '#040a18');
    g.addColorStop(1, '#02040c');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, W, waterH);

    // отражение: зеркалим верхнюю часть кадра во временный холст
    rctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    rctx.globalCompositeOperation = 'source-over';
    rctx.globalAlpha = 1;
    rctx.clearRect(0, 0, W, waterH);
    const srcH = Math.min(waterH, horizon);
    rctx.save();
    rctx.setTransform(DPR, 0, 0, -DPR, 0, waterH * DPR);
    rctx.drawImage(
      canvas,
      0, (horizon - srcH) * DPR, W * DPR, srcH * DPR,
      0, waterH - srcH, W, srcH
    );
    rctx.restore();

    // затухание отражения к низу
    rctx.globalCompositeOperation = 'destination-in';
    const fade = rctx.createLinearGradient(0, 0, 0, waterH);
    fade.addColorStop(0, 'rgba(0,0,0,0.6)');
    fade.addColorStop(0.5, 'rgba(0,0,0,0.28)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    rctx.fillStyle = fade;
    rctx.fillRect(0, 0, W, waterH);

    // переносим на основной холст полосами с рябью
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85 * clamp(intensity, 0.5, 1.3);
    const slice = 4;
    for (let y = 0; y < waterH; y += slice) {
      const depth = y / waterH;
      const off = Math.sin(y * 0.11 + time * 1.9) * (1 + depth * 5)
                + Math.sin(y * 0.031 - time * 0.8) * depth * 4;
      ctx.drawImage(
        refl,
        0, y * DPR, W * DPR, slice * DPR,
        off, horizon + y, W, slice
      );
    }
    ctx.restore();

    // движущиеся блики-полосы на воде
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const y = horizon + waterH * (0.2 + 0.3 * i) + Math.sin(time * (0.5 + i * 0.23) + i * 2.4) * 8;
      const gg = ctx.createLinearGradient(0, y - 3, 0, y + 3);
      gg.addColorStop(0, 'rgba(120, 220, 255, 0)');
      gg.addColorStop(0.5, 'rgba(120, 220, 255, ' + (0.035 - i * 0.008) * intensity + ')');
      gg.addColorStop(1, 'rgba(120, 220, 255, 0)');
      ctx.fillStyle = gg;
      ctx.fillRect(0, y - 3, W, 6);
    }
    ctx.restore();

    // линия берега
    ctx.fillStyle = 'rgba(2, 4, 10, 0.9)';
    ctx.fillRect(0, horizon - 1, W, 2);
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(
      W * 0.5, H * 0.45, Math.min(W, H) * 0.35,
      W * 0.5, H * 0.5, Math.max(W, H) * 0.75
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- главный цикл ----------

  let time = 0;
  let last = performance.now();

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = clamp(dt, 0, 0.05);
    time += dt * parseFloat(ui.speed.value);

    const intensity = parseFloat(ui.intensity.value);

    drawSky();
    drawStars(time);
    drawMeteors(time, dt);
    drawAurora(time, intensity);
    drawLandscape();
    drawWater(time, intensity);
    drawVignette();

    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
