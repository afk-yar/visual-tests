'use strict';

/*
 * Процедурная походка stick-figure — чистая кинематика, без DOM/canvas.
 * Dual-mode: браузер → window.Gait, node → module.exports.
 *
 * Система координат экранная: x вправо, y вниз. Человечек идёт вправо.
 * Иллюзия движения создаётся прокруткой земли влево со скоростью speed;
 * таз фигуры стоит на месте по x, поэтому стопа в фазе опоры обязана
 * ехать в системе таза назад ровно на -speed, чтобы относительно земли
 * (которая тоже едет на -speed) оставаться неподвижной.
 *
 * Фаза ноги phase ∈ [0,1): [0, duty) — ОПОРА (стопа на земле, h=0),
 *                           [duty, 1) — ПЕРЕНОС (стопа летит вперёд, h>0).
 */
(function (global) {
  'use strict';

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  // Плавная S-кривая [0,1]→[0,1], нулевая производная на концах.
  function smoothstep(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Линейная интерполяция с насыщением по скорости: при speed<=s0 → a,
  // при speed>=s1 → b, между — гладкий smoothstep. Используется, чтобы
  // характер походки плавно менялся от медленной ходьбы к бегу.
  function ramp(speed, s0, s1, a, b) {
    if (s1 <= s0) return b;
    return a + (b - a) * smoothstep((speed - s0) / (s1 - s0));
  }

  /*
   * Параметры походки как функция скорости (px/с).
   * Ключевой инвариант для отсутствия проскальзывания:
   *     stepLen = speed * T * duty
   * Вывод: фаза опоры длится duty*T секунд; за это время таз проходит
   * speed*T*duty пикселей вперёд; чтобы стопа стояла на месте в мире,
   * она должна в системе таза проехать ровно столько же назад. Значит
   * горизонтальный ход стопы в опоре = stepLen = speed*T*duty.
   *
   * Характер походки:
   *   - период T падает (каденс растёт);
   *   - duty (доля опоры) падает ниже 0.5 → появляется фаза полёта (бег);
   *   - подъём стопы, вертикальное качание и наклон корпуса растут.
   */
  function gaitParams(speed) {
    var s = Math.max(speed, 0);
    var T = ramp(s, 40, 420, 1.10, 0.46);     // период цикла, с
    var duty = ramp(s, 40, 420, 0.64, 0.34);  // доля фазы опоры в цикле
    var stepLen = s * T * duty;               // см. инвариант выше
    var lift = ramp(s, 40, 420, 8, 40);       // высота подъёма стопы, px
    var bounce = ramp(s, 40, 420, 2, 9);      // амплитуда вертикального качания таза, px
    var lean = ramp(s, 40, 420, 0.02, 0.34);  // наклон корпуса вперёд, рад
    var armSwing = ramp(s, 40, 420, 0.30, 1.0); // амплитуда маха рук, рад
    var elbow = ramp(s, 40, 420, 0.20, 0.95); // сгиб локтя, рад
    return {
      T: T, duty: duty, stepLen: stepLen, lift: lift,
      bounce: bounce, lean: lean, armSwing: armSwing, elbow: elbow,
    };
  }

  /*
   * Положение стопы в системе таза: { x, h }.
   *   x — горизонтальное смещение относительно таза (px),
   *   h — высота над уровнем земли (px), h >= 0.
   *
   * Опора [0,duty): x линейно едет от +stepLen/2 к -stepLen/2 РАВНОМЕРНО.
   *   Равномерность критична: средняя горизонтальная скорость стопы в опоре
   *   равна -stepLen/(duty*T) = -speed, поэтому в мире стопа стоит.
   * Перенос [duty,1): x идёт назад→вперёд по smoothstep (мягкие отрыв и
   *   приземление без рывка), h поднимается и опускается по полусинусу.
   */
  function footPosition(phase, duty, stepLen, lift) {
    var p = phase - Math.floor(phase);
    if (p < duty) {
      var t = duty > 0 ? p / duty : 0;
      return { x: stepLen / 2 - stepLen * t, h: 0 };
    }
    var q = (p - duty) / (1 - duty);
    return {
      x: -stepLen / 2 + stepLen * smoothstep(q),
      h: lift * Math.sin(Math.PI * q),
    };
  }

  /*
   * Двухзвенная обратная кинематика ноги/руки.
   * Дано: корень (rx,ry), цель (tx,ty), длины звеньев l1 (бедро),
   *       l2 (голень), знак сгиба сустава bend (+1 / -1).
   * Возврат: { jointX, jointY, endX, endY } — позиция сустава (колена/локтя)
   *          и фактический конец (стопа/кисть, может отличаться от цели,
   *          если цель недостижима).
   *
   * Недостижимая цель (дальше l1+l2): нога выпрямляется ровно вдоль
   *   направления на цель, конец дотягивается до max-reach.
   * Слишком близкая цель (ближе |l1-l2|): отодвигается до min-reach.
   * Сустав гнётся в сторону, заданную bend (анатомически: для ноги,
   *   идущей вправо, колено вперёд — bend=+1).
   */
  function solveIK(rx, ry, tx, ty, l1, l2, bend) {
    var dx = tx - rx, dy = ty - ry;
    var d = Math.sqrt(dx * dx + dy * dy);

    if (d < 1e-9) { dx = 0; dy = 1e-9; d = 1e-9; }

    var maxD = (l1 + l2) * (1 - 1e-12);
    var minD = Math.abs(l1 - l2) * (1 + 1e-12);
    if (d > maxD) {
      var km = maxD / d;
      dx *= km; dy *= km; d = maxD;
    } else if (d < minD) {
      var kn = minD / d;
      dx *= kn; dy *= kn; d = minD;
    }
    var endX = rx + dx, endY = ry + dy;

    // Угол между звеном l1 и линией корень→конец (теорема косинусов).
    var cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    cosA = clamp(cosA, -1, 1);
    var a = Math.acos(cosA);
    var base = Math.atan2(dy, dx);
    // В экранных координатах (y вниз) для цели под корнем base=+π/2;
    // вычитание a при bend=+1 уводит сустав в +x (вперёд) — то, что нужно
    // для колена ноги, идущей вправо. bend=-1 — зеркально, в -x.
    var ang = base - a * (bend >= 0 ? 1 : -1);

    return {
      jointX: rx + l1 * Math.cos(ang),
      jointY: ry + l1 * Math.sin(ang),
      endX: endX,
      endY: endY,
    };
  }

  var api = {
    clamp: clamp,
    smoothstep: smoothstep,
    ramp: ramp,
    gaitParams: gaitParams,
    footPosition: footPosition,
    solveIK: solveIK,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Gait = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
