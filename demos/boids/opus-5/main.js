/* Стая boids — Claude Opus 5
   Canvas 2D, тороидальный мир, равномерная сетка соседства. */
(function () {
  'use strict';

  var trailCv = document.getElementById('trails');
  var overCv = document.getElementById('overlay');
  if (!trailCv || !overCv || !trailCv.getContext || !overCv.getContext) return;

  var tctx = trailCv.getContext('2d');
  var octx = overCv.getContext('2d');
  if (!tctx || !octx) return;

  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------------ */
  /*  параметры                                                          */
  /* ------------------------------------------------------------------ */

  var P = { sep: 1.8, ali: 1.3, coh: 1.0, radius: 80, speed: 170, count: 600 };
  var paused = false;
  var trailsOn = true;
  var time = 0;

  /* ------------------------------------------------------------------ */
  /*  размеры холста                                                     */
  /* ------------------------------------------------------------------ */

  var W = 1, H = 1, halfW = 0.5, halfH = 0.5, dpr = 1;

  function resize() {
    var w = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1));
    var h = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1));
    var d = Math.min(2, window.devicePixelRatio || 1);
    if (w === W && h === H && d === dpr && trailCv.width > 0) return;

    var oldW = W, oldH = H, had = N > 0 && oldW > 1 && oldH > 1;
    W = w; H = h; halfW = w / 2; halfH = h / 2; dpr = d;

    var pw = Math.max(1, Math.round(w * d));
    var ph = Math.max(1, Math.round(h * d));
    trailCv.width = pw; trailCv.height = ph;
    overCv.width = pw; overCv.height = ph;
    tctx.setTransform(d, 0, 0, d, 0, 0);
    octx.setTransform(d, 0, 0, d, 0, 0);
    tctx.lineJoin = 'round';
    octx.lineJoin = 'round';

    if (had) {
      var kx = W / oldW, ky = H / oldH;
      for (var i = 0; i < N; i++) {
        px[i] = wrap(px[i] * kx, W);
        py[i] = wrap(py[i] * ky, H);
      }
    }
    gCols = 0; gRows = 0; /* пересобрать сетку */
  }

  function wrap(v, m) {
    if (!(v === v)) return Math.random() * m;      /* защита от NaN */
    v = v - Math.floor(v / m) * m;
    return v >= m ? 0 : (v < 0 ? 0 : v);
  }

  /* ------------------------------------------------------------------ */
  /*  агенты                                                             */
  /* ------------------------------------------------------------------ */

  var N = 0;
  var px = new Float32Array(0), py = new Float32Array(0);
  var vx = new Float32Array(0), vy = new Float32Array(0);
  var ux = new Float32Array(0), uy = new Float32Array(0);
  var spd = new Float32Array(0);
  var bkt = new Uint8Array(0), flag = new Uint8Array(0);
  var cellOf = new Int32Array(0), order = new Int32Array(0);
  var nbrDX = new Float32Array(0), nbrDY = new Float32Array(0), nbrD = new Float32Array(0);
  var nbrCount = 0;
  var focus = 0;

  function seed(i) {
    px[i] = Math.random() * W;
    py[i] = Math.random() * H;
    var a = Math.random() * TAU;
    var s = P.speed * (0.55 + Math.random() * 0.4);
    vx[i] = Math.cos(a) * s;
    vy[i] = Math.sin(a) * s;
  }

  function setCount(n) {
    n = Math.max(1, Math.min(2000, Math.round(n)));
    if (n === N) return;
    var opx = px, opy = py, ovx = vx, ovy = vy, keep = Math.min(N, n), i;

    px = new Float32Array(n); py = new Float32Array(n);
    vx = new Float32Array(n); vy = new Float32Array(n);
    ux = new Float32Array(n); uy = new Float32Array(n); spd = new Float32Array(n);
    bkt = new Uint8Array(n); flag = new Uint8Array(n);
    cellOf = new Int32Array(n); order = new Int32Array(n);
    nbrDX = new Float32Array(n); nbrDY = new Float32Array(n); nbrD = new Float32Array(n);

    for (i = 0; i < keep; i++) { px[i] = opx[i]; py[i] = opy[i]; vx[i] = ovx[i]; vy[i] = ovy[i]; }
    N = n;
    for (i = keep; i < n; i++) seed(i);
    if (focus >= N) focus = N - 1;
    if (focus < 0) focus = 0;
    nbrCount = 0;
  }

  function shuffle() { for (var i = 0; i < N; i++) seed(i); }

  /* ------------------------------------------------------------------ */
  /*  равномерная сетка с тороидальным обходом                           */
  /* ------------------------------------------------------------------ */

  var gCols = 0, gRows = 0, cw = 1, ch = 1;
  var counts = null, starts = null, cursor = null;
  var colOff = [0], rowOff = [0];

  function ensureGrid() {
    var r = Math.max(4, P.radius);
    var cols = Math.max(1, Math.floor(W / r));
    var rows = Math.max(1, Math.floor(H / r));
    while (cols * rows > 16384) {
      if (cols >= rows) cols = Math.max(1, cols >> 1); else rows = Math.max(1, rows >> 1);
    }
    if (cols !== gCols || rows !== gRows) {
      gCols = cols; gRows = rows;
      counts = new Int32Array(cols * rows);
      starts = new Int32Array(cols * rows + 1);
      cursor = new Int32Array(cols * rows);
      /* при 1-2 колонках/строках 3x3-обход дал бы дубли — берём каждую ровно раз */
      colOff = cols >= 3 ? [-1, 0, 1] : (cols === 2 ? [0, 1] : [0]);
      rowOff = rows >= 3 ? [-1, 0, 1] : (rows === 2 ? [0, 1] : [0]);
    }
    cw = W / gCols; ch = H / gRows;
  }

  function buildGrid() {
    if (!counts || N === 0) return;
    counts.fill(0);
    var i, gx, gy, c;
    for (i = 0; i < N; i++) {
      gx = (px[i] / cw) | 0; if (gx < 0) gx = 0; else if (gx >= gCols) gx = gCols - 1;
      gy = (py[i] / ch) | 0; if (gy < 0) gy = 0; else if (gy >= gRows) gy = gRows - 1;
      c = gy * gCols + gx;
      cellOf[i] = c; counts[c]++;
    }
    var acc = 0, n = counts.length;
    for (c = 0; c < n; c++) { starts[c] = acc; cursor[c] = acc; acc += counts[c]; }
    starts[n] = acc;
    for (i = 0; i < N; i++) order[cursor[cellOf[i]]++] = i;
  }

  /* ------------------------------------------------------------------ */
  /*  физика                                                             */
  /* ------------------------------------------------------------------ */

  var _sx = 0, _sy = 0;

  /* рулевое усилие Рейнольдса: желаемая скорость по направлению (dx,dy) минус текущая */
  function steer(dx, dy, cvx, cvy, ms, mf) {
    var m = Math.sqrt(dx * dx + dy * dy);
    if (m < 1e-9) { _sx = 0; _sy = 0; return; }
    var k = ms / m;
    var sx = dx * k - cvx, sy = dy * k - cvy;
    var sm = Math.sqrt(sx * sx + sy * sy);
    if (sm > mf) { k = mf / sm; sx *= k; sy *= k; }
    _sx = sx; _sy = sy;
  }

  /* зона разделения заметно уже зоны восприятия — иначе стая не собирается в косяки */
  function sepRadius() { return Math.max(8, P.radius * 0.28); }

  function simulate(dt) {
    if (!starts || N === 0) return;
    var r = P.radius, r2 = r * r;
    var sr = sepRadius(), sr2 = sr * sr;
    var ms = P.speed, minS = ms * 0.65;
    var mf = ms * 3.2;              /* предел усилия одного правила */
    var accMax = mf * 2.2;          /* предел суммарного ускорения */
    var i, oy, ox, k, e, j, c, ry, rx, rowBase;

    for (i = 0; i < N; i++) {
      var xi = px[i], yi = py[i], vxi = vx[i], vyi = vy[i];
      var gx = cellOf[i] % gCols, gy = (cellOf[i] / gCols) | 0;
      var sX = 0, sY = 0, aX = 0, aY = 0, cX = 0, cY = 0, cnt = 0;

      for (oy = 0; oy < rowOff.length; oy++) {
        ry = gy + rowOff[oy];
        if (ry < 0) ry += gRows; else if (ry >= gRows) ry -= gRows;
        rowBase = ry * gCols;
        for (ox = 0; ox < colOff.length; ox++) {
          rx = gx + colOff[ox];
          if (rx < 0) rx += gCols; else if (rx >= gCols) rx -= gCols;
          c = rowBase + rx;
          for (k = starts[c], e = starts[c + 1]; k < e; k++) {
            j = order[k];
            if (j === i) continue;
            /* кратчайшее расстояние через края тора */
            var dx = px[j] - xi; if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
            var dy = py[j] - yi; if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
            var d2 = dx * dx + dy * dy;
            if (d2 > r2 || d2 < 1e-9) continue;
            cnt++;
            aX += vx[j]; aY += vy[j];          /* выравнивание */
            cX += dx; cY += dy;                /* сцепление: смещение к центру масс */
            if (d2 < sr2) {                    /* разделение: отталкивание ~1/d */
              var inv = 1 / d2;
              sX -= dx * inv; sY -= dy * inv;
            }
          }
        }
      }

      var axx = 0, ayy = 0;
      if (cnt > 0) {
        steer(aX, aY, vxi, vyi, ms, mf); axx += _sx * P.ali; ayy += _sy * P.ali;
        steer(cX, cY, vxi, vyi, ms, mf); axx += _sx * P.coh; ayy += _sy * P.coh;
      }
      if (sX !== 0 || sY !== 0) {
        steer(sX, sY, vxi, vyi, ms, mf); axx += _sx * P.sep; ayy += _sy * P.sep;
      }
      var am = Math.sqrt(axx * axx + ayy * ayy);
      if (am > accMax) { var qa = accMax / am; axx *= qa; ayy *= qa; }

      var nvx = vxi + axx * dt, nvy = vyi + ayy * dt;
      var sp = Math.sqrt(nvx * nvx + nvy * nvy);
      if (sp > ms) { var q1 = ms / sp; nvx *= q1; nvy *= q1; }
      else if (sp < minS) {
        if (sp < 1e-6) { var a0 = Math.random() * TAU; nvx = Math.cos(a0) * minS; nvy = Math.sin(a0) * minS; }
        else { var q2 = minS / sp; nvx *= q2; nvy *= q2; }
      }
      vx[i] = nvx; vy[i] = nvy;

      var nx = xi + nvx * dt, ny = yi + nvy * dt;
      px[i] = nx - Math.floor(nx / W) * W;
      py[i] = ny - Math.floor(ny / H) * H;
    }
  }

  /* соседи наблюдаемого агента — ровно те же, что видит физика */
  function collectFocus() {
    nbrCount = 0;
    if (N > 0) flag.fill(0);
    if (!starts || N === 0 || focus < 0 || focus >= N) return;
    var r = P.radius, r2 = r * r;
    var xi = px[focus], yi = py[focus];
    var gx = cellOf[focus] % gCols, gy = (cellOf[focus] / gCols) | 0;
    var oy, ox, ry, rx, c, k, e, j;

    for (oy = 0; oy < rowOff.length; oy++) {
      ry = gy + rowOff[oy];
      if (ry < 0) ry += gRows; else if (ry >= gRows) ry -= gRows;
      for (ox = 0; ox < colOff.length; ox++) {
        rx = gx + colOff[ox];
        if (rx < 0) rx += gCols; else if (rx >= gCols) rx -= gCols;
        c = ry * gCols + rx;
        for (k = starts[c], e = starts[c + 1]; k < e; k++) {
          j = order[k];
          if (j === focus) continue;
          var dx = px[j] - xi; if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
          var dy = py[j] - yi; if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
          var d2 = dx * dx + dy * dy;
          if (d2 > r2 || d2 < 1e-9) continue;
          nbrDX[nbrCount] = dx; nbrDY[nbrCount] = dy; nbrD[nbrCount] = Math.sqrt(d2);
          nbrCount++;
          flag[j] = 1;
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  отрисовка                                                          */
  /* ------------------------------------------------------------------ */

  var PAL = [];
  (function () {
    var c0 = [104, 142, 218], c1 = [176, 242, 255], n = 12;
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1), s = t * t * (3 - 2 * t);
      PAL.push('rgb(' + Math.round(c0[0] + (c1[0] - c0[0]) * s) + ',' +
        Math.round(c0[1] + (c1[1] - c0[1]) * s) + ',' +
        Math.round(c0[2] + (c1[2] - c0[2]) * s) + ')');
    }
  })();

  var loSm = 0, hiSm = 1, palInit = false;

  function tri(ctx, x, y, dx, dy, s) {
    var tx = x + dx * s * 1.9, ty = y + dy * s * 1.9;
    var bx = x - dx * s * 0.9, by = y - dy * s * 0.9;
    var nx = -dy * s * 0.72, ny = dx * s * 0.72;
    ctx.moveTo(tx, ty);
    ctx.lineTo(bx + nx, by + ny);
    ctx.lineTo(bx - nx, by - ny);
    ctx.closePath();
  }

  /* тот же треугольник + его двойники у противоположных краёв тора */
  function triW(ctx, x, y, dx, dy, s) {
    tri(ctx, x, y, dx, dy, s);
    var m = s * 2.2;
    var ox = x < m ? W : (x > W - m ? -W : 0);
    var oy = y < m ? H : (y > H - m ? -H : 0);
    if (ox) tri(ctx, x + ox, y, dx, dy, s);
    if (oy) tri(ctx, x, y + oy, dx, dy, s);
    if (ox && oy) tri(ctx, x + ox, y + oy, dx, dy, s);
  }

  function render(dt) {
    if (trailsOn) {
      /* гасим альфу — следы тают, фон-градиент страницы остаётся виден */
      var a = 1 - Math.exp(-dt / 0.28);
      tctx.globalCompositeOperation = 'destination-out';
      tctx.fillStyle = 'rgba(0,0,0,' + a.toFixed(4) + ')';
      tctx.fillRect(0, 0, W, H);
      tctx.globalCompositeOperation = 'source-over';
    } else {
      tctx.clearRect(0, 0, W, H);
    }

    /* направления + скорости; шкала цвета подстраивается под текущий разброс */
    var i, sp, fmin = Infinity, fmax = -Infinity;
    for (i = 0; i < N; i++) {
      var sxv = vx[i], syv = vy[i];
      sp = Math.sqrt(sxv * sxv + syv * syv);
      spd[i] = sp;
      if (sp < 1e-6) { ux[i] = 1; uy[i] = 0; continue; }
      ux[i] = sxv / sp; uy[i] = syv / sp;
      if (sp < fmin) fmin = sp;
      if (sp > fmax) fmax = sp;
    }
    if (fmin === Infinity) { fmin = 0; fmax = 1; }
    if (!palInit) { loSm = fmin; hiSm = fmax; palInit = true; }
    else { loSm += (fmin - loSm) * 0.12; hiSm += (fmax - hiSm) * 0.12; }
    var span = Math.max(1e-3, hiSm - loSm);
    for (i = 0; i < N; i++) {
      var b = ((spd[i] - loSm) / span * 11) | 0;
      bkt[i] = b < 0 ? 0 : (b > 11 ? 11 : b);
    }

    var s = 3.0, q;
    for (var bi = 0; bi < 12; bi++) {
      var any = false;
      tctx.beginPath();
      for (q = 0; q < N; q++) {
        if (bkt[q] !== bi || flag[q] || q === focus) continue;
        triW(tctx, px[q], py[q], ux[q], uy[q], s);
        any = true;
      }
      if (any) { tctx.fillStyle = PAL[bi]; tctx.fill(); }
    }

    /* соседи наблюдаемого — тёплым */
    if (nbrCount > 0) {
      tctx.beginPath();
      for (q = 0; q < N; q++) {
        if (!flag[q] || q === focus) continue;
        triW(tctx, px[q], py[q], ux[q], uy[q], s * 1.05);
      }
      tctx.fillStyle = '#ffa863';
      tctx.fill();
    }

    /* сам наблюдаемый — на слое следов, чтобы у него был свой шлейф */
    if (focus >= 0 && focus < N) {
      tctx.beginPath();
      triW(tctx, px[focus], py[focus], ux[focus], uy[focus], s * 1.25);
      tctx.fillStyle = '#ffcf7a';
      tctx.fill();
    }

    drawOverlay();
  }

  function drawOverlay() {
    octx.clearRect(0, 0, W, H);
    if (focus < 0 || focus >= N) return;
    var fx = px[focus], fy = py[focus], pad = P.radius + 34;
    for (var oi = -1; oi <= 1; oi++) {
      var X = fx + oi * W;
      if (X + pad < 0 || X - pad > W) continue;
      for (var oj = -1; oj <= 1; oj++) {
        var Y = fy + oj * H;
        if (Y + pad < 0 || Y - pad > H) continue;
        octx.save();
        octx.translate(oi * W, oj * H);
        focusLayer(fx, fy);
        octx.restore();
      }
    }
  }

  var HUB = 8.5;      /* связи начинаются не в центре — иначе «ёж» */
  var RING = 4.6;     /* радиус кольца вокруг соседа */

  /* отрезок связи, обрезанный у центра и у кольца соседа; коротышей не рисуем */
  function link(fx, fy, dx, dy, d) {
    var trim = RING + 1.5;
    if (d <= HUB + trim + 3.5) return;
    var ix = dx / d, iy = dy / d;
    octx.moveTo(fx + ix * HUB, fy + iy * HUB);
    octx.lineTo(fx + dx - ix * trim, fy + dy - iy * trim);
  }

  function focusLayer(fx, fy) {
    var r = P.radius, sr = sepRadius(), k;

    /* заливка зон: восприятие — холодно-тёплая подложка, разделение — плотнее */
    octx.beginPath();
    octx.arc(fx, fy, r, 0, TAU);
    octx.fillStyle = 'rgba(255,190,110,0.05)';
    octx.fill();

    octx.beginPath();
    octx.arc(fx, fy, sr, 0, TAU);
    octx.fillStyle = 'rgba(255,116,84,0.13)';
    octx.fill();

    /* связи: тем прозрачнее, чем гуще соседство; обрезаны с обоих концов */
    var base = nbrCount > 0 ? 7 / nbrCount : 0.2;
    if (base < 0.045) base = 0.045; else if (base > 0.24) base = 0.24;

    octx.lineWidth = 0.7;
    octx.beginPath();
    for (k = 0; k < nbrCount; k++) {
      if (nbrD[k] < sr) continue;
      link(fx, fy, nbrDX[k], nbrDY[k], nbrD[k]);
    }
    octx.strokeStyle = 'rgba(255,214,158,' + base.toFixed(3) + ')';
    octx.stroke();

    octx.lineWidth = 0.9;
    octx.beginPath();
    for (k = 0; k < nbrCount; k++) {
      if (nbrD[k] >= sr) continue;
      link(fx, fy, nbrDX[k], nbrDY[k], nbrD[k]);
    }
    octx.strokeStyle = 'rgba(255,140,100,' + Math.min(0.5, base * 2.1).toFixed(3) + ')';
    octx.stroke();

    /* кольца вокруг видимых соседей */
    octx.beginPath();
    for (k = 0; k < nbrCount; k++) {
      var nx = fx + nbrDX[k], ny = fy + nbrDY[k];
      octx.moveTo(nx + RING, ny);
      octx.arc(nx, ny, RING, 0, TAU);
    }
    var ra = nbrCount > 0 ? 28 / nbrCount : 0.9;   /* густое соседство — кольца легче */
    if (ra < 0.3) ra = 0.3; else if (ra > 0.9) ra = 0.9;
    octx.lineWidth = 2.2;
    octx.strokeStyle = 'rgba(8,12,24,' + (ra * 0.6).toFixed(3) + ')';   /* тёмная подложка — кольца читаются поверх связей */
    octx.stroke();
    octx.lineWidth = 1.1;
    octx.strokeStyle = 'rgba(255,206,140,' + ra.toFixed(3) + ')';
    octx.stroke();

    /* границы зон — поверх связей, с тёмной подложкой */
    octx.setLineDash([]);
    octx.beginPath();
    octx.arc(fx, fy, sr, 0, TAU);
    octx.lineWidth = 3;
    octx.strokeStyle = 'rgba(8,12,24,0.5)';
    octx.stroke();
    octx.lineWidth = 1.4;
    octx.strokeStyle = 'rgba(255,132,96,0.95)';
    octx.stroke();

    octx.beginPath();
    octx.arc(fx, fy, r, 0, TAU);
    octx.lineWidth = 3;
    octx.strokeStyle = 'rgba(8,12,24,0.45)';
    octx.stroke();
    octx.setLineDash([7, 7]);
    octx.lineDashOffset = -(time * 26) % 14;
    octx.lineWidth = 1.3;
    octx.strokeStyle = 'rgba(255,201,126,0.85)';
    octx.stroke();
    octx.setLineDash([]);

    /* наблюдаемый агент */
    var pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
    octx.beginPath();
    octx.arc(fx, fy, 9 + pulse * 5, 0, TAU);
    octx.fillStyle = 'rgba(255,200,120,' + (0.17 - 0.1 * pulse).toFixed(3) + ')';
    octx.fill();

    octx.beginPath();
    octx.moveTo(fx, fy);
    octx.lineTo(fx + ux[focus] * 28, fy + uy[focus] * 28);
    octx.lineWidth = 1.2;
    octx.strokeStyle = 'rgba(255,236,190,0.65)';
    octx.stroke();

    octx.beginPath();
    tri(octx, fx, fy, ux[focus], uy[focus], 5.0);
    octx.fillStyle = '#ffd489';
    octx.fill();
    octx.lineWidth = 1.1;
    octx.strokeStyle = 'rgba(8,12,24,0.9)';
    octx.stroke();
  }

  /* ------------------------------------------------------------------ */
  /*  интерфейс                                                          */
  /* ------------------------------------------------------------------ */

  function bind(id, key, fmt, after) {
    var el = document.getElementById(id);
    var out = document.getElementById(id + 'V');
    if (!el) return;
    var apply = function () {
      var v = parseFloat(el.value);
      if (!isFinite(v)) return;
      P[key] = v;
      if (out) out.textContent = fmt(v);
      if (after) after(v);
    };
    el.addEventListener('input', apply);
    el.addEventListener('change', apply);
    apply();
  }

  var f2 = function (v) { return v.toFixed(2); };
  var fi = function (v) { return String(Math.round(v)); };

  var btnPause = document.getElementById('btnPause');
  var btnShuffle = document.getElementById('btnShuffle');
  var btnTrails = document.getElementById('btnTrails');
  var btnFocus = document.getElementById('btnFocus');

  function setPaused(v) {
    paused = !!v;
    if (btnPause) {
      btnPause.textContent = paused ? 'Продолжить' : 'Пауза';
      btnPause.classList.toggle('on', paused);
      btnPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
    }
  }
  function setTrails(v) {
    trailsOn = !!v;
    if (btnTrails) {
      btnTrails.classList.toggle('on', trailsOn);
      btnTrails.setAttribute('aria-pressed', trailsOn ? 'true' : 'false');
    }
    if (!trailsOn) tctx.clearRect(0, 0, W, H);
  }
  function pickRandomFocus() { if (N > 0) focus = (Math.random() * N) | 0; }

  if (btnPause) btnPause.addEventListener('click', function () { setPaused(!paused); });
  if (btnShuffle) btnShuffle.addEventListener('click', function () { shuffle(); });
  if (btnTrails) btnTrails.addEventListener('click', function () { setTrails(!trailsOn); });
  if (btnFocus) btnFocus.addEventListener('click', function () { pickRandomFocus(); });

  overCv.addEventListener('pointerdown', function (ev) {
    if (N === 0) return;
    var rect = overCv.getBoundingClientRect();
    var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    var best = -1, bd = Infinity;
    for (var i = 0; i < N; i++) {
      var dx = px[i] - mx; if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
      var dy = py[i] - my; if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
      var d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
    if (best >= 0) focus = best;
  });

  window.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
    else if (e.code === 'KeyR') shuffle();
    else if (e.code === 'KeyT') setTrails(!trailsOn);
    else if (e.code === 'KeyF') pickRandomFocus();
  });

  window.addEventListener('resize', resize);

  /* ------------------------------------------------------------------ */
  /*  запуск                                                             */
  /* ------------------------------------------------------------------ */

  var stAgents = document.getElementById('stAgents');
  var stFps = document.getElementById('stFps');
  var stNb = document.getElementById('stNeighbors');
  var fps = 60, statTick = 0;

  function updateStats() {
    if (stAgents) stAgents.textContent = String(N);
    if (stFps) stFps.textContent = String(Math.round(fps));
    if (stNb) stNb.textContent = String(nbrCount);
  }

  resize();

  bind('sep', 'sep', f2);
  bind('ali', 'ali', f2);
  bind('coh', 'coh', f2);
  /* неразрывный пробел: единицы не должны уезжать на вторую строку и ломать сетку панели */
  bind('rad', 'radius', function (v) { return Math.round(v) + ' px'; });
  bind('spd', 'speed', function (v) { return Math.round(v) + ' px/с'; });
  bind('cnt', 'count', fi, function (v) { setCount(v); });

  if (N === 0) setCount(P.count);
  pickRandomFocus();
  setTrails(true);
  setPaused(false);

  var last = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!last) last = ts;
    var dt = (ts - last) / 1000;
    last = ts;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.05) dt = 0.05;          /* кламп большого dt (вкладка была скрыта) */
    fps += (1 / dt - fps) * 0.08;
    time += dt;

    ensureGrid();
    buildGrid();
    if (!paused) { simulate(dt); buildGrid(); }
    collectFocus();
    render(dt);

    if (++statTick >= 6) { statTick = 0; updateStats(); }
  }
  updateStats();
  requestAnimationFrame(frame);
})();
