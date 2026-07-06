// Чистая логика аналоговых часов: вычисление углов стрелок по времени.
// Dual-mode: в браузере кладёт API в window.Clock, в node — module.exports.
(function (root) {
  'use strict';

  // Нормализует угол в градусах в диапазон [0, 360).
  function normalizeDeg(deg) {
    var d = deg % 360;
    if (d < 0) d += 360;
    return d;
  }

  // Вычисляет углы часовой/минутной/секундной стрелок в градусах
  // от вертикали (12 часов = 0°), по часовой стрелке.
  //
  // Часовая стрелка непрерывно учитывает минуты и секунды (не скачет
  // по часовым делениям), минутная непрерывно учитывает секунды (не
  // скачет по минутным делениям) — обе двигаются плавно.
  //
  // hours: 0-23 (или любое целое, берётся по модулю 12 для позиции)
  // minutes: 0-59
  // seconds: 0-59
  // milliseconds: 0-999
  function computeAngles(hours, minutes, seconds, milliseconds) {
    hours = hours || 0;
    minutes = minutes || 0;
    seconds = seconds || 0;
    milliseconds = milliseconds || 0;

    var secFrac = seconds + milliseconds / 1000; // 0..60, непрерывно
    var minFrac = minutes + secFrac / 60; // 0..60, непрерывно (учитывает секунды)
    var hourFrac = (hours % 12) + minFrac / 60; // 0..12, непрерывно (учитывает минуты+секунды)

    return {
      hourDeg: normalizeDeg((hourFrac / 12) * 360),
      minuteDeg: normalizeDeg((minFrac / 60) * 360),
      secondDeg: normalizeDeg((secFrac / 60) * 360)
    };
  }

  function degToRad(deg) {
    return (deg * Math.PI) / 180;
  }

  // То же самое, но сразу в радианах — удобно для ctx.rotate().
  function computeAnglesRad(hours, minutes, seconds, milliseconds) {
    var deg = computeAngles(hours, minutes, seconds, milliseconds);
    return {
      hourRad: degToRad(deg.hourDeg),
      minuteRad: degToRad(deg.minuteDeg),
      secondRad: degToRad(deg.secondDeg)
    };
  }

  // Кратчайшая знаковая угловая разница a-b с учётом склейки 360°=0°.
  function angleDelta(a, b) {
    var d = normalizeDeg(a - b);
    if (d > 180) d -= 360;
    return d;
  }

  // Easing "с отскоком" для механического тика секундной стрелки
  // (лёгкий перелёт цели и пружинный возврат). p: 0..1 -> ~0..1.08..1.
  function easeOutBack(p) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    var x = p - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
  }

  var api = {
    computeAngles: computeAngles,
    computeAnglesRad: computeAnglesRad,
    degToRad: degToRad,
    normalizeDeg: normalizeDeg,
    angleDelta: angleDelta,
    easeOutBack: easeOutBack
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Clock = api;
  }
})(typeof window !== 'undefined' ? window : this);
