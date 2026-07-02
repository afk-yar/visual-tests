/* «Воксельный ландшафт» — Claude Fable 5
   Классический VoxelSpace/Comanche-рендер: процедурная карта высот и цвета,
   отрисовка вертикальными столбцами спереди-назад с y-буфером,
   туман по дальности, градиент неба, непрерывный полёт камеры. */
(function () {
  'use strict';

  /* ===== утилиты ===== */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * (3 - 2 * t); }

  /* ===== упаковка пикселей (с учётом порядка байтов платформы) ===== */

  const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const RS = LE ? 0 : 24;
  const GS = LE ? 8 : 16;
  const BS = LE ? 16 : 8;
  const AS = LE ? 24 : 0;
  const AMASK = (255 << AS) >>> 0;

  function pack(r, g, b) {
    return (AMASK | (r << RS) | (g << GS) | (b << BS)) >>> 0;
  }

  /* ===== карта мира ===== */

  const MAP_SHIFT = 10;
  const MAP_SIZE = 1 << MAP_SHIFT;      // 1024×1024, замкнута по краям (тор)
  const MAP_MASK = MAP_SIZE - 1;
  const BIG = 1 << 20;                  // сдвиг для wrap отрицательных координат (кратен MAP_SIZE)
  const WATER = 84;                     // уровень воды (0..255)

  const heightMap = new Uint8Array(MAP_SIZE * MAP_SIZE); // вода выровнена до WATER
  const colorMap = new Uint32Array(MAP_SIZE * MAP_SIZE);

  /* Периодический value-noise: октава с решёткой period×period,
     билинейная интерполяция со сглаживанием — карта замыкается без швов. */
  function addOctave(dest, size, period, amp, rand) {
    const lat = new Float32Array(period * period);
    for (let i = 0; i < lat.length; i++) lat[i] = rand();
    const scale = period / size;
    for (let y = 0; y < size; y++) {
      const v = y * scale;
      const iy = v | 0;
      const fy = smooth(v - iy);
      const r0 = (iy % period) * period;
      const r1 = ((iy + 1) % period) * period;
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const u = x * scale;
        const ix = u | 0;
        const fx = smooth(u - ix);
        const i0 = ix % period;
        const i1 = (ix + 1) % period;
        const a = lat[r0 + i0];
        const b = lat[r0 + i1];
        const c = lat[r1 + i0];
        const d = lat[r1 + i1];
        const top = a + (b - a) * fx;
        const bot = c + (d - c) * fx;
        dest[row + x] += (top + (bot - top) * fy) * amp;
      }
    }
  }

  function makeFbm(size, basePeriod, octaves, rand) {
    const out = new Float32Array(size * size);
    let amp = 1;
    let total = 0;
    let period = basePeriod;
    for (let o = 0; o < octaves && period <= size; o++) {
      addOctave(out, size, period, amp, rand);
      total += amp;
      amp *= 0.5;
      period *= 2;
    }
    const inv = 1 / total;
    for (let i = 0; i < out.length; i++) out[i] *= inv;
    return out;
  }

  function generateWorld() {
    const rand = mulberry32(20260702);
    const base = makeFbm(MAP_SIZE, 4, 6, rand);   // пологие холмы и континенты
    const ridge = makeFbm(MAP_SIZE, 5, 5, rand);  // источник хребтов
    const moist = makeFbm(MAP_SIZE, 3, 4, rand);  // «влажность» для оттенков
    const n = MAP_SIZE * MAP_SIZE;

    // высота: холмы + гребни (ridged), нормализация в 0..255 и кривая
    const trueH = base; // переиспользуем буфер (чтение элемента до записи)
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < n; i++) {
      const e = base[i];
      const rr = 1 - Math.abs(2 * ridge[i] - 1);
      const h = e * 0.58 + rr * rr * e * 0.72;
      trueH[i] = h;
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
    const inv = 1 / Math.max(1e-9, mx - mn);
    for (let i = 0; i < n; i++) {
      const h = Math.pow((trueH[i] - mn) * inv, 1.4) * 255;
      trueH[i] = h;
      heightMap[i] = h < WATER ? WATER : (h | 0); // вода — плоская гладь
    }

    // палитра суши по высоте (опорные точки, линейная интерполяция)
    const stops = [
      [84, 205, 186, 138],   // песок
      [104, 156, 164, 96],   // сухие травы
      [136, 92, 134, 72],    // луга
      [168, 60, 102, 60],    // лес
      [196, 112, 102, 90],   // скалы
      [222, 152, 144, 134],  // осыпи
      [236, 235, 238, 243],  // снег
      [255, 250, 252, 255]
    ];
    const pal = new Float32Array(256 * 3);
    for (let h = 0; h < 256; h++) {
      let s = 0;
      while (s < stops.length - 2 && h > stops[s + 1][0]) s++;
      const a = stops[s];
      const b = stops[s + 1];
      const t = clamp((h - a[0]) / Math.max(1, b[0] - a[0]), 0, 1);
      pal[h * 3] = lerp(a[1], b[1], t);
      pal[h * 3 + 1] = lerp(a[2], b[2], t);
      pal[h * 3 + 2] = lerp(a[3], b[3], t);
    }

    // цвет: вода по глубине; суша — палитра + влажность + склоновое освещение + дизеринг
    for (let y = 0; y < MAP_SIZE; y++) {
      const row = y << MAP_SHIFT;
      const rowN = ((y + 1) & MAP_MASK) << MAP_SHIFT;
      for (let x = 0; x < MAP_SIZE; x++) {
        const i = row | x;
        const h = trueH[i];
        const dith = (rand() - 0.5) * 9;
        let r, g, b;
        if (h < WATER) {
          const d = Math.min(1, (WATER - h) / 58);
          r = lerp(58, 15, d) + dith * 0.4;
          g = lerp(128, 54, d) + dith * 0.4;
          b = lerp(156, 102, d) + dith * 0.4;
        } else {
          const hi = (h | 0) * 3;
          r = pal[hi];
          g = pal[hi + 1];
          b = pal[hi + 2];
          const w = clamp((196 - h) / 60, 0, 1); // влажность красит только низины
          const m = moist[i] - 0.5;
          r -= m * 34 * w;
          g += m * 18 * w;
          b -= m * 8 * w;
          const dh = heightMap[i] - heightMap[rowN | ((x + 1) & MAP_MASK)];
          const light = clamp(0.8 + dh * 0.05, 0.5, 1.25);
          r = r * light + dith;
          g = g * light + dith;
          b = b * light + dith;
        }
        colorMap[i] = pack(clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255));
      }
    }
  }

  /* ===== состояние камеры и настроек ===== */

  const state = {
    x: 300.5,
    y: 740.5,
    angle: 0.8,
    t: 0,
    altitude: 170,     // желаемая высота (ползунок)
    renderH: 210,      // фактическая (сглаженная, с облётом рельефа)
    dist: 900,
    horizonFrac: 0.40,
    speed: 60,
    paused: false
  };

  /* ===== холсты и буферы ===== */

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');

  let RW = 0;            // внутреннее разрешение рендера
  let RH = 0;
  let horY = 1;          // линия горизонта в пикселях буфера
  let img = null;
  let buf32 = null;
  let ybuf = null;
  let skyRow = null;     // предрассчитанный градиент неба по строкам

  const SKY_TOP = [40, 72, 126];
  const SKY_HOR = [231, 216, 194];  // цвет у горизонта = цвет тумана
  const SKY_LOW = [201, 184, 160];
  const FOG_R = SKY_HOR[0];
  const FOG_G = SKY_HOR[1];
  const FOG_B = SKY_HOR[2];

  function rebuildSky() {
    horY = clamp(Math.round(state.horizonFrac * RH), 1, RH - 1);
    for (let y = 0; y < RH; y++) {
      let r, g, b;
      if (y < horY) {
        const u = Math.pow(y / horY, 1.3);
        r = lerp(SKY_TOP[0], SKY_HOR[0], u);
        g = lerp(SKY_TOP[1], SKY_HOR[1], u);
        b = lerp(SKY_TOP[2], SKY_HOR[2], u);
      } else {
        const v = clamp((y - horY) / Math.max(1, RH - horY) * 1.6, 0, 1);
        r = lerp(SKY_HOR[0], SKY_LOW[0], v);
        g = lerp(SKY_HOR[1], SKY_LOW[1], v);
        b = lerp(SKY_HOR[2], SKY_LOW[2], v);
      }
      skyRow[y] = pack(r | 0, g | 0, b | 0);
    }
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    // внутренний буфер пониженного разрешения — классический «воксельный» пиксель
    const scale = Math.min(1, 820 / w);
    RW = Math.max(160, Math.round(w * scale));
    RH = Math.max(120, Math.round(h * scale));
    off.width = RW;
    off.height = RH;
    img = octx.createImageData(RW, RH);
    buf32 = new Uint32Array(img.data.buffer);
    ybuf = new Int32Array(RW);
    skyRow = new Uint32Array(RH);
    rebuildSky();
    ctx.imageSmoothingEnabled = false;
  }

  /* ===== обновление полёта ===== */

  function update(dt) {
    if (!state.paused) {
      state.t += dt;
      // плавное блуждание курса — сумма медленных синусоид
      const turn = Math.sin(state.t * 0.13) * 0.22 + Math.sin(state.t * 0.049 + 2.1) * 0.17;
      state.angle += turn * dt;
      const s = state.speed * dt;
      state.x -= Math.sin(state.angle) * s;
      state.y -= Math.cos(state.angle) * s;
      state.x = ((state.x % MAP_SIZE) + MAP_SIZE) % MAP_SIZE;
      state.y = ((state.y % MAP_SIZE) + MAP_SIZE) % MAP_SIZE;
    }
    // высота: желаемая, но не ниже рельефа под камерой (+ запас), со сглаживанием
    const gi = (((state.y | 0) & MAP_MASK) << MAP_SHIFT) | ((state.x | 0) & MAP_MASK);
    const target = Math.max(state.altitude, heightMap[gi] + 28);
    state.renderH += (target - state.renderH) * Math.min(1, dt * 2.5);
  }

  /* ===== рендер кадра ===== */

  function render() {
    const W = RW;
    const H = RH;
    const b32 = buf32;
    const yb = ybuf;
    const sky = skyRow;

    // небо (градиент по строкам)
    for (let y = 0; y < H; y++) b32.fill(sky[y], y * W, y * W + W);
    yb.fill(H);

    const sinA = Math.sin(state.angle);
    const cosA = Math.cos(state.angle);
    const camX = state.x;
    const camY = state.y;
    const camH = state.renderH;
    const dist = state.dist;
    const focal = W * 0.5;          // 90° по горизонтали; вертикаль тем же фокусом — честная перспектива
    const hor = horY;
    const fogStart = dist * 0.3;
    const fogInv = 1 / (dist - fogStart);
    const hMap = heightMap;
    const cMap = colorMap;

    let z = 4;
    let dz = 1;
    while (z < dist) {
      // концы линии фрустума на дистанции z (левый и правый лучи)
      let plx = camX - (cosA + sinA) * z;
      let ply = camY + (sinA - cosA) * z;
      const stepX = (2 * cosA * z) / W;
      const stepY = (-2 * sinA * z) / W;
      const invz = focal / z;

      let f = (z - fogStart) * fogInv;
      f = f <= 0 ? 0 : f >= 1 ? 1 : f;
      f = f * f * (3 - 2 * f);
      const fi = (f * 256) | 0;

      for (let x = 0; x < W; x++) {
        const bottom = yb[x];
        if (bottom > 0) {
          const mi = ((((ply + BIG) | 0) & MAP_MASK) << MAP_SHIFT) | (((plx + BIG) | 0) & MAP_MASK);
          let sy = ((camH - hMap[mi]) * invz + hor) | 0;
          if (sy < bottom) {
            if (sy < 0) sy = 0;
            let c = cMap[mi];
            if (fi > 0) {
              const r = (c >>> RS) & 255;
              const g = (c >>> GS) & 255;
              const bl = (c >>> BS) & 255;
              c = AMASK
                | ((r + (((FOG_R - r) * fi) >> 8)) << RS)
                | ((g + (((FOG_G - g) * fi) >> 8)) << GS)
                | ((bl + (((FOG_B - bl) * fi) >> 8)) << BS);
            }
            for (let p = sy * W + x, end = bottom * W + x; p < end; p += W) b32[p] = c;
            yb[x] = sy;
          }
        }
        plx += stepX;
        ply += stepY;
      }

      z += dz;
      dz *= 1.012;          // растущий шаг — дешёвый LOD по дальности
      if (dz > 8) dz = 8;
    }

    octx.putImageData(img, 0, 0);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  /* ===== интерфейс ===== */

  function bindRange(id, valId, fmt, apply) {
    const el = document.getElementById(id);
    const out = document.getElementById(valId);
    const onInput = function () {
      const v = +el.value;
      out.textContent = fmt(v);
      apply(v);
    };
    el.addEventListener('input', onInput);
    onInput();
  }

  generateWorld();
  resize();
  window.addEventListener('resize', resize);

  bindRange('alt', 'altVal', String, function (v) { state.altitude = v; });
  bindRange('dist', 'distVal', String, function (v) { state.dist = v; });
  bindRange('horizon', 'horizonVal', function (v) { return v + '%'; }, function (v) {
    state.horizonFrac = v / 100;
    rebuildSky();
  });
  bindRange('speed', 'speedVal', String, function (v) { state.speed = v; });

  const pauseBtn = document.getElementById('pause');
  pauseBtn.addEventListener('click', function () {
    state.paused = !state.paused;
    pauseBtn.textContent = state.paused ? 'Продолжить' : 'Пауза';
  });

  /* ===== главный цикл ===== */

  const fpsEl = document.getElementById('fps');
  let last = performance.now();
  let fpsTime = 0;
  let fpsFrames = 0;

  function frame(now) {
    const dtRaw = (now - last) / 1000;
    last = now;
    const dt = dtRaw > 0.05 ? 0.05 : dtRaw < 0 ? 0 : dtRaw; // кламп большого dt
    update(dt);
    render();

    if (dtRaw > 0) {
      fpsTime += dtRaw;
      fpsFrames++;
      if (fpsTime >= 0.5) {
        fpsEl.textContent = Math.round(fpsFrames / fpsTime) + ' кадр/с';
        fpsTime = 0;
        fpsFrames = 0;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
