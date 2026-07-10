(function () {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const MAZE_W = 31;
  const MAZE_H = 31;
  const FOV = Math.PI / 3;
  const MAX_DEPTH = 28;
  const PLAYER_RADIUS = 0.2;
  const MOVE_SPEED = 2.75;
  const TURN_SPEED = 2.05;
  const keys = Object.create(null);

  let map = [];
  let seed = 0;
  let cssWidth = 1;
  let cssHeight = 1;
  let dpr = 1;
  let lastTime = performance.now();
  let fps = 60;

  const player = { x: 1.5, y: 1.5, angle: 0 };

  function mulberry32(value) {
    return function () {
      value |= 0;
      value = value + 0x6d2b79f5 | 0;
      let t = Math.imul(value ^ value >>> 15, 1 | value);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function generateMaze(newSeed) {
    seed = newSeed >>> 0;
    const random = mulberry32(seed);
    map = Array.from({ length: MAZE_H }, () => Array(MAZE_W).fill(1));
    const stack = [[1, 1]];
    map[1][1] = 0;

    while (stack.length) {
      const current = stack[stack.length - 1];
      const directions = [[2, 0], [-2, 0], [0, 2], [0, -2]];

      for (let i = directions.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const tmp = directions[i];
        directions[i] = directions[j];
        directions[j] = tmp;
      }

      let carved = false;
      for (const direction of directions) {
        const nx = current[0] + direction[0];
        const ny = current[1] + direction[1];
        if (nx <= 0 || nx >= MAZE_W - 1 || ny <= 0 || ny >= MAZE_H - 1 || map[ny][nx] === 0) {
          continue;
        }
        map[current[1] + direction[1] / 2][current[0] + direction[0] / 2] = 0;
        map[ny][nx] = 0;
        stack.push([nx, ny]);
        carved = true;
        break;
      }
      if (!carved) {
        stack.pop();
      }
    }

    for (let y = 2; y < MAZE_H - 2; y++) {
      for (let x = 2; x < MAZE_W - 2; x++) {
        if (map[y][x] === 1 && random() < 0.045) {
          const horizontal = map[y][x - 1] === 0 && map[y][x + 1] === 0;
          const vertical = map[y - 1][x] === 0 && map[y + 1][x] === 0;
          if (horizontal !== vertical) {
            map[y][x] = 0;
          }
        }
      }
    }

    const start = chooseStart(random);
    player.x = start.x + 0.5;
    player.y = start.y + 0.5;
    player.angle = chooseStartAngle(start.x, start.y);
  }

  function chooseStart(random) {
    const candidates = [];
    for (let y = 1; y < MAZE_H - 1; y += 2) {
      for (let x = 1; x < MAZE_W - 1; x += 2) {
        let openings = 0;
        openings += map[y][x + 1] === 0 ? 1 : 0;
        openings += map[y][x - 1] === 0 ? 1 : 0;
        openings += map[y + 1][x] === 0 ? 1 : 0;
        openings += map[y - 1][x] === 0 ? 1 : 0;
        if (openings >= 2) {
          candidates.push({ x, y });
        }
      }
    }
    return candidates[Math.floor(random() * candidates.length)] || { x: 1, y: 1 };
  }

  function chooseStartAngle(x, y) {
    const directions = [
      { dx: 1, dy: 0, angle: 0 },
      { dx: 0, dy: 1, angle: Math.PI / 2 },
      { dx: -1, dy: 0, angle: Math.PI },
      { dx: 0, dy: -1, angle: -Math.PI / 2 }
    ];
    let best = directions[0];
    let bestDistance = -1;

    for (const direction of directions) {
      let distance = 0;
      let cx = x;
      let cy = y;
      while (map[cy + direction.dy] && map[cy + direction.dy][cx + direction.dx] === 0) {
        cx += direction.dx;
        cy += direction.dy;
        distance++;
      }
      if (distance > bestDistance) {
        bestDistance = distance;
        best = direction;
      }
    }
    return best.angle;
  }

  function resize() {
    cssWidth = Math.max(1, window.innerWidth);
    cssHeight = Math.max(1, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(cssHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function isWall(x, y) {
    const mapX = Math.floor(x);
    const mapY = Math.floor(y);
    return mapY < 0 || mapY >= MAZE_H || mapX < 0 || mapX >= MAZE_W || map[mapY][mapX] !== 0;
  }

  function canStand(x, y) {
    const r = PLAYER_RADIUS;
    return !isWall(x - r, y - r) && !isWall(x + r, y - r) &&
      !isWall(x - r, y + r) && !isWall(x + r, y + r);
  }

  function movePlayer(dx, dy) {
    if (canStand(player.x + dx, player.y)) {
      player.x += dx;
    }
    if (canStand(player.x, player.y + dy)) {
      player.y += dy;
    }
  }

  function update(dt) {
    const turn = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    player.angle += turn * TURN_SPEED * dt;
    const forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const moveX = Math.cos(player.angle) * forward + Math.cos(player.angle + Math.PI / 2) * strafe;
    const moveY = Math.sin(player.angle) * forward + Math.sin(player.angle + Math.PI / 2) * strafe;
    const length = Math.hypot(moveX, moveY);
    if (length > 0) {
      const distance = MOVE_SPEED * dt / Math.max(1, length);
      movePlayer(moveX * distance, moveY * distance);
    }
  }

  function castRay(rayDirX, rayDirY) {
    let mapX = Math.floor(player.x);
    let mapY = Math.floor(player.y);
    const deltaDistX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
    const deltaDistY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);
    const stepX = rayDirX < 0 ? -1 : 1;
    const stepY = rayDirY < 0 ? -1 : 1;
    let sideDistX = rayDirX < 0 ? (player.x - mapX) * deltaDistX : (mapX + 1 - player.x) * deltaDistX;
    let sideDistY = rayDirY < 0 ? (player.y - mapY) * deltaDistY : (mapY + 1 - player.y) * deltaDistY;
    let side = 0;
    let distance = MAX_DEPTH;

    for (let steps = 0; steps < 96; steps++) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }
      if (mapY < 0 || mapY >= MAZE_H || mapX < 0 || mapX >= MAZE_W || map[mapY][mapX] !== 0) {
        distance = side === 0
          ? (mapX - player.x + (1 - stepX) / 2) / rayDirX
          : (mapY - player.y + (1 - stepY) / 2) / rayDirY;
        break;
      }
    }

    const wallXRaw = side === 0 ? player.y + distance * rayDirY : player.x + distance * rayDirX;
    const wallX = wallXRaw - Math.floor(wallXRaw);
    return { distance: Math.max(distance, 0.0001), side, wallX, mapX, mapY };
  }

  function roundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawWorld() {
    const horizon = cssHeight * 0.5;
    const ceiling = ctx.createLinearGradient(0, 0, 0, horizon);
    ceiling.addColorStop(0, "#070b14");
    ceiling.addColorStop(0.72, "#11192a");
    ceiling.addColorStop(1, "#1c2b3b");
    ctx.fillStyle = ceiling;
    ctx.fillRect(0, 0, cssWidth, horizon + 1);

    const floor = ctx.createLinearGradient(0, horizon, 0, cssHeight);
    floor.addColorStop(0, "#17202a");
    floor.addColorStop(0.28, "#0d1219");
    floor.addColorStop(1, "#040609");
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, cssWidth, cssHeight - horizon);
    ctx.fillStyle = "rgba(90, 176, 193, 0.055)";
    ctx.fillRect(0, horizon - 2, cssWidth, 4);

    const dirX = Math.cos(player.angle);
    const dirY = Math.sin(player.angle);
    const planeScale = Math.tan(FOV / 2);
    const planeX = -dirY * planeScale;
    const planeY = dirX * planeScale;

    for (let x = 0; x < cssWidth; x++) {
      const cameraX = 2 * (x + 0.5) / cssWidth - 1;
      const hit = castRay(dirX + planeX * cameraX, dirY + planeY * cameraX);
      const lineHeight = cssHeight / hit.distance;
      const drawStart = Math.max(0, horizon - lineHeight / 2);
      const drawEnd = Math.min(cssHeight, horizon + lineHeight / 2);
      const sideLight = hit.side === 0 ? 1 : 0.72;
      const fog = Math.max(0.12, 1 / (1 + hit.distance * 0.115 + hit.distance * hit.distance * 0.015));
      const panel = 0.9 + 0.1 * Math.cos(hit.wallX * Math.PI * 8);
      const cellTint = ((hit.mapX * 13 + hit.mapY * 7) & 3) * 3;
      const light = sideLight * fog * panel;
      const r = Math.round(36 * light + cellTint);
      const g = Math.round(185 * light + cellTint);
      const b = Math.round(194 * light + cellTint);
      ctx.fillStyle = "rgb(" + r + "," + g + "," + b + ")";
      ctx.fillRect(x, drawStart, 1.6, drawEnd - drawStart);
      if (lineHeight > 42 && (hit.wallX < 0.026 || hit.wallX > 0.974)) {
        ctx.fillStyle = "rgba(2,8,11," + Math.min(0.24, fog * 0.3) + ")";
        ctx.fillRect(x, drawStart, 1.6, drawEnd - drawStart);
      }
    }

    const vignette = ctx.createRadialGradient(
      cssWidth / 2, cssHeight / 2, Math.min(cssWidth, cssHeight) * 0.18,
      cssWidth / 2, cssHeight / 2, Math.max(cssWidth, cssHeight) * 0.72
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.68)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
  }

  function drawMiniMap() {
    const compact = cssWidth < 680 || cssHeight < 520;
    const mapSize = Math.min(compact ? 126 : 188, cssWidth * 0.3, cssHeight * 0.34);
    const padding = compact ? 12 : 20;
    const x = cssWidth - mapSize - padding;
    const y = padding;
    const cell = mapSize / MAZE_W;

    ctx.save();
    roundedRect(x - 9, y - 9, mapSize + 18, mapSize + 18, 15);
    ctx.fillStyle = "rgba(3, 8, 13, 0.79)";
    ctx.fill();
    ctx.strokeStyle = "rgba(129, 226, 230, 0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();
    roundedRect(x, y, mapSize, mapSize, 8);
    ctx.clip();
    ctx.fillStyle = "rgba(125, 219, 219, 0.055)";
    ctx.fillRect(x, y, mapSize, mapSize);
    ctx.fillStyle = "rgba(0, 4, 8, 0.72)";
    for (let my = 0; my < MAZE_H; my++) {
      for (let mx = 0; mx < MAZE_W; mx++) {
        if (map[my][mx]) {
          ctx.fillRect(x + mx * cell, y + my * cell, cell + 0.25, cell + 0.25);
        }
      }
    }

    const px = x + player.x * cell;
    const py = y + player.y * cell;
    const coneLength = Math.min(mapSize * 0.28, cell * 7.2);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(player.angle - FOV / 2) * coneLength, py + Math.sin(player.angle - FOV / 2) * coneLength);
    ctx.arc(px, py, coneLength, player.angle - FOV / 2, player.angle + FOV / 2);
    ctx.closePath();
    const cone = ctx.createRadialGradient(px, py, 0, px, py, coneLength);
    cone.addColorStop(0, "rgba(255, 221, 118, 0.34)");
    cone.addColorStop(1, "rgba(255, 221, 118, 0.025)");
    ctx.fillStyle = cone;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 229, 142, 0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(player.angle) * coneLength * 0.38, py + Math.sin(player.angle) * coneLength * 0.38);
    ctx.stroke();
    ctx.fillStyle = "#ffe27f";
    ctx.shadowColor = "rgba(255, 226, 127, 0.9)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(px, py, compact ? 2.5 : 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHud() {
    const compact = cssWidth < 680 || cssHeight < 520;
    const padding = compact ? 13 : 22;
    ctx.save();
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#e8fbfa";
    ctx.font = "700 " + (compact ? 15 : 20) + "px system-ui, sans-serif";
    ctx.fillText("SECTOR // MAZE", padding, padding);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(150, 219, 221, 0.75)";
    ctx.font = "600 " + (compact ? 9 : 11) + "px ui-monospace, Consolas, monospace";
    ctx.fillText("СИД " + seed.toString(16).toUpperCase().padStart(8, "0") + "  ·  " + Math.round(fps) + " FPS", padding, padding + (compact ? 23 : 31));

    const controls = compact
      ? ["W/S ХОД  ·  A/D СТРЕЙФ", "←/→ ПОВОРОТ  ·  R НОВЫЙ"]
      : ["W / S", "движение", "A / D", "стрейф", "← / →", "поворот", "R", "новый лабиринт"];

    if (compact) {
      ctx.font = "600 9px ui-monospace, Consolas, monospace";
      ctx.fillStyle = "rgba(213, 240, 238, 0.72)";
      ctx.fillText(controls[0], padding, cssHeight - 40);
      ctx.fillText(controls[1], padding, cssHeight - 24);
    } else {
      const panelWidth = 385;
      const panelHeight = 52;
      roundedRect(padding, cssHeight - panelHeight - padding, panelWidth, panelHeight, 14);
      ctx.fillStyle = "rgba(3, 8, 13, 0.68)";
      ctx.fill();
      ctx.strokeStyle = "rgba(129, 226, 230, 0.15)";
      ctx.stroke();
      let cursor = padding + 14;
      const top = cssHeight - padding - 33;
      for (let i = 0; i < controls.length; i += 2) {
        ctx.font = "700 11px ui-monospace, Consolas, monospace";
        ctx.fillStyle = "#dff9f7";
        ctx.fillText(controls[i], cursor, top);
        cursor += ctx.measureText(controls[i]).width + 7;
        ctx.font = "500 10px system-ui, sans-serif";
        ctx.fillStyle = "rgba(174, 207, 207, 0.65)";
        ctx.fillText(controls[i + 1], cursor, top + 1);
        cursor += ctx.measureText(controls[i + 1]).width + 18;
      }
    }
    ctx.restore();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWorld();
    drawMiniMap();
    drawHud();
  }

  function frame(now) {
    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(rawDt, 0.05);
    if (rawDt > 0) {
      fps += (1 / rawDt - fps) * Math.min(1, rawDt * 4);
    }
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function handleKey(event, pressed) {
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowLeft", "ArrowRight", "KeyR"].includes(event.code)) {
      event.preventDefault();
    }
    keys[event.code] = pressed;
    if (pressed && !event.repeat && event.code === "KeyR") {
      generateMaze((seed + 0x9e3779b9) >>> 0);
    }
  }

  window.addEventListener("keydown", event => handleKey(event, true));
  window.addEventListener("keyup", event => handleKey(event, false));
  window.addEventListener("blur", () => {
    for (const code of Object.keys(keys)) {
      keys[code] = false;
    }
  });
  window.addEventListener("resize", resize);

  resize();
  generateMaze((Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0);
  requestAnimationFrame(frame);
}());
