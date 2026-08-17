/* Рейкастер-лабиринт — Claude Opus 5
 * Псевдо-3D в духе Wolfenstein 3D: процедурный связный лабиринт,
 * DDA-рейкастинг по сетке, перпендикулярная дистанция (без «рыбьего глаза»),
 * попиксельная отрисовка пола/потолка, процедурные текстуры, мини-карта.
 * Только Canvas 2D: ни WebGL, ни библиотек, ни внешних ресурсов.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------- константы --
  var TW = 64, TMASK = 63;      // сторона процедурной текстуры
  var SHADES = 32;              // ступеней освещённости в LUT
  var FOG_R = 12, FOG_G = 16, FOG_B = 26;   // цвет дымки вдали
  var MOVE = 3.0;               // клеток в секунду
  var RUN = 1.75;
  var ROT = 2.5;                // радиан в секунду
  var RADIUS = 0.24;            // радиус игрока для коллизий
  var CELLS = 11;               // клеток лабиринта по стороне -> карта 23×23
  var PIX_CAP_MAX = 850000;     // потолок пикселей внутреннего буфера
  var PIX_CAP_MIN = 120000;

  // ----------------------------------------------------------- мелкая мат. --
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // детерминированный «шум» по двум целым
  function hash2(x, y) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }

  // упаковка в ABGR (little-endian Uint32 поверх ImageData)
  function pack(r, g, b) {
    r = r < 0 ? 0 : (r > 255 ? 255 : r | 0);
    g = g < 0 ? 0 : (g > 255 ? 255 : g | 0);
    b = b < 0 ? 0 : (b > 255 ? 255 : b | 0);
    return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
  }

  // -------------------------------------------------------- текстуры (proc) --
  // Текстура натянута ровно на одну грань клетки: v — высота стены, u — её ширина.
  // Поэтому «затенение» можно запечь прямо в текселях: свет падает сверху,
  // а стыки клеток (u у краёв) слегка притемнены — грани читаются как объём.
  function relief(x, y) {
    var g = 1.08 - 0.30 * (y / 63);
    var e = Math.min(x, 63 - x);
    if (e < 3) g *= 0.88 + 0.04 * e;
    return g;
  }

  // Кирпичная кладка со скосами, разбросом тона и (опционально) мхом.
  function makeStone(seed, br, bg, bb, mr, mg, mb, moss) {
    var t = new Uint32Array(TW * TW);
    for (var y = 0; y < TW; y++) {
      for (var x = 0; x < TW; x++) {
        var row = (y / 16) | 0;
        var ox = (row & 1) ? (x + 16) & TMASK : x;   // смещение чётных рядов
        var ly = y & 15, lx = ox & 31;
        var r, g, b;
        if (ly < 2 || lx < 2) {                      // раствор
          var mn = (hash2(x * 3 + seed, y * 5 - seed) - 0.5) * 14;
          r = mr + mn; g = mg + mn; b = mb + mn;
        } else {                                     // тело кирпича
          var tint = (hash2(row * 7 + ((ox / 32) | 0) + seed * 97, seed) - 0.5) * 33;
          var bevel = 0;
          if (ly === 2) bevel = 17; else if (ly >= 14) bevel = -19;
          if (lx === 2) bevel += 9; else if (lx >= 30) bevel -= 13;
          var n = (hash2(x + seed * 31, y - seed * 17) - 0.5) * 16;
          r = br + tint + bevel + n;
          g = bg + tint + bevel + n;
          b = bb + tint + bevel + n;
        }
        if (moss) {
          var m = hash2((x >> 2) + seed * 13, (y >> 2) - seed * 7);
          if (m > 0.70) {
            var k = clamp((m - 0.70) * 2.8, 0, 1);
            r += (74 - r) * k * 0.40;
            g += (112 - g) * k * 0.60;
            b += (60 - b) * k * 0.34;
          }
        }
        var vg = relief(x, y);
        t[y * TW + x] = pack(r * vg, g * vg, b * vg);
      }
    }
    return t;
  }

  // Металлические панели с швами и заклёпками.
  function makeMetal(seed) {
    var t = new Uint32Array(TW * TW);
    for (var y = 0; y < TW; y++) {
      for (var x = 0; x < TW; x++) {
        var lx = x & 15, ly = y & 15;
        var v = 98;
        v += (hash2(x * 7 + seed, y) - 0.5) * 9;            // зерно
        v += (hash2(x + seed, (y >> 1) * 3) - 0.5) * 13;    // вертикальный «браш»
        if (lx === 0) v -= 36; else if (lx === 1) v += 15; else if (lx === 15) v -= 22;
        if ((y & 31) === 0) v -= 26; else if ((y & 31) === 1) v += 12;
        var cx = lx - 8, cy = ly - 8;
        var d2 = cx * cx + cy * cy;
        if (d2 < 6) v += (cx + cy) < 0 ? 38 : -22;          // заклёпка
        v *= relief(x, y);
        t[y * TW + x] = pack(v * 0.90, v * 0.97, v * 1.13);
      }
    }
    return t;
  }

  // Тканое полотно с золотой эмблемой — редкий акцент на стенах.
  function makeBanner(seed) {
    var t = new Uint32Array(TW * TW);
    for (var y = 0; y < TW; y++) {
      for (var x = 0; x < TW; x++) {
        var r, g, b;
        var n = (hash2(x * 5 + seed, y * 3 - seed) - 0.5) * 11;
        if (x < 3 || x > 60 || y < 3 || y > 60) {           // тёмная рама
          r = 48; g = 42; b = 40;
        } else {
          var dx = x - 31.5, dy = y - 31.5;
          var rh = Math.abs(dx) + Math.abs(dy);
          var rr = Math.sqrt(dx * dx + dy * dy);
          r = 98; g = 27; b = 31;                            // полотно
          r += Math.sin(x * 0.5) * 5; g += Math.sin(x * 0.5) * 2;
          if (rh < 27.5 && rh > 23.5) { r = 196; g = 158; b = 74; }
          else if (rr < 11 && rr > 8) { r = 190; g = 152; b = 70; }
          else if (rr < 5) { r = 214; g = 180; b = 96; }
        }
        var vg = relief(x, y);
        t[y * TW + x] = pack((r + n) * vg, (g + n) * vg, (b + n) * vg);
      }
    }
    return t;
  }

  // Каменные плиты пола: швы, лёгкий разброс тона плит, крошка.
  function makeFloor(seed) {
    var t = new Uint32Array(TW * TW);
    for (var y = 0; y < TW; y++) {
      for (var x = 0; x < TW; x++) {
        var lx = x & 31, ly = y & 31;
        var tile = ((x >> 5) + (y >> 5) * 2);
        var v = 70 + (hash2(tile * 11 + seed, seed * 3) - 0.5) * 13;
        if (lx < 2 || ly < 2) v -= 26;
        else if (lx === 2 || ly === 2) v += 9;
        v += (hash2(x + seed * 11, y + seed * 5) - 0.5) * 13;
        if (hash2(x * 13 + seed, y * 29) > 0.965) v += 24;
        t[y * TW + x] = pack(v * 0.94, v * 0.97, v * 1.07);
      }
    }
    return t;
  }

  // Потолок: тёмный бетон с редкой сеткой балок.
  function makeCeil(seed) {
    var t = new Uint32Array(TW * TW);
    for (var y = 0; y < TW; y++) {
      for (var x = 0; x < TW; x++) {
        var v = 52 + (hash2(x + seed * 3, y - seed * 9) - 0.5) * 12;
        if ((x & 15) === 0 || (y & 15) === 0) v -= 13;
        if ((x & 31) === 31 || (y & 31) === 31) v += 5;
        t[y * TW + x] = pack(v * 0.86, v * 0.92, v * 1.16);
      }
    }
    return t;
  }

  // LUT освещённости: SHADES копий текстуры, уходящих в цвет дымки.
  function buildShades(tex) {
    var out = new Array(SHADES);
    for (var s = 0; s < SHADES; s++) {
      var f = Math.pow(s / (SHADES - 1), 1.12);
      var inv = 1 - f;
      var a = new Uint32Array(TW * TW);
      for (var i = 0; i < TW * TW; i++) {
        var c = tex[i];
        a[i] = pack(
          (c & 255) * f + FOG_R * inv,
          (c >> 8 & 255) * f + FOG_G * inv,
          (c >> 16 & 255) * f + FOG_B * inv
        );
      }
      out[s] = a;
    }
    return out;
  }

  var WALL_S = [
    buildShades(makeStone(1, 104, 114, 133, 55, 61, 76, false)),
    buildShades(makeStone(2, 133, 112, 87, 71, 58, 45, true)),
    buildShades(makeMetal(3)),
    buildShades(makeBanner(4))
  ];
  var FLOOR_S = buildShades(makeFloor(5));
  var CEIL_S = buildShades(makeCeil(6));
  var FOG_PIX = pack(FOG_R, FOG_G, FOG_B);

  // затухание с расстоянием + выбор ступени LUT
  function light(d) { return 1 / (1 + 0.07 * d + 0.009 * d * d); }
  function sidx(l) {
    var i = (l * (SHADES - 1) + 0.5) | 0;
    return i < 0 ? 0 : (i > SHADES - 1 ? SHADES - 1 : i);
  }

  // ---------------------------------------------------------- лабиринт ------
  var DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  // Recursive backtracker: связность гарантирована построением.
  function generateMaze(cells, rnd) {
    var W = cells * 2 + 1, H = W;
    var map = new Uint8Array(W * H);
    map.fill(1);
    var visited = new Uint8Array(cells * cells);
    var stack = new Int32Array(cells * cells);
    var nb = new Int32Array(4);
    var sp = 0;
    visited[0] = 1;
    map[1 * W + 1] = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      var cur = stack[sp - 1];
      var cx = cur % cells, cy = (cur / cells) | 0;
      var n = 0;
      if (cy > 0 && !visited[cur - cells]) nb[n++] = 3;
      if (cx < cells - 1 && !visited[cur + 1]) nb[n++] = 0;
      if (cy < cells - 1 && !visited[cur + cells]) nb[n++] = 1;
      if (cx > 0 && !visited[cur - 1]) nb[n++] = 2;
      if (n === 0) { sp--; continue; }
      var d = nb[(rnd() * n) | 0];
      var dx = DIRS[d][0], dy = DIRS[d][1];
      var nx = cx + dx, ny = cy + dy;
      map[(cy * 2 + 1 + dy) * W + (cx * 2 + 1 + dx)] = 0;   // стена между клетками
      map[(ny * 2 + 1) * W + (nx * 2 + 1)] = 0;             // сама клетка
      var ni = ny * cells + nx;
      visited[ni] = 1;
      stack[sp++] = ni;
    }
    return { map: map, w: W, h: H };
  }

  // Часть тупиков распечатываем: маршрутов становится больше, связность не рвётся
  // (мы только добавляем проходы, никогда не ставим стены).
  function braid(map, W, cells, rnd, chance) {
    for (var cy = 0; cy < cells; cy++) {
      for (var cx = 0; cx < cells; cx++) {
        var mx = cx * 2 + 1, my = cy * 2 + 1;
        var open = 0;
        if (map[(my - 1) * W + mx] === 0) open++;
        if (map[(my + 1) * W + mx] === 0) open++;
        if (map[my * W + mx - 1] === 0) open++;
        if (map[my * W + mx + 1] === 0) open++;
        if (open > 1) continue;                 // не тупик
        if (rnd() > chance) continue;
        var cand = [];
        if (cy > 0 && map[(my - 1) * W + mx] !== 0) cand.push((my - 1) * W + mx);
        if (cy < cells - 1 && map[(my + 1) * W + mx] !== 0) cand.push((my + 1) * W + mx);
        if (cx > 0 && map[my * W + mx - 1] !== 0) cand.push(my * W + mx - 1);
        if (cx < cells - 1 && map[my * W + mx + 1] !== 0) cand.push(my * W + mx + 1);
        if (!cand.length) continue;
        map[cand[(rnd() * cand.length) | 0]] = 0;
      }
    }
  }

  // Материал стены: крупные «районы» одного камня + редкие вкрапления.
  function paintWalls(map, W, H, seed) {
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        if (map[i] === 0) continue;
        var region = hash2((x >> 2) * 3 + seed, (y >> 2) * 5 - seed);
        var t = region < 0.56 ? 1 : 2;
        var acc = hash2(x * 31 + seed, y * 17 + 7);
        if (acc > 0.972) t = 4; else if (acc > 0.915) t = 3;
        map[i] = t;
      }
    }
  }

  // Старт выбираем так, чтобы первый же кадр читался как лабиринт: глубокий
  // коридор (перспектива) + боковые ответвления в нём (иначе это просто труба).
  function findStart(map, W, H) {
    var best = -1, bx = 1, by = 1, bd = 0;
    for (var y = 1; y < H - 1; y++) {
      for (var x = 1; x < W - 1; x++) {
        if (map[y * W + x] !== 0) continue;
        for (var d = 0; d < 4; d++) {
          var dx = DIRS[d][0], dy = DIRS[d][1];
          var sx = -dy, sy = dx;                    // перпендикуляр — ищем проёмы
          var cx = x + dx, cy = y + dy, n = 0, br = 0;
          while (n < 12 && map[cy * W + cx] === 0) {
            var w = n < 3 ? 2 : 1;                  // ближние проёмы виднее
            if (map[(cy + sy) * W + cx + sx] === 0) br += w;
            if (map[(cy - sy) * W + cx - sx] === 0) br += w;
            n++; cx += dx; cy += dy;
          }
          var score = Math.min(n, 8) * 1.2 + br * 1.5 +
                      (map[(y - dy) * W + (x - dx)] !== 0 ? 2 : 0);
          if (score > best) { best = score; bx = x; by = y; bd = d; }
        }
      }
    }
    return { x: bx + 0.5, y: by + 0.5, dir: bd };
  }

  // ------------------------------------------------------------- состояние --
  var MAP = null;
  var P = {
    x: 1.5, y: 1.5, a: 0, dx: 1, dy: 0, px: 0, py: 0.7,
    fov: 70, bobT: 0, bobA: 0, showMap: true
  };

  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d', { alpha: false });
  var bufCanvas = document.createElement('canvas');
  var bufCtx = bufCanvas.getContext('2d');
  var imgData = null, pix = null;
  var BW = 2, BH = 2, cssW = 1, cssH = 1, dpr = 1;
  var pixCap = PIX_CAP_MAX;

  var mmCanvas = document.createElement('canvas');
  var mmCtx = mmCanvas.getContext('2d');
  var MM_COL = ['#6d7c95', '#8b7658', '#67717d', '#8e3f42'];

  var elFps = document.getElementById('fps');
  var elRes = document.getElementById('res');
  var elSize = document.getElementById('size');
  var elFov = document.getElementById('fov');
  var elFovVal = document.getElementById('fovVal');
  var btnNew = document.getElementById('btnNew');
  var btnMap = document.getElementById('btnMap');

  function setAngle(a) {
    if (a > Math.PI) a -= 2 * Math.PI; else if (a < -Math.PI) a += 2 * Math.PI;
    P.a = a;
    P.dx = Math.cos(a); P.dy = Math.sin(a);
    var pl = Math.tan(P.fov * Math.PI / 360);
    P.px = -P.dy * pl; P.py = P.dx * pl;
  }

  function newMaze(seed) {
    var s = (seed === undefined ? (Math.random() * 1e9) | 0 : seed) | 0;
    var rnd = mulberry32(s);
    var m = generateMaze(CELLS, rnd);
    braid(m.map, m.w, CELLS, rnd, 0.38);
    paintWalls(m.map, m.w, m.h, s & 1023);
    MAP = m;
    var st = findStart(m.map, m.w, m.h);
    P.x = st.x - DIRS[st.dir][0] * 0.2;
    P.y = st.y - DIRS[st.dir][1] * 0.2;
    P.bobT = 0; P.bobA = 0;
    setAngle(Math.atan2(DIRS[st.dir][1], DIRS[st.dir][0]));
    buildMiniMap();
    if (elSize) elSize.textContent = m.w + '×' + m.h + ' клеток';
  }

  // статичная подложка мини-карты рисуется один раз на лабиринт
  function buildMiniMap() {
    var mw = MAP.w, mh = MAP.h, cs = 12;
    mmCanvas.width = mw * cs;
    mmCanvas.height = mh * cs;
    mmCtx.clearRect(0, 0, mmCanvas.width, mmCanvas.height);
    mmCtx.fillStyle = 'rgba(150,180,225,0.08)';
    mmCtx.fillRect(0, 0, mmCanvas.width, mmCanvas.height);
    for (var y = 0; y < mh; y++) {
      for (var x = 0; x < mw; x++) {
        var c = MAP.map[y * mw + x];
        if (!c) continue;
        mmCtx.fillStyle = MM_COL[c - 1] || MM_COL[0];
        mmCtx.fillRect(x * cs, y * cs, cs, cs);
      }
    }
  }

  // ------------------------------------------------------------- коллизии --
  function isWall(mx, my) {
    if (mx < 0 || my < 0 || mx >= MAP.w || my >= MAP.h) return true;
    return MAP.map[my * MAP.w + mx] !== 0;
  }

  function blocked(x, y) {
    var x0 = (x - RADIUS) | 0, x1 = (x + RADIUS) | 0;
    var y0 = (y - RADIUS) | 0, y1 = (y + RADIUS) | 0;
    return isWall(x0, y0) || isWall(x1, y0) || isWall(x0, y1) || isWall(x1, y1);
  }

  // раздельная проверка по осям = скольжение вдоль стены
  function moveWithSlide(vx, vy) {
    var nx = P.x + vx;
    if (!blocked(nx, P.y)) P.x = nx;
    var ny = P.y + vy;
    if (!blocked(P.x, ny)) P.y = ny;
  }

  // ----------------------------------------------------------------- ввод --
  var keys = Object.create(null);
  var dragging = false, lastPX = 0;

  window.addEventListener('keydown', function (e) {
    var c = e.code;
    if (c === 'ShiftLeft' || c === 'ShiftRight') keys.shift = true;
    keys[c] = true;
    if (!e.repeat) {
      if (c === 'KeyR') newMaze();
      else if (c === 'KeyM') toggleMap();
    }
    if (c === 'ArrowLeft' || c === 'ArrowRight' || c === 'ArrowUp' ||
        c === 'ArrowDown' || c === 'Space') e.preventDefault();
  }, { passive: false });

  window.addEventListener('keyup', function (e) {
    var c = e.code;
    if (c === 'ShiftLeft' || c === 'ShiftRight') keys.shift = false;
    keys[c] = false;
  });

  window.addEventListener('blur', function () {
    for (var k in keys) keys[k] = false;
    dragging = false;
  });

  canvas.addEventListener('pointerdown', function (e) {
    canvas.focus();
    dragging = true;
    lastPX = e.clientX;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    setAngle(P.a + (e.clientX - lastPX) * 0.0032);
    lastPX = e.clientX;
  });
  function endDrag(e) {
    dragging = false;
    if (e && e.pointerId !== undefined) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function toggleMap() {
    P.showMap = !P.showMap;
    btnMap.classList.toggle('on', P.showMap);
  }

  btnNew.addEventListener('click', function () { newMaze(); canvas.focus(); });
  btnMap.addEventListener('click', function () { toggleMap(); canvas.focus(); });
  elFov.addEventListener('input', function () {
    P.fov = +elFov.value;
    elFovVal.textContent = P.fov + '°';
    setAngle(P.a);
  });

  // --------------------------------------------------------------- ресайз --
  function resize() {
    cssW = Math.max(1, window.innerWidth || document.documentElement.clientWidth);
    cssH = Math.max(1, window.innerHeight || document.documentElement.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    var total = canvas.width * canvas.height;
    var k = Math.sqrt(Math.min(1, pixCap / total));
    BW = Math.max(140, Math.round(canvas.width * k));
    BH = Math.max(90, Math.round(canvas.height * k));
    bufCanvas.width = BW;
    bufCanvas.height = BH;
    imgData = bufCtx.createImageData(BW, BH);
    pix = new Uint32Array(imgData.data.buffer);
    if (elRes) elRes.textContent = BW + '×' + BH;
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  // ------------------------------------------------------------ обновление --
  function update(dt) {
    var rot = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    if (rot) setAngle(P.a + rot * ROT * dt);

    var fw = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    var st = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    var moving = false;
    if (fw || st) {
      var inv = 1 / Math.sqrt(fw * fw + st * st);
      var sp = MOVE * (keys.shift ? RUN : 1) * dt * inv;
      // вперёд — вдоль dir, стрейф — вдоль перпендикуляра (-dy, dx)
      moveWithSlide((P.dx * fw - P.dy * st) * sp, (P.dy * fw + P.dx * st) * sp);
      moving = true;
    }

    // покачивание головы: смещаем линию горизонта, пол/стены остаются согласованы
    if (moving) P.bobT += dt * (keys.shift ? 12.5 : 8.5);
    var t = Math.min(1, dt * 7);
    P.bobA += ((moving ? 1 : 0) - P.bobA) * t;
  }

  // -------------------------------------------------------------- рендер ----
  function renderScene() {
    var bw = BW, bh = BH, px = pix;
    var posX = P.x, posY = P.y;
    var dirX = P.dx, dirY = P.dy, plX = P.px, plY = P.py;
    var mp = MAP.map, mw = MAP.w, mh = MAP.h;

    var horizon = clamp(bh * 0.5 + Math.sin(P.bobT) * P.bobA * bh * 0.014, bh * 0.3, bh * 0.7);
    var posZ = 0.5 * bh;

    var rd0x = dirX - plX, rd0y = dirY - plY;      // луч левого края экрана
    var rd1x = dirX + plX, rd1y = dirY + plY;      // луч правого края
    var dsx = (rd1x - rd0x) / bw, dsy = (rd1y - rd0y) / bw;

    var yc = Math.min(bh - 1, Math.floor(horizon - 0.75));
    var yf = Math.max(0, Math.ceil(horizon + 0.75));
    var y, x, o, rowD, tex, stx, sty, fx, fy, p;

    // ---- потолок ----
    for (y = 0; y <= yc; y++) {
      p = horizon - y;
      rowD = posZ / p; if (rowD > 200) rowD = 200;
      tex = CEIL_S[sidx(light(rowD) * 0.62)];
      stx = rowD * dsx; sty = rowD * dsy;
      fx = posX + rowD * rd0x; fy = posY + rowD * rd0y;
      o = y * bw;
      for (x = 0; x < bw; x++) {
        px[o + x] = tex[((((fy * TW) | 0) & TMASK) << 6) | (((fx * TW) | 0) & TMASK)];
        fx += stx; fy += sty;
      }
    }

    // ---- ряды у самой линии горизонта ----
    for (y = Math.max(0, yc + 1); y < Math.min(bh, yf); y++) {
      o = y * bw;
      for (x = 0; x < bw; x++) px[o + x] = FOG_PIX;
    }

    // ---- пол ----
    for (y = yf; y < bh; y++) {
      p = y - horizon;
      rowD = posZ / p; if (rowD > 200) rowD = 200;
      tex = FLOOR_S[sidx(light(rowD) * 0.9)];
      stx = rowD * dsx; sty = rowD * dsy;
      fx = posX + rowD * rd0x; fy = posY + rowD * rd0y;
      o = y * bw;
      for (x = 0; x < bw; x++) {
        px[o + x] = tex[((((fy * TW) | 0) & TMASK) << 6) | (((fx * TW) | 0) & TMASK)];
        fx += stx; fy += sty;
      }
    }

    // ---- стены: DDA по сетке, столбец за столбцом ----
    for (x = 0; x < bw; x++) {
      var camX = 2 * x / bw - 1;
      var rdx = dirX + plX * camX, rdy = dirY + plY * camX;
      var mapX = posX | 0, mapY = posY | 0;
      var ddx = rdx === 0 ? 1e30 : (rdx < 0 ? -1 / rdx : 1 / rdx);
      var ddy = rdy === 0 ? 1e30 : (rdy < 0 ? -1 / rdy : 1 / rdy);
      var stepX, stepY, sdx, sdy;
      if (rdx < 0) { stepX = -1; sdx = (posX - mapX) * ddx; }
      else { stepX = 1; sdx = (mapX + 1 - posX) * ddx; }
      if (rdy < 0) { stepY = -1; sdy = (posY - mapY) * ddy; }
      else { stepY = 1; sdy = (mapY + 1 - posY) * ddy; }

      var side = 0, cell = 0, hit = 0, guard = 0;
      while (guard++ < 256) {
        if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; }
        else { sdy += ddy; mapY += stepY; side = 1; }
        if (mapX < 0 || mapY < 0 || mapX >= mw || mapY >= mh) break;
        cell = mp[mapY * mw + mapX];
        if (cell !== 0) { hit = 1; break; }
      }
      if (!hit) continue;

      // перпендикулярная (к плоскости камеры) дистанция — снимает «рыбий глаз»
      var perp = side === 0 ? sdx - ddx : sdy - ddy;
      if (perp < 0.0001) perp = 0.0001;

      var lineH = bh / perp;
      var startF = horizon - lineH * 0.5;
      var y0 = Math.ceil(startF); if (y0 < 0) y0 = 0;
      var y1 = Math.ceil(startF + lineH); if (y1 > bh) y1 = bh;
      if (y1 <= y0) continue;

      var wallX = side === 0 ? posY + perp * rdy : posX + perp * rdx;
      wallX -= Math.floor(wallX);
      var texX = (wallX * TW) | 0;
      if (side === 0 ? rdx > 0 : rdy < 0) texX = TMASK - texX;
      if (texX < 0) texX = 0; else if (texX > TMASK) texX = TMASK;

      var lut = WALL_S[(cell - 1) & 3];
      // стены, обращённые по Y, темнее — грань между сторонами читается сразу
      var wtex = lut[sidx(light(perp) * (side === 1 ? 0.66 : 1))];
      var tstep = TW / lineH;
      var tp = (y0 - startF) * tstep;
      for (y = y0; y < y1; y++) {
        px[y * bw + x] = wtex[(((tp | 0) & TMASK) << 6) | texX];
        tp += tstep;
      }
    }
  }

  // ------------------------------------------------------------ мини-карта --
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawMinimap(g) {
    var size = clamp(Math.min(cssW, cssH) * 0.27, 108, 190);
    var pad = 14;
    var x0 = cssW - size - pad, y0 = pad;
    var cs = size / MAP.w;

    g.save();
    roundRect(g, x0 - 7, y0 - 7, size + 14, size + 14, 13);
    g.fillStyle = 'rgba(8,11,18,0.74)';
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = 1;
    g.stroke();
    g.clip();

    g.imageSmoothingEnabled = true;
    g.drawImage(mmCanvas, x0, y0, size, size);

    var pxm = x0 + P.x * cs, pym = y0 + P.y * cs;
    var half = P.fov * Math.PI / 360;
    var rad = size * 0.42;

    var grd = g.createRadialGradient(pxm, pym, 0, pxm, pym, rad);
    grd.addColorStop(0, 'rgba(255,206,132,0.46)');
    grd.addColorStop(1, 'rgba(255,206,132,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(pxm, pym);
    g.arc(pxm, pym, rad, P.a - half, P.a + half);
    g.closePath();
    g.fill();

    g.strokeStyle = 'rgba(255,214,150,0.5)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(pxm, pym);
    g.lineTo(pxm + Math.cos(P.a - half) * rad, pym + Math.sin(P.a - half) * rad);
    g.moveTo(pxm, pym);
    g.lineTo(pxm + Math.cos(P.a + half) * rad, pym + Math.sin(P.a + half) * rad);
    g.stroke();

    var pr = Math.max(2.4, cs * 0.3);
    g.beginPath();
    g.arc(pxm, pym, pr, 0, 6.2832);
    g.fillStyle = '#ffe9bd';
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 1.2;
    g.stroke();
    g.restore();
  }

  // ---------------------------------------------------------- главный цикл --
  var last = 0, fpsAcc = 0, fpsCount = 0;
  var costAcc = 0, costCount = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;

    update(dt);

    var t0 = performance.now();
    renderScene();
    bufCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(bufCanvas, 0, 0, cssW, cssH);
    if (P.showMap) drawMinimap(ctx);
    var cost = performance.now() - t0;

    // счётчик fps
    fpsAcc += dt; fpsCount++;
    if (fpsAcc >= 0.5) {
      if (elFps) elFps.textContent = Math.round(fpsCount / fpsAcc) + ' fps';
      fpsAcc = 0; fpsCount = 0;
    }

    // адаптивное внутреннее разрешение по реальной стоимости кадра
    costAcc += cost; costCount++;
    if (costCount >= 40) {
      var avg = costAcc / costCount;
      costAcc = 0; costCount = 0;
      if (avg > 9 && pixCap > PIX_CAP_MIN) {
        pixCap = Math.max(PIX_CAP_MIN, pixCap * 0.72); resize();
      } else if (avg < 4 && pixCap < PIX_CAP_MAX) {
        pixCap = Math.min(PIX_CAP_MAX, pixCap * 1.3); resize();
      }
    }
  }

  // -------------------------------------------------------------- запуск ---
  elFovVal.textContent = P.fov + '°';
  resize();
  newMaze();
  requestAnimationFrame(frame);
})();
