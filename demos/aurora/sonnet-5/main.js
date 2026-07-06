'use strict';
(function () {
  const wave = window.AuroraWave;
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ---------------------------------------------------------------------
  // Состояние сцены и управления
  // ---------------------------------------------------------------------
  const state = {
    running: true,
    speed: 1,
    intensity: 1,
    theme: 'classic',
    showReflection: true,
    showStars: true,
  };

  let width = 0, height = 0, dpr = 1, horizonY = 0;

  // Офскрин-слои
  const skyLayer = document.createElement('canvas');
  const skyCtx = skyLayer.getContext('2d');
  const landscapeLayer = document.createElement('canvas');
  const landscapeCtx = landscapeLayer.getContext('2d');
  const bloomBuf = document.createElement('canvas');
  const bloomCtx = bloomBuf.getContext('2d');
  const BLOOM_SCALE = 0.35;

  let ramps = null;         // палитры-текстуры занавесей (строятся один раз)
  let stars = [];
  let shootingStars = [];
  let mountainPath = null;  // { ridge:[], segments }
  let grainTile = null;
  let grainPattern = null;
  let moon = null;

  // ---------------------------------------------------------------------
  // Палитры занавесей полярного сияния: низ (0) — у горизонта, верх (1) — макушка складки.
  // Зелёный у основания (реальная физика — свечение кислорода на малой высоте),
  // переход через голубой/бирюзовый к пурпурному/фиолетовому на вершине (азот на высоте).
  // ---------------------------------------------------------------------
  const PALETTES = {
    classic: [
      [0.00, '6,255,150,0'],
      [0.10, '10,255,150,0.55'],
      [0.34, '60,255,175,0.92'],
      [0.58, '70,235,210,0.7'],
      [0.78, '110,160,255,0.55'],
      [0.93, '190,110,255,0.32'],
      [1.00, '215,130,255,0'],
    ],
    emerald: [
      [0.00, '10,255,140,0'],
      [0.12, '20,255,140,0.6'],
      [0.40, '70,255,180,0.95'],
      [0.70, '110,255,190,0.6'],
      [0.90, '150,255,210,0.3'],
      [1.00, '190,255,220,0'],
    ],
    violet: [
      [0.00, '40,120,255,0'],
      [0.14, '60,140,255,0.5'],
      [0.40, '130,110,255,0.85'],
      [0.68, '190,90,255,0.85'],
      [0.88, '230,120,220,0.45'],
      [1.00, '255,160,220,0'],
    ],
  };

  const THEME_LAYER_PALETTES = {
    classic: ['classic', 'violet', 'emerald'],
    emerald: ['emerald', 'classic', 'emerald'],
    violet: ['violet', 'violet', 'classic'],
  };

  // Три слоя-занавеса: разный охват по X, высота, скорость и «сид» шума —
  // чтобы слои не совпадали друг с другом и давали ощущение глубины.
  const LAYER_DEFS = [
    { xSpan: [0.00, 0.62], heightFrac: 0.34, topFrac: 0.06, speed: 0.9, seed: 3.1, colW: 0.011 },
    { xSpan: [0.28, 1.00], heightFrac: 0.30, topFrac: 0.10, speed: 1.15, seed: 41.7, colW: 0.009 },
    { xSpan: [0.48, 1.00], heightFrac: 0.24, topFrac: 0.14, speed: 0.7, seed: 88.2, colW: 0.013 },
  ];

  function buildRamps() {
    ramps = {};
    const rw = 6, rh = 420;
    for (const name in PALETTES) {
      const c = document.createElement('canvas');
      c.width = rw;
      c.height = rh;
      const rc = c.getContext('2d');
      const grad = rc.createLinearGradient(0, rh, 0, 0); // низ->верх соответствует стопам 0..1
      for (const [stop, rgba] of PALETTES[name]) {
        grad.addColorStop(stop, 'rgba(' + rgba + ')');
      }
      rc.fillStyle = grad;
      rc.fillRect(0, 0, rw, rh);
      ramps[name] = c;
    }
  }

  function buildGrain() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const gctx = c.getContext('2d');
    const img = gctx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() * 2 - 1) * 70;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    gctx.putImageData(img, 0, 0);
    grainTile = c;
    grainPattern = null; // пересобрать под актуальный ctx
  }

  // ---------------------------------------------------------------------
  // Resize: пересчёт размеров и всего, что зависит от геометрии сцены
  // ---------------------------------------------------------------------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.round(window.innerWidth);
    height = Math.round(window.innerHeight);
    horizonY = height * 0.6;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    skyLayer.width = canvas.width;
    skyLayer.height = canvas.height;
    skyCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    landscapeLayer.width = canvas.width;
    landscapeLayer.height = canvas.height;
    landscapeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    bloomBuf.width = Math.max(2, Math.round(canvas.width * BLOOM_SCALE));
    bloomBuf.height = Math.max(2, Math.round(canvas.height * BLOOM_SCALE));

    grainPattern = null;

    buildStars();
    buildMoon();
    buildLandscape();
  }

  // ---------------------------------------------------------------------
  // Звёзды
  // ---------------------------------------------------------------------
  function buildStars() {
    const area = width * horizonY;
    const count = clamp(Math.round(area / 1800), 140, 520);
    const tints = ['#ffffff', '#dce8ff', '#fff3df', '#cfe8ff'];
    stars = [];
    for (let i = 0; i < count; i++) {
      const hero = Math.random() < 0.03;
      stars.push({
        x: Math.random() * width,
        y: Math.random() * horizonY * 0.97,
        r: hero ? 1.6 + Math.random() * 1.1 : 0.4 + Math.random() * 1.15,
        baseAlpha: 0.45 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.6,
        tint: tints[(Math.random() * tints.length) | 0],
        hero,
      });
    }
    shootingStars = [];
  }

  function buildMoon() {
    moon = {
      x: width * (0.14 + Math.random() * 0.72),
      y: horizonY * (0.14 + Math.random() * 0.18),
      r: Math.max(16, width * 0.013),
    };
  }

  function updateShootingStars(t, dt) {
    if (state.running && Math.random() < dt * 0.14) {
      const y0 = Math.random() * horizonY * 0.6;
      shootingStars.push({
        x: Math.random() * width * 0.7 + width * 0.15,
        y: y0,
        angle: Math.PI * 0.22 + Math.random() * 0.25,
        len: 60 + Math.random() * 90,
        life: 0,
        maxLife: 0.7 + Math.random() * 0.4,
        vx: 0,
      });
    }
    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const s = shootingStars[i];
      if (state.running) {
        s.life += dt;
        s.x += Math.cos(s.angle) * 620 * dt;
        s.y += Math.sin(s.angle) * 620 * dt;
      }
      const k = s.life / s.maxLife;
      s.alpha = k < 0.15 ? k / 0.15 : clamp(1 - (k - 0.15) / 0.85, 0, 1);
      if (k >= 1) shootingStars.splice(i, 1);
    }
  }

  function drawMoon(g) {
    if (!moon) return;
    g.save();
    const halo = g.createRadialGradient(moon.x, moon.y, 0, moon.x, moon.y, moon.r * 6.5);
    halo.addColorStop(0, 'rgba(210,225,255,0.32)');
    halo.addColorStop(1, 'rgba(210,225,255,0)');
    g.fillStyle = halo;
    g.beginPath();
    g.arc(moon.x, moon.y, moon.r * 6.5, 0, Math.PI * 2);
    g.fill();

    const body = g.createRadialGradient(
      moon.x - moon.r * 0.3, moon.y - moon.r * 0.3, moon.r * 0.1,
      moon.x, moon.y, moon.r
    );
    body.addColorStop(0, '#fbfdff');
    body.addColorStop(1, '#c3cfe4');
    g.fillStyle = body;
    g.beginPath();
    g.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
    g.fill();

    g.globalAlpha = 0.16;
    g.fillStyle = '#8296b8';
    g.beginPath();
    g.arc(moon.x - moon.r * 0.32, moon.y + moon.r * 0.22, moon.r * 0.22, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(moon.x + moon.r * 0.26, moon.y - moon.r * 0.18, moon.r * 0.14, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawStars(g, t, dt) {
    if (!state.showStars) {
      shootingStars = [];
      return;
    }
    g.save();
    for (const s of stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * s.speed + s.phase);
      const a = clamp(s.baseAlpha * (0.55 + 0.45 * tw), 0, 1);
      g.globalAlpha = a;
      g.fillStyle = s.tint;
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      g.fill();
      if (s.hero) {
        g.globalAlpha = a * 0.3;
        g.beginPath();
        g.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();

    updateShootingStars(t, dt);
    for (const sh of shootingStars) {
      const tailX = sh.x - sh.len * Math.cos(sh.angle);
      const tailY = sh.y - sh.len * Math.sin(sh.angle);
      g.save();
      g.globalAlpha = sh.alpha;
      const grad = g.createLinearGradient(sh.x, sh.y, tailX, tailY);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = grad;
      g.lineWidth = 1.6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(sh.x, sh.y);
      g.lineTo(tailX, tailY);
      g.stroke();
      g.restore();
    }
  }

  // ---------------------------------------------------------------------
  // Ландшафт: силуэт хребта (midpoint displacement) + редкие ели, статично
  // ---------------------------------------------------------------------
  function midpointDisplace(arr, i0, i1, amp) {
    if (i1 - i0 < 2) return;
    const mid = Math.floor((i0 + i1) / 2);
    arr[mid] = (arr[i0] + arr[i1]) / 2 + (Math.random() * 2 - 1) * amp;
    midpointDisplace(arr, i0, mid, amp * 0.55);
    midpointDisplace(arr, mid, i1, amp * 0.55);
  }

  function buildLandscape() {
    const segments = 64;
    const ridge = new Array(segments + 1);
    ridge[0] = horizonY - (0.02 + Math.random() * 0.05) * height;
    ridge[segments] = horizonY - (0.02 + Math.random() * 0.05) * height;
    midpointDisplace(ridge, 0, segments, height * 0.16);
    const minTop = horizonY - height * 0.24;
    for (let i = 0; i <= segments; i++) {
      ridge[i] = clamp(ridge[i], minTop, horizonY - 2);
    }
    mountainPath = { ridge, segments };

    landscapeCtx.clearRect(0, 0, width, height);
    landscapeCtx.beginPath();
    landscapeCtx.moveTo(0, horizonY);
    for (let i = 0; i <= segments; i++) {
      landscapeCtx.lineTo((i / segments) * width, ridge[i]);
    }
    landscapeCtx.lineTo(width, horizonY);
    landscapeCtx.closePath();
    const grad = landscapeCtx.createLinearGradient(0, minTop, 0, horizonY);
    grad.addColorStop(0, '#050a15');
    grad.addColorStop(1, '#01030a');
    landscapeCtx.fillStyle = grad;
    landscapeCtx.fill();

    // Редкие силуэты елей вдоль подножия хребта — для текстуры переднего плана.
    const treeCount = Math.floor(width / 42);
    for (let i = 0; i < treeCount; i++) {
      const frac = Math.random();
      const idx = frac * segments;
      const i0 = Math.floor(idx);
      const i1 = Math.min(segments, i0 + 1);
      const lt = idx - i0;
      const rx = frac * width;
      const ry = ridge[i0] * (1 - lt) + ridge[i1] * lt + Math.random() * 10;
      if (ry > horizonY - 6) continue;
      const th = 11 + Math.random() * 22;
      const tw = th * 0.42;
      landscapeCtx.beginPath();
      landscapeCtx.moveTo(rx, ry - th);
      landscapeCtx.lineTo(rx - tw / 2, ry + 2);
      landscapeCtx.lineTo(rx + tw / 2, ry + 2);
      landscapeCtx.closePath();
      landscapeCtx.fillStyle = '#020509';
      landscapeCtx.fill();
    }
  }

  function drawLandscape(g, t) {
    g.drawImage(landscapeLayer, 0, 0, landscapeLayer.width, landscapeLayer.height, 0, 0, width, height);
    if (!mountainPath) return;
    const { ridge, segments } = mountainPath;
    const hue = 0.5 + 0.5 * Math.sin(t * 0.15);
    const rimColor = 'rgba(' + Math.round(90 + 120 * hue) + ',' + Math.round(235 - 55 * hue) + ',' + Math.round(175 + 60 * hue) + ',0.5)';
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = rimColor;
    g.lineWidth = 2.2;
    g.shadowColor = rimColor;
    g.shadowBlur = 16;
    g.beginPath();
    for (let i = 0; i <= segments; i++) {
      const x = (i / segments) * width;
      if (i === 0) g.moveTo(x, ridge[i]); else g.lineTo(x, ridge[i]);
    }
    g.stroke();
    g.restore();
  }

  // ---------------------------------------------------------------------
  // Полярное сияние: слои-занавесы, растянутые по вертикали текстуры-рампы
  // ---------------------------------------------------------------------
  function drawAurora(g, t) {
    const paletteOrder = THEME_LAYER_PALETTES[state.theme] || THEME_LAYER_PALETTES.classic;
    for (let li = 0; li < LAYER_DEFS.length; li++) {
      const def = LAYER_DEFS[li];
      const ramp = ramps[paletteOrder[li]];
      const x0 = def.xSpan[0] * width;
      const x1 = def.xSpan[1] * width;
      const colWidth = Math.max(4, width * def.colW);
      const topMargin = height * def.topFrac;
      const maxHeight = Math.max(10, (horizonY - topMargin) * def.heightFrac * 2.4);

      for (let x = x0; x < x1; x += colWidth) {
        const sh = wave.curtainShape(x * 0.5 + def.seed * 1000, t * def.speed, def.seed);
        const heightN = 0.35 + 0.65 * ((sh.height + 1) / 2);
        const h = Math.min(horizonY - topMargin - 4, maxHeight * heightN);
        const fold = (sh.flicker + 1) / 2;
        const drift = sh.drift * colWidth * 2.5;
        const topY = horizonY - h;
        const baseW = colWidth * (0.7 + 0.9 * fold);
        const alpha = clamp((0.2 + 0.6 * fold) * state.intensity, 0, 1);

        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = alpha;
        g.drawImage(ramp, 0, 0, ramp.width, ramp.height, x + drift - baseW / 2, topY, baseW, h);
        g.restore();

        if (fold > 0.68) {
          const rayW = Math.max(1.2, baseW * 0.2);
          const rayAlpha = clamp(((fold - 0.68) / 0.32) * 0.85 * state.intensity, 0, 1);
          g.save();
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = rayAlpha;
          g.drawImage(ramp, 0, 0, ramp.width, ramp.height, x + drift - rayW / 2, topY - h * 0.06, rayW, h * 1.14);
          g.restore();
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // Фон неба (общий градиент для sky-слоя и главного канваса)
  // ---------------------------------------------------------------------
  function drawBaseGradient(g) {
    const grad = g.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#010208');
    grad.addColorStop(0.42, '#040a18');
    grad.addColorStop(0.6, '#0a2032');
    grad.addColorStop(0.61, '#050d16');
    grad.addColorStop(1, '#01030a');
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
  }

  // ---------------------------------------------------------------------
  // Отражение сияния в подножии (лёд/озеро) с волновым искажением
  // ---------------------------------------------------------------------
  function drawForegroundShade() {
    const reflectH = height - horizonY;
    if (reflectH <= 0) return;
    const dark = ctx.createLinearGradient(0, horizonY, 0, height);
    dark.addColorStop(0, 'rgba(2,4,10,0)');
    dark.addColorStop(0.5, 'rgba(2,4,10,0.35)');
    dark.addColorStop(1, 'rgba(1,2,6,0.9)');
    ctx.fillStyle = dark;
    ctx.fillRect(0, horizonY, width, reflectH);

    const shine = ctx.createLinearGradient(0, horizonY, 0, horizonY + Math.min(40, reflectH));
    shine.addColorStop(0, 'rgba(180,255,230,0.22)');
    shine.addColorStop(1, 'rgba(180,255,230,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(0, horizonY, width, Math.min(40, reflectH));
  }

  function drawReflection(t) {
    const reflectH = height - horizonY;
    if (reflectH <= 0) return;
    const sy0 = Math.max(0, horizonY - reflectH);
    const sh = horizonY - sy0;
    if (sh <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizonY, width, reflectH);
    ctx.clip();

    // Мягкая база отражения без ряби — общий цветовой отклик воды/льда.
    ctx.save();
    ctx.translate(0, horizonY + reflectH);
    ctx.scale(1, -1);
    ctx.filter = 'blur(9px)';
    ctx.globalAlpha = 0.4;
    ctx.drawImage(skyLayer, 0, sy0 * dpr, skyLayer.width, sh * dpr, 0, 0, width, reflectH);
    ctx.restore();

    // Рябь: тонкие горизонтальные полосы со сдвигом по x, растущим по мере удаления от кромки.
    ctx.save();
    ctx.translate(0, horizonY + reflectH);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.42;
    const stripCss = 3;
    for (let ly = 0; ly < reflectH; ly += stripCss) {
      const distFromMirror = reflectH - ly;
      const rippleAmp = 1.5 + 5.5 * (distFromMirror / reflectH);
      const dx = Math.sin(ly * 0.09 + t * 1.3) * rippleAmp;
      const srcYfrac = ly / reflectH;
      const srcY = sy0 + srcYfrac * sh;

      let sx = dx * dpr;
      let sw = skyLayer.width;
      if (sx < 0) { sw += sx; sx = 0; }
      if (sx + sw > skyLayer.width) sw = skyLayer.width - sx;
      if (sw <= 1) continue;

      ctx.drawImage(skyLayer, sx, srcY * dpr, sw, Math.max(1, stripCss * dpr), 0, ly, width, stripCss + 1);
    }
    ctx.restore();

    ctx.restore(); // снять clip

    drawForegroundShade();
  }

  // ---------------------------------------------------------------------
  // Виньетка и киношное зерно
  // ---------------------------------------------------------------------
  function drawVignette() {
    const g = ctx.createRadialGradient(width / 2, height * 0.55, height * 0.22, width / 2, height * 0.55, height * 0.88);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  function drawGrain(t) {
    if (!grainPattern) grainPattern = ctx.createPattern(grainTile, 'repeat');
    ctx.save();
    ctx.globalAlpha = 0.045;
    ctx.globalCompositeOperation = 'overlay';
    ctx.translate((Math.sin(t * 13) * 6) | 0, (Math.cos(t * 9.3) * 6) | 0);
    ctx.fillStyle = grainPattern;
    ctx.fillRect(-16, -16, width + 32, height + 32);
    ctx.restore();
  }

  // ---------------------------------------------------------------------
  // Главный цикл рендера
  // ---------------------------------------------------------------------
  let lastTime = null;
  let simTime = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (lastTime == null) lastTime = now;
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    dt = Math.min(dt, 0.05); // клампим скачок dt (смена вкладки и т.п.)

    if (state.running) simTime += dt * state.speed;

    // 1. Базовый фон на главном канвасе (покрывает и небо, и передний план)
    drawBaseGradient(ctx);

    // 2. Sky-слой: фон + луна + звёзды + сияние (обрезано по линии горизонта)
    drawBaseGradient(skyCtx);
    skyCtx.save();
    skyCtx.beginPath();
    skyCtx.rect(0, 0, width, horizonY);
    skyCtx.clip();
    drawMoon(skyCtx);
    drawStars(skyCtx, simTime, dt);
    drawAurora(skyCtx, simTime);
    skyCtx.restore();
    drawLandscape(skyCtx, simTime);

    // 3. Bloom: уменьшенная копия sky-слоя, размытая и добавленная поверх (дешёвое кинематографичное свечение)
    bloomCtx.clearRect(0, 0, bloomBuf.width, bloomBuf.height);
    bloomCtx.drawImage(skyLayer, 0, 0, skyLayer.width, skyLayer.height, 0, 0, bloomBuf.width, bloomBuf.height);
    ctx.save();
    ctx.filter = 'blur(6px)';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(0.5 * state.intensity, 0, 0.85);
    ctx.drawImage(bloomBuf, 0, 0, bloomBuf.width, bloomBuf.height, 0, 0, width, height);
    ctx.restore();

    // 4. Чёткий sky-слой поверх bloom
    ctx.drawImage(skyLayer, 0, 0, skyLayer.width, skyLayer.height, 0, 0, width, height);

    // 5. Отражение сияния в подножии
    if (state.showReflection) drawReflection(simTime);
    else drawForegroundShade();

    // 6. Финальная киношная обработка
    drawVignette();
    drawGrain(simTime);
  }

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------
  function initUI() {
    const elIntensity = document.getElementById('ctl-intensity');
    const elSpeed = document.getElementById('ctl-speed');
    const elReflection = document.getElementById('ctl-reflection');
    const elStars = document.getElementById('ctl-stars');
    const elPause = document.getElementById('ctl-pause');
    const themeBtns = Array.from(document.querySelectorAll('.theme-btn'));

    elIntensity.addEventListener('input', () => { state.intensity = Number(elIntensity.value); });
    elSpeed.addEventListener('input', () => { state.speed = Number(elSpeed.value); });
    elReflection.addEventListener('change', () => { state.showReflection = elReflection.checked; });
    elStars.addEventListener('change', () => { state.showStars = elStars.checked; });
    elPause.addEventListener('click', () => {
      state.running = !state.running;
      elPause.textContent = state.running ? 'Пауза' : 'Продолжить';
    });
    themeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.theme = btn.dataset.theme;
        themeBtns.forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
  }

  // ---------------------------------------------------------------------
  // Инициализация
  // ---------------------------------------------------------------------
  buildRamps();
  buildGrain();
  resize();
  initUI();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
