"use strict";

(function () {
  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d", { alpha: false });
  const pauseBtn = document.getElementById("pauseBtn");
  const cameraRange = document.getElementById("cameraRange");
  const fogRange = document.getElementById("fogRange");
  const schoolRange = document.getElementById("schoolRange");

  const TAU = Math.PI * 2;
  const WORLD = { x: 720, y: 360, z: 980 };
  const WATER_TOP = -WORLD.y * 0.48;
  const WATER_BOTTOM = WORLD.y * 0.5;
  const FLOOR_Y = WATER_BOTTOM - 18;
  const FOV = 620;
  const NEAR = 28;
  const FAR_FOG = 1650;
  const DPR_LIMIT = 2;

  let width = 1;
  let height = 1;
  let dpr = 1;
  let time = 0;
  let last = performance.now();
  let paused = false;
  let pointer = { x: 0, y: 0, active: false };
  let cameraPower = 0.72;
  let fogPower = 0.62;
  let schoolTightness = 0.76;

  const rand = mulberry32(854733);
  const fish = [];
  const bubbles = [];
  const weeds = [];
  const glints = [];
  const sand = [];
  const rays = [];

  function mulberry32(seed) {
    return function () {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(a, b, v) {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function vec(x, y, z) {
    return { x, y, z };
  }

  function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  function mul(a, s) {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  function len(a) {
    return Math.hypot(a.x, a.y, a.z);
  }

  function norm(a) {
    const l = len(a) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  }

  function rotateY(p, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
  }

  function rotateX(p, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
  }

  function resize() {
    dpr = Math.min(DPR_LIMIT, Math.max(1, window.devicePixelRatio || 1));
    width = Math.max(1, Math.floor(window.innerWidth));
    height = Math.max(1, Math.floor(window.innerHeight));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const camera = {
    pos: vec(0, 0, -1100),
    right: vec(1, 0, 0),
    up: vec(0, 1, 0),
    forward: vec(0, 0, 1),
    yaw: 0,
    pitch: 0
  };

  function updateCamera(t) {
    const orbit = cameraPower * 0.42;
    const pointerYaw = pointer.active ? pointer.x * 0.16 : 0;
    const pointerPitch = pointer.active ? pointer.y * -0.08 : 0;
    camera.yaw = Math.sin(t * 0.105) * orbit + Math.sin(t * 0.031) * 0.08 + pointerYaw;
    camera.pitch = Math.sin(t * 0.083 + 1.7) * 0.075 + pointerPitch;
    const base = vec(Math.sin(camera.yaw) * 240, -22 + Math.sin(t * 0.17) * 24, -1110 + Math.cos(camera.yaw) * 96);
    camera.pos = base;
    camera.forward = norm(rotateX(rotateY(vec(0, 0, 1), camera.yaw), camera.pitch));
    camera.right = norm(cross(camera.forward, vec(0, -1, 0)));
    camera.up = norm(cross(camera.right, camera.forward));
  }

  function toCamera(p) {
    const v = sub(p, camera.pos);
    return {
      x: dot(v, camera.right),
      y: dot(v, camera.up),
      z: dot(v, camera.forward)
    };
  }

  function project(p) {
    const c = toCamera(p);
    if (c.z < NEAR) return null;
    const s = FOV / c.z;
    return {
      x: width * 0.5 + c.x * s,
      y: height * 0.5 - c.y * s,
      z: c.z,
      scale: s,
      camera: c
    };
  }

  function fogForDepth(z) {
    return clamp((z - 650) / FAR_FOG, 0, 1) * fogPower;
  }

  function depthAlpha(z, base) {
    return base * (1 - fogForDepth(z) * 0.72);
  }

  function colorMix(a, b, t) {
    return {
      r: Math.round(lerp(a.r, b.r, t)),
      g: Math.round(lerp(a.g, b.g, t)),
      b: Math.round(lerp(a.b, b.b, t))
    };
  }

  function rgba(c, a) {
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
  }

  const fishKinds = [
    {
      name: "amber",
      body: { r: 255, g: 151, b: 74 },
      belly: { r: 255, g: 225, b: 150 },
      fin: { r: 255, g: 91, b: 61 },
      stripe: { r: 78, g: 31, b: 30 },
      length: 96,
      height: 34,
      width: 18,
      speed: 58,
      count: 7
    },
    {
      name: "blue",
      body: { r: 88, g: 211, b: 244 },
      belly: { r: 193, g: 251, b: 255 },
      fin: { r: 38, g: 128, b: 248 },
      stripe: { r: 10, g: 44, b: 96 },
      length: 70,
      height: 24,
      width: 13,
      speed: 76,
      count: 11
    },
    {
      name: "violet",
      body: { r: 194, g: 115, b: 255 },
      belly: { r: 255, g: 214, b: 246 },
      fin: { r: 255, g: 94, b: 179 },
      stripe: { r: 54, g: 24, b: 102 },
      length: 118,
      height: 42,
      width: 21,
      speed: 43,
      count: 4
    }
  ];

  function createFish(kind, i, school) {
    const p = school
      ? vec(rand() * 180 - 90, rand() * 86 - 30, rand() * 140 - 60)
      : vec((rand() - 0.5) * WORLD.x, rand() * 250 - 120, (rand() - 0.5) * WORLD.z);
    const heading = norm(vec(rand() - 0.5, rand() * 0.24 - 0.12, rand() - 0.5));
    return {
      kind,
      school,
      groupIndex: i,
      p,
      v: mul(heading, kind.speed * (0.76 + rand() * 0.48)),
      target: vec(0, 0, 0),
      phase: rand() * TAU,
      pulse: 0.8 + rand() * 0.45,
      seed: rand() * 1000,
      turnMemory: 0
    };
  }

  function seedWorld() {
    for (const kind of fishKinds) {
      for (let i = 0; i < kind.count; i++) {
        fish.push(createFish(kind, i, kind.name === "blue"));
      }
    }

    for (let i = 0; i < 90; i++) {
      bubbles.push({
        x: (rand() - 0.5) * WORLD.x,
        y: lerp(WATER_BOTTOM, WATER_TOP, rand()),
        z: (rand() - 0.5) * WORLD.z,
        r: 1.4 + rand() * 5.8,
        speed: 18 + rand() * 54,
        wobble: rand() * TAU,
        alpha: 0.22 + rand() * 0.34
      });
    }

    for (let i = 0; i < 54; i++) {
      const z = lerp(-WORLD.z * 0.46, WORLD.z * 0.46, rand());
      weeds.push({
        root: vec((rand() - 0.5) * WORLD.x * 0.96, FLOOR_Y + rand() * 7, z),
        h: 42 + rand() * 142,
        blades: 3 + Math.floor(rand() * 5),
        width: 5 + rand() * 13,
        phase: rand() * TAU,
        hue: rand()
      });
    }

    for (let i = 0; i < 160; i++) {
      sand.push({
        x: (rand() - 0.5) * WORLD.x,
        z: (rand() - 0.5) * WORLD.z,
        r: 1 + rand() * 3.4,
        shade: rand()
      });
    }

    for (let i = 0; i < 9; i++) {
      rays.push({
        x: lerp(-WORLD.x * 0.55, WORLD.x * 0.55, rand()),
        z: lerp(-WORLD.z * 0.48, WORLD.z * 0.42, rand()),
        w: 70 + rand() * 130,
        tilt: (rand() - 0.5) * 0.24,
        phase: rand() * TAU,
        alpha: 0.04 + rand() * 0.06
      });
    }

    for (let i = 0; i < 22; i++) {
      glints.push({
        x: rand(),
        y: rand(),
        l: 40 + rand() * 170,
        a: rand() * TAU,
        p: rand() * TAU,
        alpha: 0.04 + rand() * 0.09
      });
    }
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, "#0e5367");
    g.addColorStop(0.33, "#0a394d");
    g.addColorStop(0.68, "#062838");
    g.addColorStop(1, "#041723");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    const radial = ctx.createRadialGradient(width * 0.48, height * 0.05, 20, width * 0.5, height * 0.22, Math.max(width, height) * 0.7);
    radial.addColorStop(0, "rgba(172, 247, 255, 0.30)");
    radial.addColorStop(0.34, "rgba(73, 190, 202, 0.12)");
    radial.addColorStop(1, "rgba(0, 20, 28, 0)");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, width, height);
  }

  function drawAquariumBox() {
    const corners = [
      vec(-WORLD.x / 2, WATER_TOP, -WORLD.z / 2),
      vec(WORLD.x / 2, WATER_TOP, -WORLD.z / 2),
      vec(WORLD.x / 2, WATER_TOP, WORLD.z / 2),
      vec(-WORLD.x / 2, WATER_TOP, WORLD.z / 2),
      vec(-WORLD.x / 2, WATER_BOTTOM, -WORLD.z / 2),
      vec(WORLD.x / 2, WATER_BOTTOM, -WORLD.z / 2),
      vec(WORLD.x / 2, WATER_BOTTOM, WORLD.z / 2),
      vec(-WORLD.x / 2, WATER_BOTTOM, WORLD.z / 2)
    ].map(project);
    if (corners.some((p) => !p)) return;

    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    ctx.save();
    ctx.lineWidth = 1;
    for (const edge of edges) {
      const a = corners[edge[0]];
      const b = corners[edge[1]];
      const alpha = 0.09 + (1 - fogForDepth((a.z + b.z) * 0.5)) * 0.16;
      ctx.strokeStyle = "rgba(208, 249, 255," + alpha + ")";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "screen";
    for (const g of glints) {
      const a = g.alpha * (0.55 + Math.sin(time * 0.7 + g.p) * 0.45);
      const x = lerp(width * 0.04, width * 0.96, g.x);
      const y = lerp(height * 0.04, height * 0.85, g.y);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(g.a + Math.sin(time * 0.15 + g.p) * 0.2);
      const grad = ctx.createLinearGradient(-g.l, 0, g.l, 0);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.5, "rgba(225,252,255," + a + ")");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-g.l, 0);
      ctx.lineTo(g.l, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawFloor() {
    const floorCorners = [
      project(vec(-WORLD.x / 2, FLOOR_Y, -WORLD.z / 2)),
      project(vec(WORLD.x / 2, FLOOR_Y, -WORLD.z / 2)),
      project(vec(WORLD.x / 2, FLOOR_Y, WORLD.z / 2)),
      project(vec(-WORLD.x / 2, FLOOR_Y, WORLD.z / 2))
    ];
    if (floorCorners.some((p) => !p)) return;

    const yAvg = floorCorners.reduce((sum, p) => sum + p.y, 0) / floorCorners.length;
    const fg = ctx.createLinearGradient(0, yAvg - height * 0.25, 0, height);
    fg.addColorStop(0, "rgba(191, 173, 112, 0.50)");
    fg.addColorStop(1, "rgba(108, 86, 52, 0.76)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(floorCorners[0].x, floorCorners[0].y);
    for (let i = 1; i < floorCorners.length; i++) ctx.lineTo(floorCorners[i].x, floorCorners[i].y);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 28; i++) {
      const z = lerp(-WORLD.z * 0.5, WORLD.z * 0.5, i / 27);
      const wave = Math.sin(time * 0.62 + i * 0.83);
      const a = project(vec(-WORLD.x * 0.5, FLOOR_Y - 1, z + wave * 16));
      const b = project(vec(WORLD.x * 0.5, FLOOR_Y - 1, z + wave * 16));
      if (!a || !b) continue;
      const alpha = depthAlpha((a.z + b.z) * 0.5, 0.055);
      ctx.strokeStyle = "rgba(230, 252, 186," + alpha + ")";
      ctx.lineWidth = Math.max(0.6, 2.4 * ((a.scale + b.scale) * FOV / 2) / 900);
      ctx.beginPath();
      const mid = project(vec(Math.sin(time + i) * 70, FLOOR_Y - 3, z + Math.cos(time * 0.7 + i) * 36));
      ctx.moveTo(a.x, a.y);
      if (mid) ctx.quadraticCurveTo(mid.x, mid.y - 8, b.x, b.y);
      else ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    for (const grain of sand) {
      const p = project(vec(grain.x, FLOOR_Y - 2, grain.z));
      if (!p) continue;
      const a = depthAlpha(p.z, 0.18 + grain.shade * 0.12);
      const r = Math.max(0.45, grain.r * p.scale * 1.7);
      ctx.fillStyle = grain.shade > 0.58 ? "rgba(239, 215, 148," + a + ")" : "rgba(92, 71, 49," + a + ")";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * 1.8, r * 0.62, camera.yaw * 0.6, 0, TAU);
      ctx.fill();
    }
  }

  function updateFish(dt) {
    const center = vec(Math.sin(time * 0.17) * 80, -8 + Math.sin(time * 0.23) * 36, Math.cos(time * 0.13) * 120);
    for (const f of fish) {
      const k = f.kind;
      const personal = vec(
        Math.sin(time * 0.19 + f.seed) * 170 + Math.sin(time * 0.07 + f.seed * 0.31) * 120,
        Math.sin(time * 0.31 + f.seed * 0.9) * 88,
        Math.cos(time * 0.16 + f.seed * 0.7) * 280 + Math.sin(time * 0.05 + f.seed) * 120
      );
      const schoolOffset = vec(
        Math.sin(f.groupIndex * 1.8) * lerp(90, 34, schoolTightness),
        Math.cos(f.groupIndex * 2.4) * lerp(42, 14, schoolTightness),
        Math.sin(f.groupIndex * 1.21 + 1.4) * lerp(72, 28, schoolTightness)
      );
      f.target = f.school ? add(center, schoolOffset) : personal;

      let desired = sub(f.target, f.p);
      const dist = len(desired);
      desired = mul(norm(desired), k.speed * (0.86 + smoothstep(40, 310, dist) * 0.7));

      const marginX = WORLD.x * 0.45;
      const marginY = WORLD.y * 0.43;
      const marginZ = WORLD.z * 0.45;
      const wallForce = vec(0, 0, 0);
      if (f.p.x < -marginX) wallForce.x += (-marginX - f.p.x) * 2.3;
      if (f.p.x > marginX) wallForce.x -= (f.p.x - marginX) * 2.3;
      if (f.p.y < WATER_TOP + 26) wallForce.y += (WATER_TOP + 26 - f.p.y) * 3.0;
      if (f.p.y > FLOOR_Y - 34) wallForce.y -= (f.p.y - FLOOR_Y + 34) * 3.0;
      if (f.p.z < -marginZ) wallForce.z += (-marginZ - f.p.z) * 2.0;
      if (f.p.z > marginZ) wallForce.z -= (f.p.z - marginZ) * 2.0;
      desired = add(desired, wallForce);

      const steer = clamp(dt * (f.school ? 1.7 : 1.15), 0, 1);
      f.v = add(mul(f.v, 1 - steer), mul(desired, steer));
      const speed = len(f.v);
      if (speed > k.speed * 1.75) f.v = mul(norm(f.v), k.speed * 1.75);
      if (speed < k.speed * 0.44) f.v = mul(norm(f.v), k.speed * 0.44);
      f.p = add(f.p, mul(f.v, dt));
      f.phase += dt * (5.2 + len(f.v) * 0.025) * f.pulse;
    }
  }

  function fishBasis(f) {
    const forward = norm(f.v);
    const worldUp = Math.abs(forward.y) > 0.92 ? vec(0, 0, 1) : vec(0, 1, 0);
    const side = norm(cross(forward, worldUp));
    const up = norm(cross(side, forward));
    return { forward, side, up };
  }

  function fishPoint(f, basis, x, y, z, phaseOffset) {
    const k = f.kind;
    const bend = Math.sin(f.phase + phaseOffset + x * 0.075) * k.width * 0.36 * Math.pow((x + k.length * 0.48) / k.length, 1.4);
    const lift = Math.sin(f.phase * 0.55 + x * 0.05 + f.seed) * k.height * 0.04;
    return add(
      f.p,
      add(
        add(mul(basis.forward, x), mul(basis.side, z + bend)),
        mul(basis.up, y + lift)
      )
    );
  }

  function projectedFishPath(f, basis, sideSign) {
    const k = f.kind;
    const upper = [];
    const lower = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = lerp(-k.length * 0.46, k.length * 0.46, u);
      const radius = Math.sin(Math.PI * u);
      const taper = Math.pow(radius, 0.55);
      const heightMod = (0.42 + taper * 0.68) * k.height;
      const z = sideSign * k.width * (0.12 + taper * 0.16);
      upper.push(project(fishPoint(f, basis, x, -heightMod * 0.5, z, u * 1.3)));
      lower.push(project(fishPoint(f, basis, x, heightMod * 0.5, z, u * 1.3)));
    }
    if (upper.some((p) => !p) || lower.some((p) => !p)) return null;
    return { upper, lower };
  }

  function drawProjectedShape(points, fillStyle, strokeStyle, lineWidth) {
    if (!points || points.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  function drawFish(f) {
    const k = f.kind;
    const basis = fishBasis(f);
    const center = project(f.p);
    if (!center) return;

    const facing = dot(basis.side, camera.forward);
    const sideSign = facing > 0 ? -1 : 1;
    const body = projectedFishPath(f, basis, sideSign);
    if (!body) return;

    const zDepth = center.z;
    const fog = fogForDepth(zDepth);
    const alpha = depthAlpha(zDepth, 0.92);
    const light = clamp(0.55 + dot(basis.up, norm(vec(-0.35, -0.85, -0.18))) * 0.35 + (1 - fog) * 0.15, 0.25, 1.1);
    const bodyColor = colorMix(k.body, { r: 55, g: 130, b: 145 }, fog * 0.82);
    const bellyColor = colorMix(k.belly, { r: 77, g: 146, b: 155 }, fog * 0.75);
    const finColor = colorMix(k.fin, { r: 42, g: 116, b: 140 }, fog * 0.85);
    const stripeColor = colorMix(k.stripe, { r: 26, g: 71, b: 87 }, fog * 0.72);
    const allBody = body.upper.concat(body.lower.slice().reverse());

    ctx.save();
    ctx.globalAlpha = alpha;

    const bodyGrad = ctx.createLinearGradient(center.x, center.y - 34 * center.scale, center.x, center.y + 34 * center.scale);
    bodyGrad.addColorStop(0, rgba({ r: Math.min(255, bodyColor.r + 34), g: Math.min(255, bodyColor.g + 34), b: Math.min(255, bodyColor.b + 34) }, 1));
    bodyGrad.addColorStop(0.58, rgba(bodyColor, 1));
    bodyGrad.addColorStop(1, rgba({ r: Math.max(0, bodyColor.r * light * 0.6), g: Math.max(0, bodyColor.g * light * 0.6), b: Math.max(0, bodyColor.b * light * 0.6) }, 1));
    drawProjectedShape(allBody, bodyGrad, "rgba(7,31,38,0.22)", Math.max(0.45, center.scale * 1.4));

    const belly = [];
    for (let i = 2; i < body.lower.length - 1; i++) belly.push(body.lower[i]);
    for (let i = body.upper.length - 3; i >= 3; i--) {
      const a = body.upper[i];
      const b = body.lower[i];
      belly.push({ x: lerp(a.x, b.x, 0.58), y: lerp(a.y, b.y, 0.58), z: a.z });
    }
    drawProjectedShape(belly, rgba(bellyColor, 0.42), null, 0);

    ctx.globalCompositeOperation = "multiply";
    for (let s = 0; s < 4; s++) {
      const u = 0.24 + s * 0.13;
      const x = lerp(-k.length * 0.31, k.length * 0.22, u);
      const a = project(fishPoint(f, basis, x, -k.height * 0.38, sideSign * k.width * 0.34, u));
      const b = project(fishPoint(f, basis, x + k.length * 0.04, k.height * 0.36, sideSign * k.width * 0.34, u));
      if (!a || !b) continue;
      ctx.strokeStyle = rgba(stripeColor, 0.20);
      ctx.lineWidth = Math.max(0.5, center.scale * 5.8);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";

    const tailWave = Math.sin(f.phase + 0.9);
    const tailRoot = fishPoint(f, basis, -k.length * 0.47, 0, sideSign * k.width * 0.22, 0);
    const tailA = project(add(tailRoot, add(mul(basis.forward, -k.length * 0.26), add(mul(basis.up, -k.height * 0.52), mul(basis.side, sideSign * (k.width * 0.8 + tailWave * k.width * 0.55))))));
    const tailB = project(add(tailRoot, add(mul(basis.forward, -k.length * 0.13), mul(basis.up, -k.height * 0.08))));
    const tailC = project(add(tailRoot, add(mul(basis.forward, -k.length * 0.26), add(mul(basis.up, k.height * 0.52), mul(basis.side, sideSign * (k.width * 0.8 + tailWave * k.width * 0.55))))));
    const tailD = project(add(tailRoot, add(mul(basis.forward, -k.length * 0.02), mul(basis.up, k.height * 0.04))));
    drawProjectedShape([tailA, tailB, tailC, tailD].filter(Boolean), rgba(finColor, 0.72), "rgba(255,255,255,0.12)", Math.max(0.4, center.scale));

    const dorsal = [
      project(fishPoint(f, basis, -k.length * 0.12, -k.height * 0.42, sideSign * k.width * 0.12, 0)),
      project(add(fishPoint(f, basis, k.length * 0.08, -k.height * 0.45, sideSign * k.width * 0.2, 1), mul(basis.up, -k.height * (0.36 + Math.sin(f.phase * 1.3) * 0.05)))),
      project(fishPoint(f, basis, k.length * 0.28, -k.height * 0.28, sideSign * k.width * 0.14, 1.7))
    ].filter(Boolean);
    drawProjectedShape(dorsal, rgba(finColor, 0.52), null, 0);

    const pectoralRoot = fishPoint(f, basis, k.length * 0.15, k.height * 0.18, sideSign * k.width * 0.48, 0);
    const flap = Math.sin(f.phase * 1.65) * k.width * 0.72;
    const fin = [
      project(pectoralRoot),
      project(add(pectoralRoot, add(mul(basis.forward, -k.length * 0.15), add(mul(basis.up, k.height * 0.42), mul(basis.side, sideSign * (k.width * 1.25 + flap)))))),
      project(add(pectoralRoot, add(mul(basis.forward, k.length * 0.05), mul(basis.up, k.height * 0.27))))
    ].filter(Boolean);
    drawProjectedShape(fin, rgba(finColor, 0.48), null, 0);

    const eyePos = project(fishPoint(f, basis, k.length * 0.34, -k.height * 0.12, sideSign * k.width * 0.52, 1.2));
    if (eyePos && center.scale > 0.12) {
      ctx.fillStyle = "rgba(255,255,245," + (0.86 - fog * 0.45) + ")";
      ctx.beginPath();
      ctx.arc(eyePos.x, eyePos.y, Math.max(1.2, center.scale * k.height * 0.105), 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(0,18,24,0.86)";
      ctx.beginPath();
      ctx.arc(eyePos.x + center.scale * 1.3, eyePos.y + center.scale * 0.2, Math.max(0.65, center.scale * k.height * 0.045), 0, TAU);
      ctx.fill();
    }

    const shineA = project(fishPoint(f, basis, -k.length * 0.18, -k.height * 0.30, sideSign * k.width * 0.55, 0));
    const shineB = project(fishPoint(f, basis, k.length * 0.30, -k.height * 0.18, sideSign * k.width * 0.55, 0));
    if (shineA && shineB) {
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = "rgba(255,255,255," + (0.18 * (1 - fog)) + ")";
      ctx.lineWidth = Math.max(0.6, center.scale * 2.2);
      ctx.beginPath();
      ctx.moveTo(shineA.x, shineA.y);
      ctx.quadraticCurveTo(center.x, center.y - center.scale * k.height * 0.45, shineB.x, shineB.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  function updateBubbles(dt) {
    for (const b of bubbles) {
      b.y -= b.speed * dt;
      b.x += Math.sin(time * 1.6 + b.wobble + b.y * 0.02) * dt * 7;
      b.z += Math.cos(time * 1.15 + b.wobble) * dt * 4;
      if (b.y < WATER_TOP - 16) {
        b.y = FLOOR_Y + 12 + rand() * 60;
        b.x = (rand() - 0.5) * WORLD.x;
        b.z = (rand() - 0.5) * WORLD.z;
      }
    }
  }

  function drawBubble(b) {
    const p = project(vec(b.x, b.y, b.z));
    if (!p) return;
    const fog = fogForDepth(p.z);
    const r = Math.max(0.65, b.r * p.scale * 2.7);
    ctx.save();
    ctx.globalAlpha = b.alpha * (1 - fog * 0.75);
    ctx.strokeStyle = "rgba(226, 252, 255, 0.78)";
    ctx.lineWidth = Math.max(0.55, r * 0.15);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.beginPath();
    ctx.arc(p.x - r * 0.35, p.y - r * 0.35, Math.max(0.45, r * 0.18), 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawWeed(w) {
    const base = project(w.root);
    if (!base) return;
    const fog = fogForDepth(base.z);
    const alpha = depthAlpha(base.z, 0.62);
    const green = w.hue > 0.5 ? { r: 71, g: 171, b: 114 } : { r: 99, g: 141, b: 70 };
    ctx.save();
    ctx.strokeStyle = rgba(colorMix(green, { r: 35, g: 92, b: 100 }, fog), alpha);
    ctx.lineCap = "round";
    for (let i = 0; i < w.blades; i++) {
      const sideOffset = (i - (w.blades - 1) / 2) * w.width;
      const root = add(w.root, vec(sideOffset, 0, Math.sin(i) * 6));
      const p0 = project(root);
      const p1 = project(add(root, vec(Math.sin(time * 0.9 + w.phase + i) * 12, -w.h * 0.34, Math.cos(i) * 12)));
      const p2 = project(add(root, vec(Math.sin(time * 0.8 + w.phase + i * 1.7) * 28, -w.h, Math.cos(w.phase + i) * 18)));
      if (!p0 || !p1 || !p2) continue;
      ctx.lineWidth = Math.max(0.8, p0.scale * (w.width * 3.1));
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRay(ray) {
    const topA = project(vec(ray.x - ray.w * 0.4, WATER_TOP - 20, ray.z));
    const topB = project(vec(ray.x + ray.w * 0.4, WATER_TOP - 20, ray.z + ray.w * ray.tilt));
    const botB = project(vec(ray.x + ray.w * 1.2 + Math.sin(time * 0.18 + ray.phase) * 26, FLOOR_Y + 20, ray.z + 120));
    const botA = project(vec(ray.x - ray.w * 1.1 + Math.cos(time * 0.16 + ray.phase) * 24, FLOOR_Y + 20, ray.z - 80));
    if (!topA || !topB || !botA || !botB) return;
    const z = (topA.z + botB.z) * 0.5;
    const alpha = depthAlpha(z, ray.alpha * (0.72 + Math.sin(time * 0.23 + ray.phase) * 0.28));
    const g = ctx.createLinearGradient((topA.x + topB.x) * 0.5, (topA.y + topB.y) * 0.5, (botA.x + botB.x) * 0.5, (botA.y + botB.y) * 0.5);
    g.addColorStop(0, "rgba(220, 255, 242," + alpha * 1.8 + ")");
    g.addColorStop(0.55, "rgba(130, 230, 223," + alpha + ")");
    g.addColorStop(1, "rgba(130, 230, 223,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(topA.x, topA.y);
    ctx.lineTo(topB.x, topB.y);
    ctx.lineTo(botB.x, botB.y);
    ctx.lineTo(botA.x, botA.y);
    ctx.closePath();
    ctx.fill();
  }

  function drawVolumeFog() {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 7; i++) {
      const y = height * (0.18 + i * 0.105 + Math.sin(time * 0.06 + i) * 0.01);
      const g = ctx.createLinearGradient(0, y - 38, width, y + 38);
      g.addColorStop(0, "rgba(150, 237, 226, 0)");
      g.addColorStop(0.44, "rgba(150, 237, 226, 0.028)");
      g.addColorStop(1, "rgba(150, 237, 226, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 44, width, 88);
    }
    ctx.restore();

    const g = ctx.createLinearGradient(0, height * 0.2, 0, height);
    g.addColorStop(0, "rgba(4, 34, 43, 0)");
    g.addColorStop(0.72, "rgba(5, 42, 48," + (0.12 + fogPower * 0.10) + ")");
    g.addColorStop(1, "rgba(1, 13, 19, 0.34)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  function render() {
    updateCamera(time);
    drawBackground();

    const renderables = [];
    for (const ray of rays) {
      const p = project(vec(ray.x, 0, ray.z));
      if (p) renderables.push({ z: p.z + 80, draw: () => drawRay(ray) });
    }
    for (const w of weeds) {
      const p = project(w.root);
      if (p) renderables.push({ z: p.z, draw: () => drawWeed(w) });
    }
    for (const b of bubbles) {
      const p = project(vec(b.x, b.y, b.z));
      if (p) renderables.push({ z: p.z, draw: () => drawBubble(b) });
    }
    for (const f of fish) {
      const p = project(f.p);
      if (p) renderables.push({ z: p.z, draw: () => drawFish(f) });
    }

    drawAquariumBox();
    drawFloor();
    renderables.sort((a, b) => b.z - a.z);
    for (const item of renderables) item.draw();
    drawVolumeFog();
    drawAquariumBox();
  }

  function tick(now) {
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = paused ? 0 : Math.min(0.045, Math.max(0, rawDt));
    if (dt > 0) {
      time += dt;
      updateFish(dt);
      updateBubbles(dt);
    }
    render();
    requestAnimationFrame(tick);
  }

  function bindUi() {
    pauseBtn.addEventListener("click", () => {
      paused = !paused;
      pauseBtn.textContent = paused ? "Пуск" : "Пауза";
      pauseBtn.setAttribute("aria-pressed", String(paused));
    });
    cameraRange.addEventListener("input", () => {
      cameraPower = Number(cameraRange.value) / 100;
    });
    fogRange.addEventListener("input", () => {
      fogPower = Number(fogRange.value) / 100;
    });
    schoolRange.addEventListener("input", () => {
      schoolTightness = Number(schoolRange.value) / 100;
    });
    window.addEventListener("pointermove", (event) => {
      pointer.active = true;
      pointer.x = (event.clientX / Math.max(1, width) - 0.5) * 2;
      pointer.y = (event.clientY / Math.max(1, height) - 0.5) * 2;
    });
    window.addEventListener("pointerleave", () => {
      pointer.active = false;
    });
    window.addEventListener("resize", resize);
  }

  resize();
  seedWorld();
  bindUi();
  requestAnimationFrame(tick);
})();
