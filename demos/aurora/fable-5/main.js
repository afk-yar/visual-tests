/* «Полярное сияние» — Claude Fable 5.
   Canvas 2D без библиотек: аддитивные ленты-занавеси по шумовым полям (value noise + fbm),
   вертикальные лучи, двухступенчатый bloom, звёзды с мерцанием, метеоры, силуэт хребтов
   и «живое» отражение в воде через полосовую выборку неба. */
(() => {
  'use strict';

  // ---------- утилиты ----------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- шум (value noise + fbm) ----------
  const PERM = new Uint8Array(512);
  {
    const rnd = mulberry32(0xA17A0);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  }
  const hash2 = (ix, iy) => PERM[(PERM[ix & 255] + iy) & 255] / 255;

  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = smooth(x - xi), v = smooth(y - yi);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  function fbm(x, y, oct) {
    let s = 0, amp = 0.5, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += amp * vnoise(x, y);
      norm += amp;
      amp *= 0.5;
      x = x * 2.13 + 17.17;
      y = y * 2.13 + 9.31;
    }
    return s / norm;
  }

  // ---------- DOM ----------
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const ui = {
    intensity: document.getElementById('intensity'),
    speed: document.getElementById('speed'),
    waves: document.getElementById('waves'),
    pause: document.getElementById('pause'),
  };
  const params = { intensity: 1, speed: 1, waves: 1 };

  // ---------- слои ----------
  const skyBg = document.createElement('canvas');   // градиент неба + Млечный Путь (статично)
  const terrain = document.createElement('canvas'); // силуэт хребтов и елей (статично)
  const sky = document.createElement('canvas');     // сборка неба на кадр (источник отражения)
  const aurora = document.createElement('canvas');  // сияние в низком разрешении
  const bloom = document.createElement('canvas');   // ореол, даунсэмпл x3
  const bloom2 = document.createElement('canvas');  // широкий ореол, ещё x3
  const sctx = sky.getContext('2d');
  const actx = aurora.getContext('2d');
  const bctx = bloom.getContext('2d');
  const b2ctx = bloom2.getContext('2d');

  // ---------- цветовые рампы лент (сверху вниз: корона -> яркая нижняя кромка) ----------
  function makeRamp(stops) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    for (const s of stops) gr.addColorStop(s[0], s[1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, 1, 256);
    return c;
  }

  // Доминирует зелёный (кислородная линия 557,7 нм); пурпур — тонкая кайма у нижней
  // кромки, голубой — только верхние хвосты и дальняя занавесь. Верх каждой рампы —
  // длинный экспоненциальный хвост (никаких плоских «крыш»). R и B в ярких стопах
  // низкие: при аддитивном клиппинге цвет уходит в зелёный, а не в белый.
  const RAMPS = [
    makeRamp([ // основная: насыщенный зелёный, пурпурная кайма снизу
      [0.00, 'rgba(70,110,205,0)'],
      [0.10, 'rgba(70,115,205,0.035)'],
      [0.24, 'rgba(55,150,170,0.09)'],
      [0.40, 'rgba(20,196,116,0.20)'],
      [0.58, 'rgba(0,196,106,0.38)'],
      [0.74, 'rgba(20,225,110,0.62)'],
      [0.87, 'rgba(42,255,126,0.88)'],
      [0.945, 'rgba(120,255,170,0.95)'],
      [0.975, 'rgba(210,90,215,0.40)'],
      [1.00, 'rgba(160,50,185,0)'],
    ]),
    makeRamp([ // ближняя: зелёная с фиолетовым верхом и яркой пурпурной каймой
      [0.00, 'rgba(140,70,225,0)'],
      [0.12, 'rgba(140,75,225,0.05)'],
      [0.30, 'rgba(110,90,225,0.12)'],
      [0.48, 'rgba(35,185,135,0.26)'],
      [0.66, 'rgba(0,205,105,0.44)'],
      [0.82, 'rgba(30,240,120,0.72)'],
      [0.93, 'rgba(110,255,165,0.88)'],
      [0.97, 'rgba(220,110,230,0.50)'],
      [1.00, 'rgba(170,60,200,0)'],
    ]),
    makeRamp([ // дальняя: приглушённая сине-бирюзовая
      [0.00, 'rgba(80,120,235,0)'],
      [0.15, 'rgba(80,125,235,0.05)'],
      [0.40, 'rgba(60,165,215,0.15)'],
      [0.65, 'rgba(45,205,170,0.32)'],
      [0.86, 'rgba(70,235,175,0.58)'],
      [0.95, 'rgba(120,245,200,0.66)'],
      [1.00, 'rgba(70,195,180,0)'],
    ]),
  ];

  const RAY_RAMP = makeRamp([ // высокие бледно-зелёные лучи, мягкий хвост сверху
    [0.00, 'rgba(120,190,180,0)'],
    [0.25, 'rgba(105,205,170,0.05)'],
    [0.55, 'rgba(85,225,150,0.14)'],
    [0.85, 'rgba(115,245,170,0.26)'],
    [0.96, 'rgba(165,255,200,0.30)'],
    [1.00, 'rgba(110,235,160,0)'],
  ]);

  // ---------- занавеси ----------
  // base — высота основания в долях неба; amp/k/s — синусоидальные волны основания;
  // nAmp/nk/ns — шумовая добавка; hMin..hMax — высота лент; sk/ss/drift2 — складки-лучи;
  // bs — «дыхание» занавеси; alpha — общая яркость.
  const CURTAINS = [
    { ramp: 2, base: 0.30, seed: 3.7, ph1: 1.3, ph2: 4.1,
      amp1: 0.050, k1: 1.4, s1: 0.016, amp2: 0.022, k2: 3.7, s2: 0.031,
      nAmp: 0.050, nk: 1.3, ns: 0.07,
      hMin: 0.10, hMax: 0.30, hk: 2.0, hs: 0.07, drift: 0.012,
      sk: 16, ss: 0.08, drift2: 0.030, bs: 0.045, alpha: 0.45 },
    { ramp: 0, base: 0.56, seed: 9.2, ph1: 0.0, ph2: 2.2,
      amp1: 0.070, k1: 1.1, s1: 0.021, amp2: 0.030, k2: 2.9, s2: 0.040,
      nAmp: 0.070, nk: 1.1, ns: 0.09,
      hMin: 0.18, hMax: 0.55, hk: 1.6, hs: 0.08, drift: 0.018,
      sk: 22, ss: 0.11, drift2: 0.045, bs: 0.060, alpha: 0.82 },
    { ramp: 1, base: 0.75, seed: 17.5, ph1: 2.6, ph2: 0.9,
      amp1: 0.055, k1: 0.9, s1: 0.026, amp2: 0.025, k2: 2.3, s2: 0.052,
      nAmp: 0.060, nk: 1.0, ns: 0.10,
      hMin: 0.14, hMax: 0.48, hk: 1.8, hs: 0.09, drift: -0.022,
      sk: 27, ss: 0.13, drift2: -0.060, bs: 0.075, alpha: 0.62 },
  ];

  // ---------- состояние ----------
  let W = 0, H = 0, dpr = 1, horizonY = 0;
  let stars = [];
  let meteors = [];
  let meteorTimer = 2.5;
  let waterGrad = null, hazeGrad = null, vignetteGrad = null;
  let T = 137;        // время сцены, масштабируется «Скоростью»
  let lastTs = 0, rafId = 0;
  let running = true;

  // ---------- зерно плёнки ----------
  const grain = document.createElement('canvas');
  let grainPattern = null;
  {
    grain.width = 128;
    grain.height = 128;
    const g = grain.getContext('2d');
    const img = g.createImageData(128, 128);
    const rnd = mulberry32(0x9E3779);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (92 + rnd() * 72) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainPattern = ctx.createPattern(grain, 'repeat');
  }

  // ---------- статические слои ----------
  function buildSkyBg() {
    skyBg.width = W;
    skyBg.height = horizonY;
    const g = skyBg.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, horizonY);
    gr.addColorStop(0, '#020411');
    gr.addColorStop(0.55, '#061024');
    gr.addColorStop(0.85, '#0a1a30');
    gr.addColorStop(1, '#102539');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, horizonY);

    // Млечный Путь: мягкая дымка + пыль мелких звёзд по диагональной полосе
    const rnd = mulberry32(0x314159);
    const x0 = W * 0.12, y0 = -horizonY * 0.08, x1 = W * 0.95, y1 = horizonY * 0.9;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const t = rnd();
      const cx = lerp(x0, x1, t) + (rnd() - 0.5) * W * 0.10;
      const cy = lerp(y0, y1, t) + (rnd() - 0.5) * horizonY * 0.16;
      const r = (30 + rnd() * 90) * dpr;
      const a = 0.012 + rnd() * 0.02;
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, 'rgba(175,195,235,' + a.toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(175,195,235,0)');
      g.fillStyle = rg;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    g.fillStyle = 'rgba(215,228,250,1)';
    for (let i = 0; i < 420; i++) {
      const t = rnd();
      const cx = lerp(x0, x1, t) + (rnd() - 0.5) * W * 0.13;
      const cy = lerp(y0, y1, t) + (rnd() - 0.5) * horizonY * 0.2;
      g.globalAlpha = 0.05 + rnd() * 0.13;
      const r = (0.4 + rnd() * 0.7) * dpr;
      g.fillRect(cx, cy, r, r);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  function drawRidge(g, o) {
    const stepX = Math.max(2, Math.round(2 * dpr));
    const xs = [], ys = [];
    for (let x = 0; x <= W + stepX; x += stepX) {
      const u = x / W;
      let n = fbm(u * o.freq + o.seed, o.seed * 1.73, 4);
      n = Math.pow(clamp((n - 0.22) / 0.6, 0, 1), 1.25);
      xs.push(x);
      ys.push(horizonY - horizonY * (o.hBase + o.hVar * n));
    }
    g.fillStyle = o.color;
    g.beginPath();
    g.moveTo(-2, horizonY + 2);
    for (let i = 0; i < xs.length; i++) g.lineTo(xs[i], ys[i]);
    g.lineTo(W + 2, horizonY + 2);
    g.closePath();
    g.fill();

    if (o.trees) { // ёлки по гребню ближнего хребта
      const rnd = mulberry32(0xC0FFEE);
      let x = rnd() * 8 * dpr;
      while (x < W) {
        const i = clamp(Math.floor(x / stepX), 0, xs.length - 2);
        const f = (x - xs[i]) / stepX;
        const crest = lerp(ys[i], ys[i + 1], f);
        const th = (5 + rnd() * 12) * dpr;
        const tw = th * (0.36 + rnd() * 0.14);
        g.beginPath();
        g.moveTo(x - tw, crest + dpr);
        g.lineTo(x, crest - th);
        g.lineTo(x + tw, crest + dpr);
        g.closePath();
        g.fill();
        x += (5 + rnd() * 26) * dpr;
      }
    }
  }

  function buildTerrain() {
    terrain.width = W;
    terrain.height = horizonY;
    const g = terrain.getContext('2d');
    g.clearRect(0, 0, W, horizonY);
    drawRidge(g, { color: '#0b1424', hBase: 0.055, hVar: 0.125, freq: 2.7, seed: 11.3 });
    drawRidge(g, { color: '#040810', hBase: 0.028, hVar: 0.075, freq: 4.6, seed: 47.9, trees: true });
  }

  function makeStars() {
    const rnd = mulberry32(0x51AB5);
    const count = Math.round((W / dpr) * (horizonY / dpr) / 3800);
    stars = [];
    for (let i = 0; i < count; i++) {
      const bright = rnd();
      stars.push({
        x: rnd() * W,
        y: Math.pow(rnd(), 1.25) * horizonY,
        r: (0.45 + Math.pow(bright, 3.2) * 1.8) * dpr,
        base: 0.3 + rnd() * 0.6,
        tw: rnd() < 0.65 ? 0.2 + rnd() * 0.55 : 0.06,
        sp: 0.5 + rnd() * 2.4,
        ph: rnd() * TAU,
        tint: rnd(),
      });
    }
  }

  function buildGradients() {
    waterGrad = ctx.createLinearGradient(0, horizonY, 0, H);
    waterGrad.addColorStop(0, '#0d1d2e');
    waterGrad.addColorStop(0.5, '#071120');
    waterGrad.addColorStop(1, '#020509');

    hazeGrad = ctx.createLinearGradient(0, horizonY - 26 * dpr, 0, horizonY + 22 * dpr);
    hazeGrad.addColorStop(0, 'rgba(130,215,205,0)');
    hazeGrad.addColorStop(0.5, 'rgba(140,225,215,0.085)');
    hazeGrad.addColorStop(1, 'rgba(130,215,205,0)');

    const cx = W * 0.5, cy = H * 0.52;
    const rIn = Math.min(W, H) * 0.42;
    const rOut = Math.hypot(W, H) * 0.62;
    vignetteGrad = ctx.createRadialGradient(cx, cy, rIn, cx, cy, rOut);
    vignetteGrad.addColorStop(0, 'rgba(2,3,10,0)');
    vignetteGrad.addColorStop(1, 'rgba(2,3,10,0.5)');
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(2, Math.round(window.innerWidth * dpr));
    H = Math.max(2, Math.round(window.innerHeight * dpr));
    canvas.width = W;
    canvas.height = H;
    horizonY = Math.round(H * 0.70);
    sky.width = W;
    sky.height = horizonY;
    const aw = clamp(Math.round(W / 2.4), 160, 720);
    aurora.width = aw;
    aurora.height = Math.max(2, Math.round(horizonY * aw / W));
    bloom.width = Math.max(2, Math.round(aurora.width / 3));
    bloom.height = Math.max(2, Math.round(aurora.height / 3));
    bloom2.width = Math.max(2, Math.round(bloom.width / 3));
    bloom2.height = Math.max(2, Math.round(bloom.height / 3));
    buildSkyBg();
    buildTerrain();
    makeStars();
    buildGradients();
  }

  // ---------- сияние ----------
  function drawAurora(t) {
    const aw = aurora.width, ah = aurora.height;
    actx.clearRect(0, 0, aw, ah);
    actx.globalCompositeOperation = 'lighter';
    const I = params.intensity;
    const step = 3;

    for (let ci = 0; ci < CURTAINS.length; ci++) {
      const c = CURTAINS[ci];
      const ramp = RAMPS[c.ramp];
      // медленное «дыхание» всей занавеси
      const breathe = clamp(0.35 + fbm(t * c.bs + c.seed, 0.77, 2), 0.15, 1.1);

      let snS = -1; // EMA-сглаживание поля складок вдоль x (low-pass против «кирпичей»)
      for (let x = 0; x <= aw; x += step) {
        const u = x / aw;
        // основание ленты: две синусоиды + шум
        const yb = ah * (c.base
          + c.amp1 * Math.sin((u * c.k1 + t * c.s1) * TAU + c.ph1)
          + c.amp2 * Math.sin((u * c.k2 - t * c.s2) * TAU + c.ph2)
          + c.nAmp * (fbm(u * c.nk + c.seed, t * c.ns, 3) - 0.5) * 2);
        // складки-струи: 2 октавы (band-limit под шаг выборки) + EMA;
        // модулируют только яркость — лента непрерывна, усиления мягкие
        const snRaw = fbm(u * c.sk + t * c.drift2 * 10 + c.seed * 5.1, t * c.ss, 2);
        snS = snS < 0 ? snRaw : snS * 0.7 + snRaw * 0.3;
        const st = smooth(clamp((snS - 0.33) / 0.55, 0, 1));
        // высота столба — только низкочастотная огибающая: без рваных «крыш»
        const hn = fbm(u * c.hk + t * c.drift * 10 + c.seed * 2.7, t * c.hs, 3);
        const hh = Math.pow(smooth(clamp((hn - 0.28) / 0.46, 0, 1)), 1.15);
        const h = ah * lerp(c.hMin, c.hMax, hh) * (0.55 + 0.45 * breathe);
        // яркость: базовая лента + мягкие локальные усиления складок,
        // затухание там, где занавесь низкая; пик ограничен — цвет не выгорает
        const a = (0.30 + 0.70 * st) * (0.45 + 0.55 * hh) * breathe * c.alpha * I;
        if (a < 0.008 || h < 2) continue;
        // столб рисуется втрое шире с перекрытием соседей (альфа/3):
        // аддитивная сумма трёх соседей = скользящее среднее, ступеньки гаснут
        actx.globalAlpha = Math.min(0.85, a) / 3;
        actx.drawImage(ramp, 0, 0, 1, 256, x - step, yb - h, step * 3 + 1, h);
        // высокие бледные лучи в самых плотных складках — вход с нуля, без скачка
        const beam = smooth(clamp((snS - 0.58) / 0.30, 0, 1));
        if (beam > 0.01) {
          const bh = h * (1.35 + beam * 1.0);
          actx.globalAlpha = Math.min(0.35, beam * 0.34 * breathe * I) / 2;
          actx.drawImage(RAY_RAMP, 0, 0, 1, 256, x - step, yb - bh, step * 2 + 1, bh);
        }
      }
    }
    actx.globalAlpha = 1;
    actx.globalCompositeOperation = 'source-over';

    // bloom: двойной даунсэмпл, при растяжении даёт мягкий ореол
    bctx.clearRect(0, 0, bloom.width, bloom.height);
    bctx.drawImage(aurora, 0, 0, bloom.width, bloom.height);
    b2ctx.clearRect(0, 0, bloom2.width, bloom2.height);
    b2ctx.drawImage(bloom, 0, 0, bloom2.width, bloom2.height);
  }

  // ---------- метеоры ----------
  function updateMeteors(dt) {
    meteorTimer -= dt;
    if (meteorTimer <= 0 && meteors.length < 3) {
      meteorTimer = 5 + Math.random() * 10;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const sp = (360 + Math.random() * 420) * dpr;
      const ang = (16 + Math.random() * 26) * Math.PI / 180;
      meteors.push({
        x: (0.1 + Math.random() * 0.8) * W,
        y: (0.03 + Math.random() * 0.3) * horizonY,
        vx: Math.cos(ang) * sp * dir,
        vy: Math.sin(ang) * sp,
        life: 0,
        maxLife: 0.6 + Math.random() * 0.8,
      });
    }
    for (const m of meteors) {
      m.life += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
    }
    meteors = meteors.filter((m) =>
      m.life < m.maxLife && m.y < horizonY * 0.92 && m.x > -W * 0.1 && m.x < W * 1.1);
  }

  function drawMeteors(g) {
    for (const m of meteors) {
      const k = clamp(m.life / m.maxLife, 0, 1);
      const a = Math.sin(Math.PI * k);
      const trail = 0.10 + 0.06 * a;
      const tx = m.x - m.vx * trail, ty = m.y - m.vy * trail;
      const gr = g.createLinearGradient(m.x, m.y, tx, ty);
      gr.addColorStop(0, 'rgba(235,245,255,' + (0.85 * a).toFixed(3) + ')');
      gr.addColorStop(0.35, 'rgba(175,208,255,' + (0.4 * a).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(140,180,255,0)');
      g.strokeStyle = gr;
      g.lineWidth = 1.4 * dpr;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(m.x, m.y);
      g.lineTo(tx, ty);
      g.stroke();
      g.globalAlpha = 0.8 * a;
      g.fillStyle = '#f2f8ff';
      g.beginPath();
      g.arc(m.x, m.y, 1.2 * dpr, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  // ---------- сборка неба ----------
  function drawSky(t) {
    sctx.drawImage(skyBg, 0, 0);
    sctx.globalCompositeOperation = 'lighter';

    for (const s of stars) {
      const a = s.base * (1 - s.tw + s.tw * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph)));
      sctx.globalAlpha = a;
      sctx.fillStyle = s.tint < 0.22 ? '#ffe9c6' : (s.tint > 0.78 ? '#cfdfff' : '#edf3ff');
      sctx.beginPath();
      sctx.arc(s.x, s.y, s.r, 0, TAU);
      sctx.fill();
      if (s.r > 1.5 * dpr) { // блик-крест у ярких звёзд
        sctx.globalAlpha = a * 0.3;
        sctx.fillRect(s.x - s.r * 3.2, s.y - 0.5 * dpr, s.r * 6.4, dpr);
        sctx.fillRect(s.x - 0.5 * dpr, s.y - s.r * 3.2, dpr, s.r * 6.4);
      }
    }
    sctx.globalAlpha = 1;

    sctx.drawImage(aurora, 0, 0, W, horizonY);
    sctx.globalAlpha = 0.45;
    sctx.drawImage(bloom, 0, 0, W, horizonY);
    sctx.globalAlpha = 0.3;
    sctx.drawImage(bloom2, 0, 0, W, horizonY);
    sctx.globalAlpha = 1;

    drawMeteors(sctx);

    sctx.globalCompositeOperation = 'source-over';
    sctx.drawImage(terrain, 0, 0);
  }

  // ---------- финальный кадр: небо + вода + грейдинг ----------
  function render(t) {
    ctx.drawImage(sky, 0, 0);

    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, horizonY, W, H - horizonY);

    // отражение: полосы, сдвигаемые волнами по x и y
    const sq = 0.86;
    const stripH = Math.max(2, Math.round(2 * dpr));
    const srcH = stripH * sq;
    const wl = params.waves;
    const maxSrc = horizonY - srcH - 1;
    for (let y = horizonY; y < H; y += stripH) {
      const d = (y - horizonY) / (H - horizonY);
      let srcY = horizonY - (y - horizonY) * sq - srcH;
      srcY += Math.sin(y * 0.16 / dpr + t * 2.1) * dpr * (0.4 + d * 2.4) * wl;
      srcY = clamp(srcY, 0, maxSrc);
      const xo = (Math.sin(y * 0.085 / dpr + t * 1.5)
        + 0.6 * Math.sin(y * 0.21 / dpr - t * 2.6 + 1.7)) * (0.5 + d * 7) * dpr * wl;
      const shimmer = 0.8 + 0.4 * vnoise(y * 0.045 / dpr, t * 1.2);
      ctx.globalAlpha = clamp((0.52 - 0.36 * d) * shimmer, 0, 1);
      ctx.drawImage(sky, 0, srcY, W, srcH, xo, y, W, stripH);
    }
    ctx.globalAlpha = 1;

    // атмосферная дымка у горизонта
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, horizonY - 26 * dpr, W, 48 * dpr);

    // виньетка
    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(0, 0, W, H);

    // лёгкое киношное зерно
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.05;
    const gx = (Math.random() * 128) | 0, gy = (Math.random() * 128) | 0;
    ctx.translate(-gx, -gy);
    ctx.fillStyle = grainPattern;
    ctx.fillRect(0, 0, W + 128, H + 128);
    ctx.restore();
  }

  // ---------- цикл ----------
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = clamp((ts - lastTs) / 1000, 0, 0.05) || 0.016;
    lastTs = ts;
    const sdt = dt * params.speed;
    T += sdt;
    updateMeteors(sdt);
    drawAurora(T);
    drawSky(T);
    render(T);
  }

  function renderOnce() {
    drawAurora(T);
    drawSky(T);
    render(T);
  }

  function setRunning(on) {
    if (running === on) return;
    running = on;
    ui.pause.textContent = on ? '⏸ Пауза' : '▶ Продолжить';
    ui.pause.setAttribute('aria-pressed', String(!on));
    if (on) {
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(rafId);
    }
  }

  // ---------- управление ----------
  ui.pause.addEventListener('click', () => setRunning(!running));
  const bind = (el, key) => {
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (!Number.isNaN(v)) {
        params[key] = v;
        if (!running) renderOnce();
      }
    });
  };
  bind(ui.intensity, 'intensity');
  bind(ui.speed, 'speed');
  bind(ui.waves, 'waves');

  let resizePending = false;
  window.addEventListener('resize', () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      resize();
      if (!running) renderOnce();
    });
  });

  // ---------- старт ----------
  resize();
  lastTs = performance.now();
  rafId = requestAnimationFrame(frame);
})();
