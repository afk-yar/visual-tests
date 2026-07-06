(function () {
  'use strict';

  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');
  var debugToggle = document.getElementById('debug-toggle');
  var radiusSlider = document.getElementById('radius-slider');
  var regenBtn = document.getElementById('regen-btn');

  var Visibility = window.Visibility;

  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var width = 0;
  var height = 0;

  // Шаблоны препятствий в локальных координатах (центр в 0,0), позиция —
  // в долях ширины/высоты экрана, чтобы раскладка адаптировалась к размеру окна.
  var OBSTACLE_TEMPLATES = [
    { cx: 0.20, cy: 0.30, pts: [[0, -70], [65, 55], [-65, 55]] },
    { cx: 0.80, cy: 0.24, pts: [[0, -60], [60, 0], [0, 60], [-60, 0]] },
    { cx: 0.50, cy: 0.66, pts: [[-70, -70], [20, -70], [20, 10], [70, 10], [70, 70], [-70, 70]] },
    { cx: 0.16, cy: 0.78, pts: hexPoints(62) },
    { cx: 0.84, cy: 0.76, pts: [[0, -75], [65, -15], [40, 70], [-40, 70], [-65, -15]] },
    { cx: 0.50, cy: 0.13, pts: [[-95, -20], [95, -20], [95, 20], [-95, 20]] }
  ];

  function hexPoints(r) {
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = (Math.PI / 3) * i - Math.PI / 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  var obstacles = [];
  var seed = 1;

  // Маленький детерминированный ГПСЧ: кнопка "новые препятствия" даёт разные,
  // но воспроизводимые в рамках сессии повороты/масштабы фигур.
  function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 10000) / 10000;
  }

  function buildObstacles() {
    var sc = clamp(Math.min(width, height) / 900, 0.5, 1.35);
    obstacles = OBSTACLE_TEMPLATES.map(function (tpl) {
      var jitterAngle = (rand() - 0.5) * 0.6;
      var jitterScale = 0.85 + rand() * 0.3;
      var cosA = Math.cos(jitterAngle);
      var sinA = Math.sin(jitterAngle);
      var cx = tpl.cx * width;
      var cy = tpl.cy * height;
      var points = tpl.pts.map(function (p) {
        var lx = p[0] * sc * jitterScale;
        var ly = p[1] * sc * jitterScale;
        var rx = lx * cosA - ly * sinA;
        var ry = lx * sinA + ly * cosA;
        return { x: cx + rx, y: cy + ry };
      });
      return { points: points };
    });
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    buildObstacles();
  }

  var light = { x: 0, y: 0 };
  var lightTarget = null;

  function setTargetFromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    var point = e.touches && e.touches.length ? e.touches[0] : e;
    lightTarget = { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }

  window.addEventListener('mousemove', setTargetFromEvent);
  window.addEventListener('touchmove', setTargetFromEvent, { passive: true });
  window.addEventListener('touchstart', setTargetFromEvent, { passive: true });
  window.addEventListener('resize', resize);

  regenBtn.addEventListener('click', function () {
    seed = (seed + 977) & 0x7fffffff;
    buildObstacles();
  });

  var lightRadius = parseFloat(radiusSlider.value);
  radiusSlider.addEventListener('input', function () {
    lightRadius = parseFloat(radiusSlider.value);
  });

  function getSegments() {
    var bounds = Visibility.segmentsFromPolygon([
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height }
    ]);
    var segs = bounds.slice();
    for (var i = 0; i < obstacles.length; i++) {
      segs = segs.concat(Visibility.segmentsFromPolygon(obstacles[i].points));
    }
    return segs;
  }

  var lastTime = null;

  function frame(now) {
    if (lastTime === null) lastTime = now;
    var dt = Math.min((now - lastTime) / 1000, 0.05); // клампим большой dt (смена вкладки и т.п.)
    lastTime = now;

    if (!lightTarget) {
      lightTarget = { x: width / 2, y: height / 2 };
      light.x = lightTarget.x;
      light.y = lightTarget.y;
    } else {
      var followK = 1 - Math.pow(0.0025, dt); // экспоненциальное сглаживание, независимое от fps
      light.x += (lightTarget.x - light.x) * followK;
      light.y += (lightTarget.y - light.y) * followK;
    }

    render();
    requestAnimationFrame(frame);
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#07080c';
    ctx.fillRect(0, 0, width, height);

    var segments = getSegments();
    var maxDist = Math.hypot(width, height) + 50;
    var points = Visibility.computeVisibilityPolygon(light, segments, maxDist);

    if (points.length > 2) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (var i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();

      var grad = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, lightRadius);
      grad.addColorStop(0, 'rgba(255,244,214,0.95)');
      grad.addColorStop(0.28, 'rgba(255,229,175,0.62)');
      grad.addColorStop(0.6, 'rgba(255,205,140,0.24)');
      grad.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }

    // Препятствия рисуем поверх заливки — гарантированно чёткий непрозрачный
    // край без утечек градиента из-за погрешностей вычислений.
    for (var o = 0; o < obstacles.length; o++) {
      var pts = obstacles[o].points;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, pts[j].y);
      ctx.closePath();
      ctx.fillStyle = '#1b1e26';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Мягкое свечение вокруг источника света (аддитивный блендинг).
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var glow = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, 150);
    glow.addColorStop(0, 'rgba(255,247,224,0.85)');
    glow.addColorStop(0.4, 'rgba(255,214,150,0.35)');
    glow.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(light.x, light.y, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Яркое ядро источника с размытым ореолом (canvas shadowBlur).
    ctx.save();
    ctx.shadowColor = 'rgba(255,235,190,0.95)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#fff8ea';
    ctx.beginPath();
    ctx.arc(light.x, light.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (debugToggle.checked) {
      drawDebug(points);
    }
  }

  function drawDebug(points) {
    ctx.save();

    // лучи из источника к каждой найденной точке полигона
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120,200,255,0.28)';
    ctx.beginPath();
    for (var i = 0; i < points.length; i++) {
      ctx.moveTo(light.x, light.y);
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    // сам контур полигона видимости
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.4;
    if (points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (var p = 1; p < points.length; p++) ctx.lineTo(points[p].x, points[p].y);
      ctx.closePath();
      ctx.stroke();
    }

    // точки пересечения лучей (концы каждого сэмплированного луча)
    ctx.fillStyle = 'rgba(120,220,255,0.9)';
    for (var k = 0; k < points.length; k++) {
      ctx.beginPath();
      ctx.arc(points[k].x, points[k].y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // настоящие вершины препятствий
    ctx.fillStyle = '#ffe27a';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    for (var s = 0; s < obstacles.length; s++) {
      var vs = obstacles[s].points;
      for (var v = 0; v < vs.length; v++) {
        ctx.beginPath();
        ctx.arc(vs[v].x, vs[v].y, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // сам источник света
    ctx.fillStyle = '#ff5c7a';
    ctx.beginPath();
    ctx.arc(light.x, light.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  resize();
  requestAnimationFrame(frame);
})();
