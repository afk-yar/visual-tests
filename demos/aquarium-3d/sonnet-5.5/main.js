/* 3D-аквариум — Claude Sonnet 5.5
   Canvas 2D, без WebGL. Вся геометрия — собственная 3D-математика:
   камера на орбите, перспективная проекция, алгоритм художника, туман воды. */
(function () {
'use strict';

/* ═══════════ утилиты ═══════════ */
const TAU = Math.PI * 2, PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
let _seed = 90210;
function rnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
const rr = (a, b) => a + (b - a) * rnd();
const LUT_N = 4096, LUT_M = LUT_N - 1, LUT_K = LUT_N / TAU;
const SINT = new Float32Array(LUT_N);
for (let i = 0; i < LUT_N; i++) SINT[i] = Math.sin(i / LUT_K);
const fsin = x => SINT[(x * LUT_K) & LUT_M];
const rgb = (r, g, b) => 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
const rgba = (r, g, b, a) => 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a.toFixed(3) + ')';

/* ═══════════ объём аквариума ═══════════ */
const HX = 5.5, HY = 2.8, HZ = 2.75;          // половинные размеры стеклянного объёма
const SANDY = -HY + 0.34;                      // поверхность песка
const SURF = HY - 0.14;                        // поверхность воды

/* палитра воды: сверху светлая бирюза, у дна — густая синева */
const W_TOP = [74, 196, 210], W_MID = [18, 104, 138], W_BOT = [5, 40, 66];
let FR = 0, FG = 0, FB = 0;
function fogRGB(y, lift) {
  const t = clamp((y + HY) / (2 * HY), 0, 1);
  let a, b, u;
  if (t < 0.5) { a = W_BOT; b = W_MID; u = t * 2; } else { a = W_MID; b = W_TOP; u = t * 2 - 1; }
  FR = a[0] + (b[0] - a[0]) * u; FG = a[1] + (b[1] - a[1]) * u; FB = a[2] + (b[2] - a[2]) * u;
  if (lift) {   // светлая бирюзовая дымка для предметов в толще воды: дальние уходят в неё, а не в тёмный фон
    FR += (116 - FR) * lift; FG += (216 - FG) * lift; FB += (220 - FB) * lift;
  }
}

/* ═══════════ холст ═══════════ */
const cv = document.getElementById('c');
const ctx = cv.getContext('2d', { alpha: false });
let CW = 1, CH = 1, DPR = 1, qual = 1;
const FOVY = 36 * PI / 180;

const cam = { x: 0, y: 0, z: 15, fx: 0, fy: 0, fz: -1, rx: 1, rz: 0, ux: 0, uy: 1, uz: 0,
  focal: 800, cx: 0, cy: 0, R: 15 };
const FRONT = [false, false, false, false];    // какие стенки смотрят на камеру

function resize() {
  const w = Math.max(160, window.innerWidth || 800), h = Math.max(120, window.innerHeight || 600);
  const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3.0e6 / (w * h))) * qual;
  CW = Math.max(2, Math.round(w * dpr)); CH = Math.max(2, Math.round(h * dpr)); DPR = dpr;
  cv.width = CW; cv.height = CH;
  cam.focal = 0.5 * CH / Math.tan(FOVY / 2);
  cam.cx = CW / 2; cam.cy = CH * 0.44;
}

/* ═══════════ камера: облёт и покачивание ═══════════ */
const view = { phase: 0.9, yawOff: 0, pitchOff: 0, zoom: 1, auto: true, speed: 1, timeScale: 1,
  rays: true, bubbles: true };

function updateCamera(t) {
  const aspect = CW / CH;
  const R = 15.3 * Math.max(1, 1.4 / aspect) * view.zoom * (1 + 0.022 * Math.sin(t * 0.13));
  const ph = view.phase;
  const yaw = 0.62 * Math.sin(ph) + 0.15 * Math.sin(ph * 2.3 + 1.2) + view.yawOff;
  const tx = 0.06 * Math.sin(t * 0.31), ty = -0.1 + 0.05 * Math.sin(t * 0.23 + 1.0), tz = 0;
  let pitch = 0.055 + 0.035 * Math.sin(ph * 1.4 + 0.5) + view.pitchOff;
  pitch = clamp(pitch, Math.max(-0.1, Math.asin(clamp((-1.5 - ty) / R, -1, 1))), Math.asin(clamp((2.05 - ty) / R, -1, 1)));
  const cp = Math.cos(pitch);
  cam.x = tx + R * Math.sin(yaw) * cp;
  cam.y = ty + R * Math.sin(pitch);
  cam.z = tz + R * Math.cos(yaw) * cp;
  cam.R = R;
  let fx = tx - cam.x, fy = ty - cam.y, fz = tz - cam.z;
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  cam.fx = fx; cam.fy = fy; cam.fz = fz; cam.rx = rx; cam.rz = rz;
  cam.ux = -rz * fy; cam.uy = rz * fx - rx * fz; cam.uz = rx * fy;
  FRONT[0] = cam.z - HZ > 0; FRONT[1] = -cam.z - HZ > 0; FRONT[2] = cam.x - HX > 0; FRONT[3] = -cam.x - HX > 0;
}

/* проекция точки: результат в px, py (экран), pz (глубина), pk (пикселей на единицу) */
let px = 0, py = 0, pz = 0, pk = 1;
function proj(x, y, z) {
  const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
  pz = dx * cam.fx + dy * cam.fy + dz * cam.fz;
  const xc = dx * cam.rx + dz * cam.rz;
  const yc = dx * cam.ux + dy * cam.uy + dz * cam.uz;
  pk = cam.focal / (pz > 0.05 ? pz : 0.05);
  px = cam.cx + xc * pk; py = cam.cy - yc * pk;
}
/* туман: доля «воды» между стеклом и объектом по глубине */
function fogAmt(zc) {   // S-образная кривая: ближние и средние рыбы почти не тронуты, дальние явно тонут в дымке
  const d = zc - (cam.R - 3.4);
  return d <= 0 ? 0 : 0.66 * (1 - Math.exp(-Math.pow(d * 0.165, 1.5)));
}

/* ═══════════ стенки: концы горизонтальных рёбер ═══════════ */
const WN = [[0, 1], [0, -1], [1, 0], [-1, 0]];
function wallEnds(i, hx, hz) {
  switch (i) {
    case 0: return [-hx, hz, hx, hz];
    case 1: return [hx, -hz, -hx, -hz];
    case 2: return [hx, hz, hx, -hz];
    default: return [-hx, -hz, -hx, hz];
  }
}
const Q = new Float64Array(8), QZ = new Float64Array(4);
/* четырёхугольник стенки: A-низ, B-низ, B-верх, A-верх */
function projQuad(e, y0, y1) {
  proj(e[0], y0, e[1]); Q[0] = px; Q[1] = py; QZ[0] = pz;
  proj(e[2], y0, e[3]); Q[2] = px; Q[3] = py; QZ[1] = pz;
  proj(e[2], y1, e[3]); Q[4] = px; Q[5] = py; QZ[2] = pz;
  proj(e[0], y1, e[1]); Q[6] = px; Q[7] = py; QZ[3] = pz;
}
function pathQuad() {
  ctx.beginPath(); ctx.moveTo(Q[0], Q[1]); ctx.lineTo(Q[2], Q[3]); ctx.lineTo(Q[4], Q[5]); ctx.lineTo(Q[6], Q[7]); ctx.closePath();
}

/* ═══════════ фон комнаты, стол, подставка ═══════════ */
function drawBackdrop() {
  let g = ctx.createLinearGradient(0, 0, 0, CH);
  g.addColorStop(0, '#03080c'); g.addColorStop(0.5, '#0a1b25'); g.addColorStop(1, '#02060a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  const rg = ctx.createRadialGradient(CW * 0.5, CH * 0.44, 0, CW * 0.5, CH * 0.44, Math.max(CW, CH) * 0.62);
  rg.addColorStop(0, 'rgba(46,130,160,0.34)'); rg.addColorStop(0.5, 'rgba(20,74,98,0.15)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, CW, CH);
}

function drawBase() {
  // свет аквариума на столешнице
  proj(0, -HY - 0.4, 0);
  const rx = HX * 1.55 * pk, ry = rx * 0.27, gx = px, gy = py;
  ctx.save();
  ctx.translate(gx, gy); ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, 'rgba(70,185,205,0.34)'); g.addColorStop(0.5, 'rgba(34,120,142,0.14)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
  ctx.restore();
  // чёрная подставка под стеклом: видимые боковые грани
  for (let i = 0; i < 4; i++) {
    if (!FRONT[i]) continue;
    const e = wallEnds(i, HX + 0.16, HZ + 0.16);
    projQuad(e, -HY - 0.42, -HY + 0.02);
    const gr = ctx.createLinearGradient(0, Q[7], 0, Q[1]);
    gr.addColorStop(0, '#2a3840'); gr.addColorStop(0.18, '#121a20'); gr.addColorStop(1, '#05080a');
    ctx.fillStyle = gr; pathQuad(); ctx.fill();
    ctx.strokeStyle = 'rgba(160,215,230,0.35)'; ctx.lineWidth = Math.max(1, 0.012 * pk * 3);
    ctx.beginPath(); ctx.moveTo(Q[6], Q[7]); ctx.lineTo(Q[4], Q[5]); ctx.stroke();
  }
}

/* ═══════════ внутренние стенки (то, что видно через стекло изнутри) ═══════════ */
function drawWallInterior(i, t) {
  const e = wallEnds(i, HX, HZ);
  projQuad(e, SANDY, SURF);
  const tmx = (Q[4] + Q[6]) * 0.5, tmy = (Q[5] + Q[7]) * 0.5, bmx = (Q[0] + Q[2]) * 0.5, bmy = (Q[1] + Q[3]) * 0.5;
  const g = ctx.createLinearGradient(tmx, tmy, bmx, bmy);
  g.addColorStop(0, rgb(W_TOP[0] * 0.95, W_TOP[1] * 0.95, W_TOP[2] * 0.95));
  g.addColorStop(0.45, rgb(W_MID[0], W_MID[1], W_MID[2]));
  g.addColorStop(1, rgb(W_BOT[0], W_BOT[1], W_BOT[2]));
  ctx.save();
  pathQuad(); ctx.clip();
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  // дальняя сторона гуще в дымке
  const near = QZ[0] < QZ[1] ? 0 : 1;
  const nx0 = Q[near * 2], ny0 = Q[near * 2 + 1], fx0 = Q[(1 - near) * 2], fy0 = Q[(1 - near) * 2 + 1];
  const far = Math.max(QZ[0], QZ[1]);
  const hz = ctx.createLinearGradient(nx0, ny0, fx0, fy0);
  hz.addColorStop(0, 'rgba(14,86,116,0)');
  hz.addColorStop(1, 'rgba(10,70,100,' + Math.min(0.5, fogAmt(far) * 0.85).toFixed(3) + ')');
  ctx.fillStyle = hz; ctx.fillRect(0, 0, CW, CH);
  // тёмные стыки по углам
  const ao = ctx.createLinearGradient(Q[0], Q[1], Q[2], Q[3]);
  ao.addColorStop(0, 'rgba(0,16,30,0.30)'); ao.addColorStop(0.1, 'rgba(0,16,30,0)');
  ao.addColorStop(0.9, 'rgba(0,16,30,0)'); ao.addColorStop(1, 'rgba(0,16,30,0.30)');
  ctx.fillStyle = ao; ctx.fillRect(0, 0, CW, CH);
  // пятна рассеянного света, скользящие по стенке (честные 3D-точки на плоскости стенки)
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const u = 0.5 + 0.42 * fsin(t * 0.07 + k * 1.9 + i);
    const v = 0.55 + 0.3 * fsin(t * 0.05 + k * 2.7 + i * 0.7);
    const x = e[0] + (e[2] - e[0]) * u, z = e[1] + (e[3] - e[1]) * u, y = lerp(SANDY, SURF, v);
    proj(x, y, z);
    const rad = (1.7 + 0.5 * k % 1.1) * pk;
    const rg = ctx.createRadialGradient(px, py, 0, px, py, rad);
    rg.addColorStop(0, 'rgba(120,225,235,0.10)'); rg.addColorStop(1, 'rgba(120,225,235,0)');
    ctx.fillStyle = rg; ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  ctx.restore();
}

/* ═══════════ поверхность воды (вид снизу) ═══════════ */
function drawSurface(t) {
  const cxs = [-HX, HX, HX, -HX], czs = [HZ, HZ, -HZ, -HZ];
  const sx = [0, 0, 0, 0], sy = [0, 0, 0, 0];
  let nearI = 0, nearZ = 1e9, farI = 0, farZ = -1e9;
  for (let i = 0; i < 4; i++) {
    proj(cxs[i], SURF, czs[i]); sx[i] = px; sy[i] = py;
    if (pz < nearZ) { nearZ = pz; nearI = i; }
    if (pz > farZ) { farZ = pz; farI = i; }
  }
  ctx.save();
  ctx.beginPath(); ctx.moveTo(sx[0], sy[0]);
  for (let i = 1; i < 4; i++) ctx.lineTo(sx[i], sy[i]);
  ctx.closePath(); ctx.clip();
  const g = ctx.createLinearGradient(sx[nearI], sy[nearI], sx[farI], sy[farI]);
  g.addColorStop(0, 'rgba(215,248,252,0.78)'); g.addColorStop(0.45, 'rgba(130,215,230,0.55)'); g.addColorStop(1, 'rgba(60,160,190,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  // рябь — световые гребешки, бегущие по зеркалу воды
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let k = 0; k < 11; k++) {
    const z = -HZ + (k + 0.5) * (2 * HZ / 11);
    ctx.beginPath();
    for (let s = 0; s <= 22; s++) {
      const x = -HX + s * (2 * HX / 22);
      const y = SURF + 0.05 * (fsin(x * 1.7 + t * 1.15 + z * 2.1 + k) + 0.6 * fsin(x * 0.9 - t * 0.7 + z * 1.4));
      proj(x, y, z);
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(235,255,255,' + (0.07 + 0.07 * (0.5 + 0.5 * fsin(t * 0.6 + k * 1.3))).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, 0.05 * pk * 0.9);
    ctx.stroke();
  }
  for (let k = 0; k < 6; k++) {
    const x = -HX + (k + 0.5) * (2 * HX / 6);
    ctx.beginPath();
    for (let s = 0; s <= 12; s++) {
      const z = -HZ + s * (2 * HZ / 12);
      const y = SURF + 0.05 * (fsin(x * 1.7 + t * 1.15 + z * 2.1 + k * 0.5) + 0.6 * fsin(z * 1.9 - t * 0.9));
      proj(x, y, z);
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(235,255,255,0.05)'; ctx.lineWidth = Math.max(1, 0.04 * pk);
    ctx.stroke();
  }
  ctx.restore();
}

/* ═══════════ песчаное дно: лучевой рендер в малом разрешении, каустики ═══════════ */
const GR = new Uint8Array(128 * 128);
(function () {
  const a = new Float32Array(128 * 128), b = new Float32Array(128 * 128);
  for (let i = 0; i < a.length; i++) a[i] = rnd();
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += a[((y + dy) & 127) * 128 + ((x + dx) & 127)];
      b[y * 128 + x] = s / 9;
    }
    a.set(b);
  }
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < a.length; i++) { if (a[i] < mn) mn = a[i]; if (a[i] > mx) mx = a[i]; }
  for (let i = 0; i < a.length; i++) GR[i] = ((a[i] - mn) / (mx - mn)) * 255;
})();

const FW = 560, FH = 280;
const floorCv = document.createElement('canvas');
floorCv.width = FW; floorCv.height = FH;
const floorCtx = floorCv.getContext('2d');
const floorImg = floorCtx.createImageData(FW, FH);
for (let i = 3; i < floorImg.data.length; i += 4) floorImg.data[i] = 255;

function drawFloor(t) {
  const cxs = [-HX, HX, HX, -HX], czs = [HZ, HZ, -HZ, -HZ];
  const sx = [0, 0, 0, 0], sy = [0, 0, 0, 0];
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (let i = 0; i < 4; i++) {
    proj(cxs[i], SANDY, czs[i]); sx[i] = px; sy[i] = py;
    if (px < minx) minx = px; if (px > maxx) maxx = px;
    if (py < miny) miny = py; if (py > maxy) maxy = py;
  }
  const bx = Math.max(0, Math.floor(minx)), by = Math.max(0, Math.floor(miny));
  const bw = Math.min(CW, Math.ceil(maxx)) - bx, bh = Math.min(CH, Math.ceil(maxy)) - by;
  if (bw < 4 || bh < 4) return;
  const k = Math.min(0.3, FW / bw, FH / bh, Math.sqrt(36000 / (bw * bh)));
  const lw = Math.max(2, Math.floor(bw * k)), lh = Math.max(2, Math.floor(bh * k));
  const sxs = bw / lw, sys = bh / lh;
  const data = floorImg.data, F = cam.focal;
  fogRGB(SANDY);
  const fgR = FR, fgG = FG, fgB = FB;
  const ta = t * 0.62, tb = t * 0.47, tc = t * 0.38, td = t * 0.71, te = t * 0.29, tf = t * 0.83, tg = t * 0.55;
  for (let j = 0; j < lh; j++) {
    const vy = cam.cy - (by + (j + 0.5) * sys);
    const dY = cam.fy * F + cam.uy * vy;
    let o = j * FW * 4;
    if (dY > -1e-4) {
      for (let i = 0; i < lw; i++) { data[o++] = fgR; data[o++] = fgG; data[o++] = fgB; o++; }
      continue;
    }
    const tt = (SANDY - cam.y) / dY;
    const fa = fogAmt(tt * F);
    const sx0 = bx + 0.5 * sxs - cam.cx;
    let X = cam.x + tt * (cam.fx * F + cam.ux * vy) + tt * cam.rx * sx0;
    let Z = cam.z + tt * (cam.fz * F + cam.uz * vy) + tt * cam.rz * sx0;
    const dX = tt * cam.rx * sxs, dZ = tt * cam.rz * sxs;
    for (let i = 0; i < lw; i++, X += dX, Z += dZ) {
      const x = X < -HX ? -HX : X > HX ? HX : X, z = Z < -HZ ? -HZ : Z > HZ ? HZ : Z;
      const gr = GR[(((x * 11 + 64) | 0) & 127) | ((((z * 11 + 64) | 0) & 127) << 7)] * 0.00392 - 0.5;
      const dune = fsin(x * 1.1 + fsin(z * 0.7 + 1.0) * 1.4) * 0.5 + fsin(z * 2.2 + x * 0.6) * 0.18;
      const u = x * 1.25, w = z * 1.25;
      const a = fsin(u + 0.9 * fsin(w * 1.3 + ta) + tb);
      const b = fsin(w + 0.9 * fsin(u * 1.2 - tc) - td);
      const c = fsin((u + w) * 0.75 + a * 1.1 + te);
      let l1 = a + b; if (l1 < 0) l1 = -l1;
      let l2 = b + c; if (l2 < 0) l2 = -l2;
      let q = 1 - (l1 < l2 ? l1 : l2) * 1.75; q = q > 0 ? q * q * q : 0;
      const a2 = fsin(u * 2.1 + 1.7 * fsin(w * 2.0 + tf) - tb * 1.3);
      const b2 = fsin(w * 2.3 - 1.3 * fsin(u * 1.8 - tg) + td);
      let q2 = 1 - (a2 + b2 < 0 ? -(a2 + b2) : a2 + b2) * 1.5; q2 = q2 > 0 ? q2 * q2 * q2 : 0;
      let e = HX - (x < 0 ? -x : x); const ez = HZ - (z < 0 ? -z : z); if (ez < e) e = ez;
      const ao = e > 0.8 ? 1 : 0.7 + 0.375 * e;
      const B = (0.46 + 0.11 * dune + 0.2 * gr) * ao * 1.22;
      const cl = (q * 0.9 + q2 * 0.38) * ao;
      let r = 178 * B + 100 * cl, g = 166 * B + 148 * cl, bl = 124 * B + 150 * cl;
      r += (fgR - r) * fa; g += (fgG - g) * fa; bl += (fgB - bl) * fa;
      data[o++] = r; data[o++] = g; data[o++] = bl; o++;
    }
  }
  floorCtx.putImageData(floorImg, 0, 0, 0, 0, lw, lh);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(sx[0], sy[0]);
  for (let i = 1; i < 4; i++) ctx.lineTo(sx[i], sy[i]);
  ctx.closePath(); ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(floorCv, 0, 0, lw, lh, bx, by, bw, bh);
  ctx.restore();
}

/* ═══════════ виды рыб: форма тела, раскраска, плавники ═══════════ */
/* сечения вдоль хребта (0 — нос): плотный набор для близких рыб, редкий — для дальних */
const SIG = {
  hi: [0, 0.02, 0.05, 0.09, 0.14, 0.2, 0.27, 0.34, 0.42, 0.5, 0.58, 0.66, 0.74, 0.81, 0.87, 0.92, 0.96, 1.0],
  lo: [0, 0.06, 0.16, 0.3, 0.45, 0.6, 0.75, 0.88, 1.0]
};
function radf(s, a, b, ped) {
  const sh = Math.pow(Math.max(0, Math.sin(PI * Math.pow(s, a))), b);
  let r = ped + (1 - ped) * sh;
  if (s < 0.07) r *= Math.sqrt(s / 0.07);
  if (s > 0.95) r *= 0.75;
  return r;
}
const RINGS = {};
function ring(M) {
  if (!RINGS[M]) {
    const c = [], s = [];
    for (let j = 0; j <= M; j++) { c.push(Math.cos(j * TAU / M)); s.push(Math.sin(j * TAU / M)); }
    RINGS[M] = { c, s };
  }
  return RINGS[M];
}
/* геометрия вида для набора сечений: полувысота H, полуширина W, продольная составляющая нормали NX */
function mkGeo(o, SI) {
  const NS = SI.length, g = { SI, NS, H: new Float32Array(NS), W: new Float32Array(NS), NX: new Float32Array(NS), tabs: {} };
  const rm = new Float32Array(NS);
  for (let i = 0; i < NS; i++) {
    g.H[i] = o.hm * o.L * radf(SI[i], o.ha, o.hb, o.hp);
    g.W[i] = o.wm * o.L * radf(SI[i], o.wa, o.wb, o.wp);
    rm[i] = Math.sqrt(g.H[i] * g.W[i]);
  }
  for (let i = 0; i < NS; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(NS - 1, i + 1);
    g.NX[i] = clamp((rm[i1] - rm[i0]) / (SI[i1] - SI[i0]) / o.L * 1.3, -0.9, 0.95);
  }
  return g;
}
function mkSpecies(o) {
  o.geo = { hi: mkGeo(o, SIG.hi), lo: mkGeo(o, SIG.lo) };
  if (o.finSoft === undefined) o.finSoft = 1;
  return o;
}
/* нормали колец (в локальных осях рыбы) для геометрии g и числа сегментов M */
function getTab(sp, g, M) {
  let t = g.tabs[M]; if (t) return t;
  const NS = g.NS;
  const ny = new Float32Array(NS * (M + 1)), nz = new Float32Array(NS * (M + 1));
  const rg = ring(M);
  for (let i = 0; i < NS; i++) {
    const h = g.H[i] + 1e-4, w = g.W[i] + 1e-4, nx = g.NX[i], gg = Math.sqrt(1 - nx * nx);
    for (let j = 0; j <= M; j++) {
      const cy = rg.c[j] / h, cz = rg.s[j] / w, l = Math.hypot(cy, cz) || 1;
      ny[i * (M + 1) + j] = cy / l * gg; nz[i * (M + 1) + j] = cz / l * gg;
    }
  }
  return (g.tabs[M] = { ny, nz });
}
/* таблица узора окраски: NPAT отсчётов вдоль тела × (M+1) углов кольца, независимо от густоты сетки.
   Каждый отсчёт — среднее по 2x2 подвыборкам, поэтому узкие полосы и мягкие пятна не теряются. */
const NPAT = 72;
function getPat(sp, M) {
  sp.pat = sp.pat || {};
  let t = sp.pat[M]; if (t) return t;
  const M1 = M + 1, tab = new Float32Array(NPAT * M1 * 4), ds = 0.5 / NPAT;
  for (let q = 0; q < NPAT; q++) {
    const s0 = q / (NPAT - 1);
    for (let j = 0; j < M; j++) {
      let r = 0, g = 0, b = 0, e = 0;
      for (let a = 0; a < 2; a++) for (let c2 = 0; c2 < 2; c2++) {
        const s = clamp(s0 + (a ? ds : -ds) * 0.5, 0, 1), am = (j + (c2 ? 0.25 : -0.25)) * TAU / M;
        const c = sp.color(s, Math.cos(am), Math.sin(am));
        r += c[0]; g += c[1]; b += c[2]; e += c[3];
      }
      const o = (q * M1 + j) * 4;
      tab[o] = r * 0.25; tab[o + 1] = g * 0.25; tab[o + 2] = b * 0.25; tab[o + 3] = e * 0.25;
    }
    for (let k = 0; k < 4; k++) tab[(q * M1 + M) * 4 + k] = tab[(q * M1) * 4 + k];
  }
  return (sp.pat[M] = tab);
}
const mixc = (c, r, g, b, k) => { c[0] = lerp(c[0], r, k); c[1] = lerp(c[1], g, k); c[2] = lerp(c[2], b, k); };
const band = (s, a, b, e) => sstep(a - e, a, s) * (1 - sstep(b, b + e, s));

const SPEC = {};
/* неоновая тетра: стайная, быстрая, светящаяся полоса и красный низ */
SPEC.tetra = mkSpecies({
  name: 'tetra', L: 0.74, hm: 0.115, wm: 0.08, ha: 0.8, hb: 0.55, hp: 0.1, wa: 0.8, wb: 0.55, wp: 0.1,
  speed: 2.05, resp: 4.2, turn: 1.1, freq: 13, amp: 0.085, school: 1.0, nr: 3.4, yPref: 0.4, sizeVar: 0.12,
  color(s, c) {
    const o = [205, 220, 232, 0];
    mixc(o, 40, 58, 96, sstep(0.25, 0.8, c) * 0.85);
    mixc(o, 246, 246, 244, sstep(-0.15, -0.7, c));
    const bd = Math.exp(-Math.pow((c - 0.2) / 0.17, 2)) * band(s, 0.14, 0.82, 0.07);
    mixc(o, 35, 228, 255, bd); o[3] = bd * 0.85;
    const red = sstep(0.42, 0.55, s) * sstep(0.28, -0.05, c);
    mixc(o, 236, 30, 34, red); o[3] = Math.max(o[3], red * 0.12);
    return o;
  },
  tail: { len: 0.2, h: 0.14, root: 0.05, notch: 0.7, col: [236, 170, 170], a: 0.62 },
  dorsal: { pts: [[0.36, 0], [0.42, 0.07], [0.55, 0.1], [0.6, 0]], col: [200, 215, 232], a: 0.5 },
  anal: { pts: [[0.5, 0], [0.55, 0.06], [0.7, 0.07], [0.78, 0]], col: [236, 70, 70], a: 0.6 },
  pect: { s: 0.24, dy: -0.35, len: 0.14, wid: 0.05, bk: 0.9, dn: 0.2, ot: 0.5, col: [225, 235, 245], a: 0.45 },
  eye: { s: 0.1, dy: 0.28, r: 0.05, iris: [150, 190, 214] }
});
/* данио: золото с синими продольными полосами */
SPEC.danio = mkSpecies({
  name: 'danio', L: 0.66, hm: 0.1, wm: 0.075, ha: 0.8, hb: 0.55, hp: 0.1, wa: 0.8, wb: 0.55, wp: 0.1,
  speed: 2.2, resp: 4.2, turn: 1.1, freq: 14, amp: 0.09, school: 0.95, nr: 3.4, yPref: 1.2, sizeVar: 0.1,
  color(s, c) {
    const o = [238, 198, 96, 0];
    mixc(o, 236, 236, 226, sstep(-0.5, -0.85, c));
    const st = sstep(0.35, 0.6, fsin(c * 8.2 + 0.3)) * sstep(0.08, 0.16, s);
    mixc(o, 28, 52, 132, st * 0.9);
    return o;
  },
  tail: { len: 0.2, h: 0.13, root: 0.05, notch: 0.65, col: [240, 205, 120], a: 0.5 },
  dorsal: { pts: [[0.4, 0], [0.46, 0.07], [0.58, 0.09], [0.64, 0]], col: [235, 205, 120], a: 0.5 },
  anal: { pts: [[0.5, 0], [0.56, 0.06], [0.74, 0.07], [0.8, 0]], col: [235, 205, 130], a: 0.5 },
  pect: { s: 0.24, dy: -0.35, len: 0.13, wid: 0.05, bk: 0.9, dn: 0.2, ot: 0.5, col: [240, 230, 200], a: 0.45 },
  eye: { s: 0.1, dy: 0.28, r: 0.047, iris: [214, 178, 96] }
});
/* скалярия: тонкий диск, чёрные вертикальные полосы, вуали-плавники */
SPEC.angel = mkSpecies({
  name: 'angel', L: 1.0, hm: 0.36, wm: 0.075, ha: 0.85, hb: 0.6, hp: 0.12, wa: 0.85, wb: 0.7, wp: 0.12,
  speed: 0.62, resp: 1.9, turn: 0.6, freq: 5.2, amp: 0.05, school: 0.18, nr: 3.4, yPref: 0.3, sizeVar: 0.14,
  color(s, c) {
    const o = [238, 236, 226, 0];
    mixc(o, 248, 214, 140, sstep(0.1, 0.9, c) * 0.55);
    const bars = [0.19, 0.46, 0.72], w = [0.055, 0.06, 0.065];
    for (let k = 0; k < 3; k++) {
      const m = (1 - sstep(w[k] * 0.55, w[k], Math.abs(s - bars[k]))) * sstep(-0.9, -0.3, c);
      mixc(o, 18, 18, 22, m * 0.95);
    }
    return o;
  },
  tail: { len: 0.42, h: 0.36, root: 0.07, notch: 0.05, col: [236, 232, 214], a: 0.68 },
  dorsal: { pts: [[0.3, 0], [0.4, 0.26], [0.52, 0.56], [0.66, 0.36], [0.8, 0.12], [0.86, 0]], col: [230, 226, 208], a: 0.7 },
  anal: { pts: [[0.4, 0], [0.5, 0.22], [0.62, 0.5], [0.74, 0.3], [0.84, 0.1], [0.9, 0]], col: [230, 226, 208], a: 0.7 },
  pect: { s: 0.25, dy: -0.1, len: 0.22, wid: 0.1, bk: 0.9, dn: 0.2, ot: 0.5, col: [235, 235, 230], a: 0.4 },
  pelv: { s: 0.3, dy: -0.85, len: 0.75, wid: 0.04, bk: 0.35, dn: 0.95, ot: 0.12, col: [240, 238, 228], a: 0.8 },
  eye: { s: 0.115, dy: 0.2, r: 0.04, iris: [240, 130, 40] }
});
/* рыба-клоун: пухлая, оранжевая, три белых пояса с чёрной окантовкой */
SPEC.clown = mkSpecies({
  name: 'clown', L: 0.82, hm: 0.18, wm: 0.15, ha: 0.8, hb: 0.6, hp: 0.1, wa: 0.8, wb: 0.6, wp: 0.12,
  speed: 1.05, resp: 3.0, turn: 1.0, freq: 8, amp: 0.065, school: 0.35, nr: 3.8, yPref: -1.3, sizeVar: 0.12,
  color(s, c) {
    const o = [252, 112, 18, 0];
    const bands = [[0.2, 0.29], [0.5, 0.6], [0.88, 0.96]];
    for (let k = 0; k < 3; k++) {
      const a = bands[k][0], b = bands[k][1];
      mixc(o, 14, 12, 14, band(s, a - 0.02, b + 0.02, 0.012));
      mixc(o, 250, 250, 246, band(s, a, b, 0.012));
    }
    mixc(o, 255, 170, 70, sstep(0.5, 1.0, c) * 0.25);
    return o;
  },
  tail: { len: 0.2, h: 0.2, root: 0.08, notch: 0.0, col: [252, 120, 20], a: 0.85 },
  dorsal: { pts: [[0.28, 0], [0.34, 0.12], [0.48, 0.17], [0.62, 0.12], [0.76, 0.1], [0.85, 0]], col: [252, 120, 20], a: 0.85 },
  anal: { pts: [[0.55, 0], [0.62, 0.08], [0.74, 0.1], [0.84, 0]], col: [252, 120, 20], a: 0.85 },
  pect: { s: 0.28, dy: -0.4, len: 0.17, wid: 0.12, bk: 0.9, dn: 0.2, ot: 0.5, col: [252, 130, 30], a: 0.8 },
  pelv: { s: 0.36, dy: -0.8, len: 0.13, wid: 0.05, bk: 0.4, dn: 0.8, ot: 0.3, col: [252, 125, 25], a: 0.8 },
  eye: { s: 0.095, dy: 0.3, r: 0.05, iris: [250, 235, 200] }
});
/* синий хирург: овальный диск, чёрный «мазок палитры», жёлтый хвост */
SPEC.tang = mkSpecies({
  name: 'tang', L: 1.15, hm: 0.28, wm: 0.09, ha: 0.8, hb: 0.55, hp: 0.1, wa: 0.85, wb: 0.6, wp: 0.1,
  speed: 1.1, resp: 2.6, turn: 0.8, freq: 6.5, amp: 0.055, school: 0.25, nr: 4.0, yPref: 0.0, sizeVar: 0.1,
  color(s, c) {
    const o = [28, 88, 226, 0];
    mixc(o, 80, 150, 240, sstep(-0.35, -0.9, c) * 0.7);
    const d = Math.abs(c - (0.1 + 0.36 * Math.sin(s * 5.2 - 0.8)));
    const m = (1 - sstep(0.16, 0.27, d)) * sstep(0.12, 0.22, s) * (1 - sstep(0.82, 0.93, s));
    mixc(o, 8, 10, 52, m * 0.95);
    mixc(o, 252, 216, 40, sstep(0.9, 0.96, s));
    return o;
  },
  tail: { len: 0.28, h: 0.26, root: 0.05, notch: 0.55, col: [252, 216, 40], a: 0.85 },
  dorsal: { pts: [[0.3, 0], [0.36, 0.1], [0.55, 0.15], [0.75, 0.13], [0.9, 0]], col: [26, 70, 210], a: 0.85 },
  anal: { pts: [[0.45, 0], [0.55, 0.09], [0.75, 0.11], [0.9, 0]], col: [26, 70, 210], a: 0.85 },
  pect: { s: 0.27, dy: -0.15, len: 0.25, wid: 0.14, bk: 0.85, dn: 0.15, ot: 0.5, col: [252, 220, 60], a: 0.75 },
  pelv: { s: 0.34, dy: -0.8, len: 0.14, wid: 0.05, bk: 0.4, dn: 0.8, ot: 0.3, col: [40, 90, 220], a: 0.8 },
  eye: { s: 0.09, dy: 0.25, r: 0.04, iris: [250, 235, 120] }
});
/* золотой кои: крупный, пятна, длинный вуалевый хвост */
SPEC.koi = mkSpecies({
  name: 'koi', L: 1.7, hm: 0.2, wm: 0.17, ha: 0.75, hb: 0.55, hp: 0.1, wa: 0.75, wb: 0.55, wp: 0.1,
  speed: 0.66, resp: 1.6, turn: 0.6, freq: 5, amp: 0.085, school: 0.0, nr: 3.0, yPref: 1.1, sizeVar: 0.1,
  color(s, c) {
    const o = [250, 244, 236, 0];
    const n1 = fsin(s * 10.0 + c * 2.6 + 1.0) + 0.7 * fsin(s * 4.3 - c * 3.3 + 2.0);
    mixc(o, 252, 112, 24, sstep(-0.15, 0.35, n1));
    const n2 = fsin(s * 13 + c * 3.1 + 4.0) + fsin(s * 6.1 - c * 2.2);
    mixc(o, 26, 22, 28, sstep(1.25, 1.55, n2) * 0.9);
    mixc(o, 252, 100, 22, (1 - sstep(0.1, 0.2, s)) * 0.9);
    return o;
  },
  tail: { len: 0.6, h: 0.42, root: 0.06, notch: 0.45, col: [255, 150, 95], a: 0.8 },
  dorsal: { pts: [[0.3, 0], [0.36, 0.1], [0.5, 0.2], [0.66, 0.16], [0.8, 0.06], [0.86, 0]], col: [255, 160, 105], a: 0.7 },
  anal: { pts: [[0.55, 0], [0.62, 0.1], [0.74, 0.14], [0.86, 0]], col: [255, 160, 105], a: 0.7 },
  pect: { s: 0.24, dy: -0.45, len: 0.24, wid: 0.12, bk: 0.9, dn: 0.2, ot: 0.5, col: [255, 175, 125], a: 0.65 },
  pelv: { s: 0.4, dy: -0.8, len: 0.16, wid: 0.06, bk: 0.5, dn: 0.8, ot: 0.3, col: [255, 175, 125], a: 0.65 },
  eye: { s: 0.085, dy: 0.28, r: 0.03, iris: [240, 190, 80] }
});

/* «ареалы» видов: куда рыба плывёт по маршрутным точкам; pass — шанс пройти крупным планом вдоль переднего стекла;
   grp — вид ходит общим маршрутом (стая) */
SPEC.tetra.reg = { x0: -4.9, x1: 4.9, y0: -1.3, y1: 1.9, z0: -2.0, z1: 1.8, pass: 0.22 }; SPEC.tetra.grp = true;
SPEC.danio.reg = { x0: -4.9, x1: 4.9, y0: 0.0, y1: 2.0, z0: -2.0, z1: 1.9, pass: 0.28 }; SPEC.danio.grp = true;
SPEC.angel.reg = { x0: -4.9, x1: 4.9, y0: -1.7, y1: 1.1, z0: -2.0, z1: 1.9, pass: 0.3 };
SPEC.clown.reg = { x0: -4.9, x1: 4.9, y0: -2.15, y1: -1.2, z0: -1.9, z1: 2.0, pass: 0.4 };
SPEC.tang.reg = { x0: -4.9, x1: 4.9, y0: -1.8, y1: 1.3, z0: -2.0, z1: 1.9, pass: 0.32 };
SPEC.koi.reg = { x0: -4.6, x1: 4.6, y0: -1.1, y1: 2.0, z0: -1.9, z1: 1.7, pass: 0.4 };
SPEC.clown.finSoft = 0.45; SPEC.tang.finSoft = 0.45;

/* ═══════════ популяция ═══════════ */
const FISH = [];
function addFish(sp, n, cx, cy, cz, spread, gid) {
  for (let k = 0; k < n; k++) {
    const a = rnd() * TAU, spd = sp.speed;
    FISH.push({
      sp, gid: gid || 0, sc: 1 + rr(-sp.sizeVar, sp.sizeVar),
      x: clamp(cx + rr(-spread, spread), -HX + 1, HX - 1), y: clamp(cy + rr(-spread, spread) * 0.5, SANDY + 0.6, SURF - 0.6),
      z: clamp(cz + rr(-spread, spread), -HZ + 1, HZ - 1),
      vx: Math.cos(a) * spd, vy: 0, vz: Math.sin(a) * spd, hx: Math.cos(a), hy: 0, hz: Math.sin(a),
      wy: a, wp: 0, spd: rr(0.92, 1.08), ph: rnd() * TAU, ph2: rnd() * TAU, bank: 0, turn: 0,
      gulp: 0, yPref: sp.yPref + rr(-0.5, 0.5), ampMul: rr(0.9, 1.1), sx: 0, sy: 0, sz: 0
    });
  }
}
function populate() {
  addFish(SPEC.tetra, 10, -3.0, 0.4, 0.8, 1.2, 0);
  addFish(SPEC.tetra, 8, 2.8, 0.9, -0.6, 1.1, 1);
  addFish(SPEC.danio, 8, 2.5, 1.3, -0.5, 1.1);
  addFish(SPEC.angel, 4, 0.5, 0.2, 0.8, 2.4);
  addFish(SPEC.clown, 5, -3.2, -1.1, 0.4, 1.2);
  addFish(SPEC.tang, 3, 2.8, -0.2, 0.6, 1.8);
  addFish(SPEC.koi, 3, -0.5, 1.4, -0.5, 2.2);
  initPlans();
}

/* ═══════════ корм ═══════════ */
const food = [];
function feed() {
  const cx = rr(-2.2, 2.2), cz = rr(-1.0, 1.0);
  for (let i = 0; i < 22; i++) food.push({ x: cx + rr(-0.9, 0.9), y: SURF - rr(0, 0.5), z: cz + rr(-0.8, 0.8), ph: rnd() * TAU, rest: 0, r: rr(0.025, 0.045) });
}

/* ═══════════ поведение: блуждание, стайность, повороты у стекла, корм ═══════════ */
const angDiff = (a, b) => ((b - a + PI) % TAU + TAU) % TAU - PI;
const sq = v => v * v;
let eaten = 0;

/* маршруты: цепочка путевых точек по «ареалу» вида; иногда — проход вдоль переднего стекла (две точки: вход и выход) */
const GP = {};
let simTick = 0;
/* случайное значение в [lo,hi] со смещением к краям (p<1): иначе рыбы, плывя между случайными точками, копятся в центре */
const eb = (lo, hi, p) => { const u = rnd() * 2 - 1; return (lo + hi) * 0.5 + (hi - lo) * 0.5 * Math.sign(u) * Math.pow(Math.abs(u), p); };
function newPlan(pl, sp, f) {
  const R = sp.reg;
  pl.k = 0; pl.stamp = simTick;
  if (rnd() < R.pass) {
    const gz = HZ - rr(0.75, 1.05) - sp.L * 0.1, y = rr(R.y0, R.y1), sg = f.x > 0 ? 1 : -1;
    pl.list = [{ x: sg * rr(2.2, 3.6), y, z: gz }, { x: -sg * rr(2.6, 4.2), y: clamp(y + rr(-0.5, 0.5), R.y0, R.y1), z: gz - rr(0, 0.3) }];
    pl.t = 24;
  } else {
    pl.list = [{ x: eb(R.x0, R.x1, 0.42), y: eb(R.y0, R.y1, 0.75), z: rnd() < 0.35 ? rr(R.z0, -0.6) : eb(R.z0, R.z1, 0.7) }];
    pl.t = rr(9, 17);
  }
}
function initPlans() {
  for (let i = 0; i < FISH.length; i++) {
    const f = FISH[i], sp = f.sp;
    if (sp.grp) { const key = sp.name + f.gid; if (!GP[key]) { GP[key] = { list: null, k: 0, t: 0, stamp: -1 }; newPlan(GP[key], sp, f); } }
    else { f.plan = { list: null, k: 0, t: 0, stamp: -1 }; newPlan(f.plan, sp, f); }
  }
}

function updateFish(dt, t) {
  const n = FISH.length;
  simTick++;
  for (const k in GP) GP[k].t -= dt;
  for (let i = 0; i < n; i++) {
    const f = FISH[i], sp = f.sp, L = sp.L * f.sc;
    // блуждающее направление — лишь шум поверх маршрута
    f.wy += (rnd() - 0.5) * sp.turn * 5.0 * dt;
    f.wp += (rnd() - 0.5) * 2.2 * dt; f.wp *= 1 - dt * 0.8;
    f.wp = clamp(f.wp, -0.45, 0.45);
    const cwp = Math.cos(f.wp);
    // маршрут: общий у стай, свой у одиночек
    const pl = sp.grp ? GP[sp.name + f.gid] : f.plan;
    if (!sp.grp) pl.t -= dt;
    const wpt = pl.list[pl.k], passing = pl.list.length === 2;
    const tx = wpt.x - f.x, ty = wpt.y - f.y, tz = wpt.z - f.z, td = Math.hypot(tx, ty, tz) + 1e-4;
    if (pl.stamp !== simTick) {
      if (td < 0.7 + L * 0.2) { pl.stamp = simTick; if (++pl.k >= pl.list.length) newPlan(pl, sp, f); }
      else if (pl.t < 0) newPlan(pl, sp, f);
    }
    const wW = passing ? 0.25 : 0.55;
    let ax = cwp * Math.cos(f.wy) * wW + tx / td * 1.25, ay = Math.sin(f.wp) * wW + ty / td * 1.1, az = cwp * Math.sin(f.wy) * wW + tz / td * 1.25;
    // корм: ближайшая хлопья в зоне интереса
    let boost = 1, bi = -1, bd = 36;
    for (let k = 0; k < food.length; k++) {
      const q = food[k], dx = q.x - f.x, dy = q.y - f.y, dz = q.z - f.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bd) { bd = d2; bi = k; }
    }
    if (bi >= 0) {
      const q = food[bi], d = Math.sqrt(bd) + 1e-4;
      if (d < 0.22 + L * 0.28) { food.splice(bi, 1); f.gulp = 1; eaten++; }
      else { ax = ax * 0.2 + (q.x - f.x) / d * 2.2; ay = ay * 0.2 + (q.y - f.y) / d * 2.2; az = az * 0.2 + (q.z - f.z) / d * 2.2; boost = 1.55; }
    }
    // стеклянные стенки: мягкий разворот заранее
    const avd = 1.2 + L * 0.55;
    // «вынос» тела вдоль курса: хвост и нос не должны пробивать стекло
    const exx = 0.16 + L * 0.46 * Math.abs(f.hx), ezz = 0.16 + L * 0.5 * Math.abs(f.hz);
    const dxp = HX - exx - f.x, dxn = f.x + HX - exx, dzp = HZ - ezz - f.z, dzn = f.z + HZ - ezz;
    let wx = 0, wz = 0, wy = 0;
    const avx = 0.85 + L * 0.4;   // боковые стёкла: поворот позже, чтобы рыбы доплывали до краёв
    if (dxp < avx) wx -= sq((avx - dxp) / avx) * 2.8;
    if (dxn < avx) wx += sq((avx - dxn) / avx) * 2.8;
    if (dzp < avd) wz -= sq((avd - dzp) / avd) * 3.6 * (passing ? 0.2 : 1);   // при проходе вдоль стекла к нему можно прижиматься
    if (dzn < avd) wz += sq((avd - dzn) / avd) * 3.6;
    const dyt = SURF - 0.2 - f.y, dyb = f.y - SANDY - 0.2, avy = 0.8 + L * 0.3;
    if (dyt < avy) wy -= sq((avy - dyt) / avy) * 3.0;
    if (dyb < avy) wy += sq((avy - dyb) / avy) * 3.0;
    const wl = Math.hypot(wx, wz);
    if (wl > 0.5) f.wy += angDiff(f.wy, Math.atan2(wz, wx)) * Math.min(1, dt * 2.4);
    ax += wx; ay += wy; az += wz;
    // соседи: отталкивание и стайность
    let cx = 0, cy = 0, cz = 0, cn = 0, hx = 0, hy = 0, hz = 0, sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const g = FISH[j], dx = g.x - f.x, dy = g.y - f.y, dz = g.z - f.z, d2 = dx * dx + dy * dy + dz * dz;
      const sepR = (L + g.sp.L * g.sc) * 0.55 + 0.12;
      if (d2 < sepR * sepR) { const d = Math.sqrt(d2) + 1e-4, w = (sepR - d) / sepR; sx -= dx / d * w; sy -= dy / d * w * 0.6; sz -= dz / d * w; }
      if (g.sp === sp && (!sp.grp || g.gid === f.gid) && d2 < sp.nr * sp.nr) { cx += g.x; cy += g.y; cz += g.z; hx += g.hx; hy += g.hy; hz += g.hz; cn++; }
    }
    if (cn > 0 && sp.school > 0) {
      cx = cx / cn - f.x; cy = cy / cn - f.y; cz = cz / cn - f.z;
      const d = Math.hypot(cx, cy, cz) + 1e-4, k = clamp(d / 1.8, 0, 1) * 1.3 * sp.school;
      ax += cx / d * k + hx / cn * 1.5 * sp.school; ay += cy / d * k * 0.7 + hy / cn * 1.5 * sp.school; az += cz / d * k + hz / cn * 1.5 * sp.school;
    }
    ax += sx * 2.8; ay += sy * 2.8; az += sz * 2.8;
    // желаемая скорость и плавный разворот скорости
    const al = Math.hypot(ax, ay, az) || 1;
    const turning = Math.min(1, Math.abs(f.turn) * 0.25);
    const spd = sp.speed * f.spd * (0.82 + 0.18 * fsin(t * 0.45 + f.ph2)) * (1 - 0.3 * turning) * boost * (1 + f.gulp * 0.5) * (passing ? 1.12 : 1);
    const k = 1 - Math.exp(-dt * sp.resp);
    f.vx += (ax / al * spd - f.vx) * k; f.vy += (ay / al * spd - f.vy) * k; f.vz += (az / al * spd - f.vz) * k;
    const vh = Math.hypot(f.vx, f.vz), vmax = 0.45 * vh + 0.04;
    if (Math.abs(f.vy) > vmax) f.vy = f.vy > 0 ? vmax : -vmax;
    let v = Math.hypot(f.vx, f.vy, f.vz);
    const vmin = 0.35 * sp.speed;
    if (v < vmin) { const m = vmin / (v + 1e-5); f.vx *= m; f.vy *= m; f.vz *= m; v = vmin; }
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
    const mgx = 0.12 + L * 0.4 * Math.abs(f.hx), mgz = 0.12 + L * 0.4 * Math.abs(f.hz);
    f.x = clamp(f.x, -HX + mgx, HX - mgx); f.z = clamp(f.z, -HZ + mgz, HZ - mgz);
    f.y = clamp(f.y, SANDY + 0.18 + L * 0.1, SURF - 0.2);
    // курс корпуса, крен и изгиб в повороте
    const px0 = f.hx, pz0 = f.hz, kh = Math.min(1, dt * 6.5);
    f.hx += (f.vx / v - f.hx) * kh; f.hy += (f.vy / v - f.hy) * kh; f.hz += (f.vz / v - f.hz) * kh;
    const hl = Math.hypot(f.hx, f.hy, f.hz) || 1; f.hx /= hl; f.hy /= hl; f.hz /= hl;
    const tr = clamp((px0 * f.hz - pz0 * f.hx) / Math.max(dt, 1e-3), -4, 4);
    f.turn += (tr - f.turn) * Math.min(1, dt * 6);
    f.bank += (clamp(f.turn * 0.22, -0.55, 0.55) - f.bank) * Math.min(1, dt * 4);
    f.ph += dt * sp.freq * (0.55 + 0.6 * Math.min(1.6, v / sp.speed));
    f.gulp = Math.max(0, f.gulp - dt * 1.4);
  }
  // корм тонет и ложится на дно
  for (let k = food.length - 1; k >= 0; k--) {
    const q = food[k];
    if (q.y > SANDY + 0.05) { q.y -= dt * 0.3; q.x += fsin(t * 1.7 + q.ph) * 0.06 * dt; q.z += fsin(t * 1.3 + q.ph * 2) * 0.05 * dt; }
    else { q.y = SANDY + 0.05; q.rest += dt; if (q.rest > 9) food.splice(k, 1); }
  }
}

/* ═══════════ рендер рыбы: меш вращения вдоль изгибающегося хребта + плавники ═══════════ */
const LDIR = (function () { const x = 0.32, y = 0.9, z = 0.3, l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; })();
const LX = LDIR[0], LY = LDIR[1], LZ = LDIR[2];
const MAXM = 16, VMAX = SIG.hi.length * (MAXM + 1);
const VXs = new Float32Array(VMAX), VYs = new Float32Array(VMAX), VL = new Float32Array(VMAX),
  VS = new Float32Array(VMAX), VN = new Float32Array(VMAX);

// локальный базис рыбы в мире: x — вперёд, y — вверх, z — вправо
let OX = 0, OY = 0, OZ = 0, FXv = 1, FYv = 0, FZv = 0, UXv = 0, UYv = 1, UZv = 0, RXv = 0, RYv = 0, RZv = 1;
let wL = 1, wA = 0.1, wPh = 0, wBend = 0;            // параметры волны тела
const WK = 4.4;                                        // «волновое число» вдоль тела
/* боковое смещение хребта: волна нарастает к хвосту, изгиб в повороте — квадратично */
function LATv(s) { return wL * (wA * (0.06 + 0.94 * s * s) * fsin(wPh - s * WK) - wBend * s * s); }
let WXp = 0, WYp = 0, WZp = 0;
function toWorld(lx, ly, lz) {
  WXp = OX + FXv * lx + UXv * ly + RXv * lz;
  WYp = OY + FYv * lx + UYv * ly + RYv * lz;
  WZp = OZ + FZv * lx + UZv * ly + RZv * lz;
}
const hAtS = (sp, s) => sp.hm * wL * radf(s, sp.ha, sp.hb, sp.hp);
const wAtS = (sp, s) => sp.wm * wL * radf(s, sp.wa, sp.wb, sp.wp);

/* пул плавников. Плавник = веер лучей: K+1 точек основания B и K+1 концов лучей T (уже на экране),
   между концами — вогнутая «бахрома» перепонки (control-точки C) */
const FINPOOL = [];
for (let i = 0; i < 10; i++) FINPOOL.push({ K: 0, B: new Float32Array(24), T: new Float32Array(24), C: new Float32Array(24),
  z: 0, r: 0, g: 0, b: 0, a: 0, soft: 1, n: 0 });
let finN = 0, finLod = 2;
function beginFin(col, a, soft) {
  const f = FINPOOL[finN++]; f.K = -1; f.z = 0; f.n = 0; f.r = col[0]; f.g = col[1]; f.b = col[2]; f.a = a; f.soft = soft; return f;
}
/* добавить луч: основание (bx,by,bz) и конец (tx,ty,tz) в локальных координатах рыбы */
function addRay(f, bx, by, bz, tx, ty, tz) {
  const k = ++f.K;
  toWorld(bx, by, bz); proj(WXp, WYp, WZp);
  f.B[k * 2] = px; f.B[k * 2 + 1] = py; f.z += pz;
  toWorld(tx, ty, tz); proj(WXp, WYp, WZp);
  f.T[k * 2] = px; f.T[k * 2 + 1] = py; f.z += pz;
  f.n += 2;
}
function endFin(f, scallop) {
  f.z /= f.n;
  const K = f.K;
  for (let k = 0; k < K; k++) {   // control-точка между соседними концами: чуть втянута к основанию
    const mx = (f.T[k * 2] + f.T[k * 2 + 2]) * 0.5, my = (f.T[k * 2 + 1] + f.T[k * 2 + 3]) * 0.5;
    const bx = (f.B[k * 2] + f.B[k * 2 + 2]) * 0.5, by = (f.B[k * 2 + 1] + f.B[k * 2 + 3]) * 0.5;
    f.C[k * 2] = mx + (bx - mx) * scallop; f.C[k * 2 + 1] = my + (by - my) * scallop;
  }
}
/* спинной/анальный: основание по контуру тела, лучи вверх и назад по огибающей высоты */
function ridgeFin(sp, spec, sign, K) {
  const f = beginFin(spec.col, spec.a, sp.finSoft), pts = spec.pts, np = pts.length;
  const sa = pts[0][0], sb = pts[np - 1][0];
  for (let k = 0; k <= K; k++) {
    const u = k / K, s = sa + (sb - sa) * u;
    let h = 0;
    for (let q = 0; q < np - 1; q++) if (s >= pts[q][0] && s <= pts[q + 1][0]) {   // косинусная интерполяция огибающей
      const w = (s - pts[q][0]) / (pts[q + 1][0] - pts[q][0] + 1e-6), c = (1 - Math.cos(w * PI)) * 0.5;
      h = pts[q][1] + (pts[q + 1][1] - pts[q][1]) * c; break;
    }
    h *= wL * (1 + 0.06 * fsin(wPh * 1.3 - k * 0.9));
    const by = sign * hAtS(sp, s) * 0.9, bx = wL * (0.5 - s), bz = LATv(s);
    const rake = 0.28 + 0.3 * u;   // концы отклонены к хвосту, к заднему краю сильнее
    const st = s + h * rake / wL;
    addRay(f, bx, by, bz, bx - h * rake, by + sign * h, LATv(st) + 0.012 * wL * fsin(wPh * 1.5 + k * 0.8) * (h / wL * 5));
  }
  endFin(f, 0.22);
}
/* хвост: веер лучей от стебля; вилка/круглый — по notch, вдох-выдох раскрытия в такт взмаху */
function tailFin(sp, K) {
  const T = sp.tail, L = wL, f = beginFin(T.col, T.a, sp.finSoft);
  const rh = Math.max(T.root * L, 0.02), hh = T.h * L * (1 + 0.1 * fsin(wPh * 2 + 0.7)), len = T.len, nt = T.notch;
  const sr = 0.965;
  for (let k = 0; k <= K; k++) {
    const u = (k / K) * 2 - 1, au = Math.abs(u);
    const cf = 1 - nt * (1 - Math.pow(au, 1.4)), cr = 1 - 0.2 * au * au;
    const ext = len * cf * cr * (1 + 0.06 * fsin(wPh * 1.3 - k * 0.9));
    const st = sr + 0.035 + ext;
    const bx = L * (0.5 - sr);
    addRay(f, bx, u * rh, LATv(sr), L * (0.5 - st), u * hh * (0.75 + 0.25 * cr), LATv(st) + L * 0.02 * fsin(wPh * 1.2 - u * 3 + k) * (len * 4));
  }
  endFin(f, 0.24);
}
/* грудные/брюшные: короткий веер у бока, передний луч длиннее; хлопают наружу */
function sideFin(sp, P, side, inset, K) {
  const L = wL, f = beginFin(P.col, P.a, sp.finSoft), s = P.s;
  const x0 = L * (0.5 - s), y0 = P.dy * hAtS(sp, s), z0 = LATv(s) + side * wAtS(sp, s) * inset;
  const fl = 0.3 + 0.7 * (0.5 + 0.5 * fsin(wPh * 0.85 + (side > 0 ? 0 : 0.5)));
  const ln = P.len * L, ot = P.ot * fl;
  for (let k = 0; k <= K; k++) {
    const u = k / K;
    const bx = x0 - ln * 0.25 * u, by = y0 + P.wid * L * (0.3 - 0.6 * u), bz = z0;
    const lm = 1 - 0.2 * u;
    const dx = -P.bk * (1 - 0.4 * u), dy = -P.dn * (0.6 + 0.4 * u), dz = ot * (1 - 0.2 * u);
    addRay(f, bx, by, bz, bx + ln * lm * dx, by + ln * lm * dy, bz + side * ln * lm * dz);
  }
  endFin(f, 0.14);
}

let curT = 0, curFa = 0, curDs = 1, curFR = 0, curFG = 0, curFB = 0, curBig = false, curLw = 1;
/* отрисовка плавника: перепонка с градиентом прозрачности к краю, мягкая бахрома, лучи */
function drawFin(fn) {
  const fa = curFa, ds = curDs, K = fn.K, B = fn.B, T = fn.T, C = fn.C;
  let r = fn.r * ds, g = fn.g * ds, b = fn.b * ds;
  r += (curFR - r) * fa; g += (curFG - g) * fa; b += (curFB - b) * fa;
  let bcx = 0, bcy = 0, tcx = 0, tcy = 0;
  for (let k = 0; k <= K; k++) { bcx += B[k * 2]; bcy += B[k * 2 + 1]; tcx += T[k * 2]; tcy += T[k * 2 + 1]; }
  const inv = 1 / (K + 1); bcx *= inv; bcy *= inv; tcx *= inv; tcy *= inv;
  const ext = Math.abs(tcx - bcx) + Math.abs(tcy - bcy);
  const smooth = finLod >= 1 && ext > 12;
  ctx.beginPath(); ctx.moveTo(B[0], B[1]);
  for (let k = 1; k <= K; k++) ctx.lineTo(B[k * 2], B[k * 2 + 1]);
  ctx.lineTo(T[K * 2], T[K * 2 + 1]);
  if (smooth) for (let k = K - 1; k >= 0; k--) ctx.quadraticCurveTo(C[k * 2], C[k * 2 + 1], T[k * 2], T[k * 2 + 1]);
  else for (let k = K - 1; k >= 0; k--) ctx.lineTo(T[k * 2], T[k * 2 + 1]);
  ctx.closePath();
  const a = fn.a * (1 - 0.35 * fa);
  if (smooth) {
    const ta = 1 - fn.soft * 0.75;   // доля непрозрачности на краю: у «воздушных» плавников малая, но не нулевая
    const gr = ctx.createLinearGradient(bcx, bcy, tcx, tcy);
    gr.addColorStop(0, rgba(r, g, b, a)); gr.addColorStop(0.5, rgba(r, g, b, a * (0.6 + 0.4 * ta)));
    gr.addColorStop(1, rgba(r, g, b, a * ta * 0.9));
    ctx.fillStyle = gr;
  } else ctx.fillStyle = rgba(r, g, b, a * 0.55);
  ctx.fill();
  if (finLod >= 2 && ext > 18) {   // лучи плавника: тонкие светлые прожилки веером
    ctx.beginPath();
    for (let k = 0; k <= K; k++) { ctx.moveTo(B[k * 2], B[k * 2 + 1]); ctx.lineTo(B[k * 2] + (T[k * 2] - B[k * 2]) * 0.96, B[k * 2 + 1] + (T[k * 2 + 1] - B[k * 2 + 1]) * 0.96); }
    ctx.strokeStyle = rgba(Math.min(255, r + 55), Math.min(255, g + 55), Math.min(255, b + 55), 0.42 * (1 - fa * 0.6));
    ctx.lineWidth = curLw * 0.75; ctx.stroke();
  }
}

function drawEye(sp, f, side, L, ck, fx, fy, fz) {
  const E = sp.eye, s = E.s, sc = f.sc;
  const lx = L * (0.5 - s), ly = hAtS(sp, s) * E.dy, lz = LATv(s) + side * wAtS(sp, s) * 0.9;
  toWorld(lx, ly, lz);
  const ex = WXp, ey = WYp, ez = WZp;
  // нормаль глаза: наружу, чуть вперёд и вверх
  const nx = 0.3 * FXv + 0.2 * UXv + side * RXv, ny = 0.3 * FYv + 0.2 * UYv + side * RYv, nz = 0.3 * FZv + 0.2 * UZv + side * RZv;
  const nl = Math.hypot(nx, ny, nz);
  let vx = cam.x - ex, vy = cam.y - ey, vz = cam.z - ez; const vl = Math.hypot(vx, vy, vz);
  if ((nx * vx + ny * vy + nz * vz) / (nl * vl) < 0.1) return;
  proj(ex, ey, ez);
  const ex0 = px, ey0 = py, rad = E.r * L * pk;
  if (rad < 0.7) return;
  if (rad < 2.0) {   // далёкий/мелкий глаз — одна тёмная точка с блеском цвета радужки
    ctx.fillStyle = rgba(10 + (curFR - 10) * curFa * 0.85, 14 + (curFG - 14) * curFa * 0.85, 20 + (curFB - 20) * curFa * 0.85, 0.92);
    ctx.beginPath(); ctx.arc(ex0, ey0, rad * 1.1, 0, TAU); ctx.fill();
    return;
  }
  proj(ex + fx * 0.05, ey + fy * 0.05, ez + fz * 0.05);
  let dx = px - ex0, dy = py - ey0; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  const fa = curFa, ds = curDs;
  const ir = E.iris;
  let r = ir[0] * ds, g = ir[1] * ds, b = ir[2] * ds;
  r += (curFR - r) * fa; g += (curFG - g) * fa; b += (curFB - b) * fa;
  ctx.fillStyle = rgba(10 + (curFR - 10) * fa * 0.8, 14 + (curFG - 14) * fa * 0.8, 20 + (curFB - 20) * fa * 0.8, 0.95);
  ctx.beginPath(); ctx.arc(ex0, ey0, rad * 1.18, 0, TAU); ctx.fill();
  ctx.fillStyle = rgb(r, g, b);
  ctx.beginPath(); ctx.arc(ex0, ey0, rad * 0.98, 0, TAU); ctx.fill();
  ctx.fillStyle = rgba(4 + (curFR - 4) * fa * 0.7, 6 + (curFG - 6) * fa * 0.7, 10 + (curFB - 10) * fa * 0.7, 0.96);
  ctx.beginPath(); ctx.arc(ex0 + dx * rad * 0.16, ey0 + dy * rad * 0.16, rad * 0.64, 0, TAU); ctx.fill();
  if (rad > 2.2) {
    ctx.fillStyle = 'rgba(255,255,255,' + (0.85 * (1 - fa * 0.6)).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(ex0 - rad * 0.28, ey0 - rad * 0.32, rad * 0.22, 0, TAU); ctx.fill();
  }
}

const NVR = new Float32Array(MAXM + 2), TST = new Float32Array(MAXM + 2), DJ = new Float32Array(MAXM + 2);   // видимость колец и позиции стопов градиента
const SEAM = 1.1;                                                            // «захлёст» ленты на соседнюю — против швов

function drawFish(f) {
  const sp = f.sp, L = sp.L * f.sc, sc = f.sc;
  const fx = f.hx, fy = f.hy, fz = f.hz;
  // базис: «вверх» ортогонализируем к курсу и наклоняем креном
  let ux = -fy * fx, uy = 1 - fy * fy, uz = -fy * fz;
  const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
  const rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux;
  const cb = Math.cos(f.bank), sb = Math.sin(f.bank);
  FXv = fx; FYv = fy; FZv = fz;
  UXv = ux * cb + rx * sb; UYv = uy * cb + ry * sb; UZv = uz * cb + rz * sb;
  RXv = rx * cb - ux * sb; RYv = ry * cb - uy * sb; RZv = rz * cb - uz * sb;
  OX = f.x; OY = f.y; OZ = f.z;
  proj(OX, OY, OZ);
  const cz = pz, Lpx = L * pk;
  if (cz < 2 || px < -Lpx * 1.6 || px > CW + Lpx * 1.6 || py < -Lpx * 1.6 || py > CH + Lpx * 1.6) return;
  curFa = fogAmt(cz); fogRGB(OY, 0.22); curFR = FR; curFG = FG; curFB = FB;
  curDs = 0.66 + 0.34 * sstep(-HY, HY, OY);
  const M = Lpx > 150 ? 16 : Lpx > 105 ? 12 : Lpx > 50 ? 8 : 6;
  const geo = Lpx > 105 ? sp.geo.hi : sp.geo.lo, NS = geo.NS, SI = geo.SI;
  curBig = Lpx > 70; curLw = Math.max(0.6, Lpx * 0.0055);
  finLod = Lpx > 78 ? 2 : Lpx > 52 ? 1 : 0;
  const KT = finLod === 2 ? 9 : finLod === 1 ? 6 : 3, KR = finLod === 2 ? 9 : finLod === 1 ? 6 : 3, KS = finLod === 2 ? 4 : finLod === 1 ? 3 : 2;
  const vsp = Math.hypot(f.vx, f.vy, f.vz) / sp.speed;
  wL = L; wA = sp.amp * f.ampMul * (0.55 + 0.45 * Math.min(1.5, vsp)); wPh = f.ph; wBend = clamp(f.turn * 0.05, -0.3, 0.3);
  const ck = pk;

  // плавники строим до тела, чтобы решить порядок по глубине
  finN = 0;
  ridgeFin(sp, sp.dorsal, 1, KR);
  ridgeFin(sp, sp.anal, -1, KR);
  tailFin(sp, KT);
  sideFin(sp, sp.pect, 1, 0.92, KS); sideFin(sp, sp.pect, -1, 0.92, KS);
  if (sp.pelv && finLod > 0) { sideFin(sp, sp.pelv, 1, 0.55, KS); sideFin(sp, sp.pelv, -1, 0.55, KS); }
  const nFin = finN;
  for (let i = 0; i < nFin; i++) if (FINPOOL[i].z > cz) drawFin(FINPOOL[i]);   // дальше тела — под ним

  // вершины тела
  const rg = ring(M), tab = getTab(sp, geo, M), M1 = M + 1;
  const lightDepth = 0.25 + 0.75 * sstep(-HY * 0.6, SURF, OY);
  for (let i = 0; i < NS; i++) {
    const s = SI[i], lx = L * (0.5 - s), lat = LATv(s), h = geo.H[i] * sc, w = geo.W[i] * sc, nxl = geo.NX[i];
    for (let j = 0; j <= M; j++) {
      const ly = h * rg.c[j], lz = lat + w * rg.s[j];
      toWorld(lx, ly, lz); proj(WXp, WYp, WZp);
      const id = i * M1 + j;
      VXs[id] = px; VYs[id] = py;
      const nyl = tab.ny[id], nzl = tab.nz[id];
      const nwx = fx * nxl + UXv * nyl + RXv * nzl, nwy = fy * nxl + UYv * nyl + RYv * nzl, nwz = fz * nxl + UZv * nyl + RZv * nzl;
      let vx = cam.x - WXp, vy = cam.y - WYp, vz = cam.z - WZp;
      const vl = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz); vx *= vl; vy *= vl; vz *= vl;
      const nv = nwx * vx + nwy * vy + nwz * vz;
      const nd = nwx * LX + nwy * LY + nwz * LZ;
      // мягкий (wrap) ключевой свет сверху + «заполняющий» от камеры + подсветка снизу от песка
      let wrap = (nd + 0.45) * 0.69; wrap = wrap < 0 ? 0 : wrap > 1 ? 1 : wrap;
      let lum = 0.4 + wrap * 0.62 + (nv > 0 ? nv * 0.16 : 0) + (nwy < 0 ? -nwy * 0.1 : 0);
      const rim = 1 - (nv > 0 ? nv : 0); lum += rim * rim * rim * 0.2;
      // бегущие солнечные пятна (каустики) на верхних гранях
      if (nd > 0) {
        const cq = fsin(WXp * 1.45 + curT * 0.9 + fsin(WZp * 1.6 - curT * 0.6) * 1.2) + fsin(WZp * 1.3 - curT * 0.7 + fsin(WXp * 1.1 + curT * 0.5) * 1.1);
        const cc = 1 - (cq < 0 ? -cq : cq) * 1.15;
        if (cc > 0) lum += cc * cc * 0.42 * nd * lightDepth;
      }
      const hx_ = LX + vx, hy_ = LY + vy, hz_ = LZ + vz;
      let spc = (nwx * hx_ + nwy * hy_ + nwz * hz_) / Math.sqrt(hx_ * hx_ + hy_ * hy_ + hz_ * hz_);
      spc = spc > 0 ? spc : 0; spc *= spc; spc *= spc; spc *= spc; spc *= spc; spc *= spc;
      VL[id] = lum * 0.88; VS[id] = spc * 0.4; VN[id] = nv;
    }
  }
  /* Тело — ленты между соседними сечениями. Каждая лента заливается ОДНИМ линейным градиентом поперёк тела:
     стопы стоят в видимых вершинах кольца, цвет = узор × освещение в вершине. Получается плавная «цилиндрическая»
     светотень и мягкие пятна без квадов и швов; ленты чуть заходят друг на друга, поэтому границы не просвечивают. */
  const camAhead = ((cam.x - OX) * fx + (cam.y - OY) * fy + (cam.z - OZ) * fz) > 0;
  const iA = camAhead ? NS - 2 : 0, iB = camAhead ? -1 : NS - 1, di = camAhead ? -1 : 1;
  const pat = getPat(sp, M), SUBS = Lpx > 160 ? 3 : Lpx > 75 ? 2 : 1, PM1 = M1 * 4;
  // видимая дуга кольца — ОДНА на всё тело (сумма по кольцам): край силуэта идёт по одним и тем же вершинам, без «ступенек»
  for (let j = 0; j < M; j++) { let sum = 0; for (let i = 1; i < NS - 1; i++) sum += VN[i * M1 + j]; NVR[j] = sum; }
  let st = -1, cnt = 0;
  for (let j = 0; j < M; j++) if (NVR[j] > 0 && NVR[(j + M - 1) % M] <= 0) { st = j; break; }
  if (st < 0) { if (NVR[0] > 0) { st = 0; cnt = M; } else st = -2; }
  else while (cnt < M && NVR[(st + cnt) % M] > 0) cnt++;
  if (st >= 0 && cnt < M) { st = (st + M - 1) % M; cnt = Math.min(M, cnt + 2); }   // по вершине запаса с каждого края — без щелей на силуэте
  {
    // Если тело на экране вытянуто (не анфас), концы дуги — настоящие крайние точки силуэта поперёк тела:
    // кромка ленты идёт ровно по контуру, без «зубцов» от вершин за краем.
    let cxA = 0, cyA = 0, cxB = 0, cyB = 0;
    const rA = M1, rB = (NS - 2) * M1;
    for (let j = 0; j < M; j++) { cxA += VXs[rA + j]; cyA += VYs[rA + j]; cxB += VXs[rB + j]; cyB += VYs[rB + j]; }
    cxA /= M; cyA /= M; cxB /= M; cyB /= M;
    const tdx = cxB - cxA, tdy = cyB - cyA, tdl = Math.hypot(tdx, tdy);
    if (tdl > Lpx * 0.2) {
      const Nx = -tdy / tdl, Ny = tdx / tdl;
      for (let j = 0; j < M; j++) DJ[j] = 0;
      for (let i = 1; i < NS - 1; i++) {
        const r = i * M1; let cx = 0, cy = 0;
        for (let j = 0; j < M; j++) { cx += VXs[r + j]; cy += VYs[r + j]; }
        cx /= M; cy /= M;
        for (let j = 0; j < M; j++) DJ[j] += (VXs[r + j] - cx) * Nx + (VYs[r + j] - cy) * Ny;
      }
      let jmin = 0, jmax = 0;
      for (let j = 1; j < M; j++) { if (DJ[j] < DJ[jmin]) jmin = j; if (DJ[j] > DJ[jmax]) jmax = j; }
      if (jmin !== jmax) {
        const nF = ((jmax - jmin + M) % M) + 1, nB = ((jmin - jmax + M) % M) + 1;
        let vF = 0, vB = 0;
        for (let k = 0; k < nF; k++) vF += NVR[(jmin + k) % M];
        for (let k = 0; k < nB; k++) vB += NVR[(jmax + k) % M];
        if (vF >= vB) { st = jmin; cnt = nF; } else { st = jmax; cnt = nB; }
      }
    }
  }
  const ja = st, jb = (st + cnt - 1) % M;
  const tiny = Lpx < 56, nst = Math.min(cnt, Lpx > 105 ? 8 : 6);   // число стопов ограничено: градиенты с малым числом стопов дешевле в GPU
  for (let i = iA; st >= 0 && i !== iB; i += di) {
    const r0 = i * M1, r1 = r0 + M1;
    const ax0 = (VXs[r0 + ja] + VXs[r1 + ja]) * 0.5, ay0 = (VYs[r0 + ja] + VYs[r1 + ja]) * 0.5;
    const ax1 = (VXs[r0 + jb] + VXs[r1 + jb]) * 0.5, ay1 = (VYs[r0 + jb] + VYs[r1 + jb]) * 0.5;
    let gdx = ax1 - ax0, gdy = ay1 - ay0;
    const gl2 = gdx * gdx + gdy * gdy;
    // позиции стопов: проекция вершин на ось градиента (от одного края силуэта к другому)
    for (let k = 0; k < cnt; k++) {
      const j = (st + k) % M;
      let t = gl2 > 1 ? (((VXs[r0 + j] + VXs[r1 + j]) * 0.5 - ax0) * gdx + ((VYs[r0 + j] + VYs[r1 + j]) * 0.5 - ay0) * gdy) / gl2 : k / (cnt - 1 || 1);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (k > 0 && t < TST[k - 1]) t = TST[k - 1];
      TST[k] = t;
    }
    TST[0] = 0; TST[cnt - 1] = 1;
    // шов: ленту рисуем с небольшим заходом вдоль хребта на ту, что будет нарисована следом
    let sx = 0, sy = 0;
    {
      const tdx = (VXs[r1 + ja] + VXs[r1 + jb] - VXs[r0 + ja] - VXs[r0 + jb]) * 0.5, tdy = (VYs[r1 + ja] + VYs[r1 + jb] - VYs[r0 + ja] - VYs[r0 + jb]) * 0.5;
      const tl = Math.hypot(tdx, tdy);
      if (tl > 0.8) { sx = tdx / tl * SEAM; sy = tdy / tl * SEAM; }
    }
    const gx1 = gl2 > 1 ? ax1 : ax0 + 1, gy1 = gl2 > 1 ? ay1 : ay0;
    for (let q = 0; q < SUBS; q++) {
      const s = di > 0 ? q : SUBS - 1 - q;
      const u0 = s / SUBS, u1 = (s + 1) / SUBS, uc = (u0 + u1) * 0.5;
      // узор берём из мелкой таблицы по s в центре подленты (не из густоты сетки): полосы чёткие, пятна мягкие
      const qf = (SI[i] + (SI[i + 1] - SI[i]) * uc) * (NPAT - 1), q0 = Math.min(NPAT - 2, qf | 0), fr = qf - q0, pa = q0 * PM1, pb = pa + PM1;
      if (tiny) {   // совсем мелкая рыбка: лента одним цветом, без градиента
        const k = cnt >> 1, j = (st + k) % M, o0 = pa + j * 4, o1 = pb + j * 4, e = pat[o0 + 3];
        const lum = (VL[r0 + j] + VL[r1 + j]) * 0.5, spc = (VS[r0 + j] + VS[r1 + j]) * 127.5, kk = (lum * (1 - e) + 1.15 * e) * curDs;
        let r = (pat[o0] + (pat[o1] - pat[o0]) * fr) * kk + spc, g = (pat[o0 + 1] + (pat[o1 + 1] - pat[o0 + 1]) * fr) * kk + spc,
          b = (pat[o0 + 2] + (pat[o1 + 2] - pat[o0 + 2]) * fr) * kk + spc;
        r += (curFR - r) * curFa; g += (curFG - g) * curFa; b += (curFB - b) * curFa;
        ctx.fillStyle = rgb(r, g, b);
      } else {
        const grd = ctx.createLinearGradient(ax0, ay0, gx1, gy1);
        for (let m = 0; m < nst; m++) {
          const k = nst === cnt ? m : Math.round(m * (cnt - 1) / (nst - 1));
          const j = (st + k) % M, o0 = pa + j * 4, o1 = pb + j * 4;
          const e = pat[o0 + 3] + (pat[o1 + 3] - pat[o0 + 3]) * fr;
          const lum = VL[r0 + j] + (VL[r1 + j] - VL[r0 + j]) * uc, spc = (VS[r0 + j] + (VS[r1 + j] - VS[r0 + j]) * uc) * 255;
          const kk = (lum * (1 - e) + 1.15 * e) * curDs;
          let r = (pat[o0] + (pat[o1] - pat[o0]) * fr) * kk + spc, g = (pat[o0 + 1] + (pat[o1 + 1] - pat[o0 + 1]) * fr) * kk + spc,
            b = (pat[o0 + 2] + (pat[o1 + 2] - pat[o0 + 2]) * fr) * kk + spc;
          r += (curFR - r) * curFa; g += (curFG - g) * curFa; b += (curFB - b) * curFa;
          grd.addColorStop(TST[k], rgb(r, g, b));
        }
        ctx.fillStyle = grd;
      }
      ctx.beginPath();
      const o0x = di < 0 ? -sx : 0, o0y = di < 0 ? -sy : 0, o1x = di > 0 ? sx : 0, o1y = di > 0 ? sy : 0;
      for (let k = 0; k < cnt; k++) {
        const j = (st + k) % M;
        const inner = k > 0 && k < cnt - 1;   // концы дуги (силуэт) не смещаем — край тела остаётся ровным
        const x = VXs[r0 + j] + (VXs[r1 + j] - VXs[r0 + j]) * u0 + (inner ? o0x : 0), y = VYs[r0 + j] + (VYs[r1 + j] - VYs[r0 + j]) * u0 + (inner ? o0y : 0);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let k = cnt - 1; k >= 0; k--) {
        const j = (st + k) % M;
        const inner = k > 0 && k < cnt - 1;
        ctx.lineTo(VXs[r0 + j] + (VXs[r1 + j] - VXs[r0 + j]) * u1 + (inner ? o1x : 0), VYs[r0 + j] + (VYs[r1 + j] - VYs[r0 + j]) * u1 + (inner ? o1y : 0));
      }
      ctx.closePath(); ctx.fill();
    }
  }
  drawEye(sp, f, 1, L, ck, fx, fy, fz);
  drawEye(sp, f, -1, L, ck, fx, fy, fz);
  for (let i = 0; i < nFin; i++) if (FINPOOL[i].z <= cz) drawFin(FINPOOL[i]);   // ближе тела — поверх
}

/* мягкие тени рыб на песке: честные эллипсы в плоскости дна, спроецированные в перспективе */
function drawFishShadows() {
  for (let i = 0; i < FISH.length; i++) {
    const f = FISH[i], sp = f.sp, L = sp.L * f.sc;
    const h = Math.hypot(f.hx, f.hz) || 1, hx = f.hx / h, hz = f.hz / h;
    const above = f.y - SANDY;
    if (above > 5) continue;   // высоко над дном тень почти не видна
    const al = 0.30 * clamp(1.15 - above / 6.5, 0.12, 1), passes = L > 1 ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      const ra = L * (passes === 1 ? 0.5 : pass ? 0.34 : 0.62), rb = L * (passes === 1 ? 0.24 : pass ? 0.16 : 0.3);
      ctx.beginPath();
      for (let a = 0; a < 10; a++) {
        const th = a * TAU / 10, dx = Math.cos(th) * ra, dz = Math.sin(th) * rb;
        proj(f.x + dx * hx - dz * hz, SANDY + 0.01, f.z + dx * hz + dz * hx);
        if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(2,14,20,' + (al * (passes === 1 ? 0.8 : pass ? 0.7 : 0.45) * (1 - fogAmt(pz) * 0.5)).toFixed(3) + ')';
      ctx.fill();
    }
  }
}

/* ═══════════ водоросли: ленты, колышущиеся на разной дальности ═══════════ */
const plants = [];
const KSEG = 6;
function clump(x, z, type, n, spread) {
  const blades = [];
  for (let k = 0; k < n; k++) {
    const a = rnd() * TAU, d = Math.sqrt(rnd()) * spread;
    const bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d;
    const b = { x: bx, z: bz, ph: rnd() * TAU, sp1: rr(0.55, 1.0), sp2: rr(1.1, 1.8), sdir: rr(-0.6, 0.6), dir: rnd() * PI,
      twist: rr(-0.9, 0.9), lx: Math.cos(a), lz: Math.sin(a), shape: 0, lean: 0.2, amp: 0.1, h: 2, w: 0.2, c0: null, c1: null };
    if (type === 'grass') { b.h = rr(2.3, 4.0); b.w = rr(0.13, 0.22); b.lean = rr(0.05, 0.2); b.amp = 0.11; b.c0 = [18, 80, 46]; b.c1 = [138, 205, 84]; }
    else if (type === 'sword') { b.h = rr(1.1, 1.9); b.w = rr(0.4, 0.62); b.lean = rr(0.3, 0.55); b.amp = 0.07; b.shape = 1; b.c0 = [24, 76, 38]; b.c1 = [96, 172, 62]; }
    else if (type === 'red') { b.h = rr(1.4, 2.4); b.w = rr(0.26, 0.4); b.lean = rr(0.15, 0.4); b.amp = 0.09; b.shape = 1; b.c0 = [92, 22, 36]; b.c1 = [230, 92, 66]; }
    else { b.h = rr(3.4, 4.7); b.w = rr(0.3, 0.46); b.lean = rr(0.05, 0.15); b.amp = 0.14; b.c0 = [44, 78, 24]; b.c1 = [176, 172, 72]; }
    blades.push(b);
  }
  plants.push({ x, z, type, blades, hmax: type === 'kelp' ? 4.5 : type === 'grass' ? 3.6 : 2 });
}
function makePlants() {
  const back = [-4.8, -3.7, -2.3, -0.9, 0.7, 2.1, 3.3, 4.6];
  for (let i = 0; i < back.length; i++) clump(back[i] + rr(-0.2, 0.2), rr(-2.35, -1.7), i % 3 === 1 ? 'kelp' : 'grass', i % 3 === 1 ? 4 : 8, 0.4);
  clump(-4.75, 0.6, 'grass', 8, 0.35); clump(4.8, -0.3, 'grass', 7, 0.35);
  clump(-2.4, -0.8, 'sword', 6, 0.15); clump(1.3, -1.2, 'sword', 6, 0.15); clump(3.9, 1.0, 'red', 7, 0.3);
  clump(-1.0, -1.7, 'red', 6, 0.25); clump(-4.2, 1.7, 'sword', 5, 0.15); clump(0.2, 0.9, 'sword', 4, 0.1);
}
const bpx = new Float32Array((KSEG + 1) * 4);
function drawPlant(pl, t) {
  proj(pl.x, SANDY + pl.hmax * 0.4, pl.z);
  const fa = fogAmt(pz);
  for (let bi = 0; bi < pl.blades.length; bi++) {
    const b = pl.blades[bi];
    let n = 0;
    for (let k = 0; k <= KSEG; k++) {
      const s = k / KSEG, s2 = s * s;
      const sw = fsin(t * b.sp1 + b.ph + s * 2.2) * 0.6 + fsin(t * b.sp2 + b.ph * 1.7 + s * 4.3) * 0.3 + fsin(t * 0.21 + b.x * 0.4) * 0.55;
      const amp = b.h * b.amp * s2;
      const X = b.x + b.lx * b.lean * b.h * s2 + Math.cos(b.sdir) * sw * amp;
      const Z = b.z + b.lz * b.lean * b.h * s2 + Math.sin(b.sdir) * sw * amp * 0.7;
      const Y = SANDY + b.h * s * (1 - 0.25 * s * b.lean);
      const tp = b.shape ? Math.pow(Math.max(0.02, Math.sin(PI * (0.1 + 0.9 * s))), 0.7) : 1 - 0.82 * sstep(0.5, 1.0, s);
      const hw = 0.5 * b.w * tp, ang = b.dir + s * b.twist + sw * 0.25;
      const dx = Math.cos(ang) * hw, dz = Math.sin(ang) * hw;
      proj(X - dx, Y, Z - dz); bpx[k * 4] = px; bpx[k * 4 + 1] = py;
      proj(X + dx, Y, Z + dz); bpx[k * 4 + 2] = px; bpx[k * 4 + 3] = py;
      if (k === KSEG) n = pz;
    }
    const rx0 = (bpx[0] + bpx[2]) * 0.5, ry0 = (bpx[1] + bpx[3]) * 0.5;
    const tx0 = (bpx[KSEG * 4] + bpx[KSEG * 4 + 2]) * 0.5, ty0 = (bpx[KSEG * 4 + 1] + bpx[KSEG * 4 + 3]) * 0.5;
    if (Math.abs(ty0 - ry0) + Math.abs(tx0 - rx0) < 4) continue;
    const g = ctx.createLinearGradient(rx0, ry0, tx0, ty0);
    fogRGB(SANDY, 0.3);
    let r = b.c0[0] * 0.6, gg = b.c0[1] * 0.6, bl = b.c0[2] * 0.6;
    r += (FR - r) * fa; gg += (FG - gg) * fa; bl += (FB - bl) * fa;
    g.addColorStop(0, rgb(r, gg, bl));
    fogRGB(SANDY + b.h, 0.3);
    r = b.c1[0] * 0.95; gg = b.c1[1] * 0.95; bl = b.c1[2] * 0.95;
    r += (FR - r) * fa; gg += (FG - gg) * fa; bl += (FB - bl) * fa;
    g.addColorStop(1, rgb(r, gg, bl));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(bpx[0], bpx[1]);
    for (let k = 1; k <= KSEG; k++) ctx.lineTo(bpx[k * 4], bpx[k * 4 + 1]);
    for (let k = KSEG; k >= 0; k--) ctx.lineTo(bpx[k * 4 + 2], bpx[k * 4 + 3]);
    ctx.closePath(); ctx.fill();
    if (b.shape) {   // центральная жилка листа
      ctx.beginPath(); ctx.moveTo(rx0, ry0);
      for (let k = 1; k <= KSEG; k++) ctx.lineTo((bpx[k * 4] + bpx[k * 4 + 2]) * 0.5, (bpx[k * 4 + 1] + bpx[k * 4 + 3]) * 0.5);
      ctx.strokeStyle = 'rgba(210,240,170,' + (0.22 * (1 - fa)).toFixed(3) + ')'; ctx.lineWidth = Math.max(0.6, 0.02 * pk); ctx.stroke();
    }
  }
}

/* ═══════════ камни: faceted-меш, статичные нормали и освещение ═══════════ */
const rocks = [];
function makeRock(x, z, rad, sy, seed, NA = 7, NB = 11) {
  const cy = SANDY + rad * sy * 0.45;
  const V = [];
  for (let i = 0; i <= NA; i++) {
    const th = i / NA * PI;
    for (let j = 0; j < NB; j++) {
      const ph = j / NB * TAU;
      const nn = 1 + 0.2 * Math.sin(ph * 2 + th * 3 + seed) + 0.13 * Math.sin(ph * 5 - th * 2 + seed * 2) + 0.07 * Math.sin(ph * 9 + th * 7 + seed * 3);
      V.push(x + rad * Math.sin(th) * Math.cos(ph) * nn, Math.max(SANDY - 0.05, cy + rad * sy * Math.cos(th) * nn), z + rad * 0.82 * Math.sin(th) * Math.sin(ph) * nn);
    }
  }
  const quads = [];
  for (let i = 0; i < NA; i++) for (let j = 0; j < NB; j++) {
    const a = i * NB + j, b = i * NB + (j + 1) % NB, c = (i + 1) * NB + (j + 1) % NB, d = (i + 1) * NB + j;
    const cxq = (V[a * 3] + V[b * 3] + V[c * 3] + V[d * 3]) / 4, cyq = (V[a * 3 + 1] + V[b * 3 + 1] + V[c * 3 + 1] + V[d * 3 + 1]) / 4,
      czq = (V[a * 3 + 2] + V[b * 3 + 2] + V[c * 3 + 2] + V[d * 3 + 2]) / 4;
    const e1x = V[c * 3] - V[a * 3], e1y = V[c * 3 + 1] - V[a * 3 + 1], e1z = V[c * 3 + 2] - V[a * 3 + 2];
    const e2x = V[d * 3] - V[b * 3], e2y = V[d * 3 + 1] - V[b * 3 + 1], e2z = V[d * 3 + 2] - V[b * 3 + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (nx * (cxq - x) + ny * (cyq - cy) + nz * (czq - z) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (cyq < SANDY - 0.02 && ny < -0.3) continue;
    const lum = 0.34 + 0.8 * Math.max(0, nx * LX + ny * LY + nz * LZ);
    const v = rr(0.88, 1.12), moss = clamp((ny - 0.35) * 1.3, 0, 0.8);
    quads.push({ a, b, c, d, cx: cxq, cy: cyq, cz: czq, nx, ny, nz,
      cr: lerp(104, 58, moss) * lum * v, cg: 98 * lum * v, cb: lerp(92, 52, moss) * lum * v });
  }
  rocks.push({ x, z, rad, V, quads, cy, sy, sp: new Float32Array((NA + 1) * NB * 2) });
}
function drawRock(rk) {
  proj(rk.x, rk.cy, rk.z);
  const fa = fogAmt(pz);
  fogRGB(rk.cy, 0.3);
  const V = rk.V, sp = rk.sp, n = V.length / 3;
  for (let i = 0; i < n; i++) { proj(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]); sp[i * 2] = px; sp[i * 2 + 1] = py; }
  for (let qi = 0; qi < rk.quads.length; qi++) {
    const q = rk.quads[qi];
    if (q.nx * (cam.x - q.cx) + q.ny * (cam.y - q.cy) + q.nz * (cam.z - q.cz) <= 0) continue;
    ctx.fillStyle = rgb(q.cr + (FR - q.cr) * fa, q.cg + (FG - q.cg) * fa, q.cb + (FB - q.cb) * fa);
    const x0 = sp[q.a * 2], y0 = sp[q.a * 2 + 1], x1 = sp[q.b * 2], y1 = sp[q.b * 2 + 1], x2 = sp[q.c * 2], y2 = sp[q.c * 2 + 1], x3 = sp[q.d * 2], y3 = sp[q.d * 2 + 1];
    const mx = (x0 + x1 + x2 + x3) * 0.25, my = (y0 + y1 + y2 + y3) * 0.25, E = 1.05;
    ctx.beginPath();
    ctx.moveTo(mx + (x0 - mx) * E, my + (y0 - my) * E); ctx.lineTo(mx + (x1 - mx) * E, my + (y1 - my) * E);
    ctx.lineTo(mx + (x2 - mx) * E, my + (y2 - my) * E); ctx.lineTo(mx + (x3 - mx) * E, my + (y3 - my) * E);
    ctx.fill();
  }
}
function drawStaticShadows() {
  for (let i = 0; i < rocks.length; i++) {
    const rk = rocks[i];
    if (rk.rad < 0.25) continue;
    for (let pass = 0; pass < 2; pass++) {
      const r = rk.rad * (pass ? 1.0 : 1.45);
      ctx.beginPath();
      for (let a = 0; a < 14; a++) {
        const th = a * TAU / 14;
        proj(rk.x + Math.cos(th) * r + 0.1, SANDY + 0.01, rk.z + Math.sin(th) * r * 0.85 + 0.05);
        if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fillStyle = 'rgba(2,12,18,' + (pass ? 0.3 : 0.2) + ')'; ctx.fill();
    }
  }
  for (let i = 0; i < plants.length; i++) {
    const pl = plants[i];
    ctx.beginPath();
    for (let a = 0; a < 10; a++) {
      const th = a * TAU / 10;
      proj(pl.x + Math.cos(th) * 0.55, SANDY + 0.01, pl.z + Math.sin(th) * 0.4);
      if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fillStyle = 'rgba(2,14,12,0.22)'; ctx.fill();
  }
}

/* ═══════════ пузырьки: подъём сквозь глубину с параллаксом ═══════════ */
const bubSpr = document.createElement('canvas');
bubSpr.width = bubSpr.height = 96;
(function () {
  const c = bubSpr.getContext('2d');
  const g = c.createRadialGradient(48, 48, 0, 48, 48, 45);
  g.addColorStop(0, 'rgba(170,225,245,0.0)'); g.addColorStop(0.62, 'rgba(180,232,250,0.07)');
  g.addColorStop(0.9, 'rgba(225,250,255,0.62)'); g.addColorStop(1, 'rgba(255,255,255,0.0)');
  c.fillStyle = g; c.beginPath(); c.arc(48, 48, 46, 0, TAU); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.ellipse(34, 31, 9, 5.5, -0.7, 0, TAU); c.fill();
  c.fillStyle = 'rgba(190,240,255,0.5)'; c.beginPath(); c.arc(62, 64, 4.5, 0, TAU); c.fill();
})();
const bubbles = [];
const BSRC = [{ x: -3.9, z: -1.0, acc: 0 }, { x: 3.5, z: 0.6, acc: 0 }, { x: 0.4, z: -1.9, acc: 0 }];
function spawnBubble(x, y, z, big) {
  const r = (big ? 0.04 : 0.022) + rnd() * rnd() * (big ? 0.06 : 0.04);
  bubbles.push({ x, y, z, r, vy: 0.55 + r * 7 + rr(0, 0.35), ph: rnd() * TAU, wf: rr(2.2, 4.2), wa: rr(0.08, 0.2) });
}
function updateBubbles(dt, t) {
  if (view.bubbles) {
    for (let i = 0; i < BSRC.length; i++) {
      const s = BSRC[i]; s.acc += dt * (i === 2 ? 3 : 7);
      while (s.acc > 1) { s.acc -= 1; spawnBubble(s.x + rr(-0.06, 0.06), SANDY + 0.08, s.z + rr(-0.06, 0.06), true); }
    }
    if (rnd() < dt * 3) spawnBubble(rr(-HX + 0.5, HX - 0.5), SANDY + 0.1, rr(-HZ + 0.5, HZ - 0.5), false);
  }
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.y += b.vy * dt; b.r *= 1 + 0.06 * dt;
    b.x += fsin(t * b.wf + b.ph) * b.wa * dt; b.z += fsin(t * b.wf * 0.8 + b.ph * 2) * b.wa * 0.7 * dt;
    if (b.y > SURF - 0.04) bubbles.splice(i, 1);
  }
}
function drawBubble(b) {
  proj(b.x, b.y, b.z);
  if (pz < 1) return;
  const s = b.r * pk;
  if (s < 0.7) return;
  ctx.globalAlpha = 0.95 * (1 - fogAmt(pz) * 0.75);
  ctx.drawImage(bubSpr, px - s, py - s, s * 2, s * 2);
  ctx.globalAlpha = 1;
}

/* ═══════════ взвесь (морской снег) ═══════════ */
const motes = [];
function makeMotes() {
  for (let i = 0; i < 110; i++) motes.push({ x: rr(-HX, HX), y: rr(SANDY, SURF), z: rr(-HZ, HZ), ph: rnd() * TAU, r: rr(0.012, 0.03) });
}
function updateMotes(dt, t) {
  for (let i = 0; i < motes.length; i++) {
    const m = motes[i];
    m.x += fsin(t * 0.13 + m.ph) * 0.07 * dt + 0.025 * dt;
    m.y += fsin(t * 0.11 + m.ph * 3) * 0.03 * dt - 0.012 * dt;
    m.z += fsin(t * 0.09 + m.ph * 2) * 0.05 * dt;
    if (m.x > HX) m.x = -HX; if (m.x < -HX) m.x = HX;
    if (m.y < SANDY) m.y = SURF; if (m.y > SURF) m.y = SANDY;
    if (m.z > HZ) m.z = -HZ; if (m.z < -HZ) m.z = HZ;
  }
}
function drawMote(m, t) {
  proj(m.x, m.y, m.z);
  if (pz < 1) return;
  const rad = Math.max(0.55 * DPR, m.r * pk), a = (0.16 + 0.34 * (0.5 + 0.5 * fsin(t * 1.3 + m.ph))) * (1 - fogAmt(pz) * 0.75);
  ctx.fillStyle = 'rgba(205,242,250,' + a.toFixed(3) + ')';
  if (rad < 1.3) ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  else { ctx.beginPath(); ctx.arc(px, py, rad, 0, TAU); ctx.fill(); }
}

/* ═══════════ нисходящие объёмные лучи ═══════════ */
const rays = [];
function makeRays() {
  for (let i = 0; i < 9; i++) rays.push({ x: rr(-HX * 0.95, HX * 0.95), z: rr(-HZ * 0.85, HZ * 0.7), w0: rr(0.18, 0.55), w1: rr(0.8, 1.7),
    slant: rr(0.16, 0.3), ph: rnd() * TAU, sp: rr(0.6, 1.4), int: rr(0.55, 1.0) });
}
function rayGeom(r, t) {
  r.xt = r.x + 0.45 * fsin(t * 0.07 * r.sp + r.ph);
  r.xb = r.xt + r.slant * (SURF - SANDY);
  r.zb = r.z + 0.1 * (SURF - SANDY);
  r.fl = 0.55 + 0.45 * fsin(t * 0.23 * r.sp + r.ph * 2) * fsin(t * 0.11 + r.ph);
}
function drawRay(r) {
  const bx = cam.rx, bz = cam.rz;
  proj(r.xt - r.w0 * bx, SURF, r.z - r.w0 * bz); const x0 = px, y0 = py;
  proj(r.xt + r.w0 * bx, SURF, r.z + r.w0 * bz); const x1 = px, y1 = py;
  proj(r.xb + r.w1 * bx, SANDY, r.zb + r.w1 * bz); const x2 = px, y2 = py;
  proj(r.xb - r.w1 * bx, SANDY, r.zb - r.w1 * bz); const x3 = px, y3 = py;
  const fa = fogAmt(pz);
  const a = 0.17 * r.int * Math.max(0.1, r.fl) * (1 - fa * 0.5);
  const g = ctx.createLinearGradient((x0 + x1) * 0.5, (y0 + y1) * 0.5, (x2 + x3) * 0.5, (y2 + y3) * 0.5);
  g.addColorStop(0, 'rgba(205,248,255,' + a.toFixed(3) + ')');
  g.addColorStop(0.55, 'rgba(150,228,245,' + (a * 0.38).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(120,210,235,0)');
  ctx.fillStyle = g;
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill();
  const mx0 = (x0 + x1) * 0.5, my0 = (y0 + y1) * 0.5, mx1 = (x2 + x3) * 0.5, my1 = (y2 + y3) * 0.5;
  ctx.beginPath();
  ctx.moveTo(mx0 + (x0 - mx0) * 0.4, my0 + (y0 - my0) * 0.4); ctx.lineTo(mx0 + (x1 - mx0) * 0.4, my0 + (y1 - my0) * 0.4);
  ctx.lineTo(mx1 + (x2 - mx1) * 0.4, my1 + (y2 - my1) * 0.4); ctx.lineTo(mx1 + (x3 - mx1) * 0.4, my1 + (y3 - my1) * 0.4);
  ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}
function drawFood(q) {
  proj(q.x, q.y, q.z);
  if (pz < 1) return;
  const rad = Math.max(0.8, q.r * pk), fa = fogAmt(pz);
  ctx.fillStyle = rgb(215 + (FR - 215) * fa * 0.5, 150 + (FG - 150) * fa * 0.5, 80 + (FB - 80) * fa * 0.5);
  ctx.fillRect(px - rad, py - rad * 0.6, rad * 2, rad * 1.2);
}

/* ═══════════ мутная дымка: медленные облака взвеси на разной глубине ═══════════ */
const murk = [];
function makeMurk() {
  for (let i = 0; i < 6; i++) murk.push({ x: rr(-HX, HX), y: rr(SANDY + 0.4, SURF - 0.4), z: rr(-HZ, HZ), r: rr(1.8, 3.2), ph: rnd() * TAU, sp: rr(0.5, 1.2), a: rr(0.045, 0.085) });
}
let HULL = [];
function convexHull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (let i = 0; i < pts.length; i++) { const p = pts[i]; while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
/* силуэт аквариума на экране: выпуклая оболочка восьми углов объёма */
function updateHull() {
  const pts = [];
  for (let i = 0; i < 8; i++) { proj((i & 1) ? HX : -HX, (i & 2) ? SURF : -HY, (i & 4) ? HZ : -HZ); pts.push([px, py]); }
  HULL = convexHull(pts);
}
function murkPos(m, t) {
  m.cx = m.x + 0.6 * fsin(t * 0.05 * m.sp + m.ph); m.cy = m.y + 0.25 * fsin(t * 0.04 * m.sp + m.ph * 2); m.cz = m.z + 0.3 * fsin(t * 0.045 * m.sp + m.ph * 3);
}
function drawMurk(m) {
  proj(m.cx, m.cy, m.cz);
  if (pz < 1 || HULL.length < 3) return;
  const rad = m.r * pk;
  fogRGB(m.cy);
  const r = FR * 1.25 + 14, g = FG * 1.2 + 18, b = FB * 1.1 + 10;
  const gr = ctx.createRadialGradient(px, py, 0, px, py, rad);
  gr.addColorStop(0, rgba(r, g, b, m.a)); gr.addColorStop(0.55, rgba(r, g, b, m.a * 0.5)); gr.addColorStop(1, rgba(r, g, b, 0));
  ctx.save();
  ctx.beginPath(); ctx.moveTo(HULL[0][0], HULL[0][1]);
  for (let i = 1; i < HULL.length; i++) ctx.lineTo(HULL[i][0], HULL[i][1]);
  ctx.closePath(); ctx.clip();
  ctx.fillStyle = gr; ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  ctx.restore();
}

/* ═══════════ стекло, рамки, блики ═══════════ */
const SPK = [];
for (let i = 0; i < 120; i++) SPK.push({ u: rnd(), v: rnd(), s: rr(0.018, 0.06), dark: rnd() < 0.45 });

function edge(ax, ay, az, bx, by, bz, wWorld, style) {
  proj(ax, ay, az); const x0 = px, y0 = py, k0 = pk;
  proj(bx, by, bz);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(px, py);
  ctx.lineWidth = Math.max(1, wWorld * (k0 + pk) * 0.5); ctx.strokeStyle = style; ctx.stroke();
}
function drawRails(i) {
  const e = wallEnds(i, HX, HZ);
  ctx.lineCap = 'butt';
  edge(e[0], HY, e[1], e[2], HY, e[3], 0.2, '#06090c');
  edge(e[0], HY - 0.13, e[1], e[2], HY - 0.13, e[3], 0.024, 'rgba(160,220,235,0.38)');
  edge(e[0], -HY, e[1], e[2], -HY, e[3], 0.2, '#06090c');
  edge(e[0], -HY + 0.11, e[1], e[2], -HY + 0.11, e[3], 0.022, 'rgba(160,220,235,0.3)');
}
const CORN = [[-HX, HZ, 0, 3], [HX, HZ, 0, 2], [HX, -HZ, 1, 2], [-HX, -HZ, 1, 3]];
function drawCorner(c, k) {
  ctx.lineCap = 'butt';
  edge(c[0], -HY, c[1], c[0], HY, c[1], 0.1, 'rgba(100,185,175,' + (0.32 * k).toFixed(3) + ')');
  edge(c[0], -HY, c[1], c[0], HY, c[1], 0.028, 'rgba(228,255,250,' + (0.55 * k).toFixed(3) + ')');
}
function drawBackFrame() {
  for (let i = 0; i < 4; i++) if (!FRONT[i]) drawRails(i);
  for (let i = 0; i < 4; i++) if (!FRONT[CORN[i][2]] && !FRONT[CORN[i][3]]) drawCorner(CORN[i], 0.4);
}
function drawFrontFrame() {
  for (let i = 0; i < 4; i++) if (FRONT[i]) drawRails(i);
  for (let i = 0; i < 4; i++) if (FRONT[CORN[i][2]] || FRONT[CORN[i][3]]) drawCorner(CORN[i], 1);
}

/* источники света комнаты: честное зеркальное отражение на плоскости стекла */
const LIGHTS = [
  { x: -9, y: 7.5, z: 11, hw: 1.1, a: 0.17 },
  { x: 11, y: 4.5, z: 8, hw: 0.6, a: 0.11 },
  { x: 2, y: 9, z: 12, hw: 1.7, a: 0.07 }
];
function drawReflections(i, e) {
  const nx = WN[i][0], nz = WN[i][1], d = nx !== 0 ? HX : HZ;
  const ex = e[2] - e[0], ez = e[3] - e[1], el = Math.hypot(ex, ez), dx = ex / el, dz = ez / el;
  const dc = nx * cam.x + nz * cam.z - d;
  if (dc <= 0) return;
  for (let k = 0; k < LIGHTS.length; k++) {
    const L = LIGHTS[k];
    const dist = nx * L.x + nz * L.z - d;
    if (dist <= 0) continue;
    const mx = L.x - 2 * dist * nx, mz = L.z - 2 * dist * nz;       // зеркальный образ источника
    const dm = nx * mx + nz * mz - d;
    const tt = dc / (dc - dm);
    const sx = cam.x + (mx - cam.x) * tt, sz = cam.z + (mz - cam.z) * tt;
    const hw = L.hw, sh = 0.9;
    for (let s = 0; s < 1; s++) {            // мягкая полоса отражения окна/лампы
      const off = s ? hw * 1.75 : 0, w2 = s ? hw * 0.16 : hw, al = s ? L.a * 0.55 : L.a;
      const cxp = sx + dx * off, czp = sz + dz * off;
      proj(cxp - dx * w2, -HY, czp - dz * w2); const b0x = px, b0y = py;
      proj(cxp + dx * w2, -HY, czp + dz * w2); const b1x = px, b1y = py;
      proj(cxp + dx * (w2 + sh), HY, czp + dz * (w2 + sh)); const t1x = px, t1y = py;
      proj(cxp - dx * (w2 - sh), HY, czp - dz * (w2 - sh)); const t0x = px, t0y = py;
      const g = ctx.createLinearGradient(b0x, b0y, b1x, b1y);
      g.addColorStop(0, 'rgba(235,250,255,0)'); g.addColorStop(0.5, 'rgba(235,250,255,' + al.toFixed(3) + ')'); g.addColorStop(1, 'rgba(235,250,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(b0x, b0y); ctx.lineTo(b1x, b1y); ctx.lineTo(t1x, t1y); ctx.lineTo(t0x, t0y); ctx.closePath(); ctx.fill();
    }
    // блик лампы — настоящая точка зеркального отражения
    const sy = cam.y + (L.y - cam.y) * tt;
    proj(sx, sy, sz);
    const rad = 0.9 * pk, rg = ctx.createRadialGradient(px, py, 0, px, py, rad);
    rg.addColorStop(0, 'rgba(255,255,255,' + (L.a * 2.3).toFixed(3) + ')'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
}

function drawFrontFace(i, t) {
  const e = wallEnds(i, HX, HZ);
  // песок в разрезе, виден сквозь переднее стекло
  projQuad(e, -HY, SANDY);
  const g = ctx.createLinearGradient(0, (Q[5] + Q[7]) * 0.5, 0, (Q[1] + Q[3]) * 0.5);
  g.addColorStop(0, 'rgb(176,156,116)'); g.addColorStop(0.35, 'rgb(122,106,80)'); g.addColorStop(1, 'rgb(46,40,34)');
  ctx.fillStyle = g; pathQuad(); ctx.fill();
  for (let k = 0; k < SPK.length; k++) {
    const p = SPK[k];
    proj(e[0] + (e[2] - e[0]) * p.u, lerp(-HY + 0.03, SANDY - 0.02, p.v), e[1] + (e[3] - e[1]) * p.u);
    const r = Math.max(0.7, p.s * pk * 0.5);
    ctx.fillStyle = p.dark ? 'rgba(40,34,28,0.45)' : 'rgba(225,210,170,0.42)';
    ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(235,222,180,0.4)'; ctx.lineWidth = Math.max(1, 0.015 * pk);
  ctx.beginPath(); ctx.moveTo(Q[6], Q[7]); ctx.lineTo(Q[4], Q[5]); ctx.stroke();
  // стекло: лёгкая тонировка, ватерлиния, блики
  projQuad(e, -HY, HY);
  ctx.save();
  pathQuad(); ctx.clip();
  const gg = ctx.createLinearGradient(0, (Q[5] + Q[7]) * 0.5, 0, (Q[1] + Q[3]) * 0.5);
  gg.addColorStop(0, 'rgba(200,245,255,0.10)'); gg.addColorStop(0.5, 'rgba(150,215,230,0.02)'); gg.addColorStop(1, 'rgba(150,215,230,0.05)');
  ctx.fillStyle = gg; ctx.fillRect(0, 0, CW, CH);
  edge(e[0], SURF, e[1], e[2], SURF, e[3], 0.035, 'rgba(225,252,255,0.6)');
  ctx.globalCompositeOperation = 'lighter';
  drawReflections(i, e);
  ctx.restore();
}

function drawVignette() {
  const R = Math.hypot(CW, CH) * 0.5;
  const g = ctx.createRadialGradient(CW * 0.5, CH * 0.48, R * 0.42, CW * 0.5, CH * 0.48, R);
  g.addColorStop(0, 'rgba(0,6,10,0)'); g.addColorStop(1, 'rgba(0,4,8,0.62)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
}

/* ═══════════ кадр: сцена целиком по алгоритму художника ═══════════ */
const items = [];
function render(t) {
  curT = t;
  drawBackdrop();
  drawBase();
  for (let i = 0; i < 4; i++) if (!FRONT[i]) drawWallInterior(i, t);
  drawSurface(t);
  drawFloor(t);
  drawFishShadows();
  drawStaticShadows();
  drawBackFrame();

  items.length = 0;
  for (let i = 0; i < FISH.length; i++) { const f = FISH[i]; proj(f.x, f.y, f.z); items.push({ d: pz, k: 0, o: f }); }
  for (let i = 0; i < plants.length; i++) { const p = plants[i]; proj(p.x, SANDY + p.hmax * 0.35, p.z); items.push({ d: pz, k: 1, o: p }); }
  for (let i = 0; i < rocks.length; i++) { const r = rocks[i]; proj(r.x, r.cy, r.z); items.push({ d: pz, k: 2, o: r }); }
  for (let i = 0; i < bubbles.length; i++) { const b = bubbles[i]; proj(b.x, b.y, b.z); items.push({ d: pz, k: 3, o: b }); }
  for (let i = 0; i < motes.length; i++) { const m = motes[i]; proj(m.x, m.y, m.z); items.push({ d: pz, k: 4, o: m }); }
  if (view.rays) {
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i]; rayGeom(r, t);
      proj((r.xt + r.xb) * 0.5, (SURF + SANDY) * 0.5, (r.z + r.zb) * 0.5); items.push({ d: pz, k: 5, o: r });
    }
  }
  for (let i = 0; i < food.length; i++) { const q = food[i]; proj(q.x, q.y, q.z); items.push({ d: pz, k: 6, o: q }); }
  updateHull();
  for (let i = 0; i < murk.length; i++) { const m = murk[i]; murkPos(m, t); proj(m.cx, m.cy, m.cz); items.push({ d: pz, k: 7, o: m }); }
  items.sort((a, b) => b.d - a.d);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    switch (it.k) {
      case 0: drawFish(it.o); break;
      case 1: drawPlant(it.o, t); break;
      case 2: drawRock(it.o); break;
      case 3: drawBubble(it.o); break;
      case 4: drawMote(it.o, t); break;
      case 5: drawRay(it.o); break;
      case 7: drawMurk(it.o); break;
      default: drawFood(it.o);
    }
  }
  for (let i = 0; i < 4; i++) if (FRONT[i]) drawFrontFace(i, t);
  drawFrontFrame();
  drawVignette();
}

/* ═══════════ мир, управление, цикл ═══════════ */
function update(dt, t) { updateFish(dt, t); updateBubbles(dt, t); updateMotes(dt, t); }

function bindUI() {
  const $ = id => document.getElementById(id);
  const toggle = (btn, key) => btn.addEventListener('click', () => {
    view[key] = !view[key]; btn.classList.toggle('on', view[key]); btn.setAttribute('aria-pressed', String(view[key]));
  });
  toggle($('bOrbit'), 'auto'); toggle($('bRays'), 'rays'); toggle($('bBub'), 'bubbles');
  $('bFeed').addEventListener('click', feed);
  $('sCam').addEventListener('input', e => { view.speed = +e.target.value; });
  $('sTime').addEventListener('input', e => { view.timeScale = +e.target.value; });
  cv.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY }; cv.classList.add('drag');
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* не критично */ }
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    view.yawOff -= (e.clientX - drag.x) * 0.006; view.pitchOff += (e.clientY - drag.y) * 0.002;
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const end = () => { drag = null; cv.classList.remove('drag'); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', e => { e.preventDefault(); view.zoom = clamp(view.zoom * Math.exp(e.deltaY * 0.001), 0.7, 1.35); }, { passive: false });
  window.addEventListener('resize', resize);
}
let drag = null;

let lastNow = 0, T = 0, ema = 1 / 60, slowRun = 0, statT = 0, frames = 0;
const statEl = document.getElementById('stat');
function frame(now) {
  requestAnimationFrame(frame);
  let raw = (now - lastNow) / 1000; lastNow = now;
  if (!(raw > 0)) raw = 1 / 60;
  const dt = Math.min(raw, 0.05);
  ema += (Math.min(raw, 0.1) - ema) * 0.05;
  const sdt = dt * view.timeScale;
  T += sdt;
  if (view.auto) view.phase += dt * 0.05 * view.speed;
  if (!drag) { const k = Math.exp(-dt * 0.04); view.yawOff *= k; view.pitchOff *= k; }
  update(sdt, T);
  updateCamera(T);
  render(T);
  // динамическое разрешение: на слабом железе мягко снижаем качество
  frames++;
  if (frames > 150 && ema > 0.03 && qual > 0.78) { if (++slowRun > 150) { qual = Math.max(0.78, qual * 0.92); slowRun = 0; resize(); } } else slowRun = 0;
  statT += raw;
  if (statT > 0.5 && statEl) { statT = 0; statEl.textContent = Math.round(1 / ema) + ' кадр/с · рыб: ' + FISH.length + ' · накормлено: ' + eaten; }
}

function init() {
  resize();
  populate(); makePlants(); makeMotes(); makeRays(); makeMurk();
  makeRock(-3.7, -1.2, 0.95, 0.8, 1.3); makeRock(3.4, -0.7, 0.75, 0.7, 4.1); makeRock(-0.6, 1.25, 0.33, 0.7, 2.2);
  makeRock(1.9, 0.95, 0.26, 0.8, 5.5); makeRock(-4.5, -1.9, 0.6, 1.0, 0.4);
  makeRock(-1.7, -2.05, 1.05, 1.05, 3.3); makeRock(2.5, -2.0, 0.95, 0.9, 6.1);
  for (let i = 0; i < 9; i++) makeRock(rr(-4.6, 4.6), rr(-0.6, 2.2), rr(0.09, 0.2), rr(0.55, 0.8), rnd() * 9, 4, 7);
  bindUI();
  for (let i = 0; i < 360; i++) updateFish(1 / 60, i / 60);
  for (let i = 0; i < 90; i++) updateBubbles(0.1, i * 0.1);
  T = 6;
  requestAnimationFrame(frame);
}
init();

})();
