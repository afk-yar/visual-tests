/*
 * Система Лоренца — чистая математика без DOM.
 * Dual-mode: в браузере кладёт API в window.Lorenz, в node — module.exports.
 *
 * Состояние: [x, y, z]. Параметры: { sigma, rho, beta }.
 */
(function (global) {
  'use strict';

  var CLASSIC = { sigma: 10, rho: 28, beta: 8 / 3 };

  function derivatives(s, p) {
    return [
      p.sigma * (s[1] - s[0]),
      s[0] * (p.rho - s[2]) - s[1],
      s[0] * s[1] - p.beta * s[2],
    ];
  }

  // Один шаг Рунге — Кутты 4-го порядка.
  function rk4Step(s, dt, p) {
    var k1 = derivatives(s, p);
    var k2 = derivatives(add(s, k1, dt / 2), p);
    var k3 = derivatives(add(s, k2, dt / 2), p);
    var k4 = derivatives(add(s, k3, dt), p);
    return [
      s[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      s[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
      s[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
    ];
  }

  function add(s, k, h) {
    return [s[0] + k[0] * h, s[1] + k[1] * h, s[2] + k[2] * h];
  }

  // Неподвижные точки C± = (±√(β(ρ−1)), ±√(β(ρ−1)), ρ−1).
  function fixedPoints(p) {
    var r = Math.sqrt(p.beta * (p.rho - 1));
    return [
      [r, r, p.rho - 1],
      [-r, -r, p.rho - 1],
      [0, 0, 0],
    ];
  }

  var api = {
    CLASSIC: CLASSIC,
    derivatives: derivatives,
    rk4Step: rk4Step,
    fixedPoints: fixedPoints,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Lorenz = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
