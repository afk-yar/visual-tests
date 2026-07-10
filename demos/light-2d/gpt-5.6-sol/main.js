(() => {
  "use strict";

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d", { alpha: false });
  const debugToggle = document.getElementById("debug");
  const TAU = Math.PI * 2;
  const EPSILON = 0.000075;

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    time: 0,
    lastTime: performance.now(),
    debug: false,
    pointer: { x: innerWidth * 0.64, y: innerHeight * 0.45 },
    light: { x: innerWidth * 0.64, y: innerHeight * 0.45 },
    polygons: [],
    segments: [],
    vertices: []
  };

  function polygon(points, style = 0) {
    return { points, style };
  }

  function buildScene() {
    const w = state.width;
    const h = state.height;

    state.polygons = [
      polygon([
        { x: w * .17, y: h * .34 },
        { x: w * .29, y: h * .29 },
        { x: w * .35, y: h * .39 },
        { x: w * .31, y: h * .51 },
        { x: w * .20, y: h * .49 }
      ], 0),
      polygon([
        { x: w * .49, y: h * .16 },
        { x: w * .61, y: h * .19 },
        { x: w * .64, y: h * .31 },
        { x: w * .54, y: h * .35 },
        { x: w * .46, y: h * .27 }
      ], 1),
      polygon([
        { x: w * .69, y: h * .48 },
        { x: w * .79, y: h * .40 },
        { x: w * .88, y: h * .47 },
        { x: w * .86, y: h * .63 },
        { x: w * .74, y: h * .66 },
        { x: w * .67, y: h * .58 }
      ], 2),
      polygon([
        { x: w * .36, y: h * .68 },
        { x: w * .48, y: h * .61 },
        { x: w * .58, y: h * .68 },
        { x: w * .55, y: h * .83 },
        { x: w * .41, y: h * .85 },
        { x: w * .33, y: h * .77 }
      ], 1),
      polygon([
        { x: w * .10, y: h * .71 },
        { x: w * .19, y: h * .65 },
        { x: w * .26, y: h * .73 },
        { x: w * .22, y: h * .87 },
        { x: w * .11, y: h * .85 }
      ], 2),
      polygon([
        { x: w * .82, y: h * .16 },
        { x: w * .89, y: h * .13 },
        { x: w * .93, y: h * .22 },
        { x: w * .88, y: h * .29 },
        { x: w * .80, y: h * .25 }
      ], 0)
    ];

    const frame = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h }
    ];

    state.segments = [];
    state.vertices = frame.slice();
    addEdges(frame, true);
    for (const shape of state.polygons) {
      addEdges(shape.points, false);
      state.vertices.push(...shape.points);
    }
  }

  function addEdges(points, boundary) {
    for (let i = 0; i < points.length; i++) {
      state.segments.push({
        a: points[i],
        b: points[(i + 1) % points.length],
        boundary
      });
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    state.width = Math.max(1, rect.width);
    state.height = Math.max(1, rect.height);
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    buildScene();
  }

  function raySegmentIntersection(origin, dx, dy, segment) {
    const sx = segment.b.x - segment.a.x;
    const sy = segment.b.y - segment.a.y;
    const qpx = segment.a.x - origin.x;
    const qpy = segment.a.y - origin.y;
    const cross = dx * sy - dy * sx;

    if (Math.abs(cross) < 1e-10) return null;

    const t = (qpx * sy - qpy * sx) / cross;
    const u = (qpx * dy - qpy * dx) / cross;
    if (t < 0 || u < -1e-9 || u > 1 + 1e-9) return null;

    return { x: origin.x + dx * t, y: origin.y + dy * t, distance: t };
  }

  function visibilityPolygon(origin) {
    const angles = [];
    for (const vertex of state.vertices) {
      const angle = Math.atan2(vertex.y - origin.y, vertex.x - origin.x);
      angles.push(angle - EPSILON, angle, angle + EPSILON);
    }

    const hits = [];
    for (const angle of angles) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let nearest = null;

      for (const segment of state.segments) {
        const hit = raySegmentIntersection(origin, dx, dy, segment);
        if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
      }

      if (nearest) hits.push({ x: nearest.x, y: nearest.y, angle });
    }

    hits.sort((a, b) => a.angle - b.angle);
    return hits;
  }

  function pathPolygon(points) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
  }

  function drawBackdrop() {
    const w = state.width;
    const h = state.height;
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#0a0e19");
    base.addColorStop(.48, "#070a12");
    base.addColorStop(1, "#0d1018");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = .14;
    ctx.strokeStyle = "#7d879d";
    ctx.lineWidth = .6;
    ctx.beginPath();
    for (let x = .5; x < w; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = .5; y < h; y += 48) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.restore();

    const vignette = ctx.createRadialGradient(
      w * .5, h * .48, Math.min(w, h) * .12,
      w * .5, h * .5, Math.max(w, h) * .72
    );
    vignette.addColorStop(0, "rgba(8,10,18,0)");
    vignette.addColorStop(1, "rgba(0,1,5,.48)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  function drawLight(poly) {
    const light = state.light;
    const radius = Math.hypot(state.width, state.height) * .68;

    ctx.save();
    pathPolygon(poly);
    ctx.clip();

    const haze = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, radius);
    haze.addColorStop(0, "rgba(255,246,198,.98)");
    haze.addColorStop(.08, "rgba(255,214,111,.90)");
    haze.addColorStop(.27, "rgba(236,157,64,.48)");
    haze.addColorStop(.58, "rgba(122,80,51,.18)");
    haze.addColorStop(1, "rgba(18,20,31,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, state.width, state.height);

    const core = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, 180);
    core.addColorStop(0, "rgba(255,255,235,.54)");
    core.addColorStop(.25, "rgba(255,205,94,.24)");
    core.addColorStop(1, "rgba(255,178,60,0)");
    ctx.fillStyle = core;
    ctx.fillRect(light.x - 180, light.y - 180, 360, 360);
    ctx.restore();

    ctx.save();
    pathPolygon(poly);
    ctx.strokeStyle = "rgba(255,205,107,.12)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawObstacles() {
    const fills = ["#101621", "#111722", "#0e141e"];
    for (const shape of state.polygons) {
      ctx.save();
      pathPolygon(shape.points);
      ctx.shadowColor = "rgba(0,0,0,.66)";
      ctx.shadowBlur = 24;
      ctx.shadowOffsetX = 8;
      ctx.shadowOffsetY = 12;
      ctx.fillStyle = fills[shape.style];
      ctx.fill();
      ctx.shadowColor = "transparent";

      const edge = ctx.createLinearGradient(0, 0, state.width, state.height);
      edge.addColorStop(0, "rgba(196,207,225,.27)");
      edge.addColorStop(.45, "rgba(100,112,133,.13)");
      edge.addColorStop(1, "rgba(0,0,0,.35)");
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawSource() {
    const { x, y } = state.light;
    const pulse = 1 + Math.sin(state.time * 2.4) * .035;

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const aura = ctx.createRadialGradient(x, y, 0, x, y, 72 * pulse);
    aura.addColorStop(0, "rgba(255,255,238,.95)");
    aura.addColorStop(.08, "rgba(255,224,142,.84)");
    aura.addColorStop(.27, "rgba(255,180,58,.28)");
    aura.addColorStop(1, "rgba(255,151,35,0)");
    ctx.fillStyle = aura;
    ctx.fillRect(x - 82, y - 82, 164, 164);

    ctx.shadowColor = "#ffd070";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(x, y, 4.5 * pulse, 0, TAU);
    ctx.fillStyle = "#fffce6";
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, 10, 0, TAU);
    ctx.strokeStyle = "rgba(255,242,194,.36)";
    ctx.lineWidth = .8;
    ctx.stroke();
  }

  function drawDebug(poly) {
    if (!state.debug) return;

    ctx.save();
    ctx.lineWidth = .55;
    ctx.strokeStyle = "rgba(255,210,93,.22)";
    ctx.beginPath();
    for (const point of poly) {
      ctx.moveTo(state.light.x, state.light.y);
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();

    for (const shape of state.polygons) {
      for (const vertex of shape.points) {
        ctx.beginPath();
        ctx.arc(vertex.x, vertex.y, 3.2, 0, TAU);
        ctx.fillStyle = "#73e2ff";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(vertex.x, vertex.y, 7, 0, TAU);
        ctx.strokeStyle = "rgba(115,226,255,.34)";
        ctx.stroke();
      }
    }

    for (const point of poly) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.35, 0, TAU);
      ctx.fillStyle = "rgba(255,211,105,.76)";
      ctx.fill();
    }
    ctx.restore();
  }

  function render(now) {
    const dt = Math.min((now - state.lastTime) / 1000, .05);
    state.lastTime = now;
    state.time += dt;

    const smoothing = 1 - Math.exp(-11 * dt);
    state.light.x += (state.pointer.x - state.light.x) * smoothing;
    state.light.y += (state.pointer.y - state.light.y) * smoothing;

    const poly = visibilityPolygon(state.light);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    drawBackdrop();
    drawLight(poly);
    drawObstacles();
    drawDebug(poly);
    drawSource();
    requestAnimationFrame(render);
  }

  function setPointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    state.pointer.x = Math.max(1, Math.min(state.width - 1, clientX - rect.left));
    state.pointer.y = Math.max(1, Math.min(state.height - 1, clientY - rect.top));
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", event => setPointer(event.clientX, event.clientY), { passive: true });
  window.addEventListener("pointerdown", event => setPointer(event.clientX, event.clientY), { passive: true });
  debugToggle.addEventListener("change", () => { state.debug = debugToggle.checked; });

  resize();
  requestAnimationFrame(render);
})();
