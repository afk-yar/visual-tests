/* main.js — цикл анимации, DPR-холст, связь с UI. */
(function () {
  'use strict';

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var walker = new Gait.Walker(1.4);
  var opts = { paused: false, slow: false, traj: false, phases: true };
  var dpr = 1, W = 1, H = 1;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    World.layout(ctx, W, H);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- UI ----------
  function $(id) { return document.getElementById(id); }
  var speed = $('speed'), speedOut = $('speedOut'), badge = $('gaitBadge');
  var vMin = parseFloat(speed.min), vMax = parseFloat(speed.max);

  var zone = $('zone');
  zone.style.left = ((Gait.V_WALK_END - vMin) / (vMax - vMin) * 100) + '%';
  zone.style.width = ((Gait.V_RUN_FULL - Gait.V_WALK_END) / (vMax - vMin) * 100) + '%';

  function paintSlider() {
    var p = (parseFloat(speed.value) - vMin) / (vMax - vMin) * 100;
    speed.style.setProperty('--p', p.toFixed(2) + '%');
  }
  function setSpeed(v) {
    v = Math.max(vMin, Math.min(vMax, v));
    speed.value = v.toFixed(2);
    walker.setTarget(v);
    paintSlider();
  }
  speed.addEventListener('input', function () {
    walker.setTarget(parseFloat(speed.value));
    paintSlider();
  });
  paintSlider();

  function toggle(btn, key, onText, offText) {
    opts[key] = !opts[key];
    btn.setAttribute('aria-pressed', opts[key] ? 'true' : 'false');
    if (onText) btn.textContent = opts[key] ? onText : offText;
  }
  var btnPause = $('btnPause'), btnSlow = $('btnSlow'), btnTraj = $('btnTraj'), btnPhases = $('btnPhases');
  btnPause.addEventListener('click', function () { toggle(btnPause, 'paused', 'Продолжить', 'Пауза'); });
  btnSlow.addEventListener('click', function () { toggle(btnSlow, 'slow'); });
  btnTraj.addEventListener('click', function () {
    toggle(btnTraj, 'traj');
    $('legend').hidden = !opts.traj;
  });
  btnPhases.addEventListener('click', function () { toggle(btnPhases, 'phases'); });

  var presets = document.querySelectorAll('[data-v]');
  for (var i = 0; i < presets.length; i++) {
    presets[i].addEventListener('click', function (e) { setSpeed(parseFloat(e.currentTarget.getAttribute('data-v'))); });
  }

  window.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    var step = e.shiftKey ? 0.5 : 0.1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      if (e.target !== speed) { setSpeed(parseFloat(speed.value) + step); e.preventDefault(); }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      if (e.target !== speed) { setSpeed(parseFloat(speed.value) - step); e.preventDefault(); }
    } else if (e.key === ' ') { btnPause.click(); e.preventDefault(); }
    else if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') btnSlow.click();
    else if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') btnTraj.click();
    else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') btnPhases.click();
    else if (e.key >= '1' && e.key <= '4') presets[+e.key - 1].click();
  });

  var hud = {
    cad: $('stCad'), step: $('stStep'), duty: $('stDuty'),
    supL: $('stSupL'), sup: $('stSup'), slip: $('stSlip'), dist: $('stDist')
  };
  var lastBadge = '';
  function updateHud() {
    var s = walker.stats();
    speedOut.textContent = s.v.toFixed(2) + ' м/с · ' + s.kmh.toFixed(1) + ' км/ч';
    hud.cad.textContent = Math.round(s.cadence) + ' шаг/мин';
    hud.step.textContent = s.step.toFixed(2) + ' м';
    hud.duty.textContent = Math.round(s.duty * 100) + ' % цикла';
    if (s.double > 0.005) { hud.supL.textContent = 'Двойная опора'; hud.sup.textContent = Math.round(s.double * 100) + ' %'; }
    else if (s.flight > 0.005) { hud.supL.textContent = 'Фаза полёта'; hud.sup.textContent = Math.round(s.flight * 100) + ' %'; }
    else { hud.supL.textContent = 'Двойная опора'; hud.sup.textContent = '0 %'; }
    hud.slip.textContent = s.slipMm.toFixed(2) + ' мм';
    hud.dist.textContent = s.dist.toFixed(0) + ' м';
    var b = s.g < 0.08 ? 'walk' : (s.g > 0.92 ? 'run' : 'mix');
    if (b !== lastBadge) {
      lastBadge = b;
      badge.className = 'badge ' + b;
      badge.textContent = b === 'walk' ? 'ходьба' : (b === 'run' ? 'бег' : 'переход');
    }
  }

  // ---------- цикл ----------
  function render(t) {
    var V = World.V;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    World.drawBack(ctx, walker, t);
    Figure.drawShadows(ctx, walker, V);
    if (opts.traj) Figure.drawTraj(ctx, walker, V);
    Figure.drawFigure(ctx, walker, V, dpr);
    if (opts.traj) Figure.drawContacts(ctx, walker, V);
    World.drawForeground(ctx, walker.s);
    if (opts.phases) Figure.drawPhases(ctx, walker, V);
  }

  var last = performance.now(), hudT = 0;
  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;               // кламп: вкладка в фоне, лаги
    if (!opts.paused && dt > 0) {
      var sdt = dt * (opts.slow ? 0.25 : 1);
      var n = Math.max(1, Math.ceil(sdt / (1 / 120)));
      for (var k = 0; k < n; k++) walker.update(sdt / n);
      walker.record();
    }
    render(now / 1000);
    if (now - hudT > 110) { hudT = now; updateHud(); }
    requestAnimationFrame(frame);
  }
  updateHud();
  requestAnimationFrame(frame);
})();
