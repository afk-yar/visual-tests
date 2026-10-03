/* Стая boids — Claude Sonnet 5.5
   Часть 1: модель стаи (без DOM, экспортируется для node-тестов).
   Часть 2: интерфейс и отрисовка на Canvas 2D. */
(function (root) {
  'use strict';

  /* =====================================================================
     МОДЕЛЬ
     ===================================================================== */
  const MAX_N = 2000;
  const SEP_RATIO = 0.42;   // радиус разделения как доля радиуса восприятия
  const FORCE_K = 1.8;      // максимальная сила = maxSpeed * FORCE_K (px/с²)
  const MIN_SPEED_K = 0.4;  // нижняя граница скорости = maxSpeed * MIN_SPEED_K
  const TAU = Math.PI * 2;
  const MAX_CELLS_X = 160;
  const MAX_CELLS_Y = 120;
  const TUNE = { noise: 0.1, relax: 2.0, wander: 0.35, wanderTau: 1.5, cohGain: 0.35 };
  const OFF3 = [-1, 0, 1], OFF2 = [0, 1], OFF1 = [0];

  const DEFAULTS = { sep: 1.7, ali: 1.0, coh: 1.2, radius: 70, maxSpeed: 190 };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(v, m) { v %= m; return v < 0 ? v + m : v; }

  class Flock {
    constructor(w, h) {
      this.w = w; this.h = h; this.n = 0;
      const f64 = () => new Float64Array(MAX_N);
      this.px = f64(); this.py = f64(); this.vx = f64(); this.vy = f64();
      this.ax = f64(); this.ay = f64(); this.ph = f64(); this.pers = f64(); this.wd = f64();
      this.cell = new Int32Array(MAX_N);
      this.order = new Int32Array(MAX_N);
      this.cellStart = new Int32Array(2048);
      this.fillPos = new Int32Array(2048);
      this.out = new Float64Array(6);

      // выбранный агент и то, что он видит
      this.sel = 0;
      this.nb = new Int32Array(MAX_N);
      this.nbNear = new Uint8Array(MAX_N);
      this.nbDx = new Float64Array(MAX_N);
      this.nbDy = new Float64Array(MAX_N);
      this.nbCount = 0;
      this.force = new Float64Array(6); // взвешенные силы: разделение, выравнивание, сцепление (x, y)
      this.cmx = 0; this.cmy = 0; this.hasCm = false;
    }

    _spawn(i, speed) {
      const a = Math.random() * TAU;
      const s = speed * (0.6 + 0.4 * Math.random());
      this.px[i] = Math.random() * this.w;
      this.py[i] = Math.random() * this.h;
      this.vx[i] = Math.cos(a) * s;
      this.vy[i] = Math.sin(a) * s;
      this.ph[i] = Math.random() * TAU;
      this.pers[i] = 0.82 + 0.18 * Math.random();
    }

    randomize(n, speed) {
      this.n = clamp(n | 0, 1, MAX_N);
      for (let i = 0; i < this.n; i++) this._spawn(i, speed);
      if (this.sel >= this.n) this.sel = 0;
    }

    // Новые агенты появляются рядом со случайным старожилом и с похожей скоростью —
    // чтобы вливаться в стаю, а не ломать её.
    setCount(n) {
      n = clamp(n | 0, 1, MAX_N);
      const old = this.n;
      for (let i = old; i < n; i++) {
        if (old > 0) {
          const d = (Math.random() * old) | 0;
          this.px[i] = wrap(this.px[d] + (Math.random() - 0.5) * 50, this.w);
          this.py[i] = wrap(this.py[d] + (Math.random() - 0.5) * 50, this.h);
          const k = 0.95 + 0.1 * Math.random();
          this.vx[i] = this.vx[d] * k;
          this.vy[i] = this.vy[d] * k;
          this.ph[i] = Math.random() * TAU;
          this.pers[i] = 0.82 + 0.18 * Math.random();
        } else {
          this._spawn(i, 150);
        }
      }
      this.n = n;
      if (this.sel >= n) this.sel = 0;
    }

    resize(w, h) {
      const kx = w / this.w, ky = h / this.h;
      for (let i = 0; i < this.n; i++) { this.px[i] *= kx; this.py[i] *= ky; }
      this.w = w; this.h = h;
    }

    // Ближайший к точке агент (с учётом тора).
    nearest(x, y) {
      const W = this.w, H = this.h, hw = W / 2, hh = H / 2;
      let best = 0, bd = Infinity;
      for (let i = 0; i < this.n; i++) {
        let dx = this.px[i] - x; if (dx > hw) dx -= W; else if (dx < -hw) dx += W;
        let dy = this.py[i] - y; if (dy > hh) dy -= H; else if (dy < -hh) dy += H;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    // Агент с «показательным» числом соседей, по возможности не у самого края.
    pickInteresting(P, exclude) {
      const n = this.n, W = this.w, H = this.h, hw = W / 2, hh = H / 2;
      const R2 = P.radius * P.radius;
      let best = 0, bs = Infinity;
      for (let t = 0; t < 48; t++) {
        const i = (Math.random() * n) | 0;
        if (i === exclude && n > 1) continue;
        const x = this.px[i], y = this.py[i];
        let cnt = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          let dx = this.px[j] - x; if (dx > hw) dx -= W; else if (dx < -hw) dx += W;
          let dy = this.py[j] - y; if (dy > hh) dy -= H; else if (dy < -hh) dy += H;
          if (dx * dx + dy * dy < R2) cnt++;
        }
        let score = Math.abs(cnt - 12);
        if (Math.min(x, W - x, y, H - y) < P.radius * 1.05) score += 6;
        if (score < bs) { bs = score; best = i; }
      }
      return best;
    }

    // Три «сырых» руля для агента i: (x, y) разделения, выравнивания, сцепления.
    //  - разделение: отталкивание, растущее с близостью (сумма направлений «от соседа»
    //    с весом 1 - d/rSep), чистое ускорение до maxForce, без торможения;
    //  - выравнивание: «желаемая скорость (курс соседей) минус текущая», не больше maxForce;
    //  - сцепление: ускорение к центру масс видимых соседей, гаснущее у самого центра.
    _steer(i, cnt, avx, avy, ccx, ccy, sx, sy, sn, P, out) {
      const vmax = P.maxSpeed, fmax = vmax * FORCE_K, cruise = vmax * this.pers[i];
      let sepx = 0, sepy = 0, alix = 0, aliy = 0, cohx = 0, cohy = 0;

      if (sn > 0) {
        const m = Math.sqrt(sx * sx + sy * sy);
        if (m > 1e-9) {
          const k = fmax * Math.min(1, m) / m;
          sepx = sx * k; sepy = sy * k;
        }
      }
      if (cnt > 0) {
        const m = Math.sqrt(avx * avx + avy * avy);
        if (m > 1e-9) {
          let ex = avx / m * cruise - this.vx[i], ey = avy / m * cruise - this.vy[i];
          const l = Math.sqrt(ex * ex + ey * ey);
          if (l > fmax) { const k = fmax / l; ex *= k; ey *= k; }
          alix = ex; aliy = ey;
        }
        const mx = ccx / cnt, my = ccy / cnt;
        const dm = Math.sqrt(mx * mx + my * my);
        if (dm > 1e-6) {
          const k = fmax * TUNE.cohGain * Math.min(1, dm / (0.3 * P.radius)) / dm;
          cohx = mx * k; cohy = my * k;
        }
      }
      out[0] = sepx; out[1] = sepy; out[2] = alix; out[3] = aliy; out[4] = cohx; out[5] = cohy;
    }

    step(dt, P) {
      const n = this.n;
      if (n === 0 || dt <= 0) return;
      const W = this.w, H = this.h, hw = W * 0.5, hh = H * 0.5;
      const px = this.px, py = this.py, vx = this.vx, vy = this.vy, ax = this.ax, ay = this.ay;
      const R = P.radius, R2 = R * R, sr = R * SEP_RATIO, sepR2 = sr * sr;
      const vmax = P.maxSpeed, fmax = vmax * FORCE_K, vmin = vmax * MIN_SPEED_K;
      const ws = P.sep, wa = P.ali, wc = P.coh;
      const out = this.out;

      // --- равномерная сетка (размер ячейки >= радиуса восприятия), замкнутая в тор ---
      const cols = Math.max(1, Math.min(MAX_CELLS_X, Math.floor(W / R)));
      const rows = Math.max(1, Math.min(MAX_CELLS_Y, Math.floor(H / R)));
      const ncell = cols * rows;
      if (this.cellStart.length < ncell + 1) {
        this.cellStart = new Int32Array(ncell + 1);
        this.fillPos = new Int32Array(ncell + 1);
      }
      const cs = this.cellStart, fp = this.fillPos, cell = this.cell, order = this.order;
      cs.fill(0, 0, ncell + 1);
      const icw = cols / W, ich = rows / H;
      for (let i = 0; i < n; i++) {
        let gx = (px[i] * icw) | 0; if (gx >= cols) gx = cols - 1; else if (gx < 0) gx = 0;
        let gy = (py[i] * ich) | 0; if (gy >= rows) gy = rows - 1; else if (gy < 0) gy = 0;
        const c = gy * cols + gx;
        cell[i] = c; cs[c + 1]++;
      }
      for (let c = 0; c < ncell; c++) cs[c + 1] += cs[c];
      for (let c = 0; c < ncell; c++) fp[c] = cs[c];
      for (let i = 0; i < n; i++) order[fp[cell[i]]++] = i;

      const dxs = cols >= 3 ? OFF3 : (cols === 2 ? OFF2 : OFF1);
      const dys = rows >= 3 ? OFF3 : (rows === 2 ? OFF2 : OFF1);

      // небольшой «ветер» в рулёжке; не зависит от частоты кадров
      const wk = TUNE.wander * fmax, wdec = dt / TUNE.wanderTau, wsig = Math.sqrt(2 * wdec), wd = this.wd;
      const nz = TUNE.noise * fmax * Math.sqrt((1 / 60) / Math.max(dt, 1 / 240));

      // --- ускорения (синхронное обновление: сначала все считаем, потом двигаем) ---
      for (let i = 0; i < n; i++) {
        const xi = px[i], yi = py[i];
        const c = cell[i];
        const gx = c % cols, gy = (c / cols) | 0;
        let cnt = 0, avx = 0, avy = 0, ccx = 0, ccy = 0, sx = 0, sy = 0, sn = 0;

        for (let a = 0; a < dys.length; a++) {
          let yy = gy + dys[a]; if (yy < 0) yy += rows; else if (yy >= rows) yy -= rows;
          for (let b = 0; b < dxs.length; b++) {
            let xx = gx + dxs[b]; if (xx < 0) xx += cols; else if (xx >= cols) xx -= cols;
            const cc = yy * cols + xx;
            for (let k = cs[cc], e = cs[cc + 1]; k < e; k++) {
              const j = order[k];
              if (j === i) continue;
              let dx = px[j] - xi; if (dx > hw) dx -= W; else if (dx < -hw) dx += W;
              let dy = py[j] - yi; if (dy > hh) dy -= H; else if (dy < -hh) dy += H;
              const d2 = dx * dx + dy * dy;
              if (d2 >= R2) continue;
              cnt++; avx += vx[j]; avy += vy[j]; ccx += dx; ccy += dy;
              if (d2 < sepR2) {
                const d = Math.sqrt(d2) + 1e-3;
                const w = (1 - d / sr) / d;
                sx -= dx * w; sy -= dy * w; sn++;
              }
            }
          }
        }

        this._steer(i, cnt, avx, avy, ccx, ccy, sx, sy, sn, P, out);
        // блуждающий поворот (коррелированный шум): без него стая со временем сливается в одно параллельное течение
        let w = wd[i];
        w += -w * wdec + wsig * ((Math.random() + Math.random() + Math.random() - 1.5) * 2);
        wd[i] = w;
        const vxi = vx[i], vyi = vy[i];
        const lat = w * wk / (Math.sqrt(vxi * vxi + vyi * vyi) + 1e-6);
        ax[i] = ws * out[0] + wa * out[2] + wc * out[4] - vyi * lat + (Math.random() * 2 - 1) * nz;
        ay[i] = ws * out[1] + wa * out[3] + wc * out[5] + vxi * lat + (Math.random() * 2 - 1) * nz;
      }

      // --- интегрирование: скорость плавно тянется к «крейсерской» и зажата в [min, max] ---
      const relax = Math.min(1, TUNE.relax * dt);
      const ph = this.ph, pers = this.pers;
      for (let i = 0; i < n; i++) {
        let nvx = vx[i] + ax[i] * dt, nvy = vy[i] + ay[i] * dt;
        let sp = Math.sqrt(nvx * nvx + nvy * nvy);
        if (sp < 1e-6) { nvx = 1; nvy = 0; sp = 1; }
        let t = sp + (vmax * pers[i] - sp) * relax;
        if (t > vmax) t = vmax; else if (t < vmin) t = vmin;
        const k = t / sp;
        nvx *= k; nvy *= k;
        vx[i] = nvx; vy[i] = nvy;
        let x = px[i] + nvx * dt, y = py[i] + nvy * dt;
        if (x < 0) x += W; else if (x >= W) x -= W;
        if (y < 0) y += H; else if (y >= H) y -= H;
        px[i] = x; py[i] = y;
        ph[i] += dt * (7 + t * 0.025);   // частота взмахов растёт со скоростью
      }
    }

    // Что видит выбранный агент: соседи в радиусе, «слишком близкие» и три силы (с весами).
    // Полный перебор O(N) только для одного агента — дёшево, и работает даже на паузе.
    inspect(P) {
      const n = this.n;
      if (n === 0) return;
      const i = this.sel;
      const W = this.w, H = this.h, hw = W / 2, hh = H / 2;
      const px = this.px, py = this.py, vx = this.vx, vy = this.vy;
      const R2 = P.radius * P.radius, sr = P.radius * SEP_RATIO, sepR2 = sr * sr;
      const xi = px[i], yi = py[i];
      let cnt = 0, avx = 0, avy = 0, ccx = 0, ccy = 0, sx = 0, sy = 0, sn = 0, rc = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        let dx = px[j] - xi; if (dx > hw) dx -= W; else if (dx < -hw) dx += W;
        let dy = py[j] - yi; if (dy > hh) dy -= H; else if (dy < -hh) dy += H;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R2) continue;
        cnt++; avx += vx[j]; avy += vy[j]; ccx += dx; ccy += dy;
        const near = d2 < sepR2;
        if (near) {
          const d = Math.sqrt(d2) + 1e-3, w = (1 - d / sr) / d;
          sx -= dx * w; sy -= dy * w; sn++;
        }
        this.nb[rc] = j; this.nbNear[rc] = near ? 1 : 0; this.nbDx[rc] = dx; this.nbDy[rc] = dy;
        rc++;
      }
      this.nbCount = rc;
      const o = this.out;
      this._steer(i, cnt, avx, avy, ccx, ccy, sx, sy, sn, P, o);
      const f = this.force;
      f[0] = P.sep * o[0]; f[1] = P.sep * o[1];
      f[2] = P.ali * o[2]; f[3] = P.ali * o[3];
      f[4] = P.coh * o[4]; f[5] = P.coh * o[5];
      this.hasCm = cnt > 0;
      this.cmx = cnt > 0 ? ccx / cnt : 0;
      this.cmy = cnt > 0 ? ccy / cnt : 0;
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Flock, TUNE, DEFAULTS, SEP_RATIO, FORCE_K, MIN_SPEED_K, MAX_N };
  }
  if (typeof document === 'undefined') return;

  /* =====================================================================
     ИНТЕРФЕЙС И ОТРИСОВКА
     ===================================================================== */
  const $ = (s) => document.querySelector(s);
  const cvF = $('#flock'), cvO = $('#focus');
  const gF = cvF.getContext('2d'), gO = cvO.getContext('2d');
  const stage = $('#stage'), panel = $('#panel'), hudStats = $('#stats');

  const AMBER = '#ffc857', SEP_C = '#ff6f61', ALI_C = '#b6f05a', COH_C = '#3fe0d2', NB_C = '#eef8ff';
  const BASE_L = 12;          // длина птицы в px при масштабе 1
  const NB = 18;              // число цветовых корзин по направлению полёта
  const FADE = 0.12;          // доля затухания следа за шаг
  const FADE_STEP = 1 / 60;   // шаг затухания, с (не зависит от частоты кадров)

  const P = Object.assign({}, DEFAULTS);
  const view = { trails: true, zone: true, vectors: true };
  let W = 0, H = 0, dpr = 1, S = 1;
  let dirty = true, paused = false, needFit = false, flash = 0, fadeAcc = 0;
  let flock = null;

  function fit() {
    const w = window.innerWidth || document.documentElement.clientWidth || 800;
    const h = window.innerHeight || document.documentElement.clientHeight || 600;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const cv of [cvF, cvO]) {
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
    }
    gF.setTransform(dpr, 0, 0, dpr, 0, 0);
    gO.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = clamp(Math.min(w, h) / 720, 0.8, 1.35);
    if (flock) flock.resize(w, h);
    W = w; H = h; dirty = true;
  }

  function defaultCount(w, h) {
    return Math.round(clamp(w * h / 2600, 500, 1100) / 50) * 50;
  }

  // ---------- рисование птицы: «шеврон» с машущими крыльями ----------
  // (c, s) — единичный вектор направления, f в [0..1] — фаза взмаха
  function birdPath(g, x, y, c, s, L, wMax, f) {
    const tx = L * (0.38 + 0.22 * f), w = wMax * (0.3 + 0.7 * f);
    const bx = x - tx * c, by = y - tx * s;
    g.moveTo(x + c * L * 0.8, y + s * L * 0.8);
    g.lineTo(bx - w * s, by + w * c);
    g.lineTo(x - 0.25 * L * c, y - 0.25 * L * s);
    g.lineTo(bx + w * s, by - w * c);
    g.closePath();
  }

  // то же, плюс копии за краями тора, если птица у границы
  function birdWrapped(g, x, y, c, s, L, wMax, f) {
    birdPath(g, x, y, c, s, L, wMax, f);
    const ox = x < L ? W : (x > W - L ? -W : 0);
    const oy = y < L ? H : (y > H - L ? -H : 0);
    if (ox) birdPath(g, x + ox, y, c, s, L, wMax, f);
    if (oy) birdPath(g, x, y + oy, c, s, L, wMax, f);
    if (ox && oy) birdPath(g, x + ox, y + oy, c, s, L, wMax, f);
  }

  // ---------- основной слой: стая ----------
  const COLORS = [];
  for (let k = 0; k < NB; k++) {
    COLORS.push('hsla(' + (215 + 95 * (k + 0.5) / NB).toFixed(1) + ',78%,68%,0.93)');
  }
  const COS_A = Math.cos(0.9), SIN_A = Math.sin(0.9);
  const bucketOf = new Uint8Array(MAX_N);
  const dirX = new Float64Array(MAX_N), dirY = new Float64Array(MAX_N);
  const bStart = new Int32Array(NB + 1), bPos = new Int32Array(NB + 1), bList = new Int32Array(MAX_N);

  function drawFlock(dt) {
    const g = gF;
    if (view.trails) {
      fadeAcc += dt;
      if (dirty) {
        g.clearRect(0, 0, W, H);
        fadeAcc = 0;
      } else if (fadeAcc >= FADE_STEP) {
        const steps = Math.floor(fadeAcc / FADE_STEP);
        fadeAcc -= steps * FADE_STEP;
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = 'rgba(0,0,0,' + (1 - Math.pow(1 - FADE, steps)).toFixed(4) + ')';
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
      }
    } else {
      g.clearRect(0, 0, W, H);
    }

    const n = flock.n, px = flock.px, py = flock.py, vx = flock.vx, vy = flock.vy;
    const ph = flock.ph, pers = flock.pers;

    // раскладываем агентов по корзинам (цвет = направление полёта)
    bStart.fill(0);
    for (let i = 0; i < n; i++) {
      let sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      if (sp < 1e-9) sp = 1;
      const c = vx[i] / sp, s = vy[i] / sp;
      dirX[i] = c; dirY[i] = s;
      let k = (((c * COS_A + s * SIN_A) + 1) * 0.5 * NB) | 0;
      if (k >= NB) k = NB - 1;
      bucketOf[i] = k; bStart[k + 1]++;
    }
    for (let k = 0; k < NB; k++) bStart[k + 1] += bStart[k];
    for (let k = 0; k < NB; k++) bPos[k] = bStart[k];
    for (let i = 0; i < n; i++) bList[bPos[bucketOf[i]]++] = i;

    const L0 = BASE_L * S;
    for (let k = 0; k < NB; k++) {
      if (bStart[k] === bStart[k + 1]) continue;
      g.beginPath();
      for (let q = bStart[k]; q < bStart[k + 1]; q++) {
        const i = bList[q];
        const L = L0 * (0.8 + (pers[i] - 0.82) * 1.6);
        birdWrapped(g, px[i], py[i], dirX[i], dirY[i], L, L * 0.42, 0.5 + 0.5 * Math.sin(ph[i]));
      }
      g.fillStyle = COLORS[k];
      g.fill();
    }
  }

  // ---------- верхний слой: выбранный агент, радиус, соседи, силы ----------
  function arrow(g, x, y, fx, fy, color, k, maxLen) {
    const m = Math.sqrt(fx * fx + fy * fy);
    if (m < 1e-6) return;
    const len = Math.min(maxLen, m * k);
    if (len < 6) return;
    const ux = fx / m, uy = fy / m;
    const ex = x + ux * len, ey = y + uy * len;
    const hx = ex - ux * 9, hy = ey - uy * 9;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass === 0 ? 'rgba(4,8,28,.55)' : color;
      g.fillStyle = pass === 0 ? 'rgba(4,8,28,.55)' : color;
      g.lineWidth = pass === 0 ? 5 : 2.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(hx, hy); g.stroke();
      g.beginPath();
      g.moveTo(ex, ey);
      g.lineTo(hx - uy * 4.5, hy + ux * 4.5);
      g.lineTo(hx + uy * 4.5, hy - ux * 4.5);
      g.closePath();
      if (pass === 0) { g.lineWidth = 3; g.stroke(); }
      g.fill();
    }
  }

  function drawFocus(now, dt) {
    const g = gO;
    g.clearRect(0, 0, W, H);
    const f = flock, i = f.sel;
    if (i >= f.n) return;
    const x = f.px[i], y = f.py[i];
    const R = P.radius, sr = R * SEP_RATIO;
    const L0 = BASE_L * S;
    const nbc = f.nbCount;

    if (view.zone) {
      // диски восприятия и разделения (с копиями за краями тора)
      g.setLineDash([5, 6]);
      g.lineDashOffset = -now * 0.012;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cx = x + ox * W, cy = y + oy * H;
          if (cx + R < 0 || cx - R > W || cy + R < 0 || cy - R > H) continue;
          const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R);
          grad.addColorStop(0, 'rgba(255,200,87,0.00)');
          grad.addColorStop(0.7, 'rgba(255,200,87,0.04)');
          grad.addColorStop(1, 'rgba(255,200,87,0.15)');
          g.fillStyle = grad;
          g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
          g.strokeStyle = 'rgba(255,200,87,0.85)'; g.lineWidth = 1.4;
          g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
          g.fillStyle = 'rgba(255,111,97,0.07)';
          g.beginPath(); g.arc(cx, cy, sr, 0, TAU); g.fill();
          g.strokeStyle = 'rgba(255,111,97,0.6)'; g.lineWidth = 1.1;
          g.beginPath(); g.arc(cx, cy, sr, 0, TAU); g.stroke();
        }
      }
      g.setLineDash([]);

      // линии «агент — сосед»; у границы тора линия рисуется с обеих сторон
      for (let pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass === 0 ? 'rgba(238,248,255,0.30)' : 'rgba(255,111,97,0.60)';
        g.lineWidth = 1;
        g.beginPath();
        for (let k = 0; k < nbc; k++) {
          if (f.nbNear[k] !== pass) continue;
          const j = f.nb[k], dx = f.nbDx[k], dy = f.nbDy[k];
          g.moveTo(x, y); g.lineTo(x + dx, y + dy);
          if (Math.abs(f.px[j] - (x + dx)) > 0.5 || Math.abs(f.py[j] - (y + dy)) > 0.5) {
            g.moveTo(f.px[j], f.py[j]); g.lineTo(f.px[j] - dx, f.py[j] - dy);
          }
        }
        g.stroke();
      }

      // соседи: яркие птицы поверх основного слоя
      for (let pass = 0; pass < 2; pass++) {
        g.beginPath();
        for (let k = 0; k < nbc; k++) {
          if (f.nbNear[k] !== pass) continue;
          const j = f.nb[k];
          const sp = Math.sqrt(f.vx[j] * f.vx[j] + f.vy[j] * f.vy[j]) || 1;
          const L = L0 * 1.18;
          birdWrapped(g, f.px[j], f.py[j], f.vx[j] / sp, f.vy[j] / sp, L, L * 0.42, 0.5 + 0.5 * Math.sin(f.ph[j]));
        }
        g.fillStyle = pass === 0 ? NB_C : '#ff8a78';
        g.fill();
      }
      if (nbc <= 80) {
        g.strokeStyle = 'rgba(238,248,255,0.45)'; g.lineWidth = 1;
        g.beginPath();
        for (let k = 0; k < nbc; k++) {
          const j = f.nb[k];
          g.moveTo(f.px[j] + 8 * S, f.py[j]); g.arc(f.px[j], f.py[j], 8 * S, 0, TAU);
        }
        g.stroke();
      }
    }

    // сам агент (и копии у границы)
    const sp = Math.sqrt(f.vx[i] * f.vx[i] + f.vy[i] * f.vy[i]) || 1;
    const c = f.vx[i] / sp, s = f.vy[i] / sp;
    const Ls = L0 * 1.9;
    const fl = 0.5 + 0.5 * Math.sin(f.ph[i]);
    g.shadowColor = 'rgba(255,200,87,0.95)'; g.shadowBlur = 16;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = x + ox * W, cy = y + oy * H;
        if (cx < -30 || cx > W + 30 || cy < -30 || cy > H + 30) continue;
        g.fillStyle = AMBER;
        g.beginPath(); birdPath(g, cx, cy, c, s, Ls, Ls * 0.42, fl); g.fill();
      }
    }
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,200,87,0.9)'; g.lineWidth = 1.5;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = x + ox * W, cy = y + oy * H;
        if (cx < -30 || cx > W + 30 || cy < -30 || cy > H + 30) continue;
        g.beginPath(); g.arc(cx, cy, Ls * 0.95, 0, TAU); g.stroke();
      }
    }

    // три силы и центр масс видимых соседей
    if (view.vectors) {
      const k = 70 / (P.maxSpeed * FORCE_K), maxLen = 150;
      arrow(g, x, y, f.force[0], f.force[1], SEP_C, k, maxLen);
      arrow(g, x, y, f.force[2], f.force[3], ALI_C, k, maxLen);
      // сцепление показываем в «весовой» шкале (без внутреннего множителя cohGain), чтобы длины стрелок трёх правил были сопоставимы
      arrow(g, x, y, f.force[4] / TUNE.cohGain, f.force[5] / TUNE.cohGain, COH_C, k, maxLen);
      if (f.hasCm) {
        const mx = x + f.cmx, my = y + f.cmy;
        g.strokeStyle = COH_C; g.lineWidth = 1.6;
        g.beginPath();
        g.arc(mx, my, 5, 0, TAU);
        g.moveTo(mx - 9, my); g.lineTo(mx - 3, my);
        g.moveTo(mx + 3, my); g.lineTo(mx + 9, my);
        g.moveTo(mx, my - 9); g.lineTo(mx, my - 3);
        g.moveTo(mx, my + 3); g.lineTo(mx, my + 9);
        g.stroke();
      }
    }

    // вспышка при выборе
    if (flash > 0) {
      g.strokeStyle = 'rgba(255,200,87,' + flash.toFixed(3) + ')'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 14 + (1 - flash) * 60, 0, TAU); g.stroke();
      flash = Math.max(0, flash - dt * 2.2);
    }
  }

  // ---------- элементы управления ----------
  const FMT = {
    sep: (v) => v.toFixed(2),
    ali: (v) => v.toFixed(2),
    coh: (v) => v.toFixed(2),
    radius: (v) => v.toFixed(0) + ' px',
    maxSpeed: (v) => v.toFixed(0) + ' px/с',
    count: (v) => String(v | 0)
  };
  const inputs = {};
  for (const id of Object.keys(FMT)) inputs[id] = document.getElementById(id);

  function syncSlider(id) {
    const inp = inputs[id];
    const min = +inp.min, max = +inp.max, v = +inp.value;
    inp.style.setProperty('--p', ((v - min) / (max - min) * 100).toFixed(2) + '%');
    document.getElementById('o-' + id).textContent = FMT[id](v);
  }

  for (const id of Object.keys(inputs)) {
    inputs[id].addEventListener('input', () => {
      const v = +inputs[id].value;
      if (id === 'count') { flock.setCount(v); dirty = true; }
      else P[id] = v;
      syncSlider(id);
    });
  }

  function resetParams() {
    for (const key of Object.keys(DEFAULTS)) {
      P[key] = DEFAULTS[key];
      inputs[key].value = DEFAULTS[key];
      syncSlider(key);
    }
  }

  function warmUp(seconds) {
    const steps = Math.round(seconds * 60);
    for (let k = 0; k < steps; k++) flock.step(1 / 60, P);
  }

  function pickAgent(excludeCurrent) {
    flock.sel = flock.pickInteresting(P, excludeCurrent ? flock.sel : -1);
    flash = 1;
  }

  function shuffle() {
    flock.randomize(flock.n, P.maxSpeed);
    warmUp(5);
    pickAgent(false);
    dirty = true;
  }

  function setToggle(btn, key) {
    btn.addEventListener('click', () => {
      view[key] = !view[key];
      btn.setAttribute('aria-pressed', String(view[key]));
      dirty = true;
    });
  }

  const bPause = $('#b-pause');
  bPause.addEventListener('click', () => {
    paused = !paused;
    bPause.textContent = paused ? 'Пуск' : 'Пауза';
    bPause.setAttribute('aria-pressed', String(paused));
  });
  $('#b-pick').addEventListener('click', () => pickAgent(true));
  $('#b-shuffle').addEventListener('click', shuffle);
  $('#b-reset').addEventListener('click', resetParams);
  setToggle($('#t-zone'), 'zone');
  setToggle($('#t-vectors'), 'vectors');
  setToggle($('#t-trails'), 'trails');

  const bFold = $('#b-fold');
  function setFolded(folded) {
    panel.classList.toggle('collapsed', folded);
    bFold.setAttribute('aria-expanded', String(!folded));
    bFold.setAttribute('aria-label', folded ? 'Развернуть панель' : 'Свернуть панель');
  }
  bFold.addEventListener('click', () => setFolded(!panel.classList.contains('collapsed')));

  stage.addEventListener('pointerdown', (e) => {
    flock.sel = flock.nearest(e.clientX, e.clientY);
    flash = 1;
  });

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const tag = e.target && e.target.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT') return;
    e.preventDefault();
    bPause.click();
  });

  window.addEventListener('resize', () => { needFit = true; });

  // ---------- запуск ----------
  fit();
  flock = new Flock(W, H);
  flock.randomize(defaultCount(W, H), P.maxSpeed);
  inputs.count.value = flock.n;
  for (const id of Object.keys(inputs)) syncSlider(id);
  warmUp(5);          // к первому кадру стая уже собралась
  flock.sel = flock.pickInteresting(P, -1);
  setFolded(H < 480);

  let last = 0, fpsAcc = 0, fpsFrames = 0, fpsShown = 0, statAcc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const raw = last ? (now - last) / 1000 : 0;
    last = now;
    const dt = Math.min(raw > 0 ? raw : 0, 0.05);   // кламп большого dt (вкладка в фоне и т.п.)

    if (needFit) { needFit = false; fit(); }
    if (!paused) flock.step(dt, P);
    flock.inspect(P);

    if (!paused || dirty) { drawFlock(paused ? 0 : dt); dirty = false; }
    drawFocus(now, dt);

    if (raw > 0) {
      fpsAcc += raw; fpsFrames++; statAcc += raw;
      if (statAcc >= 0.4) {
        fpsShown = fpsFrames / fpsAcc;
        fpsAcc = 0; fpsFrames = 0; statAcc = 0;
        hudStats.textContent = flock.n + ' агентов · в поле зрения выбранного: ' + flock.nbCount +
          ' · ' + Math.round(fpsShown) + ' fps' + (paused ? ' · пауза' : '');
      }
    }
  }
  requestAnimationFrame(frame);

})(typeof window !== 'undefined' ? window : globalThis);
