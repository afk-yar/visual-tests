(function () {
  "use strict";

  var canvas = document.getElementById("scene");
  var ctx = canvas.getContext("2d", { alpha: false });
  var debugToggle = document.getElementById("debugToggle");
  var stats = document.getElementById("stats");

  var EPSILON_ANGLE = 0.00009;
  var INTERSECTION_EPSILON = 0.000001;
  var TAU = Math.PI * 2;
  var DPR_CAP = 2.5;

  var view = {
    cssWidth: 1,
    cssHeight: 1,
    dpr: 1,
    diagonal: 1
  };

  var pointer = {
    x: 0,
    y: 0,
    active: false
  };

  var light = {
    x: 0,
    y: 0
  };

  var polygons = [];
  var segments = [];
  var vertices = [];
  var visibility = [];
  var debugRays = [];
  var rayCount = 0;
  var needsGeometry = true;
  var frame = 0;

  var obstacleModels = [
    {
      fill: "#151923",
      rim: "#39445a",
      points: [
        [0.145, 0.175],
        [0.27, 0.13],
        [0.33, 0.275],
        [0.225, 0.36],
        [0.12, 0.305]
      ]
    },
    {
      fill: "#17151e",
      rim: "#514258",
      points: [
        [0.59, 0.095],
        [0.72, 0.15],
        [0.695, 0.302],
        [0.55, 0.335],
        [0.49, 0.202]
      ]
    },
    {
      fill: "#101d22",
      rim: "#345762",
      points: [
        [0.78, 0.47],
        [0.91, 0.405],
        [0.955, 0.555],
        [0.85, 0.665],
        [0.735, 0.59]
      ]
    },
    {
      fill: "#181713",
      rim: "#5d5035",
      points: [
        [0.35, 0.58],
        [0.46, 0.53],
        [0.56, 0.615],
        [0.535, 0.755],
        [0.405, 0.81],
        [0.3, 0.705]
      ]
    },
    {
      fill: "#121721",
      rim: "#405071",
      points: [
        [0.07, 0.69],
        [0.19, 0.64],
        [0.27, 0.735],
        [0.22, 0.875],
        [0.085, 0.845]
      ]
    },
    {
      fill: "#1b1416",
      rim: "#6a3e43",
      points: [
        [0.64, 0.78],
        [0.705, 0.72],
        [0.79, 0.745],
        [0.815, 0.855],
        [0.735, 0.925],
        [0.642, 0.89]
      ]
    }
  ];

  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    var cssWidth = Math.max(1, rect.width || window.innerWidth || 1);
    var cssHeight = Math.max(1, rect.height || window.innerHeight || 1);
    var dpr = Math.min(DPR_CAP, Math.max(1, window.devicePixelRatio || 1));

    if (
      canvas.width !== Math.round(cssWidth * dpr) ||
      canvas.height !== Math.round(cssHeight * dpr)
    ) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }

    view.cssWidth = cssWidth;
    view.cssHeight = cssHeight;
    view.dpr = dpr;
    view.diagonal = Math.hypot(cssWidth, cssHeight);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!pointer.active) {
      pointer.x = cssWidth * 0.52;
      pointer.y = cssHeight * 0.48;
      light.x = pointer.x;
      light.y = pointer.y;
    } else {
      pointer.x = clamp(pointer.x, 0, cssWidth);
      pointer.y = clamp(pointer.y, 0, cssHeight);
      light.x = clamp(light.x, 0, cssWidth);
      light.y = clamp(light.y, 0, cssHeight);
    }

    rebuildWorld();
    needsGeometry = true;
  }

  function rebuildWorld() {
    var w = view.cssWidth;
    var h = view.cssHeight;
    var scale = Math.min(w, h);
    var inset = Math.max(8, scale * 0.012);

    polygons = obstacleModels.map(function (model, polygonIndex) {
      var points = model.points.map(function (point, pointIndex) {
        var wobble = softWobble(polygonIndex, pointIndex);
        return {
          x: point[0] * w + wobble.x * scale,
          y: point[1] * h + wobble.y * scale
        };
      });

      return {
        fill: model.fill,
        rim: model.rim,
        points: points
      };
    });

    segments = [
      segment(point(inset, inset), point(w - inset, inset), -1),
      segment(point(w - inset, inset), point(w - inset, h - inset), -1),
      segment(point(w - inset, h - inset), point(inset, h - inset), -1),
      segment(point(inset, h - inset), point(inset, inset), -1)
    ];

    vertices = [
      vertex(inset, inset, true),
      vertex(w - inset, inset, true),
      vertex(w - inset, h - inset, true),
      vertex(inset, h - inset, true)
    ];

    polygons.forEach(function (poly, polygonIndex) {
      for (var i = 0; i < poly.points.length; i += 1) {
        var a = poly.points[i];
        var b = poly.points[(i + 1) % poly.points.length];
        segments.push(segment(a, b, polygonIndex));
        vertices.push(vertex(a.x, a.y, false));
      }
    });
  }

  function softWobble(polygonIndex, pointIndex) {
    var seed = polygonIndex * 9.137 + pointIndex * 4.271;
    return {
      x: Math.sin(seed) * 0.006,
      y: Math.cos(seed * 1.33) * 0.006
    };
  }

  function point(x, y) {
    return { x: x, y: y };
  }

  function vertex(x, y, boundary) {
    return { x: x, y: y, boundary: boundary };
  }

  function segment(a, b, polygonIndex) {
    return {
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      polygonIndex: polygonIndex
    };
  }

  function computeVisibility() {
    var rays = [];
    debugRays = [];

    for (var i = 0; i < vertices.length; i += 1) {
      var v = vertices[i];
      var angle = Math.atan2(v.y - light.y, v.x - light.x);
      rays.push(angle - EPSILON_ANGLE, angle, angle + EPSILON_ANGLE);
    }

    var hits = [];
    for (var r = 0; r < rays.length; r += 1) {
      var hit = castRay(rays[r]);
      if (hit) {
        hits.push(hit);
        debugRays.push(hit);
      }
    }

    hits.sort(function (a, b) {
      return a.angle - b.angle || a.distance - b.distance;
    });

    visibility = cullNearlyIdentical(hits);
    rayCount = rays.length;
    stats.textContent = rayCount + " лучей";
    needsGeometry = false;
  }

  function castRay(angle) {
    var dx = Math.cos(angle);
    var dy = Math.sin(angle);
    var closest = null;

    for (var i = 0; i < segments.length; i += 1) {
      var candidate = raySegmentIntersection(light.x, light.y, dx, dy, segments[i]);
      if (!candidate) {
        continue;
      }

      if (!closest || candidate.distance < closest.distance) {
        closest = candidate;
        closest.segmentIndex = i;
        closest.angle = normalizeAngle(angle);
      }
    }

    return closest;
  }

  function raySegmentIntersection(px, py, rdx, rdy, seg) {
    var sx = seg.bx - seg.ax;
    var sy = seg.by - seg.ay;
    var qpx = seg.ax - px;
    var qpy = seg.ay - py;
    var cross = cross2(rdx, rdy, sx, sy);

    if (Math.abs(cross) < INTERSECTION_EPSILON) {
      return null;
    }

    var t = cross2(qpx, qpy, sx, sy) / cross;
    var u = cross2(qpx, qpy, rdx, rdy) / cross;

    if (t < 0 || u < -INTERSECTION_EPSILON || u > 1 + INTERSECTION_EPSILON) {
      return null;
    }

    return {
      x: px + rdx * t,
      y: py + rdy * t,
      distance: t,
      edge: seg
    };
  }

  function cullNearlyIdentical(points) {
    var result = [];
    var last = null;
    var threshold = 0.08;

    for (var i = 0; i < points.length; i += 1) {
      var p = points[i];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > threshold) {
        result.push(p);
        last = p;
      }
    }

    if (result.length > 2) {
      var first = result[0];
      var finalPoint = result[result.length - 1];
      if (Math.hypot(first.x - finalPoint.x, first.y - finalPoint.y) <= threshold) {
        result.pop();
      }
    }

    return result;
  }

  function normalizeAngle(angle) {
    var normalized = angle % TAU;
    return normalized < 0 ? normalized + TAU : normalized;
  }

  function cross2(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  function render() {
    frame += 1;
    var drift = pointer.active ? 1 : 0.004;
    if (!pointer.active) {
      pointer.x =
        view.cssWidth * (0.5 + Math.cos(frame * 0.006) * 0.22) +
        Math.sin(frame * 0.011) * view.cssWidth * 0.04;
      pointer.y =
        view.cssHeight * (0.5 + Math.sin(frame * 0.007) * 0.19) +
        Math.cos(frame * 0.009) * view.cssHeight * 0.035;
      drift = 0.07;
    }

    var previousX = light.x;
    var previousY = light.y;
    light.x += (pointer.x - light.x) * drift;
    light.y += (pointer.y - light.y) * drift;

    if (Math.hypot(light.x - previousX, light.y - previousY) > 0.02) {
      needsGeometry = true;
    }

    if (needsGeometry) {
      computeVisibility();
    }

    draw();
    requestAnimationFrame(render);
  }

  function draw() {
    var w = view.cssWidth;
    var h = view.cssHeight;
    ctx.clearRect(0, 0, w, h);
    drawBackground(w, h);
    drawVisibility(w, h);
    drawLongShadows();
    drawObstacles();
    drawLightSource();

    if (debugToggle.checked) {
      drawDebug();
    }
  }

  function drawBackground(w, h) {
    var sky = ctx.createLinearGradient(0, 0, w, h);
    sky.addColorStop(0, "#080a12");
    sky.addColorStop(0.45, "#0b1018");
    sky.addColorStop(1, "#09070b");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = "rgba(123, 146, 174, 0.055)";
    ctx.lineWidth = 1;
    var gap = Math.max(26, Math.min(46, Math.round(Math.min(w, h) / 12)));
    var offsetX = (light.x * -0.018) % gap;
    var offsetY = (light.y * -0.018) % gap;

    ctx.beginPath();
    for (var x = offsetX; x < w + gap; x += gap) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (var y = offsetY; y < h + gap; y += gap) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var haze = ctx.createRadialGradient(
      w * 0.18,
      h * 0.16,
      0,
      w * 0.18,
      h * 0.16,
      view.diagonal * 0.5
    );
    haze.addColorStop(0, "rgba(44, 125, 145, 0.15)");
    haze.addColorStop(1, "rgba(44, 125, 145, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function drawVisibility(w, h) {
    if (visibility.length < 3) {
      return;
    }

    ctx.save();
    traceVisibilityPath();
    ctx.clip();

    var maxRadius = Math.max(view.diagonal * 0.72, 320);
    var gradient = ctx.createRadialGradient(
      light.x,
      light.y,
      0,
      light.x,
      light.y,
      maxRadius
    );
    gradient.addColorStop(0, "rgba(255, 245, 190, 0.96)");
    gradient.addColorStop(0.08, "rgba(255, 216, 119, 0.68)");
    gradient.addColorStop(0.27, "rgba(255, 168, 84, 0.28)");
    gradient.addColorStop(0.62, "rgba(106, 176, 190, 0.105)");
    gradient.addColorStop(1, "rgba(255, 182, 82, 0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = "screen";
    var inner = ctx.createRadialGradient(
      light.x,
      light.y,
      0,
      light.x,
      light.y,
      Math.max(90, maxRadius * 0.22)
    );
    inner.addColorStop(0, "rgba(255, 250, 222, 0.52)");
    inner.addColorStop(0.35, "rgba(255, 201, 92, 0.18)");
    inner.addColorStop(1, "rgba(255, 201, 92, 0)");
    ctx.fillStyle = inner;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    ctx.save();
    traceVisibilityPath();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = "rgba(255, 225, 152, 0.2)";
    ctx.shadowColor = "rgba(255, 184, 92, 0.26)";
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.restore();
  }

  function traceVisibilityPath() {
    ctx.beginPath();
    ctx.moveTo(visibility[0].x, visibility[0].y);
    for (var i = 1; i < visibility.length; i += 1) {
      ctx.lineTo(visibility[i].x, visibility[i].y);
    }
    ctx.closePath();
  }

  function drawLongShadows() {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgba(1, 3, 9, 0.48)";

    for (var i = 0; i < polygons.length; i += 1) {
      var poly = polygons[i];
      for (var p = 0; p < poly.points.length; p += 1) {
        var a = poly.points[p];
        var b = poly.points[(p + 1) % poly.points.length];
        var midX = (a.x + b.x) * 0.5;
        var midY = (a.y + b.y) * 0.5;
        var edgeX = b.x - a.x;
        var edgeY = b.y - a.y;
        var toLightX = light.x - midX;
        var toLightY = light.y - midY;
        var facing = cross2(edgeX, edgeY, toLightX, toLightY);

        if (facing > 0) {
          continue;
        }

        var ax = a.x - light.x;
        var ay = a.y - light.y;
        var bx = b.x - light.x;
        var by = b.y - light.y;
        var stretch = view.diagonal * 2.2;
        var al = Math.max(1, Math.hypot(ax, ay));
        var bl = Math.max(1, Math.hypot(bx, by));

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b.x + (bx / bl) * stretch, b.y + (by / bl) * stretch);
        ctx.lineTo(a.x + (ax / al) * stretch, a.y + (ay / al) * stretch);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawObstacles() {
    for (var i = 0; i < polygons.length; i += 1) {
      var poly = polygons[i];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(poly.points[0].x, poly.points[0].y);
      for (var p = 1; p < poly.points.length; p += 1) {
        ctx.lineTo(poly.points[p].x, poly.points[p].y);
      }
      ctx.closePath();

      var bounds = boundsOf(poly.points);
      var fill = ctx.createLinearGradient(bounds.left, bounds.top, bounds.right, bounds.bottom);
      fill.addColorStop(0, mixWithLight(poly.fill, 0.28));
      fill.addColorStop(1, poly.fill);

      ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
      ctx.shadowBlur = 22;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 10;
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.shadowColor = "transparent";
      ctx.lineJoin = "round";
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(242, 246, 255, 0.08)";
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = poly.rim;
      ctx.globalAlpha = 0.45;
      ctx.stroke();
      ctx.restore();
    }
  }

  function boundsOf(points) {
    var left = Infinity;
    var top = Infinity;
    var right = -Infinity;
    var bottom = -Infinity;
    for (var i = 0; i < points.length; i += 1) {
      left = Math.min(left, points[i].x);
      top = Math.min(top, points[i].y);
      right = Math.max(right, points[i].x);
      bottom = Math.max(bottom, points[i].y);
    }
    return { left: left, top: top, right: right, bottom: bottom };
  }

  function mixWithLight(hex, amount) {
    var color = parseInt(hex.slice(1), 16);
    var r = (color >> 16) & 255;
    var g = (color >> 8) & 255;
    var b = color & 255;
    r = Math.round(r + (255 - r) * amount);
    g = Math.round(g + (220 - g) * amount);
    b = Math.round(b + (160 - b) * amount);
    return "rgb(" + r + ", " + g + ", " + b + ")";
  }

  function drawLightSource() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    var halo = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, 86);
    halo.addColorStop(0, "rgba(255, 250, 219, 0.88)");
    halo.addColorStop(0.22, "rgba(255, 213, 113, 0.4)");
    halo.addColorStop(0.62, "rgba(255, 155, 79, 0.13)");
    halo.addColorStop(1, "rgba(255, 155, 79, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(light.x, light.y, 86, 0, TAU);
    ctx.fill();

    var core = ctx.createRadialGradient(light.x - 2, light.y - 2, 0, light.x, light.y, 15);
    core.addColorStop(0, "#fffdf0");
    core.addColorStop(0.45, "#ffd064");
    core.addColorStop(1, "rgba(244, 117, 50, 0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(light.x, light.y, 15, 0, TAU);
    ctx.fill();

    ctx.restore();

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 248, 209, 0.7)";
    ctx.beginPath();
    ctx.arc(light.x, light.y, 5.5, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawDebug() {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.globalCompositeOperation = "screen";
    ctx.strokeStyle = "rgba(93, 210, 255, 0.17)";
    ctx.beginPath();

    for (var i = 0; i < debugRays.length; i += 1) {
      var ray = debugRays[i];
      ctx.moveTo(light.x, light.y);
      ctx.lineTo(ray.x, ray.y);
    }

    ctx.stroke();

    ctx.fillStyle = "rgba(97, 224, 255, 0.94)";
    for (var v = 0; v < vertices.length; v += 1) {
      if (vertices[v].boundary) {
        continue;
      }
      ctx.beginPath();
      ctx.arc(vertices[v].x, vertices[v].y, 3.25, 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(255, 236, 143, 0.95)";
    for (var p = 0; p < visibility.length; p += 1) {
      ctx.beginPath();
      ctx.arc(visibility[p].x, visibility[p].y, 2.2, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  function updatePointerFromEvent(event) {
    var rect = canvas.getBoundingClientRect();
    pointer.x = clamp(event.clientX - rect.left, 0, rect.width);
    pointer.y = clamp(event.clientY - rect.top, 0, rect.height);
    pointer.active = true;
    needsGeometry = true;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  canvas.addEventListener("pointermove", updatePointerFromEvent, { passive: true });
  canvas.addEventListener("pointerdown", function (event) {
    updatePointerFromEvent(event);
    if (canvas.setPointerCapture) {
      canvas.setPointerCapture(event.pointerId);
    }
  });
  canvas.addEventListener("pointerleave", function () {
    pointer.active = false;
  });
  debugToggle.addEventListener("change", function () {
    needsGeometry = true;
  });
  window.addEventListener("resize", fitCanvas);

  fitCanvas();
  requestAnimationFrame(render);
})();
