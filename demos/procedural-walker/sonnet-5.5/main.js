/* Идущий человечек — процедурная анимация походки (Claude Sonnet 5.5).
   Canvas 2D, без сборки и внешних ресурсов.

   Устройство:
   1. Модель (чистая логика, метры, y вверх) — шаг симуляции step(S, dt).
      Фаза цикла идёт со скоростью rate(v) = v / длина_шага(v). Каждая нога —
      конечный автомат «опора / перенос». В опоре стопа жёстко привязана к мировой
      координате земли (носок/пятка не двигаются относительно земли — скольжения нет
      по построению). При отрыве стопы рассчитывается дуга переноса к точке
      приземления, которая пересчитывается каждый кадр от живой скорости.
      Высота таза = целевая кривая подпрыгивания, зажатая для опорных ног между «не глубже
      FLEX_MAX в колене» (нет приседа) и «не дальше досягаемости» — поэтому обратная
      кинематика всегда достаёт до привязанной стопы. Стопа в переносе ведётся от голени.
      Руки идут против ног своей стороны: фаза взята из измерения вылета бедра.
   2. Вид (Canvas 2D): параллакс, земля со шкалой в метрах, человечек, диаграмма фаз.
   В node (без document) модуль экспортирует модель — для тестов. */
(function () {
  'use strict';

  /* ===================== утилиты ===================== */
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function frac(x) { return x - Math.floor(x); }
  function hash(n) { var s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function smin(a, b, k) { var h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
  function smax(a, b, k) { var h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }

  /* ===================== геометрия тела (метры) ===================== */
  var THIGH = 0.46, SHIN = 0.46, LEG = THIGH + SHIN;
  var ANKLE_H = 0.07, FOOT_F = 0.15, FOOT_B = 0.05;     // высота голеностопа, носок вперёд, пятка назад
  var TORSO = 0.56, NECK = 0.07, HEAD_R = 0.11;
  var UARM = 0.29, FARM = 0.27;
  var REACH = 0.985 * LEG;                               // предел досягаемости ноги (колено не «выщёлкивает»)
  var VMIN = 0.4, VMAX = 7.5;
  var WORLD0 = 20;                                       // стартовая мировая координата (для шкалы)
  var SWING_A = 1.5;                                     // крутизна начала подъёма стопы в переносе
  var HIP_SOFT = 0.03;                                   // мягкость среза высоты таза досягаемостью ног
  var FLEX_MAX = 0.75;                                   // предел сгиба колена опорной ноги, рад (~43°): глубже таз не садится
  var D_MIN = 2 * THIGH * Math.cos(FLEX_MAX / 2);        // минимальное расстояние таз — голеностоп при этом сгибе

  /* ===================== параметры походки от скорости ===================== */
  function gaitParams(v) {
    var P = { v: v };
    P.S = 0.40 + 0.70 * Math.pow(v, 0.85);                          // длина двойного шага, м
    P.rate = v / P.S;                                               // циклов в секунду
    P.duty = 0.20 + 0.46 * Math.exp(-Math.pow(v / 3.3, 1.6));       // доля опоры: 0.66 (шаг) -> 0.2 (бег)
    P.w = smoothstep(1.6, 3.4, v);                                  // 0 — ходьба, 1 — бег
    P.sp = smoothstep(4.0, 7.5, v);                                 // добавка «спринт»
    var w = P.w, sp = P.sp;
    P.travel = P.duty * P.S;                                        // путь стопы в опоре относительно таза
    // вынос стопы вперёд при касании: на беге 60% пути (стопа в середине опоры чуть впереди таза, голень ближе
    // к вертикали), но не больше 0.40 м — иначе нога стоит слишком наклонно и таз приходится «горбить» над опорой
    P.xF = Math.min(lerp(0.50, 0.60, w) * P.travel, 0.40);
    P.xB = P.travel - P.xF;                                         // отведение стопы назад к отрыву
    // Высота таза: baseH + bounce * cos(4*pi*(фаза - duty/2)) — два «подскока» за цикл, экстремум в середине опоры.
    // Кривая привязана к двум точкам: в касании таз ровно на высоте, которой достаёт вынесенная вперёд
    // нога (hTD), в середине опоры — hMid. Ходьба — маятник: hMid выше hTD (таз всплывает над опорой);
    // бег — hMid чуть ниже hTD, поэтому в полёте таз поднимается на несколько сантиметров, а в опоре
    // его не даёт просесть нижняя граница по сгибу колена (см. step()).
    var hTD = ANKLE_H + Math.sqrt(Math.max(0, REACH * REACH - P.xF * P.xF)) - 0.012 - 0.010 * sp;
    var wH = smoothstep(1.5, 2.6, v);                               // для высоты таза переход к бегу чуть раньше
    var hMid = lerp(0.945, hTD - 0.012, wH);
    P.bounce = (hMid - hTD) / (1 - Math.cos(2 * Math.PI * P.duty));
    P.baseH = hMid - P.bounce;
    P.land = lerp(0.80, 0.97, w);                                   // с какого момента переноса срез таза снова берёт верх над подъёмом стопы
    P.lean = 0.03 + 0.37 * Math.pow(v / VMAX, 1.2);                 // наклон корпуса вперёд, рад
    P.leanOsc = lerp(0.010, 0.030, w);
    P.clear = lerp(0.045, 0.30, w) + 0.07 * sp;                     // подъём стопы в переносе
    P.peak = lerp(0.50, 0.38, w);                                   // где в переносе стопа выше всего
    P.toeOff = lerp(0.55, 0.80, w);                                 // угол отталкивания носком
    P.heelLift = lerp(0.58, 0.48, w);                               // когда в опоре начинается перекат
    P.dorsi = lerp(0.18, 0.30, w);                                  // носок вверх (в мировых осях) перед касанием
    P.pf = lerp(0.25, 1.15, w);                                     // подошвенное сгибание стопы в переносе относительно голени:
                                                                    // 0 — стопа под прямым углом, 1.57 — продолжает голень
    // Руки: размах симметричен относительно корпуса, ближняя рука идёт против ближней ноги.
    // armPh — фаза цикла, в которой бедро ближней ноги максимально вынесено вперёд (измерено на модели):
    // на ходьбе это касание (~1.0), на беге — середина переноса (~0.75-0.8). Рука в этот момент уходит назад.
    P.armPh = 0.75 + 0.235 * Math.exp(-Math.max(v - 1.4, 0) / 1.8);
    P.armAmp = lerp(0.12 + 0.26 * smoothstep(0.4, 1.6, v), 0.70 + 0.12 * sp, w);
    P.armBias = lerp(0.0, 0.04, w);                                 // малый вынос центра размаха вперёд
    P.elbow = lerp(0.20, 1.55, w);                                  // на беге локоть ~90°
    P.elbowK = lerp(0.50, 0.18, w);
    return P;
  }

  /* ===================== кинематика ===================== */
  // Стопа — жёсткий отрезок: пятка (-FOOT_B), носок (+FOOT_F) на высоте ANKLE_H под голеностопом.
  // Угол th > 0 — пятка вверх (поворот по часовой при y вверх). В опоре при th > 0 носок остаётся на земле.
  function stanceAnkle(cx, P, s) {
    var k = s > P.heelLift ? (s - P.heelLift) / (1 - P.heelLift) : 0;
    var th = P.toeOff * Math.pow(k, 1.5);
    var c = Math.cos(th), sn = Math.sin(th);
    var tx = cx + FOOT_F;                                   // носок — точка привязки к земле
    return { x: tx - FOOT_F * c + ANKLE_H * sn, y: FOOT_F * sn + ANKLE_H * c, th: th };
  }

  // Двухзвенная обратная кинематика, колено всегда вперёд.
  function ik(hx, hy, ax, ay, a, b) {
    var dx = ax - hx, dy = ay - hy;
    var d = Math.sqrt(dx * dx + dy * dy);
    var dc = clamp(d, Math.abs(a - b) + 0.01, (a + b) * 0.9995);
    var base = Math.atan2(dy, dx);
    var A = Math.acos(clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1));
    var ang = base + A;
    return {
      kx: hx + a * Math.cos(ang), ky: hy + a * Math.sin(ang),
      ax: hx + dc * Math.cos(base), ay: hy + dc * Math.sin(base),
      err: Math.abs(d - dc)
    };
  }

  /* ===================== симуляция ===================== */
  function newLeg(i, off) {
    return {
      i: i, off: off, p: 0, state: 'stance', cx: 0,
      p0: 0, sx0: 0, sy0: 0, sth0: 0, dx0: 0, dy0: 0,
      ax: 0, ay: ANKLE_H, th: 0, thw: 0, s: 0, u: 0,
      kx: 0, ky: 0, fx: 0, fy: 0, err: 0,
      hlx: 0, hly: 0, tx: 0, ty: 0, mx: 0, my: 0           // пятка, носок и точка крепления стопы (для рисования)
    };
  }

  function addMark(S, leg) { S.marks.push({ x: leg.cx, near: leg.i === 0, t: S.time }); }

  function spawnDust(S, x, n, vxBase) {
    var k = smoothstep(2.4, 5.0, S.v);
    if (k <= 0) return;
    n = Math.round(n * (0.5 + k));
    for (var i = 0; i < n && S.dust.length < 90; i++) {
      var life = 0.35 + Math.random() * 0.4;
      S.dust.push({
        x: x + (Math.random() - 0.3) * 0.12, y: 0.012,
        vx: vxBase + (Math.random() - 0.5) * 0.9,
        vy: 0.35 + Math.random() * 1.1,
        life: life, max: life, r: 0.014 + Math.random() * 0.03, a: 0.25 + 0.3 * k
      });
    }
  }

  function initLeg(S, leg) {
    var P = S.P, p = frac(S.phase + leg.off);
    leg.p = p;
    if (p < P.duty) {
      leg.state = 'stance';
      leg.cx = S.hipWX + P.xF - P.travel * (p / P.duty);
      addMark(S, leg);
    } else {
      var cxl = S.hipWX - S.v * ((p - P.duty) / P.rate) - P.xB;
      var a = stanceAnkle(cxl, P, 1);
      leg.state = 'swing';
      leg.p0 = P.duty; leg.sx0 = a.x; leg.sy0 = a.y; leg.sth0 = a.th;
    }
  }

  function createSim(v0) {
    var S = {
      v: v0, vTarget: v0, phase: 0, hipWX: WORLD0, time: 0,
      P: gaitParams(v0), hipY: 0.9, lean: 0.05,
      legs: [newLeg(0, 0), newLeg(1, 0.5)],
      marks: [], dust: [], arms: [], neck: null, shoulder: null, head: null,
      stats: { touchdowns: 0, liftoffs: 0, early: 0 }
    };
    initLeg(S, S.legs[0]);
    initLeg(S, S.legs[1]);
    return S;
  }

  function liftoff(S, leg, p, early) {
    var P = S.P;
    var s = clamp(p / P.duty, 0, 1);
    var a = stanceAnkle(leg.cx, P, s);
    leg.state = 'swing';
    leg.p0 = Math.min(p, 0.9);
    leg.sx0 = a.x; leg.sy0 = a.y; leg.sth0 = a.th;
    // скорость голеностопа в момент отрыва переходит в перенос без излома (эрмитов член в poseLeg)
    var ds = 0.02, a0 = stanceAnkle(leg.cx, P, Math.max(0, s - ds)), a1 = stanceAnkle(leg.cx, P, Math.min(1, s + ds));
    var span = Math.min(1, s + ds) - Math.max(0, s - ds);
    var tsw = (1 - leg.p0) / P.rate, k = tsw * P.rate / P.duty / span;
    leg.dx0 = (a1.x - a0.x) * k; leg.dy0 = (a1.y - a0.y) * k;
    S.stats.liftoffs++;
    if (early) S.stats.early++;
    if (S.v > 4) spawnDust(S, leg.cx + FOOT_F, 2, -0.6 * S.v * 0.35);
  }

  function touchdown(S, leg, p) {
    var P = S.P;
    leg.state = 'stance';
    // стопа приземляется в точке, которую переносящая нога «целила» все кадры
    leg.cx = S.hipWX - S.v * (p / P.rate) + P.xF;
    S.stats.touchdowns++;
    addMark(S, leg);
    spawnDust(S, leg.cx + 0.05, 2 + Math.floor(S.v * 0.5), -0.2);
  }

  function advanceLeg(S, leg) {
    var P = S.P;
    var p = frac(S.phase + leg.off);
    if (p < leg.p) {                                  // фаза перешла через 1 — касание
      if (leg.state === 'stance') liftoff(S, leg, 1, true);
      touchdown(S, leg, p);
    } else if (leg.state === 'stance') {
      // конец опоры — по фазе; страховка — стопа слишком далеко позади таза (резкий разгон)
      var early = (leg.cx - S.hipWX) < -0.60;
      if (p >= P.duty || early) liftoff(S, leg, p, early && p < P.duty);
    }
    leg.p = p;
  }

  function poseLeg(S, leg) {
    var P = S.P, p = leg.p;
    if (leg.state === 'stance') {
      var s = clamp(p / P.duty, 0, 1);
      var a = stanceAnkle(leg.cx, P, s);
      leg.ax = a.x; leg.ay = a.y; leg.thw = a.th; leg.s = s; leg.u = 0;
    } else {
      var u = clamp((p - leg.p0) / (1 - leg.p0), 0, 1);
      var trem = Math.max(0, (1 - p) / P.rate);               // сколько осталось до касания
      var x1 = S.hipWX + S.v * trem + P.xF;                   // живая точка приземления (мировая)
      var e = u * u * (3 - 2 * u);
      var hv = u * (1 - u) * (1 - u);                         // эрмитов член: наследует скорость отрыва
      var x = leg.sx0 + (x1 - leg.sx0) * e + leg.dx0 * hv;
      var b = lerp(leg.sy0, ANKLE_H, smoothstep(0, 0.8, u));
      // колокол подъёма стопы u^a (1-u)^bb с пиком в P.peak: нулевая скорость в начале и в конце
      var bb = SWING_A * (1 - P.peak) / P.peak;
      var bell = Math.pow(u, SWING_A) * Math.pow(1 - u, bb) / (Math.pow(P.peak, SWING_A) * Math.pow(1 - P.peak, bb));
      var y = b + P.clear * bell + leg.dy0 * hv;
      // угол стопы в мировых осях: от угла отталкивания к плоской постановке, перед касанием носок вверх.
      // Это «посадочная» часть; в середине переноса стопа ведётся от голени (см. solveBody)
      var th = leg.sth0 * (1 - smoothstep(0, 0.55, u)) - P.dorsi * Math.sin(Math.PI * clamp((u - 0.55) / 0.45, 0, 1));
      leg.ax = x; leg.ay = y; leg.thw = th; leg.s = 0; leg.u = u;
    }
  }

  function updateDust(S, dt) {
    for (var i = S.dust.length - 1; i >= 0; i--) {
      var d = S.dust[i];
      d.life -= dt;
      if (d.life <= 0) { S.dust.splice(i, 1); continue; }
      d.vy -= 5 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.y < 0) { d.y = 0; d.vy *= -0.2; d.vx *= 0.5; }
    }
  }

  // Стопа. В опоре — угол переката (leg.thw). В переносе середина движения ведётся от голени:
  // стопа продолжает голень с небольшим тыльным сгибанием (P.pf), а к касанию плавно возвращается
  // к «посадочному» углу leg.thw (носок вперёд-вверх, затем плашмя). Угол стопы на положение голеностопа
  // не влияет, поэтому порядок «сначала IK, потом стопа» безопасен.
  function poseFoot(leg, P) {
    var th = leg.thw, k = 1;
    if (leg.state === 'swing') {
      var lam = smoothstep(0, 0.2, leg.u) * (1 - smoothstep(0.7, 0.98, leg.u));
      var bs = Math.atan2(leg.fy - leg.ky, leg.fx - leg.kx);      // направление голени (колено -> голеностоп)
      if (bs > Math.PI / 2) bs -= 2 * Math.PI;                    // непрерывная ветка угла для голени, ушедшей назад-вверх
      th = lerp(th, P.pf - bs - Math.PI / 2, lam);
      k = 1 - 0.75 * lam;                                         // стопа «прижимается» к оси голени, без Т-образного уступа
    }
    var c = Math.cos(th), s = Math.sin(th), hh = ANKLE_H * k;
    leg.hlx = leg.fx - FOOT_B * c - hh * s; leg.hly = leg.fy + FOOT_B * s - hh * c;
    leg.tx = leg.fx + FOOT_F * c - hh * s;  leg.ty = leg.fy - FOOT_F * s - hh * c;
    leg.mx = leg.fx - hh * s;               leg.my = leg.fy - hh * c;
    leg.th = th;
    return th;
  }

  function solveBody(S) {
    var P = S.P, hx = S.hipWX, hy = S.hipY, i;
    for (i = 0; i < 2; i++) {
      var leg = S.legs[i];
      var r = ik(hx, hy, leg.ax, leg.ay, THIGH, SHIN);
      leg.kx = r.kx; leg.ky = r.ky; leg.fx = r.ax; leg.fy = r.ay; leg.err = r.err;
      poseFoot(leg, P);
      if (leg.state === 'swing') {
        // стопа в переносе не заходит под землю: если задела, поднимаем голеностоп и решаем ногу заново
        var low = Math.min(leg.hly, leg.ty);
        if (low < 0) {
          leg.ay += -low;
          r = ik(hx, hy, leg.ax, leg.ay, THIGH, SHIN);
          leg.kx = r.kx; leg.ky = r.ky; leg.fx = r.ax; leg.fy = r.ay; leg.err = r.err;
          poseFoot(leg, P);
        }
      }
    }
    var dx = Math.sin(S.lean), dy = Math.cos(S.lean);
    S.neck = { x: hx + TORSO * dx, y: hy + TORSO * dy };
    S.shoulder = { x: hx + 0.93 * TORSO * dx, y: hy + 0.93 * TORSO * dy };
    var hl = S.lean * 0.35;                                   // голова держится ровнее корпуса
    var tx = S.neck.x + NECK * Math.sin(hl), ty = S.neck.y + NECK * Math.cos(hl);
    S.head = { x: tx + HEAD_R * Math.sin(hl), y: ty + HEAD_R * Math.cos(hl), a: hl };
    // Руки в противофазе ногам: рука той же стороны уходит назад, когда бедро этой ноги вынесено вперёд.
    // Размах симметричен относительно оси корпуса (центр — наклон корпуса + малый вынос вперёд).
    var ca = Math.cos(2 * Math.PI * (S.phase - P.armPh));
    var ctr = P.lean + P.armBias;
    var ang = [ctr - P.armAmp * ca, ctr + P.armAmp * ca];
    S.arms = [];
    for (i = 0; i < 2; i++) {
      var t = ang[i];
      var e = Math.max(0.12, P.elbow + P.elbowK * (t - ctr)); // вперёд — локоть сгибается чуть сильнее
      var ex = S.shoulder.x + UARM * Math.sin(t), ey = S.shoulder.y - UARM * Math.cos(t);
      var f = t + e;
      S.arms.push({ ex: ex, ey: ey, wx: ex + FARM * Math.sin(f), wy: ey - FARM * Math.cos(f) });
    }
  }

  function step(S, dt) {
    S.vTarget = clamp(S.vTarget, VMIN, VMAX);
    S.v += (S.vTarget - S.v) * (1 - Math.exp(-dt / 0.35));    // плавная смена характера
    var P = gaitParams(S.v);
    S.P = P;
    S.phase = frac(S.phase + P.rate * dt);
    S.hipWX += S.v * dt;
    S.time += dt;
    var i;
    for (i = 0; i < 2; i++) advanceLeg(S, S.legs[i]);
    for (i = 0; i < 2; i++) poseLeg(S, S.legs[i]);

    // таз: целевая кривая подпрыгивания, зажатая между двумя границами для каждой опорной ноги:
    // снизу — колено не сгибается глубже FLEX_MAX (нет приседа), сверху — досягаемость ноги (нет «растяжки»)
    var hy = P.baseH + P.bounce * Math.cos(4 * Math.PI * (S.phase - P.duty / 2));
    var leg, dx, reach;
    for (i = 0; i < 2; i++) {
      leg = S.legs[i];
      if (leg.state !== 'stance') continue;
      // нижняя граница считается по стопе «плашмя» (точка привязки cx, голеностоп на ANKLE_H), а не по реальному
      // голеностопу: при перекате на носок голеностоп поднят, и граница толкала бы таз вверх, а в момент отрыва
      // роняла бы его скачком
      dx = leg.cx - S.hipWX;
      var fl = smax(hy, ANKLE_H + Math.sqrt(Math.max(0, D_MIN * D_MIN - dx * dx)), HIP_SOFT + 0.01);
      hy = lerp(fl, hy, smoothstep(0.80, 1.0, leg.s));          // перед отрывом граница плавно отпускает таз
    }
    for (i = 0; i < 2; i++) {
      leg = S.legs[i];
      if (leg.state !== 'stance') continue;
      dx = leg.ax - S.hipWX;
      hy = smin(hy, leg.ay + Math.sqrt(Math.max(0, REACH * REACH - dx * dx)), HIP_SOFT);
    }
    // переносимая нога, вынесенная далеко вперёд, подбирает стопу выше, а не роняет таз;
    // к касанию (u -> 1) подъём сходит на нет и всю нагрузку берёт срез таза — как у опорной ноги,
    // поэтому в момент касания скачка нет
    for (i = 0; i < 2; i++) {
      leg = S.legs[i];
      if (leg.state !== 'swing') continue;
      dx = leg.ax - S.hipWX;
      reach = Math.sqrt(Math.max(0, REACH * REACH - dx * dx));
      var drop = hy - smin(hy, leg.ay + reach, HIP_SOFT);        // насколько пришлось бы опустить таз
      hy -= drop * smoothstep(P.land, 1, leg.u);
      if (hy - reach > leg.ay) leg.ay = hy - reach;              // остаток закрывается подъёмом стопы
    }
    S.hipY = Math.max(hy, 0.55);
    S.lean = P.lean + P.leanOsc * Math.cos(4 * Math.PI * (S.phase - P.duty / 2));

    solveBody(S);
    updateDust(S, dt);
    while (S.marks.length && S.time - S.marks[0].t > 4.2) S.marks.shift();
  }

  function prerun(S, seconds) {
    var n = Math.round(seconds * 120);
    for (var i = 0; i < n; i++) step(S, 1 / 120);
    S.dust.length = 0;
  }

  /* ===================== экспорт для node ===================== */
  if (typeof document === 'undefined') {
    module.exports = {
      createSim: createSim, step: step, prerun: prerun, gaitParams: gaitParams,
      C: { THIGH: THIGH, SHIN: SHIN, LEG: LEG, ANKLE_H: ANKLE_H, FOOT_F: FOOT_F, FOOT_B: FOOT_B, REACH: REACH }
    };
    return;
  }

  /* ===================== вид ===================== */
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var panel = document.getElementById('panel');
  var elSpeed = document.getElementById('speed');
  var elSpeedOut = document.getElementById('speedOut');
  var elStatMain = document.getElementById('statMain');
  var elStatSub = document.getElementById('statSub');
  var btnAuto = document.getElementById('btnAuto');
  var btnMarks = document.getElementById('btnMarks');
  var btnPause = document.getElementById('btnPause');
  var presets = Array.prototype.slice.call(document.querySelectorAll('.preset'));

  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  var NEAR = '#fff1d6', NEAR_J = '#ffb15e', FAR = '#9d92d8', FAR_J = '#7d72c0';

  var S = createSim(1.6);
  prerun(S, 3.2);
  var ui = { auto: false, autoT: 0, paused: false, marks: true };

  var DPR = 1, W = 800, H = 600, scale = 200, gy = 400, figX = 360, skyGrad = null, groundGrad = null;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    var panelH = panel.offsetHeight || 130;
    gy = Math.min(H * 0.72, H - panelH - 36);
    gy = Math.max(gy, H * 0.45);
    scale = Math.max(40, Math.min(H * 0.30, W / 3.8, (gy - 96) / 1.95));
    figX = W * 0.46;
    skyGrad = ctx.createLinearGradient(0, 0, 0, gy);
    skyGrad.addColorStop(0, '#0f1838');
    skyGrad.addColorStop(0.5, '#3a3270');
    skyGrad.addColorStop(0.82, '#b4607f');
    skyGrad.addColorStop(1, '#f3a672');
    groundGrad = ctx.createLinearGradient(0, gy, 0, H);
    groundGrad.addColorStop(0, '#2b2549');
    groundGrad.addColorStop(1, '#14102a');
  }

  function X(wx) { return figX + (wx - S.hipWX) * scale; }
  var liftPx = 0;                                   // приподнимаем фигуру на полтолщины линии, чтобы стопы стояли НА земле
  function Y(wy) { return gy - wy * scale - liftPx; }

  /* ---------- фон ---------- */
  function ridge(par, baseF, comps, color) {
    var off = S.hipWX * par * scale;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, gy + 1);
    for (var x = 0; x <= W + 8; x += 8) {
      var xp = x + off, h = baseF * H;
      for (var k = 0; k < comps.length; k++) h += comps[k][0] * H * Math.sin(xp * comps[k][1] + comps[k][2]);
      ctx.lineTo(x, gy - h);
    }
    ctx.lineTo(W + 8, gy + 1);
    ctx.closePath();
    ctx.fill();
  }

  function pine(x, y, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x - h * 0.025, y - h * 0.14, h * 0.05, h * 0.14);
    for (var k = 0; k < 3; k++) {
      var by = y - h * 0.08 - k * h * 0.26, tw = h * (0.40 - k * 0.09), th = h * 0.40;
      ctx.beginPath();
      ctx.moveTo(x - tw / 2, by); ctx.lineTo(x + tw / 2, by); ctx.lineTo(x, by - th);
      ctx.closePath();
      ctx.fill();
    }
  }

  function trees(par, gap, hMin, hMax, color, seed) {
    var off = S.hipWX * par * scale;
    var i0 = Math.floor((off - 80) / gap), i1 = Math.ceil((off + W + 80) / gap);
    for (var i = i0; i <= i1; i++) {
      var r = hash(i * 3.1 + seed), r2 = hash(i * 7.7 + seed + 5);
      if (r < 0.28) continue;
      pine(i * gap + (r2 - 0.5) * gap * 0.6 - off, gy + 2, lerp(hMin, hMax, r2) * scale, color);
    }
  }

  function drawSky() {
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, gy + 1);
    var i;
    for (i = 0; i < 46; i++) {
      var sx = hash(i * 1.7) * W, sy = hash(i * 4.1 + 9) * gy * 0.55;
      ctx.globalAlpha = (0.25 + 0.6 * hash(i * 9.3)) * (1 - sy / (gy * 0.6));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx, sy, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
    var sx0 = W * 0.80, sy0 = gy - H * 0.24, sr = Math.max(24, H * 0.06);
    var g = ctx.createRadialGradient(sx0, sy0, sr * 0.2, sx0, sy0, sr * 4.4);
    g.addColorStop(0, 'rgba(255,214,160,0.55)');
    g.addColorStop(1, 'rgba(255,170,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx0 - sr * 4.4, sy0 - sr * 4.4, sr * 8.8, sr * 8.8);
    ctx.fillStyle = '#ffe3b8';
    ctx.beginPath(); ctx.arc(sx0, sy0, sr, 0, Math.PI * 2); ctx.fill();
    // облака
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (i = 0; i < 4; i++) {
      var span = W + 360;
      var cx = ((hash(i * 2.3) * span + S.time * (5 + 5 * hash(i + 4)) - S.hipWX * 0.02 * scale) % span + span) % span - 180;
      var cy = gy * (0.14 + 0.26 * hash(i * 6.1)), cw = 90 + 80 * hash(i * 1.9);
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw, cw * 0.13, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + cw * 0.35, cy - cw * 0.08, cw * 0.55, cw * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ridge(0.03, 0.20, [[0.10, 0.0042, 1.0], [0.06, 0.0105, 2.5], [0.03, 0.021, 0.3]], '#4a3f86');
    ridge(0.08, 0.10, [[0.045, 0.0065, 4.0], [0.025, 0.016, 1.1]], '#312a63');
    trees(0.22, 130, 0.55, 1.05, '#251f50', 2);
    trees(0.55, 240, 1.0, 1.7, '#16122e', 9);
  }

  /* ---------- земля ---------- */
  function drawGround() {
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, gy, W, H - gy);
    var x0m = S.hipWX - figX / scale, x1m = S.hipWX + (W - figX) / scale;
    var i, m, x;
    // полосы по метру — хорошо видно движение земли
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (m = Math.floor(x0m); m <= Math.ceil(x1m); m++) {
      if (m % 2 === 0) ctx.fillRect(X(m), gy, scale, H - gy);
    }
    // камешки
    for (i = Math.floor(x0m / 0.41) - 1; i <= Math.ceil(x1m / 0.41) + 1; i++) {
      var r = hash(i * 3.3);
      if (r < 0.5) continue;
      var px = X(i * 0.41 + hash(i * 1.3) * 0.3), py = gy + (0.03 + 0.2 * hash(i * 5.7)) * scale;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.06 + 0.08 * hash(i * 8.1)) + ')';
      ctx.beginPath();
      ctx.ellipse(px, py, (0.012 + 0.03 * r) * scale, (0.006 + 0.012 * r) * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // шкала: деления по 0,5 м, подписи через 5 м
    ctx.lineWidth = 1.5;
    ctx.font = '11px ' + FONT;
    ctx.textAlign = 'center';
    for (i = Math.floor(x0m * 2); i <= Math.ceil(x1m * 2); i++) {
      m = i / 2;
      x = X(m);
      var whole = i % 2 === 0;
      ctx.strokeStyle = whole ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x, gy + (whole ? 0.09 : 0.05) * scale);
      ctx.stroke();
      if (whole && m % 5 === 0) {
        ctx.fillStyle = 'rgba(230,222,255,0.55)';
        ctx.fillText(m + ' м', x, gy + 0.2 * scale + 6);
      }
    }
    ctx.textAlign = 'left';
    ctx.strokeStyle = '#8277c4';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }

  function drawStreaks() {
    var k = smoothstep(3.2, 7.0, S.v);
    if (k <= 0.01) return;
    var spanM = W / scale + 4;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    for (var i = 0; i < 14; i++) {
      var xm = ((hash(i * 2.1) * spanM - S.hipWX * 1.8 + i * 3.3) % spanM + spanM) % spanM - 2;
      var y = gy - (0.25 + hash(i * 5.3) * 1.8) * scale;
      var len = (0.4 + hash(i * 7.9) * 1.0) * scale * (0.5 + k);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.22 * k * (0.5 + 0.5 * hash(i * 3.7))) + ')';
      ctx.beginPath(); ctx.moveTo(xm * scale, y); ctx.lineTo(xm * scale + len, y); ctx.stroke();
    }
  }

  /* ---------- метки опоры ---------- */
  function drawMarks() {
    if (!ui.marks) return;
    var i, m, a, x;
    for (i = 0; i < S.marks.length; i++) {
      m = S.marks[i];
      a = clamp(1 - (S.time - m.t) / 4.2, 0, 1) * 0.5;
      x = X(m.x + 0.05);
      ctx.fillStyle = m.near ? 'rgba(255,184,107,' + a + ')' : 'rgba(157,146,216,' + a + ')';
      ctx.beginPath();
      ctx.ellipse(x, gy + 0.018 * scale, 0.105 * scale, 0.014 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (i = 0; i < 2; i++) {
      var leg = S.legs[i];
      if (leg.state !== 'stance') continue;
      ctx.strokeStyle = i === 0 ? '#ffd9a6' : '#c9c1f2';
      ctx.beginPath();
      if (leg.s < S.P.heelLift) {                    // стопа плашмя: пятка и носок на земле
        ctx.moveTo(X(leg.cx - FOOT_B), gy); ctx.lineTo(X(leg.cx + FOOT_F), gy);
      } else {                                       // перекат: опора на носок
        ctx.moveTo(X(leg.cx + FOOT_F - 0.03), gy); ctx.lineTo(X(leg.cx + FOOT_F), gy);
      }
      ctx.stroke();
    }
  }

  /* ---------- человечек ---------- */
  function line(pts, color, lw) {
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
    for (var i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
    ctx.stroke();
  }
  function dot(wx, wy, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(X(wx), Y(wy), r, 0, Math.PI * 2); ctx.fill();
  }

  function drawLeg(leg, color, jcol, lw) {
    var fx = leg.fx, fy = leg.fy;                               // стопа посчитана в модели (poseFoot)
    line([[S.hipWX, S.hipY], [leg.kx, leg.ky], [fx, fy], [leg.mx, leg.my]], color, lw);
    line([[leg.hlx, leg.hly], [leg.tx, leg.ty]], color, lw * 0.9);
    dot(leg.kx, leg.ky, lw * 0.62, jcol);
    dot(fx, fy, lw * 0.45, jcol);
  }

  function drawArm(arm, color, jcol, lw) {
    line([[S.shoulder.x, S.shoulder.y], [arm.ex, arm.ey], [arm.wx, arm.wy]], color, lw);
    dot(arm.ex, arm.ey, lw * 0.58, jcol);
    dot(arm.wx, arm.wy, lw * 0.62, color);
  }

  function drawFigure() {
    var lw = Math.max(4, 0.052 * scale);
    liftPx = lw * 0.45;
    // тень под человечком: уже и бледнее, когда таз высоко (полёт)
    var air = clamp((S.hipY - 0.8) / 0.2, 0, 1);
    ctx.fillStyle = 'rgba(6,4,20,' + (0.38 - 0.15 * air) + ')';
    ctx.beginPath();
    ctx.ellipse(figX - 0.04 * scale, gy + 0.025 * scale, (0.42 - 0.06 * air) * scale, 0.04 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    drawArm(S.arms[1], FAR, FAR_J, lw * 0.8);
    drawLeg(S.legs[1], FAR, FAR_J, lw * 0.85);

    line([[S.hipWX, S.hipY], [S.neck.x, S.neck.y]], NEAR, lw * 1.15);
    line([[S.neck.x, S.neck.y], [S.head.x - HEAD_R * Math.sin(S.head.a), S.head.y - HEAD_R * Math.cos(S.head.a)]], NEAR, lw * 0.8);
    dot(S.hipWX, S.hipY, lw * 0.75, NEAR_J);
    ctx.fillStyle = NEAR;
    ctx.beginPath(); ctx.arc(X(S.head.x), Y(S.head.y), HEAD_R * scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a2447';
    ctx.beginPath(); ctx.arc(X(S.head.x + 0.05), Y(S.head.y + 0.018), Math.max(1.8, 0.014 * scale), 0, Math.PI * 2); ctx.fill();
    dot(S.shoulder.x, S.shoulder.y, lw * 0.6, NEAR_J);

    drawLeg(S.legs[0], NEAR, NEAR_J, lw);
    drawArm(S.arms[0], NEAR, NEAR_J, lw * 0.9);
  }

  function drawDust() {
    for (var i = 0; i < S.dust.length; i++) {
      var d = S.dust[i];
      ctx.fillStyle = 'rgba(236,220,196,' + (d.a * d.life / d.max) + ')';
      ctx.beginPath(); ctx.arc(X(d.x), gy - d.y * scale, Math.max(1, d.r * scale), 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ---------- диаграмма фаз ---------- */
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function drawGaitDiagram() {
    if (W < 820) return;
    var bw = 262, bh = 108, x = W - bw - 18, y = 16, i;
    ctx.fillStyle = 'rgba(20,17,44,0.52)';
    rr(x, y, bw, bh, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f6f1ff'; ctx.font = '600 12px ' + FONT;
    ctx.fillText('Фазы шага', x + 14, y + 22);
    ctx.fillStyle = '#b9b0d9'; ctx.font = '11px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText('опора ' + Math.round(S.P.duty * 100) + '%', x + bw - 14, y + 22);
    ctx.textAlign = 'left';
    var bx = x + 58, bwid = bw - 72, d = S.P.duty;
    for (i = 0; i < 2; i++) {
      var ry = y + 36 + i * 24;
      ctx.fillStyle = '#b9b0d9'; ctx.font = '11px ' + FONT;
      ctx.fillText(i === 0 ? 'прав.' : 'лев.', x + 14, ry + 12);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      rr(bx, ry, bwid, 16, 4); ctx.fill();
      ctx.fillStyle = i === 0 ? '#ffb86b' : '#9d92d8';
      rr(bx, ry, bwid * d, 16, 4); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx + bwid * S.legs[i].p - 1, ry - 3, 2, 22);
    }
    var ly = y + bh - 14;
    ctx.fillStyle = '#ffb86b'; ctx.fillRect(bx, ly - 8, 10, 10);
    ctx.fillStyle = '#b9b0d9'; ctx.fillText('опора', bx + 15, ly + 1);
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(bx + 72, ly - 8, 10, 10);
    ctx.fillStyle = '#b9b0d9'; ctx.fillText('перенос', bx + 87, ly + 1);
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSky();
    drawGround();
    drawStreaks();
    drawMarks();
    drawFigure();
    drawDust();
    drawGaitDiagram();
  }

  /* ---------- HUD и управление ---------- */
  function fmt(x, n) { return x.toFixed(n).replace('.', ','); }

  function modeName(v) {
    if (v < 0.9) return 'медленная ходьба';
    if (v < 1.8) return 'ходьба';
    if (v < 2.7) return 'переход к бегу';
    if (v < 4.2) return 'трусца';
    if (v < 6.2) return 'бег';
    return 'спринт';
  }

  var lastHud = -1e9;
  function updateHud(now, force) {
    if (!force && now - lastHud < 120) return;
    lastHud = now;
    var P = S.P, n = (S.legs[0].state === 'stance' ? 1 : 0) + (S.legs[1].state === 'stance' ? 1 : 0);
    var sup = n === 2 ? 'двойная опора' : (n === 1 ? 'одиночная опора' : 'полётная фаза');
    elStatMain.textContent = fmt(S.v, 1) + ' м/с · ' + modeName(S.v);
    elStatSub.textContent = 'шаг ' + fmt(P.S / 2, 2) + ' м · ' + Math.round(P.rate * 120) + ' шаг/мин · ' + sup;
    elSpeedOut.textContent = fmt(S.vTarget, 1) + ' м/с';
    if (document.activeElement !== elSpeed || ui.auto) elSpeed.value = S.vTarget;
    for (var i = 0; i < presets.length; i++) {
      presets[i].classList.toggle('active', Math.abs(parseFloat(presets[i].getAttribute('data-v')) - S.vTarget) < 0.12);
    }
  }

  function setToggle(btn, on) {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function setAuto(on) {
    ui.auto = on;
    if (on) {                                   // продолжаем с текущей скорости вверх по «косинусу»
      var k = clamp(1 - 2 * (S.vTarget - 0.8) / 6.4, -1, 1);
      ui.autoT = Math.acos(k) / (2 * Math.PI) * 38;
    }
    setToggle(btnAuto, on);
  }
  function setPaused(on) { ui.paused = on; setToggle(btnPause, on); }
  function setMarks(on) { ui.marks = on; setToggle(btnMarks, on); }

  elSpeed.addEventListener('input', function () {
    S.vTarget = parseFloat(elSpeed.value);
    setAuto(false);
    updateHud(0, true);
  });
  presets.forEach(function (b) {
    b.addEventListener('click', function () {
      S.vTarget = parseFloat(b.getAttribute('data-v'));
      elSpeed.value = S.vTarget;
      setAuto(false);
      updateHud(0, true);
    });
  });
  btnAuto.addEventListener('click', function () { setAuto(!ui.auto); });
  btnMarks.addEventListener('click', function () { setMarks(!ui.marks); });
  btnPause.addEventListener('click', function () { setPaused(!ui.paused); });
  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON') return;
    if (e.key === ' ') { setPaused(!ui.paused); e.preventDefault(); }
    else if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') setMarks(!ui.marks);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { S.vTarget = clamp(S.vTarget + 0.25, VMIN, VMAX); setAuto(false); updateHud(0, true); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { S.vTarget = clamp(S.vTarget - 0.25, VMIN, VMAX); setAuto(false); updateHud(0, true); e.preventDefault(); }
  });

  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(panel);
  resize();
  elSpeed.value = S.vTarget;
  updateHud(0, true);

  var last = 0;
  function frame(now) {
    var dt = last ? (now - last) / 1000 : 0;
    last = now;
    dt = clamp(dt, 0, 0.05);                                  // кламп большого dt (фоновая вкладка)
    if (!ui.paused && dt > 0) {
      if (ui.auto) {
        ui.autoT += dt;
        S.vTarget = 0.8 + 6.4 * (0.5 - 0.5 * Math.cos(2 * Math.PI * ui.autoT / 38));
      }
      var rem = dt;
      while (rem > 1e-6) {
        var h = Math.min(rem, 1 / 120);
        step(S, h);
        rem -= h;
      }
    }
    render();
    updateHud(now, false);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
