'use strict';
// Дуал-mode модуль: в браузере кладёт API в window.Surface, в node — module.exports.
// Чистая математика 3D-поверхности: высота узла, нормаль по соседям сетки, проекция камеры.
// Никакого DOM/canvas здесь нет — это отдельный слой, чтобы формулы можно было
// прогнать через node:assert без браузера.
(function () {
  // ---- Режимы поверхности и их параметры -----------------------------------

  var MODES = ['ripple', 'saddle', 'gaussian'];

  // Затухающая рябь: z = A * sin(r*k - t*speed) / (r*k + 1)
  // "+1" в знаменателе — стандартный приём, чтобы избежать деления на 0 в r=0
  // (иначе sin(-t)/0 расходится) и дать амплитуде плавно затухать от центра.
  var RIPPLE = { amplitude: 1.2, k: 1.6, speed: 1.8 };

  // Седло (гиперболический параболоид): z = scale*(x^2 - y^2), с медленной
  // пульсацией амплитуды во времени, чтобы поверхность не была статичной.
  var SADDLE = { scale: 0.35, pulseAmplitude: 0.15, pulseSpeed: 0.6 };

  // Гауссиана: z = A * exp(-r^2 / (2*sigma^2)), тоже с лёгкой пульсацией.
  var GAUSSIAN = { amplitude: 1.6, sigma: 0.9, pulseAmplitude: 0.12, pulseSpeed: 0.5 };

  function heightRipple(x, y, t) {
    var r = Math.sqrt(x * x + y * y);
    var arg = r * RIPPLE.k - t * RIPPLE.speed;
    return (RIPPLE.amplitude * Math.sin(arg)) / (r * RIPPLE.k + 1);
  }

  function heightSaddle(x, y, t) {
    var base = SADDLE.scale * (x * x - y * y);
    var pulse = 1 + SADDLE.pulseAmplitude * Math.sin(t * SADDLE.pulseSpeed);
    return base * pulse;
  }

  function heightGaussian(x, y, t) {
    var r2 = x * x + y * y;
    var base = GAUSSIAN.amplitude * Math.exp(-r2 / (2 * GAUSSIAN.sigma * GAUSSIAN.sigma));
    var pulse = 1 + GAUSSIAN.pulseAmplitude * Math.sin(t * GAUSSIAN.pulseSpeed);
    return base * pulse;
  }

  // Диспетчер: высота z = f(x, y) в момент времени t для заданного режима.
  function heightAt(mode, x, y, t) {
    switch (mode) {
      case 'ripple':
        return heightRipple(x, y, t);
      case 'saddle':
        return heightSaddle(x, y, t);
      case 'gaussian':
        return heightGaussian(x, y, t);
      default:
        throw new Error('Surface.heightAt: неизвестный режим "' + mode + '"');
    }
  }

  function normalize3(x, y, z) {
    var len = Math.sqrt(x * x + y * y + z * z) || 1;
    return { x: x / len, y: y / len, z: z / len };
  }

  // Нормаль в узле сетки по 4 соседним высотам (центральная разность).
  // hLeft/hRight — высоты в (x-step,y)/(x+step,y), hDown/hUp — в (x,y-step)/(x,y+step).
  // Для узла (x,y,h) касательные вдоль осей: Tx=(1,0,dz/dx), Ty=(0,1,dz/dy),
  // нормаль = Tx × Ty = (-dz/dx, -dz/dy, 1), затем нормализуется.
  function computeNormal(hLeft, hRight, hDown, hUp, step) {
    var dzdx = (hRight - hLeft) / (2 * step);
    var dzdy = (hUp - hDown) / (2 * step);
    return normalize3(-dzdx, -dzdy, 1);
  }

  // 3D-проекция узла на экран.
  // Мировые оси: X — вправо, Y — вверх (высота z поверхности), Z — "вглубь" (второй
  // аргумент функции). Камера медленно облетает сцену вокруг вертикальной оси Y
  // (camera.angle) под фиксированным углом возвышения (camera.tilt), затем идёт
  // перспективное деление.
  // camera = { angle, tilt, distance, fov, width, height }
  function projectPoint(worldX, worldY, worldZ, camera) {
    var cosA = Math.cos(camera.angle);
    var sinA = Math.sin(camera.angle);
    // Поворот вокруг вертикальной оси Y (облёт камеры вокруг сцены).
    var x1 = worldX * cosA - worldZ * sinA;
    var z1 = worldX * sinA + worldZ * cosA;
    var y1 = worldY;

    var cosT = Math.cos(camera.tilt);
    var sinT = Math.sin(camera.tilt);
    // Поворот вокруг оси X (угол возвышения камеры над плоскостью сетки).
    var y2 = y1 * cosT - z1 * sinT;
    var z2 = y1 * sinT + z1 * cosT;
    var x2 = x1;

    // Перспективное деление: чем больше z2 (дальше от камеры), тем меньше scale.
    var denom = camera.distance + z2;
    var scale = camera.fov / denom;
    var sx = camera.width / 2 + x2 * scale;
    var sy = camera.height / 2 - y2 * scale; // экранный Y растёт вниз — переворачиваем

    return { x: sx, y: sy, depth: z2, scale: scale };
  }

  var api = {
    MODES: MODES,
    RIPPLE: RIPPLE,
    SADDLE: SADDLE,
    GAUSSIAN: GAUSSIAN,
    heightAt: heightAt,
    computeNormal: computeNormal,
    projectPoint: projectPoint,
    normalize3: normalize3,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.Surface = api;
  }
})();
