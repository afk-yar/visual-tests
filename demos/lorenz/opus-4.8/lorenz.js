// Lorenz system — pure logic (dual-mode: browser global + node module.exports).
// Equations:  dx/dt = σ(y − x);  dy/dt = x(ρ − z) − y;  dz/dt = xy − βz
(function (root) {
  'use strict';

  var SIGMA = 10;
  var RHO = 28;
  var BETA = 8 / 3;

  // Derivative of the Lorenz vector field at point [x, y, z].
  function deriv(x, y, z) {
    return [
      SIGMA * (y - x),
      x * (RHO - z) - y,
      x * y - BETA * z
    ];
  }

  // One classic RK4 step of size dt. Returns the next [x, y, z].
  function rk4Step(p, dt) {
    var x = p[0], y = p[1], z = p[2];

    var k1 = deriv(x, y, z);
    var k2 = deriv(
      x + 0.5 * dt * k1[0],
      y + 0.5 * dt * k1[1],
      z + 0.5 * dt * k1[2]
    );
    var k3 = deriv(
      x + 0.5 * dt * k2[0],
      y + 0.5 * dt * k2[1],
      z + 0.5 * dt * k2[2]
    );
    var k4 = deriv(
      x + dt * k3[0],
      y + dt * k3[1],
      z + dt * k3[2]
    );

    return [
      x + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      y + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
      z + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])
    ];
  }

  // Project a world point onto screen space with rotation about the vertical
  // (z) axis by `yaw` and a fixed tilt about the horizontal axis.
  // The attractor is centred on its mean (~[0, 0, 25]) before rotation so it
  // spins in place. `scale` maps world units to pixels; cx/cy is the screen
  // centre. Returns { x, y, depth } where larger depth = closer to camera.
  function project(p, opts) {
    var yaw = opts.yaw;
    var tilt = opts.tilt;
    var scale = opts.scale;
    var cx = opts.cx;
    var cy = opts.cy;

    // Recentre: attractor wings sit roughly around z = 25.
    var x = p[0];
    var y = p[1];
    var z = p[2] - 25;

    // Rotate around the vertical (z) axis — the "slow auto-rotation".
    var cy0 = Math.cos(yaw);
    var sy0 = Math.sin(yaw);
    var rx = x * cy0 - y * sy0;
    var ry = x * sy0 + y * cy0;

    // Elevation: camera looks down by `tilt` from the horizon. World-up (+z)
    // maps to screen-up; the horizontal in-plane axis (ry) folds into depth.
    var ct = Math.cos(tilt);
    var st = Math.sin(tilt);
    var vy = z * ct - ry * st;      // screen vertical, positive = up
    var depth = z * st + ry * ct;   // into screen, positive = closer is handled by caller

    return {
      x: cx + rx * scale,
      y: cy - vy * scale,
      depth: depth
    };
  }

  var api = {
    SIGMA: SIGMA,
    RHO: RHO,
    BETA: BETA,
    deriv: deriv,
    rk4Step: rk4Step,
    project: project
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Lorenz = api;
  }
})(typeof window !== 'undefined' ? window : this);
