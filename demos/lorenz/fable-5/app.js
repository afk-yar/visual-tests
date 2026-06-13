/* Аттрактор Лоренца — 3D-отрисовка с орбитальной камерой.
 * Математика — в lorenz.js (window.Lorenz). */
(function () {
  'use strict';

  var L = window.Lorenz;
  var P = L.CLASSIC;

  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');

  var DT = 0.004;            // шаг интегрирования
  var STEPS_PER_FRAME = 6;   // скорость прорисовки траектории
  var MAX_POINTS = 5200;     // длина следа (старые точки гаснут и удаляются)
  var YAW_SPEED = 0.22;      // рад/с — медленное вращение камеры
  var PITCH = 0.42;          // наклон камеры
  var CENTER_Z = 27;         // центр аттрактора по z

  var state = [1, 1, 1];
  var points = [];           // { x, y, z, hue }
  var hue = 0;

  // Прогрев: дойти до аттрактора, чтобы след не начинался с «хвоста» из старта.
  for (var i = 0; i < 500; i++) state = L.rk4Step(state, DT, P);

  var W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
  }
  window.addEventListener('resize', resize);
  resize();

  var lastT = performance.now();
  var yaw = 0;

  function frame(now) {
    var dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    yaw += YAW_SPEED * dt;

    for (var i = 0; i < STEPS_PER_FRAME; i++) {
      state = L.rk4Step(state, DT, P);
      hue += 0.06; // медленный градиент вдоль траектории
      points.push({ x: state[0], y: state[1], z: state[2], hue: hue });
    }
    if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);

    draw();
    requestAnimationFrame(frame);
  }

  function project(pt, sinY, cosY, sinP, cosP, scale) {
    // Мировые оси: z вверх. Орбита вокруг вертикальной оси + наклон.
    var x = pt.x, y = pt.y, z = pt.z - CENTER_Z;
    var x1 = x * cosY - y * sinY;
    var y1 = x * sinY + y * cosY;
    var depth = y1 * cosP + z * sinP;          // от камеры вглубь
    var ys = y1 * sinP - z * cosP;             // вертикаль экрана (вниз)
    var k = 420 / (420 + depth * 6);           // лёгкая перспектива
    return {
      x: W / 2 + x1 * scale * k,
      y: H / 2 + ys * scale * k,
      k: k,
    };
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#070a12';
    ctx.fillRect(0, 0, W, H);

    var n = points.length;
    if (n < 2) { requestAnimationFrame(frame); return; }

    var sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    var sinP = Math.sin(PITCH), cosP = Math.cos(PITCH);
    var scale = Math.min(W, H) / 58;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt'; // round-стыки в режиме lighter дают яркие узелки

    var prev = project(points[0], sinY, cosY, sinP, cosP, scale);
    for (var i = 1; i < n; i++) {
      var cur = project(points[i], sinY, cosY, sinP, cosP, scale);
      var age = 1 - i / n;                       // 0 — новые, 1 — старые
      var alpha = Math.pow(1 - age, 1.7) * 0.9;  // затухающий след
      if (alpha > 0.015) {
        ctx.strokeStyle = 'hsla(' + (points[i].hue % 360) + ', 90%, ' +
          (55 + cur.k * 10) + '%, ' + alpha + ')';
        ctx.lineWidth = (0.8 + (1 - age) * 1.5) * cur.k;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
      }
      prev = cur;
    }

    // Светящаяся «голова» траектории.
    var head = prev;
    var headHue = points[n - 1].hue % 360;
    var grad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 8);
    grad.addColorStop(0, 'hsla(' + headHue + ', 100%, 85%, 0.9)');
    grad.addColorStop(1, 'hsla(' + headHue + ', 100%, 60%, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
  }

  requestAnimationFrame(frame);
})();
