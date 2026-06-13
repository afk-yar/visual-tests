'use strict';
(function () {
  const Geo = window.Geo, Renderer = window.Renderer;
  const canvas = document.getElementById('stage');     // видимый, во весь вьюпорт
  const ctx = canvas.getContext('2d');
  // Малый внутренний буфер софт-рендера; апскейлится на видимый canvas.
  const rbuf = document.createElement('canvas');
  const rctx = rbuf.getContext('2d');
  ctx.imageSmoothingEnabled = true;                    // мягкий апскейл заливки

  const els = {
    fill: document.getElementById('btnFill'),
    smooth: document.getElementById('btnSmooth'),
    spin: document.getElementById('btnSpin'),
    shape: document.getElementById('shape'),
    hud: document.getElementById('hud'),
  };

  // ── Параметры рендера / освещения ─────────────────────────────────────────
  // Свет смещён выше и ближе к фронту, ambient/diffuse подняты — тело читается
  // объёмно, верх не уходит в глубокую тень.
  const opts = {
    camDist: 4.2,
    focal: 1,            // пересчитывается под размер вьюпорта
    lightPos: [1.6, 3.4, 4.2],
    baseColor: [86, 160, 240],
    ambient: 0.30,       // подсветка теневой стороны (не чёрная)
    diffuse: 0.85,
    fill: 0.18,          // мягкий контровой/заполняющий свет сверху
    specular: 0.6,
    shininess: 28,
    smooth: true,
  };

  const state = {
    fill: true,          // true=заливка, false=каркас
    smooth: true,        // true=Гуро, false=плоское
    spin: true,
    shapeKey: 'torus',
  };

  // ── Меши ──────────────────────────────────────────────────────────────────
  const meshes = {
    torus: Geo.buildTorus(1.0, 0.42, 64, 32),     // 4096 треугольников
    sphere: Geo.buildIcosphere(1.25, 4),          // 5120 треугольников
    cube: Geo.buildCube(1.9),                     // 432 треугольника
  };

  // ── Буферы кадра ──────────────────────────────────────────────────────────
  // W/H — размер внутреннего софт-буфера (маленький, ради CPU-растеризации).
  // dispW/dispH — размер видимого canvas (во весь вьюпорт). Между ними апскейл.
  let W = 1, H = 1, dispW = 1, dispH = 1;
  let imageData = null, buf = null;
  let bgColor = null;          // заранее посчитанный радиальный фон

  // Софт-растеризатор считает попиксельно на CPU, поэтому ограничиваем меньшую
  // сторону внутреннего буфера ~640px. Стоимость ∝ числу закрашенных пикселей,
  // так что это даёт кратный рост fps; тело при апскейле почти не теряет.
  const RENDER_SHORT_SIDE = 640;

  function fit() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Видимый canvas — в полном разрешении вьюпорта (резкие линии каркаса, HUD).
    dispW = Math.max(1, Math.round(rect.width * dpr));
    dispH = Math.max(1, Math.round(rect.height * dpr));
    canvas.width = dispW;
    canvas.height = dispH;

    // Внутренний буфер — масштаб так, чтобы меньшая сторона ≈ RENDER_SHORT_SIDE.
    const aspect = dispW / dispH;
    let rw, rh;
    if (dispW <= dispH) { rw = RENDER_SHORT_SIDE; rh = Math.round(rw / aspect); }
    else { rh = RENDER_SHORT_SIDE; rw = Math.round(rh * aspect); }
    rw = Math.max(1, Math.min(rw, dispW));   // не апскейлить вверх без нужды
    rh = Math.max(1, Math.min(rh, dispH));
    W = rw; H = rh;
    rbuf.width = W; rbuf.height = H;

    imageData = rctx.createImageData(W, H);
    buf = { color: imageData.data, depth: new Float32Array(W * H) };
    opts.focal = Math.min(W, H) * 0.9;
    ctx.imageSmoothingEnabled = true;
    buildBackground();
  }

  // Радиальный градиент-фон считаем один раз на размер, потом просто копируем.
  function buildBackground() {
    bgColor = new Uint8ClampedArray(W * H * 4);
    const cx = W / 2, cy = H / 2, maxR = Math.hypot(cx, cy) || 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = Math.hypot(x - cx, y - cy) / maxR;
        const v = 1 - t * 0.85;
        const i = (y * W + x) * 4;
        bgColor[i] = 12 + 10 * v;
        bgColor[i + 1] = 14 + 12 * v;
        bgColor[i + 2] = 20 + 18 * v;
        bgColor[i + 3] = 255;
      }
    }
  }
  window.addEventListener('resize', fit);

  // ── Управление ────────────────────────────────────────────────────────────
  function syncButtons() {
    els.fill.textContent = state.fill ? 'Заливка' : 'Каркас';
    els.fill.classList.toggle('on', state.fill);
    els.smooth.textContent = state.smooth ? 'Гуро (гладкое)' : 'Плоское';
    els.smooth.classList.toggle('on', state.smooth);
    els.smooth.disabled = !state.fill;
    els.spin.textContent = state.spin ? 'Вращение: вкл' : 'Вращение: выкл';
    els.spin.classList.toggle('on', state.spin);
  }
  els.fill.addEventListener('click', () => { state.fill = !state.fill; syncButtons(); });
  els.smooth.addEventListener('click', () => { state.smooth = !state.smooth; syncButtons(); });
  els.spin.addEventListener('click', () => { state.spin = !state.spin; });
  els.shape.addEventListener('change', () => { state.shapeKey = els.shape.value; });
  // Перетаскивание мышью — ручной поворот.
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    angY += (e.clientX - lastX) * 0.01;
    angX += (e.clientY - lastY) * 0.01;
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });

  // ── Поворот по двум осям ──────────────────────────────────────────────────
  let angX = 0.5, angY = 0.0;

  // Рисование каркаса (видимые рёбра лицевых граней) поверх очищенного канваса.
  function drawWireframe(mesh, rot) {
    // Каркас рисуем в полном разрешении видимого canvas → собственный focal.
    const focal = Math.min(dispW, dispH) * 0.9;
    const cam = { camDist: opts.camDist, focal: focal, cx: dispW / 2, cy: dispH / 2 };
    const proj = mesh.positions.map((p) => Geo.project(Geo.matVec(rot, p), cam));
    ctx.lineWidth = Math.max(1, dispW / 900);
    ctx.strokeStyle = 'rgba(120,200,255,0.85)';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const faces = mesh.faces;
    for (let fi = 0; fi < faces.length; fi++) {
      const f = faces[fi];
      const a = proj[f[0]], b = proj[f[1]], c = proj[f[2]];
      const screenArea = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      if (screenArea >= 0) continue; // только лицевые
      if (a.z <= 0.01 || b.z <= 0.01 || c.z <= 0.01) continue;
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y); ctx.lineTo(a.x, a.y);
    }
    ctx.stroke();
  }

  function paintBackground() {
    buf.color.set(bgColor); // быстрая копия заранее посчитанного фона
  }

  let lastT = 0, fps = 0, lastStats = { drawn: 0, culled: 0 };
  let hudT = 0;

  function frame(t) {
    const dt = lastT ? (t - lastT) / 1000 : 0;
    lastT = t;
    if (state.spin) {
      angY += dt * 0.45;        // медленное авто-вращение по двум осям
      angX += dt * 0.23;
    }
    const rot = Geo.matMul(Geo.rotY(angY), Geo.rotX(angX));
    const mesh = meshes[state.shapeKey];
    opts.smooth = state.smooth;

    if (state.fill) {
      // Заливка: софт-рендер в малый буфер → апскейл на видимый canvas.
      paintBackground();
      buf.depth.fill(Infinity);
      lastStats = Renderer.renderMesh(buf, W, H, mesh, rot, opts);
      rctx.putImageData(imageData, 0, 0);
      ctx.drawImage(rbuf, 0, 0, W, H, 0, 0, dispW, dispH);
    } else {
      // Каркас: рисуем сразу в полном разрешении видимого canvas (резкие линии).
      ctx.fillStyle = '#0c0e14';
      ctx.fillRect(0, 0, dispW, dispH);
      drawWireframe(mesh, rot);
      lastStats = { drawn: 0, culled: 0 };
    }

    // HUD ~5 раз в секунду.
    if (dt > 0) fps = fps * 0.9 + (1 / dt) * 0.1;
    hudT += dt;
    if (hudT > 0.2) {
      hudT = 0;
      const total = mesh.faces.length;
      const shadeName = state.fill ? (state.smooth ? 'Гуро' : 'плоское') : '—';
      const res = state.fill ? `${W}×${H}` : `${dispW}×${dispH}`;
      els.hud.textContent =
        `${Math.round(fps)} fps · буфер: ${res} · граней: ${total} · ` +
        `видимых: ${lastStats.drawn} · отсечено (backface): ${lastStats.culled} · ` +
        `режим: ${state.fill ? 'заливка' : 'каркас'} / ${shadeName} · z-буфер`;
    }
    requestAnimationFrame(frame);
  }

  fit();
  syncButtons();
  requestAnimationFrame(frame);
})();
