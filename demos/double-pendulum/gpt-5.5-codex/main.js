(function () {
  "use strict";

  var canvas = document.getElementById("pendulumCanvas");
  var ctx = canvas.getContext("2d");

  var controls = {
    toggleButton: document.getElementById("toggleButton"),
    resetButton: document.getElementById("resetButton"),
    ghostToggle: document.getElementById("ghostToggle"),
    stateText: document.getElementById("stateText"),
    timeReadout: document.getElementById("timeReadout"),
    deltaReadout: document.getElementById("deltaReadout"),
    m1: document.getElementById("m1"),
    m2: document.getElementById("m2"),
    l1: document.getElementById("l1"),
    l2: document.getElementById("l2"),
    m1Value: document.getElementById("m1Value"),
    m2Value: document.getElementById("m2Value"),
    l1Value: document.getElementById("l1Value"),
    l2Value: document.getElementById("l2Value")
  };

  var TAU = Math.PI * 2;
  var FIXED_STEP = 1 / 240;
  var MAX_FRAME_TIME = 0.06;
  var MAX_SUBSTEPS = 24;
  var TRAIL_SECONDS = 8.5;
  var GHOST_EPSILON = 0.0008;

  var running = true;
  var accumulator = 0;
  var lastTimestamp = 0;
  var simTime = 0;
  var dpr = 1;
  var view = {
    width: 1,
    height: 1,
    pivotX: 0,
    pivotY: 0,
    scale: 1
  };

  var params = readParams();
  var mainState = makeInitialState(0);
  var ghostState = makeInitialState(GHOST_EPSILON);
  var mainTrail = [];
  var ghostTrail = [];
  var lastMainTrailPoint = null;
  var lastGhostTrailPoint = null;

  function readParams() {
    return {
      m1: readNumber(controls.m1, 1.4),
      m2: readNumber(controls.m2, 1.0),
      l1: readNumber(controls.l1, 1.05),
      l2: readNumber(controls.l2, 1.0),
      g: 9.81
    };
  }

  function readNumber(input, fallback) {
    var value = Number(input.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function makeInitialState(thetaOffset) {
    return {
      theta1: toRadians(118) + thetaOffset,
      omega1: 0,
      theta2: toRadians(-28),
      omega2: 0
    };
  }

  function toRadians(degrees) {
    return degrees * Math.PI / 180;
  }

  function wrapAngle(angle) {
    angle = (angle + Math.PI) % TAU;
    if (angle < 0) {
      angle += TAU;
    }
    return angle - Math.PI;
  }

  function derivatives(state, p) {
    var theta1 = state.theta1;
    var theta2 = state.theta2;
    var omega1 = state.omega1;
    var omega2 = state.omega2;
    var m1 = p.m1;
    var m2 = p.m2;
    var l1 = p.l1;
    var l2 = p.l2;
    var g = p.g;
    var delta = theta1 - theta2;
    var sharedDenominator = 2 * m1 + m2 - m2 * Math.cos(2 * delta);

    var a1Numerator =
      -g * (2 * m1 + m2) * Math.sin(theta1) -
      m2 * g * Math.sin(theta1 - 2 * theta2) -
      2 * Math.sin(delta) * m2 *
      (omega2 * omega2 * l2 + omega1 * omega1 * l1 * Math.cos(delta));

    var a2Numerator =
      2 * Math.sin(delta) *
      (omega1 * omega1 * l1 * (m1 + m2) +
        g * (m1 + m2) * Math.cos(theta1) +
        omega2 * omega2 * l2 * m2 * Math.cos(delta));

    return {
      theta1: omega1,
      omega1: a1Numerator / (l1 * sharedDenominator),
      theta2: omega2,
      omega2: a2Numerator / (l2 * sharedDenominator)
    };
  }

  function addScaledState(state, slope, scale) {
    return {
      theta1: state.theta1 + slope.theta1 * scale,
      omega1: state.omega1 + slope.omega1 * scale,
      theta2: state.theta2 + slope.theta2 * scale,
      omega2: state.omega2 + slope.omega2 * scale
    };
  }

  function rk4Step(state, dt, p) {
    var k1 = derivatives(state, p);
    var k2 = derivatives(addScaledState(state, k1, dt * 0.5), p);
    var k3 = derivatives(addScaledState(state, k2, dt * 0.5), p);
    var k4 = derivatives(addScaledState(state, k3, dt), p);

    return {
      theta1: wrapAngle(state.theta1 + dt / 6 * (k1.theta1 + 2 * k2.theta1 + 2 * k3.theta1 + k4.theta1)),
      omega1: state.omega1 + dt / 6 * (k1.omega1 + 2 * k2.omega1 + 2 * k3.omega1 + k4.omega1),
      theta2: wrapAngle(state.theta2 + dt / 6 * (k1.theta2 + 2 * k2.theta2 + 2 * k3.theta2 + k4.theta2)),
      omega2: state.omega2 + dt / 6 * (k1.omega2 + 2 * k2.omega2 + 2 * k3.omega2 + k4.omega2)
    };
  }

  function resetSimulation() {
    params = readParams();
    simTime = 0;
    accumulator = 0;
    mainState = makeInitialState(0);
    ghostState = makeInitialState(GHOST_EPSILON);
    mainTrail = [];
    ghostTrail = [];
    lastMainTrailPoint = null;
    lastGhostTrailPoint = null;
    addTrailPoint(mainTrail, mainState, true);
    addTrailPoint(ghostTrail, ghostState, true);
    updateText();
  }

  function resizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    var nextDpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    var nextWidth = Math.max(1, Math.round(rect.width * nextDpr));
    var nextHeight = Math.max(1, Math.round(rect.height * nextDpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    dpr = nextDpr;
    view.width = rect.width;
    view.height = rect.height;
    view.pivotX = rect.width > 760 ? rect.width * 0.58 : rect.width * 0.5;
    view.pivotY = rect.height > 680 ? rect.height * 0.25 : rect.height * 0.36;
    view.scale = Math.min(rect.width, rect.height) * 0.72 / Math.max(1, params.l1 + params.l2);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getWorldPoints(state) {
    var x1 = params.l1 * Math.sin(state.theta1);
    var y1 = params.l1 * Math.cos(state.theta1);
    var x2 = x1 + params.l2 * Math.sin(state.theta2);
    var y2 = y1 + params.l2 * Math.cos(state.theta2);

    return {
      p1: { x: x1, y: y1 },
      p2: { x: x2, y: y2 }
    };
  }

  function worldToScreen(point) {
    return {
      x: view.pivotX + point.x * view.scale,
      y: view.pivotY + point.y * view.scale
    };
  }

  function addTrailPoint(trail, state, force) {
    var p2 = getWorldPoints(state).p2;
    var last = trail === mainTrail ? lastMainTrailPoint : lastGhostTrailPoint;
    var dx = last ? p2.x - last.x : 0;
    var dy = last ? p2.y - last.y : 0;
    var farEnough = !last || Math.hypot(dx, dy) > 0.004;
    var oldEnough = !last || simTime - last.time > 1 / 50;

    if (force || farEnough || oldEnough) {
      var nextPoint = { x: p2.x, y: p2.y, time: simTime };
      trail.push(nextPoint);
      if (trail === mainTrail) {
        lastMainTrailPoint = nextPoint;
      } else {
        lastGhostTrailPoint = nextPoint;
      }
    }

    pruneTrail(trail);
  }

  function pruneTrail(trail) {
    var cutoff = simTime - TRAIL_SECONDS;
    while (trail.length > 1 && trail[0].time < cutoff) {
      trail.shift();
    }
  }

  function stepSimulation(dt) {
    mainState = rk4Step(mainState, dt, params);
    if (controls.ghostToggle.checked) {
      ghostState = rk4Step(ghostState, dt, params);
    }
    simTime += dt;
  }

  function drawBackground() {
    ctx.fillStyle = "#0f1115";
    ctx.fillRect(0, 0, view.width, view.height);

    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;

    var reach = (params.l1 + params.l2) * view.scale;
    ctx.beginPath();
    ctx.arc(view.pivotX, view.pivotY, params.l1 * view.scale, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(view.pivotX, view.pivotY, reach, 0, TAU);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(view.pivotX, Math.max(0, view.pivotY - reach - 16));
    ctx.lineTo(view.pivotX, Math.min(view.height, view.pivotY + reach + 16));
    ctx.stroke();

    ctx.restore();
  }

  function drawTrail(trail, color, width, alphaScale) {
    if (trail.length < 2) {
      return;
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = width;

    for (var i = 1; i < trail.length; i += 1) {
      var previous = worldToScreen(trail[i - 1]);
      var current = worldToScreen(trail[i]);
      var age = Math.max(0, simTime - trail[i].time);
      var life = Math.max(0, 1 - age / TRAIL_SECONDS);
      var alpha = alphaScale * life * life;

      if (alpha <= 0.002) {
        continue;
      }

      ctx.strokeStyle = color.replace("ALPHA", alpha.toFixed(4));
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(current.x, current.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawPendulum(state, ghost) {
    var points = getWorldPoints(state);
    var origin = { x: view.pivotX, y: view.pivotY };
    var p1 = worldToScreen(points.p1);
    var p2 = worldToScreen(points.p2);
    var mass1Radius = ghost ? 4 : 7 + Math.sqrt(params.m1) * 2.2;
    var mass2Radius = ghost ? 5 : 8 + Math.sqrt(params.m2) * 2.6;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = ghost ? "rgba(244, 197, 106, 0.48)" : "rgba(222, 231, 239, 0.92)";
    ctx.lineWidth = ghost ? 1.25 : 3;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    ctx.fillStyle = ghost ? "rgba(244, 197, 106, 0.58)" : "#7bdcb5";
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, mass1Radius, 0, TAU);
    ctx.fill();

    ctx.fillStyle = ghost ? "rgba(255, 174, 79, 0.64)" : "#ffb454";
    ctx.beginPath();
    ctx.arc(p2.x, p2.y, mass2Radius, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = ghost ? "rgba(255, 255, 255, 0.34)" : "rgba(15, 17, 21, 0.72)";
    ctx.lineWidth = ghost ? 1 : 2;
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, mass1Radius, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p2.x, p2.y, mass2Radius, 0, TAU);
    ctx.stroke();

    ctx.restore();
  }

  function drawPivot() {
    ctx.save();
    ctx.fillStyle = "#edf2f7";
    ctx.strokeStyle = "rgba(15, 17, 21, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(view.pivotX, view.pivotY, 5, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawDivergence() {
    if (!controls.ghostToggle.checked) {
      return;
    }

    var mainP2 = worldToScreen(getWorldPoints(mainState).p2);
    var ghostP2 = worldToScreen(getWorldPoints(ghostState).p2);

    ctx.save();
    ctx.strokeStyle = "rgba(244, 197, 106, 0.28)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(mainP2.x, mainP2.y);
    ctx.lineTo(ghostP2.x, ghostP2.y);
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    resizeCanvas();
    drawBackground();
    drawTrail(mainTrail, "rgba(120, 214, 181, ALPHA)", 2.2, 0.72);
    if (controls.ghostToggle.checked) {
      drawTrail(ghostTrail, "rgba(244, 197, 106, ALPHA)", 1.5, 0.42);
      drawPendulum(ghostState, true);
      drawDivergence();
    }
    drawPendulum(mainState, false);
    drawPivot();
  }

  function getAngularDelta() {
    var d1 = Math.abs(wrapAngle(mainState.theta1 - ghostState.theta1));
    var d2 = Math.abs(wrapAngle(mainState.theta2 - ghostState.theta2));
    return Math.hypot(d1, d2);
  }

  function updateText() {
    controls.toggleButton.textContent = running ? "Pause" : "Run";
    controls.stateText.textContent = running ? "running" : "paused";
    controls.timeReadout.textContent = simTime.toFixed(2) + " s";
    controls.deltaReadout.textContent = controls.ghostToggle.checked
      ? getAngularDelta().toFixed(4) + " rad"
      : "off";
  }

  function updateLabels() {
    params = readParams();
    controls.m1Value.textContent = params.m1.toFixed(1) + " kg";
    controls.m2Value.textContent = params.m2.toFixed(1) + " kg";
    controls.l1Value.textContent = params.l1.toFixed(2) + " m";
    controls.l2Value.textContent = params.l2.toFixed(2) + " m";
  }

  function frame(timestamp) {
    if (!lastTimestamp) {
      lastTimestamp = timestamp;
    }

    var dt = Math.min(MAX_FRAME_TIME, Math.max(0, (timestamp - lastTimestamp) / 1000));
    lastTimestamp = timestamp;

    if (running) {
      accumulator += dt;
      var steps = 0;
      while (accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS) {
        stepSimulation(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (steps >= MAX_SUBSTEPS) {
        accumulator = 0;
      }
      addTrailPoint(mainTrail, mainState, false);
      if (controls.ghostToggle.checked) {
        addTrailPoint(ghostTrail, ghostState, false);
      }
    }

    updateText();
    render();
    window.requestAnimationFrame(frame);
  }

  controls.toggleButton.addEventListener("click", function () {
    running = !running;
    updateText();
  });

  controls.resetButton.addEventListener("click", function () {
    resetSimulation();
  });

  controls.ghostToggle.addEventListener("change", function () {
    if (controls.ghostToggle.checked) {
      ghostState = {
        theta1: wrapAngle(mainState.theta1 + GHOST_EPSILON),
        omega1: mainState.omega1,
        theta2: mainState.theta2,
        omega2: mainState.omega2
      };
      ghostTrail = [];
      lastGhostTrailPoint = null;
      addTrailPoint(ghostTrail, ghostState, true);
    }
    updateText();
  });

  [controls.m1, controls.m2, controls.l1, controls.l2].forEach(function (input) {
    input.addEventListener("input", function () {
      updateLabels();
    });
  });

  window.addEventListener("resize", resizeCanvas);

  if (window.ResizeObserver) {
    new ResizeObserver(resizeCanvas).observe(canvas);
  }

  updateLabels();
  resetSimulation();
  window.requestAnimationFrame(frame);
}());
