/*
 * Процедурная походка — чистая кинематика без DOM.
 * Dual-mode: в браузере кладёт API в window.Walker, в node — module.exports.
 *
 * Координаты экранные: x вправо, y вниз. Походка направлена вправо.
 * Фаза ноги phase ∈ [0,1): [0, duty) — опора (стопа на земле),
 * [duty, 1) — перенос (стопа летит вперёд).
 */
(function (global) {
  'use strict';

  /*
   * Параметры походки от скорости (px/с).
   * Ключевой инвариант: stepLen = speed * T * duty — тогда стопа в опоре
   * движется относительно таза ровно со скоростью -speed, и в мировой
   * системе (таз летит вперёд со speed) стоит на месте.
   */
  function gaitParams(speed) {
    var s = Math.max(speed, 1);
    var T = clamp(1.15 - s * 0.0016, 0.45, 1.15);        // период цикла, с
    var duty = clamp(0.66 - s * 0.00095, 0.36, 0.66);    // доля фазы опоры
    var stepLen = s * T * duty;
    var lift = clamp(6 + s * 0.06, 6, 34);               // подъём стопы
    var bounce = clamp(1.5 + s * 0.012, 1.5, 7);         // качание таза
    var lean = clamp(s * 0.0011, 0, 0.38);               // наклон корпуса, рад
    return { T: T, duty: duty, stepLen: stepLen, lift: lift, bounce: bounce, lean: lean };
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  /*
   * Положение стопы в системе таза: { x, h }, h >= 0 — высота над землёй.
   * В опоре x движется линейно от +stepLen/2 к -stepLen/2 (равномерно!),
   * в переносе — вперёд по smoothstep с подъёмом по синусу.
   */
  function footPosition(phase, duty, stepLen, lift) {
    var p = phase - Math.floor(phase);
    if (p < duty) {
      var t = p / duty;
      return { x: stepLen / 2 - stepLen * t, h: 0 };
    }
    var q = (p - duty) / (1 - duty);
    return {
      x: -stepLen / 2 + stepLen * smoothstep(q),
      h: lift * Math.sin(Math.PI * q),
    };
  }

  /*
   * Двухзвенная обратная кинематика: бедро (l1) + голень (l2).
   * kneeDir: +1 — колено выгибается вперёд (в +x), -1 — назад.
   * Недосягаемая цель: нога выпрямляется вдоль направления на цель.
   */
  function solveLegIK(hx, hy, fx, fy, l1, l2, kneeDir) {
    var dx = fx - hx, dy = fy - hy;
    var d = Math.sqrt(dx * dx + dy * dy);
    var maxD = (l1 + l2) * 0.99999;
    if (d < 1e-9) { d = 1e-9; dx = 0; dy = 1e-9; }
    if (d > maxD) {
      var k = maxD / d;
      dx *= k; dy *= k; d = maxD;
      fx = hx + dx; fy = hy + dy;
    }
    var minD = Math.abs(l1 - l2) * 1.00001;
    if (d < minD) {
      var k2 = minD / d;
      dx *= k2; dy *= k2; d = minD;
      fx = hx + dx; fy = hy + dy;
    }
    // Угол отклонения бедра от линии таз-стопа (т. косинусов).
    var cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    cosA = clamp(cosA, -1, 1);
    var a = Math.acos(cosA);
    var base = Math.atan2(dy, dx);
    var ang = base - a * kneeDir;
    return {
      kneeX: hx + l1 * Math.cos(ang),
      kneeY: hy + l1 * Math.sin(ang),
      footX: fx,
      footY: fy,
    };
  }

  var api = {
    gaitParams: gaitParams,
    footPosition: footPosition,
    solveLegIK: solveLegIK,
    smoothstep: smoothstep,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Walker = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
