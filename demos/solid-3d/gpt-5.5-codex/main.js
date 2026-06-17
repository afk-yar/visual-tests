(function () {
  "use strict";

  var canvas = document.getElementById("scene");
  var ctx = canvas.getContext("2d", { alpha: false });
  var backCanvas = document.createElement("canvas");
  var backCtx = backCanvas.getContext("2d", { alpha: false });

  var fillToggle = document.getElementById("fillToggle");
  var wireToggle = document.getElementById("wireToggle");
  var fpsOutput = document.getElementById("fps");
  var meshInfo = document.getElementById("meshInfo");

  var renderWidth = 1;
  var renderHeight = 1;
  var imageData = null;
  var pixels = null;
  var zBuffer = null;
  var projected = [];
  var visibleFaces = [];
  var lastTime = 0;
  var fpsSmoother = 60;
  var angleX = -0.45;
  var angleY = 0.2;
  var angleZ = 0;

  var state = {
    fill: true,
    wire: true,
    shade: "gouraud"
  };

  var mesh = createTorus(56, 22, 1.22, 0.46);
  meshInfo.textContent = mesh.triangles.length + " tris";

  function createTorus(majorSteps, minorSteps, majorRadius, minorRadius) {
    var vertices = [];
    var triangles = [];
    var i;
    var j;

    for (i = 0; i < majorSteps; i += 1) {
      var u = i / majorSteps * Math.PI * 2;
      var cu = Math.cos(u);
      var su = Math.sin(u);

      for (j = 0; j < minorSteps; j += 1) {
        var v = j / minorSteps * Math.PI * 2;
        var cv = Math.cos(v);
        var sv = Math.sin(v);
        var ring = majorRadius + minorRadius * cv;

        vertices.push({
          x: ring * cu,
          y: minorRadius * sv,
          z: ring * su,
          nx: cv * cu,
          ny: sv,
          nz: cv * su,
          paint: 0.5 + 0.5 * Math.sin(u * 2.0 + v * 0.45)
        });
      }
    }

    function id(a, b) {
      var ia = (a + majorSteps) % majorSteps;
      var ib = (b + minorSteps) % minorSteps;
      return ia * minorSteps + ib;
    }

    for (i = 0; i < majorSteps; i += 1) {
      for (j = 0; j < minorSteps; j += 1) {
        var a = id(i, j);
        var b = id(i + 1, j);
        var c = id(i + 1, j + 1);
        var d = id(i, j + 1);

        triangles.push([a, d, b]);
        triangles.push([b, d, c]);
      }
    }

    return {
      vertices: vertices,
      triangles: triangles
    };
  }

  function rotationX(a) {
    var c = Math.cos(a);
    var s = Math.sin(a);
    return [
      1, 0, 0,
      0, c, -s,
      0, s, c
    ];
  }

  function rotationY(a) {
    var c = Math.cos(a);
    var s = Math.sin(a);
    return [
      c, 0, s,
      0, 1, 0,
      -s, 0, c
    ];
  }

  function rotationZ(a) {
    var c = Math.cos(a);
    var s = Math.sin(a);
    return [
      c, -s, 0,
      s, c, 0,
      0, 0, 1
    ];
  }

  function multiply3(a, b) {
    return [
      a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
      a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
      a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
      a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
      a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
      a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
      a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
      a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
      a[6] * b[2] + a[7] * b[5] + a[8] * b[8]
    ];
  }

  function transformPoint(m, x, y, z) {
    return {
      x: m[0] * x + m[1] * y + m[2] * z,
      y: m[3] * x + m[4] * y + m[5] * z,
      z: m[6] * x + m[7] * y + m[8] * z
    };
  }

  function dot(ax, ay, az, bx, by, bz) {
    return ax * bx + ay * by + az * bz;
  }

  function normalize(x, y, z) {
    var len = Math.sqrt(x * x + y * y + z * z) || 1;
    return {
      x: x / len,
      y: y / len,
      z: z / len
    };
  }

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function shadeColor(nx, ny, nz, px, py, pz, paint) {
    var lightX = -2.25;
    var lightY = 2.55;
    var lightZ = 1.25;
    var lx = lightX - px;
    var ly = lightY - py;
    var lz = lightZ - pz;
    var light = normalize(lx, ly, lz);
    var view = normalize(-px, -py, -pz);
    var half = normalize(light.x + view.x, light.y + view.y, light.z + view.z);
    var diffuse = Math.max(0, dot(nx, ny, nz, light.x, light.y, light.z));
    var specular = Math.pow(Math.max(0, dot(nx, ny, nz, half.x, half.y, half.z)), 34);
    var facing = Math.max(0, dot(nx, ny, nz, view.x, view.y, view.z));
    var rim = Math.pow(Math.max(0, 1 - facing), 2.2);
    var lightAmount = 0.14 + 0.92 * diffuse;
    var warm = Math.min(1, Math.max(0, paint));
    var baseR = mix(38, 250, warm);
    var baseG = mix(205, 154, warm);
    var baseB = mix(198, 79, warm);

    return {
      r: clamp255(baseR * lightAmount + 245 * specular + 28 * rim),
      g: clamp255(baseG * lightAmount + 230 * specular + 70 * rim),
      b: clamp255(baseB * lightAmount + 205 * specular + 82 * rim)
    };
  }

  function clamp255(value) {
    return value < 0 ? 0 : value > 255 ? 255 : value;
  }

  function resize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cssWidth = Math.max(280, window.innerWidth || 280);
    var cssHeight = Math.max(240, window.innerHeight || 240);
    var displayWidth = Math.max(1, Math.round(cssWidth * dpr));
    var displayHeight = Math.max(1, Math.round(cssHeight * dpr));
    var pixelLimit = cssWidth < 700 ? 360000 : 650000;
    var scale = Math.min(1, Math.sqrt(pixelLimit / (displayWidth * displayHeight)));
    var nextWidth = Math.max(240, Math.round(displayWidth * scale));
    var nextHeight = Math.max(180, Math.round(displayHeight * scale));

    canvas.width = displayWidth;
    canvas.height = displayHeight;

    if (nextWidth !== renderWidth || nextHeight !== renderHeight) {
      renderWidth = nextWidth;
      renderHeight = nextHeight;
      backCanvas.width = renderWidth;
      backCanvas.height = renderHeight;
      imageData = backCtx.createImageData(renderWidth, renderHeight);
      pixels = imageData.data;
      zBuffer = new Float32Array(renderWidth * renderHeight);
    }
  }

  function clearBuffers() {
    var x;
    var y;
    var i = 0;
    var zIndex = 0;

    for (y = 0; y < renderHeight; y += 1) {
      var t = y / Math.max(1, renderHeight - 1);
      var r = Math.round(mix(7, 15, t));
      var g = Math.round(mix(9, 17, t));
      var b = Math.round(mix(13, 23, t));

      for (x = 0; x < renderWidth; x += 1) {
        var cx = x / renderWidth - 0.5;
        var cy = y / renderHeight - 0.5;
        var vignette = Math.min(1, (cx * cx + cy * cy) * 1.2);
        pixels[i] = r - vignette * 5;
        pixels[i + 1] = g - vignette * 5;
        pixels[i + 2] = b - vignette * 3;
        pixels[i + 3] = 255;
        zBuffer[zIndex] = -Infinity;
        i += 4;
        zIndex += 1;
      }
    }
  }

  function buildFrame(elapsed) {
    angleX += elapsed * 0.00018;
    angleY += elapsed * 0.00027;
    angleZ += elapsed * 0.00007;

    var matrix = multiply3(rotationY(angleY), multiply3(rotationX(angleX), rotationZ(angleZ)));
    var cameraDistance = 4.55;
    var focal = Math.min(renderWidth, renderHeight) * 1.08;
    var cx = renderWidth * 0.5;
    var cy = renderHeight * 0.51;
    var vertices = mesh.vertices;
    var i;

    projected.length = vertices.length;

    for (i = 0; i < vertices.length; i += 1) {
      var source = vertices[i];
      var p = transformPoint(matrix, source.x, source.y, source.z);
      var n = transformPoint(matrix, source.nx, source.ny, source.nz);
      var z = p.z + cameraDistance;
      var invZ = 1 / z;
      var color = shadeColor(n.x, n.y, n.z, p.x, p.y, z, source.paint);

      projected[i] = {
        x: p.x,
        y: p.y,
        z: z,
        sx: cx + p.x * focal * invZ,
        sy: cy - p.y * focal * invZ,
        iz: invZ,
        nx: n.x,
        ny: n.y,
        nz: n.z,
        paint: source.paint,
        r: color.r,
        g: color.g,
        b: color.b
      };
    }

    visibleFaces.length = 0;

    for (i = 0; i < mesh.triangles.length; i += 1) {
      var tri = mesh.triangles[i];
      var a = projected[tri[0]];
      var b = projected[tri[1]];
      var c = projected[tri[2]];
      var ux = b.x - a.x;
      var uy = b.y - a.y;
      var uz = b.z - a.z;
      var vx = c.x - a.x;
      var vy = c.y - a.y;
      var vz = c.z - a.z;
      var nx = uy * vz - uz * vy;
      var ny = uz * vx - ux * vz;
      var nz = ux * vy - uy * vx;
      var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;

      if (dot(nx, ny, nz, a.x, a.y, a.z) >= 0) {
        continue;
      }

      var paint = (a.paint + b.paint + c.paint) / 3;
      var centroidX = (a.x + b.x + c.x) / 3;
      var centroidY = (a.y + b.y + c.y) / 3;
      var centroidZ = (a.z + b.z + c.z) / 3;
      var flat = shadeColor(nx, ny, nz, centroidX, centroidY, centroidZ, paint);

      visibleFaces.push({
        a: a,
        b: b,
        c: c,
        flat: flat
      });
    }
  }

  function edge(ax, ay, bx, by, px, py) {
    return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  }

  function rasterTriangle(face, depthOnly) {
    var a = face.a;
    var b = face.b;
    var c = face.c;
    var minX = Math.max(0, Math.floor(Math.min(a.sx, b.sx, c.sx)));
    var maxX = Math.min(renderWidth - 1, Math.ceil(Math.max(a.sx, b.sx, c.sx)));
    var minY = Math.max(0, Math.floor(Math.min(a.sy, b.sy, c.sy)));
    var maxY = Math.min(renderHeight - 1, Math.ceil(Math.max(a.sy, b.sy, c.sy)));
    var area = edge(a.sx, a.sy, b.sx, b.sy, c.sx, c.sy);

    if (area === 0 || minX > maxX || minY > maxY) {
      return;
    }

    var invArea = 1 / area;
    var flat = state.shade === "flat";
    var y;
    var x;

    for (y = minY; y <= maxY; y += 1) {
      var py = y + 0.5;
      var row = y * renderWidth;

      for (x = minX; x <= maxX; x += 1) {
        var px = x + 0.5;
        var w0 = edge(b.sx, b.sy, c.sx, c.sy, px, py) * invArea;
        var w1 = edge(c.sx, c.sy, a.sx, a.sy, px, py) * invArea;
        var w2 = 1 - w0 - w1;

        if (w0 >= -0.00001 && w1 >= -0.00001 && w2 >= -0.00001) {
          var depth = w0 * a.iz + w1 * b.iz + w2 * c.iz;
          var zi = row + x;

          if (depth > zBuffer[zi]) {
            zBuffer[zi] = depth;

            if (!depthOnly) {
              var pi = zi * 4;
              var rr;
              var gg;
              var bb;

              if (flat) {
                rr = face.flat.r;
                gg = face.flat.g;
                bb = face.flat.b;
              } else {
                rr = w0 * a.r + w1 * b.r + w2 * c.r;
                gg = w0 * a.g + w1 * b.g + w2 * c.g;
                bb = w0 * a.b + w1 * b.b + w2 * c.b;
              }

              pixels[pi] = rr;
              pixels[pi + 1] = gg;
              pixels[pi + 2] = bb;
            }
          }
        }
      }
    }
  }

  function plotWirePixel(x, y, depth, r, g, b) {
    if (x < 0 || x >= renderWidth || y < 0 || y >= renderHeight) {
      return;
    }

    var zi = y * renderWidth + x;

    if (depth + 0.00055 >= zBuffer[zi]) {
      var pi = zi * 4;
      pixels[pi] = Math.min(255, pixels[pi] * 0.42 + r * 0.72);
      pixels[pi + 1] = Math.min(255, pixels[pi + 1] * 0.42 + g * 0.72);
      pixels[pi + 2] = Math.min(255, pixels[pi + 2] * 0.42 + b * 0.72);
    }
  }

  function drawLine(a, b) {
    var dx = b.sx - a.sx;
    var dy = b.sy - a.sy;
    var steps = Math.max(Math.abs(dx), Math.abs(dy));
    var i;

    if (steps < 1) {
      return;
    }

    for (i = 0; i <= steps; i += 1) {
      var t = i / steps;
      var x = Math.round(a.sx + dx * t);
      var y = Math.round(a.sy + dy * t);
      var depth = a.iz + (b.iz - a.iz) * t;

      plotWirePixel(x, y, depth, 230, 248, 255);

      if (renderWidth > 680) {
        plotWirePixel(x + 1, y, depth, 138, 231, 224);
        plotWirePixel(x, y + 1, depth, 138, 231, 224);
      }
    }
  }

  function drawWire(face) {
    drawLine(face.a, face.b);
    drawLine(face.b, face.c);
    drawLine(face.c, face.a);
  }

  function render(time) {
    if (!lastTime) {
      lastTime = time;
    }

    var elapsed = Math.min(48, time - lastTime);
    lastTime = time;

    resize();
    clearBuffers();
    buildFrame(elapsed);

    var depthOnly = !state.fill;
    var i;

    for (i = 0; i < visibleFaces.length; i += 1) {
      rasterTriangle(visibleFaces[i], depthOnly);
    }

    if (state.wire) {
      for (i = 0; i < visibleFaces.length; i += 1) {
        drawWire(visibleFaces[i]);
      }
    }

    backCtx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(backCanvas, 0, 0, renderWidth, renderHeight, 0, 0, canvas.width, canvas.height);

    var instantFps = elapsed > 0 ? 1000 / elapsed : 60;
    fpsSmoother = fpsSmoother * 0.92 + instantFps * 0.08;
    fpsOutput.textContent = Math.round(fpsSmoother) + " fps";

    requestAnimationFrame(render);
  }

  function syncControls() {
    state.fill = fillToggle.checked;
    state.wire = wireToggle.checked;

    if (!state.fill && !state.wire) {
      state.fill = true;
      fillToggle.checked = true;
    }

    var modes = document.querySelectorAll("input[name='shade']");
    var i;
    for (i = 0; i < modes.length; i += 1) {
      if (modes[i].checked) {
        state.shade = modes[i].value;
        break;
      }
    }
  }

  fillToggle.addEventListener("change", syncControls);
  wireToggle.addEventListener("change", syncControls);
  document.addEventListener("change", function (event) {
    if (event.target && event.target.name === "shade") {
      syncControls();
    }
  });
  window.addEventListener("resize", resize);

  syncControls();
  resize();
  requestAnimationFrame(render);
}());
