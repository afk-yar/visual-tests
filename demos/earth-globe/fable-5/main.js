'use strict';
/* «Вращающийся земной шар» — Claude Fable 5.
 * Попиксельный рендер сферы в ImageData: карта суши/океана рисуется процедурно
 * (полигоны континентов + фрактальный домен-варп берегов), день/ночь с мягким
 * терминатором, огни городов, блик солнца на океане, живые облака, атмосфера
 * и звёздное небо. Без библиотек и внешних ресурсов.
 */

// ---------- канвас и метрики ----------
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
let DPR = 1, vw = 0, vh = 0;   // CSS-размеры вьюпорта
let cx = 0, cy = 0, R = 100;   // центр и радиус глобуса (CSS px)

// ---------- текстуры планеты ----------
const TW = 2048, TH = 1024, TMASK = TW - 1;  // дневная карта (равнопромежуточная)
const CW = 1024, CH = 512, CMASK = CW - 1;   // облака
const dRt = new Uint8Array(TW * TH);  // цвет суши/океана R
const dGt = new Uint8Array(TW * TH);  // G
const dBt = new Uint8Array(TW * TH);  // B
const dSt = new Uint8Array(TW * TH);  // зеркальность (океан)
const dNt = new Uint8Array(TW * TH);  // огни городов
const cTt = new Uint8Array(CW * CH);  // плотность облаков

// низкочастотные поля шума (билинейная выборка при запекании)
const FW = 512, FH = 256;
const FCONF = [
  { base: 18, oct: 4, seed: 101 },  // 0: варп берегов X
  { base: 18, oct: 4, seed: 227 },  // 1: варп берегов Y
  { base: 10, oct: 5, seed: 353 },  // 2: рельеф
  { base: 6,  oct: 4, seed: 479 },  // 3: влажность / дрожание широт
  { base: 40, oct: 3, seed: 613 },  // 4: кластеры городов
  { base: 5,  oct: 3, seed: 741 },  // 5: крупная вариация океана
  { base: 10, oct: 5, seed: 863 },  // 6: база облаков
  { base: 7,  oct: 3, seed: 997 }   // 7: варп облаков
];
const fields = FCONF.map(() => new Float32Array(FW * FH));

// ---------- утилиты ----------
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function sstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) { return a + (b - a) * t; }

function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) * 2.3283064365386963e-10; // / 2^32
}

// value-шум с периодом per по x (в ячейках решётки) — бесшовен по долготе
function vnoise(x, y, per, seed) {
  let xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % per) + per) % per, x1 = (x0 + 1) % per;
  const a = hash2(x0, yi, seed), b = hash2(x1, yi, seed);
  const c = hash2(x0, yi + 1, seed), d = hash2(x1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(u, v, base, oct, seed) { // u∈[0,1) долгота, v∈[0,1] широта
  let amp = 0.5, sum = 0, norm = 0, per = base;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * per, v * per * 0.5, per, seed + o * 131);
    norm += amp;
    amp *= 0.5;
    per *= 2;
  }
  return sum / norm;
}

// одна высокочастотная октава — фрактальная «рябь» берегов
function hf(u, v, seed) {
  return vnoise(u * 192, v * 96, 192, seed);
}

// билинейное чтение низкочастотного поля
function fread(F, u, v) {
  let x = u * FW, y = v * FH - 0.5;
  if (y < 0) y = 0; else if (y > FH - 1.001) y = FH - 1.001;
  let xi = x | 0;
  if (xi >= FW) xi -= FW;
  const yi = y | 0;
  const fx = x - xi, fy = y - yi;
  const x1 = xi + 1 === FW ? 0 : xi + 1;
  const r0 = yi * FW, r1 = (yi + 1 >= FH ? yi : yi + 1) * FW;
  const a = F[r0 + xi], b = F[r0 + x1], c = F[r1 + xi], d = F[r1 + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// ---------- география: стилизованные контуры (lon, lat, градусы) ----------
const LANDS = [
  // Северная Америка (с Аляской, Гудзоновым заливом, Флоридой, Центр. Америкой)
  [-168,66,-165,60,-158,58,-152,60,-140,60,-134,56,-125,49,-124,40,-117,33,
   -113,28,-106,22,-97,17,-92,15,-87,13,-83,9,-80,9,-82,14,-88,16,-87,21,
   -91,19,-97,26,-91,29,-84,30,-81,25,-80,27,-76,35,-74,40,-70,42,-66,45,
   -60,46,-64,49,-59,52,-61,56,-65,60,-71,61,-78,58,-82,53,-88,56,-93,58,
   -90,63,-85,66,-82,69,-92,70,-105,69,-115,70,-128,70,-141,70,-156,71,-165,68],
  // Гренландия
  [-58,76,-52,82,-40,83,-22,82,-20,76,-32,68,-42,60,-50,62,-54,67,-58,72],
  // Южная Америка
  [-78,8,-72,12,-64,11,-60,9,-52,5,-50,0,-44,-3,-35,-6,-38,-13,-40,-20,
   -48,-25,-53,-34,-58,-39,-65,-41,-65,-47,-69,-50,-68,-55,-74,-50,-73,-44,
   -73,-37,-71,-30,-70,-18,-76,-14,-81,-6,-80,0,-77,4],
  // Африка
  [-6,35.2,3,36.8,10,37.2,19,32.5,25,31.8,30,31.3,32.5,29.5,33,28,35.5,23,
   37,20,39.5,15.5,43,11.5,46,10.5,51,12,51,10.5,47.5,4.5,41,-2,39,-8,
   36.5,-15,35,-22,32.5,-26,28,-32.5,22,-34.5,18,-34.3,15.5,-28,12,-18,
   13.5,-11,9,-1,9.5,3.5,4,6,-2,5,-8,4.5,-13,7.5,-17,14.5,-16.5,20,
   -13,25,-9.5,31],
  // Евразия (Европа → Ближний Восток → Индия → Китай → Сибирь → Скандинавия)
  [-9,43,-9,37,-5.5,36,-2,36.5,1,41,6,43,8,44,
   10,44,12,45.5,13.5,43,16,41.5,18,40,15.5,39,13,41,11.5,44,
   14,45,19,42,21,40,23,36.5,26,38,26,40,29,41,34,42,41,41,
   38,37,36,36,35,33,34,31,33,29.5,
   35,28,36.5,24,38,20,39.5,16,43,12.5,
   45,12.5,48,13.5,52,15.5,55,17.5,58.5,21,58.5,23.5,
   54,24.5,51,24.5,48.5,27.5,48,29.5,
   50,30,53,27.5,56.5,26.5,59,25.5,63,25,67.5,24,
   70.5,21,72.5,19,73.5,15.5,76.5,8.5,80,10,80.5,13.5,82.5,17,86,20.5,89.5,22,
   91.5,22.5,92.5,20,94.5,16,97,12,98.5,8,100,6,102.5,2,103.5,1.5,
   102.5,3.5,101,7,100,10.5,100.5,13.5,102,12.5,105,8.7,
   106.5,9.5,109,11.5,109,14.5,107.5,17,106,20,108,21,
   110,21.3,113.5,22.3,116.5,23.3,119,25,121.5,28.5,122,31,120,32.5,
   119.5,34.5,121,37,122.5,37.5,
   124.5,39.8,125.5,38.5,126,36.5,126.5,34.8,129.5,35.2,129.5,38.5,128,40,
   129.5,42,133,44,137,46.5,140.5,50,139,53.5,142,55,147,58,151.5,59.5,
   155,60.5,155,56,156,51.5,159.5,54,162,57.5,163,60,
   167,60.8,171,62,176,64.5,180,65.5,184,64,190,65.8,187,67.5,181,68.8,
   175,69.8,168,69.8,160,70.8,150,72,140,72.8,128,72.2,113.5,73.8,105,77,
   98,76.5,90,75,80,73,72.5,72.5,66,69,60.5,69.5,57,68.3,50,68.5,45,67.5,
   40,66,37,66.5,33,67,
   31,69.8,25,71,17,69.5,12,65,5.5,62,6.5,58.5,9.5,59,11,58.8,12.5,60,
   17.5,62.5,21,64.8,24,65.8,25.5,65,22,61,23.5,59.8,27,60,30,59.8,27.5,59,
   23.5,58,21,56.8,19,54.8,14,53.8,10.5,55.8,9.2,54.8,8,54,
   4.5,52.5,1.5,51,-1.5,49.5,-4.5,48.5,-1.5,46.5,-1.8,43.8],
  // Австралия
  [113.5,-22,113.8,-26,115,-33.5,119,-34.8,124,-33,129,-31.8,132,-32,
   135.5,-34.8,138,-35.5,139.5,-37.5,144,-38.5,147.5,-38.8,150,-37.5,
   152.5,-32.5,153.5,-28.5,152.5,-25,149,-20,145.5,-15,142.5,-10.8,
   141.5,-13,140.5,-17.5,139,-17.3,136.5,-15.5,135.5,-12,132,-11.2,
   129,-14.8,126,-14,122,-18,118,-20.5,114.5,-21.5],
  // Япония (Хонсю + Кюсю, стилизованно)
  [130.5,31,132,34,135,34,137,35,140,35.5,141.5,38,141,41,140.5,42,139,40,
   136,36,132,33.5,130,32],
  // Британия
  [-5.5,50,0.5,51,1.5,52.5,-0.5,54,-2,56,-3,58.5,-5,58,-5,55,-4.5,53,-5.5,51.5],
  // Мадагаскар
  [44.5,-12,49.5,-15.5,47.5,-24,45,-25.3,43.5,-21,43.8,-16],
  // Суматра
  [95.5,5.5,98,3.5,101,0,104,-3,106,-5.8,104,-5.5,101,-2.5,97,2,95,4.5],
  // Ява
  [105.5,-6.2,110,-6.9,114,-7.6,114.5,-8.6,109,-7.9,105.8,-7.1],
  // Борнео
  [109,1.5,112,4.5,115,7,118,6,119,3,117,0,114,-3.5,110,-1.5],
  // Новая Гвинея
  [131,-0.5,135,-1.5,138,-2.5,141,-3,145,-5,148,-8,150,-10.5,147,-9.5,
   143,-8,139,-7.5,135,-4.5,132,-2.5],
  // Новая Зеландия (оба острова, стилизованно)
  [172.8,-34.5,176,-37.5,178.3,-38,177,-39.5,174.5,-40.5,174.3,-41.5,
   172.5,-43.5,169.5,-46.5,166.8,-45.8,170,-42.5,173.5,-40.8,174.8,-38.5,173,-35.8],
  // Антарктический полуостров
  [-63,-63,-58,-62.5,-60,-66,-65,-70,-72,-73,-68,-66]
];

// острова-«кляксы»: lon, lat, rx°, ry°
const BLOBS = [
  -19,65,3,1.8,      // Исландия
  -8,53.5,1.8,1.5,   // Ирландия
  17,78.5,3,1.5,     // Шпицберген
  55,73.5,2,3.5,     // Новая Земля
  -79,21.5,4.5,1,    // Куба
  -71,19,2.2,1,      // Гаити
  80.8,7.8,1.2,1.8,  // Шри-Ланка
  121,23.7,0.9,1.6,  // Тайвань
  110,19,1.3,1,      // Хайнань
  121,16,1.4,3,      // Лусон
  124,8.5,2,2.5,     // Минданао
  121,-2,1.8,2.5,    // Сулавеси
  146.8,-42,2,1.5,   // Тасмания
  143,50,1,4,        // Сахалин
  143,43.5,2,1.8,    // Хоккайдо
  -156,20,0.8,0.6,   // Гавайи
  -45,-51.5,1.5,0.8  // Фолкленды
];

// внутренние моря/озёра, выкалываются из суши: lon, lat, rx°, ry°
const SEAS = [
  34,43.5,7,3.2,     // Чёрное море
  50.5,41.5,3.2,5.5, // Каспий
  59.5,45,1.5,1.7,   // Арал
  -84.5,45.5,5.5,2.2,// Великие озёра
  -85,59,6,5,        // Гудзонов залив (страховка)
  51.5,27,3,1.6      // Персидский залив (страховка)
];

// очаги огней городов: lon, lat, радиус°, сила
const HOTSPOTS = [
  0,51,7,1.0,      10,49,12,0.9,    10,45,3,0.8,     -4,40,4,0.7,
  37,55,5,0.85,    32,49,5,0.6,     30,39,5,0.6,     31,29.5,2.5,1.25,
  35,32,2.5,0.8,   48,27,5,0.9,     77,27,7,1.15,    78,13,6,1.0,
  72,29,4,0.8,     90,23.5,3,1.1,   115,33,9,1.25,   113,23,5,1.2,
  104,30,4,0.9,    127,37,3,1.1,    137,35.5,5,1.15, 121,24,1.5,1.1,
  108,-7,4,1.0,    121,14.5,2,0.9,  100.5,14,2.5,0.9,106,16,4,0.7,
  -77,39,8,1.15,   -87,41,6,0.95,   -95,31,6,0.85,   -81,28,3,0.9,
  -119,36,6,0.95,  -122,46,3,0.7,   -99,19.5,4,0.95, -89,14,4,0.5,
  -75,5,4,0.7,     -45,-22.5,5,1.05,-51,-27,4,0.7,   -58.5,-34.5,4,0.9,
  -71,-33.5,3,0.8, -77,-12,2.5,0.8, 6,7,5,0.9,       0,6,3,0.6,
  28,-27,4,0.8,    37,-2,4,0.5,     39,9,3,0.5,      -7,33,3,0.6,
  3,36.5,3,0.6,    149,-35,4,0.9,   145,-38,3,0.9,   153,-28,2.5,0.7,
  116,-32,2,0.7,   174,-38,2,0.6,   101,2,3,0.6,     60,55,8,0.5,
  83,54,6,0.45,    104,52,5,0.45,   -79,43.5,3,1.0,  -73.5,45.5,2.5,0.9,
  -123,49,2,0.7
];

// пустынные зоны: lon, lat, радиус°, сила
const DESERTS = [
  10,23,26,1.0,     // Сахара
  45,24,11,1.0,     // Аравия
  60,41,8,0.8,      // Каракумы/Кызылкум
  72,27,5,0.9,      // Тар
  105,42,12,0.85,   // Гоби/Такла-Макан
  133,-25,13,0.95,  // австралийская глубинка
  21,-24,8,0.8,     // Калахари/Намиб
  -69,-24,5,0.85,   // Атакама
  -111,31,7,0.8,    // Сонора/Мохаве
  -66,-40,7,0.5     // Патагония (полупустыня)
];

// ---------- маска суши: растеризация контуров ----------
const MW = 1024, MH = 512;
let maskA = null; // Uint8Array MW*MH, 255 = суша

function rasterizeMask() {
  const mc = document.createElement('canvas');
  mc.width = MW; mc.height = MH;
  const m = mc.getContext('2d');
  const X = lon => (lon + 180) / 360 * MW;
  const Y = lat => (90 - lat) / 180 * MH;
  m.fillStyle = '#000';
  m.fillRect(0, 0, MW, MH);
  m.fillStyle = '#fff';
  for (const off of [-360, 0, 360]) {
    for (const poly of LANDS) {
      m.beginPath();
      m.moveTo(X(poly[0] + off), Y(poly[1]));
      for (let i = 2; i < poly.length; i += 2) m.lineTo(X(poly[i] + off), Y(poly[i + 1]));
      m.closePath();
      m.fill();
    }
    for (let i = 0; i < BLOBS.length; i += 4) {
      m.beginPath();
      m.ellipse(X(BLOBS[i] + off), Y(BLOBS[i + 1]),
        BLOBS[i + 2] * MW / 360, BLOBS[i + 3] * MH / 180, 0, 0, 6.2832);
      m.fill();
    }
  }
  // Антарктида — сплошной пояс
  m.fillRect(0, Y(-70.5), MW, MH - Y(-70.5));
  // внутренние моря
  m.fillStyle = '#000';
  for (const off of [-360, 0, 360]) {
    for (let i = 0; i < SEAS.length; i += 4) {
      m.beginPath();
      m.ellipse(X(SEAS[i] + off), Y(SEAS[i + 1]),
        SEAS[i + 2] * MW / 360, SEAS[i + 3] * MH / 180, 0, 0, 6.2832);
      m.fill();
    }
  }
  const d = m.getImageData(0, 0, MW, MH).data;
  maskA = new Uint8Array(MW * MH);
  for (let i = 0, j = 0; i < maskA.length; i++, j += 4) maskA[i] = d[j];
}

// билинейная выборка маски (0..1), lon произвольный, lat клампится
function maskSample(lon, lat) {
  let mx = (lon / 360 + 0.5) * MW;
  mx -= Math.floor(mx / MW) * MW;
  let my = (0.5 - lat / 180) * MH;
  if (my < 0) my = 0; else if (my > MH - 1.001) my = MH - 1.001;
  let xi = mx | 0;
  if (xi >= MW) xi = 0;
  const yi = my | 0;
  const fx = mx - xi, fy = my - yi;
  const x1 = xi + 1 === MW ? 0 : xi + 1;
  const r0 = yi * MW, r1 = (yi + 1 >= MH ? yi : yi + 1) * MW;
  const a = maskA[r0 + xi], b = maskA[r0 + x1], c = maskA[r1 + xi], d = maskA[r1 + x1];
  return (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) * 0.0039216;
}

// ---------- запекание строки дневной карты ----------
function bakeDayRow(v) {
  const lat = 90 - (v + 0.5) * 180 / TH;
  const vn = (v + 0.5) / TH;
  const latR = lat * 0.0174533;
  const cosL = Math.max(0.25, Math.cos(latR));
  // очаги огней и пустынные зоны, актуальные для этой широты
  const rowHS = [];
  for (let i = 0; i < HOTSPOTS.length; i += 4) {
    if (Math.abs(lat - HOTSPOTS[i + 1]) < HOTSPOTS[i + 2] * 2.2) {
      rowHS.push(HOTSPOTS[i], HOTSPOTS[i + 1], HOTSPOTS[i + 2], HOTSPOTS[i + 3]);
    }
  }
  const rowDS = [];
  for (let i = 0; i < DESERTS.length; i += 4) {
    if (Math.abs(lat - DESERTS[i + 1]) < DESERTS[i + 2] * 1.4) {
      rowDS.push(DESERTS[i], DESERTS[i + 1], DESERTS[i + 2], DESERTS[i + 3]);
    }
  }
  const row = v * TW;
  for (let u = 0; u < TW; u++) {
    const un = (u + 0.5) / TW;
    const lon = un * 360 - 180;
    // фрактальный варп берегов
    const wA = (fread(fields[0], un, vn) - 0.5) * 7 + (hf(un, vn, 911) - 0.5) * 2.6;
    const wB = (fread(fields[1], un, vn) - 0.5) * 5 + (hf(un, vn, 313) - 0.5) * 2.0;
    const mv = maskSample(lon + wA / cosL * 0.7, lat + wB);
    const hfd = hf(un * 2, vn * 2, 555);
    const land = mv > 0.5 + (hfd - 0.5) * 0.14;
    const latA = Math.abs(lat + (fread(fields[3], un, vn) - 0.5) * 8);
    let r, g, b, spec = 0, night = 0;
    if (!land) {
      // ----- океан -----
      const varO = fread(fields[5], un, vn);
      const shore = sstep(0.16, 0.5, mv);         // 1 у берега, 0 в открытом океане
      const sh2 = shore * shore;
      r = lerp(5, 24, sh2); g = lerp(16, 74, sh2); b = lerp(42, 116, sh2);
      const vb = 0.82 + 0.36 * varO;
      r *= vb; g *= vb; b *= vb;
      // паковый лёд у полюсов
      const ice = sstep(69, 74, latA + (varO - 0.5) * 10 + (hfd - 0.5) * 3);
      if (ice > 0) {
        const iv = 0.9 + 0.2 * hfd;
        r = lerp(r, 208 * iv, ice); g = lerp(g, 221 * iv, ice); b = lerp(b, 234 * iv, ice);
      }
      spec = 235 * (1 - ice * 0.82);
    } else {
      // ----- суша -----
      const elev = fread(fields[2], un, vn);
      const moist = fread(fields[3], un, vn);
      const warmth = clamp(1 - latA / 75, 0, 1);
      // базовая растительность: тропики ↔ умеренный лес ↔ степь
      const veg = clamp(moist * 1.25 - 0.12, 0, 1);
      const fr = lerp(24, 52, 1 - warmth), fg = lerp(64, 84, 1 - warmth), fb = lerp(28, 40, 1 - warmth);
      r = lerp(108, fr, veg); g = lerp(116, fg, veg); b = lerp(58, fb, veg);
      // пустыни: широтный пояс (с гейтом по влажности) + явные зоны
      const dband = Math.exp(-((latA - 21) * (latA - 21)) / 170) * sstep(0.62, 0.3, moist);
      let dz = 0;
      for (let k = 0; k < rowDS.length; k += 4) {
        let du = lon - rowDS[k];
        if (du > 180) du -= 360; else if (du < -180) du += 360;
        du *= cosL;
        const dv = lat - rowDS[k + 1];
        const rr = rowDS[k + 2];
        const q = 1 - (du * du + dv * dv) / (rr * rr);
        if (q > 0) dz += q * rowDS[k + 3];
      }
      const dfac = clamp(dband * 0.45 + dz * (0.55 + 0.4 * (1 - moist)), 0, 1);
      r = lerp(r, 176, dfac); g = lerp(g, 148, dfac); b = lerp(b, 96, dfac);
      // горы
      const mfac = sstep(0.64, 0.82, elev);
      r = lerp(r, 112, mfac * 0.85); g = lerp(g, 104, mfac * 0.85); b = lerp(b, 92, mfac * 0.85);
      // тундра и снега
      const tf = sstep(48, 62, latA);
      r = lerp(r, 128, tf * 0.8); g = lerp(g, 120, tf * 0.8); b = lerp(b, 92, tf * 0.8);
      let snow = sstep(58, 70, latA + (elev - 0.5) * 18) + mfac * sstep(32, 52, latA) * 0.8;
      if (lat < -60) snow = 1;
      snow = clamp(snow, 0, 1);
      r = lerp(r, 228, snow); g = lerp(g, 234, snow); b = lerp(b, 242, snow);
      // пляжная кромка
      const coastF = sstep(0.5, 0.62, mv);
      if (coastF < 1 && snow < 0.5) {
        const bf = (1 - coastF) * 0.45;
        r = lerp(r, 190, bf); g = lerp(g, 172, bf); b = lerp(b, 128, bf);
      }
      // микрорельеф
      const tv = 0.88 + 0.24 * hfd;
      r *= tv; g *= tv; b *= tv;
      spec = 16 + snow * 30;
      // ----- огни городов -----
      let hs = 0;
      for (let k = 0; k < rowHS.length; k += 4) {
        let du = lon - rowHS[k];
        if (du > 180) du -= 360; else if (du < -180) du += 360;
        du *= cosL;
        const dv = lat - rowHS[k + 1];
        const rr = rowHS[k + 2];
        const q = 1 - (du * du + dv * dv) / (rr * rr);
        if (q > 0) hs += q * q * rowHS[k + 3];
      }
      let base = Math.max(0, fread(fields[4], un, vn) - 0.45) * 1.8;
      base *= base;
      let li = (base * 0.5 + base * hs * 1.6 + hs * 0.55)
        * (1 - snow) * (1 - dfac * 0.75) * (1.25 - 0.5 * coastF);
      const h2 = hash2(u, v, 77);
      li *= h2 > 0.8 ? 2.1 : (h2 < 0.35 ? 0.4 : 1);
      night = clamp(li * 300, 0, 255);
    }
    const ti = row + u;
    dRt[ti] = clamp(r, 0, 255);
    dGt[ti] = clamp(g, 0, 255);
    dBt[ti] = clamp(b, 0, 255);
    dSt[ti] = spec;
    dNt[ti] = night;
  }
}

// ---------- запекание строки облаков ----------
function bakeCloudRow(v) {
  const lat = 90 - (v + 0.5) * 180 / CH;
  const vn = (v + 0.5) / CH;
  const aLat = Math.abs(lat);
  // широтный профиль облачности: ВЗК, штормовые треки, субтропические зоны ясности
  const prof = 0.42
    + 0.30 * Math.exp(-lat * lat / 98)
    + 0.24 * Math.exp(-((aLat - 52) * (aLat - 52)) / 392)
    - 0.30 * Math.exp(-((aLat - 24) * (aLat - 24)) / 162)
    - 0.30 * sstep(62, 85, aLat);
  const th = 0.63 - prof * 0.36;
  const row = v * CW;
  for (let u = 0; u < CW; u++) {
    const un = (u + 0.5) / CW;
    const wx = (fread(fields[7], un, vn) - 0.5) * 0.13;
    const wy = (fread(fields[7], un, vn * 0.5 + 0.25) - 0.5) * 0.08;
    let uu = un + wx;
    uu -= Math.floor(uu);
    const base = fread(fields[6], uu, clamp(vn + wy, 0, 1)) + (hf(un, vn, 733) - 0.5) * 0.3;
    const c = sstep(th, th + 0.3, base);
    cTt[row + u] = c * 255;
  }
}

// ---------- конвейер запекания (по кадрам, с прогрессом) ----------
const loadEl = document.getElementById('load');
const loadFill = document.getElementById('loadFill');
const loadNote = document.getElementById('loadNote');
let ready = false;
const bake = { stage: 0, f: 0, row: 0 };

function bakeStep() {
  const t0 = performance.now();
  while (performance.now() - t0 < 12) {
    if (bake.stage === 0) {
      // низкочастотные поля
      const cf = FCONF[bake.f], F = fields[bake.f];
      const y = bake.row, vn = (y + 0.5) / FH, base = y * FW;
      for (let x = 0; x < FW; x++) {
        F[base + x] = fbm((x + 0.5) / FW, vn, cf.base, cf.oct, cf.seed);
      }
      if (++bake.row >= FH) {
        bake.row = 0;
        if (++bake.f >= FCONF.length) { bake.stage = 1; }
      }
    } else if (bake.stage === 1) {
      rasterizeMask();
      bake.stage = 2; bake.row = 0;
      loadNote.textContent = 'континенты и рельеф';
    } else if (bake.stage === 2) {
      bakeDayRow(bake.row);
      if (++bake.row >= TH) {
        bake.stage = 3; bake.row = 0;
        loadNote.textContent = 'облачный покров';
      }
    } else if (bake.stage === 3) {
      bakeCloudRow(bake.row);
      if (++bake.row >= CH) { bake.stage = 4; }
    } else {
      buildStars();
      buildGeometry();
      ready = true;
      loadEl.classList.add('done');
      return;
    }
  }
  // прогресс: поля 12%, карта 70%, облака 15%, финал 3%
  let p = 0;
  if (bake.stage === 0) p = 0.12 * (bake.f + bake.row / FH) / FCONF.length;
  else if (bake.stage <= 2) p = 0.12 + 0.70 * (bake.row / TH);
  else if (bake.stage === 3) p = 0.82 + 0.15 * (bake.row / CH);
  else p = 0.97;
  loadFill.style.width = (p * 100).toFixed(1) + '%';
}

// ---------- звёздное небо (запекается на resize) ----------
let starCanvas = null;
let twinkles = []; // мерцающие звёзды поверх статики

function buildStars() {
  const w = Math.max(2, Math.round(vw * DPR)), h = Math.max(2, Math.round(vh * DPR));
  starCanvas = document.createElement('canvas');
  starCanvas.width = w; starCanvas.height = h;
  const s = starCanvas.getContext('2d');
  // глубокий космос с виньеткой
  const bg = s.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
  bg.addColorStop(0, '#0a1020');
  bg.addColorStop(0.55, '#060911');
  bg.addColorStop(1, '#020308');
  s.fillStyle = bg;
  s.fillRect(0, 0, w, h);
  // туманности
  const nebs = [
    [0.2, 0.25, 0.35, '150,110,255', 0.05],
    [0.82, 0.7, 0.4, '80,160,220', 0.045],
    [0.65, 0.15, 0.3, '255,150,120', 0.03]
  ];
  for (const [nx, ny, nr, col, na] of nebs) {
    const g = s.createRadialGradient(w * nx, h * ny, 0, w * nx, h * ny, Math.max(w, h) * nr);
    g.addColorStop(0, 'rgba(' + col + ',' + na + ')');
    g.addColorStop(1, 'rgba(' + col + ',0)');
    s.fillStyle = g;
    s.fillRect(0, 0, w, h);
  }
  // Млечный Путь — диагональная полоса
  s.save();
  s.translate(w * 0.5, h * 0.5);
  s.rotate(-0.5);
  const mw = s.createLinearGradient(0, -h * 0.22, 0, h * 0.22);
  mw.addColorStop(0, 'rgba(140,160,210,0)');
  mw.addColorStop(0.5, 'rgba(150,170,220,0.075)');
  mw.addColorStop(1, 'rgba(140,160,210,0)');
  s.fillStyle = mw;
  s.fillRect(-w, -h * 0.25, 2 * w, h * 0.5);
  s.restore();
  // звёзды
  twinkles = [];
  const nStars = Math.round(w * h / 3200);
  for (let i = 0; i < nStars; i++) {
    const inBand = hash2(i, 17, 5) < 0.42;
    let sx = hash2(i, 3, 9) * w, sy = hash2(i, 7, 11) * h;
    if (inBand) {
      // сгущение к полосе Млечного Пути (диагональ через центр)
      const t = hash2(i, 21, 13) * 2 - 1;
      const dev = (hash2(i, 29, 15) + hash2(i, 31, 19) - 1) * h * 0.16;
      sx = w * 0.5 + t * w * 0.75 * Math.cos(-0.5) - dev * Math.sin(-0.5);
      sy = h * 0.5 + t * w * 0.75 * Math.sin(-0.5) + dev * Math.cos(-0.5);
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
    }
    const mag = hash2(i, 37, 23);
    const sr = (0.35 + mag * mag * 1.5) * DPR;
    const warmth = hash2(i, 41, 27);
    const cr = warmth < 0.12 ? '255,214,170' : (warmth > 0.85 ? '175,200,255' : '235,240,250');
    const al = 0.25 + mag * 0.6;
    if (sr > 1.35 * DPR) {
      const g = s.createRadialGradient(sx, sy, 0, sx, sy, sr * 3.2);
      g.addColorStop(0, 'rgba(' + cr + ',' + al.toFixed(2) + ')');
      g.addColorStop(1, 'rgba(' + cr + ',0)');
      s.fillStyle = g;
      s.fillRect(sx - sr * 3.2, sy - sr * 3.2, sr * 6.4, sr * 6.4);
    }
    s.fillStyle = 'rgba(' + cr + ',' + al.toFixed(2) + ')';
    s.beginPath();
    s.arc(sx, sy, sr, 0, 6.2832);
    s.fill();
    if (mag > 0.82 && twinkles.length < 90) {
      twinkles.push({ x: sx / DPR, y: sy / DPR, r: sr / DPR, ph: hash2(i, 43, 31) * 6.28, sp: 0.6 + hash2(i, 47, 37) * 2.2 });
    }
  }
}

// ---------- геометрия глобуса: прекомпьют на пиксель ----------
const TILT = 23.5 * Math.PI / 180; // наклон оси
const TIP = 0.16;                  // лёгкий наклон полюса к зрителю
let N = 0, bufD = 0;
let nrm, uv0f, rowBf, cuv0f, crowf, atmBf, aa8, pixIdx;
let img = null, buf32 = null, bufCanvas = null, bctx = null;
let quality = 1;

function buildGeometry() {
  bufD = Math.max(120, Math.min(640, Math.round(2 * R * DPR * quality)));
  const M = bufD * bufD;
  nrm = new Float32Array(M * 3);
  uv0f = new Int32Array(M);
  rowBf = new Int32Array(M);
  cuv0f = new Int32Array(M);
  crowf = new Int32Array(M);
  atmBf = new Float32Array(M);
  aa8 = new Uint8Array(M);
  pixIdx = new Int32Array(M);
  bufCanvas = document.createElement('canvas');
  bufCanvas.width = bufD; bufCanvas.height = bufD;
  bctx = bufCanvas.getContext('2d');
  img = bctx.createImageData(bufD, bufD);
  buf32 = new Uint32Array(img.data.buffer);
  // обратная матрица наклона: a = (Rz(g)·Rx(t))^T · n
  const g = -TILT, t = TIP;
  const cg = Math.cos(g), sg = Math.sin(g), ct = Math.cos(t), st = Math.sin(t);
  const c = bufD / 2, rp = c - 1;
  let n = 0;
  for (let py = 0; py < bufD; py++) {
    for (let px = 0; px < bufD; px++) {
      const nx = (px + 0.5 - c) / rp;
      const ny = (c - py - 0.5) / rp; // математическая ось Y вверх
      const d2 = nx * nx + ny * ny;
      const dist = Math.sqrt(d2);
      const alpha = clamp((1 - dist) * rp + 0.5, 0, 1);
      if (alpha <= 0) continue;
      let ux = nx, uy = ny, nz = 0;
      if (dist > 1) { ux = nx / dist; uy = ny / dist; }
      else nz = Math.sqrt(1 - d2);
      // a = M^T · n
      const ax = cg * ux + sg * uy;
      const ay = -sg * ct * ux + cg * ct * uy + st * nz;
      const az = sg * st * ux - cg * st * uy + ct * nz;
      const latv = Math.asin(clamp(ay, -1, 1));
      const lon0 = Math.atan2(ax, az);
      const u0 = Math.floor((lon0 / 6.283185307 + 0.5) * TW) & TMASK;
      const vv = clamp(Math.floor((0.5 - latv / Math.PI) * TH), 0, TH - 1);
      const i3 = n * 3;
      nrm[i3] = ux; nrm[i3 + 1] = uy; nrm[i3 + 2] = nz;
      uv0f[n] = u0;
      rowBf[n] = vv * TW;
      cuv0f[n] = u0 >> 1;
      crowf[n] = (vv >> 1) * CW;
      const limb = 1 - nz;
      atmBf[n] = limb * limb * 1.05;
      aa8[n] = alpha * 255;
      pixIdx[n] = py * bufD + px;
      n++;
    }
  }
  N = n;
  buf32.fill(0);
}

// ---------- состояние сцены ----------
let spin = 0;          // угол вращения планеты
let tGlob = 0;         // глобальное время
let paused = false;
let spinSpeed = 1, cloudAmp = 1, lightsAmp = 1;
let autoSun = true;
let sunA = -0.95, sunB = 0.34; // азимут/высота солнца
let dragging = false, dragX = 0, dragY = 0;
let emaMs = 16, qCooldown = 0;

// ---------- попиксельный рендер сферы ----------
function renderGlobe(Lx, Ly, Lz) {
  // half-вектор для блика (взгляд = +Z)
  let hx = Lx, hy = Ly, hz = Lz + 1;
  const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
  hx /= hl; hy /= hl; hz /= hl;
  const spinU = Math.round(spin / 6.283185307 * TW) % TW;
  const sU = ((spinU % TW) + TW) % TW;
  const cSpin = spin * 1.13 + tGlob * 0.012;
  const c1 = ((Math.round(cSpin / 6.283185307 * CW) % CW) + CW) % CW;
  const c2 = ((Math.round((spin * 1.05 - tGlob * 0.009) / 6.283185307 * CW) % CW) + CW + 341) % CW;
  const nr = nrm, u0a = uv0f, rba = rowBf, cua = cuv0f, cra = crowf;
  const ab = atmBf, aal = aa8, pxi = pixIdx, out = buf32;
  const tR = dRt, tG = dGt, tB = dBt, tS = dSt, tN = dNt, tC = cTt;
  const cAmp = cloudAmp, lAmp = lightsAmp;
  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    const x = nr[i3], y = nr[i3 + 1], z = nr[i3 + 2];
    const d = x * Lx + y * Ly + z * Lz;
    // мягкий терминатор
    let tt = (d + 0.06) * 4.2;
    if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
    const dayF = tt * tt * (3 - 2 * tt);
    const nf = 1 - dayF;
    const u = (u0a[i] - sU + TW) & TMASK;
    const ti = rba[i] + u;
    // облака: два слоя с разным дрейфом → живой, меняющийся покров
    const cu = cua[i], cr = cra[i];
    let cl = tC[cr + ((cu - c1 + CW) & CMASK)] * 0.78
           + tC[cr + ((cu - c2 + CW) & CMASK)] * 0.52 - 66;
    if (cl < 0) cl = 0;
    cl *= cAmp;
    if (cl > 255) cl = 255;
    const cw = cl * 0.00392;
    // тень облаков на поверхности (сдвинутая выборка)
    const csh = tC[cr + ((cu - c1 + 6 + CW) & CMASK)] * cAmp;
    const shad = 1 - (csh > 255 ? 255 : csh) * 0.0011 * dayF;
    // освещение поверхности
    const dl = d > 0 ? d : 0;
    const sunlit = dayF * (0.16 + 0.94 * dl) * shad + 0.035 * nf;
    let r = tR[ti] * sunlit;
    let gg = tG[ti] * sunlit;
    let b = tB[ti] * sunlit;
    // солнечный глинт на океане: компактное яркое ядро + широкий мягкий подпал
    const sd = x * hx + y * hy + z * hz;
    if (sd > 0.8) {
      const s2 = sd * sd, s4 = s2 * s2, s8 = s4 * s4, s16 = s8 * s8;
      const s32 = s16 * s16, s64 = s32 * s32, s128 = s64 * s64, s256 = s128 * s128;
      const cover = tS[ti] * 0.00392 * dayF * (1 - cw * 0.85);
      let core = s256 * s256 * cover;        // ~s^512 — узкий лепесток
      if (core > 0.8) core = 0.8;            // кламп пика: фактура океана под бликом читается
      const spv = core + s32 * 0.13 * cover; // + слабый широкий отсвет
      r += spv * 255; gg += spv * 238; b += spv * 196; // тёплый светло-жёлтый, не белый
    }
    // огни городов на ночной стороне
    if (nf > 0.02) {
      const nl = tN[ti] * nf * lAmp * (1 - cw * 0.9);
      r += nl; gg += nl * 0.7; b += nl * 0.38;
      b += nf * 5; gg += nf * 2; // едва заметная «лунная» синева
    }
    // рассеяние атмосферы у лимба
    const at = ab[i];
    r += at * (26 + dayF * 88);
    gg += at * (48 + dayF * 132);
    b += at * (82 + dayF * 215);
    // облачный слой поверх
    if (cw > 0.004) {
      const cLum = sunlit * 252 + nf * 7;
      const iw = 1 - cw;
      r = r * iw + cLum * cw;
      gg = gg * iw + cLum * 1.02 * cw;
      b = b * iw + (cLum * 1.07 + 4) * cw;
    }
    if (r > 255) r = 255;
    if (gg > 255) gg = 255;
    if (b > 255) b = 255;
    out[pxi[i]] = (aal[i] << 24) | (b << 16) | (gg << 8) | r;
  }
  bctx.putImageData(img, 0, 0);
}

// ---------- атмосферные ореолы (2D-градиенты) ----------
function drawAtmosphere(Lx, Ly, Lz) {
  const sxy = Math.sqrt(Lx * Lx + Ly * Ly);
  const ux = sxy > 0.001 ? Lx / sxy : 0, uy = sxy > 0.001 ? -Ly / sxy : 0; // экранный Y вниз
  // внешнее свечение, смещённое к солнцу
  const gx = cx + ux * R * 0.22 * sxy, gy = cy + uy * R * 0.22 * sxy;
  let g = ctx.createRadialGradient(gx, gy, R * 0.9, gx, gy, R * 1.38);
  const lit = clamp(Lz * 0.5 + 0.62, 0.18, 1);
  g.addColorStop(0, 'rgba(80,140,255,' + (0.34 * lit).toFixed(3) + ')');
  g.addColorStop(0.45, 'rgba(60,110,230,' + (0.13 * lit).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(40,80,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(gx - R * 1.5, gy - R * 1.5, R * 3, R * 3);
}

function drawRim(Lx, Ly, Lz) {
  ctx.globalCompositeOperation = 'lighter';
  // тонкое голубое кольцо по лимбу
  const lit = clamp(Lz * 0.5 + 0.55, 0.12, 1);
  let g = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R * 1.03);
  g.addColorStop(0, 'rgba(90,150,255,0)');
  g.addColorStop(0.82, 'rgba(120,175,255,' + (0.26 * lit).toFixed(3) + ')');
  g.addColorStop(0.95, 'rgba(160,205,255,' + (0.36 * lit).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(120,175,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - R * 1.1, cy - R * 1.1, R * 2.2, R * 2.2);
  // контровое сияние, когда солнце уходит за планету
  const back = sstep(0.35, -0.55, Lz);
  const sxy = Math.sqrt(Lx * Lx + Ly * Ly);
  if (back > 0.01 && sxy > 0.001) {
    const bx = cx + Lx / sxy * R, by = cy - Ly / sxy * R;
    g = ctx.createRadialGradient(bx, by, 0, bx, by, R * 0.85);
    g.addColorStop(0, 'rgba(255,236,200,' + (0.55 * back).toFixed(3) + ')');
    g.addColorStop(0.25, 'rgba(255,200,140,' + (0.22 * back).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,180,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(bx - R, by - R, R * 2, R * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- главный цикл ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  if (!ready) { bakeStep(); return; }
  tGlob += dt;
  if (!paused) spin += dt * spinSpeed * 6.283185307 / 26; // оборот ~26 c
  if (autoSun && !dragging) {
    sunA += dt * 0.16;
    sunB = 0.30 * Math.sin(tGlob * 0.09) + 0.12;
  }
  const cb = Math.cos(sunB);
  const Lx = Math.sin(sunA) * cb, Ly = Math.sin(sunB), Lz = Math.cos(sunA) * cb;

  renderGlobe(Lx, Ly, Lz);

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.drawImage(starCanvas, 0, 0, vw, vh);
  // мерцание ярких звёзд
  ctx.globalCompositeOperation = 'lighter';
  for (const tw of twinkles) {
    const a = 0.18 + 0.4 * (0.5 + 0.5 * Math.sin(tGlob * tw.sp + tw.ph));
    ctx.globalAlpha = a;
    ctx.fillStyle = '#dceaff';
    ctx.fillRect(tw.x - tw.r, tw.y - tw.r, tw.r * 2, tw.r * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  drawAtmosphere(Lx, Ly, Lz);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bufCanvas, cx - R, cy - R, R * 2, R * 2);
  drawRim(Lx, Ly, Lz);

  // «солнышко» при перетаскивании
  if (dragging) {
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(dragX, dragY, 0, dragX, dragY, 26);
    g.addColorStop(0, 'rgba(255,244,200,0.9)');
    g.addColorStop(0.25, 'rgba(255,220,140,0.35)');
    g.addColorStop(1, 'rgba(255,200,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(dragX - 26, dragY - 26, 52, 52);
    ctx.globalCompositeOperation = 'source-over';
  }

  // адаптивное качество: следим за временем кадра
  emaMs = emaMs * 0.94 + dt * 1000 * 0.06;
  qCooldown -= dt;
  if (qCooldown <= 0) {
    if (emaMs > 30 && quality > 0.5) {
      quality = Math.max(0.5, quality * 0.85);
      buildGeometry();
      qCooldown = 2; emaMs = 16;
    } else if (emaMs < 17.5 && quality < 0.999) {
      quality = Math.min(1, quality * 1.1);
      buildGeometry();
      qCooldown = 3; emaMs = 16;
    }
  }
}

// ---------- ввод: перетаскивание солнца ----------
function setSunFromPointer(ex, ey) {
  const dx = (ex - cx) / R, dy = (ey - cy) / R;
  sunA = clamp(dx * 1.35, -2.7, 2.7);
  sunB = clamp(-dy * 1.1, -1.2, 1.2);
  dragX = ex; dragY = ey;
}
canvas.addEventListener('pointerdown', e => {
  dragging = true;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
  autoSun = false;
  autoSunEl.checked = false;
  setSunFromPointer(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', e => {
  if (dragging) setSunFromPointer(e.clientX, e.clientY);
});
function endDrag() { dragging = false; canvas.classList.remove('dragging'); }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---------- панель управления ----------
const pauseBtn = document.getElementById('pauseBtn');
const autoSunEl = document.getElementById('autosun');
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? '▶ Пуск' : '⏸ Пауза';
});
document.getElementById('speed').addEventListener('input', e => {
  spinSpeed = e.target.value / 100;
});
document.getElementById('clouds').addEventListener('input', e => {
  cloudAmp = e.target.value / 100;
});
document.getElementById('lights').addEventListener('input', e => {
  lightsAmp = e.target.value / 100;
});
autoSunEl.addEventListener('change', e => { autoSun = e.target.checked; });

// ---------- размеры и запуск ----------
function sizeCanvas() {
  vw = window.innerWidth; vh = window.innerHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(vw * DPR);
  canvas.height = Math.round(vh * DPR);
  cx = vw / 2;
  cy = vh * 0.485;
  R = Math.min(vw * 0.42, vh * 0.36);
}
window.addEventListener('resize', () => {
  sizeCanvas();
  if (ready) { buildStars(); buildGeometry(); }
});

sizeCanvas();
requestAnimationFrame(frame);

// dual-mode: отладочный доступ к запечённым данным из node-тестов (в браузере не выполняется)
if (typeof module !== 'undefined' && module.exports) {
  module.exports.__debug = {
    TW, TH, CW, CH,
    dRt, dGt, dBt, dSt, dNt, cTt,
    getMask: () => maskA,
    isReady: () => ready
  };
}
