'use strict';
// Чистая кинематика рыбьего тела: бегущая волна изгиба вдоль хребта +
// профиль ширины тела + темп биения хвоста от скорости плавания.
// Dual-mode: в браузере кладёт API в window.Fish, в node — module.exports
// (см. assets/shell.js — тот же паттерн).
(function () {
  function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }

  // Классический smoothstep: монотонно неубывающая эрмитова интерполяция 0..1.
  function smoothstep(edge0, edge1, x) {
    if (edge0 === edge1) return x < edge0 ? 0 : 1;
    const t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  }

  // Огибающая амплитуды изгиба вдоль хребта: 0 у головы (headBias — доля
  // тела, которая почти не гнётся), плавно нарастает к хвосту.
  function envelope(s, headBias) {
    const hb = headBias === undefined ? 0.12 : headBias;
    return smoothstep(hb, 1, clamp01(s));
  }

  // Боковое смещение точки хребта на позиции s∈[0..1] (0=голова,1=хвост)
  // в момент фазы phase. Бегущая волна: гребень смещается от головы к
  // хвосту по мере роста phase — так толкается вода при плавании.
  function bodyWave(s, phase, opts) {
    const o = opts || {};
    const amplitude = o.amplitude === undefined ? 1 : o.amplitude;
    const frequency = o.frequency === undefined ? 1.15 : o.frequency;
    const headBias = o.headBias;
    const env = envelope(s, headBias);
    return amplitude * env * Math.sin(2 * Math.PI * frequency * s - phase);
  }

  // Профиль полуширины тела вдоль хребта: узкий нос → плечи у peakS →
  // сужение к хвостовому стеблю (tailMinRatio), где начинается хвостовой
  // плавник (рисуется отдельно). Возвращает множитель 0..1.
  function widthProfile(s, opts) {
    const o = opts || {};
    const peakS = o.peakS === undefined ? 0.32 : o.peakS;
    const tailBaseS = o.tailBaseS === undefined ? 0.86 : o.tailBaseS;
    const tailMinRatio = o.tailMinRatio === undefined ? 0.16 : o.tailMinRatio;
    const c = clamp01(s);
    if (c <= peakS) {
      return smoothstep(0, peakS, c);
    }
    if (c <= tailBaseS) {
      const fall = smoothstep(peakS, tailBaseS, c);
      return 1 - fall * (1 - tailMinRatio);
    }
    return tailMinRatio;
  }

  // Собирает хребет рыбы: n+1 точек в локальных координатах тела
  // (+x вперёд/к голове, x=+bodyLength/2 — голова, x=-bodyLength/2 — хвост).
  function buildSpine(config, phase) {
    const c = config || {};
    const n = c.segments === undefined ? 24 : c.segments;
    const bodyLength = c.bodyLength === undefined ? 1 : c.bodyLength;
    const bodyHeight = c.bodyHeight === undefined ? 1 : c.bodyHeight;
    const amplitude = c.amplitude === undefined ? bodyHeight * 0.6 : c.amplitude;
    const waveOpts = { amplitude: amplitude, frequency: c.frequency, headBias: c.headBias };
    const widthOpts = { peakS: c.peakS, tailBaseS: c.tailBaseS, tailMinRatio: c.tailMinRatio };
    const points = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const x = bodyLength * (0.5 - s);
      const y = bodyWave(s, phase, waveOpts);
      const w = widthProfile(s, widthOpts) * bodyHeight;
      points[i] = { s: s, x: x, y: y, w: w };
    }
    return points;
  }

  // Частота биения хвоста в функции относительной скорости (0 — стоит на
  // месте, 1 — крейсерская скорость): монотонно растёт со скоростью, но
  // не падает до нуля в покое (лёгкое подрагивание живой рыбы).
  function tailBeatRate(speedRatio, baseFreq) {
    const bf = baseFreq === undefined ? 1 : baseFreq;
    const r = speedRatio < 0 ? 0 : speedRatio;
    return bf * (0.45 + 0.85 * r);
  }

  const api = {
    clamp01: clamp01,
    smoothstep: smoothstep,
    envelope: envelope,
    bodyWave: bodyWave,
    widthProfile: widthProfile,
    buildSpine: buildSpine,
    tailBeatRate: tailBeatRate,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  window.Fish = api;
})();
