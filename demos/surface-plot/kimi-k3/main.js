(function () {
  'use strict';

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');

  // ---------- Размеры / DPR ----------
  var W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Сетка ----------
  var N = 72;                 // число ячеек по каждой оси
  var NP = N + 1;             // узлов по оси
  var R = 5;                  // полуразмер области: x,y ∈ [-R, R]
  var STEP = (2 * R) / N;     // шаг сетки
  var COUNT = NP * NP;
  var QUADS = N * N;

  // Координаты узлов (не меняются)
  var gx = new Float32Array(COUNT);
  var gy = new Float32Array(COUNT);
  for (var i = 0; i < NP; i++) {
    for (var j = 0; j < NP; j++) {
      var idx = i * NP + j;
      gx[idx] = -R + i * STEP;
      gy[idx] = -R + j * STEP;
    }
  }

  // Переиспользуемые буферы (без аллокаций в кадре)
  var hz = new Float32Array(COUNT);   // высоты
  var nX = new Float32Array(COUNT);   // нормали в узлах
  var nY = new Float32Array(COUNT);
  var nZ = new Float32Array(COUNT);
  var sX = new Float32Array(COUNT);   // экранные координаты
  var sY = new Float32Array(COUNT);
  var dep = new Float32Array(COUNT);  // глубина
  var quadDepth = new Float32Array(QUADS);
  var order = new Array(QUADS);
  for (var q = 0; q < QUADS; q++) order[q] = q;

  // ---------- Функции ----------
  var FUNCS = {
    ripple: {
      // Затухающая рябь: sin(r - t) / r
      f: function (x, y, t) {
        var r = Math.sqrt(x * x + y * y);
        return 3.0 * Math.sin(1.35 * r - 2.1 * t) / (0.8 + r);
      },
      zMin: -1.6, zMax: 1.6
    },
    saddle: {
      f: function (x, y) {
        return (x * x - y * y) * 0.12;
      },
      zMin: -3.0, zMax: 3.0
    },
    gauss: {
      f: function (x, y, t) {
        var r2 = x * x + y * y;
        return 3.0 * Math.exp(-r2 / 4.5) * (0.92 + 0.08 * Math.sin(t * 1.4));
      },
      zMin: 0.0, zMax: 3.0
    }
  };
  var current = FUNCS.ripple;

  // ---------- Цветовая карта по высоте ----------
  var STOPS = [
    [0.00, 32, 58, 138],   // глубокий синий
    [0.25, 38, 148, 205],  // бирюзовый
    [0.50, 62, 190, 120],  // зелёный
    [0.75, 240, 208, 88],  // жёлтый
    [1.00, 232, 72, 60]    // красный
  ];
  function colormap(t) {
    if (t <= 0) return STOPS[0];
    if (t >= 1) return STOPS[STOPS.length - 1];
    for (var k = 0; k < STOPS.length - 1; k++) {
      var a = STOPS[k], b = STOPS[k + 1];
      if (t >= a[0] && t <= b[0]) {
        var u = (t - a[0]) / (b[0] - a[0]);
        return [0, a[1] + (b[1] - a[1]) * u,
                   a[2] + (b[2] - a[2]) * u,
                   a[3] + (b[3] - a[3]) * u];
      }
    }
    return STOPS[STOPS.length - 1];
  }

  // ---------- Освещение (Ламберт) ----------
  var Lx = -0.42, Ly = -0.55, Lz = 0.72;
  var Llen = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz);
  Lx /= Llen; Ly /= Llen; Lz /= Llen;
  var AMBIENT = 0.35;

  // ---------- Камера ----------
  var ELEV = 0.92;                    // угол возвышения камеры, рад
  var cosE = Math.cos(ELEV), sinE = Math.sin(ELEV);
  var az = 0.6;                       // азимут, медленно вращается
  var ROT_SPEED = 0.22;               // рад/с

  // ---------- Состояние анимации ----------
  var time = 0;
  var showWire = true;

  function computeSurface() {
    var f = current.f;
    var i, j, idx;
    for (i = 0; i < NP; i++) {
      for (j = 0; j < NP; j++) {
        idx = i * NP + j;
        hz[idx] = f(gx[idx], gy[idx], time);
      }
    }
    // Нормали в узлах — центральные разности по сетке
    var inv2s = 1 / (2 * STEP);
    for (i = 0; i < NP; i++) {
      var i0 = i > 0 ? i - 1 : 0;
      var i1 = i < N ? i + 1 : N;
      for (j = 0; j < NP; j++) {
        var j0 = j > 0 ? j - 1 : 0;
        var j1 = j < N ? j + 1 : N;
        idx = i * NP + j;
        var dhdx = (hz[i1 * NP + j] - hz[i0 * NP + j]) * inv2s;
        var dhdy = (hz[i * NP + j1] - hz[i * NP + j0]) * inv2s;
        var nx = -dhdx, ny = -dhdy, nz = 1;
        var il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nX[idx] = nx * il;
        nY[idx] = ny * il;
        nZ[idx] = nz * il;
      }
    }
  }

  function project() {
    var cosA = Math.cos(az), sinA = Math.sin(az);
    var scale = Math.min(W, H) * 0.088 * DPR;
    var cx = W * DPR * 0.5;
    var cy = H * DPR * 0.52;
    for (var k = 0; k < COUNT; k++) {
      var x = gx[k], y = gy[k], z = hz[k];
      // вращение вокруг оси z
      var xr = x * cosA - y * sinA;
      var yr = x * sinA + y * cosA;
      // наклон камеры (ортографическая проекция)
      var vert = yr * cosE - z * sinE;
      dep[k] = yr * sinE + z * cosE;
      sX[k] = cx + xr * scale;
      sY[k] = cy - vert * scale;
    }
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0f1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    computeSurface();
    project();

    // Средняя глубина каждого квада — алгоритм художника
    for (var i = 0; i < N; i++) {
      for (var j = 0; j < N; j++) {
        var q = i * N + j;
        var a = i * NP + j, b = a + NP;
        quadDepth[q] = (dep[a] + dep[a + 1] + dep[b] + dep[b + 1]) * 0.25;
      }
    }
    order.sort(function (p, r) { return quadDepth[r] - quadDepth[p]; });

    var zSpan = current.zMax - current.zMin;

    for (var s = 0; s < QUADS; s++) {
      var qi = order[s];
      var qi0 = (qi / N) | 0, qj = qi - qi0 * N;
      var p00 = qi0 * NP + qj;
      var p10 = p00 + NP;
      var p01 = p00 + 1;
      var p11 = p10 + 1;

      // цвет по средней высоте квада
      var zAvg = (hz[p00] + hz[p10] + hz[p01] + hz[p11]) * 0.25;
      var tH = (zAvg - current.zMin) / zSpan;
      if (tH < 0) tH = 0; else if (tH > 1) tH = 1;
      var c = colormap(tH);

      // Ламберт по усреднённой нормали узлов
      var nx = (nX[p00] + nX[p10] + nX[p01] + nX[p11]) * 0.25;
      var ny = (nY[p00] + nY[p10] + nY[p01] + nY[p11]) * 0.25;
      var nz = (nZ[p00] + nZ[p10] + nZ[p01] + nZ[p11]) * 0.25;
      var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      var dot = (nx * Lx + ny * Ly + nz * Lz) / nl;
      var br = AMBIENT + (1 - AMBIENT) * (dot > 0 ? dot : 0);

      ctx.beginPath();
      ctx.moveTo(sX[p00], sY[p00]);
      ctx.lineTo(sX[p10], sY[p10]);
      ctx.lineTo(sX[p11], sY[p11]);
      ctx.lineTo(sX[p01], sY[p01]);
      ctx.closePath();

      var rr = (c[1] * br) | 0;
      var gg = (c[2] * br) | 0;
      var bb = (c[3] * br) | 0;
      ctx.fillStyle = 'rgb(' + rr + ',' + gg + ',' + bb + ')';
      ctx.fill();

      if (showWire) {
        ctx.strokeStyle = 'rgba(10, 14, 24, 0.35)';
        ctx.lineWidth = DPR * 0.6;
        ctx.stroke();
      } else {
        // лёгкая обводка в цвет заливки, чтобы скрыть швы между полигонами
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = DPR * 0.5;
        ctx.stroke();
      }
    }
  }

  // ---------- Цикл ----------
  var last = performance.now();
  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;   // кламп большого dt
    if (dt > 0) {
      time += dt;
      az += dt * ROT_SPEED;
    }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- Управление ----------
  var buttons = document.querySelectorAll('.funcs button');
  for (var bi = 0; bi < buttons.length; bi++) {
    buttons[bi].addEventListener('click', function () {
      var name = this.getAttribute('data-fn');
      if (!FUNCS[name]) return;
      current = FUNCS[name];
      for (var k = 0; k < buttons.length; k++) {
        buttons[k].classList.toggle('active', buttons[k] === this);
      }
    });
  }
  var wireBox = document.getElementById('wire');
  showWire = wireBox.checked;
  wireBox.addEventListener('change', function () {
    showWire = wireBox.checked;
  });
})();
