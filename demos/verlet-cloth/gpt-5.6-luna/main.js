(() => {
  "use strict";
  const canvas = document.getElementById("cloth-canvas");
  const ctx = canvas.getContext("2d");
  const stateLabel = document.getElementById("state-label");
  const pauseButton = document.getElementById("pause-button");
  const pauseLabel = document.getElementById("pause-label");
  const resetButton = document.getElementById("reset-button");
  const gravityInput = document.getElementById("gravity");
  const windInput = document.getElementById("wind");
  const tearInput = document.getElementById("tear");
  const gravityValue = document.getElementById("gravity-value");
  const windValue = document.getElementById("wind-value");
  const tearValue = document.getElementById("tear-value");
  const TAU = Math.PI * 2;
  const settings = { gravity: 980, wind: 24, tear: 1.7 };
  const pointer = { x: 0, y: 0, active: false, particle: null, id: null };
  let dpr = 1, width = 0, height = 0, cols = 0, rows = 0, spacing = 0;
  let particles = [], links = [], grid = [], linkMap = new Map();
  let running = true, elapsed = 0, lastTime = performance.now();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, amount) => a + (b - a) * amount;
  const linkKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;

  function setRangeProgress(input) {
    const amount = (input.value - input.min) / (input.max - input.min) * 100;
    input.style.setProperty("--progress", `${amount}%`);
  }
  function updateControls() {
    gravityValue.textContent = Math.round(settings.gravity);
    windValue.textContent = Math.round(settings.wind);
    tearValue.textContent = `${settings.tear.toFixed(2)}×`;
    [gravityInput, windInput, tearInput].forEach(setRangeProgress);
  }
  function makeParticle(x, y, pinned) {
    return { x, y, oldX: x, oldY: y, pinned, grabbed: false, torn: false, tearPulse: 0 };
  }
  function addLink(a, b, kind) {
    const pa = particles[a], pb = particles[b];
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const horizontal = Math.abs(dy) < spacing * .48;
    const slack = kind === "shear" ? 1.04 : (horizontal ? 1.065 : 1.035);
    const link = { a, b, rest: Math.hypot(dx, dy) * slack, kind, broken: false };
    links.push(link);
    linkMap.set(linkKey(a, b), link);
  }
  function findLink(a, b) { return linkMap.get(linkKey(a, b)); }

  function resetSimulation() {
    const clothWidth = Math.min(width * .72, 820);
    cols = clamp(Math.round(clothWidth / 28), 18, 34);
    rows = clamp(Math.round(Math.min(height * .58, 500) / 27), 13, 23);
    spacing = clothWidth / (cols - 1);
    const left = (width - spacing * (cols - 1)) * .5;
    const top = clamp(height * .16, 96, 146);
    const supportColumns = [0.08, 0.29, 0.5, 0.71, 0.92].map((ratio) => Math.round((cols - 1) * ratio));
    particles = []; links = []; grid = []; linkMap = new Map();

    for (let y = 0; y < rows; y += 1) {
      const row = [];
      for (let x = 0; x < cols; x += 1) {
        const pinned = y === 0 && supportColumns.includes(x);
        const nearestSupport = Math.min(...supportColumns.map((support) => Math.abs(support - x)));
        const topSlack = y === 0 ? Math.pow(clamp(nearestSupport / (cols * .12), 0, 1), 1.25) * 18 : 0;
        const ripple = y === 0 ? 0 : Math.sin(x * 2.3 + y) * .35;
        row.push(particles.length);
        particles.push(makeParticle(left + x * spacing, top + topSlack + y * spacing + ripple, pinned));
      }
      grid.push(row);
    }
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const index = grid[y][x];
        if (x < cols - 1) addLink(index, grid[y][x + 1], "structural");
        if (y < rows - 1) addLink(index, grid[y + 1][x], "structural");
        if (x < cols - 1 && y < rows - 1) addLink(index, grid[y + 1][x + 1], "shear");
        if (x > 0 && y < rows - 1) addLink(index, grid[y + 1][x - 1], "shear");
      }
    }
    elapsed = 0;
    pointer.particle = null;
    draw();
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    resetSimulation();
  }
  function isFixed(particle) { return particle.pinned || particle.grabbed; }

  function breakLink(link, dx, dy, distance) {
    link.broken = true;
    const nx = dx / distance, ny = dy / distance;
    const impulse = clamp((distance - link.rest) * 2.4, 2.5, 15);
    const a = particles[link.a], b = particles[link.b];
    [a, b].forEach((particle, index) => {
      particle.torn = true;
      particle.tearPulse = 1;
      if (isFixed(particle)) return;
      const direction = index === 0 ? 1 : -1;
      particle.oldX += nx * impulse * direction;
      particle.oldY += ny * impulse * direction;
    });
  }

  function simulate(dt) {
    elapsed += dt;
    const phase = elapsed * .72;
    const gust = .58 + Math.sin(phase) * .28 + Math.sin(phase * 1.83 + 1.2) * .2;
    const windForce = settings.wind * 18;
    const stepGravity = settings.gravity * dt * dt;
    const damping = Math.pow(.992, dt * 60);

    for (const particle of particles) {
      particle.tearPulse = Math.max(0, particle.tearPulse - dt * 1.8);
      if (isFixed(particle)) continue;
      const velocityX = (particle.x - particle.oldX) * damping;
      const velocityY = (particle.y - particle.oldY) * damping;
      particle.oldX = particle.x;
      particle.oldY = particle.y;
      const wave = Math.sin(particle.x * .021 + particle.y * .036 - elapsed * 2.45);
      const crossWave = Math.sin(particle.x * .047 - elapsed * 3.1 + particle.y * .012);
      const looseBoost = particle.torn ? 1.42 : 1;
      const windX = windForce * (gust + wave * .32 + crossWave * .12) * looseBoost;
      const windY = windForce * .43 * (wave * .8 + Math.sin(phase * 1.6 + particle.x * .018) * .3) * looseBoost;
      particle.x += velocityX + windX * dt * dt;
      particle.y += velocityY + stepGravity * (particle.torn ? 1.08 : 1) + windY * dt * dt;
    }

    for (let pass = 0; pass < 8; pass += 1) {
      for (const link of links) {
        if (link.broken) continue;
        const a = particles[link.a], b = particles[link.b];
        const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy) || .0001;
        if (distance > link.rest * settings.tear) {
          breakLink(link, dx, dy, distance);
          continue;
        }
        const correction = (distance - link.rest) / distance * .8;
        const moveA = isFixed(a) ? 0 : (isFixed(b) ? 1 : .5);
        const moveB = isFixed(b) ? 0 : (isFixed(a) ? 1 : .5);
        a.x += dx * correction * moveA;
        a.y += dy * correction * moveA;
        b.x -= dx * correction * moveB;
        b.y -= dy * correction * moveB;
      }
    }
    if (pointer.particle) {
      pointer.particle.x = pointer.x;
      pointer.particle.y = pointer.y;
      pointer.particle.oldX = pointer.x;
      pointer.particle.oldY = pointer.y;
    }
  }

  function drawBackground() {
    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#09171b");
    background.addColorStop(.45, "#071116");
    background.addColorStop(1, "#0d1d20");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width * .55, height * .4, 0, width * .55, height * .4, width * .52);
    glow.addColorStop(0, "rgba(70, 145, 126, .11)");
    glow.addColorStop(1, "rgba(70, 145, 126, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.strokeStyle = "rgba(161, 222, 203, .035)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 44) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y <= height; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    ctx.restore();
  }

  function drawCell(x, y) {
    const i1 = grid[y][x], i2 = grid[y][x + 1], i3 = grid[y + 1][x + 1], i4 = grid[y + 1][x];
    const p1 = particles[i1], p2 = particles[i2], p3 = particles[i3], p4 = particles[i4];
    const boundaries = [findLink(i1, i2), findLink(i2, i3), findLink(i3, i4), findLink(i4, i1)];
    if (boundaries.some((link) => !link || link.broken)) return;
    const averageStretch = boundaries.reduce((sum, link) => {
      const a = particles[link.a], b = particles[link.b];
      return sum + Math.hypot(b.x - a.x, b.y - a.y) / link.rest;
    }, 0) / boundaries.length;
    const tension = clamp((averageStretch - 1) / Math.max(.05, settings.tear - 1), 0, 1);
    const area = Math.abs((p2.x - p1.x) * (p4.y - p1.y) - (p2.y - p1.y) * (p4.x - p1.x));
    const normalizedArea = area / (spacing * spacing);
    const faceTilt = ((p2.y - p1.y) + (p4.x - p1.x)) / (spacing * 2);
    const normalLight = clamp(.48 + faceTilt * .22 + (normalizedArea - 1) * .22, .2, 1);
    const red = Math.round(lerp(56, 225, tension) * (.78 + normalLight * .25));
    const green = Math.round(lerp(139, 157, tension) * (.8 + normalLight * .24));
    const blue = Math.round(lerp(135, 112, tension) * (.8 + normalLight * .24));
    const alpha = .075 + normalLight * .06 + tension * .08;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath();
    ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    ctx.fill();
    if (normalLight > .72) {
      ctx.strokeStyle = `rgba(207, 247, 209, ${(normalLight - .7) * .22})`;
      ctx.lineWidth = .7;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
  }

  function drawCloth() {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let y = 0; y < rows - 1; y += 1) for (let x = 0; x < cols - 1; x += 1) drawCell(x, y);
    for (const link of links) {
      if (link.broken) continue;
      const a = particles[link.a], b = particles[link.b];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const strain = distance / link.rest;
      const heat = clamp((strain - 1) / Math.max(.05, settings.tear - 1), 0, 1);
      const red = Math.round(lerp(115, 255, heat));
      const green = Math.round(lerp(211, 112, heat));
      const blue = Math.round(lerp(183, 92, heat));
      if (heat > .58) {
        ctx.strokeStyle = `rgba(255, 156, 104, ${(heat - .5) * .28})`;
        ctx.lineWidth = 4 + heat * 3;
        ctx.shadowColor = "rgba(255, 135, 93, .42)";
        ctx.shadowBlur = 7;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${link.kind === "shear" ? .38 : .8})`;
      ctx.lineWidth = link.kind === "shear" ? .7 : 1.05 + heat * 1.65;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const particle of particles) {
      if (!particle.pinned && !particle.grabbed && !particle.torn) continue;
      const pulse = particle.tearPulse * (1 + Math.sin(elapsed * 8) * .12);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.grabbed ? 5 : (particle.torn ? 2.5 + pulse * 2 : 3.5), 0, TAU);
      ctx.fillStyle = particle.grabbed ? "#fff2c4" : (particle.torn ? "#ff9b7a" : "#d9ef9f");
      ctx.shadowColor = particle.grabbed ? "rgba(255, 194, 119, .9)" : (particle.torn ? "rgba(255, 123, 89, .75)" : "rgba(217, 239, 159, .7)");
      ctx.shadowBlur = particle.grabbed ? 18 : (particle.torn ? 10 : 10);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (pointer.particle) {
      ctx.strokeStyle = "rgba(255, 208, 145, .38)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.arc(pointer.particle.x, pointer.particle.y, 13 + Math.sin(elapsed * 5) * 2, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
  function draw() { drawBackground(); drawCloth(); }
  function frame(now) {
    const dt = clamp((now - lastTime) / 1000, 0, .035);
    lastTime = now;
    if (running) {
      const subSteps = dt > .022 ? 2 : 1;
      const subDt = dt / subSteps;
      for (let i = 0; i < subSteps; i += 1) simulate(subDt);
    }
    draw();
    requestAnimationFrame(frame);
  }
  function locatePointer(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
  }
  canvas.addEventListener("pointerdown", (event) => {
    locatePointer(event);
    let closest = null, closestDistance = 32;
    for (const particle of particles) {
      const distance = Math.hypot(particle.x - pointer.x, particle.y - pointer.y);
      if (distance < closestDistance) { closest = particle; closestDistance = distance; }
    }
    if (!closest) return;
    event.preventDefault();
    pointer.active = true; pointer.id = event.pointerId; pointer.particle = closest; closest.grabbed = true;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    locatePointer(event);
    if (pointer.active && event.pointerId === pointer.id) event.preventDefault();
  });
  function releasePointer(event) {
    if (!pointer.active || (event && event.pointerId !== pointer.id)) return;
    if (pointer.particle) pointer.particle.grabbed = false;
    pointer.particle = null; pointer.active = false; pointer.id = null;
  }
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  pauseButton.addEventListener("click", () => {
    running = !running;
    stateLabel.textContent = running ? "RUNNING" : "PAUSED";
    pauseLabel.textContent = running ? "Пауза" : "Продолжить";
    pauseButton.setAttribute("aria-label", running ? "Поставить на паузу" : "Продолжить симуляцию");
  });
  resetButton.addEventListener("click", resetSimulation);
  gravityInput.addEventListener("input", () => { settings.gravity = Number(gravityInput.value); updateControls(); });
  windInput.addEventListener("input", () => { settings.wind = Number(windInput.value); updateControls(); });
  tearInput.addEventListener("input", () => { settings.tear = Number(tearInput.value); updateControls(); });
  window.addEventListener("resize", resize, { passive: true });
  updateControls();
  resize();
  requestAnimationFrame(frame);
})();
