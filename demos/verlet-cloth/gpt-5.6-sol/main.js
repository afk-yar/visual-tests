(function () {
  "use strict";

  const canvas = document.getElementById("cloth");
  const ctx = canvas.getContext("2d", { alpha: false });
  const resetButton = document.getElementById("resetButton");
  const statusText = document.getElementById("statusText");

  const settings = {
    gravity: 1180,
    damping: 0.994,
    timeStep: 1 / 60,
    maxFrameTime: 0.05,
    constraintIterations: 7,
    tearRatio: 2.05,
    pointerRadius: 44
  };

  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let constraints = [];
  let renderLinks = [];
  let cols = 0;
  let rows = 0;
  let spacing = 18;
  let simTime = 0;
  let previousTime = performance.now();
  let accumulator = 0;
  let tornCount = 0;
  let draggedParticle = null;
  let pointerId = null;
  let pointer = { x: 0, y: 0, previousX: 0, previousY: 0 };

  function makeParticle(x, y, pinned) {
    return {
      x: x,
      y: y,
      oldX: x,
      oldY: y,
      pinX: x,
      pinY: y,
      pinned: pinned
    };
  }

  function addConstraint(a, b, visible, stiffness) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const constraint = {
      a: a,
      b: b,
      rest: Math.hypot(dx, dy),
      active: true,
      visible: visible,
      stiffness: stiffness
    };
    constraints.push(constraint);
    if (visible) renderLinks.push(constraint);
  }

  function buildCloth() {
    particles = [];
    constraints = [];
    renderLinks = [];
    tornCount = 0;
    draggedParticle = null;
    pointerId = null;
    canvas.classList.remove("is-dragging");

    const compact = width < 680;
    spacing = compact ? 15 : 18;
    const clothWidth = Math.min(compact ? width * 0.88 : width * 0.62, 760);
    cols = Math.max(16, Math.floor(clothWidth / spacing));
    rows = Math.max(15, Math.min(31, Math.floor((height * (compact ? 0.52 : 0.60)) / spacing)));
    const actualWidth = (cols - 1) * spacing;
    const startX = (width - actualWidth) * 0.5;
    const startY = compact ? Math.max(190, height * 0.29) : Math.max(145, height * 0.21);
    const pinEvery = Math.max(4, Math.round(cols / 8));

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const pinned = y === 0 && (x === 0 || x === cols - 1 || x % pinEvery === 0);
        particles.push(makeParticle(startX + x * spacing, startY + y * spacing, pinned));
      }
    }

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const current = particles[y * cols + x];
        if (x < cols - 1) addConstraint(current, particles[y * cols + x + 1], true, 1);
        if (y < rows - 1) addConstraint(current, particles[(y + 1) * cols + x], true, 1);

        // Диагональные связи не рисуются: они удерживают форму, не утяжеляя сетку визуально.
        if (x < cols - 1 && y < rows - 1) {
          addConstraint(current, particles[(y + 1) * cols + x + 1], false, 0.72);
          addConstraint(particles[y * cols + x + 1], particles[(y + 1) * cols + x], false, 0.72);
        }
      }
    }

    updateStatus();
  }

  function resize() {
    const nextWidth = window.innerWidth;
    const nextHeight = window.innerHeight;
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    const sizeChanged = nextWidth !== width || nextHeight !== height || nextDpr !== dpr;
    if (!sizeChanged) return;

    width = nextWidth;
    height = nextHeight;
    dpr = nextDpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildCloth();
  }

  function integrate(dt) {
    const dtSquared = dt * dt;
    const breeze = 92 * Math.sin(simTime * 0.83) + 38 * Math.sin(simTime * 2.17 + 1.4);

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (p.pinned || p === draggedParticle) continue;

      const velocityX = (p.x - p.oldX) * settings.damping;
      const velocityY = (p.y - p.oldY) * settings.damping;
      const oldX = p.x;
      const oldY = p.y;
      const ripple = Math.sin(simTime * 2.4 + p.y * 0.021 + p.x * 0.009);
      const windX = breeze + ripple * 34;
      const windY = ripple * 7;

      p.x += velocityX + windX * dtSquared;
      p.y += velocityY + (settings.gravity + windY) * dtSquared;
      p.oldX = oldX;
      p.oldY = oldY;
    }
  }

  function inverseMass(p) {
    return p.pinned || p === draggedParticle ? 0 : 1;
  }

  function satisfyConstraints() {
    for (let pass = 0; pass < settings.constraintIterations; pass += 1) {
      if (draggedParticle) {
        draggedParticle.x = pointer.x;
        draggedParticle.y = pointer.y;
      }

      for (let i = 0; i < constraints.length; i += 1) {
        const c = constraints[i];
        if (!c.active) continue;

        const dx = c.b.x - c.a.x;
        const dy = c.b.y - c.a.y;
        const distance = Math.hypot(dx, dy) || 0.0001;

        if (distance > c.rest * settings.tearRatio) {
          c.active = false;
          if (c.visible) tornCount += 1;
          continue;
        }

        const massA = inverseMass(c.a);
        const massB = inverseMass(c.b);
        const totalMass = massA + massB;
        if (totalMass === 0) continue;

        const error = ((distance - c.rest) / distance) * c.stiffness;
        const correctionX = dx * error;
        const correctionY = dy * error;

        c.a.x += correctionX * (massA / totalMass);
        c.a.y += correctionY * (massA / totalMass);
        c.b.x -= correctionX * (massB / totalMass);
        c.b.y -= correctionY * (massB / totalMass);
      }

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (p.pinned) {
          p.x = p.pinX;
          p.y = p.pinY;
        } else {
          p.x = Math.max(-30, Math.min(width + 30, p.x));
          p.y = Math.min(height + 80, p.y);
        }
      }
    }
  }

  function simulate(dt) {
    simTime += dt;
    integrate(dt);
    satisfyConstraints();
  }

  function drawBackground() {
    const gradient = ctx.createRadialGradient(
      width * 0.53, height * 0.42, 0,
      width * 0.53, height * 0.42, Math.max(width, height) * 0.82
    );
    gradient.addColorStop(0, "#18232a");
    gradient.addColorStop(0.46, "#0d1319");
    gradient.addColorStop(1, "#07090d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = "#9ff6d4";
    ctx.lineWidth = 1;
    const horizon = height * 0.77;
    for (let i = -3; i < 12; i += 1) {
      const y = horizon + i * 24;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCloth() {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Мягкая тень подчёркивает объём колеблющейся сетки.
    ctx.beginPath();
    for (let i = 0; i < renderLinks.length; i += 1) {
      const c = renderLinks[i];
      if (!c.active) continue;
      ctx.moveTo(c.a.x + 8, c.a.y + 12);
      ctx.lineTo(c.b.x + 8, c.b.y + 12);
    }
    ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < renderLinks.length; i += 1) {
      const c = renderLinks[i];
      if (!c.active) continue;
      ctx.moveTo(c.a.x, c.a.y);
      ctx.lineTo(c.b.x, c.b.y);
    }
    ctx.strokeStyle = "rgba(207, 237, 226, 0.59)";
    ctx.lineWidth = 0.9;
    ctx.stroke();

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (!p.pinned) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = "#9ff6d4";
      ctx.shadowColor = "#9ff6d4";
      ctx.shadowBlur = 12;
      ctx.fill();
    }

    if (draggedParticle) {
      ctx.beginPath();
      ctx.arc(draggedParticle.x, draggedParticle.y, 11, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(159, 246, 212, 0.68)";
      ctx.lineWidth = 1.4;
      ctx.shadowColor = "#9ff6d4";
      ctx.shadowBlur = 18;
      ctx.stroke();
    }

    ctx.restore();
  }

  function render() {
    drawBackground();
    drawCloth();
  }

  function updateStatus() {
    if (tornCount === 0) {
      statusText.textContent = "Сетка стабильна";
    } else {
      statusText.textContent = "Разорвано нитей: " + tornCount;
    }
  }

  function frame(now) {
    const frameTime = Math.min((now - previousTime) / 1000, settings.maxFrameTime);
    previousTime = now;
    accumulator = Math.min(accumulator + frameTime, settings.timeStep * 3);

    while (accumulator >= settings.timeStep) {
      simulate(settings.timeStep);
      accumulator -= settings.timeStep;
    }

    updateStatus();
    render();
    requestAnimationFrame(frame);
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function handlePointerDown(event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const position = pointerPosition(event);
    let nearest = null;
    let nearestDistance = settings.pointerRadius;

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (p.pinned) continue;
      const distance = Math.hypot(p.x - position.x, p.y - position.y);
      if (distance < nearestDistance) {
        nearest = p;
        nearestDistance = distance;
      }
    }

    if (!nearest) return;
    draggedParticle = nearest;
    pointerId = event.pointerId;
    pointer.x = position.x;
    pointer.y = position.y;
    pointer.previousX = position.x;
    pointer.previousY = position.y;
    draggedParticle.oldX = draggedParticle.x;
    draggedParticle.oldY = draggedParticle.y;
    canvas.setPointerCapture(pointerId);
    canvas.classList.add("is-dragging");
  }

  function handlePointerMove(event) {
    if (event.pointerId !== pointerId || !draggedParticle) return;
    const position = pointerPosition(event);
    pointer.previousX = pointer.x;
    pointer.previousY = pointer.y;
    pointer.x = position.x;
    pointer.y = position.y;
  }

  function releasePointer(event) {
    if (event.pointerId !== pointerId || !draggedParticle) return;
    // Передаём частице небольшую скорость движения указателя после отпускания.
    draggedParticle.oldX = draggedParticle.x - (pointer.x - pointer.previousX) * 0.45;
    draggedParticle.oldY = draggedParticle.y - (pointer.y - pointer.previousY) * 0.45;
    draggedParticle = null;
    pointerId = null;
    canvas.classList.remove("is-dragging");
  }

  resetButton.addEventListener("click", buildCloth);
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", function (event) {
    if (event.key.toLowerCase() === "r") buildCloth();
  });
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);

  resize();
  requestAnimationFrame(frame);
}());
