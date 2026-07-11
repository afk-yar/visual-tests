(function () {
  'use strict';

  var canvas = document.getElementById('fractal');
  var context = canvas.getContext('2d', { alpha: false });
  var zoomValue = document.getElementById('zoomValue');
  var realValue = document.getElementById('realValue');
  var imagValue = document.getElementById('imagValue');
  var iterationValue = document.getElementById('iterationValue');
  var renderStatus = document.getElementById('renderStatus');
  var resetViewButton = document.getElementById('resetView');

  var INITIAL_HEIGHT = 2.8;
  var INITIAL_CENTER_X = -0.5;
  var INITIAL_CENTER_Y = 0;
  var MIN_HEIGHT = 2.8e-14;
  var MAX_ITERATIONS = 1600;
  var palette = createPalette();
  var dpr = 1;
  var cssWidth = 1;
  var cssHeight = 1;
  var pixelWidth = 1;
  var pixelHeight = 1;
  var view = { centerX: INITIAL_CENTER_X, centerY: INITIAL_CENTER_Y, height: INITIAL_HEIGHT };
  var renderJob = null;
  var renderVersion = 0;
  var frameQueued = false;
  var dragging = false;
  var dragStart = null;

  function createPalette() {
    var stops = [
      [0.00, [3, 4, 16]], [0.10, [12, 17, 57]], [0.25, [31, 42, 116]],
      [0.41, [86, 49, 165]], [0.57, [166, 53, 150]], [0.72, [236, 88, 118]],
      [0.84, [255, 157, 109]], [0.93, [255, 218, 153]], [1.00, [255, 246, 208]]
    ];
    var colors = new Uint8ClampedArray(4096 * 3);
    for (var i = 0; i < 4096; i += 1) {
      var position = i / 4095;
      var left = stops[0];
      var right = stops[stops.length - 1];
      for (var s = 1; s < stops.length; s += 1) {
        if (position <= stops[s][0]) {
          left = stops[s - 1];
          right = stops[s];
          break;
        }
      }
      var local = (position - left[0]) / (right[0] - left[0]);
      local = local * local * (3 - 2 * local);
      var base = i * 3;
      colors[base] = left[1][0] + (right[1][0] - left[1][0]) * local;
      colors[base + 1] = left[1][1] + (right[1][1] - left[1][1]) * local;
      colors[base + 2] = left[1][2] + (right[1][2] - left[1][2]) * local;
    }
    return colors;
  }

  function getIterations() {
    var zoom = INITIAL_HEIGHT / view.height;
    return Math.min(MAX_ITERATIONS, Math.floor(160 + 46 * Math.log2(Math.max(1, zoom))));
  }

  function getWorldPerCssPixel() { return view.height / cssHeight; }

  function formatCoordinate(value) {
    var digits = Math.abs(value) !== 0 && Math.abs(value) < 0.001 ? 12 : 7;
    return value.toFixed(digits).replace('-', '−');
  }

  function formatZoom(zoom) {
    if (zoom < 1000) return zoom.toFixed(2) + '×';
    if (zoom < 1000000) return (zoom / 1000).toFixed(2) + 'k×';
    if (zoom < 1000000000) return (zoom / 1000000).toFixed(2) + 'M×';
    return zoom.toExponential(2) + '×';
  }

  function updateMetrics() {
    var zoom = INITIAL_HEIGHT / view.height;
    zoomValue.textContent = formatZoom(zoom);
    realValue.textContent = formatCoordinate(view.centerX);
    imagValue.textContent = formatCoordinate(view.centerY);
    iterationValue.textContent = getIterations() + ' итераций';
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssWidth = Math.max(1, window.innerWidth);
    cssHeight = Math.max(1, window.innerHeight);
    pixelWidth = Math.max(1, Math.floor(cssWidth * dpr));
    pixelHeight = Math.max(1, Math.floor(cssHeight * dpr));
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    updateMetrics();
    queueRender();
  }

  function worldAt(clientX, clientY, height) {
    var units = height / cssHeight;
    return {
      x: view.centerX + (clientX - cssWidth / 2) * units,
      y: view.centerY + (clientY - cssHeight / 2) * units
    };
  }

  function resetView() {
    view.centerX = INITIAL_CENTER_X;
    view.centerY = INITIAL_CENTER_Y;
    view.height = INITIAL_HEIGHT;
    updateMetrics();
    queueRender();
  }

  function setStatus(text, busy) {
    renderStatus.textContent = text;
    renderStatus.classList.toggle('is-busy', busy);
  }

  function queueRender() {
    renderVersion += 1;
    renderJob = null;
    if (!frameQueued) {
      frameQueued = true;
      window.requestAnimationFrame(renderFrame);
    }
  }

  function escapeIteration(cr, ci, maxIterations) {
    var shiftedX = cr - 0.25;
    var q = shiftedX * shiftedX + ci * ci;
    if (q * (q + shiftedX) <= 0.25 * ci * ci || (cr + 1) * (cr + 1) + ci * ci <= 0.0625) return true;

    var zr = 0;
    var zi = 0;
    for (var iteration = 0; iteration < maxIterations; iteration += 1) {
      var zrSquared = zr * zr;
      var ziSquared = zi * zi;
      if (zrSquared + ziSquared > 256) {
        var magnitude = Math.sqrt(zrSquared + ziSquared);
        return iteration + 1 - Math.log2(Math.log2(magnitude));
      }
      zi = 2 * zr * zi + ci;
      zr = zrSquared - ziSquared + cr;
    }
    return true;
  }

  function renderRows(job) {
    var units = view.height / cssHeight;
    var data = job.imageData.data;
    var rowStart = job.nextRow;
    var rowEnd = Math.min(pixelHeight, rowStart + Math.max(8, Math.floor(90000 / pixelWidth)));
    var centerPixelX = pixelWidth / 2;
    var centerPixelY = pixelHeight / 2;

    for (var py = rowStart; py < rowEnd; py += 1) {
      var worldY = view.centerY + (py / dpr - centerPixelY / dpr) * units;
      var rowOffset = py * pixelWidth * 4;
      for (var px = 0; px < pixelWidth; px += 1) {
        var worldX = view.centerX + (px / dpr - centerPixelX / dpr) * units;
        var result = escapeIteration(worldX, worldY, job.iterations);
        var offset = rowOffset + px * 4;
        if (result === true) {
          data[offset] = 1; data[offset + 1] = 2; data[offset + 2] = 10; data[offset + 3] = 255;
        } else {
          var normalized = Math.max(0, Math.min(1, Math.log(result + 1) / Math.log(job.iterations + 1)));
          normalized = Math.pow(normalized, 0.47);
          var colorOffset = Math.min(4095, Math.floor(normalized * 4095)) * 3;
          data[offset] = palette[colorOffset];
          data[offset + 1] = palette[colorOffset + 1];
          data[offset + 2] = palette[colorOffset + 2];
          data[offset + 3] = 255;
        }
      }
    }
    job.nextRow = rowEnd;
    context.putImageData(job.imageData, 0, 0);
  }

  function renderFrame() {
    frameQueued = false;
    if (!renderJob) {
      renderJob = {
        version: renderVersion,
        nextRow: 0,
        iterations: getIterations(),
        imageData: context.createImageData(pixelWidth, pixelHeight)
      };
      setStatus('Вычисление · 0%', true);
    }
    if (renderJob.version !== renderVersion) {
      renderJob = null;
      queueRender();
      return;
    }
    renderRows(renderJob);
    if (renderJob.nextRow < pixelHeight) {
      setStatus('Вычисление · ' + Math.floor((renderJob.nextRow / pixelHeight) * 100) + '%', true);
      frameQueued = true;
      window.requestAnimationFrame(renderFrame);
    } else {
      renderJob = null;
      setStatus('Готово · перетащите, чтобы исследовать', false);
    }
  }

  function onWheel(event) {
    event.preventDefault();
    var cursor = worldAt(event.clientX, event.clientY, view.height);
    var factor = Math.exp(-event.deltaY * 0.0014);
    var nextHeight = Math.max(MIN_HEIGHT, Math.min(INITIAL_HEIGHT * 1.4, view.height / factor));
    var nextUnits = nextHeight / cssHeight;
    view.centerX = cursor.x - (event.clientX - cssWidth / 2) * nextUnits;
    view.centerY = cursor.y - (event.clientY - cssHeight / 2) * nextUnits;
    view.height = nextHeight;
    updateMetrics();
    queueRender();
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    dragging = true;
    dragStart = { x: event.clientX, y: event.clientY, centerX: view.centerX, centerY: view.centerY };
    canvas.classList.add('is-dragging');
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragging || !dragStart) return;
    var units = getWorldPerCssPixel();
    view.centerX = dragStart.centerX - (event.clientX - dragStart.x) * units;
    view.centerY = dragStart.centerY - (event.clientY - dragStart.y) * units;
    updateMetrics();
    queueRender();
  }

  function onPointerUp(event) {
    if (!dragging) return;
    dragging = false;
    dragStart = null;
    canvas.classList.remove('is-dragging');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  resetViewButton.addEventListener('click', resetView);
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', function (event) {
    if (event.key.toLowerCase() === 'r') resetView();
  });
  resize();
}());
