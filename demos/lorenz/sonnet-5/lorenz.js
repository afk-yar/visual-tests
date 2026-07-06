// lorenz.js — dual-mode модуль: система уравнений Лоренца + шаг RK4.
// В браузере кладёт API в window.Lorenz, в node экспортирует через module.exports.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Lorenz = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Классические параметры аттрактора Лоренца.
  var DEFAULTS = { sigma: 10, rho: 28, beta: 8 / 3 };

  // Производные системы Лоренца в точке (x, y, z).
  //   dx/dt = sigma * (y - x)
  //   dy/dt = x * (rho - z) - y
  //   dz/dt = x * y - beta * z
  function derivatives(x, y, z, sigma, rho, beta) {
    sigma = sigma === undefined ? DEFAULTS.sigma : sigma;
    rho = rho === undefined ? DEFAULTS.rho : rho;
    beta = beta === undefined ? DEFAULTS.beta : beta;

    var dx = sigma * (y - x);
    var dy = x * (rho - z) - y;
    var dz = x * y - beta * z;
    return [dx, dy, dz];
  }

  // Один шаг интегрирования методом Рунге-Кутты 4-го порядка.
  // state — [x, y, z]; dt — шаг по времени; params — { sigma, rho, beta } (опционально).
  function step(state, dt, params) {
    params = params || {};
    var sigma = params.sigma === undefined ? DEFAULTS.sigma : params.sigma;
    var rho = params.rho === undefined ? DEFAULTS.rho : params.rho;
    var beta = params.beta === undefined ? DEFAULTS.beta : params.beta;

    var x = state[0];
    var y = state[1];
    var z = state[2];

    var k1 = derivatives(x, y, z, sigma, rho, beta);
    var k2 = derivatives(
      x + (dt / 2) * k1[0],
      y + (dt / 2) * k1[1],
      z + (dt / 2) * k1[2],
      sigma, rho, beta
    );
    var k3 = derivatives(
      x + (dt / 2) * k2[0],
      y + (dt / 2) * k2[1],
      z + (dt / 2) * k2[2],
      sigma, rho, beta
    );
    var k4 = derivatives(
      x + dt * k3[0],
      y + dt * k3[1],
      z + dt * k3[2],
      sigma, rho, beta
    );

    var nx = x + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    var ny = y + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    var nz = z + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);

    return [nx, ny, nz];
  }

  return {
    DEFAULTS: DEFAULTS,
    derivatives: derivatives,
    step: step
  };
});
