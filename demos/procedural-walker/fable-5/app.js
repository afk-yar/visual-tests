/* Идущий человечек — отрисовка. Кинематика — в walker.js (window.Walker). */
(function () {
  'use strict';

  var Wk = window.Walker;

  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');
  var hud = document.getElementById('hud');

  // Пропорции фигуры (px).
  var THIGH = 44, SHIN = 42;          // нога
  var UPPER_ARM = 34, FOREARM = 30;   // рука
  var TORSO = 62, NECK = 10, HEAD_R = 13;
  var HIP_BASE = THIGH + SHIN - 6;    // высота таза над землёй

  var speed = 140;
  var slider = document.getElementById('spd');
  var out = document.getElementById('spdv');
  slider.addEventListener('input', function () {
    speed = parseFloat(slider.value);
    out.textContent = Math.round(speed);
  });

  var W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
  }
  window.addEventListener('resize', resize);
  resize();

  var cycleTime = 0;       // время внутри цикла походки
  var groundOffset = 0;    // прокрутка земли
  var lastT = performance.now();

  function frame(now) {
    var dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    var g = Wk.gaitParams(speed);
    cycleTime = (cycleTime + dt / g.T) % 1;
    groundOffset = (groundOffset + speed * dt) % 100000;

    draw(g);
    requestAnimationFrame(frame);
  }

  function draw(g) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Небо.
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#10141d');
    sky.addColorStop(1, '#1a1f2c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    var groundY = H * 0.72;
    var cx = W * 0.45;

    // Земля и движущиеся метки (мир едет влево — иллюзия ходьбы вправо).
    ctx.fillStyle = '#232936';
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.strokeStyle = '#39404f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(W, groundY);
    ctx.stroke();

    ctx.fillStyle = '#39404f';
    var span = 90;
    for (var mx = -((groundOffset) % span); mx < W; mx += span) {
      ctx.fillRect(mx, groundY + 12, 26, 4);
      ctx.fillRect(mx + 44, groundY + 30, 10, 3);
    }

    // Фаза цикла: левая нога — cycleTime, правая — в противофазе.
    var phL = cycleTime;
    var phR = (cycleTime + 0.5) % 1;

    // Таз: качание по вертикали (двойная частота цикла) и наклон корпуса.
    var bounceY = -g.bounce * Math.sin(cycleTime * Math.PI * 4);
    var hipX = cx;
    var hipY = groundY - HIP_BASE + bounceY;
    var lean = g.lean;

    // Корпус: от таза вверх с наклоном вперёд.
    var chestX = hipX + Math.sin(lean) * TORSO;
    var chestY = hipY - Math.cos(lean) * TORSO;
    var neckX = chestX + Math.sin(lean) * NECK;
    var neckY = chestY - Math.cos(lean) * NECK;
    var headX = neckX + Math.sin(lean) * (HEAD_R + 4);
    var headY = neckY - Math.cos(lean) * (HEAD_R + 4);

    // Стопы в системе таза -> мировые координаты.
    var fL = Wk.footPosition(phL, g.duty, g.stepLen, g.lift);
    var fR = Wk.footPosition(phR, g.duty, g.stepLen, g.lift);
    var legL = Wk.solveLegIK(hipX, hipY, hipX + fL.x, groundY - fL.h, THIGH, SHIN, 1);
    var legR = Wk.solveLegIK(hipX, hipY, hipX + fR.x, groundY - fR.h, THIGH, SHIN, 1);

    // Руки: маховые маятники в противофазе одноимённым ногам.
    var armAmp = 0.45 + Math.min(speed / 400, 1) * 0.5;
    var swingL = Math.sin(phL * Math.PI * 2) * armAmp;       // левая рука ~ правая нога
    var swingR = Math.sin(phR * Math.PI * 2) * armAmp;
    var elbowBend = 0.22 + Math.min(speed / 400, 1) * 1.0;
    var armL = solveArm(chestX, chestY, lean + swingL, elbowBend);
    var armR = solveArm(chestX, chestY, lean + swingR, elbowBend);

    // Тень: сжимается, когда фигура в полётной фазе (обе стопы в воздухе).
    var airborne = Math.min(fL.h, fR.h) > 0.5 ? 0.7 : 1;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(hipX, groundY + 6, 46 * airborne, 7 * airborne, 0, 0, Math.PI * 2);
    ctx.fill();

    // Дальние конечности (левые) — приглушённые, ближние — яркие.
    drawArm(armL, '#76829a', 5);
    drawLeg(hipX, hipY, legL, '#76829a', 6);
    drawBody(hipX, hipY, chestX, chestY, neckX, neckY, headX, headY);
    drawLeg(hipX, hipY, legR, '#dfe5f0', 6);
    drawArm(armR, '#dfe5f0', 5);

    var mode = g.duty < 0.5 ? 'бег' : speed > 220 ? 'быстрый шаг' : 'ходьба';
    hud.textContent = mode + '   каденс ' + (60 / g.T * 2).toFixed(0) + ' шагов/мин' +
      '   опора ' + Math.round(g.duty * 100) + '% цикла';
  }

  // Рука: угол от вертикали вниз, локоть назад.
  function solveArm(sx, sy, angle, bend) {
    var ex = sx + Math.sin(angle) * UPPER_ARM;
    var ey = sy + Math.cos(angle) * UPPER_ARM;
    var wristAngle = angle + bend;
    return {
      sx: sx, sy: sy,
      ex: ex, ey: ey,
      wx: ex + Math.sin(wristAngle) * FOREARM,
      wy: ey + Math.cos(wristAngle) * FOREARM,
    };
  }

  function strokePath(pts, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  function drawLeg(hipX, hipY, leg, color, width) {
    // Таз -> колено -> стопа -> носок.
    strokePath([[hipX, hipY], [leg.kneeX, leg.kneeY],
      [leg.footX, leg.footY], [leg.footX + 13, leg.footY - 1]], color, width);
  }

  function drawArm(arm, color, width) {
    strokePath([[arm.sx, arm.sy], [arm.ex, arm.ey], [arm.wx, arm.wy]], color, width);
  }

  function drawBody(hipX, hipY, chestX, chestY, neckX, neckY, headX, headY) {
    strokePath([[hipX, hipY], [chestX, chestY], [neckX, neckY]], '#c8d0e0', 7);
    ctx.fillStyle = '#c8d0e0';
    ctx.beginPath();
    ctx.arc(headX, headY, HEAD_R, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(frame);
})();
