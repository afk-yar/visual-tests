'use strict';
/*
 * Logic checks for the pure math module. Run: node mandelbrot.test.js
 * No test framework — just assertions and a summary.
 */
var M = require('./mandelbrot.js');

var passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL: ' + name + (extra ? '  -> ' + extra : '')); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// --- Set membership --------------------------------------------------------
// Origin (0,0) is deep inside the set -> never escapes -> -1.
ok('origin is interior', M.smoothIter(0, 0, 1000) === -1);
// (-1, 0) is the period-2 bulb center, interior.
ok('(-1,0) interior', M.smoothIter(-1, 0, 1000) === -1);
// (0.30, 0) is just outside the cardioid cusp (cusp at +0.25) -> escapes.
ok('(0.30,0) escapes', M.smoothIter(0.30, 0, 1000) >= 0,
   'got ' + M.smoothIter(0.30, 0, 1000));
// (2, 0): z1 = 4 already > escape, escapes almost immediately.
ok('(2,0) escapes fast', M.smoothIter(2, 0, 1000) >= 0 && M.smoothIter(2, 0, 1000) < 5);
// Far-away point escapes on the first iteration region.
ok('(5,5) escapes', M.smoothIter(5, 5, 1000) >= 0);

// --- Smooth value sanity ---------------------------------------------------
// Smooth iteration must be a finite, non-negative real for escaping points.
var mu = M.smoothIter(0.35, 0.05, 2000);
ok('mu finite', isFinite(mu) && mu >= 0, 'mu=' + mu);
// Points farther from the set escape sooner -> smaller mu (monotone-ish).
var near = M.smoothIter(0.26, 0.0, 5000);   // just past the cusp, slow escape
var far = M.smoothIter(1.5, 0.0, 5000);     // well outside, fast escape
ok('closer point escapes slower', near > far, 'near=' + near + ' far=' + far);

// --- Escape radius / threshold ---------------------------------------------
ok('escape radius is 256', M.ESCAPE_RADIUS === 256);
ok('escape R^2 = 65536', M.ESCAPE_R2 === 65536);

// --- Iteration schedule grows with zoom ------------------------------------
var base = M.iterationsForSpan(3.2, 3.2, 140, 6000);      // home view
var deep = M.iterationsForSpan(3.2 / 1024, 3.2, 140, 6000); // 1024x zoom
var deeper = M.iterationsForSpan(3.2 / 1e6, 3.2, 140, 6000);
ok('base iter ~ baseIter', base === 140, 'base=' + base);
ok('iter grows with zoom', deep > base && deeper > deep,
   'base=' + base + ' deep=' + deep + ' deeper=' + deeper);
ok('iter respects cap', M.iterationsForSpan(1e-30, 3.2, 140, 6000) === 6000);
// ~90 iters per octave: 1024x = 10 octaves => +900.
ok('iter slope ~90/octave', Math.abs(deep - (140 + 900)) <= 2, 'deep=' + deep);

// --- Palette ---------------------------------------------------------------
var interior = M.palette(-1, 64);
ok('interior near-black', interior[0] < 20 && interior[1] < 20 && interior[2] < 20);
var col = M.palette(10, 64);
ok('palette RGB in range',
   col.every(function (c) { return c >= 0 && c <= 255 && Number.isFinite(c); }),
   JSON.stringify(col));
var fire = M.paletteFire(5, 64);
ok('fire RGB in range',
   fire.every(function (c) { return c >= 0 && c <= 255; }), JSON.stringify(fire));

// --- LUT -------------------------------------------------------------------
var lut = M.buildLUT('electric', 56, 1024);
ok('LUT length', lut.length === 1024 * 3);
ok('LUT bytes valid', lut.every(function (b) { return b >= 0 && b <= 255; }));
// LUT should not be uniformly one color (it's a gradient).
var distinct = lut[0] !== lut[300] || lut[1] !== lut[301] || lut[2] !== lut[302];
ok('LUT varies', distinct);

// --- clamp01 ---------------------------------------------------------------
ok('clamp low', M.clamp01(-3) === 0);
ok('clamp high', M.clamp01(3) === 1);
ok('clamp mid', approx(M.clamp01(0.42), 0.42));

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
