/* Идущий человечек — процедурная походка на Canvas 2D.
 * Ядро (гейт + ИК) — чистые функции, без DOM: их можно прогнать в node.
 * Единица длины во всём ядре — длина ноги (бедро + голень) = 1.
 */
(function (root) {
  'use strict';

  /* ==================== математика ==================== */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function frac(x) { return x - Math.floor(x); }
  function hash(n) { var s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

  /* ==================== пропорции скелета (в длинах ноги) ==================== */
  var B = {
    thigh: 0.50, shin: 0.50,      // бедро / голень
    ankle: 0.07,                  // высота лодыжки над землёй
    heel: 0.10, toe: 0.17, sole: 0.07,
    torso: 0.62,                  // таз -> плечо
    neck: 0.075, head: 0.115,
    upper: 0.30, fore: 0.28       // плечо / предплечье
  };

  /* ==================== настройки походки ==================== */
  var G = {
    vMin: 0.60, vMax: 4.00,       // скорость, длин ноги в секунду
    fMin: 0.62, fMax: 1.80,       // частота циклов (1 цикл = 2 шага), Гц
    dMax: 0.66, dMin: 0.34,       // доля опоры в цикле: шаг -> бег
    ease: 0.22,                   // доля переноса на разгон/торможение стопы
    reach: 0.985,                 // предельная относительная длина ноги (нога никогда не прямая)
    margin: 0.012
  };

  /* Горизонтальный профиль переноса: трапеция по скорости — стопа плавно
   * разгоняется, идёт с постоянной скоростью, плавно тормозит.
   * g'(0) = g'(1) = 0  =>  мировая скорость стопы в момент отрыва и в момент
   * касания ровно нулевая: нет ни рывка, ни проскальзывания на стыке фаз.
   * Плоская середина держит стопу ближе к тазу, чем ease-кривая, — иначе в
   * конце переноса нога вылезает за G.reach и ИК начинает зажимать стопу. */
  function swingG(u) {
    var e = G.ease, n = 1 - e, x;
    u = clamp(u, 0, 1);
    if (u < e) { x = u / e; return e * (x * x * x - 0.5 * x * x * x * x) / n; }
    if (u > 1 - e) { x = (1 - u) / e; return (n - e * (x * x * x - 0.5 * x * x * x * x)) / n; }
    return (u - 0.5 * e) / n;
  }

  // Все параметры походки — гладкие функции одного ползунка u.
  function gaitParams(u) {
    u = clamp(u, 0, 1);
    var v = G.vMin + (G.vMax - G.vMin) * Math.pow(u, 1.15);
    var f = G.fMin + (G.fMax - G.fMin) * Math.pow(u, 0.85);
    var D = G.dMax - (G.dMax - G.dMin) * Math.pow(u, 0.9);
    var run = clamp((0.5 - D) / (0.5 - G.dMin), 0, 1);  // 0 — ходьба, 1 — бег
    var L = v / f;
    var fFwd = lerp(0.50, 0.44, run);      // доля опорного хода впереди таза
    var aFwd = fFwd * D * L, aBack = (1 - fFwd) * D * L;
    var bobW = 0.050, bobR = 0.085;
    // Потолок высоты таза: на краях опоры (касание/отрыв) нога вытянута сильнее
    // всего. Считаем предел заранее — тогда геометрическое ограничение в
    // hipState() ни разу не срабатывает и вертикаль таза остаётся гладкой.
    var cE = Math.cos(2 * Math.PI * D);
    var crouchExt = (1 - run) * bobW * (1 - cE) / 2 + run * bobR * (1 + cE) / 2;
    var aMax = Math.max(aFwd, aBack);
    var cap = Math.sqrt(Math.max(0.01, G.reach * G.reach - aMax * aMax)) - G.margin + crouchExt;
    return {
      u: u, v: v, f: f, D: D, L: L, run: run,
      fFwd: fFwd, aFwd: aFwd, aBack: aBack,
      lift: lerp(0.11, 0.34, run) + 0.03 * u,
      kick: 0.13,                           // захлёст пятки назад в начале переноса (бег)
      hip0: Math.min(lerp(0.955, 0.895, run), cap),   // высота таза над лодыжкой
      bobW: bobW, bobR: bobR,               // амплитуды вертикального покачивания
      lean: 0.05 + 0.20 * Math.pow(u, 1.1), // наклон корпуса вперёд, рад
      armK: 0.70 + 0.40 * run,              // размах рук относительно размаха ног
      elbow: 0.32 + 1.15 * run + 0.18 * u   // сгиб локтя
    };
  }

  // Пик подъёма на ~38% переноса, пологий заход на постановку: иначе в конце
  // переноса нога вытягивается сверх G.reach и ИК начинает зажимать стопу.
  function liftShape(u) { return Math.pow(Math.sin(Math.PI * Math.pow(clamp(u, 0, 1), 0.72)), 0.85); }
  function kickBump(u) { var s = Math.sin(Math.PI * clamp(u / 0.6, 0, 1)); return s * s; }

  /* Насколько низшая точка подошвы (пятка или носок) опущена под лодыжку при
   * данном угле стопы. При плоской стопе это ровно B.ankle. Нужно, чтобы при
   * перекате «пятка -> плоско -> носок» подошва не проваливалась под землю:
   * лодыжка приподнимается на разницу — это и есть отрыв пятки. */
  function footDepth(ang) {
    var c = Math.cos(ang), s = Math.sin(ang);
    return Math.max(B.heel * s + B.sole * c, -B.toe * s + B.sole * c);
  }

  // Угол стопы: + носок вверх. Опора: удар пяткой -> плоско -> отрыв через носок.
  function footAngle(st, P) {
    var touch = lerp(0.22, 0.03, P.run);
    var push = lerp(0.48, 0.42, P.run);
    if (st.stance) {
      return touch * (1 - smoothstep(st.sp / 0.22)) - push * smoothstep((st.sp - 0.55) / 0.45);
    }
    var a = lerp(-push, 0.30, smoothstep(st.u / 0.40));
    return lerp(a, touch, smoothstep((st.u - 0.40) / 0.60));
  }

  /* ==================== состояние ==================== */
  function createWalker(u) {
    var w = {
      phase: 0,            // накопленные циклы походки
      camX: 0,             // мировая координата таза (единицы = длина ноги)
      speedU: u, targetU: u,
      t: 0,
      legs: [{ off: 0.0, p: 0.0, plantX: 0, sw: false, p0: 0 },
             { off: 0.5, p: 0.5, plantX: 0, sw: false, p0: 0 }],
      prints: [],          // следы: где стопа реально стояла
      plants: 0            // счётчик касаний (для пыли в рендере)
    };
    var P = gaitParams(w.speedU);
    for (var i = 0; i < 2; i++) {
      var leg = w.legs[i];
      leg.p = frac(leg.off);
      leg.plantX = w.camX - leg.p * P.L + P.aFwd;
      leg.sw = leg.p >= P.D;
      leg.p0 = P.D;
    }
    return w;
  }

  function step(w, dt) {
    // скорость догоняет ползунок -> характер походки меняется плавно
    if (dt > 0) w.speedU += (w.targetU - w.speedU) * (1 - Math.exp(-dt / 0.28));
    var P = gaitParams(w.speedU);
    w.t += dt;
    w.phase += P.f * dt;
    w.camX += P.v * dt;
    for (var i = 0; i < 2; i++) {
      var leg = w.legs[i];
      var p = frac(w.phase + leg.off);
      if (p < leg.p) {
        // Касание опоры произошло p/f секунд назад — откатываем таз ровно туда,
        // иначе точка постановки прыгала бы на v*dt при смене фазы.
        leg.plantX = w.camX - p * P.L + P.aFwd;
        leg.sw = false;
        w.plants++;
        w.prints.push({ x: leg.plantX, side: i, t: w.t });
        if (w.prints.length > 48) w.prints.shift();
      }
      // Фаза переносится защёлкой: начавшийся перенос завершается только
      // касанием. Иначе рост D при замедлении вернул бы летящую ногу в опору —
      // стопа телепортировалась бы обратно на старую точку постановки.
      // Второе условие — страховка на резкий рывок ползунка: если таз уехал так
      // далеко, что опорную ногу уже не хватает, нога отрывается досрочно.
      // Иначе ИК зажал бы стопу и она бы поехала по земле.
      if (!leg.sw && (p >= P.D || Math.abs(leg.plantX - w.camX) > G.reach * 0.93)) {
        leg.sw = true;
        // В норме отсчёт переноса ведём ровно от D (дискретный кадр даёт перелёт
        // фазы, из-за него перенос сжимался и нога вылезала за G.reach).
        // В резком переходном режиме — не дальше 0.06 фазы назад, чтобы стопа
        // не прыгнула вперёд при досрочном отрыве.
        leg.p0 = Math.max(P.D, p - 0.06);
      }
      leg.p = p;
    }
    return P;
  }

  /* Положение стопы (лодыжки) в мировых координатах.
   * Фаза опоры: x строго равен точке постановки — нулевое проскальзывание.
   * Фаза переноса: гладкий выход на будущую точку постановки, к моменту касания
   * мировая скорость стопы уже равна нулю (нет «щелчка» при касании). */
  function footState(w, P, i) {
    var leg = w.legs[i], p = leg.p, st;
    if (!leg.sw) {
      st = { x: leg.plantX, h: 0, stance: true, sp: clamp(p / P.D, 0, 1), u: 0 };
    } else {
      var u = clamp((p - leg.p0) / (1 - leg.p0), 0, 1);
      var target = w.camX + P.L * (1 - p) + P.aFwd;   // предсказание точки касания
      st = {
        x: leg.plantX + (target - leg.plantX) * swingG(u) - P.run * P.kick * kickBump(u),
        h: P.lift * liftShape(u), stance: false, sp: 0, u: u
      };
    }
    st.ang = footAngle(st, P);
    // Лодыжка приподнимается ровно настолько, чтобы подошва касалась земли и не
    // уходила под неё. По горизонтали лодыжка при этом не двигается — опорная
    // стопа остаётся прибитой к земле. Побочный эффект в опоре — только меньшая
    // длина ноги, то есть ограничение досягаемости не нарушается.
    st.h = Math.max(st.h, footDepth(st.ang) - B.ankle);
    return st;
  }

  /* Высота таза: покачивание (в ходьбе выше всего в середине опоры, в беге —
   * наоборот, ниже) плюс жёсткое геометрическое ограничение: таз не может быть
   * выше, чем позволяет длина опорной ноги. Именно это ограничение и не даёт
   * стопе оторваться от точки постановки. */
  function hipState(w, P, feet) {
    var phi = frac(w.phase);
    var c = Math.cos(4 * Math.PI * (phi - P.D / 2));
    var bob = (1 - P.run) * P.bobW * (1 - c) / 2 + P.run * P.bobR * (1 + c) / 2;
    var y = P.hip0 - bob;
    for (var i = 0; i < 2; i++) {
      if (!feet[i].stance) continue;
      var dx = Math.min(Math.abs(feet[i].x - w.camX), G.reach * 0.999);
      y = Math.min(y, feet[i].h + Math.sqrt(G.reach * G.reach - dx * dx));
    }
    return { x: w.camX, y: y, bob: bob, phi: phi };
  }

  function buildPose(w, P) {
    var feet = [footState(w, P, 0), footState(w, P, 1)];
    var hip = hipState(w, P, feet);
    var legAng = [0, 0], arm = [0, 0], i;
    // В установившемся режиме нога до предела не дотягивается (проверено численно),
    // но при мгновенном рывке ползунка переносимая нога может вылезти за G.reach.
    // Тогда подтягиваем стопу вверх — колено сгибается, нога не «резинится».
    for (i = 0; i < 2; i++) {
      var ft = feet[i];
      if (ft.stance) continue;
      var dx = ft.x - hip.x, mx = G.reach * 0.999;
      if (Math.abs(dx) > mx) { dx = dx > 0 ? mx : -mx; ft.x = hip.x + dx; }
      var minH = hip.y - Math.sqrt(G.reach * G.reach - dx * dx);
      if (ft.h < minH) ft.h = minH;
    }
    for (i = 0; i < 2; i++) {
      legAng[i] = Math.atan2(feet[i].x - hip.x, Math.max(0.05, hip.y - feet[i].h));
    }
    var lean = P.lean + 0.022 * Math.sin(4 * Math.PI * (hip.phi - P.D / 2));
    // Рука в противофазе своей же ноге. Центр размаха уносится наклоном корпуса
    // лишь наполовину — иначе на беге весь размах уезжает вперёд и рука почти
    // не уходит за спину.
    for (i = 0; i < 2; i++) arm[i] = lean * 0.5 - P.armK * legAng[i];
    return { P: P, feet: feet, hip: hip, legAng: legAng, lean: lean, arm: arm };
  }

  /* Двухзвенная ИК: колено выносится вперёд (sign = +1). */
  function ik2(ax, ay, bx, by, l1, l2, sign) {
    var dx = bx - ax, dy = by - ay, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) { dx = 0; dy = 1e-6; d = 1e-6; }
    var dc = clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
    var ux = dx / d, uy = dy / d;
    var t = (dc * dc + l1 * l1 - l2 * l2) / (2 * dc);
    var h = Math.sqrt(Math.max(0, l1 * l1 - t * t));
    return {
      jx: ax + ux * t + uy * sign * h,
      jy: ay + uy * t - ux * sign * h,
      ex: ax + ux * dc, ey: ay + uy * dc,
      over: d > l1 + l2
    };
  }

  var Core = {
    clamp: clamp, lerp: lerp, smoothstep: smoothstep, swingG: swingG,
    frac: frac, hash: hash, liftShape: liftShape, kickBump: kickBump,
    B: B, G: G, gaitParams: gaitParams, createWalker: createWalker, step: step,
    footState: footState, hipState: hipState, buildPose: buildPose, ik2: ik2
  };
  if (typeof module === 'object' && module.exports) module.exports = Core;
  root.WalkerCore = Core;
  if (typeof document === 'undefined') return;   // node: дальше только рендер

  /* ==================================================================== */
  /* ============================== РЕНДЕР ============================== */
  /* ==================================================================== */

  var canvas = document.getElementById('c');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var elSpeed = document.getElementById('speed');
  var elKmh = document.getElementById('kmh');
  var elRead = document.getElementById('readout');
  var btnPause = document.getElementById('btnPause');
  var btnSlow = document.getElementById('btnSlow');
  var btnSkel = document.getElementById('btnSkel');
  var btnPrints = document.getElementById('btnPrints');

  var W = 1, H = 1, dpr = 1, LG = 100, charX = 0, groundY = 0, skyGrad = null, groundGrad = null;
  var startU = elSpeed ? clamp(parseFloat(elSpeed.value) || 0, 0, 1) : 0.22;
  var w = createWalker(startU);
  var paused = false, slowMo = false, showSkel = false, showPrints = true;
  var dust = [], lastPlants = w.plants, last = 0;

  var CH = {
    near: '#eef6ff', far: 'rgba(150,186,220,0.55)',
    torso: '#f4faff', glow: 'rgba(120,196,255,0.55)', warm: '#ffc98a'
  };

  function layout() {
    dpr = Math.min(2, root.devicePixelRatio || 1);
    W = Math.max(1, root.innerWidth || document.documentElement.clientWidth || 800);
    H = Math.max(1, root.innerHeight || document.documentElement.clientHeight || 600);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    groundY = Math.round(Math.max(H * 0.55, Math.min(H * 0.80, H - 150)));
    LG = Math.min(H * 0.25, W * 0.19);
    var minTop = Math.max(96, H * 0.13);
    if (groundY - 2.05 * LG < minTop) LG = (groundY - minTop) / 2.05;
    LG = Math.max(26, LG);
    charX = Math.round(W * 0.42);

    skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
    skyGrad.addColorStop(0.00, '#05070f');
    skyGrad.addColorStop(0.40, '#0b1428');
    skyGrad.addColorStop(0.78, '#182644');
    skyGrad.addColorStop(1.00, '#2a3350');
    groundGrad = ctx.createLinearGradient(0, groundY, 0, H);
    groundGrad.addColorStop(0, '#0a1220');
    groundGrad.addColorStop(1, '#03060c');
  }

  // мир -> экран
  function sx(X) { return charX + (X - w.camX) * LG; }
  function sy(Y) { return groundY - (B.ankle + Y) * LG; }
  function sxp(X, k) { return charX + (X - w.camX * k) * LG; }

  /* ---------------------------- фон ---------------------------- */
  function ridge(k, seed, baseY, amp, freq, color) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    var stepPx = 9;
    for (var x = 0; x <= W + stepPx; x += stepPx) {
      var wx = (x - charX) / LG + w.camX * k;
      var y = baseY - amp * (0.55 * Math.sin(wx * freq + seed) +
                             0.30 * Math.sin(wx * freq * 0.41 + seed * 2.3) +
                             0.15 * Math.sin(wx * freq * 0.19 + seed * 4.1));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawSky() {
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, groundY + 1);

    // звёзды
    var n = 90;
    for (var i = 0; i < n; i++) {
      var hx = hash(i * 1.7), hy = hash(i * 3.3 + 5);
      var x = hx * W, y = hy * hy * groundY * 0.82;
      var a = (0.16 + 0.42 * hash(i * 5.1)) * (1 - y / (groundY * 0.95));
      if (a <= 0.01) continue;
      ctx.fillStyle = 'rgba(220,236,255,' + a.toFixed(3) + ')';
      ctx.fillRect(x, y, 1.2, 1.2);
    }

    // луна с гало
    var mx = W * 0.78, my = groundY - 1.95 * LG, mr = 0.42 * LG;
    var halo = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 6.5);
    halo.addColorStop(0, 'rgba(255,206,148,0.26)');
    halo.addColorStop(0.35, 'rgba(255,186,124,0.09)');
    halo.addColorStop(1, 'rgba(255,180,120,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(mx - mr * 7, my - mr * 7, mr * 14, mr * 14);
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe0b4';
    ctx.fill();

    ridge(0.05, 1.3, groundY + 0.02 * LG, 1.10 * LG, 0.30, '#16223c');
    ridge(0.14, 4.7, groundY + 0.02 * LG, 0.60 * LG, 0.62, '#0f1a2e');
    ridge(0.30, 9.1, groundY + 0.03 * LG, 0.28 * LG, 1.15, '#0a1120');
    drawTrees(0.55);
  }

  function drawTrees(k) {
    var x0 = w.camX * k + (0 - charX) / LG, x1 = w.camX * k + (W - charX) / LG;
    var sp = 3.1;
    var i0 = Math.floor(x0 / sp) - 1, i1 = Math.ceil(x1 / sp) + 1;
    ctx.fillStyle = '#070d18';
    for (var i = i0; i <= i1; i++) {
      var h1 = hash(i * 2.13);
      if (h1 < 0.34) continue;
      var wx = i * sp + hash(i * 7.7) * 2.0;
      var x = sxp(wx, k);
      var hgt = (0.42 + 0.55 * hash(i * 4.4)) * LG;
      var bw = hgt * 0.28;
      var by = groundY - 0.03 * LG;
      ctx.beginPath();
      ctx.moveTo(x, by - hgt);
      ctx.lineTo(x + bw, by);
      ctx.lineTo(x - bw, by);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - bw * 0.12, by - 2, bw * 0.24, 0.09 * LG);
    }
  }

  function drawGround() {
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, groundY, W, H - groundY);

    ctx.strokeStyle = 'rgba(126,190,225,0.42)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, groundY + 0.7);
    ctx.lineTo(W, groundY + 0.7);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,196,138,0.14)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(0, groundY + 3);
    ctx.lineTo(W, groundY + 3);
    ctx.stroke();

    // риски: видно, что земля едет
    var x0 = w.camX + (0 - charX) / LG, x1 = w.camX + (W - charX) / LG;
    var i0 = Math.floor(x0 / 0.5) - 1, i1 = Math.ceil(x1 / 0.5) + 1;
    ctx.lineWidth = 1;
    for (var i = i0; i <= i1; i++) {
      var major = (i % 4 === 0);
      var x = Math.round(sx(i * 0.5)) + 0.5;
      ctx.strokeStyle = major ? 'rgba(160,212,240,0.34)' : 'rgba(150,196,230,0.15)';
      ctx.beginPath();
      ctx.moveTo(x, groundY + 5);
      ctx.lineTo(x, groundY + (major ? 15 : 8));
      ctx.stroke();
    }

    // камешки
    var gh = H - groundY;
    var k0 = Math.floor(x0 / 0.33) - 1, k1 = Math.ceil(x1 / 0.33) + 1;
    for (var kk = k0; kk <= k1; kk++) {
      var hp = hash(kk * 1.31);
      if (hp < 0.45) continue;
      var wx = kk * 0.33 + hash(kk * 9.7) * 0.3;
      var py = groundY + 8 + hash(kk * 3.9) * gh * 0.45;
      var r = 0.9 + hash(kk * 5.5) * 2.0;
      ctx.fillStyle = 'rgba(140,178,212,' + (0.06 + 0.10 * hash(kk * 6.1)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(sx(wx), py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawForeground() {
    var k = 1.85, gh = H - groundY;
    if (gh < 40) return;
    var x0 = w.camX * k + (0 - charX) / LG, x1 = w.camX * k + (W - charX) / LG;
    var i0 = Math.floor(x0 / 0.6) - 1, i1 = Math.ceil(x1 / 0.6) + 1;
    ctx.fillStyle = 'rgba(3,6,12,0.85)';
    for (var i = i0; i <= i1; i++) {
      if (hash(i * 2.7) < 0.4) continue;
      var x = sxp(i * 0.6 + hash(i * 8.2) * 0.5, k);
      var ww = 26 + hash(i * 4.1) * 70;
      var y = H - gh * 0.20 * hash(i * 6.6) - 3;
      ctx.fillRect(x, y, ww, 2 + hash(i * 3.2) * 2);
    }
  }

  /* ---------------------------- следы и пыль ---------------------------- */
  function drawPrints() {
    if (!showPrints) return;
    for (var i = 0; i < w.prints.length; i++) {
      var p = w.prints[i];
      var x = sx(p.x);
      if (x < -40 || x > W + 40) continue;
      var age = w.t - p.t;
      var a = clamp(1 - age / 6, 0, 1) * 0.55;
      if (a <= 0.01) continue;
      ctx.fillStyle = p.side === 0
        ? 'rgba(255,190,128,' + a.toFixed(3) + ')'
        : 'rgba(140,205,235,' + (a * 0.8).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(x + 0.03 * LG, groundY + 1.5, 0.10 * LG, 0.022 * LG, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function spawnDust(px, amount) {
    var n = Math.round(2 + amount * 6);
    for (var i = 0; i < n; i++) {
      dust.push({
        x: px + (Math.random() - 0.5) * 0.12,
        y: 0.01 + Math.random() * 0.03,
        vx: -(0.10 + Math.random() * 0.55) * (0.4 + amount),
        vy: (0.10 + Math.random() * 0.45) * (0.4 + amount),
        life: 0, max: 0.45 + Math.random() * 0.5,
        r: 0.012 + Math.random() * 0.03
      });
    }
    if (dust.length > 160) dust.splice(0, dust.length - 160);
  }

  function updateDust(dt) {
    for (var i = dust.length - 1; i >= 0; i--) {
      var d = dust[i];
      d.life += dt;
      if (d.life > d.max) { dust.splice(i, 1); continue; }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy -= 1.1 * dt;
      d.vx *= (1 - 1.6 * dt);
      if (d.y < 0) { d.y = 0; d.vy = 0; }
    }
  }

  function drawDust() {
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i];
      var a = (1 - d.life / d.max) * 0.30;
      ctx.fillStyle = 'rgba(196,216,238,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(sx(d.x), sy(d.y) + B.ankle * LG, d.r * LG * (0.6 + d.life / d.max), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------------------------- фигура ---------------------------- */
  function rot(px, py, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return { x: px * c + py * s, y: -px * s + py * c };
  }

  function seg(x1, y1, x2, y2, lw, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function legGeom(pose, i, hx, hy) {
    var ft = pose.feet[i];
    var fx = sx(ft.x), fy = sy(ft.h);
    var k = ik2(hx, hy, fx, fy, B.thigh * LG, B.shin * LG, 1);
    var heel = rot(-B.heel * LG, B.sole * LG, ft.ang);
    var toe = rot(B.toe * LG, B.sole * LG, ft.ang);
    return {
      kx: k.jx, ky: k.jy, ax: k.ex, ay: k.ey, ft: ft,
      hx: k.ex + heel.x, hy2: k.ey + heel.y,
      tx: k.ex + toe.x, ty: k.ey + toe.y
    };
  }

  function drawLeg(g, color, lw, hipX, hipY) {
    seg(hipX, hipY, g.kx, g.ky, lw, color);          // бедро
    seg(g.kx, g.ky, g.ax, g.ay, lw, color);          // голень
    seg(g.hx, g.hy2, g.tx, g.ty, lw * 0.85, color);  // стопа: пятка -> носок
    seg(g.ax, g.ay, g.tx, g.ty, lw * 0.85, color);   // лодыжка -> носок
  }

  function drawArm(sxp0, syp0, ang, flex, color, lw) {
    var ex = sxp0 + Math.sin(ang) * B.upper * LG;
    var ey = syp0 + Math.cos(ang) * B.upper * LG;
    var a2 = ang + flex;
    var wx = ex + Math.sin(a2) * B.fore * LG;
    var wy = ey + Math.cos(a2) * B.fore * LG;
    seg(sxp0, syp0, ex, ey, lw, color);
    seg(ex, ey, wx, wy, lw * 0.92, color);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(wx, wy, lw * 0.52, 0, Math.PI * 2);
    ctx.fill();
    return { ex: ex, ey: ey, wx: wx, wy: wy };
  }

  function drawFigure(pose) {
    var P = pose.P;
    var hx = sx(pose.hip.x), hy = sy(pose.hip.y);
    var lean = pose.lean;
    var shx = hx + Math.sin(lean) * B.torso * LG;
    var shy = hy - Math.cos(lean) * B.torso * LG;
    var ha = lean * 0.42;
    var nx = shx + Math.sin(ha) * B.neck * LG, ny = shy - Math.cos(ha) * B.neck * LG;
    var hdx = nx + Math.sin(ha) * B.head * LG, hdy = ny - Math.cos(ha) * B.head * LG;

    var lw = 0.055 * LG, lwT = 0.095 * LG;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var g0 = legGeom(pose, 0, hx, hy), g1 = legGeom(pose, 1, hx, hy);

    // дальняя половина тела
    ctx.save();
    ctx.globalAlpha = 1;
    drawArm(shx, shy, pose.arm[1], P.elbow, CH.far, lw * 0.86);
    drawLeg(g1, CH.far, lw * 0.88, hx, hy);
    ctx.restore();

    // корпус, шея, голова — со свечением
    ctx.save();
    ctx.shadowColor = CH.glow;
    ctx.shadowBlur = 0.13 * LG;
    seg(hx, hy, shx, shy, lwT, CH.torso);
    seg(shx, shy, nx, ny, lw * 0.8, CH.torso);
    ctx.beginPath();
    ctx.arc(hdx, hdy, B.head * LG, 0, Math.PI * 2);
    ctx.fillStyle = CH.torso;
    ctx.fill();
    ctx.restore();

    // тёплый контровой блик от луны
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = CH.warm;
    ctx.lineWidth = lw * 0.30;
    ctx.beginPath();
    ctx.arc(hdx, hdy, B.head * LG - lw * 0.15, -1.5, 0.55);
    ctx.stroke();
    ctx.restore();

    // ближняя половина
    ctx.save();
    ctx.shadowColor = CH.glow;
    ctx.shadowBlur = 0.10 * LG;
    drawLeg(g0, CH.near, lw, hx, hy);
    drawArm(shx, shy, pose.arm[0], P.elbow, CH.near, lw * 0.9);
    ctx.restore();

    // суставы
    ctx.fillStyle = 'rgba(20,34,54,0.9)';
    var joints = [[hx, hy, lw * 0.42], [shx, shy, lw * 0.40], [g0.kx, g0.ky, lw * 0.34]];
    for (var i = 0; i < joints.length; i++) {
      ctx.beginPath();
      ctx.arc(joints[i][0], joints[i][1], joints[i][2], 0, Math.PI * 2);
      ctx.fill();
    }

    // подсветка контакта: стопа стоит — светится земля под ней
    for (i = 0; i < 2; i++) {
      var ft = pose.feet[i];
      if (!ft.stance) continue;
      var cx = sx(ft.x);
      var a = 0.35 * (1 - Math.abs(ft.sp - 0.5) * 0.6);
      ctx.strokeStyle = 'rgba(255,205,150,' + a.toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 0.13 * LG, groundY + 1);
      ctx.lineTo(cx + 0.19 * LG, groundY + 1);
      ctx.stroke();
    }

    if (showSkel) drawSkeleton(pose, hx, hy, g0, g1);
  }

  function drawShadows(pose) {
    for (var i = 0; i < 2; i++) {
      var ft = pose.feet[i];
      var t = clamp(1 - ft.h / 0.45, 0, 1);
      if (t <= 0.02) continue;
      ctx.fillStyle = 'rgba(0,0,0,' + (0.34 * t).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(sx(ft.x) + 0.03 * LG, groundY + 2, 0.20 * LG * (1 + ft.h), 0.035 * LG, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(sx(pose.hip.x), groundY + 3, 0.42 * LG, 0.05 * LG, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSkeleton(pose, hx, hy, g0, g1) {
    var P = pose.P;
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(127,208,230,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hx, hy, G.reach * LG, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // траектория переносимой стопы + отметка будущей постановки
    for (var i = 0; i < 2; i++) {
      var leg = w.legs[i];
      if (!leg.sw) continue;
      var target = w.camX + P.L * (1 - leg.p) + P.aFwd;
      ctx.strokeStyle = 'rgba(255,201,138,0.5)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var k = 0; k <= 30; k++) {
        var u = k / 30;
        var x = leg.plantX + (target - leg.plantX) * swingG(u) - P.run * P.kick * kickBump(u);
        var ang = footAngle({ stance: false, u: u, sp: 0 }, P);
        var yy = sy(Math.max(P.lift * liftShape(u), footDepth(ang) - B.ankle));
        if (k === 0) ctx.moveTo(sx(x), yy); else ctx.lineTo(sx(x), yy);
      }
      ctx.stroke();
      var tx = sx(target);
      ctx.strokeStyle = 'rgba(255,201,138,0.85)';
      ctx.beginPath();
      ctx.moveTo(tx - 6, groundY - 6); ctx.lineTo(tx + 6, groundY + 6);
      ctx.moveTo(tx + 6, groundY - 6); ctx.lineTo(tx - 6, groundY + 6);
      ctx.stroke();
    }

    // суставы
    var pts = [[hx, hy], [g0.kx, g0.ky], [g0.ax, g0.ay], [g1.kx, g1.ky], [g1.ax, g1.ay]];
    ctx.fillStyle = 'rgba(127,208,230,0.95)';
    for (i = 0; i < pts.length; i++) {
      ctx.beginPath();
      ctx.arc(pts[i][0], pts[i][1], 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // подписи фаз
    ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    for (i = 0; i < 2; i++) {
      var ft = pose.feet[i];
      var lx = sx(ft.x), ly = sy(ft.h) - 14;
      var txt = ft.stance ? 'опора' : 'перенос';
      ctx.fillStyle = 'rgba(6,12,22,0.75)';
      var tw = ctx.measureText(txt).width + 10;
      ctx.fillRect(lx - tw / 2, ly - 11, tw, 15);
      ctx.fillStyle = ft.stance ? '#ffc98a' : '#9fdcf0';
      ctx.fillText(txt, lx, ly);
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /* ---------------------------- диаграмма фаз ---------------------------- */
  function roundRect(x, y, ww, hh, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + ww - r, y);
    ctx.quadraticCurveTo(x + ww, y, x + ww, y + r);
    ctx.lineTo(x + ww, y + hh - r);
    ctx.quadraticCurveTo(x + ww, y + hh, x + ww - r, y + hh);
    ctx.lineTo(x + r, y + hh);
    ctx.quadraticCurveTo(x, y + hh, x, y + hh - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawGaitChart(pose) {
    if (W < 620) return;
    var bw = 186, bh = 62, bx = W - bw - 16, by = 16;
    roundRect(bx, by, bw, bh, 12);
    ctx.fillStyle = 'rgba(9,15,26,0.66)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,200,240,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '600 10px system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = 'rgba(170,195,220,0.75)';
    ctx.fillText('ЦИКЛ ПОХОДКИ', bx + 12, by + 15);

    var D = pose.P.D, phi = pose.hip.phi;
    var tx0 = bx + 26, tx1 = bx + bw - 12, tw = tx1 - tx0;
    for (var i = 0; i < 2; i++) {
      var ty = by + 30 + i * 15;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(tx0, ty, tw, 8);
      ctx.fillStyle = i === 0 ? 'rgba(255,201,138,0.85)' : 'rgba(140,205,235,0.7)';
      var st = i === 0 ? 0 : 0.5;
      var a = st, b = st + D;
      ctx.fillRect(tx0 + a * tw, ty, Math.min(b, 1) * tw - a * tw, 8);
      if (b > 1) ctx.fillRect(tx0, ty, (b - 1) * tw, 8);
      ctx.fillStyle = 'rgba(190,212,235,0.85)';
      ctx.fillText(i === 0 ? 'П' : 'Л', bx + 12, ty + 8);
    }
    var px = tx0 + phi * tw;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, by + 26);
    ctx.lineTo(px, by + 55);
    ctx.stroke();
  }

  /* ---------------------------- интерфейс ---------------------------- */
  function setOn(btn, on) { if (btn) btn.className = on ? 'on' : ''; }

  if (elSpeed) {
    elSpeed.addEventListener('input', function () {
      w.targetU = clamp(parseFloat(elSpeed.value) || 0, 0, 1);
    });
  }
  if (btnPause) btnPause.addEventListener('click', function () {
    paused = !paused; setOn(btnPause, paused);
    btnPause.textContent = paused ? 'Продолжить' : 'Пауза';
  });
  if (btnSlow) btnSlow.addEventListener('click', function () { slowMo = !slowMo; setOn(btnSlow, slowMo); });
  if (btnSkel) btnSkel.addEventListener('click', function () { showSkel = !showSkel; setOn(btnSkel, showSkel); });
  if (btnPrints) btnPrints.addEventListener('click', function () { showPrints = !showPrints; setOn(btnPrints, showPrints); });

  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === ' ' || k === 'Spacebar') { e.preventDefault(); if (btnPause) btnPause.click(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      var d = (k === 'ArrowRight' ? 0.03 : -0.03);
      w.targetU = clamp(w.targetU + d, 0, 1);
      if (elSpeed) elSpeed.value = String(w.targetU);
    } else if (k === 's' || k === 'S' || k === 'ы' || k === 'Ы') { if (btnSkel) btnSkel.click(); }
    else if (k === 'f' || k === 'F' || k === 'а' || k === 'А') { if (btnPrints) btnPrints.click(); }
    else if (k === 't' || k === 'T' || k === 'е' || k === 'Е') { if (btnSlow) btnSlow.click(); }
  });

  function gaitName(P) {
    if (P.D >= 0.60) return 'Медленный шаг';
    if (P.D >= 0.545) return 'Шаг';
    if (P.D >= 0.50) return 'Быстрый шаг';
    if (P.D >= 0.42) return 'Трусца';
    return 'Бег';
  }

  var lastKmh = '', lastRead = '';
  function updateReadout(P) {
    var kmh = (P.v * 0.93 * 3.6).toFixed(1).replace('.', ',') + ' км/ч';
    if (kmh !== lastKmh && elKmh) { elKmh.textContent = kmh; lastKmh = kmh; }
    var s = gaitName(P) + ' · ' + Math.round(P.f * 120) + ' шаг/мин · шаг ' +
            (P.L * 0.465).toFixed(2).replace('.', ',') + ' м · опора ' +
            Math.round(P.D * 100) + '% цикла' + (P.D < 0.5 ? ' · есть фаза полёта' : '');
    if (s !== lastRead && elRead) { elRead.textContent = s; lastRead = s; }
  }

  /* ---------------------------- цикл ---------------------------- */
  function frame(ts) {
    var t = ts / 1000;
    var dt = last ? Math.min(0.05, Math.max(0, t - last)) : 0;
    last = t;
    var sim = paused ? 0 : dt * (slowMo ? 0.25 : 1);

    var P = step(w, sim);
    var pose = buildPose(w, P);

    if (w.plants !== lastPlants) {
      for (var n = lastPlants; n < w.plants; n++) {
        var pr = w.prints[w.prints.length - 1 - (w.plants - 1 - n)];
        if (pr) spawnDust(pr.x, 0.25 + 0.75 * P.run);
      }
      lastPlants = w.plants;
    }
    updateDust(sim);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSky();
    drawGround();
    drawPrints();
    drawShadows(pose);
    drawDust();
    drawFigure(pose);
    drawForeground();
    drawGaitChart(pose);

    updateReadout(P);
    root.requestAnimationFrame(frame);
  }

  root.addEventListener('resize', layout);
  if (root.visualViewport) root.visualViewport.addEventListener('resize', layout);
  document.addEventListener('visibilitychange', function () { last = 0; });

  layout();
  root.requestAnimationFrame(frame);

})(typeof globalThis !== 'undefined' ? globalThis : this);
