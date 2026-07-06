'use strict';
const assert = require('node:assert');
const { heightAt, projectHeight, colorAt, fbm2D, valueNoise2D, hash2D } = require('./voxel.js');

// --- heightAt: детерминированность ---
{
  const a = heightAt(123.5, -47.25, 42);
  const b = heightAt(123.5, -47.25, 42);
  assert.strictEqual(a, b, 'heightAt должна давать одинаковый результат для одинакового входа');
}

// разные координаты должны (практически всегда) давать разную высоту —
// функция не константа
{
  const a = heightAt(0, 0, 1);
  const b = heightAt(500, 500, 1);
  assert.notStrictEqual(a, b, 'heightAt не должна быть константой по координатам');
}

// разный seed должен давать разную карту в той же точке
{
  const a = heightAt(100, 200, 1);
  const b = heightAt(100, 200, 2);
  assert.notStrictEqual(a, b, 'heightAt должна зависеть от seed');
}

// высота лежит в допустимом диапазоне [0, maxHeight]
{
  const maxHeight = 900;
  const points = [[0, 0], [1000, -1000], [-333.3, 777.7], [99999, 1]];
  for (const [x, y] of points) {
    const h = heightAt(x, y, 7, { maxHeight });
    assert.ok(h >= 0 && h <= maxHeight, `heightAt(${x},${y}) вне диапазона: ${h}`);
  }
}

// --- projectHeight: ручная проверка проекции ---

// Точка ровно на уровне камеры проецируется точно на линию горизонта —
// независимо от дистанции и масштаба высоты.
{
  const camera = { height: 300, horizonY: 240, scaleHeight: 500 };
  assert.strictEqual(projectHeight(300, 50, camera), 240);
  assert.strictEqual(projectHeight(300, 5000, camera), 240);
}

// Точка выше камеры проецируется НАД линией горизонта (меньший экранный Y),
// точка ниже камеры — ПОД горизонтом (больший Y).
{
  const camera = { height: 300, horizonY: 240, scaleHeight: 500 };
  const above = projectHeight(400, 100, camera);
  const below = projectHeight(200, 100, camera);
  assert.ok(above < camera.horizonY, 'точка выше камеры должна проецироваться выше горизонта');
  assert.ok(below > camera.horizonY, 'точка ниже камеры должна проецироваться ниже горизонта');
}

// Точное ручное значение: терраса на 100 юнитов выше камеры, дистанция 50,
// scaleHeight 500 → screenY = horizonY - (100/50)*500 = horizonY - 1000.
{
  const camera = { height: 200, horizonY: 300, scaleHeight: 500 };
  const y = projectHeight(300, 50, camera);
  assert.strictEqual(y, 300 - ((300 - 200) / 50) * 500);
  assert.strictEqual(y, -700);
}

// Перспектива: с ростом дистанции проекция той же по высоте точки
// стягивается ближе к линии горизонта.
{
  const camera = { height: 0, horizonY: 240, scaleHeight: 500 };
  const near = projectHeight(200, 50, camera);
  const far = projectHeight(200, 500, camera);
  assert.ok(
    Math.abs(far - camera.horizonY) < Math.abs(near - camera.horizonY),
    'дальняя точка должна проецироваться ближе к горизонту, чем ближняя'
  );
}

// --- colorAt: базовые свойства палитры ---
{
  const water = colorAt(0, 900);
  const snow = colorAt(900, 900);
  assert.ok(water.b > water.r, 'у воды синий канал должен доминировать над красным');
  assert.ok(snow.r > 200 && snow.g > 200 && snow.b > 200, 'вершина должна быть близка к белому (снег)');
}

// --- noise-примитивы: детерминизм и диапазон ---
{
  assert.strictEqual(hash2D(3, 4, 5), hash2D(3, 4, 5));
  const h = hash2D(3, 4, 5);
  assert.ok(h >= 0 && h < 1, 'hash2D должен возвращать значение в [0,1)');
  const n = valueNoise2D(1.25, 2.75, 9);
  assert.ok(n >= 0 && n <= 1, 'valueNoise2D должен возвращать значение в [0,1]');
  const f = fbm2D(1.25, 2.75, 9, 5);
  assert.ok(f >= 0 && f <= 1, 'fbm2D должен возвращать значение в [0,1]');
}

console.log('voxel.test.js: все проверки пройдены');
