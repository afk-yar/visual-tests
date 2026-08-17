/* 3D-тело (софт-рендер) — Kimi K3
 * Полностью ручной конвейер: матрицы поворота, перспективная проекция,
 * backface culling, сортировка граней по глубине (painter's algorithm),
 * точечный источник света, плоское и гладкое (Гуро) затенение.
 * Без WebGL и библиотек, 2D-canvas. */
"use strict";

(function () {
  var canvas = document.getElementById("view");
  var ctx = canvas.getContext("2d");

  var DPR_CAP = 2;
  var dpr = 1;
  var viewW = 0, viewH = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  /* ---------- Геометрия: тор ---------- */
  var MAJOR = 56;   // сегментов по большой окружности
  var MINOR = 28;   // сегментов по малой
  var R = 1.0;      // большой радиус
  var r = 0.42;     // малый радиус

  var verts = [];   // {x,y,z, nx,ny,nz}
  var faces = [];   // [a,b,c,d] индексы вершин (квады)

  (function buildTorus() {
    var i, j, u, v, cu, su, cv, sv, x, y, z, nx, ny, nz;
    for (i = 0; i < MAJOR; i++) {
      u = (i / MAJOR) * Math.PI * 2;
      cu = Math.cos(u); su = Math.sin(u);
      for (j = 0; j < MINOR; j++) {
        v = (j / MINOR) * Math.PI * 2;
        cv = Math.cos(v); sv = Math.sin(v);
        x = (R + r * cv) * cu;
        y = (R + r * cv) * su;
        z = r * sv;
        nx = cv * cu;
        ny = cv * su;
        nz = sv;
        verts.push({ x: x, y: y, z: z, nx: nx, ny: ny, nz: nz });
      }
    }
    for (i = 0; i < MAJOR; i++) {
      var ni = (i + 1) % MAJOR;
      for (j = 0; j < MINOR; j++) {
        var nj = (j + 1) % MINOR;
        faces.push([
          i * MINOR + j,
          ni * MINOR + j,
          ni * MINOR + nj,
          i * MINOR + nj
        ]);
      }
    }
  })();

  /* ---------- Состояние ---------- */
  var state = {
    mode: "fill",      // fill | wire
    shading: "flat",   // flat | smooth
    angleX: 0.5,
    angleY: 0.0,
    speedX: 0.22,      // рад/с
    speedY: 0.35
  };

  // Точечный источник света (в мировых координатах, слегка качается)
  var light = { x: 3.0, y: 2.2, z: 3.5 };
  var lightPhase = 0;

  var AMBIENT = 0.16;
  var baseColor = { r: 92, g: 148, b: 255 };

  /* ---------- Матрицы ---------- */
  function rotationMatrix(ax, ay) {
    // M = Ry(ay) * Rx(ax)
    var cx = Math.cos(ax), sx = Math.sin(ax);
    var cy = Math.cos(ay), sy = Math.sin(ay);
    return [
      cy,        0,   sy,
      sx * sy,   cx, -sx * cy,
      -cx * sy,  sx,  cx * cy
    ];
  }

  function applyMat(m, x, y, z) {
    return {
      x: m[0] * x + m[1] * y + m[2] * z,
      y: m[3] * x + m[4] * y + m[5] * z,
      z: m[6] * x + m[7] * y + m[8] * z
    };
  }

  /* ---------- Буферы трансформированных вершин ---------- */
  var NV = verts.length;
  var tx = new Float64Array(NV);   // x в пространстве камеры
  var ty = new Float64Array(NV);
  var tz = new Float64Array(NV);
  var tnx = new Float64Array(NV);  // нормаль в пространстве камеры
  var tny = new Float64Array(NV);
  var tnz = new Float64Array(NV);
  var sx2 = new Float64Array(NV);  // экранные координаты
  var sy2 = new Float64Array(NV);
  var vint = new Float64Array(NV); // интенсивность для Гуро

  var CAM_DIST = 3.6;   // камера на z = CAM_DIST, смотрит на начало координат
  var FOCAL = 1.9;      // фокусное расстояние (в единицах min(viewW,viewH)/2)

  // Сортировка граней: переиспользуемый массив индексов
  var faceOrder = [];
  var faceDepth = new Float64Array(faces.length);
  (function () {
    for (var i = 0; i < faces.length; i++) faceOrder.push(i);
  })();

  /* ---------- Освещение ---------- */
  function lightIntensity(px, py, pz, nx, ny, nz) {
    // направление от точки к источнику (в пространстве камеры)
    var lx = light.x - px, ly = light.y - py, lz = light.z - pz;
    var len = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    lx /= len; ly /= len; lz /= len;
    var d = nx * lx + ny * ly + nz * lz;
    if (d < 0) d = 0;
    // лёгкое затухание с расстоянием
    var att = 1 / (1 + 0.08 * len * len);
    return AMBIENT + (1 - AMBIENT) * d * Math.min(1, att * 1.6);
  }

  function shadeColor(intensity) {
    var rr = baseColor.r * intensity;
    var gg = baseColor.g * intensity;
    var bb = baseColor.b * intensity;
    // лёгкий тёплый блик при высокой интенсивности
    if (intensity > 0.85) {
      var t = (intensity - 0.85) / 0.15;
      rr += (255 - rr) * t * 0.35;
      gg += (255 - gg) * t * 0.35;
      bb += (255 - bb) * t * 0.2;
    }
    return "rgb(" + (rr | 0) + "," + (gg | 0) + "," + (bb | 0) + ")";
  }

  /* ---------- Кадр ---------- */
  function render(dt) {
    state.angleX += state.speedX * dt;
    state.angleY += state.speedY * dt;
    lightPhase += dt * 0.4;
    light.x = 3.0 * Math.cos(lightPhase * 0.6);
    light.y = 2.2 + 0.8 * Math.sin(lightPhase * 0.4);
    light.z = 3.5;

    var m = rotationMatrix(state.angleX, state.angleY);
    var cx = viewW / 2, cy = viewH / 2;
    var scale = FOCAL * Math.min(viewW, viewH) / 2;
    var smooth = state.shading === "smooth";

    // Трансформация + проекция всех вершин
    var i, p, n, cz, f, vv;
    for (i = 0; i < NV; i++) {
      vv = verts[i];
      p = applyMat(m, vv.x, vv.y, vv.z);
      n = applyMat(m, vv.nx, vv.ny, vv.nz);
      cz = p.z + CAM_DIST;                 // камера смещена по +z
      tx[i] = p.x; ty[i] = p.y; tz[i] = cz;
      tnx[i] = n.x; tny[i] = n.y; tnz[i] = n.z;
      f = scale / cz;                       // перспективная проекция
      sx2[i] = cx + p.x * f;
      sy2[i] = cy - p.y * f;
      if (smooth) {
        vint[i] = lightIntensity(p.x, p.y, cz, n.x, n.y, n.z);
      }
    }

    // Фон
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, 0, viewW, viewH);

    // Backface culling + глубина граней
    var fi, face, a, b, c, d, e1x, e1y, e2x, e2y, nzf;
    var visCount = 0;
    var visList = render.visList || (render.visList = []);
    for (fi = 0; fi < faces.length; fi++) {
      face = faces[fi];
      a = face[0]; b = face[1]; c = face[2]; d = face[3];
      // нормаль грани в экранных координатах через знак площади
      // (после culling по z нормали — надёжнее через 2D cross)
      e1x = sx2[b] - sx2[a]; e1y = sy2[b] - sy2[a];
      e2x = sx2[d] - sx2[a]; e2y = sy2[d] - sy2[a];
      nzf = e1x * e2y - e1y * e2x;   // z-компонента cross
      if (nzf <= 0) continue;        // нелицевая грань — отсекаем
      faceDepth[fi] = (tz[a] + tz[b] + tz[c] + tz[d]) * 0.25;
      visList[visCount++] = fi;
    }

    // Сортировка по глубине: дальние рисуем первыми (painter's algorithm)
    visList.length = visCount;
    visList.sort(function (p1, p2) { return faceDepth[p2] - faceDepth[p1]; });

    var k, inten;
    if (state.mode === "fill") {
      for (k = 0; k < visCount; k++) {
        fi = visList[k];
        face = faces[fi];
        a = face[0]; b = face[1]; c = face[2]; d = face[3];
        if (smooth) {
          inten = (vint[a] + vint[b] + vint[c] + vint[d]) * 0.25;
        } else {
          // плоское: нормаль грани по двум рёбрам в пространстве камеры
          var ux = tx[b] - tx[a], uy = ty[b] - ty[a], uz = tz[b] - tz[a];
          var vx = tx[d] - tx[a], vy = ty[d] - ty[a], vz = tz[d] - tz[a];
          var fnx = uy * vz - uz * vy;
          var fny = uz * vx - ux * vz;
          var fnz = ux * vy - uy * vx;
          var fl = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz) || 1;
          fnx /= fl; fny /= fl; fnz /= fl;
          // нормаль должна смотреть к камере (culling уже это гарантирует по 2D,
          // но знак 3D-нормали может отличаться — выравниваем)
          if (fnz > 0) { fnx = -fnx; fny = -fny; fnz = -fnz; }
          var mxx = (tx[a] + tx[b] + tx[c] + tx[d]) * 0.25;
          var myy = (ty[a] + ty[b] + ty[c] + ty[d]) * 0.25;
          var mzz = (tz[a] + tz[b] + tz[c] + tz[d]) * 0.25;
          inten = lightIntensity(mxx, myy, mzz, fnx, fny, fnz);
        }
        ctx.fillStyle = shadeColor(inten);
        ctx.beginPath();
        ctx.moveTo(sx2[a], sy2[a]);
        ctx.lineTo(sx2[b], sy2[b]);
        ctx.lineTo(sx2[c], sy2[c]);
        ctx.lineTo(sx2[d], sy2[d]);
        ctx.closePath();
        ctx.fill();
        // тонкая обводка в цвет заливки убирает «швы» между гранями
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    } else {
      // Каркас: только лицевые грани, яркость по освещённости
      ctx.lineWidth = 1;
      for (k = 0; k < visCount; k++) {
        fi = visList[k];
        face = faces[fi];
        a = face[0]; b = face[1]; c = face[2]; d = face[3];
        inten = smooth
          ? (vint[a] + vint[b] + vint[c] + vint[d]) * 0.25
          : 0.75;
        ctx.strokeStyle = shadeColor(Math.max(0.3, inten));
        ctx.beginPath();
        ctx.moveTo(sx2[a], sy2[a]);
        ctx.lineTo(sx2[b], sy2[b]);
        ctx.lineTo(sx2[c], sy2[c]);
        ctx.lineTo(sx2[d], sy2[d]);
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Индикатор источника света (проецируем лампу)
    var lc = light.z + CAM_DIST;
    if (lc > 0.5) {
      var lf = scale / lc;
      var lx2 = cx + light.x * lf;
      var ly2 = cy - light.y * lf;
      var grad = ctx.createRadialGradient(lx2, ly2, 0, lx2, ly2, 14);
      grad.addColorStop(0, "rgba(255,240,200,0.9)");
      grad.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(lx2, ly2, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------- Цикл ---------- */
  var last = performance.now();
  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;   // кламп большого dt (вкладка была скрыта)
    if (dt < 0) dt = 0;
    render(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- Управление ---------- */
  var btnFill = document.getElementById("btnFill");
  var btnWire = document.getElementById("btnWire");
  var btnFlat = document.getElementById("btnFlat");
  var btnSmooth = document.getElementById("btnSmooth");

  function setMode(mode) {
    state.mode = mode;
    btnFill.classList.toggle("active", mode === "fill");
    btnWire.classList.toggle("active", mode === "wire");
  }
  function setShading(sh) {
    state.shading = sh;
    btnFlat.classList.toggle("active", sh === "flat");
    btnSmooth.classList.toggle("active", sh === "smooth");
  }
  btnFill.addEventListener("click", function () { setMode("fill"); });
  btnWire.addEventListener("click", function () { setMode("wire"); });
  btnFlat.addEventListener("click", function () { setShading("flat"); });
  btnSmooth.addEventListener("click", function () { setShading("smooth"); });
})();
