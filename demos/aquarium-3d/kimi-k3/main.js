'use strict';
(function () {

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');

  var TAU = Math.PI * 2;
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function mixc(c1, c2, t) {
    return [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
  }
  function css(c, a) {
    var r = c[0] | 0, g = c[1] | 0, b = c[2] | 0;
    return a === undefined ? 'rgb(' + r + ',' + g + ',' + b + ')'
                           : 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  // ---------- viewport / DPR ----------
  var W = 0, H = 0, CX = 0, CY = 0, FOCAL = 600;
  var bgGrad = null, poolGrad = null, vigGrad = null;

  function resize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(2, Math.round(window.innerWidth * dpr));
    H = Math.max(2, Math.round(window.innerHeight * dpr));
    canvas.width = W;
    canvas.height = H;
    CX = W / 2;
    CY = H / 2;
    FOCAL = Math.min(W, H) * 1.18;

    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#1b6a8c');
    bgGrad.addColorStop(0.45, '#0d3a5c');
    bgGrad.addColorStop(1, '#041220');

    poolGrad = ctx.createRadialGradient(CX, H * 0.02, 0, CX, H * 0.02, Math.max(W, H) * 0.6);
    poolGrad.addColorStop(0, 'rgba(160,220,255,0.16)');
    poolGrad.addColorStop(1, 'rgba(160,220,255,0)');

    vigGrad = ctx.createRadialGradient(CX, CY, Math.min(W, H) * 0.35, CX, CY, Math.max(W, H) * 0.75);
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vigGrad.addColorStop(1, 'rgba(2,8,16,0.5)');
  }
  window.addEventListener('resize', resize);

  // ---------- world: аквариум (полуразмеры), y — вверх, дно на y = -HY ----------
  var HX = 360, HY = 205, HZ = 245;
  var FOGC = [9, 44, 66];

  function fogAmount(vz) { return clamp((vz - 320) / 1050, 0, 0.85); }
  function fogged(c, vz) { return mixc(c, FOGC, fogAmount(vz)); }

  // ---------- camera ----------
  var camPos = { x: 0, y: 0, z: 0 };
  var basisR = { x: 1, y: 0, z: 0 };
  var basisU = { x: 0, y: 1, z: 0 };
  var basisF = { x: 0, y: 0, z: 1 };
  var camYaw = 0.6;
  var orbit = true;

  function updateCamera(dt, t) {
    if (orbit) camYaw += dt * 0.07;
    var swayYaw = Math.sin(t * 0.11) * 0.08;
    var dist = 860;
    camPos.x = Math.sin(camYaw + swayYaw) * dist;
    camPos.z = Math.cos(camYaw + swayYaw) * dist;
    camPos.y = 26 + Math.sin(t * 0.21) * 30 + Math.sin(t * 0.047) * 14;

    var fx = 0 - camPos.x, fy = -8 - camPos.y, fz = 0 - camPos.z;
    var fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    basisF.x = fx; basisF.y = fy; basisF.z = fz;

    // r = normalize(cross(f, up)), up=(0,1,0) -> (-fz, 0, fx)
    var rx = -fz, rz = fx;
    var rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    basisR.x = rx; basisR.y = 0; basisR.z = rz;

    // u = cross(r, f)
    basisU.x = basisR.y * fz - rz * fy;
    basisU.y = rz * fx - rx * fz;
    basisU.z = rx * fy - basisR.y * fx;
  }

  function project(p) {
    var dx = p.x - camPos.x, dy = p.y - camPos.y, dz = p.z - camPos.z;
    var vx = dx * basisR.x + dy * basisR.y + dz * basisR.z;
    var vy = dx * basisU.x + dy * basisU.y + dz * basisU.z;
    var vz = dx * basisF.x + dy * basisF.y + dz * basisF.z;
    if (vz < 28) vz = 28;
    var s = FOCAL / vz;
    return { x: CX + vx * s, y: CY - vy * s, s: s, z: vz };
  }

  // ---------- species ----------
  var SPECIES = {
    gold: {
      len: 95, h: 52, tail: 46, tailH: 30, dorsal: 16, pect: 16,
      bend: 0.55, speed: 46, turn: 1.4,
      back: [178, 84, 22], body: [238, 148, 44], belly: [255, 214, 140], fin: [246, 166, 70]
    },
    barb: {
      len: 60, h: 26, tail: 20, tailH: 13, dorsal: 9, pect: 8,
      bend: 0.7, speed: 78, turn: 2.2, stripes: true,
      back: [38, 88, 110], body: [92, 172, 196], belly: [208, 238, 244], fin: [120, 190, 210]
    },
    neon: {
      len: 26, h: 9, tail: 7, tailH: 4.5, dorsal: 2.5, pect: 3,
      bend: 1.0, speed: 95, turn: 3.2, glow: true, school: true,
      back: [28, 60, 120], body: [70, 130, 210], belly: [190, 235, 255], fin: [120, 180, 230]
    }
  };

  function randPoint(m) {
    return {
      x: rand(-HX + m, HX - m),
      y: rand(-HY + m + 15, HY - m - 15),
      z: rand(-HZ + m, HZ - m)
    };
  }

  function makeFish(key) {
    var sp = SPECIES[key];
    var a = rand(0, TAU);
    var f = {
      key: key, spec: sp,
      pos: randPoint(50),
      vel: { x: Math.cos(a) * sp.speed, y: rand(-8, 8), z: Math.sin(a) * sp.speed },
      sv: { x: 0, y: 0, z: 0 },
      phase: rand(0, TAU),
      size: rand(0.85, 1.15),
      target: randPoint(55),
      offA: rand(0, TAU),
      offR: rand(15, 85),
      offY: rand(-30, 30)
    };
    f.sv.x = f.vel.x; f.sv.y = f.vel.y; f.sv.z = f.vel.z;
    return f;
  }

  var fishBig = [];
  var neons = [];

  function syncNeons(n) {
    while (neons.length < n) neons.push(makeFish('neon'));
    if (neons.length > n) neons.length = n;
  }

  // ---------- school centre (виртуальный блуждающий лидер стайки) ----------
  var school = { x: 0, y: 0, z: 0, vx: 40, vy: 0, vz: 20, tx: 100, ty: 0, tz: -60 };

  function updateSchool(dt) {
    var dx = school.tx - school.x, dy = school.ty - school.y, dz = school.tz - school.z;
    var d = Math.hypot(dx, dy, dz) || 1;
    if (d < 60) {
      var p = randPoint(85);
      school.tx = p.x; school.ty = p.y; school.tz = p.z;
    }
    var k = clamp(dt * 1.1, 0, 1);
    school.vx = mix(school.vx, dx / d * 55, k);
    school.vy = mix(school.vy, dy / d * 55, k);
    school.vz = mix(school.vz, dz / d * 55, k);
    school.x = clamp(school.x + school.vx * dt, -HX + 70, HX - 70);
    school.y = clamp(school.y + school.vy * dt, -HY + 80, HY - 70);
    school.z = clamp(school.z + school.vz * dt, -HZ + 70, HZ - 70);
    if (school.x <= -HX + 70 || school.x >= HX - 70) school.vx *= -0.6;
    if (school.y <= -HY + 80 || school.y >= HY - 70) school.vy *= -0.6;
    if (school.z <= -HZ + 70 || school.z >= HZ - 70) school.vz *= -0.6;
  }

  // ---------- fish update ----------
  function updateFish(f, dt) {
    var sp = f.spec;
    var tx, ty, tz;
    if (sp.school) {
      f.offA += dt * 0.22;
      tx = school.x + Math.cos(f.offA) * f.offR;
      ty = school.y + f.offY + Math.sin(tG * 0.6 + f.offA * 2) * 10;
      tz = school.z + Math.sin(f.offA) * f.offR;
    } else {
      tx = f.target.x; ty = f.target.y; tz = f.target.z;
    }
    var dx = tx - f.pos.x, dy = ty - f.pos.y, dz = tz - f.pos.z;
    var d = Math.hypot(dx, dy, dz) || 1;
    var sp0 = sp.speed * f.size;
    var k = clamp(dt * sp.turn, 0, 1);
    f.vel.x = mix(f.vel.x, dx / d * sp0, k);
    f.vel.y = mix(f.vel.y, dy / d * sp0, k);
    f.vel.z = mix(f.vel.z, dz / d * sp0, k);

    // мягкое отталкивание от стенок
    var soft = 90, push = 6;
    if (f.pos.x > HX - soft) f.vel.x -= (f.pos.x - (HX - soft)) * push * dt;
    if (f.pos.x < -HX + soft) f.vel.x += (-HX + soft - f.pos.x) * push * dt;
    if (f.pos.y > HY - soft) f.vel.y -= (f.pos.y - (HY - soft)) * push * dt;
    if (f.pos.y < -HY + soft) f.vel.y += (-HY + soft - f.pos.y) * push * dt;
    if (f.pos.z > HZ - soft) f.vel.z -= (f.pos.z - (HZ - soft)) * push * dt;
    if (f.pos.z < -HZ + soft) f.vel.z += (-HZ + soft - f.pos.z) * push * dt;

    // жёсткий разворот у самого стекла
    var m = 42;
    if (f.pos.x > HX - m && f.vel.x > 0) f.vel.x *= -0.55;
    if (f.pos.x < -HX + m && f.vel.x < 0) f.vel.x *= -0.55;
    if (f.pos.y > HY - m && f.vel.y > 0) f.vel.y *= -0.55;
    if (f.pos.y < -HY + m && f.vel.y < 0) f.vel.y *= -0.55;
    if (f.pos.z > HZ - m && f.vel.z > 0) f.vel.z *= -0.55;
    if (f.pos.z < -HZ + m && f.vel.z < 0) f.vel.z *= -0.55;

    f.pos.x = clamp(f.pos.x + f.vel.x * dt, -HX + 18, HX - 18);
    f.pos.y = clamp(f.pos.y + f.vel.y * dt, -HY + 30, HY - 24);
    f.pos.z = clamp(f.pos.z + f.vel.z * dt, -HZ + 18, HZ - 18);

    if (!sp.school && d < 70) f.target = randPoint(55);

    var ks = clamp(dt * 3.2, 0, 1);
    f.sv.x = mix(f.sv.x, f.vel.x, ks);
    f.sv.y = mix(f.sv.y, f.vel.y, ks);
    f.sv.z = mix(f.sv.z, f.vel.z, ks);

    var spd = Math.hypot(f.vel.x, f.vel.y, f.vel.z);
    f.phase += dt * (2.2 + spd * 0.075);
  }

  // ---------- fish draw ----------
  function prof(u) { return Math.sin(Math.PI * (0.14 + 0.86 * u)); }

  function drawFish(f) {
    var sp = f.spec;
    var L = sp.len * f.size, HH = sp.h * f.size;
    var v = f.sv;
    var vl = Math.hypot(v.x, v.y, v.z) || 1;
    var yaw = Math.atan2(-v.z, v.x);
    var pitch = Math.asin(clamp(v.y / vl, -1, 1));
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), snp = Math.sin(pitch);
    var bendW = sp.bend * L * 0.13;
    var phase = f.phase;

    function lzAt(u) { return Math.sin(phase - u * 2.7) * bendW * (0.15 + u); }
    function X(lx, ly, lz) {
      var x1 = lx * cp - ly * snp;
      var y1 = lx * snp + ly * cp;
      return {
        x: f.pos.x + x1 * cy + lz * sy,
        y: f.pos.y + y1,
        z: f.pos.z - x1 * sy + lz * cy
      };
    }

    var N = 8, i, u;
    var spine = [], hw = [];
    for (i = 0; i < N; i++) {
      u = i / (N - 1);
      spine.push(project(X(-L * u, 0, lzAt(u))));
      hw.push(HH * 0.5 * prof(u));
    }
    var nose = project(X(L * 0.07, 0, lzAt(0) * 0.2));
    var s0 = spine[3].s;
    var fog = fogAmount(spine[3].z);
    function cc(c) { return mixc(c, FOGC, fog); }

    // перпендикуляры в экранном пространстве
    var pl = [], pr = [];
    for (i = 0; i < N; i++) {
      var a2 = spine[Math.max(0, i - 1)], b2 = spine[Math.min(N - 1, i + 1)];
      var ddx = b2.x - a2.x, ddy = b2.y - a2.y;
      var ll = Math.hypot(ddx, ddy) || 1;
      ddx /= ll; ddy /= ll;
      var wpx = Math.max(0.4, hw[i] * spine[i].s);
      pl.push({ x: spine[i].x - ddy * wpx, y: spine[i].y + ddx * wpx });
      pr.push({ x: spine[i].x + ddy * wpx, y: spine[i].y - ddx * wpx });
    }

    // --- хвостовой плавник ---
    var tl = sp.tail * f.size, th = sp.tailH * f.size;
    var lz1 = lzAt(1);
    var zt = lz1 + Math.sin(phase - 2.9) * L * 0.14;
    var zm = (lz1 + zt) * 0.5;
    var tA = project(X(-L, 0, lz1));
    var tB = project(X(-L - tl * 0.5, th, zm));
    var tC = project(X(-L - tl, th * 0.5, zt));
    var tD = project(X(-L - tl, -th * 0.5, zt));
    var tE = project(X(-L - tl * 0.5, -th, zm));
    ctx.fillStyle = css(cc(sp.fin), 0.88);
    ctx.beginPath();
    ctx.moveTo(tA.x, tA.y);
    ctx.lineTo(tB.x, tB.y);
    ctx.lineTo(tC.x, tC.y);
    ctx.lineTo(tD.x, tD.y);
    ctx.lineTo(tE.x, tE.y);
    ctx.closePath();
    ctx.fill();

    // --- спинной плавник ---
    var dA = project(X(-L * 0.30, HH * 0.5 * prof(0.30) * 0.9, lzAt(0.30)));
    var dB = project(X(-L * 0.44, HH * 0.5 * prof(0.44) + sp.dorsal * f.size, lzAt(0.44)));
    var dC = project(X(-L * 0.62, HH * 0.5 * prof(0.62) * 0.9, lzAt(0.62)));
    ctx.fillStyle = css(cc(sp.fin), 0.85);
    ctx.beginPath();
    ctx.moveTo(dA.x, dA.y);
    ctx.lineTo(dB.x, dB.y);
    ctx.lineTo(dC.x, dC.y);
    ctx.closePath();
    ctx.fill();

    // --- тело ---
    var minY = Infinity, maxY = -Infinity;
    for (i = 0; i < N; i++) {
      if (pl[i].y < minY) minY = pl[i].y;
      if (pr[i].y > maxY) maxY = pr[i].y;
    }
    if (nose.y < minY) minY = nose.y;
    if (nose.y > maxY) maxY = nose.y;
    var grad = ctx.createLinearGradient(0, minY, 0, Math.max(minY + 1, maxY));
    grad.addColorStop(0, css(cc(sp.back)));
    grad.addColorStop(0.45, css(cc(sp.body)));
    grad.addColorStop(1, css(cc(sp.belly)));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(nose.x, nose.y);
    for (i = 0; i < N; i++) ctx.lineTo(pl[i].x, pl[i].y);
    for (i = N - 1; i >= 0; i--) ctx.lineTo(pr[i].x, pr[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = css(cc(mixc(sp.back, [0, 0, 0], 0.45)), 0.4);
    ctx.lineWidth = Math.max(0.7, 1.1 * s0);
    ctx.stroke();

    // --- полосы (барбусы) ---
    if (sp.stripes) {
      ctx.strokeStyle = css(cc([18, 40, 55]), 0.5);
      var bandU = [0.32, 0.5, 0.68];
      for (var bi = 0; bi < bandU.length; bi++) {
        u = bandU[bi];
        var yo = HH * 0.5 * prof(u) * 0.92;
        var p1 = project(X(-L * u, yo, lzAt(u)));
        var p2 = project(X(-L * u, -yo, lzAt(u)));
        ctx.lineWidth = Math.max(0.8, 3.0 * p1.s);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }

    // --- светящаяся полоса (неоны) ---
    if (sp.glow) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(120,255,225,' + (0.55 * (1 - fog)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.8, 1.6 * s0);
      ctx.beginPath();
      for (i = 1; i < N; i++) {
        if (i === 1) ctx.moveTo(spine[i].x, spine[i].y);
        else ctx.lineTo(spine[i].x, spine[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // --- грудной плавник (на стороне, обращённой к камере) ---
    var sgn = ((camPos.x - f.pos.x) * sy + (camPos.z - f.pos.z) * cy) > 0 ? 1 : -1;
    var flap = Math.sin(phase * 2 + 0.8) * HH * 0.2;
    var b1 = project(X(-L * 0.14, HH * 0.08, sgn * HH * 0.42));
    var b2 = project(X(-L * 0.26, -HH * 0.12, sgn * HH * 0.46));
    var tp = project(X(-L * 0.34, -HH * 0.5 - flap, sgn * (HH * 0.46 + sp.pect * f.size)));
    ctx.fillStyle = css(cc(sp.fin), 0.5);
    ctx.beginPath();
    ctx.moveTo(b1.x, b1.y);
    ctx.lineTo(tp.x, tp.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.closePath();
    ctx.fill();

    // --- глаз ---
    var e = project(X(-L * 0.04, HH * 0.14, sgn * (HH * 0.5 * prof(0.05) + 1.2)));
    var er = Math.max(1.2, HH * 0.1 * e.s);
    ctx.fillStyle = 'rgba(10,14,18,' + (0.9 * (1 - fog * 0.7)).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(e.x, e.y, er, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,' + (0.7 * (1 - fog)).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(e.x - er * 0.3, e.y - er * 0.3, er * 0.32, 0, TAU);
    ctx.fill();
  }

  // ---------- песчаное дно с каустиками ----------
  var FNX = 22, FNZ = 14;

  function caustic(x, z, t) {
    var c = Math.sin(x * 0.045 + t * 0.9) * Math.sin(z * 0.05 - t * 0.7)
          + Math.sin((x * 0.7 + z) * 0.04 + t * 1.25)
          + Math.sin((x - z * 0.8) * 0.03 - t * 0.5);
    c = c / 3 * 0.5 + 0.5;
    return Math.pow(c, 3);
  }

  function renderFloor(t) {
    var cells = [];
    for (var iz = 0; iz < FNZ; iz++) {
      for (var ix = 0; ix < FNX; ix++) {
        var x0 = -HX + 2 * HX * ix / FNX, x1 = -HX + 2 * HX * (ix + 1) / FNX;
        var z0 = -HZ + 2 * HZ * iz / FNZ, z1 = -HZ + 2 * HZ * (iz + 1) / FNZ;
        var p0 = project({ x: x0, y: -HY, z: z0 });
        var p1 = project({ x: x1, y: -HY, z: z0 });
        var p2 = project({ x: x1, y: -HY, z: z1 });
        var p3 = project({ x: x0, y: -HY, z: z1 });
        cells.push({
          z: (p0.z + p1.z + p2.z + p3.z) / 4,
          cx: (x0 + x1) / 2, cz: (z0 + z1) / 2,
          p: [p0, p1, p2, p3]
        });
      }
    }
    cells.sort(function (a, b) { return b.z - a.z; });
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var ca = caustic(cell.cx, cell.cz, t);
      var col = mixc([126, 108, 74], [214, 196, 150], ca);
      col = mixc(col, FOGC, fogAmount(cell.z));
      ctx.fillStyle = css(col);
      ctx.beginPath();
      ctx.moveTo(cell.p[0].x, cell.p[0].y);
      ctx.lineTo(cell.p[1].x, cell.p[1].y);
      ctx.lineTo(cell.p[2].x, cell.p[2].y);
      ctx.lineTo(cell.p[3].x, cell.p[3].y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---------- объёмные лучи света ----------
  var RAYS = [];
  for (var ri = 0; ri < 6; ri++) {
    RAYS.push({
      bx: rand(-HX * 0.7, HX * 0.7),
      bz: rand(-HZ * 0.6, HZ * 0.6),
      w: rand(0.7, 1.4),
      ph: rand(0, TAU),
      lean: rand(-0.3, 0.3)
    });
  }

  function drawRay(r, alphaMul, t) {
    var topX = r.bx + Math.sin(t * 0.27 + r.ph) * 36;
    var botX = topX + r.lean * HY * 2 + Math.sin(t * 0.19 + r.ph * 2) * 24;
    var tw = 16 * r.w, bw = 95 * r.w;
    var p0 = project({ x: topX - tw, y: HY, z: r.bz });
    var p1 = project({ x: topX + tw, y: HY, z: r.bz });
    var p2 = project({ x: botX + bw, y: -HY, z: r.bz + r.lean * 60 });
    var p3 = project({ x: botX - bw, y: -HY, z: r.bz + r.lean * 60 });
    var g = ctx.createLinearGradient(
      (p0.x + p1.x) / 2, (p0.y + p1.y) / 2,
      (p2.x + p3.x) / 2, (p2.y + p3.y) / 2
    );
    var a = 0.10 * r.w * alphaMul;
    g.addColorStop(0, 'rgba(190,232,255,' + a.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(190,232,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- водоросли ----------
  var PLANTS = [];
  var spots = [
    [-300, -170], [-150, -200], [30, -180], [210, -160], [315, -70],
    [-325, 30], [-70, -60], [140, 50], [290, 140], [-190, 160],
    [50, 205], [-40, 120]
  ];
  for (var pi = 0; pi < spots.length; pi++) {
    PLANTS.push({
      x: spots[pi][0], z: spots[pi][1],
      h: rand(95, 180),
      ph: rand(0, TAU),
      spd: rand(0.5, 0.9),
      tone: rand(0, 1)
    });
  }

  function drawPlant(pl) {
    var M = 9, j, u;
    var pts = [];
    for (j = 0; j <= M; j++) {
      u = j / M;
      var sway = Math.sin(tG * pl.spd + pl.ph + u * 1.6) * 26 * Math.pow(u, 1.4);
      var sway2 = Math.cos(tG * pl.spd * 0.8 + pl.ph * 1.7 + u * 1.2) * 14 * Math.pow(u, 1.4);
      pts.push(project({ x: pl.x + sway, y: -HY + pl.h * u, z: pl.z + sway2 }));
    }
    var fog = fogAmount(pts[0].z);
    var cBase = mixc([26, 80, 44], [70, 140, 70], pl.tone);
    var col = mixc(cBase, FOGC, fog);

    var pl2 = [], pr2 = [];
    for (j = 0; j <= M; j++) {
      u = j / M;
      var a2 = pts[Math.max(0, j - 1)], b2 = pts[Math.min(M, j + 1)];
      var ddx = b2.x - a2.x, ddy = b2.y - a2.y;
      var ll = Math.hypot(ddx, ddy) || 1;
      ddx /= ll; ddy /= ll;
      var wpx = Math.max(0.3, (7 * (1 - u * 0.8) + 1) * pts[j].s);
      pl2.push({ x: pts[j].x - ddy * wpx, y: pts[j].y + ddx * wpx });
      pr2.push({ x: pts[j].x + ddy * wpx, y: pts[j].y - ddx * wpx });
    }
    ctx.fillStyle = css(col, 0.92);
    ctx.beginPath();
    ctx.moveTo(pl2[0].x, pl2[0].y);
    for (j = 1; j <= M; j++) ctx.lineTo(pl2[j].x, pl2[j].y);
    for (j = M; j >= 0; j--) ctx.lineTo(pr2[j].x, pr2[j].y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = css(mixc(mixc(cBase, [180, 230, 160], 0.5), FOGC, fog), 0.5);
    ctx.lineWidth = Math.max(0.6, 1.0 * pts[0].s);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (j = 1; j <= M; j++) ctx.lineTo(pts[j].x, pts[j].y);
    ctx.stroke();
  }

  // ---------- пузырьки ----------
  var bubbles = [];

  function makeBubble(anywhere) {
    return {
      x: rand(-HX + 20, HX - 20),
      y: anywhere ? rand(-HY, HY) : -HY + rand(0, 30),
      z: rand(-HZ + 20, HZ - 20),
      r: rand(1.6, 4.2),
      spd: rand(24, 52),
      ph: rand(0, TAU)
    };
  }

  function syncBubbles(n) {
    while (bubbles.length < n) bubbles.push(makeBubble(true));
    if (bubbles.length > n) bubbles.length = n;
  }

  function updateBubble(b, dt) {
    b.y += b.spd * dt;
    b.x += Math.sin(tG * 2.1 + b.ph) * 10 * dt;
    b.z += Math.cos(tG * 1.7 + b.ph) * 6 * dt;
    if (b.y > HY - 14) {
      b.y = -HY + rand(0, 20);
      b.x = rand(-HX + 20, HX - 20);
      b.z = rand(-HZ + 20, HZ - 20);
    }
  }

  function drawBubble(b) {
    var p = project(b);
    var rr = Math.max(0.6, b.r * p.s);
    var a = (1 - fogAmount(p.z)) * 0.55;
    if (a <= 0.02) return;
    ctx.strokeStyle = 'rgba(205,235,255,' + (a * 0.8).toFixed(3) + ')';
    ctx.lineWidth = Math.max(0.5, 0.7 * p.s);
    ctx.fillStyle = 'rgba(205,235,255,' + (a * 0.12).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.9).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(p.x - rr * 0.35, p.y - rr * 0.35, rr * 0.25, 0, TAU);
    ctx.fill();
  }

  // ---------- взвесь / «морской снег» ----------
  var SNOW = [];
  for (var si = 0; si < 70; si++) {
    SNOW.push({ x: rand(-HX, HX), y: rand(-HY, HY), z: rand(-HZ, HZ), ph: rand(0, TAU) });
  }

  function updateSnow(dt) {
    for (var i = 0; i < SNOW.length; i++) {
      var s = SNOW[i];
      s.y -= 4 * dt;
      s.x += Math.sin(tG * 0.5 + s.ph) * 2 * dt;
      if (s.y < -HY) s.y = HY;
    }
  }

  function renderSnow() {
    ctx.fillStyle = '#cfe8f5';
    for (var i = 0; i < SNOW.length; i++) {
      var p = project(SNOW[i]);
      var a = 0.14 * (1 - fogAmount(p.z));
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      var sz = Math.max(0.6, 1.4 * p.s);
      ctx.fillRect(p.x, p.y, sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- рёбра стеклянного объёма ----------
  var CORNERS = [];
  [-HX, HX].forEach(function (x) {
    [-HY, HY].forEach(function (y) {
      [-HZ, HZ].forEach(function (z) {
        CORNERS.push({ x: x, y: y, z: z });
      });
    });
  });
  var EDGES = [
    [0, 1], [0, 2], [1, 3], [2, 3],
    [4, 5], [4, 6], [5, 7], [6, 7],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];

  function renderEdges() {
    for (var i = 0; i < EDGES.length; i++) {
      var pA = project(CORNERS[EDGES[i][0]]);
      var pB = project(CORNERS[EDGES[i][1]]);
      var a = 0.05 + 0.16 * (1 - fogAmount((pA.z + pB.z) / 2));
      ctx.strokeStyle = 'rgba(180,225,245,' + a.toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.6, (pA.s + pB.s) * 0.5);
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
    }
  }

  // ---------- экранные блики на стекле и виньетка ----------
  function renderOverlays(t) {
    var gx = CX + Math.sin(t * 0.05) * W * 0.05;
    var g = ctx.createLinearGradient(gx - W * 0.3, 0, gx + W * 0.1, H);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var gx2 = CX - W * 0.35 + Math.cos(t * 0.037) * W * 0.04;
    var g2 = ctx.createLinearGradient(gx2, 0, gx2 + W * 0.25, H);
    g2.addColorStop(0, 'rgba(255,255,255,0)');
    g2.addColorStop(0.5, 'rgba(255,255,255,0.028)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- главный цикл ----------
  var tG = 0;
  var drawList = [];

  function pushEntity(z, fn) { drawList.push({ z: z, fn: fn }); }

  function update(dt) {
    tG += dt;
    updateCamera(dt, tG);
    updateSchool(dt);
    var i;
    for (i = 0; i < fishBig.length; i++) updateFish(fishBig[i], dt);
    for (i = 0; i < neons.length; i++) updateFish(neons[i], dt);
    for (i = 0; i < bubbles.length; i++) updateBubble(bubbles[i], dt);
    updateSnow(dt);
  }

  function render() {
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = poolGrad;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < RAYS.length; i++) drawRay(RAYS[i], 1, tG);
    ctx.restore();

    renderFloor(tG);
    renderSnow();

    drawList.length = 0;
    for (i = 0; i < PLANTS.length; i++) {
      (function (pl) {
        var base = project({ x: pl.x, y: -HY, z: pl.z });
        pushEntity(base.z, function () { drawPlant(pl); });
      })(PLANTS[i]);
    }
    for (i = 0; i < bubbles.length; i++) {
      (function (b) {
        pushEntity(project(b).z, function () { drawBubble(b); });
      })(bubbles[i]);
    }
    for (i = 0; i < fishBig.length; i++) {
      (function (f) {
        pushEntity(project(f.pos).z, function () { drawFish(f); });
      })(fishBig[i]);
    }
    for (i = 0; i < neons.length; i++) {
      (function (f) {
        pushEntity(project(f.pos).z, function () { drawFish(f); });
      })(neons[i]);
    }
    drawList.sort(function (a, b) { return b.z - a.z; });
    for (i = 0; i < drawList.length; i++) drawList[i].fn();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawRay(RAYS[0], 0.35, tG);
    drawRay(RAYS[1], 0.35, tG);
    ctx.restore();

    renderEdges();
    renderOverlays(tG);
  }

  var last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) dt = 0.001;
    update(dt);
    render();
  }

  // ---------- UI ----------
  function $(id) { return document.getElementById(id); }
  var uiNeons = $('uiNeons'), uiNeonsV = $('uiNeonsV');
  var uiBubbles = $('uiBubbles'), uiBubblesV = $('uiBubblesV');
  var uiOrbit = $('uiOrbit');

  if (uiNeons) {
    uiNeons.addEventListener('input', function () {
      uiNeonsV.textContent = uiNeons.value;
      syncNeons(+uiNeons.value);
    });
  }
  if (uiBubbles) {
    uiBubbles.addEventListener('input', function () {
      uiBubblesV.textContent = uiBubbles.value;
      syncBubbles(+uiBubbles.value);
    });
  }
  if (uiOrbit) {
    orbit = uiOrbit.checked;
    uiOrbit.addEventListener('change', function () { orbit = uiOrbit.checked; });
  }

  // ---------- init ----------
  resize();
  for (var gi = 0; gi < 3; gi++) fishBig.push(makeFish('gold'));
  for (var bi2 = 0; bi2 < 5; bi2++) fishBig.push(makeFish('barb'));
  syncNeons(uiNeons ? +uiNeons.value : 22);
  syncBubbles(uiBubbles ? +uiBubbles.value : 42);
  updateCamera(0, 0);
  requestAnimationFrame(frame);

})();
