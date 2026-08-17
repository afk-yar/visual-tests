'use strict';

// «Падающий песок» — клеточный автомат.
// Вещества: 0 пусто, 1 песок, 2 вода, 3 камень, 4 дерево, 5 огонь, 6 дым.

(function () {
  var EMPTY = 0, SAND = 1, WATER = 2, STONE = 3, WOOD = 4, FIRE = 5, SMOKE = 6;

  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d');

  // Сетка
  var W = 0, H = 0;
  var cellType;  // Uint8Array — вещество
  var life;      // Int16Array — время жизни (огонь/дым, у дерева — остаток горения)
  var variant;   // Uint8Array — вариация цвета
  var stamp;     // Uint16Array — клетка уже ходила на этом шаге
  var frameId = 0;
  var cssW = 0, cssH = 0, dpr = 1;

  var off = document.createElement('canvas');
  var offCtx = off.getContext('2d');
  var img = null;

  var paused = false;
  var brushMat = SAND;
  var brushSize = 6;
  var painting = false;
  var mouseX = 0, mouseY = 0;

  // Палитры [r,g,b] с вариациями
  var PALETTES = {};
  PALETTES[SAND] = [[217, 178, 106], [226, 190, 120], [204, 166, 96], [235, 198, 130]];
  PALETTES[WATER] = [[52, 116, 205], [62, 128, 214], [44, 106, 192], [72, 140, 224]];
  PALETTES[STONE] = [[128, 133, 141], [118, 123, 131], [140, 145, 152], [108, 113, 120]];
  PALETTES[WOOD] = [[122, 82, 48], [112, 74, 42], [132, 90, 54]];
  PALETTES[FIRE] = [[255, 154, 60], [255, 196, 60], [255, 110, 40], [255, 220, 90]];
  PALETTES[SMOKE] = [[150, 155, 162], [138, 143, 150], [162, 167, 174]];
  var BG = [14, 17, 22];

  function idx(x, y) { return y * W + x; }

  function fireLife() { return 20 + (Math.random() * 40) | 0; }
  function smokeLife() { return 120 + (Math.random() * 180) | 0; }

  function setCell(x, y, t) {
    var i = idx(x, y);
    cellType[i] = t;
    variant[i] = (Math.random() * 256) | 0;
    if (t === FIRE) life[i] = fireLife();
    else if (t === SMOKE) life[i] = smokeLife();
    else life[i] = 0;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    var cellPx = Math.max(3, Math.round(Math.min(cssW, cssH) / 170));
    W = Math.max(40, Math.floor(cssW / cellPx));
    H = Math.max(30, Math.floor(cssH / cellPx));
    var n = W * H;
    cellType = new Uint8Array(n);
    life = new Int16Array(n);
    variant = new Uint8Array(n);
    stamp = new Uint16Array(n);
    frameId = 0;

    off.width = W;
    off.height = H;
    img = offCtx.createImageData(W, H);

    seedScene();
  }

  // Стартовая сцена: каменный пол и деревянный помост — картинка живая с первого кадра.
  function seedScene() {
    var x, y;
    for (x = 0; x < W; x++) setCell(x, H - 1, STONE);
    var mid = Math.floor(H * 0.55);
    for (x = Math.floor(W * 0.25); x < Math.floor(W * 0.55); x++) setCell(x, mid, WOOD);
    for (y = mid + 1; y < H - 1; y++) {
      setCell(Math.floor(W * 0.25), y, STONE);
      setCell(Math.floor(W * 0.55) - 1, y, STONE);
    }
  }

  function tryMove(x, y, nx, ny, swapWater) {
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) return false;
    var from = idx(x, y);
    var to = idx(nx, ny);
    var target = cellType[to];
    if (target !== EMPTY && !(swapWater && target === WATER)) return false;
    cellType[to] = cellType[from];
    life[to] = life[from];
    variant[to] = variant[from];
    stamp[to] = frameId;
    if (target === WATER) {
      // песок тонет: вода вытесняется наверх
      cellType[from] = WATER;
      life[from] = 0;
      variant[from] = (Math.random() * 256) | 0;
      stamp[from] = frameId;
    } else {
      cellType[from] = EMPTY;
      life[from] = 0;
    }
    return true;
  }

  function stepSand(x, y) {
    if (tryMove(x, y, x, y + 1, true)) return;
    var first = Math.random() < 0.5 ? -1 : 1;
    if (tryMove(x, y, x + first, y + 1, true)) return;
    tryMove(x, y, x - first, y + 1, true);
  }

  function stepWater(x, y) {
    if (tryMove(x, y, x, y + 1, false)) return;
    var first = Math.random() < 0.5 ? -1 : 1;
    if (tryMove(x, y, x + first, y + 1, false)) return;
    if (tryMove(x, y, x - first, y + 1, false)) return;
    if (tryMove(x, y, x + first, y, false)) return;
    tryMove(x, y, x - first, y, false);
  }

  function stepWood(x, y) {
    var i = idx(x, y);
    // дерево, охваченное огнём (life > 0), через время превращается в огонь
    if (life[i] > 0) {
      life[i]--;
      if (life[i] <= 0) {
        setCell(x, y, FIRE);
        stamp[idx(x, y)] = frameId;
      }
      return;
    }
    // поджиг от соседнего огня
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        if (cellType[idx(nx, ny)] === FIRE && Math.random() < 0.12) {
          life[i] = 30 + ((Math.random() * 60) | 0);
          return;
        }
      }
    }
  }

  function stepFire(x, y) {
    var i = idx(x, y);
    life[i]--;
    if (life[i] <= 0) {
      // гаснет дымом
      if (Math.random() < 0.7) setCell(x, y, SMOKE);
      else setCell(x, y, EMPTY);
      stamp[idx(x, y)] = frameId;
      return;
    }
    // поджигает соседнее дерево
    var dx, dy, nx, ny, ni;
    for (dy = -1; dy <= 1; dy++) {
      for (dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        nx = x + dx; ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        ni = idx(nx, ny);
        if (cellType[ni] === WOOD && life[ni] === 0 && Math.random() < 0.15) {
          life[ni] = 30 + ((Math.random() * 60) | 0);
        } else if (cellType[ni] === WATER && Math.random() < 0.2) {
          // вода тушит огонь — тоже дымом
          setCell(x, y, SMOKE);
          stamp[idx(x, y)] = frameId;
          return;
        }
      }
    }
    // пламя льнёт вверх, иногда порождая дым
    if (y > 0 && Math.random() < 0.35) {
      if (cellType[idx(x, y - 1)] === EMPTY) tryMove(x, y, x, y - 1, false);
    }
    if (y > 0 && Math.random() < 0.06 && cellType[idx(x, y - 1)] === EMPTY) {
      setCell(x, y - 1, SMOKE);
      stamp[idx(x, y - 1)] = frameId;
    }
  }

  function stepSmoke(x, y) {
    var i = idx(x, y);
    life[i]--;
    if (life[i] <= 0) {
      setCell(x, y, EMPTY);
      stamp[idx(x, y)] = frameId;
      return;
    }
    if (Math.random() < 0.25) return; // дым ленив
    var first = Math.random() < 0.5 ? -1 : 1;
    if (tryMove(x, y, x, y - 1, false)) return;
    if (tryMove(x, y, x + first, y - 1, false)) return;
    if (tryMove(x, y, x - first, y - 1, false)) return;
    if (tryMove(x, y, x + first, y, false)) return;
    tryMove(x, y, x - first, y, false);
  }

  function step() {
    frameId++;
    if (frameId >= 60000) { stamp.fill(0); frameId = 1; }
    var x, y, i, t;
    // направление обхода по строке случайно — без асимметрии влево/вправо
    var leftToRight = Math.random() < 0.5;
    for (y = H - 1; y >= 0; y--) {
      if (leftToRight) {
        for (x = 0; x < W; x++) stepCell(x, y);
      } else {
        for (x = W - 1; x >= 0; x--) stepCell(x, y);
      }
    }
  }

  function stepCell(x, y) {
    var i = idx(x, y);
    var t = cellType[i];
    if (t === EMPTY || t === STONE || stamp[i] === frameId) return;
    if (t === SAND) stepSand(x, y);
    else if (t === WATER) stepWater(x, y);
    else if (t === WOOD) stepWood(x, y);
    else if (t === FIRE) stepFire(x, y);
    else if (t === SMOKE) stepSmoke(x, y);
  }

  function render() {
    var data = img.data;
    var n = W * H;
    var k = 0;
    for (var i = 0; i < n; i++) {
      var t = cellType[i];
      var r, g, b, a = 255;
      if (t === EMPTY) {
        r = BG[0]; g = BG[1]; b = BG[2];
      } else {
        var pal = PALETTES[t];
        var c = pal[variant[i] % pal.length];
        r = c[0]; g = c[1]; b = c[2];
        if (t === FIRE) {
          var fl = 0.75 + 0.25 * Math.sin((frameId + variant[i]) * 0.6);
          r = Math.min(255, r * fl | 0);
          g = Math.min(255, g * fl | 0);
          b = Math.min(255, b * fl | 0);
        } else if (t === SMOKE) {
          // дым тает: смешиваем с фоном по оставшейся жизни
          var f = Math.min(1, life[i] / 200);
          r = BG[0] + (r - BG[0]) * f | 0;
          g = BG[1] + (g - BG[1]) * f | 0;
          b = BG[2] + (b - BG[2]) * f | 0;
        } else if (t === WOOD && life[i] > 0) {
          // тлеющее дерево светится
          r = Math.min(255, r + 90);
          g = Math.min(255, g + 30);
        }
      }
      data[k++] = r; data[k++] = g; data[k++] = b; data[k++] = a;
    }
    offCtx.putImageData(img, 0, 0);
    ctx.drawImage(off, 0, 0, W, H, 0, 0, cssW, cssH);
  }

  function paintAt(px, py) {
    var gx = Math.floor(px / cssW * W);
    var gy = Math.floor(py / cssH * H);
    var r = brushSize;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        var x = gx + dx, y = gy + dy;
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        // огонь и дым рисуются рыхло — так естественнее
        if ((brushMat === FIRE || brushMat === SMOKE) && Math.random() < 0.5) continue;
        if (brushMat === EMPTY) setCell(x, y, EMPTY);
        else setCell(x, y, brushMat);
      }
    }
  }

  // --- События ---

  canvas.addEventListener('pointerdown', function (e) {
    painting = true;
    canvas.setPointerCapture(e.pointerId);
    mouseX = e.clientX; mouseY = e.clientY;
    paintAt(mouseX, mouseY);
  });
  canvas.addEventListener('pointermove', function (e) {
    mouseX = e.clientX; mouseY = e.clientY;
    if (painting) paintAt(mouseX, mouseY);
  });
  canvas.addEventListener('pointerup', function () { painting = false; });
  canvas.addEventListener('pointercancel', function () { painting = false; });

  var matButtons = document.querySelectorAll('#materials button');
  function selectMat(m) {
    brushMat = m;
    for (var b = 0; b < matButtons.length; b++) {
      matButtons[b].classList.toggle('active', Number(matButtons[b].getAttribute('data-mat')) === m);
    }
  }
  for (var b = 0; b < matButtons.length; b++) {
    matButtons[b].addEventListener('click', function () {
      selectMat(Number(this.getAttribute('data-mat')));
    });
  }

  var sizeInput = document.getElementById('brushSize');
  var sizeValue = document.getElementById('brushValue');
  sizeInput.addEventListener('input', function () {
    brushSize = Number(sizeInput.value);
    sizeValue.textContent = sizeInput.value;
  });

  var pauseBtn = document.getElementById('pauseBtn');
  function togglePause() {
    paused = !paused;
    pauseBtn.textContent = paused ? 'Продолжить' : 'Пауза';
  }
  pauseBtn.addEventListener('click', togglePause);

  document.getElementById('clearBtn').addEventListener('click', function () {
    cellType.fill(EMPTY);
    life.fill(0);
  });

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    else if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') {
      cellType.fill(EMPTY); life.fill(0);
    } else if (e.key >= '0' && e.key <= '6') {
      selectMat(Number(e.key));
    }
  });

  window.addEventListener('resize', resize);

  // --- Цикл: фиксированный шаг симуляции, кламп dt ---

  var STEP_MS = 1000 / 60;
  var acc = 0;
  var last = performance.now();

  function loop(now) {
    var dt = now - last;
    last = now;
    if (dt > 100) dt = 100; // кламп большого dt
    acc += dt;
    var steps = 0;
    while (acc >= STEP_MS && steps < 3) {
      if (!paused) step();
      acc -= STEP_MS;
      steps++;
    }
    if (acc >= STEP_MS) acc = 0; // не копим долг при просадках
    render();
    requestAnimationFrame(loop);
  }

  resize();
  render(); // первый кадр сразу, до первого тика
  requestAnimationFrame(loop);
})();
