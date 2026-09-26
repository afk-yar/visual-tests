/* Сцена: звёздное небо, генерация планеты, покадровый рендер шара, свечение,
   солнце с бликами объектива, управление светом и панель. */
(function () {
  'use strict';
  var PI = Math.PI;
  var canvas = document.getElementById('scene'), ctx = canvas.getContext('2d');
  var elLoader = document.getElementById('loader'), elProg = document.getElementById('lprog'), elPct = document.getElementById('lpct');
  var elStats = document.getElementById('stats');
  var stars = document.createElement('canvas'), sctx = stars.getContext('2d');
  var b2 = document.createElement('canvas'), b2c = b2.getContext('2d');
  var b3 = document.createElement('canvas'), b3c = b3.getContext('2d');
  var b4 = document.createElement('canvas'), b4c = b4.getContext('2d');

  var Wc = 0, Hc = 0, DPR = 1, Wd = 0, Hd = 0, cxD = 0, cyD = 0, RD = 0;
  var tex = null, ready = false, gen = null, genObj = {}, reveal = 0;
  var cap = 300, emaMs = 9, frameN = 0, lastAdapt = 0;

  function sstep(a, b, x) { var t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function D2R(d) { return d * PI / 180; }

  var PRESETS = {
    dawn: { az: -86, el: 8 }, day: { az: -30, el: 18 }, dusk: { az: -62, el: 15 },
    night: { az: 128, el: 10 }, eclipse: { az: 168, el: 7 }
  };
  var S = {
    spin: 3.5 / 360, speed: 1, period: 110, paused: false,
    cloudOff: 0, clouds: 1, cloudsOn: true, lights: 1, lightsOn: true,
    autoSun: false, az: D2R(PRESETS.dusk.az), el: D2R(PRESETS.dusk.el), tween: null,
    dragging: false, gizmo: 0, lastInteract: -10, time: 0
  };

  /* ---------- размеры ---------- */
  function resize() {
    Wc = Math.max(1, window.innerWidth); Hc = Math.max(1, window.innerHeight);
    DPR = Math.min(2, window.devicePixelRatio || 1);
    Wd = Math.round(Wc * DPR); Hd = Math.round(Hc * DPR);
    canvas.width = Wd; canvas.height = Hd;
    var Rc = Math.min(Wc * 0.36, Hc * 0.37);
    RD = Rc * DPR; cxD = Wd / 2; cyD = Hd * (Wc < 640 ? 0.44 : 0.48);
    buildStars();
    if (ready) rebuildGeom(true);
  }
  function rebuildGeom(force) {
    var r = Math.max(90, Math.round(Math.min(RD, cap)));
    var g = Globe.geom;
    if (!force && g && Math.abs(g.R - r) / r < 0.03) return;
    g = Globe.build(r);
    b2.width = Math.max(2, g.BS >> 1); b2.height = b2.width;
    b3.width = Math.max(2, g.BS >> 2); b3.height = b3.width;
    b4.width = Math.max(2, g.BS >> 3); b4.height = b4.width;
  }

  /* ---------- звёздное небо ---------- */
  function buildStars() {
    var w = Wd, h = Hd, c = sctx, rnd = Noise.rng(4242), k;
    stars.width = w; stars.height = h;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#010207'; c.fillRect(0, 0, w, h);
    var neb = [[0.18, 0.25, 0.55, '38,52,130', 0.10], [0.82, 0.7, 0.6, '70,34,110', 0.08],
               [0.6, 0.12, 0.4, '20,80,110', 0.06], [0.1, 0.85, 0.45, '90,40,70', 0.05]];
    c.globalCompositeOperation = 'lighter';
    for (k = 0; k < neb.length; k++) {
      var n = neb[k], rr = n[2] * Math.max(w, h), gr = c.createRadialGradient(n[0] * w, n[1] * h, 0, n[0] * w, n[1] * h, rr);
      gr.addColorStop(0, 'rgba(' + n[3] + ',' + n[4] + ')'); gr.addColorStop(1, 'rgba(' + n[3] + ',0)');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
    }
    /* Млечный Путь */
    var lw = Math.max(8, Math.ceil(w / 7)), lh = Math.max(8, Math.ceil(h / 7));
    var mw = document.createElement('canvas'); mw.width = lw; mw.height = lh;
    var mc = mw.getContext('2d'), id = mc.createImageData(lw, lh), d = id.data;
    var ax = -0.1 * lw, ay = 0.92 * lh, bxp = 1.1 * lw, byp = 0.05 * lh, dx = bxp - ax, dy = byp - ay, dl = Math.sqrt(dx * dx + dy * dy);
    dx /= dl; dy /= dl;
    var mn = Math.min(lw, lh);
    function band(px, py) {
      var rx = px - ax, ry = py - ay, s = (rx * dx + ry * dy) / mn, q = (rx * -dy + ry * dx) / mn;
      return [s, q];
    }
    for (var y = 0; y < lh; y++) for (var x = 0; x < lw; x++) {
      var sq = band(x, y), s = sq[0], q = sq[1];
      var sig = 0.11 + 0.05 * Noise.fbm(s * 2.2, 0.3, 1.7, 3, 2, 0.5);
      var core = Math.exp(-q * q / (sig * sig));
      var cl = 0.5 + 0.5 * Noise.fbm(x / mn * 9, y / mn * 9, 0.37, 5, 2.1, 0.55);
      var dust = Noise.fbm(x / mn * 6 + 4, y / mn * 6, 5.1, 4, 2.1, 0.55);
      var rift = Math.exp(-Math.pow(q / (sig * 0.3) + 0.25 * dust, 2)) * sstep(-0.3, 0.35, dust);
      var bright = 0.25 + 0.75 * Math.exp(-Math.pow((s - 1.1) / 0.9, 2));
      var I = core * (0.35 + 0.65 * cl * cl) * (1 - 0.8 * rift) * bright;
      var wm = core * core;
      var o = (y * lw + x) * 4;
      d[o] = Math.min(255, I * (120 + 120 * wm)); d[o + 1] = Math.min(255, I * (128 + 90 * wm)); d[o + 2] = Math.min(255, I * (190 + 30 * wm)); d[o + 3] = 255;
    }
    mc.putImageData(id, 0, 0);
    c.globalAlpha = 0.3; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(mw, 0, 0, w, h);
    c.globalAlpha = 1;
    /* звёзды */
    var total = Math.round(w * h / (900 * DPR * DPR)) + 400;
    var cols = [[170, 196, 255], [222, 230, 255], [255, 244, 228], [255, 214, 168]];
    for (k = 0; k < total; k++) {
      var sx = rnd() * w, sy = rnd() * h, bq = band(sx * lw / w, sy * lh / h)[1], inB = Math.exp(-bq * bq / 0.03);
      if (rnd() > 0.35 + 0.65 * inB && rnd() > 0.5) continue;
      var mag = Math.pow(rnd(), 3.4), rad = (0.32 + mag * 1.25) * DPR, al = 0.14 + 0.86 * Math.pow(mag, 0.6);
      var t = rnd(), cc = t < 0.14 ? cols[0] : t < 0.55 ? cols[1] : t < 0.86 ? cols[2] : cols[3];
      c.fillStyle = 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',' + al.toFixed(3) + ')';
      if (rad < 0.85 * DPR) c.fillRect(sx, sy, rad * 1.7, rad * 1.7);
      else { c.beginPath(); c.arc(sx, sy, rad, 0, 2 * PI); c.fill(); }
      if (mag > 0.95) {
        var gl = c.createRadialGradient(sx, sy, 0, sx, sy, rad * 7);
        gl.addColorStop(0, 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',0.28)'); gl.addColorStop(1, 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',0)');
        c.fillStyle = gl; c.fillRect(sx - rad * 7, sy - rad * 7, rad * 14, rad * 14);
        c.strokeStyle = 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',0.22)'; c.lineWidth = 0.6 * DPR;
        c.beginPath(); c.moveTo(sx - rad * 9, sy); c.lineTo(sx + rad * 9, sy); c.moveTo(sx, sy - rad * 9); c.lineTo(sx, sy + rad * 9); c.stroke();
      }
    }
    /* пылевая россыпь в полосе */
    for (k = 0; k < total * 1.2; k++) {
      var fx = rnd() * w, fy = rnd() * h, fq = band(fx * lw / w, fy * lh / h)[1];
      if (rnd() > Math.exp(-fq * fq / 0.02)) continue;
      c.fillStyle = 'rgba(230,235,255,' + (0.08 + rnd() * 0.22).toFixed(3) + ')';
      c.fillRect(fx, fy, 0.9 * DPR, 0.9 * DPR);
    }
    c.globalCompositeOperation = 'source-over';
  }

  /* ---------- солнце и блики объектива ---------- */
  function radial(x, y, r, stops, alpha) {
    if (alpha <= 0.002 || r <= 0) return;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], 'rgba(' + stops[i][1] + ',' + (stops[i][2] * alpha).toFixed(4) + ')');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function drawSun(sx, sy, vis, t) {
    var base = Math.min(Wd, Hd);
    ctx.globalCompositeOperation = 'lighter';
    radial(sx, sy, base * 1.1, [[0, '255,226,190', 0.34], [0.08, '255,205,160', 0.16], [0.35, '255,160,110', 0.04], [1, '0,0,0', 0]], vis);
    radial(sx, sy, base * 0.07, [[0, '255,255,255', 1], [0.25, '255,248,235', 0.85], [0.6, '255,220,170', 0.25], [1, '255,200,150', 0]], vis);
    ctx.save(); ctx.translate(sx, sy);
    ctx.rotate(0.35 + Math.sin(t * 0.25) * 0.02);
    for (var k = 0; k < 10; k++) {
      var len = base * (k % 2 ? 0.16 : 0.3) * (0.6 + 0.4 * vis), wdt = base * 0.0028;
      ctx.rotate(PI / 5);
      var lg = ctx.createLinearGradient(0, 0, len, 0);
      lg.addColorStop(0, 'rgba(255,245,230,' + (0.5 * vis).toFixed(3) + ')'); lg.addColorStop(1, 'rgba(255,220,180,0)');
      ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(0, -wdt); ctx.lineTo(len, 0); ctx.lineTo(0, wdt); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.018);
    radial(0, 0, base * 0.95, [[0, '170,200,255', 0.5], [0.4, '120,160,255', 0.14], [1, '80,120,255', 0]], vis);
    ctx.restore();
    var vx = cxD - sx, vy = cyD - sy;
    var ghosts = [[0.32, 0.028, '120,255,190', 0.10], [0.62, 0.055, '255,150,210', 0.06], [0.9, 0.016, '255,255,210', 0.16],
                  [1.25, 0.085, '110,170,255', 0.045], [1.55, 0.035, '255,200,120', 0.08], [1.95, 0.12, '160,120,255', 0.035]];
    for (var q = 0; q < ghosts.length; q++) {
      var gh = ghosts[q], gx = sx + vx * gh[0], gy = sy + vy * gh[0], gr = base * gh[1];
      radial(gx, gy, gr, [[0, gh[2], gh[3] * 0.4], [0.7, gh[2], gh[3]], [0.86, gh[2], gh[3] * 1.4], [1, gh[2], 0]], vis);
    }
  }

  /* ---------- метка солнца вокруг шара ---------- */
  function drawGizmo(L, a) {
    if (a <= 0.01) return;
    var rr = RD * 1.26, lxy = Math.sqrt(L[0] * L[0] + L[1] * L[1]);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setLineDash([3 * DPR, 7 * DPR]); ctx.lineWidth = 1 * DPR;
    ctx.strokeStyle = 'rgba(200,220,255,' + (0.22 * a).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(cxD, cyD, rr, 0, 2 * PI); ctx.stroke();
    ctx.setLineDash([]);
    var ang = lxy > 0.03 ? Math.atan2(-L[1], L[0]) : -PI / 2, mx = cxD + Math.cos(ang) * rr, my = cyD + Math.sin(ang) * rr;
    var front = L[2] >= 0, rs = 7 * DPR;
    ctx.strokeStyle = 'rgba(255,214,150,' + (0.9 * a).toFixed(3) + ')'; ctx.lineWidth = 1.5 * DPR;
    for (var k = 0; k < 8; k++) {
      var ra = k * PI / 4; ctx.beginPath();
      ctx.moveTo(mx + Math.cos(ra) * rs * 1.45, my + Math.sin(ra) * rs * 1.45); ctx.lineTo(mx + Math.cos(ra) * rs * 2.0, my + Math.sin(ra) * rs * 2.0); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(mx, my, rs, 0, 2 * PI);
    if (front) { ctx.fillStyle = 'rgba(255,220,160,' + (0.95 * a).toFixed(3) + ')'; ctx.fill(); }
    else ctx.stroke();
    ctx.font = (11 * DPR) + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(230,236,255,' + (0.75 * a).toFixed(3) + ')';
    ctx.textAlign = 'center';
    ctx.fillText(front ? 'Солнце перед планетой' : 'Солнце за планетой', mx, my + (Math.sin(ang) > 0.6 ? -rs * 3 : rs * 3.6));
    ctx.restore();
  }

  /* ---------- управление ---------- */
  function sunVec() {
    var ce = Math.cos(S.el);
    return [ce * Math.sin(S.az), Math.sin(S.el), ce * Math.cos(S.az)];
  }
  function goPreset(name) {
    var p = PRESETS[name]; if (!p) return;
    var taz = D2R(p.az), d = taz - S.az;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    S.tween = { t: 0, az0: S.az, el0: S.el, daz: d, del: D2R(p.el) - S.el };
    S.lastInteract = S.time; setAuto(false);
    var bs = document.querySelectorAll('[data-preset]');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-preset') === name);
  }
  function clearPresetMarks() {
    var bs = document.querySelectorAll('[data-preset]');
    for (var i = 0; i < bs.length; i++) bs[i].classList.remove('on');
  }
  var bPause = document.getElementById('bPause'), bClouds = document.getElementById('bClouds'),
      bLights = document.getElementById('bLights'), bAuto = document.getElementById('bAuto'), rSpeed = document.getElementById('rSpeed');
  function setPause(p) { S.paused = p; bPause.textContent = p ? '▶ Вращать' : '❚❚ Пауза'; bPause.classList.toggle('on', p); }
  function setAuto(a) { S.autoSun = a; bAuto.classList.toggle('on', a); if (a) clearPresetMarks(); }
  bPause.addEventListener('click', function () { setPause(!S.paused); });
  bClouds.addEventListener('click', function () { S.cloudsOn = !S.cloudsOn; bClouds.classList.toggle('on', S.cloudsOn); });
  bLights.addEventListener('click', function () { S.lightsOn = !S.lightsOn; bLights.classList.toggle('on', S.lightsOn); });
  bAuto.addEventListener('click', function () { setAuto(!S.autoSun); S.tween = null; });
  rSpeed.addEventListener('input', function () { S.speed = parseFloat(rSpeed.value) || 0; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
    b.addEventListener('click', function () { goPreset(b.getAttribute('data-preset')); });
  });
  window.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    var k = e.key.toLowerCase();
    if (k === ' ') { setPause(!S.paused); e.preventDefault(); }
    else if (k === 'c' || k === 'с') bClouds.click();
    else if (k === 'l' || k === 'д') bLights.click();
    else if (k === 'a' || k === 'ф') bAuto.click();
    else if (k >= '1' && k <= '5') goPreset(['dawn', 'dusk', 'day', 'night', 'eclipse'][+k - 1]);
  });
  var lastPX = 0, lastPY = 0;
  canvas.addEventListener('pointerdown', function (e) {
    S.dragging = true; lastPX = e.clientX; lastPY = e.clientY; S.tween = null; setAuto(false); clearPresetMarks();
    canvas.classList.add('drag');
    try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', function (e) {
    S.lastInteract = S.time;
    if (!S.dragging) return;
    var dx = e.clientX - lastPX, dy = e.clientY - lastPY; lastPX = e.clientX; lastPY = e.clientY;
    var k = 3.2 / Math.max(300, Math.min(Wc, Hc));
    S.az += dx * k; S.el = Math.max(-1.45, Math.min(1.45, S.el - dy * k));
  });
  function endDrag() { S.dragging = false; canvas.classList.remove('drag'); }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', function () { goPreset('dusk'); });

  /* ---------- кадр ---------- */
  function update(dt) {
    S.time += dt;
    if (!S.paused) {
      var w = S.speed / S.period;
      S.spin += w * dt; S.cloudOff += w * 0.07 * dt;
    }
    S.clouds += ((S.cloudsOn ? 1 : 0) - S.clouds) * Math.min(1, dt * 4);
    S.lights += ((S.lightsOn ? 1 : 0) - S.lights) * Math.min(1, dt * 4);
    if (S.clouds < 0.004) S.clouds = 0;
    if (S.lights < 0.004) S.lights = 0;
    if (S.tween) {
      var tw = S.tween; tw.t = Math.min(1, tw.t + dt / 1.6);
      var e = tw.t < 0.5 ? 4 * tw.t * tw.t * tw.t : 1 - Math.pow(-2 * tw.t + 2, 3) / 2;
      S.az = tw.az0 + tw.daz * e; S.el = tw.el0 + tw.del * e;
      if (tw.t >= 1) S.tween = null;
    } else if (S.autoSun && !S.dragging) {
      S.az += dt * 2 * PI / 64;
    }
    var want = (S.dragging || S.tween || S.time - S.lastInteract < 1.8) ? 1 : 0;
    S.gizmo += (want - S.gizmo) * Math.min(1, dt * (want ? 8 : 2.5));
    reveal = Math.min(1, reveal + dt / 1.6);
  }

  function draw() {
    var L = sunVec();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.drawImage(stars, 0, 0);
    var sunVis = 0, sx = 0, sy = 0;
    if (L[2] < -0.02) {
      var F = RD * 4.2;
      sx = cxD + F * L[0] / -L[2]; sy = cyD - F * L[1] / -L[2];
      var dd = Math.sqrt((sx - cxD) * (sx - cxD) + (sy - cyD) * (sy - cyD));
      sunVis = sstep(RD * 0.965, RD * 1.075, dd) * sstep(0.02, 0.14, -L[2]);
      if (sx < -Wd * 0.6 || sx > Wd * 1.6 || sy < -Hd * 0.6 || sy > Hd * 1.6) sunVis = 0;
    }
    if (sunVis > 0) { ctx.fillStyle = 'rgba(0,0,0,' + (0.55 * sunVis).toFixed(3) + ')'; ctx.fillRect(0, 0, Wd, Hd); }
    if (!ready) return;

    var t0 = performance.now(), full = S.dragging || !!S.tween || S.speed > 2.2 || reveal < 1;
    var g = Globe.render({
      L: L, rot: -S.spin, rotC: -S.spin - S.cloudOff, clouds: S.clouds, lights: S.lights,
      exposure: 1.12 * (0.25 + 0.75 * reveal), bloom: 1.0, full: full
    });
    var ms = performance.now() - t0;
    emaMs = emaMs * 0.92 + (full ? ms * 0.55 : ms) * 0.08;

    var scale = RD / g.R, size = g.S * scale, ox = cxD - size / 2, oy = cyD - size / 2;
    ctx.globalAlpha = reveal;
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(cxD, cyD, RD * 0.997, 0, 2 * PI); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(g.canvas, ox, oy, size, size);
    var bsz = g.BS * 4 * scale, bx = ox - g.boff * scale, by = oy - g.boff * scale;
    b2c.clearRect(0, 0, b2.width, b2.height); b2c.drawImage(g.bcanvas, 0, 0, b2.width, b2.height);
    b3c.clearRect(0, 0, b3.width, b3.height); b3c.drawImage(b2, 0, 0, b3.width, b3.height);
    b4c.clearRect(0, 0, b4.width, b4.height); b4c.drawImage(b3, 0, 0, b4.width, b4.height);
    ctx.globalAlpha = 0.5 * reveal; ctx.drawImage(g.bcanvas, bx, by, bsz, bsz);
    ctx.globalAlpha = 0.42 * reveal; ctx.drawImage(b2, bx, by, bsz, bsz);
    ctx.globalAlpha = 0.36 * reveal; ctx.drawImage(b3, bx, by, bsz, bsz);
    ctx.globalAlpha = 0.3 * reveal; ctx.drawImage(b4, bx, by, bsz, bsz);
    ctx.globalAlpha = 1;
    if (sunVis > 0) drawSun(sx, sy, sunVis * reveal, S.time);
    drawGizmo(L, S.gizmo * reveal);
    ctx.globalCompositeOperation = 'source-over';
  }

  function adapt(now) {
    frameN++;
    if (frameN < 50 || now - lastAdapt < 1200) return;
    lastAdapt = now;
    var g = Globe.geom, R = g ? g.R : cap;
    if (emaMs > 14 && R > 120) { cap = R * 0.86; rebuildGeom(false); emaMs = 10; }
    else if (emaMs < 7.5 && R < RD - 2) { cap = Math.min(RD, R * 1.12); rebuildGeom(false); emaMs = 9; }
  }

  var last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0;
  function frame(now) {
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    if (!ready && gen) {
      var tEnd = performance.now() + 26, p = 0, r;
      while (performance.now() < tEnd) {
        r = gen.next();
        if (r.done) { p = 1; break; }
        p = r.value;
        if (p >= 1) break;
      }
      if (typeof p === 'number') { elProg.style.width = (p * 100).toFixed(1) + '%'; elPct.textContent = Math.round(p * 100); }
      if (p >= 1 || (r && r.done)) {
        tex = genObj; Globe.setTextures(tex); gen = null; ready = true;
        rebuildGeom(true);
        elLoader.classList.add('gone');
      }
    }
    update(ready ? dt : 0);
    draw();
    if (ready) adapt(now);
    fpsAcc += dt; fpsN++;
    if (now - fpsT > 600) {
      fpsT = now;
      if (ready && elStats) {
        var g = Globe.geom;
        elStats.textContent = Math.round(fpsN / Math.max(1e-3, fpsAcc)) + ' к/с · шар ' + (g ? g.R * 2 : 0) + ' px · ' + emaMs.toFixed(1) + ' мс';
      }
      fpsAcc = 0; fpsN = 0;
    }
    requestAnimationFrame(frame);
  }

  var rsT = 0;
  window.addEventListener('resize', function () { clearTimeout(rsT); rsT = setTimeout(resize, 140); });
  resize();
  gen = Planet.build(genObj);
  requestAnimationFrame(function (t) { last = t; fpsT = t; frame(t); });
})();
