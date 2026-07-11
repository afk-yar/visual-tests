(function () {
  "use strict";

  var canvas = document.getElementById("scene");
  var ctx = canvas.getContext("2d");
  var hud = document.getElementById("hud");
  var motionButton = document.getElementById("motionButton");
  var hudButton = document.getElementById("hudButton");
  var intensityInput = document.getElementById("intensity");
  var sceneState = document.getElementById("sceneState");

  var width = 0;
  var height = 0;
  var dpr = 1;
  var lastFrame = 0;
  var elapsed = 0;
  var isMoving = true;
  var intensity = 1;
  var pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  var stars = [];
  var pines = [];
  var horizonRatio = 0.705;

  var curtains = [
    { center: 0.33, depth: 0.55, sway: 0.085, phase: 0.2, f1: 5.1, f2: 12.5, speed: 0.19, fold: 39, foldSpeed: 0.8, stops: [[0, "rgba(40,244,196,0)"], [0.14, "rgba(67,244,206,0.15)"], [0.29, "rgba(69,255,201,0.68)"], [0.48, "rgba(34,207,160,0.25)"], [0.72, "rgba(16,107,127,0)"]], ray: [111, 255, 218], accent: [185, 255, 231] },
    { center: 0.235, depth: 0.46, sway: 0.065, phase: 2.1, f1: 4.2, f2: 18.2, speed: 0.15, fold: 31, foldSpeed: 0.65, stops: [[0, "rgba(66,185,255,0)"], [0.11, "rgba(71,214,255,0.18)"], [0.28, "rgba(99,196,255,0.63)"], [0.47, "rgba(77,112,220,0.22)"], [0.67, "rgba(33,79,144,0)"]], ray: [135, 213, 255], accent: [210, 239, 255] },
    { center: 0.415, depth: 0.59, sway: 0.072, phase: 4.4, f1: 3.7, f2: 15.2, speed: 0.12, fold: 26, foldSpeed: 0.55, stops: [[0, "rgba(157,74,255,0)"], [0.13, "rgba(182,82,255,0.13)"], [0.31, "rgba(213,107,255,0.61)"], [0.54, "rgba(134,61,210,0.23)"], [0.78, "rgba(56,31,116,0)"]], ray: [230, 151, 255], accent: [241, 201, 255] },
    { center: 0.505, depth: 0.48, sway: 0.05, phase: 1.35, f1: 6.2, f2: 10.8, speed: 0.1, fold: 46, foldSpeed: 0.72, stops: [[0, "rgba(40,211,176,0)"], [0.18, "rgba(43,232,188,0.11)"], [0.37, "rgba(65,208,181,0.43)"], [0.61, "rgba(38,117,155,0.16)"], [0.8, "rgba(16,54,86,0)"]], ray: [103, 227, 213], accent: [190, 255, 236] }
  ];

  function seededRandom() {
    seededRandom.seed = (seededRandom.seed * 1664525 + 1013904223) >>> 0;
    return seededRandom.seed / 4294967296;
  }
  seededRandom.seed = 72391;

  function rgba(rgb, alpha) { return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")"; }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStars();
    buildPines();
  }

  function buildStars() {
    var count = Math.round(Math.max(120, Math.min(330, width * height / 7200)));
    stars = [];
    for (var i = 0; i < count; i += 1) {
      stars.push({ x: seededRandom(), y: 0.045 + seededRandom() * 0.57, size: 0.35 + seededRandom() * 1.35, alpha: 0.24 + seededRandom() * 0.7, phase: seededRandom() * Math.PI * 2, cyan: seededRandom() > 0.72 });
    }
  }

  function buildPines() {
    pines = [];
    var count = Math.round(Math.max(23, Math.min(60, width / 26)));
    for (var i = 0; i < count; i += 1) {
      pines.push({ x: seededRandom(), height: 13 + seededRandom() * 55, width: 4 + seededRandom() * 13, layer: seededRandom() > 0.48 ? 1 : 0 });
    }
  }

  function drawSky() {
    var skyGradient = ctx.createLinearGradient(0, 0, 0, height);
    skyGradient.addColorStop(0, "#030610");
    skyGradient.addColorStop(0.34, "#071229");
    skyGradient.addColorStop(0.7, "#172145");
    skyGradient.addColorStop(1, "#070c1c");
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    var halo = ctx.createRadialGradient(width * 0.53, height * 0.5, 0, width * 0.53, height * 0.5, height * 0.72);
    halo.addColorStop(0, "rgba(53,87,126,0.18)");
    halo.addColorStop(0.42, "rgba(37,44,103,0.075)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height);

    var horizonGlow = ctx.createRadialGradient(width * 0.5, height * horizonRatio, 0, width * 0.5, height * horizonRatio, width * 0.65);
    horizonGlow.addColorStop(0, "rgba(55,188,176,0.2)");
    horizonGlow.addColorStop(0.38, "rgba(45,104,145,0.08)");
    horizonGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = horizonGlow;
    ctx.fillRect(0, height * 0.42, width, height * 0.58);
    ctx.restore();
  }

  function drawMoon() {
    var x = width * 0.82;
    var y = height * 0.18;
    var r = Math.max(8, Math.min(17, width * 0.009));
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.shadowBlur = 24;
    ctx.shadowColor = "rgba(176,220,255,0.34)";
    ctx.fillStyle = "rgba(205,232,255,0.82)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#071229";
    ctx.beginPath();
    ctx.arc(x + r * 0.42, y - r * 0.3, r * 0.94, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawStars() {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (var i = 0; i < stars.length; i += 1) {
      var star = stars[i];
      var twinkle = 0.72 + Math.sin(elapsed * (0.35 + star.size * 0.12) + star.phase) * 0.28;
      var alpha = star.alpha * twinkle * (0.82 + intensity * 0.18);
      ctx.fillStyle = star.cyan ? rgba([168, 232, 255], alpha) : rgba([232, 241, 255], alpha);
      ctx.beginPath();
      ctx.arc(star.x * width, star.y * height, star.size, 0, Math.PI * 2);
      ctx.fill();
      if (star.size > 1.15) {
        ctx.strokeStyle = rgba([195, 230, 255], alpha * 0.33);
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.moveTo(star.x * width - 4, star.y * height);
        ctx.lineTo(star.x * width + 4, star.y * height);
        ctx.moveTo(star.x * width, star.y * height - 4);
        ctx.lineTo(star.x * width, star.y * height + 4);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function curtainPoint(curtain, normalizedX, t) {
    var sway = Math.sin(normalizedX * curtain.f1 + t * curtain.speed + curtain.phase) * curtain.sway;
    sway += Math.sin(normalizedX * curtain.f2 - t * curtain.speed * 1.7 + curtain.phase * 2.4) * curtain.sway * 0.32;
    sway += Math.sin(normalizedX * 2.15 + t * 0.11 + curtain.phase) * curtain.sway * 0.22;
    var fold = 0.5 + Math.sin(normalizedX * curtain.fold + t * curtain.foldSpeed + curtain.phase) * 0.5;
    var center = height * (curtain.center + sway + (pointer.x - 0.5) * 0.018);
    var top = center - height * curtain.depth * (0.52 + fold * 0.1);
    var bottom = center + height * curtain.depth * (0.39 + fold * 0.2);
    return { top: top, bottom: bottom, fold: fold };
  }

  function curtainGradient(curtain) {
    var gradient = ctx.createLinearGradient(0, 0, 0, height);
    for (var i = 0; i < curtain.stops.length; i += 1) gradient.addColorStop(curtain.stops[i][0], curtain.stops[i][1]);
    return gradient;
  }

  function drawCurtain(curtain, t, soft) {
    var step = soft ? 10 : 7;
    var top = [];
    var bottom = [];
    for (var x = -step; x <= width + step; x += step) {
      var point = curtainPoint(curtain, x / width, t);
      top.push({ x: x, y: point.top });
      bottom.push({ x: x, y: point.bottom });
    }

    ctx.beginPath();
    for (var i = 0; i < top.length; i += 1) {
      if (i === 0) ctx.moveTo(top[i].x, top[i].y);
      else ctx.lineTo(top[i].x, top[i].y);
    }
    for (var j = bottom.length - 1; j >= 0; j -= 1) ctx.lineTo(bottom[j].x, bottom[j].y);
    ctx.closePath();
    ctx.fillStyle = curtainGradient(curtain);
    ctx.globalAlpha = (soft ? 0.86 : 0.77) * intensity;
    ctx.fill();
    if (soft) return;

    ctx.lineCap = "round";
    ctx.lineWidth = 0.8;
    for (var rayX = -5; rayX < width + 5; rayX += 11) {
      var ray = curtainPoint(curtain, rayX / width, t);
      var foldLight = Math.pow(0.22 + ray.fold * 0.78, 1.8);
      var rayGradient = ctx.createLinearGradient(rayX, ray.top, rayX, ray.bottom);
      rayGradient.addColorStop(0, "rgba(255,255,255,0)");
      rayGradient.addColorStop(0.34, rgba(curtain.ray, 0.1 + foldLight * 0.48));
      rayGradient.addColorStop(0.58, rgba(curtain.accent, 0.13 + foldLight * 0.5));
      rayGradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = rayGradient;
      ctx.globalAlpha = (0.16 + foldLight * 0.6) * intensity;
      ctx.beginPath();
      ctx.moveTo(rayX, ray.top);
      ctx.lineTo(rayX + Math.sin(t * 0.32 + rayX * 0.01) * 2.2, ray.bottom);
      ctx.stroke();
    }
  }

  function drawAurora(t, reflection) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    if (reflection) {
      ctx.filter = "blur(18px)";
      for (var r = 0; r < curtains.length; r += 1) drawCurtain(curtains[r], t, true);
      ctx.filter = "none";
      for (var s = 0; s < curtains.length; s += 1) drawCurtain(curtains[s], t, false);
    } else {
      ctx.filter = "blur(25px)";
      for (var i = 0; i < curtains.length; i += 1) drawCurtain(curtains[i], t, true);
      ctx.filter = "none";
      for (var j = 0; j < curtains.length; j += 1) drawCurtain(curtains[j], t, false);
    }
    ctx.restore();
  }

  function drawWaterBase() {
    var horizon = height * horizonRatio;
    var water = ctx.createLinearGradient(0, horizon, 0, height);
    water.addColorStop(0, "rgba(15,34,58,0.44)");
    water.addColorStop(0.2, "rgba(7,20,39,0.78)");
    water.addColorStop(1, "rgba(2,5,15,0.98)");
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, width, height - horizon);
  }

  function drawReflection(t) {
    var horizon = height * horizonRatio;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon, width, height - horizon);
    ctx.clip();
    ctx.translate(0, horizon * 2);
    ctx.scale(1, -1);
    drawAurora(t, true);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.11 * intensity;
    ctx.filter = "blur(11px)";
    var glow = ctx.createRadialGradient(width * (0.46 + (pointer.x - 0.5) * 0.08), horizon + 5, 0, width * 0.5, horizon, width * 0.58);
    glow.addColorStop(0, "rgba(91,246,208,0.75)");
    glow.addColorStop(0.45, "rgba(68,137,204,0.2)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizon, width, height - horizon);
    ctx.restore();
  }

  function mountainPath(base, amplitude, seedOffset) {
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, base);
    for (var x = 0; x <= width + 20; x += 16) {
      var nx = x / width;
      var y = base - height * amplitude * (0.46 + Math.sin(nx * (5.2 + seedOffset) + seedOffset) * 0.25 + Math.sin(nx * (13.5 - seedOffset * 0.4) + 1.8) * 0.16 + Math.sin(nx * 31 + seedOffset * 2.2) * 0.07);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
  }

  function drawLandscape() {
    var horizon = height * horizonRatio;
    mountainPath(horizon + height * 0.017, 0.14, 1.4);
    ctx.fillStyle = "rgba(10,28,52,0.9)";
    ctx.fill();
    mountainPath(horizon + height * 0.035, 0.095, 3.6);
    ctx.fillStyle = "rgba(6,18,35,0.98)";
    ctx.fill();
    mountainPath(horizon + height * 0.05, 0.054, 5.1);
    ctx.fillStyle = "#040a17";
    ctx.fill();

    ctx.save();
    ctx.fillStyle = "#02050d";
    for (var i = 0; i < pines.length; i += 1) {
      var pine = pines[i];
      var base = horizon + height * (pine.layer ? 0.026 : 0.047) - pine.height * 0.04;
      var x = pine.x * width;
      var pineHeight = pine.height * (pine.layer ? 0.72 : 1);
      ctx.beginPath();
      ctx.moveTo(x, base - pineHeight);
      ctx.lineTo(x - pine.width * 0.25, base - pineHeight * 0.56);
      ctx.lineTo(x - pine.width * 0.52, base - pineHeight * 0.53);
      ctx.lineTo(x - pine.width * 0.15, base - pineHeight * 0.33);
      ctx.lineTo(x - pine.width * 0.7, base - pineHeight * 0.29);
      ctx.lineTo(x, base);
      ctx.lineTo(x + pine.width * 0.7, base - pineHeight * 0.29);
      ctx.lineTo(x + pine.width * 0.15, base - pineHeight * 0.33);
      ctx.lineTo(x + pine.width * 0.52, base - pineHeight * 0.53);
      ctx.lineTo(x + pine.width * 0.25, base - pineHeight * 0.56);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRipples() {
    var horizon = height * horizonRatio;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.lineCap = "round";
    for (var i = 0; i < 29; i += 1) {
      var y = horizon + 14 + Math.pow(i / 29, 1.55) * (height - horizon - 23);
      var spread = 35 + (y - horizon) * 0.48;
      var center = width * (0.49 + (pointer.x - 0.5) * 0.12) + Math.sin(i * 2.7) * width * 0.08;
      var alpha = (0.13 - i * 0.0026) * intensity;
      ctx.strokeStyle = i % 4 === 0 ? rgba([144, 220, 228], alpha) : rgba([62, 143, 177], alpha * 0.75);
      ctx.lineWidth = i < 5 ? 1.1 : 0.7;
      ctx.beginPath();
      ctx.moveTo(center - spread, y);
      ctx.bezierCurveTo(center - spread * 0.35, y - 2.5, center + spread * 0.24, y + 2.2, center + spread, y - 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function vignette() {
    var vignetteGradient = ctx.createRadialGradient(width * 0.5, height * 0.44, height * 0.16, width * 0.5, height * 0.45, Math.max(width, height) * 0.72);
    vignetteGradient.addColorStop(0, "rgba(0,0,0,0)");
    vignetteGradient.addColorStop(0.72, "rgba(0,0,0,0.11)");
    vignetteGradient.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = vignetteGradient;
    ctx.fillRect(0, 0, width, height);
  }

  function render() {
    var horizon = height * horizonRatio;
    drawSky();
    drawStars();
    drawMoon();
    drawAurora(elapsed, false);
    drawWaterBase();
    drawReflection(elapsed);
    drawLandscape();
    drawRipples();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.16 * intensity;
    var horizonLine = ctx.createLinearGradient(0, horizon, width, horizon);
    horizonLine.addColorStop(0, "rgba(36,129,150,0)");
    horizonLine.addColorStop(0.5, "rgba(126,243,211,0.76)");
    horizonLine.addColorStop(1, "rgba(36,129,150,0)");
    ctx.fillStyle = horizonLine;
    ctx.fillRect(0, horizon - 1, width, 2);
    ctx.restore();
    vignette();
  }

  function frame(now) {
    if (!lastFrame) lastFrame = now;
    var dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    if (isMoving) elapsed += dt;
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 4);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 4);
    render();
    window.requestAnimationFrame(frame);
  }

  function setMotion(next) {
    isMoving = next;
    motionButton.setAttribute("aria-pressed", String(next));
    motionButton.innerHTML = next ? '<span class="button-icon">◌</span> Пауза' : '<span class="button-icon">▶</span> Продолжить';
    sceneState.textContent = next ? "Движение включено" : "Сцена заморожена";
  }

  window.addEventListener("resize", resize);
  canvas.addEventListener("pointermove", function (event) {
    pointer.tx = event.clientX / Math.max(1, width);
    pointer.ty = event.clientY / Math.max(1, height);
  });
  canvas.addEventListener("pointerleave", function () {
    pointer.tx = 0.5;
    pointer.ty = 0.5;
  });
  motionButton.addEventListener("click", function () { setMotion(!isMoving); });
  hudButton.addEventListener("click", function () {
    var hidden = hud.classList.toggle("is-hidden");
    hudButton.setAttribute("aria-pressed", String(!hidden));
  });
  intensityInput.addEventListener("input", function () { intensity = Number(intensityInput.value); });

  resize();
  window.requestAnimationFrame(frame);
}());
