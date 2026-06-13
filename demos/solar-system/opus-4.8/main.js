/* Солнечная система — кинематографичный 3D-вид на 2D-canvas.
   Без библиотек, без WebGL, без сборки. Совместимо с file:// и iframe sandbox.

   Подход:
   - Собственный мини-3D-пайплайн: позиции тел в "мировом" пространстве (плоскость
     эклиптики ~ XY), вращаем сцену вокруг оси Y (медленный спин камеры) и
     наклоняем по X (угол вида). Проекция — слабая перспектива.
   - Освещение: для каждой планеты считаем направление на Солнце и строим
     радиальный градиент со смещением центра к источнику + терминатор (ночная
     сторона) + тонкое атмосферное кольцо.
   - Кольца Сатурна: эллипс в плоскости планеты, рисуем дальнюю и ближнюю
     половины раздельно (painter), с тенью планеты на кольце.
   - Следы: храним историю мировых позиций, проецируем и рисуем как затухающую
     полилинию (длина регулируется).
   - Сортировка всех рисуемых сущностей по глубине (z после трансформации). */

(function () {
  'use strict';

  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d', { alpha: false });

  // ---- DPR-aware resize -------------------------------------------------
  var W = 0, H = 0, DPR = 1, CX = 0, CY = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CX = W / 2;
    CY = H / 2;
    buildStarfield();
  }
  window.addEventListener('resize', resize);

  // ---- Controls ---------------------------------------------------------
  var P = {
    speed: 1.0,
    scale: 1.0,
    tilt: 62 * Math.PI / 180,
    spin: 0.30,
    trail: 0.85,
    labels: true,
    bloom: true
  };
  var camYaw = 0;        // авто + ручной поворот вокруг оси Y
  var dragYaw = 0;       // ручная добавка
  var dragTilt = 0;      // ручная добавка к наклону
  var zoom = 1.0;        // колесо

  function bind(id, fn) { var el = document.getElementById(id); if (el) fn(el); }
  bind('speed', function (el) { el.oninput = function () { P.speed = +el.value; setEm('vSpeed', P.speed.toFixed(2) + '×'); }; });
  bind('scale', function (el) { el.oninput = function () { P.scale = +el.value; setEm('vScale', P.scale.toFixed(2) + '×'); }; });
  bind('tilt', function (el) { el.oninput = function () { P.tilt = (+el.value) * Math.PI / 180; setEm('vTilt', el.value + '°'); }; });
  bind('spin', function (el) { el.oninput = function () { P.spin = +el.value; setEm('vSpin', P.spin.toFixed(2) + '×'); }; });
  bind('trail', function (el) { el.oninput = function () { P.trail = +el.value; setEm('vTrail', P.trail.toFixed(2)); }; });
  bind('labels', function (el) { el.onchange = function () { P.labels = el.checked; }; });
  bind('bloom', function (el) { el.onchange = function () { P.bloom = el.checked; }; });
  function setEm(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }

  bind('collapse', function (el) {
    el.onclick = function () { document.getElementById('panel').classList.toggle('collapsed'); };
  });

  // pointer drag to orbit, wheel to zoom
  var dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    dragYaw += (e.clientX - lastX) * 0.005;
    dragTilt += (e.clientY - lastY) * 0.004;
    dragTilt = Math.max(-0.7, Math.min(0.45, dragTilt));
    lastX = e.clientX; lastY = e.clientY;
  });
  function endDrag() { dragging = false; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoom *= Math.exp(-e.deltaY * 0.0009);
    zoom = Math.max(0.4, Math.min(3.2, zoom));
  }, { passive: false });

  // ---- Bodies definition -----------------------------------------------
  // Радиусы и орбиты — художественно сжатые, но сохраняют относительный порядок.
  // a — большая полуось (экранные ед.), e — эксцентриситет, inc — наклон орбиты,
  // node — долгота восходящего узла, peri — аргумент перицентра,
  // r — визуальный радиус, period — относит. период (больше = медленнее),
  // tilt — наклон оси (для колец/освещения), col — палитра планеты.
  var SUN = { r: 30, x: 0, y: 0, z: 0 };

  var planets = [
    { name: 'Меркурий', a: 62,  e: 0.21, inc: 0.12, node: 0.9, peri: 1.2, r: 2.6, period: 0.62, phase: 0.0,
      col: ['#caa98c', '#7a6450', '#3a2f26'], spin: 0.5 },
    { name: 'Венера',  a: 92,  e: 0.07, inc: 0.06, node: 1.3, peri: 2.0, r: 5.2, period: 1.10, phase: 1.1,
      col: ['#f4dca6', '#caa15c', '#5d4424'], spin: -0.2, atm: 'rgba(255,220,150,0.55)' },
    { name: 'Земля',   a: 128, e: 0.05, inc: 0.0,  node: 0.0, peri: 1.7, r: 5.5, period: 1.70, phase: 2.4,
      col: ['#9fd1ff', '#2f7fd6', '#0d2742'], spin: 1.0, atm: 'rgba(120,180,255,0.6)', earth: true,
      moons: [ { name: 'Луна', a: 13, r: 1.6, period: 0.18, col: ['#d6d2c8', '#8a857c', '#3b3833'] } ] },
    { name: 'Марс',    a: 172, e: 0.09, inc: 0.03, node: 0.6, peri: 0.4, r: 3.7, period: 2.6,  phase: 0.7,
      col: ['#ff9f6e', '#c4582f', '#5a2616'], spin: 0.9, atm: 'rgba(255,150,110,0.35)',
      moons: [ { name: '', a: 8,  r: 0.8, period: 0.09, col: ['#9a8d7d', '#5d5448', '#2c2820'] },
               { name: '', a: 11, r: 0.7, period: 0.14, col: ['#9a8d7d', '#5d5448', '#2c2820'] } ] },
    { name: 'Юпитер',  a: 250, e: 0.05, inc: 0.02, node: 1.9, peri: 1.0, r: 15,  period: 6.0,  phase: 3.6,
      col: ['#f2dcc0', '#c89a6a', '#6e4a30'], spin: 2.0, bands: true, atm: 'rgba(245,220,180,0.35)',
      moons: [ { name: 'Ио',     a: 24, r: 1.5, period: 0.16, col: ['#f4e06a', '#c99a32', '#5e4516'] },
               { name: 'Европа', a: 31, r: 1.4, period: 0.24, col: ['#e8e2d4', '#b9ac95', '#5d5444'] },
               { name: 'Ганимед',a: 40, r: 2.0, period: 0.36, col: ['#cdbfa6', '#8e7c63', '#473d30'] },
               { name: 'Каллисто',a: 50, r: 1.8, period: 0.52, col: ['#9a8d80', '#5e5448', '#2c2820'] } ] },
    { name: 'Сатурн',  a: 340, e: 0.06, inc: 0.04, node: 0.3, peri: 2.3, r: 12,  period: 9.5,  phase: 1.5,
      col: ['#f6e7c2', '#d3b27e', '#7a5c34'], spin: 1.8, rings: true, ringTilt: 0.46, atm: 'rgba(245,225,170,0.3)',
      moons: [ { name: 'Титан', a: 30, r: 1.9, period: 0.34, col: ['#e8b85a', '#b07c28', '#553a12'] } ] },
    { name: 'Уран',    a: 410, e: 0.05, inc: 0.06, node: 1.1, peri: 0.8, r: 8.5, period: 14,   phase: 5.0,
      col: ['#bff0ef', '#7fc7cc', '#356a72'], spin: 1.4, ringTilt: 1.3, rings: 'faint', atm: 'rgba(150,230,235,0.4)' },
    { name: 'Нептун',  a: 470, e: 0.04, inc: 0.05, node: 2.4, peri: 1.4, r: 8.2, period: 17,   phase: 2.1,
      col: ['#9db8ff', '#3d63d8', '#16275f'], spin: 1.5, atm: 'rgba(110,150,255,0.45)' }
  ];

  // история позиций для следов
  planets.forEach(function (p) { p.trail = []; p.wx = 0; p.wy = 0; p.wz = 0; });

  // ---- Starfield (procedural, baked to offscreen) -----------------------
  var starCanvas = document.createElement('canvas');
  var starCtx = starCanvas.getContext('2d');
  var nebula = [];
  function buildStarfield() {
    starCanvas.width = Math.round(W * DPR);
    starCanvas.height = Math.round(H * DPR);
    var c = starCtx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);

    // глубокий градиент фона
    var bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#070912');
    bg.addColorStop(0.5, '#05060d');
    bg.addColorStop(1, '#0a0712');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    // мягкие туманности
    var seed = 1337;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    var hues = ['rgba(60,40,120,', 'rgba(30,70,120,', 'rgba(110,40,90,', 'rgba(40,90,90,'];
    for (var n = 0; n < 7; n++) {
      var nx = rnd() * W, ny = rnd() * H, nr = (0.25 + rnd() * 0.4) * Math.max(W, H);
      var g = c.createRadialGradient(nx, ny, 0, nx, ny, nr);
      var hue = hues[(rnd() * hues.length) | 0];
      g.addColorStop(0, hue + (0.10 + rnd() * 0.08) + ')');
      g.addColorStop(1, hue + '0)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }

    // звёзды трёх слоёв
    var count = Math.round(W * H / 1400);
    for (var i = 0; i < count; i++) {
      var x = rnd() * W, y = rnd() * H;
      var m = rnd();
      var rad = m > 0.985 ? 1.6 + rnd() * 1.2 : (m > 0.9 ? 0.9 + rnd() * 0.5 : 0.3 + rnd() * 0.5);
      var a = 0.25 + rnd() * 0.7;
      var tint = rnd();
      var col = tint > 0.8 ? '255,225,200' : (tint < 0.2 ? '200,220,255' : '255,255,255');
      c.beginPath();
      c.arc(x, y, rad, 0, Math.PI * 2);
      c.fillStyle = 'rgba(' + col + ',' + a + ')';
      c.fill();
      if (rad > 1.5) {
        // блик у ярких звёзд
        var sg = c.createRadialGradient(x, y, 0, x, y, rad * 4);
        sg.addColorStop(0, 'rgba(' + col + ',' + (a * 0.5) + ')');
        sg.addColorStop(1, 'rgba(' + col + ',0)');
        c.fillStyle = sg;
        c.fillRect(x - rad * 4, y - rad * 4, rad * 8, rad * 8);
      }
    }
    // запоминаем несколько ярких звёзд для мерцания
    nebula = [];
    for (var s = 0; s < 40; s++) nebula.push({ x: rnd() * W, y: rnd() * H, ph: rnd() * 6.28 });
  }

  // ---- 3D math ----------------------------------------------------------
  // мировая точка -> экранная. Вращение вокруг Y (yaw), затем наклон вокруг X (tilt).
  var FOCAL = 900;
  function project(x, y, z) {
    // yaw вокруг оси Y (плоскость XZ)
    var cy = Math.cos(camYaw + dragYaw), sy = Math.sin(camYaw + dragYaw);
    var x1 = x * cy - z * sy;
    var z1 = x * sy + z * cy;
    // tilt вокруг оси X (плоскость YZ)
    var t = P.tilt + dragTilt;
    var ct = Math.cos(t), st = Math.sin(t);
    var y2 = y * ct - z1 * st;
    var z2 = y * st + z1 * ct;
    // перспектива
    var depth = FOCAL + z2;
    var persp = FOCAL / Math.max(120, depth);
    var sc = P.scale * zoom * persp;
    return {
      sx: CX + x1 * sc,
      sy: CY + y2 * sc,
      depth: z2,        // для сортировки (больше -> ближе к камере? см. ниже)
      persp: persp,
      scale: sc
    };
  }

  // ---- Orbit position ---------------------------------------------------
  // эллипс в собственной плоскости орбиты, повёрнутый node+inc+peri
  function orbitPoint(p, theta) {
    var a = p.a, e = p.e;
    var b = a * Math.sqrt(1 - e * e);
    // позиция на эллипсе с фокусом в Солнце
    var ox = a * Math.cos(theta) - a * e;  // сдвиг к фокусу
    var oy = b * Math.sin(theta);
    var oz = 0;
    // аргумент перицентра (поворот эллипса в его плоскости)
    var cp = Math.cos(p.peri), sp = Math.sin(p.peri);
    var x1 = ox * cp - oy * sp;
    var y1 = ox * sp + oy * cp;
    // наклон орбиты вокруг оси узлов
    var ci = Math.cos(p.inc), si = Math.sin(p.inc);
    var y2 = y1 * ci;
    var z2 = y1 * si;
    // долгота восходящего узла (поворот в плоскости эклиптики XY)
    var cn = Math.cos(p.node), sn = Math.sin(p.node);
    return {
      x: x1 * cn - y2 * sn,
      y: x1 * sn + y2 * cn,
      z: oz + z2
    };
  }

  // ---- Color helpers ----------------------------------------------------
  function lerpHex(h1, h2, t) {
    var a = hex(h1), b = hex(h2);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
                    Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
                    Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }
  var hexCache = {};
  function hex(h) {
    if (hexCache[h]) return hexCache[h];
    var v = h.replace('#', '');
    var r = parseInt(v.substring(0, 2), 16),
        g = parseInt(v.substring(2, 4), 16),
        b = parseInt(v.substring(4, 6), 16);
    return (hexCache[h] = [r, g, b]);
  }

  // ---- Draw a lit sphere ------------------------------------------------
  // proj — экранная позиция, R — экранный радиус, body — описание (col[], atm, ...)
  // lightDir2d — нормированное направление "к Солнцу" в экранных координатах
  function drawSphere(proj, R, body, lightScreen) {
    var sx = proj.sx, sy = proj.sy;
    if (R < 0.25) {
      // слишком далеко/мелко — точка
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(0.5, R), 0, Math.PI * 2);
      ctx.fillStyle = body.col ? lerpHex(body.col[0], body.col[1], 0.5) : '#ccc';
      ctx.fill();
      return;
    }

    // вектор к свету в экранной плоскости (приближение направления освещения)
    var lx = lightScreen.x, ly = lightScreen.y;
    // центр светового градиента смещаем к источнику
    var gx = sx + lx * R * 0.7;
    var gy = sy + ly * R * 0.7;

    var c0 = body.col[0], c1 = body.col[1], c2 = body.col[2];

    var g = ctx.createRadialGradient(gx, gy, R * 0.05, sx, sy, R * 1.18);
    g.addColorStop(0.0, lerpHex(c0, '#ffffff', 0.35));
    g.addColorStop(0.28, c0);
    g.addColorStop(0.6, c1);
    g.addColorStop(0.86, c2);
    g.addColorStop(1.0, lerpHex(c2, '#000007', 0.7));

    ctx.beginPath();
    ctx.arc(sx, sy, R, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // ночная сторона — отдельный градиент-терминатор (тень с противоположной от света стороны)
    var nx = sx - lx * R * 0.92;
    var ny = sy - ly * R * 0.92;
    var ng = ctx.createRadialGradient(nx, ny, R * 0.1, nx, ny, R * 1.65);
    ng.addColorStop(0.0, 'rgba(2,3,10,0.92)');
    ng.addColorStop(0.45, 'rgba(2,3,10,0.55)');
    ng.addColorStop(1.0, 'rgba(2,3,10,0)');
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = ng;
    ctx.fillRect(sx - R - 2, sy - R - 2, R * 2 + 4, R * 2 + 4);

    // газовые полосы (Юпитер) или текстурные штрихи
    if (body.bands && R > 5) {
      ctx.globalAlpha = 0.18;
      for (var bI = -3; bI <= 3; bI++) {
        var yy = sy + (bI / 3.2) * R * 0.85;
        var hh = R * 0.13;
        ctx.fillStyle = (bI % 2 === 0) ? c1 : lerpHex(c0, c1, 0.4);
        ctx.fillRect(sx - R, yy - hh / 2, R * 2, hh);
      }
      ctx.globalAlpha = 1;
    }
    if (body.earth && R > 4) {
      // намёк на континенты — несколько зелёно-коричневых пятен
      ctx.globalAlpha = 0.5;
      var blobs = [[-0.2, -0.3, 0.4], [0.25, 0.15, 0.5], [-0.05, 0.45, 0.35], [0.45, -0.4, 0.3]];
      for (var bb = 0; bb < blobs.length; bb++) {
        var b = blobs[bb];
        ctx.beginPath();
        ctx.ellipse(sx + b[0] * R, sy + b[1] * R, b[2] * R, b[2] * R * 0.7, 0.4, 0, Math.PI * 2);
        ctx.fillStyle = (bb % 2 ? '#3f6b3a' : '#6d5b3a');
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // тонкий свет на лимбе со стороны источника (рим-лайт)
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, R, 0, Math.PI * 2);
    ctx.clip();
    var rg = ctx.createRadialGradient(gx, gy, R * 0.7, gx, gy, R * 1.25);
    rg.addColorStop(0, 'rgba(255,255,255,0)');
    rg.addColorStop(0.82, 'rgba(255,255,255,0)');
    rg.addColorStop(1, 'rgba(255,248,230,0.35)');
    ctx.fillStyle = rg;
    ctx.fillRect(sx - R, sy - R, R * 2, R * 2);
    ctx.restore();

    // атмосферное гало
    if (body.atm && R > 2) {
      var ag = ctx.createRadialGradient(sx, sy, R * 0.92, sx, sy, R * 1.35);
      ag.addColorStop(0, 'rgba(0,0,0,0)');
      ag.addColorStop(0.55, body.atm);
      ag.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(sx, sy, R * 1.35, 0, Math.PI * 2);
      ctx.fillStyle = ag;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ---- Saturn / Uranus rings -------------------------------------------
  // Рисуем кольцо как заполненный эллиптический "пончик". Половину (дальнюю или
  // ближнюю) — в зависимости от того, рисуем мы до или после самой планеты.
  function drawRings(planet, proj, R, lightScreen, half) {
    var faint = planet.rings === 'faint';
    var rin = R * 1.35, rout = R * (faint ? 2.0 : 2.35);
    // наклон колец в экране зависит от наклона вида: чем меньше tilt, тем у́же эллипс
    var tiltView = P.tilt + dragTilt;
    var squash = Math.max(0.04, Math.abs(Math.cos(tiltView)) * 0.95 + 0.04);
    // ориентация колец (учитываем ringTilt планеты как поворот эллипса)
    var rot = (planet.ringTilt || 0) * 0.5 + (camYaw + dragYaw) * 0.0;
    var sx = proj.sx, sy = proj.sy;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rot);
    ctx.scale(1, squash);

    // клип на нужную половину (верхняя = дальняя за планетой, нижняя = передняя)
    ctx.beginPath();
    if (half === 'far') ctx.rect(-rout * 1.2, -rout * 1.2, rout * 2.4, rout * 1.2);
    else ctx.rect(-rout * 1.2, 0, rout * 2.4, rout * 1.2);
    ctx.clip();

    // набор концентрических полос с зазором Кассини
    var steps = faint ? 5 : 16;
    for (var i = 0; i < steps; i++) {
      var f = i / (steps - 1);
      var rr = rin + (rout - rin) * f;
      var w = (rout - rin) / steps * 1.05;
      // плотность колец — модулируем, оставляем щель Кассини у Сатурна
      var dens = faint ? 0.22 : (0.35 + 0.45 * Math.sin(f * 9 + 1));
      if (!faint && f > 0.62 && f < 0.70) dens *= 0.12; // щель Кассини
      var shade = lerpHex(planet.col[0], '#fff', 0.2 - f * 0.15);
      ctx.beginPath();
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(' + hex2(shade) + ',' + (dens * 0.85) + ')';
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // тень планеты на кольцах (только на дальней половине, со стороны от света)
    if (half === 'far' && !faint) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(rot);
      ctx.scale(1, squash);
      ctx.beginPath();
      ctx.rect(-rout * 1.2, -rout * 1.2, rout * 2.4, rout * 1.2);
      ctx.clip();
      var shAng = Math.atan2(-lightScreen.y, -lightScreen.x);
      ctx.rotate(0);
      var sg = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, rout);
      // затемняющий клин в направлении тени
      ctx.globalCompositeOperation = 'multiply';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      var spread = 0.5;
      ctx.arc(0, 0, rout * 1.2, shAng - spread, shAng + spread);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,4,0.55)';
      ctx.fill();
      ctx.restore();
    }
  }
  function hex2(rgbstr) {
    // rgbstr like 'rgb(r,g,b)'
    var m = /(\d+),\s*(\d+),\s*(\d+)/.exec(rgbstr);
    return m ? (m[1] + ',' + m[2] + ',' + m[3]) : '255,255,255';
  }

  // ---- Sun --------------------------------------------------------------
  function drawSun(proj, R) {
    var sx = proj.sx, sy = proj.sy;
    // корона / блум
    if (P.bloom) {
      ctx.globalCompositeOperation = 'lighter';
      var halo = ctx.createRadialGradient(sx, sy, R * 0.4, sx, sy, R * 7);
      halo.addColorStop(0, 'rgba(255,240,200,0.55)');
      halo.addColorStop(0.18, 'rgba(255,190,90,0.32)');
      halo.addColorStop(0.5, 'rgba(255,140,40,0.10)');
      halo.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.beginPath();
      ctx.arc(sx, sy, R * 7, 0, Math.PI * 2);
      ctx.fillStyle = halo;
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    // диск
    var g = ctx.createRadialGradient(sx - R * 0.15, sy - R * 0.15, R * 0.1, sx, sy, R);
    g.addColorStop(0, '#fffefb');
    g.addColorStop(0.4, '#ffe9a8');
    g.addColorStop(0.78, '#ffb84d');
    g.addColorStop(1, '#ff7a18');
    ctx.beginPath();
    ctx.arc(sx, sy, R, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // мерцающий внутренний край
    ctx.globalCompositeOperation = 'lighter';
    var rim = ctx.createRadialGradient(sx, sy, R * 0.75, sx, sy, R * 1.04);
    rim.addColorStop(0, 'rgba(255,200,90,0)');
    rim.addColorStop(1, 'rgba(255,235,170,0.5)');
    ctx.beginPath();
    ctx.arc(sx, sy, R * 1.04, 0, Math.PI * 2);
    ctx.fillStyle = rim;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- Orbit path (faint full ellipse) ----------------------------------
  function drawOrbitPath(p) {
    ctx.beginPath();
    var N = 96;
    for (var i = 0; i <= N; i++) {
      var th = i / N * Math.PI * 2;
      var w = orbitPoint(p, th);
      var pr = project(w.x, w.y, w.z);
      if (i === 0) ctx.moveTo(pr.sx, pr.sy);
      else ctx.lineTo(pr.sx, pr.sy);
    }
    ctx.strokeStyle = 'rgba(140,165,220,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ---- Trails (fading) --------------------------------------------------
  function drawTrail(p) {
    if (P.trail <= 0.01 || p.trail.length < 2) return;
    var n = p.trail.length;
    var maxLen = Math.floor(8 + P.trail * (p.trailMax - 8));
    var col = p.col[0];
    ctx.lineCap = 'round';
    for (var i = 1; i < n; i++) {
      var age = i / n;                  // 0 — старый, 1 — свежий
      if (age < 1 - (maxLen / p.trailMax)) continue;
      var a = p.trail[i - 1], b = p.trail[i];
      var pa = project(a.x, a.y, a.z);
      var pb = project(b.x, b.y, b.z);
      var alpha = Math.pow(age, 1.6) * 0.75;
      ctx.beginPath();
      ctx.moveTo(pa.sx, pa.sy);
      ctx.lineTo(pb.sx, pb.sy);
      ctx.strokeStyle = 'rgba(' + hex2(lerpHex(col, '#ffffff', 0.25)) + ',' + alpha + ')';
      ctx.lineWidth = Math.max(0.6, 1.6 * age * pb.persp * zoom);
      ctx.stroke();
    }
  }

  // ---- Main loop --------------------------------------------------------
  var t = 0;
  var lastT = performance.now();
  var fpsSmooth = 60;
  var simTime = 0;

  // глобальное направление света в МИРЕ — от планеты к Солнцу (Солнце в начале).
  // Для экранного направления проецируем малую точку рядом с планетой.
  function lightScreenFor(world, proj) {
    // точка чуть ближе к Солнцу от планеты
    var len = Math.sqrt(world.x * world.x + world.y * world.y + world.z * world.z) || 1;
    var k = 6 / len;
    var near = project(world.x * (1 - k), world.y * (1 - k), world.z * (1 - k));
    var dx = near.sx - proj.sx, dy = near.sy - proj.sy;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: dx / d, y: dy / d };
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    t += dt;
    simTime += dt * P.speed;

    // авто-спин камеры
    camYaw += dt * P.spin * 0.18;

    // фон
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(starCanvas, 0, 0, W, H);

    // мерцание ярких звёзд
    ctx.globalCompositeOperation = 'lighter';
    for (var s = 0; s < nebula.length; s++) {
      var st = nebula[s];
      var tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2.2 + st.ph));
      ctx.beginPath();
      ctx.arc(st.x, st.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + (tw * 0.5) + ')';
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // обновляем мировые позиции планет
    var drawList = [];
    for (var i = 0; i < planets.length; i++) {
      var p = planets[i];
      var theta = p.phase + simTime / p.period;
      var w = orbitPoint(p, theta);
      p.wx = w.x; p.wy = w.y; p.wz = w.z;

      // история следов
      if (!p.trailMax) p.trailMax = 130;
      p.trail.push({ x: w.x, y: w.y, z: w.z });
      if (p.trail.length > p.trailMax) p.trail.shift();

      var proj = project(w.x, w.y, w.z);
      drawList.push({ type: 'planet', p: p, proj: proj, depth: proj.depth, world: w });

      // луны
      if (p.moons) {
        for (var m = 0; m < p.moons.length; m++) {
          var moon = p.moons[m];
          var mth = (moon.phase || (m * 1.3)) + simTime / moon.period;
          // плоскость луны слегка наклонена
          var mx = w.x + Math.cos(mth) * moon.a;
          var my = w.y + Math.sin(mth) * moon.a * 0.85;
          var mz = w.z + Math.sin(mth) * moon.a * 0.35;
          var mproj = project(mx, my, mz);
          drawList.push({
            type: 'moon', p: p, moon: moon,
            proj: mproj, depth: mproj.depth,
            world: { x: mx, y: my, z: mz }
          });
        }
      }
    }

    // Солнце
    var sunProj = project(0, 0, 0);
    drawList.push({ type: 'sun', proj: sunProj, depth: sunProj.depth });

    // орбитальные пути и следы рисуем ПОД телами (но с учётом фейда — просто заранее)
    for (var op = 0; op < planets.length; op++) {
      drawOrbitPath(planets[op]);
      drawTrail(planets[op]);
    }

    // сортировка по глубине: меньший z2 = дальше от камеры -> рисуем раньше.
    // (в project z2 растёт вглубь; камера смотрит из -Z, поэтому дальнее = большой z2)
    drawList.sort(function (a, b) { return b.depth - a.depth; });

    // рендер
    for (var d = 0; d < drawList.length; d++) {
      var item = drawList[d];
      if (item.type === 'sun') {
        // радиус Солнца масштабируем общим коэффициентом сцены (без перспективы:
        // Солнце в центре, его глубина ~0, чтобы корона была стабильна)
        drawSun(item.proj, SUN.r * P.scale * zoom);
        continue;
      }
      if (item.type === 'planet') {
        var pl = item.p;
        var R = pl.r * item.proj.scale;
        var ls = lightScreenFor(item.world, item.proj);

        // дальняя половина колец — до планеты
        if (pl.rings) drawRings(pl, item.proj, R, ls, 'far');
        drawSphere(item.proj, R, pl, ls);
        // ближняя половина колец — после планеты
        if (pl.rings) drawRings(pl, item.proj, R, ls, 'near');

        // подпись
        if (P.labels && R > 1.2) {
          ctx.font = '11px -apple-system, Segoe UI, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(220,230,255,0.0)';
          var ly = item.proj.sy - R - (pl.rings ? R * 2.4 : 8);
          ctx.fillStyle = 'rgba(210,222,250,0.7)';
          ctx.fillText(pl.name, item.proj.sx, ly);
          ctx.textAlign = 'left';
        }
        continue;
      }
      if (item.type === 'moon') {
        var mn = item.moon;
        var mR = mn.r * item.proj.scale;
        var mls = lightScreenFor(item.world, item.proj);
        drawSphere(item.proj, mR, { col: mn.col }, mls);
        if (P.labels && mn.name && mR > 1.6) {
          ctx.font = '9px -apple-system, Segoe UI, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(190,205,235,0.55)';
          ctx.fillText(mn.name, item.proj.sx, item.proj.sy - mR - 5);
          ctx.textAlign = 'left';
        }
      }
    }

    // HUD
    var fps = 1 / Math.max(0.0001, dt);
    fpsSmooth += (fps - fpsSmooth) * 0.08;
    var nMoons = 0;
    planets.forEach(function (p) { if (p.moons) nMoons += p.moons.length; });
    setBadge('fps', Math.round(fpsSmooth) + ' FPS');
    setBadge('bodies', (1 + planets.length + nMoons) + ' тел');

    requestAnimationFrame(frame);
  }
  function setBadge(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }

  // ---- Boot -------------------------------------------------------------
  resize();
  requestAnimationFrame(frame);
})();
