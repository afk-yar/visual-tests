/* Попиксельный рендер шара в буфер ImageData (Canvas 2D, без WebGL).
   Геометрия (нормали, широта/долгота, мип-уровень, толща атмосферы) предвычисляется
   на каждый пиксель диска; вращение Земли — это только сдвиг долготы, поэтому кадр
   сводится к билинейной выборке текстур и освещению через таблицы (LUT). */
var Globe = (function () {
  var PI = Math.PI;
  var TILT = 23.44 * PI / 180, PITCH = 13 * PI / 180, EXTR = 1.16;
  var tex = null;

  /* ось вращения и базис Земли в системе камеры (x вправо, y вверх, z к зрителю) */
  var AX = Math.sin(TILT), AY = Math.cos(TILT) * Math.cos(PITCH), AZ = Math.cos(TILT) * Math.sin(PITCH);
  var bx = -AZ * AX, by = -AZ * AY, bz = 1 - AZ * AZ, bl = Math.sqrt(bx * bx + by * by + bz * bz);
  bx /= bl; by /= bl; bz /= bl;
  var ex = AY * bz - AZ * by, ey = AZ * bx - AX * bz, ez = AX * by - AY * bx;

  /* ---------- таблицы ---------- */
  var S2L = new Float32Array(256), LL = new Float32Array(256);
  for (var i = 0; i < 256; i++) {
    var c = i / 255; S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    LL[i] = Math.pow(c, 1.65) * 1.45;
  }
  var TMN = 4096, TMS = 512, TMR = new Uint8Array(TMN), TMG = new Uint8Array(TMN), TMB = new Uint8Array(TMN);
  /* TMB0 — синий без подъёма чёрного: для ореола вне диска (иначе ноль даёт синее кольцо) */
  var TMB0 = new Uint8Array(TMN);
  function aces(x) { return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); }
  for (i = 0; i < TMN; i++) {
    var xv = i / TMS, a = Math.min(1, aces(xv));
    TMR[i] = Math.round(255 * Math.pow(a, 1 / 2.2));
    TMG[i] = Math.round(255 * Math.pow(Math.min(1, aces(xv * 0.99)), 1 / 2.2));
    TMB[i] = Math.round(255 * Math.min(1, Math.pow(a + 0.0016, 1 / 2.2)));
    TMB0[i] = Math.round(255 * Math.min(1, Math.pow(a + 0.0016 * (1 - Math.exp(-a * 400)), 1 / 2.2)));
  }

  var MN = 1024, TAU = [0.10, 0.17, 0.33];
  function sstep(a, b, x) { var t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function airmass(m) {
    if (m < 0) m = 0;
    var z = Math.acos(Math.min(1, m)) * 180 / PI;
    return 1 / (m + 0.50572 * Math.pow(Math.max(0.5, 96.07995 - z), -1.6364));
  }
  function mk() { return [new Float32Array(MN), new Float32Array(MN), new Float32Array(MN)]; }
  var DIR = mk(), CLD = mk(), AMB = mk(), TN = mk(), SKY = mk(), HDR = mk(), HDM = mk(), HHR = mk(), HHM = mk();
  var NL = new Float32Array(MN), NLH = new Float32Array(MN);
  var RC = [0.16, 0.37, 1.0], MC = [1.0, 0.9, 0.78];
  for (i = 0; i < MN; i++) {
    var mu = i / 511.5 - 1, ch;
    var am = airmass(Math.max(mu, 0.004)), amc = airmass(Math.max(mu + 0.04, 0.004));
    var ramp = sstep(-0.02, 0.035, mu) * Math.max(mu, 0.004);
    var mc = mu + 0.04, cr = sstep(-0.07, 0.02, mu) * Math.max(0, (mc + 0.12) / 1.12);
    var tw = Math.exp(-Math.pow((mu + 0.03) / 0.085, 2));
    var day = sstep(-0.1, 0.4, mu);
    var thD = sstep(-0.16, 0.12, mu), thH = sstep(-0.34, 0.1, mu);
    var amD = airmass(Math.max(mu, 0) + 0.015), amH = airmass(Math.max(mu, 0) + 0.01);
    var twc = [1.0, 0.48, 0.32], skc = [0.3, 0.5, 1.0], nf = [0.0032, 0.0046, 0.0098];
    for (ch = 0; ch < 3; ch++) {
      var tn = Math.exp(-TAU[ch] * (am - 1));
      DIR[ch][i] = tn * ramp;
      CLD[ch][i] = Math.exp(-TAU[ch] * 0.75 * (amc - 1)) * cr;
      AMB[ch][i] = skc[ch] * 0.1 * day + twc[ch] * 0.03 * tw + nf[ch];
      TN[ch][i] = tn * sstep(-0.01, 0.05, mu);
      SKY[ch][i] = skc[ch] * 0.13 * sstep(-0.05, 0.3, mu) + twc[ch] * 0.05 * tw;
      var td = Math.exp(-TAU[ch] * 0.45 * (amD - 1)) * thD, th = Math.exp(-TAU[ch] * 0.32 * (amH - 1)) * thH;
      HDR[ch][i] = RC[ch] * td; HDM[ch][i] = MC[ch] * td;
      HHR[ch][i] = RC[ch] * th; HHM[ch][i] = MC[ch] * th;
    }
    NL[i] = sstep(0.06, -0.12, mu);
    NLH[i] = sstep(0.12, -0.22, mu);
  }
  /* блик: острое ядро + широкое свечение (Бекманн), индекс по (1 - N·H) */
  var SPN = 4096, SPK = SPN / 0.5, SPEC = new Float32Array(SPN);
  (function () {
    var m1 = 0.1, m2 = 0.25;
    for (var k = 0; k < SPN; k++) {
      var nh = 1 - k / SPK, c2 = nh * nh, t2 = (1 - c2) / c2;
      var d1 = Math.exp(-t2 / (m1 * m1)) / (PI * m1 * m1 * c2 * c2), d2 = Math.exp(-t2 / (m2 * m2)) / (PI * m2 * m2 * c2 * c2);
      SPEC[k] = (d1 * 0.5 + d2) * PI / 4 * 3.7;
    }
  })();
  /* покадровые таблицы атмосферы (зависят от фазовой функции) */
  var HZ = mk(), HL = mk();
  /* мягкое насыщение свечения: v∈[0,8) → байт */
  var BLT = new Uint8Array(1024);
  for (i = 0; i < 1024; i++) BLT[i] = Math.round(255 * (1 - Math.exp(-i / 128)));

  /* ---------- геометрия ---------- */
  var G = null;
  function lonlat(nx, ny, nz, o) {
    var sl = nx * AX + ny * AY + nz * AZ;
    if (sl > 1) sl = 1; if (sl < -1) sl = -1;
    o[0] = (Math.atan2(nx * ex + ny * ey + nz * ez, nx * bx + ny * by + nz * bz) + PI) / (2 * PI);
    o[1] = (PI / 2 - Math.asin(sl)) / PI;
    o[2] = sl;
  }
  function build(Rint) {
    var R = Rint, S = Math.ceil(R * EXTR) * 2 + 2, cx = S / 2, iR = 1 / R, x, y;
    var nD = 0, nH = 0;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      var dx = (x + 0.5 - cx) * iR, dy = (y + 0.5 - cx) * iR, r = Math.sqrt(dx * dx + dy * dy);
      var cv = (1 - r) * R + 0.5;
      if (cv > 0) nD++; else if (r < EXTR) nH++;
    }
    var g = {
      R: R, S: S, nD: nD, nH: nH,
      IDX: new Int32Array(nD), NX: new Float32Array(nD), NY: new Float32Array(nD), NZ: new Float32Array(nD),
      U0: new Float32Array(nD), V0: new Float32Array(nD), LV: new Uint8Array(nD), SL: new Float32Array(nD),
      ICL: new Float32Array(nD), EXT: new Float32Array(nD), HZA: new Float32Array(nD), FR: new Float32Array(nD),
      SPV: new Float32Array(nD), COV: new Float32Array(nD), HLA: new Float32Array(nD), BI: new Int32Array(nD),
      HIDX: new Int32Array(nH), HPX: new Float32Array(nH), HPY: new Float32Array(nH), HD: new Float32Array(nH),
      HAG: new Float32Array(nH), HBI: new Int32Array(nH)
    };
    var BS = Math.ceil(S * 1.7 / 4) + 1, off = ((BS * 4 - S) / 2) | 0;
    g.BS = BS; g.boff = off;
    var o0 = [0, 0, 0], o1 = [0, 0, 0], o2 = [0, 0, 0], di = 0, hi = 0;
    var TW = Planet.W, TH = Planet.H;
    function nrm(px, py, o) {
      var dx = (px - cx) * iR, dy = (py - cx) * iR, r = Math.sqrt(dx * dx + dy * dy);
      if (r > 0.9995) { dx *= 0.9995 / r; dy *= 0.9995 / r; r = 0.9995; }
      var nz = Math.sqrt(1 - r * r);
      lonlat(dx, -dy, nz, o);
      return nz;
    }
    function haloDen(h) {
      return 0.95 * Math.exp(-h / 0.011) + 0.3 * Math.exp(-h / 0.04) + 0.06 * Math.exp(-h / 0.11);
    }
    /* сначала чётные строки, затем нечётные: кадр может обновлять их через раз (чересстрочно) */
    for (var pass = 0; pass < 2; pass++) for (y = pass; y < S; y += 2) for (x = 0; x < S; x++) {
      if (pass === 1 && y === 1 && x === 0) g.nE = di;
      var dx2 = (x + 0.5 - cx) * iR, dy2 = (y + 0.5 - cx) * iR, r2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      var cov = (1 - r2) * R + 0.5, bi = ((y + off) >> 2) * BS + ((x + off) >> 2);
      if (cov > 0) {
        if (cov > 1) cov = 1;
        var nz = nrm(x + 0.5, y + 0.5, o0);
        var rr = Math.min(r2, 0.9995), sc = r2 > 0 ? rr / r2 : 0;
        g.IDX[di] = y * S + x; g.NX[di] = dx2 * sc; g.NY[di] = -dy2 * sc; g.NZ[di] = nz;
        g.U0[di] = o0[0]; g.V0[di] = o0[1]; g.SL[di] = o0[2];
        g.ICL[di] = 1 / Math.max(0.03, Math.sqrt(1 - o0[2] * o0[2]));
        nrm(x + 1.5, y + 0.5, o1); nrm(x + 0.5, y + 1.5, o2);
        var du1 = o1[0] - o0[0], du2 = o2[0] - o0[0];
        du1 -= Math.round(du1); du2 -= Math.round(du2);
        var foot = Math.max(Math.abs(du1) * TW, Math.abs(du2) * TW, Math.abs(o1[1] - o0[1]) * TH, Math.abs(o2[1] - o0[1]) * TH);
        g.LV[di] = foot < 1.6 ? 0 : foot < 3.2 ? 1 : foot < 6.4 ? 2 : 3;
        var tau = 0.065 / (nz + 0.045);
        g.EXT[di] = Math.exp(-tau * 0.8); g.HZA[di] = 1 - Math.exp(-tau * 1.1);
        g.FR[di] = 0.02 + 0.98 * Math.pow(1 - nz, 5);
        g.SPV[di] = 1 / (4 * Math.max(nz, 0.1));
        g.COV[di] = cov; g.HLA[di] = (1 - cov) * haloDen(Math.max(0, r2 - 1));
        g.BI[di] = bi;
        di++;
      } else if (r2 < EXTR) {
        var h = r2 - 1;
        g.HIDX[hi] = y * S + x; g.HPX[hi] = dx2 / r2; g.HPY[hi] = -dy2 / r2;
        g.HD[hi] = haloDen(h) * sstep(EXTR, EXTR - 0.06, r2);
        g.HAG[hi] = Math.exp(-Math.pow((h - 0.013) / 0.0045, 2));
        g.HBI[hi] = bi;
        hi++;
      }
    }
    g.canvas = document.createElement('canvas'); g.canvas.width = S; g.canvas.height = S;
    g.ctx = g.canvas.getContext('2d');
    g.img = g.ctx.createImageData(S, S);
    g.out = new Uint32Array(g.img.data.buffer);
    g.bcanvas = document.createElement('canvas'); g.bcanvas.width = BS; g.bcanvas.height = BS;
    g.bctx = g.bcanvas.getContext('2d');
    g.bimg = g.bctx.createImageData(BS, BS);
    g.bout = new Uint32Array(g.bimg.data.buffer);
    g.BR = new Float32Array(BS * BS); g.BG = new Float32Array(BS * BS); g.BB = new Float32Array(BS * BS);
    if (g.nE === undefined) g.nE = di;
    g.fresh = true; g.phase = 0;
    G = g;
    return g;
  }

  /* ---------- кадр ---------- */
  function render(st) {
    var g = G, T = tex;
    var Lx = st.L[0], Ly = st.L[1], Lz = st.L[2];
    var hx = Lx, hy = Ly, hz = Lz + 1, hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
    hx /= hl; hy /= hl; hz /= hl;
    var LH = Lx * hx + Ly * hy + Lz * hz, Fr = 0.02 + 0.98 * Math.pow(Math.max(0, 1 - LH), 5);
    var Cx = Ly * AZ - Lz * AY, Cy = Lz * AX - Lx * AZ, Cz = Lx * AY - Ly * AX, LA = Lx * AX + Ly * AY + Lz * AZ;
    var ct = -Lz, gg = 0.68;
    var phR = 0.75 * (1 + ct * ct);
    var hg0 = (1 - gg * gg) / Math.pow(1 + gg * gg, 1.5);
    var phM = Math.min(34, ((1 - gg * gg) / Math.pow(1 + gg * gg - 2 * gg * ct, 1.5)) / hg0);
    var kR = 0.55 * phR, kM = 0.1 * phM, k2;
    for (k2 = 0; k2 < 3; k2++) {
      var hzc = HZ[k2], hlc = HL[k2], a1 = HDR[k2], a2 = HDM[k2], b1 = HHR[k2], b2 = HHM[k2];
      for (var q = 0; q < MN; q++) { hzc[q] = a1[q] * kR + a2[q] * kM; hlc[q] = b1[q] * kR + b2[q] * kM; }
    }
    var HZr = HZ[0], HZg = HZ[1], HZb = HZ[2], HLr = HL[0], HLg = HL[1], HLb = HL[2];
    var DR = DIR[0], DG = DIR[1], DB = DIR[2], CR = CLD[0], CG = CLD[1], CB = CLD[2];
    var AR = AMB[0], AG = AMB[1], AB = AMB[2], TR = TN[0], TG = TN[1], TB = TN[2];
    var SR = SKY[0], SG = SKY[1], SB = SKY[2];

    var TAs = T.A, TBs = T.B, TCs = T.C, TWs = [T.W, T.W >> 1, T.W >> 2, T.W >> 3], THs = [T.H, T.H >> 1, T.H >> 2, T.H >> 3];
    var rotU = st.rot, rotC = st.rotC, cloudAmt = st.clouds, lightAmt = st.lights, expo = st.exposure * TMS;
    var NX = g.NX, NY = g.NY, NZ = g.NZ, U0 = g.U0, V0 = g.V0, LV = g.LV, SL = g.SL, ICL = g.ICL;
    var EXT = g.EXT, HZA = g.HZA, FR = g.FR, SPV = g.SPV, COV = g.COV, HLA = g.HLA, IDX = g.IDX, BI = g.BI;
    var out = g.out, BRa = g.BR, BGa = g.BG, BBa = g.BB, nD = g.nD;
    BRa.fill(0); BGa.fill(0); BBa.fill(0);
    var SHK = 0.0045, TWO_PI = 2 * PI;
    var i0 = 0, i1 = nD, bk = 1;
    if (!st.full && !g.fresh) {
      if (g.phase) i0 = g.nE; else i1 = g.nE;
      g.phase ^= 1; bk = 2;
    }
    g.fresh = false;

    for (var i = i0; i < i1; i++) {
      var nx = NX[i], ny = NY[i], nz = NZ[i];
      var mu = nx * Lx + ny * Ly + nz * Lz;
      var lv = LV[i], w = TWs[lv], hh = THs[lv], A = TAs[lv], Bt = TBs[lv], Ct = TCs[lv];
      var u = U0[i] + rotU; u -= Math.floor(u); u = u * w - 0.5; if (u < 0) u += w;
      var iu = u | 0, fu = u - iu, iu1 = iu + 1; if (iu1 >= w) iu1 -= w;
      var v = V0[i] * hh - 0.5; if (v < 0) v = 0; else if (v > hh - 1.001) v = hh - 1.001;
      var iv = v | 0, fv = v - iv, r0 = iv * w, r1 = r0 + w;
      var wu = (fu * 256) | 0, iwu = 256 - wu, wv = (fv * 256) | 0, iwv = 256 - wv;
      var a0 = A[r0 + iu], a1b = A[r0 + iu1], a2b = A[r1 + iu], a3 = A[r1 + iu1];
      var t0 = (((a0 & 0xFF00FF) * iwu + (a1b & 0xFF00FF) * wu) >>> 8) & 0xFF00FF;
      var t1 = (((a2b & 0xFF00FF) * iwu + (a3 & 0xFF00FF) * wu) >>> 8) & 0xFF00FF;
      var rb = ((t0 * iwv + t1 * wv) >>> 8) & 0xFF00FF;
      t0 = ((((a0 >>> 8) & 0xFF00FF) * iwu + ((a1b >>> 8) & 0xFF00FF) * wu) >>> 8) & 0xFF00FF;
      t1 = ((((a2b >>> 8) & 0xFF00FF) * iwu + ((a3 >>> 8) & 0xFF00FF) * wu) >>> 8) & 0xFF00FF;
      var ga = ((t0 * iwv + t1 * wv) >>> 8) & 0xFF00FF;
      var alR = S2L[rb & 255], alB = S2L[rb >>> 16], alG = S2L[ga & 255], water = (ga >>> 16) * 0.00392157;

      a0 = Bt[r0 + iu]; a1b = Bt[r0 + iu1]; a2b = Bt[r1 + iu]; a3 = Bt[r1 + iu1];
      t0 = (((a0 & 0xFF00FF) * iwu + (a1b & 0xFF00FF) * wu) >>> 8) & 0xFF00FF;
      t1 = (((a2b & 0xFF00FF) * iwu + (a3 & 0xFF00FF) * wu) >>> 8) & 0xFF00FF;
      var lb = ((t0 * iwv + t1 * wv) >>> 8) & 0xFF00FF;
      var gxv = ((((a0 >>> 8) & 255) * iwu + ((a1b >>> 8) & 255) * wu) * iwv + (((a2b >>> 8) & 255) * iwu + ((a3 >>> 8) & 255) * wu) * wv) * 0.0000152587890625;

      var cov = 0, uc = 0, ju = 0;
      if (cloudAmt > 0) {
        uc = U0[i] + rotC; uc -= Math.floor(uc); uc = uc * w - 0.5; if (uc < 0) uc += w;
        ju = uc | 0; var fcu = uc - ju, ju1 = ju + 1; if (ju1 >= w) ju1 -= w;
        var cA = Ct[r0 + ju] + (Ct[r0 + ju1] - Ct[r0 + ju]) * fcu, cB = Ct[r1 + ju] + (Ct[r1 + ju1] - Ct[r1 + ju]) * fcu;
        cov = (cA + (cB - cA) * fv) * 0.00392157 * cloudAmt;
      }

      var mi = ((mu + 1) * 511.5) | 0;
      var gr, gg2, gb, shadow = 1;
      if (mu > -0.12) {
        var icl = ICL[i];
        var le = (nx * Cx + ny * Cy + nz * Cz) * icl, ln = (LA - SL[i] * mu) * icl;
        if (cloudAmt > 0 && mu > 0) {
          var im = SHK / (mu + 0.035), oe = le * im, on = ln * im;
          if (oe > 0.03) oe = 0.03; else if (oe < -0.03) oe = -0.03;
          if (on > 0.03) on = 0.03; else if (on < -0.03) on = -0.03;
          var su = uc + oe * icl * w / TWO_PI, sv = v - on * hh / PI;
          if (su < 0) su += w; else if (su >= w) su -= w;
          if (sv < 0) sv = 0; else if (sv > hh - 1) sv = hh - 1;
          shadow = 1 - 0.72 * Ct[(sv | 0) * w + (su | 0)] * 0.00392157 * cloudAmt;
        }
        var gyv = (lb >>> 16) - 128, gxs = gxv - 128;
        var mub = mu - (gxs * le + gyv * ln) * 0.0025;
        var mbi = ((mub + 1) * 511.5) | 0; if (mbi < 0) mbi = 0; else if (mbi > 1023) mbi = 1023;
        gr = alR * (DR[mbi] * shadow + AR[mi]); gg2 = alG * (DG[mbi] * shadow + AG[mi]); gb = alB * (DB[mbi] * shadow + AB[mi]);
        if (water > 0.02) {
          var nh = nx * hx + ny * hy + nz * hz, sk = ((1 - nh) * SPK) | 0;
          if (sk < SPN) {
            /* мягкое колено: блик не выбивается в белое; у лимба он упирается в потолок
               и из-за ракурса вытягивается вдоль края диска */
            var sp = SPEC[sk] * Fr * SPV[i];
            if (sp > 0.25) sp = 0.25 + 0.25 * (1 - Math.exp(-(sp - 0.25) * 4));
            sp *= water * shadow;
            gr += sp * TR[mi]; gg2 += sp * TG[mi]; gb += sp * TB[mi];
          }
          var fw = FR[i] * water;
          gr += fw * SR[mi]; gg2 += fw * SG[mi]; gb += fw * SB[mi];
        }
      } else {
        gr = alR * AR[mi]; gg2 = alG * AG[mi]; gb = alB * AB[mi];
      }

      var em = 0;
      if (lightAmt > 0) {
        var nlf = NL[mi];
        if (nlf > 0) {
          em = LL[lb & 255] * nlf * lightAmt;
          if (em > 0) {
            var ew = em * (1 - cov * 0.88);
            gr += ew; gg2 += ew * (0.52 + 0.18 * (em > 1 ? 1 : em)); gb += ew * (0.2 + 0.22 * (em > 1 ? 1 : em));
          }
        }
      }

      var cr, cg, cb;
      if (cov > 0.002) {
        var dk = 0.8 + 0.2 * cov, ic = 1 - cov;
        var cl0 = CR[mi] * dk, cl1 = CG[mi] * dk, cl2 = CB[mi] * dk;
        var cw = cov * 0.92;
        cr = gr * ic + (cl0 + AR[mi] * 1.3 + em * 0.3) * cw;
        cg = gg2 * ic + (cl1 + AG[mi] * 1.3 + em * 0.17) * cw;
        cb = gb * ic + (cl2 + AB[mi] * 1.3 + em * 0.07) * cw;
      } else { cr = gr; cg = gg2; cb = gb; }

      var ext = EXT[i], hza = HZA[i];
      cr = cr * ext + HZr[mi] * hza; cg = cg * ext + HZg[mi] * hza; cb = cb * ext + HZb[mi] * hza;
      var hla = HLA[i];
      if (hla > 0) {
        var cv2 = COV[i];
        cr = cr * cv2 + HLr[mi] * hla; cg = cg * cv2 + HLg[mi] * hla; cb = cb * cv2 + HLb[mi] * hla;
      }

      var ir = (cr * expo) | 0, ig = (cg * expo) | 0, ib = (cb * expo) | 0;
      if (ir > 4095) ir = 4095; if (ig > 4095) ig = 4095; if (ib > 4095) ib = 4095;
      out[IDX[i]] = 0xFF000000 | (TMB[ib] << 16) | (TMG[ig] << 8) | TMR[ir];

      var bb = BI[i], xr = cr - 1.0, xg = cg - 1.0, xb = cb - 1.0;
      if (xr > 0) BRa[bb] += (xr > 6 ? 6 : xr) * bk;
      if (xg > 0) BGa[bb] += (xg > 6 ? 6 : xg) * bk;
      if (xb > 0) BBa[bb] += (xb > 6 ? 6 : xb) * bk;
      if (em > 0.02) { var e2 = em * (1 - cov * 0.6) * 0.5 * bk; BRa[bb] += e2; BGa[bb] += e2 * 0.55; BBa[bb] += e2 * 0.22; }
    }

    /* ореол за краем диска */
    var HIDX = g.HIDX, HPX = g.HPX, HPY = g.HPY, HD = g.HD, HAG = g.HAG, HBI = g.HBI, nH = g.nH;
    var agR = 0.008, agG = 0.032, agB = 0.02;
    for (var j = 0; j < nH; j++) {
      var mh = HPX[j] * Lx + HPY[j] * Ly, mj = ((mh + 1) * 511.5) | 0, d = HD[j], ag = HAG[j] * NLH[mj];
      var hr = HLr[mj] * d + agR * ag, hg = HLg[mj] * d + agG * ag, hb = HLb[mj] * d + agB * ag;
      var jr = (hr * expo) | 0, jg = (hg * expo) | 0, jb = (hb * expo) | 0;
      if (jr > 4095) jr = 4095; if (jg > 4095) jg = 4095; if (jb > 4095) jb = 4095;
      out[HIDX[j]] = 0xFF000000 | (TMB0[jb] << 16) | (TMG[jg] << 8) | TMR[jr];
      var hb2 = HBI[j];
      BRa[hb2] += hr * 0.3; BGa[hb2] += hg * 0.3; BBa[hb2] += hb * 0.3;
    }
    g.ctx.putImageData(g.img, 0, 0);

    /* свечение (bloom): средние по ячейке 4×4 → байты */
    var bo = g.bout, n = g.BS * g.BS, bs = st.bloom / 16 * 128;
    for (var k = 0; k < n; k++) {
      var vr = (BRa[k] * bs) | 0, vg = (BGa[k] * bs) | 0, vb = (BBa[k] * bs) | 0;
      if (vr > 1023) vr = 1023; if (vg > 1023) vg = 1023; if (vb > 1023) vb = 1023;
      bo[k] = 0xFF000000 | (BLT[vb] << 16) | (BLT[vg] << 8) | BLT[vr];
    }
    g.bctx.putImageData(g.bimg, 0, 0);
    return g;
  }

  return {
    setTextures: function (t) { tex = t; },
    build: build, render: render,
    get geom() { return G; },
    EXTR: EXTR, axis: [AX, AY, AZ]
  };
})();
