// Аквариум — процедурные рыбы, каустики, лучи света. Чистый canvas 2D, без библиотек.
(() => {
  'use strict';

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d', { alpha: false });

  let W = 0, H = 0, DPR = 1;
  let floorY = 0;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    floorY = H * 0.82;
    layoutScene();
  }

  // ── утилиты ───────────────────────────────────────────────────────────────
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const lerp = (a, b, t) => a + (b - a) * t;
  // кратчайший разворот угла a к b с ограничением max
  function turnToward(a, b, max) {
    let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return a + clamp(d, -max, max);
  }

  // ── состояние ───────────────────────────────────────────────────────────────
  const state = {
    playing: true,
    rays: true,
    bubbles: true,
    current: 1,
    tempo: 1,
    t: 0,
  };

  const fish = [];
  const bubbles = [];
  const motes = [];
  const plants = [];
  const caustics = [];
  const rays = [];
  const food = [];

  // ── виды рыб ──────────────────────────────────────────────────────────────
  const SPECIES = [
    { name: 'clown', len: [44, 62], depth: 0.52, speed: [26, 40], wave: 3.0,
      back: '#d8521a', mid: '#ff8a3a', belly: '#ffd9a0', fin: '#23232b', stripes: 'white', count: [2, 3] },
    { name: 'tang',  len: [54, 74], depth: 0.5,  speed: [22, 34], wave: 2.6,
      back: '#163f95', mid: '#2f7be0', belly: '#bfe6ff', fin: '#0c2a5e', stripes: null, count: [2, 2] },
    { name: 'yellow',len: [40, 56], depth: 0.58, speed: [28, 42], wave: 3.2,
      back: '#cf9300', mid: '#ffd11a', belly: '#fff3aa', fin: '#b88e00', stripes: null, count: [2, 3] },
    { name: 'angel', len: [78, 104], depth: 0.66, speed: [14, 24], wave: 2.0,
      back: '#b78838', mid: '#f0d28a', belly: '#fff4d6', fin: '#7a5a22', stripes: 'dark', count: [1, 2] },
  ];
  const SCHOOL = { name: 'school', len: [15, 23], depth: 0.42, speed: [38, 56], wave: 4.2,
      back: '#7eb2cc', mid: '#cfeaf6', belly: '#f3fbff', fin: '#6f9fb6', stripes: null };

  function makeFish(species, schoolId) {
    const z = rand(0.05, 1);
    return {
      species, schoolId,
      x: rand(0.1, 0.9) * W,
      y: rand(0.12, 0.7) * H,
      z,
      dscale: 0.55 + 0.7 * z,
      dir: rand(0, TAU),
      len: rand(species.len[0], species.len[1]),
      baseSpeed: rand(species.speed[0], species.speed[1]),
      phase: rand(0, TAU),
      wanderT: rand(0, TAU),
      bobPhase: rand(0, TAU),
      hungry: 0,
    };
  }

  function buildFish() {
    fish.length = 0;
    for (const sp of SPECIES) {
      const n = randi(sp.count[0], sp.count[1]);
      for (let i = 0; i < n; i++) fish.push(makeFish(sp, -1));
    }
    // стайка мелких
    const n = Math.round(24 + W / 90);
    for (let i = 0; i < n; i++) fish.push(makeFish(SCHOOL, 1));
    fish.sort((a, b) => a.z - b.z);
  }

  function layoutScene() {
    // водоросли вдоль дна
    plants.length = 0;
    const pn = Math.round(W / 130) + 4;
    for (let i = 0; i < pn; i++) {
      const x = rand(0.02, 0.98) * W;
      const blades = randi(3, 6);
      const baseH = rand(0.18, 0.42) * H;
      const hue = rand(95, 155);
      const blArr = [];
      for (let b = 0; b < blades; b++) {
        blArr.push({
          dx: rand(-18, 18),
          h: baseH * rand(0.6, 1.1),
          w: rand(7, 14),
          sway: rand(0.4, 0.9),
          phase: rand(0, TAU),
          light: rand(0.8, 1.15),
        });
      }
      plants.push({ x, blades: blArr, hue });
    }
    plants.sort((a, b) => a.x - b.x);

    // каустики на дне
    caustics.length = 0;
    const cn = Math.round(W / 120) + 5;
    for (let i = 0; i < cn; i++) {
      caustics.push({
        x: rand(0, W), r: rand(60, 150),
        speed: rand(6, 18) * (Math.random() < 0.5 ? -1 : 1),
        phase: rand(0, TAU), pSpeed: rand(0.6, 1.4),
      });
    }

    // лучи света
    rays.length = 0;
    const rn = Math.round(W / 240) + 3;
    for (let i = 0; i < rn; i++) {
      rays.push({
        x: rand(0.05, 0.95) * W,
        w: rand(40, 110),
        skew: rand(-0.16, 0.16),
        phase: rand(0, TAU),
        pSpeed: rand(0.18, 0.4),
        amp: rand(14, 40),
        bright: rand(0.5, 1),
      });
    }

    // взвесь
    motes.length = 0;
    const mn = Math.round(W * H / 14000);
    for (let i = 0; i < mn; i++) {
      motes.push({
        x: rand(0, W), y: rand(0, H),
        r: rand(0.6, 2.0), z: rand(0.2, 1),
        vy: rand(-3, 6), phase: rand(0, TAU), pSpeed: rand(0.3, 0.9),
      });
    }

    // пузырьки
    if (bubbles.length === 0) {
      const bn = Math.round(W / 22);
      for (let i = 0; i < bn; i++) bubbles.push(makeBubble(rand(0, H)));
    }

    if (fish.length === 0) buildFish();
  }

  function makeBubble(y) {
    return {
      x: rand(0, W), y,
      r: rand(1.5, 6), speed: rand(28, 70),
      sway: rand(8, 22), phase: rand(0, TAU), pSpeed: rand(1, 2.4),
    };
  }

  // ── профиль тела рыбы (t: 0 нос → 1 основание хвоста) ───────────────────────
  function bodyProfile(t) {
    const head = Math.pow(clamp(t / 0.30, 0, 1), 0.7);
    const tail = Math.pow(clamp((1 - t) / 0.70, 0, 1), 0.85);
    return Math.max(0.07, t < 0.30 ? head : tail);
  }

  // ── обновление ──────────────────────────────────────────────────────────────
  function updateFish(f, dt) {
    const marginX = 90 * f.dscale, marginY = 70 * f.dscale;
    const top = H * 0.06, bot = floorY - 18 * f.dscale;

    // вектор текущего направления
    let vx = Math.cos(f.dir), vy = Math.sin(f.dir);

    // блуждание
    f.wanderT += dt * rand(0.6, 1.4);
    vx += Math.cos(f.wanderT * 0.7) * 0.25;
    vy += Math.sin(f.wanderT) * 0.18;

    // отталкивание от стенок
    if (f.x < marginX) vx += (1 - f.x / marginX) * 2.2;
    if (f.x > W - marginX) vx -= (1 - (W - f.x) / marginX) * 2.2;
    if (f.y < top + marginY) vy += (1 - (f.y - top) / marginY) * 2.4;
    if (f.y > bot - marginY) vy -= (1 - (bot - f.y) / marginY) * 2.6;

    // стайное поведение
    if (f.schoolId > 0) {
      let cx = 0, cy = 0, hx = 0, hy = 0, sx = 0, sy = 0, n = 0;
      for (const o of fish) {
        if (o === f || o.schoolId !== f.schoolId) continue;
        const dx = o.x - f.x, dy = o.y - f.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 22000) continue;
        n++;
        cx += o.x; cy += o.y;
        hx += Math.cos(o.dir); hy += Math.sin(o.dir);
        if (d2 < 1400) { const d = Math.sqrt(d2) + 0.01; sx -= dx / d; sy -= dy / d; }
      }
      if (n > 0) {
        cx = cx / n - f.x; cy = cy / n - f.y;
        const cl = Math.hypot(cx, cy) + 0.01;
        vx += (cx / cl) * 0.5 + (hx / n) * 0.6 + sx * 1.1;
        vy += (cy / cl) * 0.5 + (hy / n) * 0.6 + sy * 1.1;
      }
    }

    // тяга к корму
    f.hungry = Math.max(0, f.hungry - dt);
    if (food.length) {
      let best = null, bd = 1e9;
      for (const p of food) {
        const dx = p.x - f.x, dy = p.y - f.y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = p; }
      }
      if (best && bd < 320 * 320) {
        const d = Math.sqrt(bd) + 0.01;
        const pull = lerp(2.6, 0.8, clamp(d / 320, 0, 1));
        vx += ((best.x - f.x) / d) * pull;
        vy += ((best.y - f.y) / d) * pull;
        f.hungry = 1.2;
        if (d < f.len * 0.45 * f.dscale) best.eat = true;
      }
    }

    // поворот к желаемому направлению
    const desired = Math.atan2(vy, vx);
    const maxTurn = (f.schoolId > 0 ? 3.4 : 2.0) * dt;
    f.dir = turnToward(f.dir, desired, maxTurn);

    // движение
    const sp = f.baseSpeed * (0.5 + 0.5 * state.current) * (1 + f.hungry * 0.9) * f.dscale;
    f.x += Math.cos(f.dir) * sp * dt;
    f.y += Math.sin(f.dir) * sp * dt;
    f.x = clamp(f.x, -20, W + 20);
    f.y = clamp(f.y, top - 10, bot + 10);

    // взмах хвоста зависит от скорости
    f.phase += dt * (3 + sp * 0.05 + f.hungry * 3);
    f.bobPhase += dt * 1.3;
  }

  function update(dt) {
    state.t += dt;

    for (const f of fish) updateFish(f, dt);

    // корм тонет
    for (let i = food.length - 1; i >= 0; i--) {
      const p = food[i];
      p.y += p.vy * dt;
      p.vy = Math.min(p.vy + 8 * dt, 26);
      p.x += Math.sin(state.t * 1.5 + p.phase) * 6 * dt;
      p.life -= dt;
      if (p.eat || p.life <= 0 || p.y > floorY - 4) food.splice(i, 1);
    }

    // пузырьки
    for (const b of bubbles) {
      b.y -= b.speed * dt * (0.6 + 0.4 * state.current);
      b.phase += dt * b.pSpeed;
      if (b.y < -b.r * 2) {
        b.y = H + rand(0, 40);
        b.x = rand(0, W);
        b.r = rand(1.5, 6);
        b.speed = rand(28, 70);
      }
    }

    // взвесь
    for (const m of motes) {
      m.phase += dt * m.pSpeed;
      m.x += (Math.sin(m.phase) * 4 + 8 * state.current) * m.z * dt;
      m.y += m.vy * dt * 0.2;
      if (m.x > W + 4) m.x = -4;
      if (m.x < -4) m.x = W + 4;
      if (m.y > H + 4) m.y = -4;
      if (m.y < -4) m.y = H + 4;
    }
  }

  // ── отрисовка ───────────────────────────────────────────────────────────────
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.0, '#0e7390');
    g.addColorStop(0.22, '#0a5a76');
    g.addColorStop(0.5, '#073f59');
    g.addColorStop(0.78, '#04273d');
    g.addColorStop(1.0, '#03192a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // блики поверхности
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const y = (i / 5) * H * 0.05;
      const a = 0.04 * (1 - i / 5);
      const off = Math.sin(state.t * 0.6 + i) * 40;
      const gg = ctx.createLinearGradient(0, 0, W, 0);
      gg.addColorStop(0, 'rgba(180,240,255,0)');
      gg.addColorStop(0.5, `rgba(190,245,255,${a})`);
      gg.addColorStop(1, 'rgba(180,240,255,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(off, y, W, H * 0.06);
    }
    ctx.restore();
  }

  function drawRays() {
    if (!state.rays) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of rays) {
      const sway = Math.sin(state.t * r.pSpeed + r.phase) * r.amp;
      const topX = r.x + sway;
      const len = H * 0.95;
      const x1 = topX - r.w / 2, x2 = topX + r.w / 2;
      const skew = r.skew * len;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      const a = 0.16 * r.bright * (0.7 + 0.3 * Math.sin(state.t * 0.5 + r.phase));
      g.addColorStop(0, `rgba(170,235,255,${a})`);
      g.addColorStop(0.5, `rgba(150,225,250,${a * 0.5})`);
      g.addColorStop(1, 'rgba(140,220,250,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x1, 0);
      ctx.lineTo(x2, 0);
      ctx.lineTo(x2 + skew + r.w * 0.7, len);
      ctx.lineTo(x1 + skew - r.w * 0.7, len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFloor() {
    const sandTop = floorY;
    // рельеф дна
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, sandTop + Math.sin(0.6) * 6);
    const step = Math.max(40, W / 24);
    for (let x = 0; x <= W; x += step) {
      const y = sandTop + Math.sin(x * 0.012 + 1.3) * 10 + Math.sin(x * 0.05) * 4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, sandTop - 20, 0, H);
    g.addColorStop(0, '#caa572');
    g.addColorStop(0.4, '#9c7c4e');
    g.addColorStop(1, '#5e4a2c');
    ctx.fillStyle = g;
    ctx.fill();

    // каустики поверх дна
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, sandTop - 14, W, H - sandTop + 14);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (const c of caustics) {
      const x = ((c.x + c.speed * state.t) % (W + 200) + (W + 200)) % (W + 200) - 100;
      const pulse = 0.5 + 0.5 * Math.sin(state.t * c.pSpeed + c.phase);
      const r = c.r * (0.8 + 0.3 * pulse);
      const y = sandTop + 10 + Math.sin(c.phase) * 8;
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
      g2.addColorStop(0, `rgba(220,245,255,${0.14 * pulse})`);
      g2.addColorStop(0.6, `rgba(180,230,255,${0.05 * pulse})`);
      g2.addColorStop(1, 'rgba(180,230,255,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  function drawPlants() {
    for (const pl of plants) {
      for (const bl of pl.blades) {
        const baseX = pl.x + bl.dx;
        const baseY = floorY + 6;
        const segs = 10;
        const left = [], right = [];
        for (let i = 0; i <= segs; i++) {
          const t = i / segs;
          const h = bl.h * t;
          const sway = Math.sin(state.t * bl.sway + bl.phase + t * 2.2) * (10 + bl.h * 0.12) * t;
          const cx = baseX + sway;
          const cy = baseY - h;
          const w = bl.w * (1 - t * 0.85);
          left.push([cx - w / 2, cy]);
          right.push([cx + w / 2, cy]);
        }
        ctx.beginPath();
        ctx.moveTo(left[0][0], left[0][1]);
        for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
        for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
        ctx.closePath();
        const top = left[left.length - 1];
        const g = ctx.createLinearGradient(baseX, baseY, top[0], top[1]);
        g.addColorStop(0, `hsl(${pl.hue}, 55%, ${18 * bl.light}%)`);
        g.addColorStop(1, `hsl(${pl.hue + 12}, 60%, ${36 * bl.light}%)`);
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
  }

  function drawFish(f) {
    const L = f.len * f.dscale;
    const maxHalf = L * f.species.depth * 0.5;
    const ampSpine = L * 0.085;
    const WAVE = f.species.wave;

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.dir);
    if (Math.cos(f.dir) < 0) ctx.scale(1, -1);
    ctx.globalAlpha = 0.55 + 0.45 * f.z;

    const N = 26;
    const top = [], bot = [];
    let tailY = 0;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = L * (0.5 - t);
      const env = Math.pow(t, 1.5);
      const yc = ampSpine * env * Math.sin(f.phase - t * WAVE);
      const half = bodyProfile(t) * maxHalf;
      top.push([x, yc - half]);
      bot.push([x, yc + half]);
      if (i === N) tailY = yc;
    }

    // хвостовой плавник
    const tailX = -L * 0.5;
    const swing = ampSpine * 2.4 * Math.sin(f.phase - WAVE);
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tailX - L * 0.26, tailY - L * 0.20 + swing);
    ctx.quadraticCurveTo(tailX - L * 0.14, tailY + swing * 0.4, tailX - L * 0.26, tailY + L * 0.20 + swing);
    ctx.closePath();
    ctx.fillStyle = f.species.fin;
    ctx.globalAlpha *= 0.92;
    ctx.fill();
    ctx.globalAlpha = 0.55 + 0.45 * f.z;

    // грудной плавник
    const pecFlap = Math.sin(f.phase * 0.8) * 0.4;
    ctx.save();
    ctx.translate(L * 0.16, maxHalf * 0.55);
    ctx.rotate(0.5 + pecFlap);
    ctx.beginPath();
    ctx.ellipse(0, L * 0.08, L * 0.07, L * 0.16, 0, 0, TAU);
    ctx.fillStyle = f.species.fin;
    ctx.globalAlpha *= 0.7;
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 0.55 + 0.45 * f.z;

    // тело
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    for (let i = 1; i < top.length; i++) ctx.lineTo(top[i][0], top[i][1]);
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
    ctx.closePath();

    const bg = ctx.createLinearGradient(0, -maxHalf, 0, maxHalf);
    bg.addColorStop(0, f.species.back);
    bg.addColorStop(0.45, f.species.mid);
    bg.addColorStop(1, f.species.belly);
    ctx.fillStyle = bg;
    ctx.fill();

    // спинной плавник
    ctx.save();
    ctx.clip();
    if (f.species.stripes) {
      const isWhite = f.species.stripes === 'white';
      ctx.fillStyle = isWhite ? 'rgba(255,255,255,0.82)' : 'rgba(20,20,30,0.35)';
      const bands = isWhite ? 3 : 5;
      for (let i = 0; i < bands; i++) {
        const bx = L * (0.34 - i * 0.22);
        const bw = L * (isWhite ? 0.07 : 0.05);
        ctx.save();
        ctx.translate(bx, 0);
        ctx.rotate(0.12);
        ctx.fillRect(-bw / 2, -maxHalf * 1.2, bw, maxHalf * 2.4);
        ctx.restore();
      }
    }
    // блик сверху вдоль спины
    const sh = ctx.createLinearGradient(0, -maxHalf, 0, 0);
    sh.addColorStop(0, 'rgba(255,255,255,0.16)');
    sh.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(-L * 0.5, -maxHalf, L, maxHalf);
    ctx.restore();

    // глаз
    const eyeX = L * 0.34, eyeY = -maxHalf * 0.4;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, L * 0.055, 0, TAU);
    ctx.fillStyle = '#fbfdff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eyeX + L * 0.012, eyeY, L * 0.032, 0, TAU);
    ctx.fillStyle = '#10131a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eyeX - L * 0.008, eyeY - L * 0.012, L * 0.012, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();

    ctx.restore();
  }

  function drawBubbles() {
    if (!state.bubbles) return;
    for (const b of bubbles) {
      const x = b.x + Math.sin(b.phase) * b.sway;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, TAU);
      const g = ctx.createRadialGradient(x - b.r * 0.3, b.y - b.r * 0.3, 0, x, b.y, b.r);
      g.addColorStop(0, 'rgba(230,250,255,0.5)');
      g.addColorStop(0.7, 'rgba(180,225,245,0.12)');
      g.addColorStop(1, 'rgba(200,235,250,0.28)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.28, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fill();
    }
  }

  function drawMotes() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TAU);
      ctx.fillStyle = `rgba(200,235,255,${0.06 + 0.12 * m.z})`;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFood() {
    for (const p of food) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fillStyle = '#c98a3a';
      ctx.fill();
    }
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(W / 2, H * 0.42, H * 0.2, W / 2, H * 0.5, H * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,10,20,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function render() {
    drawBackground();
    drawRays();
    drawMotes();
    drawFloor();
    drawPlants();
    drawFood();
    for (const f of fish) drawFish(f); // отсортированы по глубине
    drawBubbles();
    drawVignette();
  }

  // ── цикл ────────────────────────────────────────────────────────────────────
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.05) * state.tempo;
    if (state.playing) update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ── управление ────────────────────────────────────────────────────────────
  function dropFood(cx, cy) {
    const n = randi(3, 6);
    for (let i = 0; i < n; i++) {
      food.push({
        x: cx + rand(-20, 20),
        y: cy + rand(-10, 10),
        vy: rand(8, 18), r: rand(1.6, 3),
        phase: rand(0, TAU), life: rand(9, 14),
      });
    }
  }

  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    dropFood(e.clientX - r.left, Math.min(e.clientY - r.top, floorY - 30));
  });

  const $ = id => document.getElementById(id);
  $('playPause').addEventListener('click', e => {
    state.playing = !state.playing;
    e.target.textContent = state.playing ? 'Пауза' : 'Пуск';
    last = performance.now();
  });
  function toggle(id, key) {
    $(id).addEventListener('click', e => {
      state[key] = !state[key];
      e.target.classList.toggle('on', state[key]);
    });
  }
  toggle('rays', 'rays');
  toggle('bubbles', 'bubbles');
  $('feed').addEventListener('click', () => {
    for (let i = 0; i < 3; i++) dropFood(rand(0.2, 0.8) * W, rand(0.1, 0.3) * H);
  });
  $('current').addEventListener('input', e => state.current = +e.target.value);
  $('tempo').addEventListener('input', e => state.tempo = +e.target.value);

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
