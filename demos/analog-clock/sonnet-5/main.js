// Аналоговые настенные часы: рендер на canvas по системному времени.
// Чистая математика углов стрелок вынесена в clock.js (window.Clock).
(function () {
  'use strict';

  var canvas = document.getElementById('clock-canvas');
  var ctx = canvas.getContext('2d');
  var digitalEl = document.getElementById('digital');
  var segButtons = Array.prototype.slice.call(document.querySelectorAll('.segment'));

  // Статический слой (фон, тень корпуса, безель, циферблат, деления, числа)
  // перерисовывается только при ресайзе — на каждый кадр он просто
  // блитится, а не пересчитывается заново (дешевле для requestAnimationFrame).
  var staticCanvas = document.createElement('canvas');
  var staticCtx = staticCanvas.getContext('2d');

  var secondMode = 'sweep'; // 'sweep' | 'tick'

  function setMode(mode) {
    secondMode = mode;
    segButtons.forEach(function (btn) {
      var active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  segButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setMode(btn.dataset.mode);
    });
  });

  setMode('sweep');

  var width = 0;
  var height = 0;
  var dpr = 1;

  function getGeometry() {
    var cx = width / 2;
    var cy = height / 2;
    var R = Math.min(width, height) * 0.42;
    return { cx: cx, cy: cy, R: R };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;

    var pw = Math.max(1, Math.round(width * dpr));
    var ph = Math.max(1, Math.round(height * dpr));

    canvas.width = pw;
    canvas.height = ph;
    staticCanvas.width = pw;
    staticCanvas.height = ph;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderStatic();
  }

  window.addEventListener('resize', resize);

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  // ---------------------------------------------------------------------
  // Статичная часть: фон, тень, металлический безель, циферблат, деления, числа
  // ---------------------------------------------------------------------

  function renderStatic() {
    var geo = getGeometry();
    var c = staticCtx;

    c.clearRect(0, 0, width, height);
    drawBackground(c, width, height, geo.cx, geo.cy);
    drawBodyShadow(c, geo.cx, geo.cy, geo.R);
    drawBezel(c, geo.cx, geo.cy, geo.R);
    drawDial(c, geo.cx, geo.cy, geo.R);
    drawTicks(c, geo.cx, geo.cy, geo.R);
    drawNumbers(c, geo.cx, geo.cy, geo.R);
  }

  function drawBackground(c, w, h, cx, cy) {
    var g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.75);
    g.addColorStop(0, '#262931');
    g.addColorStop(0.6, '#1b1d23');
    g.addColorStop(1, '#101114');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }

  function drawBodyShadow(c, cx, cy, R) {
    c.save();
    c.filter = 'blur(' + Math.max(6, R * 0.05) + 'px)';
    c.beginPath();
    c.ellipse(cx + R * 0.05, cy + R * 0.09, R * 1.02, R * 1.0, 0, 0, Math.PI * 2);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fill();
    c.restore();
  }

  function drawBezel(c, cx, cy, R) {
    // тёмная окантовка по внешнему краю
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    var rim = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    rim.addColorStop(0, '#4a3512');
    rim.addColorStop(0.5, '#8a6a2c');
    rim.addColorStop(1, '#2e2109');
    c.fillStyle = rim;
    c.fill();

    // основной металлический обод (латунь) с бликом сверху-слева
    c.beginPath();
    c.arc(cx, cy, R * 0.97, 0, Math.PI * 2);
    var metal = c.createRadialGradient(
      cx - R * 0.35, cy - R * 0.4, R * 0.1,
      cx, cy, R * 0.97
    );
    metal.addColorStop(0, '#f4e2ab');
    metal.addColorStop(0.25, '#d9b96a');
    metal.addColorStop(0.55, '#a9822f');
    metal.addColorStop(0.8, '#7a5b1f');
    metal.addColorStop(1, '#4c3712');
    c.fillStyle = metal;
    c.fill();

    // тонкие концентрические штрихи — эффект шлифованного металла
    c.save();
    c.beginPath();
    c.arc(cx, cy, R * 0.97, 0, Math.PI * 2);
    c.clip();
    c.strokeStyle = 'rgba(255,255,255,0.07)';
    c.lineWidth = 0.6;
    for (var i = 0; i < 36; i++) {
      var rr = R * (0.86 + 0.11 * (i / 36));
      c.beginPath();
      c.arc(cx, cy, rr, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();
  }

  function drawDial(c, cx, cy, R) {
    var Rd = R * 0.86;
    c.beginPath();
    c.arc(cx, cy, Rd, 0, Math.PI * 2);
    var face = c.createRadialGradient(
      cx - Rd * 0.2, cy - Rd * 0.25, Rd * 0.1,
      cx, cy, Rd
    );
    face.addColorStop(0, '#fbf6e8');
    face.addColorStop(0.7, '#f3ecd9');
    face.addColorStop(1, '#e3d8bd');
    c.fillStyle = face;
    c.fill();

    c.beginPath();
    c.arc(cx, cy, Rd * 0.995, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(90,70,30,0.35)';
    c.lineWidth = Math.max(1, R * 0.006);
    c.stroke();
  }

  function drawTicks(c, cx, cy, R) {
    c.save();
    c.translate(cx, cy);
    for (var i = 0; i < 60; i++) {
      var isHour = i % 5 === 0;
      var angle = (i / 60) * Math.PI * 2;
      c.save();
      c.rotate(angle);
      var outer = R * 0.83;
      var inner = isHour ? R * 0.715 : R * 0.78;
      c.beginPath();
      c.moveTo(0, -outer);
      c.lineTo(0, -inner);
      c.strokeStyle = isHour ? '#2c2410' : 'rgba(44,36,16,0.55)';
      c.lineWidth = isHour ? R * 0.015 : R * 0.006;
      c.lineCap = 'round';
      c.stroke();
      c.restore();
    }
    c.restore();
  }

  function drawNumbers(c, cx, cy, R) {
    var Rn = R * 0.6;
    c.save();
    c.fillStyle = '#241d0c';
    c.font = '600 ' + Math.round(R * 0.13) + 'px Georgia, "Times New Roman", serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (var n = 1; n <= 12; n++) {
      var angle = (n / 12) * Math.PI * 2;
      var x = cx + Math.sin(angle) * Rn;
      var y = cy - Math.cos(angle) * Rn;
      c.fillText(String(n), x, y);
    }
    c.restore();
  }

  // ---------------------------------------------------------------------
  // Динамическая часть: стрелки, ось-гайка, блик стекла
  // ---------------------------------------------------------------------

  function drawTaperedHand(c, cx, cy, angleRad, o) {
    function buildPath(ctx2) {
      ctx2.beginPath();
      ctx2.moveTo(0, o.tail);
      ctx2.lineTo(o.baseWidth / 2, o.tail * 0.35);
      ctx2.lineTo(o.tipWidth / 2, -o.length * 0.82);
      ctx2.lineTo(0, -o.length);
      ctx2.lineTo(-o.tipWidth / 2, -o.length * 0.82);
      ctx2.lineTo(-o.baseWidth / 2, o.tail * 0.35);
      ctx2.closePath();
    }

    // мягкая тень стрелки — в мировых координатах, с блюром
    c.save();
    c.filter = 'blur(' + o.shadowBlur + 'px)';
    c.translate(cx + o.shadowOffset, cy + o.shadowOffset * 1.3);
    c.rotate(angleRad);
    buildPath(c);
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fill();
    c.restore();

    // сама стрелка
    c.save();
    c.translate(cx, cy);
    c.rotate(angleRad);
    buildPath(c);
    var grad = c.createLinearGradient(0, -o.length, 0, o.tail);
    grad.addColorStop(0, o.colorTip);
    grad.addColorStop(1, o.colorBase);
    c.fillStyle = grad;
    c.fill();
    c.lineWidth = Math.max(0.5, o.length * 0.01);
    c.strokeStyle = o.strokeColor;
    c.stroke();
    c.restore();
  }

  function drawHourHand(c, cx, cy, R, angleRad) {
    drawTaperedHand(c, cx, cy, angleRad, {
      length: R * 0.5,
      tail: R * 0.09,
      baseWidth: R * 0.05,
      tipWidth: R * 0.022,
      colorTip: '#3a3225',
      colorBase: '#171410',
      strokeColor: 'rgba(0,0,0,0.5)',
      shadowOffset: R * 0.018,
      shadowBlur: R * 0.02
    });
  }

  function drawMinuteHand(c, cx, cy, R, angleRad) {
    drawTaperedHand(c, cx, cy, angleRad, {
      length: R * 0.74,
      tail: R * 0.1,
      baseWidth: R * 0.036,
      tipWidth: R * 0.014,
      colorTip: '#413825',
      colorBase: '#171410',
      strokeColor: 'rgba(0,0,0,0.5)',
      shadowOffset: R * 0.016,
      shadowBlur: R * 0.018
    });
  }

  function drawSecondHand(c, cx, cy, R, angleRad) {
    var length = R * 0.8;
    var tail = R * 0.16;
    var w = Math.max(1.2, R * 0.008);

    function buildPath(ctx2) {
      ctx2.beginPath();
      ctx2.moveTo(-w / 2, tail);
      ctx2.lineTo(w / 2, tail);
      ctx2.lineTo(w / 2, -length);
      ctx2.lineTo(-w / 2, -length);
      ctx2.closePath();
    }

    c.save();
    c.filter = 'blur(' + (R * 0.014) + 'px)';
    c.translate(cx + R * 0.012, cy + R * 0.016);
    c.rotate(angleRad);
    buildPath(c);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fill();
    c.beginPath();
    c.arc(0, tail * 0.65, R * 0.05, 0, Math.PI * 2);
    c.fill();
    c.restore();

    c.save();
    c.translate(cx, cy);
    c.rotate(angleRad);
    buildPath(c);
    c.fillStyle = '#b23a2e';
    c.fill();

    c.beginPath();
    c.arc(0, tail * 0.65, R * 0.045, 0, Math.PI * 2);
    c.fillStyle = '#b23a2e';
    c.fill();
    c.strokeStyle = '#7a2018';
    c.lineWidth = Math.max(0.6, R * 0.006);
    c.stroke();

    c.beginPath();
    c.arc(0, -length * 0.72, R * 0.026, 0, Math.PI * 2);
    c.strokeStyle = '#b23a2e';
    c.lineWidth = Math.max(0.8, R * 0.008);
    c.stroke();
    c.restore();
  }

  function drawHub(c, cx, cy, R) {
    var r = R * 0.045;

    c.save();
    c.filter = 'blur(' + (R * 0.01) + 'px)';
    c.beginPath();
    c.arc(cx + R * 0.01, cy + R * 0.014, r * 1.1, 0, Math.PI * 2);
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fill();
    c.restore();

    c.save();
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    var g = c.createRadialGradient(cx - r * 0.4, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#f4e2ab');
    g.addColorStop(0.5, '#b8912f');
    g.addColorStop(1, '#5a4116');
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = '#2c2008';
    c.lineWidth = Math.max(0.6, r * 0.12);
    c.stroke();

    // шестигранная гайка
    c.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = (Math.PI / 3) * i - Math.PI / 6;
      var px = cx + Math.cos(a) * r * 0.55;
      var py = cy + Math.sin(a) * r * 0.55;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
    c.fillStyle = '#241c0a';
    c.fill();

    c.beginPath();
    c.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
    c.fillStyle = '#0d0a04';
    c.fill();
    c.restore();
  }

  function drawGlassGlare(c, cx, cy, R) {
    c.save();
    c.beginPath();
    c.arc(cx, cy, R * 0.995, 0, Math.PI * 2);
    c.clip();

    var g = c.createRadialGradient(
      cx - R * 0.35, cy - R * 0.45, R * 0.05,
      cx - R * 0.1, cy - R * 0.1, R * 1.1
    );
    g.addColorStop(0, 'rgba(255,255,255,0.20)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.045)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(cx - R, cy - R, R * 2, R * 2);

    c.beginPath();
    c.ellipse(cx - R * 0.28, cy - R * 0.3, R * 0.55, R * 0.14, -Math.PI / 5, 0, Math.PI * 2);
    var streak = c.createLinearGradient(cx - R * 0.6, cy - R * 0.6, cx, cy);
    streak.addColorStop(0, 'rgba(255,255,255,0.16)');
    streak.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = streak;
    c.fill();

    c.restore();
  }

  // ---------------------------------------------------------------------
  // Механический тик секундной стрелки (лёгкий перелёт цели + возврат)
  // ---------------------------------------------------------------------

  var TICK_DURATION = 220; // мс
  var tickState = null; // { prevDeg, targetDeg, startTime, wholeSecond }

  function getSecondDegForFrame(now, secDegContinuous, secWhole) {
    if (secondMode === 'sweep') return secDegContinuous;

    if (!tickState) {
      var deg0 = secWhole * 6;
      tickState = { prevDeg: deg0, targetDeg: deg0, startTime: now - TICK_DURATION, wholeSecond: secWhole };
    } else if (secWhole !== tickState.wholeSecond) {
      var restDeg = tickState.targetDeg;
      var newTarget = Math.floor(restDeg / 360) * 360 + secWhole * 6;
      while (newTarget < restDeg) newTarget += 360;
      tickState.prevDeg = restDeg;
      tickState.targetDeg = newTarget;
      tickState.startTime = now;
      tickState.wholeSecond = secWhole;

      // держим значения в разумных пределах, чтобы не расти бесконечно
      if (tickState.targetDeg >= 360) {
        tickState.prevDeg -= 360;
        tickState.targetDeg -= 360;
      }
    }

    var elapsed = now - tickState.startTime;
    if (elapsed >= TICK_DURATION) return tickState.targetDeg;

    var p = elapsed / TICK_DURATION;
    var eased = window.Clock.easeOutBack(p);
    return tickState.prevDeg + (tickState.targetDeg - tickState.prevDeg) * eased;
  }

  // ---------------------------------------------------------------------
  // Основной цикл рендера
  // ---------------------------------------------------------------------

  var lastDigital = '';

  function render(now) {
    // блит статичного слоя (без масштабирования — оба канваса в device px)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticCanvas, 0, 0);
    ctx.restore();

    var geo = getGeometry();
    var d = new Date();
    var hh = d.getHours();
    var mm = d.getMinutes();
    var ss = d.getSeconds();
    var msc = d.getMilliseconds();

    var text = pad2(hh) + ':' + pad2(mm) + ':' + pad2(ss);
    if (text !== lastDigital) {
      digitalEl.textContent = text;
      lastDigital = text;
    }

    var angles = window.Clock.computeAngles(hh, mm, ss, msc);
    var secDegRender = getSecondDegForFrame(now, angles.secondDeg, ss);

    var hourRad = window.Clock.degToRad(angles.hourDeg);
    var minuteRad = window.Clock.degToRad(angles.minuteDeg);
    var secondRad = window.Clock.degToRad(secDegRender);

    drawHourHand(ctx, geo.cx, geo.cy, geo.R, hourRad);
    drawMinuteHand(ctx, geo.cx, geo.cy, geo.R, minuteRad);
    drawSecondHand(ctx, geo.cx, geo.cy, geo.R, secondRad);
    drawHub(ctx, geo.cx, geo.cy, geo.R);
    drawGlassGlare(ctx, geo.cx, geo.cy, geo.R);
  }

  function loop(now) {
    render(now);
    requestAnimationFrame(loop);
  }

  resize();
  requestAnimationFrame(loop);
})();
