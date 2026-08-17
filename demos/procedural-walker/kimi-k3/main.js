(() => {
  'use strict';

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const slider = document.getElementById('speed');
  const speedVal = document.getElementById('speed-val');
  const gaitLabel = document.getElementById('gait-label');

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // ---------- canvas / DPR ----------
  let W = 0;
  let H = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- состояние ----------
  let phase = 0;      // фаза цикла походки [0,1)
  let camX = 0;       // пройденный путь (мир прокручивается влево)
  let last = performance.now();

  // ---------- параметры, зависящие от ползунка ----------
  function gaitParams() {
    const t = slider.value / 100;                 // 0..1
    const run = smoothstep(0.42, 0.74, t);        // смесь ходьба/бег
    const legLen = clamp(H * 0.26, 110, 270);     // суммарная длина ноги (бедро+голень)
    const stride = lerp(legLen * 0.62, legLen * 1.05, t); // длина шага
    const v = lerp(legLen * 0.55, legLen * 4.4, t);       // скорость земли, px/s
    const cadence = v / (2 * stride);             // циклов в секунду
    return {
      t,
      run,
      legLen,
      thigh: legLen * 0.5,
      shin: legLen * 0.5,
      stride,
      v,
      cadence,
      stanceFrac: lerp(0.62, 0.34, run),          // доля фазы опоры (<0.5 у бега -> фаза полёта)
      lift: lerp(legLen * 0.10, legLen * 0.24, run), // высота подъёма стопы при переносе
      hipH: legLen * lerp(0.94, 0.86, run),       // высота таза (бег — присед)
      bobAmp: legLen * lerp(0.028, 0.075, run),   // вертикальное покачивание
      lean: lerp(0.06, 0.32, run),                // наклон корпуса вперёд, рад
      armAmp: lerp(0.35, 0.75, run),              // размах рук, рад
      elbow: lerp(0.25, 1.45, run),               // сгиб локтя, рад
      torsoLen: legLen * 0.58,
      upperArm: legLen * 0.33,
      foreArm: legLen * 0.31,
      headR: legLen * 0.13,
      anchorX: W * 0.42,
      groundY: H * 0.78,
    };
  }

  // ---------- траектория стопы (без скольжения в фазе опоры) ----------
  // В фазе опоры стопа в экранных координатах движется ровно со скоростью земли:
  // footX = anchorX + A - (q/s)*(A+B), т.е. мировая координата стопы неподвижна.
  function footPos(q, p) {
    const s = p.stanceFrac;
    const A = p.stride * 0.55; // стопа ставится впереди таза
    const B = p.stride * 0.45; // отрыв позади таза
    if (q < s) {
      const k = q / s;
      return {
        x: p.anchorX + A - k * (A + B),
        y: p.groundY,
        stance: true,
      };
    }
    const u = (q - s) / (1 - s);
    const e = u * u * (3 - 2 * u); // плавный перенос
    return {
      x: p.anchorX - B + e * (A + B),
      y: p.groundY - Math.sin(Math.PI * u) * p.lift,
      stance: false,
    };
  }

  // ---------- двухзвенная обратная кинематика ----------
  // Возвращает колено и (при необходимости подтянутую) стопу; колено выбирается «вперёд».
  function solveIK(hx, hy, fx, fy, l1, l2) {
    let dx = fx - hx;
    let dy = fy - hy;
    let d = Math.hypot(dx, dy);
    const minD = Math.abs(l1 - l2) + 0.001;
    const maxD = l1 + l2 - 0.001;
    if (d > maxD) {
      dx *= maxD / d;
      dy *= maxD / d;
      d = maxD;
    } else if (d < minD) {
      d = minD;
    }
    const a = Math.atan2(dy, dx);
    const cosB = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const b = Math.acos(cosB);
    const k1x = hx + l1 * Math.cos(a + b);
    const k1y = hy + l1 * Math.sin(a + b);
    const k2x = hx + l1 * Math.cos(a - b);
    const k2y = hy + l1 * Math.sin(a - b);
    const useFirst = k1x >= k2x; // колено смотрит вперёд (фигура идёт вправо)
    return {
      kx: useFirst ? k1x : k2x,
      ky: useFirst ? k1y : k2y,
      fx: hx + dx,
      fy: hy + dy,
    };
  }

  // ---------- рисование ----------
  function limb(x1, y1, x2, y2, x3, y3, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.stroke();
  }

  function drawLeg(hip, foot, p, color, width) {
    const ik = solveIK(hip.x, hip.y, foot.x, foot.y, p.thigh, p.shin);
    limb(hip.x, hip.y, ik.kx, ik.ky, ik.fx, ik.fy, width, color);
    // стопа — короткий горизонтальный штрих вперёд от щиколотки
    const fl = p.legLen * 0.09;
    ctx.beginPath();
    ctx.moveTo(ik.fx - fl * 0.35, ik.fy);
    ctx.lineTo(ik.fx + fl, ik.fy);
    ctx.stroke();
  }

  function drawArm(shoulder, armPhase, p, color, width) {
    const swing = p.armAmp * Math.sin(armPhase * Math.PI * 2);
    const th = swing;                        // угол плеча от вертикали (вперёд — +x)
    const ex = shoulder.x + Math.sin(th) * p.upperArm;
    const ey = shoulder.y + Math.cos(th) * p.upperArm;
    const th2 = th + p.elbow;                // локоть согнут вперёд
    const hx = ex + Math.sin(th2) * p.foreArm;
    const hy = ey + Math.cos(th2) * p.foreArm;
    limb(shoulder.x, shoulder.y, ex, ey, hx, hy, width, color);
  }

  function drawGround(p) {
    const gy = p.groundY;

    // дальний параллакс-слой
    ctx.strokeStyle = 'rgba(110, 140, 190, 0.14)';
    ctx.lineWidth = 2;
    const farSpacing = 160;
    let off = (camX * 0.35) % farSpacing;
    ctx.beginPath();
    for (let x = -off; x < W + farSpacing; x += farSpacing) {
      ctx.moveTo(x, gy - 46);
      ctx.lineTo(x + 26, gy - 46);
    }
    ctx.stroke();

    // линия земли
    ctx.strokeStyle = 'rgba(150, 180, 230, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, gy + 1);
    ctx.lineTo(W, gy + 1);
    ctx.stroke();

    // засечки на земле, движутся со скоростью camX (как опорная стопа)
    const spacing = 90;
    off = camX % spacing;
    ctx.strokeStyle = 'rgba(150, 180, 230, 0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = -off; x < W + spacing; x += spacing) {
      ctx.moveTo(x, gy + 6);
      ctx.lineTo(x, gy + 14);
    }
    ctx.stroke();

    // мелкие камешки
    const peb = 47;
    const off2 = (camX * 1.0) % peb;
    ctx.fillStyle = 'rgba(150, 180, 230, 0.12)';
    for (let x = -off2; x < W + peb; x += peb) {
      const jitter = ((Math.sin(x * 12.9898) * 43758.5453) % 1 + 1) % 1;
      ctx.fillRect(x + jitter * 20, gy + 18 + jitter * 8, 4, 2);
    }
  }

  function draw(t) {
    const p = gaitParams();

    // фон
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0b1020');
    grad.addColorStop(0.75, '#101a36');
    grad.addColorStop(1, '#0d1428');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    drawGround(p);

    // вертикальное покачивание: ходьба — двойная частота, бег — одинарная (подскок)
    const bobWalk = 0.5 - 0.5 * Math.cos(phase * Math.PI * 4);
    const bobRun = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2 + Math.PI);
    const bob = -p.bobAmp * lerp(bobWalk, bobRun, p.run);

    const hip = { x: p.anchorX, y: p.groundY - p.hipH + bob };

    // корпус с наклоном вперёд
    const lean = p.lean + 0.02 * Math.sin(phase * Math.PI * 4);
    const shoulder = {
      x: hip.x + Math.sin(lean) * p.torsoLen,
      y: hip.y - Math.cos(lean) * p.torsoLen,
    };
    const headC = {
      x: shoulder.x + Math.sin(lean * 0.6) * p.headR * 1.9,
      y: shoulder.y - Math.cos(lean * 0.6) * p.headR * 1.9,
    };

    // тень
    const shadowScale = 1 - (p.groundY - hip.y - p.hipH) / (p.hipH * 0.6);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(hip.x, p.groundY + 4, p.legLen * 0.42 * clamp(shadowScale, 0.5, 1.1), 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // фазы ног: вторая в противофазе
    const q0 = phase - Math.floor(phase);
    const q1 = (phase + 0.5) - Math.floor(phase + 0.5);
    const foot0 = footPos(q0, p);
    const foot1 = footPos(q1, p);

    const wLeg = p.legLen * 0.05;
    const wArm = p.legLen * 0.042;
    const cBack = 'rgba(110, 140, 200, 0.55)';
    const cFront = '#eaf3ff';
    const cTorso = '#cfe2ff';

    // дальняя рука и нога (рука — в противофазе одноимённой ноге)
    drawArm(shoulder, q0 + 0.5, p, cBack, wArm);
    drawLeg(hip, foot1, p, cBack, wLeg);

    // таз — плечи
    ctx.strokeStyle = cTorso;
    ctx.lineWidth = wLeg * 1.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(shoulder.x, shoulder.y);
    ctx.stroke();

    // голова
    ctx.fillStyle = cTorso;
    ctx.beginPath();
    ctx.arc(headC.x, headC.y, p.headR, 0, Math.PI * 2);
    ctx.fill();
    // глаз — направление движения
    ctx.fillStyle = '#0b1020';
    ctx.beginPath();
    ctx.arc(headC.x + p.headR * 0.42, headC.y - p.headR * 0.12, p.headR * 0.16, 0, Math.PI * 2);
    ctx.fill();

    // ближняя нога и рука
    drawLeg(hip, foot0, p, cFront, wLeg * 1.05);
    drawArm(shoulder, q1 + 0.5, p, cFront, wArm);

    // показания
    const metersPerPx = 0.95 / p.legLen; // условно: длина ноги ≈ 0.95 м
    const kmh = p.v * metersPerPx * 3.6;
    speedVal.textContent = kmh.toFixed(1) + ' км/ч';
    gaitLabel.textContent = p.run > 0.6 ? 'бег' : (p.run > 0.15 ? 'быстрый шаг' : 'шаг');
  }

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = clamp(dt, 0, 0.05); // кламп больших dt (свёрнутая вкладка и т.п.)

    const p = gaitParams();
    camX += p.v * dt;
    phase = (phase + p.cadence * dt) % 1;

    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
