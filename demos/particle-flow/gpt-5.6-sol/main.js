(() => {
  'use strict';

  const canvas = document.getElementById('flow');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const trails = document.createElement('canvas');
  const tctx = trails.getContext('2d', { alpha: true, desynchronized: true });
  const bloom = document.createElement('canvas');
  const bctx = bloom.getContext('2d', { alpha: true });
  const pauseButton = document.getElementById('pauseButton');
  const colorButton = document.getElementById('colorButton');
  const glowControl = document.getElementById('glowControl');
  const countLabel = document.querySelector('.hud p');

  const TAU = Math.PI * 2;
  const WORLD = 5.7;
  const FOCAL = 4.4;
  const COLOR_BUCKETS = 8;
  const DEPTH_LAYERS = 5;
  const PATH_COUNT = COLOR_BUCKETS * DEPTH_LAYERS;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const paletteSpeed = [
    [58, 125, 255], [45, 173, 255], [47, 226, 246], [88, 247, 215],
    [180, 246, 177], [255, 221, 145], [255, 150, 137], [255, 101, 191]
  ];
  const paletteDepth = [
    [45, 75, 145], [45, 105, 184], [45, 150, 220], [55, 199, 235],
    [83, 230, 220], [141, 239, 208], [204, 239, 203], [255, 226, 205]
  ];

  let w = 1;
  let h = 1;
  let dpr = 1;
  let particles = 0;
  let px, py, pz, life, seed;
  let time = 0;
  let last = performance.now();
  let paused = false;
  let colorByDepth = false;
  let exposure = .70;
  let pointerX = 0;
  let pointerY = 0;
  let cameraYaw = 0;
  let cameraPitch = -.12;
  let fpsClock = 0;
  let fpsFrames = 0;
  let quality = 1;

  let paths = Array.from({ length: PATH_COUNT }, () => new Path2D());

  function hash(n) {
    const x = Math.sin(n * 91.3458 + 17.234) * 47453.5453;
    return x - Math.floor(x);
  }

  function respawn(i, scattered = false) {
    const s = seed[i] || (seed[i] = Math.random() * 1000);
    const angle = Math.random() * TAU;
    const polar = Math.acos(Math.random() * 2 - 1);
    const radius = WORLD * (.12 + .82 * Math.pow(Math.random(), .42));
    px[i] = Math.cos(angle) * Math.sin(polar) * radius;
    py[i] = Math.cos(polar) * radius * .66;
    pz[i] = Math.sin(angle) * Math.sin(polar) * radius;
    life[i] = scattered ? Math.random() * 12 : 4 + hash(s) * 8;
  }

  function createParticles(nextCount) {
    particles = nextCount;
    px = new Float32Array(particles);
    py = new Float32Array(particles);
    pz = new Float32Array(particles);
    life = new Float32Array(particles);
    seed = new Float32Array(particles);
    for (let i = 0; i < particles; i++) respawn(i, true);
    countLabel.textContent =
      `Турбулентное поле · ${particles.toLocaleString('ru-RU')} световых следов`;
  }

  function resize() {
    w = innerWidth;
    h = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    trails.width = canvas.width;
    trails.height = canvas.height;
    bloom.width = Math.max(1, Math.round(w * dpr * .32));
    bloom.height = Math.max(1, Math.round(h * dpr * .32));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const area = Math.min(w * h, 2200000);
    const target = reducedMotion
      ? 12000
      : Math.round(Math.max(22000, Math.min(40000, area / 38)) / 1000) * 1000;
    if (!particles || Math.abs(target - particles) > 4000) createParticles(target);
    paintBackground();
    tctx.clearRect(0, 0, w, h);
  }

  function velocity(x, y, z, s, out) {
    const tt = time * .17;
    const qx = x * .52;
    const qy = y * .58;
    const qz = z * .52;

    const vx = .86 * Math.cos(qy + tt) + .72 * Math.sin(qz * 1.17 - tt * .8)
      + .34 * Math.sin((y + z) * .83 + s);
    const vy = .82 * Math.cos(qz - tt * .91) + .68 * Math.sin(qx * 1.11 + tt * .63)
      + .28 * Math.cos((z + x) * .76 - s * .7);
    const vz = .84 * Math.cos(qx + tt * .72) + .70 * Math.sin(qy * 1.08 - tt)
      + .31 * Math.sin((x + y) * .79 + s * .5);

    const radial = Math.sqrt(x * x + y * y + z * z) + .001;
    const envelope = .22 + .78 * Math.min(1, radial / 2.5);
    out[0] = vx * envelope - z * .035;
    out[1] = vy * envelope + Math.sin(tt + s) * .035;
    out[2] = vz * envelope + x * .035;
  }

  function project(x, y, z, cy, sy, cp, sp, out) {
    const rx = x * cy - z * sy;
    const rz = x * sy + z * cy;
    const ry = y * cp - rz * sp;
    const dz = y * sp + rz * cp + 10.8;
    if (dz < 1) return false;
    const scale = Math.min(w, h) * FOCAL / dz;
    out[0] = w * .53 + rx * scale;
    out[1] = h * .51 + ry * scale;
    out[2] = dz;
    out[3] = scale;
    return true;
  }

  const vel = new Float32Array(3);
  const pointA = new Float32Array(4);
  const pointB = new Float32Array(4);

  function updateAndBuildPaths(dt) {
    paths = Array.from({ length: PATH_COUNT }, () => new Path2D());

    const targetYaw = time * .082 + pointerX * .26;
    const targetPitch = -.13 + pointerY * .18 + Math.sin(time * .09) * .035;
    cameraYaw += (targetYaw - cameraYaw) * Math.min(1, dt * 1.8);
    cameraPitch += (targetPitch - cameraPitch) * Math.min(1, dt * 1.6);
    const cy = Math.cos(cameraYaw);
    const sy = Math.sin(cameraYaw);
    const cp = Math.cos(cameraPitch);
    const sp = Math.sin(cameraPitch);
    const stride = quality < .78 ? 2 : 1;

    for (let i = 0; i < particles; i++) {
      const x = px[i];
      const y = py[i];
      const z = pz[i];
      velocity(x, y, z, seed[i], vel);
      const speed = Math.sqrt(
        vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]
      );
      const step = dt * (.47 + seed[i] % .13);
      const nx = x + vel[0] * step;
      const ny = y + vel[1] * step;
      const nz = z + vel[2] * step;
      px[i] = nx;
      py[i] = ny;
      pz[i] = nz;
      life[i] -= dt;

      const r2 = nx * nx + ny * ny * 1.35 + nz * nz;
      if (life[i] <= 0 || r2 > WORLD * WORLD * 1.52) {
        respawn(i, false);
        continue;
      }
      if (i % stride !== 0) continue;

      if (!project(nx, ny, nz, cy, sy, cp, sp, pointA)) continue;
      const streak = (.018 + Math.min(speed, 2.7) * .022) * (pointA[3] / 100);
      if (!project(
        nx - vel[0] * streak,
        ny - vel[1] * streak,
        nz - vel[2] * streak,
        cy, sy, cp, sp, pointB
      )) continue;
      if (
        pointA[0] < -25 || pointA[0] > w + 25 ||
        pointA[1] < -25 || pointA[1] > h + 25
      ) continue;

      const depth = Math.max(0, Math.min(.999, (15.9 - pointA[2]) / 10.8));
      const speedTone = Math.max(0, Math.min(.999, (speed - .35) / 2.1));
      const tone = colorByDepth ? depth : speedTone;
      const colorBucket = Math.min(
        COLOR_BUCKETS - 1,
        Math.floor(tone * COLOR_BUCKETS)
      );
      const depthLayer = Math.min(
        DEPTH_LAYERS - 1,
        Math.floor(depth * DEPTH_LAYERS)
      );
      const path = paths[depthLayer * COLOR_BUCKETS + colorBucket];
      path.moveTo(pointB[0], pointB[1]);
      path.lineTo(pointA[0], pointA[1]);
    }
  }

  function paintBackground() {
    const bg = ctx.createRadialGradient(
      w * .57, h * .48, 0,
      w * .52, h * .5, Math.max(w, h) * .74
    );
    bg.addColorStop(0, '#071426');
    bg.addColorStop(.38, '#050d1a');
    bg.addColorStop(.74, '#02070f');
    bg.addColorStop(1, '#010208');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }

  function layerColor(base, depth, alpha) {
    const near = .24 + depth * .76;
    const red = Math.round(base[0] * near);
    const green = Math.round(base[1] * (.29 + depth * .71));
    const blue = Math.round(
      Math.min(255, base[2] * (.43 + depth * .57) + (1 - depth) * 18)
    );
    return `rgba(${red},${green},${blue},${alpha})`;
  }

  function drawTrails(dt) {
    tctx.save();
    tctx.globalCompositeOperation = 'destination-out';
    // Short persistence prevents additive energy from growing without bound.
    tctx.fillStyle = `rgba(0,0,0,${1 - Math.pow(.06, dt)})`;
    tctx.fillRect(0, 0, w, h);
    tctx.restore();

    tctx.save();
    tctx.globalCompositeOperation = 'lighter';
    tctx.lineCap = 'round';
    const palette = colorByDepth ? paletteDepth : paletteSpeed;

    // Atmospheric glow: distant layers are deliberately faint and cool.
    for (let depthLayer = 0; depthLayer < DEPTH_LAYERS; depthLayer++) {
      const depth = (depthLayer + .5) / DEPTH_LAYERS;
      const visibility = Math.pow(depth, 1.7);
      for (let colorBucket = 0; colorBucket < COLOR_BUCKETS; colorBucket++) {
        const index = depthLayer * COLOR_BUCKETS + colorBucket;
        const alpha = (.012 + visibility * .060) * exposure;
        tctx.strokeStyle = layerColor(palette[colorBucket], depth, alpha);
        tctx.lineWidth = 1.0 + 3.45 * Math.pow(depth, 1.35);
        tctx.stroke(paths[index]);
      }
    }

    // Fine cores hold the structure; perspective controls width and luminance.
    for (let depthLayer = 0; depthLayer < DEPTH_LAYERS; depthLayer++) {
      const depth = (depthLayer + .5) / DEPTH_LAYERS;
      const visibility = Math.pow(depth, 1.8);
      for (let colorBucket = 0; colorBucket < COLOR_BUCKETS; colorBucket++) {
        const index = depthLayer * COLOR_BUCKETS + colorBucket;
        const alpha = (.040 + visibility * .205) * exposure;
        tctx.strokeStyle = layerColor(palette[colorBucket], depth, alpha);
        tctx.lineWidth = .30 + .72 * Math.pow(depth, 1.25);
        tctx.stroke(paths[index]);
      }
    }
    tctx.restore();
  }

  function drawNearHighlights() {
    const palette = colorByDepth ? paletteDepth : paletteSpeed;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // A single-frame accent cannot accumulate, so nearby filaments stay crisp
    // without raising the long-term exposure of the whole image.
    for (let depthLayer = DEPTH_LAYERS - 2; depthLayer < DEPTH_LAYERS; depthLayer++) {
      const depth = (depthLayer + .5) / DEPTH_LAYERS;
      for (let colorBucket = 0; colorBucket < COLOR_BUCKETS; colorBucket++) {
        const index = depthLayer * COLOR_BUCKETS + colorBucket;
        const alpha = (.050 + depth * .050) * exposure;
        ctx.strokeStyle = layerColor(palette[colorBucket], depth, alpha);
        ctx.lineWidth = .34 + depth * .26;
        ctx.stroke(paths[index]);
      }
    }
    ctx.restore();
  }

  function composite() {
    paintBackground();

    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, bloom.width, bloom.height);
    bctx.globalCompositeOperation = 'source-over';
    bctx.filter = 'brightness(70%) saturate(128%)';
    bctx.drawImage(trails, 0, 0, bloom.width, bloom.height);
    bctx.filter = 'none';

    ctx.save();
    // Screen acts as a soft-knee blend; filtered sources cannot reach pure white.
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = .42 * exposure;
    ctx.filter = `blur(${Math.max(5, Math.min(w, h) * .011)}px)`;
    ctx.drawImage(bloom, 0, 0, w, h);

    ctx.globalAlpha = .92;
    ctx.filter = 'brightness(88%) contrast(108%) saturate(128%)';
    ctx.drawImage(trails, 0, 0, w, h);
    ctx.restore();

    drawNearHighlights();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const mist = ctx.createRadialGradient(
      w * (.53 + Math.sin(time * .07) * .03), h * .5, 0,
      w * .53, h * .5, Math.min(w, h) * .48
    );
    mist.addColorStop(0, 'rgba(31,82,119,.035)');
    mist.addColorStop(.5, 'rgba(18,45,82,.018)');
    mist.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const vignette = ctx.createRadialGradient(
      w * .5, h * .48, Math.min(w, h) * .22,
      w * .5, h * .48, Math.max(w, h) * .73
    );
    vignette.addColorStop(.4, 'rgba(0,0,0,0)');
    vignette.addColorStop(.76, 'rgba(0,2,8,.3)');
    vignette.addColorStop(1, 'rgba(0,1,6,.78)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  function tick(now) {
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(rawDt, .035);

    fpsClock += rawDt;
    fpsFrames++;
    if (fpsClock > 2) {
      const fps = fpsFrames / fpsClock;
      quality = fps < 42
        ? Math.max(.55, quality - .12)
        : Math.min(1, quality + .06);
      fpsClock = 0;
      fpsFrames = 0;
    }

    if (!paused) {
      time += dt * (reducedMotion ? .35 : 1);
      updateAndBuildPaths(dt);
      drawTrails(dt);
    }
    composite();
    requestAnimationFrame(tick);
  }

  addEventListener('resize', resize, { passive: true });
  addEventListener('pointermove', (event) => {
    pointerX = (event.clientX / Math.max(1, w) - .5) * 2;
    pointerY = (event.clientY / Math.max(1, h) - .5) * 2;
  }, { passive: true });
  addEventListener('pointerleave', () => {
    pointerX = 0;
    pointerY = 0;
  });

  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.setAttribute('aria-pressed', String(paused));
    pauseButton.querySelector('.button-icon').textContent = paused ? '▶' : 'Ⅱ';
    pauseButton.querySelector('.button-text').textContent =
      paused ? 'Продолжить' : 'Пауза';
  });

  colorButton.addEventListener('click', () => {
    colorByDepth = !colorByDepth;
    colorButton.querySelector('strong').textContent =
      colorByDepth ? 'глубина' : 'скорость';
  });

  glowControl.addEventListener('input', () => {
    exposure = Number(glowControl.value) / 100;
    const value = glowControl.value;
    const range = (value - 20) / (85 - 20) * 100;
    glowControl.style.background =
      `linear-gradient(90deg, #63eaff 0 ${range}%, rgba(180,209,255,.14) ${range}%)`;
  });

  resize();
  requestAnimationFrame(tick);
})();

