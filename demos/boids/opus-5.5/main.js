/* Стая boids — Claude Opus 5.5
   Правила Рейнольдса (разделение / выравнивание / сцепление) на торе.
   Соседи ищутся через равномерную сетку с ячейкой = радиус восприятия,
   расстояния — по кратчайшему пути на торе. Отрисовка — Canvas 2D. */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var SEP_FRAC = 0.5;        // зона разделения — доля радиуса восприятия
  var STEER_K = 1.6;         // предел управляющей силы = K * макс. скорость (1/с)
  var MIN_SPEED_FRAC = 0.4;  // птица не может зависнуть в воздухе
  var CRUISE_FRAC = 1.0;     // крейсерская скорость — доля максимальной
  var CRUISE_RATE = 8;       // как быстро птица возвращается к крейсерской (1/с)
  var NOISE = 0.3;           // лёгкий шум, чтобы стая «дышала»

  /* ================= Симуляция (без DOM) ================= */

  function createFlock(W, H, max) {
    var F = {
      max: max, n: 0, W: W, H: H,
      px: new Float32Array(max), py: new Float32Array(max),
      vx: new Float32Array(max), vy: new Float32Array(max),
      ax: new Float32Array(max), ay: new Float32Array(max),
      phase: new Float32Array(max),
      params: { sep: 1.6, ali: 1.0, coh: 0.9, radius: 58, speed: 200 },
      rand: Math.random
    };

    var nextIdx = new Int32Array(max);
    var head = new Int32Array(256);
    var cols = 1, rows = 1, cellW = W, cellH = H;
    var gridStale = true;
    var colL = new Int32Array(3), rowL = new Int32Array(3);
    var SX = 0, SY = 0;

    function spawn(i) {
      var r = F.rand;
      F.px[i] = r() * F.W;
      F.py[i] = r() * F.H;
      var a = r() * TAU, s = F.params.speed * (0.6 + 0.4 * r());
      F.vx[i] = Math.cos(a) * s;
      F.vy[i] = Math.sin(a) * s;
      F.ax[i] = 0; F.ay[i] = 0;
      F.phase[i] = r() * TAU;
    }

    F.setCount = function (n) {
      n = Math.max(0, Math.min(max, n | 0));
      for (var i = F.n; i < n; i++) spawn(i);
      F.n = n;
      gridStale = true;
    };

    F.scatter = function () {
      for (var i = 0; i < F.n; i++) spawn(i);
      gridStale = true;
    };

    F.resize = function (w, h) {
      var kx = w / F.W, ky = h / F.H;
      for (var i = 0; i < F.n; i++) {
        F.px[i] *= kx; F.py[i] *= ky;
        if (F.px[i] >= w) F.px[i] = 0;
        if (F.py[i] >= h) F.py[i] = 0;
      }
      F.W = w; F.H = h;
      gridStale = true;
    };

    F.invalidate = function () { gridStale = true; };

    function buildGrid() {
      var r = Math.max(4, F.params.radius);
      cols = Math.max(1, Math.floor(F.W / r));
      rows = Math.max(1, Math.floor(F.H / r));
      cellW = F.W / cols;
      cellH = F.H / rows;
      var nc = cols * rows;
      if (head.length < nc) head = new Int32Array(nc);
      for (var c = 0; c < nc; c++) head[c] = -1;
      var px = F.px, py = F.py;
      for (var i = 0; i < F.n; i++) {
        var cx = (px[i] / cellW) | 0, cy = (py[i] / cellH) | 0;
        if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
        if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
        var k = cy * cols + cx;
        nextIdx[i] = head[k];
        head[k] = i;
      }
      gridStale = false;
    }

    // «Желаемая скорость минус текущая», ограниченная maxF (steering по Рейнольдсу)
    function steer(tx, ty, vxi, vyi, maxS, maxF) {
      var m = Math.sqrt(tx * tx + ty * ty);
      if (m < 1e-9) { SX = 0; SY = 0; return; }
      var dx = tx / m * maxS - vxi, dy = ty / m * maxS - vyi;
      var l = Math.sqrt(dx * dx + dy * dy);
      if (l > maxF) { var k = maxF / l; dx *= k; dy *= k; }
      SX = dx; SY = dy;
    }

    // Силы трёх правил для агента i. rec (необязателен) — подробный разбор для линзы.
    function rules(i, rec) {
      var P = F.params, px = F.px, py = F.py, vx = F.vx, vy = F.vy;
      var r = P.radius, r2 = r * r, sr = r * SEP_FRAC, sr2 = sr * sr;
      var maxS = P.speed, maxF = maxS * STEER_K;
      var W = F.W, H = F.H, hW = W * 0.5, hH = H * 0.5;
      var xi = px[i], yi = py[i], vxi = vx[i], vyi = vy[i];

      var ci = (xi / cellW) | 0, ri = (yi / cellH) | 0;
      if (ci < 0) ci = 0; else if (ci >= cols) ci = cols - 1;
      if (ri < 0) ri = 0; else if (ri >= rows) ri = rows - 1;

      var nC, nR, k;
      if (cols >= 3) {
        colL[0] = ci === 0 ? cols - 1 : ci - 1; colL[1] = ci; colL[2] = ci === cols - 1 ? 0 : ci + 1; nC = 3;
      } else { for (k = 0; k < cols; k++) colL[k] = k; nC = cols; }
      if (rows >= 3) {
        rowL[0] = ri === 0 ? rows - 1 : ri - 1; rowL[1] = ri; rowL[2] = ri === rows - 1 ? 0 : ri + 1; nR = 3;
      } else { for (k = 0; k < rows; k++) rowL[k] = k; nR = rows; }

      var cnt = 0, avx = 0, avy = 0, cmx = 0, cmy = 0, sx = 0, sy = 0, sc = 0, m = 0;
      for (var a = 0; a < nR; a++) {
        var base = rowL[a] * cols;
        for (var b = 0; b < nC; b++) {
          var j = head[base + colL[b]];
          while (j !== -1) {
            if (j !== i) {
              var dx = px[j] - xi, dy = py[j] - yi;
              if (dx > hW) dx -= W; else if (dx < -hW) dx += W;
              if (dy > hH) dy -= H; else if (dy < -hH) dy += H;
              var d2 = dx * dx + dy * dy;
              if (d2 < r2) {
                cnt++;
                avx += vx[j]; avy += vy[j];
                cmx += dx; cmy += dy;
                var close = d2 < sr2;
                if (close && d2 > 1e-6) { sx -= dx / d2; sy -= dy / d2; sc++; }
                if (rec) { rec.idx[m] = j; rec.dx[m] = dx; rec.dy[m] = dy; rec.close[m] = close ? 1 : 0; m++; }
              }
            }
            j = nextIdx[j];
          }
        }
      }

      var sepX = 0, sepY = 0, aliX = 0, aliY = 0, cohX = 0, cohY = 0;
      if (sc > 0) {
        steer(sx, sy, vxi, vyi, maxS, maxF); sepX = SX * P.sep; sepY = SY * P.sep;
      }
      if (cnt > 0) {
        steer(avx, avy, vxi, vyi, maxS, maxF); aliX = SX * P.ali; aliY = SY * P.ali;
        steer(cmx, cmy, vxi, vyi, maxS, maxF); cohX = SX * P.coh; cohY = SY * P.coh;
      }
      F.ax[i] = sepX + aliX + cohX;
      F.ay[i] = sepY + aliY + cohY;

      if (rec) {
        rec.count = m; rec.n = cnt; rec.maxF = maxF;
        rec.sepX = sepX; rec.sepY = sepY;
        rec.aliX = aliX; rec.aliY = aliY;
        rec.cohX = cohX; rec.cohY = cohY;
        rec.comX = cnt ? cmx / cnt : 0; rec.comY = cnt ? cmy / cnt : 0;
      }
      return cnt;
    }

    F.step = function (dt) {
      if (gridStale) buildGrid();
      var n = F.n, P = F.params;
      var maxS = P.speed, maxF = maxS * STEER_K, minS = maxS * MIN_SPEED_FRAC;
      var i;
      for (i = 0; i < n; i++) rules(i, null);

      var px = F.px, py = F.py, vx = F.vx, vy = F.vy, ph = F.phase;
      var rnd = F.rand, W = F.W, H = F.H, nz = maxF * NOISE, cruise = maxS * CRUISE_FRAC;
      for (i = 0; i < n; i++) {
        var ax = F.ax[i] + (rnd() - 0.5) * nz;
        var ay = F.ay[i] + (rnd() - 0.5) * nz;
        // три правила частично гасят друг друга по модулю; птица же стремится держать ход
        var s0 = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        if (s0 > 1e-6) {
          var ca = (cruise - s0) * CRUISE_RATE / s0;
          ax += vx[i] * ca; ay += vy[i] * ca;
        }
        var vxi = vx[i] + ax * dt, vyi = vy[i] + ay * dt;
        var s = Math.sqrt(vxi * vxi + vyi * vyi);
        if (s > maxS) { vxi *= maxS / s; vyi *= maxS / s; s = maxS; }
        else if (s < minS) {
          if (s < 1e-6) { var an = rnd() * TAU; vxi = Math.cos(an) * minS; vyi = Math.sin(an) * minS; }
          else { vxi *= minS / s; vyi *= minS / s; }
          s = minS;
        }
        vx[i] = vxi; vy[i] = vyi;
        var x = px[i] + vxi * dt, y = py[i] + vyi * dt;
        if (x < 0) x += W; else if (x >= W) x -= W;
        if (y < 0) y += H; else if (y >= H) y -= H;
        px[i] = x; py[i] = y;
        // взмахи крыльев: чаще на скорости, у каждой птицы свой темп
        ph[i] = (ph[i] + dt * (9 + 7 * s / maxS + (i % 7) * 0.4)) % TAU;
      }
      buildGrid();
    };

    F.analyze = function (i, rec) {
      if (gridStale) buildGrid();
      return rules(i, rec);
    };

    F.makeRecord = function () {
      return {
        idx: new Int32Array(max), dx: new Float32Array(max), dy: new Float32Array(max),
        close: new Uint8Array(max), count: 0, n: 0, maxF: 1,
        sepX: 0, sepY: 0, aliX: 0, aliY: 0, cohX: 0, cohY: 0, comX: 0, comY: 0
      };
    };

    return F;
  }

  /* ================= Браузер ================= */

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function boot() {
    var canvas = document.getElementById('sky');
    var ctx = canvas.getContext('2d', { alpha: false });
    var sky = document.createElement('canvas');
    var MAX = 2000;

    var COL = { sep: '#ff8b7b', ali: '#5fe3d0', coh: '#b8a4ff', net: '#ffffff', focus: '#ffd27a' };
    // три «слоя глубины»: дальние мельче и светлее, ближние крупнее и темнее
    var LAYER_SCALE = [0.8, 0.96, 1.14];
    var LAYER_FILL = ['rgba(36,32,70,0.66)', 'rgba(26,23,54,0.84)', 'rgba(14,12,32,0.95)'];

    var W = 0, H = 0, dpr = 1, birdSize = 4;
    var F = createFlock(800, 600, MAX);
    var rec = F.makeRecord(), probe = F.makeRecord();
    var focus = 0, userPicked = false, autoPicked = false, paused = false, lensA = 0, simTime = 0;

    var TRAIL = 72, trailX = new Float32Array(TRAIL), trailY = new Float32Array(TRAIL);
    var trailN = 0, trailHead = 0, trailAcc = 0;

    var offX = new Float32Array(4), offY = new Float32Array(4), offN = 0;

    /* ---------- фон ---------- */

    function noiseTile() {
      var t = document.createElement('canvas');
      t.width = t.height = 128;
      var c = t.getContext('2d'), img = c.createImageData(128, 128), d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var v = (Math.random() * 255) | 0;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      return t;
    }

    function streak(c, x, y, w, h, rgb, a) {
      c.save();
      c.translate(x, y);
      c.scale(w, h);
      var g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
      g.addColorStop(0.55, 'rgba(' + rgb + ',' + (a * 0.45) + ')');
      g.addColorStop(1, 'rgba(' + rgb + ',0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.fill();
      c.restore();
    }

    function paintSky() {
      sky.width = canvas.width;
      sky.height = canvas.height;
      var c = sky.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);

      var g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#4b5b92');
      g.addColorStop(0.3, '#7380b4');
      g.addColorStop(0.58, '#b89cba');
      g.addColorStop(0.8, '#e8ae93');
      g.addColorStop(1, '#f7d1a0');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);

      // заходящее солнце за нижним краем
      var sx = W * 0.76, sy = H * 1.03, sr = Math.max(W, H) * 0.78;
      var sg = c.createRadialGradient(sx, sy, 0, sx, sy, sr);
      sg.addColorStop(0, 'rgba(255,246,220,0.95)');
      sg.addColorStop(0.07, 'rgba(255,228,178,0.72)');
      sg.addColorStop(0.28, 'rgba(255,192,150,0.28)');
      sg.addColorStop(1, 'rgba(255,170,150,0)');
      c.fillStyle = sg;
      c.fillRect(0, 0, W, H);

      // перистые облака: светлые у горизонта, сизые вверху
      var rnd = mulberry32(20260927), k;
      for (k = 0; k < 12; k++) {
        streak(c, W * rnd(), H * (0.5 + 0.42 * rnd()), W * (0.16 + 0.3 * rnd()), H * (0.01 + 0.025 * rnd()),
          '255,236,218', 0.12 + 0.16 * rnd());
      }
      for (k = 0; k < 6; k++) {
        streak(c, W * rnd(), H * (0.08 + 0.36 * rnd()), W * (0.2 + 0.3 * rnd()), H * (0.012 + 0.02 * rnd()),
          '58,60,112', 0.08 + 0.08 * rnd());
      }

      // виньетка
      var vg = c.createRadialGradient(W * 0.5, H * 0.55, Math.min(W, H) * 0.25, W * 0.5, H * 0.55, Math.hypot(W, H) * 0.62);
      vg.addColorStop(0, 'rgba(26,22,60,0)');
      vg.addColorStop(1, 'rgba(26,22,60,0.28)');
      c.fillStyle = vg;
      c.fillRect(0, 0, W, H);

      // плёночное зерно в физических пикселях
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 0.045;
      c.fillStyle = c.createPattern(noiseTile(), 'repeat');
      c.fillRect(0, 0, sky.width, sky.height);
      c.globalAlpha = 1;
    }

    function resize() {
      var w = Math.max(1, canvas.clientWidth || window.innerWidth || 800);
      var h = Math.max(1, canvas.clientHeight || window.innerHeight || 600);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (W && H) F.resize(w, h); else { F.W = w; F.H = h; F.invalidate(); }
      W = w; H = h;
      birdSize = Math.max(3.4, Math.min(4.8, Math.sqrt(w * h) / 300));
      paintSky();
    }

    /* ---------- птицы ---------- */

    // силуэт «сверху»: голова вперёд, крылья отведены назад; w — раскрытие крыльев
    function bird(x, y, ux, uy, s, w) {
      var nx = -uy, ny = ux;
      var bx = x - ux * s * 0.75, by = y - uy * s * 0.75;
      var ww = s * 1.4 * w;
      ctx.moveTo(x + ux * s * 1.25, y + uy * s * 1.25);
      ctx.lineTo(bx + nx * ww, by + ny * ww);
      ctx.lineTo(x - ux * s * 0.15, y - uy * s * 0.15);
      ctx.lineTo(bx - nx * ww, by - ny * ww);
      ctx.closePath();
    }

    // то же, плюс «призрак» у противоположного края — переход через край без рывка
    function birdW(x, y, vx, vy, ph, s) {
      var sp = Math.sqrt(vx * vx + vy * vy) || 1;
      var ux = vx / sp, uy = vy / sp;
      var w = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(ph));
      bird(x, y, ux, uy, s, w);
      var m = s * 1.8;
      var gx = x < m ? W : (x > W - m ? -W : 0);
      var gy = y < m ? H : (y > H - m ? -H : 0);
      if (gx !== 0) bird(x + gx, y, ux, uy, s, w);
      if (gy !== 0) bird(x, y + gy, ux, uy, s, w);
      if (gx !== 0 && gy !== 0) bird(x + gx, y + gy, ux, uy, s, w);
    }

    // копии линзы, если радиус восприятия пересекает край тора
    function copies(x, y, m) {
      var gx = x < m ? W : (x > W - m ? -W : 0);
      var gy = y < m ? H : (y > H - m ? -H : 0);
      offN = 0;
      offX[offN] = 0; offY[offN] = 0; offN++;
      if (gx !== 0) { offX[offN] = gx; offY[offN] = 0; offN++; }
      if (gy !== 0) { offX[offN] = 0; offY[offN] = gy; offN++; }
      if (gx !== 0 && gy !== 0) { offX[offN] = gx; offY[offN] = gy; offN++; }
    }

    /* ---------- линза выделенного агента ---------- */

    function lensDisc(cx, cy, r, e) {
      var rr = r * (0.88 + 0.12 * e);
      var g = ctx.createRadialGradient(cx, cy, rr * 0.1, cx, cy, rr);
      g.addColorStop(0, 'rgba(18,16,48,0.14)');
      g.addColorStop(0.75, 'rgba(18,16,48,0.27)');
      g.addColorStop(1, 'rgba(18,16,48,0.42)');
      ctx.globalAlpha = e;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill();
      ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke();
      ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.stroke();
      // внутренняя зона разделения
      ctx.beginPath(); ctx.arc(cx, cy, rr * SEP_FRAC, 0, TAU);
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,150,135,0.75)'; ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    function links(cx, cy, e) {
      var k;
      ctx.lineWidth = 1;
      ctx.globalAlpha = e * 0.5;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      for (k = 0; k < rec.count; k++) {
        if (rec.close[k]) continue;
        ctx.moveTo(cx, cy); ctx.lineTo(cx + rec.dx[k], cy + rec.dy[k]);
      }
      ctx.stroke();
      ctx.globalAlpha = e * 0.9;
      ctx.strokeStyle = COL.sep;
      ctx.beginPath();
      for (k = 0; k < rec.count; k++) {
        if (!rec.close[k]) continue;
        ctx.moveTo(cx, cy); ctx.lineTo(cx + rec.dx[k], cy + rec.dy[k]);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function arrow(x, y, fx, fy, color, r, maxF, w) {
      var m = Math.sqrt(fx * fx + fy * fy);
      if (m < maxF * 0.03) return;
      var len = r * 0.9 * (1 - Math.exp(-0.65 * m / maxF));
      if (len < 6) return;
      var ux = fx / m, uy = fy / m;
      var ex = x + ux * len, ey = y + uy * len;
      var hl = 4 + w * 1.6, hw = 2.2 + w;
      var s0 = Math.min(len * 0.4, birdSize * 1.2);
      ctx.lineCap = 'round';
      // тёмная подложка для читаемости на светлом небе
      ctx.strokeStyle = 'rgba(14,12,36,0.35)';
      ctx.lineWidth = w + 2.2;
      ctx.beginPath(); ctx.moveTo(x + ux * s0, y + uy * s0); ctx.lineTo(ex - ux * hl * 0.8, ey - uy * hl * 0.8); ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ux * hl - uy * hw, ey - uy * hl + ux * hw);
      ctx.lineTo(ex - ux * hl + uy * hw, ey - uy * hl - ux * hw);
      ctx.closePath();
      ctx.fill();
    }

    function forces(cx, cy, e) {
      var r = F.params.radius, mF = rec.maxF;
      ctx.globalAlpha = e;
      if (rec.n > 0) {
        // центр масс соседей — цель сцепления
        var mx = cx + rec.comX, my = cy + rec.comY;
        ctx.lineWidth = 1.4; ctx.strokeStyle = COL.coh;
        ctx.beginPath(); ctx.arc(mx, my, 4, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mx - 7, my); ctx.lineTo(mx - 3, my); ctx.moveTo(mx + 3, my); ctx.lineTo(mx + 7, my);
        ctx.moveTo(mx, my - 7); ctx.lineTo(mx, my - 3); ctx.moveTo(mx, my + 3); ctx.lineTo(mx, my + 7); ctx.stroke();
      }
      arrow(cx, cy, rec.cohX, rec.cohY, COL.coh, r, mF, 1.8);
      arrow(cx, cy, rec.aliX, rec.aliY, COL.ali, r, mF, 1.8);
      arrow(cx, cy, rec.sepX, rec.sepY, COL.sep, r, mF, 1.8);
      arrow(cx, cy, rec.sepX + rec.aliX + rec.cohX, rec.sepY + rec.aliY + rec.cohY, COL.net, r, mF, 2.6);
      ctx.globalAlpha = 1;
    }

    function pushTrail() {
      trailX[trailHead] = F.px[focus];
      trailY[trailHead] = F.py[focus];
      trailHead = (trailHead + 1) % TRAIL;
      if (trailN < TRAIL) trailN++;
    }

    function drawTrail(e) {
      if (trailN < 2) return;
      var start = (trailHead - trailN + TRAIL) % TRAIL;
      var x0 = trailX[start], y0 = trailY[start];
      ctx.lineCap = 'round';
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,232,178,1)';
      for (var k = 1; k < trailN; k++) {
        var id = (start + k) % TRAIL, x = trailX[id], y = trailY[id];
        if (Math.abs(x - x0) < W * 0.5 && Math.abs(y - y0) < H * 0.5) {
          ctx.globalAlpha = e * 0.8 * (k / trailN) * (k / trailN);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
        }
        x0 = x; y0 = y;
      }
      ctx.globalAlpha = 1;
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function label(fx, fy, r, cnt, e) {
      var txt = 'видит ' + cnt + ' · r ' + Math.round(r);
      ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textBaseline = 'middle';
      var tw = ctx.measureText(txt).width, bw = tw + 14, bh = 19;
      var d = r * 0.7071;
      var sx = fx + d + 10 + bw > W - 6 ? -1 : 1;
      var sy = fy - d - 10 - bh < 6 ? 1 : -1;
      var ax = fx + sx * d, ay = fy + sy * d;
      var bx = sx > 0 ? ax + 9 : ax - 9 - bw;
      var by = ay + sy * 9 - bh / 2;
      ctx.globalAlpha = e;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(sx > 0 ? bx : bx + bw, by + bh / 2); ctx.stroke();
      roundRect(bx, by, bw, bh, 9.5);
      ctx.fillStyle = 'rgba(20,18,50,0.66)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, bx + 7, by + bh / 2 + 0.5);
      ctx.globalAlpha = 1;
    }

    function drawFocus(dt) {
      if (focus >= F.n) focus = 0;
      var cnt = F.analyze(focus, rec);
      lensA = Math.min(1, lensA + dt * 3);
      var e = 1 - Math.pow(1 - lensA, 3);
      var r = F.params.radius, fx = F.px[focus], fy = F.py[focus];
      var o, k;
      copies(fx, fy, r + 14);

      for (o = 0; o < offN; o++) lensDisc(fx + offX[o], fy + offY[o], r, e);
      drawTrail(e);
      for (o = 0; o < offN; o++) links(fx + offX[o], fy + offY[o], e);

      // соседи — светлые силуэты на их настоящих местах
      var px = F.px, py = F.py, vx = F.vx, vy = F.vy, ph = F.phase;
      ctx.globalAlpha = e;
      ctx.beginPath();
      for (k = 0; k < rec.count; k++) {
        var j = rec.idx[k];
        birdW(px[j], py[j], vx[j], vy[j], ph[j], birdSize * LAYER_SCALE[j % 3] * 1.08);
      }
      ctx.fillStyle = '#fffaf1';
      ctx.fill();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = 'rgba(24,20,56,0.55)';
      ctx.stroke();
      ctx.globalAlpha = 1;

      for (o = 0; o < offN; o++) forces(fx + offX[o], fy + offY[o], e);

      // сам выделенный агент
      var sp = Math.sqrt(vx[focus] * vx[focus] + vy[focus] * vy[focus]) || 1;
      var ux = vx[focus] / sp, uy = vy[focus] / sp;
      var w = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(ph[focus]));
      ctx.save();
      ctx.shadowColor = 'rgba(255,205,110,0.95)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      for (o = 0; o < offN; o++) bird(fx + offX[o], fy + offY[o], ux, uy, birdSize * 1.9, w);
      ctx.fillStyle = COL.focus;
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      label(fx, fy, r, cnt, e);
      return cnt;
    }

    /* ---------- кадр ---------- */

    function render(dt) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(sky, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var n = F.n, px = F.px, py = F.py, vx = F.vx, vy = F.vy, ph = F.phase;
      for (var L = 0; L < 3; L++) {
        var s = birdSize * LAYER_SCALE[L];
        ctx.beginPath();
        for (var i = L; i < n; i += 3) {
          if (i === focus) continue;
          birdW(px[i], py[i], vx[i], vy[i], ph[i], s);
        }
        ctx.fillStyle = LAYER_FILL[L];
        ctx.fill();
      }
      return drawFocus(dt);
    }

    function setFocus(i, byUser) {
      if (i < 0 || i >= F.n) return;
      focus = i;
      trailN = 0; trailHead = 0;
      lensA = 0;
      if (byUser) userPicked = true;
    }

    // случайная птица, у которой есть соседи и которая не прячется под панелью
    function pickFocus() {
      var best = -1, bestCnt = -1;
      for (var t = 0; t < 60; t++) {
        var j = (Math.random() * F.n) | 0;
        if (j === focus && F.n > 1) continue;
        var y = F.py[j], x = F.px[j];
        var r = F.params.radius;
        if (y < 140 || y > H - 200 || x < r || x > W - r) continue;
        var c = F.analyze(j, probe);
        if (c >= 4 && c <= 40) return j;
        if (c > bestCnt) { bestCnt = c; best = j; }
      }
      return best >= 0 ? best : (Math.random() * F.n) | 0;
    }

    /* ---------- UI ---------- */

    var elN = document.getElementById('s-n');
    var elFps = document.getElementById('s-fps');
    var elMs = document.getElementById('s-ms');
    var elNb = document.getElementById('s-nb');
    var btnPause = document.getElementById('b-pause');

    function fmt1(v) { return v.toFixed(1).replace('.', ','); }

    function bind(id, apply, fmt) {
      var inp = document.getElementById(id);
      var out = inp.parentNode.querySelector('output');
      var lo = parseFloat(inp.min), hi = parseFloat(inp.max);
      function upd() {
        var v = parseFloat(inp.value);
        apply(v);
        out.textContent = fmt(v);
        inp.style.setProperty('--p', ((v - lo) / (hi - lo) * 100).toFixed(2) + '%');
      }
      inp.addEventListener('input', upd);
      upd();
    }

    function togglePause() {
      paused = !paused;
      btnPause.textContent = paused ? 'Продолжить' : 'Пауза';
      btnPause.classList.toggle('on', paused);
    }

    resize();

    // стартовое число агентов — по площади экрана, но не меньше 400
    var cntInput = document.getElementById('c-cnt');
    cntInput.value = String(Math.max(400, Math.min(900, Math.round(W * H / 2600 / 50) * 50)));

    bind('c-sep', function (v) { F.params.sep = v; }, fmt1);
    bind('c-ali', function (v) { F.params.ali = v; }, fmt1);
    bind('c-coh', function (v) { F.params.coh = v; }, fmt1);
    bind('c-rad', function (v) { F.params.radius = v; F.invalidate(); }, function (v) { return v + ' px'; });
    bind('c-spd', function (v) { F.params.speed = v; }, function (v) { return v + ' px/с'; });
    bind('c-cnt', function (v) {
      F.setCount(v);
      if (focus >= F.n) setFocus(pickFocus(), false);
    }, function (v) { return String(v); });

    setFocus(pickFocus(), false);

    btnPause.addEventListener('click', togglePause);
    document.getElementById('b-next').addEventListener('click', function () { setFocus(pickFocus(), true); });
    document.getElementById('b-scatter').addEventListener('click', function () {
      F.scatter();
      trailN = 0; trailHead = 0;
      simTime = 0; autoPicked = userPicked;
    });

    canvas.addEventListener('pointerdown', function (e) {
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left, y = e.clientY - rect.top;
      var best = -1, bd = Infinity;
      for (var i = 0; i < F.n; i++) {
        var dx = F.px[i] - x, dy = F.py[i] - y;
        if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
        if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
        var d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) setFocus(best, true);
    });

    window.addEventListener('keydown', function (e) {
      var tag = e.target && e.target.tagName;
      if (e.code === 'Space' && tag !== 'BUTTON') { e.preventDefault(); togglePause(); }
      else if (e.code === 'KeyN') setFocus(pickFocus(), true);
    });

    window.addEventListener('resize', resize);

    var last = -1, fpsAvg = 60, stepAvg = 0, statT = 1, lastCnt = 0;

    function frame(now) {
      if (last < 0) last = now;
      var raw = (now - last) / 1000;
      last = now;
      if (!(raw > 0)) raw = 0;
      var dt = Math.min(raw, 1 / 30);   // кламп: после вкладки в фоне стая не «телепортируется»
      if (raw > 0) fpsAvg += (1 / Math.max(raw, 1e-3) - fpsAvg) * 0.05;

      if (!paused && dt > 0) {
        var t0 = performance.now();
        F.step(dt);
        stepAvg += (performance.now() - t0 - stepAvg) * 0.1;
        simTime += dt;
        trailAcc += dt;
        if (trailAcc >= 1 / 60) { trailAcc %= 1 / 60; pushTrail(); }
        // пока стая собирается, выберем птицу поинтереснее (если пользователь ещё не выбрал сам)
        if (!autoPicked && simTime > 2.2) {
          autoPicked = true;
          if (!userPicked && lastCnt < 4) setFocus(pickFocus(), false);
        }
      }

      lastCnt = render(dt);

      statT += raw;
      if (statT > 0.25) {
        statT = 0;
        elN.textContent = F.n;
        elFps.textContent = Math.round(fpsAvg);
        elMs.textContent = fmt1(stepAvg);
        elNb.textContent = lastCnt;
      }
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createFlock: createFlock };
  } else if (typeof document !== 'undefined') {
    boot();
  }
})();
