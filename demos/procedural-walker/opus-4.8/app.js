'use strict';
// Идущий человечек — рендер и прокрутка земли. Кинематика — в gait.js.
(function () {
  const { gaitParams, footPosition, solveIK, clamp } = window.Gait;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const speedEl = document.getElementById('speed');
  const speedOut = document.getElementById('speedOut');
  const gaitOut = document.getElementById('gait');

  // Пропорции фигуры (px). Нога: бедро + голень. Рука: плечо + предплечье.
  const THIGH = 52, SHIN = 50;
  const UPPER = 40, FORE = 36;
  const TORSO = 70, NECK = 12, HEAD_R = 15;
  const HIP_H = THIGH + SHIN - 8;   // высота таза над землёй при прямой стойке
  const SHOULDER_DROP = 6;          // плечи чуть ниже верха корпуса

  const MAX_FRAME = 0.05;           // ограничение шага времени за кадр, с

  let speed = parseFloat(speedEl.value);
  let cyclePhase = 0;     // фаза цикла походки ∈ [0,1)
  let groundX = 0;        // мировое смещение земли (растёт), для прокрутки
  let lastT = null;

  function syncReadouts(g) {
    speedOut.textContent = Math.round(speed) + ' px/c';
    let mode;
    if (g.duty < 0.42) mode = 'бег';
    else if (speed > 230) mode = 'быстрый шаг';
    else mode = 'ходьба';
    const cadence = (120 / g.T).toFixed(0); // шагов/мин (2 шага за цикл)
    gaitOut.textContent = `${mode} · ${cadence} шаг/мин · опора ${Math.round(g.duty * 100)}%`;
  }

  speedEl.addEventListener('input', () => {
    speed = parseFloat(speedEl.value);
  });

  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', fitCanvas);

  function strokePath(pts, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  // Земля: тёмная полоса + бегущие риски/камни, едущие влево со скоростью speed.
  // Привязка меток к мировому groundX гарантирует, что стопа в фазе опоры
  // (неподвижная относительно земли) едет вместе с конкретной меткой.
  function drawGround(w, groundY) {
    ctx.fillStyle = '#15181f';
    ctx.fillRect(0, groundY, w, 200);
    ctx.strokeStyle = '#2a2f38';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY + 1);
    ctx.lineTo(w, groundY + 1);
    ctx.stroke();

    const span = 96;
    const base = ((groundX % span) + span) % span; // фаза прокрутки [0,span)
    ctx.fillStyle = '#2a2f38';
    for (let m = -base; m < w + span; m += span) {
      ctx.fillRect(m, groundY + 14, 30, 4);          // длинная риска
      ctx.fillRect(m + 52, groundY + 30, 12, 3);     // короткая риска
    }
    // Редкие «камешки», другая частота — добавляют параллакс/жизнь.
    const span2 = 233;
    const base2 = ((groundX % span2) + span2) % span2;
    ctx.fillStyle = '#222732';
    for (let m = -base2; m < w + span2; m += span2) {
      ctx.beginPath();
      ctx.ellipse(m + 20, groundY + 22, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFigure(g, hipX, groundY) {
    // Левая нога ведёт по фазе цикла, правая — в противофазе (+0.5).
    const phL = cyclePhase;
    const phR = (cyclePhase + 0.5) % 1;

    // Вертикальное качание таза: минимум в двойной опоре, максимум в середине
    // шага. Удвоенная частота цикла — два «провала» за цикл (по шагу на ногу).
    const bounce = -g.bounce * Math.cos(cyclePhase * 2 * Math.PI * 2);
    const hipY = groundY - HIP_H + bounce;
    const lean = g.lean;

    // Корпус от таза вверх с наклоном вперёд (вправо). Локальная ось «вверх»
    // повёрнута на lean: dirUp = (sin(lean), -cos(lean)).
    const ux = Math.sin(lean), uy = -Math.cos(lean);
    const chestX = hipX + ux * TORSO;
    const chestY = hipY + uy * TORSO;
    const shoulderX = hipX + ux * (TORSO - SHOULDER_DROP);
    const shoulderY = hipY + uy * (TORSO - SHOULDER_DROP);
    const neckX = chestX + ux * NECK;
    const neckY = chestY + uy * NECK;
    const headX = neckX + ux * (HEAD_R + 3);
    const headY = neckY + uy * (HEAD_R + 3);

    // Стопы: позиция в системе таза → мировые координаты.
    // h — высота над землёй, поэтому y = groundY - h.
    const fL = footPosition(phL, g.duty, g.stepLen, g.lift);
    const fR = footPosition(phR, g.duty, g.stepLen, g.lift);
    const legL = solveIK(hipX, hipY, hipX + fL.x, groundY - fL.h, THIGH, SHIN, 1);
    const legR = solveIK(hipX, hipY, hipX + fR.x, groundY - fR.h, THIGH, SHIN, 1);

    // Руки маховые в противофазе одноимённым ногам (левая рука ↔ правая нога).
    // Цель кисти задаём качанием угла плеча вокруг наклона корпуса; локоть
    // решаем той же IK с обратным знаком сгиба (локоть гнётся назад).
    const swingL = Math.sin(phL * 2 * Math.PI) * g.armSwing;
    const swingR = Math.sin(phR * 2 * Math.PI) * g.armSwing;
    const armReach = (UPPER + FORE) * (1 - 0.10 * g.elbow); // лёгкий сгиб в покое
    const handL = handTarget(shoulderX, shoulderY, lean - swingL, armReach);
    const handR = handTarget(shoulderX, shoulderY, lean - swingR, armReach);
    const armL = solveIK(shoulderX, shoulderY, handL.x, handL.y, UPPER, FORE, -1);
    const armR = solveIK(shoulderX, shoulderY, handR.x, handR.y, UPPER, FORE, -1);

    // Тень: сжимается в фазе полёта (обе стопы оторваны — характерно для бега).
    const airborne = Math.min(fL.h, fR.h) > 0.5;
    const shScale = airborne ? 0.72 : 1;
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    ctx.beginPath();
    ctx.ellipse(hipX, groundY + 5, 50 * shScale, 7 * shScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Порядок отрисовки даёт глубину: дальние (левые) конечности приглушены,
    // ближние (правые) — яркие, между ними корпус.
    const FAR = '#7c8699', NEAR = '#dfe5f0', BODY = '#c8d0e0';
    drawArm(shoulderX, shoulderY, armL, FAR, 6);
    drawLeg(hipX, hipY, legL, FAR, 7);
    drawTorso(hipX, hipY, chestX, chestY, neckX, neckY, headX, headY, BODY);
    drawLeg(hipX, hipY, legR, NEAR, 7);
    drawArm(shoulderX, shoulderY, armR, NEAR, 6);
  }

  // Цель кисти: от плеча по направлению угла angle (от вертикали вниз).
  function handTarget(sx, sy, angle, len) {
    return { x: sx + Math.sin(angle) * len, y: sy + Math.cos(angle) * len };
  }

  function drawLeg(hipX, hipY, leg, color, width) {
    // Таз → колено → лодыжка, затем короткий носок стопы вперёд.
    const toeX = leg.endX + 15;
    const toeY = leg.endY - 1;
    strokePath([[hipX, hipY], [leg.jointX, leg.jointY],
      [leg.endX, leg.endY], [toeX, toeY]], color, width);
  }

  function drawArm(shoulderX, shoulderY, arm, color, width) {
    // Плечо → локоть (arm.jointX/Y) → кисть (arm.endX/Y).
    strokePath([[shoulderX, shoulderY], [arm.jointX, arm.jointY],
      [arm.endX, arm.endY]], color, width);
  }

  function drawTorso(hipX, hipY, chestX, chestY, neckX, neckY, headX, headY, color) {
    strokePath([[hipX, hipY], [chestX, chestY], [neckX, neckY]], color, 8);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(headX, headY, HEAD_R, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(g) {
    const w = canvas.clientWidth, h = canvas.clientHeight;

    // Фон-небо градиентом.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0f1115');
    sky.addColorStop(1, '#171b22');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const groundY = Math.round(h * 0.74);
    const hipX = Math.round(w * 0.42);

    drawGround(w, groundY);
    drawFigure(g, hipX, groundY);
  }

  function frame(t) {
    if (lastT == null) lastT = t;
    const dt = Math.min((t - lastT) / 1000, MAX_FRAME);
    lastT = t;

    const g = gaitParams(speed);
    cyclePhase = (cyclePhase + dt / g.T) % 1;
    // Земля едет влево со скоростью speed: метки уходят назад, как под стопой.
    groundX = groundX - speed * dt;

    syncReadouts(g);
    draw(g);
    requestAnimationFrame(frame);
  }

  fitCanvas();
  requestAnimationFrame(frame);
})();
