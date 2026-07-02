/* «3D-аквариум» — Claude Fable 5.
   Canvas 2D, ручная перспективная проекция, алгоритм художника, без WebGL. */
(() => {
'use strict';

const TAU = Math.PI * 2;
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');

let W = 0, H = 0, FOCAL = 900;

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.max(1, Math.round(W * dpr));
  canvas.height = Math.max(1, Math.round(H * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  FOCAL = Math.min(W * 1.05, H * 1.45);
}
window.addEventListener('resize', resize);
resize();

/* ---------- Утилиты ---------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

let seed = 20260702;
function rnd() {
  seed = (seed * 16807 + 11) % 2147483647;
  return (seed & 0xffff) / 0x10000;
}
const rand = (a, b) => a + rnd() * (b - a);

function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function css(c, al) {
  const r = clamp(c[0], 0, 255) | 0, g = clamp(c[1], 0, 255) | 0, b = clamp(c[2], 0, 255) | 0;
  return al === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${al})`;
}

const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vmul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const vcross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});
const vlen = a => Math.hypot(a.x, a.y, a.z);
function vnorm(a) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

/* ---------- Аквариум и камера ---------- */
const TANK = { x: 23, y: 13, z: 14 }; // полуразмеры объёма

const cam = {
  pos: { x: 0, y: 5, z: 47 },
  fwd: { x: 0, y: 0, z: -1 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 }
};
let camYaw = -0.5;

function updateCamera(t, dt, orbit) {
  if (orbit) camYaw += dt * 0.05;
  const yaw = camYaw + Math.sin(t * 0.16) * 0.07;
  const R = 47 + Math.sin(t * 0.083) * 2.6;
  cam.pos = {
    x: Math.sin(yaw) * R,
    y: 5.5 + Math.sin(t * 0.12) * 2.4,
    z: Math.cos(yaw) * R
  };
  const tgt = {
    x: Math.sin(t * 0.05) * 1.5,
    y: -0.8 + Math.sin(t * 0.075) * 1.0,
    z: 0
  };
  const f = vnorm(vsub(tgt, cam.pos));
  const r = vnorm({ x: -f.z, y: 0, z: f.x });
  cam.fwd = f;
  cam.right = r;
  cam.up = vcross(r, f);
}

const NEAR = 1.2;
function project(p) {
  const dx = p.x - cam.pos.x, dy = p.y - cam.pos.y, dz = p.z - cam.pos.z;
  const zc = dx * cam.fwd.x + dy * cam.fwd.y + dz * cam.fwd.z;
  if (zc < NEAR) return null;
  const k = FOCAL / zc;
  return {
    x: W * 0.5 + (dx * cam.right.x + dy * cam.right.y + dz * cam.right.z) * k,
    y: H * 0.5 - (dx * cam.up.x + dy * cam.up.y + dz * cam.up.z) * k,
    s: k,
    z: zc
  };
}
const camDepth = p =>
  (p.x - cam.pos.x) * cam.fwd.x + (p.y - cam.pos.y) * cam.fwd.y + (p.z - cam.pos.z) * cam.fwd.z;

/* ---------- Туман воды ---------- */
const FOG_TOP = [64, 138, 165], FOG_BOT = [12, 40, 58];
function fogAt(p, zc) {
  const deep = clamp((TANK.y - p.y) / (TANK.y * 2), 0, 1);
  const f = clamp((zc - 30) / 62, 0, 1) * 0.82 + deep * 0.06;
  return { f: Math.min(f, 0.9), col: mix3(FOG_TOP, FOG_BOT, 0.25 + deep * 0.65) };
}
const shade = (c, fog) => mix3(c, fog.col, fog.f);

/* ---------- Фон: градиент глубины + солнечное пятно ---------- */
function drawBackground(t) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2a7396');
  g.addColorStop(0.42, '#11455f');
  g.addColorStop(1, '#051923');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const sun = project({ x: 0, y: TANK.y * 2.4, z: 0 });
  const sx = sun ? sun.x : W * 0.5;
  const sy = sun ? Math.min(sun.y, H * 0.1) : -H * 0.1;
  const rg = ctx.createRadialGradient(sx, sy - H * 0.25, 0, sx, sy - H * 0.25, H * 0.95);
  rg.addColorStop(0, 'rgba(140,215,240,0.28)');
  rg.addColorStop(1, 'rgba(140,215,240,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
}

/* ---------- Дно: дюны + каустики ---------- */
const duneY = (x, z) => Math.sin(x * 0.33 + 1.3) * 0.55 + Math.cos(z * 0.52 + x * 0.14) * 0.45;

/* Каустики — отдельный светящийся слой поверх ровного песка:
   две семьи волнистых линий, пересечения дают «соты» через lighter. */
function causticFamily(t, alongX, lines, phase0) {
  const steps = alongX ? 26 : 18;
  const limA = alongX ? TANK.x : TANK.z; // вдоль линии
  const limB = alongX ? TANK.z : TANK.x; // поперёк (позиция линии)
  for (let li = 0; li < lines; li++) {
    const base = -limB + 2 * limB * (li + 0.5) / lines;
    const pulse = 0.55 + 0.45 * Math.sin(t * 0.7 + li * 1.7 + phase0 * 3);
    let prev = null;
    for (let i = 0; i <= steps; i++) {
      const a = -limA + 2 * limA * i / steps;
      const wob = Math.sin(a * 0.55 + t * 0.9 + li * 2.1 + phase0)
                + Math.sin(a * 0.23 - t * 0.6 + li * 0.9) * 0.7;
      const b = clamp(base + wob * 1.15, -limB + 0.15, limB - 0.15);
      const x = alongX ? a : b;
      const z = alongX ? b : a;
      const p = { x, y: -TANK.y + duneY(x, z) + 0.05, z };
      const q = project(p);
      if (!q) { prev = null; continue; }
      if (prev) {
        const fogF = fogAt(p, q.z).f;
        const al = 0.13 * pulse * (1 - fogF);
        if (al > 0.004) {
          ctx.strokeStyle = css([155, 225, 240], al);
          ctx.lineWidth = Math.max(0.5,
            0.16 * q.s * (0.7 + 0.3 * Math.sin(a * 0.9 + t * 1.3 + li)));
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
      prev = q;
    }
  }
}

function drawCaustics(t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  causticFamily(t, true, 9, 1.0);
  causticFamily(t, false, 7, 2.35);
  ctx.restore();
  ctx.lineCap = 'butt';
}

const FLOOR_NX = 30, FLOOR_NZ = 18;
const SAND = [176, 156, 118], SAND_DARK = [96, 96, 84];

function drawFloor(t) {
  const nx = FLOOR_NX, nz = FLOOR_NZ;
  const proj = [], world = [];
  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) {
      const x = -TANK.x + 2 * TANK.x * ix / nx;
      const z = -TANK.z + 2 * TANK.z * iz / nz;
      const p = { x, y: -TANK.y + duneY(x, z), z };
      world.push(p);
      proj.push(project(p));
    }
  }
  const quads = [];
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i0 = iz * (nx + 1) + ix;
      const a = proj[i0], b = proj[i0 + 1], c = proj[i0 + nx + 2], d = proj[i0 + nx + 1];
      if (!a || !b || !c || !d) continue;
      quads.push({ a, b, c, d, wc: world[i0], z: (a.z + c.z) * 0.5 });
    }
  }
  quads.sort((q1, q2) => q2.z - q1.z);
  for (const q of quads) {
    const wc = q.wc;
    const fog = fogAt(wc, q.z);
    // мягкий диффузный градиент: только крупномасштабные волны, без клетки
    const soft = Math.sin(wc.x * 0.10 + 0.8) * Math.sin(wc.z * 0.13 - 0.5);
    let col = mix3(SAND, SAND_DARK,
      clamp(0.28 - duneY(wc.x, wc.z) * 0.30 - soft * 0.08, 0, 1));
    col = shade(col, fog);
    ctx.fillStyle = css(col);
    ctx.beginPath();
    ctx.moveTo(q.a.x, q.a.y);
    ctx.lineTo(q.b.x, q.b.y);
    ctx.lineTo(q.c.x, q.c.y);
    ctx.lineTo(q.d.x, q.d.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; // прячем швы сетки
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/* ---------- Камни ---------- */
const ROCKS = [];
for (let i = 0; i < 6; i++) {
  ROCKS.push({
    x: rand(-TANK.x + 4, TANK.x - 4),
    z: rand(-TANK.z + 2.5, TANK.z - 2.5),
    r: rand(1.1, 2.6),
    h: rand(0.6, 1.4),
    tint: rnd()
  });
}
function drawRock(r) {
  const base = { x: r.x, y: -TANK.y + duneY(r.x, r.z) + r.h * 0.25, z: r.z };
  const q = project(base);
  if (!q) return;
  const fog = fogAt(base, q.z);
  const col = shade(mix3([84, 90, 100], [60, 74, 70], r.tint), fog);
  const rx = r.r * q.s, ry = r.h * q.s;
  ctx.fillStyle = css(col);
  ctx.beginPath();
  ctx.ellipse(q.x, q.y, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = css(mix3(col, [200, 220, 220], 0.25), 0.8);
  ctx.beginPath();
  ctx.ellipse(q.x - rx * 0.2, q.y - ry * 0.35, rx * 0.55, ry * 0.4, -0.3, 0, TAU);
  ctx.fill();
}

/* ---------- Тени рыб на песке ---------- */
function drawShadows() {
  for (const f of allFish) {
    const gy = -TANK.y + duneY(f.pos.x, f.pos.z) + 0.15;
    const hgt = f.pos.y - gy;
    if (hgt > 16 || hgt < 0) continue;
    const q = project({ x: f.pos.x, y: gy, z: f.pos.z });
    if (!q) continue;
    const a = 0.16 * clamp(1 - hgt / 16, 0, 1);
    const rx = f.len * 0.55 * q.s;
    ctx.fillStyle = `rgba(4,12,18,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(q.x, q.y, rx, rx * 0.32, 0, 0, TAU);
    ctx.fill();
  }
}

/* ---------- Поверхность воды ---------- */
function drawSurface(t) {
  const c = [
    project({ x: -TANK.x, y: TANK.y, z: -TANK.z }),
    project({ x: TANK.x, y: TANK.y, z: -TANK.z }),
    project({ x: TANK.x, y: TANK.y, z: TANK.z }),
    project({ x: -TANK.x, y: TANK.y, z: TANK.z })
  ];
  if (c.some(p => !p)) return;
  ctx.fillStyle = 'rgba(170,225,250,0.06)';
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(190,235,255,0.10)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const zz = -TANK.z + (2 * TANK.z * i) / 4;
    ctx.beginPath();
    let first = true;
    for (let xx = -TANK.x; xx <= TANK.x; xx += 2) {
      const y = TANK.y + Math.sin(xx * 0.5 + t * 1.1 + i) * 0.18;
      const q = project({ x: xx, y, z: zz });
      if (!q) { first = true; continue; }
      if (first) { ctx.moveTo(q.x, q.y); first = false; }
      else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }
}

/* ---------- Объёмные лучи света ---------- */
const RAYS = [];
for (let i = 0; i < 6; i++) {
  RAYS.push({
    x: rand(-TANK.x * 0.8, TANK.x * 0.8),
    z: rand(-TANK.z * 0.9, TANK.z * 0.4),
    w: rand(1.5, 3.5),
    ph: rand(0, TAU),
    sp: rand(0.1, 0.25)
  });
}
function drawRays(t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const r of RAYS) {
    const sway = Math.sin(t * r.sp + r.ph) * 2.5;
    const top = project({ x: r.x, y: TANK.y, z: r.z });
    const bot = project({ x: r.x + sway + 3, y: -TANK.y, z: r.z });
    if (!top || !bot) continue;
    const pulse = 0.55 + 0.45 * Math.sin(t * 0.4 + r.ph * 2);
    const wTop = r.w * top.s, wBot = r.w * 2.6 * bot.s;
    const g = ctx.createLinearGradient(top.x, top.y, bot.x, bot.y);
    g.addColorStop(0, `rgba(150,215,235,${0.13 * pulse})`);
    g.addColorStop(0.75, `rgba(140,205,230,${0.045 * pulse})`);
    g.addColorStop(1, 'rgba(140,205,230,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(top.x - wTop, top.y);
    ctx.lineTo(top.x + wTop, top.y);
    ctx.lineTo(bot.x + wBot, bot.y);
    ctx.lineTo(bot.x - wBot, bot.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* ---------- Рёбра стеклянного объёма ---------- */
const EDGES = (() => {
  const { x, y, z } = TANK;
  const P = (sx, sy, sz) => ({ x: sx * x, y: sy * y, z: sz * z });
  return [
    [P(-1, -1, -1), P(1, -1, -1)], [P(-1, 1, -1), P(1, 1, -1)],
    [P(-1, -1, 1), P(1, -1, 1)], [P(-1, 1, 1), P(1, 1, 1)],
    [P(-1, -1, -1), P(-1, 1, -1)], [P(1, -1, -1), P(1, 1, -1)],
    [P(-1, -1, 1), P(-1, 1, 1)], [P(1, -1, 1), P(1, 1, 1)],
    [P(-1, -1, -1), P(-1, -1, 1)], [P(1, -1, -1), P(1, -1, 1)],
    [P(-1, 1, -1), P(-1, 1, 1)], [P(1, 1, -1), P(1, 1, 1)]
  ];
})();

function drawEdges(pass) {
  const zc0 = camDepth({ x: 0, y: 0, z: 0 });
  ctx.lineWidth = 1;
  for (const [a, b] of EDGES) {
    const mz = camDepth({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
    const back = mz > zc0;
    if ((pass === 'back') !== back) continue;
    const pa = project(a), pb = project(b);
    if (!pa || !pb) continue;
    ctx.strokeStyle = back ? 'rgba(150,215,240,0.10)' : 'rgba(175,225,248,0.20)';
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
}

/* ---------- Виды рыб ---------- */
const SPECIES = {
  neon: {
    len: 1.75, cruise: 3.4, turn: 3.8, school: true,
    hMax: 0.115, wMax: 0.06, waveAmp: 0.09, waveFreq: 8.5,
    tailLen: 0.26, tailSpan: 0.20, dorsal: 0.07,
    back: [56, 84, 108], belly: [212, 226, 232], fin: [180, 210, 225],
    yBias: 2.5
  },
  golden: {
    len: 3.3, cruise: 2.3, turn: 2.2, school: false,
    hMax: 0.185, wMax: 0.105, waveAmp: 0.075, waveFreq: 6.0,
    tailLen: 0.34, tailSpan: 0.30, dorsal: 0.16,
    back: [196, 92, 26], belly: [255, 208, 138], fin: [255, 150, 60],
    yBias: -4
  },
  angel: {
    len: 3.6, cruise: 1.55, turn: 1.6, school: false,
    hMax: 0.30, wMax: 0.055, waveAmp: 0.05, waveFreq: 4.6,
    tailLen: 0.30, tailSpan: 0.26, dorsal: 0.42,
    back: [148, 168, 184], belly: [226, 236, 242], fin: [190, 210, 222],
    yBias: 0.5
  }
};

let fishSeed = 1;

class Fish {
  constructor(sp) {
    this.sp = sp;
    this.size = rand(0.85, 1.18);
    this.len = sp.len * this.size;
    this.pos = {
      x: rand(-TANK.x + 6, TANK.x - 6),
      y: rand(-TANK.y + 5, TANK.y - 5),
      z: rand(-TANK.z + 5, TANK.z - 5)
    };
    const a = rand(0, TAU);
    this.h = { x: Math.cos(a), y: 0, z: Math.sin(a) };
    this.phase = rand(0, TAU);
    this.seed = (fishSeed += 1.618);
    this.roll = 0;
    this.speed = sp.cruise;
  }

  update(dt, t, flock) {
    const sp = this.sp;

    // блуждающая 3D-траектория
    const wx = Math.sin(t * 0.33 + this.seed * 2.1) + Math.sin(t * 0.71 + this.seed) * 0.5;
    const wy = Math.sin(t * 0.27 + this.seed * 3.7) * 0.55;
    const wz = Math.cos(t * 0.29 + this.seed * 1.3) + Math.cos(t * 0.63 + this.seed * 2.9) * 0.5;
    let des = vadd(vmul(this.h, 2.2), { x: wx * 0.6, y: wy, z: wz * 0.6 });

    // разворот у стеклянных стенок
    const bx = TANK.x - 0.8 - this.len * 0.5;
    const by = TANK.y - 1.0 - this.len * 0.35;
    const bz = TANK.z - 0.8 - this.len * 0.5;
    const m = 4.5;
    const push = (v, lim) => {
      if (v > lim - m) return -Math.pow((v - (lim - m)) / m, 2) * 5;
      if (v < -lim + m) return Math.pow((-lim + m - v) / m, 2) * 5;
      return 0;
    };
    des.x += push(this.pos.x, bx);
    des.y += push(this.pos.y, by) + (sp.yBias - this.pos.y) * 0.02;
    des.z += push(this.pos.z, bz);

    // стайное поведение мелких
    if (flock) {
      const toA = vsub(flock.anchor, this.pos);
      des = vadd(des, vmul(vnorm(toA), Math.min(1.4, vlen(toA) * 0.08)));
      const toC = vsub(flock.center, this.pos);
      des = vadd(des, vmul(toC, 0.10));
      des = vadd(des, vmul(flock.heading, 0.9));
      for (const o of flock.members) {
        if (o === this) continue;
        const dx = this.pos.x - o.pos.x, dy = this.pos.y - o.pos.y, dz = this.pos.z - o.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1.7 && d2 > 1e-6) {
          const k2 = 0.55 / d2;
          des.x += dx * k2; des.y += dy * k2; des.z += dz * k2;
        }
      }
    }

    des = vnorm(des);
    des.y = clamp(des.y, -0.55, 0.55);
    des = vnorm(des);

    const prev = this.h;
    const k = Math.min(1, sp.turn * dt);
    this.h = vnorm({
      x: prev.x + (des.x - prev.x) * k,
      y: prev.y + (des.y - prev.y) * k,
      z: prev.z + (des.z - prev.z) * k
    });

    // крен корпуса в повороте
    const side = vnorm({ x: this.h.z, y: 0, z: -this.h.x });
    const turnLat = vdot(vsub(this.h, prev), side) / Math.max(dt, 1e-4);
    const rollT = clamp(-turnLat * 0.55, -0.7, 0.7);
    this.roll += (rollT - this.roll) * Math.min(1, 4 * dt);

    this.speed = sp.cruise * this.size * (0.78 + 0.28 * (Math.sin(t * 0.5 + this.seed * 1.9) * 0.5 + 0.5));
    this.pos = vadd(this.pos, vmul(this.h, this.speed * dt));
    this.pos.x = clamp(this.pos.x, -bx, bx);
    this.pos.y = clamp(this.pos.y, -by, by);
    this.pos.z = clamp(this.pos.z, -bz, bz);

    this.phase += dt * sp.waveFreq * (0.5 + 0.7 * this.speed / (sp.cruise * this.size));
  }

  draw() {
    const sp = this.sp, L = this.len, h = this.h;
    const s = vnorm({ x: h.z, y: 0, z: -h.x });
    const u = vnorm(vadd(vcross(h, s), vmul(s, this.roll)));

    // хребет: 3D-точки с бегущей волной, проекция
    const N = 9;
    const pts = [], q = [], top = [], hw = [], hhArr = [];
    for (let i = 0; i < N; i++) {
      const tt = i / (N - 1);
      const along = (0.46 - tt) * L;
      const wave = Math.sin(this.phase - tt * 3.8) * L * sp.waveAmp * (0.22 + 0.78 * tt);
      const hh = L * sp.hMax * Math.sin(Math.PI * Math.pow(tt, 0.72)) + L * 0.008;
      const ww = L * sp.wMax * Math.sin(Math.PI * Math.pow(tt, 0.8)) + L * 0.006;
      const P = {
        x: this.pos.x + h.x * along + s.x * wave,
        y: this.pos.y + h.y * along + s.y * wave,
        z: this.pos.z + h.z * along + s.z * wave
      };
      const pq = project(P);
      if (!pq) return;
      const pu = project({ x: P.x + u.x * hh, y: P.y + u.y * hh, z: P.z + u.z * hh });
      const ps = project({ x: P.x + s.x * ww, y: P.y + s.y * ww, z: P.z + s.z * ww });
      if (!pu || !ps) return;
      pts.push(P); q.push(pq); top.push(pu); hhArr.push(hh);
      const a = Math.hypot(pu.x - pq.x, pu.y - pq.y);
      const b = Math.hypot(ps.x - pq.x, ps.y - pq.y);
      hw.push(Math.max(a, b * 0.6, 0.5));
    }

    const fog = fogAt(this.pos, q[4].z);
    const bodyA = clamp(1.25 - fog.f, 0.35, 1);
    const finCol = css(shade(sp.fin, fog), 0.6 * bodyA);
    const camSide = Math.sign(vdot(s, vsub(cam.pos, this.pos))) || 1;

    // рыба почти вдоль оси взгляда — честный «анфас» с укорочением
    const spanScreen = Math.hypot(q[N - 1].x - q[0].x, q[N - 1].y - q[0].y);
    if (spanScreen < hw[3] * 1.15) {
      const cq = q[2];
      const rw = Math.max(1, L * sp.wMax * cq.s * 1.15);
      const rh = Math.max(1.2, L * sp.hMax * cq.s * 1.05);
      ctx.fillStyle = css(shade(mix3(sp.back, sp.belly, 0.45), fog), bodyA);
      ctx.beginPath();
      ctx.ellipse(cq.x, cq.y, rw, rh, this.roll * 0.5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = css(shade(sp.belly, fog), 0.3 * bodyA);
      ctx.lineWidth = 1;
      ctx.stroke();
      if (vdot(h, cam.fwd) < 0) {
        const er = Math.max(0.5, rw * 0.22);
        ctx.fillStyle = css([12, 16, 20], 0.9 * bodyA);
        for (const e of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(cq.x + e * rw * 0.45, cq.y - rh * 0.1, er, 0, TAU);
          ctx.fill();
        }
      }
      return;
    }

    // экранные нормали к хребту, ориентированные к «спине»
    const nx = [], ny = [];
    for (let i = 0; i < N; i++) {
      const p0 = q[Math.max(0, i - 1)], p1 = q[Math.min(N - 1, i + 1)];
      let dx = p1.x - p0.x, dy = p1.y - p0.y;
      const dl = Math.hypot(dx, dy);
      if (dl < 1e-3) { dx = 1; dy = 0; } else { dx /= dl; dy /= dl; }
      let px = -dy, py = dx;
      if ((top[i].x - q[i].x) * px + (top[i].y - q[i].y) * py < 0) { px = -px; py = -py; }
      nx.push(px); ny.push(py);
    }

    const off = (P, ah, as, au) => project({
      x: P.x + h.x * ah + s.x * as + u.x * au,
      y: P.y + h.y * ah + s.y * as + u.y * au,
      z: P.z + h.z * ah + s.z * as + u.z * au
    });

    // хвостовой плавник
    const tailP = pts[N - 1];
    const wag = Math.sin(this.phase - 4.1);
    const tl = sp.tailLen * L, tsp = sp.tailSpan * L;
    const tU = off(tailP, -tl, wag * tl * 0.55, tsp);
    const tD = off(tailP, -tl, wag * tl * 0.55, -tsp);
    const tM = off(tailP, -tl * 0.45, wag * tl * 0.3, 0);
    if (tU && tD && tM) {
      ctx.fillStyle = finCol;
      ctx.beginPath();
      ctx.moveTo(q[N - 1].x, q[N - 1].y);
      ctx.lineTo(tU.x, tU.y);
      ctx.quadraticCurveTo(tM.x, tM.y, tD.x, tD.y);
      ctx.closePath();
      ctx.fill();
    }

    // спинной плавник
    const dH = sp.dorsal * L;
    const sway = Math.sin(this.phase * 0.8 + 1.3) * 0.3;
    const dTop = off(pts[3], -L * 0.05, sway * dH * 0.4, hhArr[3] + dH);
    if (dTop) {
      ctx.fillStyle = finCol;
      ctx.beginPath();
      ctx.moveTo(q[1].x + nx[1] * hw[1] * 0.8, q[1].y + ny[1] * hw[1] * 0.8);
      ctx.lineTo(dTop.x, dTop.y);
      ctx.lineTo(q[5].x + nx[5] * hw[5] * 0.8, q[5].y + ny[5] * hw[5] * 0.8);
      ctx.closePath();
      ctx.fill();
    }

    // у скалярии — анальный плавник и брюшные нити
    if (sp === SPECIES.angel) {
      const aTop = off(pts[4], -L * 0.08, sway * dH * 0.3, -(hhArr[4] + dH * 0.9));
      if (aTop) {
        ctx.fillStyle = finCol;
        ctx.beginPath();
        ctx.moveTo(q[2].x - nx[2] * hw[2] * 0.8, q[2].y - ny[2] * hw[2] * 0.8);
        ctx.lineTo(aTop.x, aTop.y);
        ctx.lineTo(q[6].x - nx[6] * hw[6] * 0.8, q[6].y - ny[6] * hw[6] * 0.8);
        ctx.closePath();
        ctx.fill();
      }
      const vTip = off(pts[2], -L * 0.02, Math.sin(this.phase * 0.7 + 2) * L * 0.06, -(hhArr[2] + L * 0.55));
      if (vTip) {
        ctx.strokeStyle = css(shade(sp.fin, fog), 0.5 * bodyA);
        ctx.lineWidth = Math.max(0.6, hw[2] * 0.10);
        ctx.beginPath();
        ctx.moveTo(q[2].x - nx[2] * hw[2] * 0.9, q[2].y - ny[2] * hw[2] * 0.9);
        ctx.lineTo(vTip.x, vTip.y);
        ctx.stroke();
      }
    }

    // грудные плавники: дальний до тела, ближний после
    const flap = Math.sin(this.phase * 1.35 + this.seed);
    const pectoral = (e) => {
      const base = off(pts[2], 0, e * L * sp.wMax * 0.8, -hhArr[2] * 0.25);
      const tip = off(pts[2], -L * (0.14 + 0.05 * flap), e * L * (sp.wMax * 0.8 + 0.13), -hhArr[2] * 0.25 - L * 0.10);
      const bk = off(pts[2], -L * 0.10, e * L * sp.wMax * 0.8, -hhArr[2] * 0.25);
      if (!base || !tip || !bk) return;
      ctx.fillStyle = css(shade(sp.fin, fog), 0.5 * bodyA);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(bk.x, bk.y);
      ctx.closePath();
      ctx.fill();
    };
    pectoral(-camSide);

    // тело
    ctx.beginPath();
    ctx.moveTo(q[0].x + nx[0] * hw[0], q[0].y + ny[0] * hw[0]);
    for (let i = 1; i < N; i++) ctx.lineTo(q[i].x + nx[i] * hw[i], q[i].y + ny[i] * hw[i]);
    for (let i = N - 1; i >= 0; i--) ctx.lineTo(q[i].x - nx[i] * hw[i], q[i].y - ny[i] * hw[i]);
    ctx.closePath();
    const gx0 = q[3].x + nx[3] * hw[3], gy0 = q[3].y + ny[3] * hw[3];
    const gx1 = q[3].x - nx[3] * hw[3], gy1 = q[3].y - ny[3] * hw[3];
    const gdx = gx1 - gx0, gdy = gy1 - gy0;
    if (gdx * gdx + gdy * gdy > 0.4) {
      const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      grad.addColorStop(0, css(shade(sp.back, fog), bodyA));
      grad.addColorStop(0.52, css(shade(mix3(sp.back, sp.belly, 0.5), fog), bodyA));
      grad.addColorStop(1, css(shade(sp.belly, fog), bodyA));
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = css(shade(mix3(sp.back, sp.belly, 0.5), fog), bodyA);
    }
    ctx.fill();
    ctx.strokeStyle = css(mix3(shade(sp.belly, fog), [200, 235, 250], 0.4), 0.25 * bodyA);
    ctx.lineWidth = Math.max(0.6, hw[3] * 0.08);
    ctx.stroke();

    // видовые метки
    if (sp === SPECIES.neon) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = css([80, 225, 255], 0.85 * bodyA);
      ctx.lineWidth = Math.max(0.7, hw[3] * 0.42);
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      for (let i = 1; i <= 5; i++) ctx.lineTo(q[i].x - nx[i] * hw[i] * 0.1, q[i].y - ny[i] * hw[i] * 0.1);
      ctx.stroke();
      ctx.strokeStyle = css([255, 74, 84], 0.8 * bodyA);
      ctx.lineWidth = Math.max(0.7, hw[4] * 0.5);
      ctx.beginPath();
      ctx.moveTo(q[4].x - nx[4] * hw[4] * 0.35, q[4].y - ny[4] * hw[4] * 0.35);
      for (let i = 5; i < N; i++) ctx.lineTo(q[i].x - nx[i] * hw[i] * 0.35, q[i].y - ny[i] * hw[i] * 0.35);
      ctx.stroke();
      ctx.lineCap = 'butt';
    } else if (sp === SPECIES.angel) {
      ctx.strokeStyle = css(shade([52, 62, 74], fog), 0.5 * bodyA);
      for (const i of [2, 4, 6]) {
        ctx.lineWidth = Math.max(0.8, hw[i] * 0.22);
        ctx.beginPath();
        ctx.moveTo(q[i].x + nx[i] * hw[i] * 0.9, q[i].y + ny[i] * hw[i] * 0.9);
        ctx.lineTo(q[i].x - nx[i] * hw[i] * 0.9, q[i].y - ny[i] * hw[i] * 0.9);
        ctx.stroke();
      }
    } else if (sp === SPECIES.golden) {
      ctx.strokeStyle = css(shade([150, 60, 16], fog), 0.35 * bodyA);
      ctx.lineWidth = Math.max(0.7, hw[2] * 0.15);
      ctx.beginPath();
      ctx.moveTo(q[1].x + nx[1] * hw[1] * 0.8, q[1].y + ny[1] * hw[1] * 0.8);
      ctx.quadraticCurveTo(q[2].x, q[2].y, q[1].x - nx[1] * hw[1] * 0.8, q[1].y - ny[1] * hw[1] * 0.8);
      ctx.stroke();
    }

    pectoral(camSide);

    // глаз на стороне камеры
    const eyeP = off(pts[1], L * 0.10, camSide * L * sp.wMax * 0.55, L * sp.hMax * 0.25);
    if (eyeP) {
      const er = Math.max(0.5, L * 0.042 * eyeP.s);
      ctx.fillStyle = css([12, 16, 20], 0.9 * bodyA);
      ctx.beginPath();
      ctx.arc(eyeP.x, eyeP.y, er, 0, TAU);
      ctx.fill();
      ctx.fillStyle = css([225, 240, 250], 0.8 * bodyA);
      ctx.beginPath();
      ctx.arc(eyeP.x - er * 0.3, eyeP.y - er * 0.3, er * 0.35, 0, TAU);
      ctx.fill();
    }
  }
}

/* ---------- Стая: центр, курс, блуждающий якорь ---------- */
function flockInfo(members, t) {
  const c = { x: 0, y: 0, z: 0 }, hd = { x: 0, y: 0, z: 0 };
  for (const f of members) {
    c.x += f.pos.x; c.y += f.pos.y; c.z += f.pos.z;
    hd.x += f.h.x; hd.y += f.h.y; hd.z += f.h.z;
  }
  const n = Math.max(1, members.length);
  return {
    members,
    center: vmul(c, 1 / n),
    heading: vnorm(hd),
    anchor: {
      x: Math.sin(t * 0.075 + 1.0) * TANK.x * 0.55,
      y: Math.sin(t * 0.055 + 4.0) * TANK.y * 0.42 + 2,
      z: Math.sin(t * 0.065 + 2.2) * TANK.z * 0.5
    }
  };
}

/* ---------- Пузырьки ---------- */
const EMITTERS = [{ x: -13, z: -5 }, { x: 7, z: 8 }, { x: 16, z: -9 }];
const bubbles = [];
for (let i = 0; i < 45; i++) {
  const e = EMITTERS[i % EMITTERS.length];
  bubbles.push({
    ex: e.x, ez: e.z,
    x: e.x, z: e.z,
    y: rand(-TANK.y + 0.6, TANK.y - 0.4),
    r: rand(0.06, 0.18),
    ph: rand(0, TAU),
    ox: rand(-0.7, 0.7), oz: rand(-0.7, 0.7)
  });
}
function updateBubbles(dt, t) {
  for (const b of bubbles) {
    b.y += (2.0 + b.r * 10) * dt;
    if (b.y > TANK.y - 0.3) {
      b.y = -TANK.y + 0.6;
      b.ox = rand(-0.7, 0.7);
      b.oz = rand(-0.7, 0.7);
      b.r = rand(0.06, 0.18);
    }
    const rise = (b.y + TANK.y) / (2 * TANK.y);
    b.x = b.ex + b.ox + Math.sin(t * 2.1 + b.ph) * (0.15 + rise * 0.55);
    b.z = b.ez + b.oz + Math.cos(t * 1.7 + b.ph * 1.3) * (0.1 + rise * 0.4);
  }
}
function drawBubble(b) {
  const q = project(b);
  if (!q) return;
  const r = Math.max(0.4, b.r * q.s);
  const fog = fogAt(b, q.z);
  const a = (1 - fog.f) * 0.9;
  ctx.strokeStyle = css([205, 240, 255], 0.55 * a);
  ctx.lineWidth = Math.max(0.5, r * 0.22);
  ctx.beginPath();
  ctx.arc(q.x, q.y, r, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = css([170, 220, 245], 0.10 * a);
  ctx.beginPath();
  ctx.arc(q.x, q.y, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = css([240, 252, 255], 0.75 * a);
  ctx.beginPath();
  ctx.arc(q.x - r * 0.35, q.y - r * 0.38, r * 0.22, 0, TAU);
  ctx.fill();
}

/* ---------- Водоросли ---------- */
const PLANT_SPOTS = [
  { x: -19, z: -10 }, { x: -15.5, z: -11.5 }, { x: 20, z: -8.5 }, { x: 17.5, z: -11 },
  { x: -20, z: 6.5 }, { x: 20.5, z: 8 }, { x: 2, z: -12.4 }, { x: -6, z: 11.5 }
];
const blades = [];
for (const ps of PLANT_SPOTS) {
  const nb = 3 + (rnd() * 3 | 0);
  for (let i = 0; i < nb; i++) {
    blades.push({
      x: ps.x + rand(-1.2, 1.2),
      z: ps.z + rand(-0.8, 0.8),
      h: rand(6.5, 12.5),
      segs: 7,
      ph: rand(0, TAU),
      swayAmp: rand(0.10, 0.20),
      swaySp: rand(0.5, 0.9),
      lean: { x: rand(-0.16, 0.16), z: rand(-0.16, 0.16) },
      w: rand(0.30, 0.55),
      col: mix3([26, 92, 58], [70, 140, 60], rnd())
    });
  }
}
function drawBlade(b, t) {
  let p = { x: b.x, y: -TANK.y + duneY(b.x, b.z), z: b.z };
  const step = b.h / b.segs;
  let prevQ = project(p);
  if (!prevQ) return;
  const fog0 = fogAt(p, prevQ.z);
  ctx.lineCap = 'round';
  for (let i = 1; i <= b.segs; i++) {
    const k = i / b.segs;
    const ang = Math.sin(t * b.swaySp + b.ph + i * 0.6) * b.swayAmp * (0.25 + k);
    const dir = vnorm({ x: b.lean.x + ang, y: 1, z: b.lean.z + ang * 0.6 });
    p = vadd(p, vmul(dir, step));
    const q2 = project(p);
    if (!q2) break;
    const colK = mix3(b.col, [120, 190, 110], k * 0.55);
    ctx.strokeStyle = css(shade(colK, fog0), 0.92);
    ctx.lineWidth = Math.max(0.6, b.w * (1 - k * 0.8) * q2.s);
    ctx.beginPath();
    ctx.moveTo(prevQ.x, prevQ.y);
    ctx.lineTo(q2.x, q2.y);
    ctx.stroke();
    prevQ = q2;
  }
  ctx.lineCap = 'butt';
}

/* ---------- Взвесь в толще воды ---------- */
const motes = [];
for (let i = 0; i < 70; i++) {
  motes.push({
    x: rand(-TANK.x + 1, TANK.x - 1),
    y: rand(-TANK.y + 1, TANK.y - 1),
    z: rand(-TANK.z + 1, TANK.z - 1),
    ph: rand(0, TAU)
  });
}
function updateMotes(dt, t) {
  for (const m of motes) {
    m.x += Math.sin(t * 0.30 + m.ph) * dt * 0.4;
    m.y += Math.sin(t * 0.17 + m.ph * 2.1) * dt * 0.35;
    m.z += Math.cos(t * 0.23 + m.ph * 1.4) * dt * 0.3;
    if (m.x > TANK.x - 0.5) m.x = -TANK.x + 0.5;
    if (m.x < -TANK.x + 0.5) m.x = TANK.x - 0.5;
    if (m.y > TANK.y - 0.5) m.y = -TANK.y + 0.5;
    if (m.y < -TANK.y + 0.5) m.y = TANK.y - 0.5;
    if (m.z > TANK.z - 0.5) m.z = -TANK.z + 0.5;
    if (m.z < -TANK.z + 0.5) m.z = TANK.z - 0.5;
  }
}
function drawMote(m) {
  const q = project(m);
  if (!q) return;
  const fog = fogAt(m, q.z);
  ctx.fillStyle = css([190, 225, 240], 0.35 * (1 - fog.f));
  ctx.beginPath();
  ctx.arc(q.x, q.y, Math.max(0.4, 0.045 * q.s), 0, TAU);
  ctx.fill();
}

/* ---------- Блики стекла и виньетка ---------- */
function drawGlass(t) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const drift = Math.sin(t * 0.09) * W * 0.02;
  streak(W * 0.16 + drift, W * 0.30 + drift, 0.045);
  streak(W * 0.62 - drift, W * 0.70 - drift, 0.028);
  ctx.restore();

  function streak(x0, x1, a) {
    const g = ctx.createLinearGradient(x0, 0, x1, H);
    g.addColorStop(0, `rgba(205,235,255,${a})`);
    g.addColorStop(0.45, `rgba(205,235,255,${a * 0.35})`);
    g.addColorStop(1, 'rgba(205,235,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x1, 0);
    ctx.lineTo(x1 - W * 0.20, H);
    ctx.lineTo(x0 - W * 0.20, H);
    ctx.closePath();
    ctx.fill();
  }
}

function drawVignette() {
  const g = ctx.createRadialGradient(
    W / 2, H * 0.46, Math.min(W, H) * 0.36,
    W / 2, H * 0.52, Math.max(W, H) * 0.75
  );
  g.addColorStop(0, 'rgba(2,10,18,0)');
  g.addColorStop(1, 'rgba(2,10,18,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* ---------- Популяция ---------- */
const school = [], goldens = [], angels = [];
let allFish = [];

function adjustGroup(arr, want, make) {
  while (arr.length > want) arr.pop();
  while (arr.length < want) arr.push(make());
}
function setPopulation(n) {
  const wn = Math.max(3, Math.round(n * 0.58));
  const wg = Math.max(2, Math.round(n * 0.26));
  const wa = Math.max(1, n - wn - wg);
  adjustGroup(school, wn, () => new Fish(SPECIES.neon));
  adjustGroup(goldens, wg, () => new Fish(SPECIES.golden));
  adjustGroup(angels, wa, () => new Fish(SPECIES.angel));
  allFish = school.concat(goldens, angels);
}
setPopulation(17);

/* ---------- UI ---------- */
const ui = { pause: false, speed: 1, orbit: true };
const btnPause = document.getElementById('btnPause');
btnPause.addEventListener('click', () => {
  ui.pause = !ui.pause;
  btnPause.textContent = ui.pause ? '▶ Продолжить' : '⏸ Пауза';
});
document.getElementById('speed').addEventListener('input', e => {
  ui.speed = e.target.value / 100;
});
document.getElementById('orbit').addEventListener('change', e => {
  ui.orbit = e.target.checked;
});
const fcLabel = document.getElementById('fishCountLabel');
document.getElementById('fishCount').addEventListener('input', e => {
  const n = +e.target.value;
  fcLabel.textContent = n;
  setPopulation(n);
});

/* ---------- Кадр ---------- */
function render(t) {
  drawBackground(t);
  drawEdges('back');
  drawFloor(t);
  drawCaustics(t);
  drawShadows();
  drawSurface(t);
  drawRays(t);

  // алгоритм художника: единая сортировка по дальности
  const items = [];
  for (const f of allFish) {
    const zc = camDepth(f.pos);
    if (zc > NEAR) items.push({ z: zc, draw: () => f.draw() });
  }
  for (const b of bubbles) {
    const zc = camDepth(b);
    if (zc > NEAR) items.push({ z: zc, draw: () => drawBubble(b) });
  }
  for (const bl of blades) {
    const zc = camDepth({ x: bl.x, y: 0, z: bl.z });
    if (zc > NEAR) items.push({ z: zc, draw: () => drawBlade(bl, t) });
  }
  for (const r of ROCKS) {
    const zc = camDepth({ x: r.x, y: -TANK.y, z: r.z });
    if (zc > NEAR) items.push({ z: zc + 0.6, draw: () => drawRock(r) });
  }
  for (const m of motes) {
    const zc = camDepth(m);
    if (zc > NEAR) items.push({ z: zc, draw: () => drawMote(m) });
  }
  items.sort((a, b) => b.z - a.z);
  for (const it of items) it.draw();

  drawEdges('front');
  drawGlass(t);
  drawVignette();
}

let last = performance.now();
let simT = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (ui.pause) dt = 0;
  dt *= ui.speed;
  simT += dt;

  updateCamera(simT, dt, ui.orbit);
  const flock = flockInfo(school, simT);
  for (const f of school) f.update(dt, simT, flock);
  for (const f of goldens) f.update(dt, simT, null);
  for (const f of angels) f.update(dt, simT, null);
  updateBubbles(dt, simT);
  updateMotes(dt, simT);

  render(simT);
}
requestAnimationFrame(frame);

})();
