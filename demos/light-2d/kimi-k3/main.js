"use strict";

(function () {
  var canvas = document.getElementById("scene");
  var ctx = canvas.getContext("2d");
  var debugBox = document.getElementById("debug");
  var regenBtn = document.getElementById("regen");

  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0; // CSS pixels
  var H = 0;

  // ---------- Scene: obstacle polygons ----------
  var polygons = []; // array of arrays of {x, y}
  var segments = []; // {x1, y1, x2, y2}
  var vertices = []; // {x, y}

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function makePolygon(cx, cy, r, n) {
    // Convex-ish polygon: sorted angles, varied radius
    var pts = [];
    var a0 = rand(0, Math.PI * 2);
    for (var i = 0; i < n; i++) {
      var a = a0 + (i / n) * Math.PI * 2 + rand(-0.18, 0.18);
      var rr = r * rand(0.65, 1.25);
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
    return pts;
  }

  function buildScene() {
    polygons = [];
    var count = Math.max(5, Math.round((W * H) / 130000));
    var pad = 40;
    for (var i = 0; i < count; i++) {
      var r = rand(26, Math.min(90, Math.min(W, H) * 0.12));
      var cx = rand(pad + r, W - pad - r);
      var cy = rand(pad + r, H - pad - r);
      var n = 3 + Math.floor(Math.random() * 4); // 3..6 sides
      polygons.push(makePolygon(cx, cy, r, n));
    }
    rebuildGeometry();
  }

  function rebuildGeometry() {
    segments = [];
    vertices = [];
    // Border of the screen limits the rays
    segments.push({ x1: 0, y1: 0, x2: W, y2: 0 });
    segments.push({ x1: W, y1: 0, x2: W, y2: H });
    segments.push({ x1: W, y1: H, x2: 0, y2: H });
    segments.push({ x1: 0, y1: H, x2: 0, y2: 0 });
    for (var i = 0; i < polygons.length; i++) {
      var poly = polygons[i];
      for (var j = 0; j < poly.length; j++) {
        var p = poly[j];
        var q = poly[(j + 1) % poly.length];
        segments.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
        vertices.push(p);
      }
    }
  }

  // ---------- Visibility polygon ----------
  // Ray/segment intersection: ray from (ox, oy) along (dx, dy),
  // segment (x1,y1)-(x2,y2). Returns distance t >= 0 or Infinity.
  function rayHit(ox, oy, dx, dy, s) {
    var ex = s.x2 - s.x1;
    var ey = s.y2 - s.y1;
    var denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) return Infinity; // parallel
    var t = ((s.x1 - ox) * ey - (s.y1 - oy) * ex) / denom;
    var u = ((s.x1 - ox) * dy - (s.y1 - oy) * dx) / denom;
    if (t >= 0 && u >= 0 && u <= 1) return t;
    return Infinity;
  }

  var ANGLE_EPS = 0.0001;

  function castRay(ox, oy, angle) {
    var dx = Math.cos(angle);
    var dy = Math.sin(angle);
    var best = Infinity;
    for (var i = 0; i < segments.length; i++) {
      var t = rayHit(ox, oy, dx, dy, segments[i]);
      if (t < best) best = t;
    }
    if (!isFinite(best)) best = Math.hypot(W, H); // safety, borders normally hit
    return { x: ox + dx * best, y: oy + dy * best, angle: angle };
  }

  function visibilityPolygon(ox, oy) {
    var pts = [];
    for (var i = 0; i < vertices.length; i++) {
      var base = Math.atan2(vertices[i].y - oy, vertices[i].x - ox);
      pts.push(castRay(ox, oy, base - ANGLE_EPS));
      pts.push(castRay(ox, oy, base));
      pts.push(castRay(ox, oy, base + ANGLE_EPS));
    }
    pts.sort(function (a, b) { return a.angle - b.angle; });
    return pts;
  }

  // ---------- Light state ----------
  var lightX = 0;
  var lightY = 0;
  var targetX = 0;
  var targetY = 0;
  var hasPointer = false;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    if (!hasPointer) {
      targetX = W / 2;
      targetY = H / 2;
      lightX = targetX;
      lightY = targetY;
    }
    buildScene();
  }

  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", function (e) {
    hasPointer = true;
    targetX = e.clientX;
    targetY = e.clientY;
  });
  window.addEventListener("touchmove", function (e) {
    if (e.touches.length > 0) {
      hasPointer = true;
      targetX = e.touches[0].clientX;
      targetY = e.touches[0].clientY;
      e.preventDefault();
    }
  }, { passive: false });

  regenBtn.addEventListener("click", buildScene);

  // ---------- Rendering ----------
  function drawFrame(vis, lx, ly, time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, W, H);

    var maxR = Math.hypot(W, H);

    // Lit area: visibility polygon filled with a radial gradient
    if (vis.length > 0) {
      var grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, maxR);
      grad.addColorStop(0, "rgba(255, 214, 140, 0.85)");
      grad.addColorStop(0.25, "rgba(255, 190, 110, 0.38)");
      grad.addColorStop(0.6, "rgba(160, 120, 70, 0.10)");
      grad.addColorStop(1, "rgba(80, 60, 40, 0)");
      ctx.beginPath();
      ctx.moveTo(vis[0].x, vis[0].y);
      for (var i = 1; i < vis.length; i++) ctx.lineTo(vis[i].x, vis[i].y);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Obstacles on top of the light
    for (var p = 0; p < polygons.length; p++) {
      var poly = polygons[p];
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (var k = 1; k < poly.length; k++) ctx.lineTo(poly[k].x, poly[k].y);
      ctx.closePath();
      ctx.fillStyle = "#11141d";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 200, 120, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Soft glow around the source (pulsing slightly)
    var pulse = 1 + Math.sin(time * 2.2) * 0.06;
    var glowR = 90 * pulse;
    var glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, glowR);
    glow.addColorStop(0, "rgba(255, 236, 190, 0.95)");
    glow.addColorStop(0.25, "rgba(255, 210, 130, 0.45)");
    glow.addColorStop(1, "rgba(255, 200, 110, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lx, ly, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Core of the source
    ctx.fillStyle = "#fff6e0";
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fill();

    // Debug: rays and vertices
    if (debugBox.checked) {
      ctx.strokeStyle = "rgba(120, 200, 255, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var r = 0; r < vis.length; r++) {
        ctx.moveTo(lx, ly);
        ctx.lineTo(vis[r].x, vis[r].y);
      }
      ctx.stroke();

      // Visibility polygon outline
      if (vis.length > 0) {
        ctx.strokeStyle = "rgba(120, 220, 160, 0.6)";
        ctx.beginPath();
        ctx.moveTo(vis[0].x, vis[0].y);
        for (var m = 1; m < vis.length; m++) ctx.lineTo(vis[m].x, vis[m].y);
        ctx.closePath();
        ctx.stroke();
      }

      // Vertices of the obstacles
      ctx.fillStyle = "#ff6b81";
      for (var v = 0; v < vertices.length; v++) {
        ctx.beginPath();
        ctx.arc(vertices[v].x, vertices[v].y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---------- Main loop ----------
  var last = performance.now();

  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp big dt (tab switch etc.)
    if (dt < 0) dt = 0;

    // Smoothly ease the light towards the cursor
    var k = 1 - Math.exp(-dt * 14);
    lightX += (targetX - lightX) * k;
    lightY += (targetY - lightY) * k;

    var vis = visibilityPolygon(lightX, lightY);
    drawFrame(vis, lightX, lightY, now / 1000);

    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);
})();
