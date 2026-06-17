'use strict';
/*
  «3D-аквариум» — Opus 4.8
  Честный 3D на 2D-canvas: мир в трёхмерных координатах, ручная перспективная
  проекция, painter-сортировка по глубине, дымка/туман воды. Рыбы — вертикально
  вытянутые 3D-ленты вдоль изгибающегося хребта: при развороте к камере хребет
  укорачивается в проекции, и силуэт честно «сжимается».
*/

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d', { alpha: false });

// ── Мир ────────────────────────────────────────────────────────────────────
// Правая система: x — вправо, y — вверх, z — от наблюдателя вглубь.
// Центр аквариума в начале координат.
const TANK = { w: 130, h: 76, d: 96 };       // полные размеры объёма
const HX = TANK.w / 2, HY = TANK.h / 2, HZ = TANK.d / 2;

const WATER_TOP = [38, 120, 150];            // цвет у поверхности
const WATER_DEEP = [4, 26, 52];              // цвет в глубине/тумане
const FOG_NEAR = 70, FOG_FAR = 320;          // диапазон тумана по camera-z

// ── Камера ───────────────────────────────────────────────────────────────────
const cam = { dist: 196, yaw: 0, pitch: -0.10, f: 1 };
let cx = 0, cy = 0;                            // центр экрана (CSS-пиксели)
let camWorld = { x: 0, y: 0, z: -196 };        // позиция камеры в мире (для бликов/глаза)

// Поворот направления world→camera (две оси), без сдвига.
function rotToCam(p) {
  const ca = Math.cos(cam.yaw), sa = Math.sin(cam.yaw);
  const x1 = p.x * ca + p.z * sa;
  const z1 = -p.x * sa + p.z * ca;
  const cb = Math.cos(cam.pitch), sb = Math.sin(cam.pitch);
  const y2 = p.y * cb - z1 * sb;
  const z2 = p.y * sb + z1 * cb;
  return { x: x1, y: y2, z: z2 };
}
// Полное преобразование world→camera (поворот + отодвигание на dist).
function toCam(p) {
  const r = rotToCam(p);
  r.z += cam.dist;
  return r;
}
// camera→screen. Возвращает null, если за ближней плоскостью.
function project(p) {
  const c = toCam(p);
  if (c.z <= 1) return null;
  const s = cam.f / c.z;
  return { x: cx + c.x * s, y: cy - c.y * s, z: c.z, s };
}
function camWorldPos() {
  // Инверсия поворота для точки (0,0,-dist) в camera-space.
  const cb = Math.cos(cam.pitch), sb = Math.sin(cam.pitch);
  const y1 = 0, z0 = -cam.dist;
  const yb = y1 * cb + z0 * sb;          // R_x^{-1}
  const zb = -y1 * sb + z0 * cb;
  const ca = Math.cos(cam.yaw), sa = Math.sin(cam.yaw);
  const x = 0 * ca - zb * sa;            // R_y^{-1}
  const z = 0 * sa + zb * ca;
  return { x, y: yb, z };
}

// ── Утилиты ──────────────────────────────────────────────────────────────────
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function fog(z) { return clamp((z - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1); }
function mixRGB(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function css(rgb, a) {
  return 'rgba(' + (rgb[0] | 0) + ',' + (rgb[1] | 0) + ',' + (rgb[2] | 0) + ',' + (a == null ? 1 : a) + ')';
}
// Цвет с учётом дымки: к глубине уходит в WATER_DEEP.
function fogged(rgb, z, max) {
  return mixRGB(rgb, WATER_DEEP, fog(z) * (max == null ? 0.85 : max));
}
const rnd = (a, b) => a + Math.random() * (b - a);

// ── Виды рыб ─────────────────────────────────────────────────────────────────
// wr — ширина тела относительно высоты (объём; рыбы латерально сжаты, wr<1)
const SPECIES = [
  { name: 'tetra',  len: 7,  hr: 0.36, wr: 0.52, top: [60, 150, 215], belly: [205, 235, 255],
    fin: [150, 215, 255], school: true,  neon: [80, 245, 255], speed: 19 },
  { name: 'goldfish', len: 16, hr: 0.52, wr: 0.64, top: [255, 120, 28], belly: [255, 214, 150],
    fin: [255, 150, 60], school: false, speed: 12 },
  { name: 'angel',  len: 13, hr: 1.02, wr: 0.34, top: [228, 238, 246], belly: [248, 250, 252],
    fin: [240, 235, 215], school: false, speed: 9,  stripes: 4 },
  { name: 'koi',    len: 23, hr: 0.5,  wr: 0.6,  top: [248, 248, 246], belly: [255, 252, 248],
    fin: [255, 248, 240], school: false, speed: 11, patch: [240, 90, 30] },
  { name: 'guppy',  len: 6,  hr: 0.5,  wr: 0.54, top: [120, 110, 230], belly: [225, 180, 255],
    fin: [255, 130, 90], school: true,  speed: 16 },
];

// направление света в мире (сверху, чуть к камере)
const LIGHT = (function () { const m = Math.hypot(0.2, 1, -0.32); return { x: 0.2 / m, y: 1 / m, z: -0.32 / m }; })();

// ── Рыба ─────────────────────────────────────────────────────────────────────
const fishes = [];
const schoolHubs = {};   // общий блуждающий центр для стайных видов

function makeHub(name) {
  return {
    p: { x: rnd(-HX * 0.5, HX * 0.5), y: rnd(-HY * 0.4, HY * 0.5), z: rnd(-HZ * 0.5, HZ * 0.5) },
    v: { x: rnd(-1, 1), y: rnd(-0.3, 0.3), z: rnd(-1, 1) },
    ph: rnd(0, 9),
  };
}

function spawnFish(sp) {
  const scale = rnd(0.8, 1.25);
  return {
    sp,
    len: sp.len * scale,
    h: sp.len * sp.hr * scale,
    w: sp.len * sp.hr * sp.wr * scale,
    p: { x: rnd(-HX * 0.7, HX * 0.7), y: rnd(-HY * 0.6, HY * 0.7), z: rnd(-HZ * 0.7, HZ * 0.7) },
    v: { x: rnd(-1, 1), y: rnd(-0.25, 0.25), z: rnd(-1, 1) },
    speed: sp.speed * rnd(0.85, 1.15),
    bodyPh: rnd(0, 9),
    finPh: rnd(0, 9),
    wph: rnd(0, 100),       // фаза блуждания
    side: { x: 1, y: 0, z: 0 },
  };
}

function rebuildFish(n) {
  fishes.length = 0;
  for (const k in schoolHubs) delete schoolHubs[k];
  // распределяем по видам
  for (let i = 0; i < n; i++) {
    let sp;
    const r = i / n;
    if (r < 0.42) sp = SPECIES[0];           // много тетр (стая)
    else if (r < 0.58) sp = SPECIES[4];      // гуппи (стая)
    else if (r < 0.74) sp = SPECIES[1];      // золотые
    else if (r < 0.9) sp = SPECIES[2];       // ангелы
    else sp = SPECIES[3];                    // кои (крупные, мало)
    if (sp.school && !schoolHubs[sp.name]) schoolHubs[sp.name] = makeHub(sp.name);
    fishes.push(spawnFish(sp));
  }
}

function norm(v) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function updateHubs(dt, t) {
  for (const k in schoolHubs) {
    const h = schoolHubs[k];
    // плавно меняем курс центра стаи
    h.v.x += (Math.sin(t * 0.31 + h.ph) ) * dt * 0.6;
    h.v.y += (Math.sin(t * 0.17 + h.ph * 1.7)) * dt * 0.25;
    h.v.z += (Math.cos(t * 0.27 + h.ph * 0.6)) * dt * 0.6;
    const n = norm(h.v);
    const sp = 16;
    h.p.x += n.x * sp * dt; h.p.y += n.y * sp * dt; h.p.z += n.z * sp * dt;
    // удержание внутри
    if (h.p.x < -HX * 0.6) h.v.x += 4 * dt; if (h.p.x > HX * 0.6) h.v.x -= 4 * dt;
    if (h.p.y < -HY * 0.4) h.v.y += 3 * dt; if (h.p.y > HY * 0.6) h.v.y -= 3 * dt;
    if (h.p.z < -HZ * 0.6) h.v.z += 4 * dt; if (h.p.z > HZ * 0.6) h.v.z -= 4 * dt;
    const m = Math.hypot(h.v.x, h.v.y, h.v.z) || 1;
    if (m > 1.6) { h.v.x *= 1.6 / m; h.v.y *= 1.6 / m; h.v.z *= 1.6 / m; }
  }
}

function steerFish(f, dt, t) {
  const sp = f.sp;
  const desired = { x: 0, y: 0, z: 0 };

  // блуждание: мягко колеблющееся желаемое направление
  f.wph += dt;
  desired.x += Math.sin(f.wph * 0.6 + f.p.z * 0.02);
  desired.y += Math.sin(f.wph * 0.4 + f.p.x * 0.03) * 0.45;
  desired.z += Math.cos(f.wph * 0.55 + f.p.y * 0.02);

  // стайность: тянемся к центру-хабу + лёгкое отделение
  if (sp.school) {
    const h = schoolHubs[sp.name];
    if (h) {
      desired.x += (h.p.x - f.p.x) * 0.05;
      desired.y += (h.p.y - f.p.y) * 0.05;
      desired.z += (h.p.z - f.p.z) * 0.05;
      desired.x += h.v.x * 0.8; desired.y += h.v.y * 0.8; desired.z += h.v.z * 0.8;
    }
  }

  // отталкивание от стенок объёма
  const m = 16;
  if (f.p.x > HX - m) desired.x -= (f.p.x - (HX - m)) * 0.08;
  if (f.p.x < -HX + m) desired.x -= (f.p.x + (HX - m)) * 0.08;
  if (f.p.y > HY - m) desired.y -= (f.p.y - (HY - m)) * 0.10;
  if (f.p.y < -HY + m * 0.7) desired.y -= (f.p.y + (HY - m * 0.7)) * 0.10;
  if (f.p.z > HZ - m) desired.z -= (f.p.z - (HZ - m)) * 0.08;
  if (f.p.z < -HZ + m) desired.z -= (f.p.z + (HZ - m)) * 0.08;

  // ограничим вертикальный наклон, чтобы рыбы не вставали «свечкой»
  const dn = norm(desired);
  dn.y = clamp(dn.y, -0.5, 0.5);

  // плавный доворот скорости к желаемому (инерция)
  const turn = clamp(dt * 1.8, 0, 1);
  f.v.x = lerp(f.v.x, dn.x, turn);
  f.v.y = lerp(f.v.y, dn.y, turn);
  f.v.z = lerp(f.v.z, dn.z, turn);
  const n = norm(f.v);
  f.v = n;

  // позиция
  f.p.x += n.x * f.speed * dt;
  f.p.y += n.y * f.speed * dt;
  f.p.z += n.z * f.speed * dt;

  // жёсткий клапан, чтобы не вылезали за стекло
  f.p.x = clamp(f.p.x, -HX + 4, HX - 4);
  f.p.y = clamp(f.p.y, -HY + 4, HY - 4);
  f.p.z = clamp(f.p.z, -HZ + 4, HZ - 4);

  // фазы взмахов — быстрее при быстром плавании
  const wag = 4 + f.speed * 0.16;
  f.bodyPh += dt * wag;
  f.finPh += dt * (wag * 1.7);

  // ортонормированный кадр рыбы
  const fwd = n;
  let up = { x: 0, y: 1, z: 0 };
  // side = up × fwd
  let side = { x: up.y * fwd.z - up.z * fwd.y, y: up.z * fwd.x - up.x * fwd.z, z: up.x * fwd.y - up.y * fwd.x };
  const sm = Math.hypot(side.x, side.y, side.z) || 1;
  side = { x: side.x / sm, y: side.y / sm, z: side.z / sm };
  f.fwd = fwd; f.side = side; f.up = up;
}

// Профиль половины высоты тела по длине u∈[0..1] (нос→основание хвоста)
function bodyProfile(u) {
  const nose = u < 0.16 ? Math.pow(u / 0.16, 0.7) : 1;     // заострённый нос
  const tail = u > 0.55 ? lerp(1, 0.18, (u - 0.55) / 0.45) : 1; // сужение к хвосту
  return nose * tail;
}

// Тон грани тела: база (контршейдинг брюха) + ламберт + блик + дымка
function bodyShade(sp, topness, lateral, u, diffuse, fg) {
  let base = mixRGB(sp.belly, sp.top, topness);
  // паттерны видов
  if (sp.stripes) {
    const fr = (u * sp.stripes) % 1;
    if (fr < 0.34) base = mixRGB(base, [38, 52, 68], 0.62);
  }
  if (sp.patch) {
    if ((u > 0.12 && u < 0.33) || (u > 0.5 && u < 0.65)) base = mixRGB(base, sp.patch, 0.85);
  }
  if (sp.neon && Math.abs(lateral) > 0.62 && u > 0.18 && u < 0.92) {
    base = mixRGB(base, sp.neon, 0.7);
  }
  const s = 0.4 + 0.82 * diffuse;
  let c = [Math.min(255, base[0] * s), Math.min(255, base[1] * s), Math.min(255, base[2] * s)];
  const spec = Math.max(0, diffuse - 0.72) * 1.5;
  if (spec > 0) c = mixRGB(c, [255, 255, 255], spec * 0.55);
  return mixRGB(c, WATER_DEEP, fg * 0.82);
}

// ── Рендер рыбы — тело как 3D-труба из колец-сечений ─────────────────────────
function drawFish(f) {
  const sp = f.sp, N = 11, K = 9;
  const fgC = toCam(f.p).z;
  const fg = fog(fgC);
  const finCol = fogged(sp.fin, fgC);

  const sideCamZ = rotToCam(f.side).z;
  const camSign = sideCamZ < 0 ? 1 : -1;

  // предрасчёт углов кольца
  const TH = [];
  for (let k = 0; k < K; k++) { const a = (k / K) * Math.PI * 2; TH.push({ ct: Math.cos(a), st: Math.sin(a) }); }

  // строим кольца: центр, полувысота/полуширина, проекции опорных точек, вершины
  const rings = [];
  let ok = true;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const along = (0.5 - u) * f.len;
    const wave = (0.06 + 0.55 * u * u) * f.len * 0.45 * Math.sin(f.bodyPh - u * 3.4);
    const C = {
      x: f.p.x + f.fwd.x * along + f.side.x * wave,
      y: f.p.y + f.fwd.y * along + f.side.y * wave,
      z: f.p.z + f.fwd.z * along + f.side.z * wave,
    };
    const prof = bodyProfile(u);
    const hh = Math.max(0.35, (f.h / 2) * prof);
    const hw = Math.max(0.3, (f.w / 2) * prof);
    const verts = [];
    for (let k = 0; k < K; k++) {
      const { ct, st } = TH[k];
      const V = {
        x: C.x + f.side.x * hw * ct + f.up.x * hh * st,
        y: C.y + f.side.y * hw * ct + f.up.y * hh * st,
        z: C.z + f.side.z * hw * ct + f.up.z * hh * st,
      };
      // нормаль эллипса (радиальная), без учёта продольного наклона
      let nx = f.side.x * (ct / hw) + f.up.x * (st / hh);
      let ny = f.side.y * (ct / hw) + f.up.y * (st / hh);
      let nz = f.side.z * (ct / hw) + f.up.z * (st / hh);
      const nm = Math.hypot(nx, ny, nz) || 1;
      const pr = project(V);
      if (!pr) { ok = false; break; }
      verts.push({ pr, nx: nx / nm, ny: ny / nm, nz: nz / nm });
    }
    if (!ok) break;
    const midP = project(C);
    const topP = project({ x: C.x + f.up.x * hh, y: C.y + f.up.y * hh, z: C.z + f.up.z * hh });
    const botP = project({ x: C.x - f.up.x * hh, y: C.y - f.up.y * hh, z: C.z - f.up.z * hh });
    if (!midP || !topP || !botP) { ok = false; break; }
    rings.push({ u, C, hh, verts, midP, topP, botP });
  }
  if (!ok) return;

  ctx.save();
  ctx.globalAlpha = 1 - fg * 0.35;

  // ── каудальный (хвостовой) плавник — рисуем до тела ──
  {
    const tailWave = 0.61 * f.len * 0.45 * Math.sin(f.bodyPh - 3.4 - 0.6);
    const tailBase = {
      x: f.p.x + f.fwd.x * (-0.5 * f.len) + f.side.x * tailWave,
      y: f.p.y + f.fwd.y * (-0.5 * f.len) + f.side.y * tailWave,
      z: f.p.z + f.fwd.z * (-0.5 * f.len) + f.side.z * tailWave,
    };
    const tlen = f.len * (sp.name === 'guppy' ? 0.6 : 0.42);
    const th = f.h * (sp.name === 'guppy' ? 1.05 : 0.9);
    const tip = {
      x: tailBase.x - f.fwd.x * tlen + f.side.x * tailWave * 0.8,
      y: tailBase.y - f.fwd.y * tlen + f.side.y * tailWave * 0.8,
      z: tailBase.z - f.fwd.z * tlen + f.side.z * tailWave * 0.8,
    };
    const pTipUp = project({ x: tip.x + f.up.x * th, y: tip.y + f.up.y * th, z: tip.z + f.up.z * th });
    const pTipDn = project({ x: tip.x - f.up.x * th, y: tip.y - f.up.y * th, z: tip.z - f.up.z * th });
    const pNotch = project({ x: tip.x + f.fwd.x * tlen * 0.45, y: tip.y + f.fwd.y * tlen * 0.45, z: tip.z + f.fwd.z * tlen * 0.45 });
    const rl = rings[N - 1];
    if (pTipUp && pTipDn && pNotch) {
      ctx.beginPath();
      ctx.moveTo(rl.topP.x, rl.topP.y);
      ctx.lineTo(pTipUp.x, pTipUp.y);
      ctx.lineTo(pNotch.x, pNotch.y);
      ctx.lineTo(pTipDn.x, pTipDn.y);
      ctx.lineTo(rl.botP.x, rl.botP.y);
      ctx.closePath();
      ctx.fillStyle = css(finCol, 0.62);
      ctx.fill();
    }
  }

  // ── дальний грудной плавник (за телом), потом ближний поверх ──
  function pectoral(sign, alpha) {
    const ui = 3;
    const flap = Math.sin(f.finPh) * 0.5 + 0.7;
    const ref = {
      x: f.p.x + f.fwd.x * (0.5 - ui / (N - 1)) * f.len - f.up.x * f.h * 0.1,
      y: f.p.y + f.fwd.y * (0.5 - ui / (N - 1)) * f.len - f.h * 0.12,
      z: f.p.z + f.fwd.z * (0.5 - ui / (N - 1)) * f.len - f.up.z * f.h * 0.1,
    };
    const finVec = {
      x: f.side.x * sign * f.h * 0.75 * flap - f.fwd.x * f.len * 0.16,
      y: f.side.y * sign * f.h * 0.75 * flap - f.fwd.y * f.len * 0.16 - f.up.y * f.h * 0.25,
      z: f.side.z * sign * f.h * 0.75 * flap - f.fwd.z * f.len * 0.16,
    };
    const pFin = project({ x: ref.x + finVec.x, y: ref.y + finVec.y, z: ref.z + finVec.z });
    const pRoot = project(ref);
    const pRoot2 = project({ x: ref.x - f.fwd.x * f.len * 0.13, y: ref.y - f.fwd.y * f.len * 0.13, z: ref.z - f.fwd.z * f.len * 0.13 });
    if (pFin && pRoot && pRoot2) {
      ctx.beginPath();
      ctx.moveTo(pRoot.x, pRoot.y); ctx.lineTo(pFin.x, pFin.y); ctx.lineTo(pRoot2.x, pRoot2.y);
      ctx.closePath();
      ctx.fillStyle = css(finCol, alpha);
      ctx.fill();
    }
  }
  pectoral(-camSign, 0.3);   // дальний

  // ── тело: грани-квады трубы, backface-cull, painter-сортировка ──
  const quads = [];
  for (let i = 0; i < N - 1; i++) {
    const r0 = rings[i], r1 = rings[i + 1];
    const u = (r0.u + r1.u) / 2;
    for (let k = 0; k < K; k++) {
      const k2 = (k + 1) % K;
      const a = r0.verts[k], b = r0.verts[k2], c = r1.verts[k2], d = r1.verts[k];
      let nx = a.nx + b.nx + c.nx + d.nx, ny = a.ny + b.ny + c.ny + d.ny, nz = a.nz + b.nz + c.nz + d.nz;
      const nm = Math.hypot(nx, ny, nz) || 1; nx /= nm; ny /= nm; nz /= nm;
      const nCam = rotToCam({ x: nx, y: ny, z: nz });
      if (nCam.z > 0.04) continue;                 // отвёрнута от камеры
      const cz = (a.pr.z + b.pr.z + c.pr.z + d.pr.z) / 4;
      const diffuse = Math.max(0, nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z);
      const st = (TH[k].st + TH[k2].st) / 2;       // вертикаль (-1 брюхо .. +1 спина)
      const ct = (TH[k].ct + TH[k2].ct) / 2;       // латераль
      quads.push({ a, b, c, d, cz, diffuse, topness: (st + 1) / 2, lateral: ct, u });
    }
  }
  quads.sort((p, q) => q.cz - p.cz);
  for (const q of quads) {
    const col = bodyShade(sp, q.topness, q.lateral, q.u, q.diffuse, fog(q.cz));
    const fillC = css(col, 1);
    ctx.beginPath();
    ctx.moveTo(q.a.pr.x, q.a.pr.y);
    ctx.lineTo(q.b.pr.x, q.b.pr.y);
    ctx.lineTo(q.c.pr.x, q.c.pr.y);
    ctx.lineTo(q.d.pr.x, q.d.pr.y);
    ctx.closePath();
    ctx.fillStyle = fillC;
    ctx.fill();
    ctx.lineWidth = 0.8; ctx.strokeStyle = fillC; ctx.stroke();   // прячем швы граней
  }

  // ── дорсальный плавник (гребень на спине) ──
  {
    const a = 3, peak = 4, b = 6;
    const dh = f.h * (sp.name === 'angel' ? 0.6 : 0.34);
    const apex = project({
      x: rings[peak].C.x,
      y: rings[peak].C.y + rings[peak].hh + dh,
      z: rings[peak].C.z,
    });
    if (apex) {
      ctx.beginPath();
      ctx.moveTo(rings[a].topP.x, rings[a].topP.y);
      ctx.lineTo(apex.x, apex.y);
      ctx.lineTo(rings[b].topP.x, rings[b].topP.y);
      ctx.closePath();
      ctx.fillStyle = css(finCol, 0.5);
      ctx.fill();
    }
  }

  pectoral(camSign, 0.5);    // ближний грудной плавник — поверх тела

  // ── глаз (на стороне, обращённой к камере) ──
  {
    const eu = 0.12;
    const eye = project({
      x: f.p.x + f.fwd.x * (0.5 - eu) * f.len + f.up.x * f.h * 0.24 + f.side.x * camSign * f.w * 0.5,
      y: f.p.y + f.fwd.y * (0.5 - eu) * f.len + f.up.y * f.h * 0.24 + f.side.y * camSign * f.w * 0.5,
      z: f.p.z + f.fwd.z * (0.5 - eu) * f.len + f.up.z * f.h * 0.24 + f.side.z * camSign * f.w * 0.5,
    });
    if (eye) {
      const r = Math.max(1.4, f.h * 0.19 * eye.s);
      ctx.beginPath(); ctx.arc(eye.x, eye.y, r, 0, 7);
      ctx.fillStyle = css([245, 248, 250], 0.95); ctx.fill();
      ctx.beginPath(); ctx.arc(eye.x, eye.y, r * 0.62, 0, 7);
      ctx.fillStyle = '#0b1118'; ctx.fill();
      ctx.beginPath(); ctx.arc(eye.x - r * 0.25, eye.y - r * 0.25, r * 0.3, 0, 7);
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
    }
  }

  ctx.restore();
}

// ── Пузырьки ─────────────────────────────────────────────────────────────────
const bubbles = [];
function makeBubble() {
  return {
    p: { x: rnd(-HX * 0.85, HX * 0.85), y: rnd(-HY, HY), z: rnd(-HZ * 0.85, HZ * 0.85) },
    r: rnd(0.5, 2.4),
    rise: rnd(9, 20),
    ph: rnd(0, 9),
  };
}
function initBubbles() { bubbles.length = 0; for (let i = 0; i < 70; i++) bubbles.push(makeBubble()); }
function updateBubble(b, dt, t) {
  b.p.y += b.rise * dt;
  b.p.x += Math.sin(t * 1.6 + b.ph) * dt * 2.2;
  b.p.z += Math.cos(t * 1.3 + b.ph) * dt * 1.6;
  if (b.p.y > HY - 2) { b.p.y = -HY + 2; b.p.x = rnd(-HX * 0.85, HX * 0.85); b.p.z = rnd(-HZ * 0.85, HZ * 0.85); }
}
function drawBubble(b) {
  const pr = project(b.p);
  if (!pr) return;
  const cz = pr.z, r = b.r * pr.s;
  if (r < 0.4) return;
  ctx.save();
  ctx.globalAlpha = (1 - fog(cz) * 0.55) * 0.7;
  ctx.beginPath(); ctx.arc(pr.x, pr.y, r, 0, 7);
  ctx.strokeStyle = 'rgba(200,235,255,0.8)'; ctx.lineWidth = Math.max(0.6, r * 0.22); ctx.stroke();
  ctx.fillStyle = 'rgba(140,200,235,0.10)'; ctx.fill();
  ctx.beginPath(); ctx.arc(pr.x - r * 0.3, pr.y - r * 0.3, r * 0.32, 0, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
  ctx.restore();
}

// ── Водоросли ────────────────────────────────────────────────────────────────
const weeds = [];
function initWeeds() {
  weeds.length = 0;
  const n = 16;
  for (let i = 0; i < n; i++) {
    weeds.push({
      base: { x: rnd(-HX * 0.85, HX * 0.85), z: rnd(-HZ * 0.85, HZ * 0.85) },
      h: rnd(HY * 0.7, HY * 1.5),
      seg: 9,
      w: rnd(1.6, 3.4),
      ph: rnd(0, 9),
      sway: rnd(5, 11),
      hue: rnd(95, 150),
      bright: rnd(0.5, 0.95),
    });
  }
}
function drawWeed(w, t) {
  const pts = [];
  for (let i = 0; i <= w.seg; i++) {
    const f = i / w.seg;
    const y = -HY + f * w.h;
    const bend = Math.sin(t * 1.1 + w.ph + f * 2.6) * w.sway * f * f;
    const bend2 = Math.cos(t * 0.7 + w.ph * 1.4 + f * 1.8) * w.sway * 0.4 * f * f;
    const p = project({ x: w.base.x + bend, y, z: w.base.z + bend2 });
    if (!p) return;
    pts.push(p);
  }
  // ширина ленты в экранных пикселях по нормали к линии
  ctx.beginPath();
  const left = [], right = [];
  for (let i = 0; i <= w.seg; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(w.seg, i + 1)];
    let nx = -(b.y - a.y), ny = (b.x - a.x);
    const m = Math.hypot(nx, ny) || 1; nx /= m; ny /= m;
    const wd = w.w * p.s * (1 - i / w.seg * 0.7);
    left.push({ x: p.x + nx * wd, y: p.y + ny * wd });
    right.push({ x: p.x - nx * wd, y: p.y - ny * wd });
  }
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i <= w.seg; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = w.seg; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  const cz = pts[0].z;
  const base = fogged([0.4 * w.hue, 90 * w.bright + 30, 0.5 * w.hue], cz, 0.7);
  const tip = fogged([0.5 * w.hue, 150 * w.bright, 0.5 * w.hue], cz, 0.7);
  const g = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[w.seg].x, pts[w.seg].y);
  g.addColorStop(0, css([20, 70, 45], 0.92));
  g.addColorStop(1, css(tip, 0.9 - fog(cz) * 0.3));
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fill();
}

// ── Дно и каустики ───────────────────────────────────────────────────────────
const causticPts = [];
function initCaustics() {
  causticPts.length = 0;
  const gx = 13, gz = 10;
  for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) {
    causticPts.push({
      x: lerp(-HX, HX, i / (gx - 1)),
      z: lerp(-HZ, HZ, j / (gz - 1)),
      ph: rnd(0, 9),
    });
  }
}
function drawFloor(t) {
  // песчаное дно — квад
  const c = [
    project({ x: -HX, y: -HY, z: -HZ }),
    project({ x: HX, y: -HY, z: -HZ }),
    project({ x: HX, y: -HY, z: HZ }),
    project({ x: -HX, y: -HY, z: HZ }),
  ];
  if (c.some(p => !p)) return;
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
  ctx.closePath();
  const farZ = (c[0].z + c[1].z) / 2, nearZ = (c[2].z + c[3].z) / 2;
  const g = ctx.createLinearGradient(0, Math.min(c[0].y, c[1].y), 0, Math.max(c[2].y, c[3].y));
  g.addColorStop(0, css(fogged([60, 80, 78], farZ, 0.9)));
  g.addColorStop(1, css(fogged([120, 120, 96], nearZ, 0.55)));
  ctx.fillStyle = g;
  ctx.fill();

  // каустики — мягкие подвижные пятна света на дне
  ctx.save();
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  for (const cp of causticPts) {
    const intensity = Math.sin(t * 1.3 + cp.ph + cp.x * 0.05) * Math.cos(t * 0.9 + cp.z * 0.06 + cp.ph)
      + Math.sin(t * 0.7 + cp.x * 0.03 - cp.z * 0.04);
    const a = clamp((intensity + 1.2) / 3.2, 0, 1);
    if (a < 0.12) continue;
    const wob = Math.sin(t + cp.ph) * 6;
    const p = project({ x: cp.x + wob, y: -HY + 0.5, z: cp.z + Math.cos(t * 0.8 + cp.ph) * 6 });
    if (!p) continue;
    const fg = fog(p.z);
    const rad = (18 + 16 * a) * p.s;
    const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
    const bright = a * (1 - fg * 0.7);
    grd.addColorStop(0, 'rgba(190,225,210,' + (0.28 * bright).toFixed(3) + ')');
    grd.addColorStop(0.5, 'rgba(150,205,200,' + (0.13 * bright).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(120,190,200,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(p.x - rad, p.y - rad, rad * 2, rad * 2);
  }
  ctx.restore();
}

// ── Объёмные лучи света ──────────────────────────────────────────────────────
const rays = [];
function initRays() {
  rays.length = 0;
  for (let i = 0; i < 8; i++) {
    rays.push({
      x: rnd(-HX * 0.75, HX * 0.75),
      z: rnd(-HZ * 0.7, HZ * 0.6),
      w: rnd(9, 24),
      ph: rnd(0, 9),
      tilt: rnd(-0.25, 0.25),
    });
  }
}
function drawRays(t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const r of rays) {
    const sway = Math.sin(t * 0.4 + r.ph) * 10;
    const xTop = r.x + sway;
    const top = project({ x: xTop, y: HY, z: r.z });
    const botX = xTop + r.tilt * TANK.h + sway * 0.5;
    const bot = project({ x: botX, y: -HY, z: r.z + 8 });
    if (!top || !bot) continue;
    const wTop = r.w * top.s, wBot = r.w * 2.0 * bot.s;
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.6 + r.ph * 2);
    const fgT = fog(top.z);
    const aTop = (0.17 + 0.12 * pulse) * (1 - fgT * 0.35);
    const grd = ctx.createLinearGradient(top.x, top.y, bot.x, bot.y);
    grd.addColorStop(0, 'rgba(165,222,235,' + aTop.toFixed(3) + ')');
    grd.addColorStop(0.55, 'rgba(120,190,215,' + (aTop * 0.42).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(95,165,195,0)');
    ctx.beginPath();
    ctx.moveTo(top.x - wTop, top.y);
    ctx.lineTo(top.x + wTop, top.y);
    ctx.lineTo(bot.x + wBot, bot.y);
    ctx.lineTo(bot.x - wBot, bot.y);
    ctx.closePath();
    ctx.fillStyle = grd;
    ctx.fill();
  }
  ctx.restore();
}

// ── Взвесь / планктон (атмосферная пыль в толще воды) ────────────────────────
const motes = [];
function initMotes() {
  motes.length = 0;
  for (let i = 0; i < 150; i++) {
    motes.push({
      p: { x: rnd(-HX, HX), y: rnd(-HY, HY), z: rnd(-HZ, HZ) },
      r: rnd(0.25, 0.9),
      ph: rnd(0, 9),
      drift: rnd(0.4, 1.4),
    });
  }
}
function drawMotes(t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const m of motes) {
    // медленный дрейф взвеси
    const pr = project({
      x: m.p.x + Math.sin(t * 0.3 * m.drift + m.ph) * 4,
      y: m.p.y + Math.sin(t * 0.2 + m.ph) * 3,
      z: m.p.z + Math.cos(t * 0.25 + m.ph) * 4,
    });
    if (!pr) continue;
    const fgT = fog(pr.z);
    const a = (1 - fgT) * 0.28 * (0.6 + 0.4 * Math.sin(t * 1.4 + m.ph));
    if (a <= 0.02) continue;
    const rr = Math.max(0.5, m.r * pr.s);
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, rr, 0, 7);
    ctx.fillStyle = 'rgba(190,225,235,' + a.toFixed(3) + ')';
    ctx.fill();
  }
  ctx.restore();
}

// ── Стеклянные стенки ────────────────────────────────────────────────────────
function tankCorners() {
  const C = {};
  const s = [-1, 1];
  let k = 0;
  for (const sx of s) for (const sy of s) for (const sz of s) {
    C[k++] = project({ x: sx * HX, y: sy * HY, z: sz * HZ });
  }
  return C;
}
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],   // вертикальные
  [0, 2], [1, 3], [4, 6], [5, 7],   // по z
  [0, 4], [1, 5], [2, 6], [3, 7],   // по x
];
function drawGlass(t) {
  const C = tankCorners();
  if (Object.values(C).some(p => !p)) return;
  // рёбра — тонкое стекло
  ctx.save();
  ctx.lineWidth = 1.2;
  for (const [a, b] of EDGES) {
    const za = C[a].z, zb = C[b].z;
    const near = (za + zb) / 2 < cam.dist;     // ближние ярче
    ctx.strokeStyle = near ? 'rgba(190,230,255,0.22)' : 'rgba(140,200,235,0.08)';
    ctx.beginPath(); ctx.moveTo(C[a].x, C[a].y); ctx.lineTo(C[b].x, C[b].y); ctx.stroke();
  }
  ctx.restore();
}

// ── Фон-вода и блики на переднем стекле ──────────────────────────────────────
function drawWaterBackdrop(W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, css(mixRGB(WATER_TOP, [80, 165, 185], 0.3)));
  g.addColorStop(0.45, css(mixRGB(WATER_TOP, WATER_DEEP, 0.5)));
  g.addColorStop(1, css(WATER_DEEP));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
function drawGlassSheen(W, H, t) {
  // мягкий блик-полоса на переднем стекле + поверхность воды сверху
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // поверхность воды — мерцающая яркая лента сверху
  const surf = project({ x: 0, y: HY, z: 0 });
  const surfY = surf ? clamp(surf.y, 0, H * 0.4) : H * 0.12;
  const sg = ctx.createLinearGradient(0, 0, 0, surfY + 60);
  sg.addColorStop(0, 'rgba(170,225,235,0.16)');
  sg.addColorStop(1, 'rgba(170,225,235,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, W, surfY + 60);
  ctx.restore();

  // диагональный блик стекла
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const bx = W * (0.66 + 0.02 * Math.sin(t * 0.2));
  const grd = ctx.createLinearGradient(bx - 120, 0, bx + 120, H);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.5, 'rgba(210,235,255,0.05)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // виньетка
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,6,16,0.5)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// ── Цикл анимации ────────────────────────────────────────────────────────────
let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = W / 2; cy = H / 2;
  const fov = 52 * Math.PI / 180;
  cam.f = (H / 2) / Math.tan(fov / 2);
}
window.addEventListener('resize', resize);

let paused = false, useRays = true, orbit = true;
let last = 0, t = 0;

function frame(now) {
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, raw || 0.016);
  if (!paused) t += dt;

  // камера
  if (orbit) {
    cam.yaw = Math.sin(t * 0.08) * 0.62;
    cam.pitch = -0.08 + Math.sin(t * 0.05) * 0.12;
    cam.dist = 196 + Math.sin(t * 0.06) * 16;
  }
  camWorld = camWorldPos();

  // обновление мира
  if (!paused) {
    updateHubs(dt, t);
    for (const f of fishes) steerFish(f, dt, t);
    for (const b of bubbles) updateBubble(b, dt, t);
  }

  // ── рендер ──
  drawWaterBackdrop(W, H);
  drawFloor(t);
  drawGlass(t);
  if (useRays) drawRays(t);
  drawMotes(t);

  // depth-сортировка живности и водорослей (painter)
  const items = [];
  for (const w of weeds) items.push({ z: toCam({ x: w.base.x, y: -HY + w.h * 0.4, z: w.base.z }).z, kind: 0, ref: w });
  for (const f of fishes) items.push({ z: toCam(f.p).z, kind: 1, ref: f });
  for (const b of bubbles) items.push({ z: toCam(b.p).z, kind: 2, ref: b });
  items.sort((a, b) => b.z - a.z);
  for (const it of items) {
    if (it.kind === 0) drawWeed(it.ref, t);
    else if (it.kind === 1) drawFish(it.ref);
    else drawBubble(it.ref);
  }

  drawGlassSheen(W, H, t);

  requestAnimationFrame(frame);
}

// ── Управление ──────────────────────────────────────────────────────────────
const btnPause = document.getElementById('btnPause');
btnPause.addEventListener('click', () => {
  paused = !paused;
  btnPause.setAttribute('aria-pressed', String(paused));
  btnPause.textContent = paused ? 'Старт' : 'Пауза';
});
const fishCount = document.getElementById('fishCount');
const fishVal = document.getElementById('fishVal');
fishCount.addEventListener('input', () => {
  fishVal.textContent = fishCount.value;
  rebuildFish(parseInt(fishCount.value, 10));
});
document.getElementById('tglRays').addEventListener('change', e => { useRays = e.target.checked; });
document.getElementById('tglOrbit').addEventListener('change', e => {
  orbit = e.target.checked;
  if (!orbit) { cam.yaw = 0.3; cam.pitch = -0.08; cam.dist = 196; }
});

// drag для ручного вращения, когда облёт выключен
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', e => {
  if (!dragging || orbit) return;
  cam.yaw += (e.clientX - lastX) * 0.005;
  cam.pitch = clamp(cam.pitch - (e.clientY - lastY) * 0.004, -0.6, 0.5);
  lastX = e.clientX; lastY = e.clientY;
});

// ── Старт ─────────────────────────────────────────────────────────────────────
resize();
rebuildFish(22);
initBubbles();
initWeeds();
initCaustics();
initRays();
initMotes();
requestAnimationFrame(frame);
