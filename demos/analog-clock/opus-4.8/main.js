"use strict";

(() => {
  const canvas = document.getElementById("clock");
  const ctx = canvas.getContext("2d");

  let w = 0, h = 0, dpr = 1;

  const state = {
    motion: "tick",     // "tick" | "sweep"
    numerals: "arabic",  // "arabic" | "roman"
    theme: "classic",    // "classic" | "dark"
  };

  const themes = {
    classic: {
      wallA: "#e7ebf0", wallB: "#9aa2ad",
      bezelA: "#fdffff", bezelB: "#c2cad4", bezelC: "#717a86", bezelD: "#eef2f6",
      groove: "rgba(0,0,0,0.30)",
      faceA: "#fdfaf3", faceB: "#efe7d6", faceC: "#dccfb6",
      vignette: "rgba(120,100,60,0.16)",
      tickStrong: "#23211c", tickWeak: "#6f6a5e",
      numerals: "#211f1a",
      brand: "#9b9279",
      hour: "#1b1a17", minute: "#1b1a17", second: "#c4302b",
      cap: "#262320", capRim: "#0c0b09",
      glass: "rgba(255,255,255,0.20)",
    },
    dark: {
      wallA: "#2a3038", wallB: "#0c0f14",
      bezelA: "#d7dee7", bezelB: "#79818d", bezelC: "#363b43", bezelD: "#aeb6c1",
      groove: "rgba(0,0,0,0.55)",
      faceA: "#222831", faceB: "#171c24", faceC: "#0d1118",
      vignette: "rgba(0,0,0,0.40)",
      tickStrong: "#eef1f5", tickWeak: "#7e8794",
      numerals: "#eef1f5",
      brand: "#8a93a0",
      hour: "#f1f4f8", minute: "#f1f4f8", second: "#ff5b52",
      cap: "#e9edf2", capRim: "#0b0d11",
      glass: "rgba(255,255,255,0.10)",
    },
  };

  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function roundRectPath(x, y, ww, hh, r) {
    r = Math.min(r, ww / 2, hh / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + ww, y, x + ww, y + hh, r);
    ctx.arcTo(x + ww, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + ww, y, r);
    ctx.closePath();
  }

  // лёгкий «отскок» при тике секундной стрелки
  function easeOutBack(x) {
    const c1 = 2.4, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  function drawWall(t) {
    const g = ctx.createRadialGradient(
      w * 0.5, h * 0.4, Math.min(w, h) * 0.08,
      w * 0.5, h * 0.55, Math.max(w, h) * 0.78
    );
    g.addColorStop(0, t.wallA);
    g.addColorStop(1, t.wallB);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function drawFace(cx, cy, R, t) {
    // тень корпуса + металлический обод
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.40)";
    ctx.shadowBlur = R * 0.14;
    ctx.shadowOffsetX = R * 0.02;
    ctx.shadowOffsetY = R * 0.07;
    const bz = ctx.createLinearGradient(cx - R, cy - R * 1.05, cx + R, cy + R * 1.05);
    bz.addColorStop(0.00, t.bezelA);
    bz.addColorStop(0.42, t.bezelB);
    bz.addColorStop(0.55, t.bezelC);
    bz.addColorStop(1.00, t.bezelD);
    ctx.fillStyle = bz;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // канавка между ободом и циферблатом
    ctx.strokeStyle = t.groove;
    ctx.lineWidth = R * 0.02;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.00, 0, Math.PI * 2);
    ctx.stroke();

    // сам циферблат
    const fg = ctx.createRadialGradient(
      cx - R * 0.22, cy - R * 0.26, R * 0.05,
      cx, cy, R * 1.0
    );
    fg.addColorStop(0, t.faceA);
    fg.addColorStop(0.72, t.faceB);
    fg.addColorStop(1, t.faceC);
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.97, 0, Math.PI * 2);
    ctx.fill();

    // мягкое виньетирование по краю циферблата
    const vg = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 0.97);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, t.vignette);
    ctx.fillStyle = vg;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.97, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTicks(cx, cy, R, t) {
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const sn = Math.sin(a), cs = Math.cos(a);
      const isHour = i % 5 === 0;
      const rOut = R * 0.90;
      const len = isHour ? R * 0.085 : R * 0.038;
      const rIn = rOut - len;
      ctx.strokeStyle = isHour ? t.tickStrong : t.tickWeak;
      ctx.lineWidth = isHour ? R * 0.020 : R * 0.0075;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx + sn * rIn, cy - cs * rIn);
      ctx.lineTo(cx + sn * rOut, cy - cs * rOut);
      ctx.stroke();
    }
  }

  function drawNumerals(cx, cy, R, t) {
    const rNum = R * 0.745;
    ctx.fillStyle = t.numerals;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const serif = state.numerals === "roman";
    const size = serif ? R * 0.125 : R * 0.135;
    ctx.font = `600 ${size}px ${serif ? "Georgia, 'Times New Roman', serif" : "'Helvetica Neue', Arial, sans-serif"}`;
    for (let n = 1; n <= 12; n++) {
      const a = (n / 12) * Math.PI * 2;
      const x = cx + Math.sin(a) * rNum;
      const y = cy - Math.cos(a) * rNum;
      ctx.fillText(state.numerals === "roman" ? ROMAN[n - 1] : String(n), x, y);
    }
  }

  function drawBrand(cx, cy, R, t) {
    ctx.fillStyle = t.brand;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.font = `600 ${R * 0.052}px 'Helvetica Neue', Arial, sans-serif`;
    drawSpaced("O P U S", cx, cy - R * 0.34);
    ctx.font = `500 ${R * 0.034}px 'Helvetica Neue', Arial, sans-serif`;
    drawSpaced("Q U A R T Z", cx, cy + R * 0.36);
    ctx.restore();
  }

  function drawSpaced(text, x, y) {
    ctx.fillText(text, x, y);
  }

  function hand(angle, draw) {
    ctx.save();
    ctx.translate(0, 0);
    ctx.rotate(angle);
    draw();
    ctx.restore();
  }

  function drawHands(cx, cy, R, secAngle, minAngle, hourAngle, t) {
    ctx.save();
    ctx.translate(cx, cy);

    // общая мягкая тень для всех стрелок
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.30)";
    ctx.shadowBlur = R * 0.03;
    ctx.shadowOffsetX = R * 0.012;
    ctx.shadowOffsetY = R * 0.022;

    // часовая
    hand(hourAngle, () => {
      ctx.fillStyle = t.hour;
      roundRectPath(-R * 0.024, -R * 0.50, R * 0.048, R * 0.50 + R * 0.135, R * 0.024);
      ctx.fill();
    });

    // минутная
    hand(minAngle, () => {
      ctx.fillStyle = t.minute;
      roundRectPath(-R * 0.016, -R * 0.745, R * 0.032, R * 0.745 + R * 0.155, R * 0.016);
      ctx.fill();
    });
    ctx.restore();

    // секундная — тонкая, поверх, со своей лёгкой тенью
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.22)";
    ctx.shadowBlur = R * 0.02;
    ctx.shadowOffsetX = R * 0.01;
    ctx.shadowOffsetY = R * 0.018;
    hand(secAngle, () => {
      ctx.fillStyle = t.second;
      // основной стержень
      roundRectPath(-R * 0.006, -R * 0.80, R * 0.012, R * 0.80 + R * 0.22, R * 0.006);
      ctx.fill();
      // противовес
      ctx.beginPath();
      ctx.arc(0, R * 0.16, R * 0.032, 0, Math.PI * 2);
      ctx.fill();
      // декоративное кольцо ближе к концу
      ctx.beginPath();
      ctx.arc(0, -R * 0.60, R * 0.028, 0, Math.PI * 2);
      ctx.lineWidth = R * 0.012;
      ctx.strokeStyle = t.second;
      ctx.stroke();
    });
    ctx.restore();

    // центральная ось-гайка
    const cap = ctx.createRadialGradient(-R * 0.01, -R * 0.01, R * 0.005, 0, 0, R * 0.05);
    cap.addColorStop(0, t.cap);
    cap.addColorStop(1, t.capRim);
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.045, 0, Math.PI * 2);
    ctx.fill();
    // крошечный штифт по центру в цвет секундной
    ctx.fillStyle = t.second;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.012, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawGlass(cx, cy, R, t) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.97, 0, Math.PI * 2);
    ctx.clip();
    const gg = ctx.createLinearGradient(cx - R, cy - R, cx + R * 0.3, cy + R * 0.25);
    gg.addColorStop(0, t.glass);
    gg.addColorStop(0.35, "rgba(255,255,255,0.04)");
    gg.addColorStop(0.6, "rgba(255,255,255,0)");
    ctx.fillStyle = gg;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
  }

  function computeAngles(now) {
    const ms = now.getMilliseconds();
    const s = now.getSeconds();
    const m = now.getMinutes();
    const hr = now.getHours();

    let secVal;
    if (state.motion === "sweep") {
      secVal = s + ms / 1000;
    } else {
      const f = ms / 1000;
      const tickDur = 0.13;
      const p = f < tickDur ? easeOutBack(f / tickDur) : 1;
      secVal = s - 1 + p; // от предыдущего деления к текущему с отскоком
    }
    const secAngle = (secVal / 60) * Math.PI * 2;

    // минутная и часовая — всегда непрерывно
    const minAngle = ((m + (s + ms / 1000) / 60) / 60) * Math.PI * 2;
    const hourAngle = (((hr % 12) + m / 60 + s / 3600) / 12) * Math.PI * 2;

    return { secAngle, minAngle, hourAngle };
  }

  function frame() {
    const t = themes[state.theme];
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.40;

    drawWall(t);
    drawFace(cx, cy, R, t);
    drawTicks(cx, cy, R, t);
    drawNumerals(cx, cy, R, t);
    drawBrand(cx, cy, R, t);

    const { secAngle, minAngle, hourAngle } = computeAngles(new Date());
    drawHands(cx, cy, R, secAngle, minAngle, hourAngle, t);
    drawGlass(cx, cy, R, t);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ── управление ──
  document.querySelectorAll(".seg").forEach((seg) => {
    const act = seg.dataset.act;
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      state[act] = btn.dataset.val;
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    });
  });
})();
