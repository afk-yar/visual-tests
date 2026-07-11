(() => {
  'use strict';
  const canvas = document.getElementById('flowCanvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!ctx) return;
  const TAU = Math.PI * 2;
  const countInput = document.getElementById('particleRange');
  const energyInput = document.getElementById('energyRange');
  const rotationInput = document.getElementById('rotationRange');
  const particleValue = document.getElementById('particleValue');
  const energyValue = document.getElementById('energyValue');
  const rotationValue = document.getElementById('rotationValue');
  const paletteValue = document.getElementById('paletteValue');
  const pauseButton = document.getElementById('pauseButton');
  const pauseText = document.getElementById('pauseText');
  const statusText = document.getElementById('statusText');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width = 1; let height = 1; let dpr = 1; let centerX = .5; let centerY = .5; let focal = 500;
  let lastTime = performance.now(); let elapsed = 0; let paused = false; let pointerActive = false;
  let pointerX = 0; let pointerY = 0; let cameraYaw = -.18; let cameraPitch = -.12;
  let particleCount = 22000; let energy = .82; let rotation = .14; let palette = 'aurora';
  let px; let py; let pz; let pAge; let pLife; let pSeed; let prevSX; let prevSY; let prevValid;
  const field = [0, 0, 0];
  const palettes = {
    aurora: { name: 'Aurora', hues: [174, 202, 237, 268, 315], background: [3, 7, 20] },
    ember: { name: 'Ember', hues: [28, 6, 342, 292, 260], background: [10, 5, 18] },
    polar: { name: 'Polar', hues: [190, 210, 230, 249, 266], background: [3, 8, 22] }
  };
  const random = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smoothstep = (edge0, edge1, value) => { const x = clamp((value - edge0) / (edge1 - edge0), 0, 1); return x * x * (3 - 2 * x); };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2); width = Math.max(1, window.innerWidth); height = Math.max(1, window.innerHeight);
    centerX = width * .5; centerY = height * .48; focal = Math.min(width, height) * .92;
    canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr); canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); paintBackdrop(true);
    for (let i = 0; i < particleCount; i += 1) prevValid[i] = 0;
  }

  function initParticles() {
    px = new Float32Array(particleCount); py = new Float32Array(particleCount); pz = new Float32Array(particleCount);
    pAge = new Float32Array(particleCount); pLife = new Float32Array(particleCount); pSeed = new Float32Array(particleCount);
    prevSX = new Float32Array(particleCount); prevSY = new Float32Array(particleCount); prevValid = new Uint8Array(particleCount);
    for (let i = 0; i < particleCount; i += 1) respawn(i, true);
  }

  function respawn(i, initial) {
    const angle = Math.random() * TAU; const radius = Math.pow(Math.random(), .55) * 2.45;
    px[i] = Math.cos(angle) * radius + random(-.38, .38); py[i] = Math.sin(angle) * radius * .65 + random(-.7, .7); pz[i] = random(-2.35, 2.35);
    pAge[i] = initial ? random(0, 8) : 0; pLife[i] = random(7, 17); pSeed[i] = Math.random() * 1000; prevValid[i] = 0;
  }

  // Аналитическое curl-подобное поле: у каждой частицы независимый 3D-сэмпл,
  // поэтому потоку не нужны текстуры, сетка, сборка или внешние ресурсы.
  function sampleField(x, y, z, time, seed) {
    const phase = seed * .003; const ax = y * 1.35 + time * .14 + phase; const az = z * 2.1 - time * .11 - phase * .7;
    const bz = z * 1.1 - time * .13 + phase * .45; const bx = x * 1.7 + time * .09 - phase;
    const cxy = x * 1.25 + y * .45 + time * .07 + phase * .3; const cyz = y * 1.9 - z * .7 - time * .08;
    let vx = .45 * Math.cos(cxy) - .76 * Math.sin(cyz) + 1.1 * Math.sin(bz); let vy = -.945 * Math.sin(az) - 1.25 * Math.cos(cxy);
    let vz = .935 * Math.cos(bx) - 1.35 * Math.cos(ax); const swirl = Math.sin(time * .1 + z * .9) * .16;
    vx += -z * (.12 + swirl * .15); vz += x * (.09 + swirl * .1);
    const mouseX = pointerActive ? ((pointerX / width) - .5) * 2 : 0; const mouseY = pointerActive ? ((pointerY / height) - .5) * 2 : 0;
    const mouseRadius = Math.hypot(x - mouseX * 1.2, y + mouseY * .85); const mousePull = smoothstep(2.4, .15, mouseRadius) * .22;
    field[0] = vx + (mouseX * 1.2 - x) * mousePull; field[1] = vy + (-mouseY * .9 - y) * mousePull; field[2] = vz;
  }

  function project(x, y, z) {
    const cosY = Math.cos(cameraYaw); const sinY = Math.sin(cameraYaw); const rx = x * cosY - z * sinY; const rz = x * sinY + z * cosY;
    const cosP = Math.cos(cameraPitch); const sinP = Math.sin(cameraPitch); const ry = y * cosP - rz * sinP; const depth = y * sinP + rz * cosP + 4.45;
    const scale = focal / Math.max(.7, depth); return [centerX + rx * scale, centerY + ry * scale, depth, scale];
  }

  function paintBackdrop(firstFrame) {
    const bg = palettes[palette].background; ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (firstFrame) { ctx.fillStyle = `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`; ctx.fillRect(0, 0, width, height); }
    const glow = (x, y, radius, color, alpha) => {
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `hsla(${color}, 88%, 66%, ${alpha})`); gradient.addColorStop(.28, `hsla(${color}, 76%, 42%, ${alpha * .35})`); gradient.addColorStop(1, `hsla(${color}, 60%, 25%, 0)`);
      ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };
    ctx.globalCompositeOperation = 'lighter'; const t = elapsed * .00004;
    glow(width * (.28 + Math.sin(t) * .025), height * .46, Math.max(width, height) * .52, palettes[palette].hues[1], .07);
    glow(width * (.74 + Math.cos(t * .8) * .03), height * .4, Math.max(width, height) * .44, palettes[palette].hues[3], .055);
    glow(width * .54, height * .9, Math.max(width, height) * .36, palettes[palette].hues[0], .045);
    ctx.globalCompositeOperation = 'source-over';
    if (!firstFrame) { ctx.fillStyle = `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, .075)`; ctx.fillRect(0, 0, width, height); }
  }

  function drawParticles(dt) {
    const paths = Array.from({ length: 16 }, () => new Path2D()); const glints = Array.from({ length: 6 }, () => new Path2D());
    const hueSet = palettes[palette].hues; const speedScale = .36 * energy; const time = elapsed * .001;
    for (let i = 0; i < particleCount; i += 1) {
      sampleField(px[i], py[i], pz[i], time, pSeed[i]);
      const fx = field[0]; const fy = field[1]; const fz = field[2]; const speed = Math.hypot(fx, fy, fz); const invSpeed = speed > .0001 ? 1 / speed : 1;
      const step = speedScale * dt * (.72 + Math.min(1.4, speed * .17)); px[i] += fx * step; py[i] += fy * step; pz[i] += fz * step; pAge[i] += dt;
      if (pAge[i] > pLife[i] || Math.abs(px[i]) > 3.3 || Math.abs(py[i]) > 2.5 || Math.abs(pz[i]) > 3.2) { respawn(i, false); continue; }
      const point = project(px[i], py[i], pz[i]); const sx = point[0]; const sy = point[1]; const depth = clamp((point[2] - 1.9) / 5.3, 0, 1);
      const near = 1 - depth; const lifeFade = Math.min(1, pAge[i] * 1.4, (pLife[i] - pAge[i]) * 1.2); const edgeFade = smoothstep(80, Math.min(width, height) * .5, Math.min(Math.abs(sx - centerX), Math.abs(sy - centerY)));
      const visualSpeed = clamp(speed * .16, 0, 1); let hue = hueSet[Math.floor((i * .017 + depth * 4 + visualSpeed * 3) % hueSet.length)]; if (hue < 0) hue += 360;
      const bin = Math.min(15, Math.max(0, Math.floor((hue / 360) * 16))); const trail = Math.min(13, Math.max(2.2, point[3] * (.004 + visualSpeed * .005) * (1 + energy * .5)));
      if (prevValid[i]) { paths[bin].moveTo(prevSX[i], prevSY[i]); paths[bin].lineTo(sx, sy); }
      prevSX[i] = sx; prevSY[i] = sy; prevValid[i] = 1;
      if ((i % 19 === 0 || visualSpeed > .8 && i % 7 === 0) && sx > -30 && sx < width + 30 && sy > -30 && sy < height + 30) {
        const glint = glints[Math.min(5, Math.floor(near * 5))]; glint.moveTo(sx + point[3] * fx * invSpeed * .002, sy + point[3] * fy * invSpeed * .002); glint.arc(sx, sy, Math.max(.45, trail * .2), 0, TAU);
      }
    }
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let i = 0; i < paths.length; i += 1) { const hue = Math.round((i / paths.length) * 360); ctx.strokeStyle = `hsla(${hue}, 90%, ${68 + (i % 3) * 7}%, .42)`; ctx.globalAlpha = .35 + (i % 4) * .06; ctx.lineWidth = .55 + (i % 5) * .18 + energy * .22; ctx.stroke(paths[i]); }
    for (let i = 0; i < glints.length; i += 1) { ctx.fillStyle = `hsla(${hueSet[(i + 1) % hueSet.length]}, 100%, 78%, ${.18 + i * .025})`; ctx.globalAlpha = .7; ctx.fill(glints[i]); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawVignette() {
    const radius = Math.max(width, height) * .72; const vignette = ctx.createRadialGradient(centerX, centerY * .95, radius * .18, centerX, centerY, radius);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)'); vignette.addColorStop(.62, 'rgba(0, 0, 0, .07)'); vignette.addColorStop(1, 'rgba(0, 0, 0, .58)'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
    const topFade = ctx.createLinearGradient(0, 0, 0, height * .32); topFade.addColorStop(0, 'rgba(1, 3, 12, .3)'); topFade.addColorStop(1, 'rgba(1, 3, 12, 0)'); ctx.fillStyle = topFade; ctx.fillRect(0, 0, width, height * .32);
  }

  function frame(now) {
    const dt = Math.min(.034, Math.max(.001, (now - lastTime) / 1000)); lastTime = now;
    if (!paused) { elapsed += dt * 1000; if (!reduceMotion) { cameraYaw += dt * rotation * .18; cameraPitch = -.12 + Math.sin(elapsed * .00013) * .035; } paintBackdrop(false); drawParticles(dt); drawVignette(); }
    requestAnimationFrame(frame);
  }
  function formatCount(value) { return Number(value).toLocaleString('ru-RU'); }
  function updateLabels() {
    particleValue.value = formatCount(particleCount); particleValue.textContent = formatCount(particleCount); energyValue.value = energy.toFixed(2); energyValue.textContent = energy.toFixed(2);
    rotationValue.value = `${rotation.toFixed(2)}×`; rotationValue.textContent = `${rotation.toFixed(2)}×`; paletteValue.textContent = palettes[palette].name; statusText.textContent = paused ? 'PAUSED / CANVAS 2D' : 'LIVE / CANVAS 2D';
  }
  function setPaused(next) { paused = next; pauseText.textContent = paused ? 'Продолжить' : 'Пауза'; pauseButton.querySelector('.pause-icon').textContent = paused ? '▶' : 'Ⅱ'; updateLabels(); }

  countInput.addEventListener('input', (event) => { particleCount = Number(event.target.value); initParticles(); updateLabels(); });
  energyInput.addEventListener('input', (event) => { energy = Number(event.target.value); updateLabels(); });
  rotationInput.addEventListener('input', (event) => { rotation = Number(event.target.value); updateLabels(); });
  pauseButton.addEventListener('click', () => setPaused(!paused)); document.getElementById('reseedButton').addEventListener('click', () => initParticles());
  document.querySelectorAll('.palette-swatch').forEach((button) => { button.addEventListener('click', () => { palette = button.dataset.palette; document.querySelectorAll('.palette-swatch').forEach((swatch) => swatch.classList.toggle('is-active', swatch === button)); paintBackdrop(true); updateLabels(); }); });
  window.addEventListener('keydown', (event) => { if (event.code === 'Space' && event.target === document.body) { event.preventDefault(); setPaused(!paused); } });
  canvas.addEventListener('pointermove', (event) => { pointerActive = true; pointerX = event.clientX; pointerY = event.clientY; }); canvas.addEventListener('pointerleave', () => { pointerActive = false; });
  canvas.addEventListener('pointerdown', (event) => { pointerActive = true; pointerX = event.clientX; pointerY = event.clientY; }); window.addEventListener('resize', resize, { passive: true });

  initParticles(); resize(); updateLabels(); requestAnimationFrame(frame);
})();


