(function () {
  "use strict";

  var canvas = document.getElementById("clockCanvas");
  var ctx = canvas.getContext("2d", { alpha: false });
  var state = {
    width: 0,
    height: 0,
    dpr: 1,
    secondsMode: "sweep",
    numerals: "arabic",
    theme: "pearl"
  };

  var roman = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];

  document.querySelector(".controls").addEventListener("change", function (event) {
    var target = event.target;
    if (!target || target.type !== "radio" || !target.checked) {
      return;
    }
    state[target.name] = target.value;
  });

  window.addEventListener("resize", resize, { passive: true });
  resize();
  requestAnimationFrame(frame);

  function resize() {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = Math.max(1, window.innerWidth);
    state.height = Math.max(1, window.innerHeight);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    canvas.style.width = state.width + "px";
    canvas.style.height = state.height + "px";
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  function frame() {
    draw(new Date());
    requestAnimationFrame(frame);
  }

  function draw(date) {
    var w = state.width;
    var h = state.height;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawRoom(w, h);

    var radius = Math.min(w * 0.42, h * 0.39, 430);
    var cx = w / 2;
    var cy = h / 2 - Math.min(22, h * 0.025);

    drawCase(cx, cy, radius);
    drawDial(cx, cy, radius);
    drawTicks(cx, cy, radius);
    drawNumerals(cx, cy, radius);
    drawHands(cx, cy, radius, date);
    drawGlass(cx, cy, radius);
  }

  function drawRoom(w, h) {
    var bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#273133");
    bg.addColorStop(0.45, "#5b5b4f");
    bg.addColorStop(1, "#171b1d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    var vignette = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.68);
    vignette.addColorStop(0, "rgba(255,255,255,0.14)");
    vignette.addColorStop(0.58, "rgba(20,18,16,0.02)");
    vignette.addColorStop(1, "rgba(0,0,0,0.46)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = "#fff8dc";
    ctx.lineWidth = 1;
    for (var y = 0.5; y < h; y += 42) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCase(cx, cy, r) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.52)";
    ctx.shadowBlur = r * 0.1;
    ctx.shadowOffsetY = r * 0.075;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.115, 0, Math.PI * 2);
    var outer = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.08, cx, cy, r * 1.18);
    outer.addColorStop(0, "#fbfbf6");
    outer.addColorStop(0.2, "#bfc4c2");
    outer.addColorStop(0.46, "#5e6665");
    outer.addColorStop(0.68, "#ecede6");
    outer.addColorStop(0.84, "#6a706e");
    outer.addColorStop(1, "#242827");
    ctx.fillStyle = outer;
    ctx.fill();
    ctx.restore();

    ring(cx, cy, r * 1.075, r * 0.055, "#f7f3df", "rgba(0,0,0,0.28)");
    ring(cx, cy, r * 1.002, r * 0.026, "rgba(45,48,47,0.84)", "rgba(255,255,255,0.46)");
  }

  function drawDial(cx, cy, r) {
    var colors = themeColors();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.965, 0, Math.PI * 2);
    var dial = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.38, r * 0.1, cx, cy, r * 0.98);
    dial.addColorStop(0, colors.dialLight);
    dial.addColorStop(0.72, colors.dial);
    dial.addColorStop(1, colors.dialEdge);
    ctx.fillStyle = dial;
    ctx.fill();

    ctx.globalAlpha = state.theme === "pearl" ? 0.18 : 0.1;
    ctx.strokeStyle = colors.texture;
    ctx.lineWidth = 1;
    for (var i = 0; i < 36; i += 1) {
      var angle = i * Math.PI / 18;
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.18 + i * 0.018), angle, angle + Math.PI * 0.55);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.91, 0, Math.PI * 2);
    ctx.strokeStyle = colors.innerRing;
    ctx.lineWidth = Math.max(1.5, r * 0.006);
    ctx.stroke();
    ctx.restore();
  }

  function drawTicks(cx, cy, r) {
    var colors = themeColors();
    ctx.save();
    ctx.lineCap = "round";
    for (var i = 0; i < 60; i += 1) {
      var isHour = i % 5 === 0;
      var angle = i / 60 * Math.PI * 2 - Math.PI / 2;
      var outer = r * 0.86;
      var inner = isHour ? r * 0.755 : r * 0.81;
      var width = isHour ? Math.max(3, r * 0.017) : Math.max(1, r * 0.005);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.strokeStyle = isHour ? colors.majorTick : colors.minorTick;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawNumerals(cx, cy, r) {
    var colors = themeColors();
    ctx.save();
    ctx.fillStyle = colors.numeral;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 " + Math.round(r * 0.118) + "px Georgia, 'Times New Roman', serif";
    ctx.shadowColor = colors.textShadow;
    ctx.shadowBlur = r * 0.012;
    ctx.shadowOffsetY = r * 0.006;

    for (var i = 0; i < 12; i += 1) {
      var hour = i === 0 ? 12 : i;
      var label = state.numerals === "roman" ? roman[i] : String(hour);
      var angle = i / 12 * Math.PI * 2 - Math.PI / 2;
      var distance = r * 0.62;
      ctx.fillText(label, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance);
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = colors.brand;
    ctx.font = "600 " + Math.round(r * 0.038) + "px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PRECISION WALL CLOCK", cx, cy - r * 0.3);
    ctx.restore();
  }

  function drawHands(cx, cy, r, date) {
    var h = date.getHours() % 12;
    var m = date.getMinutes();
    var s = date.getSeconds();
    var ms = date.getMilliseconds();
    var exactSeconds = s + ms / 1000;
    var exactMinutes = m + exactSeconds / 60;
    var exactHours = h + exactMinutes / 60;
    var displaySeconds = state.secondsMode === "tick" ? tickSecondValue(s, ms) : exactSeconds;

    drawHand(cx, cy, r, exactHours / 12 * Math.PI * 2 - Math.PI / 2, r * 0.43, r * 0.055, "#222321", "#060707", r * 0.04);
    drawHand(cx, cy, r, exactMinutes / 60 * Math.PI * 2 - Math.PI / 2, r * 0.64, r * 0.036, "#262827", "#050606", r * 0.055);
    drawSecondHand(cx, cy, r, displaySeconds / 60 * Math.PI * 2 - Math.PI / 2);
    drawHub(cx, cy, r);
  }

  function tickSecondValue(second, ms) {
    var phase = ms / 1000;
    if (phase > 0.24) {
      return second;
    }
    var t = phase / 0.24;
    var kick = Math.sin(t * Math.PI) * Math.pow(1 - t, 1.55) * 0.42;
    return second + kick;
  }

  function drawHand(cx, cy, r, angle, length, width, fill, stroke, counterWeight) {
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    var sideX = Math.cos(angle + Math.PI / 2);
    var sideY = Math.sin(angle + Math.PI / 2);
    var base = width * 1.55;
    var neck = width * 0.44;
    var tail = counterWeight;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.34)";
    ctx.shadowBlur = r * 0.03;
    ctx.shadowOffsetX = r * 0.018;
    ctx.shadowOffsetY = r * 0.024;
    ctx.beginPath();
    ctx.moveTo(cx - cos * tail - sideX * neck, cy - sin * tail - sideY * neck);
    ctx.lineTo(cx + sideX * base, cy + sideY * base);
    ctx.lineTo(cx + cos * length, cy + sin * length);
    ctx.lineTo(cx - sideX * base, cy - sideY * base);
    ctx.lineTo(cx - cos * tail + sideX * neck, cy - sin * tail + sideY * neck);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, r * 0.005);
    ctx.fill();
    ctx.stroke();

    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.moveTo(cx + sideX * width * 0.18, cy + sideY * width * 0.18);
    ctx.lineTo(cx + cos * (length * 0.86), cy + sin * (length * 0.86));
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = Math.max(1, width * 0.18);
    ctx.stroke();
    ctx.restore();
  }

  function drawSecondHand(cx, cy, r, angle) {
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    var colors = themeColors();
    ctx.save();
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(0, 0, 0, 0.36)";
    ctx.shadowBlur = r * 0.028;
    ctx.shadowOffsetX = r * 0.018;
    ctx.shadowOffsetY = r * 0.022;

    ctx.beginPath();
    ctx.moveTo(cx - cos * r * 0.18, cy - sin * r * 0.18);
    ctx.lineTo(cx + cos * r * 0.72, cy + sin * r * 0.72);
    ctx.strokeStyle = colors.second;
    ctx.lineWidth = Math.max(1.5, r * 0.01);
    ctx.stroke();

    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.arc(cx - cos * r * 0.21, cy - sin * r * 0.21, r * 0.028, 0, Math.PI * 2);
    ctx.strokeStyle = colors.second;
    ctx.lineWidth = Math.max(1, r * 0.008);
    ctx.stroke();
    ctx.restore();
  }

  function drawHub(cx, cy, r) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = r * 0.022;
    ctx.shadowOffsetY = r * 0.016;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.064, 0, Math.PI * 2);
    var nut = ctx.createRadialGradient(cx - r * 0.025, cy - r * 0.03, 0, cx, cy, r * 0.07);
    nut.addColorStop(0, "#fff7c7");
    nut.addColorStop(0.35, "#cda74c");
    nut.addColorStop(0.7, "#755a24");
    nut.addColorStop(1, "#20180b");
    ctx.fillStyle = nut;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.34)";
    ctx.lineWidth = Math.max(1, r * 0.006);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.028, 0, Math.PI * 2);
    ctx.fillStyle = "#261b09";
    ctx.fill();
    ctx.restore();
  }

  function drawGlass(cx, cy, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.952, 0, Math.PI * 2);
    ctx.clip();

    var sheen = ctx.createLinearGradient(cx - r * 0.65, cy - r * 0.82, cx + r * 0.35, cy + r * 0.5);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.24, "rgba(255,255,255,0.28)");
    sheen.addColorStop(0.32, "rgba(255,255,255,0.08)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    ctx.beginPath();
    ctx.ellipse(cx - r * 0.27, cy - r * 0.42, r * 0.42, r * 0.16, -0.45, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.954, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.lineWidth = Math.max(1, r * 0.006);
    ctx.stroke();
    ctx.restore();
  }

  function ring(cx, cy, radius, lineWidth, light, dark) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    var stroke = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    stroke.addColorStop(0, light);
    stroke.addColorStop(0.35, dark);
    stroke.addColorStop(0.66, light);
    stroke.addColorStop(1, dark);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  function themeColors() {
    if (state.theme === "midnight") {
      return {
        dialLight: "#303844",
        dial: "#171d25",
        dialEdge: "#0b0f14",
        texture: "#c4d4d9",
        innerRing: "rgba(220,226,219,0.2)",
        majorTick: "#e8dfc0",
        minorTick: "rgba(232,223,192,0.58)",
        numeral: "#f0e9d2",
        textShadow: "rgba(0,0,0,0.48)",
        brand: "rgba(232,223,192,0.46)",
        second: "#d85241"
      };
    }
    return {
      dialLight: "#fff9e8",
      dial: "#eee5cc",
      dialEdge: "#c8b986",
      texture: "#8d7950",
      innerRing: "rgba(92,78,45,0.22)",
      majorTick: "#2d2b25",
      minorTick: "rgba(45,43,37,0.52)",
      numeral: "#28251e",
      textShadow: "rgba(255,255,255,0.52)",
      brand: "rgba(78,67,44,0.48)",
      second: "#ae2f28"
    };
  }
})();
