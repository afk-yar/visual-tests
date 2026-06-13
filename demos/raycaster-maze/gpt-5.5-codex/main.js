(function () {
  "use strict";

  var shell = document.querySelector(".demo-shell");
  var canvas = document.getElementById("view");
  var ctx = canvas.getContext("2d", { alpha: false });

  var MAP_W = 31;
  var MAP_H = 31;
  var FOV = Math.PI / 3;
  var PLANE_LEN = Math.tan(FOV * 0.5);
  var MAX_RENDER_W = 1180;
  var MAX_RENDER_H = 760;
  var WALL_RADIUS = 0.19;
  var keys = Object.create(null);
  var maze = null;
  var seed = ((Date.now() >>> 0) ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
  var rand = mulberry32(seed);
  var lastTime = performance.now();
  var animatedLight = 0;

  var player = {
    x: 1.5,
    y: 1.5,
    angle: 0,
    moving: 0
  };

  var wallPalettes = [
    [112, 153, 177],
    [179, 127, 78],
    [124, 159, 103],
    [151, 105, 137],
    [159, 155, 125]
  ];

  var fogColor = [7, 9, 12];

  boot();

  function boot() {
    maze = makeMaze(MAP_W, MAP_H);
    placePlayer();
    resize();
    bindInput();
    requestAnimationFrame(frame);
  }

  function bindInput() {
    var handled = {
      KeyW: true,
      KeyA: true,
      KeyS: true,
      KeyD: true,
      ArrowLeft: true,
      ArrowRight: true
    };

    shell.addEventListener("pointerdown", function () {
      shell.focus({ preventScroll: true });
    });

    window.addEventListener("keydown", function (event) {
      if (!handled[event.code]) {
        return;
      }
      keys[event.code] = true;
      event.preventDefault();
    }, { passive: false });

    window.addEventListener("keyup", function (event) {
      if (!handled[event.code]) {
        return;
      }
      keys[event.code] = false;
      event.preventDefault();
    }, { passive: false });

    window.addEventListener("blur", function () {
      keys = Object.create(null);
    });

    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe(shell);
    } else {
      window.addEventListener("resize", resize);
    }

    setTimeout(function () {
      shell.focus({ preventScroll: true });
    }, 60);
  }

  function resize() {
    var rect = shell.getBoundingClientRect();
    var cssW = Math.max(1, rect.width || window.innerWidth || 1);
    var cssH = Math.max(1, rect.height || window.innerHeight || 1);
    var dpr = Math.min(window.devicePixelRatio || 1, 1.55);
    var scale = Math.min(dpr, MAX_RENDER_W / cssW, MAX_RENDER_H / cssH);

    canvas.width = Math.max(240, Math.floor(cssW * Math.max(0.35, scale)));
    canvas.height = Math.max(160, Math.floor(cssH * Math.max(0.35, scale)));
    ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = false;
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
    lastTime = now;
    update(dt);
    render(now * 0.001);
    requestAnimationFrame(frame);
  }

  function update(dt) {
    var turn = 0;
    if (keys.ArrowLeft) {
      turn -= 1;
    }
    if (keys.ArrowRight) {
      turn += 1;
    }
    player.angle += turn * 2.35 * dt;

    var forward = 0;
    var strafe = 0;
    if (keys.KeyW) {
      forward += 1;
    }
    if (keys.KeyS) {
      forward -= 1;
    }
    if (keys.KeyD) {
      strafe += 1;
    }
    if (keys.KeyA) {
      strafe -= 1;
    }

    var length = Math.hypot(forward, strafe);
    if (length > 1) {
      forward /= length;
      strafe /= length;
    }

    var dirX = Math.cos(player.angle);
    var dirY = Math.sin(player.angle);
    var rightX = -dirY;
    var rightY = dirX;
    var speed = 2.65 * dt;
    var dx = (dirX * forward + rightX * strafe) * speed;
    var dy = (dirY * forward + rightY * strafe) * speed;

    player.moving = length;
    animatedLight += dt * (0.7 + length * 1.4);
    moveWithSliding(dx, dy);
  }

  function moveWithSliding(dx, dy) {
    if (dx && canOccupy(player.x + dx, player.y)) {
      player.x += dx;
    }
    if (dy && canOccupy(player.x, player.y + dy)) {
      player.y += dy;
    }
  }

  function canOccupy(x, y) {
    return !isWall(x - WALL_RADIUS, y - WALL_RADIUS) &&
      !isWall(x + WALL_RADIUS, y - WALL_RADIUS) &&
      !isWall(x - WALL_RADIUS, y + WALL_RADIUS) &&
      !isWall(x + WALL_RADIUS, y + WALL_RADIUS);
  }

  function render(time) {
    var w = canvas.width;
    var h = canvas.height;
    var horizon = h >> 1;
    var dirX = Math.cos(player.angle);
    var dirY = Math.sin(player.angle);
    var planeX = -dirY * PLANE_LEN;
    var planeY = dirX * PLANE_LEN;

    drawFloorAndCeiling(w, h, horizon, dirX, dirY, planeX, planeY, time);
    drawWalls(w, h, horizon, dirX, dirY, planeX, planeY);
    drawAtmosphere(w, h, horizon);
    drawMinimap(w, h, dirX, dirY);
  }

  function drawFloorAndCeiling(w, h, horizon, dirX, dirY, planeX, planeY, time) {
    var step = Math.max(2, Math.floor(w / 360));
    var rayLeftX = dirX - planeX;
    var rayLeftY = dirY - planeY;
    var rayRightX = dirX + planeX;
    var rayRightY = dirY + planeY;

    ctx.fillStyle = "#10141b";
    ctx.fillRect(0, 0, w, horizon);
    ctx.fillStyle = "#181512";
    ctx.fillRect(0, horizon, w, h - horizon);

    for (var y = horizon; y < h; y += step) {
      var rowDist = (0.48 * h) / (y - horizon + 1);
      var floorStepX = rowDist * (rayRightX - rayLeftX) / w * step;
      var floorStepY = rowDist * (rayRightY - rayLeftY) / w * step;
      var floorX = player.x + rowDist * rayLeftX;
      var floorY = player.y + rowDist * rayLeftY;

      for (var x = 0; x < w; x += step) {
        var cellX = Math.floor(floorX);
        var cellY = Math.floor(floorY);
        var localX = floorX - cellX;
        var localY = floorY - cellY;
        var grid = localX < 0.045 || localY < 0.045 || localX > 0.955 || localY > 0.955;
        var checker = (cellX + cellY) & 1;
        var worn = hash2(cellX, cellY) * 0.12;
        var shade = 1 / (1 + rowDist * rowDist * 0.028);
        var base = checker ? [50, 43, 35] : [37, 38, 38];

        if (grid) {
          base = [82, 68, 48];
        }

        ctx.fillStyle = colorString(tint(base, 0.52 + shade * 0.66 + worn, fogColor, 1 - shade));
        ctx.fillRect(x, y, step, step);
        floorX += floorStepX;
        floorY += floorStepY;
      }
    }

    for (var cy = horizon - step; cy >= 0; cy -= step) {
      var ceilDist = (0.54 * h) / (horizon - cy + 1);
      var ceilStepX = ceilDist * (rayRightX - rayLeftX) / w * step;
      var ceilStepY = ceilDist * (rayRightY - rayLeftY) / w * step;
      var ceilX = player.x + ceilDist * rayLeftX;
      var ceilY = player.y + ceilDist * rayLeftY;
      var pulse = 0.96 + Math.sin(time * 1.7 + cy * 0.06) * 0.025;

      for (var cx = 0; cx < w; cx += step) {
        var ccx = Math.floor(ceilX);
        var ccy = Math.floor(ceilY);
        var lx = ceilX - ccx;
        var ly = ceilY - ccy;
        var seam = lx < 0.035 || ly < 0.035 || lx > 0.965 || ly > 0.965;
        var panel = ((ccx * 3 + ccy * 5) & 3) === 0;
        var distShade = 1 / (1 + ceilDist * ceilDist * 0.022);
        var ceilBase = panel ? [42, 51, 61] : [31, 34, 43];

        if (seam) {
          ceilBase = [16, 18, 23];
        }

        ctx.fillStyle = colorString(tint(ceilBase, (0.58 + distShade * 0.6) * pulse, fogColor, 1 - distShade));
        ctx.fillRect(cx, cy, step, step);
        ceilX += ceilStepX;
        ceilY += ceilStepY;
      }
    }
  }

  function drawWalls(w, h, horizon, dirX, dirY, planeX, planeY) {
    var columnStep = Math.max(1, Math.floor(w / 900));

    for (var x = 0; x < w; x += columnStep) {
      var cameraX = 2 * (x + columnStep * 0.5) / w - 1;
      var rayDirX = dirX + planeX * cameraX;
      var rayDirY = dirY + planeY * cameraX;
      var hit = castRay(rayDirX, rayDirY);
      var dist = Math.max(0.045, hit.dist);
      var wallHeight = Math.floor(h / dist);
      var drawStart = Math.max(0, Math.floor(horizon - wallHeight * 0.5));
      var drawEnd = Math.min(h, Math.floor(horizon + wallHeight * 0.5));
      var palette = wallPalettes[wallType(hit.mapX, hit.mapY)];
      var sideLight = hit.side === 0 ? (hit.stepX > 0 ? 1.05 : 0.86) : (hit.stepY > 0 ? 0.74 : 0.62);
      var distShade = 1 / (1 + dist * dist * 0.036);
      var edge = hit.wallX < 0.035 || hit.wallX > 0.965;
      var verticalBand = ((Math.floor(hit.wallX * 9) + hit.mapX + hit.mapY) & 1) ? 0.92 : 1.08;
      var surfaceNoise = 0.9 + hash2(Math.floor(hit.wallX * 19) + hit.mapX * 7, hit.mapY * 11) * 0.19;
      var pulse = 1 + Math.sin(animatedLight + hit.mapX * 0.7 + hit.mapY * 0.3) * 0.025;
      var shade = (0.28 + distShade * 1.25) * sideLight * verticalBand * surfaceNoise * pulse;

      if (edge) {
        shade *= 0.46;
      }

      var fog = clamp((dist - 4.5) / 15, 0, 0.86);
      var rgb = tint(palette, shade, fogColor, fog);

      ctx.fillStyle = colorString(rgb);
      ctx.fillRect(x, drawStart, columnStep, Math.max(1, drawEnd - drawStart));

      var capShade = tint(rgb, 0.58, fogColor, fog * 0.4);
      ctx.fillStyle = colorString(capShade);
      ctx.fillRect(x, drawStart, columnStep, Math.max(1, Math.ceil(columnStep * 0.8)));
      ctx.fillRect(x, drawEnd - Math.max(1, Math.ceil(columnStep * 0.8)), columnStep, Math.max(1, Math.ceil(columnStep * 0.8)));

      if (((x / columnStep) | 0) % 7 === 0) {
        ctx.fillStyle = colorString(tint(rgb, 0.72, fogColor, fog));
        ctx.fillRect(x, drawStart, columnStep, Math.max(1, drawEnd - drawStart));
      }
    }
  }

  function castRay(rayDirX, rayDirY) {
    var mapX = Math.floor(player.x);
    var mapY = Math.floor(player.y);
    var deltaDistX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
    var deltaDistY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);
    var sideDistX;
    var sideDistY;
    var stepX;
    var stepY;
    var side = 0;
    var guard = 0;

    if (rayDirX < 0) {
      stepX = -1;
      sideDistX = (player.x - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1 - player.x) * deltaDistX;
    }

    if (rayDirY < 0) {
      stepY = -1;
      sideDistY = (player.y - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1 - player.y) * deltaDistY;
    }

    while (guard < 96) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }

      if (cellAt(mapX, mapY) > 0) {
        break;
      }
      guard += 1;
    }

    // DDA gives a distance projected on the camera plane, so columns do not fish-eye.
    var perpWallDist = side === 0 ?
      (mapX - player.x + (1 - stepX) * 0.5) / rayDirX :
      (mapY - player.y + (1 - stepY) * 0.5) / rayDirY;

    var wallX = side === 0 ? player.y + perpWallDist * rayDirY : player.x + perpWallDist * rayDirX;
    wallX -= Math.floor(wallX);

    return {
      dist: perpWallDist,
      wallX: wallX,
      mapX: mapX,
      mapY: mapY,
      side: side,
      stepX: stepX,
      stepY: stepY
    };
  }

  function drawAtmosphere(w, h, horizon) {
    var glow = ctx.createLinearGradient(0, 0, 0, h);
    glow.addColorStop(0, "rgba(116, 147, 173, 0.10)");
    glow.addColorStop(0.47, "rgba(230, 200, 126, 0.025)");
    glow.addColorStop(0.53, "rgba(255, 206, 123, 0.040)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0.28)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "rgba(244, 207, 129, 0.08)";
    ctx.fillRect(0, horizon - 1, w, 1);

    ctx.fillStyle = "rgba(0, 0, 0, 0.055)";
    for (var y = 2; y < h; y += 4) {
      ctx.fillRect(0, y, w, 1);
    }
  }

  function drawMinimap(w, h, dirX, dirY) {
    var size = Math.round(clamp(Math.min(w, h) * 0.26, 108, 218));
    var pad = Math.round(size * 0.055);
    var x0 = Math.round(clamp(w * 0.024, 10, 24));
    var y0 = x0;
    var inner = size - pad * 2;
    var cell = inner / MAP_W;

    ctx.save();
    ctx.globalAlpha = 0.96;
    ctx.fillStyle = "rgba(4, 6, 8, 0.68)";
    ctx.fillRect(x0, y0, size, size);
    ctx.strokeStyle = "rgba(232, 215, 160, 0.34)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);

    for (var y = 0; y < MAP_H; y += 1) {
      for (var x = 0; x < MAP_W; x += 1) {
        if (cellAt(x, y) > 0) {
          var p = wallPalettes[wallType(x, y)];
          ctx.fillStyle = "rgba(" + Math.round(p[0] * 0.7) + "," + Math.round(p[1] * 0.7) + "," + Math.round(p[2] * 0.7) + ",0.78)";
        } else {
          ctx.fillStyle = ((x + y) & 1) ? "rgba(215, 206, 162, 0.075)" : "rgba(118, 129, 119, 0.055)";
        }
        ctx.fillRect(x0 + pad + x * cell, y0 + pad + y * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }

    var px = x0 + pad + player.x * cell;
    var py = y0 + pad + player.y * cell;
    var radius = inner * 0.45;
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (var i = 0; i <= 24; i += 1) {
      var a = player.angle - FOV * 0.5 + FOV * (i / 24);
      ctx.lineTo(px + Math.cos(a) * radius, py + Math.sin(a) * radius);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(242, 203, 111, 0.18)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 230, 151, 0.32)";
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 246, 183, 0.92)";
    ctx.lineWidth = Math.max(1, size * 0.011);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dirX * inner * 0.18, py + dirY * inner * 0.18);
    ctx.stroke();

    ctx.fillStyle = "#f6df91";
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2.5, size * 0.024), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function makeMaze(w, h) {
    var grid = new Uint8Array(w * h);
    for (var i = 0; i < grid.length; i += 1) {
      grid[i] = 1;
    }

    var stack = [{ x: 1, y: 1 }];
    grid[1 * w + 1] = 0;

    while (stack.length) {
      var current = stack[stack.length - 1];
      var next = randomUnvisitedNeighbor(grid, w, h, current.x, current.y);
      if (!next) {
        stack.pop();
        continue;
      }
      grid[(current.y + next.dy / 2) * w + current.x + next.dx / 2] = 0;
      grid[(current.y + next.dy) * w + current.x + next.dx] = 0;
      stack.push({ x: current.x + next.dx, y: current.y + next.dy });
    }

    addLoops(grid, w, h, Math.floor(w * h * 0.055));
    openStartArea(grid, w);
    return grid;
  }

  function randomUnvisitedNeighbor(grid, w, h, x, y) {
    var candidates = [];
    var dirs = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2]
    ];

    for (var i = 0; i < dirs.length; i += 1) {
      var nx = x + dirs[i][0];
      var ny = y + dirs[i][1];
      if (nx > 0 && nx < w - 1 && ny > 0 && ny < h - 1 && grid[ny * w + nx] === 1) {
        candidates.push({ dx: dirs[i][0], dy: dirs[i][1] });
      }
    }

    if (!candidates.length) {
      return null;
    }
    return candidates[(rand() * candidates.length) | 0];
  }

  function addLoops(grid, w, h, count) {
    var opened = 0;
    var attempts = 0;
    while (opened < count && attempts < count * 18) {
      attempts += 1;
      var x = 1 + ((rand() * (w - 2)) | 0);
      var y = 1 + ((rand() * (h - 2)) | 0);
      if (grid[y * w + x] === 0) {
        continue;
      }

      var horizontal = grid[y * w + x - 1] === 0 && grid[y * w + x + 1] === 0;
      var vertical = grid[(y - 1) * w + x] === 0 && grid[(y + 1) * w + x] === 0;
      if (horizontal !== vertical) {
        grid[y * w + x] = 0;
        opened += 1;
      }
    }
  }

  function openStartArea(grid, w) {
    grid[1 * w + 1] = 0;
    grid[1 * w + 2] = 0;
    grid[2 * w + 1] = 0;
  }

  function placePlayer() {
    player.x = 1.5;
    player.y = 1.5;
    var dirs = [
      [1, 0, 0],
      [0, 1, Math.PI / 2],
      [-1, 0, Math.PI],
      [0, -1, -Math.PI / 2]
    ];

    for (var i = 0; i < dirs.length; i += 1) {
      if (cellAt(1 + dirs[i][0], 1 + dirs[i][1]) === 0) {
        player.angle = dirs[i][2];
        return;
      }
    }
    player.angle = 0;
  }

  function cellAt(x, y) {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) {
      return 1;
    }
    return maze[y * MAP_W + x];
  }

  function isWall(x, y) {
    return cellAt(Math.floor(x), Math.floor(y)) > 0;
  }

  function wallType(x, y) {
    var value = (x * 73856093) ^ (y * 19349663) ^ seed;
    value ^= value >>> 13;
    return Math.abs(value) % wallPalettes.length;
  }

  function tint(rgb, amount, fog, fogAmount) {
    var r = clamp(rgb[0] * amount, 0, 255);
    var g = clamp(rgb[1] * amount, 0, 255);
    var b = clamp(rgb[2] * amount, 0, 255);
    var f = clamp(fogAmount, 0, 1);

    return [
      Math.round(r + (fog[0] - r) * f),
      Math.round(g + (fog[1] - g) * f),
      Math.round(b + (fog[2] - b) * f)
    ];
  }

  function colorString(rgb) {
    return "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function hash2(x, y) {
    var n = (x * 374761393 + y * 668265263) ^ (seed * 2246822519);
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function mulberry32(a) {
    return function () {
      var t = a += 0x6d2b79f5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
})();
