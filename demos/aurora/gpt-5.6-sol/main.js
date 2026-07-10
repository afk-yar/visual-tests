(() => {
  'use strict';

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: false });
  const aurora = document.createElement('canvas');
  const ax = aurora.getContext('2d');
  const toggle = document.getElementById('toggle');
  const toggleLabel = document.getElementById('toggleLabel');
  const intensityInput = document.getElementById('intensity');
  const motionInput = document.getElementById('motion');

  let width = 0;
  let height = 0;
  let dpr = 1;
  let horizon = 0;
  let last = performance.now();
  let time = 37.4;
  let paused = false;
  let intensity = 1;
  let speed = .85;
  let stars = [];
  let mountain = [];
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const TAU = Math.PI * 2;
  const curtainLayers = [
    { clock: .78, phase: 0, y: .13, wave: .085, length: .43, center: .48, spread: .56, hue: 137, shift: 16, alpha: .155, step: 2.2 },
    { clock: .91, phase: 8, y: .18, wave: .12, length: .39, center: .33, spread: .44, hue: 164, shift: 25, alpha: .115, step: 2.4 },
    { clock: .68, phase: 17, y: .10, wave: .075, length: .34, center: .72, spread: .37, hue: 282, shift: -22, alpha: .075, step: 2.6 },
    { clock: 1.04, phase: 29, y: .235, wave: .105, length: .31, center: .57, spread: .48, hue: 125, shift: 38, alpha: .105, step: 2.1 }
  ];

  function mulberry32(seed) {
    return function random() {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function resize() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    horizon = height * .685;

    const scale = Math.min(1, 1280 / width, 760 / height);
    aurora.width = Math.max(480, Math.round(width * scale));
    aurora.height = Math.max(340, Math.round(height * scale));
    buildSceneData();
  }

  function buildSceneData() {
    const random = mulberry32(739104);
    const count = Math.floor(Math.min(360, 100 + width * height / 6200));
    stars = Array.from({ length: count }, () => ({
      x: random(),
      y: random() * .68,
      r: .25 + Math.pow(random(), 4) * 1.5,
      a: .18 + random() * .78,
      phase: random() * TAU,
      rate: .3 + random() * 1.8,
      warm: random() > .88
    }));

    mountain = [];
    for (let i = 0; i <= 90; i++) {
      const x = i / 90;
      const peaks = Math.sin(x * 19 + 1.4) * .018 + Math.sin(x * 43 + .8) * .008;
      const mass = Math.pow(Math.max(0, Math.sin(x * 5.4 + .3)), 2) * .06;
      mountain.push([x, .685 - mass - peaks]);
    }
  }

  function sky() {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#02040d');
    gradient.addColorStop(.38, '#071126');
    gradient.addColorStop(.69, '#10283a');
    gradient.addColorStop(1, '#030b13');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const cool = ctx.createRadialGradient(width * (.58 + pointer.x * .025), height * .3, 0, width * .58, height * .3, width * .68);
    cool.addColorStop(0, 'rgba(37, 67, 91, .18)');
    cool.addColorStop(.45, 'rgba(20, 38, 70, .08)');
    cool.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = cool;
    ctx.fillRect(0, 0, width, height * .75);

    const glow = ctx.createLinearGradient(0, horizon - height * .14, 0, horizon + 10);
    glow.addColorStop(0, 'rgba(54, 94, 111, 0)');
    glow.addColorStop(1, 'rgba(82, 135, 138, .12)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizon - height * .14, width, height * .15);
  }

  function drawStars(t) {
    ctx.save();
    const px = pointer.x * 4;
    const py = pointer.y * 2;
    for (const s of stars) {
      const twinkle = .72 + Math.sin(t * s.rate + s.phase) * .2 + Math.sin(t * .27 + s.phase * 2.7) * .08;
      const a = Math.max(.06, s.a * twinkle);
      const x = s.x * width + px * (1 - s.y);
      const y = s.y * height + py * (1 - s.y);
      ctx.fillStyle = s.warm ? `rgba(255,240,211,${a})` : `rgba(219,239,255,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, TAU);
      ctx.fill();

      if (s.r > 1.25) {
        ctx.strokeStyle = `rgba(213,238,255,${a * .28})`;
        ctx.lineWidth = .5;
        ctx.beginPath();
        ctx.moveTo(x - s.r * 3.5, y);
        ctx.lineTo(x + s.r * 3.5, y);
        ctx.moveTo(x, y - s.r * 3.5);
        ctx.lineTo(x, y + s.r * 3.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function ridge(x, t, band) {
    const broad = Math.sin(x * (2.15 + band * .17) + t * (.35 + band * .025) + band * 2.3);
    const fold = Math.sin(x * (6.2 + band * .37) - t * (.18 + band * .02) + band);
    const detail = Math.sin(x * 14.7 + t * .13 + band * 4.1);
    return broad * .54 + fold * .32 + detail * .14;
  }

  function drawCurtain(t, band, settings) {
    const W = aurora.width;
    const H = aurora.height;
    const step = settings.step;
    const count = Math.ceil(W / step) + 8;
    const baseY = H * settings.y;
    const waveH = H * settings.wave;
    const center = settings.center * W;
    const spread = settings.spread * W;

    ax.save();
    ax.globalCompositeOperation = 'lighter';
    ax.lineCap = 'round';

    for (let i = -4; i < count; i++) {
      const x = i * step;
      const nx = x / W;
      const r = ridge(nx * TAU, t, band);
      const r2 = ridge((nx + step / W) * TAU, t, band);
      const top = baseY + r * waveH;
      const foldPower = .42 + .58 * Math.pow(.5 + .5 * Math.sin(nx * TAU * 4.1 - t * .55 + band * 2.2), 2);
      const envelope = Math.exp(-Math.pow((x - center) / spread, 4));
      const length = H * settings.length * (1 + r * .16) * (.7 + foldPower * .42);
      const bottom = Math.min(H * .78, top + length);
      const hue = settings.hue + 22 * Math.sin(nx * TAU * 1.35 + band * 1.7 + t * .08) + settings.shift * foldPower;
      const alpha = settings.alpha * envelope * (.35 + foldPower * .8) * intensity;

      const grad = ax.createLinearGradient(x, top, x + (r2 - r) * 8, bottom);
      grad.addColorStop(0, `hsla(${hue + 10},100%,78%,0)`);
      grad.addColorStop(.035, `hsla(${hue + 5},100%,75%,${alpha * .78})`);
      grad.addColorStop(.16, `hsla(${hue},94%,64%,${alpha})`);
      grad.addColorStop(.5, `hsla(${hue - 8},92%,55%,${alpha * .34})`);
      grad.addColorStop(1, `hsla(${hue - 15},84%,46%,0)`);
      ax.strokeStyle = grad;
      ax.lineWidth = step * (1.45 + foldPower * .9);
      ax.beginPath();
      ax.moveTo(x, top);
      ax.bezierCurveTo(x + r * 8, top + length * .26, x - r2 * 7, top + length * .68, x + (r2 - r) * 9, bottom);
      ax.stroke();
    }

    // Sparse, high-contrast fibres keep the curtain vertical without
    // lifting the exposure of its softer body.
    for (let x = -4; x <= W + 4; x += step * 3.25) {
      const nx = x / W;
      const r = ridge(nx * TAU, t, band);
      const r2 = ridge((nx + step / W) * TAU, t, band);
      const top = baseY + r * waveH;
      const foldPower = .42 + .58 * Math.pow(.5 + .5 * Math.sin(nx * TAU * 4.1 - t * .55 + band * 2.2), 2);
      const filament = Math.pow(.5 + .5 * Math.sin(nx * TAU * 11.7 + t * .31 + band * 3.7), 5);
      const envelope = Math.exp(-Math.pow((x - center) / spread, 4));
      const length = H * settings.length * (.68 + foldPower * .48);
      const bottom = Math.min(H * .76, top + length);
      const hue = settings.hue + settings.shift * foldPower;
      const rayAlpha = settings.alpha * envelope * (.35 + filament * 1.35) * intensity;
      const ray = ax.createLinearGradient(x, top, x, bottom);
      ray.addColorStop(0, `hsla(${hue + 12},100%,88%,${rayAlpha * .8})`);
      ray.addColorStop(.14, `hsla(${hue + 4},100%,76%,${rayAlpha})`);
      ray.addColorStop(.68, `hsla(${hue - 5},94%,61%,${rayAlpha * .3})`);
      ray.addColorStop(1, `hsla(${hue - 8},90%,54%,0)`);
      ax.strokeStyle = ray;
      ax.lineWidth = .45 + filament * .75;
      ax.beginPath();
      ax.moveTo(x, top);
      ax.bezierCurveTo(x + r * 2.2, top + length * .28, x - r2 * 2, top + length * .7, x + (r2 - r) * 2, bottom);
      ax.stroke();
    }

    ax.globalAlpha = settings.alpha * 2.2 * intensity;
    ax.strokeStyle = `hsla(${settings.hue + 8},100%,82%,.55)`;
    ax.lineWidth = 1.1;
    ax.beginPath();
    for (let x = -10; x <= W + 10; x += step) {
      const nx = x / W;
      const y = baseY + ridge(nx * TAU, t, band) * waveH;
      if (x === -10) ax.moveTo(x, y);
      else ax.lineTo(x, y);
    }
    ax.stroke();
    ax.restore();
  }

  function renderAurora(t) {
    ax.clearRect(0, 0, aurora.width, aurora.height);
    const W = aurora.width;
    const H = aurora.height;
    const ambient = ax.createRadialGradient(W * .52, H * .25, 0, W * .52, H * .25, W * .62);
    ambient.addColorStop(0, `rgba(43,195,143,${.055 * intensity})`);
    ambient.addColorStop(.48, `rgba(40,77,126,${.028 * intensity})`);
    ambient.addColorStop(1, 'rgba(0,0,0,0)');
    ax.fillStyle = ambient;
    ax.fillRect(0, 0, W, H * .72);

    curtainLayers.forEach((layer, band) => {
      drawCurtain(t * layer.clock + layer.phase, band, layer);
    });
  }

  function compositeAurora() {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = .55;
    ctx.filter = 'blur(32px) saturate(145%)';
    ctx.drawImage(aurora, -width * .015, -height * .01, width * 1.03, height * 1.02);
    ctx.globalAlpha = .72;
    ctx.filter = 'blur(9px) saturate(130%)';
    ctx.drawImage(aurora, 0, 0, width, height);
    ctx.globalAlpha = .88;
    ctx.filter = 'saturate(118%)';
    ctx.drawImage(aurora, 0, 0, width, height);
    ctx.restore();
  }

  function drawWater(t) {
    const water = ctx.createLinearGradient(0, horizon, 0, height);
    water.addColorStop(0, 'rgba(9, 25, 36, .72)');
    water.addColorStop(.22, 'rgba(4, 17, 27, .91)');
    water.addColorStop(1, '#020811');
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, width, height - horizon);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon, width, height - horizon);
    ctx.clip();
    ctx.translate(0, horizon * 1.72);
    ctx.scale(1, -.72);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = .34 * intensity;
    ctx.filter = 'blur(10px) saturate(140%)';
    ctx.drawImage(aurora, 0, 0, width, height);
    ctx.restore();

    // Long colour columns inherit the curtain envelopes and phases. Small
    // lateral bends break the mirror image into gently moving water.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon, width, height - horizon);
    ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    const waterDepth = height - horizon;
    const reflectionStep = Math.max(4.5, width / 260);

    curtainLayers.forEach((layer, band) => {
      const layerTime = t * layer.clock + layer.phase;
      for (let x = -reflectionStep; x <= width + reflectionStep; x += reflectionStep) {
        const nx = x / width;
        const r = ridge(nx * TAU, layerTime, band);
        const foldPower = .42 + .58 * Math.pow(.5 + .5 * Math.sin(nx * TAU * 4.1 - layerTime * .55 + band * 2.2), 2);
        const envelope = Math.exp(-Math.pow((x - layer.center * width) / (layer.spread * width), 4));
        const sourceStrength = envelope * (.28 + foldPower * .72) * (layer.alpha / .155) * intensity;
        if (sourceStrength < .025) continue;

        const hue = layer.hue + 22 * Math.sin(nx * TAU * 1.35 + band * 1.7 + layerTime * .08) + layer.shift * foldPower;
        const startY = horizon + 2 + (1 + Math.sin(x * .07 + layerTime)) * 1.5;
        const streakLength = waterDepth * (.42 + foldPower * .48) * (.82 + layer.length * .35);
        const endY = Math.min(height + 8, startY + streakLength);
        const wobble = Math.sin(x * .021 + layerTime * .8 + band) * (3 + foldPower * 5);
        const shimmer = .76 + .24 * Math.sin(x * .11 - layerTime * 1.3 + band);
        const alpha = sourceStrength * shimmer;
        const reflection = ctx.createLinearGradient(x, startY, x, endY);
        reflection.addColorStop(0, `hsla(${hue + 7},100%,76%,${alpha * .34})`);
        reflection.addColorStop(.16, `hsla(${hue},96%,62%,${alpha * .42})`);
        reflection.addColorStop(.58, `hsla(${hue - 7},92%,54%,${alpha * .19})`);
        reflection.addColorStop(1, `hsla(${hue - 12},88%,48%,0)`);
        ctx.strokeStyle = reflection;
        ctx.lineWidth = reflectionStep * (1.05 + foldPower * .72);
        ctx.beginPath();
        ctx.moveTo(x + Math.sin(layerTime + x * .04) * 1.5, startY);
        ctx.bezierCurveTo(x + wobble, startY + streakLength * .28, x - wobble * .65, startY + streakLength * .7, x + wobble * .35, endY);
        ctx.stroke();
      }
    });
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 38; i++) {
      const y = horizon + 8 + i * (height - horizon) / 37;
      const phase = Math.sin(t * .35 + i * 1.73);
      const center = width * (.53 + phase * .025);
      const half = width * (.29 * (1 - i / 49));
      const alpha = (.042 + .045 * Math.sin(i * 2.2 + t) ** 2) * intensity;
      const line = ctx.createLinearGradient(center - half, y, center + half, y);
      line.addColorStop(0, 'rgba(71,194,161,0)');
      line.addColorStop(.32, `rgba(76,201,169,${alpha * .55})`);
      line.addColorStop(.52, `rgba(134,218,202,${alpha})`);
      line.addColorStop(.74, `rgba(97,129,205,${alpha * .5})`);
      line.addColorStop(1, 'rgba(74,129,174,0)');
      ctx.strokeStyle = line;
      ctx.lineWidth = .5 + i / 38 * 1.4;
      ctx.beginPath();
      ctx.moveTo(center - half + Math.sin(i + t) * 16, y);
      ctx.bezierCurveTo(center - half * .25, y + phase * 1.7, center + half * .28, y - phase * 1.3, center + half, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function polygon(points, fill, base = height) {
    ctx.beginPath();
    ctx.moveTo(points[0][0] * width, points[0][1] * height);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0] * width, points[i][1] * height);
    ctx.lineTo(points[points.length - 1][0] * width, base);
    ctx.lineTo(points[0][0] * width, base);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawLandscape(t) {
    ctx.save();
    ctx.translate(pointer.x * -2.2, pointer.y * -.6);
    const haze = ctx.createLinearGradient(0, horizon - height * .12, 0, horizon + 8);
    haze.addColorStop(0, 'rgba(35,61,73,.18)');
    haze.addColorStop(1, 'rgba(6,15,23,.96)');
    polygon(mountain, haze, horizon + 8);

    ctx.fillStyle = 'rgba(81,130,129,.15)';
    ctx.fillRect(0, horizon - 1, width, 1);
    polygon([[0,.73],[.07,.69],[.15,.71],[.23,.745],[.31,.82],[.36,1]], '#02070c');
    polygon([[1,.70],[.94,.69],[.88,.73],[.82,.79],[.78,1]], '#01060a');

    ctx.fillStyle = 'rgba(0,2,5,.95)';
    for (let i = 0; i < 31; i++) {
      const side = i < 16 ? i / 15 * .29 : .82 + (i - 16) / 14 * .18;
      const base = horizon + height * (.003 + Math.abs(.5 - side) * .025);
      const h = height * (.014 + ((i * 47) % 13) / 620);
      ctx.beginPath();
      ctx.moveTo(side * width - h * .13, base);
      ctx.lineTo(side * width, base - h);
      ctx.lineTo(side * width + h * .13, base);
      ctx.fill();
    }
    ctx.restore();

    const vignette = ctx.createRadialGradient(width * .5, height * .45, height * .18, width * .5, height * .48, Math.max(width, height) * .72);
    vignette.addColorStop(.28, 'rgba(0,0,0,0)');
    vignette.addColorStop(.72, 'rgba(0,2,8,.18)');
    vignette.addColorStop(1, 'rgba(0,1,5,.62)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = `rgba(230,247,255,${.012 + Math.sin(t * .2) * .003})`;
    ctx.fillRect(0, 0, width, height);
  }

  function frame(now) {
    const rawDt = Math.max(0, (now - last) / 1000);
    const dt = Math.min(rawDt, .05);
    last = now;
    if (!paused) time += dt * speed;
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2.8);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2.8);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sky();
    drawStars(time);
    renderAurora(time);
    compositeAurora();
    drawWater(time);
    drawLandscape(time);
    requestAnimationFrame(frame);
  }

  function setPaused(value) {
    paused = value;
    toggle.setAttribute('aria-pressed', String(paused));
    toggleLabel.textContent = paused ? 'Продолжить' : 'Пауза';
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', (event) => {
    pointer.tx = event.clientX / Math.max(1, width) * 2 - 1;
    pointer.ty = event.clientY / Math.max(1, height) * 2 - 1;
  }, { passive: true });
  window.addEventListener('pointerleave', () => { pointer.tx = 0; pointer.ty = 0; });
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && event.target.tagName !== 'INPUT') {
      event.preventDefault();
      setPaused(!paused);
    }
  });
  toggle.addEventListener('click', () => setPaused(!paused));
  intensityInput.addEventListener('input', () => { intensity = Number(intensityInput.value) / 100; });
  motionInput.addEventListener('input', () => { speed = Number(motionInput.value) / 100; });
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  resize();
  requestAnimationFrame(frame);
})();
