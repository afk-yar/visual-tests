'use strict';
(function () {
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');

  const TAU = Math.PI * 2;
  let W = 0, H = 0, DPR = 1;
  let sandTop = 0;      // y, где начинается песок (условно)
  let sandRegionY = 0;  // верх оффскрин-буфера песка (чуть выше кромки)
  let unit = 1;         // масштаб от размера окна

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // ---------------- состояние ----------------
  const state = {
    timeScale: 1,
    bubbleRate: 1,
    raysOn: true,
    causticsOn: true,
    fishTarget: 26,
  };

  let fishes = [];
  let bubbles = [];
  let plants = [];
  let motes = [];
  let hazeBlobs = [];
  let rays = [];
  let bubbleAcc = 0;
  let frameNo = 0;
  const school = { x: 0, y: 0 }; // блуждающая цель стайки неонов

  // ---------------- оффскрины ----------------
  const sandCanvas = document.createElement('canvas');
  const sandCtx = sandCanvas.getContext('2d');
  const causCanvas = document.createElement('canvas');
  const causCtx = causCanvas.getContext('2d');
  let causW = 0, causH = 0, causImg = null;
  let waterGrad = null, vignGrad = null;

  // ---------------- виды рыб ----------------
  const SPECIES = [
    {
      key: 'neon', share: 0.46, school: true,
      size: [18, 25], heightRatio: 0.17, speed: [55, 80], turn: 1.7,
      depth: [0.28, 0.60], amp: 0.10, wave: 4.6, tailLen: 0.30, tail: 'fork',
      colors: { top: '#2e6f9e', mid: '#7fb6c9', bottom: '#e3edef', fin: 'rgba(215,240,246,0.55)' },
      deco: 'neon',
    },
    {
      key: 'guppy', share: 0.24, school: false,
      size: [22, 30], heightRatio: 0.21, speed: [42, 66], turn: 1.4,
      depth: [0.16, 0.45], amp: 0.09, wave: 4.9, tailLen: 0.55, tail: 'fan',
      colors: { top: '#7d8f4e', mid: '#b9b071', bottom: '#e7ddb8', fin: 'rgba(255,122,40,0.72)' },
      deco: 'spots',
    },
    {
      key: 'gold', share: 0.17, school: false,
      size: [34, 46], heightRatio: 0.30, speed: [30, 50], turn: 1.1,
      depth: [0.42, 0.74], amp: 0.085, wave: 4.2, tailLen: 0.50, tail: 'fan',
      colors: { top: '#e97b1d', mid: '#ffb84d', bottom: '#ffe1a1', fin: 'rgba(255,150,50,0.60)' },
      deco: 'none',
    },
    {
      key: 'scalar', share: 0.13, school: false,
      size: [52, 66], heightRatio: 0.55, speed: [20, 34], turn: 0.8,
      depth: [0.22, 0.58], amp: 0.06, wave: 3.8, tailLen: 0.34, tail: 'delta',
      profStart: 0.06, profSpan: 0.94, profPow: 0.60,
      colors: { top: '#8d97a3', mid: '#c9cdd4', bottom: '#eef1f4', fin: 'rgba(210,220,228,0.55)' },
      deco: 'bars',
    },
  ];

  // ---------------- рыбы ----------------
  function makeFish(sp) {
    const size = rand(sp.size[0], sp.size[1]) * unit;
    const y = H * rand(sp.depth[0], sp.depth[1]);
    const f = {
      sp: sp,
      size: size,
      maxH: size * sp.heightRatio,
      amp: size * sp.amp,
      x: rand(W * 0.15, W * 0.85),
      y: y,
      vx: rand(-1, 1), vy: rand(-0.2, 0.2),
      theta: rand(0, TAU),
      speed: rand(sp.speed[0], sp.speed[1]) * unit,
      turn: sp.turn,
      phase: rand(0, TAU),
      p1: rand(0, TAU), p2: rand(0, TAU),
      w1: rand(0.4, 0.9), w2: rand(1.1, 2.0),
      yBase: y, yRange: H * 0.06,
      offA: rand(0, TAU), offR: rand(18, 70) * unit,
    };
    const l = Math.hypot(f.vx, f.vy) || 1;
    f.vx = f.vx / l * f.speed;
    f.vy = f.vy / l * f.speed;
    return f;
  }

  function rebuildFish() {
    const n = state.fishTarget;
    fishes = [];
    for (const sp of SPECIES) {
      let c = Math.round(n * sp.share);
      if (sp.key === 'neon') c = Math.max(4, c);
      if (sp.key === 'gold') c = Math.max(1, c);
      if (sp.key === 'scalar') c = clamp(c, 1, 4);
      for (let i = 0; i < c; i++) fishes.push(makeFish(sp));
    }
    fishes.sort(function (a, b) { return b.size - a.size; }); // крупные — позади
  }

  function updateSchool(t) {
    school.x = W * 0.5 + Math.sin(t * 0.11) * W * 0.30 + Math.sin(t * 0.043 + 2) * W * 0.10;
    school.y = H * 0.42 + Math.sin(t * 0.09 + 1) * H * 0.16;
  }

  function updateFish(f, dt, t) {
    const sp = f.sp;
    const wob = Math.sin(t * f.w1 + f.p1) + 0.6 * Math.sin(t * f.w2 + f.p2);
    let ax = Math.cos(f.theta + Math.PI / 2) * wob * f.turn * f.speed;
    let ay = Math.sin(f.theta + Math.PI / 2) * wob * f.turn * f.speed;

    // тяга к любимой глубине
    const yPref = f.yBase + Math.sin(t * 0.23 + f.p1) * f.yRange;
    ay += (yPref - f.y) * 0.9;

    // стайка: тянемся к общей блуждающей цели со своим смещением
    if (sp.school) {
      const tx = school.x + Math.cos(f.offA + t * 0.12) * f.offR;
      const ty = school.y + Math.sin(f.offA + t * 0.12) * f.offR * 0.5;
      ax += (tx - f.x) * 1.5;
      ay += (ty - f.y) * 1.5;
    }

    // разворот у стенок
    const mx = f.size * 1.6 + 30;
    const mTop = f.maxH + 26;
    const mBot = sandRegionY + 8;
    if (f.x < mx) ax += (mx - f.x) * 3.0;
    else if (f.x > W - mx) ax -= (f.x - (W - mx)) * 3.0;
    if (f.y < mTop) ay += (mTop - f.y) * 3.0;
    else if (f.y > mBot) ay -= (f.y - mBot) * 3.0;

    f.vx += ax * dt;
    f.vy += ay * dt;
    const len = Math.hypot(f.vx, f.vy) || 1;
    const k = 1 + (f.speed / len - 1) * Math.min(1, dt * 2.5);
    f.vx *= k;
    f.vy *= k;
    f.x = clamp(f.x + f.vx * dt, 4, W - 4);
    f.y = clamp(f.y + f.vy * dt, 4, H - 4);

    const targetTheta = Math.atan2(f.vy, f.vx);
    let d = targetTheta - f.theta;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    f.theta += d * Math.min(1, dt * 6);

    const spNorm = Math.hypot(f.vx, f.vy) / f.speed;
    f.phase += dt * (5.5 + 4.5 * spNorm) * (sp.school ? 1.3 : 1);
  }

  function spineY(f, tt) {
    return f.amp * tt * Math.sin(f.phase - tt * f.sp.wave);
  }

  function drawFish(f) {
    const sp = f.sp;
    const L = f.size, M = f.maxH;
    const N = 16;
    const profStart = sp.profStart || 0.10;
    const profSpan = sp.profSpan || 0.90;
    const profPow = sp.profPow || 0.85;

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.theta);
    if (Math.cos(f.theta) < 0) ctx.scale(1, -1); // спинка всегда сверху

    const top = [], bot = [];
    for (let i = 0; i <= N; i++) {
      const tt = i / N;
      const x = L * 0.5 - tt * L;
      const yc = spineY(f, tt);
      const pr = Math.sin(Math.PI * Math.min(1, profStart + tt * profSpan));
      const h = M * Math.pow(Math.max(0.0001, pr), profPow);
      top.push([x, yc - h]);
      bot.push([x, yc + h]);
    }

    const tailX = -L * 0.5;
    const tailY = spineY(f, 1);
    const swing = Math.sin(f.phase - sp.wave) * 0.85;
    const TL = L * sp.tailLen;

    ctx.fillStyle = sp.colors.fin;

    // нити скалярии (позади тела)
    if (sp.deco === 'bars') {
      ctx.strokeStyle = sp.colors.fin;
      ctx.lineWidth = Math.max(1, L * 0.018);
      ctx.lineCap = 'round';
      const sway = Math.sin(f.phase * 0.8 + 1) * L * 0.09;
      for (let s = 0; s < 2; s++) {
        const x0 = L * (0.20 - s * 0.05);
        ctx.beginPath();
        ctx.moveTo(x0, M * 0.45);
        ctx.quadraticCurveTo(x0 - L * 0.18, M * 1.25 + sway, x0 - L * 0.34, M * 1.95 + sway * 1.6);
        ctx.stroke();
      }
    }

    // спинной плавник
    const d0 = top[Math.floor(N * 0.30)], d1 = top[Math.floor(N * 0.62)];
    ctx.beginPath();
    ctx.moveTo(d0[0], d0[1] + 1);
    ctx.quadraticCurveTo((d0[0] + d1[0]) / 2, Math.min(d0[1], d1[1]) - M * 0.85, d1[0], d1[1] + 1);
    ctx.closePath();
    ctx.fill();

    // хвост
    ctx.beginPath();
    if (sp.tail === 'fork') {
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(tailX - TL, tailY + swing * TL * 0.5 - TL * 0.42);
      ctx.lineTo(tailX - TL * 0.52, tailY + swing * TL * 0.45);
      ctx.lineTo(tailX - TL, tailY + swing * TL * 0.5 + TL * 0.42);
    } else if (sp.tail === 'fan') {
      ctx.moveTo(tailX, tailY);
      ctx.quadraticCurveTo(tailX - TL * 0.8, tailY - TL * 0.75 + swing * TL * 0.4, tailX - TL, tailY + swing * TL * 0.5 - TL * 0.55);
      ctx.quadraticCurveTo(tailX - TL * 1.08, tailY + swing * TL * 0.55, tailX - TL, tailY + swing * TL * 0.5 + TL * 0.55);
      ctx.quadraticCurveTo(tailX - TL * 0.8, tailY + TL * 0.75 + swing * TL * 0.4, tailX, tailY);
    } else { // delta
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(tailX - TL, tailY + swing * TL * 0.5 - TL * 0.55);
      ctx.quadraticCurveTo(tailX - TL * 0.7, tailY + swing * TL * 0.5, tailX - TL, tailY + swing * TL * 0.5 + TL * 0.55);
    }
    ctx.closePath();
    ctx.fill();

    // тело
    const g = ctx.createLinearGradient(0, -M, 0, M);
    g.addColorStop(0, sp.colors.top);
    g.addColorStop(0.55, sp.colors.mid);
    g.addColorStop(1, sp.colors.bottom);
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    for (let i = 1; i <= N; i++) ctx.lineTo(top[i][0], top[i][1]);
    for (let i = N; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(8, 22, 32, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // окраска
    if (sp.deco === 'neon') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(110, 250, 255, 0.85)';
      ctx.lineWidth = Math.max(1.2, L * 0.075);
      ctx.beginPath();
      for (let i = 2; i <= N - 2; i++) {
        const x = top[i][0];
        const y = top[i][1] * 0.45 + bot[i][1] * 0.55;
        if (i === 2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 64, 48, 0.8)';
      ctx.lineWidth = Math.max(1.2, L * 0.08);
      ctx.beginPath();
      for (let i = Math.floor(N * 0.45); i <= N - 1; i++) {
        const x = top[i][0];
        const y = top[i][1] * 0.30 + bot[i][1] * 0.70;
        if (i === Math.floor(N * 0.45)) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    } else if (sp.deco === 'bars') {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#2c3640';
      const bars = [0.16, 0.42, 0.66];
      for (let b = 0; b < bars.length; b++) {
        const i = Math.round(N * bars[b]);
        const x = top[i][0];
        ctx.beginPath();
        ctx.moveTo(x - L * 0.020, top[i][1] + M * 0.08);
        ctx.lineTo(x + L * 0.030, top[i][1] + M * 0.08);
        ctx.lineTo(x + L * 0.010, bot[i][1] - M * 0.08);
        ctx.lineTo(x - L * 0.040, bot[i][1] - M * 0.08);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } else if (sp.deco === 'spots') {
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = '#3a2a1a';
      for (let i = 0; i < 5; i++) {
        const px = -L * 0.02 - (((i * 37 + f.p1 * 53) % 100) / 100) * L * 0.40;
        const py = Math.sin(f.p1 + i * 2.3) * M * 0.45;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.8, L * 0.035), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // грудной плавник
    ctx.save();
    ctx.translate(L * 0.22, M * 0.35);
    ctx.rotate(0.55 + Math.sin(f.phase * 1.6 + 1) * 0.35);
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.16, L * 0.06, 0, 0, TAU);
    ctx.fillStyle = sp.colors.fin;
    ctx.fill();
    ctx.restore();

    // глаз
    const ex = L * 0.34, ey = -M * 0.28, er = Math.max(1.2, L * 0.055);
    ctx.fillStyle = '#f4f8fa';
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, TAU); ctx.fill();
    ctx.fillStyle = '#10151c';
    ctx.beginPath(); ctx.arc(ex + er * 0.15, ey, er * 0.55, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(ex - er * 0.2, ey - er * 0.25, er * 0.22, 0, TAU); ctx.fill();

    ctx.restore();
  }

  // ---------------- среда ----------------
  function renderSand() {
    const regionH = H - sandRegionY;
    sandCanvas.width = Math.max(1, Math.ceil(W * DPR));
    sandCanvas.height = Math.max(1, Math.ceil(regionH * DPR));
    const c = sandCtx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, regionH);

    const wave = function (x) {
      return 12 + Math.sin(x * 0.018) * 3.5 + Math.sin(x * 0.006 + 2.1) * 4.5;
    };

    const g = c.createLinearGradient(0, 6, 0, regionH);
    g.addColorStop(0, '#b39a70');
    g.addColorStop(0.4, '#94805c');
    g.addColorStop(1, '#5f5040');
    c.beginPath();
    c.moveTo(0, wave(0));
    for (let x = 8; x <= W; x += 8) c.lineTo(x, wave(x));
    c.lineTo(W, regionH);
    c.lineTo(0, regionH);
    c.closePath();
    c.fillStyle = g;
    c.fill();

    // песчинки
    const grains = Math.round(W * regionH / 260);
    for (let i = 0; i < grains; i++) {
      const x = rand(0, W);
      const y = rand(14, regionH);
      const dark = Math.random() < 0.5;
      c.fillStyle = dark ? 'rgba(60,48,32,' + rand(0.05, 0.22).toFixed(2) + ')'
                         : 'rgba(255,236,200,' + rand(0.04, 0.16).toFixed(2) + ')';
      c.fillRect(x, y, rand(1, 2.4), rand(1, 2));
    }

    // камни
    const stones = Math.max(4, Math.round(W / 260));
    for (let i = 0; i < stones; i++) {
      const x = rand(W * 0.03, W * 0.97);
      const y = rand(18, regionH * 0.5);
      const r = rand(6, 22) * unit;
      const sg = c.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.2, x, y, r);
      sg.addColorStop(0, 'rgba(150,150,145,0.9)');
      sg.addColorStop(1, 'rgba(70,72,68,0.9)');
      c.fillStyle = sg;
      c.beginPath();
      c.ellipse(x, y, r, r * 0.62, rand(-0.3, 0.3), 0, TAU);
      c.fill();
    }
  }

  function setupCaustics() {
    causW = Math.max(2, Math.ceil(W / 4));
    causH = Math.max(2, Math.ceil((H - sandRegionY) / 2.2));
    causCanvas.width = causW;
    causCanvas.height = causH;
    causImg = causCtx.createImageData(causW, causH);
  }

  function updateCaustics(t) {
    if (!causImg) return;
    const d = causImg.data;
    let idx = 0;
    for (let y = 0; y < causH; y++) {
      const sy = y * 0.55;
      for (let x = 0; x < causW; x++) {
        const sx = x * 0.5;
        const n = Math.sin(sx * 0.23 + t * 0.9) + Math.sin(sy * 0.27 - t * 0.7)
                + Math.sin((sx + sy) * 0.15 + t * 0.5) + Math.sin((sx * 0.6 - sy) * 0.19 - t * 1.15);
        let b = 1 - Math.abs(n * 0.25);
        b = b * b; b = b * b; b = b * b; // ^6 — тонкие световые гребни
        const v = b * 170;
        d[idx] = v * 0.85;
        d[idx + 1] = v;
        d[idx + 2] = v * 0.92;
        d[idx + 3] = 255;
        idx += 4;
      }
    }
    causCtx.putImageData(causImg, 0, 0);
  }

  function buildPlants() {
    plants = [];
    const n = Math.max(6, Math.round(W / 110));
    for (let i = 0; i < n; i++) {
      const layer = Math.random() < 0.5 ? 0 : 1;
      plants.push({
        x: rand(W * 0.02, W * 0.98),
        h: rand(H * 0.13, H * 0.34) * (layer ? 1 : 0.72),
        segs: 9,
        phase: rand(0, TAU),
        w: rand(4, 9) * unit,
        hue: rand(120, 165),
        light: layer ? rand(27, 38) : rand(15, 23),
        layer: layer,
        speed: rand(0.6, 1.2),
      });
    }
  }

  function drawPlant(p, t) {
    const baseY = sandRegionY + 16;
    const segH = p.h / p.segs;
    let x = p.x, y = baseY, ang = -Math.PI / 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < p.segs; i++) {
      const k = i / p.segs;
      ang += Math.sin(t * p.speed + p.phase + i * 0.55) * 0.16 * (0.3 + k);
      const nx = x + Math.cos(ang) * segH;
      const ny = y + Math.sin(ang) * segH;
      ctx.strokeStyle = 'hsl(' + p.hue.toFixed(0) + ' 45% ' + (p.light + k * 10).toFixed(0) + '%)';
      ctx.lineWidth = Math.max(1, p.w * (1 - k * 0.75));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      x = nx; y = ny;
    }
  }

  function buildMotes() {
    motes = [];
    const n = Math.round(W * H / 26000);
    for (let i = 0; i < n; i++) {
      motes.push({
        x: rand(0, W), y: rand(0, H),
        r: rand(0.5, 1.7),
        dx: rand(-6, 6), dy: rand(-3, 3),
        a: rand(0.04, 0.13), ph: rand(0, TAU),
      });
    }
  }

  function buildHaze() {
    hazeBlobs = [];
    for (let i = 0; i < 5; i++) {
      hazeBlobs.push({
        bx: rand(0.1, 0.9), by: rand(0.25, 0.85),
        r: rand(0.25, 0.45),
        sp: rand(0.02, 0.06), ph: rand(0, TAU),
      });
    }
  }

  function buildRays() {
    rays = [];
    for (let i = 0; i < 5; i++) {
      rays.push({
        x: rand(0.08, 0.92),
        w: rand(30, 90) * unit,
        tilt: rand(-0.25, 0.25),
        ph: rand(0, TAU),
        a: rand(0.05, 0.11),
      });
    }
  }

  function spawnBubble() {
    bubbles.push({
      x: rand(W * 0.05, W * 0.95),
      y: H - rand(4, 30),
      r: rand(1.5, 5) * unit,
      vy: rand(25, 55),
      ph: rand(0, TAU),
    });
  }

  function updateBubbles(dt, t) {
    bubbleAcc += dt * 6 * state.bubbleRate;
    while (bubbleAcc >= 1) { spawnBubble(); bubbleAcc -= 1; }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= (b.vy + b.r * 8) * dt * unit;
      b.x += Math.sin(t * 3 + b.ph) * 14 * dt;
      b.r += dt * 0.35;
      if (b.y < 8) bubbles.splice(i, 1);
    }
  }

  function drawBubble(b) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.strokeStyle = 'rgba(205, 235, 245, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, -2.4, -1.4);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.stroke();
  }

  // ---------------- размеры ----------------
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.ceil(W * DPR);
    canvas.height = Math.ceil(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    unit = clamp(Math.min(W, H) / 800, 0.55, 1.5);
    sandTop = Math.round(H * 0.84);
    sandRegionY = sandTop - 12;

    waterGrad = ctx.createLinearGradient(0, 0, 0, H);
    waterGrad.addColorStop(0, '#2a7a9e');
    waterGrad.addColorStop(0.45, '#0f4a68');
    waterGrad.addColorStop(1, '#06283e');

    vignGrad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    vignGrad.addColorStop(0, 'rgba(2,10,18,0)');
    vignGrad.addColorStop(1, 'rgba(2,10,18,0.38)');

    renderSand();
    setupCaustics();
    buildPlants();
    buildMotes();
    buildHaze();
    buildRays();
    for (const f of fishes) {
      f.x = clamp(f.x, 4, W - 4);
      f.y = clamp(f.y, 4, sandRegionY);
    }
  }

  // ---------------- кадр ----------------
  function render(t) {
    // вода
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, 0, W, H);

    // лучи света
    if (state.raysOn) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const r of rays) {
        const sway = Math.sin(t * 0.3 + r.ph) * W * 0.02;
        const flick = 0.7 + 0.3 * Math.sin(t * 0.9 + r.ph * 3);
        const x0 = r.x * W + sway;
        const rg = ctx.createLinearGradient(0, -10, 0, H * 0.8);
        rg.addColorStop(0, 'rgba(190,230,240,' + (r.a * flick).toFixed(3) + ')');
        rg.addColorStop(1, 'rgba(190,230,240,0)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.moveTo(x0 - r.w / 2, -10);
        ctx.lineTo(x0 + r.w / 2, -10);
        ctx.lineTo(x0 + r.w * 1.1 + r.tilt * H, H * 0.8);
        ctx.lineTo(x0 - r.w * 1.1 + r.tilt * H, H * 0.8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // песок + каустика
    ctx.drawImage(sandCanvas, 0, 0, sandCanvas.width, sandCanvas.height,
      0, sandRegionY, W, H - sandRegionY);
    if (state.causticsOn) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.28;
      ctx.drawImage(causCanvas, 0, sandRegionY, W, H - sandRegionY);
      ctx.restore();
    }

    // задние водоросли
    for (const p of plants) if (p.layer === 0) drawPlant(p, t);

    // рыбы
    for (const f of fishes) drawFish(f);

    // пузырьки
    for (const b of bubbles) drawBubble(b);

    // передние водоросли
    for (const p of plants) if (p.layer === 1) drawPlant(p, t);

    // взвесь / муть
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      const mx = (m.x + m.dx * t) % W;
      const my = (m.y + m.dy * t) % H;
      const a = m.a * (0.6 + 0.4 * Math.sin(t * 0.8 + m.ph));
      ctx.fillStyle = 'rgba(220,240,245,' + a.toFixed(3) + ')';
      ctx.fillRect((mx + W) % W, (my + H) % H, m.r, m.r);
    }
    ctx.restore();

    // мутная дымка
    for (const hb of hazeBlobs) {
      const hx = (hb.bx + Math.sin(t * hb.sp + hb.ph) * 0.12) * W;
      const hy = (hb.by + Math.cos(t * hb.sp * 0.8 + hb.ph) * 0.06) * H;
      const hr = hb.r * Math.min(W, H);
      const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
      hg.addColorStop(0, 'rgba(170,200,210,0.05)');
      hg.addColorStop(1, 'rgba(170,200,210,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
    }

    // блик поверхности
    const sg = ctx.createLinearGradient(0, 0, 0, H * 0.07);
    sg.addColorStop(0, 'rgba(220,245,255,0.10)');
    sg.addColorStop(1, 'rgba(220,245,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, H * 0.07);

    // виньетка
    ctx.fillStyle = vignGrad;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------------- цикл ----------------
  let last = performance.now();
  let simT = 0;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const sdt = dt * state.timeScale;
    simT += sdt;
    frameNo++;

    updateSchool(simT);
    for (const f of fishes) updateFish(f, sdt, simT);
    updateBubbles(sdt, simT);
    if (state.causticsOn && frameNo % 2 === 0) updateCaustics(simT);

    render(simT);
    requestAnimationFrame(frame);
  }

  // ---------------- UI ----------------
  function byId(id) { return document.getElementById(id); }
  const uiFish = byId('ui-fish'), uiBub = byId('ui-bub'), uiSpd = byId('ui-spd');
  const uiRays = byId('ui-rays'), uiCaus = byId('ui-caus');
  const uiFishV = byId('ui-fish-v'), uiBubV = byId('ui-bub-v'), uiSpdV = byId('ui-spd-v');

  uiFish.addEventListener('input', function () {
    state.fishTarget = +uiFish.value;
    uiFishV.textContent = uiFish.value;
    rebuildFish();
  });
  uiBub.addEventListener('input', function () {
    state.bubbleRate = +uiBub.value;
    uiBubV.textContent = '×' + (+uiBub.value).toFixed(1);
  });
  uiSpd.addEventListener('input', function () {
    state.timeScale = +uiSpd.value;
    uiSpdV.textContent = Math.round(+uiSpd.value * 100) + '%';
  });
  uiRays.addEventListener('change', function () { state.raysOn = uiRays.checked; });
  uiCaus.addEventListener('change', function () { state.causticsOn = uiCaus.checked; });

  window.addEventListener('resize', resize);

  // ---------------- старт ----------------
  resize();
  rebuildFish();
  requestAnimationFrame(frame);
})();
