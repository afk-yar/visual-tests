'use strict';
// Дуал-mode модуль: чистое векторное поле скоростей для потока частиц.
//
// Поле строится как ротор (curl) векторного потенциала psi = (psi1, psi2, psi3),
// где каждая компонента psi — сумма синусоид от координат и времени. Ротор
// ЛЮБОГО гладкого векторного потенциала divergence-free (div(curl(psi)) = 0),
// поэтому получившееся поле ведёт себя как поток несжимаемой жидкости —
// классический приём «curl noise» (Bridson et al.), только вместо шума Перлина
// используется явная аналитическая сумма синусоид: производные считаются
// аналитически (без конечных разностей), что дёшево и по-настоящему
// детерминировано.
//
// curl(psi) = ( d psi3/dy - d psi2/dz,
//               d psi1/dz - d psi3/dx,
//               d psi2/dx - d psi1/dy )
(function () {
  // Один октав поля.
  //   psi1 = sin(y*freq + t*timeSpeed)        * cos(z*freq + p1)
  //   psi2 = sin(z*freq + t*timeSpeed + p2)    * cos(x*freq + p3)
  //   psi3 = sin(x*freq + t*timeSpeed + p4)    * cos(y*freq + p5)
  // Частные производные берутся аналитически (произведение синуса и косинуса).
  function curlOctave(x, y, z, t, freq, timeSpeed, phase) {
    var wt = t * timeSpeed;

    var ay = y * freq + wt;
    var az = z * freq + phase.p1;
    var sinAy = Math.sin(ay), cosAy = Math.cos(ay);
    var sinAz = Math.sin(az), cosAz = Math.cos(az);
    // psi1 = sin(ay) * cos(az)
    var dPsi1_dy = freq * cosAy * cosAz;
    var dPsi1_dz = -freq * sinAy * sinAz;

    var bz = z * freq + wt + phase.p2;
    var bx = x * freq + phase.p3;
    var sinBz = Math.sin(bz), cosBz = Math.cos(bz);
    var sinBx = Math.sin(bx), cosBx = Math.cos(bx);
    // psi2 = sin(bz) * cos(bx)
    var dPsi2_dz = freq * cosBz * cosBx;
    var dPsi2_dx = -freq * sinBz * sinBx;

    var cx = x * freq + wt + phase.p4;
    var cy = y * freq + phase.p5;
    var sinCx = Math.sin(cx), cosCx = Math.cos(cx);
    var sinCy = Math.sin(cy), cosCy = Math.cos(cy);
    // psi3 = sin(cx) * cos(cy)
    var dPsi3_dx = freq * cosCx * cosCy;
    var dPsi3_dy = -freq * sinCx * sinCy;

    return {
      vx: dPsi3_dy - dPsi2_dz,
      vy: dPsi1_dz - dPsi3_dx,
      vz: dPsi2_dx - dPsi1_dy
    };
  }

  // Три октава: убывающая амплитуда, растущая частота и скорость эволюции по
  // времени — даёт крупные медленные вихри с более мелкой быстрой турбулентностью
  // поверх них (аналог фрактального/multi-octave шума). Офсеты координат у
  // октавов 2 и 3 расфазируют их относительно первого, чтобы не было очевидной
  // синхронности решёток.
  var OCTAVES = [
    { freq: 0.085, timeSpeed: 0.050, amp: 1.00, off: { x: 0, y: 0, z: 0 },
      phase: { p1: 1.7, p2: 2.1, p3: 3.4, p4: 4.8, p5: 0.6 } },
    { freq: 0.190, timeSpeed: 0.090, amp: 0.50, off: { x: 37.1, y: -19.7, z: 5.3 },
      phase: { p1: 0.3, p2: 5.2, p3: 1.1, p4: 2.6, p5: 4.0 } },
    { freq: 0.410, timeSpeed: 0.140, amp: 0.22, off: { x: -11.3, y: 24.6, z: -8.9 },
      phase: { p1: 3.9, p2: 0.8, p3: 5.6, p4: 1.4, p5: 2.2 } }
  ];

  // Аналитическая верхняя граница модуля поля (см. FIELD_MAX_SPEED ниже):
  // для каждого октава |vx|,|vy|,|vz| <= 2*freq*amp (разность двух слагаемых,
  // каждое по модулю не больше freq*amp, т.к. sin/cos ограничены единицей).
  // Суммируя по осям и применяя неравенство треугольника к вектору получаем
  // безопасную (не занижающую) границу нормы.
  var perAxisBound = 0;
  for (var i = 0; i < OCTAVES.length; i++) {
    perAxisBound += 2 * OCTAVES[i].freq * OCTAVES[i].amp;
  }
  var FIELD_MAX_SPEED = Math.sqrt(3) * perAxisBound;

  function curlVelocity(x, y, z, t) {
    var vx = 0, vy = 0, vz = 0;
    for (var i = 0; i < OCTAVES.length; i++) {
      var o = OCTAVES[i];
      var c = curlOctave(x + o.off.x, y + o.off.y, z + o.off.z, t, o.freq, o.timeSpeed, o.phase);
      vx += c.vx * o.amp;
      vy += c.vy * o.amp;
      vz += c.vz * o.amp;
    }
    return { vx: vx, vy: vy, vz: vz };
  }

  var api = {
    curlVelocity: curlVelocity,
    OCTAVES: OCTAVES,
    FIELD_MAX_SPEED: FIELD_MAX_SPEED
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.ParticleField = api;
  }
})();
