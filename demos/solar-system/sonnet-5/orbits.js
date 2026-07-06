'use strict';
// Дуал-mode модуль: чистая математика эллиптической орбиты (уравнение Кеплера).
// В браузере кладёт API в window.Orbits, в node экспортирует через module.exports.
(function () {
  const TWO_PI = Math.PI * 2;

  // Приводит угол (в радианах) к диапазону [0, 2π).
  function normalizeAngle(angle) {
    let a = angle % TWO_PI;
    if (a < 0) a += TWO_PI;
    return a;
  }

  // Решает уравнение Кеплера M = E - e*sin(E) относительно эксцентрической
  // аномалии E методом Ньютона. M и результат — в радианах, e — эксцентриситет [0,1).
  function solveKeplerEquation(meanAnomaly, e, tolerance, maxIterations) {
    tolerance = tolerance === undefined ? 1e-9 : tolerance;
    maxIterations = maxIterations === undefined ? 60 : maxIterations;
    const M = normalizeAngle(meanAnomaly);
    // Хорошее начальное приближение: M для умеренных e, иначе π (около афелия).
    let E = e < 0.8 ? M : Math.PI;
    for (let i = 0; i < maxIterations; i++) {
      const f = E - e * Math.sin(E) - M;
      const fPrime = 1 - e * Math.cos(E);
      const delta = f / fPrime;
      E -= delta;
      if (Math.abs(delta) < tolerance) break;
    }
    return E;
  }

  // Положение тела в плоскости орбиты и в 3D, если эксцентрическая аномалия E
  // уже известна (пропускает решение уравнения Кеплера). Используется как
  // самим orbitPosition(t), так и рендерером — чтобы построить гладкий контур
  // всей орбиты равномерным перебором E (в отличие от равномерного перебора t,
  // который из-за второго закона Кеплера даёт неравномерную по углу выборку).
  //
  // params: a, e, inclinationDeg, ascNodeDeg, argPeriapsisDeg (см. orbitPosition).
  // Возвращает { x, y, z, r } относительно фокуса (Солнце/центр — в начале координат).
  function positionFromEccentricAnomaly(params, E) {
    const a = params.a;
    const e = params.e || 0;
    const incl = ((params.inclinationDeg || 0) * Math.PI) / 180;
    const node = ((params.ascNodeDeg || 0) * Math.PI) / 180;
    const argP = ((params.argPeriapsisDeg || 0) * Math.PI) / 180;

    // Координаты в плоскости орбиты (перифокальная СК), фокус — в начале координат.
    const xp = a * (Math.cos(E) - e);
    const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const r = Math.sqrt(xp * xp + yp * yp);

    // Поворот перифокальной плоскости в опорную 3D СК: R3(-node) * R1(-incl) * R3(-argP).
    const cosO = Math.cos(node), sinO = Math.sin(node);
    const cosW = Math.cos(argP), sinW = Math.sin(argP);
    const cosI = Math.cos(incl), sinI = Math.sin(incl);

    const x = (cosO * cosW - sinO * sinW * cosI) * xp + (-cosO * sinW - sinO * cosW * cosI) * yp;
    const y = (sinO * cosW + cosO * sinW * cosI) * xp + (-sinO * sinW + cosO * cosW * cosI) * yp;
    const z = (sinW * sinI) * xp + (cosW * sinI) * yp;

    return { x: x, y: y, z: z, r: r };
  }

  // Положение тела на эллиптической орбите вокруг фокуса (Солнца/планеты)
  // в момент времени t. Параметрическое уравнение эллипса через эксцентрическую
  // аномалию E, повёрнутое в 3D по орбитальным элементам (наклон, узел, перицентр).
  //
  // params:
  //   a               — большая полуось орбиты (любые единицы длины)
  //   e               — эксцентриситет [0, 1)
  //   periodDays      — период обращения (единицы времени, совпадают с t)
  //   inclinationDeg  — наклон плоскости орбиты к плоскости отсчёта, градусы
  //   ascNodeDeg      — долгота восходящего узла, градусы (ориентация линии узлов)
  //   argPeriapsisDeg — аргумент перицентра, градусы (поворот эллипса в своей плоскости)
  //   phase0Deg       — средняя аномалия в момент t=0, градусы (начальная фаза)
  //
  // Возвращает { x, y, z, r }: координаты относительно фокуса (Солнце/центр
  // всегда в начале координат) и расстояние r от фокуса.
  function orbitPosition(params, t) {
    const e = params.e || 0;
    const period = params.periodDays;
    const n = TWO_PI / period; // среднее движение, рад / единица времени
    const phase0 = ((params.phase0Deg || 0) * Math.PI) / 180;

    const M = n * t + phase0;
    const E = solveKeplerEquation(M, e);

    return positionFromEccentricAnomaly(params, E);
  }

  const api = {
    TWO_PI: TWO_PI,
    normalizeAngle: normalizeAngle,
    solveKeplerEquation: solveKeplerEquation,
    positionFromEccentricAnomaly: positionFromEccentricAnomaly,
    orbitPosition: orbitPosition,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  window.Orbits = api;
})();
