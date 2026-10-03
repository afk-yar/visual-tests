/* Рейкастер-лабиринт — Claude Sonnet 5.5
 *
 * Псевдо-3D в духе Wolfenstein 3D на чистом Canvas 2D, без библиотек.
 *  - лабиринт: рекурсивный бэктрекер (DFS) + «плетение» петель + комнаты с колонной;
 *  - рейкастинг по сетке: DDA (Amanatides-Woo), перпендикулярное расстояние
 *    (без «рыбьего глаза»), проекция по фокусному расстоянию;
 *  - программный рендер в ImageData (Uint32Array): текстурированные стены (мипмапы),
 *    пол и потолок (floor casting), туман по дальности, 4 разных яркости граней;
 *  - спрайты с z-буфером (маяк выхода), мини-карта с сектором обзора по реальным лучам;
 *  - коллизии «круг-сетка» по осям со скольжением, инерция, покачивание головы;
 *  - автопилот-демо: идёт к выходу по полю расстояний (BFS) с «срезанием» углов.
 *
 * Чистая логика (генерация, рендер в буфер) не трогает DOM: файл работает и в node
 * (module.exports), и в браузере.
 */
(function () {
  'use strict';

  /* ================================================================
   *  Утилиты
   * ================================================================ */
  var PI = Math.PI;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrapPi(a) {
    a = (a + PI) % (2 * PI);
    if (a < 0) a += 2 * PI;
    return a - PI;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(ix, iy, seed) {
    var h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /* Зацикленный (tileable) value-noise: решётка оборачивается с периодом per. */
  function vnoise(x, y, perx, pery, seed) {
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    var xa = ((x0 % perx) + perx) % perx, xb = (xa + 1) % perx;
    var ya = ((y0 % pery) + pery) % pery, yb = (ya + 1) % pery;
    var a = hash2(xa, ya, seed), b = hash2(xb, ya, seed);
    var c = hash2(xa, yb, seed), d = hash2(xb, yb, seed);
    var top = a + (b - a) * fx, bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  }

  function fbm(x, y, perx, pery, seed, oct) {
    var s = 0, amp = 0.5, tot = 0;
    for (var i = 0; i < oct; i++) {
      s += amp * vnoise(x, y, perx, pery, seed + i * 17);
      tot += amp;
      x *= 2; y *= 2; perx *= 2; pery *= 2; amp *= 0.5;
    }
    return s / tot;
  }

  function pack(r, g, b) {
    r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
    g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
    b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
    return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
  }

  /* ================================================================
   *  Процедурные текстуры (128x128) + мипмапы
   * ================================================================ */
  var TS = 128;

  function nz(x, y, per, seed, oct) { return fbm(x * per / TS, y * per / TS, per, per, seed, oct); }
  function nzs(x, y, px, py, seed, oct) { return fbm(x * px / TS, y * py / TS, px, py, seed, oct); }

  function buildTexture(fn) {
    var d = new Uint32Array(TS * TS), o = [0, 0, 0];
    for (var y = 0; y < TS; y++) {
      for (var x = 0; x < TS; x++) {
        fn(x, y, o);
        d[y * TS + x] = pack(o[0], o[1], o[2]);
      }
    }
    return d;
  }

  /* Красный кирпич 32x16, кладка вполсмещения. */
  function fBrick(x, y, o) {
    var row = y >> 4, xx = (x + (row & 1) * 16) & 127, bx = xx & 31, by = y & 15;
    var id = (xx >> 5) + row * 4;
    var v = hash2(id, 7, 11);
    var g = nz(x, y, 32, 3, 2), big = nz(x, y, 8, 5, 2);
    if (bx < 2 || by < 2) {
      var m = 96 + g * 56;
      o[0] = m; o[1] = m - 4; o[2] = m - 12;
      return;
    }
    var r = 138 + v * 55 + (g - 0.5) * 64 + (big - 0.5) * 34;
    var gg = 54 + v * 24 + (g - 0.5) * 36 + (big - 0.5) * 16;
    var b = 40 + v * 16 + (g - 0.5) * 28;
    if (by < 4) { r += 16; gg += 9; b += 7; } else if (by > 13) { r -= 28; gg -= 14; b -= 10; }
    if (bx < 4) { r += 8; gg += 4; } else if (bx > 29) { r -= 16; gg -= 8; b -= 4; }
    o[0] = r; o[1] = gg; o[2] = b;
  }

  /* Тёсаный камень (опционально с мхом). */
  function makeStone(tr, tg, tb, moss, seed) {
    return function (x, y, o) {
      var row = y >> 5, xx = (x + (row & 1) * 32) & 127, bx = xx & 63, by = y & 31;
      var id = (xx >> 6) + row * 2;
      var v = hash2(id, 3, seed);
      var g = nz(x, y, 32, seed, 3), big = nz(x, y, 6, seed + 1, 3);
      if (bx < 2 || by < 2) {
        var m = 30 + g * 26;
        o[0] = m * tr; o[1] = m * tg; o[2] = m * tb;
        return;
      }
      var base = 98 + v * 34 + (big - 0.5) * 46 + (g - 0.5) * 34;
      var r = base * tr, gg = base * tg, b = base * tb;
      if (by < 4) { r += 14; gg += 14; b += 16; } else if (by > 27) { r -= 24; gg -= 24; b -= 26; }
      if (bx < 4) { r += 8; gg += 8; b += 9; } else if (bx > 59) { r -= 14; gg -= 14; b -= 15; }
      // трещины: тонкая изолиния гладкого шума даёт непрерывные линии
      var cr = Math.abs(nz(x, y, 7, seed + 2, 1) - 0.5);
      if (cr < 0.014) { var ck = 0.55 + cr * 25; r *= ck; gg *= ck; b *= ck + 0.03; }
      if (moss) {
        var m2 = nz(x, y, 12, seed + 9, 3) + (y / TS) * 0.32 - 0.14;
        var k = clamp((m2 - 0.52) * 4, 0, 0.85);
        if (k > 0) {
          var mg = 0.62 + g * 0.55;
          r += (66 * mg - r) * k; gg += (98 * mg - gg) * k; b += (46 * mg - b) * k;
        }
      }
      o[0] = r; o[1] = gg; o[2] = b;
    };
  }

  /* Доски с железными полосами и заклёпками. */
  function fWood(x, y, o) {
    var pid = x >> 4, bx = x & 15;
    var gr = nzs(x + pid * 37, y, 16, 3, 21, 3);
    var band = 0.5 + 0.5 * Math.sin(gr * 24 + pid * 1.7);
    var v = hash2(pid, 5, 23);
    var k = 0.82 + 0.18 * band;
    var r = (116 + v * 34) * k, gg = (76 + v * 22) * k, b = (44 + v * 12) * k;
    if (bx === 0) { r = 34; gg = 22; b = 14; } else if (bx === 1) { r += 16; gg += 12; b += 8; }
    var inBand = (y >= 18 && y < 27) || (y >= 101 && y < 110);
    if (inBand) {
      var yy = y >= 101 ? y - 101 : y - 18;
      var iron = 54 + nz(x, y, 48, 31, 2) * 30;
      if (yy === 0) iron += 36; else if (yy === 8) iron -= 22;
      r = iron; gg = iron + 2; b = iron + 10;
      var cx = pid * 16 + 8, cy = (y >= 101 ? 105 : 22) + 0.5;
      var dd = Math.sqrt((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy));
      if (dd < 2.6) { r = 128; gg = 130; b = 140; } else if (dd < 3.6) { r = 28; gg = 28; b = 34; }
    }
    o[0] = r; o[1] = gg; o[2] = b;
  }

  /* Пол: плиты 32px, текстура покрывает 2x2 клетки. */
  function fFloor(x, y, o) {
    var sx = x >> 5, sy = y >> 5, bx = x & 31, by = y & 31;
    var v = hash2(sx, sy, 41);
    var g = nz(x, y, 32, 43, 3), big = nz(x, y, 4, 47, 2);
    var base = 92 + v * 30 + (big - 0.5) * 30 + (g - 0.5) * 26;
    var r = base, gg = base * 0.93, b = base * 0.84;
    if (bx < 1 || by < 1) {
      var m = 30 + g * 16;
      r = m; gg = m * 0.95; b = m * 0.9;
    } else if (bx < 3 || by < 3) { r += 10; gg += 9; b += 8; }
    else if (bx > 29 || by > 29) { r -= 14; gg -= 13; b -= 12; }
    if (nz(x, y, 6, 49, 2) > 0.7) { r *= 0.8; gg *= 0.82; b *= 0.85; }
    o[0] = r; o[1] = gg; o[2] = b;
  }

  /* Потолок: тёмные кессоны между деревянными балками (по панели на клетку). */
  function fCeil(x, y, o) {
    var bx = x & 63, by = y & 63;
    var g = nz(x, y, 32, 61, 3);
    if (bx < 5 || by < 5) {
      var w = 46 + g * 30;
      o[0] = w * 1.15; o[1] = w * 0.8; o[2] = w * 0.58;
      if (bx === 4 || by === 4) { o[0] += 14; o[1] += 9; o[2] += 6; }
      return;
    }
    var base = 78 + g * 22 + (nz(x, y, 6, 63, 2) - 0.5) * 24;
    o[0] = base * 0.84; o[1] = base * 0.9; o[2] = base * 1.06;
    if (bx > 58 || by > 58) { o[0] *= 0.75; o[1] *= 0.75; o[2] *= 0.8; }
  }

  /* Запечённое «затенение углов» у пола и потолка в текстурах стен. */
  function bakeAO(d) {
    for (var y = 0; y < TS; y++) {
      var f = 1;
      if (y < 12) f = 0.6 + 0.4 * (y / 12);
      else if (y > TS - 17) f = 0.52 + 0.48 * ((TS - 1 - y) / 16);
      if (f >= 1) continue;
      for (var x = 0; x < TS; x++) {
        var c = d[y * TS + x];
        d[y * TS + x] = pack((c & 255) * f, ((c >> 8) & 255) * f, ((c >> 16) & 255) * f);
      }
    }
  }

  function transpose(src, s) {
    var out = new Uint32Array(s * s);
    for (var y = 0; y < s; y++) for (var x = 0; x < s; x++) out[x * s + y] = src[y * s + x];
    return out;
  }

  function downsample(src, s) {
    var ns = s >> 1, out = new Uint32Array(ns * ns);
    for (var y = 0; y < ns; y++) {
      for (var x = 0; x < ns; x++) {
        var i = (2 * y) * s + 2 * x;
        var a = src[i], b = src[i + 1], c = src[i + s], d = src[i + s + 1];
        var r = ((a & 255) + (b & 255) + (c & 255) + (d & 255)) >> 2;
        var g = (((a >> 8) & 255) + ((b >> 8) & 255) + ((c >> 8) & 255) + ((d >> 8) & 255)) >> 2;
        var bl = (((a >> 16) & 255) + ((b >> 16) & 255) + ((c >> 16) & 255) + ((d >> 16) & 255)) >> 2;
        out[y * ns + x] = (0xFF000000 | (bl << 16) | (g << 8) | r) >>> 0;
      }
    }
    return out;
  }

  /* Цепочка мипмапов 128..8. Для стен храним транспонированно: [tx*s + ty] —
   * столбец идёт подряд в памяти. Для пола/потолка — обычно: [ty*s + tx]. */
  function buildMips(base, columnMajor) {
    var levels = [], cur = base, s = TS;
    while (s >= 8) {
      levels.push({ s: s, mask: s - 1, d: columnMajor ? transpose(cur, s) : cur });
      cur = downsample(cur, s);
      s >>= 1;
    }
    return levels;
  }

  /* Спрайт маяка выхода: светящийся шар с кольцом (аддитивное смешивание). */
  function buildOrb() {
    var S = 64, d = new Uint32Array(S * S);
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
        var r = Math.sqrt(u * u + v * v);
        if (r >= 1) { d[y * S + x] = 0; continue; }
        var edge = (1 - r * r); edge *= edge;
        var core = Math.exp(-r * r * 20);
        var halo = Math.exp(-r * r * 4.5) * 0.55;
        var a = Math.atan2(v, u);
        var rk = (r - 0.7) * 10;
        var ring = Math.exp(-rk * rk) * 0.55 * (0.65 + 0.35 * Math.sin(a * 6));
        d[y * S + x] = pack(
          (255 * core + 40 * halo + 130 * ring) * edge * 1.1,
          (246 * core + 230 * halo + 255 * ring) * edge * 1.1,
          (200 * core + 160 * halo + 225 * ring) * edge * 1.1
        );
      }
    }
    return { w: S, h: S, d: d };
  }

  /* Столб света от пола до потолка. */
  function buildBeam() {
    var W = 32, H = 64, d = new Uint32Array(W * H);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var u = (x + 0.5) / W * 2 - 1, v = (y + 0.5) / H;
        var val = Math.exp(-u * u * 5.5) * Math.pow(Math.sin(PI * v), 0.45);
        d[y * W + x] = pack(50 * val, 235 * val, 170 * val);
      }
    }
    return { w: W, h: H, d: d };
  }

  var assetsReady = false;
  var wallMips = [], floorMips = null, ceilMips = null, orbSpr = null, beamSpr = null;

  function buildAssets() {
    if (assetsReady) return;
    var walls = [
      buildTexture(fBrick),
      buildTexture(makeStone(0.92, 0.98, 1.12, false, 101)),
      buildTexture(makeStone(0.86, 0.97, 0.84, true, 202)),
      buildTexture(fWood)
    ];
    for (var i = 0; i < walls.length; i++) {
      bakeAO(walls[i]);
      wallMips.push(buildMips(walls[i], true));
    }
    floorMips = buildMips(buildTexture(fFloor), false);
    ceilMips = buildMips(buildTexture(fCeil), false);
    orbSpr = buildOrb();
    beamSpr = buildBeam();
    assetsReady = true;
  }

  /* ================================================================
   *  Лабиринт
   * ================================================================ */
  var G = 0;              // сторона сетки в тайлах (2n+1)
  var map = null;         // 0 — свободно, 1..4 — тип стены
  var explored = null;    // тайлы, которых касались лучи
  var distExit = null;    // поле расстояний до выхода (BFS) — для автопилота
  var exitX = 0, exitY = 0; // тайл выхода

  var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

  function bfs(src) {
    var dist = new Int32Array(G * G).fill(-1);
    var q = new Int32Array(G * G), h = 0, t = 0;
    q[t++] = src; dist[src] = 0;
    while (h < t) {
      var c = q[h++], cx = c % G, cy = (c / G) | 0, nd = dist[c] + 1;
      for (var d = 0; d < 4; d++) {
        var nx = cx + DX[d], ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        var ni = ny * G + nx;
        if (map[ni] !== 0 || dist[ni] >= 0) continue;
        dist[ni] = nd; q[t++] = ni;
      }
    }
    return dist;
  }

  /* Связный лабиринт: DFS-бэктрекер -> петли -> комнаты с колонной. */
  function generateMaze(n, seed) {
    G = 2 * n + 1;
    var rng = mulberry32(seed);
    var grid = new Uint8Array(G * G).fill(1);
    var visited = new Uint8Array(n * n);
    var stack = [0], opts = [];
    visited[0] = 1;
    grid[1 * G + 1] = 0;
    while (stack.length) {
      var cur = stack[stack.length - 1], cx = cur % n, cy = (cur / n) | 0;
      opts.length = 0;
      if (cx < n - 1 && !visited[cur + 1]) opts.push(0);
      if (cy < n - 1 && !visited[cur + n]) opts.push(1);
      if (cx > 0 && !visited[cur - 1]) opts.push(2);
      if (cy > 0 && !visited[cur - n]) opts.push(3);
      if (!opts.length) { stack.pop(); continue; }
      var d = opts[(rng() * opts.length) | 0];
      var nx = cx + DX[d], ny = cy + DY[d];
      grid[(2 * cy + 1 + DY[d]) * G + (2 * cx + 1 + DX[d])] = 0;   // стена между клетками
      grid[(2 * ny + 1) * G + (2 * nx + 1)] = 0;
      visited[ny * n + nx] = 1;
      stack.push(ny * n + nx);
    }
    // «плетение»: убираем часть внутренних стен — появляются петли, тупиков меньше
    var braid = 0.08;
    for (var gy = 1; gy < G - 1; gy++) {
      for (var gx = 1; gx < G - 1; gx++) {
        if (((gx + gy) & 1) === 1 && grid[gy * G + gx] === 1 && rng() < braid) grid[gy * G + gx] = 0;
      }
    }
    // комнаты 3x3 тайла с колонной посередине
    var rooms = n >= 9 ? Math.floor(n * n / 50) : 0;
    for (var r = 0; r < rooms; r++) {
      var ra = (rng() * (n - 1)) | 0, rb = (rng() * (n - 1)) | 0;
      for (var yy = 2 * rb + 1; yy <= 2 * rb + 3; yy++) {
        for (var xx = 2 * ra + 1; xx <= 2 * ra + 3; xx++) {
          if (xx === 2 * ra + 2 && yy === 2 * rb + 2) continue;
          grid[yy * G + xx] = 0;
        }
      }
    }
    // тип материала стен — по крупным областям 4x4 тайла
    for (var y2 = 0; y2 < G; y2++) {
      for (var x2 = 0; x2 < G; x2++) {
        if (grid[y2 * G + x2] !== 0) {
          grid[y2 * G + x2] = 1 + ((hash2(x2 >> 2, y2 >> 2, seed) * 4) | 0);
        }
      }
    }
    return grid;
  }

  /* ================================================================
   *  Состояние игры
   * ================================================================ */
  var S = {
    px: 1.5, py: 1.5, ang: 0, vx: 0, vy: 0, av: 0,
    fov: 78 * PI / 180,
    bob: 0, bobPhase: 0, bobOff: false, flicker: 1, t: 0,
    auto: true, fogMap: false, mapBig: false,
    level: 1, seed: 0, n: 15,
    stuckT: 0, exitFlash: 0
  };

  var PLAYER_R = 0.22;
  var MOVE_SPEED = 3.2, TURN_SPEED = 2.4;

  function newMaze(n, seed, level) {
    buildAssets();
    n = clamp(n | 0, 3, 41);
    S.n = n; S.seed = seed >>> 0; S.level = level || 1;
    map = generateMaze(n, S.seed);
    explored = new Uint8Array(G * G);

    var start = 1 * G + 1;
    var d0 = bfs(start), best = 0, bi = start;
    for (var i = 0; i < d0.length; i++) if (d0[i] > best) { best = d0[i]; bi = i; }
    exitX = bi % G; exitY = (bi / G) | 0;
    distExit = bfs(bi);

    S.px = 1.5; S.py = 1.5;
    S.ang = map[1 * G + 2] === 0 ? 0 : PI / 2;
    S.vx = S.vy = S.av = 0;
    S.stuckT = 0;
    markExplored(S.px, S.py);
  }

  function markExplored(x, y) {
    var cx = Math.floor(x), cy = Math.floor(y);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var gx = cx + dx, gy = cy + dy;
        if (gx >= 0 && gy >= 0 && gx < G && gy < G) explored[gy * G + gx] = 1;
      }
    }
  }

  /* ---------- коллизии: квадрат со стороной 2R, раздельно по осям — скольжение ---------- */
  function solidAt(x, y) {
    var gx = Math.floor(x), gy = Math.floor(y);
    if (gx < 0 || gy < 0 || gx >= G || gy >= G) return true;
    return map[gy * G + gx] !== 0;
  }
  function blocked(x, y, r) {
    return solidAt(x - r, y - r) || solidAt(x + r, y - r) || solidAt(x - r, y + r) || solidAt(x + r, y + r);
  }
  function moveBy(dx, dy) {
    var steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.07));
    var sx = dx / steps, sy = dy / steps;
    for (var i = 0; i < steps; i++) {
      if (!blocked(S.px + sx, S.py, PLAYER_R)) S.px += sx;
      if (!blocked(S.px, S.py + sy, PLAYER_R)) S.py += sy;
    }
  }
  function clearLine(x0, y0, x1, y1, r) {
    var dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.hypot(dx, dy) / 0.1);
    for (var i = 1; i <= n; i++) {
      var t = i / n;
      if (blocked(x0 + dx * t, y0 + dy * t, r)) return false;
    }
    return true;
  }

  /* ---------- автопилот: спуск по полю расстояний + срезание углов ---------- */
  function autopilot() {
    var cx = Math.floor(S.px), cy = Math.floor(S.py), pts = [];
    for (var k = 0; k < 5; k++) {
      var bd = distExit[cy * G + cx], bx = -1, by = -1;
      for (var d = 0; d < 4; d++) {
        var nx = cx + DX[d], ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        var dd = distExit[ny * G + nx];
        if (dd >= 0 && dd < bd) { bd = dd; bx = nx; by = ny; }
      }
      if (bx < 0) break;
      cx = bx; cy = by;
      pts.push(cx + 0.5, cy + 0.5);
    }
    var tx = exitX + 0.5, ty = exitY + 0.5;
    if (pts.length) {
      tx = pts[0]; ty = pts[1];
      for (var i = pts.length / 2 - 1; i > 0; i--) {
        if (clearLine(S.px, S.py, pts[2 * i], pts[2 * i + 1], 0.31)) { tx = pts[2 * i]; ty = pts[2 * i + 1]; break; }
      }
    }
    var diff = wrapPi(Math.atan2(ty - S.py, tx - S.px) - S.ang);
    var f = Math.cos(clamp(diff, -1.4, 1.4));
    return { fwd: f > 0 ? f * f : 0, rate: clamp(diff * 6, -3.4, 3.4) };
  }

  /* ---------- ввод (заполняется из DOM; в node остаётся пустым) ---------- */
  var held = {}, tapT = {};
  var drag = { active: false, engaged: false, ox: 0, oy: 0, x: 0, y: 0 };
  function down(code) { return !!held[code] || (tapT[code] || 0) > 0; }

  var hooks = { onExit: null, onAutoChange: null };

  function update(dt) {
    S.t += dt;
    S.flicker = 0.955 + 0.03 * Math.sin(S.t * 7.3) + 0.015 * Math.sin(S.t * 17.1 + 1.0);
    for (var c in tapT) if (tapT[c] > 0) tapT[c] -= dt;

    var fwd = 0, str = 0, turnRate = 0, run = 1;
    if (S.auto) {
      var a = autopilot();
      fwd = a.fwd; turnRate = a.rate; run = 0.9;
    } else {
      fwd = (down('KeyW') || down('ArrowUp') ? 1 : 0) - (down('KeyS') || down('ArrowDown') ? 1 : 0);
      str = (down('KeyD') ? 1 : 0) - (down('KeyA') ? 1 : 0);
      var turn = (down('ArrowRight') || down('KeyE') ? 1 : 0) - (down('ArrowLeft') || down('KeyQ') ? 1 : 0);
      if (drag.active && drag.engaged) {
        fwd += clamp(-(drag.y - drag.oy) / 70, -1, 1);
        turn += clamp((drag.x - drag.ox) / 70, -1, 1);
      }
      turnRate = clamp(turn, -1, 1) * TURN_SPEED;
      fwd = clamp(fwd, -1, 1);
      if (down('ShiftLeft') || down('ShiftRight')) run = 1.6;
    }

    // поворот с лёгкой инерцией
    S.av += (turnRate - S.av) * Math.min(1, dt * 14);
    S.ang += S.av * dt;
    if (S.ang > PI) S.ang -= 2 * PI; else if (S.ang < -PI) S.ang += 2 * PI;

    // желаемая скорость в мировых осях: вперёд (cos,sin) и вправо (-sin,cos)
    var dirX = Math.cos(S.ang), dirY = Math.sin(S.ang);
    var tvx = dirX * fwd - dirY * str, tvy = dirY * fwd + dirX * str;
    var m = Math.hypot(tvx, tvy);
    if (m > 1) { tvx /= m; tvy /= m; }
    tvx *= MOVE_SPEED * run; tvy *= MOVE_SPEED * run;
    var k = Math.min(1, dt * 11);
    S.vx += (tvx - S.vx) * k; S.vy += (tvy - S.vy) * k;

    var ox = S.px, oy = S.py;
    moveBy(S.vx * dt, S.vy * dt);
    var moved = Math.hypot(S.px - ox, S.py - oy);
    var speed = dt > 0 ? moved / dt : 0;
    markExplored(S.px, S.py);

    // покачивание головы по фактической скорости
    S.bobPhase += speed * dt * 2.7;
    var bobK = S.bobOff ? 0 : Math.min(1, speed / MOVE_SPEED);
    S.bob += ((Math.sin(S.bobPhase) * bufH * 0.0075 * bobK) - S.bob) * Math.min(1, dt * 20);

    // страховка автопилота от залипания
    if (S.auto && fwd > 0.5 && moved < 0.25 * MOVE_SPEED * run * dt) S.stuckT += dt; else S.stuckT = 0;
    if (S.stuckT > 1.2) {
      S.px = Math.floor(S.px) + 0.5; S.py = Math.floor(S.py) + 0.5;
      S.vx = S.vy = 0; S.stuckT = 0;
    }

    // выход найден
    if (Math.hypot(S.px - (exitX + 0.5), S.py - (exitY + 0.5)) < 0.55) {
      var lvl = S.level + 1;
      newMaze(S.n, (hash2(S.seed, lvl, 77) * 4294967296) >>> 0, lvl);
      if (hooks.onExit) hooks.onExit(lvl);
    }
  }

  /* ================================================================
   *  Рендер в программный буфер
   * ================================================================ */
  var bufW = 0, bufH = 0, buf32 = null, zbuf = null;

  function setBuffer(w, h, u32) {
    bufW = w; bufH = h; buf32 = u32;
    zbuf = new Float32Array(w);
  }

  var WARM_R = 1.0, WARM_G = 0.92, WARM_B = 0.78;
  var AMB_R = 0.012, AMB_G = 0.018, AMB_B = 0.035;
  var FAR_COLOR = pack(1, 2, 5);
  // яркость граней: N, W, E, S
  var FACE_N = 0.58, FACE_W = 0.74, FACE_E = 0.88, FACE_S = 1.0;

  function fog(d) {
    var l = 1.2 * Math.exp(-0.31 * d);
    return l > 1 ? 1 : l;
  }

  function render() {
    var W = bufW, H = bufH, buf = buf32;
    var planeLen = Math.tan(S.fov * 0.5);
    var dirX = Math.cos(S.ang), dirY = Math.sin(S.ang);
    var plX = -dirY * planeLen, plY = dirX * planeLen;        // вектор «вправо» экрана
    var focal = W / (2 * planeLen);                           // пикселей на единицу при глубине 1
    var hz = (H >> 1) + Math.round(S.bob);                    // горизонт
    var px = S.px, py = S.py, flick = S.flicker;
    var x, y, o;

    /* ---------- пол и потолок (floor casting по строкам) ---------- */
    var rdx0 = dirX - plX, rdy0 = dirY - plY;
    var rdx1 = dirX + plX, rdy1 = dirY + plY;
    for (y = 0; y < H; y++) {
      var p = y + 0.5 - hz, isFloor = p > 0, ap = isFloor ? p : -p;
      var d = 0.5 * focal / ap;                               // перпендикулярная глубина строки
      o = y * W;
      if (d > 26) {
        for (x = 0; x < W; x++) buf[o + x] = FAR_COLOR;
        continue;
      }
      var L = fog(d) * flick * (isFloor ? 1 : 0.85);
      var mr = Math.min(256, ((L * WARM_R + AMB_R) * 256) | 0);
      var mg = Math.min(256, ((L * WARM_G + AMB_G) * 256) | 0);
      var mb = Math.min(256, ((L * WARM_B + AMB_B) * 256) | 0);
      var lim = focal / (d * d), lv = 0, s = TS;
      while (lv < 4 && s > lim) { s >>= 1; lv++; }
      var tex = (isFloor ? floorMips : ceilMips)[lv], data = tex.d, mask = tex.mask;
      var scale = s * 0.5;                                    // текстура покрывает 2 клетки
      var u = (px + rdx0 * d) * scale, v = (py + rdy0 * d) * scale;
      var du = d * (rdx1 - rdx0) / W * scale, dv = d * (rdy1 - rdy0) / W * scale;
      for (x = 0; x < W; x++) {
        var c = data[((v | 0) & mask) * s + ((u | 0) & mask)];
        buf[o + x] = 0xFF000000
          | ((((c >> 16) & 255) * mb >> 8) << 16)
          | ((((c >> 8) & 255) * mg >> 8) << 8)
          | ((c & 255) * mr >> 8);
        u += du; v += dv;
      }
    }

    /* ---------- стены: DDA по сетке, по лучу на столбец ---------- */
    var gridW = G, mp = map, maxSteps = G * 2 + 8;
    for (x = 0; x < W; x++) {
      var camX = 2 * (x + 0.5) / W - 1;
      var rdx = dirX + plX * camX, rdy = dirY + plY * camX;
      var mapX = Math.floor(px), mapY = Math.floor(py);
      var ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);         // длина луча между вертикальными линиями
      var ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      var stepX, stepY, sdx, sdy;
      if (rdx < 0) { stepX = -1; sdx = (px - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - px) * ddx; }
      if (rdy < 0) { stepY = -1; sdy = (py - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - py) * ddy; }
      var side = 0, hit = 0;
      for (var it = 0; it < maxSteps; it++) {
        if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; } else { sdy += ddy; mapY += stepY; side = 1; }
        if (mapX < 0 || mapY < 0 || mapX >= gridW || mapY >= gridW) { hit = 1; break; }
        var mi = mapY * gridW + mapX;
        explored[mi] = 1;
        hit = mp[mi];
        if (hit !== 0) break;
      }
      if (hit === 0) hit = 1;
      // расстояние ПЕРПЕНДИКУЛЯРНО плоскости камеры (не евклидово) — нет «рыбьего глаза»
      var perp = side === 0 ? sdx - ddx : sdy - ddy;
      if (perp < 0.02) perp = 0.02;
      zbuf[x] = perp;

      var wx = side === 0 ? py + perp * rdy : px + perp * rdx;
      wx -= Math.floor(wx);
      var lh = focal / perp;                                  // высота стены на экране
      var top = hz - lh * 0.5;
      var y0 = Math.ceil(top - 0.5), y1 = Math.ceil(hz + lh * 0.5 - 0.5) - 1;
      if (y0 < 0) y0 = 0;
      if (y1 >= H) y1 = H - 1;
      if (y1 < y0) continue;

      var wlv = 0, ws = TS;
      while (wlv < 4 && ws > lh) { ws >>= 1; wlv++; }
      var wl = wallMips[(hit - 1) & 3][wlv], wdata = wl.d;
      var tx = (wx * ws) | 0;
      if (tx >= ws) tx = ws - 1;
      // чтобы текстура не зеркалилась: u растёт вправо от зрителя
      if ((side === 0 && rdx < 0) || (side === 1 && rdy > 0)) tx = ws - 1 - tx;

      // яркость грани: у каждой из четырёх сторон своя
      var face = side === 0 ? (rdx > 0 ? FACE_W : FACE_E) : (rdy > 0 ? FACE_N : FACE_S);
      var wL = fog(perp) * flick * face;
      var wmr = Math.min(256, ((wL * WARM_R + AMB_R) * 256) | 0);
      var wmg = Math.min(256, ((wL * WARM_G + AMB_G) * 256) | 0);
      var wmb = Math.min(256, ((wL * WARM_B + AMB_B) * 256) | 0);

      var base = tx * ws, step = ws / lh, tpos = (y0 + 0.5 - top) * step;
      var idx = y0 * W + x;
      for (var yy = y0; yy <= y1; yy++) {
        var ty = tpos | 0;
        if (ty >= ws) ty = ws - 1;
        tpos += step;
        var cc = wdata[base + ty];
        buf[idx] = 0xFF000000
          | ((((cc >> 16) & 255) * wmb >> 8) << 16)
          | ((((cc >> 8) & 255) * wmg >> 8) << 8)
          | ((cc & 255) * wmr >> 8);
        idx += W;
      }
    }

    /* ---------- спрайты: маяк выхода (аддитивно, с проверкой z-буфера) ---------- */
    var ex = exitX + 0.5, ey = exitY + 0.5;
    var pulse = 0.85 + 0.15 * Math.sin(S.t * 3.1);
    drawSprite(ex, ey, 0.5, 1.0, 0.5, beamSpr, 0.5 * pulse, hz, focal, dirX, dirY, plX, plY);
    drawSprite(ex, ey, 0.56 + 0.04 * Math.sin(S.t * 3.1), 0.56 + 0.04 * Math.sin(S.t * 3.1),
      0.5 + 0.05 * Math.sin(S.t * 2.2), orbSpr, 1.0 * pulse, hz, focal, dirX, dirY, plX, plY);
  }

  function drawSprite(wxp, wyp, wW, wH, zc, spr, inten, hz, focal, dirX, dirY, plX, plY) {
    var W = bufW, H = bufH, buf = buf32;
    var dx = wxp - S.px, dy = wyp - S.py;
    var invDet = 1 / (plX * dirY - dirX * plY);
    var tX = invDet * (dirY * dx - dirX * dy);                // вбок (в долях плоскости)
    var tY = invDet * (-plY * dx + plX * dy);                 // глубина
    if (tY < 0.12) return;
    var sxc = (W / 2) * (1 + tX / tY);
    var pw = wW * focal / tY, ph = wH * focal / tY;
    var cy = hz + (0.5 - zc) * focal / tY;
    var left = sxc - pw / 2, topY = cy - ph / 2;
    var xa = Math.max(0, Math.floor(left)), xb = Math.min(W - 1, Math.ceil(left + pw));
    var ya = Math.max(0, Math.floor(topY)), yb = Math.min(H - 1, Math.ceil(topY + ph));
    if (xa > xb || ya > yb) return;
    var k = Math.min(1, inten / (1 + 0.012 * tY * tY)) * 256 | 0;
    var sw = spr.w, sh = spr.h, sd = spr.d;
    for (var x = xa; x <= xb; x++) {
      if (tY >= zbuf[x]) continue;
      var u = ((x + 0.5 - left) / pw * sw) | 0;
      if (u < 0 || u >= sw) continue;
      for (var y = ya; y <= yb; y++) {
        var v = ((y + 0.5 - topY) / ph * sh) | 0;
        if (v < 0 || v >= sh) continue;
        var c = sd[v * sw + u];
        if ((c & 0xFFFFFF) === 0) continue;
        var i = y * W + x, dst = buf[i];
        var r = (dst & 255) + (((c & 255) * k) >> 8);
        var g = ((dst >> 8) & 255) + ((((c >> 8) & 255) * k) >> 8);
        var b = ((dst >> 16) & 255) + ((((c >> 16) & 255) * k) >> 8);
        buf[i] = 0xFF000000 | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
      }
    }
  }

  /* ================================================================
   *  Экспорт для node-тестов
   * ================================================================ */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      S: S, newMaze: newMaze, update: update, render: render, setBuffer: setBuffer,
      held: held, tapT: tapT, buildAssets: buildAssets,
      getMap: function () { return { map: map, G: G, exitX: exitX, exitY: exitY, distExit: distExit, explored: explored }; },
      zbuf: function () { return zbuf; }, blocked: blocked, moveBy: moveBy, generateMaze: generateMaze
    };
    return;
  }

  /* ================================================================
   *  Браузерная обвязка: DOM, ввод, мини-карта, цикл кадров
   * ================================================================ */
  var RES = [
    { h: 240, name: 'крупные' },
    { h: 360, name: 'средние' },
    { h: 540, name: 'мелкие' }
  ];
  var resIdx = 1;
  var WALL_COL = ['#b9583f', '#7d8aa8', '#6fa257', '#a97d47'];

  function $(id) { return document.getElementById(id); }

  function init() {
    var view = $('view'), ui = $('ui');
    var vctx = view.getContext('2d', { alpha: false });
    var octx = ui.getContext('2d');
    var elStats = $('stats'), elStatus = $('status'), elToast = $('toast');
    var btnAuto = $('btnAuto'), btnNew = $('btnNew'), btnRes = $('btnRes'), btnFog = $('btnFog'), btnMap = $('btnMap');
    var rngSize = $('rngSize'), outSize = $('outSize'), rngFov = $('rngFov'), outFov = $('outFov');

    var cssW = 1, cssH = 1, dpr = 1, img = null;
    var reduceMotion = false;
    try { reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }

    /* ---------- размеры: вид — программный буфер, оверлей — по DPR (потолок 2) ---------- */
    function resize() {
      cssW = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
      cssH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      var uw = Math.round(cssW * dpr), uh = Math.round(cssH * dpr);
      if (ui.width !== uw || ui.height !== uh) { ui.width = uw; ui.height = uh; }
      var bh = Math.min(RES[resIdx].h, Math.max(120, Math.round(cssH * dpr)));
      var bw = clamp(Math.round(bh * cssW / cssH), 160, 2400);
      if (bw !== bufW || bh !== bufH || !img) {
        view.width = bw; view.height = bh;
        img = vctx.createImageData(bw, bh);
        setBuffer(bw, bh, new Uint32Array(img.data.buffer));
      }
    }

    /* ---------- подписи ---------- */
    var STATUS_AUTO = '<b>Демо: автопилот ведёт к выходу.</b> Нажмите <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> или <kbd>←</kbd><kbd>→</kbd> — управление перейдёт к вам';
    var STATUS_MANUAL = '<kbd>W</kbd><kbd>S</kbd> вперёд/назад · <kbd>A</kbd><kbd>D</kbd> шаг в сторону · <kbd>←</kbd><kbd>→</kbd> поворот · <kbd>Shift</kbd> бег · <kbd>M</kbd> карта · найдите зелёный маяк';

    function setAuto(on) {
      on = !!on;
      if (S.auto === on) return;
      S.auto = on;
      refreshAutoUi();
    }
    function refreshAutoUi() {
      btnAuto.textContent = 'Автопилот: ' + (S.auto ? 'вкл' : 'выкл');
      btnAuto.setAttribute('aria-pressed', S.auto ? 'true' : 'false');
      elStatus.innerHTML = S.auto ? STATUS_AUTO : STATUS_MANUAL;
    }
    function refreshMapUi() {
      btnFog.textContent = 'Карта: ' + (S.fogMap ? 'открытая' : 'вся');
      btnFog.setAttribute('aria-pressed', S.fogMap ? 'true' : 'false');
      btnMap.setAttribute('aria-pressed', S.mapBig ? 'true' : 'false');
    }

    var toastTimer = 0;
    function showToast(html, sec) {
      elToast.innerHTML = html;
      elToast.classList.add('show');
      toastTimer = sec;
    }
    hooks.onExit = function (lvl) {
      showToast('Выход найден!<small>Уровень ' + lvl + ' — новый лабиринт ' + S.n + '×' + S.n + '</small>', 2.4);
    };

    function randomSeed() { return (Math.random() * 4294967296) >>> 0; }
    function regenerate() { newMaze(+rngSize.value, randomSeed(), 1); }

    /* ---------- элементы управления ---------- */
    btnAuto.addEventListener('click', function () { setAuto(!S.auto); btnAuto.blur(); });
    btnNew.addEventListener('click', function () { regenerate(); btnNew.blur(); });
    rngSize.addEventListener('input', function () { outSize.textContent = rngSize.value; regenerate(); });
    rngSize.addEventListener('change', function () { rngSize.blur(); });
    rngFov.addEventListener('input', function () {
      S.fov = (+rngFov.value) * PI / 180;
      outFov.textContent = rngFov.value + '°';
    });
    rngFov.addEventListener('change', function () { rngFov.blur(); });
    btnRes.addEventListener('click', function () {
      resIdx = (resIdx + 1) % RES.length;
      btnRes.textContent = 'Пиксели: ' + RES[resIdx].name;
      resize();
      btnRes.blur();
    });
    btnFog.addEventListener('click', function () { S.fogMap = !S.fogMap; refreshMapUi(); btnFog.blur(); });
    btnMap.addEventListener('click', function () { S.mapBig = !S.mapBig; refreshMapUi(); btnMap.blur(); });

    /* ---------- клавиатура: по e.code, работает в любой раскладке ---------- */
    var CONTROL = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyQ: 1, KeyE: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var c = e.code;
      if (CONTROL[c]) {
        held[c] = true;
        if (!e.repeat) tapT[c] = 0.14;          // короткое нажатие всё равно даёт заметный шаг
        if (S.auto) setAuto(false);
        e.preventDefault();
      } else if (c === 'ShiftLeft' || c === 'ShiftRight') {
        held[c] = true;
      } else if (!e.repeat) {
        if (c === 'KeyM') { S.mapBig = !S.mapBig; refreshMapUi(); }
        else if (c === 'KeyR') regenerate();
        else if (c === 'KeyP') setAuto(!S.auto);
      }
    });
    window.addEventListener('keyup', function (e) { held[e.code] = false; });
    window.addEventListener('blur', function () { for (var k in held) held[k] = false; drag.active = false; });

    /* ---------- мышь/касание: зажать и вести как «джойстик» ---------- */
    ui.addEventListener('pointerdown', function (e) {
      drag.active = true; drag.engaged = false;
      drag.ox = drag.x = e.clientX; drag.oy = drag.y = e.clientY;
      try { ui.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      window.focus();
    });
    ui.addEventListener('pointermove', function (e) {
      if (!drag.active) return;
      drag.x = e.clientX; drag.y = e.clientY;
      if (!drag.engaged && Math.hypot(drag.x - drag.ox, drag.y - drag.oy) > 12) {
        drag.engaged = true;
        if (S.auto) setAuto(false);
      }
    });
    function endDrag() { drag.active = false; drag.engaged = false; }
    ui.addEventListener('pointerup', endDrag);
    ui.addEventListener('pointercancel', endDrag);

    /* ---------- мини-карта ---------- */
    function rrect(g, x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }

    function drawMinimap() {
      var g = octx, big = S.mapBig;
      var size, mx, my;
      if (big) {
        size = clamp(Math.min(cssW - 32, cssH - 150), 160, 640);
        mx = (cssW - size) / 2; my = Math.max(14, (cssH - size - 96) / 2);
      } else {
        size = clamp(Math.min(cssW, cssH) * 0.3, 118, 232);
        mx = cssW - size - 16; my = 16;
      }
      var vc = big ? G : Math.min(G, 23);
      var cell = size / vc;
      var wx = clamp(S.px - vc / 2, 0, G - vc), wy = clamp(S.py - vc / 2, 0, G - vc);

      g.save();
      rrect(g, mx, my, size, size, 12);
      g.fillStyle = big ? 'rgba(7,9,15,0.82)' : 'rgba(7,9,15,0.62)';
      g.fill();
      g.clip();

      var gx0 = Math.max(0, Math.floor(wx)), gx1 = Math.min(G - 1, Math.ceil(wx + vc) - 1);
      var gy0 = Math.max(0, Math.floor(wy)), gy1 = Math.min(G - 1, Math.ceil(wy + vc) - 1);
      var fogOn = S.fogMap;
      for (var gy = gy0; gy <= gy1; gy++) {
        for (var gx = gx0; gx <= gx1; gx++) {
          var i = gy * G + gx;
          if (fogOn && !explored[i]) continue;
          var v = map[i];
          g.fillStyle = v ? WALL_COL[(v - 1) & 3] : '#1a2030';
          g.fillRect(mx + (gx - wx) * cell, my + (gy - wy) * cell, cell + 0.6, cell + 0.6);
        }
      }

      // выход
      if (!fogOn || explored[exitY * G + exitX]) {
        var ecx = mx + (exitX + 0.5 - wx) * cell, ecy = my + (exitY + 0.5 - wy) * cell;
        var er = cell * (0.42 + 0.14 * Math.sin(S.t * 4));
        g.beginPath(); g.arc(ecx, ecy, Math.max(2.5, er), 0, 2 * PI);
        g.fillStyle = 'rgba(95,240,180,0.9)'; g.fill();
        g.beginPath(); g.arc(ecx, ecy, Math.max(4, er * 1.9), 0, 2 * PI);
        g.strokeStyle = 'rgba(95,240,180,0.45)'; g.lineWidth = 1.2; g.stroke();
      }

      // сектор обзора: многоугольник по реальным точкам попадания лучей
      var ppx = mx + (S.px - wx) * cell, ppy = my + (S.py - wy) * cell;
      var planeLen = Math.tan(S.fov * 0.5);
      var dX = Math.cos(S.ang), dY = Math.sin(S.ang);
      var plX = -dY * planeLen, plY = dX * planeLen;
      var W = bufW, nRays = Math.min(W, 96);
      g.beginPath();
      g.moveTo(ppx, ppy);
      for (var ri = 0; ri < nRays; ri++) {
        var xc = Math.round(ri * (W - 1) / (nRays - 1));
        var camX = 2 * (xc + 0.5) / W - 1;
        var dist = Math.min(zbuf[xc], 40);
        g.lineTo(ppx + (dX + plX * camX) * dist * cell, ppy + (dY + plY * camX) * dist * cell);
      }
      g.closePath();
      g.fillStyle = 'rgba(255,214,120,0.22)';
      g.fill();
      g.strokeStyle = 'rgba(255,214,120,0.55)';
      g.lineWidth = 1;
      g.stroke();

      // игрок: точка + стрелка направления
      var pr = Math.max(3, cell * 0.36);
      g.beginPath();
      g.moveTo(ppx + dX * pr * 2.1, ppy + dY * pr * 2.1);
      g.lineTo(ppx - dY * pr * 0.95 - dX * pr * 0.7, ppy + dX * pr * 0.95 - dY * pr * 0.7);
      g.lineTo(ppx + dY * pr * 0.95 - dX * pr * 0.7, ppy - dX * pr * 0.95 - dY * pr * 0.7);
      g.closePath();
      g.fillStyle = '#ffd166'; g.fill();
      g.beginPath(); g.arc(ppx, ppy, pr * 0.75, 0, 2 * PI);
      g.fillStyle = '#fff3cf'; g.fill();
      g.lineWidth = 1.2; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.stroke();

      g.restore();

      // рамка и «N»
      rrect(g, mx + 0.5, my + 0.5, size - 1, size - 1, 12);
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.22)'; g.stroke();
      g.font = '600 11px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillStyle = 'rgba(255,255,255,0.65)';
      g.fillText('N', mx + size / 2, my + 5);
    }

    function drawUI() {
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.clearRect(0, 0, cssW, cssH);
      drawMinimap();
    }

    /* ---------- цикл кадров ---------- */
    var last = 0, fps = 60, hudT = 0;
    function frame(ts) {
      window.requestAnimationFrame(frame);
      if (!last) last = ts;
      var rawDt = (ts - last) / 1000;
      last = ts;
      var dt = clamp(rawDt, 0, 0.05);                      // кламп больших dt (вкладка в фоне и т.п.)
      if (rawDt > 0) fps += (clamp(1 / rawDt, 1, 240) - fps) * 0.08;

      update(dt);
      render();
      vctx.putImageData(img, 0, 0);
      drawUI();

      if (toastTimer > 0) {
        toastTimer -= dt;
        if (toastTimer <= 0) elToast.classList.remove('show');
      }
      hudT -= dt;
      if (hudT <= 0) {
        hudT = 0.25;
        elStats.textContent = 'Уровень ' + S.level + ' · ' + S.n + '×' + S.n + ' · seed ' + S.seed.toString(16) +
          ' · ' + bufW + '×' + bufH + ' · ' + Math.round(fps) + ' fps';
      }
    }

    /* ---------- старт ---------- */
    buildAssets();
    resize();
    window.addEventListener('resize', resize);
    newMaze(+rngSize.value, 0x5EED1E, 1);               // детерминированный первый лабиринт
    refreshAutoUi();
    refreshMapUi();
    btnRes.textContent = 'Пиксели: ' + RES[resIdx].name;
    outSize.textContent = rngSize.value;
    outFov.textContent = rngFov.value + '°';
    if (reduceMotion) S.bobOff = true;
    try { window.focus(); document.body.focus(); } catch (e) { /* ignore */ }

    window.raycaster = { state: S, newMaze: newMaze, setAuto: setAuto, held: held };
    window.requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
