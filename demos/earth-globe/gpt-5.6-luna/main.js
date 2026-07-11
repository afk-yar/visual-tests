(() => {
  'use strict';

  const canvas = document.getElementById('globeCanvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smoothstep = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  let width = 0, height = 0, dpr = 1;
  let sphere = { x: 0, y: 0, radius: 250, diameter: 500 };
  let sphereCanvas = document.createElement('canvas');
  let sphereCtx = sphereCanvas.getContext('2d');
  let spherePixels = null;
  let lastTime = performance.now(), elapsed = 0, fpsTimer = 0, fpsFrames = 0;
  let paused = false, draggingLight = false;
  let rotation = -0.55, lightAzimuth = 32 * DEG, lightElevation = 17 * DEG, spinRate = 0.18;
  const stars = [];
  const cities = [
    [-74,40.7,1.1],[-118.2,34,.75],[-87.6,41.9,.7],[-99.1,19.4,.65],
    [-3.7,40.4,.65],[2.35,48.9,1],[13.4,52.5,.8],[31.2,30,.7],
    [28.9,41,.75],[37.6,55.7,.75],[72.8,19.1,1],[77.6,12.9,.8],
    [116.4,39.9,1],[121.5,31.2,1],[139.7,35.7,1],[151.2,-33.9,.75],
    [18.4,-33.9,.55],[28,-26.2,.7],[-58.4,-34.6,.7],[-46.6,-23.5,.9]
  ];

  function hash(x, y, z) {
    let n = Math.sin(x * 127.1 + y * 311.7 + (z || 0) * 74.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function valueNoise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z || 0);
    const fx = x - ix, fy = y - iy, fz = (z || 0) - iz;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    const n000 = hash(ix,iy,iz), n100 = hash(ix+1,iy,iz), n010 = hash(ix,iy+1,iz), n110 = hash(ix+1,iy+1,iz);
    const n001 = hash(ix,iy,iz+1), n101 = hash(ix+1,iy,iz+1), n011 = hash(ix,iy+1,iz+1), n111 = hash(ix+1,iy+1,iz+1);
    const x00 = lerp(n000,n100,ux), x10 = lerp(n010,n110,ux), x01 = lerp(n001,n101,ux), x11 = lerp(n011,n111,ux);
    return lerp(lerp(x00,x10,uy), lerp(x01,x11,uy), uz);
  }

  function fbm(x, y, z) {
    let total = 0, amplitude = .5, frequency = 1;
    for (let i = 0; i < 4; i++) {
      total += valueNoise(x * frequency, y * frequency, (z || 0) * frequency) * amplitude;
      frequency *= 2.03;
      amplitude *= .5;
    }
    return total;
  }

  function angularDistance(lon, lat, lon2, lat2) {
    const dLon = (lon - lon2) * DEG;
    const a = Math.sin((lat-lat2)*DEG/2) ** 2 + Math.cos(lat*DEG) * Math.cos(lat2*DEG) * Math.sin(dLon/2) ** 2;
    return 2 * Math.asin(Math.sqrt(Math.min(1, a)));
  }

  function blob(lon, lat, centerLon, centerLat, widthLon, widthLat) {
    const dx = Math.atan2(Math.sin((lon-centerLon)*DEG), Math.cos((lon-centerLon)*DEG)) / DEG;
    const dy = lat - centerLat;
    return Math.exp(-((dx/widthLon) ** 2 + (dy/widthLat) ** 2) * 1.35);
  }

  function landShape(lon, lat) {
    let land = 0;
    land = Math.max(land,
      blob(lon,lat,-105,47,36,21), blob(lon,lat,-88,27,25,15), blob(lon,lat,-76,9,10,19),
      blob(lon,lat,-60,-17,25,29), blob(lon,lat,-72,-42,10,24), blob(lon,lat,20,53,25,14),
      blob(lon,lat,73,50,62,25), blob(lon,lat,105,23,40,22), blob(lon,lat,143,40,19,21),
      blob(lon,lat,22,7,23,35), blob(lon,lat,28,-23,24,28), blob(lon,lat,136,-26,17,11),
      blob(lon,lat,47,26,12,7), blob(lon,lat,-42,73,14,9)
    );
    const cuts = Math.max(
      blob(lon,lat,-92,34,16,8) * .38, blob(lon,lat,48,47,27,8) * .44,
      blob(lon,lat,110,8,21,8) * .38, blob(lon,lat,30,33,14,9) * .58,
      blob(lon,lat,-58,10,12,8) * .34
    );
    const coastNoise = fbm(lon/19+7,lat/17-2,.3) * .27 + fbm(lon/7-3,lat/8+5,.7) * .1;
    const edge = .43 + coastNoise - cuts;
    const polarFade = lat < -63 ? smoothstep(-76,-61,lat) : 1;
    return smoothstep(edge-.055, edge+.055, land) * polarFade;
  }

  function cityGlow(lon, lat, land) {
    if (land < .25) return 0;
    let glow = 0;
    for (const city of cities) {
      const distance = angularDistance(lon,lat,city[0],city[1]);
      glow = Math.max(glow, Math.exp(-distance*distance/.004) * city[2]);
    }
    const grid = fbm(lon*.095+4,lat*.13-7,1.8);
    return Math.max(glow, smoothstep(.66,.78,grid)*.66) * land;
  }

  function buildStars() {
    stars.length = 0;
    for (let i = 0; i < 260; i++) {
      const angle = hash(i,2) * TAU, distance = Math.pow(hash(i,8),.55);
      stars.push({ x:Math.cos(angle)*distance, y:Math.sin(angle)*distance*.68, size:lerp(.35,1.65,hash(i,12)), alpha:lerp(.18,.8,hash(i,18)), warm:hash(i,27)>.79, phase:hash(i,35)*TAU });
    }
  }

  function resize() {
    width = window.innerWidth; height = window.innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(width*dpr)); canvas.height = Math.max(1, Math.floor(height*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const radius = Math.max(108, Math.min(width*.38,height*.41,430) * (width < 700 ? .83 : 1));
    const renderDpr = Math.min(dpr, 780 / (radius * 2));
    sphere = { x:width*.505, y:height*.505, radius:radius, diameter:Math.ceil(radius*2*renderDpr) };
    sphereCanvas.width = sphere.diameter; sphereCanvas.height = sphere.diameter;
    sphereCtx = sphereCanvas.getContext('2d'); sphereCtx.imageSmoothingEnabled = true;
    spherePixels = sphereCtx.createImageData(sphere.diameter,sphere.diameter);
    buildStars();
  }

  function getSunVector() {
    return { x:Math.cos(lightElevation)*Math.sin(lightAzimuth), y:Math.sin(lightElevation), z:Math.cos(lightElevation)*Math.cos(lightAzimuth) };
  }

  function renderSphere(time) {
    const size = sphere.diameter, data = spherePixels.data, sun = getSunVector();
    const sinTilt = Math.sin(23.5*DEG), cosTilt = Math.cos(23.5*DEG);
    const sinSpin = Math.sin(rotation), cosSpin = Math.cos(rotation);
    let index = 0;
    for (let py = 0; py < size; py++) {
      const sy = (py+.5)/size*2-1;
      for (let px = 0; px < size; px++) {
        const sx = (px+.5)/size*2-1, rr = sx*sx + sy*sy;
        if (rr > 1) { data[index++]=0; data[index++]=0; data[index++]=0; data[index++]=0; continue; }
        const sz = Math.sqrt(1-rr);
        const ty = sy*cosTilt - sz*sinTilt, tz = sy*sinTilt + sz*cosTilt;
        const ex = sx*cosSpin - tz*sinSpin, ez = sx*sinSpin + tz*cosSpin, ey = ty;
        const lat = Math.asin(clamp(ey,-1,1))/DEG, lon = Math.atan2(ex,ez)/DEG;
        const land = landShape(lon,lat), n1 = fbm(ex*2.2+8,ey*2.2-4,ez*2.2+5), n2 = fbm(ex*5.1-2,ey*5.1+3,ez*5.1+1);
        const water = clamp(.36+n1*.4+n2*.14,0,1);
        const dot = sx*sun.x + sy*sun.y + sz*sun.z;
        const day = smoothstep(-.16,.19,dot), twilight = smoothstep(-.24,.06,dot) * (1-smoothstep(.03,.3,dot));
        const cloudRaw = fbm(lon/24+time*.0036,lat/15+3,2)*.77 + fbm(lon/8+time*.007,lat/10-9,2.5)*.23;
        const clouds = smoothstep(.57,.72,cloudRaw)*.84, city = cityGlow(lon,lat,land) * (1-smoothstep(-.02,.3,dot));
        let r,g,b;
        if (land > .22) {
          const seasonal = clamp((lat+15)/95,0,1);
          r = lerp(24,79,n1) + seasonal*12; g = lerp(65,118,n1) + (1-seasonal)*10; b = lerp(53,62,n2);
          if (lat < -45 || lat > 65) { r+=27; g+=28; b+=18; }
          r*=lerp(.2,1.05,day); g*=lerp(.23,1.08,day); b*=lerp(.31,1.07,day);
        } else {
          r = lerp(5,10,water); g = lerp(20,71,water); b = lerp(43,123,water);
          r*=lerp(.28,1.04,day); g*=lerp(.34,1.05,day); b*=lerp(.45,1.1,day);
          const halfX=sun.x, halfY=sun.y, halfZ=sun.z+1, halfLen=Math.sqrt(halfX*halfX+halfY*halfY+halfZ*halfZ);
          const spec = Math.pow(Math.max(0,(sx*halfX+sy*halfY+sz*halfZ)/halfLen),70) * day * (1-land);
          r+=spec*220; g+=spec*178; b+=spec*115;
        }
        const nightBlue = (1-day)*.16;
        r += nightBlue*3; g += nightBlue*10; b += nightBlue*23;
        const cityFlicker = .72 + .28*Math.sin(time*.003 + lon*.9 + lat*.17);
        r += city*255*cityFlicker; g += city*140*cityFlicker; b += city*39*cityFlicker;
        const cloudLight = .35 + day*.65 + twilight*.25;
        r=lerp(r,205+day*35,clouds*.24*cloudLight); g=lerp(g,220+day*28,clouds*.24*cloudLight); b=lerp(b,231+day*24,clouds*.27*cloudLight);
        const edge = Math.pow(1-sz,2.9), sunRim=edge*(.55+day*.9)*(1+sun.z*.2);
        r+=sunRim*57; g+=sunRim*93; b+=sunRim*155; r+=twilight*31; g+=twilight*23; b+=twilight*8;
        data[index++]=clamp(r,0,255); data[index++]=clamp(g,0,255); data[index++]=clamp(b,0,255); data[index++]=255;
      }
    }
    sphereCtx.putImageData(spherePixels,0,0);
  }

  function drawBackground(time) {
    const bg = ctx.createRadialGradient(width*.52,height*.42,0,width*.52,height*.42,Math.max(width,height)*.8);
    bg.addColorStop(0,'#121a39'); bg.addColorStop(.34,'#080f29'); bg.addColorStop(1,'#02040e');
    ctx.fillStyle = bg; ctx.fillRect(0,0,width,height);
    const haze = ctx.createRadialGradient(width*.73,height*.18,0,width*.73,height*.18,width*.5);
    haze.addColorStop(0,'rgba(91,108,198,.08)'); haze.addColorStop(1,'rgba(20,25,69,0)');
    ctx.fillStyle = haze; ctx.fillRect(0,0,width,height);
    for (const star of stars) {
      const sx=width*(.5+star.x*.74), sy=height*(.47+star.y*.9), pulse=.77+Math.sin(time*.00065+star.phase)*.23;
      ctx.globalAlpha=star.alpha*pulse; ctx.fillStyle=star.warm?'#ffd4a8':'#d5dfff';
      ctx.beginPath(); ctx.arc(sx,sy,star.size,0,TAU); ctx.fill();
    }
    ctx.globalAlpha=1;
  }

  function drawSunAndGlow() {
    const sun = getSunVector(), sunScreenX=sphere.x+sun.x*sphere.radius*1.62, sunScreenY=sphere.y+sun.y*sphere.radius*1.62;
    const sunGlow = ctx.createRadialGradient(sunScreenX,sunScreenY,0,sunScreenX,sunScreenY,70);
    sunGlow.addColorStop(0,'rgba(255,220,165,.26)'); sunGlow.addColorStop(.15,'rgba(255,190,120,.09)'); sunGlow.addColorStop(1,'rgba(255,171,101,0)');
    ctx.fillStyle=sunGlow; ctx.beginPath(); ctx.arc(sunScreenX,sunScreenY,70,0,TAU); ctx.fill();
    ctx.fillStyle='rgba(255,218,169,.94)'; ctx.shadowColor='rgba(255,180,105,.8)'; ctx.shadowBlur=12;
    ctx.beginPath(); ctx.arc(sunScreenX,sunScreenY,2.2,0,TAU); ctx.fill(); ctx.shadowBlur=0;
    const rim=ctx.createRadialGradient(sphere.x,sphere.y,sphere.radius*.78,sphere.x,sphere.y,sphere.radius*1.18);
    rim.addColorStop(0,'rgba(65,143,255,0)'); rim.addColorStop(.78,'rgba(90,171,255,.04)'); rim.addColorStop(.92,'rgba(113,190,255,.25)'); rim.addColorStop(1,'rgba(88,147,255,0)');
    ctx.fillStyle=rim; ctx.beginPath(); ctx.arc(sphere.x,sphere.y,sphere.radius*1.18,0,TAU); ctx.fill();
  }

  function drawSphere() {
    ctx.save(); ctx.globalCompositeOperation='screen';
    ctx.drawImage(sphereCanvas,sphere.x-sphere.radius,sphere.y-sphere.radius,sphere.radius*2,sphere.radius*2);
    ctx.globalCompositeOperation='source-over'; ctx.strokeStyle='rgba(153,201,255,.22)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(sphere.x,sphere.y,sphere.radius-.35,0,TAU); ctx.stroke(); ctx.restore();
  }

  function updateReadout() {
    const orbit = (rotation/TAU*360%360+360)%360, sunLabel=lightAzimuth/DEG;
    document.getElementById('orbitValue').textContent = orbit.toFixed(1).padStart(5,'0') + '°';
    document.getElementById('sunAngleLabel').textContent = (sunLabel>=0?'+':'') + Math.round(sunLabel) + '°';
    document.getElementById('speedLabel').textContent = spinRate.toFixed(2) + '×';
    document.getElementById('lightValue').textContent = (sunLabel>=0?'EAST':'WEST') + ' SIDE';
  }

  function render(now) {
    const dt=Math.min((now-lastTime)/1000,.05); lastTime=now; elapsed+=dt*1000;
    if (!paused) rotation += dt*spinRate*.38;
    drawBackground(elapsed); drawSunAndGlow(); renderSphere(elapsed); drawSphere();
    fpsFrames++; fpsTimer+=dt;
    if (fpsTimer>.5) {
      document.getElementById('frameRate').textContent = Math.round(fpsFrames/fpsTimer) + ' FPS';
      fpsTimer=0; fpsFrames=0; updateReadout();
    }
    requestAnimationFrame(render);
  }

  function setLightFromPointer(event) {
    const rect=canvas.getBoundingClientRect(), x=event.clientX-rect.left-sphere.x, y=event.clientY-rect.top-sphere.y;
    lightAzimuth=Math.atan2(x,sphere.radius*.93) || 0;
    lightElevation=Math.asin(clamp(-y/sphere.radius,-.85,.85));
    document.getElementById('sunAngle').value=Math.round(lightAzimuth/DEG); updateReadout();
  }

  document.getElementById('sunAngle').addEventListener('input', function(event) { lightAzimuth=Number(event.target.value)*DEG; updateReadout(); });
  document.getElementById('speed').addEventListener('input', function(event) { spinRate=Number(event.target.value)/100; updateReadout(); });
  document.getElementById('pauseButton').addEventListener('click', function() {
    paused=!paused; document.getElementById('pauseText').textContent=paused?'ПРОДОЛЖИТЬ':'ПАУЗА';
    document.getElementById('sceneStatus').textContent=paused?'СИМУЛЯЦИЯ НА ПАУЗЕ':'СИМУЛЯЦИЯ В ЭФИРЕ';
    document.querySelector('.pause-glyph').textContent=paused?'▶':'Ⅱ';
  });
  canvas.addEventListener('pointerdown', function(event) { draggingLight=true; canvas.setPointerCapture(event.pointerId); setLightFromPointer(event); });
  canvas.addEventListener('pointermove', function(event) { if (draggingLight) setLightFromPointer(event); });
  canvas.addEventListener('pointerup', function() { draggingLight=false; });
  canvas.addEventListener('pointercancel', function() { draggingLight=false; });
  window.addEventListener('resize', resize, { passive:true });

  resize(); updateReadout(); requestAnimationFrame(render);
})();