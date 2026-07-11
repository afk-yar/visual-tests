(() => {
  "use strict";

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const positionReadout = document.getElementById("positionReadout");
  const depthReadout = document.getElementById("depthReadout");
  const stateLabel = document.getElementById("stateLabel");
  const newMazeButton = document.getElementById("newMaze");
  const TAU = Math.PI * 2;
  const FOV = Math.PI / 3;
  const MOVE_SPEED = 2.65;
  const TURN_SPEED = 2.25;
  const PLAYER_RADIUS = 0.18;
  const MAX_DT = 0.05;
  const COLORS = { skyTop: "#071615", skyBottom: "#163b32", floorTop: "#142b28", floorBottom: "#030908", wall: [125, 193, 169], wallWarm: [158, 188, 135], mint: "#a5e6ca", amber: "#f0b66d" };

  let viewWidth = 0;
  let viewHeight = 0;
  let dpr = 1;
  let maze;
  const mazeSize = 25;
  let player;
  let goal;
  let lastTime = performance.now();
  let lastDepth = 0;
  const keys = Object.create(null);

  function randomize(list) {
    for (let i = list.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
  }

  function createMaze(size) {
    const grid = Array.from({ length: size }, () => Array(size).fill(1));
    const stack = [[1, 1]];
    grid[1][1] = 0;
    const directions = [[2, 0], [-2, 0], [0, 2], [0, -2]];
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const candidates = randomize(directions.slice()).filter(([dx, dy]) => { const nx = x + dx; const ny = y + dy; return nx > 0 && nx < size - 1 && ny > 0 && ny < size - 1 && grid[ny][nx] === 1; });
      if (!candidates.length) { stack.pop(); continue; }
      const [dx, dy] = candidates[0];
      grid[y + dy / 2][x + dx / 2] = 0;
      grid[y + dy][x + dx] = 0;
      stack.push([x + dx, y + dy]);
    }
    for (let y = 1; y < size - 1; y += 1) {
      for (let x = 1; x < size - 1; x += 1) {
        if (grid[y][x] !== 1 || Math.random() > 0.065) continue;
        const horizontal = grid[y][x - 1] === 0 && grid[y][x + 1] === 0;
        const vertical = grid[y - 1][x] === 0 && grid[y + 1][x] === 0;
        if (horizontal || vertical) grid[y][x] = 0;
      }
    }
    return grid;
  }

  function findFarthestPoint(grid, startX, startY) {
    const queue = [[startX, startY, 0]];
    const visited = new Set([`${startX},${startY}`]);
    let farthest = { x: startX, y: startY, distance: 0 };
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let index = 0; index < queue.length; index += 1) {
      const [x, y, distance] = queue[index];
      if (distance > farthest.distance) farthest = { x, y, distance };
      for (const [dx, dy] of steps) {
        const nx = x + dx; const ny = y + dy; const id = `${nx},${ny}`;
        if (grid[ny]?.[nx] === 0 && !visited.has(id)) { visited.add(id); queue.push([nx, ny, distance + 1]); }
      }
    }
    return farthest;
  }

  function initializeMaze() {
    maze = createMaze(mazeSize);
    const firstOpen = [[1, 0], [0, 1], [-1, 0], [0, -1]].find(([dx, dy]) => maze[1 + dy]?.[1 + dx] === 0) || [1, 0];
    const farthest = findFarthestPoint(maze, 1, 1);
    goal = { x: farthest.x + 0.5, y: farthest.y + 0.5 };
    player = { x: 1.5, y: 1.5, angle: Math.atan2(firstOpen[1], firstOpen[0]), bob: 0 };
    stateLabel.textContent = "СИСТЕМА ГОТОВА";
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewWidth = window.innerWidth; viewHeight = window.innerHeight;
    canvas.width = Math.floor(viewWidth * dpr); canvas.height = Math.floor(viewHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function isSolid(x, y) { return maze[Math.floor(y)]?.[Math.floor(x)] !== 0; }
  function canOccupy(x, y) { const r = PLAYER_RADIUS; return !isSolid(x - r, y - r) && !isSolid(x + r, y - r) && !isSolid(x - r, y + r) && !isSolid(x + r, y + r); }
  function movePlayer(dx, dy) { if (canOccupy(player.x + dx, player.y)) player.x += dx; if (canOccupy(player.x, player.y + dy)) player.y += dy; }

  function update(dt) {
    const forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const turning = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    player.angle = (player.angle + turning * TURN_SPEED * dt + TAU) % TAU;
    const length = Math.hypot(forward, strafe) || 1;
    const speed = MOVE_SPEED * dt / length;
    const cos = Math.cos(player.angle); const sin = Math.sin(player.angle);
    movePlayer((cos * forward - sin * strafe) * speed, (sin * forward + cos * strafe) * speed);
    const moving = forward !== 0 || strafe !== 0;
    player.bob += moving ? dt * 10 : dt * 3;
    const nearGoal = Math.hypot(player.x - goal.x, player.y - goal.y) < 0.7;
    stateLabel.textContent = nearGoal ? "ВЫХОД РЯДОМ" : moving ? "ТРАНЗИТ В СЕТКЕ" : "СИСТЕМА ГОТОВА";
  }

  function drawBackdrop() {
    const horizon = viewHeight * 0.49;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon); sky.addColorStop(0, COLORS.skyTop); sky.addColorStop(1, COLORS.skyBottom);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, viewWidth, horizon);
    const floor = ctx.createLinearGradient(0, horizon, 0, viewHeight); floor.addColorStop(0, COLORS.floorTop); floor.addColorStop(1, COLORS.floorBottom);
    ctx.fillStyle = floor; ctx.fillRect(0, horizon, viewWidth, viewHeight - horizon);
    ctx.strokeStyle = "rgba(165, 230, 202, .08)"; ctx.lineWidth = 1;
    for (let y = horizon + 26; y < viewHeight; y += Math.max(18, viewHeight / 26)) { ctx.beginPath(); ctx.moveTo(0, y + (y - horizon) * 0.012); ctx.lineTo(viewWidth, y + (y - horizon) * 0.012); ctx.stroke(); }
    const moonGlow = ctx.createRadialGradient(viewWidth * .73, viewHeight * .2, 5, viewWidth * .73, viewHeight * .2, viewHeight * .34);
    moonGlow.addColorStop(0, "rgba(145, 211, 180, .13)"); moonGlow.addColorStop(1, "rgba(145, 211, 180, 0)");
    ctx.fillStyle = moonGlow; ctx.fillRect(0, 0, viewWidth, horizon);
  }

  function castRay(rayAngle) {
    const rayDirX = Math.cos(rayAngle); const rayDirY = Math.sin(rayAngle);
    let mapX = Math.floor(player.x); let mapY = Math.floor(player.y);
    const deltaX = Math.abs(1 / (rayDirX || 0.000001)); const deltaY = Math.abs(1 / (rayDirY || 0.000001));
    const stepX = rayDirX < 0 ? -1 : 1; const stepY = rayDirY < 0 ? -1 : 1;
    let sideDistX = rayDirX < 0 ? (player.x - mapX) * deltaX : (mapX + 1 - player.x) * deltaX;
    let sideDistY = rayDirY < 0 ? (player.y - mapY) * deltaY : (mapY + 1 - player.y) * deltaY;
    let side = 0; let distance = 0; let hit = false;
    for (let step = 0; step < 80 && !hit; step += 1) {
      if (sideDistX < sideDistY) { sideDistX += deltaX; mapX += stepX; side = 0; distance = sideDistX - deltaX; }
      else { sideDistY += deltaY; mapY += stepY; side = 1; distance = sideDistY - deltaY; }
      hit = maze[mapY]?.[mapX] !== 0;
    }
    return { distance: Math.max(0.001, distance * Math.cos(rayAngle - player.angle)), side, mapX, mapY };
  }

  function wallColor(hit, perpendicular) {
    const distanceShade = Math.max(0.2, 1 - perpendicular / 15 * 0.78); const sideShade = hit.side ? 0.68 : 1; const warm = (hit.mapX + hit.mapY) % 7 === 0;
    const base = warm ? COLORS.wallWarm : COLORS.wall;
    return `rgb(${Math.floor(base[0] * distanceShade * sideShade)}, ${Math.floor(base[1] * distanceShade * sideShade)}, ${Math.floor(base[2] * distanceShade * sideShade)})`;
  }

  function drawWorld() {
    drawBackdrop();
    const horizon = viewHeight * 0.49 + Math.sin(player.bob) * 1.25;
    const rayCount = Math.max(240, Math.min(700, Math.floor(viewWidth * 0.6))); const columnWidth = viewWidth / rayCount; const projection = viewHeight * 0.9;
    lastDepth = 0;
    for (let ray = 0; ray < rayCount; ray += 1) {
      const rayAngle = player.angle - FOV / 2 + FOV * (ray + 0.5) / rayCount; const hit = castRay(rayAngle); const perpendicular = hit.distance;
      lastDepth = Math.max(lastDepth, perpendicular); const wallHeight = Math.min(viewHeight * 1.7, projection / perpendicular); const top = horizon - wallHeight / 2; const x = ray * columnWidth;
      ctx.fillStyle = wallColor(hit, perpendicular); ctx.fillRect(x, top, columnWidth + 1, wallHeight);
      ctx.fillStyle = "rgba(226, 255, 238, .05)"; ctx.fillRect(x, top, columnWidth + 1, Math.max(1, wallHeight * 0.018));
      ctx.fillStyle = "rgba(1, 11, 8, .12)"; ctx.fillRect(x, top + wallHeight * .94, columnWidth + 1, Math.max(1, wallHeight * .06));
    }
  }

  function drawGoalBeacon() {
    const dx = goal.x - player.x; const dy = goal.y - player.y; const distance = Math.hypot(dx, dy); let relative = Math.atan2(dy, dx) - player.angle;
    while (relative > Math.PI) relative -= TAU; while (relative < -Math.PI) relative += TAU;
    if (Math.abs(relative) > FOV * 0.58 || distance < 0.5) return;
    const screenX = viewWidth / 2 + Math.tan(relative) / Math.tan(FOV / 2) * viewWidth / 2; const size = Math.max(4, Math.min(32, 25 / distance));
    ctx.save(); ctx.translate(screenX, viewHeight * .49); ctx.globalAlpha = Math.max(.25, 1 - distance / 18); ctx.fillStyle = COLORS.amber; ctx.shadowColor = "rgba(240, 182, 109, .85)"; ctx.shadowBlur = size * 2;
    ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * .62, 0); ctx.lineTo(0, size); ctx.lineTo(-size * .62, 0); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function drawMinimap() {
    const size = Math.max(138, Math.min(214, viewWidth * .19, viewHeight * .27)); const left = viewWidth - size - Math.max(24, viewWidth * .035); const top = Math.max(74, viewHeight * .055); const cell = size / mazeSize;
    ctx.save(); ctx.fillStyle = "rgba(3, 13, 11, .72)"; ctx.strokeStyle = "rgba(169, 228, 202, .22)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(left, top, size, size, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(156, 217, 190, .32)";
    for (let y = 0; y < mazeSize; y += 1) for (let x = 0; x < mazeSize; x += 1) if (maze[y][x] === 1) ctx.fillRect(left + x * cell, top + y * cell, Math.ceil(cell), Math.ceil(cell));
    const px = left + player.x * cell; const py = top + player.y * cell; const viewRadius = size * .72;
    ctx.fillStyle = "rgba(240, 182, 109, .12)"; ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, viewRadius, player.angle - FOV / 2, player.angle + FOV / 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(240, 182, 109, .48)"; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(player.angle - FOV / 2) * viewRadius, py + Math.sin(player.angle - FOV / 2) * viewRadius); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(player.angle + FOV / 2) * viewRadius, py + Math.sin(player.angle + FOV / 2) * viewRadius); ctx.stroke();
    ctx.fillStyle = COLORS.amber; ctx.shadowColor = COLORS.amber; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(left + goal.x * cell, top + goal.y * cell, Math.max(2, cell * .35), 0, TAU); ctx.fill();
    ctx.fillStyle = COLORS.mint; ctx.shadowColor = COLORS.mint; ctx.beginPath(); ctx.arc(px, py, Math.max(2.5, cell * .42), 0, TAU); ctx.fill(); ctx.restore();
    ctx.fillStyle = "rgba(219, 242, 230, .58)"; ctx.font = '600 10px "SFMono-Regular", Consolas, monospace'; ctx.fillText("MAP // SECTOR 07", left + 14, top + size + 19);
  }

  function drawVignette() {
    const vignette = ctx.createRadialGradient(viewWidth / 2, viewHeight / 2, viewHeight * .25, viewWidth / 2, viewHeight / 2, Math.max(viewWidth, viewHeight) * .7);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)"); vignette.addColorStop(1, "rgba(0, 0, 0, .48)"); ctx.fillStyle = vignette; ctx.fillRect(0, 0, viewWidth, viewHeight);
  }

  function updateReadouts() { positionReadout.textContent = `${player.x.toFixed(2).padStart(5, "0")} / ${player.y.toFixed(2).padStart(5, "0")}`; depthReadout.textContent = `${lastDepth.toFixed(1).padStart(4, "0")} m`; }
  function render() { drawWorld(); drawGoalBeacon(); drawMinimap(); drawVignette(); updateReadouts(); }
  function frame(now) { const dt = Math.min(MAX_DT, Math.max(0, (now - lastTime) / 1000)); lastTime = now; update(dt); render(); window.requestAnimationFrame(frame); }
  function onKey(event, pressed) { const supported = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowLeft", "ArrowRight"].includes(event.code); if (!supported) return; keys[event.code] = pressed; event.preventDefault(); }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("keydown", (event) => onKey(event, true));
  window.addEventListener("keyup", (event) => onKey(event, false));
  newMazeButton.addEventListener("click", initializeMaze);
  resize();
  initializeMaze();
  window.requestAnimationFrame(frame);
})();
