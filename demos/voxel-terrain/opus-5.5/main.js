/* Полёт, управление, адаптивное внутреннее разрешение, HUD и миникарта. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const canvas = $('view'), ctx = canvas.getContext('2d', { alpha: false });
  const buf = document.createElement('canvas'), bctx = buf.getContext('2d', { alpha: false });
  const miniCv = $('mini'), mctx = miniCv.getContext('2d');
  const miniSrc = document.createElement('canvas');
  const loader = $('loader');
  const R = new VoxelRender.Renderer();
  const N = VoxelTerrain.N, MAXZ = VoxelRender.CLOUD_Z - 45;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const S = { alt: 85, dist: 1400, horizon: 0.40, speed: 75, fog: 1.0, auto: true, paused: false };
  const cam = { x: 0, y: 0, z: 200, yaw: 0, horizon: 0, roll: 0 };
  let world = null, img = null, out32 = null, iw = 0, ih = 0, dpr = 1;
  let scale = 2, minScale = 1, maxScale = 4, emaMs = 12, adaptT = 0;
  let yawRate = 0, vz = 0, pitch = 0, simT = 0, manualT = 0;
  let keyTurn = 0, keyAlt = 0, dragVel = 0;
  const wind = { x: 0, y: 0 };
  let seed = 424242;

  // ---------- рельеф для полёта: билинейно по мипу 512² ----------
  function heightAt(x, y) {
    const lv = world.levels[1], m = lv.mask, s = lv.size, h = lv.h;
    const gx = x * 0.5 - 0.5 + 4096, gy = y * 0.5 - 0.5 + 4096;
    const ix = gx | 0, iy = gy | 0, tx = gx - ix, ty = gy - iy;
    const x0 = ix & m, x1 = (ix + 1) & m, y0 = (iy & m) * s, y1 = ((iy + 1) & m) * s;
    const a = h[y0 + x0] + (h[y0 + x1] - h[y0 + x0]) * tx;
    const b = h[y1 + x0] + (h[y1 + x1] - h[y1 + x0]) * tx;
    return a + (b - a) * ty;
  }

  // Требуемая высота: максимум рельефа впереди с «пологим» запасом на дистанцию
  function terrainAhead() {
    const fx = Math.cos(cam.yaw), fy = Math.sin(cam.yaw);
    let m = heightAt(cam.x, cam.y);
    for (let d = 16; d <= 272; d += 16) {
      const hh = heightAt(cam.x + fx * d, cam.y + fy * d);
      const v = hh - d * 0.16;
      if (v > m) m = v;
    }
    return m;
  }

  // Автопилот: тянется в долины (ниже слева/справа) + медленное «блуждание»
  function autoYawRate(t) {
    const a = cam.yaw, sp = 0.5;
    let hl = 0, hr = 0;
    for (let d = 120; d <= 360; d += 80) {
      hl += heightAt(cam.x + Math.cos(a - sp) * d, cam.y + Math.sin(a - sp) * d);
      hr += heightAt(cam.x + Math.cos(a + sp) * d, cam.y + Math.sin(a + sp) * d);
    }
    const steer = clamp((hl - hr) * 0.0011, -0.26, 0.26);
    const wander = 0.12 * Math.sin(t * 0.093) + 0.07 * Math.sin(t * 0.041 + 1.7);
    return steer + wander;
  }

  function placeCamera() {
    let best = -1e9, bx = 0, by = 0, byaw = 0;
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 16; i++) {
        const x = (i + 0.5) * N / 16, y = (j + 0.5) * N / 16, h0 = heightAt(x, y);
        let mx = -1e9, ma = 0;
        for (let k = 0; k < 16; k++) {
          const a = k / 16 * Math.PI * 2, hh = heightAt(x + Math.cos(a) * 320, y + Math.sin(a) * 320);
          if (hh > mx) { mx = hh; ma = a; }
        }
        const sc = mx - h0 * 1.3;
        if (sc > best) { best = sc; bx = x; by = y; byaw = ma; }
      }
    }
    cam.x = bx; cam.y = by; cam.yaw = byaw;
    cam.z = Math.min(MAXZ, terrainAhead() + S.alt);
    vz = 0; yawRate = 0; cam.roll = 0;
  }

  // ---------- размеры и адаптивное разрешение ----------
  function allocate() {
    iw = Math.max(160, Math.round(canvas.width / scale));
    ih = Math.max(90, Math.round(canvas.height / scale));
    buf.width = iw; buf.height = ih;
    img = bctx.createImageData(iw, ih);
    out32 = new Uint32Array(img.data.buffer);
    R.setSize(iw, ih);
  }
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(innerWidth * dpr)), h = Math.max(1, Math.round(innerHeight * dpr));
    canvas.width = w; canvas.height = h;
    minScale = Math.max(1, w / 1500);
    maxScale = Math.max(minScale, w / 520);        // не опускаемся ниже ~520 px по ширине
    scale = clamp(img ? scale : w / 820, minScale, maxScale);
    allocate();
    const ms = Math.round(150 * dpr);
    miniCv.width = ms; miniCv.height = ms;
  }
  function adapt(ms, dt) {
    emaMs += (ms - emaMs) * 0.12;
    adaptT += dt;
    if (adaptT < 0.5) return;
    adaptT = 0;
    let ns = scale;
    if (emaMs > 14.5) ns = scale * 1.12;
    else if (emaMs < 9.5) ns = scale / 1.07;
    ns = clamp(ns, minScale, maxScale);
    if (Math.abs(ns - scale) / scale > 0.02) { scale = ns; allocate(); }
  }

  // ---------- симуляция полёта ----------
  function update(dt) {
    simT += dt;
    manualT = Math.max(0, manualT - dt);
    let target;
    if (keyTurn !== 0) { target = keyTurn * 0.8; manualT = 2.5; }
    else if (manualT > 0) target = 0;            // после ручного ввода — держим курс
    else target = S.auto ? autoYawRate(simT) : 0;
    yawRate += (target - yawRate) * Math.min(1, dt * 1.6);
    cam.yaw += yawRate * dt;
    const turnVis = yawRate + dragVel;           // для крена учитываем и перетаскивание
    dragVel *= Math.exp(-dt * 6);

    if (keyAlt !== 0) setSlider('alt', clamp(S.alt + keyAlt * 90 * dt, 15, 300));

    const sp = S.speed;
    cam.x = ((cam.x + Math.cos(cam.yaw) * sp * dt) % N + N) % N;
    cam.y = ((cam.y + Math.sin(cam.yaw) * sp * dt) % N + N) % N;

    // высота: демпфированная пружина к цели, жёсткий пол над рельефом
    const tgt = Math.min(MAXZ, terrainAhead() + S.alt);
    const k = 2.6, c = 2 * Math.sqrt(k);
    vz += ((tgt - cam.z) * k - vz * c) * dt;
    cam.z += vz * dt;
    const floor = heightAt(cam.x, cam.y) + 7;
    if (cam.z < floor) { cam.z = floor; if (vz < 0) vz = 0; }
    if (cam.z > MAXZ) { cam.z = MAXZ; if (vz > 0) vz = 0; }

    // крен в сторону поворота (сдвиг горизонта по столбцам) и лёгкий тангаж от набора высоты
    cam.roll += (clamp(-turnVis * 0.42, -0.22, 0.22) - cam.roll) * Math.min(1, dt * 3);
    pitch += (clamp(vz * 0.0009, -0.05, 0.05) - pitch) * Math.min(1, dt * 2);

    wind.x += dt * 7; wind.y += dt * 2.6;
  }

  // ---------- кадр ----------
  const FOVV = 56 * Math.PI / 180;
  let last = performance.now(), fpsN = 0, fpsT = 0, fps = 0, hudT = 0;
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) dt = 0; if (dt > 0.05) dt = 0.05;
    if (world) {
      if (!S.paused) update(dt);
      const t0 = performance.now();
      const aspect = iw / ih;
      const fov = clamp(2 * Math.atan(Math.tan(FOVV / 2) * aspect), 50 * Math.PI / 180, 100 * Math.PI / 180);
      cam.horizon = (S.horizon + pitch) * ih;
      R.render(cam, { dist: S.dist, fov: fov, fog: S.fog, dzk: 0.0065, windX: wind.x, windY: wind.y }, out32);
      bctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(buf, 0, 0, iw, ih, 0, 0, canvas.width, canvas.height);
      adapt(performance.now() - t0, dt);
      drawMini(fov);
      fpsN++; fpsT += dt; hudT += dt;
      if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
      if (hudT >= 0.25) { hudT = 0; updateStats(); }
    }
    requestAnimationFrame(frame);
  }

  function updateStats() {
    const deg = Math.round((((cam.yaw * 180 / Math.PI) + 90) % 360 + 360) % 360);
    const agl = Math.round(cam.z - heightAt(cam.x, cam.y));
    $('stats').textContent = fps + ' fps · ' + iw + '×' + ih + ' · над землёй ' + agl + ' · курс ' + deg + '°';
  }

  // ---------- миникарта ----------
  function buildMini() {
    const s = world.miniSize;
    miniSrc.width = s; miniSrc.height = s;
    const id = new ImageData(world.mini, s, s);
    miniSrc.getContext('2d').putImageData(id, 0, 0);
  }
  function drawMini(fov) {
    const W = miniCv.width, k = W / N;
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(miniSrc, 0, 0, W, W);
    const x = cam.x * k, y = cam.y * k, L = Math.min(S.dist, 1400) * k;
    mctx.save();
    mctx.beginPath();
    mctx.moveTo(x, y);
    mctx.lineTo(x + Math.cos(cam.yaw - fov / 2) * L, y + Math.sin(cam.yaw - fov / 2) * L);
    mctx.lineTo(x + Math.cos(cam.yaw + fov / 2) * L, y + Math.sin(cam.yaw + fov / 2) * L);
    mctx.closePath();
    mctx.fillStyle = 'rgba(255,255,255,0.16)';
    mctx.strokeStyle = 'rgba(255,255,255,0.55)';
    mctx.lineWidth = dpr;
    mctx.fill(); mctx.stroke();
    mctx.beginPath();
    mctx.arc(x, y, 3.2 * dpr, 0, Math.PI * 2);
    mctx.fillStyle = '#ffd36b';
    mctx.fill();
    mctx.lineWidth = 1.5 * dpr; mctx.strokeStyle = 'rgba(20,24,32,0.8)'; mctx.stroke();
    mctx.restore();
  }

  // ---------- генерация мира ----------
  function newWorld(s) {
    seed = s >>> 0;
    loader.hidden = false;
    setTimeout(function () {
      world = VoxelTerrain.generate(seed);
      R.prepare(world);
      buildMini();
      placeCamera();
      $('seed').textContent = 'сид ' + seed + ' · карта 1024² за ' + Math.round(world.genMs) + ' мс';
      loader.hidden = true;
    }, 30);
  }

  // ---------- UI ----------
  const sliders = {
    alt: { el: $('s-alt'), out: $('o-alt'), fmt: (v) => Math.round(v) },
    dist: { el: $('s-dist'), out: $('o-dist'), fmt: (v) => Math.round(v) },
    horizon: { el: $('s-hor'), out: $('o-hor'), fmt: (v) => Math.round(v * 100) + '%' },
    speed: { el: $('s-speed'), out: $('o-speed'), fmt: (v) => Math.round(v) },
    fog: { el: $('s-fog'), out: $('o-fog'), fmt: (v) => v.toFixed(1) + '×' }
  };
  function setSlider(key, v) {
    S[key] = v;
    const s = sliders[key];
    s.el.value = key === 'horizon' ? Math.round(v * 100) : v;
    s.out.textContent = s.fmt(v);
  }
  Object.keys(sliders).forEach(function (key) {
    const s = sliders[key];
    s.el.addEventListener('input', function () {
      const v = parseFloat(s.el.value);
      S[key] = key === 'horizon' ? v / 100 : v;
      s.out.textContent = s.fmt(S[key]);
    });
    setSlider(key, S[key]);
  });

  const bAuto = $('b-auto'), bPause = $('b-pause');
  function syncButtons() {
    bAuto.setAttribute('aria-pressed', S.auto ? 'true' : 'false');
    bPause.setAttribute('aria-pressed', S.paused ? 'true' : 'false');
    bPause.textContent = S.paused ? 'Продолжить' : 'Пауза';
  }
  bAuto.addEventListener('click', function () { S.auto = !S.auto; syncButtons(); });
  bPause.addEventListener('click', function () { S.paused = !S.paused; syncButtons(); });
  $('b-new').addEventListener('click', function () { newWorld((Math.random() * 1e9) | 0); });
  syncButtons();

  const keyMap = { ArrowLeft: 't-', KeyA: 't-', ArrowRight: 't+', KeyD: 't+', ArrowUp: 'a+', KeyW: 'a+', ArrowDown: 'a-', KeyS: 'a-' };
  const held = {};
  function recalcKeys() {
    keyTurn = (held['t+'] ? 1 : 0) - (held['t-'] ? 1 : 0);
    keyAlt = (held['a+'] ? 1 : 0) - (held['a-'] ? 1 : 0);
  }
  addEventListener('keydown', function (e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' && e.code.indexOf('Arrow') === 0) return;
    if (tag === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) return;
    const k = keyMap[e.code];
    if (k) { held[k] = true; recalcKeys(); e.preventDefault(); }
    else if (e.code === 'Space') { S.paused = !S.paused; syncButtons(); e.preventDefault(); }
    else if (e.code === 'KeyN') newWorld((Math.random() * 1e9) | 0);
  });
  addEventListener('keyup', function (e) {
    const k = keyMap[e.code];
    if (k) { held[k] = false; recalcKeys(); }
  });
  addEventListener('blur', function () { for (const k in held) held[k] = false; recalcKeys(); });

  // перетаскивание: по горизонтали — поворот, по вертикали — линия горизонта
  let drag = null;
  canvas.addEventListener('pointerdown', function (e) {
    drag = { x: e.clientX, y: e.clientY, t: performance.now() };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    const now = performance.now(), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const dts = Math.max(0.008, (now - drag.t) / 1000);
    cam.yaw += dx * 0.004;
    dragVel = clamp(dx * 0.004 / dts, -1.2, 1.2);
    manualT = 2.5;
    setSlider('horizon', clamp(S.horizon + dy / innerHeight, 0.15, 0.85));
    drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
  });
  function endDrag() { drag = null; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  addEventListener('resize', resize);
  resize();
  newWorld(seed);
  requestAnimationFrame(frame);
})();
