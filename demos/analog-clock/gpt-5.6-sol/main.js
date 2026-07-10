(function () {
  "use strict";

  const canvas = document.getElementById("clock");
  const context = canvas.getContext("2d", { alpha: true });
  const buttons = Array.from(document.querySelectorAll(".mode-button"));
  const modeName = document.getElementById("mode-name");
  const spokenTime = document.getElementById("spoken-time");

  const TAU = Math.PI * 2;
  const MAX_DPR = 2;
  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    cx: 0,
    cy: 0,
    radius: 0,
    mode: "sweep",
    staticLayer: document.createElement("canvas"),
    lastSpokenSecond: -1
  };

  try {
    const savedMode = localStorage.getItem("sol-clock-second-mode");
    if (savedMode === "tick" || savedMode === "sweep") state.mode = savedMode;
  } catch (_) {
    // Storage can be unavailable in strict sandboxed file:// contexts.
  }

  function polar(radius, angle) {
    return {
      x: Math.sin(angle) * radius,
      y: -Math.cos(angle) * radius
    };
  }

  function circle(ctx, x, y, radius) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    if (width === state.width && height === state.height && dpr === state.dpr) return;

    state.width = width;
    state.height = height;
    state.dpr = dpr;
    state.cx = width / 2;
    state.cy = height / 2;

    const heightRatio = height < 650 ? 0.335 : 0.39;
    state.radius = Math.max(76, Math.min(width * 0.42, height * heightRatio, 430));

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStaticLayer();
  }

  function buildStaticLayer() {
    const layer = state.staticLayer;
    layer.width = Math.round(state.width * state.dpr);
    layer.height = Math.round(state.height * state.dpr);
    const ctx = layer.getContext("2d");
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);

    drawAmbientShadow(ctx);
    ctx.save();
    ctx.translate(state.cx, state.cy);
    drawCase(ctx);
    drawDial(ctx);
    drawMinuteTrack(ctx);
    drawNumerals(ctx);
    drawSignature(ctx);
    ctx.restore();
  }

  function drawAmbientShadow(ctx) {
    const r = state.radius;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.48)";
    ctx.shadowColor = "rgba(0, 0, 0, 0.62)";
    ctx.shadowBlur = r * 0.11;
    ctx.shadowOffsetY = r * 0.065;
    circle(ctx, state.cx, state.cy, r * 1.025);
    ctx.fill();
    ctx.restore();
  }

  function drawCase(ctx) {
    const r = state.radius;

    const metal = ctx.createLinearGradient(-r, -r, r, r);
    metal.addColorStop(0, "#3f4445");
    metal.addColorStop(0.12, "#d3c9b5");
    metal.addColorStop(0.25, "#77776f");
    metal.addColorStop(0.47, "#eee5d1");
    metal.addColorStop(0.64, "#6a6a65");
    metal.addColorStop(0.82, "#c7bda9");
    metal.addColorStop(1, "#34393a");
    circle(ctx, 0, 0, r * 1.035);
    ctx.fillStyle = metal;
    ctx.fill();

    ctx.lineWidth = r * 0.012;
    ctx.strokeStyle = "rgba(255, 250, 232, 0.48)";
    ctx.stroke();

    const innerMetal = ctx.createRadialGradient(-r * 0.22, -r * 0.28, r * 0.12, 0, 0, r);
    innerMetal.addColorStop(0, "#bdb7a9");
    innerMetal.addColorStop(0.72, "#686a67");
    innerMetal.addColorStop(0.9, "#2f3434");
    innerMetal.addColorStop(1, "#171b1b");
    circle(ctx, 0, 0, r * 0.986);
    ctx.fillStyle = innerMetal;
    ctx.fill();

    ctx.lineWidth = r * 0.018;
    ctx.strokeStyle = "rgba(24, 27, 26, 0.75)";
    ctx.stroke();
  }

  function drawDial(ctx) {
    const r = state.radius;
    const dialRadius = r * 0.925;
    const enamel = ctx.createRadialGradient(-r * 0.25, -r * 0.32, r * 0.04, 0, 0, dialRadius);
    enamel.addColorStop(0, "#fffdf4");
    enamel.addColorStop(0.5, "#f2ecdc");
    enamel.addColorStop(0.84, "#e7deca");
    enamel.addColorStop(1, "#cfc3aa");
    circle(ctx, 0, 0, dialRadius);
    ctx.fillStyle = enamel;
    ctx.fill();

    ctx.lineWidth = r * 0.007;
    ctx.strokeStyle = "rgba(86, 75, 57, 0.32)";
    ctx.stroke();

    const vignette = ctx.createRadialGradient(0, 0, r * 0.58, 0, 0, dialRadius);
    vignette.addColorStop(0, "rgba(72, 55, 33, 0)");
    vignette.addColorStop(0.86, "rgba(72, 55, 33, 0.025)");
    vignette.addColorStop(1, "rgba(72, 55, 33, 0.14)");
    circle(ctx, 0, 0, dialRadius);
    ctx.fillStyle = vignette;
    ctx.fill();
  }

  function drawMinuteTrack(ctx) {
    const r = state.radius;
    ctx.save();
    ctx.lineCap = "round";

    for (let index = 0; index < 60; index += 1) {
      const major = index % 5 === 0;
      const angle = index * TAU / 60;
      const outer = polar(r * 0.855, angle);
      const inner = polar(r * (major ? 0.775 : 0.818), angle);
      ctx.beginPath();
      ctx.moveTo(inner.x, inner.y);
      ctx.lineTo(outer.x, outer.y);
      ctx.lineWidth = r * (major ? 0.018 : 0.0062);
      ctx.strokeStyle = major ? "#242726" : "rgba(48, 48, 44, 0.72)";
      ctx.stroke();
    }

    circle(ctx, 0, 0, r * 0.744);
    ctx.lineWidth = r * 0.0025;
    ctx.strokeStyle = "rgba(73, 66, 53, 0.18)";
    ctx.stroke();
    ctx.restore();
  }

  function drawNumerals(ctx) {
    const r = state.radius;
    const fontSize = r * 0.122;
    ctx.save();
    ctx.fillStyle = "#242625";
    ctx.font = `600 ${fontSize}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let number = 1; number <= 12; number += 1) {
      const point = polar(r * 0.635, number * TAU / 12);
      ctx.fillText(String(number), point.x, point.y + fontSize * 0.035);
    }
    ctx.restore();
  }

  function drawSignature(ctx) {
    const r = state.radius;
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(41, 42, 39, 0.72)";
    ctx.font = `700 ${r * 0.043}px 'Segoe UI', Arial, sans-serif`;
    ctx.fillText("SOL", 0, -r * 0.27);
    ctx.fillStyle = "rgba(41, 42, 39, 0.5)";
    ctx.font = `500 ${r * 0.022}px 'Segoe UI', Arial, sans-serif`;
    ctx.fillText("PRECISION · 2026", 0, r * 0.34);
    ctx.restore();
  }

  function drawHand(ctx, angle, length, tail, baseWidth, tipWidth, color) {
    ctx.save();
    ctx.rotate(angle);
    ctx.shadowColor = "rgba(27, 23, 18, 0.34)";
    ctx.shadowBlur = state.radius * 0.018;
    ctx.shadowOffsetX = state.radius * 0.012;
    ctx.shadowOffsetY = state.radius * 0.014;

    const r = state.radius;
    ctx.beginPath();
    ctx.moveTo(-baseWidth * r, tail * r);
    ctx.lineTo(-tipWidth * r, -length * r);
    ctx.quadraticCurveTo(0, -(length + 0.018) * r, tipWidth * r, -length * r);
    ctx.lineTo(baseWidth * r, tail * r);
    ctx.quadraticCurveTo(0, (tail + 0.028) * r, -baseWidth * r, tail * r);
    ctx.closePath();

    const handGradient = ctx.createLinearGradient(-baseWidth * r, 0, baseWidth * r, 0);
    handGradient.addColorStop(0, color.edge);
    handGradient.addColorStop(0.45, color.face);
    handGradient.addColorStop(0.72, color.highlight);
    handGradient.addColorStop(1, color.edge);
    ctx.fillStyle = handGradient;
    ctx.fill();
    ctx.lineWidth = Math.max(0.7, r * 0.003);
    ctx.strokeStyle = color.stroke;
    ctx.stroke();
    ctx.restore();
  }

  function drawSecondHand(ctx, angle) {
    const r = state.radius;
    ctx.save();
    ctx.rotate(angle);
    ctx.shadowColor = "rgba(38, 20, 17, 0.3)";
    ctx.shadowBlur = r * 0.012;
    ctx.shadowOffsetX = r * 0.009;
    ctx.shadowOffsetY = r * 0.01;
    ctx.strokeStyle = "#a83d36";
    ctx.fillStyle = "#a83d36";
    ctx.lineWidth = Math.max(1.2, r * 0.006);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, r * 0.205);
    ctx.lineTo(0, -r * 0.765);
    ctx.stroke();
    circle(ctx, 0, r * 0.185, r * 0.058);
    ctx.lineWidth = r * 0.012;
    ctx.stroke();
    circle(ctx, 0, r * 0.185, r * 0.034);
    ctx.fillStyle = "#eee5d2";
    ctx.fill();
    ctx.restore();
  }

  function drawHub(ctx) {
    const r = state.radius;
    ctx.save();
    ctx.shadowColor = "rgba(18, 15, 11, 0.45)";
    ctx.shadowBlur = r * 0.02;
    ctx.shadowOffsetY = r * 0.009;

    let cap = ctx.createRadialGradient(-r * 0.018, -r * 0.018, r * 0.005, 0, 0, r * 0.052);
    cap.addColorStop(0, "#f5e3b6");
    cap.addColorStop(0.32, "#b78c45");
    cap.addColorStop(0.72, "#604723");
    cap.addColorStop(1, "#211b13");
    circle(ctx, 0, 0, r * 0.052);
    ctx.fillStyle = cap;
    ctx.fill();

    cap = ctx.createRadialGradient(-r * 0.012, -r * 0.012, 0, 0, 0, r * 0.027);
    cap.addColorStop(0, "#fff1c8");
    cap.addColorStop(0.45, "#c69a50");
    cap.addColorStop(1, "#6f5028");
    circle(ctx, 0, 0, r * 0.027);
    ctx.fillStyle = cap;
    ctx.fill();
    ctx.restore();
  }

  function drawGlass(ctx) {
    const r = state.radius;
    ctx.save();
    circle(ctx, 0, 0, r * 0.92);
    ctx.clip();

    const sheen = ctx.createLinearGradient(-r * 0.7, -r * 0.8, r * 0.7, r * 0.8);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.16)");
    sheen.addColorStop(0.19, "rgba(255, 255, 255, 0.025)");
    sheen.addColorStop(0.54, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(0.81, "rgba(255, 255, 255, 0.035)");
    sheen.addColorStop(1, "rgba(255, 255, 255, 0.1)");
    ctx.fillStyle = sheen;
    ctx.fillRect(-r, -r, r * 2, r * 2);

    ctx.beginPath();
    ctx.ellipse(-r * 0.25, -r * 0.33, r * 0.61, r * 0.22, -0.64, Math.PI * 1.07, Math.PI * 1.72);
    ctx.lineWidth = r * 0.036;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.085)";
    ctx.stroke();
    ctx.restore();

    circle(ctx, 0, 0, r * 0.919);
    ctx.lineWidth = r * 0.008;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.stroke();
  }

  function mechanicalSecond(totalSeconds) {
    const whole = Math.floor(totalSeconds);
    const phase = totalSeconds - whole;
    const duration = 0.115;
    if (phase >= duration) return whole;

    const t = phase / duration;
    const overshoot = 1.45;
    const eased = 1 + (overshoot + 1) * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2);
    return whole - 1 + eased;
  }

  function drawFrame() {
    resize();
    const now = new Date();
    const milliseconds = now.getMilliseconds();
    const seconds = now.getSeconds() + milliseconds / 1000;
    const minutes = now.getMinutes() + seconds / 60;
    const hours = (now.getHours() % 12) + minutes / 60;
    const secondValue = state.mode === "sweep" ? seconds : mechanicalSecond(seconds);

    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    context.clearRect(0, 0, state.width, state.height);
    context.drawImage(
      state.staticLayer,
      0, 0, state.staticLayer.width, state.staticLayer.height,
      0, 0, state.width, state.height
    );

    context.save();
    context.translate(state.cx, state.cy);
    drawHand(context, hours * TAU / 12, 0.47, 0.105, 0.041, 0.012, {
      edge: "#171b1b", face: "#343a39", highlight: "#59605d", stroke: "#101313"
    });
    drawHand(context, minutes * TAU / 60, 0.69, 0.125, 0.031, 0.008, {
      edge: "#171b1b", face: "#303534", highlight: "#5b625f", stroke: "#101313"
    });
    drawSecondHand(context, secondValue * TAU / 60);
    drawHub(context);
    drawGlass(context);
    context.restore();

    const currentSecond = now.getSeconds();
    if (currentSecond !== state.lastSpokenSecond) {
      state.lastSpokenSecond = currentSecond;
      spokenTime.textContent = now.toLocaleTimeString("ru-RU");
    }

    requestAnimationFrame(drawFrame);
  }

  function setMode(mode) {
    state.mode = mode;
    buttons.forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    modeName.textContent = mode === "sweep" ? "Плавный ход" : "Механический тик";
    try {
      localStorage.setItem("sol-clock-second-mode", mode);
    } catch (_) {
      // Preference remains active for the current session.
    }
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener("resize", resize, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resize, { passive: true });
  }

  setMode(state.mode);
  resize();
  requestAnimationFrame(drawFrame);
})();
