(function () {
  "use strict";

  var canvas = document.getElementById("fractal");
  var context = canvas.getContext("2d", { alpha: false });
  var zoomValue = document.getElementById("zoomValue");
  var realValue = document.getElementById("realValue");
  var imagValue = document.getElementById("imagValue");
  var iterationValue = document.getElementById("iterationValue");
  var renderStatus = document.getElementById("renderStatus");
  var cursorCoords = document.getElementById("cursorCoords");
  var resetButton = document.getElementById("resetView");

  var view = { x: -0.5, y: 0, zoom: 1 };
  var cssWidth = 1;
  var cssHeight = 1;
  var dpr = 1;
  var renderGeneration = 0;
  var renderQueued = false;
  var pendingFullRender = false;
  var drag = null;
  var wheelSettleTimer = 0;
  var palette = makePalette(4096);

  function makePalette(size) {
    var stops = [
      [3, 6, 18],
      [10, 24, 74],
      [12, 91, 142],
      [54, 192, 186],
      [214, 236, 165],
      [255, 190, 82],
      [225, 72, 111],
      [52, 12, 65],
      [3, 6, 18]
    ];
    var data = new Uint8Array(size * 3);

    for (var i = 0; i < size; i += 1) {
      var p = (i / size) * (stops.length - 1);
      var segment = Math.floor(p);
      var t = p - segment;
      var eased = t * t * (3 - 2 * t);
      var a = stops[segment];
      var b = stops[Math.min(segment + 1, stops.length - 1)];
      data[i * 3] = a[0] + (b[0] - a[0]) * eased;
      data[i * 3 + 1] = a[1] + (b[1] - a[1]) * eased;
      data[i * 3 + 2] = a[2] + (b[2] - a[2]) * eased;
    }
    return data;
  }

  function iterationsForZoom(zoom) {
    return Math.min(1500, 180 + Math.max(0, Math.floor(Math.log(zoom) / Math.LN2)) * 32);
  }

  function pixelScale() {
    return 3 / (cssHeight * view.zoom);
  }

  function canvasPoint(event) {
    var rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function complexAt(point) {
    var scale = pixelScale();
    return {
      x: view.x + (point.x - cssWidth / 2) * scale,
      y: view.y + (point.y - cssHeight / 2) * scale
    };
  }

  function formatCoordinate(value) {
    var precision = Math.min(13, Math.max(6, 6 + Math.floor(Math.log(view.zoom) / Math.LN10)));
    return value.toFixed(precision).replace("-", "−");
  }

  function formatZoom(value) {
    if (value >= 1000000) return value.toExponential(2).replace("e+", "e").replace("-", "−") + "×";
    if (value >= 1000) return Math.round(value).toLocaleString("ru-RU") + "×";
    if (value >= 10) return value.toFixed(1) + "×";
    return value.toFixed(2) + "×";
  }

  function updateHud() {
    zoomValue.textContent = formatZoom(view.zoom);
    realValue.textContent = formatCoordinate(view.x);
    imagValue.textContent = formatCoordinate(view.y);
    iterationValue.textContent = String(iterationsForZoom(view.zoom));
  }

  function setRendering(isRendering, detail) {
    renderStatus.parentElement.classList.toggle("is-ready", !isRendering);
    renderStatus.innerHTML = "<i></i> " + (isRendering ? (detail || "расчёт") : "готово");
  }

  function requestRender(interactive) {
    renderGeneration += 1;
    updateHud();
    if (!interactive) pendingFullRender = true;
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      var useInteractivePass = interactive && !pendingFullRender;
      pendingFullRender = false;
      startRender(renderGeneration, useInteractivePass);
    });
  }

  function startRender(generation, interactive) {
    var width = canvas.width;
    var height = canvas.height;
    var totalPixels = width * height;
    var passes;

    if (interactive) passes = [Math.max(3, Math.round(dpr * 2))];
    else if (totalPixels > 9000000) passes = [8, 4, 2, 1];
    else passes = [4, 2, 1];

    setRendering(true, "0%");
    renderPass(generation, passes, 0, 0);
  }

  function renderPass(generation, passes, passIndex, tileIndex) {
    if (generation !== renderGeneration) return;

    var width = canvas.width;
    var height = canvas.height;
    var step = passes[passIndex];
    var iterations = iterationsForZoom(view.zoom);
    var scale = 3 / (height * view.zoom);
    var x0 = view.x - width * scale / 2;
    var y0 = view.y - height * scale / 2;
    var tileWidth = 48;
    var tileHeight = 24;
    var columns = Math.ceil(width / tileWidth);
    var rows = Math.ceil(height / tileHeight);
    var tileCount = columns * rows;
    var currentTile = tileIndex;
    var deadline = performance.now() + 10;

    while (currentTile < tileCount) {
      var tileX = (currentTile % columns) * tileWidth;
      var tileY = Math.floor(currentTile / columns) * tileHeight;
      var currentWidth = Math.min(tileWidth, width - tileX);
      var currentHeight = Math.min(tileHeight, height - tileY);
      var image = context.createImageData(currentWidth, currentHeight);
      var pixels = image.data;

      for (var localY = 0; localY < currentHeight; localY += step) {
        var py = tileY + localY;
        var ci = y0 + (py + step * 0.5) * scale;

        for (var localX = 0; localX < currentWidth; localX += step) {
          var px = tileX + localX;
          var cr = x0 + (px + step * 0.5) * scale;
          var color = colorAt(cr, ci, iterations);
          var blockHeight = Math.min(step, currentHeight - localY);
          var blockWidth = Math.min(step, currentWidth - localX);

          for (var by = 0; by < blockHeight; by += 1) {
            var offset = ((localY + by) * currentWidth + localX) * 4;
            for (var bx = 0; bx < blockWidth; bx += 1) {
              pixels[offset] = color >>> 16;
              pixels[offset + 1] = (color >>> 8) & 255;
              pixels[offset + 2] = color & 255;
              pixels[offset + 3] = 255;
              offset += 4;
            }
          }
        }
      }

      context.putImageData(image, tileX, tileY);
      currentTile += 1;
      if (performance.now() > deadline) break;
    }

    var overall = (passIndex + currentTile / tileCount) / passes.length;
    setRendering(true, Math.min(99, Math.round(overall * 100)) + "%");

    if (generation !== renderGeneration) return;
    if (currentTile < tileCount) {
      requestAnimationFrame(function () {
        renderPass(generation, passes, passIndex, currentTile);
      });
    } else if (passIndex + 1 < passes.length) {
      requestAnimationFrame(function () {
        renderPass(generation, passes, passIndex + 1, 0);
      });
    } else {
      setRendering(false);
    }
  }

  function colorAt(cr, ci, maxIterations) {
    var crMinus = cr - 0.25;
    var q = crMinus * crMinus + ci * ci;
    if (q * (q + crMinus) <= 0.25 * ci * ci || (cr + 1) * (cr + 1) + ci * ci <= 0.0625) {
      return 0x02030a;
    }

    var zr = 0;
    var zi = 0;
    var zr2 = 0;
    var zi2 = 0;
    var iteration = 0;

    while (zr2 + zi2 <= 4 && iteration < maxIterations) {
      zi = 2 * zr * zi + ci;
      zr = zr2 - zi2 + cr;
      zr2 = zr * zr;
      zi2 = zi * zi;
      iteration += 1;
    }

    if (iteration === maxIterations) return 0x02030a;

    var smooth = iteration + 1 - Math.log(Math.log(Math.sqrt(zr2 + zi2))) / Math.LN2;
    var phase = (smooth * 0.021 + Math.log(view.zoom + 1) * 0.008) % 1;
    var index = Math.max(0, Math.min(palette.length / 3 - 1, Math.floor(phase * (palette.length / 3))));
    var p = index * 3;
    return (palette[p] << 16) | (palette[p + 1] << 8) | palette[p + 2];
  }

  function resize() {
    cssWidth = Math.max(1, window.innerWidth);
    cssHeight = Math.max(1, window.innerHeight);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var width = Math.round(cssWidth * dpr);
    var height = Math.round(cssHeight * dpr);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    requestRender(false);
  }

  canvas.addEventListener("wheel", function (event) {
    event.preventDefault();
    var point = canvasPoint(event);
    var before = complexAt(point);
    var factor = Math.exp(-event.deltaY * 0.0014);
    var nextZoom = Math.max(0.35, Math.min(1e13, view.zoom * factor));
    var nextScale = 3 / (cssHeight * nextZoom);

    view.x = before.x - (point.x - cssWidth / 2) * nextScale;
    view.y = before.y - (point.y - cssHeight / 2) * nextScale;
    view.zoom = nextZoom;
    requestRender(true);

    clearTimeout(wheelSettleTimer);
    wheelSettleTimer = setTimeout(function () { requestRender(false); }, 150);
  }, { passive: false });

  canvas.addEventListener("pointerdown", function (event) {
    var point = canvasPoint(event);
    drag = { id: event.pointerId, x: point.x, y: point.y, viewX: view.x, viewY: view.y };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging");
  });

  canvas.addEventListener("pointermove", function (event) {
    var point = canvasPoint(event);
    var coordinate = complexAt(point);
    cursorCoords.innerHTML = "Re " + formatCoordinate(coordinate.x) + "&nbsp;&nbsp;·&nbsp;&nbsp;Im " + formatCoordinate(coordinate.y);

    if (!drag || drag.id !== event.pointerId) return;
    var scale = pixelScale();
    view.x = drag.viewX - (point.x - drag.x) * scale;
    view.y = drag.viewY - (point.y - drag.y) * scale;
    requestRender(true);
  });

  function finishDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    canvas.classList.remove("is-dragging");
    requestRender(false);
  }

  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);

  canvas.addEventListener("dblclick", function (event) {
    var point = canvasPoint(event);
    var before = complexAt(point);
    view.zoom = Math.min(1e13, view.zoom * 2.5);
    var scale = pixelScale();
    view.x = before.x - (point.x - cssWidth / 2) * scale;
    view.y = before.y - (point.y - cssHeight / 2) * scale;
    requestRender(false);
  });

  resetButton.addEventListener("click", function () {
    view.x = -0.5;
    view.y = 0;
    view.zoom = 1;
    requestRender(false);
  });

  window.addEventListener("resize", resize);
  resize();
}());
