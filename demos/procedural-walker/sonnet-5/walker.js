'use strict';
// Чистая процедурная кинематика походки stick-figure.
// Dual-mode: в браузере кладёт API в window.Walker, в node — module.exports.
// Все длины — в абстрактных «единицах» (вызывающий код сам решает масштаб в px);
// корректность инвариантов (периодичность, отсутствие проскальзывания стопы)
// не зависит от выбранной единицы измерения.
(function () {
  function lerp(a, b, t) { return a + (b - a) * t; }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Кубический ease 0..1 → 0..1 с нулевой производной на концах.
  function smoothstep(t) {
    const c = clamp(t, 0, 1);
    return c * c * (3 - 2 * c);
  }

  // Заворачивает фазу в полуоткрытый интервал [0,1) — цикл походки периодичен по 1.
  function mod1(x) {
    const r = x - Math.floor(x);
    return r < 0 ? r + 1 : r;
  }

  // ---- Параметры походки по позиции слайдера скорости ----
  // speedT ∈ [0,1]: 0 = медленная ходьба, 1 = бег. Все выходные величины —
  // непрерывные функции speedT, поэтому смена характера походки плавная
  // (нет ветвления if(бежит) / else(идёт) — везде интерполяция).
  function gaitParams(speedT) {
    const t = clamp(speedT, 0, 1);
    const g = smoothstep(t); // сглаженный «прогресс» смены характера походки

    return {
      speedT: t,
      gaitBlend: g,
      // Доля цикла в фазе опоры: у ходьбы > 0.5 (есть двойная опора),
      // у бега < 0.5 (появляется фаза полёта — обе ноги в переносе).
      dutyFactor: lerp(0.62, 0.30, g),
      // Каденс — циклов походки в секунду.
      frequency: lerp(1.55, 3.1, g),
      // Скорость сцены/земли в единицах «длина ноги / с».
      groundSpeed: lerp(1.05, 4.3, t),
      // Подъём стопы в фазе переноса (доля длины ноги).
      stepHeight: lerp(0.05, 0.13, g),
      // Амплитуда вертикального покачивания бёдер (доля длины ноги).
      hipBounce: lerp(0.018, 0.055, g),
      // Наклон корпуса вперёд, рад.
      lean: lerp(0.02, 0.24, g),
      // Амплитуда взмаха руки, рад.
      armSwing: lerp(0.45, 1.05, g),
      // Базовый и добавочный сгиб локтя, рад.
      elbowBase: lerp(0.12, 0.32, g),
      elbowSwing: lerp(0.15, 0.55, g),
    };
  }

  // ---- Целевая позиция стопы относительно бедра за один цикл походки ----
  // phase — фаза именно этой ноги (для второй ноги вызывающий код передаёт phase+0.5).
  // params — { dutyFactor, frequency, groundSpeed, stepHeight } в согласованных единицах.
  // Возвращает { x, h }:
  //   x — смещение стопы вперёд(+)/назад(-) относительно бедра;
  //   h — высота стопы НАД землёй, всегда >= 0, и ровно 0 на всей фазе опоры.
  //
  // Длина шага L выводится из groundSpeed так, чтобы горизонтальная скорость
  // стопы в фазе опоры (dx/dt = -groundSpeed) в точности совпадала со скоростью
  // сцены/земли — отсюда «стопа не скользит относительно земли» получается
  // конструктивно, а не проверкой постфактум.
  function footTarget(phase, params) {
    const p = mod1(phase);
    const d = clamp(params.dutyFactor, 0.05, 0.95);
    const L = (params.groundSpeed * d) / params.frequency;
    const half = L / 2;

    if (p < d) {
      // Опора: линейная развёртка от +half до -half — постоянная скорость,
      // совпадающая со скоростью земли.
      const t = p / d;
      return { x: half - L * t, h: 0 };
    }

    // Перенос: стопа возвращается вперёд по дуге, с плавным стартом/финишем
    // по горизонтали (smoothstep) и подъёмом-дугой по вертикали (sin).
    const t = (p - d) / (1 - d);
    const x = -half + L * smoothstep(t);
    const h = Math.max(0, params.stepHeight * Math.sin(Math.PI * t));
    return { x, h };
  }

  // ---- Обратная кинематика двухзвенной ноги (бедро → колено → стопа) ----
  // hipX,hipY — положение бедра; footX,footY — целевая точка стопы;
  // thigh,shank — длины сегментов. Система координат canvas: +x вперёд, +y вниз.
  // Угол 0 = сегмент направлен строго вниз, положительный угол = вперёд по ходу.
  // Возвращает углы и положение колена, достаточные для отрисовки сегментов.
  function solveLegIK(hipX, hipY, footX, footY, thigh, shank) {
    const dx = footX - hipX;
    const dy = footY - hipY;
    let dist = Math.hypot(dx, dy);

    const maxReach = thigh + shank - 1e-3;
    const minReach = Math.abs(thigh - shank) + 1e-3;
    dist = clamp(dist, minReach, maxReach);

    // Угол между бедром и линией «бедро-стопа» (теорема косинусов).
    const cosHipOff = clamp(
      (thigh * thigh + dist * dist - shank * shank) / (2 * thigh * dist),
      -1,
      1
    );
    const hipOffset = Math.acos(cosHipOff);

    // Внутренний угол в колене (0 = нога полностью прямая).
    const cosKnee = clamp(
      (thigh * thigh + shank * shank - dist * dist) / (2 * thigh * shank),
      -1,
      1
    );
    const kneeBend = Math.PI - Math.acos(cosKnee);

    const baseAngle = Math.atan2(dx, dy); // направление «бедро → стопа» от вертикали вниз
    // Колено всегда сгибается вперёд (в сторону движения) — прибавляем смещение,
    // а не вычитаем, иначе колено «выгибалось» бы назад.
    const hipAngle = baseAngle + hipOffset;

    const kneeX = hipX + thigh * Math.sin(hipAngle);
    const kneeY = hipY + thigh * Math.cos(hipAngle);
    const shankAngle = Math.atan2(footX - kneeX, footY - kneeY);

    return { hipAngle, kneeBend, shankAngle, kneeX, kneeY };
  }

  // Полная поза ноги по фазе: свод foot-target + IK в одну функцию —
  // это и есть «углы бедра/колена по фазе цикла» из требования задачи.
  function legPose(phase, params, hipX, hipY, groundY, thigh, shank) {
    const ft = footTarget(phase, params);
    const footX = hipX + ft.x;
    const footY = groundY - ft.h;
    const ik = solveLegIK(hipX, hipY, footX, footY, thigh, shank);
    return {
      footX,
      footY,
      footHeight: ft.h,
      hipAngle: ik.hipAngle,
      kneeBend: ik.kneeBend,
      shankAngle: ik.shankAngle,
      kneeX: ik.kneeX,
      kneeY: ik.kneeY,
      stance: mod1(phase) < params.dutyFactor,
    };
  }

  // ---- Вспомогательная кинематика верхней части тела (без IK — прямой привод) ----

  // Вертикальное покачивание бёдер: два «горба» за полный цикл походки
  // (опора каждой из двух ног даёт свой подъём таза) — период 0.5 по фазе.
  // Возвращает смещение (0 = центр, положительное = вниз).
  function torsoBounce(phase, params) {
    const p = mod1(phase);
    return params.hipBounce * (0.5 - 0.5 * Math.cos(4 * Math.PI * p));
  }

  // Угол плеча и сгиб локтя по фазе руки (рука работает в противофазе
  // одноимённой ноге: вызывающий код передаёт leg-phase + 0.5).
  function armPose(phase, params) {
    const p = mod1(phase);
    const swing = Math.sin(2 * Math.PI * p);
    const shoulderAngle = params.lean * 0.35 + params.armSwing * swing;
    const elbowBend = params.elbowBase + params.elbowSwing * Math.max(0, swing);
    return { shoulderAngle, elbowBend };
  }

  const api = {
    lerp,
    clamp,
    smoothstep,
    mod1,
    gaitParams,
    footTarget,
    solveLegIK,
    legPose,
    torsoBounce,
    armPose,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  window.Walker = api;
})();
