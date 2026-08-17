'use strict';

/* Система Лоренца — аттрактор с автоматическим вращением камеры,
   затухающим следом и градиентом цвета вдоль траектории. */

var canvas = document.getElementById('scene');
var ctx = canvas.getContext('2d');

var W = 0, H = 0, DPR = 1;
var BG = 'rgb(4, 6, 14)';

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
}
window.addEventListener('resize', resize);

/* --- Параметры системы --- */
var params = { sigma: 10, rho: 28, beta: 8 / 3 };
var speed = 1.4;      // единиц модельного времени в секунду
var trailKeep = 0.92; // доля сохранения кадра (затухание следа)

var H_STEP = 0.006;   // шаг интегрирования
var MAX_STEPS = 600;  // защита от спирали при большом dt
var CENTER_Z = 27;    // центр аттрактора по z
var PARTICLE_COUNT = 4;

var particles = [];
var paused = false;
var yaw = 0;

function spawn(p, i) {
  p.x = 0.1 + i * 0.4 + Math.random() * 0.5;
  p.y = 1.0 + i * 0.3;
  p.z = 20 + i * 1.5;
  p.px = 0; p.py = 0; p.has = false;
  p.hue = (i * 47) % 360;
  p.warmup = 250; // пропуск переходного процесса
}

function resetParticles() {
  particles = [];
  for (var i = 0; i < PARTICLE_COUNT; i++) {
    var p = {};
    spawn(p, i);
    particles.push(p);
  }
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
}

/* Производные системы Лоренца */
function deriv(x, y, z, out) {
  out[0] = params.sigma * (y - x);
  out[1] = x * (params.rho - z) - y;
  out[2] = x * y - params.beta * z;
}

var k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0];

/* Один шаг RK4 */
function rk4(p, h) {
  var x = p.x, y = p.y, z = p.z;
  deriv(x, y, z, k1);
  deriv(x + k1[0] * h * 0.5, y + k1[1] * h * 0.5, z + k1[2] * h * 0.5, k2);
  deriv(x + k2[0] * h * 0.5, y + k2[1] * h * 0.5, z + k2[2] * h * 0.5, k3);
  deriv(x + k3[0] * h, y + k3[1] * h, z + k3[2] * h, k4);
  p.x = x + h * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
  p.y = y + h * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
  p.z = z + h * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) / 6;
}

/* Проекция 3D -> 2D: вращение вокруг оси z (yaw) + наклон (pitch) + перспектива */
var cosY = 1, sinY = 0, pitch = 0.35, cosP = 1, sinP = 0, scale = 10, camDist = 90;

function updateCamera(t) {
  yaw = t * 0.12;                 // медленное автоматическое вращение
  pitch = 0.32 + 0.08 * Math.sin(t * 0.05);
  cosY = Math.cos(yaw); sinY = Math.sin(yaw);
  cosP = Math.cos(pitch); sinP = Math.sin(pitch);
  scale = Math.min(W, H) / 55;
  camDist = Math.min(W, H) * 0.16;
}

function project(x, y, z, out) {
  var rx = x * cosY - y * sinY;
  var ry = x * sinY + y * cosY;
  var rz = z - CENTER_Z;
  var vy = rz * cosP - ry * sinP;   // вертикаль
  var vd = rz * sinP + ry * cosP;   // глубина
  var persp = camDist / (camDist + vd * scale);
  out[0] = W * 0.5 + rx * scale * persp;
  out[1] = H * 0.52 - vy * scale * persp;
}

var projOut = [0, 0];

function stepFrame(dt) {
  var simTime = dt * speed;
  var steps = Math.min(MAX_STEPS, Math.max(1, Math.round(simTime / H_STEP)));

  /* Затухание следа: полупрозрачная заливка фоном */
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(4, 6, 14, ' + (1 - trailKeep).toFixed(3) + ')';
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';

  for (var i = 0; i < particles.length; i++) {
    var p = particles[i];
    for (var s = 0; s < steps; s++) {
      rk4(p, H_STEP);

      /* защита от разноса при экстремальных параметрах */
      if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z) ||
          Math.abs(p.x) > 1e4 || Math.abs(p.y) > 1e4 || Math.abs(p.z) > 1e4) {
        spawn(p, i);
        break;
      }

      if (p.warmup > 0) { p.warmup--; p.has = false; continue; }

      /* цвет движется вдоль траектории + скорость влияет на яркость */
      p.hue = (p.hue + 0.55) % 360;
      var v = Math.sqrt(k1[0] * k1[0] + k1[1] * k1[1] + k1[2] * k1[2]);
      var light = 48 + Math.min(22, v * 0.12);

      project(p.x, p.y, p.z, projOut);
      if (p.has) {
        ctx.strokeStyle = 'hsla(' + p.hue.toFixed(1) + ', 95%, ' + light.toFixed(1) + '%, 0.85)';
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(projOut[0], projOut[1]);
        ctx.stroke();
      }
      p.px = projOut[0];
      p.py = projOut[1];
      p.has = true;
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

var lastT = -1;
function frame(nowMs) {
  var now = nowMs * 0.001;
  if (lastT < 0) lastT = now;
  var dt = Math.min(now - lastT, 0.05); /* кламп большого dt */
  lastT = now;

  updateCamera(now);
  if (!paused) stepFrame(dt);

  requestAnimationFrame(frame);
}

/* --- UI --- */
function bindRange(id, labelId, get, set) {
  var el = document.getElementById(id);
  var label = document.getElementById(labelId);
  function sync() { label.textContent = get().toFixed(get() < 3 ? 2 : 1); }
  el.addEventListener('input', function () {
    set(parseFloat(el.value));
    sync();
  });
  sync();
}

bindRange('p-sigma', 'v-sigma', function () { return params.sigma; }, function (v) { params.sigma = v; });
bindRange('p-rho', 'v-rho', function () { return params.rho; }, function (v) { params.rho = v; });
bindRange('p-beta', 'v-beta', function () { return params.beta; }, function (v) { params.beta = v; });
bindRange('p-speed', 'v-speed', function () { return speed; }, function (v) { speed = v; });
bindRange('p-trail', 'v-trail', function () { return trailKeep; }, function (v) { trailKeep = v; });

var btnPause = document.getElementById('btn-pause');
btnPause.addEventListener('click', function () {
  paused = !paused;
  btnPause.textContent = paused ? 'Пуск' : 'Пауза';
});
document.getElementById('btn-reset').addEventListener('click', resetParticles);

/* --- Старт --- */
resize();
resetParticles();
requestAnimationFrame(frame);
