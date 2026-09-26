/* Процедурная генерация текстур планеты (равнопромежуточная проекция 2048×1024):
   A — альбедо sRGB + маска воды (для блика), B — огни городов + наклоны рельефа (bump),
   C — облачность. Работает как генератор: отдаёт прогресс, чтобы не вешать страницу. */
var Planet = (function () {
  var W = 2048, H = 1024, PI = Math.PI;
  var N = Noise;

  function sstep(a, b, x) { var t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function cl(x, a, b) { return x < a ? a : x > b ? b : x; }
  function wrapX(x) { x %= W; return x < 0 ? x + W : x; }

  function rasterPoly(pts, val, dst) {
    var n = pts.length >> 1, minLat = 90, maxLat = -90, k;
    for (k = 0; k < n; k++) { var la = pts[k * 2 + 1]; if (la < minLat) minLat = la; if (la > maxLat) maxLat = la; }
    var y0 = Math.max(0, Math.floor((90 - maxLat) / 180 * H) - 1), y1 = Math.min(H - 1, Math.ceil((90 - minLat) / 180 * H) + 1);
    var xs = [];
    for (var y = y0; y <= y1; y++) {
      var lat = 90 - (y + 0.5) * 180 / H;
      xs.length = 0;
      for (var i = 0, j = n - 1; i < n; j = i++) {
        var a1 = pts[j * 2 + 1], a2 = pts[i * 2 + 1];
        if ((a1 > lat) !== (a2 > lat)) {
          var o1 = pts[j * 2], o2 = pts[i * 2];
          xs.push(o1 + (lat - a1) * (o2 - o1) / (a2 - a1));
        }
      }
      if (xs.length < 2) continue;
      xs.sort(function (a, b) { return a - b; });
      for (k = 0; k + 1 < xs.length; k += 2) {
        var x0 = Math.ceil((xs[k] + 180) / 360 * W - 0.5), x1 = Math.floor((xs[k + 1] + 180) / 360 * W - 0.5);
        for (var x = x0; x <= x1; x++) dst[y * W + wrapX(x)] = val;
      }
    }
  }

  function rasterDot(lon, lat, r, val, dst) {
    var cy = (90 - lat) / 180 * H - 0.5, cx = (lon + 180) / 360 * W - 0.5;
    var ry = r / 180 * H + 0.35, rx = ry / Math.max(0.15, Math.cos(lat * PI / 180));
    for (var y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      if (y < 0 || y >= H) continue;
      for (var x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        var dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) dst[y * W + wrapX(x)] = val;
      }
    }
  }

  function boxBlur(src, r) {
    var tmp = new Float32Array(W * H), x, y, s, win = 2 * r + 1;
    for (y = 0; y < H; y++) {
      var o = y * W; s = 0;
      for (x = -r; x <= r; x++) s += src[o + wrapX(x)];
      for (x = 0; x < W; x++) {
        tmp[o + x] = s / win;
        s += src[o + wrapX(x + r + 1)] - src[o + wrapX(x - r)];
      }
    }
    for (x = 0; x < W; x++) {
      s = 0;
      for (y = -r; y <= r; y++) s += tmp[cl(y, 0, H - 1) * W + x];
      for (y = 0; y < H; y++) {
        src[y * W + x] = s / win;
        s += tmp[cl(y + r + 1, 0, H - 1) * W + x] - tmp[cl(y - r, 0, H - 1) * W + x];
      }
    }
  }

  /* дистанция (в текселях по меридиану) до ближайшего источника; источник: src[i] == 1 */
  function distField(src, rowCos) {
    var d = new Float32Array(W * H), i, x, y;
    for (i = 0; i < W * H; i++) d[i] = src[i] ? 0 : 1e5;
    for (var it = 0; it < 2; it++) {
      for (y = 0; y < H; y++) {
        var cx = Math.max(rowCos[y], 0.04), dg = Math.sqrt(cx * cx + 1), o = y * W, up = o - W;
        for (x = 0; x < W; x++) {
          i = o + x; var v = d[i]; if (v === 0) continue;
          var xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1, a = d[o + xl] + cx;
          if (a < v) v = a;
          if (y > 0) {
            a = d[up + x] + 1; if (a < v) v = a;
            a = d[up + xl] + dg; if (a < v) v = a;
            a = d[up + xr] + dg; if (a < v) v = a;
          }
          d[i] = v;
        }
      }
      for (y = H - 1; y >= 0; y--) {
        var cx2 = Math.max(rowCos[y], 0.04), dg2 = Math.sqrt(cx2 * cx2 + 1), o2 = y * W, dn = o2 + W;
        for (x = W - 1; x >= 0; x--) {
          i = o2 + x; var w = d[i]; if (w === 0) continue;
          var xl2 = x === 0 ? W - 1 : x - 1, xr2 = x === W - 1 ? 0 : x + 1, b = d[o2 + xr2] + cx2;
          if (b < w) w = b;
          if (y < H - 1) {
            b = d[dn + x] + 1; if (b < w) w = b;
            b = d[dn + xl2] + dg2; if (b < w) w = b;
            b = d[dn + xr2] + dg2; if (b < w) w = b;
          }
          d[i] = w;
        }
      }
    }
    return d;
  }

  /* низкорез. сетка 512×256 (1 ячейка = 4×4 текселя) */
  var GW = 512, GH = 256;
  function gridSample(g, x, y) {
    var gx = (x + 0.5) * 0.25 - 0.5, gy = (y + 0.5) * 0.25 - 0.5;
    if (gy < 0) gy = 0; if (gy > GH - 1.001) gy = GH - 1.001;
    var ix = Math.floor(gx), iy = gy | 0, fx = gx - ix, fy = gy - iy;
    var x0 = ix < 0 ? ix + GW : ix, x1 = x0 + 1 === GW ? 0 : x0 + 1, r0 = iy * GW, r1 = r0 + GW;
    var a = g[r0 + x0] + (g[r0 + x1] - g[r0 + x0]) * fx, b = g[r1 + x0] + (g[r1 + x1] - g[r1 + x0]) * fx;
    return a + (b - a) * fy;
  }

  function* build(out) {
    var i, x, y, k;
    var rowLat = new Float64Array(H), rowSin = new Float64Array(H), rowCos = new Float64Array(H);
    var colCos = new Float64Array(W), colSin = new Float64Array(W);
    for (y = 0; y < H; y++) { var la = (0.5 - (y + 0.5) / H) * PI; rowLat[y] = la; rowSin[y] = Math.sin(la); rowCos[y] = Math.cos(la); }
    for (x = 0; x < W; x++) { var lo = ((x + 0.5) / W) * 2 * PI - PI; colCos[x] = Math.cos(lo); colSin[x] = Math.sin(lo); }

    /* 1. растр контуров */
    var orig = new Uint8Array(W * H), lake = new Uint8Array(W * H), dot = new Uint8Array(W * H);
    GEO.land.forEach(function (pl) { rasterPoly(pl.p, pl.ice ? 2 : 1, orig); });
    GEO.water.forEach(function (pl) { rasterPoly(pl, 1, lake); });
    for (i = 0; i < W * H; i++) if (lake[i]) orig[i] = 0;
    var dt = GEO.dots;
    for (k = 0; k < dt.length; k += 3) rasterDot(dt[k], dt[k + 1], dt[k + 2], 1, dot);
    yield 0.02;

    /* 2. фрактальная береговая линия: деформация + острова/заливы в полосе берега */
    var m = new Float32Array(W * H);
    for (i = 0; i < W * H; i++) m[i] = orig[i] ? 1 : 0;
    boxBlur(m, 2); boxBlur(m, 2);
    var land = new Uint8Array(W * H);
    for (y = 0; y < H; y++) {
      var sL = rowSin[y], cL = rowCos[y], icl = 1 / Math.max(cL, 0.12);
      for (x = 0; x < W; x++) {
        i = y * W + x; var mv = m[i], v;
        if (mv <= 0.004) v = 0;
        else if (mv >= 0.996) v = orig[i];
        else {
          var px = cL * colCos[x], py = sL, pz = cL * colSin[x];
          var wx = N.fbm(px * 14 + 3.1, py * 14, pz * 14, 4, 2.1, 0.5) * 2.6 * icl;
          var wy = N.fbm(px * 14, py * 14 + 7.7, pz * 14 - 2.2, 4, 2.1, 0.5) * 2.6;
          var sx = wrapX(Math.round(x + wx)), sy = cl(Math.round(y + wy), 0, H - 1);
          v = orig[sy * W + sx];
          var nn = mv + 0.34 * N.fbm(px * 30 - 5, py * 30 + 1, pz * 30, 4, 2.2, 0.55);
          if (!v && nn > 0.64) v = orig[i] || 1;
          else if (v && mv > 0.55 && nn < 0.36) v = 0;
        }
        if (lake[i]) v = 0;
        if (dot[i]) v = 1;
        land[i] = v;
      }
      if ((y & 63) === 63) yield 0.02 + 0.1 * y / H;
    }
    m = null; dot = null;

    /* 3. поля расстояний до берега */
    var isLand = new Uint8Array(W * H), isWater = new Uint8Array(W * H);
    for (i = 0; i < W * H; i++) { isLand[i] = land[i] ? 1 : 0; isWater[i] = land[i] ? 0 : 1; }
    var distO = distField(isLand, rowCos);
    yield 0.15;
    var distL = distField(isWater, rowCos);
    isLand = isWater = null;
    yield 0.18;

    /* 4. низкорезовые поля: горы, влажность, оттенок почвы, вариации океана */
    var MT = new Float32Array(GW * GH), MO = new Float32Array(GW * GH), SH = new Float32Array(GW * GH), OV = new Float32Array(GW * GH);
    GEO.mountains.forEach(function (mt) {
      var p = mt.p.slice();
      for (var q = 2; q < p.length; q += 2) { while (p[q] - p[q - 2] > 180) p[q] -= 360; while (p[q] - p[q - 2] < -180) p[q] += 360; }
      for (q = 0; q + 3 < p.length; q += 2) {
        var ax = p[q], ay = p[q + 1], bx = p[q + 2], by = p[q + 3];
        var cm = Math.max(0.12, Math.cos((ay + by) * 0.5 * PI / 180));
        var ext = mt.w * 3, gy0 = Math.floor((90 - Math.max(ay, by) - ext) / 180 * GH), gy1 = Math.ceil((90 - Math.min(ay, by) + ext) / 180 * GH);
        var gx0 = Math.floor((Math.min(ax, bx) - ext / cm + 180) / 360 * GW), gx1 = Math.ceil((Math.max(ax, bx) + ext / cm + 180) / 360 * GW);
        var ux = (bx - ax) * cm, uy = by - ay, ll = ux * ux + uy * uy || 1e-6;
        for (var gy = Math.max(0, gy0); gy <= Math.min(GH - 1, gy1); gy++) {
          var lat = 90 - (gy + 0.5) * 180 / GH;
          for (var gx = gx0; gx <= gx1; gx++) {
            var lon = (gx + 0.5) * 360 / GW - 180;
            var dx = (lon - ax) * cm, dy = lat - ay, t = cl((dx * ux + dy * uy) / ll, 0, 1);
            var ex = dx - ux * t, ey = dy - uy * t, dd = (ex * ex + ey * ey) / (mt.w * mt.w);
            var val = mt.h * Math.exp(-dd), gi = gy * GW + ((gx % GW) + GW) % GW;
            if (val > MT[gi]) MT[gi] = val;
          }
        }
      }
    });
    var mb = GEO.moist;
    for (var gy = 0; gy < GH; gy++) {
      var glat = 90 - (gy + 0.5) * 180 / GH, al = Math.abs(glat), gla = glat * PI / 180, gc = Math.cos(gla), gs = Math.sin(gla);
      var base = al < 8 ? 0.95 : al < 18 ? 0.95 - (al - 8) * 0.04 : al < 30 ? 0.55 - (al - 18) * 0.03 : al < 40 ? 0.19 + (al - 30) * 0.05 : al < 58 ? 0.69 - (al - 40) * 0.004 : 0.62 - (al - 58) * 0.006;
      for (var gx = 0; gx < GW; gx++) {
        var glon = (gx + 0.5) * 360 / GW - 180, gl = glon * PI / 180;
        var qx = gc * Math.cos(gl), qy = gs, qz = gc * Math.sin(gl), s = base;
        for (k = 0; k < mb.length; k += 5) {
          var dl = glon - mb[k]; dl = ((dl + 540) % 360) - 180;
          var e1 = dl / mb[k + 2], e2 = (glat - mb[k + 1]) / mb[k + 3], ee = e1 * e1 + e2 * e2;
          if (ee < 9) s += mb[k + 4] * Math.exp(-ee * 1.2);
        }
        var dIn = distL[Math.min(H - 1, gy * 4 + 2) * W + gx * 4 + 2];
        s -= 0.22 * sstep(10, 70, dIn) * (1 - sstep(0, 12, al) * 0.6);
        s += 0.16 * N.fbm(qx * 2.6 + 11, qy * 2.6, qz * 2.6 - 4, 3, 2.1, 0.5);
        var gi = gy * GW + gx;
        MO[gi] = s;
        SH[gi] = N.fbm(qx * 3.2 - 7, qy * 3.2 + 2, qz * 3.2 + 9, 3, 2.2, 0.5);
        OV[gi] = N.fbm(qx * 2.2 + 21, qy * 2.2 - 13, qz * 2.2 + 5, 3, 2.0, 0.5);
      }
      if ((gy & 31) === 31) yield 0.18 + 0.04 * gy / GH;
    }
    yield 0.22;

    /* 5. альбедо, высоты */
    var A = new Uint32Array(W * H), E = new Float32Array(W * H), T8 = new Uint8Array(W * H), M8 = new Uint8Array(W * H);
    for (y = 0; y < H; y++) {
      var sL2 = rowSin[y], cL2 = rowCos[y], latD = rowLat[y] * 180 / PI, aL = Math.abs(latD);
      var Tlat = 1.0 - Math.pow(aL / 90, 1.6) * 1.05;
      var trop = sstep(30, 16, aL);
      for (x = 0; x < W; x++) {
        i = y * W + x;
        var qx2 = cL2 * colCos[x], qy2 = sL2, qz2 = cL2 * colSin[x];
        var r, g, b, spec = 0, lonD = (x + 0.5) * 360 / W - 180;
        if (land[i]) {
          var dl2 = distL[i];
          var n1 = N.fbm(qx2 * 9 + 1.3, qy2 * 9 - 2.1, qz2 * 9 + 0.7, 5, 2.07, 0.5);
          var hills = 0.5 + 0.5 * n1;
          var mt2 = gridSample(MT, x, y);
          var e = 0.03 + 0.10 * sstep(0, 30, dl2) + 0.07 * hills;
          if (mt2 > 0.02) e += mt2 * (0.35 + 0.85 * N.ridged(qx2 * 28, qy2 * 28, qz2 * 28, 4));
          var iceSheet = land[i] === 2 && (latD < -59 || dl2 > 1.2 + 2.5 * hills);
          if (latD < -60) iceSheet = true;
          var mo = gridSample(MO, x, y) + 0.12 * n1;
          var Tt = Tlat - e * 0.6 + 0.04 * n1 - 0.08 * sstep(20, 80, dl2) * sstep(35, 60, aL);
          if (iceSheet) {
            e = 0.06 + 0.45 * sstep(0, 60, dl2) + 0.04 * n1;
            var ic = 0.5 + 0.5 * N.fbm(qx2 * 40, qy2 * 40, qz2 * 40, 2, 2, 0.5);
            r = 226 + 14 * ic; g = 233 + 11 * ic; b = 242 + 10 * ic;
            if (dl2 < 4) { var edge = 1 - dl2 / 4; r -= 30 * edge; g -= 24 * edge; b -= 14 * edge; }
          } else {
            var sh = gridSample(SH, x, y);
            var red = (lonD > 113 && lonD < 154 && latD < -12 && latD > -38) ? 0.45 : 0;
            var sHue = cl(0.45 + 0.6 * sh + red + 0.15 * n1, 0, 1);
            var sR = 216 - 44 * sHue, sG = 190 - 78 * sHue, sB = 146 - 88 * sHue;
            var warm = sstep(0.4, 0.78, Tt);
            var semR = 150 - 22 * warm, semG = 136 - 12 * warm, semB = 92 - 26 * warm;
            var grR = 78 + 10 * warm, grG = 98 + 12 * warm, grB = 50;
            var fT = sstep(0.42, 0.62, Tt), fR2 = sstep(0.78, 0.93, Tt);
            var wR = 30 + (42 - 30) * fT + (20 - 42) * fR2 * fT, wG = 52 + (74 - 52) * fT + (56 - 74) * fR2 * fT, wB = 36 + (32 - 36) * fT + (22 - 32) * fR2 * fT;
            var t1 = sstep(0.1, 0.3, mo), t2 = sstep(0.28, 0.46, mo), t3 = sstep(0.44, 0.66, mo);
            r = sR + (semR - sR) * t1; g = sG + (semG - sG) * t1; b = sB + (semB - sB) * t1;
            r += (grR - r) * t2; g += (grG - g) * t2; b += (grB - b) * t2;
            r += (wR - r) * t3; g += (wG - g) * t3; b += (wB - b) * t3;
            var tw = sstep(0.36, 0.2, Tt);
            r += (104 - r) * tw; g += (98 - g) * tw; b += (78 - b) * tw;
            var rw = sstep(0.32, 0.85, e) * 0.85;
            r += (116 - r) * rw; g += (104 - g) * rw; b += (92 - b) * rw;
            var br = 0.88 + 0.24 * hills; r *= br; g *= br; b *= br;
            var sw = sstep(0.16, 0.06, Tt + 0.05 * n1);
            r += (238 - r) * sw; g += (242 - g) * sw; b += (248 - b) * sw;
          }
          E[i] = e;
          T8[i] = cl(Tt * 255, 0, 255); M8[i] = cl(mo * 255, 0, 255);
        } else {
          var dO = distO[i], ov = gridSample(OV, x, y);
          var shelf = Math.exp(-dO / 2.4), mid = Math.exp(-dO / 16);
          r = 4 + 8 * mid * 0.8; g = 15 + 22 * mid * 0.8; b = 38 + 36 * mid * 0.8;
          var shR = 30 + 16 * trop, shG = 86 + 56 * trop, shB = 108 + 44 * trop;
          var sf = shelf * (0.78 + 0.2 * ov);
          r += (shR - r) * sf; g += (shG - g) * sf; b += (shB - b) * sf;
          var hl = sstep(40, 65, aL);
          g += 6 * hl * (0.5 + ov); r += 2 * hl;
          var vb = 1 + 0.12 * ov; r *= vb; g *= vb; b *= vb;
          spec = 1;
          var si = 0;
          if (latD > 66) si = sstep(76 + 5 * ov, 80 + 5 * ov, latD);
          else if (latD < -58) si = sstep(-63 - 3 * ov, -67 - 2 * ov, latD);
          if (si > 0) {
            var fl = N.fbm(qx2 * 34, qy2 * 34, qz2 * 34, 3, 2.1, 0.55);
            si = cl(si * 1.4 + fl * 0.5 - 0.25, 0, 1);
            r += (206 - r) * si; g += (216 - g) * si; b += (228 - b) * si;
            spec = 1 - si;
          }
        }
        A[i] = ((((spec * 255) | 0) << 24) | ((cl(b, 0, 255) | 0) << 16) | ((cl(g, 0, 255) | 0) << 8) | (cl(r, 0, 255) | 0)) >>> 0;
      }
      if ((y & 15) === 15) yield 0.22 + 0.36 * y / H;
    }
    distO = null;

    /* 6. огни городов */
    var LT = new Float32Array(W * H), rnd = N.rng(20260923);
    function splat(lon, lat, sig, amp) {
      var cx = (lon + 180) / 360 * W - 0.5, cy = (90 - lat) / 180 * H - 0.5;
      var c = Math.max(Math.cos(lat * PI / 180), 0.15), sx = sig / c, sy = sig;
      var y0 = Math.max(0, Math.floor(cy - 3 * sy)), y1 = Math.min(H - 1, Math.ceil(cy + 3 * sy));
      var x0 = Math.floor(cx - 3 * sx), x1 = Math.ceil(cx + 3 * sx);
      for (var yy = y0; yy <= y1; yy++) {
        var dy = (yy - cy) / sy, dy2 = dy * dy, o = yy * W;
        for (var xx = x0; xx <= x1; xx++) {
          var dx = (xx - cx) / sx, q = dx * dx + dy2;
          if (q < 9) LT[o + wrapX(xx)] += amp * Math.exp(-0.5 * q);
        }
      }
    }
    function gauss() { var u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * v); }
    function texAt(lon, lat) {
      var tx = wrapX(Math.floor((lon + 180) / 360 * W)), ty = cl(Math.floor((90 - lat) / 180 * H), 0, H - 1);
      return ty * W + tx;
    }
    var C = GEO.cities, degT = 180 / H;
    for (k = 0; k < C.length; k += 3) {
      var lon0 = C[k], lat0 = C[k + 1], wgt = C[k + 2];
      splat(lon0, lat0, 0.7 + 1.5 * wgt, 0.35 + 0.9 * wgt);
      var nSub = (18 + 120 * wgt) | 0, spokes = 4 + ((rnd() * 4) | 0), sp0 = rnd() * 6.28;
      for (var s = 0; s < nSub; s++) {
        var rr = Math.abs(gauss()) * (1.3 + 5.5 * wgt), ang = rnd() < 0.5 ? sp0 + ((rnd() * spokes) | 0) * 6.283 / spokes + gauss() * 0.12 : rnd() * 6.283;
        var sLat = lat0 + Math.sin(ang) * rr * degT, sLon = lon0 + Math.cos(ang) * rr * degT / Math.max(0.2, Math.cos(lat0 * PI / 180));
        var li = texAt(sLon, sLat);
        if (!land[li]) continue;
        splat(sLon, sLat, 0.45 + rnd() * 0.45, (0.1 + 0.3 * rnd()) * Math.exp(-rr / (3 + 6 * wgt)) * (0.6 + wgt));
      }
    }
    var P = GEO.pop;
    function density(lon, lat) {
      var d = 0, q, e1, e2, ee;
      for (q = 0; q < P.length; q += 5) {
        e1 = (((lon - P[q] + 540) % 360) - 180) / P[q + 2]; e2 = (lat - P[q + 1]) / P[q + 3]; ee = e1 * e1 + e2 * e2;
        if (ee < 6) d += P[q + 4] * Math.exp(-ee);
      }
      var cc = Math.cos(lat * PI / 180);
      for (q = 0; q < C.length; q += 3) {
        e1 = (((lon - C[q] + 540) % 360) - 180) * cc; e2 = lat - C[q + 1]; ee = e1 * e1 + e2 * e2;
        var s2 = 2 + 5 * C[q + 2];
        if (ee < 9 * s2 * s2) d += C[q + 2] * 0.7 * Math.exp(-ee / (2 * s2 * s2));
      }
      return d;
    }
    for (var tr = 0; tr < 70000; tr++) {
      var tLat = Math.asin(2 * rnd() - 1) * 180 / PI, tLon = rnd() * 360 - 180;
      if (tLat < -56 || tLat > 72) continue;
      var ti = texAt(tLon, tLat);
      if (land[ti] !== 1 || T8[ti] < 60) continue;
      if (M8[ti] < 28 && distL[ti] > 3) continue;
      if (rnd() > density(tLon, tLat) * 0.55) continue;
      var big = rnd();
      splat(tLon, tLat, 0.45 + big * big * 0.9, 0.06 + 0.3 * big * big * big + 0.05 * rnd());
    }
    yield 0.64;
    function lane(pts, dens) {
      for (var q = 0; q + 3 < pts.length; q += 2) {
        var ax = pts[q], ay = pts[q + 1], bx = pts[q + 2], by = pts[q + 3];
        var cc = Math.cos((ay + by) * 0.5 * PI / 180), dx = (bx - ax) * cc, dy = by - ay;
        var len = Math.sqrt(dx * dx + dy * dy) / degT, steps = Math.max(2, (len / 1.1) | 0);
        for (var st = 0; st <= steps; st++) {
          var t = st / steps, jx = gauss() * 0.35 * degT, jy = gauss() * 0.35 * degT;
          var lo2 = ax + (bx - ax) * t + jx / Math.max(cc, 0.2), la2 = ay + (by - ay) * t + jy;
          if (!land[texAt(lo2, la2)]) continue;
          var amp = dens * 0.13 * (0.4 + rnd());
          if (rnd() < 0.07) amp *= 3.5;
          splat(lo2, la2, 0.5, amp);
        }
      }
    }
    GEO.lanes.forEach(function (ln) { lane(ln.p, ln.d); });
    for (k = 0; k < C.length; k += 3) {
      if (C[k + 2] < 0.3) continue;
      var near = [];
      for (var j2 = 0; j2 < C.length; j2 += 3) {
        if (j2 === k) continue;
        var cc2 = Math.cos(C[k + 1] * PI / 180), ddx = (((C[j2] - C[k] + 540) % 360) - 180) * cc2, ddy = C[j2 + 1] - C[k + 1];
        var d2 = ddx * ddx + ddy * ddy;
        if (d2 < 81) near.push([d2, j2]);
      }
      near.sort(function (a, b) { return a[0] - b[0]; });
      for (var nn2 = 0; nn2 < Math.min(3, near.length); nn2++) {
        var jj = near[nn2][1], ok = true;
        for (var f = 1; f < 4; f++) {
          var fl2 = C[k] + (((C[jj] - C[k] + 540) % 360) - 180) * f / 4, fa = C[k + 1] + (C[jj + 1] - C[k + 1]) * f / 4;
          if (!land[texAt(fl2, fa)]) { ok = false; break; }
        }
        if (ok) lane([C[k], C[k + 1], C[k] + (((C[jj] - C[k] + 540) % 360) - 180), C[jj + 1]], 0.25 + 0.35 * (C[k + 2] + C[jj + 2]) * 0.5);
      }
    }
    yield 0.67;

    /* 7. B: огни + наклоны рельефа */
    var B = new Uint32Array(W * H), KH = 0.006 / (2 * PI / W);
    for (y = 0; y < H; y++) {
      var ic2 = 1 / Math.max(rowCos[y], 0.08), o3 = y * W, yu = Math.max(0, y - 1) * W, yd = Math.min(H - 1, y + 1) * W;
      for (x = 0; x < W; x++) {
        i = o3 + x;
        var xl3 = x === 0 ? W - 1 : x - 1, xr3 = x === W - 1 ? 0 : x + 1;
        var gxv = (E[o3 + xr3] - E[o3 + xl3]) * 0.5 * KH * ic2, gyv = (E[yu + x] - E[yd + x]) * 0.5 * KH;
        var gxb = cl(Math.round(gxv * 400) + 128, 44, 212), gyb = cl(Math.round(gyv * 400) + 128, 44, 212);
        var lv = LT[i] * (land[i] ? 1 : 0.2);
        var lb = cl(Math.round(255 * (1 - Math.exp(-lv * 1.5))), 0, 255);
        B[i] = ((gyb << 16) | (gxb << 8) | lb) >>> 0;
      }
    }
    LT = null; E = null;
    yield 0.7;

    /* 8. облака: низкорез. закрученное fbm + климат, затем детализация */
    var CW = 1024, CH = 512, CL = new Float32Array(CW * CH), cyc = [], crn = N.rng(777);
    function addCyc(lon, lat, rad, str, trop) {
      var la3 = lat * PI / 180, lo3 = lon * PI / 180;
      cyc.push({ x: Math.cos(la3) * Math.cos(lo3), y: Math.sin(la3), z: Math.cos(la3) * Math.sin(lo3),
        r: rad, cr: Math.cos(rad), s: str * (lat > 0 ? -1 : 1), t: trop });
    }
    for (k = 0; k < 7; k++) addCyc(crn() * 360 - 180, 38 + crn() * 24, 0.2 + crn() * 0.14, 2.6 + crn() * 1.6, 0);
    for (k = 0; k < 8; k++) addCyc(crn() * 360 - 180, -40 - crn() * 22, 0.2 + crn() * 0.14, 2.6 + crn() * 1.6, 0);
    addCyc(-58, 19, 0.085, 7.5, 1); addCyc(134, 17, 0.1, 8.5, 1); addCyc(66, -15, 0.08, 7, 1);
    for (y = 0; y < CH; y++) {
      var cla = (0.5 - (y + 0.5) / CH) * PI, cc3 = Math.cos(cla), cs3 = Math.sin(cla), latc = cla * 180 / PI;
      var bias = 0.3 * Math.exp(-Math.pow((latc - 6) / 6.5, 2))
        - 0.3 * (Math.exp(-Math.pow((latc - 22) / 8, 2)) + Math.exp(-Math.pow((latc + 22) / 8, 2)))
        + 0.2 * Math.exp(-Math.pow((latc - 52) / 10, 2)) + 0.3 * Math.exp(-Math.pow((latc + 55) / 9, 2)) - 0.04;
      for (x = 0; x < CW; x++) {
        var clo = ((x + 0.5) / CW) * 2 * PI - PI;
        var px2 = cc3 * Math.cos(clo), py2 = cs3, pz2 = cc3 * Math.sin(clo), boost = 0, eye = 1;
        for (k = 0; k < cyc.length; k++) {
          var cy2 = cyc[k], cd = px2 * cy2.x + py2 * cy2.y + pz2 * cy2.z;
          if (cd <= cy2.cr) continue;
          var dn2 = Math.acos(Math.min(1, cd)) / cy2.r, th = cy2.s * (1 - dn2) * (1 - dn2);
          var ct = Math.cos(th), st2 = Math.sin(th), dp = cd * (1 - ct);
          var cxp = cy2.y * pz2 - cy2.z * py2, cyp = cy2.z * px2 - cy2.x * pz2, czp = cy2.x * py2 - cy2.y * px2;
          px2 = px2 * ct + cxp * st2 + cy2.x * dp; py2 = py2 * ct + cyp * st2 + cy2.y * dp; pz2 = pz2 * ct + czp * st2 + cy2.z * dp;
          boost += (cy2.t ? 0.45 : 0.2) * Math.exp(-dn2 * dn2 * 3);
          if (cy2.t) eye *= sstep(0.035, 0.1, dn2);
        }
        var wx2 = N.fbm(px2 * 1.8 + 5.2, py2 * 1.8, pz2 * 1.8, 2, 2, 0.5);
        var wy2 = N.fbm(px2 * 1.8, py2 * 1.8 + 3.3, pz2 * 1.8, 2, 2, 0.5);
        var wz2 = N.fbm(px2 * 1.8, py2 * 1.8, pz2 * 1.8 + 8.8, 2, 2, 0.5);
        var bse = N.fbm(px2 * 2.6 + wx2 * 0.7, py2 * 5.2 + wy2 * 0.7, pz2 * 2.6 + wz2 * 0.7, 5, 2.05, 0.56);
        var tx3 = x * 2, ty3 = y * 2, ti3 = ty3 * W + tx3, lb2 = bias;
        if (land[ti3] === 1) lb2 += (M8[ti3] / 255 - 0.45) * 0.4;
        CL[y * CW + x] = (bse * 0.62 + lb2 + boost) * eye - (1 - eye) * 0.6;
      }
      if ((y & 15) === 15) yield 0.7 + 0.14 * y / CH;
    }
    var Cc = new Uint8Array(W * H);
    for (y = 0; y < H; y++) {
      var sL4 = rowSin[y], cL4 = rowCos[y];
      var fy2 = (y + 0.5) * 0.5 - 0.5; if (fy2 < 0) fy2 = 0; if (fy2 > CH - 1.001) fy2 = CH - 1.001;
      var iy2 = fy2 | 0, ffy = fy2 - iy2, r0 = iy2 * CW, r1 = r0 + CW;
      for (x = 0; x < W; x++) {
        var fx2 = (x + 0.5) * 0.5 - 0.5, ix2 = Math.floor(fx2), ffx = fx2 - ix2;
        var xa = ix2 < 0 ? CW - 1 : ix2, xb = xa + 1 === CW ? 0 : xa + 1;
        var ca = CL[r0 + xa] + (CL[r0 + xb] - CL[r0 + xa]) * ffx, cb = CL[r1 + xa] + (CL[r1 + xb] - CL[r1 + xa]) * ffx;
        var qx4 = cL4 * colCos[x], qz4 = cL4 * colSin[x];
        var vv = ca + (cb - ca) * ffy + 0.17 * N.fbm(qx4 * 44, sL4 * 60, qz4 * 44, 2, 2.3, 0.5)
          + 0.07 * N.n3(qx4 * 170, sL4 * 190, qz4 * 170);
        var dens = sstep(0.04, 0.46, vv);
        Cc[y * W + x] = (255 * Math.pow(dens, 0.85)) | 0;
      }
      if ((y & 31) === 31) yield 0.84 + 0.13 * y / H;
    }
    CL = null;

    /* 9. мип-уровни */
    function mipPacked(src, w, h) {
      var w2 = w >> 1, h2 = h >> 1, dst = new Uint32Array(w2 * h2);
      for (var yy = 0; yy < h2; yy++) for (var xx = 0; xx < w2; xx++) {
        var a = src[(yy * 2) * w + xx * 2], b = src[(yy * 2) * w + xx * 2 + 1], c = src[(yy * 2 + 1) * w + xx * 2], d = src[(yy * 2 + 1) * w + xx * 2 + 1];
        var rb = (((a & 0xFF00FF) + (b & 0xFF00FF) + (c & 0xFF00FF) + (d & 0xFF00FF)) >>> 2) & 0xFF00FF;
        var ga = ((((a >>> 8) & 0xFF00FF) + ((b >>> 8) & 0xFF00FF) + ((c >>> 8) & 0xFF00FF) + ((d >>> 8) & 0xFF00FF)) >>> 2) & 0xFF00FF;
        dst[yy * w2 + xx] = (rb | (ga << 8)) >>> 0;
      }
      return dst;
    }
    function mip8(src, w, h) {
      var w2 = w >> 1, h2 = h >> 1, dst = new Uint8Array(w2 * h2);
      for (var yy = 0; yy < h2; yy++) for (var xx = 0; xx < w2; xx++) {
        var o = yy * 2 * w + xx * 2;
        dst[yy * w2 + xx] = (src[o] + src[o + 1] + src[o + w] + src[o + w + 1] + 2) >> 2;
      }
      return dst;
    }
    out.W = W; out.H = H; out.A = [A]; out.B = [B]; out.C = [Cc];
    for (k = 1; k < 4; k++) {
      var w0 = W >> (k - 1), h0 = H >> (k - 1);
      out.A.push(mipPacked(out.A[k - 1], w0, h0));
      out.B.push(mipPacked(out.B[k - 1], w0, h0));
      out.C.push(mip8(out.C[k - 1], w0, h0));
    }
    yield 1;
  }

  return { W: W, H: H, build: build };
})();
