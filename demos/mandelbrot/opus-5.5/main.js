(function () {
  'use strict';

  // ================= палитры =================
  // Циклические градиенты: t ∈ [0,1), после последней точки — снова первая.
  const PALETTES = [
    { name: 'Лазурь и золото', stops: [[0, [2, 4, 28]], [0.14, [12, 44, 125]], [0.3, [34, 110, 205]], [0.5, [236, 252, 255]], [0.66, [255, 172, 20]], [0.84, [110, 28, 8]]] },
    { name: 'Пламя', stops: [[0, [6, 2, 10]], [0.2, [88, 8, 32]], [0.4, [210, 58, 22]], [0.57, [255, 168, 48]], [0.7, [255, 244, 200]], [0.86, [128, 24, 64]]] },
    { name: 'Северное сияние', stops: [[0, [2, 6, 20]], [0.2, [8, 58, 92]], [0.4, [22, 188, 158]], [0.55, [205, 255, 215]], [0.72, [132, 92, 232]], [0.88, [40, 14, 82]]] },
    { name: 'Опал', stops: [[0, [10, 8, 22]], [0.18, [72, 40, 124]], [0.36, [232, 122, 170]], [0.52, [255, 228, 184]], [0.68, [120, 212, 222]], [0.85, [36, 86, 150]]] },
    { name: 'Графит', stops: [[0, [0, 0, 0]], [0.33, [104, 110, 128]], [0.52, [246, 246, 250]], [0.78, [58, 62, 78]]] }
  ];

  const PLACES = [
    { name: 'Долина морских коньков', cx: -0.7453, cy: 0.1127, w: 0.012 },
    { name: 'Долина слонов', cx: 0.2825, cy: 0.01, w: 0.028 },
    { name: 'Спирали в долине коньков', cx: -0.743643887037151, cy: 0.13182590420533, w: 3.5e-5 },
    { name: 'Мини-копия на антенне', cx: -1.7548776662466927, cy: 0, w: 0.04 },
    { name: 'Дендрит у c = i', cx: 0, cy: 1, w: 0.03 },
    { name: 'Глубина ~10¹⁰', cx: -0.743643887037151, cy: 0.13182590420533, w: 4e-10 }
  ];

  const LUT_N = 2048, LUT_MASK = LUT_N - 1;
  const lut = new Uint32Array(LUT_N);
  const INTERIOR = (0xff << 24) | (7 << 16) | (3 << 8) | 2; // rgb(2,3,7), ABGR little-endian
  const BG = '#03040a';
  const BAIL2 = 256 * 256;                  // большой радиус выхода → ровнее плавная раскраска
  const LEVELS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1]; // прогрессивные разрешения
  const MAX_ZOOM = 1e13;                    // дальше double уже не держит

  function buildLUT(p) {
    const s = p.stops, n = s.length;
    for (let i = 0; i < LUT_N; i++) {
      const t = i / LUT_N;
      let k = n - 1;
      for (let j = 0; j < n - 1; j++) if (t >= s[j][0] && t < s[j + 1][0]) { k = j; break; }
      const t1 = s[k][0], t2 = k + 1 < n ? s[k + 1][0] : 1;
      const u = (t - t1) / (t2 - t1), u2 = u * u, u3 = u2 * u;
      const c0 = s[(k - 1 + n) % n][1], c1 = s[k][1], c2 = s[(k + 1) % n][1], c3 = s[(k + 2) % n][1];
      const rgb = [0, 0, 0];
      for (let ch = 0; ch < 3; ch++) { // Catmull-Rom: гладко и без изломов на опорных точках
        const a = c0[ch], b = c1[ch], c = c2[ch], d = c3[ch];
        const v = 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3);
        rgb[ch] = v < 0 ? 0 : v > 255 ? 255 : v | 0;
      }
      lut[i] = (0xff << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0];
    }
  }

  function cssGradient(p) {
    const parts = p.stops.map(([t, c]) => `rgb(${c[0]},${c[1]},${c[2]}) ${(t * 100).toFixed(1)}%`);
    const c = p.stops[0][1];
    parts.push(`rgb(${c[0]},${c[1]},${c[2]}) 100%`);
    return `linear-gradient(90deg, ${parts.join(', ')})`;
  }

  // ================= состояние =================
  const cv = document.getElementById('view');
  const ctx = cv.getContext('2d', { alpha: false });
  let dpr = 1, cssW = 1, cssH = 1, W = 1, H = 1;
  let sRef = 0;                                  // масштаб «зум 1×» (комплексных единиц на CSS-пиксель)
  const view = { cx: -0.65, cy: 0, s: 0.004 };   // центр и масштаб, мнимая ось вверх
  let zoomAnim = null, flight = null;
  let levels = [], job = null, dirty = true;
  const back = { cv: document.createElement('canvas'), ctx: null, view: null, r: 0 };
  back.ctx = back.cv.getContext('2d', { alpha: false });

  let paletteIdx = 0, density = 1, depthMul = 1, cycling = false;
  let colScale = 0.16, colOffset = 0;

  function homeS() { return Math.max(3.2 / cssW, 2.55 / cssH); }
  function clampS(s) { return Math.min(sRef * 3, Math.max(sRef / MAX_ZOOM, s)); }
  function zoomOf(s) { return sRef / s; }
  function iterFor(s) {
    const lz = Math.log10(Math.max(1, zoomOf(s)));
    const n = (220 + 140 * lz + 22 * lz * lz) * depthMul;
    return Math.max(64, Math.min(60000, Math.round(n)));
  }

  // ================= ядро =================
  // Возвращает плавный счётчик итераций μ ≥ 0 или −1 для точек множества.
  function iterate(cr, ci, maxIter, eps) {
    const xq = cr - 0.25, q = xq * xq + ci * ci;
    if (q * (q + xq) <= 0.25 * ci * ci) return -1;           // главная кардиоида
    const xp = cr + 1;
    if (xp * xp + ci * ci <= 0.0625) return -1;               // круг периода 2
    let zr = 0, zi = 0, zr2 = 0, zi2 = 0;
    let pr = 0, pi = 0, lim = 8, cnt = 0;
    for (let n = 0; n < maxIter; n++) {
      zi = 2 * zr * zi + ci;
      zr = zr2 - zi2 + cr;
      zr2 = zr * zr; zi2 = zi * zi;
      const r2 = zr2 + zi2;
      if (r2 > BAIL2) {
        const m = n + 2 - Math.log2(0.5 * Math.log2(r2));   // μ = N + 1 − log2(log2|z|)
        return m > 0 ? m : 0;
      }
      const dr = zr - pr, di = zi - pi;                       // проверка периодичности (Брент)
      if (dr < eps && dr > -eps && di < eps && di > -eps) return -1;
      if (++cnt === lim) { cnt = 0; if (lim < 1048576) lim += lim; pr = zr; pi = zi; }
    }
    return -1;
  }

  function colorOf(m) {
    if (m < 0) return INTERIOR;
    const t = (Math.sqrt(m) - 1) * colScale + colOffset;
    return lut[((t * LUT_N) | 0) & LUT_MASK];
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cssW = Math.max(1, window.innerWidth);
    cssH = Math.max(1, window.innerHeight);
    W = Math.max(1, Math.round(cssW * dpr));
    H = Math.max(1, Math.round(cssH * dpr));
    cv.width = W; cv.height = H;
    back.cv.width = W; back.cv.height = H; back.view = null;
    if (!sRef) { sRef = homeS(); view.s = sRef; }
    levels = LEVELS.map((r) => {
      const w = Math.max(1, Math.ceil(W * r)), h = Math.max(1, Math.ceil(H * r));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d', { alpha: false });
      const img = g.createImageData(w, h);
      return { r, w, h, cv: c, ctx: g, img, u32: new Uint32Array(img.data.buffer), mu: new Float32Array(w * h) };
    });
    job = null;
    startJob();
  }

  function startJob() {
    if (job && job.shown >= 0) {
      // Удачный кадр старой задачи становится подложкой для плавного перехода.
      const jr = LEVELS[job.shown];
      const br = back.view ? eff(back.r, back.view, job.view) : 0;
      if (jr >= br) {
        back.ctx.fillStyle = BG; back.ctx.fillRect(0, 0, W, H);
        paintJob(back.ctx, job, job.view);
        back.view = job.view; back.r = jr;
      }
    }
    job = { view: { cx: view.cx, cy: view.cy, s: view.s }, maxIter: iterFor(view.s), lvl: 0, row: 0, shown: -1, t0: performance.now(), ms: 0, done: false };
    dirty = true;
  }

  // Считает строки, пока не выйдет бюджет времени; уровни от грубого к полному.
  function work(budget) {
    if (!job || job.done) return false;
    const tEnd = performance.now() + budget;
    const v = job.view, maxIter = job.maxIter;
    let progressed = false;
    while (job.lvl < levels.length) {
      const L = levels[job.lvl];
      const w = L.w, h = L.h, u32 = L.u32, mu = L.mu;
      const sx = cssW * v.s / w, sy = cssH * v.s / h;
      const x0 = v.cx + (0.5 - w / 2) * sx, y0 = v.cy - (0.5 - h / 2) * sy;
      const eps = Math.min(1e-10, sx * 1e-4);
      const rowStart = job.row;
      let j = rowStart;
      while (j < h) {
        const ci = y0 - j * sy;
        let k = j * w;
        for (let i = 0; i < w; i++, k++) {
          const m = iterate(x0 + i * sx, ci, maxIter, eps);
          mu[k] = m;
          u32[k] = colorOf(m);
        }
        j++;
        if (performance.now() > tEnd) break;
      }
      if (j > rowStart) { L.ctx.putImageData(L.img, 0, 0, 0, rowStart, w, j - rowStart); progressed = true; }
      job.row = j;
      if (j >= h) {
        job.shown = job.lvl; job.lvl++; job.row = 0;
        if (job.lvl >= levels.length) { job.done = true; job.ms = performance.now() - job.t0; break; }
      }
      if (performance.now() > tEnd) break;
    }
    return progressed;
  }

  function progress() {
    if (job.done) return 1;
    let tot = 0, done = 0;
    for (let l = 0; l < levels.length; l++) {
      const c = levels[l].w * levels[l].h;
      tot += c;
      if (l < job.lvl) done += c; else if (l === job.lvl) done += job.row * levels[l].w;
    }
    return done / tot;
  }

  function recolor() {
    if (!job) return;
    const list = [];
    if (job.shown >= 0) list.push([job.shown, levels[job.shown].h]);
    if (!job.done && job.row > 0) list.push([job.lvl, job.row]);
    for (const [l, rows] of list) {
      const L = levels[l], n = rows * L.w, mu = L.mu, u32 = L.u32;
      for (let k = 0; k < n; k++) u32[k] = colorOf(mu[k]);
      L.ctx.putImageData(L.img, 0, 0, 0, 0, L.w, rows);
    }
    if (job.shown >= 0) back.view = null; // подложка в старых цветах больше не нужна
    dirty = true;
  }

  // ================= вывод =================
  function eff(r, sv, v) { return r * Math.min(1, v.s / sv.s); }

  // Рисует картинку, посчитанную для вида sv, в текущем виде v (сдвиг + масштаб).
  function blit(g, src, sw, sh, rows, sv, v) {
    const k = sv.s / v.s;
    if (!(k > 1 / 256 && k < 256)) return;
    const ox = ((sv.cx - v.cx) / v.s + cssW / 2 * (1 - k)) * dpr;
    const oy = ((v.cy - sv.cy) / v.s + cssH / 2 * (1 - k)) * dpr;
    g.drawImage(src, 0, 0, sw, rows, ox, oy, W * k, H * k * rows / sh);
  }

  function paintJob(g, j, v) {
    let q = 0;
    if (j.shown >= 0) { const L = levels[j.shown]; blit(g, L.cv, L.w, L.h, L.h, j.view, v); q = LEVELS[j.shown]; }
    if (!j.done && j.row > 0 && LEVELS[j.lvl] > q) { const L = levels[j.lvl]; blit(g, L.cv, L.w, L.h, j.row, j.view, v); }
  }

  function draw() {
    const v = view;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    let q = 0;
    if (job.shown >= 0) {
      const L = levels[job.shown];
      blit(ctx, L.cv, L.w, L.h, L.h, job.view, v);
      q = eff(LEVELS[job.shown], job.view, v);
    }
    if (back.view) {
      const br = eff(back.r, back.view, v);
      if (br > q) { blit(ctx, back.cv, W, H, H, back.view, v); q = br; }
    }
    if (!job.done && job.row > 0 && eff(LEVELS[job.lvl], job.view, v) >= q) {
      const L = levels[job.lvl];
      blit(ctx, L.cv, L.w, L.h, job.row, job.view, v);
    }
  }

  // ================= HUD =================
  const el = {
    zoom: document.getElementById('s-zoom'), center: document.getElementById('s-center'),
    cursor: document.getElementById('s-cursor'), iter: document.getElementById('s-iter'),
    render: document.getElementById('s-render'), warn: document.getElementById('s-warn')
  };
  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
  function fmtZoom(z) {
    if (z < 1000) return (z < 10 ? z.toFixed(2) : z < 100 ? z.toFixed(1) : z.toFixed(0)) + '×';
    const e = Math.floor(Math.log10(z));
    return (z / Math.pow(10, e)).toFixed(2) + '·10' + String(e).replace(/./g, (c) => SUP[c]) + '×';
  }
  function fmtC(re, im, s) {
    const d = Math.max(3, Math.min(17, Math.ceil(-Math.log10(s)) + 1));
    return (re < 0 ? '−' : ' ') + Math.abs(re).toFixed(d) + (im < 0 ? ' − ' : ' + ') + Math.abs(im).toFixed(d) + 'i';
  }
  function setText(node, s) { if (node.textContent !== s) node.textContent = s; }
  let mouse = null;
  function hud() {
    const z = zoomOf(view.s);
    setText(el.zoom, fmtZoom(z));
    setText(el.center, fmtC(view.cx, view.cy, view.s));
    if (mouse) {
      const re = view.cx + (mouse.x - cssW / 2) * view.s, im = view.cy - (mouse.y - cssH / 2) * view.s;
      setText(el.cursor, fmtC(re, im, view.s));
    } else setText(el.cursor, '—');
    setText(el.iter, job.maxIter.toLocaleString('ru-RU'));
    setText(el.render, job.done
      ? `готово за ${job.ms < 1000 ? Math.round(job.ms) + ' мс' : (job.ms / 1000).toFixed(1) + ' с'} · ${W}×${H}`
      : `${Math.floor(progress() * 100)}% · уровень ${job.lvl + 1}/${LEVELS.length}`);
    el.warn.hidden = z < 1e12;
  }

  // ================= анимации вида =================
  function anchorAt(px, py) { return { ax: view.cx + (px - cssW / 2) * view.s, ay: view.cy - (py - cssH / 2) * view.s }; }

  // Плавный зум: точка под курсором остаётся на месте на всём протяжении анимации.
  function zoomAt(px, py, f, rate) {
    flight = null;
    const base = zoomAnim ? zoomAnim.target : view.s;
    const a = anchorAt(px, py);
    zoomAnim = { ax: a.ax, ay: a.ay, px, py, target: clampS(base * f), rate: rate || 16 };
  }
  function zoomNow(px, py, f) {
    const a = anchorAt(px, py);
    view.s = clampS(view.s * f);
    view.cx = a.ax - (px - cssW / 2) * view.s;
    view.cy = a.ay + (py - cssH / 2) * view.s;
  }
  function flyTo(cx, cy, s) {
    zoomAnim = null;
    s = clampS(s);
    const dz = Math.abs(Math.log10(s / view.s));
    const dd = Math.hypot(cx - view.cx, cy - view.cy) / Math.max(s, view.s) / Math.max(cssW, cssH);
    flight = { t: 0, dur: Math.min(6, 0.8 + 0.35 * dz + Math.min(0.8, dd * 0.3)), c0x: view.cx, c0y: view.cy, s0: view.s, c1x: cx, c1y: cy, s1: s };
  }
  function ease(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }

  function updateAnim(dt) {
    if (flight) {
      const f = flight;
      f.t += dt;
      const u = Math.min(1, f.t / f.dur), e = ease(u);
      if (u >= 1) { view.cx = f.c1x; view.cy = f.c1y; view.s = f.s1; flight = null; return; }
      const s = Math.exp(Math.log(f.s0) + (Math.log(f.s1) - Math.log(f.s0)) * e);
      // Центр приходит пропорционально линейному масштабу: на широком виде летим, на узком — ныряем.
      const w = Math.abs(f.s1 / f.s0 - 1) > 1e-6 ? (f.s0 - s) / (f.s0 - f.s1) : e;
      view.s = s;
      view.cx = f.c0x + (f.c1x - f.c0x) * w;
      view.cy = f.c0y + (f.c1y - f.c0y) * w;
    } else if (zoomAnim) {
      const a = zoomAnim;
      const ls = Math.log(view.s), lt = Math.log(a.target);
      let nl = ls + (lt - ls) * (1 - Math.exp(-dt * a.rate));
      if (Math.abs(lt - nl) < 2e-3) nl = lt;
      view.s = nl === lt ? a.target : Math.exp(nl);
      view.cx = a.ax - (a.px - cssW / 2) * view.s;
      view.cy = a.ay + (a.py - cssH / 2) * view.s;
      if (nl === lt) zoomAnim = null;
    }
  }

  // ================= ввод =================
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= cssH;
    dy = Math.max(-240, Math.min(240, dy));
    zoomAt(e.clientX, e.clientY, Math.exp(dy * 0.0018), 16);
  }, { passive: false });

  cv.addEventListener('dblclick', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.shiftKey ? 4 : 0.25, 8);
  });

  const pointers = new Map();
  let pinch = null, dragging = false;
  function pinchState() {
    const [a, b] = [...pointers.values()];
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  cv.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    flight = null;
    if (pointers.size === 1) { dragging = true; cv.classList.add('dragging'); }
    if (pointers.size === 2) { zoomAnim = null; pinch = pinchState(); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') mouse = { x: e.clientX, y: e.clientY };
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      view.cx -= dx * view.s; view.cy += dy * view.s;
      if (zoomAnim) { zoomAnim.px += dx; zoomAnim.py += dy; }
    } else if (pointers.size === 2 && pinch) {
      const n = pinchState();
      view.cx -= (n.mx - pinch.mx) * view.s; view.cy += (n.my - pinch.my) * view.s;
      if (n.d > 0 && pinch.d > 0) zoomNow(n.mx, n.my, pinch.d / n.d);
      pinch = n;
    }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { dragging = false; cv.classList.remove('dragging'); }
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pointers.size) mouse = null; });

  function goHome() { flyTo(-0.65, 0, homeS()); }

  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const cxp = cssW / 2, cyp = cssH / 2, step = 0.12 * Math.min(cssW, cssH) * view.s;
    switch (e.key) {
      case '+': case '=': zoomAt(cxp, cyp, 0.5, 10); break;
      case '-': case '_': zoomAt(cxp, cyp, 2, 10); break;
      case 'ArrowLeft': flyTo(view.cx - step, view.cy, view.s); break;
      case 'ArrowRight': flyTo(view.cx + step, view.cy, view.s); break;
      case 'ArrowUp': flyTo(view.cx, view.cy + step, view.s); break;
      case 'ArrowDown': flyTo(view.cx, view.cy - step, view.s); break;
      case '0': case 'r': case 'R': case 'к': case 'К': goHome(); break;
      default: return;
    }
    e.preventDefault();
  });

  // ================= панель =================
  const palBox = document.getElementById('palettes');
  const palBtns = PALETTES.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw';
    b.title = p.name;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', p.name);
    b.style.background = cssGradient(p);
    b.addEventListener('click', () => setPalette(i));
    palBox.appendChild(b);
    return b;
  });
  function setPalette(i) {
    paletteIdx = i;
    buildLUT(PALETTES[i]);
    palBtns.forEach((b, j) => b.setAttribute('aria-checked', String(j === i)));
    recolor();
  }

  const densityIn = document.getElementById('density');
  densityIn.addEventListener('input', () => {
    density = Math.pow(2, +densityIn.value);
    colScale = 0.16 * density;
    recolor();
  });

  const depthIn = document.getElementById('depth'), depthOut = document.getElementById('depth-out');
  depthIn.addEventListener('input', () => {
    depthMul = Math.pow(2, +depthIn.value);
    depthOut.textContent = '×' + depthMul.toFixed(depthMul < 10 ? 1 : 0);
  });

  const cycleBtn = document.getElementById('cycle');
  cycleBtn.addEventListener('click', () => {
    cycling = !cycling;
    cycleBtn.setAttribute('aria-pressed', String(cycling));
  });

  const placesSel = document.getElementById('places');
  PLACES.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = p.name;
    placesSel.appendChild(o);
  });
  placesSel.addEventListener('change', () => {
    const p = PLACES[+placesSel.value];
    if (p) flyTo(p.cx, p.cy, p.w / Math.min(cssW, cssH));
    placesSel.value = '';
    placesSel.blur();
  });

  document.getElementById('reset').addEventListener('click', goHome);

  // ================= цикл =================
  let resizePending = false;
  window.addEventListener('resize', () => { resizePending = true; });

  const drawn = { cx: NaN, cy: NaN, s: NaN };
  let last = performance.now(), hudT = 0;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0; else if (dt > 0.1) dt = 0.1;

    if (resizePending) { resizePending = false; resize(); }
    updateAnim(dt);

    if (cycling) { colOffset = (colOffset + dt * 0.045) % 1; recolor(); }

    const viewChanged = job.view.cx !== view.cx || job.view.cy !== view.cy || job.view.s !== view.s;
    if (viewChanged || job.maxIter !== iterFor(view.s)) {
      // Не перезапускаем, пока тяжёлый кадр не дал хоть что-то (иначе на глубине — вечная пустота).
      if (job.shown >= 0 || now - job.t0 > 1500) startJob();
    }

    const moving = !!(zoomAnim || flight || dragging || pinch);
    if (work(moving ? 9 : 14)) dirty = true;

    if (dirty || drawn.cx !== view.cx || drawn.cy !== view.cy || drawn.s !== view.s) {
      draw();
      drawn.cx = view.cx; drawn.cy = view.cy; drawn.s = view.s;
      dirty = false;
    }
    if (now - hudT > 60 || job.done) { hud(); hudT = now; }
    requestAnimationFrame(frame);
  }

  resize();
  setPalette(0);
  hud();
  requestAnimationFrame(frame);
})();
