/*
 * 3D-поверхность функции z = f(x, y, t) — чистый Canvas 2D, без библиотек.
 *
 * Конвейер кадра:
 *   1) высоты f в узлах сетки (N+1)×(N+1); при смене функции — плавный морфинг;
 *   2) нормали в узлах центральными разностями → освещённость по Ламберту
 *      в каждом узле (ключевой + заполняющий свет, привязаны к камере);
 *   3) перспективная проекция камеры, медленно облетающей график;
 *   4) сортировка N×N четырёхугольников по средней глубине — алгоритм художника
 *      (ключ «глубина << 14 | индекс» + нативная сортировка Uint32Array);
 *   5) заливка от дальних к ближним: цвет = палитра(высота) × освещённость,
 *      свет считается в линейном RGB, готовые строки цвета берутся из таблицы.
 */
(function () {
  'use strict';

  // ─────────────────────────── Константы ───────────────────────────
  const MAX_DT = 0.05;
  const MORPH_TIME = 1.1;
  const AUTO_SPIN = 0.13;                 // рад/с — медленный облёт
  const EL_MIN = 0.1, EL_MAX = 1.35;
  const EL_DEFAULT = 0.6, AZ_DEFAULT = 0.72;
  const ZOOM_MIN = 0.55, ZOOM_MAX = 2.6;
  const CAM_DIST = 4.6, FIT_RADIUS = 1.55;
  const BASE_AMP = 0.5;                   // мировая высота на единицу f
  const H_STEPS = 256, I_STEPS = 64, I_MAX = 1.4;
  const I_SCALE = (I_STEPS - 1) / I_MAX;
  const AMB = 0.07, SKY = 0.10, K_KEY = 1.0, K_FILL = 0.24, BACK_DIM = 0.75;
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const MINUS = '−';

  // ─────────────────────────── Функции ───────────────────────────
  // u, v ∈ [−1, 1] — координаты сетки, t — время (с). Результат ~ [lo, hi].
  const FUNCS = [
    {
      name: 'Рябь',
      expr: 'z = sin(k·r − ω·t) / (1 + c·r)',
      lo: -1, hi: 1,
      f: function (u, v, t) {
        const r = Math.sqrt(u * u + v * v + 0.004);   // смягчённый r — без излома в центре
        return 1.2 * Math.sin(15 * r - 3.2 * t) / (1 + 3.4 * r);
      }
    },
    {
      name: 'Седло',
      expr: 'z = (x² − y²) · a(t)',
      lo: -1, hi: 1,
      f: function (u, v, t) {
        return (u * u - v * v) * (0.82 + 0.18 * Math.sin(1.1 * t));
      }
    },
    {
      name: 'Гауссиана',
      expr: 'z = A·exp(−|p − p₀(t)|² / 2σ(t)²) − b',
      lo: -0.9, hi: 1,
      f: function (u, v, t) {
        const cx = 0.16 * Math.cos(0.55 * t), cy = 0.16 * Math.sin(0.83 * t);
        const s = 0.31 + 0.04 * Math.sin(1.3 * t);
        const dx = u - cx, dy = v - cy;
        return 1.9 * Math.exp(-(dx * dx + dy * dy) / (2 * s * s)) - 0.9;
      }
    },
    {
      name: 'Интерференция',
      expr: 'z = w(r₁) + w(r₂),  w(r) = sin(k·r − ω·t) / (1 + c·r)',
      lo: -0.9, hi: 0.9,
      f: function (u, v, t) {
        const a = u + 0.48, b = u - 0.48, vv = v * v + 0.003;
        const r1 = Math.sqrt(a * a + vv), r2 = Math.sqrt(b * b + vv);
        const ph = 3.4 * t;
        return 0.64 * (Math.sin(17 * r1 - ph) / (1 + 1.7 * r1) + Math.sin(17 * r2 - ph) / (1 + 1.7 * r2));
      }
    },
    {
      name: 'Волны',
      expr: 'z = sin(a·x + t)·cos(b·y − t) + …',
      lo: -1, hi: 1,
      f: function (u, v, t) {
        return 0.68 * Math.sin(4.2 * u + 1.3 * t) * Math.cos(3.6 * v - 0.9 * t) +
               0.32 * Math.sin(2.6 * (u + v) - 1.9 * t);
      }
    }
  ];
  const FLAT = { lo: -1, hi: 1, f: function () { return 0; } };   // стартовая плоскость
  const getFn = (i) => (i < 0 ? FLAT : FUNCS[i]);
  const ease = (x) => x * x * (3 - 2 * x);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  // ─────────────────────────── Палитры ───────────────────────────
  const PALETTES = [
    { name: 'Viridis', stops: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'] },
    { name: 'Turbo', stops: ['#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#24eca6', '#61fc6c', '#a4fc3b', '#d1e834', '#f3c63a', '#fe9b2d', '#f36315', '#d93806', '#b11901', '#7a0402'] },
    { name: 'Закат', stops: ['#211552', '#3d1a6c', '#63207c', '#8c2981', '#b5367a', '#dc4b69', '#f37458', '#fca050', '#fdd070', '#fbf3b0'] }
  ];

  function hexRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const toLin = (c) => Math.pow(c / 255, 2.2);
  const toSrgb8 = (x) => (x <= 0 ? 0 : x >= 1 ? 255 : Math.round(Math.pow(x, 1 / 2.2) * 255));
  const hex = (r, g, b) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);

  function samplePalette(st, x) {
    const n = st.length - 1;
    const p = clamp(x, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(p)), f = p - i;
    const A = st[i], B = st[i + 1];
    return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
  }

  // Таблица готовых строк цвета: [высота 0..255] × [освещённость 0..63].
  function buildLut(pal) {
    const st = pal.stops.map(hexRgb);
    const fill = new Array(H_STEPS * I_STEPS);
    const wire = new Array(H_STEPS * I_STEPS);
    for (let h = 0; h < H_STEPS; h++) {
      const c = samplePalette(st, h / (H_STEPS - 1));
      const lr = toLin(c[0]), lg = toLin(c[1]), lb = toLin(c[2]);
      for (let k = 0; k < I_STEPS; k++) {
        const I = k / I_SCALE;
        const idx = h * I_STEPS + k;
        fill[idx] = hex(toSrgb8(lr * I), toSrgb8(lg * I), toSrgb8(lb * I));
        const w = I * 0.3 + 0.004;                      // «чернила» каркаса — тот же тон, темнее
        wire[idx] = hex(toSrgb8(lr * w), toSrgb8(lg * w), toSrgb8(lb * w));
      }
    }
    const n = pal.stops.length - 1;
    const stopsCss = pal.stops.map((c, i) => c + ' ' + (i / n * 100).toFixed(1) + '%').join(', ');
    return { fill: fill, wire: wire, stopsCss: stopsCss };
  }
  const lutCache = [];
  const getLut = (i) => lutCache[i] || (lutCache[i] = buildLut(PALETTES[i]));

  // ─────────────────────────── Состояние ───────────────────────────
  const state = {
    fn: 0, fnFrom: -1, mix: 0,
    t: 0, paused: false,
    spin: true, wire: true, pal: 0,
    az: AZ_DEFAULT, el: EL_DEFAULT, elGoal: null,
    zoom: 0.84, zoomTarget: 1,
    spinVel: AUTO_SPIN,
    ampMul: 1
  };

  // ─────────────────────────── Буферы сетки ───────────────────────────
  let N = 0, M = 0, Q = 0;
  let grid, fz, It, Ib, sx, sy, sd, keys;
  let depthMin = 0, depthMax = 1, curLo = -1, curHi = 1;

  function alloc(n) {
    N = n; M = n + 1; Q = n * n;
    const V = M * M;
    grid = new Float32Array(M);
    for (let i = 0; i < M; i++) grid[i] = -1 + 2 * i / N;
    fz = new Float32Array(V);
    It = new Float32Array(V);
    Ib = new Float32Array(V);
    sx = new Float32Array(V);
    sy = new Float32Array(V);
    sd = new Float32Array(V);
    keys = new Uint32Array(Q);
  }

  // ─────────────────────────── Canvas и раскладка ───────────────────────────
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const panel = document.getElementById('panel');
  const hud = document.querySelector('.hud');
  let W = 1, H = 1, dpr = 1, X0 = 0, Y0 = 0, fitR = 100;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    layout();
  }

  function layout() {
    const narrow = W <= 760;
    const pr = panel.getBoundingClientRect();
    const top = narrow ? hud.getBoundingClientRect().bottom + 10 : 22;
    const bottom = Math.max(top + 120, pr.top - 10);
    const availH = bottom - top;
    const side = narrow ? 8 : 86;                       // место под цветовую шкалу (симметрично)
    const availW = Math.max(120, W - 2 * side);
    fitR = Math.max(50, Math.min(availW * 0.47, availH * 0.56));
    X0 = W / 2;
    Y0 = top + availH * 0.47;
  }

  // ─────────────────────────── Камера ───────────────────────────
  let Cx = 0, Cy = 0, Cz = 0, Rx = 0, Ry = 0, Ux = 0, Uy = 0, Uz = 1, Fx = 0, Fy = 0, Fz = -1, FOC = 1;
  let L1x = 0, L1y = 0, L1z = 1, L2x = 0, L2y = 0, L2z = 1;

  function setupCamera() {
    const ca = Math.cos(state.az), sa = Math.sin(state.az);
    const ce = Math.cos(state.el), se = Math.sin(state.el);
    Cx = CAM_DIST * ce * ca; Cy = CAM_DIST * ce * sa; Cz = CAM_DIST * se;
    Fx = -ce * ca; Fy = -ce * sa; Fz = -se;             // вперёд — в центр графика
    Rx = -sa; Ry = ca;                                  // вправо (горизонтально)
    Ux = -se * ca; Uy = -se * sa; Uz = ce;              // вверх экрана
    FOC = fitR * Math.sqrt(CAM_DIST * CAM_DIST - FIT_RADIUS * FIT_RADIUS) / FIT_RADIUS * state.zoom;

    // Свет привязан к камере: ключевой — спереди-слева-сверху, заполняющий — сзади-справа.
    const a1 = state.az - 0.9, e1 = 0.85, a2 = state.az + 2.3, e2 = 0.35;
    L1x = Math.cos(e1) * Math.cos(a1); L1y = Math.cos(e1) * Math.sin(a1); L1z = Math.sin(e1);
    L2x = Math.cos(e2) * Math.cos(a2); L2y = Math.cos(e2) * Math.sin(a2); L2z = Math.sin(e2);
  }

  const P = { x: 0, y: 0, d: 0 };
  function pr(x, y, z) {
    const ex = x - Cx, ey = y - Cy, ez = z - Cz;
    const zc = ex * Fx + ey * Fy + ez * Fz;
    const s = FOC / zc;
    P.x = X0 + (ex * Rx + ey * Ry) * s;
    P.y = Y0 - (ex * Ux + ey * Uy + ez * Uz) * s;
    P.d = zc;
    return P;
  }
  function mv(x, y, z) { pr(x, y, z); ctx.moveTo(P.x, P.y); }
  function ln(x, y, z) { pr(x, y, z); ctx.lineTo(P.x, P.y); }
  function seg3(x1, y1, z1, x2, y2, z2) { mv(x1, y1, z1); ln(x2, y2, z2); }
  function quad3(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4) {
    mv(x1, y1, z1); ln(x2, y2, z2); ln(x3, y3, z3); ln(x4, y4, z4); ctx.closePath();
  }

  // ─────────────────────────── Поверхность ───────────────────────────
  function computeHeights() {
    const t = state.t;
    const fb = getFn(state.fn).f;
    const blending = state.mix < 1;
    const fa = blending ? getFn(state.fnFrom).f : null;
    const m = ease(state.mix);
    for (let j = 0, k = 0; j < M; j++) {
      const v = grid[j];
      for (let i = 0; i < M; i++, k++) {
        const u = grid[i];
        let z = fb(u, v, t);
        if (blending) { const z0 = fa(u, v, t); z = z0 + (z - z0) * m; }
        fz[k] = z;
      }
    }
    const A = getFn(state.fnFrom), B = getFn(state.fn);
    curLo = blending ? A.lo + (B.lo - A.lo) * m : B.lo;
    curHi = blending ? A.hi + (B.hi - A.hi) * m : B.hi;
  }

  // Нормали в узлах (центральные разности) → Ламберт в узлах → проекция узлов.
  function shadeAndProject() {
    const A = BASE_AMP * state.ampMul;
    const h = 2 / N;
    let dmin = Infinity, dmax = -Infinity;
    for (let j = 0, k = 0; j < M; j++) {
      const ey = grid[j] - Cy;
      const jd = j > 0 ? M : 0, ju = j < N ? M : 0;
      const gyk = A / (h * ((j > 0 ? 1 : 0) + (j < N ? 1 : 0)));
      for (let i = 0; i < M; i++, k++) {
        const il = i > 0 ? 1 : 0, ir = i < N ? 1 : 0;
        const gx = (fz[k + ir] - fz[k - il]) * A / (h * (il + ir));
        const gy = (fz[k + ju] - fz[k - jd]) * gyk;
        const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        const nx = -gx * inv, ny = -gy * inv, nz = inv;
        const d1 = nx * L1x + ny * L1y + nz * L1z;
        const d2 = nx * L2x + ny * L2y + nz * L2z;
        It[k] = AMB + SKY * (0.5 + 0.5 * nz) + (d1 > 0 ? K_KEY * d1 : 0) + (d2 > 0 ? K_FILL * d2 : 0);
        Ib[k] = AMB + SKY * (0.5 - 0.5 * nz) + (d1 < 0 ? -K_KEY * d1 : 0) + (d2 < 0 ? -K_FILL * d2 : 0);

        const ex = grid[i] - Cx, ez = A * fz[k] - Cz;
        const zc = ex * Fx + ey * Fy + ez * Fz;
        const s = FOC / zc;
        sx[k] = X0 + (ex * Rx + ey * Ry) * s;
        sy[k] = Y0 - (ex * Ux + ey * Uy + ez * Uz) * s;
        sd[k] = zc;
        if (zc < dmin) dmin = zc;
        if (zc > dmax) dmax = zc;
      }
    }
    depthMin = dmin; depthMax = dmax;
  }

  // Алгоритм художника: ключ = (квантованная «дальность» << 14) | индекс четырёхугольника.
  function sortQuads() {
    const range = depthMax - depthMin;
    const sc = range > 1e-9 ? 262143 / range : 0;
    const dmax = depthMax;
    for (let j = 0, q = 0; j < N; j++) {
      let a = j * M;
      for (let i = 0; i < N; i++, q++, a++) {
        const dep = (sd[a] + sd[a + 1] + sd[a + M] + sd[a + M + 1]) * 0.25;
        keys[q] = ((((dmax - dep) * sc) | 0) << 14) | q;
      }
    }
    keys.sort();                                        // по возрастанию: сначала дальние
  }

  function drawSurface(lut) {
    const fill = lut.fill, wireLut = lut.wire;
    const lo = curLo, invR = 1 / Math.max(1e-6, curHi - curLo);
    const seamW = Math.max(0.5, 1 / dpr);               // обводка своим цветом — без щелей АА
    const wireW = Math.max(0.75, 1 / dpr);
    const wire = state.wire;
    const step = Math.max(1, Math.round(N / 30));       // ~30 линий каркаса при любой сетке
    ctx.lineJoin = 'bevel';
    ctx.lineCap = 'butt';
    ctx.lineWidth = seamW;

    for (let n = 0; n < Q; n++) {
      const q = keys[n] & 0x3FFF;
      const j = (q / N) | 0, i = q - j * N;
      const a = j * M + i, b = a + 1, c = b + M, d = a + M;
      const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b];
      const cx = sx[c], cy = sy[c], dx = sx[d], dy = sy[d];

      // Ориентация на экране: лицевая сторона (верх) или изнанка.
      const cross = (cx - ax) * (dy - by) - (cy - ay) * (dx - bx);
      let I;
      if (cross <= 0) I = (It[a] + It[b] + It[c] + It[d]) * 0.25;
      else I = (Ib[a] + Ib[b] + Ib[c] + Ib[d]) * (0.25 * BACK_DIM);

      let hn = ((fz[a] + fz[b] + fz[c] + fz[d]) * 0.25 - lo) * invR;
      hn = hn < 0 ? 0 : hn > 1 ? 1 : hn;
      let ki = (I * I_SCALE + 0.5) | 0;
      if (ki >= I_STEPS) ki = I_STEPS - 1;
      const li = ((hn * (H_STEPS - 1) + 0.5) | 0) * I_STEPS + ki;
      const col = fill[li];

      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.stroke();

      if (wire) {
        const eL = i % step === 0, eR = (i + 1) % step === 0 || i + 1 === N;
        const eB = j % step === 0, eT = (j + 1) % step === 0 || j + 1 === N;
        if (eL || eR || eB || eT) {
          ctx.beginPath();
          if (eB) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
          if (eR) { ctx.moveTo(bx, by); ctx.lineTo(cx, cy); }
          if (eT) { ctx.moveTo(dx, dy); ctx.lineTo(cx, cy); }
          if (eL) { ctx.moveTo(ax, ay); ctx.lineTo(dx, dy); }
          ctx.lineWidth = wireW;
          ctx.strokeStyle = wireLut[li];
          ctx.stroke();
          ctx.lineWidth = seamW;
        }
      }
    }
  }

  // ─────────────────────────── Коробка осей ───────────────────────────
  function boxGeometry() {
    const A = BASE_AMP * state.ampMul;
    return {
      A: A,
      zf: -A * 1.12 - 0.04,
      zt: A * 1.12 + 0.04,
      fxs: Math.cos(state.az) > 0 ? -1 : 1,             // дальний угол — против камеры
      fys: Math.sin(state.az) > 0 ? -1 : 1
    };
  }

  function drawBackdrop(b) {
    const zf = b.zf, zt = b.zt, fxs = b.fxs, fys = b.fys, A = b.A;
    ctx.lineJoin = 'miter';
    ctx.lineWidth = 1;

    // Пол.
    ctx.beginPath();
    quad3(-1, -1, zf, 1, -1, zf, 1, 1, zf, -1, 1, zf);
    ctx.fillStyle = 'rgba(120, 140, 215, 0.06)';
    ctx.fill();

    // Две задние стенки — лёгкий градиент снизу вверх.
    pr(fxs, fys, zf); const gx0 = P.x, gy0 = P.y;
    pr(fxs, fys, zt); const gx1 = P.x, gy1 = P.y;
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, 'rgba(120, 140, 215, 0.075)');
    g.addColorStop(1, 'rgba(120, 140, 215, 0.012)');
    ctx.beginPath();
    quad3(fxs, -1, zf, fxs, 1, zf, fxs, 1, zt, fxs, -1, zt);
    quad3(-1, fys, zf, 1, fys, zf, 1, fys, zt, -1, fys, zt);
    ctx.fillStyle = g;
    ctx.fill();

    // Сетка на полу и стенках.
    ctx.beginPath();
    for (let s = -1; s <= 1.0001; s += 0.25) {
      seg3(s, -1, zf, s, 1, zf);
      seg3(-1, s, zf, 1, s, zf);
      seg3(fxs, s, zf, fxs, s, zt);
      seg3(s, fys, zf, s, fys, zt);
    }
    for (let f = -1; f <= 1.0001; f += 0.5) {
      const z = A * f;
      seg3(fxs, -1, z, fxs, 1, z);
      seg3(-1, fys, z, 1, fys, z);
    }
    ctx.strokeStyle = 'rgba(165, 185, 245, 0.085)';
    ctx.stroke();

    // Рёбра коробки.
    ctx.beginPath();
    quad3(-1, -1, zf, 1, -1, zf, 1, 1, zf, -1, 1, zf);
    seg3(fxs, -1, zt, fxs, 1, zt);
    seg3(-1, fys, zt, 1, fys, zt);
    seg3(fxs, fys, zf, fxs, fys, zt);
    seg3(fxs, -fys, zf, fxs, -fys, zt);
    seg3(-fxs, fys, zf, -fxs, fys, zt);
    ctx.strokeStyle = 'rgba(180, 196, 250, 0.2)';
    ctx.stroke();
  }

  function fmtTick(v) {
    if (Math.abs(v) < 1e-9) return '0';
    const s = String(Math.abs(v)).replace('.', ',');
    return (v < 0 ? MINUS : '') + s;
  }

  function drawLabels(b) {
    const zf = b.zf, zt = b.zt, fxs = b.fxs, fys = b.fys, A = b.A;
    const nxs = -fxs, nys = -fys;
    const ticks = [-1, 0, 1];

    // Засечки на ближних рёбрах пола.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(185, 200, 250, 0.4)';
    ctx.beginPath();
    for (let n = 0; n < ticks.length; n++) {
      const v = ticks[n];
      seg3(v, nys, zf, v, nys * 1.05, zf);
      seg3(nxs, v, zf, nxs * 1.05, v, zf);
    }
    ctx.stroke();

    ctx.font = '500 11px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(205, 215, 242, 0.62)';
    for (let n = 0; n < ticks.length; n++) {
      const v = ticks[n];
      pr(v, nys * 1.14, zf); ctx.fillText(fmtTick(v), P.x, P.y);
      pr(nxs * 1.14, v, zf); ctx.fillText(fmtTick(v), P.x, P.y);
    }

    // Ось z — на вертикальном ребре бокового угла, который левее на экране.
    const xa = pr(fxs, nys, 0).x, xb = pr(nxs, fys, 0).x;
    const zx = xa < xb ? fxs : nxs, zy = xa < xb ? nys : fys;
    ctx.textAlign = 'right';
    ctx.beginPath();
    for (let n = 0; n < ticks.length; n++) {
      pr(zx, zy, A * ticks[n]);
      ctx.moveTo(P.x - 2, P.y); ctx.lineTo(P.x - 7, P.y);
    }
    ctx.stroke();
    for (let n = 0; n < ticks.length; n++) {
      pr(zx, zy, A * ticks[n]);
      ctx.fillText(fmtTick(ticks[n]), P.x - 10, P.y);
    }

    // Имена осей.
    ctx.font = 'italic 600 13px ' + FONT;
    ctx.fillStyle = 'rgba(225, 233, 252, 0.88)';
    ctx.textAlign = 'center';
    pr(0, nys * 1.32, zf); ctx.fillText('x', P.x, P.y);
    pr(nxs * 1.32, 0, zf); ctx.fillText('y', P.x, P.y);
    pr(zx, zy, zt); ctx.fillText('z', P.x - 10, P.y - 12);
  }

  // ─────────────────────────── Кадр ───────────────────────────
  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    setupCamera();
    computeHeights();
    shadeAndProject();
    sortQuads();
    const box = boxGeometry();
    drawBackdrop(box);
    drawSurface(getLut(state.pal));
    drawLabels(box);
  }

  const pointers = new Map();
  let pinch = 0, lastMove = 0;

  function update(dt) {
    if (!state.paused) state.t += dt;
    if (state.mix < 1) state.mix = Math.min(1, state.mix + dt / MORPH_TIME);
    if (pointers.size === 0) {
      const target = state.spin ? AUTO_SPIN : 0;
      state.spinVel += (target - state.spinVel) * (1 - Math.exp(-dt * 1.4));
      state.az += state.spinVel * dt;
      if (state.az > 1000) state.az -= Math.PI * 2 * 159;
      if (state.az < -1000) state.az += Math.PI * 2 * 159;
      if (state.elGoal !== null) {
        state.el += (state.elGoal - state.el) * (1 - Math.exp(-dt * 6));
        if (Math.abs(state.elGoal - state.el) < 1e-3) { state.el = state.elGoal; state.elGoal = null; }
      }
    }
    state.zoom += (state.zoomTarget - state.zoom) * (1 - Math.exp(-dt * 7));
  }

  const elStats = document.getElementById('stats');
  let last = 0, statT = 0, statN = 0, statWork = 0;
  const fmtInt = (n) => n.toLocaleString('ru-RU');
  const fmt1 = (x) => x.toFixed(1).replace('.', ',');

  function frame(now) {
    if (!last) last = now;
    let raw = (now - last) / 1000;
    last = now;
    if (!(raw >= 0)) raw = 0;
    const dt = Math.min(raw, MAX_DT);
    update(dt);
    const t0 = performance.now();
    render();
    const work = performance.now() - t0;
    statT += raw; statN++; statWork += work;
    if (statT >= 0.5) {
      elStats.textContent = N + ' × ' + N + ' ячеек · ' + fmtInt(Q) + ' полигонов · ' +
        fmt1(statWork / statN) + ' мс/кадр · ' + Math.round(statN / statT) + ' к/с';
      statT = 0; statN = 0; statWork = 0;
    }
    requestAnimationFrame(frame);
  }

  // ─────────────────────────── Интерфейс ───────────────────────────
  const elFuncs = document.getElementById('funcs');
  const elName = document.getElementById('fName');
  const elExpr = document.getElementById('fExpr');
  const btnWire = document.getElementById('btnWire');
  const btnSpin = document.getElementById('btnSpin');
  const btnPause = document.getElementById('btnPause');
  const btnPal = document.getElementById('btnPal');
  const palChip = document.getElementById('palChip');
  const palName = document.getElementById('palName');
  const legendBar = document.getElementById('legendBar');
  const legendTicks = document.getElementById('legendTicks');
  const rngRes = document.getElementById('rngRes');
  const outRes = document.getElementById('outRes');
  const rngAmp = document.getElementById('rngAmp');
  const outAmp = document.getElementById('outAmp');

  function blurIfMouse(e) { if (e && e.detail > 0 && e.currentTarget) e.currentTarget.blur(); }

  FUNCS.forEach(function (F, idx) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.title = F.name + ' (' + (idx + 1) + ')';
    b.appendChild(document.createTextNode(F.name));
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = String(idx + 1);
    b.appendChild(k);
    b.addEventListener('click', function (e) { selectFn(idx); blurIfMouse(e); });
    elFuncs.appendChild(b);
  });

  function selectFn(idx) {
    if (idx === state.fn) return;
    if (state.mix < 1 && idx === state.fnFrom) {
      // Разворот текущего морфинга — без скачка.
      state.fnFrom = state.fn; state.fn = idx; state.mix = 1 - state.mix;
    } else {
      state.fnFrom = state.mix < 0.5 ? state.fnFrom : state.fn;
      state.fn = idx;
      state.mix = state.fnFrom === idx ? 1 : 0;
    }
    updateFuncUI();
  }

  function fmt2(x) {
    if (Math.abs(x) < 0.005) return '0';
    return (x < 0 ? MINUS : '') + Math.abs(x).toFixed(1).replace('.', ',');
  }

  function updateFuncUI() {
    const F = FUNCS[state.fn];
    Array.prototype.forEach.call(elFuncs.children, function (b, i) {
      b.classList.toggle('on', i === state.fn);
      b.setAttribute('aria-checked', i === state.fn ? 'true' : 'false');
    });
    elName.textContent = F.name;
    elExpr.textContent = F.expr;
    // Засечки шкалы — «круглые» значения внутри диапазона функции.
    legendTicks.textContent = '';
    for (let v = -1; v <= 1.0001; v += 0.5) {
      if (v < F.lo - 1e-6 || v > F.hi + 1e-6) continue;
      const s = document.createElement('span');
      s.style.top = ((F.hi - v) / (F.hi - F.lo) * 100).toFixed(2) + '%';
      s.textContent = fmt2(v);
      legendTicks.appendChild(s);
    }
  }

  function updatePaletteUI() {
    const lut = getLut(state.pal);
    palName.textContent = PALETTES[state.pal].name;
    palChip.style.background = 'linear-gradient(to right, ' + lut.stopsCss + ')';
    legendBar.style.background = 'linear-gradient(to top, ' + lut.stopsCss + ')';
  }

  function updateToggles() {
    btnWire.setAttribute('aria-pressed', String(state.wire));
    btnSpin.setAttribute('aria-pressed', String(state.spin));
    btnPause.setAttribute('aria-pressed', String(state.paused));
  }

  const toggleWire = () => { state.wire = !state.wire; updateToggles(); };
  const toggleSpin = () => { state.spin = !state.spin; updateToggles(); };
  const togglePause = () => { state.paused = !state.paused; updateToggles(); };
  const cyclePalette = () => { state.pal = (state.pal + 1) % PALETTES.length; updatePaletteUI(); };

  btnWire.addEventListener('click', function (e) { toggleWire(); blurIfMouse(e); });
  btnSpin.addEventListener('click', function (e) { toggleSpin(); blurIfMouse(e); });
  btnPause.addEventListener('click', function (e) { togglePause(); blurIfMouse(e); });
  btnPal.addEventListener('click', function (e) { cyclePalette(); blurIfMouse(e); });

  function paintRange(inp) {
    const p = (inp.value - inp.min) / (inp.max - inp.min) * 100;
    inp.style.setProperty('--p', p.toFixed(1) + '%');
  }
  rngRes.addEventListener('input', function () {
    const n = clamp(Math.round(+rngRes.value), 8, 120);
    outRes.textContent = String(n);
    alloc(n);
    paintRange(rngRes);
  });
  rngAmp.addEventListener('input', function () {
    state.ampMul = +rngAmp.value;
    outAmp.textContent = '×' + state.ampMul.toFixed(2).replace('.', ',');
    paintRange(rngAmp);
  });

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    const code = e.code || '';
    if (code.indexOf('Digit') === 0 || code.indexOf('Numpad') === 0) {
      const n = parseInt(code.replace(/\D/g, ''), 10) - 1;
      if (n >= 0 && n < FUNCS.length) { selectFn(n); e.preventDefault(); }
    } else if (code === 'KeyW') toggleWire();
    else if (code === 'KeyR') toggleSpin();
    else if (code === 'KeyC') cyclePalette();
    else if (code === 'Space') {
      if (tag === 'BUTTON') return;                      // пробел на кнопке — её собственное действие
      e.preventDefault();
      togglePause();
    }
  });

  // ─────────────────────────── Мышь и касания ───────────────────────────
  function pointerSpan() {
    const it = pointers.values();
    const a = it.next().value, b = it.next().value;
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* не критично */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinch = pointerSpan();
    canvas.classList.add('dragging');
    state.spinVel = 0;
    state.elGoal = null;
    lastMove = performance.now();
  });

  canvas.addEventListener('pointermove', function (e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      const dAz = -dx * 0.0065;
      state.az += dAz;
      state.el = clamp(state.el + dy * 0.0048, EL_MIN, EL_MAX);
      const now = performance.now();
      const dtm = Math.max(8, now - lastMove) / 1000;
      lastMove = now;
      state.spinVel = clamp(state.spinVel * 0.5 + (dAz / dtm) * 0.5, -3, 3);
    } else if (pointers.size === 2) {
      const s = pointerSpan();
      if (pinch > 0 && s > 0) state.zoomTarget = clamp(state.zoomTarget * s / pinch, ZOOM_MIN, ZOOM_MAX);
      pinch = s;
    }
  });

  function endPointer(e) {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) pinch = 0;
    if (pointers.size === 0) {
      canvas.classList.remove('dragging');
      if (performance.now() - lastMove > 90) state.spinVel = 0;   // отпустили без броска
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    state.zoomTarget = clamp(state.zoomTarget * Math.exp(-e.deltaY * unit * 0.0012), ZOOM_MIN, ZOOM_MAX);
  }, { passive: false });

  canvas.addEventListener('dblclick', function () {
    state.elGoal = EL_DEFAULT;
    state.zoomTarget = 1;
  });

  window.addEventListener('resize', resize);

  // ─────────────────────────── Старт ───────────────────────────
  // Значения ползунков могут быть восстановлены браузером — синхронизируемся с ними.
  alloc(clamp(Math.round(+rngRes.value) || 64, 8, 120));
  outRes.textContent = String(N);
  state.ampMul = +rngAmp.value || 1;
  outAmp.textContent = '×' + state.ampMul.toFixed(2).replace('.', ',');
  paintRange(rngRes);
  paintRange(rngAmp);
  updateFuncUI();
  updatePaletteUI();
  updateToggles();
  resize();
  requestAnimationFrame(frame);
})();
