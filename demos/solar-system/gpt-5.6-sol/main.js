(function () {
  "use strict";

  const canvas = document.getElementById("space");
  const ctx = canvas.getContext("2d", { alpha: false });
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  const ui = {
    zoom: document.getElementById("zoom"),
    speed: document.getElementById("speed"),
    trail: document.getElementById("trail"),
    zoomValue: document.getElementById("zoomValue"),
    speedValue: document.getElementById("speedValue"),
    trailValue: document.getElementById("trailValue"),
    pause: document.getElementById("pauseButton"),
    labels: document.getElementById("labelsButton"),
    reset: document.getElementById("resetButton"),
    missionTime: document.getElementById("missionTime"),
    focusName: document.getElementById("focusName"),
    focusMeta: document.getElementById("focusMeta")
  };

  const planets = [
    { name: "Меркурий", type: "каменистая планета", a: .387, e: .2056, period: .241, radius: .383, inc: 7, node: 48.3, peri: 29.1, phase: .46, colors: ["#b7a58f", "#5c5046"], rough: true },
    { name: "Венера", type: "облачный мир", a: .723, e: .0068, period: .615, radius: .949, inc: 3.39, node: 76.7, peri: 54.9, phase: .88, colors: ["#f4d298", "#9d693c"], clouds: true },
    { name: "Земля", type: "океанический мир", a: 1, e: .0167, period: 1, radius: 1, inc: 0, node: -11.3, peri: 114.2, phase: .07, colors: ["#62b9e8", "#0a3c69"], earth: true,
      moons: [{ name: "Луна", size: .48, distance: 13, period: .0748, color: "#c8c4ba", phase: .2 }] },
    { name: "Марс", type: "пустынный мир", a: 1.524, e: .0934, period: 1.881, radius: .532, inc: 1.85, node: 49.6, peri: 286.5, phase: .62, colors: ["#e78652", "#71301f"], rough: true,
      moons: [{ name: "Фобос", size: .25, distance: 9, period: .00087, color: "#9d8c78", phase: .4 }] },
    { name: "Юпитер", type: "газовый гигант", a: 5.203, e: .0489, period: 11.862, radius: 11.21, inc: 1.3, node: 100.5, peri: 273.9, phase: .31, colors: ["#e6c4a1", "#8d6047"], bands: ["#d6ad82", "#754838", "#f0d5b4", "#a87356"], spot: true,
      moons: [
        { name: "Ио", size: .45, distance: 14, period: .00485, color: "#e8cf78", phase: .3 },
        { name: "Европа", size: .38, distance: 18, period: .00972, color: "#d5c7a7", phase: .7 },
        { name: "Ганимед", size: .55, distance: 23, period: .0196, color: "#9e8b74", phase: .1 },
        { name: "Каллисто", size: .5, distance: 29, period: .0457, color: "#776b60", phase: .85 }
      ] },
    { name: "Сатурн", type: "окольцованный гигант", a: 9.537, e: .0541, period: 29.457, radius: 9.45, inc: 2.49, node: 113.7, peri: 339.4, phase: .73, colors: ["#ead39e", "#8a7048"], bands: ["#d8bd82", "#f1dfa9", "#a98b58"], rings: true,
      moons: [{ name: "Титан", size: .52, distance: 28, period: .0437, color: "#d5a75f", phase: .4 }, { name: "Рея", size: .31, distance: 20, period: .0124, color: "#bdb6a6", phase: .8 }] },
    { name: "Уран", type: "ледяной гигант", a: 19.19, e: .0472, period: 84.01, radius: 4.01, inc: .77, node: 74, peri: 96.9, phase: .16, colors: ["#a7e4e8", "#397f91"], ice: true },
    { name: "Нептун", type: "ледяной гигант", a: 30.07, e: .0086, period: 164.8, radius: 3.88, inc: 1.77, node: 131.8, peri: 273.2, phase: .52, colors: ["#508df2", "#173e99"], bands: ["#3f77d2", "#6aa9ff", "#224eaa"],
      moons: [{ name: "Тритон", size: .43, distance: 18, period: .0161, color: "#b7c4ca", phase: .15, retro: true }] }
  ];

  const state = {
    width: 0, height: 0, dpr: 1, time: 0, clock: 0,
    speed: 1, zoom: 1, trailAmount: .72,
    paused: false, labels: true,
    yaw: -.42, elevation: .49, autoRotate: true,
    dragging: false, pointerX: 0, pointerY: 0, moved: false,
    selected: null, trailTimer: 0, frameCount: 0
  };

  let stars = [];
  let dust = [];
  let projectedBodies = [];
  let lastTimestamp = performance.now();

  function seededRandom(seed) {
    let n = seed >>> 0;
    return function () {
      n += 0x6D2B79F5;
      let t = n;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const rand = seededRandom(5602026);

  function orbitScale(au) {
    return 31 + 56 * Math.pow(au, .515);
  }

  function solveKepler(mean, eccentricity) {
    let E = mean;
    for (let i = 0; i < 5; i += 1) {
      E -= (E - eccentricity * Math.sin(E) - mean) / (1 - eccentricity * Math.cos(E));
    }
    return E;
  }

  function orbitalPosition(body, time, overridePhase) {
    const phase = overridePhase === undefined ? body.phase : overridePhase;
    const M = ((phase + time / body.period) % 1) * TAU;
    const E = solveKepler(M, body.e);
    const a = orbitScale(body.a);
    const x0 = a * (Math.cos(E) - body.e);
    const y0 = a * Math.sqrt(1 - body.e * body.e) * Math.sin(E);
    const arg = body.peri * DEG;
    const node = body.node * DEG;
    const inc = body.inc * DEG;
    const xp = x0 * Math.cos(arg) - y0 * Math.sin(arg);
    const yp = x0 * Math.sin(arg) + y0 * Math.cos(arg);
    return {
      x: xp * Math.cos(node) - yp * Math.sin(node) * Math.cos(inc),
      y: xp * Math.sin(node) + yp * Math.cos(node) * Math.cos(inc),
      z: yp * Math.sin(inc)
    };
  }

  function worldToView(point) {
    const cy = Math.cos(state.yaw);
    const sy = Math.sin(state.yaw);
    const x1 = point.x * cy - point.y * sy;
    const y1 = point.x * sy + point.y * cy;
    const ce = Math.cos(state.elevation);
    const se = Math.sin(state.elevation);
    return { x: x1, y: y1 * se - point.z * ce, depth: y1 * ce + point.z * se };
  }

  function baseScale() {
    return Math.min(state.width / 910, state.height / 690) * state.zoom;
  }

  function project(point) {
    const view = worldToView(point);
    const scale = baseScale();
    const perspective = 820 / (820 + view.depth * scale * .28);
    return {
      x: state.width * .5 + view.x * scale * perspective,
      y: state.height * .51 + view.y * scale * perspective,
      depth: view.depth,
      perspective: perspective
    };
  }

  function resize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    canvas.style.width = state.width + "px";
    canvas.style.height = state.height + "px";
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    buildStars();
  }

  function buildStars() {
    const count = Math.min(1150, Math.floor(state.width * state.height / 1050));
    stars = [];
    for (let i = 0; i < count; i += 1) {
      stars.push({
        x: rand() * state.width, y: rand() * state.height,
        r: Math.pow(rand(), 4) * 1.65 + .18,
        alpha: .18 + rand() * .72, pulse: rand() * TAU,
        speed: .3 + rand() * 1.4, tint: rand()
      });
    }
    dust = [];
    for (let i = 0; i < 560; i += 1) {
      dust.push({
        a: 2.15 + rand() * 1.15, angle: rand() * TAU,
        z: (rand() - .5) * 5, size: .15 + rand() * .65,
        drift: .02 + rand() * .025
      });
    }
  }

  function drawBackground() {
    const reach = Math.max(state.width, state.height);
    const bg = ctx.createRadialGradient(state.width * .48, state.height * .48, 0, state.width * .48, state.height * .48, reach * .75);
    bg.addColorStop(0, "#0a1221");
    bg.addColorStop(.38, "#050a14");
    bg.addColorStop(1, "#010207");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, state.width, state.height);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const nebula = ctx.createRadialGradient(state.width * .73, state.height * .2, 0, state.width * .73, state.height * .2, state.width * .52);
    nebula.addColorStop(0, "rgba(33,65,113,.12)");
    nebula.addColorStop(.45, "rgba(15,35,78,.055)");
    nebula.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, state.width, state.height);
    const haze = ctx.createRadialGradient(state.width * .1, state.height * .88, 0, state.width * .1, state.height * .88, state.width * .38);
    haze.addColorStop(0, "rgba(66,25,83,.085)");
    haze.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.restore();

    stars.forEach(function (star) {
      const shimmer = .72 + Math.sin(state.clock * star.speed + star.pulse) * .28;
      const alpha = star.alpha * shimmer;
      let color = "225,238,255";
      if (star.tint > .93) color = "142,190,255";
      else if (star.tint < .08) color = "255,219,179";
      ctx.fillStyle = "rgba(" + color + "," + alpha + ")";
      ctx.fillRect(star.x, star.y, star.r, star.r);
      if (star.r > 1.35) {
        ctx.fillStyle = "rgba(194,222,255," + alpha * .25 + ")";
        ctx.fillRect(star.x - star.r * 2, star.y + star.r * .35, star.r * 5, .45);
      }
    });
  }

  function buildOrbitPoints(body) {
    const points = [];
    for (let i = 0; i <= 150; i += 1) points.push(orbitalPosition(body, 0, i / 150));
    return points;
  }

  planets.forEach(function (planet) {
    planet.orbitPoints = buildOrbitPoints(planet);
    planet.trail = [];
    planet.position = orbitalPosition(planet, 0);
  });

  function drawOrbits() {
    ctx.save();
    ctx.lineWidth = .7;
    for (let p = planets.length - 1; p >= 0; p -= 1) {
      ctx.beginPath();
      planets[p].orbitPoints.forEach(function (point, index) {
        const q = project(point);
        if (index === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.strokeStyle = p < 4 ? "rgba(102,161,198,.16)" : "rgba(104,146,178,.12)";
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAsteroidBelt() {
    ctx.save();
    dust.forEach(function (bit) {
      const angle = bit.angle + state.time * bit.drift;
      const radius = orbitScale(bit.a) * (.97 + Math.sin(bit.angle * 13) * .018);
      const q = project({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: bit.z });
      const size = bit.size * q.perspective * Math.max(.65, baseScale());
      ctx.fillStyle = "rgba(181,163,132," + (.09 + .14 * q.perspective) + ")";
      ctx.fillRect(q.x, q.y, size, size);
    });
    ctx.restore();
  }

  function updateTrails(dt) {
    if (state.trailAmount <= 0 || state.paused) return;
    state.trailTimer += dt;
    if (state.trailTimer < .045) return;
    state.trailTimer = 0;
    const maxPoints = Math.floor(18 + state.trailAmount * 92);
    planets.forEach(function (body) {
      body.trail.push({ x: body.position.x, y: body.position.y, z: body.position.z });
      if (body.trail.length > maxPoints) body.trail.splice(0, body.trail.length - maxPoints);
    });
  }

  function drawTrails() {
    if (state.trailAmount <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    planets.forEach(function (body, bodyIndex) {
      if (body.trail.length < 2) return;
      for (let i = 1; i < body.trail.length; i += 1) {
        const a = project(body.trail[i - 1]);
        const b = project(body.trail[i]);
        const life = i / body.trail.length;
        let hue = "199,211,218";
        if (bodyIndex === 2) hue = "110,190,255";
        else if (bodyIndex === 3) hue = "236,126,75";
        else if (bodyIndex > 4) hue = "126,174,219";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineWidth = .25 + life * 1.15;
        ctx.strokeStyle = "rgba(" + hue + "," + life * life * .19 * state.trailAmount + ")";
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  function planetScreenRadius(body, q) {
    const scaleBoost = Math.pow(Math.max(baseScale(), .45), .56);
    return (2.2 + 1.72 * Math.pow(body.radius, .54)) * q.perspective * scaleBoost;
  }

  function drawSun(q) {
    const radius = 20 * Math.pow(Math.max(baseScale(), .5), .45) * q.perspective;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const corona = ctx.createRadialGradient(q.x, q.y, radius * .15, q.x, q.y, radius * 5.2);
    corona.addColorStop(0, "rgba(255,249,197,1)");
    corona.addColorStop(.16, "rgba(255,185,61,.9)");
    corona.addColorStop(.34, "rgba(255,116,22,.24)");
    corona.addColorStop(.65, "rgba(255,75,9,.055)");
    corona.addColorStop(1, "rgba(255,60,0,0)");
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(q.x, q.y, radius * 5.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    const surface = ctx.createRadialGradient(q.x - radius * .25, q.y - radius * .3, radius * .05, q.x, q.y, radius);
    surface.addColorStop(0, "#fffce3");
    surface.addColorStop(.36, "#ffe56b");
    surface.addColorStop(.76, "#ff9f22");
    surface.addColorStop(1, "#e9500c");
    ctx.fillStyle = surface;
    ctx.beginPath();
    ctx.arc(q.x, q.y, radius, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(q.x, q.y, radius * .96, 0, TAU);
    ctx.clip();
    ctx.globalAlpha = .19;
    for (let i = 0; i < 11; i += 1) {
      const angle = i * 2.4 + state.clock * (.08 + i * .002);
      const distance = radius * (.2 + i % 5 * .14);
      ctx.fillStyle = i % 3 ? "#fff7b0" : "#ff6b10";
      ctx.beginPath();
      ctx.arc(q.x + Math.cos(angle) * distance, q.y + Math.sin(angle * 1.27) * distance, radius * (.07 + i % 4 * .018), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    return radius;
  }

  function lightVectorFor(body, q) {
    const sun = project({ x: 0, y: 0, z: 0 });
    const dx = sun.x - q.x;
    const dy = sun.y - q.y;
    const length = Math.hypot(dx, dy) || 1;
    const view = worldToView(body.position);
    const distance = Math.hypot(body.position.x, body.position.y, body.position.z) || 1;
    return { x: dx / length, y: dy / length, depth: view.depth / distance };
  }

  function drawRings(q, radius, frontOnly) {
    const rotation = -state.yaw * .55 - .18;
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate(rotation);
    ctx.scale(1, .3 + Math.abs(Math.sin(state.elevation)) * .16);
    ctx.lineCap = "round";
    const rings = [
      [1.48, .8, "rgba(198,174,124,.30)"],
      [1.67, 1.9, "rgba(238,218,166,.60)"],
      [1.86, 1.2, "rgba(151,126,86,.48)"],
      [2.08, 2.8, "rgba(217,194,143,.52)"],
      [2.28, .8, "rgba(178,151,104,.30)"]
    ];
    rings.forEach(function (ring) {
      ctx.beginPath();
      if (frontOnly) ctx.arc(0, 0, radius * ring[0], 0, Math.PI);
      else ctx.arc(0, 0, radius * ring[0], 0, TAU);
      ctx.strokeStyle = ring[2];
      ctx.lineWidth = ring[1];
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawPlanetTexture(body, q, radius, light) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(q.x, q.y, radius, 0, TAU);
    ctx.clip();

    const glowX = q.x + light.x * radius * .42;
    const glowY = q.y + light.y * radius * .42;
    const surface = ctx.createRadialGradient(glowX, glowY, radius * .04, q.x - light.x * radius * .22, q.y - light.y * radius * .22, radius * 1.18);
    surface.addColorStop(0, body.colors[0]);
    surface.addColorStop(.58, body.colors[0]);
    surface.addColorStop(1, body.colors[1]);
    ctx.fillStyle = surface;
    ctx.fillRect(q.x - radius, q.y - radius, radius * 2, radius * 2);

    const spin = state.time * (body.name === "Юпитер" ? 8 : 3.2) + body.phase * 12;
    if (body.bands) {
      body.bands.forEach(function (color, index) {
        const y = q.y - radius + (index + .55) * radius * 2 / body.bands.length;
        ctx.strokeStyle = color;
        ctx.globalAlpha = .5;
        ctx.lineWidth = radius * (.16 + index % 2 * .08);
        ctx.beginPath();
        ctx.moveTo(q.x - radius, y + Math.sin(spin + index) * radius * .025);
        ctx.bezierCurveTo(q.x - radius * .25, y - radius * .05, q.x + radius * .28, y + radius * .05, q.x + radius, y);
        ctx.stroke();
      });
    }

    if (body.earth) {
      ctx.fillStyle = "rgba(76,143,82,.85)";
      ctx.globalAlpha = .9;
      ctx.beginPath();
      ctx.ellipse(q.x - radius * .22 + Math.sin(spin) * radius * .18, q.y - radius * .18, radius * .24, radius * .38, -.55, 0, TAU);
      ctx.ellipse(q.x + radius * .34 + Math.sin(spin + 2) * radius * .12, q.y + radius * .22, radius * .28, radius * .18, .4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(235,248,255,.65)";
      ctx.lineWidth = Math.max(.5, radius * .08);
      ctx.beginPath();
      ctx.arc(q.x, q.y, radius * .78, -2.7, -1.9);
      ctx.stroke();
    }

    if (body.clouds) {
      ctx.strokeStyle = "rgba(255,244,207,.34)";
      ctx.lineWidth = Math.max(.5, radius * .12);
      for (let i = -2; i <= 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(q.x - radius, q.y + i * radius * .32);
        ctx.quadraticCurveTo(q.x + Math.sin(spin + i) * radius * .4, q.y + i * radius * .25, q.x + radius, q.y + i * radius * .3);
        ctx.stroke();
      }
    }

    if (body.rough) {
      ctx.fillStyle = "rgba(34,20,17,.18)";
      for (let i = 0; i < 8; i += 1) {
        const angle = i * 2.31 + body.phase * 17;
        ctx.beginPath();
        ctx.arc(q.x + Math.cos(angle) * radius * .62, q.y + Math.sin(angle * 1.37) * radius * .55, Math.max(.35, radius * (.035 + i % 3 * .018)), 0, TAU);
        ctx.fill();
      }
    }

    if (body.spot) {
      ctx.fillStyle = "rgba(140,56,42,.66)";
      ctx.beginPath();
      ctx.ellipse(q.x + Math.sin(spin * .22) * radius * .42, q.y + radius * .28, radius * .22, radius * .1, -.08, 0, TAU);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    const nightStrength = .62 + Math.max(-.18, light.depth) * .22;
    const shadow = ctx.createLinearGradient(q.x + light.x * radius, q.y + light.y * radius, q.x - light.x * radius, q.y - light.y * radius);
    shadow.addColorStop(0, "rgba(0,7,18,.02)");
    shadow.addColorStop(.43, "rgba(0,5,14,.08)");
    shadow.addColorStop(.68, "rgba(0,4,12," + nightStrength * .58 + ")");
    shadow.addColorStop(1, "rgba(0,2,8," + nightStrength + ")");
    ctx.fillStyle = shadow;
    ctx.fillRect(q.x - radius, q.y - radius, radius * 2, radius * 2);

    const rim = ctx.createRadialGradient(q.x, q.y, radius * .68, q.x, q.y, radius);
    rim.addColorStop(0, "rgba(0,0,0,0)");
    rim.addColorStop(.9, "rgba(0,0,0,.08)");
    rim.addColorStop(1, "rgba(0,0,0,.52)");
    ctx.fillStyle = rim;
    ctx.fillRect(q.x - radius, q.y - radius, radius * 2, radius * 2);
    ctx.restore();

    ctx.strokeStyle = "rgba(220,239,255,.13)";
    ctx.lineWidth = .55;
    ctx.beginPath();
    ctx.arc(q.x, q.y, radius - .25, 0, TAU);
    ctx.stroke();
  }

  function drawMoon(moon, body, parentQ, moonIndex) {
    const direction = moon.retro ? -1 : 1;
    const angle = moon.phase * TAU + state.time / moon.period * TAU * direction;
    const orbitRadius = moon.distance * Math.pow(Math.max(baseScale(), .5), .42);
    const flatten = .42 + Math.sin(state.elevation) * .17;
    const mx = parentQ.x + Math.cos(angle + state.yaw * .3) * orbitRadius;
    const my = parentQ.y + Math.sin(angle + state.yaw * .3) * orbitRadius * flatten;
    const moonRadius = Math.max(.8, moon.size * 2.2 * Math.pow(Math.max(baseScale(), .5), .35));
    const sun = project({ x: 0, y: 0, z: 0 });
    const dx = sun.x - mx;
    const dy = sun.y - my;
    const length = Math.hypot(dx, dy) || 1;
    const gradient = ctx.createRadialGradient(mx + dx / length * moonRadius * .35, my + dy / length * moonRadius * .35, 0, mx, my, moonRadius);
    gradient.addColorStop(0, moon.color);
    gradient.addColorStop(.68, moon.color);
    gradient.addColorStop(1, "#11151c");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(mx, my, moonRadius, 0, TAU);
    ctx.fill();
    if (body === state.selected && state.labels && moonIndex === 0) {
      ctx.fillStyle = "rgba(199,216,230,.58)";
      ctx.font = "9px system-ui, sans-serif";
      ctx.fillText(moon.name, mx + 5, my - 4);
    }
  }

  function drawPlanet(body, q) {
    const radius = planetScreenRadius(body, q);
    const light = lightVectorFor(body, q);
    if (body.rings) drawRings(q, radius, false);
    drawPlanetTexture(body, q, radius, light);
    if (body.rings) drawRings(q, radius, true);
    if (body.moons) body.moons.forEach(function (moon, index) { drawMoon(moon, body, q, index); });
    if (body === state.selected) {
      ctx.save();
      ctx.strokeStyle = "rgba(115,210,255,.7)";
      ctx.lineWidth = .7;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(q.x, q.y, radius + 6 + Math.sin(state.clock * 2) * 1.3, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    return radius;
  }

  function drawLabel(body, q, radius) {
    if (!state.labels) return;
    const alpha = Math.min(.82, .28 + baseScale() * .35);
    ctx.save();
    ctx.font = "500 9px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const textWidth = ctx.measureText(body.name).width;
    const lx = q.x + radius + 8;
    const ly = q.y - radius - 3;
    ctx.strokeStyle = "rgba(143,191,220," + alpha * .38 + ")";
    ctx.lineWidth = .6;
    ctx.beginPath();
    ctx.moveTo(q.x + radius * .68, q.y - radius * .68);
    ctx.lineTo(lx - 3, ly);
    ctx.lineTo(lx + textWidth + 4, ly);
    ctx.stroke();
    ctx.fillStyle = "rgba(207,227,240," + alpha + ")";
    ctx.fillText(body.name.toUpperCase(), lx, ly - 6);
    ctx.restore();
  }

  function renderBodies() {
    projectedBodies = planets.map(function (body) {
      body.position = orbitalPosition(body, state.time);
      return { body: body, q: project(body.position), radius: 0 };
    });
    projectedBodies.sort(function (a, b) { return b.q.depth - a.q.depth; });
    const sunQ = project({ x: 0, y: 0, z: 0 });
    let sunDrawn = false;
    projectedBodies.forEach(function (item) {
      if (!sunDrawn && item.q.depth < 0) {
        projectedBodies.sunRadius = drawSun(sunQ);
        sunDrawn = true;
      }
      item.radius = drawPlanet(item.body, item.q);
    });
    if (!sunDrawn) projectedBodies.sunRadius = drawSun(sunQ);
    projectedBodies.forEach(function (item) { drawLabel(item.body, item.q, item.radius); });
    projectedBodies.sunQ = sunQ;
  }

  function drawVignette() {
    const reach = Math.max(state.width, state.height) * .68;
    const vignette = ctx.createRadialGradient(state.width * .5, state.height * .5, Math.min(state.width, state.height) * .18, state.width * .5, state.height * .5, reach);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(.72, "rgba(0,0,0,.08)");
    vignette.addColorStop(1, "rgba(0,0,0,.62)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.fillStyle = "rgba(178,211,234,.025)";
    for (let y = 0; y < state.height; y += 4) ctx.fillRect(0, y, state.width, 1);
  }

  function render() {
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    drawBackground();
    drawOrbits();
    drawAsteroidBelt();
    drawTrails();
    renderBodies();
    drawVignette();
  }

  function update(dt) {
    state.clock += dt;
    if (!state.paused) {
      state.time += dt * .082 * state.speed;
      if (state.autoRotate) state.yaw += dt * .022;
    }
    updateTrails(dt);
    state.frameCount += 1;
    if (state.frameCount % 12 === 0) ui.missionTime.textContent = "T + " + state.time.toFixed(2) + " земных лет";
  }

  function frame(timestamp) {
    const dt = Math.min(.05, Math.max(0, (timestamp - lastTimestamp) / 1000));
    lastTimestamp = timestamp;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function updateControls() {
    ui.zoomValue.value = Math.round(state.zoom * 100) + "%";
    ui.speedValue.value = state.speed.toFixed(2) + "×";
    ui.trailValue.value = Math.round(state.trailAmount * 100) + "%";
  }

  ui.zoom.addEventListener("input", function () {
    state.zoom = Number(ui.zoom.value) / 100;
    updateControls();
  });
  ui.speed.addEventListener("input", function () {
    const value = Number(ui.speed.value) / 100;
    state.speed = value * value;
    updateControls();
  });
  ui.trail.addEventListener("input", function () {
    state.trailAmount = Number(ui.trail.value) / 100;
    if (state.trailAmount === 0) planets.forEach(function (body) { body.trail.length = 0; });
    updateControls();
  });
  ui.pause.addEventListener("click", function () {
    state.paused = !state.paused;
    ui.pause.textContent = state.paused ? "Продолжить" : "Пауза";
    ui.pause.setAttribute("aria-pressed", String(state.paused));
  });
  ui.labels.addEventListener("click", function () {
    state.labels = !state.labels;
    ui.labels.textContent = "Метки: " + (state.labels ? "вкл" : "выкл");
    ui.labels.setAttribute("aria-pressed", String(state.labels));
  });
  ui.reset.addEventListener("click", function () {
    state.yaw = -.42;
    state.elevation = .49;
    state.zoom = 1;
    state.autoRotate = true;
    ui.zoom.value = "100";
    updateControls();
  });

  canvas.addEventListener("pointerdown", function (event) {
    state.dragging = true;
    state.moved = false;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", function (event) {
    if (!state.dragging) return;
    const dx = event.clientX - state.pointerX;
    const dy = event.clientY - state.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 2) state.moved = true;
    state.yaw += dx * .006;
    state.elevation = Math.max(.16, Math.min(1.28, state.elevation + dy * .004));
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    state.autoRotate = false;
  });
  canvas.addEventListener("pointerup", function (event) {
    state.dragging = false;
    if (!state.moved) selectBody(event.clientX, event.clientY);
  });
  canvas.addEventListener("pointercancel", function () { state.dragging = false; });
  canvas.addEventListener("wheel", function (event) {
    event.preventDefault();
    state.zoom = Math.max(.55, Math.min(2.2, state.zoom * Math.exp(-event.deltaY * .001)));
    ui.zoom.value = String(Math.round(state.zoom * 100));
    updateControls();
  }, { passive: false });

  function selectBody(x, y) {
    let nearest = null;
    let nearestDistance = 24;
    projectedBodies.forEach(function (item) {
      const distance = Math.hypot(x - item.q.x, y - item.q.y);
      const hitRadius = Math.max(12, item.radius + 7);
      if (distance < hitRadius && distance < nearestDistance) {
        nearest = item.body;
        nearestDistance = distance;
      }
    });
    const sunQ = projectedBodies.sunQ;
    if (sunQ && Math.hypot(x - sunQ.x, y - sunQ.y) < (projectedBodies.sunRadius || 20) + 5) nearest = null;
    state.selected = nearest;
    if (nearest) {
      ui.focusName.textContent = nearest.name;
      ui.focusMeta.textContent = nearest.type + " · " + nearest.a.toFixed(nearest.a < 10 ? 2 : 1) + " а.е. · год " + nearest.period.toFixed(nearest.period < 10 ? 2 : 1) + " зем.";
    } else {
      ui.focusName.textContent = "Солнце";
      ui.focusMeta.textContent = "G2V · центр системы";
    }
  }

  window.addEventListener("resize", resize);
  resize();
  updateControls();
  requestAnimationFrame(frame);
}());
