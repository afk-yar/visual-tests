(() => {
  "use strict";
  const canvas = document.getElementById("aquarium-canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const pauseButton = document.getElementById("pause-button");
  const flowRange = document.getElementById("flow-range");
  const flowValue = document.getElementById("flow-value");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TAU = Math.PI * 2;
  const pointer = { x: .5, y: .44, active: false };
  const state = { width: 0, height: 0, dpr: 1, time: 0, flow: .72, paused: false, last: 0 };
  const bubbles = [], weeds = [], fish = [], schools = [];
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const rand = (min, max) => min + Math.random() * (max - min);

  function resize() {
    state.width = window.innerWidth; state.height = window.innerHeight; state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(state.width * state.dpr); canvas.height = Math.floor(state.height * state.dpr);
    canvas.style.width = state.width + "px"; canvas.style.height = state.height + "px";
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0); seedWorld();
  }
  function seedWorld() {
    bubbles.length = 0;
    for (let i = 0; i < clamp(Math.round(state.width / 22), 26, 70); i += 1) bubbles.push({ x: rand(-20, state.width + 20), y: rand(-20, state.height), r: rand(1.2, 4.5), speed: rand(8, 27), drift: rand(3, 12), phase: rand(0, TAU), alpha: rand(.16, .52), delay: rand(0, 8) });
    weeds.length = 0;
    const count = clamp(Math.round(state.width / 28), 28, 72);
    for (let i = 0; i < count; i += 1) weeds.push({ x: (i / (count - 1)) * state.width + rand(-14, 14), h: rand(72, 245), w: rand(5, 14), phase: rand(0, TAU), speed: rand(.45, 1.05), depth: rand(.12, 1), hue: rand(144, 178), layer: i % 3 });
  }
  function makeFish(kind, x, y, size, depth, extra) {
    extra = extra || {};
    return { kind: kind, x: x, y: y, size: size, depth: depth, angle: extra.angle === undefined ? rand(-.2, .2) : extra.angle, speed: extra.speed === undefined ? rand(15, 34) : extra.speed, phase: rand(0, TAU), seed: rand(0, 100), school: extra.school || null };
  }
  function seedFish() {
    fish.length = 0; schools.length = 0;
    const schoolCount = state.width < 650 ? 1 : 2;
    for (let s = 0; s < schoolCount; s += 1) {
      const school = { x: state.width * (.36 + s * .25), y: state.height * (.4 + (s % 2) * .16), vx: s ? -9 : 8, vy: 2, phase: rand(0, TAU), members: [] };
      schools.push(school);
      for (let i = 0; i < clamp(Math.round(state.width * state.height / 26000), 12, 24); i += 1) {
        const member = makeFish("neon", school.x + rand(-110, 110), school.y + rand(-65, 65), rand(7, 12), rand(.35, .65), { school: school, speed: rand(27, 45), angle: rand(-.2, .2) });
        school.members.push(member); fish.push(member);
      }
    }
    fish.push(
      makeFish("angel", state.width * .2, state.height * .38, 53, .68, { speed: 19 }),
      makeFish("clown", state.width * .66, state.height * .31, 35, .78, { speed: 24 }),
      makeFish("clown", state.width * .8, state.height * .58, 27, .51, { speed: 21 }),
      makeFish("tang", state.width * .4, state.height * .63, 30, .42, { speed: 27 }),
      makeFish("angel", state.width * .83, state.height * .25, 42, .31, { speed: 16 })
    );
  }
  function drawBackground(t) {
    const g = ctx.createLinearGradient(0, 0, 0, state.height);
    g.addColorStop(0, "#0d5264"); g.addColorStop(.26, "#0d4356"); g.addColorStop(.64, "#082f42"); g.addColorStop(1, "#061d2b");
    ctx.fillStyle = g; ctx.fillRect(0, 0, state.width, state.height);
    const bloom = ctx.createRadialGradient(state.width * .52, -state.height * .08, 0, state.width * .52, state.height * .18, state.width * .85);
    bloom.addColorStop(0, "rgba(137,232,217,.3)"); bloom.addColorStop(.32, "rgba(53,164,166,.11)"); bloom.addColorStop(1, "rgba(2,24,40,0)");
    ctx.fillStyle = bloom; ctx.fillRect(0, 0, state.width, state.height * .7); drawLightRays(t); drawDistantParticles(t);
  }
  function drawLightRays(t) {
    ctx.save(); ctx.globalCompositeOperation = "screen";
    const rays = [{ x: .13, width: .07, lean: .1, alpha: .055 }, { x: .31, width: .13, lean: -.07, alpha: .07 }, { x: .52, width: .08, lean: .08, alpha: .11 }, { x: .7, width: .15, lean: -.09, alpha: .06 }, { x: .91, width: .08, lean: .04, alpha: .05 }];
    rays.forEach((ray, i) => {
      const top = state.width * ray.x + Math.sin(t * .11 + i * 1.7) * 22, bottom = top + state.width * ray.lean + Math.sin(t * .17 + i) * 25, width = state.width * ray.width;
      const gradient = ctx.createLinearGradient(0, 0, 0, state.height * .85);
      gradient.addColorStop(0, "rgba(185,255,228," + ray.alpha * 1.8 + ")"); gradient.addColorStop(.44, "rgba(123,231,211," + ray.alpha + ")"); gradient.addColorStop(1, "rgba(72,178,176,0)");
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(top - width * .42, 0); ctx.lineTo(top + width * .58, 0); ctx.lineTo(bottom + width, state.height * .88); ctx.lineTo(bottom - width * .2, state.height * .88); ctx.closePath(); ctx.fill();
    }); ctx.restore();
  }
  function drawDistantParticles(t) {
    ctx.save();
    for (let i = 0; i < 85; i += 1) { const x = hash(i * 3.2) * state.width + Math.sin(t * .06 + i) * 3, y = hash(i * 7.9) * state.height * .77, r = hash(i * 1.4) * 1.4 + .35; ctx.globalAlpha = .08 + hash(i * 2.1) * .16; ctx.fillStyle = i % 4 ? "#b5f4e5" : "#ffe0a8"; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  function drawSand(t) {
    const y = state.height * .89, sand = ctx.createLinearGradient(0, y, 0, state.height);
    sand.addColorStop(0, "#a08d61"); sand.addColorStop(.26, "#7c6b4d"); sand.addColorStop(1, "#3e3b32");
    ctx.fillStyle = sand; ctx.beginPath(); ctx.moveTo(0, y + 18);
    for (let x = 0; x <= state.width + 50; x += 50) ctx.lineTo(x, y + Math.sin(x * .012 + t * .12) * 9 + Math.sin(x * .039) * 4);
    ctx.lineTo(state.width, state.height); ctx.lineTo(0, state.height); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 23; i += 1) { const x = hash(i * 4.77) * state.width, yPos = y + 7 + hash(i * 8.13) * (state.height - y) * .76, w = 16 + hash(i * 2.4) * 64, drift = Math.sin(t * (.32 + hash(i) * .22) + i) * 18; ctx.fillStyle = "rgba(255,220,152," + (.035 + hash(i * 3) * .06) + ")"; ctx.beginPath(); ctx.ellipse(x + drift, yPos, w, 2 + hash(i * 6) * 3, Math.sin(i) * .4, 0, TAU); ctx.fill(); }
    for (let i = 0; i < 10; i += 1) { const x = (i / 9) * state.width + Math.sin(t * .5 + i) * 26; ctx.strokeStyle = "rgba(218,245,191," + (.08 + (i % 3) * .025) + ")"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 28, y - 5, x + 52, state.height); ctx.stroke(); }
    ctx.restore(); drawPebbles(y);
  }
  function drawPebbles(y) {
    ctx.save();
    for (let i = 0; i < 110; i += 1) { const x = hash(i * 11.3) * state.width, py = y + 9 + hash(i * 2.73) * (state.height - y - 8), size = .5 + hash(i * 3.42) * 2.7; ctx.fillStyle = "rgba(213,194,148," + (.1 + hash(i * 5.7) * .22) + ")"; ctx.beginPath(); ctx.ellipse(x, py, size * 1.6, size, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  function drawWeeds(t, layer) {
    ctx.save();
    weeds.filter((weed) => weed.layer === layer).forEach((weed) => {
      const baseY = state.height * (.91 + weed.depth * .05), sway = (Math.sin(t * weed.speed + weed.phase) + Math.sin(t * .61 + weed.phase * 1.7)) * (5 + weed.depth * 11), alpha = (.16 + weed.depth * .28) * (layer === 2 ? .7 : 1);
      ctx.strokeStyle = "hsla(" + weed.hue + ",47%," + (22 + weed.depth * 16) + "%," + alpha + ")"; ctx.lineWidth = weed.w * (.45 + weed.depth * .4); ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(weed.x, baseY + 8); ctx.bezierCurveTo(weed.x - sway * .2, baseY - weed.h * .34, weed.x + sway * .55, baseY - weed.h * .68, weed.x + sway, baseY - weed.h); ctx.stroke();
      if (weed.depth > .48) { ctx.strokeStyle = "hsla(" + (weed.hue + 9) + ",58%,36%," + alpha * .55 + ")"; ctx.lineWidth = Math.max(1, weed.w * .16); ctx.beginPath(); ctx.moveTo(weed.x, baseY); ctx.quadraticCurveTo(weed.x - sway, baseY - weed.h * .5, weed.x + sway * .82, baseY - weed.h * .9); ctx.stroke(); }
    }); ctx.restore();
  }
  function updateSchool(school, t, dt) {
    const cursorX = pointer.active ? (pointer.x - .5) * 30 : 0, cursorY = pointer.active ? (pointer.y - .5) * 18 : 0;
    school.vx += (Math.sin(t * .21 + school.phase) * 3 + cursorX * .01 - school.vx * .16) * dt; school.vy += (Math.cos(t * .17 + school.phase * .6) * 2 + cursorY * .01 - school.vy * .18) * dt;
    school.x += school.vx * dt * state.flow; school.y += school.vy * dt * state.flow;
    if (school.x < state.width * .2 || school.x > state.width * .82) school.vx *= -1; if (school.y < state.height * .24 || school.y > state.height * .7) school.vy *= -1;
    school.x = clamp(school.x, state.width * .16, state.width * .84); school.y = clamp(school.y, state.height * .22, state.height * .72);
  }
  function updateFish(f, t, dt) {
    if (f.school) {
      const formation = f.school.members.indexOf(f), angle = formation * 2.41 + f.school.phase, radius = 25 + (formation % 5) * 15, targetX = f.school.x + Math.cos(angle + t * .14) * radius + Math.sin(t * .9 + f.seed) * 12, targetY = f.school.y + Math.sin(angle + t * .12) * radius * .58 + Math.cos(t * .67 + f.seed) * 8, desired = Math.atan2(targetY - f.y, targetX - f.x);
      const delta = Math.atan2(Math.sin(desired - f.angle), Math.cos(desired - f.angle)); f.angle += clamp(delta, -2.2 * dt, 2.2 * dt); f.x += Math.cos(f.angle) * f.speed * state.flow * dt; f.y += Math.sin(f.angle) * f.speed * state.flow * dt;
    } else {
      const wall = Math.min(f.x, state.width - f.x), wallForce = wall < state.width * .14 ? (f.x < state.width * .5 ? .7 : -.7) : 0, preferred = Math.sin(t * (.12 + f.depth * .08) + f.seed) * .34 + Math.cos(t * .071 + f.seed * .8) * .16 + wallForce;
      const delta = Math.atan2(Math.sin(preferred - f.angle), Math.cos(preferred - f.angle)); f.angle += clamp(delta, -.52 * dt, .52 * dt); f.x += Math.cos(f.angle) * f.speed * (.82 + Math.sin(t * .6 + f.seed) * .13) * state.flow * dt; f.y += Math.sin(f.angle) * f.speed * (.82 + Math.sin(t * .6 + f.seed) * .13) * state.flow * dt;
      const top = state.height * .17, bottom = state.height * .82; if (f.x < -f.size * 2) f.x = state.width + f.size * 2; if (f.x > state.width + f.size * 2) f.x = -f.size * 2; if (f.y < top || f.y > bottom) { f.angle = Math.PI - f.angle * .45; f.y = clamp(f.y, top, bottom); }
    }
  }
  function drawFish(f, t) {
    const scale = .72 + f.depth * .38, L = f.size * (f.kind === "angel" ? 1.26 : f.kind === "neon" ? 1.95 : 1.65) * scale, H = f.size * (f.kind === "angel" ? 1.22 : .72) * scale, bodyWave = Math.sin(t * (4.1 + f.speed * .02) + f.phase) * f.size * .075, tailWag = Math.sin(t * (5.7 + f.size * .03) + f.phase) * f.size * .18;
    ctx.save(); ctx.translate(f.x, f.y + Math.sin(t * 1.2 + f.seed) * f.size * .045); ctx.rotate(f.angle + bodyWave * .012); if (Math.cos(f.angle) < 0) ctx.scale(-1, 1); ctx.globalAlpha = .42 + f.depth * .52; ctx.shadowColor = f.kind === "neon" ? "rgba(57,235,235,.15)" : f.kind === "clown" ? "rgba(255,166,108,.1)" : "rgba(176,232,205,.08)"; ctx.shadowBlur = f.kind === "neon" ? 14 : 8;
    ctx.fillStyle = f.kind === "neon" ? "rgba(76,176,182,.72)" : f.kind === "clown" ? "#e8845d" : f.kind === "tang" ? "#c6aa66" : "#d0bd86"; ctx.beginPath(); ctx.moveTo(-L * .42, tailWag * .3); ctx.lineTo(-L * .92, -f.size * .6 + tailWag); ctx.quadraticCurveTo(-L * .73, tailWag * .08, -L * .92, f.size * .62 + tailWag); ctx.lineTo(-L * .42, -tailWag * .2); ctx.closePath(); ctx.fill();
    if (f.kind === "angel") { ctx.fillStyle = "rgba(229,211,154,.48)"; ctx.beginPath(); ctx.moveTo(-L * .14, -H * .48); ctx.quadraticCurveTo(-L * .28, -H * 1.2, L * .02, -H * .57); ctx.lineTo(-L * .05, H * .55); ctx.quadraticCurveTo(-L * .28, H * 1.16, -L * .12, H * .34); ctx.closePath(); ctx.fill(); }
    const body = ctx.createLinearGradient(-L * .5, -H, L * .6, H); if (f.kind === "neon") { body.addColorStop(0, "#167a87"); body.addColorStop(.5, "#2daab0"); body.addColorStop(1, "#83dfcf"); } else if (f.kind === "clown") { body.addColorStop(0, "#bd5e4e"); body.addColorStop(.5, "#f59d6a"); body.addColorStop(1, "#ffd09c"); } else if (f.kind === "tang") { body.addColorStop(0, "#718c6c"); body.addColorStop(.56, "#b7bf7a"); body.addColorStop(1, "#e1ce86"); } else { body.addColorStop(0, "#8e886b"); body.addColorStop(.48, "#ded19a"); body.addColorStop(1, "#f0e0ad"); }
    ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(-L * .48, bodyWave); ctx.bezierCurveTo(-L * .26, -H * .82 + bodyWave, L * .36, -H * .71 - bodyWave, L * .58, -H * .04); ctx.bezierCurveTo(L * .68, H * .4 + bodyWave, L * .2, H * .76 - bodyWave, -L * .48, -bodyWave); ctx.closePath(); ctx.fill();
    if (f.kind === "clown") { ctx.save(); ctx.clip(); ctx.fillStyle = "rgba(255,238,201,.82)"; [-.19, .19].forEach((band) => ctx.fillRect(L * band - f.size * .09, -H, f.size * .13, H * 2)); ctx.restore(); }
    if (f.kind === "neon") { ctx.strokeStyle = "rgba(157,255,235,.9)"; ctx.lineWidth = Math.max(1, f.size * .13); ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(-L * .34, -f.size * .08); ctx.lineTo(L * .31, -f.size * .09); ctx.stroke(); ctx.strokeStyle = "rgba(116,137,255,.64)"; ctx.beginPath(); ctx.moveTo(-L * .27, f.size * .13); ctx.lineTo(L * .28, f.size * .12); ctx.stroke(); }
    if (f.kind === "tang") { ctx.fillStyle = "rgba(43,83,83,.56)"; ctx.beginPath(); ctx.arc(-L * .02, 0, f.size * .24, 0, TAU); ctx.fill(); }
    ctx.shadowBlur = 0; ctx.fillStyle = "rgba(209,244,216,.55)"; ctx.beginPath(); ctx.moveTo(L * .03, -H * .67); ctx.quadraticCurveTo(L * .22, -H * 1.25, L * .41, -H * .32); ctx.quadraticCurveTo(L * .24, -H * .53, L * .03, -H * .67); ctx.fill();
    const finSwing = Math.sin(t * 5.2 + f.phase) * .17; ctx.fillStyle = "rgba(155,232,208,.42)"; ctx.beginPath(); ctx.moveTo(-L * .02, H * .18); ctx.quadraticCurveTo(L * .2 + finSwing * f.size, H * 1.06, L * .38, H * .22); ctx.quadraticCurveTo(L * .2, H * .35, -L * .02, H * .18); ctx.fill();
    ctx.fillStyle = "rgba(28,61,63,.82)"; ctx.beginPath(); ctx.arc(L * .44, -H * .12, Math.max(1.1, f.size * .095), 0, TAU); ctx.fill(); ctx.restore();
  }
  function drawBubbles(t, foreground) {
    foreground = foreground || false; ctx.save();
    bubbles.forEach((bubble, i) => { if (foreground !== (i % 3 === 0)) return; const rise = (t * bubble.speed + bubble.delay * bubble.speed) % (state.height + 60), y = state.height + 30 - rise, x = bubble.x + Math.sin(t * .7 + bubble.phase + rise * .012) * bubble.drift; if (y < state.height * .12 || y > state.height * .96) return; ctx.globalAlpha = bubble.alpha * (.65 + Math.sin(t * 1.6 + bubble.phase) * .16) * (foreground ? 1.2 : .75); ctx.strokeStyle = foreground ? "rgba(198,249,237,.8)" : "rgba(160,228,222,.56)"; ctx.lineWidth = foreground ? 1.15 : .8; ctx.beginPath(); ctx.arc(x, y, bubble.r * (foreground ? 1.2 : .85), 0, TAU); ctx.stroke(); ctx.fillStyle = "rgba(229,255,244,.5)"; ctx.beginPath(); ctx.arc(x - bubble.r * .3, y - bubble.r * .34, Math.max(.5, bubble.r * .17), 0, TAU); ctx.fill(); }); ctx.restore();
  }
  function drawHaze() {
    const haze = ctx.createLinearGradient(0, 0, state.width, 0); haze.addColorStop(0, "rgba(24,122,125,.08)"); haze.addColorStop(.45, "rgba(15,77,91,0)"); haze.addColorStop(1, "rgba(19,104,106,.1)"); ctx.fillStyle = haze; ctx.fillRect(0, 0, state.width, state.height);
    const vignette = ctx.createRadialGradient(state.width / 2, state.height * .47, state.height * .18, state.width / 2, state.height * .48, Math.max(state.width, state.height) * .75); vignette.addColorStop(0, "rgba(0,13,22,0)"); vignette.addColorStop(.72, "rgba(0,13,22,.08)"); vignette.addColorStop(1, "rgba(0,8,15,.48)"); ctx.fillStyle = vignette; ctx.fillRect(0, 0, state.width, state.height);
  }
  function render(t) { drawBackground(t); drawWeeds(t, 0); drawSand(t); drawWeeds(t, 1); fish.slice().sort((a, b) => a.depth - b.depth).forEach((f) => drawFish(f, t)); drawWeeds(t, 2); drawBubbles(t, false); drawBubbles(t, true); drawHaze(); }
  function frame(now) {
    const rawDt = state.last ? (now - state.last) / 1000 : .016; state.last = now; const dt = Math.min(rawDt, .05);
    if (!state.paused && !reducedMotion) { state.time += dt; schools.forEach((school) => updateSchool(school, state.time, dt)); fish.forEach((f) => updateFish(f, state.time, dt)); }
    render(state.time); requestAnimationFrame(frame);
  }
  function updateRange() { const value = Number(flowRange.value); state.flow = value / 100; flowValue.textContent = value + "%"; flowRange.style.setProperty("--range-progress", ((value - 20) / 100) * 100 + "%"); }
  flowRange.addEventListener("input", updateRange);
  pauseButton.addEventListener("click", () => { state.paused = !state.paused; pauseButton.classList.toggle("is-paused", state.paused); pauseButton.setAttribute("aria-pressed", String(state.paused)); pauseButton.setAttribute("aria-label", state.paused ? "Продолжить анимацию" : "Поставить анимацию на паузу"); });
  canvas.addEventListener("pointermove", (event) => { pointer.x = event.clientX / state.width; pointer.y = event.clientY / state.height; pointer.active = true; });
  canvas.addEventListener("pointerleave", () => { pointer.active = false; });
  window.addEventListener("resize", () => { resize(); seedFish(); });
  updateRange(); resize(); seedFish(); requestAnimationFrame(frame);
})();
