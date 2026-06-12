// node demos/lorenz/opus-4.8/lorenz.test.js
'use strict';

var assert = require('node:assert');
var L = require('./lorenz.js');

function approx(a, b, eps, msg) {
  assert.ok(Math.abs(a - b) <= eps, (msg || '') + ' expected ~' + b + ' got ' + a);
}

// --- Derivative matches the classic equations ------------------------------
(function testDeriv() {
  // At a fixed point of the system (one of the two non-origin equilibria):
  // x = y = ±sqrt(β(ρ−1)),  z = ρ−1  => derivative is ~0.
  var z = L.RHO - 1;
  var xy = Math.sqrt(L.BETA * (L.RHO - 1));
  var d = L.deriv(xy, xy, z);
  approx(d[0], 0, 1e-9, 'dx at fixed point');
  approx(d[1], 0, 1e-9, 'dy at fixed point');
  approx(d[2], 0, 1e-9, 'dz at fixed point');

  // Spot-check raw formula at (1, 2, 3).
  var e = L.deriv(1, 2, 3);
  approx(e[0], 10 * (2 - 1), 1e-12, 'sigma(y-x)');
  approx(e[1], 1 * (28 - 3) - 2, 1e-12, 'x(rho-z)-y');
  approx(e[2], 1 * 2 - (8 / 3) * 3, 1e-12, 'xy-beta z');
})();

// --- RK4 stays bounded and lands inside the attractor envelope --------------
(function testIntegratorBounded() {
  var p = [0.1, 0, 0];
  var dt = 0.005;
  var maxAbs = 0;
  var zMin = Infinity, zMax = -Infinity;
  for (var i = 0; i < 200000; i++) {
    p = L.rk4Step(p, dt);
    assert.ok(isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2]), 'finite at step ' + i);
    maxAbs = Math.max(maxAbs, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
    if (i > 5000) { // after transient
      zMin = Math.min(zMin, p[2]);
      zMax = Math.max(zMax, p[2]);
    }
  }
  // Known bounds for the classic Lorenz attractor: |x|,|y| < ~30, z in ~[0,55].
  assert.ok(maxAbs < 60, 'trajectory bounded, maxAbs=' + maxAbs);
  assert.ok(zMin > -2 && zMin < 10, 'z lower band ' + zMin);
  assert.ok(zMax > 35 && zMax < 55, 'z upper band ' + zMax);
})();

// --- RK4 accuracy vs analytically-known short-step behaviour ----------------
(function testRk4Order() {
  // For the linear part near origin the trajectory should grow along the
  // unstable manifold; one tiny step must move toward larger |y| from a small
  // positive x perturbation (since dy/dt = x*rho - y dominates).
  var p = [0.1, 0, 0];
  var n = L.rk4Step(p, 0.005);
  assert.ok(n[1] > p[1], 'y increases on first step (unstable origin)');
  // Energy-like sanity: a single RK4 step changes the point only slightly.
  var dist = Math.hypot(n[0] - p[0], n[1] - p[1], n[2] - p[2]);
  assert.ok(dist < 0.5, 'single small step is small, dist=' + dist);
})();

// --- Wings: trajectory visits BOTH lobes (x<0 and x>0) ----------------------
(function testTwoWings() {
  var p = [0.1, 0, 0];
  var sawNeg = false, sawPos = false;
  for (var i = 0; i < 100000; i++) {
    p = L.rk4Step(p, 0.005);
    if (p[0] < -5) sawNeg = true;
    if (p[0] > 5) sawPos = true;
    if (sawNeg && sawPos) break;
  }
  assert.ok(sawNeg && sawPos, 'visits both butterfly wings');
})();

// --- Projection: deterministic, centred, depth defined ----------------------
(function testProjection() {
  var opts = { yaw: 0, tilt: 1.0, scale: 4, cx: 400, cy: 300 };

  // A point at the recentre origin (z=25 -> centred) projects to screen centre.
  var c = L.project([0, 0, 25], opts);
  approx(c.x, 400, 1e-9, 'centre x');
  approx(c.y, 300, 1e-9, 'centre y');

  // Positive world-x with yaw=0 moves right on screen.
  var r = L.project([10, 0, 25], opts);
  assert.ok(r.x > 400, 'positive x -> right');

  // World-up (z) maps to screen-up (smaller y) under downward tilt.
  var up = L.project([0, 0, 35], opts);
  assert.ok(up.y < 300, 'higher z -> higher on screen');

  // Rotating yaw by 2π returns the same projection (periodicity).
  var optsA = { yaw: 0.7, tilt: 1.0, scale: 4, cx: 0, cy: 0 };
  var optsB = { yaw: 0.7 + Math.PI * 2, tilt: 1.0, scale: 4, cx: 0, cy: 0 };
  var pa = L.project([7, -3, 12], optsA);
  var pb = L.project([7, -3, 12], optsB);
  approx(pa.x, pb.x, 1e-6, 'yaw periodic x');
  approx(pa.y, pb.y, 1e-6, 'yaw periodic y');

  // Depth is finite and varies with yaw (proves real 3D rotation, not flat).
  var d0 = L.project([12, 0, 25], { yaw: 0, tilt: 1.0, scale: 4, cx: 0, cy: 0 }).depth;
  var d1 = L.project([12, 0, 25], { yaw: Math.PI / 2, tilt: 1.0, scale: 4, cx: 0, cy: 0 }).depth;
  assert.ok(isFinite(d0) && isFinite(d1), 'depth finite');
  assert.ok(Math.abs(d0 - d1) > 1e-6, 'depth changes with yaw');
})();

console.log('lorenz.test.js: all assertions passed');
