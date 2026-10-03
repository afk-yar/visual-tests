/* Шахматный конь — Claude Sonnet 5.5.
 * Вся графика — статичный инлайн-SVG. Скрипт двигает только один элемент:
 * ключевой свет (#light), который лежит поверх объёма корпуса и обрезан его контуром.
 * Свет следует за курсором; без курсора — медленно «дышит» вокруг исходной точки. */
(function () {
  'use strict';

  var svg = document.getElementById('art');
  var light = document.getElementById('light');
  if (!svg || !light) return;

  var HOME = { x: 230, y: 250 };   // исходное положение света (верх-слева, в координатах viewBox)
  var IDLE_AFTER = 3500;           // мс без движения мыши — возвращаемся к «дыханию»
  var FRAME_MS = 1000 / 40;        // обновляем атрибут не чаще ~40 раз/с

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* matchMedia недоступен — считаем, что можно */ }

  var cur = { x: HOME.x, y: HOME.y };
  var target = { x: HOME.x, y: HOME.y };
  var lastMove = -Infinity;
  var prevT = 0;
  var sinceApply = 0;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // экранные координаты -> координаты viewBox (с учётом meet-масштаба и полей)
  function toSvg(clientX, clientY) {
    var m = svg.getScreenCTM && svg.getScreenCTM();
    if (!m) return null;
    var pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    var q = pt.matrixTransform(m.inverse());
    return { x: q.x, y: q.y };
  }

  function onMove(e) {
    var p = toSvg(e.clientX, e.clientY);
    if (!p) return;
    target.x = clamp(p.x, 40, 580);
    target.y = clamp(p.y, 60, 720);
    lastMove = performance.now();
  }

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onMove, { passive: true });

  function frame(now) {
    requestAnimationFrame(frame);

    var dt = prevT ? (now - prevT) / 1000 : 0;
    prevT = now;
    if (dt > 0.05) dt = 0.05;            // кламп большого dt (вкладка была в фоне)

    var idle = (now - lastMove) > IDLE_AFTER;
    if (idle) {
      if (reduceMotion) {
        target.x = HOME.x;
        target.y = HOME.y;
      } else {
        var t = now / 1000;
        target.x = HOME.x + 46 * Math.sin(t * 0.42);
        target.y = HOME.y + 32 * Math.sin(t * 0.29 + 1.3);
      }
    }

    var k = 1 - Math.exp(-dt * (idle ? 2.2 : 7));
    cur.x += (target.x - cur.x) * k;
    cur.y += (target.y - cur.y) * k;

    sinceApply += dt * 1000;
    if (sinceApply < FRAME_MS) return;
    sinceApply = 0;

    light.setAttribute('cx', cur.x.toFixed(2));
    light.setAttribute('cy', cur.y.toFixed(2));
  }

  requestAnimationFrame(frame);
})();
