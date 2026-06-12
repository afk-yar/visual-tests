'use strict';
/*
 * Mandelbrot viewer — interaction + progressive chunked rendering.
 * Plain <script> (no modules, no fetch). Depends on Mandelbrot (mandelbrot.js).
 */
(function () {
  var M = Mandelbrot;

  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d', { alpha: false });

  // HUD elements
  var elZoom = document.getElementById('hudZoom');
  var elRe = document.getElementById('hudRe');
  var elIm = document.getElementById('hudIm');
  var elIter = document.getElementById('hudIter');
  var elCur = document.getElementById('hudCursor');
  var elProgress = document.getElementById('progress');

  // Controls
  var elPalette = document.getElementById('palette');
  var elQuality = document.getElementById('quality');
  var elReset = document.getElementById('reset');

  // ---- View state (complex plane) ------------------------------------------
  // centerX/centerY = plane coordinate at canvas center.
  // spanX = visible width of the plane across the full canvas width.
  // The home view frames the whole set.
  var HOME = { cx: -0.6, cy: 0.0, spanX: 3.2 };
  var view = { cx: HOME.cx, cy: HOME.cy, spanX: HOME.spanX };

  var BASE_SPAN = HOME.spanX;     // reference span for the iteration schedule
  var BASE_ITER = 140;

  // Render resolution scale. <1 renders fewer device pixels (faster) then the
  // browser upscales the ImageData via drawImage. Quality slider drives this.
  var qualityScale = 1.0;         // 1.0 = full device pixels
  var dpr = 1;                    // clamped devicePixelRatio

  // Pixel buffers for the offscreen render target.
  var renderW = 0, renderH = 0;
  var imageData = null;
  var pixels = null;              // Uint8ClampedArray (RGBA)
  var offscreen = document.createElement('canvas');
  var offCtx = offscreen.getContext('2d', { alpha: false });

  // Palette lookup table.
  var LUT_SIZE = 2048;
  var lut = null;
  var paletteKind = 'electric';
  var paletteCycle = 56;

  function rebuildLUT() {
    var kind = paletteKind === 'fire' ? 'fire' : 'electric';
    lut = M.buildLUT(kind, paletteCycle, LUT_SIZE);
  }

  // ---- Sizing / DPR ---------------------------------------------------------
  function resize() {
    var cssW = canvas.clientWidth || window.innerWidth;
    var cssH = canvas.clientHeight || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2); // clamp DPR (perf)

    // Display canvas matches device pixels for crisp output.
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));

    // Offscreen render target: device pixels * qualityScale.
    renderW = Math.max(1, Math.round(canvas.width * qualityScale));
    renderH = Math.max(1, Math.round(canvas.height * qualityScale));
    offscreen.width = renderW;
    offscreen.height = renderH;
    imageData = offCtx.createImageData(renderW, renderH);
    pixels = imageData.data;

    ctx.imageSmoothingEnabled = qualityScale < 1; // smooth only when upscaling
    requestRender(true);
  }

  // ---- Coordinate mapping ---------------------------------------------------
  // Map a render-buffer pixel (px,py) to a plane coordinate. spanY derives from
  // spanX and the aspect ratio so circles stay round.
  function spanY() { return view.spanX * (renderH / renderW); }

  // CSS pixel (relative to canvas) -> plane coordinate.
  function cssToPlane(cssX, cssY) {
    var fx = cssX / (canvas.clientWidth || 1);   // 0..1 across width
    var fy = cssY / (canvas.clientHeight || 1);  // 0..1 across height
    var sX = view.spanX;
    var sY = view.spanX * ((canvas.clientHeight || 1) / (canvas.clientWidth || 1));
    return {
      x: view.cx + (fx - 0.5) * sX,
      y: view.cy + (fy - 0.5) * sY
    };
  }

  // ---- Progressive renderer -------------------------------------------------
  // Renders in horizontal chunks across animation frames so the main thread is
  // never blocked. A token invalidates any in-flight render when the view moves.
  var renderToken = 0;
  var rendering = false;

  function currentIterations() {
    return M.iterationsForSpan(view.spanX, BASE_SPAN, BASE_ITER, 6000);
  }

  function requestRender(immediate) {
    renderToken++;
    var token = renderToken;
    if (immediate) startRender(token);
    else {
      // schedule on next frame (lets rapid wheel events coalesce)
      requestAnimationFrame(function () {
        if (token === renderToken) startRender(token);
      });
    }
  }

  function startRender(token) {
    rendering = true;
    var maxIter = currentIterations();
    updateHud(maxIter);

    var sX = view.spanX;
    var sY = spanY();
    var x0 = view.cx - sX / 2;
    var y0 = view.cy - sY / 2;
    var dx = sX / renderW;
    var dy = sY / renderH;
    var lutMaxF = (LUT_SIZE - 1);
    var invCycleSqrt = 1 / Math.sqrt(paletteCycle);

    // Rows per chunk: aim for a small slice of work per frame.
    var rowsPerChunk = Math.max(4, Math.round(24000 / renderW));
    var row = 0;

    elProgress.classList.add('active');

    function chunk() {
      if (token !== renderToken) { return; } // superseded -> abandon
      var endRow = Math.min(row + rowsPerChunk, renderH);
      for (var py = row; py < endRow; py++) {
        var cy = y0 + py * dy;
        var base = py * renderW * 4;
        var cx = x0;
        for (var px = 0; px < renderW; px++, cx += dx) {
          var mu = M.smoothIter(cx, cy, maxIter);
          var o = base + px * 4;
          if (mu < 0) {
            pixels[o] = 6; pixels[o + 1] = 7; pixels[o + 2] = 11;
          } else {
            // Map mu -> LUT index. palette() uses sqrt(mu)/sqrt(cycle) as t,
            // so reproduce that here and wrap into the LUT.
            var t = Math.sqrt(mu) * invCycleSqrt; // 0.. (can exceed 1)
            t = t - Math.floor(t);                // wrap to 0..1
            var idx = (t * lutMaxF) | 0;
            var li = idx * 3;
            pixels[o] = lut[li];
            pixels[o + 1] = lut[li + 1];
            pixels[o + 2] = lut[li + 2];
          }
          pixels[o + 3] = 255;
        }
      }
      row = endRow;

      // Push the partial buffer to screen for live feedback.
      offCtx.putImageData(imageData, 0, 0);
      blit();
      var frac = row / renderH;
      elProgress.style.width = (frac * 100).toFixed(1) + '%';

      if (row < renderH) {
        requestAnimationFrame(chunk);
      } else {
        rendering = false;
        elProgress.classList.remove('active');
        elProgress.style.width = '0%';
      }
    }
    requestAnimationFrame(chunk);
  }

  // Draw the offscreen buffer onto the visible canvas (scaling if quality<1).
  function blit() {
    ctx.drawImage(offscreen, 0, 0, renderW, renderH, 0, 0, canvas.width, canvas.height);
  }

  // ---- HUD ------------------------------------------------------------------
  function fmtZoom(z) {
    if (z < 1000) return z.toFixed(2) + '×';
    if (z < 1e6) return (z / 1000).toFixed(2) + 'K×';
    if (z < 1e9) return (z / 1e6).toFixed(2) + 'M×';
    if (z < 1e12) return (z / 1e9).toFixed(2) + 'G×';
    return z.toExponential(2) + '×';
  }
  function updateHud(maxIter) {
    var zoom = BASE_SPAN / view.spanX;
    elZoom.textContent = fmtZoom(zoom);
    elRe.textContent = view.cx.toPrecision(12);
    elIm.textContent = view.cy.toPrecision(12);
    elIter.textContent = String(maxIter);
  }

  // ---- Interaction: zoom to cursor -----------------------------------------
  function onWheel(e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var cssX = e.clientX - rect.left;
    var cssY = e.clientY - rect.top;

    // Plane point under the cursor must stay fixed across the zoom.
    var before = cssToPlane(cssX, cssY);

    var factor = Math.pow(1.0015, -e.deltaY); // smooth, trackpad-friendly
    // Clamp zoom range. Don't zoom out beyond home; cap deep zoom near double
    // precision limits (~1e-13 span).
    var newSpan = view.spanX / factor;
    newSpan = Math.min(newSpan, HOME.spanX);
    newSpan = Math.max(newSpan, 1e-13);
    view.spanX = newSpan;

    // After scaling, recompute where `before` now lands and shift center so the
    // cursor pins the same plane point.
    var after = cssToPlane(cssX, cssY);
    view.cx += before.x - after.x;
    view.cy += before.y - after.y;

    requestRender(false);
  }

  // ---- Interaction: drag to pan --------------------------------------------
  var dragging = false;
  var dragLastX = 0, dragLastY = 0;
  var dragMoved = false;

  function onPointerDown(e) {
    dragging = true;
    dragMoved = false;
    dragLastX = e.clientX;
    dragLastY = e.clientY;
    canvas.classList.add('dragging');
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    var rect = canvas.getBoundingClientRect();
    // live cursor coordinate readout
    var p = cssToPlane(e.clientX - rect.left, e.clientY - rect.top);
    elCur.textContent = p.x.toFixed(6) + ',  ' + p.y.toFixed(6);

    if (!dragging) return;
    var dxPix = e.clientX - dragLastX;
    var dyPix = e.clientY - dragLastY;
    if (dxPix || dyPix) dragMoved = true;
    dragLastX = e.clientX;
    dragLastY = e.clientY;

    // Convert pixel delta to plane delta and move center opposite to drag.
    var sX = view.spanX;
    var sY = view.spanX * ((canvas.clientHeight || 1) / (canvas.clientWidth || 1));
    view.cx -= dxPix / (canvas.clientWidth || 1) * sX;
    view.cy -= dyPix / (canvas.clientHeight || 1) * sY;

    // Cheap live feedback: shift the already-drawn image, then re-render.
    requestRender(false);
  }
  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('dragging');
    canvas.releasePointerCapture && e.pointerId != null &&
      canvas.releasePointerCapture(e.pointerId);
    requestRender(true);
  }

  // Double-click: zoom in toward the clicked point.
  function onDblClick(e) {
    var rect = canvas.getBoundingClientRect();
    var cssX = e.clientX - rect.left, cssY = e.clientY - rect.top;
    var before = cssToPlane(cssX, cssY);
    view.spanX = Math.max(view.spanX / 2.5, 1e-13);
    var after = cssToPlane(cssX, cssY);
    view.cx += before.x - after.x;
    view.cy += before.y - after.y;
    requestRender(false);
  }

  // ---- Controls -------------------------------------------------------------
  function onPaletteChange() {
    paletteKind = elPalette.value;
    rebuildLUT();
    requestRender(true);
  }
  function onQualityChange() {
    var v = parseFloat(elQuality.value);
    qualityScale = v;
    resize(); // resize rebuilds buffers at the new scale and re-renders
  }
  function onReset() {
    view.cx = HOME.cx; view.cy = HOME.cy; view.spanX = HOME.spanX;
    requestRender(true);
  }

  // ---- Wire up --------------------------------------------------------------
  function init() {
    rebuildLUT();
    window.addEventListener('resize', debounce(resize, 120));
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDblClick);
    elPalette.addEventListener('change', onPaletteChange);
    elQuality.addEventListener('change', onQualityChange);
    elReset.addEventListener('click', onReset);
    resize();
  }

  function debounce(fn, ms) {
    var t = 0;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
