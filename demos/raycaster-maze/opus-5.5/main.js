/* Рейкастер-лабиринт — псевдо-3D в духе Wolfenstein 3D.
   Canvas 2D + ImageData, без библиотек. Рейкастинг по сетке (DDA),
   перпендикулярная дистанция (без «рыбьего глаза»), текстуры генерируются
   процедурно, пол/потолок — построчный floor casting. */
(function () {
  'use strict';

  /* ======================= утилиты ======================= */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(x, y, s) {
    var h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // value noise с периодом p (в ячейках решётки) — для бесшовных текстур
  function vnoise(x, y, p, s) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var x0 = ((ix % p) + p) % p, y0 = ((iy % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    var a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
    var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  var TEX = 64, TS = TEX * TEX;

  function fbm(x, y, p, s) {
    var sum = 0, amp = 0.5, norm = 0, per = p;
    for (var o = 0; o < 4; o++) {
      sum += amp * vnoise(x * per / TEX, y * per / TEX, per, s + o * 131);
      norm += amp; amp *= 0.5; per *= 2;
    }
    return sum / norm;
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  function fmtTime(t) {
    var s = Math.floor(t), m = Math.floor(s / 60);
    s -= m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ======================= текстуры ======================= */
  var T_STONE = 1, T_BRICK = 2, T_BLUE = 3, T_WOOD = 4, T_MOSS = 5, T_EXIT = 6,
      F_TILE = 7, F_EXIT = 8, C_PANEL = 9, C_LAMP = 10, NTEX = 11;

  // тексель: r | g<<8 | b<<16 | emissive<<24  (emissive — «свечение», гасит туман)
  var texFull = new Uint32Array(NTEX * TS);
  var texFlat = new Uint32Array(NTEX * TS);
  var tex = texFull;

  function b8(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
  function packC(r, g, b, e) { return ((b8(e) << 24) | (b8(b) << 16) | (b8(g) << 8) | b8(r)) >>> 0; }
  function setT(id, x, y, r, g, b, e) { texFull[id * TS + (y << 6) + x] = packC(r, g, b, e || 0); }

  function makeRows(spec) {
    return spec.map(function (s) { return { h: s[0], off: s[1], w: s[2] }; });
  }
  function locate(rows, x, y) {
    var ri = 0, yy = y;
    while (yy >= rows[ri].h) { yy -= rows[ri].h; ri++; }
    var row = rows[ri], xx = (x + row.off) % TEX, bi = 0;
    while (xx >= row.w[bi]) { xx -= row.w[bi]; bi++; }
    return [ri, bi, xx, yy, row.w[bi], row.h];
  }

  // кладка: камень, кирпич, синий камень
  function masonry(id, rows, o) {
    for (var y = 0; y < TEX; y++) {
      for (var x = 0; x < TEX; x++) {
        var L = locate(rows, x, y), xx = L[2], yy = L[3], bw = L[4], bh = L[5];
        var n = fbm(x, y, 4, o.seed), g = hash2(x, y, o.seed + 7) - 0.5;
        var r, gg, b;
        if (xx < o.mw || yy < o.mw) {
          var k = 0.7 + 0.55 * n + g * 0.15;
          r = o.mortar[0] * k; gg = o.mortar[1] * k; b = o.mortar[2] * k;
        } else {
          var bid = L[0] * 16 + L[1];
          var h1 = hash2(bid, 3, o.seed), h2 = hash2(bid, 11, o.seed);
          var t = 1 + (h1 - 0.5) * o.vari + (n - 0.5) * o.noise + g * o.grain;
          if (o.cushion) {
            var ed = Math.min(xx - o.mw, bw - 1 - xx, yy - o.mw, bh - 1 - yy);
            t *= 0.86 + 0.14 * Math.min(1, ed / 4);
          }
          if (yy === o.mw || xx === o.mw) t *= 1.24;
          else if (yy === bh - 1 || xx === bw - 1) t *= 0.68;
          if (hash2(x, y, o.seed + 31) > 0.982) t *= 0.72;
          var hv = (h2 - 0.5) * o.hue;
          r = o.base[0] * t * (1 + hv); gg = o.base[1] * t; b = o.base[2] * t * (1 - hv);
        }
        if (o.post) { var pc = o.post(x, y, r, gg, b); r = pc[0]; gg = pc[1]; b = pc[2]; }
        setT(id, x, y, r, gg, b, 0);
      }
    }
  }

  // мох ползёт снизу пятнами; рельеф камня просвечивает сквозь него
  function mossPost(x, y, r, g, b) {
    var m = fbm(x, y, 8, 911) * 0.75 + fbm(x, y, 2, 915) * 0.35 + Math.pow(y / TEX, 1.5) * 0.45 - 0.37;
    if (m > 0.3) {
      var a = Math.min(1, (m - 0.3) * 3) * 0.85;
      var lum = (r + g + b) / 360;
      var v = (0.75 + hash2(x, y, 912) * 0.35) * (0.55 + 0.45 * lum);
      r = r * (1 - a) + 62 * v * a; g = g * (1 - a) + 108 * v * a; b = b * (1 - a) + 44 * v * a;
    }
    return [r, g, b];
  }

  // деревянная панель с рамой
  function makeWood(id) {
    for (var y = 0; y < TEX; y++) {
      for (var x = 0; x < TEX; x++) {
        var n = fbm(x, y, 4, 501), g = hash2(x, y, 502) - 0.5, t, r, gg, b;
        if (x < 4 || x > 59 || y < 4 || y > 59) {
          t = 0.66 + (n - 0.5) * 0.25 + g * 0.08;
          if (x === 0 || y === 0) t *= 1.35;
          else if (x === 63 || y === 63) t *= 0.55;
          else if ((x === 60 && y > 3 && y < 61) || (y === 60 && x > 3 && x < 61)) t *= 1.25;
          r = 104 * t; gg = 64 * t; b = 34 * t;
        } else {
          var lx = x - 4, plank = (lx / 14) | 0, ppx = lx - plank * 14;
          var ph = hash2(plank, 7, 503);
          var n2 = fbm(x, y * 0.25, 8, 504);
          var ring = Math.sin(ppx * 0.55 + n2 * 12 + ph * 6.283);
          t = 0.84 + ring * 0.12 + (n - 0.5) * 0.25 + g * 0.1;
          t *= 1 + (ph - 0.5) * 0.24;
          if (ppx === 0) t *= 0.45;
          if (x === 4 || y === 4) t *= 0.55;
          else if (x === 5 || y === 5) t *= 0.8;
          r = 138 * t; gg = 85 * t; b = 46 * t;
        }
        setT(id, x, y, r, gg, b, 0);
      }
    }
  }

  // стальная дверь с табличкой EXIT (светится)
  var GLYPHS = {
    E: ['111', '100', '110', '100', '111'],
    X: ['101', '101', '010', '101', '101'],
    I: ['111', '010', '010', '010', '111'],
    T: ['111', '010', '010', '010', '010']
  };
  function makeExit(id) {
    var sx0 = 12, sx1 = 51, sy0 = 21, sy1 = 41;
    var rivets = [[7.5, 7.5], [56.5, 7.5], [7.5, 56.5], [56.5, 56.5], [7.5, 32], [56.5, 32]];
    for (var y = 0; y < TEX; y++) {
      for (var x = 0; x < TEX; x++) {
        var streak = hash2(x, 0, 601) * 0.12 + fbm(x, y * 0.3, 8, 602) * 0.18;
        var t = 0.74 + streak + (hash2(x, y, 603) - 0.5) * 0.05;
        if (x < 3 || x > 60 || y < 3 || y > 60) {
          t = 0.5 + streak * 0.4;
          if (x === 0 || y === 0) t *= 1.45; else if (x === 63 || y === 63) t *= 0.6;
        } else {
          if (x === 31) t *= 0.42; else if (x === 32) t *= 1.22;
          if (y === 12 || y === 51) t *= 0.45; else if (y === 13 || y === 52) t *= 1.22;
          if (x === 3 || y === 3) t *= 0.62;
        }
        for (var k = 0; k < rivets.length; k++) {
          var rx = x + 0.5 - rivets[k][0], ry = y + 0.5 - rivets[k][1], rd = Math.sqrt(rx * rx + ry * ry);
          if (rd < 1.8) t = (rx + ry < 0) ? 1.5 : 0.95;
          else if (rd < 2.6 && rx + ry > 0) t *= 0.7;
        }
        var r = 98 * t, g = 108 * t, b = 120 * t, e = 0;
        var ddx = x < sx0 ? sx0 - x : x > sx1 ? x - sx1 : 0;
        var ddy = y < sy0 ? sy0 - y : y > sy1 ? y - sy1 : 0;
        var dd = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dd === 0) {
          if (x === sx0 || x === sx1 || y === sy0 || y === sy1) { r = 110; g = 250; b = 165; e = 255; }
          else if (x === sx0 + 1 || x === sx1 - 1 || y === sy0 + 1 || y === sy1 - 1) { r = 20; g = 110; b = 60; e = 220; }
          else {
            var cyn = Math.abs(y + 0.5 - (sy0 + sy1 + 1) / 2) / ((sy1 - sy0) / 2);
            var v = 0.9 + (hash2(x, y, 604) - 0.5) * 0.12;
            r = 8 * v; g = (54 + 26 * (1 - cyn)) * v; b = 30 * v; e = 200;
          }
        } else if (dd < 8) {
          var a = 1 - dd / 8; a *= a;
          r += 12 * a; g += 80 * a; b += 36 * a; e = 80 * a;
        }
        setT(id, x, y, r, g, b, e);
      }
    }
    var word = 'EXIT', gx0 = 17, gy0 = 26;
    for (var i = 0; i < word.length; i++) {
      var gl = GLYPHS[word.charAt(i)];
      for (var gy = 0; gy < 5; gy++) {
        for (var gx = 0; gx < 3; gx++) {
          if (gl[gy].charAt(gx) !== '1') continue;
          for (var oy = 0; oy < 2; oy++) {
            for (var ox = 0; ox < 2; ox++) setT(id, gx0 + i * 8 + gx * 2 + ox, gy0 + gy * 2 + oy, 205, 255, 220, 255);
          }
        }
      }
    }
  }

  // плитка 2×2 на клетку (пол/потолок)
  function makeTiles(id, base, grout, groutE, seed, vari, bevel) {
    for (var y = 0; y < TEX; y++) {
      for (var x = 0; x < TEX; x++) {
        var tx = x & 31, ty = y & 31, tid = (x >> 5) + (y >> 5) * 2;
        var n = fbm(x, y, 4, seed), g = hash2(x, y, seed + 1) - 0.5, t, c, e = 0;
        if (tx === 0 || ty === 0) { t = 0.8 + n * 0.4; c = grout; e = groutE; }
        else {
          t = 1 + (hash2(tid, 1, seed + 2) - 0.5) * vari + (n - 0.5) * 0.4 + g * 0.1;
          if (bevel) { if (tx === 1 || ty === 1) t *= 1.16; else if (tx === 31 || ty === 31) t *= 0.78; }
          c = base;
        }
        setT(id, x, y, c[0] * t, c[1] * t, c[2] * t, e);
      }
    }
  }

  // потолочная панель с лампой
  function makeLamp(id, from) {
    for (var y = 0; y < TEX; y++) {
      for (var x = 0; x < TEX; x++) {
        var c = texFull[from * TS + (y << 6) + x];
        var r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255, e = 0;
        var d = Math.sqrt((x + 0.5 - 32) * (x + 0.5 - 32) + (y + 0.5 - 32) * (y + 0.5 - 32));
        if (d < 7.5) { var k = 1 - (d / 7.5) * 0.18; r = 255 * k; g = 240 * k; b = 204 * k; e = 255; }
        else if (d < 9.5) { var k2 = d < 8.5 ? 1.25 : 0.7; r = 128 * k2; g = 128 * k2; b = 134 * k2; }
        else if (d < 26) {
          var a = 1 - (d - 9.5) / 16.5; a *= a;
          r += 110 * a; g += 90 * a; b += 60 * a; e = 120 * a;
        }
        setT(id, x, y, r, g, b, e);
      }
    }
  }

  function buildFlat() {
    for (var id = 1; id < NTEX; id++) {
      var r = 0, g = 0, b = 0, e = 0, base = id * TS, i, c;
      for (i = 0; i < TS; i++) {
        c = texFull[base + i];
        r += c & 255; g += (c >>> 8) & 255; b += (c >>> 16) & 255; e += c >>> 24;
      }
      var col;
      if (id === T_EXIT) col = packC(58, 196, 112, 140);
      else if (id === F_EXIT) col = packC(36, 120, 72, 90);
      else col = packC(r / TS, g / TS, b / TS, e / TS);
      texFlat.fill(col, base, base + TS);
    }
  }

  function buildTextures() {
    masonry(T_STONE, makeRows([[16, 0, [24, 18, 22]], [16, 11, [30, 34]], [16, 27, [20, 26, 18]], [16, 45, [34, 30]]]),
      { seed: 101, base: [124, 124, 131], mortar: [52, 52, 57], mw: 2, vari: 0.32, noise: 0.45, grain: 0.14, hue: 0.06, cushion: true });
    var br = [];
    for (var i = 0; i < 8; i++) br.push([8, (i & 1) * 8, [16, 16, 16, 16]]);
    masonry(T_BRICK, makeRows(br),
      { seed: 202, base: [152, 64, 46], mortar: [120, 112, 102], mw: 1, vari: 0.28, noise: 0.3, grain: 0.16, hue: 0.12 });
    masonry(T_BLUE, makeRows([[16, 0, [32, 32]], [16, 16, [32, 32]], [16, 0, [32, 32]], [16, 16, [32, 32]]]),
      { seed: 303, base: [46, 78, 172], mortar: [20, 28, 66], mw: 2, vari: 0.22, noise: 0.35, grain: 0.12, hue: 0.08, cushion: true });
    makeWood(T_WOOD);
    masonry(T_MOSS, makeRows([[16, 7, [34, 30]], [16, 30, [22, 20, 22]], [16, 14, [28, 36]], [16, 50, [18, 24, 22]]]),
      { seed: 404, base: [112, 116, 108], mortar: [48, 52, 46], mw: 2, vari: 0.3, noise: 0.45, grain: 0.14, hue: 0.05, cushion: true, post: mossPost });
    makeExit(T_EXIT);
    makeTiles(F_TILE, [86, 82, 76], [34, 32, 30], 0, 701, 0.18, true);
    makeTiles(F_EXIT, [34, 92, 60], [110, 255, 165], 220, 801, 0.15, true);
    makeTiles(C_PANEL, [58, 60, 68], [28, 29, 33], 0, 901, 0.1, false);
    makeLamp(C_LAMP, C_PANEL);
    buildFlat();
  }

  /* ======================= лабиринт ======================= */
  var cellsN = 11;
  var MW = 0, map = null, floorT = null, ceilT = null, seen = null;
  var floorCount = 1, seenFloor = 0, exitX = 1, exitY = 1, doorX = 0, doorY = 1, mazeSeed = 0;

  function bfsDist(sx, sy) {
    var W = MW, N = W * W, dist = new Int32Array(N).fill(-1), q = new Int32Array(N), qh = 0, qt = 0;
    var s = sy * W + sx;
    dist[s] = 0; q[qt++] = s;
    while (qh < qt) {
      var c = q[qh++], cx = c % W, cy = (c / W) | 0, dc = dist[c] + 1;
      if (cx > 0 && !map[c - 1] && dist[c - 1] < 0) { dist[c - 1] = dc; q[qt++] = c - 1; }
      if (cx < W - 1 && !map[c + 1] && dist[c + 1] < 0) { dist[c + 1] = dc; q[qt++] = c + 1; }
      if (cy > 0 && !map[c - W] && dist[c - W] < 0) { dist[c - W] = dc; q[qt++] = c - W; }
      if (cy < W - 1 && !map[c + W] && dist[c + W] < 0) { dist[c + W] = dc; q[qt++] = c + W; }
    }
    return dist;
  }

  function generate(seed) {
    var rnd = mulberry32(seed);
    var n = cellsN, W = 2 * n + 1, x, y, i;
    MW = W;
    map = new Uint8Array(W * W);
    map.fill(1);

    // 1) идеальный лабиринт: итеративный DFS (recursive backtracker) — связный по построению
    var vis = new Uint8Array(n * n), stack = [0], nb = [0, 0, 0, 0];
    vis[0] = 1; map[W + 1] = 0;
    while (stack.length) {
      var c = stack[stack.length - 1], cx = c % n, cy = (c / n) | 0, k = 0;
      if (cx > 0 && !vis[c - 1]) nb[k++] = c - 1;
      if (cx < n - 1 && !vis[c + 1]) nb[k++] = c + 1;
      if (cy > 0 && !vis[c - n]) nb[k++] = c - n;
      if (cy < n - 1 && !vis[c + n]) nb[k++] = c + n;
      if (!k) { stack.pop(); continue; }
      var q = nb[(rnd() * k) | 0], qx = q % n, qy = (q / n) | 0;
      map[(cy + qy + 1) * W + (cx + qx + 1)] = 0;
      map[(2 * qy + 1) * W + (2 * qx + 1)] = 0;
      vis[q] = 1;
      stack.push(q);
    }
    // 2) немного петель (только убираем стены — связность сохраняется)
    for (y = 1; y < W - 1; y++) {
      for (x = 1; x < W - 1; x++) {
        if (map[y * W + x] && (x & 1) !== (y & 1) && rnd() < 0.06) map[y * W + x] = 0;
      }
    }
    // 3) пара залов, иногда с колоннами
    var rooms = Math.max(1, Math.round(n * n / 48));
    for (var rr = 0; rr < rooms; rr++) {
      var rw = 2 + ((rnd() * 2) | 0), rh = 2 + ((rnd() * 2) | 0);
      var rx = (rnd() * (n - rw + 1)) | 0, ry = (rnd() * (n - rh + 1)) | 0;
      var pillars = rnd() < 0.6;
      for (y = 2 * ry + 1; y <= 2 * (ry + rh - 1) + 1; y++) {
        for (x = 2 * rx + 1; x <= 2 * (rx + rw - 1) + 1; x++) {
          if (pillars && !(x & 1) && !(y & 1)) continue;
          map[y * W + x] = 0;
        }
      }
    }
    // 4) материалы стен зонами + плитка/лампы
    var sA = (rnd() * 1e9) | 0, sB = (rnd() * 1e9) | 0, sC = (rnd() * 1e9) | 0;
    floorT = new Uint8Array(W * W);
    ceilT = new Uint8Array(W * W);
    floorCount = 0;
    for (y = 0; y < W; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        floorT[i] = F_TILE;
        ceilT[i] = ((x & 1) && (y & 1) && hash2(x, y, sC + 5) < 0.3) ? C_LAMP : C_PANEL;
        if (!map[i]) { floorCount++; continue; }
        var t;
        if (x === 0 || y === 0 || x === W - 1 || y === W - 1) {
          t = hash2(x, y, sC) < 0.18 ? T_MOSS : T_STONE;
        } else {
          var a = vnoise(x * 0.16, y * 0.16, 65536, sA), b = vnoise(x * 0.16, y * 0.16, 65536, sB);
          t = a < 0.5 ? (b < 0.5 ? T_STONE : T_BRICK) : (b < 0.5 ? T_BLUE : T_WOOD);
          if (t === T_STONE && hash2(x, y, sC + 1) < 0.3) t = T_MOSS;
        }
        map[i] = t;
      }
    }
    // 5) выход: самая дальняя от старта клетка у внешней стены, дверь — в внешней стене
    var dist = bfsDist(1, 1), best = -1, bx = W - 2, by = W - 2;
    for (y = 1; y < W - 1; y++) {
      for (x = 1; x < W - 1; x++) {
        if (x !== 1 && y !== 1 && x !== W - 2 && y !== W - 2) continue;
        var dv = dist[y * W + x];
        if (dv > best) { best = dv; bx = x; by = y; }
      }
    }
    exitX = bx; exitY = by;
    if (bx === W - 2) { doorX = W - 1; doorY = by; }
    else if (by === W - 2) { doorX = bx; doorY = W - 1; }
    else if (bx === 1) { doorX = 0; doorY = by; }
    else { doorX = bx; doorY = 0; }
    map[doorY * W + doorX] = T_EXIT;
    floorT[by * W + bx] = F_EXIT;
    ceilT[by * W + bx] = C_LAMP;

    seen = new Uint8Array(W * W);
    seenFloor = 0;
  }

  /* ======================= игрок ======================= */
  var P = { x: 1.5, y: 1.5, a: 0, bob: 0, bobPhase: 0, bobAmp: 0 };
  var MOVE_SPEED = 2.7, ROT_SPEED = 2.4, RADIUS = 0.22;
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function markSeen(tx, ty) {
    var i = ty * MW + tx;
    if (i >= 0 && i < seen.length && !seen[i]) { seen[i] = 1; if (!map[i]) seenFloor++; layerDirty = true; }
  }

  function resetPlayer() {
    P.x = 1.5; P.y = 1.5;
    P.a = map[MW + 2] === 0 ? 0 : Math.PI / 2;
    P.bob = 0; P.bobPhase = 0; P.bobAmp = 0;
    markSeen(1, 1);
  }

  function solid(tx, ty) {
    return tx < 0 || ty < 0 || tx >= MW || ty >= MW || map[ty * MW + tx] !== 0;
  }

  // движение по осям отдельно: упёрлись по одной — скользим по другой
  function moveX(d) {
    if (!d) return;
    var nx = P.x + d, tx = Math.floor(d > 0 ? nx + RADIUS : nx - RADIUS);
    var y0 = Math.floor(P.y - RADIUS), y1 = Math.floor(P.y + RADIUS);
    for (var ty = y0; ty <= y1; ty++) {
      if (solid(tx, ty)) {
        nx = d > 0 ? Math.max(P.x, tx - RADIUS - 1e-4) : Math.min(P.x, tx + 1 + RADIUS + 1e-4);
        break;
      }
    }
    P.x = nx;
  }
  function moveY(d) {
    if (!d) return;
    var ny = P.y + d, ty = Math.floor(d > 0 ? ny + RADIUS : ny - RADIUS);
    var x0 = Math.floor(P.x - RADIUS), x1 = Math.floor(P.x + RADIUS);
    for (var tx = x0; tx <= x1; tx++) {
      if (solid(tx, ty)) {
        ny = d > 0 ? Math.max(P.y, ty - RADIUS - 1e-4) : Math.min(P.y, ty + 1 + RADIUS + 1e-4);
        break;
      }
    }
    P.y = ny;
  }

  /* ======================= автопрогулка ======================= */
  /* Камера едет строго по осевой линии маршрута (центры клеток), а взгляд отдельно ведётся
     на точку маршрута в AUTO_LOOK клетках впереди: перед поворотом он заранее уходит
     в новый коридор. Если к центру клетки-поворота взгляд ещё не довернулся — стоим
     и доворачиваемся на месте, потом едем дальше. */
  var AUTO_SPEED = 2.1, AUTO_LOOK = 2.0, AUTO_TURN = 3.4;
  var auto = { on: true, path: null, look: null, i: 0, u: 0, holding: false, hold: 0, diff: Math.PI };
  var DIR_X = [1, 0, -1, 0], DIR_Y = [0, 1, 0, -1];   // восток, юг, запад, север (ось y вниз)

  function segLen(p, i) {
    var dx = p[i + 1][0] - p[i][0], dy = p[i + 1][1] - p[i][1];
    return Math.sqrt(dx * dx + dy * dy);
  }
  function segDir(p, i) { return Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]); }

  // кратчайший путь до выхода; среди равных по длине — с наименьшим числом поворотов (жадно)
  function planPath() {
    var W = MW, sx = P.x | 0, sy = P.y | 0, cur = sy * W + sx;
    var dist = bfsDist(exitX, exitY);
    if (dist[cur] < 0) { auto.path = null; return; }
    var pts = [];
    if (Math.abs(P.x - (sx + 0.5)) + Math.abs(P.y - (sy + 0.5)) > 0.04) pts.push([P.x, P.y]);
    pts.push([sx + 0.5, sy + 0.5]);
    var hd = ((Math.round(P.a / (Math.PI / 2)) % 4) + 4) % 4;
    while (dist[cur] > 0) {
      var cx = cur % W, cy = (cur / W) | 0, want = dist[cur] - 1, next = -1;
      var order = [hd, (hd + 1) % 4, (hd + 3) % 4, (hd + 2) % 4];
      for (var k = 0; k < 4; k++) {
        var d = order[k], nx = cx + DIR_X[d], ny = cy + DIR_Y[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
        if (dist[ny * W + nx] === want) { next = ny * W + nx; hd = d; break; }
      }
      if (next < 0) break;
      cur = next;
      pts.push([(cur % W) + 0.5, ((cur / W) | 0) + 0.5]);
    }
    auto.path = pts;
    auto.look = pts.concat([[doorX + 0.5, doorY + 0.5]]);   // на финише взгляд уходит на дверь EXIT
    auto.i = 0; auto.u = 0;                                // отрезок pts[i] → pts[i+1] и пройденное по нему
    auto.holding = false; auto.hold = 0; auto.diff = Math.PI;
  }

  // точка на маршруте взгляда в AUTO_LOOK клетках впереди текущего положения
  function lookTarget() {
    var p = auto.look, i = Math.min(auto.i, p.length - 2), len = segLen(p, i);
    var t = len > 0 ? Math.min(1, auto.u / len) : 1;
    var x = p[i][0] + (p[i + 1][0] - p[i][0]) * t, y = p[i][1] + (p[i + 1][1] - p[i][1]) * t;
    var rem = AUTO_LOOK, left = len * (1 - t);
    while (rem > left && i < p.length - 2) {
      rem -= left; i++;
      x = p[i][0]; y = p[i][1]; left = segLen(p, i);
    }
    if (rem >= left || left <= 0) return p[i + 1];
    var f = rem / left;
    return [x + (p[i + 1][0] - x) * f, y + (p[i + 1][1] - y) * f];
  }

  function autoUpdate(dt) {
    if (!auto.path) planPath();
    var p = auto.path;
    if (!p) return;

    // 1) взгляд — плавно на точку впереди по маршруту
    var lt = lookTarget(), lx = lt[0] - P.x, ly = lt[1] - P.y;
    if (lx * lx + ly * ly > 0.01) {
      var want = Math.atan2(ly, lx), diff = wrapAngle(want - P.a);
      var rot = clamp(diff * 7, -AUTO_TURN, AUTO_TURN) * dt;
      if (Math.abs(rot) > Math.abs(diff)) rot = diff;
      P.a = wrapAngle(P.a + rot);
      auto.diff = wrapAngle(want - P.a);
    }
    if (p.length < 2 || auto.i >= p.length - 1) return;

    // 2) стоим в центре клетки-поворота, пока взгляд не уйдёт в новый коридор
    if (auto.holding) {
      auto.hold += dt;
      var off = Math.abs(wrapAngle(segDir(p, auto.i) - P.a));
      if (off < 0.3 || Math.abs(auto.diff) < 0.1 || auto.hold > 1.5) auto.holding = false;
      else return;
    }

    // 3) едем по осевой; чем сильнее взгляд отведён от направления хода, тем медленнее
    var mis = Math.abs(wrapAngle(segDir(p, auto.i) - P.a));
    var step = AUTO_SPEED * clamp(0.4 + 0.6 * Math.cos(mis), 0.4, 1) * dt;
    while (step > 0 && auto.i < p.length - 1) {
      var left = segLen(p, auto.i) - auto.u;
      if (step < left) { auto.u += step; break; }
      step -= left; auto.i++; auto.u = 0;
      if (auto.i >= p.length - 1) break;
      var bend = Math.abs(wrapAngle(segDir(p, auto.i) - segDir(p, auto.i - 1)));
      if (bend > 0.2 && Math.abs(wrapAngle(segDir(p, auto.i) - P.a)) > 0.3) {
        auto.holding = true; auto.hold = 0;
        break;
      }
    }
    if (auto.i >= p.length - 1) { P.x = p[p.length - 1][0]; P.y = p[p.length - 1][1]; return; }
    var L = segLen(p, auto.i), t = L > 0 ? auto.u / L : 0;
    P.x = p[auto.i][0] + (p[auto.i + 1][0] - p[auto.i][0]) * t;
    P.y = p[auto.i][1] + (p[auto.i + 1][1] - p[auto.i][1]) * t;
  }

  // сразу смотреть вдоль маршрута (новый лабиринт / включение автопрогулки)
  function aimAlongPath() {
    if (!auto.path) planPath();
    if (!auto.path) return;
    var lt = lookTarget(), lx = lt[0] - P.x, ly = lt[1] - P.y;
    if (lx * lx + ly * ly > 0.01) P.a = Math.atan2(ly, lx);
  }

  /* ======================= рендер ======================= */
  var $ = function (id) { return document.getElementById(id); };
  var view = $('view'), ctx = view.getContext('2d', { alpha: false });
  var off = document.createElement('canvas'), octx = off.getContext('2d');
  var mapCanvas = $('map'), mctx = mapCanvas.getContext('2d');
  var layer = document.createElement('canvas'), lctx = layer.getContext('2d');

  var dpr = 1, RW = 0, RH = 0, resScale = 0.5, fov = 66 * Math.PI / 180, fogDens = 0.135;
  var img = null, pix32 = null, hitX = null, hitY = null, colY0 = null, colY1 = null, rowD = null, rowF = null;
  var vignette = null, mapCss = 200, layerDirty = true, layerT = -1;

  var FR = 6, FG = 7, FB = 11;
  var FOG_PIX = (0xff000000 | (FB << 16) | (FG << 8) | FR) >>> 0;

  // тонирование текселя: f∈[0..256] — яркость (дистанция × сторона), emissive поднимает её
  function shade(c, f) {
    var e = c >>> 24;
    if (e) f += ((256 - f) * e) >> 8;
    var nf = 256 - f;
    return 0xff000000 |
      (((((c >>> 16) & 255) * f + FB * nf) >> 8) << 16) |
      (((((c >>> 8) & 255) * f + FG * nf) >> 8) << 8) |
      ((((c & 255) * f + FR * nf) >> 8));
  }

  function renderScene() {
    var W = RW, H = RH, T = tex, M = map, MWl = MW, S = seen, buf = pix32;
    var px = P.x, py = P.y;
    var dirX = Math.cos(P.a), dirY = Math.sin(P.a);
    // FOV — горизонтальный; на портретном экране фокус считаем от высоты, чтобы не «раздувать» вертикаль
    var focal = Math.max(W, H * 0.9) / (2 * Math.tan(fov * 0.5));
    var pl = W / (2 * focal);
    var plX = -dirY * pl, plY = dirX * pl;          // плоскость камеры — вправо от взгляда (ось y вниз)
    var camZ = 0.5 + P.bob;
    var hor = H * 0.5, dens = fogDens;
    var x, y, d, dy;

    // дистанция и яркость для каждой строки пола/потолка
    for (y = 0; y < H; y++) {
      dy = y + 0.5 - hor;
      if (dy === 0) dy = 0.5;
      d = dy > 0 ? camZ * focal / dy : (1 - camZ) * focal / -dy;
      rowD[y] = d;
      rowF[y] = (Math.exp(-d * dens) * 256) | 0;
    }

    // --- проход 1: DDA по колонкам + стены ---
    for (x = 0; x < W; x++) {
      var camX = 2 * (x + 0.5) / W - 1;
      var rdx = dirX + plX * camX, rdy = dirY + plY * camX;
      var mx = px | 0, my = py | 0;
      var ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
      var ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      var stx, sty, sdx, sdy;
      if (rdx < 0) { stx = -1; sdx = (px - mx) * ddx; } else { stx = 1; sdx = (mx + 1 - px) * ddx; }
      if (rdy < 0) { sty = -1; sdy = (py - my) * ddy; } else { sty = 1; sdy = (my + 1 - py) * ddy; }
      var side = 0, cell = 0, guard = 0;
      while (guard++ < 512) {
        if (sdx < sdy) { sdx += ddx; mx += stx; side = 0; }
        else { sdy += ddy; my += sty; side = 1; }
        if (mx < 0 || my < 0 || mx >= MWl || my >= MWl) { cell = T_STONE; break; }
        var mi = my * MWl + mx;
        cell = M[mi];
        if (!S[mi]) { S[mi] = 1; layerDirty = true; if (!cell) seenFloor++; }
        if (cell) break;
      }
      if (!cell) cell = T_STONE;

      // перпендикулярная дистанция до плоскости камеры — без «рыбьего глаза»
      var perp = side === 0 ? sdx - ddx : sdy - ddy;
      if (perp < 1e-3) perp = 1e-3;
      hitX[x] = px + rdx * perp;
      hitY[x] = py + rdy * perp;

      var lineH = focal / perp;
      var top = hor - (1 - camZ) * lineH, bot = hor + camZ * lineH;
      var y0 = Math.ceil(top - 0.5), y1 = Math.ceil(bot - 0.5);
      if (y0 < 0) y0 = 0;
      if (y1 > H) y1 = H;
      colY0[x] = y0; colY1[x] = y1;

      var wallX = side === 0 ? py + perp * rdy : px + perp * rdx;
      wallX -= Math.floor(wallX);
      var tx = (wallX * TEX) | 0;
      if (tx > 63) tx = 63;
      if ((side === 0 && rdx < 0) || (side === 1 && rdy > 0)) tx = 63 - tx;   // текстура не зеркалится
      var wf = (Math.exp(-perp * dens) * (side === 1 ? 0.66 : 1) * 256) | 0;   // сторона + дальность
      var step = TEX / (bot - top);
      var tpos = (y0 + 0.5 - top) * step;
      var wb = cell * TS + tx, o = y0 * W + x;
      for (y = y0; y < y1; y++, o += W, tpos += step) {
        var ti = tpos | 0;
        if (ti > 63) ti = 63;
        buf[o] = shade(T[wb + (ti << 6)], wf);
      }
    }

    // --- проход 2: пол и потолок построчно (floor casting) ---
    var lx = dirX - plX, ly = dirY - plY;
    var kx = 2 * plX / W, ky = 2 * plY / W;
    for (y = 0; y < H; y++) {
      d = rowD[y];
      var rf = rowF[y], sx = kx * d, sy = ky * d;
      var wx = px + lx * d + sx * 0.5, wy = py + ly * d + sy * 0.5;
      var o2 = y * W, isCeil = (y + 0.5) < hor, LT = isCeil ? ceilT : floorT;
      for (x = 0; x < W; x++, wx += sx, wy += sy) {
        if (isCeil ? y >= colY0[x] : y < colY1[x]) continue;
        if (wx < 0 || wy < 0 || wx >= MWl || wy >= MWl) { buf[o2 + x] = FOG_PIX; continue; }
        buf[o2 + x] = shade(T[LT[(wy | 0) * MWl + (wx | 0)] * TS + ((((wy * TEX) | 0) & 63) << 6) + (((wx * TEX) | 0) & 63)], rf);
      }
    }

    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, view.width, view.height);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, view.width, view.height);
  }

  /* ======================= мини-карта ======================= */
  var WALL_COL = [null, '#72767f', '#a34e3b', '#4266c8', '#8e5c33', '#62825a', '#4be38f'];

  function rebuildLayer() {
    var S = Math.round(mapCss * dpr), W = MW;
    if (layer.width !== S) { layer.width = S; layer.height = S; }
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.fillStyle = '#0a0c10';
    lctx.fillRect(0, 0, S, S);
    for (var y = 0; y < W; y++) {
      var y0 = Math.round(y * S / W), y1 = Math.round((y + 1) * S / W);
      for (var x = 0; x < W; x++) {
        var x0 = Math.round(x * S / W), x1 = Math.round((x + 1) * S / W);
        var i = y * W + x, v = map[i], sn = seen[i];
        if (v) {
          lctx.globalAlpha = sn ? 1 : 0.24;
          lctx.fillStyle = WALL_COL[v];
        } else {
          lctx.globalAlpha = 1;
          lctx.fillStyle = (x === exitX && y === exitY) ? '#1f6a44' : sn ? '#2d333f' : '#13161c';
        }
        lctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
    lctx.globalAlpha = 1;
  }

  function drawMap(time) {
    if (layerDirty && time - layerT > 0.12) { rebuildLayer(); layerDirty = false; layerT = time; }
    var S = mapCss, s = S / MW;
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mctx.clearRect(0, 0, S, S);
    mctx.imageSmoothingEnabled = false;
    mctx.drawImage(layer, 0, 0, S, S);

    var cx = P.x * s, cy = P.y * s;

    // маршрут автопрогулки
    if (auto.on && auto.path) {
      mctx.save();
      mctx.setLineDash([2, 3]);
      mctx.strokeStyle = 'rgba(255, 200, 120, 0.5)';
      mctx.lineWidth = 1.2;
      mctx.beginPath();
      mctx.moveTo(cx, cy);
      for (var k = auto.i + 1; k < auto.path.length; k++) mctx.lineTo(auto.path[k][0] * s, auto.path[k][1] * s);
      mctx.stroke();
      mctx.restore();
    }

    // выход — пульсирующее кольцо
    var ex = (exitX + 0.5) * s, ey = (exitY + 0.5) * s, pulse = 0.5 + 0.5 * Math.sin(time * 4);
    mctx.strokeStyle = 'rgba(75, 227, 143, ' + (0.95 - pulse * 0.6).toFixed(3) + ')';
    mctx.lineWidth = 1.6;
    mctx.beginPath();
    mctx.arc(ex, ey, Math.max(3, s * (0.55 + pulse * 0.7)), 0, Math.PI * 2);
    mctx.stroke();

    // сектор обзора — реальный многоугольник из точек попадания лучей
    var grad = mctx.createRadialGradient(cx, cy, 0, cx, cy, s * 9);
    grad.addColorStop(0, 'rgba(255, 190, 90, 0.45)');
    grad.addColorStop(1, 'rgba(255, 190, 90, 0.04)');
    mctx.beginPath();
    mctx.moveTo(cx, cy);
    var stepC = Math.max(1, (RW / 120) | 0);
    for (var i = 0; i < RW; i += stepC) mctx.lineTo(hitX[i] * s, hitY[i] * s);
    mctx.lineTo(hitX[RW - 1] * s, hitY[RW - 1] * s);
    mctx.closePath();
    mctx.fillStyle = grad;
    mctx.fill();
    mctx.strokeStyle = 'rgba(255, 205, 130, 0.8)';
    mctx.lineWidth = 1;
    mctx.beginPath();
    mctx.moveTo(cx, cy); mctx.lineTo(hitX[0] * s, hitY[0] * s);
    mctx.moveTo(cx, cy); mctx.lineTo(hitX[RW - 1] * s, hitY[RW - 1] * s);
    mctx.stroke();

    // игрок
    var r = clamp(s * 0.42, 3, 6), dx = Math.cos(P.a), dy = Math.sin(P.a);
    mctx.strokeStyle = '#fff1d6';
    mctx.lineWidth = 1.6;
    mctx.beginPath();
    mctx.moveTo(cx, cy);
    mctx.lineTo(cx + dx * r * 2.3, cy + dy * r * 2.3);
    mctx.stroke();
    mctx.fillStyle = '#ffb547';
    mctx.strokeStyle = '#1a1206';
    mctx.lineWidth = 1.5;
    mctx.beginPath();
    mctx.arc(cx, cy, r, 0, Math.PI * 2);
    mctx.fill();
    mctx.stroke();
  }

  /* ======================= размеры ======================= */
  var panel = $('panel'), hint = $('hint');

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = Math.max(1, window.innerWidth), ch = Math.max(1, window.innerHeight);
    view.width = Math.round(cw * dpr);
    view.height = Math.round(ch * dpr);

    var rw = Math.round(cw * resScale), rh = Math.round(ch * resScale), maxPix = 640000;
    if (rw * rh > maxPix) { var k = Math.sqrt(maxPix / (rw * rh)); rw = Math.round(rw * k); rh = Math.round(rh * k); }
    RW = Math.max(64, rw); RH = Math.max(48, rh);
    off.width = RW; off.height = RH;
    img = octx.createImageData(RW, RH);
    pix32 = new Uint32Array(img.data.buffer);
    hitX = new Float32Array(RW); hitY = new Float32Array(RW);
    colY0 = new Int32Array(RW); colY1 = new Int32Array(RW);
    rowD = new Float32Array(RH); rowF = new Int32Array(RH);

    var W = view.width, H = view.height;
    vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.sqrt(W * W + H * H) * 0.58);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.55)');

    mapCss = Math.max(60, Math.round(mapCanvas.clientWidth || 200));
    mapCanvas.width = Math.round(mapCss * dpr);
    mapCanvas.height = Math.round(mapCss * dpr);
    layerDirty = true; layerT = -1;

    hint.style.bottom = (panel.offsetHeight + parseFloat(getComputedStyle(panel).bottom || '16') + 12) + 'px';
  }

  /* ======================= состояние игры ======================= */
  var elapsed = 0, trans = null;
  var fadeEl = $('fade'), toast = $('toast'), toastSub = $('toast-sub');

  function newMazeNow(seed) {
    mazeSeed = (seed != null ? seed : Math.random() * 4294967296) >>> 0;
    generate(mazeSeed);
    resetPlayer();
    elapsed = 0;
    auto.path = null;
    if (auto.on) aimAlongPath();
    layerDirty = true; layerT = -1;
    $('s-maze').textContent = cellsN + '×' + cellsN + ' клеток';
    var hx = (mazeSeed & 0xffff).toString(16).toUpperCase();
    $('s-seed').textContent = 'сид #' + ('0000' + hx).slice(-4);
  }

  function explored() { return Math.round(seenFloor / Math.max(1, floorCount) * 100); }

  function startTransition(win) {
    if (trans) return;
    if (win) {
      toastSub.textContent = 'за ' + fmtTime(elapsed) + ' · исследовано ' + explored() + '% · строим новый лабиринт…';
      toast.classList.add('show');
      trans = { t: 0, fadeAt: 1.2, swapAt: 1.7, endAt: 1.8, faded: false, swapped: false };
    } else {
      trans = { t: 0, fadeAt: 0, swapAt: 0.46, endAt: 0.5, faded: false, swapped: false };
    }
  }

  function tickTransition(dt) {
    if (!trans) return;
    trans.t += dt;
    if (!trans.faded && trans.t >= trans.fadeAt) { fadeEl.classList.add('on'); trans.faded = true; }
    if (!trans.swapped && trans.t >= trans.swapAt) {
      trans.swapped = true;
      newMazeNow();
      fadeEl.classList.remove('on');
      toast.classList.remove('show');
    }
    if (trans.t >= trans.endAt) trans = null;
  }

  /* ======================= ввод ======================= */
  var keys = Object.create(null);
  var MOVE_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
  var hintHidden = false;

  function hideHint() { if (!hintHidden) { hintHidden = true; hint.classList.add('hide'); } }

  function setAuto(on) {
    auto.on = on;
    auto.path = null;
    $('btn-auto').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!on) hideHint();
  }

  function takeControl() { if (auto.on) setAuto(false); hideHint(); }

  function toggleTex() {
    tex = tex === texFull ? texFlat : texFull;
    $('btn-tex').setAttribute('aria-pressed', tex === texFull ? 'true' : 'false');
  }

  function newMaze() { startTransition(false); }

  window.addEventListener('keydown', function (e) {
    var c = e.code;
    if (MOVE_KEYS[c]) { e.preventDefault(); keys[c] = true; takeControl(); return; }
    if (c === 'ShiftLeft' || c === 'ShiftRight') { keys[c] = true; return; }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (c === 'KeyN') newMaze();
    else if (c === 'KeyT') toggleTex();
    else if (c === 'KeyP') setAuto(!auto.on);
  }, true);
  window.addEventListener('keyup', function (e) { keys[e.code] = false; }, true);
  window.addEventListener('blur', function () { keys = Object.create(null); });

  // мышь/тач: перетаскивание по горизонтали — поворот, по вертикали — ход
  var drag = null, dragFwd = 0;
  view.addEventListener('pointerdown', function (e) {
    try { view.focus({ preventScroll: true }); } catch (_) { view.focus(); }
    drag = { id: e.pointerId, x: e.clientX, x0: e.clientX, y0: e.clientY, active: false };
    try { view.setPointerCapture(e.pointerId); } catch (_) { /* нет — не страшно */ }
  });
  view.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x;
    drag.x = e.clientX;
    if (!drag.active && Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 6) { drag.active = true; takeControl(); }
    if (drag.active) {
      P.a = wrapAngle(P.a + dx * 0.0065);
      var f = clamp(-(e.clientY - drag.y0) / 90, -1, 1);
      dragFwd = Math.abs(f) < 0.15 ? 0 : f;
    }
  });
  function endDrag(e) { if (drag && e.pointerId === drag.id) { drag = null; dragFwd = 0; } }
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);

  // панель: после клика возвращаем фокус сцене, чтобы стрелки не крутили ползунки
  panel.addEventListener('pointerup', function () {
    setTimeout(function () {
      var a = document.activeElement;
      if (a && a !== view && a.blur) a.blur();
      try { view.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }, 0);
  });

  $('btn-new').addEventListener('click', newMaze);
  $('btn-auto').addEventListener('click', function () { setAuto(!auto.on); });
  $('btn-tex').addEventListener('click', toggleTex);

  function bindRange(id, onInput, onChange) {
    var el = $(id);
    var fn = function () { onInput(+el.value); };
    el.addEventListener('input', fn);
    fn();
    if (onChange) el.addEventListener('change', function () { onChange(+el.value); });
  }

  bindRange('r-size', function (v) { $('v-size').textContent = v + '×' + v; },
    function (v) { if (v !== cellsN) { cellsN = v; newMaze(); } });
  cellsN = +$('r-size').value;
  bindRange('r-fov', function (v) { fov = v * Math.PI / 180; $('v-fov').textContent = v + '°'; });
  bindRange('r-fog', function (v) { fogDens = (v / 100) * 0.4; $('v-fog').textContent = v + '%'; });
  bindRange('r-res', function (v) {
    $('v-res').textContent = v + '%';
    var ns = v / 100;
    if (ns !== resScale || !img) { resScale = ns; if (img) resize(); }
  });

  window.addEventListener('resize', resize);

  /* ======================= цикл ======================= */
  function manualUpdate(dt) {
    var fwd = 0, str = 0, turn = 0;
    var run = keys.ShiftLeft || keys.ShiftRight;
    if (keys.KeyW || keys.ArrowUp) fwd += 1;
    if (keys.KeyS || keys.ArrowDown) fwd -= 1;
    if (keys.KeyD) str += 1;
    if (keys.KeyA) str -= 1;
    if (keys.ArrowRight) turn += 1;
    if (keys.ArrowLeft) turn -= 1;
    fwd += dragFwd;
    P.a = wrapAngle(P.a + turn * ROT_SPEED * dt);
    var dx = Math.cos(P.a), dy = Math.sin(P.a);
    var mx = dx * fwd - dy * str, my = dy * fwd + dx * str;
    var len = Math.sqrt(mx * mx + my * my);
    if (len > 1) { mx /= len; my /= len; }
    var sp = MOVE_SPEED * (run ? 1.75 : 1) * dt;
    moveX(mx * sp);
    moveY(my * sp);
  }

  function update(dt) {
    var ox = P.x, oy = P.y;
    if (!trans) {
      elapsed += dt;
      if (auto.on) autoUpdate(dt); else manualUpdate(dt);
    }
    var moved = Math.sqrt((P.x - ox) * (P.x - ox) + (P.y - oy) * (P.y - oy));

    // покачивание камеры при ходьбе
    var target = clamp(moved / (MOVE_SPEED * dt + 1e-6), 0, 1.6);
    P.bobAmp += (target - P.bobAmp) * Math.min(1, dt * 8);
    P.bobPhase += moved * 7.5;
    P.bob = reduceMotion ? 0 : Math.sin(P.bobPhase) * 0.012 * P.bobAmp;

    markSeen(P.x | 0, P.y | 0);
    if (!trans && (P.x | 0) === exitX && (P.y | 0) === exitY) startTransition(true);
    tickTransition(dt);
  }

  var last = performance.now(), fps = 0, fpsAcc = 0, fpsN = 0, hudT = 0;
  var sFps = $('s-fps'), sTime = $('s-time'), mExp = $('m-exp');

  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;

    update(dt);
    renderScene();
    drawMap(now / 1000);

    fpsAcc += (now - (frame.prev || now)); frame.prev = now; fpsN++;
    hudT += dt;
    if (fpsAcc >= 500) { fps = fpsN * 1000 / fpsAcc; fpsAcc = 0; fpsN = 0; }
    if (hudT >= 0.25) {
      hudT = 0;
      sFps.textContent = (fps ? Math.round(fps) : '—') + ' к/с';
      sTime.textContent = 'время ' + fmtTime(elapsed);
      mExp.textContent = explored() + '%';
    }
    requestAnimationFrame(frame);
  }

  /* ======================= старт ======================= */
  buildTextures();
  resize();
  newMazeNow();
  requestAnimationFrame(function (t) {
    last = t;
    frame(t);
    requestAnimationFrame(function () { fadeEl.classList.remove('on'); });
  });
})();
