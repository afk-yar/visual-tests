/* SVG велосипед: процедурные части (спицы, зубья, цепь, подписи) и анимация.
   Статичная рама, руль, седло и тормоза лежат прямо в index.html. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var TAU = Math.PI * 2;
  var DEG = 180 / Math.PI;

  // Ключевые точки (в координатах viewBox 1200x780), те же, что в разметке.
  var BB = { x: 555, y: 510 };   // каретка
  var RW = { x: 330, y: 470 };   // ось заднего колеса
  var N_RING = 44;               // зубьев на ведущей звезде
  var N_COG = 14;                // зубьев на задней звёздочке
  var TYRE_R = 188;              // радиус покрышки по центру протектора
  var WHEEL_M = 0.34;            // реальный радиус колеса, м (для км/ч)

  function $(id) { return document.getElementById(id); }
  function mk(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) { e.setAttribute(k, attrs[k]); }
    if (parent) { parent.appendChild(e); }
    return e;
  }
  function f(v) { return String(Math.round(v * 100) / 100); }
  function pmod(a, m) { return ((a % m) + m) % m; }
  function pol(c, r, a) { return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }; }
  function P(q) { return f(q.x) + ' ' + f(q.y); }

  /* ---------------- спицы: 36 штук, «трёхкратная» шнуровка ---------------- */
  (function buildSpokes() {
    var g = $('spokes');
    var n = 36, rRim = 167.4, rHub = 13.2, wrap = 62 / DEG;
    for (var i = 0; i < n; i++) {
      var ar = i * TAU / n;
      var ah = ar + (i % 2 ? wrap : -wrap);
      mk('line', {
        x1: f(rHub * Math.cos(ah)), y1: f(rHub * Math.sin(ah)),
        x2: f(rRim * Math.cos(ar)), y2: f(rRim * Math.sin(ar)),
        stroke: i % 2 ? '#8497ae' : '#c5d2e2',
        'stroke-width': i % 2 ? 0.8 : 1
      }, g);
    }
  })();

  /* ---------------- привод: подбор шага цепи и сборка контура ---------------- */
  // Длина замкнутой цепи вокруг двух звёзд (внешние касательные).
  function chainLen(p, D) {
    var a = (N_RING - N_COG) / TAU;
    var g = Math.asin(a * p / D);
    var R = p * N_RING / TAU, r = p * N_COG / TAU;
    return 2 * Math.sqrt(D * D - a * p * a * p) + R * (Math.PI + 2 * g) + r * (Math.PI - 2 * g);
  }
  // Цепь состоит из чётного числа звеньев: подбираем шаг так, чтобы длина делилась на него нацело.
  function solvePitch(D) {
    var p0 = 8.3;
    var links = 2 * Math.round(chainLen(p0, D) / p0 / 2);
    var lo = 6, hi = 11, mid, i;
    for (i = 0; i < 60; i++) {
      mid = (lo + hi) / 2;
      if (chainLen(mid, D) / mid > links) { lo = mid; } else { hi = mid; }
    }
    return { p: (lo + hi) / 2, links: links };
  }
  function teethPath(c, n, rr, rt, phase) {
    var step = TAU / n, pts = [], i, a;
    for (i = 0; i < n; i++) {
      a = phase + i * step;
      pts.push(pol(c, rr, a + 0.2 * step), pol(c, rt, a + 0.33 * step),
               pol(c, rt, a + 0.67 * step), pol(c, rr, a + 0.8 * step));
    }
    return 'M' + pts.map(P).join('L') + 'Z';
  }
  function holePath(c, r) {
    return 'M' + P({ x: c.x + r, y: c.y }) + 'A' + f(r) + ' ' + f(r) + ' 0 1 0 ' +
      P({ x: c.x - r, y: c.y }) + 'A' + f(r) + ' ' + f(r) + ' 0 1 0 ' + P({ x: c.x + r, y: c.y }) + 'Z';
  }

  var drive = (function () {
    var dx = RW.x - BB.x, dy = RW.y - BB.y;
    var D = Math.hypot(dx, dy), psi = Math.atan2(dy, dx);
    var sol = solvePitch(D), p = sol.p;
    var R = p * N_RING / TAU, r = p * N_COG / TAU;
    var gam = Math.asin((R - r) / D);
    var n1 = psi + Math.PI / 2 - gam;   // нормаль верхней ветви цепи
    var n2 = psi - Math.PI / 2 + gam;   // нормаль нижней ветви
    var T1 = pol(BB, R, n1), T2 = pol(BB, R, n2), T3 = pol(RW, r, n2), T4 = pol(RW, r, n1);
    var sw1 = pmod(n2 - n1, TAU), sw2 = pmod(n1 - n2, TAU);
    var straight = Math.hypot(T3.x - T2.x, T3.y - T2.y);

    // Путь идёт по часовой стрелке: верх звезды, низ звезды, низ звёздочки, верх звёздочки.
    var d = 'M' + P(T1) +
      'A' + f(R) + ' ' + f(R) + ' 0 ' + (sw1 > Math.PI ? 1 : 0) + ' 1 ' + P(T2) +
      'L' + P(T3) +
      'A' + f(r) + ' ' + f(r) + ' 0 ' + (sw2 > Math.PI ? 1 : 0) + ' 1 ' + P(T4) + 'Z';
    ['chainShadow', 'chainA', 'chainB', 'chainPins'].forEach(function (id) { $(id).setAttribute('d', d); });

    var wA = 5.2, wB = 3.8;
    $('chainA').setAttribute('stroke-dasharray', f(p - wA) + ' ' + f(p + wA));
    $('chainB').setAttribute('stroke-dasharray', f(p - wB) + ' ' + f(p + wB));
    $('chainPins').setAttribute('stroke-dasharray', '0.01 ' + f(p - 0.01));

    // Зубья расставлены так, чтобы ролики цепи садились точно во впадины.
    var sCog = R * sw1 + straight;                  // длина пути до начала дуги на звёздочке
    var cogPhase = n2 + pmod(-sCog, p) / r;
    $('ringBody').setAttribute('d', teethPath(BB, N_RING, R - 3, R + 3.2, n1) + holePath(BB, 46));
    $('cogBody').setAttribute('d', teethPath(RW, N_COG, r - 2.6, r + 2.8, cogPhase) + holePath(RW, 8.6));

    // Спайдер звезды: пять лучей, один из них совпадает с шатуном.
    var sp = $('spider'), k, a, q;
    for (k = 0; k < 5; k++) {
      a = k * TAU / 5;
      q = pol(BB, 46, a);
      mk('line', { x1: BB.x, y1: BB.y, x2: f(q.x), y2: f(q.y), stroke: '#0b1016', 'stroke-width': 11, 'stroke-linecap': 'round' }, sp);
    }
    for (k = 0; k < 5; k++) {
      a = k * TAU / 5;
      q = pol(BB, 46, a);
      mk('line', { x1: BB.x, y1: BB.y, x2: f(q.x), y2: f(q.y), stroke: '#cfdbe9', 'stroke-width': 7, 'stroke-linecap': 'round' }, sp);
    }
    mk('circle', { cx: BB.x, cy: BB.y, r: 17, fill: '#dfe8f3', stroke: '#0b1016', 'stroke-width': 2 }, sp);
    for (k = 0; k < 5; k++) {
      q = pol(BB, 34, k * TAU / 5);
      mk('circle', { cx: f(q.x), cy: f(q.y), r: 3, fill: '#0b1016', stroke: '#e8eff7', 'stroke-width': 1.2 }, sp);
    }
    mk('circle', { cx: BB.x, cy: BB.y, r: 6, fill: '#0b1016', stroke: '#9fb2c9', 'stroke-width': 1.4 }, sp);

    // Облегчающие отверстия на задней звёздочке.
    var cg = $('cogRot');
    for (k = 0; k < 5; k++) {
      q = pol(RW, 11.8, cogPhase + k * TAU / 5);
      mk('circle', { cx: f(q.x), cy: f(q.y), r: 2.2, fill: '#0b1016' }, cg);
    }

    return { p: p, R: R, r: r, links: sol.links, wA: wA, wB: wB, D: D, L: 2 * straight + R * sw1 + r * sw2 };
  })();

  /* ---------------- подписи деталей ---------------- */
  // [текст, x цели, y цели, x подписи, y подписи, привязка: s начало / e конец / m центр]
  var LABELS = [
    ['Седло', 452, 112, 452, 72, 'm'],
    ['Верхняя труба', 620, 205, 620, 152, 'm'],
    ['Подседельная труба', 471, 238, 300, 198, 'e'],
    ['Задний тормоз', 424, 289, 300, 252, 'e'],
    ['Рулевая труба', 767, 232, 1000, 232, 's'],
    ['Руль', 822, 222, 900, 262, 's'],
    ['Тормозная ручка', 896, 188, 1000, 182, 's'],
    ['Вилка', 833, 418, 1010, 372, 's'],
    ['Цепь', 430, 527, 470, 596, 'm'],
    ['Ведущая звезда', 599, 548, 612, 606, 's'],
    ['Каретка', 553, 518, 545, 628, 'm'],
    ['Звёздочка', 330, 486, 300, 612, 'm'],
    ['Спицы', 935, 555, 1010, 600, 's']
  ];
  (function buildLabels() {
    var g = $('labels');
    LABELS.forEach(function (L) {
      var anchor = L[5] === 's' ? 'start' : L[5] === 'e' ? 'end' : 'middle';
      var tx = L[3], ty = L[4] + 4.5;
      if (L[5] === 's') { tx += 6; }
      if (L[5] === 'e') { tx -= 6; }
      if (L[5] === 'm') { ty = L[4] < L[2] ? L[4] - 6 : L[4] + 16; }
      mk('line', { x1: L[1], y1: L[2], x2: L[3], y2: L[4] }, g);
      mk('circle', { cx: L[1], cy: L[2], r: 3.2 }, g);
      var t = mk('text', { x: tx, y: ty, 'text-anchor': anchor }, g);
      t.textContent = L[0];
    });
  })();

  /* ---------------- состояние и анимация ---------------- */
  var reduce = false;
  try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { reduce = false; }

  var state = {
    theta: -20 / DEG,   // угол ближнего шатуна, рад (по часовой стрелке на экране)
    cad: 0,             // текущий каденс, об/мин
    brake: 0,           // степень торможения 0..1
    held: false,
    playing: !reduce,
    dirty: true
  };

  var el = {
    ringRot: $('ringRot'), cogRot: $('cogRot'),
    crankNear: $('crankNear'), pedalNear: $('pedalNear'),
    crankFar: $('crankFar'), pedalFar: $('pedalFar'),
    chainA: $('chainA'), chainB: $('chainB'), chainPins: $('chainPins'),
    rwRot: $('rwRot'), fwRot: $('fwRot'),
    marks1: $('marks1'), marks2: $('marks2'), grid: $('grid'),
    leverF: $('leverF'), calF: $('calF'), calR: $('calR'), padF: $('padF'), padR: $('padR'),
    cableF: $('cableF'), cableR: $('cableR'),
    stat: $('stat'), rng: $('rngSpeed'), out: $('outSpeed'),
    play: $('btnPlay'), brake: $('btnBrake'), tri: $('tri'), labels: $('labels'),
    chkTri: $('chkTri'), chkLab: $('chkLab')
  };

  var CRANK = 92;
  var PAD_IDLE = [170, 185, 204], PAD_HOT = [255, 106, 77];
  function mix(a, b, t) {
    return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); }).join(',') + ')';
  }

  function render() {
    var th = state.theta, deg = th * DEG, b = state.brake;
    var bbT = 'translate(' + BB.x + ' ' + BB.y + ') rotate(' + f(deg) + ')';

    el.ringRot.setAttribute('transform', 'rotate(' + f(deg) + ' ' + BB.x + ' ' + BB.y + ')');
    el.crankNear.setAttribute('transform', bbT);
    el.pedalNear.setAttribute('transform', 'translate(' + CRANK + ' 0) rotate(' + f(-deg) + ')');
    el.crankFar.setAttribute('transform', 'translate(' + BB.x + ' ' + BB.y + ') rotate(' + f(deg + 180) + ')');
    el.pedalFar.setAttribute('transform', 'translate(' + CRANK + ' 0) rotate(' + f(-(deg + 180)) + ')');

    // Путь цепи вдоль контура = угол звезды * её шаговый радиус.
    var s = th * drive.R;
    el.chainA.setAttribute('stroke-dashoffset', f(pmod(-(s + drive.wA / 2), 2 * drive.p)));
    el.chainB.setAttribute('stroke-dashoffset', f(pmod(-(s + drive.p + drive.wB / 2), 2 * drive.p)));
    el.chainPins.setAttribute('stroke-dashoffset', f(pmod(-s, drive.p)));

    // Звёздочка и колесо вращаются одинаково: угол = путь цепи / радиус звёздочки.
    var cogAng = s / drive.r;
    var wheelDeg = pmod(cogAng * DEG, 360);
    el.cogRot.setAttribute('transform', 'rotate(' + f(pmod(cogAng * DEG, 360)) + ' ' + RW.x + ' ' + RW.y + ')');
    el.rwRot.setAttribute('transform', 'rotate(' + f(wheelDeg) + ')');
    el.fwRot.setAttribute('transform', 'rotate(' + f(wheelDeg + 13) + ')');

    // Земля едет назад со скоростью обода; дальний план медленнее.
    var dist = cogAng * TYRE_R;
    el.marks1.setAttribute('stroke-dashoffset', f(pmod(dist, 546)));
    el.marks2.setAttribute('stroke-dashoffset', f(pmod(dist * 1.35, 580)));
    el.grid.setAttribute('patternTransform', 'translate(' + f(-pmod(dist * 0.2, 48)) + ' 0)');

    // Тормоз: рычаг, колодки идут к ободу и краснеют, трос натягивается.
    el.leverF.setAttribute('transform', 'rotate(' + f(b * 11) + ' 886 163)');
    el.calF.setAttribute('transform', 'translate(' + f(0.42 * 4.5 * b) + ' ' + f(0.907 * 4.5 * b) + ')');
    el.calR.setAttribute('transform', 'translate(' + f(-0.46 * 4.5 * b) + ' ' + f(0.886 * 4.5 * b) + ')');
    var hot = mix(PAD_IDLE, PAD_HOT, b);
    el.padF.setAttribute('fill', hot);
    el.padR.setAttribute('fill', hot);
    var cw = f(1.9 + 0.9 * b), cc = mix([143, 160, 182], [255, 190, 150], b);
    el.cableF.setAttribute('stroke-width', cw);
    el.cableR.setAttribute('stroke-width', cw);
    el.cableF.setAttribute('stroke', cc);
    el.cableR.setAttribute('stroke', cc);
  }

  var statClock = 0;
  function updateStat(force) {
    var now = Date.now();
    if (!force && now - statClock < 220) { return; }
    statClock = now;
    var kmh = state.cad * TAU / 60 * (N_RING / N_COG) * WHEEL_M * 3.6;
    el.stat.textContent = N_RING + '/' + N_COG + ' · цепь ' + drive.links + ' ' + plural(drive.links) +
      ' · ' + state.cad.toFixed(0) + ' об/мин · ' + kmh.toFixed(1).replace('.', ',') + ' км/ч';
  }
  function plural(n) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) { return 'звено'; }
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) { return 'звена'; }
    return 'звеньев';
  }

  var last = null;
  function frame(t) {
    var dt = last === null ? 1 / 60 : (t - last) / 1000;
    last = t;
    if (!(dt > 0)) { dt = 1 / 60; }
    if (dt > 0.05) { dt = 0.05; }   // после вкладки в фоне не прыгаем

    var slider = Number(el.rng.value);
    var target = (state.playing && !state.held) ? slider : 0;
    var rate = state.held ? 5.5 : 1.3;
    var prevCad = state.cad, prevBrake = state.brake;
    state.cad += (target - state.cad) * (1 - Math.exp(-rate * dt));
    if (target === 0 && state.cad < 0.03) { state.cad = 0; }
    state.theta += state.cad * TAU / 60 * dt;
    state.brake += ((state.held ? 1 : 0) - state.brake) * (1 - Math.exp(-14 * dt));
    if (Math.abs(state.brake) < 0.002) { state.brake = 0; }

    if (state.cad !== 0 || prevCad !== 0 || prevBrake !== state.brake || state.dirty) {
      render();
      state.dirty = false;
    }
    updateStat(false);
    requestAnimationFrame(frame);
  }

  /* ---------------- управление ---------------- */
  function setPlaying(v) {
    state.playing = v;
    el.play.textContent = v ? 'Пауза' : 'Пуск';
  }
  function setHeld(v) {
    state.held = v;
    el.brake.classList.toggle('held', v);
  }
  function setOn(node, chk, v) {
    node.classList.toggle('on', v);
    chk.checked = v;
  }

  el.play.addEventListener('click', function () { setPlaying(!state.playing); });
  el.rng.addEventListener('input', function () {
    el.out.textContent = el.rng.value + ' об/мин';
    if (!state.playing && Number(el.rng.value) > 0) { setPlaying(true); }
  });
  el.chkTri.addEventListener('change', function () { setOn(el.tri, el.chkTri, el.chkTri.checked); });
  el.chkLab.addEventListener('change', function () { setOn(el.labels, el.chkLab, el.chkLab.checked); });

  el.brake.addEventListener('pointerdown', function (e) {
    try { el.brake.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    setHeld(true);
    e.preventDefault();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) {
    el.brake.addEventListener(name, function () { setHeld(false); });
  });
  el.brake.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  window.addEventListener('keydown', function (e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) { return; }
    var tag = e.target && e.target.tagName;
    if (e.code === 'KeyB') { setHeld(true); }
    else if (e.code === 'Space' && tag !== 'BUTTON' && tag !== 'INPUT') { e.preventDefault(); setPlaying(!state.playing); }
    else if (e.code === 'KeyL') { setOn(el.labels, el.chkLab, !el.labels.classList.contains('on')); }
    else if (e.code === 'KeyT') { setOn(el.tri, el.chkTri, !el.tri.classList.contains('on')); }
  });
  window.addEventListener('keyup', function (e) {
    if (e.code === 'KeyB') { setHeld(false); }
  });
  window.addEventListener('blur', function () { setHeld(false); });

  // Начальное состояние интерфейса.
  el.out.textContent = el.rng.value + ' об/мин';
  el.play.textContent = state.playing ? 'Пауза' : 'Пуск';
  render();
  updateStat(true);
  requestAnimationFrame(frame);
})();
