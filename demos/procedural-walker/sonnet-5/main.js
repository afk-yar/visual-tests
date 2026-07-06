'use strict';
(function () {
  var W = window.Walker;

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var speedSlider = document.getElementById('speed');
  var gaitReadoutEl = document.getElementById('gait-readout');
  var speedReadoutEl = document.getElementById('speed-readout');
  var skeletonToggle = document.getElementById('toggle-skeleton');

  var DPR_CAP = 2;
  var width = 0;
  var height = 0;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  var speedT = (parseFloat(speedSlider.value) || 0) / 100;
  speedSlider.addEventListener('input', function () {
    speedT = (parseFloat(speedSlider.value) || 0) / 100;
  });

  var showSkeleton = false;
  if (skeletonToggle) {
    skeletonToggle.addEventListener('change', function () {
      showSkeleton = skeletonToggle.checked;
    });
  }

  function gaitLabel(t) {
    if (t < 0.12) return 'Медленная ходьба';
    if (t < 0.38) return 'Быстрая ходьба';
    if (t < 0.62) return 'Переход в бег';
    if (t < 0.86) return 'Лёгкий бег';
    return 'Спринт';
  }

  // ---- Геометрия фигуры, пересчитывается на каждый кадр из текущих width/height ----
  function computeLayout() {
    var groundY = height * 0.76;
    var FH = height * 0.32; // условный «рост» фигуры в px
    var thigh = FH * 0.52;
    var shank = FH * 0.50;
    var margin = FH * 0.02; // небольшой запас, чтобы нога никогда не была полностью прямой
    return {
      groundY: groundY,
      FH: FH,
      hipX: width * 0.40,
      hipRestY: groundY - (thigh + shank - margin),
      thigh: thigh,
      shank: shank,
      torso: FH * 0.60,
      neck: FH * 0.05,
      headR: FH * 0.115,
      upperArm: FH * 0.30,
      forearm: FH * 0.27,
      pelvisOffset: FH * 0.045,
      shoulderOffset: FH * 0.05,
    };
  }

  var phaseAccum = 0;
  var groundScrollPx = 0;
  var parallaxScrollPx = 0;
  var last = null;

  function limbLine(x1, y1, x2, y2, w, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function jointDot(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBackground(layout) {
    var g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, '#0c1622');
    g.addColorStop(0.55, '#141c2b');
    g.addColorStop(1, '#1a2233');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    // Далёкие холмы — параллакс, скроллятся медленнее земли (иллюзия глубины).
    var hillBase = layout.groundY - layout.FH * 0.1;
    var spacing = Math.max(220, width * 0.55);
    var offset = parallaxScrollPx % spacing;
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.beginPath();
    ctx.moveTo(-spacing * 2 - offset, layout.groundY);
    for (var x = -spacing * 2 - offset; x <= width + spacing * 2; x += 14) {
      var yy = hillBase
        - Math.sin((x / spacing) * Math.PI) * layout.FH * 0.12
        - Math.sin((x / (spacing * 0.37) + 1.7) * Math.PI) * layout.FH * 0.05;
      ctx.lineTo(x, yy);
    }
    ctx.lineTo(width + spacing * 2, layout.groundY);
    ctx.closePath();
    ctx.fill();
  }

  function drawGround(layout) {
    ctx.fillStyle = '#10141c';
    ctx.fillRect(0, layout.groundY, width, height - layout.groundY);

    ctx.strokeStyle = 'rgba(94,215,231,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, layout.groundY);
    ctx.lineTo(width, layout.groundY);
    ctx.stroke();

    // Штрихи земли, скроллятся ровно со скоростью groundSpeed — та же величина,
    // что задаёт скорость опорной фазы стопы в walker.js, поэтому нога визуально
    // не скользит относительно этих отметок, пока стоит на земле.
    var spacing = layout.FH * 0.42;
    var offset = groundScrollPx % spacing;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    for (var x = -offset - spacing; x < width + spacing; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, layout.groundY + 7);
      ctx.lineTo(x - spacing * 0.4, layout.groundY + 18);
      ctx.stroke();
    }
  }

  function drawShadow(x, footHeight, layout) {
    var k = Math.max(0, 1 - footHeight / (layout.FH * 0.16));
    if (k <= 0.02) return;
    var rx = layout.FH * 0.115 * (0.55 + 0.45 * k);
    var ry = rx * 0.26;
    ctx.fillStyle = 'rgba(0,0,0,' + (0.38 * k).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(x, layout.groundY + 3, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLeg(hipX, hipY, pose, layout, color, widthScale) {
    drawShadow(pose.footX, pose.footHeight, layout);
    var thighW = layout.FH * 0.076 * widthScale;
    var shankW = layout.FH * 0.060 * widthScale;
    limbLine(hipX, hipY, pose.kneeX, pose.kneeY, thighW, color);
    limbLine(pose.kneeX, pose.kneeY, pose.footX, pose.footY, shankW, color);
    jointDot(pose.kneeX, pose.kneeY, layout.FH * 0.026 * widthScale, color);
    var toeLen = layout.FH * 0.115;
    limbLine(pose.footX, pose.footY, pose.footX + toeLen, pose.footY, shankW * 0.82, color);
    jointDot(pose.footX, pose.footY, layout.FH * 0.02 * widthScale, color);
  }

  function drawArm(sx, sy, ex, ey, hx, hy, layout, color, widthScale) {
    var upW = layout.FH * 0.058 * widthScale;
    var foW = layout.FH * 0.048 * widthScale;
    limbLine(sx, sy, ex, ey, upW, color);
    limbLine(ex, ey, hx, hy, foW, color);
    jointDot(ex, ey, layout.FH * 0.022 * widthScale, color);
    jointDot(hx, hy, layout.FH * 0.019 * widthScale, color);
  }

  function drawSkeletonGuide(hipX, hipY, pose, color) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(pose.footX, pose.footY);
    ctx.stroke();
    ctx.restore();
    jointDot(hipX, hipY, 4, '#ff5f7a');
    jointDot(pose.kneeX, pose.kneeY, 4, '#ffd166');
    jointDot(pose.footX, pose.footY, 4, pose.stance ? '#5cf28c' : '#7dd3fc');
  }

  function frame(now) {
    if (last === null) last = now;
    var dt = (now - last) / 1000;
    last = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05); // клампим большие dt (смена вкладки, лаг)

    var params = W.gaitParams(speedT);
    var layout = computeLayout();

    // Каденс и скорость земли интегрируются покадрово от текущих (плавно
    // меняющихся) параметров — при движении слайдера нет скачков фазы.
    phaseAccum += params.frequency * dt;
    var groundSpeedPx = params.groundSpeed * layout.FH;
    groundScrollPx += groundSpeedPx * dt;
    parallaxScrollPx += groundSpeedPx * dt * 0.32;

    drawBackground(layout);
    drawGround(layout);

    var renderParams = {
      dutyFactor: params.dutyFactor,
      frequency: params.frequency,
      groundSpeed: groundSpeedPx,
      stepHeight: params.stepHeight * layout.FH,
    };

    var legPhaseBack = phaseAccum;
    var legPhaseFront = phaseAccum + 0.5;

    var hipBounceOffsetPx = W.torsoBounce(phaseAccum, params) * layout.FH;
    var hipY = layout.hipRestY + hipBounceOffsetPx;
    var hipXBack = layout.hipX - layout.pelvisOffset;
    var hipXFront = layout.hipX + layout.pelvisOffset;

    var poseBack = W.legPose(legPhaseBack, renderParams, hipXBack, hipY, layout.groundY, layout.thigh, layout.shank);
    var poseFront = W.legPose(legPhaseFront, renderParams, hipXFront, hipY, layout.groundY, layout.thigh, layout.shank);

    // Небольшая вторичная осцилляция наклона корпуса поверх базового
    // (скорость-зависимого) наклона — придаёт фигуре живость.
    var leanOsc = 0.035 * params.gaitBlend * Math.sin(2 * Math.PI * phaseAccum * 2 + Math.PI / 2);
    var lean = params.lean + leanOsc;

    var torsoDX = layout.torso * Math.sin(lean);
    var torsoDY = -layout.torso * Math.cos(lean);
    var shoulderX = layout.hipX + torsoDX;
    var shoulderY = hipY + torsoDY;

    var headCenterX = shoulderX + (layout.neck + layout.headR) * Math.sin(lean);
    var headCenterY = shoulderY - (layout.neck + layout.headR) * Math.cos(lean);

    var armPhaseBack = legPhaseFront; // рука работает в противофазе одноимённой ноге
    var armPhaseFront = legPhaseBack;
    var armBack = W.armPose(armPhaseBack, params);
    var armFront = W.armPose(armPhaseFront, params);

    var shoulderXBack = shoulderX - layout.shoulderOffset;
    var shoulderXFront = shoulderX + layout.shoulderOffset;

    function armJoints(sx, sy, shoulderAngle, elbowBend) {
      var ex = sx + layout.upperArm * Math.sin(shoulderAngle);
      var ey = sy + layout.upperArm * Math.cos(shoulderAngle);
      var forearmAngle = shoulderAngle - elbowBend;
      var hx = ex + layout.forearm * Math.sin(forearmAngle);
      var hy = ey + layout.forearm * Math.cos(forearmAngle);
      return { ex: ex, ey: ey, hx: hx, hy: hy };
    }

    var armBackJ = armJoints(shoulderXBack, shoulderY, armBack.shoulderAngle, armBack.elbowBend);
    var armFrontJ = armJoints(shoulderXFront, shoulderY, armFront.shoulderAngle, armFront.elbowBend);

    var BACK_COLOR = 'rgba(150,168,192,0.55)';
    var FRONT_COLOR = '#eef3fb';
    var TORSO_COLOR = '#eef3fb';

    // Порядок отрисовки задаёт псевдо-глубину: дальняя нога/рука тусклее и рисуется первой.
    drawLeg(hipXBack, hipY, poseBack, layout, BACK_COLOR, 0.92);
    drawArm(shoulderXBack, shoulderY, armBackJ.ex, armBackJ.ey, armBackJ.hx, armBackJ.hy, layout, BACK_COLOR, 0.92);

    // Таз и плечи — короткие поперечные отрезки для ощущения объёма фигуры.
    limbLine(hipXBack, hipY, hipXFront, hipY, layout.FH * 0.05, TORSO_COLOR);
    limbLine(layout.hipX, hipY, shoulderX, shoulderY, layout.FH * 0.062, TORSO_COLOR);
    limbLine(shoulderXBack, shoulderY, shoulderXFront, shoulderY, layout.FH * 0.05, TORSO_COLOR);

    drawLeg(hipXFront, hipY, poseFront, layout, FRONT_COLOR, 1);
    drawArm(shoulderXFront, shoulderY, armFrontJ.ex, armFrontJ.ey, armFrontJ.hx, armFrontJ.hy, layout, FRONT_COLOR, 1);

    // Голова.
    ctx.fillStyle = TORSO_COLOR;
    ctx.beginPath();
    ctx.arc(headCenterX, headCenterY, layout.headR, 0, Math.PI * 2);
    ctx.fill();
    // Метка направления взгляда — маленькая точка ближе к «лицу» (в сторону движения).
    ctx.fillStyle = '#0d1016';
    ctx.beginPath();
    ctx.arc(
      headCenterX + Math.sin(lean) * layout.headR * 0.55 + layout.headR * 0.35,
      headCenterY - Math.cos(lean) * layout.headR * 0.15,
      layout.headR * 0.09,
      0,
      Math.PI * 2
    );
    ctx.fill();

    if (showSkeleton) {
      drawSkeletonGuide(hipXBack, hipY, poseBack, 'rgba(255,196,0,0.55)');
      drawSkeletonGuide(hipXFront, hipY, poseFront, 'rgba(255,196,0,0.85)');
    }

    gaitReadoutEl.textContent = gaitLabel(speedT);
    speedReadoutEl.textContent = Math.round(speedT * 100) + ' %';

    requestAnimationFrame(frame);
  }

  gaitReadoutEl.textContent = gaitLabel(speedT);
  speedReadoutEl.textContent = Math.round(speedT * 100) + ' %';
  requestAnimationFrame(frame);
})();
