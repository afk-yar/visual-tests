'use strict';
// Честная 3D-математика для аквариума: векторная алгебра, камера (позиция + базис
// forward/right/up), перспективная проекция точки на экран и сортировка по глубине
// (алгоритм художника — рисуем от дальнего к ближнему).
//
// Дуал-mode модуль: в браузере кладёт API в window.Render3D, в node — экспортирует
// через module.exports (см. assets/shell.js — тот же паттерн).
(function () {
  // ---- векторная алгебра -----------------------------------------------
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function scale(a, k) { return { x: a.x * k, y: a.y * k, z: a.z * k }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }
  function length(a) { return Math.sqrt(dot(a, a)); }
  function normalize(a) {
    const len = length(a);
    if (len < 1e-9) return { x: 0, y: 0, z: 0 };
    return { x: a.x / len, y: a.y / len, z: a.z / len };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpVec(a, b, t) {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---- базис камеры / локальной системы координат объекта --------------
  // Строит ортонормированный базис {forward, right, up} из вектора направления
  // взгляда (forward) и подсказки "мировой верх" (upHint, обычно (0,1,0)).
  // right = normalize(cross(upHint, forward)); up = cross(forward, right).
  // При forward почти параллельном upHint (взгляд строго вверх/вниз) подставляем
  // запасную подсказку, чтобы избежать вырождения (деления на ~0 в normalize).
  function basisFromForward(forwardIn, upHint) {
    const f = normalize(forwardIn);
    let hint = upHint || { x: 0, y: 1, z: 0 };
    if (Math.abs(dot(f, normalize(hint))) > 0.999) {
      hint = { x: 0, y: 0, z: 1 };
    }
    const right = normalize(cross(hint, f));
    const up = cross(f, right);
    return { forward: f, right, up };
  }

  // Базис камеры по углам yaw (поворот вокруг мировой Y) и pitch (наклон вверх/вниз).
  // yaw=0,pitch=0 => forward=(0,0,1), right=(1,0,0), up=(0,1,0) — при этих углах
  // локальный базис совпадает с мировыми осями (тождественное преобразование).
  function basisFromYawPitch(yaw, pitch) {
    const cp = Math.cos(pitch);
    const forward = {
      x: Math.sin(yaw) * cp,
      y: Math.sin(pitch),
      z: Math.cos(yaw) * cp,
    };
    return basisFromForward(forward, { x: 0, y: 1, z: 0 });
  }

  // Переводит точку мира в систему координат камеры (basis + позиция).
  // Результат: x — вправо, y — вверх, z — вглубь экрана (дальность от камеры).
  function worldToCamera(point, cameraPos, basis) {
    const d = sub(point, cameraPos);
    return {
      x: dot(d, basis.right),
      y: dot(d, basis.up),
      z: dot(d, basis.forward),
    };
  }

  // Фокусное расстояние (в пикселях) из вертикального угла обзора и высоты вьюпорта.
  function fovToFocal(fovYRadians, heightPx) {
    return (heightPx / 2) / Math.tan(fovYRadians / 2);
  }

  // Перспективная проекция точки, уже находящейся в системе координат камеры.
  // camPoint.z — расстояние вдоль оси взгляда (глубина). scale = focal/z — во
  // сколько раз масштабируется отрезок на этой глубине (используется и для
  // размера объектов, и для тумана/помутнения по глубине).
  function project(camPoint, focal, width, height) {
    const nearEps = 1e-4;
    const behind = camPoint.z <= nearEps;
    const z = behind ? nearEps : camPoint.z;
    const s = focal / z;
    return {
      x: width / 2 + camPoint.x * s,
      y: height / 2 - camPoint.y * s,
      scale: s,
      depth: camPoint.z,
      behind,
    };
  }

  // Удобная обёртка: мировая точка -> экран, одним вызовом.
  // camera = { position:{x,y,z}, basis:{forward,right,up} }
  // params = { focal, width, height }
  function projectPoint(point, camera, params) {
    const cp = worldToCamera(point, camera.position, camera.basis);
    return project(cp, params.focal, params.width, params.height);
  }

  // Алгоритм художника: сортировка по убыванию глубины — дальние объекты
  // оказываются первыми (их и нужно рисовать первыми, чтобы ближние их перекрыли).
  function sortByDepthDesc(items, getDepth) {
    return items.slice().sort((a, b) => getDepth(b) - getDepth(a));
  }

  const api = {
    add, sub, scale, dot, cross, length, normalize, lerp, lerpVec, clamp,
    basisFromForward, basisFromYawPitch, worldToCamera,
    fovToFocal, project, projectPoint, sortByDepthDesc,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.Render3D = api;
})();
