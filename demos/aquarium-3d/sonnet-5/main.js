'use strict';
(function () {
  var R = window.Render3D;

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');

  // ---- константы мира --------------------------------------------------
  var WORLD_UP = { x: 0, y: 1, z: 0 };
  var TANK = { halfX: 230, halfY: 140, halfZ: 170, top: 140, bottom: -140 };
  var FOV_Y = 52 * Math.PI / 180;
  var LIGHT_DIR = R.normalize({ x: 0.25, y: 1, z: -0.15 });
  var FOG_NEAR = 420, FOG_FAR = 1050, FOG_MAX = 0.8;
  var SAND_DARK = { r: 62, g: 52, b: 34 };
  var SAND_LIGHT = { r: 176, g: 156, b: 108 };
  var PLANT_DARK = { r: 12, g: 46, b: 40 };
  var PLANT_LIGHT = { r: 60, g: 150, b: 110 };
  var FOG_DEEP = { r: 4, g: 14, b: 22 };
  var FOG_SURFACE = { r: 70, g: 150, b: 165 };

  // ---- утилиты ------------------------------------------------------------
  function randRange(a, b) { return a + Math.random() * (b - a); }

  function randomPointInTank(marginXZ, yRange) {
    var m = marginXZ == null ? 60 : marginXZ;
    var yr = yRange || [TANK.bottom + 40, TANK.top - 40];
    return {
      x: randRange(-TANK.halfX + m, TANK.halfX - m),
      y: randRange(yr[0], yr[1]),
      z: randRange(-TANK.halfZ + m, TANK.halfZ - m),
    };
  }

  function lerpColor(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
  }
  function colorToRGBA(c, a) {
    return 'rgba(' + (c.r | 0) + ',' + (c.g | 0) + ',' + (c.b | 0) + ',' + a + ')';
  }
  function fogColorForY(y) {
    var tN = R.clamp((y - TANK.bottom) / (TANK.top - TANK.bottom), 0, 1);
    return lerpColor(FOG_DEEP, FOG_SURFACE, tN);
  }

  function spindle(s, peak, headPow, tailPow) {
    var p = R.clamp(peak, 0.03, 0.97);
    if (s <= p) {
      var t1 = s / p;
      return Math.pow(Math.sin(t1 * Math.PI / 2), headPow);
    }
    var t2 = (s - p) / (1 - p);
    return Math.pow(Math.cos(t2 * Math.PI / 2), tailPow);
  }
  function profileValue(s, prof) { return prof.scale * spindle(s, prof.peak, prof.headPow, prof.tailPow); }

  function rotVec(v, axis, angle) {
    var c = Math.cos(angle), s = Math.sin(angle);
    var cr = R.cross(axis, v);
    var da = R.dot(axis, v);
    return {
      x: v.x * c + cr.x * s + axis.x * da * (1 - c),
      y: v.y * c + cr.y * s + axis.y * da * (1 - c),
      z: v.z * c + cr.z * s + axis.z * da * (1 - c),
    };
  }

  // Поворачивает вектор a к вектору b не более чем на maxAngle (радианы).
  function rotateTowards(a, b, maxAngle) {
    var d = R.clamp(R.dot(a, b), -1, 1);
    var angle = Math.acos(d);
    if (angle < 1e-6) return a;
    var step = Math.min(maxAngle, angle);
    var c = R.sub(b, R.scale(a, d));
    var cLen = R.length(c);
    if (cLen < 1e-6) {
      var arb = Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
      c = R.sub(arb, R.scale(a, R.dot(a, arb)));
      cLen = R.length(c);
    }
    c = R.scale(c, 1 / cLen);
    var rotated = R.add(R.scale(a, Math.cos(step)), R.scale(c, Math.sin(step)));
    return R.normalize(rotated);
  }

  function caustic(x, z, t) {
    var a = Math.sin(x * 0.045 + t * 0.6) * Math.cos(z * 0.05 - t * 0.5);
    var b = Math.sin((x + z) * 0.03 - t * 0.9);
    var c = Math.cos(x * 0.07 - z * 0.06 + t * 1.1);
    var v = a * 0.5 + b * 0.3 + c * 0.2;
    return Math.pow(R.clamp(v * 0.5 + 0.5, 0, 1), 1.6);
  }

  // ---- окраска рыбы (базовый цвет + видовой узор: неоновая полоса /
  // вертикальные полосы скалярии / рябь сома камуфляжа) ------------------
  function speciesColorAt(spec, s, vFactor) {
    var base = lerpColor(spec.colorBelly, spec.colorTop, vFactor);
    base = lerpColor(base, spec.colorSide, 0.3);
    var st = spec.stripe;
    if (st) {
      if (st.mode === 'neon' && s >= st.sStart && s <= st.sEnd && vFactor > 0.3 && vFactor < 0.8) {
        var edge = R.clamp(Math.min((s - st.sStart) / 0.06, (st.sEnd - s) / 0.06, 1), 0, 1);
        base = lerpColor(base, st.colorTop, edge * 0.85);
      } else if (st.mode === 'bands') {
        var bandVal = Math.abs(Math.sin(s * st.bands * Math.PI));
        if (bandVal > 0.7) base = lerpColor(base, st.colorTop, (bandVal - 0.7) / 0.3 * 0.75);
      } else if (st.mottle) {
        var n = Math.sin(s * 17.3 + vFactor * 5.1) * Math.cos(s * 9.1 + 2.3);
        base = lerpColor(base, spec.colorTop, R.clamp(n * 0.5 + 0.5, 0, 1) * 0.4);
      }
    }
    return base;
  }

  // ---- viewport / камера: разделяемое состояние -------------------------
  var viewportRef = { width: 0, height: 0, focal: 0 };
  var bgGradient = null, vignetteGradient = null;
  var ORBIT_SPEED = (2 * Math.PI) / 150;
  var camDist = 660;
  var dragYaw = 0.5, dragPitch = 0;
  var dragging = false, lastPX = 0, lastPY = 0;
  var paused = false;
  var speedMultiplier = 1;
  var camSpeedMultiplier = 1;

  // ---- проекция и заливка примитивов сцены -------------------------------
  // Общая точка входа для любого плоского многоугольника мировой сцены:
  // считает нормаль (честно ориентированную "наружу" через outwardHint или
  // камеру), направленное освещение + туман по глубине/высоте, проецирует
  // все вершины и кладёт готовый экранный примитив в общий список отрисовки.
  function shadeAndPush(list, camera, worldPts, baseColor, opts) {
    opts = opts || {};
    var camPts = new Array(worldPts.length);
    var allBehind = true;
    for (var i = 0; i < worldPts.length; i++) {
      camPts[i] = R.worldToCamera(worldPts[i], camera.position, camera.basis);
      if (camPts[i].z > 1e-3) allBehind = false;
    }
    if (allBehind) return;

    var center = { x: 0, y: 0, z: 0 };
    for (i = 0; i < worldPts.length; i++) {
      center.x += worldPts[i].x; center.y += worldPts[i].y; center.z += worldPts[i].z;
    }
    center.x /= worldPts.length; center.y /= worldPts.length; center.z /= worldPts.length;

    var avgDepth = 0;
    for (i = 0; i < camPts.length; i++) avgDepth += camPts[i].z;
    avgDepth /= camPts.length;

    var normal = R.normalize(R.cross(
      R.sub(worldPts[1], worldPts[0]),
      R.sub(worldPts[worldPts.length - 1], worldPts[0])
    ));
    if (opts.outwardHint) {
      if (R.dot(normal, R.sub(center, opts.outwardHint)) < 0) normal = R.scale(normal, -1);
    } else {
      if (R.dot(normal, R.sub(camera.position, center)) < 0) normal = R.scale(normal, -1);
    }

    if (opts.cullBackface) {
      var viewDir = R.normalize(R.sub(camera.position, center));
      if (R.dot(normal, viewDir) <= 0) return;
    }

    var brightness;
    if (opts.doubleSided) {
      brightness = 0.5 + 0.5 * Math.abs(R.dot(normal, LIGHT_DIR));
    } else {
      brightness = 0.32 + 0.85 * R.clamp(R.dot(normal, LIGHT_DIR), 0, 1);
    }
    var color = { r: baseColor.r * brightness, g: baseColor.g * brightness, b: baseColor.b * brightness };
    var fogAmt = R.clamp((avgDepth - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1) * FOG_MAX;
    color = lerpColor(color, fogColorForY(center.y), fogAmt);

    var screenPts = new Array(camPts.length);
    for (i = 0; i < camPts.length; i++) {
      var pr = R.project(camPts[i], viewportRef.focal, viewportRef.width, viewportRef.height);
      if (pr.behind) return;
      screenPts[i] = { x: pr.x, y: pr.y };
    }

    list.push({
      pts: screenPts,
      depth: avgDepth,
      fill: colorToRGBA(color, opts.alpha == null ? 1 : opts.alpha),
      composite: opts.composite || 'source-over',
    });
  }

  function pushCircle(list, camera, worldPos, radiusWorld, fillStr) {
    var cp = R.worldToCamera(worldPos, camera.position, camera.basis);
    if (cp.z <= 1e-3) return;
    var pr = R.project(cp, viewportRef.focal, viewportRef.width, viewportRef.height);
    if (pr.behind) return;
    list.push({ type: 'circle', x: pr.x, y: pr.y, r: Math.max(0.5, radiusWorld * pr.scale), depth: cp.z, fill: fillStr });
  }

  function pushLine(list, camera, worldPts, strokeStr, lineWidth) {
    var camPts = worldPts.map(function (p) { return R.worldToCamera(p, camera.position, camera.basis); });
    for (var i = 0; i < camPts.length; i++) if (camPts[i].z <= 1e-3) return;
    var screenPts = [];
    for (i = 0; i < camPts.length; i++) {
      var pr = R.project(camPts[i], viewportRef.focal, viewportRef.width, viewportRef.height);
      if (pr.behind) return;
      screenPts.push({ x: pr.x, y: pr.y });
    }
    var avgDepth = 0;
    for (i = 0; i < camPts.length; i++) avgDepth += camPts[i].z;
    avgDepth /= camPts.length;
    list.push({ type: 'line', pts: screenPts, depth: avgDepth, stroke: strokeStr, lineWidth: lineWidth });
  }

  // ---- виды рыб -----------------------------------------------------------
  // Профили ширины/спинного/брюшного гребня — функция spindle(s, peak, headPow,
  // tailPow) даёт форму 0→1→0 вдоль тела (s=0 нос, s=1 кончик хвоста), scale —
  // множитель в долях длины рыбы.
  var SPECIES = [
    {
      key: 'tetra', title: 'тетра', count: 10, segments: 6,
      length: [26, 34],
      widthProfile: { peak: 0.32, headPow: 0.7, tailPow: 1.3, scale: 0.10 },
      dorsalProfile: { peak: 0.30, headPow: 0.8, tailPow: 1.4, scale: 0.13 },
      ventralProfile: { peak: 0.35, headPow: 0.8, tailPow: 1.3, scale: 0.09 },
      colorTop: { r: 55, g: 125, b: 190 }, colorSide: { r: 95, g: 175, b: 215 }, colorBelly: { r: 215, g: 228, b: 232 },
      stripe: { mode: 'neon', colorTop: { r: 255, g: 90, b: 60 }, sStart: 0.25, sEnd: 0.78 },
      finColor: { r: 205, g: 225, b: 232, a: 0.5 },
      speed: [55, 85], maxTurnRate: 3.2, waveAmp: 0.05, waveK: 5.5, waveFreqBase: 2.6, tailBeatFreqBase: 7, pecFreqBase: 5,
      schooling: true, schoolRadius: 75,
      tail: { length: 0.55, lobeHeight: 0.5, swingAmp: 0.5 },
      dorsalFin: { sStart: 0.35, sEnd: 0.65, height: 0.12 },
      pectoral: { sPos: 0.18, length: 0.35, flapAmp: 0.5, restAngle: 0.3 },
    },
    {
      key: 'angel', title: 'скалярия', count: 3, segments: 8,
      length: [70, 85],
      widthProfile: { peak: 0.28, headPow: 0.6, tailPow: 1.2, scale: 0.05 },
      dorsalProfile: { peak: 0.25, headPow: 0.5, tailPow: 1.0, scale: 0.42 },
      ventralProfile: { peak: 0.35, headPow: 0.6, tailPow: 1.1, scale: 0.30 },
      colorTop: { r: 205, g: 185, b: 145 }, colorSide: { r: 222, g: 202, b: 162 }, colorBelly: { r: 235, g: 222, b: 195 },
      stripe: { mode: 'bands', bands: 4, colorTop: { r: 45, g: 42, b: 48 } },
      finColor: { r: 228, g: 208, b: 172, a: 0.45 },
      speed: [18, 28], maxTurnRate: 1.6, waveAmp: 0.035, waveK: 4.0, waveFreqBase: 1.1, tailBeatFreqBase: 2.6, pecFreqBase: 2,
      schooling: false,
      tail: { length: 0.5, lobeHeight: 0.9, swingAmp: 0.28 },
      dorsalFin: { sStart: 0.15, sEnd: 0.55, height: 0.55 },
      analFin: { sStart: 0.5, sEnd: 0.85, height: 0.4 },
      pectoral: { sPos: 0.2, length: 0.3, flapAmp: 0.3, restAngle: 0.2 },
    },
    {
      key: 'barbus', title: 'барбус', count: 4, segments: 6,
      length: [42, 52],
      widthProfile: { peak: 0.34, headPow: 0.7, tailPow: 1.2, scale: 0.09 },
      dorsalProfile: { peak: 0.30, headPow: 0.7, tailPow: 1.2, scale: 0.16 },
      ventralProfile: { peak: 0.38, headPow: 0.7, tailPow: 1.2, scale: 0.11 },
      colorTop: { r: 215, g: 85, b: 35 }, colorSide: { r: 232, g: 118, b: 48 }, colorBelly: { r: 244, g: 188, b: 118 },
      stripe: null,
      finColor: { r: 248, g: 158, b: 68, a: 0.55 },
      speed: [40, 60], maxTurnRate: 2.4, waveAmp: 0.055, waveK: 5.0, waveFreqBase: 2.0, tailBeatFreqBase: 5, pecFreqBase: 4,
      schooling: false,
      tail: { length: 0.6, lobeHeight: 0.55, swingAmp: 0.45 },
      dorsalFin: { sStart: 0.32, sEnd: 0.6, height: 0.18 },
      pectoral: { sPos: 0.2, length: 0.35, flapAmp: 0.4, restAngle: 0.25 },
    },
    {
      key: 'catfish', title: 'сомик', count: 2, segments: 6,
      length: [55, 65],
      widthProfile: { peak: 0.40, headPow: 0.5, tailPow: 1.4, scale: 0.13 },
      dorsalProfile: { peak: 0.35, headPow: 0.6, tailPow: 1.3, scale: 0.10 },
      ventralProfile: { peak: 0.45, headPow: 0.4, tailPow: 1.5, scale: 0.16 },
      colorTop: { r: 66, g: 60, b: 50 }, colorSide: { r: 92, g: 84, b: 68 }, colorBelly: { r: 146, g: 136, b: 116 },
      stripe: { mottle: true },
      finColor: { r: 118, g: 108, b: 92, a: 0.45 },
      speed: [12, 20], maxTurnRate: 1.4, waveAmp: 0.04, waveK: 4.2, waveFreqBase: 1.0, tailBeatFreqBase: 2.2, pecFreqBase: 1.6,
      schooling: false, bottomDweller: true, barbels: true,
      tail: { length: 0.45, lobeHeight: 0.4, swingAmp: 0.3 },
      dorsalFin: { sStart: 0.3, sEnd: 0.5, height: 0.14 },
      pectoral: { sPos: 0.22, length: 0.3, flapAmp: 0.25, restAngle: 0.35 },
    },
  ];

  var allFish = [];
  var schoolAnchors = {};

  function spawnFish(spec) {
    var yRange = spec.bottomDweller ? [TANK.bottom + 25, TANK.bottom + 90] : undefined;
    return {
      spec: spec,
      pos: randomPointInTank(70, yRange),
      heading: R.normalize({ x: randRange(-1, 1), y: randRange(-0.2, 0.2), z: randRange(-1, 1) }),
      length: randRange(spec.length[0], spec.length[1]),
      speed: randRange(spec.speed[0], spec.speed[1]),
      speedPhase: Math.random() * Math.PI * 2,
      bodyPhase: Math.random() * Math.PI * 2,
      tailPhase: Math.random() * Math.PI * 2,
      pecPhase: Math.random() * Math.PI * 2,
      bank: 0,
      waypoint: spec.schooling ? null : randomPointInTank(70, yRange),
      waypointTimer: randRange(4, 9),
    };
  }

  function updateFish(fish, dt, t) {
    var spec = fish.spec;
    var target;
    if (spec.schooling) {
      target = schoolAnchors[spec.key].pos;
    } else {
      fish.waypointTimer -= dt;
      var dTo = R.length(R.sub(fish.waypoint, fish.pos));
      if (dTo < 45 || fish.waypointTimer <= 0) {
        var yRange = spec.bottomDweller ? [TANK.bottom + 25, TANK.bottom + 90] : undefined;
        fish.waypoint = randomPointInTank(70, yRange);
        fish.waypointTimer = randRange(5, 11);
      }
      target = fish.waypoint;
    }

    var desired = R.scale(R.normalize(R.sub(target, fish.pos)), spec.schooling ? 0.55 : 1.0);

    if (spec.schooling) {
      var align = { x: 0, y: 0, z: 0 }, cohesSum = { x: 0, y: 0, z: 0 }, sep = { x: 0, y: 0, z: 0 }, n = 0;
      for (var i = 0; i < allFish.length; i++) {
        var other = allFish[i];
        if (other === fish || other.spec !== spec) continue;
        var d = R.sub(other.pos, fish.pos);
        var dist = R.length(d);
        if (dist > 0.001 && dist < spec.schoolRadius) {
          align = R.add(align, other.heading);
          cohesSum = R.add(cohesSum, other.pos);
          if (dist < spec.schoolRadius * 0.4) {
            sep = R.add(sep, R.scale(R.normalize(d), -(spec.schoolRadius * 0.4 - dist) / (spec.schoolRadius * 0.4)));
          }
          n++;
        }
      }
      if (n > 0) {
        var alignN = R.normalize(align);
        var cohesCenter = R.scale(cohesSum, 1 / n);
        var toCohes = R.normalize(R.sub(cohesCenter, fish.pos));
        desired = R.add(desired, R.scale(alignN, 0.9));
        desired = R.add(desired, R.scale(toCohes, 0.5));
        desired = R.add(desired, R.scale(sep, 1.6));
      }
    }

    // мягкое избегание стеклянных стенок объёма — разворот заранее, а не отскок
    var margin = 46;
    var push = { x: 0, y: 0, z: 0 };
    if (fish.pos.x > TANK.halfX - margin) push.x -= (fish.pos.x - (TANK.halfX - margin)) / margin;
    if (fish.pos.x < -TANK.halfX + margin) push.x += (-TANK.halfX + margin - fish.pos.x) / margin;
    if (fish.pos.y > TANK.top - margin * 0.8) push.y -= (fish.pos.y - (TANK.top - margin * 0.8)) / (margin * 0.8);
    if (fish.pos.y < TANK.bottom + margin * 0.8) push.y += (TANK.bottom + margin * 0.8 - fish.pos.y) / (margin * 0.8);
    if (fish.pos.z > TANK.halfZ - margin) push.z -= (fish.pos.z - (TANK.halfZ - margin)) / margin;
    if (fish.pos.z < -TANK.halfZ + margin) push.z += (-TANK.halfZ + margin - fish.pos.z) / margin;
    desired = R.add(desired, R.scale(push, 2.4));

    var desiredDir = R.length(desired) > 1e-6 ? R.normalize(desired) : fish.heading;
    var prevHeading = fish.heading;
    fish.heading = rotateTowards(fish.heading, desiredDir, spec.maxTurnRate * dt);

    var turnVec = R.cross(prevHeading, fish.heading);
    var desiredBank = R.clamp(-turnVec.y * 9, -0.9, 0.9);
    fish.bank += (desiredBank - fish.bank) * Math.min(1, dt * 6);

    var speedNow = fish.speed * (1 + 0.15 * Math.sin(t * 1.3 + fish.speedPhase));
    fish.pos = R.add(fish.pos, R.scale(fish.heading, speedNow * dt));
    fish.pos.x = R.clamp(fish.pos.x, -TANK.halfX + 6, TANK.halfX - 6);
    fish.pos.y = R.clamp(fish.pos.y, TANK.bottom + 6, TANK.top - 6);
    fish.pos.z = R.clamp(fish.pos.z, -TANK.halfZ + 6, TANK.halfZ - 6);

    fish.bodyPhase += dt * (spec.waveFreqBase + speedNow * 0.03);
    fish.tailPhase += dt * (spec.tailBeatFreqBase + speedNow * 0.06);
    fish.pecPhase += dt * spec.pecFreqBase;
  }

  // Строит "трубчатое" тело рыбы: кольца из 4 рёбер (верх/право/низ/лево)
  // вдоль изгибающегося по синусоиде хребта, кладёт затенённые квады в list.
  // Честная 3D-геометрия: при развороте рыбы к камере/от камеры хребтовые
  // точки проецируются ближе друг к другу — корпус укорачивается сам собой.
  function buildFishBodyPrimitives(fish, t, camera, list) {
    var spec = fish.spec;
    var basis = R.basisFromForward(fish.heading, WORLD_UP);
    var cosB = Math.cos(fish.bank), sinB = Math.sin(fish.bank);
    var right2 = R.add(R.scale(basis.right, cosB), R.scale(basis.up, sinB));
    var up2 = R.add(R.scale(basis.right, -sinB), R.scale(basis.up, cosB));
    var forward = basis.forward;
    var segs = spec.segments;
    var ribs = [];
    for (var i = 0; i < segs; i++) {
      var s = i / (segs - 1);
      var localFwd = (0.5 - s) * fish.length;
      var envelope = spec.waveAmp * s * s * fish.length;
      var lateral = envelope * Math.sin(spec.waveK * s - fish.bodyPhase);
      var spine = R.add(fish.pos, R.add(R.scale(forward, localFwd), R.scale(right2, lateral)));
      var halfW = profileValue(s, spec.widthProfile) * fish.length;
      var dorsalH = profileValue(s, spec.dorsalProfile) * fish.length;
      var ventralH = profileValue(s, spec.ventralProfile) * fish.length;
      ribs.push({
        s: s, spine: spine,
        top: R.add(spine, R.scale(up2, dorsalH)),
        bottom: R.add(spine, R.scale(up2, -ventralH)),
        right: R.add(spine, R.scale(right2, halfW)),
        left: R.add(spine, R.scale(right2, -halfW)),
      });
    }
    var zoneNames = ['top', 'right', 'bottom', 'left'];
    var zoneV = [0.85, 0.35, 0.15, 0.65];
    for (i = 0; i < segs - 1; i++) {
      var r0 = ribs[i], r1 = ribs[i + 1];
      var mid = R.lerpVec(r0.spine, r1.spine, 0.5);
      var sMid = (r0.s + r1.s) / 2;
      for (var k = 0; k < 4; k++) {
        var an = zoneNames[k], bn = zoneNames[(k + 1) % 4];
        var baseColor = speciesColorAt(spec, sMid, zoneV[k]);
        shadeAndPush(list, camera, [r0[an], r0[bn], r1[bn], r1[an]], baseColor, { cullBackface: true, outwardHint: mid });
      }
    }
    return { ribs: ribs, basis: basis, right2: right2, up2: up2, forward: forward };
  }

  // Плавники: хвост (2 треугольника с боковым взмахом), спинной/анальный
  // гребень (лента вдоль профильных сегментов), парные грудные (взмах),
  // усики сома (тонкие линии), глаза (кружки).
  function buildFins(list, camera, fish, frameData, t) {
    var spec = fish.spec;
    var ribs = frameData.ribs, forward = frameData.forward, right2 = frameData.right2, up2 = frameData.up2;
    var last = ribs.length - 1;
    var finColor = spec.finColor;

    var swing = spec.tail.swingAmp * Math.sin(fish.tailPhase);
    var tailDir = rotVec(R.scale(forward, -1), up2, swing);
    var tailLen = spec.tail.length * fish.length;
    var tip = R.add(ribs[last].spine, R.scale(tailDir, tailLen));
    var lobe = spec.tail.lobeHeight * fish.length * 0.5;
    var tipUpper = R.add(tip, R.scale(up2, lobe));
    var tipLower = R.add(tip, R.scale(up2, -lobe));
    shadeAndPush(list, camera, [ribs[last].top, tipUpper, tip], finColor, { doubleSided: true, alpha: finColor.a });
    shadeAndPush(list, camera, [tip, tipLower, ribs[last].bottom], finColor, { doubleSided: true, alpha: finColor.a });

    if (spec.dorsalFin) {
      var df = spec.dorsalFin, prevTip = null, prevRib = null;
      for (var i = 0; i < ribs.length; i++) {
        var rib = ribs[i];
        if (rib.s < df.sStart || rib.s > df.sEnd) { prevTip = null; prevRib = null; continue; }
        var hump = Math.sin(Math.PI * (rib.s - df.sStart) / (df.sEnd - df.sStart));
        var extra = df.height * fish.length * hump;
        var finTip = R.add(rib.top, R.scale(up2, extra));
        if (prevTip) {
          shadeAndPush(list, camera, [prevRib.top, prevTip, finTip, rib.top], finColor, { doubleSided: true, alpha: finColor.a });
        }
        prevTip = finTip; prevRib = rib;
      }
    }

    if (spec.analFin) {
      var af = spec.analFin, prevTipA = null, prevRibA = null;
      for (var j = 0; j < ribs.length; j++) {
        var ribA = ribs[j];
        if (ribA.s < af.sStart || ribA.s > af.sEnd) { prevTipA = null; prevRibA = null; continue; }
        var humpA = Math.sin(Math.PI * (ribA.s - af.sStart) / (af.sEnd - af.sStart));
        var extraA = af.height * fish.length * humpA;
        var finTipA = R.add(ribA.bottom, R.scale(up2, -extraA));
        if (prevTipA) {
          shadeAndPush(list, camera, [prevRibA.bottom, ribA.bottom, finTipA, prevTipA], finColor, { doubleSided: true, alpha: finColor.a });
        }
        prevTipA = finTipA; prevRibA = ribA;
      }
    }

    if (spec.pectoral) {
      var pc = spec.pectoral;
      var ribAt = ribs[0];
      for (var m = 0; m < ribs.length; m++) if (Math.abs(ribs[m].s - pc.sPos) < Math.abs(ribAt.s - pc.sPos)) ribAt = ribs[m];
      var flap = pc.restAngle + pc.flapAmp * Math.sin(fish.pecPhase);
      [1, -1].forEach(function (side) {
        var base = side > 0 ? ribAt.right : ribAt.left;
        var dir = R.normalize(R.add(R.scale(right2, side * 0.85), R.add(R.scale(forward, -0.35), R.scale(up2, -0.3))));
        dir = rotVec(dir, forward, side * flap);
        var finLen = pc.length * fish.length;
        var tipP = R.add(base, R.scale(dir, finLen));
        var backP = R.add(base, R.scale(forward, -finLen * 0.35));
        shadeAndPush(list, camera, [base, tipP, backP], finColor, { doubleSided: true, alpha: finColor.a });
      });
    }

    if (spec.barbels) {
      var nose = ribs[0].spine;
      [1, -1].forEach(function (side) {
        var sway = 8 * Math.sin(t * 0.8 + side * 1.7 + fish.bodyPhase * 0.3);
        var mid1 = R.add(nose, R.add(R.scale(forward, -6), R.add(R.scale(right2, side * 10), R.scale(up2, -6 + sway * 0.3))));
        var tipP1 = R.add(mid1, R.add(R.scale(forward, -14), R.add(R.scale(right2, side * 8 + sway), R.scale(up2, -14))));
        pushLine(list, camera, [nose, mid1, tipP1], 'rgba(150,140,120,0.6)', 1.4);
      });
    }

    var eyeRib = ribs[Math.min(1, ribs.length - 1)];
    [1, -1].forEach(function (side) {
      var base = side > 0 ? eyeRib.right : eyeRib.left;
      var eyePos = R.add(base, R.add(R.scale(forward, fish.length * 0.02), R.scale(up2, fish.length * 0.05)));
      pushCircle(list, camera, eyePos, fish.length * 0.03, 'rgba(12,12,18,0.95)');
    });
  }

  // ---- среда: песчаное дно с каустикой -----------------------------------
  var sandCells = [];
  function initSand() {
    var nx = 14, nz = 10;
    var x0 = -TANK.halfX, x1 = TANK.halfX, z0 = -TANK.halfZ, z1 = TANK.halfZ;
    for (var i = 0; i < nx; i++) {
      for (var j = 0; j < nz; j++) {
        var ax = x0 + (x1 - x0) * i / nx, bx = x0 + (x1 - x0) * (i + 1) / nx;
        var az = z0 + (z1 - z0) * j / nz, bz = z0 + (z1 - z0) * (j + 1) / nz;
        sandCells.push({
          cx: (ax + bx) / 2, cz: (az + bz) / 2,
          pts: [
            { x: ax, y: TANK.bottom, z: az },
            { x: bx, y: TANK.bottom, z: az },
            { x: bx, y: TANK.bottom, z: bz },
            { x: ax, y: TANK.bottom, z: bz },
          ],
        });
      }
    }
  }

  function buildSandGrid(list, camera, t) {
    for (var i = 0; i < sandCells.length; i++) {
      var cell = sandCells[i];
      var c = caustic(cell.cx, cell.cz, t);
      var base = lerpColor(SAND_DARK, SAND_LIGHT, 0.3 + 0.6 * c);
      shadeAndPush(list, camera, cell.pts, base, { outwardHint: { x: cell.cx, y: TANK.bottom - 400, z: cell.cz } });
    }
  }

  // ---- среда: водоросли --------------------------------------------------
  var plants = [];
  function initPlants() {
    var count = 6;
    for (var p = 0; p < count; p++) {
      var angle = Math.random() * Math.PI * 2;
      var rad = TANK.halfX * 0.55 + Math.random() * TANK.halfX * 0.35;
      var root = {
        x: R.clamp(Math.cos(angle) * rad, -TANK.halfX + 20, TANK.halfX - 20),
        y: TANK.bottom + 2,
        z: R.clamp(Math.sin(angle) * rad * (TANK.halfZ / TANK.halfX), -TANK.halfZ + 20, TANK.halfZ - 20),
      };
      var blades = [];
      var bladeCount = 3 + ((Math.random() * 2) | 0);
      for (var b = 0; b < bladeCount; b++) {
        var bladeAngle = Math.random() * Math.PI * 2;
        var swayDir = R.normalize({ x: Math.cos(bladeAngle), y: 0, z: Math.sin(bladeAngle) });
        var widthDir = R.normalize(R.cross(WORLD_UP, swayDir));
        blades.push({
          segments: 6,
          length: randRange(80, 170),
          baseWidth: randRange(9, 15),
          swayDir: swayDir, widthDir: widthDir,
          swayAmp: randRange(14, 26),
          swayFreq: randRange(0.35, 0.6),
          phase: Math.random() * Math.PI * 2,
        });
      }
      plants.push({ root: root, blades: blades });
    }
  }

  function buildPlants(list, camera, t) {
    for (var p = 0; p < plants.length; p++) {
      var plant = plants[p];
      for (var b = 0; b < plant.blades.length; b++) {
        var blade = plant.blades[b];
        var segs = blade.segments;
        var pts = [];
        for (var i = 0; i < segs; i++) {
          var s = i / (segs - 1);
          var height = s * blade.length;
          var sway = blade.swayAmp * Math.pow(s, 1.6) * Math.sin(t * blade.swayFreq + blade.phase - s * 2.2);
          var center = R.add(plant.root, R.add(R.scale(WORLD_UP, height), R.scale(blade.swayDir, sway)));
          var width = Math.max(1.5, blade.baseWidth * (1 - s));
          pts.push({
            center: center,
            left: R.add(center, R.scale(blade.widthDir, width * 0.5)),
            right: R.add(center, R.scale(blade.widthDir, -width * 0.5)),
            s: s,
          });
        }
        for (i = 0; i < segs - 1; i++) {
          var a = pts[i], c2 = pts[i + 1];
          var sMid = (a.s + c2.s) / 2;
          var color = lerpColor(PLANT_DARK, PLANT_LIGHT, sMid);
          shadeAndPush(list, camera, [a.left, c2.left, c2.right, a.right], color, { doubleSided: true, alpha: 0.85 });
        }
      }
    }
  }

  // ---- среда: нисходящие лучи света --------------------------------------
  var lightShafts = [];
  function initShafts() {
    var count = 5;
    for (var i = 0; i < count; i++) {
      lightShafts.push({
        baseX: randRange(-TANK.halfX * 0.7, TANK.halfX * 0.7),
        baseZ: randRange(-TANK.halfZ * 0.6, TANK.halfZ * 0.6),
        width: randRange(60, 110),
        driftSpeed: randRange(0.06, 0.12),
        phase1: Math.random() * Math.PI * 2,
        phase2: Math.random() * Math.PI * 2,
      });
    }
  }

  function buildLightShafts(list, camera, t) {
    for (var i = 0; i < lightShafts.length; i++) {
      var shaft = lightShafts[i];
      var cx = shaft.baseX + 30 * Math.sin(t * 0.05 + shaft.phase1);
      var cz = shaft.baseZ;
      var topW = shaft.width;
      var sway = 40 * Math.sin(t * shaft.driftSpeed + shaft.phase2);
      var top = TANK.top + 10;
      var bot = TANK.bottom + 60;
      var p0 = { x: cx - topW / 2, y: top, z: cz };
      var p1 = { x: cx + topW / 2, y: top, z: cz };
      var p2 = { x: cx + topW * 0.32 + sway, y: bot, z: cz };
      var p3 = { x: cx - topW * 0.32 + sway, y: bot, z: cz };
      var pts = [p0, p1, p2, p3];
      var camPts = pts.map(function (p) { return R.worldToCamera(p, camera.position, camera.basis); });
      var allBehind = camPts.every(function (p) { return p.z <= 1e-3; });
      if (allBehind) continue;
      var screenPts = [];
      var anyBehind = false;
      for (var k = 0; k < camPts.length; k++) {
        var pr = R.project(camPts[k], viewportRef.focal, viewportRef.width, viewportRef.height);
        if (pr.behind) { anyBehind = true; break; }
        screenPts.push({ x: pr.x, y: pr.y });
      }
      if (anyBehind) continue;
      var avgDepth = (camPts[0].z + camPts[1].z + camPts[2].z + camPts[3].z) / 4;
      list.push({
        pts: screenPts, depth: avgDepth, composite: 'lighter',
        gradient: {
          from: screenPts[0], to: screenPts[2],
          stops: [[0, 'rgba(210,240,235,0.16)'], [0.6, 'rgba(180,225,220,0.06)'], [1, 'rgba(180,225,220,0)']],
        },
      });
    }
  }

  // ---- среда: пузырьки ----------------------------------------------------
  var bubbleSources = [];
  var bubbles = [];
  function initBubbles() {
    var srcCount = 4;
    for (var i = 0; i < srcCount; i++) {
      bubbleSources.push({ x: randRange(-TANK.halfX * 0.6, TANK.halfX * 0.6), z: randRange(-TANK.halfZ * 0.6, TANK.halfZ * 0.6) });
    }
    var count = 50;
    for (i = 0; i < count; i++) {
      var src = bubbleSources[i % bubbleSources.length];
      bubbles.push({
        x: src.x + (Math.random() - 0.5) * 18,
        z: src.z + (Math.random() - 0.5) * 18,
        y: TANK.bottom + Math.random() * (TANK.top - TANK.bottom),
        riseSpeed: randRange(28, 48),
        radius: randRange(1.6, 4.2),
        wobbleAmp: randRange(3, 9),
        wobbleFreq: randRange(0.6, 1.4),
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function updateBubbles(dt) {
    for (var i = 0; i < bubbles.length; i++) {
      var b = bubbles[i];
      b.y += b.riseSpeed * dt;
      if (b.y > TANK.top - 5) {
        var src = bubbleSources[(Math.random() * bubbleSources.length) | 0];
        b.y = TANK.bottom + Math.random() * 20;
        b.x = src.x + (Math.random() - 0.5) * 18;
        b.z = src.z + (Math.random() - 0.5) * 18;
        b.phase = Math.random() * Math.PI * 2;
      }
    }
  }

  function buildBubbles(list, camera, t) {
    for (var i = 0; i < bubbles.length; i++) {
      var b = bubbles[i];
      var wob = b.wobbleAmp * Math.sin(t * b.wobbleFreq + b.phase);
      var pos = { x: b.x + wob, y: b.y, z: b.z + b.wobbleAmp * 0.6 * Math.cos(t * b.wobbleFreq * 0.8 + b.phase) };
      var rr = b.radius * (0.85 + 0.25 * Math.sin(t * 3 + b.phase));
      var fadeTop = R.clamp((TANK.top - pos.y) / 40, 0, 1);
      var cp = R.worldToCamera(pos, camera.position, camera.basis);
      if (cp.z <= 1e-3) continue;
      var pr = R.project(cp, viewportRef.focal, viewportRef.width, viewportRef.height);
      if (pr.behind) continue;
      var screenR = Math.max(0.6, rr * pr.scale);
      var fogAmt = R.clamp((cp.z - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1) * FOG_MAX;
      var alpha = 0.5 * fadeTop * (1 - fogAmt * 0.7);
      if (alpha <= 0.01) continue;
      list.push({ type: 'circle', x: pr.x, y: pr.y, r: screenR, depth: cp.z, fill: 'rgba(210,240,245,' + alpha.toFixed(3) + ')' });
    }
  }

  // ---- камера: медленный облёт + ручной drag/zoom ------------------------
  function computeCamera(camTime) {
    var yaw = camTime * ORBIT_SPEED + dragYaw;
    var basePitch = -0.10 + 0.05 * Math.sin(camTime * 0.17);
    var pitch = R.clamp(basePitch + dragPitch, -0.85, 0.85);
    var dist = camDist + 30 * Math.sin(camTime * 0.083);
    var basis = R.basisFromYawPitch(yaw, pitch);
    var target = { x: 0, y: 0, z: 0 };
    var position = R.sub(target, R.scale(basis.forward, dist));
    return { position: position, basis: basis };
  }

  // ---- фон / виньетка (кэшируются, пересобираются только при resize) -----
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    viewportRef.width = w; viewportRef.height = h;
    viewportRef.focal = R.fovToFocal(FOV_Y, h);

    bgGradient = ctx.createLinearGradient(0, 0, 0, h);
    bgGradient.addColorStop(0, '#0c4753');
    bgGradient.addColorStop(0.35, '#083140');
    bgGradient.addColorStop(0.68, '#051f2c');
    bgGradient.addColorStop(1, '#010509');

    vignetteGradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
    vignetteGradient.addColorStop(0, 'rgba(0,0,0,0)');
    vignetteGradient.addColorStop(1, 'rgba(0,0,0,0.55)');
  }
  window.addEventListener('resize', resize);

  function drawGlassOverlay(t) {
    var w = viewportRef.width, h = viewportRef.height;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 2; i++) {
      var off = (i === 0 ? 0.22 : 0.68) + 0.04 * Math.sin(t * 0.05 + i);
      var x0 = w * off - h * 0.35, y0 = -20;
      var x1 = w * off + h * 0.35, y1 = h + 20;
      var g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(220,245,250,0.05)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0 - 40, y0);
      ctx.lineTo(x0 + 40, y0);
      ctx.lineTo(x1 + 40, y1);
      ctx.lineTo(x1 - 40, y1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- сборка кадра --------------------------------------------------------
  function renderFrame(simTime, camTime) {
    var camera = computeCamera(camTime);
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, viewportRef.width, viewportRef.height);

    var list = [];
    buildSandGrid(list, camera, simTime);
    buildPlants(list, camera, simTime);
    for (var i = 0; i < allFish.length; i++) {
      var fish = allFish[i];
      var frameData = buildFishBodyPrimitives(fish, simTime, camera, list);
      buildFins(list, camera, fish, frameData, simTime);
    }
    buildLightShafts(list, camera, simTime);
    buildBubbles(list, camera, simTime);

    var sorted = R.sortByDepthDesc(list, function (item) { return item.depth; });
    for (i = 0; i < sorted.length; i++) {
      var item = sorted[i];
      ctx.globalCompositeOperation = item.composite || 'source-over';
      if (item.type === 'circle') {
        ctx.beginPath();
        ctx.arc(item.x, item.y, Math.max(0.4, item.r), 0, Math.PI * 2);
        ctx.fillStyle = item.fill;
        ctx.fill();
      } else if (item.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(item.pts[0].x, item.pts[0].y);
        for (var pI = 1; pI < item.pts.length; pI++) ctx.lineTo(item.pts[pI].x, item.pts[pI].y);
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = item.lineWidth || 1;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(item.pts[0].x, item.pts[0].y);
        for (var pJ = 1; pJ < item.pts.length; pJ++) ctx.lineTo(item.pts[pJ].x, item.pts[pJ].y);
        ctx.closePath();
        if (item.gradient) {
          var grad = ctx.createLinearGradient(item.gradient.from.x, item.gradient.from.y, item.gradient.to.x, item.gradient.to.y);
          for (var sI = 0; sI < item.gradient.stops.length; sI++) grad.addColorStop(item.gradient.stops[sI][0], item.gradient.stops[sI][1]);
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = item.fill;
        }
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    drawGlassOverlay(simTime);
    ctx.fillStyle = vignetteGradient;
    ctx.fillRect(0, 0, viewportRef.width, viewportRef.height);
  }

  function updateSim(dt, t) {
    for (var key in schoolAnchors) {
      var anchor = schoolAnchors[key];
      anchor.timer -= dt;
      var d = R.length(R.sub(anchor.waypoint, anchor.pos));
      if (d < 60 || anchor.timer <= 0) {
        anchor.waypoint = randomPointInTank(70);
        anchor.timer = randRange(6, 14);
      }
      var dir = R.normalize(R.sub(anchor.waypoint, anchor.pos));
      anchor.pos = R.add(anchor.pos, R.scale(dir, 34 * dt));
    }
    for (var i = 0; i < allFish.length; i++) updateFish(allFish[i], dt, t);
    updateBubbles(dt);
  }

  // ---- инициализация сцены -------------------------------------------------
  initSand();
  initPlants();
  initShafts();
  initBubbles();
  for (var si = 0; si < SPECIES.length; si++) {
    var spec = SPECIES[si];
    if (spec.schooling) {
      schoolAnchors[spec.key] = { pos: randomPointInTank(80), waypoint: randomPointInTank(80), timer: randRange(6, 12) };
    }
    for (var c = 0; c < spec.count; c++) allFish.push(spawnFish(spec));
  }
  resize();

  // ---- управление: пауза / скорость / drag-камера / колесо-зум -----------
  var btnPause = document.getElementById('btn-pause');
  var speedEl = document.getElementById('speed');
  var camSpeedEl = document.getElementById('camspeed');

  btnPause.addEventListener('click', function () {
    paused = !paused;
    btnPause.classList.toggle('is-paused', paused);
  });
  speedEl.addEventListener('input', function () { speedMultiplier = parseFloat(speedEl.value); });
  camSpeedEl.addEventListener('input', function () { camSpeedMultiplier = parseFloat(camSpeedEl.value); });

  canvas.addEventListener('pointerdown', function (e) {
    dragging = true; lastPX = e.clientX; lastPY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastPX, dy = e.clientY - lastPY;
    lastPX = e.clientX; lastPY = e.clientY;
    dragYaw -= dx * 0.005;
    dragPitch = R.clamp(dragPitch - dy * 0.004, -0.8, 0.85);
  });
  canvas.addEventListener('pointerup', function () { dragging = false; });
  canvas.addEventListener('pointercancel', function () { dragging = false; });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    camDist = R.clamp(camDist + e.deltaY * 0.4, 420, 1100);
  }, { passive: false });

  // ---- главный цикл ---------------------------------------------------------
  var lastTimeMs = performance.now();
  var simTime = 0, camTime = 0;

  function frame(now) {
    var dt = R.clamp((now - lastTimeMs) / 1000, 0, 0.05);
    lastTimeMs = now;
    if (!paused) {
      var simDt = dt * speedMultiplier;
      simTime += simDt;
      updateSim(simDt, simTime);
      camTime += dt * camSpeedMultiplier;
    }
    renderFrame(simTime, camTime);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
