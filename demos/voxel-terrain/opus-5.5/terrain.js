/* Процедурный мир для VoxelSpace-рендера: карта высот + карта цвета + мипы + облака.
   Карта 1024×1024 бесшовно тайлится (периодический градиентный шум), поэтому
   камера может лететь бесконечно, «заворачивая» координаты по маске. */
(function (root) {
  'use strict';

  const N = 1024, MASK = N - 1, SHIFT = 10;
  const HMAX = 230;                 // высота самых высоких пиков, мировые единицы
  const SUN_ELEV = 0.40;            // возвышение солнца, рад (~23°)
  const SUN = { x: -Math.cos(SUN_ELEV), y: 0, z: Math.sin(SUN_ELEV) }; // вектор НА солнце
  const WARP = 46;                  // амплитуда искажения домена, тексели

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- периодический градиентный шум с аналитическими производными ----------
  const GX = new Float32Array(256), GY = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = (i + 0.5) / 256 * Math.PI * 2; GX[i] = Math.cos(a); GY[i] = Math.sin(a); }
  let PERM = new Uint8Array(512);
  const ND = new Float64Array(3);   // [значение, d/dx, d/dy] в координатах решётки

  function setSeed(seed) {
    const r = rng(seed), p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    PERM = new Uint8Array(512);
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  }

  // x, y — координаты решётки; p — период (целое ≤ 256); o — смещение октавы (0..255)
  function nd(x, y, p, o) {
    const fx0 = Math.floor(x), fy0 = Math.floor(y);
    const fx = x - fx0, fy = y - fy0;
    let ix0 = fx0 % p; if (ix0 < 0) ix0 += p;
    let iy0 = fy0 % p; if (iy0 < 0) iy0 += p;
    let ix1 = ix0 + 1; if (ix1 === p) ix1 = 0;
    let iy1 = iy0 + 1; if (iy1 === p) iy1 = 0;
    const ax = (ix0 + o) & 255, bx = (ix1 + o) & 255;
    const ay = (iy0 + o * 3) & 255, by = (iy1 + o * 3) & 255;
    const h00 = PERM[PERM[ax] + ay], h10 = PERM[PERM[bx] + ay];
    const h01 = PERM[PERM[ax] + by], h11 = PERM[PERM[bx] + by];
    const g00x = GX[h00], g00y = GY[h00], g10x = GX[h10], g10y = GY[h10];
    const g01x = GX[h01], g01y = GY[h01], g11x = GX[h11], g11y = GY[h11];
    const va = g00x * fx + g00y * fy;
    const vb = g10x * (fx - 1) + g10y * fy;
    const vc = g01x * fx + g01y * (fy - 1);
    const vd = g11x * (fx - 1) + g11y * (fy - 1);
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const du = 30 * fx * fx * (fx * (fx - 2) + 1);
    const dv = 30 * fy * fy * (fy * (fy - 2) + 1);
    const k = va - vb - vc + vd;
    ND[0] = va + u * (vb - va) + v * (vc - va) + u * v * k;
    ND[1] = g00x + u * (g10x - g00x) + v * (g01x - g00x) + u * v * (g00x - g10x - g01x + g11x) + du * (v * k + vb - va);
    ND[2] = g00y + u * (g10y - g00y) + v * (g01y - g00y) + u * v * (g00y - g10y - g01y + g11y) + dv * (u * k + vc - va);
  }

  function smooth(e0, e1, x) {
    let t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  // Бокс-блюр с заворотом (сепарабельный, скользящая сумма), size×size
  function boxBlur(src, size, r, passes) {
    const n = size * size, m = size - 1;
    let a = Float32Array.from(src), b = new Float32Array(n);
    const inv = 1 / (2 * r + 1);
    for (let pass = 0; pass < passes; pass++) {
      for (let y = 0; y < size; y++) {            // по горизонтали a -> b
        const row = y * size;
        let s = 0;
        for (let k = -r; k <= r; k++) s += a[row + (k & m)];
        for (let x = 0; x < size; x++) {
          b[row + x] = s * inv;
          s += a[row + ((x + r + 1) & m)] - a[row + ((x - r) & m)];
        }
      }
      for (let x = 0; x < size; x++) {            // по вертикали b -> a
        let s = 0;
        for (let k = -r; k <= r; k++) s += b[((k & m) * size) + x];
        for (let y = 0; y < size; y++) {
          a[y * size + x] = s * inv;
          s += b[(((y + r + 1) & m) * size) + x] - b[(((y - r) & m) * size) + x];
        }
      }
    }
    return a;
  }

  // Билинейная выборка из периодической сетки L×L (L — степень двойки)
  function bilin(arr, L, gx, gy) {
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = gx - x0, ty = gy - y0, m = L - 1;
    const i0 = x0 & m, i1 = (x0 + 1) & m, j0 = (y0 & m) * L, j1 = ((y0 + 1) & m) * L;
    const a = arr[j0 + i0] + (arr[j0 + i1] - arr[j0 + i0]) * tx;
    const b = arr[j1 + i0] + (arr[j1 + i1] - arr[j1 + i0]) * tx;
    return a + (b - a) * ty;
  }

  function generate(seed) {
    const t0 = performance.now();
    setSeed(seed);
    const R = rng(seed ^ 0x9e3779b9);

    // ---- 1. Низкочастотные поля на сетке 256² (варп, первые октавы, влажность) ----
    const L = 256, LS = N / L;
    const lwx = new Float32Array(L * L), lwy = new Float32Array(L * L);
    const la = new Float32Array(L * L), ldx = new Float32Array(L * L), ldy = new Float32Array(L * L);
    const lmo = new Float32Array(L * L);
    const P0 = 4;
    for (let j = 0; j < L; j++) {
      for (let i = 0; i < L; i++) {
        const x = i * LS, y = j * LS, id = j * L + i;
        let wx = 0, wy = 0, amp = 1, p = 3;
        for (let o = 0; o < 3; o++) {
          nd(x / N * p, y / N * p, p, 11 + o * 7); wx += amp * ND[0];
          nd(x / N * p, y / N * p, p, 101 + o * 13); wy += amp * ND[0];
          amp *= 0.5; p *= 2;
        }
        wx *= WARP; wy *= WARP;
        lwx[id] = wx; lwy[id] = wy;
        const X = x + wx, Y = y + wy;
        let a = 0, dx = 0, dy = 0, b = 1; p = P0;
        for (let o = 0; o < 3; o++) {           // октавы 0..2 «эрозионного» fBm
          nd(X / N * p, Y / N * p, p, o * 29);
          dx += ND[1]; dy += ND[2];
          a += b * ND[0] / (1 + dx * dx + dy * dy);
          b *= 0.5; p *= 2;
        }
        la[id] = a; ldx[id] = dx; ldy[id] = dy;
        let mo = 0; amp = 1; p = 3;
        for (let o = 0; o < 3; o++) { nd(x / N * p, y / N * p, p, 191 + o * 17); mo += amp * ND[0]; amp *= 0.5; p *= 2; }
        lmo[id] = mo;
      }
    }

    // ---- 2. Полное разрешение: октавы 3..7 поверх апсемплированных низких ----
    const H = new Float32Array(N * N);
    const MO = new Float32Array(N * N), DT = new Float32Array(N * N);
    let hmin = 1e9, hmax = -1e9;
    for (let y = 0; y < N; y++) {
      const gy = y / LS;
      for (let x = 0; x < N; x++) {
        const gx = x / LS, id = (y << SHIFT) | x;
        const X = x + bilin(lwx, L, gx, gy), Y = y + bilin(lwy, L, gx, gy);
        let a = bilin(la, L, gx, gy), dx = bilin(ldx, L, gx, gy), dy = bilin(ldy, L, gx, gy);
        let b = 0.125, p = P0 * 8;
        let dtv = 0;
        for (let o = 3; o < 8; o++) {
          nd(X / N * p, Y / N * p, p, o * 29);
          if (o === 5) dtv = ND[0];               // гладкая деталь (ячейка 8 текселей) для окраски
          dx += ND[1]; dy += ND[2];
          a += b * ND[0] / (1 + dx * dx + dy * dy);
          b *= 0.5; p *= 2;
        }
        H[id] = a; DT[id] = dtv;
        if (a < hmin) hmin = a; if (a > hmax) hmax = a;
        MO[id] = bilin(lmo, L, gx, gy);
      }
    }

    // ---- 3. Формовка высот ----
    // нормировка по 99.7-му перцентилю (редкие выбросы не становятся шпилями) + мягкий
    // «потолок» — скруглённые вершины; степень 1.3 — плоские долины без игольчатых пиков
    const inv = 1 / (hmax - hmin);
    const hs = [];
    for (let i = 0; i < N * N; i += 61) hs.push((H[i] - hmin) * inv);
    hs.sort((p, q) => p - q);
    const hiN = 1 / hs[(hs.length * 0.997) | 0];
    for (let i = 0; i < N * N; i++) {
      let t = (H[i] - hmin) * inv * hiN;
      if (t > 0.78) t = 0.78 + 0.22 * (1 - Math.exp(-(t - 0.78) / 0.22));
      H[i] = Math.pow(t, 1.3);
    }
    // массивность: на высоте рельеф подтягивается к сильно размытому — узкие шпили оседают,
    // подножия крупных вершин приподнимаются (шире основания); низины и озёра почти не трогаем
    const HB = boxBlur(H, N, 12, 2);
    let hTopAll = 1e-6;
    for (let i = 0; i < N * N; i++) {
      const hv = H[i], bv = HB[i];
      const k = smooth(0.18, 0.62, hv > bv ? hv : bv) * 0.5;
      const v = hv + (bv - hv) * k;
      H[i] = v; if (v > hTopAll) hTopAll = v;
    }
    const kH = HMAX / hTopAll;
    for (let i = 0; i < N * N; i++) H[i] *= kH;
    // уровень воды — перцентиль высот (стабильно при любом сиде)
    const sample = [];
    for (let i = 0; i < N * N; i += 97) sample.push(H[i]);
    sample.sort((p, q) => p - q);
    const WL = sample[(sample.length * 0.2) | 0];
    const HTOP = sample[sample.length - 1];

    const HS = new Float32Array(N * N);          // поверхность (вода плоская)
    for (let i = 0; i < N * N; i++) HS[i] = H[i] < WL ? WL : H[i];

    // ---- 4. Тени от солнца: развёртка вдоль +x (солнце со стороны -x) ----
    const SHD = new Float32Array(N * N);
    const tanE = Math.tan(SUN_ELEV);
    for (let y = 0; y < N; y++) {
      const row = y << SHIFT;
      let sh = -1e9;
      for (let k = 0; k < 2 * N; k++) {
        const id = row | (k & MASK), h = HS[id];
        sh -= tanE;
        if (k >= N) SHD[id] = 1 - smooth(0, 7, sh - h);
        if (h > sh) sh = h;
      }
    }
    const SHB = boxBlur(SHD, N, 1, 1);           // лёгкая полутень

    // ---- 5. AO по «впадинности»: разница с размытым рельефом ----
    const BL = boxBlur(HS, N, 9, 2);

    // ---- 6. Карта цвета ----
    const r0 = new Uint8Array(N * N), g0 = new Uint8Array(N * N), b0 = new Uint8Array(N * N);
    const w0 = new Uint8Array(N * N);
    const snowLine = 0.62, landSpan = 1 / (HTOP - WL);
    const Lx = SUN.x, Lz = SUN.z;
    for (let y = 0; y < N; y++) {
      const ym = ((y - 1) & MASK) << SHIFT, yp = ((y + 1) & MASK) << SHIFT, row = y << SHIFT;
      for (let x = 0; x < N; x++) {
        const id = row | x;
        const hx = HS[row | ((x + 1) & MASK)] - HS[row | ((x - 1) & MASK)];
        const hy = HS[yp | x] - HS[ym | x];
        let nx = -hx * 0.5, ny = -hy * 0.5, nz = 1;
        const nl = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        nx *= nl; ny *= nl; nz *= nl;
        const slope = 1 - nz;
        const jit = (PERM[PERM[x & 255] + (y & 255)] / 255 - 0.5);          // белый шум
        const jit2 = DT[id] * 1.1;                                          // гладкий шум
        const h = H[id], mo = MO[id] * 0.9 + 0.5 + jit2 * 0.08;
        const sh = SHB[id];
        let cr, cg, cb;
        if (h < WL) {
          const depth = WL - h;
          const dd = smooth(0, 22, depth);
          cr = 0.20 + (0.04 - 0.20) * dd; cg = 0.46 + (0.15 - 0.46) * dd; cb = 0.47 + (0.29 - 0.47) * dd;
          const foam = 1 - smooth(0, 1.4, depth);
          cr += (0.72 - cr) * foam * 0.6; cg += (0.80 - cg) * foam * 0.6; cb += (0.78 - cb) * foam * 0.6;
          const lit = 0.62 + 0.38 * sh;
          cr *= lit; cg *= lit; cb *= lit;
          w0[id] = (255 * smooth(0.0, 2.0, depth)) | 0;
        } else {
          const hn = (h - WL) * landSpan;
          // растительность: сухая трава -> сочная трава -> лес
          const lush = smooth(0.25, 0.75, mo);
          cr = 0.58 + (0.27 - 0.58) * lush; cg = 0.55 + (0.46 - 0.55) * lush; cb = 0.27 + (0.15 - 0.27) * lush;
          const forest = smooth(0.48, 0.62, mo + jit * 0.12) * (1 - smooth(0.32, 0.5, hn + jit * 0.05)) * (1 - smooth(0.3, 0.5, slope));
          const fshade = 0.8 + jit * 0.5;
          cr += (0.12 * fshade - cr) * forest; cg += (0.27 * fshade - cg) * forest; cb += (0.10 * fshade - cb) * forest;
          // скалы: крутизна + высота; слоистость по высоте
          const strata = 0.5 + 0.5 * Math.sin(h * 0.085 + jit2 * 3.0 + mo * 2);
          const rr = 0.41 + 0.08 * strata, rg = 0.38 + 0.055 * strata, rb = 0.355 + 0.03 * strata;
          const rock = Math.min(1, smooth(0.28, 0.5, slope + jit2 * 0.08) + smooth(0.5, 0.78, hn) * 0.7);
          cr += (rr - cr) * rock; cg += (rg - cg) * rock; cb += (rb - cb) * rock;
          // пляж у кромки воды
          const sand = (1 - smooth(0.012, 0.03, hn + jit * 0.01)) * (1 - smooth(0.25, 0.5, slope));
          cr += (0.78 - cr) * sand; cg += (0.71 - cg) * sand; cb += (0.52 - cb) * sand;
          // снег: выше снеговой линии и на пологих участках
          const snow = smooth(snowLine - 0.05, snowLine + 0.05, hn + jit2 * 0.12 + (mo - 0.5) * 0.08) * (1 - smooth(0.42, 0.62, slope));
          cr += (0.95 - cr) * snow; cg += (0.96 - cg) * snow; cb += (0.99 - cb) * snow;
          // освещение: солнце (Ламберт × тень) + небо (полусфера × AO)
          const diff = Math.max(0, nx * Lx + nz * Lz) * sh;
          const cav = BL[id] - HS[id];
          const ao = Math.max(0.5, Math.min(1.12, 1 - cav * 0.02));
          const sky = (0.5 + 0.5 * nz) * ao;
          const lr = 1.25 * diff + 0.46 * sky, lg = 1.14 * diff + 0.53 * sky, lb = 0.96 * diff + 0.66 * sky;
          cr *= lr; cg *= lg; cb *= lb;
        }
        r0[id] = cr >= 1 ? 255 : (cr * 255) | 0;
        g0[id] = cg >= 1 ? 255 : (cg * 255) | 0;
        b0[id] = cb >= 1 ? 255 : (cb * 255) | 0;
      }
    }

    // ---- 7. Мип-уровни (усреднение 2×2) для дальних выборок без мерцания ----
    const levels = [{ size: N, shift: SHIFT, mask: MASK, h: HS, r: r0, g: g0, b: b0, w: w0 }];
    for (let l = 1; l < 6; l++) {
      const p = levels[l - 1], s = p.size >> 1, ps = p.size;
      const h = new Float32Array(s * s), r = new Uint8Array(s * s), g = new Uint8Array(s * s), b = new Uint8Array(s * s), w = new Uint8Array(s * s);
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const a = (2 * y) * ps + 2 * x, c = a + ps, d = y * s + x;
          h[d] = (p.h[a] + p.h[a + 1] + p.h[c] + p.h[c + 1]) * 0.25;
          r[d] = (p.r[a] + p.r[a + 1] + p.r[c] + p.r[c + 1] + 2) >> 2;
          g[d] = (p.g[a] + p.g[a + 1] + p.g[c] + p.g[c + 1] + 2) >> 2;
          b[d] = (p.b[a] + p.b[a + 1] + p.b[c] + p.b[c + 1] + 2) >> 2;
          w[d] = (p.w[a] + p.w[a + 1] + p.w[c] + p.w[c + 1] + 2) >> 2;
        }
      }
      levels.push({ size: s, shift: SHIFT - l, mask: s - 1, h: h, r: r, g: g, b: b, w: w });
    }

    // ---- 8. Облачный слой 256² (плотность + подсветка со стороны солнца) ----
    const C = 256, ca = new Float32Array(C * C);
    const cover = 0.1 + R() * 0.12;
    for (let j = 0; j < C; j++) {
      for (let i = 0; i < C; i++) {
        let s = 0, amp = 1, p = 4;
        for (let o = 0; o < 5; o++) { nd(i / C * p, j / C * p, p, 211 + o * 5); s += amp * ND[0]; amp *= 0.5; p *= 2; }
        nd(i / C * 2, j / C * 2, 2, 233);
        s += ND[0] * 0.35;
        ca[j * C + i] = smooth(cover, cover + 0.42, s);
      }
    }
    const cA = new Uint8Array(C * C), cL = new Uint8Array(C * C);
    for (let j = 0; j < C; j++) {
      for (let i = 0; i < C; i++) {
        const d = ca[j * C + i];
        const toward = ca[j * C + ((i - 3) & (C - 1))];     // солнце со стороны -x
        cA[j * C + i] = (d * 255) | 0;
        const lit = Math.max(0, Math.min(1, 0.62 + (d - toward) * 1.6 - d * 0.28));
        cL[j * C + i] = (lit * 255) | 0;
      }
    }

    // ---- 9. Миникарта 256² (уровень 2) ----
    const lv = levels[2], MS = lv.size, mini = new Uint8ClampedArray(MS * MS * 4);
    for (let i = 0; i < MS * MS; i++) {
      mini[i * 4] = lv.r[i]; mini[i * 4 + 1] = lv.g[i]; mini[i * 4 + 2] = lv.b[i]; mini[i * 4 + 3] = 255;
    }

    return {
      N: N, levels: levels, wl: WL, hmax: HTOP, sun: SUN,
      cloud: { size: C, a: cA, l: cL },
      mini: mini, miniSize: MS, seed: seed,
      genMs: performance.now() - t0
    };
  }

  const api = { generate: generate, N: N };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoxelTerrain = api;
})(typeof window !== 'undefined' ? window : this);
