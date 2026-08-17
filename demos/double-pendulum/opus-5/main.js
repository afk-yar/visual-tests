/* Двойной маятник — Claude Opus 5
   Физика: полные уравнения Лагранжа (без малых углов, без демпфирования),
   интегратор Рунге—Кутты 4-го порядка с фиксированным шагом 0,5 мс.

   Файл двурежимный: в браузере поднимает демку, в node экспортирует чистую
   физику (derivatives / rk4 / step / energy) — тем же кодом проверяется
   сохранение энергии headless-прогоном. */
(function (global) {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════
     1. ФИЗИКА  (чистые функции, без DOM)

     Обобщённые координаты: θ1, θ2 — углы стержней от вертикали вниз.
     Состояние s = [θ1, ω1, θ2, ω2].

     Лагранжиан L = T − V:
       T = ½(m1+m2)L1²ω1² + ½m2L2²ω2² + m2L1L2ω1ω2·cos(θ1−θ2)
       V = −(m1+m2)g·L1·cosθ1 − m2·g·L2·cosθ2

     Уравнения Эйлера—Лагранжа дают линейную систему 2×2 на угловые
     ускорения (Δ = θ1 − θ2):

       (m1+m2)L1·α1 + m2L2·cosΔ·α2 = −m2L2·ω2²·sinΔ − (m1+m2)g·sinθ1
             L1·cosΔ·α1 +      L2·α2 =    L1·ω1²·sinΔ −            g·sinθ2

     Определитель  L1L2(m1 + m2·sin²Δ) > 0 всегда → система невырождена.
     ══════════════════════════════════════════════════════════════════ */

  function derivatives(s, p, out) {
    var th1 = s[0], w1 = s[1], th2 = s[2], w2 = s[3];
    var d = th1 - th2;
    var sd = Math.sin(d), cd = Math.cos(d);
    var M = p.m1 + p.m2;

    var a11 = M * p.L1,       a12 = p.m2 * p.L2 * cd;
    var a21 = p.L1 * cd,      a22 = p.L2;
    var b1 = -p.m2 * p.L2 * w2 * w2 * sd - M * p.g * Math.sin(th1);
    var b2 =  p.L1 * w1 * w1 * sd        -     p.g * Math.sin(th2);

    var det = p.L1 * p.L2 * (p.m1 + p.m2 * sd * sd);

    out[0] = w1;
    out[1] = (b1 * a22 - a12 * b2) / det;
    out[2] = w2;
    out[3] = (a11 * b2 - b1 * a21) / det;
    return out;
  }

  var _k1 = new Float64Array(4), _k2 = new Float64Array(4),
      _k3 = new Float64Array(4), _k4 = new Float64Array(4),
      _tm = new Float64Array(4);

  /* Классический RK4, шаг h. Мутирует s. */
  function rk4(s, p, h) {
    var i;
    derivatives(s, p, _k1);
    for (i = 0; i < 4; i++) _tm[i] = s[i] + 0.5 * h * _k1[i];
    derivatives(_tm, p, _k2);
    for (i = 0; i < 4; i++) _tm[i] = s[i] + 0.5 * h * _k2[i];
    derivatives(_tm, p, _k3);
    for (i = 0; i < 4; i++) _tm[i] = s[i] + h * _k3[i];
    derivatives(_tm, p, _k4);
    for (i = 0; i < 4; i++)
      s[i] += (h / 6) * (_k1[i] + 2 * _k2[i] + 2 * _k3[i] + _k4[i]);
    return s;
  }

  /* Шаг симуляции = один фиксированный шаг h, при необходимости раздробленный.
     На «жёстких» комбинациях параметров (лёгкий верхний груз, короткие стержни,
     большая g) угловые скорости доходят до ~130 рад/с, и RK4 с шагом 0,5 мс
     начинает терять энергию. Нужный шаг оцениваем по текущему характерному
     времени: min(√(Lmin/g), 1/ωmax), с поправкой на соотношение масс
     (при m1 ≪ m2 эффективная инерция верхнего звена мала → движение быстрее).
     Замерено: на дефолте дробление не включается, в худшем углу параметров
     дрейф падает с 4·10³ ppm до единиц ppm. */
  function step(s, p, h, maxSub) {
    var w = Math.max(Math.abs(s[1]), Math.abs(s[3]), 1);
    var tau = Math.sqrt(Math.min(p.L1, p.L2) / Math.max(p.g, 1));
    var need = 0.04 * Math.min(tau, 1 / w) * Math.sqrt(p.m1 / (p.m1 + p.m2));
    var lim = maxSub || 8;
    var n = Math.ceil(h / need);
    if (!(n >= 1)) n = 1;
    if (n > lim) n = lim;
    var hh = h / n;
    for (var i = 0; i < n; i++) rk4(s, p, hh);
    return n;
  }

  /* Полная механическая энергия (интеграл движения — контроль точности). */
  function energy(s, p) {
    var th1 = s[0], w1 = s[1], th2 = s[2], w2 = s[3];
    var T = 0.5 * (p.m1 + p.m2) * p.L1 * p.L1 * w1 * w1
          + 0.5 * p.m2 * p.L2 * p.L2 * w2 * w2
          + p.m2 * p.L1 * p.L2 * w1 * w2 * Math.cos(th1 - th2);
    var V = -(p.m1 + p.m2) * p.g * p.L1 * Math.cos(th1)
          - p.m2 * p.g * p.L2 * Math.cos(th2);
    return T + V;
  }

  var Physics = { derivatives: derivatives, rk4: rk4, step: step, energy: energy };
  if (typeof module === 'object' && module && module.exports) module.exports = Physics;
  global.DoublePendulumPhysics = Physics;

  /* В node дальше идти некуда — DOM отсутствует. */
  if (typeof document === 'undefined') return;

  /* ══════════════════════════════════════════════════════════════════
     2. ПАРАМЕТРЫ И СОСТОЯНИЕ
     ══════════════════════════════════════════════════════════════════ */

  var prm = { m1: 1.4, m2: 1.0, L1: 1.0, L2: 0.9, g: 9.81 };

  var H_STEP  = 0.0005;   // шаг интегрирования, с
  var MAX_DT  = 0.05;     // кламп кадрового dt, с
  var MAX_SUB = 140;      // потолок подшагов за кадр
  var TRAIL_DT = 0.006;   // период выборки следа, с
  var TRAIL_N  = 900;     // длина следа, точек
  var SPARK_DT = 0.1;     // период выборки графика расхождения, с
  var SPARK_CAP = 320;   // ёмкость буфера графика (счётчик — sparkN)

  // выразительный хаотический старт: оба стержня высоко, из покоя
  var IC = new Float64Array([2.05, 0, 2.62, 0]);

  var st  = new Float64Array(4);   // основной маятник
  var gst = new Float64Array(4);   // «призрак»
  var E0 = 0;

  var running = true, ghostOn = true, trailOn = true;
  var simT = 0, acc = 0, trailAcc = 0, sparkAcc = 0, last = 0;
  var eps = 1e-3;                  // отклонение начального угла призрака

  /* ── кольцевой буфер следа (координаты храним в метрах) ───────────── */
  function Trail(cap) {
    this.cap = cap; this.buf = new Float64Array(cap * 3);
    this.n = 0; this.head = 0;
  }
  Trail.prototype.push = function (x, y, v) {
    if (this.n > 0) {
      var li = ((this.head - 1 + this.cap) % this.cap) * 3;
      var dx = x - this.buf[li], dy = y - this.buf[li + 1];
      if (dx * dx + dy * dy < minStep * minStep) return;
    }
    var i = this.head * 3;
    this.buf[i] = x; this.buf[i + 1] = y; this.buf[i + 2] = v;
    this.head = (this.head + 1) % this.cap;
    if (this.n < this.cap) this.n++;
  };
  Trail.prototype.idx = function (k) { // k: 0 — самая старая точка
    return (((this.head - this.n + k) % this.cap) + this.cap) % this.cap;
  };
  Trail.prototype.clear = function () { this.n = 0; this.head = 0; };

  var trail = new Trail(TRAIL_N), gtrail = new Trail(TRAIL_N);
  var minStep = 0.004;   // минимальный шаг между точками следа, м

  /* График расхождения: log10 |Δθ| от времени, вся история с момента
     синхронизации призрака. Скользящее окно тут не годится: смысл графика —
     экспоненциальный разгон и выход на насыщение, а окно через минуту
     показало бы одну полку без разгона. Поэтому при переполнении буфера
     прореживаем вдвое и вдвое увеличиваем интервал выборки — шаг остаётся
     равномерным, а на экране всегда весь прогон целиком. */
  var sparkY = new Float64Array(SPARK_CAP), sparkX = new Float64Array(SPARK_CAP),
      sparkN = 0, sparkStep = SPARK_DT;

  function sparkPush(t, y) {
    if (sparkN >= SPARK_CAP) {
      var m = 0;
      for (var i = 0; i < sparkN; i += 2) { sparkX[m] = sparkX[i]; sparkY[m] = sparkY[i]; m++; }
      sparkN = m;
      sparkStep *= 2;
    }
    sparkX[sparkN] = t; sparkY[sparkN] = y; sparkN++;
  }
  function sparkClear() { sparkN = 0; sparkStep = SPARK_DT; }

  /* ══════════════════════════════════════════════════════════════════
     3. ХОЛСТ, DPR, РАСКЛАДКА
     ══════════════════════════════════════════════════════════════════ */

  var cv = document.getElementById('scene');
  var ctx = cv.getContext('2d', { alpha: false });
  var W = 1, H = 1, dpr = 1;
  var cx = 0, cy = 0, scale = 100;
  var bgGrad = null, vigGrad = null;

  var panelEl = document.getElementById('panel');

  /* Ось подвеса ставим посередине свободной полосы (между верхом окна и
     панелью), а масштаб берём так, чтобы вся область достижимости —
     включая полностью выпрямленный вверх маятник — влезала в кадр:
     обрезанный след выглядел бы поломкой, а не физикой. */
  function layout() {
    var reach = prm.L1 + prm.L2;
    var panelH = (panelEl ? panelEl.offsetHeight : 132) + 24;
    cx = W * 0.5;

    var ideal = (H - panelH + 4) * 0.5;
    cy = Math.min(Math.max(ideal, H * 0.24), H * 0.5);

    var up   = Math.max(30, cy - 12);
    var down = Math.max(30, H - panelH - cy - 6);
    var side = Math.max(40, W * 0.5 - 20);

    scale = Math.max(20, Math.min(up, down, side) / reach);
    minStep = 0.55 / scale;
  }

  function makeGradients() {
    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#080d19');
    bgGrad.addColorStop(0.55, '#060a13');
    bgGrad.addColorStop(1, '#03050b');

    var r = Math.max(W, H) * 0.75;
    vigGrad = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.08, cx, cy, r);
    vigGrad.addColorStop(0, 'rgba(64,116,210,0.13)');
    vigGrad.addColorStop(0.42, 'rgba(24,44,92,0.05)');
    vigGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
  }

  function resize() {
    dpr = Math.min(2, global.devicePixelRatio || 1);
    W = Math.max(1, global.innerWidth || document.documentElement.clientWidth || 1);
    H = Math.max(1, global.innerHeight || document.documentElement.clientHeight || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
    makeGradients();
  }

  /* ══════════════════════════════════════════════════════════════════
     4. ЗАПУСК / СБРОС
     ══════════════════════════════════════════════════════════════════ */

  function wrapPi(a) {
    a = (a + Math.PI) % (2 * Math.PI);
    if (a < 0) a += 2 * Math.PI;
    return a - Math.PI;
  }

  function syncGhost() {
    gst[0] = st[0] + eps; gst[1] = st[1];
    gst[2] = st[2];       gst[3] = st[3];
    gtrail.clear();
    sparkClear();
  }

  /* Перезапуск с текущих начальных условий IC. */
  function launch() {
    st[0] = IC[0]; st[1] = IC[1]; st[2] = IC[2]; st[3] = IC[3];
    E0 = energy(st, prm);
    simT = 0; acc = 0; trailAcc = 0; sparkAcc = 0;
    trail.clear();
    syncGhost();
  }

  /* Случайное начальное состояние с «интересной» энергией. */
  function randomIC() {
    var Emin = -(prm.m1 + prm.m2) * prm.g * prm.L1 - prm.m2 * prm.g * prm.L2;
    var Emax = -Emin, span = Emax - Emin || 1;
    var t1 = 0, t2 = 0, ok = false, probe = new Float64Array(4);
    for (var i = 0; i < 300 && !ok; i++) {
      t1 = (Math.random() * 2 - 1) * Math.PI;
      t2 = (Math.random() * 2 - 1) * Math.PI;
      probe[0] = t1; probe[1] = 0; probe[2] = t2; probe[3] = 0;
      var f = (energy(probe, prm) - Emin) / span;
      if (f > 0.55 && f < 0.94) ok = true;
    }
    if (!ok) { t1 = 2.05; t2 = 2.62; }
    IC[0] = t1; IC[1] = 0; IC[2] = t2; IC[3] = 0;
    launch();
  }

  /* ══════════════════════════════════════════════════════════════════
     5. ШАГ СИМУЛЯЦИИ
     ══════════════════════════════════════════════════════════════════ */

  var pos = { x1: 0, y1: 0, x2: 0, y2: 0 };
  var gpos = { x1: 0, y1: 0, x2: 0, y2: 0 };

  function positions(s, o) {
    o.x1 = prm.L1 * Math.sin(s[0]);
    o.y1 = -prm.L1 * Math.cos(s[0]);
    o.x2 = o.x1 + prm.L2 * Math.sin(s[2]);
    o.y2 = o.y1 - prm.L2 * Math.cos(s[2]);
    return o;
  }

  function tipSpeed(s) {
    var vx = prm.L1 * s[1] * Math.cos(s[0]) + prm.L2 * s[3] * Math.cos(s[2]);
    var vy = prm.L1 * s[1] * Math.sin(s[0]) + prm.L2 * s[3] * Math.sin(s[2]);
    return Math.sqrt(vx * vx + vy * vy);
  }

  function separation() {
    return Math.sqrt(
      Math.pow(wrapPi(st[0] - gst[0]), 2) + Math.pow(wrapPi(st[2] - gst[2]), 2)
    );
  }

  function sample() {
    trailAcc += H_STEP;
    if (trailAcc >= TRAIL_DT) {
      trailAcc = 0;
      positions(st, pos);
      trail.push(pos.x2, pos.y2, tipSpeed(st));
      if (ghostOn) {
        positions(gst, gpos);
        gtrail.push(gpos.x2, gpos.y2, 0);
      }
    }
    if (ghostOn) {
      sparkAcc += H_STEP;
      if (sparkAcc >= sparkStep) {
        sparkAcc = 0;
        var d = separation();
        sparkPush(simT, Math.log(Math.max(d, 1e-16)) / Math.LN10);
      }
    }
  }

  function advance(dt) {
    acc += dt;
    var n = 0;
    while (acc >= H_STEP && n < MAX_SUB) {
      step(st, prm, H_STEP, 8);
      if (ghostOn) step(gst, prm, H_STEP, 8);
      simT += H_STEP;
      sample();
      acc -= H_STEP;
      n++;
    }
    if (n >= MAX_SUB) acc = 0;               // не копим долг на слабой машине
    st[0] = wrapPi(st[0]); st[2] = wrapPi(st[2]);
    gst[0] = wrapPi(gst[0]); gst[2] = wrapPi(gst[2]);
  }

  /* ══════════════════════════════════════════════════════════════════
     6. РЕНДЕР
     ══════════════════════════════════════════════════════════════════ */

  function sx(x) { return cx + scale * x; }
  function sy(y) { return cy - scale * y; }

  function bobR(m) {
    return Math.max(6.5, Math.min(58, scale * 0.098 * Math.cbrt(m)));
  }

  function drawBackground() {
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, W, H);

    // область достижимости — тонкая техническая разметка
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 8]);
    ctx.strokeStyle = 'rgba(130,175,245,0.11)';
    ctx.beginPath();
    ctx.arc(cx, cy, (prm.L1 + prm.L2) * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(130,175,245,0.07)';
    ctx.beginPath();
    ctx.arc(cx, cy, prm.L1 * scale, 0, Math.PI * 2);
    ctx.stroke();
    var inner = Math.abs(prm.L1 - prm.L2) * scale;
    if (inner > 6) {
      ctx.beginPath();
      ctx.arc(cx, cy, inner, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMount() {
    var w = 34, h = 11;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - w, cy - h - 5);
    ctx.lineTo(cx + w, cy - h - 5);
    ctx.lineTo(cx + w, cy - 5);
    ctx.lineTo(cx - w, cy - 5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(150,180,235,0.10)';
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(160,195,250,0.20)';
    ctx.lineWidth = 1;
    for (var x = cx - w - h; x < cx + w + h; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, cy - 5);
      ctx.lineTo(x + h + 5, cy - h - 6);
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(cx - w, cy - 5);
    ctx.lineTo(cx + w, cy - 5);
    ctx.strokeStyle = 'rgba(175,205,255,0.42)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /* Палитра следа: цвет зависит только от скорости груза (голубой → пурпурный),
     поэтому 32 заранее собранные строки закрывают весь диапазон, а прозрачность
     идёт через globalAlpha — в горячем цикле не рождается ни одной строки. */
  var TRAIL_PAL = (function () {
    var a = new Array(32);
    for (var i = 0; i < 32; i++) {
      var u = i / 31;
      a[i] = 'hsl(' + Math.round(196 + 132 * u) + ',100%,' + Math.round(60 + 12 * u) + '%)';
    }
    return a;
  })();

  function drawTrail() {
    var n = trail.n;
    if (n < 2) return;
    var b = trail.buf, i, k, x, y, px, py;
    var vRef = Math.sqrt(Math.max(prm.g, 0.6) * (prm.L1 + prm.L2)) * 1.9 + 0.3;

    // мягкое свечение — одной ломаной
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    for (k = 0; k < n; k++) {
      i = trail.idx(k) * 3;
      x = sx(b[i]); y = sy(b[i + 1]);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(110,190,255,0.045)';
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150,120,255,0.05)';
    ctx.lineWidth = 5;
    ctx.stroke();

    // ядро следа: цвет по скорости, прозрачность и толщина по «свежести»
    i = trail.idx(0) * 3;
    px = sx(b[i]); py = sy(b[i + 1]);
    for (k = 1; k < n; k++) {
      i = trail.idx(k) * 3;
      x = sx(b[i]); y = sy(b[i + 1]);
      var a = k / n;                       // 0 — хвост, 1 — голова
      var u = b[i + 2] / vRef;
      if (u > 1) u = 1; else if (!(u > 0)) u = 0;
      ctx.beginPath();
      ctx.moveTo(px, py); ctx.lineTo(x, y);
      ctx.strokeStyle = TRAIL_PAL[(u * 31) | 0];
      ctx.globalAlpha = 0.055 + 0.85 * a * a;
      ctx.lineWidth = 0.7 + 2.1 * a;
      ctx.stroke();
      px = x; py = y;
    }
    ctx.restore();
  }

  function drawGhostTrail() {
    var n = gtrail.n;
    if (n < 3) return;
    var b = gtrail.buf, chunks = 4, k, i, part;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (part = 0; part < chunks; part++) {
      var from = Math.floor(n * part / chunks);
      var to = Math.floor(n * (part + 1) / chunks);
      if (to - from < 2) continue;
      ctx.beginPath();
      for (k = from; k <= to && k < n; k++) {
        i = gtrail.idx(k) * 3;
        var x = sx(b[i]), y = sy(b[i + 1]);
        if (k === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(255,178,90,' + (0.05 + 0.13 * part).toFixed(3) + ')';
      ctx.lineWidth = 0.9 + 0.5 * part;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRod(x0, y0, x1, y1, c0, c1, w) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    ctx.lineCap = 'round';
    ctx.strokeStyle = g;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();

    // блик вдоль стержня
    var dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len * (w * 0.22), ny = dx / len * (w * 0.22);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(0.8, w * 0.2);
    ctx.beginPath();
    ctx.moveTo(x0 + nx, y0 + ny); ctx.lineTo(x1 + nx, y1 + ny); ctx.stroke();
  }

  function drawBob(x, y, r, hi, mid, lo, glow) {
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = r * 1.5;
    var g = ctx.createRadialGradient(x - r * 0.36, y - r * 0.4, r * 0.08, x, y, r);
    g.addColorStop(0, hi);
    g.addColorStop(0.5, mid);
    g.addColorStop(1, lo);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r - 0.5, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.34, y - r * 0.38, r * 0.24, r * 0.16, -0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGhost() {
    var p = positions(gst, gpos);
    var jx = sx(p.x1), jy = sy(p.y1), bx = sx(p.x2), by = sy(p.y2);
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,182,96,0.40)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx, cy); ctx.lineTo(jx, jy); ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(255,190,110,0.20)';
    ctx.strokeStyle = 'rgba(255,196,120,0.65)';
    ctx.lineWidth = 1.2;
    var r1 = bobR(prm.m1) * 0.5, r2 = bobR(prm.m2) * 0.55;
    ctx.beginPath(); ctx.arc(jx, jy, r1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, by, r2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  function drawPendulum() {
    var p = positions(st, pos);
    var jx = sx(p.x1), jy = sy(p.y1), bx = sx(p.x2), by = sy(p.y2);
    var r1 = bobR(prm.m1), r2 = bobR(prm.m2);

    drawRod(cx, cy, jx, jy, 'rgba(196,214,248,0.92)', 'rgba(126,214,244,0.95)',
            Math.max(3, Math.min(7, scale * 0.035)));
    drawRod(jx, jy, bx, by, 'rgba(150,206,240,0.92)', 'rgba(255,140,206,0.95)',
            Math.max(2.6, Math.min(6, scale * 0.030)));

    // ось подвеса
    ctx.fillStyle = '#0a1120';
    ctx.beginPath(); ctx.arc(cx, cy, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(190,220,255,0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, 5.5, 0, Math.PI * 2); ctx.stroke();

    drawBob(jx, jy, r1, '#f2fbff', '#8fe4ff', '#2a7fa8', 'rgba(110,220,255,0.55)');
    drawBob(bx, by, r2, '#fff0fb', '#ff9bd8', '#a63577', 'rgba(255,120,205,0.55)');
  }

  /* Мини-график расхождения: log10|Δθ| по времени, вертикаль — автомасштаб.
     Диапазон подбирается по самим данным с запасом не меньше 0,35 декады
     сверху и снизу и с округлением до половины декады, поэтому кривая
     физически не может упереться в рамку: и разгон, и полка насыщения
     (≈ 10^0,4 рад) лежат внутри поля. */
  var SPARK_CURVE = 'rgba(255,186,102,0.98)';   // цвет кривой (ищется в тестах)

  function drawSpark() {
    if (!ghostOn || W < 700 || sparkN < 3) return;

    var bw = 216, bh = 96, bx = W - bw - 16, by = 14;
    var fx = bx + 36, fy = by + 32, fw = bw - 48, fh = bh - 50;   // поле графика
    var i, v, X, Y;

    /* вертикальный диапазон по данным */
    var ymin = Infinity, ymax = -Infinity;
    for (i = 0; i < sparkN; i++) {
      v = sparkY[i];
      if (v < ymin) ymin = v;
      if (v > ymax) ymax = v;
    }
    var span = ymax - ymin;
    if (span < 1.5) {                      // почти плоские данные не растягиваем
      var mid = (ymin + ymax) * 0.5;
      ymin = mid - 0.75; ymax = mid + 0.75; span = 1.5;
    }
    var pad = Math.max(0.22 * span, 0.35);
    var yBot = Math.floor((ymin - pad) * 2) / 2;
    var yTop = Math.ceil((ymax + pad) * 2) / 2;
    var yk = fh / (yTop - yBot);

    function toY(val) {
      var y = fy + (yTop - val) * yk;
      return y < fy + 0.6 ? fy + 0.6 : (y > fy + fh - 0.6 ? fy + fh - 0.6 : y);
    }

    /* горизонталь: весь прогон с момента синхронизации призрака */
    var x0 = sparkX[0], x1 = sparkX[sparkN - 1];
    var xSpan = x1 - x0;
    if (!(xSpan > 0.5)) xSpan = 0.5;
    var xk = fw / xSpan;

    ctx.save();

    /* корпус виджета */
    ctx.fillStyle = 'rgba(12,18,32,0.66)';
    ctx.strokeStyle = 'rgba(140,175,245,0.16)';
    ctx.lineWidth = 1;
    roundRect(bx, by, bw, bh, 12);
    ctx.fill(); ctx.stroke();

    /* заголовок — отдельной строкой, поле графика ниже и не задевает его */
    ctx.font = '9.5px ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = 'rgba(168,186,218,0.9)';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('РАСХОЖДЕНИЕ С ПРИЗРАКОМ, рад', bx + 12, by + 9);

    /* поле графика */
    ctx.fillStyle = 'rgba(5,9,18,0.55)';
    ctx.strokeStyle = 'rgba(140,175,245,0.13)';
    roundRect(fx, fy, fw, fh, 5);
    ctx.fill(); ctx.stroke();

    /* сетка декад: шаг выбираем так, чтобы линий было 3–5 */
    var total = yTop - yBot;
    var estep = total <= 4 ? 1 : (total <= 9 ? 2 : 4);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.font = '8px ui-monospace, Consolas, monospace';
    var e0 = Math.ceil(yBot / estep) * estep;
    for (var e = e0; e <= yTop; e += estep) {
      var yy = fy + (yTop - e) * yk;
      if (yy < fy + 5 || yy > fy + fh - 5) continue;      // не липнем к рамке
      ctx.strokeStyle = 'rgba(140,175,245,0.10)';
      ctx.beginPath(); ctx.moveTo(fx + 1, yy); ctx.lineTo(fx + fw - 1, yy); ctx.stroke();
      ctx.fillStyle = 'rgba(150,168,200,0.72)';
      ctx.fillText('1e' + e, fx - 5, yy);
    }

    /* уровень полного расхождения (|Δθ| ~ π) — куда выходит насыщение */
    var ySat = Math.log(Math.PI) / Math.LN10;
    if (ySat > yBot && ySat < yTop) {
      var ys = fy + (yTop - ySat) * yk;
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath(); ctx.moveTo(fx + 1, ys); ctx.lineTo(fx + fw - 1, ys); ctx.stroke();
      ctx.restore();
    }

    /* заливка под кривой */
    var fillGrad = ctx.createLinearGradient(0, fy, 0, fy + fh);
    fillGrad.addColorStop(0, 'rgba(255,176,84,0.22)');
    fillGrad.addColorStop(1, 'rgba(255,150,60,0.02)');
    ctx.beginPath();
    ctx.moveTo(fx, fy + fh - 0.6);
    for (i = 0; i < sparkN; i++) {
      X = fx + (sparkX[i] - x0) * xk;
      ctx.lineTo(X, toY(sparkY[i]));
    }
    ctx.lineTo(fx + fw, fy + fh - 0.6);
    ctx.closePath();
    ctx.fillStyle = fillGrad;
    ctx.fill();

    /* сама кривая */
    ctx.beginPath();
    for (i = 0; i < sparkN; i++) {
      X = fx + (sparkX[i] - x0) * xk;
      Y = toY(sparkY[i]);
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.strokeStyle = SPARK_CURVE;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    /* голова кривой */
    X = fx + (sparkX[sparkN - 1] - x0) * xk;
    Y = toY(sparkY[sparkN - 1]);
    ctx.fillStyle = 'rgba(255,214,160,0.95)';
    ctx.beginPath(); ctx.arc(X, Y, 1.9, 0, Math.PI * 2); ctx.fill();

    /* ось времени */
    ctx.font = '8px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(140,158,190,0.7)';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('0', fx, fy + fh + 4);
    ctx.textAlign = 'right';
    // время от синхронизации призрака, а не абсолютное: призрак можно включить
    // в любой момент, и тогда график начинается заново
    ctx.fillText(Math.round(x1 - x0) + ' с', fx + fw, fy + fh + 4);

    ctx.restore();
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

  function draw() {
    drawBackground();
    drawMount();
    if (ghostOn) { drawGhostTrail(); drawGhost(); }
    if (trailOn) drawTrail();
    drawPendulum();
    drawSpark();
  }

  /* ══════════════════════════════════════════════════════════════════
     7. HUD
     ══════════════════════════════════════════════════════════════════ */

  var oTime = document.getElementById('oTime'),
      oEnergy = document.getElementById('oEnergy'),
      oDrift = document.getElementById('oDrift'),
      oDiv = document.getElementById('oDiv'),
      rowDiv = document.getElementById('rowDiv');

  function ru(x, d) { return x.toFixed(d).replace('.', ','); }
  function ruExp(x) { return x.toExponential(1).replace('.', ','); }

  var hudAcc = 0;
  function updateHud(dt) {
    hudAcc += dt;
    if (hudAcc < 0.1) return;
    hudAcc = 0;
    var E = energy(st, prm);
    var eScale = (prm.m1 + prm.m2) * Math.max(prm.g, 0.5) * prm.L1 +
                 prm.m2 * Math.max(prm.g, 0.5) * prm.L2 + 1e-9;
    var ppm = (E - E0) / eScale * 1e6;
    oTime.textContent = ru(simT, 2) + ' с';
    oEnergy.textContent = ru(E, 3) + ' Дж';
    oDrift.textContent = (Math.abs(ppm) < 0.05 ? '< 0,1' : ru(ppm, 1)) + ' ppm';
    if (ghostOn) oDiv.textContent = ruExp(separation()) + ' рад';
  }

  /* ══════════════════════════════════════════════════════════════════
     8. УПРАВЛЕНИЕ
     ══════════════════════════════════════════════════════════════════ */

  var btnPlay = document.getElementById('btnPlay'),
      btnReset = document.getElementById('btnReset'),
      btnRandom = document.getElementById('btnRandom'),
      btnGhost = document.getElementById('btnGhost'),
      btnTrail = document.getElementById('btnTrail');

  function syncPlayBtn() {
    btnPlay.textContent = running ? 'Пауза' : 'Пуск';
    btnPlay.setAttribute('aria-pressed', running ? 'true' : 'false');
  }
  function syncGhostBtn() {
    btnGhost.classList.toggle('on', ghostOn);
    btnGhost.setAttribute('aria-pressed', ghostOn ? 'true' : 'false');
    rowDiv.classList.toggle('off', !ghostOn);
  }
  function syncTrailBtn() {
    btnTrail.classList.toggle('on', trailOn);
    btnTrail.setAttribute('aria-pressed', trailOn ? 'true' : 'false');
  }

  btnPlay.addEventListener('click', function () { running = !running; syncPlayBtn(); });
  btnReset.addEventListener('click', function () { launch(); });
  btnRandom.addEventListener('click', function () { randomIC(); });
  btnGhost.addEventListener('click', function () {
    ghostOn = !ghostOn;
    if (ghostOn) syncGhost();
    syncGhostBtn();
  });
  btnTrail.addEventListener('click', function () {
    trailOn = !trailOn;
    if (!trailOn) trail.clear();
    syncTrailBtn();
  });

  /* ползунки */
  function bindSlider(id, out, apply, fmt) {
    var el = document.getElementById(id), lab = document.getElementById(out);
    function upd(fire) {
      var v = parseFloat(el.value);
      lab.textContent = fmt(v);
      if (fire) apply(v);
    }
    el.addEventListener('input', function () { upd(true); });
    upd(false);
  }

  /* Массы и g меняют энергию — переопорную точку контроля дрейфа обновляем. */
  function afterMassOrG() {
    E0 = energy(st, prm);
  }
  function afterLength() {
    layout(); makeGradients();
    trail.clear(); gtrail.clear();
    afterMassOrG();
  }

  bindSlider('sm1', 'om1', function (v) { prm.m1 = v; afterMassOrG(); },
             function (v) { return ru(v, 2) + ' кг'; });
  bindSlider('sm2', 'om2', function (v) { prm.m2 = v; afterMassOrG(); },
             function (v) { return ru(v, 2) + ' кг'; });
  bindSlider('sL1', 'oL1', function (v) { prm.L1 = v; afterLength(); },
             function (v) { return ru(v, 2) + ' м'; });
  bindSlider('sL2', 'oL2', function (v) { prm.L2 = v; afterLength(); },
             function (v) { return ru(v, 2) + ' м'; });
  bindSlider('sg', 'og', function (v) { prm.g = v; afterMassOrG(); },
             function (v) { return ru(v, 2) + ' м/с²'; });
  bindSlider('seps', 'oeps', function (v) { eps = Math.pow(10, v); syncGhost(); },
             function (v) { return ruExp(Math.pow(10, v)) + ' рад'; });

  /* клавиатура */
  global.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'BUTTON') return;            // пробел/Enter активируют саму кнопку
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.code !== 'Space') return;        // стрелки остаются ползунку
    }
    var k = e.code;
    if (k === 'Space') { e.preventDefault(); running = !running; syncPlayBtn(); }
    else if (k === 'KeyR') { launch(); }
    else if (k === 'KeyN') { randomIC(); }
    else if (k === 'KeyG') { ghostOn = !ghostOn; if (ghostOn) syncGhost(); syncGhostBtn(); }
    else if (k === 'KeyT') { trailOn = !trailOn; if (!trailOn) trail.clear(); syncTrailBtn(); }
  });

  /* перетаскивание грузов мышью/пальцем */
  var drag = 0, wasRunning = true, cursor = 'crosshair';

  function setCursor(c) {
    if (c !== cursor) { cursor = c; cv.style.cursor = c; }
  }

  function pick(px, py) {
    var p = positions(st, pos);
    var jx = sx(p.x1), jy = sy(p.y1), bx = sx(p.x2), by = sy(p.y2);
    var d2 = Math.hypot(px - bx, py - by), d1 = Math.hypot(px - jx, py - jy);
    var t2 = Math.max(bobR(prm.m2) + 16, 26), t1 = Math.max(bobR(prm.m1) + 16, 26);
    if (d2 <= t2 && d2 <= d1) return 2;
    if (d1 <= t1) return 1;
    return 0;
  }

  cv.addEventListener('pointerdown', function (e) {
    var hit = pick(e.clientX, e.clientY);
    if (!hit) return;
    drag = hit;
    wasRunning = running;
    st[1] = 0; st[3] = 0;
    if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
    e.preventDefault();
  });

  cv.addEventListener('pointermove', function (e) {
    if (!drag) {
      setCursor(pick(e.clientX, e.clientY) ? 'grab' : 'crosshair');
      return;
    }
    setCursor('grabbing');
    if (drag === 1) {
      st[0] = Math.atan2(e.clientX - cx, e.clientY - cy);
    } else {
      var p = positions(st, pos);
      st[2] = Math.atan2(e.clientX - sx(p.x1), e.clientY - sy(p.y1));
    }
    st[1] = 0; st[3] = 0;
    e.preventDefault();
  });

  function endDrag(e) {
    if (!drag) return;
    drag = 0;
    setCursor('crosshair');
    IC[0] = st[0]; IC[1] = 0; IC[2] = st[2]; IC[3] = 0;
    launch();
    running = wasRunning;
    syncPlayBtn();
    if (e && cv.releasePointerCapture) {
      try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
    }
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  /* ══════════════════════════════════════════════════════════════════
     9. ЦИКЛ
     ══════════════════════════════════════════════════════════════════ */

  function frame(now) {
    var dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;

    if (running && !drag) advance(dt);
    draw();
    updateHud(dt || 0.016);
    global.requestAnimationFrame(frame);
  }

  global.addEventListener('resize', function () { resize(); });
  if (global.visualViewport) {
    global.visualViewport.addEventListener('resize', function () { resize(); });
  }

  resize();
  launch();
  syncPlayBtn(); syncGhostBtn(); syncTrailBtn();
  global.requestAnimationFrame(frame);

})(typeof window !== 'undefined' ? window : globalThis);
