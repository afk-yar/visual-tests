'use strict';

/* =========================================================================
   Полярное сияние — кинематографичный рендер на 2D canvas, без библиотек.

   Конвейер кадра:
     1. ночное небо — вертикальный градиент + лёгкое атмосферное свечение;
     2. звёзды (с параллаксом, мерцанием, редкими яркими + Млечный Путь);
     3. сияние рисуется ОДИН раз в offscreen-буфер (несколько лент-занавесей,
        каждая — волнообразная вертикальная штора с лучами-вертикалями,
        переливами зелёный→голубой→пурпур и мягким верхним затуханием);
     4. этот буфер выводится на сцену с аддитивным свечением (несколько
        смещённых масштабированных копий = дешёвый «bloom»);
     5. силуэт ландшафта (горный хребет);
     6. отражение неба+сияния в озере (тот же буфер, отзеркаленный вниз,
        с горизонтальным дрожанием воды и затуханием) + блики на ряби;
     7. метеоры по запросу.

   Шум — собственная value-noise на хешах (детерминированный, без сети).
   ========================================================================= */

(function () {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d', { alpha: false });

  // ---- управление ----
  const ui = {
    playPause: document.getElementById('playPause'),
    reflect: document.getElementById('reflect'),
    shoot: document.getElementById('shoot'),
    intensity: document.getElementById('intensity'),
    speed: document.getElementById('speed'),
    wind: document.getElementById('wind'),
  };

  let running = true;
  let reflectOn = true;

  // =====================================================================
  //  ШУМ — детерминированный value-noise (1D и 2D) на целочисленных хешах
  // =====================================================================
  function hash1(n) {
    // быстрый псевдослучайный хеш -> [0,1)
    let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  function hash2(i, j) {
    let x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  function smooth(t) { return t * t * (3 - 2 * t); }

  // плавный 1D-шум
  function noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const a = hash1(i);
    const b = hash1(i + 1);
    return a + (b - a) * smooth(f);
  }
  // плавный 2D-шум
  function noise2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    const u = smooth(fx), v = smooth(fy);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  // фрактальный 1D (несколько октав) — мягкие большие волны + мелкая дрожь
  function fbm1(x, t) {
    let sum = 0, amp = 0.5, freq = 1;
    for (let o = 0; o < 4; o++) {
      sum += amp * noise1(x * freq + t * (0.6 + o * 0.27) + o * 53.3);
      freq *= 2.0;
      amp *= 0.5;
    }
    return sum; // ~[0,1]
  }

  // =====================================================================
  //  ГЕОМЕТРИЯ / СОСТОЯНИЕ СЦЕНЫ
  // =====================================================================
  let W = 0, H = 0, DPR = 1;
  let horizonY = 0;          // линия горизонта в CSS-px
  let mountains = [];        // массив слоёв гор: каждый — массив высот
  let stars = [];
  let milky = [];            // «пыль» Млечного Пути
  let meteors = [];

  // offscreen-буфер для сияния (рисуем сияние сюда, потом блумим на сцену)
  const auroraBuf = document.createElement('canvas');
  const abx = auroraBuf.getContext('2d');

  // ленты-занавеси: каждая со своими фазами, цветом, положением
  let curtains = [];

  function makeCurtains() {
    curtains = [];
    // палитра по «слоям высоты» реального сияния:
    //  низ — кислородный зелёный, выше — голубовато-зелёный, верх — азотный пурпур.
    const presets = [
      { hueA: 150, hueB: 168, sat: 90 }, // насыщенно-зелёная
      { hueA: 158, hueB: 190, sat: 88 }, // зелёно-бирюзовая
      { hueA: 168, hueB: 205, sat: 82 }, // бирюза→голубой
      { hueA: 285, hueB: 320, sat: 78 }, // пурпурно-розовая (высокая)
      { hueA: 140, hueB: 175, sat: 92 }, // ещё одна зелёная для плотности
    ];
    const N = 5;
    for (let i = 0; i < N; i++) {
      const p = presets[i % presets.length];
      curtains.push({
        depth: i / (N - 1),                 // 0 — ближняя, 1 — дальняя
        seed: i * 19.73 + 4.1,
        baseX: 0.5,                          // относит. центр (0..1), задаётся в layout
        widthFrac: 0.9 + (i % 3) * 0.12,     // ширина шторы как доля экрана
        topFrac: 0.06 + (i % 3) * 0.05,      // верх шторы (доля высоты неба)
        botFrac: 0.62 + (i % 2) * 0.1,       // низ шторы
        speed: 0.18 + i * 0.05,              // скорость дрейфа волны
        amp: 0.10 + (i % 3) * 0.045,         // амплитуда боковых волн
        ...p,
      });
    }
  }

  // =====================================================================
  //  LAYOUT (resize)
  // =====================================================================
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    W = cssW; H = cssH;

    canvas.width = Math.max(1, Math.round(cssW * DPR));
    canvas.height = Math.max(1, Math.round(cssH * DPR));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    horizonY = Math.round(H * 0.70);

    // offscreen-буфер сияния — в половинном разрешении (быстрее + мягче, как glow)
    const bw = Math.max(1, Math.round(cssW * 0.5));
    const bh = Math.max(1, Math.round(horizonY * 0.5));
    auroraBuf.width = bw;
    auroraBuf.height = bh;

    buildStars();
    buildMountains();
    makeCurtains();
    layoutCurtains();
  }

  function layoutCurtains() {
    // разносим центры штор по экрану, чтобы они перекрывались естественно
    for (let i = 0; i < curtains.length; i++) {
      const c = curtains[i];
      c.baseX = 0.5 + (noise1(c.seed * 3.1) - 0.5) * 0.7;
    }
  }

  // ---- звёзды ----
  function buildStars() {
    stars = [];
    const skyArea = W * horizonY;
    const count = Math.round(skyArea / 1400); // плотность
    for (let i = 0; i < count; i++) {
      const r = Math.pow(Math.random(), 2.2); // больше тусклых, меньше ярких
      stars.push({
        x: Math.random() * W,
        y: Math.random() * horizonY * 0.96,
        size: 0.4 + r * 1.9,
        base: 0.25 + r * 0.75,
        tw: Math.random() * Math.PI * 2,      // фаза мерцания
        twSpeed: 0.4 + Math.random() * 1.6,
        warm: Math.random() < 0.18,           // часть звёзд тёплые
      });
    }
    // Млечный Путь — диагональная полоса мягкой «пыли»
    milky = [];
    const mAngle = -0.5 + Math.random() * 0.3;
    const mCount = Math.round(skyArea / 4200);
    const cx = W * (0.3 + Math.random() * 0.4);
    const cy = horizonY * (0.25 + Math.random() * 0.25);
    for (let i = 0; i < mCount; i++) {
      const t = (Math.random() - 0.5);
      const along = t * W * 1.4;
      const across = (Math.random() - 0.5) * H * 0.22 * (1 - Math.abs(t) * 0.6);
      const x = cx + Math.cos(mAngle) * along - Math.sin(mAngle) * across;
      const y = cy + Math.sin(mAngle) * along + Math.cos(mAngle) * across;
      if (y < 0 || y > horizonY) continue;
      milky.push({ x, y, a: 0.04 + Math.random() * 0.10, s: 0.4 + Math.random() * 1.0 });
    }
  }

  // ---- горы (несколько слоёв хребтов) ----
  function buildMountains() {
    mountains = [];
    const layers = [
      { amp: 0.10, base: 0.015, rough: 0.011, color: '#0a1422', y: 0.0 },
      { amp: 0.16, base: 0.045, rough: 0.018, color: '#070d18', y: 0.0 },
      { amp: 0.24, base: 0.085, rough: 0.03,  color: '#03070f', y: 0.0 },
    ];
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      const seed = li * 41.7 + 7;
      const pts = [];
      const step = Math.max(4, W / 220);
      for (let x = -step; x <= W + step; x += step) {
        // ломаный хребет: крупные пики + мелкая зазубренность
        const big = fbm1(x * L.rough + seed, 0) ;
        const jag = noise1(x * 0.13 + seed * 2) * 0.35;
        const hgt = (big * 0.8 + jag) * L.amp + L.base;
        pts.push({ x, h: hgt });
      }
      mountains.push({ pts, color: L.color });
    }
  }

  // =====================================================================
  //  РЕНДЕР: НЕБО
  // =====================================================================
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, horizonY);
    g.addColorStop(0.0, '#01030a');
    g.addColorStop(0.45, '#040a16');
    g.addColorStop(0.78, '#06121f');
    g.addColorStop(1.0, '#0a1c28'); // лёгкое свечение у горизонта
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizonY);
    // зелёный «airglow» у самого горизонта
    const ag = ctx.createLinearGradient(0, horizonY * 0.82, 0, horizonY);
    ag.addColorStop(0, 'rgba(20,80,70,0)');
    ag.addColorStop(1, 'rgba(40,140,110,0.10)');
    ctx.fillStyle = ag;
    ctx.fillRect(0, horizonY * 0.82, W, horizonY * 0.18);
  }

  function drawStars(time) {
    // Млечный Путь
    ctx.save();
    for (let i = 0; i < milky.length; i++) {
      const m = milky[i];
      ctx.globalAlpha = m.a;
      ctx.fillStyle = '#cfe0ff';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // звёзды
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const tw = 0.62 + 0.38 * Math.sin(time * s.twSpeed + s.tw);
      const a = s.base * tw;
      if (s.warm) ctx.fillStyle = `rgba(255,225,200,${a})`;
      else ctx.fillStyle = `rgba(214,232,255,${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
      // у крупных ярких — крестообразный блик
      if (s.size > 1.5 && tw > 0.9) {
        ctx.globalAlpha = (tw - 0.9) * 4 * s.base;
        ctx.strokeStyle = '#dfeeff';
        ctx.lineWidth = 0.6;
        const r = s.size * 3.2;
        ctx.beginPath();
        ctx.moveTo(s.x - r, s.y); ctx.lineTo(s.x + r, s.y);
        ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x, s.y + r);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  // =====================================================================
  //  РЕНДЕР: СИЯНИЕ (в offscreen-буфер)
  //  Каждая штора рисуется столбцами; для каждого столбца считаем
  //  волнообразное горизонтальное смещение (несколько фаз), яркость
  //  (с «дырами» по длине шторы — мерцающие лучи) и вертикальный градиент
  //  цвета зелёный→голубой→пурпур с мягким затуханием сверху и снизу.
  // =====================================================================
  function drawAuroraToBuffer(time, intensity, wind) {
    const bw = auroraBuf.width, bh = auroraBuf.height;
    abx.setTransform(1, 0, 0, 1, 0, 0);
    abx.clearRect(0, 0, bw, bh);
    abx.globalCompositeOperation = 'lighter'; // аддитивное накопление

    const cols = Math.max(80, Math.round(bw / 2));     // столбцов на буфер
    const dx = bw / cols;

    for (let ci = 0; ci < curtains.length; ci++) {
      const c = curtains[ci];
      const cw = c.widthFrac * bw;
      const cx0 = c.baseX * bw;
      const topY = c.topFrac * bh;
      const botY = c.botFrac * bh;
      const span = botY - topY;

      // дальние шторы тусклее и «дрожат» меньше
      const depthDim = 1 - c.depth * 0.45;
      const drift = time * c.speed * (0.6 + wind * 0.8);

      // пройдём по столбцам шторы
      const left = cx0 - cw / 2;
      const startCol = Math.max(0, Math.floor(left / dx));
      const endCol = Math.min(cols, Math.ceil((left + cw) / dx));

      for (let i = startCol; i <= endCol; i++) {
        const bx = i * dx;
        const u = (bx - left) / cw;            // 0..1 по ширине шторы
        if (u < 0 || u > 1) continue;

        // мягкое затухание по краям шторы (косинусное окно)
        const edge = Math.sin(Math.min(Math.max(u, 0), 1) * Math.PI);
        if (edge <= 0.001) continue;

        // боковое колыхание занавеси: складываем несколько волн разной частоты
        const wx = u * 7.0 + c.seed;
        const wave =
          Math.sin(wx * 1.0 + drift * 1.0) * 0.55 +
          Math.sin(wx * 2.3 - drift * 1.7 + 1.3) * 0.28 +
          fbm1(u * 3.0 + c.seed, drift * 0.5) * 0.6 - 0.3;
        const sway = wave * c.amp * bw;

        // вертикальная «глубина» складки — где штора ярче/темнее по длине
        // создаёт ощущение вертикальных лучей и плотных/разреженных мест
        const rayPhase = u * 26.0 + c.seed * 5.0;
        let rays = 0.55 + 0.45 * Math.sin(rayPhase + drift * 2.0);
        rays *= 0.7 + 0.3 * noise1(u * 40.0 + drift * 1.5 + c.seed); // тонкая дрожь лучей
        // редкие яркие «горячие» столбцы
        const hot = Math.pow(noise1(u * 9.0 + Math.floor(time * 0.5) * 7.3 + c.seed), 4) * 1.6;

        const colX = bx + sway;
        if (colX < -2 || colX > bw + 2) continue;

        // высота столбца «дышит» — низ ленты слегка волнится
        const tJit = noise1(u * 5.0 + drift) * 0.06;
        const yTop = topY + span * (tJit * 0.5);
        const yBot = botY - span * (0.04 + 0.10 * (0.5 + 0.5 * Math.sin(wx * 1.7 - drift)));

        const colH = yBot - yTop;
        if (colH <= 0) continue;

        // яркость столбца
        const bright = edge * depthDim * (0.55 * rays + hot) * intensity;
        if (bright <= 0.01) continue;

        // цветовой градиент по высоте: низ — зелёный (hueA), верх — к hueB,
        // самый верх редких штор уходит в пурпур.
        const grad = abx.createLinearGradient(0, yTop, 0, yBot);
        const sat = c.sat;
        // верх: затухающий пурпурно-голубой край
        grad.addColorStop(0.0, `hsla(${c.hueB}, ${sat}%, 60%, 0)`);
        grad.addColorStop(0.14, `hsla(${c.hueB}, ${sat}%, 62%, ${0.18 * bright})`);
        grad.addColorStop(0.42, `hsla(${(c.hueA + c.hueB) / 2}, ${sat}%, 58%, ${0.55 * bright})`);
        grad.addColorStop(0.74, `hsla(${c.hueA}, ${sat}%, 52%, ${0.85 * bright})`);
        // низ: яркое плотное основание + резкий нижний край (характерная «бахрома»)
        grad.addColorStop(0.94, `hsla(${c.hueA - 6}, ${Math.min(100, sat + 6)}%, 56%, ${1.0 * bright})`);
        grad.addColorStop(1.0, `hsla(${c.hueA - 8}, ${sat}%, 50%, 0)`);

        abx.fillStyle = grad;
        // ширина столбца с лёгким перекрытием, чтобы не было швов
        abx.fillRect(colX - dx * 0.75, yTop, dx * 1.6, colH);
      }
    }
    abx.globalCompositeOperation = 'source-over';
  }

  // вывод буфера сияния на сцену с дешёвым bloom (несколько слоёв)
  function blitAurora(destY, destH, flip, alpha, jitterFn) {
    const bw = auroraBuf.width, bh = auroraBuf.height;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (flip) {
      ctx.translate(0, destY + destH);
      ctx.scale(1, -1);
      destY = 0;
    }

    // если есть функция дрожания (вода) — рисуем построчно с горизонтальным сдвигом
    if (jitterFn) {
      const slices = 46;
      const sh = destH / slices;
      const sbh = bh / slices;
      for (let s = 0; s < slices; s++) {
        const sy = destY + s * sh;
        const off = jitterFn(s / slices);
        const lineA = alpha * (1 - s / slices * 0.75); // глубже — слабее
        ctx.globalAlpha = lineA;
        ctx.drawImage(auroraBuf, 0, s * sbh, bw, sbh, off, sy, W, sh + 1);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }

    // основной слой
    ctx.globalAlpha = alpha;
    ctx.drawImage(auroraBuf, 0, 0, bw, bh, 0, destY, W, destH);

    // bloom: масштабированные смещённые копии с малой альфой
    const blooms = [
      { sc: 1.012, a: 0.42 * alpha, ox: 0 },
      { sc: 1.03, a: 0.26 * alpha, ox: 0 },
      { sc: 1.07, a: 0.16 * alpha, ox: 0 },
    ];
    for (const b of blooms) {
      const dw = W * b.sc, dh = destH * b.sc;
      const ox = (W - dw) / 2 + b.ox;
      const oy = destY + (destH - dh) / 2;
      ctx.globalAlpha = b.a;
      ctx.drawImage(auroraBuf, 0, 0, bw, bh, ox, oy, dw, dh);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // =====================================================================
  //  РЕНДЕР: ГОРЫ + ОТРАЖЕНИЕ + ВОДА
  // =====================================================================
  function mountainPath(layer, scaleY, baseY, dir) {
    // dir=+1 вниз (горы вверх от горизонта рисуем инверсией), мы строим
    // полигон гор: вершины = baseY - h*H (вверх), низ — до bottom.
    ctx.beginPath();
    const pts = layer.pts;
    ctx.moveTo(pts[0].x, baseY);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      ctx.lineTo(p.x, baseY - dir * p.h * H * scaleY);
    }
    ctx.lineTo(pts[pts.length - 1].x, baseY);
  }

  function drawMountains() {
    for (let i = 0; i < mountains.length; i++) {
      const L = mountains[i];
      ctx.fillStyle = L.color;
      mountainPath(L, 1, horizonY, 1);
      ctx.lineTo(W, horizonY);
      ctx.lineTo(0, horizonY);
      ctx.closePath();
      ctx.fill();
    }
    // тонкая подсветка кромки ближнего хребта снизу сиянием
    const top = mountains[mountains.length - 1];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(80,200,150,0.18)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const pts = top.pts;
    ctx.moveTo(pts[0].x, horizonY - pts[0].h * H);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, horizonY - pts[i].h * H);
    ctx.stroke();
    ctx.restore();
  }

  function drawWaterAndReflection(time, intensity, wind) {
    const waterTop = horizonY;
    const waterH = H - horizonY;

    // базовая вода — тёмный градиент
    const wg = ctx.createLinearGradient(0, waterTop, 0, H);
    wg.addColorStop(0, '#04101a');
    wg.addColorStop(0.4, '#030b14');
    wg.addColorStop(1, '#01060d');
    ctx.fillStyle = wg;
    ctx.fillRect(0, waterTop, W, waterH);

    if (reflectOn) {
      // отражение звёзд (слабое, дрожащее) — пара ярких точек
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < stars.length; i += 7) {
        const s = stars[i];
        if (s.size < 1.3) continue;
        const ry = waterTop + (waterTop - s.y) * 0.5;
        if (ry > H) continue;
        const wob = Math.sin(time * 1.4 + s.x * 0.05) * 1.6;
        ctx.globalAlpha = s.base * 0.18;
        ctx.fillStyle = '#bfe0ff';
        ctx.fillRect(s.x + wob, ry, 1.2, 1.2);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // отражение сияния — отзеркаленный буфер с дрожанием воды
      const reflH = Math.min(waterH, horizonY * 0.85);
      const jitter = (v) => {
        // горизонтальное смещение строки = бегущая рябь
        const amp = (4 + wind * 9) * (0.4 + v * 0.9);
        return Math.sin(v * 26 + time * 2.2) * amp + Math.sin(v * 60 - time * 1.3) * amp * 0.4;
      };
      blitAurora(waterTop, reflH, false, 0.5 * intensity, jitter);

      // блики ряби — горизонтальные мерцающие штрихи, ярче у горизонта
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const lines = Math.round(waterH / 6);
      for (let i = 0; i < lines; i++) {
        const y = waterTop + i * 6 + 3;
        const depth = i / lines;
        const x = ((noise1(i * 1.7 + time * 0.6) * 1.3 - 0.15)) * W;
        const len = 30 + noise1(i * 3.1 + time) * 120 * (1 - depth);
        const a = (0.05 + 0.10 * noise1(i * 2.3 + time * 1.5)) * (1 - depth * 0.8) * intensity;
        const grd = ctx.createLinearGradient(x, y, x + len, y);
        grd.addColorStop(0, 'rgba(120,230,190,0)');
        grd.addColorStop(0.5, `rgba(140,240,200,${a})`);
        grd.addColorStop(1, 'rgba(120,230,190,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(x, y, len, 1.3);
      }
      ctx.restore();
    }

    // лёгкая дымка/виньетка на дальней воде у горизонта
    const haze = ctx.createLinearGradient(0, waterTop, 0, waterTop + waterH * 0.3);
    haze.addColorStop(0, 'rgba(20,60,55,0.18)');
    haze.addColorStop(1, 'rgba(20,60,55,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, waterTop, W, waterH * 0.3);
  }

  // =====================================================================
  //  МЕТЕОРЫ
  // =====================================================================
  function spawnMeteor() {
    const x = Math.random() * W * 0.8 + W * 0.1;
    const y = Math.random() * horizonY * 0.35;
    const ang = Math.PI * (0.18 + Math.random() * 0.22); // наклон вниз-вправо/влево
    const dir = Math.random() < 0.5 ? 1 : -1;
    const speed = 700 + Math.random() * 500;
    meteors.push({
      x, y,
      vx: Math.cos(ang) * speed * dir,
      vy: Math.sin(ang) * speed,
      life: 1, len: 80 + Math.random() * 120,
    });
  }
  function updateMeteors(dt) {
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx * dt; m.y += m.vy * dt;
      m.life -= dt * 0.9;
      if (m.life <= 0 || m.y > horizonY) meteors.splice(i, 1);
    }
  }
  function drawMeteors() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of meteors) {
      const nx = -m.vx, ny = -m.vy;
      const mag = Math.hypot(nx, ny) || 1;
      const tx = m.x + nx / mag * m.len, ty = m.y + ny / mag * m.len;
      const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * m.life})`);
      g.addColorStop(0.3, `rgba(180,230,255,${0.5 * m.life})`);
      g.addColorStop(1, 'rgba(180,230,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.9 * m.life})`;
      ctx.beginPath(); ctx.arc(m.x, m.y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // =====================================================================
  //  ГЛАВНЫЙ ЦИКЛ
  // =====================================================================
  let last = performance.now();
  let simTime = 0;          // художественное время (масштабируется скоростью)
  let nextMeteor = 4 + Math.random() * 6;

  function frame(now) {
    const real = Math.min(0.05, (now - last) / 1000);
    last = now;

    const speed = parseFloat(ui.speed.value);
    const intensity = parseFloat(ui.intensity.value);
    const wind = parseFloat(ui.wind.value);

    if (running) {
      simTime += real * speed;
      updateMeteors(real);
      nextMeteor -= real;
      if (nextMeteor <= 0) { spawnMeteor(); nextMeteor = 6 + Math.random() * 10; }
    }

    // --- рисуем кадр ---
    drawSky();
    drawStars(simTime);

    // сияние в буфер (один раз) и на небо
    drawAuroraToBuffer(simTime, intensity, wind);
    blitAurora(0, horizonY, false, 1.0 * intensity, null);

    drawMeteors();

    // горизонт: вода + отражение (под горами, чтобы горы перекрывали)
    drawWaterAndReflection(simTime, intensity, wind);
    drawMountains();

    // финальная виньетка для кинематографичности
    const vg = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.3,
                                        W / 2, H * 0.5, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    requestAnimationFrame(frame);
  }

  // =====================================================================
  //  ВВОД
  // =====================================================================
  ui.playPause.addEventListener('click', () => {
    running = !running;
    ui.playPause.textContent = running ? 'Пауза' : 'Пуск';
    if (running) last = performance.now();
  });
  ui.reflect.addEventListener('click', () => {
    reflectOn = !reflectOn;
    ui.reflect.classList.toggle('on', reflectOn);
  });
  ui.shoot.addEventListener('click', () => { for (let k = 0; k < 1 + Math.floor(Math.random() * 2); k++) spawnMeteor(); });

  let rTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(rTimer);
    rTimer = setTimeout(resize, 120);
  });

  // старт
  resize();
  requestAnimationFrame(frame);
})();
