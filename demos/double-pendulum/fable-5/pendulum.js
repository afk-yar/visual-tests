/*
 * Двойной маятник — чистая физика без DOM.
 * Dual-mode: в браузере кладёт API в window.Pendulum, в node — module.exports.
 *
 * Состояние: [θ1, ω1, θ2, ω2] (углы от вертикали вниз, рад; угловые скорости, рад/с).
 * Параметры: { m1, m2, l1, l2, g }.
 */
(function (global) {
  'use strict';

  // Правые части уравнений движения (лагранжева механика, классическая форма).
  function derivatives(s, p) {
    var th1 = s[0], w1 = s[1], th2 = s[2], w2 = s[3];
    var m1 = p.m1, m2 = p.m2, l1 = p.l1, l2 = p.l2, g = p.g;
    var d = th1 - th2;
    var sinD = Math.sin(d), cosD = Math.cos(d);
    var den = 2 * m1 + m2 - m2 * Math.cos(2 * d);

    var a1 = (-g * (2 * m1 + m2) * Math.sin(th1)
      - m2 * g * Math.sin(th1 - 2 * th2)
      - 2 * sinD * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * cosD)) / (l1 * den);

    var a2 = (2 * sinD * (w1 * w1 * l1 * (m1 + m2)
      + g * (m1 + m2) * Math.cos(th1)
      + w2 * w2 * l2 * m2 * cosD)) / (l2 * den);

    return [w1, a1, w2, a2];
  }

  // Один шаг Рунге — Кутты 4-го порядка.
  function rk4Step(s, dt, p) {
    var k1 = derivatives(s, p);
    var k2 = derivatives(addScaled(s, k1, dt / 2), p);
    var k3 = derivatives(addScaled(s, k2, dt / 2), p);
    var k4 = derivatives(addScaled(s, k3, dt), p);
    return [
      s[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      s[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
      s[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
      s[3] + (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]),
    ];
  }

  function addScaled(s, k, h) {
    return [s[0] + k[0] * h, s[1] + k[1] * h, s[2] + k[2] * h, s[3] + k[3] * h];
  }

  // Декартовы координаты грузов (y вниз — экранная система).
  function positions(s, p) {
    var x1 = p.l1 * Math.sin(s[0]);
    var y1 = p.l1 * Math.cos(s[0]);
    var x2 = x1 + p.l2 * Math.sin(s[2]);
    var y2 = y1 + p.l2 * Math.cos(s[2]);
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
  }

  // Полная механическая энергия (y вверх для потенциальной части).
  function energy(s, p) {
    var w1 = s[1], w2 = s[3];
    var v1sq = p.l1 * p.l1 * w1 * w1;
    var v2sq = v1sq + p.l2 * p.l2 * w2 * w2
      + 2 * p.l1 * p.l2 * w1 * w2 * Math.cos(s[0] - s[2]);
    var T = 0.5 * p.m1 * v1sq + 0.5 * p.m2 * v2sq;
    var y1 = -p.l1 * Math.cos(s[0]);
    var y2 = y1 - p.l2 * Math.cos(s[2]);
    var V = p.m1 * p.g * y1 + p.m2 * p.g * y2;
    return T + V;
  }

  var api = {
    derivatives: derivatives,
    rk4Step: rk4Step,
    positions: positions,
    energy: energy,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Pendulum = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
