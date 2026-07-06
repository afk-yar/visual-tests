'use strict';
// Чистая физика двойного маятника (без DOM/canvas).
// Dual-mode: в браузере кладёт API в window.Pendulum, в Node — module.exports.
//
// Состояние маятника — вектор [th1, th2, w1, w2]:
//   th1, th2 — углы стержней от вертикали вниз (рад), against clockwise positive
//   w1, w2   — угловые скорости (рад/с)
// Параметры params — { m1, m2, l1, l2, g }.
//
// Уравнения движения — классический вывод для двойного маятника (сверено с
// myphysicslab.com/pendulum/double-pendulum-en.html):
//
//   th1'' = [ -g(2m1+m2)sin(th1) - m2 g sin(th1-2 th2)
//              - 2 sin(th1-th2) m2 (w2^2 l2 + w1^2 l1 cos(th1-th2)) ]
//           / [ l1 (2 m1 + m2 - m2 cos(2 th1 - 2 th2)) ]
//
//   th2'' = [ 2 sin(th1-th2) ( w1^2 l1 (m1+m2) + g(m1+m2) cos(th1) + w2^2 l2 m2 cos(th1-th2) ) ]
//           / [ l2 (2 m1 + m2 - m2 cos(2 th1 - 2 th2)) ]
(function () {
  const G_DEFAULT = 9.81;

  /** Производная состояния: [th1', th2', w1', w2'] = f(state, params). */
  function derivatives(state, params) {
    const th1 = state[0];
    const th2 = state[1];
    const w1 = state[2];
    const w2 = state[3];
    const m1 = params.m1;
    const m2 = params.m2;
    const l1 = params.l1;
    const l2 = params.l2;
    const g = params.g == null ? G_DEFAULT : params.g;

    const delta = th1 - th2;
    const sinD = Math.sin(delta);
    const cosD = Math.cos(delta);
    const den = l1 * (2 * m1 + m2 - m2 * Math.cos(2 * delta));

    const num1 =
      -g * (2 * m1 + m2) * Math.sin(th1) -
      m2 * g * Math.sin(th1 - 2 * th2) -
      2 * sinD * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * cosD);
    const a1 = num1 / den;

    const den2 = l2 * (2 * m1 + m2 - m2 * Math.cos(2 * delta));
    const num2 =
      2 * sinD *
      (w1 * w1 * l1 * (m1 + m2) + g * (m1 + m2) * Math.cos(th1) + w2 * w2 * l2 * m2 * cosD);
    const a2 = num2 / den2;

    return [w1, w2, a1, a2];
  }

  function addScaled(state, deriv, h) {
    return [
      state[0] + deriv[0] * h,
      state[1] + deriv[1] * h,
      state[2] + deriv[2] * h,
      state[3] + deriv[3] * h,
    ];
  }

  /** Один шаг классического RK4 длиной dt. */
  function rk4Step(state, params, dt) {
    const k1 = derivatives(state, params);
    const k2 = derivatives(addScaled(state, k1, dt / 2), params);
    const k3 = derivatives(addScaled(state, k2, dt / 2), params);
    const k4 = derivatives(addScaled(state, k3, dt), params);
    return [
      state[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      state[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
      state[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
      state[3] + (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]),
    ];
  }

  /** Интегрирует dt секунд, разбивая на substeps суб-шагов RK4 (для устойчивости). */
  function integrate(state, params, dt, substeps) {
    const n = Math.max(1, substeps | 0 || 1);
    const h = dt / n;
    let s = state;
    for (let i = 0; i < n; i++) {
      s = rk4Step(s, params, h);
    }
    return s;
  }

  /** Декартовы координаты шарнира и обоих грузов (pivot в начале координат, y вверх положительно). */
  function positions(state, params) {
    const th1 = state[0];
    const th2 = state[1];
    const l1 = params.l1;
    const l2 = params.l2;
    const x1 = l1 * Math.sin(th1);
    const y1 = -l1 * Math.cos(th1);
    const x2 = x1 + l2 * Math.sin(th2);
    const y2 = y1 - l2 * Math.cos(th2);
    return { x1, y1, x2, y2 };
  }

  /** Полная механическая энергия (кинетическая + потенциальная) системы. */
  function totalEnergy(state, params) {
    const th1 = state[0];
    const th2 = state[1];
    const w1 = state[2];
    const w2 = state[3];
    const m1 = params.m1;
    const m2 = params.m2;
    const l1 = params.l1;
    const l2 = params.l2;
    const g = params.g == null ? G_DEFAULT : params.g;

    const vx1 = l1 * Math.cos(th1) * w1;
    const vy1 = l1 * Math.sin(th1) * w1;
    const vx2 = vx1 + l2 * Math.cos(th2) * w2;
    const vy2 = vy1 + l2 * Math.sin(th2) * w2;

    const ke = 0.5 * m1 * (vx1 * vx1 + vy1 * vy1) + 0.5 * m2 * (vx2 * vx2 + vy2 * vy2);
    const pe = -(m1 + m2) * g * l1 * Math.cos(th1) - m2 * g * l2 * Math.cos(th2);

    return ke + pe;
  }

  const api = {
    G_DEFAULT,
    derivatives,
    rk4Step,
    integrate,
    positions,
    totalEnergy,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.Pendulum = api;
  }
})();
