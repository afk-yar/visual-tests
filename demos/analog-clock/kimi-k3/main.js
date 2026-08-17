/* «Аналоговые часы» — Kimi K3
 * Классические настенные часы: металлический обод, стекло, кремовый циферблат.
 * Реальное системное время, непрерывный ход часовой/минутной стрелок,
 * секундная — плавный sweep или механический тик с отскоком.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("clock");
  var ctx = canvas.getContext("2d");

  var TAU = Math.PI * 2;
  var DPR_CAP = 2;

  var W = 0, H = 0, DPR = 1;

  // --- состояние -----------------------------------------------------------
  var mode = "sweep";            // 'sweep' | 'tick'
  var tickAnim = 1;              // прогресс отскока 0..1 (1 = стоит)
  var tickFrom = 0, tickTo = 0;  // углы (в долях оборота) для тика
  var lastSecInt = -1;

  // --- геометрия -----------------------------------------------------------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
  }
  window.addEventListener("resize", resize);
  resize();

  // --- утилиты -------------------------------------------------------------
  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
  }

  // Мягкая тень стрелки: рисуем форму со смещением и blur-имитацией
  // (несколько полупрозрачных проходов), чтобы не зависеть от shadowBlur на больших path.
  function drawHandShadow(drawFn, cx, cy, R) {
    var passes = 4;
    for (var i = passes; i >= 1; i--) {
      ctx.save();
      ctx.translate(cx + R * 0.012 * i, cy + R * 0.018 * i);
      ctx.fillStyle = "rgba(15, 12, 8, " + (0.05 + 0.02 * (passes - i)) + ")";
      drawFn();
      ctx.restore();
    }
  }

  // --- фон сцены -----------------------------------------------------------
  function drawBackground() {
    var g = ctx.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, "#23262d");
    g.addColorStop(0.55, "#171a1f");
    g.addColorStop(1, "#0d0f12");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Лёгкая виньетка
    var v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.8);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  // --- корпус: тень на стене, обод, внутренняя канавка ---------------------
  function drawCase(cx, cy, R) {
    // Тень часов на стене
    ctx.save();
    ctx.translate(cx + R * 0.035, cy + R * 0.06);
    for (var i = 6; i >= 1; i--) {
      circle(0, 0, R * (1.0 + i * 0.012));
      ctx.fillStyle = "rgba(0,0,0," + (0.05 + (6 - i) * 0.012) + ")";
      ctx.fill();
    }
    ctx.restore();

    // Внешний металлический обод (конический градиент имитируем дугами)
    var rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    rim.addColorStop(0.0, "#8d9299");
    rim.addColorStop(0.18, "#e8ebee");
    rim.addColorStop(0.38, "#9aa0a7");
    rim.addColorStop(0.5, "#f4f6f8");
    rim.addColorStop(0.64, "#848a91");
    rim.addColorStop(0.82, "#c9ced4");
    rim.addColorStop(1.0, "#787e86");
    circle(cx, cy, R);
    ctx.fillStyle = rim;
    ctx.fill();

    // Тонкая тёмная кромка по внешнему краю
    circle(cx, cy, R - R * 0.004);
    ctx.lineWidth = Math.max(1, R * 0.006);
    ctx.strokeStyle = "rgba(20,22,26,0.55)";
    ctx.stroke();

    // Блик на ободе (дуга сверху-слева)
    ctx.save();
    circle(cx, cy, R * 0.985);
    ctx.clip();
    var hi = ctx.createRadialGradient(cx - R * 0.55, cy - R * 0.6, R * 0.1, cx - R * 0.55, cy - R * 0.6, R * 1.15);
    hi.addColorStop(0, "rgba(255,255,255,0.55)");
    hi.addColorStop(0.5, "rgba(255,255,255,0.08)");
    hi.addColorStop(1, "rgba(255,255,255,0)");
    circle(cx, cy, R);
    ctx.fillStyle = hi;
    ctx.fill();
    ctx.restore();

    // Канавка между ободом и циферблатом
    circle(cx, cy, R * 0.9);
    var groove = ctx.createLinearGradient(cx - R * 0.9, cy - R * 0.9, cx + R * 0.9, cy + R * 0.9);
    groove.addColorStop(0, "#3a3d42");
    groove.addColorStop(0.5, "#141518");
    groove.addColorStop(1, "#4a4e55");
    ctx.fillStyle = groove;
    ctx.fill();

    // Скос к циферблату
    circle(cx, cy, R * 0.868);
    var bevel = ctx.createLinearGradient(cx, cy - R * 0.87, cx, cy + R * 0.87);
    bevel.addColorStop(0, "rgba(255,255,255,0.35)");
    bevel.addColorStop(0.12, "rgba(0,0,0,0.35)");
    bevel.addColorStop(1, "rgba(0,0,0,0.05)");
    ctx.fillStyle = bevel;
    ctx.fill();
  }

  // --- циферблат -----------------------------------------------------------
  function drawDial(cx, cy, R) {
    var rD = R * 0.855; // радиус циферблата

    // Кремовая эмаль
    circle(cx, cy, rD);
    var face = ctx.createRadialGradient(cx - rD * 0.25, cy - rD * 0.3, rD * 0.1, cx, cy, rD);
    face.addColorStop(0, "#fbf7ee");
    face.addColorStop(0.65, "#f3edde");
    face.addColorStop(1, "#e7dfc9");
    ctx.fillStyle = face;
    ctx.fill();

    // Едва заметное затемнение у края (глубина под стеклом)
    circle(cx, cy, rD);
    ctx.lineWidth = rD * 0.03;
    ctx.strokeStyle = "rgba(90,80,55,0.10)";
    ctx.stroke();

    var ink = "#2a2c30";

    // Минутные и часовые деления
    for (var m = 0; m < 60; m++) {
      var isHour = m % 5 === 0;
      var a = (m / 60) * TAU;
      var r1 = rD * (isHour ? 0.90 : 0.935);
      var r2 = rD * 0.97;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, -r1);
      ctx.lineTo(0, -r2);
      ctx.lineCap = "round";
      ctx.lineWidth = isHour ? rD * 0.016 : rD * 0.006;
      ctx.strokeStyle = isHour ? ink : "rgba(42,44,48,0.55)";
      ctx.stroke();
      ctx.restore();
    }

    // Числа 1..12 (вертикально, не по кругу — читаемость)
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 " + Math.round(rD * 0.135) + "px Georgia, 'Times New Roman', serif";
    for (var n = 1; n <= 12; n++) {
      var ang = (n / 12) * TAU;
      var rr = rD * 0.76;
      var x = cx + Math.sin(ang) * rr;
      var y = cy - Math.cos(ang) * rr;
      ctx.fillText(String(n), x, y + rD * 0.006);
    }

    // Марка под 12
    ctx.font = "italic 600 " + Math.round(rD * 0.052) + "px Georgia, serif";
    ctx.fillStyle = "rgba(42,44,48,0.62)";
    ctx.fillText("MERIDIAN", cx, cy - rD * 0.38);
    ctx.font = "italic " + Math.round(rD * 0.036) + "px Georgia, serif";
    ctx.fillStyle = "rgba(42,44,48,0.45)";
    ctx.fillText("wall clock", cx, cy - rD * 0.315);

    return rD;
  }

  // --- стрелки -------------------------------------------------------------
  // Часовая: короткая, широкая, с «хвостиком» и декоративным сужением
  function pathHourHand(rD) {
    var len = rD * 0.5, tail = rD * 0.12, wBase = rD * 0.045, wTip = rD * 0.014;
    ctx.beginPath();
    ctx.moveTo(-wBase, tail);
    ctx.lineTo(-wTip, -len + rD * 0.06);
    ctx.lineTo(0, -len);
    ctx.lineTo(wTip, -len + rD * 0.06);
    ctx.lineTo(wBase, tail);
    ctx.closePath();
  }

  // Минутная: длиннее и тоньше часовой
  function pathMinuteHand(rD) {
    var len = rD * 0.74, tail = rD * 0.14, wBase = rD * 0.032, wTip = rD * 0.009;
    ctx.beginPath();
    ctx.moveTo(-wBase, tail);
    ctx.lineTo(-wTip, -len + rD * 0.05);
    ctx.lineTo(0, -len);
    ctx.lineTo(wTip, -len + rD * 0.05);
    ctx.lineTo(wBase, tail);
    ctx.closePath();
  }

  // Секундная: тонкая игла с противовесом
  function pathSecondHand(rD) {
    var len = rD * 0.85, tail = rD * 0.24, w = rD * 0.008;
    ctx.beginPath();
    ctx.moveTo(-w, tail * 0.55);
    ctx.lineTo(-w * 0.45, -len + rD * 0.04);
    ctx.lineTo(0, -len);
    ctx.lineTo(w * 0.45, -len + rD * 0.04);
    ctx.lineTo(w, tail * 0.55);
    ctx.closePath();
    // противовес — капля сзади
    ctx.moveTo(rD * 0.035, tail * 0.8);
    ctx.arc(0, tail * 0.8, rD * 0.035, 0, TAU);
  }

  function drawHands(cx, cy, R, rD, time) {
    var hAng = ((time.h % 12) + time.m / 60 + time.s / 3600) / 12 * TAU;
    var mAng = (time.m + time.s / 60) / 60 * TAU;
    var sAng = time.secFrac / 60 * TAU;

    // Тени (сначала все тени, потом все стрелки — тени не ложатся на стрелки)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(hAng);
    drawHandShadow(function () { pathHourHand(rD); ctx.fill(); }, 0, 0, R);
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(mAng);
    drawHandShadow(function () { pathMinuteHand(rD); ctx.fill(); }, 0, 0, R);
    ctx.restore();

    // Часовая
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(hAng);
    var hg = ctx.createLinearGradient(-rD * 0.05, 0, rD * 0.05, 0);
    hg.addColorStop(0, "#1c1e22");
    hg.addColorStop(0.5, "#3c4048");
    hg.addColorStop(1, "#15171b");
    pathHourHand(rD);
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.restore();

    // Минутная
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(mAng);
    var mg = ctx.createLinearGradient(-rD * 0.035, 0, rD * 0.035, 0);
    mg.addColorStop(0, "#1c1e22");
    mg.addColorStop(0.5, "#40444c");
    mg.addColorStop(1, "#15171b");
    pathMinuteHand(rD);
    ctx.fillStyle = mg;
    ctx.fill();
    ctx.restore();

    // Секундная (тень чуть слабее)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sAng);
    ctx.translate(R * 0.01, R * 0.016);
    ctx.fillStyle = "rgba(15,12,8,0.18)";
    pathSecondHand(rD);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sAng);
    pathSecondHand(rD);
    ctx.fillStyle = "#b3362b";
    ctx.fill();
    ctx.restore();

    // Ось-гайка: стопка кругов с металлическим блеском
    var capR = rD * 0.045;
    var cap = ctx.createRadialGradient(cx - capR * 0.4, cy - capR * 0.45, capR * 0.1, cx, cy, capR);
    cap.addColorStop(0, "#f0f2f5");
    cap.addColorStop(0.45, "#a8adb4");
    cap.addColorStop(1, "#5c6167");
    circle(cx, cy, capR);
    ctx.fillStyle = cap;
    ctx.fill();
    circle(cx, cy, capR);
    ctx.lineWidth = Math.max(1, capR * 0.12);
    ctx.strokeStyle = "rgba(30,32,36,0.6)";
    ctx.stroke();

    // Красный кончик оси секундной стрелки
    circle(cx, cy, capR * 0.34);
    ctx.fillStyle = "#8e2a21";
    ctx.fill();
  }

  // --- стекло --------------------------------------------------------------
  function drawGlass(cx, cy, R) {
    var rD = R * 0.855;

    // Диагональный блик-полоса
    ctx.save();
    circle(cx, cy, rD);
    ctx.clip();

    var g1 = ctx.createLinearGradient(cx - rD, cy - rD, cx + rD * 0.35, cy + rD * 0.35);
    g1.addColorStop(0, "rgba(255,255,255,0.16)");
    g1.addColorStop(0.28, "rgba(255,255,255,0.05)");
    g1.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.fillStyle = g1;
    ctx.fillRect(cx - rD, cy - rD, rD * 2, rD * 2);

    // Маленький овальный отблеск сверху-слева
    ctx.translate(cx - rD * 0.34, cy - rD * 0.44);
    ctx.rotate(-0.65);
    var g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, rD * 0.5);
    g2.addColorStop(0, "rgba(255,255,255,0.20)");
    g2.addColorStop(1, "rgba(255,255,255,0)");
    ctx.scale(1, 0.42);
    circle(0, 0, rD * 0.5);
    ctx.fillStyle = g2;
    ctx.fill();
    ctx.restore();
  }

  // --- механика секундной стрелки ------------------------------------------
  function secondFraction(now, dt) {
    var s = now.getSeconds();
    var ms = now.getMilliseconds();
    if (mode === "sweep") {
      tickAnim = 1;
      lastSecInt = s;
      return s + ms / 1000;
    }
    // Тик: целая секунда + пружинный отскок после смены секунды
    if (s !== lastSecInt) {
      tickFrom = ((lastSecInt < 0 ? s : lastSecInt) % 60);
      tickTo = s;
      tickAnim = 0;
      lastSecInt = s;
    }
    if (tickAnim < 1) {
      tickAnim = Math.min(1, tickAnim + dt * 5.2); // ~190 мс на тик
      var t = tickAnim;
      // back-out easing: стрелка чуть перелетает деление и пружинит назад
      var ease = 1 + 2.2 * Math.pow(t - 1, 3) + 1.9 * Math.pow(t - 1, 2);
      var frac = tickFrom + (tickTo - tickFrom) * ease;
      return ((frac % 60) + 60) % 60;
    }
    return s;
  }

  // --- главный цикл --------------------------------------------------------
  var prevT = performance.now();

  function frame(nowT) {
    var dt = Math.min(0.1, Math.max(0, (nowT - prevT) / 1000)); // кламп большого dt
    prevT = nowT;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    var now = new Date();
    var time = {
      h: now.getHours(),
      m: now.getMinutes(),
      s: now.getSeconds(),
      secFrac: secondFraction(now, dt)
    };

    drawBackground();

    // Циферблат по центру, с запасом под HUD сверху и panel снизу
    var R = Math.min(W, H) * 0.5 * 0.86;
    var cx = W / 2;
    var cy = H / 2 - Math.min(H * 0.015, 12);

    drawCase(cx, cy, R);
    var rD = drawDial(cx, cy, R);
    drawHands(cx, cy, R, rD, time);
    drawGlass(cx, cy, R);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- UI ------------------------------------------------------------------
  var btnSweep = document.getElementById("btnSweep");
  var btnTick = document.getElementById("btnTick");

  function setMode(m) {
    if (mode === m) return;
    mode = m;
    tickAnim = 1; // при переключении — без фантомного скачка
    lastSecInt = -1;
    btnSweep.classList.toggle("active", m === "sweep");
    btnTick.classList.toggle("active", m === "tick");
  }
  btnSweep.addEventListener("click", function () { setMode("sweep"); });
  btnTick.addEventListener("click", function () { setMode("tick"); });
})();
