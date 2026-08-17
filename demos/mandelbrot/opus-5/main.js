/*  Множество Мандельброта — Canvas 2D, без WebGL и воркеров.
    Прогрессивный рендер в главном потоке: проходы 16 → 8 → 4 → 2 → 1 пиксель,
    каждый кадр обсчитывается ограниченный бюджет времени, поэтому UI не залипает.
    Плавная (continuous) раскраска + необязательная объёмная подсветка по производной. */

(() => {
  'use strict';

  // ------------------------------------------------------------------ константы

  const BAIL = 65536;            // |z|^2 — большой радиус выхода даёт гладкий градиент
  const INV_LN2 = 1 / Math.LN2;
  const LUTN = 2048;             // размер таблицы палитры
  const PASSES = [16, 8, 4, 2, 1];
  const BUDGET_MS = 14;          // бюджет счёта на кадр
  const SETTLE_MS = 90;          // пауза после жеста перед полным пересчётом
  const MIN_SCALE = 2e-16;       // предел double: комплексных единиц на CSS-пиксель
  const OUT_LIMIT = 6;           // во сколько раз можно отдалиться от общего вида
  const PIX_CAP = 4.2e6;         // потолок числа физических пикселей рендера
  const DENSITY = 0.11;          // абсолютный член раскладки цвета (см. lutIndex)
  const ADAPT_K = 1.3;           // вклад нормированного члена, циклов палитры
  const ADAPT_P = 0.38;          // его степень
  const PHASE = 0.60;            // сдвиг цикла: дальнее поле уходит в тёмную часть палитры
  const LX = Math.cos(2.35), LY = Math.sin(2.35), LH = 1.35;  // свет сверху-слева

  const PALETTES = [
    { name: 'Ультрафиолет', inside: [4, 6, 18], stops: [
      [0.0000,   0,   7, 100], [0.1300,  32, 107, 203], [0.2900, 138, 205, 240],
      [0.4200, 237, 255, 255], [0.5400, 255, 212,  92], [0.6600, 255, 152,   6],
      [0.7900, 126,  46,  12], [0.9000,   6,   5,  28], [1.0000,   0,   7, 100]] },
    { name: 'Магма', inside: [11, 4, 15], stops: [
      [0.0000,   6,   3,  22], [0.2000,  78,  17,  92], [0.4500, 201,  52,  74],
      [0.6800, 252, 137,  38], [0.8600, 254, 238, 178], [1.0000,   6,   3,  22]] },
    { name: 'Изумруд', inside: [3, 13, 15], stops: [
      [0.0000,   2,  16,  22], [0.2200,  10,  86,  84], [0.4600,  74, 178, 120],
      [0.6800, 214, 232, 153], [0.8600,  40,  86,  92], [1.0000,   2,  16,  22]] },
    { name: 'Аметист', inside: [9, 4, 21], stops: [
      [0.0000,  10,   4,  38], [0.1800,  84,  22, 140], [0.4000, 214,  61, 168],
      [0.6000, 255, 148, 120], [0.8000, 255, 240, 214], [1.0000,  10,   4,  38]] },
    { name: 'Лёд', inside: [3, 8, 21], stops: [
      [0.0000,   4,  10,  32], [0.2000,  20,  74, 140], [0.4400,  96, 184, 222],
      [0.6400, 226, 246, 255], [0.8400,  56, 102, 158], [1.0000,   4,  10,  32]] }
  ];

  const PLACES = [
    { name: 'Общий вид',              re: -0.65,          im:  0.0,          zoom: 1 },
    { name: 'Долина морских коньков', re: -0.7436447860,  im:  0.1318252536, zoom: 2600 },
    { name: 'Долина слонов',          re:  0.2864000000,  im:  0.0154500000, zoom: 900 },
    { name: 'Тройная спираль',        re: -0.0885000000,  im:  0.6541000000, zoom: 600 },
    { name: 'Мини-Мандельброт',       re: -1.7549000000,  im:  0.0,          zoom: 130 },
    { name: 'Точка Мизюревича',       re: -0.7756837700,  im:  0.1364673700, zoom: 40000 }
  ];

  // ------------------------------------------------------------------ DOM

  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d', { alpha: false });
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { alpha: false });

  const $ = (id) => document.getElementById(id);
  const elZoom = $('zoom'), elRe = $('re'), elIm = $('im'), elIter = $('iter'),
        elStatus = $('status'), elProg = $('progBar'), elProgWrap = $('progress'),
        elPalName = $('palName'), elQval = $('qval'), elToast = $('toast');

  // ------------------------------------------------------------------ порядок байт

  const probe = new ArrayBuffer(4);
  new Uint32Array(probe)[0] = 0x0a0b0c0d;
  const LE = new Uint8Array(probe)[0] === 0x0d;
  const pack = LE
    ? (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0
    : (r, g, b) => (((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0);

  const BG_PACK = pack(5, 6, 12);

  // ------------------------------------------------------------------ палитра

  const PR = new Uint8Array(LUTN), PG = new Uint8Array(LUTN), PB = new Uint8Array(LUTN);
  const PACK = new Uint32Array(LUTN);
  let INSIDE = pack(4, 6, 18);
  let palIndex = 0;

  function buildLUT(p) {
    const st = p.stops;
    for (let i = 0; i < LUTN; i++) {
      const t = i / LUTN;
      let k = 0;
      while (k < st.length - 2 && t >= st[k + 1][0]) k++;
      const a = st[k], b = st[k + 1];
      const span = b[0] - a[0];
      let u = span > 0 ? (t - a[0]) / span : 0;
      if (!(u > 0)) u = 0; else if (u > 1) u = 1;
      u = u * u * (3 - 2 * u);                       // мягкий переход между стопами
      const r = Math.round(a[1] + (b[1] - a[1]) * u);
      const g = Math.round(a[2] + (b[2] - a[2]) * u);
      const bl = Math.round(a[3] + (b[3] - a[3]) * u);
      PR[i] = r; PG[i] = g; PB[i] = bl;
      PACK[i] = pack(r, g, bl);
    }
    INSIDE = pack(p.inside[0], p.inside[1], p.inside[2]);
  }

  // ------------------------------------------------------------------ состояние

  const state = { cx: -0.65, cy: 0, cssScale: 0.004 };
  let zoomRef = 0.004;           // масштаб «1×» — полный вид множества
  let quality = 1;
  let SHADE = true;
  let MI = 200;                  // предел итераций текущего рендера (читается ядром)
  let INV_MI = 1 / 200;          // 1/MI — чтобы не делить на каждый пиксель

  let cssW = 1, cssH = 1, W = 1, H = 1, pxRatio = 1;
  let img = null, u32 = null;
  let job = null;
  let mainValid = false;         // на основном холсте лежат пиксели текущего вида
  let workValid = false;         // в буфере work лежит последний «хороший» кадр
  let workView = null;
  let needsPresent = true;
  let rafPending = false;
  let settleTimer = 0;
  let flight = null;
  let placeIndex = 0;
  let lastHud = 0;
  let toastTimer = 0;

  const sdNow = () => state.cssScale / pxRatio;   // комплексных единиц на физ. пиксель
  const zoomNow = () => zoomRef / state.cssScale;

  function fitScale() {
    return Math.max(3.5 / cssW, 2.55 / cssH);
  }

  function maxIterFor(zoom, q) {
    const z = Math.max(1, zoom);
    const it = (120 + 64 * Math.pow(Math.log2(z + 1), 1.25)) * q;
    return Math.max(64, Math.min(20000, Math.round(it)));
  }

  function clampScale(s) {
    if (!isFinite(s) || s <= 0) return MIN_SCALE;
    return Math.min(zoomRef * OUT_LIMIT, Math.max(MIN_SCALE, s));
  }

  // ------------------------------------------------------------------ ядро

  // Возвращает упакованный цвет пикселя для точки c = cr + i·ci.
  function pixelPlain(cr, ci) {
    const cq = cr - 0.25;
    const q = cq * cq + ci * ci;
    if (q * (q + cq) <= 0.25 * ci * ci) return INSIDE;      // главная кардиоида
    const t1 = cr + 1;
    if (t1 * t1 + ci * ci <= 0.0625) return INSIDE;         // круг периода 2

    let zr = 0, zi = 0, zr2 = 0, zi2 = 0;
    let hr = 0, hi = 0, per = 0, n = 0;
    const mi = MI;
    for (; n < mi; n++) {
      zi = 2 * zr * zi + ci;
      zr = zr2 - zi2 + cr;
      zr2 = zr * zr; zi2 = zi * zi;
      if (zr2 + zi2 > BAIL) break;
      const dx = zr - hr;                                    // поиск цикла
      if (dx < 1e-15 && dx > -1e-15) {
        const dy = zi - hi;
        if (dy < 1e-15 && dy > -1e-15) return INSIDE;
      }
      if (++per >= 32) { per = 0; hr = zr; hi = zi; }
    }
    if (n >= mi) return INSIDE;
    return PACK[lutIndex(n, zr2 + zi2)];
  }

  // Тот же расчёт + производная dz/dc → нормаль → ламбертова подсветка.
  function pixelShaded(cr, ci) {
    const cq = cr - 0.25;
    const q = cq * cq + ci * ci;
    if (q * (q + cq) <= 0.25 * ci * ci) return INSIDE;
    const t1 = cr + 1;
    if (t1 * t1 + ci * ci <= 0.0625) return INSIDE;

    let zr = 0, zi = 0, zr2 = 0, zi2 = 0, dr = 0, di = 0;
    let hr = 0, hi = 0, per = 0, n = 0;
    const mi = MI;
    for (; n < mi; n++) {
      const ndr = 2 * (zr * dr - zi * di) + 1;               // dz' = 2·z·dz + 1
      di = 2 * (zr * di + zi * dr);
      dr = ndr;
      zi = 2 * zr * zi + ci;                                 // z' = z² + c
      zr = zr2 - zi2 + cr;
      zr2 = zr * zr; zi2 = zi * zi;
      if (zr2 + zi2 > BAIL) break;
      const dx = zr - hr;
      if (dx < 1e-15 && dx > -1e-15) {
        const dy = zi - hi;
        if (dy < 1e-15 && dy > -1e-15) return INSIDE;
      }
      if (++per >= 32) { per = 0; hr = zr; hi = zi; }
    }
    if (n >= mi) return INSIDE;

    const idx = lutIndex(n, zr2 + zi2);

    let t = 1;
    const dm = dr * dr + di * di;
    if (dm > 1e-300 && dm < Infinity) {
      let ur = (zr * dr + zi * di) / dm;                     // u = z / dz
      let ui = (zi * dr - zr * di) / dm;
      const ul = Math.sqrt(ur * ur + ui * ui);
      if (ul > 0 && ul < Infinity) {
        ur /= ul; ui /= ul;
        t = (ur * LX + ui * LY + LH) / (1 + LH);
      }
    }
    if (!(t > 0)) t = 0; else if (t > 1) t = 1;

    const k = 0.34 + t;
    let r = PR[idx] * k, g = PG[idx] * k, b = PB[idx] * k;
    if (r > 255) r = 255;
    if (g > 255) g = 255;
    if (b > 255) b = 255;
    return pack(r | 0, g | 0, b | 0);
  }

  // Плавный (continuous) номер итерации → позиция в палитре.
  // Два слагаемых. Абсолютное sqrt(sm)·DENSITY привязывает цвет к номеру итерации:
  // при зуме картинка не перекрашивается. Нормированное (sm/MI)^p добавляет ровно
  // ADAPT_K циклов на любой глубине — поэтому и на общем виде, где почти всё
  // убегает за 1–3 итерации, палитра проходится целиком, а не залипает в одном тоне.
  function lutIndex(n, mag2) {
    const nu = Math.log(Math.log(mag2) * 0.5 * INV_LN2) * INV_LN2;
    let sm = n + 2 - nu;
    if (!(sm > 0)) sm = 0;
    let pos = Math.sqrt(sm) * DENSITY + ADAPT_K * Math.pow(sm * INV_MI, ADAPT_P) + PHASE;
    pos -= Math.floor(pos);
    let i = (pos * LUTN) | 0;
    if (i < 0) i = 0; else if (i >= LUTN) i = LUTN - 1;
    return i;
  }

  // ------------------------------------------------------------------ рендер

  function startRender() {
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; }
    if (!img) return;
    MI = maxIterFor(zoomNow(), quality);
    INV_MI = 1 / MI;
    job = {
      cx: state.cx, cy: state.cy, sd: sdNow(), w: W, h: H,
      pass: 0, x: 0, y: 0, count: 0, done: false, firstDone: false,
      dy0: H, dy1: 0, t0: performance.now(), ms: 0
    };
    schedule();
  }

  function requestRender(delay) {
    stashIfGood();
    job = null;
    mainValid = false;
    needsPresent = true;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(startRender, delay);
    schedule();
  }

  function processSlice(budget) {
    const j = job;
    const t0 = performance.now();
    const cx = j.cx, cy = j.cy, sd = j.sd, w = j.w, h = j.h;
    const hw = w / 2, hh = h / 2;
    const kernel = SHADE ? pixelShaded : pixelPlain;

    while (j.pass < PASSES.length) {
      const s = PASSES[j.pass];
      const prev = j.pass > 0 ? s * 2 : 0;

      while (j.y < h) {
        if (j.y < j.dy0) j.dy0 = j.y;
        const ybot = Math.min(h, j.y + s);
        if (ybot > j.dy1) j.dy1 = ybot;

        const im = cy - (j.y + 0.5 - hh) * sd;
        const skipRow = prev !== 0 && (j.y % prev) === 0;
        let guard = 0;

        while (j.x < w) {
          const x = j.x;
          if (!(skipRow && (x % prev) === 0)) {
            const re = cx + (x + 0.5 - hw) * sd;
            const col = kernel(re, im);
            j.count++;
            if (s === 1) {
              u32[j.y * w + x] = col;
            } else {
              const xe = Math.min(w, x + s);
              for (let yy = j.y; yy < ybot; yy++) {
                const row = yy * w;
                for (let xx = x; xx < xe; xx++) u32[row + xx] = col;
              }
            }
          }
          j.x += s;
          if ((++guard & 63) === 0 && performance.now() - t0 > budget) return;
        }

        j.x = 0;
        j.y += s;
        if (performance.now() - t0 > budget) return;
      }

      j.y = 0; j.x = 0; j.pass++;
      if (j.pass === 1) j.firstDone = true;
      if (performance.now() - t0 > budget) return;
    }

    j.done = true;
    j.ms = performance.now() - j.t0;
  }

  function blitJob() {
    const j = job;
    if (!j || !j.firstDone) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!mainValid) {
      ctx.putImageData(img, 0, 0);
      mainValid = true;
    } else if (j.dy1 > j.dy0) {
      ctx.putImageData(img, 0, 0, 0, j.dy0, W, j.dy1 - j.dy0);
    }
    j.dy0 = H; j.dy1 = 0;
  }

  // Сохранить последний резкий кадр как основу для мгновенного превью.
  function stashIfGood() {
    if (!mainValid || !job) return;
    if (!(job.done || job.pass >= 3)) return;
    if (work.width !== W || work.height !== H) { work.width = W; work.height = H; }
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.drawImage(canvas, 0, 0);
    workView = { cx: job.cx, cy: job.cy, sd: job.sd, w: job.w, h: job.h };
    workValid = true;
  }

  // Пока новый кадр не посчитан — показываем прошлый, сдвинутый и промасштабированный.
  function present() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, W, H);
    if (!workValid || !workView) return;
    const sd = sdNow();
    const k = workView.sd / sd;
    if (!isFinite(k) || k <= 0) return;
    const tx = -k * workView.w / 2 + (workView.cx - state.cx) / sd + W / 2;
    const ty = -k * workView.h / 2 + (state.cy - workView.cy) / sd + H / 2;
    if (!isFinite(tx) || !isFinite(ty)) return;
    ctx.setTransform(k, 0, 0, k, tx, ty);
    ctx.drawImage(work, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ------------------------------------------------------------------ кадр

  function schedule() {
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(frame);
    }
  }

  function frame() {
    rafPending = false;
    let force = false;

    if (flight) stepFlight();

    if (job && !job.done) {
      processSlice(BUDGET_MS);
      blitJob();
      if (job.done) force = true;       // финальный статус должен дойти до HUD
    }

    if (needsPresent && !mainValid) present();
    needsPresent = false;

    updateHud(force);

    if (flight || (job && !job.done)) schedule();
  }

  // ------------------------------------------------------------------ HUD

  const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

  function sup(n) {
    const neg = n < 0;
    let s = String(Math.abs(n)).split('').map((d) => SUP[+d]).join('');
    return (neg ? '⁻' : '') + s;
  }

  function fmtZoom(z) {
    if (!isFinite(z) || z <= 0) return '—';
    if (z < 10) return z.toFixed(2).replace('.', ',') + '×';
    if (z < 1e4) return Math.round(z).toLocaleString('ru-RU') + '×';
    const e = Math.floor(Math.log10(z));
    const m = z / Math.pow(10, e);
    return m.toFixed(2).replace('.', ',') + '·10' + sup(e) + '×';
  }

  function fmtCoord(v, scale, suffix) {
    let d = Math.ceil(-Math.log10(scale)) + 2;
    if (!isFinite(d)) d = 6;
    d = Math.min(17, Math.max(4, d));
    return (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(d) + suffix;
  }

  function updateHud(force) {
    const now = performance.now();
    if (!force && now - lastHud < 90) return;
    lastHud = now;

    const sc = state.cssScale;
    elZoom.textContent = fmtZoom(zoomNow());
    elRe.textContent = fmtCoord(state.cx, sc, '');
    elIm.textContent = fmtCoord(state.cy, sc, 'i');
    elIter.textContent = String(job ? maxIterFor(zoomNow(), quality) : MI);

    if (job && !job.done) {
      const p = Math.min(99, Math.round(job.count / (W * H) * 100));
      elStatus.textContent = p + ' %';
      elProgWrap.classList.add('on');
      elProg.style.width = p + '%';
    } else if (job && job.done) {
      elStatus.textContent = (job.ms < 1000 ? Math.round(job.ms) + ' мс' : (job.ms / 1000).toFixed(1).replace('.', ',') + ' с');
      elProgWrap.classList.remove('on');
      elProg.style.width = '100%';
    } else {
      elStatus.textContent = '…';
    }
  }

  function toast(text) {
    elToast.textContent = text;
    elToast.hidden = false;
    void elToast.offsetWidth;               // рефлоу, чтобы сработал переход
    elToast.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      elToast.classList.remove('on');
      toastTimer = setTimeout(() => { elToast.hidden = true; }, 300);
    }, 1500);
  }

  // ------------------------------------------------------------------ геометрия ввода

  function toComplex(cssX, cssY) {
    return {
      re: state.cx + (cssX - cssW / 2) * state.cssScale,
      im: state.cy - (cssY - cssH / 2) * state.cssScale
    };
  }

  function anchorAt(p, cssX, cssY) {          // вернуть точку p под экранную позицию
    state.cx = p.re - (cssX - cssW / 2) * state.cssScale;
    state.cy = p.im + (cssY - cssH / 2) * state.cssScale;
  }

  function localPos(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function zoomAt(cssX, cssY, factor) {
    flight = null;
    const p = toComplex(cssX, cssY);
    const want = state.cssScale * factor;
    const next = clampScale(want);
    if (next === MIN_SCALE && want < MIN_SCALE) toast('Достигнут предел точности double');
    if (next === state.cssScale) return false;
    state.cssScale = next;
    anchorAt(p, cssX, cssY);
    return true;
  }

  // ------------------------------------------------------------------ события мыши/касаний

  const pointers = new Map();
  let dragAnchor = null;
  let pinch = null;

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    let d = ev.deltaY;
    if (ev.deltaMode === 1) d *= 16;           // строки
    else if (ev.deltaMode === 2) d *= cssH;    // страницы
    d = Math.max(-240, Math.min(240, d));
    const factor = Math.exp(d * 0.0017);
    const p = localPos(ev);
    if (zoomAt(p.x, p.y, factor)) {
      requestRender(SETTLE_MS);
      updateHud(true);
    }
  }, { passive: false });

  canvas.addEventListener('pointerdown', (ev) => {
    flight = null;
    canvas.setPointerCapture(ev.pointerId);
    const p = localPos(ev);
    pointers.set(ev.pointerId, p);
    if (pointers.size === 1) {
      dragAnchor = toComplex(p.x, p.y);
      canvas.classList.add('dragging');
    } else if (pointers.size === 2) {
      dragAnchor = null;
      startPinch();
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    const p = localPos(ev);
    pointers.set(ev.pointerId, p);

    if (pointers.size === 1 && dragAnchor) {
      const cur = toComplex(p.x, p.y);
      state.cx += dragAnchor.re - cur.re;
      state.cy += dragAnchor.im - cur.im;
      requestRender(SETTLE_MS);
      updateHud(true);
    } else if (pointers.size >= 2 && pinch) {
      const m = pinchMetrics();
      if (!m) return;
      state.cssScale = clampScale(pinch.scale0 * (pinch.dist0 / m.dist));
      anchorAt(pinch.anchor, m.x, m.y);
      requestRender(SETTLE_MS);
      updateHud(true);
    }
  });

  function endPointer(ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    if (canvas.hasPointerCapture && canvas.hasPointerCapture(ev.pointerId)) {
      canvas.releasePointerCapture(ev.pointerId);
    }
    if (pointers.size === 0) {
      dragAnchor = null;
      pinch = null;
      canvas.classList.remove('dragging');
      requestRender(0);
    } else if (pointers.size === 1) {
      pinch = null;
      const only = pointers.values().next().value;
      dragAnchor = toComplex(only.x, only.y);
    }
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  function pinchMetrics() {
    const it = pointers.values();
    const a = it.next().value, b = it.next().value;
    if (!a || !b) return null;
    const dx = a.x - b.x, dy = a.y - b.y;
    const dist = Math.max(1e-3, Math.hypot(dx, dy));
    return { dist, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function startPinch() {
    const m = pinchMetrics();
    if (!m) return;
    pinch = { dist0: m.dist, scale0: state.cssScale, anchor: toComplex(m.x, m.y) };
  }

  canvas.addEventListener('dblclick', (ev) => {
    ev.preventDefault();
    const p = localPos(ev);
    const out = ev.shiftKey || ev.altKey || ev.ctrlKey;
    if (zoomAt(p.x, p.y, out ? 2.2 : 1 / 2.2)) requestRender(0);
  });

  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  window.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const step = 0.12;
    let handled = true;
    switch (ev.key) {
      case 'ArrowLeft':  state.cx -= cssW * state.cssScale * step; break;
      case 'ArrowRight': state.cx += cssW * state.cssScale * step; break;
      case 'ArrowUp':    state.cy += cssH * state.cssScale * step; break;
      case 'ArrowDown':  state.cy -= cssH * state.cssScale * step; break;
      case '+': case '=': zoomAt(cssW / 2, cssH / 2, 1 / 1.6); break;
      case '-': case '_': zoomAt(cssW / 2, cssH / 2, 1.6); break;
      case 'r': case 'R': case 'к': case 'К': resetView(); return;
      case 'p': case 'P': case 'з': case 'З': nextPalette(); return;
      case 's': case 'S': case 'ы': case 'Ы': toggleRelief(); return;
      case 't': case 'T': case 'е': case 'Е': nextPlace(); return;
      default: handled = false;
    }
    if (!handled) return;
    ev.preventDefault();
    flight = null;
    requestRender(0);
    updateHud(true);
  });

  // ------------------------------------------------------------------ полёт к точке

  function flyTo(re, im, zoom, ms) {
    stashIfGood();
    job = null;
    mainValid = false;
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; }
    flight = {
      t0: performance.now(), ms,
      fx: state.cx, fy: state.cy, fs: state.cssScale,
      tx: re, ty: im, ts: clampScale(zoomRef / zoom)
    };
    schedule();
  }

  function stepFlight() {
    const f = flight;
    let u = (performance.now() - f.t0) / f.ms;
    if (!(u > 0)) u = 0;
    if (u >= 1) u = 1;
    const ez = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;   // ease-in-out
    const ec = 1 - Math.pow(1 - u, 3);                                     // центр «догоняет» раньше
    state.cx = f.fx + (f.tx - f.fx) * ec;
    state.cy = f.fy + (f.ty - f.fy) * ec;
    state.cssScale = clampScale(f.fs * Math.pow(f.ts / f.fs, ez));
    needsPresent = true;
    if (u >= 1) {
      flight = null;
      state.cx = f.tx; state.cy = f.ty; state.cssScale = f.ts;
      startRender();
    }
  }

  // ------------------------------------------------------------------ кнопки

  function resetView() {
    flight = null;
    zoomRef = fitScale();
    state.cx = -0.65; state.cy = 0; state.cssScale = zoomRef;
    placeIndex = 0;
    requestRender(0);
    updateHud(true);
  }

  function nextPalette() {
    palIndex = (palIndex + 1) % PALETTES.length;
    buildLUT(PALETTES[palIndex]);
    elPalName.textContent = PALETTES[palIndex].name;
    requestRender(0);
  }

  function toggleRelief() {
    SHADE = !SHADE;
    $('btnRelief').setAttribute('aria-pressed', SHADE ? 'true' : 'false');
    requestRender(0);
  }

  function nextPlace() {
    placeIndex = (placeIndex + 1) % PLACES.length;
    const p = PLACES[placeIndex];
    const ratio = Math.abs(Math.log2(Math.max(1e-9, (zoomRef / p.zoom) / state.cssScale)));
    flyTo(p.re, p.im, p.zoom, Math.max(750, Math.min(2400, 600 + ratio * 140)));
    toast(p.name);
  }

  $('btnPal').addEventListener('click', nextPalette);
  $('btnRelief').addEventListener('click', toggleRelief);
  $('btnTour').addEventListener('click', nextPlace);
  $('btnReset').addEventListener('click', resetView);

  const q = $('quality');
  q.addEventListener('input', () => {
    quality = parseFloat(q.value) || 1;
    elQval.textContent = quality.toFixed(1).replace('.', ',') + '×';
    requestRender(120);
    updateHud(true);
  });

  // ------------------------------------------------------------------ размер

  function resize(first) {
    const cw = Math.max(1, canvas.clientWidth || window.innerWidth || 800);
    const ch = Math.max(1, canvas.clientHeight || window.innerHeight || 600);
    let d = Math.min(2, window.devicePixelRatio || 1);
    const total = cw * ch * d * d;
    if (total > PIX_CAP) d = Math.max(0.75, d * Math.sqrt(PIX_CAP / total));
    const nw = Math.max(1, Math.round(cw * d));
    const nh = Math.max(1, Math.round(ch * d));
    if (!first && nw === W && nh === H && cw === cssW && ch === cssH) return;

    stashIfGood();

    cssW = cw; cssH = ch; W = nw; H = nh;
    pxRatio = W / cssW;
    canvas.width = W;
    canvas.height = H;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (first) {
      zoomRef = fitScale();
      state.cssScale = zoomRef;
      state.cx = -0.65;
      state.cy = 0;
    }

    img = ctx.createImageData(W, H);
    u32 = new Uint32Array(img.data.buffer);
    u32.fill(BG_PACK);

    mainValid = false;
    requestRender(first ? 0 : 60);
    updateHud(true);
  }

  window.addEventListener('resize', () => resize(false));
  if (typeof ResizeObserver === 'function') {
    let firstObs = true;
    const ro = new ResizeObserver(() => {
      if (firstObs) { firstObs = false; return; }
      resize(false);
    });
    ro.observe(document.documentElement);
  }

  // ------------------------------------------------------------------ старт

  buildLUT(PALETTES[palIndex]);
  elPalName.textContent = PALETTES[palIndex].name;
  elQval.textContent = '1,0×';
  resize(true);
  updateHud(true);
})();
