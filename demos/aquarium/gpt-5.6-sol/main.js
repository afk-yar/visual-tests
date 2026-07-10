(() => {
  'use strict';
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: false });
  const lightInput = document.getElementById('light');
  const pauseButton = document.getElementById('pause');
  const pauseIcon = document.getElementById('pauseIcon');
  const feedButton = document.getElementById('feed');
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

  let W = 1, H = 1, DPR = 1, time = 0, last = performance.now();
  let paused = false, lightLevel = Number(lightInput.value) / 100;
  const fish = [], bubbles = [], motes = [], plants = [], foods = [], caustics = [];

  const species = {
    ember: { length: 53, height: 20, speed: 43, colors: ['#f7b44c', '#d95c29'], accent: '#ffe19b', fin: 'rgba(241,115,44,.72)', tail: .58, shape: 1.05, stripes: 0, school: false },
    pearl: { length: 74, height: 27, speed: 32, colors: ['#d7e7d7', '#648f8b'], accent: '#f4efc7', fin: 'rgba(183,218,199,.58)', tail: .72, shape: 1.2, stripes: 3, school: false },
    royal: { length: 84, height: 37, speed: 35, colors: ['#54bfd0', '#164d82'], accent: '#f0cc55', fin: 'rgba(46,112,160,.78)', tail: .5, shape: 1.42, stripes: -2, school: false },
    angel: { length: 69, height: 50, speed: 25, colors: ['#e4c36d', '#6b4939'], accent: '#f4dd9a', fin: 'rgba(132,91,64,.58)', tail: .85, shape: 1.8, stripes: 4, school: false, angel: true },
    tetra: { length: 29, height: 10, speed: 54, colors: ['#8ee5db', '#2f7196'], accent: '#c6fff2', fin: 'rgba(103,205,200,.55)', tail: .7, shape: .86, stripes: 0, school: true }
  };

  class Fish {
    constructor(type, x, y, scale = 1) {
      this.type = type; this.s = species[type]; this.x = x; this.y = y; this.scale = scale;
      this.angle = Math.random() < .5 ? rand(-.4, .4) : rand(Math.PI - .4, Math.PI + .4);
      this.speed = this.s.speed * rand(.78, 1.16) * scale;
      this.turn = rand(-.2, .2); this.phase = rand(0, TAU); this.depth = rand(.74, 1.12);
      this.wanderClock = rand(.3, 2.5); this.glint = rand(.5, 1.4);
    }

    update(dt) {
      const margin = Math.min(W, H) * .12 + this.s.length * this.scale;
      let steer = 0;
      this.wanderClock -= dt;
      if (this.wanderClock <= 0) {
        this.turn = clamp(this.turn + rand(-.7, .7), -.68, .68);
        this.wanderClock = rand(.7, 2.6);
      }
      steer += this.turn * .22;
      let ax = 0, ay = 0;
      if (this.x < margin) ax += (margin - this.x) / margin;
      if (this.x > W - margin) ax -= (this.x - (W - margin)) / margin;
      if (this.y < margin * .7) ay += (margin * .7 - this.y) / margin;
      if (this.y > H * .84) ay -= (this.y - H * .84) / margin;
      if (ax || ay) steer += wrapAngle(Math.atan2(ay, ax) - this.angle) * 1.8;

      if (this.s.school) {
        let count = 0, alignX = 0, alignY = 0, centerX = 0, centerY = 0, sepX = 0, sepY = 0;
        for (const other of fish) {
          if (other === this || !other.s.school) continue;
          const dx = other.x - this.x, dy = other.y - this.y, d2 = dx * dx + dy * dy;
          if (d2 < 22500) {
            count++; alignX += Math.cos(other.angle); alignY += Math.sin(other.angle);
            centerX += other.x; centerY += other.y;
            if (d2 < 1156 && d2 > .1) { sepX -= dx / d2; sepY -= dy / d2; }
          }
        }
        if (count) {
          steer += wrapAngle(Math.atan2(centerY / count - this.y, centerX / count - this.x) - this.angle) * .34;
          steer += wrapAngle(Math.atan2(alignY / count, alignX / count) - this.angle) * .62;
          if (sepX || sepY) steer += wrapAngle(Math.atan2(sepY, sepX) - this.angle) * 1.4;
        }
      }

      let nearest = null, nearestD2 = 67600;
      for (const f of foods) {
        const dx = f.x - this.x, dy = f.y - this.y, d2 = dx * dx + dy * dy;
        if (d2 < nearestD2) { nearest = f; nearestD2 = d2; }
      }
      if (nearest) {
        steer += wrapAngle(Math.atan2(nearest.y - this.y, nearest.x - this.x) - this.angle) * 1.25;
        if (nearestD2 < 169) nearest.life = 0;
      }
      this.angle += clamp(steer, -2.1, 2.1) * dt + Math.sin(time * .43 + this.phase) * dt * .05;
      const desiredSpeed = this.s.speed * this.scale * (nearest ? 1.24 : 1) * (this.s.school ? 1.05 : 1);
      this.speed = lerp(this.speed, desiredSpeed, 1 - Math.exp(-dt * 1.2));
      this.x += Math.cos(this.angle) * this.speed * dt;
      this.y += Math.sin(this.angle) * this.speed * dt;
      this.phase += dt * (4.6 + this.speed * .018);
    }

    draw() {
      const s = this.s, L = s.length * this.scale, bodyH = s.height * this.scale;
      const wave = Math.sin(this.phase) * L * .018;
      ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.angle); ctx.scale(this.depth, this.depth);
      ctx.globalAlpha = .2; ctx.fillStyle = '#00161b';
      ctx.beginPath(); ctx.ellipse(-L * .03, bodyH * .66, L * .52, bodyH * .18, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;

      const tailX = -L * .49, tailSwing = Math.sin(this.phase + .65) * bodyH * .31;
      ctx.fillStyle = s.fin; ctx.beginPath(); ctx.moveTo(tailX + L * .06, wave);
      ctx.quadraticCurveTo(-L * (.65 + s.tail * .12), -bodyH * .69 + tailSwing, -L * (.64 + s.tail * .18), -bodyH * .62 + tailSwing);
      ctx.quadraticCurveTo(-L * (.74 + s.tail * .1), wave, -L * (.64 + s.tail * .18), bodyH * .62 + tailSwing);
      ctx.quadraticCurveTo(-L * (.65 + s.tail * .12), bodyH * .69 + tailSwing, tailX + L * .06, wave); ctx.fill();

      const finWave = Math.sin(this.phase * .74 + 1.3) * bodyH * .12;
      ctx.beginPath(); ctx.moveTo(-L * .19, -bodyH * .37);
      ctx.quadraticCurveTo(-L * .19, -bodyH * (.88 + (s.angel ? .48 : 0)) - finWave, L * .17, -bodyH * .29); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-L * .16, bodyH * .35);
      ctx.quadraticCurveTo(-L * .12, bodyH * (.82 + (s.angel ? .64 : 0)) + finWave, L * .19, bodyH * .28); ctx.closePath(); ctx.fill();

      const grad = ctx.createLinearGradient(-L * .5, -bodyH * .4, L * .5, bodyH * .42);
      grad.addColorStop(0, s.colors[1]); grad.addColorStop(.42, s.colors[0]); grad.addColorStop(1, s.colors[1]); ctx.fillStyle = grad;
      ctx.beginPath();
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const p = i / steps, x = lerp(-L * .5, L * .52, p), taper = Math.pow(Math.sin(p * Math.PI), s.shape);
        const cy = Math.sin(this.phase - p * 5.3) * wave * (1 - p) * .75, y = cy - bodyH * .5 * taper;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      for (let i = steps; i >= 0; i--) {
        const p = i / steps, x = lerp(-L * .5, L * .52, p), taper = Math.pow(Math.sin(p * Math.PI), s.shape);
        const cy = Math.sin(this.phase - p * 5.3) * wave * (1 - p) * .75;
        ctx.lineTo(x, cy + bodyH * .5 * taper);
      }
      ctx.closePath(); ctx.fill();

      ctx.save(); ctx.clip(); ctx.globalAlpha = .2; ctx.strokeStyle = '#f8fff3'; ctx.lineWidth = Math.max(.7, this.scale);
      for (let i = 0; i < 9; i++) { const x = -L * .3 + i * L * .09; ctx.beginPath(); ctx.arc(x, bodyH * .1, bodyH * .23, -1.35, .38); ctx.stroke(); }
      if (s.stripes > 0) {
        ctx.globalAlpha = .48; ctx.fillStyle = '#302b2b';
        for (let i = 0; i < s.stripes; i++) ctx.fillRect(-L * .24 + i * L * .17, -bodyH * .56, L * .055, bodyH * 1.12);
      } else if (s.stripes < 0) {
        ctx.globalAlpha = .85; ctx.fillStyle = '#183763'; ctx.beginPath();
        ctx.moveTo(-L * .38, -bodyH * .32); ctx.quadraticCurveTo(0, -bodyH * .02, L * .35, -bodyH * .28);
        ctx.lineTo(L * .26, bodyH * .12); ctx.quadraticCurveTo(-L * .08, bodyH * .23, -L * .38, -bodyH * .32); ctx.fill();
      }
      const shine = ctx.createLinearGradient(0, -bodyH * .48, 0, bodyH * .28);
      shine.addColorStop(0, `rgba(255,255,225,${.24 * this.glint})`); shine.addColorStop(.5, 'rgba(255,255,255,0)'); shine.addColorStop(1, 'rgba(0,28,38,.2)');
      ctx.fillStyle = shine; ctx.fillRect(-L, -bodyH, L * 2, bodyH * 2); ctx.restore();

      ctx.fillStyle = s.accent; ctx.globalAlpha = .72; ctx.beginPath();
      ctx.ellipse(L * .35, -bodyH * .09, bodyH * .12, bodyH * .09, -.2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#071a1b'; ctx.beginPath(); ctx.arc(L * .38, -bodyH * .1, Math.max(1.2, bodyH * .055), 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(L * .4, -bodyH * .125, Math.max(.5, bodyH * .018), 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(10,40,42,.48)'; ctx.lineWidth = Math.max(.6, this.scale * .75);
      ctx.beginPath(); ctx.arc(L * .39, bodyH * .03, L * .08, 1.35, 2.35); ctx.stroke();

      ctx.fillStyle = s.fin; ctx.globalAlpha = .77;
      const pec = Math.sin(this.phase * .9) * bodyH * .17;
      ctx.beginPath(); ctx.moveTo(L * .06, bodyH * .1);
      ctx.quadraticCurveTo(-L * .02, bodyH * .65 + pec, -L * .2, bodyH * .4);
      ctx.quadraticCurveTo(-L * .04, bodyH * .27, L * .06, bodyH * .1); ctx.fill(); ctx.restore();
    }
  }

  function makeBubble(initial = false, x = null, y = null) {
    const r = Math.pow(Math.random(), 1.65) * 8 + .65;
    return {
      x: x ?? rand(0, W), y: y ?? (initial ? rand(0, H) : H + 12), r,
      speed: rand(9, 20) + r * 3.4, phase: rand(0, TAU), wobble: rand(8, 27),
      alpha: rand(.26, .78), drift: rand(.55, 1.35)
    };
  }

  function resize() {
    W = innerWidth; H = innerHeight; DPR = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!fish.length) seedScene();
  }

  function seedScene() {
    const base = Math.sqrt((W * H) / (1440 * 900));
    const add = (type, count, a, b, ya = .18, yb = .72) => {
      for (let i = 0; i < count; i++) fish.push(new Fish(type, rand(W * .08, W * .92), rand(H * ya, H * yb), rand(a, b) * clamp(base, .8, 1.2)));
    };
    add('royal', 2, .85, 1.08, .28, .63); add('angel', 2, .72, .96, .25, .66);
    add('pearl', 3, .72, 1.02, .22, .72); add('ember', 5, .68, .94, .18, .7);
    const sy = rand(H * .28, H * .55), sx = rand(W * .25, W * .68);
    for (let i = 0; i < 17; i++) fish.push(new Fish('tetra', sx + rand(-90, 90), sy + rand(-50, 50), rand(.78, 1.06)));

    for (let i = 0; i < Math.max(12, Math.floor(W / 92)); i++) {
      plants.push({
        x: rand(-15, W + 15), h: rand(H * .16, H * .45), width: rand(4, 9),
        phase: rand(0, TAU), hue: rand(138, 178), layer: Math.random(),
        fullness: rand(.75, 1.3), stems: Math.floor(rand(2.7, 5.8))
      });
    }
    for (let i = 0; i < 68; i++) bubbles.push(makeBubble(true));
    for (let i = 0; i < 175; i++) motes.push({
      x: rand(0, W), y: rand(0, H), r: rand(.25, 2.35), phase: rand(0, TAU),
      speed: rand(.8, 6.5), depth: rand(.45, 1.35)
    });
    for (let i = 0; i < 38; i++) caustics.push({
      x: rand(-.1, 1.1), y: rand(.79, 1.03), rx: rand(30, 125), ry: rand(3, 10),
      phase: rand(0, TAU), speed: rand(.28, .72)
    });
  }
  function drawBackground() {
    const l = lightLevel;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgb(${Math.round(15 * l)},${Math.round(100 * l)},${Math.round(112 * l)})`);
    g.addColorStop(.22, `rgb(${Math.round(8 * l)},${Math.round(76 * l)},${Math.round(92 * l)})`);
    g.addColorStop(.55, `rgb(${Math.round(5 * l)},${Math.round(52 * l)},${Math.round(69 * l)})`);
    g.addColorStop(.82, `rgb(${Math.round(3 * l)},${Math.round(32 * l)},${Math.round(48 * l)})`);
    g.addColorStop(1, '#021521');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const surface = ctx.createLinearGradient(0, 0, 0, H * .2);
    surface.addColorStop(0, `rgba(183,241,222,${.28 * l})`);
    surface.addColorStop(.16, `rgba(88,193,184,${.14 * l})`);
    surface.addColorStop(1, 'rgba(10,80,93,0)');
    ctx.fillStyle = surface; ctx.fillRect(0, 0, W, H * .23);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = 'blur(13px)';
    for (let i = 0; i < 6; i++) {
      const sway = Math.sin(time * (.075 + i * .006) + i * 1.53) * W * .055;
      const topX = W * (.03 + i * .19) + sway;
      const beamW = W * (.10 + (i % 3) * .025);
      const reach = H * (.78 + (i % 2) * .13);
      const ray = ctx.createLinearGradient(topX - beamW, 0, topX + beamW, 0);
      ray.addColorStop(0, 'rgba(110,210,196,0)');
      ray.addColorStop(.27, `rgba(140,229,210,${.09 * l})`);
      ray.addColorStop(.5, `rgba(205,248,224,${(.19 + (i % 2) * .035) * l})`);
      ray.addColorStop(.73, `rgba(127,218,204,${.075 * l})`);
      ray.addColorStop(1, 'rgba(91,185,180,0)');
      ctx.fillStyle = ray; ctx.beginPath();
      ctx.moveTo(topX - beamW * .42, -20); ctx.lineTo(topX + beamW * .42, -20);
      ctx.lineTo(topX + beamW * 1.55 + sway * 1.45, reach);
      ctx.lineTo(topX - beamW * .82 + sway * 1.45, reach);
      ctx.closePath(); ctx.fill();
    }
    ctx.filter = 'none';
    for (let i = 0; i < 5; i++) {
      const sway = Math.sin(time * (.08 + i * .008) + i * 1.71) * W * .045;
      const x = W * (.08 + i * .215) + sway, bw = W * (.028 + (i % 2) * .014);
      const core = ctx.createLinearGradient(0, 0, 0, H * .74);
      core.addColorStop(0, `rgba(220,255,234,${.12 * l})`);
      core.addColorStop(.48, `rgba(148,224,207,${.05 * l})`);
      core.addColorStop(1, 'rgba(100,190,184,0)');
      ctx.fillStyle = core; ctx.beginPath();
      ctx.moveTo(x - bw, 0); ctx.lineTo(x + bw, 0);
      ctx.lineTo(x + bw * 2.4 + sway, H * .74); ctx.lineTo(x - bw * .7 + sway, H * .74);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(208,251,232,${.18 * l})`; ctx.lineWidth = 1.45;
    ctx.shadowColor = 'rgba(170,238,220,.34)'; ctx.shadowBlur = 5;
    for (let i = 0; i < 10; i++) {
      const y = 4 + i * 7; ctx.beginPath();
      for (let x = -20; x <= W + 20; x += 12) {
        const yy = y + Math.sin(x * .029 + time * 1.05 + i * .83) * 2.8;
        x === -20 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawFloor() {
    const top = H * .79;
    const floorPath = () => {
      ctx.beginPath(); ctx.moveTo(0, top + Math.sin(time * .08) * 2);
      for (let x = 0; x <= W; x += 42) {
        ctx.lineTo(x, top + Math.sin(x * .011) * 8 + Math.sin(x * .027 + 2) * 4);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    };
    const g = ctx.createLinearGradient(0, top, 0, H);
    g.addColorStop(0, '#7a8060'); g.addColorStop(.18, '#666f55');
    g.addColorStop(.62, '#455448'); g.addColorStop(1, '#273a37');
    ctx.fillStyle = g; floorPath(); ctx.fill();

    ctx.save(); floorPath(); ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = `rgba(219,241,173,${.42 * lightLevel})`;
    ctx.shadowBlur = 9;

    for (let layer = 0; layer < 3; layer++) {
      const spacing = 17 + layer * 5;
      const drift = time * (8 + layer * 2.4);
      ctx.lineWidth = 1.15 + layer * .48;
      ctx.strokeStyle = `rgba(224,240,164,${(.13 + layer * .045) * lightLevel})`;
      for (let row = 0; row < 12; row++) {
        const baseY = top + 7 + row * spacing;
        ctx.beginPath();
        for (let x = -40; x <= W + 40; x += 13) {
          const xx = x + drift;
          const y = baseY + Math.sin(xx * (.026 + layer * .004) + time * (.66 + layer * .13) + row * .72) * (5 + layer * 2)
            + Math.sin(xx * .011 - time * .42 + row) * 3;
          x === -40 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    ctx.lineWidth = 1.15;
    ctx.strokeStyle = `rgba(232,245,177,${.17 * lightLevel})`;
    for (let col = -2; col < Math.ceil(W / 66) + 2; col++) {
      const baseX = col * 66 + (time * 7.5) % 66;
      ctx.beginPath();
      for (let y = top - 8; y <= H + 12; y += 11) {
        const depth = (y - top) / Math.max(1, H - top);
        const x = baseX + depth * 25 + Math.sin(y * .041 - time * .72 + col) * 10;
        y === top - 8 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.shadowBlur = 12;
    for (const c of caustics) {
      const pulse = .6 + .4 * Math.sin(time * c.speed + c.phase);
      const x = c.x * W + Math.sin(time * .18 + c.phase) * 30, y = c.y * H;
      ctx.lineWidth = 1.8 + pulse * 1.25;
      ctx.strokeStyle = `rgba(239,244,177,${(.15 + pulse * .17) * lightLevel})`;
      ctx.beginPath();
      ctx.ellipse(x, y, c.rx * (.72 + pulse * .28), c.ry * (1.35 - pulse * .32), Math.sin(c.phase) * .34, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x + c.rx * .3, y + 8, c.rx * .45, c.ry * .68, -.2, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(12,32,28,.34)';
    for (let i = 0; i < Math.floor(W / 18); i++) {
      const x = (i * 83.17) % W, y = top + 16 + ((i * 47.3) % Math.max(20, H - top - 18));
      ctx.beginPath(); ctx.ellipse(x, y, .8 + (i % 3), .55 + (i % 2), 0, 0, TAU); ctx.fill();
    }
  }
  function drawPlant(p, foreground = false) {
    if ((p.layer > .56) !== foreground) return;
    const baseY = H + 10;
    const alpha = foreground ? .9 : .62;
    const stemCount = p.stems || 3;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    for (let stem = 0; stem < stemCount; stem++) {
      const segments = 15;
      const stemPhase = p.phase + stem * .73;
      const stemH = p.h * (.72 + (stem / Math.max(1, stemCount - 1)) * .28 + Math.sin(stemPhase) * .05);
      const rootOffset = (stem - (stemCount - 1) * .5) * p.width * 1.5;
      const sway = Math.sin(time * (.38 + p.layer * .16) + stemPhase) * (15 + stemH * .075);
      const points = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        points.push({
          x: p.x + rootOffset * (1 - t * .6) + sway * t * t
            + Math.sin(time * .56 + stemPhase + t * 3.8) * (2.5 + stem) * t,
          y: baseY - stemH * t
        });
      }

      ctx.strokeStyle = `hsla(${p.hue - 8 + stem * 2},42%,${foreground ? 24 : 31}%,.9)`;
      ctx.lineWidth = Math.max(1.4, p.width * (.42 - stem * .025));
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) * .5, (a.y + b.y) * .5);
      }
      ctx.lineTo(points[segments].x, points[segments].y); ctx.stroke();

      for (let i = 2; i < segments; i++) {
        const pt = points[i], t = i / segments;
        const side = (i + stem) % 2 ? -1 : 1;
        const leafL = stemH * (.105 + .075 * (1 - t)) * p.fullness;
        const leafW = leafL * (.26 + .08 * Math.sin(stemPhase + i));
        const flutter = Math.sin(time * .92 + stemPhase + i * .62) * (4 + t * 5);
        const tipX = pt.x + side * (leafL + flutter);
        const tipY = pt.y - leafL * (.19 + t * .08);
        ctx.fillStyle = `hsla(${p.hue + (i % 4) * 3 + stem * 2},${42 + stem * 2}%,${foreground ? 28 + (i % 3) * 3 : 34 + (i % 3) * 2}%,.82)`;
        ctx.beginPath(); ctx.moveTo(pt.x, pt.y);
        ctx.quadraticCurveTo(pt.x + side * leafL * .5, pt.y - leafW, tipX, tipY);
        ctx.quadraticCurveTo(pt.x + side * leafL * .48, pt.y + leafW * .72, pt.x, pt.y);
        ctx.fill();

        if (i > 5 && i % 3 === 0) {
          const smallSide = -side, smallL = leafL * .68;
          ctx.fillStyle = `hsla(${p.hue + 9},46%,${foreground ? 32 : 39}%,.67)`;
          ctx.beginPath(); ctx.moveTo(pt.x, pt.y);
          ctx.quadraticCurveTo(pt.x + smallSide * smallL * .5, pt.y - leafW * .62,
            pt.x + smallSide * smallL - flutter * .35, pt.y - smallL * .23);
          ctx.quadraticCurveTo(pt.x + smallSide * smallL * .44, pt.y + leafW * .5, pt.x, pt.y);
          ctx.fill();
        }
      }

      const tip = points[segments], before = points[segments - 1];
      ctx.fillStyle = `hsla(${p.hue + 8},48%,${foreground ? 34 : 40}%,.76)`;
      ctx.beginPath(); ctx.moveTo(before.x, before.y);
      ctx.quadraticCurveTo(tip.x - p.width * 2.5, tip.y - stemH * .035, tip.x, tip.y - stemH * .075);
      ctx.quadraticCurveTo(tip.x + p.width * 2.2, tip.y - stemH * .025, before.x, before.y);
      ctx.fill();
    }
    ctx.restore();
  }
  function drawBubbles(dt) {
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (const b of bubbles) {
      b.y -= b.speed * dt;
      b.x += Math.sin(time * b.drift + b.phase + b.y * .008) * b.wobble * dt;
      if (b.y < -14) Object.assign(b, makeBubble(false));
      const pulse = 1 + Math.sin(time * 1.6 + b.phase) * .035;
      const r = b.r * pulse;
      const grad = ctx.createRadialGradient(b.x - r * .36, b.y - r * .4, 0, b.x, b.y, r);
      grad.addColorStop(0, `rgba(242,255,251,${b.alpha})`);
      grad.addColorStop(.18, 'rgba(192,242,235,.12)');
      grad.addColorStop(.68, 'rgba(62,148,160,.035)');
      grad.addColorStop(.88, `rgba(166,231,227,${b.alpha * .17})`);
      grad.addColorStop(1, `rgba(226,255,248,${b.alpha * .72})`);
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(221,255,249,${b.alpha * .52})`;
      ctx.lineWidth = Math.max(.55, r * .095); ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.stroke();
      if (r > 3.4) {
        ctx.strokeStyle = `rgba(255,255,255,${b.alpha * .72})`;
        ctx.lineWidth = Math.max(.7, r * .12); ctx.beginPath();
        ctx.arc(b.x - r * .08, b.y - r * .05, r * .63, 3.62, 4.72); ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawMotes(dt) {
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (const m of motes) {
      const depth = m.depth || 1;
      m.y -= m.speed * depth * dt;
      m.x += (Math.sin(time * (.24 + depth * .11) + m.phase) * 3.8 + Math.cos(m.y * .009 + m.phase)) * dt;
      if (m.y < -4) { m.y = H + 4; m.x = rand(0, W); }
      if (m.x < -5) m.x = W + 4;
      if (m.x > W + 5) m.x = -4;
      const twinkle = .55 + .45 * Math.sin(time * (.38 + depth * .2) + m.phase);
      const a = (.055 + .15 * twinkle) * lightLevel * clamp(depth, .55, 1.18);
      ctx.fillStyle = `rgba(194,229,211,${a})`;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r * depth, 0, TAU); ctx.fill();
      if (m.r > 1.65) {
        ctx.fillStyle = `rgba(155,214,202,${a * .22})`;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r * depth * 2.8, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }
  function addFood(x = W * rand(.35, .65), y = H * .16) {
    for (let i = 0; i < 14; i++) foods.push({ x: x + rand(-18, 18), y: y + rand(-9, 9), vx: rand(-4, 4), vy: rand(4, 13), life: rand(8, 15), r: rand(1.1, 2.4), phase: rand(0, TAU) });
  }

  function drawFood(dt) {
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i]; f.life -= dt; f.vy = Math.min(18, f.vy + dt * 1.5);
      f.x += (f.vx + Math.sin(time * 1.8 + f.phase) * 3) * dt; f.y += f.vy * dt;
      if (f.y > H * .8 || f.life <= 0) { foods.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(224,195,105,${clamp(f.life, 0, 1) * .85})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
    }
  }

  function drawHaze() {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 4; i++) {
      const cx = W * (.12 + i * .27) + Math.sin(time * .045 + i * 1.8) * W * .11;
      const cy = H * (.25 + (i % 3) * .2) + Math.cos(time * .06 + i) * H * .05;
      const radius = Math.max(W, H) * (.2 + i * .025);
      const cloud = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      cloud.addColorStop(0, `rgba(95,170,158,${.025 + (i % 2) * .012})`);
      cloud.addColorStop(.46, 'rgba(72,139,137,.014)');
      cloud.addColorStop(1, 'rgba(28,85,92,0)');
      ctx.fillStyle = cloud; ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
    ctx.restore();

    const mist = ctx.createLinearGradient(0, H * .58, 0, H);
    mist.addColorStop(0, 'rgba(23,71,70,0)');
    mist.addColorStop(.5, 'rgba(23,61,61,.075)');
    mist.addColorStop(1, 'rgba(18,38,39,.34)');
    ctx.fillStyle = mist; ctx.fillRect(0, H * .58, W, H * .42);

    const vignette = ctx.createRadialGradient(W * .48, H * .4, Math.min(W, H) * .12, W * .48, H * .4, Math.max(W, H) * .76);
    vignette.addColorStop(0, 'rgba(65,131,124,0)');
    vignette.addColorStop(.58, 'rgba(5,39,48,.045)');
    vignette.addColorStop(1, 'rgba(0,8,17,.44)');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (paused) { last = now; return; }
    const dt = Math.min(.033, Math.max(.001, (now - last) / 1000));
    last = now; time += dt;
    lightLevel = lerp(lightLevel, Number(lightInput.value) / 100, 1 - Math.exp(-dt * 3));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    drawBackground(); drawMotes(dt);
    for (const p of plants) drawPlant(p, false);
    drawFloor(); drawFood(dt);
    fish.sort((a, b) => a.depth - b.depth);
    for (const f of fish) { f.update(dt); f.draw(); }
    drawBubbles(dt);
    for (const p of plants) drawPlant(p, true);
    drawHaze();
  }

  canvas.addEventListener('pointerdown', e => {
    addFood(e.clientX, e.clientY);
    for (let i = 0; i < 5; i++) bubbles.push(makeBubble(false, e.clientX + rand(-10, 10), e.clientY + rand(-6, 6)));
  });
  feedButton.addEventListener('click', () => addFood());
  pauseButton.addEventListener('click', () => {
    paused = !paused; pauseIcon.textContent = paused ? '▶' : 'Ⅱ';
    pauseButton.setAttribute('aria-label', paused ? 'Продолжить анимацию' : 'Приостановить анимацию');
  });
  addEventListener('resize', resize, { passive: true });
  resize(); requestAnimationFrame(frame);
})();








