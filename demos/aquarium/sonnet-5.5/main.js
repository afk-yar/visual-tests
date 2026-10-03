/* ==========================================================================
   Аквариум с рыбами — Canvas 2D, без библиотек и внешних ресурсов.

   Слои сцены (сзади вперёд):
     вода-градиент + дальний рельеф  ->  песок + каустики на песке
     -> задний план (водоросли, камни, рыбы; дымка по глубине)
     -> средний план (то же, дымка слабее)
     -> лучи света, облака мути, взвесь
     -> передний план (рыбы у стекла, корм, пузырьки, размытые листья)
     -> блики каустик по всей сцене -> поверхность воды -> виньетка/стекло.

   Рыбы: позвоночник из 24 точек с бегущей волной (амплитуда растёт к хвосту),
   тело строится по профилю, плавники — по кромке тела с собственным
   трепетом, разворот у стенок — «3D-поворот» через сжатие по X.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- утилиты */
  const PI = Math.PI, TAU = PI * 2;
  const sin = Math.sin, cos = Math.cos, sqrt = Math.sqrt, abs = Math.abs;
  const min = Math.min, max = Math.max, pow = Math.pow, exp = Math.exp;
  const floor = Math.floor, ceil = Math.ceil, atan2 = Math.atan2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const R = mulberry32(0x51A7E5);
  const rr = (a, b) => a + (b - a) * R();

  /* ------------------------------------------------------------------- DOM */
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: false });
  const el = id => document.getElementById(id);

  const st = { light: 0.87, haze: 0.45, speed: 1, paused: false };
  const OV = 0.06;                 // запас слоёв по краям под параллакс камеры
  let W = 0, H = 0, K = 1, S = 1, ZD = 800, RS = 1, rsInit = false;
  let T = 0, cam = 0;
  let needResize = true;

  const waterTop = () => H * 0.055;
  const GROUND0 = 0.705, GSPAN = 0.20;          // линия дна: далёкий край и разбег к стеклу
  const groundY = z => H * (GROUND0 + GSPAN * z);
  const pf = z => lerp(0.55, 1.45, z);          // коэффициент параллакса по глубине
  const zScale = z => lerp(0.55, 1.28, z);      // перспективный масштаб

  function newLayer(w, h) {
    const c = document.createElement('canvas');
    c.width = max(1, Math.round(w * K));
    c.height = max(1, Math.round(h * K));
    const g = c.getContext('2d');
    g.setTransform(K, 0, 0, K, 0, 0);
    return { c, g };
  }

  /* ----------------------------------------------------------------- вода */
  const WATER = [[0, '#7fe0e4'], [0.07, '#3fb6c8'], [0.22, '#1b8aae'], [0.45, '#0f6592'],
                 [0.70, '#0a4673'], [0.90, '#07305a'], [1, '#041e3d']];
  function waterGrad(g, h) {
    const gr = g.createLinearGradient(0, 0, 0, h);
    for (let i = 0; i < WATER.length; i++) gr.addColorStop(WATER[i][0], WATER[i][1]);
    return gr;
  }

  function smoothPath(g, xs, ys, n) {         // сглаженная ломаная через точки 0..n-1 (без moveTo)
    for (let i = 1; i < n - 1; i++) {
      g.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
    }
    g.lineTo(xs[n - 1], ys[n - 1]);
  }
  function blobPath(g, x, y, rx, ry) {        // эллипс без ellipse()
    g.save(); g.translate(x, y); g.scale(1, ry / rx); g.arc(0, 0, rx, 0, TAU); g.restore();
  }

  let bgL = null, floorL = null, overL = null, bandB = null, bandM = null;
  let fogGrad = null;

  function floorTop(x) {
    const u = x / W;
    return H * (GROUND0 - 0.011 + 0.010 * sin(u * 5.3 + 0.7) + 0.005 * sin(u * 12.1 + 2.0) + 0.011 * max(0, sin(u * 3.1 + 4.0)));
  }

  function buildBg() {
    const w = W * (1 + 2 * OV), L = newLayer(w, H), g = L.g, ox = OV * W;
    g.fillStyle = waterGrad(g, H); g.fillRect(0, 0, w, H);

    // сноп света от поверхности
    const rg = g.createRadialGradient(ox + W * 0.36, -H * 0.06, 0, ox + W * 0.36, -H * 0.06, H * 1.0);
    rg.addColorStop(0, 'rgba(160,255,250,0.50)');
    rg.addColorStop(0.35, 'rgba(90,215,230,0.20)');
    rg.addColorStop(1, 'rgba(60,170,200,0)');
    g.globalCompositeOperation = 'lighter'; g.fillStyle = rg; g.fillRect(0, 0, w, H);
    g.globalCompositeOperation = 'source-over';

    // дальний рельеф: холмы и силуэты водорослей
    const rnd = mulberry32(4242);
    const mounds = [[-0.06, 0.34, 0.50], [0.70, 0.40, 0.46], [0.30, 0.34, 0.66], [0.52, 0.22, 0.70]];
    const baseY = H * (GROUND0 + 0.003);
    for (let m = 0; m < mounds.length; m++) {
      const x0 = ox + W * mounds[m][0], wd = W * mounds[m][1], peak = H * (mounds[m][2] - 0.08);
      const n = 8, xs = [], ys = [];
      for (let i = 0; i <= n; i++) {
        const sh = pow(sin(PI * i / n), 0.8);
        xs.push(x0 + wd * i / n);
        ys.push(baseY - (baseY - peak) * sh * (0.78 + 0.32 * rnd()));
      }
      g.beginPath(); g.moveTo(x0, baseY + 40); g.lineTo(xs[0], ys[0]); smoothPath(g, xs, ys, n + 1);
      g.lineTo(x0 + wd, baseY + 40); g.closePath();
      const gr = g.createLinearGradient(0, peak, 0, baseY);
      gr.addColorStop(0, 'rgba(26,112,146,0.55)'); gr.addColorStop(1, 'rgba(8,54,88,0.8)');
      g.fillStyle = gr; g.fill();
      g.beginPath(); g.moveTo(xs[0], ys[0]); smoothPath(g, xs, ys, n + 1);
      g.lineWidth = 3; g.strokeStyle = 'rgba(120,214,230,0.10)'; g.stroke();
    }
    // тонкие силуэты дальних водорослей
    for (let i = 0; i < 9; i++) {
      const bx = ox + W * rr(-0.02, 1.02), hh = H * rr(0.22, 0.46), sw = rr(-26, 26), ww = rr(7, 13);
      g.beginPath(); g.moveTo(bx - ww * 0.5, baseY + 6);
      const steps = 12, lx = [], ly = [], rx = [], ry = [];
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, x = bx + sin(t * 3.0 + i) * sw * t, y = baseY - hh * t, hw = ww * 0.5 * (1 - pow(t, 1.3) * 0.9);
        lx.push(x - hw); ly.push(y); rx.push(x + hw); ry.push(y);
      }
      for (let k = 0; k <= steps; k++) g.lineTo(lx[k], ly[k]);
      for (let k = steps; k >= 0; k--) g.lineTo(rx[k], ry[k]);
      g.closePath(); g.fillStyle = 'rgba(10,88,112,0.30)'; g.fill();
    }
    // дымка у горизонта
    const hz = g.createLinearGradient(0, H * 0.42, 0, H * 0.78);
    hz.addColorStop(0, 'rgba(60,175,205,0)'); hz.addColorStop(0.65, 'rgba(60,175,205,0.20)'); hz.addColorStop(1, 'rgba(60,175,205,0.05)');
    g.fillStyle = hz; g.fillRect(0, H * 0.42, w, H * 0.36);
    bgL = L;
  }

  function buildFloor() {
    const w = W * (1 + 2 * OV), L = newLayer(w, H), g = L.g, ox = OV * W;
    const top = x => floorTop(x - ox);
    const y0 = H * (GROUND0 - 0.027);
    g.beginPath(); g.moveTo(0, H + 2); g.lineTo(0, top(0));
    for (let x = 0; x <= w; x += 10) g.lineTo(x, top(x));
    g.lineTo(w, top(w)); g.lineTo(w, H + 2); g.closePath();
    const gr = g.createLinearGradient(0, y0, 0, H);
    gr.addColorStop(0.00, '#35687e'); gr.addColorStop(0.16, '#58838a'); gr.addColorStop(0.42, '#85987f');
    gr.addColorStop(0.78, '#9a9172'); gr.addColorStop(1.00, '#625d46');
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();

    const rnd = mulberry32(991);
    // волны песка
    for (let j = 0; j < 8; j++) {
      const t = (j + 0.6) / 8, yb = lerp(y0 + H * 0.012, H, t * t * 0.85 + 0.15 * t), amp = 3 + 9 * t;
      const ph = rnd() * 6, fr = 0.0035 * (1 + t * 0.7);
      for (let pass = 0; pass < 2; pass++) {
        g.beginPath();
        for (let x = 0; x <= w; x += 14) {
          const y = yb + (pass ? 3 + 5 * t : 0) + sin(x * fr + ph) * amp + sin(x * fr * 2.6 + ph * 2) * amp * 0.4;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.lineWidth = (pass ? 2.4 : 1.6) + 3 * t;
        g.strokeStyle = pass ? 'rgba(8,40,56,0.13)' : 'rgba(255,248,215,0.12)';
        g.stroke();
      }
    }
    // песчинки
    const grains = floor(w * H * 0.0042);
    for (let i = 0; i < grains; i++) {
      const x = rnd() * w, tp = top(x), y = tp + (H - tp) * pow(rnd(), 0.9);
      const t = clamp((y - y0) / (H - y0), 0, 1), sz = 0.5 + 1.7 * t * (0.5 + rnd());
      const light = rnd() < 0.55;
      g.fillStyle = light ? 'rgba(255,244,205,' + (0.12 + 0.28 * rnd()).toFixed(2) + ')'
                          : 'rgba(30,55,60,' + (0.10 + 0.22 * rnd()).toFixed(2) + ')';
      g.fillRect(x, y, sz, sz * 0.8);
    }
    // камешки
    const pebCols = ['#8d9aa0', '#a3937a', '#c9c1ad', '#6e7f86', '#b08f6a', '#9eb0a8'];
    for (let i = 0; i < 52; i++) {
      const x = rnd() * w, tp = top(x), y = tp + (H - tp) * (0.05 + 0.95 * pow(rnd(), 0.7));
      const t = clamp((y - y0) / (H - y0), 0, 1), r = (1.6 + 6.5 * t) * S * (0.6 + 0.8 * rnd());
      g.fillStyle = 'rgba(5,30,40,0.30)'; g.beginPath(); blobPath(g, x + r * 0.2, y + r * 0.45, r * 1.15, r * 0.42); g.fill();
      g.fillStyle = pebCols[(rnd() * pebCols.length) | 0]; g.beginPath(); blobPath(g, x, y, r, r * 0.68); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); blobPath(g, x - r * 0.25, y - r * 0.25, r * 0.45, r * 0.22); g.fill();
    }
    // дымка на дальнем краю
    const fg = g.createLinearGradient(0, y0 - H * 0.02, 0, y0 + H * 0.115);
    fg.addColorStop(0, 'rgba(22,112,148,0.78)'); fg.addColorStop(1, 'rgba(22,112,148,0)');
    g.fillStyle = fg; g.fillRect(0, y0 - H * 0.02, w, H * 0.14);
    // затемнение передней кромки
    const lip = g.createLinearGradient(0, H * 0.94, 0, H);
    lip.addColorStop(0, 'rgba(0,18,28,0)'); lip.addColorStop(1, 'rgba(0,18,28,0.55)');
    g.fillStyle = lip; g.fillRect(0, H * 0.94, w, H * 0.06);
    g.restore();
    floorL = L;
  }

  function buildOverlay() {
    const L = newLayer(W, H), g = L.g;
    // тонировка глубиной
    let gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(0,20,40,0)'); gr.addColorStop(0.45, 'rgba(2,24,48,0.08)'); gr.addColorStop(1, 'rgba(2,14,32,0.26)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // виньетка
    const rg = g.createRadialGradient(W * 0.5, H * 0.46, min(W, H) * 0.34, W * 0.5, H * 0.5, sqrt(W * W + H * H) * 0.62);
    rg.addColorStop(0, 'rgba(0,10,26,0)'); rg.addColorStop(1, 'rgba(0,8,20,0.66)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
    // блики на стекле
    g.save(); g.translate(W * 0.17, 0); g.transform(1, 0, -0.5, 1, 0, 0);
    let sg = g.createLinearGradient(0, 0, W * 0.10, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.055)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg; g.fillRect(0, 0, W * 0.10, H);
    g.translate(W * 0.13, 0);
    sg = g.createLinearGradient(0, 0, W * 0.035, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.045)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg; g.fillRect(0, 0, W * 0.035, H);
    g.restore();
    // кромка стекла
    g.fillStyle = 'rgba(190,240,255,0.10)';
    g.fillRect(0, 0, W, 1); g.fillRect(0, 0, 1, H); g.fillRect(W - 1, 0, 1, H);
    overL = L;
  }

  /* --------------------------------------------------- спрайты и каустики */
  let spBubble = null, spDot = null, spBlob = null, spBokeh = null, spGrain = null, spRay = [];

  function buildSprites() {
    // пузырь
    let c = document.createElement('canvas'); c.width = c.height = 64;
    let g = c.getContext('2d');
    let rg = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    rg.addColorStop(0, 'rgba(180,230,255,0.04)'); rg.addColorStop(0.70, 'rgba(190,235,255,0.10)');
    rg.addColorStop(0.88, 'rgba(235,252,255,0.62)'); rg.addColorStop(0.97, 'rgba(255,255,255,0.22)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(32, 32, 31, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); blobPath(g, 21, 19, 7, 4.2); g.fill();
    g.fillStyle = 'rgba(210,245,255,0.35)'; g.beginPath(); blobPath(g, 42, 45, 5, 2.6); g.fill();
    spBubble = c;
    // мягкая точка
    c = document.createElement('canvas'); c.width = c.height = 32; g = c.getContext('2d');
    rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.35, 'rgba(255,255,255,0.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
    spDot = c;
    // боке
    c = document.createElement('canvas'); c.width = c.height = 64; g = c.getContext('2d');
    rg = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    rg.addColorStop(0, 'rgba(255,255,255,0.30)'); rg.addColorStop(0.78, 'rgba(255,255,255,0.38)'); rg.addColorStop(0.92, 'rgba(255,255,255,0.80)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(32, 32, 31, 0, TAU); g.fill();
    spBokeh = c;
    // зерно плёнки (заодно гасит бэндинг градиентов)
    c = document.createElement('canvas'); c.width = c.height = 128; g = c.getContext('2d');
    const gi = g.createImageData(128, 128), gd = gi.data;
    for (let i = 0; i < 128 * 128; i++) {
      const v = R() < 0.5 ? 0 : 255;
      gd[i * 4] = v; gd[i * 4 + 1] = v; gd[i * 4 + 2] = v; gd[i * 4 + 3] = (40 + R() * 215) | 0;
    }
    g.putImageData(gi, 0, 0);
    spGrain = ctx.createPattern(c, 'repeat');
    // облако мути
    c = document.createElement('canvas'); c.width = 256; c.height = 128; g = c.getContext('2d');
    rg = g.createRadialGradient(128, 64, 0, 128, 64, 128);
    rg.addColorStop(0, 'rgba(150,226,236,0.55)'); rg.addColorStop(0.5, 'rgba(120,205,220,0.22)'); rg.addColorStop(1, 'rgba(100,190,210,0)');
    g.save(); g.scale(1, 0.5); g.fillStyle = rg; g.fillRect(0, 0, 256, 256); g.restore();
    spBlob = c;
    // лучи света (два варианта с разной «волокнистостью»)
    const rnd = mulberry32(31337);
    for (let v = 0; v < 2; v++) {
      c = document.createElement('canvas'); c.width = 128; c.height = 512; g = c.getContext('2d');
      g.fillStyle = 'rgba(255,255,255,0.30)'; g.fillRect(0, 0, 128, 512);
      for (let i = 0; i < 16; i++) {
        const x = 4 + rnd() * 100, w = 8 + rnd() * 26, a = 0.25 + rnd() * 0.75;
        const gr = g.createLinearGradient(x, 0, x + w, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,' + a.toFixed(2) + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(x, 0, w, 512);
      }
      g.globalCompositeOperation = 'destination-in';
      let gr = g.createLinearGradient(0, 0, 128, 0);
      const hs = [[0, 0], [0.12, 0.06], [0.25, 0.25], [0.38, 0.62], [0.5, 1], [0.62, 0.62], [0.75, 0.25], [0.88, 0.06], [1, 0]];
      for (let i = 0; i < hs.length; i++) gr.addColorStop(hs[i][0], 'rgba(0,0,0,' + hs[i][1] + ')');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 512);
      gr = g.createLinearGradient(0, 0, 0, 512);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.2, 'rgba(0,0,0,0.82)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.34)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 512);
      spRay.push(c);
    }
  }

  // Каустики: сеть ячеек Вороного (F2 - F1), зацикленная по времени, запекается один раз.
  const CT = 160, CF = 28;
  let caustic = null;

  function makeWorley(G, seed) {
    const r = mulberry32(seed), pts = [];
    for (let i = 0; i < G * G; i++) {
      pts.push({ ox: r(), oy: r(), ph: r() * TAU, ph2: r() * TAU, rad: 0.17 + r() * 0.2, k: 1 + ((r() * 2) | 0) });
    }
    return { G, pts, px: new Float32Array(G * G), py: new Float32Array(G * G) };
  }
  function evalWorley(Lr, phase, out, width, power, warp, gain) {
    const G = Lr.G, px = Lr.px, py = Lr.py;
    for (let i = 0; i < G * G; i++) {
      const p = Lr.pts[i], gx = i % G, gy = (i / G) | 0;
      px[i] = gx + p.ox * 0.4 + 0.3 + p.rad * cos(TAU * p.k * phase + p.ph);
      py[i] = gy + p.oy * 0.4 + 0.3 + p.rad * sin(TAU * p.k * phase + p.ph2);
    }
    for (let y = 0; y < CT; y++) {
      const v = y / CT;
      for (let x = 0; x < CT; x++) {
        const u = x / CT;
        const wu = u + warp * sin(TAU * (v * 2 + phase) + 1.0) + warp * 0.6 * sin(TAU * (v * 3 - phase * 2));
        const wv = v + warp * sin(TAU * (u * 2 - phase) + 2.0) + warp * 0.6 * sin(TAU * (u * 3 + phase * 2));
        const gx = wu * G, gy = wv * G, cx = floor(gx), cy = floor(gy);
        let f1 = 9, f2 = 9;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const ix = cx + i, iy = cy + j;
            const wx = ((ix % G) + G) % G, wy = ((iy % G) + G) % G, k = wy * G + wx;
            const dx = px[k] - wx + ix - gx, dy = py[k] - wy + iy - gy;
            const d = sqrt(dx * dx + dy * dy);
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
          }
        }
        let e = (f2 - f1) / width; if (e > 1) e = 1;
        out[y * CT + x] += pow(1 - e, power) * gain;
      }
    }
  }
  function bakeCaustics() {
    const A = makeWorley(5, 11), B = makeWorley(7, 23), frames = [];
    const acc = new Float32Array(CT * CT);
    for (let f = 0; f < CF; f++) {
      const ph = f / CF;
      acc.fill(0);
      evalWorley(A, ph, acc, 0.30, 3.0, 0.035, 0.95);
      evalWorley(B, ph, acc, 0.30, 3.0, 0.035, 0.65);
      const c = document.createElement('canvas'); c.width = c.height = CT;
      const g = c.getContext('2d'), img = g.createImageData(CT, CT), d = img.data;
      for (let i = 0; i < CT * CT; i++) {
        const v = acc[i] > 1 ? 1 : acc[i];
        d[i * 4] = 205; d[i * 4 + 1] = 246; d[i * 4 + 2] = 255; d[i * 4 + 3] = (v * 255) | 0;
      }
      g.putImageData(img, 0, 0);
      frames.push({ c, pat: ctx.createPattern(c, 'repeat') });
    }
    caustic = frames;
  }
  // слой каустик: два соседних кадра смешиваются, рисуем аддитивно
  function causticFill(g, ph, tileW, squash, ox, oy, X0, Y0, X1, Y1, alpha) {
    if (!caustic || alpha < 0.004) return;
    ph = ph - floor(ph);
    const f = ph * CF, i0 = floor(f) % CF, i1 = (i0 + 1) % CF, fr = f - floor(f);
    const sx = tileW / CT, sy = sx * squash;
    const u0 = (X0 - ox) / sx, v0 = (Y0 - oy) / sy, u1 = (X1 - ox) / sx, v1 = (Y1 - oy) / sy;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.translate(ox, oy); g.scale(sx, sy);
    g.globalAlpha = alpha * (1 - fr); g.fillStyle = caustic[i0].pat; g.fillRect(u0, v0, u1 - u0, v1 - v0);
    g.globalAlpha = alpha * fr; g.fillStyle = caustic[i1].pat; g.fillRect(u0, v0, u1 - u0, v1 - v0);
    g.restore();
  }

  /* ---------------------------------------------------------- виды рыб */
  const M = 24;                      // точек вдоль позвоночника
  const SX = new Float32Array(M), SY = new Float32Array(M);
  const UX = new Float32Array(M), UY = new Float32Array(M);
  const TXa = new Float32Array(M), TYa = new Float32Array(M);
  const HTa = new Float32Array(M), HBa = new Float32Array(M);
  const TPX = new Float32Array(M), TPY = new Float32Array(M), BPX = new Float32Array(M), BPY = new Float32Array(M);
  const PX = new Float32Array(64), PY = new Float32Array(64), BXs = new Float32Array(64), BYs = new Float32Array(64);
  let EX = 0, EY = 0, EUX = 0, EUY = 0, ETX = 0, ETY = 0, EHT = 0, EHB = 0;

  const SPECIES = [
    { id: 'tetra', len: 36, hTop: 0.115, hBot: 0.105, peak: 0.38, nose: 0.55, tail: 1.1, tw: 0.17,
      wave: 1.0, amp: 0.092, freq: 5.2, cruise: 4.2, turn: 2.6, wander: 0.8,
      vars: [{ body: [[0, '#274a74'], [0.42, '#6a8db6'], [0.7, '#c2d4e6'], [1, '#f1f6f9']],
               fin: 'rgba(215,235,250,0.42)', ray: 'rgba(255,255,255,0.22)', pal: ['#27d8ff', '#ef2f2c', '#8fe9ff'] }],
      bands: [{ s0: 0.10, s1: 0.84, f0: -0.66, f1: 0.20, col: 2, a: 0.20, add: 1 },
              { s0: 0.10, s1: 0.84, f0: -0.42, f1: 0.00, col: 0, a: 0.95, add: 1, shim: 1 },
              { s0: 0.50, s1: 0.99, f0: 0.04, f1: 1.00, col: 1, a: 0.95 }],
      dorsal: { s0: 0.40, s1: 0.58, h: 0.11, pk: 0.45, sw: 0.6 },
      anal: { s0: 0.52, s1: 0.80, h: 0.09, pk: 0.40, sw: 0.5 },
      caudal: { len: 0.22, spread: 1.05, fork: 0.30, round: 0, swing: 0.35, lag: 0.8, flow: 0, pts: 6 },
      pect: { s: 0.26, f: 0.35, len: 0.14, rot: -0.4, amp: 0.5, sp: 9 },
      eye: { s: 0.10, f: -0.2, r: 0.042, iris: '#cfe8ff' } },

    { id: 'danio', len: 40, hTop: 0.080, hBot: 0.074, peak: 0.40, nose: 0.60, tail: 1.0, tw: 0.15,
      wave: 1.0, amp: 0.085, freq: 5.6, cruise: 4.8, turn: 2.8, wander: 0.9,
      vars: [{ body: [[0, '#566a74'], [0.4, '#a9bcc4'], [0.75, '#e6e0cc'], [1, '#f7efd8']],
               fin: 'rgba(225,235,235,0.40)', ray: 'rgba(255,255,255,0.22)', pal: ['#243f78', '#e9b94a'] }],
      bands: [{ s0: 0.12, s1: 0.99, f0: -0.40, f1: -0.14, col: 1, a: 0.55 },
              { s0: 0.12, s1: 0.99, f0: 0.14, f1: 0.40, col: 1, a: 0.55 },
              { s0: 0.12, s1: 0.99, f0: -0.70, f1: -0.42, col: 0, a: 0.88 },
              { s0: 0.12, s1: 0.99, f0: -0.14, f1: 0.14, col: 0, a: 0.88 },
              { s0: 0.12, s1: 0.99, f0: 0.40, f1: 0.70, col: 0, a: 0.88 }],
      dorsal: { s0: 0.45, s1: 0.62, h: 0.09, pk: 0.5, sw: 0.5 },
      anal: { s0: 0.50, s1: 0.85, h: 0.10, pk: 0.35, sw: 0.4 },
      caudal: { len: 0.24, spread: 1.0, fork: 0.28, round: 0, swing: 0.35, lag: 0.8, flow: 0, pts: 6 },
      pect: { s: 0.25, f: 0.35, len: 0.13, rot: -0.4, amp: 0.5, sp: 9 },
      eye: { s: 0.10, f: -0.15, r: 0.036, iris: '#e8c870' } },

    { id: 'angel', len: 100, hTop: 0.30, hBot: 0.27, peak: 0.45, nose: 1.35, tail: 1.0, tw: 0.075,
      wave: 0.8, amp: 0.034, freq: 1.7, cruise: 1.1, turn: 1.7, wander: 0.55,
      vars: [{ body: [[0, '#56697a'], [0.35, '#a3b8c4'], [0.7, '#d6e3e9'], [1, '#f0f6f8']],
               fin: 'rgba(200,220,230,0.40)', ray: 'rgba(255,255,255,0.32)', edge: 'rgba(225,240,248,0.55)', line: 'rgba(8,28,44,0.62)', fil: 'rgba(240,248,252,0.85)', pal: ['#10151b', '#e5622a'] },
             { body: [[0, '#b06a14'], [0.4, '#efb443'], [0.75, '#ffdf86'], [1, '#fff2c0']],
               fin: 'rgba(255,224,140,0.42)', ray: 'rgba(255,250,220,0.38)', edge: 'rgba(255,238,185,0.60)', line: 'rgba(70,35,0,0.58)', fil: 'rgba(255,240,190,0.9)', pal: ['#5a3008', '#e5622a'] }],
      bands: [{ s0: 0.10, s1: 0.20, f0: -1, f1: 1, col: 0, a: 0.92 },
              { s0: 0.37, s1: 0.50, f0: -1, f1: 1, col: 0, a: 0.88 },
              { s0: 0.66, s1: 0.76, f0: -1, f1: 1, col: 0, a: 0.80 }],
      dorsal: { s0: 0.22, s1: 0.80, h: 0.44, pk: 0.74, sw: 0.9, flut: 0.05 },
      anal: { s0: 0.30, s1: 0.80, h: 0.40, pk: 0.72, sw: 0.9, flut: 0.05 },
      caudal: { len: 0.36, spread: 0.95, fork: 0.12, round: 0.30, swing: 0.30, lag: 1.0, flow: 1, pts: 8 },
      pect: { s: 0.25, f: 0.30, len: 0.20, rot: -0.5, amp: 0.35, sp: 4 },
      pelvic: [{ s: 0.30, f: 0.9, len: 0.62, ang: -0.35 }, { s: 0.33, f: 0.9, len: 0.52, ang: -0.5 }],
      eye: { s: 0.115, f: -0.12, r: 0.034, iris: '#e8742c' } },

    { id: 'clown', len: 66, hTop: 0.19, hBot: 0.18, peak: 0.42, nose: 0.60, tail: 0.9, tw: 0.22,
      wave: 0.9, amp: 0.075, freq: 3.1, cruise: 0.95, turn: 2.4, wander: 0.9,
      vars: [{ body: [[0, '#d9480f'], [0.5, '#ff8120'], [1, '#ffb050']],
               fin: 'rgba(255,128,30,0.96)', ray: 'rgba(120,40,0,0.28)', edge: '#16100a', line: 'rgba(40,10,0,0.45)', pal: ['#16100a', '#fffaf0'] }],
      bands: [{ s0: 0.150, s1: 0.290, f0: -1, f1: 1, col: 0, a: 1 }, { s0: 0.168, s1: 0.272, f0: -1, f1: 1, col: 1, a: 0.98 },
              { s0: 0.445, s1: 0.590, f0: -1, f1: 1, col: 0, a: 1 }, { s0: 0.462, s1: 0.572, f0: -1, f1: 1, col: 1, a: 0.98 },
              { s0: 0.825, s1: 0.930, f0: -1, f1: 1, col: 0, a: 1 }, { s0: 0.842, s1: 0.912, f0: -1, f1: 1, col: 1, a: 0.98 }],
      dorsal: { s0: 0.20, s1: 0.80, h: 0.115, pk: 0.45, sw: 0.25 },
      anal: { s0: 0.55, s1: 0.78, h: 0.10, pk: 0.5, sw: 0.2 },
      caudal: { len: 0.24, spread: 1.2, fork: 0, round: 0.5, swing: 0.3, lag: 0.8, flow: 0, pts: 7 },
      pect: { s: 0.27, f: 0.30, len: 0.19, rot: -0.3, amp: 0.6, sp: 6 },
      eye: { s: 0.095, f: -0.15, r: 0.046, iris: '#ffd27a' } },

    { id: 'tang', len: 118, hTop: 0.27, hBot: 0.26, peak: 0.42, nose: 0.85, tail: 1.1, tw: 0.085,
      wave: 0.9, amp: 0.062, freq: 2.2, cruise: 1.2, turn: 1.9, wander: 0.7,
      vars: [{ body: [[0, '#07217a'], [0.5, '#145dd8'], [1, '#3a8ff0']],
               fin: 'rgba(20,95,215,0.92)', tail: 'rgba(255,214,26,0.95)', ray: 'rgba(160,210,255,0.28)', edge: '#0a1a5a', line: 'rgba(0,10,50,0.4)',
               pal: ['#0a1236', '#ffd21a', '#9fd3ff'] }],
      bands: [{ s0: 0.20, s1: 0.92, f0: -0.74, f1: 0.14, tp: 0.55, col: 0, a: 0.93 },
              { s0: 0.30, s1: 0.84, f0: 0.16, f1: 0.26, tp: 0.6, col: 2, a: 0.40 },
              { s0: 0.80, s1: 0.87, f0: -0.05, f1: 0.34, tp: 0.5, col: 1, a: 1 }],
      dorsal: { s0: 0.16, s1: 0.90, h: 0.17, pk: 0.72, sw: 0.5 },
      anal: { s0: 0.34, s1: 0.88, h: 0.14, pk: 0.70, sw: 0.4 },
      caudal: { len: 0.32, spread: 1.55, fork: 0.48, round: 0, swing: 0.35, lag: 0.9, flow: 0, pts: 8 },
      pect: { s: 0.27, f: 0.25, len: 0.26, rot: -0.3, amp: 0.55, sp: 5 },
      eye: { s: 0.105, f: -0.08, r: 0.038, iris: '#ffe04a' } },

    { id: 'betta', len: 70, hTop: 0.092, hBot: 0.088, peak: 0.40, nose: 0.60, tail: 1.0, tw: 0.15,
      wave: 0.9, amp: 0.072, freq: 2.3, cruise: 0.8, turn: 1.8, wander: 0.8,
      vars: [{ body: [[0, '#4d0716'], [0.5, '#b50f2c'], [1, '#e8334f']],
               fin: 'rgba(222,24,56,0.72)', ray: 'rgba(255,170,185,0.45)', fil: 'rgba(240,60,90,0.85)', pal: ['#ff8aa0', '#4d0716'] },
             { body: [[0, '#071a52'], [0.5, '#1e49c4'], [1, '#4a86f0']],
               fin: 'rgba(40,90,225,0.70)', ray: 'rgba(170,205,255,0.45)', fil: 'rgba(80,140,250,0.85)', pal: ['#9ec8ff', '#071a52'] }],
      bands: [{ s0: 0.20, s1: 0.90, f0: -0.45, f1: 0.05, col: 0, a: 0.20, add: 1, shim: 1 }],
      dorsal: { s0: 0.38, s1: 0.76, h: 0.20, pk: 0.60, sw: 1.0, flut: 0.14 },
      anal: { s0: 0.28, s1: 0.80, h: 0.26, pk: 0.62, sw: 1.3, flut: 0.14 },
      caudal: { len: 0.70, spread: 1.55, fork: 0.10, round: 0.42, swing: 0.45, lag: 1.1, flow: 1, pts: 10 },
      pect: { s: 0.24, f: 0.30, len: 0.20, rot: -0.4, amp: 0.5, sp: 5 },
      pelvic: [{ s: 0.28, f: 0.85, len: 0.55, ang: -0.45 }, { s: 0.31, f: 0.85, len: 0.46, ang: -0.6 }],
      eye: { s: 0.10, f: -0.12, r: 0.040, iris: '#caa24a' } },

    { id: 'cory', len: 52, hTop: 0.215, hBot: 0.095, peak: 0.36, nose: 0.7, tail: 1.5, tw: 0.13,
      wave: 0.9, amp: 0.05, freq: 3.0, cruise: 0.7, turn: 2.6, wander: 0.5, bottom: true,
      vars: [{ body: [[0, '#5c4b38'], [0.45, '#b79f76'], [1, '#ecdfc2']],
               fin: 'rgba(190,170,130,0.62)', ray: 'rgba(255,240,200,0.25)', pal: ['#2b2620', '#7a6a50'] }],
      bands: [{ s0: 0.06, s1: 0.30, f0: -1, f1: 0.2, col: 0, a: 0.60 },
              { s0: 0.42, s1: 0.50, f0: -0.80, f1: -0.30, col: 1, a: 0.70 },
              { s0: 0.57, s1: 0.65, f0: -0.75, f1: -0.25, col: 1, a: 0.70 },
              { s0: 0.72, s1: 0.80, f0: -0.60, f1: -0.15, col: 1, a: 0.70 }],
      dorsal: { s0: 0.30, s1: 0.50, h: 0.18, pk: 0.35, sw: 0.7 },
      anal: { s0: 0.55, s1: 0.70, h: 0.08, pk: 0.5, sw: 0.4 },
      caudal: { len: 0.22, spread: 1.0, fork: 0.30, round: 0, swing: 0.35, lag: 0.8, flow: 0, pts: 6 },
      pect: { s: 0.24, f: 0.50, len: 0.22, rot: -0.5, amp: 0.5, sp: 3 },
      eye: { s: 0.10, f: -0.30, r: 0.040, iris: '#cdb87a' } }
  ];

  function profileAt(s, p, nose, tail, tw) {
    if (s <= 0) return 0;
    if (s < p) return pow(sin((s / p) * PI / 2), nose);
    const u = (s - p) / (1 - p);
    return tw + (1 - tw) * pow(cos(u * PI / 2), tail);
  }
  function prepSpecies() {
    for (let q = 0; q < SPECIES.length; q++) {
      const sp = SPECIES[q];
      sp.pt = new Float32Array(M); sp.pb = new Float32Array(M);
      for (let i = 0; i < M; i++) {
        const s = i / (M - 1), pr = profileAt(s, sp.peak, sp.nose, sp.tail, sp.tw);
        sp.pt[i] = pr * sp.hTop * 100; sp.pb[i] = pr * sp.hBot * 100;
      }
      sp.hm = max(sp.hTop, sp.hBot) * 100;
      for (let v = 0; v < sp.vars.length; v++) {
        const vr = sp.vars[v];
        const gr = ctx.createLinearGradient(0, -sp.hTop * 100, 0, sp.hBot * 100);
        for (let i = 0; i < vr.body.length; i++) gr.addColorStop(vr.body[i][0], vr.body[i][1]);
        vr.grad = gr;
      }
    }
  }

  function computeSpine(sp, amp, phase, bend) {
    const ds = 100 / (M - 1), k = sp.wave * TAU;
    let x = 0, py = 0;
    for (let i = 0; i < M; i++) {
      const s = i / (M - 1), env = 0.07 + 0.93 * s * s;
      const yy = amp * 100 * env * sin(k * s - phase) + bend * 100 * s * s * 0.55;
      if (i > 0) {
        const dy = yy - py;
        x -= sqrt(max(ds * ds - dy * dy, ds * ds * 0.2));
      }
      py = yy; SX[i] = x; SY[i] = yy;
    }
    const cx = SX[7], cy = SY[7];
    for (let i = 0; i < M; i++) { SX[i] -= cx; SY[i] -= cy; }
    for (let i = 0; i < M; i++) {
      const a = i > 0 ? i - 1 : 0, b = i < M - 1 ? i + 1 : M - 1;
      let tx = SX[b] - SX[a], ty = SY[b] - SY[a];
      const l = sqrt(tx * tx + ty * ty) || 1; tx /= l; ty /= l;
      TXa[i] = tx; TYa[i] = ty; UX[i] = -ty; UY[i] = tx;
      HTa[i] = sp.pt[i]; HBa[i] = sp.pb[i];
      TPX[i] = SX[i] + UX[i] * HTa[i]; TPY[i] = SY[i] + UY[i] * HTa[i];
      BPX[i] = SX[i] - UX[i] * HBa[i]; BPY[i] = SY[i] - UY[i] * HBa[i];
    }
  }
  function edgeAt(si, f) {
    let i0 = si | 0; if (i0 > M - 2) i0 = M - 2; if (i0 < 0) i0 = 0;
    const t = si - i0, i1 = i0 + 1;
    const x = SX[i0] + (SX[i1] - SX[i0]) * t, y = SY[i0] + (SY[i1] - SY[i0]) * t;
    EUX = UX[i0] + (UX[i1] - UX[i0]) * t; EUY = UY[i0] + (UY[i1] - UY[i0]) * t;
    ETX = TXa[i0] + (TXa[i1] - TXa[i0]) * t; ETY = TYa[i0] + (TYa[i1] - TYa[i0]) * t;
    EHT = HTa[i0] + (HTa[i1] - HTa[i0]) * t; EHB = HBa[i0] + (HBa[i1] - HBa[i0]) * t;
    const h = f < 0 ? -f * EHT : -f * EHB;
    EX = x + EUX * h; EY = y + EUY * h;
  }
  function bodyPath(g) {
    g.beginPath(); g.moveTo(TPX[0], TPY[0]);
    smoothPath(g, TPX, TPY, M);
    g.lineTo(BPX[M - 1], BPY[M - 1]);
    for (let i = M - 2; i >= 1; i--) {
      g.quadraticCurveTo(BPX[i], BPY[i], (BPX[i] + BPX[i - 1]) / 2, (BPY[i] + BPY[i - 1]) / 2);
    }
    g.lineTo(BPX[0], BPY[0]); g.closePath();
  }

  function drawFin(g, fin, dir, v, f, lod) {
    const a = fin.s0 * (M - 1), b = fin.s1 * (M - 1);
    const n = max(4, min(40, ceil((b - a) * 1.2)));
    const ph = f.phase * 0.5 + f.finPh, side = dir > 0 ? -1 : 1;
    const fl = fin.flut === undefined ? 0.07 : fin.flut;
    for (let j = 0; j <= n; j++) {
      const u = j / n;
      edgeAt(a + (b - a) * u, side);
      const prof = u < fin.pk ? pow(u / fin.pk, 0.75) : pow((1 - u) / (1 - fin.pk), 1.25);
      const h = fin.h * 100 * prof * (1 + fl * sin(ph * 2.2 - u * 5.0));
      BXs[j] = EX; BYs[j] = EY;
      const lean = fin.sw * h * 0.5 + sin(ph * 2 - u * 3) * fin.h * 4 * prof;
      PX[j] = EX + EUX * dir * h + ETX * lean;
      PY[j] = EY + EUY * dir * h + ETY * lean;
    }
    g.beginPath(); g.moveTo(PX[0], PY[0]); smoothPath(g, PX, PY, n + 1); g.closePath();
    g.fillStyle = v.fin; g.fill();
    if (lod >= 1) { g.lineWidth = 0.8; g.strokeStyle = v.edge || 'rgba(255,255,255,0.20)'; g.stroke(); }
    if (lod >= 2) {
      g.beginPath();
      for (let j = 1; j < n; j++) { g.moveTo(BXs[j], BYs[j]); g.lineTo(PX[j], PY[j]); }
      g.lineWidth = 0.5; g.strokeStyle = v.ray; g.stroke();
    }
  }
  function drawCaudal(g, sp, v, f, lod) {
    const c = sp.caudal, E = M - 1;
    const ex = SX[E], ey = SY[E], tau = atan2(TYa[E], TXa[E]);
    const len = c.len * 100, J = c.pts;
    const ph = f.phase - c.lag, swing = c.swing * sin(ph) * (0.5 + 0.5 * min(f.sr, 1.3));
    const hb = HTa[E] * 0.85, hl = HBa[E] * 0.85;
    for (let j = 0; j <= J; j++) {
      const u = 1 - 2 * j / J, au = abs(u);
      let a = tau + u * c.spread * 0.5 + swing + c.flow * 0.10 * sin(ph - j * 0.7);
      const r = len * (1 - c.round * pow(au, 2.4) - c.fork * (1 - pow(au, 1.4))) * (1 + c.flow * 0.07 * sin(ph * 1.3 - j * 0.9));
      PX[j] = ex + cos(a) * r; PY[j] = ey + sin(a) * r;
    }
    g.beginPath(); g.moveTo(ex + UX[E] * hb, ey + UY[E] * hb);
    g.lineTo(PX[0], PY[0]); smoothPath(g, PX, PY, J + 1);
    g.lineTo(ex - UX[E] * hl, ey - UY[E] * hl); g.closePath();
    g.fillStyle = v.tail || v.fin; g.fill();
    if (lod >= 1) { g.lineWidth = 0.8; g.strokeStyle = v.edge || 'rgba(255,255,255,0.20)'; g.stroke(); }
    if (lod >= 2) {
      g.beginPath();
      for (let j = 0; j <= J; j++) { g.moveTo(ex, ey); g.lineTo(ex + (PX[j] - ex) * 0.96, ey + (PY[j] - ey) * 0.96); }
      g.lineWidth = 0.5; g.strokeStyle = v.ray; g.stroke();
    }
  }
  function drawFilament(g, fl, v, f) {
    edgeAt(fl.s * (M - 1), fl.f);
    let x = EX, y = EY, a = atan2(ETY, ETX) + fl.ang;
    const seg = fl.len * 100 / 6;
    g.beginPath(); g.moveTo(x, y);
    for (let i = 1; i <= 6; i++) {
      a += sin(f.phase * 0.6 + f.finPh - i * 0.8) * 0.16 + 0.04;
      x += cos(a) * seg; y += sin(a) * seg; g.lineTo(x, y);
    }
    g.lineWidth = 1.5; g.lineCap = 'round'; g.strokeStyle = v.fil || 'rgba(235,245,250,0.7)'; g.stroke();
  }
  function drawPect(g, sp, v, f, lod) {
    const p = sp.pect;
    edgeAt(p.s * (M - 1), p.f);
    const bx = EX, by = EY, tau = atan2(ETY, ETX);
    const ang = tau + p.rot + sin(T * p.sp + f.finPh) * p.amp * (0.5 + 0.5 * min(f.sr, 1.2));
    const len = p.len * 100;
    const tx = bx + cos(ang) * len, ty = by + sin(ang) * len;
    g.beginPath(); g.moveTo(bx, by);
    g.quadraticCurveTo(bx + cos(ang - 0.55) * len * 0.72, by + sin(ang - 0.55) * len * 0.72, tx, ty);
    g.quadraticCurveTo(bx + cos(ang + 0.55) * len * 0.64, by + sin(ang + 0.55) * len * 0.64, bx, by);
    g.fillStyle = v.fin; g.fill();
    if (lod >= 2) { g.lineWidth = 0.5; g.strokeStyle = v.ray; g.stroke(); }
  }
  function drawBand(g, b, v, f) {
    const n = max(2, ceil((b.s1 - b.s0) * (M - 1))), tp = b.tp;
    const c = (b.f0 + b.f1) * 0.5, hf = (b.f1 - b.f0) * 0.5;
    g.beginPath();
    for (let j = 0; j <= n; j++) {
      const u = j / n, h = tp ? hf * pow(sin(PI * u), tp) : hf;
      edgeAt((b.s0 + (b.s1 - b.s0) * u) * (M - 1), tp ? c - h : b.f0);
      if (j === 0) g.moveTo(EX, EY); else g.lineTo(EX, EY);
    }
    for (let j = n; j >= 0; j--) {
      const u = j / n, h = tp ? hf * pow(sin(PI * u), tp) : hf;
      edgeAt((b.s0 + (b.s1 - b.s0) * u) * (M - 1), tp ? c + h : b.f1);
      g.lineTo(EX, EY);
    }
    g.closePath();
    g.fillStyle = v.pal[b.col];
    g.globalAlpha = b.a * (b.shim ? f.shimmer : 1);
    if (b.add) g.globalCompositeOperation = 'lighter';
    g.fill();
    g.globalAlpha = 1;
    if (b.add) g.globalCompositeOperation = 'source-over';
  }
  function strokeAlong(g, s0, s1, fr) {
    const n = max(3, ceil((s1 - s0) * (M - 1)));
    g.beginPath();
    for (let j = 0; j <= n; j++) {
      edgeAt((s0 + (s1 - s0) * j / n) * (M - 1), fr);
      if (j === 0) g.moveTo(EX, EY); else g.lineTo(EX, EY);
    }
  }

  function drawFish(g, f) {
    const sp = f.sp, v = sp.vars[f.vi], z = f.z, zs = zScale(z);
    const size = sp.len * S * FISH_K * f.sizeVar * zs;
    if (size < 5) return;
    const k = size / 100;
    const lod = size > 44 ? 2 : (size > 24 ? 1 : 0);
    const amp = sp.amp * (0.28 + 0.72 * min(f.sr, 1.4)) * (1 + f.turnAmp * 0.6);
    computeSpine(sp, amp, f.phase, f.bend + f.bite * 0.12);

    const ang = f.sgn > 0 ? f.pitch : -f.pitch;
    const ca = cos(ang), sa = sin(ang);
    const sx = f.sgn * (0.22 + 0.78 * abs(f.face));
    const px = f.x + cam * pf(z), py = f.y + sin(T * 0.8 + f.phase0) * size * 0.012;
    g.setTransform(K * ca * sx * k, K * sa * sx * k, -K * sa * k, K * ca * k, K * px, K * py);
    g.lineJoin = 'round'; g.lineCap = 'round';

    drawCaudal(g, sp, v, f, lod);
    drawFin(g, sp.dorsal, 1, v, f, lod);
    drawFin(g, sp.anal, -1, v, f, lod);
    if (sp.pelvic && lod >= 1) for (let i = 0; i < sp.pelvic.length; i++) drawFilament(g, sp.pelvic[i], v, f);

    bodyPath(g); g.fillStyle = v.grad; g.fill();
    for (let i = 0; i < sp.bands.length; i++) drawBand(g, sp.bands[i], v, f);

    if (lod >= 1) {
      const hm = sp.hm;
      strokeAlong(g, 0.16, 0.82, -0.52); g.lineWidth = hm * 0.26; g.strokeStyle = 'rgba(255,255,255,0.13)'; g.stroke();
      strokeAlong(g, 0.20, 0.86, 0.74); g.lineWidth = hm * 0.30; g.strokeStyle = 'rgba(0,20,50,0.14)'; g.stroke();
      const gl = 0.5 + 0.5 * sin(T * 0.7 + f.phase0);
      if (lod >= 2) { strokeAlong(g, 0.14 + gl * 0.5, 0.30 + gl * 0.5, -0.40); g.lineWidth = hm * 0.13; g.strokeStyle = 'rgba(255,255,255,0.20)'; g.stroke(); }
      strokeAlong(g, 0.08, 0.92, -1); g.lineWidth = 0.9; g.strokeStyle = 'rgba(255,255,255,0.30)'; g.stroke();
      bodyPath(g); g.lineWidth = clamp(0.8 / k, 0.9, 2.2); g.strokeStyle = v.line || 'rgba(0,18,34,0.34)'; g.stroke();
    }
    if (lod >= 2) {    // жаберная крышка и рот
      edgeAt(0.22 * (M - 1), -0.85); const gx0 = EX, gy0 = EY;
      edgeAt(0.20 * (M - 1), 0.0); const gcx = EX, gcy = EY;
      edgeAt(0.22 * (M - 1), 0.8);
      g.beginPath(); g.moveTo(gx0, gy0); g.quadraticCurveTo(gcx - 3, gcy, EX, EY);
      g.lineWidth = 1.0; g.strokeStyle = 'rgba(0,20,40,0.28)'; g.stroke();
      edgeAt(0.075 * (M - 1), 0.28); const mx = EX, my = EY;
      g.beginPath(); g.moveTo(TPX[0] + 0.3, SY[0] + 1.5); g.lineTo(mx, my);
      g.lineWidth = 0.9; g.strokeStyle = 'rgba(30,10,10,0.5)'; g.stroke();
    }
    drawPect(g, sp, v, f, lod);

    // глаз
    const e = sp.eye, er = e.r * 100;
    edgeAt(e.s * (M - 1), e.f);
    const ex = EX, ey = EY;
    if (lod === 0) {
      g.fillStyle = '#0a0f18'; g.beginPath(); g.arc(ex, ey, er * 1.1, 0, TAU); g.fill();
    } else {
      g.fillStyle = 'rgba(0,10,20,0.5)'; g.beginPath(); g.arc(ex, ey, er * 1.2, 0, TAU); g.fill();
      g.fillStyle = e.iris; g.beginPath(); g.arc(ex, ey, er, 0, TAU); g.fill();
      g.fillStyle = '#05080e'; g.beginPath(); g.arc(ex + er * 0.06, ey, er * 0.58, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(ex + er * 0.26, ey - er * 0.30, er * 0.22, 0, TAU); g.fill();
    }
    g.setTransform(K, 0, 0, K, 0, 0);
  }

  /* ---------------------------------------------------------- растения, камни */
  const decor = [];
  let airstone = null, anemone = null;

  const PLANT_STYLES = {
    kelp:  { base: '#1d4a2c', mid: '#4f8a3a', tip: '#b4d36a', hi: 'rgba(235,255,190,0.20)' },
    vall:  { base: '#14432e', mid: '#2e9a55', tip: '#9be28a', hi: 'rgba(220,255,210,0.22)' },
    sword: { base: '#103a28', mid: '#238a4e', tip: '#6fd08a', hi: 'rgba(210,255,215,0.22)', rib: 'rgba(5,40,25,0.30)' },
    red:   { base: '#3d0e1c', mid: '#a3283c', tip: '#ee7084', hi: 'rgba(255,200,205,0.22)', rib: 'rgba(60,5,20,0.30)' }
  };

  function addPlant(kind, nx, z, n, hh, spread, o) {
    const rnd = mulberry32(((nx * 1000) | 0) * 31 + ((z * 100) | 0));
    const sty = PLANT_STYLES[o.style];
    const blades = [];
    for (let i = 0; i < n; i++) {
      blades.push({
        dx: (rnd() - 0.5) * spread, len: lerp(0.62, 1.0, rnd()), a0: (rnd() - 0.5) * o.lean,
        w: o.w * (0.78 + 0.5 * rnd()), amp: o.amp * (0.7 + 0.6 * rnd()), w1: 0.7 + rnd() * 0.9, k1: 1.6 + rnd() * 1.5,
        ph: rnd() * TAU, segs: o.segs, grad: null, leaf: !!o.leaf
      });
    }
    decor.push({ kind: 'plant', nx, z, hh, blades, sty, cur: o.cur, spread, tall: o.style === 'kelp' });
  }

  function addCoral(nx, z, hh, seed, cols, o) {
    o = o || {};
    const rnd = mulberry32(seed), segs = [], maxD = o.maxD || 4, spread = o.spread || 0.5, decay = o.decay || 0.7;
    let maxH = 0.001;
    (function br(x, y, ang, len, d) {
      const x1 = x + sin(ang) * len, y1 = y - cos(ang) * len;
      segs.push([x, y, x1, y1, d]);
      if (-y1 > maxH) maxH = -y1;
      if (d >= maxD) return;
      const n = d < 2 ? 2 : (rnd() < (o.fan ? 0.85 : 0.55) ? 2 : 1);
      for (let i = 0; i < n; i++) {
        const da = n === 1 ? (rnd() - 0.5) * 0.5 : (i ? 1 : -1) * spread * (0.6 + rnd() * 0.8);
        br(x1, y1, clamp(ang + da + (rnd() - 0.5) * 0.18, -1.35, 1.35), len * (decay + rnd() * 0.1), d + 1);
      }
    })(0, 0, (rnd() - 0.5) * 0.3, 1, 0);
    let tips = null;
    if (o.fan) {                         // концы ветвей по углу — контур «ткани» веера
      tips = [];
      for (let i = 0; i < segs.length; i++) if (segs[i][4] === maxD) tips.push([segs[i][2], segs[i][3]]);
      tips.sort((p, q) => atan2(p[0], -p[1]) - atan2(q[0], -q[1]));
    }
    decor.push({ kind: 'coral', nx, z, hh, segs, maxH, cols, maxD, w: o.w || 0.15, taper: o.taper || 0.72, fan: !!o.fan, tips, ph: rnd() * TAU });
  }

  function layoutDecor() {
    decor.length = 0;
    // задний план
    [[0.10, 0.12], [0.27, 0.22], [0.66, 0.15], [0.84, 0.26], [0.50, 0.07]].forEach(a =>
      addPlant('kelp', a[0], a[1], 7, 0.55, 46, { style: 'kelp', w: 15, lean: 0.35, amp: 0.34, cur: 0.55, segs: 14 }));
    // средний план
    [[0.04, 0.46], [0.20, 0.52], [0.45, 0.44], [0.74, 0.50], [0.95, 0.55]].forEach(a =>
      addPlant('vall', a[0], a[1], 9, 0.30, 52, { style: 'vall', w: 9, lean: 0.5, amp: 0.30, cur: 0.5, segs: 11 }));
    addPlant('sword', 0.36, 0.58, 6, 0.20, 40, { style: 'sword', w: 21, lean: 1.1, amp: 0.12, cur: 0.25, segs: 9, leaf: true });
    addPlant('sword', 0.89, 0.40, 6, 0.22, 44, { style: 'red', w: 21, lean: 1.1, amp: 0.12, cur: 0.25, segs: 9, leaf: true });
    // передний план
    addPlant('sword', 0.05, 0.90, 7, 0.26, 56, { style: 'sword', w: 24, lean: 1.2, amp: 0.10, cur: 0.25, segs: 9, leaf: true });
    addPlant('vall', 0.93, 0.88, 10, 0.34, 60, { style: 'vall', w: 10, lean: 0.5, amp: 0.30, cur: 0.5, segs: 11 });
    addPlant('sword', 0.45, 0.93, 5, 0.17, 40, { style: 'red', w: 22, lean: 1.2, amp: 0.10, cur: 0.25, segs: 9, leaf: true });
    // кораллы и горгонария
    addCoral(0.26, 0.62, 0.17, 71, ['#a8366f', '#f08fbf', '#ffd5e8']);
    addCoral(0.73, 0.27, 0.13, 72, ['#c25a1c', '#ffa860', '#ffe0b0']);
    addCoral(0.53, 0.76, 0.10, 73, ['#1f8f86', '#7fe0c6', '#d6fff2']);
    addCoral(0.375, 0.42, 0.27, 74, ['#8a1f6c', '#ec5a98', '#ffd3e4', 'rgba(205,60,135,0.46)'], { maxD: 7, spread: 0.42, decay: 0.8, w: 0.10, taper: 0.76, fan: true });
    // камни
    [[0.31, 0.30, 0.085, 0.060, 11], [0.58, 0.34, 0.075, 0.050, 12], [0.14, 0.80, 0.12, 0.085, 13], [0.86, 0.86, 0.14, 0.10, 14], [0.40, 0.70, 0.06, 0.04, 15]].forEach(r => {
      const rnd = mulberry32(r[4] * 977), pts = [], N = 9;
      for (let i = 0; i <= N; i++) {
        const a = PI + PI * i / N, j = (i === 0 || i === N) ? 1 : 0.82 + rnd() * 0.34;
        pts.push([cos(a) * j, sin(a) * j * (0.8 + 0.3 * rnd())]);
      }
      decor.push({ kind: 'rock', nx: r[0], z: r[1], rw: r[2], rh: r[3], pts });
    });
    // анемона для клоунов
    anemone = { kind: 'anemone', nx: 0.62, z: 0.52 };
    decor.push(anemone);
    // аэратор
    airstone = { kind: 'stone', nx: 0.82, z: 0.34 };
    decor.push(airstone);
    decor.sort((a, b) => a.z - b.z);

    // градиенты листьев (зависят от размеров окна)
    for (let d = 0; d < decor.length; d++) {
      const p = decor[d];
      if (p.kind !== 'plant') continue;
      const zs = zScale(p.z), base = groundY(p.z) + 4 * S * zs, hh = p.hh * H * lerp(0.78, 1.2, p.z);
      for (let i = 0; i < p.blades.length; i++) {
        const b = p.blades[i], gr = ctx.createLinearGradient(0, base, 0, base - hh * b.len);
        gr.addColorStop(0, p.sty.base); gr.addColorStop(0.5, p.sty.mid); gr.addColorStop(1, p.sty.tip);
        b.grad = gr;
      }
    }
  }
  const decorX = d => d.nx * W + cam * pf(d.z);

  const BX = new Float32Array(20), BY = new Float32Array(20), BA = new Float32Array(20);
  function drawPlant(g, p) {
    const zs = zScale(p.z), px = decorX(p), base = groundY(p.z) + 4 * S * zs;
    const hh = p.hh * H * lerp(0.78, 1.2, p.z);
    const cur = (sin(T * 0.42 + p.nx * 5) * 0.5 + sin(T * 0.17 + p.nx * 11 + 1.3) * 0.35) * p.cur;
    for (let bi = 0; bi < p.blades.length; bi++) {
      const b = p.blades[bi], n = b.segs, len = hh * b.len, seg = len / n;
      let x = px + b.dx * S * zs, y = base;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const a = b.a0 + (cur * 0.22 + sin(T * b.w1 - t * b.k1 + b.ph) * b.amp) * pow(t, 1.15);
        BX[i] = x; BY[i] = y; BA[i] = a;
        x += sin(a) * seg; y -= cos(a) * seg;
      }
      const hw0 = b.w * 0.5 * S * zs;
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const t = i / n, w = b.leaf ? hw0 * (sin(PI * pow(t, 0.72)) + 0.05) : hw0 * (1 - pow(t, 1.4) * 0.92);
        const x = BX[i] - cos(BA[i]) * w, y = BY[i] - sin(BA[i]) * w;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      for (let i = n; i >= 0; i--) {
        const t = i / n, w = b.leaf ? hw0 * (sin(PI * pow(t, 0.72)) + 0.05) : hw0 * (1 - pow(t, 1.4) * 0.92);
        g.lineTo(BX[i] + cos(BA[i]) * w, BY[i] + sin(BA[i]) * w);
      }
      g.closePath(); g.fillStyle = b.grad; g.fill();
      if (b.leaf && p.sty.rib) {
        g.beginPath(); g.moveTo(BX[0], BY[0]);
        for (let i = 1; i <= n; i++) g.lineTo(BX[i], BY[i]);
        g.lineWidth = max(0.8, hw0 * 0.12); g.strokeStyle = p.sty.rib; g.stroke();
      }
      g.beginPath();
      for (let i = 0; i <= n; i += 1) {
        const t = i / n, w = (b.leaf ? hw0 * (sin(PI * pow(t, 0.72)) + 0.05) : hw0 * (1 - pow(t, 1.4) * 0.92)) * 0.6;
        const x = BX[i] + cos(BA[i]) * w, y = BY[i] + sin(BA[i]) * w;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.lineWidth = max(0.8, hw0 * 0.22); g.strokeStyle = p.sty.hi; g.stroke();
    }
  }

  function drawRock(g, r) {
    const zs = zScale(r.z), bx = decorX(r), by = groundY(r.z) + 5 * S * zs;
    const rw = r.rw * W * lerp(0.7, 1.15, r.z), rh = r.rh * H * lerp(0.75, 1.2, r.z);
    for (let k = 0; k < 3; k++) {          // мягкая тень на песке
      const m = 1.3 - k * 0.17;
      g.fillStyle = 'rgba(0,20,30,' + (0.10 + k * 0.03).toFixed(2) + ')'; g.beginPath(); blobPath(g, bx + rw * 0.1, by + rh * 0.05, rw * m, rh * 0.2 * m); g.fill();
    }
    const n = r.pts.length, xs = [], ys = [];
    for (let i = 0; i < n; i++) { xs.push(bx + r.pts[i][0] * rw); ys.push(by + r.pts[i][1] * rh); }
    g.beginPath(); g.moveTo(xs[0], by + 6 * S); g.lineTo(xs[0], ys[0]); smoothPath(g, xs, ys, n);
    g.lineTo(xs[n - 1], by + 6 * S); g.closePath();
    const gr = g.createLinearGradient(bx - rw * 0.5, by - rh, bx + rw * 0.6, by + rh * 0.2);
    gr.addColorStop(0, '#8fa8b2'); gr.addColorStop(0.5, '#506674'); gr.addColorStop(1, '#1f2e3a');
    g.fillStyle = gr; g.fill();
    // светлая верхняя грань и трещины
    g.beginPath(); g.moveTo(xs[1], ys[1]);
    for (let i = 2; i < n - 1; i++) g.lineTo(xs[i], ys[i]);
    for (let i = n - 2; i >= 1; i--) g.lineTo(xs[i] - rw * 0.02, ys[i] + rh * (0.30 + 0.12 * ((i * 7) % 3)));
    g.closePath(); g.fillStyle = 'rgba(190,225,238,0.13)'; g.fill();
    g.beginPath();
    for (let i = 2; i < n - 3; i += 2) {
      g.moveTo(xs[i], ys[i] + rh * 0.10);
      g.lineTo(xs[i] + rw * 0.05, ys[i] + rh * 0.35); g.lineTo(xs[i] + rw * 0.03, ys[i] + rh * 0.55);
    }
    g.lineWidth = 1.4 * S * zs; g.strokeStyle = 'rgba(8,20,30,0.30)'; g.stroke();
    g.beginPath(); g.moveTo(xs[1], ys[1]); for (let i = 2; i < n - 1; i++) g.lineTo(xs[i], ys[i]);
    g.lineWidth = 2 * S * zs; g.strokeStyle = 'rgba(205,238,248,0.32)'; g.stroke();
    g.fillStyle = 'rgba(60,150,92,0.5)';
    for (let i = 2; i < n - 2; i += 2) {
      g.beginPath(); blobPath(g, xs[i] + rw * 0.02, ys[i] + rh * 0.07, rw * 0.07, rh * 0.06); g.fill();
    }
  }

  function drawStone(g, a) {
    const zs = zScale(a.z), x = decorX(a), y = groundY(a.z) + 2 * S * zs, r = 9 * S * zs;
    g.fillStyle = 'rgba(0,20,30,0.35)'; g.beginPath(); blobPath(g, x, y + 2 * S, r * 1.5, r * 0.4); g.fill();
    g.fillStyle = '#5b6f7c'; g.beginPath(); blobPath(g, x, y - r * 0.2, r, r * 0.55); g.fill();
    g.fillStyle = '#8aa0ac'; g.beginPath(); blobPath(g, x, y - r * 0.45, r * 0.85, r * 0.3); g.fill();
  }

  function drawAnemone(g, a) {
    const zs = zScale(a.z), x = decorX(a), by = groundY(a.z) + 4 * S * zs, sc = S * zs * 1.5;
    g.beginPath(); g.moveTo(x - 17 * sc, by); g.quadraticCurveTo(x - 22 * sc, by - 18 * sc, x - 15 * sc, by - 28 * sc);
    g.lineTo(x + 15 * sc, by - 28 * sc); g.quadraticCurveTo(x + 22 * sc, by - 18 * sc, x + 17 * sc, by); g.closePath();
    g.fillStyle = '#7b3358'; g.fill();
    const top = by - 28 * sc, N = 56;
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      const tips = [];
      for (let i = 0; i < N; i++) {
        const u = (i / (N - 1)) * 2 - 1, h = 0.5 + 0.5 * sin(i * 12.9898);
        const bx0 = x + u * (21 - pass * 4) * sc, by0 = top + (pass ? 1 : 3) * sc * (1 - u * u);
        const len = (17 + 12 * h + (pass ? 5 : 0)) * sc * (1 - 0.28 * abs(u));
        const sway = sin(T * 1.7 + i * 0.9) * 0.34 + sin(T * 0.9 + i * 1.7) * 0.2;
        const an = u * 1.35 + sway;
        const ex = bx0 + sin(an) * len, ey = by0 - cos(an) * len;
        g.moveTo(bx0, by0);
        g.quadraticCurveTo(bx0 + sin(u * 1.35 + sway * 0.3) * len * 0.55 + sway * 5 * sc, by0 - cos(u * 1.35) * len * 0.6, ex, ey);
        tips.push(ex, ey);
      }
      g.lineWidth = (pass ? 2.0 : 3.4) * sc; g.lineCap = 'round';
      g.strokeStyle = pass ? '#ff9ab6' : '#c64a78'; g.stroke();
      if (pass) {
        g.fillStyle = '#fff1f5'; g.beginPath();
        for (let i = 0; i < tips.length; i += 2) { g.moveTo(tips[i] + 1.5 * sc, tips[i + 1]); g.arc(tips[i], tips[i + 1], 1.5 * sc, 0, TAU); }
        g.fill();
      }
    }
  }

  function drawCoral(g, c) {
    const zs = zScale(c.z), px0 = decorX(c), by = groundY(c.z) + 5 * S * zs, hz = c.hh * H * lerp(0.78, 1.2, c.z);
    const sc = hz / c.maxH, sway = sin(T * (c.fan ? 0.7 : 0.5) + c.ph) * (c.fan ? 0.16 : 0.30);
    const w0 = c.w * hz, md = c.maxD;
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (c.fan) {                         // «ткань» веера: сглаженный контур по концам ветвей + мягкое свечение
      const gr = g.createRadialGradient(px0, by - hz * 0.55, 0, px0, by - hz * 0.55, hz * 0.8);
      gr.addColorStop(0, 'rgba(225,80,150,0.28)'); gr.addColorStop(1, 'rgba(225,80,150,0)');
      g.fillStyle = gr; g.fillRect(px0 - hz * 0.95, by - hz * 1.4, hz * 1.9, hz * 1.55);
      const tp = c.tips, n = tp.length, xs = [], ys = [];
      xs.push(px0); ys.push(by - hz * 0.24);
      for (let i = 0; i < n; i++) { const u = -tp[i][1]; xs.push(px0 + (tp[i][0] + sway * u * u / c.maxH) * sc); ys.push(by + tp[i][1] * sc); }
      xs.push(px0); ys.push(by - hz * 0.24);
      g.beginPath(); g.moveTo(xs[0], ys[0]); smoothPath(g, xs, ys, n + 2); g.closePath();
      g.fillStyle = c.cols[3]; g.fill();
    }
    for (let pass = 0; pass < (c.fan ? 3 : 2); pass++) {
      for (let d = 0; d <= md; d++) {
        g.beginPath();
        for (let i = 0; i < c.segs.length; i++) {
          const s = c.segs[i]; if (s[4] !== d) continue;
          const u0 = -s[1], u1 = -s[3];
          g.moveTo(px0 + (s[0] + sway * u0 * u0 / c.maxH) * sc, by + s[1] * sc);
          g.lineTo(px0 + (s[2] + sway * u1 * u1 / c.maxH) * sc, by + s[3] * sc);
        }
        const w = w0 * pow(c.taper, d);
        if (pass === 0) { g.lineWidth = w * (c.fan ? 1.5 : 1); g.strokeStyle = c.cols[0]; g.stroke(); }
        else if (pass === 1) { if (d >= 1) { g.lineWidth = w * (c.fan ? 0.8 : 0.45); g.strokeStyle = c.cols[1]; g.stroke(); } }
        else if (d >= 2) { g.lineWidth = max(0.7, w * 0.28); g.strokeStyle = c.cols[2]; g.stroke(); }
      }
    }
    g.fillStyle = c.cols[2]; g.beginPath();
    for (let i = 0; i < c.segs.length; i++) {
      const s = c.segs[i]; if (s[4] !== md) continue;
      const u1 = -s[3], x = px0 + (s[2] + sway * u1 * u1 / c.maxH) * sc, y = by + s[3] * sc, r = max(0.8, w0 * pow(c.taper, md) * (c.fan ? 0.9 : 2.2));
      g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU);
    }
    g.fill();
    if (c.fan) {                         // ствол-основание
      g.beginPath(); g.moveTo(px0, by + 3 * S); g.lineTo(px0 + sway * 4 * S, by - hz * 0.04);
      g.lineWidth = w0 * 2.2; g.strokeStyle = c.cols[0]; g.stroke();
    }
  }

  function drawDecor(g, d) {
    if (d.kind === 'plant') drawPlant(g, d);
    else if (d.kind === 'rock') drawRock(g, d);
    else if (d.kind === 'anemone') drawAnemone(g, d);
    else if (d.kind === 'coral') drawCoral(g, d);
    else drawStone(g, d);
  }

  /* размытые листья на переднем плане */
  let fgSprites = [];
  function buildFg() {
    fgSprites = [];
    for (let side = 0; side < 2; side++) {
      const w = W * 0.20, h = H * 0.62, L = newLayer(w, h), g = L.g;
      const rnd = mulberry32(555 + side * 9);
      g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const bx = w * (0.28 + rnd() * 0.44), lean = (rnd() - 0.5) * 0.9 + (side ? -0.25 : 0.25), len = h * (0.55 + rnd() * 0.45), wd = (14 + rnd() * 20) * S;
        for (let pass = 0; pass < 6; pass++) {
          g.beginPath(); g.moveTo(bx, h + 10);
          g.quadraticCurveTo(bx + sin(lean) * len * 0.35, h - len * 0.55, bx + sin(lean * 1.9) * len * 0.8, h - len);
          g.lineWidth = wd * (0.3 + pass * 0.3); g.strokeStyle = 'rgba(4,36,40,0.13)'; g.stroke();
        }
      }
      fgSprites.push({ c: L.c, w, h, side });
    }
  }
  function drawFg(g) {
    for (let i = 0; i < fgSprites.length; i++) {
      const s = fgSprites[i], ax = s.side ? W * 0.985 : W * 0.015;
      g.save();
      g.translate(ax + cam * 2.0, H * 1.02); g.rotate(sin(T * 0.5 + i * 2) * 0.025);
      g.drawImage(s.c, -s.w * 0.5, -s.h, s.w, s.h);
      g.restore();
    }
  }

  /* --------------------------------------------------- пузыри, рябь, корм, взвесь */
  const bubbles = [], ripples = [], foods = [], motes = [], hazes = [], rays = [], bokeh = [];
  let bubAcc = 0, ambAcc = 0;

  function surfY(x) {
    let y = waterTop() + (sin(x * 0.0125 + T * 0.9) * 2.0 + sin(x * 0.031 - T * 1.35) * 1.2 + sin(x * 0.0058 + T * 0.45 + 1.1) * 3.0) * S;
    for (let i = 0; i < ripples.length; i++) {
      const r = ripples[i], d = x - r.x, sg = 26 * S;
      y += r.a * exp(-d * d / (2 * sg * sg)) * sin(d * 0.22 / S - r.age * 7) * exp(-r.age * 0.9) * S;
    }
    return y;
  }
  // rise — пройденный подъём (px); столб расширяется и «гуляет» кверху: у каждого пузыря свой снос dr,
  // своя скорость sv и амплитуда покачивания, общий изгиб столба — по высоте
  function spawnBubble(x, y, r, z, spread) {
    if (bubbles.length > 320) return;
    bubbles.push({ x0: x, y0: y, x, y, r0: r, r, rise: 0, z, ph: rr(0, TAU), wf: rr(2.2, 5.2), wa: rr(1.6, 4.8),
                   dr: rr(-0.075, 0.075) * (spread || 1), sv: rr(0.72, 1.38) });
  }
  function burstBubbles() {
    const bx = rr(0.12, 0.88) * W, z = rr(0.3, 0.8);
    for (let i = 0; i < 46; i++) spawnBubble(bx + rr(-14, 14) * S, groundY(z) - rr(0, 60) * S, rr(1.2, 5.2) * S, z, 1.5);
  }
  function dropFood(x, n) {
    for (let i = 0; i < n; i++) {
      if (foods.length > 70) break;
      foods.push({ x: x + rr(-36, 36) * S, y: waterTop() + rr(0, 12), z: rr(0.25, 0.85), vy: rr(14, 24) * S,
                   rot: rr(0, TAU), rs: rr(-2, 2), sz: rr(2.2, 3.8), ph: rr(0, TAU), age: 0, landed: false, dead: false, c: (R() * 3) | 0 });
    }
  }
  function initAtmosphere() {
    rays.length = 0; hazes.length = 0; motes.length = 0; bokeh.length = 0;
    for (let i = 0; i < 9; i++) bokeh.push({ x: rr(0, 1), y: rr(0.05, 0.9), r: rr(14, 36), vx: rr(-5, 5), vy: rr(-3, 6), a: rr(0.035, 0.085), ph: rr(0, TAU) });
    const rx = [-0.22, -0.08, 0.06, 0.20, 0.34, 0.50, 0.64, 0.78, 0.92];
    for (let i = 0; i < rx.length; i++) {
      rays.push({ x: rx[i] + rr(-0.03, 0.03), w: rr(90, 300), a: rr(0.11, 0.25), slant: 0.30 + rr(-0.05, 0.07), sp: rr(0.08, 0.2), ph: rr(0, TAU),
                  amp: rr(0.01, 0.035), fl: rr(0.25, 0.7), ph2: rr(0, TAU), v: i & 1 });
    }
    for (let i = 0; i < 7; i++) {
      hazes.push({ x: rr(-0.2, 1.1), y: rr(0.16, 0.74), w: rr(0.5, 1.0), h: rr(0.16, 0.30), v: rr(5, 14) * (R() < 0.5 ? -1 : 1), a: rr(0.10, 0.22) });
    }
    for (let i = 0; i < 180; i++) {
      const big = R() < 0.09;
      motes.push({ x: rr(0, 1), y: rr(0, 0.96), r: big ? rr(3, 8) : rr(0.6, 2.0), a: big ? rr(0.05, 0.10) : rr(0.25, 0.7),
                   vx: rr(-6, 6), vy: rr(-2, 9), ph: rr(0, TAU), tw: rr(0.4, 1.6), z: rr(0, 1) });
    }
  }
  function rayBoost(x, y) {
    let b = 0;
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i], rx = (r.x + sin(T * r.sp + r.ph) * r.amp) * W + r.slant * y, d = (x - rx) / (r.w * 0.34 * S);
      b += exp(-d * d) * r.a * 6;
    }
    return b;
  }

  /* ------------------------------------------------------------------ рыбы */
  const fishes = [], sorted = [], schools = [];
  const ZMIN = 0.04, ZMAX = 0.96;
  const FISH_K = 1.15;           // общий масштаб рыб

  function newGoal(f) {
    const sp = f.sp;
    if (f.home) {
      const a = anemone, ax = a.nx * W;
      f.gx = ax + rr(-0.10, 0.10) * W; f.gz = a.z + rr(-0.12, 0.12);
      f.gy = groundY(a.z) - rr(0.03, 0.22) * H;
    } else {
      let gxx = rr(0.07, 0.93) * W;
      for (let t = 0; t < 4 && abs(gxx - f.x) < 0.28 * W; t++) gxx = rr(0.07, 0.93) * W;
      f.gx = gxx; f.gz = clamp(f.z + rr(-0.3, 0.3), 0.10, 0.90);
      f.gy = rr(waterTop() + 0.06 * H, groundY(f.gz) - 0.08 * H);
    }
    f.goalT = rr(6, 14);
    return sp;
  }
  function makeFish(sp, vi, x, y, z, school, home) {
    const ang = rr(0, TAU), size = sp.len * S * FISH_K, spd = sp.cruise * size * 0.8;
    const f = {
      sp, vi, x, y, z, school: school || null, home: !!home,
      vx: cos(ang) * spd, vy: 0, vz: sin(ang) * spd * 0.4,
      face: cos(ang) >= 0 ? 1 : -1, sgn: cos(ang) >= 0 ? 1 : -1, pitch: 0, pitchRate: 0, psi: ang, yawRate: 0, turnAmp: 0, bend: 0, sr: 0.8,
      phase: rr(0, TAU), phase0: rr(0, TAU), finPh: rr(0, TAU), shimmer: 1, bite: 0,
      w1: rr(0.35, 0.8), w2: rr(0.8, 1.6), w3: rr(0.3, 0.9), p1: rr(0, TAU), p2: rr(0, TAU), p3: rr(0, TAU), p4: rr(0, TAU),
      sizeVar: rr(0.88, 1.12), spdVar: rr(0.9, 1.12), freqVar: rr(0.92, 1.1),
      gx: x, gy: y, gz: z, goalT: 0, ox: 0, oy: 0, oz: 0, ph3: rr(0, TAU),
      moving: false, stateT: rr(0, 3)
    };
    newGoal(f);
    return f;
  }
  function spawnFish() {
    fishes.length = 0; sorted.length = 0; schools.length = 0;
    const byId = {};
    SPECIES.forEach(s => { byId[s.id] = s; });
    function addSchool(sp, count) {
      const lz = rr(0.25, 0.7), lx = rr(0.25, 0.75) * W, ly = rr(waterTop() + 0.2 * H, groundY(lz) - 0.2 * H);
      const sc = { leader: { x: lx, y: ly, z: lz, vx: 0, vy: 0, vz: 0, gx: lx, gy: ly, gz: lz, goalT: 0, psi: rr(0, TAU), turnDir: 0, speed: sp.cruise * sp.len * S * FISH_K * 0.55 },
                   members: [], cx: lx, cy: ly, cz: lz * ZD, ax: 1, ay: 0, az: 0 };
      for (let i = 0; i < count; i++) {
        const f = makeFish(sp, 0, lx + rr(-140, 140) * S, ly + rr(-80, 80) * S, clamp(lz + rr(-0.1, 0.1), ZMIN, ZMAX), sc);
        const bl = sp.len * S * FISH_K; f.ox = rr(-2.4, 2.4) * bl; f.oy = rr(-1.5, 1.5) * bl; f.oz = rr(-2.4, 2.4) * bl;
        sc.members.push(f); fishes.push(f);
      }
      schools.push(sc);
    }
    addSchool(byId.tetra, 22);
    addSchool(byId.danio, 15);
    function addSolo(sp, vi, home) {
      const z = rr(0.2, 0.85);
      fishes.push(makeFish(sp, vi, rr(0.15, 0.85) * W, rr(waterTop() + 0.2 * H, groundY(z) - 0.15 * H), z, null, home));
    }
    for (let i = 0; i < 3; i++) addSolo(byId.angel, i === 2 ? 1 : 0);
    for (let i = 0; i < 3; i++) addSolo(byId.clown, 0, true);
    for (let i = 0; i < 3; i++) addSolo(byId.tang, 0);
    addSolo(byId.betta, 0); addSolo(byId.betta, 1);
    for (let i = 0; i < 4; i++) {
      const z = rr(0.35, 0.9), f = makeFish(byId.cory, 0, rr(0.1, 0.9) * W, groundY(z) - 6, z);
      fishes.push(f);
    }
    for (let i = 0; i < fishes.length; i++) sorted.push(fishes[i]);
  }

  function wallForce(d, m) { if (d >= m) return 0; const t = 1 - max(d, -m) / m; return t * t * 4; }

  function newLeaderGoal(L) {
    let gx = rr(0.12, 0.88) * W;
    for (let t = 0; t < 6 && abs(gx - L.x) < 0.3 * W; t++) gx = rr(0.12, 0.88) * W;
    L.gx = gx; L.gz = clamp(L.z + rr(-0.2, 0.2), 0.15, 0.85);
    L.gy = rr(waterTop() + 0.09 * H, groundY(L.gz) - 0.11 * H); L.goalT = rr(9, 17);
  }
  // вожак стаи: плавные широкие дуги, без разворота на месте
  function updateLeader(L, dt) {
    L.goalT -= dt;
    const dx = L.gx - L.x, dy = L.gy - L.y, dz = (L.gz - L.z) * ZD;
    if (sqrt(dx * dx + dy * dy + dz * dz) < 110 * S || L.goalT <= 0) newLeaderGoal(L);
    let dpsi = atan2((L.gz - L.z) * ZD, L.gx - L.x) - L.psi;
    while (dpsi > PI) dpsi -= TAU; while (dpsi < -PI) dpsi += TAU;
    if (abs(dpsi) > 2.6 && !L.turnDir) L.turnDir = (L.z < 0.5 ? 1 : -1) * (cos(L.psi) >= 0 ? 1 : -1);
    if (L.turnDir) { if (abs(dpsi) < 2.0) L.turnDir = 0; else dpsi = L.turnDir * 3; }
    L.psi += clamp(dpsi, -0.62 * dt, 0.62 * dt);
    L.vx = cos(L.psi) * L.speed; L.vz = sin(L.psi) * L.speed;
    L.vy += (clamp((L.gy - L.y) * 0.5, -0.25 * L.speed, 0.25 * L.speed) - L.vy) * min(1, dt * 1.5);
    L.x = clamp(L.x + L.vx * dt, 0.06 * W, 0.94 * W); L.y += L.vy * dt; L.z = clamp(L.z + L.vz * dt / ZD, 0.08, 0.92);
  }
  function updateSchool(sc, dt) {
    updateLeader(sc.leader, dt);
    const n = sc.members.length;
    let cx = 0, cy = 0, cz = 0, ax = 0, ay = 0, az = 0;
    for (let i = 0; i < n; i++) {
      const m = sc.members[i], s = sqrt(m.vx * m.vx + m.vy * m.vy + m.vz * m.vz) + 1e-3;
      cx += m.x; cy += m.y; cz += m.z * ZD; ax += m.vx / s; ay += m.vy / s; az += m.vz / s;
    }
    sc.cx = cx / n; sc.cy = cy / n; sc.cz = cz / n; sc.ax = ax / n; sc.ay = ay / n; sc.az = az / n;
  }

  function nearestFood(f) {
    let best = null, bd = 1e12;
    for (let i = 0; i < foods.length; i++) {
      const o = foods[i]; if (o.dead) continue;
      const dx = o.x - f.x, dy = o.y - f.y, dz = (o.z - f.z) * ZD, d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = o; }
    }
    f.foodD = sqrt(bd);
    return (best && f.foodD < 0.55 * W) ? best : null;
  }

  function updSgn(f) {
    if (f.sgn > 0 && f.face < -0.12) f.sgn = -1; else if (f.sgn < 0 && f.face > 0.12) f.sgn = 1;
  }
  function orient(f, dt, cruise) {
    const vx = f.vx, vy = f.vy, vz = f.vz;
    const hs = sqrt(vx * vx + vz * vz) + 1e-3;
    f.sr = sqrt(vx * vx + vy * vy + vz * vz) / cruise;
    f.face += (vx / hs - f.face) * min(1, dt * 8);
    updSgn(f);
    const pt = clamp(atan2(vy, hs + cruise * 0.3), -0.6, 0.6), pp = f.pitch;
    f.pitch += (pt - f.pitch) * min(1, dt * 6);
    f.pitchRate += ((f.pitch - pp) / dt - f.pitchRate) * min(1, dt * 5);
    let dpsi = atan2(vz, vx) - f.psi; if (dpsi > PI) dpsi -= TAU; if (dpsi < -PI) dpsi += TAU;
    f.psi += dpsi; f.yawRate += (dpsi / dt - f.yawRate) * min(1, dt * 6);
    f.turnAmp = min(1, abs(f.yawRate) / 2.4);
    f.bend += (clamp(f.pitchRate * 0.10, -0.3, 0.3) - f.bend) * min(1, dt * 6);
    f.phase += TAU * f.sp.freq * f.freqVar * (0.5 + 0.5 * clamp(f.sr, 0, 1.6)) * dt;
    f.bite = max(0, f.bite - dt * 3);
    f.shimmer = 0.55 + 0.45 * sin(T * 2.1 + f.phase0 + f.face * 2);
  }

  function updateFish(f, dt) {
    const sp = f.sp, size = sp.len * S * FISH_K * f.sizeVar, cruise = sp.cruise * size * f.spdVar;
    let vx = f.vx, vy = f.vy, vz = f.vz;
    const spd = sqrt(vx * vx + vy * vy + vz * vz) + 1e-3;
    const hx = vx / spd, hy = vy / spd, hz = vz / spd;
    let dx = hx * 0.8, dy = hy * 0.3, dz = hz * 0.8;
    // блуждание
    const hxz = sqrt(hx * hx + hz * hz) + 1e-3, lx = -hz / hxz, lz = hx / hxz;
    const wob = (sin(T * f.w1 + f.p1) * 0.9 + sin(T * f.w2 + f.p2) * 0.6) * sp.wander * 0.6;
    dx += lx * wob; dz += lz * wob; dy += sin(T * f.w3 + f.p3) * 0.3 * sp.wander;

    const sc = f.school;
    let gx, gy, gz;
    if (sc) {
      const Lr = sc.leader, a = T * 0.15 + f.ph3;
      gx = Lr.x + f.ox * (0.8 + 0.2 * cos(a)); gy = Lr.y + f.oy; gz = Lr.z + f.oz * (0.8 + 0.2 * sin(a)) / ZD;
    } else {
      f.goalT -= dt;
      const ddx = f.gx - f.x, ddy = f.gy - f.y, ddz = (f.gz - f.z) * ZD;
      if (f.goalT <= 0 || ddx * ddx + ddy * ddy + ddz * ddz < (70 * S) * (70 * S)) newGoal(f);
      gx = f.gx; gy = f.gy; gz = f.gz;
    }
    const gdx = gx - f.x, gdy = gy - f.y, gdz = (gz - f.z) * ZD, gd = sqrt(gdx * gdx + gdy * gdy + gdz * gdz) + 1e-3;
    const gdot = (gdx * hx + gdy * hy + gdz * hz) / gd;     // цель впереди (+) или позади (-)
    let gw = sc ? 0.25 + 1.2 * clamp(gd / (220 * S), 0, 1) : (f.home ? 1.0 : 0.95) * min(1, gd / (160 * S)) + 0.1;
    if (sc && gdot < 0 && gd < 6 * size) gw *= (1 + gdot * 0.92);   // обогнал свой слот — не разворачиваться, а притормозить
    dx += gdx / gd * gw; dy += gdy / gd * gw * 0.7; dz += gdz / gd * gw;

    let speedMul = 1;
    if (sc) {
      // выравнивание, сближение, отталкивание
      dx += sc.ax * 0.5; dy += sc.ay * 0.3; dz += sc.az * 0.5;
      const cdx = sc.cx - f.x, cdy = sc.cy - f.y, cdz = sc.cz - f.z * ZD, cd = sqrt(cdx * cdx + cdy * cdy + cdz * cdz) + 1e-3;
      const cw = clamp((cd - 110 * S) / (160 * S), 0, 1) * 0.45;
      dx += cdx / cd * cw; dy += cdy / cd * cw * 0.6; dz += cdz / cd * cw;
      const sepR = size * 1.5, mem = sc.members;
      for (let i = 0; i < mem.length; i++) {
        const o = mem[i]; if (o === f) continue;
        const ex = f.x - o.x, ey = f.y - o.y, ez = (f.z - o.z) * ZD, e2 = ex * ex + ey * ey + ez * ez;
        if (e2 < sepR * sepR && e2 > 1e-3) {
          const e = sqrt(e2), w = (1 - e / sepR) * 1.8;
          dx += ex / e * w; dy += ey / e * w * 0.6; dz += ez / e * w;
        }
      }
    }

    dz *= 0.4;
    // стенки аквариума
    const mxw = max(80 * S, 0.085 * W), mz = 0.16 * ZD, myT = 0.07 * H, myB = 0.10 * H;
    dx += wallForce(f.x - 0.04 * W, mxw) - wallForce(0.96 * W - f.x, mxw);
    dz += wallForce((f.z - ZMIN) * ZD, mz) - wallForce((ZMAX - f.z) * ZD, mz);
    dy += wallForce(f.y - (waterTop() + 0.05 * H), myT) - wallForce((groundY(f.z) - 0.03 * H - size * 0.25) - f.y, myB);

    // корм
    let hunting = false;
    const food = foods.length ? nearestFood(f) : null;
    if (food) {
      hunting = true;
      const fx = food.x - f.x, fy = food.y - f.y, fz = (food.z - f.z) * ZD, fd = f.foodD + 1e-3;
      dx += fx / fd * 3.2; dy += fy / fd * 3.2; dz += fz / fd * 3.2;
      speedMul *= 1.9;
      if (fd < size * 0.38 * zScale(f.z)) { food.dead = true; f.bite = 1; }
    }

    const dl = sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
    let ts = max(cruise * 0.3, cruise * (0.84 + 0.26 * sin(T * 0.31 + f.p4)) * speedMul);
    if (sc) {
      const Lr = sc.leader;
      ts = clamp(sqrt(Lr.vx * Lr.vx + Lr.vy * Lr.vy + Lr.vz * Lr.vz) + 0.9 * (gdot >= 0 ? gd : -0.7 * gd), cruise * 0.3, cruise * 1.5) * (0.95 + 0.1 * sin(T * 0.31 + f.p4));
      if (hunting) ts = max(ts, cruise * 1.7);
    }
    const tx = dx / dl * ts, ty = dy / dl * ts * 0.7, tz = dz / dl * ts;
    let ax = (tx - vx) * 4, ay = (ty - vy) * 4, az = (tz - vz) * 4;
    const am = sqrt(ax * ax + ay * ay + az * az) + 1e-4, maxA = sp.turn * max(spd, cruise * 0.7) * (hunting ? 1.6 : 1);
    if (am > maxA) { const k = maxA / am; ax *= k; ay *= k; az *= k; }
    vx += ax * dt; vy += ay * dt; vz += az * dt;
    const hs = sqrt(vx * vx + vz * vz), maxVy = hs * (hunting ? 0.9 : 0.45) + 6 * S;
    if (vy > maxVy) vy = maxVy; else if (vy < -maxVy) vy = -maxVy;
    f.vx = vx; f.vy = vy; f.vz = vz;
    f.x = clamp(f.x + vx * dt, 0.01 * W, 0.99 * W);
    f.y = clamp(f.y + vy * dt, waterTop() + 0.03 * H, groundY(f.z) - 0.01 * H);
    f.z = clamp(f.z + vz * dt / ZD, 0, 1);
    orient(f, dt, cruise);
  }

  function updateCory(f, dt) {
    const sp = f.sp, size = sp.len * S * FISH_K * f.sizeVar, cruise = sp.cruise * size * f.spdVar;
    f.stateT -= dt;
    if (f.stateT <= 0) {
      f.moving = !f.moving; f.stateT = f.moving ? rr(2.5, 6) : rr(1.2, 3.2);
      if (f.moving) { f.gx = rr(0.08, 0.92) * W; f.gz = rr(0.2, 0.93); }
    }
    let dx = 0, dz = 0, ts = 0;
    const food = foods.length ? nearestFood(f) : null;
    if (food) {
      const fx = food.x - f.x, fz = (food.z - f.z) * ZD, fd = sqrt(fx * fx + fz * fz) + 1e-3;
      dx = fx / fd; dz = fz / fd; ts = cruise * 2.2;
      if (sqrt(fx * fx + (food.y - f.y) * (food.y - f.y) + fz * fz) < size * 0.5) { food.dead = true; f.bite = 1; }
    } else if (f.moving) {
      const fx = f.gx - f.x, fz = (f.gz - f.z) * ZD, fd = sqrt(fx * fx + fz * fz) + 1e-3;
      dx = fx / fd; dz = fz / fd; ts = cruise;
      if (fd < 40 * S) f.stateT = 0;
    }
    const mxw = max(80 * S, 0.08 * W), mz = 0.14 * ZD;
    dx += wallForce(f.x - 0.05 * W, mxw) - wallForce(0.95 * W - f.x, mxw);
    dz += wallForce((f.z - 0.12) * ZD, mz) - wallForce((0.95 - f.z) * ZD, mz);
    const dl = sqrt(dx * dx + dz * dz) + 1e-4, k = min(1, dt * 3.5);
    const tvx = dl > 1e-3 && ts > 0 ? dx / dl * ts : 0, tvz = dl > 1e-3 && ts > 0 ? dz / dl * ts : 0;
    f.vx += (tvx - f.vx) * k; f.vz += (tvz - f.vz) * k; f.vy = 0;
    f.x = clamp(f.x + f.vx * dt, 0.02 * W, 0.98 * W);
    f.z = clamp(f.z + f.vz * dt / ZD, 0.1, 0.96);
    const yt = groundY(f.z) - size * zScale(f.z) * 0.085;
    f.y += (yt - f.y) * min(1, dt * 8);
    const hs = sqrt(f.vx * f.vx + f.vz * f.vz);
    if (hs > 6) { f.face += (f.vx / (hs + 1e-3) - f.face) * min(1, dt * 8); updSgn(f); }
    const sniff = (f.moving || food) ? 0.06 : 0.30 + sin(T * 9 + f.phase0) * 0.05;
    const pp = f.pitch; f.pitch += (sniff - f.pitch) * min(1, dt * 5);
    f.pitchRate += ((f.pitch - pp) / dt - f.pitchRate) * min(1, dt * 5);
    f.sr = hs / cruise; f.yawRate = 0; f.turnAmp = 0;
    f.bend += (clamp(f.pitchRate * 0.10, -0.3, 0.3) - f.bend) * min(1, dt * 6);
    f.phase += TAU * sp.freq * f.freqVar * (0.4 + 0.6 * clamp(f.sr, 0, 1.6)) * dt;
    f.bite = max(0, f.bite - dt * 3);
    f.shimmer = 1;
  }

  /* ------------------------------------------------------------- обновление */
  function update(dt) {
    T += dt;
    cam = (sin(T * 0.05) * 0.011 + sin(T * 0.023 + 1.7) * 0.007) * W;

    for (let i = 0; i < schools.length; i++) updateSchool(schools[i], dt);
    for (let i = 0; i < fishes.length; i++) {
      const f = fishes[i];
      if (f.sp.bottom) updateCory(f, dt); else updateFish(f, dt);
    }
    // корм
    for (let i = foods.length - 1; i >= 0; i--) {
      const o = foods[i];
      if (!o.landed) {
        o.y += o.vy * dt; o.x += sin(T * 1.8 + o.ph) * 7 * S * dt; o.rot += o.rs * dt;
        if (o.y >= groundY(o.z) - 3 * S) { o.landed = true; o.y = groundY(o.z) - 2 * S; }
      } else { o.age += dt; if (o.age > 16) o.dead = true; }
      if (o.dead) { foods[i] = foods[foods.length - 1]; foods.pop(); }
    }
    // пузыри
    bubAcc += dt * (7 + 8 * (0.5 + 0.5 * sin(T * 0.8 + 1.0)) * (0.6 + 0.4 * sin(T * 0.31))); ambAcc += dt * 0.9;
    if (R() < dt * 0.4) {                       // изредка — пачка крупных пузырей
      const n = 3 + ((R() * 4) | 0), bx0 = airstone.nx * W;
      for (let i = 0; i < n; i++) spawnBubble(bx0 + rr(-3, 3) * S, groundY(airstone.z) - 8 * S - i * rr(6, 16) * S, rr(2.6, 5.2) * S, airstone.z, 1.2);
    }
    const ax = airstone.nx * W, az = airstone.z, ay = groundY(az) - 8 * S * zScale(az);
    while (bubAcc >= 1) {
      bubAcc -= 1;
      spawnBubble(ax + rr(-3, 3) * S, ay, rr(0.9, 3.2) * S * (R() < 0.18 ? rr(1.5, 2.2) : 1), az, 1);
    }
    while (ambAcc >= 1) {
      ambAcc -= 1;
      const z = rr(0.15, 0.9);
      spawnBubble(rr(0.05, 0.95) * W, groundY(z) - 2 * S, rr(0.9, 2.2) * S, z, 0.7);
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.rise += (30 + 17 * b.r0 / S) * S * b.sv * dt;
      const t = min(b.rise / (H * 0.8), 1.3);
      b.y = b.y0 - b.rise;
      b.r = b.r0 * (1 + 0.55 * t);                                   // расширение кверху
      b.x = b.x0 + b.dr * b.rise                                      // разброс веером
          + sin(b.ph + T * b.wf) * b.wa * S * (0.55 + 1.1 * t)        // собственное покачивание
          + sin(T * 0.55 + b.rise * 0.006) * 11 * S * (0.25 + t);     // общий изгиб столба
      if (b.y < surfY(b.x) + b.r * 0.4) {
        if (b.r > 2 * S && ripples.length < 14) ripples.push({ x: b.x, age: 0, a: 1.0 + b.r / S * 0.25 });
        bubbles[i] = bubbles[bubbles.length - 1]; bubbles.pop();
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age > 4) { ripples[i] = ripples[ripples.length - 1]; ripples.pop(); }
    }
    // взвесь и муть
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      m.x += (m.vx + sin(T * 0.4 + m.ph) * 5) * dt / W; m.y += (m.vy + cos(T * 0.33 + m.ph * 1.7) * 4) * dt / H;
      if (m.x < -0.02) m.x += 1.04; else if (m.x > 1.02) m.x -= 1.04;
      if (m.y > 0.99) m.y = 0.06; else if (m.y < 0.04) m.y = 0.98;
    }
    for (let i = 0; i < bokeh.length; i++) {
      const b = bokeh[i];
      b.x += b.vx * dt / W; b.y += (b.vy + sin(T * 0.3 + b.ph) * 3) * dt / H;
      if (b.x < -0.1) b.x += 1.2; else if (b.x > 1.1) b.x -= 1.2;
      if (b.y > 1.05) b.y = -0.05; else if (b.y < -0.08) b.y = 1.04;
    }
    for (let i = 0; i < hazes.length; i++) {
      const h = hazes[i]; h.x += h.v * dt / W;
      if (h.x > 1.25) h.x = -0.35; else if (h.x < -0.4) h.x = 1.2;
    }
  }

  /* ---------------------------------------------------------------- отрисовка */
  function drawLayerItems(g, zlo, zhi) {
    let i = 0, j = 0;
    const n = decor.length, m = sorted.length;
    while (i < n && decor[i].z < zlo) i++;
    while (j < m && sorted[j].z < zlo) j++;
    for (;;) {
      const d = (i < n && decor[i].z < zhi) ? decor[i] : null;
      const f = (j < m && sorted[j].z < zhi) ? sorted[j] : null;
      if (!d && !f) break;
      if (d && (!f || d.z <= f.z)) { drawDecor(g, d); i++; } else { drawFish(g, f); j++; }
    }
    g.setTransform(K, 0, 0, K, 0, 0);
  }

  function renderBand(L, zlo, zhi, fog, blur) {
    const g = L.g;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, L.c.width, L.c.height);
    g.setTransform(K, 0, 0, K, 0, 0);
    drawLayerItems(g, zlo, zhi);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = clamp(fog * (0.6 + 0.9 * st.haze), 0, 0.9);
    g.fillStyle = fogGrad; g.fillRect(0, 0, W, H);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (blur > 0) {            // дешёвая «глубина резкости» дальнего плана
      const b = blur * S;
      ctx.globalAlpha = 0.30; ctx.drawImage(L.c, -b, -b * 0.6, W, H); ctx.drawImage(L.c, b, b * 0.6, W, H);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(L.c, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  function drawSurface(g) {
    const top = waterTop(), n = ceil(W / 6) + 1, ys = [];
    for (let i = 0; i < n; i++) ys.push(surfY(i * 6));
    // мягкое свечение под поверхностью
    let gr = g.createLinearGradient(0, 0, 0, H * 0.26);
    gr.addColorStop(0, 'rgba(150,235,245,' + (0.30 * st.light + 0.04).toFixed(3) + ')');
    gr.addColorStop(0.4, 'rgba(100,215,230,' + (0.10 * st.light).toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(80,190,215,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H * 0.26);

    // поверхность снизу: бирюзовое «зеркало» с рябью, а не белая лента
    g.beginPath(); g.moveTo(0, 0);
    for (let i = 0; i < n; i++) g.lineTo(i * 6, ys[i]);
    g.lineTo(W + 6, 0); g.closePath();
    gr = g.createLinearGradient(0, 0, 0, top + 8 * S);
    gr.addColorStop(0, '#4aa6b8'); gr.addColorStop(0.55, '#68c2d0'); gr.addColorStop(1, '#8fdce6');
    g.fillStyle = gr; g.fill();
    if (caustic) {                                   // рябь-каустика внутри ленты
      g.save(); g.clip();
      causticFill(g, T * 0.05 + 0.2, W * 0.30, 0.20, T * 14, 0, -W * 0.1, 0, W * 1.1, top + 14 * S, 0.32 * st.light);
      causticFill(g, 1 - T * 0.07, W * 0.19, 0.16, -T * 9, 3, -W * 0.1, 0, W * 1.1, top + 14 * S, 0.22 * st.light);
      g.restore();
    }
    // тёмная кромка у верха кадра — глубина, чтобы лента не читалась плоской
    gr = g.createLinearGradient(0, 0, 0, top);
    gr.addColorStop(0, 'rgba(10,70,95,0.42)'); gr.addColorStop(1, 'rgba(10,70,95,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, top + 4 * S);

    // гребни волн
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      for (let i = 0; i < n; i++) { const y = ys[i] + pass * 5 * S; if (i === 0) g.moveTo(0, y); else g.lineTo(i * 6, y); }
      g.lineWidth = pass ? 5 * S : 1.8 * S; g.strokeStyle = pass ? 'rgba(230,255,255,0.16)' : 'rgba(235,255,255,0.65)'; g.stroke();
    }
    // длинные блики под поверхностью
    g.strokeStyle = 'rgba(235,255,255,0.10)'; g.lineWidth = 2 * S;
    for (let i = 0; i < 12; i++) {
      const x = ((i * 0.137 + T * 0.012 * (1 + (i % 3) * 0.4)) % 1.2 - 0.1) * W, y = top + (8 + (i * 13) % 34) * S;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 60 * S, y + sin(T * 0.8 + i) * 3 * S, x + (110 + (i % 4) * 40) * S, y); g.stroke();
    }
  }

  function drawRays(g, mul) {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i];
      const a = r.a * (0.62 + 0.38 * sin(T * r.fl + r.ph2)) * st.light * mul;
      const x0 = (r.x + sin(T * r.sp + r.ph) * r.amp) * W + cam * 0.7;
      g.globalAlpha = clamp(a, 0, 1);
      g.save(); g.transform(1, 0, r.slant, 1, x0, 0);
      const w = r.w * S * (0.9 + 0.1 * sin(T * 0.3 + r.ph));
      g.drawImage(spRay[r.v], -w * 0.5, -H * 0.02, w, H * 1.08);
      g.restore();
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  function render() {
    const g = ctx;
    g.setTransform(K, 0, 0, K, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    const lw = W * (1 + 2 * OV), light = st.light;

    // 1. вода и дальний рельеф, песок
    g.drawImage(bgL.c, -OV * W + cam * 0.3, 0, lw, H);
    g.drawImage(floorL.c, -OV * W + cam, 0, lw, H);

    // 2. каустики на песке
    if (caustic) {
      g.save();
      g.translate(cam, 0);
      g.beginPath(); g.moveTo(-OV * W, H + 2);
      for (let x = -OV * W; x <= W * (1 + OV); x += 12) g.lineTo(x, floorTop(x));
      g.lineTo(W * (1 + OV), H + 2); g.closePath(); g.clip();
      g.translate(-cam, 0);
      const y0 = H * (GROUND0 - 0.035), y1 = H * 1.0;
      causticFill(g, T * 0.045, W * 0.50, 0.40, T * 7 + cam, y0, -W * 0.1, y0, W * 1.1, y1, 0.78 * light);
      causticFill(g, 1 - T * 0.062, W * 0.33, 0.40, -T * 5 + 17 + cam, y0 + 9, -W * 0.1, y0, W * 1.1, y1, 0.58 * light);
      // дымка на дальнем краю песка поверх каустик
      const hg = g.createLinearGradient(0, y0, 0, y0 + H * 0.12);
      hg.addColorStop(0, 'rgba(20,110,145,0.72)'); hg.addColorStop(1, 'rgba(20,110,145,0)');
      g.fillStyle = hg; g.fillRect(-W * 0.1, y0, W * 1.2, H * 0.12);
      g.restore();
    }

    // 3-4. задний и средний планы; лучи — между ними (рыбы среднего плана остаются плотными)
    renderBand(bandB, 0, 0.36, 0.34, 1.3);
    drawRays(g, 1.0);
    renderBand(bandM, 0.36, 0.68, 0.20, 0);
    drawRays(g, 0.22);

    // 5. мутность, взвесь
    for (let i = 0; i < hazes.length; i++) {
      const h = hazes[i];
      g.globalAlpha = clamp(h.a * (0.3 + 1.6 * st.haze), 0, 0.5);
      g.drawImage(spBlob, h.x * W + cam * 0.8 - h.w * W * 0.5, h.y * H - h.h * H * 0.5, h.w * W, h.h * H);
    }
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i], x = m.x * W + cam * pf(m.z), y = m.y * H, r = m.r * S * (0.7 + 0.6 * m.z);
      const a = m.a * (0.55 + 0.45 * sin(T * m.tw + m.ph)) * (0.35 + 0.9 * st.haze) * (1 + rayBoost(x, y) * 1.6);
      g.globalAlpha = clamp(a, 0, 1);
      g.drawImage(spDot, x - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';

    // 6. передний план
    drawLayerItems(g, 0.68, 1.01);
    for (let i = 0; i < foods.length; i++) {
      const o = foods[i], zs = zScale(o.z), s = o.sz * S * zs, x = o.x + cam * pf(o.z), y = o.y;
      const cols = ['#ffb45a', '#ff8a4a', '#ffd98a'];
      g.globalAlpha = o.landed ? clamp(1 - (o.age - 12) / 4, 0, 1) : 1;
      g.fillStyle = cols[o.c]; g.beginPath();
      g.moveTo(x + cos(o.rot) * s, y + sin(o.rot) * s * 0.6);
      g.lineTo(x + cos(o.rot + 2.3) * s, y + sin(o.rot + 2.3) * s * 0.6);
      g.lineTo(x + cos(o.rot + 4.2) * s * 0.8, y + sin(o.rot + 4.2) * s * 0.5);
      g.closePath(); g.fill();
    }
    g.globalAlpha = 0.9;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i], r = b.r * 1.12;
      g.drawImage(spBubble, b.x + cam * pf(b.z) - r, b.y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    drawFg(g);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < bokeh.length; i++) {
      const b = bokeh[i], r = b.r * S * (0.9 + 0.1 * sin(T * 0.5 + b.ph));
      g.globalAlpha = b.a * (0.4 + 0.9 * st.haze) * (0.6 + 0.4 * st.light);
      g.drawImage(spBokeh, b.x * W + cam * 2.2 - r, b.y * H - r, r * 2, r * 2);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';

    // 7. блики света по всей сцене
    if (caustic) {
      const y1 = H * 0.92;
      causticFill(g, T * 0.04 + 0.3, W * 0.62, 0.85, T * 9 + cam * 1.3, 0, 0, 0, W, y1, 0.09 * light);
    }

    // 8. поверхность воды и общая обработка
    drawSurface(g);
    g.drawImage(overL.c, 0, 0, W, H);
    // зерно
    g.save();
    g.setTransform(1, 0, 0, 1, (Math.random() * 128) | 0, (Math.random() * 128) | 0);
    g.globalAlpha = 0.04; g.fillStyle = spGrain;
    g.fillRect(-128, -128, canvas.width + 128, canvas.height + 128);
    g.restore();
  }

  /* ------------------------------------------------------------ слои и размер */
  function buildLayers() {
    buildBg(); buildFloor(); buildOverlay();
    bandB = newLayer(W, H); bandM = newLayer(W, H);
    fogGrad = waterGrad(ctx, H);
  }
  function remap(list, sx, sy) {
    for (let i = 0; i < list.length; i++) {
      const o = list[i]; o.x *= sx; o.y *= sy;
      if (o.x0 !== undefined) o.x0 *= sx;
      if (o.y0 !== undefined) { o.y0 *= sy; o.rise *= sy; }
      if (o.gx !== undefined) { o.gx *= sx; o.gy *= sy; }
    }
  }
  function resize() {
    const ow = W, oh = H;
    W = max(320, window.innerWidth || 960); H = max(240, window.innerHeight || 600);
    const dpr = min(window.devicePixelRatio || 1, 2);
    if (!rsInit) { const px = W * H * dpr * dpr; RS = px > 6.5e6 ? 0.8 : px > 3.8e6 ? 0.9 : 1; rsInit = true; }
    K = dpr * RS;
    canvas.width = Math.round(W * K); canvas.height = Math.round(H * K);
    S = clamp(sqrt(W * H) / 1050, 0.45, 1.7);
    ZD = max(420, 0.45 * W);
    if (ow > 0 && fishes.length) {
      const sx = W / ow, sy = H / oh;
      remap(fishes, sx, sy); remap(foods, sx, sy); remap(bubbles, sx, sy);
      for (let i = 0; i < schools.length; i++) remap([schools[i].leader], sx, sy);
    }
    buildLayers(); layoutDecor(); buildFg();
    needResize = false;
  }

  /* --------------------------------------------------------------- управление */
  function bindUI() {
    const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
    on('btn-feed', 'click', () => dropFood(rr(0.2, 0.8) * W, 16));
    on('btn-bubbles', 'click', burstBubbles);
    on('btn-pause', 'click', () => {
      st.paused = !st.paused;
      const b = el('btn-pause'); if (b) b.textContent = st.paused ? 'Пуск' : 'Пауза';
    });
    const rng = (id, fn) => {
      const e = el(id); if (!e) return;
      const apply = () => fn(parseFloat(e.value) / 100);
      e.addEventListener('input', apply); apply();
    };
    rng('rng-light', v => { st.light = v * 1.4; });
    rng('rng-haze', v => { st.haze = v; });
    rng('rng-speed', v => { st.speed = v; });
    canvas.addEventListener('pointerdown', e => dropFood(e.clientX, 6));
    window.addEventListener('resize', () => { needResize = true; });
  }

  /* --------------------------------------------------------------- главный цикл */
  let lastNow = 0, ema = 16.7, slowT = 0;
  function frame(now) {
    window.requestAnimationFrame(frame);
    let raw = lastNow ? now - lastNow : 16.7;
    lastNow = now;
    if (raw > 0 && raw < 250 && !st.paused) {
      ema = ema * 0.95 + raw * 0.05;
      if (ema > 27) slowT += raw / 1000; else slowT = max(0, slowT - raw / 2000);
      if (slowT > 3 && RS > 0.76) { RS = max(0.76, RS - 0.12); slowT = 0; ema = 16.7; needResize = true; }
    }
    if (needResize) resize();
    let dt = min(max(raw, 0) / 1000, 0.05);
    if (!(dt > 0)) dt = 0.016;
    if (!st.paused) {
      dt *= st.speed;
      if (dt > 0) {
        update(dt);
        for (let i = 0; i < sorted.length; i++) {            // вставками: почти отсортирован
          const f = sorted[i]; let j = i - 1;
          while (j >= 0 && sorted[j].z > f.z) { sorted[j + 1] = sorted[j]; j--; }
          sorted[j + 1] = f;
        }
      }
    }
    render();
    // чистка корма, съеденного в этом кадре
    for (let i = foods.length - 1; i >= 0; i--) if (foods[i].dead) { foods[i] = foods[foods.length - 1]; foods.pop(); }
  }

  /* --------------------------------------------------------------------- старт */
  function init() {
    resize();
    prepSpecies();
    buildSprites();
    bakeCaustics();
    initAtmosphere();
    spawnFish();
    // прогрев: расходятся пузыри, стая занимает место
    for (let i = 0; i < 240; i++) update(1 / 30);
    sorted.sort((a, b) => a.z - b.z);
    bindUI();
    window.requestAnimationFrame(frame);
  }

  // тестовый хук: активен только если внешняя обвязка заранее создала window.__AQ_TEST
  if (typeof window !== 'undefined' && window.__AQ_TEST) {
    window.__AQ_TEST.api = {
      SPECIES, M, ctx, fishes, sorted, drawFish, computeSpine, st, update, render, resize,
      get K() { return K; }, get S() { return S; }, get W() { return W; }, get H() { return H; },
      setT(v) { T = v; }, get T() { return T; }, foods, bubbles, bodyPath, makeFish, prepSpecies
    };
  }
  init();
})();
