'use strict';
/*
 * Pure Mandelbrot math + palette. No DOM, no globals beyond `Mandelbrot`.
 * Loaded via a plain <script> tag (works under file:// and sandboxed iframe).
 *
 * Set definition:  c = point of the complex plane, z0 = 0, z -> z^2 + c.
 * Escape when |z| > 2  ==>  |z|^2 > 4 (we compare squared moduli to avoid sqrt).
 *
 * Smooth (continuous) iteration count:
 *   mu = n + 1 - log2( log2(|z|) )  =  n + 1 - log2( ln(|z|) / ln 2 )
 * Using an escape radius R well above 2 (here 2^8) makes the term
 * 1 - log2(log2|z|) settle into [0,1), removing the banding you get at R=2.
 */

var Mandelbrot = (function () {

  // Escape radius. Larger radius -> smoother color transitions across bands.
  var ESCAPE_RADIUS = 256;                       // R = 2^8
  var ESCAPE_R2 = ESCAPE_RADIUS * ESCAPE_RADIUS; // bail-out on |z|^2 > R^2
  var LOG2 = Math.log(2);
  var INV_LOG2 = 1 / LOG2;

  /**
   * Iterate z = z^2 + c for the point (cx, cy).
   * Returns the smooth (fractional) iteration value, or -1 if the point did
   * not escape within `maxIter` (treated as interior / in the set).
   *
   * Cardioid + period-2 bulb early-out skips the two largest interior regions
   * so deep zooms stay responsive without changing the picture.
   */
  function smoothIter(cx, cy, maxIter) {
    // --- main cardioid:  q = (x - 1/4)^2 + y^2 ; inside if q(q + (x-1/4)) <= 1/4 y^2
    var xm = cx - 0.25;
    var y2 = cy * cy;
    var q = xm * xm + y2;
    if (q * (q + xm) <= 0.25 * y2) return -1;
    // --- period-2 bulb centered at (-1, 0), radius 1/4
    var xp = cx + 1;
    if (xp * xp + y2 <= 0.0625) return -1;

    var zx = 0, zy = 0;
    var zx2 = 0, zy2 = 0; // squared components, reused to test escape & step
    var n = 0;
    while (n < maxIter && zx2 + zy2 <= ESCAPE_R2) {
      // z = z^2 + c  ->  (zx + i*zy)^2 = (zx^2 - zy^2) + i*(2 zx zy)
      zy = 2 * zx * zy + cy;
      zx = zx2 - zy2 + cx;
      zx2 = zx * zx;
      zy2 = zy * zy;
      n++;
    }
    if (n >= maxIter) return -1; // did not escape -> interior

    // Continuous (normalized) iteration count.
    // log2(log2(|z|)) = log2( ln(modulus) / ln2 ) where modulus = sqrt(zx2+zy2)
    var logModulus = 0.5 * Math.log(zx2 + zy2);          // ln|z|
    var nu = Math.log(logModulus * INV_LOG2) * INV_LOG2; // log2(log2|z|)
    return n + 1 - nu;
  }

  /**
   * Iteration budget as a function of zoom.
   * The visible width in plane units is `spanX`; smaller span = deeper zoom.
   * Depth must grow as we zoom so newly-revealed detail keeps resolving.
   * Uses log of the linear magnification; clamped to keep frames bounded.
   */
  function iterationsForSpan(spanX, baseSpan, baseIter, maxCap) {
    if (baseIter == null) baseIter = 120;
    if (maxCap == null) maxCap = 4000;
    var mag = baseSpan / spanX;                 // linear magnification factor
    if (!(mag > 1)) mag = 1;
    // Each ~doubling of zoom adds a fixed slice of iterations.
    var extra = 90 * Math.log(mag) * INV_LOG2;  // ~90 iters per zoom octave
    var it = Math.round(baseIter + extra);
    if (it > maxCap) it = maxCap;
    return it;
  }

  // --- Palette ---------------------------------------------------------------
  // A smooth cosine-based gradient (Inigo Quilez style): each channel is a
  // cosine of (frequency * t + phase). Cheap, periodic, and very pretty.
  // t is the normalized escape value run through a gentle sqrt to even out the
  // visual density of color bands, then wrapped by the cycle length.
  //
  // Returns [r, g, b] each in 0..255. The interior (escaped == -1) is near-black.

  function palette(mu, cycle) {
    if (mu < 0) return [6, 7, 11]; // interior
    if (cycle == null) cycle = 64;
    // Even out band spacing and wrap.
    var t = Math.sqrt(mu) / Math.sqrt(cycle);
    // cosine palette coefficients (a + b*cos(2pi*(c*t + d)))
    var TAU = 6.283185307179586;
    var r = 0.5 + 0.5 * Math.cos(TAU * (1.00 * t + 0.00));
    var g = 0.5 + 0.5 * Math.cos(TAU * (1.00 * t + 0.18));
    var b = 0.5 + 0.5 * Math.cos(TAU * (1.00 * t + 0.40));
    // Bias toward a deep-blue/gold "electric" look and lift mids slightly.
    r = Math.pow(r, 0.92);
    g = Math.pow(g, 1.05);
    b = Math.pow(b, 0.80);
    return [
      Math.round(255 * clamp01(r)),
      Math.round(255 * clamp01(g)),
      Math.round(255 * clamp01(b))
    ];
  }

  // Alternative "fire" palette.
  function paletteFire(mu, cycle) {
    if (mu < 0) return [5, 4, 8];
    if (cycle == null) cycle = 64;
    var t = Math.sqrt(mu) / Math.sqrt(cycle);
    t = t - Math.floor(t); // wrap 0..1
    // ramp through black -> red -> orange -> yellow -> white
    var r = clamp01(t * 3.0);
    var g = clamp01(t * 3.0 - 1.0);
    var b = clamp01(t * 3.0 - 2.0);
    return [Math.round(255 * r), Math.round(255 * g), Math.round(255 * b)];
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // Build a 256-entry lookup table for one palette so the inner loop avoids
  // trig per pixel. Index = normalized position into the cycle (0..255).
  function buildLUT(kind, cycle, size) {
    if (size == null) size = 1024;
    var fn = kind === 'fire' ? paletteFire : palette;
    var lut = new Uint8Array(size * 3);
    for (var i = 0; i < size; i++) {
      // map LUT index -> a representative mu whose sqrt spans [0, sqrt(cycle))
      var frac = i / size;            // 0..1
      var mu = (frac * frac) * cycle; // invert the sqrt used in palette()
      var c = fn(mu, cycle);
      lut[i * 3] = c[0];
      lut[i * 3 + 1] = c[1];
      lut[i * 3 + 2] = c[2];
    }
    return lut;
  }

  return {
    ESCAPE_RADIUS: ESCAPE_RADIUS,
    ESCAPE_R2: ESCAPE_R2,
    smoothIter: smoothIter,
    iterationsForSpan: iterationsForSpan,
    palette: palette,
    paletteFire: paletteFire,
    buildLUT: buildLUT,
    clamp01: clamp01
  };
})();

// Allow Node to require this for the unit test, while staying a plain browser script.
if (typeof module !== 'undefined' && module.exports) { module.exports = Mandelbrot; }
