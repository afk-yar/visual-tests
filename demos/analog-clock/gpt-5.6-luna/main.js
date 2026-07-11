(function () {
  'use strict';

  const canvas = document.getElementById('clockCanvas');
  const ctx = canvas.getContext('2d');
  const digitalTime = document.getElementById('digitalTime');
  const digitalDate = document.getElementById('digitalDate');
  const dprReadout = document.getElementById('dprReadout');
  const modeButtons = Array.from(document.querySelectorAll('[data-mode]'));

  let width = 0;
  let height = 0;
  let dpr = 1;
  let motionMode = 'sweep';
  let lastDisplayedSecond = -1;
  let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const palette = {
    ink: '#172331',
    inkSoft: '#304050',
    paper: '#efe8d7',
    paperLight: '#f9f2e1',
    paperShadow: '#c7b99e',
    brass: '#bf8f46',
    blue: '#73b8d1',
    blueLight: '#b9e7ef'
  };

  function resize() {
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = nextDpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dprReadout.textContent = dpr.toFixed(dpr % 1 ? 1 : 0) + '×';
  }

  function circle(x, y, radius, fill, stroke, lineWidth) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lineWidth || 1; ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function clockGeometry() {
    const radius = Math.min(width * .43, height * .355);
    const yLift = Math.min(35, height * .035);
    return { x: width / 2, y: height / 2 - yLift, radius: radius };
  }

  function polar(cx, cy, radius, angle) {
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  }

  function drawAmbient(cx, cy, r, now) {
    const glow = ctx.createRadialGradient(cx, cy + r * .08, r * .16, cx, cy + r * .08, r * 1.5);
    glow.addColorStop(0, 'rgba(122, 151, 174, .09)');
    glow.addColorStop(.42, 'rgba(76, 103, 126, .045)');
    glow.addColorStop(1, 'rgba(12, 20, 32, 0)');
    circle(cx, cy, r * 1.5, glow);

    if (!reducedMotion) {
      const shimmer = (Math.sin(now / 4200) + 1) * .5;
      ctx.save();
      ctx.globalAlpha = .035 + shimmer * .018;
      ctx.strokeStyle = '#b6d7dd';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r * (1.08 + shimmer * .014), Math.PI * 1.08, Math.PI * 1.63);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawCase(cx, cy, r) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, .62)';
    ctx.shadowBlur = r * .16;
    ctx.shadowOffsetY = r * .10;
    circle(cx, cy, r * 1.075, '#090e14');
    ctx.restore();

    const outer = ctx.createRadialGradient(cx - r * .34, cy - r * .42, r * .08, cx, cy, r * 1.1);
    outer.addColorStop(0, '#f0d28d');
    outer.addColorStop(.20, '#c8944c');
    outer.addColorStop(.47, '#74502c');
    outer.addColorStop(.63, '#ddaf62');
    outer.addColorStop(.82, '#6d4a2b');
    outer.addColorStop(1, '#1c1c1a');
    circle(cx, cy, r * 1.075, outer, 'rgba(247, 217, 151, .54)', 1.1);

    circle(cx, cy, r * 1.012, null, 'rgba(255, 224, 160, .62)', 2);
    circle(cx, cy, r * .977, null, 'rgba(58, 39, 23, .88)', r * .018);
    circle(cx, cy, r * .956, null, 'rgba(238, 185, 91, .44)', 1);

    const face = ctx.createRadialGradient(cx - r * .22, cy - r * .30, r * .05, cx, cy, r * .91);
    face.addColorStop(0, palette.paperLight);
    face.addColorStop(.60, palette.paper);
    face.addColorStop(.88, '#e3d7c0');
    face.addColorStop(1, palette.paperShadow);
    circle(cx, cy, r * .916, face, 'rgba(77, 58, 36, .72)', 1);
    circle(cx, cy, r * .868, null, 'rgba(116, 91, 55, .20)', 1);
  }

  function drawTicks(cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineCap = 'round';
    for (let i = 0; i < 60; i += 1) {
      const angle = i * Math.PI / 30;
      const major = i % 5 === 0;
      const cardinal = i % 15 === 0;
      const outer = r * (cardinal ? .833 : major ? .836 : .845);
      const inner = r * (cardinal ? .755 : major ? .773 : .813);
      ctx.beginPath();
      ctx.moveTo(Math.sin(angle) * inner, -Math.cos(angle) * inner);
      ctx.lineTo(Math.sin(angle) * outer, -Math.cos(angle) * outer);
      ctx.strokeStyle = cardinal ? palette.ink : major ? palette.inkSoft : 'rgba(48, 64, 80, .62)';
      ctx.lineWidth = cardinal ? r * .015 : major ? r * .010 : r * .0042;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawNumerals(cx, cy, r) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = palette.ink;
    ctx.font = '600 ' + Math.max(15, r * .105) + 'px Georgia, "Times New Roman", serif';
    for (let i = 1; i <= 12; i += 1) {
      const angle = i * Math.PI / 6;
      const point = polar(cx, cy, r * .674, angle - Math.PI / 2);
      ctx.fillText(String(i), point.x, point.y + r * .004);
    }
    ctx.font = '500 ' + Math.max(8, r * .026) + 'px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(48, 64, 80, .70)';
    ctx.fillText('L U N A', cx, cy - r * .19);
    ctx.font = '600 ' + Math.max(6, r * .018) + 'px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(48, 64, 80, .48)';
    ctx.fillText('PRECISION / 24', cx, cy + r * .23);
    ctx.restore();
  }

  function drawGlass(cx, cy, r) {
    ctx.save();
    const glass = ctx.createRadialGradient(cx - r * .34, cy - r * .43, r * .05, cx, cy, r * .96);
    glass.addColorStop(0, 'rgba(255,255,255,.12)');
    glass.addColorStop(.32, 'rgba(255,255,255,.025)');
    glass.addColorStop(1, 'rgba(115, 166, 190, .055)');
    circle(cx, cy, r * .905, glass);
    ctx.globalAlpha = .19;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = r * .012;
    ctx.beginPath();
    ctx.arc(cx, cy, r * .91, Math.PI * 1.08, Math.PI * 1.55);
    ctx.stroke();
    ctx.globalAlpha = .08;
    ctx.lineWidth = r * .006;
    ctx.beginPath();
    ctx.arc(cx, cy, r * .91, Math.PI * 1.60, Math.PI * 1.88);
    ctx.stroke();
    ctx.restore();
  }

  function handPath(length, width, tail) {
    ctx.beginPath();
    ctx.moveTo(-width * .42, tail);
    ctx.lineTo(-width * .50, -length * .78);
    ctx.quadraticCurveTo(0, -length, width * .50, -length * .78);
    ctx.lineTo(width * .42, tail);
    ctx.closePath();
  }

  function drawMainHand(cx, cy, angle, length, width, tail, fill, highlight) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.shadowColor = 'rgba(12, 20, 29, .45)';
    ctx.shadowBlur = Math.max(4, width * .85);
    ctx.shadowOffsetX = width * .35;
    ctx.shadowOffsetY = width * .75;
    handPath(length, width, tail);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(9, 19, 28, .75)';
    ctx.lineWidth = Math.max(.8, width * .085);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-width * .14, tail * .55);
    ctx.lineTo(-width * .10, -length * .72);
    ctx.strokeStyle = highlight;
    ctx.globalAlpha = .46;
    ctx.lineWidth = Math.max(.8, width * .11);
    ctx.stroke();
    ctx.restore();
  }

  function drawSecondHand(cx, cy, angle, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.shadowColor = 'rgba(15, 39, 48, .38)';
    ctx.shadowBlur = r * .022;
    ctx.shadowOffsetX = r * .012;
    ctx.shadowOffsetY = r * .018;
    ctx.beginPath();
    ctx.moveTo(0, r * .205);
    ctx.lineTo(0, -r * .805);
    ctx.strokeStyle = palette.blue;
    ctx.lineWidth = Math.max(1.4, r * .011);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.beginPath();
    ctx.moveTo(0, r * .205);
    ctx.lineTo(0, -r * .72);
    ctx.strokeStyle = palette.blueLight;
    ctx.globalAlpha = .72;
    ctx.lineWidth = Math.max(.55, r * .0035);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * .036, 0, Math.PI * 2);
    ctx.fillStyle = palette.blue;
    ctx.globalAlpha = 1;
    ctx.fill();
    ctx.restore();
  }

  function drawCenter(cx, cy, r) {
    const cap = ctx.createRadialGradient(cx - r * .012, cy - r * .014, 0, cx, cy, r * .056);
    cap.addColorStop(0, '#f4d997');
    cap.addColorStop(.35, '#bf8b43');
    cap.addColorStop(.76, '#674323');
    cap.addColorStop(1, '#241b12');
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, .4)';
    ctx.shadowBlur = r * .018;
    ctx.shadowOffsetY = r * .012;
    circle(cx, cy, r * .054, cap, 'rgba(255, 225, 150, .70)', r * .006);
    ctx.restore();
    circle(cx, cy, r * .014, '#f2d99b');
  }

  function updateReadout(date) {
    if (date.getSeconds() === lastDisplayedSecond) return;
    lastDisplayedSecond = date.getSeconds();
    const pad = (value) => String(value).padStart(2, '0');
    digitalTime.textContent = pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
    digitalDate.textContent = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' }).format(date);
  }

  function draw(now) {
    const date = new Date();
    const milliseconds = date.getMilliseconds();
    const seconds = date.getSeconds() + milliseconds / 1000;
    const minutes = date.getMinutes() + seconds / 60;
    const hours = (date.getHours() % 12) + minutes / 60;
    const geometry = clockGeometry();
    const cx = geometry.x;
    const cy = geometry.y;
    const r = geometry.radius;

    ctx.clearRect(0, 0, width, height);
    drawAmbient(cx, cy, r, now);
    drawCase(cx, cy, r);
    drawTicks(cx, cy, r);
    drawNumerals(cx, cy, r);
    drawMainHand(cx, cy, hours * Math.PI / 6 - Math.PI / 2, r * .50, r * .105, r * .12, palette.ink, '#61717b');
    drawMainHand(cx, cy, minutes * Math.PI / 30 - Math.PI / 2, r * .72, r * .073, r * .16, palette.inkSoft, '#73828b');

    let secondValue = seconds;
    if (motionMode === 'tick') {
      const whole = date.getSeconds();
      const phase = milliseconds / 1000;
      const bounce = phase < .18 ? Math.sin((phase / .18) * Math.PI) * .11 : 0;
      secondValue = whole + Math.min(phase, .08) + bounce;
    }
    drawSecondHand(cx, cy, secondValue * Math.PI / 30 - Math.PI / 2, r);
    drawCenter(cx, cy, r);
    drawGlass(cx, cy, r);
    updateReadout(date);
    window.requestAnimationFrame(draw);
  }

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      motionMode = button.dataset.mode;
      modeButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      });
    });
  });

  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
    reducedMotion = event.matches;
  });
  window.addEventListener('resize', resize, { passive: true });
  resize();
  window.requestAnimationFrame(draw);
}());

