'use strict';
const assert = require('node:assert');
const Globe = require('./globe.js');

// 1. Перевод широта/долгота → 3D-вектор всегда даёт единичный вектор,
//    при любых углах вращения и наклона оси.
{
  const samples = [
    [0, 0, 0, 0],
    [Globe.DEG2RAD * 45, Globe.DEG2RAD * 130, Globe.DEG2RAD * 77, Globe.EARTH_AXIAL_TILT],
    [-Globe.DEG2RAD * 89, Globe.DEG2RAD * -170, Globe.DEG2RAD * 361, Globe.EARTH_AXIAL_TILT],
    [Globe.DEG2RAD * 30, Globe.DEG2RAD * 200, Globe.DEG2RAD * -50, Globe.DEG2RAD * 10],
    [Globe.DEG2RAD * -12, Globe.DEG2RAD * 355, Globe.DEG2RAD * 999, Globe.DEG2RAD * -23.5],
  ];
  for (const [lat, lon, rotation, tilt] of samples) {
    const v = Globe.latLonToVector(lat, lon, rotation, tilt);
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    assert.ok(
      Math.abs(len - 1) < 1e-9,
      `длина вектора должна быть 1, получили ${len} для lat=${lat} lon=${lon} rotation=${rotation} tilt=${tilt}`
    );
  }
}

// 2. Базовый случай: экватор, нулевой меридиан, без вращения/наклона →
//    вектор смотрит точно вдоль +x.
{
  const v = Globe.latLonToVector(0, 0, 0, 0);
  assert.ok(Math.abs(v.x - 1) < 1e-9);
  assert.ok(Math.abs(v.y) < 1e-9);
  assert.ok(Math.abs(v.z) < 1e-9);
}

// 3. Наклон оси реально наклоняет полюс: при lat=90°, tilt=23.5° северный
//    полюс уходит из чистого +y в сторону z (y укорачивается на cos(tilt)).
{
  const tilt = Globe.EARTH_AXIAL_TILT;
  const northPole = Globe.latLonToVector(Math.PI / 2, 0, 0, tilt);
  assert.ok(Math.abs(northPole.y - Math.cos(tilt)) < 1e-9);
  assert.ok(Math.abs(northPole.z - Math.sin(tilt)) < 1e-9);
  assert.ok(Math.abs(northPole.z) > 1e-6, 'при ненулевом наклоне полюс должен сместиться по z');
}

// 4. Обратное преобразование viewVectorToLatLon восстанавливает исходные
//    широту/долготу (round-trip), вдали от полюсов (где долгота вырождена).
{
  const cases = [
    [0.3, 1.1, 0.7, Globe.EARTH_AXIAL_TILT],
    [-0.9, -2.4, 4.2, Globe.EARTH_AXIAL_TILT],
    [1.0, 0.0, -1.3, Globe.DEG2RAD * 12],
    [-0.5, 3.0, 0.0, 0],
  ];
  for (const [lat, lon, rotation, tilt] of cases) {
    const v = Globe.latLonToVector(lat, lon, rotation, tilt);
    const back = Globe.viewVectorToLatLon(v, rotation, tilt);
    assert.ok(Math.abs(back.lat - lat) < 1e-6, `lat round-trip: ${back.lat} vs ${lat}`);
    let dLon = back.lon - lon;
    dLon = Math.atan2(Math.sin(dLon), Math.cos(dLon)); // разница по кругу, без скачка на ±PI
    assert.ok(Math.abs(dLon) < 1e-6, `lon round-trip: ${back.lon} vs ${lon}`);
  }
}

// 5. Точка, направленная прямо на источник света, освещена (dot ≈ 1 > 0).
{
  const light = Globe.normalize({ x: 0.4, y: 0.2, z: 1 });
  const litPoint = light; // нормаль точки совпадает с направлением на солнце
  const dot = Globe.illumination(litPoint, light);
  assert.ok(dot > 0.99, `точка навстречу солнцу должна быть максимально освещена, dot=${dot}`);
}

// 6. Противоположная (антиподальная) точка — в тени (dot ≈ -1 < 0).
{
  const light = Globe.normalize({ x: 0.4, y: 0.2, z: 1 });
  const shadowPoint = { x: -light.x, y: -light.y, z: -light.z };
  const dot = Globe.illumination(shadowPoint, light);
  assert.ok(dot < -0.99, `противоположная точка должна быть в тени, dot=${dot}`);
}

// 7. Мягкий терминатор: далеко от границы — полный день/полная ночь,
//    ровно на границе (dot=0) — середина перехода (0.5).
{
  assert.ok(Globe.terminatorFactor(1, 0.2) > 0.999, 'при dot=1 должен быть почти полный день');
  assert.ok(Globe.terminatorFactor(-1, 0.2) < 0.001, 'при dot=-1 должна быть почти полная ночь');
  assert.ok(
    Math.abs(Globe.terminatorFactor(0, 0.2) - 0.5) < 1e-9,
    'на самой линии терминатора (dot=0) должно быть ровно посередине'
  );
}

// 8. lightFromAzEl всегда возвращает единичный вектор.
{
  const l = Globe.lightFromAzEl(1.234, -0.4);
  const len = Math.sqrt(l.x * l.x + l.y * l.y + l.z * l.z);
  assert.ok(Math.abs(len - 1) < 1e-9);
}

console.log('globe.test.js: все проверки пройдены (' + 8 + ' блоков assert)');
