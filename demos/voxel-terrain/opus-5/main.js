/* Voxel terrain (VoxelSpace / Comanche style) -- pure Canvas 2D, no libraries.
   Claude Opus 5. All UI strings live in index.html, this file stays ASCII. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  Constants
   * ------------------------------------------------------------------ */
  var MAP_BITS = 10;
  var MAP_N = 1 << MAP_BITS;          /* 1024 x 1024 wrapping world */
  var MAP_MASK = MAP_N - 1;
  var MAX_LOD = 5;                    /* mip levels 0..5 -> 1024..32 */
  var WATER = 58;                     /* sea level, world units */
  var BIG = 1 << 20;                  /* keeps ray coords positive (mult. of MAP_N) */

  /* pixel byte order of ImageData */
  var LE = (function () {
    var buf = new ArrayBuffer(4);
    new Uint32Array(buf)[0] = 1;
    return new Uint8Array(buf)[0] === 1;
  })();
  var RS = LE ? 0 : 24, GS = LE ? 8 : 16, BS = LE ? 16 : 8;
  var AM = LE ? 0xff000000 : 0x000000ff;

  function pack(r, g, b) {
    return (((r & 255) << RS) | ((g & 255) << GS) | ((b & 255) << BS) | AM) >>> 0;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth01(t) { return t <= 0 ? 0 : (t >= 1 ? 1 : t * t * (3 - 2 * t)); }

  /* ------------------------------------------------------------------ *
   *  Seeded PRNG + periodic value noise
   * ------------------------------------------------------------------ */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* A stack of square lattices whose size equals the octave frequency, so
     every octave wraps exactly over the map -> the world tiles seamlessly. */
  function makeStack(seed, freqs) {
    var rnd = mulberry32(seed), lat = [], i, f, k, a;
    for (i = 0; i < freqs.length; i++) {
      f = freqs[i];
      a = new Float32Array(f * f);
      for (k = 0; k < a.length; k++) a[k] = rnd();
      lat.push(a);
    }
    return { f: freqs, lat: lat };
  }

  /* u, v are normalized map coords; may be slightly out of [0,1) (warping). */
  function octave(stack, oi, u, v) {
    var f = stack.f[oi], a = stack.lat[oi], m = f - 1;
    var x = u * f, y = v * f;
    var xi = Math.floor(x), yi = Math.floor(y);
    var tx = x - xi, ty = y - yi;
    var x0 = xi & m, y0 = yi & m, x1 = (xi + 1) & m, y1 = (yi + 1) & m;
    var sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    var r0 = y0 * f, r1 = y1 * f;
    var t0 = a[r0 + x0], t1 = a[r0 + x1];
    var b0 = a[r1 + x0], b1 = a[r1 + x1];
    var top = t0 + (t1 - t0) * sx;
    return top + ((b0 + (b1 - b0) * sx) - top) * sy;
  }

  /* fractal sum, result in 0..1 */
  function fbm(stack, u, v, oct, gain, from) {
    var sum = 0, amp = 1, norm = 0, i;
    from = from || 0;
    for (i = 0; i < oct; i++) {
      sum += octave(stack, from + i, u, v) * amp;
      norm += amp;
      amp *= gain;
    }
    return sum / norm;
  }

  /* ridged fractal sum, result in 0..1 (sharp crests) */
  function ridged(stack, u, v, oct, gain, from) {
    var sum = 0, amp = 1, norm = 0, i, n;
    from = from || 0;
    for (i = 0; i < oct; i++) {
      n = 1 - Math.abs(octave(stack, from + i, u, v) * 2 - 1);
      sum += n * n * amp;
      norm += amp;
      amp *= gain;
    }
    return sum / norm;
  }

  var FREQS = [2, 4, 8, 16, 32, 64, 128, 256, 512];

  var SEED = 20260816;
  var stBase = makeStack(SEED, FREQS);        /* continents */
  var stRidge = makeStack(SEED + 977, FREQS); /* mountain crests */
  var stWarp = makeStack(SEED + 4231, FREQS); /* domain warp */
  var stMoist = makeStack(SEED + 8819, FREQS);/* biome moisture */
  var stGrain = makeStack(SEED + 1553, FREQS);/* fine colour grain */

  /* ------------------------------------------------------------------ *
   *  World data
   * ------------------------------------------------------------------ */
  var heightMip = [], colorMip = [], mipSize = [], mipMask = [];
  var h0 = new Uint8Array(MAP_N * MAP_N);   /* terrain height, sea clamped flat */
  var d0 = new Uint8Array(MAP_N * MAP_N);   /* water depth, 0 = dry land */
  var c0 = new Uint32Array(MAP_N * MAP_N);  /* shaded colour map */
  var shade = null;

  function genHeightRows(y0, y1) {
    var inv = 1 / MAP_N, x, y, i, d, u, v, wu, wv, cont, mnt, det, e, hgt;
    for (y = y0; y < y1; y++) {
      v = y * inv;
      for (x = 0; x < MAP_N; x++) {
        u = x * inv;
        /* domain warp keeps shapes from looking like grid noise */
        wu = u + (octave(stWarp, 1, u, v) - 0.5) * 0.22 + (octave(stWarp, 3, u, v) - 0.5) * 0.06;
        wv = v + (octave(stWarp, 2, u, v) - 0.5) * 0.22 + (octave(stWarp, 4, u, v) - 0.5) * 0.06;

        cont = fbm(stBase, wu, wv, 5, 0.5, 0);          /* 0..1 large forms */
        cont = smooth01((cont - 0.20) * 1.95);
        mnt = ridged(stRidge, wu, wv, 6, 0.52, 1);      /* crests */
        det = fbm(stBase, u, v, 4, 0.5, 4) - 0.5;       /* small bumps */

        e = cont * 0.72 + mnt * mnt * cont * 0.92 + det * 0.07;
        e = clamp(e, 0, 1);
        hgt = Math.pow(e, 1.06) * 250;
        i = y * MAP_N + x;
        if (hgt < WATER) {
          d = (WATER - hgt) / 30;
          d0[i] = (smooth01(d) * 255) | 0;
          h0[i] = WATER;                 /* flat sea surface */
        } else {
          d0[i] = 0;
          h0[i] = hgt > 255 ? 255 : hgt | 0;
        }
      }
    }
  }

  /* One binomial pass: rounds off single-texel needles on the crests while
     keeping the large forms. Sea stays flat. */
  function blurHeight() {
    var tmp = new Uint8Array(MAP_N * MAP_N);
    var x, y, row, ym, yp, xm, xp, v;
    tmp.set(h0);
    for (y = 0; y < MAP_N; y++) {
      row = y * MAP_N;
      ym = ((y - 1) & MAP_MASK) * MAP_N;
      yp = ((y + 1) & MAP_MASK) * MAP_N;
      for (x = 0; x < MAP_N; x++) {
        xm = (x - 1) & MAP_MASK; xp = (x + 1) & MAP_MASK;
        v = (tmp[ym + xm] + 2 * tmp[ym + x] + tmp[ym + xp] +
             2 * tmp[row + xm] + 4 * tmp[row + x] + 2 * tmp[row + xp] +
             tmp[yp + xm] + 2 * tmp[yp + x] + tmp[yp + xp] + 8) >> 4;
        h0[row + x] = d0[row + x] > 0 ? WATER : (v < WATER ? WATER : v);
      }
    }
  }

  /* Cheap propagated sun shadows: light comes from (-x,-y) at ~30 degrees.
     Two passes let the wrap seam settle. */
  function genShadow() {
    var K = 0.55, x, y, i, prev, cur, pass;
    shade = new Float32Array(MAP_N * MAP_N);
    for (i = 0; i < shade.length; i++) shade[i] = h0[i];
    for (pass = 0; pass < 2; pass++) {
      for (y = 0; y < MAP_N; y++) {
        for (x = 0; x < MAP_N; x++) {
          i = y * MAP_N + x;
          prev = 0.5 * (shade[y * MAP_N + ((x - 1) & MAP_MASK)] +
                        shade[((y - 1) & MAP_MASK) * MAP_N + x]) - K;
          cur = h0[i];
          shade[i] = prev > cur ? prev : cur;
        }
      }
    }
  }


  /* Bakes elevation/moisture/slope palette + sun shading into the colour map. */
  function genColorRows(y0, y1) {
    var inv = 1 / MAP_N;
    var LX = -0.62, LY = -0.62, LZ = 0.482;
    var x, y, i, u, v, h, hl, hr, hu, hd, dx, dy, ilen, ndl, slope;
    var e, m, gr, st, t, r, g, b, dd, dir, sh, sf, w;
    for (y = y0; y < y1; y++) {
      v = y * inv;
      for (x = 0; x < MAP_N; x++) {
        u = x * inv;
        i = y * MAP_N + x;
        h = h0[i];
        hl = h0[y * MAP_N + ((x - 1) & MAP_MASK)];
        hr = h0[y * MAP_N + ((x + 1) & MAP_MASK)];
        hu = h0[((y - 1) & MAP_MASK) * MAP_N + x];
        hd = h0[((y + 1) & MAP_MASK) * MAP_N + x];
        dx = (hr - hl) * 0.5;
        dy = (hd - hu) * 0.5;
        slope = Math.sqrt(dx * dx + dy * dy);
        ilen = 1 / Math.sqrt(dx * dx + dy * dy + 1);
        ndl = (-dx * LX - dy * LY + LZ) * ilen;
        if (ndl < 0) ndl = 0;

        gr = octave(stGrain, 6, u, v) - 0.5;

        if (d0[i] > 0) {
          /* ---- water: flat surface, colour by depth, no terrain shading ---- */
          dd = d0[i] / 255;
          w = (octave(stGrain, 5, u, v) - 0.5) * 0.5 + gr * 0.5;
          r = lerp(96, 20, dd) + w * 12;
          g = lerp(168, 62, dd) + w * 14;
          b = lerp(172, 104, dd) + w * 16;
          /* shoreline foam */
          t = 1 - smooth01(dd * 7);
          r += t * 52; g += t * 56; b += t * 52;
        } else {
          /* ---- land palette ---- */
          e = (h - WATER) / (255 - WATER);
          m = fbm(stMoist, u, v, 4, 0.5, 2);
          st = clamp(slope * 0.85, 0, 1);

          /* sand -> grass -> forest -> rock -> snow */
          r = 202 + gr * 16; g = 186 + gr * 14; b = 138 + gr * 12;   /* sand */
          t = smooth01((e - 0.012) / 0.05);
          r = lerp(r, lerp(126, 62, m) + gr * 14, t);
          g = lerp(g, lerp(132, 116, m) + gr * 14, t);
          b = lerp(b, lerp(76, 62, m) + gr * 10, t);
          t = smooth01((e - 0.08) / 0.24) * (0.45 + 0.55 * m);
          r = lerp(r, 54 + gr * 10, t);
          g = lerp(g, 88 + gr * 12, t);
          b = lerp(b, 58 + gr * 10, t);
          t = smooth01((e - 0.58) / 0.24);
          r = lerp(r, 124 + gr * 18, t);
          g = lerp(g, 118 + gr * 18, t);
          b = lerp(b, 108 + gr * 16, t);
          t = smooth01((st - 0.52) / 0.36) * 0.80;                    /* cliffs */
          r = lerp(r, 118 + gr * 20, t);
          g = lerp(g, 111 + gr * 20, t);
          b = lerp(b, 101 + gr * 18, t);
          t = smooth01((e - (0.70 + gr * 0.16)) / 0.15) * (1 - smooth01((st - 0.46) / 0.46));
          r = lerp(r, 222, t); g = lerp(g, 229, t); b = lerp(b, 238, t);

          /* ---- lighting: warm sun + blue sky ambient + cast shadows ---- */
          sh = shade[i] - h;
          sf = 1 - smooth01(sh / 2.4) * 0.74;
          dir = ndl * sf;
          r *= 0.430 + dir * 0.80;
          g *= 0.462 + dir * 0.76;
          b *= 0.530 + dir * 0.62;
        }
        c0[i] = pack(
          r < 0 ? 0 : (r > 255 ? 255 : r),
          g < 0 ? 0 : (g > 255 ? 255 : g),
          b < 0 ? 0 : (b > 255 ? 255 : b));
      }
    }
  }

  /* Mip pyramid: kills shimmering and stair-stepping in the distance. */
  function buildMips() {
    var l, n, pn, x, y, i, j, ph, pc, hh, cc, c00, c10, c01, c11;
    heightMip[0] = h0; colorMip[0] = c0;
    mipSize[0] = MAP_N; mipMask[0] = MAP_MASK;
    for (l = 1; l <= MAX_LOD; l++) {
      pn = MAP_N >> (l - 1);
      n = MAP_N >> l;
      ph = heightMip[l - 1]; pc = colorMip[l - 1];
      hh = new Uint8Array(n * n);
      cc = new Uint32Array(n * n);
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++) {
          i = y * n + x;
          j = (y << 1) * pn + (x << 1);
          hh[i] = (ph[j] + ph[j + 1] + ph[j + pn] + ph[j + pn + 1] + 2) >> 2;
          c00 = pc[j]; c10 = pc[j + 1]; c01 = pc[j + pn]; c11 = pc[j + pn + 1];
          cc[i] = pack(
            (((c00 >>> RS) & 255) + ((c10 >>> RS) & 255) + ((c01 >>> RS) & 255) + ((c11 >>> RS) & 255)) >> 2,
            (((c00 >>> GS) & 255) + ((c10 >>> GS) & 255) + ((c01 >>> GS) & 255) + ((c11 >>> GS) & 255)) >> 2,
            (((c00 >>> BS) & 255) + ((c10 >>> BS) & 255) + ((c01 >>> BS) & 255) + ((c11 >>> BS) & 255)) >> 2);
        }
      }
      heightMip[l] = hh; colorMip[l] = cc;
      mipSize[l] = n; mipMask[l] = n - 1;
    }
  }

  /* bilinear height, used to keep the camera above the ground */
  function heightAt(wx, wy) {
    var x = wx + BIG, y = wy + BIG;
    var xi = x | 0, yi = y | 0;
    var tx = x - xi, ty = y - yi;
    var x0 = xi & MAP_MASK, y0 = yi & MAP_MASK;
    var x1 = (xi + 1) & MAP_MASK, y1 = (yi + 1) & MAP_MASK;
    var r0 = y0 * MAP_N, r1 = y1 * MAP_N;
    var a = h0[r0 + x0] + (h0[r0 + x1] - h0[r0 + x0]) * tx;
    var b = h0[r1 + x0] + (h0[r1 + x1] - h0[r1 + x0]) * tx;
    return a + (b - a) * ty;
  }

  /* ------------------------------------------------------------------ *
   *  Canvas / framebuffer
   * ------------------------------------------------------------------ */
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d', { alpha: false });
  var img = null, buf32 = null, bufW = 0, bufH = 0;
  var ybuf = null, fogR = null, fogG = null, fogB = null;

  var QSCALE = [0.45, 0.62, 0.85];
  var qIndex = 1;
  var MAX_PIX = 820000;
  var LOG2E = 1.4426950408889634;
  var LOD_BIAS = 0.62;

  function resize() {
    var cw = window.innerWidth || 640, ch = window.innerHeight || 400;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var s = QSCALE[qIndex] * dpr;
    /* every cap is applied as a uniform scale, so the aspect never distorts */
    var w = cw * s, h = ch * s, k;
    if (w * h > MAX_PIX) { k = Math.sqrt(MAX_PIX / (w * h)); w *= k; h *= k; }
    if (w > 1440) { k = 1440 / w; w *= k; h *= k; }
    if (h > 1000) { k = 1000 / h; w *= k; h *= k; }
    w = Math.max(200, Math.round(w));
    h = Math.max(140, Math.round(h));
    if (w === bufW && h === bufH) return;
    bufW = w; bufH = h;
    canvas.width = w; canvas.height = h;
    img = ctx.createImageData(w, h);
    buf32 = new Uint32Array(img.data.buffer);
    ybuf = new Int32Array(w);
    fogR = new Float32Array(w);
    fogG = new Float32Array(w);
    fogB = new Float32Array(w);
  }

  /* ------------------------------------------------------------------ *
   *  Sky panorama (built once; vertical axis is a fraction of screen
   *  height above the horizon, so it matches any resolution)
   * ------------------------------------------------------------------ */
  var PAN_BITS = 11, PAN_W = 1 << PAN_BITS, PAN_MASK = PAN_W - 1;
  var PAN_H = 640;
  var pan = new Uint32Array(PAN_W * PAN_H);
  var SUNX = PAN_W * 0.5;
  var SUN_AZ = Math.atan2(-0.62, -0.62);   /* matches the baked light dir */

  function buildSkyRows(y0, y1) {
    var sunRow = (PAN_H - 1) - 0.27 * PAN_H;
    var discR = PAN_H * 0.020;
    var g1r2 = (PAN_H * 0.062) * (PAN_H * 0.062);
    var g2r2 = (PAN_H * 0.24) * (PAN_H * 0.24);
    var y, x, a, t, q, r, g, b, r2, g2, b2, dx, dy, d2, m, u, v, n, band, cl, row;
    for (y = y0; y < y1; y++) {
      a = (PAN_H - 1 - y) / (PAN_H - 1);          /* 0 at horizon, 1 at top */
      if (a < 0.30) {
        t = smooth01(a / 0.30);
        r = lerp(202, 126, t); g = lerp(216, 166, t); b = lerp(228, 213, t);
      } else {
        t = smooth01((a - 0.30) / 0.70);
        r = lerp(126, 32, t); g = lerp(166, 84, t); b = lerp(213, 166, t);
      }
      v = y / PAN_H * 0.30;
      band = smooth01((a - 0.05) / 0.22) * (1 - smooth01((a - 0.52) / 0.48));
      row = y * PAN_W;
      for (x = 0; x < PAN_W; x++) {
        u = x / PAN_W;
        /* soft cloud banding */
        if (band > 0.004) {
          q = (octave(stWarp, 2, u, v) - 0.5) * 0.09;
          n = octave(stWarp, 3, u + q, v) * 0.48 + octave(stWarp, 5, u + q, v) * 0.33 +
              octave(stWarp, 6, u + q, v) * 0.19;
          cl = smooth01((n - 0.48) / 0.36) * band * 0.60;
        } else cl = 0;
        /* sun glow, wrapping in x */
        dx = x - SUNX;
        if (dx > PAN_W * 0.5) dx -= PAN_W; else if (dx < -PAN_W * 0.5) dx += PAN_W;
        dy = (y - sunRow) * 1.05;
        d2 = dx * dx * 0.90 + dy * dy;
        q = Math.sqrt(d2);
        m = 1 - smooth01((q - discR) / (discR * 0.6));      /* crisp disc */
        t = 1 / (1 + d2 / g1r2); m += t * t * 0.78;         /* tight glow */
        t = 1 / (1 + d2 / g2r2); m += t * 0.24;             /* wide halo */
        if (m > 1) m = 1;
        r2 = r + (250 - r) * cl + (255 - r) * m;
        g2 = g + (250 - g) * cl + (243 - g) * m;
        b2 = b + (252 - b) * cl + (214 - b) * m;
        pan[row + x] = pack(
          r2 > 255 ? 255 : r2, g2 > 255 ? 255 : g2, b2 > 255 ? 255 : b2);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  Camera
   * ------------------------------------------------------------------ */
  var cam = { x: 380.5, y: 190.5, phi: -2.1, h: 120 };
  var opt = { height: 72, dist: 900, horizon: 0.46, speed: 110 };
  var paused = false;
  var wtime = 0;

  function updateCamera(dt) {
    wtime += dt;
    /* lazy S-curve flight path */
    cam.phi = SUN_AZ + 1.62 +
              0.62 * Math.sin(wtime * 0.043) +
              0.26 * Math.sin(wtime * 0.017 + 1.9) +
              0.07 * Math.sin(wtime * 0.11 + 0.4);
    var cx = Math.cos(cam.phi), cy = Math.sin(cam.phi);
    var v = opt.speed * dt;
    cam.x += cx * v;
    cam.y += cy * v;
    /* wrap into the map -- the world repeats, the flight never ends */
    cam.x = ((cam.x % MAP_N) + MAP_N) % MAP_N;
    cam.y = ((cam.y % MAP_N) + MAP_N) % MAP_N;

    /* terrain following: look ahead so the camera climbs before the ridge */
    var ground = heightAt(cam.x, cam.y);
    var a1 = heightAt(cam.x + cx * 60, cam.y + cy * 60);
    var a2 = heightAt(cam.x + cx * 150, cam.y + cy * 150) * 0.92 + ground * 0.08;
    var a3 = heightAt(cam.x + cx * 260, cam.y + cy * 260) * 0.80 + ground * 0.20;
    var ahead = Math.max(ground, a1, a2, a3);
    var target = ahead + opt.height + Math.sin(wtime * 0.55) * 2.4;
    cam.h += (target - cam.h) * (1 - Math.exp(-dt * (target > cam.h ? 3.0 : 1.1)));
    if (cam.h < ground + 12) cam.h = ground + 12;   /* never sink into rock */
  }

  /* ------------------------------------------------------------------ *
   *  Frame rendering
   * ------------------------------------------------------------------ */
  function render() {
    var w = bufW, h = bufH;
    var scaleH = h * 0.92;                       /* focal length, px */
    var horizonY = (h * opt.horizon) | 0;
    if (horizonY < 3) horizonY = 3;
    if (horizonY > h - 3) horizonY = h - 3;

    var panOff = ((SUNX - w * 0.5 + (cam.phi - SUN_AZ) * scaleH) | 0) & PAN_MASK;
    var invH = PAN_H / h;
    var x, y, d = 0, base, s, n, rem, off, p, k, sr, tt, col;

    /* ---- sky: copy the panorama row by row ---- */
    for (y = 0; y < horizonY; y++) {
      sr = (PAN_H - 1 - (((horizonY - y) * invH) | 0));
      if (sr < 0) sr = 0; else if (sr > PAN_H - 1) sr = PAN_H - 1;
      base = sr * PAN_W;
      s = panOff;
      n = PAN_W - s;
      if (n >= w) {
        buf32.set(pan.subarray(base + s, base + s + w), d);
      } else {
        buf32.set(pan.subarray(base + s, base + PAN_W), d);
        off = d + n; rem = w - n; p = base;
        while (rem > 0) {
          k = rem < PAN_W ? rem : PAN_W;
          buf32.set(pan.subarray(p, p + k), off);
          off += k; rem -= k;
        }
      }
      d += w;
    }

    /* ---- haze below the horizon (visible only past the far plane) ---- */
    var hc = pan[(PAN_H - 1) * PAN_W + ((panOff + (w >> 1)) & PAN_MASK)];
    var hcr = (hc >>> RS) & 255, hcg = (hc >>> GS) & 255, hcb = (hc >>> BS) & 255;
    var below = h - horizonY;
    for (y = horizonY; y < h; y++) {
      tt = smooth01((y - horizonY) / (below > 1 ? below : 1) * 1.2) * 0.17;
      col = pack(lerp(hcr, 104, tt), lerp(hcg, 116, tt), lerp(hcb, 128, tt));
      buf32.fill(col, y * w, y * w + w);
    }

    /* ---- per-column fog colour = sky colour right at the horizon ---- */
    var fbase = (PAN_H - 1) * PAN_W, c;
    for (x = 0; x < w; x++) {
      c = pan[fbase + ((panOff + x) & PAN_MASK)];
      fogR[x] = (c >>> RS) & 255;
      fogG[x] = (c >>> GS) & 255;
      fogB[x] = (c >>> BS) & 255;
    }

    /* ---- terrain: front to back with a y-buffer ---- */
    for (x = 0; x < w; x++) ybuf[x] = h;
    var camX = cam.x, camY = cam.y, camH = cam.h;
    var sinp = Math.sin(cam.phi), cosp = Math.cos(cam.phi);
    var invS = 1 / scaleH, halfW = w * 0.5;
    var maxZ = opt.dist, invMaxZ = 1 / maxZ;
    var z = 1.1, dz = 0.30, done = 0;
    var lod, hm, cm, ms, mk, msc, ft, fz, ramp, stepX, stepY, px, py, zs;
    var yb, mi, hs, yF, yc, cc, cr, cg, cb, fr2, fg2, fb2, col2, ys, idx, yy;
    var pr, cov, dc, dr, dg, db;

    while (z < maxZ && done < w) {
      /* mip level for this distance ring: no shimmer, no stair-steps */
      lod = Math.log(z * invS * LOD_BIAS + 1e-6) * LOG2E;
      lod = lod < 0 ? 0 : (lod > MAX_LOD ? MAX_LOD : lod | 0);
      hm = heightMip[lod]; cm = colorMip[lod];
      ms = mipSize[lod]; mk = mipMask[lod]; msc = 1 / (1 << lod);

      /* exponential-squared fog + forced convergence at the far plane */
      fz = z * invMaxZ;
      ft = 1 - Math.exp(-2.15 * fz * fz);
      ramp = smooth01((fz - 0.70) / 0.30);
      ft = ft + (1 - ft) * ramp;

      stepX = -sinp * z * invS; stepY = cosp * z * invS;
      px = camX + cosp * z - stepX * halfW + BIG;
      py = camY + sinp * z - stepY * halfW + BIG;
      zs = scaleH / z;

      for (x = 0; x < w; x++) {
        yb = ybuf[x];
        if (yb > 0) {
          mi = (((py * msc) | 0) & mk) * ms + (((px * msc) | 0) & mk);
          hs = hm[mi];
          yF = (camH - hs) * zs + horizonY;
          yc = yF | 0; if (yc < yF) yc++;          /* ceil, also for negatives */
          if (yc < yb) {
            cc = cm[mi];
            cr = (cc >>> RS) & 255; cg = (cc >>> GS) & 255; cb = (cc >>> BS) & 255;
            fr2 = cr + (fogR[x] - cr) * ft;
            fg2 = cg + (fogG[x] - cg) * ft;
            fb2 = cb + (fogB[x] - cb) * ft;
            col2 = pack(fr2, fg2, fb2);
            ys = yc < 0 ? 0 : yc;
            idx = ys * w + x;
            for (yy = ys; yy < yb; yy++) { buf32[idx] = col2; idx += w; }
            /* antialias the silhouette against whatever lies behind it */
            pr = yc - 1;
            if (pr >= 0 && pr < yb) {
              cov = yc - yF;
              if (cov > 0.03) {
                idx = pr * w + x;
                dc = buf32[idx];
                dr = (dc >>> RS) & 255; dg = (dc >>> GS) & 255; db = (dc >>> BS) & 255;
                buf32[idx] = pack(dr + (fr2 - dr) * cov,
                                  dg + (fg2 - dg) * cov,
                                  db + (fb2 - db) * cov);
              }
            }
            if (yc <= 0) done++;
            ybuf[x] = yc;
          }
        }
        px += stepX; py += stepY;
      }
      z += dz; dz *= 1.0040;
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ------------------------------------------------------------------ *
   *  HUD + controls
   * ------------------------------------------------------------------ */
  var elFps = document.getElementById('fps');
  var elAlt = document.getElementById('alt');
  var elPos = document.getElementById('pos');
  var bQual = document.getElementById('bQuality');
  var bPause = document.getElementById('bPause');
  var qLabels = (bQual.getAttribute('data-labels') || 'a|b|c').split('|');
  var qPrefix = bQual.getAttribute('data-prefix') || '';

  function bindRange(id, outId, apply) {
    var el = document.getElementById(id), out = document.getElementById(outId);
    function upd() { apply(parseFloat(el.value)); out.textContent = el.value; }
    el.addEventListener('input', upd);
    upd();
  }

  function initUI() {
    bindRange('cHeight', 'vHeight', function (v) { opt.height = v; });
    bindRange('cDist', 'vDist', function (v) { opt.dist = v; });
    bindRange('cHorizon', 'vHorizon', function (v) { opt.horizon = v / 100; });
    bindRange('cSpeed', 'vSpeed', function (v) { opt.speed = v; });
    bQual.textContent = qPrefix + qLabels[qIndex];
    bQual.addEventListener('click', function () {
      qIndex = (qIndex + 1) % QSCALE.length;
      bQual.textContent = qPrefix + qLabels[qIndex];
      resize();
    });
    bPause.addEventListener('click', function () {
      paused = !paused;
      bPause.textContent = paused
        ? (bPause.getAttribute('data-play') || 'play')
        : (bPause.getAttribute('data-pause') || 'pause');
    });
  }

  /* ------------------------------------------------------------------ *
   *  Main loop
   * ------------------------------------------------------------------ */
  var last = 0, fpsAcc = 0, fpsN = 0, hudT = 0;

  function frame(now) {
    var dt = last ? (now - last) / 1000 : 0.0166;
    last = now;
    if (dt > 0.1) dt = 0.1;                 /* clamp after a tab switch */
    if (dt < 0) dt = 0;
    if (!paused) updateCamera(dt);
    render();

    fpsAcc += dt; fpsN++; hudT += dt;
    if (hudT > 0.25) {
      hudT = 0;
      if (fpsAcc > 0) elFps.textContent = Math.round(fpsN / fpsAcc);
      fpsAcc = 0; fpsN = 0;
      elAlt.textContent = Math.round(cam.h - heightAt(cam.x, cam.y));
      elPos.textContent = (cam.x | 0) + ' : ' + (cam.y | 0);
    }
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ *
   *  Boot: build the world in chunks so the loader keeps animating
   * ------------------------------------------------------------------ */
  var boot = document.getElementById('boot');
  var bootPct = document.getElementById('bootPct');
  var stage = 0, srow = 0;

  function bootStep() {
    var t0 = Date.now(), pct = 0;
    while (stage < 4) {
      if (stage === 0) {
        genHeightRows(srow, Math.min(srow + 24, MAP_N)); srow += 24;
        if (srow >= MAP_N) { stage = 1; srow = 0; }
      } else if (stage === 1) {
        blurHeight(); blurHeight(); genShadow(); stage = 2; srow = 0;
      } else if (stage === 2) {
        genColorRows(srow, Math.min(srow + 24, MAP_N)); srow += 24;
        if (srow >= MAP_N) { stage = 3; srow = 0; }
      } else {
        buildSkyRows(srow, Math.min(srow + 40, PAN_H)); srow += 40;
        if (srow >= PAN_H) { stage = 4; srow = 0; }
      }
      if (Date.now() - t0 > 24) break;
    }
    if (stage === 0) pct = srow / MAP_N * 42;
    else if (stage === 1) pct = 42;
    else if (stage === 2) pct = 48 + srow / MAP_N * 38;
    else if (stage === 3) pct = 86 + srow / PAN_H * 11;
    else pct = 97;
    bootPct.textContent = (pct | 0) + ' %';

    if (stage < 4) { requestAnimationFrame(bootStep); return; }
    buildMips();
    shade = null;
    bootPct.textContent = '100 %';
    start();
  }

  /* Opening shot: moderate land with strong relief around it. */
  function pickStart() {
    var best = -1e9, cell = MAP_N / 40, i, j, k, x, y, h, hh, hi, lo, s;
    for (j = 0; j < 40; j++) {
      for (i = 0; i < 40; i++) {
        x = (i + 0.5) * cell; y = (j + 0.5) * cell;
        h = h0[(y | 0) * MAP_N + (x | 0)];
        if (h <= WATER + 8) continue;
        hi = 0; lo = 255;
        for (k = 0; k < 8; k++) {
          hh = heightAt(x + Math.cos(k * 0.785) * 220, y + Math.sin(k * 0.785) * 220);
          if (hh > hi) hi = hh;
          if (hh < lo) lo = hh;
        }
        s = (hi - lo) * 0.85 - Math.abs(h - (WATER + 22)) * 1.5;
        if (s > best) { best = s; cam.x = x; cam.y = y; }
      }
    }
  }

  function start() {
    resize();
    window.addEventListener('resize', resize);
    pickStart();
    cam.h = heightAt(cam.x, cam.y) + opt.height;
    boot.classList.add('hidden');
    setTimeout(function () {
      if (boot && boot.parentNode) boot.parentNode.removeChild(boot);
    }, 700);
    requestAnimationFrame(frame);
  }

  initUI();
  requestAnimationFrame(bootStep);
})();
