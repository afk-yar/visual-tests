'use strict';

// Угловые ускорения (каноника, myPhysicsLab). s={th1,th2,w1,w2}, p={m1,m2,L1,L2,g}.
function accelerations(s, p) {
  const { th1, th2, w1, w2 } = s;
  const { m1, m2, L1, L2, g } = p;
  const d = th1 - th2;
  const denom = 2 * m1 + m2 - m2 * Math.cos(2 * th1 - 2 * th2);
  const a1 = (
    -g * (2 * m1 + m2) * Math.sin(th1)
    - m2 * g * Math.sin(th1 - 2 * th2)
    - 2 * Math.sin(d) * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * Math.cos(d))
  ) / (L1 * denom);
  const a2 = (
    2 * Math.sin(d) * (
      w1 * w1 * L1 * (m1 + m2)
      + g * (m1 + m2) * Math.cos(th1)
      + w2 * w2 * L2 * m2 * Math.cos(d)
    )
  ) / (L2 * denom);
  return { a1, a2 };
}

// Производная состояния для интегратора.
function derivative(s, p) {
  const { a1, a2 } = accelerations(s, p);
  return { th1: s.w1, th2: s.w2, w1: a1, w2: a2 };
}

function addScaled(s, ds, h) {
  return {
    th1: s.th1 + ds.th1 * h,
    th2: s.th2 + ds.th2 * h,
    w1: s.w1 + ds.w1 * h,
    w2: s.w2 + ds.w2 * h,
  };
}

// Один шаг RK4.
function rk4Step(s, p, dt) {
  const k1 = derivative(s, p);
  const k2 = derivative(addScaled(s, k1, dt / 2), p);
  const k3 = derivative(addScaled(s, k2, dt / 2), p);
  const k4 = derivative(addScaled(s, k3, dt), p);
  return {
    th1: s.th1 + dt / 6 * (k1.th1 + 2 * k2.th1 + 2 * k3.th1 + k4.th1),
    th2: s.th2 + dt / 6 * (k1.th2 + 2 * k2.th2 + 2 * k3.th2 + k4.th2),
    w1: s.w1 + dt / 6 * (k1.w1 + 2 * k2.w1 + 2 * k3.w1 + k4.w1),
    w2: s.w2 + dt / 6 * (k1.w2 + 2 * k2.w2 + 2 * k3.w2 + k4.w2),
  };
}

// Полная механическая энергия (для контроля стабильности).
function totalEnergy(s, p) {
  const { th1, th2, w1, w2 } = s;
  const { m1, m2, L1, L2, g } = p;
  const ke = 0.5 * m1 * L1 * L1 * w1 * w1
    + 0.5 * m2 * (L1 * L1 * w1 * w1 + L2 * L2 * w2 * w2
      + 2 * L1 * L2 * w1 * w2 * Math.cos(th1 - th2));
  const pe = -(m1 + m2) * g * L1 * Math.cos(th1) - m2 * g * L2 * Math.cos(th2);
  return ke + pe;
}

// Координаты грузов, пивот в (0,0), y вниз. Масштаб/смещение — в рендерере.
function bobPositions(s, p) {
  const { th1, th2 } = s;
  const { L1, L2 } = p;
  const x1 = L1 * Math.sin(th1);
  const y1 = L1 * Math.cos(th1);
  const x2 = x1 + L2 * Math.sin(th2);
  const y2 = y1 + L2 * Math.cos(th2);
  return { x1, y1, x2, y2 };
}

const PendulumAPI = { accelerations, derivative, rk4Step, totalEnergy, bobPositions };

// Dual-mode: node — экспорт; браузер (<script>) — глобал window.Pendulum.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PendulumAPI;
} else {
  window.Pendulum = PendulumAPI;
}
