/* Падающий песок — клеточный автомат на Canvas 2D.
   Claude Opus 5. Без сборки, без внешних ресурсов, без WebGL. */
(function () {
  'use strict';

  /* ============================== вещества ============================== */
  var EMPTY = 0, SAND = 1, WATER = 2, STONE = 3, WOOD = 4, FIRE = 5, SMOKE = 6;
  var KEY_ORDER = [SAND, WATER, STONE, WOOD, FIRE, SMOKE, EMPTY]; // клавиши 1..7

  /* ============================== параметры ============================= */
  var SIM_HZ = 90;                 // фиксированный шаг симуляции
  var STEP_MS = 1000 / SIM_HZ;
  var MAX_STEPS = 3;               // не больше 3 шагов за кадр (защита от спирали)
  var TARGET_COLS = 360;           // ориентир по числу клеток
  var TARGET_ROWS = 220;
  var MIN_CELL = 3;                // пиксель клетки всегда > 1 CSS-px

  // Дерево не вспыхивает по случайности, а накапливает жар от соседнего огня
  // (в life[] у дерева лежит именно жар). Так фронт горения не гаснет наугад,
  // а древесина успевает обуглиться на глазах.
  var HEAT_MAX = 150, HEAT_INV = 1 / 150;          // порог тления: чем выше, тем медленнее фронт
  var FIRE_LIFE = 72, FIRE_LIFE_R = 56;            // 72..127 шагов ≈ 0,8–1,4 с горения
  var FIRE_COL = 31 / (FIRE_LIFE + FIRE_LIFE_R);   // жизнь пламени → индекс в палитре
  var SMOKE_LIFE = 70, SMOKE_LIFE_R = 95;
  var QUIET_MS = 800;              // сцена догорела и улеглась — собираем её заново

  /* ============================ ГСЧ (xorshift32) ======================== */
  var rngState = 0x1f123bb5 | 0;
  function rnd() {
    var s = rngState;
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    rngState = s;
    return (s >>> 0) / 4294967296;
  }
  function rndInt(n) { return (rnd() * n) | 0; }

  /* ================================ DOM ================================= */
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var statEl = document.getElementById('stat');
  var matsBox = document.getElementById('mats');
  var brushInput = document.getElementById('brush');
  var brushValEl = document.getElementById('brushVal');
  var pauseBtn = document.getElementById('pause');
  var clearBtn = document.getElementById('clear');
  var sceneBtn = document.getElementById('sceneBtn');

  var gridCanvas = document.createElement('canvas');
  var gctx = gridCanvas.getContext('2d');
  var glowCanvas = document.createElement('canvas');
  var glctx = glowCanvas.getContext('2d');

  /* ============================== состояние ============================= */
  var W = 0, H = 0, cell = 4, dpr = 1;
  var type = null, life = null, tint = null, dir = null, flag = null;
  var img = null, glowImg = null, glowDirty = false;
  var bgR = null, bgG = null, bgB = null;

  var frame = 0;
  var paused = false;
  var current = SAND;
  var brush = 7;
  var eraseMode = false;

  var pointer = { down: false, inside: false, x: 0, y: 0, id: -1 };
  var lastPaintX = null, lastPaintY = null;

  // Демо-сцена повторяется, пока в неё не вмешался пользователь: иначе через
  // полминуты всё дерево догорает и витрина навсегда остаётся без огня и дыма.
  var autoScene = true, quietMs = 0;

  var resizePending = true;
  var firstBuild = true;

  /* ============================== палитры =============================== */
  function cl(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

  function makeLut(r, g, b, vr, vg, vb) {
    var a = new Uint8Array(32 * 3);
    for (var k = 0; k < 32; k++) {
      var f = (k / 31 - 0.5) * 2;
      a[k * 3] = cl(r + vr * f);
      a[k * 3 + 1] = cl(g + vg * f);
      a[k * 3 + 2] = cl(b + vb * f);
    }
    return a;
  }

  var sandLut = makeLut(214, 174, 100, 30, 28, 26);
  var waterLut = makeLut(44, 104, 194, 14, 18, 26);
  var stoneLut = makeLut(102, 108, 122, 22, 22, 24);
  var woodLut = makeLut(118, 78, 44, 26, 20, 14);

  var FIRE_STOPS = [
    [0.00, 108, 18, 10],
    [0.25, 206, 62, 18],
    [0.50, 248, 132, 30],
    [0.75, 255, 198, 96],
    [1.00, 255, 246, 208]
  ];
  var fireLut = (function () {
    var a = new Uint8Array(32 * 3);
    for (var k = 0; k < 32; k++) {
      var f = k / 31, s = 0;
      while (s < FIRE_STOPS.length - 2 && f > FIRE_STOPS[s + 1][0]) s++;
      var A = FIRE_STOPS[s], B = FIRE_STOPS[s + 1];
      var t = (f - A[0]) / (B[0] - A[0]);
      a[k * 3] = cl(A[1] + (B[1] - A[1]) * t);
      a[k * 3 + 1] = cl(A[2] + (B[2] - A[2]) * t);
      a[k * 3 + 2] = cl(A[3] + (B[3] - A[3]) * t);
    }
    return a;
  })();

  function buildBg() {
    bgR = new Uint8Array(H); bgG = new Uint8Array(H); bgB = new Uint8Array(H);
    for (var y = 0; y < H; y++) {
      var f = H > 1 ? y / (H - 1) : 0;
      bgR[y] = cl(17 + (8 - 17) * f);
      bgG[y] = cl(21 + (10 - 21) * f);
      bgB[y] = cl(32 + (16 - 32) * f);
    }
  }

  /* ============================ работа с сеткой ========================= */
  function rebuildGrid(nW, nH) {
    var n = nW * nH;
    var nType = new Uint8Array(n), nLife = new Uint8Array(n),
        nTint = new Uint8Array(n), nDir = new Int8Array(n);

    if (W > 0 && H > 0 && type) {
      // содержимое переносим, прижимая к низу и к левому краю
      var cw = W < nW ? W : nW, ch = H < nH ? H : nH;
      for (var y = 0; y < ch; y++) {
        var so = (H - 1 - y) * W, doo = (nH - 1 - y) * nW;
        for (var x = 0; x < cw; x++) {
          nType[doo + x] = type[so + x];
          nLife[doo + x] = life[so + x];
          nTint[doo + x] = tint[so + x];
          nDir[doo + x] = dir[so + x];
        }
      }
    }

    W = nW; H = nH;
    type = nType; life = nLife; tint = nTint; dir = nDir;
    flag = new Uint8Array(n);

    gridCanvas.width = W; gridCanvas.height = H;
    glowCanvas.width = W; glowCanvas.height = H;
    img = gctx.createImageData(W, H);
    glowImg = glctx.createImageData(W, H);
    glowDirty = false;

    var d = img.data;
    for (var p = 3; p < d.length; p += 4) d[p] = 255; // сцена непрозрачна
    buildBg();
  }

  function setCell(i, m) {
    type[i] = m;
    tint[i] = rndInt(256);
    if (m === FIRE) { life[i] = FIRE_LIFE + rndInt(FIRE_LIFE_R); dir[i] = 0; }
    else if (m === SMOKE) { life[i] = SMOKE_LIFE + rndInt(SMOKE_LIFE_R); dir[i] = 0; }
    else if (m === WATER) { life[i] = 0; dir[i] = rnd() < 0.5 ? 1 : -1; }
    else { life[i] = 0; dir[i] = 0; }
  }

  function clearGrid() {
    type.fill(EMPTY); life.fill(0); dir.fill(0);
  }

  // fillSoft = true — заливка ложится только в пустые клетки и ничего не затирает
  var fillSoft = false;
  function put(i, m) {
    if (fillSoft && type[i] !== EMPTY) return;
    setCell(i, m);
  }

  function fillRect(x0, y0, x1, y1, m, p) {
    if (x0 > x1) { var tx = x0; x0 = x1; x1 = tx; }
    if (y0 > y1) { var ty = y0; y0 = y1; y1 = ty; }
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 > W - 1) x1 = W - 1; if (y1 > H - 1) y1 = H - 1;
    for (var y = y0; y <= y1; y++) {
      var row = y * W;
      for (var x = x0; x <= x1; x++) {
        if (p < 1 && rnd() > p) continue;
        put(row + x, m);
      }
    }
  }

  function fillCircle(cx, cy, r, m, p) {
    var r2 = r * r;
    for (var dy = -r; dy <= r; dy++) {
      var y = cy + dy; if (y < 0 || y >= H) continue;
      var row = y * W;
      for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        var x = cx + dx; if (x < 0 || x >= W) continue;
        if (p < 1 && rnd() > p) continue;
        put(row + x, m);
      }
    }
  }

  function fillLine(x0, y0, x1, y1, thick, m, p) {
    var steps = Math.max(1, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (var s = 0; s <= steps; s++) {
      var t = s / steps;
      fillCircle(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), thick, m, p);
    }
  }

  /* ============================= демо-сцена ============================= */
  var R = Math.round;
  function groundY() { return H - Math.max(3, R(H * 0.030)); }

  // Пламя ставим только туда, где есть чему гореть или где пусто:
  // так костёр не выжигает дыру в камне и не портит рисунок пользователя.
  function ignitePatch(cx, cy, r, p) {
    var r2 = r * r;
    for (var dy = -r; dy <= r; dy++) {
      var y = cy + dy; if (y < 0 || y >= H) continue;
      var row = y * W;
      for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        var x = cx + dx; if (x < 0 || x >= W) continue;
        var i = row + x, t = type[i];
        if (t !== EMPTY && t !== WOOD) continue;
        if (p < 1 && rnd() > p) continue;
        setCell(i, FIRE);
      }
    }
  }

  // Дерево во весь рост, забор и костёр у корня. soft = true — «лес отрастает»
  // только в пустых клетках, поверх уже нарисованного ничего не затирая.
  function plantTree(soft) {
    var ground = groundY();
    var tx = R(W * 0.76), tw = Math.max(1, R(W * 0.008));
    var ttop = Math.max(2, ground - R(H * 0.68));         // ствол на две трети кадра
    var crownR = Math.max(5, R(H * 0.15));

    fillSoft = soft;
    fillRect(tx - tw, ttop, tx + tw, ground - 1, WOOD, 1);
    fillLine(tx, ttop + R(H * 0.17), tx - R(W * 0.075), ttop + R(H * 0.05), Math.max(1, tw - 1), WOOD, 1);
    fillLine(tx, ttop + R(H * 0.24), tx + R(W * 0.075), ttop + R(H * 0.11), Math.max(1, tw - 1), WOOD, 1);
    fillCircle(tx, ttop - R(H * 0.02), crownR, WOOD, 0.8);
    fillCircle(tx - R(W * 0.062), ttop + R(H * 0.05), Math.max(4, R(H * 0.085)), WOOD, 0.66);
    fillCircle(tx + R(W * 0.062), ttop + R(H * 0.10), Math.max(4, R(H * 0.085)), WOOD, 0.66);

    // забор вдоль земли — длинная дорожка для огня в обе стороны от костра
    var fx0 = R(W * 0.615), fx1 = R(W * 0.885);
    var railY = ground - Math.max(4, R(H * 0.05));
    fillRect(fx0, railY, fx1, railY + Math.max(1, R(H * 0.011)), WOOD, 1);
    var pstep = Math.max(4, R(W * 0.032)), pw = Math.max(0, R(W * 0.004));
    for (var px = fx0; px <= fx1; px += pstep) {
      fillRect(px, railY - Math.max(2, R(H * 0.02)), px + pw, ground - 1, WOOD, 1);
    }

    // поленница у корня — топливо, с которого начинается пожар
    fillCircle(tx, ground - Math.max(3, R(H * 0.04)), Math.max(5, R(H * 0.05)), WOOD, 0.95);
    fillSoft = false;

    ignitePatch(tx, ground - Math.max(4, R(H * 0.03)), Math.max(3, R(H * 0.026)), 0.8);
  }

  function buildScene() {
    clearGrid();
    var ground = groundY();
    fillRect(0, ground, W - 1, H - 1, STONE, 1);          // земля

    /* --- у левого края: штабель брёвен, до него огонь не дотянется --- */
    fillRect(R(W * 0.004), ground - R(H * 0.10), R(W * 0.040), ground - 1, WOOD, 1);

    /* --- слева: высокий каменный бассейн с водой --- */
    var bx0 = R(W * 0.045), bx1 = R(W * 0.35);
    var wall = Math.max(2, R(W * 0.013));
    var btop = Math.max(2, ground - R(H * 0.46));
    fillRect(bx0, btop, bx0 + wall, ground - 1, STONE, 1);
    fillRect(bx1 - wall, btop, bx1, ground - 1, STONE, 1);
    fillRect(bx0 + wall + 1, ground - R(H * 0.34), bx1 - wall - 1, ground - 1, WATER, 1);

    /* --- струя песка с самой верхней кромки: летит через весь кадр --- */
    var sx = R((bx0 + bx1) / 2);
    var sw = Math.max(2, R(W * 0.016));
    fillRect(sx - sw, 0, sx + sw, R(H * 0.13), SAND, 0.9);
    fillCircle(sx, R(H * 0.22), Math.max(4, R(H * 0.05)), SAND, 0.95);

    /* --- центр: высокий каменный уступ с горкой песка --- */
    var lx0 = R(W * 0.40), lx1 = R(W * 0.55), ly = ground - R(H * 0.50);
    fillRect(lx0, ly, lx1, ly + Math.max(2, R(H * 0.018)), STONE, 1);
    fillCircle(R((lx0 + lx1) / 2), ly - R(H * 0.055), Math.max(4, R(H * 0.06)), SAND, 0.95);

    /* --- справа: дерево во весь рост и костёр у корня --- */
    plantTree(false);

    /* --- дальний правый край: колонна с песчаной шапкой --- */
    var cx0 = R(W * 0.90), cx1 = R(W * 0.945);
    fillRect(cx0, ground - R(H * 0.26), cx1, ground - 1, STONE, 1);
    fillCircle(R((cx0 + cx1) / 2), ground - R(H * 0.30), Math.max(3, R(H * 0.04)), SAND, 0.9);

    frame = 0;
  }

  /* ============================== симуляция ============================= */
  function solid(t) { return t === STONE || t === WOOD; }

  function swapCells(i, j) {
    var t = type[i]; type[i] = type[j]; type[j] = t;
    var l = life[i]; life[i] = life[j]; life[j] = l;
    var n = tint[i]; tint[i] = tint[j]; tint[j] = n;
    var d = dir[i]; dir[i] = dir[j]; dir[j] = d;
    flag[i] = 1; flag[j] = 1;
  }

  /* ---- песок ---- */
  function sandEnter(t) { return t === EMPTY || t === WATER || t === SMOKE || t === FIRE; }

  function sandInto(i, j) {
    if (type[j] === FIRE) {           // песок засыпает огонь
      type[j] = SAND; tint[j] = tint[i]; life[j] = 0; dir[j] = 0;
      if (rnd() < 0.6) { type[i] = SMOKE; life[i] = SMOKE_LIFE + rndInt(SMOKE_LIFE_R); tint[i] = rndInt(256); }
      else { type[i] = EMPTY; life[i] = 0; }
      dir[i] = 0; flag[i] = 1; flag[j] = 1;
    } else swapCells(i, j);
  }

  function sandDiag(x, y, i, dx) {
    var nx = x + dx;
    if (nx < 0 || nx >= W) return false;
    if (solid(type[i + dx])) return false;         // сквозь стену по диагонали нельзя
    var j = i + W + dx;
    if (!sandEnter(type[j])) return false;
    sandInto(i, j);
    return true;
  }

  function sandTick(x, y, i) {
    if (y + 1 >= H) { flag[i] = 1; return; }
    var b = i + W;
    if (sandEnter(type[b])) { sandInto(i, b); return; }
    var d = rnd() < 0.5 ? 1 : -1;
    if (sandDiag(x, y, i, d)) return;
    if (sandDiag(x, y, i, -d)) return;
    flag[i] = 1;
  }

  /* ---- вода ---- */
  function steamFrom(iWater, jFire) {
    type[jFire] = SMOKE;
    life[jFire] = SMOKE_LIFE + rndInt(SMOKE_LIFE_R);
    tint[jFire] = rndInt(256); dir[jFire] = 0;
    if (rnd() < 0.12) {                             // немного воды испаряется
      type[iWater] = SMOKE;
      life[iWater] = SMOKE_LIFE + rndInt(SMOKE_LIFE_R);
      tint[iWater] = rndInt(256); dir[iWater] = 0;
    }
    flag[iWater] = 1; flag[jFire] = 1;
  }

  function waterDiag(x, y, i, dx) {
    var nx = x + dx;
    if (nx < 0 || nx >= W) return false;
    if (solid(type[i + dx])) return false;
    var j = i + W + dx, tj = type[j];
    if (tj === EMPTY || tj === SMOKE) { dir[i] = dx; swapCells(i, j); return true; }
    if (tj === FIRE) { steamFrom(i, j); return true; }
    return false;
  }

  function waterSide(x, y, i, dx) {
    var nx = x + dx;
    if (nx < 0 || nx >= W) return false;
    var j = i + dx, tj = type[j];
    if (tj === EMPTY) { dir[i] = dx; swapCells(i, j); return true; }
    if (tj === FIRE) { steamFrom(i, j); return true; }
    return false;
  }

  function waterTick(x, y, i) {
    if (y + 1 < H) {
      var b = i + W, tb = type[b];
      if (tb === EMPTY || tb === SMOKE) { swapCells(i, b); return; }
      if (tb === FIRE) { steamFrom(i, b); return; }
      var d = rnd() < 0.5 ? 1 : -1;
      if (waterDiag(x, y, i, d)) return;
      if (waterDiag(x, y, i, -d)) return;
    }
    // растекание: направление живёт вместе с каплей и переворачивается о препятствие
    var dd = dir[i] === 1 || dir[i] === -1 ? dir[i] : (rnd() < 0.5 ? 1 : -1);
    if (waterSide(x, y, i, dd)) return;
    if (waterSide(x, y, i, -dd)) return;
    dir[i] = -dd;
    flag[i] = 1;
  }

  /* ---- огонь ---- */
  function fireUp(x, y, i, dx) {
    var nx = x + dx;
    if (nx < 0 || nx >= W) return false;
    if (solid(type[i + dx])) return false;
    var j = i - W + dx;
    if (type[j] !== EMPTY) return false;
    swapCells(i, j);
    return true;
  }

  function fireTick(x, y, i) {
    var fuel = false, wet = false;
    var y0 = y > 0 ? -1 : 0, y1 = y < H - 1 ? 1 : 0;
    var x0 = x > 0 ? -1 : 0, x1 = x < W - 1 ? 1 : 0;
    for (var dy = y0; dy <= y1; dy++) {
      var base = i + dy * W;
      for (var dx = x0; dx <= x1; dx++) {
        if (dx === 0 && dy === 0) continue;
        var j = base + dx, tj = type[j];
        if (tj === WOOD) {
          fuel = true;
          var heat = life[j] + 1;                 // жар копится от каждого соседнего пламени
          if (heat >= HEAT_MAX) {
            type[j] = FIRE; life[j] = FIRE_LIFE + rndInt(FIRE_LIFE_R);
            tint[j] = rndInt(256); dir[j] = 0; flag[j] = 1;
          } else life[j] = heat;
        } else if (tj === WATER) wet = true;
      }
    }

    if (wet) {                                   // вода тушит огонь — остаётся пар
      type[i] = SMOKE; life[i] = SMOKE_LIFE + rndInt(SMOKE_LIFE_R);
      tint[i] = rndInt(256); dir[i] = 0; flag[i] = 1; return;
    }

    var dec = fuel ? 1 : 2;                      // без топлива гаснет вдвое быстрее
    if (life[i] <= dec) {
      if (rnd() < 0.7) { type[i] = SMOKE; life[i] = SMOKE_LIFE + rndInt(SMOKE_LIFE_R); tint[i] = rndInt(256); }
      else { type[i] = EMPTY; life[i] = 0; }
      dir[i] = 0; flag[i] = 1; return;
    }
    life[i] -= dec;

    if (fuel) {
      // огонь держится за топливо, но выбрасывает вверх короткие языки пламени
      if (y > 0 && type[i - W] === EMPTY && rnd() < 0.05) {
        var u = i - W;
        type[u] = FIRE; life[u] = 34 + rndInt(26);
        tint[u] = rndInt(256); dir[u] = 0; flag[u] = 1;
      }
    } else if (y > 0 && rnd() < 0.45) {          // пламя без топлива поднимается и гаснет
      if (type[i - W] === EMPTY) { swapCells(i, i - W); return; }
      var d = rnd() < 0.5 ? 1 : -1;
      if (fireUp(x, y, i, d)) return;
      if (fireUp(x, y, i, -d)) return;
    }
    flag[i] = 1;
  }

  /* ---- дым ---- */
  function smokeDiag(x, y, i, dx) {
    var nx = x + dx;
    if (nx < 0 || nx >= W) return false;
    if (solid(type[i + dx])) return false;
    var j = i - W + dx, tj = type[j];
    if (tj === EMPTY || tj === WATER) { swapCells(i, j); return true; }
    return false;
  }

  function smokeTick(x, y, i) {
    if (life[i] <= 1) { type[i] = EMPTY; life[i] = 0; dir[i] = 0; flag[i] = 1; return; }
    life[i]--;

    if (y > 0) {
      var a = i - W, ta = type[a];
      if (ta === EMPTY || ta === WATER) { swapCells(i, a); return; }
      var d = rnd() < 0.5 ? 1 : -1;
      if (smokeDiag(x, y, i, d)) return;
      if (smokeDiag(x, y, i, -d)) return;
    } else if (rnd() < 0.25) {                   // у потолка дым тает быстрее
      type[i] = EMPTY; life[i] = 0; flag[i] = 1; return;
    }

    if (rnd() < 0.35) {                          // лёгкий боковой снос, симметричный
      var s = rnd() < 0.5 ? 1 : -1;
      var nx = x + s;
      if (nx >= 0 && nx < W && type[i + s] === EMPTY) { swapCells(i, i + s); return; }
    }
    flag[i] = 1;
  }

  /* ---- один шаг автомата ---- */
  function tick(x, y, i) {
    var t = type[i];
    if (t === EMPTY || t === STONE || t === WOOD) return;
    if (flag[i]) return;                          // клетка уже обработана в этом шаге
    if (t === SAND) sandTick(x, y, i);
    else if (t === WATER) waterTick(x, y, i);
    else if (t === FIRE) fireTick(x, y, i);
    else smokeTick(x, y, i);
  }

  function step() {
    frame++;
    flag.fill(0);
    for (var y = H - 1; y >= 0; y--) {
      var row = y * W;
      if (((y + frame) & 1) === 0) {              // направление обхода чередуется
        for (var x = 0; x < W; x++) tick(x, y, row + x);
      } else {
        for (var x2 = W - 1; x2 >= 0; x2--) tick(x2, y, row + x2);
      }
    }
  }

  /* =============================== рендер =============================== */
  var lastCount = 0, lastFire = 0, lastSmoke = 0;

  function render() {
    var d = img.data, g = glowImg.data;
    if (glowDirty) { g.fill(0); glowDirty = false; }

    var count = 0, fires = 0, smokes = 0;

    for (var y = 0; y < H; y++) {
      var br = bgR[y], bg = bgG[y], bb = bgB[y];
      var i = y * W;
      for (var x = 0; x < W; x++, i++) {
        var t = type[i], p = i << 2, r, gg, b, k;

        if (t === EMPTY) { r = br; gg = bg; b = bb; }
        else {
          count++;
          if (t === SAND) {
            k = (tint[i] & 31) * 3; r = sandLut[k]; gg = sandLut[k + 1]; b = sandLut[k + 2];
          } else if (t === WATER) {
            k = (tint[i] & 31) * 3; r = waterLut[k]; gg = waterLut[k + 1]; b = waterLut[k + 2];
            // блик — только на настоящей кромке водоёма, не на летящих каплях
            if (y > 0 && y < H - 1 && type[i - W] !== WATER && type[i + W] === WATER) {
              r = cl(r + 26); gg = cl(gg + 32); b = cl(b + 22);
            }
          } else if (t === STONE) {
            k = (tint[i] & 31) * 3; r = stoneLut[k]; gg = stoneLut[k + 1]; b = stoneLut[k + 2];
          } else if (t === WOOD) {
            k = (tint[i] & 31) * 3;
            var hh = life[i];
            if (hh) {                              // обугливание: темнеет и наливается жаром
              var q = hh * HEAT_INV, f = 1 - 0.72 * q;
              r = cl(woodLut[k] * f + 52 * q);
              gg = cl(woodLut[k + 1] * f + 12 * q);
              b = cl(woodLut[k + 2] * f);
            } else { r = woodLut[k]; gg = woodLut[k + 1]; b = woodLut[k + 2]; }
          } else if (t === FIRE) {
            var fk = (life[i] * FIRE_COL) | 0; if (fk > 31) fk = 31; else if (fk < 2) fk = 2;
            k = fk * 3; r = fireLut[k]; gg = fireLut[k + 1]; b = fireLut[k + 2];
            g[p] = r; g[p + 1] = gg; g[p + 2] = b; g[p + 3] = 110 + fk * 4;
            glowDirty = true; fires++;
          } else { // SMOKE
            smokes++;
            var a = life[i] * (1 / 70); if (a > 1) a = 1;
            a *= 0.86;
            var v = (tint[i] & 15) - 8;
            r = cl(br + (128 + v - br) * a);
            gg = cl(bg + (134 + v - bg) * a);
            b = cl(bb + (148 + v - bb) * a);
          }
        }
        d[p] = r; d[p + 1] = gg; d[p + 2] = b;
      }
    }

    lastCount = count; lastFire = fires; lastSmoke = smokes;

    gctx.putImageData(img, 0, 0);

    var dw = W * cell * dpr, dh = H * cell * dpr;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(gridCanvas, 0, 0, W, H, 0, 0, dw, dh);

    if (fires > 0) {
      glctx.putImageData(glowImg, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.7;
      if (typeof ctx.filter === 'string') ctx.filter = 'blur(' + (cell * dpr * 1.15).toFixed(1) + 'px)';
      ctx.drawImage(glowCanvas, 0, 0, W, H, 0, 0, dw, dh);
      ctx.restore();
    }

    if (pointer.inside) {
      var px = (pointer.x + 0.5) * cell * dpr;
      var py = (pointer.y + 0.5) * cell * dpr;
      var pr = Math.max(3, (brush + 0.5) * cell * dpr);
      ctx.save();
      ctx.lineWidth = Math.max(1, dpr);
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath(); ctx.arc(px, py, pr + ctx.lineWidth, 0, 6.28318530718); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.6)';
      ctx.beginPath(); ctx.arc(px, py, pr, 0, 6.28318530718); ctx.stroke();
      ctx.restore();
    }
  }

  /* ================================ кисть =============================== */
  function brushDensity(m) {
    return m === SAND ? 0.85 : m === WATER ? 0.8 : m === FIRE ? 0.5 : m === SMOKE ? 0.35 : 1;
  }

  function paintAt(cx, cy) {
    var m = eraseMode ? EMPTY : current;
    var r = brush, r2 = r * r, dens = brushDensity(m);
    for (var dy = -r; dy <= r; dy++) {
      var y = cy + dy; if (y < 0 || y >= H) continue;
      var row = y * W;
      for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        var x = cx + dx; if (x < 0 || x >= W) continue;
        var i = row + x;
        if (m === EMPTY) { type[i] = EMPTY; life[i] = 0; dir[i] = 0; continue; }
        if (dens < 1 && rnd() > dens) continue;
        var t = type[i];
        if (m === STONE || m === WOOD) { /* твёрдое заменяет что угодно */ }
        else if (m === FIRE) {
          // Факел ПОДЖИГАЕТ дерево, а не стирает его: часть клеток вспыхивает,
          // остальные набирают жар и загораются сами — полено остаётся и горит.
          if (t === WOOD) {
            if (rnd() < 0.12) setCell(i, FIRE);
            else { var nh = life[i] + 26; life[i] = nh >= HEAT_MAX ? HEAT_MAX - 1 : nh; }
            continue;
          }
          if (t !== EMPTY && t !== SMOKE) continue;
        }
        else { if (t !== EMPTY && t !== SMOKE) continue; }
        setCell(i, m);
      }
    }
  }

  function strokeTo(x, y) {
    if (lastPaintX === null) { paintAt(x, y); }
    else {
      var dx = x - lastPaintX, dy = y - lastPaintY;
      var dist = Math.max(Math.abs(dx), Math.abs(dy));
      var n = Math.max(1, Math.ceil(dist / Math.max(1, brush * 0.5)));
      for (var s = 1; s <= n; s++) {
        paintAt(Math.round(lastPaintX + dx * s / n), Math.round(lastPaintY + dy * s / n));
      }
    }
    lastPaintX = x; lastPaintY = y;
  }

  function toCell(e) {
    var rect = canvas.getBoundingClientRect();
    var x = Math.floor((e.clientX - rect.left) / cell);
    var y = Math.floor((e.clientY - rect.top) / cell);
    if (x < 0) x = 0; else if (x > W - 1) x = W - 1;
    if (y < 0) y = 0; else if (y > H - 1) y = H - 1;
    return { x: x, y: y };
  }

  /* ============================== ввод ================================== */
  function onDown(e) {
    var c = toCell(e);
    pointer.down = true; pointer.inside = true;
    pointer.x = c.x; pointer.y = c.y;
    eraseMode = current === EMPTY || e.button === 2;
    lastPaintX = null;
    strokeTo(c.x, c.y);
    if (e.pointerId !== undefined) {
      pointer.id = e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    }
    if (e.cancelable) e.preventDefault();
  }

  function onMove(e) {
    var c = toCell(e);
    pointer.x = c.x; pointer.y = c.y; pointer.inside = true;
    if (pointer.down && e.cancelable) e.preventDefault();
  }

  function onUp(e) {
    pointer.down = false;
    lastPaintX = null;
    eraseMode = current === EMPTY;
    if (e && e.pointerId !== undefined) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    }
  }

  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', function () { if (!pointer.down) pointer.inside = false; });
  } else {
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', function () { if (!pointer.down) pointer.inside = false; });
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length) onDown(e.touches[0]);
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length) onMove(e.touches[0]);
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchend', function () { onUp(null); });
  }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ============================== интерфейс ============================= */
  function selectMat(m) {
    current = m;
    eraseMode = m === EMPTY;
    var btns = matsBox.querySelectorAll('.mat');
    for (var i = 0; i < btns.length; i++) {
      var on = +btns[i].getAttribute('data-mat') === m;
      btns[i].classList.toggle('is-on', on);
    }
  }

  matsBox.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.mat') : null;
    if (b) selectMat(+b.getAttribute('data-mat'));
  });

  brushInput.addEventListener('input', function () {
    brush = Math.max(1, Math.min(26, +brushInput.value || 1));
    brushValEl.textContent = String(brush);
  });

  function setPaused(v) {
    paused = v;
    pauseBtn.textContent = paused ? 'Продолжить' : 'Пауза';
    pauseBtn.classList.toggle('is-on', paused);
  }

  function doClear() { clearGrid(); frame = 0; autoScene = false; quietMs = 0; }
  function doScene() { buildScene(); autoScene = true; quietMs = 0; }

  pauseBtn.addEventListener('click', function () { setPaused(!paused); pauseBtn.blur(); });
  clearBtn.addEventListener('click', function () { doClear(); clearBtn.blur(); });
  sceneBtn.addEventListener('click', function () { doScene(); sceneBtn.blur(); });

  window.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;
    if (k === ' ' || k === 'Spacebar') { e.preventDefault(); if (!e.repeat) setPaused(!paused); return; }
    if (k >= '1' && k <= '7') { selectMat(KEY_ORDER[+k - 1]); return; }
    var low = k.length === 1 ? k.toLowerCase() : k;
    if (low === 'c' || low === 'с') { doClear(); return; }
    if (low === 'r' || low === 'к') { doScene(); return; }
    if (k === '[' || k === '-') { brushInput.value = String(Math.max(1, brush - 1)); brushInput.dispatchEvent(new Event('input')); return; }
    if (k === ']' || k === '=' || k === '+') { brushInput.value = String(Math.min(26, brush + 1)); brushInput.dispatchEvent(new Event('input')); return; }
  });

  window.addEventListener('resize', function () { resizePending = true; });
  window.addEventListener('orientationchange', function () { resizePending = true; });

  /* ============================== размеры =============================== */
  function applyResize() {
    resizePending = false;
    var cssW = Math.max(1, canvas.clientWidth || window.innerWidth || 1);
    var cssH = Math.max(1, canvas.clientHeight || window.innerHeight || 1);
    var nDpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    var nCell = Math.max(MIN_CELL, Math.ceil(Math.max(cssW / TARGET_COLS, cssH / TARGET_ROWS)));
    var nW = Math.max(24, Math.ceil(cssW / nCell));
    var nH = Math.max(24, Math.ceil(cssH / nCell));
    var cw = Math.round(cssW * nDpr), ch = Math.round(cssH * nDpr);

    if (nW === W && nH === H && nCell === cell && nDpr === dpr &&
        canvas.width === cw && canvas.height === ch) return;

    cell = nCell; dpr = nDpr;
    canvas.width = cw; canvas.height = ch;
    if (nW !== W || nH !== H) rebuildGrid(nW, nH);
  }

  /* =============================== цикл ================================= */
  var acc = 0, last = 0, fps = 0, statAt = 0;

  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  function loop(now) {
    requestAnimationFrame(loop);

    if (resizePending) applyResize();

    if (!last) last = now;
    var dt = now - last; last = now;
    if (dt < 0) dt = 0;
    if (dt > 120) dt = 120;
    fps = fps ? fps * 0.92 + (dt > 0 ? 1000 / dt : 0) * 0.08 : (dt > 0 ? 1000 / dt : 60);

    if (!paused) {
      acc += dt;
      var n = 0;
      while (acc >= STEP_MS && n < MAX_STEPS) { step(); acc -= STEP_MS; n++; }
      if (acc > STEP_MS * MAX_STEPS) acc = 0;
    } else acc = 0;

    if (pointer.down) strokeTo(pointer.x, pointer.y);

    render();

    // Всё догорело и дым разошёлся — лес отрастает заново, чтобы витрина не
    // пустела. Заливка идёт только по пустым клеткам, поэтому рисунок
    // пользователя не страдает и отключать это на время рисования не нужно.
    if (autoScene && !paused) {
      if (lastFire === 0 && lastSmoke === 0) {
        quietMs += dt;
        if (quietMs >= QUIET_MS) { plantTree(true); quietMs = 0; }
      } else quietMs = 0;
    }

    if (now - statAt > 250) {
      statAt = now;
      statEl.textContent = 'клеток ' + fmt(lastCount) + ' · огня ' + fmt(lastFire) +
        ' · дыма ' + fmt(lastSmoke) +
        ' · сетка ' + W + '×' + H + ' · ' + Math.round(fps) + ' к/с · шаг ' + SIM_HZ + ' Гц' +
        (paused ? ' · пауза' : '');
    }
  }

  /* =============================== старт ================================ */
  applyResize();
  if (firstBuild) { firstBuild = false; buildScene(); }
  setPaused(false);
  selectMat(SAND);
  brush = +brushInput.value || 7;
  brushValEl.textContent = String(brush);
  requestAnimationFrame(loop);
})();
