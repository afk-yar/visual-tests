(function () {
  "use strict";

  var MAP_SIZE = 1024;
  var MAP_MASK = MAP_SIZE - 1;
  var WATER_LEVEL = 82;
  var SNOW_LEVEL = 216;
  var FOV = 1.18;
  var MAX_RENDER_WIDTH = 920;
  var MAX_RENDER_HEIGHT = 560;

  var canvas = document.getElementById("view");
  var ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;

  var controls = {
    height: document.getElementById("heightControl"),
    distance: document.getElementById("distanceControl"),
    horizon: document.getElementById("horizonControl")
  };

  var outputs = {
    height: document.getElementById("heightValue"),
    distance: document.getElementById("distanceValue"),
    horizon: document.getElementById("horizonValue"),
    fps: document.getElementById("fps")
  };

  var heightMap = new Float32Array(MAP_SIZE * MAP_SIZE);
  var colorMap = new Uint32Array(MAP_SIZE * MAP_SIZE);
  var shadeMap = new Uint8Array(MAP_SIZE * MAP_SIZE);

  var width = 0;
  var height = 0;
  var imageData = null;
  var pixels = null;
  var yBuffer = null;
  var skyRows = null;
  var lastTime = performance.now();
  var fpsSmooth = 60;
  var camera = {
    x: 318,
    y: 742,
    z: 160,
    angle: 0.7,
    speed: 38
  };

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function smoothstep(edge0, edge1, value) {
    var x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return x * x * (3 - 2 * x);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function pack(r, g, b) {
    r = clamp(r + 0.5, 0, 255) | 0;
    g = clamp(g + 0.5, 0, 255) | 0;
    b = clamp(b + 0.5, 0, 255) | 0;
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }

  function mixPacked(color, r, g, b, t) {
    var cr = color & 255;
    var cg = (color >> 8) & 255;
    var cb = (color >> 16) & 255;
    return pack(
      cr + (r - cr) * t,
      cg + (g - cg) * t,
      cb + (b - cb) * t
    );
  }

  function hash2(ix, iy) {
    var n = (ix * 374761393 + iy * 668265263) | 0;
    n = (n ^ (n >>> 13)) | 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function valueNoise(x, y) {
    var ix = Math.floor(x);
    var iy = Math.floor(y);
    var fx = x - ix;
    var fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);

    var a = hash2(ix, iy);
    var b = hash2(ix + 1, iy);
    var c = hash2(ix, iy + 1);
    var d = hash2(ix + 1, iy + 1);
    var x1 = lerp(a, b, fx);
    var x2 = lerp(c, d, fx);
    return lerp(x1, x2, fy);
  }

  function fbm(x, y, octaves, lacunarity, gain) {
    var sum = 0;
    var amp = 0.5;
    var freq = 1;
    var norm = 0;
    for (var i = 0; i < octaves; i++) {
      sum += valueNoise(x * freq, y * freq) * amp;
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  }

  function ridge(x, y) {
    var sum = 0;
    var amp = 0.55;
    var freq = 1;
    var norm = 0;
    for (var i = 0; i < 6; i++) {
      var n = valueNoise(x * freq + 19.1, y * freq - 8.7);
      n = 1 - Math.abs(n * 2 - 1);
      sum += n * n * amp;
      norm += amp;
      freq *= 2.05;
      amp *= 0.52;
    }
    return sum / norm;
  }

  function generateMap() {
    var index = 0;
    for (var y = 0; y < MAP_SIZE; y++) {
      for (var x = 0; x < MAP_SIZE; x++, index++) {
        var nx = x / MAP_SIZE;
        var ny = y / MAP_SIZE;
        var warpX = fbm(nx * 3.0 + 4.2, ny * 3.0 - 1.1, 4, 2.0, 0.5) - 0.5;
        var warpY = fbm(nx * 3.0 - 6.3, ny * 3.0 + 9.4, 4, 2.0, 0.5) - 0.5;
        var wx = nx + warpX * 0.09;
        var wy = ny + warpY * 0.09;
        var continents = fbm(wx * 1.85, wy * 1.85, 5, 2.0, 0.54);
        var hills = fbm(wx * 7.5 + 12.0, wy * 7.5 - 2.0, 5, 2.0, 0.5);
        var peaks = ridge(wx * 5.1 - 3.0, wy * 5.1 + 7.0);
        var valleys = fbm(wx * 14.0, wy * 14.0, 3, 2.0, 0.45);
        var mountainMask = smoothstep(0.45, 0.82, continents + peaks * 0.3);
        var shore = smoothstep(0.35, 0.7, continents);
        var h = 34 + continents * 96 + hills * 46 + peaks * peaks * 135 * mountainMask;
        h -= (1 - shore) * 44;
        h += (valleys - 0.5) * 18;
        h = clamp(h, 18, 255);
        heightMap[index] = h;
      }
    }

    buildColorAndShadeMaps();
  }

  function buildColorAndShadeMaps() {
    var sunX = -0.72;
    var sunY = -0.48;
    var sunZ = 0.5;
    var sunLen = Math.sqrt(sunX * sunX + sunY * sunY + sunZ * sunZ);
    sunX /= sunLen;
    sunY /= sunLen;
    sunZ /= sunLen;

    for (var y = 0; y < MAP_SIZE; y++) {
      var ym = (y - 1) & MAP_MASK;
      var yp = (y + 1) & MAP_MASK;
      for (var x = 0; x < MAP_SIZE; x++) {
        var xm = (x - 1) & MAP_MASK;
        var xp = (x + 1) & MAP_MASK;
        var i = y * MAP_SIZE + x;
        var h = heightMap[i];
        var sx = heightMap[y * MAP_SIZE + xm] - heightMap[y * MAP_SIZE + xp];
        var sy = heightMap[ym * MAP_SIZE + x] - heightMap[yp * MAP_SIZE + x];
        var nx = sx * 0.045;
        var ny = sy * 0.045;
        var nz = 1;
        var invLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= invLen;
        ny *= invLen;
        nz *= invLen;
        var light = clamp(nx * sunX + ny * sunY + nz * sunZ, 0, 1);
        var ambient = 0.44;
        var shade = ambient + light * 0.78;
        var noise = valueNoise(x * 0.055, y * 0.055);
        var r;
        var g;
        var b;

        if (h < WATER_LEVEL) {
          var depth = clamp((WATER_LEVEL - h) / 62, 0, 1);
          var sparkle = Math.pow(light, 5) * 32;
          r = lerp(34, 6, depth) + sparkle;
          g = lerp(128, 57, depth) + sparkle * 0.55;
          b = lerp(158, 116, depth) + sparkle * 0.45;
          shade = 0.82 + light * 0.22;
        } else if (h < WATER_LEVEL + 16) {
          var beach = (h - WATER_LEVEL) / 16;
          r = lerp(171, 112, beach);
          g = lerp(151, 132, beach);
          b = lerp(92, 76, beach);
        } else if (h < 148) {
          var grass = (h - WATER_LEVEL - 16) / 50;
          r = lerp(62, 54, grass) + noise * 19;
          g = lerp(132, 160, grass) + noise * 24;
          b = lerp(76, 78, grass) + noise * 10;
        } else if (h < SNOW_LEVEL) {
          var rock = (h - 148) / (SNOW_LEVEL - 148);
          r = lerp(103, 137, rock) + noise * 18;
          g = lerp(105, 126, rock) + noise * 14;
          b = lerp(98, 116, rock) + noise * 18;
        } else {
          var snow = clamp((h - SNOW_LEVEL) / 35, 0, 1);
          r = lerp(187, 247, snow) + noise * 9;
          g = lerp(198, 251, snow) + noise * 9;
          b = lerp(205, 255, snow) + noise * 11;
          shade += 0.05;
        }

        var shadow = clamp((heightMap[yp * MAP_SIZE + xp] - h) * 0.015, -0.12, 0.2);
        shade = clamp(shade - shadow, 0.35, 1.35);
        colorMap[i] = pack(r * shade, g * shade, b * shade);
        shadeMap[i] = clamp(shade * 180 + 42, 0, 255) | 0;
      }
    }
  }

  function resize() {
    var cssWidth = Math.max(1, window.innerWidth);
    var cssHeight = Math.max(1, window.innerHeight);
    var scale = cssWidth > 1200 ? 1.55 : cssWidth > 760 ? 1.35 : 1.05;
    width = Math.min(MAX_RENDER_WIDTH, Math.max(360, Math.floor(cssWidth / scale)));
    height = Math.min(MAX_RENDER_HEIGHT, Math.max(240, Math.floor(cssHeight / scale)));
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    ctx.imageSmoothingEnabled = false;
    imageData = ctx.createImageData(width, height);
    pixels = new Uint32Array(imageData.data.buffer);
    yBuffer = new Int16Array(width);
    skyRows = new Uint32Array(height);
  }

  function updateControlLabels() {
    outputs.height.value = controls.height.value;
    outputs.distance.value = controls.distance.value;
    outputs.horizon.value = controls.horizon.value + "%";
  }

  function sampleHeight(wx, wy) {
    return heightMap[((wy | 0) & MAP_MASK) * MAP_SIZE + ((wx | 0) & MAP_MASK)];
  }

  function buildSky(horizon, time) {
    var topR = 12;
    var topG = 28;
    var topB = 55;
    var midR = 67;
    var midG = 114;
    var midB = 163;
    var hazeR = 199;
    var hazeG = 171;
    var hazeB = 135;
    var lowR = 71;
    var lowG = 96;
    var lowB = 109;
    var sunPulse = 0.5 + Math.sin(time * 0.23) * 0.5;

    for (var y = 0; y < height; y++) {
      var r;
      var g;
      var b;
      if (y <= horizon) {
        var t = y / Math.max(1, horizon);
        var haze = Math.pow(t, 3.4);
        r = lerp(topR, midR, t);
        g = lerp(topG, midG, t);
        b = lerp(topB, midB, t);
        r = lerp(r, hazeR, haze);
        g = lerp(g, hazeG, haze);
        b = lerp(b, hazeB, haze);
      } else {
        var groundT = (y - horizon) / Math.max(1, height - horizon);
        r = lerp(hazeR, lowR, groundT);
        g = lerp(hazeG, lowG, groundT);
        b = lerp(hazeB, lowB, groundT);
      }
      var sunBand = Math.exp(-Math.pow((y - horizon * 0.84) / Math.max(16, height * 0.12), 2)) * 14 * sunPulse;
      skyRows[y] = pack(r + sunBand, g + sunBand * 0.72, b + sunBand * 0.24);
    }

    for (var row = 0; row < height; row++) {
      var color = skyRows[row];
      var offset = row * width;
      for (var x = 0; x < width; x++) {
        pixels[offset + x] = color;
      }
    }
  }

  function render(time, dt) {
    var altitude = Number(controls.height.value);
    var drawDistance = Number(controls.distance.value);
    var horizon = Math.floor(height * Number(controls.horizon.value) / 100);
    var terrainUnderCamera = Math.max(sampleHeight(camera.x, camera.y), WATER_LEVEL);
    camera.z = terrainUnderCamera + altitude;

    var turn = Math.sin(time * 0.052) * 0.42 + Math.sin(time * 0.017 + 1.7) * 0.34;
    camera.angle = 0.78 + turn;
    camera.speed = 43 + Math.sin(time * 0.11) * 11;
    camera.x += Math.cos(camera.angle) * camera.speed * dt;
    camera.y += Math.sin(camera.angle) * camera.speed * dt;

    buildSky(horizon, time);
    yBuffer.fill(height);

    var sinA = Math.sin(camera.angle);
    var cosA = Math.cos(camera.angle);
    var rightX = -sinA;
    var rightY = cosA;
    var projection = height * 0.86;
    var fogStart = drawDistance * 0.36;
    var fogR = 186;
    var fogG = 174;
    var fogB = 151;
    var z = 4;
    var dz = 1;

    while (z < drawDistance) {
      var halfWidth = z * FOV * 0.5;
      var worldX = camera.x + cosA * z - rightX * halfWidth;
      var worldY = camera.y + sinA * z - rightY * halfWidth;
      var stepX = rightX * (halfWidth * 2 / width);
      var stepY = rightY * (halfWidth * 2 / width);
      var fog = smoothstep(fogStart, drawDistance, z);
      var invZ = projection / z;
      var waterWave = Math.sin(z * 0.035 + time * 2.0) * 0.85;

      for (var sx = 0; sx < width; sx++) {
        var mapX = (worldX | 0) & MAP_MASK;
        var mapY = (worldY | 0) & MAP_MASK;
        var idx = mapY * MAP_SIZE + mapX;
        var terrainHeight = heightMap[idx];
        var visibleHeight = terrainHeight < WATER_LEVEL ? WATER_LEVEL + waterWave : terrainHeight;
        var projectedY = (horizon - (visibleHeight - camera.z) * invZ) | 0;

        if (projectedY < yBuffer[sx]) {
          var yTop = projectedY < 0 ? 0 : projectedY;
          var yBottom = yBuffer[sx];
          if (yBottom > height) {
            yBottom = height;
          }

          var color = colorMap[idx];
          if (terrainHeight < WATER_LEVEL) {
            var shimmer = (Math.sin((worldX + worldY) * 0.073 + time * 3.1) + Math.sin(worldX * 0.11 - time * 2.2)) * 8;
            color = pack(
              ((color & 255) + shimmer),
              (((color >> 8) & 255) + shimmer * 0.8),
              (((color >> 16) & 255) + shimmer * 1.6)
            );
          } else {
            var shade = shadeMap[idx] / 255;
            var depthShade = 1 - fog * 0.18;
            color = mixPacked(color, 18, 23, 28, clamp((0.62 - shade) * 0.28, 0, 0.16));
            color = mixPacked(color, 0, 0, 0, 1 - depthShade);
          }
          color = mixPacked(color, fogR, fogG, fogB, fog);

          var offset = yTop * width + sx;
          for (var py = yTop; py < yBottom; py++) {
            pixels[offset] = color;
            offset += width;
          }
          yBuffer[sx] = yTop;
        }

        worldX += stepX;
        worldY += stepY;
      }

      z += dz;
      dz += 0.008 + z * 0.000018;
    }

    ctx.putImageData(imageData, 0, 0);
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    var time = now / 1000;
    render(time, dt);
    fpsSmooth = fpsSmooth * 0.92 + (1 / Math.max(dt, 0.001)) * 0.08;
    outputs.fps.value = Math.round(fpsSmooth) + " fps";
    requestAnimationFrame(frame);
  }

  function init() {
    updateControlLabels();
    generateMap();
    resize();
    window.addEventListener("resize", resize);
    controls.height.addEventListener("input", updateControlLabels);
    controls.distance.addEventListener("input", updateControlLabels);
    controls.horizon.addEventListener("input", updateControlLabels);
    requestAnimationFrame(function (now) {
      lastTime = now;
      requestAnimationFrame(frame);
    });
  }

  init();
}());
