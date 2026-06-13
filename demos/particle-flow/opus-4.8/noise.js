/*
 * 3D gradient (Perlin-style) noise + curl-noise helper.
 * Dual-mode: attaches `FlowNoise` to the global in a browser,
 * and exports via module.exports under node for tests.
 *
 * The curl of a 3D vector field is divergence-free, so particles
 * advected by it never pile up into sinks — the flow stays smooth
 * and "incompressible", which reads as natural fluid motion.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.FlowNoise = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 256-entry permutation table, doubled to avoid index wrapping.
  function buildPerm(seed) {
    var p = new Uint8Array(256);
    for (var i = 0; i < 256; i++) p[i] = i;
    // Deterministic xorshift shuffle so tests are reproducible.
    var s = (seed >>> 0) || 0x9e3779b9;
    for (var j = 255; j > 0; j--) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      var k = s % (j + 1);
      var t = p[j]; p[j] = p[k]; p[k] = t;
    }
    var perm = new Uint8Array(512);
    for (var m = 0; m < 512; m++) perm[m] = p[m & 255];
    return perm;
  }

  // 12 gradient directions toward cube edges (classic Perlin set).
  var GRAD = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
  ]);

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + t * (b - a); }

  function makeNoise(seed) {
    var perm = buildPerm(seed);

    function grad(hash, x, y, z) {
      var h = (hash % 12) * 3;
      return GRAD[h] * x + GRAD[h + 1] * y + GRAD[h + 2] * z;
    }

    // Improved Perlin noise, output roughly in [-1, 1].
    function noise3(x, y, z) {
      var X = Math.floor(x) & 255;
      var Y = Math.floor(y) & 255;
      var Z = Math.floor(z) & 255;
      x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
      var u = fade(x), v = fade(y), w = fade(z);

      var A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
      var B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;

      return lerp(
        lerp(
          lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
          lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u),
          v),
        lerp(
          lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
          lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u),
          v),
        w);
    }

    return { noise3: noise3 };
  }

  /*
   * Curl-noise field. We build a vector potential Psi = (n1, n2, n3) from
   * three decorrelated noise samples, then return curl(Psi) via central
   * differences. The result is a smooth, divergence-free 3D velocity.
   */
  function makeCurl(seed) {
    var nx = makeNoise(seed ^ 0x1234).noise3;
    var ny = makeNoise(seed ^ 0xa5a5).noise3;
    var nz = makeNoise(seed ^ 0x7f3c).noise3;
    var EPS = 1e-2;

    // Reusable output to avoid per-call allocation in the hot loop.
    var out = { x: 0, y: 0, z: 0 };

    function curl(x, y, z) {
      // dPsi/d? components needed for the curl.
      // curl = ( dPz/dy - dPy/dz , dPx/dz - dPz/dx , dPy/dx - dPx/dy )
      var inv = 1 / (2 * EPS);

      var py_z1 = ny(x, y, z + EPS), py_z0 = ny(x, y, z - EPS);
      var pz_y1 = nz(x, y + EPS, z), pz_y0 = nz(x, y - EPS, z);

      var pz_x1 = nz(x + EPS, y, z), pz_x0 = nz(x - EPS, y, z);
      var px_z1 = nx(x, y, z + EPS), px_z0 = nx(x, y, z - EPS);

      var px_y1 = nx(x, y + EPS, z), px_y0 = nx(x, y - EPS, z);
      var py_x1 = ny(x + EPS, y, z), py_x0 = ny(x - EPS, y, z);

      out.x = ((pz_y1 - pz_y0) - (py_z1 - py_z0)) * inv;
      out.y = ((px_z1 - px_z0) - (pz_x1 - pz_x0)) * inv;
      out.z = ((py_x1 - py_x0) - (px_y1 - px_y0)) * inv;
      return out;
    }

    return { curl: curl, noise3: nx };
  }

  return { makeNoise: makeNoise, makeCurl: makeCurl };
});
