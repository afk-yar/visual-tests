/* Фрактал Мандельброта — Claude Sonnet 5.5
 *
 * Canvas 2D, без WebGL и без воркеров (работает через file:// и в sandbox-iframe).
 *  - гладкая раскраска: непрерывное число итераций  mu = n + 3 - log2(ln|z|^2),
 *    цвет берётся из циклической палитры по ln(mu + 2);
 *  - прогрессивный расчёт 8 -> 4 -> 2 -> 1 px порциями по бюджету времени кадра,
 *    затем второй проход (суперсэмплинг 2x по диагонали пикселя);
 *  - зум колесом к курсору со «скольжением» (экспоненциальное сглаживание по dt),
 *    перетаскивание с инерцией, щипок на тач-экранах;
 *  - пока идёт перерасчёт, на экране прошлая картинка, пересчитанная под новое окно;
 *  - глубина итераций растёт с зумом, внутренность отсекается кардиоидой/бутоном
 *    и поиском цикла (Брент);
 *  - цвет перекрашивается из буфера без пересчёта (палитры, плотность, цикл цвета).
 */
(function () {
  'use strict';

  /* =====================================================================
   *  ЯДРО: чистая логика (в node экспортируется, в браузере не нужна снаружи)
   * ===================================================================== */
  const LUT_SIZE = 4096;
  const LUT_MASK = LUT_SIZE - 1;
  const BAILOUT2 = 65536;               // радиус выхода 256
  const MAX_ITER_CAP = 12000;
  const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const ALPHA = LITTLE_ENDIAN ? 0xFF000000 : 0x000000FF;
  const AVG_MASK = 0xFEFEFEFE;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function pack(r, g, b) {
    return LITTLE_ENDIAN
      ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
      : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
  }

  function hsl(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = function (n) {
      const k = (n + h * 12) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }

  const SPECTRUM = [];
  for (let i = 0; i < 12; i++) SPECTRUM.push(hsl(i / 12, 0.7, i % 2 ? 0.58 : 0.46));

  // Все палитры циклические: после последней опоры идёт первая.
  const PALETTES = [
    { name: 'Классика', stops: [[0, 7, 100], [32, 107, 203], [237, 255, 255], [255, 170, 0], [0, 2, 0]] },
    { name: 'Огонь',    stops: [[12, 0, 0], [120, 12, 0], [232, 84, 0], [255, 202, 44], [255, 248, 218], [170, 52, 20]] },
    { name: 'Лёд',      stops: [[2, 10, 32], [10, 62, 124], [32, 164, 196], [176, 238, 238], [255, 255, 255], [92, 164, 216], [20, 52, 114]] },
    { name: 'Закат',    stops: [[22, 4, 44], [92, 10, 126], [226, 42, 120], [255, 146, 62], [255, 232, 150], [128, 62, 168]] },
    { name: 'Спектр',   stops: SPECTRUM },
    { name: 'Графит',   stops: [[8, 8, 14], [58, 62, 82], [178, 184, 202], [250, 247, 238], [118, 124, 144]] }
  ];

  // Catmull-Rom по циклическому списку опорных цветов -> таблица цветов LUT_SIZE.
  function buildLUT(stops, out) {
    const n = stops.length;
    for (let i = 0; i < LUT_SIZE; i++) {
      const t = (i / LUT_SIZE) * n;
      const k = Math.floor(t);
      const f = t - k;
      const p0 = stops[(k - 1 + n) % n], p1 = stops[k % n], p2 = stops[(k + 1) % n], p3 = stops[(k + 2) % n];
      const f2 = f * f, f3 = f2 * f;
      const c = [0, 0, 0];
      for (let ch = 0; ch < 3; ch++) {
        const v = 0.5 * (2 * p1[ch] + (-p0[ch] + p2[ch]) * f +
          (2 * p0[ch] - 5 * p1[ch] + 4 * p2[ch] - p3[ch]) * f2 +
          (-p0[ch] + 3 * p1[ch] - 3 * p2[ch] + p3[ch]) * f3);
        c[ch] = Math.round(clamp(v, 0, 255));
      }
      out[i] = pack(c[0], c[1], c[2]);
    }
    return out;
  }

  // Глубина итераций растёт с логарифмом зума (зум = 1 на стартовом кадре).
  function iterFor(zoom, mul) {
    const L = Math.log2(Math.max(zoom, 1));
    const base = 110 + 38 * L + 0.9 * L * L;
    return Math.max(40, Math.min(MAX_ITER_CAP, Math.round(base * mul)));
  }

  // Возвращает ln(mu + 2) > 0 для вышедшей точки и -1 для внутренней.
  function iterate(cr, ci, maxIter, detect, eps2) {
    // главная кардиоида и бутон периода 2 — внутри множества заведомо
    const xq = cr - 0.25;
    const q = xq * xq + ci * ci;
    if (q * (q + xq) <= 0.25 * ci * ci) return -1;
    const x1 = cr + 1;
    if (x1 * x1 + ci * ci <= 0.0625) return -1;

    let zr = 0, zi = 0, zr2 = 0, zi2 = 0, sr = 0, si = 0;
    for (let n = 0; n < maxIter; n++) {
      zi = 2 * zr * zi + ci;
      zr = zr2 - zi2 + cr;
      zr2 = zr * zr;
      zi2 = zi * zi;
      const m2 = zr2 + zi2;
      if (m2 > BAILOUT2) {
        const mu = n + 3 - Math.log2(Math.log(m2));
        return Math.log(mu + 2);
      }
      if (detect) {
        // поиск цикла по Оренту/Бренту: опорная точка обновляется на степенях двойки
        if ((n & (n - 1)) === 0) { sr = zr; si = zi; }
        else {
          const dr = zr - sr, di = zi - si;
          if (dr * dr + di * di < eps2) return -1;
        }
      }
    }
    return -1;
  }

  // Считает одну строку: точки xStart, xStart+xStep, ... Если fill > 1 — заливает блок fill x fill.
  function evalRow(j, buf, y, xStart, xStep, fill, ox, oy) {
    const rw = j.rw, rh = j.rh, inv = j.inv;
    const hw = rw / 2, hh = rh / 2;
    const ci = j.cy - (y + oy - hh) * inv;
    const cx = j.cx, maxIter = j.maxIter, detect = j.detect, eps2 = j.eps2;
    let count = 0;
    for (let x = xStart; x < rw; x += xStep) {
      const v = iterate(cx + (x + ox - hw) * inv, ci, maxIter, detect, eps2);
      count++;
      if (fill > 1) {
        const x1 = Math.min(x + fill, rw), y1 = Math.min(y + fill, rh);
        for (let yy = y; yy < y1; yy++) buf.fill(v, yy * rw + x, yy * rw + x1);
      } else {
        buf[y * rw + x] = v;
      }
    }
    return count;
  }

  // Раскраска строк [y0, y1). b/aaRows — второй сэмпл (усредняется побитово по каналам).
  function colorizeRows(a, b, aaRows, out, w, y0, y1, lut, mul, off, inner) {
    for (let y = y0; y < y1; y++) {
      let i = y * w;
      const end = i + w;
      if (y < aaRows) {
        for (; i < end; i++) {
          const va = a[i], vb = b[i];
          const c0 = va < 0 ? inner : lut[((va * mul + off) | 0) & LUT_MASK];
          const c1 = vb < 0 ? inner : lut[((vb * mul + off) | 0) & LUT_MASK];
          out[i] = (((c0 & AVG_MASK) >>> 1) + ((c1 & AVG_MASK) >>> 1)) | ALPHA;
        }
      } else {
        for (; i < end; i++) {
          const va = a[i];
          out[i] = va < 0 ? inner : lut[((va * mul + off) | 0) & LUT_MASK];
        }
      }
    }
  }

  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };

  function formatZoomHTML(z) {
    if (z < 1e4) return '×' + (z < 10 ? z.toFixed(2) : z < 100 ? z.toFixed(1) : z.toFixed(0));
    const parts = z.toExponential(2).split('e');
    return '×' + parts[0] + '·10<sup>' + parseInt(parts[1], 10) + '</sup>';
  }

  function formatZoomText(z) {
    return formatZoomHTML(z).replace(/<sup>(-?\d+)<\/sup>/, function (_, e) {
      return String(e).split('').map(function (ch) { return SUP[ch] || ch; }).join('');
    });
  }

  function formatCoord(v, dec) {
    return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(dec);
  }

  const core = {
    LUT_SIZE: LUT_SIZE, PALETTES: PALETTES, buildLUT: buildLUT, iterFor: iterFor, iterate: iterate,
    evalRow: evalRow, colorizeRows: colorizeRows, formatZoomHTML: formatZoomHTML,
    formatZoomText: formatZoomText, formatCoord: formatCoord, pack: pack
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = core;
    return;
  }

  /* =====================================================================
   *  ПРИЛОЖЕНИЕ
   * ===================================================================== */
  const STEPS = [8, 4, 2, 1];            // шаги прогрессивного расчёта
  const MAX_PIXELS = 5.5e6;              // потолок размера буфера расчёта
  const MAX_DPR = 2;
  const MIN_PIXEL_CSS = 6e-15;           // меньше — уже упираемся в точность double
  const SETTLE_MS = 70;                  // тишина, после которой перезапускаем расчёт
  const REFRESH_MS = 120;                // во время движения — обновляем картинку не реже
  const CYCLE_SPEED = 0.11;              // оборотов палитры в секунду
  const INTERIOR = pack(6, 6, 12);
  const BG_CSS = '#05060d';
  const MM = { re0: -2.3, w: 3.2, im0: 1.2, h: 2.4, pw: 320, ph: 240 };   // окно мини-карты

  // Места проверены отрисовкой ядра (zoom — относительно стартового кадра).
  const PLACES = [
    { name: 'Весь фрактал',                 cx: -0.55,               cy: 0,                  zoom: 1 },
    { name: 'Долина морских коньков',       cx: -0.743643887037151,  cy: 0.131825904205330,  zoom: 2600 },
    { name: 'Остров периода 3',             cx: -1.7588,             cy: 0,                  zoom: 80 },
    { name: 'Ветвистая молния',             cx: -0.10109636384562,   cy: 0.95628651080914,   zoom: 2000 },
    { name: 'Спирали у мини-копии',         cx: -1.768778833,        cy: -0.001738996,       zoom: 9000 },
    { name: 'Глубокая спираль',             cx: -0.77568377,         cy: 0.13646737,         zoom: 400000 },
    { name: 'Мини-Мандельброт в долине',    cx: -0.743643887037151,  cy: 0.131825904205330,  zoom: 400000 }
  ];

  const $ = function (id) { return document.getElementById(id); };
  const canvas = $('view');
  const ctx = canvas.getContext('2d', { alpha: false });
  const workCanvas = document.createElement('canvas');
  const workCtx = workCanvas.getContext('2d');
  const snapCanvas = document.createElement('canvas');
  const snapCtx = snapCanvas.getContext('2d');
  const miniCanvas = $('mini');
  const miniCtx = miniCanvas.getContext('2d');

  const el = {
    zoom: $('zoom'), re: $('re'), im: $('im'), curRe: $('curRe'), curIm: $('curIm'),
    iters: $('iters'), status: $('status'), bar: $('barFill'), place: $('place'),
    limit: $('limit'), mmRect: $('mmRect'), miniBox: $('miniBox')
  };

  /* ---------- состояние ---------- */
  let W = 0, H = 0, dpr = 1, cw = 0, ch = 0, rw = 0, rh = 0, rs = 1;
  let buf = null, buf2 = null, img = null, px = null;
  let ppu0 = 1, minPpu = 0.1, maxPpu = 1 / MIN_PIXEL_CSS;
  const view = { cx: -0.55, cy: 0, ppu: 1 };           // ppu — пикселей CSS на единицу комплексной плоскости
  const prevView = { cx: NaN, cy: NaN, ppu: NaN };
  let targetPpu = 1, anchor = null, fly = null, inertia = null;
  let job = null, snapValid = false;
  const snapView = { cx: 0, cy: 0, ppu: 1 };
  let lastMoveT = 0, forceJob = true, needRecolor = true, needPresent = true;
  let palIdx = 0, density = 1.3, phase = 0, cycling = false, aaOn = true, iterMul = 1;
  let placeIdx = 0, dragging = false, hover = false, hx = 0, hy = 0, lastHud = -1e9, lastFrameT = 0;
  const lut = new Uint32Array(LUT_SIZE);
  const keys = { left: false, right: false, up: false, down: false };
  const pointers = new Map();
  let pinch = null, dragVX = 0, dragVY = 0, lastMoveEvT = 0;
  const miniLt = new Float32Array(MM.pw * MM.ph);
  const miniImg = miniCtx.createImageData(MM.pw, MM.ph);
  const miniPx = new Uint32Array(miniImg.data.buffer);

  /* ---------- размеры ---------- */
  function resize() {
    const nW = Math.max(1, Math.floor(window.innerWidth));
    const nH = Math.max(1, Math.floor(window.innerHeight));
    const nd = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (nW === W && nH === H && nd === dpr) return;
    const first = W === 0;
    W = nW; H = nH; dpr = nd;
    cw = Math.max(1, Math.round(W * dpr));
    ch = Math.max(1, Math.round(H * dpr));
    canvas.width = cw; canvas.height = ch;
    rs = Math.min(1, Math.sqrt(MAX_PIXELS / (cw * ch)));
    rw = Math.max(1, Math.floor(cw * rs));
    rh = Math.max(1, Math.floor(ch * rs));
    workCanvas.width = rw; workCanvas.height = rh;
    snapCanvas.width = rw; snapCanvas.height = rh;
    buf = new Float32Array(rw * rh);
    buf2 = new Float32Array(rw * rh);
    img = workCtx.createImageData(rw, rh);
    px = new Uint32Array(img.data.buffer);
    snapValid = false;
    job = null;
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'low';
    if (first) {
      ppu0 = Math.min(W / 3.6, H / 2.5);
      view.ppu = targetPpu = ppu0;
      minPpu = ppu0 * 0.4;
    }
    forceJob = true; needRecolor = true; needPresent = true;
  }

  /* ---------- расчёт ---------- */
  function startJob(now) {
    if (job && job.covered && job.pass >= 2) {
      // лучшая готовая картинка уходит в «снимок»
      snapCtx.drawImage(workCanvas, 0, 0);
      snapView.cx = job.view.cx; snapView.cy = job.view.cy; snapView.ppu = job.view.ppu;
      snapValid = true;
    }
    const zoom = view.ppu / ppu0;
    const maxIter = iterFor(zoom, iterMul);
    const inv = 1 / (view.ppu * dpr * rs);     // комплексных единиц на пиксель буфера
    const eps = inv * 1e-3;
    job = {
      view: { cx: view.cx, cy: view.cy, ppu: view.ppu },
      cx: view.cx, cy: view.cy, inv: inv, rw: rw, rh: rh,
      maxIter: maxIter, detect: maxIter > 250, eps2: eps * eps,
      pass: 0, y: 0, phase: 0, aaRows: 0, covered: false,
      donePix: 0, startT: now, doneT: 0
    };
    forceJob = false;
    needRecolor = true;
  }

  function schedule(now) {
    if (!job || forceJob) { startJob(now); return; }
    const v = job.view;
    if (v.cx !== view.cx || v.cy !== view.cy || v.ppu !== view.ppu) {
      if (now - lastMoveT >= SETTLE_MS || now - job.startT >= REFRESH_MS) startJob(now);
    }
  }

  function syncAA() {
    if (!job) return;
    if (!aaOn && job.phase === 1) { job.phase = 2; job.doneT = performance.now(); }
    else if (aaOn && job.phase === 2 && job.pass >= STEPS.length && job.aaRows < rh) job.phase = 1;
  }

  function colorize(y0, y1) {
    colorizeRows(buf, buf2, aaOn && job ? job.aaRows : 0, px, rw, y0, y1, lut,
      density * LUT_SIZE, phase * LUT_SIZE, INTERIOR);
  }

  function runSlice(budget) {
    const j = job;
    if (!j || j.phase === 2) return false;
    const t0 = performance.now();
    let dmin = rh, dmax = -1;
    while (j.phase !== 2) {
      if (j.phase === 0) {
        const s = STEPS[j.pass];
        const y = j.y;
        let xs = 0, xstep = s;
        if (j.pass > 0 && y % (2 * s) === 0) { xs = s; xstep = 2 * s; }   // углы блока 2s уже посчитаны
        j.donePix += evalRow(j, buf, y, xs, xstep, s, 0.25, 0.25);
        const yEnd = Math.min(y + s, rh) - 1;
        if (y < dmin) dmin = y;
        if (yEnd > dmax) dmax = yEnd;
        j.y += s;
        if (j.y >= rh) {
          j.y = 0; j.pass++;
          if (j.pass === 1) j.covered = true;
          if (j.pass >= STEPS.length) {
            j.phase = aaOn ? 1 : 2;
            if (j.phase === 2) j.doneT = performance.now();
          }
        }
      } else {
        const y = j.aaRows;
        j.donePix += evalRow(j, buf2, y, 0, 1, 1, 0.75, 0.75);
        if (y < dmin) dmin = y;
        if (y > dmax) dmax = y;
        j.aaRows++;
        if (j.aaRows >= rh) { j.phase = 2; j.doneT = performance.now(); }
      }
      if (performance.now() - t0 > budget) break;
    }
    if (dmax >= dmin) {
      colorize(dmin, dmax + 1);
      workCtx.putImageData(img, 0, 0, 0, dmin, rw, dmax - dmin + 1);
      return true;
    }
    return false;
  }

  function recolorAll() {
    colorize(0, rh);
    workCtx.putImageData(img, 0, 0);
  }

  /* ---------- мини-карта ---------- */
  function initMini() {
    miniCanvas.width = MM.pw; miniCanvas.height = MM.ph;
    const inv = MM.w / MM.pw;
    for (let y = 0; y < MM.ph; y++) {
      const ci = MM.im0 - (y + 0.5) * inv;
      for (let x = 0; x < MM.pw; x++) {
        miniLt[y * MM.pw + x] = iterate(MM.re0 + (x + 0.5) * inv, ci, 260, false, 0);
      }
    }
  }

  function paintMini() {
    colorizeRows(miniLt, null, 0, miniPx, MM.pw, 0, MM.ph, lut, density * LUT_SIZE, phase * LUT_SIZE, INTERIOR);
    miniCtx.putImageData(miniImg, 0, 0);
  }

  /* ---------- показ ---------- */
  function placement(sv) {
    const k = view.ppu / sv.ppu;
    return {
      k: k,
      dx: W / 2 + (sv.cx - view.cx) * view.ppu - (W / 2) * k,
      dy: H / 2 - (sv.cy - view.cy) * view.ppu - (H / 2) * k,
      dw: W * k, dh: H * k
    };
  }

  function snapCovers() {
    const p = placement(snapView);
    return p.dx <= 0.5 && p.dy <= 0.5 && p.dx + p.dw >= W - 0.5 && p.dy + p.dh >= H - 0.5;
  }

  // Новые (пока грубые) данные рисуем только там, куда снимок не дотягивается: у открывшихся краёв.
  function drawWorkOutsideSnap() {
    const p = placement(snapView);
    const x0 = Math.max(0, p.dx), y0 = Math.max(0, p.dy);
    const x1 = Math.min(W, p.dx + p.dw), y1 = Math.min(H, p.dy + p.dh);
    const kx = cw / W, ky = ch / H;
    ctx.save();
    if (x1 > x0 && y1 > y0) {
      ctx.beginPath();
      ctx.rect(0, 0, cw, ch);
      ctx.rect(x0 * kx, y0 * ky, (x1 - x0) * kx, (y1 - y0) * ky);
      ctx.clip('evenodd');
    }
    drawTransformed(workCanvas, job.view);
    ctx.restore();
  }

  function drawTransformed(src, sv) {
    const p = placement(sv);
    if (!(p.dw > 0) || !(p.dh > 0) || !isFinite(p.dx) || !isFinite(p.dy)) return;
    // рисуем только видимую часть, чтобы не гонять гигантские прямоугольники
    const x0 = Math.max(0, p.dx), y0 = Math.max(0, p.dy);
    const x1 = Math.min(W, p.dx + p.dw), y1 = Math.min(H, p.dy + p.dh);
    if (x1 <= x0 || y1 <= y0) return;
    const fx = src.width / p.dw, fy = src.height / p.dh;
    ctx.drawImage(src,
      (x0 - p.dx) * fx, (y0 - p.dy) * fy, (x1 - x0) * fx, (y1 - y0) * fy,
      x0 * (cw / W), y0 * (ch / H), (x1 - x0) * (cw / W), (y1 - y0) * (ch / H));
  }

  function present() {
    ctx.fillStyle = BG_CSS;
    ctx.fillRect(0, 0, cw, ch);
    if (!job) return;
    if (job.covered && (job.pass >= 2 || !snapValid)) {
      drawTransformed(workCanvas, job.view);       // свежая картинка уже достаточно детальна
    } else if (snapValid) {
      drawTransformed(snapCanvas, snapView);       // пока считается — прошлая, пересчитанная под новое окно
      if (job.covered && !snapCovers()) drawWorkOutsideSnap();
    }
  }

  /* ---------- анимация вида ---------- */
  function clampView() {
    view.ppu = clamp(view.ppu, minPpu, maxPpu);
    targetPpu = clamp(targetPpu, minPpu, maxPpu);
    if (!isFinite(view.cx)) view.cx = -0.55;
    if (!isFinite(view.cy)) view.cy = 0;
    view.cx = clamp(view.cx, -4, 4);
    view.cy = clamp(view.cy, -4, 4);
  }

  function animate(dt, now) {
    if (fly) {
      fly.t += dt;
      const u = Math.min(1, fly.t / fly.dur);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const p = Math.exp(Math.log(fly.p0) + (Math.log(fly.p1) - Math.log(fly.p0)) * e);
      const a = 1 / fly.p0, b = 1 / fly.p1;
      // центр линеен по 1/ppu — это зум вокруг неподвижной на экране точки
      const w = Math.abs(a - b) < 1e-12 * a ? e : (1 / p - a) / (b - a);
      view.ppu = p;
      view.cx = fly.cx0 + (fly.cx1 - fly.cx0) * w;
      view.cy = fly.cy0 + (fly.cy1 - fly.cy0) * w;
      targetPpu = p;
      if (u >= 1) {
        view.ppu = targetPpu = fly.p1; view.cx = fly.cx1; view.cy = fly.cy1;
        fly = null;
      }
    } else {
      if (view.ppu !== targetPpu) {
        const lp = Math.log(view.ppu), d = Math.log(targetPpu) - lp;
        view.ppu = Math.abs(d) < 1e-4 ? targetPpu : Math.exp(lp + d * (1 - Math.exp(-dt * 11)));
        if (anchor) {
          view.cx = anchor.re - (anchor.sx - W / 2) / view.ppu;
          view.cy = anchor.im + (anchor.sy - H / 2) / view.ppu;
        }
      } else {
        anchor = null;
      }
      if (inertia) {
        view.cx -= inertia.vx * dt / view.ppu;
        view.cy += inertia.vy * dt / view.ppu;
        const k = Math.exp(-dt * 4.2);
        inertia.vx *= k; inertia.vy *= k;
        if (Math.hypot(inertia.vx, inertia.vy) < 10) inertia = null;
      }
      const kx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      const ky = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      if (kx || ky) {
        view.cx += kx * 520 * dt / view.ppu;
        view.cy -= ky * 520 * dt / view.ppu;
      }
    }
    clampView();
    if (view.cx !== prevView.cx || view.cy !== prevView.cy || view.ppu !== prevView.ppu) {
      prevView.cx = view.cx; prevView.cy = view.cy; prevView.ppu = view.ppu;
      lastMoveT = now;
      needPresent = true;
    }
  }

  function zoomAt(sx, sy, f) {
    anchor = {
      re: view.cx + (sx - W / 2) / view.ppu,
      im: view.cy - (sy - H / 2) / view.ppu,
      sx: sx, sy: sy
    };
    targetPpu = clamp(targetPpu * f, minPpu, maxPpu);
  }

  function stopMotion() {
    fly = null; inertia = null; anchor = null; targetPpu = view.ppu;
  }

  function flyTo(p, name) {
    const p1 = clamp(p.zoom * ppu0, minPpu, maxPpu);
    fly = {
      t: 0, dur: clamp(1.3 + 0.2 * Math.abs(Math.log2(p1 / view.ppu)), 1.3, 5.5),
      cx0: view.cx, cy0: view.cy, p0: view.ppu, cx1: p.cx, cy1: p.cy, p1: p1
    };
    anchor = null; inertia = null; targetPpu = view.ppu;
    el.place.textContent = name || p.name;
    el.place.classList.add('on');
  }

  function hidePlace() { el.place.classList.remove('on'); }

  /* ---------- HUD ---------- */
  const hudCache = {};
  function setText(key, node, val, html) {
    if (hudCache[key] === val) return;
    hudCache[key] = val;
    if (html) node.innerHTML = val; else node.textContent = val;
  }

  function updateHUD(now) {
    if (now - lastHud < 110) return;
    lastHud = now;
    const zoom = view.ppu / ppu0;
    const dec = clamp(Math.ceil(Math.log10(view.ppu)) + 2, 3, 16);
    setText('zoom', el.zoom, formatZoomHTML(zoom), true);
    setText('re', el.re, formatCoord(view.cx, dec));
    setText('im', el.im, formatCoord(view.cy, dec) + ' i');
    if (hover) {
      setText('curRe', el.curRe, formatCoord(view.cx + (hx - W / 2) / view.ppu, dec));
      setText('curIm', el.curIm, formatCoord(view.cy - (hy - H / 2) / view.ppu, dec) + ' i');
    } else {
      setText('curRe', el.curRe, '—');
      setText('curIm', el.curIm, '—');
    }
    setText('iters', el.iters, String(job ? job.maxIter : iterFor(zoom, iterMul)));

    let pct = 100, label = 'Готово';
    if (job) {
      if (job.phase === 0) {
        pct = Math.min(99, Math.floor(100 * job.donePix / (rw * rh * (aaOn ? 2 : 1))));
        label = 'Расчёт ' + pct + '%';
      } else if (job.phase === 1) {
        pct = Math.min(99, Math.floor(100 * job.donePix / (rw * rh * 2)));
        label = 'Сглаживание ' + pct + '%';
      } else {
        label = 'Готово · ' + ((job.doneT - job.startT) / 1000).toFixed(2) + ' с';
      }
    }
    setText('status', el.status, label);
    setText('bar', el.bar, pct + '%');
    el.bar.style.width = pct + '%';
    el.bar.parentNode.classList.toggle('busy', pct < 100);
    el.limit.classList.toggle('on', view.ppu >= maxPpu * 0.999);

    // рамка текущего окна на мини-карте
    const hw = W / (2 * view.ppu), hh = H / (2 * view.ppu);
    const mx = ((view.cx - MM.re0) / MM.w) * 100;
    const my = ((MM.im0 - view.cy) / MM.h) * 100;
    el.mmRect.style.left = mx.toFixed(3) + '%';
    el.mmRect.style.top = my.toFixed(3) + '%';
    el.mmRect.style.width = ((2 * hw / MM.w) * 100).toFixed(3) + '%';
    el.mmRect.style.height = ((2 * hh / MM.h) * 100).toFixed(3) + '%';
  }

  /* ---------- главный цикл ---------- */
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - lastFrameT) / 1000));
    lastFrameT = now;
    resize();
    animate(dt, now);
    if (cycling) { phase = (phase + dt * CYCLE_SPEED) % 1; needRecolor = true; }
    schedule(now);
    if (needRecolor) {
      paintMini();
      if (job && job.covered) { recolorAll(); needRecolor = false; needPresent = true; }
    }
    syncAA();
    const busy = cycling || dragging || now - lastMoveT < 120;
    if (runSlice(busy ? 8 : 13)) needPresent = true;
    if (needPresent) { present(); needPresent = false; }
    updateHUD(now);
  }

  /* ---------- ввод ---------- */
  function onWheel(e) {
    e.preventDefault();
    stopFlyOnly();
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 33; else if (e.deltaMode === 2) d *= 400;
    d = clamp(d, -240, 240);
    zoomAt(e.clientX, e.clientY, Math.exp(-d * 0.0026));
    inertia = null;
  }

  function stopFlyOnly() {
    if (fly) { fly = null; targetPpu = view.ppu; }
    hidePlace();
  }

  function onDown(e) {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stopMotion(); hidePlace();
    if (pointers.size === 1) {
      dragging = true; dragVX = 0; dragVY = 0; lastMoveEvT = e.timeStamp;
      canvas.classList.add('dragging');
    } else if (pointers.size === 2) {
      dragging = false; pinch = null; pinchUpdate();
    }
  }

  function pinchUpdate() {
    const pts = Array.from(pointers.values());
    if (pts.length < 2) { pinch = null; return; }
    const a = pts[0], b = pts[1];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (pinch) {
      const re = view.cx + (pinch.mx - W / 2) / view.ppu;
      const im = view.cy - (pinch.my - H / 2) / view.ppu;
      view.ppu = clamp(view.ppu * dist / pinch.dist, minPpu, maxPpu);
      view.cx = re - (mx - W / 2) / view.ppu;
      view.cy = im + (my - H / 2) / view.ppu;
      targetPpu = view.ppu;
    }
    pinch = { dist: dist, mx: mx, my: my };
  }

  function onMove(e) {
    hover = true; hx = e.clientX; hy = e.clientY;
    const old = pointers.get(e.pointerId);
    if (!old) return;
    const nx = e.clientX, ny = e.clientY;
    if (pointers.size === 1 && dragging) {
      const dx = nx - old.x, dy = ny - old.y;
      view.cx -= dx / view.ppu;
      view.cy += dy / view.ppu;
      const dtm = Math.max(1, e.timeStamp - lastMoveEvT);
      dragVX = dragVX * 0.6 + (dx / dtm * 1000) * 0.4;
      dragVY = dragVY * 0.6 + (dy / dtm * 1000) * 0.4;
      lastMoveEvT = e.timeStamp;
    }
    old.x = nx; old.y = ny;
    if (pointers.size === 2) pinchUpdate();
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    pinch = null;
    if (pointers.size === 0) {
      dragging = false;
      canvas.classList.remove('dragging');
      const fresh = e.timeStamp - lastMoveEvT < 90;
      if (fresh && Math.hypot(dragVX, dragVY) > 120) inertia = { vx: dragVX, vy: dragVY };
    } else if (pointers.size === 1) {
      dragging = true; dragVX = 0; dragVY = 0; lastMoveEvT = e.timeStamp;
    }
  }

  function onDbl(e) {
    stopMotion(); hidePlace();
    zoomAt(e.clientX, e.clientY, e.shiftKey ? 1 / 3 : 3);
  }

  function miniGo(e) {
    const r = el.miniBox.getBoundingClientRect();
    const u = clamp((e.clientX - r.left) / r.width, 0, 1);
    const v = clamp((e.clientY - r.top) / r.height, 0, 1);
    stopMotion(); hidePlace();
    view.cx = MM.re0 + u * MM.w;
    view.cy = MM.im0 - v * MM.h;
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.tagName === 'INPUT') return;      // стрелки управляют ползунками
    const k = e.key;
    const set = function (name, on) { keys[name] = on; };
    const down = e.type === 'keydown';
    if (k === 'ArrowLeft') set('left', down);
    else if (k === 'ArrowRight') set('right', down);
    else if (k === 'ArrowUp') set('up', down);
    else if (k === 'ArrowDown') set('down', down);
    else if (!down) return;
    else if (k === '+' || k === '=') { stopFlyOnly(); zoomAt(W / 2, H / 2, 1.6); }
    else if (k === '-' || k === '_') { stopFlyOnly(); zoomAt(W / 2, H / 2, 1 / 1.6); }
    else if (k === 'r' || k === 'R') { placeIdx = 0; flyTo(PLACES[0], 'Весь фрактал'); }
    else if (k === 'c' || k === 'C') { toggleCycle(); }
    else return;
    if (k.indexOf('Arrow') === 0) { e.preventDefault(); if (down) { hidePlace(); stopFlyOnly(); inertia = null; } }
  }

  /* ---------- панель ---------- */
  function setPalette(i) {
    palIdx = i;
    buildLUT(PALETTES[i].stops, lut);
    needRecolor = true;
    const sw = document.querySelectorAll('.swatch');
    for (let n = 0; n < sw.length; n++) sw[n].setAttribute('aria-pressed', n === i ? 'true' : 'false');
  }

  function toggleCycle() {
    cycling = !cycling;
    const b = $('btnCycle');
    b.classList.toggle('on', cycling);
    b.setAttribute('aria-pressed', cycling ? 'true' : 'false');
  }

  function initPanel() {
    const box = $('swatches');
    PALETTES.forEach(function (p, i) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.title = p.name;
      b.setAttribute('aria-label', 'Палитра: ' + p.name);
      const cols = p.stops.concat([p.stops[0]]).map(function (c) { return 'rgb(' + c.join(',') + ')'; });
      b.style.backgroundImage = 'linear-gradient(135deg,' + cols.join(',') + ')';
      b.addEventListener('click', function () { setPalette(i); });
      box.appendChild(b);
    });

    const dens = $('density'), dOut = $('densityOut');
    dens.addEventListener('input', function () {
      density = parseFloat(dens.value);
      dOut.textContent = density.toFixed(2);
      needRecolor = true;
    });
    const it = $('iterMul'), iOut = $('iterMulOut');
    it.addEventListener('input', function () {
      iterMul = parseFloat(it.value);
      iOut.textContent = '×' + iterMul.toFixed(1);
      forceJob = true;
    });
    dens.value = String(density); dOut.textContent = density.toFixed(2);
    it.value = String(iterMul); iOut.textContent = '×' + iterMul.toFixed(1);

    $('btnCycle').addEventListener('click', toggleCycle);
    $('btnAA').addEventListener('click', function () {
      aaOn = !aaOn;
      this.classList.toggle('on', aaOn);
      this.setAttribute('aria-pressed', aaOn ? 'true' : 'false');
      needRecolor = true;
    });
    $('btnTour').addEventListener('click', function () {
      placeIdx = (placeIdx + 1) % PLACES.length;
      flyTo(PLACES[placeIdx]);
    });
    $('btnReset').addEventListener('click', function () {
      placeIdx = 0;
      flyTo(PLACES[0], 'Весь фрактал');
    });
  }

  /* ---------- старт ---------- */
  function start() {
    resize();
    initMini();
    initPanel();
    setPalette(0);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hover = false; });
    canvas.addEventListener('dblclick', onDbl);
    el.miniBox.addEventListener('pointerdown', function (e) {
      try { el.miniBox.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      el.miniBox.dataset.drag = '1';
      miniGo(e);
    });
    el.miniBox.addEventListener('pointermove', function (e) { if (el.miniBox.dataset.drag === '1') miniGo(e); });
    const endMini = function () { el.miniBox.dataset.drag = '0'; };
    el.miniBox.addEventListener('pointerup', endMini);
    el.miniBox.addEventListener('pointercancel', endMini);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', function () { keys.left = keys.right = keys.up = keys.down = false; });
    requestAnimationFrame(frame);
  }

  start();
})();
