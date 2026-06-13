"use strict";
/*
  Вращающийся земной шар — 2D canvas, без библиотек, без WebGL.

  Конвейер на кадр:
    1) Звёздное небо (медленный параллакс + мерцание) — кэш-канвас.
    2) Внешнее атмосферное гало (радиальные градиенты) под диском.
    3) Per-pixel рендер сферы в ImageData низкого внутр. разрешения:
         обратная проекция экранного пикселя -> точка на сфере ->
         поворот по оси (наклон 23.5°) -> широта/долгота ->
         процедурная карта суши/океана/льдов + высоты ->
         диффуз по Ламберту, мягкий терминатор, ночные огни,
         зеркальный блик Солнца только по океану, Френель-атмосфера,
         анимированный слой облаков (свой шум + своя скорость).
    4) Апскейл буфера на диск с лёгким bloom (lighter overlay).
    5) Внутренний rim-glow + лимбовое потемнение по краю.

  Внутренний буфер масштабируется так, чтобы держать реалтайм на любом
  размере iframe (диаметр диска в буфере ограничен BUFFER_MAX).
*/

(function () {
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d", { alpha: false });

  // ---- управление ----
  const ui = {
    spin: document.getElementById("spin"),
    speed: document.getElementById("speed"),
    clouds: document.getElementById("clouds"),
    auto: document.getElementById("auto"),
    reset: document.getElementById("reset"),
  };

  const state = {
    spinning: true,
    spinSpeed: 1,
    cloudAmount: 0.85,
    autoLight: true,
    zoom: 0.82,          // доля min(W,H) под диаметр диска
    rotation: 0,         // долготный угол вращения планеты
    lightLon: 0.6,       // долгота подсолнечной точки (если авто-орбита)
    lightLat: 0.12,      // широта подсолнечной точки
    lightManual: false,  // пользователь тащил Солнце
    lightDir: { x: 0.6, y: 0.18, z: 0.78 }, // мир-вектор на Солнце
  };

  const AXIAL_TILT = 23.5 * Math.PI / 180;
  const sinTilt = Math.sin(AXIAL_TILT);
  const cosTilt = Math.cos(AXIAL_TILT);

  // ======================================================================
  //  ШУМ  (value-noise на хэше, детерминированный, без зависимостей)
  // ======================================================================
  function hash2(ix, iy) {
    let h = ix * 374761393 + iy * 668265263;
    h = (h ^ (h >> 13)) >>> 0;
    h = (h * 1274126177) >>> 0;
    return (h & 0xffffff) / 0x1000000; // [0,1)
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function valueNoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = smooth(fx), uy = smooth(fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    const top = a + (b - a) * ux;
    const bot = c + (d - c) * ux;
    return top + (bot - top) * uy;
  }
  function fbm(x, y, oct) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * valueNoise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.02;
    }
    return sum / norm;
  }

  // ======================================================================
  //  ПРОЦЕДУРНАЯ КАРТА ЗЕМЛИ  (по нормали на единичной сфере)
  //  Возвращает заполненную запись о точке поверхности.
  // ======================================================================
  // Чтобы шум на сфере не имел швов на полюсах/меридиане, сэмплим
  // его по 3D-координатам нормали (несколько проекций), а не по lat/lon.
  function continentField(nx, ny, nz) {
    // основной материк-сигнал: fbm по плоскостям XZ / XY / YZ от нормали,
    // плюс доменное искажение для «рваных» берегов.
    const s = 1.7;
    const wx = fbm((nx + 5.1) * s, (nz + 2.3) * s, 4);
    const wy = fbm((ny + 9.7) * s, (nx + 1.4) * s, 4);
    let qx = nx + (wx - 0.5) * 0.9;
    let qy = ny + (wy - 0.5) * 0.9;
    let qz = nz + (wx - 0.5) * 0.5;

    const f1 = fbm((qx + 3.0) * 1.25, (qz + 7.0) * 1.25, 6);
    const f2 = fbm((qy + 8.0) * 1.9, (qx + 4.0) * 1.9, 5);
    const f3 = fbm((qz + 2.0) * 3.7, (qy + 6.0) * 3.7, 4);

    // комбинируем в «высоту»
    let h = f1 * 0.62 + f2 * 0.26 + f3 * 0.12;
    // сместим уровень моря — больше океана (как на Земле ~70%)
    return { h: h, fine: f3, warp: f2 };
  }

  // Цвет поверхности (без освещения) и признак «океан».
  // lat в радианах (для климата: пустыни/тайга/льды).
  // Возвращает r,g,b (0..1), ocean(0..1 — доля океана/мягкий берег),
  // depth (для блика и цвета воды), elev (рельеф), snow.
  function surfaceSample(nx, ny, nz, lat) {
    const fld = continentField(nx, ny, nz);
    const seaLevel = 0.5;
    let land = (fld.h - seaLevel) / 0.5; // <0 океан, >0 суша
    // мягкая береговая линия
    const coast = clamp(land * 6 + 0.5, 0, 1); // 0 океан … 1 суша
    const absLat = Math.abs(lat);

    // ---- океан ----
    const depth = clamp(-land * 2.2, 0, 1); // 0 мелко … 1 глубоко
    const shallow = [0.10, 0.42, 0.58];
    const deep = [0.012, 0.07, 0.20];
    const oceanR = lerp(shallow[0], deep[0], depth);
    const oceanG = lerp(shallow[1], deep[1], depth);
    const oceanB = lerp(shallow[2], deep[2], depth);

    // ---- суша: климат по широте + рельеф ----
    const elev = clamp(land, 0, 1);            // высота суши 0..1
    const mtn = clamp((land - 0.42) * 2.6, 0, 1); // горы
    const dryNoise = fbm((nx + 21) * 2.2, (nz + 13) * 2.2, 4);

    // базовые биомы
    const desert = [0.74, 0.62, 0.36];
    const savanna = [0.55, 0.55, 0.27];
    const forest = [0.16, 0.42, 0.17];
    const taiga = [0.20, 0.36, 0.22];
    const rock = [0.42, 0.38, 0.33];
    const snow = [0.92, 0.95, 0.99];

    // широтные пояса: 0 экватор … 1 полюс
    const t = absLat / (Math.PI / 2);
    // пустынные пояса около ~25°
    const desertBelt = Math.exp(-Math.pow((t - 0.28) / 0.13, 2));
    const tropic = Math.exp(-Math.pow(t / 0.22, 2));
    const temperate = Math.exp(-Math.pow((t - 0.5) / 0.22, 2));
    const boreal = Math.exp(-Math.pow((t - 0.72) / 0.16, 2));

    let lr = 0, lg = 0, lb = 0, wsum = 0;
    function mix(c, w) { lr += c[0] * w; lg += c[1] * w; lb += c[2] * w; wsum += w; }
    mix(forest, tropic * (0.5 + 0.5 * (1 - dryNoise)));
    mix(savanna, tropic * (0.5 * dryNoise) + temperate * 0.25);
    mix(desert, desertBelt * (0.4 + 0.9 * dryNoise));
    mix(forest, temperate * 0.7);
    mix(taiga, boreal * 0.9);
    if (wsum < 0.0001) { mix(savanna, 1); }
    lr /= wsum; lg /= wsum; lb /= wsum;

    // горы -> скалистый/снежный по высоте
    lr = lerp(lr, rock[0], mtn * 0.7);
    lg = lerp(lg, rock[1], mtn * 0.7);
    lb = lerp(lb, rock[2], mtn * 0.7);

    // ---- снег/лёд: высокогорье + полярные шапки ----
    const snowLine = clamp((t - 0.80) / 0.12, 0, 1);       // ледяные шапки
    const altSnow = clamp((elev - 0.62) * 3 - (1 - t) * 0.4, 0, 1);
    let snowAmt = Math.max(snowLine, altSnow * 0.9);
    // морской лёд у полюсов
    const seaIce = clamp((t - 0.86) / 0.08, 0, 1);

    // лёгкая дробная текстура земли
    const tex = (fld.fine - 0.5) * 0.10;
    lr = clamp(lr + tex, 0, 1);
    lg = clamp(lg + tex, 0, 1);
    lb = clamp(lb + tex, 0, 1);

    // финальный микс океан/суша
    let r = lerp(oceanR, lr, coast);
    let g = lerp(oceanG, lg, coast);
    let b = lerp(oceanB, lb, coast);

    // снег поверх суши
    r = lerp(r, snow[0], coast * snowAmt);
    g = lerp(g, snow[1], coast * snowAmt);
    b = lerp(b, snow[2], coast * snowAmt);
    // морской лёд поверх океана
    r = lerp(r, snow[0], (1 - coast) * seaIce);
    g = lerp(g, snow[1], (1 - coast) * seaIce);
    b = lerp(b, snow[2], (1 - coast) * seaIce);

    const isOcean = (1 - coast) * (1 - seaIce); // насколько «вода под бликом»

    return {
      r, g, b,
      ocean: isOcean,
      depth,
      coast,
      elev,
      mtn,
      lat,
      dry: dryNoise,
    };
  }

  // Облака: отдельный анимированный шумовой слой на сфере.
  function cloudSample(nx, ny, nz, t) {
    const drift = t * 0.012;
    const a = fbm((nx + 1.3 + drift) * 2.3, (nz - 0.7) * 2.3, 5);
    const b = fbm((ny - 4.0) * 1.7, (nx + 2.1 - drift * 0.6) * 1.7, 4);
    let c = a * 0.65 + b * 0.35;
    // полосовая структура (циклоны/пассаты) по широте
    const lat = Math.asin(clamp(ny, -1, 1));
    const band = 0.5 + 0.5 * Math.sin(lat * 6.0 + (a - 0.5) * 4.0);
    c = c * (0.55 + 0.45 * band);
    // порог -> плотность облаков
    let dens = clamp((c - 0.52) / 0.34, 0, 1);
    dens = dens * dens * (3 - 2 * dens);
    return dens;
  }

  // Огни городов на ночной стороне: хэш-«посев» на суше умеренных широт.
  function cityLight(nx, ny, nz, surf) {
    if (surf.coast < 0.55) return 0;           // только суша
    if (surf.mtn > 0.55) return 0;             // не в горах
    const t = Math.abs(surf.lat) / (Math.PI / 2);
    if (t > 0.78) return 0;                    // не у полюсов
    // плотность населения: умеренные/субтропические широты, не пустыни
    const habit = (0.35 + temperateWeight(t)) * (0.5 + 0.5 * (1 - surf.dry));
    // ячейки-«агломерации»
    const scale = 26.0;
    const cx = nx * scale, cy = ny * scale, cz = nz * scale;
    const ix = Math.floor(cx + cz * 0.3);
    const iy = Math.floor(cy - cx * 0.2);
    const seed = hash2(ix, iy);
    const seed2 = hash2(ix * 7 + 11, iy * 13 + 5);
    let lights = 0;
    if (seed < habit * 0.5) {
      // в ячейке — сгусток огней, яркость по второму хэшу
      const fx = (cx + cz * 0.3) - Math.floor(cx + cz * 0.3) - 0.5;
      const fy = (cy - cx * 0.2) - Math.floor(cy - cx * 0.2) - 0.5;
      const d2 = fx * fx + fy * fy;
      lights = Math.exp(-d2 * 14) * (0.4 + 0.6 * seed2);
    }
    return clamp(lights * 1.5, 0, 1);
  }
  function temperateWeight(t) {
    const temperate = Math.exp(-Math.pow((t - 0.5) / 0.22, 2));
    const tropic = Math.exp(-Math.pow(t / 0.30, 2));
    return temperate * 0.8 + tropic * 0.5;
  }

  // ======================================================================
  //  ВСПОМОГАТЕЛЬНОЕ
  // ======================================================================
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ======================================================================
  //  ЗВЁЗДНОЕ НЕБО  (кэш-канвас, перерисовываем при ресайзе)
  // ======================================================================
  const starCanvas = document.createElement("canvas");
  const starCtx = starCanvas.getContext("2d");
  let stars = [];
  function buildStars(w, h) {
    starCanvas.width = w;
    starCanvas.height = h;
    stars = [];
    const count = Math.floor((w * h) / 2600);
    for (let i = 0; i < count; i++) {
      const bright = Math.pow(hash2(i * 3 + 1, i * 7 + 2), 2.2);
      stars.push({
        x: hash2(i, i * 13) * w,
        y: hash2(i * 17, i * 5) * h,
        r: 0.35 + bright * 1.7,
        a: 0.25 + bright * 0.75,
        tw: hash2(i * 31, i * 11) * 6.28,
        tws: 0.6 + hash2(i * 3, i * 29) * 2.2,
        hue: hash2(i * 23, i * 41), // 0 тёплый … 1 холодный
      });
    }
  }
  function drawStars(t) {
    const w = starCanvas.width, h = starCanvas.height;
    starCtx.clearRect(0, 0, w, h);
    // лёгкая туманность-градиент для глубины
    const neb = starCtx.createLinearGradient(0, 0, w, h);
    neb.addColorStop(0, "rgba(20,28,60,0.20)");
    neb.addColorStop(0.5, "rgba(8,10,26,0.0)");
    neb.addColorStop(1, "rgba(34,16,46,0.16)");
    starCtx.fillStyle = neb;
    starCtx.fillRect(0, 0, w, h);

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const tw = 0.6 + 0.4 * Math.sin(t * s.tws + s.tw);
      const a = s.a * tw;
      const warm = s.hue < 0.3;
      const cold = s.hue > 0.8;
      let col = "255,255,255";
      if (warm) col = "255,228,196";
      else if (cold) col = "200,220,255";
      starCtx.beginPath();
      starCtx.fillStyle = "rgba(" + col + "," + a.toFixed(3) + ")";
      starCtx.arc(s.x, s.y, s.r, 0, 6.2832);
      starCtx.fill();
      // glow для ярких
      if (s.r > 1.3) {
        starCtx.beginPath();
        starCtx.fillStyle = "rgba(" + col + "," + (a * 0.15).toFixed(3) + ")";
        starCtx.arc(s.x, s.y, s.r * 3.2, 0, 6.2832);
        starCtx.fill();
      }
    }
  }

  // ======================================================================
  //  РАЗМЕРЫ / БУФЕР
  // ======================================================================
  let W = 0, H = 0, DPR = 1;
  let cx = 0, cy = 0, radius = 0;

  const BUFFER_MAX = 480; // макс. диаметр диска во внутреннем буфере (px)
  let buf, bufImg, bufData, bufR = 0; // буфер сферы (квадрат 2*bufR)

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(2, Math.floor(window.innerWidth));
    H = Math.max(2, Math.floor(window.innerHeight));
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    cx = W / 2;
    cy = H / 2;
    radius = Math.min(W, H) * 0.5 * state.zoom;

    // внутренний буфер сферы
    bufR = Math.min(BUFFER_MAX, Math.floor(radius)) ;
    bufR = Math.max(120, bufR);
    const size = bufR * 2;
    buf = document.createElement("canvas");
    buf.width = size;
    buf.height = size;
    const bctx = buf.getContext("2d");
    bufImg = bctx.createImageData(size, size);
    bufData = bufImg.data;
    buf._ctx = bctx;

    buildStars(W, H);
  }

  // ======================================================================
  //  РЕНДЕР СФЕРЫ В БУФЕР
  // ======================================================================
  function renderSphere(t) {
    const size = bufR * 2;
    const data = bufData;
    const L = state.lightDir;

    // вращение планеты вокруг наклонённой оси:
    // ось наклонена в плоскости XY на AXIAL_TILT (наклон к «вертикали» экрана).
    const rot = state.rotation;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);

    const cloudAmt = state.cloudAmount;
    const invR = 1 / bufR;

    let p = 0;
    for (let py = 0; py < size; py++) {
      // экранная Y -> сфера (вверх = -Y экрана)
      const sy = (py + 0.5) * invR - 1; // [-1,1]
      const sy2 = sy * sy;
      for (let px = 0; px < size; px++, p += 4) {
        const sx = (px + 0.5) * invR - 1; // [-1,1]
        const r2 = sx * sx + sy2;
        if (r2 > 1.0) { data[p + 3] = 0; continue; }

        // точка на сфере в «видовых» координатах (камера смотрит вдоль +Z)
        const sz = Math.sqrt(1 - r2);
        // нормаль в видовом пространстве = (sx, -sy, sz) (Y вверх)
        let vx = sx, vy = -sy, vz = sz;

        // ---- наклон оси: повернём пространство на -tilt вокруг Z,
        //      затем вращение планеты вокруг Y, чтобы получить координаты
        //      в системе планеты (для широты/долготы и карты). ----
        // 1) убрать наклон (вокруг Z экрана)
        let ax = vx * cosTilt + vy * sinTilt;
        let ay = -vx * sinTilt + vy * cosTilt;
        let az = vz;
        // 2) собственное вращение вокруг полярной оси Y
        let nx = ax * cosR - az * sinR;
        let ny = ay;
        let nz = ax * sinR + az * cosR;

        // широта/долгота
        const lat = Math.asin(clamp(ny, -1, 1));

        // ---- поверхность ----
        const surf = surfaceSample(nx, ny, nz, lat);

        // ---- освещённость (Ламберт) по видовой нормали и свету ----
        let ndl = vx * L.x + vy * L.y + vz * L.z;
        // мягкий терминатор: расширим зону перехода
        const dayAmt = clamp((ndl + 0.12) / 0.42, 0, 1);
        const lit = smoothstep01(dayAmt);

        // базовый цвет с дневным светом
        // лёгкое усиление насыщенности на свету
        let cr = surf.r, cg = surf.g, cb = surf.b;

        // ---- облака (поверх поверхности, освещаются так же) ----
        let cloud = 0;
        if (cloudAmt > 0.001) {
          cloud = cloudSample(nx, ny, nz, t) * cloudAmt;
        }
        if (cloud > 0.001) {
          const cw = clamp(cloud, 0, 1);
          cr = lerp(cr, 0.97, cw);
          cg = lerp(cg, 0.98, cw);
          cb = lerp(cb, 1.0, cw);
          // облака немного прячут блик/огни (учтём ниже через ocean/cloud)
        }

        // дневная сторона: цвет * освещение, с тёплым закатным оттенком у терминатора
        const twilight = clamp(1 - Math.abs(ndl) / 0.30, 0, 1) * (ndl > -0.30 ? 1 : 0);
        // ambient, чтобы ночь не была абсолютно чёрной (тусклый отражённый свет)
        const ambient = 0.045;
        let day = lit;

        // освещённый цвет
        let outR = cr * (ambient + day * (1.0 + 0.18 * twilight));
        let outG = cg * (ambient + day * (1.0 + 0.05 * twilight));
        let outB = cb * (ambient + day * (1.0 - 0.05 * twilight));

        // закатное «золото» в зоне терминатора на свету
        if (twilight > 0.001 && day > 0.02) {
          const warm = twilight * day;
          outR += warm * 0.22;
          outG += warm * 0.10;
          outB += warm * 0.02;
        }

        // ---- зеркальный блик Солнца по океану (Блинн-Фонг) ----
        const waterVisible = surf.ocean * (1 - cloud);
        if (waterVisible > 0.02 && day > 0.05) {
          // half-vector между светом и взглядом (взгляд = +Z)
          let hx = L.x, hy = L.y, hz = L.z + 1;
          const hl = 1 / Math.sqrt(hx * hx + hy * hy + hz * hz);
          hx *= hl; hy *= hl; hz *= hl;
          let ndh = vx * hx + vy * hy + vz * hz;
          ndh = clamp(ndh, 0, 1);
          const spec = Math.pow(ndh, 64) * waterVisible * day;
          outR += spec * 1.6;
          outG += spec * 1.45;
          outB += spec * 1.1;
        }

        // ---- ночные огни городов ----
        const night = 1 - lit;
        if (night > 0.04) {
          const city = cityLight(nx, ny, nz, surf) * night * (1 - cloud * 0.85);
          if (city > 0.004) {
            outR += city * 1.25;
            outG += city * 0.95;
            outB += city * 0.55;
          }
        }

        // ---- лимбовое потемнение + внутренний Френель-голубой ободок ----
        const edge = r2; // 0 центр … 1 край
        const limb = 1 - 0.45 * edge * edge;
        outR *= limb; outG *= limb; outB *= limb;
        // тонкая голубая дымка атмосферы по диску (рассеяние), сильнее к краю и на свету
        const fres = Math.pow(edge, 2.2);
        const atmoLit = clamp(day + 0.15, 0, 1);
        outR += fres * 0.10 * atmoLit;
        outG += fres * 0.18 * atmoLit;
        outB += fres * 0.34 * atmoLit;

        // запись (с лёгким тонмаппингом, чтобы блики не выбивались)
        data[p]     = toByte(outR);
        data[p + 1] = toByte(outG);
        data[p + 2] = toByte(outB);
        data[p + 3] = 255;
      }
    }
    buf._ctx.putImageData(bufImg, 0, 0);
  }

  function smoothstep01(x) { return x * x * (3 - 2 * x); }
  function toByte(v) {
    // мягкий roll-off ярких значений (Reinhard-ish), затем гамма-лёгкая
    v = v <= 0 ? 0 : v / (1 + 0.35 * v) * 1.18;
    if (v < 0) v = 0; else if (v > 1) v = 1;
    return (v * 255) | 0;
  }

  // ======================================================================
  //  КОМПОЗИЦИЯ КАДРА
  // ======================================================================
  function draw(t) {
    // фон
    ctx.fillStyle = "#02030a";
    ctx.fillRect(0, 0, W, H);

    // звёзды (с медленным дрейфом-параллаксом)
    drawStars(t);
    const par = Math.sin(t * 0.02) * 8;
    ctx.globalAlpha = 1;
    ctx.drawImage(starCanvas, par, 0, W, H, 0, 0, W, H);

    // ---- внешнее атмосферное гало под диском ----
    const L = state.lightDir;
    drawOuterAtmosphere(L);

    // ---- сфера ----
    renderSphere(t);
    // апскейл буфера на диск
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const d = radius * 2;
    ctx.drawImage(buf, cx - radius, cy - radius, d, d);

    // ---- bloom: размытая копия диска в режиме lighter ----
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.20;
    ctx.filter = "blur(" + Math.max(2, radius * 0.02) + "px)";
    ctx.drawImage(buf, cx - radius, cy - radius, d, d);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.restore();

    // ---- внутренний rim glow по краю диска (тонкая яркая кромка) ----
    drawRim();

    // указатель Солнца (мягкая точка-метка на краю в направлении света)
    drawSunMarker(L);
  }

  function drawOuterAtmosphere(L) {
    // тёплое смещение свечения к подсолнечной стороне
    const off = radius * 0.10;
    const gx = cx + L.x * off;
    const gy = cy - L.y * off;
    // широкое голубое гало
    const g = ctx.createRadialGradient(gx, gy, radius * 0.86, gx, gy, radius * 1.45);
    g.addColorStop(0, "rgba(90,150,255,0.0)");
    g.addColorStop(0.30, "rgba(80,150,255,0.28)");
    g.addColorStop(0.55, "rgba(60,120,230,0.14)");
    g.addColorStop(1, "rgba(20,50,120,0.0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.45, 0, 6.2832);
    ctx.fill();

    // более яркое и тёплое усиление прямо со стороны Солнца
    const sx = cx + L.x * radius;
    const sy = cy - L.y * radius;
    const g2 = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius * 0.9);
    g2.addColorStop(0, "rgba(180,210,255,0.30)");
    g2.addColorStop(0.4, "rgba(120,170,255,0.12)");
    g2.addColorStop(1, "rgba(80,130,255,0.0)");
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.45, 0, 6.2832);
    ctx.fill();
    ctx.restore();
  }

  function drawRim() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(cx, cy, radius * 0.93, cx, cy, radius * 1.02);
    g.addColorStop(0, "rgba(120,180,255,0.0)");
    g.addColorStop(0.7, "rgba(140,190,255,0.10)");
    g.addColorStop(1, "rgba(170,210,255,0.42)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.02, 0, 6.2832);
    ctx.fill();
    ctx.restore();
  }

  function drawSunMarker(L) {
    // проекция направления на Солнце на плоскость экрана (по краю гало)
    const len = Math.sqrt(L.x * L.x + L.y * L.y) || 1;
    const dx = L.x / len, dy = -L.y / len;
    const rr = radius * 1.28;
    const x = cx + dx * rr, y = cy + dy * rr;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.22);
    g.addColorStop(0, "rgba(255,250,225,0.85)");
    g.addColorStop(0.3, "rgba(255,238,180,0.35)");
    g.addColorStop(1, "rgba(255,220,150,0.0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.22, 0, 6.2832);
    ctx.fill();
    ctx.restore();
  }

  // ======================================================================
  //  СВЕТ
  // ======================================================================
  function updateLight(t) {
    if (state.autoLight && !state.lightManual) {
      const a = t * 0.05;
      state.lightDir = normalize(Math.cos(a) * 0.85, 0.22, Math.sin(a) * 0.85 + 0.35);
    }
  }
  function normalize(x, y, z) {
    const l = 1 / Math.sqrt(x * x + y * y + z * z);
    return { x: x * l, y: y * l, z: z * l };
  }
  // из экранной позиции (относительно центра) -> направление на Солнце
  function lightFromScreen(mx, my) {
    let nx = (mx - cx) / radius;
    let ny = -(my - cy) / radius;
    let r2 = nx * nx + ny * ny;
    if (r2 > 1) { const s = 1 / Math.sqrt(r2); nx *= s; ny *= s; r2 = 1; }
    const nz = Math.sqrt(Math.max(0, 1 - r2));
    // немного приподнимем z, чтобы у края не было «нулевого» света
    state.lightDir = normalize(nx, ny, nz * 0.9 + 0.18);
    state.lightManual = true;
  }

  // ======================================================================
  //  АНИМАЦИЯ
  // ======================================================================
  let last = performance.now();
  let tAccum = 0;
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    tAccum += dt;

    if (state.spinning) {
      state.rotation += dt * 0.10 * state.spinSpeed;
    }
    updateLight(tAccum);

    draw(tAccum);
    requestAnimationFrame(frame);
  }

  // ======================================================================
  //  СОБЫТИЯ
  // ======================================================================
  let dragging = false;
  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    const p = pointerPos(e);
    lightFromScreen(p.x, p.y);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const p = pointerPos(e);
    lightFromScreen(p.x, p.y);
  });
  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.zoom = clamp(state.zoom * (e.deltaY > 0 ? 0.94 : 1.06), 0.45, 1.25);
    resize();
  }, { passive: false });

  ui.spin.addEventListener("click", () => {
    state.spinning = !state.spinning;
    ui.spin.classList.toggle("on", state.spinning);
  });
  ui.speed.addEventListener("input", () => { state.spinSpeed = parseFloat(ui.speed.value); });
  ui.clouds.addEventListener("input", () => { state.cloudAmount = parseFloat(ui.clouds.value); });
  ui.auto.addEventListener("change", () => {
    state.autoLight = ui.auto.checked;
    if (state.autoLight) state.lightManual = false;
  });
  ui.reset.addEventListener("click", () => {
    state.zoom = 0.82;
    state.rotation = 0;
    state.spinning = true;
    state.spinSpeed = 1;
    state.cloudAmount = 0.85;
    state.autoLight = true;
    state.lightManual = false;
    ui.spin.classList.add("on");
    ui.speed.value = "1";
    ui.clouds.value = "0.85";
    ui.auto.checked = true;
    resize();
  });

  window.addEventListener("resize", resize);

  // ---- старт ----
  resize();
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
})();
