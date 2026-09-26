/* VoxelSpace-рендер по вертикальным столбцам экрана.
   Проход спереди назад по линиям постоянной глубины z (плоская перспективная проекция:
   экранная ширина на глубине z = 2·z·tan(fov/2)), y-буфер на каждый столбец отсекает
   закрытое. Между соседними по глубине выборками цвет интерполируется вдоль столбца
   (без «ступенек» вблизи). Вдали — мип-уровни карт, туман к цвету неба у горизонта,
   отражение неба на воде по Френелю, тени облаков. Небо: градиент + солнце + облачный слой. */
(function (root) {
  'use strict';

  const OFF = 1024 * 32;             // сдвиг мировых координат в положительную область (для битовых &)
  const SKYN = 1024, SKY_MIN = -0.15, SKY_MAX = 1.0, SKY_K = (SKYN - 1) / (SKY_MAX - SKY_MIN);
  const GLN = 2048, GL_K = (GLN - 1) / 2;
  const CLOUD_Z = 640, CLOUD_TEX = 6, CLOUD_MAX = 7000;
  const BAYER = new Float32Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v / 16 - 0.47) * 2.2));

  function smooth(e0, e1, x) {
    let t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }
  function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  // ---- LUT неба по синусу возвышения ----
  const skyR = new Float32Array(SKYN), skyG = new Float32Array(SKYN), skyB = new Float32Array(SKYN);
  (function () {
    const HZ = [0.84, 0.86, 0.87], MID = [0.55, 0.70, 0.88], ZEN = [0.17, 0.36, 0.70], BEL = [0.80, 0.82, 0.84];
    for (let k = 0; k < SKYN; k++) {
      const s = SKY_MIN + k / SKY_K;
      let c;
      if (s < 0) c = mix3(HZ, BEL, smooth(0, -0.12, s));
      else { c = mix3(HZ, MID, smooth(0, 0.22, s)); c = mix3(c, ZEN, smooth(0.12, 0.9, s)); }
      skyR[k] = c[0] * 255; skyG[k] = c[1] * 255; skyB[k] = c[2] * 255;
    }
  })();
  // ---- LUT свечения солнца по хорде угла до солнца (≈ угол при малых) ----
  const glR = new Float32Array(GLN), glG = new Float32Array(GLN), glB = new Float32Array(GLN);
  (function () {
    for (let k = 0; k < GLN; k++) {
      const c = k / GL_K;
      const disc = 1 - smooth(0.0105, 0.0150, c);
      const halo = Math.exp(-(c / 0.05) * (c / 0.05)) * 0.5 + Math.exp(-c / 0.2) * 0.30 + Math.exp(-c / 0.85) * 0.11;
      glR[k] = (disc * 1.3 + halo * 1.00) * 255;
      glG[k] = (disc * 1.2 + halo * 0.80) * 255;
      glB[k] = (disc * 1.0 + halo * 0.55) * 255;
    }
  })();

  function Renderer() { this.W = 0; this.H = 0; this.world = null; this._c = new Float32Array(3); }

  Renderer.prototype.setSize = function (W, H) {
    this.W = W; this.H = H;
    const F = () => new Float32Array(W);
    this.ybuf = F(); this.yc = new Int32Array(W); this.done = new Uint8Array(W);
    this.pY = F(); this.pR = F(); this.pG = F(); this.pB = F(); this.pW = F();
    this.pOk = new Uint8Array(W); this.ppx = new Float64Array(W); this.ppy = new Float64Array(W);
    this.hz = F(); this.uu = F(); this.qq = F(); this.sa = F(); this.dxs = F(); this.dys = F();
    this.fR = F(); this.fG = F(); this.fB = F();
    this.lR = F(); this.lG = F(); this.lB = F();
    this.hR = F(); this.hG = F(); this.hB = F();
  };

  // Подготовка мира: упакованные цвета уровней (r,g,b,вода в одном Uint32 — одна выборка
  // из памяти вместо четырёх), карта максимумов высот блоками 32×32 (ближняя плоскость),
  // мипы облачного слоя (плотность и подсветка упакованы в Uint16).
  Renderer.prototype.prepare = function (world) {
    this.world = world;
    for (const lv of world.levels) {
      const n = lv.size * lv.size, c = new Uint32Array(n);
      for (let i = 0; i < n; i++) c[i] = ((lv.w[i] << 24) | (lv.b[i] << 16) | (lv.g[i] << 8) | lv.r[i]) >>> 0;
      lv.c = c;
    }
    const h0 = world.levels[0].h, N0 = world.levels[0].size, BN = N0 >> 5, bmax = new Float32Array(BN * BN).fill(-1e9);
    for (let y = 0; y < N0; y++) for (let x = 0; x < N0; x++) {
      const b = (y >> 5) * BN + (x >> 5), v = h0[y * N0 + x];
      if (v > bmax[b]) bmax[b] = v;
    }
    this.bmax = bmax; this.bn = BN;
    const cl = world.cloud, lv = [{ s: cl.size, a: cl.a, l: cl.l }];
    for (let k = 1; k < 4; k++) {
      const p = lv[k - 1], s = p.s >> 1, a = new Uint8Array(s * s), l = new Uint8Array(s * s);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const i = 2 * y * p.s + 2 * x, j = i + p.s;
        a[y * s + x] = (p.a[i] + p.a[i + 1] + p.a[j] + p.a[j + 1] + 2) >> 2;
        l[y * s + x] = (p.l[i] + p.l[i + 1] + p.l[j] + p.l[j + 1] + 2) >> 2;
      }
      lv.push({ s: s, a: a, l: l });
    }
    for (const C of lv) {
      const n = C.s * C.s, p = new Uint16Array(n);
      for (let i = 0; i < n; i++) p[i] = (C.a[i] << 8) | C.l[i];
      C.p = p;
    }
    this.clouds = lv;
  };

  // Максимум высоты рельефа в квадрате радиуса rad вокруг (x, y) по блокам 32×32
  Renderer.prototype.localMax = function (x, y, rad) {
    const bm = this.bmax, bn = this.bn, m = bn - 1;
    const bx0 = Math.floor((x - rad) / 32), bx1 = Math.floor((x + rad) / 32);
    const by0 = Math.floor((y - rad) / 32), by1 = Math.floor((y + rad) / 32);
    let hl = -1e9;
    for (let by = by0; by <= by1; by++) {
      const row = (by & m) * bn;
      for (let bx = bx0; bx <= bx1; bx++) { const v = bm[row + (bx & m)]; if (v > hl) hl = v; }
    }
    return hl;
  };

  // Цвет неба (без облаков) для столбца i и параметра возвышения v (тангенс на экране)
  Renderer.prototype.skyAt = function (i, v, Sz) {
    const il = 1 / Math.sqrt(this.qq[i] + v * v), se = v * il;
    let si = ((se - SKY_MIN) * SKY_K) | 0; si = si < 0 ? 0 : si >= SKYN ? SKYN - 1 : si;
    let ch = 2 - 2 * (this.sa[i] + v * Sz) * il; if (ch < 0) ch = 0;
    let gi = (Math.sqrt(ch) * GL_K) | 0; if (gi >= GLN) gi = GLN - 1;
    const c = this._c;
    c[0] = Math.min(255, skyR[si] + glR[gi]); c[1] = Math.min(255, skyG[si] + glG[gi]); c[2] = Math.min(255, skyB[si] + glB[gi]);
    return c;
  };

  /* cam: {x, y, z, yaw, horizon (px), roll (сдвиг горизонта px на px)}
     opt: {dist, fov, fog, dzk, windX, windY}; out — Uint32Array W*H (ABGR) */
  Renderer.prototype.render = function (cam, opt, out) {
    const world = this.world, W = this.W, H = this.H, cx = W * 0.5;
    const f = cx / Math.tan(opt.fov * 0.5), invf = 1 / f;
    const fx = Math.cos(cam.yaw), fy = Math.sin(cam.yaw), rx = -fy, ry = fx;
    const S = world.sun, Sz = S.z, camX = cam.x, camY = cam.y, camZ = cam.z;
    const ybuf = this.ybuf, yc = this.yc, done = this.done, pY = this.pY, pR = this.pR, pG = this.pG, pB = this.pB, pW = this.pW;
    const pOk = this.pOk, ppx = this.ppx, ppy = this.ppy;
    let hzMin = 1e9;
    const hz = this.hz, uu = this.uu, qq = this.qq, sa = this.sa, dxs = this.dxs, dys = this.dys;
    const fR = this.fR, fG = this.fG, fB = this.fB, lR = this.lR, lG = this.lG, lB = this.lB, hR = this.hR, hG = this.hG, hB = this.hB;
    const tanE = Sz / Math.sqrt(S.x * S.x + S.y * S.y);

    // ---- по-столбцовые величины: луч, горизонт (крен = сдвиг), цвета тумана и отражений ----
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5 - cx) * invf;
      uu[i] = u; qq[i] = 1 + u * u;
      const dx = fx + rx * u, dy = fy + ry * u;
      dxs[i] = dx; dys[i] = dy; sa[i] = dx * S.x + dy * S.y;
      hz[i] = cam.horizon + (i + 0.5 - cx) * cam.roll;
      ybuf[i] = H; done[i] = 0; pY[i] = 1e7; pOk[i] = 0;
      if (hz[i] < hzMin) hzMin = hz[i];
      const sq = Math.sqrt(qq[i]);
      let c = this.skyAt(i, 0.012 * sq, Sz); fR[i] = c[0]; fG[i] = c[1]; fB[i] = c[2];
      c = this.skyAt(i, 0.05 * sq, Sz); lR[i] = c[0] * 0.92; lG[i] = c[1] * 0.94; lB[i] = c[2] * 0.97;
      c = this.skyAt(i, tanE * sq, Sz); hR[i] = c[0] * 0.92; hG[i] = c[1] * 0.94; hB[i] = c[2] * 0.97;
    }

    // ---- рельеф: спереди назад ----
    const L = world.levels, maxL = L.length - 1, L0 = L[0];
    const h0 = L0.h, pk0 = L0.c;
    const WL = world.wl, hInv = 1 / world.hmax, dist = opt.dist;
    const fogDen = opt.fog * 1.55 / dist, edge0 = dist * 0.68;
    const ca0 = this.clouds[0].a, cS = this.clouds[0].s, cM = cS - 1, clScale = 1 / CLOUD_TEX;
    const shOff = S.x / Sz;                         // смещение тени облака на единицу высоты
    const camWL = Math.max(2, camZ - WL);
    const pxBase = camX + OFF, pyBase = camY + OFF, wX = opt.windX, wY = opt.windY;
    // Ближняя плоскость: выборки ближе z0 гарантированно под нижним краем экрана.
    // Для радиуса rad берём максимум рельефа вокруг камеры: y = hz + (camZ - h)·f/z ≥ H,
    // пока h ≤ локального максимума и точка луча не дальше rad (z·√(1+u²) ≤ rad).
    const ext = Math.sqrt(1 + cx * invf * cx * invf), denom = H - hzMin;
    let z = 1;
    if (denom > 1) {
      for (let rad = 96; rad <= 384; rad *= 2) {
        const clr = camZ - this.localMax(camX, camY, rad);
        if (clr > 0) { const zc = Math.min(clr * f / denom, rad / ext); if (zc > z) z = zc; }
      }
    }
    let live = W;
    while (z < dist && live > 0) {
      const dz = 0.3 + z * opt.dzk;
      const invz = f / z;
      const foot = Math.max(z * invf, dz * 0.5);
      const fa = 1 - Math.exp(-z * fogDen), edge = smooth(edge0, dist, z);
      const cosi = camWL / Math.sqrt(camWL * camWL + z * z), om = 1 - cosi;
      const fres = 0.2 + 0.72 * (0.02 + 0.98 * om * om * om * om * om);
      const tz = Math.min(1, camWL / z / tanE);
      let px = pxBase + dxs[0] * z, py = pyBase + dys[0] * z;
      const sx = rx * z * invf, sy = ry * z * invf, baseAdd = camZ * invz;
      const bil = foot < 0.8;
      const lvl = bil ? 0 : Math.min(maxL, Math.floor(Math.log2(foot) + 0.6));
      const Lv = L[lvl], lh = Lv.h, lc = Lv.c, lm = Lv.mask, ls = Lv.shift, sc = 1 / (1 << lvl);

      for (let i = 0; i < W; i++, px += sx, py += sy) {
        if (done[i] === 1) continue;
        // высота — всегда (нужна для y-буфера); цвет — только если выборка видна
        let h, A, B = 0, C = 0, D = 0, w00 = 1, w10 = 0, w01 = 0, w11 = 0;
        if (bil) {
          const ax = px - 0.5, ay = py - 0.5, ix = ax | 0, iy = ay | 0, tx = ax - ix, ty = ay - iy;
          const x0 = ix & 1023, x1 = (ix + 1) & 1023, y0 = (iy & 1023) << 10, y1 = ((iy + 1) & 1023) << 10;
          A = y0 | x0; B = y0 | x1; C = y1 | x0; D = y1 | x1;
          w11 = tx * ty; w10 = tx - w11; w01 = ty - w11; w00 = 1 - tx - ty + w11;
          h = h0[A] * w00 + h0[B] * w10 + h0[C] * w01 + h0[D] * w11;
        } else {
          A = ((((py * sc) | 0) & lm) << ls) | (((px * sc) | 0) & lm);
          h = lh[A];
        }
        const y = hz[i] + baseAdd - h * invz;
        const yb = ybuf[i];
        if (y < yb) {
          let r, g, b, w;
          if (bil) {
            const ka = pk0[A], kb = pk0[B], kc = pk0[C], kd = pk0[D];
            r = (ka & 255) * w00 + (kb & 255) * w10 + (kc & 255) * w01 + (kd & 255) * w11;
            g = ((ka >>> 8) & 255) * w00 + ((kb >>> 8) & 255) * w10 + ((kc >>> 8) & 255) * w01 + ((kd >>> 8) & 255) * w11;
            b = ((ka >>> 16) & 255) * w00 + ((kb >>> 16) & 255) * w10 + ((kc >>> 16) & 255) * w01 + ((kd >>> 16) & 255) * w11;
            w = (ka >>> 24) * w00 + (kb >>> 24) * w10 + (kc >>> 24) * w01 + (kd >>> 24) * w11;
          } else {
            const ka = lc[A];
            r = ka & 255; g = (ka >>> 8) & 255; b = (ka >>> 16) & 255; w = ka >>> 24;
          }
          // предыдущая выборка столбца: из кэша, либо (если была закрыта) — ленивая выборка по её координатам
          let pr0, pg0, pb0, pw0;
          if (pOk[i] === 1) { pr0 = pR[i]; pg0 = pG[i]; pb0 = pB[i]; pw0 = pW[i]; }
          else if (pY[i] < 1e6) {
            const kq = lc[((((ppy[i] * sc) | 0) & lm) << ls) | (((ppx[i] * sc) | 0) & lm)];
            pr0 = kq & 255; pg0 = (kq >>> 8) & 255; pb0 = (kq >>> 16) & 255; pw0 = kq >>> 24;
          } else { pr0 = r; pg0 = g; pb0 = b; pw0 = w; }
          pR[i] = r; pG[i] = g; pB[i] = b; pW[i] = w; pOk[i] = 1;
          // тень облака (билинейно), туман с поправкой на высоту (долины туманнее)
          const cxw = (px + wX + shOff * (CLOUD_Z - h)) * clScale - 0.5, cyw = (py + wY) * clScale - 0.5;
          const cix = cxw | 0, ciy = cyw | 0, ctx = cxw - cix, cty = cyw - ciy;
          const c0 = (ciy & cM) * cS, c1 = ((ciy + 1) & cM) * cS, e0 = cix & cM, e1 = (cix + 1) & cM;
          const ct = ca0[c0 + e0] + (ca0[c0 + e1] - ca0[c0 + e0]) * ctx;
          const cb = ca0[c1 + e0] + (ca0[c1 + e1] - ca0[c1 + e0]) * ctx;
          const shade = 1 - 0.0017 * (ct + (cb - ct) * cty);
          let hf = fa * (1.32 - 0.62 * h * hInv);
          if (hf > 1) hf = 1; if (hf < edge) hf = edge;
          const rfR = lR[i] + (hR[i] - lR[i]) * tz, rfG = lG[i] + (hG[i] - lG[i]) * tz, rfB = lB[i] + (hB[i] - lB[i]) * tz;
          const FR = fR[i], FG = fG[i], FB = fB[i];
          // текущая выборка
          let cr = r * shade, cg = g * shade, cb2 = b * shade;
          if (w > 0) { const k = fres * w * (1 / 255); cr += (rfR - cr) * k; cg += (rfG - cg) * k; cb2 += (rfB - cb2) * k; }
          cr += (FR - cr) * hf; cg += (FG - cg) * hf; cb2 += (FB - cb2) * hf;
          if (cr > 255) cr = 255; if (cg > 255) cg = 255; if (cb2 > 255) cb2 = 255;
          // предыдущая выборка столбца (та же глубинная обработка)
          let qr = pr0 * shade, qg = pg0 * shade, qb = pb0 * shade;
          const pw = pw0;
          if (pw > 0) { const k = fres * pw * (1 / 255); qr += (rfR - qr) * k; qg += (rfG - qg) * k; qb += (rfB - qb) * k; }
          qr += (FR - qr) * hf; qg += (FG - qg) * hf; qb += (FB - qb) * hf;
          if (qr > 255) qr = 255; if (qg > 255) qg = 255; if (qb > 255) qb = 255;
          // заливка отрезка столбца [ceil(y), ceil(yb)-1] с интерполяцией prev -> cur
          let top = Math.ceil(y); if (top < 0) top = 0;
          const bot = Math.ceil(yb) - 1;
          if (top <= bot) {
            const py0 = pY[i], inv = 1 / (py0 - y);
            let t = (py0 - bot) * inv;
            const dr = cr - qr, dg = cg - qg, db = cb2 - qb;
            for (let row = bot, o = bot * W + i; row >= top; row--, o -= W) {
              const tt = t > 1 ? 1 : t;
              out[o] = 0xff000000 | ((qb + db * tt) << 16) | ((qg + dg * tt) << 8) | (qr + dr * tt);
              t += inv;
            }
          }
          ybuf[i] = y;
          if (y <= 0) { done[i] = 1; live--; }
        } else {
          pOk[i] = 0; ppx[i] = px; ppy[i] = py;      // закрыта: цвет не считаем, запоминаем где
        }
        pY[i] = y;
      }
      z += dz;
    }

    // ---- небо: градиент + солнце + облачный слой (плоскость на высоте CLOUD_Z) ----
    let maxRow = 0;
    for (let i = 0; i < W; i++) {
      let c = Math.ceil(ybuf[i]); c = c < 0 ? 0 : c > H ? H : c;
      yc[i] = c; if (c > maxRow) maxRow = c;
    }
    const clZ = Math.max(40, CLOUD_Z - camZ), cl = this.clouds;
    const cox = camX + OFF + wX, coy = camY + OFF + wY;
    const fpK = 1 / (clZ * f * CLOUD_TEX);
    for (let y = 0; y < maxRow; y++) {
      const rowOff = y * W, dRow = (y & 3) << 2;
      for (let i = 0; i < W; i++) {
        if (y >= yc[i]) continue;
        const v = (hz[i] - y) * invf;
        const il = 1 / Math.sqrt(qq[i] + v * v), se = v * il;
        let si = ((se - SKY_MIN) * SKY_K) | 0; si = si < 0 ? 0 : si >= SKYN ? SKYN - 1 : si;
        let ch = 2 - 2 * (sa[i] + v * Sz) * il; if (ch < 0) ch = 0;
        let gi = (Math.sqrt(ch) * GL_K) | 0; if (gi >= GLN) gi = GLN - 1;
        const gr = glR[gi], gg = glG[gi], gb = glB[gi];
        let r = skyR[si] + gr, g = skyG[si] + gg, b = skyB[si] + gb;
        if (v > 0.004) {
          const t = clZ / v;
          if (t < CLOUD_MAX) {
            const fp = t * t * fpK;
            const k = fp < 3.2 ? 0 : fp < 10 ? 1 : fp < 32 ? 2 : 3;
            const C = cl[k], s = C.s, m = s - 1, cs = clScale / (1 << k);
            const ax = (cox + dxs[i] * t) * cs - 0.5, ay = (coy + dys[i] * t) * cs - 0.5;
            const ix = ax | 0, iy = ay | 0, tx = ax - ix, ty = ay - iy;
            const y0 = (iy & m) * s, y1 = ((iy + 1) & m) * s, x0 = ix & m, x1 = (ix + 1) & m;
            const P = C.p, q00 = P[y0 + x0], q10 = P[y0 + x1], q01 = P[y1 + x0], q11 = P[y1 + x1];
            const a00 = q00 >> 8, a01 = q01 >> 8;
            const a0 = a00 + ((q10 >> 8) - a00) * tx, a1 = a01 + ((q11 >> 8) - a01) * tx;
            const d = a0 + (a1 - a0) * ty;
            if (d > 0.5) {
              const m00 = q00 & 255, m01 = q01 & 255;
              const l0 = m00 + ((q10 & 255) - m00) * tx, l1 = m01 + ((q11 & 255) - m01) * tx;
              const lt = (l0 + (l1 - l0) * ty) * (1 / 255);
              const fade = 1 - t * (1 / CLOUD_MAX), far = 1 - fade * fade;
              const al = d * (1 / 255) * fade * (0.55 + 0.45 * fade);
              let qr = 148 + 107 * lt + gr * 0.45, qg = 160 + 92 * lt + gg * 0.45, qb = 184 + 66 * lt + gb * 0.45;
              qr += (r - qr) * far * 0.7; qg += (g - qg) * far * 0.7; qb += (b - qb) * far * 0.7;
              r += (qr - r) * al; g += (qg - g) * al; b += (qb - b) * al;
            }
          }
        }
        const dd = BAYER[dRow + (i & 3)];
        r += dd; g += dd; b += dd;
        if (r > 255) r = 255; else if (r < 0) r = 0;
        if (g > 255) g = 255; else if (g < 0) g = 0;
        if (b > 255) b = 255; else if (b < 0) b = 0;
        out[rowOff + i] = 0xff000000 | (b << 16) | (g << 8) | r;
      }
    }
    return z;
  };

  const api = { Renderer: Renderer, OFF: OFF, CLOUD_Z: CLOUD_Z };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoxelRender = api;
})(typeof window !== 'undefined' ? window : this);
