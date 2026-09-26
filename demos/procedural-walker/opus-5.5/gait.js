/* gait.js — процедурная модель походки (чистая логика, без DOM).
 * Система координат модели: метры, x — вперёд по ходу, y — вверх от земли.
 * Горизонтальные координаты позы — относительно «базы» тела s (пройденная дистанция),
 * опорные стопы хранят мировую координату точки касания, поэтому не скользят.
 * Dual-mode: в браузере кладёт API в window.Gait, в node — module.exports. */
(function (root) {
  'use strict';

  var DEG = Math.PI / 180;

  // Антропометрия фигуры ~1.8 м
  var B = {
    thigh: 0.45, shin: 0.44,          // бедро, голень
    ankleFwd: 0.05, ankleUp: 0.075,   // голеностоп относительно пятки
    footLen: 0.25,                    // пятка → носок
    torso: 0.50, neck: 0.075, headR: 0.115,
    upperArm: 0.29, foreArm: 0.28,
    hipSpread: 0.035,                 // вынос тазобедренного сустава при повороте таза
    shoulderSpread: 0.045             // вынос плеча при контр-повороте плечевого пояса
  };
  var REACH = 0.995 * (B.thigh + B.shin);   // рабочая длина ноги (чуть меньше полной)
  var V_MIN = 0.5, V_MAX = 6.0;
  var V_WALK_END = 1.9, V_RUN_FULL = 2.7;   // зона плавного перехода ходьба → бег

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  // Полиномиальный smooth-min (всегда <= min(a, b))
  function smin(a, b, k) {
    var h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
    return lerp(b, a, h) - k * h * (1 - h);
  }
  function bez(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  }

  /* Параметры походки как гладкие функции скорости v (м/с).
   * g — «характер» походки: 0 — ходьба, 1 — бег. */
  function gaitParams(v, P) {
    P = P || {};
    var g = smoothstep(V_WALK_END, V_RUN_FULL, v);
    var f = lerp(0.60 + 0.26 * v, 1.22 + 0.055 * v, g);      // частота цикла (2 шага), Гц
    var beta = lerp(0.655 - 0.035 * v, 0.43 - 0.028 * v, g);  // доля цикла в опоре
    var L = v / f;                                             // длина цикла (2 шага), м
    P.v = v; P.g = g; P.f = f; P.beta = beta; P.L = L;
    P.c = lerp(0.0, -0.2, g);                  // центр опоры голеностопа относительно таза
    P.thStrike = lerp(18, 3, g) * DEG;         // стопа при касании: носок вверх (удар пяткой)
    P.thOff = lerp(-38, -46, g) * DEG;         // стопа при отрыве: перекат на носок
    P.heelOff = lerp(0.52, 0.36, g);           // доля опоры, когда отрывается пятка
    P.h1 = lerp(0.02 + 0.01 * v, 0.30 + 0.10 * v, g);   // подъём стопы в начале переноса (захлёст)
    P.h2 = lerp(0.03, 0.12 + 0.04 * v, g);               // подъём перед постановкой
    P.match = lerp(0.85, 0.9, g);              // согласование скорости стопы с землёй (отрыв)
    P.matchEnd = lerp(0.85, 0.7, g);           // то же при постановке: на беге меньше «выноса» вперёд
    // досягаемость при постановке: на беге колено в касании согнуто ~20–25°
    P.reachLand = lerp(REACH, 0.978 * (B.thigh + B.shin), g);
    P.hipH = lerp(0.95, 0.945 - 0.002 * v, g); // желаемая высота таза
    P.bobAmp = lerp(0.008, -(0.03 + 0.003 * v), g);   // ходьба: вверх в середине опоры; бег: вниз
    P.lean = (lerp(2, 4, g) + 1.2 * v) * DEG;  // наклон корпуса растёт со скоростью
    P.armAmp = lerp(10 + 11 * v, 14 + 3 * v, g) * DEG;   // на беге мах компактнее
    P.armBase = lerp(2, 4, g) * DEG;
    P.elbowBase = (12 + 7 * v) * DEG;          // локоть при ходьбе (бег — см. solve)
    P.elbowSwing = 14 * DEG;
    P.tdX = P.c - B.ankleFwd + beta * L / 2;   // пятка «плоской» стопы в момент касания
    return P;
  }

  /* Поза опорной стопы: hx — где лежит пятка плоской стопы, th — наклон.
   * th >= 0: перекат через пятку (пятка неподвижна); th < 0: перекат через носок. */
  function footPose(hx, th, o) {
    var c = Math.cos(th), s = Math.sin(th);
    if (th >= 0) { o.hx = hx; o.hy = 0; }
    else { o.hx = hx + B.footLen - B.footLen * c; o.hy = -B.footLen * s; }
    o.tx = o.hx + B.footLen * c; o.ty = o.hy + B.footLen * s;
    o.ax = o.hx + B.ankleFwd * c - B.ankleUp * s;
    o.ay = o.hy + B.ankleFwd * s + B.ankleUp * c;
    o.th = th;
    return o;
  }
  // Стопа по положению голеностопа и наклону (для переноса)
  function footFromAnkle(ax, ay, th, o) {
    var c = Math.cos(th), s = Math.sin(th);
    o.ax = ax; o.ay = ay; o.th = th;
    o.hx = ax - (B.ankleFwd * c - B.ankleUp * s);
    o.hy = ay - (B.ankleFwd * s + B.ankleUp * c);
    o.tx = o.hx + B.footLen * c; o.ty = o.hy + B.footLen * s;
    return o;
  }
  function stanceTheta(u, P) {
    if (u < 0.16) return P.thStrike * (1 - smoothstep(0, 0.16, u));
    if (u < P.heelOff) return 0;
    return P.thOff * Math.pow((u - P.heelOff) / (1 - P.heelOff), 1.6);
  }
  function swingTheta(sw, P) {
    return P.thOff + (P.thStrike - P.thOff) * smoothstep(0.05, 0.9, sw);
  }
  // «Вынос» ноги в цикле: +1 в момент касания (впереди), -1 в момент отрыва (сзади)
  function legFwd(lp, beta) {
    if (lp < beta) return Math.cos(Math.PI * lp / beta);
    return -Math.cos(Math.PI * (lp - beta) / (1 - beta));
  }

  /* Аналитическая IK двухзвенной ноги (бедро T, голень S), колено сгибается вперёд. */
  function solveIK(hx, hy, ax, ay, o) {
    var T = B.thigh, S = B.shin;
    var dx = ax - hx, dy = ay - hy;
    var d = Math.sqrt(dx * dx + dy * dy);
    var dd = clamp(d, Math.abs(T - S) + 1e-3, T + S - 1e-7);
    var base = Math.atan2(dy, dx);
    var a = Math.acos(clamp((T * T + dd * dd - S * S) / (2 * T * dd), -1, 1));
    var ang = base + a;
    o.kx = hx + T * Math.cos(ang); o.ky = hy + T * Math.sin(ang);
    // голеностоп, которого цепочка достигла на самом деле (для честного замера скольжения)
    var sx = ax - o.kx, sy = ay - o.ky, sl = Math.sqrt(sx * sx + sy * sy) || 1;
    o.ax = o.kx + S * sx / sl; o.ay = o.ky + S * sy / sl;
    o.err = Math.sqrt((o.ax - ax) * (o.ax - ax) + (o.ay - ay) * (o.ay - ay));
    return o;
  }

  function newLeg(off) {
    return { off: off, lp: off, stance: true, anchor: 0, p0x: 0, p0y: 0,
      u: 0, sw: 0, w: 1, fwd: 0, hipX: 0, foot: {}, ik: {} };
  }

  function Walker(v0) {
    this.P = {};
    this.legs = [newLeg(0), newLeg(0.5)];   // [0] — ближняя к зрителю, [1] — дальняя
    this.arms = [{}, {}];                   // [0] — ближняя рука (в паре с дальней ногой)
    this.pose = { pelvisY: 0.95, lean: 0, sx: 0, sy: 0, headX: 0, headY: 0, headTilt: 0 };
    this.prints = [];
    this.trail = [];
    this.hipTrail = [];
    this.slipLog = [];
    this._tmp = {};
    this.reset(v0 || 1.4);
  }

  Walker.prototype.reset = function (v) {
    v = clamp(v, V_MIN, V_MAX);
    this.v = this.vTarget = v;
    this.acc = 0; this.phase = 0; this.s = 0; this.time = 0; this.slip = 0;
    this.prints.length = 0; this.trail.length = 0; this.hipTrail.length = 0; this.slipLog.length = 0;
    var P = gaitParams(v, this.P);
    for (var i = 0; i < 2; i++) {
      var leg = this.legs[i], lp = (this.phase + leg.off) % 1;
      leg.lp = lp;
      if (lp < P.beta) {
        leg.stance = true;
        leg.anchor = this.s + P.tdX - P.v * lp / P.f;
      } else {
        leg.stance = false;
        footPose(P.tdX - P.beta * P.L, P.thOff, this._tmp);
        leg.p0x = this._tmp.ax; leg.p0y = this._tmp.ay;
      }
    }
    this.solve();
  };

  Walker.prototype.setTarget = function (v) { this.vTarget = clamp(v, V_MIN, V_MAX); };

  Walker.prototype.update = function (dt) {
    // Плавный разгон/торможение с ограничением ускорения
    var err = this.vTarget - this.v;
    var a = clamp(err * 1.8, -2.2, 2.2);
    var nv = this.v + a * dt;
    if ((this.vTarget - nv) * err <= 0) { nv = this.vTarget; a = 0; }
    this.acc += (a - this.acc) * (1 - Math.exp(-dt * 3));
    this.v = nv;

    var P = gaitParams(this.v, this.P);
    this.time += dt;
    this.s += this.v * dt;
    this.phase = (this.phase + P.f * dt) % 1;

    for (var i = 0; i < 2; i++) {
      var leg = this.legs[i];
      var lp = (this.phase + leg.off) % 1, prev = leg.lp;
      var wrapped = lp < prev - 0.5;
      leg.lp = lp;
      if (leg.stance) {
        if (wrapped) {
          // страховка: опора длилась целый цикл — начинаем новую опору
          leg.anchor = this.s + P.tdX - P.v * lp / P.f;
        } else if (lp >= P.beta) {
          // Отрыв: стартовая точка переноса — поза стопы в точный момент отрыва
          var sLo = this.s - P.v * (lp - P.beta) / P.f;
          footPose(leg.anchor - sLo, P.thOff, this._tmp);
          leg.p0x = this._tmp.ax; leg.p0y = this._tmp.ay;
          leg.stance = false;
        }
      } else if (wrapped) {
        // Касание: якорь в мире — туда, куда перенос привёл стопу в точный момент касания
        leg.stance = true;
        leg.anchor = this.s + P.tdX - P.v * lp / P.f;
        this.prints.push({ x: leg.anchor, leg: i, t: this.time });
        if (this.prints.length > 48) this.prints.shift();
      }
    }
    this.solve();
  };

  /* Поза всего тела по текущему состоянию (без изменения состояния цикла). */
  Walker.prototype.solve = function () {
    var P = this.P, s = this.s, phase = this.phase, legs = this.legs, tmp = this._tmp;
    var i, leg, f;

    // 1. Цели стоп
    for (i = 0; i < 2; i++) {
      leg = legs[i]; f = leg.foot;
      leg.fwd = legFwd(leg.lp, P.beta);
      leg.hipX = B.hipSpread * leg.fwd;
      if (leg.stance) {
        leg.u = clamp(leg.lp / P.beta, 0, 1); leg.sw = 0; leg.w = 1;
        leg.R = lerp(REACH, P.reachLand, 1 - smoothstep(0, 0.4, leg.u));
        footPose(leg.anchor - s, stanceTheta(leg.u, P), f);
      } else {
        var sw = clamp((leg.lp - P.beta) / (1 - P.beta), 0, 1);
        leg.sw = sw; leg.u = 0;
        leg.R = lerp(REACH, P.reachLand, smoothstep(0.2, 0.7, sw));
        footPose(P.tdX, P.thStrike, tmp);                     // P3 — точка касания
        var k = P.match * P.L * (1 - P.beta) / 3;            // касательные = скорость земли
        var k3 = P.matchEnd * P.L * (1 - P.beta) / 3;
        var ax = bez(leg.p0x, leg.p0x - k, tmp.ax + k3, tmp.ax, sw);
        var ay = bez(leg.p0y, leg.p0y + P.h1, tmp.ay + P.h2, tmp.ay, sw);
        footFromAnkle(ax, ay, swingTheta(sw, P), f);
        var low = Math.min(f.hy, f.ty);
        if (low < 0) footFromAnkle(f.ax, f.ay - low, f.th, f);  // не «пропахивать» землю
        leg.w = Math.max(1 - smoothstep(0, 0.25, sw), smoothstep(0.7, 1, sw));
      }
    }

    // 2. Высота таза: желаемая волна, ограниченная досягаемостью стоп (перевёрнутый маятник)
    var y = P.hipH + P.bobAmp * Math.cos(4 * Math.PI * (phase - P.beta / 2));
    var hard = Infinity, minV = 0.35 * REACH;
    for (i = 0; i < 2; i++) {
      leg = legs[i]; f = leg.foot;
      var dx = f.ax - leg.hipX;
      var hm = f.ay + Math.sqrt(Math.max(leg.R * leg.R - dx * dx, minV * minV));
      y = smin(y, hm + (1 - leg.w) * 0.6, 0.05);
      if (leg.stance) hard = Math.min(hard, hm);
    }
    y = Math.min(y, hard);
    var pose = this.pose;
    pose.pelvisY = y;

    // 3. Ноги: досягаемость переноса + IK
    var slip = 0;
    for (i = 0; i < 2; i++) {
      leg = legs[i]; f = leg.foot;
      if (!leg.stance) {
        var ddx = f.ax - leg.hipX, ddy = f.ay - y, d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d > leg.R) footFromAnkle(leg.hipX + ddx * leg.R / d, y + ddy * leg.R / d, f.th, f);
      }
      solveIK(leg.hipX, y, f.ax, f.ay, leg.ik);
      if (leg.stance) slip = Math.max(slip, leg.ik.err);
    }
    this.slip = slip;

    // 4. Корпус: наклон от скорости + от ускорения + лёгкое покачивание
    var lean = P.lean + clamp(this.acc * 3.5, -5, 9) * DEG +
      lerp(1.0, 1.6, P.g) * DEG * Math.sin(4 * Math.PI * phase);
    pose.lean = lean;
    pose.sx = B.torso * Math.sin(lean);
    pose.sy = y + B.torso * Math.cos(lean);
    pose.headTilt = lean * 0.5;
    pose.headX = pose.sx + (B.neck + B.headR) * Math.sin(pose.headTilt);
    pose.headY = pose.sy + (B.neck + B.headR) * Math.cos(pose.headTilt);

    // 5. Руки: в противофазе ногам (ближняя рука идёт вместе с дальней ногой)
    for (i = 0; i < 2; i++) {
      var arm = this.arms[i];
      var pl = legs[1 - i];
      // ходьба: вынос по фазам опоры/переноса парной ноги
      var fwW = legFwd((pl.lp - 0.035 + 1) % 1, P.beta);
      // бег: симметричный мах (не «залипает» у корпуса при короткой опоре);
      // вперёд — к максимальному сгибанию бедра парной ноги (конец переноса)
      var psi = 2 * Math.PI * (pl.lp - 0.87), cp = Math.cos(psi), sp = Math.sin(psi);
      var fwR = (cp < 0 ? -1 : 1) * Math.pow(Math.abs(cp), 0.8);
      var fw = lerp(fwW, fwR, P.g);
      arm.fwd = fw;
      arm.shx = pose.sx + B.shoulderSpread * fw;
      arm.shy = pose.sy;
      var al = lean * 0.5 + P.armBase + P.armAmp * fw;
      // локоть на беге ~90°: сильнее согнут, когда рука идёт вперёд, раскрыт на махе назад
      var elR = (88 + 8 * fwR - 14 * sp) * DEG;
      var el = al + lerp(P.elbowBase + P.elbowSwing * fwW, elR, P.g);
      arm.ex = arm.shx + B.upperArm * Math.sin(al);
      arm.ey = arm.shy - B.upperArm * Math.cos(al);
      arm.hx = arm.ex + B.foreArm * Math.sin(el);
      arm.hy = arm.ey - B.foreArm * Math.cos(el);
    }
  };

  /* Журналы для визуализации: петли голеностопов в системе тела, след таза в мире,
   * максимум скольжения опорной стопы за последнюю секунду. */
  Walker.prototype.record = function () {
    var t = this.time, P = this.P, l0 = this.legs[0].ik, l1 = this.legs[1].ik;
    this.trail.push({ t: t, x0: l0.ax, y0: l0.ay, x1: l1.ax, y1: l1.ay });
    var keep = 1.02 / P.f;
    while (this.trail.length > 2 && t - this.trail[0].t > keep) this.trail.shift();
    this.hipTrail.push({ t: t, x: this.s, y: this.pose.pelvisY });
    while (this.hipTrail.length > 2 && t - this.hipTrail[0].t > 3.2) this.hipTrail.shift();
    this.slipLog.push({ t: t, e: this.slip });
    while (this.slipLog.length > 2 && t - this.slipLog[0].t > 1) this.slipLog.shift();
  };

  Walker.prototype.stats = function () {
    var P = this.P, slipMax = 0;
    for (var i = 0; i < this.slipLog.length; i++) slipMax = Math.max(slipMax, this.slipLog[i].e);
    return {
      v: this.v, kmh: this.v * 3.6, g: P.g,
      cadence: P.f * 120, step: P.L / 2, duty: P.beta,
      flight: Math.max(0, 1 - 2 * P.beta), double: Math.max(0, 2 * P.beta - 1),
      slipMm: slipMax * 1000, dist: this.s
    };
  };

  var api = {
    BODY: B, REACH: REACH, V_MIN: V_MIN, V_MAX: V_MAX,
    V_WALK_END: V_WALK_END, V_RUN_FULL: V_RUN_FULL,
    gaitParams: gaitParams, footPose: footPose, footFromAnkle: footFromAnkle,
    solveIK: solveIK, legFwd: legFwd, smin: smin, Walker: Walker
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Gait = api;
})(typeof window !== 'undefined' ? window : this);
