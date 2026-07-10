(function () {
  'use strict';

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const speedInput = document.getElementById('speed');
  const speedValue = document.getElementById('speedValue');
  const paceLabel = document.getElementById('paceLabel');

  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastTime = performance.now();
  let gaitPhase = 0;
  let groundDistance = 0;
  let speedMix = Number(speedInput.value) / 100;
  let targetMix = speedMix;

  const legs = [
    { stance: true, x: 0, liftX: 0, initialized: false },
    { stance: false, x: 0, liftX: 0, initialized: false }
  ];

  const COLORS = {
    front: '#f5f7ef',
    back: 'rgba(166, 205, 202, .58)',
    joint: '#ffcf66',
    shadow: 'rgba(0, 0, 0, .18)',
    horizon: 'rgba(172, 222, 218, .13)',
    ground: 'rgba(180, 224, 217, .17)'
  };

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, v) {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function ease(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function mod(n, m) { return ((n % m) + m) % m; }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    legs[0].initialized = false;
    legs[1].initialized = false;
  }

  function updateLabels() {
    targetMix = Number(speedInput.value) / 100;
    speedInput.style.setProperty('--fill', Math.round(targetMix * 100) + '%');
    const kmh = lerp(2.2, 12.6, Math.pow(targetMix, 1.08));
    speedValue.textContent = kmh.toFixed(1);
    paceLabel.textContent = targetMix < 0.22 ? 'Спокойный шаг'
      : targetMix < 0.53 ? 'Быстрый шаг'
      : targetMix < 0.76 ? 'Спортивный шаг'
      : 'Лёгкий бег';
  }

  speedInput.addEventListener('input', updateLabels);
  window.addEventListener('resize', resize);
  updateLabels();
  resize();

  function line(a, b, color, lineWidth, cap) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = cap || 'round';
    ctx.stroke();
  }

  function dot(p, radius, fill) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function solveKnee(hip, ankle, upper, lower) {
    const rawX = ankle.x - hip.x;
    const rawY = ankle.y - hip.y;
    const rawDistance = Math.hypot(rawX, rawY) || 1;
    const distance = clamp(rawDistance, Math.abs(upper - lower) + 0.01, upper + lower - 0.01);
    const dx = rawX / rawDistance;
    const dy = rawY / rawDistance;
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    const side = Math.sqrt(Math.max(0, upper * upper - along * along));
    const base = { x: hip.x + dx * along, y: hip.y + dy * along };
    const one = { x: base.x - dy * side, y: base.y + dx * side };
    const two = { x: base.x + dy * side, y: base.y - dx * side };
    return one.x > two.x ? one : two;
  }

  function drawBackdrop(groundY, scale) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#132d36');
    sky.addColorStop(0.58, '#0c2029');
    sky.addColorStop(1, '#07151d');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const radius = Math.max(width, height) * 0.64;
    const glow = ctx.createRadialGradient(width * 0.69, height * 0.28, 0, width * 0.69, height * 0.28, radius);
    glow.addColorStop(0, 'rgba(75, 156, 148, .17)');
    glow.addColorStop(0.48, 'rgba(28, 93, 94, .07)');
    glow.addColorStop(1, 'rgba(4, 15, 22, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(4, 13, 18, .42)';
    ctx.fillRect(0, groundY, width, height - groundY);
    line({ x: 0, y: groundY }, { x: width, y: groundY }, COLORS.horizon, 1);

    const spacing = 94 * scale;
    const offset = -mod(groundDistance, spacing);
    for (let x = offset - spacing; x < width + spacing; x += spacing) {
      const fade = 1 - Math.abs(x - width / 2) / (width * 0.75);
      ctx.strokeStyle = 'rgba(170, 222, 215, ' + Math.max(0.025, fade * 0.10) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, groundY + 8);
      ctx.lineTo(x - 34 * scale, height);
      ctx.stroke();
    }

    for (let row = 1; row < 7; row++) {
      const t = row / 7;
      const y = groundY + (height - groundY) * Math.pow(t, 1.65);
      line({ x: 0, y: y }, { x: width, y: y }, 'rgba(170, 222, 215, .045)', 1);
    }

    const dashGap = 178 * scale;
    const dashOffset = -mod(groundDistance, dashGap);
    for (let x = dashOffset - dashGap; x < width + dashGap; x += dashGap) {
      line(
        { x: x, y: groundY + 2 },
        { x: x + 50 * scale, y: groundY + 2 },
        COLORS.ground,
        2 * scale
      );
    }
  }

  function getFoot(leg, localPhase, duty, centerX, visualSpeed, frequency, lift, dt) {
    const shouldStance = localPhase < duty;
    const supportTravel = visualSpeed * duty / frequency;
    const frontX = centerX + supportTravel * 0.5;

    if (!leg.initialized) {
      leg.stance = shouldStance;
      leg.x = shouldStance
        ? frontX - supportTravel * (localPhase / duty)
        : lerp(centerX - supportTravel * 0.5, frontX, ease((localPhase - duty) / (1 - duty)));
      leg.liftX = centerX - supportTravel * 0.5;
      leg.initialized = true;
    }

    if (shouldStance) {
      if (!leg.stance) {
        leg.x = frontX;
      } else {
        // The same delta drives the terrain and the planted foot: no foot sliding.
        leg.x -= visualSpeed * dt;
      }
      leg.stance = true;
      return { x: leg.x, rise: 0, angle: 0, stance: true };
    }

    if (leg.stance) {
      leg.liftX = leg.x;
      leg.stance = false;
    }
    const swing = clamp((localPhase - duty) / (1 - duty), 0, 1);
    leg.x = lerp(leg.liftX, frontX, ease(swing));
    return {
      x: leg.x,
      rise: Math.pow(Math.sin(Math.PI * swing), 0.82) * lift,
      angle: Math.sin((swing - 0.18) * Math.PI * 1.15) * 0.24,
      stance: false
    };
  }

  function drawGroundShadow(centerX, groundY, scale, runBlend) {
    ctx.save();
    ctx.translate(centerX, groundY + 8 * scale);
    ctx.scale(1, 0.2);
    const shadowWidth = lerp(126, 105, runBlend) * scale;
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, shadowWidth);
    shadow.addColorStop(0, 'rgba(0, 0, 0, .28)');
    shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, shadowWidth, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLeg(hip, foot, groundY, scale, color, alpha) {
    const ankle = { x: foot.x, y: groundY - 7 * scale - foot.rise };
    const upper = 67 * scale;
    const lower = 68 * scale;
    const knee = solveKnee(hip, ankle, upper, lower);
    const limbWidth = 8 * scale;

    ctx.globalAlpha = alpha;
    line(hip, knee, COLORS.shadow, limbWidth + 4 * scale);
    line(knee, ankle, COLORS.shadow, limbWidth + 4 * scale);
    line(hip, knee, color, limbWidth);
    line(knee, ankle, color, limbWidth);
    dot(knee, 5.2 * scale, COLORS.joint);

    ctx.save();
    ctx.translate(ankle.x, ankle.y);
    ctx.rotate(foot.angle);
    ctx.beginPath();
    ctx.moveTo(-8 * scale, 1 * scale);
    ctx.quadraticCurveTo(7 * scale, 6 * scale, 27 * scale, 2 * scale);
    ctx.strokeStyle = COLORS.shadow;
    ctx.lineWidth = 12 * scale;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 7 * scale;
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function armPoints(shoulder, swing, scale) {
    const upperLen = 45 * scale;
    const lowerLen = 42 * scale;
    const elbow = {
      x: shoulder.x + Math.sin(swing) * upperLen,
      y: shoulder.y + Math.cos(swing) * upperLen
    };
    const bend = 0.28 + Math.abs(Math.sin(swing)) * 0.42;
    const forearmAngle = swing - Math.sign(swing || 1) * bend;
    return {
      elbow: elbow,
      hand: {
        x: elbow.x + Math.sin(forearmAngle) * lowerLen,
        y: elbow.y + Math.cos(forearmAngle) * lowerLen
      }
    };
  }

  function drawArm(shoulder, swing, scale, color, alpha) {
    const arm = armPoints(shoulder, swing, scale);
    ctx.globalAlpha = alpha;
    line(shoulder, arm.elbow, COLORS.shadow, 11 * scale);
    line(arm.elbow, arm.hand, COLORS.shadow, 11 * scale);
    line(shoulder, arm.elbow, color, 6.5 * scale);
    line(arm.elbow, arm.hand, color, 6.5 * scale);
    dot(arm.hand, 5 * scale, color);
    ctx.globalAlpha = 1;
  }

  function drawFigure(dt, params) {
    const groundY = params.groundY;
    const scale = params.scale;
    const frequency = params.frequency;
    const duty = params.duty;
    const visualSpeed = params.visualSpeed;
    const runBlend = params.runBlend;
    const centerX = width * (width < 700 ? 0.55 : 0.58);
    const foot0 = getFoot(legs[0], mod(gaitPhase, 1), duty, centerX, visualSpeed, frequency, params.lift, dt);
    const foot1 = getFoot(legs[1], mod(gaitPhase + 0.5, 1), duty, centerX, visualSpeed, frequency, params.lift, dt);

    const doubleBeat = Math.cos(gaitPhase * Math.PI * 4);
    const runBeat = Math.cos(gaitPhase * Math.PI * 2);
    const bob = lerp(doubleBeat * 3.2, runBeat * 8.2, runBlend) * scale;
    const hipCenter = {
      x: centerX,
      y: groundY - lerp(126, 133, runBlend) * scale + bob
    };
    const lean = lerp(0.025, 0.17, runBlend) + Math.sin(gaitPhase * Math.PI * 2) * 0.012;
    const torsoLen = 91 * scale;
    const shoulderCenter = {
      x: hipCenter.x + Math.sin(lean) * torsoLen,
      y: hipCenter.y - Math.cos(lean) * torsoLen
    };

    drawGroundShadow(centerX, groundY, scale, runBlend);

    const hipBack = { x: hipCenter.x - 5 * scale, y: hipCenter.y - 1 * scale };
    const hipFront = { x: hipCenter.x + 5 * scale, y: hipCenter.y + 1 * scale };
    drawLeg(hipBack, foot1, groundY, scale, COLORS.back, 0.72);

    const armAmplitude = lerp(0.46, 0.88, smoothstep(0.15, 1, speedMix));
    const armWave = Math.sin(gaitPhase * Math.PI * 2) * armAmplitude;
    const backShoulder = { x: shoulderCenter.x - 5 * scale, y: shoulderCenter.y + 2 * scale };
    drawArm(backShoulder, armWave, scale, COLORS.back, 0.67);

    line(hipCenter, shoulderCenter, COLORS.shadow, 18 * scale);
    line(hipCenter, shoulderCenter, COLORS.front, 12 * scale);
    line(
      { x: hipCenter.x - 10 * scale, y: hipCenter.y },
      { x: hipCenter.x + 10 * scale, y: hipCenter.y },
      COLORS.front,
      7 * scale
    );

    drawLeg(hipFront, foot0, groundY, scale, COLORS.front, 1);

    const frontShoulder = { x: shoulderCenter.x + 5 * scale, y: shoulderCenter.y - 1 * scale };
    drawArm(frontShoulder, -armWave, scale, COLORS.front, 1);

    const neck = {
      x: shoulderCenter.x + Math.sin(lean) * 10 * scale,
      y: shoulderCenter.y - Math.cos(lean) * 10 * scale
    };
    line(shoulderCenter, neck, COLORS.front, 9 * scale);
    const head = {
      x: neck.x + Math.sin(lean) * 21 * scale,
      y: neck.y - Math.cos(lean) * 21 * scale
    };
    dot(head, 20 * scale, COLORS.shadow);
    dot(head, 16.5 * scale, COLORS.front);
    dot({ x: head.x + 7 * scale, y: head.y - 2 * scale }, 2.2 * scale, '#17313a');
  }

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    speedMix += (targetMix - speedMix) * (1 - Math.exp(-dt * 5.2));

    const runBlend = smoothstep(0.56, 0.88, speedMix);
    const frequency = lerp(0.72, 2.52, Math.pow(speedMix, 0.82));
    const duty = lerp(0.69, 0.43, runBlend);
    const visualSpeed = lerp(48, 365, Math.pow(speedMix, 1.03));
    const lift = lerp(25, 63, smoothstep(0.16, 1, speedMix));
    const scale = clamp(Math.min(width / 920, height / 650), 0.62, 1.18);
    const groundY = clamp(height * 0.76, 340 * scale, height - 110);

    gaitPhase = mod(gaitPhase + frequency * dt, 1);
    groundDistance += visualSpeed * dt;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawBackdrop(groundY, scale);
    drawFigure(dt, {
      groundY: groundY,
      scale: scale,
      frequency: frequency,
      duty: duty,
      visualSpeed: visualSpeed,
      runBlend: runBlend,
      lift: lift
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
