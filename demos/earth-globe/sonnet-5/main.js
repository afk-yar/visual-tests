// main.js — рендер вращающегося земного шара на 2D canvas (без библиотек).
// Чистая математика вынесена в globe.js (window.Globe): перевод широта/
// долгота → 3D-вектор с учётом вращения и наклона оси, и функция терминатора.
// Всё остальное (процедурная карта, освещение, облака, огни городов, блик,
// атмосфера, звёзды) — здесь.
(function () {
  'use strict';

  var Globe = window.Globe;

  // ----------------------------------------------------------------------
  // Общие утилиты
  // ----------------------------------------------------------------------

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function clampByte(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerp3(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }

  function smootherClamp(t) {
    t = clamp01(t);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function wrapU(u) {
    u = u % 1;
    if (u < 0) u += 1;
    return u;
  }

  // ----------------------------------------------------------------------
  // Процедурный шум: value noise 3D + fBm + доменное искажение
  // (собственная лёгкая реализация, без внешних библиотек)
  // ----------------------------------------------------------------------

  function makeHash(seed) {
    var s = seed | 0;
    return function hash3(x, y, z) {
      var h = x | 0;
      h = Math.imul(h ^ (y | 0), 0x9e3779b1);
      h = Math.imul(h ^ (z | 0), 0x85ebca6b);
      h = Math.imul(h ^ s, 0xc2b2ae35);
      h ^= h >>> 15;
      h = Math.imul(h, 0x27d4eb2f);
      h ^= h >>> 13;
      return (h >>> 0) / 4294967296;
    };
  }

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function makeValueNoise3D(seed) {
    var hash = makeHash(seed);
    return function noise3D(x, y, z) {
      var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      var xf = x - xi, yf = y - yi, zf = z - zi;
      var u = fade(xf), v = fade(yf), w = fade(zf);

      var c000 = hash(xi, yi, zi), c100 = hash(xi + 1, yi, zi);
      var c010 = hash(xi, yi + 1, zi), c110 = hash(xi + 1, yi + 1, zi);
      var c001 = hash(xi, yi, zi + 1), c101 = hash(xi + 1, yi, zi + 1);
      var c011 = hash(xi, yi + 1, zi + 1), c111 = hash(xi + 1, yi + 1, zi + 1);

      var x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u);
      var x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
      var y0 = lerp(x00, x10, v), y1 = lerp(x01, x11, v);
      return lerp(y0, y1, w);
    };
  }

  function makeFbm(noise3D, octaves, lacunarity, gain) {
    return function fbm(x, y, z) {
      var amp = 0.5, freq = 1, sum = 0, norm = 0;
      for (var i = 0; i < octaves; i++) {
        sum += amp * noise3D(x * freq, y * freq, z * freq);
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
      }
      return sum / norm;
    };
  }

  // Поля шума планеты (фиксированные "зёрна" — карта одна и та же при каждой
  // загрузке демки, но процедурная, а не зашитый растр).
  var warpNoiseA = makeFbm(makeValueNoise3D(11), 3, 2.0, 0.5);
  var warpNoiseB = makeFbm(makeValueNoise3D(23), 3, 2.0, 0.5);
  var landFbm = makeFbm(makeValueNoise3D(7), 4, 2.05, 0.5);
  var cloudWarp = makeFbm(makeValueNoise3D(131), 2, 2.0, 0.5);
  var cloudFbm = makeFbm(makeValueNoise3D(101), 4, 2.0, 0.55);
  var cityDensityNoise = makeFbm(makeValueNoise3D(211), 2, 2.0, 0.5);
  var cityFineHash = makeHash(311);

  var SEA_LEVEL = 0.565;
  var CLOUD_LOW = 0.5;
  var CLOUD_HIGH = 0.83;

  // Высота "суши" (0..1) в точке единичной сферы (px,py,pz) — доменное
  // искажение (Inigo Quilez -style domain warp) даёт более органичные,
  // не "блобообразные" береговые линии.
  function landHeight(px, py, pz) {
    var scale = 1.6;
    var wx = px * scale, wy = py * scale, wz = pz * scale;
    var qa = warpNoiseA(wx + 4.1, wy + 1.7, wz + 9.2) - 0.5;
    var qb = warpNoiseB(wx - 3.3, wy + 8.8, wz - 2.1) - 0.5;
    var warpAmt = 0.9;
    return landFbm(
      wx + qa * warpAmt,
      wy + qb * warpAmt,
      wz + (qa - qb) * warpAmt * 0.5
    );
  }

  function cloudRaw(px, py, pz) {
    var scale = 2.6;
    var wx = px * scale, wy = py * scale, wz = pz * scale;
    var warp = (cloudWarp(wx + 7.7, wy - 2.2, wz + 3.1) - 0.5) * 1.4;
    return cloudFbm(wx + warp, wy + warp * 0.7, wz - warp * 0.5);
  }

  // ----------------------------------------------------------------------
  // Цвет поверхности: биомы по широте + рельефу, океан по глубине
  // ----------------------------------------------------------------------

  function oceanColor(latDeg, h) {
    var depth = clamp01((SEA_LEVEL - h) / SEA_LEVEL);
    var shallow = [23, 103, 133];
    var deep = [4, 20, 56];
    var color = lerp3(shallow, deep, Math.pow(depth, 0.6));
    if (latDeg > 72) {
      var ice = clamp01((latDeg - 72) / 14);
      color = lerp3(color, [214, 227, 233], ice * 0.85);
    }
    return color;
  }

  function landColor(latDeg, h, biomeNoise) {
    var above = clamp01((h - SEA_LEVEL) / (1 - SEA_LEVEL));
    var base;
    if (latDeg > 68) {
      base = [211, 219, 226];
    } else if (latDeg > 50) {
      base = lerp3([92, 112, 78], [211, 219, 226], clamp01((latDeg - 50) / 18));
    } else if (latDeg > 32) {
      base = biomeNoise > 0.52 ? [193, 170, 116] : [79, 118, 66];
    } else if (latDeg > 15) {
      base = biomeNoise > 0.44 ? [203, 176, 118] : [92, 130, 60];
    } else {
      base = [55, 104, 56];
    }

    var rocky = [122, 114, 106];
    var snow = [245, 247, 250];
    var color = lerp3(base, rocky, clamp01((above - 0.35) / 0.4));
    var snowMix = clamp01((above - 0.72) / 0.28) * (latDeg > 18 ? 1 : 0.85);
    color = lerp3(color, snow, snowMix);
    // светлая прибрежная кайма
    color = lerp3([210, 195, 152], color, clamp01(above / 0.05));
    return color;
  }

  // ----------------------------------------------------------------------
  // Запекание текстур (равнопромежуточная карта lat/lon → RGB/скаляр).
  // Выполняется один раз при загрузке, дальше во время анимации только
  // билинейно читается — иначе шум пришлось бы пересчитывать на каждый
  // пиксель каждого кадра.
  // ----------------------------------------------------------------------

  var TEX_W = 640;
  var TEX_H = 320;

  function bakeTextures() {
    var colorTex = new Uint8ClampedArray(TEX_W * TEX_H * 3);
    var oceanMask = new Uint8Array(TEX_W * TEX_H);
    var cityTex = new Uint8Array(TEX_W * TEX_H);
    var cloudTex = new Uint8Array(TEX_W * TEX_H);

    for (var j = 0; j < TEX_H; j++) {
      var v = (j + 0.5) / TEX_H;
      var lat = (0.5 - v) * Math.PI;
      var latDeg = Math.abs(lat) * 180 / Math.PI;

      for (var i = 0; i < TEX_W; i++) {
        var u = (i + 0.5) / TEX_W;
        var lon = (u - 0.5) * 2 * Math.PI;

        // единичный вектор точки на сфере в собственной системе планеты
        // (rotation=0, tilt=0) — используем ту же функцию, что и рендерер,
        // чтобы карта была математически согласована с проекцией сцены.
        var p = Globe.latLonToVector(lat, lon, 0, 0);
        var idx = j * TEX_W + i;

        var h = landHeight(p.x, p.y, p.z);
        var isLand = h > SEA_LEVEL;
        oceanMask[idx] = isLand ? 0 : 255;

        var biome = cityDensityNoise(p.x * 5.1 + 50, p.y * 5.1 + 50, p.z * 5.1 + 50);
        var rgb = isLand ? landColor(latDeg, h, biome) : oceanColor(latDeg, h);
        colorTex[idx * 3] = rgb[0];
        colorTex[idx * 3 + 1] = rgb[1];
        colorTex[idx * 3 + 2] = rgb[2];

        var cRaw = cloudRaw(p.x, p.y, p.z);
        var cloud = smootherClamp((cRaw - CLOUD_LOW) / (CLOUD_HIGH - CLOUD_LOW));
        cloudTex[idx] = Math.round(cloud * 255);

        if (isLand) {
          var popField = cityDensityNoise(p.x * 3.2, p.y * 3.2, p.z * 3.2);
          var coastal = clamp01(1 - Math.abs(h - SEA_LEVEL) / 0.06);
          var habitable = latDeg < 68 ? 1 : 0.12;
          var chance = (popField * 0.55 + coastal * 0.45) * habitable;
          var fine = cityFineHash(i, j, 7);
          if (chance > 0.5 && fine > 0.74) {
            cityTex[idx] = Math.min(255, Math.round((chance - 0.5) * 2 * 255));
          }
        }
      }
    }

    blurScalarWrapped(cityTex, TEX_W, TEX_H, 1);
    blurScalarWrapped(cityTex, TEX_W, TEX_H, 1);

    return { colorTex: colorTex, oceanMask: oceanMask, cityTex: cityTex, cloudTex: cloudTex };
  }

  // простое 3x3 box-blur по горизонтали с wrap (для мягкого свечения огней)
  function blurScalarWrapped(arr, w, h, radius) {
    var tmp = new Float32Array(w * h);
    var i, j, k, sum, count;
    for (j = 0; j < h; j++) {
      for (i = 0; i < w; i++) {
        sum = 0; count = 0;
        for (k = -radius; k <= radius; k++) {
          var xi = ((i + k) % w + w) % w;
          sum += arr[j * w + xi];
          count++;
        }
        tmp[j * w + i] = sum / count;
      }
    }
    for (j = 0; j < h; j++) {
      for (i = 0; i < w; i++) {
        sum = 0; count = 0;
        for (k = -radius; k <= radius; k++) {
          var yj = clamp(j + k, 0, h - 1);
          sum += tmp[yj * w + i];
          count++;
        }
        arr[j * w + i] = Math.round(sum / count);
      }
    }
  }

  // ----------------------------------------------------------------------
  // Билинейное сэмплирование текстур (wrap по долготе, clamp по широте)
  // ----------------------------------------------------------------------

  function sampleColorBilinear(tex, u, v) {
    u = wrapU(u);
    v = clamp01(v);
    var fx = u * TEX_W - 0.5, fy = v * TEX_H - 0.5;
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var tx = fx - x0, ty = fy - y0;
    var x1 = x0 + 1, y1 = y0 + 1;
    x0 = ((x0 % TEX_W) + TEX_W) % TEX_W;
    x1 = ((x1 % TEX_W) + TEX_W) % TEX_W;
    y0 = clamp(y0, 0, TEX_H - 1);
    y1 = clamp(y1, 0, TEX_H - 1);
    var i00 = (y0 * TEX_W + x0) * 3, i10 = (y0 * TEX_W + x1) * 3;
    var i01 = (y1 * TEX_W + x0) * 3, i11 = (y1 * TEX_W + x1) * 3;
    var r = lerp(lerp(tex[i00], tex[i10], tx), lerp(tex[i01], tex[i11], tx), ty);
    var g = lerp(lerp(tex[i00 + 1], tex[i10 + 1], tx), lerp(tex[i01 + 1], tex[i11 + 1], tx), ty);
    var b = lerp(lerp(tex[i00 + 2], tex[i10 + 2], tx), lerp(tex[i01 + 2], tex[i11 + 2], tx), ty);
    return [r, g, b];
  }

  function sampleScalarBilinear(tex, u, v) {
    u = wrapU(u);
    v = clamp01(v);
    var fx = u * TEX_W - 0.5, fy = v * TEX_H - 0.5;
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var tx = fx - x0, ty = fy - y0;
    var x1 = x0 + 1, y1 = y0 + 1;
    x0 = ((x0 % TEX_W) + TEX_W) % TEX_W;
    x1 = ((x1 % TEX_W) + TEX_W) % TEX_W;
    y0 = clamp(y0, 0, TEX_H - 1);
    y1 = clamp(y1, 0, TEX_H - 1);
    var i00 = y0 * TEX_W + x0, i10 = y0 * TEX_W + x1;
    var i01 = y1 * TEX_W + x0, i11 = y1 * TEX_W + x1;
    return lerp(lerp(tex[i00], tex[i10], tx), lerp(tex[i01], tex[i11], tx), ty);
  }

  // ----------------------------------------------------------------------
  // DOM / canvas / состояние
  // ----------------------------------------------------------------------

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');

  var btnPause = document.getElementById('btn-pause');
  var btnClouds = document.getElementById('btn-clouds');
  var rngSpeed = document.getElementById('rng-speed');
  var rngAz = document.getElementById('rng-az');
  var rngEl = document.getElementById('rng-el');

  var BASE_ROT_SPEED = 0.045; // рад/с — медленное вращение
  var TERMINATOR_SOFTNESS = 0.16;

  var state = {
    rotation: 0.3,
    rotationSpeedMul: parseFloat(rngSpeed.value),
    cloudDrift: 0,
    tilt: Globe.EARTH_AXIAL_TILT,
    lightAz: parseFloat(rngAz.value) * Globe.DEG2RAD,
    lightEl: parseFloat(rngEl.value) * Globe.DEG2RAD,
    paused: false,
    showClouds: true,
  };

  var textures = bakeTextures();

  // ----------------------------------------------------------------------
  // Звёздное небо
  // ----------------------------------------------------------------------

  var stars = [];
  var meteor = null;
  var meteorTimer = 3 + Math.random() * 6;

  function regenerateStars(w, h) {
    var area = w * h;
    var count = clamp(Math.round(area / 2600), 140, 520);
    stars = [];
    for (var i = 0; i < count; i++) {
      var big = Math.random() < 0.08;
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: big ? 1.1 + Math.random() * 1.3 : 0.35 + Math.random() * 0.7,
        base: 0.35 + Math.random() * 0.65,
        amp: Math.random() * 0.5,
        speed: 0.4 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        warm: Math.random() < 0.16,
      });
    }
  }

  function drawStars(time, dt) {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = s.base + s.amp * Math.sin(time * s.speed + s.phase);
      tw = clamp01(tw);
      var col = s.warm ? '255,224,190' : '255,255,255';
      ctx.beginPath();
      ctx.fillStyle = 'rgba(' + col + ',' + tw.toFixed(3) + ')';
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    meteorTimer -= dt;
    if (!meteor && meteorTimer <= 0) {
      var w = canvas._cssW, h = canvas._cssH;
      var startX = Math.random() * w * 0.6 + w * 0.1;
      var startY = Math.random() * h * 0.3;
      var ang = Math.PI * 0.22 + Math.random() * 0.25;
      var speed = Math.max(w, h) * (0.9 + Math.random() * 0.5);
      meteor = {
        x: startX,
        y: startY,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 0,
        maxLife: 0.55 + Math.random() * 0.35,
      };
      meteorTimer = 7 + Math.random() * 11;
    }
    if (meteor) {
      meteor.life += dt;
      var t = meteor.life / meteor.maxLife;
      if (t >= 1) {
        meteor = null;
      } else {
        var mx = meteor.x + meteor.vx * meteor.life;
        var my = meteor.y + meteor.vy * meteor.life;
        var tailLen = 0.11;
        var tx = mx - meteor.vx * tailLen;
        var ty = my - meteor.vy * tailLen;
        var alpha = Math.sin(Math.PI * clamp01(t)) * 0.9;
        var grad = ctx.createLinearGradient(tx, ty, mx, my);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(1, 'rgba(255,255,255,' + alpha.toFixed(3) + ')');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(mx, my);
        ctx.stroke();
      }
    }
  }

  // ----------------------------------------------------------------------
  // Буфер сферы: рендерится в пониженном/ограниченном разрешении для
  // производительности, затем масштабируется на основной canvas.
  // ----------------------------------------------------------------------

  var bufCanvas = document.createElement('canvas');
  var bufCtx = bufCanvas.getContext('2d');
  var bufDiam = 0;
  var bufImage = null;

  function ensureBuffer(targetDiam) {
    var d = Math.round(clamp(targetDiam, 420, 820));
    if (d === bufDiam) return;
    bufDiam = d;
    bufCanvas.width = bufDiam;
    bufCanvas.height = bufDiam;
    bufImage = bufCtx.createImageData(bufDiam, bufDiam);
  }

  function renderGlobeBuffer() {
    var data = bufImage.data;
    var R = bufDiam / 2;
    var cx = R, cy = R;

    var tilt = state.tilt;
    var cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    var rotation = state.rotation;

    var light = Globe.lightFromAzEl(state.lightAz, state.lightEl);
    var H = Globe.normalize({ x: light.x, y: light.y, z: light.z + 1 });

    var cloudShift = state.cloudDrift;
    var showClouds = state.showClouds;

    for (var py = 0; py < bufDiam; py++) {
      var ny = (cy - py) / R;
      var rowOff = py * bufDiam;
      for (var px = 0; px < bufDiam; px++) {
        var off = (rowOff + px) * 4;
        var nx = (px - cx) / R;
        var d2 = nx * nx + ny * ny;
        if (d2 > 1) {
          data[off + 3] = 0;
          continue;
        }
        var nz = Math.sqrt(1 - d2);

        // освещённость: считаем прямо в системе наблюдателя, лишних
        // преобразований не требуется (нормаль сферы в этой точке — сам
        // вектор (nx,ny,nz)).
        var dot = nx * light.x + ny * light.y + nz * light.z;
        var day = Globe.terminatorFactor(dot, TERMINATOR_SOFTNESS);

        // адрес на текстуре: находим широту/долготу, "приклеенную" к
        // планете (без учёта текущего вращения), используя обратный наклон
        // и вычитание угла вращения из долготы.
        var y1 = ny * cosT + nz * sinT;
        var z1 = -ny * sinT + nz * cosT;
        var lat = Math.asin(clamp(y1, -1, 1));
        var lonEff = Math.atan2(z1, nx);
        var lon = lonEff - rotation;

        var u = lon / (2 * Math.PI) + 0.5;
        var vt = 0.5 - lat / Math.PI;

        var rgb = sampleColorBilinear(textures.colorTex, u, vt);
        var ocean = sampleScalarBilinear(textures.oceanMask, u, vt) / 255;
        var city = sampleScalarBilinear(textures.cityTex, u, vt) / 255;

        var r = rgb[0], g = rgb[1], b = rgb[2];

        // смешение дня/ночи (мягкая ambient-подсветка ночной стороны, чтобы
        // не проваливаться в абсолютную черноту)
        r *= 0.16 + 0.84 * day;
        g *= 0.16 + 0.84 * day;
        b *= 0.19 + 0.87 * day;

        // огни городов на ночной стороне
        var nightGlow = city * (1 - day) * 1.7;
        r += nightGlow * 255;
        g += nightGlow * 200;
        b += nightGlow * 108;

        // блик солнца на океане (Блинн-Фонг по половинному вектору)
        if (ocean > 0.35 && day > 0.12) {
          var ndoth = nx * H.x + ny * H.y + nz * H.z;
          if (ndoth > 0) {
            var spec = Math.pow(ndoth, 58) * ocean * day * 235;
            r += spec;
            g += spec * 0.97;
            b += spec * 0.86;
          }
        }

        // облака
        if (showClouds) {
          var cloud = sampleScalarBilinear(textures.cloudTex, u + cloudShift, vt) / 255;
          var cAlpha = cloud * (0.5 + 0.5 * day) * 0.92;
          var litCloud = 150 + 105 * day;
          r = r * (1 - cAlpha) + litCloud * cAlpha;
          g = g * (1 - cAlpha) + litCloud * cAlpha;
          b = b * (1 - cAlpha) + (litCloud + 4) * cAlpha;
        }

        // атмосферная дымка у края диска (Френель-подобный ободок,
        // ярче с освещённой стороны)
        var limb = Math.pow(1 - nz, 3);
        r += limb * day * 22;
        g += limb * day * 42;
        b += limb * day * 66;

        // лёгкое затемнение самого края (limb darkening)
        var darken = 1 - 0.26 * Math.pow(1 - nz, 1.6);
        r *= darken; g *= darken; b *= darken;

        data[off] = clampByte(r);
        data[off + 1] = clampByte(g);
        data[off + 2] = clampByte(b);
        data[off + 3] = 255;
      }
    }
    bufCtx.putImageData(bufImage, 0, 0);
  }

  // ----------------------------------------------------------------------
  // Композиция кадра на основном canvas
  // ----------------------------------------------------------------------

  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    canvas._cssW = w;
    canvas._cssH = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    regenerateStars(w, h);

    var R = Math.min(w, h) * 0.34;
    ensureBuffer(R * 2);
  }

  function drawBackground(w, h, cx, cy, R) {
    var bg = ctx.createRadialGradient(
      cx, cy * 0.85, R * 0.4,
      w * 0.5, h * 0.5, Math.max(w, h) * 0.85
    );
    bg.addColorStop(0, '#0a1120');
    bg.addColorStop(0.55, '#050810');
    bg.addColorStop(1, '#020305');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // едва заметная "туманность" по диагонали для глубины кадра
    var neb = ctx.createLinearGradient(0, h, w, 0);
    neb.addColorStop(0, 'rgba(70,50,110,0.05)');
    neb.addColorStop(0.5, 'rgba(40,80,120,0.04)');
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, w, h);
  }

  function drawAtmosphere(cx, cy, R, light) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    var outer = ctx.createRadialGradient(cx, cy, R * 0.93, cx, cy, R * 1.32);
    outer.addColorStop(0, 'rgba(110,180,255,0.45)');
    outer.addColorStop(0.45, 'rgba(90,165,255,0.16)');
    outer.addColorStop(1, 'rgba(90,165,255,0)');
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.32, 0, Math.PI * 2);
    ctx.fill();

    // яркий полумесяц свечения со стороны, обращённой к солнцу
    var lx = cx + light.x * R * 0.55;
    var ly = cy - light.y * R * 0.55;
    var crescent = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 1.05);
    crescent.addColorStop(0, 'rgba(180,225,255,0.28)');
    crescent.addColorStop(1, 'rgba(180,225,255,0)');
    ctx.fillStyle = crescent;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawVignette(w, h) {
    var vg = ctx.createRadialGradient(
      w * 0.5, h * 0.5, Math.min(w, h) * 0.35,
      w * 0.5, h * 0.5, Math.max(w, h) * 0.72
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  function render(time, dt) {
    var w = canvas._cssW, h = canvas._cssH;
    var cx = w * 0.47, cy = h * 0.52;
    var R = Math.min(w, h) * 0.34;

    drawBackground(w, h, cx, cy, R);
    drawStars(time, dt);

    var light = Globe.lightFromAzEl(state.lightAz, state.lightEl);
    drawAtmosphere(cx, cy, R, light);

    renderGlobeBuffer();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bufCanvas, 0, 0, bufDiam, bufDiam, cx - R, cy - R, R * 2, R * 2);

    drawVignette(w, h);
  }

  // ----------------------------------------------------------------------
  // Взаимодействие: перетаскивание двигает источник света; слайдеры дают
  // тот же эффект точным вводом.
  // ----------------------------------------------------------------------

  function syncSlidersFromState() {
    rngAz.value = Math.round(state.lightAz / Globe.DEG2RAD);
    rngEl.value = Math.round(state.lightEl / Globe.DEG2RAD);
  }

  var dragging = false, lastX = 0, lastY = 0;

  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    state.lightAz = Globe.wrapAngle(state.lightAz + dx * 0.007);
    state.lightEl = clamp(state.lightEl - dy * 0.006, -1.25, 1.25);
    syncSlidersFromState();
  });

  function stopDrag() { dragging = false; }
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('pointerleave', function () {
    if (dragging) stopDrag();
  });

  btnPause.addEventListener('click', function () {
    state.paused = !state.paused;
    btnPause.textContent = state.paused ? 'Пуск' : 'Пауза';
    btnPause.setAttribute('aria-pressed', String(state.paused));
  });

  btnClouds.addEventListener('click', function () {
    state.showClouds = !state.showClouds;
    btnClouds.setAttribute('aria-pressed', String(state.showClouds));
  });

  rngSpeed.addEventListener('input', function () {
    state.rotationSpeedMul = parseFloat(rngSpeed.value);
  });
  rngAz.addEventListener('input', function () {
    state.lightAz = parseFloat(rngAz.value) * Globe.DEG2RAD;
  });
  rngEl.addEventListener('input', function () {
    state.lightEl = parseFloat(rngEl.value) * Globe.DEG2RAD;
  });

  window.addEventListener('resize', resize);

  // ----------------------------------------------------------------------
  // Главный цикл анимации (dt-based, с клампом больших скачков времени)
  // ----------------------------------------------------------------------

  var lastT = null;
  var clock = 0;

  function frame(t) {
    var tSec = t / 1000;
    if (lastT === null) lastT = tSec;
    var dt = tSec - lastT;
    lastT = tSec;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;

    clock += dt;

    if (!state.paused) {
      state.rotation = Globe.wrapAngle(state.rotation + BASE_ROT_SPEED * state.rotationSpeedMul * dt);
      state.cloudDrift += 0.0028 * dt * 60 * (0.4 + 0.6 * Math.max(state.rotationSpeedMul, 0.05));
    }

    render(clock, dt);
    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);
})();
