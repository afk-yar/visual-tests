'use strict';
// Дуал-mode модуль: детерминированная форма занавеса полярного сияния.
// В браузере кладёт API в window.AuroraWave, в node экспортирует через module.exports.
//
// Это не «настоящий» Perlin/simplex-шум, а сумма трёх синусоид разной частоты —
// дешёвая, гладкая, детерминированная и ограниченная по амплитуде функция.
// Для процедурной формы занавеса (складки, высота, мерцание) этого достаточно,
// а для рендера на канвасе дешевле, чем честный градиентный шум.
(function () {
  // amplitude(0.5) + amplitude(0.3) + amplitude(0.2) === 1.0, поэтому |smoothNoise| <= 1
  // при любых x, t, seed — это гарантирует предсказуемый диапазон для альфы/высоты в рендере.
  function smoothNoise(x, t, seed) {
    seed = seed || 0;
    return (
      Math.sin(x * 0.013 + t * 0.6 + seed * 12.9898) * 0.5 +
      Math.sin(x * 0.027 - t * 0.37 + seed * 78.233) * 0.3 +
      Math.sin(x * 0.071 + t * 1.21 + seed * 37.719) * 0.2
    );
  }

  // Форма столбика занавеса в точке x в момент времени t.
  // Возвращает три независимые величины, каждая в [-1, 1]:
  //   drift   — медленное горизонтальное «дыхание» складки
  //   height  — среднечастотный множитель высоты столбика
  //   flicker — быстрая яркостная рябь внутри складки (используется и для лучей)
  function curtainShape(x, t, seed) {
    seed = seed || 0;
    return {
      drift: smoothNoise(x * 0.6, t, seed),
      height: smoothNoise(x, t * 0.8, seed + 5.5),
      flicker: smoothNoise(x * 2.3, t * 2.6, seed + 11.1),
    };
  }

  const api = { smoothNoise, curtainShape };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.AuroraWave = api;
  }
})();
