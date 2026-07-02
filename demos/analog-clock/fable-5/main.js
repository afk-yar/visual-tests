/* «Аналоговые часы» — Claude Fable 5
 *
 * Настенные часы на canvas без библиотек: точёный металлический обод,
 * кремовый циферблат, стекло с бликами, три стрелки с мягкими тенями,
 * латунная ось-гайка. Реальное системное время.
 *
 * Устройство:
 *  - Статичные слои (стена+корпус+циферблат и стеклянные блики) кэшируются
 *    в offscreen-канвасы и перерисовываются только при resize / смене DPR.
 *  - Стрелки рисуются каждый кадр. Часовая учитывает минуты и секунды,
 *    минутная — секунды и миллисекунды: ход непрерывный, без скачков.
 *  - Секундная стрелка — единая пружинная модель (полунеявный Эйлер,
 *    dt-интегрирование с клампом и подшагами):
 *      режим «тик»   — цель скачет по целым секундам -> механический тик
 *                      с лёгким отскоком (недодемпфированная пружина);
 *      режим «sweep» — цель непрерывна -> плавный ход (отставание пружины
 *                      ~0.13°, глазу не видно). Переключение режимов за счёт
 *                      общей пружины происходит без рывка.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  var canvas = document.getElementById('clock');
  var ctx = canvas.getContext('2d');

  // --- Состояние вывода ---
  var dpr = 0;                // devicePixelRatio с потолком 2
  var cssW = 0, cssH = 0;     // размер окна в CSS-пикселях
  var cx = 0, cy = 0, R = 100; // центр и радиус корпуса (CSS-пиксели)
  var dialLayer = document.createElement('canvas');  // стена + корпус + циферблат
  var glassLayer = document.createElement('canvas'); // блики стекла (поверх стрелок)

  // --- Секундная стрелка: пружина ---
  var mode = 'tick';          // 'tick' | 'sweep'
  var secAngle = 0;           // отображаемый угол, рад (0 = «12», по часовой)
  var secVel = 0;             // угловая скорость, рад/с
  var secReady = false;
  var lastT = 0;
  var SPRING_K = 1156;        // жёсткость: omega = 34 рад/с
  var SPRING_C = 26;          // демпфирование: zeta ~ 0.38 -> отскок ~27% шага

  // ---------------------------------------------------------------- утилиты

  function circle(g, x, y, r) {
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
  }

  // Кратчайшая угловая разница a-b в диапазоне (-PI, PI] — корректно
  // обрабатывает переход 59-й секунды в 0-ю.
  function angleDiff(a, b) {
    var d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    else if (d < -Math.PI) d += TAU;
    return d;
  }

  // Целевой угол секундной стрелки в зависимости от режима.
  function secondTarget(now) {
    if (mode === 'sweep') {
      return TAU * (now.getSeconds() + now.getMilliseconds() / 1000) / 60;
    }
    return TAU * now.getSeconds() / 60;
  }

  // Тени: shadowOffset/shadowBlur не подчиняются трансформации контекста,
  // поэтому масштабируем их вручную (под размер часов и DPR).
  function setShadow(g, x, y, blur, alpha) {
    var u = (R / 300) * dpr;
    g.shadowColor = 'rgba(25, 20, 12, ' + alpha + ')';
    g.shadowOffsetX = x * u;
    g.shadowOffsetY = y * u;
    g.shadowBlur = blur * u;
  }

  // «Точёный металл»: конический градиент с чередованием бликов и теней;
  // запасной вариант — диагональный линейный градиент.
  function metalGradient(g, rot) {
    var stops = [
      [0.00, '#eef1f4'], [0.09, '#9aa2aa'], [0.16, '#d9dde1'],
      [0.27, '#71787f'], [0.38, '#cfd4d9'], [0.50, '#f4f6f8'],
      [0.60, '#868e96'], [0.72, '#dde1e5'], [0.83, '#767e86'],
      [0.93, '#c8cdd2'], [1.00, '#eef1f4']
    ];
    var grad, i;
    if (g.createConicGradient) {
      grad = g.createConicGradient(rot, cx, cy);
      for (i = 0; i < stops.length; i++) grad.addColorStop(stops[i][0], stops[i][1]);
      return grad;
    }
    grad = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    grad.addColorStop(0, '#eef1f4');
    grad.addColorStop(0.35, '#8d959d');
    grad.addColorStop(0.5, '#f2f4f6');
    grad.addColorStop(0.7, '#71787f');
    grad.addColorStop(1, '#c8cdd2');
    return grad;
  }

  function tickRect(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
    g.fill();
  }

  // ------------------------------------------------- статичный слой: корпус

  function buildDial() {
    dialLayer.width = canvas.width;
    dialLayer.height = canvas.height;
    var g = dialLayer.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Стена с мягким верхним светом и виньеткой
    var wall = g.createRadialGradient(
      cx - R * 0.4, cy - R * 0.9, R * 0.1,
      cx, cy, Math.max(cssW, cssH) * 0.72
    );
    wall.addColorStop(0, '#e6e0d4');
    wall.addColorStop(0.55, '#cbc5b6');
    wall.addColorStop(1, '#a8a191');
    g.fillStyle = wall;
    g.fillRect(0, 0, cssW, cssH);

    // Тень корпуса на стене
    g.save();
    g.shadowColor = 'rgba(30, 26, 18, 0.42)';
    g.shadowBlur = R * 0.14 * dpr;
    g.shadowOffsetY = R * 0.06 * dpr;
    circle(g, cx, cy, R);
    g.fillStyle = '#565b61';
    g.fill();
    g.restore();

    // Обод из точёного металла + фаска (тот же градиент, повёрнутый на PI)
    circle(g, cx, cy, R);
    g.fillStyle = metalGradient(g, -Math.PI / 2 + 0.35);
    g.fill();
    circle(g, cx, cy, R);
    g.strokeStyle = 'rgba(20, 22, 26, 0.45)';
    g.lineWidth = Math.max(1, R * 0.006);
    g.stroke();
    circle(g, cx, cy, R * 0.925);
    g.fillStyle = metalGradient(g, -Math.PI / 2 + 0.35 + Math.PI);
    g.fill();

    // Тёмное уплотнительное кольцо под стеклом
    circle(g, cx, cy, R * 0.888);
    g.fillStyle = '#202327';
    g.fill();

    // Кремовый циферблат
    var dial = g.createRadialGradient(
      cx - R * 0.15, cy - R * 0.22, R * 0.1,
      cx, cy, R * 0.9
    );
    dial.addColorStop(0, '#fbf7ec');
    dial.addColorStop(0.7, '#f3eddd');
    dial.addColorStop(1, '#e6dec7');
    circle(g, cx, cy, R * 0.868);
    g.fillStyle = dial;
    g.fill();

    // Внутренняя тень у края циферблата — глубина под стеклом
    var inner = g.createRadialGradient(cx, cy, R * 0.75, cx, cy, R * 0.868);
    inner.addColorStop(0, 'rgba(80, 66, 40, 0)');
    inner.addColorStop(1, 'rgba(80, 66, 40, 0.20)');
    circle(g, cx, cy, R * 0.868);
    g.fillStyle = inner;
    g.fill();

    drawTicks(g);
    drawNumbers(g);
    drawDialText(g);
  }

  function drawTicks(g) {
    g.save();
    g.translate(cx, cy);
    for (var i = 0; i < 60; i++) {
      g.save();
      g.rotate(TAU * i / 60);
      if (i % 5 === 0) {
        // часовое деление — крупное
        g.fillStyle = '#23252b';
        tickRect(g, -R * 0.011, -R * 0.842, R * 0.022, R * 0.072, R * 0.008);
      } else {
        // минутное деление — тонкое
        g.fillStyle = 'rgba(45, 47, 54, 0.8)';
        tickRect(g, -R * 0.0038, -R * 0.842, R * 0.0076, R * 0.04, R * 0.0035);
      }
      g.restore();
    }
    g.restore();
  }

  function drawNumbers(g) {
    g.save();
    g.translate(cx, cy);
    var size = R * 0.152;
    g.font = '600 ' + size.toFixed(2) + 'px Georgia, "Times New Roman", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#2b2c31';
    var rr = R * 0.655;
    for (var n = 1; n <= 12; n++) {
      var a = TAU * n / 12 - Math.PI / 2;
      g.fillText(String(n), Math.cos(a) * rr, Math.sin(a) * rr + size * 0.06);
    }
    g.restore();
  }

  function drawDialText(g) {
    g.save();
    g.translate(cx, cy);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(70, 64, 52, 0.78)';
    g.font = 'italic 600 ' + (R * 0.078).toFixed(2) + 'px Georgia, "Times New Roman", serif';
    g.fillText('Fable', 0, -R * 0.30);
    g.fillStyle = 'rgba(70, 64, 52, 0.55)';
    g.font = '500 ' + (R * 0.038).toFixed(2) + 'px Georgia, "Times New Roman", serif';
    g.fillText('Q U A R T Z', 0, R * 0.34);
    g.restore();
  }

  // ------------------------------------------------- статичный слой: стекло

  function buildGlass() {
    glassLayer.width = canvas.width;
    glassLayer.height = canvas.height;
    var g = glassLayer.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.save();
    circle(g, cx, cy, R * 0.885);
    g.clip();

    // Широкий мягкий блик сверху-слева
    g.save();
    g.translate(cx - R * 0.30, cy - R * 0.42);
    g.rotate(-0.6);
    g.scale(1, 0.62);
    var hl = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.85);
    hl.addColorStop(0, 'rgba(255, 255, 255, 0.13)');
    hl.addColorStop(0.6, 'rgba(255, 255, 255, 0.05)');
    hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
    circle(g, 0, 0, R * 0.85);
    g.fillStyle = hl;
    g.fill();
    g.restore();

    // Дуга-отражение у верхнего края
    g.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    g.lineWidth = R * 0.05;
    g.beginPath();
    g.arc(cx, cy, R * 0.815, -Math.PI * 0.82, -Math.PI * 0.38);
    g.stroke();

    // Слабое отражение снизу-справа
    g.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    g.lineWidth = R * 0.035;
    g.beginPath();
    g.arc(cx, cy, R * 0.83, Math.PI * 0.08, Math.PI * 0.34);
    g.stroke();

    g.restore();
  }

  // --------------------------------------------------------------- стрелки

  // Часовая/минутная: сужающийся «батон» с хвостиком-противовесом.
  function drawBaton(angle, len, baseW, tipW, tail, sx, sy, sb) {
    ctx.save();
    ctx.rotate(angle);
    setShadow(ctx, sx, sy, sb, 0.32);
    ctx.beginPath();
    ctx.moveTo(-baseW / 2, tail);
    ctx.lineTo(-tipW / 2, -len);
    ctx.lineTo(tipW / 2, -len);
    ctx.lineTo(baseW / 2, tail);
    ctx.closePath();
    ctx.fillStyle = '#1d1e23';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // скругление углов обводкой того же цвета
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1d1e23';
    ctx.lineWidth = Math.max(1, tipW * 0.7);
    ctx.stroke();
    // едва заметная продольная грань
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = Math.max(0.75, baseW * 0.14);
    ctx.beginPath();
    ctx.moveTo(0, tail * 0.55);
    ctx.lineTo(0, -len * 0.9);
    ctx.stroke();
    ctx.restore();
  }

  function drawSecondHand(angle) {
    ctx.save();
    ctx.rotate(angle);
    setShadow(ctx, 6, 10, 12, 0.30);
    ctx.fillStyle = '#b23530';
    ctx.beginPath();
    ctx.moveTo(-R * 0.008, R * 0.21);
    ctx.lineTo(-R * 0.0035, -R * 0.78);
    ctx.lineTo(R * 0.0035, -R * 0.78);
    ctx.lineTo(R * 0.008, R * 0.21);
    ctx.closePath();
    ctx.fill();
    // противовес
    circle(ctx, 0, R * 0.155, R * 0.026);
    ctx.fill();
    ctx.restore();
  }

  // Стальная шайба-ступица под стрелками
  function drawHub() {
    ctx.save();
    setShadow(ctx, 2, 4, 6, 0.35);
    var grad = ctx.createRadialGradient(-R * 0.015, -R * 0.015, R * 0.005, 0, 0, R * 0.055);
    grad.addColorStop(0, '#82898f');
    grad.addColorStop(0.55, '#43474c');
    grad.addColorStop(1, '#232529');
    circle(ctx, 0, 0, R * 0.052);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  // Красная втулка секундной стрелки + латунная ось-гайка (шестигранник)
  function drawNut() {
    ctx.save();
    circle(ctx, 0, 0, R * 0.021);
    ctx.fillStyle = '#b23530';
    ctx.fill();

    var gr = ctx.createLinearGradient(-R * 0.016, -R * 0.016, R * 0.016, R * 0.016);
    gr.addColorStop(0, '#efd28c');
    gr.addColorStop(0.5, '#c19a4f');
    gr.addColorStop(1, '#77571f');
    ctx.beginPath();
    var rn = R * 0.0145;
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 6 + i * Math.PI / 3;
      var x = Math.cos(a) * rn;
      var y = Math.sin(a) * rn;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.strokeStyle = 'rgba(50, 36, 8, 0.55)';
    ctx.lineWidth = Math.max(0.6, R * 0.0016);
    ctx.stroke();

    // точечный блик на гайке
    circle(ctx, -R * 0.004, -R * 0.004, R * 0.0035);
    ctx.fillStyle = 'rgba(255, 245, 220, 0.85)';
    ctx.fill();
    ctx.restore();
  }

  // ----------------------------------------------------------------- кадр

  function checkResize() {
    var w = Math.max(1, window.innerWidth);
    var h = Math.max(1, window.innerHeight);
    var p = Math.min(window.devicePixelRatio || 1, 2);
    if (w === cssW && h === cssH && p === dpr) return;
    cssW = w;
    cssH = h;
    dpr = p;
    canvas.width = Math.max(1, Math.round(w * p));
    canvas.height = Math.max(1, Math.round(h * p));
    cx = w / 2;
    cy = h / 2;
    R = Math.min(w, h) * 0.415;
    buildDial();
    buildGlass();
  }

  function updateSecond(now, dt) {
    var target = secondTarget(now);
    if (!secReady || dt > 0.5) {
      // первый кадр или возврат из фоновой вкладки — без «догонялок»
      secAngle = target;
      secVel = 0;
      secReady = true;
      return;
    }
    if (dt > 0.1) dt = 0.1; // кламп большого dt
    var steps = Math.max(1, Math.ceil(dt / 0.008));
    var h = dt / steps;
    for (var i = 0; i < steps; i++) {
      var diff = angleDiff(target, secAngle);
      secVel += (SPRING_K * diff - SPRING_C * secVel) * h;
      secAngle += secVel * h;
    }
  }

  function render(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(dialLayer, 0, 0);

    // Непрерывные углы: часовая учитывает минуты, минутная — секунды.
    var s = now.getSeconds() + now.getMilliseconds() / 1000;
    var m = now.getMinutes() + s / 60;
    var h = (now.getHours() % 12) + m / 60;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(cx, cy);
    drawHub();
    drawBaton(TAU * h / 12, R * 0.50, R * 0.055, R * 0.034, R * 0.115, 2.5, 4.5, 7);
    drawBaton(TAU * m / 60, R * 0.735, R * 0.042, R * 0.02, R * 0.135, 4, 7, 9);
    drawSecondHand(secAngle);
    drawNut();
    ctx.restore();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(glassLayer, 0, 0);
  }

  function frame(t) {
    requestAnimationFrame(frame);
    checkResize();
    var now = new Date();
    var dt = lastT > 0 ? (t - lastT) / 1000 : 0;
    lastT = t;
    updateSecond(now, dt);
    render(now);
  }

  // ------------------------------------------------------------ управление

  var btnTick = document.getElementById('mode-tick');
  var btnSweep = document.getElementById('mode-sweep');

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    secVel = 0; // пружина сама мягко доведёт стрелку к новой цели
    btnTick.setAttribute('aria-pressed', String(next === 'tick'));
    btnSweep.setAttribute('aria-pressed', String(next === 'sweep'));
  }

  btnTick.addEventListener('click', function () { setMode('tick'); });
  btnSweep.addEventListener('click', function () { setMode('sweep'); });

  requestAnimationFrame(frame);
})();
