/* Падающий песок — клеточный автомат на canvas 2D. Решение: Claude Opus 5.5.
 *
 * Честность симуляции:
 *  - за один шаг частица сдвигается не дальше соседней клетки (обмен с соседом),
 *    многоклеточных прыжков и «перескоков» через препятствия нет;
 *  - каждая клетка обновляется не больше одного раза за шаг (метка stamp);
 *  - направление обхода каждой строки выбирается монеткой на каждом шаге,
 *    выбор «влево/вправо» при равных вариантах — тоже монетка;
 *  - диагональный шаг сквозь угол стенки (между двумя твёрдыми клетками) запрещён.
 */
(function () {
  'use strict';

  // ---------- Вещества ----------
  var EMPTY = 0, SAND = 1, WATER = 2, STONE = 3, WOOD = 4, FIRE = 5, SMOKE = 6, BURN = 7;
  // BURN — горящее дерево: огонь, который держится на месте древесины.

  var STEP_HZ = 120;            // шагов автомата в секунду
  var STEP_DT = 1 / STEP_HZ;
  var MAX_STEPS = 5;            // потолок шагов за кадр
  var GS = 5;                   // клеток сетки на одну ячейку свечения
  var SINK = 0.5;               // шанс песка сделать шаг сквозь воду (вязкость)

  // Горение дерева. Запас горящей клетки (aux) стартует с 255 и убывает с шансом
  // BURN_DECAY за шаг. Первые BURN_WARM единиц клетка разгорается и соседей не поджигает,
  // ниже EMBER — тлеет углями. Вероятности распространения — за шаг, на одного соседа.
  var BURN_DECAY = 0.3;
  var BURN_WARM = 2;
  var EMBER = 120;
  var SPREAD_UP = 0.072, SPREAD_DIAG = 0.06, SPREAD_SIDE = 0.038, SPREAD_DOWN = 0.015;
  var FLAME_IGNITE = 0.003;     // язык пламени поджигает дерево, которого касается

  var MATS = [
    { name: 'Песок',  type: SAND,  key: '1', density: 0.28, sw: 'linear-gradient(135deg,#f3d99b,#c7964d)', ring: '#f2d08c' },
    { name: 'Вода',   type: WATER, key: '2', density: 0.40, sw: 'linear-gradient(135deg,#8ccaff,#1f5fc4)', ring: '#7cc0ff' },
    { name: 'Камень', type: STONE, key: '3', density: 1,    sw: 'linear-gradient(135deg,#aab0ba,#5a5f69)', ring: '#c3c8d1' },
    { name: 'Дерево', type: WOOD,  key: '4', density: 1,    sw: 'linear-gradient(135deg,#b98250,#6a3f1f)', ring: '#c98f57' },
    { name: 'Огонь',  type: FIRE,  key: '5', density: 0.45, sw: 'linear-gradient(135deg,#ffe28f,#ff531a)', ring: '#ffac4d' },
    { name: 'Дым',    type: SMOKE, key: '6', density: 0.30, sw: 'linear-gradient(135deg,#d3d7de,#6c717a)', ring: '#cfd4dc' },
    { name: 'Ластик', type: EMPTY, key: '7', density: 1,    sw: '',                                         ring: '#ffffff' }
  ];
  var ERASER = 6;

  // ---------- Генератор случайных чисел (xorshift32) ----------
  var seed = (Math.floor(Math.random() * 4294967295) >>> 0) || 0x2545f491;
  function rnd() {
    var x = seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    seed = x;
    return (x >>> 0) * 2.3283064365386963e-10;
  }

  // ---------- Цвета ----------
  var LE = new Uint8Array(new Uint32Array([0x0a0b0c0d]).buffer)[0] === 0x0d;
  function c8(v) { v = v | 0; return v < 0 ? 0 : v > 255 ? 255 : v; }
  function pack(r, g, b, a) {
    r = c8(r); g = c8(g); b = c8(b); a = c8(a);
    return LE ? (((a << 24) | (b << 16) | (g << 8) | r) >>> 0)
              : (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
  }
  function mix(a, b, t) { return a + (b - a) * t; }
  function ramp(stops, t) {
    var k = 1;
    while (k < stops.length - 1 && t > stops[k][0]) k++;
    var s0 = stops[k - 1], s1 = stops[k];
    var f = (t - s0[0]) / (s1[0] - s0[0]);
    if (f < 0) f = 0; else if (f > 1) f = 1;
    return [mix(s0[1], s1[1], f), mix(s0[2], s1[2], f), mix(s0[3], s1[3], f), mix(s0[4], s1[4], f)];
  }

  var FIRE_STOPS = [
    [0.00, 120, 22, 8, 140],
    [0.30, 205, 48, 12, 225],
    [0.58, 255, 122, 24, 255],
    [0.82, 255, 198, 72, 255],
    [1.00, 255, 246, 204, 255]
  ];
  var BURN_STOPS = [
    [0.00, 66, 51, 46, 255],     // остывающий уголь — заметно светлее фона
    [0.18, 98, 40, 30, 255],
    [0.40, 172, 44, 14, 255],
    [0.70, 238, 104, 24, 255],
    [1.00, 255, 196, 92, 255]
  ];

  var sandPal = new Uint32Array(256), sandWetPal = new Uint32Array(256);
  var stonePal = new Uint32Array(256), woodPal = new Uint32Array(256);
  var firePal = new Uint32Array(256), burnPal = new Uint32Array(256);
  var smokePal = new Uint32Array(256), glowPal = new Uint32Array(256);
  var WD = 48, waterPal = new Uint32Array(WD * 4);

  (function buildPalettes() {
    for (var s = 0; s < 256; s++) {
      var st = s / 255, r, g, b;
      // песок: основной тон с разбросом яркости + редкие тёмные и светлые крупинки
      if (s < 12) { r = 168; g = 130; b = 80; }
      else if (s > 247) { r = 250; g = 233; b = 186; }
      else { var k = 0.88 + 0.2 * ((s - 12) / 235); r = 222 * k; g = 186 * k; b = 118 * k; }
      sandPal[s] = pack(r, g, b, 255);
      sandWetPal[s] = pack(r * 0.66, g * 0.6, b * 0.52, 255);

      stonePal[s] = pack(mix(72, 150, st), mix(76, 155, st), mix(86, 166, st), 255);
      woodPal[s] = pack(mix(76, 166, st), mix(44, 106, st), mix(24, 58, st), 255);

      var f = ramp(FIRE_STOPS, st);
      firePal[s] = pack(f[0], f[1], f[2], f[3]);
      var bn = ramp(BURN_STOPS, st);
      burnPal[s] = pack(bn[0], bn[1], bn[2], bn[3]);

      // дым: индекс = оставшаяся жизнь; молодой — плотнее и темнее, старый — тает
      var life = s / 190; if (life > 1) life = 1;
      smokePal[s] = pack(mix(176, 104, life), mix(178, 107, life), mix(186, 114, life), 170 * Math.pow(life, 0.85));

      // свечение огня: индекс = непрозрачность
      glowPal[s] = pack(255, mix(84, 176, st), mix(22, 76, st), s);
    }
    for (var d = 0; d < WD; d++) {
      var tt = Math.pow(d / (WD - 1), 0.75);
      var base = d === 0
        ? [150, 214, 255, 238]                                                   // поверхность
        : [mix(70, 14, tt), mix(152, 48, tt), mix(238, 120, tt), mix(206, 242, tt)];
      for (var v = 0; v < 4; v++) {
        var m = 1 + (v - 1.5) * 0.035;
        waterPal[d * 4 + v] = pack(base[0] * m, base[1] * m, base[2] * m, base[3]);
      }
    }
  })();

  // Текстуры неподвижных веществ зависят от позиции — камень и дерево выглядят цельными.
  function hash2(x, y) {
    var h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) & 255;
  }
  function stoneShade(x, y) {
    return (hash2(x >> 3, y >> 3) * 0.45 + hash2(x >> 1, (y >> 1) + 911) * 0.33 + hash2(x + 17, y) * 0.22) | 0;
  }
  function woodShade(x, y) {
    var v = hash2(x >> 2, y + 303) * 0.55 + hash2(x, y) * 0.25 + 40;
    return v > 255 ? 255 : v | 0;
  }

  // ---------- Canvas ----------
  var canvas = document.getElementById('sim');
  var ctx = canvas.getContext('2d');
  var gridCanvas = document.createElement('canvas');
  var gctx = gridCanvas.getContext('2d');
  var glowCanvas = document.createElement('canvas');
  var glctx = glowCanvas.getContext('2d');

  // ---------- Состояние сетки ----------
  var W = 0, H = 0;
  var type = null, aux = null, shade = null, stamp = null;   // aux: жизнь огня/дыма, направление воды
  var img = null, pix = null, colDepth = null;
  var gw = 0, gh = 0, glowI = null, glowT = null, glowImg = null, glowPix = null;
  var tick = 0;

  var dpr = 1, cellCss = 0, cellPx = 4, offX = 0, offY = 0;
  var needResize = true;

  function alloc(nW, nH) {
    var oW = W, oH = H, oT = type, oA = aux, oS = shade;
    W = nW; H = nH;
    var n = W * H;
    type = new Uint8Array(n);
    aux = new Uint8Array(n);
    shade = new Uint8Array(n);
    stamp = new Uint32Array(n);
    colDepth = new Uint16Array(W);
    gridCanvas.width = W; gridCanvas.height = H;
    img = gctx.createImageData(W, H);
    pix = new Uint32Array(img.data.buffer);
    gw = Math.ceil(W / GS); gh = Math.ceil(H / GS);
    glowCanvas.width = gw; glowCanvas.height = gh;
    glowImg = glctx.createImageData(gw, gh);
    glowPix = new Uint32Array(glowImg.data.buffer);
    glowI = new Float32Array(gw * gh);
    glowT = new Float32Array(gw * gh);
    if (oT) {   // перенос содержимого: по центру по горизонтали, по низу по вертикали
      var dx = Math.floor((W - oW) / 2), dy = H - oH;
      for (var y = 0; y < oH; y++) {
        var ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (var x = 0; x < oW; x++) {
          var nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          var a = y * oW + x, b = ny * W + nx;
          type[b] = oT[a]; aux[b] = oA[a]; shade[b] = oS[a];
        }
      }
    }
  }

  function setup() {
    needResize = false;
    var de = document.documentElement;
    var vw = window.innerWidth || (de && de.clientWidth) || 800;
    var vh = window.innerHeight || (de && de.clientHeight) || 600;
    if (vw < 1) vw = 1;
    if (vh < 1) vh = 1;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!cellCss) cellCss = Math.max(3, Math.min(5, Math.round(Math.sqrt(vw * vh / 100000))));
    cellPx = Math.max(1, Math.round(cellCss * dpr));
    var cw = Math.max(1, Math.round(vw * dpr)), ch = Math.max(1, Math.round(vh * dpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    var nW = Math.max(16, Math.ceil(cw / cellPx)), nH = Math.max(16, Math.ceil(ch / cellPx));
    offX = Math.floor((cw - nW * cellPx) / 2);   // лишнее обрезается поровну слева и справа
    offY = ch - nH * cellPx;                      // пол совпадает с низом экрана
    if (nW !== W || nH !== H) alloc(nW, nH);
  }

  // ---------- Создание и превращения клеток ----------
  function smokeLife() { return 110 + ((rnd() * 110) | 0); }

  function setCell(i, x, y, m) {
    type[i] = m;
    switch (m) {
      case SAND:  shade[i] = (rnd() * 256) | 0; aux[i] = 0; break;
      case WATER: shade[i] = (rnd() * 256) | 0; aux[i] = rnd() < 0.5 ? 0 : 1; break;
      case STONE: shade[i] = stoneShade(x, y); aux[i] = 0; break;
      case WOOD:  shade[i] = woodShade(x, y); aux[i] = 0; break;
      case FIRE:  shade[i] = (rnd() * 256) | 0; aux[i] = 45 + ((rnd() * 45) | 0); break;
      case SMOKE: shade[i] = (rnd() * 256) | 0; aux[i] = smokeLife(); break;
      case BURN:  aux[i] = 255; break;
      default:    shade[i] = 0; aux[i] = 0;
    }
  }

  function swap(a, b, t) {
    var v = type[a]; type[a] = type[b]; type[b] = v;
    v = aux[a]; aux[a] = aux[b]; aux[b] = v;
    v = shade[a]; shade[a] = shade[b]; shade[b] = v;
    stamp[a] = t; stamp[b] = t;
  }
  function toSmoke(i, t) {
    type[i] = SMOKE; aux[i] = smokeLife(); shade[i] = (rnd() * 256) | 0; stamp[i] = t;
  }
  function vanish(i, t) {
    type[i] = EMPTY; aux[i] = 0; stamp[i] = t;
  }
  function ignite(j, t) {
    type[j] = BURN; aux[j] = 255; stamp[j] = t;   // рисунок древесины (shade) сохраняется
  }
  function solid(c) { return c === STONE || c === WOOD || c === BURN; }

  // ---------- Правила ----------
  // Песок: вниз; сквозь воду — медленнее (вязкость); иначе по диагонали вниз.
  function sand(x, y, i, t) {
    if (y >= H - 1) return;
    var b = i + W, c = type[b];
    if (c === EMPTY || c === SMOKE || c === FIRE) { swap(i, b, t); return; }
    if (c === WATER) { if (rnd() < SINK) swap(i, b, t); return; }
    var l = false, r = false;
    if (x > 0) {
      c = type[b - 1];
      l = (c === EMPTY || c === SMOKE || c === FIRE || c === WATER) && !solid(type[i - 1]);
    }
    if (x < W - 1) {
      c = type[b + 1];
      r = (c === EMPTY || c === SMOKE || c === FIRE || c === WATER) && !solid(type[i + 1]);
    }
    if (l && r) { if (rnd() < 0.5) r = false; else l = false; }
    var j = l ? b - 1 : r ? b + 1 : -1;
    if (j < 0) return;
    if (type[j] === WATER && rnd() >= SINK) return;
    swap(i, j, t);
  }

  // Вода: вниз, по диагонали вниз, затем вбок по «инерции» (направление хранится в aux).
  function water(x, y, i, t) {
    var c;
    if (y < H - 1) {
      var b = i + W;
      c = type[b];
      if (c === EMPTY || c === SMOKE || c === FIRE) { swap(i, b, t); return; }
      var l = false, r = false;
      if (x > 0) {
        c = type[b - 1];
        l = (c === EMPTY || c === SMOKE || c === FIRE) && !solid(type[i - 1]);
      }
      if (x < W - 1) {
        c = type[b + 1];
        r = (c === EMPTY || c === SMOKE || c === FIRE) && !solid(type[i + 1]);
      }
      if (l && r) { if (rnd() < 0.5) r = false; else l = false; }
      if (l) { aux[i] = 0; swap(i, b - 1, t); return; }
      if (r) { aux[i] = 1; swap(i, b + 1, t); return; }
    }
    var d = aux[i] ? 1 : -1, nx = x + d;
    if (nx >= 0 && nx < W) {
      c = type[i + d];
      if (c === EMPTY || c === SMOKE || c === FIRE) { swap(i, i + d, t); return; }
    }
    nx = x - d;
    if (nx >= 0 && nx < W) {
      c = type[i - d];
      if (c === EMPTY || c === SMOKE || c === FIRE) { aux[i] ^= 1; swap(i, i - d, t); }
    }
  }

  function drift(x, i, t) {
    var d = rnd() < 0.5 ? -1 : 1, nx = x + d;
    if (nx >= 0 && nx < W && type[i + d] === EMPTY) { swap(i, i + d, t); return; }
    nx = x - d;
    if (nx >= 0 && nx < W && type[i - d] === EMPTY) swap(i, i - d, t);
  }

  // Дым: поднимается (сквозь воду — пузырём), клубится вбок и тает.
  function smoke(x, y, i, t) {
    if (rnd() < 0.5) {
      var life = aux[i];
      if (life <= 1) { type[i] = EMPTY; aux[i] = 0; return; }
      aux[i] = life - 1;
    }
    var q = rnd();
    if (q < 0.5) {
      if (y > 0) {
        var u = i - W, c = type[u];
        if (c === EMPTY) { swap(i, u, t); return; }
        if (c === WATER) { if (rnd() < 0.5) swap(i, u, t); return; }
        var l = x > 0 && type[u - 1] === EMPTY && !solid(type[i - 1]);
        var r = x < W - 1 && type[u + 1] === EMPTY && !solid(type[i + 1]);
        if (l && r) { if (rnd() < 0.5) r = false; else l = false; }
        if (l) { swap(i, u - 1, t); return; }
        if (r) { swap(i, u + 1, t); return; }
      }
      drift(x, i, t);          // упёрся — растекается под преградой
    } else if (q < 0.78) {
      drift(x, i, t);
    }
  }

  var NX = [-1, 0, 1, -1, 1, -1, 0, 1];
  var NY = [-1, -1, -1, 0, 0, 1, 1, 1];

  // Свободное пламя: поджигает дерево, от воды гаснет паром, дрожит и тянется вверх,
  // догорая — превращается в дым.
  function fire(x, y, i, t) {
    var mir = rnd() < 0.5 ? -1 : 1, k, nx, ny, j, c;
    for (k = 0; k < 8; k++) {
      nx = x + NX[k] * mir; ny = y + NY[k];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      j = ny * W + nx; c = type[j];
      if (c === WATER) {
        toSmoke(i, t);
        if (rnd() < 0.3) toSmoke(j, t);
        return;
      }
      if (c === WOOD && rnd() < FLAME_IGNITE) ignite(j, t);
    }
    var life = aux[i] - 1;
    if (life <= 0) {
      if (rnd() < 0.5) toSmoke(i, t); else vanish(i, t);
      return;
    }
    aux[i] = life;
    var q = rnd();
    if (q < 0.5) {
      if (y > 0) {
        var s = rnd(), dx = s < 0.3 ? -1 : s < 0.7 ? 0 : 1;
        nx = x + dx;
        if (nx >= 0 && nx < W) {
          j = i - W + dx; c = type[j];
          if ((c === EMPTY || c === SMOKE) && (dx === 0 || !solid(type[i + dx]))) swap(i, j, t);
        }
      }
    } else if (q < 0.65) {
      var d = rnd() < 0.5 ? -1 : 1;
      nx = x + d;
      if (nx >= 0 && nx < W && type[i + d] === EMPTY) swap(i, i + d, t);
    }
  }

  // Горящее дерево: неподвижно. Разгоревшись, раздаёт огонь соседней древесине (вверх
  // быстрее, вниз медленнее, влево/вправо поровну) и выбрасывает языки пламени; потом
  // тлеет углями, изредка курясь дымком, и прогорает в дым.
  function burn(x, y, i, t) {
    var life = aux[i];
    var hot = life >= EMBER && life <= 255 - BURN_WARM;
    var mir = rnd() < 0.5 ? -1 : 1, k, nx, ny, j, c, p;
    for (k = 0; k < 8; k++) {
      nx = x + NX[k] * mir; ny = y + NY[k];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      j = ny * W + nx; c = type[j];
      if (c === WATER) {
        type[i] = WOOD; aux[i] = 0; stamp[i] = t;     // залили — потухло
        if (rnd() < 0.35) toSmoke(j, t);              // вода уходит паром
        return;
      }
      if (hot && c === WOOD) {
        p = NY[k] < 0 ? (NX[k] === 0 ? SPREAD_UP : SPREAD_DIAG) : (NY[k] === 0 ? SPREAD_SIDE : SPREAD_DOWN);
        if (rnd() < p) ignite(j, t);
      }
    }
    if (y > 0) {
      if (hot) {
        if (rnd() < 0.18) {
          var s = rnd(), dx = s < 1 / 3 ? -1 : s < 2 / 3 ? 0 : 1;
          nx = x + dx;
          if (nx >= 0 && nx < W) {
            j = i - W + dx;
            if (type[j] === EMPTY && (dx === 0 || !solid(type[i + dx]))) {
              type[j] = FIRE; aux[j] = 14 + ((rnd() * 26) | 0); shade[j] = (rnd() * 256) | 0; stamp[j] = t;
            }
          }
        }
      } else if (life < EMBER && rnd() < 0.006 && type[i - W] === EMPTY) {
        toSmoke(i - W, t);                            // угли курятся
      }
    }
    if (rnd() < BURN_DECAY) {
      if (--life <= 0) {
        if (rnd() < 0.55) toSmoke(i, t); else vanish(i, t);
        return;
      }
      aux[i] = life;
    }
  }

  function active(c, x, y, i, t) {
    if (c === SMOKE) smoke(x, y, i, t);
    else if (c === FIRE) fire(x, y, i, t);
    else burn(x, y, i, t);
  }

  // Расписание стартовой сцены: события привязаны ко времени автомата (к шагам),
  // поэтому пауза и «Шаг» сдвигают их честно вместе с симуляцией.
  var events = [];
  function schedule(sec, fn) {
    events.push({ at: tick + Math.round(sec * STEP_HZ), fn: fn });
    events.sort(function (a, b) { return a.at - b.at; });
  }

  function step() {
    var t = ++tick, w = W, h = H, x, y, i, c, row;
    while (events.length && events[0].at <= t) events.shift().fn();
    // Проход 1 — снизу вверх: песок и вода.
    for (y = h - 1; y >= 0; y--) {
      row = y * w;
      if (rnd() < 0.5) {
        for (x = 0; x < w; x++) {
          i = row + x; c = type[i];
          if (c === SAND) { if (stamp[i] !== t) sand(x, y, i, t); }
          else if (c === WATER) { if (stamp[i] !== t) water(x, y, i, t); }
        }
      } else {
        for (x = w - 1; x >= 0; x--) {
          i = row + x; c = type[i];
          if (c === SAND) { if (stamp[i] !== t) sand(x, y, i, t); }
          else if (c === WATER) { if (stamp[i] !== t) water(x, y, i, t); }
        }
      }
    }
    // Проход 2 — сверху вниз: огонь, горящее дерево, дым (всё, что тянется вверх).
    for (y = 0; y < h; y++) {
      row = y * w;
      if (rnd() < 0.5) {
        for (x = 0; x < w; x++) {
          i = row + x; c = type[i];
          if (c >= FIRE && stamp[i] !== t) active(c, x, y, i, t);
        }
      } else {
        for (x = w - 1; x >= 0; x--) {
          i = row + x; c = type[i];
          if (c >= FIRE && stamp[i] !== t) active(c, x, y, i, t);
        }
      }
    }
  }

  // ---------- Рендер ----------
  var particleCount = 0;

  function blurGlow() {
    var a = glowI, b = glowT, w = gw, h = gh, x, y, i, row, s, n;
    for (var pass = 0; pass < 4; pass++) {
      for (y = 0; y < h; y++) {
        row = y * w;
        for (x = 0; x < w; x++) {
          i = row + x; s = a[i] * 2; n = 2;
          if (x > 0) { s += a[i - 1]; n++; }
          if (x < w - 1) { s += a[i + 1]; n++; }
          b[i] = s / n;
        }
      }
      for (y = 0; y < h; y++) {
        row = y * w;
        for (x = 0; x < w; x++) {
          i = row + x; s = b[i] * 2; n = 2;
          if (y > 0) { s += b[i - w]; n++; }
          if (y < h - 1) { s += b[i + w]; n++; }
          a[i] = s / n;
        }
      }
    }
  }

  function render() {
    var w = W, h = H, px = pix, gl = glowI, cd = colDepth;
    var count = 0, hot = 0, x, y, i, c, row, grow, d, v;
    cd.fill(0);
    gl.fill(0);
    for (y = 0; y < h; y++) {
      row = y * w;
      grow = ((y / GS) | 0) * gw;
      for (x = 0; x < w; x++) {
        i = row + x; c = type[i];
        if (c === EMPTY) { px[i] = 0; cd[x] = 0; continue; }
        count++;
        if (c === WATER) {
          d = ++cd[x];                           // глубина от поверхности в этом столбце
          px[i] = waterPal[(d > WD ? WD - 1 : d - 1) * 4 + (shade[i] & 3)];
          continue;
        }
        if (c !== SAND) cd[x] = 0;               // тонущая песчинка не создаёт «поверхность»
        switch (c) {
          case SAND:
            px[i] = ((x > 0 && type[i - 1] === WATER) || (x < w - 1 && type[i + 1] === WATER) ||
                     (y > 0 && type[i - w] === WATER) || (y < h - 1 && type[i + w] === WATER))
              ? sandWetPal[shade[i]] : sandPal[shade[i]];
            break;
          case STONE: px[i] = stonePal[shade[i]]; break;
          case WOOD: px[i] = woodPal[shade[i]]; break;
          case SMOKE: px[i] = smokePal[aux[i]]; break;
          case FIRE:
            v = aux[i] * 5 + ((rnd() * 64) | 0) - 24;
            if (v < 0) v = 0; else if (v > 255) v = 255;
            px[i] = firePal[v];
            gl[grow + ((x / GS) | 0)] += 0.45 + v * 0.0022;
            hot++;
            break;
          case BURN:
            d = aux[i];
            if (d >= EMBER) {                      // горит: оранжевое мерцание по рисунку древесины
              v = 118 + ((shade[i] * 5) & 63) + ((rnd() * 74) | 0);
              if (v > 255) v = 255;
              gl[grow + ((x / GS) | 0)] += v * 0.0026;
            } else {                               // угли: тёмный уголь с остывающими искрами
              v = (shade[i] & 15) + (((d / EMBER) * (24 + rnd() * 96)) | 0);
              gl[grow + ((x / GS) | 0)] += v * 0.0012;
            }
            px[i] = burnPal[v];
            hot++;
            break;
        }
      }
    }
    particleCount = count;

    gctx.putImageData(img, 0, 0);

    var cw = canvas.width, ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(gridCanvas, offX, offY, w * cellPx, h * cellPx);

    if (hot > 0) {
      blurGlow();
      var inv = 1 / (GS * GS), n = gw * gh, k, a;
      for (k = 0; k < n; k++) {
        v = gl[k] * inv;
        if (v < 0.003) { glowPix[k] = 0; continue; }
        a = Math.sqrt(v) * 1.05;
        if (a > 0.8) a = 0.8;
        glowPix[k] = glowPal[(a * 255) | 0];
      }
      glctx.putImageData(glowImg, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowCanvas, offX, offY, gw * GS * cellPx, gh * GS * cellPx);
      ctx.globalCompositeOperation = 'source-over';
    }

    drawBrush();
  }

  // ---------- Кисть ----------
  var matIndex = 0, brushR = 6;
  var pointer = { inside: false, down: false, erase: false, id: -1, cx: 0, cy: 0, lx: 0, ly: 0 };

  function drawBrush() {
    if (!pointer.inside && !pointer.down) return;
    var m = MATS[pointer.down && pointer.erase ? ERASER : matIndex];
    var X = offX + (pointer.cx + 0.5) * cellPx, Y = offY + (pointer.cy + 0.5) * cellPx;
    var R = (brushR + 0.5) * cellPx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(X, Y, R, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, 3 * dpr);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();
    ctx.lineWidth = Math.max(1, 1.25 * dpr);
    ctx.strokeStyle = m.ring;
    ctx.globalAlpha = 0.9;
    if (m.type === EMPTY) ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.stroke();
    ctx.restore();
  }

  function paintCell(x, y, i, m, p) {
    var c = type[i];
    switch (m) {
      case EMPTY:
        if (c !== EMPTY) { type[i] = EMPTY; aux[i] = 0; }
        return;
      case STONE:
      case WOOD:
        if (c !== m) setCell(i, x, y, m);
        return;
      case FIRE:
        if (c === WOOD) { if (rnd() < p) { type[i] = BURN; aux[i] = 255; } }
        else if (c === EMPTY && rnd() < p) setCell(i, x, y, FIRE);
        return;
      case SMOKE:
        if (c === EMPTY && rnd() < p) setCell(i, x, y, SMOKE);
        return;
      default:   // песок, вода
        if ((c === EMPTY || c === SMOKE || c === FIRE) && rnd() < p) setCell(i, x, y, m);
    }
  }

  function stampBrush(cx, cy, m, p) {
    var r = brushR, r2 = r * r + r;
    for (var dy = -r; dy <= r; dy++) {
      var y = cy + dy;
      if (y < 0 || y >= H) continue;
      for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        var x = cx + dx;
        if (x < 0 || x >= W) continue;
        paintCell(x, y, y * W + x, m, p);
      }
    }
  }

  function applyBrush(dt) {
    var m = MATS[pointer.erase ? ERASER : matIndex];
    // плотность задана «на кадр при 60 fps»; пересчитываем под реальный dt
    var p = m.density >= 1 ? 1 : 1 - Math.pow(1 - m.density, dt * 60);
    if (p <= 0) return;
    var x0 = pointer.lx, y0 = pointer.ly, x1 = pointer.cx, y1 = pointer.cy;
    var dist = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    var n = Math.max(1, Math.ceil(dist / Math.max(1, brushR * 0.5)));
    for (var k = 1; k <= n; k++) {
      var f = k / n;
      stampBrush(Math.round(mix(x0, x1, f)), Math.round(mix(y0, y1, f)), m.type, p);
    }
    pointer.lx = x1; pointer.ly = y1;
  }

  function toCell(e) {
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / Math.max(1, rect.width), sy = canvas.height / Math.max(1, rect.height);
    pointer.cx = Math.floor(((e.clientX - rect.left) * sx - offX) / cellPx);
    pointer.cy = Math.floor(((e.clientY - rect.top) * sy - offY) / cellPx);
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    toCell(e);
    pointer.down = true;
    pointer.erase = e.button === 2;
    pointer.id = e.pointerId;
    pointer.inside = true;
    pointer.lx = pointer.cx; pointer.ly = pointer.cy;
    stampBrush(pointer.cx, pointer.cy, MATS[pointer.erase ? ERASER : matIndex].type,
      Math.min(1, MATS[pointer.erase ? ERASER : matIndex].density));
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
  });
  canvas.addEventListener('pointermove', function (e) {
    toCell(e);
    pointer.inside = true;
  });
  function release(e) {
    if (e.pointerId === pointer.id) { pointer.down = false; pointer.id = -1; }
    if (e.pointerType === 'touch') pointer.inside = false;
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('pointerleave', function () { if (!pointer.down) pointer.inside = false; });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    setSize(brushR + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });

  // ---------- Сцена ----------
  function clearAll() {
    type.fill(0); aux.fill(0); shade.fill(0);
    events.length = 0;
  }
  function put(x, y, m, onlyEmpty) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    var i = y * W + x;
    if (onlyEmpty && type[i] !== EMPTY) return;
    setCell(i, x, y, m);
  }
  function rect(x0, y0, x1, y1, m, onlyEmpty) {
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) put(x, y, m, onlyEmpty);
  }
  function disc(cx, cy, r, m, p, onlyEmpty) {
    var r2 = r * r + r;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        if (p < 1 && rnd() >= p) continue;
        put(cx + dx, cy + dy, m, onlyEmpty);
      }
    }
  }
  // Толстая линия; если задан mirrorX — одновременно рисуется её зеркальная копия.
  function thick(x0, y0, x1, y1, r, m, mirrorX) {
    var n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (var k = 0; k <= n; k++) {
      var f = k / n, px = Math.round(mix(x0, x1, f)), py = Math.round(mix(y0, y1, f));
      disc(px, py, r, m, 1, false);
      if (mirrorX !== undefined) disc(2 * mirrorX - px, py, r, m, 1, false);
    }
  }
  function branch(x, y, ang, len, r0, level) {
    var rad = Math.max(0, Math.round(r0 * Math.pow(0.6, level)));
    var x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    thick(x, y, x2, y2, rad, WOOD);
    if (level >= 6 || len < 3) return;
    var sp = 0.34 + rnd() * 0.2, bend = (rnd() - 0.5) * 0.16;
    branch(x2, y2, ang - sp + bend, len * (0.68 + rnd() * 0.1), r0, level + 1);
    branch(x2, y2, ang + sp + bend, len * (0.68 + rnd() * 0.1), r0, level + 1);
  }

  function buildScene() {
    clearAll();
    var u = Math.min(W, H), x, y, i;
    var wall = Math.max(2, Math.round(u * 0.011));

    var fr = Math.max(1, Math.round(u * 0.008));

    // 1) Каменная чаша с водой. Над ней — лоток с кучкой песка; через 5 с его дно
    //    исчезает (сценарий, как ластик), и песок комом падает в воду и тонет.
    var cL = Math.round(W * 0.045), cR = Math.round(W * 0.30);
    var cT = Math.round(H * 0.50), cB = Math.round(H * 0.78);
    var cM = Math.round((cL + cR) / 2), pw = Math.max(2, Math.round(W * 0.011));
    rect(cL, cT, cL + wall, cB, STONE);
    rect(cR - wall, cT, cR, cB, STONE);
    rect(cL, cB - wall, cR, cB, STONE);
    rect(cM - pw, cB, cM + pw, H - 1, STONE);
    rect(cM - pw * 3, H - 1 - wall, cM + pw * 3, H - 1, STONE);
    rect(cL + wall + 1, Math.round(H * 0.60), cR - wall - 1, cB - wall - 1, WATER, true);
    var hy = Math.round(H * 0.30), hw = Math.round(u * 0.11), lip = Math.max(3, Math.round(u * 0.03));
    var hatch = [];
    var hatchRect = function (x0, y0, x1, y1) {
      for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) {
        if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
        put(xx, yy, STONE, false); hatch.push(yy * W + xx);
      }
    };
    hatchRect(cM - hw, hy, cM + hw, hy + fr);
    hatchRect(cM - hw, hy - lip, cM - hw + fr, hy - 1);
    hatchRect(cM + hw - fr, hy - lip, cM + hw, hy - 1);
    var sr = Math.max(4, Math.round(u * 0.065));
    disc(cM, hy - sr - 1, sr, SAND, 1, true);
    schedule(5, function () {
      for (var k = 0; k < hatch.length; k++) {
        if (type[hatch[k]] === STONE) { type[hatch[k]] = EMPTY; aux[hatch[k]] = 0; }
      }
    });

    // 2) Воронка песочных часов (горлышко в одну клетку) и лоток под ней.
    var cx = Math.round(W * 0.5);
    var fTop = Math.round(H * 0.16), fBot = Math.round(H * 0.40);
    var fHalf = Math.round(W * 0.11);
    var neck = fr + 1;                     // центр стенки у горлышка: просвет ровно 1 клетка
    thick(cx - fHalf, fTop, cx - neck, fBot, fr, STONE, cx);
    var fillTop = Math.round(mix(fTop, fBot, 0.1));
    for (y = fillTop; y <= fBot; y++) {
      var a = mix(fHalf, neck, (y - fTop) / (fBot - fTop));
      var half = Math.floor(a) - 1;
      for (x = cx - half; x <= cx + half; x++) put(x, y, SAND, true);
    }
    var sY = Math.round(H * 0.70), sHalf = Math.round(W * 0.13);
    rect(cx - sHalf, sY, cx + sHalf, sY + fr, STONE);
    rect(cx - sHalf, sY - fr * 2, cx - sHalf + fr, sY, STONE);
    rect(cx + sHalf - fr, sY - fr * 2, cx + sHalf, sY, STONE);

    // 3) Дерево на каменной плите; через 1,5 с у основания ствола вспыхивает огонь.
    var slabY = Math.round(H * 0.845);
    rect(Math.round(W * 0.70), slabY, W - 1, slabY + wall, STONE);
    var tx = Math.round(W * 0.85);
    var r0 = Math.max(2, Math.round(u * 0.011));
    branch(tx, slabY - 1 - r0, -Math.PI / 2, H * 0.16, r0, 0);
    schedule(1.5, function () {
      for (var yy = slabY - 1 - r0 * 3; yy < slabY; yy++) {
        for (var xx = tx - r0 - 1; xx <= tx + r0 + 1; xx++) {
          if (xx < 0 || xx >= W || yy < 0) continue;
          var j = yy * W + xx;
          if (type[j] === WOOD && rnd() < 0.5) { type[j] = BURN; aux[j] = 255; }
        }
      }
      disc(tx - r0 - 2, slabY - 2, 2, FIRE, 0.6, true);
      disc(tx + r0 + 2, slabY - 2, 2, FIRE, 0.6, true);
    });
  }

  // ---------- Интерфейс ----------
  var toolsEl = document.getElementById('tools');
  var sizeEl = document.getElementById('size');
  var sizeOut = document.getElementById('sizeOut');
  var pauseBtn = document.getElementById('pauseBtn');
  var stepBtn = document.getElementById('stepBtn');
  var sceneBtn = document.getElementById('sceneBtn');
  var clearBtn = document.getElementById('clearBtn');
  var statsEl = document.getElementById('stats');
  var toolBtns = [];
  var paused = false;

  MATS.forEach(function (m, idx) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool';
    b.setAttribute('role', 'radio');
    b.title = m.name + ' (' + m.key + ')';
    b.style.setProperty('--ring', m.ring);
    var sw = document.createElement('span');
    sw.className = 'sw' + (m.type === EMPTY && idx === ERASER ? ' erase' : '');
    if (m.sw) sw.style.background = m.sw;
    var lb = document.createElement('span');
    lb.className = 'lbl';
    lb.textContent = m.name;
    b.appendChild(sw);
    b.appendChild(lb);
    b.addEventListener('click', function () { selectMat(idx); b.blur(); });
    toolsEl.appendChild(b);
    toolBtns.push(b);
  });

  function selectMat(idx) {
    matIndex = idx;
    for (var k = 0; k < toolBtns.length; k++) toolBtns[k].setAttribute('aria-checked', k === idx ? 'true' : 'false');
  }
  function setSize(r) {
    r = Math.max(1, Math.min(30, r | 0));
    brushR = r;
    sizeEl.value = String(r);
    sizeOut.textContent = String(r);
  }
  function setPaused(v) {
    paused = v;
    pauseBtn.textContent = paused ? 'Пуск' : 'Пауза';
    pauseBtn.classList.toggle('on', paused);
    stepBtn.disabled = !paused;
    acc = 0;
    updateStats();
  }

  sizeEl.addEventListener('input', function () { setSize(+sizeEl.value); });
  pauseBtn.addEventListener('click', function () { setPaused(!paused); pauseBtn.blur(); });
  stepBtn.addEventListener('click', function () { if (paused) step(); });
  sceneBtn.addEventListener('click', function () { buildScene(); sceneBtn.blur(); });
  clearBtn.addEventListener('click', function () { clearAll(); clearBtn.blur(); });

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key, code = e.code;
    if (k >= '1' && k <= '7' && k.length === 1) { selectMat(+k - 1); return; }
    if (k === ' ' || code === 'Space') { e.preventDefault(); setPaused(!paused); return; }
    if (code === 'KeyC') clearAll();
    else if (code === 'KeyR') buildScene();
    else if (code === 'KeyS' || code === 'Period') { if (paused) step(); }
    else if (code === 'BracketLeft' || k === '[') setSize(brushR - 1);
    else if (code === 'BracketRight' || k === ']') setSize(brushR + 1);
  });

  window.addEventListener('resize', function () { needResize = true; });

  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function updateStats() {
    if (!statsEl) return;
    statsEl.innerHTML = 'Клеток занято: ' + fmt(particleCount) +
      ' · поле ' + W + '×' + H + (paused ? '<span class="badge">ПАУЗА</span>' : '');
  }

  // ---------- Цикл ----------
  var acc = 0, last = 0, statT = 0;

  function frame(now) {
    if (!last) last = now;
    var dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;                  // кламп большого dt (вкладка в фоне и т.п.)
    if (needResize) setup();
    if (pointer.down) applyBrush(dt);
    if (!paused) {
      acc += dt;
      var n = 0;
      while (acc >= STEP_DT && n < MAX_STEPS) { step(); acc -= STEP_DT; n++; }
      if (acc >= STEP_DT) acc = 0;           // не копим отставание
    }
    render();
    statT += dt;
    if (statT >= 0.25) { statT = 0; updateStats(); }
    requestAnimationFrame(frame);
  }

  setup();
  selectMat(0);
  setSize(brushR);
  buildScene();
  render();
  updateStats();
  requestAnimationFrame(frame);

  // Отладочный доступ к автомату (для проверок из консоли / тестов).
  window.__fallingSand = {
    step: step,
    time: function () { return tick / STEP_HZ; },   // время автомата, с (шаги / 120)
    clear: clearAll,
    scene: buildScene,
    grid: function () { return { W: W, H: H, type: type, aux: aux }; },
    put: function (x, y, m) { put(x, y, m, false); },
    T: { EMPTY: EMPTY, SAND: SAND, WATER: WATER, STONE: STONE, WOOD: WOOD, FIRE: FIRE, SMOKE: SMOKE, BURN: BURN }
  };
})();
