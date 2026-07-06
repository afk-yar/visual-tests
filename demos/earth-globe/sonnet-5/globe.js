// globe.js — чистая математика вращающегося земного шара.
// Dual-mode модуль: в браузере кладёт API в window.Globe, в node
// экспортирует через module.exports (см. CLAUDE.md, раздел "Конвенции").
//
// Система координат наблюдателя: x — вправо, y — вверх, z — на наблюдателя
// (стандартная правая тройка, ортографическая проекция камеры вдоль -z).
(function (root) {
  'use strict';

  var DEG2RAD = Math.PI / 180;
  var EARTH_AXIAL_TILT = 23.5 * DEG2RAD;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function normalize(v) {
    var len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  // нормализация угла в (-PI, PI]
  function wrapAngle(a) {
    var twoPi = Math.PI * 2;
    var r = ((a + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
    return r;
  }

  /**
   * Переводит широту/долготу точки на сфере в единичный 3D-вектор в системе
   * координат наблюдателя, учитывая текущий угол вращения планеты вокруг
   * своей оси (rotation) и наклон оси вращения относительно наблюдателя
   * (tilt, обычно EARTH_AXIAL_TILT).
   *
   * Порядок преобразования: поворот вокруг собственной оси планеты (Y) на
   * угол rotation, затем наклон этой оси относительно наблюдателя — поворот
   * вокруг оси X на угол tilt.
   *
   * @param {number} lat широта, радианы, [-PI/2 .. PI/2]
   * @param {number} lon долгота точки, "приклеенная" к сфере, радианы
   * @param {number} rotation текущий угол вращения планеты вокруг своей оси
   * @param {number} tilt наклон оси вращения, радианы
   * @returns {{x:number,y:number,z:number}} единичный вектор в системе наблюдателя
   */
  function latLonToVector(lat, lon, rotation, tilt) {
    var lonEff = lon + rotation;
    var cosLat = Math.cos(lat);
    var x0 = cosLat * Math.cos(lonEff);
    var y0 = Math.sin(lat);
    var z0 = cosLat * Math.sin(lonEff);

    var cosT = Math.cos(tilt);
    var sinT = Math.sin(tilt);

    return {
      x: x0,
      y: y0 * cosT - z0 * sinT,
      z: y0 * sinT + z0 * cosT,
    };
  }

  /**
   * Обратное преобразование: по вектору точки в системе наблюдателя
   * восстанавливает широту и "приклеенную" к планете долготу (без текущего
   * вращения). Используется рендерером, чтобы найти на неподвижной
   * относительно планеты карте (суша/облака), какая точка сейчас видна
   * в данном пикселе экрана.
   *
   * @param {{x:number,y:number,z:number}} vec единичный вектор в системе наблюдателя
   * @param {number} rotation текущий угол вращения планеты
   * @param {number} tilt наклон оси вращения, радианы
   * @returns {{lat:number, lon:number}}
   */
  function viewVectorToLatLon(vec, rotation, tilt) {
    var cosT = Math.cos(tilt);
    var sinT = Math.sin(tilt);
    // обратный поворот вокруг X на -tilt (транспонирование матрицы поворота)
    var y0 = vec.y * cosT + vec.z * sinT;
    var z0 = -vec.y * sinT + vec.z * cosT;
    var x0 = vec.x;

    var lat = Math.asin(clamp(y0, -1, 1));
    var lonEff = Math.atan2(z0, x0);
    var lon = wrapAngle(lonEff - rotation);
    return { lat: lat, lon: lon };
  }

  /**
   * "Сырая" освещённость точки сферы: косинус угла между нормалью
   * поверхности (для сферы совпадает с направлением из центра к точке)
   * и направлением на источник света. Положительное значение — точка на
   * дневной стороне, отрицательное — на ночной, ноль — линия терминатора.
   */
  function illumination(pointVec, lightVec) {
    return (
      pointVec.x * lightVec.x +
      pointVec.y * lightVec.y +
      pointVec.z * lightVec.z
    );
  }

  /**
   * Мягкий терминатор: превращает "сырую" освещённость (illumination,
   * диапазон -1..1) в коэффициент день/ночь 0..1 с плавным (smoothstep)
   * переходом шириной 2*softness вокруг границы (dot = 0), вместо жёсткого
   * обрезания дня и ночи.
   */
  function terminatorFactor(dot, softness) {
    var s = softness > 0 ? softness : 1e-6;
    var t = clamp((dot + s) / (2 * s), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /**
   * Направление на источник света из угла азимута (вокруг вертикальной
   * оси сцены) и угла высоты над "экватором" сцены — удобный интерфейс
   * для управления (слайдеры/перетаскивание), результат — единичный вектор.
   */
  function lightFromAzEl(azimuth, elevation) {
    var cosEl = Math.cos(elevation);
    return {
      x: cosEl * Math.sin(azimuth),
      y: Math.sin(elevation),
      z: cosEl * Math.cos(azimuth),
    };
  }

  var api = {
    DEG2RAD: DEG2RAD,
    EARTH_AXIAL_TILT: EARTH_AXIAL_TILT,
    latLonToVector: latLonToVector,
    viewVectorToLatLon: viewVectorToLatLon,
    illumination: illumination,
    terminatorFactor: terminatorFactor,
    lightFromAzEl: lightFromAzEl,
    clamp: clamp,
    normalize: normalize,
    wrapAngle: wrapAngle,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Globe = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
