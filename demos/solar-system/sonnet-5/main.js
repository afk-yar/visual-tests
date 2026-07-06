'use strict';
(function () {
  const Orbits = window.Orbits;
  const TWO_PI = Orbits.TWO_PI;

  // ---------------------------------------------------------------------
  // Утилиты
  // ---------------------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function deg2rad(d) { return (d * Math.PI) / 180; }
  function rad2deg(r) { return (r * 180) / Math.PI; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Небольшой детерминированный PRNG (mulberry32), чтобы декоративные детали
  // поверхности планет (пятна, полосы) были стабильны от кадра к кадру и от
  // перезагрузки к перезагрузке, а не мигали случайным шумом.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------------
  // Шкалы: реальные астрономические величины -> «художественные» мировые единицы.
  // Только линейные расстояния и время сжимаются нелинейно (иначе внешние
  // планеты либо невидимы, либо неподвижны за время наблюдения); эксцентриситет,
  // наклонения и прочие углы используются как есть — они безразмерны и не
  // нуждаются в сжатии, поэтому форма и наклон орбит остаются достоверными.
  // ---------------------------------------------------------------------
  const SUN_VISUAL_R = 0.0401 * Math.sqrt(696000); // ~33.5
  const ORBIT_SCALE = 70;
  const ORBIT_BASE = 40;
  function visualDistanceAU(au) { return ORBIT_BASE + ORBIT_SCALE * Math.sqrt(au); }

  const PERIOD_C = 9 / Math.pow(87.969, 0.45); // калибровка: у Меркурия видимый период = 9 «сек»
  const PERIOD_POWER = 0.45;
  function visualPeriodDays(realDays) {
    const sign = realDays < 0 ? -1 : 1;
    return sign * PERIOD_C * Math.pow(Math.abs(realDays), PERIOD_POWER);
  }

  const PLANET_R_K = 3.2 / Math.sqrt(6371); // калибровка: у Земли видимый радиус ~3.2
  function visualRadiusKm(km) { return PLANET_R_K * Math.sqrt(km); }
  function visualMoonRadiusKm(km) { return Math.max(0.42, PLANET_R_K * Math.sqrt(km) * 0.9); }

  // ---------------------------------------------------------------------
  // Данные планет и лун (приближённые реальные орбитальные элементы).
  // ---------------------------------------------------------------------
  const rng = mulberry32(20260706);

  function makeSurfaceBlobs(count, colors) {
    const blobs = [];
    for (let i = 0; i < count; i++) {
      const ang = rng() * TWO_PI;
      const rad = rng() * 0.72;
      blobs.push({
        dx: Math.cos(ang) * rad,
        dy: Math.sin(ang) * rad * 0.7,
        r: 0.14 + rng() * 0.26,
        color: colors[Math.floor(rng() * colors.length)],
        alpha: 0.14 + rng() * 0.22,
      });
    }
    return blobs;
  }

  function rockySurface(baseColor, blobs) {
    return function (ctx, sx, sy, sr) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(sx - sr - 2, sy - sr - 2, sr * 2 + 4, sr * 2 + 4);
      for (const b of blobs) {
        ctx.globalAlpha = b.alpha;
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.ellipse(sx + b.dx * sr, sy + b.dy * sr, b.r * sr, b.r * sr * 0.82, 0, 0, TWO_PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
  }

  function bandedSurface(baseColor, bandColors, spotColor) {
    const bandCount = bandColors.length;
    const hasSpot = !!spotColor;
    const spotLat = -18 + rng() * 36;
    const spotLon = rng() * 360;
    return function (ctx, sx, sy, sr) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(sx - sr - 2, sy - sr - 2, sr * 2 + 4, sr * 2 + 4);
      for (let i = 0; i < bandCount; i++) {
        const lat0 = -90 + (180 * i) / bandCount;
        const lat1 = -90 + (180 * (i + 1)) / bandCount;
        const y0 = sr * Math.sin(deg2rad(lat0));
        const y1 = sr * Math.sin(deg2rad(lat1));
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = bandColors[i];
        ctx.fillRect(sx - sr - 2, sy + Math.min(y0, y1), sr * 2 + 4, Math.abs(y1 - y0) + 0.6);
      }
      ctx.globalAlpha = 1;
      if (hasSpot) {
        const y = sr * Math.sin(deg2rad(spotLat));
        const x = sr * Math.cos(deg2rad(spotLat)) * Math.cos(deg2rad(spotLon)) * 0.9;
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = spotColor;
        ctx.beginPath();
        ctx.ellipse(sx + x, sy + y, sr * 0.24, sr * 0.13, deg2rad(spotLon * 0.2), 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    };
  }

  function makePlanet(def) {
    const p = Object.assign({}, def);
    p.orbitParams = {
      a: visualDistanceAU(def.a),
      e: def.e,
      periodDays: visualPeriodDays(def.periodDays),
      inclinationDeg: def.inclinationDeg,
      ascNodeDeg: def.ascNodeDeg,
      argPeriapsisDeg: def.argPeriapsisDeg,
      phase0Deg: def.phase0Deg,
    };
    p.visualRadius = visualRadiusKm(def.radiusKm);
    p.trail = [];
    p.trailMaxAge = p.orbitParams.periodDays * 0.28;
    // Гид-контур орбиты: равномерная по эксцентрической аномалии выборка —
    // даёт гладкий эллипс независимо от неравномерности орбитального движения.
    p.guidePoints = [];
    const GUIDE_SAMPLES = 128;
    for (let i = 0; i <= GUIDE_SAMPLES; i++) {
      const E = (TWO_PI * i) / GUIDE_SAMPLES;
      p.guidePoints.push(Orbits.positionFromEccentricAnomaly(p.orbitParams, E));
    }
    p.moons = (def.moons || []).map(function (m, idx) {
      const moon = Object.assign({}, m);
      moon.orbitParams = {
        a: p.visualRadius * m.orbitFactor,
        e: m.e,
        periodDays: visualPeriodDays(m.periodDays),
        inclinationDeg: m.inclinationDeg,
        ascNodeDeg: (idx * 47 + 30) % 360,
        argPeriapsisDeg: (idx * 83 + 10) % 360,
        phase0Deg: rng() * 360,
      };
      moon.visualRadius = visualMoonRadiusKm(m.radiusKm);
      return moon;
    });
    return p;
  }

  const PLANET_DEFS = [
    {
      id: 'mercury', name: 'Меркурий', a: 0.387, e: 0.2056, periodDays: 87.969,
      inclinationDeg: 7.0, ascNodeDeg: 48.3, argPeriapsisDeg: 29.1, phase0Deg: 20,
      radiusKm: 2439.7, color: '#b8ac9f', trailColor: '#c9bda9',
      drawSurface: rockySurface('#a89a89', makeSurfaceBlobs(10, ['#8d8071', '#c4b8a4'])),
    },
    {
      id: 'venus', name: 'Венера', a: 0.7233, e: 0.0068, periodDays: 224.701,
      inclinationDeg: 3.39, ascNodeDeg: 76.7, argPeriapsisDeg: 54.9, phase0Deg: 160,
      radiusKm: 6051.8, color: '#e6cf9c', trailColor: '#f0dca8',
      drawSurface: rockySurface('#dcc48f', makeSurfaceBlobs(8, ['#eadcb0', '#c9a969'])),
    },
    {
      id: 'earth', name: 'Земля', a: 1.0, e: 0.0167, periodDays: 365.256,
      inclinationDeg: 0.0, ascNodeDeg: 0, argPeriapsisDeg: 114.2, phase0Deg: 250,
      radiusKm: 6371.0, color: '#3d7ec2', trailColor: '#6fb8ff',
      drawSurface: rockySurface('#2f6fb0', makeSurfaceBlobs(12, ['#3f8f4f', '#357a45', '#e8e8e0'])),
      moons: [
        { name: 'Луна', radiusKm: 1737.4, periodDays: 27.322, e: 0.0549, inclinationDeg: 5.14, orbitFactor: 3.1, color: '#c9c6bd' },
      ],
    },
    {
      id: 'mars', name: 'Марс', a: 1.5237, e: 0.0934, periodDays: 686.98,
      inclinationDeg: 1.85, ascNodeDeg: 49.6, argPeriapsisDeg: 286.5, phase0Deg: 55,
      radiusKm: 3389.5, color: '#c1440e', trailColor: '#e0693a',
      drawSurface: rockySurface('#b6491f', makeSurfaceBlobs(9, ['#8f3413', '#d9895a'])),
      moons: [
        { name: 'Фобос', radiusKm: 11.3, periodDays: 0.319, e: 0.0151, inclinationDeg: 1.08, orbitFactor: 1.8, color: '#9a8a7c' },
        { name: 'Деймос', radiusKm: 6.2, periodDays: 1.263, e: 0.00033, inclinationDeg: 1.79, orbitFactor: 2.4, color: '#9a8a7c' },
      ],
    },
    {
      id: 'jupiter', name: 'Юпитер', a: 5.204, e: 0.0489, periodDays: 4332.59,
      inclinationDeg: 1.303, ascNodeDeg: 100.5, argPeriapsisDeg: 273.9, phase0Deg: 300,
      radiusKm: 69911, color: '#cbab7f', trailColor: '#e0c393',
      drawSurface: bandedSurface('#cdae82', ['#e4cca3', '#c8a578', '#e8d3ac', '#b98f5e', '#e4cca3', '#c39a6b'], 'rgba(196,102,64,0.55)'),
      moons: [
        { name: 'Ио', radiusKm: 1821.6, periodDays: 1.769, e: 0.0041, inclinationDeg: 0.05, orbitFactor: 2.0, color: '#e0c85f' },
        { name: 'Европа', radiusKm: 1560.8, periodDays: 3.551, e: 0.009, inclinationDeg: 0.47, orbitFactor: 2.5, color: '#d9cbb0' },
        { name: 'Ганимед', radiusKm: 2634.1, periodDays: 7.155, e: 0.0013, inclinationDeg: 0.2, orbitFactor: 3.2, color: '#a89a86' },
        { name: 'Каллисто', radiusKm: 2410.3, periodDays: 16.689, e: 0.0074, inclinationDeg: 0.19, orbitFactor: 4.0, color: '#7d7264' },
      ],
    },
    {
      id: 'saturn', name: 'Сатурн', a: 9.5826, e: 0.0565, periodDays: 10759.22,
      inclinationDeg: 2.485, ascNodeDeg: 113.6, argPeriapsisDeg: 339.4, phase0Deg: 120,
      radiusKm: 58232, color: '#e3c98a', trailColor: '#f0dda4',
      drawSurface: bandedSurface('#e6cd92', ['#f2e0ac', '#dcbb7e', '#eed6a0', '#d3ad78', '#f2e0ac'], null),
      axialTiltDeg: 26.73, axialTiltAzimuthDeg: 15,
      rings: { innerFactor: 1.28, outerFactor: 2.35, gapFactor: 1.9, color: '#d8c9a3', faint: false },
      moons: [
        { name: 'Титан', radiusKm: 2574.7, periodDays: 15.945, e: 0.0288, inclinationDeg: 0.35, orbitFactor: 3.6, color: '#d9a24a' },
      ],
    },
    {
      id: 'uranus', name: 'Уран', a: 19.2184, e: 0.0457, periodDays: 30688.5,
      inclinationDeg: 0.773, ascNodeDeg: 74.0, argPeriapsisDeg: 96.5, phase0Deg: 210,
      radiusKm: 25362, color: '#9fd9e0', trailColor: '#b8ecf2',
      drawSurface: bandedSurface('#a4dbe2', ['#b7e6ec', '#93cdd4', '#aee0e6'], null),
      axialTiltDeg: 97.77, axialTiltAzimuthDeg: 200,
      rings: { innerFactor: 1.64, outerFactor: 2.0, gapFactor: 1.82, color: '#8fb9c0', faint: true },
      moons: [
        { name: 'Титания', radiusKm: 788.4, periodDays: 8.706, e: 0.0011, inclinationDeg: 0.34, orbitFactor: 3.0, color: '#b8b0a6' },
      ],
    },
    {
      id: 'neptune', name: 'Нептун', a: 30.11, e: 0.0113, periodDays: 60195,
      inclinationDeg: 1.77, ascNodeDeg: 131.8, argPeriapsisDeg: 265.6, phase0Deg: 30,
      radiusKm: 24622, color: '#3f5fd4', trailColor: '#7a92ee',
      drawSurface: bandedSurface('#3c5cd0', ['#5470dc', '#3450bd', '#4a63d6'], 'rgba(20,30,90,0.5)'),
      moons: [
        // Тритон — ретроградный спутник; отрицательный период кодирует обратное движение.
        { name: 'Тритон', radiusKm: 1353.4, periodDays: -5.877, e: 0.000016, inclinationDeg: 18, orbitFactor: 2.7, color: '#cfe0ea' },
      ],
    },
  ];

  const PLANETS = PLANET_DEFS.map(makePlanet);

  // ---------------------------------------------------------------------
  // Пояс астероидов между Марсом и Юпитером: третий закон Кеплера (T ~ a^1.5
  // в реальных а.е.) даёт настоящее физическое соотношение периода и радиуса,
  // затем период сжимается той же нелинейной шкалой, что и у планет.
  // ---------------------------------------------------------------------
  const ASTEROID_COUNT = 260;
  const asteroids = [];
  (function buildBelt() {
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const auReal = 2.15 + rng() * 0.95;
      const e = rng() * 0.12;
      const inclinationDeg = (rng() - 0.5) * 16;
      const realPeriodDays = 365.256 * Math.pow(auReal, 1.5);
      asteroids.push({
        orbitParams: {
          a: visualDistanceAU(auReal),
          e: e,
          periodDays: visualPeriodDays(realPeriodDays),
          inclinationDeg: inclinationDeg,
          ascNodeDeg: rng() * 360,
          argPeriapsisDeg: rng() * 360,
          phase0Deg: rng() * 360,
        },
        visualRadius: 0.14 + rng() * 0.34,
        color: rng() < 0.5 ? '#a99884' : '#8a7a68',
        alpha: 0.4 + rng() * 0.4,
      });
    }
  })();

  // ---------------------------------------------------------------------
  // Звёздное небо: точки на большой сфере вокруг всей сцены.
  // ---------------------------------------------------------------------
  const STAR_COUNT = 520;
  const stars = [];
  (function buildStars() {
    for (let i = 0; i < STAR_COUNT; i++) {
      const u = rng() * 2 - 1;
      const theta = rng() * TWO_PI;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      const R = 2600 + rng() * 1500;
      stars.push({
        x: R * s * Math.cos(theta), y: R * u, z: R * s * Math.sin(theta),
        size: 0.5 + rng() * 1.5,
        baseAlpha: 0.25 + rng() * 0.6,
        twinkleSpeed: 0.4 + rng() * 2.0,
        twinklePhase: rng() * TWO_PI,
        warm: rng() < 0.15,
      });
    }
  })();

  // ---------------------------------------------------------------------
  // Кольца: базис плоскости кольца (нормаль = ось вращения планеты + два
  // перпендикулярных орта), общая функция для любой окольцованной планеты.
  // ---------------------------------------------------------------------
  function ringSpinAxis(axialTiltDeg, axialTiltAzimuthDeg) {
    const tilt = deg2rad(axialTiltDeg || 0);
    const az = deg2rad(axialTiltAzimuthDeg || 0);
    const hx = Math.cos(az), hz = Math.sin(az); // ось наклона в плоскости XZ
    // Поворот вектора "вверх" (0,1,0) вокруг горизонтальной оси (hx,0,hz) на угол tilt
    // (формула Родрига при hinge·v = 0 для v=(0,1,0)).
    const nx = -Math.sin(tilt) * hz;
    const ny = Math.cos(tilt);
    const nz = Math.sin(tilt) * hx;
    return { x: nx, y: ny, z: nz };
  }
  function perpBasis(n) {
    const ref = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    let ux = n.y * ref.z - n.z * ref.y;
    let uy = n.z * ref.x - n.x * ref.z;
    let uz = n.x * ref.y - n.y * ref.x;
    const ulen = Math.hypot(ux, uy, uz) || 1;
    ux /= ulen; uy /= ulen; uz /= ulen;
    const vx = n.y * uz - n.z * uy;
    const vy = n.z * ux - n.x * uz;
    const vz = n.x * uy - n.y * ux;
    return { u: { x: ux, y: uy, z: uz }, v: { x: vx, y: vy, z: vz } };
  }
  for (const p of PLANETS) {
    if (p.rings) {
      p.ringAxis = ringSpinAxis(p.axialTiltDeg, p.axialTiltAzimuthDeg);
      const basis = perpBasis(p.ringAxis);
      p.ringU = basis.u;
      p.ringV = basis.v;
    }
  }

  // ---------------------------------------------------------------------
  // Canvas / DPR
  // ---------------------------------------------------------------------
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const state = { W: 0, H: 0, cx0: 0, cy0: 0, focal: 0 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.W = w; state.H = h;
    state.cx0 = w / 2; state.cy0 = h / 2;
    state.focal = Math.min(w, h) * 0.93;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------------
  // Камера: сферические координаты вокруг Солнца в начале координат.
  // ---------------------------------------------------------------------
  const camera = {
    azimuth: 0.6,
    elevation: deg2rad(26),
    distance: 1050,
  };
  const BASE_DISTANCE = 1050;
  const CAMERA_ROT_SPEED = 0.045; // рад/сек — медленное автовращение
  const IDLE_RESUME_MS = 3200;
  let zoomValue = 1;
  let lastInteraction = -Infinity;

  function computeCameraBasis(cam) {
    const az = cam.azimuth, el = cam.elevation;
    const camPos = {
      x: cam.distance * Math.cos(el) * Math.sin(az),
      y: cam.distance * Math.sin(el),
      z: cam.distance * Math.cos(el) * Math.cos(az),
    };
    let fx = -camPos.x, fy = -camPos.y, fz = -camPos.z;
    const flen = Math.hypot(fx, fy, fz) || 1;
    fx /= flen; fy /= flen; fz /= flen;
    const upRef = { x: 0, y: 1, z: 0 };
    let rx = fy * upRef.z - fz * upRef.y;
    let ry = fz * upRef.x - fx * upRef.z;
    let rz = fx * upRef.y - fy * upRef.x;
    const rlen = Math.hypot(rx, ry, rz) || 1;
    rx /= rlen; ry /= rlen; rz /= rlen;
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;
    return { camPos: camPos, forward: { x: fx, y: fy, z: fz }, right: { x: rx, y: ry, z: rz }, up: { x: ux, y: uy, z: uz } };
  }

  function worldToCamera(p, cam) {
    const rx = p.x - cam.camPos.x, ry = p.y - cam.camPos.y, rz = p.z - cam.camPos.z;
    return {
      x: rx * cam.right.x + ry * cam.right.y + rz * cam.right.z,
      y: rx * cam.up.x + ry * cam.up.y + rz * cam.up.z,
      z: rx * cam.forward.x + ry * cam.forward.y + rz * cam.forward.z,
    };
  }

  const NEAR = 1;
  function projectCam(c, focal, cx0, cy0) {
    const z = Math.max(c.z, NEAR);
    const scale = focal / z;
    return { x: cx0 + c.x * scale, y: cy0 - c.y * scale, scale: scale };
  }

  function rotateDirToCamera(dir, cam) {
    return {
      x: dir.x * cam.right.x + dir.y * cam.right.y + dir.z * cam.right.z,
      y: dir.x * cam.up.x + dir.y * cam.up.y + dir.z * cam.up.z,
      z: dir.x * cam.forward.x + dir.y * cam.forward.y + dir.z * cam.forward.z,
    };
  }

  function computeLightDirCam(worldPos, cam) {
    let lx = -worldPos.x, ly = -worldPos.y, lz = -worldPos.z;
    const len = Math.hypot(lx, ly, lz) || 1;
    lx /= len; ly /= len; lz /= len;
    return rotateDirToCamera({ x: lx, y: ly, z: lz }, cam);
  }

  // ---------------------------------------------------------------------
  // Затенение сферы (день/ночь): непрозрачная «истинная» поверхность рисуется
  // всегда; поверх накладывается тёмный радиальный градиент, чей центр смещён
  // в сторону, противоположную Солнцу, — классическая конструкция двух
  // перекрывающихся окружностей для серпа/гиббозной фазы, но со смягчёнными
  // краями через градиент вместо жёсткой границы.
  // ---------------------------------------------------------------------
  function drawShadedSphere(sx, sy, sr, lightDirCam, drawSurface) {
    if (sr < 0.4) return;
    const len2d = Math.hypot(lightDirCam.x, lightDirCam.y);
    const dirX = len2d > 1e-4 ? lightDirCam.x / len2d : 1;
    const dirY = len2d > 1e-4 ? -lightDirCam.y / len2d : 0;
    const t = clamp((1 - lightDirCam.z) / 2, 0, 1); // 1 = день к камере, 0 = ночь к камере

    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, TWO_PI);
    ctx.clip();

    drawSurface(ctx, sx, sy, sr);

    const offset = 2 * sr * t;
    const dcx = sx - dirX * offset;
    const dcy = sy - dirY * offset;
    const dark = ctx.createRadialGradient(dcx, dcy, Math.max(0.01, sr * 0.05), dcx, dcy, sr * 1.15);
    dark.addColorStop(0, 'rgba(3,5,14,0.94)');
    dark.addColorStop(0.7, 'rgba(3,5,14,0.82)');
    dark.addColorStop(1, 'rgba(3,5,14,0)');
    ctx.fillStyle = dark;
    ctx.fillRect(sx - sr - 2, sy - sr - 2, sr * 2 + 4, sr * 2 + 4);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, TWO_PI);
    ctx.lineWidth = Math.max(0.6, sr * 0.06);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.05 + 0.14 * t).toFixed(3) + ')';
    ctx.stroke();
    ctx.restore();
  }

  function drawSun(sx, sy, sr, time) {
    const pulse = 1 + 0.02 * Math.sin(time * 0.6);
    const r = sr * pulse;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const layers = [
      [r * 3.4, 'rgba(255,180,80,0.05)'],
      [r * 2.3, 'rgba(255,170,60,0.10)'],
      [r * 1.5, 'rgba(255,205,120,0.24)'],
    ];
    for (const layer of layers) {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, layer[0]);
      g.addColorStop(0, layer[1]);
      g.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, layer[0], 0, TWO_PI); ctx.fill();
    }
    ctx.restore();

    const core = ctx.createRadialGradient(sx - r * 0.25, sy - r * 0.25, r * 0.05, sx, sy, r);
    core.addColorStop(0, '#fff6d8');
    core.addColorStop(0.5, '#ffd270');
    core.addColorStop(1, '#ff9d3e');
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, TWO_PI);
    ctx.fillStyle = core; ctx.fill();
  }

  // ---------------------------------------------------------------------
  // Кольца: сэмплируем окружность в плоскости кольца, классифицируем каждую
  // точку "ближе/дальше камеры, чем центр планеты", разбиваем на непрерывные
  // дуги и рисуем их как элементы общего списка глубины (чуть дальше или
  // чуть ближе планеты) — так дальняя дуга уходит за диск планеты, а ближняя
  // ложится поверх.
  // ---------------------------------------------------------------------
  function ringSamplePoints(planetWorld, u, v, radius, cam, count) {
    const pts = [];
    for (let i = 0; i < count; i++) {
      const theta = (TWO_PI * i) / count;
      const c = Math.cos(theta), s = Math.sin(theta);
      const wx = planetWorld.x + radius * (c * u.x + s * v.x);
      const wy = planetWorld.y + radius * (c * u.y + s * v.y);
      const wz = planetWorld.z + radius * (c * u.z + s * v.z);
      pts.push(worldToCamera({ x: wx, y: wy, z: wz }, cam));
    }
    return pts;
  }

  function extractRuns(flags) {
    const n = flags.length;
    let start = 0;
    for (let i = 1; i < n; i++) {
      if (flags[i] !== flags[i - 1]) { start = i; break; }
    }
    const runs = [];
    let curVal = flags[start % n];
    let curRun = [start % n];
    for (let k = 1; k <= n; k++) {
      const idx = (start + k) % n;
      const v = flags[idx % n];
      if (k < n && v === curVal) {
        curRun.push(idx);
      } else {
        if (k === n) curRun.push(idx);
        runs.push({ value: curVal, indices: curRun });
        curVal = v;
        curRun = [idx];
      }
    }
    return runs;
  }

  function buildRingItems(planet, planetWorld, planetCamZ, cam, focal, cx0, cy0) {
    const items = [];
    const SAMPLES = 72;
    const r = planet.rings;
    const bands = [
      { inner: r.innerFactor * planet.visualRadius, outer: r.gapFactor * planet.visualRadius, alpha: r.faint ? 0.16 : 0.5 },
      { inner: r.gapFactor * planet.visualRadius, outer: r.gapFactor * planet.visualRadius * 1.06, alpha: r.faint ? 0.05 : 0.12 },
      { inner: r.gapFactor * planet.visualRadius * 1.06, outer: r.outerFactor * planet.visualRadius, alpha: r.faint ? 0.14 : 0.42 },
    ];
    for (const band of bands) {
      const outerPts = ringSamplePoints(planetWorld, planet.ringU, planet.ringV, band.outer, cam, SAMPLES);
      const innerPts = ringSamplePoints(planetWorld, planet.ringU, planet.ringV, band.inner, cam, SAMPLES);
      const flags = outerPts.map(function (p) { return p.z < planetCamZ; });
      const runs = extractRuns(flags);
      for (const run of runs) {
        const idxs = run.indices;
        if (idxs.length < 2) continue;
        const isFront = run.value;
        const depth = isFront ? planetCamZ - 0.01 : planetCamZ + 0.01;
        items.push({
          depth: depth,
          draw: (function (idxsCopy, alpha, color) {
            return function () {
              ctx.beginPath();
              let started = false;
              for (let i = 0; i < idxsCopy.length; i++) {
                const p = projectCam(outerPts[idxsCopy[i]], focal, cx0, cy0);
                if (!started) { ctx.moveTo(p.x, p.y); started = true; } else { ctx.lineTo(p.x, p.y); }
              }
              for (let i = idxsCopy.length - 1; i >= 0; i--) {
                const p = projectCam(innerPts[idxsCopy[i]], focal, cx0, cy0);
                ctx.lineTo(p.x, p.y);
              }
              ctx.closePath();
              ctx.fillStyle = color;
              ctx.globalAlpha = alpha;
              ctx.fill();
              ctx.globalAlpha = 1;
            };
          })(idxs, band.alpha, r.color),
        });
      }
    }
    return items;
  }

  // ---------------------------------------------------------------------
  // Ввод: перетаскивание вращает камеру, колесо — масштаб, ползунки и кнопки.
  // ---------------------------------------------------------------------
  let paused = false;
  let showTrails = true;
  let showLabels = true;
  let showBelt = true;
  let dragging = false;
  let dragLastX = 0, dragLastY = 0;
  let speedExponent = 0;

  const btnPause = document.getElementById('btn-pause');
  const btnTrails = document.getElementById('btn-trails');
  const btnLabels = document.getElementById('btn-labels');
  const btnBelt = document.getElementById('btn-belt');
  const btnReset = document.getElementById('btn-reset');
  const spSpeed = document.getElementById('sp-speed');
  const spZoom = document.getElementById('sp-zoom');
  const spTilt = document.getElementById('sp-tilt');

  function applyZoom(v) {
    zoomValue = clamp(v, 0.4, 2.2);
    camera.distance = BASE_DISTANCE / zoomValue;
  }
  applyZoom(parseFloat(spZoom.value));
  speedExponent = parseFloat(spSpeed.value);
  camera.elevation = deg2rad(parseFloat(spTilt.value));

  btnPause.addEventListener('click', function () {
    paused = !paused;
    btnPause.textContent = paused ? '▶ Играть' : '⏸ Пауза';
  });
  btnTrails.addEventListener('click', function () {
    showTrails = !showTrails;
    btnTrails.setAttribute('aria-pressed', String(showTrails));
  });
  btnLabels.addEventListener('click', function () {
    showLabels = !showLabels;
    btnLabels.setAttribute('aria-pressed', String(showLabels));
  });
  btnBelt.addEventListener('click', function () {
    showBelt = !showBelt;
    btnBelt.setAttribute('aria-pressed', String(showBelt));
  });
  btnReset.addEventListener('click', function () {
    camera.azimuth = 0.6;
    spTilt.value = '26';
    camera.elevation = deg2rad(26);
    spZoom.value = '1';
    applyZoom(1);
    lastInteraction = -Infinity;
  });
  spSpeed.addEventListener('input', function () { speedExponent = parseFloat(spSpeed.value); });
  spZoom.addEventListener('input', function () { applyZoom(parseFloat(spZoom.value)); });
  spTilt.addEventListener('input', function () {
    camera.elevation = deg2rad(parseFloat(spTilt.value));
    lastInteraction = performance.now();
  });

  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    dragLastX = e.clientX; dragLastY = e.clientY;
    document.body.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
    lastInteraction = performance.now();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    const dx = e.clientX - dragLastX;
    const dy = e.clientY - dragLastY;
    dragLastX = e.clientX; dragLastY = e.clientY;
    camera.azimuth -= dx * 0.0055;
    camera.elevation = clamp(camera.elevation - dy * 0.0055, deg2rad(4), deg2rad(80));
    spTilt.value = String(Math.round(rad2deg(camera.elevation)));
    lastInteraction = performance.now();
  });
  function endDrag() {
    dragging = false;
    document.body.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    applyZoom(zoomValue * (e.deltaY < 0 ? 1.09 : 0.92));
    spZoom.value = zoomValue.toFixed(2);
  }, { passive: false });

  // ---------------------------------------------------------------------
  // Симуляция и рендер
  // ---------------------------------------------------------------------
  let simTime = 0;
  const TRAIL_SAMPLE_DT = 0.05;

  function recordTrailSample(body, pos) {
    const trail = body.trail;
    const last = trail.length ? trail[trail.length - 1] : null;
    if (!last || (simTime - last.t) > TRAIL_SAMPLE_DT) {
      trail.push({ x: pos.x, y: pos.y, z: pos.z, t: simTime });
    }
    while (trail.length > 2 && (simTime - trail[0].t) > body.trailMaxAge) trail.shift();
  }

  function update(dt) {
    if (!dragging && (performance.now() - lastInteraction) > IDLE_RESUME_MS) {
      camera.azimuth += dt * CAMERA_ROT_SPEED;
    }
    if (!paused) {
      const speed = Math.pow(2, speedExponent);
      simTime += dt * speed;
      for (const planet of PLANETS) {
        const pos = Orbits.orbitPosition(planet.orbitParams, simTime);
        recordTrailSample(planet, pos);
      }
    }
  }

  function drawBackground(cam) {
    const W = state.W, H = state.H;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, W, H);
    const vg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(22,28,46,0)');
    vg.addColorStop(1, 'rgba(2,3,8,0.68)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    for (const st of stars) {
      const camP = worldToCamera(st, cam);
      if (camP.z < 1) continue;
      const proj = projectCam(camP, state.focal, state.cx0, state.cy0);
      if (proj.x < -4 || proj.x > W + 4 || proj.y < -4 || proj.y > H + 4) continue;
      const tw = 0.7 + 0.3 * Math.sin(simTime * st.twinkleSpeed + st.twinklePhase);
      ctx.globalAlpha = clamp(st.baseAlpha * tw, 0, 1);
      ctx.fillStyle = st.warm ? '#ffe3b0' : '#dfe9ff';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, st.size, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawOrbitGuides(cam) {
    ctx.save();
    ctx.lineWidth = 1;
    for (const planet of PLANETS) {
      ctx.strokeStyle = planet.trailColor;
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      let started = false;
      for (const gp of planet.guidePoints) {
        const camP = worldToCamera(gp, cam);
        if (camP.z < NEAR) { started = false; continue; }
        const proj = projectCam(camP, state.focal, state.cx0, state.cy0);
        if (!started) { ctx.moveTo(proj.x, proj.y); started = true; } else { ctx.lineTo(proj.x, proj.y); }
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawBelt(cam) {
    if (!showBelt) return;
    const W = state.W, H = state.H;
    for (const ast of asteroids) {
      const pos = Orbits.orbitPosition(ast.orbitParams, simTime);
      const camP = worldToCamera(pos, cam);
      if (camP.z < NEAR) continue;
      const proj = projectCam(camP, state.focal, state.cx0, state.cy0);
      if (proj.x < -20 || proj.x > W + 20 || proj.y < -20 || proj.y > H + 20) continue;
      const r = Math.max(0.35, ast.visualRadius * proj.scale);
      ctx.globalAlpha = ast.alpha;
      ctx.fillStyle = ast.color;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawTrails(cam) {
    if (!showTrails) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (const planet of PLANETS) {
      const trail = planet.trail;
      ctx.strokeStyle = planet.trailColor;
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1], b = trail[i];
        const age = simTime - b.t;
        const alpha = clamp(1 - age / planet.trailMaxAge, 0, 1) * 0.55;
        if (alpha <= 0.01) continue;
        const ca = worldToCamera(a, cam), cb = worldToCamera(b, cam);
        if (ca.z < NEAR || cb.z < NEAR) continue;
        const pa = projectCam(ca, state.focal, state.cx0, state.cy0);
        const pb = projectCam(cb, state.focal, state.cx0, state.cy0);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawLabels(labelData) {
    if (!showLabels) return;
    ctx.save();
    ctx.font = '600 12px -apple-system, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = 'rgba(232,239,250,0.88)';
    for (const l of labelData) {
      if (!l.visible) continue;
      ctx.fillText(l.name, l.x, l.y - l.sr - 6);
    }
    ctx.restore();
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!frame._last) frame._last = ts;
    let dt = (ts - frame._last) / 1000;
    frame._last = ts;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;

    update(dt);

    const cam = computeCameraBasis(camera);
    const focal = state.focal, cx0 = state.cx0, cy0 = state.cy0;

    drawBackground(cam);
    drawOrbitGuides(cam);
    drawBelt(cam);
    drawTrails(cam);

    const items = [];
    const sunCam = worldToCamera({ x: 0, y: 0, z: 0 }, cam);
    items.push({
      depth: sunCam.z,
      draw: (function () {
        const proj = projectCam(sunCam, focal, cx0, cy0);
        const sr = Math.max(1, SUN_VISUAL_R * proj.scale);
        return function () { drawSun(proj.x, proj.y, sr, simTime); };
      })(),
    });

    const labelData = [];

    for (const planet of PLANETS) {
      const pos = Orbits.orbitPosition(planet.orbitParams, simTime);
      const camP = worldToCamera(pos, cam);
      const proj = projectCam(camP, focal, cx0, cy0);
      const sr = Math.max(0.6, planet.visualRadius * proj.scale);
      const lightDir = computeLightDirCam(pos, cam);

      items.push({
        depth: camP.z,
        draw: (function (px, py, psr, ldir, surf) {
          return function () { drawShadedSphere(px, py, psr, ldir, surf); };
        })(proj.x, proj.y, sr, lightDir, planet.drawSurface),
      });

      labelData.push({ name: planet.name, x: proj.x, y: proj.y, sr: sr, visible: camP.z > NEAR });

      if (planet.rings) {
        const ringItems = buildRingItems(planet, pos, camP.z, cam, focal, cx0, cy0);
        for (const ri of ringItems) items.push(ri);
      }

      for (const moon of planet.moons) {
        const moonLocal = Orbits.orbitPosition(moon.orbitParams, simTime);
        const moonWorld = { x: pos.x + moonLocal.x, y: pos.y + moonLocal.y, z: pos.z + moonLocal.z };
        const moonCam = worldToCamera(moonWorld, cam);
        if (moonCam.z < NEAR) continue;
        const moonProj = projectCam(moonCam, focal, cx0, cy0);
        const moonSr = Math.max(0.45, moon.visualRadius * moonProj.scale);
        const moonLight = computeLightDirCam(moonWorld, cam);
        const moonColor = moon.color;
        items.push({
          depth: moonCam.z,
          draw: (function (px, py, psr, ldir, color) {
            return function () {
              drawShadedSphere(px, py, psr, ldir, function (c, sx, sy, sr2) {
                c.fillStyle = color;
                c.fillRect(sx - sr2 - 1, sy - sr2 - 1, sr2 * 2 + 2, sr2 * 2 + 2);
              });
            };
          })(moonProj.x, moonProj.y, moonSr, moonLight, moonColor),
        });
      }
    }

    items.sort(function (a, b) { return b.depth - a.depth; });
    for (const it of items) it.draw();

    drawLabels(labelData);
  }

  requestAnimationFrame(frame);
})();
