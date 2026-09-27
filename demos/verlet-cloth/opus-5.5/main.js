/* Ткань (верлет) — Claude Opus 5.5
 *
 * Физика: трёхмерные частицы на верлет-интегрировании, позиционные связи
 * (структурные — рвутся при перерастяжении; диагональные и изгибные — мягкие,
 * гибнут вместе с ячейкой). Ветер давит на ткань по нормали, поэтому складки
 * ловят порывы по-разному. Отрисовка — Canvas 2D: перспективная проекция,
 * сортировка ячеек по глубине, освещение по нормалям (бархат + светлая подкладка).
 */
(function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // =====================================================================
  //  Физика ткани (мировые единицы — метры, ось Y вниз, Z — от зрителя)
  // =====================================================================
  function Cloth(opt) {
    opt = opt || {};
    this.cols = opt.cols || 46;
    this.rows = opt.rows || 34;
    this.width = opt.width || 2.0;          // ширина полотна, м
    this.gather = opt.gather || 0.9;        // сборка по карнизу: <1 даёт складки
    this.pinCount = opt.pinCount || 7;      // точек крепления на верхнем крае
    this.iterations = opt.iterations || 8;  // проходов по связям за шаг
    this.tear = opt.tear || 1.9;            // связь рвётся при удлинении в tear раз
    this.wind = opt.wind != null ? opt.wind : 0.35;
    this.windMax = 4.5;                     // м/с при 100 %
    this.windCoef = 3.2;                    // 1/с: отклик ткани на ветер по нормали
    this.gravity = 9.81;
    this.damping = 0.997;
    this.shearK = 0.3;
    this.bendK = 0.08;
    this.floorY = Infinity;
    this.windSpeed = 0;
    this.windDirX = 0;
    this._build();
  }

  Cloth.prototype._build = function () {
    var C = this.cols, R = this.rows, N = C * R, i, j, k, e, o;
    var s = this.spacing = this.width / (C - 1);
    this.height = s * (R - 1);
    this.n = N;
    this.time = 0;
    this.broken = 0;
    this.grabList = null;
    var pos = this.pos = new Float64Array(N * 3);
    var prev = this.prev = new Float64Array(N * 3);
    var im = this.invMass = new Float64Array(N);
    this.pinned = new Uint8Array(N);
    this.grabbed = new Uint8Array(N);
    this.anchor = new Float64Array(N * 3);
    this.normal = new Float64Array(N * 3);
    this.windV = new Float64Array(N * 3);

    // точки крепления — равномерно по верхнему краю, включая углы
    var P = Math.max(2, this.pinCount), pinCols = [];
    for (k = 0; k < P; k++) pinCols.push(Math.round(k * (C - 1) / (P - 1)));
    this.pinCols = pinCols;

    // стартовая форма: полотно собрано по карнизу в мягкие складки-«гармошку»
    var g = this.gather, pleat = new Float64Array(C);
    for (k = 0; k < P - 1; k++) {
      var c0 = pinCols[k], c1 = pinCols[k + 1], span = c1 - c0;
      if (span <= 0) continue;
      var lh = span * s * g;
      var amp = (lh / Math.PI) * 2 * Math.sqrt(Math.max(0, 1 / g - 1));
      var sg = (k % 2 === 0) ? -1 : 1;
      for (i = c0; i <= c1; i++) pleat[i] = sg * amp * Math.sin(Math.PI * (i - c0) / span);
    }
    var rnd = mulberry32(20260927);
    for (j = 0; j < R; j++) {
      for (i = 0; i < C; i++) {
        o = (j * C + i) * 3;
        var x = (i * s - this.width / 2) * g;
        var y = j * s;
        var z = pleat[i] + (j > 0 ? (rnd() - 0.5) * 0.002 : 0);
        pos[o] = prev[o] = x;
        pos[o + 1] = prev[o + 1] = y;
        pos[o + 2] = prev[o + 2] = z;
        im[j * C + i] = 1;
      }
    }
    for (k = 0; k < P; k++) {
      var pid = pinCols[k];
      o = pid * 3;
      this.pinned[pid] = 1;
      im[pid] = 0;
      this.anchor[o] = pos[o]; this.anchor[o + 1] = pos[o + 1]; this.anchor[o + 2] = pos[o + 2];
    }

    // структурные связи: горизонтальные, затем вертикальные
    var HC = (C - 1) * R, VC = C * (R - 1), L = HC + VC;
    this.hCount = HC;
    this.linkCount = L;
    var la = this.la = new Int32Array(L), lb = this.lb = new Int32Array(L);
    var lq1 = this.lq1 = new Int32Array(L), lq2 = this.lq2 = new Int32Array(L);
    this.lalive = new Uint8Array(L).fill(1);
    var Qc = C - 1, Q = (C - 1) * (R - 1);
    this.quadCount = Q;
    this.qalive = new Uint8Array(Q).fill(1);
    for (j = 0; j < R; j++) {
      for (i = 0; i < C - 1; i++) {
        e = j * Qc + i;
        la[e] = j * C + i; lb[e] = j * C + i + 1;
        lq1[e] = j > 0 ? (j - 1) * Qc + i : -1;
        lq2[e] = j < R - 1 ? j * Qc + i : -1;
      }
    }
    for (j = 0; j < R - 1; j++) {
      for (i = 0; i < C; i++) {
        e = HC + j * C + i;
        la[e] = j * C + i; lb[e] = (j + 1) * C + i;
        lq1[e] = i > 0 ? j * Qc + i - 1 : -1;
        lq2[e] = i < C - 1 ? j * Qc + i : -1;
      }
    }

    // изгибные связи через узел; живут, пока целы обе структурные под ними
    var BH = (C - 2) * R, BV = C * (R - 2), B = BH + BV;
    this.bendCount = B;
    var ba = this.ba = new Int32Array(B), bb = this.bb = new Int32Array(B);
    var be1 = this.be1 = new Int32Array(B), be2 = this.be2 = new Int32Array(B);
    for (j = 0; j < R; j++) {
      for (i = 0; i < C - 2; i++) {
        e = j * (C - 2) + i;
        ba[e] = j * C + i; bb[e] = j * C + i + 2;
        be1[e] = j * Qc + i; be2[e] = j * Qc + i + 1;
      }
    }
    for (j = 0; j < R - 2; j++) {
      for (i = 0; i < C; i++) {
        e = BH + j * C + i;
        ba[e] = j * C + i; bb[e] = (j + 2) * C + i;
        be1[e] = HC + j * C + i; be2[e] = HC + (j + 1) * C + i;
      }
    }
  };

  // одна позиционная связь с жёсткостью stiff
  Cloth.prototype._pair = function (a, b, rest, stiff) {
    var im = this.invMass, wa = im[a], wb = im[b], ws = wa + wb;
    if (ws === 0) return;
    var pos = this.pos, ao = a * 3, bo = b * 3;
    var dx = pos[bo] - pos[ao], dy = pos[bo + 1] - pos[ao + 1], dz = pos[bo + 2] - pos[ao + 2];
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-9) return;
    var k = stiff * (d - rest) / (d * ws);
    var ka = k * wa, kb = k * wb;
    pos[ao] += dx * ka; pos[ao + 1] += dy * ka; pos[ao + 2] += dz * ka;
    pos[bo] -= dx * kb; pos[bo + 1] -= dy * kb; pos[bo + 2] -= dz * kb;
  };

  Cloth.prototype.breakLink = function (e) {
    if (!this.lalive[e]) return false;
    this.lalive[e] = 0;
    this.broken++;
    var q1 = this.lq1[e], q2 = this.lq2[e];
    if (q1 >= 0) this.qalive[q1] = 0;
    if (q2 >= 0) this.qalive[q2] = 0;
    return true;
  };

  // нормали в узлах — по живым ячейкам (раз в кадр)
  Cloth.prototype.updateNormals = function () {
    var pos = this.pos, nrm = this.normal, qa = this.qalive, C = this.cols, Qc = C - 1;
    var Q = this.quadCount, N = this.n, q, o;
    nrm.fill(0);
    for (q = 0; q < Q; q++) {
      if (!qa[q]) continue;
      var a = ((q / Qc) | 0) * C + (q % Qc), b = a + 1, c = a + C, d = c + 1;
      var ao = a * 3, bo = b * 3, co = c * 3, dO = d * 3;
      var d1x = pos[dO] - pos[ao], d1y = pos[dO + 1] - pos[ao + 1], d1z = pos[dO + 2] - pos[ao + 2];
      var d2x = pos[co] - pos[bo], d2y = pos[co + 1] - pos[bo + 1], d2z = pos[co + 2] - pos[bo + 2];
      var nx = d2y * d1z - d2z * d1y, ny = d2z * d1x - d2x * d1z, nz = d2x * d1y - d2y * d1x;
      nrm[ao] += nx; nrm[ao + 1] += ny; nrm[ao + 2] += nz;
      nrm[bo] += nx; nrm[bo + 1] += ny; nrm[bo + 2] += nz;
      nrm[co] += nx; nrm[co + 1] += ny; nrm[co + 2] += nz;
      nrm[dO] += nx; nrm[dO + 1] += ny; nrm[dO + 2] += nz;
    }
    for (o = 0; o < N * 3; o += 3) {
      var l = Math.sqrt(nrm[o] * nrm[o] + nrm[o + 1] * nrm[o + 1] + nrm[o + 2] * nrm[o + 2]);
      if (l > 1e-12) { nrm[o] /= l; nrm[o + 1] /= l; nrm[o + 2] /= l; }
    }
  };

  // лёгкий переменный ветер: медленно гуляет направление, идут порывы и волны
  Cloth.prototype.updateWind = function () {
    var t = this.time, pos = this.pos, wv = this.windV, N = this.n;
    var base = this.wind * this.windMax;
    var gust = 0.62 + 0.22 * Math.sin(t * 0.71) + 0.14 * Math.sin(t * 1.93 + 1.1) + 0.08 * Math.sin(t * 4.3 + 0.3);
    if (gust < 0.1) gust = 0.1;
    var th = 0.75 * Math.sin(t * 0.19 + 0.5) + 0.3 * Math.sin(t * 0.47 + 2.1);
    var dx = Math.sin(th), dz = -Math.cos(th);
    var sp = base * gust;
    this.windSpeed = sp;
    this.windDirX = dx;
    for (var i = 0, o = 0; i < N; i++, o += 3) {
      var x = pos[o], y = pos[o + 1];
      var v = 1 + 0.35 * Math.sin(x * 2.7 - t * 2.3 + y * 1.3) + 0.22 * Math.sin(y * 3.9 + t * 1.7 - x * 0.9);
      var w = sp * v;
      wv[o] = w * dx; wv[o + 1] = -0.04 * w; wv[o + 2] = w * dz;
    }
  };

  // захват лоскута вокруг частицы center (кинематически ведётся за курсором)
  Cloth.prototype.grab = function (center, radiusFactor) {
    this.release();
    var C = this.cols, R = this.rows, pos = this.pos, s = this.spacing;
    var ci = center % C, cj = (center / C) | 0, co = center * 3;
    var r2 = (s * radiusFactor) * (s * radiusFactor);
    var list = [], off = [];
    for (var dj = -2; dj <= 2; dj++) {
      for (var di = -2; di <= 2; di++) {
        var i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= C || j >= R) continue;
        var id = j * C + i;
        if (this.pinned[id]) continue;
        var o = id * 3;
        var dx = pos[o] - pos[co], dy = pos[o + 1] - pos[co + 1], dz = pos[o + 2] - pos[co + 2];
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        list.push(id); off.push(dx, dy, dz);
        this.grabbed[id] = 1;
        this.invMass[id] = 0;
      }
    }
    if (!list.length) return false;
    this.grabList = list;
    this.grabOff = off;
    this.gFrom = [pos[co], pos[co + 1], pos[co + 2]];
    this.gTo = this.gFrom.slice();
    return true;
  };

  Cloth.prototype.setGrabTarget = function (x, y, z) {
    if (!this.grabList) return;
    this.gTo[0] = x; this.gTo[1] = y; this.gTo[2] = z;
  };

  Cloth.prototype.syncGrab = function () {
    if (!this.grabList) return;
    this.gFrom[0] = this.gTo[0]; this.gFrom[1] = this.gTo[1]; this.gFrom[2] = this.gTo[2];
  };

  Cloth.prototype.release = function () {
    var gl = this.grabList;
    if (!gl) return;
    var pos = this.pos, prev = this.prev, maxD = this.spacing * 1.2;
    for (var k = 0; k < gl.length; k++) {
      var id = gl[k], o = id * 3;
      this.grabbed[id] = 0;
      this.invMass[id] = this.pinned[id] ? 0 : 1;
      // бросок: сохраняем скорость лоскута, но с потолком
      var vx = pos[o] - prev[o], vy = pos[o + 1] - prev[o + 1], vz = pos[o + 2] - prev[o + 2];
      var v = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (v > maxD) {
        var f = maxD / v;
        prev[o] = pos[o] - vx * f; prev[o + 1] = pos[o + 1] - vy * f; prev[o + 2] = pos[o + 2] - vz * f;
      }
    }
    this.grabList = null;
  };

  Cloth.prototype.unpin = function (id) {
    if (!this.pinned[id]) return false;
    this.pinned[id] = 0;
    this.invMass[id] = this.grabbed[id] ? 0 : 1;
    return true;
  };

  // один шаг симуляции длиной h; alpha — доля кадра для плавного ведения захвата
  Cloth.prototype.step = function (h, alpha) {
    var pos = this.pos, prev = this.prev, im = this.invMass, N = this.n;
    var i, o, k, e;
    this.time += h;

    // 1. лоскут в руке — кинематический
    var gl = this.grabList;
    if (gl) {
      var gf = this.gFrom, gt = this.gTo, off = this.grabOff;
      var tx = gf[0] + (gt[0] - gf[0]) * alpha;
      var ty = gf[1] + (gt[1] - gf[1]) * alpha;
      var tz = gf[2] + (gt[2] - gf[2]) * alpha;
      for (k = 0; k < gl.length; k++) {
        o = gl[k] * 3;
        prev[o] = pos[o]; prev[o + 1] = pos[o + 1]; prev[o + 2] = pos[o + 2];
        pos[o] = tx + off[k * 3]; pos[o + 1] = ty + off[k * 3 + 1]; pos[o + 2] = tz + off[k * 3 + 2];
      }
    }

    // 2. верлет: x' = x + (x - x_prev)·damping + a·h²
    var gdy = this.gravity * h * h, damp = this.damping, kwh = this.windCoef * h;
    var nrm = this.normal, wv = this.windV;
    for (i = 0, o = 0; i < N; i++, o += 3) {
      if (im[i] === 0) continue;
      var x = pos[o], y = pos[o + 1], z = pos[o + 2];
      var vx = (x - prev[o]) * damp, vy = (y - prev[o + 1]) * damp, vz = (z - prev[o + 2]) * damp;
      var nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2];
      // ветер давит по нормали пропорционально относительной скорости воздуха
      var rel = (wv[o] * h - vx) * nx + (wv[o + 1] * h - vy) * ny + (wv[o + 2] * h - vz) * nz;
      var f = kwh * rel;
      prev[o] = x; prev[o + 1] = y; prev[o + 2] = z;
      pos[o] = x + vx + nx * f;
      pos[o + 1] = y + vy + gdy + ny * f;
      pos[o + 2] = z + vz + nz * f;
    }

    // 3. связи (Гаусс — Зейдель, чередуем направление обхода)
    var la = this.la, lb = this.lb, al = this.lalive, L = this.linkCount, rest = this.spacing;
    var qa = this.qalive, C = this.cols, Qc = C - 1, Q = this.quadCount;
    var rd = rest * Math.SQRT2, ks = this.shearK;
    var ba = this.ba, bb = this.bb, be1 = this.be1, be2 = this.be2, B = this.bendCount, rb = rest * 2, kb = this.bendK;
    var iters = this.iterations;
    for (var it = 0; it < iters; it++) {
      if (it & 1) {
        for (e = L - 1; e >= 0; e--) if (al[e]) this._pair(la[e], lb[e], rest, 1);
      } else {
        for (e = 0; e < L; e++) if (al[e]) this._pair(la[e], lb[e], rest, 1);
      }
      if (it < 2) {
        for (var q = 0; q < Q; q++) {
          if (!qa[q]) continue;
          var p = ((q / Qc) | 0) * C + (q % Qc);
          this._pair(p, p + C + 1, rd, ks);
          this._pair(p + 1, p + C, rd, ks);
        }
        for (k = 0; k < B; k++) {
          if (al[be1[k]] && al[be2[k]]) this._pair(ba[k], bb[k], rb, kb);
        }
      }
    }

    // 4. пол сцены (обрывки ложатся, а не улетают в бесконечность)
    var fy = this.floorY;
    if (fy < 1e6) {
      for (i = 0, o = 0; i < N; i++, o += 3) {
        if (im[i] === 0 || pos[o + 1] <= fy) continue;
        pos[o + 1] = fy; prev[o + 1] = fy;
        prev[o] += (pos[o] - prev[o]) * 0.5;
        prev[o + 2] += (pos[o + 2] - prev[o + 2]) * 0.5;
      }
    }

    // 5. разрывы: связь, растянутая сильнее порога, рвётся
    var tl = rest * this.tear, tl2 = tl * tl;
    for (e = 0; e < L; e++) {
      if (!al[e]) continue;
      var a3 = la[e] * 3, b3 = lb[e] * 3;
      var ddx = pos[b3] - pos[a3], ddy = pos[b3 + 1] - pos[a3 + 1], ddz = pos[b3 + 2] - pos[a3 + 2];
      if (ddx * ddx + ddy * ddy + ddz * ddz > tl2) this.breakLink(e);
    }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { Cloth: Cloth };
  }

  // =====================================================================
  //  Браузер: сцена, отрисовка, ввод
  // =====================================================================
  function boot() {
    var canvas = document.getElementById('scene');
    var ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
    var hud = document.getElementById('hud');
    var panel = document.getElementById('panel');
    var elParts = document.getElementById('sParts');
    var elLinks = document.getElementById('sLinks');
    var elBroken = document.getElementById('sBroken');
    var elBrokenChip = document.getElementById('sBrokenChip');
    var elWind = document.getElementById('sWind');
    var windInput = document.getElementById('wind');
    var tearInput = document.getElementById('tear');
    var windVal = document.getElementById('windVal');
    var tearVal = document.getElementById('tearVal');
    var legend = document.getElementById('legend');
    var pauseBadge = document.getElementById('pauseBadge');

    var state = {
      tool: 'grab',
      view: 'cloth',
      wind: +windInput.value / 100,
      tear: +tearInput.value / 100,
      paused: false
    };
    var cam = { F: 4.2, ppm: 300, cx: 0, cy: 0, yc: 0.75 };
    var W = 1, H = 1, dpr = 1, floorScreen = 0;
    var bg = document.createElement('canvas'), bgx = bg.getContext('2d');
    var sh = document.createElement('canvas'), shx = sh.getContext('2d');
    var SH_SCALE = 5;
    var cloth, SX, SY, qBase, qKind, qz;
    var order = [];
    var bucketIdx = [], bucketCnt = new Int32Array(8);
    var hoverId = -1;
    var drag = { active: false, id: -1, z: 0, dx: 0, dy: 0 };
    var cutting = { active: false, x: 0, y: 0 };
    var trail = [];
    var PT = { x: 0, y: 0 };

    // ---------- палитра ткани ----------
    function buildPattern() {
      var C = cloth.cols, R = cloth.rows, Qc = C - 1, Q = cloth.quadCount;
      qBase = new Float32Array(Q * 3);
      qKind = new Uint8Array(Q);
      var rnd = mulberry32(11);
      var jit = [];
      for (var i = 0; i < Qc; i++) jit.push(0.95 + rnd() * 0.07);
      for (var q = 0; q < Q; q++) {
        var qi = q % Qc, qj = (q / Qc) | 0;
        var r = 150, g = 22, b = 42, kind = 0;
        if (qj >= R - 3) { r = 204; g = 152; b = 62; kind = 1; }   // золотой подол
        else if (qj === R - 4) { r = 96; g = 12; b = 26; }        // тёмный кант
        else if (qj === 0) { r = 118; g = 16; b = 32; }           // верхняя лента
        var m = jit[qi];
        qBase[q * 3] = r * m; qBase[q * 3 + 1] = g * m; qBase[q * 3 + 2] = b * m;
        qKind[q] = kind;
      }
    }

    function newCloth() {
      cloth = new Cloth({ wind: state.wind, tear: state.tear });
      SX = new Float32Array(cloth.n);
      SY = new Float32Array(cloth.n);
      qz = new Float64Array(cloth.quadCount);
      for (var b = 0; b < 8; b++) bucketIdx[b] = new Int32Array(cloth.linkCount);
      buildPattern();
      drag.active = false;
      cutting.active = false;
      hoverId = -1;
      applyFloor();
      project();
      updateStats();
    }

    function applyFloor() {
      if (!cloth || !cam.ppm) return;
      var fy = (floorScreen - cam.cy) / cam.ppm + cam.yc;
      cloth.floorY = Math.max(cloth.height * 1.15, fy);
    }

    // ---------- раскладка и фон ----------
    function layout() {
      W = Math.max(1, window.innerWidth);
      H = Math.max(1, window.innerHeight);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));

      var hudR = hud.getBoundingClientRect();
      var panR = panel.getBoundingClientRect();
      var top = Math.max(64, Math.min(hudR.bottom + 22, H * 0.3));
      var bottom = Math.max(70, H - panR.top + 18);
      var availH = Math.max(80, H - top - bottom);
      var cw = cloth.width * cloth.gather + 0.36;
      var ch = cloth.height * 1.1 + 0.08;
      var ppm = Math.min((W - 28) / cw, availH / ch);
      if (ppm < 30) ppm = 30;
      cam.ppm = ppm;
      cam.yc = cloth.height * 0.5;
      cam.cx = W / 2;
      var yTop = top + 0.07 * ppm + Math.max(0, (availH - ch * ppm) * 0.35);
      cam.cy = yTop + cam.yc * ppm;
      floorScreen = Math.min(H - 8, panR.top + (H - panR.top) * 0.55);
      applyFloor();

      sh.width = Math.ceil(W / SH_SCALE) + 2;
      sh.height = Math.ceil(H / SH_SCALE) + 2;
      buildBackground();
    }

    function buildBackground() {
      bg.width = canvas.width;
      bg.height = canvas.height;
      var b = bgx;
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      var g = b.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1a1c26');
      g.addColorStop(0.65, '#101119');
      g.addColorStop(1, '#0a0b10');
      b.fillStyle = g;
      b.fillRect(0, 0, W, H);

      // тёплый прожектор за полотном
      var sx = cam.cx, sy = cam.cy - cam.yc * cam.ppm * 0.35;
      var r = Math.max(W, H) * 0.62;
      var rg = b.createRadialGradient(sx, sy, 0, sx, sy, r);
      rg.addColorStop(0, 'rgba(255,208,160,0.16)');
      rg.addColorStop(0.4, 'rgba(255,170,130,0.06)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = rg;
      b.fillRect(0, 0, W, H);

      // пол сцены
      var fg = b.createLinearGradient(0, floorScreen, 0, H);
      fg.addColorStop(0, 'rgba(40,34,38,0.9)');
      fg.addColorStop(1, 'rgba(12,12,16,0.95)');
      b.fillStyle = fg;
      b.fillRect(0, floorScreen, W, H - floorScreen);
      var lg = b.createLinearGradient(0, 0, W, 0);
      lg.addColorStop(0, 'rgba(255,215,170,0)');
      lg.addColorStop(0.5, 'rgba(255,215,170,0.22)');
      lg.addColorStop(1, 'rgba(255,215,170,0)');
      b.fillStyle = lg;
      b.fillRect(0, floorScreen, W, 1);

      // виньетка
      var vg = b.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.45, Math.max(W, H) * 0.8);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      b.fillStyle = vg;
      b.fillRect(0, 0, W, H);
    }

    // ---------- проекция ----------
    function project() {
      var pos = cloth.pos, N = cloth.n, F = cam.F, ppm = cam.ppm, cx = cam.cx, cy = cam.cy, yc = cam.yc;
      var zmin = -0.7 * F;
      for (var i = 0, o = 0; i < N; i++, o += 3) {
        var z = pos[o + 2];
        if (z < zmin) z = zmin;
        var k = ppm * F / (F + z);
        SX[i] = cx + pos[o] * k;
        SY[i] = cy + (pos[o + 1] - yc) * k;
      }
    }

    function proj(x, y, z) {
      var zz = Math.max(z, -0.7 * cam.F);
      var k = cam.ppm * cam.F / (cam.F + zz);
      PT.x = cam.cx + x * k;
      PT.y = cam.cy + (y - cam.yc) * k;
      return PT;
    }

    function unproject(sx, sy, z) {
      var zz = Math.max(z, -0.7 * cam.F);
      var k = cam.ppm * cam.F / (cam.F + zz);
      return [(sx - cam.cx) / k, (sy - cam.cy) / k + cam.yc, z];
    }

    // ---------- отрисовка ----------
    var LX = -0.359, LY = -0.558, LZ = -0.748;   // на свет: сверху-слева-спереди
    var HX = -0.192, HY = -0.298, HZ = -0.935;   // полувектор свет/взгляд

    function byDepth(a, b) { return qz[b] - qz[a]; }

    function collectQuads() {
      var pos = cloth.pos, C = cloth.cols, Qc = C - 1, Q = cloth.quadCount, qa = cloth.qalive;
      order.length = 0;
      for (var q = 0; q < Q; q++) {
        if (!qa[q]) continue;
        var p = (((q / Qc) | 0) * C + (q % Qc)) * 3, pc = p + C * 3;
        qz[q] = pos[p + 2] + pos[p + 5] + pos[pc + 2] + pos[pc + 5];
        order.push(q);
      }
    }

    function drawShadow() {
      var C = cloth.cols, Qc = C - 1, n = order.length;
      var s = 1 / SH_SCALE, ox = 0.05 * cam.ppm, oy = 0.075 * cam.ppm;
      shx.setTransform(1, 0, 0, 1, 0, 0);
      shx.clearRect(0, 0, sh.width, sh.height);
      shx.setTransform(s, 0, 0, s, ox * s, oy * s);
      shx.fillStyle = '#000';
      shx.beginPath();
      for (var k = 0; k < n; k++) {
        var q = order[k];
        var a = ((q / Qc) | 0) * C + (q % Qc), b = a + 1, c = a + C, d = c + 1;
        shx.moveTo(SX[a], SY[a]);
        shx.lineTo(SX[b], SY[b]);
        shx.lineTo(SX[d], SY[d]);
        shx.lineTo(SX[c], SY[c]);
        shx.closePath();
      }
      shx.fill();
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sh, 0, 0, sh.width * SH_SCALE, sh.height * SH_SCALE);
      ctx.restore();
    }

    function drawCloth() {
      var c = cloth, pos = c.pos, C = c.cols, Qc = C - 1;
      var F = cam.F, yc = cam.yc, rest = c.spacing;
      var tStart = 1.15, tSpan = Math.max(0.05, c.tear - tStart), rest2 = rest * rest;
      order.sort(byDepth);
      ctx.lineJoin = 'bevel';
      ctx.lineWidth = clamp(rest * cam.ppm * 0.05, 0.5, 1);
      ctx.strokeStyle = 'rgba(22,2,8,0.30)';
      for (var n = 0; n < order.length; n++) {
        var q = order[n];
        var a = ((q / Qc) | 0) * C + (q % Qc), b = a + 1, cc = a + C, d = cc + 1;
        var ao = a * 3, bo = b * 3, co = cc * 3, dO = d * 3;
        var ax = pos[ao], ay = pos[ao + 1], az = pos[ao + 2];
        var bx = pos[bo], by = pos[bo + 1], bz = pos[bo + 2];
        var cx = pos[co], cy = pos[co + 1], cz = pos[co + 2];
        var dx = pos[dO], dy = pos[dO + 1], dz = pos[dO + 2];

        // нормаль ячейки по диагоналям
        var d1x = dx - ax, d1y = dy - ay, d1z = dz - az;
        var d2x = cx - bx, d2y = cy - by, d2z = cz - bz;
        var nx = d2y * d1z - d2z * d1y, ny = d2z * d1x - d2x * d1z, nz = d2x * d1y - d2y * d1x;
        var mx = (ax + bx + cx + dx) * 0.25, my = (ay + by + cy + dy) * 0.25, mz = (az + bz + cz + dz) * 0.25;
        var front = (nx * mx + ny * (my - yc) + nz * (mz + F)) < 0;
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        if (!front) nl = -nl;
        nx /= nl; ny /= nl; nz /= nl;

        // максимальное растяжение сторон ячейки
        var ex = bx - ax, ey = by - ay, ez = bz - az, m2 = ex * ex + ey * ey + ez * ez, t2;
        ex = dx - cx; ey = dy - cy; ez = dz - cz; t2 = ex * ex + ey * ey + ez * ez; if (t2 > m2) m2 = t2;
        ex = cx - ax; ey = cy - ay; ez = cz - az; t2 = ex * ex + ey * ey + ez * ez; if (t2 > m2) m2 = t2;
        ex = dx - bx; ey = dy - by; ez = dz - bz; t2 = ex * ex + ey * ey + ez * ez; if (t2 > m2) m2 = t2;
        var st = Math.sqrt(m2 / rest2);

        var ndl = nx * LX + ny * LY + nz * LZ;
        var dif = ndl > -0.3 ? (ndl + 0.3) / 1.3 : 0;
        var ndh = nx * HX + ny * HY + nz * HZ;
        var spec = ndh > 0 ? Math.pow(ndh, 24) : 0;
        var rim = 1 - (nz < 0 ? -nz : nz); rim *= rim;
        var fog = 1 - clamp(mz * 0.8, -0.14, 0.3);
        var r, g, bl, shd;
        if (front) {
          var br = qBase[q * 3], bgc = qBase[q * 3 + 1], bbc = qBase[q * 3 + 2];
          if (qKind[q] === 1) {
            shd = (0.2 + 0.9 * dif) * fog;
            r = br * shd + 255 * spec * 0.75 + 70 * rim;
            g = bgc * shd + 226 * spec * 0.75 + 50 * rim;
            bl = bbc * shd + 150 * spec * 0.75 + 20 * rim;
          } else {
            shd = (0.2 + 0.9 * dif) * fog;
            var sheen = rim * (0.35 + 0.65 * dif) * 0.5;
            r = br * shd + 250 * sheen;
            g = bgc * shd + 118 * sheen;
            bl = bbc * shd + 134 * sheen;
          }
        } else {
          shd = (0.18 + 0.8 * dif) * fog;
          r = 206 * shd + 255 * spec * 0.25;
          g = 190 * shd + 245 * spec * 0.25;
          bl = 164 * shd + 225 * spec * 0.25;
        }
        if (st > tStart) {
          var tt = (st - tStart) / tSpan;
          if (tt > 1) tt = 1;
          tt *= 0.65;
          r += (255 - r) * tt; g += (228 - g) * tt; bl += (214 - bl) * tt;
        }
        ctx.fillStyle = 'rgb(' + (r > 255 ? 255 : r | 0) + ',' + (g > 255 ? 255 : g | 0) + ',' + (bl > 255 ? 255 : bl | 0) + ')';
        ctx.beginPath();
        ctx.moveTo(SX[a], SY[a]);
        ctx.lineTo(SX[b], SY[b]);
        ctx.lineTo(SX[d], SY[d]);
        ctx.lineTo(SX[cc], SY[cc]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // нити, у которых не осталось соседних ячеек
    function drawThreads() {
      var c = cloth, al = c.lalive, la = c.la, lb = c.lb, q1 = c.lq1, q2 = c.lq2, qa = c.qalive, L = c.linkCount;
      ctx.beginPath();
      var any = false;
      for (var e = 0; e < L; e++) {
        if (!al[e]) continue;
        if ((q1[e] >= 0 && qa[q1[e]]) || (q2[e] >= 0 && qa[q2[e]])) continue;
        ctx.moveTo(SX[la[e]], SY[la[e]]);
        ctx.lineTo(SX[lb[e]], SY[lb[e]]);
        any = true;
      }
      if (!any) return;
      ctx.lineCap = 'round';
      ctx.lineWidth = clamp(cam.ppm * 0.004, 0.8, 1.6);
      ctx.strokeStyle = 'rgba(214,104,118,0.9)';
      ctx.stroke();
    }

    // бахрома по нижнему краю
    function drawFringe() {
      var c = cloth, pos = c.pos, C = c.cols, R = c.rows, al = c.lalive, HC = c.hCount;
      var len = 0.045;
      ctx.beginPath();
      for (var i = 0; i < C; i++) {
        var e = HC + (R - 2) * C + i;
        if (!al[e]) continue;
        var id = (R - 1) * C + i, up = id - C, o = id * 3, u = up * 3;
        var vx = pos[o] - pos[u], vy = pos[o + 1] - pos[u + 1], vz = pos[o + 2] - pos[u + 2];
        var l = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
        var p = proj(pos[o] + vx / l * len, pos[o + 1] + vy / l * len, pos[o + 2] + vz / l * len);
        ctx.moveTo(SX[id], SY[id]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineCap = 'round';
      ctx.lineWidth = clamp(cam.ppm * 0.005, 1, 2.2);
      ctx.strokeStyle = 'rgba(226,176,84,0.95)';
      ctx.stroke();
    }

    var BUCKET = [
      'rgba(64,156,255,0.50)', 'rgba(84,196,255,0.68)', 'rgba(128,228,246,0.80)', 'rgba(196,248,224,0.88)',
      'rgba(255,240,150,0.92)', 'rgba(255,186,92,0.96)', 'rgba(255,122,74,1)', 'rgba(255,64,64,1)'
    ];

    function drawGrid() {
      var c = cloth, pos = c.pos, la = c.la, lb = c.lb, al = c.lalive, L = c.linkCount, rest = c.spacing;
      var inv = 1 / Math.max(0.05, c.tear - 1);
      var e, k, bi;
      for (bi = 0; bi < 8; bi++) bucketCnt[bi] = 0;
      for (e = 0; e < L; e++) {
        if (!al[e]) continue;
        var a = la[e] * 3, b = lb[e] * 3;
        var dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
        var t = (Math.sqrt(dx * dx + dy * dy + dz * dz) / rest - 1) * inv;
        bi = t <= 0 ? 0 : (t >= 1 ? 7 : (t * 8) | 0);
        bucketIdx[bi][bucketCnt[bi]++] = e;
      }
      var lw = clamp(rest * cam.ppm * 0.06, 0.7, 1.3);
      ctx.lineCap = 'round';
      for (bi = 0; bi < 8; bi++) {
        var n = bucketCnt[bi];
        if (!n) continue;
        var arr = bucketIdx[bi];
        ctx.beginPath();
        for (k = 0; k < n; k++) {
          e = arr[k];
          ctx.moveTo(SX[la[e]], SY[la[e]]);
          ctx.lineTo(SX[lb[e]], SY[lb[e]]);
        }
        ctx.strokeStyle = BUCKET[bi];
        ctx.lineWidth = lw + bi * 0.22;
        ctx.stroke();
      }
      // узлы
      var N = c.n, ds = clamp(rest * cam.ppm * 0.12, 1.2, 2.4), hs = ds / 2;
      ctx.fillStyle = 'rgba(214,236,255,0.75)';
      ctx.beginPath();
      for (var i = 0; i < N; i++) ctx.rect(SX[i] - hs, SY[i] - hs, ds, ds);
      ctx.fill();
    }

    // карниз
    function rodGeom() {
      var half = cloth.width * cloth.gather / 2 + 0.1;
      return { half: half, y: -0.05 };
    }

    function drawRod() {
      var rg = rodGeom();
      var p1 = proj(-rg.half, rg.y, 0), x1 = p1.x, y1 = p1.y;
      var p2 = proj(rg.half, rg.y, 0), x2 = p2.x;
      var th = Math.max(4, 0.024 * cam.ppm);
      // тень карниза на стене
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#000';
      ctx.lineCap = 'round';
      ctx.lineWidth = th * 1.3;
      ctx.beginPath();
      ctx.moveTo(x1 + 0.05 * cam.ppm, y1 + 0.075 * cam.ppm);
      ctx.lineTo(x2 + 0.05 * cam.ppm, y1 + 0.075 * cam.ppm);
      ctx.stroke();
      ctx.restore();

      var g = ctx.createLinearGradient(0, y1 - th / 2, 0, y1 + th / 2);
      g.addColorStop(0, '#fbe3a4');
      g.addColorStop(0.35, '#cfa35a');
      g.addColorStop(1, '#5e3f17');
      ctx.strokeStyle = g;
      ctx.lineWidth = th;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y1);
      ctx.stroke();
      // наконечники
      var rr = th * 1.25;
      for (var s = -1; s <= 1; s += 2) {
        var ex = s < 0 ? x1 - rr * 0.6 : x2 + rr * 0.6;
        var bgr = ctx.createRadialGradient(ex - rr * 0.35, y1 - rr * 0.4, rr * 0.1, ex, y1, rr);
        bgr.addColorStop(0, '#fff1c4');
        bgr.addColorStop(0.45, '#c99a4c');
        bgr.addColorStop(1, '#4a3010');
        ctx.fillStyle = bgr;
        ctx.beginPath();
        ctx.arc(ex, y1, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // зажимы-кольца на карнизе
    function drawClips() {
      var c = cloth, pc = c.pinCols, rg = rodGeom();
      var ringR = Math.max(3.5, 0.02 * cam.ppm), lw = Math.max(1.5, 0.0065 * cam.ppm);
      var grid = state.view === 'grid';
      for (var k = 0; k < pc.length; k++) {
        var id = pc[k], o = id * 3;
        var rp = proj(c.anchor[o], rg.y, 0), rx = rp.x, ry = rp.y;
        var pinnedNow = c.pinned[id] === 1;
        ctx.lineWidth = lw;
        ctx.strokeStyle = pinnedNow ? (grid ? '#ffd27a' : '#e8c276') : 'rgba(200,170,110,0.55)';
        ctx.beginPath();
        ctx.arc(rx, ry, ringR, 0, Math.PI * 2);
        ctx.stroke();
        if (pinnedNow) {
          var px = SX[id], py = SY[id];
          ctx.beginPath();
          ctx.moveTo(rx, ry + ringR);
          ctx.lineTo(px, py);
          ctx.stroke();
          var jw = Math.max(4, 0.016 * cam.ppm), jh = Math.max(5, 0.024 * cam.ppm);
          var jg = ctx.createLinearGradient(px - jw / 2, 0, px + jw / 2, 0);
          jg.addColorStop(0, '#f4d690');
          jg.addColorStop(1, '#7a5520');
          ctx.fillStyle = jg;
          ctx.fillRect(px - jw / 2, py - jh * 0.45, jw, jh);
        } else {
          // раскрытый крючок
          ctx.beginPath();
          ctx.arc(rx, ry + ringR * 1.6, ringR * 0.6, -Math.PI * 0.5, Math.PI * 0.6);
          ctx.stroke();
        }
      }
    }

    function drawPointerUI(now) {
      var i;
      if (drag.active && drag.id >= 0) {
        var x = SX[drag.id], y = SY[drag.id];
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (hoverId >= 0 && state.tool === 'grab' && !cutting.active) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(SX[hoverId], SY[hoverId], 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      // след ножа
      var life = 380;
      while (trail.length && now - trail[0].t > life) trail.shift();
      if (trail.length > 1) {
        ctx.lineCap = 'round';
        for (i = 1; i < trail.length; i++) {
          var p0 = trail[i - 1], p1 = trail[i];
          if (p1.gap) continue;
          var a = 1 - (now - p1.t) / life;
          if (a <= 0) continue;
          ctx.strokeStyle = 'rgba(255,236,210,' + (a * 0.9).toFixed(3) + ')';
          ctx.lineWidth = 1 + a * 2.2;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
      }
    }

    function render(now) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      project();
      if (state.view === 'cloth') {
        collectQuads();
        drawShadow();
        drawRod();
        drawCloth();
        drawFringe();
        drawThreads();
      } else {
        drawRod();
        drawGrid();
      }
      drawClips();
      drawPointerUI(now);
    }

    // ---------- ввод ----------
    function pick(x, y, pinnedOnly) {
      var N = cloth.n, pin = cloth.pinned, best = -1;
      var R = Math.max(18, cloth.spacing * cam.ppm * 1.25), bd = R * R;
      for (var i = 0; i < N; i++) {
        if (pinnedOnly ? !pin[i] : pin[i]) continue;
        var dx = SX[i] - x, dy = SY[i] - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    function cutLine(x1, y1, x2, y2) {
      var c = cloth, la = c.la, lb = c.lb, al = c.lalive, L = c.linkCount;
      var minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
      var rx = x2 - x1, ry = y2 - y1;
      if (rx * rx + ry * ry < 0.25) return;
      for (var e = 0; e < L; e++) {
        if (!al[e]) continue;
        var a = la[e], b = lb[e];
        var ax = SX[a], ay = SY[a], bx = SX[b], by = SY[b];
        if ((ax > maxX && bx > maxX) || (ax < minX && bx < minX) || (ay > maxY && by > maxY) || (ay < minY && by < minY)) continue;
        var sx = bx - ax, sy = by - ay;
        var den = rx * sy - ry * sx;
        if (den === 0) continue;
        var qx = ax - x1, qy = ay - y1;
        var t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) c.breakLink(e);
      }
    }

    function setCursor() {
      var cur = 'default';
      if (state.tool === 'cut' || cutting.active) cur = 'crosshair';
      else if (drag.active) cur = 'grabbing';
      else if (hoverId >= 0) cur = 'grab';
      if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
    }

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvas.addEventListener('pointerdown', function (e) {
      var x = e.clientX, y = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* нет захвата — не страшно */ }
      if (state.tool === 'cut' || e.button === 2 || e.shiftKey) {
        cutting.active = true;
        cutting.x = x; cutting.y = y;
        trail.push({ x: x, y: y, t: performance.now(), gap: true });
        setCursor();
        return;
      }
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      var id = pick(x, y, false);
      if (id >= 0 && cloth.grab(id, 1.6)) {
        drag.active = true;
        drag.id = id;
        drag.z = cloth.pos[id * 3 + 2];
        drag.dx = SX[id] - x;
        drag.dy = SY[id] - y;
      }
      setCursor();
    });

    canvas.addEventListener('pointermove', function (e) {
      var x = e.clientX, y = e.clientY;
      if (cutting.active) {
        cutLine(cutting.x, cutting.y, x, y);
        cutting.x = x; cutting.y = y;
        trail.push({ x: x, y: y, t: performance.now(), gap: false });
        if (trail.length > 80) trail.shift();
      } else if (drag.active) {
        var w = unproject(x + drag.dx, y + drag.dy, drag.z);
        cloth.setGrabTarget(w[0], w[1], w[2]);
      } else if (e.pointerType === 'mouse') {
        hoverId = state.tool === 'grab' ? pick(x, y, false) : -1;
      }
      setCursor();
    });

    function endPointer() {
      if (drag.active) cloth.release();
      drag.active = false;
      drag.id = -1;
      cutting.active = false;
      setCursor();
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', function () { if (!drag.active && !cutting.active) { hoverId = -1; setCursor(); } });

    canvas.addEventListener('dblclick', function (e) {
      var id = pick(e.clientX, e.clientY, true);
      if (id < 0) {
        // клик прямо по кольцу на карнизе
        var pc = cloth.pinCols, rg = rodGeom(), best = 26 * 26;
        for (var k = 0; k < pc.length; k++) {
          var p = pc[k];
          if (!cloth.pinned[p]) continue;
          var rp = proj(cloth.anchor[p * 3], rg.y, 0);
          var dx = rp.x - e.clientX, dy = rp.y - e.clientY, d = dx * dx + dy * dy;
          if (d < best) { best = d; id = p; }
        }
      }
      if (id >= 0) {
        if (drag.active) endPointer();
        cloth.unpin(id);
      }
    });

    // ---------- панель ----------
    function segBind(rootId, attr, apply) {
      var root = document.getElementById(rootId);
      var btns = root.querySelectorAll('button');
      root.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        for (var i = 0; i < btns.length; i++) {
          var on = btns[i] === b;
          btns[i].classList.toggle('on', on);
          btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        apply(b.getAttribute(attr));
      });
    }

    segBind('toolSeg', 'data-tool', function (v) {
      state.tool = v;
      hoverId = -1;
      setCursor();
    });
    segBind('viewSeg', 'data-view', function (v) {
      state.view = v;
      legend.hidden = v !== 'grid';
    });

    function fmt(v, d) { return v.toFixed(d).replace('.', ','); }

    windInput.addEventListener('input', function () {
      state.wind = +windInput.value / 100;
      cloth.wind = state.wind;
      windVal.textContent = windInput.value + '%';
    });
    tearInput.addEventListener('input', function () {
      state.tear = +tearInput.value / 100;
      cloth.tear = state.tear;
      tearVal.textContent = '×' + fmt(state.tear, 2);
    });
    document.getElementById('reset').addEventListener('click', function () { newCloth(); });

    function togglePause() {
      state.paused = !state.paused;
      pauseBadge.hidden = !state.paused;
    }

    window.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') && e.code === 'Space') return;
      if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) { newCloth(); }
      else if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    });

    var ruNum = (typeof Intl !== 'undefined') ? new Intl.NumberFormat('ru-RU') : null;
    function num(v) { return ruNum ? ruNum.format(v) : String(v); }

    function updateStats() {
      var c = cloth;
      elParts.textContent = num(c.n);
      elLinks.textContent = num(c.linkCount - c.broken);
      elBroken.textContent = num(c.broken);
      elBrokenChip.classList.toggle('hot', c.broken > 0);
      var arrow = c.windDirX > 0.3 ? ' →' : (c.windDirX < -0.3 ? ' ←' : '');
      elWind.textContent = fmt(c.windSpeed, 1) + ' м/с' + arrow;
    }

    // ---------- цикл ----------
    var STEP = 1 / 180, MAX_STEPS = 9;
    var acc = 0, last = performance.now(), statT = 0;

    function frame(now) {
      var dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0)) dt = 0;
      if (dt > 0.05) dt = 0.05;           // кламп после вкладки в фоне/лагов
      if (!state.paused) {
        acc += dt;
        var n = Math.floor(acc / STEP);
        if (n > MAX_STEPS) { n = MAX_STEPS; acc = 0; } else acc -= n * STEP;
        if (n > 0) {
          cloth.updateNormals();
          cloth.updateWind();
          for (var k = 0; k < n; k++) cloth.step(STEP, (k + 1) / n);
          cloth.syncGrab();
        }
      }
      render(now);
      statT += dt;
      if (statT > 0.25) { statT = 0; updateStats(); }
      requestAnimationFrame(frame);
    }

    window.addEventListener('resize', function () { layout(); });

    newCloth();
    layout();
    windVal.textContent = windInput.value + '%';
    tearVal.textContent = '×' + fmt(state.tear, 2);
    requestAnimationFrame(function (t) { last = t; frame(t); });
  }

  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
