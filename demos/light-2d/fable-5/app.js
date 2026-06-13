/* 2D-свет и тени — сцена и отрисовка. Геометрия — в shadows.js (window.Shadows). */
(function () {
  'use strict';

  var Sh = window.Shadows;

  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');
  var chkDebug = document.getElementById('chkDebug');

  var W = 0, H = 0, DPR = 1;
  var obstacles = [];   // массив многоугольников [{x,y}...]
  var segments = [];    // все сегменты сцены (рамка + препятствия)

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    buildScene();
  }

  function buildScene() {
    obstacles = [];
    // Прямоугольники.
    addRect(W * 0.18, H * 0.2, W * 0.1, H * 0.16);
    addRect(W * 0.66, H * 0.16, W * 0.14, H * 0.1);
    addRect(W * 0.4, H * 0.55, W * 0.08, H * 0.26);
    addRect(W * 0.74, H * 0.6, W * 0.12, H * 0.14);
    // Треугольник и пятиугольник.
    obstacles.push([
      { x: W * 0.12, y: H * 0.78 },
      { x: W * 0.26, y: H * 0.66 },
      { x: W * 0.3, y: H * 0.86 },
    ]);
    obstacles.push(regularPoly(W * 0.55, H * 0.32, Math.min(W, H) * 0.07, 5, 0.3));

    segments = Sh.rectSegments(0, 0, W, H);
    for (var i = 0; i < obstacles.length; i++) {
      segments = segments.concat(Sh.polySegments(obstacles[i]));
    }
  }

  function addRect(x, y, w, h) {
    obstacles.push([
      { x: x, y: y }, { x: x + w, y: y },
      { x: x + w, y: y + h }, { x: x, y: y + h },
    ]);
  }

  function regularPoly(cx, cy, r, n, rot) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = rot + i / n * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  window.addEventListener('resize', resize);
  resize();

  var mouse = { x: W * 0.5, y: H * 0.85 };
  canvas.addEventListener('pointermove', function (e) {
    mouse.x = e.offsetX;
    mouse.y = e.offsetY;
  });

  function frame() {
    draw();
    requestAnimationFrame(frame);
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, W, H);

    var ox = mouse.x, oy = mouse.y;
    var poly = Sh.visibilityPolygon(ox, oy, segments);

    if (poly.length > 2) {
      // Освещённая область: радиальный градиент, обрезанный полигоном видимости.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (var i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.clip();

      var reach = Math.max(W, H) * 0.75;
      var grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, reach);
      grad.addColorStop(0, 'rgba(255, 226, 160, 0.95)');
      grad.addColorStop(0.25, 'rgba(255, 196, 110, 0.45)');
      grad.addColorStop(0.6, 'rgba(200, 140, 70, 0.12)');
      grad.addColorStop(1, 'rgba(120, 80, 40, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Препятствия поверх света.
    for (var k = 0; k < obstacles.length; k++) {
      var o = obstacles[k];
      ctx.beginPath();
      ctx.moveTo(o[0].x, o[0].y);
      for (var j = 1; j < o.length; j++) ctx.lineTo(o[j].x, o[j].y);
      ctx.closePath();
      ctx.fillStyle = '#11141d';
      ctx.fill();
      ctx.strokeStyle = '#2c3346';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Мягкое свечение вокруг источника.
    var glow = ctx.createRadialGradient(ox, oy, 0, ox, oy, 46);
    glow.addColorStop(0, 'rgba(255, 240, 200, 0.95)');
    glow.addColorStop(0.3, 'rgba(255, 220, 150, 0.4)');
    glow.addColorStop(1, 'rgba(255, 200, 110, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ox, oy, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff7e8';
    ctx.beginPath();
    ctx.arc(ox, oy, 5, 0, Math.PI * 2);
    ctx.fill();

    // Отладка: лучи к точкам полигона.
    if (chkDebug.checked && poly.length) {
      ctx.strokeStyle = 'rgba(120, 220, 160, 0.35)';
      ctx.lineWidth = 0.75;
      for (var m = 0; m < poly.length; m++) {
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(poly[m].x, poly[m].y);
        ctx.stroke();
      }
      ctx.fillStyle = '#78dca0';
      for (var n2 = 0; n2 < poly.length; n2++) {
        ctx.fillRect(poly[n2].x - 1.5, poly[n2].y - 1.5, 3, 3);
      }
    }
  }

  requestAnimationFrame(frame);
})();
