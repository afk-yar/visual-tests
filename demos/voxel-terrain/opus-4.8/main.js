/*
 * main.js — VoxelSpace / Comanche-style рендер на 2D canvas.
 *
 * Алгоритм (классический "voxel space"):
 *   Для каждого экранного столбца x на каждом шаге z от ближнего к дальнему
 *   семплируем высоту рельефа вдоль луча из камеры, проецируем её на экран
 *   (heightOnScreen = (camH - h) / z * scale + horizon) и закрашиваем столбец
 *   от предыдущей нарисованной высоты вверх до новой. y-буфер на столбец даёт
 *   корректное перекрытие и убирает overdraw (рисуем только видимое).
 *
 * Туман: цвет рельефа линейно смешивается с цветом неба у горизонта по
 *   нормированной дальности — дальние холмы растворяются в дымке.
 *
 * Небо: вертикальный градиент, рисуется один раз в кадр на фон.
 *
 * Производительность: пишем напрямую в ImageData (Uint32 view), внутренний
 *   буфер масштабируется под devicePixelRatio с ограничением, чтобы держать
 *   реальное время на больших окнах.
 */
(function () {
  'use strict';

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d', { alpha: false });

  // ── Карта ──
  const MAP_SIZE = 1024;            // степень двойки → дешёвый wrap по &(N-1)
  let map = TerrainGen.generate(MAP_SIZE, (Math.random() * 1e9) | 0);

  // ── Камера ──
  const cam = {
    x: 512, y: 512,
    angle: 0,                 // рыскание (yaw), радианы
    height: 220,              // высота над уровнем карты
    pitch: 60,                // тангаж в пикселях смещения горизонта
    fov: 100 * Math.PI / 180, // угол обзора
  };

  // ── Настройки (связаны со слайдерами) ──
  const cfg = {
    distance: 900,
    horizon: 0.40,    // доля высоты экрана
    fog: 0.55,
    speed: 1.0,
    follow: true,
  };

  // ── Внутренний буфер рендера ──
  let buf = { w: 0, h: 0, img: null, data32: null };
  let cssW = 0, cssH = 0;
  const MAX_BUF_W = 1280; // верхний предел ширины внутреннего буфера

  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    let bw = Math.round(cssW * dpr);
    let bh = Math.round(cssH * dpr);
    // ограничиваем ширину буфера, высоту масштабируем пропорционально
    if (bw > MAX_BUF_W) {
      const k = MAX_BUF_W / bw;
      bw = MAX_BUF_W;
      bh = Math.round(bh * k);
    }
    canvas.width = bw;
    canvas.height = bh;

    buf.w = bw; buf.h = bh;
    buf.img = ctx.createImageData(bw, bh);
    buf.data32 = new Uint32Array(buf.img.data.buffer);
  }

  // ── Цвет неба у горизонта (для тумана) и зенита (для градиента) ──
  // little-endian RGBA упаковка: 0xAABBGGRR
  function packRGB(r, g, b) {
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }
  const SKY_TOP = { r: 18, g: 30, b: 58 };     // зенит — глубокий синий
  const SKY_MID = { r: 70, g: 104, b: 150 };   // средний
  const SKY_HORIZON = { r: 196, g: 206, b: 214 }; // дымка у горизонта
  const horizonPacked = () => packRGB(SKY_HORIZON.r, SKY_HORIZON.g, SKY_HORIZON.b);

  // Заполняет небо вертикальным градиентом до строки horizonY,
  // ниже — ровный цвет дымки (его перекроет рельеф).
  function fillSky(data32, w, h, horizonY) {
    const hy = Math.max(0, Math.min(h, Math.round(horizonY)));
    for (let y = 0; y < hy; y++) {
      // t: 0 наверху → 1 у горизонта
      const t = hy <= 1 ? 1 : y / hy;
      let r, g, b;
      if (t < 0.6) {
        const k = t / 0.6;
        r = SKY_TOP.r + (SKY_MID.r - SKY_TOP.r) * k;
        g = SKY_TOP.g + (SKY_MID.g - SKY_TOP.g) * k;
        b = SKY_TOP.b + (SKY_MID.b - SKY_TOP.b) * k;
      } else {
        const k = (t - 0.6) / 0.4;
        const e = k * k; // дымка сгущается ближе к линии горизонта
        r = SKY_MID.r + (SKY_HORIZON.r - SKY_MID.r) * e;
        g = SKY_MID.g + (SKY_HORIZON.g - SKY_MID.g) * e;
        b = SKY_MID.b + (SKY_HORIZON.b - SKY_MID.b) * e;
      }
      const px = packRGB(r | 0, g | 0, b | 0);
      const row = y * w;
      for (let x = 0; x < w; x++) data32[row + x] = px;
    }
    // полоса дымки ниже горизонта (на случай, если рельеф её не закроет)
    const fogPx = horizonPacked();
    for (let y = hy; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) data32[row + x] = fogPx;
    }
  }

  // ── Основной рендер кадра ──
  function renderFrame() {
    const w = buf.w, h = buf.h;
    const data32 = buf.data32;
    const height = map.height;
    const color = map.color;
    const N = map.size;
    const mask = N - 1;

    const horizonY = cfg.horizon * h;
    fillSky(data32, w, h, horizonY);

    // y-буфер: для каждого столбца — самая высокая (наименьший y) уже
    // закрашенная строка. Начинаем со дна экрана.
    const ybuf = renderFrame._ybuf && renderFrame._ybuf.length === w
      ? renderFrame._ybuf : (renderFrame._ybuf = new Int32Array(w));
    for (let x = 0; x < w; x++) ybuf[x] = h;

    const sinA = Math.sin(cam.angle), cosA = Math.cos(cam.angle);

    // Половина угла обзора задаёт раствор лучей на ближней плоскости.
    const halfFov = cam.fov * 0.5;
    const tanHalf = Math.tan(halfFov);

    // Перспективный масштаб по вертикали: подобран так, что объект высоты
    // camH на расстоянии z проецируется заметно, и масштаб согласован с шириной.
    const scaleHeight = h * 0.9;

    // Левый/правый край ближней плоскости (в мировых координатах относительно камеры).
    // Луч для столбца x интерполируется между left и right.
    const plx = cosA - sinA * tanHalf, ply = sinA + cosA * tanHalf; // экран x=0
    const prx = cosA + sinA * tanHalf, pry = sinA - cosA * tanHalf; // экран x=w

    const maxZ = cfg.distance;
    const fog = cfg.fog;
    const fogR = SKY_HORIZON.r, fogG = SKY_HORIZON.g, fogB = SKY_HORIZON.b;

    // Шаг по дальности растёт с z (дальние слои реже) — экономия без потери вида.
    let z = 1.0;
    let dz = 1.0;

    while (z < maxZ) {
      // Концы линии семплирования (перпендикуляр взгляда) на дальности z.
      const lx = cam.x + plx * z;
      const ly = cam.y + ply * z;
      const rx = cam.x + prx * z;
      const ry = cam.y + pry * z;

      const dxStep = (rx - lx) / w;
      const dyStep = (ry - ly) / w;

      // Перспективный коэффициент высоты для этой дальности.
      const invZ = 1.0 / z;
      const persp = invZ * scaleHeight;

      // Туман: 0 вблизи → 1 на границе дальности (квадратичное сгущение).
      let fogT = z / maxZ;
      fogT = fogT * fogT;
      fogT *= fog;
      if (fogT > 1) fogT = 1;
      const invFog = 1 - fogT;
      // предвычисленный вклад дымки
      const fAddR = fogR * fogT, fAddG = fogG * fogT, fAddB = fogB * fogT;

      let sx = lx, sy = ly;
      for (let x = 0; x < w; x++) {
        // Тороидальный целочисленный индекс карты. Побитовое & сначала делает
        // ToInt32 (усечение дробной части), затем берёт младшие 10 бит —
        // это и есть wrap по модулю N для координат в пределах ±2^31.
        const ix = (sx & mask), iy = (sy & mask);
        const idx = (iy << 10) + ix; // N=1024 → *1024 == <<10
        const terrainH = height[idx];

        // Проекция высоты на экран.
        const heightOnScreen = (cam.height - terrainH) * persp + horizonY + cam.pitch;
        let top = heightOnScreen | 0;
        if (top < 0) top = 0;

        const prev = ybuf[x];
        if (top < prev) {
          // Цвет рельефа + туман.
          const c = color[idx];
          const cr = c & 0xFF;
          const cg = (c >> 8) & 0xFF;
          const cb = (c >> 16) & 0xFF;
          const orr = (cr * invFog + fAddR) | 0;
          const org = (cg * invFog + fAddG) | 0;
          const orb = (cb * invFog + fAddB) | 0;
          const px = packRGB(orr, org, orb);

          for (let y = top; y < prev; y++) {
            data32[y * w + x] = px;
          }
          ybuf[x] = top;
        }

        sx += dxStep; sy += dyStep;
      }

      z += dz;
      dz *= 1.012; // постепенно увеличиваем шаг по дальности
    }

    ctx.putImageData(buf.img, 0, 0);
  }

  // ── Чтение высоты рельефа под точкой (для follow-режима) ──
  function terrainHeightAt(x, y) {
    const N = map.size, mask = N - 1;
    const ix = ((x | 0) & mask), iy = ((y | 0) & mask);
    return map.height[(iy << 10) + ix];
  }

  // ── Анимация ──
  let lastT = performance.now();
  let fpsAcc = 0, fpsFrames = 0, fpsShown = 0;

  // Управление поворотом/тангажом мышью.
  const input = { dragging: false, lastX: 0, lastY: 0, targetTurn: 0, targetPitch: 0 };

  function step(now) {
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.06) dt = 0.06; // защита от больших скачков

    // Полёт вперёд вдоль направления взгляда.
    const moveSpeed = 90 * cfg.speed; // ед./сек
    cam.x += Math.cos(cam.angle) * moveSpeed * dt;
    cam.y += Math.sin(cam.angle) * moveSpeed * dt;

    // Плавный лёгкий автоповорот + пользовательский ввод.
    cam.angle += (input.targetTurn) * dt;
    cam.angle += Math.sin(now * 0.00013) * 0.06 * dt; // лёгкое блуждание
    input.targetTurn *= Math.pow(0.0001, dt); // затухание к нулю

    // Тангаж (смещение линии горизонта пользователем).
    cam.pitch += input.targetPitch * dt;
    input.targetPitch *= Math.pow(0.0001, dt);
    cam.pitch = clamp(cam.pitch, -300, 300);

    // Высота: целевая = заданная над уровнем рельефа (если follow).
    const ground = terrainHeightAt(cam.x, cam.y);
    let targetH;
    if (cfg.follow) {
      targetH = ground + cfg.userHeight;
    } else {
      targetH = cfg.userHeight;
    }
    // плавно подтягиваем
    cam.height += (targetH - cam.height) * Math.min(1, dt * 4);

    renderFrame();

    // FPS
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) {
      fpsShown = Math.round(fpsFrames / fpsAcc);
      fpsAcc = 0; fpsFrames = 0;
      fpsEl.textContent = fpsShown + ' FPS';
      distEl.textContent = 'дальность ' + Math.round(cfg.distance);
    }

    requestAnimationFrame(step);
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ── DOM / контролы ──
  const fpsEl = document.getElementById('fps');
  const distEl = document.getElementById('distOut');

  function bindRange(id, valId, onChange, fmt) {
    const el = document.getElementById(id);
    if (!el) throw new Error('bindRange: элемент #' + id + ' не найден');
    const vEl = valId ? document.getElementById(valId) : null;
    const apply = () => {
      let v = parseFloat(el.value);
      // защита: если value пустой/нечисловой — берём середину диапазона,
      // чтобы NaN никогда не утёк в рендер (иначе цикл кастинга не пойдёт).
      if (!Number.isFinite(v)) {
        const lo = parseFloat(el.min), hi = parseFloat(el.max);
        v = (Number.isFinite(lo) && Number.isFinite(hi)) ? (lo + hi) / 2 : 0;
      }
      onChange(v);
      if (vEl) vEl.textContent = fmt ? fmt(v) : String(v);
    };
    el.addEventListener('input', apply);
    apply();
    return el;
  }

  cfg.userHeight = 220;
  bindRange('camH', 'vCamH', v => { cfg.userHeight = v; if (!cfg.follow) cam.height = v; }, v => Math.round(v));
  bindRange('dist', 'vDist', v => { cfg.distance = v; }, v => Math.round(v));
  bindRange('horizon', 'vHorizon', v => { cfg.horizon = v; }, v => v.toFixed(2));
  bindRange('fov', 'vFov', v => { cam.fov = v * Math.PI / 180; }, v => Math.round(v) + '°');
  bindRange('speed', 'vSpeed', v => { cfg.speed = v; }, v => v.toFixed(2) + '×');
  bindRange('fog', 'vFog', v => { cfg.fog = v; }, v => v.toFixed(2));

  document.getElementById('follow').addEventListener('change', (e) => {
    cfg.follow = e.target.checked;
  });

  document.getElementById('regen').addEventListener('click', () => {
    map = TerrainGen.generate(MAP_SIZE, (Math.random() * 1e9) | 0);
    cam.x = 512; cam.y = 512;
  });

  // Сворачивание панели.
  const panel = document.getElementById('panel');
  document.getElementById('collapse').addEventListener('click', () => {
    panel.classList.toggle('collapsed');
  });

  // ── Управление мышью: drag поворачивает/наклоняет камеру ──
  canvas.addEventListener('pointerdown', (e) => {
    input.dragging = true;
    input.lastX = e.clientX; input.lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!input.dragging) return;
    const dx = e.clientX - input.lastX;
    const dy = e.clientY - input.lastY;
    input.lastX = e.clientX; input.lastY = e.clientY;
    cam.angle += dx * 0.0035;
    cam.pitch = clamp(cam.pitch + dy * 1.2, -300, 300);
  });
  const endDrag = () => { input.dragging = false; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Клавиатура: стрелки — поворот/тангаж.
  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowLeft':  input.targetTurn = -1.1; break;
      case 'ArrowRight': input.targetTurn =  1.1; break;
      case 'ArrowUp':    input.targetPitch = 220; break;
      case 'ArrowDown':  input.targetPitch = -220; break;
      default: return;
    }
    e.preventDefault();
  });

  // ── Старт ──
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(resize);
  });
  resize();
  cam.height = cfg.userHeight + terrainHeightAt(cam.x, cam.y);
  requestAnimationFrame(step);
})();
